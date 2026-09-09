/**
 * STEP 17 / C-17.1 — Grid / Random Parameter Search：类型契约（不可变、可序列化、可审计）。
 *
 * 背景（ROADMAP §19「Parameter Optimization」）：
 *   - 优化目标不是「找到历史收益最高参数」，而是「找到表现良好且稳定的参数区域」；
 *   - 必须区分 Optimization 与 Final Strategy；优化结果产出 **Candidate Strategies**（非生产策略）；
 *   - 未来支持 Grid / Random / Rolling Optimization（Rolling 属 C-17.2，本模块不做）；
 *   - 一次搜索必须记录完整实验信息（method / seed / budget / parameterSpace 指纹 /
 *     被评参数与绩效 / 稳定区结论 / 候选策略 / createdAt / fingerprint）。
 *
 * 与既有模块的关系（详见各实现文件头）：
 *   - STEP 6.3 combinationGenerator（grid 全组合）与 sweep.computeParameterSpaceFingerprint
 *     为只读桥接，本模块不重写；
 *   - parameterStability（STEP 6.5）的「均值/中位数/离散度」统计思路在稳定区判定中对齐复用；
 *   - evaluator 回调注入：本模块为纯函数、无 IO，真实回测评估由调用方注入；
 *   - 候选参数必须兼容 research/types.ts#ResearchParameterSet（键值形态，值 =
 *     number | string | boolean | null），由 SearchRun / Candidate 记录的 parameterSet 字段承载。
 *
 * 铁律：全部字段 readonly；可 JSON 序列化；确定性（random 用 seedable PRNG，同 seed 同结果）；
 * 禁止 NaN / Infinity；失败响亮（退化输入结构化处理）；不跑真实 DB / 回测。
 */

import type { ParameterSpace } from "../parameterSpace";
import type { ResearchParameterSet } from "../types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** SearchRun 记录种类标签（供序列化 / 反序列化判别）。 */
export const PARAMETER_SEARCH_RUN_RECORD_KIND = "PARAMETER_SEARCH_RUN" as const;

/** SearchRun schema 版本：字段语义变更必须递增。 */
export const PARAMETER_SEARCH_RUN_RECORD_VERSION = 1 as const;

/** Candidate Strategy 记录种类标签。 */
export const PARAMETER_SEARCH_CANDIDATE_RECORD_KIND = "PARAMETER_SEARCH_CANDIDATE_STRATEGY" as const;

/** Candidate Strategy schema 版本。 */
export const PARAMETER_SEARCH_CANDIDATE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 搜索方法 / 运行元信息
// ---------------------------------------------------------------------------

/** 搜索方法：grid（全组合枚举）| random（seedable 确定性采样）。 */
export type ParameterSearchMethod = "grid" | "random";

/** random 采样默认预算（未显式给 budget 时）。 */
export const DEFAULT_RANDOM_SEARCH_BUDGET = 100;

/** SearchRun ID 前缀（`SEARCH-YYYYMMDD-XXXXXXXX`，风格对齐 sweep.generateBatchId）。 */
export const SEARCH_RUN_ID_PREFIX = "SEARCH";

// ---------------------------------------------------------------------------
// 评估契约（注入式）
// ---------------------------------------------------------------------------

/** 单个参数集评估成功产物：仅携带稳定区判定实际消费的标量（绩效摘要）。 */
export interface ParameterSearchMetricsView {
  /** 总收益率（%），可为负；必须有限。 */
  readonly totalReturnPct: number;
  /** 最大回撤深度（%，>= 0）；必须有限。 */
  readonly maxDrawdownPct: number;
  /** 成交笔数；未知时为 null；提供时必须为 >= 0 整数。 */
  readonly tradeCount: number | null;
}

/** 单个参数集评估产物（成功携带标量；失败携带结构化错误）。 */
export type ParameterSearchSampleOutcome =
  | { readonly status: "succeeded"; readonly metrics: ParameterSearchMetricsView }
  | { readonly status: "failed"; readonly error: string };

