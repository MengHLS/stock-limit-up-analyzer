/**
 * 运行工作台 — 声明式条件 → 执行门槛 编译器（STEP A-1 唯一实现）。
 *
 * ## 为什么需要它（要修的缺陷）
 *
 * 回测信号的唯一来源是**配方**（`assemble.ts#requireRecipe`）。策略文档里的
 * `definition.entry.conditions` 此前**在信号链上零消费者** —— 文档没带 `recipe` 时装配层
 * 静默回落到默认配方 `leader-candidate-baseline`（涨幅加权取前 5 名）。
 * ⇒ 用户研究出「守线 + 缩量」，转正后点「运行回测」，跑的却是另一个模式。
 * 这是**产物看起来完全正常**的静默错误。
 *
 * 本模块把「文档里写的条件」编译成真实的执行门槛（`FeatureGate`），让**声明与执行同源**；
 * 编译不出来的条件**一律响亮抛错并逐条列出**，绝不回落默认配方（静默回落正是上述缺陷的成因）。
 *
 * ## 硬纪律（改本文件前先读）
 *
 * 1. **禁第二套口径**：门槛引用的特征 id 全部取自 `recipeRegistry.PULLBACK_FEATURE_IDS`，
 *    特征提供器复用 `recipeRegistry.buildPullbackFeatureProviders`（即已注册配方
 *    `first-limit-pullback-hold-shrink` 用的同一批 `compute*` 实现）。本文件**不新增任何计算**。
 * 2. **闭集**：字段、运算符、右值种类三者都在下面的表里显式登记；表外一律**抛错**，不猜、不降级。
 * 3. **等价改写必须有证明**：原始行情写法（`bar.low >= prefix.rd0.open` 这类）之所以能映射，
 *    是因为它与派生特征**在数学上等价**（证明见下表注释）。没有证明的组合不进表。
 */

import type { DecisionPoint } from "../../data";
import type { FeatureGate } from "../framework/gatedSignal";
import type { ConditionDefinition, StrategyConditionOperator } from "../strategySchema/definition";
import {
  PULLBACK_FEATURE_IDS,
  buildGatedRecipeRuntime,
  buildPullbackFeatureProviders,
  requireNumericParameter,
  type StrategyRecipeRuntime,
} from "../recipeRegistry";
import { StrategyRecipeRuntimeError } from "../recipeErrors";
import type { ResearchParameterSchema, ResearchParameterSet } from "../types";

// ---------------------------------------------------------------------------
// 常量（合成配方的身份与外观；改这里要同步 IMPLEMENTATION 文档）
// ---------------------------------------------------------------------------

/**
 * 合成配方的 recipeId。
 *
 * 它**不是**注册表成员（`REGISTERED_RECIPES` 里没有它）—— 它由文档条件现场合成，
 * 因此用一个自解释的 id 让审计摘要与 UI 一眼看出「这次跑的是文档声明的条件，不是某个登记配方」。
 */
export const DECLARATIVE_RECIPE_ID = "strategy-declared-conditions";

/** 随机种子（确定性合成 ⇒ 固定值；与已注册配方的 `randomSeed` 取值域一致）。 */
const DECLARATIVE_RECIPE_RANDOM_SEED = 17;

/** 与已注册配方 `first-limit-pullback-hold-shrink` 对齐的决策时点（不引入新语义）。 */
const DECLARATIVE_RECIPE_POINT: DecisionPoint = "close";

/** 与已注册配方对齐的候选数上限（选择口径本增量不动）。 */
const DECLARATIVE_RECIPE_TOP_N = 5;

// ---------------------------------------------------------------------------
// 表 1：派生字段 → 执行侧特征 id（**恒等映射**，命名唯一真源 = PULLBACK_FEATURE_IDS）
// ---------------------------------------------------------------------------

