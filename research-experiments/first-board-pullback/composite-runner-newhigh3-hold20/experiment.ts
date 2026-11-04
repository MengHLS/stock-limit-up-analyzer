/**
 * COMPOSITE-RUNNER-DATASET-PROVIDER-001 —— 正式 Experiment：`composite-runner-newhigh3-hold20`。
 *
 * 唯一职责（编排，不含任何研究/回测实现）：
 *   context.composite → buildFirstLimitPullback3FTop3SourceRun → runCompositeRunnerBacktest → A/C → confirmatoryGate
 *
 * 固定坐标：750001（执行）+ 660001（基线），NEW_HIGH_3 / decisionHoldingDays=5 / extendToHoldingDays=20 / maxPositions=5。
 * 不读 DB、不实现 simulator（全部经 `@experiments/compositeRunnerBridge` 复用唯一实现）。
 */
import { z } from "zod";
import type { ExperimentDefinition, ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import {
  buildFirstLimitPullback3FTop3SourceRun,
  rebuildCompositeRun,
  runCompositeRunnerBacktest,
  buildThreeFactorTopNStrategyDocument,
  buildThreeFactorTopNFamilyArmInput,
  THREE_FACTOR_TOPN_CREATED_AT,
  COMPOSITE_RUNNER_TOP_N,
  type CompositeExecutionSurfacePayload,
} from "../../compositeRunnerBridge";

export const COMPUTATION_VERSION = "1.0.0";
const EXTENSION_DATASET_VERSION_ID = 750001;
const BASELINE_DATASET_VERSION_ID = 660001;
/** PROMOTE-001 冻结值（parity 目标）。 */
const PROMOTE_A_RETURN_PCT = 15.7876907121;
const PROMOTE_A_TRADES = 1619;
const PROMOTE_C_RETURN_PCT = 129.6860411847;
const PROMOTE_C_TRADES = 1453;
const PROMOTE_TRIGGER = 159;

export const compositeRunnerNewHigh3Hold20Schema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  parity: z.object({
    aReturnPct: z.number(), aTrades: z.number().int(), cReturnPct: z.number(), cTrades: z.number().int(),
    trigger: z.number().int(), tolerance: z.number(), pass: z.boolean(),
  }),
  metrics: z.object({
    aReturnPct: z.number(), cReturnPct: z.number(), aMaxDrawdownPct: z.number().nullable(), cMaxDrawdownPct: z.number().nullable(),
    holdoutAReturnPct: z.number().nullable(), holdoutCReturnPct: z.number().nullable(),
    holdoutAMaxDrawdownPct: z.number().nullable(), holdoutCMaxDrawdownPct: z.number().nullable(),
  }),
  note: z.string(),
});

function maxDd(curve: readonly { equity: number }[]): number | null {
  if (curve.length === 0) return null;
  let peak = curve[0]!.equity, worst = 0;
  for (const p of curve) { peak = Math.max(peak, p.equity); if (peak > 0) worst = Math.min(worst, p.equity / peak - 1); }
  return Math.abs(worst) * 100;
}
const ret = (r: { finalEquity: number; initialCapital: number }) => (r.finalEquity / r.initialCapital - 1) * 100;

