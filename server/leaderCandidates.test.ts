import { describe, expect, it } from "vitest";
import { buildLeaderCandidateBacktest, buildLeaderCandidates } from "./leaderCandidates";

describe("buildLeaderCandidates", () => {
  it("仅从最新交易日的主板涨停中生成可解释候选，并排除非主板股票", () => {
    const result = buildLeaderCandidates([
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-18", limitUpTime: "10:20:00", sector: "算力", turnover: "8", circulationValue: "50" },
      { stockCode: "600002.SH", stockName: "主板乙", limitUpDate: "2026-08-18", limitUpTime: "13:20:00", sector: "算力", turnover: "5", circulationValue: "40" },
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-19", limitUpTime: "09:45:00", sector: "算力", turnover: "22", circulationValue: "50" },
      { stockCode: "600002.SH", stockName: "主板乙", limitUpDate: "2026-08-19", limitUpTime: "14:40:00", sector: "算力", turnover: "5", circulationValue: "40" },
      { stockCode: "300001.SZ", stockName: "创业板甲", limitUpDate: "2026-08-19", limitUpTime: "09:30:00", sector: "算力", turnover: "30", circulationValue: "60" },
      { stockCode: "688001.SH", stockName: "科创板甲", limitUpDate: "2026-08-19", limitUpTime: "09:30:00", sector: "算力", turnover: "30", circulationValue: "60" },
      { stockCode: "920001.BJ", stockName: "北交所甲", limitUpDate: "2026-08-19", limitUpTime: "09:30:00", sector: "算力", turnover: "30", circulationValue: "60" },
    ]);

    expect(result.date).toBe("2026-08-19");
    expect(result.totalMainBoardLimitUps).toBe(2);
    expect(result.maxBoards).toBe(2);
    expect(result.strongSectors).toEqual([{ sector: "算力", count: 2 }]);
    expect(result.candidates.map((candidate) => candidate.stockCode)).toEqual(["600001.SH", "600002.SH"]);
    expect(result.candidates[0]).toMatchObject({
      rank: 1,
      boards: 2,
      sector: "算力",
      sectorCount: 2,
      reasons: expect.arrayContaining(["2板高度", "算力 2只涨停", "09:45 封板", "成交额 22亿元"]),
      riskTags: [],
    });
    expect(result.candidates[1]?.riskTags).toContain("封板偏晚");
  });

  it("以已记录交易日序列判定连板，交易日中断后重新从首板计算", () => {
    const result = buildLeaderCandidates([
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-18", limitUpTime: "10:00:00", sector: "题材A", turnover: "5", circulationValue: null },
      { stockCode: "600002.SH", stockName: "主板乙", limitUpDate: "2026-08-19", limitUpTime: "10:00:00", sector: "题材B", turnover: "5", circulationValue: null },
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-20", limitUpTime: "10:00:00", sector: "题材A", turnover: "5", circulationValue: null },
    ]);

    expect(result.maxBoards).toBe(1);
    expect(result.candidates).toHaveLength(0);
  });

  it("同一股票同日重复记录时保留较早封板记录，避免重复统计", () => {
    const result = buildLeaderCandidates([
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-20", limitUpTime: "14:20:00", sector: "题材A", turnover: "5", circulationValue: null },
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-20", limitUpTime: "09:35:00", sector: "题材A", turnover: "8", circulationValue: null },
      { stockCode: "600002.SH", stockName: "主板乙", limitUpDate: "2026-08-20", limitUpTime: "10:20:00", sector: "题材A", turnover: "5", circulationValue: null },
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-21", limitUpTime: "09:40:00", sector: "题材A", turnover: "8", circulationValue: null },
    ]);

    expect(result.totalMainBoardLimitUps).toBe(1);
    expect(result.candidates[0]).toMatchObject({ stockCode: "600001.SH", boards: 2, limitUpTime: "09:40:00" });
  });

  it("回测仅使用T日及以前数据生成候选，并以T加1涨停延续作为成功口径", () => {
    const records = [
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-18", limitUpTime: "09:40:00", sector: "题材A", turnover: "20", circulationValue: null },
      { stockCode: "600002.SH", stockName: "主板乙", limitUpDate: "2026-08-18", limitUpTime: "09:45:00", sector: "题材A", turnover: "20", circulationValue: null },
      { stockCode: "600003.SH", stockName: "主板丙", limitUpDate: "2026-08-18", limitUpTime: "09:50:00", sector: "题材A", turnover: "20", circulationValue: null },
      { stockCode: "600001.SH", stockName: "主板甲", limitUpDate: "2026-08-19", limitUpTime: "09:35:00", sector: "题材A", turnover: "20", circulationValue: null },
      { stockCode: "600002.SH", stockName: "主板乙", limitUpDate: "2026-08-19", limitUpTime: "09:42:00", sector: "题材A", turnover: "20", circulationValue: null },
      { stockCode: "600003.SH", stockName: "主板丙", limitUpDate: "2026-08-19", limitUpTime: "09:48:00", sector: "题材A", turnover: "20", circulationValue: null },
    ];

    const result = buildLeaderCandidateBacktest(records);
    const firstDayLead = result.latestRows.find((row) => row.date === "2026-08-18" && row.stockCode === "600001.SH");

    expect(firstDayLead).toMatchObject({ boards: 1, success: true });
    expect(result.totalSamples).toBe(3);
    expect(result.successCount).toBe(3);
    expect(result.successRate).toBe(100);
  });

  it("仅在满足最低历史样本量时输出校准阈值", () => {
    const dates = Array.from({ length: 22 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
    const records = dates.flatMap((date) => ["600001.SH", "600002.SH", "600003.SH"].map((stockCode, index) => ({
      stockCode,
      stockName: `主板${index + 1}`,
      limitUpDate: date,
      limitUpTime: "09:40:00",
      sector: "题材A",
      turnover: "20",
      circulationValue: null,
    })));

    const result = buildLeaderCandidateBacktest(records);

    expect(result.totalSamples).toBe(63);
    expect(result.recommendedMinScore).toBe(45);
    expect(result.calibrationSampleSize).toBe(45);
    expect(result.outOfSample).toMatchObject({ sampleSize: 18, successCount: 18, successRate: 100 });
  });
});
