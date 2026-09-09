/**
 * STEP 17 / C-17.2 — Rolling Optimization 测试。
 *
 * 覆盖（本任务验收 ①-⑦）：
 *   ① 窗口生成正确（交易日锚定决策验证：边界/滑动/重叠/不足窗报错/配置非法）；
 *   ② 窗内搜索复用正确（与 C-17.1 runParameterSearch 对照；random 派生种子逐窗推进）；
 *   ③ 跨窗稳定性判定（构造「参数 A 跨窗稳好、参数 B 单窗好他窗差」断言候选区正确、
 *      显式非 argmax；minEvaluatedWindows 口径门）；
 *   ④ RollingOptimizationRun 记录完整（窗列表/逐窗结果/结论/候选/fingerprint）round-trip
 *      + 篡改拒绝（嵌套窗内被评样本 / 顶层候选绩效 / windowIndex）；
 *   ⑤ 确定性（同 runId + createdAt 两次运行深比较相等）；
 *   ⑥ 端到端（假 evaluator 证明 滚动窗→每窗搜索→跨窗汇总→候选 闭环）；
 *   ⑦ 退化输入（空日期序列 / 空参数空间 / 无合格窗 / random 缺 seed / budget 非法）。
 */

import { describe, expect, it } from "vitest";
import type { ParameterSpace } from "../parameterSpace";
import { runParameterSearch } from "../parameterSearch/run";
import type {
  ParameterSearchEvaluatedSample,
  ParameterSearchEvaluator,
  ParameterSearchSampleOutcome,
} from "../parameterSearch/types";
import { runRollingOptimization } from "./run";
import { buildRollingOptimizationCandidates } from "./candidate";
import { resolveRollingStabilityConfig, analyzeRollingConsistency } from "./stability";
import { generateRollingOptimizationWindows, validateRollingTradeDates } from "./windows";
import {
  computeRollingOptimizationRunFingerprint,
  deserializeRollingOptimizationCandidate,
  deserializeRollingOptimizationRun,
  serializeRollingOptimizationCandidate,
  serializeRollingOptimizationRun,
  validateRollingOptimizationRun,
} from "./serialize";
import {
  DEFAULT_REGION_ANALYSIS_CONFIG,
} from "../parameterSearch/types";
import {
  ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND,
  ROLLING_OPTIMIZATION_RUN_RECORD_KIND,
  type RollingOptimizationRun,
  type RollingWindowObservation,
} from "./types";

// ---------------------------------------------------------------------------
// 测试 helpers
// ---------------------------------------------------------------------------

function ok(
  totalReturnPct: number,
  maxDrawdownPct: number,
  tradeCount: number | null = 1,
): ParameterSearchSampleOutcome {
  return { status: "succeeded", metrics: { totalReturnPct, maxDrawdownPct, tradeCount } };
}

