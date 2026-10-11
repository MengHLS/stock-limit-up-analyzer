/**
 * EVENT-STATE-LONG-EXECUTION-PARITY-001 · 回归锁：
 * legacy 入场**没有 enabled 条件**时，`WINDOW` 节点仍必须进规则图。
 *
 * 背景（本轮实测缺陷）：`LAST_VALID_DAY` / `FIRST_VALID_DAY` 的候选日集合由窗口
 * （`ruleGraph.ts#triggerCandidateDays` 读 WINDOW journal 的 `validDays`）定义。
 * 丢掉 WINDOW ⇒ `validDays` 为空 ⇒ 触发退化为「当前日即候选日」⇒ 每个决策日都成立；
 * 生产决策源用「首个成立日」转移判据（`satisfiedToday && !satisfiedBefore`），
 * 而事件窗数据集只在决策日暴露成员 ⇒ **转移日永不出现 ⇒ 0 信号**。
 *
 * 本测试锁三件事：
 *   1. 无条件入场也产出 WINDOW（子节点为显式恒真条件 `entry.window.always`）；
 *   2. 有声明的条件时行为不变（WINDOW 包 `ALL[conditions]`）；
 *   3. 两种形态都通过 `validateRuleGraph`（不放松既有守卫：空 `ALL` 仍被拒绝）。
 */

import { describe, expect, it } from "vitest";
import type { StrategyDefinition as LegacyStrategyDefinition } from "../../../server/research/strategySchema/definition";
import { fromLegacyStrategyDefinition } from "../../../server/strategyCore/adapters/legacyDefinition";
import { validateRuleGraph, type RuleNode } from "../../../server/strategyCore/ruleGraph";

function legacyWith(conditions: readonly unknown[]): LegacyStrategyDefinition {
  return {
    schemaVersion: "1.0",
    datasets: [
      { datasetId: "first_limit_pullback", datasetVersion: "v-test", role: "PRIMARY" },
    ],
    entry: {
      event: { type: "FIRST_LIMIT_UP", params: { limitUpRatio: 0.1 } },
      observationWindow: { start: 15, end: 15, unit: "TRADING_DAY" },
      trigger: { type: "LAST_VALID_DAY" },
      conditions,
    },
    exit: {
      rules: [
        {
          id: "exit-time-40",
          type: "TIME_EXIT",
          trigger: "ON_CLOSE",
          enabled: true,
          threshold: 40,
          thresholdUnit: "TRADING_DAY",
          priority: 0,
        },
      ],
    },
    execution: {
      signalTiming: "T_CLOSE",
      executionTiming: "T_PLUS_1_OPEN",
      priceType: "OPEN",
    },
    parameters: [],
    position: { sizingMethod: "EQUAL_WEIGHT", maxPositions: 180 },
    risk: { maxPositions: 180 },
  } as unknown as LegacyStrategyDefinition;
}

function windowNode(root: RuleNode): Extract<RuleNode, { kind: "WINDOW" }> | null {
  if (root.kind === "WINDOW") return root;
  if (root.kind === "SEQUENCE") {
    for (const step of root.steps) {
      const found = windowNode(step);
      if (found !== null) return found;
    }
  }
  return null;
}

describe("legacy 入场规则图 · WINDOW 节点必须存在", () => {
  it("无 enabled 条件 ⇒ 仍产出 WINDOW，子节点为显式恒真条件", () => {
    const result = fromLegacyStrategyDefinition(legacyWith([]));
    const window = windowNode(result.definition.ruleGraph);
    expect(window).not.toBeNull();
    expect(window!.window).toMatchObject({ start: 15, end: 15, unit: "TRADING_DAY" });
    expect(window!.quantifier).toBe("ANY_DAY");
    expect(window!.child.kind).toBe("CONDITION");
    expect((window!.child as { id?: string }).id).toBe("entry.window.always");
    // 恒真条件不引入任何数据依赖
    expect(JSON.stringify(result.definition.dataRequirements)).not.toContain("entry.window.always");
    // 守卫不放松：仍然通过规则图校验
    expect(validateRuleGraph(result.definition.ruleGraph)).toHaveLength(0);
  });

  it("门禁不放松：空 ALL 仍被 validateRuleGraph 拒绝", () => {
    const issues = validateRuleGraph({
      kind: "ALL",
      children: [],
      id: "empty",
    } as unknown as RuleNode);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("有 enabled 条件 ⇒ 行为不变（WINDOW 包 ALL[conditions]）", () => {
    const result = fromLegacyStrategyDefinition(legacyWith([
      {
        id: "c1",
        enabled: true,
        field: "bar.close",
        operator: "GREATER_THAN",
        valueType: "CONSTANT",
        value: 10,
      },
    ]));
    const window = windowNode(result.definition.ruleGraph);
    expect(window).not.toBeNull();
    expect(window!.child.kind).toBe("ALL");
    expect((window!.child as { children: readonly RuleNode[] }).children).toHaveLength(1);
    expect(validateRuleGraph(result.definition.ruleGraph)).toHaveLength(0);
  });

  it("映射说明如实登记「恒真占位」而不是宣称窗口不参与判定", () => {
    const result = fromLegacyStrategyDefinition(legacyWith([]));
    const notes = result.notes.join("\n");
    expect(notes).toContain("entry.window.always");
    expect(notes).not.toContain("窗口不参与判定");
  });
});
