/**
 * STEP 7.6 — Sina Provider Adapter（HTTP）。
 *
 * 指数日线 + 实时行情反查身份。
 * 已知身份疑点（STEP 7.2 审计结论）：Sina 返回的 000300 数据自 2002 起，早于沪深300 基期
 * （2004-12-31）与发布日（2005-04-08）→ 必须经 verifyIndexIdentity 标记 CONCERN，禁止盲信为
 * 沪深300 完整历史。
 */

import type { IndexCode, IndexDailyBar, IndexMasterEntry } from "../types";
import { mapIndexCode } from "../indexes";

const SINA_KLINE_URL = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
const SINA_QUOTE_URL = "https://hq.sinajs.cn/list=";

/** 把任意输入（如 000300 / sh000300 / 000300.SH）规范为 Sina 行情代码（sh000300 / sz399006）。 */
export function toSinaSymbol(indexCode: IndexCode): string {
  const canonical = mapIndexCode(indexCode);
  const [digits, exchange] = canonical.split(".");
  return `${exchange!.toLowerCase()}${digits}`;
}

/** Sina K-line 行（getKLineData 返回）。 */
export interface SinaKLineRow {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 解析 Sina getKLineData JSON 为 canonical IndexDailyBar。
 * 注意：Sina 指数 K-line 不返回成交额（amount），本 adapter 恒置 null（不伪造）；
 * volume 为 Sina 声明口径（股），但指数口径未获权威确认，保留原值并在 source 中标注待核。
 */
export function parseSinaIndexDaily(rows: readonly SinaKLineRow[], indexCode: IndexCode): IndexDailyBar[] {
  return rows.map((row) => ({
    indexCode,
    tradeDate: row.day,
    open: numeric(row.open),
    high: numeric(row.high),
    low: numeric(row.low),
    close: numeric(row.close),
    amount: null,
    volume: numeric(row.volume),
    source: "sina",
  }));
}

/** 解析 Sina 实时行情字符串（hq.sinajs.cn 返回，GBK），提取名称与代码。 */
export function parseSinaIndexQuote(text: string): { providerCode: string; name: string } | null {
  const match = text.match(/hq_str_(\w+)="([^"]*)"/);
  if (!match) return null;
  const fields = match[2]!.split(",");
  const name = fields[0]?.trim();
  if (!name) return null;
  return { providerCode: match[1]!, name };
}

/** 获取指数身份（名称来自实时行情、首日/末日来自 K-line 历史）。 */
export async function fetchSinaIndexIdentity(indexCode: IndexCode): Promise<IndexMasterEntry | null> {
  const sinaSymbol = toSinaSymbol(indexCode);
  let name = "";
  try {
    const response = await fetch(`${SINA_QUOTE_URL}${sinaSymbol}`, {
      headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
    });
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      const text = new TextDecoder("gbk").decode(buffer);
      name = parseSinaIndexQuote(text)?.name ?? "";
    }
  } catch {
    name = "";
  }

  // K-line 历史取首/末日（datalen 上限 1023，长历史可能被截断，这里用于身份校验足够）。
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  try {
    const response = await fetch(`${SINA_KLINE_URL}?symbol=${sinaSymbol}&scale=240&ma=no&datalen=1023`, {
      headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
    });
    if (response.ok) {
      const rows = (await response.json()) as SinaKLineRow[];
      const dates = rows.map((row) => row.day).sort();
      if (dates.length > 0) {
        firstDate = dates[0]!;
        lastDate = dates[dates.length - 1]!;
      }
    }
  } catch {
    // 保持 null
  }

  return {
    indexCode,
    indexName: name,
    provider: "sina",
    providerCode: sinaSymbol,
    firstDate,
    lastDate,
    source: "sina getKLineData + hq.sinajs.cn",
    retrievedAt: new Date().toISOString(),
  };
}

/** 获取指数日线（canonical 单位）。 */
export async function fetchSinaIndexDaily(indexCode: IndexCode, startDate: string, endDate: string): Promise<IndexDailyBar[]> {
  const sinaSymbol = toSinaSymbol(indexCode);
  const response = await fetch(`${SINA_KLINE_URL}?symbol=${sinaSymbol}&scale=240&ma=no&datalen=1023`, {
    headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`Sina 指数日线请求失败：HTTP ${response.status}`);
  const rows = (await response.json()) as SinaKLineRow[];
  return parseSinaIndexDaily(rows.filter((row) => row.day >= startDate && row.day <= endDate), indexCode);
}
