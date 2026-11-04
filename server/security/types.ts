/**
 * STEP 7.4 — Security Master / Identifier Lifecycle：领域类型（唯一权威来源）。
 *
 * 核心原则：
 *   - security_id = 永久身份（系统分配的稳定标识，不随代码变化而变化）。
 *   - stock_code = 时间有效的市场标识（同一 security 在不同时间可有不同 code）。
 *   - 禁止把 stock_code 当作永久 security identity。
 *
 * 本模块只建立「证券身份层」，不实现 Backtest / Strategy / Factor / Risk / Portfolio。
 */

/** 交易所（A 股三大交易所）。BJ = 北京证券交易所。 */
export const EXCHANGES = ["SH", "SZ", "BJ"] as const;
export type Exchange = (typeof EXCHANGES)[number];

/** 证券类型。STEP 7.4 聚焦 stock，其余类型预留以支撑后续扩展。 */
export const SECURITY_TYPES = ["stock", "etf", "index", "bond", "fund"] as const;
export type SecurityType = (typeof SECURITY_TYPES)[number];

/**
 * 证券生命周期状态（当前/最近已知快照，非时间序列）。
 * STEP 7.4 只建立 identity lifecycle foundation；完整 Historical Status 属 STEP 7.5。
 */
export const SECURITY_STATUSES = ["listed", "suspended", "delisted", "terminated", "unknown"] as const;
export type SecurityStatus = (typeof SECURITY_STATUSES)[number];

/**
 * 标识符类型。identifier history 与 name history 严格独立。
 * "primary" 为交易所 6 位数字代码；其余为各 provider 的别名/映射。
 */
export const IDENTIFIER_TYPES = ["primary", "tushare_ts_code", "sina_symbol", "baostock_code", "tencent_symbol"] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** 解析后的证券代码（数字部分 + 交易所）。 */
export interface SecurityCode {
  /** 6 位数字代码，如 "600000"。 */
  digits: string;
  /** 交易所。 */
  exchange: Exchange;
}

/**
 * 证券标识符历史记录（时间有效区间）。
 * 同一 security_id 在不同区间可对应不同 code；同一 code 在不同区间可对应不同 security_id。
 * effectiveTo 为 null 表示「至今有效」（开放区间）。
 */
export interface SecurityIdentifier {
  /** 永久身份。 */
  securityId: string;
  /** 交易所。 */
  exchange: Exchange;
  /** 6 位数字代码（不含交易所后缀）。 */
  code: string;
  /** 标识符类型。 */
  identifierType: IdentifierType;
  /** 生效日期（含），YYYY-MM-DD。 */
  effectiveFrom: string;
  /** 失效日期（含），YYYY-MM-DD；null = 至今有效。 */
  effectiveTo: string | null;
  /** 来源 provider / 数据源。 */
  source: string;
}

/**
 * 证券主数据（永久身份）。
 * listedDate / delistedDate 是 as-of universe 判定的权威时间界；
 * status 是「当前/最近已知」快照，不承担历史状态（属 STEP 7.5）。
 */
export interface Security {
  /** 永久身份（系统分配）。 */
  securityId: string;
  /** 证券类型。 */
  securityType: SecurityType;
  /** 当前交易所归属。 */
  exchange: Exchange;
  /** 计价货币。 */
  currency: string;
  /** 上市地国家/地区代码。 */
  country: string;
  /** 生命周期状态快照。 */
  status: SecurityStatus;
  /** 上市日期（含），YYYY-MM-DD；未知为 null。 */
  listedDate: string | null;
  /** 退市日期（含，最后一个可交易日），YYYY-MM-DD；未退市为 null。 */
  delistedDate: string | null;
}
