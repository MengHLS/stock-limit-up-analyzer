/**
 * COMPOSITE-RUNNER-TREND-V2-T74-001 —— **P1：趋势评分 v2（符号修正版）的分位融合**。
 *
 * ## 为什么有这一版
 *
 * v1 被两次实测否掉（P0 排序融合 −59/−86/−95%；P0-2 门槛 −21/−74/−75%，控制臂 151%）。
 * 随后的信号质量验证（`docs/evidence/_analysis_trend_score_v1_forward_ic_20261004.json`）证明
 * **不是无用而是符号用反**（入场 rd6 开盘 / 出场 rdN 收盘 / 毛收益 / Spearman IC + bootstrap CI）：
 *
 * | 分项 | rd10 IC | rd16 IC | 控制 3F 的偏 IC | 正确方向 |
 * |---|---|---|---|---|
 * | 回撤深度（peak-close）/peak | +0.0252 | +0.0230 | +0.0324 / +0.0329 | **越大越好** |
 * | 动量 close5/close0 - 1 | -0.0338 | -0.0409 | -0.0327 / -0.0394 | 越小越好 |
 * | 连续结构偏离 close5/mean - 1 | -0.0342 | -0.0337 | -0.0352 / -0.0351 | 越小越好 |
 *
 * v2 就是把这三项**按其验证方向**组合：`v2 = 等权( 分位(回撤深度), 分位(-动量), 分位(-结构偏离) )`，
 * 再与 3F 合成分按 `fused = (1-w)·3F + w·v2` 融合。
 *
 * ## 为什么用「分位」而不是原始值
 *
 * 三项量纲不同（回撤 ∈ [0,1]，动量/偏离 ∈ (-1,∞)），直接加权会被极值支配；
 * 因此逐分量在**当日候选内**做横截面分位（唯一 ranker `framework/ranking#rankSignals`）后等权平均。
 *
 * ## 四条臂与冻结项
 *
 * | 臂 | 排序值 |
 * |---|---|
 * | control | 纯 3F（与 T74 逐字相同，parity 参照） |
 * | v2-w20 | `0.8·3F + 0.2·v2` |
 * | v2-w35 | `0.65·3F + 0.35·v2` |
 * | v2-w50 | `0.5·3F + 0.5·v2` |
 *
 * TopN=3、maxPositions=5、EQUITY_RATIO 分层仓位、SL-18.1 退出链、candidateExitPolicy=DISABLED、
 * Runner NEW_HIGH_3 / 5 / 74、数据集坐标（780001 / 660001）全部冻结。
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

export interface TrendV2ArmSpec {
  readonly id: string;
  readonly label: string;
  /** null = 不融合（控制臂）。 */
  readonly v2Weight: number | null;
}

export const TREND_V2_ARMS: readonly TrendV2ArmSpec[] = [
  { id: "control", label: "控制臂 · 纯 3F（T74）", v2Weight: null },
  { id: "v2-w20", label: "融合 v2 20%", v2Weight: 0.2 },
  { id: "v2-w35", label: "融合 v2 35%", v2Weight: 0.35 },
  { id: "v2-w50", label: "融合 v2 50%", v2Weight: 0.5 },
];

