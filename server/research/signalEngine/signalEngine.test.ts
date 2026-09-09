/**
 * STEP 13 / C-13.2 — Signal 与 Candidate 框架测试（纯内存 fixture，无 DB）。
 *
 * 覆盖（对应任务验收）：
 *   (a) 多日驱动正确性：逐决策日 universe 成员 / 候选数 / 选中名单符合预期，记录带
 *       datasetVersion / dateRange / featureVersions / 参数集等审计字段；
 *   (b) 确定性：两次运行深比较相等，序列化串与 fingerprint 相同；
 *   (c) FAIL FAST：缺行（universe 成员当日无行）/ datasetVersion 不一致 / 窗口内无交易日 /
 *       特征未来函数 / 需求数据域缺失，一律抛错不静默；
 *   (d) 候选记录不可变 + 可序列化 round-trip（含 fingerprint 完整性校验，防篡改）；
 *   (e) 端到端链路打通：真实 FeatureProvider 从 dataset 行计算 pctChange → 信号 → 排序 →
 *       候选，且跨日无未来数据泄漏（D2 候选值由 D2 行决定，D3 的未来 close 不可见）。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../data";
import type { CostModel } from "../../engine/domain";
import { RESEARCH_DATASET_BUILDER_VERSION, RESEARCH_DATASET_ROW_SCHEMA_VERSION } from "../../researchDataset/types";
import type { DataSnapshot, ResearchDataset, ResearchDatasetRow, UniverseDayResult } from "../../researchDataset/types";
import {
  makeBarFeatureProvider,
  makeWeightedSignalBuilder,
  type ExperimentConfig,
  type FeatureProvider,
  type StrategyContract,
} from "../framework";
import { deriveDatasetUniverseId } from "../datasetAccess/handle";
import {
  assertValidStrategy13,
  deserializeCandidateEvaluationRun,
  runCandidateEngine,
  serializeCandidateEvaluationRun,
  type CandidateEngineInput,
  type CandidateEvaluationRun,
} from "./index";

// ---------------------------------------------------------------------------
// Fixture：4 个交易日窗口（SUNDAY 为非交易日，D1~D3 为交易日）
// ---------------------------------------------------------------------------

const SUNDAY = "2026-01-04";
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

interface RowSpec {
  date: string;
  id: string;
  close: number;
  preClose: number;
}

/** close / preClose 选自 C-13.1 fixture（递增 + 一个负收益证券 + 新成员 D），供 pctChange 特征。 */
const ROW_SPECS: readonly RowSpec[] = [
  { date: D1, id: "A", close: 10, preClose: 9.5 },
  { date: D1, id: "B", close: 20, preClose: 19.5 },
  { date: D1, id: "C", close: 30, preClose: 29.5 },
  { date: D2, id: "A", close: 11, preClose: 10 },
  { date: D2, id: "B", close: 19, preClose: 20 },
  { date: D2, id: "D", close: 5, preClose: 4.8 },
  { date: D3, id: "A", close: 12, preClose: 11 },
  { date: D3, id: "B", close: 21, preClose: 19 },
];

