/**
 * RESEARCH-006.3 — **唯一的** `Candidate → StrategyDefinition` 转换器。
 *
 * 架构依据（唯一基准）：`docs/research/RESEARCH-006.0-architecture.md` §5.2 / §7.1 / §9 / §11.3 / §14。
 * 实施依据：`docs/research/RESEARCH-006.3-*.md`（Promote 契约）§6 / §7 / §8 / §9。
 *
 * 三条不可让渡的纪律（006.3 §6~§9）：
 *   ① **输入是 Candidate，不是 Conclusion / Result**（§7）：本文件**只读候选草稿**，
 *      不查库、不二次研究、不改写语义；
 *   ② **纯函数、确定性、零副作用**（§6）：无 DB、无 IO、无 `Date.now`、无随机；同一输入必得同一输出；
 *   ③ **绝不猜测**（§8）：草稿缺什么就**响亮失败**——绝不补「默认买入 / 默认止盈 / 默认止损 /
 *      默认持有 N 天 / 默认参数」，也绝不把研究观测固化成正式规则。
 *
 * ## 为什么需要「草图扩展槽」
 *
 * 006.0 §5.2 已论证：Research 侧草稿词表（`entryRule` 的 `{event,timing}` 自由字符串）与
 * Strategy 侧强类型词表**不可能同构**，而 `StrategyDefinition` 的 `entry.observationWindow` /
 * `entry.trigger` / `execution` / `position` / 文档级 `executionAssumptions` 都是**必填**。
 * 006.3 §4 又明确 `promote` 的 `overrides` **只**接受 `datasetBinding` / `datasetDivergenceReason`
 * ⇒ 这些字段只能来自候选自身。
 *
 * 因此本 STEP 把 **`Candidate.entryRule.extra` 定义为候选草稿的「唯一具名扩展槽」**：
 *
 *   - 用**已存在的** `extra?: Record<string, unknown>`（`researchCore/candidates.ts` 标注为「开放扩展」），
 *     ⇒ 不需要新列、不需要 migration、不改变 006.0 §13.1 对 5 个 `*Json` 列语义的裁定；
 *   - 键名**与 `StrategyDefinition` 的段名一一对应**，映射表见 006.3 实施报告；
 *   - **闭集**：出现本文件未定义的键 ⇒ 响亮失败（不静默忽略）；
 *   - `exitRule.extra` / `riskRule.extra` 本 STEP **不使用**：非空即失败（避免两处扩展槽造成歧义）。
 *
 * 一句话：Candidate 是唯一中间输入；Definition 只能由本文件生成。
 */

import { assertConditionSet } from "../../researchCore";
import type { ResearchStrategyCandidate } from "../../researchCore";
import {
  STRATEGY_DEFINITION_SCHEMA_VERSION,
  STRATEGY_COST_MODELS,
  STRATEGY_DERIVED_BAR_FIELDS,
  STRATEGY_EVENT_TYPES,
  STRATEGY_POSITION_SIZING_METHODS,
  STRATEGY_QUANTITY_METHODS,
  STRATEGY_TRIGGER_TYPES,
  STRATEGY_WINDOW_UNITS,
  normalizeStrategyDefinition,
  parseStrategyFieldReference,
  type ConditionDefinition,
  type ExitRuleDefinition,
  type ParameterDefinition,
  type StrategyConditionOperator,
  type StrategyConditionValueType,
  type StrategyDatasetBinding,
  type StrategyDefinition,
  type StrategyDefinitionInput,
  type StrategyExecutionTiming,
  type StrategyExitTrigger,
  type StrategyPriceType,
  type StrategySignalTiming,
  type StrategyWindowUnit,
} from "../strategySchema/definition";
import type { StrategyRecipe } from "../strategySchema/types";
import type { ResearchParameterValue } from "../types";
import { validateCanonicalStrategyDefinition } from "../strategySchema/definitionValidation";
import {
  STRATEGY_PARAMETER_ROLES,
  type StrategyParameterRole,
} from "../strategySchema/definition";
import { STRATEGY_CANDIDATE_ERROR, StrategyCandidateError } from "./candidateTypes";

// ---------------------------------------------------------------------------
// 扩展槽键白名单（闭集；§9「映射可单测」的可枚举面）
// ---------------------------------------------------------------------------

/**
 * `entryRule.extra` 允许出现的键（**唯一权威**）。
 * 出现此列之外的键 ⇒ `PROMOTE_SKETCH_INVALID`（不静默忽略）。
 */
export const CANDIDATE_SKETCH_EXTENSION_KEYS = [
  "observationWindow",
  "trigger",
  "eventParams",
  "execution",
  "position",
  "risk",
  "document",
  /**
   * 🔴 2026-09-13 新增：**执行配方引用**（`StrategyRecipe` 的可序列化面）。
   *
   * 为什么必须开这个槽：策略文档的 `recipe` 是「可序列化面 → 真实可执行实例」的唯一钥匙
   * （见 `recipeRegistry.ts`）。缺它时装配层只能落到 `DEFAULT_STRATEGY_RECIPE_ID`
   * （= 「按涨跌幅取前 5 名」），于是**声明「守线 + 缩量」的策略在回测里跑的是别的东西** ——
   * 这正是 `docs/evidence/_probe_promoted_entry_conditions.mts` 取证的断点。
   *
   * ⇒ 候选草稿必须能声明「我该用哪个配方跑」。否则 promote 出来的文档永远缺 `recipe`，
   *   条件就永远进不了回测。
   */
  "recipe",
] as const;
export type CandidateSketchExtensionKey = (typeof CANDIDATE_SKETCH_EXTENSION_KEYS)[number];

/**
 * `entryRule.timing`（Research 词表）→ `definition.execution` 三元组（Strategy 词表）。
 *
 * 🔴 **显式映射表，不是推断**：`timing` 是候选草稿里**已声明**的字段（`ResearchEntryRule.timing`），
 * 本表把它的每一种取值一对一翻译成「信号时点 / 成交时点 / 成交价」。未知取值 ⇒ 响亮失败。
 */
export const ENTRY_TIMING_TO_EXECUTION: Readonly<
  Record<string, { signalTiming: StrategySignalTiming; executionTiming: StrategyExecutionTiming; priceType: StrategyPriceType }>
