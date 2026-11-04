/**
 * COMPOSITE-RUNNER-T74-TOP5-001 —— P4：选股广度 TopN 3 -> 5（其余冻结）。
 *
 * 目标：抓更多超级票。
 * 依据：rank1..5 的「曾涨过 +50%」密度同档（198/217/208/208/214，约 10.6%-11.8%），
 *       而 P2 只多买了「其它交易日的 top-3」，从未买过当日 rank4/5。
 */
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  buildCompositeEvents,
  buildFirstLimitPullback3FTop3SourceRun,
  rebuildCompositeRun,
  runCompositeRunnerBacktest,
  buildThreeFactorTopNStrategyDocument,
  buildThreeFactorTopNFamilyArmInput,
  THREE_FACTOR_TOPN_CREATED_AT,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
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
const EXTRA_RANK_TOP_N = 5;

export interface Top5ArmSpec {
  readonly id: string;
  readonly label: string;
  readonly selectionTopN: number;
  readonly maxDailyBuys: number;
  readonly maxPositions: number;
}

/**
 * 注意：`maxDailyBuys <= selectionTopN - 2` 时，simulator 按排名顺序买入，**永远买不到 rank4/5**
 * （第一版 P4 就是这样空跑了一次：top5-3-5 与 P2 的 slots-3-5 结果完全相同、rank4-5 成交为 0）。
 * 因此这里把单日买入名额放到 4 / 5，才会真正买到第 4、5 名。
 */
export const TOP5_ARMS: readonly Top5ArmSpec[] = [
  { id: "control", label: "控制臂 · top3 / 2 笔 / 5 仓（现役）", selectionTopN: 3, maxDailyBuys: 2, maxPositions: 5 },
  { id: "top5-4-5", label: "top5 / 4 笔 / 5 仓", selectionTopN: 5, maxDailyBuys: 4, maxPositions: 5 },
  { id: "top5-5-5", label: "top5 / 5 笔 / 5 仓", selectionTopN: 5, maxDailyBuys: 5, maxPositions: 5 },
  { id: "top5-5-8", label: "top5 / 5 笔 / 8 仓", selectionTopN: 5, maxDailyBuys: 5, maxPositions: 8 },
];

