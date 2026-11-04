/**
 * STEP 9 — Portfolio Engine · Accounting（确定性会计层）。
 *
 * 职责：定义 Buy / Sell / Fill / Fee / Tax / Cash movement 的全部金额计算。
 * 所有函数都是纯函数：无 Date.now() / Math.random() / 网络 / 全局状态，
 * 相同输入恒产生相同输出（deterministic）。
 *
 * 金额口径（人民币元）：
 *   - 佣金 = max(minCommission, gross × commissionRate)
 *   - 过户费 = gross × transferFeeRate
 *   - 印花税 = gross × stampDutyRate（仅卖出）
 *   - 买入费用 = 佣金 + 过户费；卖出费用 = 佣金 + 过户费 + 印花税
 *
 * 所有金额按「分」四舍五入（round2），股数为整数，确保逐笔可复现、可对账。
 */

import type { FeeSchedule, Fill, OrderRequest, Side } from "./domain";

/** 金额四舍五入到分（2 位小数）。 */
export function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** 价格/成本比率四舍五入到 4 位小数（用于平均成本等派生比率）。 */
export function round4(value: number): number {
  return Number(value.toFixed(4));
}

/** 佣金（不低于最低佣金）。 */
export function commission(grossAmount: number, schedule: FeeSchedule): number {
  return round2(Math.max(schedule.minCommission, grossAmount * schedule.commissionRate));
}

/** 过户费（双边）。 */
export function transferFee(grossAmount: number, schedule: FeeSchedule): number {
  return round2(grossAmount * schedule.transferFeeRate);
}

/** 印花税（仅卖出；买入恒为 0）。 */
export function stampDuty(grossAmount: number, side: Side, schedule: FeeSchedule): number {
  return side === "sell" ? round2(grossAmount * schedule.stampDutyRate) : 0;
}

/** 买入费用 = 佣金 + 过户费（不含印花税）。 */
export function buyFees(grossAmount: number, schedule: FeeSchedule): number {
  return round2(commission(grossAmount, schedule) + transferFee(grossAmount, schedule));
}

/** 卖出费用 = 佣金 + 过户费 + 印花税。 */
export function sellFees(grossAmount: number, schedule: FeeSchedule): number {
  return round2(commission(grossAmount, schedule) + transferFee(grossAmount, schedule) + stampDuty(grossAmount, "sell", schedule));
}

/** 买入现金净变动 = −(成交额 + 买入费用)。 */
export function buyCash(grossAmount: number, schedule: FeeSchedule): number {
  return round2(-(grossAmount + buyFees(grossAmount, schedule)));
}

/** 卖出现金净变动 = 成交额 − 卖出费用。 */
export function sellCash(grossAmount: number, schedule: FeeSchedule): number {
  return round2(grossAmount - sellFees(grossAmount, schedule));
}

/**
 * 由订单 + 成交价确定性构造 Fill（费用/税/现金变动一次算清）。
 * 不校验持仓/资金（那是 PortfolioAccount 与 Risk Engine 的职责）。
 */
export function computeFill(order: OrderRequest, price: number, executedAt: string, schedule: FeeSchedule): Fill {
  const grossAmount = round2(price * order.quantity);
  const fees = order.side === "buy" ? buyFees(grossAmount, schedule) : round2(commission(grossAmount, schedule) + transferFee(grossAmount, schedule));
  const tax = stampDuty(grossAmount, order.side, schedule);
  const netCash = order.side === "buy" ? buyCash(grossAmount, schedule) : sellCash(grossAmount, schedule);
  return {
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    price,
    grossAmount,
    fees,
    tax,
    netCash,
    executedAt,
  };
}
