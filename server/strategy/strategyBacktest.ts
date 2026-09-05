/**
 * Strategy Engine Backtest —— 生产级「新引擎」回测组装点（Step 5 P1-F1/F2 修复核心）。
 *
 * 本模块是 Strategy 引擎（Step 2 Core / Step 3 Strategy / Step 4 Risk）在真实数据上的
 * 统一组装入口，也是 Feature Pipeline 的「生产调用方」：
 *
 *   Raw Market Data(DB/Tushare 行)
 *     → toCanonicalBar（canonical adapter）
 *     → validateMarketBar（数据质量三态）
 *     → runFeaturePipeline（visibleBars asOf 过滤 → FeatureSnapshot，signalDate "close"）
 *     → FeatureSnapshotBundle（同 asOf、按候选 symbol 组织）
 *     → StrategyContext.features
 *     → leader-candidate-baseline（featureMode="limit-up-confirm" 真实消费 Feature）
 *     → Signal → PositionSizer → RiskManager → Approved Order → Backtest Core
 *
 * 铁律：
 *   - 本文件是非测试生产代码；runFeaturePipeline / buildFeatures 在这里有真实调用方；
 *   - Feature 只消费 asOf（decisionDate/point）允许的数据，不可能看到未来 bar；
 *   - 不修改已有交易执行语义（复用 runBacktestWithRisk + 内置策略）；
 *   - 确定性：无 Date.now / Math.random / 模块级可变计算状态（仅函数内缓存视图/快照）。
 */

import { validateMarketBar, toCanonicalBar, toEngineMarketBar, type RawDailyPriceRow, type DecisionPoint } from "../data";
import { createFeatureSnapshotBundle, runFeaturePipeline, type FeatureSnapshot, type FeatureSnapshotBundle } from "../features";
import { runBacktestWithRisk } from "../engine/engine";
import { DEFAULT_COST_MODEL } from "../engine/execution";
import type { BacktestConfig, BacktestResult, CostModel, MarketBar } from "../engine/domain";
import { buildLeaderCandidateDataViewForDate, buildStrategySignalProvider } from "./adapter";
import { strategyRegistry } from "./registry";
import { registerBuiltInStrategies } from "./strategies";
import type { LeaderCandidateSourceRecord } from "../leaderCandidates";
import type { LeaderCandidateDataView } from "./strategies/leaderCandidateBaseline";
import type { StrategyConfig } from "./contract";

/** 需要计算的 feature 描述（id + 可选参数）。 */
export interface FeatureRequest {
  id: string;
  params?: Record<string, number>;
}

/** 默认生产特征集：覆盖涨跌停确认与基础指标（审计要求覆盖 SMA/Return/AvgAmount/Volatility/LimitUp）。 */
export const DEFAULT_PRODUCTION_FEATURES: readonly FeatureRequest[] = [
  { id: "sma", params: { period: 20 } },
  { id: "return", params: { period: 5 } },
  { id: "avgAmount", params: { period: 20 } },
  { id: "volatility", params: { period: 20 } },
  { id: "limitUpHit" },
];

export interface StrategyEngineBacktestOptions {
  /** 引擎回测资金/成本配置（缺省与 Step 2 默认一致）。 */
  initialCapital?: number;
  maxPositions?: number;
  maxPositionAmountRatio?: number;
  cost?: CostModel;
  /** 信号日范围（缺省取全部数据日期）。 */
  startDate?: string;
  endDate?: string;
  /** 每个 BUY 意图桥接为 Core Signal 的名义数量。 */
  requestedQuantity?: number;
  /** 策略 id（缺省 leader-candidate-baseline）。 */
  strategyId?: string;
  /** 策略配置（如 { minScore, maxSignals, featureMode: "limit-up-confirm" }）。 */
  strategyConfig?: StrategyConfig;
  /** 需要计算的 feature（缺省 DEFAULT_PRODUCTION_FEATURES）。 */
  features?: readonly FeatureRequest[];
  /** 特征决策时点（缺省 "close"：信号日收盘后）。 */
  decisionPoint?: DecisionPoint;
  /**
   * 显式交易日历（升序）。生产环境传入市场交易日历后，引擎会在这些日期逐日评估策略；
   * 缺省时用原始行情行自带的日期集合（与旧行为一致）。最终日历 = 显式日历 ∪ 行情日期，
   * 保证成交日（T+1）只要存在行情行就不会因为日历缺位而漏成交。
   */
  tradingDates?: readonly string[];
}

