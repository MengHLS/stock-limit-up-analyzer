/**
 * STEP 18 / C-18.2 — 随机化鲁棒性测试（Monte Carlo / Bootstrap / Trade Order
 * Randomization）：类型契约。
 *
 * 背景与定位（ROADMAP §20；C-18.2 = 随机化三法）：
 *   - C-18.1（robustness）解决**确定性扰动**：成本 / 滑点 / 参数 / 执行四轴，
 *     逐条扰动重估 + 漂移敏感归因（收益绝对差 > 5pp、回撤恶化 > 3pp）。
 *   - 本目录解决**随机化重抽样**：在「同一批已实现收益」内部做 seeded 重采样 /
 *     置换，回答三类问题：
 *       ① Monte Carlo       —— 基准结果在随机重采样分布中的相对位置（是否只是
 *                              分布尾部的幸运样本？P(收益<0) / P(MaxDD>阈值) 多大？）；
 *       ② Bootstrap         —— trade 级收益有放回重抽样的经验分布与置信区间
 *                              （总收益 / Sharpe / MaxDD 的 CI），以及「基准统计量
 *                              是否显著优于随机重排」的**描述性**判定；
 *       ③ Trade Order       —— 保持交易集合不变、随机化成交顺序，检验结果依赖
 *                              「路径」还是「集合」（总收益对顺序不变，MaxDD 依赖顺序）。
 *
 * 与 C-18.1 的关系（import 只读，禁止改写其既有文件）：
 *   - 阈值语义复用 `resolveRobustnessThresholds`（收益漂移 5pp / 回撤恶化 3pp），
 *     使「确定性扰动敏感」与「随机化敏感」在同一口径下可比较；
 *   - 本目录**不修改** `RobustnessAxis` 联合类型（协调者统一处理，见交付报告）；
 *     方法字面量刻意取 `monteCarlo | bootstrap | orderRandomization`，与 C-18.1
 *     types.ts 头部注释预留的扩展槽命名一致，便于后续并入。
 *
 * 方法学诚实声明（重要，禁止在报告/使用中省略）：
 *   - 三种方法均为 **i.i.d. 重采样/置换**：Monte Carlo 与 Bootstrap 共用「有放回
 *     重抽样核」，差异在**统计口径与结论焦点**（MC 重分布位置与尾部概率、
 *     Bootstrap 重置信区间与描述性显著性），非两套算法重复实现；
 *   - i.i.d. 假设**破坏自相关 / 波动率聚集**：日收益序列的重采样会低估（或在某些
 *     形态下高估）连续回撤风险。日收益序列的 **block bootstrap / stationary
 *     bootstrap 未实现**，显式标记为 unassessed（见 `STOCHASTIC_METHOD_CAVEATS`）；
 *   - trade 级收益的 i.i.d. 重采样同样假设交易结果可交换（无仓位重叠、无资金
 *     约束、无市场状态切换）。真实并发持仓下的路径重建需由调用方注入
 *     `evaluator`（本目录不跑回测、不触 IO）；
 *   - **MC 参数扰动（参数随机扰动后重跑模拟）未实现**：需要参数空间采样（C-17.1
 *     `parameterSpace` 职责）+ 回测重跑，本目录仅提供 `evaluator` 注入口，
 *     不提供参数采样器。
 *
 * 铁律：
 *   - 全部字段 readonly；数值有限（NaN / ±Infinity 拒绝）；可 JSON 序列化；
 *   - 确定性：无 `Date.now` / `Math.random` / IO；随机性一律来自 seedable PRNG
 *     （本目录自实现 mulberry32，不跨模块 import 私有实现）；`createdAt` /
 *     `stochasticRunId` 由调用方注入；
 *   - FAIL FAST：退化输入（空序列 / 单点序列 / 非法 seed / 非法次数 / 收益率
 *     <= -100%）结构化抛错，禁止静默 NaN、禁止 clamp 掩盖；
 *   - 指纹防篡改：canonical JSON（键字典序）+ sha256，round-trip 复核。
 */

