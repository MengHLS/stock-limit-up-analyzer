import { describe, it, expect } from "vitest";
import { parseTushareIndexDaily, parseTushareDailyBasic, type TusharePayload } from "./providers/tushare";
import { parseSinaIndexDaily, parseSinaIndexQuote, toSinaSymbol } from "./providers/sina";
import { parseBaostockIndexDaily, parseBaostockStockDaily, toBaostockCode } from "./providers/baostock";
import { parseAkShareSwIndustries, parseAkShareSwMembers } from "./providers/akshare";

describe("Tushare provider 解析", () => {
  it("parseTushareIndexDaily 归一为 canonical", () => {
    const payload: TusharePayload = {
      code: 0,
      data: {
        fields: ["ts_code", "trade_date", "open", "close", "high", "low", "vol", "amount"],
        items: [["000300.SH", "20260105", "1000", "1010", "1020", "990", "123456", "987654"]],
      },
    };
    const bars = parseTushareIndexDaily(payload, "000300.SH");
    expect(bars).toHaveLength(1);
    expect(bars[0]!.tradeDate).toBe("2026-01-05");
    expect(bars[0]!.close).toBe(1010);
    expect(bars[0]!.amount).toBe(987654);
    expect(bars[0]!.volume).toBe(123456);
    expect(bars[0]!.source).toBe("tushare");
  });

  it("parseTushareDailyBasic：万元→元 归一", () => {
    const payload: TusharePayload = {
      code: 0,
      data: {
        fields: ["ts_code", "trade_date", "turnover_rate", "circ_mv", "total_mv"],
        items: [["002361.SZ", "20260105", "5.2", "123456.78", "200000"]],
      },
    };
    const rows = parseTushareDailyBasic(payload);
    expect(rows[0]!.turnoverRate).toBe(5.2);
    expect(rows[0]!.circulationMarketCap).toBeCloseTo(123456.78 * 10_000);
    expect(rows[0]!.totalMarketCap).toBeCloseTo(200000 * 10_000);
    expect(rows[0]!.amount).toBeNull();
  });
});

describe("Sina provider 解析", () => {
  it("toSinaSymbol 转 Sina 行情代码", () => {
    expect(toSinaSymbol("000300.SH")).toBe("sh000300");
    expect(toSinaSymbol("399006.SZ")).toBe("sz399006");
  });

  it("parseSinaIndexDaily：amount 恒 null（Sina 不返回），volume 保留", () => {
    const rows = [{ day: "2026-01-05", open: "1000", high: "1010", low: "990", close: "1005", volume: "123456" }];
    const bars = parseSinaIndexDaily(rows, "000300.SH");
    expect(bars[0]!.tradeDate).toBe("2026-01-05");
    expect(bars[0]!.amount).toBeNull();
    expect(bars[0]!.volume).toBe(123456);
  });

  it("parseSinaIndexQuote 提取名称", () => {
    const text = 'var hq_str_sh000300="沪深300,1000.00,999.00,1005.00,...";';
    expect(parseSinaIndexQuote(text)).toEqual({ providerCode: "sh000300", name: "沪深300" });
  });
});

describe("BaoStock provider 解析", () => {
  it("toBaostockCode 转 BaoStock 代码", () => {
    expect(toBaostockCode("000300.SH")).toBe("sh.000300");
    expect(toBaostockCode("002361.SZ")).toBe("sz.002361");
  });

  it("parseBaostockIndexDaily：股→手、元→千元", () => {
    const rows = [{ date: "2026-01-05", open: "1000", high: "1010", low: "990", close: "1005", volume: "5000000", amount: "123456789" }];
    const bars = parseBaostockIndexDaily(rows, "000300.SH");
    expect(bars[0]!.volume).toBeCloseTo(50_000); // 5000000 股 → 手
    expect(bars[0]!.amount).toBeCloseTo(123_456.789); // 元 → 千元
  });

  it("parseBaostockStockDaily：turn %、股→手、元→千元，市值 null", () => {
    const rows = [{ date: "2026-01-05", open: "10", high: "11", low: "9.9", close: "10.5", volume: "1000000", amount: "123000000", turn: "3.1", tradestatus: "1" }];
    const out = parseBaostockStockDaily(rows, "002361.SZ");
    expect(out[0]!.turnoverRate).toBe(3.1);
    expect(out[0]!.volume).toBeCloseTo(10_000); // 1000000 股 → 手
    expect(out[0]!.amount).toBeCloseTo(123_000); // 123000000 元 → 千元
    expect(out[0]!.circulationMarketCap).toBeNull();
  });
});

describe("AkShare SW provider 解析", () => {
  it("parseAkShareSwIndustries 过滤空项", () => {
    const rows = [
      { industry_code: "801010", industry_name: "农林牧渔" },
      { industry_code: "", industry_name: "" },
    ];
    expect(parseAkShareSwIndustries(rows)).toEqual([{ industryCode: "801010", industryName: "农林牧渔" }]);
  });

  it("parseAkShareSwMembers：6 位代码 → 规范化", () => {
    const rows = [
      { code: "002361", name: "神剑股份" },
      { code: "600000", name: "浦发银行" },
    ];
    expect(parseAkShareSwMembers(rows)).toEqual([
      { securityId: "002361.SZ", securityName: "神剑股份" },
      { securityId: "600000.SH", securityName: "浦发银行" },
    ]);
  });

  it("parseAkShareSwMembers：非法代码跳过", () => {
    const rows = [{ code: "bad", name: "x" }, { code: "002361", name: "神剑股份" }];
    expect(parseAkShareSwMembers(rows)).toEqual([{ securityId: "002361.SZ", securityName: "神剑股份" }]);
  });
});
