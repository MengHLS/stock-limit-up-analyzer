/**
 * STEP 12.5 — PIT / 反泄漏抽样审计：DB 抽样器与独立事实拉取。
 *
 * 全部经 drizzle 会话读取（与 C-12.5.1 加载器同一条 DATE→string 解码路径），行→领域对象
 * 复用 ./mappers（确定性映射，非泄漏语义），保证与「被测对象」看到的是同一批真实行。
 *
 * 抽样桶设计（覆盖反泄漏边界，确定性种子可复现）：
 *   RANDOM_ACTIVE   正常上市窗口内的随机交易日（常规一致性）；
 *   DELISTED_AFTER  退市日后的首个交易日（survivorship：不得仍可交易）；
 *   PRE_LISTING     上市日前最后一个交易日（survivorship：不得提前可交易）；
 *   CODE_REUSE      代码复用边界（同一 code 不同区间不同主体，防跨主体数据串扰）；
 *   衍生桶（由 RANDOM_ACTIVE 样本的独立事实二次派生）：
 *   CA_EFFECTIVE_BOUNDARY   公司行为生效日附近（已生效 + announcementDate PIT）；
 *   INDUSTRY_PIT_BOUNDARY   行业行区间内 retrievedAt 之后的交易日（未来回填不得泄漏）。
 */

import { and, eq, inArray } from "drizzle-orm";
import { stockDailyPriceRowToBar } from "../../backtest/dbBarStore";
import type { CanonicalMarketBar } from "../../data/types";
import type { CorporateAction } from "../../corporateActions/types";
import { getDb } from "../../db";
import type { IndustryAssignment, LiquidityDaily } from "../../marketData/types";
import { detectCodeReuse } from "../../security/identifierHistory";
import { addDays } from "../../security/dates";
import {
  buildTradingCalendar,
  type TradingCalendar,
} from "../../security/tradingCalendar";
import { getSecurityStatusIntervals } from "../../securityStatus/persistence";
import type { SecurityIdentifier } from "../../security/types";
import {
  corporateActions,
  indexDaily,
  industryAssignments,
  liquidityDaily,
  researchSecurities,
  researchSecurityIdentifierHistory,
  stockDailyPrices,
} from "../../../drizzle/schema";
import {
  corporateActionRowToAction,
  identifierRowToSecurityIdentifier,
  indexDailyRowToBar,
  industryRowToAssignment,
  liquidityRowToDaily,
  researchSecurityRowToSecurity,
} from "../mappers";
import { naiveActiveCode, naiveActiveIdentifierAt } from "./oracle";
import type { PitAuditBucket, PitAuditFacts, PitAuditSample } from "./types";

/** Drizzle MySQL 客户端类型（由 getDb 派生；DB 不可用时为 null）。 */
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** 抽样默认数（RANDOM_ACTIVE），各边界桶另有上限。 */
export const DEFAULT_AUDIT_BUDGET = 24;

/** 确定性伪随机（mulberry32）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由 index_daily 真实交易日构建日历（DB 不可用 / 无数据 → null）。 */
export async function loadAuditTradingCalendar(): Promise<TradingCalendar | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .selectDistinct({ tradeDate: indexDaily.tradeDate })
    .from(indexDaily)
    .orderBy(indexDaily.tradeDate);
  if (rows.length === 0) return null;
  return buildTradingCalendar(rows.map((row) => row.tradeDate), "index-daily-calendar");
}

function sampleId(bucket: PitAuditBucket, securityId: string, tradeDate: string): string {
  return `${bucket}:${securityId}:${tradeDate}`;
}

/** 该 security 在 [from,to] 上是否存在可交易抽样交易日；存在则返回其中一个。 */
function pickTradingDayInWindow(
  calendar: TradingCalendar,
  rng: () => number,
  from: string,
  to: string,
): string | null {
  const days = calendar.tradingDaysBetween(from, to);
  if (days.length === 0) return null;
  return days[Math.floor(rng() * days.length)]!;
}

/** 抽样窗口上界：effectiveTo / delistedDate 的较早者；均开放用日历末日。 */
function latestBound(
  identifiers: readonly SecurityIdentifier[],
  delistedDate: string | null,
  calendarEnd: string,
): string {
  const effectiveTo = identifiers.some((id) => id.effectiveTo === null)
    ? null
    : identifiers.map((id) => id.effectiveTo!).sort().reverse()[0] ?? null;
  const candidates = [effectiveTo, delistedDate].filter((d): d is string => d !== null);
  if (candidates.length === 0) return calendarEnd;
  return candidates.reduce((min, d) => (d < min ? d : min), calendarEnd);
}

