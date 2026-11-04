/**
 * SCOPE-002 §4.2 S0 —— `3570001` golden 的**回归哨兵**。
 *
 * 目的：证明冻结的锚点仍然是**合法**的 canonical 文档（而不是"看起来像"）。
 * 若本文件失败 ⇒ 要么锚点被改坏，要么既有语义发生了漂移 —— 两种情况都必须查明原因，
 * **不得**改测试放行（`AGENTS.md` §3「不为通过测试而修改测试」）。
 *
 * 只碰纯函数：不触 DB、不起服务。
 */
import { describe, expect, it } from "vitest";
import { validateCanonicalStrategyDefinition } from "../../../../server/research/strategySchema";
import { exitPolicyDefinitionErrors, type ExitPolicyDefinition } from "../../../../server/research/exitPolicyCommon";
import { resolveStrategyRecipe } from "../../../../server/research/recipeRegistry";
import type { StrategyRecipe } from "../../../../server/research/strategySchema/types";
import { GOLDEN_3570001, GOLDEN_3570001_META } from "./golden3570001";

const definition = GOLDEN_3570001.definition as Record<string, any>;
const recipe = GOLDEN_3570001.recipe as StrategyRecipe;

describe("S0 · 3570001 golden 锚点", () => {
  it("definition 仍通过 canonical 校验（结构 + Look-Ahead L1–L8）", () => {
    const result = validateCanonicalStrategyDefinition(definition as never);
    expect(result.valid, JSON.stringify(result.issues)).toBe(true);
  });

  it("exit policy 仍是统一 policy 形状，且通过既有 exitPolicyDefinitionErrors", () => {
    const rules = definition.exit?.rules ?? [];
    expect(rules).toHaveLength(1);
    const rule = rules[0];
    expect(rule.type).toBe("STOP_LOSS");
    expect(rule.trigger).toBe("ON_CLOSE");
    expect(rule.enabled).toBe(true);
    const policy = rule.policy as ExitPolicyDefinition;
    expect(exitPolicyDefinitionErrors(policy)).toEqual([]);
  });

  it("runnerBridge 未漂移：NEW_HIGH_3 / decisionHoldingDays=5 / extendToHoldingDays=20", () => {
    const policy = definition.exit.rules[0].policy;
    expect(policy.runnerBridge).toMatchObject({
      kind: "PIT_RUNNER_HOLDING_BRIDGE",
      state: "NEW_HIGH_3",
      decisionHoldingDays: 5,
      extendToHoldingDays: 20,
    });
  });

  it("其余退出政策未漂移：SL-18.1 止损 / MA5×MA10 / 5 日 / strongHold 5→10", () => {
    const policy = definition.exit.rules[0].policy;
    expect(policy.stop).toEqual({
      anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 },
      confirmation: "INTRADAY",
      escalation: { kind: "PEAK_DRAWDOWN", activationRatio: 0.03, drawdownRatio: 0.08 },
    });
    expect(policy.takeProfit).toEqual({ kind: "MA_CROSS", fastWindow: 5, slowWindow: 10, activationRatio: 0 });
    expect(policy.timeExit).toEqual({ kind: "FIXED_HOLDING_DAYS", holdingDays: 5 });
    expect(policy.strongHold).toEqual({
      atHoldingDays: 5,
      minReturnRatio: 0.03,
      requireAboveMa5: true,
      requireAboveMa10: true,
      extendToHoldingDays: 10,
      afterExtendedHold: "TIME_EXIT",
    });
    expect(policy.capitalRecycle).toBeNull();
  });

  it("recipe 仍是已注册配方（resolveStrategyRecipe 不抛错）", () => {
    const runtime = resolveStrategyRecipe(recipe);
    expect(runtime.recipeId).toBe("first-limit-pullback-3f-top3");
    expect(recipe.point).toBe("close");
    expect(recipe.signalFrequency).toBe("daily");
    expect(recipe.selectionConfig.method).toEqual({ kind: "topN", n: 3 });
    expect(recipe.requiredData).toContain("OHLCV");
  });

  it("dataset 主绑定仍是 750001 / PRIMARY（权威坐标，非 label）", () => {
    const datasets = definition.datasets ?? [];
    expect(datasets).toHaveLength(1);
    expect(datasets[0]).toMatchObject({ role: "PRIMARY", datasetVersionId: 750001, datasetVersion: "v7" });
  });

  it("golden 与 meta 自洽（strategyId / datasetVersionId / 版本）", () => {
    expect(GOLDEN_3570001_META.strategyId).toBe("first-limit-pullback-3f-top3-runner-hold20");
    expect(GOLDEN_3570001_META.version).toBe("1.0.0");
    expect(definition.datasets[0].datasetVersionId).toBe(GOLDEN_3570001_META.datasetVersionId);
  });
});