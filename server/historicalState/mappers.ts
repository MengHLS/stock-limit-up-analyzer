/**
 * STEP 12.5 — Historical State Reconstruction：DB 行 → 领域对象纯映射。
 *
 * 只做「确定性、无 IO、可单测」的行映射（与 server/backtest/dbBarStore.ts 的
 * stockDailyPriceRowToBar 同一范式）：把 research_securities / *_identifier_history /
 * *_status_history / industry_assignments / liquidity_daily / corporate_actions /
 * index_daily / index_master 的 DB 行转换为下层 STEP 的 canonical 领域对象。
 *
 * 数值列口径（禁止在本层擅自换算）：
 *   - 价格/成交量/成交额以 varchar 存储（历史迁移遗留）→ parseNumber 解析，非法值 → null；
 *   - corporate_actions 的现金/比例字段为 varchar → 同规则；
 *   - 行业/流动性/指数数值列为 double → 直接透传，null 保持 null。
 *
 * 时间列：Date → ISO 8601 字符串（toIso）；可空时间列映射为 null，禁止填零/伪造。
 */

import type {
  adjustmentFactors as adjustmentFactorsTable,
  corporateActions as corporateActionsTable,
  indexDaily as indexDailyTable,
  indexMaster as indexMasterTable,
  industryAssignments as industryAssignmentsTable,
  liquidityDaily as liquidityDailyTable,
  researchSecurities as researchSecuritiesTable,
  researchSecurityIdentifierHistory as researchSecurityIdentifierHistoryTable,
  researchSecurityStatusHistory as researchSecurityStatusHistoryTable,
} from "../../drizzle/schema";
import type { CorporateAction } from "../corporateActions/types";
import type { SecurityIdentifier, Security } from "../security/types";
import type { SecurityStatusInterval } from "../securityStatus/types";
import type {
  IndexDailyBar,
  IndexMasterEntry,
  IndustryAssignment,
  LiquidityDaily,
} from "../marketData/types";

type ResearchSecurityRow = typeof researchSecuritiesTable.$inferSelect;
type IdentifierRow = typeof researchSecurityIdentifierHistoryTable.$inferSelect;
type StatusRow = typeof researchSecurityStatusHistoryTable.$inferSelect;
type IndustryRow = typeof industryAssignmentsTable.$inferSelect;
type LiquidityRow = typeof liquidityDailyTable.$inferSelect;
type CorporateActionRow = typeof corporateActionsTable.$inferSelect;
type IndexDailyRow = typeof indexDailyTable.$inferSelect;
type IndexMasterRow = typeof indexMasterTable.$inferSelect;
type AdjustmentFactorRow = typeof adjustmentFactorsTable.$inferSelect;

/** 解析 varchar / 任意数值形态为 number | null；空串与非法值 → null（禁止静默填零）。 */
function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Date/字符串 → ISO 8601；null/非法 → null（可空时间列）。 */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// ---------------------------------------------------------------------------
// STEP 7.4 Security Master / Identifier
// ---------------------------------------------------------------------------

/** research_securities 行 → Security（字段同名，直接透传）。 */
export function researchSecurityRowToSecurity(row: ResearchSecurityRow): Security {
  return {
    securityId: row.securityId,
    securityType: row.securityType,
    exchange: row.exchange,
    currency: row.currency,
    country: row.country,
    status: row.status,
    listedDate: row.listedDate,
    delistedDate: row.delistedDate,
  };
}

/** research_security_identifier_history 行 → SecurityIdentifier（code = 6 位数字，无后缀）。 */
export function identifierRowToSecurityIdentifier(row: IdentifierRow): SecurityIdentifier {
  return {
    securityId: row.securityId,
    exchange: row.exchange,
    code: row.securityCode,
    identifierType: row.identifierType,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    source: row.source,
  };
}

// ---------------------------------------------------------------------------
// STEP 7.5 Historical Status
// ---------------------------------------------------------------------------