import type { ResolvedRobustnessThresholds, RobustnessThresholds } from "../robustness/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化 / 反序列化判别，防止类型混淆）。 */
export const STOCHASTIC_ROBUSTNESS_RUN_RECORD_KIND = "STOCHASTIC_ROBUSTNESS_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const STOCHASTIC_ROBUSTNESS_RUN_RECORD_VERSION = 1 as const;

/** StochasticRobustnessRun ID 前缀（风格对齐 C-17.1 SEARCH / C-18.1 ROBUST）。 */
export const STOCHASTIC_ROBUSTNESS_RUN_ID_PREFIX = "STOCH" as const;

// ---------------------------------------------------------------------------
// 方法
// ---------------------------------------------------------------------------

/**
 * 随机化方法。字面量沿用 C-18.1 types.ts 注释预留的扩展槽命名
 * （`"monteCarlo" | "bootstrap" | "orderRandomization"`），便于协调者后续并入
 * `RobustnessAxis` 联合类型。
 */
export type StochasticMethod = "monteCarlo" | "bootstrap" | "orderRandomization";

export const STOCHASTIC_METHOD_MONTE_CARLO = "monteCarlo" as const;
export const STOCHASTIC_METHOD_BOOTSTRAP = "bootstrap" as const;
export const STOCHASTIC_METHOD_ORDER_RANDOMIZATION = "orderRandomization" as const;

/** 全部方法（稳定顺序，供校验与遍历）。 */
export const STOCHASTIC_METHODS: readonly StochasticMethod[] = Object.freeze([
  STOCHASTIC_METHOD_MONTE_CARLO,
  STOCHASTIC_METHOD_BOOTSTRAP,
  STOCHASTIC_METHOD_ORDER_RANDOMIZATION,
]);

/** 方法中文标签（审计用途，不参与计算）。 */
export const STOCHASTIC_METHOD_LABELS: Readonly<Record<StochasticMethod, string>> = Object.freeze({
  monteCarlo: "蒙特卡洛重采样",
  bootstrap: "Bootstrap 有放回重抽样",
  orderRandomization: "成交顺序随机化",
});

/**
 * 方法学警告（中文，逐方法）。这些是**已知方法学边界**，不是缺陷掩饰：
 * 记录产物不内嵌本表，但判定文本与交付报告必须可见。
 */
export const STOCHASTIC_METHOD_CAVEATS: Readonly<Record<StochasticMethod, readonly string[]>> =
  Object.freeze({
    monteCarlo: Object.freeze([
      "i.i.d. 重采样破坏自相关与波动率聚集，日收益模式下的尾部风险估计偏乐观",
      "日收益序列的 block / stationary bootstrap 未实现（unassessed）",
      "参数扰动型蒙特卡洛（扰动后重跑回测）未实现，需调用方注入 evaluator",
    ]),
    bootstrap: Object.freeze([
      "i.i.d. 有放回重抽样假设 trade 级收益可交换（无仓位重叠、无资金约束、无市场状态切换）",
      "置信区间为百分位（percentile）CI，未做 BCa / bootstrap-t 偏差校正",
      "「显著优于随机重排」为描述性判定，不是假设检验承诺（无 p 值语义）",
    ]),
    orderRandomization: Object.freeze([
      "路径由 trade 级收益按给定顺序复利重建，不含现金、并发持仓与资金约束",
      "总收益对顺序数学不变（乘法交换律），故本方法只检验回撤/Sharpe 等路径依赖量",
      "真实并发持仓的路径依赖需调用方注入 evaluator 重跑模拟",
    ]),
  });

/** Monte Carlo 重采样对象（仅 method=monteCarlo 时有意义）。 */
export type StochasticMonteCarloMode = "dailyReturn" | "tradeReturn";

/** 实际被重采样/置换的序列来源（解析后自描述）。 */
export type StochasticSourceKind = "dailyReturn" | "tradeReturn";

