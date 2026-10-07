/**
 * P7 · T74 跨日候选池 + 当日重评分（carry 1 日，其余冻结）。
 *
 * 目标：验证“原始 3F 跨日延续失败”是否因为 carry 没有新信息；
 * 本轮在每一个决策日，对 fresh + pending 统一计算 CarryRefreshV1：
 *   - 回撤深度越大越好、动量越弱越好、越贴近事件窗均线越好；
 *   - 三个分量在当日 union 内做横截面分位，再与原始 3F 融合；
 *   - refresh-only 臂用来分离“重评分本身”的影响；
 *   - carry1 臂用来比较“有 carry + 重评分”相对 refresh-only 的增量。
 *
 * PIT：refresh 只读事件日 rd0 → 当前决策日；frozen T74 退出/执行参数不变。
 */
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  applyCompositeCarryover,
  buildCompositeEvents,
  buildFirstLimitPullback3FTop3SourceRun,
  buildThreeFactorTopNFamilyArmInput,
  buildThreeFactorTopNStrategyDocument,
  computeCarryRefreshComponents,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
  rebuildCompositeRun,
  runCompositeRunnerBacktest,
  THREE_FACTOR_TOPN_CREATED_AT,
  type BuiltCompositeArm,
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
const CARRY_SELECTION_TOP_N = 5;

export interface RefreshArmSpec {
  readonly id: string;
  readonly label: string;
  readonly selectionTopN: number;
  readonly maxDailyBuys: number;
  readonly maxPositions: number;
  readonly carryMaxAgeDays: number;
  readonly replacementScoreMargin: number;
  readonly refreshWeight: number | null;
}

export const REFRESH_ARMS: readonly RefreshArmSpec[] = [
  {
    id: "control",
    label: "控制臂 · top3 / 2 笔 / 5 仓",
    selectionTopN: 3,
    maxDailyBuys: 2,
    maxPositions: 5,
    carryMaxAgeDays: 0,
    replacementScoreMargin: 0,
    refreshWeight: null,
  },
  {
    id: "refresh-only-w20",
    label: "top5 + refresh-only · w0.20",
    selectionTopN: CARRY_SELECTION_TOP_N,
    maxDailyBuys: 2,
    maxPositions: 5,
    carryMaxAgeDays: 0,
    replacementScoreMargin: 0,
    refreshWeight: 0.2,
  },
  {
    id: "refresh-only-w35",
    label: "top5 + refresh-only · w0.35",
    selectionTopN: CARRY_SELECTION_TOP_N,
    maxDailyBuys: 2,
    maxPositions: 5,
    carryMaxAgeDays: 0,
    replacementScoreMargin: 0,
    refreshWeight: 0.35,
  },
  {
    id: "carry1-refresh-w20",
    label: "top5 + carry1 + refresh · w0.20",
    selectionTopN: CARRY_SELECTION_TOP_N,
    maxDailyBuys: 2,
    maxPositions: 5,
    carryMaxAgeDays: 1,
    replacementScoreMargin: 0,
    refreshWeight: 0.2,
  },
  {
    id: "carry1-refresh-w35",
    label: "top5 + carry1 + refresh · w0.35",
    selectionTopN: CARRY_SELECTION_TOP_N,
    maxDailyBuys: 2,
    maxPositions: 5,
    carryMaxAgeDays: 1,
    replacementScoreMargin: 0,
    refreshWeight: 0.35,
  },
];

const outcomeSchema = z.object({
  id: z.string(),
  label: z.string(),
  selectionTopN: z.number().int(),
  maxDailyBuys: z.number().int(),
  maxPositions: z.number().int(),
  carryMaxAgeDays: z.number().int(),
  replacementScoreMargin: z.number(),
  refreshWeight: z.number().nullable(),
  fullCReturnPct: z.number(),
  fullCMaxDrawdownPct: z.number().nullable(),
  fullCTrades: z.number().int(),
  fullControlDeltaPct: z.number(),
  fullAReturnPct: z.number().nullable(),
  runnerTrigger: z.number().int().nullable(),
  bigWin50Count: z.number().int(),
  bigWin100Count: z.number().int(),
  carryQueuedCandidates: z.number().int(),
  carryConsideredCandidates: z.number().int(),
  carrySelectedCandidates: z.number().int(),
  carryAttemptedCandidates: z.number().int(),
  carryExpiredCandidates: z.number().int(),
  refreshUnscorableCarryCandidates: z.number().int(),
  carryTrades: z.number().int(),
  carryNetPnl: z.number(),
  carryBigWin50Count: z.number().int(),
});

