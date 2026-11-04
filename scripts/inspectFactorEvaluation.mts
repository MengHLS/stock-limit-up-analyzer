import "dotenv/config";
import { getLeaderCandidateBacktest } from "../server/db";

const result = await getLeaderCandidateBacktest({
  observationDays: 1,
  realistic: {
    initialCapital: 100000,
    maxPositions: 5,
    commissionRate: 0.0003,
    stampDutyRate: 0.0005,
    transferFeeRate: 0.00001,
    slippageBps: 10,
    blockLimitUpBuys: false,
    blockLimitDownSells: false,
    enableOneWordLimitDownProbability: false,
    oneWordLimitDownSellProbability: 0,
    positionSizingStrategy: "equal",
    fixedPositionPercent: 20,
    minimumExpectedOpenChangePercent: -2,
    trailingProfitActivationPercent: 6,
    trailingDrawdownPercent: 3,
    stopLossPercent: 5,
    strongHoldMinReturn: 3,
    maxHoldingDays: 5,
  },
  downsideRisk: {
    observationDays: 5,
    mediumDownsidePercent: 4,
    highDownsidePercent: 8,
    penaltyWeight: 0.35,
    autoTunePenaltyWeight: true,
    hardRiskThreshold: 65,
    rollingTrainTradingDays: 45,
    rollingValidationTradingDays: 14,
  },
});

const fe = result.factorEvaluation;
console.log("=== FACTOR EVALUATION ===");
console.log(JSON.stringify({
  forwardReturnField: fe.forwardReturnField,
  rankIc: fe.rankIc.map((r) => ({
    label: r.label, sampleSize: r.sampleSize, dailyIcCount: r.dailyIcCount,
    meanIc: r.meanIc, icIr: r.icIr, positiveIcRatio: r.positiveIcRatio, effective: r.effective,
  })),
  quintiles: fe.quintiles.map((q) => ({
    label: q.label, monotonic: q.monotonic, direction: q.monotonicDirection,
    buckets: q.buckets.map((b) => ({ q: b.quintile, n: b.sampleSize, avg: b.averageForwardReturn })),
  })),
  phaseStability: fe.phaseStability.map((p) => ({
    label: p.label, directionConsistent: p.directionConsistent,
    phases: p.phases.map((ph) => ({ phase: ph.phase, n: ph.sampleSize, meanIc: ph.meanIc, icIr: ph.icIr })),
  })),
}, null, 2));

const withFactors = result.historicalRows.filter((r) => r.technicalFactors?.turnoverRate !== null && r.technicalFactors?.turnoverRate !== undefined);
console.log("=== SAMPLE ROWS (有换手率的样本) ===");
console.log(JSON.stringify(withFactors.slice(0, 8).map((r) => ({
  date: r.date, code: r.stockCode, name: r.stockName,
  turnoverRecord: r.turnover, circ: r.circulationValue,
  factors: r.technicalFactors,
  nextClosePremium: r.nextClosePremium,
})), null, 2));
console.log("总样本数:", result.historicalRows.length, "含换手率样本:", withFactors.length);
