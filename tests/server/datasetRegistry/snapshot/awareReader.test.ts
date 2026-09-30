import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatasetDataReader, DatasetVersionCounts } from "../../../../server/datasetRegistry/query";
import { DatasetSnapshotError } from "../../../../server/datasetRegistry/snapshot/errors";
import { DatasetSnapshotStore } from "../../../../server/datasetRegistry/snapshot/store";
import { SnapshotAwareDatasetDataReader } from "../../../../server/datasetRegistry/snapshot/awareReader";
import {
  FIXTURE_DATASET_VERSION_ID,
  makeEvent,
  singleVersionFixtureRows,
  writeSnapshotFixture,
  type SnapshotFixtureResult,
} from "./snapshotFixtures";

const NOT_USED: DatasetVersionCounts = {
  eventCount: -1,
  prefixCount: -1,
  postCount: -1,
  pathCount: -1,
  outcomeCount: -1,
  rowCount: -1,
  firstDate: "DB",
  lastDate: "DB",
  horizons: [-1],
};

/** 任何内容表访问都计数并抛错的替身：用来证明「有效快照下零内容表查询」。 */
class ThrowingDbReader implements DatasetDataReader {
  calls = 0;

  private boom(): never {
    this.calls += 1;
    throw new Error("DB content access is forbidden in snapshot mode");
  }

  async getVersionCounts(): Promise<DatasetVersionCounts> {
    return this.boom();
  }
  async listEventsPage(): Promise<never> {
    return this.boom();
  }
  async listRawBarsPage(): Promise<never> {
    return this.boom();
  }
  async listPathsPage(): Promise<never> {
    return this.boom();
  }
  async listOutcomesPage(): Promise<never> {
    return this.boom();
  }
  async loadOutcomesBatch(): Promise<never> {
    return this.boom();
  }
  async loadPathsBatch(): Promise<never> {
    return this.boom();
  }
  async loadRawBarsBatch(): Promise<never> {
    return this.boom();
  }
  async getPathRelativeDayRange(): Promise<never> {
    return this.boom();
  }
  async getPostRelativeDayRange(): Promise<never> {
    return this.boom();
  }
}

/** 始终返回哨兵统计的替身：证明无快照时正常回退 DB。 */
class SentinelDbReader extends ThrowingDbReader {
  override async getVersionCounts(): Promise<DatasetVersionCounts> {
    return NOT_USED;
  }
}

describe("SnapshotAwareDatasetDataReader", () => {
  let root: string;
  let store: DatasetSnapshotStore;
  let fixture: SnapshotFixtureResult;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dataset-snapshot-aware-"));
    store = new DatasetSnapshotStore(root);
    fixture = await writeSnapshotFixture(
      store.versionDir(FIXTURE_DATASET_VERSION_ID),
      singleVersionFixtureRows(FIXTURE_DATASET_VERSION_ID),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads entirely from SQLite when a valid snapshot exists (zero DB content access)", async () => {
    const db = new ThrowingDbReader();
    const reader = new SnapshotAwareDatasetDataReader({ store, dbReader: db });

    await expect(reader.getVersionCounts(FIXTURE_DATASET_VERSION_ID)).resolves.toMatchObject({
      eventCount: 3,
      rowCount: 18,
    });
    const events = await reader.listEventsPage({ datasetVersionId: FIXTURE_DATASET_VERSION_ID, limit: 10 });
    expect(events.items.map((row) => row.eventId)).toEqual([
      "000001.SZ@2024-01-02",
      "600002.SH@2024-01-02",
      "600001.SH@2024-01-03",
    ]);
    const paths = await reader.loadPathsBatch({
      datasetVersionId: FIXTURE_DATASET_VERSION_ID,
      eventIds: ["600002.SH@2024-01-02"],
    });
    expect(paths.map((row) => row.relativeDay)).toEqual([1, 2, 3]);

    expect(db.calls).toBe(0);
  });

  it("falls back to the DB reader when there is no snapshot", async () => {
    const db = new SentinelDbReader();
    const reader = new SnapshotAwareDatasetDataReader({ store, dbReader: db });
    await expect(reader.getVersionCounts(987_654)).resolves.toEqual(NOT_USED);
  });

  it("propagates DatasetSnapshotError instead of falling back when a snapshot is corrupt", async () => {
    const manifestRaw = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as {
      sqlite: { sha256: string };
    };
    manifestRaw.sqlite.sha256 = "b".repeat(64);
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

    const db = new ThrowingDbReader();
    const reader = new SnapshotAwareDatasetDataReader({ store, dbReader: db });
    await expect(
      reader.listEventsPage({ datasetVersionId: FIXTURE_DATASET_VERSION_ID, limit: 10 }),
    ).rejects.toBeInstanceOf(DatasetSnapshotError);
    expect(db.calls).toBe(0);
  });

  it("resolves canonical security ids from event_identity when a snapshot exists", async () => {
    const db = new ThrowingDbReader();
    const reader = new SnapshotAwareDatasetDataReader({ store, dbReader: db });
    const resolved = await reader.resolveSecurityIdsByEvent(FIXTURE_DATASET_VERSION_ID, [
      makeEvent(FIXTURE_DATASET_VERSION_ID, "600002.SH@2024-01-02", "2024-01-02"),
      makeEvent(FIXTURE_DATASET_VERSION_ID, "000001.SZ@2024-01-02", "2024-01-02"),
    ]);
    expect(resolved.get("600002.SH@2024-01-02")).toBe("sec_00000000-0000-4000-8000-000000000001");
    expect(resolved.get("000001.SZ@2024-01-02")).toBe("sec_00000000-0000-4000-8000-000000000002");
    expect(db.calls).toBe(0);
  });

  it("throws SNAPSHOT_IDENTITY_MISSING when an event has no identity row", async () => {
    const reader = new SnapshotAwareDatasetDataReader({ store, dbReader: new ThrowingDbReader() });
    await expect(
      reader.resolveSecurityIdsByEvent(FIXTURE_DATASET_VERSION_ID, [
        makeEvent(FIXTURE_DATASET_VERSION_ID, "602222.SH@2024-01-02", "2024-01-02"),
      ]),
    ).rejects.toMatchObject({ name: "DatasetSnapshotError", code: "SNAPSHOT_IDENTITY_MISSING" });
  });

  it("uses the fallback identity resolver when there is no snapshot", async () => {
    const calls: number[] = [];
    const reader = new SnapshotAwareDatasetDataReader({
      store,
      dbReader: new ThrowingDbReader(),
      fallbackIdentityResolver: async (datasetVersionId, events) => {
        calls.push(datasetVersionId, events.length);
        return new Map(events.map((event) => [event.eventId, "sec_11111111-1111-4111-8111-111111111111"]));
      },
    });
    const resolved = await reader.resolveSecurityIdsByEvent(4321, [
      makeEvent(4321, "600000.SH@2024-01-02", "2024-01-02"),
    ]);
    expect(calls).toEqual([4321, 1]);
    expect(resolved.size).toBe(1);
  });
});
