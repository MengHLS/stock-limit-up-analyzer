/**
 * P8 · T74 延迟入场 + 晚窗口滚动 3F 重评分。
 *
 * 臂：
 *   - control：原 T+5 选股，T+6 开盘买入；
 *   - delay-t7/t8/t10：原 top3 不变，只把决策日延后到 T+k；
 *   - rescore-t7/t8/t10：原 top5 作为候选门槛，在 T+k 用最近 5 日滚动 3F
 *     重排后取前 3；不重开全市场。
 *
 * 冻结：Runner NEW_HIGH_3/5/74、SL-18.1、仓位、成本、数据坐标。
 */
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  applyCompositeLateEntry,
  buildCompositeEvents,
  buildFirstLimitPullback3FTop3SourceRun,
  buildThreeFactorTopNFamilyArmInput,
  buildThreeFactorTopNStrategyDocument,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
  computeLateEntryScore,
  rebuildCompositeRun,
  runCompositeRunnerBacktest,
  THREE_FACTOR_TOPN_CREATED_AT,
  type CompositeExecutionSurfacePayload,
  type ResearchDatasetRow,
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
const OUTPUT_TOP_N = 3;

export interface LateEntryArmSpec {
  readonly id: string;
  readonly label: string;
  readonly mode: "delay" | "rescore" | null;
  readonly decisionRelativeDay: number | null;
  readonly sourceTopN: number;
}

export const LATE_ENTRY_ARMS: readonly LateEntryArmSpec[] = [
  { id: "control", label: "控制臂 · T+5 选股 / T+6 买入", mode: null, decisionRelativeDay: null, sourceTopN: 3 },
  { id: "delay-t7", label: "延迟入场 · T+7", mode: "delay", decisionRelativeDay: 7, sourceTopN: 3 },
  { id: "delay-t8", label: "延迟入场 · T+8", mode: "delay", decisionRelativeDay: 8, sourceTopN: 3 },
  { id: "delay-t10", label: "延迟入场 · T+10", mode: "delay", decisionRelativeDay: 10, sourceTopN: 3 },
  { id: "rescore-t7", label: "晚窗口滚动 3F · T+7", mode: "rescore", decisionRelativeDay: 7, sourceTopN: 5 },
  { id: "rescore-t8", label: "晚窗口滚动 3F · T+8", mode: "rescore", decisionRelativeDay: 8, sourceTopN: 5 },
  { id: "rescore-t10", label: "晚窗口滚动 3F · T+10", mode: "rescore", decisionRelativeDay: 10, sourceTopN: 5 },
];

const outcomeSchema = z.object({
  id: z.string(),
  label: z.string(),
  mode: z.enum(["delay", "rescore"]).nullable(),
  decisionRelativeDay: z.number().int().nullable(),
  sourceTopN: z.number().int(),
  fullCReturnPct: z.number(),
  fullCMaxDrawdownPct: z.number().nullable(),
  fullCTrades: z.number().int(),
  fullControlDeltaPct: z.number(),
  fullAReturnPct: z.number().nullable(),
  runnerTrigger: z.number().int().nullable(),
  bigWin50Count: z.number().int(),
  bigWin100Count: z.number().int(),
  lateSourceCandidates: z.number().int(),
  lateShiftedCandidates: z.number().int(),
  lateDroppedUnavailable: z.number().int(),
  lateDroppedUnscorable: z.number().int(),
  lateSelectedCandidates: z.number().int(),
});

export const compositeRunnerT74LateEntrySchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  controlParity: z.object({
    aReturnPct: z.number(),
    aTrades: z.number().int(),
    cReturnPct: z.number(),
    cTrades: z.number().int(),
    trigger: z.number().int(),
    pass: z.boolean(),
  }),
  arms: z.array(outcomeSchema),
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

function toBar(row: ResearchDatasetRow) {
  return {
    symbol: row.code ?? row.securityId,
    timestamp: row.tradeDate,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    preClose: row.preClose,
    volume: row.volume,
    amount: row.amount,
    turnoverRate: row.turnoverRate,
    adjustment: "raw" as const,
  };
}

