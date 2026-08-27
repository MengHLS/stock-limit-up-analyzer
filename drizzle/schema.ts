import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, date, index, uniqueIndex } from "drizzle-orm/mysql-core";

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
}, (table) => ({
  // 关键查询索引
  limitUpDateIdx: index("idx_limit_up_date").on(table.limitUpDate),
  stockCodeIdx: index("idx_stock_code").on(table.stockCode),
  sectorIdx: index("idx_sector").on(table.sector),
  createdByIdx: index("idx_created_by").on(table.createdBy),
  // 复合索引用于常见查询模式
  dateStockIdx: index("idx_date_stock").on(table.limitUpDate, table.stockCode),
  dateTimeIdx: index("idx_date_time").on(table.limitUpDate, table.limitUpTime),
  dateSectorIdx: index("idx_date_sector").on(table.limitUpDate, table.sector),
}));

export type LimitUpRecord = typeof limitUpRecords.$inferSelect;
export type InsertLimitUpRecord = typeof limitUpRecords.$inferInsert;

/**
 * 股票日线价格表 - 保存外部行情源返回的未复权开盘、收盘和前收价格。
 * 价格按股票代码和交易日唯一，供候选池以 T 日收盘为基准计算 T+1 溢价。
 */
export const stockDailyPrices = mysqlTable("stock_daily_prices", {
  id: int("id").autoincrement().primaryKey(),
  /** 股票代码，如 002361.SZ */
  stockCode: varchar("stockCode", { length: 20 }).notNull(),
  /** 交易日期，使用 string 模式避免时区转换 */
  tradeDate: date("tradeDate", { mode: "string" }).notNull(),
  /** 当日开盘价 */
  openPrice: varchar("openPrice", { length: 24 }).notNull(),
  /** 当日收盘价 */
  closePrice: varchar("closePrice", { length: 24 }).notNull(),
  /** 当日最低价；用于持仓期最大不利波动研究。 */
  lowPrice: varchar("lowPrice", { length: 24 }),
  /** 当日成交额（Tushare daily 的 amount，单位千元）。 */
  amount: varchar("amount", { length: 32 }),
  /** 当日除权前收价 */
  preClosePrice: varchar("preClosePrice", { length: 24 }).notNull(),
  /** 行情来源，如 tushare */
  source: varchar("source", { length: 32 }).notNull().default("tushare"),
  /** 外部行情写入时间 */
  sourceUpdatedAt: timestamp("sourceUpdatedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  stockDateUnique: uniqueIndex("uq_stock_daily_price_stock_date").on(table.stockCode, table.tradeDate),
  stockDateIdx: index("idx_stock_daily_price_stock_date").on(table.stockCode, table.tradeDate),
  tradeDateIdx: index("idx_stock_daily_price_trade_date").on(table.tradeDate),
}));

export type StockDailyPrice = typeof stockDailyPrices.$inferSelect;
export type InsertStockDailyPrice = typeof stockDailyPrices.$inferInsert;

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
}, (table) => ({
  statusIdx: index("idx_status").on(table.status),
  createdByIdx: index("idx_created_by_images").on(table.createdBy),
}));

export type UploadedImage = typeof uploadedImages.$inferSelect;
export type InsertUploadedImage = typeof uploadedImages.$inferInsert;

/**
 * 操作日志表 - 记录图片识别结果与指定日期数据刷新状态
 */
export const operationLogs = mysqlTable("operation_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** 操作类型：图片识别或日期数据刷新 */
  operationType: mysqlEnum("operationType", ["image_recognition", "date_refresh"]).notNull(),
  /** 操作状态：处理中、成功、空结果或失败 */
  status: mysqlEnum("status", ["processing", "success", "empty", "failed"]).notNull(),
  /** 关联的图片记录，可为空（批量刷新可能对应多张图片） */
  imageId: int("imageId"),
  /** 图片原始文件名或操作来源说明 */
  fileName: varchar("fileName", { length: 255 }),
  /** 用户选择或请求的日期 */
  requestedDate: date("requestedDate", { mode: "string" }),
  /** 识别结果最终使用的日期 */
  effectiveDate: date("effectiveDate", { mode: "string" }),
  /** 图片识别出的股票数量 */
  recognizedCount: int("recognizedCount"),
  /** 日期刷新查询到的记录数量 */
  refreshedCount: int("refreshedCount"),
  /** 错误或补充说明 */
  message: text("message"),
  /** 操作者用户ID */
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("idx_operation_logs_user_created").on(table.createdBy, table.createdAt),
  typeStatusIdx: index("idx_operation_logs_type_status").on(table.operationType, table.status),
  requestedDateIdx: index("idx_operation_logs_requested_date").on(table.requestedDate),
  imageIdx: index("idx_operation_logs_image").on(table.imageId),
}));

export type OperationLog = typeof operationLogs.$inferSelect;
export type InsertOperationLog = typeof operationLogs.$inferInsert;

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
}, (table) => ({
  userIdIdx: index("idx_user_id").on(table.userId),
  userStockIdx: index("idx_user_stock").on(table.userId, table.stockCode),
}));

export type StockWatchlist = typeof stockWatchlist.$inferSelect;
export type InsertStockWatchlist = typeof stockWatchlist.$inferInsert;

/**
 * 大盘数据表 - 存储每日大盘成交额和两融余额
 */
export const marketData = mysqlTable("market_data", {
  id: int("id").autoincrement().primaryKey(),
  /** 数据日期 */
  dataDate: date("dataDate", { mode: "string" }).notNull().unique(),
  /** 大盘成交额（亿元） */
  turnover: varchar("turnover", { length: 20 }).notNull(),
  /** 两融余额（亿元） */
  marginBalance: varchar("marginBalance", { length: 20 }).notNull(),
  /** 备注 */
  note: text("note"),
  /** 创建者用户ID */
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  dataDateIdx: index("idx_data_date").on(table.dataDate),
}));

export type MarketData = typeof marketData.$inferSelect;
export type InsertMarketData = typeof marketData.$inferInsert;

/**
 * 情绪预警表 - 存储市场情绪拐点预警记录
 */
export const sentimentAlerts = mysqlTable("sentiment_alerts", {
  id: int("id").autoincrement().primaryKey(),
  /** 预警日期 */
  alertDate: date("alertDate", { mode: "string" }).notNull(),
  /** 预警类型: warming(转暖), cooling(转冷), extreme_hot(极度亢奋), extreme_cold(极度冰点) */
  alertType: mysqlEnum("alertType", ["warming", "cooling", "extreme_hot", "extreme_cold"]).notNull(),
  /** 预警标题 */
  title: varchar("title", { length: 100 }).notNull(),
  /** 预警描述 */
  description: text("description"),
  /** 当日情绪评分 */
  currentScore: int("currentScore").notNull(),
  /** 前一日情绪评分 */
  previousScore: int("previousScore"),
  /** 评分变化值 */
  scoreChange: int("scoreChange"),
  /** 当日涨停数 */
  totalLimitUp: int("totalLimitUp"),
  /** 当日连板数 */
  connectionBoards: int("connectionBoards"),
  /** 当日最高板 */
  maxBoards: int("maxBoards"),
  /** 是否已读 */
  isRead: mysqlEnum("isRead", ["0", "1"]).default("0").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  alertDateIdx: index("idx_alert_date").on(table.alertDate),
  alertTypeIdx: index("idx_alert_type").on(table.alertType),
  isReadIdx: index("idx_is_read").on(table.isRead),
}));

export type SentimentAlert = typeof sentimentAlerts.$inferSelect;
export type InsertSentimentAlert = typeof sentimentAlerts.$inferInsert;
