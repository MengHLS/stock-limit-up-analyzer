/**
 * Backtest Core — Portfolio Engine（组合引擎）。
 *
 * 职责：统一管理 cash / positions / market value / equity / realized / unrealized PnL。
 *
 * 关键约束：
 *  - 策略不得直接修改 cash / position / equity；只能产生 Signal/Order Intent，
 *    由 ExecutionModel 产出 Fill 后，Portfolio 负责实际状态变化。
 *  - 每次回测必须创建独立 Portfolio 实例（状态隔离），连续回测互不污染。
 *  - 费用与滑点统一在此层按 CostModel 结算，禁止策略自行扣费。
 *
 * 当前为最小确定性模型：每 symbol 一次建仓、一次清仓（卖出即清仓）。
 * 加仓/部分减仓留作后续扩展点（接口已按 symbol 隔离，便于升级）。
 */

import type { CostModel, EquityPoint, Fill, Position, Trade } from "./domain";
import { buyFees, sellFees } from "./execution";

/** 内部持仓状态（含成本基，用于精确结转已实现盈亏）。 */
interface PositionState {
  symbol: string;
  quantity: number;
  /** 建仓成交价（含滑点，不含费用）。 */
  entryPrice: number;
  /** 建仓总成本（含费用）。 */
  totalEntryCost: number;
  realizedPnL: number;
  marketPrice: number | null;
}

/** 进行中的交易（内部）。 */
interface OpenTrade {
  symbol: string;
  entryTime: string;
  entryPrice: number;
  /** 无滑点买入基准价，用于精确计算 Gross PnL（纯价格差）。 */
  entryBasePrice: number;
  quantity: number;
  totalEntryCost: number;
  fees: number;
  slippageAmount: number;
}

export interface OrderResult {
  success: boolean;
  reason?: string;
}

/** 确定性组合引擎。每次回测 new 一个实例，天然隔离状态。 */
export class Portfolio {
  private cashAmount: number;
  private readonly positions = new Map<string, PositionState>();
  private readonly completedTrades: Trade[] = [];
  private readonly openTrades = new Map<string, OpenTrade>();
  private readonly dayIndex: Map<string, number>;
  /** 最大同时持仓数（BacktestConfig.maxPositions），Infinity 表示不限。 */
  private readonly maxPositions: number;
  /** 单笔买入金额占当日成交额比例上限（BacktestConfig.maxPositionAmountRatio），0 表示不限。 */
  private readonly maxPositionAmountRatio: number;

  constructor(
    public readonly initialCapital: number,
    tradingDates: string[] = [],
    options: { maxPositions?: number; maxPositionAmountRatio?: number } = {},
  ) {
    this.cashAmount = initialCapital;
    this.dayIndex = new Map(tradingDates.map((date, index) => [date, index]));
    this.maxPositions = options.maxPositions ?? Number.POSITIVE_INFINITY;
    this.maxPositionAmountRatio = options.maxPositionAmountRatio ?? 0;
  }

  get cash(): number {
    return this.cashAmount;
  }

  get openPositionCount(): number {
    return this.positions.size;
  }

  /** 当前持仓快照（对外只读），按最近收盘价/建仓价估值。 */
  snapshotPositions(): Position[] {
    return this.snapshotPositionsAt(new Map());
  }

  /** 当前持仓快照（对外只读），按给定价格估值；价格缺失时回退到最近收盘价/建仓价。
   *  用于 RiskContext 派生，保证持仓市值与 equity 采用同一时点价格口径（避免敞口被过期价格低估）。 */
  snapshotPositionsAt(prices: Map<string, number>): Position[] {
    return Array.from(this.positions.values()).map((p) => {
      const price = prices.get(p.symbol);
      const px = price !== undefined && Number.isFinite(price) && price > 0 ? price : (p.marketPrice ?? p.entryPrice);
      const marketValue = px * p.quantity;
      return {
        symbol: p.symbol,
        quantity: p.quantity,
        averageEntryPrice: p.entryPrice,
        marketPrice: p.marketPrice,
        marketValue,
        unrealizedPnL: marketValue - p.totalEntryCost,
        realizedPnL: p.realizedPnL,
      };
    });
  }

