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
  /** 绑定数据集身份（DS-<datasetVersion>，内容指纹派生）；legacy 路径可为 null。 */
  datasetId: varchar("datasetId", { length: 128 }),
  /** 绑定数据集内容指纹版本（rd-<builder>-<rowSchema>-<16hex>）；legacy 路径可为 null。 */
  datasetVersion: varchar("datasetVersion", { length: 96 }),
  /** 绑定数据集版本快照指纹（SHA-256 前 16 hex）；legacy 路径可为 null。 */
  datasetFingerprint: varchar("datasetFingerprint", { length: 64 }),
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
  datasetVersionIdx: index("idx_research_runs_dataset_version").on(table.datasetVersion),
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
 * 研究数据集持久化表（P2-T1 / G2）。
 * 把 buildResearchDataset 的产物落库：datasetVersion（内容指纹版本）+ 版本快照 + 策略元数据
 * + 数据快照 + universe 定义，实现「数据集可持久化、可复现、可追溯」。
 * 幂等：datasetId = DS-<datasetVersion> 唯一；同内容重跑（同 datasetVersion）不产生重复行。
 */
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
  /** 来源 `research_strategy_candidate.id`（**快照值，非 FK**）。 */
  sourceCandidateId: bigint("sourceCandidateId", { mode: "number" }).notNull(),
  /** 来源 `research_conclusion.id`（**快照值，非 FK**）。 */
  sourceConclusionId: bigint("sourceConclusionId", { mode: "number" }).notNull(),
  /** 来源 `research_experiment.id`（**快照值，非 FK**）。 */
  sourceExperimentId: bigint("sourceExperimentId", { mode: "number" }).notNull(),
  /** 来源 `research_run.id`（可空：Conclusion 无 runId 列，部分证据提不出）。 */
  sourceResearchRunId: bigint("sourceResearchRunId", { mode: "number" }),
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

// ===========================================================================
// RESEARCH-001 — Research 核心持久层（10 张表）
// ===========================================================================
//
// ⚠️ **与遗留 `research_experiments` / `research_runs` / `research_datasets` 的区别**
//
// 遗留三表（复数）属 STEP 6.x 链路：以字符串业务键 `experimentId` + `strategyId` 为标识，
// 内容是单一 `snapshotJson` 大 JSON，服务「Strategy → Parameter Search → Backtest」下游链路。
//
// 本节 10 张表（**单数**）是 Dataset-Registry 原生的 Research 领域层：以 `datasetVersionId`
// （bigint，软引用 `dataset_version.id`）为输入边界，状态 / 类型 **结构化落列**，
// 服务「Dataset → Research → Conclusion → Strategy Candidate」上游链路。
//
// **两套并存，互不引用，互不读写。** 详见 docs/research/RESEARCH-001-AUDIT.md §4。
//
// 全部列名 camelCase、表名 snake_case、JSON 一律 longtext、状态列 varchar + 应用层联合类型、
// **零数据库 FK**（soft reference，引用合法性由 server/researchCore 的 Domain / Repository 保证）。
// ===========================================================================

/**
 * Research 实验（一次可复现研究实验的定义）。
 * 输入边界恒为**单一** `datasetVersionId`；禁止一个 Experiment 动态混用多个 Dataset Version。
 * `configJson` 为开放扩展配置；`sampleCount` / `startedAt` / `completedAt` 由 Run 回填。
 */
export const researchExperiment = mysqlTable("research_experiment", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 dataset_version.id（输入边界，必须存在）。 */
  datasetVersionId: bigint("datasetVersionId", { mode: "number" }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  /** FEATURE / EVENT_STUDY / CONDITIONAL / PATH / REGIME / FACTOR / HYPOTHESIS / CUSTOM。 */
  researchType: varchar("researchType", { length: 32 }).notNull().default("CUSTOM"),
  /** DRAFT / READY / RUNNING / COMPLETED / FAILED / ARCHIVED。 */
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
  /** ResearchExperimentConfig 序列化（开放扩展）。 */
  configJson: longtext("configJson"),
  sampleCount: int("sampleCount"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  datasetVersionIdx: index("idx_research_experiment_dataset_version").on(table.datasetVersionId),
  statusIdx: index("idx_research_experiment_status").on(table.status),
  createdAtIdx: index("idx_research_experiment_created").on(table.createdAt),
}));

