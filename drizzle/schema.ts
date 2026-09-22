import { int, bigint, boolean, mysqlEnum, mysqlTable, text, timestamp, varchar, date, index, uniqueIndex, longtext, double } from "drizzle-orm/mysql-core";

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
  /** 当日最高价；用于盘中限价买入与止盈成交模拟。 */
  highPrice: varchar("highPrice", { length: 24 }),
  /** 当日最低价；用于持仓期最大不利波动研究与盘中止损模拟。 */
  lowPrice: varchar("lowPrice", { length: 24 }),
  /** 当日成交额（Tushare daily 的 amount，单位千元）。 */
  amount: varchar("amount", { length: 32 }),
  /** 当日成交量（Tushare daily 的 vol，单位手）。 */
  volume: varchar("volume", { length: 32 }),
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
  /** 受当前用户保护的原始图片地址，用于失败识别重试 */
  imageUrl: text("imageUrl"),
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

/**
 * 股票停牌窗口表 - 记录个股在特定区间内无成交（停牌）的区间，供行情同步检查与回测识别"停牌缺失"与"真缺失"。
 * 由 Tushare 个股日线反推（source=tushare-daily-infer）或人工标记（source=manual）写入。
 */
export const stockSuspensionWindows = mysqlTable("stock_suspension_windows", {
  id: int("id").autoincrement().primaryKey(),
  /** 股票代码，如 600984.SH */
  stockCode: varchar("stockCode", { length: 20 }).notNull(),
  /** 停牌起始交易日（含） */
  startDate: date("startDate", { mode: "string" }).notNull(),
  /** 停牌结束交易日（含） */
  endDate: date("endDate", { mode: "string" }).notNull(),
  /** 来源：tushare-daily-infer（个股日线反推）或 manual（人工标记） */
  source: mysqlEnum("source", ["tushare-daily-infer", "manual"]).notNull(),
  /** 备注（如停牌原因） */
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  stockDateUnique: uniqueIndex("uq_suspension_stock_dates").on(table.stockCode, table.startDate, table.endDate),
  stockIdx: index("idx_suspension_stock").on(table.stockCode),
}));

export type StockSuspensionWindow = typeof stockSuspensionWindows.$inferSelect;
export type InsertStockSuspensionWindow = typeof stockSuspensionWindows.$inferInsert;

/**
 * 回测结果持久化表 - 保存用户手动保存的回测参数、摘要与完整结果，供历史回顾与多组对比。
 * paramsHash 由参数 JSON 稳定哈希得到，可用于「相同参数直接复用历史结果」的缓存/去重。
 */
export const backtestRuns = mysqlTable("backtest_runs", {
  id: int("id").autoincrement().primaryKey(),
  /** 参数 JSON 的 SHA-1 哈希，用于去重与快速命中 */
  paramsHash: varchar("paramsHash", { length: 64 }).notNull(),
  /** 回测参数快照（含观察天数/分数阈值/真实回测参数/下行风险参数） */
  paramsJson: text("paramsJson").notNull(),
  /** 摘要（扁平关键指标，供列表页快速展示） */
  summaryJson: text("summaryJson"),
  /** 完整回测结果（LeaderCandidateBacktestResult 序列化） */
  resultJson: longtext("resultJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  paramsHashIdx: index("idx_backtest_runs_hash").on(table.paramsHash),
  createdAtIdx: index("idx_backtest_runs_created").on(table.createdAt),
}));

export type BacktestRun = typeof backtestRuns.$inferSelect;
export type InsertBacktestRun = typeof backtestRuns.$inferInsert;

/**
 * 前向纸面交易运行表 - 一次「真实样本外」的纸面交易实验。
 * 每次推进（逐日成交/出清/标记市值）后把最新状态 JSON 回写，供服务重启后续跑。
 */
export const paperTradingRuns = mysqlTable("paper_trading_runs", {
  id: int("id").autoincrement().primaryKey(),
  /** 运行名称，如「前向纸面-基准策略」。 */
  label: varchar("label", { length: 120 }).notNull(),
  /** 策略 key：baseline / riskPenalty / hardFilter / qualityBlend / qualityGate。 */
  strategyKey: varchar("strategyKey", { length: 32 }).notNull(),
  /** 回测参数快照（含 realistic 成交/退出规则与 downsideRisk 参数）。 */
  paramsJson: text("paramsJson").notNull(),
  /** 初始资金（元）。 */
  initialCapital: int("initialCapital").notNull(),
  /** 运行状态：active（持续推进）/ paused（暂停）/ completed（已结束）。 */
  status: mysqlEnum("status", ["active", "paused", "completed"]).default("active").notNull(),
  /** 最近一次已处理交易日（前向曲线推进到的最新日期）。 */
  lastProcessedDate: date("lastProcessedDate", { mode: "string" }),
  /** 完整运行状态 JSON（现金/持仓/准备买入清单/订单/前向权益曲线）。 */
  stateJson: longtext("stateJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx: index("idx_paper_runs_status").on(table.status),
  createdAtIdx: index("idx_paper_runs_created").on(table.createdAt),
}));

export type PaperTradingRun = typeof paperTradingRuns.$inferSelect;
export type InsertPaperTradingRun = typeof paperTradingRuns.$inferInsert;
export const researchDatasets = mysqlTable("research_datasets", {
  id: int("id").autoincrement().primaryKey(),
  /** 数据集身份（DS-<datasetVersion>，内容指纹派生，唯一且确定性）。 */
  datasetId: varchar("datasetId", { length: 128 }).notNull().unique(),
  /** 内容指纹版本（rd-<builderVersion>-<rowSchemaVersion>-<16hex>）。 */
  datasetVersion: varchar("datasetVersion", { length: 96 }).notNull(),
  /** 数据集名称（仅描述，不进版本指纹）。 */
  name: varchar("name", { length: 128 }).notNull(),
  /** 起止日期（YYYY-MM-DD，含）。 */
  startDate: date("startDate", { mode: "string" }).notNull(),
  endDate: date("endDate", { mode: "string" }).notNull(),
  /** 逐日 PIT（true）或固定 asOf 快照（false）。 */
  asOfPerTradeDate: mysqlEnum("asOfPerTradeDate", ["true", "false"]).notNull().default("true"),
  /** 固定 asOf（仅 asOfPerTradeDate=false 时非空）。 */
  asOf: date("asOf", { mode: "string" }),
  /** 标准行内容指纹（SHA-256 前 32 hex）。 */
  rowsFingerprint: varchar("rowsFingerprint", { length: 64 }).notNull(),
  /** 9 类 policy 内容指纹（SHA-256 前 16 hex）。 */
  policySetFingerprint: varchar("policySetFingerprint", { length: 64 }).notNull(),
  /** 版本快照产物指纹（SHA-256 前 16 hex）。 */
  versionSnapshotFingerprint: varchar("versionSnapshotFingerprint", { length: 64 }).notNull(),
  /** 版本快照产物（buildDatasetVersionSnapshot 序列化，可 round-trip）。 */
  versionSnapshotJson: longtext("versionSnapshotJson").notNull(),
  /** 数据快照（DataSnapshot 序列化，含逐域加载事实）。 */
  dataSnapshotJson: longtext("dataSnapshotJson").notNull(),
  /** universe 定义（UniverseDefinition 序列化）。 */
  universeDefinitionJson: longtext("universeDefinitionJson").notNull(),
  /** 标准行数。 */
  rowCount: int("rowCount").notNull(),
  /** 构建 gate：FAIL / PASS / INCONCLUSIVE。 */
  gate: varchar("gate", { length: 16 }).notNull(),
  /** gate 说明（JSON 数组）。 */
  gateNotesJson: longtext("gateNotesJson").notNull(),
  /** 分片行表名（rd_rows_<buildKey>）；分片构建时落库，非分片（内存）构建为 null。 */
  rowsTableName: varchar("rowsTableName", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  versionIdx: index("idx_research_datasets_version").on(table.datasetVersion),
  nameIdx: index("idx_research_datasets_name").on(table.name),
  createdAtIdx: index("idx_research_datasets_created").on(table.createdAt),
}));

export type ResearchDatasetRow = typeof researchDatasets.$inferSelect;
export type InsertResearchDataset = typeof researchDatasets.$inferInsert;

// ===========================================================================
// STEP STRATEGY-002 — 策略持久化（strategies + strategy_versions）
// ===========================================================================

/**
 * 策略逻辑实体表 - 一个「策略族」的稳定身份与元数据。
 * 代表 StrategyDefinition 的持久化实体：strategyId 唯一、name、最新版本、生命周期状态、时间戳。
 * 版本内容不在本表，而在 strategy_versions（不可变版本表）；latestVersion 为冗余列，
 * 权威值在 strategy_versions 中，本列仅用于列表快速展示。
 */
export const strategies = mysqlTable("strategies", {
  id: int("id").autoincrement().primaryKey(),
  /** 策略稳定身份（如 "limit-up-baseline"），全局唯一。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull().unique(),
  /** 策略名称（仅描述，不进版本指纹）。 */
  name: varchar("name", { length: 128 }).notNull(),
  /** 最新版本号（major.minor.patch；冗余列，权威值在 strategy_versions）。 */
  latestVersion: varchar("latestVersion", { length: 32 }).notNull(),
  /** 生命周期状态（Draft/Research/...；由 lifecycle 层维护，本层只透传，默认 Draft）。 */
  status: varchar("status", { length: 32 }).notNull().default("Draft"),
  /** STEP STRATEGY-003：策略描述（人类可读，不进版本指纹）。 */
  description: varchar("description", { length: 512 }),
  /** STEP STRATEGY-003：策略类型标签（自由分类；本任务只落结构，不做枚举强校验）。 */
  strategyType: varchar("strategyType", { length: 32 }),
  /**
   * STEP STRATEGY-003：**权威当前版本指针** → strategy_versions.id（软引用，无 FK）。
   * 与 latestVersion 的关系：currentVersionId 为权威；latestVersion 降级为兼容性冗余列，
   * 由 service 层保证「latestVersion = 当前版本指针所指版本的 version」不漂移。
   */
  currentVersionId: int("currentVersionId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  strategyIdIdx: index("idx_strategies_strategy_id").on(table.strategyId),
  createdAtIdx: index("idx_strategies_created").on(table.createdAt),
  currentVersionIdx: index("idx_strategies_current_version").on(table.currentVersionId),
}));

export type StrategyRow = typeof strategies.$inferSelect;
export type InsertStrategy = typeof strategies.$inferInsert;

/**
 * 策略不可变版本表 - 一个 (strategyId, version) 的唯一、不可变版本快照。
 *
 * 存储口径（复用 STEP-001 strategySchema，不另造版本模型）：
 *   - strategyDocumentJson：serializeStrategyDocument(document)（§16 全字段本体，canonical JSON）；
 *   - versionRecordJson：serializeStrategyVersionRecord(record)（§17 九项追溯完整快照，含 parameterSet /
 *     backtestConfig / costModel / executionModel / codeVersion / createdAt）；
 *   - fingerprint：StrategyDocument.fingerprint（内容指纹，幂等/不可变判定键，§7/§18/§19）。
 *
 * 不可变 + 并发兜底：uniqueIndex (strategyId, version) 保证同版本只能有一行；
 * 禁止 UPDATE 已有版本的 strategyDocumentJson（改内容必须新建版本）。
 */
export const strategyVersions = mysqlTable("strategy_versions", {
  id: int("id").autoincrement().primaryKey(),
  /** 所属策略。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  /** 版本号（major.minor.patch，严格 semver）。 */
  version: varchar("version", { length: 32 }).notNull(),
  /** 序列化的 StrategyDocument（serializeStrategyDocument）。 */
  strategyDocumentJson: longtext("strategyDocumentJson").notNull(),
  /** 序列化的 StrategyVersionRecord（serializeStrategyVersionRecord，§17 九项追溯）。 */
  versionRecordJson: longtext("versionRecordJson").notNull(),
  /** 内容指纹（StrategyDocument.fingerprint；幂等/不可变判定键）。 */
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  /** 数据集版本（PRIMARY 绑定的 label / 快照，如 v2；legacy 绑定为 rd-…；权威值在 document 内）。 */
  datasetVersion: varchar("datasetVersion", { length: 96 }).notNull(),
  /**
   * STEP STRATEGY-004 — **Dataset Registry 权威坐标**（dataset_version.id，软引用，无 FK）。
   *
   * 与 `datasetVersion`（label / 快照）成对：本列是跨模块唯一 Dataset Version 引用，
   * `datasetVersion` 降级为显示与快照信息。legacy rd-… 绑定时为 NULL（保留旧兼容分支）。
   * 派生自 document.datasetVersionId（= definition.datasets PRIMARY 绑定的 datasetVersionId）。
   */
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  /** universe 标识（冗余列，便于查询）。 */
  universeId: varchar("universeId", { length: 128 }).notNull(),
  /** 代码版本（composeCodeVersion 产物）。 */
  codeVersion: varchar("codeVersion", { length: 64 }).notNull(),
  /**
   * STEP STRATEGY-003 — 父版本 → strategy_versions.id（软引用，无 FK，遵循项目既有原则）。
   * 表达版本演进链：cloneVersion 产出的新版本把本列指向源版本行 id。
   */
  parentVersionId: int("parentVersionId"),
  /** STEP STRATEGY-003：版本生命周期状态（复用 C-21.1 八态 Draft..Retired，不另造枚举）。 */
  status: varchar("status", { length: 32 }).notNull().default("Draft"),
  /** STEP STRATEGY-003：该版本变更说明（人类可读）。 */
  description: varchar("description", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /**
   * STEP STRATEGY-003：**唯一合法用途 = 状态迁移时间**。内容（strategyDocumentJson /
   * versionRecordJson / fingerprint）一经写入仍然禁止 UPDATE —— 改内容必须新建版本（§8）。
   */
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  strategyVersionUnique: uniqueIndex("uq_strategy_versions_id_version").on(table.strategyId, table.version),
  strategyIdIdx: index("idx_strategy_versions_strategy").on(table.strategyId),
  createdAtIdx: index("idx_strategy_versions_created").on(table.createdAt),
  parentVersionIdx: index("idx_strategy_versions_parent").on(table.parentVersionId),
  statusIdx: index("idx_strategy_versions_status").on(table.status),
}));

export type StrategyVersionRow = typeof strategyVersions.$inferSelect;
export type InsertStrategyVersion = typeof strategyVersions.$inferInsert;

// ===========================================================================
// STEP STRATEGY-003 — Strategy Domain Model 查询投影（5 张，全部由 canonical Definition 派生）
// ===========================================================================
//
// 🔴 Source of Truth 铁律（SPEC §46）：
//   `strategy_versions.strategyDocumentJson` 是**唯一**完整 StrategyDefinition（Canonical）。
//   以下 5 表只是**投影**（projection），由 canonical Definition 单向派生：
//       Canonical Definition ──► Parameters / Entry / Exit / Execution / Dataset 投影
//   **禁止**任何业务代码读取这 5 表后拼出一套「完整 Strategy」当作第二 Source of Truth；
//   需要权威语义时必须回到 strategyDocumentJson。
//   **禁止**反向生成（Projection → Canonical）。
//   写入纪律：canonical + 5 张投影 + 指纹在**同一事务**内落库，任一步失败整体回滚。

