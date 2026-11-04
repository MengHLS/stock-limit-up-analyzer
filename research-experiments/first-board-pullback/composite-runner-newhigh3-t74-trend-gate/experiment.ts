/**
 * COMPOSITE-RUNNER-TREND-GATE-T74-001 —— P0-2：趋势分门槛（只筛不改排序）。
 *
 * ## 为什么有这一版
 *
 * P0（`composite-runner-newhigh3-t74-trend`）已用真实数据证明：把趋势评分按权重混进排序值
 * 会单调恶化收益（w=0.2/0.3/0.5 => -59% / -86% / -95%，控制臂 151%）。诊断显示两件事：
 *   1) trendScore 只有 7 个离散取值（66% 的候选挤在 0 与 1/6）=> 融合后 TopN 边界大量由
 *      securityId 破平决定；
 *   2) 融合把选中标的的平均 3F 从 0.6647 压到 0.51-0.64，即系统性挤掉了 3F 选出来的标的。
 *
 * 因此这一版换用法而不是换权重：排序值完全不动（纯 3F），趋势分只用来剔除差候选
 * （trendScore < minTrendScore 直接不入池）。若趋势分含任何正向信息，它应当表现为
 * 「剔除最差的一档 => 剩下来的 3F 头部更干净」。
 *
 * ## 四条臂
 *
 * | 臂 | 门槛 | 被剔除的候选（全样本 43,550 个候选里的占比，来自 P0 诊断） |
 * |---|---|---|
 * | control | 无 | - |
 * | gate-ge1of6 | trendScore >= 1/6 | 剔除 trendScore = 0（34.39%） |
 * | gate-ge1of3 | trendScore >= 1/3 | 再剔除 1/6（31.16%）=> 累计 65.55% |
 * | gate-ge2of3 | trendScore >= 2/3 | 累计剔除约 75.6%（保留 5/6 与 1 两档） |
 *
 * ## 冻结项（与 P0 / T74 完全一致）
 *
 * TopN=3、maxPositions=5、EQUITY_RATIO 分层仓位、SL-18.1 统一退出链、candidateExitPolicy=DISABLED、
 * Runner NEW_HIGH_3 / decisionHoldingDays=5 / extendToHoldingDays=74、数据集坐标（780001 / 660001）。
 *
 * ## 成本与账目
 *
 * 控制臂跑 A（无 Runner）+ C（挂 Runner）以对齐 T74 留档；门槛臂只跑 C。
 * 每个门槛臂的 evaluatedCandidateCount / excludedByTrendGate 与「候选不足 TopN 的交易日数」
 * 都如实输出 —— 门槛会减少成交机会，这本身是它要付出的代价，不能藏。
 */
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  buildFirstLimitPullback3FTop3SourceRun,
  rebuildCompositeRun,
  runCompositeRunnerBacktest,
  buildThreeFactorTopNStrategyDocument,
  buildThreeFactorTopNFamilyArmInput,
  THREE_FACTOR_TOPN_CREATED_AT,
  COMPOSITE_RUNNER_TOP_N,
  type CompositeExecutionSurfacePayload,
  type CompositeRunnerBacktestResult,
} from "../../compositeRunnerBridge";

export const COMPUTATION_VERSION = "1.0.0";

const EXTENSION_DATASET_VERSION_ID = 780001;
const BASELINE_DATASET_VERSION_ID = 660001;

/** 控制臂 parity 冻结值（= composite-runner-newhigh3-t74 留档）。 */
const CONTROL_A_RETURN_PCT = 15.7876907121;
const CONTROL_A_TRADES = 1619;
const CONTROL_C_RETURN_PCT = 151.0958341843399;
const CONTROL_C_TRADES = 1434;
const CONTROL_TRIGGER = 161;
const PARITY_TOLERANCE_PCT = 1e-6;

/** trendScore 的取值恒为 k/6 => 门槛与档位同分母，可精确比较。 */
const ONE_SIXTH = 1 / 6;
const ONE_THIRD = 1 / 3;
const TWO_THIRDS = 2 / 3;

export interface TrendGateArmSpec {
  readonly id: string;
  readonly label: string;
  /** null = 无门槛（控制臂）。 */
  readonly minTrendScore: number | null;
}

export const TREND_GATE_ARMS: readonly TrendGateArmSpec[] = [
  { id: "control", label: "控制臂 · 纯 3F（T74）", minTrendScore: null },
  { id: "gate-ge1of6", label: "门槛 trendScore >= 1/6", minTrendScore: ONE_SIXTH },
  { id: "gate-ge1of3", label: "门槛 trendScore >= 1/3", minTrendScore: ONE_THIRD },
  { id: "gate-ge2of3", label: "门槛 trendScore >= 2/3", minTrendScore: TWO_THIRDS },
];

