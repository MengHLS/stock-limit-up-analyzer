/**
 * Risk Layer — 具体 Risk Policy 实现。
 *
 * 每个 Policy 都是纯函数（无副作用），只读 RiskContext，返回 RiskDecision。
 * 区分 REJECT（硬拒绝，如非整手、超持仓数）与 RESIZE（软缩放，如资金/容量/敞口不足时向下取整）。
 *
 * Policy 清单：
 *   - LotSizePolicy                — 非整手买入 → REJECT INVALID_LOT_SIZE
 *   - MaxPositionsPolicy           — 超最大持仓数 / 同 symbol 加仓 → REJECT
 *   - CapacityPolicy               — 单笔买入金额超当日成交额容量 → RESIZE / REJECT
 *   - MaxSymbolExposurePolicy      — 单标的敞口超限 → RESIZE / REJECT
 *   - MaxPortfolioExposurePolicy   — 组合总敞口超限 → RESIZE / REJECT
 *   - CashPolicy                   — 资金不足 → RESIZE / REJECT
 *
 * 注：单笔买入金额的「流动性容量约束」与「单 symbol/组合敞口」是两类完全不同的概念：
 *   - CapacityPolicy             限单笔下单金额 ≤ 当日参考成交额 × ratio（流动性）
 *   - MaxSymbolExposurePolicy    限单 symbol 持仓市值 / equity（敞口）
 *   - MaxPortfolioExposurePolicy 限组合总持仓市值 / equity（敞口）
 * 命名按上述口径严格区分，避免历史「exposure/capacity」混用。
 */

import type { OrderIntent, RiskContext, RiskDecision, RiskPolicy, RiskViolation } from "./contract";
import { floorToLot } from "./sizing";
import { buyFees, slippedBuyPriceAdjusted } from "../engine/execution";

/** 构造决策的便捷工具。 */
function decision(kind: RiskDecision["kind"], intent: OrderIntent, approvedQuantity: number, violations: RiskViolation[] = []): RiskDecision {
  return { kind, approvedQuantity, requestedQuantity: intent.requestedQuantity, violations };
}

const lotOf = (context: RiskContext): number => (context.cost.lotSize > 0 ? Math.floor(context.cost.lotSize) : 1);

/**
 * LotSizePolicy：买入数量必须是整手，否则 REJECT（合法性校验，非自动修正）。
 * 卖出允许非整手（清仓时按持仓全额卖出）。
 */
export class LotSizePolicy implements RiskPolicy {
  readonly name = "lot-size";
  check(intent: OrderIntent, context: RiskContext): RiskDecision {
    if (intent.side !== "buy") return decision("APPROVE", intent, intent.requestedQuantity);
    const lot = lotOf(context);
    if (intent.requestedQuantity % lot !== 0) {
      return decision("REJECT", intent, 0, [
        { code: "INVALID_LOT_SIZE", message: `买入数量必须是 ${lot} 的整数倍，实际 ${intent.requestedQuantity}`, policy: this.name },
      ]);
    }
    return decision("APPROVE", intent, intent.requestedQuantity);
  }
}

/**
 * MaxPositionsPolicy：开仓数量达到上限或对已持仓股票加仓时，新的 BUY 信号不得产生有效成交（REJECT）。
 * 对应 Step 2 的 maxPositions 硬约束迁移。
 *
 * 加仓语义：在当前最小模型下 Portfolio.buy 拒绝「同一股票已有持仓，暂不支持加仓」，
 * 风险层需与订单层一致：已有同 symbol 持仓时 BUY 直接 REJECT，避免出现「风险通过、订单拒绝」
 * 的隐式失败（详见审计 P3-F5）。
 */
export class MaxPositionsPolicy implements RiskPolicy {
  readonly name = "max-positions";
  constructor(private readonly maxPositions: number) {}
  check(intent: OrderIntent, context: RiskContext): RiskDecision {
    if (intent.side !== "buy") return decision("APPROVE", intent, intent.requestedQuantity);
    // 加仓拦截：最小模型下不允许对同一 symbol 加仓，与 Portfolio.buy 兜底对齐。
    const alreadyHeld = context.positions.some((p) => p.symbol === intent.symbol);
    if (alreadyHeld) {
      return decision("REJECT", intent, 0, [
        { code: "ADD_POSITION_NOT_SUPPORTED", message: `当前最小模型不支持对已持仓股票 ${intent.symbol} 加仓`, policy: this.name },
      ]);
    }
    if (context.openPositionCount >= this.maxPositions) {
      return decision("REJECT", intent, 0, [
        { code: "MAX_POSITIONS_EXCEEDED", message: `超过最大持仓数 ${this.maxPositions}`, policy: this.name },
      ]);
    }
    return decision("APPROVE", intent, intent.requestedQuantity);
  }
}

