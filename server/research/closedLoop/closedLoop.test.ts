/**
 * STEP 25 / C-25.1 — Closed Loop 全链编排：单元测试（CODE_READY 阶段；合成 evaluator smoke）。
 *
 * 覆盖：
 *   A. 拓扑校验（顺序非法 / 重复 / 未知 / 空集拒绝；保序子集合法）；
 *   B. 最小两阶段链（backtest→evaluation + seed）与全链合成 smoke（14 阶段 EXECUTED，
 *      交接类型匹配，§28 lineage 落账，synthetic 汇总）；
 *   C. 缺注入阶段 → BLOCKED+reasonCode；数据未注入 → CL_DATA_NOT_INJECTED；
 *      dataset gate 非 PASS → CL_DATASET_GATE_NOT_PASS；
 *   D. 阶段抛错 → 后续全 BLOCKED 且不吞异常（error.run 可审计）；
 *   E. 生命周期无证据不推进（CL_GATE_EVIDENCE_MISSING）；证据注入后推进；
 *      合成 dataset gate PASS 需显式 allowSyntheticEvidence；
 *   F. 确定性（同输入两次 run canonical 逐位一致）；
 *   G. round-trip 篡改拒绝；退化输入（空阶段集/重复 stageId/非法 seed/非法 ref）；
 *   H. 诚实接线限制：review 阶段 unfilled 条目（C-24.1 债务）记录 wiringLimit 不越过。
 *
 * 所有 smoke 执行器均为合成（synthetic:true），产物不与真实结论混淆。
 */

import { describe, expect, it } from "vitest";
import { runClosedLoop } from "./orchestrator";
import { ClosedLoopError, CLOSED_LOOP_ERROR_CODES } from "./errors";
import { resolveClosedLoopStageSelection } from "./spec";
import { canonicalStringify, deserializeClosedLoopRun } from "./serialize";
import { verifyClosedLoopRunFingerprint } from "./guards";
import { closedLoopStageToLineageRecord } from "./lineage";
import { attemptClosedLoopLifecycleAdvance } from "./lifecycle";
import type {
  ClosedLoopBacktestSummary,
  ClosedLoopDatasetSummary,
  ClosedLoopEvaluationRef,
  ClosedLoopHandoff,
  ClosedLoopRunMetadata,
  ClosedLoopRunRequest,
  ClosedLoopSeedHandoff,
  ClosedLoopStageExecutor,
  ClosedLoopStageId,
  ClosedLoopStrategyDocRef,
} from "./types";
import { createStrategyLifecycleRecord, applyLifecycleTransition } from "../lifecycle/map";
import type { StrategyLifecycleRecord } from "../lifecycle/types";
import { assertValidExperimentLineageRecord } from "../experimentLineage/validate";
import type { ExperimentLineageRecord } from "../experimentLineage/types";

// ---------------------------------------------------------------------------
// 常量 / fixture
// ---------------------------------------------------------------------------

const T0 = "2026-09-08T00:00:00.000Z";
const RUN_ID = "clrun-test-001";
const DATE_RANGE = { startDate: "2024-01-01", endDate: "2024-06-30" };

const META: ClosedLoopRunMetadata = {
  experimentId: "EXP-20260908-ABCDEF01",
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

const SYNTH_DATASET_VERSION = "rd-1.0.0-1-0000000000000000";
const FAKE_HEX_64 = "a".repeat(64);

function src(module: string, fingerprint?: string): ClosedLoopDatasetSummary["source"] {
  return { module, moduleRunKind: null, runId: null, fingerprint: fingerprint ?? null };
}

function syntheticDataset(gate: ClosedLoopDatasetSummary["gate"] = "PASS"): ClosedLoopDatasetSummary {
  return {
    kind: "datasetSummary",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-data"),
    datasetVersion: SYNTH_DATASET_VERSION,
    gate,
    dateRange: { ...DATE_RANGE },
    builderVersion: null,
    rowSchemaVersion: null,
    rowCount: 100,
    universeCount: 50,
    coverageGaps: [],
  };
}

// ---------------------------------------------------------------------------
// 每阶段合成输出工厂（确定性；全部 synthetic:true）
// ---------------------------------------------------------------------------

function researchOut(ds: ClosedLoopDatasetSummary): ClosedLoopHandoff {
  return {
    kind: "researchSummary",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-research"),
    datasetVersion: ds.datasetVersion,
    candidateRunFingerprint: FAKE_HEX_64,
    evaluated: { candidateCount: 3, decisionDateRange: ds.dateRange },
    notes: ["合成研究摘要（CODE_READY smoke；非真实数据结论）"],
  };
}

function strategyOut(_research: ClosedLoopHandoff & { kind: "researchSummary" }): ClosedLoopStrategyDocRef {
  return {
    kind: "strategyDocRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-strategy"),
    strategyId: META.strategyId,
    strategyVersion: META.strategyVersion,
    docFingerprint: FAKE_HEX_64,
    versionRecordFingerprint: FAKE_HEX_64,
    rules: { entryRuleCount: 2, exitRuleCount: 2, sizingRuleCount: 1, riskRuleCount: 1 },
  };
}

