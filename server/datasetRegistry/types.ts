/**
 * STEP DATASET-001 — Dataset Registry 领域类型（唯一权威来源）。
 *
 * 边界铁律（本文件不承载 IO / 策略 / 因子 / 回测逻辑）：
 *   - Dataset 只描述客观市场事实（事件 / 路径 / 特征 / 未来结果）；
 *   - 禁止 Dataset 绑定 Strategy（无 buy/sell/signal/stop_loss/position/strategy 字段）；
 *   - Version 是逻辑版本（dataset_version_id 隔离），不是物理表；
 *   - 不复制公共 OHLCV（stock_daily_prices），通过 symbol+trade_date 引用。
 */

// ---------------------------------------------------------------------------
// Dataset Registry 实体
// ---------------------------------------------------------------------------

/** 逻辑 Dataset 定义（dataset_definition）。 */
export interface DatasetDefinition {
  id?: number;
  /** 稳定语义代码（lowercase snake_case，业务唯一）。 */
  datasetCode: string;
  name: string;
  description?: string | null;
  /** EVENT / FACTOR / ML / RESEARCH。 */
  datasetType: "EVENT" | "FACTOR" | "ML" | "RESEARCH";
  /** DATABASE（当前唯一；未来可扩展 PARQUET / OBJECT_STORAGE）。 */
  storageType: "DATABASE";
  status: "ACTIVE" | "ARCHIVED";
  /** 物理表名显式落库（不运行时按 code+role 猜名）。 */
  eventTableName: string | null;
  pathTableName: string | null;
  outcomeTableName: string | null;
  featureTableName: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** 逻辑版本（dataset_version）。 */
export interface DatasetVersion {
  id?: number;
  datasetId: number;
  version: string;
  status: "DRAFT" | "BUILDING" | "READY" | "FAILED";
  startDate: string | null;
  endDate: string | null;
  /** universe 定义（JSON 序列化后落库）。 */
  universeDefinition?: unknown;
  /** 过滤定义（JSON 序列化后落库）。 */
  filterDefinition?: unknown;
  featureVersion?: string | null;
  sourceVersion?: string | null;
  totalEvents?: number | null;
  totalRows?: number | null;
  createdAt?: string;
  completedAt?: string | null;
}

/** 构建作业（dataset_build_job）。 */
export interface DatasetBuildJob {
  id?: number;
  datasetVersionId: number;
  jobId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  totalChunks?: number | null;
  completedChunks?: number | null;
  currentChunk?: number | null;
  processedRows?: number | null;
  failedRows?: number | null;
  lastSymbol?: string | null;
  lastTradeDate?: string | null;
  lastCursor?: string | null;
  startedAt?: string | null;
  updatedAt?: string;
  completedAt?: string | null;
  errorMessage?: string | null;
}

// ---------------------------------------------------------------------------
// 首板回踩 Dataset 物理行类型（ds_first_limit_pullback_*）
// ---------------------------------------------------------------------------

/** 首板事件行（event）。 */
export interface FirstLimitPullbackEvent {
  datasetVersionId: number;
  eventId: string;
  symbol: string;
  tradeDate: string;
  market: string | null;
  industryCode: string | null;
  boardType: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  previousClose: number | null;
  limitUpPrice: number | null;
  volume: number | null;
  amount: number | null;
  turnover: number | null;
  isFirstLimit: boolean | null;
  previousLimitDate: string | null;
  daysSincePreviousLimit: number | null;
  historicalLimitCount: number | null;
  marketCap: number | null;
  floatMarketCap: number | null;
}

/** 路径行（path）。 */
export interface FirstLimitPullbackPath {
  datasetVersionId: number;
  eventId: string;
  symbol: string;
  tradeDate: string;
  relativeDay: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  amount: number | null;
  turnover: number | null;
  returnFromEventClose: number | null;
  highFromEventClose: number | null;
  lowFromEventClose: number | null;
  closeFromEventClose: number | null;
  pullbackFromEventClose: number | null;
  pullbackFromEventHigh: number | null;
  volumeRatio: number | null;
  isBreakout: boolean | null;
  breakoutPrice: number | null;
  daysToBreakout: number | null;
}

/** 结果行（outcome）。 */
export interface FirstLimitPullbackOutcome {
  datasetVersionId: number;
  eventId: string;
  horizon: number;
  maxReturn: number | null;
  minReturn: number | null;
  maxDrawdown: number | null;
  isBreakout: boolean | null;
  daysToBreakout: number | null;
}

// ---------------------------------------------------------------------------
// 构建抽象
// ---------------------------------------------------------------------------

/** 构建阶段。 */
export type BuildPhase = "events" | "paths" | "outcomes";

/** 构建 checkpoint（cursor 断点）。 */
export interface DatasetBuildCheckpoint {
  phase: BuildPhase;
  /** events 阶段：已完成的最后交易日（keyset 游标）。 */
  lastTradeDate: string | null;
  /** events 阶段：已完成日内的最后 symbol（若日对齐则冗余，可空）。 */
  lastSymbol: string | null;
  /** paths/outcomes 阶段：已完成的最后 eventId（resume 游标）。 */
  lastEventId: string | null;
  /** 已处理行数。 */
  processedRows: number;
  /** 已完成 chunk 数。 */
  completedChunks: number;
  /** events 阶段 resume 所需的「上一交易日涨停集合」（首板判定依赖，崩溃后精确续跑）。 */
  prevLimitUp?: string[];
  /** events 阶段 resume 所需的累计涨停历史（symbol → previousLimitDate / historicalLimitCount）。 */
  cumulative?: Record<string, { previousLimitDate: string | null; historicalLimitCount: number }>;
}

/** 构建结果。 */
export interface DatasetBuildResult {
  status: "COMPLETED" | "FAILED";
  events: number;
  paths: number;
  outcomes: number;
  chunks: number;
  processedRows: number;
  failedRows: number;
  errorMessage?: string | null;
}