export interface StrategyEngineBacktestInput {
  /** 涨停候选原始记录（生产：DB limit_up_records）。 */
  records: readonly LeaderCandidateSourceRecord[];
  /** 原始日线行情行（生产：DB stock_daily_prices / Tushare 行）。 */
  rawRows: ReadonlyArray<RawDailyPriceRow>;
  options?: StrategyEngineBacktestOptions;
}

/** 候选数据视图 + 特征输入（供测试断言生产组装点真实生效）。 */
export interface StrategyEngineBacktestProbe {
  result: BacktestResult;
  /** 最后一次成功决策使用的特征输入（若有）。 */
  lastFeatures?: FeatureSnapshotBundle | FeatureSnapshot;
  /** 构建过特征快照的信号日。 */
  featureDates: string[];
  /** 被策略确认（limitUpHit=1）的 symbol。 */
  confirmedSymbols: string[];
  /** 跳过的 symbol 与原因（决策层面）。 */
  skippedSymbols: string[];
  /**
   * 策略实际输出的全部信号日志（observability，不参与任何决策）。
   * 生产/测试可据此追踪「Feature 门控前后策略意图」的逐日变化。
   */
  decisionLog: Array<{
    symbol: string;
    signalTime: string;
    action: "BUY" | "SELL";
    score: number;
    reason: string;
  }>;
}

/**
 * 生产级策略引擎回测：真实数据 → canonical → 校验 → Feature → Strategy → Risk → Core。
 * 纯函数（无 IO）；每次调用独立注册内置策略与局部缓存，可安全并发/重复调用。
 */
