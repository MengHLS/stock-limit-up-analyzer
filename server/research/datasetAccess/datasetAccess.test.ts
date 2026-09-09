/**
 * STEP 13 / C-13.1 — Research Dataset 访问层测试（纯内存 fixture，无 DB）。
 *
 * 覆盖（对应任务验收）：
 *   (a) universe 视图逐日成员正确、缺失日期 / 非交易日 FAIL FAST；
 *   (b) date range 闭区间切片边界正确；
 *   (c) row → ResearchSecurityData/bars 映射字段正确、null 透传、逐证券全窗口升序；
 *   (d) ExperimentConfig.datasetVersion 与句柄不一致时 throw（版本可追溯）；
 *   (e) 确定性：同输入两次结果深比较相等（句柄绑定快照 / universe / 切片）；
 *   (f) PIT 不变量断言（asOf === tradeDate，绑定期与行映射入口双层防守）；
 *   (g) 集成：dataset 背书的 universe + dataSource 直接喂 framework pipeline，
 *       逐日 PIT 行映射后无未来 bar 泄漏（close 决策看当日、open 决策只用昨日）。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../data";
import { RESEARCH_DATASET_BUILDER_VERSION, RESEARCH_DATASET_ROW_SCHEMA_VERSION } from "../../researchDataset/types";
import type {
  DataSnapshot,
  ResearchDataset,
  ResearchDatasetRow,
  UniverseDayResult,
} from "../../researchDataset/types";
import type { CostModel } from "../../engine/domain";
import {
  makeBarFeatureProvider,
  makeWeightedSignalBuilder,
  runResearchPipeline,
  sameDayAvailability,
  type DecisionTime,
  type ExperimentConfig,
  type StrategyContract,
} from "../framework";
import {
  bindResearchDataset,
  createDatasetDataSource,
  createDatasetSession,
  createDatasetUniverseProvider,
  deriveDatasetUniverseId,
  rowToCanonicalBar,
  serializeDatasetHandle,
  sliceRowsByDateRange,
  snapshotDatasetHandle,
  DATASET_ROW_DOMAINS,
} from "./index";

// ---------------------------------------------------------------------------
// Fixture：4 个交易日（2026-01-04 周日为非交易日，D1~D3 为交易日）
// ---------------------------------------------------------------------------

const SUNDAY = "2026-01-04"; // 周日，窗口内非交易日（universe 决议记录 isTradingDay=false）
const D1 = "2026-01-05";
const D2 = "2026-01-06";
const D3 = "2026-01-07";

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

const ROW_SPECS: ReadonlyArray<{ date: string; id: string; close: number; preClose: number }> = [
  { date: D1, id: "A", close: 10, preClose: 9.5 },
  { date: D1, id: "B", close: 20, preClose: 19.5 },
  { date: D1, id: "C", close: 30, preClose: 29.5 },
  { date: D2, id: "A", close: 11, preClose: 10 },
  { date: D2, id: "B", close: 19, preClose: 20 },
  { date: D2, id: "D", close: 5, preClose: 4.8 },
  { date: D3, id: "A", close: 12, preClose: 11 },
  { date: D3, id: "B", close: 21, preClose: 19 },
];

function makeRow(spec: (typeof ROW_SPECS)[number]): ResearchDatasetRow {
  const { date, id, close, preClose } = spec;
  return {
    tradeDate: date,
    asOf: date,
    securityId: id,
    code: `${id}.SH`,
    securityType: "stock",
    exchange: "SH",
    lifecycleVerdict: "LISTED",
    eligible: true,
    exclusionReason: null,
    st: "NORMAL",
    industryCode: "801780",
    industryName: "测试行业",
    turnoverRate: 2.5,
    circulationMarketCap: 1_000_000_000,
    totalMarketCap: 1_200_000_000,
    liquidityAmount: 500_000,
    liquidityVolume: 100_000,
    open: preClose,
    high: close + 0.5,
    low: close - 0.5,
    close,
    preClose,
    volume: 100_000,
    amount: 500_000,
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

function makeUniverseDays(): UniverseDayResult[] {
  return [
    { tradeDate: SUNDAY, isTradingDay: false, members: [], excludedByReason: {} },
    { tradeDate: D1, isTradingDay: true, members: ["A", "B", "C"], excludedByReason: {} },
    { tradeDate: D2, isTradingDay: true, members: ["A", "B", "D"], excludedByReason: {} },
    { tradeDate: D3, isTradingDay: true, members: ["A", "B"], excludedByReason: {} },
  ];
}

function makeSnapshot(): DataSnapshot {
  return {
    capturedAt: "2026-01-07T00:00:00.000Z",
    request: {
      name: "test-universe-tradable-daily",
      startDate: SUNDAY,
      endDate: D3,
      asOfPerTradeDate: true,
      asOf: null,
      coreIndexCodes: ["000300.SH"],
    },
    calendarName: "cn-stock",
    calendarFirstDate: SUNDAY,
    calendarLastDate: D3,
    tradingDays: 3,
    domains: [],
    coverageGaps: [],
  };
}

function makeDataset(): ResearchDataset {
  return {
    datasetVersion: "test-dataset-v1",
    universeDefinition: { rule: "test", asOfDescription: "PIT per tradeDate", days: makeUniverseDays() },
    policySet: [],
    dataSnapshot: makeSnapshot(),
    rows: ROW_SPECS.map((s) => makeRow(s)),
    gate: "PASS",
    gateNotes: [],
  };
}

/** 构造已绑定句柄（多数用例的直接输入）。 */
function makeHandle() {
  return bindResearchDataset(makeDataset());
}