/** research_security_status_history 行 → SecurityStatusInterval。 */
export function statusRowToInterval(row: StatusRow): SecurityStatusInterval {
  return {
    securityId: row.securityId,
    statusType: row.statusType,
    statusValue: row.statusValue,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    source: row.source,
    retrievedAt: toIso(row.retrievedAt),
    confidence: row.confidence,
    availability: row.availability,
  };
}

// ---------------------------------------------------------------------------
// STEP 7.6 Industry / Liquidity / Index
// ---------------------------------------------------------------------------

/**
 * industry_assignments 行 → IndustryAssignment。
 * 领域键 securityId = 完整代码（securityCode 列）：该域以自然键 code 为键，
 * securityId 列是可空软引用（多为 null），禁止把 null 软引用冒充身份。
 */
export function industryRowToAssignment(row: IndustryRow): IndustryAssignment {
  return {
    securityId: row.securityCode,
    industryCode: row.industryCode,
    industryName: row.industryName,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    source: row.source,
    retrievedAt: toIso(row.retrievedAt) ?? row.retrievedAt.toISOString(),
  };
}

/** liquidity_daily 行 → LiquidityDaily（数值列 double 直接透传；securityId = 完整代码）。 */
export function liquidityRowToDaily(row: LiquidityRow): LiquidityDaily {
  return {
    securityId: row.securityCode,
    tradeDate: row.tradeDate,
    turnoverRate: row.turnoverRate,
    circulationMarketCap: row.circulationMarketCap,
    totalMarketCap: row.totalMarketCap,
    amount: row.amount,
    volume: row.volume,
    source: row.source,
  };
}

/** index_daily 行 → IndexDailyBar。 */
export function indexDailyRowToBar(row: IndexDailyRow): IndexDailyBar {
  return {
    indexCode: row.indexCode,
    tradeDate: row.tradeDate,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    amount: row.amount,
    volume: row.volume,
    source: row.source,
  };
}

/** index_master 行 → IndexMasterEntry。 */
export function indexMasterRowToEntry(row: IndexMasterRow): IndexMasterEntry {
  return {
    indexCode: row.indexCode,
    indexName: row.indexName,
    provider: row.provider,
    providerCode: row.providerCode,
    firstDate: row.firstDate,
    lastDate: row.lastDate,
    source: row.source,
    retrievedAt: toIso(row.retrievedAt) ?? row.retrievedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// STEP 7.7 Corporate Actions
// ---------------------------------------------------------------------------

/**
 * corporate_actions 行 → CorporateAction。
 * 现金/比例字段为 varchar → parseNumber；announcementDate/recordDate 缺失保持 null
 * （禁止假设 announcementDate === effectiveDate）。
 */
export function corporateActionRowToAction(row: CorporateActionRow): CorporateAction {
  return {
    securityId: row.securityId,
    securityCode: row.securityCode,
    actionType: row.actionType,
    effectiveDate: row.effectiveDate,
    recordDate: row.recordDate,
    announcementDate: row.announcementDate,
    cashAmount: parseNumber(row.cashAmount),
    bonusRatio: parseNumber(row.bonusRatio),
    transferRatio: parseNumber(row.transferRatio),
    rightsRatio: parseNumber(row.rightsRatio),
    rightsPrice: parseNumber(row.rightsPrice),
    splitRatio: parseNumber(row.splitRatio),
    source: row.source,
    retrievedAt: toIso(row.retrievedAt) ?? row.retrievedAt.toISOString(),
    description: row.description,
  };
}

/** adjustment_factors 行 → 数值化因子结构（供上层复权派生层消费；仅做类型收敛）。 */
export function adjustmentFactorRowToFactor(row: AdjustmentFactorRow): {
  securityCode: string;
  effectiveDate: string;
  foreFactor: number | null;
  backFactor: number | null;
  source: string;
  retrievedAt: string;
} {
  return {
    securityCode: row.securityCode,
    effectiveDate: row.effectiveDate,
    foreFactor: parseNumber(row.foreFactor),
    backFactor: parseNumber(row.backFactor),
    source: row.source,
    retrievedAt: toIso(row.retrievedAt) ?? row.retrievedAt.toISOString(),
  };
}
