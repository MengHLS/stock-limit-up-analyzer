import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, date, index, uniqueIndex, longtext, double } from "drizzle-orm/mysql-core";

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

/**
 * 研究实验表 - 一次研究实验的完整冻结输入（snapshotJson）+ 元数据 + 状态。
 * snapshotJson 保存 canonical Experiment Snapshot（参数集 / 数据集 / 特征配置 / 回测配置），
 * 是历史实验复现的唯一事实来源；status 仅由受约束状态机迁移，核心输入不可变。
 */
export const researchExperiments = mysqlTable("research_experiments", {
  id: int("id").autoincrement().primaryKey(),
  /** 实验实体身份（如 EXP-YYYYMMDD-XXXXXXXX），全局唯一。 */
  experimentId: varchar("experimentId", { length: 64 }).notNull().unique(),
  /** 策略身份（冗余列，便于查询；权威值在 snapshotJson 内）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  /** 策略版本（冗余列，便于查询；权威值在 snapshotJson 内）。 */
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** 冻结的 canonical 实验快照（ResearchExperimentSnapshot 序列化）。 */
  snapshotJson: longtext("snapshotJson").notNull(),
  /** 实验状态：created / running / completed / failed。 */
  status: mysqlEnum("status", ["created", "running", "completed", "failed"]).notNull().default("created"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  createdAtIdx: index("idx_research_experiments_created").on(table.createdAt),
}));

export type ResearchExperimentRow = typeof researchExperiments.$inferSelect;
export type InsertResearchExperiment = typeof researchExperiments.$inferInsert;

/**
 * 研究运行表 - 一次实验执行（Run）。一个 experimentId 可对应多个 runId。
 * runId 全局唯一；resultJson 保存结构化结果摘要，error 保存失败信息。
 */
export const researchRuns = mysqlTable("research_runs", {
  id: int("id").autoincrement().primaryKey(),
  /** Run 实体身份（如 RUN-<experimentId>-<suffix>），全局唯一。 */
  runId: varchar("runId", { length: 96 }).notNull().unique(),
  /** 所属实验。 */
  experimentId: varchar("experimentId", { length: 64 }).notNull(),
  /** Run 状态：running / succeeded / failed。 */
  status: mysqlEnum("status", ["running", "succeeded", "failed"]).notNull().default("running"),
  /** 结构化结果摘要（ResearchRunResultSummary 序列化；成功时非空）。 */
  resultJson: longtext("resultJson"),
  /** 失败信息（失败时非空）。 */
  error: text("error"),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  experimentIdIdx: index("idx_research_runs_experiment").on(table.experimentId),
  createdAtIdx: index("idx_research_runs_created").on(table.createdAt),
}));

export type ResearchRunRow = typeof researchRuns.$inferSelect;
export type InsertResearchRun = typeof researchRuns.$inferInsert;

/**
 * 参数扫描批次表 - 一次 Sweep 的完整冻结输入（parameterSpaceJson）+ 元数据 + 状态。
 * parameterSpaceJson 保存冻结的参数空间快照，experimentIdsJson 保存该批次生成的实验 ID 列表；
 * 是「这批 Experiment 是根据什么参数空间产生的」唯一追溯依据。核心输入不可变。
 */
export const researchExperimentBatches = mysqlTable("research_experiment_batches", {
  id: int("id").autoincrement().primaryKey(),
  /** 批实体身份（如 BATCH-YYYYMMDD-XXXXXXXX），全局唯一。 */
  batchId: varchar("batchId", { length: 64 }).notNull().unique(),
  /** 策略身份（冗余列，便于查询；权威值在 parameterSpaceJson 之外的批次元数据内）。 */
  strategyId: varchar("strategyId", { length: 64 }).notNull(),
  /** 策略版本（冗余列，便于查询）。 */
  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
  /** 冻结的参数空间快照（ParameterSpace 序列化）。 */
  parameterSpaceJson: longtext("parameterSpaceJson").notNull(),
  /** 参数空间 canonical fingerprint（SHA-256，研究审计辅助）。 */
  parameterSpaceFingerprint: varchar("parameterSpaceFingerprint", { length: 64 }).notNull(),
  /** 该批次生成的 Experiment ID 列表（JSON 数组，顺序 = 组合生成顺序）。 */
  experimentIdsJson: longtext("experimentIdsJson").notNull(),
  /** 批次状态：created / running / completed / failed / cancelled。 */
  status: mysqlEnum("status", ["created", "running", "completed", "failed", "cancelled"]).notNull().default("created"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  fingerprintIdx: index("idx_research_batches_fingerprint").on(table.parameterSpaceFingerprint),
  createdAtIdx: index("idx_research_batches_created").on(table.createdAt),
}));

export type ResearchExperimentBatchRow = typeof researchExperimentBatches.$inferSelect;
export type InsertResearchExperimentBatch = typeof researchExperimentBatches.$inferInsert;

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
