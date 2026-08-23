import { describe, expect, it } from "vitest";
import { buildMaxConnectionBoardTrend } from "./db";

describe("buildMaxConnectionBoardTrend", () => {
  it("按日期升序计算最高连板并标注对应股票", () => {
    const records = [
      { stockCode: "000001.SZ", stockName: "平安银行", limitUpDate: "2026-08-18" },
      { stockCode: "000001.SZ", stockName: "平安银行", limitUpDate: "2026-08-17" },
      { stockCode: "000001.SZ", stockName: "平安银行", limitUpDate: "2026-08-16" },
      { stockCode: "000002.SZ", stockName: "万科A", limitUpDate: "2026-08-18" },
      { stockCode: "000003.SZ", stockName: "国农科技", limitUpDate: "2026-08-17" },
    ];

    expect(buildMaxConnectionBoardTrend(records)).toEqual([
      { date: "2026-08-16", maxBoards: 1, stockNames: ["平安银行"], stockCodes: ["000001.SZ"] },
      { date: "2026-08-17", maxBoards: 2, stockNames: ["平安银行"], stockCodes: ["000001.SZ"] },
      { date: "2026-08-18", maxBoards: 3, stockNames: ["平安银行"], stockCodes: ["000001.SZ"] },
    ]);
  });

  it("同一日期出现多个最高连板股票时全部保留", () => {
    const records = [
      { stockCode: "000001.SZ", stockName: "甲公司", limitUpDate: "2026-08-18" },
      { stockCode: "000001.SZ", stockName: "甲公司", limitUpDate: "2026-08-17" },
      { stockCode: "000002.SZ", stockName: "乙公司", limitUpDate: "2026-08-18" },
      { stockCode: "000002.SZ", stockName: "乙公司", limitUpDate: "2026-08-17" },
    ];

    const latest = buildMaxConnectionBoardTrend(records).at(-1);
    expect(latest).toEqual({
      date: "2026-08-18",
      maxBoards: 2,
      stockNames: ["甲公司", "乙公司"],
      stockCodes: ["000001.SZ", "000002.SZ"],
    });
  });

  it("没有记录时返回空数组", () => {
    expect(buildMaxConnectionBoardTrend([])).toEqual([]);
  });
});