/** 注入式评估器：parameterSet → 绩效产物。搜索器保持纯函数，不执行 IO / 回测。 */
export type ParameterSearchEvaluator = (parameterSet: ResearchParameterSet) => ParameterSearchSampleOutcome;

// ---------------------------------------------------------------------------
// 稳定区判定口径（§19：表现良好且稳定的参数区域，非单点历史最高）
// ---------------------------------------------------------------------------

/** 稳定区判定口径（部分字段可缺省，缺省由 resolveRegionAnalysisConfig 补齐）。 */
export interface RegionAnalysisConfig {
  /**
   * 收益门槛（%）：totalReturnPct >= 此值的样本才算「收益达标」。
   * 缺省 0（不亏钱为达标底线）。
   */
  readonly minReturnPct?: number;
  /**
   * 回撤门槛（%）：maxDrawdownPct > 此值计为「坏点」（drawdown bad point）。
   * 缺省 15。
   */
  readonly maxDrawdownPct?: number;
  /**
   * 全体（成功）样本坏点率上限（%）：坏点占比超过该值 → 判定
   * degraded-bad-point-rate（坏点率过高，区域稳定性存疑）。缺省 50。
   */
  readonly maxBadPointRatePct?: number;
  /** 候选区最少合格样本数；合格样本不足 → insufficient-qualified-samples。缺省 1。 */
  readonly minQualifiedSamples?: number;
  /** 候选策略产出上限（null = 不限制）；仅用于限制记录体积，不改变区域结论。缺省 null。 */
  readonly maxCandidates?: number;
  /**
   * 是否仅在区域结论稳定（verdict === "stable"）时才产出候选策略。
   * 缺省 true（§19 纪律：不把可疑区域推广为候选）。
   */
  readonly requireStableCandidates?: boolean;
}

/** 解析后的稳定区判定口径（全字段有限、自描述；记录在 SearchRun 内）。 */
export interface ResolvedRegionAnalysisConfig {
  readonly minReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly maxBadPointRatePct: number;
  readonly minQualifiedSamples: number;
  readonly maxCandidates: number | null;
  readonly requireStableCandidates: boolean;
}

/** 稳定区判定缺省口径（与 RegionAnalysisConfig 缺省一致）。 */
export const DEFAULT_REGION_ANALYSIS_CONFIG: ResolvedRegionAnalysisConfig = {
  minReturnPct: 0,
  maxDrawdownPct: 15,
  maxBadPointRatePct: 50,
  minQualifiedSamples: 1,
  maxCandidates: null,
  requireStableCandidates: true,
};

// ---------------------------------------------------------------------------
// 区域结论
// ---------------------------------------------------------------------------

/**
 * 区域结论（verdict）：
 *   - "stable"                        ：合格样本充足且坏点率 <= 上限 → 稳定区成立；
 *   - "degraded-bad-point-rate"       ：合格样本充足但整体坏点率过高 → 区域可疑；
 *   - "insufficient-qualified-samples"：合格样本少于 minQualifiedSamples → 证据不足；
 *   - "no-qualified-samples"          ：无任何合格样本（含全部失败 / 全部不达标）→ 无区。
 */
export type CandidateRegionVerdict =
  | "stable"
  | "degraded-bad-point-rate"
  | "insufficient-qualified-samples"
  | "no-qualified-samples";

/** 候选区成员：一个合格样本（含其在 evaluatedSamples 中的下标，供溯源）。 */
export interface CandidateRegionMember {
  /** evaluatedSamples 数组下标（同参数集、绩效一一对应）。 */
  readonly sampleIndex: number;
  readonly parameterSet: ResearchParameterSet;
  readonly totalReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly tradeCount: number | null;
}

/** 候选区聚合统计（覆盖全部合格成员：均值/中位数而非单点极值）。 */
export interface CandidateRegionAggregate {
  readonly qualifiedCount: number;
  /** 成员总收益率均值 / 中位数（%）。 */
  readonly meanTotalReturnPct: number;
  readonly medianTotalReturnPct: number;
  readonly minTotalReturnPct: number;
  readonly maxTotalReturnPct: number;
  /** 成员最大回撤均值 / 中位数 / 最大（%）。 */
  readonly meanMaxDrawdownPct: number;
  readonly medianMaxDrawdownPct: number;
  readonly maxMaxDrawdownPct: number;
}

