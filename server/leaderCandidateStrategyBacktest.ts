/**
 * Leader Candidate —— 正式生产回测服务（Step 5 FIX-2 RA-001 / RA-002 核心）。
 *
 * 职责：把「龙头候选历史回测」这一正式生产入口（routers → db.getLeaderCandidateBacktest）
 * 真正接入 Step 2/3/4 审计通过的 Strategy Engine 新链路，并让生产策略显式启用 Feature：
 *
 *   Production Entry (db.getLeaderCandidateBacktest)
 *     → runLeaderCandidateStrategyBacktest（本文件，production service）
 *       → runStrategyEngineBacktest
 *         → toCanonicalBar / validateMarketBar（Canonical + Validation）
 *         → runFeaturePipeline（asOf 过滤）
 *         → FeatureSnapshotBundle
 *         → buildStrategySignalProvider({ buildFeatures })
 *           → leader-candidate-baseline（featureMode = "limit-up-confirm"，真实消费 context.features）
 *         → PositionSizer → RiskManager → Approved Order Intent → runBacktestWithRisk
 *       → Engine Result Adapter → RealisticBacktestResult（既有 API response 形状）
 *     → buildLeaderCandidateBacktest(runtime.realisticSimulationOverride)（研究报表保持兼容）
 *
 * 约束遵守：
 *   - 本文件为纯函数、确定性、无 IO、无 Date.now / Math.random；
 *   - 不修改既有 Risk / Position Sizing / Backtest Core 语义；
 *   - 不删除 legacy realisticBacktest（研究出口 research/legacyTransactionSimulator 仍保留其用途）；
 *   - 生产模拟结果由新引擎产出（Feature → Strategy → Sizer → Risk → Core），
 *     不重新走 legacy 交易模拟器（其唯一合法出口为研究路径 legacyTransactionSimulator）。
 */

import { runStrategyEngineBacktest, DEFAULT_PRODUCTION_FEATURES, type StrategyEngineBacktestProbe } from "./strategy/strategyBacktest";
import type { LeaderCandidateBaselineConfig } from "./strategy/strategies/leaderCandidateBaseline";
import type { StrategyConfig } from "./strategy/contract";
import type { RawDailyPriceRow } from "./data";
import { buildLeaderCandidateBacktest, type LeaderCandidateBacktestContext, type LeaderCandidateBacktestOptions, type LeaderCandidateBacktestResult, type LeaderCandidateDailyPrice, type LeaderCandidateSourceRecord } from "./leaderCandidates";
import type {
  RealisticBacktestOptions,
  RealisticBacktestResult,
  RealisticEquityPoint,
  RealisticTrade,
  PositionSizingStrategy,
  ExitStrategy,
} from "./realisticBacktest";
import type { Trade } from "./engine/domain";

// ---------------------------------------------------------------------------
// 生产配置（显式、可追踪、确定性）
// ---------------------------------------------------------------------------

/** 生产策略 Feature 消费模式：候选必须被价格库快照确认「信号日收盘涨停」才纳入。 */
export const LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE = "limit-up-confirm" as const;

/** 生产策略每信号日最多输出的买入意图数量。 */
export const LEADER_CANDIDATE_PRODUCTION_MAX_SIGNALS = 5 as const;

/** 生产策略 id（registry 注册的真实策略）。 */
export const LEADER_CANDIDATE_PRODUCTION_STRATEGY_ID = "leader-candidate-baseline" as const;

/** 每次 BUY 意图桥接为 Core Signal 的名义数量（股）；最终数量由 PositionSizer/Risk/Cash 裁定。 */
export const LEADER_CANDIDATE_PRODUCTION_REQUESTED_QUANTITY = 100 as const;

/** 生产特征集：覆盖 SMA / Return / AvgAmount / Volatility / LimitUp 等已审计特征。 */
export const LEADER_CANDIDATE_PRODUCTION_FEATURES = DEFAULT_PRODUCTION_FEATURES;

/**
 * 生产策略配置。minScore 跟随回测参数显式传入（null=不过滤），
 * featureMode 固定为 "limit-up-confirm"（Feature 必须真实参与 Decision）。
 */
export function buildProductionLeaderCandidateStrategyConfig(options: LeaderCandidateBacktestOptions = {}): LeaderCandidateBaselineConfig {
  const minScore = typeof options.minScore === "number" && Number.isFinite(options.minScore) ? options.minScore : null;
  return {
    minScore,
    maxSignals: LEADER_CANDIDATE_PRODUCTION_MAX_SIGNALS,
    featureMode: LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE,
  };
}

