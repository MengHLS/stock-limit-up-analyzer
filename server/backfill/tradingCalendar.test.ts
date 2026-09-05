/**
 * STEP 7.3 — 交易日历测试（§9）。
 */

import { describe, expect, it } from "vitest";
import { extractTradingDates, parseTradeCalPayload } from "./tradingCalendar";

describe("parseTradeCalPayload", () => {
  it("解析 cal_date/is_open，只保留 isOpen=1", () => {
    const payload = {
      code: 0,
      data: {
        fields: ["cal_date", "is_open"],
        items: [
          ["20260904", 1],
          ["20260905", 0],
          ["20260906", 0],
          ["20260907", 1],
        ],
      },
    };
    const days = parseTradeCalPayload(payload, "SSE");
    expect(days.map((d) => d.calDate)).toEqual(["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(days.filter((d) => d.isOpen).map((d) => d.calDate)).toEqual(["2026-09-04", "2026-09-07"]);
  });

  it("错误码 → 抛错", () => {
    expect(() => parseTradeCalPayload({ code: 40203, msg: "频率超限" }, "SSE")).toThrow(/40203/);
  });

  it("缺少字段 → 抛错", () => {
    expect(() => parseTradeCalPayload({ code: 0, data: { fields: ["cal_date"], items: [] } }, "SSE")).toThrow(/is_open/);
  });
});

describe("extractTradingDates", () => {
  it("只提取 isOpen=true 的日期并升序去重", () => {
    const days = [
      { calDate: "2026-09-07", exchange: "SSE", isOpen: true },
      { calDate: "2026-09-05", exchange: "SSE", isOpen: false },
      { calDate: "2026-09-04", exchange: "SSE", isOpen: true },
      { calDate: "2026-09-04", exchange: "SZSE", isOpen: true },
    ];
    expect(extractTradingDates(days)).toEqual(["2026-09-04", "2026-09-07"]);
  });
});