/**
 * 基础样本：RANDOM_ACTIVE + DELISTED_AFTER + PRE_LISTING + CODE_REUSE。
 * 只读 securities + identifier_history 全量（规模 ~5.5k，可接受）。
 */
export async function buildBaseSamples(
  calendar: TradingCalendar,
  options: { seed?: number; budget?: number } = {},
): Promise<PitAuditSample[]> {
  const db = await getDb();
  if (!db) return [];
  const seed = options.seed ?? 20260906;
  const budget = options.budget ?? DEFAULT_AUDIT_BUDGET;
  const rng = mulberry32(seed);
  const samples: PitAuditSample[] = [];
  const calendarStart = calendar.tradingDays[0]!;
  const calendarEnd = calendar.tradingDays[calendar.tradingDays.length - 1]!;

  const securityRows = await db.select().from(researchSecurities);
  const identifierRows = await db
    .select()
    .from(researchSecurityIdentifierHistory)
    .orderBy(researchSecurityIdentifierHistory.securityId, researchSecurityIdentifierHistory.effectiveFrom);
  const identifiersBySecurity = new Map<string, SecurityIdentifier[]>();
  const allIdentifiers: SecurityIdentifier[] = [];
  for (const row of identifierRows) {
    const mapped = identifierRowToSecurityIdentifier(row);
    allIdentifiers.push(mapped);
    const list = identifiersBySecurity.get(mapped.securityId) ?? [];
    list.push(mapped);
    identifiersBySecurity.set(mapped.securityId, list);
  }

  const activePool: Array<{ securityId: string; earliest: string; latest: string }> = [];
  const delistedPool: Array<{ securityId: string; delistedDate: string }> = [];
  const preListPool: Array<{ securityId: string; listedDate: string }> = [];

  for (const row of securityRows) {
    const securityId = row.securityId;
    const identifiers = identifiersBySecurity.get(securityId) ?? [];
    if (identifiers.length === 0) continue;
    const earliest = identifiers.map((id) => id.effectiveFrom).sort()[0]!;
    const latest = latestBound(identifiers, row.delistedDate, calendarEnd);
    if (latest < earliest) continue;
    const lo = row.listedDate !== null && row.listedDate > earliest ? row.listedDate : earliest;
    if (row.delistedDate !== null && row.delistedDate < calendarEnd) {
      delistedPool.push({ securityId, delistedDate: row.delistedDate });
    }
    if (row.listedDate !== null && row.listedDate > calendarStart) {
      preListPool.push({ securityId, listedDate: row.listedDate });
    }
    if (row.delistedDate === null || row.delistedDate >= lo) {
      activePool.push({ securityId, earliest: lo, latest });
    }
  }

  // RANDOM_ACTIVE：确定性挑选 budget 个（不同 security 优先，遍历尝试）。
  const activeBudget = Math.max(4, budget);
  const attempts = activeBudget * 20;
  const used = new Set<string>();
  for (let i = 0; i < attempts && samples.filter((s) => s.bucket === "RANDOM_ACTIVE").length < activeBudget; i += 1) {
    const pool = activePool[Math.floor(rng() * activePool.length)];
    if (!pool) break;
    if (used.has(pool.securityId)) continue;
    const day = pickTradingDayInWindow(calendar, rng, pool.earliest, pool.latest);
    if (day === null) continue;
    used.add(pool.securityId);
    samples.push({ sampleId: sampleId("RANDOM_ACTIVE", pool.securityId, day), bucket: "RANDOM_ACTIVE", securityId: pool.securityId, tradeDate: day, asOf: day });
  }

  // DELISTED_AFTER：退市日后首个交易日（≤8 个）。
  for (const item of delistedPool) {
    if (samples.filter((s) => s.bucket === "DELISTED_AFTER").length >= 8) break;
    const day = calendar.nextTradingDay(item.delistedDate);
    if (day === null || day > calendarEnd) continue;
    samples.push({ sampleId: sampleId("DELISTED_AFTER", item.securityId, day), bucket: "DELISTED_AFTER", securityId: item.securityId, tradeDate: day, asOf: day });
  }

  // PRE_LISTING：上市日前最后一个交易日（≤8 个）。
  for (const item of preListPool) {
    if (samples.filter((s) => s.bucket === "PRE_LISTING").length >= 8) break;
    const day = calendar.previousTradingDay(item.listedDate);
    if (day === null || day < calendarStart) continue;
    samples.push({ sampleId: sampleId("PRE_LISTING", item.securityId, day), bucket: "PRE_LISTING", securityId: item.securityId, tradeDate: day, asOf: day });
  }

  // CODE_REUSE：跨主体代码复用的边界样本（第二主体的首个交易日，≤8 个）。
  const reuseRecords = detectCodeReuse(allIdentifiers).filter((record) => record.intervals.length >= 2);
  for (const record of reuseRecords) {
    if (samples.filter((s) => s.bucket === "CODE_REUSE").length >= 8) break;
    const intervals = record.intervals.slice().sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let i = 1; i < intervals.length; i += 1) {
      const owner = intervals[i]!;
      const day = calendar.firstTradingDayOnOrAfter(owner.effectiveFrom);
      if (day === null || day > calendarEnd || day < calendarStart) continue;
      if (owner.effectiveTo !== null && day > owner.effectiveTo) continue;
      samples.push({ sampleId: sampleId("CODE_REUSE", owner.securityId, day), bucket: "CODE_REUSE", securityId: owner.securityId, tradeDate: day, asOf: day });
      break;
    }
  }

  // 去重（同一 bucket+security+date 仅保留一次）。
  const dedupe = new Map<string, PitAuditSample>();
  for (const sample of samples) dedupe.set(sample.sampleId, sample);
  return Array.from(dedupe.values());
}

