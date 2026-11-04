/**
 * STEP 16 / C-16.2 — 策略评价·风险调整指标（Sharpe / Sortino / Calmar）：类型契约。
 *
 * 背景：ROADMAP §18「Strategy Evaluation」要求策略评价避免单一指标，核心指标含
 * Sharpe / Sortino / Calmar。C-16.1（performanceMetrics，CODE_READY）已交付
 * 收益（CAGR/Total Return）/ 风险（年化波动/下行偏差/tail risk）/ 回撤（MaxDD 剖面/
 * Recovery Factor）部分，并在其文件头明确把 Sharpe/Sortino/Calmar 留作 C-16.2 扩展槽；
 * C-16.2 只补「风险调整比率」缺口，不重写 C-16.1 的日收益序列/回撤分段等既有能力。
 *
 * 口径与复用决策（详见 analyze.ts 文件头「口径核对」）：
 *   - Sharpe / Sortino 在「日超额收益 e_i = 日收益 − 日无风险收益」上计算，
 *     与 STEP 8 shared/quant-stats.sharpeRatio（算术年化、无风险利率固定 0）在
 *     rfAnnualPct = 0 时逐位一致，是本任务与生产口径对表的锚点。
 *   - 无风险利率默认 0（对齐 STEP 8 隐含假设与 C-16.1 默认口径，避免隐藏假设；
 *     需要对照时可显式传 rfAnnualPct，如 2 表示 2%/年）。
 *   - Calmar = CAGR / |MaxDD|，直接消费几何年化 CAGR（与 C-16.1 ReturnMetrics.cagrPct
 *     同口径）与 running-peak MaxDD（与 C-16.1 DrawdownMetrics.maxDrawdownPct 同口径，
 *     复用其 analyzeDrawdown 纯函数）。无回撤 → null（分母 0，显式信号）。
 *
 * 铁律（对齐 performanceMetrics / simulator / signalEngine / experimentLineage）：
 *   - 全部字段 readonly；纯函数、确定性；无 IO / Date.now / Math.random。
 *   - 数值一律有限（NaN / ±Infinity 在校验层拒绝，绝不静默产出）。
 *   - 空曲线 / 单点曲线等结构性退化输入响亮抛错（复用 C-16.1 assertValidEquityCurve）；
 *     样本不足 / 零波动 / 无下行 / 无回撤等「比率无定义」场景返回显式 null，绝不返回
 *     Infinity / NaN（与 shared null 信号语义一致）。
 *   - 记录可 JSON 序列化；fingerprint = sha256（除 fingerprint 自身外全部字段的
 *     确定性 JSON 摘要），round-trip 后复核防篡改。
 */

import type { EquityPoint, Trade } from "../../backtest/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const RISK_ADJUSTED_EVALUATION_RUN_KIND = "RISK_ADJUSTED_EVALUATION_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const RISK_ADJUSTED_EVALUATION_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 评估输入
// ---------------------------------------------------------------------------

/**
 * C-16.2 确定性风险调整评估输入。
 *
 * 与 C-16.1 PerformanceEvaluationInput 同构（同 equityCurve / trades /
 * annualizationFactor / downsideTarget 语义），另增 rfAnnualPct。
 * 输入形态取「权益曲线」而非 C-16.1 评估结果记录：C-16.1 PerformanceEvaluationRun
 * 不含原始曲线（只有 inputFingerprint 与汇总指标），无法还原日收益分布，
 * 故本任务直接消费 equityCurve，并复用 C-16.1 同一批纯函数（dailyReturnSeries /
 * analyzeDrawdown / assertValidEquityCurve），保证与 C-16.1 同输入必同口径。
 */
export interface RiskAdjustedEvaluationInput {
  /** 逐模拟交易日收盘权益点（升序，每点一个交易日）。 */
  readonly equityCurve: readonly EquityPoint[];
  /** 全部交易生命周期（可省略；提供时纳入 inputFingerprint 绑定，同 C-16.1）。 */
  readonly trades?: readonly Trade[];
  /**
   * 年化交易日数（Sharpe/Sortino 的 √年化 与 Calmar 的 CAGR 指数用）。默认 252。
   * 必须 > 0。
   */
  readonly annualizationFactor?: number;
  /**
   * 无风险年利率（%，2 表示 2%/年）。默认 0：与 STEP 8 sharpeRatio（无风险利率固定 0）
   * 及 C-16.1 默认口径保持一致，避免隐藏假设；研究对照可显式传入。
   * 日无风险收益 = rfAnnualPct / 100 / annualizationFactor。必须为有限数。
   */
  readonly rfAnnualPct?: number;
  /**
   * 下行偏差的目标日收益（小数，作用于「超额收益空间」e_i = r_i − rf_daily；
   * 等效于在原始收益空间以 (rf_daily + downsideTarget) 为阈值）。默认 0，
   * 即只把低于无风险日收益的回落计为下行。必须为有限数。
   */
  readonly downsideTarget?: number;
}

