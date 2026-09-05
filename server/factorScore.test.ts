import { describe, expect, it } from "vitest";
import { evaluateFactorEffectiveness } from "./technicalFactors";
import { buildFactorNeutralizationReport } from "./factorCombination";
import { buildOverfittingGuardReport } from "./overfittingGuard";
import { buildFactorVerdicts, buildFinalVerdict, buildStrategyOverfittingRiskScore } from "./factorScore";
import type { LeaderCandidateBacktestRow } from "./leaderCandidates";
import type { OverfittingGuardReport } from "./overfittingGuard";

function makeRow(overrides: Partial<LeaderCandidateBacktestRow> = {}): LeaderCandidateBacktestRow {
  return {
    stockCode: "600001.SH",
    stockName: "测试股",
    sector: "题材",
    boards: 2,
    score: 60,
    circulationValue: "50",
    marketCapScore: 12,
    date: "2026-08-18",
    nextDate: "2026-08-19",
    nextDayDate: "2026-08-19",
    secondDayDate: "2026-08-20",
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10.5,
    nextClosePrice: 11,
    nextOpenPremium: 5,
    nextClosePremium: 10,
    secondDayOpenPrice: 11,
    secondDayClosePrice: 11.5,
    secondDayOpenPremium: 10,
    secondDayClosePremium: 15,
    tPlus1CloseToTPlus2CloseReturn: 4.55,
    tPlus1CloseToTPlus2CloseSuccess: true,
    ...overrides,
  };
}

/** 构造一个换手率强正向、其他因子缺失的回测行集。 */
function strongFactorRows(): LeaderCandidateBacktestRow[] {
  const rows: LeaderCandidateBacktestRow[] = [];
  const dates = ["2026-08-18", "2026-08-19", "2026-08-20"];
  dates.forEach((date, dateIndex) => {
    [1, 2, 3, 4].forEach((factor, factorIndex) => {
      rows.push(makeRow({
        stockCode: `6000${dateIndex}${factorIndex}.SH`,
        date,
        boards: factorIndex + 1,
        sectorCount: factorIndex + 1,
        marketCapScore: factorIndex + 1,
        technicalFactors: { turnoverRate: factor, volumeRatio: null, amplitude: null },
        nextClosePremium: factor * 2,
      }));
    });
  });
  return rows;
}

describe("buildFactorVerdicts", () => {
  it("强预测因子评级非 Invalid，且汇总覆盖全部因子", () => {
    const rows = strongFactorRows();
    const evaluation = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const combination = buildFactorNeutralizationReport(rows);
    const verdicts = buildFactorVerdicts(evaluation, combination);
    expect(verdicts).toHaveLength(7);
    const turnover = verdicts.find((verdict) => verdict.factorKey === "turnoverRate")!;
    expect(turnover.grade).not.toBe("Invalid");
    expect(turnover.finalScore).toBeGreaterThan(0);
    // 样本不足的因子应判 Invalid
    const amplitude = verdicts.find((verdict) => verdict.factorKey === "amplitude")!;
    expect(amplitude.grade).toBe("Invalid");
  });
});

describe("buildStrategyOverfittingRiskScore", () => {
  it("高 DSR/PSR 低风险，低 DSR/PSR 高风险", () => {
    const lowRisk: OverfittingGuardReport = {
      realSharpe: 2.5,
      numTrials: 30,
      deflatedSharpe: 0.99,
      expectedMaximumSharpe: 0.5,
      psr: 0.99,
      bootstrap: { numTrials: 100, sharpeMean: 2, sharpeLower95: 1.5, sharpeUpper95: 3, maxDrawdownMean: 5, maxDrawdownP95: 8, cagrMean: 20, ruinProbability: 0.02, definition: "" },
      definition: "",
    };
    const highRisk: OverfittingGuardReport = {
      realSharpe: 0.3,
      numTrials: 30,
      deflatedSharpe: 0.2,
      expectedMaximumSharpe: 0.8,
      psr: 0.3,
      bootstrap: { numTrials: 100, sharpeMean: 0.2, sharpeLower95: -0.5, sharpeUpper95: 0.8, maxDrawdownMean: 30, maxDrawdownP95: 45, cagrMean: -2, ruinProbability: 0.4, definition: "" },
      definition: "",
    };
    expect(buildStrategyOverfittingRiskScore(lowRisk, 2, 2.5).label).toBe("Low");
    expect(buildStrategyOverfittingRiskScore(highRisk, 0.1, 0.3).label).toBe("High");
  });
});

describe("buildFinalVerdict", () => {
  it("汇总因子评级、过拟合风险与策略质量", () => {
    const rows = strongFactorRows();
    const evaluation = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const combination = buildFactorNeutralizationReport(rows);
    const overfitting = buildOverfittingGuardReport(
      {
        assumptions: {
          initialCapital: 100000, maxPositions: 5, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0,
          lotSize: 100, blockLimitUpBuys: false, blockLimitDownSells: false, enableOneWordLimitDownProbability: false,
          oneWordLimitDownSellProbability: 0, positionSizingStrategy: "equal", fixedPositionPercent: 20, exitStrategy: "riskManagedHold",
          trailingProfitActivationPercent: 6, trailingDrawdownPercent: 3, stopLossPercent: 5, strongHoldMinReturn: 3,
          maxHoldingDays: 5, minimumExpectedOpenChangePercent: -2, blockOneWordLimitUpBuys: false, enableIntradayStopLoss: false,
          maxPositionAmountRatio: 0, detectExRights: false,
        },
        initialCapital: 100000, finalCapital: 120000, netProfit: 20000, totalReturn: 20, maxDrawdown: 5,
        tradeCount: 0, filledCount: 0, completedCount: 0, openPositionCount: 0, peakOpenPositionCount: 0,
        minimumCash: 100000, totalCandidateCount: 0, priceAvailableCount: 0, capacitySkippedCount: 0, skippedCount: 0,
        winningTrades: 0, winRate: null, averageReturn: null, profitFactor: null,
        blockedBuyCount: 0, blockedSellCount: 0, missingDataCount: 0, exRightsCount: 0,
        equityCurve: [
          { date: "2026-08-18", equity: 100000, cash: 100000, openPositions: 0 },
          { date: "2026-08-19", equity: 105000, cash: 100000, openPositions: 0 },
          { date: "2026-08-20", equity: 110000, cash: 100000, openPositions: 0 },
          { date: "2026-08-21", equity: 120000, cash: 100000, openPositions: 0 },
        ],
        trades: [],
      },
      30,
    );
    const verdict = buildFinalVerdict(evaluation, combination, overfitting, null, overfitting.realSharpe);
    expect(verdict.factorVerdicts).toHaveLength(7);
    const total = verdict.gradeSummary.Strong + verdict.gradeSummary.Medium + verdict.gradeSummary.Weak + verdict.gradeSummary.Invalid;
    expect(total).toBe(7);
    expect(verdict.strategyQuality.score).toBeGreaterThanOrEqual(0);
    expect(verdict.strategyQuality.score).toBeLessThanOrEqual(100);
    expect(verdict.overfittingRisk.score).toBeGreaterThanOrEqual(0);
    expect(verdict.overfittingRisk.score).toBeLessThanOrEqual(100);
  });
});