/**
 * 投影表 1/5 — strategy_parameters（ParameterDefinition 投影）。
 * `parameterRole = TUNABLE` 是可被未来 Parameter Search 直接消费的筛选键（本任务不实现搜索）。
 */
export const strategyParameters = mysqlTable("strategy_parameters", {
  id: int("id").autoincrement().primaryKey(),
  /** 所属版本 → strategy_versions.id（权威）。 */
  strategyVersionId: int("strategyVersionId").notNull(),
  /** 所属策略（冗余，便于直查，避免 JOIN）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** 参数 code（版本内唯一）。 */
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  /** number | string | boolean。 */
  dataType: varchar("dataType", { length: 16 }).notNull(),
  /** FIXED | TUNABLE | DERIVED。 */
  parameterRole: varchar("parameterRole", { length: 16 }).notNull(),
  /** 默认值 canonical JSON（可空）。 */
  defaultValueJson: longtext("defaultValueJson"),
  minValue: double("minValue"),
  maxValue: double("maxValue"),
  stepValue: double("stepValue"),
  unit: varchar("unit", { length: 32 }),
  description: varchar("description", { length: 512 }),
  required: boolean("required").notNull().default(false),
  /** 在 Definition.parameters 内的顺序（逐行比对用）。 */
  ordinal: int("ordinal").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  versionCodeUnique: uniqueIndex("uq_strategy_parameters_version_code").on(table.strategyVersionId, table.code),
  strategyIdx: index("idx_strategy_parameters_strategy").on(table.strategyId),
  roleIdx: index("idx_strategy_parameters_role").on(table.parameterRole),
}));

export type StrategyParameterRow = typeof strategyParameters.$inferSelect;

/**
 * 投影表 2/5 — strategy_entry_rules（EntryDefinition.conditions 投影）。
 * 每条 condition 一行；`ruleId` = condition.id，无 condition 时写一行 `ruleId="entry"`
 * 承载 event/window/trigger（保证投影始终能回答「研究什么事件、观察多久、何时触发」）。
 */
export const strategyEntryRules = mysqlTable("strategy_entry_rules", {
  id: int("id").autoincrement().primaryKey(),
  strategyVersionId: int("strategyVersionId").notNull(),
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  ruleId: varchar("ruleId", { length: 64 }).notNull(),
  /** CONDITION | EVENT_OBSERVATION。 */
  ruleType: varchar("ruleType", { length: 32 }).notNull(),
  eventType: varchar("eventType", { length: 48 }).notNull(),
  windowStart: int("windowStart").notNull(),
  windowEnd: int("windowEnd").notNull(),
  /** TRADING_DAY | CALENDAR_DAY。 */
  windowUnit: varchar("windowUnit", { length: 16 }).notNull(),
  triggerType: varchar("triggerType", { length: 32 }).notNull(),
  /** 该 condition 的 canonical JSON（无 condition 时为 NULL）。 */
  conditionJson: longtext("conditionJson"),
  /** EntryDefinition.conditions 总数（每行冗余，便于查询）。 */
  conditionCount: int("conditionCount").notNull(),
  priority: int("priority").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  versionRuleUnique: uniqueIndex("uq_strategy_entry_rules_version_rule").on(table.strategyVersionId, table.ruleId),
  strategyIdx: index("idx_strategy_entry_rules_strategy").on(table.strategyId),
  eventIdx: index("idx_strategy_entry_rules_event").on(table.eventType),
}));

export type StrategyEntryRuleRow = typeof strategyEntryRules.$inferSelect;

/** 投影表 3/5 — strategy_exit_rules（ExitDefinition.rules 投影）。 */
export const strategyExitRules = mysqlTable("strategy_exit_rules", {
  id: int("id").autoincrement().primaryKey(),
  strategyVersionId: int("strategyVersionId").notNull(),
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  ruleId: varchar("ruleId", { length: 64 }).notNull(),
  /** TAKE_PROFIT | STOP_LOSS | TIME_EXIT | SIGNAL_EXIT | FORCED_EXIT。 */
  ruleType: varchar("ruleType", { length: 32 }).notNull(),
  /** ON_OPEN | ON_CLOSE | INTRADAY | ON_ENTRY。 */
  triggerType: varchar("triggerType", { length: 32 }).notNull(),
  thresholdValue: double("thresholdValue"),
  /** RATIO | PERCENT | TRADING_DAY | PRICE。 */
  thresholdUnit: varchar("thresholdUnit", { length: 32 }),
  /** 阈值由参数表达时的参数 code。 */
  parameterCode: varchar("parameterCode", { length: 64 }),
  conditionJson: longtext("conditionJson"),
  priority: int("priority").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  ordinal: int("ordinal").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  versionRuleUnique: uniqueIndex("uq_strategy_exit_rules_version_rule").on(table.strategyVersionId, table.ruleId),
  strategyIdx: index("idx_strategy_exit_rules_strategy").on(table.strategyId),
  typeIdx: index("idx_strategy_exit_rules_type").on(table.ruleType),
}));

export type StrategyExitRuleRow = typeof strategyExitRules.$inferSelect;

/**
 * 投影表 4/5 — strategy_execution_rules（ExecutionDefinition 1:1 投影）。
 * signalTiming / executionTiming 严格分离：T_CLOSE 出信号 → T_PLUS_1_OPEN 成交（本项目 T+1 模型）。
 */
export const strategyExecutionRules = mysqlTable("strategy_execution_rules", {
  id: int("id").autoincrement().primaryKey(),
  strategyVersionId: int("strategyVersionId").notNull(),
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** T_OPEN | T_CLOSE。 */
  signalTiming: varchar("signalTiming", { length: 16 }).notNull(),
  /** T_CLOSE | T_PLUS_1_OPEN | T_PLUS_1_CLOSE | T_PLUS_2_OPEN。 */
  executionTiming: varchar("executionTiming", { length: 24 }).notNull(),
  /** OPEN | CLOSE | HIGH | LOW | VWAP。 */
  priceType: varchar("priceType", { length: 16 }).notNull(),
  /** FIXED_SHARES | TARGET_WEIGHT | AMOUNT。 */
  quantityMethod: varchar("quantityMethod", { length: 24 }).notNull(),
  lotSize: int("lotSize").notNull(),
  slippageModel: varchar("slippageModel", { length: 32 }),
  commissionModel: varchar("commissionModel", { length: 32 }),
  executionConstraintsJson: longtext("executionConstraintsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  versionUnique: uniqueIndex("uq_strategy_execution_rules_version").on(table.strategyVersionId),
  strategyIdx: index("idx_strategy_execution_rules_strategy").on(table.strategyId),
}));

export type StrategyExecutionRuleRow = typeof strategyExecutionRules.$inferSelect;

/**
 * 投影表 5/5 — strategy_version_datasets（Dataset 绑定**引用**）。
 * 只建立引用：不复制 Dataset 数据、不建 Dataset 表、不改 ds_* 物理结构（SPEC §21 / §33）。
 */
export const strategyVersionDatasets = mysqlTable("strategy_version_datasets", {
  id: int("id").autoincrement().primaryKey(),
  strategyVersionId: int("strategyVersionId").notNull(),
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** Dataset 标识（如 first_limit_pullback；legacy 形态为 ds_first_limit_pullback）。 */
  datasetId: varchar("datasetId", { length: 128 }).notNull(),
  /** Dataset 版本 label / 快照（如 v2）；legacy 绑定为 rd-… 内容寻址串。 */
  datasetVersion: varchar("datasetVersion", { length: 96 }).notNull(),
  /**
   * STEP STRATEGY-004 — **Dataset Registry 权威坐标**（dataset_version.id，软引用，无 FK）。
   *
   * 与 `datasetVersion`（label）成对：本列是跨模块唯一 Dataset Version 引用。
   * 写入前由应用层校验「dataset_version 存在 AND status=READY AND datasetId 一致」，
   * 校验不通过即拒绝保存（错误码见 strategyPersistence/datasetBindingValidation.ts）。
   * legacy rd-… 绑定时为 NULL（保留旧兼容分支）。
   */
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  /** PRIMARY | VALIDATION | OOS。 */
  role: varchar("role", { length: 16 }).notNull(),
  note: varchar("note", { length: 512 }),
  ordinal: int("ordinal").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  bindingUnique: uniqueIndex("uq_strategy_version_datasets_binding")
    .on(table.strategyVersionId, table.datasetId, table.datasetVersion, table.role),
  strategyIdx: index("idx_strategy_version_datasets_strategy").on(table.strategyId),
  datasetVersionIdx: index("idx_strategy_version_datasets_version").on(table.datasetVersion),
  datasetVersionIdIdx: index("idx_strategy_version_datasets_version_id").on(table.datasetVersionId),
  roleIdx: index("idx_strategy_version_datasets_role").on(table.role),
}));

export type StrategyVersionDatasetRow = typeof strategyVersionDatasets.$inferSelect;

/**
 * RESEARCH-006.1 — Strategy 侧的 Research 溯源**快照**（display-only）。
 *
 * 为什么必须有这张表（006.0 §4.2 F）：Research 侧的一切都可能消失 —— `research_result` 重算即
 * 被 `deleteByAnalysis` + 重建，`deleteExperimentCascade` 还会**连 candidate 一起删**。
 * 若溯源只存在 Research 侧，清理研究即永久失去「这个策略从哪来」。故必须在 Strategy 侧留**快照值**。
 *
 * 🔴 定位（防污染铁律）：
 *   - 本表是 **独立切面**，**不是** `strategy_versions` 的列，**更不是** `StrategyDocument` 的字段；
 *   - **禁止**把 research 字段写进 `strategyDocumentJson` / `definition` / 5 张投影 / 指纹；
 *   - **display-only**：不参与 validate / backtest / parameter search / simulation / execute 的任何读取路径。
 *     ⇒ Research 模块整个不可用时，Strategy Version **仍可独立运行**。
 *
 * 引用形态：**全部为快照值 + 零 FK**（项目既有原则）。`sourceXxxId` 即使上游行已删除也照样保留，
 * 「来源是否仍存在」只能在读取时探测并**如实标注**，不自动清理、不伪造。
 *
 * 唯一 Strategy 锚 = `strategyVersionId`（→ `strategy_versions.id`），`UNIQUE`：
 * 一个 Strategy Version 最多一条溯源。删除策略时由其应用层入口**显式同事务删除**（非级联，无 FK）。
 */
export const strategyResearchProvenance = mysqlTable("strategy_research_provenance", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 权威行锚 → `strategy_versions.id`（int，与 5 张投影表同型）。UNIQUE。 */
  strategyVersionId: int("strategyVersionId").notNull(),
  /** 冗余便于直查（与 5 张投影表同风格，避免 JOIN）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  /** semver 冗余快照。 */
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** 来源 `research_strategy_candidate.id`（**快照值，非 FK**）；独立实验来源为 NULL。 */
  sourceCandidateId: bigint("sourceCandidateId", { mode: "number" }),
  /** 来源 `research_conclusion.id`（**快照值，非 FK**）；独立实验来源为 NULL。 */
  sourceConclusionId: bigint("sourceConclusionId", { mode: "number" }),
  /** 来源 `research_experiment.id`（**快照值，非 FK**）；独立实验来源为 NULL。 */
  sourceExperimentId: bigint("sourceExperimentId", { mode: "number" }),
  /** 来源 `research_run.id`（可空：Conclusion 无 runId 列，部分证据提不出）。 */
  sourceResearchRunId: bigint("sourceResearchRunId", { mode: "number" }),
  /**
   * 来源体系（RESEARCH-EXPERIMENT-002 · migration `0045`）：
   * `RESEARCH_CONCLUSION`（旧 Research 链路）/ `INDEPENDENT_EXPERIMENT`（独立实验体系）。
   */
  sourceKind: varchar("sourceKind", { length: 32 }).notNull().default("RESEARCH_CONCLUSION"),
  /** 独立实验 id（`<group>/<key>`；软引用，非 FK）。 */
  experimentRef: varchar("experimentRef", { length: 96 }),
  /** 实验自身版本快照（`descriptor.version`）。 */
  experimentVersion: varchar("experimentVersion", { length: 32 }),
  /** 生成该策略时**实际使用**的实验参数快照（已归并默认值；写入即冻结）。 */
  experimentParametersJson: longtext("experimentParametersJson"),
  /** 实验结果的 canonical 指纹（sha256 前缀）—— 证明这份溯源对应的就是那一次运行。 */
  experimentResultDigest: varchar("experimentResultDigest", { length: 64 }),
  /** 研究**来源**坐标快照 → `dataset_version.id`（与 Strategy 执行绑定可不同，见 candidate 同名列）。 */
  sourceDatasetVersionId: bigint("sourceDatasetVersionId", { mode: "number" }),
  /** 来源 label 快照（`v1`/`v2`/`rd-…`），仅显示用；`sourceDatasetVersionId` 才是引用坐标。 */
  sourceDatasetLabel: varchar("sourceDatasetLabel", { length: 96 }),
  /** `sourceTraceJson` 的副本（含免责声明摘要）；display-only，不进任何执行路径。 */
  sourceSnapshotJson: longtext("sourceSnapshotJson"),
  /** DIRECT（promote 产出）/ INHERITED（cloneVersion 继承）。 */
  origin: varchar("origin", { length: 16 }).notNull().default("DIRECT"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  versionUnique: uniqueIndex("uq_strategy_research_provenance_version").on(table.strategyVersionId),
  strategyIdx: index("idx_strategy_research_provenance_strategy").on(table.strategyId),
  conclusionIdx: index("idx_strategy_research_provenance_conclusion").on(table.sourceConclusionId),
  candidateIdx: index("idx_strategy_research_provenance_candidate").on(table.sourceCandidateId),
}));

export type StrategyResearchProvenanceRow = typeof strategyResearchProvenance.$inferSelect;
export type InsertStrategyResearchProvenanceRow = typeof strategyResearchProvenance.$inferInsert;

/**
 * 全市场日线回填 checkpoint 表（STEP 7.3）。
 * 每个交易日一条记录：status / attempts / rowCount / receivedRows / completedAt / errorCode。
 * tradeDate 唯一，作为断点续传的事实来源。只有数据持久化成功后 status 才为 SUCCESS。
 */
export const backfillCheckpoints = mysqlTable("backfill_checkpoints", {
  id: int("id").autoincrement().primaryKey(),
  /** 交易日（YYYY-MM-DD），唯一。 */
  tradeDate: date("tradeDate", { mode: "string" }).notNull().unique(),
  /** 状态：PENDING / RUNNING / SUCCESS / FAILED / SUSPICIOUS / QUOTA_STOPPED。 */
  status: mysqlEnum("status", ["PENDING", "RUNNING", "SUCCESS", "FAILED", "SUSPICIOUS", "QUOTA_STOPPED"]).notNull().default("PENDING"),
  /** 重试/执行次数。 */
  attempts: int("attempts").notNull().default(0),
  /** 成功时写入的 stock-day 行数。 */
  rowCount: int("rowCount"),
  /** provider 返回的原始行数。 */
  receivedRows: int("receivedRows"),
  /** 完成时间（终态时非空）。 */
  completedAt: timestamp("completedAt"),
  /** 失败/可疑/配额停止时的错误码。 */
  errorCode: varchar("errorCode", { length: 64 }),
  /** 失败/可疑时的补充说明。 */
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx: index("idx_backfill_checkpoints_status").on(table.status),
  tradeDateIdx: index("idx_backfill_checkpoints_trade_date").on(table.tradeDate),
}));

