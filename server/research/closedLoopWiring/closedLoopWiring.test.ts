/**
 * 闭环装配层测试。
 *
 * 四个「会静默说假话」的风险点被单独锁定：
 *   1. **覆盖率探针必须与编排器的真实行为一致** —— 探针说「覆盖了」而编排器实际 BLOCKED，
 *      就是又一个新的假 READY。故有「探针未覆盖集合 == 编排器阻塞集合」的交叉验证；
 *   2. **未装配阶段必须给出确切原因**，不允许含糊占位（否则待办清单会退化成一句「暂未实现」）；
 *   3. **只为真的能跑的阶段注册执行器** —— 缺入参时不得注册（否则编排器会走到执行器里才炸，
 *      把「缺配置」伪装成「执行失败」）；
 *   4. **执行器产出必须等于真实模块的独立复算结果** —— 交接摘要一旦被本层「顺手加工」，
 *      下游看到的数字就与真实模块脱钩。
 */

import { describe, expect, it } from "vitest";
import { runClosedLoop } from "../closedLoop/orchestrator";
import type {
  ClosedLoopBacktestSummary,
  ClosedLoopDatasetSummary,
  ClosedLoopEvaluationRef,
  ClosedLoopRunMetadata,
  ClosedLoopRunRequest,
} from "../closedLoop/types";
import { evaluatePerformance } from "../performanceMetrics/evaluate";
import {
  CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS,
  assessClosedLoopWiringCoverage,
  assertClosedLoopWiringRequirementsCoverAllStages,
  closedLoopStageWiringRequirement,
  createClosedLoopStageRunners,
  createClosedLoopWiring,
  describeClosedLoopWiringCoverage,
  projectDatasetSummary,
  wiredClosedLoopStages,
} from "./index";
import type { ClosedLoopWiringInputs } from "./types";

// ---------------------------------------------------------------------------
// 常量与夹具
// ---------------------------------------------------------------------------

const T0 = "2026-09-11T00:00:00.000Z";
const DATE_RANGE = { startDate: "2026-08-03", endDate: "2026-08-31" };
const HEX64 = "b".repeat(64);

const META: ClosedLoopRunMetadata = {
  experimentId: "EXP-20260911-ABCDEF01",
  strategyId: "limit-up-baseline",
  strategyVersion: "1.0.0",
  dateRange: { ...DATE_RANGE },
  datasetVersion: null,
  universeVersion: null,
  codeVersion: null,
  costModel: null,
  executionModel: "next-open",
  parameterSet: {},
};

/** 结构性真实的最小 ResearchDataset 夹具（只提供装配层真正读取的字段）。 */
function datasetFixture() {
  const rows = [
    { tradeDate: "2026-08-03", securityId: "000001.SZ" },
    { tradeDate: "2026-08-03", securityId: "600000.SH" },
    { tradeDate: "2026-08-04", securityId: "000001.SZ" },
  ];
  return {
    datasetVersion: "rd-1.0.0-1-0123456789abcdef",
    gate: "PASS",
    gateNotes: [],
    rows,
    dataSnapshot: { request: { startDate: DATE_RANGE.startDate, endDate: DATE_RANGE.endDate } },
  };
}

/** 真实权益曲线（供 C-16.x 评估器真实计算）。 */
function equityCurveFixture() {
  const equity = [100000, 101200, 99500, 103400, 102100, 105300];
  return equity.map((value, i) => ({
    date: `2026-08-${String(i + 3).padStart(2, "0")}`,
    cash: value,
    marketValue: 0,
    equity: value,
    openPositions: 0,
  }));
}

function seedBacktestSummary(): ClosedLoopBacktestSummary {
  return {
    kind: "backtestSummary",
    handoffVersion: 1,
    synthetic: false,
    source: { module: "simulator", moduleRunKind: "TRADE_SIMULATION_RUN", runId: null, fingerprint: HEX64 },
    datasetVersion: "rd-1.0.0-1-0123456789abcdef",
    datasetGate: "PASS",
    dateRange: { ...DATE_RANGE },
    initialCapital: 100000,
    finalEquity: 105300,
    decisionDayCount: 6,
    equityCurvePointCount: 6,
    tradeCount: 0,
  };
}

