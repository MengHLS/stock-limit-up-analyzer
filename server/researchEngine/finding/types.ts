/**
 * RESEARCH-FINDING-001 B4 —— Finding Engine 内部类型。
 *
 * 🔴 性能铁律（任务书 §28）：本模块**只消费 `research_result`**。
 *    绝不 import `datasetReader`、绝不触碰 `dataset_*` / `limit_up_records`。
 *    理由：Result 已是「DB 侧过滤 → 投影 → 分批 → 聚合」之后的产物，
 *    在 Result 上做发现层分析是**常数级**的；重扫 Dataset 会让本阶段变回 O(全市场)。
 *
 * 分层：
 *   resultView      （纯解析：Result 行 → 有序分组序列）
 *     → findingDetector        （4 类检测：单调/峰谷 · 效应 · 视界 · 稳定）
 *     → findingScorer          （§14 五维强度合成）
 *     → findingStabilityAnalyzer / findingInteractionAnalyzer（§11 / §12）
 *     → findingEngine          （编排 + 落库）
 */

import type {
  FindingPolicy,
  ResearchAnalysisType,
  ResearchFinding,
  ResearchFindingEffect,
  ResearchFindingHorizon,
  ResearchFindingInteraction,
  ResearchFindingMonotonicity,
  ResearchFindingSample,
  ResearchFindingStability,
  ResearchFindingType,
  ResearchResult,
} from "../../researchCore";

// ---------------------------------------------------------------------------
// 有序分组序列（Result 行的结构化视图）
// ---------------------------------------------------------------------------

/**
 * 有序档位（一个分组 = Result 里同一 `dimension` 取值下的若干指标行）。
 *
 * ⚠️ `metricValue` 一律取自 `metricCode = MEAN_RETURN`（或 `MEAN`）的**真实 Result 行**，
 *    不做任何再聚合 —— 「缺就是缺」，缺失档位保持 null，不用邻组插补。
 */
export interface OrderedBucket {
  /** 位置序号（1 起，按自然顺序）。秩相关以此为自变量。 */
  position: number;
  /** 稳定展示标签（如 `Q2` / `T+5` / `2025` / `CONDITION`）。 */
  label: string;
  /** 原始 dimension 取值（quantile 号 / horizon 数 / year 字符串）。 */
  rawLabel: string | number;
  /**
   * 区间文字（仅当能从 Result 的 `details.cutPoints` 还原边界时有值）。
   * 例：`[0.0210, 0.0380)`。**不臆造单位**（不硬说 %，变量量纲未知）。
   */
  rangeText: string | null;
  metricValue: number | null;
  medianReturn: number | null;
  winRate: number | null;
  sampleCount: number | null;
  /** 支撑该档位的真实 Result 行 id（provenance，可回溯）。 */
  resultIds: number[];
}

/** 基准（真实存在的「全样本 / 全周期」Result 行，不是算出来的）。 */
export interface SeriesBenchmark {
  label: string;
  metricValue: number | null;
  sampleCount: number | null;
  resultIds: number[];
}

/** 标量指标（DIFFERENCE / STABILITY_RATIO / SPREAD_TOP_BOTTOM …）的只读视图。 */
export interface SeriesScalar {
  metricCode: string;
  metricValue: number | null;
  sampleCount: number | null;
  resultIds: number[];
}

/** 一个 Analysis 的 Result 被解析成的**有序分组序列**。 */
export interface AnalysisSeries {
  analysisId: number;
  analysisType: ResearchAnalysisType;
  target: string | null;
  /** 分组维度键（`quantile` / `horizon` / `year` / `group` …）。 */
  dimensionKey: string;
  /** 分组档位（已按自然顺序排列；`ALL` 之类整体行**不进** buckets）。 */
  buckets: OrderedBucket[];
  benchmark: SeriesBenchmark | null;
  scalars: Map<string, SeriesScalar>;
  /** 分析级元数据（从 `details` 抽取的公共字段：`featureVariable` / `cutPoints` / `conditionRule` …）。 */
  meta: Record<string, unknown>;
  /** 该分析的全部 Result 行 id（provenance 全集）。 */
  allResultIds: number[];
  /**
   * 是否可做「有序关系」判定（单调 / 峰谷 / 效应）。
   * `DESCRIPTIVE` 的档位是**变量名**（无自然顺序）⇒ false，只能当**基准提供者**。
   */
  assessable: boolean;
}

