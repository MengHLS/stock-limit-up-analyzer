/**
 * RESEARCH-001 — 条件研究领域模型（条件 / 条件组 / 装配 / 校验 / 渲染）。
 *
 * 边界：
 *   - 只做**条件的领域表达与结构校验**，不做任何统计计算，也不做数据求值（属 Research Engine）；
 *   - 持久化形态是**扁平行**（`research_analysis_condition`），本文件提供「扁平行 ⇄ 条件组」互转；
 *   - 第一版不做完整 AST，但结构已能表达 `AND` / `OR` / `NOT` 与条件组，满足指令 §8 的扩展预留。
 */

import {
  RESEARCH_CONDITION_OPERATORS,
  RESEARCH_GROUP_LOGICAL_OPERATORS,
  RESEARCH_LOGICAL_OPERATORS,
  type ResearchAnalysisCondition,
  type ResearchConditionOperator,
  type ResearchGroupLogicalOperator,
  type ResearchLogicalOperator,
} from "./types";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 条件值形态（与 `valueJson` 一一对应）。 */
export type ResearchConditionValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<string | number>
  | readonly [number, number];

/** 单条条件（领域形态，未落库；`analysisId` / `id` 由 Repository 补）。 */
export interface ResearchConditionSpec {
  groupNo: number;
  sortOrder: number;
  fieldName: string;
  operator: ResearchConditionOperator;
  value: ResearchConditionValue;
  logicalOperator: ResearchLogicalOperator;
  groupLogicalOperator: ResearchGroupLogicalOperator;
}

/** 条件组（由同一 `groupNo` 的扁平行聚合而成）。 */
export interface ResearchConditionGroup {
  groupNo: number;
  /** 与**前一条件组**的连接符（首个组无前序，值被忽略但保留以维持列非空）。 */
  groupLogicalOperator: ResearchGroupLogicalOperator;
  conditions: ResearchConditionSpec[];
}

/** 条件组集合（前端 / Candidate 规则复用同一形态）。 */
export interface ResearchConditionSet {
  groups: ResearchConditionGroup[];
}

// ---------------------------------------------------------------------------
// 常量集合（供校验使用）
// ---------------------------------------------------------------------------

export const CONDITION_VALUE_ARITY: Record<ResearchConditionOperator, "none" | "one" | "two-or-list"> = {
  ">": "one",
  ">=": "one",
  "<": "one",
  "<=": "one",
  "==": "one",
  "!=": "one",
  IN: "two-or-list",
  NOT_IN: "two-or-list",
  BETWEEN: "two-or-list",
  IS_NULL: "none",
  IS_NOT_NULL: "none",
};

export class ResearchConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchConditionError";
  }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export function isConditionOperator(value: string): value is ResearchConditionOperator {
  return (RESEARCH_CONDITION_OPERATORS as readonly string[]).includes(value);
}

export function isLogicalOperator(value: string): value is ResearchLogicalOperator {
  return (RESEARCH_LOGICAL_OPERATORS as readonly string[]).includes(value);
}

export function isGroupLogicalOperator(value: string): value is ResearchGroupLogicalOperator {
  return (RESEARCH_GROUP_LOGICAL_OPERATORS as readonly string[]).includes(value);
}

/**
 * 校验单条条件。非法即抛错（**不静默夹取**，与项目 INVALID_BUILD_FILTER 风格一致）。
 */
export function assertConditionSpec(spec: ResearchConditionSpec): void {
  if (!Number.isInteger(spec.groupNo) || spec.groupNo < 0) {
    throw new ResearchConditionError(`非法 groupNo：${String(spec.groupNo)}（须为非负整数）`);
  }
  if (!Number.isInteger(spec.sortOrder) || spec.sortOrder < 0) {
    throw new ResearchConditionError(`非法 sortOrder：${String(spec.sortOrder)}（须为非负整数）`);
  }
  if (typeof spec.fieldName !== "string" || spec.fieldName.trim().length === 0) {
    throw new ResearchConditionError("fieldName 不能为空");
  }
  if (!isConditionOperator(spec.operator)) {
    throw new ResearchConditionError(`非法 operator：${String(spec.operator)}`);
  }
  if (!isLogicalOperator(spec.logicalOperator)) {
    throw new ResearchConditionError(`非法 logicalOperator：${String(spec.logicalOperator)}`);
  }
  if (!isGroupLogicalOperator(spec.groupLogicalOperator)) {
    throw new ResearchConditionError(`非法 groupLogicalOperator：${String(spec.groupLogicalOperator)}`);
  }

  const arity = CONDITION_VALUE_ARITY[spec.operator];
  const v = spec.value;
  if (arity === "none") {
    if (v !== null && v !== undefined) {
      throw new ResearchConditionError(`operator ${spec.operator} 不接受 value（实得 ${JSON.stringify(v)}）`);
    }
    return;
  }
  if (v === null || v === undefined) {
    throw new ResearchConditionError(`operator ${spec.operator} 需要 value`);
  }
  if (arity === "one") {
    if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean") {
      throw new ResearchConditionError(`operator ${spec.operator} 的 value 须为标量（数字 / 字符串 / 布尔）`);
    }
    return;
  }
  // two-or-list
  if (!Array.isArray(v)) {
    throw new ResearchConditionError(`operator ${spec.operator} 的 value 须为数组`);
  }
  if (spec.operator === "BETWEEN") {
    if (v.length !== 2 || !v.every((x) => typeof x === "number")) {
      throw new ResearchConditionError("BETWEEN 的 value 须为 [下界, 上界] 两个数字");
    }
    if ((v[0] as number) > (v[1] as number)) {
      throw new ResearchConditionError(`BETWEEN 下界 > 上界：[${v[0]}, ${v[1]}]`);
    }
    return;
  }
  if (v.length === 0) {
    throw new ResearchConditionError(`operator ${spec.operator} 的 value 数组不能为空`);
  }
  if (!v.every((x) => typeof x === "number" || typeof x === "string")) {
    throw new ResearchConditionError(`operator ${spec.operator} 的 value 数组元素须为数字或字符串`);
  }
}