  /** 全部交易（已完成 + 期末未平仓）。 */
  allTrades(): Trade[] {
    return [...this.completedTrades, ...this.openTradesSnapshot()];
  }

  /**
   * 应用买入成交。资金不足 / 持仓超限 / 容量超限 / 非整手 / 已有持仓返回失败（不改变任何状态）。
   * 约束顺序：数量合法性 → lotSize 校验 → 持仓去重 → maxPositions → 容量截断 → 资金截断 → 成交。
   */
  buy(fill: Fill, cost: CostModel): OrderResult {
    const lotSize = cost.lotSize > 0 ? Math.floor(cost.lotSize) : 1;
    if (fill.quantity <= 0) return { success: false, reason: "买入数量必须为正" };
    if (fill.quantity % lotSize !== 0) {
      return { success: false, reason: `INVALID_LOT_SIZE：买入数量必须是 ${lotSize} 的整数倍，实际 ${fill.quantity}` };
    }
    if (this.positions.has(fill.symbol)) return { success: false, reason: "同一股票已有持仓，暂不支持加仓" };
    if (this.openPositionCount >= this.maxPositions) {
      return { success: false, reason: `MAX_POSITIONS_REACHED：超过最大持仓数 ${this.maxPositions}` };
    }

    let quantity = fill.quantity;

    // 容量约束：单笔买入金额 ≤ 当日成交额 × maxPositionAmountRatio（amount 单位千元 → 元）。
    if (
      this.maxPositionAmountRatio > 0 &&
      fill.amount !== undefined && fill.amount !== null && Number.isFinite(fill.amount) && fill.amount > 0
    ) {
      const capacityAmount = fill.amount * 1000 * this.maxPositionAmountRatio;
      const capacityShares = Math.floor(capacityAmount / fill.price / lotSize) * lotSize;
      if (capacityShares < lotSize) return { success: false, reason: "CAPACITY_INSUFFICIENT：容量不足以成交一手" };
      if (capacityShares < quantity) quantity = capacityShares;
    }

    // 资金约束：向下取整到整手，直到总成本（含最低佣金）不超过现金。
    while (quantity >= lotSize) {
      const g = fill.price * quantity;
      if (g + buyFees(g, cost) <= this.cashAmount + 1e-8) break;
      quantity -= lotSize;
    }
    if (quantity < lotSize) {
      return { success: false, reason: `资金不足：需至少 1 手（${lotSize} 股）` };
    }

    const gross = fill.price * quantity;
    const fees = buyFees(gross, cost);
    const totalCost = gross + fees;
    // 滑点金额按最终成交数量重算，保证容量/资金截断后与最终 quantity 严格一致。
    const slippageAmount = (fill.price - fill.basePrice) * quantity;

    this.cashAmount -= totalCost;
    this.positions.set(fill.symbol, {
      symbol: fill.symbol,
      quantity,
      entryPrice: fill.price,
      totalEntryCost: totalCost,
      realizedPnL: 0,
      marketPrice: null,
    });
    this.openTrades.set(fill.symbol, {
      symbol: fill.symbol,
      entryTime: fill.executedAt,
      entryPrice: fill.price,
      entryBasePrice: fill.basePrice,
      quantity,
      totalEntryCost: totalCost,
      fees,
      slippageAmount,
    });
    return { success: true };
  }

