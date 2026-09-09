/**
 * STEP 12 WORK B — BaoStock stock_basic Provider 解析测试。
 */

import { describe, expect, it } from "vitest";
import {
  mapBaoStockExchange,
  parseBaoStockCode,
  parseBaoStockStockBasic,
  type BaoStockRawRow,
} from "./baostock";

describe("parseBaoStockCode", () => {
  it("解析 sh/sz/bj 前缀 → 统一交易所 + 6 位数字", () => {
    expect(parseBaoStockCode("sh.600000")).toEqual({ exchange: "SH", digits: "600000" });
    expect(parseBaoStockCode("sz.000001")).toEqual({ exchange: "SZ", digits: "000001" });
    expect(parseBaoStockCode("bj.920001")).toEqual({ exchange: "BJ", digits: "920001" });
  });

  it("大小写与空白容忍", () => {
    expect(parseBaoStockCode(" SH.600000 ")).toEqual({ exchange: "SH", digits: "600000" });
  });

  it("非法 code 返回 null", () => {
    expect(parseBaoStockCode("sh.60000")).toBeNull();
    expect(parseBaoStockCode("hk.600000")).toBeNull();
    expect(parseBaoStockCode("600000")).toBeNull();
    expect(parseBaoStockCode("")).toBeNull();
  });
});

describe("mapBaoStockExchange", () => {
  it("映射前缀", () => {
    expect(mapBaoStockExchange("sh")).toBe("SH");
    expect(mapBaoStockExchange("SZ")).toBe("SZ");
    expect(mapBaoStockExchange("bj")).toBe("BJ");
    expect(mapBaoStockExchange("hk")).toBeNull();
  });
});

describe("parseBaoStockStockBasic", () => {
  const raw: BaoStockRawRow[] = [
    { code: "sh.600000", name: "浦发银行", ipoDate: "1999-11-10", outDate: "", type: "1", status: "1" },
    { code: "sz.000001", name: "平安银行", ipoDate: "1991-04-03", outDate: "", type: "1", status: "1" },
    { code: "sh.600001", name: "邯郸钢铁", ipoDate: "1998-01-22", outDate: "2009-12-29", type: "1", status: "0" },
    { code: "sz.000003", name: "PT金田A", ipoDate: "1991-07-03", outDate: "2002-06-14", type: "1", status: "0" },
    { code: "sh.000001", name: "上证综合指数", ipoDate: "1991-07-15", outDate: "", type: "2", status: "1" },
    { code: "sz.159001", name: "某基金", ipoDate: "2012-01-01", outDate: "", type: "4", status: "1" },
    { code: "sh.113001", name: "某债券", ipoDate: "2018-01-01", outDate: "", type: "5", status: "1" },
    { code: "hk.600000", name: "非法前缀", ipoDate: "2000-01-01", outDate: "", type: "1", status: "1" },
  ];

  it("只落 type=1 股票，指数/基金/债/非法前缀忽略", () => {
    const records = parseBaoStockStockBasic(raw);
    expect(records).toHaveLength(4);
    expect(records.map((r) => r.code)).toEqual(["600000", "000001", "600001", "000003"]);
  });

  it("上市股与退市股的日期/状态映射", () => {
    const records = parseBaoStockStockBasic(raw);

    const listed = records.find((r) => r.code === "600000")!;
    expect(listed.exchange).toBe("SH");
    expect(listed.name).toBe("浦发银行");
    expect(listed.listedDate).toBe("1999-11-10");
    expect(listed.delistedDate).toBeNull();
    expect(listed.status).toBe("listed");
    expect(listed.source).toBe("baostock_stock_basic");

    const delisted = records.find((r) => r.code === "600001")!;
    expect(delisted.status).toBe("delisted");
    expect(delisted.delistedDate).toBe("2009-12-29");
    expect(delisted.listedDate).toBe("1998-01-22");
  });

  it("空 ipoDate / outDate 归一化为 null", () => {
    const rows: BaoStockRawRow[] = [
      { code: "sh.600000", name: "X", ipoDate: "", outDate: "", type: "1", status: "1" },
    ];
    const records = parseBaoStockStockBasic(rows);
    expect(records[0]!.listedDate).toBeNull();
    expect(records[0]!.delistedDate).toBeNull();
  });
});
