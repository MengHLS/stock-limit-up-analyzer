/**
 * STEP 10 — Strategy Research Framework：统一研究契约（Contracts）。
 *
 * 本层定义「研究框架」的输入 / 中间 / 输出契约，覆盖：
 *
 *   Universe → Features → Signal → Ranking → Selection → Position Intent
 *
 * 边界铁律：
 *   - 这是「研究逻辑」层，不触碰 STEP 8「执行逻辑」：不产生 Order / Fill、不修改 Portfolio。
 *     最终产物是 Position Intent（候选 + 意图权重），仅作为研究输入，不构成交易。
 *   - 所有对象不可变（readonly）、可序列化、确定性；禁止 NaN / Infinity / Date.now / Math.random。
 *   - 不直接读取当前股票列表（Universe 必须 as-of）；不静默 fallback（缺数据 FAIL FAST）。
 *
 * 本文件只含类型与纯常量；校验见 validation.ts，泄漏守卫见 leakage.ts。
 */

import type { CanonicalMarketBar } from "../../data";
import type { CostModel } from "../../engine/domain";
import type { ResearchParameterSchema, ResearchParameterSet } from "../types";
import type { DecisionTime, FeatureAvailability } from "./leakage";

// ---------------------------------------------------------------------------
// Strategy Contract
// ---------------------------------------------------------------------------

/** 信号频率。 */
export type SignalFrequency = "daily" | "weekly" | "intraday";

/** 方向。 */
export type Direction = "long" | "short" | "neutral";

/**
 * STEP 10 研究层策略契约。
 *
 * 至少：strategyId / strategyVersion / name / description / parameters / requiredData / signalFrequency。
 * strategyVersion 不可变：任何逻辑变更必须产出新版本号，不得原地覆写。
 */
export interface StrategyContract {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly name: string;
  readonly description?: string;
  /** 策略参数 schema（复用研究层参数定义）。 */
  readonly parameters: ResearchParameterSchema;
  /** 策略所需的数据域（如 OHLCV / Turnover / Industry / Index / Status）。 */
  readonly requiredData: readonly string[];
  /** 信号频率。 */
  readonly signalFrequency: SignalFrequency;
}

// ---------------------------------------------------------------------------
// Universe
// ---------------------------------------------------------------------------

/**
 * UniverseProvider：按 as-of 日期给出该时点的可交易证券集合。
 * 禁止读取「当前」股票列表；实现必须显式提供历史/截面成员，缺失即 FAIL FAST。
 */
export interface UniverseProvider {
  readonly universeId: string;
  getUniverse(asOfDate: string): readonly string[];
}

// ---------------------------------------------------------------------------
// Feature Provider + Availability
// ---------------------------------------------------------------------------

/** 研究层「单证券」可见数据视图（bars 已由 pipeline 按 decisionTime 过滤）。 */
export interface ResearchSecurityData {
  readonly symbol: string;
  readonly bars: readonly CanonicalMarketBar[];
}

/** Feature 计算输入。 */
export interface FeatureComputeInput<D = ResearchSecurityData> {
  readonly securityId: string;
  readonly decisionTime: DecisionTime;
  readonly data: D;
}

/**
 * FeatureProvider：输入 security + date（决策时点），输出单个特征值。
 * 必须声明 availability（requiredDataThrough + availableAt）用于泄漏保护。
 * compute 必须是纯函数、确定性、无 IO。
 */
export interface FeatureProvider<D = ResearchSecurityData> {
  readonly featureId: string;
  readonly version: string;
  readonly availability: FeatureAvailability;
  compute(input: FeatureComputeInput<D>): number | null;
}

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

/**
 * 研究信号：securityId / date / value / direction / confidence。
 * confidence 可选 / 可空（框架不强制未来策略必须输出置信度）。
 */
