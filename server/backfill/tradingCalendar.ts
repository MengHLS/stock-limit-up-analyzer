/**
 * STEP 7.3 — 交易日历。
 *
 * Backfill 禁止「从 startDate 每天 +1」；必须使用 canonical trading calendar，
 * 且明确 exchange / isOpen，只对 isOpen=true 的日期执行 daily fetch。
 * 实现基于 Tushare trade_cal（STEP 7.2 已实测可用），处理周末/节假日/异常交易日。
 */

import type { TradingCalendarDay } from "./types";

const TUSHARE_API_URL = "https://api.tushare.pro";

/** trade_cal 支持的交易所子集（A 股）。北交所 BSE 不被 trade_cal 支持，按 SSE 日历近似。 */
export type TradeCalExchange = "SSE" | "SZSE";

/** 默认查询的交易所（SSE 为主 A 股日历；SZSE 通常一致，作冗余合并）。 */
export const DEFAULT_TRADE_CAL_EXCHANGES: TradeCalExchange[] = ["SSE", "SZSE"];

function toTushareDate(date: string): string {
  return date.replaceAll("-", "");
}

function toIsoDate(date: string): string {
  if (!/^\d{8}$/.test(date)) throw new Error(`Tushare trade_cal 返回无效日期：${date}`);
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

type TradeCalPayload = {
  code?: number;
  msg?: string;
  data?: { fields?: string[]; items?: unknown[][] };
};

type TradeCalRawFetcher = (exchange: TradeCalExchange, startDate: string, endDate: string, token: string) => Promise<TradeCalPayload>;

/** 真实 HTTP 请求（可注入替换，测试不依赖网络）。 */
const httpTradeCal: TradeCalRawFetcher = async (exchange, startDate, endDate, token) => {
  const response = await fetch(TUSHARE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_name: "trade_cal",
      token,
      params: { exchange, start_date: toTushareDate(startDate), end_date: toTushareDate(endDate) },
      fields: "cal_date,is_open",
    }),
  });
  if (!response.ok) throw new Error(`Tushare trade_cal 网络请求失败：HTTP ${response.status}`);
  return (await response.json()) as TradeCalPayload;
};

/** 解析单个 trade_cal 响应为 TradingCalendarDay[]。 */
export function parseTradeCalPayload(payload: TradeCalPayload, exchange: string): TradingCalendarDay[] {
  if (payload.code !== 0) {
    throw new Error(`Tushare trade_cal 请求失败：${payload.msg ?? "未知错误"}（code=${payload.code ?? "unknown"}）`);
  }
  const fields = payload.data?.fields ?? [];
  const items = payload.data?.items ?? [];
  const calIndex = fields.indexOf("cal_date");
  const openIndex = fields.indexOf("is_open");
  if (calIndex < 0 || openIndex < 0) throw new Error("Tushare trade_cal 返回缺少 cal_date 或 is_open 字段");
  return items.map((item) => ({
    calDate: toIsoDate(String(item[calIndex])),
    exchange,
    isOpen: Number(item[openIndex]) === 1,
  }));
}

/**
 * 获取交易所开市日历（合并多交易所，去重；只保留 isOpen=true 的日期）。
 */
export async function fetchTushareTradeCalendar(
  startDate: string,
  endDate: string,
  options: { exchanges?: TradeCalExchange[]; token?: string; fetcher?: TradeCalRawFetcher } = {},
): Promise<TradingCalendarDay[]> {
  const token = options.token ?? process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("未配置 TUSHARE_TOKEN，无法获取交易日历");
  const exchanges = options.exchanges ?? DEFAULT_TRADE_CAL_EXCHANGES;
  const fetcher = options.fetcher ?? httpTradeCal;

  const openByDate = new Map<string, TradingCalendarDay>();
  for (const exchange of exchanges) {
    const payload = await fetcher(exchange, startDate, endDate, token);
    for (const day of parseTradeCalPayload(payload, exchange)) {
      if (day.isOpen && !openByDate.has(day.calDate)) {
        openByDate.set(day.calDate, day);
      }
    }
  }
  return Array.from(openByDate.values()).sort((a, b) => a.calDate.localeCompare(b.calDate));
}

/** 从交易日历中提取排序后的交易日（YYYY-MM-DD 升序）。 */
export function extractTradingDates(calendar: TradingCalendarDay[]): string[] {
  return Array.from(new Set(calendar.filter((day) => day.isOpen).map((day) => day.calDate)))
    .sort((left, right) => left.localeCompare(right));
}
