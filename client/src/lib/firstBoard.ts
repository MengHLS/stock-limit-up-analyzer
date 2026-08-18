export type FirstBoardRecord = {
  stockCode: string;
  limitUpDate: string;
};

/** 返回自然日前一天的 YYYY-MM-DD 日期字符串。 */
export function getPreviousCalendarDate(dateString: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  date.setDate(date.getDate() - 1);
  const previousYear = date.getFullYear();
  const previousMonth = String(date.getMonth() + 1).padStart(2, "0");
  const previousDay = String(date.getDate()).padStart(2, "0");
  return `${previousYear}-${previousMonth}-${previousDay}`;
}

/**
 * 当日首板：选定日期涨停，且自然日前一天没有涨停记录。
 * 不依赖 boardCount，前一天没有数据时，当日记录全部视为首板候选。
 */
export function filterFirstBoardRecords<T extends FirstBoardRecord>(
  recordsByDate: ReadonlyMap<string, readonly T[]>,
  selectedDate: string,
): T[] {
  const previousDate = getPreviousCalendarDate(selectedDate);
  if (!previousDate) return [];

  const previousStockCodes = new Set(
    (recordsByDate.get(previousDate) ?? []).map((record) => record.stockCode),
  );

  return (recordsByDate.get(selectedDate) ?? []).filter(
    (record) => !previousStockCodes.has(record.stockCode),
  );
}

export default filterFirstBoardRecords;
