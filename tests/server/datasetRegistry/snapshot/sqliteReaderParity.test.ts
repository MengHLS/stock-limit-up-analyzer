import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryDatasetDataReader,
  decodeEventCursor,
  decodeOutcomeCursor,
  decodePathCursor,
  type EventCursor,
  type OutcomeCursor,
  type PathCursor,
} from "../../../../server/datasetRegistry/query";
import { SnapshotSqliteReader } from "../../../../server/datasetRegistry/snapshot/sqliteReader";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../../../../server/datasetRegistry/types";
import {
  defaultFixtureRows,
  writeSnapshotFixture,
  type SnapshotFixtureRows,
} from "./snapshotFixtures";

/**
 * 逐项对比 SQLite reader 与 InMemory reader：分页 / 批量 / 范围 / 投影 / 排序 / 版本隔离。
 *
 * InMemory reader 是「同一套 keyset 语义」的参照实现；两边必须给出完全一致的领域行。
 * 唯一差异是 prefix 行的 post-only 字段：夹具里是 `undefined`（键不存在），而 DB / SQLite
 * 映射统一落成 `null`，因此比较前把 `undefined` 归一为 `null`。
 */
function detach<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, nested) => (nested === undefined ? null : nested)));
}

describe("DatasetSnapshot SQLite reader parity", () => {
  let root: string;
  let rows: SnapshotFixtureRows;
  let sqlitePath: string;
  let snapshot: SnapshotSqliteReader;
  let memory: InMemoryDatasetDataReader;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dataset-snapshot-parity-"));
    rows = defaultFixtureRows();
    const fixture = await writeSnapshotFixture(path.join(root, "1"), rows);
    sqlitePath = fixture.sqlitePath;
    snapshot = new SnapshotSqliteReader(sqlitePath);
    memory = new InMemoryDatasetDataReader(
      rows.events,
      rows.paths,
      rows.outcomes,
      rows.prefixes,
      rows.posts,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("matches version counts for version 1 and 2", async () => {
    for (const datasetVersionId of [1, 2]) {
      await expect(snapshot.getVersionCounts(datasetVersionId)).resolves.toEqual(
        await memory.getVersionCounts(datasetVersionId),
      );
    }
    await expect(snapshot.getVersionCounts(1)).resolves.toEqual({
      eventCount: 3,
      prefixCount: 3,
      postCount: 3,
      pathCount: 5,
      outcomeCount: 4,
      rowCount: 18,
      firstDate: "2024-01-02",
      lastDate: "2024-01-03",
      horizons: [5, 10, 20],
    });
  });

  it("walks every table with limit=2 and matches ordering + version isolation", async () => {
    const eventWalk = await walk<FirstLimitPullbackEvent, EventCursor>(
      (cursor, limit) => snapshot.listEventsPage({ datasetVersionId: 1, cursor, limit }),
      decodeEventCursor,
      2,
    );
    const memoryEventWalk = await walk<FirstLimitPullbackEvent, EventCursor>(
      (cursor, limit) => memory.listEventsPage({ datasetVersionId: 1, cursor, limit }),
      decodeEventCursor,
      2,
    );
    expect(detach(eventWalk)).toEqual(detach(memoryEventWalk));
    expect(eventWalk).toHaveLength(3);
    expect(eventWalk.every((row) => row.datasetVersionId === 1)).toBe(true);

    const pathWalk = await walk<FirstLimitPullbackPath, PathCursor>(
      (cursor, limit) => snapshot.listPathsPage({ datasetVersionId: 1, cursor, limit }),
      decodePathCursor,
      2,
    );
    const memoryPathWalk = await walk<FirstLimitPullbackPath, PathCursor>(
      (cursor, limit) => memory.listPathsPage({ datasetVersionId: 1, cursor, limit }),
      decodePathCursor,
      2,
    );
    expect(detach(pathWalk)).toEqual(detach(memoryPathWalk));
    expect(pathWalk.map((row) => `${row.eventId}#${row.relativeDay}`)).toEqual([
      "000001.SZ@2024-01-02#1",
      "000001.SZ@2024-01-02#2",
      "600002.SH@2024-01-02#1",
      "600002.SH@2024-01-02#2",
      "600002.SH@2024-01-02#3",
    ]);

    const outcomeWalk = await walk<FirstLimitPullbackOutcome, OutcomeCursor>(
      (cursor, limit) => snapshot.listOutcomesPage({ datasetVersionId: 1, cursor, limit }),
      decodeOutcomeCursor,
      2,
    );
    const memoryOutcomeWalk = await walk<FirstLimitPullbackOutcome, OutcomeCursor>(
      (cursor, limit) => memory.listOutcomesPage({ datasetVersionId: 1, cursor, limit }),
      decodeOutcomeCursor,
      2,
    );
    expect(detach(outcomeWalk)).toEqual(detach(memoryOutcomeWalk));

    const prefixWalk = await walk<FirstLimitPullbackRawBar, PathCursor>(
      (cursor, limit) => snapshot.listRawBarsPage("prefix", { datasetVersionId: 1, cursor, limit }),
      decodePathCursor,
      2,
    );
    const memoryPrefixWalk = await walk<FirstLimitPullbackRawBar, PathCursor>(
      (cursor, limit) => memory.listRawBarsPage("prefix", { datasetVersionId: 1, cursor, limit }),
      decodePathCursor,
      2,
    );
    expect(detach(prefixWalk)).toEqual(detach(memoryPrefixWalk));

    const postWalk = await walk<FirstLimitPullbackRawBar, PathCursor>(
      (cursor, limit) => snapshot.listRawBarsPage("post", { datasetVersionId: 1, cursor, limit }),
      decodePathCursor,
      2,
    );
    const memoryPostWalk = await walk<FirstLimitPullbackRawBar, PathCursor>(
      (cursor, limit) => memory.listRawBarsPage("post", { datasetVersionId: 1, cursor, limit }),
      decodePathCursor,
      2,
    );
    expect(detach(postWalk)).toEqual(detach(memoryPostWalk));

    // 版本隔离：版本 2 只看到自己的那 1 行。
    const versionTwo = await snapshot.listEventsPage({ datasetVersionId: 2, limit: 10 });
    expect(versionTwo.items.map((row) => row.eventId)).toEqual(["300001.SZ@2024-01-02"]);
  });

  it("matches batch reads (with and without horizon/day filters)", async () => {
    const eventIds = ["600002.SH@2024-01-02", "000001.SZ@2024-01-02", "missing"];
    await expect(
      snapshot.loadOutcomesBatch({ datasetVersionId: 1, eventIds }),
    ).resolves.toEqual(await memory.loadOutcomesBatch({ datasetVersionId: 1, eventIds }));
    await expect(
      snapshot.loadOutcomesBatch({ datasetVersionId: 1, eventIds, horizons: [10] }),
    ).resolves.toEqual(
      await memory.loadOutcomesBatch({ datasetVersionId: 1, eventIds, horizons: [10] }),
    );
    await expect(
      snapshot.loadPathsBatch({ datasetVersionId: 1, eventIds }),
    ).resolves.toEqual(await memory.loadPathsBatch({ datasetVersionId: 1, eventIds }));
    await expect(
      snapshot.loadPathsBatch({ datasetVersionId: 1, eventIds, relativeDays: [2] }),
    ).resolves.toEqual(
      await memory.loadPathsBatch({ datasetVersionId: 1, eventIds, relativeDays: [2] }),
    );
    await expect(
      snapshot.loadRawBarsBatch("prefix", { datasetVersionId: 1, eventIds }),
    ).resolves.toEqual(
      detach(await memory.loadRawBarsBatch("prefix", { datasetVersionId: 1, eventIds })),
    );
    await expect(
      snapshot.loadRawBarsBatch("post", { datasetVersionId: 1, eventIds, relativeDays: [1] }),
    ).resolves.toEqual(
      detach(await memory.loadRawBarsBatch("post", { datasetVersionId: 1, eventIds, relativeDays: [1] })),
    );
    await expect(
      snapshot.loadOutcomesBatch({ datasetVersionId: 2, eventIds: ["300001.SZ@2024-01-02"] }),
    ).resolves.toHaveLength(1);
  });

  it("matches date/event/horizon range filters", async () => {
    await expect(
      snapshot.listEventsPage({ datasetVersionId: 1, fromDate: "2024-01-03", limit: 10 }),
    ).resolves.toEqual(
      await memory.listEventsPage({ datasetVersionId: 1, fromDate: "2024-01-03", limit: 10 }),
    );
    await expect(
      snapshot.listEventsPage({ datasetVersionId: 1, toDate: "2024-01-02", limit: 10 }),
    ).resolves.toEqual(
      await memory.listEventsPage({ datasetVersionId: 1, toDate: "2024-01-02", limit: 10 }),
    );
    await expect(
      snapshot.listPathsPage({
        datasetVersionId: 1,
        eventId: "600002.SH@2024-01-02",
        fromDate: "2024-01-03",
        limit: 10,
      }),
    ).resolves.toEqual(
      await memory.listPathsPage({
        datasetVersionId: 1,
        eventId: "600002.SH@2024-01-02",
        fromDate: "2024-01-03",
        limit: 10,
      }),
    );
    await expect(
      snapshot.listOutcomesPage({ datasetVersionId: 1, horizon: 20, limit: 10 }),
    ).resolves.toEqual(
      await memory.listOutcomesPage({ datasetVersionId: 1, horizon: 20, limit: 10 }),
    );
  });

  it("honours column projection without changing row identity or ordering", async () => {
    const columns = ["datasetVersionId", "eventId", "tradeDate", "symbol"];
    const projected = await snapshot.listEventsPage({ datasetVersionId: 1, limit: 10, columns });
    expect(projected.items).toHaveLength(3);
    expect(Object.keys(projected.items[0]!).sort()).toEqual([...columns].sort());
    expect(projected.items[0]!.market).toBeUndefined();
    expect(projected.items.map((row) => row.eventId)).toEqual([
      "000001.SZ@2024-01-02",
      "600002.SH@2024-01-02",
      "600001.SH@2024-01-03",
    ]);

    const projectedOutcomes = await snapshot.loadOutcomesBatch({
      datasetVersionId: 1,
      eventIds: ["600002.SH@2024-01-02"],
      columns: ["eventId", "horizon", "isBreakout"],
    });
    expect(projectedOutcomes.map((row) => row.horizon)).toEqual([5, 10, 20]);
    for (const row of projectedOutcomes) {
      expect(Object.keys(row).sort()).toEqual(["eventId", "horizon", "isBreakout"]);
    }

    await expect(
      snapshot.listPathsPage({ datasetVersionId: 1, limit: 10, columns: ["bogus"] }),
    ).rejects.toThrow(/unknown|未知/i);
  });

  it("computes relative-day ranges from SQLite", async () => {
    await expect(snapshot.getPathRelativeDayRange(1)).resolves.toEqual({ min: 1, max: 3 });
    await expect(snapshot.getPostRelativeDayRange(1)).resolves.toEqual({ min: 1, max: 2 });
    await expect(snapshot.getPathRelativeDayRange(2)).resolves.toEqual({ min: 1, max: 1 });
  });
});

async function walk<T, Cursor>(
  fetchPage: (cursor: Cursor | null, limit: number) => Promise<{ items: T[]; nextCursor: string | null }>,
  decode: (cursor: string) => Cursor | null,
  limit: number,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: Cursor | null = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await fetchPage(cursor, limit);
    items.push(...page.items);
    if (!page.nextCursor) return items;
    cursor = decode(page.nextCursor);
  }
  throw new Error("pagination did not terminate");
}
