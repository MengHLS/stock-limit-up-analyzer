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
  prefixTableName: string | null;
  postTableName: string | null;
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

/**
 * 首板事件行（event）。
 *
 * **不含逐日行情**（`open`/`high`/`low`/`close`/`volume`/`amount` 在 `prefix`/`post`）：
 * 事件表只回答「事件是什么」，行情由窗口表回答（消除跨表 t 日重复）。
 * `previousClose` / `limitUpPrice` / `turnover` / `marketCap` / `floatMarketCap` 是
 * **时点 / 定义性属性**（非日线原始字段），保留于本表。
 */
export interface FirstLimitPullbackEvent {
  datasetVersionId: number;
  eventId: string;
  symbol: string;
  tradeDate: string;
  market: string | null;
  industryCode: string | null;
  boardType: string | null;
  /** t−1 日收盘价（涨停判定依据，不可下移）。 */
  previousClose: number | null;
  /** 涨停价（由 previousClose 派生，四舍五入到分）。 */
  limitUpPrice: number | null;
  /** t 日换手率（来自流动性富集 liquidity_daily.turnoverRate，非日线列）。 */
  turnover: number | null;
  isFirstLimit: boolean | null;
  previousLimitDate: string | null;
  daysSincePreviousLimit: number | null;
  historicalLimitCount: number | null;
  marketCap: number | null;
  floatMarketCap: number | null;
}

/**
 * 原始行情窗口行（`prefix` / `post` **严格同构**，唯一区别是 `relativeDay` 区间）。
 * 只含纯日线原始列，**不含任何衍生列**（不变量 I8/I9）。
 */
export interface FirstLimitPullbackRawBar {
  datasetVersionId: number;
  eventId: string;
  symbol: string;
  tradeDate: string;
  /** prefix：∈ [-preWindowDays, 0]；post：∈ [1, postWindowDays]。 */
  relativeDay: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  amount: number | null;
}

/** 前置行情行（`relativeDay ∈ [-preWindowDays, 0]`，0 = t 日；PIT 安全特征窗口）。 */
export type FirstLimitPullbackPrefix = FirstLimitPullbackRawBar;

/** 后置行情行（`relativeDay ∈ [1, postWindowDays]`；精确回测撮合 / 标签窗口）。 */
export type FirstLimitPullbackPost = FirstLimitPullbackRawBar;

/**
 * 路径行（path）—— **只存衍生指标**，`relativeDay ≥ 1`。
 *
 * 已删：6 个原始行情列（→ `post`）、`turnover`（死列，恒 null）、
 * `returnFromEventClose`（≡ `closeFromEventClose`）、`pullbackFromEventClose`（≡ `lowFromEventClose`）。
 */
export interface FirstLimitPullbackPath {
  datasetVersionId: number;
  eventId: string;
  symbol: string;
  tradeDate: string;
  relativeDay: number;
  highFromEventClose: number | null;
  lowFromEventClose: number | null;
  closeFromEventClose: number | null;
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
// 构建 / 筛选配置（STEP DATASET-003B）
// ---------------------------------------------------------------------------
//
// 语义与 shared/datasetRegistryContracts.ts 的 B2 节同源（前端契约 / 领域类型一一对应）；
// 落库于 dataset_build_config（主表标量）+ dataset_build_config_event / _board（子表多值）。

/** 市场板块类别（与 server/data/boardRules.classifyBoard 输出一致）。 */
export type DatasetBoard = "main" | "chinext" | "star" | "bse";

/** 事件类型（客观市场事实，非策略信号）。 */
export type DatasetEventKind = "firstBoard" | "limitUp" | "consecutiveBoard";

/**
 * 事件维度规格 = 相对日 × 事件类型。
 * `relativeDay` 以「事件日 t」为 0（≤ 0）：0 = t 日、-1 = t-1 日、-2 = t-2 日。
 * 多条规格为 OR（任一命中即收录）。
 */
export interface DatasetEventSpec {
  relativeDay: number;
  kind: DatasetEventKind;
}

/** 构建 / 筛选配置（领域形态：主表标量 + 子表多值已展开）。 */
export interface DatasetBuildConfigRecord {
  id?: number;
  datasetVersionId: number;
  /** 板块（空 = 不过滤，含 unknown）。 */
  boards: DatasetBoard[];
  /** 排除 ST/*ST（PIT st 维度）。 */
  excludeSt: boolean;
  /** 事件维度（至少 1 条）。 */
  events: DatasetEventSpec[];
  /** t 日之前的数据天数。 */
  preWindowDays: number;
  /** t 日之后的数据天数（等价旧 pathHorizon）。 */
  postWindowDays: number;
  /** outcome 视界（交易日，去重升序）。 */
  outcomeHorizons: number[];
  /** 批插入大小。 */
  batchSize: number;
  /** 配置 schema 版本。 */
  configVersion: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ---------------------------------------------------------------------------
// 构建抽象
// ---------------------------------------------------------------------------

/** 构建阶段：先逐日检测事件，再逐事件装配窗口（prefix/post/path/outcome）。 */
export type BuildPhase = "events" | "windows";

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
  /**
   * events 阶段 resume 所需的「每 symbol 涨停交易日序号」（窗口首个交易日 = 0）。
   *
   * 为什么需要：DATASET-003B 的事件维度允许锚点相对日 ≤ 0（t-1 / t-2…），必须精确回答
   * 「锚点日是否涨停 / 锚点前一日是否涨停 / 锚点前最后一次涨停是哪天」。仅靠 prevLimitUp +
   * cumulative（只有「截至今日」的一个标量）无法回看，故按 symbol 保留窗口内全部涨停日序号。
   *
   * 缺失（DATASET-001/002 旧版 checkpoint）→ builder 视为**不兼容**并明确失败
   * （CHECKPOINT_INCOMPATIBLE），绝不静默用不完整状态续跑出错误数据。
   */
  limitUpDays?: Record<string, number[]>;
  /** checkpoint 结构版本（DATASET-003B 起 = 2；旧 checkpoint 无此字段 = 1）。 */
  schemaVersion?: number;
}

/** 构建结果。 */
export interface DatasetBuildResult {
  status: "COMPLETED" | "FAILED";
  events: number;
  /** prefix 表行数（原始行情，rd ≤ 0）。 */
  prefixes: number;
  /** post 表行数（原始行情，rd ≥ 1）。 */
  posts: number;
  paths: number;
  outcomes: number;
  chunks: number;
  processedRows: number;
  failedRows: number;
  errorMessage?: string | null;
}
