import { eq, desc, like, or, sql, gte, count, and, inArray, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { lte } from "drizzle-orm";
import { normalizeStockCode } from "./stockIdentity";
import type { RawDailyPriceRow } from "./data";
import { runLeaderCandidateResearchReport, runLeaderCandidateStrategyBacktest } from "./leaderCandidateStrategyBacktest";
import { 
  InsertUser, 
  users, 
  limitUpRecords, 
  InsertLimitUpRecord, 
  LimitUpRecord,
  uploadedImages,
  InsertUploadedImage,
  UploadedImage,
  stockWatchlist,
  InsertStockWatchlist,
  StockWatchlist,
  marketData,
  InsertMarketData,
  MarketData,
  stockDailyPrices,
  InsertStockDailyPrice,
  sentimentAlerts,
  InsertSentimentAlert,
  SentimentAlert,
  operationLogs,
  InsertOperationLog,
  OperationLog,
  stockSuspensionWindows,
  InsertStockSuspensionWindow,
  backtestRuns,
  InsertBacktestRun,
  BacktestRun,
  paperTradingRuns,
  InsertPaperTradingRun,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { normalizeLimitUpTime } from '../shared/limitUpTime';
import { normalizeSectorName } from '../shared/stockDataNormalization';
import {
  buildLeaderCandidates,
  buildLeaderCandidatesForDate,
  buildLeaderCandidateDailyPriceMap,
  type LeaderCandidateBacktestContext,
  type LeaderCandidateBacktestOptions,
  type LeaderCandidateBacktestResult,
  type LeaderCandidateDailyPrice,
  type LeaderCandidateDailyPriceCoverage,
  type LeaderCandidateDailyPriceRow,
  type LeaderCandidateSourceRecord,
} from './leaderCandidates';
import { TTLCache, stableHash } from './backtestCache';
import { buildSentimentCycleAnalysis } from './sentimentCycle';
import { parseStoredMarketYi } from './marketFactors';
import { runMonkeyBenchmark, runCostSensitivity } from './overfittingGuard';
import {
  advancePaperTradingDay,
  buildForwardPreparedBuys,
  buildPaperTradingSummary,
  createInitialPaperTradingState,
  type PaperTradingState,
  type PaperTradingStrategyKey,
  type PaperTradingSummary,
} from './paperTrading';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ==================== User Functions ====================

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ==================== Limit Up Records Functions ====================

function normalizeLimitUpRecordTime(record: InsertLimitUpRecord): InsertLimitUpRecord {
  if (record.limitUpTime === undefined) return record;
  const normalized = normalizeLimitUpTime(record.limitUpTime);
  if (record.limitUpTime && !normalized) {
    throw new Error(`涨停时间格式无效：${record.limitUpTime}，应为HH:MM或HH:MM:SS`);
  }
  return { ...record, limitUpTime: normalized };
}

/** 创建涨停记录 */
export async function createLimitUpRecord(record: InsertLimitUpRecord): Promise<LimitUpRecord | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(limitUpRecords).values(normalizeLimitUpRecordTime(record));
  const insertId = result[0].insertId;
  
  const [newRecord] = await db.select().from(limitUpRecords).where(eq(limitUpRecords.id, insertId));
  return newRecord || null;
}

/** 批量创建涨停记录（分批插入，每批最多100条） */
export async function createLimitUpRecordsBatch(records: InsertLimitUpRecord[]): Promise<number> {
  const db = await getDb();
  if (!db || records.length === 0) return 0;

  // 分批插入，每批最多100条
  const BATCH_SIZE = 100;
  let totalAffected = 0;
  
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map(normalizeLimitUpRecordTime);
    const result = await db.insert(limitUpRecords).values(batch);
    totalAffected += result[0].affectedRows;
  }
  
  return totalAffected;
}

/** 获取所有涨停记录，按日期降序 */
export async function getAllLimitUpRecords(): Promise<LimitUpRecord[]> {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(limitUpRecords).orderBy(desc(limitUpRecords.limitUpDate), limitUpRecords.limitUpTime);
}

/** 按日期获取涨停记录 */
export async function getLimitUpRecordsByDate(date: string): Promise<LimitUpRecord[]> {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(limitUpRecords)
    .where(eq(limitUpRecords.limitUpDate, date))
    .orderBy(limitUpRecords.limitUpTime);
}

/** 搜索股票涨停记录 */
export async function searchLimitUpRecords(query: string): Promise<LimitUpRecord[]> {
  const db = await getDb();
  if (!db) return [];

  const searchPattern = `%${query}%`;
  return await db.select().from(limitUpRecords)
    .where(or(
      like(limitUpRecords.stockCode, searchPattern),
      like(limitUpRecords.stockName, searchPattern)
    ))
    .orderBy(desc(limitUpRecords.limitUpDate));
}

/** 按题材获取涨停记录 */
export async function getLimitUpRecordsBySector(sector: string): Promise<LimitUpRecord[]> {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(limitUpRecords)
    .where(like(limitUpRecords.sector, `%${sector}%`))
    .orderBy(desc(limitUpRecords.limitUpDate));
}

/** 获取每日题材统计 */
export async function getDailySectorStats(date: string): Promise<{ sector: string; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  // 只返回按原始题材聚合的结果，避免把整日股票明细加载到Node内存中。
  // 空题材统一在内存中合并为“其他”，兼容MySQL only_full_group_by模式。
  const rows = await db.select({
    sector: limitUpRecords.sector,
    count: count(),
  })
    .from(limitUpRecords)
    .where(eq(limitUpRecords.limitUpDate, date))
    .groupBy(limitUpRecords.sector);

  const sectorCounts = new Map<string, number>();
  for (const row of rows) {
    const sector = normalizeSectorName(row.sector);
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + Number(row.count));
  }

  return Array.from(sectorCounts, ([sector, sectorCount]) => ({ sector, count: sectorCount }))
    .sort((a, b) => {
      if (a.sector === '其他') return 1;
      if (b.sector === '其他') return -1;
      return b.count - a.count;
    });
}

/** 获取所有日期列表 */
export async function getDistinctDates(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.selectDistinct({ date: limitUpRecords.limitUpDate })
    .from(limitUpRecords)
    .orderBy(desc(limitUpRecords.limitUpDate));

  return result.map(r => r.date);
}

/** 获取每日涨停数量统计 */
export async function getDailyLimitUpStats(): Promise<{ date: string; count: number }[]> {
  const db = await getDb();
  if (!db) return [];

  // 使用SQL GROUP BY进行聚合，避免加载全表数据
  const result = await db.select({
    date: limitUpRecords.limitUpDate,
    count: count(),
  })
    .from(limitUpRecords)
    .groupBy(limitUpRecords.limitUpDate)
    .orderBy(limitUpRecords.limitUpDate);

  return result as { date: string; count: number }[];
}

/** 获取每日题材分布统计（迕30天） */
export async function getDailySectorDistribution(): Promise<{ date: string; sectors: { sector: string; count: number }[] }[]> {
  const db = await getDb();
  if (!db) return [];

  // 计算30天前的日期
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  const records = await db.select().from(limitUpRecords)
    .where(gte(limitUpRecords.limitUpDate, thirtyDaysAgoStr))
    .orderBy(desc(limitUpRecords.limitUpDate));
  
  // 按日期和题材统计
  const dateMap = new Map<string, Map<string, number>>();
  for (const record of records) {
    const date = record.limitUpDate;
    const sector = normalizeSectorName(record.sector);
    
    if (!dateMap.has(date)) {
      dateMap.set(date, new Map());
    }
    const sectorMap = dateMap.get(date)!;
    sectorMap.set(sector, (sectorMap.get(sector) || 0) + 1);
  }

  return Array.from(dateMap.entries())
    .map(([date, sectorMap]) => ({
      date,
      sectors: Array.from(sectorMap.entries())
        .map(([sector, count]) => ({ sector, count }))
        .sort((a, b) => {
          if (a.sector === '其他') return 1;
          if (b.sector === '其他') return -1;
          return b.count - a.count;
        })
    }))
    .sort((a, b) => b.date.localeCompare(a.date)); // 按日期降序
}

/** 更新涨停记录 */
export async function updateLimitUpRecord(id: number, data: Partial<InsertLimitUpRecord>): Promise<LimitUpRecord | null> {
  const db = await getDb();
  if (!db) return null;

  const normalizedData = { ...data };
  if (data.limitUpTime !== undefined) {
    const normalized = normalizeLimitUpTime(data.limitUpTime);
    if (data.limitUpTime && !normalized) {
      throw new Error(`涨停时间格式无效：${data.limitUpTime}，应为HH:MM或HH:MM:SS`);
    }
    normalizedData.limitUpTime = normalized;
  }

  await db.update(limitUpRecords).set(normalizedData).where(eq(limitUpRecords.id, id));
  
  const [updated] = await db.select().from(limitUpRecords).where(eq(limitUpRecords.id, id));
  return updated || null;
}

/** 删除涨停记录 */
export async function deleteLimitUpRecord(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db.delete(limitUpRecords).where(eq(limitUpRecords.id, id));
  return result[0].affectedRows > 0;
}

// ==================== Uploaded Images Functions ====================

/** 创建图片上传记录 */
export async function createUploadedImage(image: InsertUploadedImage): Promise<UploadedImage | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(uploadedImages).values(image);
  const insertId = result[0].insertId;
  
  const [newImage] = await db.select().from(uploadedImages).where(eq(uploadedImages.id, insertId));
  return newImage || null;
}

/** 更新图片状态 */
export async function updateImageStatus(id: number, status: 'pending' | 'processing' | 'completed' | 'failed'): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.update(uploadedImages).set({ status }).where(eq(uploadedImages.id, id));
}

/** 获取所有上传的图片 */
export async function getAllUploadedImages(): Promise<UploadedImage[]> {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(uploadedImages).orderBy(desc(uploadedImages.createdAt));
}

// ==================== Operation Log Functions ====================

export type OperationLogType = 'image_recognition' | 'date_refresh';
export type OperationLogStatus = 'processing' | 'success' | 'empty' | 'failed';

