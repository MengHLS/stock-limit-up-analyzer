/**
 * STEP 14 / C-14.1 — 交易模拟核心测试（纯内存 fixture，无 DB）。
 *
 * 覆盖（对应任务验收）：
 *   (a) 端到端：dataset → 候选（C-13.2 runCandidateEngine）→ 交易模拟（本目录），
 *       验证 T+1 语义（T 日信号 → T+1 才成交，成交价来自执行模型而非信号日收盘）、
 *       涨跌停/停牌限制生效（构造被限制场景断言不成交或按规则处理）、
 *       T+1 卖出冻结顺延（当日买入不可当日卖出）；
 *   (b) 确定性：两次运行深比较相等，序列化串与 fingerprint 相同；
 *   (c) FAIL FAST：缺 (tradeDate, securityId) 行 / datasetVersion 不一致 / 决策时点
 *       非 close / 窗口为空 / 非法输入，一律抛错不静默；
 *   (d) round-trip 序列化 + 指纹完整性校验（防篡改）；
 *   (e) 禁止裸 next-close 直通：NEXT_OPEN 与 NEXT_CLOSE 成交价都等于「T+1 当日」的
 *       对应执行价，绝不等于决策日收盘。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../data";
import type { CostModel } from "../../engine/domain";
import {
  RESEARCH_DATASET_BUILDER_VERSION,
  RESEARCH_DATASET_ROW_SCHEMA_VERSION,
  type DataSnapshot,
  type ResearchDataset,
  type ResearchDatasetRow,
  type UniverseDayResult,
} from "../../researchDataset/types";
import type { CandidateEvaluationRun } from "../signalEngine";
import {
  computeCandidateEvaluationRunFingerprint,
  runCandidateEngine,
} from "../signalEngine";
import { deriveDatasetUniverseId } from "../datasetAccess/handle";
import {
  makeBarFeatureProvider,
  makeWeightedSignalBuilder,
  type ExperimentConfig,
  type StrategyContract,
} from "../framework";
import {
  deserializeTradeSimulationRun,
  runTradeSimulation,
  serializeTradeSimulationRun,
  type SimulationConfig,
  type TradeSimulationRun,
} from "./index";

// ---------------------------------------------------------------------------
// 常量与基础 fixture 构建
// ---------------------------------------------------------------------------

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 5,
};

/** 种子：一行 bar 的最少字段（其余按默认值填充）。 */
interface SeedSpec {
  date: string;
  sec: string;
  open: number;
  close: number;
  preClose: number;
}

function makeRow(seed: SeedSpec): ResearchDatasetRow {
  const high = Math.max(seed.open, seed.close) + 0.05;
  const low = Math.min(seed.open, seed.close) - 0.05;
  const close = seed.close;
  return {
    tradeDate: seed.date,
    asOf: seed.date,
    securityId: seed.sec,
    code: `${seed.sec}.SH`,
    securityType: "stock",
    exchange: "SH",
    lifecycleVerdict: "LISTED",
    eligible: true,
    exclusionReason: null,
    st: "NORMAL",
    industryCode: "801780",
    industryName: "测试行业",
    turnoverRate: 2.5,
    circulationMarketCap: 2_000_000_000,
    totalMarketCap: 2_400_000_000,
    liquidityAmount: 800_000,
    liquidityVolume: 160_000,
    open: seed.open,
    high,
    low,
    close,
    preClose: seed.preClose,
    volume: 100_000,
    // 成交额足够大（≥ 2,000,000 千元），使 amountAdjustedSlippageBps 分层加成 = 0（保持 fixture 零滑点，便于断言执行价 = 基准价）。
    amount: 5_000_000,
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,
    indexClose: { "000300.SH": 4000 },
    knowledge: {
      policy: "PIT",
      listing: "KNOWN",
      delisting: "KNOWN",
      tradability: "KNOWN",
      industry: "KNOWN",
      liquidity: "KNOWN",
      price: "KNOWN",
      corporateActions: "KNOWN",
      marketState: "KNOWN",
    },
  };
}

interface BuiltDataset {
  readonly dataset: ResearchDataset;
  /** 逐日成员（date → 升序 securityId），只含在 rows 中出现的证券。 */
  readonly membersByDate: ReadonlyMap<string, readonly string[]>;
  readonly dates: readonly string[];
}

