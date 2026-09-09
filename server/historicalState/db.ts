/**
 * STEP 12.5 — Historical State Reconstruction：DB 加载器（真实数据接线）。
 *
 * querySecurityHistoricalState(securityId, tradeDate, opts) 是 C-12.5.1 的 DB 版统一入口：
 *   从 research_securities / research_security_identifier_history /
 *   research_security_status_history（复用 securityStatus/persistence）/
 *   industry_assignments / liquidity_daily / stock_daily_prices /
 *   corporate_actions / index_daily / index_master 读取真实行，
 *   经 ./mappers 纯映射为下层 STEP 领域对象后，交给 ./reconstruct 纯函数完成 asOf(T) 重建。
 *
 * 反泄漏纪律：
 *   - 身份层键 = sec_<uuid>；code 键数据域（行业/流动性/价格/公司行为）以 tradeDate 生效的
 *     完整代码（如 600000.SH）为自然键，二者经 identifierHistory 桥接（禁止混键）。
 *   - code 归属过滤：行业（区间型）与公司行为（事件型）加载后按 isCodeOwnedBySecurityAt /
 *     isCodeIntervalOwnedBySecurity 剔除「代码复用」场景下其它证券在其它时间段的历史数据。
 *   - 无 DB（getDb()=null，测试/未配置）或 securityId 不存在 → 返回 null（不抛错、不伪造）。
 *
 * 已知边界（诚实记录，供 VALIDATED 阶段复核）：
 *   - code 键数据只按「tradeDate 生效的代码」加载。历史上发生过代码变更的证券，其早期事件
 *     挂旧代码，需 universe 级批量构建（STEP 12.6 builder）另行处理，不在本单标的入口覆盖。
 *   - retrievedAt（Date→ISO UTC）用于行业 PIT 的 retrievedAt 过滤，跨时区日内边界可能有 ±1 天
 *     偏差（与 STEP 7.6 canonical 口径一致，VALIDATED 阶段按真实库校准）。
 */

import { and, eq, inArray, lte } from "drizzle-orm";
import { stockDailyPriceRowToBar } from "../backtest/dbBarStore";
import type { CanonicalMarketBar } from "../data/types";
import {
  corporateActions,
  indexDaily,
  indexMaster,
  industryAssignments,
  liquidityDaily,
  researchSecurities,
  researchSecurityIdentifierHistory,
  stockDailyPrices,
} from "../../drizzle/schema";
import type { CorporateAction } from "../corporateActions/types";
import type { IndustryAssignment, LiquidityDaily } from "../marketData/types";
import { getDb } from "../db";
import { isValidIsoDate } from "../security/dates";
import { splitCanonicalCode } from "../security/code";
import { getSecurityStatusIntervals } from "../securityStatus/persistence";
import {
  isCodeIntervalOwnedBySecurity,
  isCodeOwnedBySecurityAt,
  resolveActiveIdentifierAt,
  resolveSecurityHistoricalState,
} from "./reconstruct";
import {
  corporateActionRowToAction,
  identifierRowToSecurityIdentifier,
  indexDailyRowToBar,
  indexMasterRowToEntry,
  industryRowToAssignment,
  liquidityRowToDaily,
  researchSecurityRowToSecurity,
} from "./mappers";
import type { HistoricalStateOptions, SecurityHistoricalState } from "./types";

/** DB 加载层专属选项（reconstruct 层不含 coreIndexCodes）。 */
export interface HistoricalStateDbOptions extends HistoricalStateOptions {
  /**
   * 市场状态快照选用的核心指数（默认 4 大基准）。传空数组 = 不加载市场状态。
   * 实际输出仅包含 index_daily 中当日有数据的指数。
   */
  coreIndexCodes?: string[];
}

/** 默认核心指数：上证指数 / 沪深300 / 深证成指 / 创业板指。 */
export const DEFAULT_CORE_INDEX_CODES = ["000001.SH", "000300.SH", "399001.SZ", "399006.SZ"] as const;

/** 只校验 YYYY-MM-DD 形态；语义校验（如行业重叠）由纯函数层负责。 */
function assertIsoDate(value: string, label: string): void {
  if (!isValidIsoDate(value)) throw new Error(`${label} 非法日期（需 YYYY-MM-DD）：${value}`);
}

/**
 * 单标的 asOf(T) 历史状态查询（真实 DB）。
 *
 * @param securityId 永久身份（sec_<uuid>）。
 * @param tradeDate 被查询的交易日（YYYY-MM-DD）。
 * @param options.asOf point-in-time 信息截止点；缺省 null = 全知视角（仅供调试/审计，研究必须显式传）。
 * @param options.calendar 交易日历（可选；不传则不启用 T+1 交易日语义与 isTradingDay 判定）。
 * @param options.coreIndexCodes 市场状态核心指数集合。
 * @returns 完整历史状态；DB 不可用或 securityId 不存在 → null。
 */
