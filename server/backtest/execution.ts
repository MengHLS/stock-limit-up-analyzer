/**
 * STEP 8 — Execution Layer：四种执行模型。
 *
 * NEXT_OPEN    → 以 executionTime 当日开盘价成交。
 * NEXT_CLOSE   → 以 executionTime 当日收盘价成交。
 * VWAP_PROXY   → 以当日成交额/成交量估算的 VWAP 成交。
 * LIMIT_PRICE  → 限价单：仅在开盘价触及限价时成交。
 *
 * 未来函数防护：每种模型只读取其成交时点「已可知」的价格字段——
 *   - NEXT_OPEN 只读 open / prevClose（不读 close/high/low，当日收盘后才知道）；
 *   - NEXT_CLOSE / VWAP_PROXY 在「信号 T 日收盘 → 次日成交」语义下，成交日为 T+1，
 *     读取 T+1 收盘价不构成未来函数（T+1 收盘晚于 T 收盘）。
 * 滑点分层只使用「成交时点之前已可知」的参考成交额（信号日成交额），绝不用成交日全天成交额。
 */

import {
  amountAdjustedSlippageBps,
  limitDownPrice,
  limitUpPrice,
  slippedBuyPriceAdjusted,
  validPrice,
} from "../engine/execution";
import type { CostModel } from "../engine/domain";
import type {
  CanonicalMarketBar,
} from "../data/types";
import type {
  ExecutionModel,
  ExecutionModelId,
  ExecutionQuote,
  ExecutionRuleContext,
  Order,
  RejectionReason,
} from "./types";

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

/** 卖出成交价（含滑点，下浮，按参考成交额做流动性分层）。 */
function slippedSellPriceAdjusted(price: number, cost: CostModel, referenceAmount?: number | null): number {
  const effectiveBps = amountAdjustedSlippageBps(cost.slippageBps, referenceAmount);
  return round(price * (1 - effectiveBps / 10_000), 4);
}

/** 构造拒绝报价。 */
function rejected(reason: RejectionReason): ExecutionQuote {
  return { kind: "rejected", rejectionReason: reason };
}

/** 构造成交报价（basePrice 无滑点，price 含滑点）。 */
function filled(basePrice: number, price: number, referenceAmount: number | null): ExecutionQuote {
  return { kind: "filled", basePrice, price, referenceAmount };
}

/** 涨跌停判定（基于前收盘价与规则幅度）。 */
function limitState(bar: CanonicalMarketBar, rules: ExecutionRuleContext): { limitUp: boolean; limitDown: boolean } {
  const prevClose = bar.preClose;
  if (!validPrice(prevClose)) return { limitUp: false, limitDown: false };
  const up = limitUpPrice(prevClose, rules.limitUpRatio);
  const down = limitDownPrice(prevClose, rules.limitDownRatio);
  return {
    limitUp: validPrice(bar.open) ? (bar.open as number) >= up : false,
    limitDown: validPrice(bar.open) ? (bar.open as number) <= down : false,
  };
}

/**
 * 通用「开盘/收盘成交」骨架：给定基准价，做涨跌停拦截 + 滑点分层。
 * 返回报价或拒绝。
 */
function marketQuote(
  order: Order,
  bar: CanonicalMarketBar,
  rules: ExecutionRuleContext,
  cost: CostModel,
  referenceAmount: number | null,
  basePrice: number | null,
): ExecutionQuote {
  if (!validPrice(basePrice)) return rejected("NO_LIQUIDITY");
  if (!validPrice(bar.preClose)) return rejected("OTHER");

  const { limitUp, limitDown } = limitState(bar, rules);
  if (order.side === "buy") {
    if (rules.blockLimitUpBuy && limitUp) return rejected("LIMIT_UP");
    const price = slippedBuyPriceAdjusted(basePrice!, cost, referenceAmount);
    return filled(basePrice!, price, referenceAmount);
  }
  if (rules.blockLimitDownSell && limitDown) return rejected("LIMIT_DOWN");
  const price = slippedSellPriceAdjusted(basePrice!, cost, referenceAmount);
  return filled(basePrice!, price, referenceAmount);
}

