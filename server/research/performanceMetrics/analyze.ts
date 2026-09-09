/**
 * STEP 16 / C-16.1 — 策略评价·收益/风险/回撤指标：确定性评估核心（纯函数）。
 *
 * 背景与边界：
 *   - C-14.1 simulator 产出 TradeSimulationRun（equityCurve: 逐收盘权益点，每点一个
 *     交易日，equity = 现金 + 持仓按当日收盘价 mark-to-market，含浮动盈亏；
 *     trades: 完整交易生命周期）。C-16.1 是「研究链路评价专用」评估器，消费该记录流。
 *   - 统计数学原语尽量复用 shared/quant-stats（mean / sampleStandardDeviation /
 *     skewness / excessKurtosis / percentile / annualizedReturnFromEquityCurve），
 *     不重新实现；回撤分段（含起止/恢复/时长）在 STEP 8 仅剩深度一个标量，
 *     本层实现完整分段分析并在文件头文档化差异。
 *
 * 口径核对（STEP 8 backtest/metrics vs 本任务）：
 *   1. CAGR 与 STEP 8 annualizedReturnPct —— 两者公式相同（shared
 *      annualizedReturnFromEquityCurve：(end/start)^(252/n)−1，n = 收益区间数 =
 *      权益点数 − 1，即交易日间隔数）。差异仅在锚点：STEP 8 用 initialCapital，
 *      本任务用 equityCurve[0].equity。C-14.1 输出首点 equity == initialCapital，
 *      故重合；不重合时差异即「存入资金视角」vs「曲线视角」，已文档化。
 *   2. MaxDD 深度 —— 与 STEP 8 maxDrawdownFromEquity 同口径（running peak 全程
 *      扫描），本任务进一步给出峰/谷/恢复点日期与峰→谷、峰→恢复的交易日/自然日时长。
 *   3. Tail risk —— STEP 8 未覆盖：下行偏差（downside deviation，Sortino 分母，
 *      C-16.2 将消费）、最差连续亏损段、单日最差收益、收益分布 1%/5% 历史分位、
 *      偏度/超额峰度（后两者复用 shared，纯历史描述、不预测）。
 *
 * 口径约定（全文件统一）：
 *   - 日收益 r_i = equity_i / equity_{i−1} − 1（小数），i = 1..点数−1；
 *     收益率区间数 intervals = 点数 − 1，作为 CAGR/年化的交易日数 n。
 *   - 本评估器假定 equityCurve 为「逐交易日」序列（C-14.1 契约保证）。若调用方
 *     传入稀疏/跨日缺口曲线，年化口径将失真——调用方必须保证每点一个交易日。
 *   - 所有日期均为 YYYY-MM-DD 字符串；自然日差用纯函数儒略日转换（无 Date 对象、
 *     无时区、无 Date.now），保证确定性。
 *
 * 退化输入策略（响亮失败，绝不静默 NaN）：
 *   - equityCurve 为空或 < 2 点 → 抛 PerformanceEvaluationError（年化/回撤/收益
 *     分布均需至少一个收益率区间）。
 *   - equity 值非有限或 <= 0 → 抛错（对数/比率/收益率在非正权益上无定义；负权益
 *     意味着杠杆爆仓等超出口径场景，禁止静默丢弃区间后错误年化）。
 *   - 日期非升序 / 重复 / 非法格式 → 抛错（回撤时长与恢复语义依赖严格升序）。
 */

import {
  annualizedReturnFromEquityCurve,
  excessKurtosis,
  percentile,
  sampleStandardDeviation,
  skewness,
} from "../../../shared/quant-stats";
import type { EquityPoint } from "../../backtest/types";
import type {
  DrawdownMetrics,
  DrawdownSegment,
  PerformanceEvaluationInput,
  PerformanceMetrics,
  ReturnMetrics,
  RiskMetrics,
  WorstLosingStreak,
} from "./types";

// ---------------------------------------------------------------------------
// 结构化错误
// ---------------------------------------------------------------------------

/** C-16.1 评估错误（code 稳定，供程序化处理）。 */
export class PerformanceEvaluationError extends Error {
  /** 稳定错误码（非自由文本）。 */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PerformanceEvaluationError";
    this.code = code;
  }
}

