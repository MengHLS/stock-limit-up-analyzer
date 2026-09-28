import type { ResearchDatasetRow } from "../../researchDataset/types";
import type {
  ResearchTrailingPolicyDefinition,
  ParabolicSarTrailingPolicy,
} from "../trailingPolicy";

export interface TrailingPriceHistory {
  readonly dates: string[];
  readonly closes: (number | null)[];
  readonly highs: (number | null)[];
  readonly lows: (number | null)[];
}

export interface ParabolicSarState {
  readonly sar: number;
  readonly extreme: number;
  readonly acceleration: number;
}

export interface AdvancedTrailingEvaluationInput {
  readonly policy: ResearchTrailingPolicyDefinition;
  readonly date: string;
  readonly close: number;
  readonly high: number | null;
  readonly low: number | null;
  readonly riskEntryPrice: number;
  readonly peakClosePrice: number;
  readonly stopLossRatio: number;
  readonly history: TrailingPriceHistory | undefined;
  readonly sarState?: ParabolicSarState;
}

export interface AdvancedTrailingEvaluation {
  readonly reason: string | null;
  readonly sarState?: ParabolicSarState;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
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

export function buildTrailingPriceHistory(
  rows: readonly ResearchDatasetRow[],
): Map<string, TrailingPriceHistory> {
  const historyBySecurity = new Map<string, TrailingPriceHistory>();
  for (const row of rows) {
    const history = historyBySecurity.get(row.securityId) ?? {
      dates: [],
      closes: [],
      highs: [],
      lows: [],
    };
    history.dates.push(row.tradeDate);
    history.closes.push(finite(row.close) ? row.close : null);
    history.highs.push(finite(row.high) ? row.high : null);
    history.lows.push(finite(row.low) ? row.low : null);
    historyBySecurity.set(row.securityId, history);
  }
  return historyBySecurity;
}

/** Adjust all history entries strictly before `date` by a corporate-action factor. */
export function adjustTrailingPriceHistory(
  history: TrailingPriceHistory | undefined,
  date: string,
  factor: number,
): void {
  if (history === undefined || factor === 1) return;
  for (let index = 0; index < history.dates.length; index += 1) {
    if (history.dates[index]! >= date) break;
    const close = history.closes[index];
    const high = history.highs[index];
    const low = history.lows[index];
    if (finite(close)) history.closes[index] = close * factor;
    if (finite(high)) history.highs[index] = high * factor;
    if (finite(low)) history.lows[index] = low * factor;
  }
}

export function movingAverageAt(
  history: TrailingPriceHistory | undefined,
  date: string,
  window: number,
): number | null {
  if (history === undefined) return null;
  const index = historyIndexAt(history, date);
  if (index + 1 < window) return null;
  let sum = 0;
  for (let cursor = index + 1 - window; cursor <= index; cursor += 1) {
    const close = history.closes[cursor];
    if (!finite(close)) return null;
    sum += close;
  }
  return sum / window;
}

export function atrAt(
  history: TrailingPriceHistory | undefined,
  date: string,
  window: number,
): number | null {
  if (history === undefined) return null;
  const index = historyIndexAt(history, date);
  if (index < window) return null;
  let sum = 0;
  for (let cursor = index + 1 - window; cursor <= index; cursor += 1) {
    const high = history.highs[cursor];
    const low = history.lows[cursor];
    const previousClose = history.closes[cursor - 1];
    if (!finite(high) || !finite(low) || !finite(previousClose)) return null;
    sum += Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
  }
  return sum / window;
}

function lowestPriorLowAt(
  history: TrailingPriceHistory | undefined,
  date: string,
  lookbackDays: number,
): number | null {
  if (history === undefined) return null;
  const index = historyIndexAt(history, date);
  if (index < lookbackDays) return null;
  let lowest = Number.POSITIVE_INFINITY;
  for (let cursor = index - lookbackDays; cursor < index; cursor += 1) {
    const low = history.lows[cursor];
    if (!finite(low)) return null;
    lowest = Math.min(lowest, low);
  }
  return Number.isFinite(lowest) ? lowest : null;
}

function clampSarToPriorLows(
  value: number,
  history: TrailingPriceHistory | undefined,
  date: string,
  fallback: number,
): number {
  if (history === undefined) return value;
  const index = historyIndexAt(history, date);
  if (index < 0) return value;
  const lows = [history.lows[index - 1], history.lows[index - 2]];
  const finiteLows = lows.filter(finite);
  return finiteLows.length === 0 ? fallback : Math.min(value, ...finiteLows);
}

function evaluateSar(
  policy: ParabolicSarTrailingPolicy,
  input: AdvancedTrailingEvaluationInput,
  peakReturnRatio: number,
  armed: boolean,
): AdvancedTrailingEvaluation {
  const currentLow = finite(input.low) ? input.low : input.riskEntryPrice;
  const currentHigh = finite(input.high) ? input.high : input.close;
  const previous = input.sarState ?? {
    sar: currentLow,
    extreme: currentHigh,
    acceleration: policy.step,
  };
  const rawSar =
    previous.sar + previous.acceleration * (previous.extreme - previous.sar);
  const sar = clampSarToPriorLows(
    rawSar,
    input.history,
    input.date,
    currentLow,
  );
  if (armed && input.close < sar) {
    return {
      sarState: {
        sar,
        extreme: previous.extreme,
        acceleration: previous.acceleration,
      },
      reason:
        `SAR趋势止盈（峰值收益${pct(peakReturnRatio)}，`
        + `收盘${round(input.close)} < SAR ${round(sar)}）`,
    };
  }

  const extreme = currentHigh > previous.extreme ? currentHigh : previous.extreme;
  const acceleration =
    currentHigh > previous.extreme
      ? Math.min(policy.maxStep, previous.acceleration + policy.step)
      : previous.acceleration;
  return {
    sarState: { sar, extreme, acceleration },
    reason: null,
  };
}

export function evaluateAdvancedTrailingPolicy(
  input: AdvancedTrailingEvaluationInput,
): AdvancedTrailingEvaluation {
  const policy = input.policy;
  const peakReturnRatio = input.peakClosePrice / input.riskEntryPrice - 1;
  const activationRatio =
    "activationRatio" in policy ? policy.activationRatio : 0;
  const armed =
    activationRatio === 0
      ? peakReturnRatio > 0
      : peakReturnRatio >= activationRatio;

  if (policy.kind === "MA_CROSS") {
    const fast = movingAverageAt(input.history, input.date, policy.fastWindow);
    const slow = movingAverageAt(input.history, input.date, policy.slowWindow);
    if (
      armed
      && fast !== null
      && slow !== null
      && input.close < fast
      && input.close < slow
    ) {
      return {
        reason:
          `MA趋势止盈（峰值收益${pct(peakReturnRatio)}，`
          + `收盘${round(input.close)} < MA${String(policy.fastWindow)} ${round(fast)} / `
          + `MA${String(policy.slowWindow)} ${round(slow)}）`,
      };
    }
    return { reason: null };
  }

  if (policy.kind === "ATR_CHANDELIER") {
    const atr = atrAt(input.history, input.date, policy.atrWindow);
    const line =
      atr === null
        ? null
        : input.peakClosePrice - policy.atrMultiplier * atr;
    if (armed && line !== null && input.close <= line) {
      return {
        reason:
          `ATR吊灯止盈（峰值收益${pct(peakReturnRatio)}，`
          + `ATR${String(policy.atrWindow)}=${round(atr!)}，轨=${round(line)}）`,
      };
    }
    return { reason: null };
  }

  if (policy.kind === "R_MULTIPLE") {
    let activeLock: { triggerR: number; lockR: number } | null = null;
    for (const entry of policy.lockLadder) {
      if (peakReturnRatio >= entry.triggerR * input.stopLossRatio) {
        activeLock = entry;
      }
    }
    if (activeLock !== null) {
      const lockPrice =
        input.riskEntryPrice * (1 + activeLock.lockR * input.stopLossRatio);
      if (input.close <= lockPrice) {
        return {
          reason:
            `R倍利润锁止盈（峰值收益${pct(peakReturnRatio)}，`
            + `锁定${String(activeLock.lockR)}R=${round(lockPrice)}）`,
        };
      }
    }
    return { reason: null };
  }

  if (policy.kind === "PROFIT_GIVEBACK") {
    if (armed) {
      const givebackRatio = peakReturnRatio * policy.givebackFraction;
      const line = input.peakClosePrice * (1 - givebackRatio);
      if (input.close <= line) {
        return {
          reason:
            `利润回吐止盈（峰值收益${pct(peakReturnRatio)}，`
            + `回吐${pct(givebackRatio)}，轨=${round(line)}）`,
        };
      }
    }
    return { reason: null };
  }

  if (policy.kind === "SWING_LOW") {
    const low = lowestPriorLowAt(input.history, input.date, policy.lookbackDays);
    if (armed && low !== null && input.close < low) {
      return {
        reason:
          `结构低点止盈（峰值收益${pct(peakReturnRatio)}，`
          + `收盘${round(input.close)} < ${String(policy.lookbackDays)}日低点${round(low)}）`,
      };
    }
    return { reason: null };
  }

  if (policy.kind === "PARABOLIC_SAR") {
    return evaluateSar(policy, input, peakReturnRatio, armed);
  }

  const fast = movingAverageAt(input.history, input.date, policy.fastWindow);
  const atr = atrAt(input.history, input.date, policy.atrWindow);
  const atrLine =
    atr === null
      ? null
      : input.peakClosePrice - policy.atrMultiplier * atr;
  const candidates = [
    input.riskEntryPrice * (1 + policy.floorRatio),
    ...(fast === null ? [] : [fast]),
    ...(atrLine === null ? [] : [atrLine]),
  ];
  const line = Math.max(...candidates);
  if (armed && input.close <= line) {
    return {
      reason:
        `混合轨止盈（峰值收益${pct(peakReturnRatio)}，轨=${round(line)}，`
        + `MA${String(policy.fastWindow)}=${fast === null ? "NA" : String(round(fast))}，`
        + `ATR${String(policy.atrWindow)}=${atr === null ? "NA" : String(round(atr))}）`,
    };
  }
  return { reason: null };
}
