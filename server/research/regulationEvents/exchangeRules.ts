/**
 * PATTERN-DISCOVERY-REGULATION-001 — 交易所异常波动规则引擎（只读、纯函数）。
 *
 * 当前口径来自：
 * - 上海证券交易所交易规则（2026年修订），2026-07-06 生效：
 *   http://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20260424_10816492.shtml
 * - 深圳证券交易所交易规则（2026年修订），2026-07-06 生效：
 *   http://www.szse.cn/lawrules/rule/trade/current/t20260424_620190.html
 *
 * 本轮研究的主板关键条款（沪深一致）：
 * - 异常波动：连续 3 个交易日内收盘价相对对应分类指数的涨跌幅偏离值累计达到 ±20%；
 *   或连续 3 个交易日日均换手率 / 前 5 个交易日日均换手率 >= 30，且 3 日累计换手率 >= 20%。
 * - 严重异常波动：连续 10 个交易日内 4 次出现同向异常波动；或 10 日累计偏离值 +100%/-50%；
 *   或 30 日累计偏离值 +200%/-70%。
 * - 异常波动指标和严重异常波动指标自交易所公布的次一交易日或复牌之日起重新计算。
 *
 * 事件日之前适用 2023 版规则时，本模块使用与主板条款相同的 provisional 配置；
 * 2023 规则的原始附件仍需在下一轮补充 pin 源。禁止把 2026 规则静默回填到历史事件。
 */

import type { TradingCalendar } from "../../security/tradingCalendar";
import type {
  DailyBar,
  ExchangeRuleVersion,
  IndexDailyBar,
  RegulationExchange,
  SuspensionWindow,
} from "./types";

const SSE_2026_SOURCE =
  "http://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20260424_10816492.shtml";
const SZSE_2026_SOURCE =
  "http://www.szse.cn/lawrules/rule/trade/current/t20260424_620190.html";

const MAIN_BOARD_COMMON = {
  mainBoardAbnormalPriceDeviationPct: 20,
  mainBoardAbnormalTurnoverRatio: 30,
  mainBoardAbnormalCumulativeTurnoverPct: 20,
  severeAbnormalOccurrenceCount10d: 4,
  severeAbnormalPriceDeviation10dUpPct: 100,
  severeAbnormalPriceDeviation10dDownPct: -50,
  severeAbnormalPriceDeviation30dUpPct: 200,
  severeAbnormalPriceDeviation30dDownPct: -70,
  resetRuleText: "异常波动指标和严重异常波动指标自本所公布的次一交易日或复牌之日起重新计算。",
} as const;

export const REGULATION_RULE_VERSIONS: readonly ExchangeRuleVersion[] = [
  {
    id: "SSE_2026_MAIN_BOARD",
    exchange: "SSE",
    effectiveFrom: "2026-07-06",
    effectiveTo: null,
    sourceTitle: "上海证券交易所交易规则（2026年修订）",
    sourceUrl: SSE_2026_SOURCE,
    sourceVerification: "OFFICIAL_CURRENT",
    ...MAIN_BOARD_COMMON,
  },
  {
    id: "SZSE_2026_MAIN_BOARD",
    exchange: "SZSE",
    effectiveFrom: "2026-07-06",
    effectiveTo: null,
    sourceTitle: "深圳证券交易所交易规则（2026年修订）",
    sourceUrl: SZSE_2026_SOURCE,
    sourceVerification: "OFFICIAL_CURRENT",
    ...MAIN_BOARD_COMMON,
  },
  {
    id: "SSE_2023_MAIN_BOARD_PROVISIONAL",
    exchange: "SSE",
    effectiveFrom: "2023-02-17",
    effectiveTo: "2026-07-05",
    sourceTitle: "上海证券交易所交易规则（2023年修订，主板条款 provisional）",
    sourceUrl: SSE_2026_SOURCE,
    sourceVerification: "ARCHIVE_PENDING",
    ...MAIN_BOARD_COMMON,
  },
  {
    id: "SZSE_2023_MAIN_BOARD_PROVISIONAL",
    exchange: "SZSE",
    effectiveFrom: "2023-02-17",
    effectiveTo: "2026-07-05",
    sourceTitle: "深圳证券交易所交易规则（2023年修订，主板条款 provisional）",
    sourceUrl: SZSE_2026_SOURCE,
    sourceVerification: "ARCHIVE_PENDING",
    ...MAIN_BOARD_COMMON,
  },
];