// ---------------------------------------------------------------------------
// legacy 默认值解析（仅用于在 RealisticBacktestResult.assumptions 中回显输入口径，
// 与实际执行语义由新引擎决定——引擎的 cost/sizing/risk 才真正生效）
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveAssumptionDefaults(options: RealisticBacktestOptions = {}) {
  return {
    initialCapital: options.initialCapital ?? 100_000,
    maxPositions: Math.max(1, Math.floor(options.maxPositions ?? 5)),
    commissionRate: options.commissionRate ?? 0.0003,
    stampDutyRate: options.stampDutyRate ?? 0.0005,
    transferFeeRate: options.transferFeeRate ?? 0.00001,
    slippageBps: options.slippageBps ?? 10,
    lotSize: Math.max(1, Math.floor(options.lotSize ?? 100)),
    blockLimitUpBuys: options.blockLimitUpBuys ?? false,
    blockLimitDownSells: options.blockLimitDownSells ?? false,
    enableOneWordLimitDownProbability: options.enableOneWordLimitDownProbability ?? false,
    oneWordLimitDownSellProbability: clamp(options.oneWordLimitDownSellProbability ?? 0, 0, 100),
    positionSizingStrategy: (options.positionSizingStrategy ?? "equal") as PositionSizingStrategy,
    fixedPositionPercent: clamp(options.fixedPositionPercent ?? 20, 1, 100),
    exitStrategy: "riskManagedHold" as ExitStrategy,
    trailingProfitActivationPercent: clamp(options.trailingProfitActivationPercent ?? 6, 0, 100),
    trailingDrawdownPercent: clamp(options.trailingDrawdownPercent ?? 3, 0, 100),
    stopLossPercent: clamp(options.stopLossPercent ?? 5, 0, 100),
    strongHoldMinReturn: clamp(options.strongHoldMinReturn ?? 3, 0, 100),
    maxHoldingDays: Math.max(2, Math.floor(options.maxHoldingDays ?? 5)),
    minimumExpectedOpenChangePercent: clamp(options.minimumExpectedOpenChangePercent ?? -2, -50, 100),
    expectationTierEnabled: options.expectationTierEnabled ?? false,
    blockOneWordLimitUpBuys: options.blockOneWordLimitUpBuys ?? false,
    enableIntradayStopLoss: options.enableIntradayStopLoss ?? false,
    maxPositionAmountRatio: Math.max(0, options.maxPositionAmountRatio ?? 0),
    detectExRights: options.detectExRights ?? false,
  };
}

// ---------------------------------------------------------------------------
// 引擎调用 + Result Adapter（Strategy Engine Result → 既有 API Response）
// ---------------------------------------------------------------------------

const round2 = (value: number | null | undefined, digits = 2): number | null => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
};

/** 取记录池中每只股票最新名称（用于回显交易表）。 */
function latestStockNameByCode(records: readonly LeaderCandidateSourceRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of records) {
    if (record.stockCode && record.stockName) map.set(record.stockCode, record.stockName);
  }
  return map;
}

/** 找出该 symbol 在 entryTime 之前最新的一次 BUY 意图（用于回显 signalDate/score/reason）。 */
function findBuyIntentBefore(logs: StrategyEngineBacktestProbe["decisionLog"], symbol: string, entryTime: string): StrategyEngineBacktestProbe["decisionLog"][number] | undefined {
  let best: StrategyEngineBacktestProbe["decisionLog"][number] | undefined;
  for (const log of logs) {
    if (log.symbol !== symbol || log.action !== "BUY" || log.signalTime >= entryTime) continue;
    if (!best || log.signalTime > best.signalTime) best = log;
  }
  return best;
}

/** 把引擎成交 Trade 映射为 legacy RealisticTrade 形状（仅填充存在的事实，不虚构 legacy 特有统计）。 */
function toRealisticTrade(
  trade: Trade,
  stockName: string,
  intent: StrategyEngineBacktestProbe["decisionLog"][number] | undefined,
  signalDayClose: number | null,
): RealisticTrade {
  const closed = !trade.openAtEnd && trade.exitTime !== null && trade.netPnl !== null;
  const entryPointPremium = signalDayClose !== null && Number.isFinite(signalDayClose) && signalDayClose > 0 && trade.entryPrice > 0
    ? round2((trade.entryPrice / signalDayClose - 1) * 100)
    : null;
  return {
    signalDate: intent?.signalTime ?? trade.entryTime,
    entryDate: trade.entryTime,
    exitDate: closed ? trade.exitTime : null,
    stockCode: trade.symbol,
    stockName,
    score: intent?.score ?? 0,
    shares: trade.quantity,
    entryPrice: round2(trade.entryPrice, 3),
    exitPrice: closed && trade.exitPrice !== null ? round2(trade.exitPrice, 3) : null,
    totalFees: round2(trade.fees, 2) ?? 0,
    netPnl: closed ? round2(trade.netPnl, 2) : null,
    netReturn: closed ? round2(trade.returnPct) : null,
    pnlToEquityRatio: null,
    openExpectationTier: null,
    openExpectationBucket: null,
    entryPointPremium,
    entryDayChange: entryPointPremium,
    exRights: false,
    status: "filled",
    reason: closed ? (trade.reason ?? null) : null,
  };
}

