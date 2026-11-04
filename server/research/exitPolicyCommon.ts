import {
  STOP_CONTEXT_KINDS,
  stopPolicyDefinitionErrors,
  type StopContextKind,
  type StopPolicyDefinition,
} from "./stopPolicy";
import type { ResearchTrailingPolicyDefinition } from "./trailingPolicy";

export const STOP_CONFIRMATIONS = [
  "INTRADAY",
  "ON_CLOSE",
  "TWO_CLOSES",
  "DISASTER_PLUS_CLOSE",
  "LIMIT_DOWN_RECONFIRM",
] as const;
export type StopConfirmation = (typeof STOP_CONFIRMATIONS)[number];

export interface TimeExitPolicyDefinition {
  readonly kind: "FIXED_HOLDING_DAYS";
  readonly holdingDays: number;
}

export interface StrongHoldPolicyDefinition {
  readonly atHoldingDays: number;
  readonly minReturnRatio: number;
  readonly requireAboveMa5: boolean;
  readonly requireAboveMa10: boolean;
  readonly extendToHoldingDays: number;
  readonly afterExtendedHold?: "TIME_EXIT" | "TREND";
  readonly scaleOutRatio?: number | null;
  readonly runnerExitAtHoldingDays?: number | null;
  readonly maxConcurrentRunners?: number | null;
  readonly replacementScoreMargin?: number | null;
}

export interface CapitalRecyclePolicyDefinition {
  readonly maxConcurrentRunners: number | null;
  readonly replacementScoreMargin: number | null;
}

export interface RunnerRecoveryPathExitPolicyDefinition {
  /** 固定基准信号：连续创新高 >=2 中断（Strong→Weak）。 */
  readonly kind: "HIGHER_HIGH_STREAK_RECOVERY";
  /** 首次达到该浮盈后，才开始跟踪 Strong→Weak。 */
  readonly activationRatio: number;
  /** 首次转弱后等待多少个收盘日；期间恢复 Strong 则继续持有，否则退出。 */
  readonly confirmationDays: 0 | 1 | 2 | 3;
}

export const RUNNER_HOLDING_BRIDGE_STATES = [
  "NEW_HIGH_2",
  "NEW_HIGH_3",
  "CONSECUTIVE_HIGHER_HIGHS_GE_2",
  "RETURN_2_POSITIVE",
  "RETURN_3_POSITIVE",
  "CLOSE_ABOVE_MA5",
  "CLOSE_ABOVE_MA10",
  "MA5_SLOPE_POSITIVE",
  "MA10_SLOPE_POSITIVE",
  "NEAR_5D_HIGH",
  "CONSECUTIVE_LOWER_CLOSES_GE_2",
  "CLOSE_LOCATION_UPPER_THIRD",
] as const;
export type RunnerHoldingBridgeState = (typeof RUNNER_HOLDING_BRIDGE_STATES)[number];