/**
 * CapacityPolicy：单笔买入金额不得超过「当日参考成交额 × ratio」的流动性容量。
 * 对应 Step 2 的 maxPositionAmountRatio 硬约束迁移（ratio=0 表示不限）。
 * 超容量时 RESIZE 到容量上限（向下取整到整手）；不足一手则 REJECT。
 *
 * 注：本 Policy 限的是「单笔下单金额」对应的「流动性容量」，与敞口约束
 * （MaxSymbolExposure / MaxPortfolioExposure）语义不同，命名严格区分以避免历史混淆
 *（P3-F4 修复）。
 */
export class CapacityPolicy implements RiskPolicy {
  readonly name = "capacity";
  constructor(private readonly ratio: number) {}
  check(intent: OrderIntent, context: RiskContext): RiskDecision {
    if (intent.side !== "buy") return decision("APPROVE", intent, intent.requestedQuantity);
    const price = effectivePrice(context);
    const amount = context.referenceAmount;
    if (this.ratio <= 0 || price === null || amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) {
      return decision("APPROVE", intent, intent.requestedQuantity);
    }
    const lot = lotOf(context);
    const capacityAmount = amount * 1000 * this.ratio; // amount 单位千元 → 元
    const capacityShares = Math.floor(capacityAmount / price / lot) * lot;
    if (capacityShares < lot) {
      return decision("REJECT", intent, 0, [
        { code: "CAPACITY_EXCEEDED", message: `容量不足以成交一手（容量 ${capacityAmount.toFixed(2)} 元）`, policy: this.name },
      ]);
    }
    if (capacityShares < intent.requestedQuantity) {
      return decision("RESIZE", intent, capacityShares, [
        { code: "CAPACITY_EXCEEDED", message: `单笔买入金额超容量上限，${intent.requestedQuantity} → ${capacityShares} 股`, policy: this.name },
      ]);
    }
    return decision("APPROVE", intent, intent.requestedQuantity);
  }
}

/**
 * MaxSymbolExposurePolicy：单一标的持仓市值不得超过账户权益的固定比例（如 20%）。
 * 超出部分 RESIZE（向下取整到整手）；不足以再增持一手则 REJECT。
 */
export class MaxSymbolExposurePolicy implements RiskPolicy {
  readonly name = "max-symbol-exposure";
  constructor(private readonly maxSymbolExposureRatio: number) {}
  check(intent: OrderIntent, context: RiskContext): RiskDecision {
    if (intent.side !== "buy") return decision("APPROVE", intent, intent.requestedQuantity);
    if (this.maxSymbolExposureRatio <= 0) return decision("APPROVE", intent, intent.requestedQuantity);
    const price = effectivePrice(context);
    if (price === null) return decision("APPROVE", intent, intent.requestedQuantity);
    const lot = lotOf(context);
    const existingValue = context.positions.filter((p) => p.symbol === intent.symbol).reduce((sum, p) => sum + p.marketValue, 0);
    const maxValue = context.equity * this.maxSymbolExposureRatio;
    const availableValue = maxValue - existingValue;
    if (availableValue < 0) return decision("REJECT", intent, 0, [
      { code: "MAX_SYMBOL_EXPOSURE", message: `单一标的敞口已超上限 ${this.maxSymbolExposureRatio * 100}%`, policy: this.name },
    ]);
    const availableShares = Math.floor(availableValue / price / lot) * lot;
    if (availableShares < lot) {
      return decision("REJECT", intent, 0, [
        { code: "MAX_SYMBOL_EXPOSURE", message: `单标的剩余容量不足以成交一手`, policy: this.name },
      ]);
    }
    if (availableShares < intent.requestedQuantity) {
      return decision("RESIZE", intent, availableShares, [
        { code: "MAX_SYMBOL_EXPOSURE", message: `单标的敞口超限，${intent.requestedQuantity} → ${availableShares} 股`, policy: this.name },
      ]);
    }
    return decision("APPROVE", intent, intent.requestedQuantity);
  }
}

