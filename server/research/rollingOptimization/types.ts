/**
 * STEP 17 / C-17.2 — Rolling Optimization：类型契约（不可变、可序列化、可审计）。
 *
 * 背景（ROADMAP §19「Parameter Optimization」）：优化目标不是「历史收益最高参数」，
 * 而是「表现良好且稳定的参数区域」；优化必须区分 Optimization 与 Final Strategy，产物
 * 止于 Candidate Strategies；未来支持 Grid / Random / Rolling Optimization。C-17.1 已交付
 * 单期 Grid / Random 搜索；本模块（C-17.2）把同一搜索推广到**时间滚动窗**：在可配的
 * 时间窗口内逐窗复用 C-17.1 runParameterSearch，跨窗做显式非 argmax 的参数一致性判定，
 * 产出 RollingOptimizationRun 完整实验记录。
 *
 * 与 C-19.1（WFO / OOS 滚动窗口划分）的边界（详见本文件头与交付报告）：
 *   - C-17.2 = 「滚动窗口上的参数优化」：每窗对窗内数据子集做一次全量参数搜索（grid /
 *     random），记录各窗候选与稳定区，再跨窗判定「同一参数在不同窗的表现一致性」；全程
 *     不做 Train/Validation/OOS 三段划分，不做「先选参 → 冻结 → 样本外评测」的 WFO 链路，
 *     不把任何窗候选 promotion 为 Final / Production。
 *   - C-19.1 才做 WFO 的 Train→Optimize→Freeze→Test→Move Window 编排（含 OOS 滚动窗口
 *     划分），需要时可把本模块/ C-17.1 的 candidate 作为其窗内 Optimize 产物的来源。
 *
 * 时间窗口锚定决策（文档化，见 windows.ts 文件头）：
 *   - 窗口锚定**数据集的交易日序列**（ResearchDataset 实际存在的 tradeDate，升序去重），
 *     而非 walkForward 的日历天：窗内评估消费的是逐交易日数据（simulator → C-16.1 曲线），
 *     Calendar-day 切片会引入停牌/节假日空隙，使窗切片与真实可交易日错位；
 *   - windowLength / stepLength 单位 = 交易日个数；stepLength < windowLength 时相邻窗
 *     重叠（观察参数漂移的常规形态），无「相邻 OOS 不重叠」约束（本层没有 OOS 语义）。
 *
 * 与既有模块关系（import 只读）：
 *   - parameterSearch（C-17.1）：SearchRun / EvaluatedSample / RegionConfig 等类型，
 *     runParameterSearch / resolveRegionAnalysisConfig / buildCandidateStrategies；
 *   - sweep.computeParameterSpaceFingerprint、combinationGenerator、parameterSpace 校验；
 *   - walkForward / datasetSplit / researchDataset/version 仅对齐口径（canonical / 日期 /
 *     fingerprint 风格），不修改。
 *
 * 铁律：全部字段 readonly；可 JSON 序列化；确定性（random 用 seedable 派生种子，同
 * runId + createdAt + seed + 空间 + tradeDates → 同结果）；禁止 NaN / Infinity；失败响亮
 * （退化输入结构化处理）；不跑真实 DB / 回测；不把候选 promotion 为生产。
 */

import type { ParameterSpace } from "../parameterSpace";
import type { ResearchParameterSet } from "../types";
import type {
  RegionAnalysisConfig,
  ResolvedRegionAnalysisConfig,
  ParameterSearchEvaluatedSample,
  ParameterSearchRun,
  ParameterSearchEvaluator,
  ParameterSearchMethod,
} from "../parameterSearch";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** RollingOptimizationRun 记录种类标签（供序列化/反序列化判别）。 */
export const ROLLING_OPTIMIZATION_RUN_RECORD_KIND = "ROLLING_OPTIMIZATION_RUN" as const;

/** RollingOptimizationRun schema 版本：字段语义变更必须递增。 */
export const ROLLING_OPTIMIZATION_RUN_RECORD_VERSION = 1 as const;

/** 跨窗汇总候选策略记录种类标签（区别于 C-17.1 单窗候选记录）。 */
export const ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND = "ROLLING_OPTIMIZATION_CANDIDATE_STRATEGY" as const;

/** 跨窗汇总候选 schema 版本。 */
export const ROLLING_OPTIMIZATION_CANDIDATE_RECORD_VERSION = 1 as const;

