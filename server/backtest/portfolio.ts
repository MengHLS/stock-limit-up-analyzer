/**
 * STEP 8 — Portfolio Layer：组合会计（cash / positions / marketValue / equity /
 * realizedPnL / unrealizedPnL）。
 *
 * 确定性：每次回测 new 一个实例，状态天然隔离；不使用 Date.now / Math.random / 全局状态。
 * 费用与滑点统一经 CostModel 结算，策略/引擎不得自行扣费。
 *
 * 成交约束（按顺序）：
 *   买入：数量合法性 → 整手 → 持仓去重（暂不支持加仓）→ 最大持仓数 → 容量截断 → 现金截断 → 成交。
 *   卖出：数量合法性 → 可卖份额（T+1）→ 整手 → 现金/持仓结转。
 * 部分成交：allowPartialFill 开启时按最大可行数量成交（PARTIALLY_FILLED），否则全额拒绝。
 */

import type { CostModel } from "../engine/domain";
import type { EquityPoint, Fill, PortfolioState, Position, RejectionReason, Trade } from "./types";
import { computeTradeCost, slippageAmount } from "./cost";
import { PositionBook } from "./position";
import type { CorporateAction } from "../corporateActions/types";

/** 应用成交后的结果。 */
export interface FillResult {
  success: boolean;
  /** 实际成交数量。 */
  filledQuantity: number;
  /** 未成交数量。 */
  remainingQuantity: number;
  /** 订单在此次应用后的状态。 */
  status: "FILLED" | "PARTIALLY_FILLED" | "REJECTED";
  rejectionReason: RejectionReason | null;
  reason: string;
}

interface OpenTrade {
  securityId: string;
  entryTime: string;
  entryPrice: number;
  entryBasePrice: number;
  /** 剩余持仓数量。 */
  quantity: number;
  /** 建仓总数量（用于结算交易生命周期，不随减仓变化）。 */
  totalQuantity: number;
  totalEntryCost: number;
  /** 累计现金费用（买 + 卖）。 */
  fees: number;
  /** 累计滑点金额（买 + 卖）。 */
  slippageAmount: number;
  /** 累计毛盈亏（纯价格差，无滑点）。 */
  grossPnL: number;
}

const reject = (reason: string, rejectionReason: RejectionReason | null = null): FillResult => ({
  success: false,
  filledQuantity: 0,
  remainingQuantity: 0,
  status: "REJECTED",
  rejectionReason,
  reason,
});

export class Portfolio {
  private cashAmount: number;
  private readonly book = new PositionBook();
  private readonly completedTrades: Trade[] = [];
  private readonly openTrades = new Map<string, OpenTrade>();
  private readonly dayIndex: ReadonlyMap<string, number>;
  private readonly maxPositions: number;
  private readonly maxPositionAmountRatio: number;

  constructor(
    public readonly initialCapital: number,
    tradingDates: readonly string[] = [],
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
    return this.book.openPositionCount;
  }

  openPositionSymbols(): string[] {
    return this.book.openPositionSymbols();
  }

  available(securityId: string): number {
    return this.book.available(securityId);
  }

  quantity(securityId: string): number {
    return this.book.quantity(securityId);
  }

  /** 结算 T+1：冻结份额转为可卖（每个新交易日开始时调用）。 */
  settle(): void {
    this.book.settle();
  }

  /**
   * 应用公司行为（送/转/配/拆/合/分红）到持仓与现金（STEP 11 接线：corporateActions/portfolioTransform）。
   *
   * 会计口径（对齐 portfolioTransform 不变量）：
   *   - 现金分红：现金增加，股数不变，成本基不变；
   *   - 送/转/拆/合：股数按 ratio 缩放，每股成本按 1/ratio 缩放，总成本基不变；
   *   - 配股：股数增加 + 现金减少（认购支出计入成本基）。
   * 同时把 open trade 的生命周期数量/成本同步缩放，保证后续清仓的已实现盈亏与未拆基准经济等价。
   */
  applyCorporateAction(securityId: string, actions: readonly CorporateAction[]): void {
    if (actions.length === 0) return;
    const { cashDelta, ratio } = this.book.applyCorporateAction(securityId, actions);
    this.cashAmount += cashDelta;
    const open = this.openTrades.get(securityId);
    if (open && ratio !== 1) {
      open.quantity = Math.round(open.quantity * ratio);
      open.totalQuantity = Math.round(open.totalQuantity * ratio);
      open.entryPrice = open.entryPrice / ratio;
      open.entryBasePrice = open.entryBasePrice / ratio;
      open.totalEntryCost -= cashDelta; // 配股 cashDelta<0 → 认购支出计入总成本基
    }
  }