export const compositeRunnerT74CarryoverRefreshSchema = z.object({
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

function executionToDecisionDate(
  dataset: CompositeExecutionSurfacePayload["baselineDataset"],
): Map<string, string> {
  const tradingDays = dataset.universeDefinition.days
    .filter((day) => day.isTradingDay)
    .map((day) => day.tradeDate)
    .sort();
  const result = new Map<string, string>();
  for (let index = 1; index < tradingDays.length; index += 1) {
    result.set(tradingDays[index]!, tradingDays[index - 1]!);
  }
  return result;
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

function buildRefreshComponentsOf(
  dataset: CompositeExecutionSurfacePayload["baselineDataset"],
) {
  const built = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
  const eventBySecurityId = new Map(built.events.map((event) => [event.securityId, event]));
  return (securityId: string, decisionDate: string) => {
    const event = eventBySecurityId.get(securityId);
    if (event === undefined) return null;
    let relativeDay: number | null = null;
    for (const [candidateRelativeDay, row] of event.barsByRelativeDay) {
      if (row.tradeDate === decisionDate) {
        relativeDay = candidateRelativeDay;
        break;
      }
    }
    if (relativeDay === null || relativeDay < 5) return null;
    const bars = [];
    for (let day = 0; day <= relativeDay; day += 1) {
      const row = event.barsByRelativeDay.get(day);
      if (row === undefined) return null;
      bars.push(toBar(row));
    }
    return computeCarryRefreshComponents(bars);
  };
}

function carryDecisionDatesBySecurity(
  base: BuiltCompositeArm,
  carried: BuiltCompositeArm,
): Map<string, Set<string>> {
  const freshIdsByDate = new Map(
    base.sourceRun.days.map((day) => [
      day.date,
      new Set(day.positionIntents.map((intent) => intent.securityId)),
    ]),
  );
  const result = new Map<string, Set<string>>();
  for (const day of carried.sourceRun.days) {
    const freshIds = freshIdsByDate.get(day.date) ?? new Set<string>();
    for (const intent of day.positionIntents) {
      if (freshIds.has(intent.securityId)) continue;
      const dates = result.get(intent.securityId) ?? new Set<string>();
      dates.add(day.date);
      result.set(intent.securityId, dates);
    }
  }
  return result;
}

function carryTradeStats(
  trades: readonly {
    readonly securityId: string;
    readonly entryTime: string | null;
    readonly returnPct: number | null;
    readonly netPnl: number | null;
  }[],
  carryDecisionDates: ReadonlyMap<string, ReadonlySet<string>>,
  executionToDecision: ReadonlyMap<string, string>,
): { trades: number; netPnl: number; bigWin50: number } {
  let count = 0;
  let netPnl = 0;
  let bigWin50 = 0;
  for (const trade of trades) {
    if (
      trade.entryTime === null
      || trade.returnPct === null
      || !Number.isFinite(trade.returnPct)
    ) {
      continue;
    }
    const decisionDate = executionToDecision.get(trade.entryTime);
    if (decisionDate === undefined) continue;
    if (carryDecisionDates.get(trade.securityId)?.has(decisionDate) !== true) continue;
    count += 1;
    netPnl += trade.netPnl ?? 0;
    if (trade.returnPct >= 50) bigWin50 += 1;
  }
  return { trades: count, netPnl, bigWin50 };
}

interface ArmOutcome {
  id: string;
  label: string;
  selectionTopN: number;
  maxDailyBuys: number;
  maxPositions: number;
  carryMaxAgeDays: number;
  replacementScoreMargin: number;
  refreshWeight: number | null;
  fullAReturnPct: number | null;
  fullATrades: number | null;
  fullCReturnPct: number;
  fullCTrades: number;
  fullCMaxDrawdownPct: number | null;
  runnerTrigger: number | null;
  bigWin50Count: number;
  bigWin100Count: number;
  carryQueuedCandidates: number;
  carryConsideredCandidates: number;
  carrySelectedCandidates: number;
  carryAttemptedCandidates: number;
  carryExpiredCandidates: number;
  refreshUnscorableCarryCandidates: number;
  carryTrades: number;
  carryNetPnl: number;
  carryBigWin50Count: number;
}

export const compositeRunnerT74CarryoverRefreshExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-carryover-refresh",
    name: "P7 · 跨日候选池 + 当日重评分（T74，carry 1 日）",
    version: COMPUTATION_VERSION,
    description:
      "在每一个决策日对 fresh + 前一日 pending 统一计算 CarryRefreshV1（回撤深度 / 取负动量 / 取负窗内偏离），"
      + "逐分量在当日候选内做横截面分位后与原始 3F 融合；refresh-only 臂分离重评分本身，"
      + "carry1 臂检验重评分能否让跨日候选获得独立增量。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "composite-runner", "runner-t74", "carryover", "refresh", "p7"],
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
        { id: "carry", trendWeight: null, topN: CARRY_SELECTION_TOP_N },
      ],
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-carryover-refresh",
    pageTitle: "P7 · 跨日候选池 + 当日重评分（T74，carry 1 日）",
  },
  resultSchema: compositeRunnerT74CarryoverRefreshSchema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;
    const executionToDecision = executionToDecisionDate(surface.baselineDataset);
    const refreshComponentsOf = buildRefreshComponentsOf(surface.baselineDataset);

    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
      state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const,
      extendToHoldingDays: 74,
    };

    const outcomes: ArmOutcome[] = [];
    for (const arm of REFRESH_ARMS) {
      context.log(
        "[refresh] 臂 " + arm.id + "（topN=" + String(arm.selectionTopN)
          + " buys=" + String(arm.maxDailyBuys)
          + " positions=" + String(arm.maxPositions)
          + " carryDays=" + String(arm.carryMaxAgeDays)
          + " refreshWeight=" + String(arm.refreshWeight) + "）开始",
      );

      const base = buildFirstLimitPullback3FTop3SourceRun({
        dataset: surface.baselineDataset,
        dateRange,
        topN: arm.selectionTopN,
      });
      const carried = arm.refreshWeight === null
        ? base
        : applyCompositeCarryover(base, {
            maxAgeDays: arm.carryMaxAgeDays,
            replacementScoreMargin: arm.replacementScoreMargin,
            attemptedPerDay: arm.maxDailyBuys,
            refresh: {
              version: "carry-refresh-v1.0.0",
              weight: arm.refreshWeight,
              componentsOf: refreshComponentsOf,
            },
          });
      const sourceRun = rebuildCompositeRun(carried.sourceRun, surface.executionDataset);
      const armStrategyDocument = buildThreeFactorTopNStrategyDocument({
        ...buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
          topN: arm.selectionTopN,
          datasetVersionId: EXTENSION_DATASET_VERSION_ID,
          datasetLabel: "v8",
        }),
        maxPositions: arm.maxPositions,
        maxDailyBuys: arm.maxDailyBuys,
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
        name: "t74-refresh-" + arm.id + "-full-C",
        runnerBridge,
      });
      const fullA = arm.id === "control"
        ? await runCompositeRunnerBacktest({ ...common, dateRange, name: "t74-refresh-control-full-A" })
        : null;
      const closed = fullC.run.trades.filter(
        (trade) => trade.returnPct !== null && Number.isFinite(trade.returnPct),
      );
      const carryStats = arm.carryMaxAgeDays > 0
        ? carryTradeStats(
            closed,
            carryDecisionDatesBySecurity(base, carried),
            executionToDecision,
          )
        : { trades: 0, netPnl: 0, bigWin50: 0 };
      const accounting = carried.carryAccounting ?? {
        queuedCandidates: 0,
        consideredCarryCandidates: 0,
        selectedCarryCandidates: 0,
        attemptedCarryCandidates: 0,
        expiredCarryCandidates: 0,
        refreshUnscorableCarryCandidates: 0,
      };

      outcomes.push({
        id: arm.id,
        label: arm.label,
        selectionTopN: arm.selectionTopN,
        maxDailyBuys: arm.maxDailyBuys,
        maxPositions: arm.maxPositions,
        carryMaxAgeDays: arm.carryMaxAgeDays,
        replacementScoreMargin: arm.replacementScoreMargin,
        refreshWeight: arm.refreshWeight,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
        bigWin50Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 50).length,
        bigWin100Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 100).length,
        carryQueuedCandidates: accounting.queuedCandidates,
        carryConsideredCandidates: accounting.consideredCarryCandidates,
        carrySelectedCandidates: accounting.selectedCarryCandidates,
        carryAttemptedCandidates: accounting.attemptedCarryCandidates,
        carryExpiredCandidates: accounting.expiredCarryCandidates,
        refreshUnscorableCarryCandidates: accounting.refreshUnscorableCarryCandidates,
        carryTrades: carryStats.trades,
        carryNetPnl: carryStats.netPnl,
        carryBigWin50Count: carryStats.bigWin50,
      });

      const latest = outcomes[outcomes.length - 1]!;
      context.log(
        "[refresh] 臂 " + arm.id + " 完成：C 收益=" + returnPct(fullC.run).toFixed(4) + "%"
          + " MaxDD=" + (maxDrawdownPct(fullC.run.equityCurve) ?? Number.NaN).toFixed(4) + "%"
          + " 成交=" + String(fullC.run.trades.length)
          + " >=+50%=" + String(latest.bigWin50Count)
          + " carryTrades=" + String(latest.carryTrades)
          + " carryNet=" + latest.carryNetPnl.toFixed(2),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      control.selectionTopN === 3
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

    const carryArms = outcomes.filter((outcome) => outcome.id !== "control");
    const bestByBigWin = carryArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.bigWin50Count > best.bigWin50Count ? arm : best),
      null,
    );
    const bestByReturn = carryArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best),
      null,
    );
    const bestByDd = carryArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null
        || (arm.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) < (best.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
        ? arm
        : best),
      null,
    );

    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      selectionTopN: outcome.selectionTopN,
      maxDailyBuys: outcome.maxDailyBuys,
      maxPositions: outcome.maxPositions,
      carryDays: outcome.carryMaxAgeDays,
      margin: outcome.replacementScoreMargin,
      refreshWeight: outcome.refreshWeight,
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      bigWin50Count: outcome.bigWin50Count,
      bigWin100Count: outcome.bigWin100Count,
      carryAttemptedCandidates: outcome.carryAttemptedCandidates,
      carryTrades: outcome.carryTrades,
      carryNetPnl: outcome.carryNetPnl,
      carryBigWin50Count: outcome.carryBigWin50Count,
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
          label: "至少一条 refresh 臂的 >= +50% 笔数多于控制臂",
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
              : "控制臂未能复现 T74 冻结值：refresh 臂的 Δ 不可信。",
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
            summary: "HOLDOUT：要求 parity 通过、refresh 臂抓到更多 >= +50% 交易，且最好收益不低于控制臂。",
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
          "carryPolicy=carry-refresh-v1.0.0",
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "refresh-arms",
          title: "当日重评分 + 跨日候选池：收益 / 回撤 / carry 成交贡献",
          description:
            "每个决策日对 fresh + pending 统一计算 CarryRefreshV1，逐分量在当日 union 内做横截面分位后与 3F 融合。"
            + "refresh-only 臂用于分离重评分本身，carry1 臂用于看跨日候选的增量。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "selectionTopN", label: "可选范围", digits: 0 },
            { key: "carryDays", label: "carry 天数", digits: 0 },
            { key: "margin", label: "margin", digits: 2 },
            { key: "refreshWeight", label: "refresh 权重", digits: 2 },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "bigWin50Count", label: ">= +50% 笔数", digits: 0 },
            { key: "bigWin100Count", label: ">= +100% 笔数", digits: 0 },
            { key: "carryAttemptedCandidates", label: "carry 进入买入前 N", digits: 0 },
            { key: "carryTrades", label: "carry 成交", digits: 0 },
            { key: "carryNetPnl", label: "carry 净利", digits: 0 },
            { key: "carryBigWin50Count", label: "carry >=+50%", digits: 0 },
            { key: "fullCTrades", label: "C 成交笔数", digits: 0 },
          ],
          rows,
        },
        {
          key: "carry-source-accounting",
          title: "候选池流水（intent-level，按天累计）",
          columns: [
            { key: "arm", label: "臂" },
            { key: "carryQueuedCandidates", label: "进入 pending", digits: 0 },
            { key: "carryConsideredCandidates", label: "参与重排", digits: 0 },
            { key: "carrySelectedCandidates", label: "进入 topN", digits: 0 },
            { key: "carryAttemptedCandidates", label: "进入买入前 N", digits: 0 },
            { key: "carryExpiredCandidates", label: "超龄淘汰", digits: 0 },
          ],
          rows: outcomes.map((outcome) => ({
            arm: outcome.label,
            carryQueuedCandidates: outcome.carryQueuedCandidates,
            carryConsideredCandidates: outcome.carryConsideredCandidates,
            carrySelectedCandidates: outcome.carrySelectedCandidates,
            carryAttemptedCandidates: outcome.carryAttemptedCandidates,
            carryExpiredCandidates: outcome.carryExpiredCandidates,
          })),
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
        { code: "best_big_win50", label: "refresh 臂最多 >= +50% 笔数", value: bestByBigWin?.bigWin50Count ?? null, digits: 0 },
        { code: "best_return_pct", label: "refresh 臂最高收益", value: bestByReturn?.fullCReturnPct ?? null, unit: "%", digits: 4 },
        { code: "best_dd_pct", label: "refresh 臂最低回撤", value: bestByDd?.fullCMaxDrawdownPct ?? null, unit: "%", digits: 4 },
        { code: "best_carry_net_pnl", label: "carry 臂最高 carry 净利", value: carryArms.reduce<number | null>((best, arm) => best === null || arm.carryNetPnl > best ? arm.carryNetPnl : best, null), digits: 0 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
          selectionTopN: outcome.selectionTopN,
          maxDailyBuys: outcome.maxDailyBuys,
          maxPositions: outcome.maxPositions,
          carryMaxAgeDays: outcome.carryMaxAgeDays,
          replacementScoreMargin: outcome.replacementScoreMargin,
          refreshWeight: outcome.refreshWeight,
          fullCReturnPct: outcome.fullCReturnPct,
          fullCTrades: outcome.fullCTrades,
          fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
          fullAReturnPct: outcome.fullAReturnPct,
          runnerTrigger: outcome.runnerTrigger,
          bigWin50Count: outcome.bigWin50Count,
          bigWin100Count: outcome.bigWin100Count,
          carryQueuedCandidates: outcome.carryQueuedCandidates,
          carryConsideredCandidates: outcome.carryConsideredCandidates,
          carrySelectedCandidates: outcome.carrySelectedCandidates,
          carryAttemptedCandidates: outcome.carryAttemptedCandidates,
          carryExpiredCandidates: outcome.carryExpiredCandidates,
          refreshUnscorableCarryCandidates: outcome.refreshUnscorableCarryCandidates,
          carryTrades: outcome.carryTrades,
          carryNetPnl: outcome.carryNetPnl,
          carryBigWin50Count: outcome.carryBigWin50Count,
        })),
        note:
          "P7 在同一决策日对 fresh + pending 做 CarryRefreshV1 统一重评分；"
          + "carry 成交按“交易执行日前一决策日是否由 carry 产生该 intent”识别。",
      },
    };
  },
};
