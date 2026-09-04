export type TushareDailyPrice = {
  stockCode: string;
  tradeDate: string;
  openPrice: number;
  closePrice: number;
  lowPrice: number;
  amount: number;
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

// trade_cal 接口限频 1 次/分钟，改用一只每个交易日都有成交的参考股（平安银行）的日线反推交易日历。
const TRADING_CALENDAR_REFERENCE_STOCK = "000001.SZ";
// 交易日历内存缓存：避免刷新/同步等短时间内重复请求外部接口。
const TRADING_CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;
const tradingCalendarCache = new Map<string, { expiresAt: number; dates: string[] }>();

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

function nonNegativeNumber(value: unknown, field: string, stockCode: string, tradeDate: string) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error(`Tushare 日线字段无效：${stockCode} ${tradeDate} 的 ${field}`);
  }
  return numberValue;
}

/** 判断错误是否为 Tushare 接口频率限制（限频）。 */
export function isTushareRateLimitError(error: unknown): boolean {
  return error instanceof Error && /频率超限|限频|rate\s?limit|每分钟最多访问|访问频率|过于频繁/i.test(error.message);
}

/** 将 Tushare daily 接口返回值转换为项目统一的日线价格结构。 */
export function parseTushareDailyPrices(payload: TusharePayload): TushareDailyPrice[] {
  if (payload.code !== 0) {
    throw new Error(`Tushare daily 请求失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
  }

  const fields = payload.data?.fields ?? [];
  const items = payload.data?.items ?? [];
  const indexByField = new Map(fields.map((field, index) => [field, index]));
  const requiredFields = ["ts_code", "trade_date", "open", "close", "low", "amount", "pre_close"];
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
      lowPrice: requiredNumber(item[indexByField.get("low")!], "low", stockCode, tradeDate),
      amount: nonNegativeNumber(item[indexByField.get("amount")!], "amount", stockCode, tradeDate),
      preClosePrice: requiredNumber(item[indexByField.get("pre_close")!], "pre_close", stockCode, tradeDate),
    };
  });
}

/** 以交易日批量获取全市场日线，再由同步服务筛选项目所需股票。 */
export async function fetchTushareDailyPricesByDate(tradeDate: string): Promise<TushareDailyPrice[]> {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("未配置 TUSHARE_TOKEN，无法同步日线行情");

  const requestDailyPrices = async () => {
    const response = await fetch(TUSHARE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_name: "daily",
        token,
        params: { trade_date: toTushareDate(tradeDate) },
        fields: "ts_code,trade_date,open,close,low,amount,pre_close",
      }),
    });
    if (!response.ok) throw new Error(`Tushare daily 网络请求失败：HTTP ${response.status}`);
    return parseTushareDailyPrices(await response.json() as TusharePayload);
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await requestDailyPrices();
    } catch (error) {
      lastError = error;
      // 限频错误：快速重试无意义，等待 60 秒后仅再试一次，仍失败则抛出明确错误供上层中止同步。
      if (isTushareRateLimitError(error)) {
        console.warn(`[Tushare] daily 触发频率限制，等待 60 秒后重试一次：${tradeDate}`);
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        try {
          return await requestDailyPrices();
        } catch (finalError) {
          throw new Error(`Tushare daily 频率限制，请稍后重试：${finalError instanceof Error ? finalError.message : String(finalError)}`);
        }
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tushare daily 网络请求失败");
}

/** 获取交易所实际开市日期，用于信号后的连续交易日覆盖，避免用自然日或涨停记录日期替代交易日历。 */
export async function fetchTushareTradingDates(startDate: string, endDate: string): Promise<string[]> {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("未配置 TUSHARE_TOKEN，无法同步交易日历");

  const cacheKey = `${startDate}|${endDate}`;
  const cached = tradingCalendarCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.dates;

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(TUSHARE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_name: "daily",
          token,
          params: {
            ts_code: TRADING_CALENDAR_REFERENCE_STOCK,
            start_date: toTushareDate(startDate),
            end_date: toTushareDate(endDate),
          },
          fields: "ts_code,trade_date",
        }),
      });
      if (!response.ok) throw new Error(`Tushare 交易日历网络请求失败：HTTP ${response.status}`);
      const payload = await response.json() as TusharePayload;
      if (payload.code !== 0) throw new Error(`Tushare 交易日历请求失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
      const fields = payload.data?.fields ?? [];
      const items = payload.data?.items ?? [];
      const dateIndex = fields.indexOf("trade_date");
      if (dateIndex < 0) throw new Error("Tushare 交易日历返回缺少 trade_date 字段");
      const dates = Array.from(new Set(items.map((item) => toIsoDate(String(item[dateIndex])))))
        .sort((left, right) => left.localeCompare(right));
      if (dates.length === 0) throw new Error("Tushare 参考股票在区间内无交易日数据");
      tradingCalendarCache.set(cacheKey, { expiresAt: Date.now() + TRADING_CALENDAR_CACHE_TTL_MS, dates });
      return dates;
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tushare 交易日历请求失败");
}
