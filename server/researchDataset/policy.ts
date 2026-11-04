/**
 * STEP 12.6 — Research Dataset 策略元数据（C-12.6.2）：9 类 policy 的权威模型 + 确定性派生。
 *
 * 目标（ROADMAP §12 / §45.2 Exit）：把 §12 要求而 C-12.6.1 只以 domain.note 散落注释的
 * 口径升级为「一等公民、结构化、机器可读、可校验」的策略声明，并与 dataset_version /
 * data_snapshot / universe_definition 绑定为版本快照产物（见 versionSnapshot.ts）。
 *
 * 9 类 policy 与 ROADMAP / 既有实现语义的映射（policyId → 依据 → evidence）：
 *   - pit                      → §12 "PIT policy" + §45.2；逐日 PIT vs 固定快照（validate/universe）
 *   - survivorship             → §12 "survivorship policy"；B Master 全表含退市 + STEP11 逐日生命周期
 *   - corporate-action         → §12 "corporate action policy"；effective vs known 双层口径
 *   - adjustment               → §12 "adjustment policy"；行价 open/high/low/close/preClose 为 raw 未复权
 *   - industry                 → §12 "industry policy"；retrievedAt PIT + full-code ownership 过滤
 *   - liquidity                → §12 "liquidity policy"；tradeDate 日级事实（收盘后可知）
 *   - universe-membership      → §12 "universe_definition"（成员决议口径：STEP11 默认拒绝）
 *   - calendar-trading-days    → C-12.6.1 calendar/asOf 语义（T+1=下一交易日、窗口∩日历）
 *   - knowledge                → §11 Q10 / C-12.6.1 row.knowledge 可知性审计（缺失≠无事实）
 *
 * 铁律：
 *   - 纯模块：无 Date.now / Math.random / IO；同输入必同输出（确定性）。
 *   - 声明必须如实反映既有实现（价格 raw 未复权、announcementDate PIT 过滤等），禁止编造口径。
 *   - value 为机器可读形状（键白名单 + 值域），evidence 指向可审计字段路径。
 *   - policyId === class（本 certification 每 class 单实例；未来多实例时 policyId 加后缀区分）。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "./version";
import { RESEARCH_DATASET_PRICE_BASIS } from "./types";
import type {
  DataSnapshot,
  NormalizedResearchDatasetRequest,
} from "./types";

// ---------------------------------------------------------------------------
// Schema / 顺序
// ---------------------------------------------------------------------------

/** 策略 value schema 版本（value 形状变更时递增，防止混用新旧声明）。 */
export const RESEARCH_DATASET_POLICY_SCHEMA_VERSION = "1";

/** 9 类 policy 的权威顺序（policySet / 快照输出一律按此序，确定性）。 */
export const RESEARCH_DATASET_POLICY_ORDER = [
  "pit",
  "survivorship",
  "corporate-action",
  "adjustment",
  "industry",
  "liquidity",
  "universe-membership",
  "calendar-trading-days",
  "knowledge",
] as const;

/** policy class / policyId 判别码。 */
export type ResearchDatasetPolicyId = (typeof RESEARCH_DATASET_POLICY_ORDER)[number];

// ---------------------------------------------------------------------------
// 各类 policy 的机器可读 value 形状（value 键白名单见 policyValidate.ts）
// ---------------------------------------------------------------------------

/** PIT：逐日 PIT（asOf=tradeDate）或固定快照（asOf=请求 asOf）。 */
export interface PitPolicyValue {
  mode: "asOfPerTradeDate" | "fixed";
  asOf: string | null;
}

/** Survivorship：anti-survivorship 声明（B Master 全表含退市；成员按生命周期 PIT 决议）。 */
export interface SurvivorshipPolicyValue {
  membershipIsPointInTime: true;
  masterIncludesDelistedSecurities: true;
  delistedNotRenderedAsEligibleRows: true;
}

/** Corporate action：effective vs known 双层口径。 */
export interface CorporateActionPolicyValue {
  effectiveLayerRule: string;
  knownLayerRule: string;
  missingAnnouncementDateRule: string;
  mode: "PIT" | "FULL_KNOWLEDGE";
}

/** Adjustment：行价基准（当前 schema 只承载 raw 未复权；禁止宣称 adjusted）。 */
export interface AdjustmentPolicyValue {
  priceBasis: "raw" | "adjusted";
  priceFields: readonly string[];
  corporateActionAdjustmentIntoPrice: boolean;
}

/** Industry：归属键 + PIT 过滤。 */
export interface IndustryPolicyValue {
  codeOwnership: string;
  pointInTimeFilter: string;
  missing: string;
}