function backtestOut(_sd: ClosedLoopStrategyDocRef): ClosedLoopBacktestSummary {
  return {
    kind: "backtestSummary",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-backtest", FAKE_HEX_64),
    datasetVersion: SYNTH_DATASET_VERSION,
    datasetGate: "PASS",
    dateRange: { ...DATE_RANGE },
    initialCapital: 1_000_000,
    finalEquity: 1_180_000,
    decisionDayCount: 120,
    equityCurvePointCount: 121,
    tradeCount: 40,
  };
}

function evaluationOut(bt: ClosedLoopBacktestSummary): ClosedLoopEvaluationRef {
  return {
    kind: "evaluationRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-eval", FAKE_HEX_64),
    backtestFingerprint: bt.source.fingerprint ?? FAKE_HEX_64,
    performance: { fingerprint: FAKE_HEX_64, inputFingerprint: FAKE_HEX_64, totalReturnPct: 18.0, cagrPct: 34.0, maxDrawdownPct: 8.0 },
    riskAdjusted: { fingerprint: FAKE_HEX_64, sharpeRatio: 1.6, sortinoRatio: 2.1, calmarRatio: 4.2 },
    tradeQuality: { fingerprint: FAKE_HEX_64, winRatePct: 55.0, profitFactor: 1.8, completedTradeCount: 38 },
    evaluatorsCovered: ["performanceMetrics", "riskAdjustedMetrics", "tradeQualityMetrics"],
  };
}

function optimizationOut(_ev: ClosedLoopEvaluationRef): ClosedLoopHandoff {
  return {
    kind: "optimizationRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-optimization"),
    method: "grid",
    candidateParameterKeys: ["lookbackDays", "thresholdPct"],
    evaluatedCandidateCount: 49,
    consistency: { status: "candidate", note: "合成稳定参数区（smoke）" },
  };
}

function robustnessOut(_op: ClosedLoopHandoff & { kind: "optimizationRef" }): ClosedLoopHandoff {
  return {
    kind: "robustnessRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-robustness"),
    axes: [
      { axis: "cost", verdict: "stable", driftNotes: [] },
      { axis: "slippage", verdict: "stable", driftNotes: [] },
    ],
  };
}

function oosOut(_rb: ClosedLoopHandoff & { kind: "robustnessRef" }): ClosedLoopHandoff {
  return {
    kind: "oosRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-oos"),
    windows: [{ windowId: "w1", train: { startDate: "2024-01-01", endDate: "2024-03-31" }, test: { startDate: "2024-04-01", endDate: "2024-04-30" } }],
    oosMetrics: { totalReturnPct: 4.2, maxDrawdownPct: 3.1 },
  };
}

function overfittingOut(_oos: ClosedLoopHandoff & { kind: "oosRef" }): ClosedLoopHandoff {
  return {
    kind: "overfittingRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-overfitting"),
    pbo: { pboValue: 0.18, verdict: "LOW_RISK" },
    conclusion: { verdict: "NOT_OVERFIT_SIGNAL", reasonCode: "OFD_LOW_RISK" },
  };
}

function regimeOut(_of: ClosedLoopHandoff & { kind: "overfittingRef" }): ClosedLoopHandoff {
  return {
    kind: "regimeRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-regime"),
    coverage: { assessedDayCount: 120, unassessedDayCount: 0 },
    compositeSummary: [{ compositeKey: "trend_up-vol_mid-liquidity_ok", dayCount: 120 }],
  };
}

function paperOut(_rg: ClosedLoopHandoff & { kind: "regimeRef" }): ClosedLoopHandoff {
  return {
    kind: "paperRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-paper"),
    accountId: "paper-acct-1",
    initialCapital: 1_000_000,
    finalEquity: 1_050_000,
    netReturnPct: 5.0,
    fillCount: 30,
    unfilledCount: 0,
  };
}

function reviewOut(_pp: ClosedLoopHandoff & { kind: "paperRef" }): ClosedLoopHandoff {
  return {
    kind: "reviewRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-review"),
    journalEntryCount: 30,
    reviewRecordCount: 3,
    reconcile: { matchedCount: 27, deviatedCount: 2, unfilledCount: 1 },
    wiringLimits: [
      {
        code: "CL_REVIEW_UNFILLED_VALIDATION_DEFERRED",
        detail: "C-24.1 上游已知债务：reconcile 可产出 actual=null 的 unfilled 条目，assertValidTradeJournalEntry 会拒绝；C-25.1 不改 C-24.1，接线限制显式记录",
      },
    ],
  };
}

function disciplineOut(_rv: ClosedLoopHandoff & { kind: "reviewRef" }): ClosedLoopHandoff {
  return {
    kind: "disciplineRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-discipline"),
    conclusionReasonCode: "DFA_STABLE",
    patterns: [],
  };
}

function finalizeOut(_dc: ClosedLoopHandoff & { kind: "disciplineRef" }): ClosedLoopHandoff {
  return {
    kind: "finalizeRef",
    handoffVersion: 1,
    synthetic: true,
    source: src("synthetic-finalize"),
    lifecycle: {
      strategyId: META.strategyId,
      strategyVersion: META.strategyVersion,
      from: "Research",
      to: "Research",
      advanced: false,
      transitionSeq: null,
      recordFingerprint: null,
      blockedReasonCode: null,
    },
    promotion: { considered: false, applied: false, evidenceIsSynthetic: true, detail: "合成 smoke：未推进" },
    runSummary: { executedStageCount: 0, blockedStageCount: 0, synthetic: true, note: "synthetic smoke" },
  };
}