/** 校验整个条件组集合：组号唯一且连续（0..n-1）、组内 sortOrder 唯一。 */
export function assertConditionSet(set: ResearchConditionSet): void {
  if (set.groups.length === 0) return;
  const seen = new Set<number>();
  for (const g of set.groups) {
    if (seen.has(g.groupNo)) throw new ResearchConditionError(`条件组号重复：${g.groupNo}`);
    seen.add(g.groupNo);
    if (!isGroupLogicalOperator(g.groupLogicalOperator)) {
      throw new ResearchConditionError(`非法 groupLogicalOperator：${String(g.groupLogicalOperator)}`);
    }
    const orders = new Set<number>();
    for (const c of g.conditions) {
      if (c.groupNo !== g.groupNo) {
        throw new ResearchConditionError(`组 ${g.groupNo} 内的条件 groupNo=${c.groupNo} 不一致`);
      }
      if (orders.has(c.sortOrder)) {
        throw new ResearchConditionError(`组 ${g.groupNo} 内 sortOrder 重复：${c.sortOrder}`);
      }
      orders.add(c.sortOrder);
      assertConditionSpec(c);
    }
  }
  for (let i = 0; i < set.groups.length; i++) {
    if (!seen.has(i)) throw new ResearchConditionError(`条件组号不连续，缺少 ${i}`);
  }
}

// ---------------------------------------------------------------------------
// 扁平行 ⇄ 条件组
// ---------------------------------------------------------------------------

/** 扁平行（含 id / analysisId）→ 条件组集合。 */
export function groupConditions(rows: ResearchAnalysisCondition[]): ResearchConditionGroup[] {
  const byGroup = new Map<number, ResearchAnalysisCondition[]>();
  for (const r of rows) {
    const list = byGroup.get(r.groupNo);
    if (list === undefined) byGroup.set(r.groupNo, [r]);
    else list.push(r);
  }
  const groupNos = [...byGroup.keys()].sort((a, b) => a - b);
  return groupNos.map((no) => {
    const items = (byGroup.get(no) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      groupNo: no,
      groupLogicalOperator: items[0]?.groupLogicalOperator ?? "AND",
      conditions: items.map((r) => ({
        groupNo: r.groupNo,
        sortOrder: r.sortOrder,
        fieldName: r.fieldName,
        operator: r.operator,
        value: r.value as ResearchConditionValue,
        logicalOperator: r.logicalOperator,
        groupLogicalOperator: r.groupLogicalOperator,
      })),
    };
  });
}

/** 条件组集合 → 扁平行（`analysisId` 由调用方补齐）。 */
export function flattenConditions(
  set: ResearchConditionSet,
  analysisId?: number,
): Array<Omit<ResearchAnalysisCondition, "id" | "createdAt">> {
  assertConditionSet(set);
  const out: Array<Omit<ResearchAnalysisCondition, "id" | "createdAt">> = [];
  for (const g of set.groups) {
    for (const c of g.conditions) {
      out.push({
        analysisId: analysisId ?? 0,
        groupNo: g.groupNo,
        sortOrder: c.sortOrder,
        fieldName: c.fieldName,
        operator: c.operator,
        value: c.value,
        logicalOperator: c.logicalOperator,
        groupLogicalOperator: g.groupLogicalOperator,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 人类可读渲染（**不是**求值器；仅供展示 / 审计 / 报告引用）
// ---------------------------------------------------------------------------

/** 渲染单条条件，如 `turnover BETWEEN [8,15]`。 */
export function renderCondition(spec: ResearchConditionSpec): string {
  const arity = CONDITION_VALUE_ARITY[spec.operator];
  if (arity === "none") return `${spec.fieldName} ${spec.operator}`;
  if (arity === "one") return `${spec.fieldName} ${spec.operator} ${JSON.stringify(spec.value)}`;
  return `${spec.fieldName} ${spec.operator} ${JSON.stringify(spec.value)}`;
}

/** 渲染整个条件集合，如 `(a > 1 AND b <= 2) AND (c IN [1,2,3])`。 */
export function renderConditionSet(set: ResearchConditionSet): string {
  return set.groups
    .map((g, idx) => {
      const rendered = g.conditions.map((c, i) => {
        const body = `${c.logicalOperator === "NOT" ? "NOT " : ""}${renderCondition(c)}`;
        if (i === 0) return body;
        // `NOT` 作为一元取反，连接符回退为 AND（见 RESEARCH_LOGICAL_OPERATORS 注释）。
        const connector = c.logicalOperator === "NOT" ? "AND" : c.logicalOperator;
        return `${connector} ${body}`;
      });
      const head = idx === 0 ? "" : `${g.groupLogicalOperator} `;
      return `${head}(${rendered.join(" ")})`;
    })
    .join(" ");
}
