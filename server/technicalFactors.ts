import type { LeaderCandidateBacktestRow, LeaderCandidateDailyPrice } from "./leaderCandidates";
import { normalCdf } from "./overfittingGuard";

/**
 * 技术面因子库（第一版）：换手率、量比、振幅。
 * 全部因子严格 point-in-time——只读取信号日及之前的日线数据，不引用任何未来记录。
 * 数据来源：context.priceByStockDate（Tushare daily 聚合，含 open/high/low/close/amount/volume/preClose）
 *          与候选记录自带流通市值（亿元，字符串）。
 */

export type TechnicalFactorKey = "turnoverRate" | "volumeRatio" | "amplitude";

/** 候选/组合因子 key（连板高度、题材支撑、流通市值评分、原始候选分）。 */
export type CandidateFactorKey = "boards" | "sectorCount" | "marketCapScore" | "score";

/** 可参与 RankIC 有效性评估的统一因子 key（技术因子 + 候选因子）。 */
export type EvaluableFactorKey = TechnicalFactorKey | CandidateFactorKey;

export type EvaluableFactorDefinition = {
  key: EvaluableFactorKey;
  label: string;
  definition: string;
  unit: string;
};

export const TECHNICAL_FACTOR_DEFINITIONS: EvaluableFactorDefinition[] = [
  {
    key: "turnoverRate",
    label: "换手率",
    definition: "信号日成交额 / 流通市值（%），区分一字板（换手极低）与充分换手。",
    unit: "%",
  },
  {
    key: "volumeRatio",
    label: "量比",
    definition: "信号日成交额 / 前 5 个交易日成交额均值（倍率），衡量放量程度。",
    unit: "倍",
  },
  {
    key: "amplitude",
    label: "振幅",
    definition: "信号日（最高价 - 最低价）/ 前收盘价（%），衡量日内波动。",
    unit: "%",
  },
];

/** 候选/组合因子定义（纳入统一 RankIC 评估，实现与技术因子横向可比）。 */
export const CANDIDATE_FACTOR_DEFINITIONS: EvaluableFactorDefinition[] = [
  { key: "boards", label: "连板高度", definition: "信号日连续涨停板数。", unit: "板" },
  { key: "sectorCount", label: "题材支撑", definition: "信号日同题材涨停数量。", unit: "只" },
  { key: "marketCapScore", label: "流通市值评分", definition: "信号日可得流通市值分层评分。", unit: "分" },
  { key: "score", label: "原始候选分", definition: "龙头候选强度分（候选入选前的基础评分）。", unit: "分" },
];

/** 所有可评估因子（技术 + 候选）的定义合集。 */
export const ALL_EVALUABLE_FACTOR_DEFINITIONS: EvaluableFactorDefinition[] = [
  ...TECHNICAL_FACTOR_DEFINITIONS,
  ...CANDIDATE_FACTOR_DEFINITIONS,
];

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

function toFiniteNumber(value: string | number | null | undefined): number | null {
  const parsed = value === null || value === undefined ? null : Number(String(value).replace(/[亿元,%]/g, "").trim());
  return parsed !== null && Number.isFinite(parsed) ? parsed : null;
}