/** RollingOptimizationRun ID 前缀（`ROLLING-YYYYMMDD-XXXXXXXX`，风格对齐 SEARCH-*）。 */
export const ROLLING_OPTIMIZATION_RUN_ID_PREFIX = "ROLLING";

// ---------------------------------------------------------------------------
// 搜索方法（复用 C-17.1 口径）
// ---------------------------------------------------------------------------

/** 搜索方法：grid | random（逐窗采样语义见 run.ts 文件头）。 */
export type RollingOptimizationMethod = ParameterSearchMethod;

// ---------------------------------------------------------------------------
// 窗口配置
// ---------------------------------------------------------------------------

/**
 * 滚动窗口配置（交易日粒度）。
 *
 * 生成语义（windows.ts）：
 *   窗 0 = tradeDates[0 .. windowLength-1]；
 *   窗 i = tradeDates[i*stepLength .. i*stepLength+windowLength-1]，
 *   直到完整窗口无法放入数据末尾为止。
 *
 * 约束：
 *   - windowLength / stepLength 均为 >= 1 的整数（交易日个数），必须显式给出（无缺省值，
 *     避免静默采用不合理的窗长）；
 *   - stepLength < windowLength 允许（相邻窗重叠，跨窗稳定性观测的常规形态）；
 *   - 数据集交易日数不足以容纳第 0 个完整窗口时结构化抛错（不静默返回空数组）。
 */
export interface RollingWindowConfig {
  /** 每窗交易日个数（>= 1）。 */
  readonly windowLength: number;
  /** 相邻窗起点推进的交易日个数（>= 1）。 */
  readonly stepLength: number;
  /** 窗口数上限（null/缺省 = 不限）。仅限制记录体积/计算量，不改变窗口语义。 */
  readonly maxWindows?: number | null;
}

/** 解析后的窗口配置（全字段自描述，记录在 RollingOptimizationRun 内）。 */
export interface ResolvedRollingWindowConfig {
  /** 窗口模式恒为 rolling（expanding / WFO 划分属 C-19.1，本模块不做）。 */
  readonly mode: "rolling";
  readonly windowLength: number;
  readonly stepLength: number;
  readonly maxWindows: number | null;
}

// ---------------------------------------------------------------------------
// 跨窗一致性判定口径
// ---------------------------------------------------------------------------

/**
 * 跨窗一致性判定口径（§19：表现良好且稳定的参数区域；显式非 argmax）。
 *
 * 判定哲学对齐 analyzeCandidateRegion：逐窗先把每个参数集按区域口径分类（qualified =
 * returnOk && ddOk），再跨窗聚合；只有「在每个被评估窗口中都合格」的参数集才称
 * stable-across-windows —— 这是合格区的交集语义，绝不取「单窗表现最好的参数」。
 */
export interface RollingStabilityConfig {
  /**
   * 一致性成立所需的**最少被评估窗口数**（缺省 2）：参数集被评估的窗口不足该值时，
   * 即使全部合格也不判 consistent（单窗被评的合格不足以支撑「跨窗稳定」的结论，避免
   * random 逐窗子集差异导致单窗采样参数被误判为稳定）。
   */
  readonly minEvaluatedWindows?: number;
  /** 跨窗候选产出上限（null = 不限制）；仅限制记录体积，不改变一致性结论。缺省 null。 */
  readonly maxCandidates?: number | null;
}

/** 解析后的跨窗一致性口径（全字段有限、自描述）。 */
export interface ResolvedRollingStabilityConfig {
  readonly minEvaluatedWindows: number;
  readonly maxCandidates: number | null;
}

/** 跨窗一致性口径缺省值（minEvaluatedWindows=2：单窗不足以谈「跨窗稳定」）。 */
export const DEFAULT_ROLLING_STABILITY_CONFIG: ResolvedRollingStabilityConfig = {
  minEvaluatedWindows: 2,
  maxCandidates: null,
};

// ---------------------------------------------------------------------------
// 注入式评估契约（evaluator 工厂：先给窗口上下文，再给参数集）
// ---------------------------------------------------------------------------

/**
 * 单个滚动窗口的上下文（提供给调用方构造窗内评估器）。
 *
 * 窗内评估链路（由调用方实现，本模块不执行）：用 tradeDates 从 ResearchDataset 切出
 * 窗内数据子集 → simulator（C-14.1）→ C-16.1 evaluatePerformance → C-17.1
 * ParameterSearchMetricsView 标量，再交给 evaluator 返回。
 */
