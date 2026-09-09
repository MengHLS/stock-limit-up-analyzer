/**
 * STEP 19 / C-19.2 — IS/OOS 隔离记录与归档单测。
 *
 * 覆盖（对应 types.ts / discipline.ts / record.ts / aggregate.ts / ledger.ts / serialize.ts /
 * run.ts 的承诺）：
 *   ① 隔离纪律机器检查：OOS 与 Train 重叠 / OOS 回写参数 / window id 重复 / Test 早于 Train /
 *      字段共享 → 拒绝；
 *   ② 聚合正确性：手算小样本 OOS 分段总收益 / 回撤 / 退化幅度（与 C-19.1 aggregate 口径一致）；
 *   ③ 确定性：同输入深比较；
 *   ④ round-trip 与篡改拒绝；
 *   ⑤ 退化输入：空记录集 / 单窗 / 非法日期（OOS 曲线越界）/ 曲线 1 点；
 *   ⑥ 与 C-19.1 窗口划分的复用对照。
 */

import { describe, expect, it } from "vitest";
import type { ParameterSearchSampleOutcome } from "../parameterSearch/types";
import { runWalkForward } from "../walkForwardRun/run";
import { generateWalkForwardSplits } from "../walkForwardRun/windows";
import type { WalkForwardRun, WalkForwardRequest } from "../walkForwardRun";
import type { EquityPoint } from "../../backtest/types";
import { assertOosIsolationDiscipline, assertWindowResultIsolation, verifyOosIsolation } from "./discipline";
import { buildWindowResultRecords } from "./record";
import { computeOosAggregationReport } from "./aggregate";
import { OosIsolationLedger } from "./ledger";
import {
  deserializeOosIsolationRun,
  serializeOosIsolationRun,
  validateOosIsolationRun,
} from "./serialize";
import { runOosIsolation, validateOosIsolationRequest } from "./run";
import type {
  OosIsolationRun,
  WindowIsolationMetadata,
  WindowResultRecord,
  WindowTestResult,
  WindowTrainResult,
} from "./types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ok(totalReturnPct: number, maxDrawdownPct: number, tradeCount: number | null = 1): ParameterSearchSampleOutcome {
  return { status: "succeeded", metrics: { totalReturnPct, maxDrawdownPct, tradeCount } };
}

/** 生成 count 个连续「交易日」标签（YYYY-MM-DD，自 start 起真实日历递增；测试数据构造用）。 */
function tradeDates(count: number, start = "2024-01-01"): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

const FIXED_TIME = "2026-09-07T00:00:00.000Z";

function equityPoint(date: string, equity: number): EquityPoint {
  return { date, cash: 0, marketValue: 0, equity, openPositions: 0 };
}

/** Train 收益 10% / Test 收益 5%：冻结参数中位数 → train=10、test=5、退化 -5pp（手算锚点）。 */
function makeWalkForwardRequest(overrides: Partial<WalkForwardRequest> = {}): WalkForwardRequest {
  return {
    strategyId: "strategy-oos",
    strategyVersion: "1.0.0",
    method: "grid",
    parameterSpace: { parameters: [{ type: "integer", name: "k", min: 1, max: 3, step: 1 }] },
    tradeDates: tradeDates(12),
    splitConfig: { trainWindow: 5, testWindow: 2, step: 1 },
    optimizeEvaluatorFactory: () => () => ok(10, 1),
    testEvaluatorFactory: () => () => ok(5, 1),
    runId: "WFA-OOS-TEST",
    createdAt: FIXED_TIME,
    ...overrides,
  };
}

function makeWalkForwardRun(overrides: Partial<WalkForwardRequest> = {}): WalkForwardRun {
  return runWalkForward(makeWalkForwardRequest(overrides));
}

/** 为前 returns.length 个窗口生成落在其 test 区间内的 2 点 OOS 曲线（其余窗口缺曲线 → unassessed）。 */
function makeOosCurves(run: WalkForwardRun, returns: readonly number[]): Map<string, EquityPoint[]> {
  const splits = generateWalkForwardSplits(run.tradeDates, run.splitConfig);
  const map = new Map<string, EquityPoint[]>();
  splits.forEach((split, index) => {
    if (index >= returns.length) return;
    const ret = returns[index]!;
    const points = split.testDates.map((date, j) => equityPoint(date, j === 0 ? 100 : 100 * (1 + ret / 100)));
    map.set(`${run.runId}-w${split.windowIndex}`, points);
  });
  return map;
}

