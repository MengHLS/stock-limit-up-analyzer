/**
 * RESEARCH-001 — 条件研究模型测试（指令 §8 / §9）。
 *
 * 覆盖：值 arity 校验 / 组号连续 / 组内顺序唯一 / 扁平行 ⇄ 条件组互转 / 渲染。
 * 同时断言「**不是**一整段不可解析字符串」这一核心设计约束。
 */

import { describe, expect, it } from "vitest";
import {
  assertConditionSet,
  assertConditionSpec,
  flattenConditions,
  groupConditions,
  ResearchConditionError,
  renderConditionSet,
  type ResearchConditionSet,
  type ResearchConditionSpec,
} from "./conditions";
import type { ResearchAnalysisCondition } from "./types";

function spec(partial: Partial<ResearchConditionSpec>): ResearchConditionSpec {
  return {
    groupNo: 0,
    sortOrder: 0,
    fieldName: "turnover",
    operator: ">=",
    value: 8,
    logicalOperator: "AND",
    groupLogicalOperator: "AND",
    ...partial,
  };
}

/** 指令 §8 的示例：market_strength > 0.6 AND turnover ∈ [8,15] AND amount > 5e8 */
const EXAMPLE: ResearchConditionSet = {
  groups: [
    {
      groupNo: 0,
      groupLogicalOperator: "AND",
      conditions: [
        { groupNo: 0, sortOrder: 0, fieldName: "market_strength", operator: ">", value: 0.6, logicalOperator: "AND", groupLogicalOperator: "AND" },
        { groupNo: 0, sortOrder: 1, fieldName: "turnover", operator: ">=", value: 8, logicalOperator: "AND", groupLogicalOperator: "AND" },
        { groupNo: 0, sortOrder: 2, fieldName: "turnover", operator: "<=", value: 15, logicalOperator: "AND", groupLogicalOperator: "AND" },
      ],
    },
    {
      groupNo: 1,
      groupLogicalOperator: "AND",
      conditions: [
        { groupNo: 1, sortOrder: 0, fieldName: "amount", operator: ">", value: 500_000_000, logicalOperator: "AND", groupLogicalOperator: "AND" },
      ],
    },
  ],
};

