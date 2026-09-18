/**
 * MARKET-PAGE-REWORK —— 连板梯队名录的纯函数单测。
 *
 * 覆盖：连板判定（连续记录交易日）、空档断连、同日重复记录去重、断板分组
 * （连板中断 / 首板未续）、目标日无记录时的留空、窗口触顶告警、情绪评分公式。
 * 全部为纯函数，不触库。
 */
import { describe, expect, it } from "vitest";
import type { BoardRosterRecord } from "../../server/boardRoster";
import { buildBoardRoster, shiftIsoDate } from "../../server/boardRoster";
import { computeBoardEmotionScore } from "../../shared/boardEmotionScore";

const WINDOW = { lookbackDays: 60, startDate: "2026-07-20" };

function record(
  stockCode: string,
  limitUpDate: string,
  limitUpTime: string | null = "10:00:00",
  stockName = stockCode,
): BoardRosterRecord {
  return { stockCode, stockName, sector: "半导体", limitUpDate, limitUpTime };
}

/**
 * 夹具（4 个记录交易日）：
 *   A 09-16 / 09-17 / 09-18           → 当日 3 板
 *   B 09-15 / 09-18（中间空档）        → 当日 1 板（首板）
 *   C 09-18                            → 当日 1 板（首板）
 *   D 09-16 / 09-17                    → 09-17 为 2 板，当日未涨停 ⇒ 断板（连板中断）
 *   E 09-17                            → 当日未涨停 ⇒ 断板（首板未续）
 *   F 09-17 ×2（同日重复，10:00 / 09:30）→ 去重后按 09:30 计，当日未涨停 ⇒ 断板（首板未续）
 */
const FIXTURE: BoardRosterRecord[] = [
  record("000001.SZ", "2026-09-16", "09:35:00", "甲"),
  record("000001.SZ", "2026-09-17", "09:40:00", "甲"),
  record("000001.SZ", "2026-09-18", "09:45:00", "甲"),
  record("000002.SZ", "2026-09-15", "14:00:00", "乙"),
  record("000002.SZ", "2026-09-18", "10:05:00", "乙"),
  record("000003.SZ", "2026-09-18", "11:20:00", "丙"),
  record("000004.SZ", "2026-09-16", "13:10:00", "丁"),
  record("000004.SZ", "2026-09-17", "13:15:00", "丁"),
  record("000005.SZ", "2026-09-17", "14:30:00", "戊"),
  record("000006.SZ", "2026-09-17", "10:00:00", "己"),
  record("000006.SZ", "2026-09-17", "09:30:00", "己"),
];

