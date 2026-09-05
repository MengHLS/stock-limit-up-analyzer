/**
 * STEP 5 FIX-2（RA-001 / RA-002）—— 生产入口集成测试。
 *
 * 审计要求：不能停留在「test → runStrategyEngineBacktest」，必须是真实生产入口链路：
 *
 *   routers.sentiment.getLeaderCandidateBacktest
 *     → db.getLeaderCandidateBacktest（正式生产入口）
 *       → runLeaderCandidateStrategyBacktest（production service，server/leaderCandidateStrategyBacktest.ts）
 *         → runStrategyEngineBacktest
 *           → Canonical / Validation → runFeaturePipeline → FeatureSnapshotBundle
 *           → buildStrategySignalProvider({ buildFeatures })
 *             → leader-candidate-baseline(featureMode="limit-up-confirm" 真实读取 context.features)
 *           → PositionSizer / RiskManager → runBacktestWithRisk
 *         → Engine Result Adapter → realisticSimulation（既有 API response 形状）
 *       → buildLeaderCandidateBacktest（realisticSimulationOverride 覆盖，研究报表兼容）
 *
 * db.getLeaderCandidateBacktest 依赖 DB，无法在无库环境直连；测试直接驱动 production service
 * （runLeaderCandidateStrategyBacktest / runLeaderCandidateEngineProbe，均为同一生产代码路径，
 * 仅由 db 层负责加载 records/rawRows/context 后调用）。
 *
 * 场景（全部主板非 ST，600xxx.SH，±10%）：
 *   D0=2026-01-05(周一) D1=2026-01-06(周二) D2=2026-01-07(周三) D3=2026-01-08(周四)。
 *   A/B/C 三只同题材候选在 D1 涨停（来源库口径）；
 *   价格库只在 A 处确认涨停（limitUpHit=1），B 默认未确认（10.20），C 默认未确认（10.20）。
 */

import { describe, expect, it } from "vitest";
import type { RawDailyPriceRow } from "../data";
import { runStrategyEngineBacktest } from "./strategyBacktest";
import {
  LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE,
  LEADER_CANDIDATE_PRODUCTION_MAX_SIGNALS,
  LEADER_CANDIDATE_PRODUCTION_STRATEGY_ID,
  buildProductionLeaderCandidateStrategyConfig,
  runLeaderCandidateEngineProbe,
  runLeaderCandidateResearchReport,
  runLeaderCandidateStrategyBacktest,
} from "../leaderCandidateStrategyBacktest";
import type { LeaderCandidateBacktestContext, LeaderCandidateBacktestOptions } from "../leaderCandidates";
import { leaderCandidateBaselineStrategy, type LeaderCandidateDataView } from "./strategies/leaderCandidateBaseline";

const D0 = "2026-01-05";
const D1 = "2026-01-06";
const D2 = "2026-01-07";
const D3 = "2026-01-08";
const CALENDAR = [D0, D1, D2, D3];

const A = "600001.SH"; // D1 价格库确认涨停 → 应被纳入
const B = "600002.SH"; // 默认 D1 收盘 10.20 未涨停 → 应被排除；改 11.00 后纳入
const C = "600003.SH"; // 默认未确认；D2（未来）可变为涨停 → 未来渗漏探针

function rec(stockCode: string, limitUpTime: string, stockName: string) {
  return { stockCode, stockName, limitUpDate: D1, limitUpTime, sector: "半导体", turnover: "12", circulationValue: "80" };
}

function sourceRecords() {
  return [rec(A, "09:31:00", "中科蓝海"), rec(B, "09:45:00", "东方华电"), rec(C, "10:20:00", "天启智能")];
}

function bar(stockCode: string, tradeDate: string, open: number, close: number, preClose: number, opts: { high?: number; low?: number; volume?: number; amount?: number } = {}): RawDailyPriceRow {
  const high = opts.high ?? Math.max(open, close) + 0.1;
  const low = opts.low ?? Math.min(open, close) - 0.1;
  return {
    stockCode,
    tradeDate,
    openPrice: String(open),
    closePrice: String(close),
    highPrice: String(high),
    lowPrice: String(low),
    preClosePrice: String(preClose),
    volume: String(opts.volume ?? 150000),
    amount: String(opts.amount ?? 88000),
  };
}