const DERIVED_FEATURE_BY_FIELD: ReadonlyMap<string, string> = new Map([
  ["bar.haircutFromEventLow", PULLBACK_FEATURE_IDS.haircut],
  ["bar.volumeRatio", PULLBACK_FEATURE_IDS.volumeRatio],
  ["bar.isBullish", PULLBACK_FEATURE_IDS.isBullish],
  ["bar.momentumFromEventClose", PULLBACK_FEATURE_IDS.momentum],
]);

// ---------------------------------------------------------------------------
// 表 2：运算符 → 门槛种类（`FeatureGate` 只有 5 种，故是闭集）
// ---------------------------------------------------------------------------

type GateKind = FeatureGate["kind"];

const GATE_KIND_BY_OPERATOR: ReadonlyMap<StrategyConditionOperator, GateKind> = new Map([
  ["GREATER_THAN", "gt"],
  ["GREATER_THAN_OR_EQUAL", "gte"],
  ["LESS_THAN", "lt"],
  ["LESS_THAN_OR_EQUAL", "lte"],
  ["EQUAL", "eq"],
]);

// ---------------------------------------------------------------------------
// 表 3：原始行情写法的**可证明等价改写**
//
// 记号：`o0` = 首板日开盘价（`prefix.rd0.open` = `eventBaselineOf(bars).open`）、
//       `v0` = 首板日成交量、`c0` = 首板日收盘价；`low`/`volume`/`close` = 决策日（当前 bar）同名字段。
// 已注册配方的特征是：
//       haircutFromEventLow = (o0 − low) / o0
//       volumeRatio         = volume / v0
//       momentumFromEventClose = close / c0 − 1
//
// 逐条证明（前提 o0 > 0、v0 > 0、c0 > 0 —— 与 `eventBaselineOf` 的既有非零约束一致）：
//   ① low   >= o0              ⇔ (o0 − low) / o0 <= 0        ⇔ haircut <= 0
//   ② low   >  o0              ⇔ haircut <  0
//   ③ volume <= v0             ⇔ volume / v0 <= 1            ⇔ volumeRatio <= 1
//   ④ volume <  v0             ⇔ volumeRatio < 1
//   ⑤ volume >= v0             ⇔ volumeRatio >= 1
//   ⑥ volume >  v0             ⇔ volumeRatio > 1
//   ⑦ close  >= c0             ⇔ close / c0 − 1 >= 0         ⇔ momentum >= 0
//   ⑧ close  <= c0             ⇔ momentum <= 0
//
// ⚠️ 只有上表这 8 条进表。任何**混合**写法（如 `bar.low >= prefix.rd0.close`）数学上不等价于
// 任何一个既有特征 ⇒ 一律「无法映射」，不猜、不近似。
//
// 🔴 **方向会翻转**：等价改写不是「同一个运算符直接套用」。`low >= o0` 译出的源 kind 是 `gte`，
// 但作用于 `haircut` 的门槛是 `lte`（bound 0）—— 把 `gte` 直接用在 `haircut` 上会得到反向语义
// （`haircut >= 0` 是「跌破首板开盘价」，不是「守线」）。
// 因此下表的数据结构是**源运算符 → 目标门槛**的显式映射；表里没有登记的方向 = 无等价改写。
// ---------------------------------------------------------------------------

interface EquivalentRewrite {
  readonly featureId: string;
  /**
   * 源运算符（`GATE_KIND_BY_OPERATOR` 译出的 kind）→ **作用在上述特征上的门槛**。
   *
   * 键 = 源条件的运算符；值 = 真正的 `FeatureGate`。缺项意味着该方向没有等价改写，
   * 调用方须抛 `CONDITION_NOT_MAPPABLE`，绝不近似、也绝不靠翻转符号蒙混。
   */
  readonly targetBySourceKind: ReadonlyMap<GateKind, { readonly kind: GateKind; readonly bound: number }>;
}

