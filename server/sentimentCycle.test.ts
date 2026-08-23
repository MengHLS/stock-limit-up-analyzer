import { describe, expect, it } from "vitest";
import { buildSentimentCycleAnalysis } from "./sentimentCycle";

const source = [
  { stockCode: "600001.SH", stockName: "旧龙头", limitUpDate: "2026-08-10", limitUpTime: "09:30:00", sector: "旧题材", turnover: "20", circulationValue: "100" },
  { stockCode: "300001.SZ", stockName: "创业板干扰项", limitUpDate: "2026-08-10", limitUpTime: "09:30:00", sector: "旧题材", turnover: "20", circulationValue: "100" },
  { stockCode: "600001.SH", stockName: "旧龙头", limitUpDate: "2026-08-11", limitUpTime: "09:30:00", sector: "旧题材", turnover: "20", circulationValue: "100" },
  { stockCode: "600001.SH", stockName: "旧龙头", limitUpDate: "2026-08-12", limitUpTime: "09:30:00", sector: "旧题材", turnover: "20", circulationValue: "100" },
  { stockCode: "600002.SH", stockName: "新龙头", limitUpDate: "2026-08-12", limitUpTime: "09:35:00", sector: "新题材", turnover: "20", circulationValue: "100" },
  { stockCode: "600002.SH", stockName: "新龙头", limitUpDate: "2026-08-13", limitUpTime: "09:35:00", sector: "新题材", turnover: "20", circulationValue: "100" },
  { stockCode: "600003.SH", stockName: "新题材甲", limitUpDate: "2026-08-13", limitUpTime: "09:40:00", sector: "新题材", turnover: "20", circulationValue: "50" },
  { stockCode: "600004.SH", stockName: "新题材乙", limitUpDate: "2026-08-13", limitUpTime: "09:45:00", sector: "新题材", turnover: "20", circulationValue: "50" },
  { stockCode: "600002.SH", stockName: "新龙头", limitUpDate: "2026-08-14", limitUpTime: "09:35:00", sector: "新题材", turnover: "20", circulationValue: "100" },
  { stockCode: "600003.SH", stockName: "新题材甲", limitUpDate: "2026-08-14", limitUpTime: "09:40:00", sector: "新题材", turnover: "20", circulationValue: "50" },
  { stockCode: "600004.SH", stockName: "新题材乙", limitUpDate: "2026-08-14", limitUpTime: "09:45:00", sector: "新题材", turnover: "20", circulationValue: "50" },
  { stockCode: "600002.SH", stockName: "新龙头", limitUpDate: "2026-08-15", limitUpTime: "09:35:00", sector: "新题材", turnover: "20", circulationValue: "100" },
  { stockCode: "600002.SH", stockName: "新龙头", limitUpDate: "2026-08-16", limitUpTime: "09:35:00", sector: "新题材", turnover: "20", circulationValue: "100" },
];

describe("buildSentimentCycleAnalysis", () => {
  it("从主板最高连板趋势划分阶段并识别原龙头断板日", () => {
    const analysis = buildSentimentCycleAnalysis(source);

    expect(analysis.days.map((day) => [day.date, day.maxBoards, day.phase])).toContainEqual(["2026-08-12", 3, "上升发酵"]);
    expect(analysis.days.every((day) => !day.stockCodes.includes("300001.SZ"))).toBe(true);
    expect(analysis.breakEvents[0]).toMatchObject({
      breakDate: "2026-08-13",
      previousDate: "2026-08-12",
      originalLeaderNames: ["旧龙头"],
      originalMaxBoards: 3,
    });
  });

  it("在断板日仅使用当日及以前数据产生新周期候选，并将后续表现独立标记", () => {
    const complete = buildSentimentCycleAnalysis(source);
    const event = complete.breakEvents[0];
    const newLeader = event.newCycleCandidates.find((candidate) => candidate.stockCode === "600002.SH");

    expect(newLeader).toMatchObject({ stockName: "新龙头", boards: 2, followUpReady: true, followUpHighestBoards: 5, becameHighestBoardLeader: true });
    expect(event.newCycleCandidates.some((candidate) => candidate.stockName === "旧龙头")).toBe(false);

    const asOfBreakDay = buildSentimentCycleAnalysis(source.filter((record) => record.limitUpDate <= "2026-08-13"));
    const pendingCandidate = asOfBreakDay.breakEvents[0].newCycleCandidates.find((candidate) => candidate.stockCode === "600002.SH");
    expect(pendingCandidate).toMatchObject({ stockName: "新龙头", boards: 2, followUpReady: false, followUpHighestBoards: null, becameHighestBoardLeader: null });
  });
});