export const compositeRunnerTrendGateT74Schema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  controlParity: z.object({
    aReturnPct: z.number(),
    aTrades: z.number().int(),
    cReturnPct: z.number(),
    cTrades: z.number().int(),
    trigger: z.number().int(),
    pass: z.boolean(),
  }),
  arms: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      minTrendScore: z.number().nullable(),
      evaluatedCandidates: z.number().int().nullable(),
      excludedByTrendGate: z.number().int().nullable(),
      daysWithFewerThanTopN: z.number().int(),
      daysWithCandidates: z.number().int(),
      fullCReturnPct: z.number(),
      fullCTrades: z.number().int(),
      fullCMaxDrawdownPct: z.number().nullable(),
      fullControlDeltaPct: z.number(),
      fullAReturnPct: z.number().nullable(),
      runnerTrigger: z.number().int().nullable(),
    }),
  ),
  note: z.string(),
});

function maxDrawdownPct(curve: readonly { equity: number }[]): number | null {
  if (curve.length === 0) return null;
  let peak = curve[0]!.equity;
  let worst = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) worst = Math.min(worst, point.equity / peak - 1);
  }
  return Math.abs(worst) * 100;
}

function returnPct(run: { finalEquity: number; initialCapital: number }): number {
  return (run.finalEquity / run.initialCapital - 1) * 100;
}

function runnerTriggerCount(
  baseline: CompositeRunnerBacktestResult,
  extended: CompositeRunnerBacktestResult,
): number {
  const baselineByKey = new Map(
    baseline.run.trades.map((trade) => [trade.securityId + "|" + trade.entryTime, trade]),
  );
  let trigger = 0;
  for (const trade of extended.run.trades) {
    const base = baselineByKey.get(trade.securityId + "|" + trade.entryTime);
    if (base !== undefined && base.exitTime !== trade.exitTime) trigger += 1;
  }
  return trigger;
}