export type BackfillCheckpointRow = typeof backfillCheckpoints.$inferSelect;
export type InsertBackfillCheckpoint = typeof backfillCheckpoints.$inferInsert;

// ===========================================================================
// STEP 7.6 — Historical Industry / Index / Liquidity 数据基础设施
// ===========================================================================

/**
 * 历史行业归属表 - 一只证券在「有效期」内归属某行业（effective_from 含、effective_to 含，null=至今）。
 * 严格区分「历史行业」与「当前行业」：禁止用当前行业回填历史。同一证券同一生效日唯一。
 */
export const industryAssignments = mysqlTable("industry_assignments", {
  id: int("id").autoincrement().primaryKey(),
  /** 永久身份（sec_<uuid>，软引用 research_securities；尚未回填时为 null）。 */
  securityId: varchar("securityId", { length: 48 }),
  /** 规范化证券代码（如 002361.SZ），历史行业归属的自然键。 */
  securityCode: varchar("securityCode", { length: 20 }).notNull(),
  /** 行业代码（如申万一级 801010）。 */
  industryCode: varchar("industryCode", { length: 32 }).notNull(),
  /** 行业名称（如 农林牧渔）。 */
  industryName: varchar("industryName", { length: 64 }).notNull(),
  /** 生效起始日（含）。 */
  effectiveFrom: date("effectiveFrom", { mode: "string" }).notNull(),
  /** 生效截止日（含）；null = 至今仍有效。 */
  effectiveTo: date("effectiveTo", { mode: "string" }),
  /** 来源（akshare-sw / tushare / manual）。 */
  source: varchar("source", { length: 32 }).notNull(),
  /** 本行数据写入/检索时间。 */
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
}, (table) => ({
  securityEffectiveUnique: uniqueIndex("uq_industry_assign_security_effective").on(table.securityCode, table.effectiveFrom),
  industryCodeIdx: index("idx_industry_assign_industry_code").on(table.industryCode),
}));

export type IndustryAssignmentRow = typeof industryAssignments.$inferSelect;
export type InsertIndustryAssignment = typeof industryAssignments.$inferInsert;

/**
 * 指数主数据表 - 一个「指数」的权威身份（code/name/首发日/来源），供 index identity 校验。
 */
export const indexMaster = mysqlTable("index_master", {
  id: int("id").autoincrement().primaryKey(),
  /** 规范化指数代码，如 000300.SH。 */
  indexCode: varchar("indexCode", { length: 32 }).notNull(),
  /** 指数名称，如 沪深300。 */
  indexName: varchar("indexName", { length: 64 }).notNull(),
  /** provider 名（tushare / sina / baostock / manual）。 */
  provider: varchar("provider", { length: 32 }).notNull(),
  /** provider 原生代码（如 sina 的 sh000300）。 */
  providerCode: varchar("providerCode", { length: 32 }).notNull(),
  /** 数据首日（可能未确认）。 */
  firstDate: date("firstDate", { mode: "string" }),
  /** 数据末日（可能未确认）。 */
  lastDate: date("lastDate", { mode: "string" }),
  /** 数据来源描述。 */
  source: varchar("source", { length: 64 }).notNull(),
  /** 检索时间。 */
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
}, (table) => ({
  indexProviderUnique: uniqueIndex("uq_index_master_code_provider").on(table.indexCode, table.provider),
  indexCodeIdx: index("idx_index_master_code").on(table.indexCode),
}));

export type IndexMasterRow = typeof indexMaster.$inferSelect;
export type InsertIndexMaster = typeof indexMaster.$inferInsert;

/**
 * 指数日线表 - 单位与 canonical 对齐：price 点、amount 千元、volume 手。
 */
export const indexDaily = mysqlTable("index_daily", {
  id: int("id").autoincrement().primaryKey(),
  indexCode: varchar("indexCode", { length: 32 }).notNull(),
  tradeDate: date("tradeDate", { mode: "string" }).notNull(),
  open: double("open"),
  high: double("high"),
  low: double("low"),
  close: double("close"),
  amount: double("amount"),
  volume: double("volume"),
  source: varchar("source", { length: 32 }).notNull(),
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
}, (table) => ({
  indexDateUnique: uniqueIndex("uq_index_daily_code_date").on(table.indexCode, table.tradeDate),
  tradeDateIdx: index("idx_index_daily_trade_date").on(table.tradeDate),
}));

export type IndexDailyRow = typeof indexDaily.$inferSelect;
export type InsertIndexDaily = typeof indexDaily.$inferInsert;

/**
 * 统一流动性日线表 - 换手率(%)/流通市值(元)/总市值(元)/成交额(千元)/成交量(手)。
 * 不可获取字段为 null（UNAVAILABLE），禁止推导伪造。
 */
export const liquidityDaily = mysqlTable("liquidity_daily", {
  id: int("id").autoincrement().primaryKey(),
  /** 永久身份（sec_<uuid>，软引用；尚未回填时为 null）。 */
  securityId: varchar("securityId", { length: 48 }),
  /** 规范化证券代码（如 002361.SZ），流动性日线的自然键。 */
  securityCode: varchar("securityCode", { length: 20 }).notNull(),
  tradeDate: date("tradeDate", { mode: "string" }).notNull(),
  /** 换手率（%）。 */
  turnoverRate: double("turnoverRate"),
  /** 流通市值（元）。 */
  circulationMarketCap: double("circulationMarketCap"),
  /** 总市值（元）。 */
  totalMarketCap: double("totalMarketCap"),
  /** 成交额（千元）。 */
  amount: double("amount"),
  /** 成交量（手）。 */
  volume: double("volume"),
  source: varchar("source", { length: 32 }).notNull(),
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
}, (table) => ({
  // 契约对齐（迁移 0023）：唯一索引主键落在自然键 securityCode（securityId 为可空软引用，
  // 若以 securityId 建唯一索引，NULL 行将无法阻止同一 securityCode+tradeDate 重复）。
  securityDateUnique: uniqueIndex("uq_liquidity_daily_security_date").on(table.securityCode, table.tradeDate),
  tradeDateIdx: index("idx_liquidity_daily_trade_date").on(table.tradeDate),
}));

export type LiquidityDailyRow = typeof liquidityDaily.$inferSelect;
export type InsertLiquidityDaily = typeof liquidityDaily.$inferInsert;

/**
 * 公司行为表 - 存储个股分红/送股/转增/配股/拆股/合股等影响历史价格与持仓数量的事件（provider-neutral）。
 * 价格口径与 stock_daily_prices 解耦：本表只存「事件与分解字段」，复权价为 Derived Layer（见 server/corporateActions）。
 * 数值字段沿用项目惯例以 varchar 存储（每股税前金额/每股送转配比例等）。
 */
export const corporateActions = mysqlTable("corporate_actions", {
  id: int("id").autoincrement().primaryKey(),
  /** 永久身份（sec_<uuid>，软引用；尚未对账到 Security Master 时为 null）。 */
  securityId: varchar("securityId", { length: 48 }),
  /** 规范化证券代码（如 600519.SH），公司行为的自然键。 */
  securityCode: varchar("securityCode", { length: 20 }).notNull(),
  /** 行为类型：dividend/bonus_issue/transfer/rights_issue/split/reverse_split/other */
  actionType: mysqlEnum("actionType", ["dividend", "bonus_issue", "transfer", "rights_issue", "split", "reverse_split", "other"]).notNull(),
  /** 生效日（除权除息日，价格在此日调整） */
  effectiveDate: date("effectiveDate", { mode: "string" }).notNull(),
  /** 股权登记日 */
  recordDate: date("recordDate", { mode: "string" }),
  /** 公告日 */
  announcementDate: date("announcementDate", { mode: "string" }),
  /** 每股现金分红（税前，元） */
  cashAmount: varchar("cashAmount", { length: 32 }),
  /** 每股送股数 */
  bonusRatio: varchar("bonusRatio", { length: 32 }),
  /** 每股转增数 */
  transferRatio: varchar("transferRatio", { length: 32 }),
  /** 每股配股数 */
  rightsRatio: varchar("rightsRatio", { length: 32 }),
  /** 配股价（元/股） */
  rightsPrice: varchar("rightsPrice", { length: 32 }),
  /** 拆/合股比例（split=1拆N / reverse_split=N合1） */
  splitRatio: varchar("splitRatio", { length: 32 }),
  /** provider 原始描述文本 */
  description: text("description"),
  /** 数据来源，如 baostock/tushare/manual */
  source: varchar("source", { length: 32 }).notNull(),
  /** 外部数据抓取/写入时间 */
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  // 同一证券代码同一生效日同类型事件唯一（避免重复导入）
  securityDateTypeUnique: uniqueIndex("uq_corporate_action_security_date_type").on(table.securityCode, table.effectiveDate, table.actionType),
  securityEffectiveIdx: index("idx_corporate_action_security_effective").on(table.securityCode, table.effectiveDate),
}));

export type CorporateActionRow = typeof corporateActions.$inferSelect;
export type InsertCorporateAction = typeof corporateActions.$inferInsert;

/**
 * 复权因子表 - 存储 provider 给出的累计复权因子（provider-neutral）。
 * foreFactor = 前复权因子（raw × fore = 前复权价），backFactor = 后复权因子（raw × back = 后复权价）。
 * 与 corporate_actions 互补：因子直接可用（无需 preClose），但不分解事件类型。
 */
export const adjustmentFactors = mysqlTable("adjustment_factors", {
  id: int("id").autoincrement().primaryKey(),
  /** 永久身份（sec_<uuid>，软引用；尚未对账到 Security Master 时为 null）。 */
  securityId: varchar("securityId", { length: 48 }),
  /** 规范化证券代码（如 600519.SH），复权因子的自然键。 */
  securityCode: varchar("securityCode", { length: 20 }).notNull(),
  /** 生效日（除权除息日） */
  effectiveDate: date("effectiveDate", { mode: "string" }).notNull(),
  /** 累计前复权因子（>0） */
  foreFactor: varchar("foreFactor", { length: 32 }).notNull(),
  /** 累计后复权因子（>0） */
  backFactor: varchar("backFactor", { length: 32 }).notNull(),
  /** 数据来源，如 baostock/tushare */
  source: varchar("source", { length: 32 }).notNull(),
  /** 外部数据抓取/写入时间 */
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  securityDateUnique: uniqueIndex("uq_adjustment_factor_security_date").on(table.securityCode, table.effectiveDate),
  securityDateIdx: index("idx_adjustment_factor_security_date").on(table.securityCode, table.effectiveDate),
}));

export type AdjustmentFactorRow = typeof adjustmentFactors.$inferSelect;
export type InsertAdjustmentFactor = typeof adjustmentFactors.$inferInsert;

/**
 * STEP 7.4 — 证券主数据表（Security Master，永久身份）。
 * security_id 是系统分配的稳定身份，与 stock_code 解耦；
 * listedDate / delistedDate 是 as-of universe 判定的权威时间界，status 为当前/最近已知快照。
 */
