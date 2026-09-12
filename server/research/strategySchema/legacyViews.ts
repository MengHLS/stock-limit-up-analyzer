/**
 * STEP STRATEGY-003 — Canonical Definition → v1 兼容视图（单向派生，纯函数）。
 *
 * 🔴 方向铁律（SPEC §八 / §四十六）：永远是 `Canonical Definition → View`。
 * **禁止** `View → Definition`：v1 的 `DeclaredRule` / `PositionSizingDeclaration` 表达力弱于富模型，
 * 若反向生成，投影就会变成第二套 Source of Truth。
 *
 * 本模块被 `map.ts`（组装时自动派生）与 `validate.ts`（反序列化后复核一致性）共用，
 * 因此**必须**是叶子模块（只依赖 `definition.ts` 与 type-only 的 `types.ts`），
 * 否则会与 validate.ts / map.ts 形成运行时循环依赖。
 *
 * 有损点全部显式登记在 `deriveLegacyViews` 的注释与映射表里，不做静默近似。
 */

import { canonicalStringify } from "../../researchDataset/version";
import type { ResearchParameterSchema, ResearchParameterValue } from "../types";
import {
  parseStrategyFieldReference,
  resolveConditionId,
  resolveExitRuleId,
  type ConditionDefinition,
  type ExitRuleDefinition,
  type ParameterDefinition,
  type PositionDefinition,
  type RiskDefinition,
  type StrategyDefinition,
  type StrategyExecutionTiming,
} from "./definition";
import type {
  DeclaredRule,
  DeclaredRuleKind,
  PositionSizingDeclaration,
  RuleComparisonOperator,
} from "./types";

/** v1 兼容视图集合（由 Canonical Definition 单向派生）。 */
export interface StrategyLegacyViews {
  readonly entryRules: readonly DeclaredRule[];
  readonly exitRules: readonly DeclaredRule[];
  readonly riskRules: readonly DeclaredRule[];
  readonly positionSizing: PositionSizingDeclaration;
  readonly parameters: ResearchParameterSchema;
  readonly executionModel: string;
  /** PRIMARY 绑定的 Dataset Version label / 快照（v2）；legacy 绑定为 rd-… 串。 */
  readonly datasetVersion?: string;
  /** 🔴 STRATEGY-004：PRIMARY 绑定的 Dataset Registry 权威坐标（dataset_version.id）。 */
  readonly datasetVersionId?: number;
}

/** 条件操作符 → v1 `RuleComparisonOperator`（`IN` / `NOT_IN` 在 v1 无对应，省略 operator，语义落在 description）。 */
const RULE_OPERATOR_BY_CONDITION: Partial<Record<ConditionDefinition["operator"], RuleComparisonOperator>> = {
  GREATER_THAN: ">",
  GREATER_THAN_OR_EQUAL: ">=",
  LESS_THAN: "<",
  LESS_THAN_OR_EQUAL: "<=",
  EQUAL: "==",
  NOT_EQUAL: "!=",
};

/** v1 `DeclaredRule.operand` 只接受 number | string | null；其余标量显式转字符串（不静默丢弃）。 */
function toRuleOperand(value: ResearchParameterValue | readonly ResearchParameterValue[]): number | string | null {
  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? "null" : String(item))).join(",");
  }
  const scalar = value as ResearchParameterValue;
  if (scalar === null || scalar === undefined) return null;
  if (typeof scalar === "number" || typeof scalar === "string") return scalar;
  return String(scalar);
}

/** 由条件左值的时间域推断 v1 规则 kind（纯分类，不改变语义）。 */
function classifyConditionRuleKind(condition: ConditionDefinition): DeclaredRuleKind {
  const reference = parseStrategyFieldReference(condition.field);
  if (reference.kind === "unknown" || reference.kind === "labelOnly") return "state";
  if (reference.kind === "eventDay" || reference.kind === "preEvent") return "state";
  const field = "field" in reference ? reference.field : "";
  if (field === "tradeDate" || field === "relativeDay") return "time-based";
  return "threshold";
}

/** 条件 → v1 声明式规则。 */
function conditionToDeclaredRule(condition: ConditionDefinition, index: number): DeclaredRule {
  const id = resolveConditionId(condition, index);
  const operator = RULE_OPERATOR_BY_CONDITION[condition.operator];
  const label = condition.valueType === "FIELD_REFERENCE"
    ? `字段 ${String(condition.value)}`
    : condition.valueType === "PARAMETER_REFERENCE"
      ? `参数 ${String(condition.value)}`
      : `常量 ${String(toRuleOperand(condition.value))}`;
  return {
    id,
    kind: classifyConditionRuleKind(condition),
    description: `${condition.field} ${condition.operator} ${label}`,
    field: condition.field,
    ...(operator === undefined ? {} : { operator }),
    operand: toRuleOperand(condition.value),
    ...(condition.description === undefined ? {} : { note: condition.description }),
  };
}

