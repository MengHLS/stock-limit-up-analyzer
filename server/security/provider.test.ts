/**
 * STEP 7.4 — Provider 解析测试（Tushare stock_basic → 归一化 SecurityMaster 记录）。
 */

import { describe, expect, it } from "vitest";
import {
  buildPrimaryIdentifierFromRecord,
  buildSecurityFromRecord,
  mapTushareExchange,
  mapTushareListStatus,
  parseTushareStockBasic,
  toIsoDateOrNull,
} from "./index";

const stockBasicPayload = {
  code: 0,
  msg: "",
  data: {
    fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_status", "list_date", "delist_date", "exchange", "curr_type", "is_hs"],
    items: [
      ["000001.SZ", "000001", "平安银行", "深圳", "银行", "主板", "L", "19910403", "", "SZSE", "CNY", "H"],
      ["600000.SH", "600000", "浦发银行", "上海", "银行", "主板", "L", "19991110", "", "SSE", "CNY", "H"],
      ["920001.BJ", "920001", "北交示例", "北京", "制造", "北交所", "L", "20221115", "", "BSE", "CNY", "N"],
      ["600777.SH", "600777", "已退示例", "上海", "制造", "主板", "D", "19900101", "20220101", "SSE", "CNY", "N"],
    ],
  },
};

describe("Tushare stock_basic 解析", () => {
  it("归一化为 ProviderSecurityRecord（SH/SZ/BJ + 退市）", () => {
    const records = parseTushareStockBasic(stockBasicPayload);
    expect(records).toHaveLength(4);

    const sz = records.find((r) => r.code === "000001")!;
    expect(sz.exchange).toBe("SZ");
    expect(sz.name).toBe("平安银行");
    expect(sz.status).toBe("listed");
    expect(sz.listedDate).toBe("1991-04-03");
    expect(sz.delistedDate).toBeNull();

    const sh = records.find((r) => r.code === "600000")!;
    expect(sh.exchange).toBe("SH");

    const bj = records.find((r) => r.code === "920001")!;
    expect(bj.exchange).toBe("BJ");

    const delisted = records.find((r) => r.code === "600777")!;
    expect(delisted.status).toBe("delisted");
    expect(delisted.delistedDate).toBe("2022-01-01");
  });

  it("错误码抛错", () => {
    expect(() => parseTushareStockBasic({ code: 40203, msg: "每分钟最多访问", data: undefined })).toThrow();
  });

  it("缺少字段抛错", () => {
    expect(() =>
      parseTushareStockBasic({ code: 0, data: { fields: ["symbol"], items: [["000001"]] } }),
    ).toThrow(/缺少字段/);
  });
});

describe("映射辅助", () => {
  it("交易所映射", () => {
    expect(mapTushareExchange("SSE")).toBe("SH");
    expect(mapTushareExchange("SZSE")).toBe("SZ");
    expect(mapTushareExchange("BSE")).toBe("BJ");
    expect(mapTushareExchange(undefined)).toBeNull();
  });
  it("list_status 映射", () => {
    expect(mapTushareListStatus("L")).toBe("listed");
    expect(mapTushareListStatus("P")).toBe("suspended");
    expect(mapTushareListStatus("D")).toBe("delisted");
    expect(mapTushareListStatus(undefined)).toBe("unknown");
  });
  it("日期转换", () => {
    expect(toIsoDateOrNull("19910403")).toBe("1991-04-03");
    expect(toIsoDateOrNull("")).toBeNull();
    expect(toIsoDateOrNull("bad")).toBeNull();
  });
});

describe("记录 → Security / Identifier 构造", () => {
  it("构造 Security 与 primary identifier", () => {
    const record = parseTushareStockBasic(stockBasicPayload).find((r) => r.code === "000001")!;
    const security = buildSecurityFromRecord(record, "sec_x");
    expect(security.securityId).toBe("sec_x");
    expect(security.exchange).toBe("SZ");
    expect(security.currency).toBe("CNY");
    expect(security.country).toBe("CN");

    const identifier = buildPrimaryIdentifierFromRecord(record, "sec_x");
    expect(identifier.code).toBe("000001");
    expect(identifier.identifierType).toBe("primary");
    expect(identifier.effectiveFrom).toBe("1991-04-03");
    expect(identifier.effectiveTo).toBeNull();
  });
});
