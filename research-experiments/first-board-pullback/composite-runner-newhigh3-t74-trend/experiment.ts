/**
 * COMPOSITE-RUNNER-TREND-FUSION-T74-001 —— **P0：3F 选股排序 × 趋势评分融合**。
 *
 * ## 这个实验回答什么
 *
 * 当前最高收益策略是 `first-limit-pullback-3f-top3-runner-t74@2.0.0`
 * （控制臂 = 纯 3F 排序 + `NEW_HIGH_3` / decisionHoldingDays=5 / extendToHoldingDays=74）。
 * P0 **只动一个东西**：把候选的**排序值**从「纯 3F 合成分」换成
 * `(1-w)·3F + w·trendScore`。TopN / maxPositions / 分层仓位 / SL-18.1 退出链 /
 * Runner 政策 / 数据集坐标**全部冻结**。
 *
 * ## 唯一职责（编排，不含任何研究/回测实现）
 *
 *   context.composite → buildFirstLimitPullback3FTop3SourceRun(rankFusion) →
 *   rebuildCompositeRun → runCompositeRunnerBacktest（A/C）→ 臂间对比 → confirmatoryGate
 *
 * 不读 DB、不实现 simulator：全部经 `@experiments/compositeRunnerBridge` 复用唯一实现。
 *
 * ## 四条臂
 *
 * | 臂 | 排序值 | 作用 |
 * |---|---|---|
 * | `control` | 纯 3F（`rankFusion = null`） | 逐项复现 T74 冻结值（parity） |
 * | `trend-w20` | `0.8·3F + 0.2·trendScore` | 轻融合 |
 * | `trend-w30` | `0.7·3F + 0.3·trendScore` | 中融合 |
 * | `trend-w50` | `0.5·3F + 0.5·trendScore` | 等权融合 |
 *
 * ## 为什么控制臂必须是 `rankFusion = null` 而不是 `w = 0`
 *
 * `w = 0` 在数学上等于纯 3F，但**仍要求 `trendScore` 可算**（不可算的候选会被排除）
 * ⇒ 候选池可能悄悄变小，就不是「逐字段复现」了。控制臂走既有路径，融合臂走新路径。
 *
 * ## 成本控制（如实说明）
 *
 * 控制臂跑 A（无 Runner）+ C（挂 Runner），融合臂**只跑 C** —— P0 的问题是
 * 「融合能不能提高**最高收益那支**（= 挂 Runner 的那支）」，A 只是控制臂的 parity 参照。
 * 因此每次 Run 的模拟次数 = 4（C）× 1 + 1（控制 A）× 1，后置窗口再各 1 次。
 *
 * ## 扩展行（rd17..80）由 agent 之外的平台 provider 装配
 *
 * 实验 descriptor 的 `compositeExecution.extensionSelectionArms` 声明了全部四条臂；
 * 平台 provider 按**并集**装载扩展行，保证融合臂选中的事件也拿得到 T+17..T+80，
 * 否则融合臂会在 rd16 被数据边界截断、与 Runner 语义不可比。
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

/** 扩展数据集坐标（v8 物理重建；与 composite-runner-newhigh3-t74 同一坐标）。 */
const EXTENSION_DATASET_VERSION_ID = 780001;
/** 基线投影坐标（v5 平台装配；与 PROMOTE-001 / HORIZON-001 同一工件）。 */
const BASELINE_DATASET_VERSION_ID = 660001;

/** 控制臂 parity 冻结值（= `composite-runner-newhigh3-t74` 的留档）。 */
const CONTROL_A_RETURN_PCT = 15.7876907121;
const CONTROL_A_TRADES = 1619;
const CONTROL_C_RETURN_PCT = 151.0958341843399;
const CONTROL_C_TRADES = 1434;
const CONTROL_TRIGGER = 161;
const PARITY_TOLERANCE_PCT = 1e-6;

export interface TrendFusionArmSpec {
  readonly id: string;
  readonly label: string;
  /** null = 不融合（控制臂，走既有纯 3F 路径）。 */
  readonly trendWeight: number | null;
}

/** 四条臂（顺序 = 页面展示顺序）。 */
export const TREND_FUSION_ARMS: readonly TrendFusionArmSpec[] = [
  { id: "control", label: "控制臂 · 纯 3F（T74）", trendWeight: null },
  { id: "trend-w20", label: "融合 20% 趋势", trendWeight: 0.2 },
  { id: "trend-w30", label: "融合 30% 趋势", trendWeight: 0.3 },
  { id: "trend-w50", label: "融合 50% 趋势", trendWeight: 0.5 },
];

