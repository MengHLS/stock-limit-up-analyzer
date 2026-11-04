/**
 * 9cc · AR-14（Strategy Projection 消费点）验收。
 *
 * ## 缺陷现场（审计实测，2026-09-20）
 *
 * `server/research/patternLibrary/strategyProjection.ts`（PHASE-B-001 交付）全仓**只被它自己的
 * 单测引用** —— 执行侧（`runWorkbenchAssembly` / `strategyCore`）从不读语义注册表。
 * 于是「Research 与 Strategy 用同一份 `pat_X` semantic definition」在执行路径上**不成立**
 * （只在文件结构上成立）。
 *
 * `strategyConsumption.ts` 把声明与执行侧**能力面**对表，使这件事第一次成为**可断言的事实**。
 *
 * 本文件的四组断言：
 *   ⒜ 真实 Pattern ⇒ 绑定表与注册表（唯一 Expander 的产物）**逐字段一致**；
 *   ⒝ 研究侧变量名与 Research 投影同名（两侧同源的可执行判据）；
 *   ⒞ 声明的特征不存在 ⇒ 点名（可失败）；
 *   ⒟ 声明的阈值参数不在文档里 ⇒ 点名（可失败）。
 */

import { describe, expect, it } from "vitest";
import {
  resolvePatternIdByRecipeId,
  verifyStrategyConsumption,
} from "../../../../server/research/patternLibrary/strategyConsumption";
import { findPatternSemantics } from "../../../../server/research/patternLibrary/semanticRegistry";
import { createDefaultFeatureRegistry } from "../../../../server/strategyCore/featureRegistry";

const PATTERN_ID = "first-limit-pullback-hold-shrink";

/** 真实 Core 特征注册表（生产同一个构造器，不手写 id 清单）。 */
const registry = createDefaultFeatureRegistry();
const isFeatureRegistered = (id: string) => registry.has(id);

describe("AR-14 · 绑定表来自唯一 Expander 的产物", () => {
  it("真实 Pattern 的两条语义都给出「语义变量 → 特征 / 阈值参数」绑定", () => {
    const result = verifyStrategyConsumption({
      patternId: PATTERN_ID,
      isFeatureRegistered,
      declaredParameterCodes: new Set(["max_drawdown", "max_volume_ratio"]),
    });
    expect(result.applied).toBe(true);
    expect(result.bindings.map((b) => ({
      v: b.semanticVariable,
      f: b.featureId,
      c: b.comparison,
      p: b.thresholdParam,
    }))).toEqual([
      {
        v: "pat_pullback_hold_depth_2d",
        f: "haircutFromEventLow",
        c: "LTE",
        p: "max_drawdown",
      },
      {
        v: "pat_pullback_shrink_ratio_2d",
        f: "volumeRatio",
        c: "LTE",
        p: "max_volume_ratio",
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.note).toContain("2 条绑定");
  });

  it("研究侧变量名与 Research 投影**同名同源**（两侧共用同一份声明）", () => {
    const entry = findPatternSemantics(PATTERN_ID)!;
    const fromRegistry = entry.expanded.map((e) => e.name).sort();
    const fromConsumption = verifyStrategyConsumption({
      patternId: PATTERN_ID,
      isFeatureRegistered,
      declaredParameterCodes: new Set(["max_drawdown", "max_volume_ratio"]),
    }).bindings.map((b) => b.semanticVariable).sort();
    expect(fromConsumption).toEqual(fromRegistry);
  });

  it("真实注册表里两条特征都存在（这条保证「对表」本身不是空转）", () => {
    expect(isFeatureRegistered("haircutFromEventLow")).toBe(true);
    expect(isFeatureRegistered("volumeRatio")).toBe(true);
  });

  it("真实模式：`recipeId` 能反查到 Pattern", () => {
    expect(resolvePatternIdByRecipeId("first-limit-pullback-hold-shrink")).toBe(PATTERN_ID);
    expect(resolvePatternIdByRecipeId("not-a-recipe")).toBeNull();
    expect(resolvePatternIdByRecipeId(null)).toBeNull();
  });
});

describe("AR-14 · 两条判据都**可失败**", () => {
  it("声明的执行侧特征不存在 ⇒ FEATURE_NOT_REGISTERED（点名到 semanticId）", () => {
    const result = verifyStrategyConsumption({
      patternId: PATTERN_ID,
      // 模拟「Core 注册表里没有这个特征」
      isFeatureRegistered: (id) => id === "volumeRatio",
      declaredParameterCodes: new Set(["max_drawdown", "max_volume_ratio"]),
    });
    expect(result.issues.map((i) => i.code)).toEqual(["FEATURE_NOT_REGISTERED"]);
    expect(result.issues[0]!.semanticId).toBe("pullback_hold_depth");
    expect(result.note).toContain("不一致");
  });

  it("阈值参数不在策略文档里 ⇒ THRESHOLD_PARAM_NOT_DECLARED（该语义无法调参）", () => {
    const result = verifyStrategyConsumption({
      patternId: PATTERN_ID,
      isFeatureRegistered,
      declaredParameterCodes: new Set(["max_drawdown"]),
    });
    expect(result.issues.map((i) => i.code)).toEqual(["THRESHOLD_PARAM_NOT_DECLARED"]);
    expect(result.issues[0]!.semanticId).toBe("pullback_shrink_ratio");
  });

  it("未匹配到 Pattern ⇒ applied=false（不臆造语义，也不报假失败）", () => {
    const result = verifyStrategyConsumption({
      patternId: null,
      isFeatureRegistered,
      declaredParameterCodes: new Set(),
    });
    expect(result.applied).toBe(false);
    expect(result.bindings).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.note).toContain("未匹配到已注册 Pattern");
  });
});