// 全阶段合成执行器（每 stage 一个；全部 deterministic）
function syntheticRunners(): Record<string, ClosedLoopStageExecutor<ClosedLoopStageId>> {
  return {
    data: (() => syntheticDataset("PASS")) as ClosedLoopStageExecutor<"data">,
    research: ((_ctx, input: ClosedLoopDatasetSummary) => researchOut(input)) as ClosedLoopStageExecutor<"research">,
    strategy: ((_ctx, input: ClosedLoopHandoff & { kind: "researchSummary" }) => strategyOut(input)) as unknown as ClosedLoopStageExecutor<"strategy">,
    backtest: ((_ctx, input: ClosedLoopStrategyDocRef) => backtestOut(input)) as ClosedLoopStageExecutor<"backtest">,
    evaluation: ((_ctx, input: ClosedLoopBacktestSummary) => evaluationOut(input)) as ClosedLoopStageExecutor<"evaluation">,
    optimization: ((_ctx, input: ClosedLoopEvaluationRef) => optimizationOut(input)) as unknown as ClosedLoopStageExecutor<"optimization">,
    robustness: ((_ctx, input: ClosedLoopHandoff & { kind: "optimizationRef" }) => robustnessOut(input)) as unknown as ClosedLoopStageExecutor<"robustness">,
    oos: ((_ctx, input: ClosedLoopHandoff & { kind: "robustnessRef" }) => oosOut(input)) as unknown as ClosedLoopStageExecutor<"oos">,
    overfitting: ((_ctx, input: ClosedLoopHandoff & { kind: "oosRef" }) => overfittingOut(input)) as unknown as ClosedLoopStageExecutor<"overfitting">,
    regime: ((_ctx, input: ClosedLoopHandoff & { kind: "overfittingRef" }) => regimeOut(input)) as unknown as ClosedLoopStageExecutor<"regime">,
    paper: ((_ctx, input: ClosedLoopHandoff & { kind: "regimeRef" }) => paperOut(input)) as unknown as ClosedLoopStageExecutor<"paper">,
    review: ((_ctx, input: ClosedLoopHandoff & { kind: "paperRef" }) => reviewOut(input)) as unknown as ClosedLoopStageExecutor<"review">,
    discipline: ((_ctx, input: ClosedLoopHandoff & { kind: "reviewRef" }) => disciplineOut(input)) as unknown as ClosedLoopStageExecutor<"discipline">,
    finalize: ((_ctx, input: ClosedLoopHandoff & { kind: "disciplineRef" }) => finalizeOut(input)) as unknown as ClosedLoopStageExecutor<"finalize">,
  } as Record<string, ClosedLoopStageExecutor<ClosedLoopStageId>>;
}

