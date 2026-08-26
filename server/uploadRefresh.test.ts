import { describe, expect, it } from "vitest";
import { mapStoredLimitUpRecords } from "../client/src/lib/uploadRefresh";

describe("mapStoredLimitUpRecords", () => {
  it("保留指定日期查询结果的字段和顺序", () => {
    const result = mapStoredLimitUpRecords([
      {
        stockCode: "002361.SZ",
        stockName: "神剑股份",
        limitUpTime: "14:56:30",
        boardCount: "10天9板",
        circulationValue: "116",
        turnover: "51",
        sector: "商业航天",
        keywords: "军工",
      },
      {
        stockCode: "600000.SH",
        stockName: "浦发银行",
        limitUpTime: null,
        boardCount: null,
        circulationValue: null,
        turnover: null,
        sector: null,
        keywords: null,
      },
    ]);

    expect(result).toEqual([
      {
        stockCode: "002361.SZ",
        stockName: "神剑股份",
        limitUpTime: "14:56:30",
        boardCount: "10天9板",
        circulationValue: "116",
        turnover: "51",
        sector: "商业航天",
        keywords: "军工",
      },
      {
        stockCode: "600000.SH",
        stockName: "浦发银行",
        limitUpTime: "",
        boardCount: "",
        circulationValue: "",
        turnover: "",
        sector: "",
        keywords: "",
      },
    ]);
  });

  it("空结果保持为空，不生成占位股票", () => {
    expect(mapStoredLimitUpRecords([])).toEqual([]);
  });
});