export const researchSecurities = mysqlTable("research_securities", {
  id: int("id").autoincrement().primaryKey(),
  /** 永久身份（系统分配，如 sec_<uuid>）。 */
  securityId: varchar("securityId", { length: 48 }).notNull().unique(),
  /** 证券类型。 */
  securityType: mysqlEnum("securityType", ["stock", "etf", "index", "bond", "fund"]).notNull().default("stock"),
  /** 当前交易所归属。 */
  exchange: mysqlEnum("exchange", ["SH", "SZ", "BJ"]).notNull(),
  /** 计价货币。 */
  currency: varchar("currency", { length: 8 }).notNull().default("CNY"),
  /** 上市地国家/地区代码。 */
  country: varchar("country", { length: 8 }).notNull().default("CN"),
  /** 生命周期状态快照（非时间序列，完整历史状态属 STEP 7.5）。 */
  status: mysqlEnum("status", ["listed", "suspended", "delisted", "terminated", "unknown"]).notNull().default("unknown"),
  /** 上市日期（含）。 */
  listedDate: date("listedDate", { mode: "string" }),
  /** 退市日期（含，最后一个可交易日）。 */
  delistedDate: date("delistedDate", { mode: "string" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  exchangeIdx: index("idx_research_securities_exchange").on(table.exchange),
  statusIdx: index("idx_research_securities_status").on(table.status),
}));

export type ResearchSecurity = typeof researchSecurities.$inferSelect;
export type InsertResearchSecurity = typeof researchSecurities.$inferInsert;

/**
 * STEP 7.4 — 证券标识符历史表（Identifier History）。
 * 关键约束：禁止 UNIQUE(securityCode) 全局永久约束；
 * 正确逻辑是「在有效时间区间内唯一」，区间重叠由应用层校验。
 * identifier history 与 name history 严格独立（本表不含 name）。
 */
export const researchSecurityIdentifierHistory = mysqlTable("research_security_identifier_history", {
  id: int("id").autoincrement().primaryKey(),
  /** 永久身份。 */
  securityId: varchar("securityId", { length: 48 }).notNull(),
  /** 交易所。 */
  exchange: mysqlEnum("exchange", ["SH", "SZ", "BJ"]).notNull(),
  /** 6 位数字代码（不含交易所后缀）。 */
  securityCode: varchar("securityCode", { length: 20 }).notNull(),
  /** 标识符类型。 */
  identifierType: mysqlEnum("identifierType", ["primary", "tushare_ts_code", "sina_symbol", "baostock_code", "tencent_symbol"]).notNull().default("primary"),
  /** 生效日期（含）。 */
  effectiveFrom: date("effectiveFrom", { mode: "string" }).notNull(),
  /** 失效日期（含）；null = 至今有效。 */
  effectiveTo: date("effectiveTo", { mode: "string" }),
  /** 来源 provider。 */
  source: varchar("source", { length: 32 }).notNull().default("unknown"),
  /** 抓取时间。 */
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
}, (table) => ({
  // 唯一性落在「区间起点」上避免重复区间；区间重叠由应用层 assertNoOverlap 校验。
  codeEffectiveUnique: uniqueIndex("uq_security_identifier_code_effective").on(table.exchange, table.securityCode, table.identifierType, table.effectiveFrom),
  securityIdx: index("idx_security_identifier_security").on(table.securityId),
  codeIdx: index("idx_security_identifier_code").on(table.exchange, table.securityCode),
  effectiveIdx: index("idx_security_identifier_effective").on(table.effectiveFrom, table.effectiveTo),
}));

export type ResearchSecurityIdentifier = typeof researchSecurityIdentifierHistory.$inferSelect;
export type InsertResearchSecurityIdentifier = typeof researchSecurityIdentifierHistory.$inferInsert;

/**
 * STEP 7.5 — 历史证券状态表（Historical Security Status / ST / Trading Status 时间序列）。
 * 关键约束：
 *   - securityId 为软引用 research_securities.securityId（sec_<uuid>，与 stock_code 解耦）；
 *     本表【不加 FK】，待 STEP 7.4 迁移落地、基线收敛后再按需补 FK。
 *   - 允许同一 (securityId, statusType, effectiveFrom) 存在多行（不同 retrievedAt/source 版本），
 *     因此【不设】唯一约束；as-of 取最新/最可信由应用层解析（server/securityStatus/timeline）。
 *   - statusValue 跨维度取值集合不同，用 varchar 承载；维度内枚举由应用层校验（server/securityStatus/validation）。
 */
export const researchSecurityStatusHistory = mysqlTable("research_security_status_history", {
  id: int("id").autoincrement().primaryKey(),
  /** 永久身份（sec_<uuid>）。 */
  securityId: varchar("securityId", { length: 48 }).notNull(),
  /** 状态维度。 */
  statusType: mysqlEnum("statusType", ["LISTING", "TRADING", "ST", "DELISTING", "SUSPENSION"]).notNull(),
  /** 维度内取值（如 ST / *ST / TRADING / SUSPENDED）。 */
  statusValue: varchar("statusValue", { length: 32 }).notNull(),
  /** 生效日（含）。 */
  effectiveFrom: date("effectiveFrom", { mode: "string" }).notNull(),
  /** 失效日（含）；null = 至今。 */
  effectiveTo: date("effectiveTo", { mode: "string" }),
  /** 来源。 */
  source: varchar("source", { length: 64 }).notNull(),
  /** 抓取时间；null = 未知。 */
  retrievedAt: timestamp("retrievedAt"),
  /** 置信度。 */
  confidence: mysqlEnum("confidence", ["high", "medium", "low"]).notNull(),
  /** 发布时间语义。 */
  availability: mysqlEnum("availability", ["IMMEDIATE", "T_PLUS_1", "UNKNOWN"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  securityStatusIdx: index("idx_security_status_security_type_from").on(table.securityId, table.statusType, table.effectiveFrom),
  statusEffectiveIdx: index("idx_security_status_type_from").on(table.statusType, table.effectiveFrom),
}));

export type ResearchSecurityStatusHistory = typeof researchSecurityStatusHistory.$inferSelect;
export type InsertResearchSecurityStatusHistory = typeof researchSecurityStatusHistory.$inferInsert;

// ===========================================================================
// STEP DATASET-001 — Dataset Registry + 首板回踩 Dataset 独立物理表
// ===========================================================================
// 命名规范：物理表 ds_{dataset_code}_{role}（role ∈ event/path/outcome/feature）。
// 一个逻辑 Dataset = 一组固定物理表；多个 Version 用 dataset_version_id 隔离，禁止一版一表。
// Dataset 只描述客观事实，禁止绑定 Strategy；不复制公共 OHLCV（stock_daily_prices）。
// path.relative_day 必须用交易日历（Trading Calendar），禁止自然日 +1。

/**
 * Dataset Registry：逻辑 Dataset 定义（dataset_definition）。
 * datasetCode 业务唯一且稳定；event/path/outcome/feature 物理表名显式落库（不运行时猜名）。
 */
export const datasetDefinitions = mysqlTable("dataset_definition", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 稳定语义代码（lowercase snake_case，不含 version/date/env/uuid）。 */
  datasetCode: varchar("datasetCode", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  /** EVENT / FACTOR / ML / RESEARCH。 */
  datasetType: varchar("datasetType", { length: 32 }).notNull(),
  /** DATABASE（未来可 PARQUET / OBJECT_STORAGE，当前不过度设计）。 */
  storageType: varchar("storageType", { length: 32 }).notNull(),
  /** ACTIVE / ARCHIVED。 */
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  eventTableName: varchar("eventTableName", { length: 128 }),
  prefixTableName: varchar("prefixTableName", { length: 128 }),
  postTableName: varchar("postTableName", { length: 128 }),
  pathTableName: varchar("pathTableName", { length: 128 }),
  outcomeTableName: varchar("outcomeTableName", { length: 128 }),
  featureTableName: varchar("featureTableName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  datasetTypeIdx: index("idx_dataset_definition_type").on(table.datasetType),
  statusIdx: index("idx_dataset_definition_status").on(table.status),
}));

export type DatasetDefinitionRow = typeof datasetDefinitions.$inferSelect;
export type InsertDatasetDefinition = typeof datasetDefinitions.$inferInsert;

/**
 * Dataset Registry：逻辑版本（dataset_version）。Version 是逻辑版本，不是物理表。
 * (datasetId, version) 唯一；数据通过 dataset_version_id 在物理表中隔离。
 */
export const datasetVersions = mysqlTable("dataset_version", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 dataset_definition.id（项目惯例：不加 FK）。 */
  datasetId: bigint("datasetId", { mode: "number" }).notNull(),
  version: varchar("version", { length: 32 }).notNull(),
  /** DRAFT / BUILDING / READY / FAILED。 */
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
  startDate: date("startDate", { mode: "string" }),
  endDate: date("endDate", { mode: "string" }),
  universeDefinitionJson: longtext("universeDefinitionJson"),
  filterDefinitionJson: longtext("filterDefinitionJson"),
  featureVersion: varchar("featureVersion", { length: 32 }),
  sourceVersion: varchar("sourceVersion", { length: 32 }),
  totalEvents: bigint("totalEvents", { mode: "number" }),
  totalRows: bigint("totalRows", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  datasetVersionUnique: uniqueIndex("uq_dataset_version_dataset_version").on(table.datasetId, table.version),
  datasetIdx: index("idx_dataset_version_dataset").on(table.datasetId),
  statusIdx: index("idx_dataset_version_status").on(table.status),
}));

export type DatasetVersionRow = typeof datasetVersions.$inferSelect;
export type InsertDatasetVersion = typeof datasetVersions.$inferInsert;

/**
 * Dataset Registry：构建作业（dataset_build_job）。支持 PENDING/RUNNING/COMPLETED/FAILED/CANCELLED
 * 与 checkpoint/resume（lastSymbol/lastTradeDate/lastCursor）。
 */
export const datasetBuildJobs = mysqlTable("dataset_build_job", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  jobId: varchar("jobId", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  totalChunks: bigint("totalChunks", { mode: "number" }),
  completedChunks: bigint("completedChunks", { mode: "number" }),
  currentChunk: bigint("currentChunk", { mode: "number" }),
  processedRows: bigint("processedRows", { mode: "number" }),
  failedRows: bigint("failedRows", { mode: "number" }),
  lastSymbol: varchar("lastSymbol", { length: 32 }),
  lastTradeDate: date("lastTradeDate", { mode: "string" }),
  /** checkpoint JSON（含 prevLimitUp + cumulative 滚动状态，随构建增长），用 longtext 避免 TEXT 64KB 上限。 */
  lastCursor: longtext("lastCursor"),
  startedAt: timestamp("startedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
  errorMessage: text("errorMessage"),
}, (table) => ({
  versionIdx: index("idx_dataset_build_job_version").on(table.datasetVersionId),
  statusIdx: index("idx_dataset_build_job_status").on(table.status),
}));

export type DatasetBuildJobRow = typeof datasetBuildJobs.$inferSelect;
export type InsertDatasetBuildJob = typeof datasetBuildJobs.$inferInsert;

/**
 * Dataset Registry：构建/筛选配置（dataset_build_config，STEP DATASET-003B）。
 *
 * 与 dataset_version **一对一**（uq_dataset_build_config_version）：配置是「这一版取了哪些数据」的
 * 生成参数，与版本同生共死，是复现该版本的权威依据。
 *
 * 分层：
 *   - 本表 = 标量维度（排除 ST / t 前窗口 / t 后窗口 / 结果视界 / 批大小）；
 *   - dataset_build_config_event = 事件维度（相对日 × 事件类型，多值）；
 *   - dataset_build_config_board = 板块（多值）。
 * 不做纯 JSON 存放是为了让「按板块 / 事件维度反查哪些版本」可直接走索引。
 */
export const datasetBuildConfigs = mysqlTable("dataset_build_config", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 dataset_version.id（一对一）。 */
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  /** 是否排除 ST/*ST（PIT st 维度，不依赖股票名称）。 */
  excludeSt: boolean("excludeSt").notNull().default(false),
  /** t 日之前的数据天数（前置窗口，0 = 不取前置历史行）。 */
  preWindowDays: int("preWindowDays").notNull().default(0),
  /** t 日之后的数据天数（后置窗口，等价旧 pathHorizon）。 */
  postWindowDays: int("postWindowDays").notNull().default(20),
  /** 结果视界（交易日，JSON 数组；执行参数，非筛选维度）。 */
  outcomeHorizonsJson: longtext("outcomeHorizonsJson"),
  /** 批插入大小（执行参数）。 */
  batchSize: int("batchSize").notNull().default(1000),
  /** 配置 schema 版本（前向兼容：未来新增维度时据此解释旧行）。 */
  configVersion: int("configVersion").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  versionUnique: uniqueIndex("uq_dataset_build_config_version").on(table.datasetVersionId),
}));

export type DatasetBuildConfigRow = typeof datasetBuildConfigs.$inferSelect;
export type InsertDatasetBuildConfig = typeof datasetBuildConfigs.$inferInsert;

/**
 * 构建/筛选配置：事件维度（相对日 × 事件类型，多值，OR 语义）。
 * relativeDay ≤ 0：0 = t 日（事件日当天），-1 = t-1 日，-2 = t-2 日……
 */
export const datasetBuildConfigEvents = mysqlTable("dataset_build_config_event", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 dataset_build_config.id（一对多）。 */
  configId: bigint("configId", { mode: "number" }).notNull(),
  /** 事件锚点相对日（≤0；0 = t 日）。 */
  relativeDay: int("relativeDay").notNull(),
  /** 事件类型：firstBoard / limitUp / consecutiveBoard。 */
  eventKind: varchar("eventKind", { length: 32 }).notNull(),
  /** 展示顺序（保持用户选择顺序，确定性）。 */
  sortOrder: int("sortOrder").notNull().default(0),
}, (table) => ({
  configIdx: index("idx_dbc_event_config").on(table.configId),
  eventUnique: uniqueIndex("uq_dbc_event_config_day_kind").on(table.configId, table.relativeDay, table.eventKind),
}));

export type DatasetBuildConfigEventRow = typeof datasetBuildConfigEvents.$inferSelect;
export type InsertDatasetBuildConfigEvent = typeof datasetBuildConfigEvents.$inferInsert;

/**
 * 构建/筛选配置：板块（多值）。空 = 不过滤（全板块含 unknown）。
 * 取值与 server/data/boardRules.classifyBoard 输出一致：main / chinext / star / bse。
 */
export const datasetBuildConfigBoards = mysqlTable("dataset_build_config_board", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 dataset_build_config.id（一对多）。 */
  configId: bigint("configId", { mode: "number" }).notNull(),
  /** 板块类别（main / chinext / star / bse）。 */
  board: varchar("board", { length: 32 }).notNull(),
  /** 展示顺序。 */
  sortOrder: int("sortOrder").notNull().default(0),
}, (table) => ({
  configIdx: index("idx_dbc_board_config").on(table.configId),
  boardUnique: uniqueIndex("uq_dbc_board_config_board").on(table.configId, table.board),
}));

export type DatasetBuildConfigBoardRow = typeof datasetBuildConfigBoards.$inferSelect;
export type InsertDatasetBuildConfigBoard = typeof datasetBuildConfigBoards.$inferInsert;

/**
 * 首板回踩 Dataset：event（一行 = 一只股票某交易日一次事件）。
 *
 * **只存事件身份 + 时点属性，不含逐日行情**（`open`/`high`/`low`/`close`/`volume`/`amount`
 * 已下移到 `prefix` 的 `relativeDay = 0` 行；跨表 t 日重复由此消除）。
 * `previousClose` / `limitUpPrice` **不下移** —— 涨停判定依据，`preWindowDays = 0` 时
 * `prefix` 无 `rd = -1` 行，下移会导致 `limitUpPrice` 不可回溯。
 * `turnover` / `marketCap` / `floatMarketCap` 来自流动性富集（`liquidity_daily`），
 * **不是日线原始字段**，故同样留在 event，避免把富集列混进特征窗口表。
 *
 * 首板判定复用 server/data/boardRules（涨跌停权威）+ PIT ST（research_security_status_history），
 * 禁止硬编码统一 +10%。
 */
export const firstLimitPullbackEvents = mysqlTable("ds_first_limit_pullback_event", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  eventId: varchar("eventId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  tradeDate: date("tradeDate", { mode: "string" }).notNull(),
  market: varchar("market", { length: 16 }),
  industryCode: varchar("industryCode", { length: 32 }),
  boardType: varchar("boardType", { length: 32 }),
  previousClose: double("previousClose"),
  limitUpPrice: double("limitUpPrice"),
  limitDownPrice: double("limitDownPrice"),
  limitRuleUp: double("limitRuleUp"),
  limitRuleDown: double("limitRuleDown"),
  limitRuleVersion: varchar("limitRuleVersion", { length: 32 }),
  turnover: double("turnover"),
  isFirstLimit: boolean("isFirstLimit"),
  previousLimitDate: date("previousLimitDate", { mode: "string" }),
  daysSincePreviousLimit: int("daysSincePreviousLimit"),
  historicalLimitCount: int("historicalLimitCount"),
  marketCap: double("marketCap"),
  floatMarketCap: double("floatMarketCap"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  eventVersionUnique: uniqueIndex("uq_ds_flp_event_version_event").on(table.datasetVersionId, table.eventId),
  versionDateIdx: index("idx_ds_flp_event_version_date").on(table.datasetVersionId, table.tradeDate),
  symbolDateIdx: index("idx_ds_flp_event_symbol_date").on(table.symbol, table.tradeDate),
}));

export type FirstLimitPullbackEventRow = typeof firstLimitPullbackEvents.$inferSelect;
export type InsertFirstLimitPullbackEvent = typeof firstLimitPullbackEvents.$inferInsert;

/**
 * 首板回踩 Dataset：原始行情窗口（`prefix` / `post` **同构**，仅 relativeDay 区间不同）。
 *
 * - `prefix`：`relativeDay ∈ [-preWindowDays, 0]` —— t 日**及之前**的原始行情，
 *   是 **PIT 安全**的特征来源；**禁止**出现任何 `*FromEventClose` / `isBreakout` 列（结构级防线）。
 * - `post`：`relativeDay ∈ [1, postWindowDays]` —— t 日**之后**的原始行情，供精确回测撮合与标签计算。
 *
 * 两表结构逐字段一致（不变量 I10），拆列不拆行：行数与旧 `path` 相同，不翻倍。
 */
export const firstLimitPullbackPrefixes = mysqlTable("ds_first_limit_pullback_prefix", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  eventId: varchar("eventId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  tradeDate: date("tradeDate", { mode: "string" }).notNull(),
  /** ∈ [-preWindowDays, 0]；0 = t 日（D0）。 */
  relativeDay: int("relativeDay").notNull(),
  open: double("open"),
  high: double("high"),
  low: double("low"),
  close: double("close"),
  /** 原始日线前收（含除权口径）；旧版本为 NULL。 */
  preClose: double("preClose"),
  volume: double("volume"),
  amount: double("amount"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  prefixVersionEventDayUnique: uniqueIndex("uq_ds_flp_prefix_version_event_day").on(table.datasetVersionId, table.eventId, table.relativeDay),
  eventDayIdx: index("idx_ds_flp_prefix_event_day").on(table.eventId, table.relativeDay),
  symbolDateIdx: index("idx_ds_flp_prefix_symbol_date").on(table.symbol, table.tradeDate),
  versionDayIdx: index("idx_ds_flp_prefix_version_day").on(table.datasetVersionId, table.relativeDay),
}));

