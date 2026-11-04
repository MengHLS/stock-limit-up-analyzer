/**
 * COMPOSITE-RUNNER-T74-STOPWIDE-001 —— 把固定止损从 6% 扩大（其余全部冻结）。
 *
 * 用户关切：止损扩大后，单笔亏得更多、组合回撤更大，实盘能不能承受。
 * 本实验给出实测答案：选股 / 名额 / 退出链其它规则 / Runner / 数据坐标逐字段冻结，
 * 只把 exitPolicy.stop.anchor.stopRatio（SL-18.1 固定止损，现役 6%）改成 8% / 10% / 12%。
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
} from "../../compositeRunnerBridge";

export const COMPUTATION_VERSION = "1.0.0";
const EXTENSION_DATASET_VERSION_ID = 780001;
const BASELINE_DATASET_VERSION_ID = 660001;
const CONTROL_A_RETURN_PCT = 15.7876907121;
const CONTROL_A_TRADES = 1619;
const CONTROL_C_RETURN_PCT = 151.0958341843399;
const CONTROL_C_TRADES = 1434;
const CONTROL_TRIGGER = 161;
const PARITY_TOLERANCE_PCT = 1e-6;

export interface StopWideArmSpec {
  readonly id: string;
  readonly label: string;
  readonly stopRatio: number;
}

export const STOP_WIDE_ARMS: readonly StopWideArmSpec[] = [
  { id: "control", label: "控制臂 · 止损 6%（现役）", stopRatio: 0.06 },
  { id: "stop-08", label: "止损 8%", stopRatio: 0.08 },
  { id: "stop-10", label: "止损 10%", stopRatio: 0.1 },
  { id: "stop-12", label: "止损 12%", stopRatio: 0.12 },
];

export const compositeRunnerT74StopWideSchema = z.object({
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
      stopRatio: z.number(),
      fullCReturnPct: z.number(),
      fullCMaxDrawdownPct: z.number().nullable(),
      fullCTrades: z.number().int(),
      fullControlDeltaPct: z.number(),
      fullAReturnPct: z.number().nullable(),
      runnerTrigger: z.number().int().nullable(),
      bigWin50Count: z.number().int(),
      bigWin100Count: z.number().int(),
      losingTrades: z.number().int(),
      meanLossPct: z.number().nullable(),
      worstTradeReturnPct: z.number().nullable(),
      p05TradeReturnPct: z.number().nullable(),
      tradesWorseThan6Pct: z.number().int(),
      tradesWorseThan10Pct: z.number().int(),
      stopExitCount: z.number().int(),
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
  baseline: { run: { trades: readonly { securityId: string; entryTime: string; exitTime: string | null }[] } },
  extended: { run: { trades: readonly { securityId: string; entryTime: string; exitTime: string | null }[] } },
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

function ddNotWorse(
  arm: { fullCMaxDrawdownPct: number | null } | null,
  control: { fullCMaxDrawdownPct: number | null },
): boolean {
  if (arm === null) return false;
  return (arm.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
    <= (control.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) + 1e-9;
}

export const compositeRunnerT74StopWideExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-stopwide",
    name: "P3 · 扩大固定止损（T74，其余冻结）",
    version: COMPUTATION_VERSION,
    description:
      "只把 SL-18.1 的固定止损（现役 6% 盘中）扩大到 8% / 10% / 12%，"
      + "其余（选股 / 名额 / 移动止损 / MA 止盈 / 时间退出 / strongHold / Runner T74 / 数据坐标）逐字段冻结；"
      + "重点是给出「扩大止损 -> 组合最大回撤与逐笔亏损怎么变」的实测答案。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "composite-runner", "runner-t74", "stop-loss-width", "p3-stopwide"],
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
      forwardDataPurpose: "Runner 延长持仓到 hold=74 需要 T+17..T+80 的真实后续行情用于退出与估值。",
      eventScanPolicy: "PLATFORM_LIMIT",
    },
    executionSurface: "COMPOSITE_PORTFOLIO",
    compositeExecution: {
      baselineDatasetVersionId: BASELINE_DATASET_VERSION_ID,
      extensionSelectionArms: [{ id: "control", trendWeight: null }],
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-stopwide",
    pageTitle: "P3 · 扩大固定止损（T74，其余冻结）",
  },
  resultSchema: compositeRunnerT74StopWideSchema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;

    const built = buildFirstLimitPullback3FTop3SourceRun({ dataset: surface.baselineDataset, dateRange });
    const sourceRun = rebuildCompositeRun(built.sourceRun, surface.executionDataset);
    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
      state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const,
      extendToHoldingDays: 74,
    };

    interface ArmOutcome {
      id: string;
      label: string;
      stopRatio: number;
      fullAReturnPct: number | null;
      fullATrades: number | null;
      fullCReturnPct: number;
      fullCTrades: number;
      fullCMaxDrawdownPct: number | null;
      runnerTrigger: number | null;
      bigWin50Count: number;
      bigWin100Count: number;
      losingTrades: number;
      meanLossPct: number | null;
      worstTradeReturnPct: number | null;
      p05TradeReturnPct: number | null;
      tradesWorseThan6Pct: number;
      tradesWorseThan10Pct: number;
      stopExitCount: number;
    }

    const outcomes: ArmOutcome[] = [];
    for (const arm of STOP_WIDE_ARMS) {
      context.log("[stopwide] 臂 " + arm.id + "（stopRatio=" + String(arm.stopRatio) + "）开始");
      const baseInput = buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
        topN: COMPOSITE_RUNNER_TOP_N,
        datasetVersionId: EXTENSION_DATASET_VERSION_ID,
        datasetLabel: "v8",
      });
      const baseExitPolicy = baseInput.exitPolicy;
      if (baseExitPolicy === undefined || baseExitPolicy === null) {
        throw new Error("c6-b4-14 族未携带 exitPolicy（SL-18.1）：无法只改止损比例，拒绝静默降级。");
      }
      const baseAnchor = baseExitPolicy.stop.anchor;
      if (baseAnchor.kind !== "FIXED_PERCENT") {
        throw new Error(
          "SL-18.1 的止损锚不是 FIXED_PERCENT（实际 " + baseAnchor.kind + "）：本实验只改固定止损比例，拒绝改写其它锚类型。",
        );
      }
      const armStrategyDocument = buildThreeFactorTopNStrategyDocument({
        ...baseInput,
        exitPolicy: {
          ...baseExitPolicy,
          stop: {
            ...baseExitPolicy.stop,
            anchor: { kind: "FIXED_PERCENT", stopRatio: arm.stopRatio },
          },
        },
      });
      const common = {
        dataset: surface.executionDataset,
        sourceRun,
        strategyDocument: armStrategyDocument,
        datasetVersionId: EXTENSION_DATASET_VERSION_ID,
        codeVersion: COMPUTATION_VERSION,
        createdAt: THREE_FACTOR_TOPN_CREATED_AT,
      };
      const fullC = await runCompositeRunnerBacktest({
        ...common,
        dateRange,
        name: "t74-stopwide-" + arm.id + "-full-C",
        runnerBridge,
      });
      const fullA = arm.id === "control"
        ? await runCompositeRunnerBacktest({ ...common, dateRange, name: "t74-stopwide-control-full-A" })
        : null;
      const closed = fullC.run.trades.filter(
        (trade) => trade.returnPct !== null && Number.isFinite(trade.returnPct),
      );
      const losses = closed.filter((trade) => (trade.returnPct ?? 0) < 0);
      const sorted = [...closed].map((trade) => trade.returnPct ?? 0).sort((left, right) => left - right);
      outcomes.push({
        id: arm.id,
        label: arm.label,
        stopRatio: arm.stopRatio,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
        bigWin50Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 50).length,
        bigWin100Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 100).length,
        losingTrades: losses.length,
        meanLossPct: losses.length === 0
          ? null
          : losses.reduce((sum, trade) => sum + (trade.returnPct ?? 0), 0) / losses.length,
        worstTradeReturnPct: sorted.length === 0 ? null : sorted[0],
        p05TradeReturnPct: sorted.length === 0 ? null : sorted[Math.floor(sorted.length * 0.05)],
        tradesWorseThan6Pct: sorted.filter((value) => value < -6).length,
        tradesWorseThan10Pct: sorted.filter((value) => value < -10).length,
        stopExitCount: closed.filter((trade) => (trade.reason ?? "").includes("止损")).length,
      });
      context.log(
        "[stopwide] 臂 " + arm.id + " 完成：C 收益=" + returnPct(fullC.run).toFixed(4) + "%"
          + " MaxDD=" + (maxDrawdownPct(fullC.run.equityCurve) ?? Number.NaN).toFixed(4) + "%"
          + " 成交=" + String(fullC.run.trades.length),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      Math.abs(control.stopRatio - 0.06) < 1e-12
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

    const widerArms = outcomes.filter((outcome) => outcome.id !== "control");
    const bestReturn = widerArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best),
      null,
    );
    const lowestDd = widerArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null
        || (arm.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) < (best.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
        ? arm
        : best),
      null,
    );

    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      stopRatio: outcome.stopRatio,
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      bigWin50Count: outcome.bigWin50Count,
      bigWin100Count: outcome.bigWin100Count,
      meanLossPct: outcome.meanLossPct,
      worstTradeReturnPct: outcome.worstTradeReturnPct,
      tradesWorseThan6Pct: outcome.tradesWorseThan6Pct,
      tradesWorseThan10Pct: outcome.tradesWorseThan10Pct,
      deltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
    }));

    let gate: ExperimentResultPayload["confirmatoryGate"];
    if (phase !== "EXPLORATORY" && protocolFingerprint !== null) {
      const checks = [
        {
          code: "control_parity",
          label: "控制臂复现 T74 冻结值（止损 6%）",
          status: parityPass ? ("PASS" as const) : ("FAIL" as const),
          value: control.fullCReturnPct,
          threshold: CONTROL_C_RETURN_PCT,
        },
        {
          code: "drawdown_not_worse",
          label: "至少一条放宽止损的臂回撤不比控制臂更差",
          status: ddNotWorse(lowestDd, control) ? ("PASS" as const) : ("FAIL" as const),
          value: lowestDd?.fullCMaxDrawdownPct ?? null,
          threshold: control.fullCMaxDrawdownPct,
        },
      ];
      gate = phase === "OBSERVATION"
        ? {
            status: parityPass ? "OBSERVATION_READY" : "INSUFFICIENT",
            protocolFingerprint,
            sampleCount: control.fullCTrades,
            checks,
            summary: parityPass
              ? "控制臂逐项复现 T74 冻结值，可进入 HOLDOUT。"
              : "控制臂未能复现 T74 冻结值：放宽止损臂的 Δ 不可信。",
          }
        : {
            status: parityPass && ddNotWorse(lowestDd, control)
              && (bestReturn?.fullCReturnPct ?? Number.NEGATIVE_INFINITY) >= control.fullCReturnPct
              ? "PASS"
              : "FAIL",
            protocolFingerprint,
            sampleCount: control.fullCTrades,
            checks,
            summary: "HOLDOUT：要求控制臂 parity、至少一条臂回撤不劣化、且最好收益不低于控制臂。",
          };
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
          "onlyStopRatioVaries=true",
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "stopwide-arms",
          title: "只改固定止损：收益 / 回撤 / 逐笔亏损 / 超级票",
          description:
            "其余全部冻结（选股、名额 2/5、移动止损 8%、MA 止盈、5 日时间退出、strongHold 5->10、Runner T74）。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "stopRatio", label: "固定止损" },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "bigWin50Count", label: ">= +50% 笔数", digits: 0 },
            { key: "bigWin100Count", label: ">= +100% 笔数", digits: 0 },
            { key: "meanLossPct", label: "亏损笔均值 %", digits: 3 },
            { key: "worstTradeReturnPct", label: "最差单笔 %", digits: 3 },
            { key: "tradesWorseThan6Pct", label: "亏超 6% 笔数", digits: 0 },
            { key: "tradesWorseThan10Pct", label: "亏超 10% 笔数", digits: 0 },
            { key: "fullCTrades", label: "C 成交笔数", digits: 0 },
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
        { code: "control_max_dd_pct", label: "控制臂最大回撤", value: control.fullCMaxDrawdownPct, unit: "%", digits: 4 },
        { code: "lowest_dd_pct", label: "放宽止损臂中最低回撤", value: lowestDd?.fullCMaxDrawdownPct ?? null, unit: "%", digits: 4 },
        { code: "best_return_pct", label: "放宽止损臂中最高收益", value: bestReturn?.fullCReturnPct ?? null, unit: "%", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
          stopRatio: outcome.stopRatio,
          fullCReturnPct: outcome.fullCReturnPct,
          fullCTrades: outcome.fullCTrades,
          fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
          fullAReturnPct: outcome.fullAReturnPct,
          runnerTrigger: outcome.runnerTrigger,
          bigWin50Count: outcome.bigWin50Count,
          bigWin100Count: outcome.bigWin100Count,
          losingTrades: outcome.losingTrades,
          meanLossPct: outcome.meanLossPct,
          worstTradeReturnPct: outcome.worstTradeReturnPct,
          p05TradeReturnPct: outcome.p05TradeReturnPct,
          tradesWorseThan6Pct: outcome.tradesWorseThan6Pct,
          tradesWorseThan10Pct: outcome.tradesWorseThan10Pct,
          stopExitCount: outcome.stopExitCount,
        })),
        note:
          "只改 exitPolicy.stop.anchor.stopRatio（SL-18.1 固定止损，现役 6%）；其余退出规则、选股、名额、"
          + "Runner、数据坐标逐字段冻结。逐笔亏损统计基于已实现交易（returnPct，含成本）。",
      },
    };
  },
};