export type ResearchExperimentTableRow = typeof researchExperiment.$inferSelect;
export type InsertResearchExperimentRow = typeof researchExperiment.$inferInsert;

/**
 * Research 假设（「我要验证什么」）。**Hypothesis 是研究意图，不是 Analysis，也不是 Conclusion**。
 */
export const researchHypothesis = mysqlTable("research_hypothesis", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_experiment.id。 */
  experimentId: bigint("experimentId", { mode: "number" }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  /** 假设陈述。 */
  statement: text("statement").notNull(),
  nullHypothesis: text("nullHypothesis"),
  alternativeHypothesis: text("alternativeHypothesis"),
  /** DRAFT / TESTING / SUPPORTED / PARTIALLY_SUPPORTED / REJECTED / INCONCLUSIVE。 */
  status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
  /** 速记备注；**正式结论落 research_conclusion**。 */
  conclusion: text("conclusion"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  experimentIdx: index("idx_research_hypothesis_experiment").on(table.experimentId),
  statusIdx: index("idx_research_hypothesis_status").on(table.status),
}));

export type ResearchHypothesisTableRow = typeof researchHypothesis.$inferSelect;
export type InsertResearchHypothesisRow = typeof researchHypothesis.$inferInsert;

/**
 * Research 运行（一次实验执行）。一个 Experiment 可有多次 Run（全周期 / 分年度 / 去极端行情…）。
 * `inputSnapshotJson` 回答「**这次到底用什么配置执行的**」，不得只依赖 Experiment 当前 config。
 * `(experimentId, runNo)` 唯一。
 */
export const researchRun = mysqlTable("research_run", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_experiment.id。 */
  experimentId: bigint("experimentId", { mode: "number" }).notNull(),
  /** 实验内序号（1 起）。 */
  runNo: int("runNo").notNull(),
  /** PENDING / RUNNING / COMPLETED / FAILED / CANCELLED。 */
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  configJson: longtext("configJson"),
  /** 执行时真实落定的配置快照（冻结）。 */
  inputSnapshotJson: longtext("inputSnapshotJson"),
  /**
   * 执行批次日志（**追加式**，JSON 数组；`ResearchRunExecutionLogEntry[]`）。
   *
   * 为什么与 `inputSnapshotJson` 并存：快照语义是「首次执行时落定的基准，**事后不得修改**」，
   * 而 Run 支持「增量补跑」（只补算尚无结果的分析）后，一条 Run 的结果会来自**多次执行**。
   * 只在快照里记一次会让读者误判「这条 Run 只跑过快照列出的分析」——那是不实的。
   * 本列逐批如实记录「第几批 / 模式 / 跑了哪些分析 / 耗时 / 成败」，快照保持不可变。
   *
   * `sequence` 单调递增不跳号，batch 1 = 首次全量执行。⚠️ 本列生效前已存在的 Run，
   * 其 batch 1 只体现在 `inputSnapshotJson` 中，日志自 batch 2 起记录（不 backfill 伪造历史）。
   */
  executionLogJson: longtext("executionLogJson"),
  sampleCount: int("sampleCount"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  experimentRunNoUnique: uniqueIndex("uq_research_run_experiment_run_no").on(table.experimentId, table.runNo),
  experimentIdx: index("idx_research_run_experiment").on(table.experimentId),
  statusIdx: index("idx_research_run_status").on(table.status),
  createdAtIdx: index("idx_research_run_created").on(table.createdAt),
}));

export type ResearchRunTableRow = typeof researchRun.$inferSelect;
export type InsertResearchRunRow = typeof researchRun.$inferInsert;

/**
 * Research 分析（描述「要执行什么分析」）。**不放最终数值结果** —— 结果在 research_result。
 */