describe("Research 条件（结构化，非字符串）", () => {
  it("指令 §8 示例条件集合通过校验", () => {
    expect(() => assertConditionSet(EXAMPLE)).not.toThrow();
  });

  it("条件以结构化字段表达（fieldName / operator / value 分离）", () => {
    const rows = flattenConditions(EXAMPLE, 1001);
    expect(rows.length).toBe(4);
    const first = rows[0];
    expect(first.analysisId).toBe(1001);
    expect(first.fieldName).toBe("market_strength");
    expect(first.operator).toBe(">");
    expect(first.value).toBe(0.6);
    // 明确反例：不得把整段条件塞进单个字符串
    expect(typeof first.fieldName).toBe("string");
    expect(typeof first.operator).toBe("string");
    expect(typeof first.value).not.toBe("string");
  });

  it("组内 sortOrder 保持确定性顺序", () => {
    const rows = flattenConditions(EXAMPLE, 1);
    const group0 = rows.filter((r) => r.groupNo === 0);
    expect(group0.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    expect(group0.map((r) => r.fieldName)).toEqual(["market_strength", "turnover", "turnover"]);
  });

  it("扁平行 → 条件组可往返（groupConditions 逆运算）", () => {
    const rows: ResearchAnalysisCondition[] = flattenConditions(EXAMPLE, 7).map((r, i) => ({
      ...r,
      id: i + 1,
      createdAt: "2026-09-10T00:00:00.000Z",
    }));
    const groups = groupConditions(rows);
    expect(groups.length).toBe(2);
    expect(groups[0].conditions.length).toBe(3);
    expect(groups[1].conditions[0].fieldName).toBe("amount");
    expect(() => assertConditionSet({ groups })).not.toThrow();
  });

  it("组号不连续被拒绝（不静默通过）", () => {
    const g = EXAMPLE.groups[1];
    const broken: ResearchConditionSet = {
      groups: [
        {
          groupNo: 3,
          groupLogicalOperator: "AND",
          conditions: g.conditions.map((c) => ({ ...c, groupNo: 3 })),
        },
      ],
    };
    expect(() => assertConditionSet(broken)).toThrow(/缺少 0/);
  });

  it("组内 sortOrder 重复被拒绝", () => {
    const dup: ResearchConditionSet = {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "AND",
          conditions: [spec({ sortOrder: 0 }), spec({ sortOrder: 0, fieldName: "amount" })],
        },
      ],
    };
    expect(() => assertConditionSet(dup)).toThrow(/sortOrder 重复/);
  });

  it("BETWEEN 需要 [下界, 上界] 且下界 ≤ 上界", () => {
    expect(() =>
      assertConditionSpec(spec({ operator: "BETWEEN", value: [8, 15] })),
    ).not.toThrow();
    expect(() => assertConditionSpec(spec({ operator: "BETWEEN", value: [15, 8] }))).toThrow(
      ResearchConditionError,
    );
    expect(() => assertConditionSpec(spec({ operator: "BETWEEN", value: [8] }))).toThrow(
      /两个数字/,
    );
  });

  it("IS_NULL / IS_NOT_NULL 不接受 value", () => {
    expect(() =>
      assertConditionSpec(spec({ operator: "IS_NULL", value: null })),
    ).not.toThrow();
    expect(() => assertConditionSpec(spec({ operator: "IS_NULL", value: 1 }))).toThrow(/不接受 value/);
  });

  it("IN / NOT_IN 需要非空数组", () => {
    expect(() => assertConditionSpec(spec({ operator: "IN", value: ["a", "b"] }))).not.toThrow();
    expect(() => assertConditionSpec(spec({ operator: "IN", value: [] }))).toThrow(/不能为空/);
  });

  it("非法 operator 被拒绝", () => {
    expect(() =>
      assertConditionSpec(spec({ operator: "LIKE" as unknown as ResearchConditionSpec["operator"] })),
    ).toThrow(/非法 operator/);
  });

  it("非法 groupLogicalOperator 被拒绝", () => {
    expect(() =>
      assertConditionSpec(spec({ groupLogicalOperator: "XOR" as unknown as "AND" })),
    ).toThrow(/非法 groupLogicalOperator/);
  });

  it("支持 OR / NOT（条件组扩展预留）", () => {
    const orSet: ResearchConditionSet = {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "OR",
          conditions: [
            spec({ sortOrder: 0, operator: ">", value: 0.6, logicalOperator: "OR" }),
            spec({ sortOrder: 1, fieldName: "regime", operator: "==", value: "STRONG", logicalOperator: "NOT" }),
          ],
        },
      ],
    };
    expect(() => assertConditionSet(orSet)).not.toThrow();
    // NOT 语义 = 「AND NOT」（见 types.ts#RESEARCH_LOGICAL_OPERATORS 注释）
    expect(renderConditionSet(orSet)).toBe('(turnover > 0.6 AND NOT regime == "STRONG")');
  });

  it("NOT 为组内首条时渲染为「NOT cond」", () => {
    const set: ResearchConditionSet = {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "AND",
          conditions: [spec({ operator: "IS_NULL", value: null, logicalOperator: "NOT" })],
        },
      ],
    };
    expect(renderConditionSet(set)).toBe("(NOT turnover IS_NULL)");
  });

  it("「OR + 取反」通过条件组表达（组内 AND NOT + 组间 OR）", () => {
    const set: ResearchConditionSet = {
      groups: [
        { groupNo: 0, groupLogicalOperator: "AND", conditions: [spec({ fieldName: "x", operator: ">", value: 1 })] },
        {
          groupNo: 1,
          groupLogicalOperator: "OR",
          conditions: [spec({ groupNo: 1, fieldName: "y", operator: "==", value: 2, logicalOperator: "NOT" })],
        },
      ],
    };
    expect(() => assertConditionSet(set)).not.toThrow();
    expect(renderConditionSet(set)).toBe('(x > 1) OR (NOT y == 2)');
  });

  it("渲染结果可读（用于报告引用）", () => {
    const rendered = renderConditionSet(EXAMPLE);
    expect(rendered).toContain("market_strength > 0.6");
    expect(rendered).toContain("turnover <= 15");
    expect(rendered).toContain("amount > 500000000");
    expect(rendered.split("(").length - 1).toBe(2);
  });
});
