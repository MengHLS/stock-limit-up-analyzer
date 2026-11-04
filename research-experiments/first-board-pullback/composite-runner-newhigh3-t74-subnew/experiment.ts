/**
 * P10 · T74 候选池「次新股」过滤（其余逐字段冻结）。
 *
 * 问题：151% 那条策略（first-limit-pullback-3f-top3 + c6-b4-14 + Runner T74）的 1429 笔
 * 已实现交易里，只有 51 笔（3.57%）买在「上市 < 365 日」的股票上；次新那一档胜率 31.4%
 * （全样本 38.6%），净利 +10,324 元（占总净利 5.47%）几乎全靠一笔 SH.603121（+74.41%）。
 *
 * ⇒ 本实验只改**一个**自变量：在**排序前**把「上市龄 < N 个自然日」的候选从池里剔除
 *   （允许低名次递补），看它到底是拖累还是贡献。
 *
 * 冻结项：3F 排序（maxAmplitude/meanAmplitude LOW、t1VolumeRatio HIGH）、每日 top3、
 * 单日 2 笔 / 最多 5 仓、EQUITY_RATIO 分层仓位、SL-18.1 退出链、candidateExitPolicy=DISABLED、
 * Runner NEW_HIGH_3 / 5 / 74、数据坐标（780001 / 660001）、成本模型。
 *
 * 口径：
 *   - 上市日 = Security Master `research_securities.listedDate`（PIT，决策日已知）。
 *   - 上市龄 = 决策日 − 上市日（自然日）。四臂：365 / 180 / 90 + 控制臂。
 *   - 上市日不可得的候选**不剔除**并如实计数（这是 alpha 资格过滤，不是风控）。
 */
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  baseSecurityIdOf,
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
const SELECTION_TOP_N = 3;

export interface SubNewArmSpec {
  readonly id: string;
  readonly label: string;
  /** null = 不过滤（控制臂）。 */
  readonly excludeListedWithinDays: number | null;
}

export const SUBNEW_ARMS: readonly SubNewArmSpec[] = [
  { id: "control", label: "控制臂 · 无上市龄过滤（现役）", excludeListedWithinDays: null },
  { id: "excl365", label: "剔除上市 < 365 日", excludeListedWithinDays: 365 },
  { id: "excl180", label: "剔除上市 < 180 日", excludeListedWithinDays: 180 },
  { id: "excl90", label: "剔除上市 < 90 日", excludeListedWithinDays: 90 },
];

const outcomeSchema = z.object({
  id: z.string(),
  label: z.string(),
  excludeListedWithinDays: z.number().int().nullable(),
  fullAReturnPct: z.number().nullable(),
  fullATrades: z.number().int().nullable(),
  fullCReturnPct: z.number(),
  fullCTrades: z.number().int(),
  fullCMaxDrawdownPct: z.number().nullable(),
  fullControlDeltaPct: z.number(),
  runnerTrigger: z.number().int().nullable(),
  bigWin50Count: z.number().int(),
  bigWin100Count: z.number().int(),
  listingEvaluatedCandidates: z.number().int(),
  listingExcludedCandidates: z.number().int(),
  listingUnknownDateCandidates: z.number().int(),
  subNewTrades: z.number().int(),
  subNewNetPnl: z.number(),
  subNewBigWin50: z.number().int(),
});