/** 手工构造一条隔离记录（供隔离纪律机器检查的违规样本测试）。 */
function makeRecord(overrides: {
  windowId?: string;
  windowIndex?: number;
  firstTrainDate?: string;
  lastTrainDate?: string;
  firstTestDate?: string;
  lastTestDate?: string;
  overlapCount?: number;
  paramsFrozenFromTrain?: boolean;
  frozenParam?: number;
  testParam?: number;
  status?: "succeeded" | "skipped";
} = {}): WindowResultRecord {
  const windowId = overrides.windowId ?? "W-w0";
  const windowIndex = overrides.windowIndex ?? 0;
  const frozenParam = overrides.frozenParam ?? 2;
  const testParam = overrides.testParam ?? frozenParam;
  const firstTrainDate = overrides.firstTrainDate ?? "2024-01-01";
  const lastTrainDate = overrides.lastTrainDate ?? "2024-01-05";
  const firstTestDate = overrides.firstTestDate ?? "2024-01-06";
  const lastTestDate = overrides.lastTestDate ?? "2024-01-07";

  const train: WindowTrainResult = {
    windowId,
    windowIndex,
    firstTrainDate,
    lastTrainDate,
    frozenParameterSetKey: `"k"=${frozenParam}`,
    frozenParameterSet: { k: frozenParam },
    trainTotalReturnPct: 10,
    trainMaxDrawdownPct: 1,
    trainTradeCount: 1,
  };
  const test: WindowTestResult = {
    windowId,
    windowIndex,
    firstTestDate,
    lastTestDate,
    status: overrides.status ?? "succeeded",
    testParameterSetKey: `"k"=${testParam}`,
    testParameterSet: { k: testParam },
    totalReturnPct: 5,
    maxDrawdownPct: 1,
    tradeCount: 1,
    skipReasonCode: null,
    oosEquityCurve: null,
  };
  const isolation: WindowIsolationMetadata = {
    trainTestOverlapCount: overrides.overlapCount ?? 0,
    testStrictlyAfterTrain: lastTrainDate < firstTestDate,
    paramsFrozenFromTrain: overrides.paramsFrozenFromTrain ?? frozenParam === testParam,
    testResultWritesBackParams: false,
    isolationHolds: true,
  };
  return { windowId, windowIndex, train, test, isolation, fingerprint: "a".repeat(64) };
}

// ---------------------------------------------------------------------------
// ① 隔离纪律机器检查（discipline.ts）
// ---------------------------------------------------------------------------

