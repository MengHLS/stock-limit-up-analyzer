/**
 * STEP 20 / C-20.1 — 过拟合检测（第一批）：PBO + 参数敏感性 + 判定聚合。类型契约权威源。
 *
 * 定位与边界（ROADMAP §22「STEP 20 — Overfitting Detection」+ TASK_TRACKING §3.6 C-20.1）：
 *
 *   C-20.1 是**第一批**过拟合检测能力交付，**只**包含两个能力：
 *     - **PBO（Probability of Backtest Overfitting）**：Combinatorially-Symmetric
 *       Cross-Validation（CSCV，Bailey et al.）风格的过拟合概率估计；
 *     - **参数敏感性（Parameter Sensitivity）**：在固定 OOS 集合上对参数做局部邻域
 *       扰动 + 重估绩效 + 敏感度度量。
 *
 *   **不做**（明确留给 C-20.2：因子消融与 OOS 退化）：
 *     - Factor Ablation（因子消融）；
 *     - Perturbation Test（针对非参数因子的扰动，如 cost/slippage 之外的语义扰动）；
 *     - OOS Degradation（识别「回测好、泛化差」的具体退化形态学）；
 *     - cross-validated PBO（CV-PBO）等更复杂贝叶斯收缩估计（明确 unassessed）；
 *     - 「策略能否上线」结论（属 C-21 生命周期 / C-25 闭环）。
 *
 * 与相邻 STEP 的关系（**只读复用，不复制、不重写**）：
 *   - C-17.1（parameterSearch）：Candidate / SearchRun / `CandidateRegionReport` 含稳定
 *     区成员与聚合统计——PBO 的「OOS 序列」可由 Candidate 的跨窗样本均值（或调用方注入）
 *     派生，本模块不重写 candidate 逻辑；
 *   - C-18.1（robustness）：`generateParameterPerturbationVariants` 已实现「数值参数
 *     ±%/±档 局部邻域」扰动器——本模块**直接 import 复用**该扰动集合作为参数敏感性的
 *     扰动源，不自造；
 *   - C-18.1（robustness）：`resolveRobustnessThresholds` / `RobustnessThresholds`
 *     （收益漂移 5pp / 回撤恶化 3pp）作为敏感度判定的语义参考——本模块**只 import 类型
 *     与常量**，不重算阈值语义；
 *   - C-19.2（oosIsolation）：`WindowResultRecord.test.totalReturnPct / maxDrawdownPct`、
 *     `OosSegmentMetrics` 可作为 PBO 的输入源（调用方侧已校验 IS/OOS 隔离纪律）；本模块
 *     **只消费标量**（不做隔离记录层职责）；
 *   - `shared/quant-stats`（percentile / mean / sampleStandardDeviation 等）——敏感度
 *     度量（σ、CV、分位）的统计原语复用，不重写；
 *   - **STEP 6.5 pbo.ts / parameterStability.ts / overfittingAssessment.ts**：既有生产
 *     形态（与本模块的 STEP 20 版本**不同**）；STEP 6.5 PBO 仅做 IS/OOS 倒置统计，本
 *     模块的 PBO 在此之上加「零分布 + 分位 CI + 判定结论 + reasonCode」；本模块
 *     **不复用** STEP 6.5 pbo.ts 的 computePbo（不同形态、不同语义、不同 reasonCode 集），
 *     由本模块独立实现 CSCV 划分 + 排名 + 倒置统计 + 零分布。
 *
 * 铁律（对齐项目最高规范 §0/§36/§42/§44.4）：
 *   - **PIT 安全**：PBO / 参数敏感性的输入与标签只取 T 时刻已知信息；
 *   - **确定性**：纯函数、readonly 入参、无 `Date.now()` / `Math.random()` / IO；
 *   - **指纹防篡改**：`canonicalStringify`（server/researchDataset/version.ts，键字典序）
 *     + sha256 + serialize / deserialize / validate round-trip；
 *   - **FAIL FAST**：数据不足 / 参数非法 / 无 OOS 结果 → 响亮抛错或显式 `unassessed`
 *     + reasonCode；不静默 PBO=0、不冒充实证结论；
 *   - **诚实边界**：PBO 仅做 CSCV 切分 + 对称排名倒置，不做更复杂的贝叶斯收缩 / CV-PBO；
 *     参数敏感性仅是「在固定 OOS 上对参数扰动的绩效响应」，不是「在 OOS 上重训」
 *     （重训属 C-17.2 跨窗一致性 / C-20.2）。
 */

