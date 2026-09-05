/**
 * STEP 5 — Golden Test（端到端集成）：
 *
 *   Raw Data(Row) → Adapter(toCanonicalBar) → Validation → Feature Pipeline(visibleBars
 *   → MarketBarSeries → FeatureSnapshot) → Strategy Context(features) → Strategy Signal
 *   → toCoreSignals → runBacktestWithRisk(PositionSizer → RiskManager → Approved Order)
 *   → Backtest Core。
 *
 * 目的：证明 Step 5 数据基础设施接入后，Step 2（Core）/ Step 3（Strategy）/ Step 4（Risk）
 * 语义未被破坏——全部复用既有实现，没有重写。
 *
 * 时间安排：
 *   - HISTORY_DATES：信号日之前的历史交易日（预热数据，仅用于 feature 窗口，不进回测窗口）
 *   - TRADING_DATES：回测交易窗口（与 Step 1–4 验收一致的 4 个交易日）
 *   - SIGNAL_DATE = TRADING_DATES[1]（2026-01-06 收盘后决策）
 *   在 SIGNAL_DATE 以 "close" 决策时，可见 bar = 12-30/12-31/01-05/01-06 共 4 根，
 *   使 sma(3)/return(1)/avgAmount(3)/volatility(3)/limitUpHit 全部 READY。
 */

import { describe, expect, it } from "vitest";
import { runBacktestWithRisk } from "../engine/engine";
import { toCanonicalBar, toEngineMarketBar, validateMarketBar, type CanonicalMarketBar } from "../data";
import { FeatureRegistry, registerBasicFeatures, runFeaturePipeline, type FeatureSnapshot } from "../features";
import { toCoreSignals, buildLeaderCandidateDataViewForDate } from "../strategy/adapter";
import type { LeaderCandidateSourceRecord } from "../leaderCandidates";
import { StrategyRegistry } from "../strategy/registry";
import type { AnyStrategy, ReadonlyPortfolioContext, StrategyContext } from "../strategy/contract";
import { leaderCandidateBaselineStrategy } from "../strategy/strategies/leaderCandidateBaseline";
import { DEFAULT_COST_MODEL } from "../engine/execution";
import type { BacktestConfig, MarketBar } from "../engine/domain";

const COST = DEFAULT_COST_MODEL;
const SYMBOLS = ["600001.SH", "600002.SH", "600003.SH"] as const;

/** 信号日之前的历史交易日（feature 预热窗口；12-30/12-31 为 2026-01-05 前的真实交易日）。 */
const HISTORY_DATES = ["2025-12-30", "2025-12-31"];
/** 回测交易窗口（Step 2 Core 的 tradingDates）。 */
const TRADING_DATES = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
/** 全部行情日期（历史 + 交易窗口）。 */
const ALL_DATES = [...HISTORY_DATES, ...TRADING_DATES];
/** 候选信号日 / 决策日：2026-01-06（收盘后，可见 4 根历史 bar）。 */
const SIGNAL_DATE = "2026-01-06";

// ---- 原始行情行（模拟 DB stock_daily_prices 行，varchar） ----
const rawRows: Array<Record<string, string | null>> = [];
for (const [dateIndex, date] of ALL_DATES.entries()) {
  for (const symbol of SYMBOLS) {
    const open = (10 + dateIndex * 0.1).toFixed(2);
    const close = (10 + dateIndex * 0.15).toFixed(2);
    rawRows.push({
      stockCode: symbol,
      tradeDate: date,
      openPrice: open,
      closePrice: close,
      highPrice: (Number(close) + 0.1).toFixed(2),
      lowPrice: (Number(open) - 0.1).toFixed(2),
      preClosePrice: dateIndex === 0 ? "10" : (10 + (dateIndex - 1) * 0.15).toFixed(2),
      amount: String(200_000 + dateIndex * 1_000),
      volume: String(100_000 + dateIndex * 100),
    });
  }
}

