/**
 * STEP 19 / C-19.1 — Walk-Forward Optimization 单测。
 *
 * 覆盖（对应 types.ts / windows.ts / freeze.ts / run.ts / serialize.ts 的承诺）：
 *   ① 窗口划分：rolling / anchored / gap / embargo / step / maxWindows / 边界 / 不足窗报错；
 *   ② 配置解析与交易日历校验（缺省补齐 + 非法 issues）；
 *   ③ 冻结纪律：下中位数（显式非 argmax）、深冻结、机器检查；
 *   ④ 编排端到端：假 evaluator 证明 Train→Optimize→Freeze→Test→Move Window 闭环；
 *   ⑤ 冻结纪律实证：篡改 test 数据不影响冻结参数；
 *   ⑥ 序列化：round-trip / 篡改拒绝 / 结构校验。
 */

import { describe, expect, it } from "vitest";
import type { ParameterSearchSampleOutcome } from "../parameterSearch/types";
import {
  computeWalkForwardSplitConfigFingerprint,
  generateWalkForwardSplits,
  resolveWalkForwardSplitConfig,
  validateWalkForwardTradeDates,
} from "./windows";
import {
  deepFreezeParameterSet,
  isDeepFrozenParameterSet,
  verifyWalkForwardFreezeDiscipline,
} from "./freeze";
import { computeWalkForwardAggregate } from "./aggregate";
import { runWalkForward, validateWalkForwardRequest } from "./run";
import {
  deserializeWalkForwardRun,
  serializeWalkForwardRun,
  validateWalkForwardRun,
} from "./serialize";
import {
  WALK_FORWARD_RUN_RECORD_KIND,
  type WalkForwardRun,
  type WalkForwardRequest,
} from "./types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ok(
  totalReturnPct: number,
  maxDrawdownPct: number,
  tradeCount: number | null = 1,
): ParameterSearchSampleOutcome {
  return { status: "succeeded", metrics: { totalReturnPct, maxDrawdownPct, tradeCount } };
}

/** 生成 count 个连续「交易日」标签（YYYY-MM-DD，自 start 起真实日历递增）。 */
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

/** 参数空间：单 integer 参数 k ∈ {1,2,3}（grid 全组合 3 格点）。 */
function gridSpace(): { parameters: { type: "integer"; name: string; min: number; max: number; step: number }[] } {
  return { parameters: [{ type: "integer", name: "k", min: 1, max: 3, step: 1 }] };
}