export const compositeRunnerT74Top5Schema = z.object({
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
      selectionTopN: z.number().int(),
      maxDailyBuys: z.number().int(),
      maxPositions: z.number().int(),
      fullCReturnPct: z.number(),
      fullCMaxDrawdownPct: z.number().nullable(),
      fullCTrades: z.number().int(),
      fullControlDeltaPct: z.number(),
      fullAReturnPct: z.number().nullable(),
      runnerTrigger: z.number().int().nullable(),
      bigWin50Count: z.number().int(),
      bigWin100Count: z.number().int(),
      extraRankTrades: z.number().int(),
      extraRankNetPnl: z.number(),
      extraRankBigWin50: z.number().int(),
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

export const compositeRunnerT74Top5Experiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-top5",
    name: "P4 · 选股广度 TopN 3->5（T74，其余冻结）",
    version: COMPUTATION_VERSION,
    description:
      "把每日可选范围从 3F top3 扩到 top5（rank4/5 的曾涨过 +50% 密度与 rank1-3 同档），"
      + "并配不同买入名额/持仓上限；排序、候选池、退出链、Runner T74、数据坐标全部冻结。"
      + "看 C 收益 / 最大回撤 / 实现 >= +50% 的笔数，以及 rank4-5 成交的实际贡献。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "composite-runner", "runner-t74", "selection-breadth", "p4-top5"],
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
        { id: "top5", trendWeight: null, topN: EXTRA_RANK_TOP_N },
      ],
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-top5",
    pageTitle: "P4 · 选股广度 TopN 3->5（T74，其余冻结）",
  },
  resultSchema: compositeRunnerT74Top5Schema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;

    const builtEvents = buildCompositeEvents(surface.baselineDataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
    const rankBySecurity = new Map<string, number>();
    for (const dayCandidates of builtEvents.bucketCandidatesByDate.values()) {
      const ranked = [...dayCandidates].sort((left, right) =>
        (right.score - left.score) || left.event.securityId.localeCompare(right.event.securityId));
      ranked.forEach((candidate, index) => rankBySecurity.set(candidate.event.securityId, index + 1));
    }

    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
      state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const,
      extendToHoldingDays: 74,
    };

    interface ArmOutcome {
      id: string;
      label: string;
      selectionTopN: number;
      maxDailyBuys: number;
      maxPositions: number;
      fullAReturnPct: number | null;
      fullATrades: number | null;
      fullCReturnPct: number;
      fullCTrades: number;
      fullCMaxDrawdownPct: number | null;
      runnerTrigger: number | null;
      bigWin50Count: number;
      bigWin100Count: number;
      extraRankTrades: number;
      extraRankNetPnl: number;
      extraRankBigWin50: number;
    }

    const outcomes: ArmOutcome[] = [];
    for (const arm of TOP5_ARMS) {
      context.log(
        "[top5] 臂 " + arm.id + "（topN=" + String(arm.selectionTopN)
          + " buys=" + String(arm.maxDailyBuys) + " positions=" + String(arm.maxPositions) + "）开始",
      );
      const built = buildFirstLimitPullback3FTop3SourceRun({
        dataset: surface.baselineDataset,
        dateRange,
        topN: arm.selectionTopN,
      });
      const sourceRun = rebuildCompositeRun(built.sourceRun, surface.executionDataset);
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
        name: "t74-top5-" + arm.id + "-full-C",
        runnerBridge,
      });
      const fullA = arm.id === "control"
        ? await runCompositeRunnerBacktest({ ...common, dateRange, name: "t74-top5-control-full-A" })
        : null;
      const closed = fullC.run.trades.filter(
        (trade) => trade.returnPct !== null && Number.isFinite(trade.returnPct),
      );
      const extraRankTrades = closed.filter((trade) => (rankBySecurity.get(trade.securityId) ?? 0) >= 4);
      outcomes.push({
        id: arm.id,
        label: arm.label,
        selectionTopN: arm.selectionTopN,
        maxDailyBuys: arm.maxDailyBuys,
        maxPositions: arm.maxPositions,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
        bigWin50Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 50).length,
        bigWin100Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 100).length,
        extraRankTrades: extraRankTrades.length,
        extraRankNetPnl: extraRankTrades.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0),
        extraRankBigWin50: extraRankTrades.filter((trade) => (trade.returnPct ?? 0) >= 50).length,
      });
      const latest = outcomes[outcomes.length - 1]!;
      context.log(
        "[top5] 臂 " + arm.id + " 完成：C 收益=" + returnPct(fullC.run).toFixed(4) + "%"
          + " MaxDD=" + (maxDrawdownPct(fullC.run.equityCurve) ?? Number.NaN).toFixed(4) + "%"
          + " 成交=" + String(fullC.run.trades.length)
          + " >=+50%=" + String(latest.bigWin50Count),
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

    const top5Arms = outcomes.filter((outcome) => outcome.id !== "control");
    const bestByBigWin = top5Arms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.bigWin50Count > best.bigWin50Count ? arm : best),
      null,
    );
    const bestByReturn = top5Arms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best),
      null,
    );
    const bestByDd = top5Arms.reduce<ArmOutcome | null>(
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
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      bigWin50Count: outcome.bigWin50Count,
      bigWin100Count: outcome.bigWin100Count,
      extraRankTrades: outcome.extraRankTrades,
      extraRankNetPnl: outcome.extraRankNetPnl,
      extraRankBigWin50: outcome.extraRankBigWin50,
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
          label: "至少一条 top5 臂的 >= +50% 笔数多于控制臂",
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
              : "控制臂未能复现 T74 冻结值：top5 臂的 Δ 不可信。",
          }
        : {
            status: parityPass && (bestByBigWin?.bigWin50Count ?? 0) > control.bigWin50Count
              && (bestByReturn?.fullCReturnPct ?? Number.NEGATIVE_INFINITY) >= control.fullCReturnPct
              ? "PASS"
              : "FAIL",
            protocolFingerprint,
            sampleCount: control.fullCTrades,
            checks,
            summary: "HOLDOUT：要求 parity 通过、top5 臂抓到更多 >= +50% 的交易、且最好收益不低于控制臂。",
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
          "selectionBreadthTopN=3|5",
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "top5-arms",
          title: "选股广度 3 -> 5：收益 / 回撤 / 超级票 / rank4-5 贡献",
          description:
            "其余全部冻结（3F 排序、候选池、SL-18.1 退出链、Runner T74、数据坐标）。"
            + "「rank4-5 成交」= 该臂成交里当日 3F 排名第 4/5 的笔数及其净利。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "selectionTopN", label: "可选范围", digits: 0 },
            { key: "maxDailyBuys", label: "单日买入", digits: 0 },
            { key: "maxPositions", label: "持仓上限", digits: 0 },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "bigWin50Count", label: ">= +50% 笔数", digits: 0 },
            { key: "bigWin100Count", label: ">= +100% 笔数", digits: 0 },
            { key: "extraRankTrades", label: "rank4-5 成交", digits: 0 },
            { key: "extraRankNetPnl", label: "rank4-5 净利", digits: 0 },
            { key: "extraRankBigWin50", label: "rank4-5 >=+50%", digits: 0 },
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
        { code: "best_big_win50", label: "top5 臂最多 >= +50% 笔数", value: bestByBigWin?.bigWin50Count ?? null, digits: 0 },
        { code: "best_return_pct", label: "top5 臂最高收益", value: bestByReturn?.fullCReturnPct ?? null, unit: "%", digits: 4 },
        { code: "best_dd_pct", label: "top5 臂最低回撤", value: bestByDd?.fullCMaxDrawdownPct ?? null, unit: "%", digits: 4 },
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
          fullCReturnPct: outcome.fullCReturnPct,
          fullCTrades: outcome.fullCTrades,
          fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
          fullAReturnPct: outcome.fullAReturnPct,
          runnerTrigger: outcome.runnerTrigger,
          bigWin50Count: outcome.bigWin50Count,
          bigWin100Count: outcome.bigWin100Count,
          extraRankTrades: outcome.extraRankTrades,
          extraRankNetPnl: outcome.extraRankNetPnl,
          extraRankBigWin50: outcome.extraRankBigWin50,
        })),
        note:
          "P4 只改选股广度（每日 top3 -> top5）与买入名额/持仓上限；3F 排序、候选池、退出链、Runner、"
          + "数据坐标逐字段冻结。rank4-5 成交按当日 3F 排名识别（同一事件只有一个决策日）。",
      },
    };
  },
};