import type { ResearchParameterSet } from "../types";
import {
  DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
  DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
} from "../robustness";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** PBO 记录 schema 版本：字段语义变更必须递增。 */
export const OFD_PBO_RESULT_RECORD_VERSION = 1 as const;

/** ParameterSensitivityResult 记录 schema 版本。 */
export const PARAMETER_SENSITIVITY_RECORD_VERSION = 1 as const;

/** OverfittingAssessmentRun 记录 schema 版本。 */
export const OVERFITTING_ASSESSMENT_RUN_RECORD_VERSION = 1 as const;

/** OverfittingAssessmentRun 记录种类标签。 */
export const OVERFITTING_ASSESSMENT_RUN_RECORD_KIND = "OVERFITTING_ASSESSMENT_RUN" as const;

/** OverfittingAssessmentRun ID 前缀（`OFA-YYYYMMDD-XXXXXXXX`，风格对齐 WFA-* / OOSISO-*）。 */
export const OVERFITTING_ASSESSMENT_RUN_ID_PREFIX = "OFA" as const;

// ---------------------------------------------------------------------------
// 通用：评估契约
// ---------------------------------------------------------------------------

/**
 * 单次 OOS 段评估的标量（参数敏感性 + 可选 PBO 候选的 OOS 序列元素复用）。
 *
 * 字段极小：仅收益 + 回撤两个标量（与 C-18.1 RobustnessMetricsView / C-17.1
 * ParameterSearchMetricsView 同口径，便于 evaluator 桥接），便于调用方在不重写
 * 评估管线的前提下桥接 OOS 结果。
 */
export interface OverfittingMetricsView {
  /** 总收益率（%，可为负；必须有限）。 */
  readonly totalReturnPct: number;
  /** 最大回撤深度（%，>= 0；必须有限）。 */
  readonly maxDrawdownPct: number;
  /** 成交笔数；未知为 null；提供时必须为 >= 0 整数。 */
  readonly tradeCount: number | null;
}

/**
 * 单次评估产物（成功携带标量；失败携带结构化错误）。
 * 与 C-18.1 / C-17.1 同构，便于桥接既有 evaluator。
 */
export type OverfittingSampleOutcome =
  | { readonly status: "succeeded"; readonly metrics: OverfittingMetricsView }
  | { readonly status: "failed"; readonly error: string };

// ---------------------------------------------------------------------------
// PBO（Combinatorially-Symmetric Cross-Validation，CSCV）
// ---------------------------------------------------------------------------

/** PBO 评估指标方向。 */
export type OfdPboSelectionDirection = "maximize" | "minimize";

/** PBO 评估指标名（机器可读；扩展槽仅在断言集中加入）。 */
export type OfdPboMetricName = "totalReturnPct" | "sharpeRatio" | "custom";

/**
 * CSCV 单个候选：一次参数组合在 N 个分区上的选择指标序列。
 *
 * **数据来源约定**：
 *   - 「分区指标」一般可由 OOS 时序回报序列按时间顺序切分为 N 段后，对每段计算选择
 *     指标（如 Sharpe / totalReturnPct / custom evaluator 标量）得到；
 *   - 调用方应保证分区指标计算时**只用 T 及之前的已知信息**（PIT 安全）——本模块不
 *     执行回测 / 评估，只对**已计算好的分区标量**做 CSCV 倒置统计。
 */
