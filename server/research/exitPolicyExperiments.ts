import type {
  ExitPolicyDefinition,
  CapitalRecyclePolicyDefinition,
  StrongHoldPolicyDefinition,
} from "./exitPolicyCommon";
import type {
  StopAnchorDefinition,
  StopEscalationDefinition,
  StopPolicyDefinition,
  StopReductionDefinition,
  StopScheduleDefinition,
} from "./stopPolicy";
import type { ResearchTrailingPolicyDefinition } from "./trailingPolicy";

const MA_TAKE_PROFIT: ResearchTrailingPolicyDefinition = {
  kind: "MA_CROSS",
  fastWindow: 5,
  slowWindow: 10,
  activationRatio: 0,
};

const BASE_STRONG_HOLD: StrongHoldPolicyDefinition = {
  atHoldingDays: 5,
  minReturnRatio: 0.03,
  requireAboveMa5: true,
  requireAboveMa10: true,
  extendToHoldingDays: 10,
  afterExtendedHold: "TIME_EXIT",
};

function fixedAnchor(stopRatio: number): StopAnchorDefinition {
  return { kind: "FIXED_PERCENT", stopRatio };
}

function policy(input: {
  readonly anchor: StopAnchorDefinition;
  readonly confirmation?: StopPolicyDefinition["confirmation"];
  readonly disasterStopRatio?: number;
  readonly escalation?: StopEscalationDefinition;
  readonly schedule?: StopScheduleDefinition;
  readonly reduction?: StopReductionDefinition;
  readonly contexts?: StopPolicyDefinition["contexts"];
}): ExitPolicyDefinition {
  return {
    stop: {
      anchor: input.anchor,
      confirmation: input.confirmation ?? "INTRADAY",
      ...(input.disasterStopRatio === undefined
        ? {}
        : { disasterStopRatio: input.disasterStopRatio }),
      ...(input.escalation === undefined ? {} : { escalation: input.escalation }),
      ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
      ...(input.reduction === undefined ? {} : { reduction: input.reduction }),
      ...(input.contexts === undefined ? {} : { contexts: input.contexts }),
    },
    takeProfit: MA_TAKE_PROFIT,
    timeExit: { kind: "FIXED_HOLDING_DAYS", holdingDays: 5 },
    strongHold: BASE_STRONG_HOLD,
    capitalRecycle: null,
  };
}

export interface ExitPolicyExperimentDefinition {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly policy: ExitPolicyDefinition;
}