/** Liquidity：tradeDate 日级流动性事实口径。 */
export interface LiquidityPolicyValue {
  granularity: string;
  closingKnown: boolean;
  missing: string;
}

/** Universe membership：成员决议口径（STEP11 默认拒绝）。 */
export interface UniverseMembershipPolicyValue {
  resolver: string;
  membershipPerTradingDay: boolean;
  defaultOnUnknown: string;
  includeExcluded: boolean;
  sortOrder: string;
}

/** Calendar trading days：日历来源 / 窗口 / 数量。 */
export interface CalendarTradingDaysPolicyValue {
  calendarName: string;
  windowRule: string;
  tradingDayCount: number;
  tPlusOneAvailabilitySemantics: boolean;
}

/** Knowledge：可知性审计口径（缺失 ≠ 无事实）。 */
export interface KnowledgePolicyValue {
  mode: "PIT" | "FULL_KNOWLEDGE";
  asOfRequired: boolean;
  /** 与 ResearchDatasetRow.knowledge 的 8 个维度（不含 policy 本身）一致。 */
  dimensions: readonly string[];
}

/** 各 class 的 value 联合（模型层宽联合；shape 与交叉一致性由 policyValidate 保证）。 */
export type ResearchDatasetPolicyValue =
  | PitPolicyValue
  | SurvivorshipPolicyValue
  | CorporateActionPolicyValue
  | AdjustmentPolicyValue
  | IndustryPolicyValue
  | LiquidityPolicyValue
  | UniverseMembershipPolicyValue
  | CalendarTradingDaysPolicyValue
  | KnowledgePolicyValue;

/** 单条 policy 声明（机器可读、可审计）。 */
export interface ResearchDatasetPolicy {
  policyId: ResearchDatasetPolicyId;
  /** 与 policyId 相同（每 class 单实例）；保留 class 字段以对齐 §12「policy 类」表述。 */
  class: ResearchDatasetPolicyId;
  name: string;
  description: string;
  value: ResearchDatasetPolicyValue;
  /** 审计追查：指向 ResearchDatasetRow / DataSnapshot / UniverseDefinition / Request 的字段。 */
  evidence: readonly string[];
}

/** policySet = 按 RESEARCH_DATASET_POLICY_ORDER 排序的 9 条声明（确定性）。 */
export type ResearchDatasetPolicySet = readonly ResearchDatasetPolicy[];

// ---------------------------------------------------------------------------
// 静态元数据（name / description / evidence 与实例无关）
// ---------------------------------------------------------------------------

interface PolicyMeta {
  name: string;
  description: string;
  evidence: readonly string[];
}

