import { describe, expect, it } from "vitest";
import { buildMissingStockPriceRequirements, buildStockPriceSyncTargets, buildUploadPriceSyncPlan, toValidatedStockDailyPriceUpserts } from "./stockPriceSync";
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

  it("解析 Tushare daily 的开盘、收盘、最高、最低、成交额、成交量和前收字段", () => {
    const prices = parseTushareDailyPrices({
      code: 0,
      data: {
        fields: ["ts_code", "trade_date", "open", "close", "high", "low", "amount", "vol", "pre_close"],
        items: [["600001.SH", "20260819", 10.5, 11, 11.2, 10.1, 123456.78, 98765, 10]],
      },
    });

    expect(prices).toEqual([{
      stockCode: "600001.SH",
      tradeDate: "2026-08-19",
      openPrice: 10.5,
      closePrice: 11,
      highPrice: 11.2,
      lowPrice: 10.1,
      amount: 123456.78,
      volume: 98765,
      preClosePrice: 10,
    }]);
  });
});

describe("P1-F3 生产入库数据质量路径", () => {
  const base = {
    stockCode: "600001.SH",
    tradeDate: "2026-08-19",
    openPrice: 10,
    closePrice: 11,
    highPrice: 11.2,
    lowPrice: 9.9,
    amount: 150000,
    volume: 120000,
    preClosePrice: 10,
  };

  it("正常 OHLCV 行 → 全部 VALID 可写入，数值字段以字符串保留", () => {
    const result = toValidatedStockDailyPriceUpserts([base], new Set(["600001.SH"]));
    expect(result.rows).toHaveLength(1);
    expect(result.invalidCount).toBe(0);
    expect(result.unpersistableCount).toBe(0);
    expect(result.qualityIssues).toHaveLength(0);
    expect(result.rows[0]).toEqual({
      stockCode: "600001.SH",
      tradeDate: "2026-08-19",
      openPrice: "10",
      closePrice: "11",
      highPrice: "11.2",
      lowPrice: "9.9",
      amount: "150000",
      volume: "120000",
      preClosePrice: "10",
      source: "tushare",
    });
  });

  it("high < max(open, close, low) → INVALID 不进入正常入库", () => {
    const result = toValidatedStockDailyPriceUpserts([{ ...base, highPrice: 10.8, closePrice: 11 }], new Set(["600001.SH"]));
    expect(result.rows).toHaveLength(0);
    expect(result.invalidCount).toBe(1);
    expect(result.qualityIssues.some((issue) => issue.status === "INVALID" && issue.codes.includes("HIGH_LT_MAX"))).toBe(true);
  });

  it("low > min(open, close, high) → INVALID 不进入正常入库", () => {
    const result = toValidatedStockDailyPriceUpserts([{ ...base, lowPrice: 10.3, openPrice: 10 }], new Set(["600001.SH"]));
    expect(result.rows).toHaveLength(0);
    expect(result.invalidCount).toBe(1);
    expect(result.qualityIssues.some((issue) => issue.status === "INVALID" && issue.codes.includes("LOW_GT_MIN"))).toBe(true);
  });

  it("negative volume / negative amount → INVALID 不进入正常入库", () => {
    const negVolume = toValidatedStockDailyPriceUpserts([{ ...base, volume: -1 }], new Set(["600001.SH"]));
    expect(negVolume.rows).toHaveLength(0);
    expect(negVolume.invalidCount).toBe(1);
    expect(negVolume.qualityIssues[0]?.codes).toContain("NEGATIVE_VOLUME");
    const negAmount = toValidatedStockDailyPriceUpserts([{ ...base, amount: -5 }], new Set(["600001.SH"]));
    expect(negAmount.rows).toHaveLength(0);
    expect(negAmount.invalidCount).toBe(1);
    expect(negAmount.qualityIssues[0]?.codes).toContain("NEGATIVE_AMOUNT");
  });

  it('missing close / missing preClose → 不可持久化（DB NOT NULL），不写 "undefined"/"null"', () => {
    const missingClose = toValidatedStockDailyPriceUpserts([{ ...base, closePrice: undefined }], new Set(["600001.SH"]));
    expect(missingClose.rows).toHaveLength(0);
    expect(missingClose.unpersistableCount).toBe(1);
    const missingPre = toValidatedStockDailyPriceUpserts([{ ...base, preClosePrice: null }], new Set(["600001.SH"]));
    expect(missingPre.rows).toHaveLength(0);
    expect(missingPre.unpersistableCount).toBe(1);
    expect(missingPre.qualityIssues[0]?.codes).toContain("REQUIRED_PRICE_MISSING");
  });

  it('null / undefined 数值字段 → 可空字段保留 null，绝不产生 "undefined"/"null" 字符串', () => {
    const result = toValidatedStockDailyPriceUpserts([
      { ...base, highPrice: null, amount: undefined, lowPrice: undefined, volume: null },
    ], new Set(["600001.SH"]));
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    // 任何字段都不得出现 "undefined" 或 "null" 字面量
    for (const value of Object.values(row)) {
      expect(value).not.toBe("undefined");
      expect(value).not.toBe("null");
    }
    expect(row.highPrice).toBeNull();
    expect(row.amount).toBeNull();
    expect(row.lowPrice).toBeNull();
    expect(row.volume).toBeNull();
    expect(row.openPrice).toBe("10");
    // 可空字段缺失 → WARNING 放行但留下质量信息（provenance）
    const warning = result.qualityIssues.find((issue) => issue.status === "WARNING");
    expect(warning).toBeDefined();
    expect(warning!.codes).toContain("FIELD_MISSING");
  });

  it("非法数值（非数字字符串）→ 解析为 null；缺失 open 时不可持久化", () => {
    const garbage = toValidatedStockDailyPriceUpserts([{ ...base, openPrice: "abc" }], new Set(["600001.SH"]));
    expect(garbage.rows).toHaveLength(0);
    expect(garbage.unpersistableCount).toBe(1);
  });

  it("未请求的股票不进入结果；无行可写时 savedCount 为 0 语义不变", () => {
    const result = toValidatedStockDailyPriceUpserts([base], new Set(["600002.SH"]));
    expect(result.rows).toHaveLength(0);
    expect(result.invalidCount).toBe(0);
    expect(result.unpersistableCount).toBe(0);
  });
});
