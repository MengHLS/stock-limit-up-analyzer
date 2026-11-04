/**
 * STEP 8 — Cost Layer：交易成本核算（按 buy/sell 区分）。
 *
 * 六字段 CostModel 仍复用生产层 `engine/domain#CostModel`（单一事实来源），本层只负责
 * 把费用分解为 commission / stampDuty / transferFee / otherFees 四类现金费用，
 * 并与滑点（已计入成交价）分离。买入不收印花税、卖出收印花税，全部经 CostModel，
 * 绝不散落在引擎各处硬编码。
 */

import type { CostModel } from "../engine/domain";
import type { Side, TradeCost } from "./types";

/** 佣金（不低于最低佣金）。 */
export function commissionFee(grossAmount: number, cost: CostModel): number {
  return Math.max(cost.minCommission, grossAmount * cost.commissionRate);
}

/** 印花税（仅卖出）。 */
export function stampDutyFee(grossAmount: number, cost: CostModel, side: Side): number {
  return side === "sell" ? grossAmount * cost.stampDutyRate : 0;
}

/** 过户费（双边）。 */
export function transferFee(grossAmount: number, cost: CostModel): number {
  return grossAmount * cost.transferFeeRate;
}

/** 其它费用（预留，默认 0）。 */
export function otherFees(_grossAmount: number, _cost: CostModel): number {
  return 0;
}

/** 按方向计算分解费用（现金费用，不含滑点）。 */
export function computeTradeCost(side: Side, grossAmount: number, cost: CostModel): TradeCost {
  const commission = commissionFee(grossAmount, cost);
  const stampDuty = stampDutyFee(grossAmount, cost, side);
  const transfer = transferFee(grossAmount, cost);
  const others = otherFees(grossAmount, cost);
  return {
    commission,
    stampDuty,
    transferFee: transfer,
    otherFees: others,
    total: commission + stampDuty + transfer + others,
  };
}

/** 滑点金额（相对无滑点基准价的价差 × 数量）。 */
export function slippageAmount(price: number, basePrice: number, quantity: number): number {
  return (price - basePrice) * quantity;
}
