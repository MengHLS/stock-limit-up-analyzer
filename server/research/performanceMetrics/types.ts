/**
 * STEP 16 / C-16.1 — 策略评价·收益/风险/回撤指标（Performance Metrics）：类型契约。
 *
 * 背景：ROADMAP §18「Strategy Evaluation」要求策略评价避免单一指标，至少覆盖
 * 收益/风险/回撤/稳定性/交易质量/样本外。C-16.1 负责其中「收益 · 风险 · 回撤」部分，
 * 消费 C-14.1 simulator 产出的 TradeSimulationRun.equityCurve / trades 记录流，
 * 产出**研究链路专用**的确定性评估结果（非生产结论——RESEARCH_READY gate 之前一切为研究）。
 *
 * 与 STEP 8 backtest/metrics 的边界（详见 analyze.ts 文件头「口径核对」）：
 *   - STEP 8 Metrics 面向生产回测最终汇总（收益/回撤深度/交易统计），锚点 = initialCapital，
 *     只报告 MaxDD 深度（一个数字），不含回撤起止/时长/恢复/剖面、Recovery Factor、下行偏差、
 *     连亏/极值/分位数等下行风险。
 *   - C-16.1 是研究评价专用确定性评估器：锚点 = equityCurve[0].equity（C-14.1 输出首点
 *     equity == initialCapital，两者重合；不重合时差异已文档化），并补齐上述缺口。
 *   - Sharpe / Sortino / Calmar（风险调整后收益）属 C-16.2、交易质量属 C-16.3，
 *     本目录**不实现**；本目录导出的纯函数（日收益率序列等）与记录形态作为扩展面，
 *     供 C-16.2 / C-16.3 复用同一口径，避免各自重算造成指标不一致。
 *
 * 铁律（对齐 simulator / signalEngine / experimentLineage）：
 *   - 全部字段 readonly；纯函数、确定性；无 IO / Date.now / Math.random。
 *   - 数值一律有限（NaN / ±Infinity 在校验层拒绝，绝不静默产出）。
 *   - 空曲线 / 单点曲线等退化输入结构化抛错（响亮失败），不静默返回 NaN。
 *   - 记录可 JSON 序列化；fingerprint = sha256（除 fingerprint 自身外全部字段的
 *     确定性 JSON 摘要），round-trip 后复核防篡改。
 */

import type { EquityPoint, Trade } from "../../backtest/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const PERFORMANCE_EVALUATION_RUN_KIND = "PERFORMANCE_EVALUATION_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const PERFORMANCE_EVALUATION_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 评估输入
// ---------------------------------------------------------------------------

/**
 * C-16.1 确定性评估输入。
 *
 * 仅消费 equityCurve（逐收盘权益点，升序、每点一个交易日）；trades 仅作为
 * 「绑定指纹」与计数回显（tradeCount）纳入输入，本任务不计算交易质量类指标
 * （C-16.3 专属），避免越界。
 */
export interface PerformanceEvaluationInput {
  /** 逐模拟交易日收盘权益点（升序，每点一个交易日）。 */
  readonly equityCurve: readonly EquityPoint[];
  /** 全部交易生命周期（可省略；提供时纳入 inputFingerprint 绑定）。 */
  readonly trades?: readonly Trade[];
  /**
   * 年化交易日数（CAGR / 波动率 / 下行偏差年化用）。默认 252。
   * 必须 > 0。
   */
  readonly annualizationFactor?: number;
  /**
   * 回撤剖面过滤阈值（%）：仅 depthPct >= 该值的回撤段进入 drawdownSegments。
   * 默认 5；maxDrawdownSegment 始终记录（不受阈值影响）。必须 >= 0。
   */
  readonly drawdownThresholdPct?: number;
  /**
   * 下行偏差的目标日收益（小数，默认 0 = 无风险收益按 0 计）。
   * 必须为有限数。
   */
  readonly downsideTarget?: number;
}

// ---------------------------------------------------------------------------
// 指标类型
// ---------------------------------------------------------------------------