const EQUIVALENT_REWRITES: ReadonlyMap<string, EquivalentRewrite> = new Map([
  [
    "bar.low|prefix.rd0.open",
    {
      featureId: PULLBACK_FEATURE_IDS.haircut,
      // ① low >= o0 ⇔ haircut <= 0      ② low > o0 ⇔ haircut < 0
      targetBySourceKind: new Map<GateKind, { readonly kind: GateKind; readonly bound: number }>([
        ["gte", { kind: "lte", bound: 0 }],
        ["gt", { kind: "lt", bound: 0 }],
      ]),
    },
  ],
  [
    "bar.volume|prefix.rd0.volume",
    {
      featureId: PULLBACK_FEATURE_IDS.volumeRatio,
      // ③ volume <= v0 ⇔ volumeRatio <= 1   ④ volume < v0 ⇔ volumeRatio < 1
      // ⑤ volume >= v0 ⇔ volumeRatio >= 1   ⑥ volume > v0 ⇔ volumeRatio > 1
      targetBySourceKind: new Map<GateKind, { readonly kind: GateKind; readonly bound: number }>([
        ["lte", { kind: "lte", bound: 1 }],
        ["lt", { kind: "lt", bound: 1 }],
        ["gte", { kind: "gte", bound: 1 }],
        ["gt", { kind: "gt", bound: 1 }],
      ]),
    },
  ],
  [
    "bar.close|prefix.rd0.close",
    {
      featureId: PULLBACK_FEATURE_IDS.momentum,
      // ⑦ close >= c0 ⇔ momentum >= 0    ⑧ close <= c0 ⇔ momentum <= 0
      targetBySourceKind: new Map<GateKind, { readonly kind: GateKind; readonly bound: number }>([
        ["gte", { kind: "gte", bound: 0 }],
        ["lte", { kind: "lte", bound: 0 }],
      ]),
    },
  ],
]);

/** 门槛右值：字面量，或指向文档参数的 code（在 `buildGates(parameters)` 时求值）。 */
type GateBound =
  | { readonly kind: "literal"; readonly value: number }
  | { readonly kind: "parameter"; readonly code: string };

interface CompiledGate {
  readonly gateKind: GateKind;
  readonly featureId: string;
  readonly bound: GateBound;
  readonly label: string;
}

/** 无法映射的一处条件（进错误消息；不进返回值）。 */
interface UnmappableCondition {
  readonly index: number;
  readonly field: string;
  readonly operator: string;
  readonly reason: string;
}

const MAPPABLE_FIELD_LIST = [
  ...DERIVED_FEATURE_BY_FIELD.keys(),
].join(" / ");

function describeUnmappable(list: readonly UnmappableCondition[]): string {
  const lines = list.map(
    (item, i) =>
      `  ${i + 1}. 第 ${item.index + 1} 条条件 \`${item.field}\` ${item.operator} —— ${item.reason}`,
  );
  return [
    `无法映射的条件共 ${list.length} 条（拒绝静默回落默认配方）：`,
    ...lines,
    "可编译的字段（执行侧已实现特征对应的 `bar.*` 字段名）：" + MAPPABLE_FIELD_LIST,
    "可编译的原始行情写法（与上述特征**数学等价**，已证明）："
      + "bar.low >= prefix.rd0.open（守线） / bar.volume <= prefix.rd0.volume（不缩量） / "
      + "bar.close >= prefix.rd0.close（不低于首板收盘）",
    "可编译的运算符：GREATER_THAN / GREATER_THAN_OR_EQUAL / LESS_THAN / LESS_THAN_OR_EQUAL / EQUAL"
      + "（NOT_EQUAL / IN / NOT_IN 在执行侧没有等价门槛，一律拒绝而非静默丢弃）",
    "右值只接受「常量」或「文档参数 code」；字段引用（如与 prefix.rd0.close 比较）无法在特征层表达。",
  ].join("\n");
}

