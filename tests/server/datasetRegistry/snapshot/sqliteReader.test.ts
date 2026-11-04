import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "../../../../server/datasetRegistry/snapshot/nodeSqlite";
import { createSnapshotSqliteSchema, insertSnapshotRows } from "../../../../server/datasetRegistry/snapshot/sqliteSchema";
import { SnapshotSqliteReader } from "../../../../server/datasetRegistry/snapshot/sqliteReader";
import {
  decodeEventCursor,
  decodeOutcomeCursor,
  decodePathCursor,
} from "../../../../server/datasetRegistry/query";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../../../../server/datasetRegistry/types";

function makeEvent(
  datasetVersionId: number,
  eventId: string,
  tradeDate: string,
): FirstLimitPullbackEvent {
  return {
    datasetVersionId,
    eventId,
    symbol: eventId.split("@")[0]!,
    tradeDate,
    market: "SH",
    industryCode: "I01",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    limitDownPrice: 9,
    limitRuleUp: 0.1,
    limitRuleDown: -0.1,
    limitRuleVersion: "v1",
    turnover: 5,
    limitUpTime: "09:31:00",
    sector: "test",
    keywords: "alpha",
    sourceTurnoverAmount: 1.2,
    sourceCirculationValue: 3.4,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 0,
    marketCap: 100,
    floatMarketCap: 80,
  };
}

function makePath(
  datasetVersionId: number,
  eventId: string,
  relativeDay: number,
): FirstLimitPullbackPath {
  return {
    datasetVersionId,
    eventId,
    symbol: eventId.split("@")[0]!,
    tradeDate: `2024-01-${String(relativeDay + 1).padStart(2, "0")}`,
    relativeDay,
    highFromEventClose: 0.2,
    lowFromEventClose: -0.1,
    closeFromEventClose: 0.05,
    pullbackFromEventHigh: -0.15,
    volumeRatio: 1.1,
    isBreakout: relativeDay % 2 === 0,
    breakoutPrice: 11.5,
    daysToBreakout: relativeDay,
  };
}

function makeOutcome(
  datasetVersionId: number,
  eventId: string,
  horizon: number,
): FirstLimitPullbackOutcome {
  return {
    datasetVersionId,
    eventId,
    horizon,
    maxReturn: 0.2,
    minReturn: -0.1,
    maxDrawdown: -0.05,
    isBreakout: horizon > 5,
    daysToBreakout: horizon - 1,
  };
}

function makeBar(
  datasetVersionId: number,
  eventId: string,
  relativeDay: number,
  post = false,
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId,
    eventId,
    symbol: eventId.split("@")[0]!,
    tradeDate: `2024-02-${String(Math.abs(relativeDay) + 1).padStart(2, "0")}`,
    relativeDay,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    preClose: 10,
    ...(post
      ? {
          limitUpPrice: 11,
          limitDownPrice: 9,
          limitRuleUp: 0.1,
          limitRuleDown: -0.1,
          limitRuleVersion: "v1",
          barPresent: true,
          suspensionStatus: "NOT_SUSPENDED" as const,
          suspensionSource: "PIT_STATUS" as const,
          openAtLimitUp: false,
          closeAtLimitDown: false,
          oneWordLimitUp: false,
          oneWordLimitDown: false,
          canBuyAtOpen: true,
          canSellAtClose: true,
        }
      : {}),
    volume: 1000,
    amount: 10000,
  };
}