/** 覆盖率只判「键是否存在」，因此这里用占位对象即可；真实校验发生在执行期。 */
const ALL_INPUTS_PRESENT = {
  researchDataset: datasetFixture(),
  experimentConfig: {},
  strategyContract: {},
  strategy13: {},
  strategyDocumentInput: {},
  simulationConfig: {},
  evaluationInput: { backtestFingerprint: HEX64, equityCurve: equityCurveFixture() },
  lifecycle: {},
} as unknown as ClosedLoopWiringInputs;

/** 真实链五阶段 + finalize 所需的真实入参（仅 data/evaluation 具备可执行的真实形态）。 */
const REAL_CHAIN_INPUTS: ClosedLoopWiringInputs = {
  researchDataset: datasetFixture() as unknown as ClosedLoopWiringInputs["researchDataset"],
  evaluationInput: { backtestFingerprint: HEX64, equityCurve: equityCurveFixture() },
};

// ---------------------------------------------------------------------------
// 1. 装配声明表
// ---------------------------------------------------------------------------

describe("closedLoopWiring — 装配声明表", () => {
  it("14 阶段声明与 canonical 链逐项一致（不漏 / 不重 / 不错位）", () => {
    expect(() => assertClosedLoopWiringRequirementsCoverAllStages()).not.toThrow();
    expect(CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS).toHaveLength(14);
  });

  it("未装配阶段必须给出确切原因，且原因要能回答「缺什么」", () => {
    const notWiredRows = CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS.filter((r) => !r.wired);
    expect(notWiredRows.length).toBeGreaterThan(0);
    for (const row of notWiredRows) {
      expect(row.notWiredReason, `${row.stageId} 缺未装配原因`).toBeTruthy();
      expect((row.notWiredReason ?? "").length).toBeGreaterThan(40); // 拒绝「暂未实现」式占位
      // 未装配阶段不得声称有入参来源（否则覆盖率逻辑会自相矛盾）
      expect(row.satisfyVia).toEqual([]);
      // 未装配阶段必须留下真实入口坐标，供后续增量直接对接
      expect(row.entryPoints.length).toBeGreaterThan(0);
    }
  });

  it("已装配阶段必须声明模块与至少一个入参来源", () => {
    for (const row of CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS.filter((r) => r.wired)) {
      expect(row.module.length, `${row.stageId} 缺 module`).toBeGreaterThan(0);
      expect(row.satisfyVia.length, `${row.stageId} 未声明入参来源`).toBeGreaterThan(0);
      expect(row.notWiredReason).toBeNull();
    }
  });

  it("已装配清单 = data / research / strategy / backtest / evaluation / finalize", () => {
    expect([...wiredClosedLoopStages()]).toEqual([
      "data",
      "research",
      "strategy",
      "backtest",
      "evaluation",
      "finalize",
    ]);
  });

  it("非法阶段取值抛错（不静默返回空声明）", () => {
    expect(() => closedLoopStageWiringRequirement("nope" as never)).toThrow(/未知阶段/);
  });
});

// ---------------------------------------------------------------------------
// 2. 覆盖率探测
// ---------------------------------------------------------------------------

