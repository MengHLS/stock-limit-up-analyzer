/**
 * RESEARCH-002 — 条件求值器（把 `research_analysis_condition` 的结构化条件翻译成样本过滤）。
 *
 * 复用 RESEARCH-001 已固化的领域模型（`researchCore/conditions.ts` 的 `ResearchConditionSet`），
 * **不重新设计条件结构、不改数据库、不引入完整 AST**。
 *
 * 精确语义（消除歧义，与 `RESEARCH_LOGICAL_OPERATORS` 注释一致）：
 *   - 组内首条条件的 `logicalOperator` 忽略；其余条件：
 *       `AND` → `prev AND cond`
 *       `OR`  → `prev OR cond`
 *       `NOT` → `prev AND NOT cond`（取反 + AND，**不是**连接符）
 *   - 组间按 `groupLogicalOperator` 左结合（`(g0) OR (g1) AND (g2)` 从左到右）。
 *   - **null 参与比较一律为 false**（未知 ≠ 满足），只有 `IS_NULL` / `IS_NOT_NULL` 例外。
 *     这条是刻意的保守选择：宁可少算样本，也不让缺失值冒充「满足条件」。
 */

import type { ResearchConditionSet, ResearchConditionSpec } from "../researchCore";

/** 可比较的字段取值。 */
export type ResearchFieldValue = string | number | boolean | null | undefined;

/** 字段解析器（feature 变量 / outcome 变量 / 分组维度）。 */
export type ResearchFieldResolver = (fieldName: string) => ResearchFieldValue;

function isNullish(v: ResearchFieldValue): boolean {
  return v === null || v === undefined;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

/** 求值单条条件。 */
export function evaluateCondition(spec: ResearchConditionSpec, value: ResearchFieldValue): boolean {
  switch (spec.operator) {
    case "IS_NULL":
      return isNullish(value);
    case "IS_NOT_NULL":
      return !isNullish(value);
    default:
      break;
  }
  if (isNullish(value)) return false;

  switch (spec.operator) {
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const left = asNumber(value);
      const right = asNumber(spec.value as ResearchFieldValue);
      if (left === null || right === null) return false;
      if (spec.operator === ">") return left > right;
      if (spec.operator === ">=") return left >= right;
      if (spec.operator === "<") return left < right;
      return left <= right;
    }
    case "==": {
      const left = asNumber(value);
      const right = asNumber(spec.value as ResearchFieldValue);
      if (left !== null && right !== null) return left === right;
      return value === (spec.value as ResearchFieldValue);
    }
    case "!=": {
      const left = asNumber(value);
      const right = asNumber(spec.value as ResearchFieldValue);
      if (left !== null && right !== null) return left !== right;
      return value !== (spec.value as ResearchFieldValue);
    }
    case "IN":
    case "NOT_IN": {
      const list = asArray(spec.value);
      if (list === null) return false;
      const hit = list.some((item) => item === value || (asNumber(item) !== null && asNumber(item) === asNumber(value)));
      return spec.operator === "IN" ? hit : !hit;
    }
    case "BETWEEN": {
      const list = asArray(spec.value);
      if (list === null || list.length !== 2) return false;
      const low = asNumber(list[0] as ResearchFieldValue);
      const high = asNumber(list[1] as ResearchFieldValue);
      const x = asNumber(value);
      if (low === null || high === null || x === null) return false;
      // 闭区间 [low, high]；low > high 视为配置错误 → 不满足（不静默交换）。
      return x >= low && x <= high;
    }
    default:
      return false;
  }
}

/** 求值单个条件组（组内按 logicalOperator 左结合）。 */
export function evaluateConditionGroup(
  conditions: readonly ResearchConditionSpec[],
  resolve: ResearchFieldResolver,
): boolean {
  const ordered = [...conditions].sort((a, b) => a.sortOrder - b.sortOrder);
  let acc: boolean | null = null;
  for (let i = 0; i < ordered.length; i += 1) {
    const spec = ordered[i]!;
    const value = resolve(spec.fieldName);
    const raw = evaluateCondition(spec, value);
    if (i === 0 || acc === null) {
      acc = raw;
      continue;
    }
    if (spec.logicalOperator === "OR") acc = acc || raw;
    else if (spec.logicalOperator === "NOT") acc = acc && !raw;
    else acc = acc && raw;
  }
  return acc ?? true;
}

/**
 * 求值整个条件集合。
 * **空条件集 = 恒真**（无条件 = 不过滤），这与「无过滤的 QUANTILE 分析」语义一致。
 */
export function evaluateConditionSet(set: ResearchConditionSet, resolve: ResearchFieldResolver): boolean {
  const groups = [...set.groups].sort((a, b) => a.groupNo - b.groupNo);
  if (groups.length === 0) return true;
  let acc: boolean | null = null;
  for (const group of groups) {
    const raw = evaluateConditionGroup(group.conditions, resolve);
    if (acc === null) acc = raw;
    else acc = group.groupLogicalOperator === "OR" ? acc || raw : acc && raw;
  }
  return acc ?? true;
}
