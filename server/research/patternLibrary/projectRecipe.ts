/**
 * PATTERN-LIBRARY-001 — 把交易模式声明**投影成执行侧配方定义**。
 *
 * 这是「声明（纯数据）→ 可执行实例（含函数）」的**唯一实现**。所有模式共用这一份投影，
 * 禁止在别处再写一套（那会让「同一份声明产出不同配方」重新变得可能）。
 *
 * ## 三条硬纪律
 *
 * 1. **特征 id 只有一份映射**：声明里写的是**语义键**（`"haircut"`），真实 `featureId`
 *    一律经 `PATTERN_FEATURE_ID_BY_KEY` 从 `recipeRegistryAtoms` 的常量取
 *    （`PULLBACK_FEATURE_IDS` / `PCT_CHANGE_FEATURE_ID`）。改名只需改常量，本文件自动跟随；
 *    若某语义键没有映射，**响亮抛错**（不猜、不落空字符串）。
 *
 * 2. **参数按声明顺序先全部取出**：`buildGates` 闭包在构造门槛之前，先遍历
 *    `execution.parameters` 逐个 `requireNumericParameter` —— 这与迁移前
 *    `buildPullbackGates` 的执行顺序**逐字一致**（空参数集会先抛第一个参数，
 *    而不是第一个用到它的门槛）。顺序变了，错误消息就变了。
 *
 * 3. **门槛的启用条件按数据判定**：`enabledWhen` 缺省即恒启用；「红盘」门槛
 *    仅在 `requireBullish >= 1` 时才入列 —— 把迁移前 `if (requireBullish >= 1) push(...)`
 *    的语义**原样**保留在数据里，而不是压成「恒启用」。
 */

import type { DecisionPoint } from "../../data";
import type { FeatureProvider } from "../framework/contract";
import type { FeatureGate } from "../framework/gatedSignal";
import type { ResearchParameterSet } from "../types";
import type { StrategyRecipeDefinition } from "../recipeRegistry";
import {
  PCT_CHANGE_FEATURE_ID,
  PULLBACK_FEATURE_IDS,
  THREE_FACTOR_FEATURE_IDS,
  buildPctChangeFeatureProvider,
  buildPullbackFeatureProviders,
  buildThreeFactorFeatureProvider,
  requireNumericParameter,
} from "../recipeRegistryAtoms";
import type {
  PatternExecutionProjection,
  PatternFeatureKey,
  PatternGateBound,
  PatternParameterKey,
  TradingPatternSpec,
} from "./types";
import { ALL_TRADING_PATTERNS } from "./patterns";

// ---------------------------------------------------------------------------
// 语义键 → 真实特征 id / 参数名（唯一映射）
// ---------------------------------------------------------------------------

/**
 * 声明里的特征语义键 → 真实 `featureId`。
 *
 * 🔴 **唯一映射表**。值全部取自 `recipeRegistryAtoms.ts` 的常量，**不写字面量** ——
 * 否则改名时这里会静默漂移，而「特征 id 与声明不符」的失败要等到运行时才暴露
 * （注册期校验会拒绝，但那时已经是在跑真实回测了）。
 */
const PATTERN_FEATURE_ID_BY_KEY: Readonly<Record<PatternFeatureKey, string>> = {
  haircut: PULLBACK_FEATURE_IDS.haircut,
  volumeRatio: PULLBACK_FEATURE_IDS.volumeRatio,
  isBullish: PULLBACK_FEATURE_IDS.isBullish,
  momentum: PULLBACK_FEATURE_IDS.momentum,
  pctChange: PCT_CHANGE_FEATURE_ID,
  threeFactorComposite: THREE_FACTOR_FEATURE_IDS.composite,
};

function featureIdOf(feature: PatternFeatureKey): string {
  const featureId = PATTERN_FEATURE_ID_BY_KEY[feature];
  if (featureId === undefined) {
    throw new Error(
      `模式投影：特征语义键 \`${feature}\` 没有对应的真实 featureId `
        + `（已登记：${Object.keys(PATTERN_FEATURE_ID_BY_KEY).join("、")}）。拒绝猜测。`,
    );
  }
  return featureId;
}

/** 取某个特征的真实提供器（回踩四特征 / 当日涨跌幅 / 3F 合成分各用同一批 `compute*` 实现）。 */
function featureProviderOf(feature: PatternFeatureKey, point: DecisionPoint): FeatureProvider {
  if (feature === "pctChange") return buildPctChangeFeatureProvider(point);
  if (feature === "threeFactorComposite") return buildThreeFactorFeatureProvider(point);
  const featureId = featureIdOf(feature);
  const found = buildPullbackFeatureProviders(point).find(provider => provider.featureId === featureId);
  if (found === undefined) {
    throw new Error(
      `模式投影：特征 \`${feature}\`（featureId=${featureId}）不在回踩特征提供器清单里。`,
    );
  }
  return found;
}

function parameterNameOf(execution: PatternExecutionProjection, key: PatternParameterKey): string {
  const declaration = execution.parameters.find(item => item.key === key);
  if (declaration === undefined) {
    throw new Error(
      `模式投影：配方 ${execution.recipeId} 引用了参数键 \`${key}\`，`
        + `但它不在本模式的 parameters 声明里（已声明：`
        + `${execution.parameters.map(item => item.key).join("、") || "（无）"}）。拒绝静默落空。`,
    );
  }
  return declaration.name;
}