describe("closedLoopWiring — 覆盖率探测（取代硬编码 executorBound）", () => {
  it("零入参 + 全 14 阶段 → executorBound=false，且没有任何阶段被覆盖", () => {
    const coverage = assessClosedLoopWiringCoverage({});
    expect(coverage.requested).toHaveLength(14);
    expect(coverage.executorBound).toBe(false);
    expect(coverage.coveredStages).toEqual([]);
    expect(coverage.uncoveredStages).toHaveLength(14);
  });

  it("给 researchDataset → data 覆盖，且 satisfiedBy 指明来源", () => {
    const coverage = assessClosedLoopWiringCoverage(
      { researchDataset: datasetFixture() as never },
      ["data"],
    );
    expect(coverage.coveredStages).toEqual(["data"]);
    expect(coverage.stages[0]!.satisfiedBy).toBe("input:researchDataset");
    expect(coverage.executorBound).toBe(true); // 只请求 data 时，链是完整可执行的
  });

  it("给 lifecycle → finalize 覆盖（finalize 无需本层注册执行器）", () => {
    const coverage = assessClosedLoopWiringCoverage({ lifecycle: {} as never }, ["finalize"]);
    expect(coverage.coveredStages).toEqual(["finalize"]);
    expect(coverage.stages[0]!.satisfiedBy).toBe("input:lifecycle");
  });

  it("data→research→strategy→backtest→evaluation 五阶段链：入参齐备即全覆盖", () => {
    const chain = ["data", "research", "strategy", "backtest", "evaluation"] as const;
    const coverage = assessClosedLoopWiringCoverage(ALL_INPUTS_PRESENT, chain);
    expect(coverage.coveredStages).toEqual([...chain]);
    expect(coverage.uncoveredStages).toEqual([]);
    expect(coverage.executorBound).toBe(true);
    // 上游产物来源在链内成立：backtest 的唯一合法路径 = 入参 simulationConfig ∧ 上游 dataset+candidateRun 产物
    expect(coverage.stages.find((s) => s.stageId === "backtest")!.satisfiedBy).toBe(
      "input:simulationConfig & artifact:dataset+candidateRun",
    );
  });

  it("链内不含 backtest 时，evaluation 因拿不到上游产物而未覆盖（缺 tradeSimulationRun）", () => {
    const coverage = assessClosedLoopWiringCoverage(ALL_INPUTS_PRESENT, ["evaluation"]);
    const row = coverage.stages.find((s) => s.stageId === "evaluation")!;
    // ALL_INPUTS_PRESENT 里有 evaluationInput，所以走 input 路径成立
    expect(row.covered).toBe(true);

    // 去掉直供输入 → 只剩 artifact 路径，而 backtest 不在链内 → 未覆盖
    const { evaluationInput: _drop, ...withoutEvalInput } = ALL_INPUTS_PRESENT;
    const coverage2 = assessClosedLoopWiringCoverage(withoutEvalInput, ["evaluation"]);
    const row2 = coverage2.stages.find((s) => s.stageId === "evaluation")!;
    expect(row2.covered).toBe(false);
    expect(row2.missingArtifacts).toEqual(["tradeSimulationRun"]);
    expect(row2.note).toMatch(/缺同链上游产物：tradeSimulationRun/);
  });

  it("backtest 链内齐备但 research 不在链内 → 缺 candidateRun 产物", () => {
    const coverage = assessClosedLoopWiringCoverage(ALL_INPUTS_PRESENT, ["data", "backtest"]);
    const row = coverage.stages.find((s) => s.stageId === "backtest")!;
    expect(row.covered).toBe(false);
    expect(row.missingArtifacts).toEqual(["candidateRun"]);
  });

  // 回归守卫：来源内必须 AND。曾经把来源内写成 OR，导致「只给 data 产物、缺 research 入参」时
  // research 仍被判为可覆盖/可注册，直到运行期才因入参缺失抛 CL_WIRING_INPUT_MISSING。
  it("来源内 AND：只有 dataset 产物、缺 research 三件入参 → research 不覆盖也不注册", () => {
    const onlyDataset = { researchDataset: datasetFixture() } as unknown as ClosedLoopWiringInputs;
    const coverage = assessClosedLoopWiringCoverage(onlyDataset, ["data", "research"]);
    const row = coverage.stages.find((s) => s.stageId === "research")!;
    expect(coverage.stages.find((s) => s.stageId === "data")!.covered).toBe(true);
    expect(row.covered).toBe(false);
    // 上游产物其实可得（data 已覆盖且在链内）——缺的纯粹是调用方入参
    expect(row.missingArtifacts).toEqual([]);
    expect([...row.missingInputs].sort()).toEqual(["experimentConfig", "strategy13", "strategyContract"]);
    expect(row.note).toMatch(/缺调用方入参/);

    // 注册侧必须与探针一致：research 不得被注册（否则「缺配置」会被伪装成「执行失败」）
    const runners = createClosedLoopStageRunners(onlyDataset, undefined, {
      requested: ["data", "research"],
    });
    expect(Object.keys(runners)).toEqual(["data"]);
  });

  it("来源内 AND：只有 research 三件入参、链内无 data → research 缺 dataset 产物", () => {
    const withoutDataset: ClosedLoopWiringInputs = {
      experimentConfig: {},
      strategyContract: {},
      strategy13: {},
    } as unknown as ClosedLoopWiringInputs;
    const coverage = assessClosedLoopWiringCoverage(withoutDataset, ["research"]);
    const row = coverage.stages.find((s) => s.stageId === "research")!;
    expect(row.covered).toBe(false);
    expect(row.missingInputs).toEqual([]);
    expect(row.missingArtifacts).toEqual(["dataset"]);
    expect(row.note).toMatch(/缺同链上游产物：dataset/);
  });

  it("evaluation 的多来源为 OR：artifact 路径不成立时，input 路径仍可单独成立", () => {
    // 链内无 backtest（artifact 路径断）但给了 evaluationInput（input 路径通）→ 覆盖
    const onlyEvalInput = {
      evaluationInput: { backtestFingerprint: HEX64, equityCurve: equityCurveFixture() },
    } as unknown as ClosedLoopWiringInputs;
    const row = assessClosedLoopWiringCoverage(onlyEvalInput, ["evaluation"]).stages.find(
      (s) => s.stageId === "evaluation",
    )!;
    expect(row.covered).toBe(true);
    expect(row.satisfiedBy).toBe("input:evaluationInput");
  });

  it("未装配阶段（regime）无论给什么入参都不覆盖，note = 未装配原因", () => {
    const coverage = assessClosedLoopWiringCoverage(ALL_INPUTS_PRESENT, ["regime"]);
    const row = coverage.stages.find((s) => s.stageId === "regime")!;
    expect(row.wired).toBe(false);
    expect(row.inputsSatisfied).toBe(false);
    expect(row.covered).toBe(false);
    expect(row.blockedReasonCode).toBe("CL_RUNNER_NOT_INJECTED");
    expect(row.note).toBe(closedLoopStageWiringRequirement("regime").notWiredReason);
  });

  it("被请求阶段归一为拓扑序（乱序输入不影响判定）", () => {
    const coverage = assessClosedLoopWiringCoverage({}, ["evaluation", "data", "strategy"]);
    expect(coverage.requested).toEqual(["data", "strategy", "evaluation"]);
  });

  it("空请求 → executorBound=false（没有阶段可跑，不算「已绑定」）", () => {
    expect(assessClosedLoopWiringCoverage({}, []).executorBound).toBe(false);
  });

  it("摘要如实列出每个未覆盖阶段的 reasonCode 与原因", () => {
    const text = describeClosedLoopWiringCoverage(assessClosedLoopWiringCoverage({}, ["data", "regime"]));
    expect(text).toContain("0/2");
    expect(text).toContain("executorBound=false");
    expect(text).toContain("data（CL_DATA_NOT_INJECTED）");
    expect(text).toContain("regime（CL_RUNNER_NOT_INJECTED）");
  });

  it("全覆盖时摘要明确说可真实执行", () => {
    const text = describeClosedLoopWiringCoverage(
      assessClosedLoopWiringCoverage({ researchDataset: datasetFixture() as never }, ["data"]),
    );
    expect(text).toContain("1/1 阶段全部覆盖");
    expect(text).toContain("executorBound=true");
  });
});