/** 退化/非法 equityCurve 输入。 */
export class InvalidEquityCurveError extends PerformanceEvaluationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "InvalidEquityCurveError";
  }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验 YYYY-MM-DD 字符串形态与基本日历范围（确定性，无 Date 对象）。 */
function assertValidIsoDate(value: string, label: string): void {
  if (!ISO_DATE_RE.test(value)) {
    throw new InvalidEquityCurveError(
      "INVALID_DATE",
      `performanceMetrics: ${label}（${value}）不是合法 YYYY-MM-DD`
    );
  }
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new InvalidEquityCurveError(
      "INVALID_DATE",
      `performanceMetrics: ${label}（${value}）超出基本日历范围`
    );
  }
}

/**
 * 校验 equityCurve（空/单点/非有限权益/非正权益/日期乱序一律响亮抛错）。
 * 通过后保证：点数 >= 2、每点 equity 有限且 > 0、日期严格升序。
 */
export function assertValidEquityCurve(equityCurve: readonly EquityPoint[]): void {
  if (equityCurve.length < 2) {
    throw new InvalidEquityCurveError(
      "INSUFFICIENT_EQUITY_CURVE",
      `performanceMetrics: equityCurve 点数 ${equityCurve.length}，至少需要 2 点` +
        `（CAGR/回撤/收益分布均需 >= 1 个收益率区间；单日模拟无法年化，请在上游跳过评估）`
    );
  }
  for (let i = 0; i < equityCurve.length; i += 1) {
    const point = equityCurve[i]!;
    assertValidIsoDate(point.date, `equityCurve[${i}].date`);
    const equity = point.equity;
    if (!Number.isFinite(equity)) {
      throw new InvalidEquityCurveError(
        "INVALID_EQUITY_VALUE",
        `performanceMetrics: equityCurve[${i}].date=${point.date} 的 equity 非有限（${String(equity)}）`
      );
    }
    if (equity <= 0) {
      throw new InvalidEquityCurveError(
        "INVALID_EQUITY_VALUE",
        `performanceMetrics: equityCurve[${i}].date=${point.date} 的 equity<=0（${equity}），` +
          `非正权益使收益率/年化/回撤比率无定义`
      );
    }
    if (i > 0 && point.date <= equityCurve[i - 1]!.date) {
      throw new InvalidEquityCurveError(
        "EQUITY_CURVE_UNSORTED",
        `performanceMetrics: equityCurve 日期非严格升序（${equityCurve[i - 1]!.date} -> ${point.date}），` +
          `回撤恢复/时长语义要求严格升序`
      );
    }
  }
}

/** 校验口径参数（响亮抛错，不静默回退）。 */
function assertValidParameters(input: PerformanceEvaluationInput): void {
  const { annualizationFactor, drawdownThresholdPct, downsideTarget } = input;
  if (
    annualizationFactor !== undefined &&
    (!Number.isFinite(annualizationFactor) || annualizationFactor <= 0)
  ) {
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `performanceMetrics: annualizationFactor=${String(annualizationFactor)} 必须为正有限数`
    );
  }
  if (
    drawdownThresholdPct !== undefined &&
    (!Number.isFinite(drawdownThresholdPct) || drawdownThresholdPct < 0)
  ) {
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `performanceMetrics: drawdownThresholdPct=${String(drawdownThresholdPct)} 必须为 >= 0 的有限数`
    );
  }
  if (downsideTarget !== undefined && !Number.isFinite(downsideTarget)) {
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `performanceMetrics: downsideTarget=${String(downsideTarget)} 必须为有限数`
    );
  }
}

// ---------------------------------------------------------------------------
// 纯函数日数工具（儒略日转换，无 Date 对象，确定性）
// ---------------------------------------------------------------------------

/**
 * 公历日期 → 儒略日序号（proleptic Gregorian，Howard Hinnant 算法）。
 * 输入必须是已通过 assertValidIsoDate 的整数年月日。
 */
