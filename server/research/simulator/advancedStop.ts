import type {
  StopAnchorDefinition,
  StopEscalationDefinition,
  StopPolicyDefinition,
} from "../stopPolicy";
import {
  atrAt,
  movingAverageAt,
  type TrailingPriceHistory,
} from "./advancedTrailing";

export interface AdvancedStopState {
  readonly confirmationCount: number;
}

export interface AdvancedStopEvaluationInput {
  readonly policy: StopPolicyDefinition;
  readonly date: string;
  readonly phase: "INTRADAY" | "CLOSE";
  readonly close: number;
  readonly high: number | null;
  readonly low: number | null;
  readonly entryPrice: number;
  readonly holdingDays: number;
  readonly peakClosePrice: number;
  readonly history: TrailingPriceHistory | undefined;
  readonly state?: AdvancedStopState;
  readonly contextTightenRatio?: number | null;
}

export interface AdvancedStopEvaluation {
  readonly triggered: boolean;
  readonly line: number | null;
  readonly reason: string | null;
  readonly sellRatio: number;
  readonly state: AdvancedStopState;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function historyIndexAt(history: TrailingPriceHistory, date: string): number {
  let low = 0;
  let high = history.dates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (history.dates[middle]! < date) low = middle + 1;
    else high = middle;
  }
  return low < history.dates.length && history.dates[low] === date ? low : -1;
}

function minLow(
  history: TrailingPriceHistory,
  start: number,
  endExclusive: number,
): number | null {
  let result = Number.POSITIVE_INFINITY;
  for (let index = start; index < endExclusive; index += 1) {
    const low = history.lows[index];
    if (!finite(low)) return null;
    result = Math.min(result, low);
  }
  return Number.isFinite(result) ? result : null;
}

function atrPercentileAtEntry(
  history: TrailingPriceHistory,
  date: string,
  atrWindow: number,
  percentile: number,
): number | null {
  const index = historyIndexAt(history, date);
  if (index <= atrWindow) return null;
  const values: number[] = [];
  for (let cursor = atrWindow; cursor <= index; cursor += 1) {
    const high = history.highs[cursor];
    const low = history.lows[cursor];
    const previousClose = history.closes[cursor - 1];
    if (!finite(high) || !finite(low) || !finite(previousClose) || previousClose <= 0) continue;
    values.push(
      Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose))
      / previousClose,
    );
  }
  if (values.length === 0) return null;
  values.sort((left, right) => left - right);
  const position = clamp(percentile, 0, 1) * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper
    ? values[lower]!
    : values[lower]! + (values[upper]! - values[lower]!) * (position - lower);
}

function anchorDistanceRatio(
  anchor: StopAnchorDefinition,
  input: AdvancedStopEvaluationInput,
): number | null {
  if (anchor.kind === "FIXED_PERCENT") return anchor.stopRatio;
  if (anchor.kind === "ATR") {
    const atr = atrAt(input.history, input.date, anchor.atrWindow);
    if (atr === null || input.entryPrice <= 0) return null;
    return clamp(
      (anchor.atrMultiplier * atr) / input.entryPrice,
      anchor.minStopRatio,
      anchor.maxStopRatio,
    );
  }
  if (anchor.kind === "RANGE_FRACTION") {
    if (input.history === undefined) return null;
    const eventHigh = input.history.highs[0];
    const eventLow = input.history.lows[0];
    if (!finite(eventHigh) || !finite(eventLow) || input.entryPrice <= 0) return null;
    return clamp(
      ((eventHigh - eventLow) * anchor.fraction) / input.entryPrice,
      anchor.minStopRatio,
      anchor.maxStopRatio,
    );
  }
  if (anchor.kind === "ATR_PERCENTILE") {
    const ratio = atrPercentileAtEntry(
      input.history!,
      input.date,
      anchor.atrWindow,
      anchor.percentile,
    );
    return ratio === null
      ? null
      : clamp(ratio, anchor.minStopRatio, anchor.maxStopRatio);
  }

  if (input.history === undefined) return null;
  const index = historyIndexAt(input.history, input.date);
  if (index < 0) return null;
  let support: number | null = null;
  if (anchor.source === "EVENT_DAY_CLOSE") {
    support = input.history.closes[0] ?? null;
  } else if (anchor.source === "EVENT_DAY_LOW") {
    support = input.history.lows[0] ?? null;
  } else if (anchor.source === "OBSERVATION_WINDOW") {
    support = minLow(input.history, 1, Math.min(5, index));
  } else {
    support = minLow(
      input.history,
      Math.max(0, index - anchor.lookbackDays!),
      index,
    );
  }
  if (!finite(support) || input.entryPrice <= 0) return null;
  const atr = atrAt(input.history, input.date, 10) ?? 0;
  const stopPrice = support - anchor.bufferAtrMultiplier * atr;
  return clamp(
    (input.entryPrice - stopPrice) / input.entryPrice,
    anchor.minStopRatio,
    anchor.maxStopRatio,
  );
}