function makeConfig(overrides: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return {
    datasetVersion: "test-dataset-v1",
    strategyId: "test-strategy",
    strategyVersion: "1.0.0",
    parameters: { topN: 2 },
    universe: { universeId: deriveDatasetUniverseId("test-dataset-v1") },
    dateRange: { startDate: D1, endDate: D3 },
    costModel: COST_MODEL,
    randomSeed: 7,
    ...overrides,
  };
}

function makeStrategy(): StrategyContract {
  return {
    strategyId: "test-strategy",
    strategyVersion: "1.0.0",
    name: "数据集访问层集成测试策略",
    description: "仅用于 C-13.1 测试。",
    parameters: { parameters: [{ name: "topN", type: "number", required: true, min: 1 }] },
    requiredData: ["OHLCV"],
    signalFrequency: "daily",
  };
}

// ---------------------------------------------------------------------------
// (f) PIT 不变量 + (a/b) 相关 fixture 复用：脏行 / 未排序
// ---------------------------------------------------------------------------

function withDirtyRow(dataset: ResearchDataset, atDate: string, securityId: string, dirtyAsOf: string): ResearchDataset {
  const rows = dataset.rows.map((row) =>
    row.tradeDate === atDate && row.securityId === securityId ? { ...row, asOf: dirtyAsOf } : row,
  );
  return { ...dataset, rows };
}

// ---------------------------------------------------------------------------
// DatasetHandle 绑定与不变量
// ---------------------------------------------------------------------------

describe("DatasetHandle 绑定", () => {
  it("绑定成功：携带 datasetVersion / builder / rowSchema / universeId / 摘要", () => {
    const handle = makeHandle();
    expect(handle.datasetVersion).toBe("test-dataset-v1");
    expect(handle.builderVersion).toBe(RESEARCH_DATASET_BUILDER_VERSION);
    expect(handle.rowSchemaVersion).toBe(RESEARCH_DATASET_ROW_SCHEMA_VERSION);
    expect(handle.universeId).toBe(deriveDatasetUniverseId("test-dataset-v1"));
    expect(handle.gate).toBe("PASS");
    expect(handle.rowCount).toBe(ROW_SPECS.length);
    expect(handle.universeDayCount).toBe(4);
    expect(handle.startDate).toBe(SUNDAY);
    expect(handle.endDate).toBe(D3);
  });

  it("datasetVersion 为空时 FAIL FAST（禁止绑定无指纹数据集）", () => {
    expect(() => bindResearchDataset({ ...makeDataset(), datasetVersion: "  " })).toThrow(/datasetVersion 不能为空/);
  });

  it("脏行（asOf != tradeDate）在绑定期被拒绝 —— PIT 不变量（f）", () => {
    const dirty = withDirtyRow(makeDataset(), D2, "A", D3); // 把 D2 的行污染为带 D3 知识
    expect(() => bindResearchDataset(dirty)).toThrow(/逐日 PIT 决议约束/);
  });

  it("rows 未按 (tradeDate, securityId) 升序时 FAIL FAST（确定性守卫）", () => {
    const dataset = makeDataset();
    expect(() => bindResearchDataset({ ...dataset, rows: [...dataset.rows].reverse() })).toThrow(/升序确定性排序/);
  });
});

