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

const risk = result.downsideRiskResearch;
const toSummary = (key: "baseline" | "riskPenalty" | "hardFilter") => {
  const item = risk.walkForward?.experiments.find((experiment) => experiment.key === key);
  return item ? { totalReturn: item.totalReturn, maxDrawdown: item.maxDrawdown, completedCount: item.completedCount } : null;
};

console.log(JSON.stringify({
  marketFactorCoverage: result.marketFactorCoverage,
  marketFactorFeatureKeys: risk.featureMatrix.slice(-3).map((feature) => feature.key),
  factorAblationCount: risk.factorAblations.length,
  rollingWindowCount: risk.rollingWindows.length,
  walkForward: {
    baseline: toSummary("baseline"),
    riskPenalty: toSummary("riskPenalty"),
    hardFilter: toSummary("hardFilter"),
  },
}, null, 2));