export interface RollingOptimizationWindowContext {
  /** 窗口 ID（`${runId}-w${windowIndex}`，全 run 内唯一）。 */
  readonly windowId: string;
  /** 窗口序号（从 0 起，按时间递增）。 */
  readonly windowIndex: number;
  /** 窗内交易日序列（升序、无重复、YYYY-MM-DD）。 */
  readonly tradeDates: readonly string[];
  /** 窗内首 / 末交易日（YYYY-MM-DD；tradeDates 非空时恒有值）。 */
  readonly firstTradeDate: string;
  readonly lastTradeDate: string;
  /** 窗内交易日个数。 */
  readonly tradeDayCount: number;
}

/**
 * 窗内评估器工厂：window 上下文 → 该窗的参数评估器（与 C-17.1 ParameterSearchEvaluator
 * 同一契约）。工厂必须是纯函数（无 IO / 无 Date.now / 无 Math.random）；真实回测由调用方
 * 在工厂内部切片窗数据后注入。
 */
export type RollingOptimizationEvaluatorFactory = (
  window: RollingOptimizationWindowContext,
) => ParameterSearchEvaluator;

// ---------------------------------------------------------------------------
// 生成的窗口定义（纯窗口几何，不含搜索内容）
// ---------------------------------------------------------------------------

/** 生成的滚动窗口（由 tradeDates 切片决定；见 windows.ts 算法说明）。 */
export interface RollingOptimizationWindow {
  readonly windowIndex: number;
  readonly firstTradeDate: string;
  readonly lastTradeDate: string;
  readonly tradeDayCount: number;
  /** 完整切片（升序），供调用方构造窗内评估数据子集。 */
  readonly tradeDates: readonly string[];
}

// ---------------------------------------------------------------------------
// 逐窗结果（RollingOptimizationRun.windows 元素）
// ---------------------------------------------------------------------------

/** RollingOptimizationRun 内单个窗口的完整结果（内含该窗 C-17.1 SearchRun 全记录）。 */
export interface RollingOptimizationWindowEntry {
  /** 窗口 ID（`${runId}-w${windowIndex}`）。 */
  readonly windowId: string;
  readonly windowIndex: number;
  /** 窗内交易日范围（首/末，YYYY-MM-DD）与个数（便于审计，不重存整段切片）。 */
  readonly firstTradeDate: string;
  readonly lastTradeDate: string;
  readonly tradeDayCount: number;
  /**
   * 该窗完整 C-17.1 SearchRun（含 evaluatedSamples / region 结论 / 窗内候选策略 /
   * 自身 fingerprint），逐窗实验信息完整可审计。
   */
  readonly searchRun: ParameterSearchRun;
}

// ---------------------------------------------------------------------------
// 跨窗一致性报告
// ---------------------------------------------------------------------------

/** 跨窗一致性判定结论（对齐 analyzeCandidateRegion 的 verdict 风格）。 */
export type RollingConsistencyVerdict =
  /** 存在 >= 1 个 consistent 参数集（在其被评估的全部窗口中都合格）。 */
  | "stable-across-windows"
  /** 无任何参数集在其被评估的全部窗口中都合格（至少一个窗口出现坏点/低收益/失败）。 */
  | "no-consistent-parameters"
  /** 无任何参数集在任一窗口合格（含全部窗口无合格样本）。 */
  | "no-qualified-parameters";

/** 跨窗一致性判定用单窗口观察（参数集在单窗内的评估样本）。 */
export interface RollingWindowObservation {
  readonly windowId: string;
  readonly windowIndex: number;
  /** 该窗搜索的被评样本（顺序 = 窗内搜索生成顺序）。 */
  readonly evaluatedSamples: readonly ParameterSearchEvaluatedSample[];
}