/** 收益指标（口径见 analyze.ts：均从 equityCurve 端点与区间数计算）。 */
export interface ReturnMetrics {
  /** 期初权益 = equityCurve[0].equity。 */
  readonly startEquity: number;
  /** 期末权益 = equityCurve[末].equity。 */
  readonly endEquity: number;
  /**
   * 总收益率（%）：(endEquity / startEquity − 1) × 100。
   * 锚点 = equityCurve[0].equity（研究曲线口径），而非 initialCapital。
   */
  readonly totalReturnPct: number;
  /**
   * CAGR（%）：(endEquity / startEquity) ^ (annualizationFactor / (点数−1)) − 1。
   * 与 STEP 8 annualizedReturnPct 公式一致（同 shared 原语），差异仅为锚点
   * （本任务取曲线首点；STEP 8 取 initialCapital），两者在 C-14.1 输出上重合。
   */
  readonly cagrPct: number;
}

/** 单次回撤段（峰 → 谷 → 恢复的完整生命周期）。 */
export interface DrawdownSegment {
  /** 峰值点索引（equityCurve 下标）。 */
  readonly peakIndex: number;
  /** 谷底点索引。 */
  readonly troughIndex: number;
  /** 恢复点索引（首次回到 >= 峰值的点位）；期末仍未恢复为 null。 */
  readonly recoveryIndex: number | null;
  /** 峰值日期。 */
  readonly peakDate: string;
  /** 谷底日期。 */
  readonly troughDate: string;
  /** 恢复日期；期末仍未恢复为 null。 */
  readonly recoveryDate: string | null;
  /** 峰值权益值。 */
  readonly peakEquity: number;
  /** 谷底权益值。 */
  readonly troughEquity: number;
  /**
   * 深度（%，>= 0）：(peakEquity − troughEquity) / peakEquity × 100。
   */
  readonly depthPct: number;
  /** 峰 → 谷交易日间隔（= troughIndex − peakIndex）。 */
  readonly tradingDaysToTrough: number;
  /** 峰 → 谷自然日数（按 YYYY-MM-DD 差，纯函数，无 Date.now）。 */
  readonly calendarDaysToTrough: number;
  /** 峰 → 恢复交易日间隔；期末未恢复为 null。 */
  readonly tradingDaysToRecovery: number | null;
  /** 峰 → 恢复自然日数；期末未恢复为 null。 */
  readonly calendarDaysToRecovery: number | null;
}

/** 回撤指标（口径见 analyze.ts 的 analyzeDrawdown）。 */
export interface DrawdownMetrics {
  /**
   * 最大回撤深度（%，>= 0）。口径与 STEP 8 maxDrawdownFromEquity 一致
   * （running peak 全程扫描，可复用对照）；数值 = 全部回撤段深度最大值。
   */
  readonly maxDrawdownPct: number;
  /**
   * 最深回撤段（含峰/谷/恢复点与峰→谷、峰→恢复时长）；曲线无任何回撤时为 null。
   * 多个回撤段深度并列最深时取 peakIndex 更早者。
   */
  readonly maxDrawdownSegment: DrawdownSegment | null;
  /**
   * 回撤剖面：按发生顺序排列、深度 >= drawdownThresholdPct 的回撤段列表
   * （不含低于阈值的浅回撤；maxDrawdownSegment 不受此阈值影响）。
   */
  readonly drawdownSegments: readonly DrawdownSegment[];
  /** 进入 drawdownSegments 的回撤段数量。 */
  readonly drawdownEpisodeCount: number;
}

