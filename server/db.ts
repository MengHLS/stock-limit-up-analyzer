import { eq, desc, like, or, sql } from "drizzle-orm";
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
  StockWatchlist
} from "../drizzle/schema";
import { ENV } from './_core/env';

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

/** 创建涨停记录 */
export async function createLimitUpRecord(record: InsertLimitUpRecord): Promise<LimitUpRecord | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(limitUpRecords).values(record);
  const insertId = result[0].insertId;
  
  const [newRecord] = await db.select().from(limitUpRecords).where(eq(limitUpRecords.id, insertId));
  return newRecord || null;
}

/** 批量创建涨停记录 */
export async function createLimitUpRecordsBatch(records: InsertLimitUpRecord[]): Promise<number> {
  const db = await getDb();
  if (!db || records.length === 0) return 0;

  const result = await db.insert(limitUpRecords).values(records);
  return result[0].affectedRows;
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

  const records = await db.select().from(limitUpRecords)
    .where(eq(limitUpRecords.limitUpDate, date));

  // 统计各题材数量
  const sectorMap = new Map<string, number>();
  for (const record of records) {
    const sector = record.sector || '其他';
    sectorMap.set(sector, (sectorMap.get(sector) || 0) + 1);
  }

  return Array.from(sectorMap.entries())
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => {
      // "其他"始终放在最后
      if (a.sector === '其他') return 1;
      if (b.sector === '其他') return -1;
      // 其他题材按涨停数降序排列
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

  const records = await db.select().from(limitUpRecords);
  
  // 按日期统计数量
  const dateMap = new Map<string, number>();
  for (const record of records) {
    const date = record.limitUpDate;
    dateMap.set(date, (dateMap.get(date) || 0) + 1);
  }

  return Array.from(dateMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date)); // 按日期升序
}

/** 获取每日题材分布统计 */
export async function getDailySectorDistribution(): Promise<{ date: string; sectors: { sector: string; count: number }[] }[]> {
  const db = await getDb();
  if (!db) return [];

  const records = await db.select().from(limitUpRecords)
    .orderBy(desc(limitUpRecords.limitUpDate));
  
  // 按日期和题材统计
  const dateMap = new Map<string, Map<string, number>>();
  for (const record of records) {
    const date = record.limitUpDate;
    const sector = record.sector || '其他';
    
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

  await db.update(limitUpRecords).set(data).where(eq(limitUpRecords.id, id));
  
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
