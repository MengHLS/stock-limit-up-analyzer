/**
 * STEP 7.3 — Provider Adapter。
 *
 * 业务层（BackfillScheduler）只依赖 provider-neutral 接口 `MarketDataProvider` /
 * `TradingCalendarProvider`，禁止直接调用 Tushare daily 等 provider-specific 端点。
 * Tushare 实现把既有 tushare 客户端（server/tushare.ts）返回的原始行转换为
 * `RawDailyBar`（显式携带 volumeUnit/amountUnit），不在此层做 canonical 单位换算。
 */

import { createHash } from "node:crypto";
import type {
  MarketDataProvider,
  ProviderDailyResult,
  RawDailyBar,
  TradingCalendarDay,
  TradingCalendarProvider,
} from "./types";
import { fetchTushareDailyPricesByDate, type TushareDailyPrice } from "../tushare";

const TUSHARE_SCHEMA_VERSION = "daily-v1";
const TUSHARE_ENDPOINT = "tushare:api/daily";

/** 从既有 tushare 客户端原始行构造 provider-neutral RawDailyBar（保留原始单位）。 */
export function tusharePriceToRawBar(row: TushareDailyPrice): RawDailyBar {
  return {
    securityCode: row.stockCode,
    tradeDate: row.tradeDate,
    open: row.openPrice,
    high: row.highPrice,
    low: row.lowPrice,
    close: row.closePrice,
    preClose: row.preClosePrice,
    volume: row.volume,
    amount: row.amount,
    volumeUnit: "hands",
    amountUnit: "thousand-cny",
  };
}

/** 计算 RAW 响应内容指纹（SHA-256，稳定字段序）。 */
export function computeRawHash(rows: RawDailyBar[]): string | null {
  if (rows.length === 0) return null;
  const payload = rows
    .map((row) =>
      [
        row.securityCode,
        row.tradeDate,
        row.open,
        row.high,
        row.low,
        row.close,
        row.preClose,
        row.volume,
        row.amount,
        row.volumeUnit,
        row.amountUnit,
      ].join(","),
    )
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

/** 可注入的 daily fetch 形状（便于测试 mock，绕过真实网络）。 */
export type TushareDailyFetcher = (tradeDate: string) => Promise<TushareDailyPrice[]>;

/**
 * Tushare 全市场日线 provider 实现。
 * 生产环境默认复用 `fetchTushareDailyPricesByDate`（含既有重试 + 限频语义）；
 * 测试可注入 `fetcher` 以完全隔离网络。
 */
export class TushareMarketDataProvider implements MarketDataProvider {
  readonly name = "tushare";
  private readonly fetcher: TushareDailyFetcher;

  constructor(fetcher: TushareDailyFetcher = fetchTushareDailyPricesByDate) {
    this.fetcher = fetcher;
  }

  async fetchDailyByTradeDate(tradeDate: string): Promise<ProviderDailyResult> {
    const retrievedAt = new Date().toISOString();
    const rows = (await this.fetcher(tradeDate)).map(tusharePriceToRawBar);
    return {
      provider: this.name,
      endpoint: TUSHARE_ENDPOINT,
      tradeDate,
      retrievedAt,
      schemaVersion: TUSHARE_SCHEMA_VERSION,
      rows,
      rawHash: computeRawHash(rows),
      success: true,
    };
  }
}

/** 可注入的交易日历 fetch 形状。 */
export type TradeCalendarFetcher = (startDate: string, endDate: string) => Promise<TradingCalendarDay[]>;

/**
 * 基于 Tushare trade_cal 的交易日历 provider。
 * 生产实现见 `server/backfill/tradingCalendar.ts`；此处仅提供接口实现骨架，
 * 测试可注入 mock calendar。
 */
export class TushareTradingCalendarProvider implements TradingCalendarProvider {
  readonly name = "tushare";
  private readonly fetcher: TradeCalendarFetcher;

  constructor(fetcher: TradeCalendarFetcher) {
    this.fetcher = fetcher;
  }

  async fetchTradingCalendar(startDate: string, endDate: string): Promise<TradingCalendarDay[]> {
    return this.fetcher(startDate, endDate);
  }
}
