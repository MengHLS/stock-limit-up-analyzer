import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "../../../../server/datasetRegistry/snapshot/nodeSqlite";
import {
  DatasetSnapshotStore,
  fileSizeAndSha256,
} from "../../../../server/datasetRegistry/snapshot/store";
import {
  DatasetSnapshotError,
  type DatasetSnapshotErrorCode,
} from "../../../../server/datasetRegistry/snapshot/errors";
import type { DatasetSnapshotManifest } from "../../../../server/datasetRegistry/snapshot/manifest";
import {
  FIXTURE_DATASET_VERSION_ID,
  defaultFixtureRows,
  fixtureDefinition,
  fixtureVersion,
  singleVersionFixtureRows,
  writeSnapshotFixture,
  type SnapshotFixtureResult,
} from "./snapshotFixtures";
import { isTemporarySnapshotDirectory } from "../../../../server/datasetRegistry/snapshot/paths";

async function expectSnapshotError(
  run: () => Promise<unknown>,
  codes: readonly DatasetSnapshotErrorCode[],
): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(DatasetSnapshotError);
    expect(codes).toContain((error as DatasetSnapshotError).code);
    return;
  }
  throw new Error("expected a DatasetSnapshotError, but the call resolved");
}

describe("DatasetSnapshotStore validation", () => {
  let root: string;
  let store: DatasetSnapshotStore;
  let fixture: SnapshotFixtureResult;
  let previousDir: string | undefined;

  beforeEach(async () => {
    previousDir = process.env.DATASET_SNAPSHOT_DIR;
    delete process.env.DATASET_SNAPSHOT_DIR;
    root = await mkdtemp(path.join(tmpdir(), "dataset-snapshot-store-"));
    store = new DatasetSnapshotStore(root);
    fixture = await writeSnapshotFixture(
      store.versionDir(FIXTURE_DATASET_VERSION_ID),
      singleVersionFixtureRows(FIXTURE_DATASET_VERSION_ID),
    );
  });

  afterEach(async () => {
    if (previousDir === undefined) delete process.env.DATASET_SNAPSHOT_DIR;
    else process.env.DATASET_SNAPSHOT_DIR = previousDir;
    await rm(root, { recursive: true, force: true });
  });

  const expected = {
    version: fixtureVersion(),
    definition: fixtureDefinition(),
  };

  async function rewriteManifest(mutate: (manifest: DatasetSnapshotManifest) => void): Promise<void> {
    const raw = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as DatasetSnapshotManifest;
    mutate(raw);
    await writeFile(fixture.manifestPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  }

  it("loads a self-consistent snapshot and serves it from cache until invalidated", async () => {
    const first = await store.loadValid(FIXTURE_DATASET_VERSION_ID, expected);
    expect(first?.manifest.counts.eventCount).toBe(3);
    expect(first?.manifest.identityCount).toBe(3);
    const second = await store.loadValid(FIXTURE_DATASET_VERSION_ID, expected);
    expect(second).toBe(first);

    store.invalidate(FIXTURE_DATASET_VERSION_ID);
    const third = await store.loadValid(FIXTURE_DATASET_VERSION_ID, expected);
    expect(third?.manifest.counts.rowCount).toBe(first?.manifest.counts.rowCount);
    expect(third).not.toBe(first);
  });

  it("returns null when no snapshot directory exists", async () => {
    await expect(store.loadValid(999_999)).resolves.toBeNull();
  });

  it("throws SNAPSHOT_SCHEMA_INVALID when a content table is missing", async () => {
    const db = new DatabaseSync(fixture.sqlitePath);
    db.exec('DROP TABLE "path"');
    db.close();
    const { size, sha256 } = await fileSizeAndSha256(fixture.sqlitePath);
    await rewriteManifest((manifest) => {
      manifest.sqlite.size = size;
      manifest.sqlite.sha256 = sha256;
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_SCHEMA_INVALID"],
    );
  });

  it("throws SNAPSHOT_VERSION_MISMATCH when manifest points at another version", async () => {
    await rewriteManifest((manifest) => {
      manifest.datasetVersionId = 4242;
      manifest.version.id = 4242;
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_VERSION_MISMATCH"],
    );
  });

  it("throws SNAPSHOT_VERSION_MISMATCH when manifest metadata disagrees with the registry", async () => {
    await rewriteManifest((manifest) => {
      manifest.version.label = "v-some-other-label";
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_VERSION_MISMATCH"],
    );
  });

  it("throws SNAPSHOT_CHECKSUM_MISMATCH when the SQLite bytes no longer match the manifest", async () => {
    await rewriteManifest((manifest) => {
      manifest.sqlite.sha256 = "a".repeat(64);
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_CHECKSUM_MISMATCH"],
    );
  });

  it("throws SNAPSHOT_COUNT_MISMATCH when a row count drifts from the manifest", async () => {
    await rewriteManifest((manifest) => {
      manifest.counts.eventCount += 1;
      manifest.counts.rowCount += 1;
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_COUNT_MISMATCH"],
    );
  });

  it("throws SNAPSHOT_COUNT_MISMATCH when a relative-day range drifts", async () => {
    await rewriteManifest((manifest) => {
      manifest.pathRelativeDayRange = { min: 0, max: 99 };
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_COUNT_MISMATCH"],
    );
  });

  it("throws SNAPSHOT_IDENTITY_MISSING when identityCount drifts", async () => {
    await rewriteManifest((manifest) => {
      manifest.identityCount += 1;
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_IDENTITY_MISSING"],
    );
  });

  it("rejects unknown manifest formats", async () => {
    await rewriteManifest((manifest) => {
      (manifest as { formatVersion: number }).formatVersion = 99;
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_INVALID", "SNAPSHOT_MANIFEST_INVALID"],
    );
  });

  it("rejects a manifest with an unexpected sqlite file name", async () => {
    await rewriteManifest((manifest) => {
      (manifest.sqlite as { fileName: string }).fileName = "other.sqlite";
    });
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_INVALID", "SNAPSHOT_MANIFEST_INVALID"],
    );
  });

  it("throws SNAPSHOT_INVALID when only one of manifest / sqlite exists", async () => {
    await rm(fixture.manifestPath);
    await expectSnapshotError(
      () => store.loadValid(FIXTURE_DATASET_VERSION_ID, expected),
      ["SNAPSHOT_INVALID"],
    );
  });

  it("never auto-reads .tmp-* directories", async () => {
    expect(isTemporarySnapshotDirectory(".tmp-1-abc")).toBe(true);
    expect(isTemporarySnapshotDirectory("1")).toBe(false);

    // `.tmp-<id>-<uuid>` 里即使放了一份自洽快照，也绝不参与自动读取：只有 `<root>/<id>` 才算数。
    const temporary = path.join(root, ".tmp-5-00000000-0000-4000-8000-000000000000");
    await writeSnapshotFixture(temporary, defaultFixtureRows(), { datasetVersionId: 5 });
    await expect(store.loadValid(5)).resolves.toBeNull();
  });
});