describe("dataset snapshot SQLite reader", () => {
  let dir: string;
  let dbPath: string;

  const versionOneEvents = [
    makeEvent(1, "600002.SH@2024-01-02", "2024-01-02"),
    makeEvent(1, "000001.SZ@2024-01-02", "2024-01-02"),
    makeEvent(1, "600001.SH@2024-01-03", "2024-01-03"),
  ];
  const versionTwoEvents = [makeEvent(2, "300001.SZ@2024-01-02", "2024-01-02")];
  const paths = [
    makePath(1, "600002.SH@2024-01-02", 1),
    makePath(1, "600002.SH@2024-01-02", 2),
    makePath(1, "600002.SH@2024-01-02", 3),
    makePath(1, "000001.SZ@2024-01-02", 1),
    makePath(1, "000001.SZ@2024-01-02", 2),
    makePath(2, "300001.SZ@2024-01-02", 1),
  ];
  const outcomes = [
    makeOutcome(1, "600002.SH@2024-01-02", 5),
    makeOutcome(1, "600002.SH@2024-01-02", 10),
    makeOutcome(1, "600002.SH@2024-01-02", 20),
    makeOutcome(2, "300001.SZ@2024-01-02", 5),
  ];
  const prefixes = [
    makeBar(1, "600002.SH@2024-01-02", 0),
    makeBar(1, "600002.SH@2024-01-02", -1),
    makeBar(1, "000001.SZ@2024-01-02", 0),
  ];
  const posts = [
    makeBar(1, "600002.SH@2024-01-02", 1, true),
    makeBar(1, "600002.SH@2024-01-02", 2, true),
    makeBar(1, "000001.SZ@2024-01-02", 1, true),
  ];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dataset-snapshot-reader-"));
    dbPath = path.join(dir, "dataset.sqlite");
    const db = new DatabaseSync(dbPath);
    createSnapshotSqliteSchema(db);
    insertSnapshotRows(db, "event", [...versionOneEvents, ...versionTwoEvents]);
    insertSnapshotRows(db, "prefix", prefixes);
    insertSnapshotRows(db, "post", posts);
    insertSnapshotRows(db, "path", paths);
    insertSnapshotRows(db, "outcome", outcomes);
    db.close();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("paginates events with the same keyset order and version isolation as DB", async () => {
    const reader = new SnapshotSqliteReader(dbPath);
    const first = await reader.listEventsPage({ datasetVersionId: 1, limit: 2 });
    expect(first.items.map((row) => `${row.tradeDate}|${row.eventId}`)).toEqual([
      "2024-01-02|000001.SZ@2024-01-02",
      "2024-01-02|600002.SH@2024-01-02",
    ]);
    const second = await reader.listEventsPage({
      datasetVersionId: 1,
      cursor: decodeEventCursor(first.nextCursor!),
      limit: 2,
    });
    expect(second.nextCursor).toBeNull();
    expect(second.items.map((row) => row.eventId)).toEqual(["600001.SH@2024-01-03"]);
    expect([...first.items, ...second.items].every((row) => row.datasetVersionId === 1)).toBe(true);
  });

  it("paginates path and outcome rows using eventId-relative keyset ordering", async () => {
    const reader = new SnapshotSqliteReader(dbPath);
    const firstPaths = await reader.listPathsPage({ datasetVersionId: 1, limit: 2 });
    const secondPaths = await reader.listPathsPage({
      datasetVersionId: 1,
      cursor: decodePathCursor(firstPaths.nextCursor!),
      limit: 10,
    });
    expect([...firstPaths.items, ...secondPaths.items].map((row) => `${row.eventId}#${row.relativeDay}`)).toEqual([
      "000001.SZ@2024-01-02#1",
      "000001.SZ@2024-01-02#2",
      "600002.SH@2024-01-02#1",
      "600002.SH@2024-01-02#2",
      "600002.SH@2024-01-02#3",
    ]);

    const firstOutcomes = await reader.listOutcomesPage({ datasetVersionId: 1, limit: 2 });
    const secondOutcomes = await reader.listOutcomesPage({
      datasetVersionId: 1,
      cursor: decodeOutcomeCursor(firstOutcomes.nextCursor!),
      limit: 10,
    });
    expect([...firstOutcomes.items, ...secondOutcomes.items].map((row) => `${row.eventId}#${row.horizon}`)).toEqual([
      "600002.SH@2024-01-02#5",
      "600002.SH@2024-01-02#10",
      "600002.SH@2024-01-02#20",
    ]);
  });

  it("supports batch reads, range filters and nullable post-only fields", async () => {
    const reader = new SnapshotSqliteReader(dbPath);
    const loadedPrefixes = await reader.loadRawBarsBatch("prefix", {
      datasetVersionId: 1,
      eventIds: ["600002.SH@2024-01-02"],
      relativeDays: [0],
    });
    expect(loadedPrefixes).toHaveLength(1);
    expect(loadedPrefixes[0]).toMatchObject({
      eventId: "600002.SH@2024-01-02",
      relativeDay: 0,
      limitUpPrice: null,
      barPresent: null,
    });

    const loadedPosts = await reader.loadRawBarsBatch("post", {
      datasetVersionId: 1,
      eventIds: ["600002.SH@2024-01-02", "000001.SZ@2024-01-02"],
      relativeDays: [1],
      columns: ["datasetVersionId", "eventId", "relativeDay", "barPresent", "canBuyAtOpen"],
    });
    expect(loadedPosts).toHaveLength(2);
    expect(loadedPosts[0]).toMatchObject({
      eventId: "000001.SZ@2024-01-02",
      relativeDay: 1,
      barPresent: true,
      canBuyAtOpen: true,
    });
    expect(loadedPosts[0]!.open).toBeUndefined();
  });

  it("returns empty results without querying when batch event ids are empty", async () => {
    const reader = new SnapshotSqliteReader(dbPath);
    await expect(
      reader.loadOutcomesBatch({ datasetVersionId: 1, eventIds: [] }),
    ).resolves.toEqual([]);
    await expect(
      reader.loadPathsBatch({ datasetVersionId: 1, eventIds: [] }),
    ).resolves.toEqual([]);
    await expect(
      reader.loadRawBarsBatch("prefix", { datasetVersionId: 1, eventIds: [] }),
    ).resolves.toEqual([]);
  });

  it("rejects unknown projected columns", async () => {
    const reader = new SnapshotSqliteReader(dbPath);
    await expect(
      reader.listEventsPage({
        datasetVersionId: 1,
        limit: 10,
        columns: ["datasetVersionId", "not_a_column"],
      }),
    ).rejects.toThrow(/unknown|未知/i);
  });

  it("computes counts and relative-day ranges from SQLite only", async () => {
    const reader = new SnapshotSqliteReader(dbPath);
    await expect(reader.getVersionCounts(1)).resolves.toEqual({
      eventCount: 3,
      prefixCount: 3,
      postCount: 3,
      pathCount: 5,
      outcomeCount: 3,
      rowCount: 17,
      firstDate: "2024-01-02",
      lastDate: "2024-01-03",
      horizons: [5, 10, 20],
    });
    await expect(reader.getPathRelativeDayRange(1)).resolves.toEqual({ min: 1, max: 3 });
    await expect(reader.getPostRelativeDayRange(1)).resolves.toEqual({ min: 1, max: 2 });
  });
});