/** 创建操作日志。日志属于当前操作者，查询时不会跨用户暴露。 */
export async function createOperationLog(log: InsertOperationLog): Promise<OperationLog | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(operationLogs).values(log);
  const insertId = result[0].insertId;
  const [newLog] = await db.select().from(operationLogs).where(eq(operationLogs.id, insertId));
  return newLog || null;
}

/** 更新操作日志的最终状态和结果字段。 */
export async function updateOperationLog(
  id: number,
  changes: Partial<Pick<InsertOperationLog, 'status' | 'effectiveDate' | 'recognizedCount' | 'refreshedCount' | 'message'>>,
): Promise<OperationLog | null> {
  const db = await getDb();
  if (!db) return null;

  await db.update(operationLogs)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(operationLogs.id, id));
  const [updatedLog] = await db.select().from(operationLogs).where(eq(operationLogs.id, id));
  return updatedLog || null;
}

/** 获取当前用户的操作日志，支持类型、状态和日期筛选。 */
export async function getOperationLogById(id: number, userId: number): Promise<OperationLog | null> {
  const db = await getDb();
  if (!db) return null;

  const [log] = await db.select().from(operationLogs)
    .where(and(eq(operationLogs.id, id), eq(operationLogs.createdBy, userId)))
    .limit(1);
  return log || null;
}

export async function getOperationLogs(
  userId: number,
  filters?: {
    operationType?: OperationLogType;
    status?: OperationLogStatus;
    date?: string;
    limit?: number;
  },
): Promise<OperationLog[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(operationLogs.createdBy, userId)];
  if (filters?.operationType) conditions.push(eq(operationLogs.operationType, filters.operationType));
  if (filters?.status) conditions.push(eq(operationLogs.status, filters.status));
  if (filters?.date) conditions.push(eq(operationLogs.requestedDate, filters.date));

  const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 200);
  return await db.select().from(operationLogs)
    .where(and(...conditions))
    .orderBy(desc(operationLogs.createdAt))
    .limit(limit);
}

// ==================== Stock Watchlist Functions ====================

/** 添加股票到关注列表 */
export async function addToWatchlist(userId: number, stockCode: string, stockName: string, watchType: 'normal' | 'important' = 'normal', note?: string): Promise<StockWatchlist | null> {
  const db = await getDb();
  if (!db) return null;

  // 检查是否已经关注
  const [existing] = await db.select().from(stockWatchlist)
    .where(sql`${stockWatchlist.userId} = ${userId} AND ${stockWatchlist.stockCode} = ${stockCode}`);
  
  if (existing) {
    // 如果已存在，更新关注类型和备注
    await db.update(stockWatchlist)
      .set({ watchType, note, updatedAt: new Date() })
      .where(eq(stockWatchlist.id, existing.id));
    
    const [updated] = await db.select().from(stockWatchlist).where(eq(stockWatchlist.id, existing.id));
    return updated || null;
  }

  // 新增关注
  const result = await db.insert(stockWatchlist).values({
    userId,
    stockCode,
    stockName,
    watchType,
    note,
  });
  
  const insertId = result[0].insertId;
  const [newWatch] = await db.select().from(stockWatchlist).where(eq(stockWatchlist.id, insertId));
  return newWatch || null;
}

/** 从关注列表中移除股票 */
export async function removeFromWatchlist(userId: number, stockCode: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db.delete(stockWatchlist)
    .where(sql`${stockWatchlist.userId} = ${userId} AND ${stockWatchlist.stockCode} = ${stockCode}`);
  
  return result[0].affectedRows > 0;
}

/** 获取用户的关注列表 */
export async function getUserWatchlist(userId: number, watchType?: 'normal' | 'important'): Promise<StockWatchlist[]> {
  const db = await getDb();
  if (!db) return [];

  if (watchType) {
    return await db.select().from(stockWatchlist)
      .where(sql`${stockWatchlist.userId} = ${userId} AND ${stockWatchlist.watchType} = ${watchType}`)
      .orderBy(desc(stockWatchlist.updatedAt));
  }

  return await db.select().from(stockWatchlist)
    .where(eq(stockWatchlist.userId, userId))
    .orderBy(desc(stockWatchlist.updatedAt));
}

/** 检查股票是否在关注列表中 */
export async function isStockWatched(userId: number, stockCode: string): Promise<StockWatchlist | null> {
  const db = await getDb();
  if (!db) return null;

  const [watch] = await db.select().from(stockWatchlist)
    .where(sql`${stockWatchlist.userId} = ${userId} AND ${stockWatchlist.stockCode} = ${stockCode}`);
  
  return watch || null;
}

/** 更新关注类型 */
export async function updateWatchType(userId: number, stockCode: string, watchType: 'normal' | 'important'): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db.update(stockWatchlist)
    .set({ watchType, updatedAt: new Date() })
    .where(sql`${stockWatchlist.userId} = ${userId} AND ${stockWatchlist.stockCode} = ${stockCode}`);
  
  return result[0].affectedRows > 0;
}

// ==================== Market Data Functions ====================

/** 添加或更新大盘数据 */
export async function upsertMarketData(data: InsertMarketData): Promise<MarketData | null> {
  const db = await getDb();
  if (!db) return null;

  // 检查是否已存在该日期的数据
  const [existing] = await db.select().from(marketData)
    .where(eq(marketData.dataDate, data.dataDate!));
  
  if (existing) {
    // 更新现有数据
    await db.update(marketData)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(marketData.dataDate, data.dataDate!));
    
    const [updated] = await db.select().from(marketData)
      .where(eq(marketData.dataDate, data.dataDate!));
    return updated || null;
  }

  // 新增数据
  const result = await db.insert(marketData).values(data);
  const insertId = result[0].insertId;
  
  const [newData] = await db.select().from(marketData).where(eq(marketData.id, insertId));
  return newData || null;
}

/** 获取指定日期的大盘数据 */
export async function getMarketDataByDate(date: string): Promise<MarketData | null> {
  const db = await getDb();
  if (!db) return null;

  const [data] = await db.select().from(marketData)
    .where(eq(marketData.dataDate, date));
  
  return data || null;
}

/** 获取所有大盘数据 */
export async function getAllMarketData(): Promise<MarketData[]> {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(marketData)
    .orderBy(desc(marketData.dataDate));
}

/** 回测所需的信号日市场因子原始行；涨停数为项目已录入的limit_up_records逐日记录数。 */
export type LeaderCandidateMarketFactorRow = {
  dataDate: string;
  limitUpCount: number;
  turnover: string | null;
  marginBalance: string | null;
  note: string | null;
};

export async function getLeaderCandidateMarketFactorRows(): Promise<LeaderCandidateMarketFactorRow[]> {
  const db = await getDb();
  if (!db) return [];
  const [limitUpCounts, marketRows] = await Promise.all([
    db.select({
      dataDate: limitUpRecords.limitUpDate,
      limitUpCount: count(),
    }).from(limitUpRecords).groupBy(limitUpRecords.limitUpDate),
    db.select({
      dataDate: marketData.dataDate,
      turnover: marketData.turnover,
      marginBalance: marketData.marginBalance,
      note: marketData.note,
    }).from(marketData),
  ]);
  const marketByDate = new Map(marketRows.map((row) => [row.dataDate, row]));
  return limitUpCounts.map((row) => {
    const market = marketByDate.get(row.dataDate);
    return {
      dataDate: row.dataDate,
      limitUpCount: Number(row.limitUpCount),
      turnover: market?.turnover ?? null,
      marginBalance: market?.marginBalance ?? null,
      note: market?.note ?? null,
    };
  });
}

function buildVerifiedMarketFactorMap(rows: LeaderCandidateMarketFactorRow[]) {
  return new Map(rows.map((row) => {
    const sourceIsVerified = Boolean(
      row.note?.includes("真实来源：Tushare daily")
      && row.note.includes("上交所/深交所公开两融汇总"),
    );
    return [row.dataDate, {
      limitUpCount: Number.isFinite(row.limitUpCount) && row.limitUpCount > 0 ? row.limitUpCount : null,
      turnoverYi: sourceIsVerified ? parseStoredMarketYi(row.turnover) : null,
      marginBalanceYi: sourceIsVerified ? parseStoredMarketYi(row.marginBalance) : null,
      sourceIsVerified,
    }];
  }));
}

/** 获取最近N天的大盘数据 */
export async function getRecentMarketData(days: number = 30): Promise<MarketData[]> {
  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  return await db.select().from(marketData)
    .where(gte(marketData.dataDate, startDateStr))
    .orderBy(desc(marketData.dataDate));
}

/** 删除大盘数据 */
export async function deleteMarketData(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db.delete(marketData).where(eq(marketData.id, id));
  return result[0].affectedRows > 0;
}

// ==================== Stock Daily Price Functions ====================

export type StockDailyPriceUpsert = Pick<InsertStockDailyPrice, "stockCode" | "tradeDate" | "openPrice" | "closePrice" | "highPrice" | "lowPrice" | "amount" | "volume" | "preClosePrice" | "source">;

/** 为候选池价格同步返回最小涨停记录集合。 */
export async function getLimitUpRecordsForStockPriceSync(): Promise<Array<{ stockCode: string; limitUpDate: string }>> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ stockCode: limitUpRecords.stockCode, limitUpDate: limitUpRecords.limitUpDate })
    .from(limitUpRecords)
    .orderBy(limitUpRecords.limitUpDate);
}

/** 返回指定涨停日期的股票集合，供上传完成后精准同步该日期及后续交易日行情。 */
export async function getLimitUpRecordsForStockPriceSyncByDate(limitUpDate: string): Promise<Array<{ stockCode: string; limitUpDate: string }>> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ stockCode: limitUpRecords.stockCode, limitUpDate: limitUpRecords.limitUpDate })
    .from(limitUpRecords)
    .where(eq(limitUpRecords.limitUpDate, limitUpDate));
}

