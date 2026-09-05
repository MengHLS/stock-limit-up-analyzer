/**
 * Backtest Core — Engine（回测引擎编排）。
 *
 * 职责：把 Historical Data → Signal → Order → Fill → Position → Portfolio → Equity → Performance
 * 串成确定性的事件驱动循环。
 *
 * 未来函数防护（T+1 规则）：
 *  - 信号在 T 日收盘后产生（signalProvider 只接收 date，只能使用 <= date 的信息）。
 *  - 信号规范化为 Order，executionTime = 下一交易日（T+1）。
 *  - 成交在 T+1 开盘（ExecutionModel 只读取当日 bar 的 open 与 prevClose，不读 close/high/low）。
 *  - 权益点只在当日收盘后记录。
 *
 * 确定性：不使用 Date.now() / Math.random() / 网络 / 全局状态。
 * 每次调用 runBacktest 都创建独立 Portfolio，连续回测互不污染。
 */

import type { BacktestConfig, BacktestResult, MarketBar, ReadonlyPortfolioSnapshot, Signal } from "./domain";
import { nextOpenExecutionModel, type ExecutionModel } from "./execution";
import { computePerformance } from "./performance";
import { Portfolio } from "./portfolio";
import { buildRiskContext, buildDefaultRiskManager, type OrderIntent, type PositionSizer, type RiskDecisionTrace, type RiskManager } from "../risk";

export interface RunBacktestInput {
  config: BacktestConfig;
  /** 交易日历（升序）。引擎只处理 [startDate, endDate] 内的交易日。 */
  tradingDates: string[];
  /** date → symbol → MarketBar 的历史行情。 */
  barsByDate: Map<string, Map<string, MarketBar>>;
  /** 成交模型；缺省使用 next-open。 */
  execution?: ExecutionModel;
  /** 策略：给定信号日（收盘后），返回该日产生的信号。只允许使用 <= date 的信息。
   *  第二个参数为该信号日收盘后的只读组合快照（供 Strategy 层读取，不暴露可变 API）。 */
  signalProvider: (date: string, portfolio: ReadonlyPortfolioSnapshot) => Signal[];
  /**
   * 可选风险决策管道：Signal → PositionSizer → RiskManager → Approved Order Intent。
   * 传入后，engine 对每个 BUY 信号先做风险裁决（REJECT 跳过 / RESIZE 用批准数量），
   * 并记录 RiskDecisionTrace。缺省时走 Portfolio 会计兜底，行为与 Step 2 完全一致。
   */
  risk?: {
    /** 仓位模型（可选）；缺省直接用 signal.quantity 作为提议数量。 */
    sizer?: PositionSizer;
    /** 风险决策组合器（必填）。 */
    manager: RiskManager;
  };
}

/** 从当日 bars 提取 symbol → 收盘价（用于 mark-to-market 估值）。 */
function extractClosePrices(bars: Map<string, MarketBar>): Map<string, number> {
  const prices = new Map<string, number>();
  for (const [symbol, bar] of Array.from(bars.entries())) {
    if (bar.close !== null && bar.close !== undefined && Number.isFinite(bar.close) && bar.close > 0) {
      prices.set(symbol, bar.close);
    }
  }
  return prices;
}