function validClose(row: ResearchDatasetRow | undefined): boolean {
  return row !== undefined
    && row.eligible !== false
    && typeof row.close === "number"
    && Number.isFinite(row.close)
    && row.close > 0;
}

function validOpen(row: ResearchDatasetRow | undefined): boolean {
  return row !== undefined
    && row.eligible !== false
    && typeof row.open === "number"
    && Number.isFinite(row.open)
    && row.open > 0;
}

function buildLateCallbacks(dataset: CompositeExecutionSurfacePayload["baselineDataset"]) {
  const built = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
  const eventBySecurityId = new Map(built.events.map((event) => [event.securityId, event]));

  const relativeDayOf = (securityId: string, decisionDate: string): number | null => {
    const event = eventBySecurityId.get(securityId);
    if (event === undefined) return null;
    for (const [relativeDay, row] of event.barsByRelativeDay) {
      if (row.tradeDate === decisionDate) return relativeDay;
    }
    return null;
  };

  const targetDateOf = (securityId: string, decisionRelativeDay: number): string | null => {
    const event = eventBySecurityId.get(securityId);
    if (event === undefined) return null;
    return event.barsByRelativeDay.get(decisionRelativeDay)?.tradeDate ?? null;
  };

  const targetAvailableOf = (securityId: string, decisionDate: string): boolean => {
    const event = eventBySecurityId.get(securityId);
    if (event === undefined) return false;
    const relativeDay = relativeDayOf(securityId, decisionDate);
    if (relativeDay === null) return false;
    return validClose(event.barsByRelativeDay.get(relativeDay))
      && validOpen(event.barsByRelativeDay.get(relativeDay + 1));
  };

  const scoreOf = (securityId: string, decisionDate: string) => {
    const event = eventBySecurityId.get(securityId);
    if (event === undefined) return null;
    const relativeDay = relativeDayOf(securityId, decisionDate);
    if (relativeDay === null || relativeDay < 5) return null;
    const bars = [];
    for (let day = relativeDay - 5; day <= relativeDay; day += 1) {
      const row = event.barsByRelativeDay.get(day);
      if (row === undefined) return null;
      bars.push(toBar(row));
    }
    return computeLateEntryScore(bars);
  };

  return { targetDateOf, targetAvailableOf, scoreOf };
}

interface ArmOutcome {
  id: string;
  label: string;
  mode: "delay" | "rescore" | null;
  decisionRelativeDay: number | null;
  sourceTopN: number;
  fullAReturnPct: number | null;
  fullATrades: number | null;
  fullCReturnPct: number;
  fullCTrades: number;
  fullCMaxDrawdownPct: number | null;
  runnerTrigger: number | null;
  bigWin50Count: number;
  bigWin100Count: number;
  lateSourceCandidates: number;
  lateShiftedCandidates: number;
  lateDroppedUnavailable: number;
  lateDroppedUnscorable: number;
  lateSelectedCandidates: number;
}

