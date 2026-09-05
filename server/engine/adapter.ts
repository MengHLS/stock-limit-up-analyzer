/**
 * Backtest Core — Legacy Adapter（兼容层）。
 *
 * 职责：在既有 realisticBacktest / downsideRisk 与新 Backtest Core 之间建立桥接，
 * 使新 Core 的绩效分析、领域模型能被 Legacy 复用，而不破坏现有调用。
 *
 * 迁移策略（Legacy → Adapter → Core）：
 *   1. 本阶段：Legacy realisticBacktest 保持原样运行（其结果被前端/API/数据库消费，
 *      且被既有测试锁定）。本 Adapter 提供「绩效统一」与「类型映射」能力，
 *      供逐步迁移时复用，不强行替换 Legacy 内部逻辑。
 *   2. 后续 Step：将 realisticBacktest 的成交/退出状态机逐步替换为
 *      Portfolio + ExecutionModel，届时 Legacy 的绩效内联计算改调本 Core 的
 *      computePerformance，消除 maxDrawdown / winRate / profitFactor 的重复实现。
 */

import type { RealisticBacktestResult, RealisticEquityPoint, RealisticTrade } from "../realisticBacktest";
import type { EquityPoint, Trade } from "./domain";
import { computePerformance, type PerformanceInput } from "./performance";

/** 将 Legacy 权益点转换为 Core 权益点。 */
export function toCoreEquityPoint(point: RealisticEquityPoint): EquityPoint {
  return {
    timestamp: point.date,
    cash: point.cash,
    marketValue: point.equity - point.cash,
    equity: point.equity,
    openPositions: point.openPositions,
  };
}

/** 将 Legacy 交易转换为 Core 交易（仅映射共有语义；Legacy 独有字段不纳入）。 */
export function toCoreTrade(trade: RealisticTrade): Trade {
  return {
    symbol: trade.stockCode,
    entryTime: trade.entryDate ?? trade.signalDate,
    entryPrice: trade.entryPrice ?? 0,
    exitTime: trade.exitDate,
    exitPrice: trade.exitPrice,
    quantity: trade.shares,
    grossPnL: null,
    fees: trade.totalFees,
    slippageAmount: 0,
    netPnl: trade.netPnl,
    returnPct: trade.netReturn,
    holdingPeriod: null,
    openAtEnd: trade.status === "filled" && trade.netPnl === null,
    reason: trade.reason,
  };
}

/** 从 Legacy 回测结果提取 Core 绩效输入（用于统一绩效计算，消除重复实现）。 */
export function toCorePerformanceInput(result: RealisticBacktestResult): PerformanceInput {
  return {
    equityCurve: result.equityCurve.map(toCoreEquityPoint),
    trades: result.trades.map(toCoreTrade),
    initialCapital: result.initialCapital,
  };
}

/** 用统一 Core 绩效层为 Legacy 结果计算绩效（替代 scattered 的内联统计）。 */
export function computeLegacyPerformance(result: RealisticBacktestResult) {
  return computePerformance(toCorePerformanceInput(result));
}
