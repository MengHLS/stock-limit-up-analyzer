/**
 * STEP 12.5 — Historical State Reconstruction：领域类型（唯一权威来源）。
 *
 * 目标（ROADMAP §11 / §45.1）：把 Raw Data（各 canonical 数据域）重建为 Historical Market State——
 * 对任意 (security, date)，系统必须能以 asOf(T) 视角回答：
 *   1. 当时是什么证券（身份）      2. 当时是否上市     3. 当时是否退市
 *   4. 当时属于什么行业            5. 当时是否可交易   6. 当时流动性如何
 *   7. 当时价格是多少              8. 哪些公司行为已生效
 *   9. 当时市场状态（核心指数）    10. 当时哪些信息已经可知
 *
 * 语义约束（与各下层 STEP 一致，禁止在本层重新定义）：
 *   - 本模块只做「读取 + 重建 + PIT 过滤」，禁止引入策略 / 因子 / 回测逻辑。
 *   - PIT 铁律（§4）：asOf(T) 查询只能看到 T 时点已可获得的信息；未来信息禁止进入过去。
 *   - 三类时间严格区分：effectiveDate（生效）/ availableAt / announcementDate（可知）/
 *     retrievedAt（写入）。禁止用 retrievedAt 冒充 effectiveDate。
 *   - 身份键：security_id（sec_<uuid>）为永久身份；code 键数据域（industry/liquidity/price/
 *     corporateActions）以完整代码（如 600000.SH）为自然键，二者经 Identifier History 桥接；
 *     禁止把 stock_code 冒充 security_id。
 *   - 日级事实（OHLCV / liquidity / index daily）以「当日收盘后可知」为口径；盘中可知性属于
 *     decisionPoint 语义（server/data/series asOf 过滤），不在本层重复建模。
 *
 * 依赖：STEP 7.4 Security Master / Identifier、STEP 7.5 Status、STEP 7.6 Industry / Index /
 *       Liquidity、STEP 7.7 Corporate Actions、STEP 5 Canonical Bar、STEP 11 Historical Universe。
 */

import type { CanonicalMarketBar } from "../data/types";
import type { CorporateAction } from "../corporateActions/types";
import type {
  IndexDailyBar,
  IndexMasterEntry,
  IndustryAssignment,
  LiquidityDaily,
} from "../marketData/types";
import type { ExclusionReason, HistoricalStStatus } from "../security/historicalUniverse";
import type { TradingCalendar } from "../security/tradingCalendar";
import type {
  Exchange,
  IdentifierType,
  Security,
  SecurityIdentifier,
  SecurityType,
} from "../security/types";
import type {
  ResolvedStatusValue,
  SecurityStatusInterval,
  SecurityStatusSnapshot,
} from "../securityStatus/types";

// ---------------------------------------------------------------------------
// 查询入参
// ---------------------------------------------------------------------------

/**
 * asOf(T) 历史状态重建的全部输入（纯数据、只读；调用方负责从 DB 加载）。
 * 各 code 键数据域（industryAssignments / priceBar / liquidity / corporateActions）
 * 只应包含「在该时点属于本 security」的数据（防代码复用串扰），reconstruct 不做静默越权装载。
 */
export interface HistoricalStateInput {
  /** 证券主数据（永久身份，STEP 7.4）。 */
  security: Security;
  /** 该 security 的标识符历史（可含 primary 与别名；按区间键）。 */
  identifiers: readonly SecurityIdentifier[];
  /** 该 security 的历史状态区间（LISTING / TRADING / ST / DELISTING / SUSPENSION）。 */
  statusIntervals: readonly SecurityStatusInterval[];
  /**
   * 行业区间（可选；按完整代码 securityId 键，如 "600000.SH"）。
   * undefined = 未加载（knowledge.industry = UNKNOWN）；[] = 已加载但无记录。
   */
  industryAssignments?: readonly IndustryAssignment[];
  /**
   * tradeDate 的未复权日线 bar（可选）。symbol 必须是 tradeDate 生效的完整代码；
   * 提供但代码不匹配时 reconstruct 抛错（默认拒绝，禁止静默错配）。
   */
  priceBar?: CanonicalMarketBar | null;
  /** tradeDate 的流动性日线（可选；securityId = 完整代码，口径同 priceBar）。 */
  liquidity?: LiquidityDaily | null;
  /**
   * 该 security 的公司行为事件集（可选，按完整代码键）。
   * undefined = 未加载（knowledge.corporateActions = UNKNOWN）；
   * 已加载但无事件 = []（表示「该时点无已生效事件」）。
   */
  corporateActions?: readonly CorporateAction[];
  /** tradeDate 各核心指数日线（可选）。 */
  indexBars?: readonly IndexDailyBar[];
  /** 各核心指数身份（可选，用于结果中的名称解析）。 */
  indexMaster?: readonly IndexMasterEntry[];
}