/** 最差连续亏损段（逐日收益连续为负的最长/最深段，按亏损总额最深计）。 */
export interface WorstLosingStreak {
  /** 段内日收益之和（%），<= 0。 */
  readonly totalPct: number;
  /** 连续亏损交易日数。 */
  readonly days: number;
  /** 段内首个亏损实现日（equityCurve 下标；段含收益率区间 j 对应点位 j+1）。 */
  readonly startIndex: number;
  /** 段内末个亏损实现日（equityCurve 下标）。 */
  readonly endIndex: number;
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * 下行风险指标（纯历史描述，不预测未来）。
 *
 * 收益分布统计口径见 analyze.ts / shared/quant-stats：
 *   - 偏度 skewness / 超额峰度 excessKurtosis 复用 shared 的 sample-adjusted
 *     Fisher-Pearson 定义，样本不足（偏度 n<3、峰度 n<4）或常数列返回 null。
 *   - 分位数复用 shared quantile（R type 7 / numpy 默认线性插值）。
 */
export interface RiskMetrics {
  /**
   * 年化波动率（%）：sampleStdDev(日收益) × √annualizationFactor × 100。
   * 日收益样本 < 2（即权益点 < 3）时为 null（样本方差无定义）。
   */
  readonly annualizedVolatilityPct: number | null;
  /**
   * 下行偏差年化（%）：√( mean( min(日收益 − downsideTarget, 0)² ) ) × √annualizationFactor × 100。
   * 分母为日收益个数（总体口径，对齐 Sortino 常见用法）；目标默认 0。
   */
  readonly downsideDeviationPct: number;
  /** 收益分布偏度（sample-adjusted Fisher-Pearson g1，复用 shared）；样本不足/常数序列为 null。 */
  readonly skewness: number | null;
  /** 收益分布超额峰度（g2，复用 shared）；样本不足/常数序列为 null。 */
  readonly excessKurtosis: number | null;
  /** 历史 1% 分位日收益（%）：1% 的交易日收益不高于此值（纯历史描述，不做 VaR 外推）。 */
  readonly dailyReturnP01Pct: number;
  /** 历史 5% 分位日收益（%）。 */
  readonly dailyReturnP05Pct: number;
  /** 单日最佳收益（%）。 */
  readonly bestSingleDayPct: number;
  /** 单日最差收益（%）。 */
  readonly worstSingleDayPct: number;
  /** 最差连续亏损段；曲线无任何负收益日为 null。 */
  readonly worstLosingStreak: WorstLosingStreak | null;
}

/** C-16.1 收益/风险/回撤综合指标。 */
export interface PerformanceMetrics {
  readonly returns: ReturnMetrics;
  readonly risk: RiskMetrics;
  readonly drawdown: DrawdownMetrics;
  /**
   * Recovery Factor（恢复因子）：
   * = totalReturnFraction / |maxDrawdownFraction|（总收益 ÷ 最大回撤深度）。
   * 采用总收益口径而非 CAGR ÷ MaxDD（后者即 Calmar，属 C-16.2，不在此重复）。
   * 曲线无回撤（maxDrawdownPct = 0）时返回 null（分母为 0，无定义）。
   */
  readonly recoveryFactor: number | null;
}

// ---------------------------------------------------------------------------
// 评估结果总记录
// ---------------------------------------------------------------------------

/**
 * C-16.1 评估结果总记录（不可变、可 JSON 序列化、带 fingerprint）。
 *
 * 设计决策：
 *   - 不内嵌完整 equityCurve（重复存储；原曲线已在 TradeSimulationRun 内），
 *     以 inputFingerprint（对 equityCurve / trades 的 sha256）绑定输入，防止
 *     「指标与来源曲线脱钩」；
 *   - 关键口径参数（annualizationFactor / drawdownThresholdPct / downsideTarget）
 *     原样回显，保证记录自描述、可复现；
 *   - fingerprint 覆盖除自身外全部字段，round-trip 复核防篡改。
 */
export interface PerformanceEvaluationRun {
  readonly recordKind: typeof PERFORMANCE_EVALUATION_RUN_KIND;
  readonly recordVersion: typeof PERFORMANCE_EVALUATION_RUN_RECORD_VERSION;

  /** 年化交易日数（默认 252）。 */
  readonly annualizationFactor: number;
  /** 回撤剖面阈值（%，默认 5）。 */
  readonly drawdownThresholdPct: number;
  /** 下行偏差目标日收益（小数，默认 0）。 */
  readonly downsideTarget: number;

  /** 输入边界回显（轻量，不含整条曲线）。 */
  readonly input: {
    /** equityCurve 点数。 */
    readonly equityCurvePointCount: number;
    /** 曲线首点日期（YYYY-MM-DD）。 */
    readonly startDate: string;
    /** 曲线末点日期（YYYY-MM-DD）。 */
    readonly endDate: string;
    /** 输入 trades 条数；未提供 trades 时为 null。 */
    readonly tradeCount: number | null;
  };

  /** 输入绑定指纹：对（equityCurve, trades?）的确定性 sha256（防篡改/防脱钩）。 */
  readonly inputFingerprint: string;

  readonly metrics: PerformanceMetrics;

  /** 记录内容指纹：除本字段外全部字段的确定性 sha256（防篡改）。 */
  readonly fingerprint: string;
}