/** 返回涨停记录去重（股票+日期）后的明细，供行情同步检查页展示名称、板数与题材。 */
export async function getLimitUpRecordsForSyncCheck(): Promise<Array<{
  stockCode: string;
  stockName: string;
  limitUpDate: string;
  boardCount: string | null;
  sector: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    stockCode: limitUpRecords.stockCode,
    stockName: limitUpRecords.stockName,
    limitUpDate: limitUpRecords.limitUpDate,
    boardCount: limitUpRecords.boardCount,
    sector: limitUpRecords.sector,
  }).from(limitUpRecords)
    .orderBy(limitUpRecords.limitUpDate, limitUpRecords.stockCode);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.stockCode}|${row.limitUpDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 返回已同步的股票—交易日组合集合，key 形如 `${stockCode}|${tradeDate}`。 */
export async function getStockDailyPricePairs(): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db.select({
    stockCode: stockDailyPrices.stockCode,
    tradeDate: stockDailyPrices.tradeDate,
  }).from(stockDailyPrices);
  return new Set(rows.map((row) => `${row.stockCode}|${row.tradeDate}`));
}

// ==================== Stock Suspension Window Functions ====================

export type SuspensionWindowInput = {
  stockCode: string;
  startDate: string;
  endDate: string;
  source: "tushare-daily-infer" | "manual";
  note?: string | null;
};

/** 将同一股票同一来源下重叠的停牌区间合并为最小覆盖区间。 */
export function mergeSuspensionWindows(windows: Array<{ startDate: string; endDate: string }>): Array<{ startDate: string; endDate: string }> {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const merged: Array<{ startDate: string; endDate: string }> = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (last && window.startDate <= last.endDate) {
      if (window.endDate > last.endDate) last.endDate = window.endDate;
    } else {
      merged.push({ startDate: window.startDate, endDate: window.endDate });
    }
  }
  return merged;
}

/** 合并重叠停牌窗口并保留各自备注（合并区间时优先保留已有非空备注）。 */
function mergeSuspensionWindowsWithNote(windows: Array<{ startDate: string; endDate: string; note: string | null }>): Array<{ startDate: string; endDate: string; note: string | null }> {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const merged: Array<{ startDate: string; endDate: string; note: string | null }> = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (last && window.startDate <= last.endDate) {
      if (window.endDate > last.endDate) last.endDate = window.endDate;
      if (!last.note && window.note) last.note = window.note;
    } else {
      merged.push({ startDate: window.startDate, endDate: window.endDate, note: window.note });
    }
  }
  return merged;
}

/**
 * 按「股票 + 来源」分组写入停牌窗口：先删除该股票该来源的旧窗口，再写入合并后的窗口，
 * 使推断结果可被幂等覆盖，同时不误删另一来源（如人工标记）的窗口。
 */
export async function upsertSuspensionWindows(rows: SuspensionWindowInput[]): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  const groups = new Map<string, SuspensionWindowInput[]>();
  for (const row of rows) {
    const key = `${row.stockCode}::${row.source}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  let total = 0;
  for (const [key, list] of Array.from(groups.entries())) {
    const [stockCode, source] = key.split("::") as [string, SuspensionWindowInput["source"]];
    const merged = mergeSuspensionWindowsWithNote(list.map(({ startDate, endDate, note }) => ({ startDate, endDate, note: note ?? null })));
    await db.delete(stockSuspensionWindows)
      .where(and(eq(stockSuspensionWindows.stockCode, stockCode), eq(stockSuspensionWindows.source, source)));
    if (merged.length > 0) {
      await db.insert(stockSuspensionWindows).values(merged.map(({ startDate, endDate, note }) => ({
        stockCode,
        startDate,
        endDate,
        source,
        note,
      })));
    }
    total += merged.length;
  }
  return total;
}

/** 读取停牌窗口；可选按股票代码过滤。 */
export async function getStockSuspensionWindows(codes?: string[]): Promise<Array<{ id: number; stockCode: string; startDate: string; endDate: string; source: "tushare-daily-infer" | "manual"; note: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  const query = db.select({
    id: stockSuspensionWindows.id,
    stockCode: stockSuspensionWindows.stockCode,
    startDate: stockSuspensionWindows.startDate,
    endDate: stockSuspensionWindows.endDate,
    source: stockSuspensionWindows.source,
    note: stockSuspensionWindows.note,
  }).from(stockSuspensionWindows);
  const rows = codes && codes.length > 0
    ? await query.where(inArray(stockSuspensionWindows.stockCode, codes)).orderBy(stockSuspensionWindows.stockCode, stockSuspensionWindows.startDate)
    : await query.orderBy(stockSuspensionWindows.stockCode, stockSuspensionWindows.startDate);
  return rows.map((row) => ({
    id: row.id,
    stockCode: row.stockCode,
    startDate: row.startDate,
    endDate: row.endDate,
    source: row.source,
    note: row.note,
  }));
}

/** 删除指定 id 的停牌窗口（供人工撤销）。 */
export async function deleteSuspensionWindow(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.delete(stockSuspensionWindows).where(eq(stockSuspensionWindows.id, id));
  return result[0].affectedRows > 0;
}

/** 将停牌窗口展开为「股票代码 → 停牌交易日集合」，仅保留落在市场交易日历内的日期。 */
export function expandSuspendedDatesByStock(
  windows: Array<{ stockCode: string; startDate: string; endDate: string }>,
  tradingDates: string[],
): Map<string, Set<string>> {
  const byStock = new Map<string, Set<string>>();
  for (const window of windows) {
    const set = byStock.get(window.stockCode) ?? new Set<string>();
    for (const date of tradingDates) {
      if (date >= window.startDate && date <= window.endDate) set.add(date);
    }
    byStock.set(window.stockCode, set);
  }
  return byStock;
}

export type CorrectLimitUpStockIdentityResult =
  | { ok: true; updatedRows: number; dates: string[] }
  | { ok: false; conflicts: Array<{ limitUpDate: string; existingNames: string[] }> };

/**
 * 批量校正涨停记录的名称/代码（按旧代码+旧名称精确定位，避免误伤同代码下的其他股票）。
 * - fromName 必须精确匹配，防止一个代码下混有多只不同股票时误改；
 * - toCode 会自动规范化后缀（6→SH、0/3→SZ、4/8/92→BJ）；
 * - 若新代码在相同涨停日已存在其他记录，返回 conflicts 交由上层提示，不做更新（防重复）。
 */
export async function correctLimitUpStockIdentity(params: {
  fromCode: string;
  fromName: string;
  toCode: string;
  toName: string;
}): Promise<CorrectLimitUpStockIdentityResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("数据库不可用，无法校正");
  }
  const toCode = normalizeStockCode(params.toCode);
  const toName = params.toName.trim();
  if (!toName) throw new Error("股票名称不能为空");

  const targets = await db.select({ id: limitUpRecords.id, limitUpDate: limitUpRecords.limitUpDate })
    .from(limitUpRecords)
    .where(and(eq(limitUpRecords.stockCode, params.fromCode), eq(limitUpRecords.stockName, params.fromName)));
  if (targets.length === 0) {
    throw new Error(`未找到待校正记录：${params.fromCode} ${params.fromName}`);
  }
  const targetIds = targets.map((target) => target.id);
  const dates = Array.from(new Set(targets.map((target) => String(target.limitUpDate))));

  // 冲突检测：目标代码在相同涨停日已有其他记录（非本次待改行）
  const conflicted = await db.select({
    limitUpDate: limitUpRecords.limitUpDate,
    stockName: limitUpRecords.stockName,
  }).from(limitUpRecords)
    .where(and(
      eq(limitUpRecords.stockCode, toCode),
      inArray(limitUpRecords.limitUpDate, dates),
      notInArray(limitUpRecords.id, targetIds),
    ));
  if (conflicted.length > 0) {
    const byDate = new Map<string, string[]>();
    for (const row of conflicted) {
      const key = String(row.limitUpDate);
      const list = byDate.get(key) ?? [];
      list.push(row.stockName ?? "-");
      byDate.set(key, list);
    }
    return {
      ok: false,
      conflicts: Array.from(byDate.entries())
        .sort(([left], [right]) => right.localeCompare(left))
        .map(([limitUpDate, existingNames]) => ({ limitUpDate, existingNames })),
    };
  }

  await db.update(limitUpRecords)
    .set({ stockCode: toCode, stockName: toName })
    .where(inArray(limitUpRecords.id, targetIds));

  return { ok: true, updatedRows: targetIds.length, dates };
}

// ---------------------------------------------------------------------------
// (stockCode, tradeDate) 数据库级唯一约束（P2-F3）
//
// stock_daily_prices 必须以 (stockCode, tradeDate) 唯一：
//   - 迁移/schema 中已声明 uq_stock_daily_price_stock_date；
//   - 若历史库因早期未建约束而存在重复行，直接加唯一索引会失败，因此先清理脏数据
//     （同一股票—交易日保留最小 id 行），再补建约束；
//   - 幂等：仅当约束缺失时才执行清理 + DDL，进程内只执行一次。
// upsertStockDailyPrices 依赖该唯一键做 ON DUPLICATE KEY UPDATE。
// ---------------------------------------------------------------------------

const STOCK_DAILY_PRICE_UNIQUE_INDEX = "uq_stock_daily_price_stock_date";

/** 需要删除的重复行 id（同一 stockCode+tradeDate 只保留最小 id）。纯函数，供 SQL 路径与测试复用。 */
export function duplicateStockDailyPriceIdsToRemove(
  rows: ReadonlyArray<{ id: number; stockCode: string; tradeDate: string }>,
): number[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.stockCode}::${row.tradeDate}`;
    const list = groups.get(key) ?? [];
    list.push(row.id);
    groups.set(key, list);
  }
  const toRemove: number[] = [];
  for (const ids of Array.from(groups.values())) {
    ids.sort((left: number, right: number) => left - right);
    for (const id of ids.slice(1)) toRemove.push(id);
  }
  return toRemove.sort((left: number, right: number) => left - right);
}

let stockDailyUniqueEnsured = false;
let stockDailyUniqueEnsurePromise: Promise<void> | null = null;

/** MySQL/TiDB：唯一索引已存在时的错误（ER_DUP_KEYNAME, 1061）。 */
function isDuplicateIndexNameError(error: unknown): boolean {
  return error instanceof Error && /Duplicate key name|ER_DUP_KEYNAME|already exists/i.test(error.message);
}