/** 生成 count 个连续「交易日」标签（YYYY-MM-DD，自 2024-01-01 起）。 */
function tradeDates(count: number): string[] {
  const dates: string[] = [];
  for (let index = 0; index < count; index++) {
    const day = index + 1;
    dates.push(`2024-01-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

function makeSample(
  parameterSet: Record<string, number | string | boolean>,
  totalReturnPct: number,
  maxDrawdownPct: number,
): ParameterSearchEvaluatedSample {
  return {
    parameterSet,
    status: "succeeded",
    totalReturnPct,
    maxDrawdownPct,
    tradeCount: 1,
    error: null,
  };
}

const DEFAULT_STRATEGY = { strategyId: "strategy-roll", strategyVersion: "1.0.0" };

const FIXED_TIME = "2026-09-07T00:00:00.000Z";

// ---------------------------------------------------------------------------
// ① 窗口生成（交易日锚定）
// ---------------------------------------------------------------------------

describe("① 滚动窗口生成 — 交易日锚定决策验证", () => {
  it("窗口锚定在数据集实际交易日上：切出的是 tradeDates 的真实切片（含空隙日期），非日历天算术", () => {
    // 含空隙的交易日序列（1-04 / 1-07 / 1-10 为休市日不在列表中）
    const dates = [
      "2024-01-02", "2024-01-03", "2024-01-05",
      "2024-01-06", "2024-01-08", "2024-01-09",
      "2024-01-11", "2024-01-12",
    ];
    const windows = generateRollingOptimizationWindows(dates, { windowLength: 3, stepLength: 2 });
    expect(windows).toHaveLength(3); // 起点 0/2/4；起点 6 只剩 2 日放不下完整窗
    expect(windows[0]).toMatchObject({
      windowIndex: 0,
      firstTradeDate: dates[0],
      lastTradeDate: dates[2],
      tradeDayCount: 3,
    });
    expect(windows[0]!.tradeDates).toEqual(["2024-01-02", "2024-01-03", "2024-01-05"]);
    // 起点 = windowIndex * stepLength（下标），在含空隙日历上能正确定位
    expect(windows[1]!.firstTradeDate).toBe(dates[2]);
    expect(windows[2]!.firstTradeDate).toBe(dates[4]);
    expect(windows[2]!.lastTradeDate).toBe(dates[6]);
  });

  it("重叠窗口（stepLength < windowLength）：相邻窗共享日期、windowIndex 递增", () => {
    const dates = tradeDates(10);
    const windows = generateRollingOptimizationWindows(dates, { windowLength: 4, stepLength: 2 });
    expect(windows).toHaveLength(4); // 起点 0/2/4/6；起点 8 只剩 2 日
    expect(windows[0]!.tradeDates).toEqual(dates.slice(0, 4));
    expect(windows[1]!.tradeDates).toEqual(dates.slice(2, 6));
    expect(windows[3]!.tradeDates).toEqual(dates.slice(6, 10));
    windows.forEach((window, index) => expect(window.windowIndex).toBe(index));
  });

  it("无缝平铺（stepLength === windowLength）：相邻窗首尾相接，尾部不足一窗的数据不参与", () => {
    const dates = tradeDates(5);
    const windows = generateRollingOptimizationWindows(dates, { windowLength: 2, stepLength: 2 });
    expect(windows).toHaveLength(2);
    expect(windows[0]!.firstTradeDate).toBe("2024-01-01");
    expect(windows[1]!.firstTradeDate).toBe("2024-01-03");
  });

  it("stepLength > windowLength：窗间留空（数据不参与），仍按完整窗口推进", () => {
    const dates = tradeDates(8);
    const windows = generateRollingOptimizationWindows(dates, { windowLength: 2, stepLength: 3 });
    expect(windows).toHaveLength(3);
    expect(windows[0]!.tradeDates).toEqual(["2024-01-01", "2024-01-02"]);
    expect(windows[1]!.tradeDates).toEqual(["2024-01-04", "2024-01-05"]);
    expect(windows[2]!.tradeDates).toEqual(["2024-01-07", "2024-01-08"]);
  });

  it("maxWindows 仅截断窗口个数，不改变前序窗口几何", () => {
    const dates = tradeDates(10);
    const windows = generateRollingOptimizationWindows(dates, { windowLength: 4, stepLength: 2, maxWindows: 2 });
    expect(windows).toHaveLength(2);
    expect(windows[0]!.tradeDates).toEqual(dates.slice(0, 4));
    expect(windows[1]!.tradeDates).toEqual(dates.slice(2, 6));
  });

  it("交易日不足第 0 个完整窗口 → 结构化抛错（不静默空数组）", () => {
    const dates = tradeDates(3);
    expect(() => generateRollingOptimizationWindows(dates, { windowLength: 4, stepLength: 1 }))
      .toThrow(/不足以容纳第 0 个完整窗口/);
    expect(() => generateRollingOptimizationWindows([], { windowLength: 2, stepLength: 1 }))
      .toThrow(/不能为空/);
  });

  it("窗口配置非法（windowLength/stepLength < 1）→ 抛错", () => {
    expect(() => generateRollingOptimizationWindows(tradeDates(5), { windowLength: 0, stepLength: 1 })).toThrow(/windowLength/);
    expect(() => generateRollingOptimizationWindows(tradeDates(5), { windowLength: 2, stepLength: 0 })).toThrow(/stepLength/);
    expect(() => generateRollingOptimizationWindows(tradeDates(5), { windowLength: 2, stepLength: 1, maxWindows: 0 })).toThrow(/maxWindows/);
  });

  it("交易日序列非法（格式错误 / 重复 / 乱序）→ 结构化抛错", () => {
    expect(validateRollingTradeDates([]).valid).toBe(false);
    expect(validateRollingTradeDates(["2024/01/02"]).valid).toBe(false);
    expect(validateRollingTradeDates(["2024-01-02", "2024-01-02"]).issues[0]!.code).toBe("ROLLING_TRADE_DATES_NOT_ASCENDING");
    expect(validateRollingTradeDates(["2024-01-03", "2024-01-02"]).valid).toBe(false);
    expect(validateRollingTradeDates(tradeDates(3)).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② 窗内搜索复用 C-17.1 runParameterSearch
// ---------------------------------------------------------------------------

describe("② 窗内搜索复用 — 与 C-17.1 runParameterSearch 对照 + random 派生种子", () => {
  it("grid 逐窗：窗 0 的 SearchRun 与直接 runParameterSearch 深比较一致；元信息正确", () => {
    const dates = tradeDates(6);
    const space: ParameterSpace = {
      parameters: [{ type: "integer", name: "theta", min: 1, max: 2, step: 1 }],
    };
    const runId = "ROLLING-grid-cmp";
    const run = runRollingOptimization({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      tradeDates: dates,
      windowConfig: { windowLength: 2, stepLength: 2 },
      evaluatorFactory: (window) => (ps) => ok(10 + (ps.theta as number) + window.windowIndex, 3),
      runId,
      createdAt: FIXED_TIME,
    });
    expect(run.windowCount).toBe(3);
    expect(run.windows[0]!.windowId).toBe(`${runId}-w0`);
    expect(run.windows[0]!.searchRun.searchRunId).toBe(`${runId}-w0-search`);
    expect(run.windows[0]!.searchRun.method).toBe("grid");
    expect(run.windows[0]!.searchRun.seed).toBeNull();

    const direct = runParameterSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      evaluator: (ps) => ok(10 + (ps.theta as number) + 0, 3),
      searchRunId: `${runId}-w0-search`,
      createdAt: FIXED_TIME,
    });
    // 逐窗结果与直接搜索一致（复用 runParameterSearch 且窗上下文正确传递）
    expect(run.windows[0]!.searchRun.evaluatedSamples).toEqual(direct.evaluatedSamples);
    expect(run.windows[0]!.searchRun.region).toEqual(direct.region);
    expect(run.windows[0]!.firstTradeDate).toBe("2024-01-01");
    expect(run.windows[0]!.lastTradeDate).toBe("2024-01-02");
    expect(run.windows[0]!.tradeDayCount).toBe(2);
  });

  it("random 逐窗：每窗 seed = 基准 seed + windowIndex，确定性可复现", () => {
    const dates = tradeDates(9);
    const space: ParameterSpace = {
      parameters: [{ type: "integer", name: "x", min: 1, max: 20, step: 1 }],
    };
    const request = {
      ...DEFAULT_STRATEGY,
      method: "random" as const,
      parameterSpace: space,
      tradeDates: dates,
      windowConfig: { windowLength: 3, stepLength: 3 },
      seed: 5,
      budget: 4,
      evaluatorFactory: () => (ps) => ok((ps.x as number) * 0.5, 5),
      runId: "ROLLING-rand-derive",
      createdAt: FIXED_TIME,
    };
    const run = runRollingOptimization(request);
    expect(run.windowCount).toBe(3);
    run.windows.forEach((entry, index) => {
      expect(entry.searchRun.method).toBe("random");
      expect(entry.searchRun.seed).toBe(5 + index);
      expect(entry.searchRun.requestedBudget).toBe(4);
      expect(entry.searchRun.sampleCount).toBe(4);
      expect(entry.searchRun.searchRunId).toBe(`ROLLING-rand-derive-w${index}-search`);
    });
    const again = runRollingOptimization(request);
    expect(again).toEqual(run);
  });
});

// ---------------------------------------------------------------------------
// ③ 跨窗稳定性判定（显式非 argmax）
// ---------------------------------------------------------------------------

describe("③ 跨窗稳定性判定 — 非 argmax 一致区交集", () => {
  it("构造「A 跨窗稳好、B 单窗好他窗差、高收益坏点被排除」→ 只有 A 成候选", () => {
    const dates = tradeDates(8);
    const space: ParameterSpace = {
      parameters: [{ type: "integer", name: "theta", min: 1, max: 4, step: 1 }],
    };
    // w0..w3：theta1 稳好；theta2 偶窗好/奇窗高收益高回撤；theta3 恒高回撤；theta4 恒低收益
    const run = runRollingOptimization({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      tradeDates: dates,
      windowConfig: { windowLength: 2, stepLength: 2 },
      evaluatorFactory: (window) => (ps) => {
        const theta = ps.theta as number;
        const w = window.windowIndex;
        if (theta === 1) return ok(10 + w, 2);
        if (theta === 2) return w % 2 === 0 ? ok(12 + w, 3) : ok(60, 40); // 高收益 + 高回撤 → 坏点
        if (theta === 3) return ok(30, 40); // 恒坏点
        return ok(-5, 3); // 恒低收益
      },
      runId: "ROLLING-stability-scenario",
      createdAt: FIXED_TIME,
    });

    const stability = run.stability;
    expect(run.windowCount).toBe(4);
    expect(stability.verdict).toBe("stable-across-windows");
    expect(stability.windowCount).toBe(4);
    expect(stability.uniqueParameterCount).toBe(4);
    expect(stability.everQualifiedParameterCount).toBe(2); // theta1/theta2 至少一窗合格
    expect(stability.consistentParameterCount).toBe(1);

    const theta1 = stability.parameters.find((stat) => stat.parameterSet.theta === 1)!;
    expect(theta1.evaluatedWindowCount).toBe(4);
    expect(theta1.qualifiedWindowCount).toBe(4);
    expect(theta1.consistent).toBe(true);
    expect(theta1.qualifiedWindowRatePct).toBe(100);
    expect(theta1.meanTotalReturnPct).toBeCloseTo(11.5, 6);
    expect(theta1.medianTotalReturnPct).toBeCloseTo(11.5, 6);

    // B：单窗好（偶窗）他窗差（奇窗坏点）→ 不 consistent，且高收益(60%)被明确拒绝
    const theta2 = stability.parameters.find((stat) => stat.parameterSet.theta === 2)!;
    expect(theta2.consistent).toBe(false);
    expect(theta2.qualifiedWindowCount).toBe(2);
    expect(theta2.badDrawdownWindowCount).toBe(2);
    expect(theta2.qualifiedWindowRatePct).toBeCloseTo(50, 6);

    // 显式非 argmax：候选参数集只含 theta1（theta1 在 w0 收益 10，低于 w0 的 theta2=12？见说明——
    // 候选区判定按「全部窗合格」交集，不按单窗收益挑参）
    const candidates = run.candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.parameterSet).toEqual({ theta: 1 });
    expect(candidates[0]!.recordKind).toBe(ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND);
    expect(candidates[0]!.strategyKind).toBe("candidate");
    expect(candidates[0]!.performance.meanTotalReturnPct).toBeCloseTo(11.5, 6);
    expect(candidates[0]!.consistency.qualifiedWindowCount).toBe(4);
    expect(candidates[0]!.consistency.qualifiedWindowIds).toHaveLength(4);
  });

  it("分析层直接喂手造观察：consistent 判定 + minEvaluatedWindows 门生效", () => {
    const obs: RollingWindowObservation[] = [
      {
        windowId: "w0", windowIndex: 0,
        evaluatedSamples: [
          makeSample({ x: 1 }, 12, 2),
          makeSample({ x: 2 }, 15, 25), // w0 坏点
        ],
      },
      {
        windowId: "w1", windowIndex: 1,
        evaluatedSamples: [
          makeSample({ x: 1 }, 8, 3),
          makeSample({ x: 2 }, 20, 4), // w1 合格
        ],
      },
    ];
    const config1 = resolveRollingStabilityConfig({ minEvaluatedWindows: 1 }).config;
    const report1 = analyzeRollingConsistency(obs, DEFAULT_REGION_ANALYSIS_CONFIG, config1);
    expect(report1.verdict).toBe("stable-across-windows");
    const x1 = report1.parameters.find((stat) => stat.parameterSet.x === 1)!;
    const x2 = report1.parameters.find((stat) => stat.parameterSet.x === 2)!;
    expect(x1.consistent).toBe(true);
    expect(x2.consistent).toBe(false); // 只在 w1 合格，w0 坏点

    // minEvaluatedWindows 收紧后 x1 仍一致（两窗都被评估且合格）
    const config2 = resolveRollingStabilityConfig({ minEvaluatedWindows: 2 }).config;
    const report2 = analyzeRollingConsistency(obs, DEFAULT_REGION_ANALYSIS_CONFIG, config2);
    expect(report2.consistentParameterCount).toBe(1);
  });

  it("minEvaluatedWindows > 被评估窗口数 → 不判 consistent（避免单窗证据冒充跨窗稳定）", () => {
    const obs: RollingWindowObservation[] = [
      { windowId: "w0", windowIndex: 0, evaluatedSamples: [makeSample({ x: 9 }, 15, 2)] },
      { windowId: "w1", windowIndex: 1, evaluatedSamples: [] }, // x=9 未在 w1 被采样（如 random 子集）
    ];
    const lenient = resolveRollingStabilityConfig({ minEvaluatedWindows: 1 }).config;
    expect(analyzeRollingConsistency(obs, DEFAULT_REGION_ANALYSIS_CONFIG, lenient).consistentParameterCount).toBe(1);
    const strict = resolveRollingStabilityConfig({ minEvaluatedWindows: 2 }).config;
    expect(analyzeRollingConsistency(obs, DEFAULT_REGION_ANALYSIS_CONFIG, strict).consistentParameterCount).toBe(0);
  });

  it("全部窗口无合格样本 → verdict=no-qualified-parameters，候选为空", () => {
    // 无合格样本：两窗全部超回撤门（高收益 + 高回撤 / 负收益 + 高回撤）
    const allBad: RollingWindowObservation[] = [
      { windowId: "w0", windowIndex: 0, evaluatedSamples: [makeSample({ x: 1 }, 30, 40), makeSample({ x: 2 }, 35, 45)] },
      { windowId: "w1", windowIndex: 1, evaluatedSamples: [makeSample({ x: 1 }, -8, 30), makeSample({ x: 2 }, -5, 28)] },
    ];
    const config = resolveRollingStabilityConfig({}).config;
    const report = analyzeRollingConsistency(allBad, DEFAULT_REGION_ANALYSIS_CONFIG, config);
    expect(report.verdict).toBe("no-qualified-parameters");
    expect(report.consistentParameterCount).toBe(0);
    expect(report.parameters).toHaveLength(0);
    expect(buildRollingOptimizationCandidates({
      runId: "ROLLING-empty-cand",
      strategyId: "s",
      strategyVersion: "1",
      report,
      config,
    })).toHaveLength(0);
  });

  it("单窗好他窗差 → verdict=no-consistent-parameters（候选为空，明确不给可推广结论）", () => {
    const obs: RollingWindowObservation[] = [
      { windowId: "w0", windowIndex: 0, evaluatedSamples: [makeSample({ x: 1 }, 15, 3)] },
      {
        windowId: "w1", windowIndex: 1,
        evaluatedSamples: [makeSample({ x: 1 }, -4, 3), makeSample({ x: 2 }, 15, 3)], // x1 低收益；x2 新合格
      },
    ];
    const config = resolveRollingStabilityConfig({}).config;
    const report = analyzeRollingConsistency(obs, DEFAULT_REGION_ANALYSIS_CONFIG, config);
    expect(report.verdict).toBe("no-consistent-parameters");
    expect(report.consistentParameterCount).toBe(0);
    expect(report.everQualifiedParameterCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ④ RollingOptimizationRun 记录完整 + round-trip + 篡改拒绝
// ---------------------------------------------------------------------------

describe("④ RollingOptimizationRun 记录 — 完整性 + round-trip + 篡改拒绝", () => {
  function makeRun(): RollingOptimizationRun {
    const dates = tradeDates(6);
    return runRollingOptimization({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: { parameters: [{ type: "integer", name: "theta", min: 1, max: 2, step: 1 }] },
      tradeDates: dates,
      windowConfig: { windowLength: 2, stepLength: 2 },
      evaluatorFactory: (window) => () => ok(8 + window.windowIndex, 2),
      runId: "ROLLING-roundtrip",
      createdAt: FIXED_TIME,
    });
  }

  it("记录含 窗列表/逐窗 SearchRun/跨窗结论/候选/指纹；validate 通过", () => {
    const run = makeRun();
    expect(run.recordKind).toBe(ROLLING_OPTIMIZATION_RUN_RECORD_KIND);
    expect(run.method).toBe("grid");
    expect(run.seed).toBeNull();
    expect(run.windowCount).toBe(3);
    expect(run.windows).toHaveLength(3);
    expect(run.windows[0]!.windowId).toBe("ROLLING-roundtrip-w0");
    expect(run.windows[0]!.searchRun.candidates.length).toBeGreaterThan(0);
    expect(run.windows[2]!.lastTradeDate).toBe("2024-01-06");
    expect(run.parameterSpaceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(run.tradeDatesFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(run.stability.windowCount).toBe(3);
    expect(run.candidates.length).toBeGreaterThan(0);
    expect(run.createdAt).toBe(FIXED_TIME);
    expect(run.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(run.fingerprint).toBe(computeRollingOptimizationRunFingerprint(run));
    expect(validateRollingOptimizationRun(run).valid).toBe(true);
  });

  it("serialize → deserialize round-trip：全等、结构校验通过、指纹不变", () => {
    const run = makeRun();
    const json = serializeRollingOptimizationRun(run);
    const restored = deserializeRollingOptimizationRun(json);
    expect(restored).toEqual(run);
    expect(validateRollingOptimizationRun(restored).valid).toBe(true);
  });

  it("篡改嵌套窗内 SearchRun 的被评样本绩效 → 反序列化指纹复核失败", () => {
    const run = makeRun();
    const tampered = JSON.parse(serializeRollingOptimizationRun(run)) as RollingOptimizationRun;
    tampered.windows[0]!.searchRun.evaluatedSamples[0]!.totalReturnPct = 999;
    expect(() => deserializeRollingOptimizationRun(JSON.stringify(tampered))).toThrow(/指纹不匹配/);
  });

  it("篡改顶层跨窗候选绩效 → 反序列化指纹复核失败；篡改 windowIndex → 结构校验拒绝", () => {
    const run = makeRun();
    const tamperedCandidate = JSON.parse(serializeRollingOptimizationCandidate(run.candidates[0]!));
    tamperedCandidate.performance.meanTotalReturnPct = 999;
    expect(() => deserializeRollingOptimizationCandidate(JSON.stringify(tamperedCandidate))).toThrow(/指纹不匹配/);

    const tamperedRun = JSON.parse(serializeRollingOptimizationRun(run)) as RollingOptimizationRun;
    tamperedRun.windows[0]!.windowIndex = 5;
    expect(validateRollingOptimizationRun(tamperedRun).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 确定性
// ---------------------------------------------------------------------------

describe("⑤ 确定性 — 同请求两次运行深比较", () => {
  it("注入 runId + createdAt → 整条记录（含逐窗 SearchRun 与指纹）深比较相等", () => {
    const dates = tradeDates(12);
    const space: ParameterSpace = {
      parameters: [{ type: "integer", name: "lookback", min: 5, max: 15, step: 5 }],
    };
    const request = {
      ...DEFAULT_STRATEGY,
      method: "grid" as const,
      parameterSpace: space,
      tradeDates: dates,
      windowConfig: { windowLength: 4, stepLength: 2 },
      evaluatorFactory: (window) => (ps) => ok(10 + (ps.lookback as number) / 5 + window.windowIndex, 3),
      runId: "ROLLING-determinism",
      createdAt: FIXED_TIME,
    };
    const run1 = runRollingOptimization(request);
    const run2 = runRollingOptimization(request);
    expect(run2).toEqual(run1);
    expect(run2.fingerprint).toBe(run1.fingerprint);
    expect(run2.windows[1]!.searchRun.fingerprint).toBe(run1.windows[1]!.searchRun.fingerprint);
  });

  it("random 两次运行（同 seed）采样与评估完全一致", () => {
    const dates = tradeDates(10);
    const request = {
      ...DEFAULT_STRATEGY,
      method: "random" as const,
      parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 30, step: 1 }] },
      tradeDates: dates,
      windowConfig: { windowLength: 3, stepLength: 3 },
      seed: 42,
      budget: 5,
      evaluatorFactory: () => (ps) => ok((ps.x as number) / 10, 4),
      runId: "ROLLING-determinism-rand",
      createdAt: FIXED_TIME,
    };
    const run1 = runRollingOptimization(request);
    const run2 = runRollingOptimization(request);
    expect(run1).toEqual(run2);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 端到端闭环（假 evaluator）
// ---------------------------------------------------------------------------

describe("⑥ 端到端 — 滚动窗→每窗搜索→跨窗汇总→候选 闭环", () => {
  it("每窗在各自的交易日切片上搜索，跨窗稳定参数成为候选（含溯源一致）", () => {
    const dates = tradeDates(10);
    const space: ParameterSpace = {
      parameters: [{ type: "integer", name: "k", min: 1, max: 3, step: 1 }],
    };
    const run = runRollingOptimization({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      tradeDates: dates,
      windowConfig: { windowLength: 3, stepLength: 2 }, // 起点 0/2/4/6 → 4 窗（起点 8 只剩 2 日）
      evaluatorFactory: (window) => (ps) => {
        // k=1 恒稳好；k=2 在后半窗（windowIndex>=2）转坏；k=3 恒坏点
        const k = ps.k as number;
        const w = window.windowIndex;
        if (k === 1) return ok(9 + w, 2);
        if (k === 2) return w < 2 ? ok(11, 3) : ok(50, 45);
        return ok(20, 30);
      },
      runId: "ROLLING-e2e",
      createdAt: FIXED_TIME,
    });
    // tradeDates=10, windowLength=3, step=2 → 起点 0/2/4/6，起点 8 只剩 2 日 → 4 窗
    expect(run.windowCount).toBe(4);
    expect(run.windows.map((entry) => entry.windowId)).toEqual([
      "ROLLING-e2e-w0", "ROLLING-e2e-w1", "ROLLING-e2e-w2", "ROLLING-e2e-w3",
    ]);
    // 每窗切片正确喂给评估器（经窗内样本数验证）
    run.windows.forEach((entry) => {
      expect(entry.searchRun.sampleCount).toBe(3);
      expect(entry.searchRun.region.qualifiedCount).toBeGreaterThan(0);
    });
    expect(run.stability.verdict).toBe("stable-across-windows");
    expect(run.candidates).toHaveLength(1);
    const candidate = run.candidates[0]!;
    expect(candidate.parameterSet).toEqual({ k: 1 });
    // 溯源：候选覆盖窗 ID 与 stability 一致、且每个被评估窗都合格
    expect(candidate.consistency.qualifiedWindowCount).toBe(4);
    expect(candidate.candidateId).toBe("ROLLING-e2e-candidate-0");
    expect(run.stability.parameters.find((stat) => stat.parameterSet.k === 1)!.consistent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 退化输入 / 请求校验
// ---------------------------------------------------------------------------

describe("⑦ 退化输入 / 参数校验", () => {
  const baseRequest = {
    ...DEFAULT_STRATEGY,
    method: "grid" as const,
    parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 2, step: 1 }] },
    tradeDates: tradeDates(6),
    windowConfig: { windowLength: 2, stepLength: 2 },
    evaluatorFactory: () => () => ok(5, 3),
  };

  it("空交易日序列 → 请求校验抛错", () => {
    expect(() => runRollingOptimization({ ...baseRequest, tradeDates: [] })).toThrow(/不能为空/);
  });

  it("random 缺 seed → 抛错；budget 非法 → 抛错", () => {
    expect(() =>
      runRollingOptimization({ ...baseRequest, method: "random" }),
    ).toThrow(/seed/);
    expect(() =>
      runRollingOptimization({ ...baseRequest, method: "random", seed: 1, budget: 0 }),
    ).toThrow(/budget/);
  });

  it("非法参数空间（min > max）→ 抛错", () => {
    expect(() =>
      runRollingOptimization({
        ...baseRequest,
        parameterSpace: { parameters: [{ type: "integer", name: "x", min: 5, max: 1, step: 1 }] },
      }),
    ).toThrow(/不能大于/);
  });

  it("evaluatorFactory 非法 → 抛错", () => {
    expect(() =>
      runRollingOptimization({
        ...baseRequest,
        evaluatorFactory: undefined as unknown as (window: never) => ParameterSearchEvaluator,
      }),
    ).toThrow(/evaluatorFactory/);
  });

  it("空 strategyId → 抛错", () => {
    expect(() => runRollingOptimization({ ...baseRequest, strategyId: "" })).toThrow(/strategyId/);
  });

  it("空参数空间 + 多窗：每窗单空样本、结构化成功（不抛错）", () => {
    const run = runRollingOptimization({
      ...baseRequest,
      parameterSpace: { parameters: [] },
      evaluatorFactory: () => () => ok(6, 3),
      runId: "ROLLING-degenerate-space",
      createdAt: FIXED_TIME,
    });
    expect(run.windowCount).toBe(3);
    run.windows.forEach((entry) => {
      expect(entry.searchRun.sampleCount).toBe(1);
      expect(entry.searchRun.evaluatedSamples[0]!.parameterSet).toEqual({});
    });
    // 空参数集在两窗都合格 → 稳定跨窗候选成立（结构与语义自洽，非静默空）
    expect(run.stability.consistentParameterCount).toBe(1);
    expect(run.candidates[0]!.parameterSet).toEqual({});
  });

  it("全部窗评估均不达标 → stability 空结论、无候选（结构化，不抛错）", () => {
    const run = runRollingOptimization({
      ...baseRequest,
      evaluatorFactory: () => (ps) => ok(30, 40), // 高收益但回撤恒超 15
      runId: "ROLLING-degenerate-bad",
      createdAt: FIXED_TIME,
    });
    expect(run.stability.verdict).toBe("no-qualified-parameters");
    expect(run.candidates).toHaveLength(0);
  });
});
