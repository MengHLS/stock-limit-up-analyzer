import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, date, index, uniqueIndex, longtext } from "drizzle-orm/mysql-core";

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