/**
 * 从某 RANDOM_ACTIVE 样本的独立事实二次派生边界样本：
 *   - CA_EFFECTIVE_BOUNDARY：首个 effectiveDate 在日历窗口内事件的前一交易日（保证已生效边界）；
 *   - INDUSTRY_PIT_BOUNDARY：存在 retrievedAt 晚于区间的行时，取 retrievedAt 前最后一个交易日。
 */
export function deriveBoundarySamples(
  facts: PitAuditFacts,
  calendar: TradingCalendar,
): PitAuditSample[] {
  const derived: PitAuditSample[] = [];
  const calendarStart = calendar.tradingDays[0]!;
  const calendarEnd = calendar.tradingDays[calendar.tradingDays.length - 1]!;

  // CA：取 earliest effectiveDate 事件，在其生效日或之前最近交易日采样（事件已生效或当日生效）。
  const sortedCa = facts.caRows
    .filter((a) => a.effectiveDate >= calendarStart && a.effectiveDate <= calendarEnd)
    .slice()
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  if (sortedCa.length > 0) {
    const event = sortedCa[0]!;
    const day = calendar.lastTradingDayOnOrBefore(event.effectiveDate);
    if (day !== null && day >= calendarStart) {
      derived.push({
        sampleId: sampleId("CA_EFFECTIVE_BOUNDARY", facts.security.securityId, day),
        bucket: "CA_EFFECTIVE_BOUNDARY",
        securityId: facts.security.securityId,
        tradeDate: day,
        asOf: day,
      });
    }
  }

  // 行业：找 retrievedAt > effectiveFrom 的行，取 retrievedAt 前一天之内、区间起点之后的最后一个交易日。
  for (const row of facts.industryRows.slice().sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
    const retrievedDate = row.retrievedAt.slice(0, 10);
    if (retrievedDate <= row.effectiveFrom) continue;
    const windowEnd = addDays(retrievedDate, -1);
    const lo = calendar.firstTradingDayOnOrAfter(row.effectiveFrom);
    const hi = calendar.lastTradingDayOnOrBefore(windowEnd);
    if (lo === null || hi === null || hi < lo) continue;
    if (naiveActiveIdentifierAt(facts.identifiers, facts.security.securityId, hi) === null) continue;
    derived.push({
      sampleId: sampleId("INDUSTRY_PIT_BOUNDARY", facts.security.securityId, hi),
      bucket: "INDUSTRY_PIT_BOUNDARY",
      securityId: facts.security.securityId,
      tradeDate: hi,
      asOf: hi,
    });
    break;
  }

  return derived;
}