export interface OfdPboCandidate {
  /** 候选唯一 ID（参数集 canonical 键或 SearchRun 内 sampleIndex 派生；调用方负责唯一）。 */
  readonly candidateId: string;
  /** 候选参数集（用于指纹 + 审计；不参与 CSCV 数学）。 */
  readonly parameterSet: ResearchParameterSet;
  /** 每个分区（0-based）的选择指标值；长度必须 = numPartitions；null/NaN/Infinity = 非法。 */
  readonly partitionMetrics: ReadonlyArray<number | null>;
}

/**
 * PBO 评估输入（一个候选集合 + 评估指标 + 分区数）。
 */
export interface OfdPboInput {
  /** 分区数 N（偶数、>= 4；与 STEP 6.5 pbo.ts 一致，确保 CSCV 切分几何稳定）。 */
  readonly numPartitions: number;
  /** 候选列表（>= 2 否则 insufficient_data）。 */
  readonly candidates: readonly OfdPboCandidate[];
  /** 评估指标名（仅供审计；CSCV 数学只看 partitionMetrics 数值）。 */
  readonly metric: OfdPboMetricName;
  /** 评估方向（maximize = 越大越好；minimize = 越小越好）。 */
  readonly direction: OfdPboSelectionDirection;
}

/**
 * 一个去对称后的 CSCV Train/Test 划分（分区号 1-based，升序）。
 *
 * 沿用 STEP 6.5 pbo.ts 的约定：对 N=4 产生 3 个划分
 * `{1,2}|{3,4}`、`{1,3}|{2,4}`、`{1,4}|{2,3}`（仅保留含分区 1 的组合，去对称重复）。
 */
export interface OfdPboCscvSplit {
  readonly trainPartitions: readonly number[];
  readonly testPartitions: readonly number[];
}

/**
 * 单个划分的 PBO 审计明细（CSCV 倒置统计的最小可见单元）。
 */
export interface OfdPboSplitResult {
  readonly trainPartitions: readonly number[];
  readonly testPartitions: readonly number[];
  /** 样本内（Train）最优候选 ID。 */
  readonly selectedCandidateId: string;
  /** 该候选在 Train 上的标量指标（分区算术平均）。 */
  readonly trainMetric: number;
  /** 该候选在 Test 上的排名（1 = 最优）。 */
  readonly testRank: number;
  /** Test 相对排名：0 = 最优，1 = 最差；不可用 → null（仅 1 个候选时）。 */
  readonly testPercentile: number | null;
  /** 该次划分的「Train 最优 / Test 中位以下」倒置观察（落入 Test 最差一半）。 */
  readonly isOverfit: boolean;
}

/**
 * PBO 零分布统计（per-split 倒置观察的频次分布）。
 *
 * 含义：在 C(S, S/2) 个 CSCV 划分中，有 `overfitCount` 个划分的 IS 最优候选落入 Test
 * 最差一半。**经验分布**由 `overfitRateBuckets` 给出（倒置观察按 10% 分位区间统计的
 * 频次），便于跨研究比较——**不做**任何贝叶斯收缩 / CV-PBO / BCa 等偏差校正。
 */
export interface OfdPboZeroDistribution {
  /** 倒置观察次数（= overfitCount）。 */
  readonly overfitCount: number;
  /** 总评估划分次数（= evaluatedCombinations）。 */
  readonly evaluatedCombinations: number;
  /** 倒置率（0~1）= overfitCount / evaluatedCombinations。 */
  readonly overfitRate: number;
  /** 经验分位统计（max / p95 / p75 / median / p25 / p05 / min）。null = 划分不足。 */
  readonly quantiles: OfdPboQuantileSummary | null;
  /**
   * 10-bin 直方图（0..0.1 / 0.1..0.2 / ... / 0.9..1.0），按 testPercentile 落入分位区间。
   * 长度固定为 10；元素值 = 该 bin 内划分计数。仅 `evaluatedCombinations >= 10` 时有
   * 充分样本；否则照填（值可能很小）。
   */
  readonly histogram: readonly number[];
}

