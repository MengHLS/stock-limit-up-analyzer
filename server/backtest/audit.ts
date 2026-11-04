/**
 * STEP 8 — Audit Layer：审计追踪。
 *
 * 每次回测必须能解释：为什么买 / 为什么卖 / 为什么没有成交 / 为什么被拒 / 为什么产生某个 PnL。
 * 提供三类审计：order audit（订单生命周期）、fill audit（成交明细）、position audit（持仓变动）。
 */

import type {
  AuditTrail,
  FillAuditEntry,
  OrderAuditEntry,
  PositionAuditEntry,
} from "./types";

export class AuditLog {
  private readonly orders: OrderAuditEntry[] = [];
  private readonly fills: FillAuditEntry[] = [];
  private readonly positions: PositionAuditEntry[] = [];

  recordOrder(entry: OrderAuditEntry): void {
    this.orders.push(entry);
  }

  recordFill(entry: FillAuditEntry): void {
    this.fills.push(entry);
  }

  recordPosition(entry: PositionAuditEntry): void {
    this.positions.push(entry);
  }

  snapshot(): AuditTrail {
    return {
      orders: [...this.orders],
      fills: [...this.fills],
      positions: [...this.positions],
    };
  }
}

/** 构造 FillAuditEntry（从 Fill 提取审计字段）。 */
export function fillAuditEntry(
  fillId: string,
  orderId: string,
  securityId: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  basePrice: number,
  timestamp: string,
  slippageAmount: number,
  cost: FillAuditEntry["cost"],
): FillAuditEntry {
  return { fillId, orderId, securityId, side, quantity, price, basePrice, timestamp, slippageAmount, cost };
}