function applyEscalation(
  currentLine: number,
  escalation: StopEscalationDefinition,
  input: AdvancedStopEvaluationInput,
): number {
  const peakReturnRatio = input.peakClosePrice / input.entryPrice - 1;
  if (escalation.kind === "BREAK_EVEN") {
    if (peakReturnRatio < escalation.activationRatio) return currentLine;
    return Math.max(currentLine, input.entryPrice * (1 + escalation.stopRatio));
  }
  if (escalation.kind === "LADDER") {
    let line = currentLine;
    for (const step of escalation.steps) {
      if (peakReturnRatio >= step.activationRatio) {
        line = Math.max(line, input.entryPrice * (1 + step.stopRatio));
      }
    }
    return line;
  }
  if (escalation.kind === "R_MULTIPLE") {
    let line = currentLine;
    for (const step of escalation.steps) {
      if (peakReturnRatio >= step.triggerR * escalation.rRatio) {
        line = Math.max(
          line,
          input.entryPrice * (1 + step.lockR * escalation.rRatio),
        );
      }
    }
    return line;
  }
  if (escalation.kind === "CHANDELIER") {
    const atr = atrAt(input.history, input.date, escalation.atrWindow);
    return atr === null
      ? currentLine
      : Math.max(
          currentLine,
          input.peakClosePrice - escalation.atrMultiplier * atr,
        );
  }
  if (escalation.kind === "MA_BAND") {
    const ma = movingAverageAt(input.history, input.date, escalation.maWindow);
    const atr = atrAt(input.history, input.date, escalation.atrWindow);
    if (ma === null || atr === null) return currentLine;
    return Math.max(currentLine, ma - escalation.atrMultiplier * atr);
  }
  if (peakReturnRatio < escalation.activationRatio) return currentLine;
  return Math.max(
    currentLine,
    input.peakClosePrice * (1 - escalation.drawdownRatio),
  );
}

function scheduledDistance(
  policy: StopPolicyDefinition,
  holdingDays: number,
): number | null {
  if (policy.schedule === null || policy.schedule === undefined) return null;
  for (const phase of policy.schedule.phases) {
    if (holdingDays >= phase.fromHoldingDay && holdingDays <= phase.toHoldingDay) {
      return phase.stopRatio;
    }
  }
  const last = policy.schedule.phases[policy.schedule.phases.length - 1];
  return last === undefined ? null : last.stopRatio;
}

function reductionSellRatio(
  policy: StopPolicyDefinition,
  ratio: number,
): number {
  let sellRatio = 0;
  for (const step of policy.reduction?.steps ?? []) {
    if (ratio <= step.triggerRatio) sellRatio = Math.max(sellRatio, step.sellRatio);
  }
  return sellRatio;
}

