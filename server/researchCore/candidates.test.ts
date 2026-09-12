/**
 * RESEARCH-001 — 策略候选模型测试（指令 §12 / §24）。
 *
 * 关键不变量：
 *   - `strategyDefinitionId = null` 是**合法状态**（尚未转正）；
 *   - Candidate 状态机受约束；`CONVERTED` 必须有 `strategyDefinitionId`；
 *   - 未转正状态不得已挂 Strategy。
 */

import { describe, expect, it } from "vitest";
import {
  assertCandidateConversionCoherence,
  assertCandidateInput,
  assertCandidateTransition,
  isCandidateTransitionAllowed,
  ResearchCandidateError,
  type ResearchCandidateRuleSet,
} from "./candidates";

describe("策略候选（Research 出口）", () => {
  it("strategyDefinitionId 为 null 合法（尚未转正）", () => {
    expect(() =>
      assertCandidateInput({
        experimentId: 1,
        name: "首板换手率 8~15% T+5",
        status: "DRAFT",
        strategyDefinitionId: null,
      }),
    ).not.toThrow();
  });

  it("strategyDefinitionId 为 undefined 合法", () => {
    expect(() =>
      assertCandidateInput({
        experimentId: 1,
        name: "c",
        status: "DRAFT",
        strategyDefinitionId: undefined,
      }),
    ).not.toThrow();
  });

  it("空 strategyDefinitionId 被拒绝（要么 null，要么非空）", () => {
    expect(() =>
      assertCandidateInput({
        experimentId: 1,
        name: "c",
        status: "DRAFT",
        strategyDefinitionId: "   ",
      }),
    ).toThrow(/非空字符串/);
  });

  it("非法 experimentId 被拒绝", () => {
    expect(() =>
      assertCandidateInput({ experimentId: 0, name: "c", status: "DRAFT", strategyDefinitionId: null }),
    ).toThrow(/非法 experimentId/);
  });

  it("空名称被拒绝", () => {
    expect(() =>
      assertCandidateInput({ experimentId: 1, name: " ", status: "DRAFT", strategyDefinitionId: null }),
    ).toThrow(/不能为空/);
  });

  it("状态机：DRAFT → REVIEW → ACCEPTED → CONVERTED", () => {
    expect(isCandidateTransitionAllowed("DRAFT", "REVIEW")).toBe(true);
    expect(isCandidateTransitionAllowed("REVIEW", "ACCEPTED")).toBe(true);
    expect(isCandidateTransitionAllowed("ACCEPTED", "CONVERTED")).toBe(true);
    expect(() => assertCandidateTransition("DRAFT", "REVIEW")).not.toThrow();
  });

  it("状态机：非法迁移被拒绝", () => {
    expect(isCandidateTransitionAllowed("DRAFT", "CONVERTED")).toBe(false);
    expect(() => assertCandidateTransition("DRAFT", "CONVERTED")).toThrow(ResearchCandidateError);
    expect(() => assertCandidateTransition("ARCHIVED", "DRAFT")).toThrow(/非法候选状态迁移/);
    expect(() => assertCandidateTransition("CONVERTED", "REVIEW")).toThrow(ResearchCandidateError);
  });

  it("转正一致性：CONVERTED 必须带 strategyDefinitionId", () => {
    expect(() =>
      assertCandidateConversionCoherence({ status: "CONVERTED", strategyDefinitionId: null }),
    ).toThrow(/必须提供 strategyDefinitionId/);
    expect(() =>
      assertCandidateConversionCoherence({ status: "CONVERTED", strategyDefinitionId: "limit-up-baseline" }),
    ).not.toThrow();
  });

  it("转正一致性：非 CONVERTED 状态不得已绑定策略", () => {
    expect(() =>
      assertCandidateConversionCoherence({ status: "ACCEPTED", strategyDefinitionId: "limit-up-baseline" }),
    ).toThrow(/不应已绑定 strategyDefinitionId/);
  });

  it("filterRule 复用条件集合校验（与 Analysis 条件同构）", () => {
    const rules: ResearchCandidateRuleSet = {
      entryRule: { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" },
      filterRule: {
        groups: [
          {
            groupNo: 0,
            groupLogicalOperator: "AND",
            conditions: [
              { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: "BETWEEN", value: [8, 15], logicalOperator: "AND", groupLogicalOperator: "AND" },
            ],
          },
        ],
      },
      exitRule: { holdingDays: 5 },
      riskRule: { maxPositions: 3 },
      parameterSpace: { turnoverLow: { type: "number", min: 5, max: 12, step: 1 } },
    };
    expect(() =>
      assertCandidateInput({
        experimentId: 1,
        name: "c",
        status: "DRAFT",
        strategyDefinitionId: null,
        filterRule: rules.filterRule,
      }),
    ).not.toThrow();
  });

  it("非法 filterRule 会被拒绝（不静默通过）", () => {
    expect(() =>
      assertCandidateInput({
        experimentId: 1,
        name: "c",
        status: "DRAFT",
        strategyDefinitionId: null,
        filterRule: {
          groups: [
            {
              groupNo: 0,
              groupLogicalOperator: "AND",
              conditions: [
                { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: "BETWEEN", value: [15, 8], logicalOperator: "AND", groupLogicalOperator: "AND" },
              ],
            },
          ],
        },
      }),
    ).toThrow(/下界 > 上界/);
  });
});