/**
 * 经验分位摘要（0~1 区间的标量分布描述）。
 */
export interface OfdPboQuantileSummary {
  readonly count: number;
  readonly mean: number;
  readonly stdDev: number;
  readonly min: number;
  readonly max: number;
  readonly p05: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p95: number;
}

/**
 * PBO 分位置信区间（百分位 CI；非 BCa / bootstrap-t，诚实声明）。
 *
 * 区间口径：下界 = P100·(alpha/2)、上界 = P100·(1 - alpha/2)（与 C-18.2
 * `StochasticConfidenceInterval` 口径一致，复用 percentile 原语）。
 */
export interface OfdPboQuantileCi {
  /** 置信水平（0..1），典型 0.95。 */
  readonly confidenceLevel: number;
  /** 下界（0~1）。划分不足 → null。 */
  readonly lower: number | null;
  /** 上界（0~1）。划分不足 → null。 */
  readonly upper: number | null;
}

/**
 * PBO 判定结论（与 STEP 6.5 overfittingAssessment 的 OVERFIT/INCONCLUSIVE 概念隔离）。
 *
 *   - `OVERFIT_RISK_HIGH`    ：PBO >= pboHigh（默认 0.5）→ 显著过拟合风险；
 *   - `OVERFIT_RISK_MODERATE`：pboMedium <= PBO < pboHigh → 中度过拟合风险；
 *   - `OVERFIT_RISK_LOW`     ：PBO < pboMedium → 弱过拟合风险（但 PBO=0 不等于无风险）；
 *   - `INCONCLUSIVE`         ：数据不足（候选 < 2 或有效划分不足），不下结论。
 *
 * 与 STEP 6.5 overfittingAssessment 的 `low | medium | high | insufficient_data` 命名
 * 不同（避免域前缀混淆）；本模块统一 `OVERFIT_RISK_*` 域。
 */
export type OfdPboConclusion = "OVERFIT_RISK_HIGH" | "OVERFIT_RISK_MODERATE" | "OVERFIT_RISK_LOW" | "INCONCLUSIVE";

/**
 * PBO 判定阈值（部分字段可缺省，由 `resolveOfdPboThresholds` 补齐）。
 *
 * 沿用 STEP 6.5 overfittingAssessment.DEFAULT_OVERFITTING_THRESHOLDS 口径
 * （pboHigh=0.5 / pboMedium=0.25）——研究层阈值一致便于跨研究比较。
 */
export interface OfdPboThresholds {
  readonly pboHigh?: number;
  readonly pboMedium?: number;
}

/** 解析后的 PBO 阈值（全字段有限 + 自描述）。 */
export interface ResolvedOfdPboThresholds {
  readonly pboHigh: number;
  readonly pboMedium: number;
}

/**
 * PBO 结果（一次 PBO 评估的完整记录）。
 *
 *   - status="computed" → pbo / zeroDistribution / quantileCi / conclusion 全部有值；
 *   - status="insufficient_data" → pbo=null，零分布/CI/conclusion = `INCONCLUSIVE` 标记；
 *   - reasonCode 给出数据不足的精确原因（机器可读），便于上层聚合判定。
 */