// ---- 原始涨停记录（OCR 识别来源）----
const records: LeaderCandidateSourceRecord[] = SYMBOLS.map((stockCode) => ({
  stockCode,
  stockName: `示例${stockCode.slice(0, 6)}`,
  limitUpDate: SIGNAL_DATE, // 2026-01-06 三只同题材涨停
  limitUpTime: "09:35",
  sector: "人工智能",
  turnover: "10亿元",
  circulationValue: "100亿元",
}));

function canonicalBarsFor(symbol: string): CanonicalMarketBar[] {
  return rawRows
    .filter((row) => row.stockCode === symbol)
    .map((row) => toCanonicalBar(row));
}

function buildBarsByDate(): Map<string, Map<string, MarketBar>> {
  const barsByDate = new Map<string, Map<string, MarketBar>>();
  for (const date of TRADING_DATES) {
    const day = new Map<string, MarketBar>();
    for (const symbol of SYMBOLS) {
      const row = rawRows.find((r) => r.stockCode === symbol && r.tradeDate === date)!;
      day.set(symbol, toEngineMarketBar(toCanonicalBar(row)));
    }
    barsByDate.set(date, day);
  }
  return barsByDate;
}

function cfg(): BacktestConfig {
  return {
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
    initialCapital: 100_000,
    startDate: TRADING_DATES[0]!,
    endDate: TRADING_DATES[3]!,
    cost: COST,
    maxPositions: 5,
    maxPositionAmountRatio: 0,
  };
}

/** 在 SIGNAL_DATE 收盘后为 S1 计算 feature snapshot（与候选信号日同 asOf）。 */
function snapshotForSymbolAtSignalDate(symbol: string, signalDate: string): FeatureSnapshot {
  return runFeaturePipeline({
    symbol,
    bars: canonicalBarsFor(symbol),
    decisionDate: signalDate,
    decisionPoint: "close",
    features: [
      { id: "sma", params: { period: 3 } },
      { id: "return", params: { period: 1 } },
      { id: "avgAmount", params: { period: 3 } },
      { id: "volatility", params: { period: 3 } },
      { id: "limitUpHit" },
    ],
  });
}

/** 测试专用探针策略：验证 FeatureSnapshot 真实到达 Strategy Context。 */
const featureProbeStrategy: AnyStrategy = {
  metadata: {
    id: "feature-probe",
    name: "特征快照探针",
    version: "1.0.0",
    description: "仅用于验收：若 context.features 存在且 sma READY，输出一条携带快照值的信息 BUY。",
    category: "test",
    requiredData: [],
    supportsLong: true,
    supportsShort: false,
    supportsIntraday: false,
  },
  defaultConfig: {},
  normalizeConfig() {
    return {};
  },
  evaluate(context: StrategyContext<Record<string, never>, unknown>) {
    const sma = context.features?.features?.sma;
    if (!context.features || !sma || sma.status !== "READY" || sma.value === null) {
      return { signals: [], strategyVersion: "1.0.0", insufficientData: true };
    }
    return {
      signals: [{
        symbol: context.features.symbol,
        signalTime: context.signalTime,
        action: "BUY",
        reason: `sma=${sma.value.toFixed(4)} asOf=${context.features.asOf.decisionDate}:${context.features.asOf.decisionPoint}`,
      }],
      strategyVersion: "1.0.0",
      insufficientData: false,
    };
  },
};