/** asOf(T) 查询选项。 */
export interface HistoricalStateOptions {
  /**
   * point-in-time 信息截止点（YYYY-MM-DD）。
   *   - null（默认） = FULL_KNOWLEDGE 全知视角：不排除未来可知的状态（非研究口径，仅调试/审计用）。
   *   - 指定日期   = PIT 口径：状态维度按 availability（含 T+1 交易日语义）过滤、
   *     行业按 retrievedAt、公司行为按 announcementDate 过滤，杜绝未来信息进入过去。
   */
  asOf?: string | null;
  /**
   * 可选交易日历。提供时启用 T+1 = 「下一交易日」（周五的 T+1 是周一，不是周六）语义，
   *   并可在 query.isTradingDay 判定 tradeDate 是否开市。
   */
  calendar?: TradingCalendar;
}

// ---------------------------------------------------------------------------
// 结果
// ---------------------------------------------------------------------------

/** 生命周期裁决（描述性答案；不影响 tradability 的默认拒绝判定）。 */
export type LifecycleVerdict = "LISTED" | "NOT_YET_LISTED" | "DELISTED" | "UNKNOWN";

/** 维度可知性。 */
export type KnowledgeStatus = "KNOWN" | "UNKNOWN";

/** 知识策略：PIT = 按 asOf 过滤后的可知信息；FULL_KNOWLEDGE = 当前全量视角。 */
export type KnowledgePolicy = "PIT" | "FULL_KNOWLEDGE";

/** 查询上下文（结果自述）。 */
export interface HistoricalStateQuery {
  securityId: string;
  /** 被查询的交易日（YYYY-MM-DD）。 */
  tradeDate: string;
  /** point-in-time 截止点；null = 全知视角。 */
  asOf: string | null;
  /** tradeDate 是否开市；未提供 calendar 时为 null。 */
  isTradingDay: boolean | null;
  /** 所用交易日历名称；未提供为 null。 */
  calendar: string | null;
}

/** Q1 当时是什么证券：身份。 */
export interface IdentityState {
  securityId: string;
  securityType: SecurityType;
  exchange: Exchange;
  currency: string;
  country: string;
  /** tradeDate 生效的 6 位数字代码（identifier 层，无后缀）；无生效标识符为 null。 */
  codeDigits: string | null;
  /** tradeDate 生效的完整代码（如 600000.SH），供 code 键数据域桥接；无则为 null。 */
  code: string | null;
  /** 生效标识符类型（primary 优先；无 primary 时取别名）；无生效标识符为 null。 */
  identifierType: IdentifierType | null;
  /** 生效标识符的有效区间（code 键数据域的时间归属界）。 */
  identifierEffectiveFrom: string | null;
  identifierEffectiveTo: string | null;
}

/** Q2 / Q3 当时是否上市 / 退市：生命周期。 */
export interface LifecycleState {
  /** master 当前/最近已知状态快照（非时间序列，仅供对照）。 */
  masterStatus: Security["status"];
  /** master 上市日（权威时间界）。 */
  listedDate: string | null;
  /** master 退市日（权威时间界）；null = 未退市。 */
  delistedDate: string | null;
  /** LISTING 维度在 (tradeDate, asOf) 的解析结果；无已知数据为 null。 */
  listing: ResolvedStatusValue | null;
  /** DELISTING 维度在 (tradeDate, asOf) 的解析结果；无已知数据为 null。 */
  delisting: ResolvedStatusValue | null;
  /** 描述性裁决（综合 master 时间界 + LISTING/DELISTING 维度）。 */
  verdict: LifecycleVerdict;
}