interface Scenario {
  aD1Close?: number; // 默认 11.00（涨停）
  bD1Close?: number; // 默认 10.20（非涨停）；11.00 = 涨停
  cD1Close?: number; // 默认 10.20（非涨停）；11.00 = 涨停
  cD2Close?: number; // C D2 收盘，默认 10.60；11.50 = 未来涨停（渗漏探针）
  /** 对未来（D2/D3）OHLCV 做整体扰动：不应影响 D1 decision/order。 */
  futureTweak?: boolean;
}

/** 默认价格库：A/B/C 各 D0~D3；仅 A 的 D1 收盘确认涨停。 */
function priceRows(scenario: Scenario = {}): RawDailyPriceRow[] {
  const aD1Close = scenario.aD1Close ?? 11.0;
  const bD1Close = scenario.bD1Close ?? 10.2;
  const cD1Close = scenario.cD1Close ?? 10.2;
  const cD2Close = scenario.cD2Close ?? 10.6;
  const rows: RawDailyPriceRow[] = [
    // A：D1 收盘 11.00（涨停）；D2/D3 未来可扰动。
    bar(A, D0, 10.0, 10.0, 10.0),
    bar(A, D1, 10.2, aD1Close, 10.0, { high: Math.max(11.0, aD1Close) + 0.05, low: 10.1 }),
    bar(A, D2, 11.2, 11.8, 11.0, { high: 12.0, low: 11.1 }),
    bar(A, D3, 11.5, 12.2, 11.8, { high: 12.5, low: 11.4 }),
    // B：D1 收盘 10.20（默认未确认）；bD1Close=11 时确认。
    bar(B, D0, 10.0, 10.0, 10.0),
    bar(B, D1, 10.05, bD1Close, 10.0, { high: Math.max(10.35, bD1Close) + 0.05, low: 10.0 }),
    bar(B, D2, bD1Close === 11 ? 11.2 : 10.5, bD1Close === 11 ? 11.7 : 10.6, bD1Close, { high: bD1Close === 11 ? 11.9 : 10.75, low: bD1Close === 11 ? 10.9 : 10.35 }),
    bar(B, D3, 11.0, 11.6, bD1Close === 11 ? 11.7 : 10.6, { high: 11.8, low: 10.9 }),
    // C：D1 收盘 10.20（默认未确认）；cD1Close=11 时确认；D2 收盘可设为未来涨停。
    bar(C, D0, 10.0, 10.0, 10.0),
    bar(C, D1, 10.1, cD1Close, 10.0, { high: Math.max(10.3, cD1Close) + 0.05, low: 10.05 }),
    bar(C, D2, cD1Close === 11 ? 11.2 : 10.3, cD2Close, cD1Close, { high: Math.max(10.7, cD2Close, cD1Close === 11 ? 11.4 : 0), low: 10.25 }),
    bar(C, D3, 10.5, 10.9, cD2Close, { high: 11.1, low: 10.4 }),
  ];

  if (scenario.futureTweak) {
    // 只扰动 D2/D3 的 close/high/low/volume/amount（open/preClose 保持不变，成交路径不受影响）。
    // 扰动后仍保持 high ≥ max(open,close)、low ≤ min(open,close)，避免被 validateMarketBar 判 INVALID。
    for (const row of rows) {
      if (row.tradeDate !== D2 && row.tradeDate !== D3) continue;
      const open = Number(row.openPrice);
      const close = Number(row.closePrice) + 1.1;
      const low = Math.min(Number(row.lowPrice) - 0.5, open, close) - 0.05;
      const high = Math.max(Number(row.highPrice) + 0.6, open, close) + 0.05;
      row.closePrice = String(close);
      row.highPrice = String(high);
      row.lowPrice = String(Math.max(0.5, low));
      row.volume = String(Number(row.volume) * 2);
      row.amount = String(Number(row.amount) * 3);
    }
  }
  return rows;
}