/** 由种子构建数据集；窗口 = 种子日期 min..max；成员 = 当日有行的证券。 */
function buildDataset(
  specs: readonly SeedSpec[],
  datasetVersion: string
): BuiltDataset {
  const sorted = specs
    .slice()
    .sort((a, b) =>
      a.date !== b.date
        ? a.date.localeCompare(b.date)
        : a.sec.localeCompare(b.sec)
    );
  const rows = sorted.map(seed => makeRow(seed));
  const dateOrder = Array.from(new Set(sorted.map(s => s.date))).sort();
  const membersByDate = new Map<string, string[]>();
  for (const date of dateOrder) {
    const secs = sorted.filter(s => s.date === date).map(s => s.sec);
    membersByDate.set(date, secs);
  }
  const universeDays: UniverseDayResult[] = dateOrder.map(date => ({
    tradeDate: date,
    isTradingDay: true,
    members: membersByDate.get(date)!.slice(),
    excludedByReason: {},
  }));
  const snapshot: DataSnapshot = {
    capturedAt: "2026-01-01T00:00:00.000Z",
    request: {
      name: "simulator-test-daily",
      startDate: dateOrder[0]!,
      endDate: dateOrder[dateOrder.length - 1]!,
      asOfPerTradeDate: true,
      asOf: null,
      coreIndexCodes: ["000300.SH"],
    },
    calendarName: "cn-stock",
    calendarFirstDate: dateOrder[0]!,
    calendarLastDate: dateOrder[dateOrder.length - 1]!,
    tradingDays: dateOrder.length,
    domains: [],
    coverageGaps: [],
  };
  const dataset: ResearchDataset = {
    datasetVersion,
    universeDefinition: {
      rule: "test",
      asOfDescription: "PIT per tradeDate",
      days: universeDays,
    },
    policySet: [],
    dataSnapshot: snapshot,
    rows,
    gate: "PASS",
    gateNotes: [],
  };
  return { dataset, membersByDate, dates: dateOrder };
}

function makeStrategy(topN: number): StrategyContract {
  return {
    strategyId: "test-strategy",
    strategyVersion: "1.0.0",
    name: "C-14.1 交易模拟测试策略",
    description: "仅用于 simulator 测试。",
    parameters: {
      parameters: [{ name: "topN", type: "number", required: true, min: 1 }],
    },
    requiredData: ["OHLCV"],
    signalFrequency: "daily",
  };
}

function makeExperimentConfig(
  datasetVersion: string,
  startDate: string,
  endDate: string,
  topN: number
): ExperimentConfig {
  return {
    datasetVersion,
    strategyId: "test-strategy",
    strategyVersion: "1.0.0",
    parameters: { topN },
    universe: { universeId: deriveDatasetUniverseId(datasetVersion) },
    dateRange: { startDate, endDate },
    costModel: COST,
    randomSeed: 7,
  };
}

/** 运行候选引擎（C-13.2），产出本目录的输入。 */
function runCandidates(
  built: BuiltDataset,
  datasetVersion: string,
  decisionStart: string,
  decisionEnd: string,
  topN: number
): CandidateEvaluationRun {
  const pctChange = makeBarFeatureProvider({
    featureId: "pctChange",
    version: "1.0.0",
    availability: {
      requiredDataThrough: { date: decisionStart, point: "close" },
      availableAt: { date: decisionStart, point: "close" },
    },
    compute: (bars: readonly CanonicalMarketBar[]) => {
      const last = bars[bars.length - 1];
      if (
        last === undefined ||
        last.close === null ||
        last.preClose === null ||
        last.preClose === 0
      )
        return null;
      return last.close / last.preClose - 1;
    },
  });
  return runCandidateEngine({
    dataset: built.dataset,
    config: makeExperimentConfig(
      datasetVersion,
      decisionStart,
      decisionEnd,
      topN
    ),
    strategy: makeStrategy(topN),
    strategy13: {
      point: "close",
      features: [pctChange],
      signalBuilder: makeWeightedSignalBuilder({ pctChange: 1 }),
      rankingConfig: { higherIsBetter: true },
      selectionConfig: { method: { kind: "topN", n: topN } },
      signalDescription: "按日涨跌幅择优（long-only 候选研究）",
    },
  });
}