function ordinalFromYmd(year: number, month: number, day: number): number {
  const m = (month + 9) % 12;
  const y = year - Math.floor(m / 10);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = Math.floor((153 * m + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe;
}

/** YYYY-MM-DD → 儒略日序号（调用前须已校验格式）。 */
function isoDateToOrdinal(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return ordinalFromYmd(year, month, day);
}

/** 自然日差（天）：after − before，要求 after 不早于 before。 */
function calendarDaysBetween(before: string, after: string): number {
  return isoDateToOrdinal(after) - isoDateToOrdinal(before);
}

// ---------------------------------------------------------------------------
// 日收益序列
// ---------------------------------------------------------------------------

/**
 * 由权益值序列计算日收益（小数）：r_i = eq_i / eq_{i−1} − 1。
 * 调用前必须已通过 assertValidEquityCurve（每点 equity > 0，保证每个区间可除）。
 * 返回值长度 = 点数 − 1；返回数组第 i 个元素对应 equityCurve[i+1].date 上实现的收益。
 */
export function dailyReturnSeries(equities: readonly number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equities.length; i += 1) {
    returns.push(equities[i]! / equities[i - 1]! - 1);
  }
  return returns;
}

// ---------------------------------------------------------------------------
// 回撤分段分析
// ---------------------------------------------------------------------------

/**
 * 回撤分段分析（running-peak）：把曲线切成「峰 → 跌破 → 谷 → 恢复到原峰」的
 * 完整回撤段序列。
 *
 * 段划分规则（确定性，与 STEP 8 maxDrawdownFromEquity 深度口径一致）：
 *   - 运行峰从首点开始；当某点 equity < 运行峰时进入「水下」，开启一段（峰值锁定
 *     为该运行峰）；水下期间谷底取区间最小值；
 *   - 当某点 equity >= 段峰值时视为恢复，段在该点闭合（recoveryIndex = 该点），
 *     同时该点成为新的运行峰；
 *   - 曲线结束仍在水下 → 开放段（recoveryIndex / recoveryDate = null），
 *     stillActive 语义以 recovery 是否为空表达；
 *   - 每个点 equity 严格低于运行峰才计入回撤；equity 回到峰值即恢复（新高按 >= 峰值计）。
 *
 * @returns allSegments 按发生顺序；maxDrawdownPct = 最大段深度（无回撤为 0）；
 *          maxDrawdownSegment = 最深段（深度并列取 peakIndex 更早者；无回撤为 null）。
 */
export function analyzeDrawdown(
  equityCurve: readonly EquityPoint[]
): {
  readonly maxDrawdownPct: number;
  readonly maxDrawdownSegment: DrawdownSegment | null;
  readonly allSegments: readonly DrawdownSegment[];
} {
  const dates = equityCurve.map((point) => point.date);
  const equities = equityCurve.map((point) => point.equity);
  const segments: DrawdownSegment[] = [];

  let runningPeakIndex = 0;
  let runningPeakEquity = equities[0]!;
  // 进行中的水下段（null = 不在水下）。
  let open: { peakIndex: number; peakEquity: number; troughIndex: number; troughEquity: number } | null = null;

  const pushClosed = (segment: {
    peakIndex: number;
    peakEquity: number;
    troughIndex: number;
    troughEquity: number;
    recoveryIndex: number;
  }): void => {
    const peakDate = dates[segment.peakIndex]!;
    const troughDate = dates[segment.troughIndex]!;
    const recoveryDate = dates[segment.recoveryIndex]!;
    const peakToTroughDays = segment.troughIndex - segment.peakIndex;
    const peakToRecoveryDays = segment.recoveryIndex - segment.peakIndex;
    segments.push({
      peakIndex: segment.peakIndex,
      troughIndex: segment.troughIndex,
      recoveryIndex: segment.recoveryIndex,
      peakDate,
      troughDate,
      recoveryDate,
      peakEquity: segment.peakEquity,
      troughEquity: segment.troughEquity,
      depthPct: ((segment.peakEquity - segment.troughEquity) / segment.peakEquity) * 100,
      tradingDaysToTrough: peakToTroughDays,
      calendarDaysToTrough: calendarDaysBetween(peakDate, troughDate),
      tradingDaysToRecovery: peakToRecoveryDays,
      calendarDaysToRecovery: calendarDaysBetween(peakDate, recoveryDate),
    });
  };

  const pushOpen = (segment: {
    peakIndex: number;
    peakEquity: number;
    troughIndex: number;
    troughEquity: number;
  }): void => {
    const peakDate = dates[segment.peakIndex]!;
    const troughDate = dates[segment.troughIndex]!;
    segments.push({
      peakIndex: segment.peakIndex,
      troughIndex: segment.troughIndex,
      recoveryIndex: null,
      peakDate,
      troughDate,
      recoveryDate: null,
      peakEquity: segment.peakEquity,
      troughEquity: segment.troughEquity,
      depthPct: ((segment.peakEquity - segment.troughEquity) / segment.peakEquity) * 100,
      tradingDaysToTrough: segment.troughIndex - segment.peakIndex,
      calendarDaysToTrough: calendarDaysBetween(peakDate, troughDate),
      tradingDaysToRecovery: null,
      calendarDaysToRecovery: null,
    });
  };

  for (let i = 1; i < equityCurve.length; i += 1) {
    const equity = equities[i]!;
    if (equity >= runningPeakEquity) {
      // 恢复到（或超过）段峰值 → 闭合进行中的段并推进运行峰。
      if (open) {
        pushClosed({
          peakIndex: open.peakIndex,
          peakEquity: open.peakEquity,
          troughIndex: open.troughIndex,
          troughEquity: open.troughEquity,
          recoveryIndex: i,
        });
        open = null;
      }
      runningPeakIndex = i;
      runningPeakEquity = equity;
    } else if (open) {
      // 水下，更新谷底。
      if (equity < open.troughEquity) {
        open.troughEquity = equity;
        open.troughIndex = i;
      }
    } else {
      // 新跌破运行峰 → 开启一段。
      open = {
        peakIndex: runningPeakIndex,
        peakEquity: runningPeakEquity,
        troughIndex: i,
        troughEquity: equity,
      };
    }
  }
  if (open) pushOpen(open);

  let maxDrawdownPct = 0;
  let maxSegment: DrawdownSegment | null = null;
  for (const segment of segments) {
    if (segment.depthPct > maxDrawdownPct) {
      maxDrawdownPct = segment.depthPct;
      maxSegment = segment;
    } else if (
      segment.depthPct === maxDrawdownPct &&
      maxSegment !== null &&
      segment.peakIndex < maxSegment.peakIndex
    ) {
      maxSegment = segment;
    }
  }

  return { maxDrawdownPct, maxDrawdownSegment: maxSegment, allSegments: segments };
}

// ---------------------------------------------------------------------------
// 收益指标
// ---------------------------------------------------------------------------

function computeReturnMetrics(
  equities: readonly number[],
  annualizationFactor: number
): ReturnMetrics {
  const startEquity = equities[0]!;
  const endEquity = equities[equities.length - 1]!;
  const intervals = equities.length - 1; // >= 1（已由 assertValidEquityCurve 保证）

  const cagrFraction = annualizedReturnFromEquityCurve(
    startEquity,
    endEquity,
    intervals,
    annualizationFactor
  );
  if (cagrFraction === null) {
    // 校验层已保证 start/end > 0、intervals >= 1、annualizationFactor > 0，
    // 正常不可达；防御性抛错避免静默。
    throw new PerformanceEvaluationError(
      "INTERNAL_CAGR_UNAVAILABLE",
      `performanceMetrics: CAGR 计算返回 null（start=${startEquity}, end=${endEquity}, n=${intervals}）`
    );
  }

  return {
    startEquity,
    endEquity,
    totalReturnPct: (endEquity / startEquity - 1) * 100,
    cagrPct: cagrFraction * 100,
  };
}

// ---------------------------------------------------------------------------
// 下行风险 / tail risk
// ---------------------------------------------------------------------------

/** 最差连续亏损段候选（收益率区间下标域；日期由调用方依据 curve dates 填充）。 */
interface LosingRunCandidate {
  readonly startCurveIndex: number;
  readonly endCurveIndex: number;
  readonly days: number;
  readonly totalPct: number;
}

/** 在日收益序列上寻找最差连续亏损段（收益连续为负，按亏损总额最深取）。 */
function findWorstLosingStreak(returns: readonly number[]): LosingRunCandidate | null {
  let bestStart = -1;
  let bestEnd = -1;
  let bestSum = 0;
  let hasBest = false;
  let runStart = -1;
  let runSum = 0;

  const closeRun = (endIndex: number): void => {
    if (!hasBest || runSum < bestSum) {
      hasBest = true;
      bestStart = runStart;
      bestEnd = endIndex;
      bestSum = runSum;
    }
  };

  for (let j = 0; j < returns.length; j += 1) {
    const value = returns[j]!;
    if (value < 0) {
      if (runStart < 0) {
        runStart = j;
        runSum = 0;
      }
      runSum += value;
    } else if (runStart >= 0) {
      closeRun(j - 1);
      runStart = -1;
      runSum = 0;
    }
  }
  if (runStart >= 0) closeRun(returns.length - 1);
  if (!hasBest) return null;

  // 收益率区间 j 在 equityCurve 上实现于点位 j+1。
  return {
    startCurveIndex: bestStart + 1,
    endCurveIndex: bestEnd + 1,
    days: bestEnd - bestStart + 1,
    totalPct: bestSum * 100,
  };
}

/** 下行偏差（日，小数）：√( mean( min(日收益 − target, 0)² ) )。 */
function downsideDeviationDaily(returns: readonly number[], target: number): number {
  let sumSquares = 0;
  for (const value of returns) {
    const below = value - target;
    if (below < 0) sumSquares += below * below;
  }
  return Math.sqrt(sumSquares / returns.length);
}

function computeRiskMetrics(
  equities: readonly number[],
  dates: readonly string[],
  annualizationFactor: number,
  downsideTarget: number
): RiskMetrics {
  const returns = dailyReturnSeries(equities);
  const sampleStd = sampleStandardDeviation(returns);

  const worstStreak = findWorstLosingStreak(returns);
  const streak: WorstLosingStreak | null = worstStreak
    ? {
        totalPct: worstStreak.totalPct,
        days: worstStreak.days,
        startIndex: worstStreak.startCurveIndex,
        endIndex: worstStreak.endCurveIndex,
        startDate: dates[worstStreak.startCurveIndex]!,
        endDate: dates[worstStreak.endCurveIndex]!,
      }
    : null;

  return {
    annualizedVolatilityPct:
      sampleStd === null ? null : sampleStd * Math.sqrt(annualizationFactor) * 100,
    downsideDeviationPct:
      downsideDeviationDaily(returns, downsideTarget) * Math.sqrt(annualizationFactor) * 100,
    skewness: skewness(returns),
    excessKurtosis: excessKurtosis(returns),
    dailyReturnP01Pct: percentile(returns, 1)! * 100,
    dailyReturnP05Pct: percentile(returns, 5)! * 100,
    bestSingleDayPct: Math.max(...returns) * 100,
    worstSingleDayPct: Math.min(...returns) * 100,
    worstLosingStreak: streak,
  };
}

// ---------------------------------------------------------------------------
// 综合评估（主入口纯函数）
// ---------------------------------------------------------------------------

/**
 * 计算 C-16.1 收益/风险/回撤综合指标（纯函数、确定性、无副作用）。
 * 输入退化/非法 → 结构化抛错（见文件头「退化输入策略」）。
 */
export function computePerformanceMetrics(
  input: PerformanceEvaluationInput
): PerformanceMetrics {
  assertValidParameters(input);
  assertValidEquityCurve(input.equityCurve);

  const annualizationFactor = input.annualizationFactor ?? 252;
  const drawdownThresholdPct = input.drawdownThresholdPct ?? 5;
  const downsideTarget = input.downsideTarget ?? 0;

  const equities = input.equityCurve.map((point) => point.equity);
  const dates = input.equityCurve.map((point) => point.date);

  const returns = computeReturnMetrics(equities, annualizationFactor);
  const risk = computeRiskMetrics(equities, dates, annualizationFactor, downsideTarget);

  const drawdownAnalysis = analyzeDrawdown(input.equityCurve);
  const profileSegments = drawdownAnalysis.allSegments.filter(
    (segment) => segment.depthPct >= drawdownThresholdPct
  );
  const drawdown: DrawdownMetrics = {
    maxDrawdownPct: drawdownAnalysis.maxDrawdownPct,
    maxDrawdownSegment: drawdownAnalysis.maxDrawdownSegment,
    drawdownSegments: profileSegments,
    drawdownEpisodeCount: profileSegments.length,
  };

  const recoveryFactor =
    drawdownAnalysis.maxDrawdownPct > 0
      ? (returns.totalReturnPct / 100) / (drawdownAnalysis.maxDrawdownPct / 100)
      : null;

  return {
    returns,
    risk,
    drawdown,
    recoveryFactor,
  };
}
