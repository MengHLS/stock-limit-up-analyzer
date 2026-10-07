/**
 * COMPOSITE-RUNNER-T74-SLOTS-001 —— **P2：只放开买入名额 / 持仓上限**（选股与排序完全冻结）。
 *
 * ## 为什么是这个方向
 *
 * 用户目标：**抓住更多「超级股票」**（不是把曲线做平）。
 *
 * 两项只读诊断（`docs/evidence/_analysis_t74_winner_tail_20261004.json` /
 * `_analysis_t74_rank_slot_recall_20261004.json`）给出：
 *   1. 控制臂 1429 笔已实现交易里，**只有 9 笔 >= +50%**（占 0.63%）就贡献 **113.7%** 的净利；
 *      top-10 贡献 119.1%，**去掉 top-10 之后整体亏损 −36,014 元**；中位交易 −1.32%、胜率 38.6%。
 *      ⇒ 极端肥尾：收益全在那几只票上。
 *   2. `maxDailyBuys = 2` ⇒ 每日 top-3 的**第 3 名从未被买入**（rank1=1037 笔 / rank2=392 笔 / rank3=0 笔）；
 *      而第 3 名的「曾经涨过 +50% / +100%」密度与第 1/2 名**同档**（约 11.2% / 2.4%）。
 *   3. 且 1039 个入场日中 **649 天只买进 1 只**（名额/仓位约束在浪费候选）。
 *   4. 排序层已被三次实验否掉（v1 排序 −210pp / v1 门槛 −172pp / v2 排序 −166pp）⇒ 换票 = 换一注彩票。
 *
 * 因此本实验**只动执行容量**（官方已参数化的 `maxDailyBuys` / `maxPositions`，见 `strategyFamilyRegistry`），
 * 选股、排序、候选池、退出链、Runner、数据集坐标**逐字段冻结**。
 *
 * ## 四条臂
 *
 * | 臂 | maxDailyBuys | maxPositions | 说明 |
 * |---|---|---|---|
 * | control | 2 | 5 | 现役 T74（parity 参照） |
 * | slots-3-5 | 3 | 5 | 把每日第 3 名也买进来（仓位不变） |
 * | slots-3-8 | 3 | 8 | 多买 + 更多持仓位 |
 * | slots-3-12 | 3 | 12 | 多买 + 充分持仓位（看仓位上限是否仍在绑） |
 *
 * ## 成功判据（按用户目标，而不是按曲线平滑）
 *
 * 1. **实现收益 >= +50% 的交易笔数**是否明显增加（现役 9 笔）——「抓到更多超级票」的直接指标；
 * 2. 组合总收益 > 151.0958%（或至少不显著下降）；
 * 3. 最大回撤不显著恶化（现役 43.303%）。
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
/** 现役控制臂「实现收益 >= +50%」的笔数（赢家尾部诊断冻结值）。 */
const CONTROL_BIG_WIN_50 = 9;

export interface SlotArmSpec {
  readonly id: string;
  readonly label: string;
  readonly maxDailyBuys: number;
  readonly maxPositions: number;
}

export const SLOT_ARMS: readonly SlotArmSpec[] = [
  { id: "control", label: "控制臂 2 笔/5 仓（T74）", maxDailyBuys: 2, maxPositions: 5 },
  { id: "slots-3-5", label: "3 笔/5 仓", maxDailyBuys: 3, maxPositions: 5 },
  { id: "slots-3-8", label: "3 笔/8 仓", maxDailyBuys: 3, maxPositions: 8 },
  { id: "slots-3-12", label: "3 笔/12 仓", maxDailyBuys: 3, maxPositions: 12 },
];

