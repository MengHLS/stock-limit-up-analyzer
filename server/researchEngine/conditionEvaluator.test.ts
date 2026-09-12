/**
 * RESEARCH-002 — 条件求值器测试（单条件 / AND / OR / NOT / 空条件 / null 语义）。
 */

import { describe, expect, it } from "vitest";
import type { ResearchConditionSet, ResearchConditionSpec } from "../researchCore";
import { evaluateConditionSet, type ResearchFieldResolver } from "./conditionEvaluator";

function spec(overrides: Partial<ResearchConditionSpec>): ResearchConditionSpec {
  return {
    groupNo: 0,
    sortOrder: 0,
    fieldName: "turnover",
    operator: ">",
    value: 8,
    logicalOperator: "AND",
    groupLogicalOperator: "AND",
    ...overrides,
  };
}

function oneGroup(conditions: ResearchConditionSpec[]): ResearchConditionSet {
  return { groups: [{ groupNo: 0, groupLogicalOperator: "AND", conditions }] };
}

function resolver(fields: Record<string, number | string | null>): ResearchFieldResolver {
  return (name) => fields[name] ?? null;
}

describe("条件求值器", () => {
  it("空条件集 = 恒真（无条件即不过滤）", () => {
    expect(evaluateConditionSet({ groups: [] }, () => 1)).toBe(true);
  });

  it("单条件：数值比较", () => {
    const set = oneGroup([spec({ operator: ">", value: 8 })]);
    expect(evaluateConditionSet(set, resolver({ turnover: 12 }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 8 }))).toBe(false);
    expect(evaluateConditionSet(set, resolver({ turnover: 3 }))).toBe(false);
  });

  it("AND 条件：全部满足才通过", () => {
    const set = oneGroup([
      spec({ sortOrder: 0, fieldName: "turnover", operator: ">=", value: 8 }),
      spec({ sortOrder: 1, fieldName: "turnover", operator: "<=", value: 15, logicalOperator: "AND" }),
    ]);
    expect(evaluateConditionSet(set, resolver({ turnover: 10 }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 20 }))).toBe(false);
    expect(evaluateConditionSet(set, resolver({ turnover: 5 }))).toBe(false);
  });

  it("OR 条件：任一满足即通过", () => {
    const set = oneGroup([
      spec({ sortOrder: 0, fieldName: "turnover", operator: ">", value: 20 }),
      spec({ sortOrder: 1, fieldName: "board", operator: "==", value: "chinext", logicalOperator: "OR" }),
    ]);
    expect(evaluateConditionSet(set, resolver({ turnover: 5, board: "chinext" }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 30, board: "main" }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 5, board: "main" }))).toBe(false);
  });

  it("NOT = 「AND NOT」（取反 + AND），不是连接符", () => {
    const set = oneGroup([
      spec({ sortOrder: 0, fieldName: "turnover", operator: ">", value: 8 }),
      spec({ sortOrder: 1, fieldName: "board", operator: "==", value: "star", logicalOperator: "NOT" }),
    ]);
    expect(evaluateConditionSet(set, resolver({ turnover: 10, board: "main" }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 10, board: "star" }))).toBe(false);
  });

  it("BETWEEN 为闭区间 [low, high]；区间反转视为不满足（不静默交换）", () => {
    expect(
      evaluateConditionSet(oneGroup([spec({ operator: "BETWEEN", value: [8, 15] })]), resolver({ turnover: 8 })),
    ).toBe(true);
    expect(
      evaluateConditionSet(oneGroup([spec({ operator: "BETWEEN", value: [8, 15] })]), resolver({ turnover: 15 })),
    ).toBe(true);
    expect(
      evaluateConditionSet(oneGroup([spec({ operator: "BETWEEN", value: [15, 8] })]), resolver({ turnover: 10 })),
    ).toBe(false);
  });

  it("IN / NOT_IN", () => {
    expect(
      evaluateConditionSet(oneGroup([spec({ fieldName: "board", operator: "IN", value: ["main", "chinext"] })]), resolver({ board: "main" })),
    ).toBe(true);
    expect(
      evaluateConditionSet(oneGroup([spec({ fieldName: "board", operator: "NOT_IN", value: ["main"] })]), resolver({ board: "star" })),
    ).toBe(true);
  });

  it("null 参与比较一律为 false（除 IS_NULL / IS_NOT_NULL）", () => {
    expect(evaluateConditionSet(oneGroup([spec({ operator: ">", value: 0 })]), resolver({ turnover: null }))).toBe(false);
    expect(evaluateConditionSet(oneGroup([spec({ operator: "!=", value: 5 })]), resolver({ turnover: null }))).toBe(false);
    expect(evaluateConditionSet(oneGroup([spec({ operator: "IS_NULL", value: null })]), resolver({ turnover: null }))).toBe(true);
    expect(evaluateConditionSet(oneGroup([spec({ operator: "IS_NOT_NULL", value: null })]), resolver({ turnover: 3 }))).toBe(true);
  });

  it("条件组之间按 groupLogicalOperator 左结合（组 1 的 OR 表示 (g0) OR (g1)）", () => {
    const set: ResearchConditionSet = {
      groups: [
        { groupNo: 0, groupLogicalOperator: "AND", conditions: [spec({ groupNo: 0, fieldName: "turnover", operator: ">", value: 8 })] },
        { groupNo: 1, groupLogicalOperator: "OR", conditions: [spec({ groupNo: 1, fieldName: "board", operator: "==", value: "chinext" })] },
      ],
    };
    expect(evaluateConditionSet(set, resolver({ turnover: 10, board: "chinext" }))).toBe(true);
    // g0 已为真 → (g0) OR (g1) 恒真，即使 g1 不满足
    expect(evaluateConditionSet(set, resolver({ turnover: 10, board: "main" }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 1, board: "chinext" }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 1, board: "main" }))).toBe(false);
  });

  it("条件组之间按 AND 时须全部满足", () => {
    const set: ResearchConditionSet = {
      groups: [
        { groupNo: 0, groupLogicalOperator: "AND", conditions: [spec({ groupNo: 0, fieldName: "turnover", operator: ">", value: 8 })] },
        { groupNo: 1, groupLogicalOperator: "AND", conditions: [spec({ groupNo: 1, fieldName: "board", operator: "==", value: "chinext" })] },
      ],
    };
    expect(evaluateConditionSet(set, resolver({ turnover: 10, board: "chinext" }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 10, board: "main" }))).toBe(false);
    expect(evaluateConditionSet(set, resolver({ turnover: 1, board: "chinext" }))).toBe(false);
  });

  it("组内条件按 sortOrder 排序后求值（与输入顺序无关）", () => {
    const set = oneGroup([
      spec({ sortOrder: 5, fieldName: "turnover", operator: "<=", value: 15, logicalOperator: "AND" }),
      spec({ sortOrder: 1, fieldName: "turnover", operator: ">=", value: 8 }),
    ]);
    expect(evaluateConditionSet(set, resolver({ turnover: 10 }))).toBe(true);
    expect(evaluateConditionSet(set, resolver({ turnover: 20 }))).toBe(false);
  });
});
