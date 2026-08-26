import * as XLSX from "xlsx";
import { get as httpsGet } from "node:https";
import { fetchTushareDailyPricesByDate } from "./tushare";

export type MarketFactorSnapshot = {
  date: string;
  turnoverYi: number;
  marginBalanceYi: number;
  sources: { turnover: "tushare_daily"; marginBalance: "sse_szse_public" };
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function parseNumber(value: unknown, field: string) {
  const parsed = Number(String(value ?? "").replaceAll(",", "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`市场数据字段无效：${field}`);
  return parsed;
}

export function parseMarginWorkbookYi(buffer: ArrayBuffer, expectedHeader: string, source: string) {
  const workbook = XLSX.read(Buffer.from(buffer), { type: "buffer" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error(`${source} 未返回工作表`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet]!, { header: 1, raw: true, defval: "" });
  const headers = (rows[0] ?? []).map((value) => String(value).trim());
  const index = headers.indexOf(expectedHeader);
  if (index < 0) throw new Error(`${source} 返回缺少字段：${expectedHeader}`);
  const dataRow = rows.slice(1).find((row) => String(row[index] ?? "").trim() !== "");
  if (!dataRow) throw new Error(`${source} 未返回数据行`);
  return round(parseNumber(dataRow[index], `${source}.${expectedHeader}`) / 100_000_000);
}

function fetchWorkbook(url: string, source: string, redirects = 0): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: url.includes("szse.cn") ? "https://www.szse.cn/disclosure/margin/margin/index.html" : "https://www.sse.com.cn/market/othersdata/margin/sum/",
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location && redirects < 3) {
        response.resume();
        resolve(fetchWorkbook(new URL(location, url).toString(), source, redirects + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`${source} 请求失败：HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.byteLength < 512) {
          reject(new Error(`${source} 返回文件过小`));
          return;
        }
        resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      });
    });
    request.on("error", reject);
    request.setTimeout(30_000, () => request.destroy(new Error(`${source} 请求超时`)));
  });
}

/** 两市成交额：Tushare 全市场日线中沪市与深市证券的 amount（千元）求和，换算为亿元。 */
export async function fetchTwoMarketTurnoverYi(date: string) {
  const prices = await fetchTushareDailyPricesByDate(date);
  const amountQianYuan = prices
    .filter((price) => price.stockCode.endsWith(".SH") || price.stockCode.endsWith(".SZ"))
    .reduce((sum, price) => sum + price.amount, 0);
  if (!Number.isFinite(amountQianYuan) || amountQianYuan <= 0) throw new Error(`${date} 未获得有效沪深两市成交额`);
  return round(amountQianYuan / 100_000);
}

/** 上交所公开汇总文件的本日融资融券余额，单位元，转换为亿元。 */
export async function fetchSseMarginBalanceYi(date: string) {
  const compactDate = date.replaceAll("-", "");
  const buffer = await fetchWorkbook(`https://www.sse.com.cn/market/dealingdata/overview/margin/a/rzrqjygk${compactDate}.xls`, "上交所两融汇总");
  return parseMarginWorkbookYi(buffer, "本日融资融券余额(元)", "上交所两融汇总");
}

/** 深交所公开汇总文件的融资融券余额，单位元，转换为亿元。 */
export async function fetchSzseMarginBalanceYi(date: string) {
  const buffer = await fetchWorkbook(`https://www.szse.cn/api/report/ShowReport?SHOWTYPE=xlsx&CATALOGID=1837_xxpl&txtDate=${date}&TABKEY=tab1`, "深交所两融汇总");
  return parseMarginWorkbookYi(buffer, "融资融券余额(元)", "深交所两融汇总");
}

/** 只返回来自真实可追溯来源的信号日市场数据；任一来源不可用时抛错，禁止使用占位值替代。 */
export async function fetchMarketFactorSnapshot(date: string): Promise<MarketFactorSnapshot> {
  const [turnoverYi, sseMarginBalanceYi, szseMarginBalanceYi] = await Promise.all([
    fetchTwoMarketTurnoverYi(date),
    fetchSseMarginBalanceYi(date),
    fetchSzseMarginBalanceYi(date),
  ]);
  return {
    date,
    turnoverYi,
    marginBalanceYi: round(sseMarginBalanceYi + szseMarginBalanceYi),
    sources: { turnover: "tushare_daily", marginBalance: "sse_szse_public" },
  };
}

/** market_data 历史值可能带“亿”字样；只接受正的数值部分。 */
export function parseStoredMarketYi(value: string | null | undefined) {
  const parsed = Number(String(value ?? "").replaceAll(",", "").replace("亿", "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
