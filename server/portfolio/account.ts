/**
 * STEP 9 — Portfolio Engine · PortfolioAccount（组合账户）。
 *
 * 职责：持有 cash / positions / equity / marketValue / realizedPnL / unrealizedPnL /
 * fees / tax / exposure，并对 Fill 应用确定性会计。策略与风控只能通过 buy/sell 或
 * applyFill 改变状态，禁止直接篡改内部字段。
 *
 * 关键语义：
 *   - 加权平均成本法：costBasis（含买入费用）随买入累加，随卖出按比例结转；
 *     averageCost = costBasis / quantity；realizedPnL = 卖出净所得 − 结转成本基。
 *   - T+1 预留：当日买入股数进入 lockedQuantity，当日不可卖出；rollover(nextDate)
 *     才把 locked 释放为 available。availableQuantity = quantity − lockedQuantity。
 *   - 每次使用独立实例，天然状态隔离（与 STEP 8 Portfolio 相同思路，但完全解耦）。
 *   - 确定性：不使用 Date.now()/Math.random()/网络/全局状态。
 */

import { buyFees, commission, round2, round4, stampDuty, transferFee } from "./accounting";
import type { AccountingResult, FeeSchedule, Fill, OrderRequest, PortfolioSnapshot, PositionSnapshot } from "./domain";
import { DEFAULT_FEE_SCHEDULE } from "./domain";

/** 内部持仓状态。 */
interface PositionState {
  symbol: string;
  /** 总股数。 */
  quantity: number;
  /** 可卖出股数（T+1 释放后）。 */
  availableQuantity: number;
  /** 当日买入、尚未结算的股数（T+1）。 */
  lockedQuantity: number;
  /** 成本基（含买入费用）。 */
  costBasis: number;
  /** 累计已实现盈亏。 */
  realizedPnL: number;
  /** 最近可见市场价。 */
  marketPrice: number | null;
}

/** 账户构造选项。 */
export interface PortfolioAccountOptions {
  feeSchedule?: FeeSchedule;
  /** 初始交易日（用于 T+1 rollover 记账）。 */
  currentDate?: string;
}

/** 确定性组合账户。 */
export class PortfolioAccount {
  private cashAmount: number;
  private readonly positions = new Map<string, PositionState>();
  private feesAccumulated = 0;
  private taxAccumulated = 0;
  /** 账户级累计已实现盈亏（含已清仓持仓结转，清仓后仍保留）。 */
  private realizedPnLAccumulated = 0;
  private currentDate: string;
  private readonly feeSchedule: FeeSchedule;

  constructor(public readonly initialCash: number, options: PortfolioAccountOptions = {}) {
    this.cashAmount = initialCash;
    this.feeSchedule = options.feeSchedule ?? DEFAULT_FEE_SCHEDULE;
    this.currentDate = options.currentDate ?? "";
  }

  get cash(): number {
    return this.cashAmount;
  }

  get fees(): number {
    return this.feesAccumulated;
  }

  get tax(): number {
    return this.taxAccumulated;
  }

  get openPositionCount(): number {
    return this.positions.size;
  }

  get lotSize(): number {
    return this.feeSchedule.lotSize > 0 ? Math.floor(this.feeSchedule.lotSize) : 1;
  }

  /** 当前总市值（按最近估值价，未估值持仓回退到成本基）。 */
  marketValue(): number {
    let sum = 0;
    for (const pos of Array.from(this.positions.values())) {
      sum += (pos.marketPrice ?? this.averageCostOf(pos)) * pos.quantity;
    }
    return round2(sum);
  }

  /** 当前权益 = cash + marketValue。 */
  equity(): number {
    return round2(this.cashAmount + this.marketValue());
  }

  /** 总敞口 = marketValue / equity。 */
  exposure(): number {
    const eq = this.equity();
    return eq > 0 ? this.marketValue() / eq : 0;
  }

  /** 累计已实现盈亏（含已清仓持仓结转）。 */
  realizedPnL(): number {
    return this.realizedPnLAccumulated;
  }

  /** 累计未实现盈亏 = Σ(marketValue − costBasis)。 */
  unrealizedPnL(): number {
    let sum = 0;
    for (const pos of Array.from(this.positions.values())) {
      const price = pos.marketPrice ?? this.averageCostOf(pos);
      sum += price * pos.quantity - pos.costBasis;
    }
    return round2(sum);
  }

  /** 内部：加权平均成本（含买入费用）。 */
  private averageCostOf(pos: PositionState): number {
    return pos.quantity > 0 ? pos.costBasis / pos.quantity : 0;
  }