// ---------------------------------------------------------------------------
// 3. 执行器注册（只为真的能跑的阶段注册）
// ---------------------------------------------------------------------------

describe("closedLoopWiring — 执行器注册", () => {
  it("零入参 → 不注册任何执行器（stageRunners 为空 ⇒ 编排器如实 BLOCKED）", () => {
    const runners = createClosedLoopStageRunners({});
    expect(Object.keys(runners)).toEqual([]);
  });

  it("只给 researchDataset → 只注册 data", () => {
    const runners = createClosedLoopStageRunners({
      researchDataset: datasetFixture() as never,
    });
    expect(Object.keys(runners)).toEqual(["data"]);
  });

  it("直供 evaluationInput 时注册 evaluation（链内无 backtest 也成立）", () => {
    const runners = createClosedLoopStageRunners(
      { evaluationInput: { backtestFingerprint: HEX64, equityCurve: equityCurveFixture() } },
      undefined,
      { requested: ["evaluation"] },
    );
    expect(Object.keys(runners)).toEqual(["evaluation"]);
  });

  it("三件套一次创建：inputs / artifacts / stageRunners 同时返回", () => {
    const wiring = createClosedLoopWiring({ researchDataset: datasetFixture() as never });
    expect(Object.keys(wiring.stageRunners)).toEqual(["data"]);
    expect(wiring.artifacts).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 4. 真实投影（不重写口径）
// ---------------------------------------------------------------------------

describe("closedLoopWiring — 真实投影", () => {
  it("projectDatasetSummary 逐字段来自真实数据集，不臆造", () => {
    const summary = projectDatasetSummary(datasetFixture());
    expect(summary.kind).toBe("datasetSummary");
    expect(summary.synthetic).toBe(false);
    expect(summary.datasetVersion).toBe("rd-1.0.0-1-0123456789abcdef");
    expect(summary.gate).toBe("PASS");
    expect(summary.dateRange).toEqual(DATE_RANGE);
    expect(summary.rowCount).toBe(3);
    expect(summary.universeCount).toBe(2); // 去重证券数（000001.SZ + 600000.SH）
    expect(summary.coverageGaps).toEqual([]);
    expect(summary.source.fingerprint).toBe(summary.datasetVersion);
  });

  it("gateNotes 原样进入 coverageGaps（不美化、不截断）", () => {
    const summary = projectDatasetSummary({ ...datasetFixture(), gateNotes: ["缺 index_daily", "缺口 2 天"] });
    expect(summary.coverageGaps).toEqual(["缺 index_daily", "缺口 2 天"]);
  });
});

// ---------------------------------------------------------------------------
// 5. 与编排器集成（探针必须说真话）
// ---------------------------------------------------------------------------

function runRequest(overrides: Partial<ClosedLoopRunRequest>): ClosedLoopRunRequest {
  return { runId: "clrun-wiring-001", createdAt: T0, metadata: META, ...overrides };
}

describe("closedLoopWiring — 与编排器集成", () => {
  it("零入参全 14 阶段：探针未覆盖集合 == 编排器阻塞集合（探针不说假话）", () => {
    const coverage = assessClosedLoopWiringCoverage({});
    const run = runClosedLoop(runRequest({ stageRunners: createClosedLoopStageRunners({}) }));

    const blocked = run.stages.filter((s) => s.state === "BLOCKED").map((s) => s.stageId);
    expect([...blocked].sort()).toEqual([...coverage.uncoveredStages].sort());
    expect(run.overall.executedStageCount).toBe(0);
    expect(run.overall.status).toBe("NO_STAGE_EXECUTED");
    // 首阻塞必须是 data（链头），且为数据未注入
    expect(run.overall.firstBlockedReasonCode).toBe("CL_DATA_NOT_INJECTED");
    // 无任何合成产物
    expect(run.overall.synthetic).toBe(false);
  });

  it("只注入 data：探针覆盖集合 == 编排器实际执行集合", () => {
    const inputs: ClosedLoopWiringInputs = {
      researchDataset: datasetFixture() as unknown as ClosedLoopWiringInputs["researchDataset"],
    };
    const coverage = assessClosedLoopWiringCoverage(inputs);
    const run = runClosedLoop(
      runRequest({ stageRunners: createClosedLoopStageRunners(inputs) }),
    );

    const executed = run.stages.filter((s) => s.state === "EXECUTED").map((s) => s.stageId);
    const blocked = run.stages.filter((s) => s.state === "BLOCKED").map((s) => s.stageId);
    expect([...executed].sort()).toEqual([...coverage.coveredStages].sort());
    expect([...blocked].sort()).toEqual([...coverage.uncoveredStages].sort());
    expect(run.request.runnerInjected).toEqual(["data"]);
  });

  it("data 阶段经真实执行器 EXECUTED，交接过契约且字段与数据集一致", () => {
    const inputs: ClosedLoopWiringInputs = {
      researchDataset: datasetFixture() as unknown as ClosedLoopWiringInputs["researchDataset"],
    };
    const run = runClosedLoop(
      runRequest({ stageIds: ["data"], stageRunners: createClosedLoopStageRunners(inputs, undefined, { requested: ["data"] }) }),
    );

    const dataRow = run.stages.find((s) => s.stageId === "data")!;
    expect(dataRow.state).toBe("EXECUTED");
    const output = dataRow.output as ClosedLoopDatasetSummary;
    expect(output.kind).toBe("datasetSummary");
    expect(output.gate).toBe("PASS");
    expect(output.rowCount).toBe(3);
    expect(output.universeCount).toBe(2);
    expect(output.synthetic).toBe(false);
    expect(run.overall.executedStageCount).toBe(1);
  });

  it("data 阶段 gate 非 PASS → 编排器如实 BLOCKED（CL_DATASET_GATE_NOT_PASS），不冒充执行成功", () => {
    const inputs: ClosedLoopWiringInputs = {
      researchDataset: {
        ...datasetFixture(),
        gate: "INCONCLUSIVE",
        gateNotes: ["缺少 index_daily"],
      } as unknown as ClosedLoopWiringInputs["researchDataset"],
    };
    const run = runClosedLoop(
      runRequest({ stageIds: ["data"], stageRunners: createClosedLoopStageRunners(inputs, undefined, { requested: ["data"] }) }),
    );
    const dataRow = run.stages.find((s) => s.stageId === "data")!;
    expect(dataRow.state).toBe("BLOCKED");
    expect(dataRow.blocked?.reasonCode).toBe("CL_DATASET_GATE_NOT_PASS");
    expect(dataRow.output).toBeNull(); // 阻塞不得留下产出
  });

  it("evaluation 执行器产出 == 真实评估器的独立复算结果（交接摘要未被加工）", () => {
    const equityCurve = equityCurveFixture();
    const expected = evaluatePerformance({ equityCurve });

    const inputs: ClosedLoopWiringInputs = {
      evaluationInput: { backtestFingerprint: HEX64, equityCurve },
    };
    const run = runClosedLoop(
      runRequest({
        stageIds: ["evaluation"],
        stageRunners: createClosedLoopStageRunners(inputs, undefined, { requested: ["evaluation"] }),
        seedHandoffs: [{ kind: "backtestSummary", handoff: seedBacktestSummary() }],
      }),
    );

    const row = run.stages.find((s) => s.stageId === "evaluation")!;
    expect(row.state).toBe("EXECUTED");
    const ref = row.output as ClosedLoopEvaluationRef;
    expect(ref.kind).toBe("evaluationRef");
    expect(ref.backtestFingerprint).toBe(HEX64);
    expect(ref.evaluatorsCovered).toEqual([
      "performanceMetrics",
      "riskAdjustedMetrics",
      "tradeQualityMetrics",
    ]);
    // 关键：数字必须逐位等于真实模块的输出，而不是本层另算的
    expect(ref.performance?.totalReturnPct).toBe(expected.metrics.returns.totalReturnPct);
    expect(ref.performance?.maxDrawdownPct).toBe(expected.metrics.drawdown.maxDrawdownPct);
    expect(ref.performance?.cagrPct).toBe(expected.metrics.returns.cagrPct);
    expect(ref.performance?.fingerprint).toBe(expected.fingerprint);
    expect(ref.performance?.inputFingerprint).toBe(expected.inputFingerprint);
  });

  it("同输入两次运行 → 链指纹逐位一致（装配层未引入不确定性）", () => {
    const inputs: ClosedLoopWiringInputs = {
      evaluationInput: { backtestFingerprint: HEX64, equityCurve: equityCurveFixture() },
    };
    const build = () =>
      runClosedLoop(
        runRequest({
          stageIds: ["evaluation"],
          stageRunners: createClosedLoopStageRunners(inputs, undefined, { requested: ["evaluation"] }),
          seedHandoffs: [{ kind: "backtestSummary", handoff: seedBacktestSummary() }],
        }),
      );
    expect(build().chainFingerprint).toBe(build().chainFingerprint);
  });
});