/** 需先清理重复数据再建索引的错误（ER_DUP_ENTRY, 1062）。 */
function isDuplicateEntryError(error: unknown): boolean {
  return error instanceof Error && /Duplicate entry|ER_DUP_ENTRY/i.test(error.message);
}

/**
 * 确保 stock_daily_prices 存在 (stockCode, tradeDate) 唯一约束。
 * 流程（幂等）：
 *   1) 尝试创建唯一索引；若已存在（Duplicate key name）→ 完成；
 *   2) 若因历史重复行失败（Duplicate entry）→ 先删除同键中的多余行（保留最小 id），再重试创建。
 * 返回 promise 不 reject（失败降级告警），保证 upsert 主路径不被 DDL 问题阻塞。
 */
function ensureStockDailyPricesUniqueIndex(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<void> {
  if (stockDailyUniqueEnsured) return Promise.resolve();
  if (!stockDailyUniqueEnsurePromise) {
    stockDailyUniqueEnsurePromise = (async () => {
      const createIndex = () => db.execute(sql.raw(
        `CREATE UNIQUE INDEX \`${STOCK_DAILY_PRICE_UNIQUE_INDEX}\` ON \`stock_daily_prices\` (\`stockCode\`, \`tradeDate\`)`,
      ));
      try {
        await createIndex();
      } catch (error) {
        if (isDuplicateIndexNameError(error)) {
          stockDailyUniqueEnsured = true; // 约束已存在
          return;
        }
        if (!isDuplicateEntryError(error)) throw error;
        // 历史脏数据：删除同一 (stockCode, tradeDate) 中 id 较大的重复行，再补建约束。
        await db.execute(sql`
          DELETE \`p1\` FROM \`stock_daily_prices\` AS \`p1\`
          INNER JOIN \`stock_daily_prices\` AS \`p2\`
            ON \`p1\`.\`stockCode\` = \`p2\`.\`stockCode\`
           AND \`p1\`.\`tradeDate\` = \`p2\`.\`tradeDate\`
           AND \`p1\`.\`id\` > \`p2\`.\`id\`
        `);
        await createIndex();
      }
      stockDailyUniqueEnsured = true;
    })().catch((error: unknown) => {
      // DDL 失败（如无权限）不应使 upsert 崩溃：降级并告警，让上层继续。
      stockDailyUniqueEnsurePromise = null;
      console.warn(`[Database] 确保 stock_daily_prices 唯一约束失败：`, error);
    });
  }
  return stockDailyUniqueEnsurePromise;
}

/** 按股票代码和交易日幂等覆盖写入 Tushare 日线价格（依赖 (stockCode, tradeDate) 唯一键）。 */
export async function upsertStockDailyPrices(rows: StockDailyPriceUpsert[]): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  // 惰性确保唯一约束（幂等；失败只告警不阻塞写入，避免数据同步完全中断）。
  await ensureStockDailyPricesUniqueIndex(db);

  const BATCH_SIZE = 500;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    await db.insert(stockDailyPrices).values(batch).onDuplicateKeyUpdate({
      set: {
        openPrice: sql`VALUES(\`openPrice\`)`,
        closePrice: sql`VALUES(\`closePrice\`)`,
        highPrice: sql`VALUES(\`highPrice\`)`,
        lowPrice: sql`VALUES(\`lowPrice\`)`,
        amount: sql`VALUES(\`amount\`)`,
        volume: sql`VALUES(\`volume\`)`,
        preClosePrice: sql`VALUES(\`preClosePrice\`)`,
        source: sql`VALUES(\`source\`)`,
        sourceUpdatedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
  return rows.length;
}

/** 返回本地已存在的实际交易日集合，用于外部交易日历限频时的安全回退。 */
export async function getStockDailyPriceTradeDates(startDate?: string, endDate?: string): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (startDate) conditions.push(gte(stockDailyPrices.tradeDate, startDate));
  if (endDate) conditions.push(lte(stockDailyPrices.tradeDate, endDate));
  const query = db.selectDistinct({ tradeDate: stockDailyPrices.tradeDate }).from(stockDailyPrices);
  const rows = conditions.length > 0 ? await query.where(and(...conditions)).orderBy(stockDailyPrices.tradeDate) : await query.orderBy(stockDailyPrices.tradeDate);
  return rows.map((row) => row.tradeDate);
}

/** stock_daily_prices 全量原始行情行（统一喂给价格映射与 Strategy Engine canonical 层）。 */
async function loadStockDailyPriceRows(): Promise<LeaderCandidateDailyPriceRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    stockCode: stockDailyPrices.stockCode,
    tradeDate: stockDailyPrices.tradeDate,
    openPrice: stockDailyPrices.openPrice,
    closePrice: stockDailyPrices.closePrice,
    highPrice: stockDailyPrices.highPrice,
    lowPrice: stockDailyPrices.lowPrice,
    amount: stockDailyPrices.amount,
    volume: stockDailyPrices.volume,
    preClosePrice: stockDailyPrices.preClosePrice,
  }).from(stockDailyPrices);
  return rows;
}

/** 构造候选池回测所需的股票—交易日价格映射。 */
export async function getLeaderCandidateDailyPriceMap(): Promise<Map<string, LeaderCandidateDailyPrice>> {
  return buildLeaderCandidateDailyPriceMap(await loadStockDailyPriceRows());
}

/** 返回候选回测使用的行情覆盖状态，供研究页面提示高低价与成交额/量的实际回填进度。 */
export async function getLeaderCandidateDailyPriceCoverage(): Promise<LeaderCandidateDailyPriceCoverage> {
  const db = await getDb();
  if (!db) return { rowCount: 0, stockCount: 0, startDate: null, endDate: null, highPriceCount: 0, lowPriceCount: 0, amountCount: 0, volumeCount: 0 };
  const rows = await db.select({
    rowCount: sql<number>`COUNT(*)`,
    stockCount: sql<number>`COUNT(DISTINCT ${stockDailyPrices.stockCode})`,
    startDate: sql<string | null>`MIN(${stockDailyPrices.tradeDate})`,
    endDate: sql<string | null>`MAX(${stockDailyPrices.tradeDate})`,
    highPriceCount: sql<number>`SUM(CASE WHEN ${stockDailyPrices.highPrice} IS NOT NULL THEN 1 ELSE 0 END)`,
    lowPriceCount: sql<number>`SUM(CASE WHEN ${stockDailyPrices.lowPrice} IS NOT NULL THEN 1 ELSE 0 END)`,
    amountCount: sql<number>`SUM(CASE WHEN ${stockDailyPrices.amount} IS NOT NULL THEN 1 ELSE 0 END)`,
    volumeCount: sql<number>`SUM(CASE WHEN ${stockDailyPrices.volume} IS NOT NULL THEN 1 ELSE 0 END)`,
  }).from(stockDailyPrices);
  const row = rows[0];
  return {
    rowCount: Number(row?.rowCount ?? 0),
    stockCount: Number(row?.stockCount ?? 0),
    startDate: row?.startDate ?? null,
    endDate: row?.endDate ?? null,
    highPriceCount: Number(row?.highPriceCount ?? 0),
    lowPriceCount: Number(row?.lowPriceCount ?? 0),
    amountCount: Number(row?.amountCount ?? 0),
    volumeCount: Number(row?.volumeCount ?? 0),
  };
}

/** 获取涨停数与大盘数据的关联统计（最近N天）*/
export async function getLimitUpWithMarketData(days: number = 30): Promise<{
  date: string;
  limitUpCount: number;
  turnover?: string;
  marginBalance?: string;
}[]> {
  const db = await getDb();
  if (!db) return [];

  // 计算N天前的日期
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  // 获取涨停数据
  const limitUpRecordsData = await db.select().from(limitUpRecords)
    .where(gte(limitUpRecords.limitUpDate, startDateStr))
    .orderBy(desc(limitUpRecords.limitUpDate));

  // 按日期统计涨停数
  const dateMap = new Map<string, number>();
  for (const record of limitUpRecordsData) {
    const date = record.limitUpDate;
    dateMap.set(date, (dateMap.get(date) || 0) + 1);
  }

  // 获取大盘数据
  const marketDataList = await db.select().from(marketData)
    .where(gte(marketData.dataDate, startDateStr))
    .orderBy(desc(marketData.dataDate));

  // 按日期构建大盘数据映射
  const marketDataMap = new Map<string, { turnover: string; marginBalance: string }>();
  for (const data of marketDataList) {
    marketDataMap.set(data.dataDate, {
      turnover: data.turnover,
      marginBalance: data.marginBalance,
    });
  }

  // 合并数据，按日期排序
  const result = Array.from(dateMap.entries())
    .map(([date, limitUpCount]) => ({
      date,
      limitUpCount,
      ...marketDataMap.get(date),
    }))
    .sort((a, b) => a.date.localeCompare(b.date)); // 按日期升序

  return result;
}


