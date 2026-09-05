import {
  getLimitUpRecordsForStockPriceSync,
  getLimitUpRecordsForStockPriceSyncByDate,
  getLeaderCandidateDailyPriceMap,
  getStockDailyPriceTradeDates,
  getLimitUpRecordsForSyncCheck,
  getStockDailyPricePairs,
  upsertStockDailyPrices,
  getStockSuspensionWindows,
  expandSuspendedDatesByStock,
  upsertSuspensionWindows,
  type StockDailyPriceUpsert,
} from "./db";
import { fetchTushareDailyPricesByDate, fetchTushareTradingDates, fetchTushareStockTradeDates, isTushareRateLimitError } from "./tushare";
import { toCanonicalBar, validateMarketBar, type RawDailyPriceRow } from "./data";

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

// ---------------------------------------------------------------------------
// 生产入库数据质量路径（P1-F3）：
//   External Raw Row → toCanonicalBar（canonical adapter）→ validateMarketBar（三态校验）
//     → StockDailyPriceUpsert（仅 VALID / 可写入的 WARNING）
// 铁律：
//   - INVALID 行（OHLC 矛盾、负 volume/amount、非正价格等）绝不进入正常入库；
//   - WARNING 行按既有业务要求可入库，但必须返回质量信息（qualityIssues）供上层留痕/告警；
//   - 缺失数值字段保持 null（禁止 String(undefined) === "undefined" / String(null) === "null"），
//     DB 非空列（open/close/preClose）缺失视为不可持久化，一并拒写并计数。
// ---------------------------------------------------------------------------

/** 单行质量留痕信息（provenance）。 */
export interface ValidatedPriceQualityIssue {
  stockCode: string;
  tradeDate: string;
  status: "VALID" | "WARNING" | "INVALID" | "UNPERSISTABLE";
  codes: string[];
}

/** 生产入库转换结果。 */
export interface ValidatedPriceUpsertResult {
  /** 通过校验且可写入（open/close/preClose 均存在以匹配 DB NOT NULL）的 upsert 行。 */
  rows: StockDailyPriceUpsert[];
  /** 被校验为 INVALID 而拒绝写入的行数。 */
  invalidCount: number;
  /** 校验通过但因 open/close/preClose 缺失（DB NOT NULL 列）无法持久化的行数。 */
  unpersistableCount: number;
  /** 质量留痕：WARNING 放行行 + INVALID/不可持久化拒绝行（供日志与审计）。 */
  qualityIssues: ValidatedPriceQualityIssue[];
}

/** DB 中 NOT NULL 的价格列：任缺其一即无法按现有 schema 入库。 */
const REQUIRED_PERSISTENCE_PRICE_FIELDS = ["open", "close", "preClose"] as const;

/** 把外部行情行（Tushare / DB 读取）经 canonical adapter + validation 后转换为可入库行。 */
export function toValidatedStockDailyPriceUpserts(
  priceRows: ReadonlyArray<RawDailyPriceRow>,
  requestedCodes: ReadonlySet<string>,
): ValidatedPriceUpsertResult {
  const rows: StockDailyPriceUpsert[] = [];
  const qualityIssues: ValidatedPriceQualityIssue[] = [];
  let invalidCount = 0;
  let unpersistableCount = 0;

  for (const price of priceRows) {
    if (!requestedCodes.has(price.stockCode)) continue;
    const bar = toCanonicalBar(price);
    const validation = validateMarketBar(bar);
    const status = validation.status;
    if (status === "INVALID") {
      invalidCount += 1;
      qualityIssues.push({
        stockCode: bar.symbol,
        tradeDate: bar.timestamp,
        status: "INVALID",
        codes: validation.issues.map((issue) => issue.code),
      });
      continue;
    }
    // NOT NULL 列缺失 → 无法按现有 schema 持久化（不能把 null 写成 "null" 字符串）。
    const missingRequired = REQUIRED_PERSISTENCE_PRICE_FIELDS.some((field) => bar[field] === null || !Number.isFinite(bar[field]!));
    if (missingRequired) {
      unpersistableCount += 1;
      qualityIssues.push({
        stockCode: bar.symbol,
        tradeDate: bar.timestamp,
        status: "UNPERSISTABLE",
        codes: ["REQUIRED_PRICE_MISSING"],
      });
      continue;
    }
    // 数值 → 字符串写库（DB 列 varchar）；可空字段缺失保留 null（数据库 null），
    // 绝不产生 "undefined"/"null" 字面量。
    const text = (value: number | null | undefined): string | null =>
      value === null || value === undefined || !Number.isFinite(value) ? null : String(value);
    rows.push({
      stockCode: bar.symbol,
      tradeDate: bar.timestamp,
      openPrice: text(bar.open)!,
      closePrice: text(bar.close)!,
      highPrice: text(bar.high),
      lowPrice: text(bar.low),
      amount: text(bar.amount),
      volume: text(bar.volume),
      preClosePrice: text(bar.preClose)!,
      source: "tushare",
    });
    if (status === "WARNING") {
      qualityIssues.push({
        stockCode: bar.symbol,
        tradeDate: bar.timestamp,
        status: "WARNING",
        codes: validation.issues.map((issue) => issue.code),
      });
    }
  }

  return { rows, invalidCount, unpersistableCount, qualityIssues };
}