export const compositeRunnerTrendFusionT74Schema = z.object({
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
      trendWeight: z.number().nullable(),
      /** 融合臂实际参与打分的候选数（控制臂 = null）。 */
      fusionScoredCandidates: z.number().int().nullable(),
      /** 融合臂因 trendScore 不可算而被排除的候选数（控制臂 = null）。 */
      fusionDroppedCandidates: z.number().int().nullable(),
      fullCReturnPct: z.number(),
      fullCTrades: z.number().int(),
      fullCMaxDrawdownPct: z.number().nullable(),
      fullControlDeltaPct: z.number(),
      fullAReturnPct: z.number().nullable(),
      holdoutCReturnPct: z.number().nullable(),
      holdoutCMaxDrawdownPct: z.number().nullable(),
      holdoutControlDeltaPct: z.number().nullable(),
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

/** Runner 触发笔数 = C 相对 A 改变了退出时点的成交笔数。 */
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

export const compositeRunnerNewHigh3T74TrendExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-trend",
    name: "P0 · 3F 选股排序 × 趋势评分融合（T74）",
    version: COMPUTATION_VERSION,
    description:
      "在「完整组合回测（资金循环 / maxPositions=5 / 原止损 / MA5-MA10 / strongHold）+ "
      + "runnerBridge{NEW_HIGH_3, decisionHoldingDays=5, extendToHoldingDays=74}」语义下，"
      + "只把候选排序值换成 (1-w)·3F + w·trendScore，比较 w = 0（控制）/ 0.2 / 0.3 / 0.5 四条臂；"
      + "TopN、仓位、退出政策、Runner、数据集坐标全部冻结。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "composite-runner",
      "runner-t74",
      "trend-fusion",
      "p0-ranking-only",
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
      // 四条臂按并集装载 rd17..80：融合臂选中的事件同样需要 T+17..T+80。
      extensionSelectionArms: TREND_FUSION_ARMS.map((arm) => ({
        id: arm.id,
        trendWeight: arm.trendWeight,
      })),
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-trend",
    pageTitle: "P0 · 3F 排序 × 趋势评分融合（T74）",
  },
  resultSchema: compositeRunnerTrendFusionT74Schema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;
    const evaluationWindow = context.protocol?.evaluationWindow ?? null;
    const hasSeparateHoldout =
      evaluationWindow !== null
      && !(evaluationWindow.startDate === dateRange.startDate
        && evaluationWindow.endDate === dateRange.endDate);

    // 策略文档（退出政策 / 仓位 / 成本 / TopN）在四条臂之间**完全相同**。
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
      trendWeight: number | null;
      fusionScoredCandidates: number | null;
      fusionDroppedCandidates: number | null;
      fullAReturnPct: number | null;
      fullATrades: number | null;
      fullCReturnPct: number;
      fullCTrades: number;
      fullCMaxDrawdownPct: number | null;
      holdoutCReturnPct: number | null;
      holdoutCMaxDrawdownPct: number | null;
      runnerTrigger: number | null;
    }

    const outcomes: ArmOutcome[] = [];
    for (const arm of TREND_FUSION_ARMS) {
      context.log(`[trend-p0] 臂 ${arm.id}（trendWeight=${String(arm.trendWeight)}）开始`);
      const built = buildFirstLimitPullback3FTop3SourceRun({
        dataset: surface.baselineDataset,
        dateRange,
        rankFusion: arm.trendWeight === null ? null : { trendWeight: arm.trendWeight },
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
        name: `trend-fusion-${arm.id}-full-C`,
        runnerBridge,
      });
      // A（无 Runner）只对控制臂跑：它承担 parity 参照，并给出 Runner 触发笔数。
      const fullA = arm.trendWeight === null
        ? await runCompositeRunnerBacktest({
            ...common,
            dateRange,
            name: `trend-fusion-${arm.id}-full-A`,
          })
        : null;
      let holdoutCReturnPct: number | null = null;
      let holdoutCMaxDrawdownPct: number | null = null;
      if (hasSeparateHoldout && evaluationWindow !== null) {
        const holdoutC = await runCompositeRunnerBacktest({
          ...common,
          dateRange: evaluationWindow,
          name: `trend-fusion-${arm.id}-holdout-C`,
          runnerBridge,
        });
        holdoutCReturnPct = returnPct(holdoutC.run);
        holdoutCMaxDrawdownPct = maxDrawdownPct(holdoutC.run.equityCurve);
      }
      const accounting = built.fusionAccounting ?? null;
      outcomes.push({
        id: arm.id,
        label: arm.label,
        trendWeight: arm.trendWeight,
        fusionScoredCandidates: accounting === null ? null : accounting.scoredCandidateCount,
        fusionDroppedCandidates: accounting === null ? null : accounting.droppedMissingTrendScore,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        holdoutCReturnPct,
        holdoutCMaxDrawdownPct,
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
      });
      context.log(
        `[trend-p0] 臂 ${arm.id} 完成：C 收益=${returnPct(fullC.run).toFixed(4)}%`
        + ` 成交=${String(fullC.run.trades.length)}`
        + (holdoutCReturnPct === null
          ? ""
          : ` 后置窗口 C 收益=${holdoutCReturnPct.toFixed(4)}%`),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      control.trendWeight === null
      && control.fullAReturnPct !== null
      && Math.abs(control.fullAReturnPct - CONTROL_A_RETURN_PCT) < PARITY_TOLERANCE_PCT
      && control.fullATrades === CONTROL_A_TRADES
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

    const fusionArms = outcomes.filter((outcome) => outcome.trendWeight !== null);
    const winner = fusionArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best),
      null,
    );
    const holdoutBeatsControl =
      winner !== null
      && winner.holdoutCReturnPct !== null
      && control.holdoutCReturnPct !== null
      && winner.holdoutCReturnPct > control.holdoutCReturnPct
      && (winner.holdoutCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
        <= (control.holdoutCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) + 1e-9;
    const fullRangeBeatsControl = winner !== null && winner.fullCReturnPct > control.fullCReturnPct;

    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      trendWeight: outcome.trendWeight === null ? "0（控制）" : String(outcome.trendWeight),
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      deltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
    }));
    const holdoutRows = outcomes.map((outcome) => ({
      arm: outcome.label,
      fullCReturnPct: outcome.fullCReturnPct,
      holdoutCReturnPct: outcome.holdoutCReturnPct,
      holdoutCMaxDrawdownPct: outcome.holdoutCMaxDrawdownPct,
      deltaPct:
        outcome.holdoutCReturnPct === null || control.holdoutCReturnPct === null
          ? null
          : outcome.holdoutCReturnPct - control.holdoutCReturnPct,
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
          code: "full_range_delta",
          label: "最优融合臂全周期 C 收益 > 控制臂",
          status: fullRangeBeatsControl ? ("PASS" as const) : ("FAIL" as const),
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
            : "控制臂未能复现 T74 冻结值：融合臂的 Δ 不可信，先修数据/代码坐标。",
        };
      } else {
        const pass = parityPass && fullRangeBeatsControl && holdoutBeatsControl;
        gate = {
          status: pass ? "PASS" : "FAIL",
          protocolFingerprint,
          sampleCount: control.fullCTrades,
          checks: [
            ...checks,
            {
              code: "holdout_delta",
              label: "最优融合臂后置窗口 C 收益 > 控制臂（且回撤不劣化）",
              status: holdoutBeatsControl ? ("PASS" as const) : ("FAIL" as const),
              value: winner?.holdoutCReturnPct ?? null,
              threshold: control.holdoutCReturnPct,
            },
          ],
          summary: pass
            ? `HOLDOUT：控制臂 parity 通过，融合臂 ${winner?.id ?? "-"} 在全周期与后置窗口都优于控制臂。`
            : "HOLDOUT：parity、全周期增量或后置窗口增量未同时通过。",
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
          key: "full-range-arms",
          title: "全周期（A/C 同窗口）：排序融合四条臂",
          description: "C = 挂 NEW_HIGH_3 Runner（hold=74）；Δ = 相对控制臂（纯 3F）。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "trendWeight", label: "趋势权重" },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "fullCTrades", label: "C 成交笔数", digits: 0 },
            { key: "deltaPct", label: "Δ vs 控制臂 (pp)", digits: 4 },
          ],
          rows,
        },
        {
          key: "holdout-arms",
          title: "后置窗口（evaluationWindow）",
          description: hasSeparateHoldout
            ? "后置窗口只跑了 C（挂 Runner）臂；Δ = 相对控制臂。"
            : "本次 Run 没有独立后置窗口（EXPLORATORY 或窗口等于全周期）。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "fullCReturnPct", label: "全周期 C 收益 %", digits: 4 },
            { key: "holdoutCReturnPct", label: "后置窗口 C 收益 %", digits: 4 },
            { key: "holdoutCMaxDrawdownPct", label: "后置窗口最大回撤 %", digits: 4 },
            { key: "deltaPct", label: "Δ vs 控制臂 (pp)", digits: 4 },
          ],
          rows: holdoutRows,
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
        { code: "winner_full_c_return_pct", label: "最优融合臂 C 全周期收益", value: winner?.fullCReturnPct ?? null, unit: "%", digits: 4 },
        { code: "winner_full_c_delta_pct", label: "最优融合臂 Δ vs 控制臂", value: winner === null ? null : winner.fullCReturnPct - control.fullCReturnPct, unit: "pp", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
          trendWeight: outcome.trendWeight,
          fusionScoredCandidates: outcome.fusionScoredCandidates,
          fusionDroppedCandidates: outcome.fusionDroppedCandidates,
          fullCReturnPct: outcome.fullCReturnPct,
          fullCTrades: outcome.fullCTrades,
          fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
          fullAReturnPct: outcome.fullAReturnPct,
          holdoutCReturnPct: outcome.holdoutCReturnPct,
          holdoutCMaxDrawdownPct: outcome.holdoutCMaxDrawdownPct,
          holdoutControlDeltaPct:
            outcome.holdoutCReturnPct === null || control.holdoutCReturnPct === null
              ? null
              : outcome.holdoutCReturnPct - control.holdoutCReturnPct,
          runnerTrigger: outcome.runnerTrigger,
        })),
        note:
          "P0 只改候选排序（3F 与 trendScore 的加权融合）；TopN、maxPositions、分层仓位、"
          + "SL-18.1 退出链、Runner 政策与数据集坐标全部冻结。融合臂因 trendScore 不可算而排除的"
          + "候选数如实记在 fusionDroppedCandidates（不插补）。",
      },
    };
  },
};