import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, date } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 涨停记录表 - 存储每只股票的涨停信息
 */
export const limitUpRecords = mysqlTable("limit_up_records", {
  id: int("id").autoincrement().primaryKey(),
  /** 股票代码，如 002361.SZ */
  stockCode: varchar("stockCode", { length: 20 }).notNull(),
  /** 股票名称，如 神剑股份 */
  stockName: varchar("stockName", { length: 50 }).notNull(),
  /** 涨停日期 - 使用string模式避免时区转换 */
  limitUpDate: date("limitUpDate", { mode: "string" }).notNull(),
  /** 涨停时间，如 14:56:30 */
  limitUpTime: varchar("limitUpTime", { length: 20 }),
  /** 板数，如 10天9板 */
  boardCount: varchar("boardCount", { length: 20 }),
  /** 流通市值（亿元） */
  circulationValue: varchar("circulationValue", { length: 20 }),
  /** 成交额（亿元） */
  turnover: varchar("turnover", { length: 20 }),
  /** 题材分类 */
  sector: varchar("sector", { length: 100 }),
  /** 涨停关键词 */
  keywords: text("keywords"),
  /** 创建者用户ID */
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LimitUpRecord = typeof limitUpRecords.$inferSelect;
export type InsertLimitUpRecord = typeof limitUpRecords.$inferInsert;

/**
 * 图片上传记录表 - 存储上传的复盘图片信息
 */
export const uploadedImages = mysqlTable("uploaded_images", {
  id: int("id").autoincrement().primaryKey(),
  /** S3存储的文件key */
  fileKey: varchar("fileKey", { length: 255 }).notNull(),
  /** 文件访问URL */
  fileUrl: text("fileUrl").notNull(),
  /** 原始文件名 */
  originalName: varchar("originalName", { length: 255 }),
  /** 对应的涨停日期 */
  limitUpDate: date("limitUpDate"),
  /** 识别状态: pending, processing, completed, failed */
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  /** 创建者用户ID */
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UploadedImage = typeof uploadedImages.$inferSelect;
export type InsertUploadedImage = typeof uploadedImages.$inferInsert;

/**
 * 股票关注表 - 存储用户关注的股票信息
 */
export const stockWatchlist = mysqlTable("stock_watchlist", {
  id: int("id").autoincrement().primaryKey(),
  /** 用户ID */
  userId: int("userId").notNull(),
  /** 股票代码，如 002361.SZ */
  stockCode: varchar("stockCode", { length: 20 }).notNull(),
  /** 股票名称，如 神剑股份 */
  stockName: varchar("stockName", { length: 50 }).notNull(),
  /** 关注类型: normal(普通关注), important(重点关注) */
  watchType: mysqlEnum("watchType", ["normal", "important"]).default("normal").notNull(),
  /** 备注 */
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StockWatchlist = typeof stockWatchlist.$inferSelect;
export type InsertStockWatchlist = typeof stockWatchlist.$inferInsert;
