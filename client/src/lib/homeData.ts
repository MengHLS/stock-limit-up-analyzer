export type DailyCount = {
  date: string;
  count: number;
};

export function buildAdjacentRecordsByDate<T>(
  selectedDate: string | null,
  selectedRecords: readonly T[],
  previousDate: string | null,
  previousRecords: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const map = new Map<string, readonly T[]>();
  if (selectedDate) map.set(selectedDate, selectedRecords);
  if (previousDate) map.set(previousDate, previousRecords);
  return map;
}

export function summarizeDailyCounts(stats: readonly DailyCount[]) {
  const counts = stats.map((stat) => Number(stat.count)).filter((count) => count > 0);
  const total = counts.reduce((sum, count) => sum + count, 0);
  return {
    total,
    average: counts.length ? Math.round((total / counts.length) * 10) / 10 : 0,
    days: counts.length,
  };
}


export type SectorRecord = {
  sector?: string | null;
};

export type SectorCount = {
  sector: string;
  count: number;
};

export function summarizeSectorStats(records: readonly SectorRecord[]): SectorCount[] {
  const sectorCounts = new Map<string, number>();
  records.forEach((record) => {
    const sector = record.sector?.trim() || "其他";
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
  });

  return Array.from(sectorCounts.entries())
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => {
      if (a.sector === "其他") return 1;
      if (b.sector === "其他") return -1;
      return b.count - a.count;
    });
}


export type WatchStatus = "none" | "normal" | "important";

export type WatchlistItem = {
  stockCode: string;
  watchType: Exclude<WatchStatus, "none">;
};

export function buildWatchStatusMap(
  records: readonly { stockCode: string }[],
  watchlist: readonly WatchlistItem[],
): Map<string, WatchStatus> {
  const watchedMap = new Map(watchlist.map((item) => [item.stockCode, item.watchType] as const));
  return new Map(records.map((record) => [record.stockCode, watchedMap.get(record.stockCode) ?? "none"]));
}

export function setWatchStatus(
  statusMap: ReadonlyMap<string, WatchStatus>,
  stockCode: string,
  status: WatchStatus,
): Map<string, WatchStatus> {
  const next = new Map(statusMap);
  next.set(stockCode, status);
  return next;
}


export function getLatestDateString(dates: readonly string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((latest, date) => (date > latest ? date : latest));
}
