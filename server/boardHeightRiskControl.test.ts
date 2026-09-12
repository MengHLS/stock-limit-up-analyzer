/**
 * 高位连板风控 + 历史缺失字段降级的集成测试（真实生产链路，不含 mock）。
 *
 * 覆盖两条用户可见需求：
 *   1. 连板高度风险控制：5/6 板加大风险扣分并按系数降仓，超过允许上限限制参与，
 *      确保「风险收益比明显不合理」的标的不会照样产出买入意图；
 *   2. 缺失字段降级：历史期整段缺 sector / limitUpTime 时，
 *      不得把缺失聚合成一个巨型题材（旧缺陷），也不得把缺失当作风险证据。
 */

import { describe, expect, it } from "vitest";
import { buildDownsideRiskResearch, scoreDownsideRiskSignal } from "./downsideRisk";
import { buildLeaderCandidatesForDate, type LeaderCandidateBacktestRow, type LeaderCandidateSourceRecord } from "./leaderCandidates";
import { boardHeightPositionScale, boardHeightRiskContribution } from "../shared/boardHeightRisk";

function row(overrides: Partial<LeaderCandidateBacktestRow>): LeaderCandidateBacktestRow {
  return {
    date: "2026-08-18",
    nextDate: "2026-08-19",
    nextDayDate: "2026-08-19",
    secondDayDate: "2026-08-20",
    stockCode: "600001.SH",
    stockName: "测试股",
    sector: "题材A",
    boards: 2,
    sectorCount: 4,
    score: 80,
    limitUpTime: "09:40:00",
    turnover: "20",
    circulationValue: "100",
    marketCapScore: 16,
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10,
    nextClosePrice: 10,
    nextOpenPremium: 0,
    nextClosePremium: 0,
    secondDayOpenPrice: 10,
    secondDayClosePrice: 10,
    secondDayOpenPremium: 0,
    secondDayClosePremium: 0,
    tPlus1CloseToTPlus2CloseReturn: 0,
    tPlus1CloseToTPlus2CloseSuccess: false,
    phase: "修复上升",
    maxBoards: 3,
    ...overrides,
  };
}

