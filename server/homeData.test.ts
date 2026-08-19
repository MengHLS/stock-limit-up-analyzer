import { describe, expect, it } from "vitest";
import { buildAdjacentRecordsByDate, getLatestDateString, summarizeDailyCounts, summarizeSectorStats, buildWatchStatusMap, setWatchStatus } from "../client/src/lib/homeData";

describe("home data helpers", () => {
  it("keeps only the selected and previous-date records for first-board checks", () => {
    const current = [{ stockCode: "000001.SZ" }];
    const previous = [{ stockCode: "000002.SZ" }];
    const map = buildAdjacentRecordsByDate("2026-08-18", current, "2026-08-17", previous);

    expect([...map.keys()]).toEqual(["2026-08-18", "2026-08-17"]);
    expect(map.get("2026-08-18")).toEqual(current);
    expect(map.get("2026-08-17")).toEqual(previous);
    expect(map.has("2026-08-16")).toBe(false);
  });

  it("selects the latest database date regardless of input order", () => {
    expect(getLatestDateString(["2026-01-09", "2026-08-18", "2026-02-01"])).toBe("2026-08-18");
    expect(getLatestDateString([])).toBeNull();
  });

  it("summarizes positive daily counts and ignores empty days", () => {
    expect(summarizeDailyCounts([
      { date: "2026-08-16", count: 0 },
      { date: "2026-08-17", count: 79 },
      { date: "2026-08-18", count: 80 },
    ])).toEqual({ total: 159, average: 79.5, days: 2 });
  });

  it("summarizes sectors from current records and places empty sectors last", () => {
    expect(summarizeSectorStats([
      { sector: "人工智能" },
      { sector: "人工智能" },
      { sector: "商业航天" },
      { sector: "  " },
      { sector: null },
    ])).toEqual([
      { sector: "人工智能", count: 2 },
      { sector: "商业航天", count: 1 },
      { sector: "其他", count: 2 },
    ]);
  });

  it("initializes and updates batch watch statuses without per-stock queries", () => {
    const initial = buildWatchStatusMap(
      [{ stockCode: "000001.SZ" }, { stockCode: "000002.SZ" }],
      [{ stockCode: "000001.SZ", watchType: "normal" }],
    );
    expect([...initial.entries()]).toEqual([
      ["000001.SZ", "normal"],
      ["000002.SZ", "none"],
    ]);

    const important = setWatchStatus(initial, "000002.SZ", "important");
    expect(important.get("000002.SZ")).toBe("important");
    expect(initial.get("000002.SZ")).toBe("none");

    const removed = setWatchStatus(important, "000001.SZ", "none");
    expect(removed.get("000001.SZ")).toBe("none");
  });
});
