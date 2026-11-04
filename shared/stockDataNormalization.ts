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

/**
 * 历史时点（as-of）名称映射：同一代码取其「limitUpDate <= asOfDate」中最近一条的非空名称。
 * 与 buildLatestStockNameMap 的区别：本函数是 point-in-time 安全的——不会用「未来才出现的名称」
 * （如后来变 ST）回填历史时点，杜绝「最新 ST 名 → 历史涨跌停比例 5% 回填」的未来函数。
 */
export function buildAsOfStockNameMap(records: StockNameRecord[], asOfDate: string) {
  const asOfByCode = new Map<string, StockNameRecord>();
  for (const record of records) {
    if (!record.stockCode || !record.stockName.trim()) continue;
    if (record.limitUpDate > asOfDate) continue; // 仅用 as-of 时点及以前已出现的名称
    const existing = asOfByCode.get(record.stockCode);
    if (!existing
      || record.limitUpDate > existing.limitUpDate
      || (record.limitUpDate === existing.limitUpDate
        && (record.limitUpTime ?? "99:99:99") < (existing.limitUpTime ?? "99:99:99"))) {
      asOfByCode.set(record.stockCode, record);
    }
  }
  return new Map(Array.from(asOfByCode, ([stockCode, record]) => [stockCode, record.stockName.trim()]));
}