function confirmationTriggered(
  policy: StopPolicyDefinition,
  input: AdvancedStopEvaluationInput,
  line: number,
  state: AdvancedStopState,
): { readonly triggered: boolean; readonly state: AdvancedStopState } {
  const touched =
    input.phase === "INTRADAY"
      ? finite(input.low) && input.low <= line
      : input.close <= line;
  if (!touched) {
    return {
      triggered: false,
      state: state.confirmationCount === 0
        ? state
        : { confirmationCount: 0 },
    };
  }
  if (policy.confirmation === "INTRADAY" || policy.confirmation === "ON_CLOSE") {
    if (policy.confirmation === "ON_CLOSE" && input.phase !== "CLOSE") {
      return { triggered: false, state };
    }
    return { triggered: true, state };
  }
  if (policy.confirmation === "LIMIT_DOWN_RECONFIRM") {
    return { triggered: input.phase === "CLOSE", state };
  }
  const confirmationCount = state.confirmationCount + 1;
  if (policy.confirmation === "DISASTER_PLUS_CLOSE") {
    return { triggered: input.phase === "CLOSE", state: { confirmationCount } };
  }
  return {
    triggered: confirmationCount >= 2,
    state: { confirmationCount },
  };
}

export function evaluateAdvancedStopPolicy(
  input: AdvancedStopEvaluationInput,
): AdvancedStopEvaluation {
  const state = input.state ?? { confirmationCount: 0 };
  const anchorRatio =
    scheduledDistance(input.policy, input.holdingDays)
    ?? anchorDistanceRatio(input.policy.anchor, input);
  if (anchorRatio === null) {
    return {
      triggered: false,
      line: null,
      reason: null,
      sellRatio: 0,
      state,
    };
  }
  const tightenedRatio = input.contextTightenRatio === null
    || input.contextTightenRatio === undefined
    ? anchorRatio
    : Math.min(anchorRatio, input.contextTightenRatio);
  let line = input.entryPrice * (1 - tightenedRatio);
  if (input.policy.escalation !== null && input.policy.escalation !== undefined) {
    line = applyEscalation(line, input.policy.escalation, input);
  }
  const disasterLine = input.policy.disasterStopRatio
    === null
    || input.policy.disasterStopRatio === undefined
    ? null
    : input.entryPrice * (1 - input.policy.disasterStopRatio);
  const disasterTriggered =
    disasterLine !== null
    && input.phase === "INTRADAY"
    && finite(input.low)
    && input.low <= disasterLine;
  const evaluatedLine = disasterTriggered ? disasterLine! : line;
  const triggeredReduction = input.policy.reduction?.steps
    .map((step) => ({
      ...step,
      line: input.entryPrice * (1 + step.triggerRatio),
    }))
    .filter((step) =>
      input.phase === "INTRADAY"
        ? finite(input.low) && input.low <= step.line
        : input.close <= step.line
    )
    .sort((left, right) => right.sellRatio - left.sellRatio)[0];
  if (!disasterTriggered && triggeredReduction !== undefined) {
    return {
      triggered: true,
      line: triggeredReduction.line,
      reason:
        `分批止损（触发${(triggeredReduction.triggerRatio * 100).toFixed(2)}%，`
        + `卖出${(triggeredReduction.sellRatio * 100).toFixed(0)}%）`,
      sellRatio: triggeredReduction.sellRatio,
      state,
    };
  }
  const confirmation = confirmationTriggered(
    input.policy,
    input,
    evaluatedLine,
    state,
  );
  if (disasterTriggered) {
    return {
      triggered: true,
      line: evaluatedLine,
      reason: `灾难止损（${((1 - evaluatedLine / input.entryPrice) * 100).toFixed(2)}%）`,
      sellRatio: 1,
      state: confirmation.state,
    };
  }
  if (!confirmation.triggered) {
    return {
      triggered: false,
      line: evaluatedLine,
      reason: null,
      sellRatio: 0,
      state: confirmation.state,
    };
  }
  const currentRatio = (input.entryPrice - line) / input.entryPrice;
  const sellRatio = reductionSellRatio(input.policy, -Math.max(0, currentRatio));
  return {
    triggered: true,
    line,
    reason:
      `止损（轨${round(line)}，约${(currentRatio * 100).toFixed(2)}%）`
      + (sellRatio > 0 && sellRatio < 1 ? `，先减仓${(sellRatio * 100).toFixed(0)}%` : ""),
    sellRatio: sellRatio > 0 ? sellRatio : 1,
    state: confirmation.state,
  };
}

export function describeAdvancedStopEvaluation(
  evaluation: AdvancedStopEvaluation,
): string {
  return evaluation.reason ?? `止损未触发（轨${evaluation.line === null ? "NA" : round(evaluation.line)}）`;
}