/** 参数 code → 其 default 值（用于把 `parameter` 引用的阈值 / 比例解析成 v1 里的字面量）。 */
function resolveParameterDefault(definition: StrategyDefinition, code: string): ResearchParameterValue | undefined {
  return definition.parameters.find((parameter) => parameter.code === code)?.defaultValue;
}

/** 出场规则阈值解析：显式 threshold 优先，其次由 `parameter` 的 defaultValue 解析。 */
function resolveExitThreshold(rule: ExitRuleDefinition, definition: StrategyDefinition): number | undefined {
  if (typeof rule.threshold === "number") return rule.threshold;
  if (typeof rule.parameter === "string") {
    const value = resolveParameterDefault(definition, rule.parameter);
    if (typeof value === "number") return value;
  }
  return undefined;
}

/** 仓位比例解析：显式 positionRatio 优先，其次由 `parameter` 的 defaultValue 解析。 */
function resolvePositionRatio(position: PositionDefinition, definition: StrategyDefinition): number | undefined {
  if (typeof position.positionRatio === "number") return position.positionRatio;
  if (typeof position.parameter === "string") {
    const value = resolveParameterDefault(definition, position.parameter);
    if (typeof value === "number") return value;
  }
  return undefined;
}

/**
 * `executionTiming` → 既有 `executionModel` 白名单值的投影（**有损**，逐项登记）：
 *
 *   T_PLUS_1_OPEN  → NEXT_OPEN    （精确）
 *   T_PLUS_1_CLOSE → NEXT_CLOSE   （精确）
 *   T_PLUS_2_OPEN  → NEXT_OPEN    （⚠ 有损：v1 白名单无 T+2，取最接近语义）
 *   T_CLOSE        → LIMIT_PRICE  （⚠ 有损：同一 bar 收盘成交，v1 白名单内最接近）
 */
export function deriveExecutionModel(executionTiming: StrategyExecutionTiming): string {
  switch (executionTiming) {
    case "T_PLUS_1_OPEN":
      return "NEXT_OPEN";
    case "T_PLUS_1_CLOSE":
      return "NEXT_CLOSE";
    case "T_PLUS_2_OPEN":
      return "NEXT_OPEN";
    case "T_CLOSE":
      return "LIMIT_PRICE";
  }
}

/**
 * 由 Canonical `StrategyDefinition` 派生全部 v1 兼容视图（纯函数、确定性、有损）。
 *
 * 映射表：
 *   entry.conditions          → entryRules（`IN` / `NOT_IN` 无 v1 操作符 → 省略 operator，表达式落 description）
 *   exit.rules                → exitRules（TAKE_PROFIT / STOP_LOSS → threshold；TIME_EXIT → time-based）
 *   risk.*                    → riskRules（portfolio.* / position.* 维度的状态与阈值声明）
 *   position                  → positionSizing（⚠ 有损：FIXED_AMOUNT / RISK_BASED 无 v1 等价，
 *                                               归入 fixed-fraction / rank-weighted，比例取 parameter
 *                                               默认值或 1/maxPositions）
 *   parameters                → ResearchParameterSchema（`name` = `code`；⚠ 有损：`parameterRole` 在 v1 无对应位）
 *   execution.executionTiming → executionModel（见 deriveExecutionModel，含两处有损）
 *   datasets(PRIMARY)         → datasetVersion（label / 快照）+ datasetVersionId（权威坐标）
 */
