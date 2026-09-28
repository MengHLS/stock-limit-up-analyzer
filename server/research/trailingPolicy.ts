/**
 * Research-only advanced trailing take-profit policy.
 *
 * All policies are evaluated at the close and, when triggered, produce a
 * next-open sell order. They never replace the explicit stop-loss rule.
 */

export const RESEARCH_TRAILING_POLICY_KINDS = [
  "MA_CROSS",
  "ATR_CHANDELIER",
  "R_MULTIPLE",
  "PROFIT_GIVEBACK",
  "SWING_LOW",
  "PARABOLIC_SAR",
  "HYBRID",
] as const;

export type ResearchTrailingPolicyKind = (typeof RESEARCH_TRAILING_POLICY_KINDS)[number];

export const STRONG_HOLD_AFTER_EXTENDED_EXIT_POLICIES = [
  "TIME_EXIT",
  "TREND",
] as const;

export type StrongHoldAfterExtendedExitPolicy =
  (typeof STRONG_HOLD_AFTER_EXTENDED_EXIT_POLICIES)[number];

export interface MaCrossTrailingPolicy {
  readonly kind: "MA_CROSS";
  readonly fastWindow: number;
  readonly slowWindow: number;
  readonly activationRatio: number;
}

export interface AtrChandelierTrailingPolicy {
  readonly kind: "ATR_CHANDELIER";
  readonly atrWindow: number;
  readonly atrMultiplier: number;
  readonly activationRatio: number;
}

export interface RMultipleTrailingPolicy {
  readonly kind: "R_MULTIPLE";
  readonly lockLadder: readonly {
    readonly triggerR: number;
    readonly lockR: number;
  }[];
}

export interface ProfitGivebackTrailingPolicy {
  readonly kind: "PROFIT_GIVEBACK";
  readonly activationRatio: number;
  readonly givebackFraction: number;
}

export interface SwingLowTrailingPolicy {
  readonly kind: "SWING_LOW";
  readonly lookbackDays: number;
  readonly activationRatio: number;
}

export interface ParabolicSarTrailingPolicy {
  readonly kind: "PARABOLIC_SAR";
  readonly step: number;
  readonly maxStep: number;
  readonly activationRatio: number;
}

export interface HybridTrailingPolicy {
  readonly kind: "HYBRID";
  readonly fastWindow: number;
  readonly atrWindow: number;
  readonly atrMultiplier: number;
  readonly floorRatio: number;
  readonly activationRatio: number;
}

export type ResearchTrailingPolicyDefinition =
  | MaCrossTrailingPolicy
  | AtrChandelierTrailingPolicy
  | RMultipleTrailingPolicy
  | ProfitGivebackTrailingPolicy
  | SwingLowTrailingPolicy
  | ParabolicSarTrailingPolicy
  | HybridTrailingPolicy;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function integerPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Structural validation shared by the strategy schema and simulator record
 * validation. Returns one human-readable error per violated invariant.
 */