describe("① 隔离纪律机器检查（verifyOosIsolation / assertOosIsolationDiscipline）", () => {
  it("合法记录 → passed = true 且 violations 为空", () => {
    const audit = verifyOosIsolation([makeRecord()]);
    expect(audit.passed).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(() => assertOosIsolationDiscipline([makeRecord()])).not.toThrow();
  });

  it("OOS 与 Train 重叠 → 拒绝（trainTestOverlapCount > 0）", () => {
    const audit = verifyOosIsolation([makeRecord({ overlapCount: 2 })]);
    expect(audit.passed).toBe(false);
    expect(audit.allTrainTestNonOverlapping).toBe(false);
  });

  it("OOS 回写参数 → 拒绝（test 参数 ≠ 冻结参数）", () => {
    // 元数据伪造 paramsFrozenFromTrain=true，但实际 test 参数被改写成 {k:3} ≠ 冻结 {k:2}
    const audit = verifyOosIsolation([makeRecord({ frozenParam: 2, testParam: 3, paramsFrozenFromTrain: true })]);
    expect(audit.passed).toBe(false);
    expect(audit.allParamsFrozenFromTrain).toBe(false);
  });

  it("window id 重复 → 拒绝", () => {
    const r1 = makeRecord({ windowId: "DUP", windowIndex: 0 });
    const r2 = makeRecord({ windowId: "DUP", windowIndex: 1 });
    const audit = verifyOosIsolation([r1, r2]);
    expect(audit.passed).toBe(false);
    expect(audit.allWindowIdsUnique).toBe(false);
  });

  it("Test 早于 Train → 拒绝", () => {
    const audit = verifyOosIsolation([
      makeRecord({ firstTrainDate: "2024-01-10", lastTrainDate: "2024-01-15", firstTestDate: "2024-01-06", lastTestDate: "2024-01-07" }),
    ]);
    expect(audit.passed).toBe(false);
    expect(audit.allTestStrictlyAfterTrain).toBe(false);
  });

  it("字段共享：test 注入 train 结果键 → 拒绝（键白名单）", () => {
    const record = makeRecord();
    (record.test as unknown as Record<string, unknown>).frozenParameterSet = { k: 2 };
    const audit = verifyOosIsolation([record]);
    expect(audit.passed).toBe(false);
    expect(audit.noTestResultWritesBackParams).toBe(false);
  });

  it("assertWindowResultIsolation：合法不抛，重叠抛错", () => {
    expect(() => assertWindowResultIsolation(makeRecord())).not.toThrow();
    expect(() => assertWindowResultIsolation(makeRecord({ overlapCount: 1 }))).toThrow(/OOS19_ISOLATION/);
  });

  it("空记录集 → passed = false，assert 抛错", () => {
    expect(verifyOosIsolation([]).passed).toBe(false);
    expect(() => assertOosIsolationDiscipline([])).toThrow(/OOS19_ISOLATION_VIOLATION/);
  });
});

// ---------------------------------------------------------------------------
// ② 聚合正确性（aggregate.ts，手算）
// ---------------------------------------------------------------------------

