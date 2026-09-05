/**
 * STEP 7.6 — Historical Industry / Index / Liquidity 数据基础设施：统一领域类型与单位约定。
 *
 * 本层是「数据基础设施」，只定义数据与访问语义，禁止承载 Strategy / Factor / Backtest / Risk 逻辑。
 *
 * 与 STEP 5（server/data/types.ts）的 canonical 口径对齐：
 *   - amount   千元
 *   - volume   手（1 手 = 100 股）
 *   - price    元/股
 * 本层新增 liquidity 专属口径：
 *   - turnoverRate         %（换手率，交易所标准字段）
 *   - marketCap            元（流通市值 / 总市值，从 provider 的万元 ×10000 归一）
 *
 * 关键原则：
 *   - 数据可获取性三态（AVAILABLE / UNAVAILABLE / UNKNOWN）显式化；provider 无法提供的字段
 *     一律 null + 标记 UNAVAILABLE，禁止用 0 / 近似值 / 其他字段推导伪造。
 *   - 历史行业（historical industry）与当前行业（current industry）严格区分，禁止用当前行业回填历史。
 */

/** 证券身份标识。当前系统以规范化股票代码（如 "002361.SZ"）作为证券主键。
 *  STEP 7.3 Security Master 落地后将引入 surrogate integer security_id，并在 master 表中与 code 建立一一映射。 */
export type SecurityId = string;

/** 指数代码（规范化、带交易所后缀），如 "000300.SH" / "399006.SZ"。 */
export type IndexCode = string;

/** 数据可获取性三态。 */
export type DataAvailability = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

/** 校验 ISO 日期（YYYY-MM-DD，真实日历日期）。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------------------
// Historical Industry
// ---------------------------------------------------------------------------

/**
 * 历史行业归属：一只证券在一个「有效期」内归属某行业。
 * effective_from 含、effective_to 含（null 表示至今仍有效）。
 * 同一证券在任一时点至多一个生效区间；区间不得重叠（由 industry.validateIndustryIntervals 保证）。
 */
export interface IndustryAssignment {
  securityId: SecurityId;
  /** 行业代码（如申万一级 801010），来源特定。 */
  industryCode: string;
  /** 行业名称（如 农林牧渔）。 */
  industryName: string;
  /** 生效起始日（YYYY-MM-DD，含）。 */
  effectiveFrom: string;
  /** 生效截止日（YYYY-MM-DD，含）；null = 至今仍有效。 */
  effectiveTo: string | null;
  /** 来源（如 akshare-sw / tushare / manual）。 */
  source: string;
  /** 本行数据被写入/检索的时间（ISO 8601）。 */
  retrievedAt: string;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/** 指数身份主数据：一个「指数」的权威身份（code / name / 首发日 / 来源）。 */
export interface IndexMasterEntry {
  /** 规范化指数代码，如 "000300.SH"。 */
  indexCode: IndexCode;
  /** 指数名称，如 沪深300。 */
  indexName: string;
  /** provider 名（tushare / sina / baostock / manual）。 */
  provider: string;
  /** provider 原生代码（如 sina 的 sh000300）。 */
  providerCode: string;
  /** 数据首日（YYYY-MM-DD），可能为 null（未确认）。 */
  firstDate: string | null;
  /** 数据末日（YYYY-MM-DD），可能为 null（未确认）。 */
  lastDate: string | null;
  /** 数据来源描述。 */
  source: string;
  /** 检索时间（ISO 8601）。 */
  retrievedAt: string;
}

/** 指数日线 bar（单位与 canonical 对齐：price 元/点、amount 千元、volume 手）。 */
export interface IndexDailyBar {
  indexCode: IndexCode;
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  amount: number | null;
  volume: number | null;
  source: string;
}

// ---------------------------------------------------------------------------
// Liquidity / Daily Basic
// ---------------------------------------------------------------------------

/** 统一流动性日线。不可获取的字段为 null，并由 LiquidityAvailability 显式标记 UNAVAILABLE。 */
export interface LiquidityDaily {
  securityId: SecurityId;
  tradeDate: string;
  /** 换手率（%）。 */
  turnoverRate: number | null;
  /** 流通市值（元）。 */
  circulationMarketCap: number | null;
  /** 总市值（元）。 */
  totalMarketCap: number | null;
  /** 成交额（千元）。 */
  amount: number | null;
  /** 成交量（手）。 */
  volume: number | null;
  source: string;
}

/** 一个 provider 对流动性各字段的可提供性声明（用于显式标记 UNAVAILABLE，避免静默 null）。 */
export interface LiquidityProviderCapability {
  turnoverRate: DataAvailability;
  circulationMarketCap: DataAvailability;
  totalMarketCap: DataAvailability;
  amount: DataAvailability;
  volume: DataAvailability;
}

/** 流动性字段名。 */
export type LiquidityField = keyof LiquidityProviderCapability;

/** 单位常量：全系统引用同一来源，禁止硬编码/自行乘除。 */
export const LIQUIDITY_UNITS = {
  turnoverRate: "%",
  marketCap: "元",
  amount: "千元",
  volume: "手(1手=100股)",
} as const;

/** 换手率合理范围上界（%，极宽松上界避免误报，与 STEP 5 对齐）。 */
export const TURNOVER_RATE_MAX = 1000;