/** 获取近N天的题材热度统计 */
export async function getSectorHeatmapData(days: number = 30): Promise<{
  sector: string;
  totalCount: number;
  dailyData: { date: string; count: number }[];
}[]> {
  const db = await getDb();
  if (!db) return [];

  // 计算N天前的日期
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  // 获取最近N天的涨停记录
  const records = await db.select().from(limitUpRecords)
    .where(gte(limitUpRecords.limitUpDate, startDateStr))
    .orderBy(desc(limitUpRecords.limitUpDate));

  // 按题材和日期统计
  const sectorMap = new Map<string, Map<string, number>>();
  const sectorTotalMap = new Map<string, number>();

  for (const record of records) {
    const sector = normalizeSectorName(record.sector);
    const date = record.limitUpDate;

    // 统计总数
    sectorTotalMap.set(sector, (sectorTotalMap.get(sector) || 0) + 1);

    // 统计每日数据
    if (!sectorMap.has(sector)) {
      sectorMap.set(sector, new Map());
    }
    const dailyMap = sectorMap.get(sector)!;
    dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
  }

  // 构建结果
  const result = Array.from(sectorMap.entries())
    .map(([sector, dailyMap]) => ({
      sector,
      totalCount: sectorTotalMap.get(sector) || 0,
      dailyData: Array.from(dailyMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => {
      // "其他"始终放在最后
      if (a.sector === '其他') return 1;
      if (b.sector === '其他') return -1;
      // 其他题材按总数降序排列
      return b.totalCount - a.totalCount;
    });

  return result;
}


/**
 * 获取连板梯队统计数据
 * @param date 查询日期（格式：YYYY-MM-DD）
 * @returns 连板梯队分布、趋势、股票列表和情绪指标
 */
export async function getConnectionBoardStats(date: string) {
  const db = await getDb();
  if (!db) return null;

  // 1. 一次性获取所有涨停记录（优化：避免多次数据库查询）
  const allRecords = await db.select().from(limitUpRecords)
    .orderBy(desc(limitUpRecords.limitUpDate));
  
  // 2. 构建股票涨停日期映射：{ stockCode -> Set<date> }
  const stockDatesMap = new Map<string, Set<string>>();
  for (const record of allRecords) {
    if (!stockDatesMap.has(record.stockCode)) {
      stockDatesMap.set(record.stockCode, new Set());
    }
    stockDatesMap.get(record.stockCode)!.add(record.limitUpDate);
  }
  
  // 3. 获取所有交易日期（降序排列）
  const tradingDatesSet = new Set<string>();
  for (const record of allRecords) {
    tradingDatesSet.add(record.limitUpDate);
  }
  const tradingDates = Array.from(tradingDatesSet).sort((a, b) => b.localeCompare(a));
  
  // 4. 辅助函数：在内存中计算某只股票在指定日期的连板数
  const calculateConsecutiveBoards = (stockCode: string, targetDate: string): number => {
    const stockDates = stockDatesMap.get(stockCode);
    if (!stockDates) return 1;
    
    const targetIndex = tradingDates.indexOf(targetDate);
    if (targetIndex === -1) return 1;
    
    let boards = 1;
    // 从目标日期往前查找连续涨停
    for (let i = targetIndex + 1; i < tradingDates.length; i++) {
      const prevDate = tradingDates[i];
      if (stockDates.has(prevDate)) {
        boards++;
      } else {
        break; // 不连续，停止计算
      }
    }
    return boards;
  };

  // 5. 获取指定日期的所有涨停记录
  const records = allRecords.filter(r => r.limitUpDate === date);
  
  // 6. 计算每只股票的连板数
  const stocksWithBoards: Array<{
    stockCode: string;
    stockName: string;
    boards: number;
    sector: string;
    limitUpTime: string;
    connectionDays: string;
  }> = [];

  for (const record of records) {
    const boards = calculateConsecutiveBoards(record.stockCode, date);
    stocksWithBoards.push({
      stockCode: record.stockCode,
      stockName: record.stockName,
      boards,
      sector: normalizeSectorName(record.sector),
      limitUpTime: record.limitUpTime || '',
      connectionDays: `${boards}天${boards}板`,
    });
  }

  // 按板数降序排序
  stocksWithBoards.sort((a, b) => b.boards - a.boards);

  // 7. 统计连板梯队分布
  const boardCountMap = new Map<number, number>();
  for (const stock of stocksWithBoards) {
    boardCountMap.set(stock.boards, (boardCountMap.get(stock.boards) || 0) + 1);
  }

  // 构建分布数据
  const distribution: { boards: number; count: number; label: string }[] = [];
  const sortedBoards = Array.from(boardCountMap.keys()).sort((a, b) => a - b);
  for (const boards of sortedBoards) {
    const count = boardCountMap.get(boards) || 0;
    let label = '';
    if (boards === 1) label = '首板';
    else if (boards >= 7) label = '7板+';
    else label = `${boards}板`;
    
    distribution.push({ boards, count, label });
  }

  // 8. 获取最近7天的连板趋势数据（在内存中计算）
  const trend: { date: string; board1: number; board2: number; board3: number; board4Plus: number }[] = [];
  
  const targetIndex = tradingDates.indexOf(date);
  const recentDates = tradingDates.slice(Math.max(0, targetIndex - 6), targetIndex + 1).reverse();
  
  for (const trendDate of recentDates) {
    const dayRecords = allRecords.filter(r => r.limitUpDate === trendDate);
    
    let board1 = 0, board2 = 0, board3 = 0, board4Plus = 0;
    for (const record of dayRecords) {
      const boards = calculateConsecutiveBoards(record.stockCode, trendDate);
      if (boards === 1) board1++;
      else if (boards === 2) board2++;
      else if (boards === 3) board3++;
      else board4Plus++;
    }
    
    trend.push({ date: trendDate, board1, board2, board3, board4Plus });
  }

  // 9. 计算情绪指标
  const totalLimitUp = stocksWithBoards.length;
  const connectionBoards = stocksWithBoards.filter(s => s.boards >= 2).length;
  const maxBoards = stocksWithBoards.length > 0 ? Math.max(...stocksWithBoards.map(s => s.boards)) : 0;
  const board3Plus = stocksWithBoards.filter(s => s.boards >= 3).length;
  
  // 情绪评分计算公式
  let emotionScore = 0;
  if (totalLimitUp > 0) {
    const connectionRatio = connectionBoards / totalLimitUp;
    const maxBoardScore = Math.min(maxBoards / 10, 1);
    const board3PlusRatio = connectionBoards > 0 ? board3Plus / connectionBoards : 0;
    
    emotionScore = Math.round(
      connectionRatio * 40 + 
      maxBoardScore * 30 + 
      board3PlusRatio * 30
    );
  }

  return {
    distribution,
    trend,
    stocks: stocksWithBoards,
    metrics: {
      totalLimitUp,
      connectionBoards,
      maxBoards,
      emotionScore,
    },
  };
}


// ==================== Sentiment Alert Functions ====================

/**
 * 情绪等级定义
 */
export const EMOTION_LEVELS = {
  EXTREME_COLD: { min: 0, max: 20, label: '极度冰点', color: '#1e40af' },
  COLD: { min: 20, max: 35, label: '冰点', color: '#3b82f6' },
  COOL: { min: 35, max: 45, label: '偏冷', color: '#60a5fa' },
  NEUTRAL: { min: 45, max: 55, label: '中性', color: '#94a3b8' },
  WARM: { min: 55, max: 65, label: '偏暖', color: '#fb923c' },
  HOT: { min: 65, max: 80, label: '亢奋', color: '#f97316' },
  EXTREME_HOT: { min: 80, max: 100, label: '极度亢奋', color: '#dc2626' },
};

/**
 * 获取情绪等级
 */
export function getEmotionLevel(score: number): { label: string; color: string } {
  if (score <= EMOTION_LEVELS.EXTREME_COLD.max) return EMOTION_LEVELS.EXTREME_COLD;
  if (score <= EMOTION_LEVELS.COLD.max) return EMOTION_LEVELS.COLD;
  if (score <= EMOTION_LEVELS.COOL.max) return EMOTION_LEVELS.COOL;
  if (score <= EMOTION_LEVELS.NEUTRAL.max) return EMOTION_LEVELS.NEUTRAL;
  if (score <= EMOTION_LEVELS.WARM.max) return EMOTION_LEVELS.WARM;
  if (score <= EMOTION_LEVELS.HOT.max) return EMOTION_LEVELS.HOT;
  return EMOTION_LEVELS.EXTREME_HOT;
}

/**
 * 检测情绪拐点并生成预警
 * @param currentDate 当前日期
 * @returns 生成的预警（如果有拐点）或null
 */
export async function detectSentimentTurningPoint(currentDate: string): Promise<InsertSentimentAlert | null> {
  const db = await getDb();
  if (!db) return null;

  // 获取当前日期的情绪数据
  const currentStats = await getConnectionBoardStats(currentDate);
  if (!currentStats || currentStats.metrics.totalLimitUp === 0) {
    return null;
  }

  const currentScore = currentStats.metrics.emotionScore;
  const currentLevel = getEmotionLevel(currentScore);

  // 获取最近7天的交易日期（用于获取前一天的数据）
  const allRecords = await db.select().from(limitUpRecords)
    .orderBy(desc(limitUpRecords.limitUpDate));
  
  const tradingDatesSet = new Set<string>();
  for (const record of allRecords) {
    tradingDatesSet.add(record.limitUpDate);
  }
  const tradingDates = Array.from(tradingDatesSet).sort((a, b) => b.localeCompare(a));
  
  const currentIndex = tradingDates.indexOf(currentDate);
  if (currentIndex === -1 || currentIndex >= tradingDates.length - 1) {
    return null; // 没有前一天的数据
  }

  const previousDate = tradingDates[currentIndex + 1];
  const previousStats = await getConnectionBoardStats(previousDate);
  if (!previousStats) {
    return null;
  }

  const previousScore = previousStats.metrics.emotionScore;
  const previousLevel = getEmotionLevel(previousScore);
  const scoreChange = currentScore - previousScore;

  // 检测拐点条件
  let alertType: 'warming' | 'cooling' | 'extreme_hot' | 'extreme_cold' | null = null;
  let title = '';
  let description = '';

  // 1. 极端情绪预警
  if (currentScore >= 80 && previousScore < 80) {
    alertType = 'extreme_hot';
    title = '⚠️ 市场进入极度亢奋区间';
    description = `情绪评分从${previousScore}分升至${currentScore}分，市场进入极度亢奋状态。历史经验表明，极度亢奋后往往伴随回调，建议控制仓位，谨慎追高。`;
  } else if (currentScore <= 20 && previousScore > 20) {
    alertType = 'extreme_cold';
    title = '❄️ 市场进入极度冰点区间';
    description = `情绪评分从${previousScore}分降至${currentScore}分，市场进入极度冰点状态。历史经验表明，极度冰点往往是底部区域，可关注超跌反弹机会。`;
  }
  // 2. 情绪转暖预警（从冰点/偏冷转向中性/偏暖）
  else if (scoreChange >= 15 && previousScore <= 35 && currentScore > 35) {
    alertType = 'warming';
    title = '🔥 市场情绪转暖信号';
    description = `情绪评分从${previousScore}分(${previousLevel.label})升至${currentScore}分(${currentLevel.label})，涨幅${scoreChange}分。连板股数从${previousStats.metrics.connectionBoards}只增至${currentStats.metrics.connectionBoards}只，市场做多情绪回升，可适当加仓。`;
  }
  // 3. 情绪转冷预警（从亢奋/偏暖转向中性/偏冷）
  else if (scoreChange <= -15 && previousScore >= 55 && currentScore < 55) {
    alertType = 'cooling';
    title = '📉 市场情绪转冷信号';
    description = `情绪评分从${previousScore}分(${previousLevel.label})降至${currentScore}分(${currentLevel.label})，跌幅${Math.abs(scoreChange)}分。连板股数从${previousStats.metrics.connectionBoards}只降至${currentStats.metrics.connectionBoards}只，市场做多情绪减弱，建议减仓观望。`;
  }
  // 4. 大幅波动预警（单日变化超过20分）
  else if (Math.abs(scoreChange) >= 20) {
    if (scoreChange > 0) {
      alertType = 'warming';
      title = '📈 市场情绪大幅回暖';
      description = `情绪评分单日大涨${scoreChange}分，从${previousScore}分升至${currentScore}分。涨停数从${previousStats.metrics.totalLimitUp}只增至${currentStats.metrics.totalLimitUp}只，市场活跃度显著提升。`;
    } else {
      alertType = 'cooling';
      title = '📉 市场情绪大幅降温';
      description = `情绪评分单日大跌${Math.abs(scoreChange)}分，从${previousScore}分降至${currentScore}分。涨停数从${previousStats.metrics.totalLimitUp}只降至${currentStats.metrics.totalLimitUp}只，市场活跃度明显下降。`;
    }
  }

  if (!alertType) {
    return null;
  }

  return {
    alertDate: currentDate,
    alertType,
    title,
    description,
    currentScore,
    previousScore,
    scoreChange,
    totalLimitUp: currentStats.metrics.totalLimitUp,
    connectionBoards: currentStats.metrics.connectionBoards,
    maxBoards: currentStats.metrics.maxBoards,
    isRead: '0',
  };
}

/**
 * 创建情绪预警记录
 */
export async function createSentimentAlert(alert: InsertSentimentAlert): Promise<SentimentAlert | null> {
  const db = await getDb();
  if (!db) return null;

  // 检查是否已存在同日期同类型的预警
  const existing = await db.select().from(sentimentAlerts)
    .where(and(
      eq(sentimentAlerts.alertDate, alert.alertDate),
      eq(sentimentAlerts.alertType, alert.alertType)
    ))
    .limit(1);

  if (existing.length > 0) {
    return existing[0]; // 已存在，返回现有记录
  }

  const result = await db.insert(sentimentAlerts).values(alert);
  const insertId = result[0].insertId;
  
  const [newAlert] = await db.select().from(sentimentAlerts).where(eq(sentimentAlerts.id, insertId));
  return newAlert || null;
}

/**
 * 获取所有预警记录（按日期降序）
 */
export async function getAllSentimentAlerts(limit: number = 50): Promise<SentimentAlert[]> {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(sentimentAlerts)
    .orderBy(desc(sentimentAlerts.alertDate), desc(sentimentAlerts.createdAt))
    .limit(limit);
}

/**
 * 获取未读预警数量
 */
export async function getUnreadAlertCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.select({ count: count() })
    .from(sentimentAlerts)
    .where(eq(sentimentAlerts.isRead, '0'));

  return result[0]?.count || 0;
}

/**
 * 标记预警为已读
 */
export async function markAlertAsRead(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db.update(sentimentAlerts)
    .set({ isRead: '1' })
    .where(eq(sentimentAlerts.id, id));

  return result[0].affectedRows > 0;
}

/**
 * 标记所有预警为已读
 */
export async function markAllAlertsAsRead(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.update(sentimentAlerts)
    .set({ isRead: '1' })
    .where(eq(sentimentAlerts.isRead, '0'));

  return result[0].affectedRows;
}

/**
 * 检测并生成指定日期的预警（如果有拐点）
 */
export async function checkAndCreateAlert(date: string): Promise<SentimentAlert | null> {
  const alert = await detectSentimentTurningPoint(date);
  if (alert) {
    return await createSentimentAlert(alert);
  }
  return null;
}

/**
 * 批量检测最近N天的情绪拐点（用于初始化或补充历史预警）
 */
export async function batchCheckAlerts(days: number = 30): Promise<SentimentAlert[]> {
  const db = await getDb();
  if (!db) return [];

  // 获取所有交易日期
  const allRecords = await db.select().from(limitUpRecords)
    .orderBy(desc(limitUpRecords.limitUpDate));
  
  const tradingDatesSet = new Set<string>();
  for (const record of allRecords) {
    tradingDatesSet.add(record.limitUpDate);
  }
  const tradingDates = Array.from(tradingDatesSet).sort((a, b) => b.localeCompare(a));

  // 取最近N天
  const recentDates = tradingDates.slice(0, days);
  const alerts: SentimentAlert[] = [];

  for (const date of recentDates) {
    const alert = await checkAndCreateAlert(date);
    if (alert) {
      alerts.push(alert);
    }
  }

  return alerts;
}


/**
 * 计算每日最高连板趋势。
 * 连板数沿用连板梯队统计规则：股票在相邻的已记录交易日连续涨停，连续天数即连板数。
 */
export function buildMaxConnectionBoardTrend(records: Array<Pick<LimitUpRecord, "stockCode" | "stockName" | "limitUpDate">>): Array<{
  date: string;
  maxBoards: number;
  stockNames: string[];
  stockCodes: string[];
}> {
  if (records.length === 0) return [];

  const isMainBoardStock = (stockCode: string) => !/^(300|301|688|920)/.test(stockCode);
  const tradingDates = Array.from(new Set(records.map(record => record.limitUpDate)))
    .sort((a, b) => b.localeCompare(a));
  const tradingDateIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const stockDatesMap = new Map<string, Set<string>>();
  const recordsByDate = new Map<string, typeof records>();

  for (const record of records.filter(record => isMainBoardStock(record.stockCode))) {
    if (!stockDatesMap.has(record.stockCode)) {
      stockDatesMap.set(record.stockCode, new Set());
    }
    stockDatesMap.get(record.stockCode)!.add(record.limitUpDate);

    const dateRecords = recordsByDate.get(record.limitUpDate) ?? [];
    dateRecords.push(record);
    recordsByDate.set(record.limitUpDate, dateRecords);
  }

  const calculateConsecutiveBoards = (stockCode: string, targetDate: string): number => {
    const stockDates = stockDatesMap.get(stockCode);
    const targetIndex = tradingDateIndex.get(targetDate);
    if (!stockDates || targetIndex === undefined) return 1;

    let boards = 1;
    for (let index = targetIndex + 1; index < tradingDates.length; index += 1) {
      if (!stockDates.has(tradingDates[index])) break;
      boards += 1;
    }
    return boards;
  };

  return tradingDates.slice().reverse().flatMap((date) => {
    const namesByCode = new Map<string, string>();
    let maxBoards = 0;

    for (const record of recordsByDate.get(date) ?? []) {
      const boards = calculateConsecutiveBoards(record.stockCode, date);
      if (boards > maxBoards) {
        maxBoards = boards;
        namesByCode.clear();
      }
      if (boards === maxBoards) {
        namesByCode.set(record.stockCode, record.stockName);
      }
    }

    if (maxBoards === 0) return [];

    return [{
      date,
      maxBoards,
      stockNames: Array.from(namesByCode.values()),
      stockCodes: Array.from(namesByCode.keys()),
    }];
  });
}

/** 获取每日最高连板趋势（数据库全量涨停记录）。 */
export async function getMaxConnectionBoardTrend() {
  const db = await getDb();
  if (!db) return [];

  const allRecords = await db.select({
    stockCode: limitUpRecords.stockCode,
    stockName: limitUpRecords.stockName,
    limitUpDate: limitUpRecords.limitUpDate,
  }).from(limitUpRecords).orderBy(desc(limitUpRecords.limitUpDate));

  return buildMaxConnectionBoardTrend(allRecords);
}

/** 获取基于主板最高连板趋势的情绪周期、原龙头断板和新周期候选分析。 */
export async function getSentimentCycleAnalysis() {
  const db = await getDb();
  if (!db) return buildSentimentCycleAnalysis([]);

  const records = await db.select({
    stockCode: limitUpRecords.stockCode,
    stockName: limitUpRecords.stockName,
    limitUpDate: limitUpRecords.limitUpDate,
    limitUpTime: limitUpRecords.limitUpTime,
    sector: limitUpRecords.sector,
    turnover: limitUpRecords.turnover,
    circulationValue: limitUpRecords.circulationValue,
  }).from(limitUpRecords).orderBy(desc(limitUpRecords.limitUpDate), limitUpRecords.limitUpTime);

  return buildSentimentCycleAnalysis(records);
}

/** 获取最新交易日的主板龙头候选池。 */
export async function getLeaderCandidates() {
  const db = await getDb();
  if (!db) return buildLeaderCandidates([]);

  const records = await db.select({
    stockCode: limitUpRecords.stockCode,
    stockName: limitUpRecords.stockName,
    limitUpDate: limitUpRecords.limitUpDate,
    limitUpTime: limitUpRecords.limitUpTime,
    sector: limitUpRecords.sector,
    turnover: limitUpRecords.turnover,
    circulationValue: limitUpRecords.circulationValue,
  }).from(limitUpRecords).orderBy(desc(limitUpRecords.limitUpDate), limitUpRecords.limitUpTime);

  const latestDate = records[0]?.limitUpDate;
  if (!latestDate) return buildLeaderCandidates(records);
  const cycleAnalysis = buildSentimentCycleAnalysis(records);
  const phaseByDate = new Map(cycleAnalysis.days.map((day) => [day.date, { phase: day.phase, maxBoards: day.maxBoards }]));
  const signalDayPrices = await db.select({
    stockCode: stockDailyPrices.stockCode,
    tradeDate: stockDailyPrices.tradeDate,
    openPrice: stockDailyPrices.openPrice,
    closePrice: stockDailyPrices.closePrice,
    highPrice: stockDailyPrices.highPrice,
    lowPrice: stockDailyPrices.lowPrice,
    amount: stockDailyPrices.amount,
    volume: stockDailyPrices.volume,
    preClosePrice: stockDailyPrices.preClosePrice,
  }).from(stockDailyPrices).where(eq(stockDailyPrices.tradeDate, latestDate));
  const priceByStockDate = buildLeaderCandidateDailyPriceMap(signalDayPrices);
  const marketFactorsByDate = buildVerifiedMarketFactorMap(await getLeaderCandidateMarketFactorRows());
  return buildLeaderCandidates(records, { phaseByDate, priceByStockDate, marketFactorsByDate });
}

type BacktestBaseContext = {
  records: LeaderCandidateSourceRecord[];
  /** 全量原始日线行情行（供 Strategy Engine canonical/Feature 层使用）。 */
  rawRows: RawDailyPriceRow[];
  context: LeaderCandidateBacktestContext;
};

let backtestBaseContextCache: { value: BacktestBaseContext; expiresAt: number } | null = null;
const BACKTEST_BASE_CONTEXT_TTL_MS = 3 * 60 * 1000;
const backtestResultCache = new TTLCache<LeaderCandidateBacktestResult>(5 * 60 * 1000, 64);

/**
 * 加载回测所需的「仅依赖 DB、不依赖参数」的中间数据，单独物化并短 TTL 缓存。
 * 这样参数变化时只需重算模拟部分，不必每次全量拉涨停记录 + 11 万行日线 + 情绪周期 + 停牌窗口。
 */
async function loadBacktestBaseContext(): Promise<BacktestBaseContext> {
  const now = Date.now();
  if (backtestBaseContextCache && now < backtestBaseContextCache.expiresAt) {
    return backtestBaseContextCache.value;
  }
  const db = await getDb();
  if (!db) {
    const empty: BacktestBaseContext = { records: [], rawRows: [], context: {} };
    backtestBaseContextCache = { value: empty, expiresAt: now + BACKTEST_BASE_CONTEXT_TTL_MS };
    return empty;
  }

  const records = await db.select({
    stockCode: limitUpRecords.stockCode,
    stockName: limitUpRecords.stockName,
    limitUpDate: limitUpRecords.limitUpDate,
    limitUpTime: limitUpRecords.limitUpTime,
    sector: limitUpRecords.sector,
    turnover: limitUpRecords.turnover,
    circulationValue: limitUpRecords.circulationValue,
  }).from(limitUpRecords).orderBy(desc(limitUpRecords.limitUpDate), limitUpRecords.limitUpTime);

  const cycleAnalysis = buildSentimentCycleAnalysis(records);
  const phaseByDate = new Map(cycleAnalysis.days.map((day) => [day.date, { phase: day.phase, maxBoards: day.maxBoards }]));
  // 只拉一次全量日线：同一批原始行既用于 legacy 价格映射（priceByStockDate），
  // 也直接作为 Strategy Engine 的 canonical/Feature 输入（rawRows），避免两套查询两套口径。
  const rawRows = await loadStockDailyPriceRows();
  const priceByStockDate = buildLeaderCandidateDailyPriceMap(rawRows);
  const dailyPriceCoverage = await getLeaderCandidateDailyPriceCoverage();
  const marketFactorsByDate = buildVerifiedMarketFactorMap(await getLeaderCandidateMarketFactorRows());
  const tradingDates = Array.from(new Set(Array.from(priceByStockDate.keys()).map((key) => key.split("::").at(-1)!))).sort();
  const suspendedDatesByStock = expandSuspendedDatesByStock(await getStockSuspensionWindows(), tradingDates);

  const value: BacktestBaseContext = {
    records,
    rawRows,
    context: { phaseByDate, priceByStockDate, tradingDates, dailyPriceCoverage, marketFactorsByDate, suspendedDatesByStock },
  };
  backtestBaseContextCache = { value, expiresAt: now + BACKTEST_BASE_CONTEXT_TTL_MS };
  return value;
}

/**
 * 获取基于历史候选池的T+1连板延续回测结果（按参数哈希做结果缓存）。
 *
 * 正式生产入口（STEP 5 P2-2 边界）：结果由 Strategy Engine 新链路产出——
 *   rawRows → toCanonicalBar/validateMarketBar → runFeaturePipeline →
 *   FeatureSnapshotBundle → leader-candidate-baseline(featureMode="limit-up-confirm") →
 *   PositionSizer/RiskManager → runBacktestWithRisk → Adapter → LeaderCandidateBacktestResult。
 * 本函数为「生产核心版」：下行风险研究等 research-legacy 报表不在此构建
 * （downsideRiskResearch / strategyPortfolioSnapshot 为 null），生产请求路径
 * legacy 交易模拟器调用为 0。完整分析报表请调用 getLeaderCandidateResearch。
 */
export async function getLeaderCandidateBacktest(options: LeaderCandidateBacktestOptions = {}): Promise<LeaderCandidateBacktestResult> {
  const cacheKey = stableHash(options);
  const cached = backtestResultCache.get(cacheKey);
  if (cached) return cached;
  const { records, rawRows, context } = await loadBacktestBaseContext();
  const result = runLeaderCandidateStrategyBacktest(records, rawRows, context, options);
  backtestResultCache.set(cacheKey, result);
  return result;
}

/**
 * 完整分析报表（研究端点专用，STEP 5 P2-2）：生产核心 + 下行风险研究报表。
 *
 * 风险研究实验段使用 research-legacy 交易模拟器（显式研究来源、带 provenance），
 * 仅允许研究请求调用；不得进入 getLeaderCandidateBacktest 生产请求。返回结果形状
 * 与生产核心一致，但 downsideRiskResearch / strategyPortfolioSnapshot 非空，
 * finalVerdict 含样本外（WFA）稳健性成分。
 */
export async function getLeaderCandidateResearch(options: LeaderCandidateBacktestOptions = {}): Promise<LeaderCandidateBacktestResult> {
  const cacheKey = `research:${stableHash(options)}`;
  const cached = backtestResultCache.get(cacheKey);
  if (cached) return cached;
  const { records, rawRows, context } = await loadBacktestBaseContext();
  const result = runLeaderCandidateResearchReport(records, rawRows, context, options);
  backtestResultCache.set(cacheKey, result);
  return result;
}

/** 打地鼠基准：随机打乱评分排序重复回测，判断真实策略是否显著优于随机选股。 */
export async function runMonkeyBenchmarkForBacktest(options: LeaderCandidateBacktestOptions, trialCount = 100) {
  const result = await getLeaderCandidateBacktest(options);
  const { context } = await loadBacktestBaseContext();
  return runMonkeyBenchmark(
    result.historicalRows,
    options.realistic,
    context.priceByStockDate ?? new Map(),
    context.tradingDates ?? [],
    trialCount,
  );
}

/** 交易成本敏感性：在 0/1/1.5/2/3 倍成本下重复回测，判断策略是否依赖理想无成本环境。 */
export async function runCostSensitivityForBacktest(options: LeaderCandidateBacktestOptions, multipliers?: number[]) {
  const result = await getLeaderCandidateBacktest(options);
  const { context } = await loadBacktestBaseContext();
  return runCostSensitivity(
    result.historicalRows,
    options.realistic,
    context.priceByStockDate ?? new Map(),
    context.tradingDates ?? [],
    multipliers,
  );
}

/** 从回测结果提取扁平关键指标，供历史列表页快速展示（不承载完整明细）。 */
function extractBacktestSummary(result: LeaderCandidateBacktestResult) {
  return {
    observationDays: result.observationDays,
    appliedMinScore: result.appliedMinScore,
    totalSamples: result.totalSamples,
    successCount: result.successCount,
    successRate: result.successRate,
    averageClosePremium: result.premium.averageClosePremium,
    tPlus1To2AverageReturn: result.tPlus1CloseToTPlus2Close.averageReturn,
    realisticTotalReturn: result.realisticSimulation.totalReturn,
    realisticMaxDrawdown: result.realisticSimulation.maxDrawdown,
    realisticWinRate: result.realisticSimulation.winRate,
    realisticTradeCount: result.realisticSimulation.tradeCount,
  };
}

export type BacktestRunSummary = {
  id: number;
  createdAt: string | null;
  summary: Record<string, unknown> | null;
};

export type SavedBacktestRun = {
  id: number;
  createdAt: string | null;
  options: LeaderCandidateBacktestOptions;
  summary: Record<string, unknown> | null;
  result: LeaderCandidateBacktestResult;
};

function timestampToIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** 保存一次回测（参数 + 完整结果），返回记录 id。参数哈希作为去重/缓存键。 */
export async function saveBacktestRun(options: LeaderCandidateBacktestOptions, result: LeaderCandidateBacktestResult): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const paramsJson = JSON.stringify(options);
  const summary = extractBacktestSummary(result);
  const inserted = await db.insert(backtestRuns).values({
    paramsHash: stableHash(options),
    paramsJson,
    summaryJson: JSON.stringify(summary),
    resultJson: JSON.stringify(result),
  });
  return Number(inserted[0].insertId);
}

/** 列出已保存的回测（摘要级，不含完整结果），按保存时间倒序。 */
export async function listBacktestRuns(limit = 50): Promise<BacktestRunSummary[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: backtestRuns.id,
    createdAt: backtestRuns.createdAt,
    summaryJson: backtestRuns.summaryJson,
  }).from(backtestRuns).orderBy(desc(backtestRuns.createdAt)).limit(limit);
  return rows.map((row) => ({
    id: row.id,
    createdAt: timestampToIso(row.createdAt),
    summary: row.summaryJson ? (JSON.parse(row.summaryJson) as Record<string, unknown>) : null,
  }));
}