/** 单个参数集的跨窗一致性统计。 */
export interface RollingConsistencyParameterStat {
  /** 参数集 canonical 键（键排序 + JSON，确定性排序/去重用）。 */
  readonly parameterSetKey: string;
  readonly parameterSet: ResearchParameterSet;
  /** 被评估窗口数（成功 + 失败）。 */
  readonly evaluatedWindowCount: number;
  /** 成功窗口数。 */
  readonly succeededWindowCount: number;
  /** 合格窗口数（成功 且 returnOk 且 ddOk）。 */
  readonly qualifiedWindowCount: number;
  /** 合格窗口 ID（按 windowIndex 升序）。 */
  readonly qualifiedWindowIds: readonly string[];
  /** 坏点窗口数（成功但回撤超阈值，无论收益多高）。 */
  readonly badDrawdownWindowCount: number;
  /** 低收益窗口数（成功、回撤达标但收益不达标）。 */
  readonly lowReturnWindowCount: number;
  /** 失败窗口数（评估失败 / 指标非法）。 */
  readonly failedWindowCount: number;
  /** 合格窗口率（%）= qualified / evaluated × 100；evaluated = 0 → null。 */
  readonly qualifiedWindowRatePct: number | null;
  /**
   * 是否 consistent：qualified === succeeded === evaluated（被评估的每个窗口都合格）且
   * evaluatedWindowCount >= 口径 minEvaluatedWindows。
   */
  readonly consistent: boolean;
  /** 合格窗口的总收益率均值 / 中位数（%；无合格窗口 → null）。 */
  readonly meanTotalReturnPct: number | null;
  readonly medianTotalReturnPct: number | null;
  /** 合格窗口的最大回撤均值 / 最大值（%；无合格窗口 → null）。 */
  readonly meanMaxDrawdownPct: number | null;
  readonly maxMaxDrawdownPct: number | null;
}

/** 跨窗一致性判定报告（对齐 analyzeCandidateRegion 报告形态：聚合而非单点极值）。 */
export interface RollingConsistencyReport {
  readonly verdict: RollingConsistencyVerdict;
  /** 参与判定的窗口数（= run.windowCount）。 */
  readonly windowCount: number;
  /** 跨窗去重后的参数集总数（全部窗口 evaluatedSamples 的并集）。 */
  readonly uniqueParameterCount: number;
  /** 至少在一个窗口合格的参数集数。 */
  readonly everQualifiedParameterCount: number;
  /** consistent 参数集数。 */
  readonly consistentParameterCount: number;
  /** 被考察参数集明细（qualifiedWindowCount >= 1 者；按 parameterSetKey 升序，确定性）。 */
  readonly parameters: readonly RollingConsistencyParameterStat[];
  /** consistent 参数集聚合（按 medianTotalReturnPct 降序、key 升序破平；确定性）。 */
  readonly aggregate: {
    readonly count: number;
    readonly meanTotalReturnPct: number | null;
    readonly medianTotalReturnPct: number | null;
    readonly meanMaxDrawdownPct: number | null;
    readonly maxMaxDrawdownPct: number | null;
  } | null;
}

// ---------------------------------------------------------------------------
// 跨窗汇总候选策略（kind = "candidate"，非 production / final）
// ---------------------------------------------------------------------------

/**
 * 跨窗一致性成立的参数集被物化的 Candidate Strategy（Rolling 汇总形态）。
 *
 * 语义与 C-17.1 单窗候选一致：kind = "candidate"，不是生产/终版策略声明；参数集在
 * 每个被评估窗口中都合格，绩效摘要 = 跨合格窗口的聚合统计（均值/中位数/最差，非单点
 * 极值），并携带 qualifiedWindowIds 溯源。升级 / 推广到生产由生命周期（C-21.1）负责。
 */