export const compositeRunnerNewHigh3T74TrendGateExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-trend-gate",
    name: "P0-2 · 趋势分门槛（只筛不改排序，T74）",
    version: COMPUTATION_VERSION,
    description:
      "排序值保持纯 3F 合成分不变，只用 trendScore 剔除差候选（门槛 1/6、1/3、2/3），"
      + "验证「趋势分含正向信息 => 剔除最差一档后 3F 头部更干净」这一假设；"
      + "TopN / maxPositions / 仓位 / SL-18.1 退出链 / Runner T74 / 数据集坐标全部冻结。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "composite-runner",
      "runner-t74",
      "trend-gate",
      "p0-2-filter-only",
    ],
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredDatasetVersionLabel: "v8",
      requiredColumns: {
        events: ["limitUpPrice"],
        observation: ["open", "high", "low", "close", "volume"],
      },
      prefixRelativeDays: [],
      postRelativeDays: [1],
      decisionOffsetDays: 5,
      usesForwardData: true,
      forwardDataPurpose:
        "Runner 延长持仓到 hold=74 需要 T+17..T+80 的真实后续行情用于退出与估值。",
      eventScanPolicy: "PLATFORM_LIMIT",
    },
    executionSurface: "COMPOSITE_PORTFOLIO",
    compositeExecution: {
      baselineDatasetVersionId: BASELINE_DATASET_VERSION_ID,
      extensionSelectionArms: TREND_GATE_ARMS.map((arm) => ({
        id: arm.id,
        trendWeight: null,
        minTrendScore: arm.minTrendScore,
      })),
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-trend-gate",
    pageTitle: "P0-2 · 趋势分门槛（只筛不改排序，T74）",
  },
  resultSchema: compositeRunnerTrendGateT74Schema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;

    const strategyDocument = buildThreeFactorTopNStrategyDocument(
      buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
        topN: COMPOSITE_RUNNER_TOP_N,
        datasetVersionId: EXTENSION_DATASET_VERSION_ID,
        datasetLabel: "v8",
      }),
    );
    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
      state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const,
      extendToHoldingDays: 74,
    };

    interface ArmOutcome {
      id: string;
      label: string;
      minTrendScore: number | null;
      evaluatedCandidates: number | null;
      excludedByTrendGate: number | null;
      daysWithCandidates: number;
      daysWithFewerThanTopN: number;
      fullAReturnPct: number | null;
      fullATrades: number | null;
      fullCReturnPct: number;
      fullCTrades: number;
      fullCMaxDrawdownPct: number | null;
      runnerTrigger: number | null;
    }

    const outcomes: ArmOutcome[] = [];
    for (const arm of TREND_GATE_ARMS) {
      context.log(`[trend-gate] 臂 ${arm.id}（minTrendScore=${String(arm.minTrendScore)}）开始`);
      const built = buildFirstLimitPullback3FTop3SourceRun({
        dataset: surface.baselineDataset,
        dateRange,
        candidateGate: arm.minTrendScore === null ? null : { minTrendScore: arm.minTrendScore },
      });
      const sourceRun = rebuildCompositeRun(built.sourceRun, surface.executionDataset);
      const common = {
        dataset: surface.executionDataset,
        sourceRun,
        strategyDocument,
        datasetVersionId: EXTENSION_DATASET_VERSION_ID,
        codeVersion: COMPUTATION_VERSION,
        createdAt: THREE_FACTOR_TOPN_CREATED_AT,
      };
      const fullC = await runCompositeRunnerBacktest({
        ...common,
        dateRange,
        name: `trend-gate-${arm.id}-full-C`,
        runnerBridge,
      });
      const fullA = arm.minTrendScore === null
        ? await runCompositeRunnerBacktest({
            ...common,
            dateRange,
            name: `trend-gate-${arm.id}-full-A`,
          })
        : null;
      const daysWithCandidates = built.sourceRun.days.filter((day) => day.signalCount > 0).length;
      const daysWithFewerThanTopN = built.sourceRun.days.filter(
        (day) => day.signalCount > 0 && day.signalCount < COMPOSITE_RUNNER_TOP_N,
      ).length;
      const accounting = built.gateAccounting ?? null;
      outcomes.push({
        id: arm.id,
        label: arm.label,
        minTrendScore: arm.minTrendScore,
        evaluatedCandidates: accounting === null ? null : accounting.evaluatedCandidateCount,
        excludedByTrendGate: accounting === null ? null : accounting.excludedByTrendGate,
        daysWithCandidates,
        daysWithFewerThanTopN,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
      });
      context.log(
        `[trend-gate] 臂 ${arm.id} 完成：C 收益=${returnPct(fullC.run).toFixed(4)}%`
        + ` 成交=${String(fullC.run.trades.length)}`
        + (accounting === null
          ? ""
          : ` 剔除候选=${String(accounting.excludedByTrendGate)}/${String(accounting.evaluatedCandidateCount)}`),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      control.minTrendScore === null
      && control.fullAReturnPct !== null
      && Math.abs(control.fullAReturnPct - CONTROL_A_RETURN_PCT) < PARITY_TOLERANCE_PCT
      && Math.abs(control.fullCReturnPct - CONTROL_C_RETURN_PCT) < PARITY_TOLERANCE_PCT
      && control.fullCTrades === CONTROL_C_TRADES
      && control.runnerTrigger === CONTROL_TRIGGER;

    const controlParity = {
      aReturnPct: control.fullAReturnPct ?? Number.NaN,
      aTrades: control.fullATrades ?? -1,
      cReturnPct: control.fullCReturnPct,
      cTrades: control.fullCTrades,
      trigger: control.runnerTrigger ?? -1,
      pass: parityPass,
    };

    const gateArms = outcomes.filter((outcome) => outcome.minTrendScore !== null);
    const winner = gateArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best),
      null,
    );
    const winnerBeatsControl = winner !== null && winner.fullCReturnPct > control.fullCReturnPct;
    const winnerDrawdownOk = winner === null
      ? false
      : (winner.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
        <= (control.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) + 1e-9;

    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      minTrendScore: outcome.minTrendScore === null ? "无（控制）" : outcome.minTrendScore.toFixed(4),
      excluded: outcome.excludedByTrendGate,
      daysWithFewerThanTopN: outcome.daysWithFewerThanTopN,
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      deltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
    }));

    let gate: ExperimentResultPayload["confirmatoryGate"];
    if (phase !== "EXPLORATORY" && protocolFingerprint !== null) {
      const checks = [
        {
          code: "control_parity",
          label: "控制臂复现 T74 冻结值",
          status: parityPass ? ("PASS" as const) : ("FAIL" as const),
          value: control.fullCReturnPct,
          threshold: CONTROL_C_RETURN_PCT,
        },
        {
          code: "gate_full_range_delta",
          label: "最优门槛臂全周期 C 收益 > 控制臂",
          status: winnerBeatsControl ? ("PASS" as const) : ("FAIL" as const),
          value: winner?.fullCReturnPct ?? null,
          threshold: control.fullCReturnPct,
        },
      ];
      if (phase === "OBSERVATION") {
        gate = {
          status: parityPass ? "OBSERVATION_READY" : "INSUFFICIENT",
          protocolFingerprint,
          sampleCount: control.fullCTrades,
          checks,
          summary: parityPass
            ? "控制臂逐项复现 T74 冻结值，可进入 HOLDOUT。"
            : "控制臂未能复现 T74 冻结值：门槛臂的 Δ 不可信，先修数据/代码坐标。",
        };
      } else {
        const pass = parityPass && winnerBeatsControl && winnerDrawdownOk;
        gate = {
          status: pass ? "PASS" : "FAIL",
          protocolFingerprint,
          sampleCount: control.fullCTrades,
          checks: [...checks, {
            code: "gate_drawdown",
            label: "最优门槛臂最大回撤不劣于控制臂",
            status: winnerDrawdownOk ? ("PASS" as const) : ("FAIL" as const),
            value: winner?.fullCMaxDrawdownPct ?? null,
            threshold: control.fullCMaxDrawdownPct,
          }],
          summary: pass
            ? `HOLDOUT：控制臂 parity 通过，门槛臂 ${winner?.id ?? "-"} 在全周期收益与回撤上都优于控制臂。`
            : "HOLDOUT：parity、收益增量或回撤未同时通过。",
        };
      }
    }

    return {
      sampleSummary: {
        candidateCount: outcomes.reduce((sum, outcome) => sum + outcome.fullCTrades, 0),
        eligibleCount: outcomes.reduce((sum, outcome) => sum + outcome.fullCTrades, 0),
        excludedCount: 0,
        excludedByReason: {},
        notes: [
          `arms=${String(outcomes.length)}`,
          `selectedEvents(union)=${String(surface.selectedEventCount)}`,
          `executionRows=${String(surface.executionDataset.rows.length)}`,
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "gate-arms",
          title: "全周期（A/C 同窗口）：趋势分门槛四条臂",
          description: "排序值恒为纯 3F 合成分；门槛只剔除候选。C = 挂 NEW_HIGH_3 Runner（hold=74）。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "minTrendScore", label: "门槛" },
            { key: "excluded", label: "剔除候选数", digits: 0 },
            { key: "daysWithFewerThanTopN", label: "候选 < TopN 的交易日", digits: 0 },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "fullCTrades", label: "C 成交笔数", digits: 0 },
            { key: "deltaPct", label: "Δ vs 控制臂 (pp)", digits: 4 },
          ],
          rows,
        },
        {
          key: "control-parity",
          title: "控制臂 parity（对齐 composite-runner-newhigh3-t74 留档）",
          columns: [
            { key: "metric", label: "指标" },
            { key: "observed", label: "本次", digits: 4 },
            { key: "expected", label: "期望", digits: 4 },
          ],
          rows: [
            { metric: "A 收益 %（无 Runner）", observed: controlParity.aReturnPct, expected: CONTROL_A_RETURN_PCT },
            { metric: "A 成交笔数", observed: controlParity.aTrades, expected: CONTROL_A_TRADES },
            { metric: "C 收益 %（Runner T74）", observed: controlParity.cReturnPct, expected: CONTROL_C_RETURN_PCT },
            { metric: "C 成交笔数", observed: controlParity.cTrades, expected: CONTROL_C_TRADES },
            { metric: "Runner 触发笔数", observed: controlParity.trigger, expected: CONTROL_TRIGGER },
          ],
        },
      ],
      statistics: [
        { code: "control_full_c_return_pct", label: "控制臂 C 全周期收益", value: control.fullCReturnPct, unit: "%", digits: 4 },
        { code: "winner_full_c_return_pct", label: "最优门槛臂 C 全周期收益", value: winner?.fullCReturnPct ?? null, unit: "%", digits: 4 },
        { code: "winner_full_c_delta_pct", label: "最优门槛臂 Δ vs 控制臂", value: winner === null ? null : winner.fullCReturnPct - control.fullCReturnPct, unit: "pp", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
          minTrendScore: outcome.minTrendScore,
          evaluatedCandidates: outcome.evaluatedCandidates,
          excludedByTrendGate: outcome.excludedByTrendGate,
          daysWithCandidates: outcome.daysWithCandidates,
          daysWithFewerThanTopN: outcome.daysWithFewerThanTopN,
          fullCReturnPct: outcome.fullCReturnPct,
          fullCTrades: outcome.fullCTrades,
          fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
          fullAReturnPct: outcome.fullAReturnPct,
          runnerTrigger: outcome.runnerTrigger,
        })),
        note:
          "P0-2 与 P0 的唯一区别：排序值恒为纯 3F，趋势分只作候选门槛（trendScore < 门槛 => 剔除）。"
          + "TopN、maxPositions、分层仓位、SL-18.1 退出链、Runner 政策与数据集坐标全部冻结。"
          + "trendScore 不可算的候选按不通过处理（不插补），剔除数如实计入 excludedByTrendGate。",
      },
    };
  },
};