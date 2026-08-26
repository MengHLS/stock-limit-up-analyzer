import type { LeaderCandidateBacktestContext, LeaderCandidateBacktestRow } from "./leaderCandidates";
import { simulateRealisticTPlus1ToTPlus2, type RealisticBacktestOptions, type RealisticBacktestResult } from "./realisticBacktest";

export type DownsideRiskOptions = {
  observationDays?: number;
  mediumDownsidePercent?: number;
  highDownsidePercent?: number;
  penaltyWeight?: number;
  hardRiskThreshold?: number;
};

export type DownsideRiskFeature = {
  key: string;
  label: string;
  definition: string;
  timing: "信号日";
};

export type DownsideRiskProfile = {
  row: LeaderCandidateBacktestRow;
  riskScore: number;
  riskTier: "低风险" | "中风险" | "高风险";
  maxAdverseCloseReturn: number | null;
  observedTradingDays: number;
  mediumDownside: boolean | null;
  highDownside: boolean | null;
};

export type DownsideRiskTierSummary = {
  tier: "低风险" | "中风险" | "高风险";
  sampleSize: number;
  averageMaxAdverseCloseReturn: number | null;
  mediumDownsideCount: number;
  mediumDownsideRate: number | null;
  highDownsideCount: number;
  highDownsideRate: number | null;
};

export type DownsideRiskExperimentItem = {
  key: "baseline" | "riskPenalty" | "hardFilter";
  label: string;
  description: string;
  inputCandidateCount: number;
  excludedCandidateCount: number;
  realisticSimulation: RealisticBacktestResult;
};

export type DownsideRiskResearchResult = {
  definition: string;
  observationDays: number;
  mediumDownsidePercent: number;
  highDownsidePercent: number;
  penaltyWeight: number;
  hardRiskThreshold: number;
  featureMatrix: DownsideRiskFeature[];
  labeledSampleSize: number;
  riskTiers: DownsideRiskTierSummary[];
  experiments: DownsideRiskExperimentItem[];
};

const riskFeatures: DownsideRiskFeature[] = [
  { key: "boards", label: "连板高度", definition: "信号日连续涨停板数；高板相对增加风险扣分。", timing: "信号日" },
  { key: "sectorCount", label: "题材支撑", definition: "信号日同题材涨停数量；题材支撑不足增加风险扣分。", timing: "信号日" },
  { key: "limitUpTime", label: "封板时间", definition: "信号日封板时间；封板偏晚增加风险扣分。", timing: "信号日" },
  { key: "turnover", label: "成交额", definition: "信号日记录的成交额；成交额不足增加风险扣分。", timing: "信号日" },
  { key: "marketCap", label: "流通市值评分", definition: "信号日可得流通市值分层；极小盘、超大盘或缺失增加风险扣分。", timing: "信号日" },
  { key: "phase", label: "情绪周期", definition: "信号日最高连板趋势所属阶段；高位退潮与亢奋阶段增加风险扣分。", timing: "信号日" },
  { key: "marketHeight", label: "市场高度", definition: "信号日主板最高连板数；高度拥挤时增加风险扣分。", timing: "信号日" },
  { key: "candidateScore", label: "原始候选分", definition: "原有龙头候选强度分；较低分增加风险扣分。", timing: "信号日" },
];

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const ratio = (numerator: number, denominator: number) => denominator === 0 ? null : round((numerator / denominator) * 100, 1);

