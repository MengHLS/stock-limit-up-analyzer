/**
 * STEP 7.3 — Canonical Validation 测试（§15）。
 */

import { describe, expect, it } from "vitest";
import { isValidTradeDate, validateCanonicalBackfillBar } from "./validation";
import type { CanonicalBackfillBar } from "./types";

function bar(overrides: Partial<CanonicalBackfillBar> = {}): CanonicalBackfillBar {
  return {
    securityCode: "600001.SH",
    tradeDate: "2026-01-05",
    openPrice: 10,
    highPrice: 10.5,
    lowPrice: 9.9,
    closePrice: 10.4,
    preClosePrice: 10,
    volume: 123400,
    amount: 5_678_000,
    source: "tushare",
    sourceVersion: "daily-v1",
    retrievedAt: "2026-09-06T00:00:00.000Z",
    rawHash: "h",
    adjustment: "raw",
    ...overrides,
  };
}

describe("validateCanonicalBackfillBar", () => {
  it("合法 bar → VALID", () => {
    expect(validateCanonicalBackfillBar(bar()).status).toBe("VALID");
  });

  it("空 symbol → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ securityCode: "" })).status).toBe("INVALID");
  });

  it("非法日期 → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ tradeDate: "2026-13-40" })).status).toBe("INVALID");
    expect(validateCanonicalBackfillBar(bar({ tradeDate: "not-a-date" })).status).toBe("INVALID");
  });

  it("负价格 → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ openPrice: -1 })).status).toBe("INVALID");
  });

  it("NaN / Infinity → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ closePrice: Number.NaN })).status).toBe("INVALID");
    expect(validateCanonicalBackfillBar(bar({ highPrice: Number.POSITIVE_INFINITY })).status).toBe("INVALID");
  });

  it("负 volume → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ volume: -1 })).status).toBe("INVALID");
  });

  it("负 amount → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ amount: -1 })).status).toBe("INVALID");
  });

  it("OHLC 矛盾：low > high → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ lowPrice: 11, highPrice: 10 })).status).toBe("INVALID");
  });

  it("OHLC 矛盾：high < close → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ highPrice: 9, closePrice: 10.4 })).status).toBe("INVALID");
  });

  it("OHLC 矛盾：low > open → INVALID", () => {
    expect(validateCanonicalBackfillBar(bar({ lowPrice: 11, openPrice: 10 })).status).toBe("INVALID");
  });

  it("缺失字段 → WARNING（非 INVALID）", () => {
    expect(validateCanonicalBackfillBar(bar({ volume: null })).status).toBe("WARNING");
    expect(validateCanonicalBackfillBar(bar({ amount: null })).status).toBe("WARNING");
  });

  it("格式异常代码 → WARNING（MALFORMED_CODE）", () => {
    const result = validateCanonicalBackfillBar(bar({ securityCode: "000001" }));
    expect(result.status).toBe("WARNING");
    expect(result.issues.some((i) => i.code === "MALFORMED_CODE")).toBe(true);
  });

  it("tradeDate 不在交易日历内 → WARNING（NON_TRADING_DATE）", () => {
    const result = validateCanonicalBackfillBar(bar(), { tradingDates: new Set(["2026-01-06"]) });
    expect(result.status).toBe("WARNING");
    expect(result.issues.some((i) => i.code === "NON_TRADING_DATE")).toBe(true);
  });
});

describe("isValidTradeDate", () => {
  it("合法日期", () => {
    expect(isValidTradeDate("2026-09-04")).toBe(true);
  });
  it("非法格式 / 非法日期", () => {
    expect(isValidTradeDate("2026-9-4")).toBe(false);
    expect(isValidTradeDate("2026-02-30")).toBe(false);
    expect(isValidTradeDate("abcdef")).toBe(false);
  });
});