// ---------------------------------------------------------------------------
// 绩效视图与样本
// ---------------------------------------------------------------------------

/**
 * 单次迭代的绩效标量（口径见 statistics.ts）：
 *   - totalReturnPct：按样本路径逐步复利的总收益（%）；
 *   - maxDrawdownPct：样本路径的最大回撤深度（%，>= 0）；
 *   - sharpe：日收益序列 → 年化 Sharpe（×√annualizationFactor，rf=0，与 C-16.2
 *     口径一致）；trade 级序列 → **每笔 Sharpe（不年化）**，因交易频率不固定，
 *     年化会伪造精度（见 statistics.ts 头注释）；
 *   - tradeCount：成交笔数回显（日收益模式由调用方透传；trade 模式 = 序列长度）。
 */
export interface StochasticMetricsView {
  readonly totalReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly sharpe: number | null;
  readonly tradeCount: number | null;
}

/** 参与分布摘要的指标键（tradeCount 不参与分布统计）。 */
export type StochasticMetricKey = "totalReturnPct" | "maxDrawdownPct" | "sharpe";

export const STOCHASTIC_METRIC_KEYS: readonly StochasticMetricKey[] = Object.freeze([
  "totalReturnPct",
  "maxDrawdownPct",
  "sharpe",
]);

/**
 * 一次随机化迭代的样本描述（交给 evaluator 或内置统计器）。
 *
 * - `stepReturns`：本次重排/重抽后的逐步收益（小数），**顺序即路径顺序**；
 * - `drawIndexes`：被抽中的原始下标序列（有放回：可重复；置换：0..n-1 的排列），
 *   用于审计与复现（记录中只保存其指纹，避免记录膨胀）。
 */
export interface StochasticSpecimen {
  /** 迭代序号（0-based）。 */
  readonly iteration: number;
  readonly method: StochasticMethod;
  readonly stepReturns: readonly number[];
  readonly drawIndexes: readonly number[];
  readonly tradeCount: number | null;
}

/**
 * 注入式评估器（可选）：specimen → 绩效标量。
 * 缺省使用内置确定性复利统计（statistics.ts）；调用方可用它接入真实模拟器重跑
 * （如并发持仓路径重建 / 参数扰动蒙特卡洛）。本目录不执行 IO / 回测。
 */
export type StochasticSampleEvaluator = (specimen: StochasticSpecimen) => StochasticMetricsView;

// ---------------------------------------------------------------------------
// 分布摘要 / 区间推断
// ---------------------------------------------------------------------------

/** 经验分位摘要（count 个成功样本；分位数用线性插值，见 shared/quant-stats）。 */
export interface StochasticQuantileSummary {
  /** 样本数（成功迭代数）。 */
  readonly count: number;
  readonly mean: number;
  /** 样本标准差；count < 2 → null。 */
  readonly stdDev: number | null;
  readonly min: number;
  readonly max: number;
  readonly p05: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p95: number;
}

/** 百分位置信区间（level 由 alpha 决定：level% = (1 − alpha) × 100）。 */
export interface StochasticConfidenceInterval {
  /** 置信水平（%，如 95）。 */
  readonly levelPct: number;
  readonly lower: number;
  readonly upper: number;
}

/** 单指标的分布 + 区间 + 基准相对位置。 */
export interface StochasticMetricInference {
  readonly summary: StochasticQuantileSummary;
  readonly confidenceInterval: StochasticConfidenceInterval;
  /**
   * 基准统计量在该经验分布中的百分位（0~100，中秩口径：
   * 100 × (count(s < b) + 0.5 × count(s == b)) / n）。基准值为 null → null。
   */
  readonly baselinePercentile: number | null;
  /** 基准是否落在置信区间内。 */
  readonly baselineWithinCi: boolean;
  /** 基准是否位于分布尾部（百分位 < alpha/2×100 或 > 100 − alpha/2×100）。 */
  readonly baselineInTail: boolean;
}

