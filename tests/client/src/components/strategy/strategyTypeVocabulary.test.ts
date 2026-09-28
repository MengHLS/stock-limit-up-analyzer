/**
 * 策略类型词汇表：前端展示值与后端权威值域必须一一对应。
 *
 * 这不是「字符串长什么样」的测试，而是防两侧漂移的契约测试：
 * 后端新增 / 删除 / 改名类型而前端未同步时，这里必须失败，
 * 避免前端把新类型悄悄显示成「其他」或漏出筛选入口。
 */

import { describe, expect, it } from "vitest";
import {
  STRATEGY_TYPE_VALUES,
  strategyTypeBadgeClass,
  strategyTypeDescription,
  strategyTypeLabel,
} from "../../../../../client/src/components/strategy/strategyTypeVocabulary";
import { STRATEGY_TYPES } from "../../../../../server/research/strategySchema/types";

describe("strategyTypeVocabulary", () => {
  it("前端值域与后端 STRATEGY_TYPES 完全一致（含顺序）", () => {
    expect([...STRATEGY_TYPE_VALUES]).toEqual([...STRATEGY_TYPES]);
  });

  it("每个权威值都有非空中文标签与说明", () => {
    for (const value of STRATEGY_TYPES) {
      expect(strategyTypeLabel(value)).not.toBe("");
      expect(strategyTypeLabel(value)).not.toBe(value);
      expect(strategyTypeDescription(value)).not.toBe("");
      expect(strategyTypeBadgeClass(value)).toMatch(/border-/);
    }
  });

  it("未分类 / 未知值如实展示，不吞成「其他」", () => {
    expect(strategyTypeLabel(null)).toBe("未分类");
    expect(strategyTypeLabel(undefined)).toBe("未分类");
    expect(strategyTypeLabel("")).toBe("未分类");
    expect(strategyTypeLabel("FUTURE_TYPE")).toBe("FUTURE_TYPE");
    expect(strategyTypeDescription("FUTURE_TYPE")).toBe("");
    expect(strategyTypeBadgeClass("FUTURE_TYPE")).toMatch(/border-/);
  });
});