export type FirstLimitPullbackPrefixRow = typeof firstLimitPullbackPrefixes.$inferSelect;
export type InsertFirstLimitPullbackPrefix = typeof firstLimitPullbackPrefixes.$inferInsert;

/** 首板回踩 Dataset：`post`（`relativeDay ∈ [1, postWindowDays]`，与 `prefix` 严格同构）。 */
export const firstLimitPullbackPosts = mysqlTable("ds_first_limit_pullback_post", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  eventId: varchar("eventId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  tradeDate: date("tradeDate", { mode: "string" }).notNull(),
  /** ∈ [1, postWindowDays]。 */
  relativeDay: int("relativeDay").notNull(),
  open: double("open"),
  high: double("high"),
  low: double("low"),
  close: double("close"),
  /** 原始日线前收（含除权口径）；旧版本为 NULL。 */
  preClose: double("preClose"),
  /** 交易所口径涨停价（分价四舍五入）；旧版本为 NULL。 */
  limitUpPrice: double("limitUpPrice"),
  /** 交易所口径跌停价（分价四舍五入）；旧版本为 NULL。 */
  limitDownPrice: double("limitDownPrice"),
  limitRuleUp: double("limitRuleUp"),
  limitRuleDown: double("limitRuleDown"),
  limitRuleVersion: varchar("limitRuleVersion", { length: 32 }),
  barPresent: boolean("barPresent"),
  suspensionStatus: varchar("suspensionStatus", { length: 16 }),
  suspensionSource: varchar("suspensionSource", { length: 24 }),
  openAtLimitUp: boolean("openAtLimitUp"),
  closeAtLimitDown: boolean("closeAtLimitDown"),
  oneWordLimitUp: boolean("oneWordLimitUp"),
  oneWordLimitDown: boolean("oneWordLimitDown"),
  canBuyAtOpen: boolean("canBuyAtOpen"),
  canSellAtClose: boolean("canSellAtClose"),
  volume: double("volume"),
  amount: double("amount"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  postVersionEventDayUnique: uniqueIndex("uq_ds_flp_post_version_event_day").on(table.datasetVersionId, table.eventId, table.relativeDay),
  eventDayIdx: index("idx_ds_flp_post_event_day").on(table.eventId, table.relativeDay),
  symbolDateIdx: index("idx_ds_flp_post_symbol_date").on(table.symbol, table.tradeDate),
  versionDayIdx: index("idx_ds_flp_post_version_day").on(table.datasetVersionId, table.relativeDay),
}));

export type FirstLimitPullbackPostRow = typeof firstLimitPullbackPosts.$inferSelect;
export type InsertFirstLimitPullbackPost = typeof firstLimitPullbackPosts.$inferInsert;

/**
 * 首板回踩 Dataset：path（一行 = 一个 event + 一个 relative trading day，`relativeDay ≥ 1`）。
 *
 * **只存相对事件价的衍生指标**（前视，仅用于打标签）——原始行情在 `post`，两者由
 * `(datasetVersionId, eventId, relativeDay)` 一一对应（不变量 I10）。
 * `relative_day` 由交易日历推进，D+1 = 下一交易日（周五 D0 → 下周一 D+1）。
 */
export const firstLimitPullbackPaths = mysqlTable("ds_first_limit_pullback_path", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  eventId: varchar("eventId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  tradeDate: date("tradeDate", { mode: "string" }).notNull(),
  relativeDay: int("relativeDay").notNull(),
  highFromEventClose: double("highFromEventClose"),
  lowFromEventClose: double("lowFromEventClose"),
  closeFromEventClose: double("closeFromEventClose"),
  pullbackFromEventHigh: double("pullbackFromEventHigh"),
  volumeRatio: double("volumeRatio"),
  isBreakout: boolean("isBreakout"),
  breakoutPrice: double("breakoutPrice"),
  daysToBreakout: int("daysToBreakout"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  pathVersionEventDayUnique: uniqueIndex("uq_ds_flp_path_version_event_day").on(table.datasetVersionId, table.eventId, table.relativeDay),
  eventDayIdx: index("idx_ds_flp_path_event_day").on(table.eventId, table.relativeDay),
  symbolDateIdx: index("idx_ds_flp_path_symbol_date").on(table.symbol, table.tradeDate),
  versionDayIdx: index("idx_ds_flp_path_version_day").on(table.datasetVersionId, table.relativeDay),
}));

export type FirstLimitPullbackPathRow = typeof firstLimitPullbackPaths.$inferSelect;
export type InsertFirstLimitPullbackPath = typeof firstLimitPullbackPaths.$inferInsert;

/**
 * 首板回踩 Dataset：outcome（一行 = 一个 event + 一个 horizon 的未来结果）。
 * Outcome 是研究结果，不是实时交易信号；Backtest Signal 不得读取本表未来结果。
 */
export const firstLimitPullbackOutcomes = mysqlTable("ds_first_limit_pullback_outcome", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  eventId: varchar("eventId", { length: 64 }).notNull(),
  horizon: int("horizon").notNull(),
  maxReturn: double("maxReturn"),
  minReturn: double("minReturn"),
  maxDrawdown: double("maxDrawdown"),
  isBreakout: boolean("isBreakout"),
  daysToBreakout: int("daysToBreakout"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  outcomeVersionEventHorizonUnique: uniqueIndex("uq_ds_flp_outcome_version_event_horizon").on(table.datasetVersionId, table.eventId, table.horizon),
  eventHorizonIdx: index("idx_ds_flp_outcome_event_horizon").on(table.eventId, table.horizon),
}));

export type FirstLimitPullbackOutcomeRow = typeof firstLimitPullbackOutcomes.$inferSelect;
export type InsertFirstLimitPullbackOutcome = typeof firstLimitPullbackOutcomes.$inferInsert;
export const researchStrategyCandidate = mysqlTable("research_strategy_candidate", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_experiment.id。 */
  experimentId: bigint("experimentId", { mode: "number" }).notNull(),
  /** 软引用 research_conclusion.id。 */
  conclusionId: bigint("conclusionId", { mode: "number" }),
  /** 软引用 strategies.strategyId（varchar 业务键）；**NULL = 未转正**。 */
  strategyDefinitionId: varchar("strategyDefinitionId", { length: 64 }),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  entryRuleJson: longtext("entryRuleJson"),
  filterRuleJson: longtext("filterRuleJson"),
  exitRuleJson: longtext("exitRuleJson"),
  riskRuleJson: longtext("riskRuleJson"),
  parameterSpaceJson: longtext("parameterSpaceJson"),
  /**
   * RESEARCH-006.1 — 研究**来源** Dataset 坐标快照 = `dataset_version.id`（软引用，无 FK）。
   *
   * 语义 = 「这个 Candidate 是基于哪一份数据算出来的」，**不是**「未来 Strategy 执行用哪份数据」
   * （后者是 `strategy_versions.datasetVersionId`）。写入时从 `research_experiment.datasetVersionId`
   * 复制，**之后不随上游变化**（上游改不了：该列创建即冻结）。
   *
   * 唯一口径：`datasetVersionId = dataset_version.id`。**禁止**用 `datasetVersion`（label）/
   * `datasetId + version` / 第二套 `researchDatasetVersionId` 作为引用坐标。
   */
  sourceDatasetVersionId: bigint("sourceDatasetVersionId", { mode: "number" }),
  /**
   * RESEARCH-006.1 — 来源 Research Run id（软引用，无 FK，**可空**）。
   *
   * `research_conclusion` **没有 runId 列**，只能经 `evidenceJson.primaryAnalysis.analysisId →
   * research_analysis.runId` 两跳解析；**解析不出即 NULL，禁止伪造**（空值 = 如实承认缺失）。
   */
  sourceResearchRunId: bigint("sourceResearchRunId", { mode: "number" }),
  /**
   * RESEARCH-PLANNER-001 — 来源 Research Plan id（软引用 `research_plan.id`，**可空**）。
   *
   * 🔴 任务书 §16 要求 Candidate 保留完整 provenance：
   * `researchId / researchRunId / researchPlanId / datasetVersionId / findingIds / conclusionId`。
   * 前五项在本表已有对应列，只有 `researchPlanId` 缺位 —— 而它恰恰是**唯一能回答
   * 「这条候选是按哪份自动生成的计划做出来的」**的锚点：没有它，事后无法区分
   * 「自动规划产出的候选」与「专家手工堆分析产出的候选」，也无法回看当时被裁剪掉了什么。
   *
   * 为什么是**列**而不是塞进 `sourceTraceJson`：本表已确立的分工是
   * 「JSON 存证据快照，列存**可检索的谱系锚点**」。计划 id 需要被反查
   * （「这份计划产出了哪些候选」），属于锚点而非快照。
   *
   * 可空且**不 backfill**：本列生效前的候选走的是人工路径，没有计划来源，如实置 NULL。
   */
  sourceResearchPlanId: bigint("sourceResearchPlanId", { mode: "number" }),
  /**
   * RESEARCH-006.1 — 研究证据**快照**（provenance snapshot，不是 `research_result` 的第二份存储）。
   *
   * 内容以调用时的 Conclusion / Evidence 实际结构为准（如 conclusionId / analysisId /
   * metricCode / effectLabel / disclaimer 摘要）。因为 Evidence 引用的 Result **会被重算覆盖**，
   * 只有快照才能保证「当初凭什么」可长期回答。
   */
  sourceTraceJson: longtext("sourceTraceJson"),
  /**
   * RESEARCH-006.1 — Research Source Dataset 与 Strategy Execution Dataset **不同**时的原因。
   *
   * 仅当两者确实不同才允许非空；一致时**必须为 NULL**（禁止填无意义默认文本凑数）。
   * 两者允许不同（研究验证机制、执行覆盖更长历史是合法路径），但必须显式留痕。
   */
  sourceDatasetDivergenceReason: varchar("sourceDatasetDivergenceReason", { length: 512 }),
  /** DRAFT / REVIEW / ACCEPTED / REJECTED / CONVERTED / ARCHIVED。 */
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
  /**
   * RESEARCH-FINDING-001（2026-09-16）—— 来源 Hypothesis（软引用 `research_hypothesis.id`，可空）。
   *
   * 为什么可空：本列生效前已存在的 9 条 Candidate 走的是 `Conclusion → Candidate` 老路径，
   * 没有假设环节。**不 backfill 伪造**，如实置 NULL（= 该候选无假设来源）。
   * 新路径 `Hypothesis → Candidate`（`service.createFromHypothesis`）必须写入本列。
   */
  sourceHypothesisId: bigint("sourceHypothesisId", { mode: "number" }),
  /**
   * RESEARCH-FINDING-001 —— 来源 Finding id 数组（JSON；软引用 `research_finding.id`）。
   *
   * 与 `sourceTraceJson` 的区别：`sourceTraceJson` 是**证据快照**（防 Result 被重算覆盖），
   * 本列是**可检索的谱系锚点**（回答「这条候选能回溯到哪几条发现」）。
   * 允许为空数组（= 该候选不经 Finding 直接由 Conclusion 产生）。
   */
  sourceFindingIdsJson: longtext("sourceFindingIdsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  experimentIdx: index("idx_research_candidate_experiment").on(table.experimentId),
  conclusionIdx: index("idx_research_candidate_conclusion").on(table.conclusionId),
  statusIdx: index("idx_research_candidate_status").on(table.status),
  strategyIdx: index("idx_research_candidate_strategy").on(table.strategyDefinitionId),
  hypothesisIdx: index("idx_research_candidate_hypothesis").on(table.sourceHypothesisId),
  sourceDatasetVersionIdx: index("idx_research_candidate_source_dataset_version").on(
    table.sourceDatasetVersionId,
  ),
}));

export type ResearchStrategyCandidateTableRow = typeof researchStrategyCandidate.$inferSelect;
export type InsertResearchStrategyCandidateRow = typeof researchStrategyCandidate.$inferInsert;
export const closedLoopBacktestRun = mysqlTable("closed_loop_backtest_run", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 闭环运行 id（`loopRun` 返回的 runId，形如 `clrun-…`）。UNIQUE：重试幂等收敛为一行。 */
  runId: varchar("runId", { length: 80 }).notNull(),
  /** 谱系锚点（§28 实验谱系）。 */
  experimentId: varchar("experimentId", { length: 80 }).notNull(),
  /** 策略坐标快照（软引用，无 FK）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** 回测窗口（含两端）。 */
  startDate: date("startDate", { mode: "string" }).notNull(),
  endDate: date("endDate", { mode: "string" }).notNull(),
  /** Dataset label 快照（仅显示用）。 */
  datasetVersion: varchar("datasetVersion", { length: 96 }),
  /** 真实 Dataset 坐标 → `dataset_version.id`（软引用）；直读未命中时为 NULL。 */
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  /** 数据来源：`registry`（直读已落库数据集）| `rebuild`（回落从零重建）。 */
  datasetSource: varchar("datasetSource", { length: 16 }),
  /** 本次使用的配方 id（装配层记录的事实，软引用）。 */
  recipeId: varchar("recipeId", { length: 96 }),
  /** 整体状态：ALL_EXECUTED / PARTIAL_BLOCKED / NO_STAGE_EXECUTED。 */
  status: varchar("status", { length: 24 }).notNull(),
  executedStageCount: int("executedStageCount").notNull(),
  blockedStageCount: int("blockedStageCount").notNull(),
  skippedStageCount: int("skippedStageCount").notNull(),
  /** 首个阻塞原因码（无阻塞为 NULL）。 */
  firstBlockedReasonCode: varchar("firstBlockedReasonCode", { length: 64 }),
  /** 摘要：初始资金（元）—— 仅列表页展示，权威值在 `resultJson`。 */
  initialCapital: double("initialCapital"),
  /** 摘要：期末权益（元）。 */
  finalEquity: double("finalEquity"),
  /** 摘要：成交笔数。 */
  tradeCount: int("tradeCount"),
  /** 摘要：权益曲线点数。 */
  equityCurvePointCount: int("equityCurvePointCount"),
  /** 扁平摘要 JSON（列表页展示；口径自描述）。 */
  summaryJson: text("summaryJson"),
  /** 运行结果完整投影（详情页用；**列表页不读此列**）。 */
  resultJson: longtext("resultJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  runUnique: uniqueIndex("uq_closed_loop_backtest_run_run").on(table.runId),
  createdIdx: index("idx_closed_loop_backtest_run_created").on(table.createdAt),
  strategyIdx: index("idx_closed_loop_backtest_run_strategy").on(table.strategyId, table.createdAt),
}));