/** 三指标分布推断（sharpe 全样本为 null 时 → null）。 */
export interface StochasticDistributionSummary {
  readonly totalReturnPct: StochasticMetricInference;
  readonly maxDrawdownPct: StochasticMetricInference;
  readonly sharpe: StochasticMetricInference | null;
}

/** 尾部概率（%，0~100）。 */
export interface StochasticTailProbabilities {
  /** P(总收益 < 0)：重采样路径亏损的概率。 */
  readonly probLossPct: number;
  /** P(MaxDD > 阈值)：回撤击穿阈值的概率。 */
  readonly probDrawdownExceedsPct: number;
  /** 回撤阈值（%，自描述）。 */
  readonly drawdownThresholdPct: number;
  /** P(Sharpe < 0)；Sharpe 全部为 null → null。 */
  readonly probNegativeSharpePct: number | null;
}

/** Bootstrap 描述性显著性（仅 method=bootstrap 有值，其余方法为 null）。 */
export interface StochasticBootstrapSignificance {
  /** 描述性：总收益 CI 下界 > 0（区间不跨 0）。非假设检验承诺。 */
  readonly positiveReturnCiAboveZero: boolean;
  /** 基准总收益在 bootstrap 分布中的百分位（0~100）。 */
  readonly baselineTotalReturnPercentile: number | null;
  /** 基准相对重抽样分布的描述性位置。 */
  readonly descriptiveVerdict:
    | "above_resample_distribution"
    | "within_resample_distribution"
    | "below_resample_distribution"
    | "unassessed";
  /** 确定性生成的中文说明（含「非假设检验」声明）。 */
  readonly note: string;
}

// ---------------------------------------------------------------------------
// 结论
// ---------------------------------------------------------------------------

export type StochasticRobustnessVerdict = "stable" | "sensitive" | "inconclusive";

/**
 * 敏感触发标签：
 *   - RETURN_DISPERSION        总收益 CI 宽度 > returnDriftThresholdPct（C-18.1
 *                              收益漂移阈值语义：重抽样不确定性超过可容忍漂移）；
 *   - RETURN_CI_INCLUDES_ZERO  总收益 CI 跨 0（正收益无法与 0 区分）；
 *   - DRAWDOWN_TAIL            MaxDD 分布上尾（p95）相对基准恶化 >
 *                              drawdownWorseningThresholdPct（C-18.1 回撤语义）；
 *   - BASELINE_TAIL_FAVORABLE  基准总收益百分位 > 100 − alpha/2×100（基准优于绝
 *                              大多数重抽样结果 → 可能是尾部幸运样本）。
 */
export type StochasticSensitivityFlag =
  | "RETURN_DISPERSION"
  | "RETURN_CI_INCLUDES_ZERO"
  | "DRAWDOWN_TAIL"
  | "BASELINE_TAIL_FAVORABLE";

/** 判定理由码（与 verdict 配套，可审计）。 */
export type StochasticReasonCode =
  | "STOCHASTIC_STABLE"
  | "STOCHASTIC_BASELINE_TAIL_FAVORABLE"
  | "STOCHASTIC_RETURN_CI_INCLUDES_ZERO"
  | "STOCHASTIC_RETURN_DISPERSION"
  | "STOCHASTIC_DRAWDOWN_TAIL"
  | "STOCHASTIC_INSUFFICIENT_ITERATIONS"
  | "STOCHASTIC_INSUFFICIENT_SAMPLES"
  | "STOCHASTIC_BASELINE_UNAVAILABLE";

/** 随机化鲁棒性结论。 */
export interface StochasticRobustnessConclusion {
  readonly method: StochasticMethod;
  readonly verdict: StochasticRobustnessVerdict;
  readonly reasonCode: StochasticReasonCode;
  /** 命中的敏感标签（按固定优先级排序，见 verdict.ts）。 */
  readonly flags: readonly StochasticSensitivityFlag[];
  /** 成功迭代数（进入分布统计）。 */
  readonly successCount: number;
  /** 失败迭代数（evaluator 抛错 / 返回非法标量）。 */
  readonly failedCount: number;
  /** 判定所需最小成功迭代数（解析后）。 */
  readonly minIterationsForVerdict: number;
  /** 确定性生成的中文解读（描述性结论，不是假设检验承诺）。 */
  readonly interpretation: string;
}