> = {
  /** 次一交易日开盘买入（A 股 T+1 最常用口径）。 */
  NEXT_OPEN: { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN", priceType: "OPEN" },
  /** 次一交易日收盘买入。 */
  NEXT_CLOSE: { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_CLOSE", priceType: "CLOSE" },
  /** 事件日收盘买入（信号与成交同 bar）。 */
  SAME_CLOSE: { signalTiming: "T_CLOSE", executionTiming: "T_CLOSE", priceType: "CLOSE" },
};

/** Research 条件操作符 → Strategy 条件操作符（Strategy 词表**没有** BETWEEN / IS_NULL / IS_NOT_NULL）。 */
const CONDITION_OPERATOR_MAP: Readonly<Record<string, StrategyConditionOperator>> = {
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  "==": "EQUAL",
  "!=": "NOT_EQUAL",
  IN: "IN",
  NOT_IN: "NOT_IN",
};

/**
 * 出场规则的确定性实现口径（**固定映射表**，不是默认值）：
 * 草稿只声明「止盈 / 止损 / 持有天数」三种研究结论，落到 Strategy 词表时需要 `trigger` 与 `priority`，
 * 本表把它们固定下来（同一草稿必得同一 Definition）。
 */
const EXIT_REALIZATION = {
  STOP_LOSS: { id: "exit-stop-loss", priority: 1, trigger: "INTRADAY" as StrategyExitTrigger },
  TAKE_PROFIT: { id: "exit-take-profit", priority: 2, trigger: "INTRADAY" as StrategyExitTrigger },
  TIME_EXIT: { id: "exit-time-exit", priority: 3, trigger: "ON_CLOSE" as StrategyExitTrigger },
} as const;

// ---------------------------------------------------------------------------
// 错误构造（统一带回路径，便于定位草稿里到底缺了什么）
// ---------------------------------------------------------------------------

function incomplete(path: string, message: string): never {
  throw new StrategyCandidateError(
    STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
    `候选草稿缺少构建 StrategyDefinition 的必填内容：${path} — ${message}`
      + "（Promote 不是策略生成 AI，Service 不会补默认值）",
    { path },
  );
}

function invalid(path: string, message: string): never {
  throw new StrategyCandidateError(
    STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
    `候选草稿内容非法：${path} — ${message}`,
    { path },
  );
}

// ---------------------------------------------------------------------------
// 基础取值助手
// ---------------------------------------------------------------------------

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, `必须是对象，实际：${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return asRecord(value, path);
}

/**
 * **必填**对象段：缺失 ⇒ `PROMOTE_SKETCH_INCOMPLETE`（草稿少了东西，回去补），
 * 类型错 ⇒ `PROMOTE_SKETCH_INVALID`（草稿写错了东西，回去改）。
 *
 * 两者不能混：把「缺失」报成「非法」会让调用方以为草稿写错了，而实际要做的是补齐草稿。
 */
function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined || value === null) {
    incomplete(path, "该段是构建 StrategyDefinition 的必填内容，草稿里没有提供");
  }
  return asRecord(value, path);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "数组";
  return typeof value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    incomplete(path, `必须是非空字符串，实际：${describe(value)}`);
  }
  return value.trim();
}

/** 缺失（undefined / null）与写错值**分开报**：前者是「回去补草稿」，后者是「回去改草稿」。 */
function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (isMissing(value)) {
    incomplete(path, `必填，只能是 ${allowed.join(" / ")}（草稿里没有提供，Promote 不会替你选一个）`);
  }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    invalid(path, `只能是 ${allowed.join(" / ")}，实际：${JSON.stringify(value)}`);
  }
  return value as T;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (isMissing(value)) {
    incomplete(path, "必填的有限数字（草稿里没有提供，Promote 不会替你填一个默认值）");
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(path, `必须是有限数字，实际：${JSON.stringify(value)}`);
  }
  return value;
}

/** 显式拒绝「未定义的扩展」。闭集语义：凡不在白名单的键一律响亮失败。 */
function assertExtensionKeys(extra: Record<string, unknown>, path: string): void {
  const offenders = Object.keys(extra).filter(
    (key) =>
      !(CANDIDATE_SKETCH_EXTENSION_KEYS as readonly string[]).includes(key)
      && extra[key] !== undefined,
  );
  if (offenders.length > 0) {
    invalid(
      path,
      `未定义的扩展键：${offenders.join("、")}`
        + `（本 STEP 只认可 ${CANDIDATE_SKETCH_EXTENSION_KEYS.join(" / ")}；闭集，不静默忽略）`,
    );
  }
}

/** `exitRule.extra` / `riskRule.extra` 本 STEP 不定义语义 ⇒ 非空即失败。 */
function assertUnusedExtra(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  const record = asRecord(value, path);
  const keys = Object.keys(record).filter((key) => record[key] !== undefined);
  if (keys.length > 0) {
    invalid(
      path,
      `本 STEP 未定义该扩展槽的语义（键：${keys.join("、")}）。请把需要转正的内容写进 `
        + "entryRule.extra —— 那里是候选草稿唯一的具名扩展槽",
    );
  }
}

// ---------------------------------------------------------------------------
// 条件组：ResearchConditionSet → ConditionDefinition[]
// ---------------------------------------------------------------------------

function parameterCodes(parameterSpace: unknown): Set<string> {
  const record = optionalRecord(parameterSpace, "parameterSpace");
  return new Set(record === undefined ? [] : Object.keys(record));
}

/**
 * 「以字段引用开头」的**探测**正则 —— **只用于诊断定位，不是解析器**（解析器唯一权威实现 =
 * `parseStrategyFieldReference`）。命中的是**前缀**，允许后面还有内容。
 */
const FIELD_REFERENCE_LEADING_RE =
  /^(?:prefix\.rd-?\d+|post\.rd\d+|bar|event|path|outcome)\.[A-Za-z][A-Za-z0-9_]*/;

/** 「串里出现过字段引用」的探测正则（同上，只用于诊断定位）。 */
const FIELD_REFERENCE_TOKEN_RE =
  /(?:prefix\.rd-?\d+|post\.rd\d+|bar|event|path|outcome)\.[A-Za-z][A-Za-z0-9_]*/;

/**
 * 算术运算符探测。
 *
 * ⚠️ 含 `-` 是**故意**的：一个**普通字符串常量**（如 `"MAIN"` / `"2026-09-01"`）不会同时
 * 含「字段引用 + 运算符」，所以这条只在下面第二条规则里与字段引用**同时**命中才生效。
 */
const ARITHMETIC_OPERATOR_RE = /[*+\/-]/;

/**
 * 判定一个字符串是不是「算术表达式尝试」；是则返回用于错误信息定位的字段引用片段。
 *
 * 两条判据（**只认这两种**，避免误伤普通字符串常量）：
 *   ① 以合法字段引用开头、但整串不是合法引用（有多余尾巴）—— 如 `prefix.rd0.volume * 0.3`；
 *   ② 串里**同时**出现字段引用与算术运算符 —— 如 `(1 - 0.05) * prefix.rd0.close`。
 *
 * 反例（**必须放行**）：`"FIRST_LIMIT_UP"` / `"MAIN"` / `"2026-09-01"` / `"T+1"` ——
 * 它们不含字段引用、或（`T+1`）不含字段引用，因此两条都不命中。
 */
function expressionAttemptOf(text: string): string | null {
  const trimmed = text.trim();
  const leading = FIELD_REFERENCE_LEADING_RE.exec(trimmed);
  if (leading !== null && leading[0].length < trimmed.length) return leading[0];
  if (ARITHMETIC_OPERATOR_RE.test(trimmed) && FIELD_REFERENCE_TOKEN_RE.test(trimmed)) {
    const token = FIELD_REFERENCE_TOKEN_RE.exec(trimmed);
    return token === null ? trimmed : token[0];
  }
  return null;
}

/**
 * 右值属于「算术表达式尝试」（或字段引用笔误）⇒ 一律响亮失败
 * （详见 `resolveConditionValueType` 的注释）。
 *
 * `IN` / `NOT_IN` 的数组右值逐元素检查（不给数组留后门）。
 */
function rejectExpressionAttempt(value: unknown, path: string): void {
  const texts: readonly string[] = typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  for (const text of texts) {
    const token = expressionAttemptOf(text);
    if (token === null) continue;
    const derived = STRATEGY_DERIVED_BAR_FIELDS.map((name) => `bar.${name}`).join(" / ");
    invalid(
      path,
      `右值 ${JSON.stringify(text)} 不是合法字段引用、也不是已声明的参数 code，`
        + `但含字段引用 ${JSON.stringify(token)} 与算术运算符：这看起来是「字段 × 系数」的算术表达式，`
        + "而条件的右值**没有算术形态**（只有 常量 / 字段引用 / 参数引用 三种语法种类）。"
        + "Promote 拒绝把它静默降级成字符串常量，请改写为："
        + `① **派生字段**（在当前 bar 上相对事件日基准求值，与配方门槛同名同义）：${derived}；`
        + "② 或把系数写进 `parameterSpace` 做成参数，再用**参数引用**指向它"
        + "（例如 bar.volume LESS_THAN_OR_EQUAL max_volume_ratio）—— 转正后即可被 Parameter Search 搜索。",
    );
  }
}

/**
 * 解析条件的**右值类型**（`valueType`）。
 *
 * 这是「机械翻译」而非「猜测语义」：`valueType` 描述的是右值的**语法种类**，而本项目已有
 * 唯一权威的字段引用文法（`parseStrategyFieldReference`）与参数词表，因此它的种类是可判定的。
 * 判定顺序（确定性，已文档化）：可被字段引用文法解析 ⇒ `FIELD_REFERENCE`；
 * 命中候选参数 code ⇒ `PARAMETER_REFERENCE`；其余标量 ⇒ `CONSTANT`。
 *
 * 🔴 **2026-09-16 修正：取消「静默降级」**（`BRIDGE-CONDITION-EXPRESSION-001`）。
 *
 * 旧实现把「其余」一律降级成 `CONSTANT`，于是 `"prefix.rd0.volume * 0.3"` 这种**算术表达式**被原样
 * 写成一个**字符串常量** —— 数值字段与字符串常量比较（语义无意义），而且与配方门槛
 * （`volumeRatio <= max_volume_ratio`）**口径不一致**：声明说 A、执行做 B。这与本转换器一贯纪律
 * （「闭集，不静默忽略 / 不静默丢弃」）相悖，故改为**响亮失败**并要求作者改写（见上条错误信息）。
 */
function resolveConditionValueType(
  value: unknown,
  codes: ReadonlySet<string>,
  path: string,
): StrategyConditionValueType {
  if (typeof value === "string") {
    if (parseStrategyFieldReference(value).kind !== "unknown") return "FIELD_REFERENCE";
    if (codes.has(value)) return "PARAMETER_REFERENCE";
  }
  rejectExpressionAttempt(value, path);
  return "CONSTANT";
}

function buildConditions(filterRule: unknown, codes: ReadonlySet<string>): ConditionDefinition[] {
  if (filterRule === undefined || filterRule === null) return [];
  const set = asRecord(filterRule, "filterRule");
  try {
    assertConditionSet(filterRule as never);
  } catch (error) {
    invalid(
      "filterRule",
      `不是合法的 ResearchConditionSet：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const groups = set.groups;
  if (!Array.isArray(groups)) invalid("filterRule.groups", "必须是数组");
  const conditions: ConditionDefinition[] = [];
  (groups as unknown[]).forEach((rawGroup, groupIndex) => {
    const group = asRecord(rawGroup, `filterRule.groups[${groupIndex}]`);
    /**
     * 🔴 组间连接符必须为 AND（P0-1）。
     *
     * 研究侧的 `groupLogicalOperator` 支持 OR（`researchEngine/conditionEvaluator.ts:130` 会真算），
     * 而 `StrategyDefinition.ConditionDefinition` **没有逻辑运算符字段**（`strategySchema/definition.ts:461-472`）。
     * 原先这里**不读**该字段 ⇒ 用户写「A 或 B」在策略侧被**静默压成**「A 且 B」：条件变严、
     * 回测样本骤减、**不报错不留痕** —— 属语义篡改。⇒ 此处**响亮拒绝**，绝不静默降级。
     * ⚠️ 首个组没有前序，其 `groupLogicalOperator` 按引擎口径被忽略。
     */
    if (groupIndex > 0) {
      const groupOperator = group.groupLogicalOperator;
      if (typeof groupOperator === "string" && groupOperator !== "AND") {
        invalid(
          `filterRule.groups[${groupIndex}].groupLogicalOperator`,
          `策略侧条件只支持 AND 连接，实际为 ${JSON.stringify(groupOperator)}：`
            + "把「或」静默当成「且」会让条件变严、回测样本骤减且不报错（语义篡改），因此这里直接拒绝。"
            + "StrategyDefinition 的 ConditionDefinition 目前没有逻辑运算符字段，无法表达 OR/NOT；"
            + "请改写为单组 AND，或让研究侧只产出 AND 语义的条件。",
        );
      }
    }
    const rows = group.conditions;
    if (!Array.isArray(rows)) invalid(`filterRule.groups[${groupIndex}].conditions`, "必须是数组");
    (rows as unknown[]).forEach((rawRow, rowIndex) => {
      const path = `filterRule.groups[${groupIndex}].conditions[${rowIndex}]`;
      const row = asRecord(rawRow, path);
      // 🔴 组内连接符同样必须为 AND（P0-1）。首条无前序 ⇒ 按引擎口径忽略（`conditionEvaluator.ts:8`）。
      if (rowIndex > 0) {
        const rowOperator = row.logicalOperator;
        if (typeof rowOperator === "string" && rowOperator !== "AND") {
          invalid(
            `${path}.logicalOperator`,
            `第 ${rowIndex + 1} 条条件的组内连接符为 ${JSON.stringify(rowOperator)}，策略侧只支持 AND：`
              + "OR 会被静默当成 AND（条件变严、样本骤减且不报错）；NOT 亦无对应表达。"
              + "ConditionDefinition 没有逻辑运算符字段，请改写为 AND 语义。",
          );
        }
      }
      const field = requireNonEmptyString(row.fieldName, `${path}.fieldName`);
      /**
       * 字段引用必须是**既有权威文法**可解析的引用（`prefix.rd-1.close` / `event.turnover` / `bar.close`）。
       *
       * 这里做的是**语法**判定，不做语义改写：草稿写 `turnover` 我们**不会**替它猜成
       * `prefix.rd0.turnover`（那正是 §8 禁止的「猜测」），而是点名它必须写成哪一种引用。
       * 语义层（字段是否在白名单 / Look-Ahead L1–L8）交给既能校验器，职责不重叠。
       */
      if (parseStrategyFieldReference(field).kind === "unknown") {
        /**
         * 🔴 研究侧变量名（P0-2 / P0-3）：两侧不是**改名关系**而是**语义关系**。
         *
         * 研究侧条件名（如 `pullback_holds_event_open_2d`）与策略侧字段引用（如 `bar.haircutFromEventLow`）
         * 之间**没有翻译层**：策略引用必含 `.`，不含点的基本就是研究侧变量名。
         * 而且二者**语义常常不同构** —— 研究侧可能是「T+1..T+k 全程不破」的**窗口布尔**，
         * 策略侧 `haircutFromEventLow` 是**单日**连续量。机械翻译会**静默引入语义错误**，
         * 所以这里不猜、也不翻译，只把事实摆清楚，由人决定用哪个策略字段表达。
         */
        const looksLikeResearchVariable = !field.includes(".");
        invalid(
          `${path}.fieldName`,
          `必须写成 Strategy 字段引用（如 prefix.rd-1.close / event.turnover / bar.close），`
            + `实际：${JSON.stringify(field)}；Promote 不会替你猜字段属于哪个时间域。`
            + (looksLikeResearchVariable
                ? `⚠️ \`${field}\` 看起来是**研究侧变量名**（策略引用一定含 "."）：两侧没有自动翻译，`
                  + "且语义常常不同构（研究侧「T+1..T+k 全程不破」是窗口布尔，策略侧 bar.haircutFromEventLow 是单日连续量）"
                  + "⇒ 必须由你决定用哪个策略字段表达，Promote 不做机械翻译。"
                : ""),
        );
      }
      const rawOperator = requireNonEmptyString(row.operator, `${path}.operator`);
      const operator = CONDITION_OPERATOR_MAP[rawOperator];
      if (operator === undefined) {
        invalid(
          `${path}.operator`,
          `Research 操作符 ${JSON.stringify(rawOperator)} 在 StrategyDefinition 词表中没有对应值`
            + "（Strategy 侧只支持 " + Object.keys(CONDITION_OPERATOR_MAP).join(" / ") + "）；"
            + "不支持的操作符不会被静默降级",
        );
      }
      conditions.push({
        field,
        operator,
        value: row.value as ConditionDefinition["value"],
        valueType: resolveConditionValueType(row.value, codes, `${path}.value`),
        enabled: true,
        ...(typeof row.note === "string" && row.note.trim() !== "" ? { description: row.note.trim() } : {}),
      });
    });
  });
  return conditions;
}

// ---------------------------------------------------------------------------
// 参数空间：ResearchParameterSpace → ParameterDefinition[]
// ---------------------------------------------------------------------------

function buildParameters(parameterSpace: unknown): ParameterDefinition[] {
  const record = optionalRecord(parameterSpace, "parameterSpace");
  if (record === undefined) return [];
  const definitions: ParameterDefinition[] = [];
  for (const code of Object.keys(record).sort()) {
    const path = `parameterSpace.${code}`;
    const spec = asRecord(record[code], path);
    const dataType = requireEnum(spec.type, ["number", "string", "boolean"] as const, `${path}.type`);
    /**
     * 🔴 参数角色（2026-09-17 新增，PATTERN-LIBRARY-001）。
     *
     * 迁移前本函数把 `parameterRole` **恒置为 `TUNABLE`** ⇒ 草稿里声明为「固定」的参数
     * 只要带了 min/max/step 就会被 Parameter Search 搜索，而结果看起来完全正常 ——
     * 这是「声明了却对计算毫无影响」的静默失效（`RESEARCH-STRATEGY-GAP-AUDIT-001.md` P1-1）。
     *
     * 现在草稿可显式给出 `parameterRole`；**缺省仍是 `TUNABLE`**
     * ⇒ 既有草稿（无该键）行为逐字不变，零回归。
     */
    const parameterRole: StrategyParameterRole =
      spec.parameterRole === undefined
        ? "TUNABLE"
        : requireEnum(spec.parameterRole, STRATEGY_PARAMETER_ROLES, `${path}.parameterRole`);
    const allowedRaw = spec.allowedValues;
    let allowedValues: string[] | undefined;
    if (allowedRaw !== undefined && allowedRaw !== null) {
      if (!Array.isArray(allowedRaw)) invalid(`${path}.allowedValues`, "必须是数组");
      const items = allowedRaw as unknown[];
      if (items.some((item) => typeof item !== "string")) {
        invalid(
          `${path}.allowedValues`,
          "StrategyDefinition 的 allowedValues 只接受字符串（number / boolean 请用 min / max / step 表达）",
        );
      }
      allowedValues = items as string[];
    }
    /**
     * 角色恒为 `TUNABLE` ⇒ 必须满足既有校验器的 TUNABLE 完整性要求
     * （`SCHEMA_DEFINITION_PARAMETER_ROLE_TUNABLE_RANGE`：数值参数要有 min ∧ max，
     * 非数值参数要有非空 allowedValues）。**在这里提前响亮失败**，
     * 比让它到 definition 校验阶段变成一句结构性错误更容易定位；同样**不补默认范围**。
     */
    // 范围完整性只对**待搜索**（TUNABLE）参数成立：FIXED / DERIVED 参数不进搜索空间，
    // 要求它们给出 min/max 反而是错的（把「固定值」逼成「带范围的待搜值」）。
    if (parameterRole === "TUNABLE") {
      if (dataType === "number") {
        if (spec.min === undefined || spec.max === undefined) {
          incomplete(
            `${path}.min / ${path}.max`,
            "TUNABLE（待 Parameter Search）参数的范围必须由草稿声明 —— "
              + "数值参数要同时给出 min 与 max，Promote 不会替你给搜索空间定界",
          );
        }
      } else if (allowedValues === undefined || allowedValues.length === 0) {
        incomplete(
          `${path}.allowedValues`,
          `TUNABLE 的非数值参数（${dataType}）必须声明非空 allowedValues（搜索候选集合）`,
        );
      }
    }

    /**
     * 🔴 **`defaultValue` 是执行层的必需输入，不是装饰**（2026-09-13 新增）：
     * 运行工作台装配时 `StrategyRecipeRuntime.resolveParameters(schema)` 取**每个参数的
     * `defaultValue`** 作为本次运行的参数集；缺 `defaultValue` ⇒ 抛 `RECIPE_PARAMETER_NO_DEFAULT`。
     * 此前本函数**不透传** `defaultValue`（草稿写了也被静默丢弃）⇒ 带门槛参数的配方
     * （如「守线 + 缩量 ≤ X%」）转正后**一定会运行失败**。
     *
     * 这里做**类型与范围**校验后原样透传（**不替草稿补默认值** —— 缺失仍然缺失，
     * 由 `resolveParameters` 在运行时响亮失败，而不是在这里编一个值）。
     */
    let defaultValue: ResearchParameterValue | undefined;
    if (spec.defaultValue !== undefined && spec.defaultValue !== null) {
      if (dataType === "number") {
        defaultValue = requireFiniteNumber(spec.defaultValue, `${path}.defaultValue`);
      } else if (dataType === "boolean") {
        if (typeof spec.defaultValue !== "boolean") {
          invalid(`${path}.defaultValue`, `boolean 参数的默认值必须是布尔值，实际：${typeof spec.defaultValue}`);
        }
        defaultValue = spec.defaultValue;
      } else {
        if (typeof spec.defaultValue !== "string") {
          invalid(`${path}.defaultValue`, `string 参数的默认值必须是字符串，实际：${typeof spec.defaultValue}`);
        }
        defaultValue = spec.defaultValue;
      }
      const min = spec.min === undefined ? undefined : requireFiniteNumber(spec.min, `${path}.min`);
      const max = spec.max === undefined ? undefined : requireFiniteNumber(spec.max, `${path}.max`);
      if (typeof defaultValue === "number") {
        if (min !== undefined && defaultValue < min) {
          invalid(`${path}.defaultValue`, `默认值 ${defaultValue} 小于 min ${min}`);
        }
        if (max !== undefined && defaultValue > max) {
          invalid(`${path}.defaultValue`, `默认值 ${defaultValue} 大于 max ${max}`);
        }
      }
      if (allowedValues !== undefined && typeof defaultValue === "string" && !allowedValues.includes(defaultValue)) {
        invalid(`${path}.defaultValue`, `默认值 ${JSON.stringify(defaultValue)} 不在 allowedValues 内`);
      }
    }

    definitions.push({
      code,
      name: code,
      dataType,
      /**
       * 🔴 草稿参数默认是**待搜空间**（Research 只声明、不搜索），缺省角色 `TUNABLE` ——
       * 这正是 006.0 §14 的技术要点 2：不许把「回测最优值」固化成正式规则而让搜索空间提前坍缩。
       * 但**草稿可以显式声明 `FIXED`**（见上方 `parameterRole` 的取值逻辑）：那时它不进搜索空间。
       */
      parameterRole,
      ...(spec.min === undefined ? {} : { min: requireFiniteNumber(spec.min, `${path}.min`) }),
      ...(spec.max === undefined ? {} : { max: requireFiniteNumber(spec.max, `${path}.max`) }),
      ...(spec.step === undefined ? {} : { step: requireFiniteNumber(spec.step, `${path}.step`) }),
      ...(allowedValues === undefined ? {} : { allowedValues }),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      required: false,
      description: `由候选草稿 parameterSpace.${code} 声明（待 Parameter Search 搜索）`,
    });
  }
  return definitions;
}

// ---------------------------------------------------------------------------
// 主转换
// ---------------------------------------------------------------------------

export interface DefinitionBuildInput {
  readonly candidate: ResearchStrategyCandidate;
  /**
   * **执行** Dataset 绑定（≠ 研究来源；缺省时两者相同，见 006.0 §9.2 / 006.3 §11 / §30）。
   * 由调用方（`promote`）先经 Dataset Registry 校验后注入 —— 本函数不查库。
   */
  readonly executionDataset: {
    readonly datasetVersionId: number;
    /** Dataset Registry 的 `dataset_version.version`（`v1` / `v2`）——label，不是坐标。 */
    readonly datasetVersionLabel: string;
    /** Dataset Registry 的 `dataset_definition.datasetCode`（如 `first_limit_pullback`）。 */
    readonly datasetCode: string;
  };
}

/**
 * `Candidate → StrategyDefinition`（**唯一实现**；纯函数、确定性、无副作用）。
 *
 * 失败语义（006.3 §8 / §10）：
 *   - 缺必填 ⇒ `PROMOTE_SKETCH_INCOMPLETE`；内容非法 / 词表不支持 ⇒ `PROMOTE_SKETCH_INVALID`；
 *   - 两者都**不是**「降级处理」：调用方必须回去补草稿，而不是让 Service 猜。
 *
 * ⚠️ 本函数**不做** `StrategyDefinition` 校验 —— 校验是下一步（`promote` 调用既有
 * `validateCanonicalStrategyDefinition`）。构造与校验分离，保证「构建成功 ≠ 合法」。
 */
export function buildStrategyDefinition(input: DefinitionBuildInput): StrategyDefinitionInput {
  const { candidate, executionDataset } = input;

  // ---- entryRule：必填（事件类型 + 入场时点）----
  const entryRule = requireRecord(candidate.entryRule, "entryRule");
  const eventType = requireEnum(entryRule.event, STRATEGY_EVENT_TYPES, "entryRule.event");
  const rawTiming = requireNonEmptyString(entryRule.timing, "entryRule.timing");
  const timing = ENTRY_TIMING_TO_EXECUTION[rawTiming];
  if (timing === undefined) {
    invalid(
      "entryRule.timing",
      `未知入场时点 ${JSON.stringify(rawTiming)}（只支持 ${Object.keys(ENTRY_TIMING_TO_EXECUTION).join(" / ")}）`,
    );
  }

  // ---- 扩展槽（闭集）----
  const extra = optionalRecord(entryRule.extra, "entryRule.extra") ?? {};
  assertExtensionKeys(extra, "entryRule.extra");

  // observationWindow（必填；单位必须显式声明，禁默认）
  const windowRaw = requireRecord(extra.observationWindow, "entryRule.extra.observationWindow");
  const start = requireFiniteNumber(windowRaw.start, "entryRule.extra.observationWindow.start");
  const end = requireFiniteNumber(windowRaw.end, "entryRule.extra.observationWindow.end");
  const unit = requireEnum(windowRaw.unit, STRATEGY_WINDOW_UNITS, "entryRule.extra.observationWindow.unit") as StrategyWindowUnit;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    invalid(
      "entryRule.extra.observationWindow",
      `必须满足 start >= 1 且 end >= start 的整数（实际 start=${start} / end=${end}）`,
    );
  }

  // trigger（必填；支持字符串简写或对象）
  const triggerRaw = extra.trigger;
  const triggerType = requireEnum(
    typeof triggerRaw === "object" && triggerRaw !== null && !Array.isArray(triggerRaw)
      ? (triggerRaw as Record<string, unknown>).type
      : triggerRaw,
    STRATEGY_TRIGGER_TYPES,
    "entryRule.extra.trigger",
  );

  // eventParams（可选）
  let eventParams: Record<string, string | number | boolean> | undefined;
  if (extra.eventParams !== undefined && extra.eventParams !== null) {
    const raw = asRecord(extra.eventParams, "entryRule.extra.eventParams");
    const out: Record<string, string | number | boolean> = {};
    for (const key of Object.keys(raw).sort()) {
      const value = raw[key];
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        invalid(`entryRule.extra.eventParams.${key}`, `只允许字符串 / 数字 / 布尔，实际：${describe(value)}`);
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        invalid(`entryRule.extra.eventParams.${key}`, "数字必须是有限值");
      }
      out[key] = value;
    }
    if (Object.keys(out).length > 0) eventParams = out;
  }

  // execution（必填：quantityMethod + lotSize）
  const executionRaw = requireRecord(extra.execution, "entryRule.extra.execution");
  const quantityMethod = requireEnum(executionRaw.quantityMethod, STRATEGY_QUANTITY_METHODS, "entryRule.extra.execution.quantityMethod");
  const lotSize = requireFiniteNumber(executionRaw.lotSize, "entryRule.extra.execution.lotSize");
  if (!Number.isInteger(lotSize) || lotSize <= 0) {
    invalid("entryRule.extra.execution.lotSize", `必须是正整数，实际：${lotSize}`);
  }
  const slippageModel = executionRaw.slippageModel === undefined || executionRaw.slippageModel === null
    ? undefined
    : requireEnum(executionRaw.slippageModel, STRATEGY_COST_MODELS, "entryRule.extra.execution.slippageModel");
  const commissionModel = executionRaw.commissionModel === undefined || executionRaw.commissionModel === null
    ? undefined
    : requireEnum(executionRaw.commissionModel, STRATEGY_COST_MODELS, "entryRule.extra.execution.commissionModel");
  let executionConstraints: string[] | undefined;
  if (executionRaw.executionConstraints !== undefined && executionRaw.executionConstraints !== null) {
    if (!Array.isArray(executionRaw.executionConstraints)) {
      invalid("entryRule.extra.execution.executionConstraints", "必须是字符串数组");
    }
    const items = executionRaw.executionConstraints as unknown[];
    if (items.some((item) => typeof item !== "string" || item.trim() === "")) {
      invalid("entryRule.extra.execution.executionConstraints", "元素必须是非空字符串");
    }
    if (items.length > 0) executionConstraints = items as string[];
  }

  // ---- filterRule → entry.conditions ----
  const codes = parameterCodes(candidate.parameterSpace);
  const conditions = buildConditions(candidate.filterRule, codes);

  // ---- exitRule → exit.rules ----
  const exitRules: ExitRuleDefinition[] = [];
  if (candidate.exitRule !== undefined && candidate.exitRule !== null) {
    const exitRule = asRecord(candidate.exitRule, "exitRule");
    assertUnusedExtra(exitRule.extra, "exitRule.extra");
    if (exitRule.stopLoss !== undefined && exitRule.stopLoss !== null) {
      const stopLoss = requireFiniteNumber(exitRule.stopLoss, "exitRule.stopLoss");
      if (stopLoss <= 0 || stopLoss >= 1) invalid("exitRule.stopLoss", `必须是 (0,1) 的比例，实际：${stopLoss}`);
      exitRules.push({
        id: EXIT_REALIZATION.STOP_LOSS.id,
        type: "STOP_LOSS",
        trigger: EXIT_REALIZATION.STOP_LOSS.trigger,
        threshold: stopLoss,
        thresholdUnit: "RATIO",
        priority: EXIT_REALIZATION.STOP_LOSS.priority,
        enabled: true,
        description: `止损：亏损达 ${stopLoss} 时触发（来源：候选草稿 exitRule.stopLoss）`,
      });
    }
    if (exitRule.takeProfit !== undefined && exitRule.takeProfit !== null) {
      const takeProfit = requireFiniteNumber(exitRule.takeProfit, "exitRule.takeProfit");
      if (takeProfit <= 0) invalid("exitRule.takeProfit", `必须是正比例，实际：${takeProfit}`);
      exitRules.push({
        id: EXIT_REALIZATION.TAKE_PROFIT.id,
        type: "TAKE_PROFIT",
        trigger: EXIT_REALIZATION.TAKE_PROFIT.trigger,
        threshold: takeProfit,
        thresholdUnit: "RATIO",
        priority: EXIT_REALIZATION.TAKE_PROFIT.priority,
        enabled: true,
        description: `止盈：收益达 ${takeProfit} 时触发（来源：候选草稿 exitRule.takeProfit）`,
      });
    }
    if (exitRule.holdingDays !== undefined && exitRule.holdingDays !== null) {
      const holdingDays = requireFiniteNumber(exitRule.holdingDays, "exitRule.holdingDays");
      if (!Number.isInteger(holdingDays) || holdingDays <= 0) {
        invalid("exitRule.holdingDays", `必须是正整数交易日，实际：${holdingDays}`);
      }
      exitRules.push({
        id: EXIT_REALIZATION.TIME_EXIT.id,
        type: "TIME_EXIT",
        trigger: EXIT_REALIZATION.TIME_EXIT.trigger,
        threshold: holdingDays,
        thresholdUnit: "TRADING_DAY",
        priority: EXIT_REALIZATION.TIME_EXIT.priority,
        enabled: true,
        description: `时间出场：持有 ${holdingDays} 个交易日后退出（来源：候选草稿 exitRule.holdingDays）`,
      });
    }
  }

  // ---- riskRule → position.maxPositions（必填）+ position 扩展 ----
  const riskRule = requireRecord(candidate.riskRule, "riskRule");
  assertUnusedExtra(riskRule.extra, "riskRule.extra");
  if (riskRule.regimeGate !== undefined && riskRule.regimeGate !== null) {
    invalid(
      "riskRule.regimeGate",
      "StrategyDefinition 的 risk 段没有条件组字段（Research 的市场环境闸门无法无损落入 Strategy 词表）；"
        + "不会被静默丢弃，请先把它表达成 entry.conditions 或 RiskDefinition.extensions 中的具名阈值",
    );
  }
  if (riskRule.maxPositions === undefined || riskRule.maxPositions === null) {
    incomplete("riskRule.maxPositions", "position.maxPositions 是 StrategyDefinition 的必填项，只能来自候选草稿");
  }
  const maxPositions = requireFiniteNumber(riskRule.maxPositions, "riskRule.maxPositions");
  if (!Number.isInteger(maxPositions) || maxPositions < 1) {
    invalid("riskRule.maxPositions", `必须是 >= 1 的整数，实际：${maxPositions}`);
  }

  const positionRaw = requireRecord(extra.position, "entryRule.extra.position");
  if (positionRaw.maxPositions !== undefined && positionRaw.maxPositions !== null) {
    invalid(
      "entryRule.extra.position.maxPositions",
      "maxPositions 的唯一权威是候选草稿的 riskRule.maxPositions（禁止两处声明同一事实）",
    );
  }
  // 单标的上限只能有一个来源：`riskRule.maxPositionWeight`（Research 词表）或显式扩展槽，二者互斥。
  const hasWeight = riskRule.maxPositionWeight !== undefined && riskRule.maxPositionWeight !== null;
  const hasSingle = positionRaw.maxSinglePosition !== undefined && positionRaw.maxSinglePosition !== null;
  if (hasWeight && hasSingle) {
    invalid(
      "entryRule.extra.position.maxSinglePosition",
      "与 riskRule.maxPositionWeight 重复声明同一事实（单标的仓位上限），只能二选一",
    );
  }
  const singlePositionLimit = hasSingle
    ? requireFiniteNumber(positionRaw.maxSinglePosition, "entryRule.extra.position.maxSinglePosition")
    : hasWeight
      ? requireFiniteNumber(riskRule.maxPositionWeight, "riskRule.maxPositionWeight")
      : undefined;
  const position = {
    sizingMethod: requireEnum(positionRaw.sizingMethod, STRATEGY_POSITION_SIZING_METHODS, "entryRule.extra.position.sizingMethod"),
    maxPositions,
    ...(positionRaw.positionRatio === undefined || positionRaw.positionRatio === null
      ? {}
      : { positionRatio: requireFiniteNumber(positionRaw.positionRatio, "entryRule.extra.position.positionRatio") }),
    ...(positionRaw.fixedAmount === undefined || positionRaw.fixedAmount === null
      ? {}
      : { fixedAmount: requireFiniteNumber(positionRaw.fixedAmount, "entryRule.extra.position.fixedAmount") }),
    ...(positionRaw.maxExposure === undefined || positionRaw.maxExposure === null
      ? {}
      : { maxExposure: requireFiniteNumber(positionRaw.maxExposure, "entryRule.extra.position.maxExposure") }),
    ...(singlePositionLimit === undefined ? {} : { maxSinglePosition: singlePositionLimit }),
  };

  // ---- risk 扩展（可选）----
  let risk: StrategyDefinitionInput["risk"];
  if (extra.risk !== undefined && extra.risk !== null) {
    const raw = asRecord(extra.risk, "entryRule.extra.risk");
    let extensions: Record<string, number | string | boolean> | undefined;
    if (raw.extensions !== undefined && raw.extensions !== null) {
      const ext = asRecord(raw.extensions, "entryRule.extra.risk.extensions");
      const out: Record<string, number | string | boolean> = {};
      for (const key of Object.keys(ext).sort()) {
        const value = ext[key];
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
          invalid(`entryRule.extra.risk.extensions.${key}`, `只允许字符串 / 数字 / 布尔，实际：${describe(value)}`);
        }
        out[key] = value;
      }
      if (Object.keys(out).length > 0) extensions = out;
    }
    risk = {
      ...(raw.stopLoss === undefined || raw.stopLoss === null
        ? {}
        : { stopLoss: requireFiniteNumber(raw.stopLoss, "entryRule.extra.risk.stopLoss") }),
      ...(raw.maxDrawdown === undefined || raw.maxDrawdown === null
        ? {}
        : { maxDrawdown: requireFiniteNumber(raw.maxDrawdown, "entryRule.extra.risk.maxDrawdown") }),
      ...(raw.maxExposure === undefined || raw.maxExposure === null
        ? {}
        : { maxExposure: requireFiniteNumber(raw.maxExposure, "entryRule.extra.risk.maxExposure") }),
      ...(raw.maxSinglePosition === undefined || raw.maxSinglePosition === null
        ? {}
        : { maxSinglePosition: requireFiniteNumber(raw.maxSinglePosition, "entryRule.extra.risk.maxSinglePosition") }),
      ...(raw.maxPositions === undefined || raw.maxPositions === null
        ? {}
        : { maxPositions: requireFiniteNumber(raw.maxPositions, "entryRule.extra.risk.maxPositions") }),
      ...(raw.dailyLossLimit === undefined || raw.dailyLossLimit === null
        ? {}
        : { dailyLossLimit: requireFiniteNumber(raw.dailyLossLimit, "entryRule.extra.risk.dailyLossLimit") }),
      ...(raw.concentrationLimit === undefined || raw.concentrationLimit === null
        ? {}
        : { concentrationLimit: requireFiniteNumber(raw.concentrationLimit, "entryRule.extra.risk.concentrationLimit") }),
      ...(extensions === undefined ? {} : { extensions }),
    };
  } else {
    risk = {};
  }

  // ---- Dataset 绑定（PRIMARY = **执行** Dataset；研究来源只进 provenance）----
  const datasets: StrategyDatasetBinding[] = [
    {
      datasetId: executionDataset.datasetCode,
      datasetVersionId: executionDataset.datasetVersionId,
      datasetVersion: executionDataset.datasetVersionLabel,
      role: "PRIMARY",
      note: "由 RESEARCH-006.3 promote 绑定（唯一坐标 dataset_version.id）",
    },
  ];

  return {
    schemaVersion: STRATEGY_DEFINITION_SCHEMA_VERSION,
    entry: {
      event: {
        type: eventType,
        ...(eventParams === undefined ? {} : { params: eventParams }),
        description: `事件类型来自候选草稿 entryRule.event=${eventType}`,
      },
      observationWindow: { start, end, unit },
      conditions,
      trigger: {
        type: triggerType,
        description: "触发时点来自候选草稿 entryRule.extra.trigger",
      },
    },
    exit: { rules: exitRules },
    position,
    risk,
    execution: {
      signalTiming: timing.signalTiming,
      executionTiming: timing.executionTiming,
      priceType: timing.priceType,
      quantityMethod,
      lotSize,
      ...(slippageModel === undefined ? {} : { slippageModel }),
      ...(commissionModel === undefined ? {} : { commissionModel }),
      ...(executionConstraints === undefined ? {} : { executionConstraints }),
    },
    parameters: buildParameters(candidate.parameterSpace),
    datasets,
  } as StrategyDefinitionInput;
}