describe("② 聚合正确性（computeOosAggregationReport / runOosIsolation）", () => {
  it("退化幅度 oosDegradationPp = -5pp（与 C-19.1 aggregate 口径一致：meanTest − meanTrain）", () => {
    const run = runOosIsolation({ walkForwardRun: makeWalkForwardRun() });
    expect(run.report.oosDegradationPp).toBe(-5);
    // 与 C-19.1 computeWalkForwardAggregate 直接对照
    expect(run.report.walkForwardAggregate.oosDegradationPp).toBe(-5);
  });

  it("分段 OOS 累计收益 / 回撤手算（曲线 +10% / −10%）", () => {
    const wf = makeWalkForwardRun();
    const curves = makeOosCurves(wf, [10, -10]);
    const run = runOosIsolation({ walkForwardRun: wf, oosEquityCurves: curves });

    expect(run.report.oosEquityCurveAssessed).toBe(true);
    // 窗口 0 曲线 100→110（+10%），窗口 1 曲线 100→90（−10%）
    expect(run.report.segments[0]!.assessed).toBe(true);
    expect(run.report.segments[1]!.assessed).toBe(true);
    expect(run.report.segments[0]!.performance!.metrics.returns.totalReturnPct).toBeCloseTo(10, 6);
    expect(run.report.segments[1]!.performance!.metrics.returns.totalReturnPct).toBeCloseTo(-10, 6);
    // 回撤：段 0 无回撤（0），段 1 回撤 10%
    expect(run.report.segments[0]!.performance!.metrics.drawdown.maxDrawdownPct).toBeCloseTo(0, 6);
    expect(run.report.segments[1]!.performance!.metrics.drawdown.maxDrawdownPct).toBeCloseTo(10, 6);

    const agg = run.report.oosSegmentAggregate;
    expect(agg.assessedSegmentCount).toBe(2);
    expect(agg.cumulatedTotalReturnPct).toBeCloseTo(-1, 6); // (1.1 × 0.9 − 1) × 100
    expect(agg.meanTotalReturnPct).toBeCloseTo(0, 6); // (10 + (−10)) / 2
    expect(agg.meanMaxDrawdownPct).toBeCloseTo(5, 6); // (0 + 10) / 2
    expect(agg.maxMaxDrawdownPct).toBeCloseTo(10, 6);
  });

  it("缺窗 OOS 曲线 → 该段 unassessed（OOS19_NO_OOS_EQUITY_CURVE），仅标量绩效", () => {
    const wf = makeWalkForwardRun();
    const curves = new Map<string, EquityPoint[]>();
    curves.set("WFA-OOS-TEST-w0", [equityPoint("2024-01-06", 100), equityPoint("2024-01-07", 110)]);
    const run = runOosIsolation({ walkForwardRun: wf, oosEquityCurves: curves });

    expect(run.report.segments[0]!.assessed).toBe(true);
    expect(run.report.segments[1]!.assessed).toBe(false);
    expect(run.report.segments[1]!.skipReasonCode).toBe("OOS19_NO_OOS_EQUITY_CURVE");
    expect(run.report.oosSegmentAggregate.assessedSegmentCount).toBe(1);
    expect(run.report.oosSegmentAggregate.unassessedSegmentCount).toBe(5);
    expect(run.report.skippedWindowCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// ③ 确定性
// ---------------------------------------------------------------------------

describe("③ 确定性（同输入深比较）", () => {
  it("同输入两次 runOosIsolation → 指纹与深比较相等", () => {
    const wf = makeWalkForwardRun();
    const curves = makeOosCurves(wf, [10, -10, 5]);
    const a = runOosIsolation({ walkForwardRun: wf, oosEquityCurves: curves, runId: "OOSISO-FIXED", createdAt: FIXED_TIME });
    const b = runOosIsolation({ walkForwardRun: wf, oosEquityCurves: curves, runId: "OOSISO-FIXED", createdAt: FIXED_TIME });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a).toEqual(b);
    expect(a.windows).toEqual(b.windows);
    expect(a.report).toEqual(b.report);
  });
});

// ---------------------------------------------------------------------------
// ④ round-trip 与篡改拒绝
// ---------------------------------------------------------------------------

describe("④ round-trip 与篡改拒绝（serialize.ts）", () => {
  it("serialize → deserialize round-trip 深比较相等", () => {
    const wf = makeWalkForwardRun();
    const run = runOosIsolation({ walkForwardRun: wf, oosEquityCurves: makeOosCurves(wf, [10, -10]) });
    const restored = deserializeOosIsolationRun(serializeOosIsolationRun(run));
    expect(restored).toEqual(run);
    expect(restored.fingerprint).toBe(run.fingerprint);
  });

  it("篡改 OOS 结果字段 → 反序列化抛指纹不匹配", () => {
    const wf = makeWalkForwardRun();
    const run = runOosIsolation({ walkForwardRun: wf, oosEquityCurves: makeOosCurves(wf, [10]) });
    const json = serializeOosIsolationRun(run);
    const parsed = JSON.parse(json) as OosIsolationRun;
    parsed.windows[0]!.test.totalReturnPct = 999;
    expect(() => deserializeOosIsolationRun(JSON.stringify(parsed))).toThrow(/OOS19_RUN_FINGERPRINT_MISMATCH/);
  });

  it("validateOosIsolationRun：合法 recordKind / 版本 / 结构", () => {
    const run = runOosIsolation({ walkForwardRun: makeWalkForwardRun() });
    expect(validateOosIsolationRun(run).valid).toBe(true);
    const bad = { ...run, recordKind: "NOT_OOS" };
    expect(validateOosIsolationRun(bad).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 退化输入
// ---------------------------------------------------------------------------

describe("⑤ 退化输入", () => {
  it("单窗：trainWindow=5 / testWindow=2 在 7 日序列上只有 1 窗", () => {
    const wf = makeWalkForwardRun({ tradeDates: tradeDates(7) });
    const run = runOosIsolation({ walkForwardRun: wf });
    expect(run.windowCount).toBe(1);
    expect(run.report.windowCount).toBe(1);
  });

  it("OOS 曲线 1 点 → assessed=false + OOS19_OOS_CURVE_TOO_SHORT", () => {
    const wf = makeWalkForwardRun();
    const curves = new Map<string, EquityPoint[]>();
    curves.set("WFA-OOS-TEST-w0", [equityPoint("2024-01-06", 100)]);
    const run = runOosIsolation({ walkForwardRun: wf, oosEquityCurves: curves });
    expect(run.report.segments[0]!.assessed).toBe(false);
    expect(run.report.segments[0]!.skipReasonCode).toBe("OOS19_OOS_CURVE_TOO_SHORT");
  });

  it("非法日期：OOS 曲线越出 Test 区间 → 抛错 OOS19_OOS_CURVE_OUTSIDE_TEST_WINDOW", () => {
    const wf = makeWalkForwardRun();
    const curves = new Map<string, EquityPoint[]>();
    curves.set("WFA-OOS-TEST-w0", [equityPoint("2024-01-01", 100), equityPoint("2024-01-02", 110)]);
    expect(() => runOosIsolation({ walkForwardRun: wf, oosEquityCurves: curves }))
      .toThrow(/OOS19_OOS_CURVE_OUTSIDE_TEST_WINDOW/);
  });

  it("空 WalkForwardRun.windows → buildWindowResultRecords 抛 OOS19_EMPTY_WINDOWS", () => {
    const wf = makeWalkForwardRun();
    const emptyWf = { ...wf, windows: [] } as WalkForwardRun;
    expect(() => buildWindowResultRecords(emptyWf, new Map())).toThrow(/OOS19_EMPTY_WINDOWS/);
  });

  it("请求校验：walkForwardRun.recordKind 错误 → issue", () => {
    const wf = makeWalkForwardRun();
    const badWf = { ...wf, recordKind: "NOT_WFO" } as WalkForwardRun;
    const issues = validateOosIsolationRequest({ walkForwardRun: badWf });
    expect(issues.some((i) => i.code === "OOS19_WALK_FORWARD_RUN_KIND_MISMATCH")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 与 C-19.1 窗口划分的复用对照
// ---------------------------------------------------------------------------

describe("⑥ 与 C-19.1 窗口划分的复用对照", () => {
  it("buildWindowResultRecords 的 train/test 区间与 generateWalkForwardSplits 一致", () => {
    const wf = makeWalkForwardRun();
    const records = buildWindowResultRecords(wf, new Map());
    const splits = generateWalkForwardSplits(wf.tradeDates, wf.splitConfig);
    expect(records.length).toBe(splits.length);
    records.forEach((record, index) => {
      expect(record.train.firstTrainDate).toBe(splits[index]!.firstTrainDate);
      expect(record.train.lastTrainDate).toBe(splits[index]!.lastTrainDate);
      expect(record.test.firstTestDate).toBe(splits[index]!.firstTestDate);
      expect(record.test.lastTestDate).toBe(splits[index]!.lastTestDate);
    });
  });

  it("端到端：runWalkForward 产物 → runOosIsolation 全程隔离纪律成立", () => {
    const wf = makeWalkForwardRun();
    const run = runOosIsolation({ walkForwardRun: wf, oosEquityCurves: makeOosCurves(wf, [10, -10, 5, 8, -3, 2]) });
    expect(run.discipline.passed).toBe(true);
    expect(run.discipline.violations).toEqual([]);
    expect(run.sourceWalkForwardRunId).toBe(wf.runId);
    expect(run.sourceWalkForwardRunFingerprint).toBe(wf.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 归档账本（ledger.ts）
// ---------------------------------------------------------------------------

describe("⑦ 归档账本（OosIsolationLedger）", () => {
  it("append-only：重复 runId 拒绝，list 按 runId 字典序", () => {
    const ledger = new OosIsolationLedger();
    const wf = makeWalkForwardRun();
    const a = runOosIsolation({ walkForwardRun: wf, runId: "OOSISO-A", createdAt: FIXED_TIME });
    const b = runOosIsolation({ walkForwardRun: wf, runId: "OOSISO-B", createdAt: FIXED_TIME });
    ledger.append(a);
    ledger.append(b);
    expect(ledger.count()).toBe(2);
    expect(ledger.has("OOSISO-A")).toBe(true);
    expect(() => ledger.append(a)).toThrow(/重复归档/);
    expect(ledger.list().map((r) => r.runId)).toEqual(["OOSISO-A", "OOSISO-B"]);
    expect(ledger.get("OOSISO-A")).toEqual(a);
    expect(() => ledger.get("OOSISO-MISSING")).toThrow(/无归档记录/);
  });
});
