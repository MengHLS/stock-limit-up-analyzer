import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_RULES,
  DEFAULT_MARKET_RULES,
  resolveExecutionRuleContext,
} from "../../../server/backtest/marketRules";

describe("Backtest market rules delegate to boardRules authority", () => {
  it("主板 ST 使用 5%", () => {
    expect(
      DEFAULT_MARKET_RULES.resolvePriceLimit(
        { securityId: "600001.SH", name: "ST某某" },
        "2026-01-05"
      )
    ).toEqual({ limitUpRatio: 0.05, limitDownRatio: 0.05 });
  });

  it("创业板在规则切换日前后使用 10% / 20%", () => {
    expect(
      DEFAULT_MARKET_RULES.resolvePriceLimit(
        { securityId: "300001.SZ" },
        "2020-08-21"
      )
    ).toEqual({ limitUpRatio: 0.1, limitDownRatio: 0.1 });
    expect(
      DEFAULT_MARKET_RULES.resolvePriceLimit(
        { securityId: "300001.SZ" },
        "2020-08-24"
      )
    ).toEqual({ limitUpRatio: 0.2, limitDownRatio: 0.2 });
  });

  it("执行上下文按执行日解析，不使用固定 10%", () => {
    const context = resolveExecutionRuleContext(
      { securityId: "688001.SH" },
      DEFAULT_MARKET_RULES,
      DEFAULT_EXECUTION_RULES,
      "2026-01-05"
    );
    expect(context.limitUpRatio).toBe(0.2);
    expect(context.limitDownRatio).toBe(0.2);
  });
});