// ---------------------------------------------------------------------------
// 检测产物（未落库的 Finding 草稿）
// ---------------------------------------------------------------------------

/**
 * Finding 草稿 = `ResearchFinding` 去掉 id / status / createdAt / updatedAt
 * （状态恒由引擎写 `DISCOVERED`；`runId` / `experimentId` 由 Engine 补）。
 *
 * `fingerprint` 必填：幂等键（同 Run 重复 detect 不产生重复行）。
 */
export type FindingDraft = Omit<
  ResearchFinding,
  | "id"
  | "experimentId"
  | "runId"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "effectStrength"
  | "sampleStrength"
  | "stabilityStrength"
  | "horizonConsistency"
  | "monotonicityStrength"
  | "researchStrength"
  | "researchStrengthGrade"
> & {
  /** 五维分项可缺省，由 Scorer 补齐。 */
  effectStrength?: number | null;
  sampleStrength?: number | null;
  stabilityStrength?: number | null;
  horizonConsistency?: number | null;
  monotonicityStrength?: number | null;
};

/** 五维证据的聚合容器（探测器内部传递，避免参数列表爆炸）。 */
export interface DetectedEvidence {
  effect?: ResearchFindingEffect | null;
  sample?: ResearchFindingSample | null;
  horizon?: ResearchFindingHorizon | null;
  stability?: ResearchFindingStability | null;
  monotonicity?: ResearchFindingMonotonicity | null;
  interaction?: ResearchFindingInteraction | null;
}

/**
 * §12 「未验证的组合假设」。
 *
 * 🔴 组合条件若在 Result 中**找不到**对应分析，**不允许**产出 Finding
 * （任务书 §12：不允许系统假装已经验证过）——只能作为本结构如实回传，
 * 由前端引导用户「新建分析去验证」，或转成 `UNTESTED` 假设。
 */
export interface UntestedInteraction {
  title: string;
  /** 参与组合的 Finding id（可能为 null —— 草稿阶段尚未落库）。 */
  findingIds: number[];
  /** 结构化组合条件（可空：草稿阶段单条件即可表达）。 */
  combinedConditions: null;
  reason: string;
}

// ---------------------------------------------------------------------------
// 引擎 IO
// ---------------------------------------------------------------------------

export interface FindingEngineDetectInput {
  experimentId: number;
  runId: number;
  /** 只检测指定分析（缺省 = 该 Run 全部 `COMPLETED` 分析）。 */
  analysisIds?: number[];
  /** 是否先清理该 Run 既有 Finding（重跑幂等；缺省 true）。 */
  resetExisting?: boolean;
}

export interface FindingEngineDetectResult {
  experimentId: number;
  runId: number;
  /** 实际参与检测的分析数。 */
  analysisCount: number;
  /** 实际读取的 Result 行数（**只读 Result，未扫 Dataset**）。 */
  resultCount: number;
  /** 检出草稿数（= 命中数，落库前）。 */
  detectedCount: number;
  /** 新建 Finding 行数。 */
  createdCount: number;
  /** 因 fingerprint 命中而复用的行数（重跑时不为 0）。 */
  reusedCount: number;
  findingIds: number[];
  findingsByType: Record<string, number>;
  untestedInteractions: UntestedInteraction[];
  /** 跳过的分析及原因（如无 Result 行）。 */
  skipped: Array<{ analysisId: number; analysisType: ResearchAnalysisType; reason: string }>;
  policySnapshot: unknown;
  durationMs: number;
}

/** `resultView` 的出参：原始 Result 行 → 结构化序列（纯函数，可单测）。 */
export interface ParseSeriesInput {
  analysis: { id?: number; analysisType: ResearchAnalysisType; target?: string | null; config?: unknown };
  results: ReadonlyArray<ResearchResult>;
}

/** 探测器签名：一个序列 → 0..N 个草稿。 */
export type FindingDetectorFn = (series: AnalysisSeries, policy: FindingPolicy) => FindingDraft[];

/** 便于给 FindingDraft.findingType 做穷尽检查。 */
export const DETECTABLE_FINDING_TYPES: readonly ResearchFindingType[] = [
  "EFFECT",
  "MONOTONIC_RELATION",
  "PEAK_RELATION",
  "VALLEY_RELATION",
  "HORIZON_PATTERN",
  "STABILITY",
  "INTERACTION",
] as const;
