/**
 * STEP 7.6 — Coverage：指数与流动性覆盖度计算（供报告与缺口审计）。
 * 纯函数，输入为已入库/探测到的数据与可选交易日历，输出覆盖统计。
 */

import type { IndexCode, IndexDailyBar, IndexMasterEntry, LiquidityDaily } from "./types";

// ---------------------------------------------------------------------------
// Index Coverage
// ---------------------------------------------------------------------------

export interface IndexCoverage {
  indexCode: IndexCode;
  indexName: string;
  provider: string;
  firstDate: string | null;
  lastDate: string | null;
  rowCount: number;
  /** [firstDate, lastDate] 内缺失的交易日（需传入交易日历；无日历时为 []）。 */
  missingDates: string[];
  source: string;
}

/**
 * 计算单只指数的覆盖度。
 * @param master 指数主数据（身份/名称/来源）
 * @param bars 该指数日线
 * @param tradingDates 可选交易日历；提供时计算 [first,last] 内缺失交易日。
 */
export function computeIndexCoverage(
  master: IndexMasterEntry,
  bars: readonly IndexDailyBar[],
  tradingDates?: readonly string[],
): IndexCoverage {
  const sorted = bars.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const firstDate = sorted.length > 0 ? sorted[0]!.tradeDate : (master.firstDate ?? null);
  const lastDate = sorted.length > 0 ? sorted[sorted.length - 1]!.tradeDate : (master.lastDate ?? null);

  let missingDates: string[] = [];
  if (tradingDates && tradingDates.length > 0 && firstDate && lastDate) {
    const present = new Set(sorted.map((bar) => bar.tradeDate));
    missingDates = tradingDates
      .filter((date) => date >= firstDate && date <= lastDate)
      .filter((date) => !present.has(date));
  }

  return {
    indexCode: master.indexCode,
    indexName: master.indexName,
    provider: master.provider,
    firstDate,
    lastDate,
    rowCount: sorted.length,
    missingDates,
    source: master.source,
  };
}

// ---------------------------------------------------------------------------
// Liquidity Coverage
// ---------------------------------------------------------------------------

export interface LiquidityCoverageYear {
  year: number;
  /** 该年交易日数（来自交易日历；无日历时用数据内出现的交易日去重数）。 */
  tradingDays: number;
  /** 该年出现过的证券数（去重）。 */
  symbols: number;
  /** 该年流动性行数。 */
  rows: number;
  /** rows / (tradingDays × symbols)，衡量「已出现证券」的网格填充率；0 ≤ ratio ≤ 1。 */
  coverageRatio: number;
}

/**
 * 按年计算流动性覆盖度。
 * 注意：symbols 为「该年实际出现」的证券数，非全市场证券数；全市场口径需 STEP 7.3
 * Security Master + 全市场日线落地后方可计算，此处如实标注口径。
 * @param rows 流动性日线行
 * @param tradingDates 可选交易日历（用于精确交易日数）
 */
export function computeLiquidityCoverageByYear(
  rows: readonly LiquidityDaily[],
  tradingDates?: readonly string[],
): LiquidityCoverageYear[] {
  const byYear = new Map<number, LiquidityDaily[]>();
  for (const row of rows) {
    const year = Number(row.tradeDate.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const list = byYear.get(year) ?? [];
    list.push(row);
    byYear.set(year, list);
  }

  const calendarByYear = new Map<number, Set<string>>();
  if (tradingDates) {
    for (const date of tradingDates) {
      const year = Number(date.slice(0, 4));
      if (!Number.isFinite(year)) continue;
      const set = calendarByYear.get(year) ?? new Set<string>();
      set.add(date);
      calendarByYear.set(year, set);
    }
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, yearRows]) => {
      const dataDates = new Set(yearRows.map((row) => row.tradeDate));
      const symbols = new Set(yearRows.map((row) => row.securityId)).size;
      const tradingDays = calendarByYear.get(year)?.size ?? dataDates.size;
      const denominator = tradingDays * symbols;
      const coverageRatio = denominator > 0 ? yearRows.length / denominator : 0;
      return {
        year,
        tradingDays,
        symbols,
        rows: yearRows.length,
        coverageRatio: Math.min(1, coverageRatio),
      };
    });
}