/**
 * 由候选草稿 + 执行 Dataset 解出 **StrategyDocument 级**的非派生字段。
 *
 * `backtestConfig` / `costModel` 无法从 `definition` 派生（`map.ts#alignDefinitionViews` 明确要求显式提供），
 * 因此它们同样只能来自候选草稿 —— 本函数把「读草稿」这一步也固定成纯函数，便于单测。
 */
export function buildExecutionAssumptions(candidate: ResearchStrategyCandidate): {
  backtestConfig: { initialCapital: number; maxPositions?: number };
  costModel: {
    commissionRate: number;
    stampDutyRate: number;
    transferFeeRate: number;
    slippageBps: number;
    lotSize: number;
    minCommission: number;
  };
} {
  const entryRule = requireRecord(candidate.entryRule, "entryRule");
  const extra = optionalRecord(entryRule.extra, "entryRule.extra") ?? {};
  const documentRaw = requireRecord(extra.document, "entryRule.extra.document");
  const backtestRaw = requireRecord(documentRaw.backtestConfig, "entryRule.extra.document.backtestConfig");
  const costRaw = requireRecord(documentRaw.costModel, "entryRule.extra.document.costModel");
  const initialCapital = requireFiniteNumber(
    backtestRaw.initialCapital,
    "entryRule.extra.document.backtestConfig.initialCapital",
  );
  if (initialCapital <= 0) {
    invalid("entryRule.extra.document.backtestConfig.initialCapital", `必须 > 0，实际：${initialCapital}`);
  }
  const maxPositionsRaw = backtestRaw.maxPositions;
  let maxPositions: number | undefined;
  if (maxPositionsRaw !== undefined && maxPositionsRaw !== null) {
    const value = requireFiniteNumber(maxPositionsRaw, "entryRule.extra.document.backtestConfig.maxPositions");
    if (!Number.isInteger(value) || value < 1) {
      invalid("entryRule.extra.document.backtestConfig.maxPositions", `必须是 >= 1 的整数，实际：${value}`);
    }
    maxPositions = value;
  }
  return {
    backtestConfig: {
      initialCapital,
      ...(maxPositions === undefined ? {} : { maxPositions }),
    },
    costModel: {
      commissionRate: requireFiniteNumber(costRaw.commissionRate, "entryRule.extra.document.costModel.commissionRate"),
      stampDutyRate: requireFiniteNumber(costRaw.stampDutyRate, "entryRule.extra.document.costModel.stampDutyRate"),
      transferFeeRate: requireFiniteNumber(costRaw.transferFeeRate, "entryRule.extra.document.costModel.transferFeeRate"),
      slippageBps: requireFiniteNumber(costRaw.slippageBps, "entryRule.extra.document.costModel.slippageBps"),
      lotSize: requireFiniteNumber(costRaw.lotSize, "entryRule.extra.document.costModel.lotSize"),
      minCommission: requireFiniteNumber(costRaw.minCommission, "entryRule.extra.document.costModel.minCommission"),
    },
  };
}

