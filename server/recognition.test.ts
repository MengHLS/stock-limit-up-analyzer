import { describe, expect, it } from "vitest";
import { parseRecognitionResult } from "./recognition";

describe("parseRecognitionResult", () => {
  it("uses the API date and normalizes stock exchange suffixes", () => {
    const result = parseRecognitionResult(
      JSON.stringify({
        date: "2024-01-02",
        stocks: [{
          stockCode: "600000",
          stockName: "浦发银行",
          limitUpTime: "09:31",
          boardCount: "1板",
          circulationValue: "100",
          turnover: "20",
          sector: "银行",
          keywords: "金融",
        }],
      }),
      "2026-08-18",
    );

    expect(result.date).toBe("2026-08-18");
    expect(result.stocks[0].stockCode).toBe("600000.SH");
    expect(result.stocks[0].limitUpTime).toBe("09:31:00");
  });

  it("reads text content returned as an array and drops incomplete rows", () => {
    const result = parseRecognitionResult(
      [{
        type: "text",
        text: JSON.stringify({
          date: "2026-08-18",
          stocks: [
            { stockCode: "300001", stockName: "创业测试" },
            { stockCode: "", stockName: "缺少代码" },
          ],
        }),
      }],
      "",
    );

    expect(result.date).toBe("2026-08-18");
    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0].stockCode).toBe("300001.SZ");
    expect(result.stocks[0].sector).toBe("");
  });

  it("rejects results without a valid date", () => {
    expect(() => parseRecognitionResult('{"stocks":[]}', "not-a-date")).toThrow("有效的涨停日期");
  });
});
