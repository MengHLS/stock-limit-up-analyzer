import { describe, expect, it } from "vitest";
import {
  filterFirstBoardRecords,
  getPreviousRecordedDate,
} from "../client/src/lib/firstBoard";

type RecordItem = {
  stockCode: string;
  limitUpDate: string;
  stockName: string;
};

describe("firstBoard", () => {
  it("calculates the previous recorded trading date rather than the previous calendar date", () => {
    expect(getPreviousRecordedDate(["2026-08-14", "2026-08-17", "2026-08-18"], "2026-08-18")).toBe("2026-08-17");
    expect(getPreviousRecordedDate(["2026-08-14", "2026-08-17", "2026-08-20"], "2026-08-20")).toBe("2026-08-17");
    expect(getPreviousRecordedDate(["2025-12-31", "2026-01-05"], "2026-01-05")).toBe("2025-12-31");
  });

  it("returns null for invalid dates", () => {
    expect(getPreviousRecordedDate(["2026-02-28"], "not-a-date")).toBeNull();
  });

  it("keeps today's limit-up stocks that did not limit up yesterday", () => {
    const recordsByDate = new Map<string, RecordItem[]>([
      [
        "2026-08-17",
        [
          { stockCode: "000001", stockName: "昨日涨停", limitUpDate: "2026-08-17" },
        ],
      ],
      [
        "2026-08-18",
        [
          { stockCode: "000001", stockName: "连续涨停", limitUpDate: "2026-08-18" },
          { stockCode: "000002", stockName: "今日首板", limitUpDate: "2026-08-18" },
        ],
      ],
    ]);

    expect(filterFirstBoardRecords(recordsByDate, "2026-08-18")).toEqual([
      { stockCode: "000002", stockName: "今日首板", limitUpDate: "2026-08-18" },
    ]);
  });

  it("treats a missing previous-day record set as no previous limit-up", () => {
    const recordsByDate = new Map<string, RecordItem[]>([
      [
        "2026-08-18",
        [
          { stockCode: "000001", stockName: "今日首板", limitUpDate: "2026-08-18" },
        ],
      ],
    ]);

    expect(filterFirstBoardRecords(recordsByDate, "2026-08-18")).toHaveLength(1);
  });

  it("excludes consecutive limit-ups when the prior recorded trading day is separated by a weekend or holiday", () => {
    const recordsByDate = new Map<string, RecordItem[]>([
      ["2026-08-17", [{ stockCode: "000001", stockName: "上一交易日涨停", limitUpDate: "2026-08-17" }]],
      [
        "2026-08-20",
        [
          { stockCode: "000001", stockName: "隔日连板", limitUpDate: "2026-08-20" },
          { stockCode: "000002", stockName: "隔日首板", limitUpDate: "2026-08-20" },
        ],
      ],
    ]);

    expect(filterFirstBoardRecords(recordsByDate, "2026-08-20")).toEqual([
      { stockCode: "000002", stockName: "隔日首板", limitUpDate: "2026-08-20" },
    ]);
  });
});
