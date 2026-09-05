/**
 * STEP 5 — Data Quality + Canonical Market Data 层：统一领域类型与单位约定。
 *
 * 目标：全系统「市场数据」只有一套 canonical 口径；任何模块（Strategy / Feature /
 * Backtest Core / Legacy）不得直接解释外部数据源（Tushare / DB row / CSV）的字段。
 *
 * 单位约定（以项目既有数据源 Tushare daily 与现有业务语义为准，严禁各模块自行换算）：
 *   - price        元/股（Tushare daily open/close/high/low/pre_close 原义）
 *   - volume       手（Tushare daily vol 原义，1 手 = 100 股）
 *   - amount       千元（Tushare daily amount 原义；历史遗留注释与引擎容量约束均按千元）
 *   - turnoverRate %（项目既有业务口径：成交额 / 流通市值 × 100；交易所 turnover_rate
 *                   原始字段在本项目数据中不存在，未提供时一律 null，禁止伪造）
 *
 * 复权口径：当前系统仅使用 Tushare daily 未复权价格（raw）。schema 明确「未复权」。
 * canonical bar 的 adjustment 字段恒为 "raw"；系统不允许复权价与未复权价混用。
 */

/** 复权口径。当前系统唯一支持 raw（Tushare daily 未复权）。 */
export type PriceAdjustment = "raw" | "forward" | "backward";

/** 股票代码（带交易所后缀，如 "002361.SZ" / "600001.SH" / "920xxx.BJ"）。 */
export type StockSymbol = string;

/**
 * Canonical Market Bar：一只股票一个交易日的统一市场快照。
 *
 * 时间语义：
 *   - timestamp 为交易日（YYYY-MM-DD）。
 *   - 一根 bar 代表该交易日“收盘后可见”的完整日线信息；其中 open/prevClose
 *     在该日开盘时即已知，high/low/close/volume/amount 在该日收盘后才完全可知。
 *     是否可被某个 decisionTime 消费，必须由 server/data/series 的 asOf 过滤保证，
 *     不得依赖「数组里有没有」。
 *
 * 允许缺失（null = 明确未知/数据源未提供），禁止用 close || 0 之类静默填零。
 */
export interface CanonicalMarketBar {
  symbol: StockSymbol;
  /** 交易日（YYYY-MM-DD），即 dataTime。 */
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  /** 前收盘价（未复权）。 */
  preClose: number | null;
  /** 成交量，单位：手。 */
  volume: number | null;
  /** 成交额，单位：千元。 */
  amount: number | null;
  /**
   * 换手率（%），按项目既有口径（成交额/流通市值×100）。
   * 交易所标准 turnover_rate 原始字段不存在，未估算时 null，禁止伪造。
   */
  turnoverRate: number | null;
  /**
   * 复权口径（当前恒为 "raw"）。明确禁止在系统中混用不同口径的 OHLC。
   */
  adjustment: PriceAdjustment;
}

/** 单位常量：所有模块引用同一来源，禁止硬编码/自行乘除。 */
export const MARKET_DATA_UNITS = {
  price: "元/股",
  volume: "手(1手=100股)",
  amount: "千元",
  turnoverRate: "%(成交额/流通市值×100)",
} as const;

/** 数据质量三态。 */
export type DataQuality = "VALID" | "WARNING" | "INVALID";

/** 单条校验问题。 */
export interface ValidationIssue {
  severity: DataQuality;
  /** 稳定 code，供调用方程序化处理（非自由文本）。 */
  code: string;
  message: string;
}

/** Canonical 校验结果。 */
export interface BarValidationResult {
  status: DataQuality;
  issues: ValidationIssue[];
}
