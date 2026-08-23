import { describe, expect, it } from "vitest";
import { buildSentimentCycleAnalysis } from "./sentimentCycle";

const row = (stockCode: string, stockName: string, limitUpDate: string, sector: string) => ({
  stockCode,
  stockName,
  limitUpDate,
  limitUpTime: "09:30:00",
  sector,
  turnover: "20",
  circulationValue: "100",
});

const source = [
  row("600001.SH", "老龙头", "2026-08-10", "旧题材"), row("300001.SZ", "创业板干扰项", "2026-08-10", "旧题材"),
  row("600001.SH", "老龙头", "2026-08-11", "旧题材"),
  row("600001.SH", "老龙头", "2026-08-12", "旧题材"), row("600002.SH", "中位股", "2026-08-12", "新题材"),
  row("600001.SH", "老龙头", "2026-08-13", "旧题材"), row("600002.SH", "中位股", "2026-08-13", "新题材"),
  row("600001.SH", "老龙头", "2026-08-14", "旧题材"), row("600002.SH", "中位股", "2026-08-14", "新题材"), row("600003.SH", "低位股", "2026-08-14", "补涨题材"),
  row("600001.SH", "老龙头", "2026-08-15", "旧题材"), row("600002.SH", "中位股", "2026-08-15", "新题材"), row("600003.SH", "低位股", "2026-08-15", "补涨题材"),
  row("600001.SH", "老龙头", "2026-08-16", "旧题材"), row("600002.SH", "中位股", "2026-08-16", "新题材"), row("600003.SH", "低位股", "2026-08-16", "补涨题材"),
  row("600001.SH", "老龙头", "2026-08-17", "旧题材"), row("600002.SH", "中位股", "2026-08-17", "新题材"), row("600003.SH", "低位股", "2026-08-17", "补涨题材"),
  row("600002.SH", "中位股", "2026-08-18", "新题材"), row("600004.SH", "低位补涨股", "2026-08-18", "补涨题材"),
  row("600002.SH", "中位股", "2026-08-19", "新题材"), row("600004.SH", "低位补涨股", "2026-08-19", "补涨题材"),
  row("600002.SH", "中位股", "2026-08-20", "新题材"), row("600004.SH", "低位补涨股", "2026-08-20", "补涨题材"),
  row("600002.SH", "中位股", "2026-08-21", "新题材"), row("600004.SH", "低位补涨股", "2026-08-21", "补涨题材"),
  row("600004.SH", "低位补涨股", "2026-08-22", "补涨题材"),
  row("600004.SH", "低位补涨股", "2026-08-23", "补涨题材"),
];

describe("buildSentimentCycleAnalysis", () => {
  it("以高于五板定义周期龙头，没有六板以上时标记为混沌周期", () => {
    const analysis = buildSentimentCycleAnalysis(source);
    const fiveBoardDay = analysis.days.find((day) => day.date === "2026-08-14");
    const sixBoardDay = analysis.days.find((day) => day.date === "2026-08-15");

    expect(fiveBoardDay).toMatchObject({ maxBoards: 5, marketCycle: "混沌周期", cycleLeaderNames: [] });
    expect(sixBoardDay).toMatchObject({ maxBoards: 6, marketCycle: "龙头周期", cycleLeaderNames: ["老龙头"] });
    expect(analysis.days.every((day) => !day.stockCodes.includes("300001.SZ"))).toBe(true);
  });

  it("在老龙断板后区分突破老龙的穿越周期龙和突破五板的低位补涨龙", () => {
    const analysis = buildSentimentCycleAnalysis(source);
    const event = analysis.breakEvents.find((item) => item.breakDate === "2026-08-18");

    expect(event).toMatchObject({
      breakDate: "2026-08-18",
      previousDate: "2026-08-17",
      originalLeaderNames: ["老龙头"],
      originalMaxBoards: 8,
    });
    expect(event?.throughCycleLeaders).toContainEqual(expect.objectContaining({
      stockName: "中位股", breakDayBoards: 7, highestBoardsAfterBreak: 10, breakthroughDate: "2026-08-20", validationStatus: "已验证",
    }));
    expect(event?.reboundLeaders).toContainEqual(expect.objectContaining({
      stockName: "低位补涨股", breakDayBoards: 1, highestBoardsAfterBreak: 6, breakthroughDate: "2026-08-23", validationStatus: "已验证",
    }));
  });

  it("断板日的候选与分类信号不读取未来数据，未来表现只在历史回顾中更新", () => {
    const asOfBreakDay = buildSentimentCycleAnalysis(source.filter((record) => record.limitUpDate <= "2026-08-18"));
    const event = asOfBreakDay.breakEvents.find((item) => item.breakDate === "2026-08-18");

    expect(event?.newCycleCandidates.some((candidate) => candidate.stockName === "老龙头")).toBe(false);
    expect(event?.throughCycleLeaders).toEqual([]);
    expect(event?.reboundLeaders).toEqual([]);
    expect(event?.postBreakObservations).toContainEqual(expect.objectContaining({ stockName: "中位股", breakDayBoards: 7, validationStatus: "观察中" }));
    expect(event?.postBreakObservations).toContainEqual(expect.objectContaining({ stockName: "低位补涨股", breakDayBoards: 1, validationStatus: "观察中" }));
  });
});