function compareNumbers(
  left: number,
  operator: "gte" | "gt" | "lte" | "lt" | "eq",
  right: number,
): boolean {
  switch (operator) {
    case "gte":
      return left >= right;
    case "gt":
      return left > right;
    case "lte":
      return left <= right;
    case "lt":
      return left < right;
    case "eq":
      return left === right;
  }
}

// ---------------------------------------------------------------------------
// 门槛构造
// ---------------------------------------------------------------------------

function buildGatesFactory(
  execution: Extract<PatternExecutionProjection, { readonly signalKind: "gated" }>,
): (parameters: ResearchParameterSet) => readonly FeatureGate[] {
  return (parameters: ResearchParameterSet): readonly FeatureGate[] => {
    // 🔴 与迁移前 buildPullbackGates 同序：先把**全部**声明参数取出（缺失/非有限即抛），
    //    再构造门槛列表。若改成惰性（用到才取），空参数集下的错误消息会从
    //    「max_volume_ratio 非法」变成「max_drawdown 非法」—— 同一份输入给出不同诊断。
    const resolved = new Map<PatternParameterKey, number>();
    for (const declaration of execution.parameters) {
      resolved.set(declaration.key, requireNumericParameter(parameters, declaration.name));
    }

    const gates: FeatureGate[] = [];
    for (const gate of execution.gates) {
      if (gate.enabledWhen !== undefined) {
        const actual = resolved.get(gate.enabledWhen.parameter);
        if (actual === undefined) {
          throw new Error(
            `模式投影：配方 ${execution.recipeId} 的门槛「${gate.label}」引用了未声明的参数键 `
              + `\`${gate.enabledWhen.parameter}\`。`,
          );
        }
        if (!compareNumbers(actual, gate.enabledWhen.operator, gate.enabledWhen.value)) continue;
      }
      let bound: number;
      if (gate.bound.kind === "constant") {
        bound = gate.bound.value;
      } else {
        const fromParameter = resolved.get(gate.bound.parameter);
        if (fromParameter === undefined) {
          throw new Error(
            `模式投影：配方 ${execution.recipeId} 的门槛「${gate.label}」引用了未声明的参数键 `
              + `\`${gate.bound.parameter}\`。`,
          );
        }
        bound = fromParameter;
      }
      gates.push({
        kind: gate.kind,
        featureId: featureIdOf(gate.feature),
        bound,
        label: gate.label,
      });
    }
    return gates;
  };
}

// ---------------------------------------------------------------------------
// 对外投影
// ---------------------------------------------------------------------------

/**
 * 把一个模式声明投影成执行侧配方定义。
 *
 * `execution === null` ⇒ 返回 `null`（纯研究模式，没有可执行形态）。
 * 返回值可直接交给 `makeStrategyRecipeRuntime` 构造运行时 —— 投影本身**不做注册**，
 * 注册与否由调用方决定（合成配方与全局注册表的分工见 `recipeRegistry.ts`）。
 */
export function projectRecipeDefinition(
  pattern: TradingPatternSpec,
): StrategyRecipeDefinition | null {
  const execution = pattern.execution;
  if (execution === null) return null;
  const point = execution.point;

  const common = {
    recipeId: execution.recipeId,
    point,
    signalFrequency: execution.signalFrequency,
    signalDescription: execution.signalDescription,
    requiredData: execution.requiredData,
    selectionSummary: execution.selectionSummary,
    randomSeed: execution.randomSeed,
    rankingConfig: { higherIsBetter: execution.rankHigherIsBetter },
    selectionConfig: { method: { kind: "topN" as const, n: execution.topN } },
  };

  if (execution.signalKind === "weighted") {
    return {
      ...common,
      signalKind: "weighted",
      features: execution.weights.map(item => featureProviderOf(item.feature, point)),
      defaultWeights: Object.fromEntries(
        execution.weights.map(item => [featureIdOf(item.feature), item.weight]),
      ),
    };
  }

  return {
    ...common,
    signalKind: "gated",
    features: execution.features.map(feature => featureProviderOf(feature, point)),
    buildGates: buildGatesFactory(execution),
    rankFeatureId: featureIdOf(execution.rankFeature),
  };
}

/**
 * 全部「有执行形态」的模式 ⇒ 配方定义清单（顺序 = `ALL_TRADING_PATTERNS` 声明顺序）。
 *
 * ⚠️ 这是**函数**而不是顶层常量：`recipeRegistry.ts` 在模块顶层调用它，
 * 而它读 `ALL_TRADING_PATTERNS`。用函数包装可避免「谁先求值」的脆弱顺序依赖
 * （`patterns/*.ts` 是叶子模块，任何加载顺序下都安全）。
 */
export function buildPatternRecipeDefinitions(): readonly StrategyRecipeDefinition[] {
  const out: StrategyRecipeDefinition[] = [];
  for (const pattern of ALL_TRADING_PATTERNS) {
    const definition = projectRecipeDefinition(pattern);
    if (definition !== null) out.push(definition);
  }
  return out;
}