function makeSimConfig(
  overrides: Partial<SimulationConfig> = {}
): SimulationConfig {
  return {
    initialCapital: 100_000,
    cost: COST,
    ...overrides,
  };
}

const pctOf = (close: number, preClose: number): number => close / preClose - 1;

// ---------------------------------------------------------------------------
// 测试日期窗口
// ---------------------------------------------------------------------------
const E1 = "2026-01-05";
const E2 = "2026-01-06";
const E3 = "2026-01-07";
const R1 = "2026-02-02";
const R2 = "2026-02-03";
const R3 = "2026-02-04";
const R4 = "2026-02-05";
const S1 = "2026-03-02";
const S2 = "2026-03-03";
const L1 = "2026-04-06";
const L2 = "2026-04-07";

// ---------------------------------------------------------------------------
// (a) 端到端：T+1 执行语义 + 成交价来自执行模型
// ---------------------------------------------------------------------------

describe("端到端：候选 → 交易模拟（T+1 与执行模型）", () => {
  // 单标的窗口：决策日 E1（close=10.0）→ 执行日 E2（open=9.6 / close=9.5）。
  const seeds: readonly SeedSpec[] = [
    { date: E1, sec: "A", open: 9.9, close: 10.0, preClose: 9.5 },
    { date: E2, sec: "A", open: 9.6, close: 9.5, preClose: 10.0 },
  ];
  const VERSION = "sim-e2e-v1";

  function makeRun(
    executionModel: SimulationConfig["executionModel"]
  ): TradeSimulationRun {
    const built = buildDataset(seeds, VERSION);
    const candidate = runCandidates(built, VERSION, E1, E1, 1);
    // E1 决策选中 A（pct +5.26% > 0，方向 long）。
    expect(candidate.days[0]!.selected[0]!.securityId).toBe("A");
    return runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig: makeSimConfig({
        executionModel,
        dateRange: { startDate: E1, endDate: E2 },
      }),
    });
  }

  it("T 日信号 T+1 才成交；成交价 = T+1 开盘价而非信号日收盘（a/e, NEXT_OPEN）", () => {
    const run = makeRun("NEXT_OPEN");
    // 权益曲线只含两个交易日；D1（决策日）无成交。
    expect(run.equityCurve.map(p => p.date)).toEqual([E1, E2]);
    expect(run.equityCurve[0]!.equity).toBeCloseTo(100_000, 6);
    // 成交记录只有 1 笔，发生在 E2。
    expect(run.executionStats.totalFills).toBe(1);
    expect(run.executionStats.totalSignals).toBe(1);
    expect(run.executionStats.totalOrders).toBe(1);
    expect(run.audit.fills).toHaveLength(1);
    const fill = run.audit.fills[0]!;
    expect(fill.timestamp).toBe(E2); // T+1 才成交
    expect(fill.side).toBe("buy");
    expect(fill.basePrice).toBeCloseTo(9.6, 10); // E2 开盘价
    expect(fill.basePrice).not.toBeCloseTo(10.0, 10); // ≠ 决策日 E1 收盘价
    expect(fill.quantity).toBe(9900); // 预算全仓买入（决策日收盘价 10.0 估量）
    // 期末持仓标记 T+1：买入当日（E2）份额冻结不可卖。
    const openPos = run.positions.find(p => p.securityId === "A")!;
    expect(openPos.quantity).toBe(9900);
    expect(openPos.availableQuantity).toBe(0);
    expect(openPos.frozenQuantity).toBe(9900);
    // Trade 生命周期：E2 建仓，期末仍持仓（openAtEnd）。
    const trade = run.trades.find(t => t.securityId === "A")!;
    expect(trade.entryTime).toBe(E2);
    expect(trade.openAtEnd).toBe(true);
  });

  it("换 NEXT_CLOSE 后成交价 = T+1 收盘价（同样非决策日收盘，e）", () => {
    const run = makeRun("NEXT_CLOSE");
    expect(run.executionStats.totalFills).toBe(1);
    const fill = run.audit.fills[0]!;
    expect(fill.timestamp).toBe(E2);
    expect(fill.basePrice).toBeCloseTo(9.5, 10); // E2 收盘价
    expect(fill.basePrice).not.toBeCloseTo(10.0, 10); // ≠ 决策日 E1 收盘价
  });

  it("结果记录可审计追溯：datasetVersion/strategyId/params/执行假设快照（a）", () => {
    const run = makeRun("NEXT_OPEN");
    expect(run.recordKind).toBe("TRADE_SIMULATION_RUN");
    expect(run.recordVersion).toBe(1);
    expect(run.datasetVersion).toBe(VERSION);
    expect(run.builderVersion).toBe(RESEARCH_DATASET_BUILDER_VERSION);
    expect(run.rowSchemaVersion).toBe(RESEARCH_DATASET_ROW_SCHEMA_VERSION);
    expect(run.strategyId).toBe("test-strategy");
    expect(run.strategyVersion).toBe("1.0.0");
    expect(run.parameters).toEqual({ topN: 1 });
    expect(run.dateRange).toEqual({ startDate: E1, endDate: E2 });
    expect(run.decisionDateRange).toEqual({ startDate: E1, endDate: E1 });
    expect(run.decisionDayCount).toBe(1);
    expect(run.initialCapital).toBe(100_000);
    expect(run.config.executionModel).toBe("NEXT_OPEN");
    expect(run.config.tPlus1).toBe(true);
    expect(run.config.lotSize).toBe(100);
    expect(run.config.entryExitModel).toBe(
      "HOLD_WHILE_SELECTED_LONG_ONLY_CASH_BUDGET"
    );
    expect(run.config.corporateActions).toBe("NOT_APPLIED");
    expect(typeof run.sourceFingerprint).toBe("string");
    expect(typeof run.fingerprint).toBe("string");
    expect(run.fingerprint.length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// (a2) 持仓切换与 T+1 卖出冻结顺延
// ---------------------------------------------------------------------------

describe("T+1 卖出冻结顺延与清仓生命周期", () => {
  // R1~R4，两标的，topN=1：R1 选 A → 买入 A（R2 开盘成交）；
  // R2/R3/R4 选 B → A 不再入选：R2 收盘 A 仍冻结 → 卖出顺延；R3 收盘 A 可卖 → R4 开盘清仓。
  const seeds: readonly SeedSpec[] = [
    { date: R1, sec: "A", open: 10.4, close: 10.5, preClose: 10.0 },
    { date: R1, sec: "B", open: 10.1, close: 10.2, preClose: 10.0 },
    { date: R2, sec: "A", open: 10.5, close: 10.6, preClose: 10.5 },
    { date: R2, sec: "B", open: 10.4, close: 10.9, preClose: 10.2 },
    { date: R3, sec: "A", open: 10.5, close: 10.1, preClose: 10.6 },
    { date: R3, sec: "B", open: 10.85, close: 11.0, preClose: 10.9 },
    { date: R4, sec: "A", open: 10.0, close: 9.9, preClose: 10.1 },
    { date: R4, sec: "B", open: 11.0, close: 11.2, preClose: 11.0 },
  ];
  const VERSION = "sim-rotate-v1";

  it("入选 A→B 切换：A 在 R2 收盘因 T+1 冻结顺延，R3 收盘才可卖，R4 开盘清仓", () => {
    const built = buildDataset(seeds, VERSION);
    const candidate = runCandidates(built, VERSION, R1, R4, 1);
    // 决策序列：R1=A、R2=B、R3=B、R4=B（按 pct 最大值）。
    expect(candidate.days.map(d => d.selected[0]!.securityId)).toEqual([
      "A",
      "B",
      "B",
      "B",
    ]);
    // A 在所有决策日 pct 为正（方向 long）——选中日在候选集合中，未选中日出现在当日 rows。
    const run = runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig: makeSimConfig({ initialCapital: 1_000_000 }),
    });

    // A 的买入成交在 R2 开盘（决策 R1）。
    const buyFillA = run.audit.fills.find(
      f => f.securityId === "A" && f.side === "buy"
    )!;
    expect(buyFillA.timestamp).toBe(R2);
    expect(buyFillA.quantity).toBe(95_200);

    // R2 收盘 A 掉出候选 → 可卖为 0（当日买入冻结）→ 计划层跳过并记录 FROZEN_EXIT_DEFERRED。
    const frozenSkip = run.skipped.find(
      s => s.date === R2 && s.securityId === "A"
    );
    expect(frozenSkip).toBeDefined();
    expect(frozenSkip!.side).toBe("sell");
    expect(frozenSkip!.code).toBe("FROZEN_EXIT_DEFERRED");

    // 卖出订单最早在 R3 收盘生成，R4 开盘成交清仓（没有更早的 A 卖出成交）。
    const sellFillsA = run.audit.fills.filter(
      f => f.securityId === "A" && f.side === "sell"
    );
    expect(sellFillsA).toHaveLength(1);
    expect(sellFillsA[0]!.timestamp).toBe(R4);
    expect(sellFillsA[0]!.quantity).toBe(95_200);

    // Trade 生命周期完整：E=建仓 R2，X=清仓 R4。
    const trade = run.trades.find(t => t.securityId === "A")!;
    expect(trade.entryTime).toBe(R2);
    expect(trade.exitTime).toBe(R4);
    expect(trade.openAtEnd).toBe(false);
    expect(trade.netPnl).not.toBeNull();
    // A 期末无持仓。
    expect(run.positions.find(p => p.securityId === "A")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (a3) 涨跌停 / 停牌限制生效
// ---------------------------------------------------------------------------

describe("涨跌停与停牌限制", () => {
  it("买入订单在次日开盘触及涨停 → LIMIT_UP 拒绝（不静默成交）", () => {
    // L1 决策选 B（pct +3% > A +1%）；L2 B 开盘 = 涨停价 11.0（preClose=10.0）。
    const seeds: readonly SeedSpec[] = [
      { date: L1, sec: "A", open: 10.0, close: 10.1, preClose: 10.0 },
      { date: L1, sec: "B", open: 9.9, close: 10.0, preClose: 9.7 },
      { date: L2, sec: "A", open: 10.0, close: 10.0, preClose: 10.1 },
      { date: L2, sec: "B", open: 11.0, close: 11.0, preClose: 10.0 },
    ];
    const VERSION = "sim-limit-v1";
    const built = buildDataset(seeds, VERSION);
    const candidate = runCandidates(built, VERSION, L1, L1, 1);
    expect(candidate.days[0]!.selected[0]!.securityId).toBe("B");

    const simConfig = makeSimConfig({
      initialCapital: 150_000,
      executionRules: { blockLimitUpBuy: true },
      dateRange: { startDate: L1, endDate: L2 },
    });
    const run = runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig,
    });
    expect(run.executionStats.totalFills).toBe(0);
    expect(run.executionStats.rejectedOrders).toBe(1);
    expect(run.executionStats.byReason.LIMIT_UP).toBe(1);
    const rejected = run.audit.orders.find(o => o.status === "REJECTED")!;
    expect(rejected.securityId).toBe("B");
    expect(rejected.rejectionReason).toBe("LIMIT_UP");
  });

  it("不拦截涨停 + 部分成交开启时，涨停开盘价可成交（价格=11.0，规则可配置）", () => {
    const seeds: readonly SeedSpec[] = [
      { date: L1, sec: "A", open: 10.0, close: 10.1, preClose: 10.0 },
      { date: L1, sec: "B", open: 9.9, close: 10.0, preClose: 9.7 },
      { date: L2, sec: "A", open: 10.0, close: 10.0, preClose: 10.1 },
      { date: L2, sec: "B", open: 11.0, close: 11.0, preClose: 10.0 },
    ];
    const VERSION = "sim-limit-v2";
    const built = buildDataset(seeds, VERSION);
    const candidate = runCandidates(built, VERSION, L1, L1, 1);
    const run = runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig: makeSimConfig({
        initialCapital: 150_000,
        executionRules: { blockLimitUpBuy: false },
        allowPartialFill: true,
        dateRange: { startDate: L1, endDate: L2 },
      }),
    });
    expect(run.executionStats.totalFills).toBe(1);
    const fill = run.audit.fills[0]!;
    expect(fill.side).toBe("buy");
    expect(fill.timestamp).toBe(L2);
    expect(fill.basePrice).toBeCloseTo(11.0, 10); // 涨停开盘价成交
    expect(fill.quantity).toBe(13_600); // 现金 150k 在 11.0 价最大可整手买入（部分成交）
  });

  it("买入订单在次日停牌（非 universe 成员、无行）→ SUSPENDED 拒绝", () => {
    // S1 决策选 B；S2 B 无行（停牌）。
    const seeds: readonly SeedSpec[] = [
      { date: S1, sec: "A", open: 10.0, close: 10.1, preClose: 10.0 },
      { date: S1, sec: "B", open: 9.9, close: 10.3, preClose: 10.0 },
      { date: S2, sec: "A", open: 10.0, close: 10.0, preClose: 10.1 },
    ];
    const VERSION = "sim-suspend-v1";
    const built = buildDataset(seeds, VERSION);
    const candidate = runCandidates(built, VERSION, S1, S1, 1);
    expect(candidate.days[0]!.selected[0]!.securityId).toBe("B");

    const run = runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig: makeSimConfig({ dateRange: { startDate: S1, endDate: S2 } }),
    });
    expect(run.executionStats.totalFills).toBe(0);
    expect(run.executionStats.rejectedOrders).toBe(1);
    expect(run.executionStats.byReason.SUSPENDED).toBe(1);
    const rejected = run.audit.orders.find(o => o.status === "REJECTED")!;
    expect(rejected.securityId).toBe("B");
    expect(rejected.rejectionReason).toBe("SUSPENDED");
  });
});

