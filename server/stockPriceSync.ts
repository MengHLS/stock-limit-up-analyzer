import {
  getLimitUpRecordsForStockPriceSync,
  upsertStockDailyPrices,
  type StockDailyPriceUpsert,
} from "./db";
import { fetchTushareDailyPricesByDate } from "./tushare";

export type StockPriceSyncMode = "full" | "recent";

export type StockPriceSyncSourceRecord = {
  stockCode: string;
  limitUpDate: string;
};

export type StockPriceSyncTarget = {
  tradeDate: string;
  stockCodes: string[];
};

export type StockPriceSyncResult = {
  mode: StockPriceSyncMode;
  targetTradingDates: number;
  requestedStockDatePairs: number;
  savedPriceRows: number;
  missingPricePairs: number;
  failedDates: string[];
  dates: string[];
};

const RECENT_SYNC_DATE_COUNT = 8;
const TUSHARE_SYNC_CONCURRENCY = 2;

/**
 * 对每条涨停记录同步信号日、下一已记录交易日及下二已记录交易日价格。
 * 后两者即使股票未继续涨停也必须保存，才能评价候选池的 T+1/T+2 溢价和跨日出清。
 */
export function buildStockPriceSyncTargets(records: StockPriceSyncSourceRecord[]): StockPriceSyncTarget[] {
  const tradingDates = Array.from(new Set(records.map((record) => record.limitUpDate)))
    .sort((left, right) => left.localeCompare(right));
  const nextDateByDate = new Map(tradingDates.map((date, index) => [date, tradingDates[index + 1] ?? null]));
  const secondDateByDate = new Map(tradingDates.map((date, index) => [date, tradingDates[index + 2] ?? null]));
  const codesByDate = new Map<string, Set<string>>();

  const addTarget = (date: string | null, stockCode: string) => {
    if (!date) return;
    const codes = codesByDate.get(date) ?? new Set<string>();
    codes.add(stockCode);
    codesByDate.set(date, codes);
  };

  for (const record of records) {
    addTarget(record.limitUpDate, record.stockCode);
    addTarget(nextDateByDate.get(record.limitUpDate) ?? null, record.stockCode);
    addTarget(secondDateByDate.get(record.limitUpDate) ?? null, record.stockCode);
  }

  return Array.from(codesByDate.entries())
    .map(([tradeDate, stockCodes]) => ({ tradeDate, stockCodes: Array.from(stockCodes).sort() }))
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

/** 同步价格表；recent 用于每日盘后补齐近八个已记录交易日，full 用于首次历史回填。两种模式均覆盖 T+2 目标日期。 */
export async function syncCandidateDailyPrices(mode: StockPriceSyncMode): Promise<StockPriceSyncResult> {
  const records = await getLimitUpRecordsForStockPriceSync();
  const allTargets = buildStockPriceSyncTargets(records);
  const targets = mode === "full" ? allTargets : allTargets.slice(-RECENT_SYNC_DATE_COUNT);
  let savedPriceRows = 0;
  let missingPricePairs = 0;
  const failedDates: string[] = [];

  for (let index = 0; index < targets.length; index += TUSHARE_SYNC_CONCURRENCY) {
    const targetBatch = targets.slice(index, index + TUSHARE_SYNC_CONCURRENCY);
    const batchResults = await Promise.all(targetBatch.map(async (target) => {
      try {
        const priceRows = await fetchTushareDailyPricesByDate(target.tradeDate);
        const requestedCodes = new Set(target.stockCodes);
        const relevantRows: StockDailyPriceUpsert[] = priceRows
          .filter((price) => requestedCodes.has(price.stockCode))
          .map((price) => ({
            stockCode: price.stockCode,
            tradeDate: price.tradeDate,
            openPrice: String(price.openPrice),
            closePrice: String(price.closePrice),
            preClosePrice: String(price.preClosePrice),
            source: "tushare",
          }));
        const savedCount = await upsertStockDailyPrices(relevantRows);
        return { savedCount, missingCount: Math.max(0, target.stockCodes.length - relevantRows.length), failedDate: null };
      } catch (error) {
        console.warn(`[StockPriceSync] 跳过 ${target.tradeDate} 日线同步：`, error);
        return { savedCount: 0, missingCount: target.stockCodes.length, failedDate: target.tradeDate };
      }
    }));

    for (const batchResult of batchResults) {
      savedPriceRows += batchResult.savedCount;
      missingPricePairs += batchResult.missingCount;
      if (batchResult.failedDate) failedDates.push(batchResult.failedDate);
    }
  }

  return {
    mode,
    targetTradingDates: targets.length,
    requestedStockDatePairs: targets.reduce((total, target) => total + target.stockCodes.length, 0),
    savedPriceRows,
    missingPricePairs,
    failedDates,
    dates: targets.map((target) => target.tradeDate),
  };
}
