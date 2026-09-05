/**
 * STEP 7.6 — BaoStock Provider Adapter（Python bridge）。
 *
 * 指数日线 + 个股流动性（turn/amount/volume）。
 * 单位：BaoStock volume=股、amount=元、turn=%（本 adapter 已归一：股→手 ×0.01、元→千元 ×0.001）。
 * BaoStock 不提供市值（流通/总市值）→ 显式 UNAVAILABLE。
 */

import type { IndexCode, IndexDailyBar, IndexMasterEntry, LiquidityDaily, SecurityId } from "../types";
import { normalizeLiquidity } from "../liquidity";
import type { LiquidityProvider } from "./types";
import { runPythonScript } from "./pythonBridge";

/** 转 BaoStock 代码（sh.000300 / sz.399006 / sh.600000 / sz.000001）。 */
export function toBaostockCode(securityId: SecurityId): string {
  const [digits, exchange] = securityId.split(".");
  if (!digits || !exchange) throw new Error(`无法转 BaoStock 代码：${securityId}`);
  return `${exchange.toLowerCase()}.${digits}`;
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface BaostockIndexRow {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  amount: string;
}

/** 解析 BaoStock 指数日线为 canonical（volume 股→手、amount 元→千元）。 */
export function parseBaostockIndexDaily(rows: readonly BaostockIndexRow[], indexCode: IndexCode): IndexDailyBar[] {
  return rows.map((row) => ({
    indexCode,
    tradeDate: row.date,
    open: num(row.open),
    high: num(row.high),
    low: num(row.low),
    close: num(row.close),
    amount: num(row.amount) === null ? null : num(row.amount)! * 0.001,
    volume: num(row.volume) === null ? null : num(row.volume)! * 0.01,
    source: "baostock",
  }));
}

export interface BaostockStockRow {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  amount: string;
  turn: string;
  tradestatus: string;
}

/** 解析 BaoStock 个股日线为 canonical LiquidityDaily（turn %、amount 元→千元、volume 股→手）。 */
export function parseBaostockStockDaily(rows: readonly BaostockStockRow[], securityId: SecurityId): LiquidityDaily[] {
  return rows.map((row) =>
    normalizeLiquidity("baostock-daily", {
      securityId,
      tradeDate: row.date,
      turnoverRate: num(row.turn),
      amount: num(row.amount),
      volume: num(row.volume),
    }).bar,
  );
}

/** 获取指数身份（首/末日来自指数日线；BaoStock 不返回名称，名称留空由参考表补充）。 */
export async function fetchBaostockIndexIdentity(indexCode: IndexCode): Promise<IndexMasterEntry | null> {
  const code = toBaostockCode(indexCode);
  const startDate = "1990-01-01";
  const endDate = new Date().toISOString().slice(0, 10);
  const stdout = await runPythonScript("baostock_probe.py", ["index_daily", code, startDate, endDate], "MARKETDATA_PYTHON");
  const rows = JSON.parse(stdout) as BaostockIndexRow[];
  const dates = rows.map((row) => row.date).sort();
  if (dates.length === 0) return null;
  return {
    indexCode,
    indexName: "",
    provider: "baostock",
    providerCode: code,
    firstDate: dates[0]!,
    lastDate: dates[dates.length - 1]!,
    source: "baostock query_history_k_data_plus (index)",
    retrievedAt: new Date().toISOString(),
  };
}

/** 获取指数日线（canonical 单位）。 */
export async function fetchBaostockIndexDaily(indexCode: IndexCode, startDate: string, endDate: string): Promise<IndexDailyBar[]> {
  const code = toBaostockCode(indexCode);
  const stdout = await runPythonScript("baostock_probe.py", ["index_daily", code, startDate, endDate], "MARKETDATA_PYTHON");
  return parseBaostockIndexDaily(JSON.parse(stdout) as BaostockIndexRow[], indexCode);
}

/** 获取单只证券流动性（canonical 单位）。 */
export async function fetchBaostockStockDaily(securityId: SecurityId, startDate: string, endDate: string): Promise<LiquidityDaily[]> {
  const code = toBaostockCode(securityId);
  const stdout = await runPythonScript("baostock_probe.py", ["stock_daily", code, startDate, endDate], "MARKETDATA_PYTHON");
  return parseBaostockStockDaily(JSON.parse(stdout) as BaostockStockRow[], securityId);
}

/** BaoStock 流动性 adapter（turn/amount/volume 可提供，市值不可提供）。 */
export const baostockLiquidityProvider: LiquidityProvider = {
  name: "baostock-daily",
  capability: {
    turnoverRate: "AVAILABLE",
    circulationMarketCap: "UNAVAILABLE",
    totalMarketCap: "UNAVAILABLE",
    amount: "AVAILABLE",
    volume: "AVAILABLE",
  },
  fetchDaily: fetchBaostockStockDaily,
};