export interface OfdPboResult {
  readonly numPartitions: number;
  /** 理论去对称划分总数 C(N, N/2)/2。 */
  readonly numCombinations: number;
  /** 实际可评估的划分数（有效候选 >= 2）。 */
  readonly evaluatedCombinations: number;
  /** 倒置观察次数。 */
  readonly overfitCount: number;
  /** overfitCount / evaluatedCombinations；数据不足时为 null。 */
  readonly pbo: number | null;
  readonly status: "computed" | "insufficient_data";
  readonly metric: OfdPboMetricName;
  readonly direction: OfdPboSelectionDirection;
  /** 倒置观察的零分布统计（status="computed" 时有值；insufficient_data 时为 null）。 */
  readonly zeroDistribution: OfdPboZeroDistribution | null;
  /** 分位置信区间（status="computed" 时有值；insufficient_data 时为 null）。 */
  readonly quantileCi: OfdPboQuantileCi | null;
  /** 判定结论（含 INCONCLUSIVE 用于聚合）。 */
  readonly conclusion: OfdPboConclusion;
  /** 数据不足原因码（status="computed" 时为 null）。 */
  readonly reasonCode: OfdPboInsufficientReasonCode | null;
  /** 内容指纹（sha256，十六进制）：除 fingerprint 外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
  /** 单划分明细（status="computed" 时有值；insufficient_data 时为 []）。 */
  readonly splitResults: readonly OfdPboSplitResult[];
}

/**
 * PBO 数据不足原因码（机器可读，便于聚合判定优先级）。
 *
 *   - `PBO_INSUFFICIENT_CANDIDATES` ：候选数 < 2；
 *   - `PBO_INSUFFICIENT_BLOCKS`    ：分区数不足（< 4 或奇数）；
 *   - `PBO_NO_VALID_SPLIT`         ：所有划分都因有效候选 < 2 而被跳过；
 *   - `PBO_INVALID_METRIC`         ：输入参数非法（空 / 非数 / NaN / Infinity）。
 */
export type OfdPboInsufficientReasonCode =
  | "PBO_INSUFFICIENT_CANDIDATES"
  | "PBO_INSUFFICIENT_BLOCKS"
  | "PBO_NO_VALID_SPLIT"
  | "PBO_INVALID_METRIC";

export const OFD_PBO_INSUFFICIENT_REASON_CODES: readonly OfdPboInsufficientReasonCode[] = [
  "PBO_INSUFFICIENT_CANDIDATES",
  "PBO_INSUFFICIENT_BLOCKS",
  "PBO_NO_VALID_SPLIT",
  "PBO_INVALID_METRIC",
];

// ---------------------------------------------------------------------------
// 参数敏感性（Parameter Sensitivity）
// ---------------------------------------------------------------------------

/**
 * 参数敏感性评估输入：基础参数集 + 评估器 + 扰动规则。
 *
 * 评估器是注入式的（evaluator(perturbedParameterSet) → Outcome），与 C-18.1
 * RobustnessEvaluator 同构；本模块不执行真实回测。
 */
export interface ParameterSensitivityInput {
  /** 基础参数集（C-17.1 Candidate 或调用方注入）。 */
  readonly baseParameterSet: ResearchParameterSet;
  /** 数值参数扰动规则（参数名不得重复；与 C-18.1 ParameterPerturbationRule 同构）。 */
  readonly rules: readonly ParameterSensitivityRule[];
  /** 注入式评估器（接收扰动后参数集 → 评估产物）。 */
  readonly evaluator: ParameterSensitivityEvaluator;
  /** 敏感度阈值（缺省沿用 C-18.1 resolveRobustnessThresholds 缺省：收益 5pp / 回撤 3pp）。 */
  readonly thresholds?: ParameterSensitivityThresholds;
}

/**
 * 单个数值参数的扰动规则（与 C-18.1 ParameterPerturbationRule 同构，但本模块自持类型
 * 以避免域耦合）。
 */
export interface ParameterSensitivityRule {
  readonly parameterName: string;
  readonly percentSteps?: readonly number[];
  readonly additiveSteps?: readonly number[];
}

/**
 * 注入式评估器：扰动后参数集 → 评估产物。
 */
export type ParameterSensitivityEvaluator = (
  parameterSet: ResearchParameterSet,
) => OverfittingSampleOutcome;

/**
 * 敏感度阈值（沿用 C-18.1 RobustnessThresholds 字段；本模块只 import 字段名与默认常量，
 * 不 import 其实现，避免域耦合）。
 */
