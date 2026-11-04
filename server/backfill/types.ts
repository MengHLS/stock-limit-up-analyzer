/**
 * STEP 7.3 — Full-Market OHLCV Backfill：领域类型。
 *
 * 本模块定义 provider-neutral 的全市场历史日线回填契约，独立于既有 STEP 5 canonical
 * 层（server/data），避免把「全市场回填」的口径与「候选池窄样本 + Strategy Engine」
 * 的口径耦合在一起。
 *
 * 单位约定（canonical，与 Tushare daily 原始单位明确区分）：
 *   - price    元/股
 *   - volume   shares（股）；provider 原始「手」须 × 100
 *   - amount   CNY（元）；provider 原始「千元」须 × 1000
 * 原始单位通过 RawDailyBar.volumeUnit / amountUnit 显式携带，禁止在 canonical 层猜测。
 */

/** 成交量单位。 */
export type VolumeUnit = "shares" | "hands";

/** 成交额单位。 */
export type AmountUnit = "cny" | "thousand-cny";

/** 复权口径（本 STEP 恒为 raw，禁止复权）。 */
export type Adjustment = "raw";

/**
 * Provider-neutral 的原始日线行（未 canonical 化）。
 * 数值字段为 null 表示 provider 未提供或无法解析；单位由 volumeUnit/amountUnit 显式声明。
 */
export interface RawDailyBar {
  /** 交易所感知代码，如 "000001.SZ" / "600001.SH" / "920xxx.BJ"。 */
  securityCode: string;
  /** 交易日（YYYY-MM-DD）。 */
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  preClose: number | null;
  /** 成交量（provider 原始单位）。 */
  volume: number | null;
  /** 成交额（provider 原始单位）。 */
  amount: number | null;
  volumeUnit: VolumeUnit;
  amountUnit: AmountUnit;
}

/**
 * Canonical 全市场市场 bar（STEP 7.3 权威口径）。
 *
 * volume 恒为 shares、amount 恒为 CNY；price 恒为 元/股；adjustment 恒为 "raw"。
 */
export interface CanonicalBackfillBar {
  securityCode: string;
  tradeDate: string;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  closePrice: number | null;
  preClosePrice: number | null;
  /** 成交量（shares）。 */
  volume: number | null;
  /** 成交额（CNY）。 */
  amount: number | null;
  /** 数据来源（provider 标识，如 "tushare"）。 */
  source: string;
  /** 来源 schema/接口版本（如 "daily-v1"）。 */
  sourceVersion: string;
  /** 系统获取 provider 数据的时间（ISO-8601）。非 availableAt。 */
  retrievedAt: string;
  /** RAW 响应的内容指纹（可用于追溯「这一天的数据从哪里来」）。 */
  rawHash: string | null;
  /** 复权口径（恒 raw）。 */
  adjustment: Adjustment;
}

/**
 * Provider 单日全市场返回结果（含 provenance）。
 * 每次 provider response 都必须能回答：哪个 provider、哪个 endpoint、哪天、何时获取、
 * 多少行、是否成功、内容指纹。
 */
export interface ProviderDailyResult {
  provider: string;
  endpoint: string;
  tradeDate: string;
  retrievedAt: string;
  schemaVersion: string;
  rows: RawDailyBar[];
  rawHash: string | null;
  success: boolean;
  /** 失败时的错误信息（success=false 时非空）。 */
  error?: string;
}

/**
 * Provider-neutral 全市场日线接口。业务层（BackfillScheduler）只依赖本接口，
 * 禁止直接调用 tushare daily 等 provider-specific 端点。
 */
export interface MarketDataProvider {
  readonly name: string;
  /** 按交易日获取全市场日线（原始单位 + provenance）。 */
  fetchDailyByTradeDate(tradeDate: string): Promise<ProviderDailyResult>;
}

/** 交易日历中的一天（exchange / isOpen 明确）。 */
export interface TradingCalendarDay {
  /** 日历日期（YYYY-MM-DD）。 */
  calDate: string;
  /** 交易所（如 SSE / SZSE / BSE）。 */
  exchange: string;
  /** 是否开市（只对 isOpen=true 的日期执行 daily fetch）。 */
  isOpen: boolean;
}

