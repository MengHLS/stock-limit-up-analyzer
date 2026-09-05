/**
 * STEP 11-FINAL-FIX — DB 版 HistoricalBarStore。
 *
 * 把 STEP 8 研究级回测引擎的数据边界接到生产库 `stock_daily_prices`（未复权 raw 日线），
 * 使 `HistoricalBarStore` 不再只有内存 fixture 实现，可直接对真实历史行情跑引擎。
 *
 * 语义契约（与 server/backtest/dataSource.ts 完全一致）：
 *   - corporateActionMode 恒为 "RAW"：stock_daily_prices 只存未复权价（schema 明确「未复权」），
 *     复权价是 corporateActions 的 Derived Layer，禁止在此把 raw 当作 adjusted。
 *   - 引擎按「日期推进」消费：barsForDate(date) 只拉当日一个 chunk；seriesFor(securityId)
 *     只按需拉单标的完整序列。本实现永不 `select().from(stockDailyPrices)` 全表物化。
 *   - 无 DB（getDb() 为 null，测试/未配置环境）时优雅返回空，不抛错。
 *
 * 字段映射（单位对齐 server/data/types.ts 的 canonical 口径，禁止自行换算）：
 *   stock_daily_prices.stockCode   → CanonicalMarketBar.symbol
 *   stock_daily_prices.tradeDate   → timestamp
 *   openPrice/closePrice/highPrice/lowPrice/preClosePrice → open/close/high/low/preClose
 *   volume（手）→ volume；amount（千元）→ amount；turnoverRate → null（未提供，禁止伪造）
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { stockDailyPrices } from "../../drizzle/schema";
import { getDb } from "../db";
import type { CanonicalMarketBar } from "../data/types";
import type { HistoricalBarStore } from "./dataSource";
import type { CorporateActionMode, Security } from "./types";

/** 解析 varchar 存储的数值字段为 number | null（空串/非法值 → null，禁止静默填零）。 */
function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 构造 canonical bar 所需的 stock_daily_prices 字段（varchar 数值列）。 */
export interface StockDailyPriceBarFields {
  stockCode: string;
  tradeDate: string;
  openPrice: string | null;
  closePrice: string | null;
  highPrice: string | null;
  lowPrice: string | null;
  preClosePrice: string | null;
  volume: string | null;
  amount: string | null;
}

/** 单日线 bar 所需的列集合（有界选择，避免拉回 id/时间戳等无关列）。 */
const BAR_COLUMNS = {
  stockCode: stockDailyPrices.stockCode,
  tradeDate: stockDailyPrices.tradeDate,
  openPrice: stockDailyPrices.openPrice,
  closePrice: stockDailyPrices.closePrice,
  highPrice: stockDailyPrices.highPrice,
  lowPrice: stockDailyPrices.lowPrice,
  preClosePrice: stockDailyPrices.preClosePrice,
  volume: stockDailyPrices.volume,
  amount: stockDailyPrices.amount,
} as const;

/**
 * 把一条 stock_daily_prices 行规范化为 canonical bar（纯函数，供测试与映射复用）。
 * adjustment 恒为 "raw"：stock_daily_prices 是未复权价，系统禁止复权价与未复权价混用。
 */
export function stockDailyPriceRowToBar(row: StockDailyPriceBarFields): CanonicalMarketBar {
  return {
    symbol: row.stockCode,
    timestamp: row.tradeDate,
    open: parseNumber(row.openPrice),
    high: parseNumber(row.highPrice),
    low: parseNumber(row.lowPrice),
    close: parseNumber(row.closePrice),
    preClose: parseNumber(row.preClosePrice),
    volume: parseNumber(row.volume),
    amount: parseNumber(row.amount),
    turnoverRate: null,
    adjustment: "raw",
  };
}

/**
 * DB 版规范历史行情存储（STEP 8 HistoricalBarStore 的唯一生产实现）。
 * 只消费 stock_daily_prices 的未复权日线；复权/公司行为处理由上层（corporateActions）负责。
 */
export class DbBarStore implements HistoricalBarStore {
  readonly corporateActionMode: CorporateActionMode = "RAW";

  async securities(): Promise<readonly Security[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .selectDistinct({ stockCode: stockDailyPrices.stockCode })
      .from(stockDailyPrices)
      .orderBy(stockDailyPrices.stockCode);
    // 注意：本方法返回的是「数据覆盖证券集合」（Data Coverage Universe），
    // 且受 raw 数据层键约束，Security.securityId 字段当前装的是自然键 stockCode
    // （引擎域的 legacy 命名），不是 sec_<uuid>。禁止把它当作最终 Historical Universe
    // （见 docs/quant-system-contract.md §6/§7）。
    return rows.map((row) => ({ securityId: row.stockCode }));
  }

  async tradingDates(startDate: string, endDate: string): Promise<readonly string[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .selectDistinct({ tradeDate: stockDailyPrices.tradeDate })
      .from(stockDailyPrices)
      .where(
        and(
          gte(stockDailyPrices.tradeDate, startDate),
          lte(stockDailyPrices.tradeDate, endDate),
        ),
      )
      .orderBy(stockDailyPrices.tradeDate);
    return rows.map((row) => row.tradeDate);
  }

  async barsForDate(date: string): Promise<readonly CanonicalMarketBar[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select(BAR_COLUMNS)
      .from(stockDailyPrices)
      .where(eq(stockDailyPrices.tradeDate, date))
      .orderBy(stockDailyPrices.stockCode);
    return rows.map((row) => stockDailyPriceRowToBar(row));
  }

  async seriesFor(securityId: string): Promise<readonly CanonicalMarketBar[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select(BAR_COLUMNS)
      .from(stockDailyPrices)
      .where(eq(stockDailyPrices.stockCode, securityId))
      .orderBy(stockDailyPrices.tradeDate);
    return rows.map((row) => stockDailyPriceRowToBar(row));
  }
}