/** 信号日收盘价（priceByStockDate，key `stockCode::date`）。仅用于回显买点涨幅。 */
function signalDayClosePrice(
  priceByStockDate: ReadonlyMap<string, LeaderCandidateDailyPrice> | undefined,
  symbol: string,
  signalDate: string,
): number | null {
  const close = priceByStockDate?.get(`${symbol}::${signalDate}`)?.closePrice;
  return close !== undefined && close !== null && Number.isFinite(close) && close > 0 ? close : null;
}

/**
 * 运行生产引擎回测并把引擎结果适配为 legacy RealisticBacktestResult 形状。
 * 导出本函数以便生产集成测试直接观测引擎探针（featureDates/confirmedSymbols/decisionLog），
 * 同时保证与 runLeaderCandidateStrategyBacktest 使用完全相同的生产组装代码路径。
 */
export function runLeaderCandidateEngineProbe(
  records: readonly LeaderCandidateSourceRecord[],
  rawRows: ReadonlyArray<RawDailyPriceRow>,
  context: LeaderCandidateBacktestContext,
  options: LeaderCandidateBacktestOptions = {},
): { probe: StrategyEngineBacktestProbe; realisticSimulation: RealisticBacktestResult } {
  const realistic = options.realistic ?? {};
  const assumptions = resolveAssumptionDefaults(realistic);
  const strategyConfig: StrategyConfig = buildProductionLeaderCandidateStrategyConfig(options);
  const contextDates = context.tradingDates ?? [];
  const calendar = contextDates.length > 0 ? Array.from(contextDates) : undefined;

  const probe = runStrategyEngineBacktest({
    records,
    rawRows,
    options: {
      strategyId: LEADER_CANDIDATE_PRODUCTION_STRATEGY_ID,
      strategyConfig,
      decisionPoint: "close",
      features: LEADER_CANDIDATE_PRODUCTION_FEATURES,
      requestedQuantity: LEADER_CANDIDATE_PRODUCTION_REQUESTED_QUANTITY,
      initialCapital: assumptions.initialCapital,
      maxPositions: assumptions.maxPositions,
      maxPositionAmountRatio: assumptions.maxPositionAmountRatio,
      tradingDates: calendar,
      cost: {
        commissionRate: assumptions.commissionRate,
        stampDutyRate: assumptions.stampDutyRate,
        transferFeeRate: assumptions.transferFeeRate,
        slippageBps: assumptions.slippageBps,
        lotSize: assumptions.lotSize,
        minCommission: 5,
      },
    },
  });

  const realisticSimulation = adaptEngineResultToRealisticBacktestResult(probe, assumptions, records, context.priceByStockDate);
  return { probe, realisticSimulation };
}

/**
 * Engine Result → RealisticBacktestResult Adapter。
 * 只做「字段映射 / 口径换算」，绝不重新调用 legacy realisticBacktest 执行逻辑。
 */
