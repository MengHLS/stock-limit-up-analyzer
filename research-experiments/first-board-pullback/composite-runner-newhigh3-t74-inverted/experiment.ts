/**
 * `TAIL-SELECTION-002` · T74 **3F 取向翻转** —— 组合层真实 Run。
 *
 * ## 用户目标
 *
 * 「本质还是想选出更多的右尾的超级股票」⇒ 主指标 = `>= +50%` / `>= +100%` 的**笔数**。
 *
 * ## 为什么需要这个实验（而不是改策略文档）
 *
 * `server/research/compositeRunner` 的 3F 排序是它**自己**算的
 * （`scoreRankCandidates` 的百分位合成分 / 扫描期的 `threeFactorCompositeScoreOf`），
 * **完全不读 StrategyDocument 的配方排序特征** ⇒ 改文档排序对该路径零影响。
 * 因此翻转必须落在**源码构造**处：`buildFirstLimitPullback3FTop3SourceRun({ amplitudeOrientation })`。
 *
 * ## 取向翻转是什么
 *
 * 冻结契约 `FROZEN-BUCKET-CONTRACT-001` 的方向是 `maxAmplitude`/`meanAmplitude` = **LOW**、
 * `t1VolumeRatio` = HIGH。而实测右尾住在**高振幅**里 ⇒ 冻结 3F **结构上反尾选择**。
 * `1 − Σ(oriented)/3 = Σ(1 − oriented)/3` ⇒ 取补**等价于三个方向全部翻转**，桶边界与浮点同源。
 * ⚠️ 冻结契约**未被修改**。
 *
 * ## 臂
 *
 * `A0` 控制无 Runner（parity 锚点 `15.7876907121%` / 1619 笔）
 * `A`  控制有 Runner（**ABORT 门禁** `151.0958341843399%` / 1434 笔 / trigger 161）
 * `B0` 取向翻转无 Runner · `B` 取向翻转有 Runner（🔴 主臂）· `D` 翻转 + Runner 延长上限 30
 *
 * 🔴 `B ≡ 「取现行 top-3 的反向」`：`1−x` 严格单调 ⇒ 选中集合与破平顺序逐笔相同。
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
/** 控制臂冻结值（= `composite-runner-newhigh3-t74` 留档）。 */
const CONTROL_A_RETURN_PCT = 15.7876907121;
const CONTROL_A_TRADES = 1619;
const CONTROL_C_RETURN_PCT = 151.0958341843399;
const CONTROL_C_TRADES = 1434;
const CONTROL_TRIGGER = 161;
const PARITY_TOLERANCE_PCT = 1e-6;

export interface InvertedArmSpec {
  readonly id: string;
  readonly label: string;
  readonly orientation: "LOW" | "HIGH";
  readonly withRunner: boolean;
  /** Runner 延长上限覆盖；null = 沿用族默认。 */
  readonly runnerExitAtHoldingDays: number | null;
}

export const INVERTED_ARMS: readonly InvertedArmSpec[] = [
  { id: "A0", label: "控制（冻结 3F）· 无 Runner", orientation: "LOW", withRunner: false, runnerExitAtHoldingDays: null },
  { id: "A", label: "控制（冻结 3F）· 有 Runner", orientation: "LOW", withRunner: true, runnerExitAtHoldingDays: null },
  { id: "B0", label: "取向翻转（= top3 反向）· 无 Runner", orientation: "HIGH", withRunner: false, runnerExitAtHoldingDays: null },
  { id: "B", label: "**取向翻转**（= top3 反向）· 有 Runner", orientation: "HIGH", withRunner: true, runnerExitAtHoldingDays: null },
  { id: "D", label: "取向翻转 + Runner 延长上限 30", orientation: "HIGH", withRunner: true, runnerExitAtHoldingDays: 30 },
];