export function resolveRegulationRuleVersion(
  exchange: RegulationExchange,
  date: string,
): ExchangeRuleVersion {
  const candidate = REGULATION_RULE_VERSIONS
    .filter((v) => v.exchange === exchange)
    .filter((v) => v.effectiveFrom <= date && (v.effectiveTo === null || date <= v.effectiveTo))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!candidate) throw new Error(`No regulation rule version for ${exchange} @ ${date}`);
  return candidate;
}

function byDate<T extends { tradeDate: string }>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

function adjustedCloseSeries(rows: readonly DailyBar[]): number[] {
  const sorted = byDate(rows);
  if (sorted.length === 0) return [];
  let factor = 1;
  const firstClose = sorted[0]!.close;
  return sorted.map((row, index) => {
    if (index > 0 && row.previousClose > 0 && row.close > 0) {
      factor *= row.close / row.previousClose;
    }
    return firstClose * factor;
  });
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 收盘价涨跌幅偏离值累计值（%）：股票复权收益 - 对应指数收益。 */
export function computePriceDeviationPct(
  stockRows: readonly DailyBar[],
  indexRows: readonly IndexDailyBar[],
  endDate: string,
  windowDays: number,
): number | null {
  const stocks = byDate(stockRows);
  const indices = byDate(indexRows);
  const endIdx = stocks.findIndex((row) => row.tradeDate === endDate);
  if (endIdx < windowDays) return null;
  const startIdx = endIdx - windowDays + 1;
  const baseIdx = startIdx - 1;
  const baseDate = stocks[baseIdx]?.tradeDate;
  const endStockClose = adjustedCloseSeries(stocks)[endIdx];
  const baseStockClose = adjustedCloseSeries(stocks)[baseIdx];
  if (!baseDate || !finite(endStockClose) || !finite(baseStockClose) || baseStockClose <= 0) return null;

  const indexEnd = indices.find((row) => row.tradeDate === endDate)?.close;
  const indexBase = indices.find((row) => row.tradeDate === baseDate)?.close;
  if (!finite(indexEnd) || !finite(indexBase) || indexBase <= 0) return null;

  const stockReturn = endStockClose / baseStockClose - 1;
  const indexReturn = indexEnd / indexBase - 1;
  return (stockReturn - indexReturn) * 100;
}

export interface AbnormalConditionResult {
  priceDeviation3dPct: number | null;
  priceCondition: boolean;
  turnoverRatio: number | null;
  cumulativeTurnoverPct: number | null;
  turnoverCondition: boolean;
  isAbnormal: boolean;
  direction: "up" | "down" | null;
}

export function evaluateMainBoardAbnormalConditions(
  stockRows: readonly DailyBar[],
  indexRows: readonly IndexDailyBar[],
  endDate: string,
  rule: ExchangeRuleVersion,
): AbnormalConditionResult {
  const stocks = byDate(stockRows);
  const endIdx = stocks.findIndex((row) => row.tradeDate === endDate);
  const priceDeviation3dPct = computePriceDeviationPct(stocks, indexRows, endDate, 3);
  const priceCondition =
    priceDeviation3dPct !== null &&
    Math.abs(priceDeviation3dPct) >= rule.mainBoardAbnormalPriceDeviationPct;

  let turnoverRatio: number | null = null;
  let cumulativeTurnoverPct: number | null = null;
  if (endIdx >= 7) {
    const last3 = stocks.slice(endIdx - 2, endIdx + 1);
    const prev5 = stocks.slice(endIdx - 7, endIdx - 2);
    const last3Turnover = last3.map((row) => row.turnoverRate);
    const prev5Turnover = prev5.map((row) => row.turnoverRate);
    if (last3Turnover.every(finite) && prev5Turnover.every(finite)) {
      const avg3 = last3Turnover.reduce((sum, value) => sum + value, 0) / 3;
      const avg5 = prev5Turnover.reduce((sum, value) => sum + value, 0) / 5;
      turnoverRatio = avg5 > 0 ? avg3 / avg5 : null;
      cumulativeTurnoverPct = last3Turnover.reduce((sum, value) => sum + value, 0);
    }
  }
  const turnoverCondition =
    turnoverRatio !== null &&
    cumulativeTurnoverPct !== null &&
    turnoverRatio >= rule.mainBoardAbnormalTurnoverRatio &&
    cumulativeTurnoverPct >= rule.mainBoardAbnormalCumulativeTurnoverPct;

  const direction =
    priceDeviation3dPct !== null && priceDeviation3dPct > 0
      ? "up"
      : priceDeviation3dPct !== null && priceDeviation3dPct < 0
        ? "down"
        : null;

  return {
    priceDeviation3dPct,
    priceCondition,
    turnoverRatio,
    cumulativeTurnoverPct,
    turnoverCondition,
    isAbnormal: priceCondition || turnoverCondition,
    direction,
  };
}

export interface SevereConditionResult {
  abnormalOccurrences10d: number;
  sameDirectionOccurrenceCount10d: number;
  occurrenceCondition: boolean;
  priceDeviation10dPct: number | null;
  priceDeviation30dPct: number | null;
  priceCondition10d: boolean;
  priceCondition30d: boolean;
  isSevere: boolean;
}

export function evaluateMainBoardSevereConditions(
  stockRows: readonly DailyBar[],
  indexRows: readonly IndexDailyBar[],
  endDate: string,
  rule: ExchangeRuleVersion,
): SevereConditionResult {
  const stocks = byDate(stockRows);
  const endIdx = stocks.findIndex((row) => row.tradeDate === endDate);
  const occurrences: Array<{ date: string; direction: "up" | "down" }> = [];
  if (endIdx >= 0) {
    for (let i = Math.max(0, endIdx - 9); i <= endIdx; i += 1) {
      const date = stocks[i]!.tradeDate;
      const dev = computePriceDeviationPct(stocks, indexRows, date, 3);
      if (dev === null) continue;
      if (dev >= rule.mainBoardAbnormalPriceDeviationPct) occurrences.push({ date, direction: "up" });
      else if (dev <= -rule.mainBoardAbnormalPriceDeviationPct) occurrences.push({ date, direction: "down" });
    }
  }
  const upCount = occurrences.filter((x) => x.direction === "up").length;
  const downCount = occurrences.filter((x) => x.direction === "down").length;
  const sameDirectionOccurrenceCount10d = Math.max(upCount, downCount);
  const occurrenceCondition =
    sameDirectionOccurrenceCount10d >= rule.severeAbnormalOccurrenceCount10d;

  const priceDeviation10dPct = computePriceDeviationPct(stocks, indexRows, endDate, 10);
  const priceDeviation30dPct = computePriceDeviationPct(stocks, indexRows, endDate, 30);
  const priceCondition10d =
    priceDeviation10dPct !== null &&
    (priceDeviation10dPct >= rule.severeAbnormalPriceDeviation10dUpPct ||
      priceDeviation10dPct <= rule.severeAbnormalPriceDeviation10dDownPct);
  const priceCondition30d =
    priceDeviation30dPct !== null &&
    (priceDeviation30dPct >= rule.severeAbnormalPriceDeviation30dUpPct ||
      priceDeviation30dPct <= rule.severeAbnormalPriceDeviation30dDownPct);

  return {
    abnormalOccurrences10d: occurrences.length,
    sameDirectionOccurrenceCount10d,
    occurrenceCondition,
    priceDeviation10dPct,
    priceDeviation30dPct,
    priceCondition10d,
    priceCondition30d,
    isSevere: occurrenceCondition || priceCondition10d || priceCondition30d,
  };
}

export interface ResetDateResult {
  announcementTradingDate: string | null;
  resetDate: string | null;
  resetDueToResumption: boolean;
}

/**
 * 依据规则文本计算 resetDate：
 * - 公告日的次一交易日；
 * - 若公告日或次一交易日被停牌窗口覆盖，则以复牌后首个交易日为准；
 * - 无法确定交易日/复牌日时返回 null，禁止用自然日补齐。
 */
export function computeResetDate(
  announcementDate: string,
  calendar: TradingCalendar,
  suspensionWindows: readonly SuspensionWindow[] = [],
): ResetDateResult {
  const announcementTradingDate = calendar.firstTradingDayOnOrAfter(announcementDate);
  const next = calendar.nextTradingDay(announcementDate);
  if (!next) return { announcementTradingDate, resetDate: null, resetDueToResumption: false };

  const covering = suspensionWindows
    .filter((window) => window.startDate <= next && (window.endDate === "9999-12-31" || window.endDate >= next))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (!covering) return { announcementTradingDate, resetDate: next, resetDueToResumption: false };
  if (covering.endDate === "9999-12-31") {
    return { announcementTradingDate, resetDate: null, resetDueToResumption: true };
  }
  return {
    announcementTradingDate,
    resetDate: calendar.nextTradingDay(covering.endDate),
    resetDueToResumption: true,
  };
}