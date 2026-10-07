/**
 * P9 · T74 事件事实 gate（不重排 3F）。
 *
 * 在 original top3 之上，只对“是否新开仓”做 gate：
 *   - daysSincePreviousLimit：距离上次涨停天数，越低越好；
 *   - turnover：首板日成交额，越低越好；
 *   - historicalLimitCount：历史涨停次数，弱正向探索。
 *
 * 阈值只用 2019-01-02..2024-12-31 训练段计算；OOS 不重估。
 * 只过滤 intent，不把 rank4/5 补进来，不改退出链 / Runner / 仓位。
 */
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  applyCompositeEventGate,
  buildFirstLimitPullback3FTop3SourceRun,
  buildThreeFactorTopNFamilyArmInput,
  buildThreeFactorTopNStrategyDocument,
  rebuildCompositeRun,
  runCompositeRunnerBacktest,
  THREE_FACTOR_TOPN_CREATED_AT,
  type CompositeEventMetadata,
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
const TRAIN_END = "2024-12-31";

type FeatureKey = "daysSincePreviousLimit" | "turnover" | "historicalLimitCount";
type Direction = "low" | "high";

export interface EventGateArmSpec {
  readonly id: string;
  readonly label: string;
  readonly gates: readonly { readonly feature: FeatureKey; readonly direction: Direction; readonly quantile: number }[];
}

export const EVENT_GATE_ARMS: readonly EventGateArmSpec[] = [
  { id: "control", label: "控制臂 · 无 gate", gates: [] },
  { id: "gap-p50", label: "距上次涨停 <= 训练 p50", gates: [{ feature: "daysSincePreviousLimit", direction: "low", quantile: 0.5 }] },
  { id: "gap-p33", label: "距上次涨停 <= 训练 p33", gates: [{ feature: "daysSincePreviousLimit", direction: "low", quantile: 0.33 }] },
  { id: "turnover-p50", label: "首板成交额 <= 训练 p50", gates: [{ feature: "turnover", direction: "low", quantile: 0.5 }] },
  { id: "combo-p50", label: "gap + turnover 均 <= 训练 p50", gates: [
    { feature: "daysSincePreviousLimit", direction: "low", quantile: 0.5 },
    { feature: "turnover", direction: "low", quantile: 0.5 },
  ] },
  { id: "histlimit-p67", label: "历史涨停次数 >= 训练 p67", gates: [{ feature: "historicalLimitCount", direction: "high", quantile: 0.67 }] },
];

const outcomeSchema = z.object({
  id: z.string(),
  label: z.string(),
  gates: z.string(),
  fullCReturnPct: z.number(),
  fullCMaxDrawdownPct: z.number().nullable(),
  fullCTrades: z.number().int(),
  fullControlDeltaPct: z.number(),
  fullAReturnPct: z.number().nullable(),
  runnerTrigger: z.number().int().nullable(),
  bigWin50Count: z.number().int(),
  bigWin100Count: z.number().int(),
  gateInputIntents: z.number().int(),
  gateKeptIntents: z.number().int(),
  gateRemovedIntents: z.number().int(),
  gateDaysWithRemoval: z.number().int(),
});

export const compositeRunnerT74EventGateSchema = z.object({
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

function eventIdOf(securityId: string): string {
  const marker = "::event:";
  const index = securityId.indexOf(marker);
  return index < 0 ? securityId : securityId.slice(index + marker.length);
}

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index]!;
}

