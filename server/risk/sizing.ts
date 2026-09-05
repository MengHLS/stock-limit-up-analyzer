/**
 * Risk Layer — Position Sizer（仓位模型层）。
 *
 * 职责：根据 Signal / OrderIntent 与 RiskContext 计算「建议数量」（proposed quantity）。
 * 只负责「建议做多少」，不执行交易、不修改状态。
 *
 * 所有模型都把数量向下取整到整手（lotSize）。如果无法得到有效价格或不足一手，
 * 返回 0，由 RiskManager 的 LotSizePolicy / CashPolicy 进一步裁决（REJECT）。
 */

import type { OrderIntent, PositionSizer, RiskContext } from "./contract";

/** 向下取整到整手。 */
export function floorToLot(quantity: number, lotSize: number): number {
  const lot = lotSize > 0 ? Math.floor(lotSize) : 1;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.floor(quantity / lot) * lot;
}

/** 有效市场价（用于仓位估算）。 */
function effectivePrice(context: RiskContext): number | null {
  const p = context.marketPrice;
  if (p === null || !Number.isFinite(p) || p <= 0) return null;
  return p;
}

const lotOf = (context: RiskContext): number => (context.cost.lotSize > 0 ? Math.floor(context.cost.lotSize) : 1);

/**
 * 模型 1：固定数量。每次固定 N 股（如 1000 股）。
 * 注意：作为「策略显式请求的数量」，不做整手向下取整——非整手请求（如 50 股）原样返回，
 * 由 RiskManager 的 LotSizePolicy 拒绝（合法性校验 ≠ 自动修正）。
 */
export class FixedQuantitySizer implements PositionSizer {
  readonly name = "fixed-quantity";
  constructor(private readonly quantity: number) {}
  propose(_intent: OrderIntent, _context: RiskContext): number {
    return this.quantity;
  }
}

/**
 * 模型 2：固定资金。每次使用账户权益的固定比例金额（如 10% 资金）买入。
 */
export class FixedCapitalSizer implements PositionSizer {
  readonly name = "fixed-capital";
  constructor(private readonly equityRatio: number) {}
  propose(_intent: OrderIntent, context: RiskContext): number {
    const price = effectivePrice(context);
    if (price === null) return 0;
    const capital = context.equity * this.equityRatio;
    return floorToLot(capital / price, lotOf(context));
  }
}

/**
 * 模型 3：固定权重。目标仓位 = 账户权益的固定权重（如 10%）。
 * 与 FixedCapital 的区别：以「目标市值」为基准，语义上表达仓位权重意图。
 */
export class FixedWeightSizer implements PositionSizer {
  readonly name = "fixed-weight";
  constructor(private readonly weight: number) {}
  propose(_intent: OrderIntent, context: RiskContext): number {
    const price = effectivePrice(context);
    if (price === null) return 0;
    const targetValue = context.equity * this.weight;
    return floorToLot(targetValue / price, lotOf(context));
  }
}

/**
 * 模型 4：风险封顶。单笔最大风险金额不得超过账户权益的固定比例。
 * 风险金额 = 入场价 × 止损距离（stopDistancePct）× 数量。
 * 数量 = floor(riskBudget / perShareRisk / lotSize) × lotSize。
 */
export class RiskCappedSizer implements PositionSizer {
  readonly name = "risk-capped";
  constructor(
    private readonly maxRiskRatio: number,
    private readonly stopDistancePct: number,
  ) {}
  propose(_intent: OrderIntent, context: RiskContext): number {
    const price = effectivePrice(context);
    if (price === null || this.stopDistancePct <= 0) return 0;
    const riskBudget = context.equity * this.maxRiskRatio;
    const perShareRisk = price * this.stopDistancePct;
    if (perShareRisk <= 0) return 0;
    return floorToLot(riskBudget / perShareRisk, lotOf(context));
  }
}