export interface ParameterSensitivityThresholds {
  /** 收益漂移阈值（百分点，绝对）：|ΔtotalReturnPct| > 该值 → 敏感。缺省 5。 */
  readonly returnDriftThresholdPct?: number;
  /** 回撤恶化阈值（百分点，绝对）：ΔmaxDrawdownPct > 该值 → 敏感。缺省 3。 */
  readonly drawdownWorseningThresholdPct?: number;
}

/** 解析后的敏感度阈值。 */
export interface ResolvedParameterSensitivityThresholds {
  readonly returnDriftThresholdPct: number;
  readonly drawdownWorseningThresholdPct: number;
}

/**
 * 单条扰动的敏感度明细（与 C-18.1 RobustnessSample 同构但域独立）。
 */
export interface ParameterSensitivitySample {
  /** 扰动后参数集。 */
  readonly perturbedParameterSet: ResearchParameterSet;
  /** 扰动标识（`${parameterName}_PCT_${sign}${magnitude}` / `${parameterName}_ADD_${sign}${magnitude}`，或 `BASELINE`）。 */
  readonly perturbationCode: string;
  /** 中文标签（审计用途，不参与计算）。 */
  readonly perturbationLabel: string;
  /** 是否 = 基准（×1 / 原参数集；恰一条且恒在 samples[0]）。 */
  readonly isBaseline: boolean;
  /** 评估状态。 */
  readonly status: "succeeded" | "failed";
  /** status=succeeded 时为有限数值；failed 时为 null。 */
  readonly totalReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly tradeCount: number | null;
  /** status=failed 时的结构化错误；succeeded 时为 null。 */
  readonly error: string | null;
  /** 判定（baseline | stable | sensitive | failed | skipped）。 */
  readonly verdict: ParameterSensitivityVerdict;
  /** 漂移分解（仅非基准成功样本有值）。 */
  readonly drift: ParameterSensitivityDrift | null;
}

/** 单样本判定。 */
export type ParameterSensitivityVerdict = "baseline" | "stable" | "sensitive" | "failed" | "skipped";

/**
 * 漂移分解（与 C-18.1 PerturbationDrift 同构但域独立）。
 */
export interface ParameterSensitivityDrift {
  /** 收益漂移（百分点）= 扰动 totalReturnPct − 基准 totalReturnPct。 */
  readonly returnDriftPct: number;
  /** 回撤变化（百分点）= 扰动 maxDrawdownPct − 基准 maxDrawdownPct。 */
  readonly drawdownChangePct: number;
  /** 回撤恶化量（百分点）= max(0, drawdownChangePct)。 */
  readonly drawdownWorseningPct: number;
  /** 命中阈值触发的敏感标签（空 = 无敏感）。 */
  readonly flags: readonly ParameterSensitivityFlag[];
}

export type ParameterSensitivityFlag = "RETURN_DRIFT" | "DRAWDOWN_WORSENING";

/**
 * 敏感度度量（描述性统计；非「有意义的稳定性评分」——参数敏感性只在「漂移是否超阈」
 * 层面下结论，绝对标量只是辅助审计）。
 *
 *   - maxReturnDriftPct / maxDrawdownWorseningPct ：单条扰动相对基准的最大绝对漂移；
 *   - returnDriftStdDevPct / drawdownStdDevPct     ：逐扰动漂移的样本标准差；
 *   - returnDriftCvPct                             ：收益漂移变异系数（stdDev / |mean|），
 *     mean === 0 时返回 null（不可计算）；
 *   - elasticityPct                                ：|mean(returnDriftPct)| / |mean(基准绩效)|
 *     （弹性口径；基线收益近 0 时返回 null）。
 */
