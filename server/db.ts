import { eq, desc, like, or, sql, gte, count, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
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
  OperationLog
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { normalizeLimitUpTime } from '../shared/limitUpTime';
import { normalizeSectorName } from '../shared/stockDataNormalization';
import {
  buildLeaderCandidateBacktest,
  buildLeaderCandidates,
  buildLeaderCandidateDailyPriceMap,
  type LeaderCandidateBacktestOptions,
  type LeaderCandidateDailyPrice,
  type LeaderCandidateDailyPriceCoverage,
} from './leaderCandidates';
import { buildSentimentCycleAnalysis } from './sentimentCycle';
import { parseStoredMarketYi } from './marketFactors';

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

export type StockDailyPriceUpsert = Pick<InsertStockDailyPrice, "stockCode" | "tradeDate" | "openPrice" | "closePrice" | "lowPrice" | "amount" | "preClosePrice" | "source">;

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

/** 按股票代码和交易日幂等覆盖写入 Tushare 日线价格。 */
export async function upsertStockDailyPrices(rows: StockDailyPriceUpsert[]): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;

  const BATCH_SIZE = 500;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    await db.insert(stockDailyPrices).values(batch).onDuplicateKeyUpdate({
      set: {
        openPrice: sql`VALUES(\`openPrice\`)`,
        closePrice: sql`VALUES(\`closePrice\`)`,
        lowPrice: sql`VALUES(\`lowPrice\`)`,
        amount: sql`VALUES(\`amount\`)`,
        preClosePrice: sql`VALUES(\`preClosePrice\`)`,
        source: sql`VALUES(\`source\`)`,
        sourceUpdatedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
  return rows.length;
}

/** 构造候选池回测所需的股票—交易日价格映射。 */
export async function getLeaderCandidateDailyPriceMap(): Promise<Map<string, LeaderCandidateDailyPrice>> {
  const db = await getDb();
  if (!db) return new Map();
  const rows = await db.select({
    stockCode: stockDailyPrices.stockCode,
    tradeDate: stockDailyPrices.tradeDate,
    openPrice: stockDailyPrices.openPrice,
    closePrice: stockDailyPrices.closePrice,
    lowPrice: stockDailyPrices.lowPrice,
    amount: stockDailyPrices.amount,
  }).from(stockDailyPrices);

  return buildLeaderCandidateDailyPriceMap(rows);
}

/** 返回候选回测使用的行情覆盖状态，供研究页面提示低价与成交额的实际回填进度。 */
export async function getLeaderCandidateDailyPriceCoverage(): Promise<LeaderCandidateDailyPriceCoverage> {
  const db = await getDb();
  if (!db) return { rowCount: 0, stockCount: 0, startDate: null, endDate: null, lowPriceCount: 0, amountCount: 0 };
  const rows = await db.select({
    rowCount: sql<number>`COUNT(*)`,
    stockCount: sql<number>`COUNT(DISTINCT ${stockDailyPrices.stockCode})`,
    startDate: sql<string | null>`MIN(${stockDailyPrices.tradeDate})`,
    endDate: sql<string | null>`MAX(${stockDailyPrices.tradeDate})`,
    lowPriceCount: sql<number>`SUM(CASE WHEN ${stockDailyPrices.lowPrice} IS NOT NULL THEN 1 ELSE 0 END)`,
    amountCount: sql<number>`SUM(CASE WHEN ${stockDailyPrices.amount} IS NOT NULL THEN 1 ELSE 0 END)`,
  }).from(stockDailyPrices);
  const row = rows[0];
  return {
    rowCount: Number(row?.rowCount ?? 0),
    stockCount: Number(row?.stockCount ?? 0),
    startDate: row?.startDate ?? null,
    endDate: row?.endDate ?? null,
    lowPriceCount: Number(row?.lowPriceCount ?? 0),
    amountCount: Number(row?.amountCount ?? 0),
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
    lowPrice: stockDailyPrices.lowPrice,
    amount: stockDailyPrices.amount,
  }).from(stockDailyPrices).where(eq(stockDailyPrices.tradeDate, latestDate));
  const priceByStockDate = buildLeaderCandidateDailyPriceMap(signalDayPrices);
  const marketFactorsByDate = buildVerifiedMarketFactorMap(await getLeaderCandidateMarketFactorRows());
  return buildLeaderCandidates(records, { phaseByDate, priceByStockDate, marketFactorsByDate });
}

/** 获取基于历史候选池的T+1连板延续回测结果。 */
export async function getLeaderCandidateBacktest(options: LeaderCandidateBacktestOptions = {}) {
  const db = await getDb();
  if (!db) return buildLeaderCandidateBacktest([], options);

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
  const priceByStockDate = await getLeaderCandidateDailyPriceMap();
  const dailyPriceCoverage = await getLeaderCandidateDailyPriceCoverage();
  const marketFactorsByDate = buildVerifiedMarketFactorMap(await getLeaderCandidateMarketFactorRows());
  const tradingDates = Array.from(new Set(Array.from(priceByStockDate.keys()).map((key) => key.split("::").at(-1)!))).sort();
  return buildLeaderCandidateBacktest(records, options, { phaseByDate, priceByStockDate, tradingDates, dailyPriceCoverage, marketFactorsByDate });
}
