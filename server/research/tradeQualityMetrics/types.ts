/**
 * STEP 16 / C-16.3 — 策略评价·交易质量与稳定性指标：类型契约。
 *
 * 背景：ROADMAP §18「Strategy Evaluation」核心指标含 Win Rate / Profit Factor /
 * Expectancy / Turnover / Average Holding Period / Trade Count，同时考虑
 * monthly consistency / yearly consistency / regime performance。
 * C-16.1（performanceMetrics）已交付收益/风险/回撤（含 tail risk / DD duration /
 * Recovery Factor）；C-16.2（riskAdjustedMetrics）交付 Sharpe / Sortino / Calmar。
 * 本任务（C-16.3）只补「交易质量 + 月度/年度一致性 + regime 占位」缺口，
 * 不重写 C-16.1 的收益/回撤、不实现 C-16.2 的风险调整比率、不实现 C-22.1 的 regime 体系。
 *
 * 输入形态决策（详见 analyze.ts 文件头「口径核对」）：
 *   - 直接消费（equityCurve, trades, annualizationFactor），而非 C-16.1
 *     PerformanceEvaluationRun 记录——该记录不含原始 equityCurve（只带
 *     inputFingerprint 与汇总指标），无法还原月度/年度收益分布；C-16.2 已按同一
 *     理由采用曲线直食形态。三者同输入共享同一 inputFingerprint（复用 C-16.1
 *     computeInputFingerprint），由协调者以指纹互链，防「指标与来源曲线脱钩」。
 *
 * 与 STEP 8 backtest/metrics 重叠字段处置（详见 analyze.ts「口径核对」）：
 *   - winRatePct / profitFactor / averageWin / averageLoss / expectancy /
 *     completedTradeCount 与 STEP 8 口径逐项一致（completedTrades 过滤
 *     !openAtEnd && netPnl !== null；winRate 分母 = 完成交易数），本任务**复用**
 *     STEP 8 computeMetrics（read-only import）取值，保证生产口径不漂移；
 *   - Turnover / Average Holding Period / 月年一致性 / regime 属 STEP 8 未覆盖
 *     的新增缺口，本任务从 Trade.entryTime/exitTime 与 equityCurve 独立推导。
 *
 * regime 占位（C-22.1 前禁止编造 regime 标签）：
 *   - reasonCode 沿用 experimentLineage 的 REGIME_UNASSESSED_REASON_CODE 常量
 *     （单一事实来源）；assessed 分支仅作为未来扩展槽的类型占位，本模块不产出。
 *
 * 铁律（对齐 performanceMetrics / riskAdjustedMetrics / simulator / signalEngine）：
 *   - 全部字段 readonly；纯函数、确定性；无 IO / Date.now / Math.random。
 *   - 数值一律有限（NaN / ±Infinity 在校验层拒绝，绝不静默产出）。
 *   - 空曲线 / 单点曲线等结构性退化输入响亮抛错（复用 C-16.1 assertValidEquityCurve）；
 *     「无 trades / 无完成交易」等语义缺省场景返回显式 null 或结构化空态，绝不返回 NaN。
 *   - 记录可 JSON 序列化；fingerprint = sha256（除 fingerprint 自身外全部字段的
 *     确定性 JSON 摘要），round-trip 后复核防篡改。
 */

import type { EquityPoint, Trade } from "../../backtest/types";
import { REGIME_UNASSESSED_REASON_CODE } from "../experimentLineage/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const TRADE_QUALITY_EVALUATION_RUN_KIND = "TRADE_QUALITY_EVALUATION_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const TRADE_QUALITY_EVALUATION_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 评估输入
// ---------------------------------------------------------------------------

/**
 * C-16.3 确定性评估输入（与 C-16.1 / C-16.2 同构，可喂同一份
 * TradeSimulationRun.equityCurve + trades，指纹互链）。
 */
export interface TradeQualityEvaluationInput {
  /** 逐模拟交易日收盘权益点（升序，每点一个交易日）。 */
  readonly equityCurve: readonly EquityPoint[];
  /**
   * 全部交易生命周期（可省略）。省略时 tradeQuality 指标组为 null
   * （未提供交易，无法评估交易质量/换手/持仓；月度年度一致性照常评估）。
   */
  readonly trades?: readonly Trade[];
  /** 年化交易日数（换手率年化用）。默认 252。必须 > 0。 */
  readonly annualizationFactor?: number;
}

// ---------------------------------------------------------------------------
// 交易质量指标
// ---------------------------------------------------------------------------

/**
 * Turnover（换手率，口径见 analyze.ts「Turnover 口径」）。
 *
 * 定义（研究级、文档化约定，非生产 Performance Analytics 口径）：
 *   - 名义成交额 = Σ 每笔 trade 的（entryPrice × quantity + 卖出侧 exitPrice × quantity），
 *     含期末仍持仓交易的买入侧（真实资金投入）；卖出侧仅统计已清仓且有 exitPrice 者；
 *   - 平均资产 = equityCurve 各点 equity 的算术平均；
 *   - 区间双边换手 periodTurnover = grossTradedNotional / averageEquity；
 *   - 年化双边换手 annualizedTurnover = grossTradedNotional × annualizationFactor /
 *     (averageEquity × (点数 − 1))，即把区间双边换手按区间交易日数线性年化。
 */