function parseTurnover(value: string | null | undefined) {
  const parsed = Number.parseFloat((value ?? "").replace(/[亿元,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function closeReturnLabel(
  row: LeaderCandidateBacktestRow,
  context: LeaderCandidateBacktestContext,
  observationDays: number,
) {
  const entryPrice = row.nextOpenPrice;
  const tradingDates = context.tradingDates ?? [];
  const startIndex = tradingDates.indexOf(row.nextDayDate);
  if (!entryPrice || entryPrice <= 0 || startIndex < 0) return { maxAdverseCloseReturn: null, observedTradingDays: 0 };

  let minObservedPrice = entryPrice;
  let observedTradingDays = 0;
  for (let offset = 0; offset < observationDays; offset += 1) {
    const date = tradingDates[startIndex + offset];
    if (!date) return { maxAdverseCloseReturn: null, observedTradingDays };
    const closePrice = context.priceByStockDate?.get(`${row.stockCode}::${date}`)?.closePrice ?? null;
    if (!closePrice || closePrice <= 0) return { maxAdverseCloseReturn: null, observedTradingDays };
    minObservedPrice = Math.min(minObservedPrice, closePrice);
    observedTradingDays += 1;
  }

  return {
    maxAdverseCloseReturn: round(((minObservedPrice - entryPrice) / entryPrice) * 100),
    observedTradingDays,
  };
}

function calculateRiskScore(row: LeaderCandidateBacktestRow) {
  let score = 0;
  score += row.boards >= 4 ? 20 : row.boards === 3 ? 12 : row.boards === 2 ? 5 : 0;
  score += (row.sectorCount ?? 0) <= 1 ? 16 : (row.sectorCount ?? 0) === 2 ? 8 : 0;
  const time = row.limitUpTime ?? "";
  score += !time ? 5 : time >= "14:30:00" ? 16 : time >= "13:30:00" ? 9 : 0;
  const turnover = parseTurnover(row.turnover);
  score += turnover === null ? 5 : turnover < 2 ? 12 : turnover < 5 ? 6 : 0;
  score += row.marketCapScore <= 4 ? 10 : row.marketCapScore <= 5 ? 6 : 0;
  score += row.phase === "高位退潮" ? 24 : row.phase === "高位亢奋" ? 16 : row.phase === "高位分歧" ? 9 : 0;
  score += (row.maxBoards ?? 0) >= 6 ? 10 : (row.maxBoards ?? 0) >= 5 ? 6 : 0;
  score += row.score < 50 ? 8 : row.score < 60 ? 3 : 0;
  return Math.min(100, score);
}

function riskTier(riskScore: number): DownsideRiskProfile["riskTier"] {
  if (riskScore >= 65) return "高风险";
  if (riskScore >= 35) return "中风险";
  return "低风险";
}

/**
 * 风险分仅读取候选信号日字段；买入后的收盘路径只用于事后标签和独立样本外评估。
 */
export function buildDownsideRiskResearch(
  rows: LeaderCandidateBacktestRow[],
  options: DownsideRiskOptions | undefined,
  realisticOptions: RealisticBacktestOptions | undefined,
  context: LeaderCandidateBacktestContext,
): DownsideRiskResearchResult {
  const observationDays = Math.min(10, Math.max(2, Math.floor(options?.observationDays ?? 5)));
  const mediumDownsidePercent = Math.min(50, Math.max(1, options?.mediumDownsidePercent ?? 4));
  const highDownsidePercent = Math.min(50, Math.max(mediumDownsidePercent, options?.highDownsidePercent ?? 8));
  const penaltyWeight = Math.min(1, Math.max(0, options?.penaltyWeight ?? 0.35));
  const hardRiskThreshold = Math.min(100, Math.max(0, options?.hardRiskThreshold ?? 65));
  const profiles = rows.map((row) => {
    const label = closeReturnLabel(row, context, observationDays);
    const riskScore = calculateRiskScore(row);
    return {
      row,
      riskScore,
      riskTier: riskTier(riskScore),
      ...label,
      mediumDownside: label.maxAdverseCloseReturn === null ? null : label.maxAdverseCloseReturn <= -mediumDownsidePercent,
      highDownside: label.maxAdverseCloseReturn === null ? null : label.maxAdverseCloseReturn <= -highDownsidePercent,
    } satisfies DownsideRiskProfile;
  });
  const labeledProfiles = profiles.filter((profile) => profile.maxAdverseCloseReturn !== null);
  const tiers: DownsideRiskProfile["riskTier"][] = ["低风险", "中风险", "高风险"];
  const riskTiers = tiers.map((tier) => {
    const tierProfiles = labeledProfiles.filter((profile) => profile.riskTier === tier);
    const returns = tierProfiles.map((profile) => profile.maxAdverseCloseReturn!);
    const mediumDownsideCount = tierProfiles.filter((profile) => profile.mediumDownside).length;
    const highDownsideCount = tierProfiles.filter((profile) => profile.highDownside).length;
    return {
      tier,
      sampleSize: tierProfiles.length,
      averageMaxAdverseCloseReturn: returns.length === 0 ? null : round(returns.reduce((sum, value) => sum + value, 0) / returns.length),
      mediumDownsideCount,
      mediumDownsideRate: ratio(mediumDownsideCount, tierProfiles.length),
      highDownsideCount,
      highDownsideRate: ratio(highDownsideCount, tierProfiles.length),
    };
  });
  const run = (key: DownsideRiskExperimentItem["key"], label: string, description: string, experimentRows: LeaderCandidateBacktestRow[], excludedCandidateCount: number): DownsideRiskExperimentItem => ({
    key,
    label,
    description,
    inputCandidateCount: experimentRows.length,
    excludedCandidateCount,
    realisticSimulation: simulateRealisticTPlus1ToTPlus2(experimentRows, realisticOptions, context.priceByStockDate, context.tradingDates),
  });
  const riskPenaltyRows = profiles.map((profile) => ({
    ...profile.row,
    score: Math.max(0, round(profile.row.score - profile.riskScore * penaltyWeight)),
  }));
  const hardFilterRows = profiles.filter((profile) => profile.riskScore < hardRiskThreshold).map((profile) => profile.row);

  return {
    definition: `风险分仅使用信号日可见的候选与情绪字段；下行标签为T+1开盘后连续${observationDays}个实际交易日内的最低可得收盘价相对T+1开盘价的最大不利收盘波动。分层与实验仅使用完整观察期样本。`,
    observationDays,
    mediumDownsidePercent,
    highDownsidePercent,
    penaltyWeight,
    hardRiskThreshold,
    featureMatrix: riskFeatures,
    labeledSampleSize: labeledProfiles.length,
    riskTiers,
    experiments: [
      run("baseline", "原始策略", "保留原始候选评分与全部样本外候选。", rows, 0),
      run("riskPenalty", "风险扣分策略", `候选分扣减 风险分 × ${penaltyWeight}，不删除候选。`, riskPenaltyRows, 0),
      run("hardFilter", "高风险硬过滤", `剔除风险分 ≥ ${hardRiskThreshold} 的候选。`, hardFilterRows, rows.length - hardFilterRows.length),
    ],
  };
}
