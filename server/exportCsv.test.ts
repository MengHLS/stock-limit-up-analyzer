import { describe, expect, it } from "vitest";
import { buildLimitUpCsv } from "../client/src/lib/exportCsv";

describe("buildLimitUpCsv", () => {
  it("exports the selected records with a UTF-8 BOM", () => {
    const csv = buildLimitUpCsv([
      {
        limitUpDate: "2026-08-18",
        stockCode: "000001",
        stockName: "平安银行",
        limitUpTime: "09:31",
        boardCount: "1天1板",
        sector: "银行",
        circulationValue: "100亿",
        turnover: "12%",
        keywords: "首板",
      },
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("日期,股票代码,股票名称");
    expect(csv).toContain("2026-08-18,000001,平安银行");
  });

  it("quotes values containing commas, quotes, or newlines", () => {
    const csv = buildLimitUpCsv([
      {
        limitUpDate: "2026-08-18",
        stockCode: "000002",
        stockName: "名称,含逗号",
        limitUpTime: null,
        boardCount: null,
        sector: "题材",
        circulationValue: null,
        turnover: null,
        keywords: '关键词"含引号\n第二行',
      },
    ]);

    expect(csv).toContain('"名称,含逗号"');
    expect(csv).toContain('"关键词""含引号\n第二行"');
  });
});
