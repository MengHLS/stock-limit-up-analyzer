/**
 * STEP STRATEGY-003 — Canonical Definition → 查询投影（**单向派生**，纯函数）。
 *
 * 🔴 方向铁律（SPEC §四十六 / §八）：
 *
 *     Canonical Definition ──► Parameters / Entry / Exit / Execution / Dataset 投影
 *
 *   - 投影**永远**由 `StrategyDefinition` 生成；
 *   - **禁止** `DB Projection → Canonical Definition`（那会让投影变成第二 Source of Truth）；
 *   - 需要权威语义时，读取方必须回到 `strategy_versions.strategyDocumentJson`。
 *
 * 本模块只做「领域对象 → 投影行」与「投影漂移比对」，不接触 DB（映射在 strategyPersistence 层）。
 * 投影行字段名与 `drizzle/schema.ts` 的 5 张表逐列对应，便于持久化层直通映射。
 */

import { canonicalStringify } from "../../researchDataset/version";
import {
  resolveConditionId,
  resolveExitRuleId,
  type ConditionDefinition,
  type ParameterDefinition,
  type StrategyDefinition,
} from "./definition";

// ---------------------------------------------------------------------------
// 投影行类型（与 DB 列一一对应）
// ---------------------------------------------------------------------------

/** `strategy_parameters` 行（ParameterDefinition 投影）。 */
export interface StrategyParameterProjectionRow {
  readonly code: string;
  readonly name: string;
  readonly dataType: string;
  readonly parameterRole: string;
  /** 默认值的 JSON 文本；无默认值 → null（与「默认值就是 null」区分）。 */
  readonly defaultValueJson: string | null;
  readonly minValue: number | null;
  readonly maxValue: number | null;
  readonly stepValue: number | null;
  readonly unit: string | null;
  readonly description: string | null;
  readonly required: boolean;
  readonly ordinal: number;
}

/** `strategy_entry_rules` 行（entry.conditions 投影；无 condition 时一行 EVENT_OBSERVATION）。 */
export interface StrategyEntryRuleProjectionRow {
  readonly ruleId: string;
  readonly ruleType: "CONDITION" | "EVENT_OBSERVATION";
  readonly eventType: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly windowUnit: string;
  readonly triggerType: string;
  readonly conditionJson: string | null;
  readonly conditionCount: number;
  readonly priority: number;
  readonly enabled: boolean;
}

/** `strategy_exit_rules` 行。 */
export interface StrategyExitRuleProjectionRow {
  readonly ruleId: string;
  readonly ruleType: string;
  readonly triggerType: string;
  readonly thresholdValue: number | null;
  readonly thresholdUnit: string | null;
  readonly parameterCode: string | null;
  readonly conditionJson: string | null;
  readonly priority: number;
  readonly enabled: boolean;
  readonly ordinal: number;
}

/** `strategy_execution_rules` 行（1:1）。 */
export interface StrategyExecutionRuleProjectionRow {
  readonly signalTiming: string;
  readonly executionTiming: string;
  readonly priceType: string;
  readonly quantityMethod: string;
  readonly lotSize: number;
  readonly slippageModel: string | null;
  readonly commissionModel: string | null;
  readonly executionConstraintsJson: string | null;
}

/** `strategy_version_datasets` 行（Dataset 绑定引用）。 */
export interface StrategyDatasetBindingProjectionRow {
  readonly datasetId: string;
  /** Dataset 版本 label / 快照（v2）；legacy 绑定为 rd-… 串。 */
  readonly datasetVersion: string;
  /** 🔴 STRATEGY-004：Dataset Registry 权威坐标（`dataset_version.id`）；legacy 绑定为 null。 */
  readonly datasetVersionId: number | null;
  readonly role: string;
  readonly note: string | null;
  readonly ordinal: number;
}

/** 一个版本的完整投影集合（5 类）。 */
export interface StrategyProjections {
  readonly parameters: readonly StrategyParameterProjectionRow[];
  readonly entryRules: readonly StrategyEntryRuleProjectionRow[];
  readonly exitRules: readonly StrategyExitRuleProjectionRow[];
  readonly executionRule: StrategyExecutionRuleProjectionRow;
  readonly datasetBindings: readonly StrategyDatasetBindingProjectionRow[];
}