/** 拉取某样本的独立事实（DB 不可用 / 无此 security → null）。 */
export async function fetchFacts(
  sample: PitAuditSample,
  coreIndexCodes: string[],
): Promise<PitAuditFacts | null> {
  const db = await getDb();
  if (!db) return null;

  const [securityRow] = await db
    .select()
    .from(researchSecurities)
    .where(eq(researchSecurities.securityId, sample.securityId));
  if (!securityRow) return null;
  const security = researchSecurityRowToSecurity(securityRow);

  const identifierRows = await db
    .select()
    .from(researchSecurityIdentifierHistory)
    .where(eq(researchSecurityIdentifierHistory.securityId, sample.securityId))
    .orderBy(researchSecurityIdentifierHistory.effectiveFrom);
  const identifiers = identifierRows.map(identifierRowToSecurityIdentifier);
  const statusIntervals = await getSecurityStatusIntervals(sample.securityId);

  const code = naiveActiveCode(identifiers, sample.securityId, sample.tradeDate);
  const industryRows: IndustryAssignment[] = [];
  const caRows: CorporateAction[] = [];
  let priceBar: CanonicalMarketBar | null = null;
  let liquidity: LiquidityDaily | null = null;

  if (code !== null) {
    industryRows.push(...(await queryIndustryRows(db, code)).map(industryRowToAssignment));
    caRows.push(...(await queryCaRows(db, code)).map(corporateActionRowToAction));
    priceBar = await queryPriceRow(db, code, sample.tradeDate);
    liquidity = await queryLiquidityRow(db, code, sample.tradeDate);
  }

  const indexBars = (await queryIndexDaily(db, sample.tradeDate, coreIndexCodes)).map(indexDailyRowToBar);

  return {
    security,
    identifiers,
    statusIntervals,
    industryRows,
    caRows,
    priceBar,
    liquidity,
    indexBars,
    coreIndexCodes,
  };
}

/** 读某完整代码全部行业行（含未来 retrievedAt / 历史区间，供 PIT 边界判定）。 */
async function queryIndustryRows(db: Db, code: string) {
  return db.select().from(industryAssignments).where(eq(industryAssignments.securityCode, code));
}

/** 读某完整代码全部公司行为行（不限日期，供 announcementDate PIT 判定）。 */
async function queryCaRows(db: Db, code: string) {
  return db.select().from(corporateActions).where(eq(corporateActions.securityCode, code));
}

/** 读 (code, tradeDate) 价格行（与加载层 queryPriceBar 同口径）。 */
async function queryPriceRow(db: Db, code: string, tradeDate: string): Promise<CanonicalMarketBar | null> {
  const rows = await db
    .select({
      stockCode: stockDailyPrices.stockCode,
      tradeDate: stockDailyPrices.tradeDate,
      openPrice: stockDailyPrices.openPrice,
      closePrice: stockDailyPrices.closePrice,
      highPrice: stockDailyPrices.highPrice,
      lowPrice: stockDailyPrices.lowPrice,
      preClosePrice: stockDailyPrices.preClosePrice,
      volume: stockDailyPrices.volume,
      amount: stockDailyPrices.amount,
    })
    .from(stockDailyPrices)
    .where(and(eq(stockDailyPrices.stockCode, code), eq(stockDailyPrices.tradeDate, tradeDate)))
    .limit(1);
  return rows[0] === undefined ? null : stockDailyPriceRowToBar(rows[0]);
}

/** 读 (code, tradeDate) 流动性行（与加载层同口径）。 */
async function queryLiquidityRow(db: Db, code: string, tradeDate: string) {
  const rows = await db
    .select()
    .from(liquidityDaily)
    .where(and(eq(liquidityDaily.securityCode, code), eq(liquidityDaily.tradeDate, tradeDate)))
    .limit(1);
  return rows[0] === undefined ? null : liquidityRowToDaily(rows[0]);
}

/** 读 tradeDate 核心指数日线。 */
async function queryIndexDaily(db: Db, tradeDate: string, coreIndexCodes: string[]) {
  if (coreIndexCodes.length === 0) return [];
  return db
    .select()
    .from(indexDaily)
    .where(and(eq(indexDaily.tradeDate, tradeDate), inArray(indexDaily.indexCode, coreIndexCodes)));
}