export const compositeRunnerT74SlotsSchema = z.object({
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
      maxDailyBuys: z.number().int(),
      maxPositions: z.number().int(),
      fullCReturnPct: z.number(),
      fullCTrades: z.number().int(),
      fullCMaxDrawdownPct: z.number().nullable(),
      fullControlDeltaPct: z.number(),
      fullAReturnPct: z.number().nullable(),
      runnerTrigger: z.number().int().nullable(),
      /** 实现收益 >= +50% 的交易笔数（用户目标的直接指标）。 */
      bigWin50Count: z.number().int(),
      bigWin100Count: z.number().int(),
      /** 大赢家净利贡献占比（>= +50% 那批）。 */
      bigWin50NetPnlSharePct: z.number().nullable(),
      maxTradeReturnPct: z.number().nullable(),
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

export const compositeRunnerT74SlotsExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-slots",
    name: "P2 · 放开买入名额 / 持仓上限（T74）",
    version: COMPUTATION_VERSION,
    description:
      "选股、排序、候选池、退出链、Runner、数据集坐标全部冻结，只把执行容量（maxDailyBuys / maxPositions）"
      + "从 2 笔/5 仓放到 3 笔/5、8、12 仓，验证「每日第 3 名同样值得买」能否带来更多超级票（>= +50% 的交易笔数）。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "composite-runner",
      "runner-t74",
      "execution-capacity",
      "p2-slots",
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
      // 四条臂共享同一选股集合（每日 3F top-3）⇒ 只需按控制臂装载扩展行。
      extensionSelectionArms: [{ id: "control", trendWeight: null }],
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-slots",
    pageTitle: "P2 · 放开买入名额 / 持仓上限（T74）",
  },
  resultSchema: compositeRunnerT74SlotsSchema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;

    // 选股完全冻结：同一份 sourceRun 供四条臂使用（只换执行容量）。
    const built = buildFirstLimitPullback3FTop3SourceRun({
      dataset: surface.baselineDataset,
      dateRange,
    });
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
      bigWin50NetPnlSharePct: number | null;
      maxTradeReturnPct: number | null;
    }

    const outcomes: ArmOutcome[] = [];
    for (const arm of SLOT_ARMS) {
      context.log(
        "[slots] 臂 " + arm.id + "（maxDailyBuys=" + String(arm.maxDailyBuys)
          + " maxPositions=" + String(arm.maxPositions) + "）开始",
      );
      const strategyDocument = buildThreeFactorTopNStrategyDocument({
        ...buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
          topN: COMPOSITE_RUNNER_TOP_N,
          datasetVersionId: EXTENSION_DATASET_VERSION_ID,
          datasetLabel: "v8",
        }),
        maxPositions: arm.maxPositions,
        maxDailyBuys: arm.maxDailyBuys,
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
        name: "t74-slots-" + arm.id + "-full-C",
        runnerBridge,
      });
      const fullA = arm.id === "control"
        ? await runCompositeRunnerBacktest({
            ...common,
            dateRange,
            name: "t74-slots-" + arm.id + "-full-A",
          })
        : null;
      const closed = fullC.run.trades.filter(
        (trade) => trade.returnPct !== null && Number.isFinite(trade.returnPct),
      );
      const bigWin50 = closed.filter((trade) => (trade.returnPct ?? 0) >= 50);
      const totalNetPnl = closed.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0);
      const bigWin50Pnl = bigWin50.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0);
      outcomes.push({
        id: arm.id,
        label: arm.label,
        maxDailyBuys: arm.maxDailyBuys,
        maxPositions: arm.maxPositions,
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
        bigWin50Count: bigWin50.length,
        bigWin100Count: bigWin50.filter((trade) => (trade.returnPct ?? 0) >= 100).length,
        bigWin50NetPnlSharePct: totalNetPnl === 0 ? null : (bigWin50Pnl / totalNetPnl) * 100,
        maxTradeReturnPct: closed.length === 0
          ? null
          : Math.max(...closed.map((trade) => trade.returnPct ?? Number.NEGATIVE_INFINITY)),
      });
      context.log(
        "[slots] 臂 " + arm.id + " 完成：C 收益=" + returnPct(fullC.run).toFixed(4) + "%"
          + " 成交=" + String(fullC.run.trades.length)
          + " >=+50%笔数=" + String(bigWin50.length),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      control.maxDailyBuys === 2
      && control.maxPositions === 5
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

    const slotArms = outcomes.filter((outcome) => outcome.id !== "control");
    const moreBigWins = slotArms.filter((arm) => arm.bigWin50Count > CONTROL_BIG_WIN_50);
    const bestByReturn = slotArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best),
      null,
    );
    const bestByBigWins = slotArms.reduce<ArmOutcome | null>(
      (best, arm) => (best === null || arm.bigWin50Count > best.bigWin50Count ? arm : best),
      null,
    );

    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      maxDailyBuys: outcome.maxDailyBuys,
      maxPositions: outcome.maxPositions,
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      bigWin50Count: outcome.bigWin50Count,
      bigWin100Count: outcome.bigWin100Count,
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
          code: "more_big_wins",
          label: "至少一条容量臂的 >= +50% 笔数多于控制臂",
          status: moreBigWins.length > 0 ? ("PASS" as const) : ("FAIL" as const),
          value: bestByBigWins?.bigWin50Count ?? null,
          threshold: CONTROL_BIG_WIN_50,
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
            : "控制臂未能复现 T74 冻结值：容量臂的 Δ 不可信，先修数据/代码坐标。",
        };
      } else {
        const pass = parityPass && moreBigWins.length > 0
          && (bestByReturn?.fullCReturnPct ?? Number.NEGATIVE_INFINITY) >= control.fullCReturnPct;
        gate = {
          status: pass ? "PASS" : "FAIL",
          protocolFingerprint,
          sampleCount: control.fullCTrades,
          checks: [...checks, {
            code: "return_not_worse",
            label: "容量臂最好收益不低于控制臂",
            status: (bestByReturn?.fullCReturnPct ?? Number.NEGATIVE_INFINITY) >= control.fullCReturnPct
              ? ("PASS" as const)
              : ("FAIL" as const),
            value: bestByReturn?.fullCReturnPct ?? null,
            threshold: control.fullCReturnPct,
          }],
          summary: pass
            ? "HOLDOUT：parity 通过，且容量臂既抓到更多 >= +50% 的交易、总收益也不低于控制臂。"
            : "HOLDOUT：parity、超级票笔数或总收益未同时通过。",
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
          "selectionFrozen=true",
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "slot-arms",
          title: "全周期：只放开买入名额 / 持仓上限",
          description:
            "选股、排序、候选池、退出链、Runner、数据集坐标全部冻结；control = 现役 2 笔/5 仓。"
            + "「>= +50% 笔数」= 实现收益不低于 +50% 的交易笔数（用户目标的直接指标）。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "maxDailyBuys", label: "单日买入上限", digits: 0 },
            { key: "maxPositions", label: "持仓上限", digits: 0 },
            { key: "bigWin50Count", label: ">= +50% 笔数", digits: 0 },
            { key: "bigWin100Count", label: ">= +100% 笔数", digits: 0 },
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
        { code: "control_big_win50_count", label: "控制臂 >= +50% 笔数", value: control.bigWin50Count, digits: 0 },
        { code: "best_big_win50_count", label: "最优容量臂 >= +50% 笔数", value: bestByBigWins?.bigWin50Count ?? null, digits: 0 },
        { code: "best_slot_full_c_return_pct", label: "最优容量臂 C 全周期收益", value: bestByReturn?.fullCReturnPct ?? null, unit: "%", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        controlBigWin50Baseline: CONTROL_BIG_WIN_50,
        arms: outcomes.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
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
          bigWin50NetPnlSharePct: outcome.bigWin50NetPnlSharePct,
          maxTradeReturnPct: outcome.maxTradeReturnPct,
        })),
        note:
          "P2 只改执行容量（maxDailyBuys / maxPositions），选股与排序逐字段冻结："
          + "同一份 sourceRun（每日 3F top-3）供四条臂共享。"
          + ">= +50% 笔数按实现收益（returnPct）统计，是「抓到更多超级票」的直接指标。",
      },
    };
  },
};