export const STOP_POLICY_EXPERIMENTS: Readonly<Record<string, ExitPolicyExperimentDefinition>> = {
  "SL-00": {
    id: "SL-00",
    version: "1.27.2",
    name: "fixed-6-intraday-control",
    policy: policy({ anchor: fixedAnchor(0.06) }),
  },
  "SL-01.0": {
    id: "SL-01.0",
    version: "1.28.0",
    name: "fixed-4-intraday",
    policy: policy({ anchor: fixedAnchor(0.04) }),
  },
  "SL-01.1": {
    id: "SL-01.1",
    version: "1.28.1",
    name: "fixed-5-intraday",
    policy: policy({ anchor: fixedAnchor(0.05) }),
  },
  "SL-01.2": {
    id: "SL-01.2",
    version: "1.28.2",
    name: "fixed-7-intraday",
    policy: policy({ anchor: fixedAnchor(0.07) }),
  },
  "SL-01.3": {
    id: "SL-01.3",
    version: "1.28.3",
    name: "fixed-8-intraday",
    policy: policy({ anchor: fixedAnchor(0.08) }),
  },
  "SL-02.0": {
    id: "SL-02.0",
    version: "1.29.0",
    name: "atr-1p25-clamp-4-10",
    policy: policy({
      anchor: {
        kind: "ATR",
        atrWindow: 10,
        atrMultiplier: 1.25,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-02.1": {
    id: "SL-02.1",
    version: "1.29.1",
    name: "atr-1p50-clamp-4-10",
    policy: policy({
      anchor: {
        kind: "ATR",
        atrWindow: 10,
        atrMultiplier: 1.5,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-02.2": {
    id: "SL-02.2",
    version: "1.29.2",
    name: "atr-2p00-clamp-4-10",
    policy: policy({
      anchor: {
        kind: "ATR",
        atrWindow: 10,
        atrMultiplier: 2,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-03.0": {
    id: "SL-03.0",
    version: "1.30.0",
    name: "observation-low-no-buffer",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "OBSERVATION_WINDOW",
        bufferAtrMultiplier: 0,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-03.1": {
    id: "SL-03.1",
    version: "1.30.1",
    name: "observation-low-buffer-025atr",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "OBSERVATION_WINDOW",
        bufferAtrMultiplier: 0.25,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-03.2": {
    id: "SL-03.2",
    version: "1.30.2",
    name: "observation-low-buffer-050atr",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "OBSERVATION_WINDOW",
        bufferAtrMultiplier: 0.5,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-04.0": {
    id: "SL-04.0",
    version: "1.31.0",
    name: "event-day-close-structure",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "EVENT_DAY_CLOSE",
        bufferAtrMultiplier: 0,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-04.1": {
    id: "SL-04.1",
    version: "1.31.1",
    name: "event-day-low-structure",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "EVENT_DAY_LOW",
        bufferAtrMultiplier: 0,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-04.2": {
    id: "SL-04.2",
    version: "1.31.2",
    name: "event-day-low-buffer",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "EVENT_DAY_LOW",
        bufferAtrMultiplier: 0.25,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-05.0": {
    id: "SL-05.0",
    version: "1.32.0",
    name: "rolling-low-3",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "ROLLING_LOW",
        lookbackDays: 3,
        bufferAtrMultiplier: 0,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-05.1": {
    id: "SL-05.1",
    version: "1.32.1",
    name: "rolling-low-5",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "ROLLING_LOW",
        lookbackDays: 5,
        bufferAtrMultiplier: 0,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-06.0": {
    id: "SL-06.0",
    version: "1.33.0",
    name: "event-range-50",
    policy: policy({
      anchor: {
        kind: "RANGE_FRACTION",
        fraction: 0.5,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-06.1": {
    id: "SL-06.1",
    version: "1.33.1",
    name: "event-range-75",
    policy: policy({
      anchor: {
        kind: "RANGE_FRACTION",
        fraction: 0.75,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-06.2": {
    id: "SL-06.2",
    version: "1.33.2",
    name: "event-range-100",
    policy: policy({
      anchor: {
        kind: "RANGE_FRACTION",
        fraction: 1,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-07.0": {
    id: "SL-07.0",
    version: "1.34.0",
    name: "atr-percentile-70",
    policy: policy({
      anchor: {
        kind: "ATR_PERCENTILE",
        atrWindow: 10,
        percentile: 0.7,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-07.1": {
    id: "SL-07.1",
    version: "1.34.1",
    name: "atr-percentile-90",
    policy: policy({
      anchor: {
        kind: "ATR_PERCENTILE",
        atrWindow: 10,
        percentile: 0.9,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
    }),
  },
  "SL-08.0": {
    id: "SL-08.0",
    version: "1.27.3",
    name: "fixed-6-intraday-explicit",
    policy: policy({ anchor: fixedAnchor(0.06) }),
  },
  "SL-09.0": {
    id: "SL-09.0",
    version: "1.35.0",
    name: "fixed-6-close-confirm",
    policy: policy({ anchor: fixedAnchor(0.06), confirmation: "ON_CLOSE" }),
  },
  "SL-10.0": {
    id: "SL-10.0",
    version: "1.36.0",
    name: "fixed-6-two-closes",
    policy: policy({ anchor: fixedAnchor(0.06), confirmation: "TWO_CLOSES" }),
  },
  "SL-11.0": {
    id: "SL-11.0",
    version: "1.37.0",
    name: "disaster-9-close-6",
    policy: policy({
      anchor: fixedAnchor(0.06),
      confirmation: "DISASTER_PLUS_CLOSE",
      disasterStopRatio: 0.09,
    }),
  },
  "SL-12.0": {
    id: "SL-12.0",
    version: "1.38.0",
    name: "limit-down-reconfirm",
    policy: policy({
      anchor: fixedAnchor(0.06),
      confirmation: "LIMIT_DOWN_RECONFIRM",
    }),
  },
  "SL-13.0": {
    id: "SL-13.0",
    version: "1.39.0",
    name: "break-even-after-3pct",
    policy: policy({
      anchor: fixedAnchor(0.06),
      escalation: {
        kind: "BREAK_EVEN",
        activationRatio: 0.03,
        stopRatio: 0,
      },
    }),
  },
  "SL-14.0": {
    id: "SL-14.0",
    version: "1.40.0",
    name: "profit-ladder",
    policy: policy({
      anchor: fixedAnchor(0.06),
      escalation: {
        kind: "LADDER",
        steps: [
          { activationRatio: 0.03, stopRatio: 0 },
          { activationRatio: 0.06, stopRatio: 0.02 },
          { activationRatio: 0.1, stopRatio: 0.05 },
        ],
      },
    }),
  },
  "SL-15.0": {
    id: "SL-15.0",
    version: "1.41.0",
    name: "r-multiple-lock",
    policy: policy({
      anchor: fixedAnchor(0.06),
      escalation: {
        kind: "R_MULTIPLE",
        rRatio: 0.06,
        steps: [
          { triggerR: 2, lockR: 1 },
          { triggerR: 3, lockR: 2 },
        ],
      },
    }),
  },
  "SL-16.0": {
    id: "SL-16.0",
    version: "1.42.0",
    name: "chandelier-2p5atr",
    policy: policy({
      anchor: fixedAnchor(0.06),
      escalation: { kind: "CHANDELIER", atrWindow: 10, atrMultiplier: 2.5 },
    }),
  },
  "SL-17.0": {
    id: "SL-17.0",
    version: "1.43.0",
    name: "ma10-atr-band",
    policy: policy({
      anchor: fixedAnchor(0.06),
      escalation: {
        kind: "MA_BAND",
        maWindow: 10,
        atrWindow: 10,
        atrMultiplier: 0.5,
      },
    }),
  },
  "SL-18.0": {
    id: "SL-18.0",
    version: "1.44.0",
    name: "peak-drawdown-6",
    policy: policy({
      anchor: fixedAnchor(0.06),
      escalation: {
        kind: "PEAK_DRAWDOWN",
        activationRatio: 0.03,
        drawdownRatio: 0.06,
      },
    }),
  },
  "SL-18.1": {
    id: "SL-18.1",
    version: "1.44.1",
    name: "peak-drawdown-8",
    policy: policy({
      anchor: fixedAnchor(0.06),
      escalation: {
        kind: "PEAK_DRAWDOWN",
        activationRatio: 0.03,
        drawdownRatio: 0.08,
      },
    }),
  },
  "SL-18.2": {
    id: "SL-18.2",
    version: "1.44.2",
    name: "peak-drawdown-10",
    policy: policy({
      anchor: fixedAnchor(0.06),
      escalation: {
        kind: "PEAK_DRAWDOWN",
        activationRatio: 0.03,
        drawdownRatio: 0.1,
      },
    }),
  },
  "SL-19.0": {
    id: "SL-19.0",
    version: "1.45.0",
    name: "wide-first-two-days",
    policy: policy({
      anchor: fixedAnchor(0.06),
      schedule: {
        phases: [
          { fromHoldingDay: 1, toHoldingDay: 2, stopRatio: 0.08 },
          { fromHoldingDay: 3, toHoldingDay: 999, stopRatio: 0.06 },
        ],
      },
    }),
  },
  "SL-20.0": {
    id: "SL-20.0",
    version: "1.46.0",
    name: "time-decay-stop",
    policy: policy({
      anchor: fixedAnchor(0.06),
      schedule: {
        phases: [
          { fromHoldingDay: 1, toHoldingDay: 2, stopRatio: 0.08 },
          { fromHoldingDay: 3, toHoldingDay: 5, stopRatio: 0.06 },
          { fromHoldingDay: 6, toHoldingDay: 999, stopRatio: 0.05 },
        ],
      },
    }),
  },
  "SL-21.0": {
    id: "SL-21.0",
    version: "1.47.0",
    name: "time-decay-break-even",
    policy: policy({
      anchor: fixedAnchor(0.06),
      schedule: {
        phases: [
          { fromHoldingDay: 1, toHoldingDay: 2, stopRatio: 0.08 },
          { fromHoldingDay: 3, toHoldingDay: 5, stopRatio: 0.06 },
          { fromHoldingDay: 6, toHoldingDay: 999, stopRatio: 0.05 },
        ],
      },
      escalation: {
        kind: "BREAK_EVEN",
        activationRatio: 0.03,
        stopRatio: 0,
      },
    }),
  },
  "SL-22.0": {
    id: "SL-22.0",
    version: "1.48.0",
    name: "wide-first-day",
    policy: policy({
      anchor: fixedAnchor(0.06),
      schedule: {
        phases: [
          { fromHoldingDay: 1, toHoldingDay: 1, stopRatio: 0.1 },
          { fromHoldingDay: 2, toHoldingDay: 999, stopRatio: 0.06 },
        ],
      },
    }),
  },
  "SL-23.0": {
    id: "SL-23.0",
    version: "1.49.0",
    name: "partial-stop-3-6",
    policy: policy({
      anchor: fixedAnchor(0.06),
      reduction: {
        steps: [
          { triggerRatio: -0.03, sellRatio: 0.5 },
          { triggerRatio: -0.06, sellRatio: 1 },
        ],
      },
    }),
  },
  "SL-24.0": {
    id: "SL-24.0",
    version: "1.50.0",
    name: "structure-partial-stop",
    policy: policy({
      anchor: {
        kind: "STRUCTURE_LOW",
        source: "OBSERVATION_WINDOW",
        bufferAtrMultiplier: 0.25,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
      reduction: {
        steps: [
          { triggerRatio: -0.03, sellRatio: 0.5 },
          { triggerRatio: -0.06, sellRatio: 1 },
        ],
      },
    }),
  },
  "SL-25.0": {
    id: "SL-25.0",
    version: "1.51.0",
    name: "atr-partial-stop",
    policy: policy({
      anchor: {
        kind: "ATR",
        atrWindow: 10,
        atrMultiplier: 1.5,
        minStopRatio: 0.04,
        maxStopRatio: 0.1,
      },
      reduction: {
        steps: [
          { triggerRatio: -0.04, sellRatio: 0.5 },
          { triggerRatio: -0.1, sellRatio: 1 },
        ],
      },
    }),
  },
  "SL-26.0": {
    id: "SL-26.0",
    version: "1.52.0",
    name: "market-regime-stop",
    policy: policy({
      anchor: fixedAnchor(0.06),
      contexts: [{ kind: "MARKET", tightenToRatio: 0.04 }],
    }),
  },
  "SL-27.0": {
    id: "SL-27.0",
    version: "1.53.0",
    name: "sector-regime-stop",
    policy: policy({
      anchor: fixedAnchor(0.06),
      contexts: [{ kind: "SECTOR", tightenToRatio: 0.04 }],
    }),
  },
  "SL-28.0": {
    id: "SL-28.0",
    version: "1.54.0",
    name: "leader-regime-stop",
    policy: policy({
      anchor: fixedAnchor(0.06),
      contexts: [{ kind: "LEADER", tightenToRatio: 0.04 }],
    }),
  },
  "SL-29.0": {
    id: "SL-29.0",
    version: "1.55.0",
    name: "portfolio-drawdown-stop",
    policy: policy({
      anchor: fixedAnchor(0.06),
      contexts: [{ kind: "PORTFOLIO_DRAWDOWN", tightenToRatio: 0.04 }],
    }),
  },
  "SL-30.0": {
    id: "SL-30.0",
    version: "1.56.0",
    name: "loss-streak-cooldown",
    policy: policy({
      anchor: fixedAnchor(0.06),
      contexts: [{ kind: "LOSS_STREAK", consecutiveLosses: 3 }],
    }),
  },
};

export function getExitPolicyExperiment(
  id: string,
): ExitPolicyExperimentDefinition {
  const experiment = STOP_POLICY_EXPERIMENTS[id];
  if (experiment === undefined) {
    throw new Error(
      `未知退出策略实验 ${id}；可选：${Object.keys(STOP_POLICY_EXPERIMENTS).join(", ")}`,
    );
  }
  return experiment;
}