/** 把一条质量留痕转成可读日志（相同 stock-date 聚合 code）。 */
export function formatValidatedPriceQualityIssue(issue: ValidatedPriceQualityIssue): string {
  return `[${issue.status}] ${issue.stockCode} ${issue.tradeDate}: ${issue.codes.join(",")}`;
}

/**
 * 观察窗口（信号日 + N 个可交易日）的交易日历终点缓冲，单位自然日。
 * 涨停后紧跟停牌的股票，其可交易观察日会随停牌时长向后顺延；若日历终点只留 21 自然日，
 * 长停牌会把第 N 个可交易日推出日历窗口而被截断，导致复牌后尾部交易日漏同步。
 * 取 90 自然日（约 3 个月）覆盖 A 股重组停牌上限，退市/永久停牌则由观察窗口自然中断（数不满即 break）。
 */
const OBSERVATION_WINDOW_CALENDAR_PADDING_DAYS = 90;

/** 退市/长期停牌的"永久无行情"结束日：用远超正常交易区间的日期表示，供停牌窗口覆盖到任意未来交易日。 */
export const PERMANENT_SUSPENSION_END = "9999-12-31";

/** 末笔成交日之后连续无成交的市场交易日达到该阈值，即判定为退市/长期停牌（而非近几日数据未更新）。 */
const TRAILING_SUSPENSION_MIN_TRADING_DAYS = 5;

/**
 * 对每条涨停记录同步信号日、下一已记录交易日及下二已记录交易日价格。
 * 后两者即使股票未继续涨停也必须保存，才能评价候选池的 T+1/T+2 溢价和跨日出清。
 * 停牌日（个股无成交）不视为可交易观察日，自动跳过，观察窗口向后顺延至凑满可交易日数。
 */
export function buildStockPriceSyncTargets(records: StockPriceSyncSourceRecord[], marketTradingDates?: string[], futureTradingDayCount = 10, suspendedDatesByStock?: Map<string, Set<string>>): StockPriceSyncTarget[] {
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
    if (signalIndex === undefined) continue;
    const suspended = suspendedDatesByStock?.get(record.stockCode);
    let addedTradableDays = 0;
    for (let offset = 1; addedTradableDays < futureTradingDayCount; offset += 1) {
      const date = tradingDates[signalIndex + offset];
      if (!date) break;
      if (suspended?.has(date)) continue;
      addTarget(date, record.stockCode);
      addedTradableDays += 1;
    }
  }

  return Array.from(codesByDate.entries())
    .map(([tradeDate, stockCodes]) => ({ tradeDate, stockCodes: Array.from(stockCodes).sort() }))
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

/** 读取停牌窗口并展开为「股票代码 → 停牌交易日集合」。 */
async function loadSuspendedDatesByStock(tradingDates: string[]): Promise<Map<string, Set<string>>> {
  const windows = await getStockSuspensionWindows();
  return expandSuspendedDatesByStock(windows, tradingDates);
}