export const researchAnalysis = mysqlTable("research_analysis", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_run.id。 */
  runId: bigint("runId", { mode: "number" }).notNull(),
  /** DESCRIPTIVE / DISTRIBUTION / QUANTILE / CORRELATION / IC / EVENT_STUDY / CONDITIONAL / PATH / REGIME / SIGNIFICANCE / STABILITY。 */
  analysisType: varchar("analysisType", { length: 32 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  /** 分析目标字段（如 return_5d）。 */
  target: varchar("target", { length: 200 }),
  configJson: longtext("configJson"),
  /** PENDING / RUNNING / COMPLETED / FAILED / CANCELLED。 */
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  runIdx: index("idx_research_analysis_run").on(table.runId),
  analysisTypeIdx: index("idx_research_analysis_type").on(table.analysisType),
  statusIdx: index("idx_research_analysis_status").on(table.status),
}));

export type ResearchAnalysisTableRow = typeof researchAnalysis.$inferSelect;
export type InsertResearchAnalysisRow = typeof researchAnalysis.$inferInsert;

/**
 * Research 分析条件（**结构化**，禁止只存不可解析字符串）。
 * 组内由 `logicalOperator` 连接，组间由 `groupLogicalOperator` 连接 —— 保留 AND/OR/NOT
 * 与条件组扩展能力（第一版不做完整 AST，但领域对象已可表达）。
 * `sortOrder` 保证组内顺序确定性（复现性要求）。
 */
export const researchAnalysisCondition = mysqlTable("research_analysis_condition", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_analysis.id。 */
  analysisId: bigint("analysisId", { mode: "number" }).notNull(),
  /** 条件组号（组间由 groupLogicalOperator 连接）。 */
  groupNo: int("groupNo").notNull().default(0),
  /** 组内确定性顺序。 */
  sortOrder: int("sortOrder").notNull().default(0),
  fieldName: varchar("fieldName", { length: 128 }).notNull(),
  /** > / >= / < / <= / == / != / IN / NOT_IN / BETWEEN / IS_NULL / IS_NOT_NULL。 */
  operator: varchar("operator", { length: 16 }).notNull(),
  /** 条件值 JSON（标量 / 数组 / 区间）。 */
  valueJson: longtext("valueJson").notNull(),
  /** 组内连接符：AND / OR / NOT。 */
  logicalOperator: varchar("logicalOperator", { length: 8 }).notNull().default("AND"),
  /** 组间连接符：AND / OR。 */
  groupLogicalOperator: varchar("groupLogicalOperator", { length: 8 }).notNull().default("AND"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  analysisIdx: index("idx_research_condition_analysis").on(table.analysisId),
  fieldNameIdx: index("idx_research_condition_field").on(table.fieldName),
}));

export type ResearchAnalysisConditionTableRow = typeof researchAnalysisCondition.$inferSelect;
export type InsertResearchAnalysisConditionRow = typeof researchAnalysisCondition.$inferInsert;

/**
 * Research 分析指标定义（**Metric 是定义，Result 才是计算结果**）。
 * `(analysisId, metricCode)` 唯一，防重复定义。
 */
export const researchAnalysisMetric = mysqlTable("research_analysis_metric", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_analysis.id。 */
  analysisId: bigint("analysisId", { mode: "number" }).notNull(),
  /** MEAN_RETURN / MEDIAN_RETURN / WIN_RATE / MAX_DRAWDOWN / IC / RANK_IC / ICIR / T_STAT / P_VALUE … */
  metricCode: varchar("metricCode", { length: 64 }).notNull(),
  metricName: varchar("metricName", { length: 128 }).notNull(),
  configJson: longtext("configJson"),
  displayOrder: int("displayOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  analysisCodeUnique: uniqueIndex("uq_research_analysis_metric_analysis_code").on(table.analysisId, table.metricCode),
  analysisIdx: index("idx_research_metric_analysis").on(table.analysisId),
  metricCodeIdx: index("idx_research_metric_code").on(table.metricCode),
}));

export type ResearchAnalysisMetricTableRow = typeof researchAnalysisMetric.$inferSelect;
export type InsertResearchAnalysisMetricRow = typeof researchAnalysisMetric.$inferInsert;

/**
 * Research 结果（**统计结果层，非样本层**）。禁止为每个 Dataset 样本生成一行。
 *
 * 结构化 vs JSON 边界：`analysisId` / `metricCode` / `metricValue` / `sampleCount` / `resultType`
 * 是查询、排序、过滤、聚合要用的 → **结构化列**；`dimensionJson` / `resultJson` 是开放扩展 → JSON。
 */
