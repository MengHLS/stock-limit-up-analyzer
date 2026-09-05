/**
 * STEP 9 — Risk Engine · 前置风控（Pre-Trade Risk）。
 *
 * validateOrder()：在成交前对订单意图做裁决，返回 PASS / REJECT 及结构化原因码。
 *
 * 原因码与规范 §八对齐：
 *   - INVALID_ORDER    订单本身非法（空 symbol / 非正数量 / 非整手 / 缺价 / 无持仓 / T+1 可卖不足）
 *   - INSUFFICIENT_CASH 买入总成本（含费用）超过现金
 *   - MAX_POSITION      开新仓超过最大持仓数
 *   - MAX_EXPOSURE      单股 / 总敞口 / 行业权重超限
 *   - RISK_LIMIT        回撤 / 单日亏损击穿，禁止新增风险
 *
 * 纯函数、确定性：不修改任何状态，只读快照 + 限额 + 历史上下文。
 */

import { buyFees, round2, type FeeSchedule, type OrderRequest, type PortfolioSnapshot } from "../portfolio";
import { DEFAULT_FEE_SCHEDULE } from "../portfolio";
import type { OrderValidationResult, RiskHistory, RiskLimit, SectorResolver } from "./domain";

export interface ValidateOrderInput {
  order: OrderRequest;
  snapshot: PortfolioSnapshot;
  limits: RiskLimit;
  /** 当前市场价（用于成本/敞口估算）；可空表示未知。 */
  price: number | null;
  feeSchedule?: FeeSchedule;
  /** 行业解析（可选；缺省则不检查行业权重）。 */
  sectorOf?: SectorResolver;
  /** 历史上下文（可选；缺省则跳过回撤/单日亏损检查）。 */
  history?: RiskHistory;
}

/** 有效正价格。 */
function validPrice(price: number | null | undefined): price is number {
  return price !== null && price !== undefined && Number.isFinite(price) && price > 0;
}

/** 组合权益（<=0 时回退为 1，避免除零）。 */
function equityOf(snapshot: PortfolioSnapshot): number {
  return snapshot.equity > 0 ? snapshot.equity : 1;
}

/** 当前回撤深度（0~1，正数表示回撤）。 */
function drawdownOf(equity: number, history?: RiskHistory): number {
  if (!history || !Number.isFinite(history.peakEquity) || history.peakEquity <= 0) return 0;
  return Math.max(0, (history.peakEquity - equity) / history.peakEquity);
}

/** 当日亏损（0~1，正数表示亏损，盈利为 0）。 */
function dailyLossOf(equity: number, history?: RiskHistory): number {
  if (!history || !Number.isFinite(history.previousEquity) || history.previousEquity <= 0) return 0;
  return Math.max(0, (history.previousEquity - equity) / history.previousEquity);
}

/**
 * 前置风控裁决。
 * 检查顺序固定（INVALID_ORDER → INSUFFICIENT_CASH → MAX_POSITION → MAX_EXPOSURE → RISK_LIMIT），
 * 保证同一输入恒返回同一结果。
 */