export type ClosedLoopBacktestRunRow = typeof closedLoopBacktestRun.$inferSelect;
export type InsertClosedLoopBacktestRunRow = typeof closedLoopBacktestRun.$inferInsert;
export const parameterSearchRun = mysqlTable("parameter_search_run", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 业务身份（`PSRUN-YYYYMMDD-XXXXXXXX`）；UNIQUE：重试 / 重放幂等收敛为一行。 */
  searchRunId: varchar("searchRunId", { length: 80 }).notNull(),
  /** 策略坐标快照（软引用，无 FK）。规格里的 `strategyVersionId` = 本对（见 parameterHash.ts）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** 🔴 运行时**唯一权威**数据集坐标 → `dataset_version.id`（软引用）；legacy 绑定为 NULL。 */
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  /** Dataset label 快照（**仅展示**，不是坐标）。 */
  datasetVersionLabel: varchar("datasetVersionLabel", { length: 96 }),
  /** 回测窗口（FIXED 参数：搜索过程中不变）。 */
  startDate: date("startDate", { mode: "string" }).notNull(),
  endDate: date("endDate", { mode: "string" }).notNull(),
  /** 搜索方法：**本阶段只有 `GRID_SEARCH`**；其余为已登记未实现（入参层拒绝）。 */
  searchMethod: varchar("searchMethod", { length: 24 }).notNull(),
  /** 状态机：CREATED / RUNNING / COMPLETED / FAILED / CANCELLED。 */
  status: varchar("status", { length: 16 }).notNull().default("CREATED"),
  /** 参数空间快照（富定义 JSON；**写入即冻结**，永不 UPDATE）。 */
  parameterSpaceJson: longtext("parameterSpaceJson").notNull(),
  /** 快照指纹（sha256；覆盖策略身份 + 富定义，见 `searchRun.ts#computeRunSpaceSnapshotFingerprint`）。 */
  parameterSpaceFingerprint: varchar("parameterSpaceFingerprint", { length: 64 }).notNull(),
  /** FIXED 坐标快照（JSON：strategyVersionId / datasetVersionId / 窗口 / 执行政策 / 评估配置指纹）。 */
  fixedCoordinatesJson: text("fixedCoordinatesJson").notNull(),
  /** 回测执行政策版本（cache 判据之一；来自 `BACKTEST_EXECUTION_POLICY_VERSION`）。 */
  executionPolicyVersion: int("executionPolicyVersion").notNull(),
  /** 评估配置指纹（cache 判据之一；sha256）。 */
  evaluationConfigFingerprint: varchar("evaluationConfigFingerprint", { length: 64 }).notNull(),
  /** 组合总数（笛卡尔积基数）。 */
  combinationCount: int("combinationCount").notNull(),
  /** 已**评估成功**的组合数（= 结果行 status = SUCCEEDED 的条数）。 */
  completedCount: int("completedCount").notNull().default(0),
  /** 已**评估失败**的组合数。与 completedCount 互斥；SKIPPED 不计入任一边。 */
  failedCount: int("failedCount").notNull().default(0),
  /** 全部组合的稳定指纹（证明「这次生成的组合集没变」）。 */
  combinationSetFingerprint: varchar("combinationSetFingerprint", { length: 64 }).notNull(),
  /** 运行说明（JSON 数组；cache 命中数 / resume 跳过数 / 派生说明；如实记录不静默）。 */
  notesJson: longtext("notesJson"),
  /**
   * PARAMETER-002 继承字段（ROBUSTNESS-001 §12）—— 源 Run 是否做过「死参数」筛查。
   *
   * `NULL` = 本列加入之前落库的历史行 ⇒ 下游（稳健性分析）必须如实标「未验证」，
   * **不得**回读当前策略版本来补算（那会把历史搜索用未来版本重新解释）。
   */
  referenceCheckApplied: boolean("referenceCheckApplied"),
  /** 被排除的死参数 code 快照（JSON 数组；NULL = 未知 / 无）。 */
  unreferencedTunableCodesJson: text("unreferencedTunableCodesJson"),
  /** 失败原因码（状态 FAILED 时非空）。 */
  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** 首次进入 RUNNING 的时间（UTC 墙钟）。 */
  startedAt: timestamp("startedAt"),
  /** 进入终态的时间（UTC 墙钟；**不填 NOW() 冒充**，由调用方给真实完成时刻）。 */
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  runUnique: uniqueIndex("uq_parameter_search_run_id").on(table.searchRunId),
  createdIdx: index("idx_parameter_search_run_created").on(table.createdAt),
  strategyIdx: index("idx_parameter_search_run_strategy").on(table.strategyId, table.createdAt),
  statusIdx: index("idx_parameter_search_run_status").on(table.status),
}));

export type ParameterSearchRunRow = typeof parameterSearchRun.$inferSelect;
export type InsertParameterSearchRunRow = typeof parameterSearchRun.$inferInsert;

/**
 * 参数组合（PARAMETER-001 §6）—— 「计划层」。
 *
 * 一行 = 一个笛卡尔积成员。`(searchRunId, parameterHash)` UNIQUE ⇒
 * 「同一 Run 内同一参数组合」只有一行，重复生成 / 重试都收敛到它（幂等）。
 * 执行状态是 resume（跳过已成功）与 retry（单独重跑失败）的**唯一判据**。
 */
export const parameterSearchCombination = mysqlTable("parameter_search_combination", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  searchRunId: varchar("searchRunId", { length: 80 }).notNull(),
  /** 组合序号（生成顺序，从 0 起；仅展示与稳定排序）。 */
  combinationIndex: int("combinationIndex").notNull(),
  /** 🔴 稳定参数哈希（身份；`sha256(strategyVersionId + 规范化参数值)`）。 */
  parameterHash: varchar("parameterHash", { length: 64 }).notNull(),
  /** 参数取值（JSON object；键 = 参数名）。 */
  parametersJson: longtext("parametersJson").notNull(),
  /** PENDING / RUNNING / SUCCEEDED / FAILED / SKIPPED。 */
  status: varchar("status", { length: 16 }).notNull().default("PENDING"),
  /** 尝试次数（retry 递增；用于区分「首次失败」与「反复失败」）。 */
  attemptCount: int("attemptCount").notNull().default(0),
  /** 最近一次失败原因（成功时置 NULL —— 收敛为当前事实，不保留过期错误）。 */
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  combinationUnique: uniqueIndex("uq_parameter_search_combination_hash").on(
    table.searchRunId,
    table.parameterHash,
  ),
  runIdx: index("idx_parameter_search_combination_run").on(table.searchRunId, table.combinationIndex),
  statusIdx: index("idx_parameter_search_combination_status").on(table.searchRunId, table.status),
}));

export type ParameterSearchCombinationRow = typeof parameterSearchCombination.$inferSelect;
export type InsertParameterSearchCombinationRow = typeof parameterSearchCombination.$inferInsert;

/**
 * 单组合评估产物（PARAMETER-001 §9/§10）—— 「产物层」。
 *
 * 一行 = 一个组合的评估结果。`(searchRunId, parameterHash)` UNIQUE ⇒
 * 重试覆盖同一行（`attemptCount` 在 combination 表递增，历史 attempt 数不丢）。
 *
 * 🔴 六个指标列**只写评估端口读数**（`canonicalMetrics` 优先，缺省回落 evaluators 面），
 *   本表**不做任何派生计算**；缺失一律 NULL，**禁止编 0 / 1**。
 */
export const parameterSearchResult = mysqlTable("parameter_search_result", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  searchRunId: varchar("searchRunId", { length: 80 }).notNull(),
  combinationIndex: int("combinationIndex").notNull(),
  parameterHash: varchar("parameterHash", { length: 64 }).notNull(),
  /** 参数取值快照（冗余自 combination，便于结果页单表读取）。 */
  parametersJson: longtext("parametersJson").notNull(),
  /** SUCCEEDED / FAILED（判据 = 评估引用是否存在，不看指标是否为 null）。 */
  status: varchar("status", { length: 16 }).notNull(),
  /** 失败原因（结构化字符串）；成功时 NULL。 */
  error: text("error"),
  // ---- §10 指标（**读数**，禁止派生计算）----
  totalReturnPct: double("totalReturnPct"),
  annualizedReturnPct: double("annualizedReturnPct"),
  maxDrawdownPct: double("maxDrawdownPct"),
  tradeCount: int("tradeCount"),
  winRatePct: double("winRatePct"),
  profitFactor: double("profitFactor"),
  /** canonical | evaluators（指标来源自述；不静默降级）。 */
  metricsSource: varchar("metricsSource", { length: 16 }).notNull(),
  /** 年化基数自述（TRADING_DAYS / daysPerYear）；canonical 缺省时为 NULL。 */
  annualizationBasisJson: text("annualizationBasisJson"),
  // ---- §9 可追溯 ----
  /** 本次撮合指纹（`ClosedLoopEvaluationRef#backtestFingerprint`）。 */
  backtestFingerprint: varchar("backtestFingerprint", { length: 64 }),
  /**
   * **落库**回测 run id（→ `closed_loop_backtest_run.runId`，软引用）。
   * ⚠️ 本阶段评估端口走的是**内存态 5 阶段闭环**，不落 `closed_loop_backtest_run` 行 ⇒ 恒为 NULL。
   * 追溯改用 `backtestFingerprint` + `evaluationId` + Run 坐标（如实登记，**不伪造 id**）。
   */
  backtestRunId: varchar("backtestRunId", { length: 80 }),
  /** 评估产物身份（`deriveExperimentId`）。 */
  evaluationId: varchar("evaluationId", { length: 80 }),
  /** 内存态闭环 run id（`<前缀>::<experimentId>`）。 */
  evaluationRunId: varchar("evaluationRunId", { length: 160 }),
  /** 完整评估引用投影（canonical metrics 原始面 + 指纹；长文本）。 */
  evaluationJson: longtext("evaluationJson"),
  /** 复现要素快照（JSON：执行政策 / 评估配置指纹 / 数据集坐标）。 */
  reproductionJson: text("reproductionJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  resultUnique: uniqueIndex("uq_parameter_search_result_hash").on(
    table.searchRunId,
    table.parameterHash,
  ),
  runIdx: index("idx_parameter_search_result_run").on(table.searchRunId, table.combinationIndex),
  statusIdx: index("idx_parameter_search_result_status").on(table.searchRunId, table.status),
}));

export type ParameterSearchResultRow = typeof parameterSearchResult.$inferSelect;
export type InsertParameterSearchResultRow = typeof parameterSearchResult.$inferInsert;

// ---------------------------------------------------------------------------
// ROBUSTNESS-001 — Search-Result Robustness Analysis（三表）
//
// 🔴 与 C-18.1（`server/research/robustness/**`，四轴扰动重估）**并存但不同物**：
//   C-18.1 需**重跑评估**、其记录类型是内存态 `ROBUSTNESS_RUN`，目前**无落库**；
//   本组三表只服务「**消费已算完的 Parameter Search 结果**」的稳定性分析（零重跑）。
//   表名带 `search_` 前缀，是为了让「哪一种鲁棒性」在表名上就无歧义。
//
// 纪律：0 FK（软引用）；参数空间快照**写入即冻结**（ON DUPLICATE KEY UPDATE 不含它）；
//   所有指标列都是**源 `parameter_search_result` 的冻结副本**，本层不做任何派生计算。
// ---------------------------------------------------------------------------

/**
 * 稳健性分析运行（ROBUSTNESS-001 §14）。
 *
 * `robustnessRunId` UNIQUE ⇒ 重放 / 重跑幂等收敛为一行（不会堆重复 Run）。
 */
export const searchRobustnessRun = mysqlTable("search_robustness_run", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 业务身份（`SROB-YYYYMMDD-XXXXXXXX`）。 */
  robustnessRunId: varchar("robustnessRunId", { length: 80 }).notNull(),
  /** 🔴 唯一输入事实源（规格 §8）：只有这一个 Search Run 的冻结结果可进入本 Run。 */
  sourceSearchRunId: varchar("sourceSearchRunId", { length: 80 }).notNull(),
  /** 策略 / 数据集坐标快照（原样继承自源 Run；软引用无 FK）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  datasetVersionLabel: varchar("datasetVersionLabel", { length: 96 }),
  startDate: date("startDate", { mode: "string" }).notNull(),
  endDate: date("endDate", { mode: "string" }).notNull(),
  searchMethod: varchar("searchMethod", { length: 24 }).notNull(),
  /** 源 Run 的**参数空间冻结快照**（规格 §9：不从当前 Strategy Version 重新解释）。 */
  searchSnapshotJson: longtext("searchSnapshotJson").notNull(),
  searchSnapshotFingerprint: varchar("searchSnapshotFingerprint", { length: 64 }).notNull(),
  /** 源 Run 的 FIXED 坐标快照（原样继承）。 */
  fixedCoordinatesJson: text("fixedCoordinatesJson").notNull(),
  executionPolicyVersion: int("executionPolicyVersion").notNull(),
  evaluationConfigFingerprint: varchar("evaluationConfigFingerprint", { length: 64 }).notNull(),
  /**
   * 源 Search Run 是否做过死参数筛查（继承 PARAMETER-002）。
   * `NULL` = 源 Run 落库时还没有该字段（历史行）⇒ 分析侧如实标
   * `ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED`，不假装参数被消费。
   */
  sourceReferenceCheckApplied: boolean("sourceReferenceCheckApplied"),
  /** 源 Run 排除掉的死参数 code 快照（JSON 数组；NULL = 未知 / 无）。 */
  sourceUnreferencedCodesJson: text("sourceUnreferencedCodesJson"),
  /** 稳定性判定口径（**持久化**；规格 §5.3 要求可配置且不写死前端）。 */
  analysisConfigJson: text("analysisConfigJson").notNull(),
  /** CREATED / RUNNING / COMPLETED / FAILED / CANCELLED。 */
  status: varchar("status", { length: 16 }).notNull().default("CREATED"),
  /** 汇总快照（JSON；`stableCount` 等关键计数另有独立列，便于列表页免解析）。 */
  summaryJson: longtext("summaryJson"),
  analyzedCount: int("analyzedCount").notNull().default(0),
  stableCount: int("stableCount").notNull().default(0),
  unstableCount: int("unstableCount").notNull().default(0),
  /** 结论不可用类的计数（活动不足 / 邻域不足 / 源结果不可用；如实单列，不并入 unstable）。 */
  insufficientCount: int("insufficientCount").notNull().default(0),
  /** 邻域不完整的组合数（`NEIGHBORHOOD_INCOMPLETE`）。 */
  neighborhoodIncompleteCount: int("neighborhoodIncompleteCount").notNull().default(0),
  /** 参数引用未验证（源 Run 无筛查记录）⇒ 前端必须提示，不得沉默。 */
  parameterReferenceUnverified: boolean("parameterReferenceUnverified").notNull().default(false),
  notesJson: longtext("notesJson"),
  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  /** 进入终态的时间（由调用方给真实完成时刻，不用 `now()` 冒充）。 */
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  runUnique: uniqueIndex("uq_search_robustness_run_id").on(table.robustnessRunId),
  sourceIdx: index("idx_search_robustness_run_source").on(table.sourceSearchRunId),
  createdIdx: index("idx_search_robustness_run_created").on(table.createdAt),
  statusIdx: index("idx_search_robustness_run_status").on(table.status),
}));

export type SearchRobustnessRunRow = typeof searchRobustnessRun.$inferSelect;
export type InsertSearchRobustnessRunRow = typeof searchRobustnessRun.$inferInsert;

/**
 * 单组合稳健性结果（ROBUSTNESS-001 §15）。
 *
 * `(robustnessRunId, parameterHash)` UNIQUE ⇒ 同一 Run 内同一组合只有一行；
 * 重复 start 覆盖同一行（确定性重算），不会堆重复行。
 */
