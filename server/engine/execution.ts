/**
 * Backtest Core — Execution Model（成交模型）与成本模型。
 *
 * 职责：订单 ≠ 成交。ExecutionModel 决定「给定 bar 上订单能否成交、以什么价格成交」，
 * 产出 Fill；成交费用与滑点在此统一计算。资金/持仓是否足够由 Portfolio 层裁决，
 * ExecutionModel 只关心可成交性与成交价。
 *
 * 确定性：本模块不使用 Date.now() / Math.random() / 网络。同一输入恒产生同一输出。
 */

import type { CostModel, Fill, MarketBar, Order, Side } from "./domain";

/** 默认 A 股成本模型（与既有 realisticBacktest 默认参数一致）。 */
export const DEFAULT_COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

/** 是否为有效正价格。 */
export const validPrice = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value) && value > 0;

/** 买入成交价（含滑点，上浮）。 */
export function slippedBuyPrice(price: number, cost: CostModel): number {
  return price * (1 + cost.slippageBps / 10_000);
}

/** 买入成交价（含滑点，上浮，四舍五入到 4 位），支持按参考成交额做流动性分层滑点。
 *  与 NextOpenExecutionModel 实际成交价同一口径，供 Risk Layer（CashPolicy）复用，避免滑点口径漂移。 */
export function slippedBuyPriceAdjusted(price: number, cost: CostModel, referenceAmount?: number | null): number {
  const effectiveBps = amountAdjustedSlippageBps(cost.slippageBps, referenceAmount);
  return round(price * (1 + effectiveBps / 10_000), 4);
}

/** 卖出成交价（含滑点，下浮）。 */
export function slippedSellPrice(price: number, cost: CostModel): number {
  return price * (1 - cost.slippageBps / 10_000);
}

/** 佣金（不低于最低佣金）。 */
function commission(grossAmount: number, cost: CostModel): number {
  return Math.max(cost.minCommission, grossAmount * cost.commissionRate);
}

/** 买入费用 = 佣金 + 过户费（印花税仅在卖出收取）。 */
export function buyFees(grossAmount: number, cost: CostModel): number {
  return commission(grossAmount, cost) + grossAmount * cost.transferFeeRate;
}

/** 卖出费用 = 佣金 + 印花税 + 过户费。 */
export function sellFees(grossAmount: number, cost: CostModel): number {
  return commission(grossAmount, cost) + grossAmount * (cost.stampDutyRate + cost.transferFeeRate);
}

/**
 * 按当日成交额（千元）对基础滑点做流动性分层加成（与既有 realisticBacktest 一致）。
 * 无成交额信息时回落为基础滑点。
 */
export function amountAdjustedSlippageBps(baseBps: number, amount: number | null | undefined): number {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) return baseBps;
  if (amount < 100_000) return baseBps + 20; // < 1 亿元
  if (amount < 500_000) return baseBps + 10; // 1 ~ 5 亿元
  if (amount < 2_000_000) return baseBps + 5; // 5 ~ 20 亿元
  return baseBps; // ≥ 20 亿元
}

/** 标准化的最小成交模型：以 bar 开盘价成交（next-open execution），支持涨跌停可成交性判定。 */
export interface ExecutionModel {
  /**
   * 尝试把订单在该 bar 上成交。
   * 返回成交结果；若不可成交返回含 rejectionReason 的 Fill（quantity=0, price=NaN 由调用方忽略）。
   *
   * @param referenceAmount 参考成交额（单位：千元）。必须是成交时点（bar.date 开盘）之前已可知的数据，
   *   通常为信号日（signalTime）的成交额。禁止传入 bar.date 当日（T+1）的全天成交额，否则构成未来函数。
   *   它同时用于：① 流动性滑点分层；② 作为 Fill.amount 返回，供 Portfolio 做买入容量约束（maxPositionAmountRatio）。
   */
  execute(order: Order, bar: MarketBar, cost: CostModel, referenceAmount?: number | null): Fill;
}

