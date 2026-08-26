export interface StoredLimitUpRecord {
  stockCode: string;
  stockName: string;
  limitUpTime?: string | null;
  boardCount?: string | null;
  circulationValue?: string | null;
  turnover?: string | null;
  sector?: string | null;
  keywords?: string | null;
}

export interface UploadRefreshStock {
  stockCode: string;
  stockName: string;
  limitUpTime: string;
  boardCount: string;
  circulationValue: string;
  turnover: string;
  sector: string;
  keywords: string;
}

const textOrEmpty = (value: string | null | undefined): string => value ?? "";

/**
 * 将指定日期重新查询到的数据库记录转换为上传页的统一展示模型。
 * 不补造字段：数据库缺失值保持为空字符串，由页面显示为“-”。
 */
export function mapStoredLimitUpRecords(records: readonly StoredLimitUpRecord[]): UploadRefreshStock[] {
  return records.map((record) => ({
    stockCode: textOrEmpty(record.stockCode),
    stockName: textOrEmpty(record.stockName),
    limitUpTime: textOrEmpty(record.limitUpTime),
    boardCount: textOrEmpty(record.boardCount),
    circulationValue: textOrEmpty(record.circulationValue),
    turnover: textOrEmpty(record.turnover),
    sector: textOrEmpty(record.sector),
    keywords: textOrEmpty(record.keywords),
  }));
}