export const researchResult = mysqlTable("research_result", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_analysis.id。 */
  analysisId: bigint("analysisId", { mode: "number" }).notNull(),
  /** SCALAR（单值）/ GROUPED（分组）/ SERIES（序列）。 */
  resultType: varchar("resultType", { length: 32 }).notNull().default("SCALAR"),
  /** 分组维度（如 {"quantile":10}）。 */
  dimensionJson: longtext("dimensionJson"),
  metricCode: varchar("metricCode", { length: 64 }).notNull(),
  /** 结构化数值；复杂结果入 resultJson，故本列可空。 */
  metricValue: double("metricValue"),
  sampleCount: int("sampleCount"),
  /** 复杂统计结果（置信区间 / 分布明细）。 */
  resultJson: longtext("resultJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  analysisMetricIdx: index("idx_research_result_analysis_metric").on(table.analysisId, table.metricCode),
  analysisIdx: index("idx_research_result_analysis").on(table.analysisId),
  metricCodeIdx: index("idx_research_result_metric").on(table.metricCode),
}));

export type ResearchResultTableRow = typeof researchResult.$inferSelect;
export type InsertResearchResultRow = typeof researchResult.$inferInsert;

/**
 * Research 结论（研究必须形成结论，而非停留在统计数字）。
 * `confidence` = **主观置信度 [0,1]，不是 p-value**；统计显著性走 research_result 的
 * `p_value` / `t_stat` / 置信区间。
 */
export const researchConclusion = mysqlTable("research_conclusion", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_experiment.id。 */
  experimentId: bigint("experimentId", { mode: "number" }).notNull(),
  /** 软引用 research_hypothesis.id（探索性结论可为空）。 */
  hypothesisId: bigint("hypothesisId", { mode: "number" }),
  /** SUPPORTED / PARTIALLY_SUPPORTED / REJECTED / INCONCLUSIVE。 */
  conclusionType: varchar("conclusionType", { length: 32 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  conclusion: text("conclusion").notNull(),
  /** 结构化证据数组（引用 analysisId / metricCode / 方向一致性 / 环境分档）。 */
  evidenceJson: longtext("evidenceJson"),
  /** 主观置信度 [0,1]（**非 p-value**）。 */
  confidence: double("confidence"),
  /** DRAFT / FINAL / SUPERSEDED。 */
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  experimentIdx: index("idx_research_conclusion_experiment").on(table.experimentId),
  hypothesisIdx: index("idx_research_conclusion_hypothesis").on(table.hypothesisId),
  statusIdx: index("idx_research_conclusion_status").on(table.status),
}));

export type ResearchConclusionTableRow = typeof researchConclusion.$inferSelect;
export type InsertResearchConclusionRow = typeof researchConclusion.$inferInsert;

/**
 * Research 策略候选（Research 的**出口**）。
 *
 * **Candidate 不是正式 Strategy**：`strategyDefinitionId` 为 NULL 是**合法状态**，
 * 表示「尚未转正」。Research 层只写本表，**绝不** INSERT / UPDATE `strategies` / `strategy_versions`。
 *
 * 🔴 RESEARCH-006.1 写入边界（Domain Model 层强制，见 `repository/contract.ts`）：
 *   普通 update **只**能改人可编辑的草图（name/description/entry·filter·exit·risk·parameterSpace）；
 *   `experimentId` / `conclusionId` / `strategyDefinitionId` / `status` / 4 个 `source*` 列
 *   **一律不可经普通 update 修改** —— `status` 归未来的语义化 transition / promote，
 *   `source*` 归未来的 createFromConclusion / promote。本 STEP 只表达边界，**不实现**这些入口。
 */
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  experimentIdx: index("idx_research_candidate_experiment").on(table.experimentId),
  conclusionIdx: index("idx_research_candidate_conclusion").on(table.conclusionId),
  statusIdx: index("idx_research_candidate_status").on(table.status),
  strategyIdx: index("idx_research_candidate_strategy").on(table.strategyDefinitionId),
  sourceDatasetVersionIdx: index("idx_research_candidate_source_dataset_version").on(
    table.sourceDatasetVersionId,
  ),
}));

