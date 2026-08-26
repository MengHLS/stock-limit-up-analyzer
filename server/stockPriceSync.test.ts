import { describe, expect, it } from "vitest";
import { buildStockPriceSyncTargets } from "./stockPriceSync";
import { parseTushareDailyPrices } from "./tushare";

describe("股票日线同步", () => {
  it("为每条涨停记录同时建立信号日、T+1 和 T+2 已记录交易日的价格目标", () => {
    const targets = buildStockPriceSyncTargets([
      { stockCode: "600001.SH", limitUpDate: "2026-08-18" },
      { stockCode: "600002.SH", limitUpDate: "2026-08-18" },
      { stockCode: "600001.SH", limitUpDate: "2026-08-19" },
      { stockCode: "600001.SH", limitUpDate: "2026-08-20" },
    ]);

    expect(targets).toEqual([
      { tradeDate: "2026-08-18", stockCodes: ["600001.SH", "600002.SH"] },
      { tradeDate: "2026-08-19", stockCodes: ["600001.SH", "600002.SH"] },
      { tradeDate: "2026-08-20", stockCodes: ["600001.SH", "600002.SH"] },
    ]);
  });

  it("使用完整市场交易日历覆盖信号后十个实际交易日，而不是仅覆盖涨停记录日期", () => {
    const targets = buildStockPriceSyncTargets(
      [{ stockCode: "600001.SH", limitUpDate: "2026-08-18" }],
      ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31", "2026-09-01"],
      10,
    );

    expect(targets).toHaveLength(11);
    expect(targets.at(-1)).toEqual({ tradeDate: "2026-09-01", stockCodes: ["600001.SH"] });
  });

  it("解析 Tushare daily 的开盘、收盘、最低价、成交额和前收字段", () => {
    const prices = parseTushareDailyPrices({
      code: 0,
      data: {
        fields: ["ts_code", "trade_date", "open", "close", "low", "amount", "pre_close"],
        items: [["600001.SH", "20260819", 10.5, 11, 10.1, 123456.78, 10]],
      },
    });

    expect(prices).toEqual([{
      stockCode: "600001.SH",
      tradeDate: "2026-08-19",
      openPrice: 10.5,
      closePrice: 11,
      lowPrice: 10.1,
      amount: 123456.78,
      preClosePrice: 10,
    }]);
  });
});