/**
 * `StrategyDocument` 的 universe 派生（**结构性**，不是策略决策）。
 *
 * 本项目已有唯一权威派生式 `deriveDatasetUniverseId(datasetVersion) = "research-dataset:<label>"`
 * （`server/research/datasetAccess/handle.ts`）。这里**复用同一口径的字面量**，让
 * `validate.ts#checkUniverse` 的派生一致性判据成立；不引入静态 members（数据集决定成分）。
 */
export function deriveUniverseIdForDataset(executionDatasetLabel: string): string {
  return `research-dataset:${executionDatasetLabel}`;
}

/** 由候选 id 派生策略身份（确定性；见 006.3 实施报告「为何不按 name 派生」）。 */
export function deriveStrategyId(candidateId: number): string {
  return `cand-${candidateId}`;
}

/**
 * 由候选草稿解出 **`StrategyRecipe`**（可序列化执行配方引用）。
 *
 * 🔴 为什么需要这一步（2026-09-13）：`recipe` 是策略文档里唯一能让装配层解析到**真实可执行
 * 实例**的钥匙。缺 `recipe` 时 `requireRecipe()` 只能落到 `DEFAULT_STRATEGY_RECIPE_ID`
 * （=「按涨跌幅取前 5 名」）⇒ **声明「守线 + 缩量」的策略在回测里跑的是别的东西**。
 *
 * 与 `buildExecutionAssumptions` 同性质：纯函数、从草稿读、缺什么就**响亮失败**（不猜）。
 * 放在 `entryRule.extra.recipe`（候选草稿唯一的具名扩展槽）。
 *
 * 返回 `undefined` 表示草稿**未声明**配方。此时不报错 —— 既有候选（如 #270001）本就没有该槽，
 * 强制要求会让它们无法重新 promote。但调用方（`promote`）必须把「未声明配方」这一事实
 * 如实写进 provenance / 版本记录，且**装配层会在缺 recipe 时用默认配方**（口径漂移风险
 * 由 `assembly.recipeSource` 显式暴露，不静默）。
 */
