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

export interface ExitPolicyDefinition {
  readonly stop: StopPolicyDefinition;
  readonly takeProfit: ResearchTrailingPolicyDefinition | null;
  readonly timeExit: TimeExitPolicyDefinition | null;
  readonly strongHold: StrongHoldPolicyDefinition | null;
  readonly capitalRecycle: CapitalRecyclePolicyDefinition | null;
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
  if (value.takeProfit !== null && !isRecord(value.takeProfit)) {
    errors.push(`${path}.takeProfit 必须是对象或 null`);
  }
  return errors;
}