/** 稳定参数区判定报告（对搜索结果聚合，详见 region.ts 文件头算法说明）。 */
export interface CandidateRegionReport {
  readonly verdict: CandidateRegionVerdict;
  /** 被评估样本总数（成功 + 失败）。 */
  readonly evaluatedCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  /** 合格样本数（收益达标 且 回撤不超阈值；= members.length）。 */
  readonly qualifiedCount: number;
  /** 被排除的「低收益」样本数（收益不达标但回撤正常；与坏点互斥）。 */
  readonly lowReturnCount: number;
  /** 坏点数（回撤超阈值，含高收益坏点）；坏点率分母 = succeededCount。 */
  readonly badDrawdownCount: number;
  /** 坏点率（%）= badDrawdownCount / succeededCount × 100；succeededCount = 0 → null。 */
  readonly badPointRatePct: number | null;
  /**
   * 是否存在「合格样本充足、但因坏点率/requireStableCandidates 配置而抑制候选产出」的情形。
   * 仅作审计提示：候选策略实际是否产出由 verdict + 配置决定。
   */
  readonly candidatesSuppressed: boolean;
  /** 合格成员（按 totalReturnPct 降序、参数集 canonical 键升序破平；确定性排序）。 */
  readonly members: readonly CandidateRegionMember[];
  /** 成员聚合统计；qualifiedCount = 0 时为 null。 */
  readonly aggregate: CandidateRegionAggregate | null;
}

// ---------------------------------------------------------------------------
// Candidate Strategy（§19：候选，非 Production / Final）
// ---------------------------------------------------------------------------

/** Candidate Strategy 绩效摘要（= 该样本的 SearchSampleMetricsView 冻结副本）。 */
export interface ParameterSearchCandidatePerformance {
  readonly totalReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly tradeCount: number | null;
}

/**
 * 一次搜索从稳定候选区产出的候选策略（§19 Candidate Strategies）。
 *
 * strategyKind = "candidate" 显式区分非 production / final：本记录不是生产策略声明，
 * 升级 / 推广到生产由后续（C-17.2 / C-21.1 生命周期）负责，本模块不做任何推广。
 */