// ---------------------------------------------------------------------------
// Universe 视图（a）
// ---------------------------------------------------------------------------

describe("Dataset Universe 视图", () => {
  it("逐日返回 PIT 决议成员（a）", () => {
    const universe = createDatasetUniverseProvider(makeHandle());
    expect(universe.universeId).toBe(deriveDatasetUniverseId("test-dataset-v1"));
    expect(universe.getUniverse(D1)).toEqual(["A", "B", "C"]);
    expect(universe.getUniverse(D2)).toEqual(["A", "B", "D"]);
    expect(universe.getUniverse(D3)).toEqual(["A", "B"]);
  });

  it("缺失日期（窗口外）FAIL FAST，不回退当前列表（a）", () => {
    const universe = createDatasetUniverseProvider(makeHandle());
    expect(() => universe.getUniverse("2026-02-01")).toThrow(/禁止回退到当前股票列表/);
  });

  it("决议中标记为非交易日的日期 FAIL FAST（a）", () => {
    const universe = createDatasetUniverseProvider(makeHandle());
    expect(() => universe.getUniverse(SUNDAY)).toThrow(/非交易日/);
  });

  it("确定性：两次查询返回同内容（e）", () => {
    const universe = createDatasetUniverseProvider(makeHandle());
    expect(universe.getUniverse(D2)).toEqual(universe.getUniverse(D2));
  });
});

// ---------------------------------------------------------------------------
// Date range 闭区间切片（b）
// ---------------------------------------------------------------------------