export interface ParameterSensitivityMeasure {
  readonly evaluatedNonBaselineCount: number;
  readonly failedNonBaselineCount: number;
  readonly sensitiveNonBaselineCount: number;
  readonly stableNonBaselineCount: number;
  readonly maxReturnDriftPct: number | null;
  readonly maxDrawdownWorseningPct: number | null;
  readonly returnDriftStdDevPct: number | null;
  readonly drawdownStdDevPct: number | null;
  readonly returnDriftCvPct: number | null;
  readonly elasticityPct: number | null;
}

/**
 * 参数敏感性判定结论。
 *
 *   - `SENSITIVE`    ：至少一条非基准扰动命中漂移阈值；
 *   - `STABLE`       ：存在非基准扰动且全部稳定；
 *   - `INCONCLUSIVE` ：无非基准扰动 / 全部评估失败 / 基准评估失败；
 *   - `NO_VARIANTS`  ：扰动规则空 / 全部被跳过。
 */
export type ParameterSensitivityConclusion = "SENSITIVE" | "STABLE" | "INCONCLUSIVE" | "NO_VARIANTS";

/**
 * 参数敏感性结果（一次评估的完整记录）。
 */
export interface ParameterSensitivityResult {
  readonly recordVersion: typeof PARAMETER_SENSITIVITY_RECORD_VERSION;
  /** 基础参数集（指纹溯源）。 */
  readonly baseParameterSet: ResearchParameterSet;
  /** 扰动规则（解析后 / 自描述）。 */
  readonly rules: readonly ParameterSensitivityRule[];
  /** 解析后的敏感度阈值。 */
  readonly thresholds: ResolvedParameterSensitivityThresholds;
  /** 评估样本（含基准 + 非基准 + 跳过/失败）；索引 0 = 基准条目。 */
  readonly samples: readonly ParameterSensitivitySample[];
  /** 敏感度度量。 */
  readonly measure: ParameterSensitivityMeasure;
  /** 判定结论。 */
  readonly conclusion: ParameterSensitivityConclusion;
  /** 数据不足 / 退化原因码（null = 数据齐全 + 已下结论）。 */
  readonly reasonCode: ParameterSensitivityReasonCode | null;
  /** 内容指纹（sha256，十六进制）：除 fingerprint 外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

/**
 * 参数敏感性退化 / 数据不足原因码。
 *
 *   - `PS_RULES_EMPTY`        ：扰动规则为空（仅基准）→ NO_VARIANTS；
 *   - `PS_ALL_PERTURBATIONS_SKIPPED`：所有扰动被生成器跳过（非数值参数 / 非法步）；
 *   - `PS_BASELINE_FAILED`    ：基准评估失败（无漂移锚点）；
 *   - `PS_ALL_PERTURBATIONS_FAILED`：所有非基准扰动评估失败；
 *   - `PS_INVALID_THRESHOLDS` ：阈值非法。
 */
export type ParameterSensitivityReasonCode =
  | "PS_RULES_EMPTY"
  | "PS_ALL_PERTURBATIONS_SKIPPED"
  | "PS_BASELINE_FAILED"
  | "PS_ALL_PERTURBATIONS_FAILED"
  | "PS_INVALID_THRESHOLDS";

export const PARAMETER_SENSITIVITY_REASON_CODES: readonly ParameterSensitivityReasonCode[] = [
  "PS_RULES_EMPTY",
  "PS_ALL_PERTURBATIONS_SKIPPED",
  "PS_BASELINE_FAILED",
  "PS_ALL_PERTURBATIONS_FAILED",
  "PS_INVALID_THRESHOLDS",
];

// ---------------------------------------------------------------------------
// OverfittingAssessmentRun（聚合 PBO + 参数敏感性 + 可选鲁棒性结果）
// ---------------------------------------------------------------------------

/**
 * Overfitting 判定聚合输入。
 *
 *   - pbo：PBO 结果（C-20.1 内部产物）；可缺省；
 *   - parameterSensitivity：参数敏感性结果（C-20.1 内部产物）；可缺省；
 *   - robustnessRun：可选的 C-18.1 RobustnessRun（import 只读复用其结论）；
 *     不强制必填——单轴 C-18.1 可与本模块联合评估过拟合风险。
 */
export interface OfdAssessmentInput {
  readonly pbo: OfdPboResult | null;
  readonly parameterSensitivity: ParameterSensitivityResult | null;
  readonly robustnessView: ParameterSensitivityRobustnessView | null;
  readonly thresholds?: OfdPboThresholds;
}

/**
 * C-18.1 RobustnessRun 的最小视图（只读 type-import，避免直接依赖 C-18.1 内部类型
 * 引起的循环 import 与域耦合）。
 *
 * 字段极小：仅聚合结论（轴级 verdict + 敏感计数 + 基准成功）+ 阈值，用于聚合判定。
 */
export interface ParameterSensitivityRobustnessView {
  readonly axis: string;
  readonly verdict: string;
  readonly baselineSucceeded: boolean;
  readonly sensitiveCount: number;
  readonly stableCount: number;
  readonly failedCount: number;
  readonly sampleCount: number;
  readonly thresholds: {
    readonly returnDriftThresholdPct: number;
    readonly drawdownWorseningThresholdPct: number;
  };
  /** 来源 RobustnessRun.fingerprint（防脱钩）。 */
  readonly sourceFingerprint: string;
}

/**
 * Overfitting 判定聚合结论。
 *
 *   - `OVERFIT`        ：PBO OVERFIT_RISK_HIGH 或 参数敏感性 SENSITIVE（任一强信号）；
 *   - `OVERFIT_RISK`   ：PBO OVERFIT_RISK_MODERATE 或 部分敏感；
 *   - `NOT_OVERFIT`    ：所有证据 LOW/STABLE；
 *   - `INCONCLUSIVE`   ：主证据（pbo 与 parameterSensitivity）均不可用 / 数据不足；
 *   - `NO_EVAL`        ：全部输入均为 null（未评估）。
 */
export type OverfittingConclusion =
  | "OVERFIT"
  | "OVERFIT_RISK"
  | "NOT_OVERFIT"
  | "INCONCLUSIVE"
  | "NO_EVAL";

/**
 * Overfitting 聚合评估运行（一次过拟合检测的完整记录）。
 *
 * 不下「策略能否上线」结论（属 C-21 / C-25）；本记录只承载「多信号过拟合风险评估」
 * 的事实快照与判定。
 */
export interface OverfittingAssessmentRun {
  readonly recordKind: typeof OVERFITTING_ASSESSMENT_RUN_RECORD_KIND;
  readonly recordVersion: typeof OVERFITTING_ASSESSMENT_RUN_RECORD_VERSION;
  readonly assessmentRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly pbo: OfdPboResult | null;
  readonly parameterSensitivity: ParameterSensitivityResult | null;
  readonly robustnessView: ParameterSensitivityRobustnessView | null;
  readonly thresholds: ResolvedOfdPboThresholds;
  /** 聚合判定结论（含 reasonCode 优先级）。 */
  readonly conclusion: OverfittingConclusion;
  /** 人类可读的理由（按优先级倒序，便于审计）。 */
  readonly reasons: readonly string[];
  /** 运行记录创建时间（ISO-8601 UTC；调用方注入，非复现输入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256，十六进制）：除 fingerprint 外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 缺省阈值常量
// ---------------------------------------------------------------------------

/** PBO 高风险阈值（>= 该值 → OVERFIT_RISK_HIGH）。沿用 STEP 6.5 pboHigh=0.5。 */
export const DEFAULT_PBO_HIGH_THRESHOLD = 0.5;

/** PBO 中风险阈值（>= 该值 → OVERFIT_RISK_MODERATE）。沿用 STEP 6.5 pboMedium=0.25。 */
export const DEFAULT_PBO_MEDIUM_THRESHOLD = 0.25;

/** 收益漂移阈值缺省（百分点）— 从 C-18.1 复用，不重定义。 */
export {
  DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
  DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
};