export function deriveLegacyViews(definition: StrategyDefinition): StrategyLegacyViews {
  const entryRules = definition.entry.conditions.map((condition, index) => conditionToDeclaredRule(condition, index));

  const exitRules: DeclaredRule[] = definition.exit.rules.map((rule, index) => {
    const id = resolveExitRuleId(rule, index);
    const threshold = resolveExitThreshold(rule, definition);
    const isTimeExit = rule.type === "TIME_EXIT";
    const isSignalExit = rule.type === "SIGNAL_EXIT" || rule.type === "FORCED_EXIT";
    const kind: DeclaredRuleKind = isTimeExit ? "time-based" : isSignalExit ? "state" : "threshold";
    let operator: RuleComparisonOperator | undefined;
    if (isTimeExit) operator = ">=";
    else if (rule.type === "STOP_LOSS") operator = "<=";
    else if (rule.type === "TAKE_PROFIT") operator = ">=";
    const operand: number | string | null = rule.type === "STOP_LOSS" && typeof threshold === "number"
      ? -Math.abs(threshold)
      : (threshold ?? (rule.parameter === undefined ? null : `param:${rule.parameter}`));
    return {
      id,
      kind,
      description: `${rule.type}${threshold === undefined ? "" : ` ${threshold}`}` +
        `${rule.thresholdUnit === undefined ? "" : ` ${rule.thresholdUnit}`}（${rule.trigger}）` +
        `${rule.parameter === undefined ? "" : `；阈值由参数 ${rule.parameter} 表达`}`,
      field: isTimeExit ? "position.holdingDays" : isSignalExit ? "position.exitSignal" : "price.pctChange",
      ...(operator === undefined ? {} : { operator }),
      operand,
      ...(rule.description === undefined ? {} : { note: rule.description }),
    };
  });

  const riskRules: DeclaredRule[] = [];
  const pushRisk = (
    value: number | undefined,
    id: string,
    kind: DeclaredRuleKind,
    field: string,
    operator: RuleComparisonOperator,
    operand: number,
    description: string,
  ): void => {
    if (typeof value !== "number") return;
    riskRules.push({ id, kind, description, field, operator, operand });
  };
  const risk: RiskDefinition = definition.risk;
  pushRisk(risk.maxPositions, "risk.maxPositions", "state", "portfolio.maxPositions", "<=",
    risk.maxPositions ?? 0, `组合最多同时持有 ${risk.maxPositions} 只`);
  pushRisk(risk.maxSinglePosition, "risk.maxSinglePosition", "threshold", "position.weight", "<=",
    risk.maxSinglePosition ?? 0, `单标的最大占比 ${risk.maxSinglePosition}`);
  pushRisk(risk.maxExposure, "risk.maxExposure", "threshold", "portfolio.exposure", "<=",
    risk.maxExposure ?? 0, `组合最大暴露 ${risk.maxExposure}`);
  pushRisk(risk.maxDrawdown, "risk.maxDrawdown", "threshold", "portfolio.drawdown", "<=",
    -(risk.maxDrawdown ?? 0), `组合最大回撤闸门 ${risk.maxDrawdown}`);
  pushRisk(risk.stopLoss, "risk.stopLoss", "threshold", "price.pctChange", "<=",
    -(risk.stopLoss ?? 0), `单笔止损 ${risk.stopLoss}`);
  pushRisk(risk.dailyLossLimit, "risk.dailyLossLimit", "threshold", "portfolio.dailyLoss", "<=",
    -(risk.dailyLossLimit ?? 0), `单日亏损上限 ${risk.dailyLossLimit}`);
  pushRisk(risk.concentrationLimit, "risk.concentrationLimit", "threshold", "position.concentration", "<=",
    risk.concentrationLimit ?? 0, `集中度上限 ${risk.concentrationLimit}`);

  const position = definition.position;
  const resolvedRatio = resolvePositionRatio(position, definition);
  const fraction = resolvedRatio ?? (1 / position.maxPositions);
  const positionSizing: PositionSizingDeclaration = position.sizingMethod === "EQUAL_WEIGHT"
    ? { kind: "equal-weight", maxPositions: position.maxPositions }
    : position.sizingMethod === "RISK_BASED"
      ? { kind: "rank-weighted", maxPositions: position.maxPositions }
      : { kind: "fixed-fraction", fraction, maxPositions: position.maxPositions };

  const parameters: ResearchParameterSchema = {
    parameters: definition.parameters.map((parameter: ParameterDefinition) => ({
      name: parameter.code,
      type: parameter.dataType,
      required: parameter.required,
      ...(parameter.defaultValue === undefined ? {} : { defaultValue: parameter.defaultValue }),
      ...(parameter.nullable === undefined ? {} : { nullable: parameter.nullable }),
      ...(parameter.min === undefined ? {} : { min: parameter.min }),
      ...(parameter.max === undefined ? {} : { max: parameter.max }),
      ...(parameter.step === undefined ? {} : { step: parameter.step }),
      ...(parameter.allowedValues === undefined ? {} : { allowedValues: parameter.allowedValues }),
      ...(parameter.description === undefined ? {} : { description: parameter.description }),
    })),
  };

  const primary = definition.datasets.find((binding) => binding.role === "PRIMARY");

  return {
    entryRules,
    exitRules,
    riskRules,
    positionSizing,
    parameters,
    executionModel: deriveExecutionModel(definition.execution.executionTiming),
    ...(primary === undefined ? {} : { datasetVersion: primary.datasetVersion }),
    ...(primary?.datasetVersionId === undefined ? {} : { datasetVersionId: primary.datasetVersionId }),
  };
}

/** 深比较（canonical JSON 串比较；`undefined` 与「不存在」等价）。 */
export function legacyViewsEqual(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}