/** 确定性回测引擎。 */
export function runBacktest(input: RunBacktestInput): BacktestResult {
  const { config, barsByDate } = input;
  const execution = input.execution ?? nextOpenExecutionModel();
  const dates = input.tradingDates.filter((date) => date >= config.startDate && date <= config.endDate);

  const portfolio = new Portfolio(config.initialCapital, dates, {
    maxPositions: config.maxPositions,
    maxPositionAmountRatio: config.maxPositionAmountRatio,
  });
  const equityCurve: BacktestResult["equityCurve"] = [];
  // 待下一交易日成交的信号队列。
  let pendingSignals: Signal[] = [];
  // 风险决策追踪（仅当传入 risk 管道时记录）。
  const riskTraces: RiskDecisionTrace[] = [];
  const riskManager = input.risk?.manager;

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i]!;
    const bars = barsByDate.get(date) ?? new Map<string, MarketBar>();

    // 1. 处理上一交易日收盘后产生的信号，在本日开盘成交（T+1）。
    for (const signal of pendingSignals) {
      const bar = bars.get(signal.symbol);
      if (!bar) continue; // 数据缺失：无法成交，信号作废
      // 未来函数防护：滑点分层使用「信号日（signalTime）成交额」作为参考成交额，
      // 而非本成交日（date）的全天成交额（后者在开盘时点尚不可知）。
      const referenceAmount = barsByDate.get(signal.signalTime)?.get(signal.symbol)?.amount ?? null;

      // 风险决策管道（可选）：先裁决，再决定是否/以多少数量成交。
      let orderQuantity = signal.quantity;
      if (riskManager && signal.side === "buy") {
        // 无副作用地估算当前组合权益：现金 + 持仓按当日开盘价估值（成交时点已知，无未来函数）。
        const openPrices = new Map<string, number>();
        for (const [sym, b] of Array.from(bars.entries())) {
          if (b.open !== null && b.open !== undefined && Number.isFinite(b.open) && b.open > 0) openPrices.set(sym, b.open);
        }
        const context = buildRiskContext({
          timestamp: date,
          equity: portfolio.equityAt(openPrices),
          cash: portfolio.cash,
          availableCash: portfolio.cash,
          positions: portfolio.snapshotPositionsAt(openPrices).map((p) => ({ symbol: p.symbol, quantity: p.quantity, marketValue: p.marketValue })),
          symbol: signal.symbol,
          marketPrice: bar.open,
          referenceAmount,
          cost: config.cost,
        });
        const intent: OrderIntent = {
          symbol: signal.symbol,
          side: signal.side,
          requestedQuantity: signal.quantity,
          signalTime: signal.signalTime,
          score: signal.score,
          reason: signal.reason,
        };
        const proposed = input.risk!.sizer ? input.risk!.sizer.propose(intent, context) : signal.quantity;
        const decision = riskManager.check({ ...intent, requestedQuantity: proposed }, context);
        riskTraces.push({
          symbol: signal.symbol,
          signalTime: signal.signalTime,
          requestedQuantity: signal.quantity,
          proposedQuantity: proposed,
          decision: decision.kind,
          approvedQuantity: decision.approvedQuantity,
          violations: decision.violations.map((v) => ({ code: v.code, message: v.message, policy: v.policy })),
        });
        if (decision.kind === "REJECT") continue;
        orderQuantity = decision.approvedQuantity;
      }

      const fill = execution.execute(
        { symbol: signal.symbol, side: signal.side, quantity: orderQuantity, executionTime: date, orderType: "market", signal },
        bar,
        config.cost,
        referenceAmount,
      );
      if (fill.rejectionReason) continue; // 涨跌停/数据缺失导致的拒绝
      if (fill.side === "buy") portfolio.buy(fill, config.cost);
      else portfolio.sell(fill, config.cost);
    }
    pendingSignals = [];

    // 2. 当日收盘后产生新信号（下一交易日成交）。
    const closePrices = extractClosePrices(bars);
    const snapshot: ReadonlyPortfolioSnapshot = {
      cash: portfolio.cash,
      equity: portfolio.equityAt(closePrices),
      openPositionCount: portfolio.openPositionCount,
      openPositionSymbols: portfolio.snapshotPositions().map((p) => p.symbol),
    };
    pendingSignals = input.signalProvider(date, snapshot);

    // 3. 当日收盘后记录权益点。
    equityCurve.push(portfolio.equityPoint(date, closePrices));
  }

  // 期末：估值未平仓交易，生成最终组合与绩效。
  const finalPrices = extractClosePrices(barsByDate.get(dates.at(-1) ?? "") ?? new Map());
  portfolio.finalizeOpenTrades(finalPrices);
  const finalEquity = portfolio.markToMarket(finalPrices);
  const finalPositions = portfolio.snapshotPositions();
  const trades = portfolio.allTrades();

  const performance = computePerformance({ equityCurve, trades, initialCapital: config.initialCapital });

  const result: BacktestResult = {
    metadata: {
      strategyId: config.strategyId,
      strategyVersion: config.strategyVersion,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      generatedAt: "deterministic",
    },
    config,
    trades,
    equityCurve,
    finalPortfolio: {
      cash: portfolio.cash,
      marketValue: finalEquity - portfolio.cash,
      equity: finalEquity,
      positions: finalPositions,
    },
    performance,
  };

  // 风险决策追踪（可选）：挂到返回结果上，供回测报告回答「为什么这笔交易最终只有 N 股」。
  if (riskManager) {
    (result as BacktestResult & { riskDecisions?: RiskDecisionTrace[] }).riskDecisions = riskTraces;
  }
  return result;
}

/**
 * 统一回测入口：强制经过 Risk Layer。
 * 缺省用 buildDefaultRiskManager(config) 注入与 BacktestConfig 对齐的 RiskManager，
 * 保证「Strategy → PositionSizer → RiskManager → Approved Order Intent」链路必然成立、风险控制统一。
 * 若调用方确需 Step 2 裸引擎行为（无 Risk Layer），请直接使用 runBacktest 并显式省略 risk。
 */
export function runBacktestWithRisk(
  input: Omit<RunBacktestInput, "risk"> & { risk?: { sizer?: PositionSizer; manager?: RiskManager } },
): BacktestResult {
  const manager = input.risk?.manager ?? buildDefaultRiskManager(input.config);
  return runBacktest({ ...input, risk: { sizer: input.risk?.sizer, manager } });
}