export interface TurnoverMetrics {
  /** 买入侧名义额合计：Σ entryPrice × quantity（含 openAtEnd）。 */
  readonly buyNotional: number;
  /** 卖出侧名义额合计：Σ exitPrice × quantity（仅 exitPrice 非 null 者）。 */
  readonly sellNotional: number;
  /** 双边名义成交额 = buyNotional + sellNotional。 */
  readonly grossTradedNotional: number;
  /** 平均资产：equityCurve 各点 equity 算术平均。 */
  readonly averageEquity: number;
  /** 区间双边换手（倍）：grossTradedNotional / averageEquity。 */
  readonly periodTurnover: number;
  /** 年化双边换手（倍/年），公式见上方文档。 */
  readonly annualizedTurnover: number;
}

/**
 * 交易质量指标组（与 STEP 8 重叠字段直接复用其 computeMetrics，口径逐位一致；
 * 详见 analyze.ts「口径核对」）。
 */
export interface TradeQualityMetrics {
  /** 输入 trades 总条数（含期末仍持仓 openAtEnd 者）。 */
  readonly totalTradeCount: number;
  /** 完成交易数（已清仓且 netPnl 非 null），Win Rate 等口径的分母。 */
  readonly completedTradeCount: number;
  /** 胜率（%）= 盈利完成交易数 / 完成交易数 × 100；无完成交易为 null。 */
  readonly winRatePct: number | null;
  /** Profit Factor = 总盈利 / |总亏损|；与 STEP 8 同语义（无完成交易为 0，见口径核对）。 */
  readonly profitFactor: number | null;
  /** 平均单笔盈利（净盈亏为正者均值）；无盈利交易为 null。 */
  readonly averageWin: number | null;
  /** 平均单笔亏损（净盈亏为负者均值，负数）；无亏损交易为 null。 */
  readonly averageLoss: number | null;
  /** Expectancy = 完成交易净盈亏均值（元/笔）；无完成交易为 null。 */
  readonly expectancy: number | null;
  /**
   * 平均持仓（交易日数）：完成交易中「可确定持仓日数」的均值；无完成交易或全部
   * 不可确定时为 null。单笔持仓日数 = 曲线日期索引差 + 1（含进出场两端，对齐
   * STEP 8 portfolio.holdingDays = max(1, idxExit − idxEntry + 1)），进出场日期不在
   * 曲线内时回退使用 trade.holdingPeriod，两者皆不可得则该笔计入 unavailable。
   */
  readonly averageHoldingPeriodDays: number | null;
  /** 平均持仓日数覆盖的完成交易笔数（分母）。 */
  readonly holdingPeriodCoveredCount: number;
  /** 持仓日数不可确定、被排除出均值的完成交易笔数。 */
  readonly holdingPeriodUnavailableCount: number;
  /** 换手率（口径见 TurnoverMetrics）。 */
  readonly turnover: TurnoverMetrics;
}

// ---------------------------------------------------------------------------
// 月度 / 年度一致性
// ---------------------------------------------------------------------------

/**
 * 单个月度收益（口径见 analyze.ts「月度/年度一致性口径」）：
 * 月收益 = 该日历月内**实现**的各日收益连乘 − 1；跨越自然月边界的日收益
 * （上一交易日 → 本月初首个交易日）按实现日归属当月，保证 Σ 月 ≡ 区间总收益。
 */
export interface MonthlyReturnEntry {
  /** 月键（YYYY-MM，字符串切片，无 Date 依赖）。 */
  readonly monthKey: string;
  /** 该月收益（%）。 */
  readonly returnPct: number;
  /** 归入该月桶的实现日收益条数。 */
  readonly realizedReturnCount: number;
}

/** 单个年度收益（口径同月度，键为 YYYY）。 */
export interface YearlyReturnEntry {
  readonly yearKey: string;
  readonly returnPct: number;
  readonly realizedReturnCount: number;
}

/**
 * 月度一致性汇总（盈利月占比 / 中位数 / 最佳最差月 / 最大连亏月数）。
 * 注意：只统计「曲线内至少实现一条日收益」的日历月；无曲线点的月份不会
 * 被当作 0% 月计入（不编造空月）。
 */
