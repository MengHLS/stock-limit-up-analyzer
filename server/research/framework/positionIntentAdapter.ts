/**
 * STEP 11-FINAL-FIX — PositionIntent → Signal 适配层（接通 STEP 10 Research 与 STEP 8 Backtest）。
 *
 * 背景（STEP 11 WH 跨阶段审计 INT-1 / P0-2）：STEP 10 Research Framework 的产物止于
 * `PositionIntent`（候选 + 意图权重），与 STEP 8 Backtest Engine 的 `Signal → Order → Fill →
 * Portfolio` 执行链零连接。本模块提供唯一的「映射胶水」，把研究结论翻译为执行引擎可消费的
 * 信号；Order → Fill → Portfolio 由 STEP 8 引擎既有链路完成（见 server/backtest/engine.ts）。
 *
 * 铁律：
 *   - 纯函数、确定性：不碰 Date.now / Math.random / 网络 / 全局可变状态；
 *   - 不复制成交 / 持仓 / 会计逻辑（那是 STEP 8 引擎的职责）；
 *   - direction 忠实映射：long→buy、short→sell、neutral→跳过（无成交意图）。
 *     A 股 long-only 研究应只产出 long；short→sell 会因无持仓被 STEP 8 Portfolio 拒绝，
 *     这正是「禁止裸卖空」在引擎层的正确体现，本层不越权篡改方向。
 *   - weight → 数量 的换算由注入的 PositionSizer 负责（可复现，非隐式默认漂移）。
 */

import type { CanonicalMarketBar } from "../../data";
import type {
  ReadonlyPortfolioSnapshot,
  Side,
  Signal,
  SignalDataView,
  SignalGenerator,
} from "../../backtest";
import type { Direction, PositionIntent } from "./contract";

/** 方向 → 执行侧。neutral 返回 null（无成交意图，跳过）。 */
export function directionToSide(direction: Direction): Side | null {
  switch (direction) {
    case "long":
      return "buy";
    case "short":
      return "sell";
    case "neutral":
      return null;
  }
}

/** 仓位换算上下文：决策日总权益 + 该证券决策日收盘价 + 一手股数。 */
export interface PositionSizingContext {
  /** 决策日组合总权益（元）。 */
  equity: number;
  /** 该证券决策日可见收盘价（元）；未知（无 bar）时 null，无法下单。 */
  price: number | null;
  /** 一手股数（A 股默认 100）。 */
  lotSize: number;
}

/** 仓位换算器：意图权重 ∈ (0,1] → 目标股数（非负整数手）。 */
export type PositionSizer = (weight: number, context: PositionSizingContext) => number;

/**
 * 等权（权重 × 权益）仓位换算器：targetCash = equity × weight，按价格与整手下取整。
 * 权重非正 / 无价 / 权益非正 / 价格非正 → 0（跳过，不静默填 1）。
 */
export const equalWeightSizer: PositionSizer = (weight, context) => {
  const { equity, price, lotSize } = context;
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  if (!Number.isFinite(equity) || equity <= 0) return 0;
  if (price === null || !Number.isFinite(price) || price <= 0) return 0;
  const lot = Number.isFinite(lotSize) && lotSize > 0 ? Math.floor(lotSize) : 100;
  return Math.floor((equity * weight) / price / lot) * lot;
};

/**
 * 把单个 PositionIntent 翻译为 STEP 8 Signal（纯函数）。
 * 方向为 neutral、或换算数量 <= 0（无价/权重非法）时返回 null（跳过）。
 */
export function positionIntentToSignal(
  intent: PositionIntent,
  signalTime: string,
  sizer: PositionSizer,
  context: PositionSizingContext,
): Signal | null {
  const side = directionToSide(intent.direction);
  if (side === null) return null;
  const quantity = sizer(intent.weight, context);
  if (quantity <= 0) return null;
  return {
    securityId: intent.securityId,
    signalTime,
    side,
    quantity,
    score: intent.signalValue,
    reason: `rank#${intent.rank} weight=${(intent.weight * 100).toFixed(1)}% value=${intent.signalValue}`,
  };
}

/** 决策日可见收盘价解析器（供 weight→数量换算）。 */
export type PriceResolver = (securityId: string) => number | null;

/** 把一组 PositionIntent 翻译为 STEP 8 Signal[]（保持原顺序，确定性）。 */
export function positionIntentsToSignals(
  intents: readonly PositionIntent[],
  signalTime: string,
  sizer: PositionSizer,
  resolvePrice: PriceResolver,
  options: { lotSize?: number; equity?: number } = {},
): Signal[] {
  const lotSize = options.lotSize ?? 100;
  const equity = options.equity ?? 0;
  const signals: Signal[] = [];
  for (const intent of intents) {
    const signal = positionIntentToSignal(intent, signalTime, sizer, {
      equity,
      price: resolvePrice(intent.securityId),
      lotSize,
    });
    if (signal) signals.push(signal);
  }
  return signals;
}

/** 从 asOf 数据视图取某证券最后一根可见 bar 的收盘价（无则 null，禁止用未来 bar）。 */
function lastVisibleClose(data: SignalDataView, securityId: string): number | null {
  const bars: readonly CanonicalMarketBar[] | undefined = data.bars(securityId);
  if (!bars || bars.length === 0) return null;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const close = bars[i]!.close;
    if (close !== null && close !== undefined && Number.isFinite(close) && close > 0) {
      return close;
    }
  }
  return null;
}

/**
 * 研究意图解析器：在决策日产出 PositionIntent[]（可由 runResearchPipeline 的结果直接提供，
 * 也可由调用方逐日调用 runResearchPipeline 后抽取 result.positionIntents）。
 */
export type ResearchIntentResolver = (
  date: string,
  portfolio: ReadonlyPortfolioSnapshot,
  data: SignalDataView,
) => readonly PositionIntent[];

/**
 * 构造 STEP 8 SignalGenerator：在决策日先由 resolver 产出 PositionIntent[]，
 * 再按注入的 sizer 换算为 Signal[]。这是把 STEP 10 研究结论喂给 STEP 8 引擎的入口。
 * Order → Fill → Portfolio 由 runBacktestEngine2 引擎既有链路完成。
 */
export function positionIntentSignalGenerator(
  resolveIntents: ResearchIntentResolver,
  sizer: PositionSizer = equalWeightSizer,
  options: { lotSize?: number } = {},
): SignalGenerator {
  const lotSize = options.lotSize ?? 100;
  return (date, portfolio, data) => {
    const intents = resolveIntents(date, portfolio, data);
    return positionIntentsToSignals(
      intents,
      date,
      sizer,
      (securityId) => lastVisibleClose(data, securityId),
      { lotSize, equity: portfolio.equity },
    );
  };
}
