/**
 * 「回测总览 → 全周期五策略收益对比」折线图下方收益/回撤区块的展示层派生。
 *
 * 口径边界（关键：本模块**不新造**回撤算法，避免与系统内既有权威口径打架）：
 *   · 最大回撤 ← `realisticSimulation.maxDrawdown`
 *     （server/realisticBacktest.ts：以初始资金为起点，对整条权益曲线取峰谷最大跌幅，单位 %）。
 *   · 回撤持续时间 / 收复回撤所用时间 ← `strategyEvaluation.stability`
 *     （server/downsideRisk.ts#calculateDrawdownDurations：锁定**最大回撤那一次**回撤区间（2026-09-18 用户裁定）；
 *       回撤持续 = 峰值日 → 谷底日的交易日数，
 *       收复用时 = 谷底日 → 收复前高的交易日数，未收复则计至期末）。
 *     这两个数不在此重算，只做搬运 —— 与「策略对比」六层评价里的同名指标天然同源。
 *   · 已平仓胜率 / 盈亏比 ← `realisticSimulation.winRate / profitFactor`
 *     （server/realisticBacktest.ts：仅统计已完成平仓的交易；期末仍持仓不计入，
 *       无已平仓交易时保持 null，由展示层回显「样本不足」）。
 *   · 最大收益 / 当前收益 ← 本模块从该策略自身权益曲线做**恒等变形**（不含任何估计或外推）：
 *       最大收益 = max(权益 ÷ 初始资金 − 1) × 100，峰值日取曲线最高点（并列时取最早，保证渲染稳定）；
 *       当前收益 = 期末权益 ÷ 初始资金 × 100 − 100，数值上等于 `realisticSimulation.totalReturn`。
 *
 * 曲线范围：一律使用该策略**自身完整权益曲线**（不按图表起始日裁剪），
 * 与服务端 maxDrawdown / stability 的计算范围保持一致。
 */

export type EquityCurvePointLike = { date: string; equity: number };

export type EquityCurveReturnSummary = {
  /** 最大收益百分比（曲线最高点相对初始资金）。 */
  maxReturnPercent: number | null;
  /** 最大收益出现日（曲线最高点交易日）。 */
  maxReturnDate: string | null;
  /** 当前收益百分比（期末权益相对初始资金）。 */
  currentReturnPercent: number | null;
  /** 期末权益对应交易日。 */
  currentDate: string | null;
  /** 实际参与计算的权益点数（剔除非有限值与非正值后）。 */
  pointCount: number;
};

const EMPTY_RETURN_SUMMARY: EquityCurveReturnSummary = {
  maxReturnPercent: null,
  maxReturnDate: null,
  currentReturnPercent: null,
  currentDate: null,
  pointCount: 0,
};

/**
 * 从权益曲线派生「最大收益 / 当前收益」。初始资金非正或曲线无有效点时返回全空，
 * 由展示层如实回显「样本不足」，不使用 0 或上一笔权益兜底。
 */
export function summarizeEquityCurveReturns(
  equityCurve: readonly EquityCurvePointLike[],
  initialCapital: number,
): EquityCurveReturnSummary {
  const points = equityCurve.filter((point) => Number.isFinite(point.equity) && point.equity > 0);
  if (!Number.isFinite(initialCapital) || initialCapital <= 0 || points.length === 0) return EMPTY_RETURN_SUMMARY;

  const toReturnPercent = (equity: number) => Number((((equity / initialCapital) - 1) * 100).toFixed(2));
  let highest = points[0]!;
  for (const point of points) {
    if (point.equity > highest.equity) highest = point;
  }
  const latest = points[points.length - 1]!;
  return {
    maxReturnPercent: toReturnPercent(highest.equity),
    maxReturnDate: highest.date,
    currentReturnPercent: toReturnPercent(latest.equity),
    currentDate: latest.date,
    pointCount: points.length,
  };
}

export type FullCycleRiskBlockInput = {
  key: string;
  label: string;
  /** 折线图同款策略色（展示层只做回显）。 */
  color: string;
  /** 服务端权威最大回撤（%）。 */
  maxDrawdownPercent: number;
  /** 服务端权威回撤持续时间（交易日）。 */
  maxDrawdownDurationTradingDays: number | null;
  /** 服务端权威收复回撤所用时间（交易日）。 */
  longestRecoveryTradingDays: number | null;
  /** 服务端权威已平仓胜率（%）；无已平仓交易时为 null。 */
  winRate: number | null;
  /** 服务端权威盈亏比（总盈利 / 总亏损）；无可比样本时为 null。 */
  profitFactor: number | null;
  initialCapital: number;
  equityCurve: readonly EquityCurvePointLike[];
};

export type FullCycleRiskBlock = Omit<FullCycleRiskBlockInput, "equityCurve"> & EquityCurveReturnSummary;

/** 把五条策略实验压成可直接渲染的区块数据（保持传入顺序）。 */
export function buildFullCycleRiskBlocks(items: readonly FullCycleRiskBlockInput[]): FullCycleRiskBlock[] {
  return items.map(({ equityCurve, ...rest }) => ({ ...rest, ...summarizeEquityCurveReturns(equityCurve, rest.initialCapital) }));
}
