import type { ResearchDataset } from "../../researchDataset/types";
import { rowToCanonicalBar } from "./bars";
import { bindResearchDataset } from "./handle";
import type {
  ResearchDatasetCursor,
  ResearchDatasetCursorDay,
} from "../framework/datasetCursor";

/** 把既有全内存 ResearchDataset 适配到统一 cursor 接口，保持旧路径行为不变。 */
export function createInMemoryResearchDatasetCursor(
  dataset: ResearchDataset,
): ResearchDatasetCursor {
  const handle = bindResearchDataset(dataset);
  const rowsByDate = new Map<string, ResearchDataset["rows"][number][]>();
  for (const row of handle.rows) {
    const rows = rowsByDate.get(row.tradeDate) ?? [];
    rows.push(row);
    rowsByDate.set(row.tradeDate, rows);
  }
  const universeByDate = new Map(
    handle.universeDays.map(day => [day.tradeDate, day] as const),
  );
  const visibleBarsByDate = new Map<string, Map<string, readonly import("../../data").CanonicalMarketBar[]>>();
  const visibleRows = new Map<string, ResearchDataset["rows"][number][]>();
  for (const day of handle.universeDays) {
    if (!day.isTradingDay) continue;
    for (const row of rowsByDate.get(day.tradeDate) ?? []) {
      const rows = visibleRows.get(row.securityId) ?? [];
      rows.push(row);
      visibleRows.set(row.securityId, rows);
    }
    visibleBarsByDate.set(
      day.tradeDate,
      new Map(
        [...visibleRows.entries()].map(([securityId, rows]) => [
          securityId,
          rows.map(rowToCanonicalBar),
        ] as const),
      ),
    );
  }

  return {
    metadata: {
      datasetVersion: handle.datasetVersion,
      builderVersion: handle.builderVersion,
      rowSchemaVersion: handle.rowSchemaVersion,
      universeId: handle.universeId,
      startDate: handle.startDate,
      endDate: handle.endDate,
      rowCount: handle.rowCount,
      universeDayCount: handle.universeDayCount,
      gate: handle.gate,
    },
    tradingDates: handle.universeDays
      .filter(day => day.isTradingDay)
      .map(day => day.tradeDate),
    async getDaySlice(tradeDate: string): Promise<ResearchDatasetCursorDay> {
      const rows = rowsByDate.get(tradeDate) ?? [];
      return {
        tradeDate,
        isTradingDay: universeByDate.get(tradeDate)?.isTradingDay ?? false,
        rows,
        members: universeByDate.get(tradeDate)?.members ?? [],
        executionBars: new Map(rows.map(row => [row.securityId, rowToCanonicalBar(row)] as const)),
        visibleBars: visibleBarsByDate.get(tradeDate) ?? new Map(),
      };
    },
    async restart(): Promise<void> {},
    async close(): Promise<void> {},
  };
}