// ---------------------------------------------------------------------------
// 配置（解析后自描述）
// ---------------------------------------------------------------------------

/** 解析后的运行配置（全部字段就绪，进入记录，保证记录自描述可复现）。 */
export interface StochasticResolvedConfig {
  readonly method: StochasticMethod;
  /** 计划迭代次数。 */
  readonly iterations: number;
  /** 显著性水平（0 < alpha < 1）；置信水平 = (1 − alpha) × 100。 */
  readonly alpha: number;
  /** 置信水平（%，自描述，= (1 − alpha) × 100）。 */
  readonly confidenceLevelPct: number;
  /** 年化因子（仅日收益模式用于 Sharpe 年化；trade 模式固定 1）。 */
  readonly annualizationFactor: number;
  /** 实际被重采样/置换的序列来源。 */
  readonly sourceKind: StochasticSourceKind;
  /** 源序列长度（自描述）。 */
  readonly sourceLength: number;
  /** P(MaxDD > X) 的回撤阈值 X（%）。 */
  readonly tailDrawdownThresholdPct: number;
  /** 判定所需最小成功迭代数；不足 → inconclusive。 */
  readonly minIterationsForVerdict: number;
  /** C-18.1 漂移阈值（import 只读，保持判定口径一致）。 */
  readonly thresholds: ResolvedRobustnessThresholds;
}

// ---------------------------------------------------------------------------
// 迭代样本与运行记录
// ---------------------------------------------------------------------------

/** 单次迭代结果（记录内保存；drawFingerprint 用于逐迭代复现审计）。 */
export interface StochasticIterationSample {
  readonly iteration: number;
  readonly status: "succeeded" | "failed";
  readonly metrics: StochasticMetricsView | null;
  readonly error: string | null;
  /** 本次抽样下标序列的 sha256 指纹（canonical JSON）。 */
  readonly drawFingerprint: string;
}

/**
 * 一次随机化鲁棒性测试的完整记录（不可变、可 JSON 序列化、带 fingerprint）。
 *
 * 内容（对齐 C-17.1 SearchRun / C-18.1 RobustnessRun 的实验记录哲学）：
 *   身份（stochasticRunId / strategyId@strategyVersion）+ 方法 + seed + 迭代次数
 *   + 输入指纹 + 分布摘要 + 尾部概率 + 基准位置 + 结论 + createdAt + 指纹。
 */
export interface StochasticRobustnessRun {
  readonly recordKind: typeof STOCHASTIC_ROBUSTNESS_RUN_RECORD_KIND;
  readonly recordVersion: typeof STOCHASTIC_ROBUSTNESS_RUN_RECORD_VERSION;
  readonly stochasticRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly method: StochasticMethod;
  /** 确定性 PRNG 种子（同 seed 必得同分布）。 */
  readonly seed: number;
  /** 计划迭代次数。 */
  readonly iterations: number;
  /** 解析后的完整口径配置。 */
  readonly config: StochasticResolvedConfig;
  /** 输入指纹：源序列（含 sourceKind）+ tradeCount + 基准统计的 canonical sha256。 */
  readonly inputFingerprint: string;
  /** 基准绩效（调用方注入或由源序列按内置口径计算）。 */
  readonly baseline: StochasticMetricsView;
  /**
   * 三指标经验分布 + 置信区间 + 基准相对位置。
   * 成功样本为 0（如全部迭代评估失败）→ **null**（禁止伪造空分布）。
   */
  readonly distribution: StochasticDistributionSummary | null;
  /** 尾部概率；成功样本为 0 → null。 */
  readonly tailProbabilities: StochasticTailProbabilities | null;
  /** 描述性显著性（method=bootstrap 有值；其余为 null）。 */
  readonly bootstrapSignificance: StochasticBootstrapSignificance | null;
  /** 逐迭代样本（含失败项）。 */
  readonly samples: readonly StochasticIterationSample[];
  readonly conclusion: StochasticRobustnessConclusion;
  /** 创建时间（ISO-8601 UTC；调用方注入，非复现输入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256 十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 运行请求
// ---------------------------------------------------------------------------

/** 运行请求（createdAt / stochasticRunId 由调用方注入，保证确定性）。 */
export interface StochasticRobustnessRequest {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly method: StochasticMethod;
  /** PRNG 种子（整数）。 */
  readonly seed: number;
  readonly stochasticRunId: string;
  readonly createdAt: string;