/** 估算当日 VWAP 代理价（amount 千元 / volume 手 → 元/股）。 */
export function proxyVwapPrice(bar: CanonicalMarketBar): number | null {
  if (validPrice(bar.amount) && validPrice(bar.volume) && (bar.volume as number) > 0) {
    return (bar.amount as number) * 10 / (bar.volume as number);
  }
  // 回落：可用 OHLC 均值。
  const parts = [bar.open, bar.high, bar.low, bar.close].filter(validPrice) as number[];
  if (parts.length === 0) return null;
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

/** NEXT_OPEN：以开盘价成交。 */
class NextOpenExecutionModel implements ExecutionModel {
  readonly id: ExecutionModelId = "NEXT_OPEN";
  quote(order: Order, bar: CanonicalMarketBar, rules: ExecutionRuleContext, cost: CostModel, referenceAmount: number | null): ExecutionQuote {
    if (!validPrice(bar.open)) return rejected("NO_LIQUIDITY");
    return marketQuote(order, bar, rules, cost, referenceAmount, bar.open);
  }
}

/** NEXT_CLOSE：以收盘价成交（信号 T 日收盘 → T+1 收盘成交，无未来函数）。 */
class NextCloseExecutionModel implements ExecutionModel {
  readonly id: ExecutionModelId = "NEXT_CLOSE";
  quote(order: Order, bar: CanonicalMarketBar, rules: ExecutionRuleContext, cost: CostModel, referenceAmount: number | null): ExecutionQuote {
    if (!validPrice(bar.close)) return rejected("NO_LIQUIDITY");
    return marketQuote(order, bar, rules, cost, referenceAmount, bar.close);
  }
}

/** VWAP_PROXY：以当日估算 VWAP 成交。 */
class VwapProxyExecutionModel implements ExecutionModel {
  readonly id: ExecutionModelId = "VWAP_PROXY";
  quote(order: Order, bar: CanonicalMarketBar, rules: ExecutionRuleContext, cost: CostModel, referenceAmount: number | null): ExecutionQuote {
    const vwap = proxyVwapPrice(bar);
    if (!validPrice(vwap)) return rejected("NO_LIQUIDITY");
    return marketQuote(order, bar, rules, cost, referenceAmount, vwap);
  }
}

/** LIMIT_PRICE：限价单，仅在开盘价触及限价时成交；市价单回退为 NEXT_OPEN 语义。 */
class LimitPriceExecutionModel implements ExecutionModel {
  readonly id: ExecutionModelId = "LIMIT_PRICE";
  quote(order: Order, bar: CanonicalMarketBar, rules: ExecutionRuleContext, cost: CostModel, referenceAmount: number | null): ExecutionQuote {
    if (order.orderType !== "limit" || order.requestedPrice === null) {
      // 市价单在限价引擎下等价于开盘价成交。
      if (!validPrice(bar.open)) return rejected("NO_LIQUIDITY");
      return marketQuote(order, bar, rules, cost, referenceAmount, bar.open);
    }
    if (!validPrice(bar.open)) return rejected("NO_LIQUIDITY");
    if (!validPrice(bar.preClose)) return rejected("OTHER");

    const open = bar.open as number;
    const limit = order.requestedPrice as number;
    const { limitUp, limitDown } = limitState(bar, rules);

    if (order.side === "buy") {
      if (rules.blockLimitUpBuy && limitUp) return rejected("LIMIT_UP");
      if (open > limit) return rejected("OTHER"); // 开盘价高于限价，未触及
      const price = slippedBuyPriceAdjusted(open, cost, referenceAmount);
      return filled(open, price, referenceAmount);
    }
    if (rules.blockLimitDownSell && limitDown) return rejected("LIMIT_DOWN");
    if (open < limit) return rejected("OTHER"); // 开盘价低于限价，未触及
    const price = slippedSellPriceAdjusted(open, cost, referenceAmount);
    return filled(open, price, referenceAmount);
  }
}

/** 按标识构造执行模型。 */
export function createExecutionModel(id: ExecutionModelId): ExecutionModel {
  switch (id) {
    case "NEXT_CLOSE":
      return new NextCloseExecutionModel();
    case "VWAP_PROXY":
      return new VwapProxyExecutionModel();
    case "LIMIT_PRICE":
      return new LimitPriceExecutionModel();
    case "NEXT_OPEN":
    default:
      return new NextOpenExecutionModel();
  }
}

export { NextOpenExecutionModel, NextCloseExecutionModel, VwapProxyExecutionModel, LimitPriceExecutionModel };