export const compositeRunnerT74LateEntryExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-late-entry",
    name: "P8 · 延迟入场 + 晚窗口滚动 3F（T74，其余冻结）",
    version: COMPUTATION_VERSION,
    description:
      "T+5 原候选门槛不变：delay 臂只延后决策日，rescore 臂只在原 top5 内用最近 5 日滚动 3F 重排。"
      + "不重开全市场，不改退出链、Runner T74、仓位与数据坐标。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "composite-runner", "runner-t74", "late-entry", "p8"],
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
      extensionSelectionArms: [
        { id: "control", trendWeight: null, topN: 3 },
        { id: "late", trendWeight: null, topN: 5 },
      ],
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-late-entry",
    pageTitle: "P8 · 延迟入场 + 晚窗口滚动 3F（T74，其余冻结）",
  },
  resultSchema: compositeRunnerT74LateEntrySchema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;
    const late = buildLateCallbacks(surface.baselineDataset);

    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
      state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const,
      extendToHoldingDays: 74,
    };

    const outcomes: ArmOutcome[] = [];
    for (const arm of LATE_ENTRY_ARMS) {
      context.log(
        "[late] 臂 " + arm.id + "（mode=" + String(arm.mode)
          + " day=" + String(arm.decisionRelativeDay)
          + " sourceTopN=" + String(arm.sourceTopN) + "）开始",
      );

      const base = buildFirstLimitPullback3FTop3SourceRun({
        dataset: surface.baselineDataset,
        dateRange,
        topN: arm.sourceTopN,
      });
      const transformed = arm.mode === null
        ? base
        : applyCompositeLateEntry(base, {
            mode: arm.mode,
            decisionRelativeDay: arm.decisionRelativeDay!,
            sourceTopN: arm.sourceTopN,
            outputTopN: OUTPUT_TOP_N,
            ...(arm.mode === "rescore" ? { scoreOf: late.scoreOf } : {}),
            ...(arm.mode === "delay" ? { targetAvailableOf: late.targetAvailableOf } : {}),
          }, late.targetDateOf);
      const sourceRun = rebuildCompositeRun(transformed.sourceRun, surface.executionDataset);
      const strategyDocument = buildThreeFactorTopNStrategyDocument({
        ...buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
          topN: OUTPUT_TOP_N,
          datasetVersionId: EXTENSION_DATASET_VERSION_ID,
          datasetLabel: "v8",
        }),
        maxPositions: 5,
        maxDailyBuys: 2,
      });
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
        name: "t74-late-" + arm.id + "-full-C",
        runnerBridge,
      });
      const fullA = arm.mode === null
        ? await runCompositeRunnerBacktest({ ...common, dateRange, name: "t74-late-control-full-A" })
        : null;
      const closed = fullC.run.trades.filter(
        (trade) => trade.returnPct !== null && Number.isFinite(trade.returnPct),
      );
      const accounting = transformed.lateEntryAccounting ?? {
        sourceCandidates: 0,
        shiftedCandidates: 0,
        droppedMissingTargetDate: 0,
        droppedUnavailableTarget: 0,
        droppedUnscorable: 0,
        selectedCandidates: 0,
      };
      outcomes.push({
        id: arm.id,
        label: arm.label,
        mode: arm.mode,
        decisionRelativeDay: arm.decisionRelativeDay,
        sourceTopN: arm.sourceTopN,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
        bigWin50Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 50).length,
        bigWin100Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 100).length,
        lateSourceCandidates: accounting.sourceCandidates,
        lateShiftedCandidates: accounting.shiftedCandidates,
        lateDroppedUnavailable: accounting.droppedUnavailableTarget,
        lateDroppedUnscorable: accounting.droppedUnscorable,
        lateSelectedCandidates: accounting.selectedCandidates,
      });
      const latest = outcomes[outcomes.length - 1]!;
      context.log(
        "[late] 臂 " + arm.id + " 完成：C 收益=" + returnPct(fullC.run).toFixed(4) + "%"
          + " MaxDD=" + (maxDrawdownPct(fullC.run.equityCurve) ?? Number.NaN).toFixed(4) + "%"
          + " 成交=" + String(fullC.run.trades.length)
          + " >=+50%=" + String(latest.bigWin50Count),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      control.mode === null
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

    const lateArms = outcomes.filter((outcome) => outcome.id !== "control");
    const bestByBigWin = lateArms.reduce<ArmOutcome | null>(
      (best, arm) => best === null || arm.bigWin50Count > best.bigWin50Count ? arm : best,
      null,
    );
    const bestByReturn = lateArms.reduce<ArmOutcome | null>(
      (best, arm) => best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best,
      null,
    );
    const bestByDd = lateArms.reduce<ArmOutcome | null>(
      (best, arm) => best === null
        || (arm.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) < (best.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
        ? arm
        : best,
      null,
    );

    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      mode: outcome.mode,
      decisionRelativeDay: outcome.decisionRelativeDay,
      sourceTopN: outcome.sourceTopN,
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      bigWin50Count: outcome.bigWin50Count,
      bigWin100Count: outcome.bigWin100Count,
      lateSelectedCandidates: outcome.lateSelectedCandidates,
      lateDroppedUnavailable: outcome.lateDroppedUnavailable,
      lateDroppedUnscorable: outcome.lateDroppedUnscorable,
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
          code: "more_big_winners",
          label: "至少一条 late 臂的 >= +50% 笔数多于控制臂",
          status: (bestByBigWin?.bigWin50Count ?? 0) > control.bigWin50Count ? ("PASS" as const) : ("FAIL" as const),
          value: bestByBigWin?.bigWin50Count ?? null,
          threshold: control.bigWin50Count,
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
              : "控制臂未能复现 T74 冻结值：late 臂的 Δ 不可信。",
          }
        : {
            status: parityPass
              && (bestByBigWin?.bigWin50Count ?? 0) > control.bigWin50Count
              && (bestByReturn?.fullCReturnPct ?? Number.NEGATIVE_INFINITY) >= control.fullCReturnPct
              ? "PASS"
              : "FAIL",
            protocolFingerprint,
            sampleCount: control.fullCTrades,
            checks,
            summary: "HOLDOUT：要求 parity 通过、late 臂抓到更多 >= +50% 交易，且最好收益不低于控制臂。",
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
          "lateEntryScore=late-entry-3f-rolling-5-v1.0.0",
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "late-entry-arms",
          title: "延迟入场 / 晚窗口滚动 3F：收益 / 回撤 / 晚入场成本",
          description:
            "delay 臂保持原 top3 排名，只移动决策日；rescore 臂在原 top5 门槛内用最近 5 日滚动 3F 重排。"
            + "所有信号仍在当前决策日收盘产生，次日开盘执行。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "mode", label: "模式" },
            { key: "decisionRelativeDay", label: "决策相对日", digits: 0 },
            { key: "sourceTopN", label: "原候选门槛", digits: 0 },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "bigWin50Count", label: ">= +50% 笔数", digits: 0 },
            { key: "bigWin100Count", label: ">= +100% 笔数", digits: 0 },
            { key: "lateSelectedCandidates", label: "late 入选", digits: 0 },
            { key: "lateDroppedUnavailable", label: "目标日不可交易", digits: 0 },
            { key: "lateDroppedUnscorable", label: "晚窗口不可评分", digits: 0 },
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
        { code: "control_big_win50", label: "控制臂 >= +50% 笔数", value: control.bigWin50Count, digits: 0 },
        { code: "best_big_win50", label: "late 臂最多 >= +50% 笔数", value: bestByBigWin?.bigWin50Count ?? null, digits: 0 },
        { code: "best_return_pct", label: "late 臂最高收益", value: bestByReturn?.fullCReturnPct ?? null, unit: "%", digits: 4 },
        { code: "best_dd_pct", label: "late 臂最低回撤", value: bestByDd?.fullCMaxDrawdownPct ?? null, unit: "%", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
          mode: outcome.mode,
          decisionRelativeDay: outcome.decisionRelativeDay,
          sourceTopN: outcome.sourceTopN,
          fullCReturnPct: outcome.fullCReturnPct,
          fullCTrades: outcome.fullCTrades,
          fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
          fullAReturnPct: outcome.fullAReturnPct,
          runnerTrigger: outcome.runnerTrigger,
          bigWin50Count: outcome.bigWin50Count,
          bigWin100Count: outcome.bigWin100Count,
          lateSourceCandidates: outcome.lateSourceCandidates,
          lateShiftedCandidates: outcome.lateShiftedCandidates,
          lateDroppedUnavailable: outcome.lateDroppedUnavailable,
          lateDroppedUnscorable: outcome.lateDroppedUnscorable,
          lateSelectedCandidates: outcome.lateSelectedCandidates,
        })),
        note:
          "P8 只在原 T+5 top3/top5 门槛内做延迟入场或最近 5 日滚动 3F 重排；不重开全市场。",
      },
    };
  },
};