describe("日期范围切片（闭区间）", () => {
  it("全窗口 [start,end] 命中全部行", () => {
    const rows = sliceRowsByDateRange(makeHandle().rows, { start: D1, end: D3 });
    expect(rows).toHaveLength(ROW_SPECS.length);
  });

  it("单日区间 [D2,D2] 只返回该日行（两端点含）", () => {
    const rows = sliceRowsByDateRange(makeHandle().rows, { start: D2, end: D2 });
    expect(rows.map((r) => r.securityId).sort()).toEqual(["A", "B", "D"]);
    expect(rows.every((r) => r.tradeDate === D2)).toBe(true);
  });

  it("边界包含：区间 [D1,D2] 含 D1 首行与 D2 末行、不含 D3（b）", () => {
    const rows = sliceRowsByDateRange(makeHandle().rows, { start: D1, end: D2 });
    const keys = rows.map((r) => `${r.tradeDate}:${r.securityId}`);
    expect(keys[0]).toBe(`${D1}:A`);
    expect(keys).toContain(`${D2}:D`);
    expect(keys).not.toContain(`${D3}:A`);
    expect(keys).toHaveLength(6);
  });

  it("无命中日期返回空数组（合法，不抛错）", () => {
    expect(sliceRowsByDateRange(makeHandle().rows, { start: "2026-02-01", end: "2026-02-02" })).toEqual([]);
  });

  it("倒序 / 非法日期范围 FAIL FAST（b）", () => {
    const rows = makeHandle().rows;
    expect(() => sliceRowsByDateRange(rows, { start: D3, end: D1 })).toThrow(/晚于|不能/);
    expect(() => sliceRowsByDateRange(rows, { start: "not-a-date", end: D1 })).toThrow();
  });

  it("确定性：同区间两次切片深比较相等（e）", () => {
    const handle = makeHandle();
    expect(sliceRowsByDateRange(handle.rows, { start: D2, end: D3 })).toEqual(
      sliceRowsByDateRange(handle.rows, { start: D2, end: D3 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Row → CanonicalMarketBar 映射与 DataSource（c）
// ---------------------------------------------------------------------------

describe("Row → Bar 映射", () => {
  it("字段映射正确：symbol=securityId / timestamp=tradeDate / OHLCV / adjustment=raw（c）", () => {
    const row = makeRow({ date: D2, id: "A", close: 11, preClose: 10 });
    const bar = rowToCanonicalBar(row);
    expect(bar.symbol).toBe("A");
    expect(bar.timestamp).toBe(D2);
    expect(bar.open).toBe(10);
    expect(bar.high).toBe(11.5);
    expect(bar.low).toBe(10.5);
    expect(bar.close).toBe(11);
    expect(bar.preClose).toBe(10);
    expect(bar.volume).toBe(100_000);
    expect(bar.amount).toBe(500_000);
    expect(bar.turnoverRate).toBe(2.5);
    expect(bar.adjustment).toBe("raw");
  });

  it("null 原样透传（禁止填零）且不污染其它字段（c）", () => {
    const row = makeRow({ date: D1, id: "C", close: 30, preClose: 29.5 });
    const partial = {
      ...row,
      open: null,
      high: null,
      low: null,
      close: null,
      preClose: null,
      volume: null,
      amount: null,
      turnoverRate: null,
      code: null,
    };
    const bar = rowToCanonicalBar(partial);
    expect(bar.close).toBeNull();
    expect(bar.turnoverRate).toBeNull();
    expect(bar.symbol).toBe("C");
    expect(bar.adjustment).toBe("raw");
  });

  it("脏行直接喂映射入口同样被拒（PIT 不变量第二道防线，f）", () => {
    const row = makeRow({ date: D2, id: "A", close: 11, preClose: 10 });
    expect(() => rowToCanonicalBar({ ...row, asOf: D3 })).toThrow(/逐日 PIT 决议约束/);
  });

  it("dataSource.getBars：逐证券全窗口升序 bars；未知证券返回 null（c）", () => {
    const source = createDatasetDataSource(makeHandle());
    expect(source.getBars("X")).toBeNull();
    const bars = source.getBars("A") as readonly CanonicalMarketBar[];
    expect(bars).not.toBeNull();
    expect(bars.map((b) => b.timestamp)).toEqual([D1, D2, D3]);
    expect(bars.map((b) => b.close)).toEqual([10, 11, 12]);
  });

  it("dataSource.availableData 覆盖宽行结构域（含 OHLCV / Turnover / Industry）", () => {
    const source = createDatasetDataSource(makeHandle());
    for (const domain of DATASET_ROW_DOMAINS) expect(source.availableData).toContain(domain);
    expect(source.availableData).toContain("OHLCV");
  });
});

// ---------------------------------------------------------------------------
// Session：datasetVersion 一致性与日期窗口（d）
// ---------------------------------------------------------------------------

describe("DatasetSession", () => {
  it("版本与日期窗口一致时成功：产出 rows 切片 / universe / dataSource", () => {
    const session = createDatasetSession(makeDataset(), makeConfig());
    expect(session.handle.datasetVersion).toBe("test-dataset-v1");
    expect(session.rows).toHaveLength(ROW_SPECS.length);
    expect(session.universe.getUniverse(D2)).toEqual(["A", "B", "D"]);
    expect(session.dataSource.getBars("A")).toHaveLength(3);
  });

  it("datasetVersion 不一致时 FAIL FAST（d，版本可追溯）", () => {
    const config = makeConfig({ datasetVersion: "test-dataset-v2" });
    expect(() => createDatasetSession(makeDataset(), config)).toThrow(/不一致/);
  });

  it("日期范围越界（闭区间超出数据集窗口）FAIL FAST", () => {
    const config = makeConfig({ dateRange: { startDate: D1, endDate: "2026-01-08" } });
    expect(() => createDatasetSession(makeDataset(), config)).toThrow(/超出数据集窗口/);
  });

  it("universeId 与数据集派生 id 不一致时 FAIL FAST（防串用版本）", () => {
    const config = makeConfig({ universe: { universeId: "another-universe" } });
    expect(() => createDatasetSession(makeDataset(), config)).toThrow(/universeId/);
  });
});

// ---------------------------------------------------------------------------
// 确定性（e）：绑定快照 / 序列化
// ---------------------------------------------------------------------------

describe("确定性（绑定快照与序列化）", () => {
  it("同内容两次独立绑定 → 同一序列化串；同句柄两次序列化相等（e）", () => {
    const a = makeHandle();
    const b = makeHandle();
    expect(serializeDatasetHandle(a)).toBe(serializeDatasetHandle(b));
    expect(serializeDatasetHandle(a)).toBe(serializeDatasetHandle(a));
  });

  it("快照稳定字段：tradingDayDates 升序、securityIds 去重升序、window 摘要", () => {
    const snap = snapshotDatasetHandle(makeHandle());
    expect(snap.datasetVersion).toBe("test-dataset-v1");
    expect(snap.builderVersion).toBe(RESEARCH_DATASET_BUILDER_VERSION);
    expect(snap.tradingDayDates).toEqual([D1, D2, D3]);
    expect(snap.securityIds).toEqual(["A", "B", "C", "D"]);
    expect(snap.startDate).toBe(SUNDAY);
    expect(snap.endDate).toBe(D3);
  });
});

// ---------------------------------------------------------------------------
// 集成（g）：dataset 背书输入直喂 framework pipeline，无未来 bar 泄漏
// ---------------------------------------------------------------------------

describe("Research Pipeline 集成（dataset 背书输入）", () => {
  const session = createDatasetSession(makeDataset(), makeConfig());
  const strategy = makeStrategy();

  it("close 决策：特征用当日及以前行，D3 的未来 close 不泄漏", () => {
    const decisionTime: DecisionTime = { date: D2, point: "close" };
    const feature = makeBarFeatureProvider({
      featureId: "lastClose",
      version: "1.0.0",
      availability: sameDayAvailability(decisionTime, "close", "close"),
      compute: (bars) => (bars.length > 0 ? (bars[bars.length - 1]!.close) : null),
    });
    const result = runResearchPipeline({
      strategy,
      config: session.config,
      decisionTime,
      universe: session.universe,
      featureProviders: [feature],
      signalBuilder: makeWeightedSignalBuilder({ lastClose: 1 }),
      rankingConfig: { higherIsBetter: true },
      selectionConfig: { method: { kind: "topN", n: 3 } },
      dataSource: session.dataSource,
    });
    // D2 close：A=11、B=19、D=5；A 的 close 绝不可能是 D3 的 12。
    expect(result.signals.map((s) => s.securityId).sort()).toEqual(["A", "B", "D"]);
    expect(result.signals.find((s) => s.securityId === "A")!.value).toBeCloseTo(11, 10);
    expect(result.signals.find((s) => s.securityId === "D")!.value).toBeCloseTo(5, 10);
    expect(result.dropped).toEqual([]);
  });

  it("open 决策：当日 full bar 不可见，特征只用昨日收盘（D2 的 11 不泄漏）", () => {
    const decisionTime: DecisionTime = { date: D2, point: "open" };
    const feature = makeBarFeatureProvider({
      featureId: "prevClose",
      version: "1.0.0",
      availability: {
        requiredDataThrough: { date: D1, point: "close" },
        availableAt: { date: D2, point: "open" },
      },
      compute: (bars) => (bars.length > 0 ? (bars[bars.length - 1]!.close) : null),
    });
    const result = runResearchPipeline({
      strategy,
      config: session.config,
      decisionTime,
      universe: session.universe,
      featureProviders: [feature],
      signalBuilder: makeWeightedSignalBuilder({ prevClose: 1 }),
      rankingConfig: { higherIsBetter: true },
      selectionConfig: { method: { kind: "topN", n: 3 } },
      dataSource: session.dataSource,
    });
    // open(D2)：A 只能看到 D1 close=10；B 看到 D1 close=20；D 无 D1 前历史 → 特征不足剔除。
    expect(result.signals.find((s) => s.securityId === "A")!.value).toBeCloseTo(10, 10);
    expect(result.signals.find((s) => s.securityId === "B")!.value).toBeCloseTo(20, 10);
    expect(result.signals.find((s) => s.securityId === "A")!.value).not.toBeCloseTo(11, 10);
    expect(result.dropped.some((d) => d.securityId === "D" && d.reason === "INSUFFICIENT_FEATURES")).toBe(true);
  });
});