describe("STEP 5 Golden Test：Raw → … → Backtest Core 全链路", () => {
  it("数据管道：raw 行 → canonical → VALID；feature pipeline 产出 READY snapshot", () => {
    const canonical = canonicalBarsFor("600001.SH");
    expect(canonical).toHaveLength(ALL_DATES.length); // 历史 + 交易窗口全部归一化
    for (const bar of canonical) {
      expect(validateMarketBar(bar).status).toBe("VALID");
      expect(bar.adjustment).toBe("raw");
    }
    const snapshot = snapshotForSymbolAtSignalDate("600001.SH", SIGNAL_DATE);
    expect(snapshot.symbol).toBe("600001.SH");
    expect(snapshot.asOf).toEqual({ decisionDate: SIGNAL_DATE, decisionPoint: "close" });
    // SIGNAL_DATE "close" 决策：可见 12-30/12-31/01-05/01-06 共 4 根，全部 READY
    expect(snapshot.features.sma?.status).toBe("READY");
    expect(snapshot.features["return"]?.status).toBe("READY");
    expect(snapshot.features.avgAmount?.status).toBe("READY");
    expect(snapshot.features.volatility?.status).toBe("READY");
    expect(snapshot.features.limitUpHit?.status).toBe("READY");
    expect(snapshot.features.sma?.availableBars).toBe(4);
    expect(snapshot.features.volatility?.availableBars).toBe(4);
    // 快照内所有 feature 绑定同一 asOf / 同一可见 bar 数
    for (const entry of Object.values(snapshot.features)) {
      expect(entry.availableBars).toBe(snapshot.features.sma!.availableBars);
    }
  });

  it("Strategy Context：features 经 registry.evaluate 到达策略（probe 读取 sma 值）", () => {
    const registry = new StrategyRegistry();
    registry.register(featureProbeStrategy);
    const snapshot = snapshotForSymbolAtSignalDate("600001.SH", SIGNAL_DATE);
    const portfolio: ReadonlyPortfolioContext = { cash: 100_000, equity: 100_000, openPositionCount: 0, openPositionSymbols: [] };
    const decision = registry.evaluate("feature-probe", SIGNAL_DATE, undefined, portfolio, undefined, snapshot);
    expect(decision.signals).toHaveLength(1);
    expect(decision.signals[0]!.symbol).toBe("600001.SH");
    expect(decision.signals[0]!.reason).toContain(`sma=`);
    expect(decision.signals[0]!.reason).toContain(`asOf=${SIGNAL_DATE}:close`);
  });

  it("全链路：既有候选策略 + 统一入口（含 Risk 层）驱动 Backtest Core 成交且语义未破坏", () => {
    const registry = new StrategyRegistry();
    registry.register(leaderCandidateBaselineStrategy);
    const barsByDate = buildBarsByDate();

    const signalProvider = (date: string) => {
      // Data Provider：严格 point-in-time 候选数据视图（2026-01-06 有 3 只候选）
      const view = buildLeaderCandidateDataViewForDate(records, date);
      const features = date === SIGNAL_DATE ? snapshotForSymbolAtSignalDate("600001.SH", date) : undefined;
      const decision = registry.evaluate(leaderCandidateBaselineStrategy.metadata.id, date, view, {
        cash: 0,
        equity: 0,
        openPositionCount: 0,
        openPositionSymbols: [],
      }, { minScore: null, maxSignals: 5 }, features);
      return toCoreSignals(decision, { requestedQuantity: 100 });
    };

    const result = runBacktestWithRisk({
      config: cfg(),
      tradingDates: TRADING_DATES,
      barsByDate,
      signalProvider,
    });

    // 3 只候选全部成交（2026-01-07 开盘）
    expect(result.trades).toHaveLength(3);
    for (const trade of result.trades) {
      expect(SYMBOLS).toContain(trade.symbol);
      expect(trade.quantity).toBe(100);
    }
    // Step 4 Risk 层：每笔 BUY 都有可解释的 riskDecision（APPROVE）
    const riskDecisions = (result as unknown as { riskDecisions?: Array<{ decision: string; approvedQuantity: number }> }).riskDecisions ?? [];
    expect(riskDecisions.length).toBeGreaterThanOrEqual(3);
    for (const rd of riskDecisions) {
      expect(rd.decision).toBe("APPROVE");
      expect(rd.approvedQuantity).toBe(100);
    }
    // Step 2 绩效正常
    expect(result.equityCurve.length).toBe(TRADING_DATES.length);
    expect(result.finalPortfolio.equity).toBeGreaterThan(0);
  });
});