function makeRow(spec: RowSpec): ResearchDatasetRow {
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
      name: "signalEngine-test-daily",
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

function makeDataset(overrides: Partial<ResearchDataset> = {}): ResearchDataset {
  return {
    datasetVersion: "test-dataset-v1",
    universeDefinition: { rule: "test", asOfDescription: "PIT per tradeDate", days: makeUniverseDays() },
    policySet: [],
    dataSnapshot: makeSnapshot(),
    rows: ROW_SPECS.map((spec) => makeRow(spec)),
    gate: "PASS",
    gateNotes: [],
    ...overrides,
  };
}

function makeStrategy(): StrategyContract {
  return {
    strategyId: "test-strategy",
    strategyVersion: "1.0.0",
    name: "C-13.2 信号候选引擎测试策略",
    description: "仅用于 signalEngine 测试。",
    parameters: { parameters: [{ name: "topN", type: "number", required: true, min: 1 }] },
    requiredData: ["OHLCV"],
    signalFrequency: "daily",
  };
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

/** pctChange = close/preClose − 1（日涨跌幅，close 决策时当日行可见）。 */
function makePctChangeFeature(): FeatureProvider {
  return makeBarFeatureProvider({
    featureId: "pctChange",
    version: "1.0.0",
    availability: { requiredDataThrough: { date: D1, point: "close" }, availableAt: { date: D1, point: "close" } },
    compute: (bars: readonly CanonicalMarketBar[]) => {
      const last = bars[bars.length - 1];
      if (last === undefined || last.close === null || last.preClose === null || last.preClose === 0) return null;
      return last.close / last.preClose - 1;
    },
  });
}

function makeInput(overrides: Partial<CandidateEngineInput> = {}): CandidateEngineInput {
  return {
    dataset: makeDataset(),
    config: makeConfig(),
    strategy: makeStrategy(),
    strategy13: {
      point: "close",
      features: [makePctChangeFeature()],
      signalBuilder: makeWeightedSignalBuilder({ pctChange: 1 }),
      rankingConfig: { higherIsBetter: true },
      selectionConfig: { method: { kind: "topN", n: 2 } },
      signalDescription: "按日涨跌幅择优（long-only 候选研究）",
    },
    ...overrides,
  };
}

/** 便捷构造「去掉若干行」的脏数据集（保留其余不变）。 */
function withoutRows(dataset: ResearchDataset, drop: (row: ResearchDatasetRow) => boolean): ResearchDataset {
  return { ...dataset, rows: dataset.rows.filter((row) => !drop(row)) };
}

const pctOf = (close: number, preClose: number): number => close / preClose - 1;

// ---------------------------------------------------------------------------
// (a) 端到端多日驱动正确性
// ---------------------------------------------------------------------------

describe("多日引擎驱动", () => {
  it("逐决策日驱动 pipeline，universe 成员/候选名单/信号数正确（a）", () => {
    const run = runCandidateEngine(makeInput());
    expect(run.recordKind).toBe("CANDIDATE_EVALUATION_RUN");
    expect(run.recordVersion).toBe(1);
    expect(run.days.map((day) => day.date)).toEqual([D1, D2, D3]);
    // universe 成员数随 dataset 决议变化：D1=3 / D2=3 / D3=2。
    expect(run.days.map((day) => day.universeMembers)).toEqual([
      ["A", "B", "C"],
      ["A", "B", "D"],
      ["A", "B"],
    ]);
    // 每行都有当日 bar → 无人因 NO_BARS 剔除；pctChange 均可算 → signalCount = universe 规模。
    expect(run.days.map((day) => day.signalCount)).toEqual([3, 3, 2]);
    expect(run.days.map((day) => day.dropped)).toEqual([[], [], []]);
    // top2 by pctChange（higherIsBetter）：
    //   D1: A .0526 / B .0256 / C .0169 → [A, B]
    //   D2: A .1000 / D .0417 / B −.0500 → [A, D]
    //   D3: B .1053 / A .0909 → [B, A]
    expect(run.days.map((day) => day.selected.map((c) => c.securityId))).toEqual([
      ["A", "B"],
      ["A", "D"],
      ["B", "A"],
    ]);
    expect(run.days.map((day) => day.selected.length)).toEqual([2, 2, 2]);
    expect(run.days.map((day) => day.positionIntents.length)).toEqual([2, 2, 2]);
  });

  it("记录携带可审计字段：datasetVersion/dateRange/featureVersions/参数集（a）", () => {
    const run = runCandidateEngine(makeInput());
    expect(run.datasetVersion).toBe("test-dataset-v1");
    expect(run.builderVersion).toBe(RESEARCH_DATASET_BUILDER_VERSION);
    expect(run.rowSchemaVersion).toBe(RESEARCH_DATASET_ROW_SCHEMA_VERSION);
    expect(run.datasetGate).toBe("PASS");
    expect(run.universeId).toBe(deriveDatasetUniverseId("test-dataset-v1"));
    expect(run.strategyId).toBe("test-strategy");
    expect(run.strategyVersion).toBe("1.0.0");
    expect(run.parameters).toEqual({ topN: 2 });
    expect(run.dateRange).toEqual({ startDate: D1, endDate: D3 });
    expect(run.point).toBe("close");
    expect(run.signalDescription).toBe("按日涨跌幅择优（long-only 候选研究）");
    expect(run.featureVersions).toEqual([{ featureId: "pctChange", version: "1.0.0" }]);
    expect(run.rankingConfig).toEqual({ higherIsBetter: true });
    expect(run.selectionConfig).toEqual({ method: { kind: "topN", n: 2 } });
    expect(typeof run.fingerprint).toBe("string");
    expect(run.fingerprint.length).toBe(64); // sha256 hex
  });

  it("候选层统计评价正确：数量/横截面分布/入选稳定性（Evaluation 语义为候选统计）", () => {
    const run = runCandidateEngine(makeInput());
    const evaluation = run.evaluation;
    expect(evaluation.decisionDayCount).toBe(3);
    expect(evaluation.dates).toEqual([D1, D2, D3]);
    expect(evaluation.totalSelectedSlots).toBe(6);
    expect(evaluation.meanSelectedPerDay).toBe(2);
    expect(evaluation.minSelectedPerDay).toBe(2);
    expect(evaluation.maxSelectedPerDay).toBe(2);
    expect(evaluation.distinctUniverseSecurities).toEqual(["A", "B", "C", "D"]);
    expect(evaluation.distinctSelectedSecurities).toEqual(["A", "B", "D"]);
    expect(evaluation.universeCoveragePct).toBe(75); // 3/4 × 100
    // 入选稳定性：A 3 天 / B 2 天 / D 1 天。
    expect(evaluation.alwaysSelectedSecurities).toEqual(["A"]);
    expect(evaluation.selectionStats.map((s) => s.securityId)).toEqual(["A", "B", "D"]);
    expect(evaluation.selectionStats[0]?.selectionDays).toBe(3);
    expect(evaluation.selectionStats[1]?.selectionDays).toBe(2);
    expect(evaluation.selectionStats[2]?.selectionDays).toBe(1);
    expect(evaluation.selectionStats[0]?.selectionFrequency).toBeCloseTo(1, 9);
    expect(evaluation.selectionStats[1]?.selectionFrequency).toBeCloseTo(2 / 3, 9);
    expect(evaluation.selectionStats[2]?.selectionFrequency).toBeCloseTo(1 / 3, 9);
    // 方向分布：全部入选信号为正 → long。
    expect(evaluation.selectedDirectionCounts).toEqual({ long: 6, short: 0, neutral: 0 });
  });

  it("端到端链路打通且无未来泄漏：D2 的候选值由 D2 行决定（e）", () => {
    const run = runCandidateEngine(makeInput());
    const dayD2 = run.days.find((day) => day.date === D2)!;
    // D2 top1 = A，value 必须来自 D2 行（close=11/preClose=10 → +10%），
    // 若泄漏了 D3 的 A（close=12/preClose=11 → +9.09%）数值必然不同。
    const topD2 = dayD2.selected[0]!;
    expect(topD2.securityId).toBe("A");
    expect(topD2.value).toBeCloseTo(pctOf(11, 10), 12);
    expect(topD2.value).not.toBeCloseTo(pctOf(12, 11), 12);
    // D1 top1 = A +5.26%；D3 top1 = B +10.53%，均来自当日行。
    const dayD1 = run.days.find((day) => day.date === D1)!;
    const dayD3 = run.days.find((day) => day.date === D3)!;
    expect(dayD1.selected[0]!.value).toBeCloseTo(pctOf(10, 9.5), 12);
    expect(dayD3.selected[0]!.value).toBeCloseTo(pctOf(21, 19), 12);
  });

  it("open 决策时点不得消费当日 close（泄漏守卫在引擎层同样生效）", () => {
    // 特征 availability 声明到 D1 close，而引擎以 open 驱动 → 最早决策时点 (D1, open)
    // 早于 availability → LookAheadError。
    const input = makeInput({ strategy13: { ...makeInput().strategy13, point: "open" } });
    expect(() => runCandidateEngine(input)).toThrow(/未来函数/);
  });
});

// ---------------------------------------------------------------------------
// (b) 确定性 + (d) 不可变 + 序列化
// ---------------------------------------------------------------------------

describe("确定性与序列化", () => {
  it("两次独立运行深比较相等，序列化串与 fingerprint 相同（b）", () => {
    const first = runCandidateEngine(makeInput());
    const second = runCandidateEngine(makeInput());
    expect(second).toEqual(first);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(serializeCandidateEvaluationRun(second)).toBe(serializeCandidateEvaluationRun(first));
  });

  it("运行记录整体与嵌套结构不可变（d）", () => {
    const run = runCandidateEngine(makeInput());
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.days)).toBe(true);
    expect(Object.isFrozen(run.evaluation)).toBe(true);
    expect(Object.isFrozen(run.featureVersions)).toBe(true);
  });

  it("序列化 round-trip：deserialize(serialize(r)) 与 r 深相等且串稳定（d）", () => {
    const run = runCandidateEngine(makeInput());
    const restored = deserializeCandidateEvaluationRun(serializeCandidateEvaluationRun(run));
    expect(restored).toEqual(run);
    expect(serializeCandidateEvaluationRun(restored)).toBe(serializeCandidateEvaluationRun(run));
  });

  it("指纹完整性校验：篡改记录内容即拒绝（d）", () => {
    const json = serializeCandidateEvaluationRun(runCandidateEngine(makeInput()));
    const parsed = JSON.parse(json) as CandidateEvaluationRun;
    parsed.fingerprint = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    expect(() => deserializeCandidateEvaluationRun(JSON.stringify(parsed))).toThrow(/指纹不匹配/);
  });

  it("Strategy13 校验：重复 featureId / 空特征集合被拒", () => {
    const base = makeInput().strategy13;
    const duplicate = { ...base, features: [base.features[0]!, base.features[0]!] };
    expect(() => assertValidStrategy13(duplicate)).toThrow(/featureId/);
    expect(() => assertValidStrategy13({ ...base, features: [] })).toThrow(/非空数组/);
  });
});