export const searchRobustnessResult = mysqlTable("search_robustness_result", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  robustnessRunId: varchar("robustnessRunId", { length: 80 }).notNull(),
  /** 源 Search Run（冗余自 Run，便于单表排查；软引用无 FK）。 */
  sourceSearchRunId: varchar("sourceSearchRunId", { length: 80 }).notNull(),
  /** 🔴 组合身份唯一权威 = 源组合的 `parameterHash`（本层**不重算**）。 */
  parameterHash: varchar("parameterHash", { length: 64 }).notNull(),
  combinationIndex: int("combinationIndex").notNull(),
  parametersJson: longtext("parametersJson").notNull(),
  /** 指标读数（源结果**冻结副本**；本层零派生计算）。 */
  totalReturnPct: double("totalReturnPct"),
  annualizedReturnPct: double("annualizedReturnPct"),
  maxDrawdownPct: double("maxDrawdownPct"),
  tradeCount: int("tradeCount"),
  winRatePct: double("winRatePct"),
  profitFactor: double("profitFactor"),
  metricsSource: varchar("metricsSource", { length: 16 }).notNull(),
  /** STABLE / UNSTABLE / INSUFFICIENT_TRADING_ACTIVITY / INSUFFICIENT_NEIGHBORHOOD / SOURCE_RESULT_UNAVAILABLE。 */
  status: varchar("status", { length: 32 }).notNull(),
  /** `true` 仅当状态为 STABLE；其余（含证据不足）一律 false，不冒充。 */
  stable: boolean("stable").notNull().default(false),
  stabilityRatio: double("stabilityRatio"),
  stableNeighborCount: int("stableNeighborCount").notNull().default(0),
  validNeighborCount: int("validNeighborCount").notNull().default(0),
  expectedNeighborCount: int("expectedNeighborCount").notNull().default(0),
  presentNeighborCount: int("presentNeighborCount").notNull().default(0),
  neighborhoodIncomplete: boolean("neighborhoodIncomplete").notNull().default(false),
  statusReason: text("statusReason"),
  /** 邻域明细（含缺失格原因；**不补值**）。 */
  neighborsJson: longtext("neighborsJson").notNull(),
  dispersionJson: longtext("dispersionJson").notNull(),
  sensitivityJson: longtext("sensitivityJson").notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  resultUnique: uniqueIndex("uq_search_robustness_result_hash").on(
    table.robustnessRunId,
    table.parameterHash,
  ),
  runIdx: index("idx_search_robustness_result_run").on(table.robustnessRunId, table.combinationIndex),
  statusIdx: index("idx_search_robustness_result_status").on(table.robustnessRunId, table.status),
}));

export type SearchRobustnessResultRow = typeof searchRobustnessResult.$inferSelect;
export type InsertSearchRobustnessResultRow = typeof searchRobustnessResult.$inferInsert;

/**
 * 单参数稳健性分析（ROBUSTNESS-001 §13 的 `robustness_parameter_analysis`）。
 *
 * 一行 = 一个**参与搜索的参数**（不是组合）。`(robustnessRunId, parameterName)` UNIQUE。
 */
export const searchRobustnessParameterAnalysis = mysqlTable("search_robustness_parameter_analysis", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  robustnessRunId: varchar("robustnessRunId", { length: 80 }).notNull(),
  sourceSearchRunId: varchar("sourceSearchRunId", { length: 80 }).notNull(),
  parameterName: varchar("parameterName", { length: 64 }).notNull(),
  domainMode: varchar("domainMode", { length: 24 }).notNull(),
  domainValueCount: int("domainValueCount").notNull(),
  numeric: boolean("numeric").notNull(),
  analyzedValueCount: int("analyzedValueCount").notNull().default(0),
  stableCombinationCount: int("stableCombinationCount").notNull().default(0),
  unstableCombinationCount: int("unstableCombinationCount").notNull().default(0),
  /** sensitive / insensitive / insufficient（**描述性**，不是「该参数好不好」）。 */
  verdict: varchar("verdict", { length: 16 }).notNull(),
  sensitivityJson: longtext("sensitivityJson").notNull(),
  valueDispersionJson: longtext("valueDispersionJson").notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  parameterUnique: uniqueIndex("uq_search_robustness_parameter_name").on(
    table.robustnessRunId,
    table.parameterName,
  ),
  runIdx: index("idx_search_robustness_parameter_run").on(table.robustnessRunId),
}));

export type SearchRobustnessParameterAnalysisRow =
  typeof searchRobustnessParameterAnalysis.$inferSelect;
export type InsertSearchRobustnessParameterAnalysisRow =
  typeof searchRobustnessParameterAnalysis.$inferInsert;

// ---------------------------------------------------------------------------
// OOS-001 — Out-of-Sample Validation（两表：Run + Result）
//
// 🔴 与 `search_robustness_*`（ROBUSTNESS-001）的**语义相反**，必须分清：
//   - `search_robustness_*`：冻结结果上的邻域稳定性 —— **零重跑、零重算**；
//   - `oos_validation_*`：在**样本外窗口真正重跑 Backtest** 并**真正重算指标**（规格 §9）。
//   两者共享「消费 Parameter Search 结果」这一输入姿态，故表名同族、语义不同。
//
// 纪律：0 FK（软引用）；`resolvedParameterSetJson` / `searchSnapshotJson` **写入即冻结**
//   （`ON DUPLICATE KEY UPDATE` 集合里不含它们）；参数值**不由调用方提供**，
//   一律从源 `parameter_search_combination` 读出并复核 hash（规格 §5）。
// ---------------------------------------------------------------------------

/**
 * OOS 验证运行（OOS-001 §13）。
 *
 * `oosRunId` UNIQUE ⇒ 重放 / 重跑幂等收敛为一行（不会堆重复 Run）。
 */
export const oosValidationRun = mysqlTable("oos_validation_run", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 业务身份（`OOSV-YYYYMMDD-XXXXXXXX`）。 */
  oosRunId: varchar("oosRunId", { length: 80 }).notNull(),
  /** 源 Parameter Search Run（唯一输入事实源，规格 §4 第 1 问）。 */
  sourceSearchRunId: varchar("sourceSearchRunId", { length: 80 }).notNull(),
  /**
   * 被验证的冻结候选在本域**唯一的身份** = 源组合的 `parameterHash`（本层**不重算**）。
   * `combinationIndex` 只作展示与稳定排序，**不作身份**。
   */
  sourceParameterHash: varchar("sourceParameterHash", { length: 64 }).notNull(),
  sourceCombinationIndex: int("sourceCombinationIndex"),
  /** 策略坐标快照（原样继承自源 Run；软引用无 FK）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** `strategyId@strategyVersion`（规格 §4 第 3 问的完整身份）。 */
  strategyVersionId: varchar("strategyVersionId", { length: 96 }).notNull(),
  /** 策略定义指纹（创建时冻结；执行时复核，漂移即响亮拒绝）。 */
  strategyDefinitionFingerprint: varchar("strategyDefinitionFingerprint", { length: 64 }),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  datasetVersionLabel: varchar("datasetVersionLabel", { length: 96 }),
  /** IS / Search 窗口快照（隔离判定的另一半；缺失就无法证明「不重叠」）。 */
  searchStartDate: date("searchStartDate", { mode: "string" }).notNull(),
  searchEndDate: date("searchEndDate", { mode: "string" }).notNull(),
  /** OOS 窗口（规格 §6：`oosStart > searchEnd`，默认禁止重叠）。 */
  oosStartDate: date("oosStartDate", { mode: "string" }).notNull(),
  oosEndDate: date("oosEndDate", { mode: "string" }).notNull(),
  /** 源 Run 的参数空间**冻结快照**（不从当前策略版本重新解释；规格 §5）。 */
  searchSnapshotJson: longtext("searchSnapshotJson").notNull(),
  searchSnapshotFingerprint: varchar("searchSnapshotFingerprint", { length: 64 }).notNull(),
  fixedCoordinatesJson: text("fixedCoordinatesJson").notNull(),
  executionPolicyVersion: int("executionPolicyVersion").notNull(),
  evaluationConfigFingerprint: varchar("evaluationConfigFingerprint", { length: 64 }).notNull(),
  /** **冻结参数集**（写入即冻结，永不 UPDATE）—— OOS 执行只允许用它。 */
  resolvedParameterSetJson: longtext("resolvedParameterSetJson").notNull(),
  /** 指标版本自述（规格 §4 第 8 问；由年化口径常量拼出，不写死数字）。 */
  metricsVersion: varchar("metricsVersion", { length: 48 }).notNull(),
  /** 决策引擎版本自述（规格 §4 第 8 问）。 */
  engineVersion: varchar("engineVersion", { length: 48 }).notNull(),
  /** CREATED / RUNNING / COMPLETED / FAILED / CANCELLED。 */
  status: varchar("status", { length: 16 }).notNull().default("CREATED"),
  /** 运行内容指纹（时间戳不参与）。 */
  runFingerprint: varchar("runFingerprint", { length: 64 }).notNull(),
  notesJson: longtext("notesJson"),
  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  /** 进入终态的时间（由调用方给真实完成时刻，不用 `now()` 冒充）。 */
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  runUnique: uniqueIndex("uq_oos_validation_run_id").on(table.oosRunId),
  sourceIdx: index("idx_oos_validation_run_source").on(table.sourceSearchRunId),
  createdIdx: index("idx_oos_validation_run_created").on(table.createdAt),
  statusIdx: index("idx_oos_validation_run_status").on(table.status),
}));

export type OosValidationRunRow = typeof oosValidationRun.$inferSelect;
export type InsertOosValidationRunRow = typeof oosValidationRun.$inferInsert;

/**
 * OOS 验证结果（OOS-001 §13）。
 *
 * 一行 = 一个「IS 基线 × OOS 重跑」的对照产物。
 * `(oosRunId, sourceParameterHash)` UNIQUE ⇒ 重复 start 覆盖同一行（确定性重算），不堆重复行。
 *
 * 🔴 IS 侧六列是 `parameter_search_result` 的**冻结副本**（零重算）；
 *   OOS 侧六列是**本次重跑的真实读数**（绝不复制 IS 侧的值）。
 */
export const oosValidationResult = mysqlTable("oos_validation_result", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  oosRunId: varchar("oosRunId", { length: 80 }).notNull(),
  /** 溯源冗余（便于单表排查；软引用无 FK）。 */
  sourceSearchRunId: varchar("sourceSearchRunId", { length: 80 }).notNull(),
  sourceParameterHash: varchar("sourceParameterHash", { length: 64 }).notNull(),
  sourceCombinationIndex: int("sourceCombinationIndex"),
  strategyVersionId: varchar("strategyVersionId", { length: 96 }).notNull(),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  resolvedParameterSetJson: longtext("resolvedParameterSetJson").notNull(),
  searchStartDate: date("searchStartDate", { mode: "string" }).notNull(),
  searchEndDate: date("searchEndDate", { mode: "string" }).notNull(),
  oosStartDate: date("oosStartDate", { mode: "string" }).notNull(),
  oosEndDate: date("oosEndDate", { mode: "string" }).notNull(),
  /** IS 读数（源结果**冻结副本**；本层零派生计算）。 */
  isTotalReturnPct: double("isTotalReturnPct"),
  isAnnualizedReturnPct: double("isAnnualizedReturnPct"),
  isMaxDrawdownPct: double("isMaxDrawdownPct"),
  isTradeCount: int("isTradeCount"),
  isWinRatePct: double("isWinRatePct"),
  isProfitFactor: double("isProfitFactor"),
  isMetricsSource: varchar("isMetricsSource", { length: 16 }).notNull(),
  isAnnualizationBasisJson: text("isAnnualizationBasisJson"),
  /** OOS 读数（**本次重跑**的真实产物；六项全不可用时如实为 NULL，不编造）。 */
  oosTotalReturnPct: double("oosTotalReturnPct"),
  oosAnnualizedReturnPct: double("oosAnnualizedReturnPct"),
  oosMaxDrawdownPct: double("oosMaxDrawdownPct"),
  oosTradeCount: int("oosTradeCount"),
  oosWinRatePct: double("oosWinRatePct"),
  oosProfitFactor: double("oosProfitFactor"),
  oosMetricsSource: varchar("oosMetricsSource", { length: 16 }).notNull(),
  oosAnnualizationBasisJson: text("oosAnnualizationBasisJson"),
  /** IS / OOS 对照（**事实与比较**，不含「最优 / 推荐」结论）。 */
  comparisonJson: longtext("comparisonJson").notNull(),
  /** SUCCEEDED / FAILED（判据 = 是否产出可用 evaluation 引用）。 */
  status: varchar("status", { length: 16 }).notNull(),
  error: text("error"),
  /** 本次 OOS 撮合指纹（确定性判据）。 */
  backtestFingerprint: varchar("backtestFingerprint", { length: 64 }),
  /** 本次 OOS 评估产物身份（`deriveExperimentId`）。 */
  evaluationId: varchar("evaluationId", { length: 80 }),
  evaluationRunId: varchar("evaluationRunId", { length: 160 }),
  executionPolicyVersion: int("executionPolicyVersion").notNull(),
  metricsVersion: varchar("metricsVersion", { length: 48 }).notNull(),
  engineVersion: varchar("engineVersion", { length: 48 }).notNull(),
  /** 内容指纹（确定性判据：同输入 ⇒ 同指纹）。 */
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  notesJson: longtext("notesJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  resultUnique: uniqueIndex("uq_oos_validation_result_candidate").on(
    table.oosRunId,
    table.sourceParameterHash,
  ),
  runIdx: index("idx_oos_validation_result_run").on(table.oosRunId, table.sourceCombinationIndex),
  statusIdx: index("idx_oos_validation_result_status").on(table.oosRunId, table.status),
}));

export type OosValidationResultRow = typeof oosValidationResult.$inferSelect;
export type InsertOosValidationResultRow = typeof oosValidationResult.$inferInsert;


// ---------------------------------------------------------------------------
// WALK-FORWARD-001 —— Walk-Forward 验证闭环（规格 §8 / §9）
//
// 编排层，**不是新引擎**：每个 Fold 的搜索与样本外验证分别调用既有
// `parameter_search_*` 与 `oos_validation_*` 的 application service
// （不经 HTTP 自调用，规格 §15）。本域只落「排程 + Fold 冻结坐标 + 两个子 Run 的软引用 + 读数快照」。
//
// 纪律：0 FK（软引用）；窗口 / 策略指纹 / 选择策略 / 排程 **写入即冻结**
//   （`ON DUPLICATE KEY UPDATE` 集合里不含它们）；Fold 的 IS 与 OOS 永不重叠
//   （创建时由几何断言 + 泄漏守卫双重保证，规格 §11）。
// 表数量刻意只有两张：Fold 的结果快照（IS / OOS 读数 + 对照）不足以撑起第三张表。
// ---------------------------------------------------------------------------

/**
 * Walk-Forward 运行（规格 §8 Run 字段）。
 *
 * `walkForwardRunId` UNIQUE ⇒ 重放幂等收敛为一行；`scheduleJson` 冻结整份窗口排程
 * （配置 + 交易日序列 + 全部 Fold 端点），因此**不需**依赖「当前策略 / 当前数据集」重建历史。
 */