// ---------------------------------------------------------------------------
// (b) 确定性 + (d) 序列化
// ---------------------------------------------------------------------------

describe("确定性与序列化", () => {
  const seeds: readonly SeedSpec[] = [
    { date: E1, sec: "A", open: 9.9, close: 10.0, preClose: 9.5 },
    { date: E1, sec: "B", open: 19.9, close: 20.2, preClose: 19.5 },
    { date: E2, sec: "A", open: 10.1, close: 10.0, preClose: 10.0 },
    { date: E2, sec: "B", open: 20.0, close: 19.8, preClose: 20.2 },
    { date: E3, sec: "A", open: 10.0, close: 10.2, preClose: 10.0 },
    { date: E3, sec: "B", open: 19.9, close: 20.5, preClose: 19.8 },
  ];
  const VERSION = "sim-det-v1";

  function runOnce(): TradeSimulationRun {
    const built = buildDataset(seeds, VERSION);
    const candidate = runCandidates(built, VERSION, E1, E3, 2);
    return runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig: makeSimConfig(),
    });
  }

  it("两次独立运行深比较相等，序列化串与 fingerprint 相同（b）", () => {
    const first = runOnce();
    const second = runOnce();
    expect(second).toEqual(first);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(serializeTradeSimulationRun(second)).toBe(
      serializeTradeSimulationRun(first)
    );
  });

  it("记录整体与嵌套结构不可变（b）", () => {
    const run = runOnce();
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.equityCurve)).toBe(true);
    expect(Object.isFrozen(run.trades)).toBe(true);
    expect(Object.isFrozen(run.audit.orders)).toBe(true);
    expect(Object.isFrozen(run.config)).toBe(true);
  });

  it("round-trip：deserialize(serialize(r)) 与 r 深相等且串稳定（d）", () => {
    const run = runOnce();
    const restored = deserializeTradeSimulationRun(
      serializeTradeSimulationRun(run)
    );
    expect(restored).toEqual(run);
    expect(serializeTradeSimulationRun(restored)).toBe(
      serializeTradeSimulationRun(run)
    );
  });

  it("指纹完整性：篡改结果内容即拒绝（d）", () => {
    const json = serializeTradeSimulationRun(runOnce());
    const parsed = JSON.parse(json) as TradeSimulationRun;
    parsed.finalEquity = parsed.finalEquity + 123.45;
    expect(() => deserializeTradeSimulationRun(JSON.stringify(parsed))).toThrow(
      /指纹不匹配/
    );
  });
});