function parseCirculationValueYi(circulationValue: string | null | undefined): number | null {
  const parsed = toFiniteNumber(circulationValue);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function skewness(values: number[], meanValue: number, std: number): number | null {
  if (values.length < 3 || std <= 0) return null;
  return values.reduce((sum, value) => sum + ((value - meanValue) / std) ** 3, 0) / values.length;
}

function excessKurtosis(values: number[], meanValue: number, std: number): number | null {
  if (values.length < 4 || std <= 0) return null;
  return values.reduce((sum, value) => sum + ((value - meanValue) / std) ** 4, 0) / values.length - 3;
}

/**
 * Newey-West HAC 稳健 t 统计量：考虑 IC 序列的自相关，不假设每日 IC 独立。
 * Bartlett 核权重 w_l = 1 - l/(L+1)；默认滞后 L = floor(4·(n/100)^(2/9))。
 * 返回均值的 HAC 标准误与 t 统计量；样本 < 3 或标准误为 0 时返回 null。
 */
function neweyWestMeanTStat(series: number[], lag?: number): { tStat: number; se: number } | null {
  const n = series.length;
  if (n < 3) return null;
  const meanValue = series.reduce((sum, value) => sum + value, 0) / n;
  const errors = series.map((value) => value - meanValue);
  const maxLag = Math.max(1, Math.floor(4 * (n / 100) ** (2 / 9)));
  const L = lag ?? Math.min(n - 2, maxLag);
  const gamma = (l: number): number => {
    let sum = 0;
    for (let t = l; t < n; t += 1) sum += errors[t]! * errors[t - l]!;
    return sum / n;
  };
  let variance = gamma(0);
  for (let l = 1; l <= L; l += 1) {
    variance += 2 * (1 - l / (L + 1)) * gamma(l);
  }
  const se = Math.sqrt(Math.max(0, variance / n));
  if (se <= 0) return null;
  return { tStat: meanValue / se, se };
}

function sampleStd(values: number[]): number | null {
  if (values.length < 2) return null;
  const meanValue = mean(values);
  if (meanValue === null) return null;
  const variance = values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 因子-收益关系形态识别：基于五分组均值的启发式判定（供判断因子是否线性可用）。 */
function classifyQuintileShape(averages: number[]): FactorQuintileShape {
  const n = averages.length;
  const increasing = averages.every((value, index) => index === 0 || value >= averages[index - 1]!);
  const decreasing = averages.every((value, index) => index === 0 || value <= averages[index - 1]!);
  if (increasing) return "monotonic_increasing";
  if (decreasing) return "monotonic_decreasing";

  let maxIdx = 0;
  let minIdx = 0;
  for (let i = 1; i < n; i += 1) {
    if (averages[i]! > averages[maxIdx]!) maxIdx = i;
    if (averages[i]! < averages[minIdx]!) minIdx = i;
  }
  const maxIsMiddle = maxIdx >= 1 && maxIdx <= n - 2;
  const minIsMiddle = minIdx >= 1 && minIdx <= n - 2;
  const maxIsEnd = maxIdx === 0 || maxIdx === n - 1;
  const minIsEnd = minIdx === 0 || minIdx === n - 1;
  const range = averages[maxIdx]! - averages[minIdx]!;

  // 倒U：最高在中间、最低在两端；U：最低在中间、最高在两端。
  if (maxIsMiddle && minIsEnd && range > 1e-9) return "inverted_u";
  if (minIsMiddle && maxIsEnd && range > 1e-9) return "u_shape";

  // 阈值型：存在显著相邻跳变，且跳变后段与跳变前段整体分离。
  let jumpIdx = -1;
  let maxJump = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const jump = Math.abs(averages[i + 1]! - averages[i]!);
    if (jump > maxJump) { maxJump = jump; jumpIdx = i; }
  }
  if (range > 1e-9 && maxJump >= range * 0.4) {
    const before = averages.slice(0, jumpIdx + 1);
    const after = averages.slice(jumpIdx + 1);
    if (Math.min(...after) > Math.max(...before) || Math.min(...before) > Math.max(...after)) return "threshold";
  }

  // 剩余：最高在中间 → 中间有效（弱倒U）；最高在两端 → 两端有效（弱 U）。
  if (maxIsMiddle) return "inverted_u";
  if (maxIsEnd) return "u_shape";
  return "none";
}

/**
 * 计算单个候选在信号日的技术面因子值。
 * - turnoverRate：amount（千元）×1000 / (流通市值亿元 × 1e8) × 100，即成交额/流通市值（%）。
 * - volumeRatio：信号日 amount / 前 5 个交易日 amount 均值（仅取信号日之前的日期，保证 point-in-time）。
 * - amplitude：(high - low) / preClose × 100。
 */
export function computeTechnicalFactorValues(
  stockCode: string,
  signalDate: string,
  circulationValue: string | null,
  signalPrice: LeaderCandidateDailyPrice | undefined,
  context: { priceByStockDate?: Map<string, LeaderCandidateDailyPrice>; tradingDates?: string[] },
): Record<TechnicalFactorKey, number | null> {
  const amount = signalPrice?.amount ?? null;
  const circulationYi = parseCirculationValueYi(circulationValue);

  let turnoverRate: number | null = null;
  if (amount !== null && amount > 0 && circulationYi !== null) {
    turnoverRate = round((amount / (circulationYi * 1e5)) * 100, 4);
  }

  let volumeRatio: number | null = null;
  const tradingDates = context.tradingDates ?? [];
  if (amount !== null && amount > 0 && tradingDates.length > 0) {
    const signalIndex = tradingDates.indexOf(signalDate);
    if (signalIndex > 0) {
      const lookbackDates = tradingDates.slice(Math.max(0, signalIndex - 5), signalIndex);
      const lookbackAmounts = lookbackDates
        .map((date) => context.priceByStockDate?.get(`${stockCode}::${date}`)?.amount ?? null)
        .filter((value): value is number => value !== null && value > 0);
      const averageAmount = mean(lookbackAmounts);
      if (averageAmount !== null && averageAmount > 0) {
        volumeRatio = round(amount / averageAmount, 4);
      }
    }
  }

  const high = signalPrice?.highPrice ?? null;
  const low = signalPrice?.lowPrice ?? null;
  const preClose = signalPrice?.preClosePrice ?? null;

  let amplitude: number | null = null;
  if (high !== null && low !== null && preClose !== null && high > 0 && low > 0 && preClose > 0) {
    amplitude = round(((high - low) / preClose) * 100, 4);
  }

  return { turnoverRate, volumeRatio, amplitude };
}

// ---------------------------------------------------------------------------
// 因子有效性三件套评估：RankIC + IC_IR、分位数分层单调性、IC 时间序列稳定性（按情绪阶段分组）。
// ---------------------------------------------------------------------------

export type FactorForwardReturnField = "nextClosePremium" | "nextOpenPremium" | "secondDayClosePremium" | "tPlus1CloseToTPlus2CloseReturn";

/** 因子预测能力分级：基于 |ICIR|（与方向无关）。 */
export type FactorICStrength = "none" | "weak" | "moderate" | "strong";

export type FactorRankICResult = {
  factorKey: EvaluableFactorKey;
  label: string;
  forwardReturnField: FactorForwardReturnField;
  sampleSize: number;
  dailyIcCount: number;
  meanIc: number | null;
  medianIc: number | null;
  icStd: number | null;
  icIr: number | null;
  /** 因子方向（由 meanIc 符号判定）：positive 为正相关，negative 为负相关。 */
  direction: "positive" | "negative" | null;
  /** 朴素 IC t 统计量：meanIc / (icStd / √n)，假设每日 IC 独立同分布。 */
  icTStat: number | null;
  /** Newey-West HAC 稳健 t 统计量：考虑 IC 序列自相关。 */
  icHacTStat: number | null;
  /** 双尾 p 值（基于 HAC t 统计量的正态近似）。 */
  pValue: number | null;
  /** IC 序列偏度（population moment）。 */
  icSkewness: number | null;
  /** IC 序列峰度（excess kurtosis）。 */
  icKurtosis: number | null;
  positiveIcRatio: number | null;
  /** 预测能力分级：|ICIR| <0.1 无明显 / <0.2 弱 / <0.3 一般 / ≥0.3 较强。 */
  strength: FactorICStrength | null;
  effective: boolean | null;
};

export type FactorQuintileBucket = {
  quintile: 1 | 2 | 3 | 4 | 5;
  sampleSize: number;
  averageForwardReturn: number | null;
  medianForwardReturn: number | null;
  positiveReturnRate: number | null;
  /** 组内收益均值/标准差（横截面标准化收益，非年化）；样本 < 2 或标准差为 0 时为 null。 */
  sharpe: number | null;
};

/** 因子-收益关系形态（基于五分组均值的启发式判定，供判断因子是否线性可用）。 */
export type FactorQuintileShape =
  | "monotonic_increasing"
  | "monotonic_decreasing"
  | "inverted_u"
  | "u_shape"
  | "threshold"
  | "none";

export type FactorQuintileResult = {
  factorKey: EvaluableFactorKey;
  label: string;
  forwardReturnField: FactorForwardReturnField;
  sampleSize: number;
  buckets: FactorQuintileBucket[];
  monotonic: boolean | null;
  monotonicDirection: "increasing" | "decreasing" | "none" | null;
  /** 因子-收益关系形态（8 类中「中间有效/两端有效」已并入 inverted_u / u_shape）。 */
  shape: FactorQuintileShape | null;
  /** Q5 均值 − Q1 均值（即多空收益差 long-short spread）。 */
  spread: number | null;
};

export type FactorPhaseIC = {
  phase: string;
  sampleSize: number;
  dailyIcCount: number;
  meanIc: number | null;
  icIr: number | null;
  /** 阶段内 IC 序列的 Newey-West HAC 稳健 t 统计量（样本不足时为 null）。 */
  icTStat: number | null;
  /** 阶段内 IC > 0 的日截面占比（胜率）。 */
  positiveIcRatio: number | null;
};

export type FactorPhaseStabilityResult = {
  factorKey: EvaluableFactorKey;
  label: string;
  forwardReturnField: FactorForwardReturnField;
  phases: FactorPhaseIC[];
  directionConsistent: boolean | null;
};

/** 按日历切片（年度 / 季度）的因子 IC，用于判断因子是否只在特定时间段有效。 */
export type FactorTimeSplitIC = {
  bucket: string;
  sampleSize: number;
  dailyIcCount: number;
  meanIc: number | null;
  icIr: number | null;
};

export type FactorTimeSplitResult = {
  factorKey: EvaluableFactorKey;
  label: string;
  granularity: "year" | "quarter";
  buckets: FactorTimeSplitIC[];
};

/** 因子预测能力衰减曲线上的单个持有期节点。 */
export type FactorDecayPoint = {
  /** 持有期标签（如 T+1开盘 / T+1收盘 / T+1→T+2 / T+2收盘）。 */
  horizon: string;
  forwardReturnField: FactorForwardReturnField;
  sampleSize: number;
  dailyIcCount: number;
  meanIc: number | null;
  icIr: number | null;
};

export type FactorDecayResult = {
  factorKey: EvaluableFactorKey;
  label: string;
  points: FactorDecayPoint[];
};

export type FactorEffectivenessReport = {
  forwardReturnField: FactorForwardReturnField;
  definition: string;
  rankIc: FactorRankICResult[];
  quintiles: FactorQuintileResult[];
  phaseStability: FactorPhaseStabilityResult[];
  /** 年度 IC（按自然年切片）。 */
  yearlyIc: FactorTimeSplitResult[];
  /** 季度 IC（按自然季度切片）。 */
  quarterlyIc: FactorTimeSplitResult[];
  /** 预测能力衰减曲线（覆盖数据模型已预计算的前向收益字段，1~2 日持有期）。 */
  icDecay: FactorDecayResult[];
};

function rankValues(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < indexed.length; i += 1) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.value === indexed[i]!.value) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k]!.index] = averageRank;
    i = j;
  }
  return ranks;
}