  /**
   * 应用卖出成交（清仓）。持仓不足返回失败（不改变任何状态）。
   */
  sell(fill: Fill, cost: CostModel): OrderResult {
    if (fill.quantity <= 0) return { success: false, reason: "卖出数量必须为正" };
    const pos = this.positions.get(fill.symbol);
    const open = this.openTrades.get(fill.symbol);
    if (!pos || !open) return { success: false, reason: `无该股票持仓：${fill.symbol}` };
    if (pos.quantity < fill.quantity) {
      return { success: false, reason: `持仓不足：需 ${fill.quantity}，持有 ${pos.quantity}` };
    }

    const gross = fill.price * fill.quantity;
    const fees = sellFees(gross, cost);
    const proceeds = gross - fees;
    // 卖出数量少于持仓时按比例结转成本基（最小模型通常等于清仓）。
    const costBasis = open.totalEntryCost * (fill.quantity / pos.quantity);
    const realizedPnl = proceeds - costBasis;

    this.cashAmount += proceeds;
    pos.quantity -= fill.quantity;
    pos.totalEntryCost -= costBasis;
    pos.realizedPnL += realizedPnl;

    if (pos.quantity <= 0) {
      // 清仓：结算完整交易生命周期。
      const totalFees = open.fees + fees;
      const netPnl = pos.realizedPnL;
      this.completedTrades.push({
        symbol: fill.symbol,
        entryTime: open.entryTime,
        entryPrice: open.entryPrice,
        exitTime: fill.executedAt,
        exitPrice: fill.price,
        quantity: open.quantity,
        grossPnL: (fill.basePrice - open.entryBasePrice) * fill.quantity,
        fees: totalFees,
        slippageAmount: open.slippageAmount + fill.slippageAmount,
        netPnl,
        returnPct: open.totalEntryCost > 0 ? (netPnl / open.totalEntryCost) * 100 : null,
        holdingPeriod: this.holdingDays(open.entryTime, fill.executedAt),
        openAtEnd: false,
        reason: null,
      });
      this.openTrades.delete(fill.symbol);
      this.positions.delete(fill.symbol);
    }
    return { success: true };
  }

  /** 标记价格并返回权益（cash + 持仓市值）。 */
  markToMarket(prices: Map<string, number>): number {
    let marketValue = 0;
    for (const [symbol, pos] of Array.from(this.positions.entries())) {
      const price = prices.get(symbol);
      if (price !== undefined && Number.isFinite(price) && price > 0) pos.marketPrice = price;
      marketValue += (pos.marketPrice ?? pos.entryPrice) * pos.quantity;
    }
    return this.cashAmount + marketValue;
  }

  /** 无副作用地估算组合权益：现金 + 持仓按给定价格估值（不修改任何状态，供 RiskContext 使用）。
   *  与 snapshotPositionsAt 共用同一估值口径。 */
  equityAt(prices: Map<string, number>): number {
    const marketValue = this.snapshotPositionsAt(prices).reduce((sum, p) => sum + p.marketValue, 0);
    return this.cashAmount + marketValue;
  }

  /** 期末未平仓交易按最后估值价标记 openAtEnd（不计入已实现收益）。 */
  finalizeOpenTrades(prices: Map<string, number>, reason = "回测结束仍持仓"): void {
    const last = this.lastDay();
    for (const [symbol, open] of Array.from(this.openTrades.entries())) {
      const price = prices.get(symbol);
      this.completedTrades.push({
        symbol,
        entryTime: open.entryTime,
        entryPrice: open.entryPrice,
        exitTime: last,
        exitPrice: price !== undefined && Number.isFinite(price) && price > 0 ? price : null,
        quantity: open.quantity,
        grossPnL: null,
        fees: open.fees,
        slippageAmount: open.slippageAmount,
        netPnl: null,
        returnPct: null,
        holdingPeriod: null,
        openAtEnd: true,
        reason,
      });
    }
    this.openTrades.clear();
  }

  /** 生成一个权益点。 */
  equityPoint(timestamp: string, prices: Map<string, number>): EquityPoint {
    const equity = this.markToMarket(prices);
    const marketValue = equity - this.cashAmount;
    return { timestamp, cash: this.cashAmount, marketValue, equity, openPositions: this.positions.size };
  }

  // ---- 内部辅助 ----

  private openTradesSnapshot(): Trade[] {
    return Array.from(this.openTrades.values()).map((open) => ({
      symbol: open.symbol,
      entryTime: open.entryTime,
      entryPrice: open.entryPrice,
      exitTime: null,
      exitPrice: null,
      quantity: open.quantity,
      grossPnL: null,
      fees: open.fees,
      slippageAmount: open.slippageAmount,
      netPnl: null,
      returnPct: null,
      holdingPeriod: null,
      openAtEnd: false,
      reason: null,
    }));
  }

  private holdingDays(entry: string, exit: string): number | null {
    const e = this.dayIndex.get(entry);
    const x = this.dayIndex.get(exit);
    if (e === undefined || x === undefined) return null;
    return Math.max(1, x - e + 1);
  }

  private lastDay(): string | null {
    if (this.dayIndex.size === 0) return null;
    return Array.from(this.dayIndex.keys()).at(-1) ?? null;
  }
}
