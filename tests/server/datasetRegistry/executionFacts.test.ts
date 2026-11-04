import { describe, expect, it } from "vitest";
import {
  LIMIT_RULE_VERSION,
  deriveExecutionFacts,
} from "../../../server/datasetRegistry/executionFacts";

const executeEvent = deriveExecutionFacts;

describe("Dataset execution facts", () => {
  it("按交易日解析创业板涨跌幅", () => {
    const before = executeEvent({
      symbol: "300001.SZ",
      tradeDate: "2020-08-21",
      stStatus: "NORMAL",
      preClose: 10,
      bars: { open: 10, high: 11, low: 10, close: 11 },
      suspension: { status: "NOT_SUSPENDED", source: "PIT_STATUS" },
    });
    const after = executeEvent({
      symbol: "300001.SZ",
      tradeDate: "2020-08-24",
      stStatus: "NORMAL",
      preClose: 10,
      bars: { open: 10, high: 11, low: 10, close: 11 },
      suspension: { status: "NOT_SUSPENDED", source: "PIT_STATUS" },
    });
    expect(before.limitRuleUp).toBe(0.1);
    expect(before.limitUpPrice).toBe(11);
    expect(after.limitRuleUp).toBe(0.2);
    expect(after.limitUpPrice).toBe(12);
  });

  it("主板 ST 使用 5% 且价格分价四舍五入", () => {
    const out = executeEvent({
      symbol: "600001.SH",
      tradeDate: "2024-01-02",
      stStatus: "ST",
      preClose: 6.81,
      bars: { open: 7.15, high: 7.15, low: 7.15, close: 7.15 },
      suspension: { status: "NOT_SUSPENDED", source: "PIT_STATUS" },
    });
    expect(out.limitRuleUp).toBe(0.05);
    expect(out.limitUpPrice).toBe(7.15);
    expect(out.limitDownPrice).toBe(6.47);
  });

  it("一字涨停不可买、一字跌停不可卖，缺 bar 不可交易", () => {
    const up = executeEvent({
      symbol: "600001.SH",
      tradeDate: "2024-01-02",
      stStatus: "NORMAL",
      preClose: 10,
      bars: { open: 11, high: 11, low: 11, close: 11 },
      suspension: { status: "NOT_SUSPENDED", source: "PIT_STATUS" },
    });
    const down = executeEvent({
      symbol: "600001.SH",
      tradeDate: "2024-01-03",
      stStatus: "NORMAL",
      preClose: 11,
      bars: { open: 9.9, high: 9.9, low: 9.9, close: 9.9 },
      suspension: { status: "NOT_SUSPENDED", source: "PIT_STATUS" },
    });
    const missing = executeEvent({
      symbol: "600001.SH",
      tradeDate: "2024-01-04",
      stStatus: "NORMAL",
      preClose: 10,
      bars: { open: null, high: null, low: null, close: null },
      suspension: { status: "UNKNOWN", source: "NO_BAR" },
    });
    expect(up.oneWordLimitUp).toBe(true);
    expect(up.canBuyAtOpen).toBe(false);
    expect(down.oneWordLimitDown).toBe(true);
    expect(down.canSellAtClose).toBe(false);
    expect(missing.barPresent).toBe(false);
    expect(missing.canBuyAtOpen).toBe(false);
    expect(missing.canSellAtClose).toBe(false);
  });

  it("规则版本稳定写入", () => {
    const out = deriveExecutionFacts({
      symbol: "600001.SH",
      tradeDate: "2024-01-02",
      stStatus: "NORMAL",
      preClose: 10,
      bars: { open: 10, high: 10.5, low: 9.8, close: 10.2 },
      suspension: { status: "NOT_SUSPENDED", source: "PIT_STATUS" },
    });
    expect(out.limitRuleVersion).toBe(LIMIT_RULE_VERSION);
  });
});