function makeRequest(overrides: Partial<WalkForwardRequest> = {}): WalkForwardRequest {
  return {
    strategyId: "strategy-wfo",
    strategyVersion: "1.0.0",
    method: "grid",
    parameterSpace: gridSpace(),
    tradeDates: tradeDates(12),
    splitConfig: { trainWindow: 5, testWindow: 2, step: 1 },
    optimizeEvaluatorFactory: () => (ps) => ok((ps.k as number) * 10, 1),
    testEvaluatorFactory: () => (ps) => ok((ps.k as number) * 10 + 100, 1),
    runId: "WFA-TEST-00000001",
    createdAt: FIXED_TIME,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ① 窗口划分（windows.ts）
// ---------------------------------------------------------------------------

describe("① 窗口划分（generateWalkForwardSplits / resolve / validate）", () => {
  it("rolling 基本几何：train 5 / test 2 / step 1 在 12 日序列上生成 6 窗，Test 严格晚于 Train 且无重叠", () => {
    const dates = tradeDates(12);
    const splits = generateWalkForwardSplits(dates, { trainWindow: 5, testWindow: 2, step: 1 });
    expect(splits.length).toBe(6);
    for (const split of splits) {
      expect(split.trainDates.length).toBe(5);
      expect(split.testDates.length).toBe(2);
      expect(split.lastTrainDate < split.firstTestDate).toBe(true);
      const trainSet = new Set(split.trainDates);
      expect(split.testDates.every((d) => !trainSet.has(d))).toBe(true);
      expect(split.windowIndex).toBeGreaterThanOrEqual(0);
    }
    // 首窗与末窗边界
    expect(splits[0]!.trainStartIndex).toBe(0);
    expect(splits[0]!.firstTestDate).toBe(dates[5]);
    expect(splits[5]!.firstTestDate).toBe(dates[10]);
    expect(splits[5]!.lastTestDate).toBe(dates[11]);
  });

  it("embargo：优化段扣除 Train 尾部，embargoDates 正确切出", () => {
    const dates = tradeDates(12);
    const splits = generateWalkForwardSplits(dates, { trainWindow: 5, testWindow: 2, step: 1, embargo: 2 });
    const split = splits[0]!;
    expect(split.trainDayCount).toBe(5);
    expect(split.optimizationDayCount).toBe(3);
    expect(split.embargoDayCount).toBe(2);
    expect(split.optimizationDates).toEqual(dates.slice(0, 3));
    expect(split.embargoDates).toEqual(dates.slice(3, 5));
  });

  it("gap：Test 段首日与 Train 末之间跳过 gap 个交易日", () => {
    const dates = tradeDates(12);
    const splits = generateWalkForwardSplits(dates, { trainWindow: 5, testWindow: 2, step: 1, gap: 1 });
    const split = splits[0]!;
    expect(split.gapDayCount).toBe(1);
    expect(split.gapDates).toEqual([dates[5]]);
    expect(split.firstTestDate).toBe(dates[6]);
  });

  it("anchored：Train 段随窗扩张（起点恒 0，末点推进）", () => {
    const dates = tradeDates(14);
    const splits = generateWalkForwardSplits(dates, { mode: "anchored", trainWindow: 4, testWindow: 2, step: 1 });
    expect(splits[0]!.trainStartIndex).toBe(0);
    expect(splits[0]!.trainDayCount).toBe(4);
    expect(splits[1]!.trainStartIndex).toBe(0);
    expect(splits[1]!.trainDayCount).toBe(5);
    expect(splits[2]!.trainDayCount).toBe(6);
  });

  it("maxWindows 限制窗口数", () => {
    const dates = tradeDates(30);
    const splits = generateWalkForwardSplits(dates, { trainWindow: 5, testWindow: 2, step: 1, maxWindows: 3 });
    expect(splits.length).toBe(3);
  });

  it("不足一个完整窗口 → 结构化抛错 WFO19_SPLIT_INSUFFICIENT_DATASET", () => {
    expect(() => generateWalkForwardSplits(tradeDates(5), { trainWindow: 5, testWindow: 2, step: 1 }))
      .toThrow(/WFO19_SPLIT_INSUFFICIENT_DATASET/);
  });

  it("embargo 吞掉整个 train → resolve 返回 issues WFO19_EMBARGO_EXCEEDS_TRAIN", () => {
    const result = resolveWalkForwardSplitConfig({ trainWindow: 5, testWindow: 2, step: 1, embargo: 5 });
    expect(result.config).toBeNull();
    expect(result.issues.some((i) => i.code === "WFO19_EMBARGO_EXCEEDS_TRAIN")).toBe(true);
  });

  it("resolve 缺省补齐：mode=rolling / gap=0 / embargo=0 / maxWindows=null", () => {
    const result = resolveWalkForwardSplitConfig({ trainWindow: 5, testWindow: 2, step: 1 });
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({
      mode: "rolling",
      trainWindow: 5,
      testWindow: 2,
      step: 1,
      gap: 0,
      embargo: 0,
      maxWindows: null,
    });
  });

  it("非法配置（trainWindow<1 / testWindow<1 / step<1 / gap<0）→ 返回对应 issues", () => {
    const result = resolveWalkForwardSplitConfig({ trainWindow: 0, testWindow: 0, step: 0, gap: -1 });
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("WFO19_TRAIN_WINDOW_INVALID");
    expect(codes).toContain("WFO19_TEST_WINDOW_INVALID");
    expect(codes).toContain("WFO19_STEP_INVALID");
    expect(codes).toContain("WFO19_GAP_INVALID");
  });

  it("validateWalkForwardTradeDates：空 / 乱序 / 重复 / 非法格式 → issues", () => {
    expect(validateWalkForwardTradeDates([]).valid).toBe(false);
    expect(validateWalkForwardTradeDates(["2024-01-02", "2024-01-01"]).issues
      .some((i) => i.code === "WFO19_TRADE_DATES_NOT_ASCENDING")).toBe(true);
    expect(validateWalkForwardTradeDates(["2024-01-01", "2024-01-01"]).issues
      .some((i) => i.code === "WFO19_TRADE_DATES_NOT_ASCENDING")).toBe(true);
    expect(validateWalkForwardTradeDates(["2024/01/01"]).issues
      .some((i) => i.code === "WFO19_TRADE_DATE_INVALID")).toBe(true);
    expect(validateWalkForwardTradeDates(tradeDates(3)).valid).toBe(true);
  });

  it("computeWalkForwardSplitConfigFingerprint 确定性", () => {
    const cfg = { mode: "rolling" as const, trainWindow: 5, testWindow: 2, step: 1, gap: 0, embargo: 0, maxWindows: null };
    expect(computeWalkForwardSplitConfigFingerprint(cfg)).toBe(computeWalkForwardSplitConfigFingerprint(cfg));
  });
});

// ---------------------------------------------------------------------------
// ② 冻结纪律（freeze.ts）
// ---------------------------------------------------------------------------

describe("② 冻结纪律（deepFreeze / verify）", () => {
  it("deepFreezeParameterSet 产出深冻结副本，嵌套对象亦冻结；isDeepFrozenParameterSet 判别", () => {
    const original = { a: 1, nested: { b: 2 } as unknown as number };
    const frozen = deepFreezeParameterSet(original);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(isDeepFrozenParameterSet(frozen)).toBe(true);
    // 原对象不被冻结（只冻副本）
    expect(Object.isFrozen(original)).toBe(false);
  });

  it("isDeepFrozenParameterSet 对未冻结对象返回 false", () => {
    expect(isDeepFrozenParameterSet({ a: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ③ 编排端到端（run.ts）
// ---------------------------------------------------------------------------

describe("③ 编排端到端（runWalkForward）", () => {
  it("grid 闭环：6 窗全评估，冻结纪律成立，OOS 聚合正确", () => {
    const run = runWalkForward(makeRequest());
    expect(run.recordKind).toBe(WALK_FORWARD_RUN_RECORD_KIND);
    expect(run.windows.length).toBe(6);
    expect(run.freezeIntegrity.passed).toBe(true);
    expect(run.freezeIntegrity.allTestStageKeysMatchFrozen).toBe(true);
    expect(run.freezeIntegrity.allTestStageParametersFrozen).toBe(true);
    expect(run.freezeIntegrity.allTestWindowsAfterTrain).toBe(true);
    expect(run.aggregate.testedWindowCount).toBe(6);
    expect(run.aggregate.skippedWindowCount).toBe(0);
    // test 阶段绩效 = 冻结参数 k=2 → 120
    expect(run.windows[0]!.test.status).toBe("succeeded");
    expect(run.windows[0]!.test.totalReturnPct).toBe(120);
    expect(run.windows[0]!.test.parameterSetFrozen).toBe(true);
  });

  it("冻结选择为下中位数（显式非 argmax）：3 格点收益 10/20/30 → 选 20（k=2）", () => {
    const run = runWalkForward(makeRequest());
    const frozen = run.windows[0]!.frozen!;
    expect(frozen.parameterSet).toEqual({ k: 2 });
    expect(frozen.trainTotalReturnPct).toBe(20);
    expect(frozen.selection).toBe("median-qualified");
  });

  it("冻结纪律实证：篡改 test 数据（返回极端值）不影响冻结参数", () => {
    const runA = runWalkForward(makeRequest());
    const runB = runWalkForward(makeRequest({
      testEvaluatorFactory: () => () => ok(999999, 0.1),
    }));
    expect(runB.windows[0]!.test.totalReturnPct).toBe(999999);
    // 冻结参数完全由 train 决定，与 test 返回无关
    expect(runA.windows[0]!.frozen!.parameterSetKey).toBe(runB.windows[0]!.frozen!.parameterSetKey);
    expect(runA.windows[0]!.frozen!.parameterSet).toEqual(runB.windows[0]!.frozen!.parameterSet);
  });

  it("确定性：注入 runId/createdAt/seed 后两次运行深比较一致（含 fingerprint）", () => {
    const request = makeRequest({ method: "random", seed: 42, budget: 4, runId: "WFA-FIXED-0001" });
    const runA = runWalkForward(request);
    const runB = runWalkForward(request);
    expect(serializeWalkForwardRun(runA)).toBe(serializeWalkForwardRun(runB));
    expect(runA.fingerprint).toBe(runB.fingerprint);
  });

  it("无合格参数（全部坏点）→ frozen=null，test skipped 记 WFO19_NO_QUALIFIED_PARAMETERS", () => {
    const run = runWalkForward(makeRequest({
      optimizeEvaluatorFactory: () => () => ok(30, 40), // 回撤 40 > 阈值 15 → 坏点
    }));
    expect(run.windows[0]!.frozen).toBeNull();
    expect(run.windows[0]!.test.status).toBe("skipped");
    expect(run.windows[0]!.test.skipReasonCode).toBe("WFO19_NO_QUALIFIED_PARAMETERS");
    expect(run.aggregate.testedWindowCount).toBe(0);
    expect(run.aggregate.skippedWindowCount).toBe(6);
    expect(run.freezeIntegrity.passed).toBe(true); // skipped 无冻结不违例
  });

  it("test 评估器抛错 → skipped 记 WFO19_TEST_EVALUATOR_THREW", () => {
    const run = runWalkForward(makeRequest({
      testEvaluatorFactory: () => () => {
        throw new Error("boom");
      },
    }));
    expect(run.windows[0]!.test.status).toBe("skipped");
    expect(run.windows[0]!.test.skipReasonCode).toBe("WFO19_TEST_EVALUATOR_THREW");
    expect(run.windows[0]!.test.error).toContain("boom");
  });

  it("test 评估器返回 failed → skipped 记 WFO19_TEST_EVALUATION_FAILED", () => {
    const run = runWalkForward(makeRequest({
      testEvaluatorFactory: () => () => ({ status: "failed", error: "no data" }),
    }));
    expect(run.windows[0]!.test.skipReasonCode).toBe("WFO19_TEST_EVALUATION_FAILED");
  });

  it("请求校验：非法 method / 缺 splitConfig / random 缺 seed → 抛错", () => {
    expect(() => runWalkForward(makeRequest({ method: "invalid" as never }))).toThrow(/method/);
    expect(() => runWalkForward(makeRequest({ splitConfig: undefined }))).toThrow(/splitConfig/);
    expect(() => runWalkForward(makeRequest({ method: "random" }))).toThrow(/seed/);
    expect(validateWalkForwardRequest(makeRequest())).toEqual([]);
  });

  it("anchored 模式端到端：Train 段逐窗扩张，冻结纪律仍成立", () => {
    const run = runWalkForward(makeRequest({
      tradeDates: tradeDates(14),
      splitConfig: { mode: "anchored", trainWindow: 4, testWindow: 2, step: 1 },
    }));
    expect(run.windows.length).toBeGreaterThan(0);
    expect(run.freezeIntegrity.passed).toBe(true);
    expect(run.windows[1]!.train.trainDayCount).toBe(5);
  });

  it("computeWalkForwardAggregate：IS→OOS 退化（oosDegradationPp）如实呈现", () => {
    const run = runWalkForward(makeRequest());
    const aggregate = computeWalkForwardAggregate(run.windows);
    // meanTrain = 20（k=2 收益），meanTest = 120 → 退化 = +100
    expect(aggregate.meanTrainTotalReturnPct).toBe(20);
    expect(aggregate.meanTestTotalReturnPct).toBe(120);
    expect(aggregate.oosDegradationPp).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ④ 序列化（serialize.ts）
// ---------------------------------------------------------------------------

describe("④ 序列化 / 反序列化 / 指纹（serialize.ts）", () => {
  it("round-trip：serialize → deserialize 深比较一致，指纹相同", () => {
    const run = runWalkForward(makeRequest({ method: "random", seed: 7, budget: 3, runId: "WFA-RT-0001" }));
    const json = serializeWalkForwardRun(run);
    const restored = deserializeWalkForwardRun(json);
    expect(restored).toEqual(run);
    expect(restored.fingerprint).toBe(run.fingerprint);
  });

  it("篡改拒绝：改动字段后反序列化抛指纹不匹配", () => {
    const run = runWalkForward(makeRequest({ method: "random", seed: 7, budget: 3, runId: "WFA-TP-0001" }));
    const parsed = JSON.parse(serializeWalkForwardRun(run)) as WalkForwardRun;
    parsed.windows[0]!.test.totalReturnPct = -999999;
    expect(() => deserializeWalkForwardRun(JSON.stringify(parsed)))
      .toThrow(/WFO19_RUN_FINGERPRINT_MISMATCH/);
  });

  it("结构校验：非法 recordKind / recordVersion → issues", () => {
    const run = runWalkForward(makeRequest({ runId: "WFA-V-0001" }));
    const bad = { ...run, recordKind: "NOT_WFO" };
    expect(validateWalkForwardRun(bad).issues.some((i) => i.code === "WFO19_RUN_KIND_MISMATCH")).toBe(true);
    const badVersion = { ...run, recordVersion: 99 };
    expect(validateWalkForwardRun(badVersion).issues.some((i) => i.code === "WFO19_RUN_VERSION_MISMATCH")).toBe(true);
    expect(validateWalkForwardRun(run).valid).toBe(true);
  });
});