  /**
   * 应用买入成交。返回是否成功；资金不足 / 非整手 / 非法数量返回失败（不改变任何状态）。
   */
  buy(order: OrderRequest, price: number, date?: string): AccountingResult {
    const executedAt = date ?? this.currentDate;
    if (order.quantity <= 0 || !Number.isInteger(order.quantity)) {
      return { success: false, reason: "INVALID_ORDER: 买入数量必须为正整数" };
    }
    if (order.quantity % this.lotSize !== 0) {
      return { success: false, reason: `INVALID_ORDER: 买入数量必须是 ${this.lotSize} 的整数倍` };
    }
    if (!Number.isFinite(price) || price <= 0) {
      return { success: false, reason: "INVALID_ORDER: 缺少有效成交价" };
    }

    const grossAmount = round2(price * order.quantity);
    const fees = buyFees(grossAmount, this.feeSchedule);
    const totalCost = round2(grossAmount + fees);
    if (totalCost > this.cashAmount + 1e-8) {
      return { success: false, reason: "INSUFFICIENT_CASH" };
    }

    // 现金移动 + 费用累计。
    this.cashAmount = round2(this.cashAmount - totalCost);
    this.feesAccumulated = round2(this.feesAccumulated + fees);

    const existing = this.positions.get(order.symbol);
    if (existing) {
      existing.quantity += order.quantity;
      // T+1：今日买入部分进入 locked，不增加 available。
      existing.lockedQuantity += order.quantity;
      existing.costBasis = round2(existing.costBasis + totalCost);
      existing.marketPrice = price;
    } else {
      this.positions.set(order.symbol, {
        symbol: order.symbol,
        quantity: order.quantity,
        availableQuantity: 0,
        lockedQuantity: order.quantity,
        costBasis: totalCost,
        realizedPnL: 0,
        marketPrice: price,
      });
    }

    const fill: Fill = {
      symbol: order.symbol,
      side: "buy",
      quantity: order.quantity,
      price,
      grossAmount,
      fees,
      tax: 0,
      netCash: round2(-totalCost),
      executedAt,
    };
    this.currentDate = executedAt;
    return { success: true, fill };
  }

  /**
   * 应用卖出成交。持仓不足 / T+1 锁定 / 非法数量返回失败（不改变任何状态）。
   */
  sell(order: OrderRequest, price: number, date?: string): AccountingResult {
    const executedAt = date ?? this.currentDate;
    if (order.quantity <= 0 || !Number.isInteger(order.quantity)) {
      return { success: false, reason: "INVALID_ORDER: 卖出数量必须为正整数" };
    }
    if (!Number.isFinite(price) || price <= 0) {
      return { success: false, reason: "INVALID_ORDER: 缺少有效成交价" };
    }
    const pos = this.positions.get(order.symbol);
    if (!pos) return { success: false, reason: `INVALID_ORDER: 无该股票持仓 ${order.symbol}` };
    if (order.quantity > pos.availableQuantity) {
      return {
        success: false,
        reason: `INVALID_ORDER: T+1 可卖数量不足（需 ${order.quantity}，可卖 ${pos.availableQuantity}）`,
      };
    }

    const grossAmount = round2(price * order.quantity);
    const fees = round2(commission(grossAmount, this.feeSchedule) + transferFee(grossAmount, this.feeSchedule));
    const tax = stampDuty(grossAmount, "sell", this.feeSchedule);
    const proceeds = round2(grossAmount - fees - tax);

    // 按比例结转成本基，计算本笔已实现盈亏。
    const costBasisRemoved = round2(pos.costBasis * (order.quantity / pos.quantity));
    const realized = round2(proceeds - costBasisRemoved);

    this.cashAmount = round2(this.cashAmount + proceeds);
    this.feesAccumulated = round2(this.feesAccumulated + fees);
    this.taxAccumulated = round2(this.taxAccumulated + tax);
    this.realizedPnLAccumulated = round2(this.realizedPnLAccumulated + realized);

    pos.quantity -= order.quantity;
    pos.availableQuantity -= order.quantity;
    pos.costBasis = round2(pos.costBasis - costBasisRemoved);
    pos.realizedPnL = round2(pos.realizedPnL + realized);
    pos.marketPrice = price;
    if (pos.quantity <= 0) this.positions.delete(order.symbol);

    const fill: Fill = {
      symbol: order.symbol,
      side: "sell",
      quantity: order.quantity,
      price,
      grossAmount,
      fees,
      tax,
      netCash: proceeds,
      executedAt,
    };
    this.currentDate = executedAt;
    return { success: true, fill };
  }