/** 同步价格表；recent 用于每日盘后补齐近八个已记录交易日，full 用于首次历史回填。两种模式覆盖信号后十个实际交易日。 */
export async function syncCandidateDailyPrices(mode: StockPriceSyncMode): Promise<StockPriceSyncResult> {
  const records = await getLimitUpRecordsForStockPriceSync();
  const recordDates = records.map((record) => record.limitUpDate).sort((left, right) => left.localeCompare(right));
  if (recordDates.length === 0) return { mode, targetTradingDates: 0, requestedStockDatePairs: 0, savedPriceRows: 0, missingPricePairs: 0, failedDates: [], dates: [] };
  const startDate = recordDates[0];
  const endDate = new Date(`${recordDates.at(-1)}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + OBSERVATION_WINDOW_CALENDAR_PADDING_DAYS);
  const calendarEndDate = endDate.toISOString().slice(0, 10);
  let marketTradingDates: string[];
  try {
    marketTradingDates = await fetchTushareTradingDates(startDate, calendarEndDate);
  } catch (error) {
    console.warn("[StockPriceSync] 交易日历获取失败，降级为涨停记录日期：", error);
    marketTradingDates = Array.from(new Set(recordDates));
  }
  const allTargets = buildStockPriceSyncTargets(records, marketTradingDates, 10, await loadSuspendedDatesByStock(marketTradingDates));
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
        // 生产入库必须经过 canonical adapter + validateMarketBar（P1-F3）：
        // INVALID 不写入；WARNING 写入但留下质量信息；缺失字段保持 null 而非 "undefined"/"null"。
        const validated = toValidatedStockDailyPriceUpserts(priceRows, new Set(target.stockCodes));
        for (const issue of validated.qualityIssues) console.warn(`[StockPriceSync] ${formatValidatedPriceQualityIssue(issue)}`);
        const savedCount = await upsertStockDailyPrices(validated.rows);
        return { savedCount, missingCount: Math.max(0, target.stockCodes.length - validated.rows.length), failedDate: null, rateLimited: false };
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
  calendarEnd.setUTCDate(calendarEnd.getUTCDate() + OBSERVATION_WINDOW_CALENDAR_PADDING_DAYS);
  let marketTradingDates: string[];
  try {
    marketTradingDates = await fetchTushareTradingDates(limitUpDate, calendarEnd.toISOString().slice(0, 10));
  } catch (error) {
    console.warn(`[StockPriceSync] ${limitUpDate} 交易日历获取失败，降级为指定日期：`, error);
    marketTradingDates = await getStockDailyPriceTradeDates(limitUpDate, calendarEnd.toISOString().slice(0, 10));
    if (marketTradingDates.length === 0) marketTradingDates = [limitUpDate];
  }

  const targets = buildStockPriceSyncTargets(records, marketTradingDates, futureTradingDayCount, await loadSuspendedDatesByStock(marketTradingDates));
  let savedPriceRows = 0;
  let missingPricePairs = 0;
  let rateLimited = false;
  const failedDates: string[] = [];
  for (let index = 0; index < targets.length && !rateLimited; index += TUSHARE_SYNC_CONCURRENCY) {
    const targetBatch = targets.slice(index, index + TUSHARE_SYNC_CONCURRENCY);
    const batchResults = await Promise.all(targetBatch.map(async (target) => {
      try {
        const priceRows = await fetchTushareDailyPricesByDate(target.tradeDate);
        const validated = toValidatedStockDailyPriceUpserts(priceRows, new Set(target.stockCodes));
        for (const issue of validated.qualityIssues) console.warn(`[StockPriceSync] ${formatValidatedPriceQualityIssue(issue)}`);
        return { savedCount: await upsertStockDailyPrices(validated.rows), missingCount: Math.max(0, target.stockCodes.length - validated.rows.length), failedDate: null, rateLimited: false };
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

export type DateRangeSyncDetail = {
  tradeDate: string;
  requestedCount: number;
  savedCount: number;
  missingCount: number;
  failed: boolean;
};

export type DateRangeSyncResult = {
  startDate: string;
  endDate: string;
  targetTradingDates: number;
  requestedStockDatePairs: number;
  savedPriceRows: number;
  missingPricePairs: number;
  failedDates: string[];
  dates: string[];
  rateLimited: boolean;
  dateDetails: DateRangeSyncDetail[];
};

/**
 * 按日期范围同步行情：只同步 [startDate, endDate] 内的交易日里，涨停记录观察窗口（信号日 + 后续十个可交易日）覆盖到的股票。
 * 支持单日（startDate === endDate）与区间；停牌/退市日自动跳过不空拉。返回每个交易日的成功/失败明细供前端反馈。
 */
export async function syncCandidateDailyPricesForDateRange(startDate: string, endDate: string): Promise<DateRangeSyncResult> {
  const empty = (): DateRangeSyncResult => ({
    startDate,
    endDate,
    targetTradingDates: 0,
    requestedStockDatePairs: 0,
    savedPriceRows: 0,
    missingPricePairs: 0,
    failedDates: [],
    dates: [],
    rateLimited: false,
    dateDetails: [],
  });
  if (startDate > endDate) return empty();
  const records = await getLimitUpRecordsForStockPriceSync();
  if (records.length === 0) return empty();

  const recordDates = records.map((record) => record.limitUpDate).sort((left, right) => left.localeCompare(right));
  // 交易日历需覆盖「最早信号日」到 endDate，确保更早信号日的 T+N 窗口能正确映射到所选范围内的交易日。
  const calendarStart = recordDates[0]! < startDate ? recordDates[0]! : startDate;
  let marketTradingDates: string[];
  try {
    marketTradingDates = await fetchTushareTradingDates(calendarStart, endDate);
  } catch (error) {
    console.warn(`[StockPriceSync] ${startDate}~${endDate} 交易日历获取失败，降级为已同步交易日：`, error);
    marketTradingDates = await getStockDailyPriceTradeDates(calendarStart, endDate);
    if (marketTradingDates.length === 0) marketTradingDates = Array.from(new Set(recordDates));
  }

  const allTargets = buildStockPriceSyncTargets(records, marketTradingDates, 10, await loadSuspendedDatesByStock(marketTradingDates));
  const targets = allTargets.filter((target) => target.tradeDate >= startDate && target.tradeDate <= endDate);

  let savedPriceRows = 0;
  let missingPricePairs = 0;
  let rateLimited = false;
  const failedDates: string[] = [];
  const dateDetails: DateRangeSyncDetail[] = [];

  for (let index = 0; index < targets.length && !rateLimited; index += TUSHARE_SYNC_CONCURRENCY) {
    const targetBatch = targets.slice(index, index + TUSHARE_SYNC_CONCURRENCY);
    const batchResults = await Promise.all(targetBatch.map(async (target) => {
      try {
        const priceRows = await fetchTushareDailyPricesByDate(target.tradeDate);
        const validated = toValidatedStockDailyPriceUpserts(priceRows, new Set(target.stockCodes));
        for (const issue of validated.qualityIssues) console.warn(`[StockPriceSync] ${formatValidatedPriceQualityIssue(issue)}`);
        const savedCount = await upsertStockDailyPrices(validated.rows);
        return { tradeDate: target.tradeDate, requestedCount: target.stockCodes.length, savedCount, missingCount: Math.max(0, target.stockCodes.length - validated.rows.length), failed: false, rateLimited: false };
      } catch (error) {
        const rateLimitedHit = isTushareRateLimitError(error);
        console.warn(`[StockPriceSync] 按日期范围同步跳过 ${target.tradeDate}：`, error);
        return { tradeDate: target.tradeDate, requestedCount: target.stockCodes.length, savedCount: 0, missingCount: target.stockCodes.length, failed: true, rateLimited: rateLimitedHit };
      }
    }));

    for (const batchResult of batchResults) {
      savedPriceRows += batchResult.savedCount;
      missingPricePairs += batchResult.missingCount;
      if (batchResult.failed) failedDates.push(batchResult.tradeDate);
      if (batchResult.rateLimited) rateLimited = true;
      dateDetails.push({
        tradeDate: batchResult.tradeDate,
        requestedCount: batchResult.requestedCount,
        savedCount: batchResult.savedCount,
        missingCount: batchResult.missingCount,
        failed: batchResult.failed,
      });
    }
  }

  return {
    startDate,
    endDate,
    targetTradingDates: targets.length,
    requestedStockDatePairs: targets.reduce((total, target) => total + target.stockCodes.length, 0),
    savedPriceRows,
    missingPricePairs,
    failedDates,
    dates: targets.map((target) => target.tradeDate),
    rateLimited,
    dateDetails: dateDetails.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate)),
  };
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
  calendarEnd.setUTCDate(calendarEnd.getUTCDate() + OBSERVATION_WINDOW_CALENDAR_PADDING_DAYS);
  let marketTradingDates: string[];
  try {
    marketTradingDates = await fetchTushareTradingDates(startDate, calendarEnd.toISOString().slice(0, 10));
  } catch (error) {
    console.warn(`[StockPriceSync] 上传补全交易日历获取失败，降级为候选日期：`, error);
    marketTradingDates = await getStockDailyPriceTradeDates(startDate, calendarEnd.toISOString().slice(0, 10));
    if (marketTradingDates.length === 0) marketTradingDates = Array.from(new Set(selectedRecords.map((record) => record.limitUpDate))).sort();
  }
  const targets = buildStockPriceSyncTargets(selectedRecords, marketTradingDates, 5, await loadSuspendedDatesByStock(marketTradingDates));
  let savedPriceRows = 0;
  let missingPricePairs = 0;
  const failedDates: string[] = [];
  for (let index = 0; index < targets.length; index += TUSHARE_SYNC_CONCURRENCY) {
    const batchResults = await Promise.all(targets.slice(index, index + TUSHARE_SYNC_CONCURRENCY).map(async (target) => {
      try {
        const requestedCodes = new Set(target.stockCodes);
        const validated = toValidatedStockDailyPriceUpserts(await fetchTushareDailyPricesByDate(target.tradeDate), requestedCodes);
        for (const issue of validated.qualityIssues) console.warn(`[StockPriceSync] ${formatValidatedPriceQualityIssue(issue)}`);
        return { savedCount: await upsertStockDailyPrices(validated.rows), missingCount: Math.max(0, target.stockCodes.length - validated.rows.length), failedDate: null as string | null };
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
  end.setUTCDate(end.getUTCDate() + OBSERVATION_WINDOW_CALENDAR_PADDING_DAYS);
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
  /** 观察窗口内落在停牌区间的交易日（个股无成交，非同步缺陷）。 */
  suspendedDates: string[];
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
    /** 停牌导致的"无行情"日数（不计入 missingPairs，仅作提示）。 */
    suspendedPairs: number;
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
    suspendedPairs: 0,
  };
  if (records.length === 0) return { summary: emptySummary, items: [] };

  let tradingDates: string[] = [];
  let calendarAvailable = false;
  const recordDates = Array.from(new Set(records.map((record) => record.limitUpDate))).sort((left, right) => left.localeCompare(right));
  const endDate = new Date(`${recordDates[recordDates.length - 1]}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + OBSERVATION_WINDOW_CALENDAR_PADDING_DAYS);
  try {
    tradingDates = await fetchTushareTradingDates(recordDates[0], endDate.toISOString().slice(0, 10));
    calendarAvailable = true;
  } catch (error) {
    console.warn("[StockPriceSync] 交易日历获取失败，行情检查降级为仅信号日：", error);
    tradingDates = recordDates;
  }
  const tradingIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const suspendedDatesByStock = await loadSuspendedDatesByStock(tradingDates);

  const items: StockPriceSyncCheckItem[] = records.map((record) => {
    const signalIndex = tradingIndex.get(record.limitUpDate);
    const suspended = suspendedDatesByStock.get(record.stockCode);
    // 观察窗口 = 信号日 + 后续 futureTradingDayCount 个可交易（非停牌）市场交易日。
    const requiredDates = new Set<string>([record.limitUpDate]);
    if (signalIndex !== undefined) {
      let addedTradable = 0;
      for (let offset = 1; addedTradable < futureTradingDayCount; offset += 1) {
        const date = tradingDates[signalIndex + offset];
        if (!date) break;
        if (suspended?.has(date)) continue;
        requiredDates.add(date);
        addedTradable += 1;
      }
    }
    // 朴素窗口 = 信号日 + 后续 futureTradingDayCount 个市场交易日，其中的停牌日单独提示（不计缺失）。
    const suspendedDates = signalIndex === undefined
      ? []
      : tradingDates.slice(signalIndex + 1, signalIndex + 1 + futureTradingDayCount)
          .filter((date) => suspended?.has(date))
          .sort((left, right) => left.localeCompare(right));
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
      suspendedDates,
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
  const suspendedPairs = items.reduce((total, item) => total + item.suspendedDates.length, 0);

  return {
    summary: {
      totalStocks: items.length,
      fullySynced,
      partialSynced,
      fullyMissing,
      missingPairs: items.reduce((total, item) => total + item.missingCount, 0),
      syncedPairCount: pricePairs.size,
      calendarAvailable,
      suspendedPairs,
    },
    items,
  };
}

export type StockSuspensionInference = {
  stockCode: string;
  windows: Array<{ startDate: string; endDate: string; tradingDayCount: number }>;
  tradedDates: number;
  invalidCode?: boolean;
  /** 末笔成交日之后市场仍持续无该股成交 → 退市/长期停牌（窗口 endDate 为永久日期）。 */
  trailing?: boolean;
};

/**
 * 用 Tushare 个股日线反推单只股票的停牌窗口（市场交易日 − 该股实际成交日），并落库为
 * source=tushare-daily-infer。区间至少覆盖给定的 startDate..endDate，跨期连续停牌会自动合并。
 * 返回每只股票推断出的窗口，供前端展示核查结果。
 */
export async function inferStockSuspensionWindows(
  stockCodes: string[],
  startDate: string,
  endDate: string,
): Promise<StockSuspensionInference[]> {
  const marketTradingDates = await fetchTushareTradingDates(startDate, endDate);
  const results: StockSuspensionInference[] = [];

  for (const stockCode of stockCodes) {
    let tradedDates: string[];
    try {
      tradedDates = await fetchTushareStockTradeDates(stockCode, startDate, endDate);
    } catch (error) {
      if (isTushareRateLimitError(error)) throw error;
      // 代码无效/退市等无法取到日线：不做停牌落库，交由调用方按 invalidCode 处理。
      results.push({ stockCode, windows: [], tradedDates: 0, invalidCode: true });
      continue;
    }
    if (tradedDates.length === 0) {
      results.push({ stockCode, windows: [], tradedDates: 0, invalidCode: true });
      continue;
    }
    const tradedSet = new Set(tradedDates);
    const missing = marketTradingDates.filter((date) => !tradedSet.has(date) && date >= tradedDates[0]! && date <= tradedDates.at(-1)!);
    // 连续缺失段 → 停牌窗口（含交易日计数）
    const rawWindows: Array<{ startDate: string; endDate: string }> = [];
    for (const date of missing) {
      const last = rawWindows.at(-1);
      if (last && marketTradingDates.indexOf(date) === marketTradingDates.indexOf(last.endDate) + 1) {
        last.endDate = date;
      } else {
        rawWindows.push({ startDate: date, endDate: date });
      }
    }
    const windows: Array<{ startDate: string; endDate: string; tradingDayCount: number }> = rawWindows.map(({ startDate, endDate }) => ({
      startDate,
      endDate,
      tradingDayCount: marketTradingDates.filter((d) => d >= startDate && d <= endDate).length,
    }));

    // 尾部缺失识别：末笔成交日之后市场仍持续无该股成交 → 退市或长期停牌（永久无行情）。
    const lastTraded = tradedDates.at(-1)!;
    const trailingDates = marketTradingDates.filter((date) => date > lastTraded);
    const trailing = trailingDates.length >= TRAILING_SUSPENSION_MIN_TRADING_DAYS;
    if (trailing) {
      windows.push({
        startDate: trailingDates[0]!,
        endDate: PERMANENT_SUSPENSION_END,
        tradingDayCount: trailingDates.length,
      });
    }

    if (windows.length > 0) {
      await upsertSuspensionWindows(windows.map(({ startDate, endDate }) => ({
        stockCode,
        startDate,
        endDate,
        source: "tushare-daily-infer" as const,
        note: endDate === PERMANENT_SUSPENSION_END ? `退市：末笔成交 ${lastTraded} 后摘牌无行情` : null,
      })));
    }
    results.push({ stockCode, windows, tradedDates: tradedDates.length, trailing: trailing || undefined });
  }
  return results;
}