/** Q5 当时是否可交易（含默认拒绝的剔除原因与 ST 信息维度）。 */
export interface TradabilityState {
  /** 是否可交易（严格：UNKNOWN/缺失不得默认放行）。 */
  eligible: boolean;
  /** eligible=false 时的稳定剔除原因 code；eligible=true 为 null。 */
  reason: ExclusionReason | null;
  /** ST 信息维度（不参与 eligibility；NORMAL 也须为显式记录）。 */
  st: HistoricalStStatus;
  /** TRADING 维度解析结果。 */
  trading: ResolvedStatusValue | null;
  /** SUSPENSION 维度解析结果。 */
  suspension: ResolvedStatusValue | null;
  /** 完整状态快照（含各维度 resolved / unknownDimensions，供下游按需读取）。 */
  snapshot: SecurityStatusSnapshot;
}

/** Q4 当时属于什么行业（按 (tradeDate, asOf) 解析的区间）。 */
export interface IndustryState {
  /** 行业代码（如申万一级 801010）。 */
  industryCode: string;
  /** 行业名称（如 农林牧渔）。 */
  industryName: string;
  /** 该归属的生效区间。 */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** 来源。 */
  source: string;
}

/** 一条市场状态快照（单只核心指数在 tradeDate 的日线）。 */
export interface MarketStateEntry {
  /** 规范化指数代码，如 000300.SH。 */
  indexCode: string;
  /** 指数名称；indexMaster 未提供或无该指数时为 null。 */
  indexName: string | null;
  bar: IndexDailyBar;
}

/** Q8 已生效的公司行为（含 PIT 可知性双层口径）。 */
export interface CorporateActionsState {
  /** 知识策略（PIT = 按 asOf 的 announcementDate 过滤；FULL_KNOWLEDGE = 全知）。 */
  policy: KnowledgePolicy;
  /** Q8a：effectiveDate <= tradeDate 的全部已生效事件（不区分为知与否）。 */
  effectiveOnOrBefore: CorporateAction[];
  /** Q8b + Q10：在 asOf 时点「已公告可知」的事件（PIT 口径）。 */
  knownAtAsOf: CorporateAction[];
}

/** Q10 当时哪些信息已经可知：维度级可知性审计。 */
export interface HistoricalKnowledge {
  /** 知识策略。 */
  policy: KnowledgePolicy;
  dimensions: {
    /** 身份：master 存在即 KNOWN。 */
    identity: KnowledgeStatus;
    /** 上市状态：LISTING 维度有已解析数据才 KNOWN。 */
    listing: KnowledgeStatus;
    /** 退市状态：DELISTING 维度有已解析数据才 KNOWN。 */
    delisting: KnowledgeStatus;
    /** 可交易判定依据：TRADING 维度有已解析数据才 KNOWN。 */
    tradability: KnowledgeStatus;
    /** 行业：industryAssignments 已加载且解析出归属才 KNOWN。 */
    industry: KnowledgeStatus;
    /** 流动性：tradeDate 有流动性行才 KNOWN（日级，收盘后可知）。 */
    liquidity: KnowledgeStatus;
    /** 价格：tradeDate 有日线 bar 才 KNOWN（日级，收盘后可知）。 */
    price: KnowledgeStatus;
    /** 公司行为：corporateActions 已加载才 KNOWN（未加载不推断为「无事件」）。 */
    corporateActions: KnowledgeStatus;
    /** 市场状态：tradeDate 存在任一核心指数日线才 KNOWN。 */
    marketState: KnowledgeStatus;
  };
  /** 各维度可知性依据与口径的说明。 */
  note: string;
}

/** 完整历史状态：对任意 (security, date) 在 asOf(T) 视角下的统一答案。 */
export interface SecurityHistoricalState {
  /** 查询上下文。 */
  query: HistoricalStateQuery;
  /** Q1 身份。 */
  identity: IdentityState;
  /** Q2/Q3 生命周期。 */
  lifecycle: LifecycleState;
  /** Q5 可交易性。 */
  tradability: TradabilityState;
  /** Q4 行业。 */
  industry: IndustryState | null;
  /** Q6 流动性（tradeDate 日级）。 */
  liquidity: LiquidityDaily | null;
  /** Q7 价格（tradeDate 未复权日线 bar）。 */
  price: CanonicalMarketBar | null;
  /** Q8 已生效公司行为。 */
  corporateActions: CorporateActionsState;
  /** Q9 市场状态（tradeDate 各核心指数日线，按 indexCode 升序）。 */
  marketState: MarketStateEntry[];
  /** Q10 可知性审计。 */
  knowledge: HistoricalKnowledge;
}
