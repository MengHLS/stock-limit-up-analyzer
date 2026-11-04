/**
 * 通用 Runner State / Factor 注册表（纯计算、无 IO）。
 *
 * 本模块是 legacy `RunnerHoldingBridgeState` 闭集与未来声明式 `stateCondition` 的唯一执行实现面：
 * - Strategy Schema 只声明 `{stateId, version, parameters}`；
 * - 新状态通过注册一项纯函数扩展，不要求在 simulator 内追加 switch / 复制执行路径；
 * - PIT 边界由输入上下文固定为「entryTime..currentDate 的可见 bars」。
 */

import type { CanonicalMarketBar } from "../data";
import type {
  RunnerHoldingBridgePolicyDefinition,
  RunnerHoldingBridgeState,
  RunnerStateConditionReference,
} from "./exitPolicyCommon";

export const RUNNER_STATE_REGISTRY_VERSION = "1";

export interface RunnerStateEvaluationInput {
  readonly bars: readonly CanonicalMarketBar[];
  readonly entryTime: string;
  readonly currentDate: string;
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

export interface RegisteredRunnerStateDefinition {
  readonly stateId: string;
  readonly version: string;
  readonly evaluate: (input: RunnerStateEvaluationInput) => boolean;
}

export class RunnerStateRegistryError extends Error {
  readonly code = "RUNNER_STATE_NOT_REGISTERED";
  constructor(
    readonly stateId: string,
    readonly version: string,
  ) {
    super(`Runner state "${stateId}@${version}" 未注册；拒绝静默当作 false`);
    this.name = "RunnerStateRegistryError";
  }
}

function numericMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverageBefore(
  bars: readonly CanonicalMarketBar[],
  index: number,
  window: number,
): number | null {
  if (index - window + 1 < 0) return null;
  const closes: number[] = [];
  for (let cursor = index - window + 1; cursor <= index; cursor += 1) {
    const close = bars[cursor]?.close;
    if (close === null || close === undefined || !Number.isFinite(close)) return null;
    closes.push(close);
  }
  return numericMean(closes);
}

function stateEvaluator(
  stateId: RunnerHoldingBridgeState,
  evaluate: (input: RunnerStateEvaluationInput) => boolean,
): RegisteredRunnerStateDefinition {
  return Object.freeze({ stateId, version: RUNNER_STATE_REGISTRY_VERSION, evaluate });
}

/** 内置状态定义。新增状态只加一条注册项，不改 simulator 分支。 */
export const RUNNER_STATE_DEFINITIONS: readonly RegisteredRunnerStateDefinition[] = Object.freeze([
  stateEvaluator("NEW_HIGH_2", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, high, highAt, maxHigh } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex || high === null) return false;
    const prior = maxHigh(currentIndex - 2, currentIndex - 1);
    return prior !== null && high > prior;
  }),
  stateEvaluator("NEW_HIGH_3", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, high, highAt, maxHigh } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex || high === null) return false;
    const prior = maxHigh(currentIndex - 3, currentIndex - 1);
    return prior !== null && high > prior;
  }),
  stateEvaluator("CONSECUTIVE_HIGHER_HIGHS_GE_2", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, highAt } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex) return false;
    let count = 0;
    for (let index = currentIndex; index > entryIndex; index -= 1) {
      const currentHigh = highAt(index);
      const previousHigh = highAt(index - 1);
      if (currentHigh === null || previousHigh === null || currentHigh <= previousHigh) break;
      count += 1;
    }
    return count >= 2;
  }),
  stateEvaluator("RETURN_2_POSITIVE", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, close, closeAt } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex || close === null) return false;
    const prior = closeAt(currentIndex - 2);
    return prior !== null && prior > 0 && close > prior;
  }),
  stateEvaluator("RETURN_3_POSITIVE", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, close, closeAt } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex || close === null) return false;
    const prior = closeAt(currentIndex - 3);
    return prior !== null && prior > 0 && close > prior;
  }),
  stateEvaluator("CLOSE_ABOVE_MA5", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, close } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex || close === null) return false;
    const ma = movingAverageBefore(bars, currentIndex, 5);
    return ma !== null && close > ma;
  }),
  stateEvaluator("CLOSE_ABOVE_MA10", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, close } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex || close === null) return false;
    const ma = movingAverageBefore(bars, currentIndex, 10);
    return ma !== null && close > ma;
  }),
  stateEvaluator("MA5_SLOPE_POSITIVE", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex) return false;
    const currentMa = movingAverageBefore(bars, currentIndex, 5);
    const priorMa = movingAverageBefore(bars, currentIndex - 1, 5);
    return currentMa !== null && priorMa !== null && priorMa > 0 && currentMa > priorMa;
  }),
  stateEvaluator("MA10_SLOPE_POSITIVE", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex) return false;
    const currentMa = movingAverageBefore(bars, currentIndex, 10);
    const priorMa = movingAverageBefore(bars, currentIndex - 1, 10);
    return currentMa !== null && priorMa !== null && priorMa > 0 && currentMa > priorMa;
  }),
  stateEvaluator("NEAR_5D_HIGH", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, close, maxHigh } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex || close === null) return false;
    const recent = maxHigh(currentIndex - 4, currentIndex);
    return recent !== null && close >= recent;
  }),
  stateEvaluator("CONSECUTIVE_LOWER_CLOSES_GE_2", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, closeAt } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex) return false;
    let count = 0;
    for (let index = currentIndex; index > entryIndex; index -= 1) {
      const currentClose = closeAt(index);
      const previousClose = closeAt(index - 1);
      if (currentClose === null || previousClose === null || currentClose >= previousClose) break;
      count += 1;
    }
    return count >= 2;
  }),
  stateEvaluator("CLOSE_LOCATION_UPPER_THIRD", ({ bars, entryTime, currentDate }) => {
    const { currentIndex, entryIndex, high, low, close } = stateContext(bars, entryTime, currentDate);
    if (currentIndex <= entryIndex || high === null || low === null || close === null) return false;
    const range = high - low;
    return range > 0 && (close - low) / range >= 2 / 3;
  }),
]);

