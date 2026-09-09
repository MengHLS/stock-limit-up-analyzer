/**
 * STEP 12.6 — Research Dataset：真实 DB 批量加载器（universe 级接线）。
 *
 * 与 C-12.5.1 `querySecurityHistoricalState`（单标的逐格查询）的区别：
 *   - 本层一次性全量加载 securities/identifiers/status/industry/CA/indexMaster 到内存
 *     （静态上下文一次构建，整个窗口复用），并按 tradingDate 逐日批量拉 price/liquidity/
 *     index daily（每日期只发有限查询），供纯函数装配层逐日组装标准行；
 *   - 覆盖「更名证券早期事件挂旧代码」：industry/CA 按证券曾拥有的全部代码做
 *     code-ownership 过滤（见 assemble.buildStaticContexts），而不仅按当日生效代码。
 *
 * DB 不可用（getDb()=null，测试/未配置）时返回 null/空，不抛错、不伪造。
 *
 * 已知边界（诚实记录）：
 *   - 全表加载（status/industry/CA）在域全量后单次查询会较大；此处以「域规模尚小 + 全窗口
 *     复用」为先，DATA_READY 阶段如需优化可改为按 (securityId IN …) 或日期窗口下推（不改变语义）。
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  corporateActions,
  indexDaily,
  indexMaster,
  industryAssignments,
  liquidityDaily,
  researchSecurities,
  researchSecurityIdentifierHistory,
  researchSecurityStatusHistory,
  stockDailyPrices,
} from "../../drizzle/schema";
import { buildTradingCalendar, type TradingCalendar } from "../security/tradingCalendar";
import { stockDailyPriceRowToBar } from "../backtest/dbBarStore";
import {
  corporateActionRowToAction,
  identifierRowToSecurityIdentifier,
  indexDailyRowToBar,
  indexMasterRowToEntry,
  industryRowToAssignment,
  liquidityRowToDaily,
  researchSecurityRowToSecurity,
  statusRowToInterval,
} from "../historicalState/mappers";
import { DEFAULT_CORE_INDEX_CODES } from "../historicalState/db";
import type { CanonicalMarketBar } from "../data/types";
import type { CorporateAction } from "../corporateActions/types";
import type {
  IndustryAssignment,
  IndexDailyBar,
  IndexMasterEntry,
  LiquidityDaily,
} from "../marketData/types";
import type { Security, SecurityIdentifier } from "../security/types";
import type { SecurityStatusInterval } from "../securityStatus/types";
import type { DateFacts } from "./types";

/** 全窗口静态加载结果。 */
export interface StaticDatasetLoad {
  securities: readonly Security[];
  identifiers: readonly SecurityIdentifier[];
  statusIntervals: readonly SecurityStatusInterval[];
  industryAssignments: readonly IndustryAssignment[];
  corporateActions: readonly CorporateAction[];
  indexMaster: readonly IndexMasterEntry[];
  calendar: TradingCalendar | null;
}

/** 由 index_daily distinct 交易日构造 A 股日历（与 audit 同源）。 */
async function loadCalendarFromIndexDaily(): Promise<TradingCalendar | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .selectDistinct({ tradeDate: indexDaily.tradeDate })
    .from(indexDaily)
    .orderBy(indexDaily.tradeDate);
  if (rows.length === 0) return null;
  return buildTradingCalendar(rows.map((row) => row.tradeDate), "research-dataset-calendar");
}

/** 全量证券主数据。 */
async function loadSecurities(): Promise<Security[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(researchSecurities);
  return rows.map(researchSecurityRowToSecurity);
}

/** 全量标识符历史（按 securityId → effectiveFrom 升序，确定性）。 */
async function loadIdentifiers(): Promise<SecurityIdentifier[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(researchSecurityIdentifierHistory)
    .orderBy(
      researchSecurityIdentifierHistory.securityId,
      researchSecurityIdentifierHistory.effectiveFrom,
    );
  return rows.map(identifierRowToSecurityIdentifier);
}

