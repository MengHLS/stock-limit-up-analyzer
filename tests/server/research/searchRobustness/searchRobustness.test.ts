/**
 * ROBUSTNESS-001 §22 — 稳健性分析域单测。
 *
 * 覆盖规格点名的七组：Domain（状态迁移 / 快照 / 配置校验）、Input（gate 四条）、
 * Metrics（离散度六项）、Sensitivity（数值 / 枚举 / 缺邻居）、Stability（全稳 / 全不稳 /
 * 混合 / 零有效邻居）、Multi Parameter（2×2 / 缺格 / 重复 hash）、Determinism（同输入同产物）。
 *
 * 🔴 本文件**不触 DB、不触 Backtest** —— 它证明的是「纯域层在给定输入下的行为」，
 *   「经 tRPC + Drizzle 往返后仍对」由 `docs/evidence/_e2e_robustness_*.mts` 证明（补集关系）。
 */

import { describe, expect, it } from "vitest";
import type { ParameterSearchSpaceDefinition } from "../../../../shared/parameterSearchContracts";
import {
  ROBUSTNESS_RESULT_SORT_FIELDS,
} from "../../../../shared/searchRobustnessContracts";
import { analyzeSearchRobustness } from "../../../../server/research/searchRobustness/analysis";
import {
  expandSearchDomainValues,
  indexOfDomainValue,
} from "../../../../server/research/searchRobustness/domainValues";
import {
  assertRobustnessGate,
  resolveParameterReferenceStatus,
} from "../../../../server/research/searchRobustness/gate";
import {
  buildRobustnessMatrix,
  type RobustnessMatrixRow,
} from "../../../../server/research/searchRobustness/matrix";
import {
  buildNeighborhoodAxes,
  buildSourceIndex,
  computeDispersion,
  combinationLookupKey,
} from "../../../../server/research/searchRobustness/neighborhood";
import { ResearchValidationError } from "../../../../server/research/experimentValidation";
import {
  assertRobustnessRunTransition,
  canTransitionRobustnessRun,
  computeRobustnessProgress,
  generateSearchRobustnessRunId,
  parseRobustnessRunStatus,
  resolveRobustnessAnalysisConfig,
} from "../../../../server/research/searchRobustness/run";
import type {
  RobustnessAnalysisInput,
  RobustnessMetricsSnapshot,
  RobustnessSourceCombination,
  RobustnessSourceResult,
  SearchRobustnessResult,
} from "../../../../server/research/searchRobustness/types";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const CONFIG = {
  returnTolerancePct: 5,
  drawdownTolerancePct: 5,
  neighborDistance: 1,
  minValidNeighbors: 1,
};

/** 2 个 TUNABLE 参数：`a` 枚举 [1,2,3]；`b` 小数区间 0.1/0.2/0.3。 */
function snapshot2x3(): ParameterSearchSpaceDefinition {
  return {
    recordKind: "PARAMETER_SEARCH_SPACE",
    recordVersion: 1,
    strategyId: "cand-test",
    strategyVersion: "1.0.0",
    parameters: [
      {
        name: "a",
        type: "number",
        kind: "TUNABLE",
        required: true,
        search: { mode: "ENUM", values: [1, 2, 3] },
      },
      {
        name: "b",
        type: "number",
        kind: "TUNABLE",
        required: true,
        search: { mode: "DECIMAL_RANGE", min: 0.1, max: 0.3, step: 0.1 },
      },
      {
        name: "fixed_x",
        type: "number",
        kind: "FIXED",
        required: false,
        exclusionReason: "FIXED 参数不进搜索空间",
      },
      {
        name: "derived_y",
        type: "number",
        kind: "DERIVED",
        required: false,
        exclusionReason: "由其他参数推导",
      },
    ],
    notes: [],
  };
}

function metrics(
  totalReturnPct: number,
  maxDrawdownPct: number,
  tradeCount: number | null,
): RobustnessMetricsSnapshot {
  return {
    totalReturnPct,
    annualizedReturnPct: totalReturnPct,
    maxDrawdownPct,
    tradeCount,
    winRatePct: 50,
    profitFactor: 1.5,
  };
}

/** 由「组合 → 指标」表构造分析输入（组合按 3×3 全网格生成，缺项由调用方删除）。 */
function makeInput(input: {
  readonly cells: Readonly<Record<string, RobustnessMetricsSnapshot | null>>;
  readonly combinations?: readonly { readonly a: number; readonly b: number }[];
  readonly config?: typeof CONFIG;
  readonly snapshot?: ParameterSearchSpaceDefinition;
}): RobustnessAnalysisInput {
  const combos =
    input.combinations ??
    [1, 2, 3].flatMap((a) => [0.1, 0.2, 0.3].map((b) => ({ a, b })));
  const combinations: RobustnessSourceCombination[] = combos.map((item, index) => ({
    parameterHash: `hash-${String(item.a)}-${String(item.b)}`,
    combinationIndex: index,
    parameters: { a: item.a, b: item.b },
  }));
  const results: RobustnessSourceResult[] = [];
  for (const combination of combinations) {
    const key = `${String(combination.parameters["a"])}|${String(combination.parameters["b"])}`;
    if (!(key in input.cells)) continue;
    const value = input.cells[key] as RobustnessMetricsSnapshot | null;
    if (value === null) {
      results.push({
        parameterHash: combination.parameterHash,
        status: "FAILED",
        error: "夹具：源结果失败",
        metricsSource: "canonical",
        metrics: metrics(0, 0, null),
      });
      continue;
    }
    results.push({
      parameterHash: combination.parameterHash,
      status: "SUCCEEDED",
      error: null,
      metricsSource: "canonical",
      metrics: value,
    });
  }
  return {
    robustnessRunId: "SROB-TEST-0001",
    sourceSearchRunId: "PSRUN-TEST-0001",
    searchSnapshot: input.snapshot ?? snapshot2x3(),
    combinations,
    results,
    config: input.config ?? CONFIG,
  };
}

