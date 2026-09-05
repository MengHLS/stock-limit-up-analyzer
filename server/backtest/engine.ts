/**
 * STEP 8 — Backtest Engine 2.0（事件驱动编排）。
 *
 * 数据流：Data → Universe → Signal → Order → Execution → Position → Portfolio
 *         → PnL → Cost → Risk → Metrics → Audit。
 *
 * 关键不变量：
 *   - 确定性：核心不使用 Date.now / Math.random / 网络 / 全局可变状态；runId 由规范确定性派生。
 *   - 未来函数防护（T+1）：
 *       1. 策略在 T 日收盘后产生信号（signalGenerator 只读取 <= T 的 asOf 数据视图）；
 *       2. 信号规范化为 Order，executionTime = 下一交易日（T+1）；
 *       3. 成交在 T+1 发生（NEXT_OPEN 只读 T+1 开盘价与前收，不读当日 close/high/low）；
 *       4. 同一 close 生成信号、同一 close 成交在结构上不可能发生。
 *   - 内存安全：逐日拉取 barsForDate（一个 chunk），按需逐标的加载 seriesFor；
 *     引擎不持有 Map<date, Map<symbol, bar>> 全量对象。
 */

import type { CanonicalMarketBar } from "../data/types";
import { buildNextTradingDayMap } from "../security/tradingCalendar";
import { createSignalDataView, indexBarsBySymbol, type HistoricalBarStore } from "./dataSource";
import { createExecutionModel } from "./execution";
import { computeTradeCost, slippageAmount } from "./cost";
import { DEFAULT_EXECUTION_RULES, DEFAULT_MARKET_RULES, resolveExecutionRuleContext } from "./marketRules";
import { computeMetrics } from "./metrics";
import { AuditLog, fillAuditEntry } from "./audit";
import { Portfolio, type FillResult } from "./portfolio";
import { deriveRunId } from "./result";
import type {
  BacktestEngineConfig,
  BacktestResult,
  BacktestSpec,
  CorporateActionMode,
  CostSummary,
  ExecutionStats,
  Fill,
  Order,
  ReadonlyPortfolioSnapshot,
  Security,
  TradeCost,
} from "./types";

const extractClosePrices = (bars: readonly CanonicalMarketBar[]): Map<string, number> => {
  const prices = new Map<string, number>();
  for (const bar of bars) {
    if (bar.close !== null && bar.close !== undefined && Number.isFinite(bar.close) && bar.close > 0) {
      prices.set(bar.symbol, bar.close);
    }
  }
  return prices;
};

/** 从历史序列取指定日期 bar（历史序列升序；研究/测试规模下线性查找即可）。 */
const barAt = (series: readonly CanonicalMarketBar[], date: string): CanonicalMarketBar | undefined =>
  series.find((bar) => bar.timestamp === date);