// ---------------------------------------------------------------------------
// (c) FAIL FAST
// ---------------------------------------------------------------------------

describe("FAIL FAST（缺数据/版本/窗口/泄漏，拒绝静默）", () => {
  it("universe 成员在决策日缺行 → MissingDatasetRowError（c）", () => {
    // D2 universe 成员含 B，但删除 D2 的 B 行。
    const dataset = withoutRows(makeDataset(), (row) => row.tradeDate === D2 && row.securityId === "B");
    expect(() => runCandidateEngine(makeInput({ dataset }))).toThrow(/缺行/);
    try {
      runCandidateEngine(makeInput({ dataset }));
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as { code?: string }).code).toBe("MISSING_DATASET_ROW");
    }
  });

  it("决策日整体无行（交易日无任何 row）→ 抛错（c）", () => {
    const dataset = withoutRows(makeDataset(), (row) => row.tradeDate === D2);
    expect(() => runCandidateEngine(makeInput({ dataset }))).toThrow(/无任何行/);
  });

  it("datasetVersion 不一致 → FAIL FAST，版本可追溯（c）", () => {
    const config = makeConfig({ datasetVersion: "test-dataset-v2" });
    expect(() => runCandidateEngine(makeInput({ config }))).toThrow(/不一致/);
  });

  it("请求窗口内无交易日 → EmptyDecisionWindowError（c）", () => {
    // SUNDAY 在数据集窗口内但为非交易日；单日窗口 [SUNDAY, SUNDAY] 无交易日可驱动。
    const config = makeConfig({ dateRange: { startDate: SUNDAY, endDate: SUNDAY } });
    expect(() => runCandidateEngine(makeInput({ config }))).toThrow(/无交易日/);
  });

  it("特征 availability 晚于最早决策时点 → LookAheadError（c）", () => {
    const feature = makeBarFeatureProvider({
      featureId: "lateFeature",
      version: "1.0.0",
      availability: { requiredDataThrough: { date: D3, point: "close" }, availableAt: { date: D3, point: "close" } },
      compute: (bars) => (bars.length > 0 ? 1 : null),
    });
    const strategy13 = { ...makeInput().strategy13, features: [feature] };
    expect(() => runCandidateEngine(makeInput({ strategy13 }))).toThrow(/未来函数/);
  });

  it("策略所需数据域不在 dataset 宽行结构内 → REQUIRED_DATA_MISSING（c）", () => {
    const strategy = makeStrategy();
    const input = makeInput({ strategy: { ...strategy, requiredData: ["OHLCV", "OrderBook"] } });
    expect(() => runCandidateEngine(input)).toThrow(/所需数据域缺失/);
  });

  it("universeId 与数据集派生 id 不一致 → FAIL FAST（c）", () => {
    const config = makeConfig({ universe: { universeId: "another-universe" } });
    expect(() => runCandidateEngine(makeInput({ config }))).toThrow(/universeId/);
  });

  it("策略身份与 config 不一致 → 抛错（c）", () => {
    const strategy = makeStrategy();
    const mismatched = { ...strategy, strategyVersion: "2.0.0" };
    expect(() => runCandidateEngine(makeInput({ strategy: mismatched }))).toThrow(/不一致/);
  });
});