/** 全网格同值（用来构造「全稳」）。 */
function uniformCells(totalReturnPct: number, maxDrawdownPct: number) {
  const cells: Record<string, RobustnessMetricsSnapshot> = {};
  for (const a of [1, 2, 3]) {
    for (const b of [0.1, 0.2, 0.3]) cells[`${String(a)}|${String(b)}`] = metrics(totalReturnPct, maxDrawdownPct, 10);
  }
  return cells;
}

/**
 * 按**参数取值**定位分析结果。
 *
 * 🔴 不要按 `combinationIndex` 定位：夹具里序号 = 传入数组下标，**移除一个组合就会让
 *   后续序号整体前移** ⇒ 按下标会静默指到另一个组合上（首版实测：断言「通过」但验的是别的对象）。
 */
function findResult(
  outcome: { readonly results: readonly SearchRobustnessResult[] },
  expected: Readonly<Record<string, number | string>>,
): SearchRobustnessResult | undefined {
  return outcome.results.find((result) =>
    Object.entries(expected).every(([key, value]) => result.parameters[key] === value),
  );
}

// ---------------------------------------------------------------------------
// §5.3 口径校验
// ---------------------------------------------------------------------------

describe("稳健性口径解析（§5.3：可配置 / 持久化 / 不写死前端）", () => {
  it("缺省补齐为平台缺省", () => {
    expect(resolveRobustnessAnalysisConfig(undefined)).toEqual({
      returnTolerancePct: 5,
      drawdownTolerancePct: 5,
      neighborDistance: 1,
      minValidNeighbors: 1,
    });
  });

  it("给定即生效（不静默夹取）", () => {
    expect(
      resolveRobustnessAnalysisConfig({
        returnTolerancePct: 0.5,
        drawdownTolerancePct: 20,
        neighborDistance: 2,
        minValidNeighbors: 3,
      }),
    ).toEqual({
      returnTolerancePct: 0.5,
      drawdownTolerancePct: 20,
      neighborDistance: 2,
      minValidNeighbors: 3,
    });
  });

  it("非法口径响亮拒绝（负容差 / 零半径 / 非整数）", () => {
    expect(() => resolveRobustnessAnalysisConfig({ returnTolerancePct: -1 })).toThrow(
      ResearchValidationError,
    );
    expect(() => resolveRobustnessAnalysisConfig({ neighborDistance: 0 })).toThrow(
      ResearchValidationError,
    );
    expect(() => resolveRobustnessAnalysisConfig({ neighborDistance: 1.5 })).toThrow(
      ResearchValidationError,
    );
    expect(() => resolveRobustnessAnalysisConfig({ minValidNeighbors: 0 })).toThrow(
      ResearchValidationError,
    );
    expect(() => resolveRobustnessAnalysisConfig({ drawdownTolerancePct: Number.NaN })).toThrow(
      ResearchValidationError,
    );
  });

  it("错误码为 ROBUSTNESS_CONFIG_INVALID", () => {
    try {
      resolveRobustnessAnalysisConfig({ neighborDistance: 0 });
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchValidationError);
      expect((error as ResearchValidationError).issues[0]?.code).toBe("ROBUSTNESS_CONFIG_INVALID");
    }
  });
});

// ---------------------------------------------------------------------------
// §14 状态机（复用 PS 唯一权威迁移表）
// ---------------------------------------------------------------------------

