/**
 * STEP 7.6 — Tushare Provider Adapter（HTTP）。
 *
 * 覆盖 index_daily（指数日线）与 daily_basic（流动性：换手率/流通市值/总市值）。
 *
 * 已知限制（STEP 7.2 审计结论）：
 *   - index_daily / daily_basic / stock_basic / adj_factor 均返回 40203（约 1 次/小时限频），
 *     不可用于大批量回填，只能用于定点/低频数据获取 → 覆盖报告须如实标注 CONDITIONAL GAP。
 *   - daily_basic 单位：turnover_rate %、circ_mv/total_mv 万元（本 adapter 已归一为 元）。
 */

import type { IndexCode, IndexDailyBar, IndexMasterEntry, LiquidityDaily, SecurityId } from "../types";
import { normalizeLiquidity } from "../liquidity";
import type { LiquidityProvider } from "./types";

const TUSHARE_API_URL = "https://api.tushare.pro";

export type TusharePayload = {
  code?: number;
  msg?: string;
  data?: { fields?: string[]; items?: unknown[][] };
};

function toTushareDate(date: string): string {
  return date.replaceAll("-", "");
}

function toIsoDate(date: string): string {
  if (!/^\d{8}$/.test(date)) throw new Error(`Tushare 返回无效日期：${date}`);
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

/** 判断是否为 Tushare 40203（积分/频次受限）。 */
export function isTusharePermissionLimited(error: unknown): boolean {
  return error instanceof Error && /40203|权限|积分|每分钟最多|每小时最多|最多访问|访问频率/.test(error.message);
}

function requireFields(payload: TusharePayload, required: string[]): Map<string, number> {
  if (payload.code !== 0) {
    throw new Error(`Tushare 请求失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
  }
  const fields = payload.data?.fields ?? [];
  const indexByField = new Map(fields.map((field, index) => [field, index]));
  for (const field of required) {
    if (!indexByField.has(field)) throw new Error(`Tushare 返回缺少字段：${field}`);
  }
  return indexByField;
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function postTushare(apiName: string, params: Record<string, unknown>, fields: string): Promise<TusharePayload> {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("未配置 TUSHARE_TOKEN");
  const response = await fetch(TUSHARE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
  });
  if (!response.ok) throw new Error(`Tushare ${apiName} 网络请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as TusharePayload;
  if (payload.code !== 0) {
    throw new Error(`Tushare ${apiName} 失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
  }
  return payload;
}

/**
 * 解析 index_daily 返回为 canonical IndexDailyBar。
 * index_daily 字段：ts_code, trade_date, close, open, high, low, pre_close, change, pct_chg, vol, amount。
 * 单位：price 点、amount 千元、vol 手（Tushare 口径，与 canonical 一致）。
 */
export function parseTushareIndexDaily(payload: TusharePayload, indexCode: IndexCode): IndexDailyBar[] {
  const indexByField = requireFields(payload, ["trade_date", "open", "close", "high", "low", "vol", "amount"]);
  const items = payload.data?.items ?? [];
  return items.map((item) => ({
    indexCode,
    tradeDate: toIsoDate(String(item[indexByField.get("trade_date")!])),
    open: numeric(item[indexByField.get("open")!]),
    high: numeric(item[indexByField.get("high")!]),
    low: numeric(item[indexByField.get("low")!]),
    close: numeric(item[indexByField.get("close")!]),
    amount: numeric(item[indexByField.get("amount")!]),
    volume: numeric(item[indexByField.get("vol")!]),
    source: "tushare",
  }));
}

/**
 * 解析 daily_basic 为 canonical LiquidityDaily。
 * daily_basic 字段：ts_code, trade_date, turnover_rate, circ_mv, total_mv, ...（单位：% / 万元 / 万元）。
 */
export function parseTushareDailyBasic(payload: TusharePayload): LiquidityDaily[] {
  const indexByField = requireFields(payload, ["ts_code", "trade_date", "turnover_rate", "circ_mv", "total_mv"]);
  const items = payload.data?.items ?? [];
  const result: LiquidityDaily[] = [];
  for (const item of items) {
    const securityId = String(item[indexByField.get("ts_code")!]);
    const tradeDate = toIsoDate(String(item[indexByField.get("trade_date")!]));
    const normalized = normalizeLiquidity("tushare-daily-basic", {
      securityId,
      tradeDate,
      turnoverRate: numeric(item[indexByField.get("turnover_rate")!]),
      circulationMarketCap: numeric(item[indexByField.get("circ_mv")!]),
      totalMarketCap: numeric(item[indexByField.get("total_mv")!]),
    });
    result.push(normalized.bar);
  }
  return result;
}

/** 获取单只指数的身份（名称 + 数据首日/末日），用于 identity 校验。 */
export async function fetchTushareIndexIdentity(indexCode: IndexCode): Promise<IndexMasterEntry | null> {
  const startDate = "19900101";
  const endDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const payload = await postTushare("index_daily", { ts_code: indexCode, start_date: startDate, end_date: endDate }, "ts_code,trade_date,close");
  const indexByField = requireFields(payload, ["trade_date"]);
  const dates = (payload.data?.items ?? [])
    .map((item) => toIsoDate(String(item[indexByField.get("trade_date")!])))
    .sort();
  if (dates.length === 0) return null;
  return {
    indexCode,
    indexName: "",
    provider: "tushare",
    providerCode: indexCode,
    firstDate: dates[0]!,
    lastDate: dates[dates.length - 1]!,
    source: "tushare index_daily",
    retrievedAt: new Date().toISOString(),
  };
}

/** 获取指数日线（canonical 单位）。 */
export async function fetchTushareIndexDaily(indexCode: IndexCode, startDate: string, endDate: string): Promise<IndexDailyBar[]> {
  const payload = await postTushare("index_daily", { ts_code: indexCode, start_date: toTushareDate(startDate), end_date: toTushareDate(endDate) }, "ts_code,trade_date,open,close,high,low,vol,amount");
  return parseTushareIndexDaily(payload, indexCode);
}

/** 获取单只证券的流动性（daily_basic，1/h 限频，仅适合定点低频）。 */
export async function fetchTushareDailyBasic(securityId: SecurityId, startDate: string, endDate: string): Promise<LiquidityDaily[]> {
  const payload = await postTushare("daily_basic", { ts_code: securityId, start_date: toTushareDate(startDate), end_date: toTushareDate(endDate) }, "ts_code,trade_date,turnover_rate,circ_mv,total_mv");
  return parseTushareDailyBasic(payload);
}

/** Tushare 流动性 adapter（daily_basic；amount/volume 不可提供，换手/市值可提供）。 */
export const tushareLiquidityProvider: LiquidityProvider = {
  name: "tushare-daily-basic",
  capability: {
    turnoverRate: "AVAILABLE",
    circulationMarketCap: "AVAILABLE",
    totalMarketCap: "AVAILABLE",
    amount: "UNAVAILABLE",
    volume: "UNAVAILABLE",
  },
  fetchDaily: fetchTushareDailyBasic,
};