// ---------------------------------------------------------------------------
// 风险调整指标
// ---------------------------------------------------------------------------

/**
 * 风险调整指标集（口径与分母语义见 analyze.ts；比率无定义场景显式 null）。
 *
 * 数值单位约定：比率无量纲；Pct 字段为百分数（cagrPct = 30 表示 30%/年）。
 */
export interface RiskAdjustedMetrics {
  /**
   * Sharpe = 年化算术超额收益 / 年化样本波动
   *         = mean(e) × ann / (sampleStd(e) × √ann) = mean(e)/sampleStd(e) × √ann，
   * 其中 e_i = 日收益 − 日无风险收益。当 rfAnnualPct = 0 时与 STEP 8
   * shared sharpeRatio 逐位一致。日收益样本 < 2 或样本标准差 = 0（零波动）→ null。
   */
  readonly sharpeRatio: number | null;
  /**
   * Sortino = 年化算术超额收益 / 年化下行偏差
   *          = mean(e) × ann / (√(mean(min(e − downsideTarget, 0)²)) × √ann)。
   * 下行偏差为总体口径（分母 = 日收益个数，对齐 C-16.1 下行偏差语义）。
   * 日收益样本 < 2 或无低于目标的下行（下行偏差 = 0）→ null。
   */
  readonly sortinoRatio: number | null;
  /**
   * Calmar = CAGR(几何年化) / |MaxDD|。无回撤（maxDrawdownPct = 0）→ null
   * （分母为 0，显式信号）。注意与 C-16.1 recoveryFactor（总收益口径）不同。
   */
  readonly calmarRatio: number | null;
  /**
   * 年化算术超额收益（%，Sharpe/Sortino 分子）：
   * mean(e) × annualizationFactor × 100。注意是「算术年化」，
   * 与几何年化 cagrPct 概念不同（对齐 STEP 8 sharpeRatio 的算术口径）。
   */
  readonly annualizedExcessReturnPct: number;
  /**
   * 年化波动率（%）：sampleStd(日收益) × √ann × 100。日收益样本 < 2 为 null。
   * 与 C-16.1 RiskMetrics.annualizedVolatilityPct 同口径（同 shared 原语）。
   */
  readonly annualizedVolatilityPct: number | null;
  /**
   * 年化下行偏差（%，>= 0）：√(mean(min(e − downsideTarget, 0)²)) × √ann × 100。
   * 总体口径、超额收益空间。当 rfAnnualPct = 0 且 downsideTarget = 0 时与
   * C-16.1 RiskMetrics.downsideDeviationPct 同值（Sortino 分母的透明回显）。
   */
  readonly downsideDeviationPct: number;
  /** 几何年化收益（%），与 C-16.1 ReturnMetrics.cagrPct 同口径（Calmar 分子）。 */
  readonly cagrPct: number;
  /** 最大回撤深度（%，>= 0），与 C-16.1 DrawdownMetrics.maxDrawdownPct 同口径（Calmar 分母）。 */
  readonly maxDrawdownPct: number;
}

// ---------------------------------------------------------------------------
// 评估结果总记录
// ---------------------------------------------------------------------------

/**
 * C-16.2 风险调整评估结果总记录（不可变、可 JSON 序列化、带 fingerprint）。
 *
 * 设计决策（对齐 C-16.1 PerformanceEvaluationRun）：
 *   - 不内嵌完整 equityCurve，以 inputFingerprint（对 equityCurve / trades 的 sha256，
 *     与 C-16.1 computeInputFingerprint 同载荷）绑定输入；
 *   - 关键口径参数（annualizationFactor / rfAnnualPct / downsideTarget）原样回显，
 *     保证记录自描述、可复现；
 *   - fingerprint 覆盖除自身外全部字段，round-trip 复核防篡改。
 */
export interface RiskAdjustedEvaluationRun {
  readonly recordKind: typeof RISK_ADJUSTED_EVALUATION_RUN_KIND;
  readonly recordVersion: typeof RISK_ADJUSTED_EVALUATION_RUN_RECORD_VERSION;

  /** 年化交易日数（默认 252）。 */
  readonly annualizationFactor: number;
  /** 无风险年利率（%，默认 0）。 */
  readonly rfAnnualPct: number;
  /** 下行偏差目标日收益（小数，超额收益空间，默认 0）。 */
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

  /** 输入绑定指纹：对（equityCurve, trades?）的确定性 sha256（与 C-16.1 同载荷）。 */
  readonly inputFingerprint: string;

  readonly metrics: RiskAdjustedMetrics;

  /** 记录内容指纹：除本字段外全部字段的确定性 sha256（防篡改）。 */
  readonly fingerprint: string;
}
