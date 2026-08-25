/** 将识别结果中附带统计数量的题材名称还原为可聚合的题材名。 */
export function normalizeSectorName(sector: string | null | undefined, fallback = "其他") {
  const normalized = sector?.trim().replace(/\s*[*＊]\s*\d+\s*$/, "").trim();
  return normalized || fallback;
}

type StockNameRecord = {
  stockCode: string;
  stockName: string;
  limitUpDate: string;
  limitUpTime?: string | null;
};

/**
 * 同一代码的历史识别结果可能出现 OCR 名称漂移。
 * 对分析输出统一采用该代码最近交易日的非空名称，但不改写数据库原始记录。
 */
export function buildLatestStockNameMap(records: StockNameRecord[]) {
  const latestByCode = new Map<string, StockNameRecord>();
  for (const record of records) {
    if (!record.stockCode || !record.stockName.trim()) continue;
    const existing = latestByCode.get(record.stockCode);
    if (!existing
      || record.limitUpDate > existing.limitUpDate
      || (record.limitUpDate === existing.limitUpDate
        && (record.limitUpTime ?? "99:99:99") < (existing.limitUpTime ?? "99:99:99"))) {
      latestByCode.set(record.stockCode, record);
    }
  }
  return new Map(Array.from(latestByCode, ([stockCode, record]) => [stockCode, record.stockName.trim()]));
}