  /** 应用买入成交（含约束与部分成交裁决）。 */
  buy(fill: Fill, cost: CostModel, allowPartialFill: boolean): FillResult {
    const lotSize = cost.lotSize > 0 ? Math.floor(cost.lotSize) : 1;
    const requested = fill.quantity;
    if (requested <= 0) return reject("买入数量必须为正");
    if (requested % lotSize !== 0) return reject(`INVALID_LOT_SIZE：买入数量必须是 ${lotSize} 的整数倍`);
    if (this.book.has(fill.securityId)) return reject("同一股票已有持仓，暂不支持加仓");
    if (this.book.openPositionCount >= this.maxPositions) {
      return reject(`MAX_POSITIONS_REACHED：超过最大持仓数 ${this.maxPositions}`);
    }

    let quantity = requested;

    // 容量约束：单笔买入金额 ≤ 参考成交额 × maxPositionAmountRatio（amount 千元 → 元）。
    if (
      this.maxPositionAmountRatio > 0 &&
      fill.referenceAmount !== null && fill.referenceAmount !== undefined &&
      Number.isFinite(fill.referenceAmount) && fill.referenceAmount > 0
    ) {
      const capacityShares = Math.floor(fill.referenceAmount * 1000 * this.maxPositionAmountRatio / fill.price / lotSize) * lotSize;
      if (capacityShares < lotSize) return reject("CAPACITY_INSUFFICIENT：容量不足以成交一手");
      if (capacityShares < quantity) quantity = capacityShares;
    }

    // 现金约束：向下取整到整手，直到总成本（含最低佣金）不超过现金。
    while (quantity >= lotSize) {
      const gross = fill.price * quantity;
      if (gross + computeTradeCost("buy", gross, cost).total <= this.cashAmount + 1e-8) break;
      quantity -= lotSize;
    }
    if (quantity < lotSize) {
      return reject("现金不足以买入一手", "INSUFFICIENT_CASH");
    }

    const partial = quantity < requested;
    if (partial && !allowPartialFill) {
      return reject("现金不足以全额买入且未启用部分成交", "INSUFFICIENT_CASH");
    }

    const gross = fill.price * quantity;
    const tradeCost = computeTradeCost("buy", gross, cost);
    const slippage = slippageAmount(fill.price, fill.basePrice, quantity);
    const totalCost = gross + tradeCost.total;

    this.cashAmount -= totalCost;
    this.book.increase(fill.securityId, quantity, fill.price, tradeCost.total);
    this.openTrades.set(fill.securityId, {
      securityId: fill.securityId,
      entryTime: fill.timestamp,
      entryPrice: fill.price,
      entryBasePrice: fill.basePrice,
      quantity,
      totalQuantity: quantity,
      totalEntryCost: totalCost,
      fees: tradeCost.total,
      slippageAmount: slippage,
      grossPnL: 0,
    });

    return {
      success: true,
      filledQuantity: quantity,
      remainingQuantity: requested - quantity,
      status: partial ? "PARTIALLY_FILLED" : "FILLED",
      rejectionReason: null,
      reason: partial ? `部分成交 ${quantity} 股（剩余 ${requested - quantity} 股作废）` : "全额成交",
    };
  }