/** 无 condition 时承载 event/window/trigger 的合成行 id。 */
export const STRATEGY_ENTRY_OBSERVATION_RULE_ID = "entry";

// ---------------------------------------------------------------------------
// 派生
// ---------------------------------------------------------------------------

function optionalJson(value: unknown): string | null {
  return value === undefined ? null : canonicalStringify(value);
}

function conditionRow(
  condition: ConditionDefinition,
  index: number,
  definition: StrategyDefinition,
): StrategyEntryRuleProjectionRow {
  const { entry } = definition;
  return {
    ruleId: resolveConditionId(condition, index),
    ruleType: "CONDITION",
    eventType: entry.event.type,
    windowStart: entry.observationWindow.start,
    windowEnd: entry.observationWindow.end,
    windowUnit: entry.observationWindow.unit,
    triggerType: entry.trigger.type,
    conditionJson: canonicalStringify(condition),
    conditionCount: entry.conditions.length,
    priority: index,
    enabled: condition.enabled,
  };
}

/**
 * 由 Canonical Definition 派生全部投影行（确定性、纯函数）。
 *
 * 设计要点：
 *   - `parameters` 按 Definition 内的顺序编号 `ordinal`（Definition 已被规范化按 `code` 升序）；
 *   - `entryRules` 每条 condition 一行、`priority` = 求值顺序；**无 condition 时仍写一行**
 *     （`ruleId="entry"` / `ruleType="EVENT_OBSERVATION"`），保证「研究什么事件、观察多久、
 *     何时触发」在无条件下也可查询，而不是因为没条件就丢失这三个关键事实；
 *   - `exitRules` 的 `ordinal` 即规范化后的顺序（priority 已升序）；
 *   - `datasetBindings` 只落引用，不复制任何 Dataset 数据。
 */
export function buildStrategyProjections(definition: StrategyDefinition): StrategyProjections {
  const { entry, exit, execution } = definition;

  const parameters: StrategyParameterProjectionRow[] = definition.parameters.map(
    (parameter: ParameterDefinition, index: number) => ({
      code: parameter.code,
      name: parameter.name,
      dataType: parameter.dataType,
      parameterRole: parameter.parameterRole,
      defaultValueJson: optionalJson(parameter.defaultValue),
      minValue: parameter.min ?? null,
      maxValue: parameter.max ?? null,
      stepValue: parameter.step ?? null,
      unit: parameter.unit ?? null,
      description: parameter.description ?? null,
      required: parameter.required,
      ordinal: index,
    }),
  );

  const entryRules: StrategyEntryRuleProjectionRow[] = entry.conditions.length > 0
    ? entry.conditions.map((condition, index) => conditionRow(condition, index, definition))
    : [{
      ruleId: STRATEGY_ENTRY_OBSERVATION_RULE_ID,
      ruleType: "EVENT_OBSERVATION",
      eventType: entry.event.type,
      windowStart: entry.observationWindow.start,
      windowEnd: entry.observationWindow.end,
      windowUnit: entry.observationWindow.unit,
      triggerType: entry.trigger.type,
      conditionJson: null,
      conditionCount: 0,
      priority: 0,
      enabled: true,
    }];

  const exitRules: StrategyExitRuleProjectionRow[] = exit.rules.map((rule, index) => ({
    ruleId: resolveExitRuleId(rule, index),
    ruleType: rule.type,
    triggerType: rule.trigger,
    thresholdValue: rule.threshold ?? null,
    thresholdUnit: rule.thresholdUnit ?? null,
    parameterCode: rule.parameter ?? null,
    conditionJson: optionalJson(rule.condition),
    priority: rule.priority,
    enabled: rule.enabled,
    ordinal: index,
  }));

  const executionRule: StrategyExecutionRuleProjectionRow = {
    signalTiming: execution.signalTiming,
    executionTiming: execution.executionTiming,
    priceType: execution.priceType,
    quantityMethod: execution.quantityMethod,
    lotSize: execution.lotSize,
    slippageModel: execution.slippageModel ?? null,
    commissionModel: execution.commissionModel ?? null,
    executionConstraintsJson: optionalJson(execution.executionConstraints),
  };

  const datasetBindings: StrategyDatasetBindingProjectionRow[] = definition.datasets.map((binding, index) => ({
    datasetId: binding.datasetId,
    datasetVersion: binding.datasetVersion,
    datasetVersionId: binding.datasetVersionId ?? null,
    role: binding.role,
    note: binding.note ?? null,
    ordinal: index,
  }));

  return { parameters, entryRules, exitRules, executionRule, datasetBindings };
}

