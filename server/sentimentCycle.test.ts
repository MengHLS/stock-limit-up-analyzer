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
  row("600001.SH", "老龙头", "2026-08-17", "旧题材"), row("600002.SH", "中位股", "2026-08-17", "新题材"), row("600003.SH", "低位股", "2026-08-17", "补涨题材"), row("600005.SH", "未穿越中位股", "2026-08-17", "补涨题材"),
  row("600002.SH", "中位股", "2026-08-18", "新题材"), row("600004.SH", "低位补涨股", "2026-08-18", "补涨题材"), row("600005.SH", "未穿越中位股", "2026-08-18", "补涨题材"),
  row("600002.SH", "中位股", "2026-08-19", "新题材"), row("600004.SH", "低位补涨股", "2026-08-19", "补涨题材"), row("600005.SH", "未穿越中位股", "2026-08-19", "补涨题材"),
  row("600002.SH", "中位股", "2026-08-20", "新题材"), row("600004.SH", "低位补涨股", "2026-08-20", "补涨题材"), row("600005.SH", "未穿越中位股", "2026-08-20", "补涨题材"),
  row("600002.SH", "中位股", "2026-08-21", "新题材"), row("600004.SH", "低位补涨股", "2026-08-21", "补涨题材"), row("600005.SH", "未穿越中位股", "2026-08-21", "补涨题材"),
  row("600004.SH", "低位补涨股", "2026-08-22", "补涨题材"), row("600005.SH", "未穿越中位股", "2026-08-22", "补涨题材"),
  row("600004.SH", "低位补涨股", "2026-08-23", "补涨题材"), row("600005.SH", "未穿越中位股", "2026-08-23", "补涨题材"),
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

  it("只将低位混沌期首板起涨、后续成为六板龙头的股票识别为原生龙", () => {
    const analysis = buildSentimentCycleAnalysis(source);
    const originalLeader = analysis.nativeLeaders.find((leader) => leader.stockCode === "600001.SH");

    expect(originalLeader).toMatchObject({
      stockName: "老龙头",
      startDate: "2026-08-10",
      startDayMaxBoards: 1,
      confirmationDate: "2026-08-15",
    });
    expect(analysis.nativeLeaders.some((leader) => leader.stockName === "中位股")).toBe(false);
    expect(analysis.nativeLeaders.some((leader) => leader.stockCode === "300001.SZ")).toBe(false);
  });

  it("在原生龙达到六板前不以未来数据提前确认", () => {
    const beforeConfirmation = buildSentimentCycleAnalysis(source.filter((record) => record.limitUpDate <= "2026-08-14"));
    expect(beforeConfirmation.nativeLeaders).toEqual([]);
  });

  it("汇总所有已确认龙头并以一只股票一行展示其全部类型", () => {
    const analysis = buildSentimentCycleAnalysis(source);
    const originalLeader = analysis.leaderList.find((leader) => leader.stockCode === "600001.SH");
    const throughLeader = analysis.leaderList.find((leader) => leader.stockCode === "600002.SH");
    const reboundLeader = analysis.leaderList.find((leader) => leader.stockCode === "600004.SH");

    expect(originalLeader).toMatchObject({ stockName: "老龙头", leaderTypes: ["原生龙", "周期龙头"] });
    expect(throughLeader).toMatchObject({ stockName: "中位股", leaderTypes: ["穿越周期龙", "周期龙头"], highestBoards: 10 });
    expect(reboundLeader).toMatchObject({ stockName: "低位补涨股", leaderTypes: ["补涨龙", "周期龙头"], highestBoards: 6 });
    expect(analysis.leaderList.filter((leader) => leader.stockCode === "600002.SH")).toHaveLength(1);
    expect(analysis.leaderList.some((leader) => leader.stockCode === "300001.SZ")).toBe(false);
  });

  it("原生龙一旦被识别为穿越或补涨龙，列表只保留后续类型和周期龙头身份", () => {
    const nativeThenRebound = [
      row("600008.SH", "旧周期龙", "2026-10-01", "旧题材"), row("600008.SH", "旧周期龙", "2026-10-02", "旧题材"),
      row("600008.SH", "旧周期龙", "2026-10-03", "旧题材"), row("600008.SH", "旧周期龙", "2026-10-04", "旧题材"),
      row("600008.SH", "旧周期龙", "2026-10-05", "旧题材"), row("600008.SH", "旧周期龙", "2026-10-06", "旧题材"),
      row("600009.SH", "新周期股", "2026-10-07", "新题材"), row("600009.SH", "新周期股", "2026-10-08", "新题材"),
      row("600009.SH", "新周期股", "2026-10-09", "新题材"), row("600009.SH", "新周期股", "2026-10-10", "新题材"),
      row("600009.SH", "新周期股", "2026-10-11", "新题材"), row("600009.SH", "新周期股", "2026-10-12", "新题材"),
    ];
    const analysis = buildSentimentCycleAnalysis(nativeThenRebound);
    const leader = analysis.leaderList.find((item) => item.stockCode === "600009.SH");

    expect(leader).toMatchObject({ leaderTypes: ["补涨龙", "周期龙头"] });
    expect(leader?.leaderTypes).not.toContain("原生龙");
  });

  it("以同一连续连板段的首日为原生龙起点，不回溯到数据库中更早的孤立涨停", () => {
    const interruptedRun = [
      row("600006.SH", "连续龙", "2026-09-01", "新题材"),
      row("600007.SH", "市场样本", "2026-09-02", "其他"),
      row("600006.SH", "连续龙", "2026-09-03", "新题材"),
      row("600006.SH", "连续龙", "2026-09-04", "新题材"),
      row("600006.SH", "连续龙", "2026-09-05", "新题材"),
      row("600006.SH", "连续龙", "2026-09-06", "新题材"),
      row("600006.SH", "连续龙", "2026-09-07", "新题材"),
      row("600006.SH", "连续龙", "2026-09-08", "新题材"),
    ];
    const analysis = buildSentimentCycleAnalysis(interruptedRun);

    expect(analysis.nativeLeaders).toContainEqual(expect.objectContaining({
      stockName: "连续龙",
      startDate: "2026-09-03",
      confirmationDate: "2026-09-08",
    }));
    expect(analysis.nativeLeaders.some((leader) => leader.startDate === "2026-09-01")).toBe(false);
  });

  it("将连续相同市场周期合并，并保留区间内发生过的情绪阶段", () => {
    const earlyAnalysis = buildSentimentCycleAnalysis(source.filter((record) => record.limitUpDate <= "2026-08-14"));

    expect(earlyAnalysis.segments).toHaveLength(1);
    expect(earlyAnalysis.segments[0]).toMatchObject({
      marketCycle: "混沌周期",
      startDate: "2026-08-10",
      endDate: "2026-08-14",
      maxBoards: 5,
      phases: ["冰点试错", "修复上升", "上升发酵"],
    });
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
    expect(event?.reboundLeaders).toContainEqual(expect.objectContaining({
      stockName: "未穿越中位股", breakDayBoards: 2, highestBoardsAfterBreak: 7, breakthroughDate: "2026-08-22", validationStatus: "已验证",
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
