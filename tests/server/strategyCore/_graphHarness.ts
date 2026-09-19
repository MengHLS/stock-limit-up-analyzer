/**
 * RuleGraph 测试用最小 harness（非测试文件）。
 *
 * 只装配「与业务无关」的环境：字段/特征/参数读取 + PIT 访问关卡。
 * 业务样例由各测试文件自己声明。
 */

import {
  createDayScopedBarAccess,
  evaluateRuleGraph,
  parseCoreFieldReference,
  readBarColumnValue,
  type BarUniverse,
  type CoreValue,
  type DayScopedBarAccess,
  type RelativeDay,
  type RuleEvaluationEnv,
  type RuleGraphEvaluation,
  type RuleNode,
  type VisibilityViolation,
  type VisibleBar,
} from "../../../server/strategyCore";

/** 单根 bar 工厂（相对日 → 确定性日期/价格）。 */
export function BAR_FIXTURE(relativeDay: number, overrides: Partial<VisibleBar> = {}): VisibleBar {
  return {
    date: "2026-09-" + String(10 + relativeDay).padStart(2, "0"),
    relativeDay,
    open: 10,
    high: 10.6,
    low: 10.2,
    close: 10.4,
    volume: 1_000_000,
    amount: 10_400_000,
    preClose: 10,
    ...overrides,
  };
}

/** bar 集（rd 0..maxRelativeDay）。 */
export function barsFor(maxRelativeDay: number, overrides: Partial<Record<number, Partial<VisibleBar>>> = {}): BarUniverse {
  const bars: VisibleBar[] = [];
  for (let rd = 0; rd <= maxRelativeDay; rd += 1) {
    bars.push(BAR_FIXTURE(rd, overrides[rd] ?? {}));
  }
  return { bars };
}

export interface HarnessOptions {
  readonly currentDay?: RelativeDay;
  readonly bars?: BarUniverse;
  readonly maxRelativeDay?: RelativeDay;
  readonly eventOccurred?: boolean | ((eventType: string) => boolean);
  readonly eventFields?: Readonly<Record<string, CoreValue>>;
  readonly featureValues?: Readonly<Record<string, CoreValue>>;
  readonly parameterValues?: Readonly<Record<string, CoreValue>>;
}

export interface HarnessResult {
  readonly evaluation: RuleGraphEvaluation;
  readonly violations: readonly VisibilityViolation[];
  readonly insufficiencies: readonly string[];
  readonly accesses: readonly DayScopedBarAccess[];
}

/** 装配 env → 求值 → 汇总越界读取。 */
export function envFor(root: RuleNode, options: HarnessOptions = {}): HarnessResult {
  const currentDay = options.currentDay ?? 0;
  const universe = options.bars ?? barsFor(Math.max(currentDay, 0));
  const violations: VisibilityViolation[] = [];
  const insufficiencies: string[] = [];
  const accesses: DayScopedBarAccess[] = [];
  const eventFields = options.eventFields ?? {};
  const featureValues = options.featureValues ?? {};
  const parameterValues = options.parameterValues ?? {};

  const accessFor = (day: RelativeDay): DayScopedBarAccess => {
    const access = createDayScopedBarAccess(
      options.maxRelativeDay === undefined ? universe : { ...universe, maxRelativeDay: options.maxRelativeDay },
      day,
    );
    accesses.push(access);
    return access;
  };

  const fieldValueAt = (day: RelativeDay, field: string): CoreValue => {
    const parsed = parseCoreFieldReference(field);
    switch (parsed.kind) {
      case "PRE_EVENT":
      case "FORWARD_BAR": {
        const bar = accessFor(day).barAt(parsed.relativeDay ?? 0);
        return bar === null ? null : readBarColumnValue(bar, parsed.field);
      }
      case "CURRENT_BAR": {
        const bar = accessFor(day).currentBar();
        return bar === null ? null : readBarColumnValue(bar, parsed.field);
      }
      case "EVENT_DAY":
        return Object.prototype.hasOwnProperty.call(eventFields, parsed.field) ? (eventFields[parsed.field] as CoreValue) : null;
      case "DERIVED_BAR_FEATURE":
        return Object.prototype.hasOwnProperty.call(featureValues, parsed.featureId as string)
          ? (featureValues[parsed.featureId as string] as CoreValue)
          : null;
      default:
        return null;
    }
  };

  const build = (day: RelativeDay): RuleEvaluationEnv => ({
    asOf: { date: "2026-09-19", point: "close" },
    currentDay: day,
    maxRelativeDay: options.maxRelativeDay ?? day,
    eventOccurred: (eventType: string) => {
      const resolved = options.eventOccurred ?? false;
      return typeof resolved === "function" ? resolved(eventType) : resolved;
    },
    fieldValue: (field: string) => fieldValueAt(day, field),
    featureValue: (featureId: string) =>
      Object.prototype.hasOwnProperty.call(featureValues, featureId) ? (featureValues[featureId] as CoreValue) : null,
    parameterValue: (code: string) =>
      Object.prototype.hasOwnProperty.call(parameterValues, code) ? (parameterValues[code] as CoreValue) : null,
    violations,
    insufficiencies,
    withDay: (next: RelativeDay) => build(next),
  });

  const evaluation = evaluateRuleGraph(root, build(currentDay));
  for (const access of accesses) {
    for (const violation of access.violations()) violations.push(violation);
  }
  return { evaluation, violations, insufficiencies, accesses };
}