export const walkForwardRun = mysqlTable("walk_forward_run", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 业务身份（`WFV-YYYYMMDD-XXXXXXXX`）。 */
  walkForwardRunId: varchar("walkForwardRunId", { length: 80 }).notNull(),
  /** 被滚动的策略坐标（创建时冻结，**不是** latest）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** `strategyId@strategyVersion` 完整身份。 */
  strategyVersionId: varchar("strategyVersionId", { length: 96 }).notNull(),
  /** 策略定义指纹（创建时冻结；执行前复核，漂移即响亮拒绝）。 */
  strategyFingerprint: varchar("strategyFingerprint", { length: 64 }),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  datasetVersionLabel: varchar("datasetVersionLabel", { length: 96 }),
  /** 窗口排程**冻结快照**（配置 + 交易日序列 + Fold 端点 + 排程指纹）。 */
  scheduleJson: longtext("scheduleJson").notNull(),
  /** 排程指纹（跨运行稳定：不含 Run id / 时间戳 ⇒ 可作确定性判据，规格 §16）。 */
  scheduleFingerprint: varchar("scheduleFingerprint", { length: 64 }).notNull(),
  /** 候选选择策略快照（规格 §7：**必须**写入快照，否则无从审计「怎么挑的」）。 */
  selectionPolicyJson: text("selectionPolicyJson").notNull(),
  /** 每 Fold 的搜索方法（复用 PS 词表）。 */
  searchMethod: varchar("searchMethod", { length: 32 }).notNull(),
  /** 每 Fold 的组合数上限（NULL = 不设上限）。 */
  maxCombinationsPerFold: int("maxCombinationsPerFold"),
  totalFoldCount: int("totalFoldCount").notNull(),
  completedFoldCount: int("completedFoldCount").notNull().default(0),
  failedFoldCount: int("failedFoldCount").notNull().default(0),
  /** 当前推进到的 Fold 序号（全部完成 / 失败后为 NULL）。 */
  currentFoldIndex: int("currentFoldIndex"),
  /** 指标版本自述（沿用 OOS 域同一条，唯一口径 = canonical）。 */
  metricsVersion: varchar("metricsVersion", { length: 48 }).notNull(),
  /** 决策引擎版本自述。 */
  engineVersion: varchar("engineVersion", { length: 48 }).notNull(),
  /** CREATED / RUNNING / COMPLETED / FAILED / CANCELLED。 */
  status: varchar("status", { length: 16 }).notNull().default("CREATED"),
  /** 运行内容指纹（时间戳与计数不参与）。 */
  runFingerprint: varchar("runFingerprint", { length: 64 }).notNull(),
  /** 多 Fold 汇总（**只做描述性统计**；未完成时为 NULL）。 */
  aggregateJson: longtext("aggregateJson"),
  notesJson: text("notesJson"),
  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  runUnique: uniqueIndex("uq_walk_forward_run_id").on(table.walkForwardRunId),
  strategyIdx: index("idx_walk_forward_run_strategy").on(table.strategyId, table.strategyVersion),
  createdIdx: index("idx_walk_forward_run_created").on(table.createdAt),
  statusIdx: index("idx_walk_forward_run_status").on(table.status),
}));

export type WalkForwardRunRow = typeof walkForwardRun.$inferSelect;
export type InsertWalkForwardRunRow = typeof walkForwardRun.$inferInsert;

/**
 * Walk-Forward 单个 Fold（规格 §8 Fold 字段）。
 *
 * `(walkForwardRunId, foldIndex)` UNIQUE ⇒ 重执行覆盖同一行，不堆重复 Fold。
 * `isStart/isEnd/oosStart/oosEnd` 用 `date(..., { mode: "string" })`（北京业务日字符串，
 * 与 PS / OOS 的窗口列同口径 —— 不用 timestamp，避免时区把窗口挪一天）。
 */
export const walkForwardFold = mysqlTable("walk_forward_fold", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  walkForwardRunId: varchar("walkForwardRunId", { length: 80 }).notNull(),
  foldIndex: int("foldIndex").notNull(),
  /** 该 Fold 的 IS 窗口（**搜索窗口必须等于它**，泄漏守卫会断言）。 */
  isStart: date("isStart", { mode: "string" }).notNull(),
  isEnd: date("isEnd", { mode: "string" }).notNull(),
  /** 该 Fold 的 OOS 窗口（硬约束 `isEnd < oosStart`）。 */
  oosStart: date("oosStart", { mode: "string" }).notNull(),
  oosEnd: date("oosEnd", { mode: "string" }).notNull(),
  /** 该 Fold **自己的** Parameter Search Run（每个 Fold 独立搜索，规格 §11）。 */
  sourceSearchRunId: varchar("sourceSearchRunId", { length: 80 }),
  searchStartDate: date("searchStartDate", { mode: "string" }),
  searchEndDate: date("searchEndDate", { mode: "string" }),
  /** 冻结的候选身份（组合序号 + hash；参数值由 hash 复核）。 */
  sourceCombinationIndex: int("sourceCombinationIndex"),
  parameterHash: varchar("parameterHash", { length: 64 }),
  /** **冻结参数快照**（写入即冻结，永不 UPDATE）。 */
  resolvedParameterSetJson: longtext("resolvedParameterSetJson"),
  strategyVersionId: varchar("strategyVersionId", { length: 96 }).notNull(),
  strategyFingerprint: varchar("strategyFingerprint", { length: 64 }),
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),
  /** 该 Fold **自己的** OOS Run（软引用 → `oos_validation_run.oosRunId`）。 */
  oosRunId: varchar("oosRunId", { length: 80 }),
  oosWindowStartDate: date("oosWindowStartDate", { mode: "string" }),
  oosWindowEndDate: date("oosWindowEndDate", { mode: "string" }),
  /** WINDOW_CREATED / SEARCH_RUNNING / SEARCH_COMPLETED / CANDIDATE_FROZEN / OOS_RUNNING / OOS_COMPLETED / FAILED。 */
  status: varchar("status", { length: 24 }).notNull().default("WINDOW_CREATED"),
  /** PENDING / SUCCEEDED / INSUFFICIENT_TRADING_ACTIVITY / FAILED（结果语义，与生命周期正交）。 */
  outcome: varchar("outcome", { length: 32 }).notNull().default("PENDING"),
  /** IS 读数快照（源 Search 结果的冻结副本；本域零重算）。 */
  isMetricsJson: longtext("isMetricsJson"),
  isMetricsSource: varchar("isMetricsSource", { length: 16 }),
  /** OOS 读数快照（本次真实重跑读数，来自 OOS 结果行）。 */
  oosMetricsJson: longtext("oosMetricsJson"),
  oosMetricsSource: varchar("oosMetricsSource", { length: 16 }),
  /** IS/OOS 对照（复用 OOS 域既有对照，零重算）。 */
  comparisonJson: longtext("comparisonJson"),
  /** 本次 OOS 撮合指纹（证明「真在不同数据上重跑」的主判据）。 */
  oosBacktestFingerprint: varchar("oosBacktestFingerprint", { length: 64 }),
  /** Fold 级执行指纹（窗口 + 冻结坐标 + 两个子 Run 身份）。 */
  executionFingerprint: varchar("executionFingerprint", { length: 64 }).notNull(),
  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: text("errorMessage"),
  notesJson: text("notesJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  foldUnique: uniqueIndex("uq_walk_forward_fold_index").on(
    table.walkForwardRunId,
    table.foldIndex,
  ),
  runIdx: index("idx_walk_forward_fold_run").on(table.walkForwardRunId, table.foldIndex),
  statusIdx: index("idx_walk_forward_fold_status").on(table.walkForwardRunId, table.status),
  searchIdx: index("idx_walk_forward_fold_search").on(table.sourceSearchRunId),
  oosIdx: index("idx_walk_forward_fold_oos").on(table.oosRunId),
}));

export type WalkForwardFoldRow = typeof walkForwardFold.$inferSelect;
export type InsertWalkForwardFoldRow = typeof walkForwardFold.$inferInsert;

/**
 * 独立研究实验 · Run 元数据（RESEARCH-EXPERIMENT-004 · migration `0047`）。
 *
 * ## 为什么只有这一张表（**刻意的设计决定**）
 *
 * 规格 §4 列了 `Experiment` 与 `Experiment Run` 两张候选表。本实现**只建 Run 那张**，理由：
 *
 *   1. 本体系的 **Experiment 元数据是「代码声明的」**（`research-experiments/manifest.ts`
 *      + `server/researchExperiments/registry.ts`）：id / name / version / description /
 *      参数定义 / Dataset 需求全部随代码走 git，这是比 DB 行更强的持久化与可审计性；
 *   2. 再建一张 `experiment` 表 ⇒ 立刻出现**两个真源**（代码里的定义 vs DB 里的行），
 *      两者漂移时无法判定谁对 —— 这与项目「唯一真源」纪律直接冲突；
 *   3. 规格 §4 自己写了「**优先扩展现有表，不重复创建同义表**」，§20 又明令
 *      「不为了本任务重做 Experiment Framework」；
 *   4. 「历史 Run 仍可读懂」由**快照列**兑现：`experimentName` / `experimentVersion` /
 *      `parametersJson` / `datasetVersionLabel` 都写下运行当时的值 ⇒
 *      即使之后代码改了实验定义、甚至实验被删除，这条历史 Run 依然自解释。
 *
 * ## 与旧 Research 的关系
 *
 * 🔴 与已退役的 `research_experiments`（003 已 DROP）**无任何关系**；
 *    本表是独立实验体系自己的 Run 表，不引用 Analysis / Finding / Conclusion。
 *
 * ## 落库边界（规格 §2）
 *
 * - **进本表**：Run 身份、实验坐标快照、Dataset 坐标、参数快照、生命周期状态、
 *   起止时间 / 耗时、错误码与消息、**Manifest 对象 Key**、结果 schema 版本、轻量摘要；
 * - **不进本表**：结果信封本体、表格 / 图表 / CSV / Parquet / 日志 ——
 *   这些是「大产物」，一律落对象存储，本表只存**引用**（`resultManifestKey`）。
 */
export const researchExperimentRun = mysqlTable("research_experiment_run", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 业务 Run id（`RUN-YYYYMMDD-<8 hex>`）；UNIQUE，**不覆盖历史 Run**。 */
  runId: varchar("runId", { length: 80 }).notNull(),
  /** 实验 id（`<group>/<key>`；**软引用**代码里的注册表，非 FK）。 */
  experimentId: varchar("experimentId", { length: 96 }).notNull(),
  /** 运行时的实验**名称快照**（代码改名后历史 Run 仍可读懂）。 */
  experimentName: varchar("experimentName", { length: 200 }).notNull(),
  /** 运行时的实验**版本快照**（`descriptor.version`）。 */
  experimentVersion: varchar("experimentVersion", { length: 32 }).notNull(),
  /** 实验定义代码指纹（平台计算；历史行为 NULL）。 */
  experimentCodeDigest: varchar("experimentCodeDigest", { length: 96 }),
  /** 研究阶段：EXPLORATORY / OBSERVATION / HOLDOUT；历史行为 NULL。 */
  researchPhase: varchar("researchPhase", { length: 16 }),
  protocolId: varchar("protocolId", { length: 96 }),
  protocolVersion: varchar("protocolVersion", { length: 32 }),
  protocolFingerprint: varchar("protocolFingerprint", { length: 96 }),
  parentRunId: varchar("parentRunId", { length: 80 }),
  evaluationStartDate: date("evaluationStartDate"),
  evaluationEndDate: date("evaluationEndDate"),
  /** 唯一 Dataset 坐标（**软引用** → `dataset_version.id`；Dataset 不复制、不重建）。 */
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  /** 数据集语义代码快照（避免 JOIN 才能显示「用的哪个数据集」）。 */
  datasetCode: varchar("datasetCode", { length: 64 }).notNull(),
  /** 数据集版本标签快照（`v1` / `v2` / …；仅显示用，坐标仍是 `datasetVersionId`）。 */
  datasetVersionLabel: varchar("datasetVersionLabel", { length: 96 }).notNull(),
  /** 全部 Dataset 绑定快照（primary + auxiliary）。 */
  datasetBindingsJson: longtext("datasetBindingsJson"),
  /** **已归并默认值**的参数快照（写入即冻结；JSON 文本，如 `{"n":3}`）。 */
  parametersJson: longtext("parametersJson").notNull(),
  /**
   * 生命周期状态（规格 §12）：`PENDING` / `RUNNING` / `COMPLETED` / `FAILED`。
   *
   * 🔴 `COMPLETED` 只能在「Result 与 Manifest 已确实写入对象存储并通过存在性校验」
   *    之后写入（由 `runRepository` 的状态迁移守卫保证）。
   */
  status: varchar("status", { length: 16 }).notNull().default("PENDING"),
  /** 进入 `RUNNING` 的时刻。 */
  startedAt: timestamp("startedAt"),
  /** 进入 `COMPLETED` / `FAILED` 的时刻。 */
  completedAt: timestamp("completedAt"),
  /** 执行耗时（毫秒，由 Runner 的时钟给出，与 `startedAt`/`completedAt` 同源）。 */
  durationMs: int("durationMs"),
  /** 失败时的领域错误码（成功为 NULL）。 */
  errorCode: varchar("errorCode", { length: 64 }),
  /** 失败原因（人读；**不含凭据**）。 */
  errorMessage: text("errorMessage"),
  /** Manifest 对象 Key（= 本 Run 全部产物的索引）；`COMPLETED` 时必非空（Repository 断言）。 */
  resultManifestKey: varchar("resultManifestKey", { length: 512 }),
  /** 结果信封的结构版本（本任务起为 `1.0.0`）。 */
  resultSchemaVersion: varchar("resultSchemaVersion", { length: 32 }),
  /** Confirmatory Gate JSON；历史 / exploratory 为 NULL。 */
  confirmatoryGateJson: longtext("confirmatoryGateJson"),
  /** 轻量摘要（样本账 / 读取行数 / 产物计数）——列表页不必去对象存储拉 result.json。 */
  summaryJson: longtext("summaryJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  /** 一个 Run 一行；`runId` 冲突即拒绝（**不覆盖历史 Run**）。 */
  runUnique: uniqueIndex("uq_research_experiment_run_id").on(table.runId),
  /** 按实验列历史 Run（`id` 单调 ⇒ 等价于创建顺序）。 */
  experimentIdx: index("idx_research_experiment_run_experiment").on(table.experimentId, table.id),
  /** 收敛「卡在 RUNNING」的 Run（`reconcileRun`）。 */
  statusIdx: index("idx_research_experiment_run_status").on(table.status),
  /** 按 Dataset 版本反查用过它的 Run。 */
  datasetIdx: index("idx_research_experiment_run_dataset").on(table.datasetVersionId),
  protocolIdx: index("idx_research_experiment_protocol").on(table.protocolFingerprint, table.id),
  parentIdx: index("idx_research_experiment_parent").on(table.parentRunId),
}));

export type ResearchExperimentRunRow = typeof researchExperimentRun.$inferSelect;
export type InsertResearchExperimentRunRow = typeof researchExperimentRun.$inferInsert;
