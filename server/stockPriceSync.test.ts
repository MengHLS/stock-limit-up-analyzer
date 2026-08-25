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

  it("解析 Tushare daily 的开盘、收盘和前收字段", () => {
    const prices = parseTushareDailyPrices({
      code: 0,
      data: {
        fields: ["ts_code", "trade_date", "open", "close", "pre_close"],
        items: [["600001.SH", "20260819", 10.5, 11, 10]],
      },
    });

    expect(prices).toEqual([{
      stockCode: "600001.SH",
      tradeDate: "2026-08-19",
      openPrice: 10.5,
      closePrice: 11,
      preClosePrice: 10,
    }]);
  });
});
