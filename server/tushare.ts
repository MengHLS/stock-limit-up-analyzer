export type TushareDailyPrice = {
  stockCode: string;
  tradeDate: string;
  openPrice: number;
  closePrice: number;
  preClosePrice: number;
};

type TusharePayload = {
  code?: number;
  msg?: string;
  data?: {
    fields?: string[];
    items?: unknown[][];
  };
};

const TUSHARE_API_URL = "https://api.tushare.pro";
const RETRY_DELAYS_MS = [1_000, 2_500, 5_000];

function toTushareDate(date: string) {
  return date.replaceAll("-", "");
}

function toIsoDate(date: string) {
  if (!/^\d{8}$/.test(date)) throw new Error(`Tushare 返回了无效交易日期：${date}`);
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function requiredNumber(value: unknown, field: string, stockCode: string, tradeDate: string) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`Tushare 日线字段无效：${stockCode} ${tradeDate} 的 ${field}`);
  }
  return numberValue;
}

/** 将 Tushare daily 接口返回值转换为项目统一的日线价格结构。 */
export function parseTushareDailyPrices(payload: TusharePayload): TushareDailyPrice[] {
  if (payload.code !== 0) {
    throw new Error(`Tushare daily 请求失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
  }

  const fields = payload.data?.fields ?? [];
  const items = payload.data?.items ?? [];
  const indexByField = new Map(fields.map((field, index) => [field, index]));
  const requiredFields = ["ts_code", "trade_date", "open", "close", "pre_close"];
  for (const field of requiredFields) {
    if (!indexByField.has(field)) throw new Error(`Tushare daily 返回缺少字段：${field}`);
  }

  return items.map((item) => {
    const stockCode = String(item[indexByField.get("ts_code")!]);
    const tradeDate = toIsoDate(String(item[indexByField.get("trade_date")!]));
    return {
      stockCode,
      tradeDate,
      openPrice: requiredNumber(item[indexByField.get("open")!], "open", stockCode, tradeDate),
      closePrice: requiredNumber(item[indexByField.get("close")!], "close", stockCode, tradeDate),
      preClosePrice: requiredNumber(item[indexByField.get("pre_close")!], "pre_close", stockCode, tradeDate),
    };
  });
}

/** 以交易日批量获取全市场日线，再由同步服务筛选项目所需股票。 */
export async function fetchTushareDailyPricesByDate(tradeDate: string): Promise<TushareDailyPrice[]> {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("未配置 TUSHARE_TOKEN，无法同步日线行情");

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(TUSHARE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_name: "daily",
          token,
          params: { trade_date: toTushareDate(tradeDate) },
          fields: "ts_code,trade_date,open,close,pre_close",
        }),
      });
      if (!response.ok) throw new Error(`Tushare daily 网络请求失败：HTTP ${response.status}`);
      return parseTushareDailyPrices(await response.json() as TusharePayload);
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tushare daily 网络请求失败");
}