function featureValue(metadata: CompositeEventMetadata | undefined, feature: FeatureKey): number | null {
  if (metadata === undefined) return null;
  const value = metadata[feature];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function gateLabel(gates: EventGateArmSpec["gates"]): string {
  return gates.length === 0
    ? "none"
    : gates.map((gate) => gate.feature + " " + gate.direction + " q" + gate.quantile.toFixed(2)).join(" & ");
}

interface ArmOutcome {
  id: string;
  label: string;
  gates: string;
  fullAReturnPct: number | null;
  fullATrades: number | null;
  fullCReturnPct: number;
  fullCTrades: number;
  fullCMaxDrawdownPct: number | null;
  runnerTrigger: number | null;
  bigWin50Count: number;
  bigWin100Count: number;
  gateInputIntents: number;
  gateKeptIntents: number;
  gateRemovedIntents: number;
  gateDaysWithRemoval: number;
}

export const compositeRunnerT74EventGateExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/composite-runner-newhigh3-t74-event-gate",
    name: "P9 · T74 事件事实 gate（不重排 3F）",
    version: COMPUTATION_VERSION,
    description:
      "在 original top3 不变的前提下，用 2019-2024 训练段的 daysSincePreviousLimit / turnover / historicalLimitCount 分布做新开仓 gate；"
      + "不补 rank4/5、不改 3F 排序、不改退出链、Runner T74、仓位与数据坐标。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "composite-runner", "runner-t74", "event-gate", "p9"],
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
      includeEventMetadata: true,
      extensionSelectionArms: [
        { id: "control", trendWeight: null, topN: 3 },
      ],
    },
    pageKey: "first-board-pullback/composite-runner-newhigh3-t74-event-gate",
    pageTitle: "P9 · T74 事件事实 gate（不重排 3F）",
  },
  resultSchema: compositeRunnerT74EventGateSchema,
  async run(context): Promise<ExperimentResultPayload> {
    const surface = context.composite as CompositeExecutionSurfacePayload | undefined;
    if (surface === undefined) {
      throw new Error("context.composite 缺失（executionSurface=COMPOSITE_PORTFOLIO 未注入）");
    }
    const dateRange = surface.dateRange;
    const phase = context.protocol?.phase ?? "EXPLORATORY";
    const protocolFingerprint = context.protocol?.protocolFingerprint ?? null;
    const metadataByEventId = new Map(surface.eventMetadata.map((metadata) => [metadata.eventId, metadata]));
    const base = buildFirstLimitPullback3FTop3SourceRun({
      dataset: surface.baselineDataset,
      dateRange,
      topN: 3,
    });

    const trainingValues = new Map<FeatureKey, number[]>();
    for (const feature of ["daysSincePreviousLimit", "turnover", "historicalLimitCount"] as const) {
      trainingValues.set(feature, []);
    }
    for (const day of base.sourceRun.days) {
      if (day.date > TRAIN_END) continue;
      for (const intent of day.positionIntents) {
        const metadata = metadataByEventId.get(eventIdOf(intent.securityId));
        for (const feature of trainingValues.keys()) {
          const value = featureValue(metadata, feature);
          if (value !== null) trainingValues.get(feature)!.push(value);
        }
      }
    }

    const runnerBridge = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
      state: "NEW_HIGH_3" as const,
      decisionHoldingDays: 5 as const,
      extendToHoldingDays: 74,
    };

    const outcomes: ArmOutcome[] = [];
    for (const arm of EVENT_GATE_ARMS) {
      context.log("[event-gate] 臂 " + arm.id + " 开始");
      const thresholds = new Map<FeatureKey, number>();
      for (const gate of arm.gates) {
        const threshold = quantile(trainingValues.get(gate.feature) ?? [], gate.quantile);
        if (threshold === null) throw new Error("event-gate: 训练段没有 " + gate.feature + " 阈值");
        thresholds.set(gate.feature, threshold);
      }
      const gated = arm.gates.length === 0
        ? base
        : applyCompositeEventGate(base, {
            version: "event-fact-gate-v1.0.0",
            label: gateLabel(arm.gates),
            keepOf: (securityId) => {
              const metadata = metadataByEventId.get(eventIdOf(securityId));
              return arm.gates.every((gate) => {
                const value = featureValue(metadata, gate.feature);
                if (value === null) return false;
                const threshold = thresholds.get(gate.feature)!;
                return gate.direction === "low" ? value <= threshold : value >= threshold;
              });
            },
          });
      const sourceRun = rebuildCompositeRun(gated.sourceRun, surface.executionDataset);
      const strategyDocument = buildThreeFactorTopNStrategyDocument({
        ...buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
          topN: 3,
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
        name: "t74-event-gate-" + arm.id + "-full-C",
        runnerBridge,
      });
      const fullA = arm.id === "control"
        ? await runCompositeRunnerBacktest({ ...common, dateRange, name: "t74-event-gate-control-full-A" })
        : null;
      const closed = fullC.run.trades.filter(
        (trade) => trade.returnPct !== null && Number.isFinite(trade.returnPct),
      );
      const accounting = gated.eventGateAccounting ?? {
        inputIntents: 0,
        keptIntents: 0,
        removedIntents: 0,
        daysWithRemoval: 0,
      };
      outcomes.push({
        id: arm.id,
        label: arm.label,
        gates: gateLabel(arm.gates),
        fullAReturnPct: fullA === null ? null : returnPct(fullA.run),
        fullATrades: fullA === null ? null : fullA.run.trades.length,
        fullCReturnPct: returnPct(fullC.run),
        fullCTrades: fullC.run.trades.length,
        fullCMaxDrawdownPct: maxDrawdownPct(fullC.run.equityCurve),
        runnerTrigger: fullA === null ? null : runnerTriggerCount(fullA, fullC),
        bigWin50Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 50).length,
        bigWin100Count: closed.filter((trade) => (trade.returnPct ?? 0) >= 100).length,
        gateInputIntents: accounting.inputIntents,
        gateKeptIntents: accounting.keptIntents,
        gateRemovedIntents: accounting.removedIntents,
        gateDaysWithRemoval: accounting.daysWithRemoval,
      });
      const latest = outcomes[outcomes.length - 1]!;
      context.log(
        "[event-gate] 臂 " + arm.id + " 完成：C 收益=" + returnPct(fullC.run).toFixed(4) + "%"
          + " MaxDD=" + (maxDrawdownPct(fullC.run.equityCurve) ?? Number.NaN).toFixed(4) + "%"
          + " 成交=" + String(fullC.run.trades.length)
          + " >=+50%=" + String(latest.bigWin50Count),
      );
    }

    const control = outcomes[0]!;
    const parityPass =
      control.gates === "none"
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

    const gatedArms = outcomes.filter((outcome) => outcome.id !== "control");
    const bestByBigWin = gatedArms.reduce<ArmOutcome | null>(
      (best, arm) => best === null || arm.bigWin50Count > best.bigWin50Count ? arm : best,
      null,
    );
    const bestByReturn = gatedArms.reduce<ArmOutcome | null>(
      (best, arm) => best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best,
      null,
    );
    const bestByDd = gatedArms.reduce<ArmOutcome | null>(
      (best, arm) => best === null
        || (arm.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY) < (best.fullCMaxDrawdownPct ?? Number.POSITIVE_INFINITY)
        ? arm
        : best,
      null,
    );

    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      gates: outcome.gates,
      fullCReturnPct: outcome.fullCReturnPct,
      fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
      fullCTrades: outcome.fullCTrades,
      bigWin50Count: outcome.bigWin50Count,
      bigWin100Count: outcome.bigWin100Count,
      gateRemovedIntents: outcome.gateRemovedIntents,
      gateKeptIntents: outcome.gateKeptIntents,
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
          label: "至少一条事件 gate 臂的 >= +50% 笔数多于控制臂",
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
            summary: parityPass ? "控制臂逐项复现 T74 冻结值，可进入 HOLDOUT。" : "控制臂未能复现 T74 冻结值。",
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
            summary: "HOLDOUT：要求 parity 通过、事件 gate 抓到更多 >= +50% 交易，且最好收益不低于控制臂。",
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
          "eventMetadataRows=" + String(surface.eventMetadata.length),
          "trainingEnd=" + TRAIN_END,
        ],
      },
      ...(gate !== undefined ? { confirmatoryGate: gate } : {}),
      tables: [
        {
          key: "event-gate-arms",
          title: "事件事实 gate：收益 / 回撤 / 过滤量",
          description: "只过滤 original top3 intent；不补 rank4/5、不改排序。阈值 = 训练段固定分位。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "gates", label: "gate" },
            { key: "fullCReturnPct", label: "C 收益 %", digits: 4 },
            { key: "fullCMaxDrawdownPct", label: "C 最大回撤 %", digits: 4 },
            { key: "bigWin50Count", label: ">= +50% 笔数", digits: 0 },
            { key: "bigWin100Count", label: ">= +100% 笔数", digits: 0 },
            { key: "gateRemovedIntents", label: "过滤 intent", digits: 0 },
            { key: "gateKeptIntents", label: "保留 intent", digits: 0 },
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
        { code: "best_big_win50", label: "gate 臂最多 >= +50% 笔数", value: bestByBigWin?.bigWin50Count ?? null, digits: 0 },
        { code: "best_return_pct", label: "gate 臂最高收益", value: bestByReturn?.fullCReturnPct ?? null, unit: "%", digits: 4 },
        { code: "best_dd_pct", label: "gate 臂最低回撤", value: bestByDd?.fullCMaxDrawdownPct ?? null, unit: "%", digits: 4 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        controlParity,
        arms: outcomes.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
          gates: outcome.gates,
          fullCReturnPct: outcome.fullCReturnPct,
          fullCTrades: outcome.fullCTrades,
          fullCMaxDrawdownPct: outcome.fullCMaxDrawdownPct,
          fullControlDeltaPct: outcome.fullCReturnPct - control.fullCReturnPct,
          fullAReturnPct: outcome.fullAReturnPct,
          runnerTrigger: outcome.runnerTrigger,
          bigWin50Count: outcome.bigWin50Count,
          bigWin100Count: outcome.bigWin100Count,
          gateInputIntents: outcome.gateInputIntents,
          gateKeptIntents: outcome.gateKeptIntents,
          gateRemovedIntents: outcome.gateRemovedIntents,
          gateDaysWithRemoval: outcome.gateDaysWithRemoval,
        })),
        note: "P9 只做事件事实 gate；阈值固定自 2019-2024，缺失事实按不通过处理，不插补。",
      },
    };
  },
};