export type ResearchStrategyCandidateTableRow = typeof researchStrategyCandidate.$inferSelect;
export type InsertResearchStrategyCandidateRow = typeof researchStrategyCandidate.$inferInsert;

/**
 * Research 文件型产物。**只存 uri + checksum，禁止把大量二进制放进数据库**。
 * `experimentId` / `runId` 至少一个非空（应用层不变量，DB 层不强制）。
 */
export const researchArtifact = mysqlTable("research_artifact", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_experiment.id。 */
  experimentId: bigint("experimentId", { mode: "number" }),
  /** 软引用 research_run.id。 */
  runId: bigint("runId", { mode: "number" }),
  /** REPORT / DATA / CHART / STATISTICS / EXPORT / OTHER。 */
  artifactType: varchar("artifactType", { length: 32 }).notNull(),
  /** FILE / S3 / URL / INLINE。 */
  storageType: varchar("storageType", { length: 32 }).notNull().default("FILE"),
  /** 产物定位。 */
  uri: text("uri").notNull(),
  /** 内容校验（SHA-256 hex）。 */
  checksum: varchar("checksum", { length: 64 }),
  metadataJson: longtext("metadataJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  experimentIdx: index("idx_research_artifact_experiment").on(table.experimentId),
  runIdx: index("idx_research_artifact_run").on(table.runId),
  artifactTypeIdx: index("idx_research_artifact_type").on(table.artifactType),
}));

export type ResearchArtifactTableRow = typeof researchArtifact.$inferSelect;
export type InsertResearchArtifactRow = typeof researchArtifact.$inferInsert;

/**
 * RESEARCH-002C — 分析模板（跨实验复用的「建分析配方」）。
 *
 * 与 `research_analysis` 的根本差别：模板**不属于任何 Run / Experiment**，
 * 展开时（`researchEngine.applyAnalysisTemplate`）才把每一项落成某个 Run 下的分析。
 * `sourceExperimentId` 仅作溯源展示，**不参与展开逻辑**，可为空。
 *
 * 两表而非单表 JSON：明细需要确定性顺序（`sortOrder`）、按模板的整体替换语义、
 * 以及「哪些模板用到 QUANTILE」这类可索引检索 —— 见 migration 0033 的口径说明。
 */
export const researchAnalysisTemplate = mysqlTable("research_analysis_template", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 全局唯一 —— 「一键铺开」时按名字引用必须不歧义。 */
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  /** 软引用 research_experiment.id（仅溯源展示）。 */
  sourceExperimentId: bigint("sourceExperimentId", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  nameUnique: uniqueIndex("research_analysis_template_name_unique").on(table.name),
  sourceExperimentIdx: index("idx_research_template_source_experiment").on(table.sourceExperimentId),
}));

export type ResearchAnalysisTemplateTableRow = typeof researchAnalysisTemplate.$inferSelect;
export type InsertResearchAnalysisTemplateRow = typeof researchAnalysisTemplate.$inferInsert;

/** RESEARCH-002C — 模板明细项（一个待展开的分析定义）。 */
export const researchAnalysisTemplateItem = mysqlTable("research_analysis_template_item", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** 软引用 research_analysis_template.id。 */
  templateId: bigint("templateId", { mode: "number" }).notNull(),
  /** 模板内确定性顺序（复现性要求）。 */
  sortOrder: int("sortOrder").notNull().default(0),
  analysisType: varchar("analysisType", { length: 32 }).notNull(),
  /** 展开时的默认名称（用户可在预览清单里改，因此只是建议）。 */
  name: varchar("name", { length: 200 }).notNull(),
  target: varchar("target", { length: 128 }),
  configJson: longtext("configJson"),
  /**
   * 条件行 JSON（配置快照）。
   *
   * 允许 JSON 而**不是**第三张关系表的理由：模板项的条件不索引、不约束；真正落库为
   * 分析时仍写 `research_analysis_condition` 关系表，口径不降级。
   */
  conditionsJson: longtext("conditionsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  templateIdx: index("idx_research_template_item_template").on(table.templateId),
}));

export type ResearchAnalysisTemplateItemTableRow = typeof researchAnalysisTemplateItem.$inferSelect;
export type InsertResearchAnalysisTemplateItemRow = typeof researchAnalysisTemplateItem.$inferInsert;