function adaptEngineResultToRealisticBacktestResult(
  probe: StrategyEngineBacktestProbe,
  assumptions: ReturnType<typeof resolveAssumptionDefaults>,
  records: readonly LeaderCandidateSourceRecord[],
  priceByStockDate: ReadonlyMap<string, LeaderCandidateDailyPrice> | undefined = new Map<string, LeaderCandidateDailyPrice>(),
): RealisticBacktestResult {
  const { result } = probe;
  const names = latestStockNameByCode(records);
  const nameBySymbol = (symbol: string) => names.get(symbol) ?? symbol;

  const finalEquity = result.finalPortfolio.equity;
  const riskDecisions = (result as unknown as { riskDecisions?: Array<{ decision: string; approvedQuantity: number }> }).riskDecisions ?? [];
  const rejectedByRisk = riskDecisions.filter((item) => item.decision === "REJECT").length;
  const gatedIntents = probe.decisionLog.length;
  const closedTrades = result.trades.filter((trade) => !trade.openAtEnd && trade.netPnl !== null);

  const equityCurve: RealisticEquityPoint[] = result.equityCurve.map((point) => ({
    date: point.timestamp,
    equity: round2(point.equity, 2) ?? point.equity,
    cash: round2(point.cash, 2) ?? point.cash,
    openPositions: point.openPositions,
  }));

  const trades: RealisticTrade[] = result.trades.map((trade) => {
    const intent = findBuyIntentBefore(probe.decisionLog, trade.symbol, trade.entryTime);
    const stockName = nameBySymbol(trade.symbol);
    const signalDayClose = intent ? signalDayClosePrice(priceByStockDate, trade.symbol, intent.signalTime) : null;
    return toRealisticTrade(trade, stockName, intent, signalDayClose);
  });

  return {
    assumptions,
    initialCapital: assumptions.initialCapital,
    finalCapital: round2(finalEquity, 2) ?? finalEquity,
    netProfit: round2(finalEquity - assumptions.initialCapital, 2) ?? 0,
    totalReturn: round2(result.performance.totalReturnPct) ?? 0,
    maxDrawdown: round2(result.performance.maxDrawdownPct) ?? 0,
    tradeCount: result.trades.length,
    filledCount: result.trades.length,
    completedCount: closedTrades.length,
    openPositionCount: result.finalPortfolio.positions.length,
    peakOpenPositionCount: result.equityCurve.reduce((peak, point) => Math.max(peak, point.openPositions), 0),
    minimumCash: round2(result.equityCurve.reduce((min, point) => Math.min(min, point.cash), result.equityCurve[0]?.cash ?? assumptions.initialCapital), 2) ?? assumptions.initialCapital,
    totalCandidateCount: gatedIntents,
    priceAvailableCount: gatedIntents,
    capacitySkippedCount: rejectedByRisk,
    skippedCount: Math.max(0, gatedIntents - result.trades.length),
    winningTrades: closedTrades.filter((trade) => (trade.netPnl ?? 0) > 0).length,
    winRate: round2(result.performance.winRatePct),
    averageReturn: null,
    profitFactor: result.performance.profitFactor === null || result.performance.profitFactor === undefined ? null : round2(result.performance.profitFactor, 3),
    blockedBuyCount: 0,
    blockedSellCount: 0,
    missingDataCount: 0,
    exRightsCount: 0,
    equityCurve,
    trades,
  };
}

// ---------------------------------------------------------------------------
// 生产服务：正式 leader-candidate backtest 入口
// ---------------------------------------------------------------------------

/**
 * 正式生产回测服务：策略引擎结果 → Adapter → 既有 LeaderCandidateBacktestResult（生产核心版）。
 *
 * STEP 5 P2-2 边界：本函数是 `getLeaderCandidateBacktest` 生产请求唯一入口。
 * 它只产出 Strategy Engine 可验证的输出（realisticSimulation / factorEvaluation /
 * overfittingGuard / 不含样本外稳健性成分的 finalVerdict 等）；下行风险研究等
 * research-legacy 报表不在此构建（downsideRiskResearch / strategyPortfolioSnapshot 为 null），
 * 从而保证生产请求路径 legacy 模拟器调用为 0。完整分析报表请走研究服务
 * `runLeaderCandidateResearchReport`（显式 research 端点）。
 *
 * 纯函数、确定性；由 db.getLeaderCandidateBacktest（真实 router 调用方）负责加载数据后调用。
 */
export function runLeaderCandidateStrategyBacktest(
  records: readonly LeaderCandidateSourceRecord[],
  rawRows: ReadonlyArray<RawDailyPriceRow>,
  context: LeaderCandidateBacktestContext,
  options: LeaderCandidateBacktestOptions = {},
): LeaderCandidateBacktestResult {
  const { realisticSimulation } = runLeaderCandidateEngineProbe(records, rawRows, context, options);
  // legacy 报表构建器形参为可变数组：展开为副本，避免以类型断言绕过只读约束。
  return buildLeaderCandidateBacktest([...records], options, context, { realisticSimulationOverride: realisticSimulation, includeResearch: false });
}

/**
 * 完整分析报表（研究端点专用）：生产核心 + 下行风险研究（research-legacy 交易模拟器）。
 *
 * 仅由显式研究 procedure（getLeaderCandidateResearch / saveBacktestRun 快照）调用，
 * 不得进入 `getLeaderCandidateBacktest` 生产请求。返回的 realisticSimulation 仍由
 * Strategy Engine 产出（realisticSimulationOverride）；研究实验段使用
 * research/legacyTransactionSimulator 的唯一合法出口并带 provenance。
 */
export function runLeaderCandidateResearchReport(
  records: readonly LeaderCandidateSourceRecord[],
  rawRows: ReadonlyArray<RawDailyPriceRow>,
  context: LeaderCandidateBacktestContext,
  options: LeaderCandidateBacktestOptions = {},
): LeaderCandidateBacktestResult {
  const { realisticSimulation } = runLeaderCandidateEngineProbe(records, rawRows, context, options);
  return buildLeaderCandidateBacktest([...records], options, context, { realisticSimulationOverride: realisticSimulation, includeResearch: true });
}