export interface RollingOptimizationCandidate {
  readonly recordKind: typeof ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND;
  readonly recordVersion: typeof ROLLING_OPTIMIZATION_CANDIDATE_RECORD_VERSION;
  /** 候选 ID（= `${runId}-candidate-${序号}`，Run 内唯一）。 */
  readonly candidateId: string;
  /** §19 语义标签：候选策略（非 production / final）。 */
  readonly strategyKind: "candidate";
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameterSet: ResearchParameterSet;
  /** 跨合格窗口聚合绩效（均值/中位数/最差）。 */
  readonly performance: {
    readonly meanTotalReturnPct: number;
    readonly medianTotalReturnPct: number;
    readonly meanMaxDrawdownPct: number;
    readonly maxMaxDrawdownPct: number;
  };
  /** 一致性溯源（覆盖窗口集合与合格计数）。 */
  readonly consistency: {
    readonly evaluatedWindowCount: number;
    readonly qualifiedWindowCount: number;
    readonly qualifiedWindowIds: readonly string[];
  };
  /** 归属 RollingOptimizationRun（溯源）。 */
  readonly runId: string;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// RollingOptimizationRun（一次滚动优化的完整实验记录）
// ---------------------------------------------------------------------------

/**
 * 一次 Rolling Optimization 的完整实验记录（不可变、可 JSON 序列化、带 fingerprint）。
 *
 * 内容（§19「记录完整实验信息」+ 本任务目标）：
 *   - 运行身份：runId / strategyId@strategyVersion / method / seed / budget / createdAt；
 *   - 输入快照：tradeDates 交易日历 + 指纹、parameterSpace + 指纹、窗口配置、区域口径、
 *     一致性口径（全部解析后自描述）；
 *   - 逐窗结果：windows[]（每窗含 windowId/交易日范围 + 完整 C-17.1 SearchRun）；
 *   - 跨窗结论：stability（verdict / 明细 / 聚合）+ candidates（跨窗汇总候选，kind=candidate）。
 */
export interface RollingOptimizationRun {
  readonly recordKind: typeof ROLLING_OPTIMIZATION_RUN_RECORD_KIND;
  readonly recordVersion: typeof ROLLING_OPTIMIZATION_RUN_RECORD_VERSION;
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly method: RollingOptimizationMethod;
  /** random：基准 seed（整数；逐窗派生 seed = seed + windowIndex）；grid：null。 */
  readonly seed: number | null;
  /** 请求预算（random = 每窗采样预算；grid = 每窗全组合基数）。 */
  readonly requestedBudget: number;
  /** 参数空间（冻结快照；逐窗搜索共用同一空间）。 */
  readonly parameterSpace: ParameterSpace;
  /** 参数空间 canonical fingerprint（桥接 sweep.computeParameterSpaceFingerprint）。 */
  readonly parameterSpaceFingerprint: string;
  /** 交易日历（升序、无重复；数据集实际交易日，窗口锚定于此）。 */
  readonly tradeDates: readonly string[];
  /** 交易日历内容指纹（sha256，canonical）。 */
  readonly tradeDatesFingerprint: string;
  /** 窗口配置（解析后）。 */
  readonly windowConfig: ResolvedRollingWindowConfig;
  /** 逐窗搜索的稳定区判定口径（解析后，全窗一致）。 */
  readonly analysisConfig: ResolvedRegionAnalysisConfig;
  /** 跨窗一致性判定口径（解析后）。 */
  readonly stabilityConfig: ResolvedRollingStabilityConfig;
  /** 实际生成窗口数（= windows.length）。 */
  readonly windowCount: number;
  /** 逐窗结果（windowIndex 升序）。 */
  readonly windows: readonly RollingOptimizationWindowEntry[];
  /** 跨窗一致性结论。 */
  readonly stability: RollingConsistencyReport;
  /** 跨窗汇总候选策略（非生产；§19 Candidate Strategies）。 */
  readonly candidates: readonly RollingOptimizationCandidate[];
  /** 运行记录创建时间（ISO-8601 UTC；实验元数据，由调用方/入口注入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 滚动优化请求（runRollingOptimization 输入）
// ---------------------------------------------------------------------------

/** 一次 Rolling Optimization 请求。 */
export interface RollingOptimizationRequest {
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 逐窗搜索方法（全 run 一致）。 */
  readonly method: RollingOptimizationMethod;
  /** 参数空间（冻结使用，不修改入参；逐窗共用）。 */
  readonly parameterSpace: ParameterSpace;
  /** 数据集交易日序列（升序、无重复；窗口锚定于此）。 */
  readonly tradeDates: readonly string[];
  /** 窗内评估器工厂（纯函数；见 RollingOptimizationEvaluatorFactory）。 */
  readonly evaluatorFactory: RollingOptimizationEvaluatorFactory;
  /** 窗口配置（windowLength / stepLength 必填）。 */
  readonly windowConfig: RollingWindowConfig;
  /** 稳定区判定口径（缺省 = C-17.1 DEFAULT_REGION_ANALYSIS_CONFIG，逐窗一致）。 */
  readonly analysis?: RegionAnalysisConfig;
  /** 跨窗一致性口径（缺省 DEFAULT_ROLLING_STABILITY_CONFIG）。 */
  readonly stability?: RollingStabilityConfig;
  /** random：基准 seed（整数；逐窗 seed = seed + windowIndex）；grid：忽略。 */
  readonly seed?: number;
  /** random：每窗采样预算（>= 1）；grid：忽略。 */
  readonly budget?: number;
  /** grid：全组合上限（>= 1）；random：忽略。 */
  readonly maxCombinations?: number;
  /** runId（缺省自动生成 ROLLING-YYYYMMDD-XXXXXXXX；注入则确定性）。 */
  readonly runId?: string;
  /** 创建时间（ISO-8601 UTC；缺省当前时间；元数据非复现输入）。 */
  readonly createdAt?: string;
}