const armSchema = z.object({
  id: z.string(),
  label: z.string(),
  orientation: z.enum(["LOW", "HIGH"]),
  withRunner: z.boolean(),
  runnerExitAtHoldingDays: z.number().int().nullable(),
  fullCReturnPct: z.number(),
  fullCMaxDrawdownPct: z.number().nullable(),
  fullCTrades: z.number().int(),
  fullControlDeltaPct: z.number(),
  fullAReturnPct: z.number().nullable(),
  runnerTrigger: z.number().int().nullable(),
  bigWin50Count: z.number().int(),
  bigWin100Count: z.number().int(),
  winRatePct: z.number(),
  meanLossPct: z.number().nullable(),
  worstTradeReturnPct: z.number().nullable(),
  p05TradeReturnPct: z.number().nullable(),
  stopExitCount: z.number().int(),
});

export const compositeRunnerT74InvertedSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  controlParity: z.object({
    aReturnPct: z.number(),
    aTrades: z.number().int(),
    cReturnPct: z.number(),
    cTrades: z.number().int(),
    trigger: z.number().int(),
    pass: z.boolean(),
  }),
  arms: z.array(armSchema),
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

function stopExitCount(result: CompositeRunnerBacktestResult): number {
  return result.run.trades.filter((trade) => (trade.reason ?? "").includes("止损")).length;
}