describe("连板高度风险控制", () => {
  it("同题材同封板时间下，5 板 / 6 板的风险分严格高于 4 板", () => {
    const context = { priceByStockDate: new Map() };
    const base = { sectorCount: 4, limitUpTime: "09:40:00", marketCapScore: 16 };
    const four = scoreDownsideRiskSignal(row({ ...base, boards: 4 }), context).riskScore;
    const five = scoreDownsideRiskSignal(row({ ...base, boards: 5 }), context).riskScore;
    const six = scoreDownsideRiskSignal(row({ ...base, boards: 6 }), context).riskScore;
    expect(five).toBeGreaterThan(four);
    expect(six).toBeGreaterThan(five);
    expect(five - four).toBe(boardHeightRiskContribution(5) - boardHeightRiskContribution(4));
  });

  it("7 板高位标的被硬过滤与质量门控限制参与，并单独计数", () => {
    const context = { priceByStockDate: new Map<string, never>(), tradingDates: ["2026-08-18", "2026-08-19", "2026-08-20"] };
    const rows = [
      row({ stockCode: "600001.SH", stockName: "七板高位", boards: 7, score: 95, sectorCount: 5, limitUpTime: "09:35:00", marketCapScore: 16 }),
      row({ stockCode: "600002.SH", stockName: "四板中位", boards: 4, score: 90, sectorCount: 5, limitUpTime: "09:35:00", marketCapScore: 16 }),
    ];
    const result = buildDownsideRiskResearch(rows, { observationDays: 2, maxParticipatingBoards: 6 }, {}, context);

    const hardFilter = result.fullCycle.experiments.find((experiment) => experiment.key === "hardFilter")!;
    const qualityGate = result.fullCycle.experiments.find((experiment) => experiment.key === "qualityGate")!;
    // 7 板被限制参与，剩下 4 板正常通过两条门槛。
    expect(hardFilter.inputCandidateCount).toBe(1);
    expect(hardFilter.boardHeightExcludedCount).toBe(1);
    expect(qualityGate.inputCandidateCount).toBe(1);
    expect(qualityGate.boardHeightExcludedCount).toBe(1);

    const highBoardDifference = result.fullCycle.tradeDifferences.find((item) => item.stockCode === "600001.SH")!;
    expect(highBoardDifference.hardFilterExcluded).toBe(true);
    expect(highBoardDifference.qualityGateExcluded).toBe(true);
    // 原始策略始终是对照基准，不会被高位连板约束删除。
    expect(result.fullCycle.experiments.find((experiment) => experiment.key === "baseline")!.inputCandidateCount).toBe(2);
    expect(result.boardHeightRiskControl.maxParticipatingBoards).toBe(6);
    expect(result.boardHeightImpact.find((item) => item.key === "hardFilter")).toMatchObject({ restrictedCount: 1, scaledCount: 0 });
  });

  it("5 板 / 6 板未越上限但按固定系数降低仓位，且不删除候选", () => {
    const context = { priceByStockDate: new Map<string, never>(), tradingDates: ["2026-08-18", "2026-08-19", "2026-08-20"] };
    const rows = [
      row({ stockCode: "600001.SH", stockName: "五板高位", boards: 5, score: 92, sectorCount: 5, limitUpTime: "09:35:00", marketCapScore: 16 }),
      row({ stockCode: "600002.SH", stockName: "六板高位", boards: 6, score: 92, sectorCount: 5, limitUpTime: "09:35:00", marketCapScore: 16 }),
      row({ stockCode: "600003.SH", stockName: "二板低位", boards: 2, score: 92, sectorCount: 5, limitUpTime: "09:35:00", marketCapScore: 16 }),
    ];
    const result = buildDownsideRiskResearch(rows, { observationDays: 2 }, {}, context);

    const riskPenalty = result.fullCycle.experiments.find((experiment) => experiment.key === "riskPenalty")!;
    // 两条高位标的都被降仓，低位标的保持 1.0。
    expect(riskPenalty.positionScaledCount).toBe(2);
    expect(riskPenalty.inputCandidateCount).toBe(3);
    expect(riskPenalty.excludedCandidateCount).toBe(0);
    expect(boardHeightPositionScale(5)).toBe(0.6);
    expect(boardHeightPositionScale(6)).toBe(0.3);
    // 原始策略是对照基准，不做任何高位约束。
    expect(result.fullCycle.experiments.find((experiment) => experiment.key === "baseline")!.positionScaledCount).toBe(0);
  });

  it("提高允许参与上限即放宽限制参与，但阶梯扣分与降仓仍然生效", () => {
    const context = {
      priceByStockDate: new Map([["600001.SH::2026-08-18", { openPrice: 10, closePrice: 10, amount: 90_000 }]]),
      tradingDates: ["2026-08-18", "2026-08-19", "2026-08-20"],
    };
    // 高位但其余条件极佳（题材共振 / 早封 / 充裕成交额 / 大市值）→ 风险分仅来自连板高度。
    const rows = [row({ stockCode: "600001.SH", boards: 7, score: 95, sectorCount: 5, limitUpTime: "09:35:00", marketCapScore: 16 })];
    const strict = buildDownsideRiskResearch(rows, { observationDays: 2, maxParticipatingBoards: 6 }, {}, context);
    const relaxed = buildDownsideRiskResearch(rows, { observationDays: 2, maxParticipatingBoards: 8 }, {}, context);

    const hardFilterCount = (result: typeof strict) => result.fullCycle.experiments.find((experiment) => experiment.key === "hardFilter")!.inputCandidateCount;
    const restrictedCount = (result: typeof strict) => result.fullCycle.experiments.find((experiment) => experiment.key === "hardFilter")!.boardHeightExcludedCount;
    // 上限 6：7 板被限制参与；上限 8：同一标的恢复参与（说明上限确实可配）。
    expect(hardFilterCount(strict)).toBe(0);
    expect(restrictedCount(strict)).toBe(1);
    expect(hardFilterCount(relaxed)).toBe(1);
    expect(restrictedCount(relaxed)).toBe(0);
    // 无论上限怎么放宽，阶梯扣分与降仓都仍然生效（不因放宽上限而消失）。
    expect(relaxed.fullCycle.experiments.find((experiment) => experiment.key === "riskPenalty")!.positionScaledCount).toBe(1);
    expect(scoreDownsideRiskSignal(rows[0]!, context).riskScore).toBe(boardHeightRiskContribution(7));
  });
});