/** 判 `value` 是否为有限数字。 */
function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function coerceSingleValue(value: ConditionDefinition["value"]): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** 编译单条条件；无法映射时返回原因字符串（**不抛错**，便于一次性列全）。 */
function compileOne(
  condition: ConditionDefinition,
  index: number,
  parameterCodes: ReadonlySet<string>,
): CompiledGate | UnmappableCondition {
  const fail = (reason: string): UnmappableCondition => ({
    index,
    field: condition.field,
    operator: condition.operator,
    reason,
  });

  const derivedFeatureId = DERIVED_FEATURE_BY_FIELD.get(condition.field);
  const gateKind = GATE_KIND_BY_OPERATOR.get(condition.operator);
  const raw = coerceSingleValue(condition.value);

  // ---- 右值种类：只接受 常量 / 参数引用 ----
  let bound: GateBound;
  if (condition.valueType === "PARAMETER_REFERENCE") {
    const code = typeof raw === "string" ? raw : "";
    if (code.length === 0 || !parameterCodes.has(code)) {
      return fail(
        "valueType=PARAMETER_REFERENCE，但右值 " + JSON.stringify(raw) +
          " 不在该文档的 parameters 里（不能凭空指向一个未声明的参数）",
      );
    }
    bound = { kind: "parameter", code };
  } else if (condition.valueType === "FIELD_REFERENCE") {
    // 字段引用右值只可能出现在「原始行情 vs 原始行情」的等价改写里（表 3），单独处理。
    bound = { kind: "literal", value: Number.NaN };
  } else {
    const numeric = asFiniteNumber(raw);
    if (numeric === null) {
      return fail(
        "valueType=CONSTANT，但右值 " + JSON.stringify(raw) +
          " 不是有限数字（字符串常量与数值特征比较无意义；含算术运算符的表达式已在转正时被拒绝）",
      );
    }
    bound = { kind: "literal", value: numeric };
  }

  if (gateKind === undefined) {
    return fail(
      "运算符 " + condition.operator + " 在执行侧没有等价门槛（FeatureGate 只有 gt/gte/lt/lte/eq 五种）",
    );
  }

  // ---- 路径 A：派生字段 → 同名特征（恒等映射） ----
  if (derivedFeatureId !== undefined) {
    if (bound.kind === "literal" && !Number.isFinite(bound.value)) {
      return fail(
        "派生字段 " + condition.field + " 的右值是字段引用；特征层只能与「常量 / 参数」比较，无法与另一个字段比较",
      );
    }
    return {
      gateKind,
      featureId: derivedFeatureId,
      bound,
      label: condition.description ?? condition.field,
    };
  }

  // ---- 路径 B：原始行情写法 → 可证明等价的派生特征 ----
  const rightRef = typeof raw === "string" ? raw : "";
  const rewrite = EQUIVALENT_REWRITES.get(condition.field + "|" + rightRef);
  if (rewrite !== undefined) {
    if (condition.valueType !== "FIELD_REFERENCE") {
      return fail(
        "写成了等价改写（" + condition.field + " 与 " + rightRef +
          " 比较），但 valueType 是 " + condition.valueType + "；等价改写要求 valueType=FIELD_REFERENCE",
      );
    }
    const target = rewrite.targetBySourceKind.get(gateKind);
    if (target === undefined) {
      return fail(
        "运算符 " + condition.operator + " 在 " + condition.field + " 与 " + rightRef +
          " 的等价改写里没有定义（可用的方向见 compile.ts 表 3 的证明）",
      );
    }
    return {
      gateKind: target.kind,
      featureId: rewrite.featureId,
      bound: { kind: "literal", value: target.bound },
      label: condition.description ?? (condition.field + " vs " + rightRef),
    };
  }

  return fail(
    "字段 " + condition.field + " 既不是「执行侧已实现的特征」，也不是已证明等价的原始行情写法" +
      "（原始行情写法只支持 bar.low vs prefix.rd0.open / bar.volume vs prefix.rd0.volume / " +
      "bar.close vs prefix.rd0.close）",
  );
}

// ---------------------------------------------------------------------------
// 公开入口
// ---------------------------------------------------------------------------

