import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryDatasetDataReader } from "../../../../server/datasetRegistry/query";
import { exportDatasetSnapshot } from "../../../../server/datasetRegistry/snapshot/exporter";
import { DatasetSnapshotError } from "../../../../server/datasetRegistry/snapshot/errors";
import { DatasetSnapshotStore } from "../../../../server/datasetRegistry/snapshot/store";
import type { DatasetMetadataReader } from "../../../../server/datasetRegistry/snapshot/contentDependencies";
import type { DatasetSnapshotManifest } from "../../../../server/datasetRegistry/snapshot/manifest";
import {
  defaultFixtureRows,
  fixtureDefinition,
  fixtureVersion,
  makePath,
  type SnapshotFixtureRows,
} from "./snapshotFixtures";

const VERSION_ID = 1;

function secFor(index: number): string {
  return `sec_00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function readerFor(rows: SnapshotFixtureRows): InMemoryDatasetDataReader {
  return new InMemoryDatasetDataReader(
    rows.events,
    rows.paths,
    rows.outcomes,
    rows.prefixes,
    rows.posts
  );
}

describe("exportDatasetSnapshot", () => {
  let root: string;
  let store: DatasetSnapshotStore;
  let metadataReader: DatasetMetadataReader;
  let rows: SnapshotFixtureRows;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dataset-snapshot-export-"));
    store = new DatasetSnapshotStore(root);
    rows = defaultFixtureRows();
    metadataReader = {
      getVersionById: async id =>
        id === VERSION_ID
          ? { ...fixtureVersion({ id: VERSION_ID }) }
          : undefined,
      getDefinitionById: async id =>
        id === 11 ? { ...fixtureDefinition({ id: 11 }) } : undefined,
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function identityResolver(
    events: readonly { eventId: string }[]
  ): Map<string, string> {
    return new Map(
      events.map((event, index) => [event.eventId, secFor(index + 1)])
    );
  }

  async function exportOnce(
    options: {
      force?: boolean;
      rows?: SnapshotFixtureRows;
      resolver?: (
        events: readonly { eventId: string }[]
      ) => Map<string, string>;
    } = {}
  ): Promise<DatasetSnapshotManifest> {
    const result = await exportDatasetSnapshot(
      {
        metadataReader,
        reader: readerFor(options.rows ?? rows),
        store,
        identityResolver: async (_datasetVersionId, events) =>
          (options.resolver ?? identityResolver)(events),
      },
      {
        datasetVersionId: VERSION_ID,
        ...(options.force !== undefined ? { force: options.force } : {}),
      }
    );
    return result.manifest;
  }

  it("exports a valid snapshot that the store can re-validate from disk", async () => {
    const manifest = await exportOnce();
    expect(manifest.counts).toMatchObject({
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
    expect(manifest.identityCount).toBe(3);
    expect(manifest.version).toMatchObject({
      id: VERSION_ID,
      label: "v-fixture",
      status: "READY",
    });

    const fresh = new DatasetSnapshotStore(root);
    const loaded = await fresh.loadValid(VERSION_ID, {
      version: fixtureVersion({ id: VERSION_ID }),
      definition: fixtureDefinition({ id: 11 }),
    });
    expect(loaded?.manifest.sqlite.sha256).toBe(manifest.sqlite.sha256);
  });

  it("loads the DB identity map once per export instead of once per page", async () => {
    const resolverCalls: Array<readonly { eventId: string }[]> = [];
    await exportDatasetSnapshot(
      {
        metadataReader,
        reader: readerFor(rows),
        store,
        identityResolver: async (_datasetVersionId, events) => {
          resolverCalls.push(events);
          return identityResolver(events);
        },
      },
      { datasetVersionId: VERSION_ID }
    );

    expect(resolverCalls).toHaveLength(1);
    expect(resolverCalls[0]).toHaveLength(3);
    const loaded = await new DatasetSnapshotStore(root).loadValid(VERSION_ID);
    expect(loaded?.manifest.identityCount).toBe(3);
  });

  it("retries transient DB read failures without duplicating rows or identities", async () => {
    let attempts = 0;
    const transientReader: InMemoryDatasetDataReader = readerFor(rows);
    const originalListEventsPage =
      transientReader.listEventsPage.bind(transientReader);
    transientReader.listEventsPage = async query => {
      attempts += 1;
      if (attempts === 1) {
        const cause = Object.assign(new Error("connect ETIMEDOUT"), {
          code: "ETIMEDOUT",
        });
        throw new Error(
          "Failed query: select ... from ds_first_limit_pullback_event",
          {
            cause,
          }
        );
      }
      return originalListEventsPage(query);
    };

    await exportDatasetSnapshot(
      {
        metadataReader,
        reader: transientReader,
        store,
        identityResolver: async (_datasetVersionId, events) =>
          identityResolver(events),
      },
      { datasetVersionId: VERSION_ID }
    );

    expect(attempts).toBe(2);
    const loaded = await new DatasetSnapshotStore(root).loadValid(VERSION_ID);
    expect(loaded).not.toBeNull();
    expect(loaded?.manifest.counts.eventCount).toBe(3);
    expect(loaded?.manifest.identityCount).toBe(3);
  });

  it("retries a transient identity-history read and publishes the complete snapshot", async () => {
    let identityAttempts = 0;
    const { manifest } = await exportDatasetSnapshot(
      {
        metadataReader,
        reader: readerFor(rows),
        store,
        identityResolver: async (_datasetVersionId, events) => {
          identityAttempts += 1;
          if (identityAttempts === 1) {
            const cause = Object.assign(new Error("connect ETIMEDOUT"), {
              code: "ETIMEDOUT",
            });
            throw new Error(
              "Failed query: select ... from research_security_identifier_history",
              { cause }
            );
          }
          return identityResolver(events);
        },
      },
      { datasetVersionId: VERSION_ID }
    );

    expect(identityAttempts).toBe(2);
    expect(manifest.counts.eventCount).toBe(3);
    expect(manifest.identityCount).toBe(3);
  });

  it("rejects non-READY versions and unsupported dataset codes", async () => {
    const draftReader: DatasetMetadataReader = {
      getVersionById: async () => ({
        ...fixtureVersion({ id: VERSION_ID, status: "DRAFT" }),
      }),
      getDefinitionById: async () => ({ ...fixtureDefinition({ id: 11 }) }),
    };
    await expect(
      exportDatasetSnapshot(
        {
          metadataReader: draftReader,
          reader: readerFor(rows),
          store,
          identityResolver: async (_id, events) => identityResolver(events),
        },
        { datasetVersionId: VERSION_ID }
      )
    ).rejects.toMatchObject({
      name: "DatasetSnapshotError",
      code: "SNAPSHOT_NOT_SUPPORTED",
    });

    const otherCode: DatasetMetadataReader = {
      getVersionById: async () => ({ ...fixtureVersion({ id: VERSION_ID }) }),
      getDefinitionById: async () => ({
        ...fixtureDefinition({ id: 11, datasetCode: "other_dataset" }),
      }),
    };
    await expect(
      exportDatasetSnapshot(
        {
          metadataReader: otherCode,
          reader: readerFor(rows),
          store,
          identityResolver: async (_id, events) => identityResolver(events),
        },
        { datasetVersionId: VERSION_ID }
      )
    ).rejects.toMatchObject({
      name: "DatasetSnapshotError",
      code: "SNAPSHOT_NOT_SUPPORTED",
    });
  });

  it("fails loudly (and publishes nothing) when an event has no canonical identity", async () => {
    await expect(
      exportOnce({
        resolver: events =>
          new Map(events.map(event => [event.eventId, "not-a-canonical-id"])),
      })
    ).rejects.toMatchObject({
      name: "DatasetSnapshotError",
      code: "SNAPSHOT_IDENTITY_MISSING",
    });
    await expect(store.loadValid(VERSION_ID)).resolves.toBeNull();
  });

  it("requires --force to replace an existing snapshot", async () => {
    await exportOnce();
    await expect(exportOnce()).rejects.toMatchObject({
      name: "DatasetSnapshotError",
      code: "SNAPSHOT_PUBLISH_FAILED",
    });
    const fresh = new DatasetSnapshotStore(root);
    await expect(fresh.loadValid(VERSION_ID)).resolves.not.toBeNull();
  });

  it("keeps the previous snapshot intact when a forced re-export fails", async () => {
    const first = await exportOnce();
    const before = await new DatasetSnapshotStore(root).loadValid(VERSION_ID);
    expect(before?.manifest.sqlite.sha256).toBe(first.sqlite.sha256);

    await expect(
      exportOnce({
        force: true,
        resolver: () => new Map([["600002.SH@2024-01-02", "bad"]]),
      })
    ).rejects.toBeInstanceOf(DatasetSnapshotError);

    const after = await new DatasetSnapshotStore(root).loadValid(VERSION_ID);
    expect(after?.manifest.sqlite.sha256).toBe(first.sqlite.sha256);
    expect(after?.manifest.counts.pathCount).toBe(5);
  });

  it("atomically replaces the snapshot with fresh data when forced", async () => {
    await exportOnce();
    const updated: SnapshotFixtureRows = {
      ...rows,
      paths: [...rows.paths, makePath(1, "600001.SH@2024-01-03", 1)],
    };
    const manifest = await exportOnce({ force: true, rows: updated });
    expect(manifest.counts.pathCount).toBe(6);

    const fresh = await new DatasetSnapshotStore(root).loadValid(VERSION_ID);
    expect(fresh?.manifest.counts.pathCount).toBe(6);
  });
});