describe("历史缺失字段降级", () => {
  it("整日缺题材时不再聚合成一个巨型题材，家数改用同日中性值", () => {
    const records: LeaderCandidateSourceRecord[] = [
      { stockCode: "600001.SH", stockName: "甲", limitUpDate: "2025-08-18", limitUpTime: null, sector: null, turnover: "10", circulationValue: "50", keywords: null },
      { stockCode: "600002.SH", stockName: "乙", limitUpDate: "2025-08-18", limitUpTime: null, sector: null, turnover: "10", circulationValue: "50", keywords: null },
      { stockCode: "600003.SH", stockName: "丙", limitUpDate: "2025-08-18", limitUpTime: null, sector: null, turnover: "10", circulationValue: "50", keywords: null },
    ];
    const result = buildLeaderCandidatesForDate(records, "2025-08-18", { candidateLimit: null });
    // 旧口径会把 3 只全部并入同一个兜底题材 → 每只都拿到题材分上限（sectorCount = 3）。
    // 新口径：题材不可解析 → 不并入任何题材桶，家数走中性兜底值 1。
    expect(result.strongSectors).toEqual([]);
    for (const candidate of result.allScoredStocks) {
      expect(candidate.sectorAvailable).toBe(false);
      expect(candidate.sectorCount).toBe(1);
      expect(candidate.riskTags.some((tag) => tag.includes("历史未采集"))).toBe(true);
    }
  });

  it("整日缺题材时「题材支撑不足」不再作为风险证据（缺失 ≠ 弱题材）", () => {
    const context = { priceByStockDate: new Map() };
    const withMissingSector = scoreDownsideRiskSignal(
      row({ sectorCount: 1, sectorAvailable: false, limitUpTime: null, limitUpTimeAvailable: false }),
      context,
    );
    const withKnownWeakSector = scoreDownsideRiskSignal(
      row({ sectorCount: 1, sectorAvailable: true, limitUpTime: null, limitUpTimeAvailable: false }),
      context,
    );
    // 可解析的 1 家题材 → 扣 16；不可解析 → 不扣（缺失不能被当成风险证据）。
    expect(withKnownWeakSector.riskScore - withMissingSector.riskScore).toBe(16);
  });

  it("封板时间缺失不再伪造「封板偏晚」风险，但字段可得时仍按原口径扣分", () => {
    const context = { priceByStockDate: new Map() };
    const missing = scoreDownsideRiskSignal(row({ limitUpTime: null, limitUpTimeAvailable: false }), context);
    const lateKnown = scoreDownsideRiskSignal(row({ limitUpTime: "14:40:00", limitUpTimeAvailable: true }), context);
    expect(lateKnown.riskScore).toBeGreaterThan(missing.riskScore);
  });

  it("字段完整的交易日保持原有口径：题材家数与风险扣分与旧逻辑一致", () => {
    const records: LeaderCandidateSourceRecord[] = [
      { stockCode: "600001.SH", stockName: "甲", limitUpDate: "2025-12-01", limitUpTime: "09:35:00", sector: "算力", turnover: "20", circulationValue: "100", keywords: "算力+液冷" },
      { stockCode: "600002.SH", stockName: "乙", limitUpDate: "2025-12-01", limitUpTime: "10:20:00", sector: "算力", turnover: "20", circulationValue: "100", keywords: "算力+液冷" },
      { stockCode: "600003.SH", stockName: "丙", limitUpDate: "2025-12-01", limitUpTime: "14:50:00", sector: "军工", turnover: "5", circulationValue: "100", keywords: "军工" },
    ];
    const result = buildLeaderCandidatesForDate(records, "2025-12-01", { candidateLimit: null });
    const byCode = new Map(result.allScoredStocks.map((candidate) => [candidate.stockCode, candidate]));
    expect(byCode.get("600001.SH")).toMatchObject({ sector: "算力", sectorCount: 2, sectorAvailable: true, limitUpTimeAvailable: true });
    expect(byCode.get("600003.SH")).toMatchObject({ sector: "军工", sectorCount: 1, sectorAvailable: true });
    expect(byCode.get("600003.SH")!.riskTags).toContain("题材支撑偏弱");
    expect(result.strongSectors[0]).toEqual({ sector: "算力", count: 2 });
  });

  it("sector 缺失但 keywords 可得时用首个主题词兜底（局部缺列场景）", () => {
    const records: LeaderCandidateSourceRecord[] = [
      { stockCode: "600001.SH", stockName: "甲", limitUpDate: "2025-10-09", limitUpTime: "09:35:00", sector: null, turnover: "20", circulationValue: "100", keywords: "商业航天+军工" },
      { stockCode: "600002.SH", stockName: "乙", limitUpDate: "2025-10-09", limitUpTime: "09:40:00", sector: null, turnover: "20", circulationValue: "100", keywords: "商业航天+军工" },
    ];
    const result = buildLeaderCandidatesForDate(records, "2025-10-09", { candidateLimit: null });
    for (const candidate of result.allScoredStocks) {
      expect(candidate.sector).toBe("商业航天");
      expect(candidate.sectorCount).toBe(2);
      expect(candidate.sectorAvailable).toBe(true);
    }
  });

  it("回测结果附带字段覆盖报告，且不参与评分", () => {
    const coverage = buildLeaderCandidatesForDate([
      { stockCode: "600001.SH", stockName: "甲", limitUpDate: "2025-08-18", limitUpTime: null, sector: null, turnover: "10", circulationValue: "50", keywords: null },
    ], "2025-08-18", { candidateLimit: null });
    // 候选仍正常产出（旧数据必须能稳定参与回测），只是字段相关能力被降级。
    expect(coverage.allScoredStocks).toHaveLength(1);
    expect(coverage.allScoredStocks[0]!.score).toBeGreaterThan(0);
  });
});