interface StateContext {
  readonly currentIndex: number;
  readonly entryIndex: number;
  readonly high: number | null;
  readonly low: number | null;
  readonly close: number | null;
  readonly volume: number | null;
  readonly highAt: (index: number) => number | null;
  readonly closeAt: (index: number) => number | null;
  readonly maxHigh: (from: number, to: number) => number | null;
}

function stateContext(
  bars: readonly CanonicalMarketBar[],
  entryTime: string,
  currentDate: string,
): StateContext {
  const currentIndex = bars.findIndex((bar) => bar.timestamp === currentDate);
  const entryIndex = bars.findIndex((bar) => bar.timestamp === entryTime);
  const current = currentIndex >= 0 ? bars[currentIndex] : undefined;
  const finite = (value: number | null | undefined): number | null =>
    value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  const highAt = (index: number): number | null => finite(bars[index]?.high);
  const closeAt = (index: number): number | null => finite(bars[index]?.close);
  const maxHigh = (from: number, to: number): number | null => {
    const values: number[] = [];
    for (let index = Math.max(0, from); index <= Math.min(bars.length - 1, to); index += 1) {
      const value = highAt(index);
      if (value !== null) values.push(value);
    }
    return values.length === 0 ? null : Math.max(...values);
  };
  return {
    currentIndex,
    entryIndex,
    high: finite(current?.high),
    low: finite(current?.low),
    close: finite(current?.close),
    volume: finite(current?.volume),
    highAt,
    closeAt,
    maxHigh,
  };
}

/** 按注册表求值；未注册/版本不符响亮拒绝，不静默当作 false。 */
export function evaluateRunnerStateCondition(
  reference: RunnerStateConditionReference,
  input: RunnerStateEvaluationInput,
): boolean {
  const definition = RUNNER_STATE_DEFINITIONS.find(
    (item) => item.stateId === reference.stateId && item.version === reference.version,
  );
  if (definition === undefined) throw new RunnerStateRegistryError(reference.stateId, reference.version);
  const completeBar = stateContext(input.bars, input.entryTime, input.currentDate);
  if (
    completeBar.currentIndex < 0
    || completeBar.entryIndex < 0
    || completeBar.currentIndex <= completeBar.entryIndex
    || completeBar.high === null
    || completeBar.low === null
    || completeBar.close === null
    || completeBar.volume === null
  ) return false;
  return definition.evaluate({
    ...input,
    ...(reference.parameters === undefined ? {} : { parameters: reference.parameters }),
  });
}

/** 解析 RunnerBridge 的 legacy state / 声明式 stateCondition；两者恰有其一由校验器保证。 */
export function runnerBridgeStateReference(
  policy: RunnerHoldingBridgePolicyDefinition,
): RunnerStateConditionReference {
  if (policy.stateCondition !== undefined && policy.stateCondition !== null) {
    return policy.stateCondition;
  }
  if (policy.state !== undefined && policy.state !== null) {
    return { stateId: policy.state, version: RUNNER_STATE_REGISTRY_VERSION };
  }
  throw new RunnerStateRegistryError("(missing)", RUNNER_STATE_REGISTRY_VERSION);
}

/** 用注册表求值 RunnerBridge 的指定持有日状态。 */
export function evaluateRunnerBridgePolicyState(
  policy: RunnerHoldingBridgePolicyDefinition,
  bars: readonly CanonicalMarketBar[],
  entryTime: string,
  currentDate: string,
): boolean {
  return evaluateRunnerStateCondition(runnerBridgeStateReference(policy), {
    bars,
    entryTime,
    currentDate,
  });
}

/** RunnerBridge 的纯生命周期：PENDING → STATE_EVALUATION → EXTEND / NORMAL_EXIT。 */
export const RUNNER_BRIDGE_LIFECYCLE_STATES = [
  "PENDING",
  "STATE_EVALUATION",
  "EXTEND",
  "NORMAL_EXIT",
] as const;
export type RunnerBridgeLifecycleState = (typeof RUNNER_BRIDGE_LIFECYCLE_STATES)[number];

export function runnerBridgeLifecycleState(input: {
  readonly holdingDays: number;
  readonly decisionHoldingDays: number;
  readonly stateMatched?: boolean;
}): RunnerBridgeLifecycleState {
  if (input.holdingDays < input.decisionHoldingDays) return "PENDING";
  if (input.holdingDays === input.decisionHoldingDays) {
    if (input.stateMatched === undefined) return "STATE_EVALUATION";
    return input.stateMatched ? "EXTEND" : "NORMAL_EXIT";
  }
  return input.stateMatched === true ? "EXTEND" : "NORMAL_EXIT";
}

/** Legacy state 名 → 注册表坐标；3570001 的 `NEW_HIGH_3` 走同一条求值实现。 */
export function evaluateRunnerHoldingBridgeStateByRegistry(
  state: RunnerHoldingBridgeState,
  bars: readonly CanonicalMarketBar[],
  entryTime: string,
  currentDate: string,
): boolean {
  return evaluateRunnerStateCondition(
    { stateId: state, version: RUNNER_STATE_REGISTRY_VERSION },
    { bars, entryTime, currentDate },
  );
}