  /** 迭代次数（缺省 STOCHASTIC_DEFAULT_ITERATIONS）。 */
  readonly iterations?: number;
  /** 显著性水平 0~1（缺省 0.05 → 95% CI）。 */
  readonly alpha?: number;
  /** 年化因子（缺省 252；仅日收益模式用于 Sharpe 年化）。 */
  readonly annualizationFactor?: number;
  /** Monte Carlo 重采样对象（缺省：给了 dailyReturns 用 dailyReturn，否则 tradeReturn）。 */
  readonly monteCarloMode?: StochasticMonteCarloMode;
  /** P(MaxDD > X) 的 X（%，缺省 20）。 */
  readonly tailDrawdownThresholdPct?: number;
  /** 判定所需最小成功迭代数（缺省 30）。 */
  readonly minIterationsForVerdict?: number;
  /** C-18.1 漂移阈值覆盖（缺省沿用 5pp / 3pp）。 */
  readonly thresholds?: RobustnessThresholds;

  /** 基准日收益序列（小数；+0.01 = +1%）。MC dailyReturn 模式必需。 */
  readonly dailyReturns?: readonly number[];
  /** 基准 trade 级收益序列（小数）。bootstrap / orderRandomization 必需；MC tradeReturn 必需。 */
  readonly tradeReturns?: readonly number[];
  /** 成交笔数回显（缺省：trade 模式 = 序列长度，日收益模式 = null）。 */
  readonly tradeCount?: number | null;
  /**
   * 基准绩效。缺省由源序列按内置确定性口径（statistics.ts）计算——日收益模式下
   * 复利结果与真实回测一致；trade 模式为「按成交顺序复利」近似，如调用方有真实
   * 回测结果应显式注入。
   */
  readonly baseline?: StochasticMetricsView;
  /** 可选注入式评估器（缺省用内置统计器）。 */
  readonly evaluator?: StochasticSampleEvaluator;
}

// ---------------------------------------------------------------------------
// 缺省口径常量
// ---------------------------------------------------------------------------

/** 缺省迭代次数。 */
export const STOCHASTIC_DEFAULT_ITERATIONS = 500;

/** 缺省显著性水平（95% 置信区间）。 */
export const STOCHASTIC_DEFAULT_ALPHA = 0.05;

/** 缺省年化因子（交易日/年；与 C-16.1 / C-16.2 一致）。 */
export const STOCHASTIC_DEFAULT_ANNUALIZATION_FACTOR = 252;

/** 缺省回撤尾部阈值（%，P(MaxDD > 20%)）。 */
export const STOCHASTIC_DEFAULT_TAIL_DRAWDOWN_THRESHOLD_PCT = 20;

/** 缺省判定所需最小成功迭代数（不足 → inconclusive）。 */
export const STOCHASTIC_DEFAULT_MIN_ITERATIONS_FOR_VERDICT = 30;

/** 单步收益合法下界（严格大于 −1，即 1 + r > 0；−100% 会使权益归零导致后续除零）。 */
export const STOCHASTIC_MIN_STEP_RETURN = -1;

/** 参与分布摘要的序列最小长度（< 2 → 结构化抛错，禁止静默产出）。 */
export const STOCHASTIC_MIN_SOURCE_LENGTH = 2;