/** Spearman 秩相关；样本量 < 3 或任一变差为 0 时返回 null。 */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length < 3) return null;
  const rx = rankValues(x);
  const ry = rankValues(y);
  const meanX = mean(rx);
  const meanY = mean(ry);
  if (meanX === null || meanY === null) return null;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < rx.length; i += 1) {
    numerator += (rx[i]! - meanX) * (ry[i]! - meanY);
    denomX += (rx[i]! - meanX) ** 2;
    denomY += (ry[i]! - meanY) ** 2;
  }
  if (denomX === 0 || denomY === 0) return null;
  return numerator / Math.sqrt(denomX * denomY);
}

function readForwardReturn(row: LeaderCandidateBacktestRow, field: FactorForwardReturnField): number | null {
  const value = row[field];
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/** 由「因子-前向收益」配对计算逐日截面 IC 序列（每日截面样本 < 3 或变差为 0 时跳过该日）。 */
function computeDailyIcs(pairs: Array<{ date: string; factor: number; forward: number }>): number[] {
  const byDate = new Map<string, Array<{ factor: number; forward: number }>>();
  for (const pair of pairs) {
    const bucket = byDate.get(pair.date) ?? [];
    bucket.push(pair);
    byDate.set(pair.date, bucket);
  }
  const dailyIcs: number[] = [];
  for (const bucket of Array.from(byDate.values())) {
    if (bucket.length < 3) continue;
    const ic = spearman(bucket.map((item) => item.factor), bucket.map((item) => item.forward));
    if (ic !== null) dailyIcs.push(ic);
  }
  return dailyIcs;
}

/** 由 IC 序列汇总均值/标准差/IR/方向/HAC t/p 值/偏度/峰度等统计量。 */
function summarizeIcSeries(dailyIcs: number[]): {
  meanIc: number | null;
  icStd: number | null;
  icIr: number | null;
  direction: "positive" | "negative" | null;
  icTStat: number | null;
  icHacTStat: number | null;
  pValue: number | null;
  icSkewness: number | null;
  icKurtosis: number | null;
  positiveIcRatio: number | null;
} {
  const meanIc = mean(dailyIcs);
  const icStd = dailyIcs.length >= 2
    ? Math.sqrt(dailyIcs.reduce((sum, value) => sum + (value - meanIc!) ** 2, 0) / (dailyIcs.length - 1))
    : null;
  const icIr = meanIc !== null && icStd !== null && icStd > 0 ? meanIc / icStd : null;
  const direction = meanIc === null || meanIc === 0 ? null : meanIc > 0 ? "positive" : "negative";
  const icTStat = meanIc !== null && icStd !== null && icStd > 0 && dailyIcs.length >= 2
    ? meanIc / (icStd / Math.sqrt(dailyIcs.length))
    : null;
  const hac = neweyWestMeanTStat(dailyIcs);
  const icHacTStat = hac?.tStat ?? null;
  const pValue = icHacTStat !== null ? 2 * (1 - normalCdf(Math.abs(icHacTStat))) : null;
  const icSkewness = meanIc !== null && icStd !== null && icStd > 0 ? skewness(dailyIcs, meanIc, icStd) : null;
  const icKurtosis = meanIc !== null && icStd !== null && icStd > 0 ? excessKurtosis(dailyIcs, meanIc, icStd) : null;
  const positiveIcRatio = dailyIcs.length === 0 ? null : dailyIcs.filter((value) => value > 0).length / dailyIcs.length;
  return { meanIc, icStd, icIr, direction, icTStat, icHacTStat, pValue, icSkewness, icKurtosis, positiveIcRatio };
}

/** 统一读取技术因子与候选因子的值（技术因子来自 technicalFactors，候选因子来自行原始字段）。 */
function readEvaluableFactorValue(row: LeaderCandidateBacktestRow, key: EvaluableFactorKey): number | null {
  switch (key) {
    case "turnoverRate":
    case "volumeRatio":
    case "amplitude":
      return row.technicalFactors?.[key] ?? null;
    case "boards":
      return row.boards;
    case "sectorCount":
      return row.sectorCount ?? null;
    case "marketCapScore":
      return row.marketCapScore;
    case "score":
      return row.score;
    default:
      return null;
  }
}

function collectPairs(rows: LeaderCandidateBacktestRow[], factorKey: EvaluableFactorKey, field: FactorForwardReturnField) {
  const pairs: Array<{ date: string; factor: number; forward: number; phase: string | null }> = [];
  for (const row of rows) {
    const factor = readEvaluableFactorValue(row, factorKey);
    const forward = readForwardReturn(row, field);
    if (factor === null || forward === null || !Number.isFinite(factor)) continue;
    pairs.push({ date: row.date, factor, forward, phase: row.phase });
  }
  return pairs;
}

function buildRankIc(
  factorKey: EvaluableFactorKey,
  label: string,
  field: FactorForwardReturnField,
  pairs: Array<{ date: string; factor: number; forward: number }>,
): FactorRankICResult {
  const dailyIcs = computeDailyIcs(pairs);
  const summary = summarizeIcSeries(dailyIcs);
  const { meanIc, icStd, icIr, direction, icTStat, icHacTStat, pValue, icSkewness, icKurtosis, positiveIcRatio } = summary;
  const medianIc = median(dailyIcs);
  const absIr = icIr === null ? null : Math.abs(icIr);
  const strength = absIr === null ? null : absIr >= 0.3 ? "strong" : absIr >= 0.2 ? "moderate" : absIr >= 0.1 ? "weak" : "none";
  return {
    factorKey,
    label,
    forwardReturnField: field,
    sampleSize: pairs.length,
    dailyIcCount: dailyIcs.length,
    meanIc: meanIc === null ? null : round(meanIc, 4),
    medianIc: medianIc === null ? null : round(medianIc, 4),
    icStd: icStd === null ? null : round(icStd, 4),
    icIr: icIr === null ? null : round(icIr, 4),
    direction,
    icTStat: icTStat === null ? null : round(icTStat, 3),
    icHacTStat: icHacTStat === null ? null : round(icHacTStat, 3),
    pValue: pValue === null ? null : round(pValue, 4),
    icSkewness: icSkewness === null ? null : round(icSkewness, 4),
    icKurtosis: icKurtosis === null ? null : round(icKurtosis, 4),
    positiveIcRatio: positiveIcRatio === null ? null : round(positiveIcRatio, 4),
    strength,
    effective: absIr === null ? null : absIr > 0.3,
  };
}

function buildQuintiles(
  factorKey: EvaluableFactorKey,
  label: string,
  field: FactorForwardReturnField,
  pairs: Array<{ factor: number; forward: number }>,
): FactorQuintileResult {
  if (pairs.length < 5) {
    return { factorKey, label, forwardReturnField: field, sampleSize: pairs.length, buckets: [], monotonic: null, monotonicDirection: null, shape: null, spread: null };
  }
  const sorted = pairs.slice().sort((left, right) => left.factor - right.factor);
  const buckets: FactorQuintileBucket[] = [];
  for (let q = 0; q < 5; q += 1) {
    const start = Math.floor((q * sorted.length) / 5);
    const end = Math.floor(((q + 1) * sorted.length) / 5);
    const slice = sorted.slice(start, end);
    const forwardReturns = slice.map((item) => item.forward);
    const averageForward = mean(forwardReturns);
    const medianForward = median(forwardReturns);
    const std = sampleStd(forwardReturns);
    const positiveRate = forwardReturns.length === 0 ? null : forwardReturns.filter((value) => value > 0).length / forwardReturns.length;
    const sharpe = averageForward !== null && std !== null && std > 0 ? averageForward / std : null;
    buckets.push({
      quintile: (q + 1) as 1 | 2 | 3 | 4 | 5,
      sampleSize: slice.length,
      averageForwardReturn: averageForward === null ? null : round(averageForward, 4),
      medianForwardReturn: medianForward === null ? null : round(medianForward, 4),
      positiveReturnRate: positiveRate === null ? null : round(positiveRate, 4),
      sharpe: sharpe === null ? null : round(sharpe, 4),
    });
  }
  const averages = buckets.map((bucket) => bucket.averageForwardReturn).filter((value): value is number => value !== null);
  let monotonic = false;
  let monotonicDirection: FactorQuintileResult["monotonicDirection"] = "none";
  let shape: FactorQuintileShape | null = null;
  let spread: number | null = null;
  if (averages.length === 5) {
    const increasing = averages.every((value, index) => index === 0 || value >= averages[index - 1]!);
    const decreasing = averages.every((value, index) => index === 0 || value <= averages[index - 1]!);
    monotonic = increasing || decreasing;
    monotonicDirection = increasing ? "increasing" : decreasing ? "decreasing" : "none";
    shape = classifyQuintileShape(averages);
    spread = round(averages[4]! - averages[0]!, 4);
  }
  return { factorKey, label, forwardReturnField: field, sampleSize: pairs.length, buckets, monotonic, monotonicDirection, shape, spread };
}

function buildPhaseStability(
  factorKey: EvaluableFactorKey,
  label: string,
  field: FactorForwardReturnField,
  pairs: Array<{ date: string; factor: number; forward: number; phase: string | null }>,
): FactorPhaseStabilityResult {
  const byPhase = new Map<string, Array<{ date: string; factor: number; forward: number }>>();
  for (const pair of pairs) {
    const phase = pair.phase ?? "未标注周期";
    const bucket = byPhase.get(phase) ?? [];
    bucket.push(pair);
    byPhase.set(phase, bucket);
  }
  const phases: FactorPhaseIC[] = [];
  for (const [phase, bucket] of Array.from(byPhase.entries())) {
    const dailyIcs = computeDailyIcs(bucket);
    const summary = summarizeIcSeries(dailyIcs);
    phases.push({
      phase,
      sampleSize: bucket.length,
      dailyIcCount: dailyIcs.length,
      meanIc: summary.meanIc === null ? null : round(summary.meanIc, 4),
      icIr: summary.icIr === null ? null : round(summary.icIr, 4),
      icTStat: summary.icHacTStat === null ? null : round(summary.icHacTStat, 3),
      positiveIcRatio: summary.positiveIcRatio === null ? null : round(summary.positiveIcRatio, 4),
    });
  }
  phases.sort((left, right) => left.phase.localeCompare(right.phase));
  const validIcs = phases.map((phase) => phase.meanIc).filter((value): value is number => value !== null);
  const directionConsistent = validIcs.length < 2 ? null : (validIcs.every((value) => value > 0) || validIcs.every((value) => value < 0));
  return { factorKey, label, forwardReturnField: field, phases, directionConsistent };
}

/** 按自然年/季度切片计算因子 IC（逐日截面 → 切片内 IC 序列汇总）。 */
function buildTimeSplitIc(
  factorKey: EvaluableFactorKey,
  label: string,
  field: FactorForwardReturnField,
  granularity: "year" | "quarter",
  pairs: Array<{ date: string; factor: number; forward: number }>,
): FactorTimeSplitResult {
  const byBucket = new Map<string, Array<{ date: string; factor: number; forward: number }>>();
  for (const pair of pairs) {
    const match = pair.date.match(/^(\d{4})-(\d{2})/);
    if (!match) continue;
    const year = match[1]!;
    const bucket = granularity === "year" ? year : `${year}Q${Math.floor((Number(match[2]!) - 1) / 3) + 1}`;
    const list = byBucket.get(bucket) ?? [];
    list.push(pair);
    byBucket.set(bucket, list);
  }
  const buckets: FactorTimeSplitIC[] = [];
  for (const [bucket, list] of Array.from(byBucket.entries())) {
    const dailyIcs = computeDailyIcs(list);
    const summary = summarizeIcSeries(dailyIcs);
    buckets.push({
      bucket,
      sampleSize: list.length,
      dailyIcCount: dailyIcs.length,
      meanIc: summary.meanIc === null ? null : round(summary.meanIc, 4),
      icIr: summary.icIr === null ? null : round(summary.icIr, 4),
    });
  }
  buckets.sort((left, right) => left.bucket.localeCompare(right.bucket));
  return { factorKey, label, granularity, buckets };
}

/** 预测能力衰减：覆盖数据模型已预计算的四个前向收益字段（按持有期升序）。 */
const DECAY_HORIZONS: Array<{ field: FactorForwardReturnField; horizon: string }> = [
  { field: "nextOpenPremium", horizon: "T+1开盘" },
  { field: "nextClosePremium", horizon: "T+1收盘" },
  { field: "tPlus1CloseToTPlus2CloseReturn", horizon: "T+1→T+2" },
  { field: "secondDayClosePremium", horizon: "T+2收盘" },
];

function buildIcDecay(rows: LeaderCandidateBacktestRow[], factorKey: EvaluableFactorKey, label: string): FactorDecayResult {
  const points: FactorDecayPoint[] = [];
  for (const { field, horizon } of DECAY_HORIZONS) {
    const pairs = collectPairs(rows, factorKey, field);
    const dailyIcs = computeDailyIcs(pairs);
    const summary = summarizeIcSeries(dailyIcs);
    points.push({
      horizon,
      forwardReturnField: field,
      sampleSize: pairs.length,
      dailyIcCount: dailyIcs.length,
      meanIc: summary.meanIc === null ? null : round(summary.meanIc, 4),
      icIr: summary.icIr === null ? null : round(summary.icIr, 4),
    });
  }
  return { factorKey, label, points };
}

/**
 * 因子有效性三件套评估（统一口径）：同时覆盖技术因子与候选因子，实现横向可比。
 * 输入为历史回测行（技术因子需已填充 technicalFactors，候选因子取自行原始字段），
 * forwardReturnField 指定预测目标（默认 T+1 收盘溢价）。
 * 阈值约定：|IC_IR| > 0.3 视为有效；|IC_IR| < 0.1 建议淘汰。
 */
export function evaluateFactorEffectiveness(
  rows: LeaderCandidateBacktestRow[],
  forwardReturnField: FactorForwardReturnField = "nextClosePremium",
): FactorEffectivenessReport {
  const rankIc: FactorRankICResult[] = [];
  const quintiles: FactorQuintileResult[] = [];
  const phaseStability: FactorPhaseStabilityResult[] = [];
  const yearlyIc: FactorTimeSplitResult[] = [];
  const quarterlyIc: FactorTimeSplitResult[] = [];
  const icDecay: FactorDecayResult[] = [];

  for (const definition of ALL_EVALUABLE_FACTOR_DEFINITIONS) {
    const pairs = collectPairs(rows, definition.key, forwardReturnField);
    rankIc.push(buildRankIc(definition.key, definition.label, forwardReturnField, pairs));
    quintiles.push(buildQuintiles(definition.key, definition.label, forwardReturnField, pairs));
    phaseStability.push(buildPhaseStability(definition.key, definition.label, forwardReturnField, pairs));
    yearlyIc.push(buildTimeSplitIc(definition.key, definition.label, forwardReturnField, "year", pairs));
    quarterlyIc.push(buildTimeSplitIc(definition.key, definition.label, forwardReturnField, "quarter", pairs));
    icDecay.push(buildIcDecay(rows, definition.key, definition.label));
  }

  return {
    forwardReturnField,
    definition: `因子有效性评估（统一口径，统计严谨版）：覆盖技术因子与候选因子，逐日截面 Spearman 秩相关得 IC 序列，输出均值/中位数 IC、ICIR、方向、朴素与 Newey-West HAC 稳健 t 统计量、双尾 p 值、偏度/峰度、IC>0 占比，并按 |ICIR| 分级（<0.1 无明显 / <0.2 弱 / <0.3 一般 / ≥0.3 较强）。方向与有效性分开判定：负向稳定预测同样视为有效。附情绪阶段/年度/季度切片稳定性与 1~2 日持有期预测衰减。预测目标为${forwardReturnField}。`,
    rankIc,
    quintiles,
    phaseStability,
    yearlyIc,
    quarterlyIc,
    icDecay,
  };
}
