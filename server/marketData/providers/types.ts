/**
 * STEP 7.6 — Provider Adapter 接口（provider-neutral）。
 *
 * 消费方只依赖这些接口，不得直接依赖 Tushare / Sina / BaoStock / AkShare 的具体实现。
 * 每个 provider 负责把外部原始数据归一化为 canonical 领域类型（单位已在 ../liquidity、../indexes 约定）。
 */

import type {
  IndexCode,
  IndexDailyBar,
  IndexMasterEntry,
  LiquidityDaily,
  LiquidityProviderCapability,
  SecurityId,
} from "../types";

/** 指数 provider adapter。 */
export interface IndexProvider {
  readonly name: string;
  /** 获取指数身份（code/name/firstDate/lastDate/source），用于 identity 校验；失败返回 null。 */
  fetchIdentity(indexCode: IndexCode): Promise<IndexMasterEntry | null>;
  /** 获取指数日线（canonical 单位：point、amount 千元、volume 手）。 */
  fetchDaily(indexCode: IndexCode, startDate: string, endDate: string): Promise<IndexDailyBar[]>;
}

/** 流动性 provider adapter。 */
export interface LiquidityProvider {
  readonly name: string;
  /** 该 provider 的字段可提供性（显式 UNAVAILABLE）。 */
  readonly capability: LiquidityProviderCapability;
  /** 获取单只证券区间流动性（canonical 单位）。 */
  fetchDaily(securityId: SecurityId, startDate: string, endDate: string): Promise<LiquidityDaily[]>;
}

/** 行业列表项。 */
export interface IndustryListItem {
  industryCode: string;
  industryName: string;
}

/** 行业成分项。 */
export interface IndustryMemberRow {
  securityId: SecurityId;
  securityName: string;
}

/** 历史行业覆盖度声明。 */
export interface HistoricalIndustryCoverage {
  /** 能否获取「带有效期的历史行业成分」（而非仅当前快照）。 */
  historicalMembersAvailable: boolean;
  /** 说明。 */
  note: string;
}

/** 行业 provider adapter。 */
export interface IndustryProvider {
  readonly name: string;
  /** 申万一级行业列表（当前）。 */
  fetchIndustries(): Promise<IndustryListItem[]>;
  /** 某行业当前成分（当前快照，非历史）。 */
  fetchMembers(industryCode: string): Promise<IndustryMemberRow[]>;
  /** 历史覆盖度声明（能否提供历史成分有效期）。 */
  historicalCoverage(): HistoricalIndustryCoverage;
}
