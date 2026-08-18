export type CsvLimitUpRecord = {
  limitUpDate: string | null;
  stockCode: string | null;
  stockName: string | null;
  limitUpTime: string | null;
  boardCount: string | null;
  sector: string | null;
  circulationValue: string | null;
  turnover: string | null;
  keywords: string | null;
};

const headers = ["日期", "股票代码", "股票名称", "涨停时间", "板数", "题材", "流通值", "换手率", "关键词"];

function escapeCsvValue(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildLimitUpCsv(records: readonly CsvLimitUpRecord[]): string {
  const rows = records.map((record) =>
    [
      record.limitUpDate,
      record.stockCode,
      record.stockName,
      record.limitUpTime,
      record.boardCount,
      record.sector,
      record.circulationValue,
      record.turnover,
      record.keywords,
    ].map(escapeCsvValue).join(","),
  );

  return "\uFEFF" + [headers.join(","), ...rows].join("\n");
}