export const compositeRunnerT74InvertedExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-inverted",
    name: "TAIL-SELECTION-002 · 3F 取向翻转（T74，其余冻结）",
    version: COMPUTATION_VERSION,
    description:
      "把 3F 的振幅取向从 LOW 翻成 HIGH（排序键 1 − Σ(oriented)/3 ≡ 三方向全翻），"
      + "其余（选股宽度 / 名额 / 止损 / 移动止损 / MA 止盈 / 时间退出 / strongHold / 数据集坐标）逐字段冻结；"
      + "重点回答「能不能选出更多的右尾超级股票」（主指标 = >=+50% / >=+100% 笔数）。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "composite-runner", "runner-t74", "tail-selection", "orientation-flip"],
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
      // 🔴 两个取向都声明 ⇒ 扩展面板按**并集**装载 rd17..80。
      // 只声明 control（LOW）会让翻转臂选中的事件拿不到扩展行情，Runner 延长被 rd16 截断
      // （实测交易从 1434 塌到 79，且看起来像「策略变差」）。
      extensionSelectionArms: [
        { id: "control", trendWeight: null, amplitudeOrientation: "LOW" },
        { id: "inverted", trendWeight: null, amplitudeOrientation: "HIGH" },
      ],
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-inverted",
    pageTitle: "TAIL-SELECTION-002 · 3F 取向翻转",
  },
  resultSchema: compositeRunnerT74InvertedSchema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;

    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
      state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const,
      extendToHoldingDays: 74,
    };

    interface ArmOutcome {
      id: string;
      label: string;
      orientation: "LOW" | "HIGH";
      withRunner: boolean;
      runnerExitAtHoldingDays: number | null;
      fullAReturnPct: number | null;
      fullATrades: number | null;
      fullCReturnPct: number;
      fullCTrades: number;
      fullCMaxDrawdownPct: number | null;
      runnerTrigger: number | null;
      bigWin50Count: number;
      bigWin100Count: number;
      winRatePct: number;
      meanLossPct: number | null;
      worstTradeReturnPct: number | null;
      p05TradeReturnPct: number | null;
      stopExitCount: number;
    }

    // 取向烙在**源码构造**里 ⇒ 每个取向只扫一次，臂之间复用。
    const sourceRunByOrientation = new Map<"LOW" | "HIGH", ReturnType<typeof rebuildCompositeRun>>();
    for (const orientation of ["LOW", "HIGH"] as const) {
      if (sourceRunByOrientation.has(orientation)) continue;
      context.log("[inverted] 扫描候选池 orientation=" + orientation + " …");
      const built = buildFirstLimitPullback3FTop3SourceRun({
        dataset: surface.baselineDataset,
        dateRange,
        amplitudeOrientation: orientation,
      });
      sourceRunByOrientation.set(orientation, rebuildCompositeRun(built.sourceRun, surface.executionDataset));
    }

    const resultByArm = new Map<string, CompositeRunnerBacktestResult>();
    const outcomes: ArmOutcome[] = [];
    for (const arm of INVERTED_ARMS) {
      context.log("[inverted] 臂 " + arm.id + " 开始（orientation=" + arm.orientation
        + ", runner=" + String(arm.withRunner)
        + ", runnerExit=" + String(arm.runnerExitAtHoldingDays) + "）");
      const baseInput = buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
        topN: COMPOSITE_RUNNER_TOP_N,
        datasetVersionId: EXTENSION_DATASET_VERSION_ID,
        datasetLabel: "v8",
      });
      const strongHoldOverride = arm.runnerExitAtHoldingDays === null
        ? undefined
        : { ...(baseInput.strongHold ?? {}), runnerExitAtHoldingDays: arm.runnerExitAtHoldingDays };
      const strategyDocument = buildThreeFactorTopNStrategyDocument({
        ...baseInput,
        ...(strongHoldOverride === undefined ? {} : { strongHold: strongHoldOverride as never }),
      });
      const common = {
        dataset: surface.executionDataset,
        sourceRun: sourceRunByOrientation.get(arm.orientation)!,
        strategyDocument,
        datasetVersionId: EXTENSION_DATASET_VERSION_ID,
        codeVersion: COMPUTATION_VERSION,
        createdAt: THREE_FACTOR_TOPN_CREATED_AT,
      };
      const fullC = await runCompositeRunnerBacktest({
        ...common,
        dateRange,
        name: "t74-inverted-" + arm.id + "-full-C",
        ...(arm.withRunner ? { runnerBridge } : {}),
      });
      resultByArm.set(arm.id, fullC);

      const closed = fullC.run.trades.filter(
        (trade) => trade.returnPct !== null && Number.isFinite(trade.returnPct),
      );
      const returns = closed.map((trade) => trade.returnPct ?? 0);
      const sorted = [...returns].sort((left, right) => left - right);
      const losses = sorted.filter((value) => value < 0);
      outcomes.push({
        id: arm.id,
        label: arm.label,
        orientation: arm.orientation,
        withRunner: arm.withRunner,
        runnerExitAtHoldingDays: arm.runnerExitAtHoldingDays,
        fullAReturnPct: null,
        fullATrades: null,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: null,
        bigWin50Count: sorted.filter((value) => value >= 50).length,
        bigWin100Count: sorted.filter((value) => value >= 100).length,
        winRatePct: sorted.length === 0 ? Number.NaN : (sorted.filter((v) => v > 0).length / sorted.length) * 100,
        meanLossPct: losses.length === 0 ? null : losses.reduce((a, b) => a + b, 0) / losses.length,
        worstTradeReturnPct: sorted[0] ?? null,
        p05TradeReturnPct: sorted.length === 0 ? null : sorted[Math.floor(sorted.length * 0.05)]!,
        stopExitCount: stopExitCount(fullC),
      });
    }

    // Runner 触发笔数：有/无 Runner 的同取向臂做差。
    for (const [withRunnerId, withoutRunnerId] of [["A", "A0"], ["B", "B0"]] as const) {
      const withR = resultByArm.get(withRunnerId);
      const withoutR = resultByArm.get(withoutRunnerId);
      const outcome = outcomes.find((item) => item.id === withRunnerId);
      if (withR && withoutR && outcome) outcome.runnerTrigger = runnerTriggerCount(withoutR, withR);
    }
    const controlA = outcomes.find((item) => item.id === "A0")!;
    const control = outcomes.find((item) => item.id === "A")!;

    // 🔴 ABORT 门禁（PLAN-TAIL-SELECTION-002 §4）。
    // ⚠️ 修正记录：初版误用 `controlA.fullATrades`/`fullAReturnPct`（A0 上没有这两个字段 ⇒ 恒为 null
    // ⇒ 门禁恒 false，与实测 5 项数值全部在 1e-6 内相矛盾）。A0 **本身就是**无 Runner 臂，
    // 直接取它自己的 `fullC*` 即为控制 A 口径，另跑的 `fullA` 是冗余（已删除）。
    const parityPass = Math.abs(control.fullCReturnPct - CONTROL_C_RETURN_PCT) < PARITY_TOLERANCE_PCT
      && control.fullCTrades === CONTROL_C_TRADES
      && control.runnerTrigger === CONTROL_TRIGGER
      && controlA.fullCTrades === CONTROL_A_TRADES
      && Math.abs(controlA.fullCReturnPct - CONTROL_A_RETURN_PCT) < PARITY_TOLERANCE_PCT;

    const controlParity = {
      aReturnPct: controlA.fullCReturnPct,
      aTrades: controlA.fullCTrades,
      cReturnPct: control.fullCReturnPct,
      cTrades: control.fullCTrades,
      trigger: control.runnerTrigger ?? -1,
      pass: parityPass,
    };

    const flipped = outcomes.find((item) => item.id === "B");
    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      orientation: outcome.orientation,
      withRunner: outcome.withRunner ? "有" : "无",
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      bigWin50Count: outcome.bigWin50Count,
      bigWin100Count: outcome.bigWin100Count,
      winRatePct: outcome.winRatePct,
      runnerTrigger: outcome.runnerTrigger,
      meanLossPct: outcome.meanLossPct,
      worstTradeReturnPct: outcome.worstTradeReturnPct,
      deltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
    }));

    let gate: ExperimentResultPayload["confirmatoryGate"];
    if (phase !== "EXPLORATORY" && protocolFingerprint !== null) {
      gate = {
        status: parityPass ? "OBSERVATION_READY" : "INSUFFICIENT",
        protocolFingerprint,
        sampleCount: control.fullCTrades,
        checks: [
          {
            code: "control_parity",
            label: "控制臂逐项复现 T74 冻结值",
            status: parityPass ? ("PASS" as const) : ("FAIL" as const),
            value: control.fullCReturnPct,
            threshold: CONTROL_C_RETURN_PCT,
          },
        ],
        summary: parityPass
          ? "控制臂复现 T74 冻结值，取向翻转臂的 Δ 可解读。"
          : "控制臂未能复现 T74 冻结值 ⇒ 按 PLAN §4 ABORT：不解读任何臂。",
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
          "onlyAmplitudeOrientationVaries=true",
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "inverted-arms",
          title: "只改 3F 振幅取向：收益 / 回撤 / 超级票",
          description:
            "其余全部冻结（选股宽度 3、名额 2/5、止损 6%、移动止损 8%、MA 止盈、5 日时间退出、"
            + "strongHold 5->10、Runner T74、数据集坐标）。主指标 = >=+50% / >=+100% 笔数。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "orientation", label: "取向" },
            { key: "withRunner", label: "Runner" },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "bigWin50Count", label: ">= +50% 笔数", digits: 0 },
            { key: "bigWin100Count", label: ">= +100% 笔数", digits: 0 },
            { key: "winRatePct", label: "胜率 %", digits: 2 },
            { key: "runnerTrigger", label: "Runner 触发", digits: 0 },
            { key: "meanLossPct", label: "亏损笔均值 %", digits: 3 },
            { key: "worstTradeReturnPct", label: "最差单笔 %", digits: 3 },
            { key: "fullCTrades", label: "C 成交笔数", digits: 0 },
            { key: "deltaPct", label: "Δ vs 控制 (pp)", digits: 4 },
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
        { code: "control_c_return_pct", label: "控制臂 C 收益", value: control.fullCReturnPct, unit: "%", digits: 4 },
        { code: "control_big_win_50", label: "控制臂 >=+50% 笔数", value: control.bigWin50Count, unit: "笔", digits: 0 },
        { code: "flipped_big_win_50", label: "翻转臂 >=+50% 笔数", value: flipped?.bigWin50Count ?? null, unit: "笔", digits: 0 },
        { code: "flipped_return_pct", label: "翻转臂收益", value: flipped?.fullCReturnPct ?? null, unit: "%", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          ...outcome,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
        })),
        note:
          "只改 3F 振幅取向（1 − Σ(oriented)/3 ≡ 三方向全翻；冻结契约未改）。"
          + "取向烙在源码构造层（compositeRunner 不读文档排序特征）。逐笔统计基于已实现交易（returnPct，含成本）。",
      },
    };
  },
};
