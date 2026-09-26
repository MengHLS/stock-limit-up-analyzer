/**
 * 运行工作台 — 执行配方的**运行时原子**（特征 id / 计算包装 / 参数读取）。
 *
 * ## 为什么这些原子要单独成文件
 *
 * 它们被**两处**消费：
 *   1. `recipeRegistry.ts` —— 注册表与配方运行时；
 *   2. `patternLibrary/project.ts` —— 把模式声明投影成可执行配方定义。
 *
 * 若留在 `recipeRegistry.ts` 里，第 2 处就会形成
 * `recipeRegistry → patternLibrary → recipeRegistry` 的**真循环**（运行时依赖）。
 * 把原子下移到本文件后依赖单向：两边都 → 本文件，零循环。
 *
 * ## 本文件的内容全部是**机械搬移**
 *
 * 逐字来自 `recipeRegistry.ts`（2026-09-17 迁移前），**零逻辑改动**，只为打破循环。
 * `recipeRegistry.ts` 保留同名 re-export，因此**对外导出面完全不变**。
 */

import type { CanonicalMarketBar, DecisionPoint } from "../data";
import type { ResearchParameterSet } from "./types";
import type { FeatureProvider } from "./framework/contract";
import { makeBarFeatureProvider } from "./framework/featureProvider";
import {
  computeCloseReturnFromEventClose,
  computeHaircutFromEventLow,
  computeIsBullish,
  computeVolumeRatio,
  eventBaselineOf,
} from "./recipeFeatures/pullbackFeatures";
import {
  computeThreeFactorRaw,
  threeFactorCompositeScoreOf,
} from "./recipeFeatures/threeFactorScoreFeatures";
import { StrategyRecipeRuntimeError } from "./recipeErrors";

// ---------------------------------------------------------------------------
// 可用性声明
// ---------------------------------------------------------------------------

/**
 * 可用性声明的日期下界。
 *
 * 为什么是一个很早的固定日而不是动态日期：`FeatureAvailability` 是**静态绝对时点**，
 * 引擎在运行前用它做「是否覆盖整个决策窗口」的泄漏预检（见 `signalEngine/engine.ts`
 * 的 `assertValidStrategy13` 与 framework `LeakageGuard`）。这里声明「该特征不需要任何
 * 未来数据、且在决策日同点即可知」——即要求的数据不晚于任何决策日。
 * 用固定下界表达「不约束到具体某天」，与 `scripts/runResearchDatasetE2E.mts` 用首日表达的
 * 语义一致（都要求「不晚于最早决策时点」），但对任意窗口都成立。
 */
const EPOCH_FLOOR_DATE = "1990-01-01";

/** 「同点可见」可用性（决策所需数据与可用时点都是决策日同一时点）。 */
export function samePointAvailability(point: DecisionPoint) {
  // availability 是绝对时点，而决策日逐日变化 —— 框架要求「必须覆盖整个决策窗口」。
  // 用「最早可能决策时点」表达会过窄，因此按框架语义用「不晚于最早决策时点」的写法：
  // 见 `framework/leakage.ts` 的 FeatureAvailability 契约（requiredDataThrough 表示
  // 该特征需要的最新数据时点，availableAt 表示该值何时可知）。
  // 逐日 PIT 数据集保证每一行的 asOf === tradeDate，因此「同点可见」是恒成立的。
  return {
    requiredDataThrough: { date: EPOCH_FLOOR_DATE, point },
    availableAt: { date: EPOCH_FLOOR_DATE, point },
  };
}

// ---------------------------------------------------------------------------
// 当日涨跌幅（加权基准配方的排序特征）
// ---------------------------------------------------------------------------

/** 当日涨跌幅特征 id / 版本（决定「按什么排序」；语义见下方 compute）。 */
export const PCT_CHANGE_FEATURE_ID = "pctChange";
export const PCT_CHANGE_FEATURE_VERSION = "1.0.0";

/**
 * 特征「当日涨跌幅」：`close / preClose − 1`。
 *
 * 口径来源：`scripts/runResearchDatasetE2E.mts` 的既有真实 E2E 特征（同一实现，不另立口径）。
 * 取窗口内**最后一根** bar（bars 已按 as-of 过滤），缺失任一价格或 preClose 为 0 → null。
 */
export function computePctChange(bars: readonly CanonicalMarketBar[]): number | null {
  const last = bars[bars.length - 1];
  if (last === undefined || last.close === null || last.preClose === null || last.preClose === 0) {
    return null;
  }
  return last.close / last.preClose - 1;
}

/**
 * 构造「当日涨跌幅」特征提供器。
 *
 * 导出供 `patternLibrary/project.ts` 投影加权型配方使用 —— 与 `recipeRegistry.ts`
 * 用的是**同一份** `computePctChange` / `samePointAvailability`（禁第二套口径）。
 */
export function buildPctChangeFeatureProvider(point: DecisionPoint): FeatureProvider {
  return makeBarFeatureProvider({
    featureId: PCT_CHANGE_FEATURE_ID,
    version: PCT_CHANGE_FEATURE_VERSION,
    availability: samePointAvailability(point),
    compute: computePctChange,
  });
}

// ---------------------------------------------------------------------------
// 「首板回踩 · 守线 + 缩量」配方的特征与参数原子
// ---------------------------------------------------------------------------

/**
 * 首板回踩配方的特征 id（口径逐字对齐 `researchEngine/variables.ts` 的同名观察日变量，
 * 见 `recipeFeatures/pullbackFeatures.ts` 的对齐表）。
 */
