import type {
  StopConfirmation,
} from "./exitPolicyCommon";

export const STOP_CONTEXT_KINDS = [
  "MARKET",
  "SECTOR",
  "LEADER",
  "PORTFOLIO_DRAWDOWN",
  "LOSS_STREAK",
] as const;
export type StopContextKind = (typeof STOP_CONTEXT_KINDS)[number];

export const STOP_ANCHOR_KINDS = [
  "FIXED_PERCENT",
  "ATR",
  "STRUCTURE_LOW",
  "RANGE_FRACTION",
  "ATR_PERCENTILE",
] as const;
export type StopAnchorKind = (typeof STOP_ANCHOR_KINDS)[number];

export const STOP_ESCALATION_KINDS = [
  "BREAK_EVEN",
  "LADDER",
  "R_MULTIPLE",
  "CHANDELIER",
  "MA_BAND",
  "PEAK_DRAWDOWN",
] as const;
export type StopEscalationKind = (typeof STOP_ESCALATION_KINDS)[number];

export interface FixedPercentStopAnchor {
  readonly kind: "FIXED_PERCENT";
  readonly stopRatio: number;
}

export interface AtrStopAnchor {
  readonly kind: "ATR";
  readonly atrWindow: number;
  readonly atrMultiplier: number;
  readonly minStopRatio: number;
  readonly maxStopRatio: number;
}

export interface StructureLowStopAnchor {
  readonly kind: "STRUCTURE_LOW";
  readonly source:
    | "OBSERVATION_WINDOW"
    | "EVENT_DAY_CLOSE"
    | "EVENT_DAY_LOW"
    | "ROLLING_LOW";
  readonly lookbackDays?: number;
  readonly bufferAtrMultiplier: number;
  readonly minStopRatio: number;
  readonly maxStopRatio: number;
}

export interface RangeFractionStopAnchor {
  readonly kind: "RANGE_FRACTION";
  readonly fraction: number;
  readonly minStopRatio: number;
  readonly maxStopRatio: number;
}

export interface AtrPercentileStopAnchor {
  readonly kind: "ATR_PERCENTILE";
  readonly atrWindow: number;
  readonly percentile: number;
  readonly minStopRatio: number;
  readonly maxStopRatio: number;
}

export type StopAnchorDefinition =
  | FixedPercentStopAnchor
  | AtrStopAnchor
  | StructureLowStopAnchor
  | RangeFractionStopAnchor
  | AtrPercentileStopAnchor;

export interface BreakEvenStopEscalation {
  readonly kind: "BREAK_EVEN";
  readonly activationRatio: number;
  readonly stopRatio: number;
}

export interface LadderStopEscalation {
  readonly kind: "LADDER";
  readonly steps: readonly {
    readonly activationRatio: number;
    readonly stopRatio: number;
  }[];
}

export interface RMultipleStopEscalation {
  readonly kind: "R_MULTIPLE";
  readonly rRatio: number;
  readonly steps: readonly {
    readonly triggerR: number;
    readonly lockR: number;
  }[];
}

export interface ChandelierStopEscalation {
  readonly kind: "CHANDELIER";
  readonly atrWindow: number;
  readonly atrMultiplier: number;
}

export interface MaBandStopEscalation {
  readonly kind: "MA_BAND";
  readonly maWindow: number;
  readonly atrWindow: number;
  readonly atrMultiplier: number;
}

export interface PeakDrawdownStopEscalation {
  readonly kind: "PEAK_DRAWDOWN";
  readonly activationRatio: number;
  readonly drawdownRatio: number;
}

export type StopEscalationDefinition =
  | BreakEvenStopEscalation
  | LadderStopEscalation
  | RMultipleStopEscalation
  | ChandelierStopEscalation
  | MaBandStopEscalation
  | PeakDrawdownStopEscalation;

export interface StopScheduleDefinition {
  readonly phases: readonly {
    readonly fromHoldingDay: number;
    readonly toHoldingDay: number;
    readonly stopRatio: number;
  }[];
}

export interface StopReductionDefinition {
  readonly steps: readonly {
    readonly triggerRatio: number;
    readonly sellRatio: number;
  }[];
}

export interface StopContextDefinition {
  readonly kind: StopContextKind;
  readonly tightenToRatio?: number;
  readonly consecutiveLosses?: number;
}