/** 全量历史状态区间（行序无关；resolveSecurityStatus 内部按 securityId+effective 过滤）。 */
async function loadStatusIntervals(): Promise<SecurityStatusInterval[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(researchSecurityStatusHistory);
  return rows.map(statusRowToInterval);
}

/** 全量行业区间。 */
async function loadIndustryAssignments(): Promise<IndustryAssignment[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(industryAssignments);
  return rows.map(industryRowToAssignment);
}

/** 全量公司行为。 */
async function loadCorporateActions(): Promise<CorporateAction[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(corporateActions);
  return rows.map(corporateActionRowToAction);
}

/** 核心指数身份。 */
async function loadIndexMaster(coreIndexCodes?: string[]): Promise<IndexMasterEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const codes = coreIndexCodes && coreIndexCodes.length > 0 ? coreIndexCodes : [...DEFAULT_CORE_INDEX_CODES];
  const rows = await db.select().from(indexMaster).where(inArray(indexMaster.indexCode, codes));
  return rows.map(indexMasterRowToEntry);
}

/** 加载全部静态输入（一次调用供整个窗口复用）。 */
export async function loadResearchDatasetStatic(): Promise<StaticDatasetLoad> {
  const [securities, identifiers, statusIntervals, industry, ca, calendar] = await Promise.all([
    loadSecurities(),
    loadIdentifiers(),
    loadStatusIntervals(),
    loadIndustryAssignments(),
    loadCorporateActions(),
    loadCalendarFromIndexDaily(),
  ]);
  const indexMasterEntries = await loadIndexMaster();
  return {
    securities,
    identifiers,
    statusIntervals,
    industryAssignments: industry,
    corporateActions: ca,
    indexMaster: indexMasterEntries,
    calendar,
  };
}

/** 加载某交易日全市场价格（code → bar）。 */
async function loadPriceByDate(tradeDate: string): Promise<Map<string, CanonicalMarketBar>> {
  const db = await getDb();
  const map = new Map<string, CanonicalMarketBar>();
  if (!db) return map;
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
    .where(eq(stockDailyPrices.tradeDate, tradeDate));
  for (const row of rows) map.set(row.stockCode, stockDailyPriceRowToBar(row));
  return map;
}

/** 加载某交易日全市场流动性（code → row）。 */
async function loadLiquidityByDate(tradeDate: string): Promise<Map<string, LiquidityDaily>> {
  const db = await getDb();
  const map = new Map<string, LiquidityDaily>();
  if (!db) return map;
  const rows = await db
    .select()
    .from(liquidityDaily)
    .where(eq(liquidityDaily.tradeDate, tradeDate));
  for (const row of rows) {
    const mapped = liquidityRowToDaily(row);
    map.set(mapped.securityId, mapped);
  }
  return map;
}

/** 加载某交易日核心指数日线。 */
async function loadIndexBarsByDate(tradeDate: string, coreIndexCodes?: string[]): Promise<IndexDailyBar[]> {
  const db = await getDb();
  if (!db) return [];
  const codes = coreIndexCodes && coreIndexCodes.length > 0 ? coreIndexCodes : [...DEFAULT_CORE_INDEX_CODES];
  const rows = await db
    .select()
    .from(indexDaily)
    .where(and(eq(indexDaily.tradeDate, tradeDate), inArray(indexDaily.indexCode, codes)));
  return rows.map(indexDailyRowToBar);
}

/** 加载某交易日全部日级事实。 */
export async function loadDateFacts(tradeDate: string, coreIndexCodes?: string[]): Promise<DateFacts> {
  const [priceByCode, liquidityByCode, indexBars] = await Promise.all([
    loadPriceByDate(tradeDate),
    loadLiquidityByDate(tradeDate),
    loadIndexBarsByDate(tradeDate, coreIndexCodes),
  ]);
  return { tradeDate, priceByCode, liquidityByCode, indexBars };
}