describe("Robustness Run 状态机（§14）", () => {
  it("与 Search Run 共用同一张迁移表（CREATED/RUNNING/COMPLETED/FAILED/CANCELLED）", () => {
    expect(canTransitionRobustnessRun("CREATED", "RUNNING")).toBe(true);
    expect(canTransitionRobustnessRun("RUNNING", "COMPLETED")).toBe(true);
    expect(canTransitionRobustnessRun("RUNNING", "FAILED")).toBe(true);
    expect(canTransitionRobustnessRun("CREATED", "CANCELLED")).toBe(true);
    expect(canTransitionRobustnessRun("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionRobustnessRun("CREATED", "COMPLETED")).toBe(false);
  });

  it("非法迁移抛本域领域码", () => {
    try {
      assertRobustnessRunTransition("CREATED", "COMPLETED");
      throw new Error("应当抛错");
    } catch (error) {
      expect((error as ResearchValidationError).issues[0]?.code).toBe(
        "ROBUSTNESS_STATUS_TRANSITION_INVALID",
      );
    }
  });

  it("同态重放视为幂等", () => {
    expect(canTransitionRobustnessRun("COMPLETED", "COMPLETED")).toBe(true);
    expect(() => assertRobustnessRunTransition("RUNNING", "RUNNING")).not.toThrow();
  });

  it("状态解析不静默回落", () => {
    expect(parseRobustnessRunStatus("RUNNING")).toBe("RUNNING");
    expect(() => parseRobustnessRunStatus("DONE")).toThrow(ResearchValidationError);
  });

  it("ID 形态 SROB-YYYYMMDD-<suffix>", () => {
    expect(generateSearchRobustnessRunId(new Date("2026-09-19T12:00:00Z"), "ab12cd34")).toBe(
      "SROB-20260919-ab12cd34",
    );
  });

  it("进度：分母为 0 时不得谎报 100%", () => {
    expect(computeRobustnessProgress({ sourceCombinationCount: 0, analyzedCombinationCount: 0 })).toEqual({
      sourceCombinationCount: 0,
      analyzedCombinationCount: 0,
      progressPct: 0,
    });
    expect(computeRobustnessProgress({ sourceCombinationCount: 4, analyzedCombinationCount: 4 }).progressPct).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// §10 Input Gate
// ---------------------------------------------------------------------------

describe("输入 Validity Gate（§10）", () => {
  const base = {
    searchRunId: "PSRUN-1",
    sourceStatus: "COMPLETED",
    combinationCount: 4,
    resultCount: 4,
    metricsSources: ["canonical", "canonical", "canonical", "canonical"],
    observedSearchRunIds: ["PSRUN-1"],
  };

  it("合格输入通过", () => {
    expect(() => assertRobustnessGate(base)).not.toThrow();
  });

  it("未完成 ⇒ ROBUSTNESS_SEARCH_RUN_NOT_COMPLETED", () => {
    for (const status of ["RUNNING", "FAILED", "CANCELLED", "CREATED"]) {
      try {
        assertRobustnessGate({ ...base, sourceStatus: status });
        throw new Error("应当抛错");
      } catch (error) {
        expect((error as ResearchValidationError).issues[0]?.code).toBe(
          "ROBUSTNESS_SEARCH_RUN_NOT_COMPLETED",
        );
      }
    }
  });

  it("无结果 ⇒ ROBUSTNESS_NO_RESULTS", () => {
    try {
      assertRobustnessGate({ ...base, resultCount: 0, metricsSources: [] });
      throw new Error("应当抛错");
    } catch (error) {
      expect((error as ResearchValidationError).issues[0]?.code).toBe("ROBUSTNESS_NO_RESULTS");
    }
  });

  it("非 canonical 结果 ⇒ ROBUSTNESS_INVALID_RESULT_SOURCE（含来源分布）", () => {
    try {
      assertRobustnessGate({
        ...base,
        metricsSources: ["canonical", "evaluators", "canonical", "canonical"],
      });
      throw new Error("应当抛错");
    } catch (error) {
      const issues = (error as ResearchValidationError).issues;
      expect(issues[0]?.code).toBe("ROBUSTNESS_INVALID_RESULT_SOURCE");
      expect(issues[0]?.message).toContain("evaluators=1");
    }
  });

  it("跨 Search Run 混行 ⇒ ROBUSTNESS_SOURCE_MISMATCH（§8 / §21 G 防串线）", () => {
    try {
      assertRobustnessGate({ ...base, observedSearchRunIds: ["PSRUN-1", "PSRUN-OTHER"] });
      throw new Error("应当抛错");
    } catch (error) {
      expect((error as ResearchValidationError).issues[0]?.code).toBe("ROBUSTNESS_SOURCE_MISMATCH");
    }
  });

  it("无组合 ⇒ ROBUSTNESS_NO_COMBINATIONS", () => {
    try {
      assertRobustnessGate({ ...base, combinationCount: 0 });
      throw new Error("应当抛错");
    } catch (error) {
      expect((error as ResearchValidationError).issues[0]?.code).toBe("ROBUSTNESS_NO_COMBINATIONS");
    }
  });
});

// ---------------------------------------------------------------------------
// §12 参数引用状态继承
// ---------------------------------------------------------------------------

describe("参数引用状态继承（§12）", () => {
  it("已筛查 ⇒ verified，且说明里带上被排除的死参数", () => {
    const status = resolveParameterReferenceStatus({
      referenceCheckApplied: true,
      unreferencedTunableCodes: ["dead_a", "dead_b"],
    });
    expect(status.verified).toBe(true);
    expect(status.note).toContain("dead_a");
  });

  it("未筛查 / 历史行 ⇒ unverified 且写明不可假设", () => {
    for (const applied of [false, null, undefined]) {
      const status = resolveParameterReferenceStatus({
        referenceCheckApplied: applied,
        unreferencedTunableCodes: [],
      });
      expect(status.verified).toBe(false);
      expect(status.note).toContain("ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED");
    }
  });
});

// ---------------------------------------------------------------------------
// §3 冻结搜索域 → 有序取值
// ---------------------------------------------------------------------------

describe("冻结搜索域展开（§3.2）", () => {
  it("ENUM 保持声明顺序（不重排）", () => {
    expect(expandSearchDomainValues({ mode: "ENUM", values: ["main", "gem", "star"] }).values).toEqual([
      "main",
      "gem",
      "star",
    ]);
  });

  it("DECIMAL_RANGE 按 step 定点展开（无浮点漂移）", () => {
    expect(expandSearchDomainValues({ mode: "DECIMAL_RANGE", min: 0.1, max: 0.3, step: 0.1 }).values).toEqual([
      0.1,
      0.2,
      0.3,
    ]);
    expect(expandSearchDomainValues({ mode: "INTEGER_RANGE", min: 1, max: 5, step: 1 }).values).toEqual([1, 2, 3, 4, 5]);
  });

  it("step <= 0 / min > max 响亮抛错（不静默夹取）", () => {
    expect(() => expandSearchDomainValues({ mode: "INTEGER_RANGE", min: 1, max: 5, step: 0 })).toThrow(
      ResearchValidationError,
    );
    expect(() => expandSearchDomainValues({ mode: "INTEGER_RANGE", min: 5, max: 1, step: 1 })).toThrow(
      ResearchValidationError,
    );
  });

  it("重复取值按稳定键合并并可审计", () => {
    const expanded = expandSearchDomainValues({ mode: "ENUM", values: [1, 1, 2] });
    expect(expanded.values).toEqual([1, 2]);
    expect(expanded.duplicateKeys).toEqual(["n:1"]);
  });

  it("indexOfDomainValue 是唯一查找口径（−0 与 0 同键）", () => {
    expect(indexOfDomainValue([1, 2, 3], 2)).toBe(1);
    expect(indexOfDomainValue([1, 2, 3], 9)).toBe(-1);
    expect(indexOfDomainValue([0, 1], -0)).toBe(0);
  });

  it("只有 TUNABLE + 带搜索域的才是轴（FIXED / DERIVED 如实登记原因）", () => {
    const { axes, notes } = buildNeighborhoodAxes(snapshot2x3());
    expect(axes.map((axis) => axis.parameter)).toEqual(["a", "b"]);
    expect(notes.join("\n")).toContain("fixed_x");
    expect(notes.join("\n")).toContain("derived_y");
  });
});

// ---------------------------------------------------------------------------
// §5.1 离散度
// ---------------------------------------------------------------------------

describe("离散度（§5.1）", () => {
  it("六项统计正确", () => {
    const dispersion = computeDispersion([metrics(10, 5, 2), metrics(20, 7, 4), metrics(30, 9, 6)]);
    const totalReturn = dispersion.find((item) => item.metric === "totalReturnPct");
    expect(totalReturn).toMatchObject({
      count: 3,
      mean: 20,
      median: 20,
      min: 10,
      max: 30,
      range: 20,
    });
    expect(totalReturn?.stdDev).toBeCloseTo(8.16496580927726, 10);
  });

  it("count = 0 ⇒ 统计字段全 null（不编造 0）", () => {
    const dispersion = computeDispersion([
      {
        totalReturnPct: null,
        annualizedReturnPct: null,
        maxDrawdownPct: null,
        tradeCount: null,
        winRatePct: null,
        profitFactor: null,
      },
    ]);
    for (const item of dispersion) {
      expect(item.count).toBe(0);
      expect(item.mean).toBeNull();
      expect(item.median).toBeNull();
      expect(item.min).toBeNull();
      expect(item.max).toBeNull();
      expect(item.stdDev).toBeNull();
      expect(item.range).toBeNull();
    }
  });

  it("六项指标一个不少", () => {
    const dispersion = computeDispersion([metrics(1, 1, 1)]);
    expect(dispersion.map((item) => item.metric)).toEqual([
      "totalReturnPct",
      "annualizedReturnPct",
      "maxDrawdownPct",
      "tradeCount",
      "winRatePct",
      "profitFactor",
    ]);
  });
});

// ---------------------------------------------------------------------------
// §6 稳定性 / §11 零成交 / §3.2 缺邻居
// ---------------------------------------------------------------------------

describe("单组合稳定性判定（§6 / §11 / §3.2）", () => {
  it("全邻居在容差内 ⇒ STABLE，stabilityRatio = 1", () => {
    const outcome = analyzeSearchRobustness(makeInput({ cells: uniformCells(10, 5) }));
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    expect(center?.status).toBe("STABLE");
    expect(center?.stable).toBe(true);
    expect(center?.stabilityRatio).toBe(1);
    expect(center?.validNeighborCount).toBe(4);
    expect(center?.stableNeighborCount).toBe(4);
  });

  it("存在邻居超容差 ⇒ UNSTABLE（ratio < 1）", () => {
    const cells = uniformCells(10, 5);
    cells["1|0.1"] = metrics(10, 5, 10);
    cells["2|0.1"] = metrics(60, 5, 10); // 收益偏离 +50 > 容差 5
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    expect(center?.status).toBe("UNSTABLE");
    expect(center?.stable).toBe(false);
    expect(center?.stabilityRatio).toBeCloseTo(3 / 4, 6);
    expect(center?.statusReason).toContain("超出容差");
  });

  it("混合：部分稳部分不稳 ⇒ ratio 落在 (0,1)", () => {
    const cells = uniformCells(10, 5);
    cells["1|0.2"] = metrics(10, 5, 10);
    cells["2|0.2"] = metrics(10, 5, 10);
    cells["3|0.2"] = metrics(10, 5, 10);
    cells["2|0.1"] = metrics(30, 5, 10); // 超容差
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    expect(center?.status).toBe("UNSTABLE");
    expect(center?.stabilityRatio).toBeGreaterThan(0);
    expect(center?.stabilityRatio).toBeLessThan(1);
  });

  it("零有效邻居 ⇒ INSUFFICIENT_NEIGHBORHOOD（既不稳也不不稳）", () => {
    // 只造一个组合：它的所有邻居都不存在
    const outcome = analyzeSearchRobustness(
      makeInput({
        cells: { "2|0.2": metrics(10, 5, 10) },
        combinations: [{ a: 2, b: 0.2 }],
      }),
    );
    const only = outcome.results[0];
    expect(only?.status).toBe("INSUFFICIENT_NEIGHBORHOOD");
    expect(only?.stable).toBe(false);
    expect(only?.stabilityRatio).toBeNull();
    expect(only?.validNeighborCount).toBe(0);
    expect(only?.expectedNeighborCount).toBe(4);
    expect(only?.presentNeighborCount).toBe(0);
    expect(only?.neighborhoodIncomplete).toBe(true);
  });

  it("零成交 ⇒ INSUFFICIENT_TRADING_ACTIVITY（不误判为 robust）", () => {
    const cells = uniformCells(10, 5);
    cells["2|0.2"] = metrics(0, 0, 0);
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    expect(center?.status).toBe("INSUFFICIENT_TRADING_ACTIVITY");
    expect(center?.stable).toBe(false);
    expect(center?.statusReason).toContain("tradeCount = 0");
    expect(center?.metrics.tradeCount).toBe(0);
  });

  it("🔴 回归（E2E 实测抓获）：基组合**不可判**时邻域仍被完整构造", () => {
    // 缺陷原状：基组合 `tradeCount = 0` 时实现**提前返回空邻域** ⇒ `expectedNeighborCount = 0`，
    // 读起来像「这个组合在搜索空间里没有邻居」——而事实是邻域存在、只是**基准**没有读数。
    // 判据：邻域结构（理论 / 实存 / 明细）恒为事实；只有 delta / withinTolerance 依赖基准。
    const cells = uniformCells(10, 5);
    cells["2|0.2"] = metrics(0, 0, 0);
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const base = findResult(outcome, { a: 2, b: 0.2 });
    expect(base?.status).toBe("INSUFFICIENT_TRADING_ACTIVITY");
    expect(base?.expectedNeighborCount).toBe(4);
    expect(base?.presentNeighborCount).toBe(4);
    expect(base?.neighbors).toHaveLength(4);
    expect(base?.neighborhoodIncomplete).toBe(false);
    expect(base?.stabilityRatio).toBeNull();
    expect(base?.neighbors.every((item) => item.withinTolerance === null)).toBe(true);
    expect(base?.neighbors.every((item) => item.metrics !== null)).toBe(true);
    expect(base?.neighbors.every((item) => item.deltaTotalReturnPct === null)).toBe(true);
  });

  it("🔴 回归：基组合**源结果不可用**时同样保留邻域结构", () => {
    const cells = uniformCells(10, 5);
    delete cells["2|0.2"];
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const base = findResult(outcome, { a: 2, b: 0.2 });
    expect(base?.status).toBe("SOURCE_RESULT_UNAVAILABLE");
    expect(base?.expectedNeighborCount).toBe(4);
    expect(base?.presentNeighborCount).toBe(4);
    expect(base?.stabilityRatio).toBeNull();
    expect(base?.neighbors.every((item) => item.withinTolerance === null)).toBe(true);
  });

  it("邻居零成交 ⇒ 不计入 validNeighborCount（但仍是 present）", () => {
    const cells = uniformCells(10, 5);
    cells["2|0.2"] = metrics(10, 5, 10);
    cells["1|0.2"] = metrics(10, 5, 0); // 该邻居无交易活动
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    const zeroTrade = center?.neighbors.find((item) => item.parameterHash === "hash-1-0.2");
    expect(zeroTrade?.availability).toBe("INSUFFICIENT_TRADING_ACTIVITY");
    expect(zeroTrade?.withinTolerance).toBeNull();
    expect(center?.presentNeighborCount).toBe(4);
    expect(center?.validNeighborCount).toBe(3);
  });

  it("缺邻居不被补值（MISSING_COMBINATION + metrics 恒 null）", () => {
    // ⚠️ 判据订正（首版写错）：把某个 key 从 `cells` 删掉只等于「**结果**缺失」，
    //    组合本身仍在 `combinations` 里 ⇒ 可用性应为 `NO_METRICS`，**不是** `MISSING_COMBINATION`。
    //    要构造「组合不存在」，必须**同时**把它从 `combinations` 里移除。
    const allCombos = [1, 2, 3].flatMap((a) => [0.1, 0.2, 0.3].map((b) => ({ a, b })));
    const without_one = allCombos.filter((item) => !(item.a === 2 && item.b === 0.2));

    // ① 组合**不存在**（真·缺失格）
    const missingOutcome = analyzeSearchRobustness(
      makeInput({ cells: uniformCells(10, 5), combinations: without_one }),
    );
    // ⚠️ 按**参数取值**定位，不按 `combinationIndex`：移除一个组合后序号会整体前移，
    //    按下标找会静默指到别的组合上（首版实测踩到，得到一条假的通过）。
    const base = findResult(missingOutcome, { a: 1, b: 0.2 });
    const neighborOfA1 = base?.neighbors.find((item) => item.stepOffset === 1 && item.axis === "a");
    expect(neighborOfA1?.availability).toBe("MISSING_COMBINATION");
    expect(neighborOfA1?.parameterHash).toBeNull();
    expect(neighborOfA1?.metrics).toBeNull();
    expect(neighborOfA1?.deltaTotalReturnPct).toBeNull();
    expect(neighborOfA1?.withinTolerance).toBeNull();
    expect(neighborOfA1?.unavailableReason).toContain("缺失格");
    expect(base?.neighborhoodIncomplete).toBe(true);
    expect(base?.expectedNeighborCount).toBe(3);
    expect(base?.presentNeighborCount).toBe(2);
    // 缺失格绝不进入有效统计（b 轴两侧仍有效）
    expect(base?.validNeighborCount).toBe(2);

    // ② 组合**存在但源结果缺失** ⇒ 如实单列 NO_METRICS（仍算 present，邻域并非不完整）
    const cells = uniformCells(10, 5);
    delete cells["2|0.2"];
    const noMetricsOutcome = analyzeSearchRobustness(makeInput({ cells }));
    const sameNeighbor = noMetricsOutcome.results
      .find((result) => result.combinationIndex === 1)
      ?.neighbors.find((item) => item.stepOffset === 1 && item.axis === "a");
    expect(sameNeighbor?.availability).toBe("NO_METRICS");
    expect(sameNeighbor?.parameterHash).toBe("hash-2-0.2");
    expect(sameNeighbor?.metrics).toBeNull();
    expect(sameNeighbor?.unavailableReason).toContain("没有该组合的结果行");
    const center = noMetricsOutcome.results.find((result) => result.combinationIndex === 4);
    expect(center?.status).toBe("SOURCE_RESULT_UNAVAILABLE");
  });

  it("源结果失败 / 无结果行 ⇒ SOURCE_RESULT_UNAVAILABLE，且不参与任何「稳定」判定", () => {
    // 两个组合都没有结果行（`cells` 为空 ⇒ makeInput 不产出 result）
    const noRows = analyzeSearchRobustness(
      makeInput({ cells: {}, combinations: [{ a: 1, b: 0.1 }, { a: 2, b: 0.1 }] }),
    );
    for (const result of noRows.results) {
      expect(result.status).toBe("SOURCE_RESULT_UNAVAILABLE");
      expect(result.stable).toBe(false);
      expect(result.statusReason).toContain("没有该组合的结果行");
    }

    // 结果行存在但 status = FAILED
    const failed = analyzeSearchRobustness({
      robustnessRunId: "SROB-TEST-0003",
      sourceSearchRunId: "PSRUN-TEST-0003",
      searchSnapshot: snapshot2x3(),
      combinations: [{ parameterHash: "h-failed", combinationIndex: 0, parameters: { a: 1, b: 0.1 } }],
      results: [
        {
          parameterHash: "h-failed",
          status: "FAILED",
          error: "夹具：源结果失败",
          metricsSource: "canonical",
          metrics: metrics(0, 0, null),
        },
      ],
      config: CONFIG,
    });
    expect(failed.results[0]?.status).toBe("SOURCE_RESULT_UNAVAILABLE");
    expect(failed.results[0]?.statusReason).toContain("FAILED");
    expect(failed.results[0]?.stable).toBe(false);
  });

  it("容差指标缺一 ⇒ METRICS_INCOMPLETE（不降级为稳定/不稳定）", () => {
    const cells = uniformCells(10, 5);
    cells["2|0.2"] = { ...metrics(10, 5, 10), totalReturnPct: null };
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    expect(center?.status).toBe("SOURCE_RESULT_UNAVAILABLE");
    const neighbor = outcome.results
      .find((result) => result.combinationIndex === 1)
      ?.neighbors.find((item) => item.parameterHash === "hash-2-0.2");
    expect(neighbor?.availability).toBe("METRICS_INCOMPLETE");
  });

  it("间距（neighborDistance=2）会扩大邻域", () => {
    const outcome = analyzeSearchRobustness(
      makeInput({ cells: uniformCells(10, 5), config: { ...CONFIG, neighborDistance: 2 } }),
    );
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    // a 轴 1..3 全取（±2 内为 3 个），b 轴同理 ⇒ 4 条邻居中 a 轴 ±1/±2 与 b 轴 ±1/±2 共 4 条（边界裁剪）
    expect(center?.expectedNeighborCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// §5.2 敏感性
// ---------------------------------------------------------------------------

describe("敏感性（§5.2）", () => {
  it("数值参数同时给绝对变化与相对变化", () => {
    // ⚠️ 判据订正（首版写错）：`numeric` 由**冻结域形态**决定 —— `ENUM` 即使是数字也按
    //    「枚举」处理（规格 §5.2：对枚举参数只算离散变化）。要测相对变化必须用**数值区间**。
    const numericSnapshot = snapshot2x3();
    const rangedSnapshot: ParameterSearchSpaceDefinition = {
      ...numericSnapshot,
      parameters: [
        {
          name: "a",
          type: "number",
          kind: "TUNABLE",
          required: true,
          search: { mode: "INTEGER_RANGE", min: 1, max: 3, step: 1 },
        },
        numericSnapshot.parameters[1] as ParameterSearchSpaceDefinition["parameters"][number],
        numericSnapshot.parameters[2] as ParameterSearchSpaceDefinition["parameters"][number],
        numericSnapshot.parameters[3] as ParameterSearchSpaceDefinition["parameters"][number],
      ],
    };
    const cells = uniformCells(10, 5);
    cells["2|0.2"] = metrics(20, 5, 10);
    cells["1|0.2"] = metrics(50, 5, 10);
    cells["3|0.2"] = metrics(50, 5, 10);
    const outcome = analyzeSearchRobustness(makeInput({ cells, snapshot: rangedSnapshot }));
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    const axisA = center?.sensitivity.find((item) => item.parameter === "a");
    const entry = axisA?.entries.find((item) => item.stepOffset === -1);
    expect(entry?.absoluteChangePct).toBeCloseTo(30, 10);
    expect(entry?.relativeChange).toBeCloseTo(1.5, 10);
    expect(axisA?.numeric).toBe(true);
    expect(axisA?.meanAbsoluteChangePct).toBeCloseTo(30, 10);
    expect(axisA?.maxAbsoluteChangePct).toBeCloseTo(30, 10);
    expect(axisA?.measuredCount).toBe(2);
  });

  it("枚举 / 非数值参数不给相对变化（不制造连续意义）", () => {
    const snapshot = snapshot2x3();
    const enumSnapshot: ParameterSearchSpaceDefinition = {
      ...snapshot,
      parameters: [
        {
          name: "a",
          type: "string",
          kind: "TUNABLE",
          required: true,
          search: { mode: "ENUM", values: ["main", "gem"] },
        },
        snapshot.parameters[1] as ParameterSearchSpaceDefinition["parameters"][number],
      ],
    };
    const outcome = analyzeSearchRobustness({
      robustnessRunId: "SROB-TEST-0002",
      sourceSearchRunId: "PSRUN-TEST-0002",
      searchSnapshot: enumSnapshot,
      combinations: [
        { parameterHash: "h-main", combinationIndex: 0, parameters: { a: "main", b: 0.1 } },
        { parameterHash: "h-gem", combinationIndex: 1, parameters: { a: "gem", b: 0.1 } },
      ],
      results: [
        { parameterHash: "h-main", status: "SUCCEEDED", error: null, metricsSource: "canonical", metrics: metrics(10, 5, 10) },
        { parameterHash: "h-gem", status: "SUCCEEDED", error: null, metricsSource: "canonical", metrics: metrics(30, 5, 10) },
      ],
      config: CONFIG,
    });
    const axisA = outcome.results[0]?.sensitivity.find((item) => item.parameter === "a");
    expect(axisA?.numeric).toBe(false);
    expect(axisA?.entries.every((item) => item.relativeChange === null)).toBe(true);
    expect(axisA?.entries.some((item) => item.absoluteChangePct === 20)).toBe(true);
  });

  it("基准值为 0 时相对变化为 null（无定义，不编造）", () => {
    const cells = uniformCells(0, 5);
    cells["2|0.2"] = metrics(0, 5, 10);
    cells["1|0.2"] = metrics(10, 5, 10);
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const center = outcome.results.find((result) => result.combinationIndex === 4);
    const entry = center?.sensitivity[0]?.entries.find((item) => item.parameterHash === "hash-1-0.2");
    expect(entry?.absoluteChangePct).toBe(10);
    expect(entry?.relativeChange).toBeNull();
  });

  it("缺邻居的敏感性条目全为 null", () => {
    // 同前：要产生「缺失格」必须把组合从 `combinations` 里移除（只删结果不足以构成缺失格），
    // 且必须按**参数取值**定位基组合（序号会因移除而前移）。
    const allCombos = [1, 2, 3].flatMap((a) => [0.1, 0.2, 0.3].map((b) => ({ a, b })));
    const without_one = allCombos.filter((item) => !(item.a === 1 && item.b === 0.2));
    const outcome = analyzeSearchRobustness(
      makeInput({ cells: uniformCells(10, 5), combinations: without_one }),
    );
    const center = findResult(outcome, { a: 2, b: 0.2 });
    const entry = center?.sensitivity[0]?.entries.find((item) => item.parameterHash === null);
    expect(entry).toBeDefined();
    expect(entry?.absoluteChangePct).toBeNull();
    expect(entry?.relativeChange).toBeNull();
    expect(entry?.withinTolerance).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §7 多参数矩阵
// ---------------------------------------------------------------------------

describe("多参数二维矩阵（§7）", () => {
  const axes = buildNeighborhoodAxes(snapshot2x3()).axes;

  function row(a: number, b: number, status: string, stable: boolean | null, ratio: number | null): RobustnessMatrixRow {
    return {
      parameterHash: `h-${String(a)}-${String(b)}`,
      parameters: { a, b },
      status,
      stable,
      stabilityRatio: ratio,
      totalReturnPct: 1,
      tradeCount: 5,
    };
  }

  it("2×2（此处 3×3）全存在 ⇒ 无 MISSING", () => {
    const rows: RobustnessMatrixRow[] = [];
    for (const a of [1, 2, 3]) for (const b of [0.1, 0.2, 0.3]) rows.push(row(a, b, "STABLE", true, 1));
    const matrix = buildRobustnessMatrix({ axes, rows });
    expect(matrix.cells).toHaveLength(9);
    expect(matrix.cells.every((cell) => cell.status === "STABLE")).toBe(true);
    expect(matrix.cells.every((cell) => cell.matchedCount === 1)).toBe(true);
    expect(matrix.rowAxis.parameter).toBe("a");
    expect(matrix.columnAxis.parameter).toBe("b");
    expect(matrix.omittedParameters).toEqual([]);
  });

  it("缺格 ⇒ MISSING 且**不补值**", () => {
    const matrix = buildRobustnessMatrix({
      axes,
      rows: [row(2, 0.2, "STABLE", true, 1)],
    });
    const missing = matrix.cells.filter((cell) => cell.status === "MISSING");
    expect(missing).toHaveLength(8);
    for (const cell of missing) {
      expect(cell.present).toBe(false);
      expect(cell.parameterHash).toBeNull();
      expect(cell.stable).toBeNull();
      expect(cell.stabilityRatio).toBeNull();
      expect(cell.totalReturnPct).toBeNull();
      expect(cell.matchedCount).toBe(0);
    }
    const present = matrix.cells.find((cell) => cell.rowValue === 2 && cell.columnValue === 0.2);
    expect(present?.status).toBe("STABLE");
    expect(present?.stabilityRatio).toBe(1);
  });

  it("重复 hash / 多于两个轴 ⇒ AMBIGUOUS，不挑一条当代表", () => {
    const threeAxes = [
      ...axes,
      { parameter: "c", domainMode: "ENUM", numeric: false, values: ["x", "y"] },
    ];
    const rows: RobustnessMatrixRow[] = [
      { ...row(2, 0.2, "STABLE", true, 1), parameters: { a: 2, b: 0.2, c: "x" } },
      { ...row(2, 0.2, "UNSTABLE", false, 0.25), parameters: { a: 2, b: 0.2, c: "y" } },
    ];
    const matrix = buildRobustnessMatrix({ axes: threeAxes, rows });
    const ambiguous = matrix.cells.filter((cell) => cell.status === "AMBIGUOUS");
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]?.matchedCount).toBe(2);
    expect(ambiguous[0]?.stabilityRatio).toBeNull();
    expect(matrix.omittedParameters).toEqual(["c"]);
    expect(matrix.parameterCount).toBe(3);
  });

  it("少于两个轴 ⇒ 空矩阵（如实标「不适用」）", () => {
    const matrix = buildRobustnessMatrix({ axes: [axes[0] as (typeof axes)[number]], rows: [] });
    expect(matrix.cells).toEqual([]);
    expect(matrix.columnAxis.parameter).toBe("(无)");
  });
});

// ---------------------------------------------------------------------------
// §21 C / §22 Determinism
// ---------------------------------------------------------------------------

describe("确定性（§21 C / §22）", () => {
  it("同输入 ⇒ 逐字节相同的产物（含指纹）", () => {
    const cells = uniformCells(10, 5);
    cells["2|0.2"] = metrics(12, 6, 10);
    const first = analyzeSearchRobustness(makeInput({ cells }));
    const second = analyzeSearchRobustness(makeInput({ cells }));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.results.map((item) => item.fingerprint)).toEqual(
      first.results.map((item) => item.fingerprint),
    );
  });

  it("§21 D：改容差只改稳定性判定，**不改**任何源指标", () => {
    const cells = uniformCells(10, 5);
    cells["2|0.2"] = metrics(12, 6, 10);
    const loose = analyzeSearchRobustness(makeInput({ cells }));
    const tight = analyzeSearchRobustness(
      makeInput({ cells, config: { ...CONFIG, returnTolerancePct: 1, drawdownTolerancePct: 1 } }),
    );
    const centerLoose = loose.results.find((item) => item.combinationIndex === 4);
    const centerTight = tight.results.find((item) => item.combinationIndex === 4);
    expect(centerLoose?.status).toBe("STABLE");
    expect(centerTight?.status).toBe("UNSTABLE");
    // 指标读数完全不受口径影响
    expect(centerTight?.metrics).toEqual(centerLoose?.metrics);
    expect(tight.results.map((item) => item.metrics)).toEqual(loose.results.map((item) => item.metrics));
  });

  it("源指标是**冻结副本**：分析过程不修改入参", () => {
    const cells = uniformCells(10, 5);
    const input = makeInput({ cells });
    const before = JSON.stringify(input);
    analyzeSearchRobustness(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("汇总计数自洽（各状态数之和 = 被分析组合数）", () => {
    const cells = uniformCells(10, 5);
    cells["2|0.2"] = metrics(0, 0, 0);
    const outcome = analyzeSearchRobustness(makeInput({ cells }));
    const summary = outcome.summary;
    expect(
      summary.stableCount
        + summary.unstableCount
        + summary.insufficientTradingActivityCount
        + summary.insufficientNeighborhoodCount
        + summary.sourceResultUnavailableCount,
    ).toBe(summary.analyzedCombinationCount);
    expect(summary.analyzedCombinationCount).toBe(outcome.results.length);
  });

  it("组合查找键与参数无关（键序稳定）", () => {
    expect(combinationLookupKey({ b: 0.2, a: 2 })).toBe(combinationLookupKey({ a: 2, b: 0.2 }));
  });

  it("buildSourceIndex 不重算 hash（直接用行里的 parameterHash）", () => {
    const index = buildSourceIndex({
      combinations: [{ parameterHash: "given-hash", combinationIndex: 0, parameters: { a: 1 } }],
      results: [
        { parameterHash: "given-hash", status: "SUCCEEDED", error: null, metricsSource: "canonical", metrics: metrics(1, 1, 1) },
      ],
    });
    expect(index.combinationByKey.get(combinationLookupKey({ a: 1 }))?.parameterHash).toBe("given-hash");
  });
});

// ---------------------------------------------------------------------------
// §4 / §17 排序字段只描述性
// ---------------------------------------------------------------------------

describe("排序字段（§4：仅描述性）", () => {
  it("排序字段集合固定且不含任何「排名 / 推荐」语义", () => {
    expect([...ROBUSTNESS_RESULT_SORT_FIELDS]).toEqual([
      "combinationIndex",
      "totalReturnPct",
      "annualizedReturnPct",
      "maxDrawdownPct",
      "tradeCount",
      "winRatePct",
      "profitFactor",
      "stabilityRatio",
    ]);
  });
});