export interface ResearchSignal {
  readonly securityId: string;
  readonly date: string;
  readonly value: number;
  readonly direction: Direction;
  readonly confidence?: number | null;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** 横截面排序的输入条目。 */
export interface RankInput {
  readonly securityId: string;
  readonly value: number | null;
}

/** Winsorization（缩尾）接口：用分位数夹住极值；具体参数不在本 STEP 选定。 */
export interface WinsorizationSpec {
  readonly lowerQuantile: number;
  readonly upperQuantile: number;
}

/** 并列处理："stable"（稳定顺序，不并列取平均）| "average"（并列取平均秩）。 */
export type TieBreaking = "stable" | "average";

/** 缺失/NaN 处理："exclude"（排除，不参与也不选中）| "rankLast"（排在有效值之后，仅作报告）。 */
export type MissingPolicy = "exclude" | "rankLast";

/** 排序配置。 */
export interface RankingConfig {
  /** true：值越大越好（rank 1 最优）；false：值越小越好。 */
  readonly higherIsBetter: boolean;
  readonly winsorization?: WinsorizationSpec;
  readonly tieBreaking?: TieBreaking;
  readonly missingPolicy?: MissingPolicy;
}

/** 排序结果。rank 1-based（1 最优）；percentile ∈ [0,1]（1 最优）。未排序项为 null。 */
export interface RankedSignal {
  readonly securityId: string;
  readonly value: number | null;
  readonly winsorizedValue: number | null;
  readonly rank: number | null;
  readonly percentile: number | null;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** 选择方法：topN 或 topPercentile（参数 configuration-driven）。 */
export type SelectionMethod =
  | { readonly kind: "topN"; readonly n: number }
  | { readonly kind: "topPercentile"; readonly pct: number };

export interface SelectionConfig {
  readonly method: SelectionMethod;
}

/** 选中候选。 */
export interface SelectedCandidate {
  readonly securityId: string;
  readonly rank: number;
  readonly percentile: number;
  readonly value: number;
}

// ---------------------------------------------------------------------------
// Position Intent
// ---------------------------------------------------------------------------

/** 仓位意图：研究框架的最终产物，仅供研究/后续执行消费，不构成交易。 */
export interface PositionIntent {
  readonly securityId: string;
  readonly direction: Direction;
  readonly rank: number;
  readonly percentile: number;
  /** 意图权重 ∈ (0,1]。 */
  readonly weight: number;
  readonly signalValue: number;
  readonly confidence?: number | null;
}

// ---------------------------------------------------------------------------
// Experiment Config
// ---------------------------------------------------------------------------

/** Universe 配置（引用 UniverseProvider 的 universeId）。 */
export interface UniverseConfig {
  readonly universeId: string;
}

/**
 * 研究实验配置：完整表达一次研究输入的不可变、可序列化配置。
 * 至少：datasetVersion / strategyId / strategyVersion / parameters / universe / dateRange / costModel / randomSeed。
 */
export interface ExperimentConfig {
  readonly datasetVersion: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameters: ResearchParameterSet;
  readonly universe: UniverseConfig;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly costModel: CostModel;
  /** 随机种子（整数）。当前框架确定性，seed 仅为未来随机步骤预留并参与可复现契约。 */
  readonly randomSeed: number;
}

// ---------------------------------------------------------------------------
// Pipeline 结果
// ---------------------------------------------------------------------------

/** 被剔除的证券及原因（稳定 code）。 */
export interface DroppedSecurity {
  readonly securityId: string;
  readonly reason: string;
}

/** 研究数据源：声明可提供的数据域 + 按证券取原始 bars。 */
export interface ResearchDataSource {
  /** 本数据源可提供的数据域（用于 requiredData FAIL FAST 校验）。 */
  readonly availableData: readonly string[];
  /** 按证券取原始 bars（全历史；as-of 过滤由 pipeline 负责）。无数据返回 null。 */
  getBars(securityId: string): readonly CanonicalMarketBar[] | null;
}

/** 研究流水线结果。 */
export interface ResearchPipelineResult {
  readonly decisionTime: DecisionTime;
  readonly universe: readonly string[];
  readonly signals: readonly ResearchSignal[];
  readonly ranked: readonly RankedSignal[];
  readonly selected: readonly SelectedCandidate[];
  readonly positionIntents: readonly PositionIntent[];
  readonly dropped: readonly DroppedSecurity[];
}