export const compositeRunnerTrendV2T74Schema = z.object({
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
      v2Weight: z.number().nullable(),
      /** v2 臂实际参与打分的候选数（控制臂 = null）。 */
      scoredCandidates: z.number().int().nullable(),
      /** v2 三分量不可算而被排除的候选数（控制臂 = null）。 */
      droppedMissingComponents: z.number().int().nullable(),
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

export const compositeRunnerNewHigh3T74TrendV2Experiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-trend-v2",
    name: "P1 · 趋势评分 v2（符号修正 + 分位融合，T74）",
    version: COMPUTATION_VERSION,
    description:
      "用符号修正后的趋势评分 v2（回撤深度为正、动量与结构偏离为负，逐分量横截面分位后等权）"
      + "与 3F 合成分按 (1-w)·3F + w·v2 融合，w ∈ {0.2, 0.35, 0.5}；"
      + "TopN / maxPositions / 仓位 / SL-18.1 退出链 / Runner T74 / 数据集坐标全部冻结。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "composite-runner",
      "runner-t74",
      "trend-v2",
      "p1-sign-corrected",
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
      extensionSelectionArms: TREND_V2_ARMS.map((arm) => ({
        id: arm.id,
        trendWeight: null,
        v2Weight: arm.v2Weight,
      })),
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-trend-v2",
    pageTitle: "P1 · 趋势评分 v2（符号修正 + 分位融合，T74）",
  },
  resultSchema: compositeRunnerTrendV2T74Schema,
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
      v2Weight: number | null;
      scoredCandidates: number | null;
      droppedMissingComponents: number | null;
      fullAReturnPct: number | null;
      fullATrades: number | null;
      fullCReturnPct: number;
      fullCTrades: number;
      fullCMaxDrawdownPct: number | null;
      runnerTrigger: number | null;
    }

    const outcomes: ArmOutcome[] = [];
    for (const arm of TREND_V2_ARMS) {
      context.log("[trend-v2] 臂 " + arm.id + "（v2Weight=" + String(arm.v2Weight) + "）开始");
      const built = buildFirstLimitPullback3FTop3SourceRun({
        dataset: surface.baselineDataset,
        dateRange,
        candidateScoreV2: arm.v2Weight === null ? null : { v2Weight: arm.v2Weight },
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
        name: "trend-v2-" + arm.id + "-full-C",
        runnerBridge,
      });
      const fullA = arm.v2Weight === null
        ? await runCompositeRunnerBacktest({
            ...common,
            dateRange,
            name: "trend-v2-" + arm.id + "-full-A",
          })
        : null;
      const accounting = built.v2FusionAccounting ?? null;
      outcomes.push({
        id: arm.id,
        label: arm.label,
        v2Weight: arm.v2Weight,
        scoredCandidates: accounting === null ? null : accounting.scoredCandidateCount,
        droppedMissingComponents: accounting === null ? null : accounting.droppedMissingComponents,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
      });
      context.log(
        "[trend-v2] 臂 " + arm.id + " 完成：C 收益=" + returnPct(fullC.run).toFixed(4) + "%"
          + " 成交=" + String(fullC.run.trades.length),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      control.v2Weight === null
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

    const v2Arms = outcomes.filter((outcome) => outcome.v2Weight !== null);
    const winner = v2Arms.reduce<ArmOutcome | null>(
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
      v2Weight: outcome.v2Weight === null ? "0（控制）" : String(outcome.v2Weight),
      scored: outcome.scoredCandidates,
      dropped: outcome.droppedMissingComponents,
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
          code: "v2_full_range_delta",
          label: "最优 v2 臂全周期 C 收益 > 控制臂",
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
            : "控制臂未能复现 T74 冻结值：v2 臂的 Δ 不可信，先修数据/代码坐标。",
        };
      } else {
        const pass = parityPass && winnerBeatsControl && winnerDrawdownOk;
        gate = {
          status: pass ? "PASS" : "FAIL",
          protocolFingerprint,
          sampleCount: control.fullCTrades,
          checks: [...checks, {
            code: "v2_drawdown",
            label: "最优 v2 臂最大回撤不劣于控制臂",
            status: winnerDrawdownOk ? ("PASS" as const) : ("FAIL" as const),
            value: winner?.fullCMaxDrawdownPct ?? null,
            threshold: control.fullCMaxDrawdownPct,
          }],
          summary: pass
            ? ("HOLDOUT：控制臂 parity 通过，v2 臂 " + (winner?.id ?? "-") + " 在全周期收益与回撤上都优于控制臂。")
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
          "arms=" + String(outcomes.length),
          "selectedEvents(union)=" + String(surface.selectedEventCount),
          "executionRows=" + String(surface.executionDataset.rows.length),
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "v2-arms",
          title: "全周期（A/C 同窗口）：趋势评分 v2 融合四条臂",
          description: "v2 = 等权( 分位(回撤深度), 分位(-动量), 分位(-结构偏离) )；fused = (1-w)·3F + w·v2。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "v2Weight", label: "v2 权重" },
            { key: "scored", label: "参与打分候选", digits: 0 },
            { key: "dropped", label: "分量缺失被排除", digits: 0 },
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
        { code: "winner_full_c_return_pct", label: "最优 v2 臂 C 全周期收益", value: winner?.fullCReturnPct ?? null, unit: "%", digits: 4 },
        { code: "winner_full_c_delta_pct", label: "最优 v2 臂 Δ vs 控制臂", value: winner === null ? null : winner.fullCReturnPct - control.fullCReturnPct, unit: "pp", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
          v2Weight: outcome.v2Weight,
          scoredCandidates: outcome.scoredCandidates,
          droppedMissingComponents: outcome.droppedMissingComponents,
          fullCReturnPct: outcome.fullCReturnPct,
          fullCTrades: outcome.fullCTrades,
          fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
          fullAReturnPct: outcome.fullAReturnPct,
          runnerTrigger: outcome.runnerTrigger,
        })),
        note:
          "P1：趋势评分 v2 = 等权(分位(回撤深度), 分位(-动量), 分位(-结构偏离))，分位在当日候选内计算；"
          + "fused = (1-w)·3F + w·v2。TopN、maxPositions、分层仓位、SL-18.1 退出链、Runner 政策与数据集坐标全部冻结。"
          + "v2 三分量不可算的候选被排除（不插补），剔除数如实计入 droppedMissingComponents。",
      },
    };
  },
};
