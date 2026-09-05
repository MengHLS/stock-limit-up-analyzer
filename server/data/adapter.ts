/**
 * STEP 5 — Data Adapter / Normalizer。
 *
 * 统一数据边界：外部数据源（Tushare daily / 数据库 stock_daily_prices 行 / CSV）必须先经
 * 本层归一化为 CanonicalMarketBar，Strategy / Feature / Backtest Core 不允许直接解释
 * 外部数据源字段。
 *
 * 来源行统一形状（兼容 TushareDailyPrice 数字行与 DB varchar 行）：
 *   { stockCode, tradeDate, openPrice, closePrice, highPrice?, lowPrice?, amount?, volume?, preClosePrice? }
 * 其中数值字段可能是 number 或字符串（DB varchar），非法数值经 parseNumericPrice 得 null，
 * 不静默填零（数据质量由 validation 层报告）。
 */

import type { MarketBar } from "../engine/domain";
import { parseNumericPrice } from "./validation";
import type { CanonicalMarketBar } from "./types";

/** 外部日线价格行的统一形状（结构与 db 行 / Tushare 数字行兼容）。 */
export interface RawDailyPriceRow {
  stockCode: string;
  tradeDate: string;
  openPrice?: string | number | null;
  closePrice?: string | number | null;
  highPrice?: string | number | null;
  lowPrice?: string | number | null;
  amount?: string | number | null;
  volume?: string | number | null;
  preClosePrice?: string | number | null;
}

/** 将外部行归一化为 canonical bar（数值一律 parse，非法 → null；不做静默修复）。 */
export function toCanonicalBar(row: RawDailyPriceRow): CanonicalMarketBar {
  return {
    symbol: row.stockCode,
    timestamp: row.tradeDate,
    open: parseNumericPrice(row.openPrice),
    high: parseNumericPrice(row.highPrice),
    low: parseNumericPrice(row.lowPrice),
    close: parseNumericPrice(row.closePrice),
    preClose: parseNumericPrice(row.preClosePrice),
    volume: parseNumericPrice(row.volume),
    amount: parseNumericPrice(row.amount),
    turnoverRate: null, // 交易所 turnover_rate 原始字段不存在于本项目数据源；禁止伪造
    adjustment: "raw",
  };
}

/**
 * 将 canonical bar 降级为 Backtest Core 的 MarketBar（成交/回测路径）。
 * 单位一致：price 元/股、amount 千元。canonical 独有字段（volume/turnoverRate/
 * adjustment）在 Core 层不存在，按 Core 契约丢弃（不携带）。
 */
export function toEngineMarketBar(bar: CanonicalMarketBar): MarketBar {
  return {
    date: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    prevClose: bar.preClose,
    amount: bar.amount,
  };
}