export const PULLBACK_FEATURE_IDS = {
  /** 回撤深度：`(首板日开盘价 − 决策日最低价) / 首板日开盘价`。≤ 阈值即「守线」。 */
  haircut: "haircutFromEventLow",
  /** 量能比：`决策日成交量 / 首板日成交量`。< 1 为缩量。 */
  volumeRatio: "volumeRatio",
  /** 当日阳线（「红盘」）：决策日收盘 > 决策日开盘 取 1，否则 0。 */
  isBullish: "isBullish",
  /** 收盘相对首板日收盘涨幅（供排序）。 */
  momentum: "momentumFromEventClose",
} as const;

export const PULLBACK_FEATURE_VERSION = "1.0.0";

/**
 * 构造首板回踩配方的四个特征提供器（导出供 `conditionSignal` 与 `patternLibrary` 复用
 * 同一批 `compute*` 实现）。
 *
 * 🔴 所有特征共用同一基准（`bars[0]` = 首板日）。基准缺失时**全部返回 null**
 * ⇒ 该证券不进候选（不臆造基准、不填默认值）。
 */
export function buildPullbackFeatureProviders(point: DecisionPoint): readonly FeatureProvider[] {
  const availability = samePointAvailability(point);
  const withBaseline = (
    featureId: string,
    compute: (
      bars: readonly CanonicalMarketBar[],
      baseline: NonNullable<ReturnType<typeof eventBaselineOf>>,
    ) => number | null,
  ) =>
    makeBarFeatureProvider({
      featureId,
      version: PULLBACK_FEATURE_VERSION,
      availability,
      compute: (bars) => {
        const baseline = eventBaselineOf(bars);
        if (baseline === null) return null;
        return compute(bars, baseline);
      },
    });

  return [
    withBaseline(PULLBACK_FEATURE_IDS.haircut, computeHaircutFromEventLow),
    withBaseline(PULLBACK_FEATURE_IDS.volumeRatio, computeVolumeRatio),
    // 「红盘」只读决策日当根 bar，不需要首板日基准。
    makeBarFeatureProvider({
      featureId: PULLBACK_FEATURE_IDS.isBullish,
      version: PULLBACK_FEATURE_VERSION,
      availability,
      compute: computeIsBullish,
    }),
    withBaseline(PULLBACK_FEATURE_IDS.momentum, computeCloseReturnFromEventClose),
  ];
}

// ---------------------------------------------------------------------------
// 「首板回踩 · 3F 综合评分」配方的特征原子（2026-09-26 新增）
// ---------------------------------------------------------------------------

/**
 * 3F 配方的特征 id（口径逐字对齐 `FROZEN-BUCKET-CONTRACT-001` 的落地处，
 * 见 `recipeFeatures/threeFactorScoreFeatures.ts` 的偏移表与来源说明）。
 *
 * 🔴 **只登记真正被消费的那一个**：本配方是 `gated`（空门槛）+ 排序特征 = 合成分，
 * 合成分既是「是否产生信号」的判据（可用性），也是横截面取 TopN 的键。
 * 三个成员的方向分**不登记** —— 闭环不落库逐证券特征值，声明了也没人读
 * （本项目明确反对「声明了却无效」的静默面）；它们由 `threeFactorScoreFeatures.ts`
 * 导出，供证据链脚本与研究侧复用。
 */
export const THREE_FACTOR_FEATURE_IDS = {
  /** 排序特征 = 等权合成分 `Σ(oriented) / 3`（与研究侧 EQUAL 分支同浮点路径）。 */
  composite: "threeFactorCompositeScore",
} as const;

export const THREE_FACTOR_FEATURE_VERSION = "1.0.0";

/**
 * 构造 3F 配方的特征提供器。
 *
 * 🔴 与回踩配方同一条纪律：无法计算时**返回 null**（该证券当日不进候选），绝不填默认值。
 * 基准（`bars[0]` = 首板日）缺失、或观察窗口 T+1..T+5 未走完时返回 null
 * ⇒ 该证券当日不产生信号（这正是「rd < 5 不进决策日」的 PIT 来源）。
 */
export function buildThreeFactorFeatureProvider(point: DecisionPoint): FeatureProvider {
  return makeBarFeatureProvider({
    featureId: THREE_FACTOR_FEATURE_IDS.composite,
    version: THREE_FACTOR_FEATURE_VERSION,
    availability: samePointAvailability(point),
    compute: (bars) => {
      const raw = computeThreeFactorRaw(bars);
      if (raw === null) return null;
      return threeFactorCompositeScoreOf(raw);
    },
  });
}

/**
 * 首板回踩配方参数 id（进 `StrategyDocument.parameters`，供 Parameter Search 搜索）。
 *
 * 🔴 用户裁定「四组一起做成参数化配方」⇒ 买入时点与回撤深度都是**参数**，
 * 不同取值即不同策略变体，无需各建一个 recipeId。
 */
export const PULLBACK_PARAMETER_IDS = {
  /** 缩量阈值：量能比 ≤ 该值才算「缩量」。0.3 = ≤30%，0.5 = ≤50%。 */
  maxVolumeRatio: "max_volume_ratio",
  /** 回撤深度阈值：回撤比例 ≤ 该值才算「守线」。0.02 = 允许跌破首板日开盘价 2% 以内。 */
  maxDrawdown: "max_drawdown",
  /** 是否要求当日阳线（「红盘」）。1 = 要求，0 = 不要求。 */
  requireBullish: "require_bullish",
} as const;

/** 由参数集数值读取助手（缺失/非有限 → 响亮抛错，**不静默取默认**）。导出供合成配方复用。 */
export function requireNumericParameter(parameters: ResearchParameterSet, name: string): number {
  const value = parameters[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StrategyRecipeRuntimeError(
      "RECIPE_PARAMETER_INVALID",
      `配方参数 \`${name}\` 必须是有限数字，实际 ${JSON.stringify(value)}（拒绝静默取默认值）。`,
    );
  }
  return value;
}