/** 交易日历 provider 接口。 */
export interface TradingCalendarProvider {
  readonly name: string;
  fetchTradingCalendar(startDate: string, endDate: string): Promise<TradingCalendarDay[]>;
}

/** 数据质量三态（与既有 STEP 5 语义一致）。 */
export type DataQuality = "VALID" | "WARNING" | "INVALID";

/** 单条校验问题。 */
export interface ValidationIssue {
  severity: DataQuality;
  /** 稳定 code，供程序化处理。 */
  code: string;
  message: string;
}

/** Canonical 校验结果。 */
export interface BarValidationResult {
  status: DataQuality;
  issues: ValidationIssue[];
}

/** Checkpoint 状态。 */
export type CheckpointStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "SUSPICIOUS"
  | "QUOTA_STOPPED";

/** 单个交易日的回填 checkpoint 记录。 */
export interface BackfillCheckpoint {
  tradeDate: string;
  status: CheckpointStatus;
  /** 重试/执行次数。 */
  attempts: number;
  /** 成功时写入的 stock-day 行数。 */
  rowCount: number | null;
  /** provider 返回的原始行数。 */
  receivedRows: number | null;
  /** 完成时间（ISO-8601）；未完成时 null。 */
  completedAt: string | null;
  /** 失败/可疑/配额停止时的错误码。 */
  errorCode: string | null;
  /** 失败/可疑时的补充说明。 */
  errorMessage: string | null;
}

/** Checkpoint 存储接口（可替换实现：内存 / 数据库 / 文件）。 */
export interface CheckpointStore {
  get(tradeDate: string): Promise<BackfillCheckpoint | null>;
  /** upsert 语义：覆盖该交易日的 checkpoint。 */
  set(checkpoint: BackfillCheckpoint): Promise<void>;
  /** 列出 [startDate, endDate] 内所有 checkpoint。 */
  list(startDate: string, endDate: string): Promise<BackfillCheckpoint[]>;
}

/** 一次回填运行的完整 manifest（可复现 + 审计）。 */
export interface BackfillManifest {
  manifestId: string;
  startedAt: string;
  finishedAt: string | null;
  startDate: string;
  endDate: string;
  provider: string;
  /** 目标交易日总数。 */
  targetTradingDates: number;
  /** 已成功交易日数。 */
  completedTradingDates: number;
  /** 失败交易日数。 */
  failedTradingDates: number;
  /** 可疑交易日数。 */
  suspiciousTradingDates: number;
  /** 配额停止（QUOTA_STOPPED）交易日数。 */
  quotaStoppedTradingDates: number;
  /** 累计写入 stock-day 行数。 */
  totalRows: number;
  /** 配置快照（rate limit interval / batch size / concurrency）。 */
  config: BackfillConfig;
}

/** Backfill 运行配置。 */
export interface BackfillConfig {
  /** 单请求最小间隔（ms）。 */
  requestIntervalMs: number;
  /** 单批写入行数。 */
  batchSize: number;
  /** 并发度（第一版恒为 1）。 */
  concurrency: number;
  /** 单日行数异常阈值（低于该比例判 SUSPICIOUS）。 */
  suspiciousCoverageRatio: number;
}

/** 覆盖率审计结果（按日期）。 */
export interface DailyCoverageRecord {
  tradeDate: string;
  status: CheckpointStatus;
  rowCount: number;
  distinctSymbols: number;
}

/** 覆盖率审计报告。 */
export interface CoverageReport {
  startDate: string;
  endDate: string;
  targetTradingDates: number;
  completedTradingDates: number;
  failedTradingDates: number;
  suspiciousTradingDates: number;
  quotaStoppedTradingDates: number;
  missingDates: string[];
  failedDates: string[];
  suspiciousDates: string[];
  totalRows: number;
  distinctSymbols: number;
  minRowsPerDay: number | null;
  maxRowsPerDay: number | null;
  avgRowsPerDay: number | null;
  perYear: YearCoverage[];
  daily: DailyCoverageRecord[];
}

/** 按年份的覆盖率统计。 */
export interface YearCoverage {
  year: number;
  tradingDays: number;
  stockDayRows: number;
  distinctSymbols: number;
  avgRowsPerDay: number | null;
}