/**
 * MaxPortfolioExposurePolicy：组合总持仓市值不得超过账户权益的固定比例（如 100%）。
 * 超出部分 RESIZE（向下取整到整手）；不足以再增持一手则 REJECT。
 */
export class MaxPortfolioExposurePolicy implements RiskPolicy {
  readonly name = "max-portfolio-exposure";
  constructor(private readonly maxPortfolioExposureRatio: number) {}
  check(intent: OrderIntent, context: RiskContext): RiskDecision {
    if (intent.side !== "buy") return decision("APPROVE", intent, intent.requestedQuantity);
    if (this.maxPortfolioExposureRatio <= 0) return decision("APPROVE", intent, intent.requestedQuantity);
    const price = effectivePrice(context);
    if (price === null) return decision("APPROVE", intent, intent.requestedQuantity);
    const lot = lotOf(context);
    const currentValue = context.positions.reduce((sum, p) => sum + p.marketValue, 0);
    const maxValue = context.equity * this.maxPortfolioExposureRatio;
    const availableValue = maxValue - currentValue;
    if (availableValue < 0) return decision("REJECT", intent, 0, [
      { code: "MAX_PORTFOLIO_EXPOSURE", message: `组合总敞口已超上限 ${this.maxPortfolioExposureRatio * 100}%`, policy: this.name },
    ]);
    const availableShares = Math.floor(availableValue / price / lot) * lot;
    if (availableShares < lot) {
      return decision("REJECT", intent, 0, [
        { code: "MAX_PORTFOLIO_EXPOSURE", message: `组合剩余敞口不足以成交一手`, policy: this.name },
      ]);
    }
    if (availableShares < intent.requestedQuantity) {
      return decision("RESIZE", intent, availableShares, [
        { code: "MAX_PORTFOLIO_EXPOSURE", message: `组合总敞口超限，${intent.requestedQuantity} → ${availableShares} 股`, policy: this.name },
      ]);
    }
    return decision("APPROVE", intent, intent.requestedQuantity);
  }
}

/**
 * CashPolicy：订单总成本（price×quantity + 滑点 + 佣金 + 过户费）不得超过可用现金。
 * 资金不足时 RESIZE 到可负担的最大整手；不足以负担一手则 REJECT。
 * 禁止 Portfolio 在正常路径下出现负现金。
 */
export class CashPolicy implements RiskPolicy {
  readonly name = "cash";
  check(intent: OrderIntent, context: RiskContext): RiskDecision {
    if (intent.side !== "buy") return decision("APPROVE", intent, intent.requestedQuantity);
    const price = effectivePrice(context);
    if (price === null) return decision("REJECT", intent, 0, [
      { code: "INSUFFICIENT_CASH", message: "缺少有效价格，无法评估资金充足性", policy: this.name },
    ]);
    const lot = lotOf(context);
    // 用与执行层一致的滑点（含参考成交额的流动性分层）估算买入价，保证「cash >= requiredCash」
    // 且风险决策的数量与实际成交数量严格一致，不做静默二次截断。
    const executionPrice = slippedBuyPriceAdjusted(price, context.cost, context.referenceAmount);
    let quantity = intent.requestedQuantity;
    while (quantity >= lot) {
      const gross = executionPrice * quantity;
      if (gross + buyFees(gross, context.cost) <= context.availableCash + 1e-8) break;
      quantity -= lot;
    }
    if (quantity < lot) {
      return decision("REJECT", intent, 0, [
        { code: "INSUFFICIENT_CASH", message: `资金不足：需至少 1 手（${lot} 股）`, policy: this.name },
      ]);
    }
    if (quantity < intent.requestedQuantity) {
      return decision("RESIZE", intent, quantity, [
        { code: "INSUFFICIENT_CASH", message: `资金不足，${intent.requestedQuantity} → ${quantity} 股`, policy: this.name },
      ]);
    }
    return decision("APPROVE", intent, intent.requestedQuantity);
  }
}

/** 有效市场价（内部）。 */
function effectivePrice(context: RiskContext): number | null {
  const p = context.marketPrice;
  if (p === null || !Number.isFinite(p) || p <= 0) return null;
  return p;
}

export { floorToLot };
