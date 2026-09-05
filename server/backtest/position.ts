/**
 * STEP 8 — Position Layer：T+1 持仓账本（PositionBook）。
 *
 * 持仓区分三态：quantity（总量）/ availableQuantity（可卖）/ frozenQuantity（冻结，T+1 前不可卖）。
 * 结算语义：当日买入进入 frozen；每个新交易日开始时 settle() 把前一日冻结份额转为可卖。
 * 仅负责「份额」与「成本基/已实现盈亏」，现金/权益/交易生命周期由 Portfolio 层负责。
 */

import type { Position } from "./types";
import { applyCorporateActionsToPosition } from "../corporateActions/portfolioTransform";
import type { CorporateAction } from "../corporateActions/types";

interface PositionState {
  securityId: string;
  quantity: number;
  availableQuantity: number;
  frozenQuantity: number;
  /** 加权平均买入成本价（含滑点，不含费用）。 */
  averageEntryPrice: number;
  /** 总成本基（含费用），用于已实现盈亏结转。 */
  totalCostBasis: number;
  realizedPnL: number;
  marketPrice: number | null;
}

export interface DecreaseResult {
  /** 本次卖出结转的已实现盈亏。 */
  realizedPnL: number;
  /** 是否清仓。 */
  closed: boolean;
}

export class PositionBook {
  private readonly positions = new Map<string, PositionState>();

  has(securityId: string): boolean {
    return this.positions.has(securityId);
  }

  quantity(securityId: string): number {
    return this.positions.get(securityId)?.quantity ?? 0;
  }

  available(securityId: string): number {
    return this.positions.get(securityId)?.availableQuantity ?? 0;
  }

  frozen(securityId: string): number {
    return this.positions.get(securityId)?.frozenQuantity ?? 0;
  }

  get openPositionCount(): number {
    return this.positions.size;
  }

  openPositionSymbols(): string[] {
    return Array.from(this.positions.keys());
  }

  /** 结算：冻结份额转为可卖（每个新交易日开始时调用）。 */
  settle(): void {
    for (const position of Array.from(this.positions.values())) {
      position.availableQuantity += position.frozenQuantity;
      position.frozenQuantity = 0;
    }
  }

  /**
   * 增加持仓（买入）。新增份额进入冻结（T+1）。
   * @param fees 本次买入现金费用（计入成本基）。
   */
  increase(securityId: string, quantity: number, entryPrice: number, fees: number): void {
    const existing = this.positions.get(securityId);
    if (existing) {
      const newQuantity = existing.quantity + quantity;
      existing.averageEntryPrice =
        (existing.averageEntryPrice * existing.quantity + entryPrice * quantity) / newQuantity;
      existing.quantity = newQuantity;
      existing.frozenQuantity += quantity;
      existing.totalCostBasis += entryPrice * quantity + fees;
      return;
    }
    this.positions.set(securityId, {
      securityId,
      quantity,
      availableQuantity: 0,
      frozenQuantity: quantity,
      averageEntryPrice: entryPrice,
      totalCostBasis: entryPrice * quantity + fees,
      realizedPnL: 0,
      marketPrice: null,
    });
  }

  /**
   * 减少持仓（卖出，只能卖 available 份额）。
   * @param exitPrice 成交价（含滑点）。
   * @param fees 本次卖出现金费用。
   */
  decrease(securityId: string, quantity: number, exitPrice: number, fees: number): DecreaseResult {
    const position = this.positions.get(securityId);
    if (!position) throw new Error(`PositionBook：无该证券持仓 ${securityId}`);
    if (position.availableQuantity < quantity) {
      throw new Error(`PositionBook：可卖份额不足，需 ${quantity}，可用 ${position.availableQuantity}`);
    }

    const proceeds = exitPrice * quantity - fees;
    const costBasis = position.totalCostBasis * (quantity / position.quantity);
    const realizedPnL = proceeds - costBasis;

    position.quantity -= quantity;
    position.availableQuantity -= quantity;
    position.totalCostBasis -= costBasis;
    position.realizedPnL += realizedPnL;

    if (position.quantity <= 0) {
      this.positions.delete(securityId);
      return { realizedPnL, closed: true };
    }
    return { realizedPnL, closed: false };
  }

  /**
   * 应用公司行为（送/转/配/拆/合/分红）到持仓（STEP 11 接线：corporateActions/portfolioTransform）。
   *
   * 桥接 portfolioTransform 的最小 PositionState（quantity/costBasis/averageCost/realizedPnL）与
   * 本账本的内部状态，并把送/转/配/拆/合带来的份额变化按同一比例作用到 available/frozen（T+1 冻结份额同权）。
   * 只改「份额 + 成本基」，现金由 Portfolio 层按 cashDelta 结算。
   *
   * @returns cashDelta 现金净变动（分红为正、配股认购为负）；ratio 份额缩放比例（newQ/oldQ，无份额变化为 1）。
   */
  applyCorporateAction(
    securityId: string,
    actions: readonly CorporateAction[],
  ): { cashDelta: number; ratio: number } {
    const position = this.positions.get(securityId);
    if (!position || actions.length === 0) return { cashDelta: 0, ratio: 1 };
    const beforeQ = position.quantity;
    const result = applyCorporateActionsToPosition(
      {
        quantity: beforeQ,
        costBasis: position.totalCostBasis,
        averageCost: beforeQ > 0 ? position.totalCostBasis / beforeQ : 0,
        realizedPnL: position.realizedPnL,
      },
      actions,
    );
    const ratio = beforeQ > 0 ? result.position.quantity / beforeQ : 1;
    position.quantity = result.position.quantity;
    position.totalCostBasis = result.position.costBasis;
    position.averageEntryPrice = result.position.averageCost;
    position.availableQuantity = Math.round(position.availableQuantity * ratio);
    position.frozenQuantity = Math.round(position.frozenQuantity * ratio);
    position.realizedPnL = result.position.realizedPnL; // 公司行为不结转已实现盈亏
    return { cashDelta: result.cashDelta, ratio };
  }

  /** 按给定价格生成对外只读持仓快照。价格缺失时回退最近市场价/成本价。 */
  snapshot(prices: ReadonlyMap<string, number>): Position[] {
    return Array.from(this.positions.values()).map((position) => {
      const priceValue = prices.get(position.securityId);
      const price =
        priceValue !== undefined && Number.isFinite(priceValue) && priceValue > 0
          ? priceValue
          : (position.marketPrice ?? position.averageEntryPrice);
      const marketValue = price * position.quantity;
      return {
        securityId: position.securityId,
        quantity: position.quantity,
        availableQuantity: position.availableQuantity,
        frozenQuantity: position.frozenQuantity,
        averageEntryPrice: position.averageEntryPrice,
        marketPrice: position.marketPrice,
        marketValue,
        realizedPnL: position.realizedPnL,
        unrealizedPnL: marketValue - position.totalCostBasis,
      };
    });
  }

  /** 标记价格并返回持仓总市值。 */
  markToMarket(prices: ReadonlyMap<string, number>): number {
    let total = 0;
    for (const position of Array.from(this.positions.values())) {
      const priceValue = prices.get(position.securityId);
      if (priceValue !== undefined && Number.isFinite(priceValue) && priceValue > 0) {
        position.marketPrice = priceValue;
      }
      total += (position.marketPrice ?? position.averageEntryPrice) * position.quantity;
    }
    return total;
  }

  /** 全部已实现盈亏之和。 */
  totalRealizedPnL(): number {
    let total = 0;
    for (const position of Array.from(this.positions.values())) total += position.realizedPnL;
    return total;
  }
}
