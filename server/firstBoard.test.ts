import { describe, expect, it } from "vitest";
import {
  filterFirstBoardRecords,
  getPreviousCalendarDate,
} from "../client/src/lib/firstBoard";

type RecordItem = {
  stockCode: string;
  limitUpDate: string;
  stockName: string;
};

describe("firstBoard", () => {
  it("calculates the previous calendar date across month and year boundaries", () => {
    expect(getPreviousCalendarDate("2026-08-18")).toBe("2026-08-17");
    expect(getPreviousCalendarDate("2026-03-01")).toBe("2026-02-28");
    expect(getPreviousCalendarDate("2026-01-01")).toBe("2025-12-31");
  });

  it("returns null for invalid dates", () => {
    expect(getPreviousCalendarDate("2026-02-30")).toBeNull();
    expect(getPreviousCalendarDate("not-a-date")).toBeNull();
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
});