describe("buildBoardRoster", () => {
  const roster = buildBoardRoster(FIXTURE, "2026-09-18", WINDOW);

  it("连板股：只收当日 2 板及以上，且板数按「连续记录交易日」累计", () => {
    expect(roster.connectionStocks.map((row) => [row.stockCode, row.boards])).toEqual([["000001.SZ", 3]]);
    // 连板股行内板数字典日 = 目标日
    expect(roster.connectionStocks[0].boardsAsOfDate).toBe("2026-09-18");
  });

  it("首板不会被计入连板股（空档会断连）", () => {
    // 乙 09-15 涨停后 09-16 / 09-17 空档，故 09-18 只能算首板
    expect(roster.connectionStocks.some((row) => row.stockCode === "000002.SZ")).toBe(false);
    expect(roster.metrics.firstBoards).toBe(2);
  });

  it("断板股 = 上一记录交易日涨停、当日未涨停；并区分连板中断 / 首板未续", () => {
    expect(roster.prevDate).toBe("2026-09-17");
    // 上一记录日（09-17）涨停：甲、丁、戊、己 —— 己同日两条重复记录只算 1 只
    expect(roster.metrics.prevTotalLimitUp).toBe(4);
    // 板数降序；同为 1 板时按封板时间升序（己 09:30 早于 戊 14:30）
    expect(roster.brokenStocks.map((row) => [row.stockCode, row.boards, row.brokenKind])).toEqual([
      ["000004.SZ", 2, "connection"],
      ["000006.SZ", 1, "first"],
      ["000005.SZ", 1, "first"],
    ]);
    // 断板行的板数字典日 = 上一记录交易日
    expect(roster.brokenStocks.every((row) => row.boardsAsOfDate === "2026-09-17")).toBe(true);
    expect(roster.metrics.brokenCount).toBe(3);
    expect(roster.metrics.brokenConnectionCount).toBe(1);
  });

  it("当日已涨停的股票不会同时出现在断板名单里", () => {
    const currentCodes = new Set(roster.connectionStocks.map((row) => row.stockCode));
    expect(currentCodes.has("000001.SZ")).toBe(true);
    expect(roster.brokenStocks.some((row) => row.stockCode === "000001.SZ")).toBe(false);
  });

  it("同一股票同日多条记录只算一只，且保留封板更早的时间", () => {
    expect(roster.metrics.totalLimitUp).toBe(3); // 甲、乙、丙
    expect(roster.brokenStocks.find((row) => row.stockCode === "000006.SZ")?.limitUpTime).toBe("09:30:00");
  });

  it("情绪评分与共享公式一致（totalLimitUp / connectionBoards / maxBoards / board3Plus）", () => {
    expect(roster.metrics.maxBoards).toBe(3);
    expect(roster.metrics.board3Plus).toBe(1);
    expect(roster.metrics.emotionScore).toBe(
      computeBoardEmotionScore({ totalLimitUp: 3, connectionBoards: 1, maxBoards: 3, board3Plus: 1 }),
    );
    expect(roster.metrics.emotionScore).toBe(52);
  });

  it("板数降序排序（同日再按封板时间升序）", () => {
    const ranked = buildBoardRoster(
      [
        record("000010.SZ", "2026-09-16"),
        record("000010.SZ", "2026-09-17"),
        record("000010.SZ", "2026-09-18", "14:00:00"),
        record("000011.SZ", "2026-09-17"),
        record("000011.SZ", "2026-09-18", "09:31:00"),
        record("000012.SZ", "2026-09-17"),
        record("000012.SZ", "2026-09-18", "09:32:00"),
      ],
      "2026-09-18",
      WINDOW,
    );
    // 3 板在前；同为 2 板时 09:31 早于 09:32
    expect(ranked.connectionStocks.map((row) => row.stockCode)).toEqual(["000010.SZ", "000011.SZ", "000012.SZ"]);
  });

  it("目标日没有涨停记录时整体留空，不把上一记录日误判为断板", () => {
    const empty = buildBoardRoster(FIXTURE, "2026-09-19", WINDOW);
    expect(empty.metrics.totalLimitUp).toBe(0);
    expect(empty.connectionStocks).toEqual([]);
    expect(empty.brokenStocks).toEqual([]);
    expect(empty.prevDate).toBeNull();
    expect(empty.metrics.brokenCount).toBe(0);
  });

  it("连板数顶满窗口时显式告警（不静默给错数）", () => {
    const saturated = buildBoardRoster(
      [
        record("000020.SZ", "2026-09-15"),
        record("000020.SZ", "2026-09-16"),
        record("000020.SZ", "2026-09-17"),
        record("000020.SZ", "2026-09-18"),
      ],
      "2026-09-18",
      WINDOW,
    );
    expect(saturated.window.tradingDateCount).toBe(4);
    expect(saturated.connectionStocks[0].boards).toBe(4);
    expect(saturated.window.exhausted).toBe(true);
  });

  it("正常窗口不告警（板数未触顶）", () => {
    expect(roster.window.exhausted).toBe(false);
    expect(roster.window.tradingDateCount).toBe(4);
    expect(roster.window.lookbackDays).toBe(60);
  });
});

describe("computeBoardEmotionScore", () => {
  it("无涨停时为 0（不产生 NaN）", () => {
    expect(computeBoardEmotionScore({ totalLimitUp: 0, connectionBoards: 0, maxBoards: 0, board3Plus: 0 })).toBe(0);
  });

  it("最高板归一封顶在 10 板", () => {
    const at10 = computeBoardEmotionScore({ totalLimitUp: 10, connectionBoards: 10, maxBoards: 10, board3Plus: 10 });
    const at20 = computeBoardEmotionScore({ totalLimitUp: 10, connectionBoards: 10, maxBoards: 20, board3Plus: 10 });
    expect(at20).toBe(at10);
    expect(at10).toBe(100);
  });
});

describe("shiftIsoDate", () => {
  it("按自然日平移（UTC 基准）", () => {
    expect(shiftIsoDate("2026-09-18", -60)).toBe("2026-07-20");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("非法日期直接抛错", () => {
    expect(() => shiftIsoDate("not-a-date", -1)).toThrow();
  });
});