const POLICY_META: Readonly<Record<ResearchDatasetPolicyId, PolicyMeta>> = {
  pit: {
    name: "PIT 策略（Point-in-Time）",
    description:
      "研究口径必须显式选择 asOf：逐日 PIT（每行 asOf=tradeDate，逐交易日只用当日可知信息，杜绝 look-ahead）" +
      "或固定快照（全窗口冻结于单一时点 asOf）。行内 knowledge 各维度按该 asOf 过滤。",
    evidence: ["request.asOfPerTradeDate", "request.asOf", "universeDefinition.asOfDescription", "row.asOf", "row.knowledge.policy"],
  },
  survivorship: {
    name: "幸存者偏差策略（Anti-survivorship）",
    description:
      "B Master（research_securities）全表加载、含已退市证券（不按当前存活者裁剪），逐日成员按生命周期 PIT 决议，" +
      "证券仅在其可交易期内入样，退市后不再渲染为 eligible 行——保证历史窗口内退市股不丢失、窗口外不串入。",
    evidence: [
      "dataSnapshot.domains[domain='B Master'].rowsLoaded/.securitiesCovered/.note",
      "universeDefinition.days[].members/.excludedByReason",
      "row.lifecycleVerdict",
      "row.eligible",
      "row.exclusionReason",
    ],
  },
  "corporate-action": {
    name: "公司行为策略（双层口径）",
    description:
      "已生效层 = effectiveDate<=tradeDate 的事件计数；PIT 可知层 = announcementDate<=asOf 的事件计数。" +
      "announcementDate 缺失保守视为不可知；禁止用 retrievedAt/全量视角冒充 PIT。",
    evidence: [
      "row.corporateActionsEffectiveCount",
      "row.corporateActionsKnownCount",
      "row.knowledge.corporateActions",
      "dataSnapshot.domains[domain='D CA'].rowsLoaded",
    ],
  },
  adjustment: {
    name: "复权策略（未复权 raw）",
    description:
      "行价 open/high/low/close/preClose 取自 stock_daily_prices 未复权 raw（canonical bar adjustment 恒为 'raw'），" +
      "公司行为只以事件计数/可知性提供，不折算进价格。schema 层面禁止把 raw 当 adjusted 宣称。",
    evidence: ["row.open", "row.high", "row.low", "row.close", "row.preClose", "dataSnapshot.domains[domain='A OHLCV'].note"],
  },
  industry: {
    name: "行业归属策略",
    description:
      "行业区间按 full-code ownership 过滤归属（防代码复用串扰），并按 retrievedAt<=asOf 做 PIT 过滤；" +
      "无归属/未加载/无生效代码 → industryCode/Name = null 且 knowledge.industry = UNKNOWN（不伪造）。",
    evidence: ["row.industryCode", "row.industryName", "row.knowledge.industry", "dataSnapshot.domains[domain='G Industry'].rowsLoaded"],
  },
  liquidity: {
    name: "流动性策略（日级事实）",
    description:
      "流动性为 tradeDate 的日级事实（当日收盘后可知）；turnover/marketCap/liquidityAmount/liquidityVolume 以当日行取值，" +
      "缺失 → null 且 knowledge.liquidity = UNKNOWN（不填零、不伪造）。",
    evidence: [
      "row.turnoverRate",
      "row.circulationMarketCap",
      "row.totalMarketCap",
      "row.liquidityAmount",
      "row.liquidityVolume",
      "row.knowledge.liquidity",
      "dataSnapshot.domains[domain='E Liquidity'].rowsLoaded",
    ],
  },
  "universe-membership": {
    name: "Universe 成员决议策略",
    description:
      "每交易日复用 STEP 11 resolveHistoricalUniverse（LISTING/TRADING 正向确认、SUSPENSION/DELISTING 显式阻断、" +
      "UNKNOWN 默认拒绝），PIT asOf 由请求决定；成员排序 = exchange → code → securityId。",
    evidence: [
      "universeDefinition.rule",
      "universeDefinition.asOfDescription",
      "universeDefinition.days[].members",
      "universeDefinition.days[].excludedByReason",
      "row.eligible",
      "row.exclusionReason",
    ],
  },
  "calendar-trading-days": {
    name: "交易日历策略",
    description:
      "日历由 index_daily distinct 交易日构造（research-dataset-calendar）；交易日 = 请求窗口 ∩ 日历交易日，" +
      "availability T+1 采用「下一交易日」语义（周五的 T+1 是周一）。",
    evidence: [
      "dataSnapshot.calendarName",
      "dataSnapshot.calendarFirstDate",
      "dataSnapshot.calendarLastDate",
      "dataSnapshot.tradingDays",
      "universeDefinition.days[].tradeDate",
      "request.startDate",
      "request.endDate",
    ],
  },
  knowledge: {
    name: "可知性策略（Knowledge）",
    description:
      "每个维度独立标注 KNOWN/UNKNOWN：缺失 ≠ 无事实，禁止默认填充。PIT 口径下 listing/delisting/tradability 按 " +
      "availability（T+1）过滤、industry 按 retrievedAt、CA 按 announcementDate；OHLCV/流动性/指数为 tradeDate 日级事实。",
    evidence: [
      "row.knowledge.policy",
      "row.knowledge.listing",
      "row.knowledge.delisting",
      "row.knowledge.tradability",
      "row.knowledge.industry",
      "row.knowledge.liquidity",
      "row.knowledge.price",
      "row.knowledge.corporateActions",
      "row.knowledge.marketState",
    ],
  },
};

/** knowledge 维度清单（与 row.knowledge 一致，不含 policy）。 */
export const RESEARCH_DATASET_KNOWLEDGE_DIMENSIONS: readonly string[] = [
  "listing",
  "delisting",
  "tradability",
  "industry",
  "liquidity",
  "price",
  "corporateActions",
  "marketState",
];

/** 行价格字段清单（adjustment policy 的 priceFields 权威值）。 */
export const RESEARCH_DATASET_PRICE_FIELDS: readonly string[] = [
  "open",
  "high",
  "low",
  "close",
  "preClose",
];

// ---------------------------------------------------------------------------
// 期望 value 派生（与实例语义同源；validator 以 canonical 相等性校验声明）
// ---------------------------------------------------------------------------

function derivePitPolicyValue(request: NormalizedResearchDatasetRequest): PitPolicyValue {
  return request.asOfPerTradeDate
    ? { mode: "asOfPerTradeDate", asOf: null }
    : { mode: "fixed", asOf: request.asOf };
}

function deriveSurvivorshipPolicyValue(): SurvivorshipPolicyValue {
  return {
    membershipIsPointInTime: true,
    masterIncludesDelistedSecurities: true,
    delistedNotRenderedAsEligibleRows: true,
  };
}