export const compositeRunnerNewHigh3Hold20Experiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-hold20",
    name: "NEW_HIGH_3 Runner / hold=20 组合层验证",
    version: COMPUTATION_VERSION,
    description:
      "在完整组合回测（资金循环 / maxPositions=5 / 原止损 / MA5-MA10 / strongHold）语义下验证 "
      + "first-limit-pullback-3f-top3@1.62.1 + runnerBridge{NEW_HIGH_3, decisionHoldingDays=5, extendToHoldingDays=20}；"
      + "同时复现 PROMOTE-001 的 full-range parity。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "composite-runner", "runner-hold20", "holdout", "parity"],
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredDatasetVersionLabel: "v7",
      requiredColumns: {
        events: ["limitUpPrice"],
        observation: ["open", "high", "low", "close", "volume"],
      },
      prefixRelativeDays: [],
      postRelativeDays: [1],
      decisionOffsetDays: 5,
      usesForwardData: true,
      forwardDataPurpose: "Runner 延长持仓到 hold=20 需要 T+17..T+20 的真实后续行情用于退出与估值。",
      eventScanPolicy: "PLATFORM_LIMIT",
    },
    executionSurface: "COMPOSITE_PORTFOLIO",
    compositeExecution: { baselineDatasetVersionId: BASELINE_DATASET_VERSION_ID },
    pageKey: "first-board-pullback/composite-runner-newhigh3-hold20",
    pageTitle: "NEW_HIGH_3 Runner / hold=20 组合层验证",
  },
  resultSchema: compositeRunnerNewHigh3Hold20Schema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    const dateRange = surface.dateRange;
    const arm = buildFirstLimitPullback3FTop3SourceRun({ dataset: surface.baselineDataset, dateRange });
    const sourceRun = rebuildCompositeRun(arm.sourceRun, surface.executionDataset);
    const strategyDocument = buildThreeFactorTopNStrategyDocument(
      buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
        topN: COMPOSITE_RUNNER_TOP_N, datasetVersionId: EXTENSION_DATASET_VERSION_ID, datasetLabel: "v7",
      }),
    );
    const common = {
      dataset: surface.executionDataset, sourceRun, strategyDocument,
      datasetVersionId: EXTENSION_DATASET_VERSION_ID, codeVersion: COMPUTATION_VERSION, createdAt: THREE_FACTOR_TOPN_CREATED_AT,
    };
    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const, state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const, extendToHoldingDays: 20,
    };
    const fullA = await runCompositeRunnerBacktest({ ...common, dateRange, name: "runner-hold20-full-A" });
    const fullC = await runCompositeRunnerBacktest({ ...common, dateRange, name: "runner-hold20-full-C", runnerBridge });
    const aReturnPct = ret(fullA.run), cReturnPct = ret(fullC.run);
    const baseBy = new Map(fullA.run.trades.map((t) => [t.securityId + "|" + t.entryTime, t]));
    let trigger = 0;
    for (const t of fullC.run.trades) { const b = baseBy.get(t.securityId + "|" + t.entryTime); if (b && b.exitTime !== t.exitTime) trigger += 1; }
    const tol = 1e-6;
    const parityPass = Math.abs(aReturnPct - PROMOTE_A_RETURN_PCT) < tol && fullA.run.trades.length === PROMOTE_A_TRADES
      && Math.abs(cReturnPct - PROMOTE_C_RETURN_PCT) < tol && fullC.run.trades.length === PROMOTE_C_TRADES
      && trigger === PROMOTE_TRIGGER;

    const window = context.protocol?.evaluationWindow ?? null;
    let holdoutAReturnPct: number | null = null, holdoutCReturnPct: number | null = null;
    let holdoutAMaxDrawdownPct: number | null = null, holdoutCMaxDrawdownPct: number | null = null;
    if (window !== null && !(window.startDate === dateRange.startDate && window.endDate === dateRange.endDate)) {
      const hA = await runCompositeRunnerBacktest({ ...common, dateRange: window, name: "runner-hold20-holdout-A" });
      const hC = await runCompositeRunnerBacktest({ ...common, dateRange: window, name: "runner-hold20-holdout-C", runnerBridge });
      holdoutAReturnPct = ret(hA.run); holdoutCReturnPct = ret(hC.run);
      holdoutAMaxDrawdownPct = maxDd(hA.run.equityCurve); holdoutCMaxDrawdownPct = maxDd(hC.run.equityCurve);
    }

    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const checks = [
      { code: "promote_parity_a", label: "A full-range parity", status: parityPass ? "PASS" as const : "FAIL" as const, value: aReturnPct, threshold: PROMOTE_A_RETURN_PCT },
      { code: "promote_parity_c", label: "C full-range parity", status: (Math.abs(cReturnPct - PROMOTE_C_RETURN_PCT) < tol && fullC.run.trades.length === PROMOTE_C_TRADES) ? "PASS" as const : "FAIL" as const, value: cReturnPct, threshold: PROMOTE_C_RETURN_PCT },
      { code: "runner_trigger", label: "Runner trigger", status: trigger === PROMOTE_TRIGGER ? "PASS" as const : "FAIL" as const, value: trigger, threshold: PROMOTE_TRIGGER },
    ];
    const holdoutOk = holdoutAReturnPct !== null && holdoutCReturnPct !== null && holdoutCReturnPct > holdoutAReturnPct
      && (holdoutCMaxDrawdownPct ?? 0) <= (holdoutAMaxDrawdownPct ?? 0) + 1e-9;
    let gate: ExperimentResultPayload["confirmatoryGate"];
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;
    if (phase !== "EXPLORATORY" && protocolFingerprint !== null) {
      if (phase === "OBSERVATION") {
        gate = { status: parityPass ? "OBSERVATION_READY" : "INSUFFICIENT", protocolFingerprint, sampleCount: fullC.run.trades.length, checks, summary: parityPass ? "OBSERVATION 段 parity 通过，可进入 HOLDOUT。" : "OBSERVATION 段 parity 未通过。" };
      } else {
        const pass = parityPass && holdoutOk;
        gate = { status: pass ? "PASS" : "FAIL", protocolFingerprint, sampleCount: fullC.run.trades.length, checks: [...checks, { code: "holdout_return", label: "Holdout C > A", status: holdoutOk ? "PASS" as const : "FAIL" as const, value: holdoutCReturnPct, threshold: holdoutAReturnPct }], summary: pass ? "HOLDOUT：parity 通过且 holdout C 优于 A。" : "HOLDOUT：parity 或 holdout 增量未通过。" };
      }
    }
    return {
      sampleSummary: { candidateCount: fullC.run.trades.length, eligibleCount: fullC.run.trades.length, excludedCount: 0, excludedByReason: {}, notes: [`selectedEvents=${surface.selectedEventCount}`, `executionRows=${surface.executionDataset.rows.length}`] },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        { key: "parity", title: "PROMOTE-001 parity", columns: [{ key: "metric", label: "指标" }, { key: "observed", label: "本次", digits: 4 }, { key: "expected", label: "期望", digits: 4 }], rows: [
          { metric: "A return %", observed: aReturnPct, expected: PROMOTE_A_RETURN_PCT },
          { metric: "A trades", observed: fullA.run.trades.length, expected: PROMOTE_A_TRADES },
          { metric: "C return %", observed: cReturnPct, expected: PROMOTE_C_RETURN_PCT },
          { metric: "C trades", observed: fullC.run.trades.length, expected: PROMOTE_C_TRADES },
          { metric: "runner trigger", observed: trigger, expected: PROMOTE_TRIGGER },
        ] },
        { key: "holdout", title: "Holdout window", columns: [{ key: "metric", label: "指标", }, { key: "A", label: "A", digits: 4 }, { key: "C", label: "C", digits: 4 }], rows: [
          { metric: "return %", A: holdoutAReturnPct, C: holdoutCReturnPct },
          { metric: "maxDD %", A: holdoutAMaxDrawdownPct, C: holdoutCMaxDrawdownPct },
          { metric: "full return %", A: aReturnPct, C: cReturnPct },
        ] },
      ],
      statistics: [
        { code: "full_a_return_pct", label: "A 总收益", value: aReturnPct, unit: "%", digits: 4 },
        { code: "full_c_return_pct", label: "C 总收益", value: cReturnPct, unit: "%", digits: 4 },
        { code: "runner_trigger", label: "Runner 触发笔数", value: trigger, digits: 0 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        parity: { aReturnPct, aTrades: fullA.run.trades.length, cReturnPct, cTrades: fullC.run.trades.length, trigger, tolerance: tol, pass: parityPass },
        metrics: {
          aReturnPct, cReturnPct, aMaxDrawdownPct: maxDd(fullA.run.equityCurve), cMaxDrawdownPct: maxDd(fullC.run.equityCurve),
          holdoutAReturnPct, holdoutCReturnPct, holdoutAMaxDrawdownPct, holdoutCMaxDrawdownPct,
        },
        note: "full-range parity 复现 PROMOTE-001；Holdout 段用 evaluationWindow 单独回放。",
      },
    };
  },
};