export function trailingPolicyDefinitionErrors(value: unknown): string[] {
  if (!isRecord(value)) return ["trailingPolicy 必须是对象"];
  const kind = value.kind;
  if (
    typeof kind !== "string"
    || !(RESEARCH_TRAILING_POLICY_KINDS as readonly string[]).includes(kind)
  ) {
    return [`trailingPolicy.kind 必须是 ${RESEARCH_TRAILING_POLICY_KINDS.join(" | ")} 之一`];
  }

  const errors: string[] = [];
  if (kind === "MA_CROSS") {
    if (!integerPositive(value.fastWindow)) errors.push("fastWindow 必须是正整数");
    if (!integerPositive(value.slowWindow)) errors.push("slowWindow 必须是正整数");
    if (
      integerPositive(value.fastWindow)
      && integerPositive(value.slowWindow)
      && value.fastWindow >= value.slowWindow
    ) {
      errors.push("fastWindow 必须小于 slowWindow");
    }
    if (!finiteNonNegative(value.activationRatio)) errors.push("activationRatio 必须是非负有限数字");
  } else if (kind === "ATR_CHANDELIER") {
    if (!integerPositive(value.atrWindow)) errors.push("atrWindow 必须是正整数");
    if (!finitePositive(value.atrMultiplier)) errors.push("atrMultiplier 必须大于 0");
    if (!finiteNonNegative(value.activationRatio)) errors.push("activationRatio 必须是非负有限数字");
  } else if (kind === "R_MULTIPLE") {
    const ladder = value.lockLadder;
    if (!Array.isArray(ladder) || ladder.length === 0) {
      errors.push("lockLadder 必须是非空数组");
    } else {
      let previousTrigger = 0;
      ladder.forEach((entry, index) => {
        if (!isRecord(entry)) {
          errors.push(`lockLadder[${String(index)}] 必须是对象`);
          return;
        }
        const triggerR = entry.triggerR;
        const lockR = entry.lockR;
        if (!finitePositive(triggerR)) errors.push(`lockLadder[${String(index)}].triggerR 必须大于 0`);
        if (!finitePositive(lockR)) errors.push(`lockLadder[${String(index)}].lockR 必须大于 0`);
        if (
          finitePositive(triggerR)
          && finitePositive(lockR)
          && lockR >= triggerR
        ) {
          errors.push(`lockLadder[${String(index)}] 的 lockR 必须小于 triggerR`);
        }
        if (finitePositive(triggerR) && triggerR <= previousTrigger) {
          errors.push("lockLadder.triggerR 必须严格递增");
        }
        if (finitePositive(triggerR)) previousTrigger = triggerR;
      });
    }
  } else if (kind === "PROFIT_GIVEBACK") {
    if (!finiteNonNegative(value.activationRatio)) errors.push("activationRatio 必须是非负有限数字");
    if (
      typeof value.givebackFraction !== "number"
      || !Number.isFinite(value.givebackFraction)
      || value.givebackFraction <= 0
      || value.givebackFraction >= 1
    ) {
      errors.push("givebackFraction 必须位于 (0,1)");
    }
  } else if (kind === "SWING_LOW") {
    if (!integerPositive(value.lookbackDays)) errors.push("lookbackDays 必须是正整数");
    if (!finiteNonNegative(value.activationRatio)) errors.push("activationRatio 必须是非负有限数字");
  } else if (kind === "PARABOLIC_SAR") {
    if (
      typeof value.step !== "number"
      || !Number.isFinite(value.step)
      || value.step <= 0
      || value.step > 1
    ) {
      errors.push("step 必须位于 (0,1]");
    }
    if (
      typeof value.maxStep !== "number"
      || !Number.isFinite(value.maxStep)
      || value.maxStep <= 0
      || value.maxStep > 1
    ) {
      errors.push("maxStep 必须位于 (0,1]");
    }
    if (
      typeof value.step === "number"
      && typeof value.maxStep === "number"
      && value.maxStep < value.step
    ) {
      errors.push("maxStep 必须大于等于 step");
    }
    if (!finiteNonNegative(value.activationRatio)) errors.push("activationRatio 必须是非负有限数字");
  } else if (kind === "HYBRID") {
    if (!integerPositive(value.fastWindow)) errors.push("fastWindow 必须是正整数");
    if (!integerPositive(value.atrWindow)) errors.push("atrWindow 必须是正整数");
    if (!finitePositive(value.atrMultiplier)) errors.push("atrMultiplier 必须大于 0");
    if (!finitePositive(value.floorRatio)) errors.push("floorRatio 必须大于 0");
    if (!finiteNonNegative(value.activationRatio)) errors.push("activationRatio 必须是非负有限数字");
  }

  return errors;
}

export function assertValidTrailingPolicyDefinition(
  value: unknown,
): asserts value is ResearchTrailingPolicyDefinition {
  const errors = trailingPolicyDefinitionErrors(value);
  if (errors.length > 0) {
    throw new Error(`非法 trailingPolicy：${errors.join("；")}`);
  }
}

export function describeTrailingPolicy(
  policy: ResearchTrailingPolicyDefinition,
): string {
  if (policy.kind === "MA_CROSS") {
    return `收盘同时跌破 MA${String(policy.fastWindow)} / MA${String(policy.slowWindow)} 后次日开盘退出`;
  }
  if (policy.kind === "ATR_CHANDELIER") {
    return `最高收盘价减去 ${String(policy.atrMultiplier)} 倍 ATR${String(policy.atrWindow)} 后次日开盘退出`;
  }
  if (policy.kind === "R_MULTIPLE") {
    return "按风险倍数逐级上移利润锁：" + policy.lockLadder
      .map((entry) => `${String(entry.triggerR)}R 后锁 ${String(entry.lockR)}R`)
      .join("；");
  }
  if (policy.kind === "PROFIT_GIVEBACK") {
    return `峰值收益达到 ${(policy.activationRatio * 100).toFixed(2)}% 后，最多回吐峰值利润的 ${(policy.givebackFraction * 100).toFixed(2)}%`;
  }
  if (policy.kind === "SWING_LOW") {
    return `收盘跌破此前 ${String(policy.lookbackDays)} 日最低点后次日开盘退出`;
  }
  if (policy.kind === "PARABOLIC_SAR") {
    return `收盘低于 Parabolic SAR（step=${String(policy.step)}，max=${String(policy.maxStep)}）后次日开盘退出`;
  }
  return `混合轨取成本保底线、MA${String(policy.fastWindow)} 与峰值为基准的 ${String(policy.atrMultiplier)} 倍 ATR${String(policy.atrWindow)} 轨中的最高线`;
}