export function buildStrategyRecipe(candidate: ResearchStrategyCandidate): StrategyRecipe | undefined {
  const entryRule = requireRecord(candidate.entryRule, "entryRule");
  const extra = optionalRecord(entryRule.extra, "entryRule.extra") ?? {};
  const raw = optionalRecord(extra.recipe, "entryRule.extra.recipe");
  if (raw === undefined) return undefined;

  const kind = requireEnum(raw.kind, ["signalEngine"] as const, "entryRule.extra.recipe.kind");
  const recipeId = requireNonEmptyString(raw.recipeId, "entryRule.extra.recipe.recipeId");
  const point = requireEnum(raw.point, ["open", "close"] as const, "entryRule.extra.recipe.point");
  const signalFrequency = requireEnum(
    raw.signalFrequency,
    ["daily", "weekly", "intraday"] as const,
    "entryRule.extra.recipe.signalFrequency",
  );

  const featureVersionsRaw = raw.featureVersions;
  if (!Array.isArray(featureVersionsRaw)) {
    incomplete("entryRule.extra.recipe.featureVersions", "必须是数组（featureId → version）");
  }
  const featureVersions = (featureVersionsRaw as unknown[]).map((item, index) => {
    const path = `entryRule.extra.recipe.featureVersions[${index}]`;
    const record = asRecord(item, path);
    return {
      featureId: requireNonEmptyString(record.featureId, `${path}.featureId`),
      version: requireNonEmptyString(record.version, `${path}.version`),
    };
  });

  const requiredDataRaw = raw.requiredData;
  if (!Array.isArray(requiredDataRaw)) {
    incomplete("entryRule.extra.recipe.requiredData", "必须是字符串数组（数据域，如 OHLCV）");
  }
  const requiredData = (requiredDataRaw as unknown[]).map((item, index) =>
    requireNonEmptyString(item, `entryRule.extra.recipe.requiredData[${index}]`),
  );

  const rankingConfig = requireRecord(raw.rankingConfig, "entryRule.extra.recipe.rankingConfig");
  const higherIsBetter = rankingConfig.higherIsBetter;
  if (typeof higherIsBetter !== "boolean") {
    invalid("entryRule.extra.recipe.rankingConfig.higherIsBetter", "必须是布尔值");
  }

  const selectionConfig = requireRecord(raw.selectionConfig, "entryRule.extra.recipe.selectionConfig");
  const method = requireRecord(selectionConfig.method, "entryRule.extra.recipe.selectionConfig.method");
  const methodKind = requireEnum(
    method.kind,
    ["topN", "topPercentile"] as const,
    "entryRule.extra.recipe.selectionConfig.method.kind",
  );
  const resolvedMethod = methodKind === "topN"
    ? { kind: "topN" as const, n: requireFiniteNumber(method.n, "entryRule.extra.recipe.selectionConfig.method.n") }
    : { kind: "topPercentile" as const, pct: requireFiniteNumber(method.pct, "entryRule.extra.recipe.selectionConfig.method.pct") };

  return {
    kind,
    recipeId,
    point,
    signalFrequency,
    ...(typeof raw.signalDescription === "string" && raw.signalDescription.trim() !== ""
      ? { signalDescription: raw.signalDescription.trim() }
      : {}),
    featureVersions,
    rankingConfig: { higherIsBetter },
    selectionConfig: { method: resolvedMethod },
    requiredData,
  };
}