  /**
   * 应用已计算好的 Fill（供上层桥接 STEP 8 成交时复用，避免重复计算费用口径）。
   * 仅买入/卖出；费用/税/现金变动以 Fill 为准。
   */
  applyFill(fill: Fill): AccountingResult {
    if (fill.side === "buy") {
      // 直接按 Fill 的金额落地，绕过内部费用重算，保证与上游成交口径一致。
      const totalCost = round2(fill.grossAmount + fill.fees);
      if (fill.quantity <= 0 || fill.quantity % this.lotSize !== 0) {
        return { success: false, reason: "INVALID_ORDER: 非法买入数量" };
      }
      if (totalCost > this.cashAmount + 1e-8) return { success: false, reason: "INSUFFICIENT_CASH" };
      this.cashAmount = round2(this.cashAmount - totalCost);
      this.feesAccumulated = round2(this.feesAccumulated + fill.fees);
      this.taxAccumulated = round2(this.taxAccumulated + fill.tax);
      const existing = this.positions.get(fill.symbol);
      if (existing) {
        existing.quantity += fill.quantity;
        existing.lockedQuantity += fill.quantity;
        existing.costBasis = round2(existing.costBasis + totalCost);
        existing.marketPrice = fill.price;
      } else {
        this.positions.set(fill.symbol, {
          symbol: fill.symbol,
          quantity: fill.quantity,
          availableQuantity: 0,
          lockedQuantity: fill.quantity,
          costBasis: totalCost,
          realizedPnL: 0,
          marketPrice: fill.price,
        });
      }
      this.currentDate = fill.executedAt;
      return { success: true, fill };
    }

    // sell
    const pos = this.positions.get(fill.symbol);
    if (!pos) return { success: false, reason: `INVALID_ORDER: 无该股票持仓 ${fill.symbol}` };
    if (fill.quantity > pos.availableQuantity) {
      return { success: false, reason: `INVALID_ORDER: T+1 可卖数量不足（可卖 ${pos.availableQuantity}）` };
    }
    const proceeds = round2(fill.grossAmount - fill.fees - fill.tax);
    const costBasisRemoved = round2(pos.costBasis * (fill.quantity / pos.quantity));
    const realized = round2(proceeds - costBasisRemoved);
    this.cashAmount = round2(this.cashAmount + proceeds);
    this.feesAccumulated = round2(this.feesAccumulated + fill.fees);
    this.taxAccumulated = round2(this.taxAccumulated + fill.tax);
    this.realizedPnLAccumulated = round2(this.realizedPnLAccumulated + realized);
    pos.quantity -= fill.quantity;
    pos.availableQuantity -= fill.quantity;
    pos.costBasis = round2(pos.costBasis - costBasisRemoved);
    pos.realizedPnL = round2(pos.realizedPnL + realized);
    pos.marketPrice = fill.price;
    if (pos.quantity <= 0) this.positions.delete(fill.symbol);
    this.currentDate = fill.executedAt;
    return { success: true, fill };
  }

  /** 按给定价格 mark-to-market，返回权益（cash + 持仓市值）。 */
  markToMarket(prices: Map<string, number>): number {
    for (const [symbol, price] of Array.from(prices.entries())) {
      if (Number.isFinite(price) && price > 0) {
        const pos = this.positions.get(symbol);
        if (pos) pos.marketPrice = price;
      }
    }
    return this.equity();
  }

  /**
   * 生成组合快照（Risk Engine 输入）。持仓按 symbol 升序，保证确定性。
   * 传入 prices 时先 mark-to-market；未提供的 symbol 回退到最近可见价/成本基。
   */
  snapshot(date: string, prices: Map<string, number> = new Map()): PortfolioSnapshot {
    if (prices.size > 0) this.markToMarket(prices);
    const positions: PositionSnapshot[] = Array.from(this.positions.values())
      .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
      .map((pos) => {
        const price = pos.marketPrice ?? this.averageCostOf(pos);
        const marketValue = round2(price * pos.quantity);
        return {
          symbol: pos.symbol,
          quantity: pos.quantity,
          availableQuantity: pos.availableQuantity,
          averageCost: round4(this.averageCostOf(pos)),
          marketPrice: pos.marketPrice,
          marketValue,
          unrealizedPnL: round2(marketValue - pos.costBasis),
          realizedPnL: pos.realizedPnL,
        };
      });
    const marketValue = round2(positions.reduce((sum, p) => sum + p.marketValue, 0));
    const equity = round2(this.cashAmount + marketValue);
    return {
      date,
      cash: this.cashAmount,
      marketValue,
      equity,
      realizedPnL: this.realizedPnLAccumulated,
      unrealizedPnL: round2(positions.reduce((sum, p) => sum + p.unrealizedPnL, 0)),
      fees: this.feesAccumulated,
      tax: this.taxAccumulated,
      exposure: equity > 0 ? marketValue / equity : 0,
      positions,
    };
  }

  /**
   * T+1 结算：跨日时释放 lockedQuantity 到 availableQuantity。
   * 只允许日期向前推进；回退（非法）直接抛错。
   */
  rollover(nextDate: string): void {
    if (this.currentDate && nextDate < this.currentDate) {
      throw new Error(`rollover: 日期不得回退（current=${this.currentDate}, next=${nextDate}）`);
    }
    for (const pos of Array.from(this.positions.values())) {
      pos.availableQuantity += pos.lockedQuantity;
      pos.lockedQuantity = 0;
    }
    this.currentDate = nextDate;
  }
}