export function runStrategyEngineBacktest(input: StrategyEngineBacktestInput): StrategyEngineBacktestProbe {
  const { records, rawRows } = input;
  const options = input.options ?? {};

  // 1. 内置策略注册（幂等）。
  registerBuiltInStrategies(strategyRegistry);

  const strategyId = options.strategyId ?? "leader-candidate-baseline";
  const strategy = strategyRegistry.get(strategyId);
  const decisionPoint: DecisionPoint = options.decisionPoint ?? "close";

  // 2. Raw → canonical（逐行解析，非法数值保持 null），并校验数据质量。
  const barsBySymbol = new Map<string, Array<import("../data/types").CanonicalMarketBar>>();
  const rawDates = new Set<string>();
  let qualityIssueCount = 0;
  for (const row of rawRows) {
    if (!row.stockCode || !row.tradeDate) continue;
    const bar = toCanonicalBar(row);
    const validation = validateMarketBar(bar);
    if (validation.status === "INVALID") {
      qualityIssueCount += 1;
      continue; // INVALID 数据不进入特征/回测
    }
    rawDates.add(bar.timestamp);
    const list = barsBySymbol.get(bar.symbol) ?? [];
    list.push(bar);
    barsBySymbol.set(bar.symbol, list);
  }
  void qualityIssueCount; // 数据质量留痕：被拒行数（生产可改为日志上报）

  // 3. 引擎交易日历（升序；从行情行日期推得，可用参数收窄范围）。
  const allDates = Array.from(rawDates).sort();
  const startDate = options.startDate ?? allDates[0] ?? "";
  const endDate = options.endDate ?? allDates.at(-1) ?? "";
  const tradingDates = (options.tradingDates && options.tradingDates.length > 0
    ? Array.from(new Set([...options.tradingDates, ...allDates]))
    : allDates)
    .sort()
    .filter((date) => date >= startDate && date <= endDate);

  // 4. barsByDate（engine MarketBar）：按 (date, symbol)。
  const barsByDate = new Map<string, Map<string, MarketBar>>();
  for (const [symbol, bars] of Array.from(barsBySymbol.entries())) {
    for (const bar of bars) {
      if (bar.timestamp < startDate || bar.timestamp > endDate) continue;
      let day = barsByDate.get(bar.timestamp);
      if (!day) {
        day = new Map<string, MarketBar>();
        barsByDate.set(bar.timestamp, day);
      }
      day.set(symbol, toEngineMarketBar(bar));
    }
  }

  // 5. 候选数据视图 + 特征 bundle（按日期惰性计算并缓存；与 signalTime 严格同 asOf）。
  const viewCache = new Map<string, LeaderCandidateDataView>();
  const featureCache = new Map<string, FeatureSnapshotBundle>();
  const featureDates: string[] = [];
  const confirmedSymbols = new Set<string>();
  const skippedSymbols = new Set<string>();
  const featureSpecs = options.features && options.features.length > 0 ? [...options.features] : [...DEFAULT_PRODUCTION_FEATURES];
  const decisionLog: NonNullable<StrategyEngineBacktestProbe["decisionLog"]> = [];

  const viewOf = (date: string): LeaderCandidateDataView => {
    const cached = viewCache.get(date);
    if (cached) return cached;
    const view = buildLeaderCandidateDataViewForDate([...records], date);
    viewCache.set(date, view);
    return view;
  };

  const snapshotOfSymbol = (symbol: string, stockName: string | null, date: string): FeatureSnapshot => {
    const bars = barsBySymbol.get(symbol) ?? [];
    return runFeaturePipeline({
      symbol,
      stockName,
      bars,
      decisionDate: date,
      decisionPoint,
      features: featureSpecs.map((spec) => ({ id: spec.id, params: spec.params })),
    });
  };

  const featuresOfDate = (date: string): FeatureSnapshotBundle | undefined => {
    const cached = featureCache.get(date);
    if (cached) return cached;
    const view = viewOf(date);
    if (view.candidates.length === 0) return undefined;
    const snapshots = view.candidates.map((candidate) => snapshotOfSymbol(candidate.stockCode, candidate.stockName, date));
    const bundle = createFeatureSnapshotBundle({ decisionDate: date, decisionPoint }, snapshots);
    featureCache.set(date, bundle);
    featureDates.push(date);
    // 记录确认/未确认候选（供断言/审计）。
    for (const candidate of view.candidates) {
      const snapshot = bundle.bySymbol.get(candidate.stockCode);
      const hit = snapshot?.features.limitUpHit;
      if (hit && hit.status === "READY" && hit.value === 1) confirmedSymbols.add(candidate.stockCode);
      else skippedSymbols.add(candidate.stockCode);
    }
    return bundle;
  };

  // 6. 组装生产 signalProvider：Data View + Feature Pipeline（buildFeatures）注入同一 provider。
  const strategyProvider = buildStrategySignalProvider(
    strategyId,
    (date) => viewOf(date),
    {
      config: options.strategyConfig,
      requestedQuantity: options.requestedQuantity ?? 100,
      buildFeatures: (date) => featuresOfDate(date),
    },
  );
  // observability：逐日记录策略真实输出的信号（只读日志，不改写任何决策路径）。
  const signalProvider: (date: string, portfolio: import("../engine/domain").ReadonlyPortfolioSnapshot) => import("../engine/domain").Signal[] = (date, portfolio) => {
    const signals = strategyProvider(date, portfolio);
    for (const signal of signals) {
      if (signal.side !== "buy" && signal.side !== "sell") continue;
      decisionLog.push({
        symbol: signal.symbol,
        signalTime: signal.signalTime,
        action: signal.side === "buy" ? "BUY" : "SELL",
        score: signal.score ?? 0,
        reason: signal.reason ?? "",
      });
    }
    return signals;
  };

  // 7. 引擎配置（与 Step 2 一致的成本/仓位口径）。
  const config: BacktestConfig = {
    strategyId,
    strategyVersion: strategy.metadata.version,
    initialCapital: options.initialCapital ?? 100_000,
    startDate,
    endDate,
    cost: options.cost ?? DEFAULT_COST_MODEL,
    maxPositions: Math.max(1, Math.floor(options.maxPositions ?? 5)),
    maxPositionAmountRatio: options.maxPositionAmountRatio ?? 0,
  };

  // 8. Golden Pipeline：Strategy → PositionSizer → RiskManager → Approved Order → Backtest Core。
  const result = runBacktestWithRisk({
    config,
    tradingDates,
    barsByDate,
    signalProvider,
  });

  return {
    result,
    featureDates,
    confirmedSymbols: Array.from(confirmedSymbols).sort(),
    skippedSymbols: Array.from(skippedSymbols).sort(),
    decisionLog,
  };
}