export async function querySecurityHistoricalState(
  securityId: string,
  tradeDate: string,
  options: HistoricalStateDbOptions = {},
): Promise<SecurityHistoricalState | null> {
  assertIsoDate(tradeDate, "tradeDate");
  const asOf = options.asOf ?? null;
  if (asOf !== null) assertIsoDate(asOf, "asOf");
  const coreIndexCodes: string[] = options.coreIndexCodes ?? [...DEFAULT_CORE_INDEX_CODES];

  const db = await getDb();
  if (!db) return null;

  // 1. Security Master（身份）。
  const [securityRow] = await db
    .select()
    .from(researchSecurities)
    .where(eq(researchSecurities.securityId, securityId));
  if (!securityRow) return null;
  const security = researchSecurityRowToSecurity(securityRow);

  // 2. Identifier History（tradeDate 生效代码 + code 归属过滤所需区间）。
  const identifierRows = await db
    .select()
    .from(researchSecurityIdentifierHistory)
    .where(eq(researchSecurityIdentifierHistory.securityId, securityId))
    .orderBy(researchSecurityIdentifierHistory.effectiveFrom);
  const identifiers = identifierRows.map(identifierRowToSecurityIdentifier);

  // 3. Historical Status（复用 STEP 7.5 persistence 的统一读取）。
  const statusIntervals = await getSecurityStatusIntervals(securityId);

  // 4. code 键数据域：仅在 tradeDate 有生效代码时加载。
  const active = resolveActiveIdentifierAt(identifiers, securityId, tradeDate);
  let industry: Awaited<ReturnType<typeof queryIndustryAssignments>> = [];
  let corporateActionsList: Awaited<ReturnType<typeof queryCorporateActions>> = [];
  let priceBar: CanonicalMarketBar | null = null;
  let liquidity = null as Awaited<ReturnType<typeof queryLiquidity>>;

  if (active !== null) {
    const code = `${active.code}.${active.exchange}`;
    const { digits, exchange } = splitCanonicalCode(code);

    industry = (await queryIndustryAssignments(code)).filter((assignment) =>
      isCodeIntervalOwnedBySecurity(
        identifiers,
        securityId,
        digits,
        exchange,
        assignment.effectiveFrom,
        assignment.effectiveTo,
      ),
    );

    corporateActionsList = (await queryCorporateActions(code, tradeDate)).filter((action) =>
      isCodeOwnedBySecurityAt(identifiers, securityId, digits, exchange, action.effectiveDate),
    );

    priceBar = await queryPriceBar(code, tradeDate);
    liquidity = await queryLiquidity(code, tradeDate);
  }

  // 5. 市场状态（核心指数日线 + 身份）。
  const indexBars = coreIndexCodes.length === 0 ? [] : await queryIndexDaily(tradeDate, coreIndexCodes);
  const indexMasterEntries = coreIndexCodes.length === 0 ? [] : await queryIndexMaster(coreIndexCodes);

  return resolveSecurityHistoricalState(
    {
      security,
      identifiers,
      statusIntervals,
      industryAssignments: industry,
      priceBar,
      liquidity,
      corporateActions: corporateActionsList,
      indexBars,
      indexMaster: indexMasterEntries,
    },
    tradeDate,
    { asOf },
  );
}

/** 读取某完整代码的行业区间行（DB 不可用 → []）。 */
async function queryIndustryAssignments(code: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(industryAssignments)
    .where(eq(industryAssignments.securityCode, code));
  return rows.map(industryRowToAssignment);
}

/** 读取某完整代码在 effectiveDate <= tradeDate 的公司行为行（DB 不可用 → []）。 */
async function queryCorporateActions(code: string, tradeDate: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(corporateActions)
    .where(
      and(
        eq(corporateActions.securityCode, code),
        lte(corporateActions.effectiveDate, tradeDate),
      ),
    );
  return rows.map(corporateActionRowToAction);
}

/** 读取某完整代码 + tradeDate 的未复权日线 bar；无记录 → null。 */
async function queryPriceBar(code: string, tradeDate: string): Promise<CanonicalMarketBar | null> {
  const db = await getDb();
  if (!db) return null;
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
    .where(
      and(
        eq(stockDailyPrices.stockCode, code),
        eq(stockDailyPrices.tradeDate, tradeDate),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : stockDailyPriceRowToBar(row);
}

/** 读取某完整代码 + tradeDate 的流动性日线；无记录 → null。 */
async function queryLiquidity(code: string, tradeDate: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(liquidityDaily)
    .where(
      and(
        eq(liquidityDaily.securityCode, code),
        eq(liquidityDaily.tradeDate, tradeDate),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : liquidityRowToDaily(row);
}

/** 读取 tradeDate 各核心指数的日线（DB 不可用 → []）。 */
async function queryIndexDaily(tradeDate: string, coreIndexCodes: string[]) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(indexDaily)
    .where(and(eq(indexDaily.tradeDate, tradeDate), inArray(indexDaily.indexCode, coreIndexCodes)));
  return rows.map(indexDailyRowToBar);
}

/** 读取核心指数身份（DB 不可用 → []）。 */
async function queryIndexMaster(coreIndexCodes: string[]) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(indexMaster)
    .where(inArray(indexMaster.indexCode, coreIndexCodes));
  return rows.map(indexMasterRowToEntry);
}