function contextOf(scenario: Scenario = {}): LeaderCandidateBacktestContext {
  const priceByStockDate = new Map<string, { openPrice: number | null; closePrice: number | null }>();
  for (const row of priceRows(scenario)) {
    priceByStockDate.set(`${row.stockCode}::${row.tradeDate}`, {
      openPrice: Number(row.openPrice),
      closePrice: Number(row.closePrice),
    });
  }
  return { tradingDates: CALENDAR, priceByStockDate };
}

const baseOptions: LeaderCandidateBacktestOptions = {
  realistic: {
    initialCapital: 100_000,
    maxPositions: 5,
    commissionRate: 0.0003,
    stampDutyRate: 0.0005,
    transferFeeRate: 0.00001,
    slippageBps: 10,
    lotSize: 100,
  },
};

function runService(scenario: Scenario = {}, options: LeaderCandidateBacktestOptions = baseOptions) {
  return runLeaderCandidateStrategyBacktest(sourceRecords(), priceRows(scenario), contextOf(scenario), options);
}

function runProbe(scenario: Scenario = {}, options: LeaderCandidateBacktestOptions = baseOptions) {
  return runLeaderCandidateEngineProbe(sourceRecords(), priceRows(scenario), contextOf(scenario), options);
}

describe("RA-001/RA-002 生产入口：runLeaderCandidateStrategyBacktest → Strategy Engine → Feature", () => {
  it("TEST 1/2 生产入口真实执行并调用 Feature：仅价格库确认涨停的 A 被纳入并成交（D1 信号 → D2 开盘）", () => {
    const service = runService({});
    const { probe } = runProbe({});

    // 生产服务返回完整既有报表，realisticSimulation 由新引擎产出。
    expect(service.realisticSimulation.trades.map((trade) => trade.stockCode)).toEqual([A]);
    expect(service.realisticSimulation.trades[0]).toMatchObject({ status: "filled", entryDate: D2, shares: 100, signalDate: D1 });

    // 生产引擎探针：Feature 确实在 D1 被构建并消费（featureDates / confirmedSymbols 非空）。
    expect(probe.featureDates).toEqual([D1]);
    expect(probe.confirmedSymbols).toEqual([A]);
    expect(probe.skippedSymbols.sort()).toEqual([B, C].sort());
    expect(probe.decisionLog.map((log) => log.symbol)).toEqual([A]);
    expect(probe.decisionLog[0]).toMatchObject({ signalTime: D1, action: "BUY" });

    // 引擎级风险/核心链路真实经过：riskDecisions 已记录、成交落在 T+1 开盘。
    const riskDecisions = (probe.result as unknown as { riskDecisions?: unknown[] }).riskDecisions ?? [];
    expect(riskDecisions.length).toBeGreaterThanOrEqual(1);
    expect(probe.result.metadata.strategyId).toBe(LEADER_CANDIDATE_PRODUCTION_STRATEGY_ID);
    expect(probe.result.trades).toHaveLength(1);
    expect(probe.result.trades[0]!.entryTime).toBe(D2);
  });

  it("TEST 3 生产配置显式 featureMode=limit-up-confirm（不依赖默认值）", () => {
    const productionConfig = buildProductionLeaderCandidateStrategyConfig(baseOptions);
    expect(LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE).toBe("limit-up-confirm");
    expect(LEADER_CANDIDATE_PRODUCTION_STRATEGY_ID).toBe("leader-candidate-baseline");
    expect(productionConfig.featureMode).toBe("limit-up-confirm");
    expect(productionConfig.maxSignals).toBe(LEADER_CANDIDATE_PRODUCTION_MAX_SIGNALS);
    // minScore 跟随回测参数显式传递（null=不过滤）。
    expect(buildProductionLeaderCandidateStrategyConfig({ minScore: 60 }).minScore).toBe(60);

    // 实际消费：生产配置（confirm）只放行被价格库确认的 A；若生产误用默认 off，B/C 也会成交。
    const { probe } = runProbe({});
    expect(probe.decisionLog).toHaveLength(1);
    expect(probe.confirmedSymbols).toEqual([A]);
  });

  it("TEST 4 Feature 真实改变生产 Decision：B 由价格库未确认（10.20）改为涨停（11.00）→ 从排除变为纳入", () => {
    const before = runService({});
    const after = runService({ bD1Close: 11.0 });

    // 生产服务输出（realisticSimulation.trades）随 Feature 输入改变。
    expect(before.realisticSimulation.trades.map((trade) => trade.stockCode)).toEqual([A]);
    expect(after.realisticSimulation.trades.map((trade) => trade.stockCode).sort()).toEqual([A, B].sort());

    // 引擎探针同步证明：候选记录不变，仅价格库口径变化 → confirmedSymbols / decisionLog 改变。
    const probeBefore = runProbe({}).probe;
    const probeAfter = runProbe({ bD1Close: 11.0 }).probe;
    expect(probeBefore.confirmedSymbols).toEqual([A]);
    expect(probeAfter.confirmedSymbols).toEqual([A, B]);
    expect(probeBefore.decisionLog.map((log) => log.symbol)).toEqual([A]);
    expect(probeAfter.decisionLog.map((log) => log.symbol).sort()).toEqual([A, B].sort());
  });

  it("TEST 5 Future Leakage：修改 D2/D3（未来）OHLCV 不改变 D1 Decision / D1 Signal / D2 Order", () => {
    const base = runService({});
    const futureTweaked = runService({ futureTweak: true, cD2Close: 11.5 });

    // D1 决策相关输出必须逐字段一致（trades=仅 A；C 未来即使涨停也不进入 D1 决策）。
    expect(futureTweaked.realisticSimulation.trades).toEqual(base.realisticSimulation.trades);
    expect(futureTweaked.realisticSimulation.trades.map((trade) => trade.stockCode)).toEqual([A]);

    const probeBase = runProbe({}).probe;
    const probeFuture = runProbe({ futureTweak: true, cD2Close: 11.5 }).probe;
    // D1 Decision（decisionLog / confirmedSymbols）完全一致。
    expect(probeFuture.decisionLog).toEqual(probeBase.decisionLog);
    expect(probeFuture.confirmedSymbols).toEqual(probeBase.confirmedSymbols);
    // D2 Order（risk 裁决：approvedQuantity/decision）完全一致。
    const decisionsOf = (probe: typeof probeBase) =>
      ((probe.result as unknown as { riskDecisions?: Array<{ symbol: string; signalTime: string; decision: string; approvedQuantity: number }> }).riskDecisions ?? [])
        .map((item) => ({ symbol: item.symbol, signalTime: item.signalTime, decision: item.decision, approvedQuantity: item.approvedQuantity }));
    expect(decisionsOf(probeFuture)).toEqual(decisionsOf(probeBase));
    // 成交入口（symbol/entryTime/entryPrice/quantity）完全一致；仅期末估值价随未来行情变化。
    const entryOf = (trades: typeof probeBase.result.trades) => trades.map((trade) => ({ symbol: trade.symbol, entryTime: trade.entryTime, entryPrice: trade.entryPrice, quantity: trade.quantity, openAtEnd: trade.openAtEnd }));
    expect(entryOf(probeFuture.result.trades)).toEqual(entryOf(probeBase.result.trades));
    // 若 D2/D3 未来数据渗漏进 D1 特征，C（未来涨停）会被误纳入——此处证明没有。
    expect(probeFuture.skippedSymbols).toContain(C);
  });

  it("TEST 6 Missing-Feature 安全：价格库无法确认时不会 silent-fallback 到 off（B/C 不因降级被纳入）", () => {
    // 构造「信号日价格数据完全缺失」：只保留 A 的 D1 行（A 可确认），B/C 的 D1 行删除，
    // 但 B/C 的 D2 行仍在（若生产悄悄回退到 off，B/C 会在 D2 成交）。
    const rows = priceRows({}).filter((row) => {
      if (row.tradeDate === D1 && (row.stockCode === B || row.stockCode === C)) return false;
      return true;
    });
    const probe = runLeaderCandidateEngineProbe(sourceRecords(), rows, contextOf({}), baseOptions).probe;
    const service = runLeaderCandidateStrategyBacktest(sourceRecords(), rows, contextOf({}), baseOptions);

    // 缺 Feature（INSUFFICIENT）→ B/C 保持排除；绝不回退为 off 全量买入。
    expect(probe.decisionLog.map((log) => log.symbol)).toEqual([A]);
    expect(service.realisticSimulation.trades.map((trade) => trade.stockCode)).toEqual([A]);

    // 策略契约本身：featureMode=limit-up-confirm 且 features 完全缺失 → insufficientData=true、空决策。
    const data: LeaderCandidateDataView = { signalDate: D1, candidates: [{ stockCode: B, stockName: "东方华电", sector: "半导体", boards: 1, sectorCount: 3, score: 70, riskScore: 10, riskTier: "低风险", limitUpTime: "09:45:00" }] };
    const decision = leaderCandidateBaselineStrategy.evaluate({ signalTime: D1, data, config: { minScore: null, maxSignals: 5, featureMode: "limit-up-confirm" }, features: undefined, portfolio: { cash: 100000, equity: 100000, openPositionCount: 0, openPositionSymbols: [] } });
    expect(decision.insufficientData).toBe(true);
    expect(decision.signals).toHaveLength(0);
  });

  it("TEST 7 Determinism：同一 Data/Config/asOf 重复 100 次结果完全一致", () => {
    const first = runProbe({ bD1Close: 11.0 });
    for (let index = 0; index < 100; index += 1) {
      const again = runProbe({ bD1Close: 11.0 });
      expect(again).toEqual(first);
    }
    // 生产服务（含研究报表构建）同样确定性：两次运行深度相等。
    expect(runService({ bD1Close: 11.0 })).toEqual(runService({ bD1Close: 11.0 }));
  });

  it("TEST 8 Risk Regression：maxPositions / lotSize / cash 约束仍然生效（不被生产入口绕过）", () => {
    // 三只全部价格库确认涨停；maxPositions=1 → 仅最高优先级 1 单成交。
    const allConfirmed = { aD1Close: 11.0, bD1Close: 11.0, cD1Close: 11.0 } as const;
    const capped = runProbe(allConfirmed, { ...baseOptions, realistic: { ...baseOptions.realistic, maxPositions: 1 } });
    expect(capped.probe.decisionLog).toHaveLength(3); // 3 个 BUY 意图
    expect(capped.probe.result.trades).toHaveLength(1); // 仓位上限生效
    expect(capped.realisticSimulation.trades).toHaveLength(1);

    // lotSize=200 且信号名义数量 100（非整手）→ 核心层整手约束生效，无法成交。
    const lotBound = runProbe({}, { ...baseOptions, realistic: { ...baseOptions.realistic, lotSize: 200 } });
    expect(lotBound.probe.decisionLog).toHaveLength(1);
    expect(lotBound.probe.result.trades).toHaveLength(0);

    // cash 约束：初始资金不足以买入 1 手（A 约 11.00×100 + 费用 > 900）→ 不成交、不超支。
    const cashBound = runProbe({}, { ...baseOptions, realistic: { ...baseOptions.realistic, initialCapital: 900 } });
    expect(cashBound.probe.decisionLog).toHaveLength(1);
    expect(cashBound.probe.result.trades).toHaveLength(0);
    expect(cashBound.probe.result.finalPortfolio.cash).toBeLessThanOrEqual(900);
  });

  it("TEST 9 API Compatibility：生产服务输出保持既有 LeaderCandidateBacktestResult / RealisticBacktestResult 形状", () => {
    const service = runService({});
    // 顶层既有研究字段全部存在。
    for (const key of ["definition", "observationDays", "totalSamples", "successCount", "successRate", "historicalRows", "realisticSimulation", "downsideRiskResearch", "factorEvaluation", "overfittingGuard", "finalVerdict", "dailyPriceCoverage"] as const) {
      expect(key in service).toBe(true);
    }
    // realisticSimulation 保持既有 RealisticBacktestResult 形状。
    const sim = service.realisticSimulation;
    for (const key of ["assumptions", "initialCapital", "finalCapital", "netProfit", "totalReturn", "maxDrawdown", "tradeCount", "filledCount", "completedCount", "openPositionCount", "equityCurve", "trades"] as const) {
      expect(key in sim).toBe(true);
    }
    expect(Array.isArray(sim.equityCurve)).toBe(true);
    expect(Array.isArray(sim.trades)).toBe(true);
    expect(sim.assumptions.initialCapital).toBe(100_000);
    // 兼容既有字段语义：成交明细至少含 stockCode/entryDate/entryPrice/status。
    expect(sim.trades[0]).toMatchObject({ stockCode: A, entryDate: D2, status: "filled" });
  });

  it("TEST 9c P2-2 边界：生产核心不含 research-legacy 研究段；完整分析报表经研究服务单独产出", () => {
    const records = sourceRecords();
    const rows = priceRows({});
    const ctx = contextOf({});
    // 生产核心服务：研究段为 null，生产请求路径不执行 research-legacy 模拟器。
    const core = runLeaderCandidateStrategyBacktest(records, rows, ctx, baseOptions);
    expect(core.downsideRiskResearch).toBeNull();
    expect(core.strategyPortfolioSnapshot).toBeNull();
    // 顶层 realisticSimulation 仍由引擎产出（形状兼容、成交存在），overfitting/factor 研究段保留。
    expect(core.realisticSimulation.trades.length).toBeGreaterThan(0);
    expect(core.overfittingGuard).toBeDefined();
    expect(core.finalVerdict).toBeDefined();

    // 完整分析报表：显式研究服务产出研究段，并带 research-legacy provenance。
    const research = runLeaderCandidateResearchReport(records, rows, ctx, baseOptions);
    expect(research.downsideRiskResearch).not.toBeNull();
    expect(research.downsideRiskResearch!.simulator).toMatchObject({ productionRuntime: false });
    expect(research.downsideRiskResearch!.simulator.id).toBe("research-legacy-tplus1-tplus2");
    expect(research.strategyPortfolioSnapshot).not.toBeNull();
    // 同一确定性输入下，生产核心与研究报告的核心统计完全一致（研究仅扩展研究段）。
    expect(research.totalSamples).toBe(core.totalSamples);
    expect(research.realisticSimulation.totalReturn).toBe(core.realisticSimulation.totalReturn);
  });

  it("TEST 9b asOf：FeatureSnapshot 与 signalTime 严格一致（decisionDate=D1/decisionPoint=close）", () => {
    // asOf 语义由 runFeaturePipeline 保证：D1 收盘构建快照，成交在 D2 开盘；
    // 引擎成交日期（D2）≠ 特征决策日（D1），证明信号在 D1 收盘产生、不读取 D1 之后信息。
    const { probe } = runProbe({});
    expect(probe.featureDates).toEqual([D1]);
    expect(probe.result.trades[0]!.entryTime).toBe(D2);
    expect(probe.result.trades[0]!.entryPrice).toBeGreaterThan(0);
  });

  it("Decision-time Regression（decisionPoint=open）：D1 open 决策不可见 D1 OHLCV，极端改写 D1 不改变决策", () => {
    const runOpen = (aD1Close: number) => {
      const records = sourceRecords();
      const rows = priceRows({ aD1Close });
      // 覆盖 A 的 D1 全部 OHLCV 为极端值；仅改动 D1 当日（未来于 D1 open 视角）。
      return runStrategyEngineBacktest({
        records,
        rawRows: rows,
        options: {
          strategyId: LEADER_CANDIDATE_PRODUCTION_STRATEGY_ID,
          strategyConfig: buildProductionLeaderCandidateStrategyConfig(baseOptions),
          decisionPoint: "open",
          features: [{ id: "limitUpHit" }],
          requestedQuantity: 100,
          initialCapital: 100_000,
          maxPositions: 5,
          tradingDates: CALENDAR,
          cost: { commissionRate: 0.0003, stampDutyRate: 0.0005, transferFeeRate: 0.00001, slippageBps: 10, lotSize: 100, minCommission: 5 },
        },
      });
    };
    const normal = runOpen(11.0);
    const extreme = runOpen(50.0); // D1 收盘改为不可思议的极端值

    // D1 open 时点特征不可见 D1 当日 bar：两种 D1 行情得到完全一致的决策/成交。
    expect(extreme.decisionLog).toEqual(normal.decisionLog);
    expect(extreme.result.trades).toEqual(normal.result.trades);
    expect(extreme.confirmedSymbols).toEqual(normal.confirmedSymbols);
    // open 时点不会用当日收盘涨停来确认候选（若渗漏，A 会在 extreme 下被「确认」）。
    expect(extreme.decisionLog).toHaveLength(0);
  });
});
