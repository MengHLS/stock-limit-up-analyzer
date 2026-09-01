import { describe, expect, it } from "vitest";
import { buildMissingStockPriceRequirements, buildStockPriceSyncTargets, buildUploadPriceSyncPlan } from "./stockPriceSync";
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

  it("近期上传选择上传日前最近六个候选日，由每个候选日补齐后续T+5交易日", () => {
    const plan = buildUploadPriceSyncPlan("2026-08-26", ["600003.SH"], [
      { stockCode: "600001.SH", limitUpDate: "2026-08-18" },
      { stockCode: "600002.SH", limitUpDate: "2026-08-20" },
      { stockCode: "600003.SH", limitUpDate: "2026-08-21" },
      { stockCode: "600004.SH", limitUpDate: "2026-08-22" },
      { stockCode: "600005.SH", limitUpDate: "2026-08-25" },
      { stockCode: "600006.SH", limitUpDate: "2026-08-26" },
    ], new Date("2026-08-30T00:00:00Z"));
    expect(plan).toEqual({ mode: "recent", signalDates: ["2026-08-18", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-25", "2026-08-26"], stockCodes: [] });
  });

  it("跨信号日合并目标，让前几日涨停股票在当前交易日仍被同步", () => {
    const targets = buildStockPriceSyncTargets([
      { stockCode: "600001.SH", limitUpDate: "2026-08-18" },
      { stockCode: "600002.SH", limitUpDate: "2026-08-20" },
    ], ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25", "2026-08-26"], 5);
    expect(targets.find((target) => target.tradeDate === "2026-08-24")?.stockCodes).toEqual(["600001.SH", "600002.SH"]);
    expect(targets.find((target) => target.tradeDate === "2026-08-25")?.stockCodes).toEqual(["600001.SH", "600002.SH"]);
  });

  it("历史上传只选择本次图片股票，并由该信号日补齐后续T+5交易日", () => {
    const plan = buildUploadPriceSyncPlan("2025-01-06", ["600001.SH", "600999.SH"], [
      { stockCode: "600001.SH", limitUpDate: "2025-01-06" },
      { stockCode: "600002.SH", limitUpDate: "2025-01-06" },
      { stockCode: "600999.SH", limitUpDate: "2025-01-07" },
    ], new Date("2026-08-30T00:00:00Z"));
    expect(plan).toEqual({ mode: "historical", signalDates: ["2025-01-06"], stockCodes: ["600001.SH"] });
  });

  it("只返回缺失的信号日及后续五个实际交易日，并保留每条股票信号日的审计范围", () => {
    const requirements = buildMissingStockPriceRequirements(
      [{ stockCode: "600001.SH", limitUpDate: "2026-08-18" }, { stockCode: "600002.SH", limitUpDate: "2026-08-18" }],
      new Set(["600001.SH::2026-08-18", "600001.SH::2026-08-19", "600001.SH::2026-08-20", "600001.SH::2026-08-21", "600001.SH::2026-08-24", "600001.SH::2026-08-25", "600002.SH::2026-08-18"]),
      ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25", "2026-08-26"],
      5,
    );
    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.stockCode).toBe("600002.SH");
    expect(requirements[0]?.missingTradeDates).toEqual(["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25"]);
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