// ---------------------------------------------------------------------------
// 漂移比对（SPEC §十七 / §十八）
// ---------------------------------------------------------------------------

function stableRowKey(row: Record<string, unknown>, from: readonly string[], fallback: string): string {
  const parts = from.map((field) => String(row[field]));
  return parts.length === 0 ? fallback : parts.join("|");
}

function diffRowSets(
  label: string,
  expected: readonly Record<string, unknown>[],
  actual: readonly Record<string, unknown>[],
  keyFields: readonly string[],
  compareFields: readonly string[],
): string[] {
  const drifts: string[] = [];
  const expectedByKey = new Map(expected.map((row, index) => [stableRowKey(row, keyFields, String(index)), row]));
  const actualByKey = new Map(actual.map((row, index) => [stableRowKey(row, keyFields, String(index)), row]));

  for (const [key, expectedRow] of expectedByKey) {
    const actualRow = actualByKey.get(key);
    if (actualRow === undefined) {
      drifts.push(`${label}[${key}] 缺失：canonical 定义了该行，但投影表中不存在`);
      continue;
    }
    for (const field of compareFields) {
      const left = canonicalStringify(expectedRow[field] ?? null);
      const right = canonicalStringify(actualRow[field] ?? null);
      if (left !== right) {
        drifts.push(`${label}[${key}].${field} 漂移：canonical=${left}，投影=${right}`);
      }
    }
  }
  for (const key of actualByKey.keys()) {
    if (!expectedByKey.has(key)) {
      drifts.push(`${label}[${key}] 多余：投影表存在该行，但 canonical 定义中不存在`);
    }
  }
  return drifts;
}

/**
 * 逐字段比对「canonical 期望投影」与「DB 实际投影」，返回漂移明细（空数组 = 一致）。
 *
 * 调用方（审计脚本 / 测试）在漂移非空时必须**响亮失败**，不得自动修复
 * （SPEC §十八：发现 `canonical != projection` 必须 exit 1）。
 */
export function verifyStrategyProjections(
  expected: StrategyProjections,
  actual: StrategyProjections,
): string[] {
  const drifts: string[] = [];

  drifts.push(...diffRowSets(
    "strategy_parameters",
    expected.parameters as unknown as Record<string, unknown>[],
    actual.parameters as unknown as Record<string, unknown>[],
    ["code"],
    ["name", "dataType", "parameterRole", "defaultValueJson", "minValue", "maxValue", "stepValue", "unit", "description", "required", "ordinal"],
  ));

  drifts.push(...diffRowSets(
    "strategy_entry_rules",
    expected.entryRules as unknown as Record<string, unknown>[],
    actual.entryRules as unknown as Record<string, unknown>[],
    ["ruleId"],
    ["ruleType", "eventType", "windowStart", "windowEnd", "windowUnit", "triggerType", "conditionJson", "conditionCount", "priority", "enabled"],
  ));

  drifts.push(...diffRowSets(
    "strategy_exit_rules",
    expected.exitRules as unknown as Record<string, unknown>[],
    actual.exitRules as unknown as Record<string, unknown>[],
    ["ruleId"],
    ["ruleType", "triggerType", "thresholdValue", "thresholdUnit", "parameterCode", "conditionJson", "priority", "enabled", "ordinal"],
  ));

  drifts.push(...diffRowSets(
    "strategy_execution_rules",
    [expected.executionRule as unknown as Record<string, unknown>],
    [actual.executionRule as unknown as Record<string, unknown>],
    [],
    ["signalTiming", "executionTiming", "priceType", "quantityMethod", "lotSize", "slippageModel", "commissionModel", "executionConstraintsJson"],
  ));

  drifts.push(...diffRowSets(
    "strategy_version_datasets",
    expected.datasetBindings as unknown as Record<string, unknown>[],
    actual.datasetBindings as unknown as Record<string, unknown>[],
    ["datasetId", "datasetVersion", "datasetVersionId", "role"],
    ["datasetVersionId", "note", "ordinal"],
  ));

  return drifts;
}