export interface MonthlyConsistencyMetrics {
  /** 按 YYYY-MM 升序的逐月收益（透明回显，供复核/下游二次聚合）。 */
  readonly entries: readonly MonthlyReturnEntry[];
  /** 参与统计的月数（= entries.length；曲线 >= 2 点则 >= 1）。 */
  readonly monthCount: number;
  /** 盈利月数（returnPct > 0）。 */
  readonly positiveMonthCount: number;
  /** 亏损月数（returnPct < 0；0% 月不计入任何一侧）。 */
  readonly negativeMonthCount: number;
  /** 盈利月占比 = positiveMonthCount / monthCount。 */
  readonly positiveMonthRatio: number;
  /** 月收益中位数（%）。 */
  readonly medianMonthlyReturnPct: number | null;
  /** 最佳月（returnPct 最大；并列取更早月）。 */
  readonly bestMonth: MonthlyReturnEntry | null;
  /** 最差月（returnPct 最小；并列取更早月）。 */
  readonly worstMonth: MonthlyReturnEntry | null;
  /** 最大连续亏损月数（returnPct < 0 的连续段最长长度；无则 0，0% 月打断连亏）。 */
  readonly maxConsecutiveLosingMonths: number;
}

/** 年度一致性汇总（口径与 MonthlyConsistencyMetrics 对称）。 */
export interface YearlyConsistencyMetrics {
  /** 按 YYYY 升序的逐年收益。 */
  readonly entries: readonly YearlyReturnEntry[];
  readonly yearCount: number;
  readonly positiveYearCount: number;
  readonly negativeYearCount: number;
  readonly positiveYearRatio: number;
  readonly medianYearlyReturnPct: number | null;
  readonly bestYear: YearlyReturnEntry | null;
  readonly worstYear: YearlyReturnEntry | null;
  readonly maxConsecutiveLosingYears: number;
}

// ---------------------------------------------------------------------------
// Regime 表现（C-22.1 前禁止实现体系，只允许结构化占位 + 扩展槽）
// ---------------------------------------------------------------------------

/**
 * 未来 regime 分段表现的扩展槽形态（C-22.1 交付后的目标形状）。
 * 本模块不实现、不产出 assessed 值，仅声明该类型供 C-22.1 对接，
 * 避免事后为记录「加字段」造成 schema 破坏。
 */
export interface TradeQualityRegimeSegmentPerformance {
  /** regime 标签（C-22.1 体系交付后由评估器提供真实标签，禁止编造）。 */
  readonly regimeId: string;
  /** 该 regime 连续区间的起止日期（YYYY-MM-DD，闭区间）。 */
  readonly startDate: string;
  readonly endDate: string;
  /** 该区间内的月收益序列（复用下方 monthly 口径）。 */
  readonly monthlyReturns: readonly MonthlyReturnEntry[];
}

/**
 * 记录级 regime 表现：unassessed（当前必须的占位）| assessed（C-22.1 扩展槽）。
 * 本模块永远产出 unassessed；assessed 分支只存在于类型层，等待 C-22.1。
 */
export type TradeQualityRegimePerformance =
  | {
      readonly kind: "unassessed";
      readonly reasonCode: typeof REGIME_UNASSESSED_REASON_CODE;
      readonly reason: string;
    }
  | { readonly kind: "assessed"; readonly segments: readonly TradeQualityRegimeSegmentPerformance[] };

// ---------------------------------------------------------------------------
// 评估结果总记录
// ---------------------------------------------------------------------------

/** 交易质量 + 稳定性综合指标。 */
export interface TradeQualityEvaluationMetrics {
  /** 交易质量指标组；输入未提供 trades 时为 null（显式未评估态）。 */
  readonly tradeQuality: TradeQualityMetrics | null;
  /** 月度一致性（仅依赖 equityCurve，恒评估）。 */
  readonly monthly: MonthlyConsistencyMetrics;
  /** 年度一致性。 */
  readonly yearly: YearlyConsistencyMetrics;
  /** regime 表现（C-22.1 前恒为 unassessed 占位）。 */
  readonly regime: TradeQualityRegimePerformance;
}

/**
 * C-16.3 评估结果总记录（不可变、可 JSON 序列化、带 fingerprint）。
 *
 * 设计决策（对齐 C-16.1 PerformanceEvaluationRun / C-16.2 RiskAdjustedEvaluationRun）：
 *   - 不内嵌完整 equityCurve / trades，以 inputFingerprint（对 equityCurve / trades?
 *     的 sha256，复用 C-16.1 computeInputFingerprint，同载荷同指纹）绑定输入；
 *   - 关键口径参数（annualizationFactor）原样回显，保证记录自描述、可复现；
 *   - fingerprint 覆盖除自身外全部字段，round-trip 复核防篡改。
 */
export interface TradeQualityEvaluationRun {
  readonly recordKind: typeof TRADE_QUALITY_EVALUATION_RUN_KIND;
  readonly recordVersion: typeof TRADE_QUALITY_EVALUATION_RUN_RECORD_VERSION;

  /** 年化交易日数（默认 252）。 */
  readonly annualizationFactor: number;

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

  readonly metrics: TradeQualityEvaluationMetrics;

  /** 记录内容指纹：除本字段外全部字段的确定性 sha256（防篡改）。 */
  readonly fingerprint: string;
}
