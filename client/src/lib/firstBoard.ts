export type FirstBoardRecord = {
  stockCode: string;
  limitUpDate: string;
};

/** 返回选定日期之前的上一已记录交易日，而非自然日前一天。 */
export function getPreviousRecordedDate(dates: readonly string[], selectedDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return null;
  const previousDates = Array.from(new Set(dates))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date < selectedDate)
    .sort();
  return previousDates.at(-1) ?? null;
}

/**
 * 当日首板：选定日期涨停，且上一已记录交易日没有涨停记录。
 * 不依赖 boardCount；没有更早已记录交易日时，当日记录全部视为首板候选。
 */
export function filterFirstBoardRecords<T extends FirstBoardRecord>(
  recordsByDate: ReadonlyMap<string, readonly T[]>,
  selectedDate: string,
): T[] {
  const previousDate = getPreviousRecordedDate(Array.from(recordsByDate.keys()), selectedDate);

  const previousStockCodes = new Set(
    (previousDate ? (recordsByDate.get(previousDate) ?? []) : []).map((record) => record.stockCode),
  );

  return (recordsByDate.get(selectedDate) ?? []).filter(
    (record) => !previousStockCodes.has(record.stockCode),
  );
}

export default filterFirstBoardRecords;