export function validateOrder(input: ValidateOrderInput): OrderValidationResult {
  const { order, snapshot, limits, price } = input;
  const feeSchedule = input.feeSchedule ?? DEFAULT_FEE_SCHEDULE;
  const lotSize = feeSchedule.lotSize > 0 ? Math.floor(feeSchedule.lotSize) : 1;
  const equity = equityOf(snapshot);

  // ---- 1. INVALID_ORDER ----
  if (!order.symbol || order.symbol.trim() === "") {
    return { verdict: "REJECT", reasonCode: "INVALID_ORDER", message: "symbol 为空" };
  }
  if (order.quantity <= 0 || !Number.isInteger(order.quantity)) {
    return { verdict: "REJECT", reasonCode: "INVALID_ORDER", message: `数量非法：${order.quantity}` };
  }
  if (!validPrice(price)) {
    return { verdict: "REJECT", reasonCode: "INVALID_ORDER", message: "缺少有效市场价" };
  }

  if (order.side === "buy") {
    if (order.quantity % lotSize !== 0) {
      return { verdict: "REJECT", reasonCode: "INVALID_ORDER", message: `买入数量必须是 ${lotSize} 的整数倍` };
    }
  } else {
    const held = snapshot.positions.find((p) => p.symbol === order.symbol);
    if (!held) {
      return { verdict: "REJECT", reasonCode: "INVALID_ORDER", message: `无该股票持仓：${order.symbol}` };
    }
    if (order.quantity > held.availableQuantity) {
      return {
        verdict: "REJECT",
        reasonCode: "INVALID_ORDER",
        message: `T+1 可卖数量不足（需 ${order.quantity}，可卖 ${held.availableQuantity}）`,
      };
    }
  }

  // 卖出无新增风险，其余检查仅针对买入。
  if (order.side !== "buy") {
    return { verdict: "PASS" };
  }

  // ---- 2. INSUFFICIENT_CASH ----
  const grossAmount = round2(price! * order.quantity);
  const totalCost = round2(grossAmount + buyFees(grossAmount, feeSchedule));
  if (totalCost > snapshot.cash + 1e-8) {
    return { verdict: "REJECT", reasonCode: "INSUFFICIENT_CASH", message: `资金不足：需 ${totalCost}，现金 ${snapshot.cash}` };
  }

  // ---- 3. MAX_POSITION ----
  const alreadyHeld = snapshot.positions.some((p) => p.symbol === order.symbol);
  if (limits.maxPositions > 0 && !alreadyHeld && snapshot.positions.length >= limits.maxPositions) {
    return {
      verdict: "REJECT",
      reasonCode: "MAX_POSITION",
      message: `超过最大持仓数 ${limits.maxPositions}`,
    };
  }

  // ---- 4. MAX_EXPOSURE ----
  const existingSymbolValue = snapshot.positions
    .filter((p) => p.symbol === order.symbol)
    .reduce((sum, p) => sum + p.marketValue, 0);
  const projectedSymbolValue = round2(existingSymbolValue + grossAmount);
  const projectedMarketValue = round2(snapshot.marketValue + grossAmount);

  if (limits.maxPositionWeight > 0 && projectedSymbolValue / equity > limits.maxPositionWeight) {
    return {
      verdict: "REJECT",
      reasonCode: "MAX_EXPOSURE",
      message: `单一标的敞口超限（${(projectedSymbolValue / equity).toFixed(4)} > ${limits.maxPositionWeight}）`,
    };
  }
  if (limits.maxGrossExposure > 0 && projectedMarketValue / equity > limits.maxGrossExposure) {
    return {
      verdict: "REJECT",
      reasonCode: "MAX_EXPOSURE",
      message: `总敞口超限（${(projectedMarketValue / equity).toFixed(4)} > ${limits.maxGrossExposure}）`,
    };
  }
  if (limits.maxSectorWeight > 0 && input.sectorOf) {
    const sector = input.sectorOf(order.symbol);
    if (sector !== undefined && sector !== "") {
      const existingSectorValue = snapshot.positions
        .filter((p) => (p.sector ?? input.sectorOf!(p.symbol)) === sector)
        .reduce((sum, p) => sum + p.marketValue, 0);
      const projectedSectorValue = round2(existingSectorValue + grossAmount);
      if (projectedSectorValue / equity > limits.maxSectorWeight) {
        return {
          verdict: "REJECT",
          reasonCode: "MAX_EXPOSURE",
          message: `行业 ${sector} 敞口超限（${(projectedSectorValue / equity).toFixed(4)} > ${limits.maxSectorWeight}）`,
        };
      }
    }
  }

  // ---- 5. RISK_LIMIT ----
  if (input.history) {
    const drawdown = drawdownOf(snapshot.equity, input.history);
    const dailyLoss = dailyLossOf(snapshot.equity, input.history);
    if (drawdown > limits.maxDrawdown) {
      return {
        verdict: "REJECT",
        reasonCode: "RISK_LIMIT",
        message: `回撤超限（${drawdown.toFixed(4)} > ${limits.maxDrawdown}），禁止新增风险`,
      };
    }
    if (dailyLoss > limits.maxDailyLoss) {
      return {
        verdict: "REJECT",
        reasonCode: "RISK_LIMIT",
        message: `单日亏损超限（${dailyLoss.toFixed(4)} > ${limits.maxDailyLoss}），禁止新增风险`,
      };
    }
  }

  return { verdict: "PASS" };
}