export interface ParameterSearchCandidateStrategy {
  readonly recordKind: typeof PARAMETER_SEARCH_CANDIDATE_RECORD_KIND;
  readonly recordVersion: typeof PARAMETER_SEARCH_CANDIDATE_RECORD_VERSION;
  /** 候选 ID（= `${searchRunId}-candidate-${序号}`，SearchRun 内唯一）。 */
  readonly candidateId: string;
  /** §19 语义标签：候选策略（非 production / final）。 */
  readonly strategyKind: "candidate";
  /** 本次搜索针对的研究策略身份（上下文回显，非新策略注册）。 */
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 候选参数（与 ResearchParameterSet 兼容的键值形态）。 */
  readonly parameterSet: ResearchParameterSet;
  /** 绩效摘要（该样本的指标副本）。 */
  readonly performance: ParameterSearchCandidatePerformance;
  /** 归属 SearchRun（溯源）。 */
  readonly searchRunId: string;
  /** 在 SearchRun.evaluatedSamples 中的下标（溯源）。 */
  readonly sampleIndex: number;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 单样本评估记录
// ---------------------------------------------------------------------------

/** SearchRun 内单个被评样本（完整参数 + 绩效 + 状态；可审计追溯）。 */
export interface ParameterSearchEvaluatedSample {
  readonly parameterSet: ResearchParameterSet;
  readonly status: "succeeded" | "failed";
  /** status = succeeded 时数值有限；failed 时为 null。 */
  readonly totalReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly tradeCount: number | null;
  /** status = failed 时的结构化错误；succeeded 时为 null。 */
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// SearchRun（一次搜索的完整实验记录）
// ---------------------------------------------------------------------------

/**
 * 一次 Grid / Random 搜索的完整实验记录（不可变、可 JSON 序列化、带 fingerprint）。
 *
 * 内容（§19「记录完整实验信息」）：
 *   - 搜索身份：searchRunId / strategyId@strategyVersion / method / seed / budget；
 *   - 空间：parameterSpace 冻结快照 + canonical 指纹；
 *   - 口径：analysisConfig（解析后全字段自描述）；
 *   - 结果：evaluatedSamples（被评参数与绩效）/ region（稳定区结论）/ candidates（候选策略）；
 *   - 元数据：createdAt（注入，非复现输入）+ fingerprint。
 */
export interface ParameterSearchRun {
  readonly recordKind: typeof PARAMETER_SEARCH_RUN_RECORD_KIND;
  readonly recordVersion: typeof PARAMETER_SEARCH_RUN_RECORD_VERSION;
  readonly searchRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly method: ParameterSearchMethod;
  /** random：PRNG 种子（整数）；grid：null。 */
  readonly seed: number | null;
  /**
   * 请求预算：grid = 全组合基数（combinationCount）；random = 调用方请求的采样预算。
   * 实际样本数以 sampleCount 为准（random 可能因空间不足 / 去重少于预算）。
   */
  readonly requestedBudget: number;
  /** 参数空间全组合基数（calculateCombinationCount；grid = 全组合数）。 */
  readonly combinationCount: number;
  /** 实际采样并评估的样本数（grid = combinationCount；random <= min(budget, combinationCount)）。 */
  readonly sampleCount: number;
  /** 冻结的参数空间快照（可追溯「当时到底搜了哪些参数」）。 */
  readonly parameterSpace: ParameterSpace;
  /** 参数空间 canonical fingerprint（桥接 sweep.computeParameterSpaceFingerprint）。 */
  readonly parameterSpaceFingerprint: string;
  /** 稳定区判定口径（解析后）。 */
  readonly analysisConfig: ResolvedRegionAnalysisConfig;
  /** 被评参数与绩效（顺序 = 生成顺序）。 */
  readonly evaluatedSamples: readonly ParameterSearchEvaluatedSample[];
  /** 稳定区结论。 */
  readonly region: CandidateRegionReport;
  /** 候选策略（非生产；§19 Candidate Strategies）。 */
  readonly candidates: readonly ParameterSearchCandidateStrategy[];
  /** 运行记录创建时间（ISO-8601 UTC；实验元数据，由调用方/入口注入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 搜索请求（runParameterSearch 输入）
// ---------------------------------------------------------------------------

/** 一次 Grid / Random 搜索请求。 */
export interface ParameterSearchRequest {
  readonly method: ParameterSearchMethod;
  /** 本次搜索针对的研究策略身份（上下文，仅记录不做身份注册）。 */
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 参数空间（冻结使用，不修改入参）。 */
  readonly parameterSpace: ParameterSpace;
  /** 注入式评估器（纯函数搜索器不执行 IO / 回测）。 */
  readonly evaluator: ParameterSearchEvaluator;
  /** random：PRNG 种子（必须为整数）；grid：忽略（记录为 null）。 */
  readonly seed?: number;
  /** random：采样预算（>= 1；缺省 DEFAULT_RANDOM_SEARCH_BUDGET）；grid：忽略。 */
  readonly budget?: number;
  /** grid：全组合上限（>= 1；缺省对齐 combinationGenerator.DEFAULT_MAX_COMBINATIONS）；random：忽略。 */
  readonly maxCombinations?: number;
  /** 稳定区判定口径（缺省 DEFAULT_REGION_ANALYSIS_CONFIG）。 */
  readonly analysis?: RegionAnalysisConfig;
  /** SearchRun ID（缺省自动生成 SEARCH-YYYYMMDD-XXXXXXXX；注入则确定性）。 */
  readonly searchRunId?: string;
  /** 创建时间（ISO-8601 UTC；缺省当前时间；元数据非复现输入）。 */
  readonly createdAt?: string;
}