/** promote 产出的首个版本号（006.0 §11.3：缺省 `1.0.0`）。 */
export const PROMOTE_INITIAL_STRATEGY_VERSION = "1.0.0";

/** promote 产出的版本初始生命周期状态（C-21.1 genesis 白名单内的 `Draft`）。 */
export const PROMOTE_INITIAL_VERSION_STATUS = "Draft";

/**
 * `StrategyDefinition` 校验（006.3 §10：**build 之后必须 validate**）。
 *
 * 复用既有唯一校验器：`normalizeStrategyDefinition`（确定性顺序 + 补齐 id）→
 * `validateCanonicalStrategyDefinition`（结构 + Look-Ahead L1–L8 静态规则）。
 *
 * 🔴 校验失败 ⇒ `PROMOTE_DEFINITION_INVALID`，**不产生任何 Strategy 数据**，候选保持 `ACCEPTED`。
 * 也**不**尝试「修一下让它过」：不补字段、不删字段、不降级校验。
 */
export function validateBuiltStrategyDefinition(
  definition: StrategyDefinitionInput,
): StrategyDefinition {
  const normalized = normalizeStrategyDefinition(definition);
  const result = validateCanonicalStrategyDefinition(normalized);
  if (!result.valid) {
    throw new StrategyCandidateError(
      STRATEGY_CANDIDATE_ERROR.PROMOTE_DEFINITION_INVALID,
      "构建出的 StrategyDefinition 未通过既有校验（结构 + Look-Ahead L1–L8）："
        + result.issues.map((item) => `[${item.code}] ${item.path} — ${item.message}`).join("；"),
      {
        issues: result.issues.map((item) => ({
          code: item.code,
          path: item.path,
          message: item.message,
        })),
      },
    );
  }
  return normalized;
}