/** 通用涨停/跌停阈值（主板默认 10%；实际板块差异由调用方注入 limitUpRatio/limitDownRatio）。 */
export interface LimitRules {
  /** 涨停幅度，如 0.1 表示 +10%。 */
  limitUpRatio: number;
  /** 跌停幅度，如 0.1 表示 -10%。 */
  limitDownRatio: number;
}

/** 计算涨停价 / 跌停价（基于前收盘价）。 */
export function limitUpPrice(prevClose: number, limitUpRatio: number): number {
  return prevClose * (1 + limitUpRatio);
}
export function limitDownPrice(prevClose: number, limitDownRatio: number): number {
  return prevClose * (1 - limitDownRatio);
}

/**
 * Next-Open 执行模型：订单在 executionTime 对应 bar 的开盘价成交。
 *
 * 可成交性约束（可开关）：
 *  - blockLimitUpBuy：买入时若开盘触及涨停则拒绝（追涨风险）。
 *  - blockLimitDownSell：卖出时若开盘触及跌停则拒绝（跌停封死无法卖出）。
 *
 * 未来函数防护：本模型只读取 bar 的开盘价与前收价，不读取当日的 close/high/low
 * （这些在 executionTime 开盘时点尚不可见）。
 */
export class NextOpenExecutionModel implements ExecutionModel {
  private readonly blockLimitUpBuy: boolean;
  private readonly blockLimitDownSell: boolean;
  private readonly limitRules: LimitRules;

  constructor(options: {
    blockLimitUpBuy?: boolean;
    blockLimitDownSell?: boolean;
    limitRules?: LimitRules;
  } = {}) {
    this.blockLimitUpBuy = options.blockLimitUpBuy ?? false;
    this.blockLimitDownSell = options.blockLimitDownSell ?? false;
    this.limitRules = options.limitRules ?? { limitUpRatio: 0.1, limitDownRatio: 0.1 };
  }

  execute(order: Order, bar: MarketBar, cost: CostModel, referenceAmount?: number | null): Fill {
    const rejection = (reason: string): Fill => ({
      symbol: order.symbol,
      side: order.side,
      quantity: 0,
      price: Number.NaN,
      basePrice: Number.NaN,
      executedAt: bar.date,
      fees: 0,
      slippageAmount: 0,
      amount: null,
      rejectionReason: reason,
    });

    if (!validPrice(bar.open)) return rejection("缺少开盘价，无法成交");
    if (!validPrice(bar.prevClose)) return rejection("缺少前收盘价，无法判定涨跌停");

    const basePrice = bar.open!;
    const prevClose = bar.prevClose!;
    const limitUp = basePrice >= limitUpPrice(prevClose, this.limitRules.limitUpRatio);
    const limitDown = basePrice <= limitDownPrice(prevClose, this.limitRules.limitDownRatio);
    // 未来函数防护：滑点分层只使用「成交时点之前已可知」的参考成交额，绝不用 bar.date 当日全天成交额。
    const refAmount = referenceAmount ?? null;

    if (order.side === "buy") {
      if (this.blockLimitUpBuy && limitUp) return rejection("开盘触及涨停，禁止追买");
      const price = slippedBuyPriceAdjusted(basePrice, cost, refAmount);
      const slippageAmount = (price - basePrice) * order.quantity;
      return { symbol: order.symbol, side: "buy", quantity: order.quantity, price, basePrice, executedAt: bar.date, fees: 0, slippageAmount, amount: refAmount };
    }

    // sell
    if (this.blockLimitDownSell && limitDown) return rejection("开盘触及跌停，禁止卖出");
    const effectiveBps = amountAdjustedSlippageBps(cost.slippageBps, refAmount);
    const price = round(basePrice * (1 - effectiveBps / 10_000), 4);
    const slippageAmount = (basePrice - price) * order.quantity;
    return { symbol: order.symbol, side: "sell", quantity: order.quantity, price, basePrice, executedAt: bar.date, fees: 0, slippageAmount, amount: refAmount };
  }
}

/** 便捷构造：默认 next-open 执行模型（不拦截涨跌停）。 */
export function nextOpenExecutionModel(): ExecutionModel {
  return new NextOpenExecutionModel();
}

export type { Side };