/** 已注册状态条件的显式引用；实现由状态注册表持有，不在 Schema 内复制执行代码。 */
export interface RunnerStateConditionReference {
  readonly stateId: string;
  readonly version: string;
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

/** Runner 状态判定上下文；固定为 PIT、只用入场日到决策日的可见信息。 */
export interface RunnerEvaluationContextDefinition {
  readonly decisionPoint: "CLOSE";
  readonly historyFrom: "ENTRY";
  readonly historyTo: "DECISION";
  readonly requiredData: readonly string[];
  readonly usesForwardData: false;
}

export const DEFAULT_RUNNER_EVALUATION_CONTEXT: RunnerEvaluationContextDefinition = Object.freeze({
  decisionPoint: "CLOSE",
  historyFrom: "ENTRY",
  historyTo: "DECISION",
  requiredData: Object.freeze(["OHLCV"]),
  usesForwardData: false,
});

/** STRATEGY-HOLDING-BRIDGE-001：在指定持有日收盘用 PIT 状态决定是否延长原时间退出。 */
export interface RunnerHoldingBridgePolicyDefinition {
  readonly kind: "PIT_RUNNER_HOLDING_BRIDGE";
  /** @deprecated 新策略使用 stateCondition；3570001 与历史版本继续使用。 */
  readonly state?: RunnerHoldingBridgeState;
  readonly stateCondition?: RunnerStateConditionReference;
  /** 决策发生在入场后的第 N 个持有日收盘；3570001 = 5。 */
  readonly decisionHoldingDays: number;
  readonly extendToHoldingDays: number;
  readonly evaluationContext?: RunnerEvaluationContextDefinition;
}

/**
 * CLC2-PORTFOLIO-001：研究专用的「持续状态 → 反转确认退出」路径。
 *
 * 语义（逐收盘评估，信号次日开盘执行）：
 * - 状态 = 前一日收盘后、当日收盘低于前一日收盘（连续收低计数 ≥1）；
 * - 连续 TRUE 达到 `sustainMinRun`（默认 5）个交易日后视为「持续成立」；
 * - 成立后的首个 FALSE（反转确认）发出退出信号，下一个可交易日开盘卖出。
 *
 * 缺省 / null 时既有执行路径完全不变。仅在显式研究策略中声明。
 */
export interface SustainedCloseDeclineReversalExitPolicyDefinition {
  readonly kind: "SUSTAINED_CLOSE_DECLINE_REVERSAL";
  /** 触发反转确认前，状态需要连续 TRUE 的最小交易日数；默认 5。 */
  readonly sustainMinRun?: number;
}

export interface ExitPolicyDefinition {
  readonly stop: StopPolicyDefinition;
  readonly takeProfit: ResearchTrailingPolicyDefinition | null;
  readonly timeExit: TimeExitPolicyDefinition | null;
  readonly strongHold: StrongHoldPolicyDefinition | null;
  readonly capitalRecycle: CapitalRecyclePolicyDefinition | null;
  /** STRATEGY-EXIT-VALIDATION-010：固定 Runner 恢复/持续弱路径退出。 */
  readonly recoveryPath?: RunnerRecoveryPathExitPolicyDefinition | null;
  /** STRATEGY-HOLDING-BRIDGE-001：研究专用单变量 Runner 持有桥。 */
  readonly runnerBridge?: RunnerHoldingBridgePolicyDefinition | null;
  /** CLC2-PORTFOLIO-001：研究专用「持续连续收低 → 反转确认退出」路径。 */
  readonly clc2ReversalPath?: SustainedCloseDeclineReversalExitPolicyDefinition | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function ratio(value: unknown): value is number {
  return finite(value) && value > 0 && value < 1;
}

function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

export function stopConfirmationErrors(
  value: unknown,
  path = "confirmation",
): string[] {
  return typeof value === "string"
    && (STOP_CONFIRMATIONS as readonly string[]).includes(value)
    ? []
    : [`${path} 必须是 ${STOP_CONFIRMATIONS.join(" | ")} 之一`];
}

export function stopScheduleErrors(
  value: unknown,
  path = "schedule",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const phases = value.phases;
  if (!Array.isArray(phases) || phases.length === 0) {
    return [`${path}.phases 必须是非空数组`];
  }
  const errors: string[] = [];
  let nextStart = 1;
  phases.forEach((phase, index) => {
    const at = `${path}.phases[${index}]`;
    if (!isRecord(phase)) {
      errors.push(`${at} 必须是对象`);
      return;
    }
    if (
      !Number.isInteger(phase.fromHoldingDay)
      || (phase.fromHoldingDay as number) !== nextStart
    ) {
      errors.push(`${at}.fromHoldingDay 必须从 ${String(nextStart)} 连续开始`);
    }
    if (!positive(phase.stopRatio)) errors.push(`${at}.stopRatio 必须大于 0`);
    if (Number.isInteger(phase.fromHoldingDay) && Number.isInteger(phase.toHoldingDay)) {
      if ((phase.toHoldingDay as number) < (phase.fromHoldingDay as number)) {
        errors.push(`${at}.toHoldingDay 不能早于 fromHoldingDay`);
      }
      nextStart = (phase.toHoldingDay as number) + 1;
    }
  });
  return errors;
}

export function capitalRecyclePolicyErrors(
  value: unknown,
  path = "capitalRecycle",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const errors: string[] = [];
  const maxRunners = value.maxConcurrentRunners;
  if (
    maxRunners !== null
    && (!Number.isInteger(maxRunners) || (maxRunners as number) <= 0)
  ) {
    errors.push(`${path}.maxConcurrentRunners 必须是正整数或 null`);
  }
  const margin = value.replacementScoreMargin;
  if (margin !== null && !nonNegative(margin)) {
    errors.push(`${path}.replacementScoreMargin 必须是非负有限数字或 null`);
  }
  return errors;
}

export function timeExitPolicyErrors(
  value: unknown,
  path = "timeExit",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const errors: string[] = [];
  if (value.kind !== "FIXED_HOLDING_DAYS") {
    errors.push(`${path}.kind 必须是 FIXED_HOLDING_DAYS`);
  }
  if (!Number.isInteger(value.holdingDays) || (value.holdingDays as number) <= 0) {
    errors.push(`${path}.holdingDays 必须是正整数`);
  }
  return errors;
}

export function strongHoldPolicyErrors(
  value: unknown,
  path = "strongHold",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const errors: string[] = [];
  const at = value.atHoldingDays;
  const extend = value.extendToHoldingDays;
  if (!Number.isInteger(at) || (at as number) <= 0) {
    errors.push(`${path}.atHoldingDays 必须是正整数`);
  }
  if (!Number.isInteger(extend) || (extend as number) <= 0) {
    errors.push(`${path}.extendToHoldingDays 必须是正整数`);
  }
  if (
    Number.isInteger(at)
    && Number.isInteger(extend)
    && (extend as number) <= (at as number)
  ) {
    errors.push(`${path}.extendToHoldingDays 必须大于 atHoldingDays`);
  }
  if (!finite(value.minReturnRatio)) errors.push(`${path}.minReturnRatio 必须是有限数字`);
  if (typeof value.requireAboveMa5 !== "boolean") errors.push(`${path}.requireAboveMa5 必须是布尔值`);
  if (typeof value.requireAboveMa10 !== "boolean") errors.push(`${path}.requireAboveMa10 必须是布尔值`);
  if (
    value.afterExtendedHold !== undefined
    && value.afterExtendedHold !== "TIME_EXIT"
    && value.afterExtendedHold !== "TREND"
  ) {
    errors.push(`${path}.afterExtendedHold 必须是 TIME_EXIT / TREND`);
  }
  if (
    value.scaleOutRatio !== undefined
    && value.scaleOutRatio !== null
    && !ratio(value.scaleOutRatio)
  ) {
    errors.push(`${path}.scaleOutRatio 必须是 (0,1) 或 null`);
  }
  if (
    value.runnerExitAtHoldingDays !== undefined
    && value.runnerExitAtHoldingDays !== null
    && (
      !Number.isInteger(value.runnerExitAtHoldingDays)
      || (
        Number.isInteger(extend)
        && (value.runnerExitAtHoldingDays as number) <= (extend as number)
      )
    )
  ) {
    errors.push(`${path}.runnerExitAtHoldingDays 必须是大于 extendToHoldingDays 的整数或 null`);
  }
  if (
    value.maxConcurrentRunners !== undefined
    && value.maxConcurrentRunners !== null
    && (
      !Number.isInteger(value.maxConcurrentRunners)
      || (value.maxConcurrentRunners as number) <= 0
    )
  ) {
    errors.push(`${path}.maxConcurrentRunners 必须是正整数或 null`);
  }
  if (
    value.replacementScoreMargin !== undefined
    && value.replacementScoreMargin !== null
    && !nonNegative(value.replacementScoreMargin)
  ) {
    errors.push(`${path}.replacementScoreMargin 必须是非负有限数字或 null`);
  }
  return errors;
}

/** RunnerBridge 的单一校验入口 —— Strategy Schema / Simulator / Record 复核必须共用。 */
export function runnerBridgePolicyErrors(
  value: unknown,
  path = "runnerBridge",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const errors: string[] = [];
  if (value.kind !== "PIT_RUNNER_HOLDING_BRIDGE") {
    errors.push(`${path}.kind 必须是 PIT_RUNNER_HOLDING_BRIDGE`);
  }
  const hasState = value.state !== undefined && value.state !== null;
  const hasStateCondition = value.stateCondition !== undefined && value.stateCondition !== null;
  if (hasState === hasStateCondition) {
    errors.push(`${path} 必须且只能声明 state 或 stateCondition 之一`);
  }
  if (hasState && !(RUNNER_HOLDING_BRIDGE_STATES as readonly unknown[]).includes(value.state)) {
    errors.push(`${path}.state 非法`);
  }
  if (hasStateCondition) {
    if (!isRecord(value.stateCondition)) {
      errors.push(`${path}.stateCondition 必须是对象`);
    } else {
      const ref = value.stateCondition;
      if (typeof ref.stateId !== "string" || ref.stateId.trim() === "") {
        errors.push(`${path}.stateCondition.stateId 必须是非空字符串`);
      }
      if (typeof ref.version !== "string" || ref.version.trim() === "") {
        errors.push(`${path}.stateCondition.version 必须是非空字符串`);
      }
      if (ref.parameters !== undefined && ref.parameters !== null) {
        if (!isRecord(ref.parameters)) {
          errors.push(`${path}.stateCondition.parameters 必须是标量对象`);
        } else {
          for (const [key, parameter] of Object.entries(ref.parameters)) {
            if (typeof parameter !== "string" && typeof parameter !== "boolean" && !finite(parameter)) {
              errors.push(`${path}.stateCondition.parameters.${key} 必须是字符串 / 布尔 / 有限数字`);
            }
          }
        }
      }
    }
  }
  const decisionHoldingDays = value.decisionHoldingDays;
  if (!Number.isInteger(decisionHoldingDays) || (decisionHoldingDays as number) <= 0) {
    errors.push(`${path}.decisionHoldingDays 必须是正整数`);
  }
  const extendToHoldingDays = value.extendToHoldingDays;
  if (!Number.isInteger(extendToHoldingDays) || !Number.isInteger(decisionHoldingDays) || (extendToHoldingDays as number) <= (decisionHoldingDays as number)) {
    errors.push(`${path}.extendToHoldingDays 必须是大于 decisionHoldingDays 的整数`);
  }
  if (value.evaluationContext !== undefined && value.evaluationContext !== null) {
    if (!isRecord(value.evaluationContext)) {
      errors.push(`${path}.evaluationContext 必须是对象`);
    } else {
      const context = value.evaluationContext;
      if (context.decisionPoint !== "CLOSE") errors.push(`${path}.evaluationContext.decisionPoint 目前必须是 CLOSE`);
      if (context.historyFrom !== "ENTRY" || context.historyTo !== "DECISION") {
        errors.push(`${path}.evaluationContext.historyFrom/historyTo 必须是 ENTRY/DECISION`);
      }
      if (!Array.isArray(context.requiredData) || context.requiredData.length === 0 || context.requiredData.some((item) => typeof item !== "string" || item.trim() === "")) {
        errors.push(`${path}.evaluationContext.requiredData 必须是非空字符串数组`);
      }
      if (context.usesForwardData !== false) errors.push(`${path}.evaluationContext.usesForwardData 必须为 false`);
    }
  }
  return errors;
}

export function exitPolicyDefinitionErrors(
  value: unknown,
  path = "exitPolicy",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const errors: string[] = [];
  const stop = value.stop;
  if (!isRecord(stop)) {
    errors.push(`${path}.stop 必须是对象`);
  } else {
    for (const error of stopPolicyDefinitionErrors(stop)) {
      errors.push(`${path}.stop: ${error}`);
    }
  }
  if (value.timeExit !== null) {
    for (const error of timeExitPolicyErrors(value.timeExit, `${path}.timeExit`)) {
      errors.push(error);
    }
  }
  if (value.strongHold !== null) {
    for (const error of strongHoldPolicyErrors(value.strongHold, `${path}.strongHold`)) {
      errors.push(error);
    }
  }
  if (value.capitalRecycle !== null) {
    for (const error of capitalRecyclePolicyErrors(value.capitalRecycle, `${path}.capitalRecycle`)) {
      errors.push(error);
    }
  }
  if (value.recoveryPath !== undefined && value.recoveryPath !== null) {
    if (!isRecord(value.recoveryPath)) {
      errors.push(`${path}.recoveryPath 必须是对象或 null`);
    } else {
      const recoveryPath = value.recoveryPath;
      if (recoveryPath.kind !== "HIGHER_HIGH_STREAK_RECOVERY") {
        errors.push(`${path}.recoveryPath.kind 必须是 HIGHER_HIGH_STREAK_RECOVERY`);
      }
      if (!ratio(recoveryPath.activationRatio)) {
        errors.push(`${path}.recoveryPath.activationRatio 必须位于 (0,1)`);
      }
      if (
        !Number.isInteger(recoveryPath.confirmationDays)
        || (recoveryPath.confirmationDays as number) < 0
        || (recoveryPath.confirmationDays as number) > 3
      ) {
        errors.push(`${path}.recoveryPath.confirmationDays 必须是 0/1/2/3`);
      }
    }
  }
  if (value.runnerBridge !== undefined && value.runnerBridge !== null) {
    errors.push(...runnerBridgePolicyErrors(value.runnerBridge, `${path}.runnerBridge`));
  }
  if (value.clc2ReversalPath !== undefined && value.clc2ReversalPath !== null) {
    if (!isRecord(value.clc2ReversalPath)) {
      errors.push(`${path}.clc2ReversalPath 必须是对象或 null`);
    } else {
      const clc2 = value.clc2ReversalPath;
      if (clc2.kind !== "SUSTAINED_CLOSE_DECLINE_REVERSAL") {
        errors.push(`${path}.clc2ReversalPath.kind 必须是 SUSTAINED_CLOSE_DECLINE_REVERSAL`);
      }
      if (
        clc2.sustainMinRun !== undefined
        && (!Number.isInteger(clc2.sustainMinRun) || (clc2.sustainMinRun as number) < 1)
      ) {
        errors.push(`${path}.clc2ReversalPath.sustainMinRun 必须是正整数`);
      }
    }
  }
  if (value.takeProfit !== null && !isRecord(value.takeProfit)) {
    errors.push(`${path}.takeProfit 必须是对象或 null`);
  }
  return errors;
}


