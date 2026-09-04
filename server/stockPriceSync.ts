import {
  getLimitUpRecordsForStockPriceSync,
  getLimitUpRecordsForStockPriceSyncByDate,
  getLeaderCandidateDailyPriceMap,
  getStockDailyPriceTradeDates,
  getLimitUpRecordsForSyncCheck,
  getStockDailyPricePairs,
  upsertStockDailyPrices,
  type StockDailyPriceUpsert,
} from "./db";
import { fetchTushareDailyPricesByDate, fetchTushareTradingDates, isTushareRateLimitError } from "./tushare";

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
  /** 是否因 Tushare 限频而提前中止同步。 */
  rateLimited?: boolean;
};

const RECENT_SYNC_DATE_COUNT = 8;
const TUSHARE_SYNC_CONCURRENCY = 2;

/**
 * 对每条涨停记录同步信号日、下一已记录交易日及下二已记录交易日价格。
 * 后两者即使股票未继续涨停也必须保存，才能评价候选池的 T+1/T+2 溢价和跨日出清。
 */
export function buildStockPriceSyncTargets(records: StockPriceSyncSourceRecord[], marketTradingDates?: string[], futureTradingDayCount = 10): StockPriceSyncTarget[] {
  const fallbackTradingDates = Array.from(new Set(records.map((record) => record.limitUpDate)))
    .sort((left, right) => left.localeCompare(right));
  const tradingDates = Array.from(new Set(marketTradingDates?.length ? marketTradingDates : fallbackTradingDates))
    .sort((left, right) => left.localeCompare(right));
  const tradingIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const codesByDate = new Map<string, Set<string>>();

  const addTarget = (date: string | null, stockCode: string) => {
    if (!date) return;
    const codes = codesByDate.get(date) ?? new Set<string>();
    codes.add(stockCode);
    codesByDate.set(date, codes);
  };

  for (const record of records) {
    addTarget(record.limitUpDate, record.stockCode);
    const signalIndex = tradingIndex.get(record.limitUpDate);
    for (let offset = 1; offset <= futureTradingDayCount; offset += 1) {
      addTarget(signalIndex === undefined ? null : tradingDates[signalIndex + offset] ?? null, record.stockCode);
    }
  }

  return Array.from(codesByDate.entries())
    .map(([tradeDate, stockCodes]) => ({ tradeDate, stockCodes: Array.from(stockCodes).sort() }))
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

/** 同步价格表；recent 用于每日盘后补齐近八个已记录交易日，full 用于首次历史回填。两种模式覆盖信号后十个实际交易日。 */
export async function syncCandidateDailyPrices(mode: StockPriceSyncMode): Promise<StockPriceSyncResult> {
  const records = await getLimitUpRecordsForStockPriceSync();
  const recordDates = records.map((record) => record.limitUpDate).sort((left, right) => left.localeCompare(right));
  if (recordDates.length === 0) return { mode, targetTradingDates: 0, requestedStockDatePairs: 0, savedPriceRows: 0, missingPricePairs: 0, failedDates: [], dates: [] };
  const startDate = recordDates[0];
  const endDate = new Date(`${recordDates.at(-1)}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 21);
  const calendarEndDate = endDate.toISOString().slice(0, 10);
  let marketTradingDates: string[];
  try {
    marketTradingDates = await fetchTushareTradingDates(startDate, calendarEndDate);
  } catch (error) {
    console.warn("[StockPriceSync] 交易日历获取失败，降级为涨停记录日期：", error);
    marketTradingDates = Array.from(new Set(recordDates));
  }
  const allTargets = buildStockPriceSyncTargets(records, marketTradingDates, 10);
  const targets = mode === "full" ? allTargets : allTargets.slice(-RECENT_SYNC_DATE_COUNT);
  let savedPriceRows = 0;
  let missingPricePairs = 0;
  let rateLimited = false;
  const failedDates: string[] = [];

  for (let index = 0; index < targets.length && !rateLimited; index += TUSHARE_SYNC_CONCURRENCY) {
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
            lowPrice: String(price.lowPrice),
            amount: String(price.amount),
            preClosePrice: String(price.preClosePrice),
            source: "tushare",
          }));
        const savedCount = await upsertStockDailyPrices(relevantRows);
        return { savedCount, missingCount: Math.max(0, target.stockCodes.length - relevantRows.length), failedDate: null, rateLimited: false };
      } catch (error) {
        const rateLimitedHit = isTushareRateLimitError(error);
        console.warn(`[StockPriceSync] 跳过 ${target.tradeDate} 日线同步：`, error);
        return { savedCount: 0, missingCount: target.stockCodes.length, failedDate: target.tradeDate, rateLimited: rateLimitedHit };
      }
    }));

    for (const batchResult of batchResults) {
      savedPriceRows += batchResult.savedCount;
      missingPricePairs += batchResult.missingCount;
      if (batchResult.failedDate) failedDates.push(batchResult.failedDate);
      if (batchResult.rateLimited) rateLimited = true;
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
    rateLimited,
  };
}

/** 上传识别完成后，按单个涨停日期精准同步该日期及后续十个实际交易日的行情。 */
export async function syncCandidateDailyPricesForDate(limitUpDate: string, futureTradingDayCount = 10, stockCodes?: string[]): Promise<StockPriceSyncResult> {
  const codeSet = stockCodes ? new Set(stockCodes) : null;
  const records = (await getLimitUpRecordsForStockPriceSyncByDate(limitUpDate)).filter((record) => !codeSet || codeSet.has(record.stockCode));
  if (records.length === 0) return { mode: "recent", targetTradingDates: 0, requestedStockDatePairs: 0, savedPriceRows: 0, missingPricePairs: 0, failedDates: [], dates: [] };

  const calendarEnd = new Date(`${limitUpDate}T00:00:00Z`);
  calendarEnd.setUTCDate(calendarEnd.getUTCDate() + 21);
  let marketTradingDates: string[];
  try {
    marketTradingDates = await fetchTushareTradingDates(limitUpDate, calendarEnd.toISOString().slice(0, 10));
  } catch (error) {
    console.warn(`[StockPriceSync] ${limitUpDate} 交易日历获取失败，降级为指定日期：`, error);
    marketTradingDates = await getStockDailyPriceTradeDates(limitUpDate, calendarEnd.toISOString().slice(0, 10));
    if (marketTradingDates.length === 0) marketTradingDates = [limitUpDate];
  }

  const targets = buildStockPriceSyncTargets(records, marketTradingDates, futureTradingDayCount);
  let savedPriceRows = 0;
  let missingPricePairs = 0;
  let rateLimited = false;
  const failedDates: string[] = [];
  for (let index = 0; index < targets.length && !rateLimited; index += TUSHARE_SYNC_CONCURRENCY) {
    const targetBatch = targets.slice(index, index + TUSHARE_SYNC_CONCURRENCY);
    const batchResults = await Promise.all(targetBatch.map(async (target) => {
      try {
        const priceRows = await fetchTushareDailyPricesByDate(target.tradeDate);
        const requestedCodes = new Set(target.stockCodes);
        const relevantRows: StockDailyPriceUpsert[] = priceRows.filter((price) => requestedCodes.has(price.stockCode)).map((price) => ({
          stockCode: price.stockCode,
          tradeDate: price.tradeDate,
          openPrice: String(price.openPrice),
          closePrice: String(price.closePrice),
          lowPrice: String(price.lowPrice),
          amount: String(price.amount),
          preClosePrice: String(price.preClosePrice),
          source: "tushare",
        }));
        return { savedCount: await upsertStockDailyPrices(relevantRows), missingCount: Math.max(0, target.stockCodes.length - relevantRows.length), failedDate: null, rateLimited: false };
      } catch (error) {
        const rateLimitedHit = isTushareRateLimitError(error);
        console.warn(`[StockPriceSync] 跳过上传日期 ${target.tradeDate} 日线同步：`, error);
        return { savedCount: 0, missingCount: target.stockCodes.length, failedDate: target.tradeDate, rateLimited: rateLimitedHit };
      }
    }));
    for (const result of batchResults) {
      savedPriceRows += result.savedCount;
      missingPricePairs += result.missingCount;
      if (result.failedDate) failedDates.push(result.failedDate);
      if (result.rateLimited) rateLimited = true;
    }
  }
  return { mode: "recent", targetTradingDates: targets.length, requestedStockDatePairs: targets.reduce((total, target) => total + target.stockCodes.length, 0), savedPriceRows, missingPricePairs, failedDates, dates: targets.map((target) => target.tradeDate), rateLimited };
}

export type UploadPriceSyncPlan = {
  mode: "recent" | "historical";
  signalDates: string[];
  stockCodes: string[];
};

/** 近期按上传日前最近六个信号日（含上传日）补齐，历史上传只补齐本次图片中的股票。 */
export function buildUploadPriceSyncPlan(
  uploadDate: string,
  uploadedStockCodes: string[],
  records: StockPriceSyncSourceRecord[],
  now = new Date(),
): UploadPriceSyncPlan {
  const today = now.toISOString().slice(0, 10);
  const recentCutoff = new Date(`${today}T00:00:00Z`);
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 14);
  const cutoffDate = recentCutoff.toISOString().slice(0, 10);
  const isRecent = uploadDate >= cutoffDate && uploadDate <= today;
  if (isRecent) {
    const signalDates = Array.from(new Set(records.map((record) => record.limitUpDate).filter((date) => date <= uploadDate))).sort().slice(-6);
    return { mode: "recent", signalDates, stockCodes: [] };
  }
  const codes = new Set(uploadedStockCodes);
  const historicalCodes = Array.from(new Set(records.filter((record) => record.limitUpDate === uploadDate && codes.has(record.stockCode)).map((record) => record.stockCode))).sort();
  return { mode: "historical", signalDates: historicalCodes.length > 0 ? [uploadDate] : [], stockCodes: historicalCodes };
}

/** 按上传日期智能补全T+5；重复调用只覆盖同一股票—交易日记录，不产生重复行情行。 */
export async function syncCandidateDailyPricesForUpload(uploadDate: string, uploadedStockCodes: string[]): Promise<Omit<StockPriceSyncResult, "mode"> & UploadPriceSyncPlan> {
  const records = await getLimitUpRecordsForStockPriceSync();
  const plan = buildUploadPriceSyncPlan(uploadDate, uploadedStockCodes, records);
  const empty = { targetTradingDates: 0, requestedStockDatePairs: 0, savedPriceRows: 0, missingPricePairs: 0, failedDates: [] as string[], dates: [] as string[] };
  if (plan.signalDates.length === 0) return { ...empty, ...plan };

  // 近期上传必须把前几日涨停且仍处于T+5窗口的股票带到当前交易日，不能仅查询当前信号日。
  const selectedRecords = records.filter((record) => plan.signalDates.includes(record.limitUpDate) && (plan.mode === "recent" || plan.stockCodes.includes(record.stockCode)));
  const startDate = plan.signalDates[0]!;
  const calendarEnd = new Date(`${plan.signalDates[plan.signalDates.length - 1]}T00:00:00Z`);
  calendarEnd.setUTCDate(calendarEnd.getUTCDate() + 14);
  let marketTradingDates: string[];
  try {
    marketTradingDates = await fetchTushareTradingDates(startDate, calendarEnd.toISOString().slice(0, 10));
  } catch (error) {
    console.warn(`[StockPriceSync] 上传补全交易日历获取失败，降级为候选日期：`, error);
    marketTradingDates = await getStockDailyPriceTradeDates(startDate, calendarEnd.toISOString().slice(0, 10));
    if (marketTradingDates.length === 0) marketTradingDates = Array.from(new Set(selectedRecords.map((record) => record.limitUpDate))).sort();
  }
  const targets = buildStockPriceSyncTargets(selectedRecords, marketTradingDates, 5);
  let savedPriceRows = 0;
  let missingPricePairs = 0;
  const failedDates: string[] = [];
  for (let index = 0; index < targets.length; index += TUSHARE_SYNC_CONCURRENCY) {
    const batchResults = await Promise.all(targets.slice(index, index + TUSHARE_SYNC_CONCURRENCY).map(async (target) => {
      try {
        const requestedCodes = new Set(target.stockCodes);
        const relevantRows = (await fetchTushareDailyPricesByDate(target.tradeDate)).filter((price) => requestedCodes.has(price.stockCode)).map((price) => ({ stockCode: price.stockCode, tradeDate: price.tradeDate, openPrice: String(price.openPrice), closePrice: String(price.closePrice), lowPrice: String(price.lowPrice), amount: String(price.amount), preClosePrice: String(price.preClosePrice), source: "tushare" } satisfies StockDailyPriceUpsert));
        return { savedCount: await upsertStockDailyPrices(relevantRows), missingCount: Math.max(0, target.stockCodes.length - relevantRows.length), failedDate: null as string | null };
      } catch (error) {
        console.warn(`[StockPriceSync] 上传补全跳过 ${target.tradeDate}：`, error);
        return { savedCount: 0, missingCount: target.stockCodes.length, failedDate: target.tradeDate };
      }
    }));
    for (const result of batchResults) { savedPriceRows += result.savedCount; missingPricePairs += result.missingCount; if (result.failedDate) failedDates.push(result.failedDate); }
  }
  return { targetTradingDates: targets.length, requestedStockDatePairs: targets.reduce((total, target) => total + target.stockCodes.length, 0), savedPriceRows, missingPricePairs, failedDates, dates: targets.map((target) => target.tradeDate), ...plan };
}

export type MissingStockPriceRequirement = {
  stockCode: string;
  signalDate: string;
  requiredTradeDates: string[];
  missingTradeDates: string[];
  missingCount: number;
};

export function buildMissingStockPriceRequirements(
  records: StockPriceSyncSourceRecord[],
  priceKeys: ReadonlySet<string>,
  marketTradingDates: string[],
  futureTradingDayCount = 5,
): MissingStockPriceRequirement[] {
  const tradingDates = Array.from(new Set(marketTradingDates)).sort();
  const indexByDate = new Map(tradingDates.map((date, index) => [date, index]));
  return records.map((record) => {
    const signalIndex = indexByDate.get(record.limitUpDate);
    const requiredTradeDates = signalIndex === undefined
      ? [record.limitUpDate]
      : tradingDates.slice(signalIndex, signalIndex + futureTradingDayCount + 1);
    const missingTradeDates = requiredTradeDates.filter((tradeDate) => !priceKeys.has(`${record.stockCode}::${tradeDate}`));
    return { stockCode: record.stockCode, signalDate: record.limitUpDate, requiredTradeDates, missingTradeDates, missingCount: missingTradeDates.length };
  }).filter((item) => item.missingCount > 0);
}

export async function getMissingStockPriceRequirements(filter?: { stockCode?: string; signalDate?: string }): Promise<MissingStockPriceRequirement[]> {
  const allRecords = await getLimitUpRecordsForStockPriceSync();
  const records = allRecords.filter((record) => (!filter?.stockCode || record.stockCode === filter.stockCode) && (!filter?.signalDate || record.limitUpDate === filter.signalDate));
  if (records.length === 0) return [];
  const dates = records.map((record) => record.limitUpDate).sort();
  const end = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 14);
  let tradingDates: string[];
  try {
    tradingDates = await fetchTushareTradingDates(dates[0]!, end.toISOString().slice(0, 10));
  } catch (error) {
    console.warn("[StockPriceSync] 缺失检查交易日历获取失败，降级为候选日期：", error);
    tradingDates = await getStockDailyPriceTradeDates(dates[0], end.toISOString().slice(0, 10));
    if (tradingDates.length === 0) tradingDates = Array.from(new Set(dates));
  }
  const priceMap = await getLeaderCandidateDailyPriceMap();
  const requirements = buildMissingStockPriceRequirements(records, new Set(priceMap.keys()), tradingDates, 5);
  const unique = new Map<string, MissingStockPriceRequirement>();
  for (const item of requirements) unique.set(`${item.stockCode}::${item.signalDate}`, item);
  return Array.from(unique.values()).sort((left, right) => left.signalDate.localeCompare(right.signalDate) || left.stockCode.localeCompare(right.stockCode));
}

export async function syncMissingStockPrices(filter?: { stockCode?: string; signalDate?: string }): Promise<{ mode: "manual"; targetTradingDates: number; requestedStockDatePairs: number; savedPriceRows: number; missingPricePairs: number; failedDates: string[]; dates: string[] }> {
  const requirements = await getMissingStockPriceRequirements(filter);
  const byDate = new Map<string, string[]>();
  for (const item of requirements) byDate.set(item.signalDate, Array.from(new Set([...(byDate.get(item.signalDate) ?? []), item.stockCode])));
  const aggregate = { mode: "manual" as const, targetTradingDates: 0, requestedStockDatePairs: 0, savedPriceRows: 0, missingPricePairs: 0, failedDates: [] as string[], dates: [] as string[] };
  for (const [signalDate, stockCodes] of Array.from(byDate.entries())) {
    const result = await syncCandidateDailyPricesForDate(signalDate, 5, stockCodes);
    aggregate.targetTradingDates += result.targetTradingDates;
    aggregate.requestedStockDatePairs += result.requestedStockDatePairs;
    aggregate.savedPriceRows += result.savedPriceRows;
    aggregate.missingPricePairs += result.missingPricePairs;
    aggregate.failedDates.push(...result.failedDates);
    aggregate.dates.push(...result.dates);
  }
  return aggregate;
}

export type StockPriceSyncCheckItem = {
  stockCode: string;
  stockName: string;
  limitUpDate: string;
  boardCount: string | null;
  sector: string | null;
  missingDates: string[];
  missingCount: number;
};

export type StockPriceSyncCheck = {
  summary: {
    totalStocks: number;
    fullySynced: number;
    partialSynced: number;
    fullyMissing: number;
    missingPairs: number;
    syncedPairCount: number;
    calendarAvailable: boolean;
  };
  items: StockPriceSyncCheckItem[];
};

/**
 * 检查各涨停记录（去重股票+日期）的信号日及后续交易日行情是否已同步。
 * 优先使用 Tushare 交易日历计算后续交易日，日历不可用时降级为仅检查信号日本身。
 */
export async function checkStockPriceSync(futureTradingDayCount = 10): Promise<StockPriceSyncCheck> {
  const records = await getLimitUpRecordsForSyncCheck();
  const pricePairs = await getStockDailyPricePairs();
  const emptySummary = {
    totalStocks: 0,
    fullySynced: 0,
    partialSynced: 0,
    fullyMissing: 0,
    missingPairs: 0,
    syncedPairCount: pricePairs.size,
    calendarAvailable: false,
  };
  if (records.length === 0) return { summary: emptySummary, items: [] };

  let tradingDates: string[] = [];
  let calendarAvailable = false;
  const recordDates = Array.from(new Set(records.map((record) => record.limitUpDate))).sort((left, right) => left.localeCompare(right));
  const endDate = new Date(`${recordDates[recordDates.length - 1]}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 21);
  try {
    tradingDates = await fetchTushareTradingDates(recordDates[0], endDate.toISOString().slice(0, 10));
    calendarAvailable = true;
  } catch (error) {
    console.warn("[StockPriceSync] 交易日历获取失败，行情检查降级为仅信号日：", error);
    tradingDates = recordDates;
  }
  const tradingIndex = new Map(tradingDates.map((date, index) => [date, index]));

  const items: StockPriceSyncCheckItem[] = records.map((record) => {
    const requiredDates = new Set<string>([record.limitUpDate]);
    const signalIndex = tradingIndex.get(record.limitUpDate);
    if (signalIndex !== undefined) {
      for (let offset = 1; offset <= futureTradingDayCount; offset += 1) {
        const date = tradingDates[signalIndex + offset];
        if (date) requiredDates.add(date);
      }
    }
    const missingDates = Array.from(requiredDates)
      .filter((date) => !pricePairs.has(`${record.stockCode}|${date}`))
      .sort((left, right) => left.localeCompare(right));
    return {
      stockCode: record.stockCode,
      stockName: record.stockName,
      limitUpDate: record.limitUpDate,
      boardCount: record.boardCount,
      sector: record.sector,
      missingDates,
      missingCount: missingDates.length,
    };
  });

  items.sort((left, right) =>
    right.missingCount - left.missingCount ||
    right.limitUpDate.localeCompare(left.limitUpDate) ||
    left.stockCode.localeCompare(right.stockCode)
  );

  const fullySynced = items.filter((item) => item.missingCount === 0).length;
  const fullyMissing = items.filter((item) => item.missingDates.includes(item.limitUpDate)).length;
  const partialSynced = items.length - fullySynced - fullyMissing;

  return {
    summary: {
      totalStocks: items.length,
      fullySynced,
      partialSynced,
      fullyMissing,
      missingPairs: items.reduce((total, item) => total + item.missingCount, 0),
      syncedPairCount: pricePairs.size,
      calendarAvailable,
    },
    items,
  };
}