export interface StopPolicyDefinition {
  readonly anchor: StopAnchorDefinition;
  readonly confirmation: StopConfirmation;
  readonly disasterStopRatio?: number | null;
  readonly escalation?: StopEscalationDefinition | null;
  readonly schedule?: StopScheduleDefinition | null;
  readonly reduction?: StopReductionDefinition | null;
  readonly contexts?: readonly StopContextDefinition[] | null;
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

function boundedRatioOrder(
  min: unknown,
  max: unknown,
  path: string,
  errors: string[],
): void {
  if (!ratio(min)) errors.push(`${path}.minStopRatio 必须位于 (0,1)`);
  if (!ratio(max)) errors.push(`${path}.maxStopRatio 必须位于 (0,1)`);
  if (finite(min) && finite(max) && min > max) {
    errors.push(`${path}.minStopRatio 不能大于 maxStopRatio`);
  }
}

export function stopAnchorDefinitionErrors(
  value: unknown,
  path = "anchor",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const kind = value.kind;
  if (
    typeof kind !== "string"
    || !(STOP_ANCHOR_KINDS as readonly string[]).includes(kind)
  ) {
    return [`${path}.kind 必须是 ${STOP_ANCHOR_KINDS.join(" | ")} 之一`];
  }
  const errors: string[] = [];
  if (kind === "FIXED_PERCENT") {
    if (!ratio(value.stopRatio)) errors.push(`${path}.stopRatio 必须位于 (0,1)`);
  } else if (kind === "ATR") {
    if (!Number.isInteger(value.atrWindow) || (value.atrWindow as number) <= 0) {
      errors.push(`${path}.atrWindow 必须是正整数`);
    }
    if (!positive(value.atrMultiplier)) errors.push(`${path}.atrMultiplier 必须大于 0`);
    boundedRatioOrder(value.minStopRatio, value.maxStopRatio, path, errors);
  } else if (kind === "STRUCTURE_LOW") {
    if (
      value.source !== "OBSERVATION_WINDOW"
      && value.source !== "EVENT_DAY_CLOSE"
      && value.source !== "EVENT_DAY_LOW"
      && value.source !== "ROLLING_LOW"
    ) {
      errors.push(`${path}.source 非法`);
    }
    if (
      value.source === "ROLLING_LOW"
      && (!Number.isInteger(value.lookbackDays) || (value.lookbackDays as number) <= 0)
    ) {
      errors.push(`${path}.lookbackDays 在 ROLLING_LOW 下必须是正整数`);
    }
    if (!finite(value.bufferAtrMultiplier) || (value.bufferAtrMultiplier as number) < 0) {
      errors.push(`${path}.bufferAtrMultiplier 必须是非负有限数字`);
    }
    boundedRatioOrder(value.minStopRatio, value.maxStopRatio, path, errors);
  } else if (kind === "RANGE_FRACTION") {
    if (
      !finite(value.fraction)
      || (value.fraction as number) <= 0
      || (value.fraction as number) > 1
    ) {
      errors.push(`${path}.fraction 必须位于 (0,1]`);
    }
    boundedRatioOrder(value.minStopRatio, value.maxStopRatio, path, errors);
  } else {
    if (!Number.isInteger(value.atrWindow) || (value.atrWindow as number) <= 0) {
      errors.push(`${path}.atrWindow 必须是正整数`);
    }
    if (!ratio(value.percentile)) errors.push(`${path}.percentile 必须位于 (0,1)`);
    boundedRatioOrder(value.minStopRatio, value.maxStopRatio, path, errors);
  }
  return errors;
}

export function stopEscalationDefinitionErrors(
  value: unknown,
  path = "escalation",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const kind = value.kind;
  if (
    typeof kind !== "string"
    || !(STOP_ESCALATION_KINDS as readonly string[]).includes(kind)
  ) {
    return [`${path}.kind 必须是 ${STOP_ESCALATION_KINDS.join(" | ")} 之一`];
  }
  const errors: string[] = [];
  if (kind === "BREAK_EVEN") {
    if (!finite(value.activationRatio) || (value.activationRatio as number) < 0) {
      errors.push(`${path}.activationRatio 必须是非负有限数字`);
    }
    if (!finite(value.stopRatio)) errors.push(`${path}.stopRatio 必须是有限数字`);
  } else if (kind === "LADDER") {
    if (!Array.isArray(value.steps) || value.steps.length === 0) {
      errors.push(`${path}.steps 必须是非空数组`);
    } else {
      value.steps.forEach((step, index) => {
        if (!isRecord(step)) {
          errors.push(`${path}.steps[${String(index)}] 必须是对象`);
          return;
        }
        if (!finite(step.activationRatio)) {
          errors.push(`${path}.steps[${String(index)}].activationRatio 必须是有限数字`);
        }
        if (!finite(step.stopRatio)) {
          errors.push(`${path}.steps[${String(index)}].stopRatio 必须是有限数字`);
        }
      });
    }
  } else if (kind === "R_MULTIPLE") {
    if (!positive(value.rRatio)) errors.push(`${path}.rRatio 必须大于 0`);
    if (!Array.isArray(value.steps) || value.steps.length === 0) {
      errors.push(`${path}.steps 必须是非空数组`);
    }
  } else if (kind === "CHANDELIER") {
    if (!Number.isInteger(value.atrWindow) || (value.atrWindow as number) <= 0) {
      errors.push(`${path}.atrWindow 必须是正整数`);
    }
    if (!positive(value.atrMultiplier)) errors.push(`${path}.atrMultiplier 必须大于 0`);
  } else if (kind === "MA_BAND") {
    if (!Number.isInteger(value.maWindow) || (value.maWindow as number) <= 0) {
      errors.push(`${path}.maWindow 必须是正整数`);
    }
    if (!Number.isInteger(value.atrWindow) || (value.atrWindow as number) <= 0) {
      errors.push(`${path}.atrWindow 必须是正整数`);
    }
    if (!positive(value.atrMultiplier)) errors.push(`${path}.atrMultiplier 必须大于 0`);
  } else {
    if (!finite(value.activationRatio) || (value.activationRatio as number) < 0) {
      errors.push(`${path}.activationRatio 必须是非负有限数字`);
    }
    if (!ratio(value.drawdownRatio)) errors.push(`${path}.drawdownRatio 必须位于 (0,1)`);
  }
  return errors;
}

export function stopPolicyDefinitionErrors(
  value: unknown,
  path = "stop",
): string[] {
  if (!isRecord(value)) return [`${path} 必须是对象`];
  const errors: string[] = [];
  errors.push(...stopAnchorDefinitionErrors(value.anchor, `${path}.anchor`));
  if (
    typeof value.confirmation !== "string"
    || ![
      "INTRADAY",
      "ON_CLOSE",
      "TWO_CLOSES",
      "DISASTER_PLUS_CLOSE",
      "LIMIT_DOWN_RECONFIRM",
    ].includes(value.confirmation)
  ) {
    errors.push(`${path}.confirmation 非法`);
  }
  if (
    value.disasterStopRatio !== undefined
    && value.disasterStopRatio !== null
    && !ratio(value.disasterStopRatio)
  ) {
    errors.push(`${path}.disasterStopRatio 必须是 (0,1) 或 null`);
  }
  if (value.escalation !== undefined && value.escalation !== null) {
    errors.push(...stopEscalationDefinitionErrors(value.escalation, `${path}.escalation`));
  }
  if (value.schedule !== undefined && value.schedule !== null) {
    if (!isRecord(value.schedule) || !Array.isArray(value.schedule.phases)) {
      errors.push(`${path}.schedule.phases 必须是数组`);
    } else {
      let expected = 1;
      value.schedule.phases.forEach((phase, index) => {
        if (!isRecord(phase)) {
          errors.push(`${path}.schedule.phases[${String(index)}] 必须是对象`);
          return;
        }
        if (phase.fromHoldingDay !== expected) {
          errors.push(`${path}.schedule.phases[${String(index)}].fromHoldingDay 必须从 ${String(expected)} 连续开始`);
        }
        if (!ratio(phase.stopRatio)) {
          errors.push(`${path}.schedule.phases[${String(index)}].stopRatio 必须位于 (0,1)`);
        }
        if (
          Number.isInteger(phase.toHoldingDay)
          && Number.isInteger(phase.fromHoldingDay)
          && (phase.toHoldingDay as number) >= (phase.fromHoldingDay as number)
        ) {
          expected = (phase.toHoldingDay as number) + 1;
        }
      });
    }
  }
  if (value.reduction !== undefined && value.reduction !== null) {
    if (!isRecord(value.reduction) || !Array.isArray(value.reduction.steps)) {
      errors.push(`${path}.reduction.steps 必须是数组`);
    } else {
      value.reduction.steps.forEach((step, index) => {
        if (
          !isRecord(step)
          || !finite(step.triggerRatio)
          || (step.triggerRatio as number) >= 0
          || !finite(step.sellRatio)
          || (step.sellRatio as number) <= 0
          || (step.sellRatio as number) > 1
        ) {
          errors.push(`${path}.reduction.steps[${String(index)}] 非法`);
        }
      });
    }
  }
  if (value.contexts !== undefined && value.contexts !== null) {
    if (!Array.isArray(value.contexts)) {
      errors.push(`${path}.contexts 必须是数组或 null`);
    } else {
      value.contexts.forEach((context, index) => {
        if (
          !isRecord(context)
          || typeof context.kind !== "string"
          || !(STOP_CONTEXT_KINDS as readonly string[]).includes(context.kind)
        ) {
          errors.push(`${path}.contexts[${String(index)}].kind 非法`);
        }
      });
    }
  }
  return errors;
}

export function describeStopPolicy(policy: StopPolicyDefinition): string {
  const anchor = policy.anchor;
  if (anchor.kind === "FIXED_PERCENT") {
    return `固定 ${(anchor.stopRatio * 100).toFixed(2)}%`;
  }
  if (anchor.kind === "ATR") {
    return `${String(anchor.atrMultiplier)}×ATR${String(anchor.atrWindow)}，限制 ${(anchor.minStopRatio * 100).toFixed(1)}%~${(anchor.maxStopRatio * 100).toFixed(1)}%`;
  }
  if (anchor.kind === "STRUCTURE_LOW") {
    return `结构低点 ${anchor.source} + ${String(anchor.bufferAtrMultiplier)}×ATR 缓冲`;
  }
  if (anchor.kind === "RANGE_FRACTION") {
    return `首板区间 ${(anchor.fraction * 100).toFixed(0)}%`;
  }
  return `ATR${String(anchor.atrWindow)} 的 ${(anchor.percentile * 100).toFixed(0)} 分位`;
}