function deriveCorporateActionPolicyValue(): CorporateActionPolicyValue {
  return {
    effectiveLayerRule: "effectiveDate<=tradeDate",
    knownLayerRule: "announcementDate<=asOf",
    missingAnnouncementDateRule: "conservativelyUnknown",
    mode: "PIT",
  };
}

function deriveAdjustmentPolicyValue(): AdjustmentPolicyValue {
  return {
    priceBasis: RESEARCH_DATASET_PRICE_BASIS,
    priceFields: RESEARCH_DATASET_PRICE_FIELDS,
    corporateActionAdjustmentIntoPrice: false,
  };
}

function deriveIndustryPolicyValue(): IndustryPolicyValue {
  return {
    codeOwnership: "fullCodeOwnershipFiltered",
    pointInTimeFilter: "retrievedAt<=asOf",
    missing: "nullAndKnowledgeUNKNOWN",
  };
}

function deriveLiquidityPolicyValue(): LiquidityPolicyValue {
  return {
    granularity: "tradeDateDailyFacts",
    closingKnown: true,
    missing: "nullAndKnowledgeUNKNOWN",
  };
}

function deriveUniverseMembershipPolicyValue(): UniverseMembershipPolicyValue {
  return {
    resolver: "STEP11-resolveHistoricalUniverse",
    membershipPerTradingDay: true,
    defaultOnUnknown: "reject",
    includeExcluded: true,
    sortOrder: "exchange->code->securityId",
  };
}

function deriveCalendarTradingDaysPolicyValue(dataSnapshot: DataSnapshot): CalendarTradingDaysPolicyValue {
  return {
    calendarName: dataSnapshot.calendarName,
    windowRule: "calendarTradingDaysWithinRequestWindow",
    tradingDayCount: dataSnapshot.tradingDays,
    tPlusOneAvailabilitySemantics: true,
  };
}

function deriveKnowledgePolicyValue(): KnowledgePolicyValue {
  return {
    mode: "PIT",
    asOfRequired: true,
    dimensions: RESEARCH_DATASET_KNOWLEDGE_DIMENSIONS,
  };
}

/**
 * 某 class 的「期望 value」：由请求/快照派生的权威口径。
 * 供 derivePolicySet 装配与 policyValidate 以 canonical 相等性核对声明是否被篡改。
 * 纯函数、确定性。
 */
export function deriveExpectedPolicyValue(
  policyId: ResearchDatasetPolicyId,
  request: NormalizedResearchDatasetRequest,
  dataSnapshot: DataSnapshot,
): ResearchDatasetPolicyValue {
  switch (policyId) {
    case "pit":
      return derivePitPolicyValue(request);
    case "survivorship":
      return deriveSurvivorshipPolicyValue();
    case "corporate-action":
      return deriveCorporateActionPolicyValue();
    case "adjustment":
      return deriveAdjustmentPolicyValue();
    case "industry":
      return deriveIndustryPolicyValue();
    case "liquidity":
      return deriveLiquidityPolicyValue();
    case "universe-membership":
      return deriveUniverseMembershipPolicyValue();
    case "calendar-trading-days":
      return deriveCalendarTradingDaysPolicyValue(dataSnapshot);
    case "knowledge":
      return deriveKnowledgePolicyValue();
  }
}

/**
 * 由规范化请求 + data_snapshot 派生完整 policySet（9 条，按 POLICY_ORDER）。
 * 纯函数、确定性；builder 在产物中携带，consistency validator 据此核对。
 */
export function derivePolicySet(
  request: NormalizedResearchDatasetRequest,
  dataSnapshot: DataSnapshot,
): ResearchDatasetPolicySet {
  return RESEARCH_DATASET_POLICY_ORDER.map((policyId) => {
    const meta = POLICY_META[policyId];
    return {
      policyId,
      class: policyId,
      name: meta.name,
      description: meta.description,
      value: deriveExpectedPolicyValue(policyId, request, dataSnapshot),
      evidence: meta.evidence,
    } as const;
  });
}

/** policySet → policyId 索引（供校验/消费方查询）。 */
export function indexPolicyById(
  policies: ResearchDatasetPolicySet,
): ReadonlyMap<ResearchDatasetPolicyId, ResearchDatasetPolicy> {
  return new Map(policies.map((policy) => [policy.policyId, policy]));
}

/**
 * policySet 内容指纹（canonical JSON + SHA-256 前 16 hex）。
 * 同输入必同指纹；内容变则指纹必变。不含任何瞬时字段。
 */
export function computePolicySetFingerprint(policies: ResearchDatasetPolicySet): string {
  const digest = createHash("sha256").update(canonicalStringify(policies), "utf8").digest("hex");
  return digest.slice(0, 16);
}