export interface CompileConditionRecipeInput {
  /** 策略身份（只进错误消息与摘要，不参与计算）。 */
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly conditions: readonly ConditionDefinition[];
  /** 只用于「右值是参数引用」时判定 code 是否合法（门槛在 `buildGates` 时才取值）。 */
  readonly parameters: ResearchParameterSchema;
}

/**
 * 把文档的声明式条件编译成一份**可执行配方**。
 *
 * 抛错条件（全部响亮，不静默）：
 *   - 一条可编译的条件都没有（`enabled !== false` 的条数为 0）；
 *   - 任一条件无法映射（消息里逐条列出）。
 *
 * `enabled === false` 的条件按声明语义**跳过**（它是作者显式关掉的），跳过条数进摘要。
 */
export function compileConditionRecipe(input: CompileConditionRecipeInput): StrategyRecipeRuntime {
  const parameterCodes = new Set(input.parameters.parameters.map(parameter => parameter.name));

  const enabled: Array<{ condition: ConditionDefinition; index: number }> = [];
  input.conditions.forEach((condition, index) => {
    if (condition.enabled === false) return;
    enabled.push({ condition, index });
  });

  if (enabled.length === 0) {
    throw new StrategyRecipeRuntimeError(
      "CONDITION_EMPTY",
      `装配层：策略 ${input.strategyId}@${input.strategyVersion} 没有可执行的入场条件 —— ` +
        `文档声明了 ${input.conditions.length} 条条件，但全部是 enabled=false。` +
        `请在策略文档里至少启用一条条件；若这个版本本就没有条件，请为它补上 recipe 字段` +
        `（本层不会在「无条件」时猜一个配方）。`,
    );
  }

  const compiled: CompiledGate[] = [];
  const failures: UnmappableCondition[] = [];
  for (const entry of enabled) {
    const result = compileOne(entry.condition, entry.index, parameterCodes);
    if ("reason" in result) failures.push(result);
    else compiled.push(result);
  }

  if (failures.length > 0) {
    throw new StrategyRecipeRuntimeError(
      "CONDITION_NOT_MAPPABLE",
      `装配层：策略 ${input.strategyId}@${input.strategyVersion} 的条件无法全部编译成执行门槛。\n` +
        describeUnmappable(failures),
    );
  }

  const skippedCount = input.conditions.length - enabled.length;
  const gateSummary = compiled
    .map(gate => `${gate.featureId} ${gate.gateKind} ${gate.bound.kind === "parameter" ? gate.bound.code : String(gate.bound.value)}`)
    .join(" 且 ");

  return buildGatedRecipeRuntime({
    recipeId: DECLARATIVE_RECIPE_ID,
    signalKind: "gated",
    point: DECLARATIVE_RECIPE_POINT,
    signalFrequency: "daily",
    signalDescription:
      `由策略文档的声明式条件现场合成（共 ${compiled.length} 条门槛` +
      (skippedCount > 0 ? `，另有 ${skippedCount} 条 enabled=false 已按声明跳过` : "") +
      `）：${gateSummary}`,
    requiredData: ["OHLCV"],
    selectionSummary:
      `在满足文档声明的 ${compiled.length} 条门槛的候选中，按相对首板日收盘的涨幅由高到低取前 ${DECLARATIVE_RECIPE_TOP_N} 名`,
    randomSeed: DECLARATIVE_RECIPE_RANDOM_SEED,
    features: buildPullbackFeatureProviders(DECLARATIVE_RECIPE_POINT),
    rankFeatureId: PULLBACK_FEATURE_IDS.momentum,
    rankingConfig: { higherIsBetter: true },
    selectionConfig: { method: { kind: "topN", n: DECLARATIVE_RECIPE_TOP_N } },
    buildGates(parameters: ResearchParameterSet): readonly FeatureGate[] {
      return compiled.map(gate => {
        const bound =
          gate.bound.kind === "parameter"
            ? requireNumericParameter(parameters, gate.bound.code)
            : gate.bound.value;
        return { kind: gate.gateKind, featureId: gate.featureId, bound, label: gate.label };
      });
    },
  });
}