/** 读取单条已保存回测的完整结果。 */
export async function getBacktestRun(id: number): Promise<SavedBacktestRun | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(backtestRuns).where(eq(backtestRuns.id, id));
  const row = rows[0];
  if (!row) return null;
  let result: LeaderCandidateBacktestResult | null = null;
  try {
    result = JSON.parse(row.resultJson ?? "null") as LeaderCandidateBacktestResult;
  } catch {
    return null;
  }
  let options: LeaderCandidateBacktestOptions = {};
  try {
    options = JSON.parse(row.paramsJson ?? "{}") as LeaderCandidateBacktestOptions;
  } catch {
    options = {};
  }
  let summary: Record<string, unknown> | null = null;
  try {
    summary = row.summaryJson ? (JSON.parse(row.summaryJson) as Record<string, unknown>) : null;
  } catch {
    summary = null;
  }
  return { id: row.id, createdAt: timestampToIso(row.createdAt), options, summary, result };
}

// ==================== 前向纸面交易（四-P1：真实样本外兜底） ====================

export type PaperTradingRunSummary = {
  id: number;
  label: string;
  strategyKey: PaperTradingStrategyKey;
  status: "active" | "paused" | "completed";
  lastProcessedDate: string | null;
  createdAt: string | null;
  summary: PaperTradingSummary | null;
};

