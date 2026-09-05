/**
 * STEP 7.3 — Coverage Detection（覆盖率审计）。
 *
 * 不能简单认为「API 返回了数据 = 数据完整」。至少输出：target / completed / missing /
 * failed / suspicious 日期，以及每日行数、distinct 股票数、min/max/avg，按年聚合。
 */

import type {
  BackfillCheckpoint,
  CheckpointStatus,
  CoverageReport,
  DailyCoverageRecord,
  YearCoverage,
} from "./types";

/** 单日实际覆盖（来自 DB 聚合或 checkpoint 记录）。 */
export interface DailyCount {
  rowCount: number;
  distinctSymbols: number;
}

/**
 * 判断单日行数是否可疑（相对 baseline 低于 ratio）。
 * baseline 应来自相邻/历史实际数量级（非 stock_basic 当前列表），避免 survivorship bias。
 */
export function isSuspiciousCoverage(rowCount: number, baseline: number, ratio: number): boolean {
  if (!Number.isFinite(baseline) || baseline <= 0) return false;
  return rowCount < baseline * ratio;
}

/** 计算中位数。 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 从日期字符串提取年份。 */
function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * 构建覆盖率报告。
 * @param targetTradingDates 目标交易日（升序）。
 * @param checkpoints checkpoint 记录（用于判 status + 回填行数）。
 * @param dailyCounts 实际每日 (rowCount, distinctSymbols) 覆盖（可为空，缺省用 checkpoint.rowCount）。
 * @param suspiciousRatio 单日行数相对中位数低于该比例判 SUSPICIOUS。
 */
export function buildCoverageReport(
  targetTradingDates: string[],
  checkpoints: BackfillCheckpoint[],
  dailyCounts: Map<string, DailyCount> = new Map(),
  suspiciousRatio = 0.9,
): CoverageReport {
  const checkpointByDate = new Map(checkpoints.map((cp) => [cp.tradeDate, cp]));

  const daily: DailyCoverageRecord[] = [];
  const missingDates: string[] = [];
  const failedDates: string[] = [];
  const suspiciousDates: string[] = [];

  let totalRows = 0;
  const rowCounts: number[] = [];
  const perYearMap = new Map<number, { tradingDays: number; stockDayRows: number }>();

  const countFor = (date: string, cp: BackfillCheckpoint | undefined): DailyCount => {
    const actual = dailyCounts.get(date);
    if (actual) return actual;
    return { rowCount: cp?.rowCount ?? 0, distinctSymbols: 0 };
  };

  // 先基于已完成日期的行数算中位数 baseline。
  const completedCounts = targetTradingDates
    .map((date) => {
      const cp = checkpointByDate.get(date);
      return cp && cp.status === "SUCCESS" ? (dailyCounts.get(date)?.rowCount ?? cp.rowCount ?? 0) : 0;
    })
    .filter((n) => n > 0);
  const baseline = median(completedCounts) ?? 0;

  for (const date of targetTradingDates) {
    const cp = checkpointByDate.get(date);
    const { rowCount, distinctSymbols: distinct } = countFor(date, cp);
    const year = yearOf(date);
    const yearEntry = perYearMap.get(year) ?? { tradingDays: 0, stockDayRows: 0 };
    yearEntry.tradingDays += 1;
    yearEntry.stockDayRows += rowCount;
    perYearMap.set(year, yearEntry);

    let status: CheckpointStatus = cp?.status ?? "PENDING";
    if (!cp) {
      missingDates.push(date);
    } else if (cp.status === "FAILED") {
      failedDates.push(date);
    } else if (cp.status === "SUSPICIOUS") {
      suspiciousDates.push(date);
    } else if (cp.status === "SUCCESS" && baseline > 0 && rowCount > 0 && isSuspiciousCoverage(rowCount, baseline, suspiciousRatio)) {
      status = "SUSPICIOUS";
      suspiciousDates.push(date);
    }

    daily.push({ tradeDate: date, status, rowCount, distinctSymbols: distinct });
    totalRows += rowCount;
    if (rowCount > 0) rowCounts.push(rowCount);
  }

  // 注意：跨日期 distinct symbols 需 DB 聚合（COUNT(DISTINCT stockCode)），纯函数无法还原，
  // 此处置 0，由 DB 聚合审计（server/backfill/audit.ts）补齐。
  const perYear: YearCoverage[] = Array.from(perYearMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, entry]) => ({
      year,
      tradingDays: entry.tradingDays,
      stockDayRows: entry.stockDayRows,
      distinctSymbols: 0,
      avgRowsPerDay: entry.tradingDays > 0 ? entry.stockDayRows / entry.tradingDays : null,
    }));

  const completed = checkpoints.filter((cp) => cp.status === "SUCCESS").length;
  const failed = checkpoints.filter((cp) => cp.status === "FAILED").length;
  const suspicious = checkpoints.filter((cp) => cp.status === "SUSPICIOUS").length;
  const quotaStopped = checkpoints.filter((cp) => cp.status === "QUOTA_STOPPED").length;

  return {
    startDate: targetTradingDates[0] ?? "",
    endDate: targetTradingDates[targetTradingDates.length - 1] ?? "",
    targetTradingDates: targetTradingDates.length,
    completedTradingDates: completed,
    failedTradingDates: failed,
    suspiciousTradingDates: suspicious,
    quotaStoppedTradingDates: quotaStopped,
    missingDates,
    failedDates,
    suspiciousDates,
    totalRows,
    distinctSymbols: 0,
    minRowsPerDay: rowCounts.length > 0 ? Math.min(...rowCounts) : null,
    maxRowsPerDay: rowCounts.length > 0 ? Math.max(...rowCounts) : null,
    avgRowsPerDay: rowCounts.length > 0 ? totalRows / rowCounts.length : null,
    perYear,
    daily,
  };
}