export async function runBacktestEngine2(store: HistoricalBarStore, spec: BacktestSpec): Promise<BacktestResult> {
  const runId = deriveRunId(spec);
  const cost = structuredClone(spec.cost);
  const marketRules = spec.marketRules ?? DEFAULT_MARKET_RULES;
  const executionRules = spec.executionRules ?? DEFAULT_EXECUTION_RULES;
  const executionModel = typeof spec.executionModel === "string" ? createExecutionModel(spec.executionModel) : spec.executionModel;
  const maxPositions = spec.maxPositions ?? 5;
  const maxPositionAmountRatio = spec.maxPositionAmountRatio ?? 0;
  const allowPartialFill = spec.allowPartialFill ?? false;
  const seed = spec.seed ?? 0;
  const corporateActionMode: CorporateActionMode = store.corporateActionMode;
  const universe: readonly Security[] = spec.universe.securities;
  const corporateActionResolver = spec.corporateActionResolver;

  // 1. 交易日历（[start, end]）。
  const tradingDates = await store.tradingDates(spec.startDate, spec.endDate);
  const nextDay = buildNextTradingDayMap(tradingDates);

  // 2. 按需加载 universe 每标的完整历史（内存上界 = universe 大小 × 单标的序列）。
  const history = new Map<string, readonly CanonicalMarketBar[]>();
  for (const security of universe) {
    const series = await store.seriesFor(security.securityId);
    history.set(security.securityId, series.filter((bar) => bar.timestamp <= spec.endDate));
  }

  const securityById = new Map<string, Security>(universe.map((security) => [security.securityId, security]));
  const portfolio = new Portfolio(spec.initialCapital, tradingDates, { maxPositions, maxPositionAmountRatio });
  const audit = new AuditLog();

  // 待成交订单（executionTime = 下一交易日）。
  const pending = new Map<string, Order>();
  let orderSeq = 0;
  let fillSeq = 0;
  let totalSignals = 0;

  // 成本/执行统计累加器。
  const costSummary: CostSummary = {
    buyCommission: 0, sellCommission: 0, stampDuty: 0, transferFee: 0, slippage: 0, otherFees: 0, totalFees: 0, totalCost: 0,
  };
  const stats: ExecutionStats = {
    totalSignals: 0, totalOrders: 0, totalFills: 0, rejectedOrders: 0, partialFills: 0, byReason: {},
  };

  const accumulateCost = (side: "buy" | "sell", tradeCost: TradeCost, slippage: number): void => {
    if (side === "buy") costSummary.buyCommission += tradeCost.commission;
    else costSummary.sellCommission += tradeCost.commission;
    costSummary.stampDuty += tradeCost.stampDuty;
    costSummary.transferFee += tradeCost.transferFee;
    costSummary.otherFees += tradeCost.otherFees;
    costSummary.slippage += slippage;
    costSummary.totalFees += tradeCost.total;
    costSummary.totalCost += tradeCost.total + slippage;
  };

  const equityCurve: BacktestResult["equityCurve"] = [];
  let lastClosePrices: Map<string, number> = new Map();

  // 3. 事件驱动主循环：逐交易日推进。
  for (const date of tradingDates) {
    // (a) T+1 结算：前一日冻结份额转为可卖。
    portfolio.settle();

    // (a2) 公司行为：对持仓证券应用当日生效的送/转/配/拆/合/分红（份额/成本基/现金）。
    if (corporateActionResolver) {
      for (const securityId of portfolio.openPositionSymbols()) {
        const actions = corporateActionResolver.actionsFor(securityId, date);
        if (actions.length > 0) portfolio.applyCorporateAction(securityId, actions);
      }
    }

    // (b) 拉取当日 bar（一个 chunk），并建立 symbol 索引。
    const todayBars = await store.barsForDate(date);
    const todayIndex = indexBarsBySymbol(todayBars);

    // (c) 处理 executionTime == date 的待成交订单。
    for (const order of Array.from(pending.values())) {
      if (order.executionTime !== date) continue;
      pending.delete(order.orderId);

      const security = securityById.get(order.securityId);
      const bar = todayIndex.get(order.securityId);
      const suspended = spec.suspensionResolver?.isSuspended(order.securityId, date) ?? false;

      if (!bar || suspended) {
        stats.rejectedOrders += 1;
        const reason: "SUSPENDED" = "SUSPENDED";
        stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
        order.status = "REJECTED";
        order.rejectionReason = reason;
        audit.recordOrder({
          orderId: order.orderId, securityId: order.securityId, tradeDate: order.tradeDate, side: order.side,
          requestedQuantity: order.quantity, filledQuantity: 0, status: "REJECTED", rejectionReason: reason,
          explanation: suspended ? "停牌，无法成交" : "当日无行情数据，视为停牌，无法成交",
        });
        continue;
      }

      const ruleContext = resolveExecutionRuleContext(
        security ?? { securityId: order.securityId },
        marketRules,
        executionRules,
      );

      // 参考成交额：信号日（tradeDate）成交额——成交时点前已可知，避免未来函数。
      const signalSeries = history.get(order.securityId);
      const signalBar = signalSeries ? barAt(signalSeries, order.tradeDate) : undefined;
      const referenceAmount = signalBar?.amount ?? null;

      const quote = executionModel.quote(order, bar, ruleContext, cost, referenceAmount);

      if (quote.kind === "rejected") {
        stats.rejectedOrders += 1;
        const reason = quote.rejectionReason ?? "OTHER";
        stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
        order.status = "REJECTED";
        order.rejectionReason = reason;
        audit.recordOrder({
          orderId: order.orderId, securityId: order.securityId, tradeDate: order.tradeDate, side: order.side,
          requestedQuantity: order.quantity, filledQuantity: 0, status: "REJECTED", rejectionReason: reason,
          explanation: `执行模型拒绝：${reason}`,
        });
        continue;
      }

      const basePrice = quote.basePrice!;
      const price = quote.price!;
      const tentativeFill: Fill = {
        fillId: `FILL-${fillSeq}`,
        orderId: order.orderId,
        securityId: order.securityId,
        side: order.side,
        quantity: order.quantity,
        price,
        basePrice,
        timestamp: date,
        cost: { commission: 0, stampDuty: 0, transferFee: 0, otherFees: 0, total: 0 },
        slippageAmount: 0,
        referenceAmount,
      };

      const result: FillResult = order.side === "buy"
        ? portfolio.buy(tentativeFill, cost, allowPartialFill)
        : portfolio.sell(tentativeFill, cost, allowPartialFill);

      if (!result.success) {
        stats.rejectedOrders += 1;
        const reason = result.rejectionReason ?? "OTHER";
        stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
        order.status = "REJECTED";
        order.rejectionReason = reason;
        audit.recordOrder({
          orderId: order.orderId, securityId: order.securityId, tradeDate: order.tradeDate, side: order.side,
          requestedQuantity: order.quantity, filledQuantity: 0, status: "REJECTED", rejectionReason: reason,
          explanation: result.reason,
        });
        continue;
      }

      const filledQuantity = result.filledQuantity;
      order.filledQuantity = filledQuantity;
      order.averageFillPrice = price;
      order.status = result.status;
      if (result.status === "PARTIALLY_FILLED") {
        order.rejectionReason = "OTHER"; // 剩余未成交部分作废
        stats.partialFills += 1;
      }

      const gross = price * filledQuantity;
      const tradeCost = computeTradeCost(order.side, gross, cost);
      const slippage = slippageAmount(price, basePrice, filledQuantity);
      stats.totalFills += 1;
      accumulateCost(order.side, tradeCost, slippage);

      audit.recordFill(fillAuditEntry(
        `FILL-${fillSeq}`, order.orderId, order.securityId, order.side, filledQuantity,
        price, basePrice, date, slippage, tradeCost,
      ));
      fillSeq += 1;

      audit.recordOrder({
        orderId: order.orderId, securityId: order.securityId, tradeDate: order.tradeDate, side: order.side,
        requestedQuantity: order.quantity, filledQuantity, status: order.status,
        rejectionReason: order.rejectionReason,
        explanation: order.side === "buy"
          ? `买入成交 ${filledQuantity} 股 @ ${price}`
          : `卖出成交 ${filledQuantity} 股 @ ${price}`,
      });

      const afterQuantity = portfolio.quantity(order.securityId);
      const beforeQuantity = order.side === "buy" ? afterQuantity - filledQuantity : afterQuantity + filledQuantity;
      audit.recordPosition({
        securityId: order.securityId,
        timestamp: date,
        event: order.side === "buy" ? "open" : (afterQuantity === 0 ? "close" : "decrease"),
        beforeQuantity,
        afterQuantity,
        availableQuantity: portfolio.available(order.securityId),
        frozenQuantity: afterQuantity - portfolio.available(order.securityId),
        explanation: order.side === "buy" ? "买入增加持仓" : "卖出减少持仓",
      });
    }

    // (d) 收盘后生成信号（下一交易日成交）。
    const closePrices = extractClosePrices(todayBars);
    const dataView = createSignalDataView(date, universe, history, "close");
    const snapshot: ReadonlyPortfolioSnapshot = {
      cash: portfolio.cash,
      equity: portfolio.markToMarket(closePrices),
      openPositionCount: portfolio.openPositionCount,
      openPositionSymbols: portfolio.openPositionSymbols(),
    };
    const signals = spec.signalGenerator(date, snapshot, dataView);
    for (const signal of signals) {
      totalSignals += 1;
      const executionTime = nextDay.get(date);
      if (!executionTime) continue; // 最后一日无下一交易日，不生成可成交订单
      orderSeq += 1;
      const order: Order = {
        orderId: `ORD-${orderSeq}`,
        securityId: signal.securityId,
        tradeDate: signal.signalTime,
        side: signal.side,
        quantity: signal.quantity,
        orderType: signal.limitPrice !== undefined ? "limit" : "market",
        requestedPrice: signal.limitPrice ?? null,
        status: "SUBMITTED",
        executionTime,
        filledQuantity: 0,
        averageFillPrice: null,
        rejectionReason: null,
        signal,
        createdAt: "deterministic",
      };
      pending.set(order.orderId, order);
      audit.recordOrder({
        orderId: order.orderId, securityId: order.securityId, tradeDate: order.tradeDate, side: order.side,
        requestedQuantity: order.quantity, filledQuantity: 0, status: "SUBMITTED", rejectionReason: null,
        explanation: signal.reason ?? (signal.side === "buy" ? "信号买入" : "信号卖出"),
      });
    }

    // (e) 收盘后记录权益点。
    lastClosePrices = closePrices;
    equityCurve.push(portfolio.equityPoint(date, closePrices));
  }

  stats.totalSignals = totalSignals;
  stats.totalOrders = orderSeq;

  // 4. 期末：估值未平仓交易。
  portfolio.finalizeOpenTrades(lastClosePrices);
  const finalState = portfolio.portfolioState(lastClosePrices);
  const trades = portfolio.allTrades();
  const metrics = computeMetrics({ equityCurve, trades, initialCapital: spec.initialCapital });

  const config: BacktestEngineConfig = {
    strategyId: spec.strategyId,
    strategyVersion: spec.strategyVersion,
    initialCapital: spec.initialCapital,
    startDate: spec.startDate,
    endDate: spec.endDate,
    cost,
    executionModel: executionModel.id,
    corporateActionMode,
    maxPositions,
    maxPositionAmountRatio,
    seed,
    allowPartialFill,
    rules: {
      tPlus1: marketRules.tPlus1,
      blockLimitUpBuy: executionRules.blockLimitUpBuy,
      blockLimitDownSell: executionRules.blockLimitDownSell,
    },
  };

  return {
    runId,
    strategyId: spec.strategyId,
    strategyVersion: spec.strategyVersion,
    datasetVersion: spec.datasetVersion,
    startDate: spec.startDate,
    endDate: spec.endDate,
    initialCapital: spec.initialCapital,
    finalEquity: finalState.equity,
    config,
    trades,
    equityCurve,
    positions: finalState.positions,
    metrics,
    costs: costSummary,
    executionStats: stats,
    audit: audit.snapshot(),
  };
}