export type PaperTradingRunDetail = PaperTradingRunSummary & {
  initialCapital: number;
  options: LeaderCandidateBacktestOptions;
  state: PaperTradingState;
};

const PAPER_TRADING_STRATEGY_KEYS: PaperTradingStrategyKey[] = ["baseline", "riskPenalty", "hardFilter", "qualityBlend", "qualityGate"];

function isPaperTradingStrategyKey(value: string): value is PaperTradingStrategyKey {
  return (PAPER_TRADING_STRATEGY_KEYS as string[]).includes(value);
}

function parsePaperTradingState(json: string | null, initialCapital: number): PaperTradingState {
  if (!json) return createInitialPaperTradingState(initialCapital);
  try {
    const parsed = JSON.parse(json) as PaperTradingState;
    // 结构兜底：老数据缺字段时补默认值，避免推进崩溃。
    return {
      cash: parsed.cash ?? initialCapital,
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      pendingBuys: Array.isArray(parsed.pendingBuys) ? parsed.pendingBuys : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      equityCurve: Array.isArray(parsed.equityCurve) ? parsed.equityCurve : [],
      lastProcessedDate: parsed.lastProcessedDate ?? null,
    };
  } catch {
    return createInitialPaperTradingState(initialCapital);
  }
}

/** 用「仅该信号日及以前」的数据生成候选，供前向清单评分（point-in-time）。 */
function buildForwardCandidates(records: LeaderCandidateSourceRecord[], date: string, context: LeaderCandidateBacktestContext) {
  return buildLeaderCandidatesForDate(records, date, {
    phaseByDate: context.phaseByDate,
    priceByStockDate: context.priceByStockDate,
    marketFactorsByDate: context.marketFactorsByDate,
  }).candidates;
}