function baseRequest(overrides?: Partial<ClosedLoopRunRequest>): ClosedLoopRunRequest {
  return {
    runId: RUN_ID,
    createdAt: T0,
    metadata: META,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 生命周期 fixture：Draft → Research → Candidate（含 evidence 历史）
// ---------------------------------------------------------------------------

function candidateLifecycleRecord(): StrategyLifecycleRecord {
  const genesis = createStrategyLifecycleRecord({
    strategyId: META.strategyId,
    strategyVersion: META.strategyVersion,
    versionRecordFingerprint: FAKE_HEX_64,
    initialStatus: "Draft",
    timestamp: T0,
    reason: "测试 genesis",
    actor: "unit-test",
  });
  const research = applyLifecycleTransition(genesis, {
    to: "Research",
    timestamp: T0,
    reason: "研究启动",
    experimentId: META.experimentId,
    evidence: [],
    actor: "unit-test",
  });
  const candidate = applyLifecycleTransition(research, {
    to: "Candidate",
    timestamp: T0,
    reason: "进入候选（合成搜索 run）",
    experimentId: META.experimentId,
    evidence: [{ kind: "searchRun", runId: "sr-synthetic-1" }],
    actor: "unit-test",
  });
  return candidate;
}

const DISCIPLINE_SEED: ClosedLoopSeedHandoff = {
  kind: "disciplineRef",
  handoff: disciplineOut({ kind: "reviewRef" } as ClosedLoopHandoff & { kind: "reviewRef" }),
};
const REVIEW_SEED: ClosedLoopSeedHandoff = {
  kind: "reviewRef",
  handoff: reviewOut({ kind: "paperRef" } as ClosedLoopHandoff & { kind: "paperRef" }),
};

function stageState(run: ReturnType<typeof runClosedLoop>, stageId: ClosedLoopStageId): string {
  const row = run.stages.find((r) => r.stageId === stageId);
  if (row === undefined) throw new Error(`run 缺阶段 ${stageId}`);
  return row.state;
}

function blockedReason(run: ReturnType<typeof runClosedLoop>, stageId: ClosedLoopStageId): string | null {
  const row = run.stages.find((r) => r.stageId === stageId);
  return row?.blocked?.reasonCode ?? null;
}

// ---------------------------------------------------------------------------
// A. 拓扑校验
// ---------------------------------------------------------------------------

describe("closedLoop 拓扑校验（spec）", () => {
  it("A1 canonical 全链保序（14 阶段）", () => {
    const ids = resolveClosedLoopStageSelection(undefined);
    expect(ids).toHaveLength(14);
    expect(ids).toEqual([
      "data", "research", "strategy", "backtest", "evaluation", "optimization",
      "robustness", "oos", "overfitting", "regime", "paper", "review", "discipline", "finalize",
    ]);
  });

  it("A2 保序子集合法（backtest→evaluation 两阶段）", () => {
    expect(resolveClosedLoopStageSelection(["backtest", "evaluation"])).toEqual(["backtest", "evaluation"]);
  });

  it("A3 空阶段集拒绝（CL_STAGES_EMPTY）", () => {
    expect(() => resolveClosedLoopStageSelection([])).toThrowError(/空阶段集/);
  });

  it("A4 重复阶段拒绝（CL_STAGES_DUPLICATE）", () => {
    expect(() => resolveClosedLoopStageSelection(["backtest", "backtest"])).toThrowError(/重复阶段/);
  });

  it("A5 未知阶段拒绝（CL_STAGES_UNKNOWN）", () => {
    expect(() => resolveClosedLoopStageSelection(["nonsense" as ClosedLoopStageId])).toThrowError(/未知阶段/);
  });

  it("A6 逆序（违反 canonical 拓扑）拒绝（CL_STAGES_ORDER_VIOLATION）", () => {
    expect(() => resolveClosedLoopStageSelection(["evaluation", "backtest"])).toThrowError(/拓扑顺序/);
  });

  it("A7 非法 runClosedLoop 请求顶层抛错（CL_STAGES_EMPTY）", () => {
    expect(() => runClosedLoop(baseRequest({ stageIds: [] }))).toThrowError(ClosedLoopError);
  });
});

// ---------------------------------------------------------------------------
// B. 最小链 + 全链 smoke
// ---------------------------------------------------------------------------

describe("closedLoop 编排执行（smoke，synthetic）", () => {
  it("B1 最小两阶段链 [backtest,evaluation]（seed strategyDocRef）全 EXECUTED 且交接类型匹配", () => {
    const strategySeed = strategyOut({ kind: "researchSummary" } as ClosedLoopHandoff & { kind: "researchSummary" });
    const run = runClosedLoop(
      baseRequest({
        stageIds: ["backtest", "evaluation"],
        stageRunners: {
          backtest: ((_ctx, input) => backtestOut(input)) as ClosedLoopStageExecutor<"backtest">,
          evaluation: ((_ctx, input) => evaluationOut(input)) as ClosedLoopStageExecutor<"evaluation">,
        },
        seedHandoffs: [{ kind: "strategyDocRef", handoff: strategySeed }],
      }),
    );
    expect(run.overall.status).toBe("ALL_EXECUTED");
    expect(stageState(run, "data")).toBe("SKIPPED");
    expect(stageState(run, "strategy")).toBe("SKIPPED");
    expect(stageState(run, "backtest")).toBe("EXECUTED");
    expect(stageState(run, "evaluation")).toBe("EXECUTED");
    expect(stageState(run, "finalize")).toBe("SKIPPED");
    const bt = run.stages.find((r) => r.stageId === "backtest")!.output;
    const ev = run.stages.find((r) => r.stageId === "evaluation")!.output;
    expect(bt!.kind).toBe("backtestSummary");
    expect(ev!.kind).toBe("evaluationRef");
    // 交接类型匹配：evaluation 引用的 backtest 指纹 = backtest 阶段产出指纹（编排内部传递正确）。
    expect((ev as ClosedLoopEvaluationRef).backtestFingerprint).toBe((bt as ClosedLoopBacktestSummary).source.fingerprint);
    // EXECUTED 阶段必落 §28 谱系锚点 + lineageRecord。
    const lineage = run.stages.find((r) => r.stageId === "backtest")!.lineage!;
    expect(lineage.lineageRecord).not.toBeNull();
    expect(run.overall.synthetic).toBe(true);
    expect(run.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("B2 全链 14 阶段注入合成 evaluator 全 EXECUTED（每阶段 EXECUTED + 交接类型匹配）", () => {
    const run = runClosedLoop(baseRequest({ stageRunners: syntheticRunners() }));
    expect(run.overall.status).toBe("ALL_EXECUTED");
    expect(run.overall.executedStageCount).toBe(14);
    expect(run.overall.blockedStageCount).toBe(0);
    for (const stageId of ["data", "research", "strategy", "backtest", "evaluation", "optimization", "robustness", "oos", "overfitting", "regime", "paper", "review", "discipline", "finalize"] as ClosedLoopStageId[]) {
      expect(stageState(run, stageId)).toBe("EXECUTED");
      const row = run.stages.find((r) => r.stageId === stageId)!;
      expect(row.output!.kind).toBe(row.producedHandoffKind);
      expect(row.outputHandoffFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.lineage).not.toBeNull();
    }
    expect(run.overall.synthetic).toBe(true);
    expect(run.blockedSummary).toHaveLength(0);
    // 交接引用必须为同一 run id（链内 runId 一致性）。
    expect(run.runId).toBe(RUN_ID);
  });

  it("B3 review 阶段诚实接线限制：unfilled 债务以 wiringLimit 记录（不触发 C-24.1 assert）", () => {
    const run = runClosedLoop(baseRequest({ stageRunners: syntheticRunners() }));
    const review = run.stages.find((r) => r.stageId === "review")!.output! as ClosedLoopHandoff & { kind: "reviewRef" };
    expect(review.wiringLimits.some((w) => w.code === "CL_REVIEW_UNFILLED_VALIDATION_DEFERRED")).toBe(true);
  });

  it("B4 每阶段 §28 谱系记录通过 C-13.3 结构校验（lineageRecord 由 createExperimentLineageRecord 组装）", () => {
    const run = runClosedLoop(
      baseRequest({
        stageIds: ["backtest", "evaluation"],
        stageRunners: {
          backtest: ((_ctx, input) => backtestOut(input)) as ClosedLoopStageExecutor<"backtest">,
          evaluation: ((_ctx, input) => evaluationOut(input)) as ClosedLoopStageExecutor<"evaluation">,
        },
        seedHandoffs: [
          { kind: "strategyDocRef", handoff: strategyOut({ kind: "researchSummary" } as ClosedLoopHandoff & { kind: "researchSummary" }) },
        ],
      }),
    );
    for (const row of run.stages.filter((r) => r.state === "EXECUTED")) {
      const record: ExperimentLineageRecord = row.lineage!.lineageRecord!;
      expect(record.experimentId).toBe(META.experimentId);
      expect(record.strategyId).toBe(META.strategyId);
      expect(record.outcome).toBeNull();
    }
  });

  it("B5 lineage 适配：解析不到版本时显式 missing；全解析后通过 C-13.3 validator", () => {
    // 未解析 metadata（datasetVersion null）→ lineageRecord.datasetVersion.kind === "missing"。
    const run = runClosedLoop(
      baseRequest({
        stageIds: ["backtest"],
        stageRunners: { backtest: ((_ctx, input) => backtestOut(input)) as ClosedLoopStageExecutor<"backtest"> },
        seedHandoffs: [
          { kind: "strategyDocRef", handoff: strategyOut({ kind: "researchSummary" } as ClosedLoopHandoff & { kind: "researchSummary" }) },
        ],
      }),
    );
    const record = run.stages.find((r) => r.stageId === "backtest")!.lineage!.lineageRecord!;
    expect(record.datasetVersion.kind).toBe("missing");
    // 全解析 metadata → resolved 且通过 requireResolvedRefs 齐备性校验。
    const resolvedRecord = closedLoopStageToLineageRecord({
      stageId: "backtest",
      stageRunId: "clrun-x::backtest",
      metadata: {
        ...META,
        datasetVersion: SYNTH_DATASET_VERSION,
        universeVersion: SYNTH_DATASET_VERSION,
        codeVersion: "1.0.0+g0000000",
        executionModel: "next-open",
        costModel: { commissionRate: 0.00025, stampDutyRate: 0.0005, transferFeeRate: 0.00001, slippageBps: 10, minCommission: 5, lotSize: 100 },
      },
      createdAt: T0,
    });
    assertValidExperimentLineageRecord(resolvedRecord, { requireResolvedRefs: true });
    expect(resolvedRecord.datasetVersion.kind).toBe("resolved");
  });
});

// ---------------------------------------------------------------------------
// C. 诚实边界：数据不可用 / gate 未过 / 缺注入
// ---------------------------------------------------------------------------

describe("closedLoop 诚实边界（BLOCKED + reasonCode，返回 run 不抛错）", () => {
  it("C1 数据链未注入 → data BLOCKED（CL_DATA_NOT_INJECTED）且后续全部 CL_UPSTREAM_BLOCKED", () => {
    const runners = syntheticRunners();
    delete runners.data;
    const run = runClosedLoop(baseRequest({ stageRunners: runners }));
    expect(run.overall.status).toBe("NO_STAGE_EXECUTED");
    expect(blockedReason(run, "data")).toBe("CL_DATA_NOT_INJECTED");
    expect(blockedReason(run, "research")).toBe("CL_UPSTREAM_BLOCKED");
    expect(run.blockedSummary[0]!.stageId).toBe("data");
    expect(run.blockedSummary[0]!.reasonCode).toBe("CL_DATA_NOT_INJECTED");
  });

  it("C2 dataProvider 注入但 gate=INCONCLUSIVE → data BLOCKED（CL_DATASET_GATE_NOT_PASS）", () => {
    const runners = syntheticRunners();
    delete runners.data;
    const run = runClosedLoop(
      baseRequest({
        stageRunners: runners,
        dataProvider: () => syntheticDataset("INCONCLUSIVE"),
      }),
    );
    expect(blockedReason(run, "data")).toBe("CL_DATASET_GATE_NOT_PASS");
    expect(blockedReason(run, "research")).toBe("CL_UPSTREAM_BLOCKED");
  });

  it("C3 dataset gate FAIL 的 seed + research 起步 → research BLOCKED（CL_DATASET_GATE_NOT_PASS）", () => {
    const run = runClosedLoop(
      baseRequest({
        stageIds: ["research"],
        stageRunners: {
          research: ((_ctx, input) => researchOut(input)) as ClosedLoopStageExecutor<"research">,
        },
        seedHandoffs: [{ kind: "datasetSummary", handoff: syntheticDataset("FAIL") }],
      }),
    );
    expect(blockedReason(run, "research")).toBe("CL_DATASET_GATE_NOT_PASS");
  });

  it("C4 缺注入阶段（optimization）→ optimization BLOCKED（CL_RUNNER_NOT_INJECTED）+ 后续全 CL_UPSTREAM_BLOCKED", () => {
    const runners = syntheticRunners() as Record<string, ClosedLoopStageExecutor<ClosedLoopStageId>>;
    delete runners.optimization;
    const run = runClosedLoop(baseRequest({ stageRunners: runners }));
    expect(stageState(run, "evaluation")).toBe("EXECUTED");
    expect(blockedReason(run, "optimization")).toBe("CL_RUNNER_NOT_INJECTED");
    expect(blockedReason(run, "robustness")).toBe("CL_UPSTREAM_BLOCKED");
    expect(blockedReason(run, "finalize")).toBe("CL_UPSTREAM_BLOCKED");
    expect(run.overall.status).toBe("PARTIAL_BLOCKED");
  });

  it("C5 subset 链缺 seed → 该阶段 BLOCKED（CL_STAGE_INPUT_MISSING）", () => {
    const run = runClosedLoop(
      baseRequest({
        stageIds: ["backtest", "evaluation"],
        stageRunners: {
          backtest: ((_ctx, input) => backtestOut(input)) as ClosedLoopStageExecutor<"backtest">,
          evaluation: ((_ctx, input) => evaluationOut(input)) as ClosedLoopStageExecutor<"evaluation">,
        },
        // 故意缺 strategyDocRef seed
      }),
    );
    expect(blockedReason(run, "backtest")).toBe("CL_STAGE_INPUT_MISSING");
    expect(blockedReason(run, "evaluation")).toBe("CL_UPSTREAM_BLOCKED");
  });
});

// ---------------------------------------------------------------------------
// D. 阶段抛错 → 后续全 BLOCKED（不吞异常）
// ---------------------------------------------------------------------------

describe("closedLoop 阶段抛错（FAIL FAST + 审计 run）", () => {
  it("D1 evaluation 执行器抛错 → 其后（robustness~finalize）全 BLOCKED；error.run 可审计；异常未吞", () => {
    const runners = syntheticRunners() as Record<string, ClosedLoopStageExecutor<ClosedLoopStageId>>;
    runners.evaluation = ((_ctx, _input) => {
      throw new Error("boom-eval");
    }) as ClosedLoopStageExecutor<"evaluation">;
    let caught: ClosedLoopError | null = null;
    try {
      runClosedLoop(baseRequest({ stageRunners: runners }));
    } catch (error) {
      caught = error as ClosedLoopError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe(CLOSED_LOOP_ERROR_CODES.CL_STAGE_EXECUTION_ERROR);
    expect(caught!.message).toContain("boom-eval");
    // run 挂在 error.run（审计可查）。
    const run = caught!.run;
    expect(run).not.toBeNull();
    expect(run.stages.find((r) => r.stageId === "backtest")!.state).toBe("EXECUTED");
    expect(run.stages.find((r) => r.stageId === "evaluation")!.state).toBe("BLOCKED");
    expect(run.stages.find((r) => r.stageId === "evaluation")!.blocked!.errorMessage).toContain("boom-eval");
    expect(run.stages.find((r) => r.stageId === "optimization")!.state).toBe("BLOCKED");
    expect(run.stages.find((r) => r.stageId === "optimization")!.blocked!.reasonCode).toBe("CL_UPSTREAM_BLOCKED");
    expect(run.stages.find((r) => r.stageId === "finalize")!.blocked!.reasonCode).toBe("CL_UPSTREAM_BLOCKED");
  });

  it("D2 执行器返回错误 kind → CL_STAGE_OUTPUT_INVALID（契约失败，审计 run 可查）", () => {
    const runners = syntheticRunners() as Record<string, ClosedLoopStageExecutor<ClosedLoopStageId>>;
    runners.evaluation = ((_ctx, _input) => optimizationOut(_input as ClosedLoopEvaluationRef)) as unknown as ClosedLoopStageExecutor<"evaluation">;
    let caught: ClosedLoopError | null = null;
    try {
      runClosedLoop(baseRequest({ stageRunners: runners }));
    } catch (error) {
      caught = error as ClosedLoopError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe(CLOSED_LOOP_ERROR_CODES.CL_STAGE_OUTPUT_INVALID);
    const run = caught!.run;
    expect(run.stages.find((r) => r.stageId === "evaluation")!.blocked!.reasonCode).toBe("CL_STAGE_OUTPUT_INVALID");
  });
});

// ---------------------------------------------------------------------------
// E. 生命周期整合（finalize；evidence 门槛）
// ---------------------------------------------------------------------------

describe("closedLoop 生命周期整合（finalize；C-21.1 evidence 门槛）", () => {
  function lifecycleChainRequest(lifecycleOverrides?: Partial<ClosedLoopRunRequest["lifecycle"]>) {
    const runners = syntheticRunners();
    delete runners.finalize;
    const record = candidateLifecycleRecord();
    return baseRequest({
      stageIds: ["discipline", "finalize"],
      stageRunners: runners,
      seedHandoffs: [REVIEW_SEED],
      lifecycle: {
        lifecycleRecord: record,
        transition: {
          to: "Validated",
          timestamp: T0,
          reason: "C-25.1 合成 smoke：Candidate → Validated",
          experimentId: META.experimentId,
          evidence: [],
          actor: "unit-test",
        },
        ...lifecycleOverrides,
      },
    });
  }

  it("E1 无证据不推进：finalize BLOCKED（CL_GATE_EVIDENCE_MISSING），生命周期记录不变（停在 Candidate）", () => {
    const record = candidateLifecycleRecord();
    const run = runClosedLoop(lifecycleChainRequest());
    expect(stageState(run, "discipline")).toBe("EXECUTED");
    expect(stageState(run, "finalize")).toBe("BLOCKED");
    expect(blockedReason(run, "finalize")).toBe("CL_GATE_EVIDENCE_MISSING");
    expect(run.overall.status).toBe("PARTIAL_BLOCKED");
    expect(run.overall.promotionApplied).toBe(false);
    // 记录未被推进：仍是 Candidate，transition 链长不变，fingerprint 不变。
    expect(record.status).toBe("Candidate");
    expect(record.transitions).toHaveLength(3);
  });

  it("E2 evidence 注入（metricsRecord PASS）→ finalize EXECUTED + 生命周期推进至 Validated", () => {
    const run = runClosedLoop(
      lifecycleChainRequest({
        transition: {
          to: "Validated",
          timestamp: T0,
          reason: "evidence 注入：metricsRecord PASS",
          experimentId: META.experimentId,
          evidence: [{ kind: "metricsRecord", metricsId: "eval-metrics-1", result: "PASS", note: "合成测试 evidence" }],
          actor: "unit-test",
        },
      }),
    );
    expect(stageState(run, "finalize")).toBe("EXECUTED");
    const finalizeOut = run.stages.find((r) => r.stageId === "finalize")!.output! as ClosedLoopHandoff & { kind: "finalizeRef" };
    expect(finalizeOut.lifecycle.advanced).toBe(true);
    expect(finalizeOut.lifecycle.to).toBe("Validated");
    expect(finalizeOut.lifecycle.from).toBe("Candidate");
    expect(finalizeOut.promotion.considered).toBe(false); // Validated 非 promotion 档
    expect(run.overall.promotionApplied).toBe(false);
    expect(run.overall.status).toBe("ALL_EXECUTED");
  });

  it("E3 synthetic dataset gate PASS 需显式放行：默认 BLOCKED（防合成冒充真实认证）", () => {
    const runners = syntheticRunners();
    delete runners.data;
    delete runners.finalize;
    const record = candidateLifecycleRecord();
    const run = runClosedLoop(
      baseRequest({
        stageIds: ["research", "finalize"],
        stageRunners: {
          research: runners.research!,
        },
        seedHandoffs: [
          { kind: "datasetSummary", handoff: syntheticDataset("PASS") },
          DISCIPLINE_SEED,
        ],
        lifecycle: {
          lifecycleRecord: record,
          transition: {
            to: "Validated",
            timestamp: T0,
            reason: "synthetic dataset gate PASS 声明",
            experimentId: META.experimentId,
            evidence: [{ kind: "datasetGate", gate: "PASS", datasetVersion: SYNTH_DATASET_VERSION, note: "合成（CODE_READY 测试）" }],
            actor: "unit-test",
          },
        },
      }),
    );
    expect(blockedReason(run, "finalize")).toBe("CL_GATE_EVIDENCE_MISSING");
  });

  it("E4 synthetic dataset gate PASS + allowSyntheticEvidence（仅测试）→ 推进", () => {
    const runners = syntheticRunners();
    delete runners.data;
    const record = candidateLifecycleRecord();
    const run = runClosedLoop(
      baseRequest({
        stageIds: ["research", "finalize"],
        stageRunners: {
          research: runners.research!,
        },
        seedHandoffs: [
          { kind: "datasetSummary", handoff: syntheticDataset("PASS") },
          DISCIPLINE_SEED,
        ],
        lifecycle: {
          lifecycleRecord: record,
          transition: {
            to: "Validated",
            timestamp: T0,
            reason: "synthetic dataset gate PASS 声明（测试显式放行）",
            experimentId: META.experimentId,
            evidence: [{ kind: "datasetGate", gate: "PASS", datasetVersion: SYNTH_DATASET_VERSION, note: "合成（仅测试）" }],
            actor: "unit-test",
          },
          allowSyntheticEvidence: true,
        },
      }),
    );
    expect(stageState(run, "finalize")).toBe("EXECUTED");
    const finalizeOut = run.stages.find((r) => r.stageId === "finalize")!.output! as ClosedLoopHandoff & { kind: "finalizeRef" };
    expect(finalizeOut.lifecycle.advanced).toBe(true);
    expect(finalizeOut.lifecycle.to).toBe("Validated");
    expect(finalizeOut.promotion.evidenceIsSynthetic).toBe(true);
  });

  it("E5 attemptClosedLoopLifecycleAdvance 直接调用（不依赖编排）：无证据 → blocked；跳级 → 抛错", () => {
    const record = candidateLifecycleRecord();
    const blocked = attemptClosedLoopLifecycleAdvance(record, {
      to: "Validated",
      timestamp: T0,
      reason: "无证据尝试",
      experimentId: META.experimentId,
      evidence: [],
      actor: "unit-test",
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.status === "blocked" && blocked.reasonCode).toBe("CL_GATE_EVIDENCE_MISSING");
    // 跳级：Draft 无法直接跳 Candidate（record 已是 Candidate → 试跳 Paper 被迁移表拒绝 → 非法抛错）
    expect(() =>
      attemptClosedLoopLifecycleAdvance(record, {
        to: "Paper",
        timestamp: T0,
        reason: "跳级测试",
        experimentId: META.experimentId,
        evidence: [],
        actor: "unit-test",
      }),
    ).toThrowError(ClosedLoopError);
  });
});

// ---------------------------------------------------------------------------
// F. 确定性
// ---------------------------------------------------------------------------

describe("closedLoop 确定性", () => {
  it("F1 同输入两次 run canonical 逐位一致", () => {
    const a = runClosedLoop(baseRequest({ stageRunners: syntheticRunners() }));
    const b = runClosedLoop(baseRequest({ stageRunners: syntheticRunners() }));
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });
});

// ---------------------------------------------------------------------------
// G. round-trip 篡改拒绝 / 退化输入
// ---------------------------------------------------------------------------

describe("closedLoop round-trip 与退化输入", () => {
  it("G1 serialize/deserialize round-trip 指纹一致", () => {
    const run = runClosedLoop(baseRequest({ stageRunners: syntheticRunners() }));
    const json = JSON.stringify(run);
    const parsed = deserializeClosedLoopRun(json);
    expect(parsed.fingerprint).toBe(run.fingerprint);
    expect(verifyClosedLoopRunFingerprint(parsed)).toBe(true);
  });

  it("G2 篡改（改某阶段状态/交接数值）→ 指纹复核失败 + deserialize verify 抛错", () => {
    const run = runClosedLoop(baseRequest({ stageRunners: syntheticRunners() }));
    const mutated = JSON.parse(JSON.stringify(run)) as typeof run;
    const backtestRow = mutated.stages.find((r) => r.stageId === "backtest")!;
    (backtestRow.output as ClosedLoopBacktestSummary).finalEquity = 9_999_999;
    expect(verifyClosedLoopRunFingerprint(mutated)).toBe(false);
    expect(() => deserializeClosedLoopRun(JSON.stringify(mutated), { verify: true })).toThrowError(/篡改|不一致/);
  });

  it("G3 非法 seed（kind 冗余：与 stage 冲突）→ 抛错（CL_SEED_REDUNDANT_WITH_STAGE）", () => {
    expect(() =>
      runClosedLoop(
        baseRequest({
          stageRunners: syntheticRunners(),
          seedHandoffs: [{ kind: "datasetSummary", handoff: syntheticDataset("PASS") }],
        }),
      ),
    ).toThrowError(ClosedLoopError);
  });

  it("G4 非法 seed（无消费者/闲置）→ 抛错（CL_SEED_UNUSED）", () => {
    expect(() =>
      runClosedLoop(
        baseRequest({
          stageIds: ["discipline", "finalize"],
          stageRunners: {
            discipline: ((_ctx, input) => disciplineOut(input)) as unknown as ClosedLoopStageExecutor<"discipline">,
          },
          seedHandoffs: [{ kind: "backtestSummary", handoff: backtestOut({} as ClosedLoopStrategyDocRef) }],
        }),
      ),
    ).toThrowError(ClosedLoopError);
  });

  it("G5 非法 metadata（experimentId 非 EXP 形态）→ 抛错（CL_METADATA_INVALID）", () => {
    expect(() =>
      runClosedLoop(baseRequest({ metadata: { ...META, experimentId: "bad-id" } })),
    ).toThrowError(ClosedLoopError);
  });

  it("G6 createdAt 非法 → 抛错（CL_CREATED_AT_INVALID）", () => {
    expect(() => runClosedLoop(baseRequest({ createdAt: "yesterday" }))).toThrowError(ClosedLoopError);
  });

  it("G7 非法 ref（source.fingerprint 空串）→ 输出契约校验失败抛错", () => {
    const runners = syntheticRunners();
    runners.backtest = ((_ctx, _input) => ({
      ...backtestOut({} as ClosedLoopStrategyDocRef),
      source: { module: "", moduleRunKind: null, runId: null, fingerprint: "  " },
    })) as ClosedLoopStageExecutor<"backtest">;
    let caught: ClosedLoopError | null = null;
    try {
      runClosedLoop(baseRequest({ stageRunners: runners }));
    } catch (error) {
      caught = error as ClosedLoopError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe(CLOSED_LOOP_ERROR_CODES.CL_STAGE_OUTPUT_INVALID);
  });
});