// ---------------------------------------------------------------------------
// (c) FAIL FAST
// ---------------------------------------------------------------------------

describe("FAIL FAST", () => {
  const seeds: readonly SeedSpec[] = [
    { date: S1, sec: "A", open: 10.0, close: 10.1, preClose: 10.0 },
    { date: S1, sec: "B", open: 9.9, close: 10.3, preClose: 10.0 },
    { date: S2, sec: "A", open: 10.0, close: 10.0, preClose: 10.1 },
    { date: S2, sec: "B", open: 10.1, close: 10.2, preClose: 10.3 },
  ];
  const VERSION = "sim-fail-v1";
  const built = buildDataset(seeds, VERSION);
  const candidate = runCandidates(built, VERSION, S1, S1, 1);

  it("datasetVersion 与来源候选记录不一致 → 拒绝（版本可追溯）", () => {
    const other = buildDataset(seeds, "sim-fail-v2");
    expect(() =>
      runTradeSimulation({
        dataset: other.dataset,
        sourceRun: candidate,
        simConfig: makeSimConfig(),
      })
    ).toThrow(/不一致/);
  });

  it("决策日候选 long 意图缺 (date, securityId) 行 → MissingSimulationRowError", () => {
    // 与候选记录同一 datasetVersion，但决策日 S1 的 B 行被剔除（模拟数据集被篡改）。
    const tamperedRows = built.dataset.rows.filter(
      row => !(row.tradeDate === S1 && row.securityId === "B")
    );
    const tampered: ResearchDataset = { ...built.dataset, rows: tamperedRows };
    try {
      runTradeSimulation({
        dataset: tampered,
        sourceRun: candidate,
        simConfig: makeSimConfig(),
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as { code?: string }).code).toBe("MISSING_DATASET_ROW");
      expect((error as Error).message).toContain(S1);
      expect((error as Error).message).toContain("B");
    }
  });

  it("决策时点非 close → 拒绝（交易模拟只支持收盘决策→次日执行）", () => {
    const tamperedRun = structuredClone(candidate) as CandidateEvaluationRun;
    (tamperedRun as { point: string }).point = "open";
    tamperedRun.fingerprint =
      computeCandidateEvaluationRunFingerprint(tamperedRun);
    expect(() =>
      runTradeSimulation({
        dataset: built.dataset,
        sourceRun: tamperedRun,
        simConfig: makeSimConfig(),
      })
    ).toThrow(/close/);
  });

  it("来源候选记录指纹不匹配 → 拒绝", () => {
    const tamperedRun = structuredClone(candidate) as CandidateEvaluationRun;
    tamperedRun.fingerprint =
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    expect(() =>
      runTradeSimulation({
        dataset: built.dataset,
        sourceRun: tamperedRun,
        simConfig: makeSimConfig(),
      })
    ).toThrow(/指纹不匹配/);
  });

  it("模拟窗口与候选决策日无交集 → EmptySimulationWindowError", () => {
    const farBuilt = buildDataset(seeds, VERSION);
    // 候选决策日在 S1；把模拟窗口放在 S2（候选记录无该日）。
    const cand = runCandidates(farBuilt, VERSION, S2, S2, 1);
    expect(() =>
      runTradeSimulation({
        dataset: built.dataset,
        sourceRun: cand,
        simConfig: makeSimConfig({ dateRange: { startDate: S1, endDate: S1 } }),
      })
    ).toThrow(/无交集/);
  });

  it("非法输入配置 → assertValidSimulationConfig 抛错", () => {
    const validCandidateInput = () => ({
      dataset: built.dataset,
      sourceRun: candidate,
    });
    expect(() =>
      runTradeSimulation({
        ...validCandidateInput(),
        simConfig: makeSimConfig({ initialCapital: 0 }),
      })
    ).toThrow(/initialCapital/);
    expect(() =>
      runTradeSimulation({
        ...validCandidateInput(),
        simConfig: makeSimConfig({ cost: { ...COST, slippageBps: -1 } }),
      })
    ).toThrow(/不能为负/);
    expect(() =>
      runTradeSimulation({
        ...validCandidateInput(),
        simConfig: makeSimConfig({ executionModel: "NOT_A_MODEL" as never }),
      })
    ).toThrow(/executionModel/);
  });
});