  /** 应用卖出成交（只能卖可卖份额，T+1 冻结不可卖）。 */
  sell(fill: Fill, cost: CostModel, allowPartialFill: boolean): FillResult {
    const lotSize = cost.lotSize > 0 ? Math.floor(cost.lotSize) : 1;
    const requested = fill.quantity;
    if (requested <= 0) return reject("卖出数量必须为正");
    if (!this.book.has(fill.securityId)) return reject(`无该股票持仓：${fill.securityId}`);

    const available = this.book.available(fill.securityId);
    let quantity = requested;
    if (quantity > available) {
      if (!allowPartialFill) {
        return reject(`可卖份额不足：需 ${quantity}，可用 ${available}（T+1 冻结）`, "T_PLUS_1");
      }
      quantity = available; // 部分成交：只卖可卖份额。
    }
    if (quantity % lotSize !== 0) quantity = Math.floor(quantity / lotSize) * lotSize;
    if (quantity < lotSize) return reject("可卖份额不足一手", "T_PLUS_1");

    const partial = quantity < requested;
    const gross = fill.price * quantity;
    const tradeCost = computeTradeCost("sell", gross, cost);
    const slippage = slippageAmount(fill.price, fill.basePrice, quantity);
    const proceeds = gross - tradeCost.total;

    this.cashAmount += proceeds;
    const decreased = this.book.decrease(fill.securityId, quantity, fill.price, tradeCost.total);

    const open = this.openTrades.get(fill.securityId);
    if (open) {
      open.quantity -= quantity;
      open.fees += tradeCost.total;
      open.slippageAmount += slippage;
      open.grossPnL += (fill.basePrice - open.entryBasePrice) * quantity;
      if (decreased.closed) this.finalizeClosedTrade(open, fill);
    }

    return {
      success: true,
      filledQuantity: quantity,
      remainingQuantity: requested - quantity,
      status: partial ? "PARTIALLY_FILLED" : "FILLED",
      rejectionReason: null,
      reason: partial ? `部分成交 ${quantity} 股（剩余 ${requested - quantity} 股作废）` : "全额成交",
    };
  }

  /** 结算一个完整交易生命周期（清仓）。 */
  private finalizeClosedTrade(open: OpenTrade, fill: Fill): void {
    const netPnl = open.grossPnL - open.fees - open.slippageAmount;
    this.completedTrades.push({
      securityId: open.securityId,
      entryTime: open.entryTime,
      entryPrice: open.entryPrice,
      exitTime: fill.timestamp,
      exitPrice: fill.price,
      quantity: open.totalQuantity,
      grossPnL: open.grossPnL,
      fees: open.fees,
      slippageAmount: open.slippageAmount,
      netPnl,
      returnPct: open.totalEntryCost > 0 ? (netPnl / open.totalEntryCost) * 100 : null,
      holdingPeriod: this.holdingDays(open.entryTime, fill.timestamp),
      openAtEnd: false,
      reason: null,
    });
    this.openTrades.delete(open.securityId);
  }

  /** 全部交易（已完成 + 期末未平仓）。 */
  allTrades(): Trade[] {
    return [...this.completedTrades, ...this.openTradesSnapshot()];
  }

  /** 标记价格并返回权益（cash + 持仓市值）。 */
  markToMarket(prices: ReadonlyMap<string, number>): number {
    return this.cashAmount + this.book.markToMarket(prices);
  }

  /** 组合状态快照。 */
  portfolioState(prices: ReadonlyMap<string, number>): PortfolioState {
    const positions = this.book.snapshot(prices);
    const marketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const realizedPnL = this.book.totalRealizedPnL();
    const unrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    return {
      cash: this.cashAmount,
      positions,
      marketValue,
      equity: this.cashAmount + marketValue,
      realizedPnL,
      unrealizedPnL,
    };
  }

  /** 持仓快照（只读）。 */
  snapshotPositions(prices: ReadonlyMap<string, number>): Position[] {
    return this.book.snapshot(prices);
  }

  /** 生成一个权益点。 */
  equityPoint(date: string, prices: ReadonlyMap<string, number>): EquityPoint {
    const marketValue = this.book.markToMarket(prices);
    const equity = this.cashAmount + marketValue;
    return { date, cash: this.cashAmount, marketValue, equity, openPositions: this.book.openPositionCount };
  }

  /** 期末未平仓交易按最后估值价标记 openAtEnd（不计入已实现收益）。 */
  finalizeOpenTrades(prices: ReadonlyMap<string, number>, reason = "回测结束仍持仓"): void {
    const last = this.lastDay();
    for (const open of Array.from(this.openTrades.values())) {
      const price = prices.get(open.securityId);
      this.completedTrades.push({
        securityId: open.securityId,
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

  // ---- 内部辅助 ----

  private openTradesSnapshot(): Trade[] {
    return Array.from(this.openTrades.values()).map((open) => ({
      securityId: open.securityId,
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