export const compositeRunnerT74SubNewSchema = z.object({
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

export const compositeRunnerT74SubNewExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-subnew",
    name: "P10 · 候选池上市龄过滤（T74，其余冻结）",
    version: COMPUTATION_VERSION,
    description:
      "在 3F 排序**之前**剔除「上市龄 < 365 / 180 / 90 个自然日」的候选（允许低名次递补），"
      + "其余全部冻结（3F 排序、每日 top3、2 笔 / 5 仓、分层仓位、SL-18.1 退出链、Runner T74、数据坐标）。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "composite-runner", "runner-t74", "universe-filter", "sub-new", "p10"],
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
      extensionSelectionArms: SUBNEW_ARMS.map((arm) => ({
        id: arm.id,
        trendWeight: null,
        excludeListedWithinDays: arm.excludeListedWithinDays,
      })),
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-subnew",
    pageTitle: "P10 · 候选池上市龄过滤（T74，其余冻结）",
  },
  resultSchema: compositeRunnerT74SubNewSchema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;

    const listingDateBySecurityId = surface.listingDateBySecurityId;
    const listingDateOf = (securityId: string): string | null =>
      listingDateBySecurityId.get(baseSecurityIdOf(securityId)) ?? null;

    // 健全性：provider 必须已按同一 id 集合装载上市日（否则闸门无意义）。
    if (listingDateBySecurityId.size === 0) {
      throw new Error("listingDateBySecurityId 为空（provider 未装载 Security Master 上市日）");
    }

    const builtEvents = buildCompositeEvents(surface.baselineDataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
    const candidateCount = [...builtEvents.bucketCandidatesByDate.values()]
      .reduce((sum, list) => sum + list.length, 0);

    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
      state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const,
      extendToHoldingDays: 74,
    };

    interface ArmOutcome {
      id: string;
      label: string;
      excludeListedWithinDays: number | null;
      fullAReturnPct: number | null;
      fullATrades: number | null;
      fullCReturnPct: number;
      fullCTrades: number;
      fullCMaxDrawdownPct: number | null;
      runnerTrigger: number | null;
      bigWin50Count: number;
      bigWin100Count: number;
      listingEvaluatedCandidates: number;
      listingExcludedCandidates: number;
      listingUnknownDateCandidates: number;
      subNewTrades: number;
      subNewNetPnl: number;
      subNewBigWin50: number;
    }

    const DAY_MS = 86400000;
    const ageDaysOf = (entryTime: string, listedDate: string): number =>
      Math.floor((Date.parse(entryTime + "T00:00:00Z") - Date.parse(listedDate + "T00:00:00Z")) / DAY_MS);

    const outcomes: ArmOutcome[] = [];
    for (const arm of SUBNEW_ARMS) {
      context.log("[subnew] 臂 " + arm.id + " 开始（excludeListedWithinDays=" + String(arm.excludeListedWithinDays) + "）");
      const built = buildFirstLimitPullback3FTop3SourceRun({
        dataset: surface.baselineDataset,
        dateRange,
        topN: SELECTION_TOP_N,
        armId: arm.id,
        label: "1.62.1 bridge selection · " + arm.label,
        candidateListingFilter: arm.excludeListedWithinDays === null
          ? null
          : { minListingAgeDays: arm.excludeListedWithinDays, listingDateOf },
      });
      const sourceRun = rebuildCompositeRun(built.sourceRun, surface.executionDataset);
      const armStrategyDocument = buildThreeFactorTopNStrategyDocument(
        buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
          topN: SELECTION_TOP_N,
          datasetVersionId: EXTENSION_DATASET_VERSION_ID,
          datasetLabel: "v8",
        }),
      );
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
        name: "t74-subnew-" + arm.id + "-full-C",
        runnerBridge,
      });
      const fullA = arm.id === "control"
        ? await runCompositeRunnerBacktest({ ...common, dateRange, name: "t74-subnew-control-full-A" })
        : null;
      const closed = fullC.run.trades.filter(
        (trade) => trade.returnPct !== null && Number.isFinite(trade.returnPct),
      );
      const subNewClosed = closed.filter((trade) => {
        const listed = listingDateOf(trade.securityId);
        return listed !== null && ageDaysOf(trade.entryTime, listed) < 365;
      });
      const accounting = built.listingFilterAccounting ?? {
        evaluatedCandidateCount: 0, excludedByListingAge: 0, unknownListingDate: 0,
      };
      outcomes.push({
        id: arm.id,
        label: arm.label,
        excludeListedWithinDays: arm.excludeListedWithinDays,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
        bigWin50Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 50).length,
        bigWin100Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 100).length,
        listingEvaluatedCandidates: accounting.evaluatedCandidateCount,
        listingExcludedCandidates: accounting.excludedByListingAge,
        listingUnknownDateCandidates: accounting.unknownListingDate,
        subNewTrades: subNewClosed.length,
        subNewNetPnl: subNewClosed.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0),
        subNewBigWin50: subNewClosed.filter((trade) => (trade.returnPct ?? 0) >= 50).length,
      });
      const latest = outcomes[outcomes.length - 1]!;
      context.log(
        "[subnew] 臂 " + arm.id + " 完成：C 收益=" + returnPct(fullC.run).toFixed(4) + "%"
          + " MaxDD=" + (maxDrawdownPct(fullC.run.equityCurve) ?? Number.NaN).toFixed(4) + "%"
          + " 成交=" + String(fullC.run.trades.length)
          + " >=+50%=" + String(latest.bigWin50Count)
          + " 剔除候选=" + String(latest.listingExcludedCandidates),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      control.excludeListedWithinDays === null
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

    const filterArms = outcomes.filter((outcome) => outcome.id !== "control");
    const bestByReturn = filterArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best),
      null,
    );
    const bestByDd = filterArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null
        || (arm.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) < (best.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
        ? arm
        : best),
      null,
    );

    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      excludeListedWithinDays: outcome.excludeListedWithinDays,
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      bigWin50Count: outcome.bigWin50Count,
      bigWin100Count: outcome.bigWin100Count,
      listingExcludedCandidates: outcome.listingExcludedCandidates,
      subNewTrades: outcome.subNewTrades,
      subNewNetPnl: outcome.subNewNetPnl,
      subNewBigWin50: outcome.subNewBigWin50,
      fullCTrades: outcome.fullCTrades,
    }));

    const checks = [
      {
        code: "control_parity",
        label: "控制臂复现 T74 冻结值",
        status: parityPass ? ("PASS" as const) : ("FAIL" as const),
        value: control.fullCReturnPct,
        threshold: CONTROL_C_RETURN_PCT,
      },
      {
        code: "listing_dates_loaded",
        label: "Security Master 上市日已装载",
        status: listingDateBySecurityId.size > 0 ? ("PASS" as const) : ("FAIL" as const),
        value: listingDateBySecurityId.size,
        threshold: 1,
      },
      {
        code: "unknown_listing_date_zero",
        label: "四臂均无「上市日不可得」候选",
        status: outcomes.every((outcome) => outcome.listingUnknownDateCandidates === 0)
          ? ("PASS" as const)
          : ("FAIL" as const),
        value: outcomes.reduce((sum, outcome) => sum + outcome.listingUnknownDateCandidates, 0),
        threshold: 0,
      },
    ];

    let gate: ExperimentResultPayload["confirmatoryGate"];
    if (phase !== "EXPLORATORY" && protocolFingerprint !== null) {
      gate = phase === "OBSERVATION"
        ? {
            status: parityPass ? "OBSERVATION_READY" : "INSUFFICIENT",
            protocolFingerprint,
            sampleCount: control.fullCTrades,
            checks,
            summary: parityPass ? "控制臂逐项复现 T74 冻结值，可进入 HOLDOUT。" : "控制臂未能复现 T74 冻结值。",
          }
        : {
            status: parityPass
              && (bestByReturn?.fullCReturnPct ?? Number.NEGATIVE_INFINITY) >= control.fullCReturnPct
              && (bestByDd?.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) <= (control.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
              ? "PASS"
              : "FAIL",
            protocolFingerprint,
            sampleCount: control.fullCTrades,
            checks,
            summary: "HOLDOUT：要求 parity 通过、剔除次新后收益不低于控制臂、且最大回撤不恶化。",
          };
    }

    return {
      sampleSummary: {
        candidateCount,
        eligibleCount: candidateCount,
        excludedCount: 0,
        excludedByReason: {},
        notes: [
          "arms=" + String(outcomes.length),
          "listingDates=" + String(listingDateBySecurityId.size),
          "filter=listedAgeDaysAtDecisionDate",
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "subnew-arms",
          title: "候选池上市龄过滤：收益 / 回撤 / 剔除量 / 次新成交",
          description:
            "唯一变量 = 是否在 3F 排序前剔除上市龄 < N 日的候选（允许递补）；其余逐字段冻结。"
            + "「次新成交」按该臂自身成交 × 建仓日上市龄 < 365 日统计（无论该臂是否过滤）。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "excludeListedWithinDays", label: "剔除阈值（日）", digits: 0 },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "bigWin50Count", label: ">= +50% 笔数", digits: 0 },
            { key: "bigWin100Count", label: ">= +100% 笔数", digits: 0 },
            { key: "listingExcludedCandidates", label: "剔除候选数", digits: 0 },
            { key: "subNewTrades", label: "次新成交", digits: 0 },
            { key: "subNewNetPnl", label: "次新净利", digits: 0 },
            { key: "subNewBigWin50", label: "次新 >=+50%", digits: 0 },
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
        { code: "control_subnew_trades", label: "控制臂次新成交笔数", value: control.subNewTrades, digits: 0 },
        { code: "best_return_pct", label: "过滤臂最高收益", value: bestByReturn?.fullCReturnPct ?? null, unit: "%", digits: 4 },
        { code: "best_dd_pct", label: "过滤臂最低回撤", value: bestByDd?.fullCMaxDrawdownPct ?? null, unit: "%", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          ...outcome,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
        })),
        note:
          "P10 只改候选池的上市龄过滤（排序前剔除、允许递补）；3F 排序、每日 top3、2 笔 / 5 仓、"
          + "SL-18.1 退出链、Runner T74、数据坐标与成本模型逐字段冻结。上市日取 Security Master，"
          + "上市龄按决策日的自然日计算；不可得时不剔除并如实计数。",
      },
    };
  },
};