/** 构造初始状态：以 startDate 收盘生成首个准备买入清单，尚未成交。 */
function buildInitialForwardState(
  records: LeaderCandidateSourceRecord[],
  context: LeaderCandidateBacktestContext,
  options: LeaderCandidateBacktestOptions,
  strategyKey: PaperTradingStrategyKey,
  startDate: string,
  initialCapital: number,
): PaperTradingState {
  const realistic = options.realistic ?? {};
  const downside = options.downsideRisk ?? {};
  const maxPositions = Math.max(1, Math.floor(realistic.maxPositions ?? 5));
  const candidates = buildForwardCandidates(records, startDate, context);
  const pendingBuys = buildForwardPreparedBuys(
    candidates,
    startDate,
    strategyKey,
    {
      appliedMinScore: options.minScore ?? null,
      penaltyWeight: downside.penaltyWeight,
      hardRiskThreshold: downside.hardRiskThreshold ?? 0,
      priceByStockDate: context.priceByStockDate,
    },
    new Set(),
    maxPositions,
  );
  const state = createInitialPaperTradingState(initialCapital);
  state.pendingBuys = pendingBuys;
  state.lastProcessedDate = startDate;
  return state;
}

/** 归一化参数：把初始资金并入 realistic，确保固定仓位占比等口径一致。 */
function normalizePaperTradingOptions(options: LeaderCandidateBacktestOptions, initialCapital: number): LeaderCandidateBacktestOptions {
  return { ...options, realistic: { ...(options.realistic ?? {}), initialCapital: Math.floor(initialCapital) } };
}

/** 创建一次前向纸面交易运行，返回运行 id。初始准备清单以最新信号日收盘生成。 */
export async function createPaperTradingRun(
  label: string,
  strategyKey: PaperTradingStrategyKey,
  options: LeaderCandidateBacktestOptions,
  initialCapital: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const { records, context } = await loadBacktestBaseContext();
  const dates = Array.from(new Set(records.map((record) => record.limitUpDate))).sort();
  const startDate = dates.at(-1);
  if (!startDate) return 0;
  const normalized = normalizePaperTradingOptions(options, initialCapital);
  const state = buildInitialForwardState(records, context, normalized, strategyKey, startDate, initialCapital);
  const inserted = await db.insert(paperTradingRuns).values({
    label,
    strategyKey,
    paramsJson: JSON.stringify(normalized),
    initialCapital: Math.floor(initialCapital),
    status: "active",
    lastProcessedDate: state.lastProcessedDate,
    stateJson: JSON.stringify(state),
  });
  return Number(inserted[0].insertId);
}

/** 列出前向纸面交易运行（含扁平摘要），按创建时间倒序。 */
export async function listPaperTradingRuns(limit = 50): Promise<PaperTradingRunSummary[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(paperTradingRuns).orderBy(desc(paperTradingRuns.createdAt)).limit(limit);
  return rows.map((row) => {
    const state = parsePaperTradingState(row.stateJson, row.initialCapital);
    return {
      id: row.id,
      label: row.label,
      strategyKey: isPaperTradingStrategyKey(row.strategyKey) ? row.strategyKey : "baseline",
      status: row.status,
      lastProcessedDate: row.lastProcessedDate,
      createdAt: timestampToIso(row.createdAt),
      summary: buildPaperTradingSummary(state, row.initialCapital),
    };
  });
}

/** 读取单条前向纸面交易运行的完整状态。 */
export async function getPaperTradingRun(id: number): Promise<PaperTradingRunDetail | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(paperTradingRuns).where(eq(paperTradingRuns.id, id));
  const row = rows[0];
  if (!row) return null;
  let options: LeaderCandidateBacktestOptions = {};
  try {
    options = JSON.parse(row.paramsJson ?? "{}") as LeaderCandidateBacktestOptions;
  } catch {
    options = {};
  }
  const state = parsePaperTradingState(row.stateJson, row.initialCapital);
  return {
    id: row.id,
    label: row.label,
    strategyKey: isPaperTradingStrategyKey(row.strategyKey) ? row.strategyKey : "baseline",
    status: row.status,
    lastProcessedDate: row.lastProcessedDate,
    createdAt: timestampToIso(row.createdAt),
    summary: buildPaperTradingSummary(state, row.initialCapital),
    initialCapital: row.initialCapital,
    options,
    state,
  };
}

/** 更新运行状态（active / paused / completed）。 */
export async function setPaperTradingRunStatus(id: number, status: "active" | "paused" | "completed"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(paperTradingRuns).set({ status }).where(eq(paperTradingRuns.id, id));
}

/** 回写运行状态（唯一事实源，覆盖式写入 stateJson）。 */
async function persistPaperTradingRunState(id: number, state: PaperTradingState): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(paperTradingRuns).set({
    stateJson: JSON.stringify(state),
    lastProcessedDate: state.lastProcessedDate,
  }).where(eq(paperTradingRuns.id, id));
}

/**
 * 把一次运行推进到「已有日线行情的最新交易日」。
 * 逐日：开盘成交既有准备清单 → 收盘止盈止损出清 → 标记市值 → 生成下一交易日清单。
 * 若该运行已推进到最新日期，则原样返回当前摘要。
 */
export async function advancePaperTradingRunToLatest(id: number): Promise<PaperTradingSummary | null> {
  const db = await getDb();
  if (!db) return null;
  const run = await getPaperTradingRun(id);
  if (!run || run.status !== "active") return null;
  const { records, context } = await loadBacktestBaseContext();
  const priceByStockDate = context.priceByStockDate ?? new Map<string, LeaderCandidateDailyPrice>();
  const tradingDates = context.tradingDates ?? [];
  if (tradingDates.length === 0) return run.summary;

  const options = run.options;
  const realistic = options.realistic ?? {};
  const downside = options.downsideRisk ?? {};
  const lastProcessed = run.state.lastProcessedDate;
  const datesToAdvance = tradingDates.filter((date) => lastProcessed === null || date > lastProcessed);

  let state = run.state;
  for (const today of datesToAdvance) {
    const candidates = buildForwardCandidates(records, today, context);
    const result = advancePaperTradingDay({
      state,
      today,
      signalCandidates: candidates,
      priceByStockDate,
      tradingDates,
      strategyKey: run.strategyKey,
      realistic,
      appliedMinScore: options.minScore ?? null,
      penaltyWeight: downside.penaltyWeight,
      hardRiskThreshold: downside.hardRiskThreshold ?? 0,
    });
    state = result.state;
  }

  await persistPaperTradingRunState(id, state);
  return buildPaperTradingSummary(state, run.initialCapital);
}

/** 推进所有 active 运行到最新交易日，供每日定时任务调用。 */
export async function advanceAllActivePaperTradingRuns(): Promise<Array<{ runId: number; label: string; summary: PaperTradingSummary | null }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: paperTradingRuns.id, label: paperTradingRuns.label })
    .from(paperTradingRuns)
    .where(eq(paperTradingRuns.status, "active"));
  const results: Array<{ runId: number; label: string; summary: PaperTradingSummary | null }> = [];
  for (const row of rows) {
    const summary = await advancePaperTradingRunToLatest(row.id);
    results.push({ runId: row.id, label: row.label, summary });
  }
  return results;
}
