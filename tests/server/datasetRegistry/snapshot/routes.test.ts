import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerDatasetSnapshotRoutes } from "../../../../server/datasetSnapshotRoutes";
import type { DatasetMetadataReader } from "../../../../server/datasetRegistry/snapshot/contentDependencies";
import { DatasetSnapshotStore } from "../../../../server/datasetRegistry/snapshot/store";
import {
  fixtureDefinition,
  fixtureVersion,
  singleVersionFixtureRows,
  writeSnapshotFixture,
  type SnapshotFixtureResult,
} from "./snapshotFixtures";

describe("dataset snapshot download route", () => {
  let root: string;
  let store: DatasetSnapshotStore;
  let fixture: SnapshotFixtureResult;
  let metadataReader: DatasetMetadataReader;
  let previousNodeEnv: string | undefined;
  let server: ReturnType<Express["listen"]>;
  let baseUrl: string;

  beforeEach(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    root = await mkdtemp(path.join(tmpdir(), "dataset-snapshot-route-"));
    store = new DatasetSnapshotStore(root);
    fixture = await writeSnapshotFixture(store.versionDir(1), singleVersionFixtureRows(1));
    metadataReader = {
      getVersionById: async (id) =>
        id === 1 ? fixtureVersion({ id: 1 }) : id === 2 ? fixtureVersion({ id: 2 }) : undefined,
      getDefinitionById: async (id) => (id === 11 ? fixtureDefinition({ id: 11 }) : undefined),
    };
    const app = express();
    registerDatasetSnapshotRoutes(app, { store, metadataReader });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  it("streams the fixed sqlite file with manifest headers in development", async () => {
    const response = await fetch(`${baseUrl}/api/datasets/1/snapshot`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="dataset-1.sqlite"');
    expect(response.headers.get("x-dataset-snapshot-sha256")).toBe(fixture.manifest.sqlite.sha256);
    expect(Number(response.headers.get("content-length"))).toBe(fixture.manifest.sqlite.size);

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(fixture.manifest.sqlite.size);
    expect(createHash("sha256").update(body).digest("hex")).toBe(fixture.manifest.sqlite.sha256);
  });

  it("returns 404 in production without revealing existence", async () => {
    process.env.NODE_ENV = "production";
    const response = await fetch(`${baseUrl}/api/datasets/1/snapshot`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "SNAPSHOT_DISABLED" });
  });

  it("returns 404 for an unknown version and for a version without a snapshot", async () => {
    const unknown = await fetch(`${baseUrl}/api/datasets/777/snapshot`);
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toMatchObject({ code: "SNAPSHOT_VERSION_NOT_FOUND" });

    const missing = await fetch(`${baseUrl}/api/datasets/2/snapshot`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "SNAPSHOT_NOT_FOUND" });
  });

  it("returns 404 when the definition is not first_limit_pullback", async () => {
    const app = express();
    registerDatasetSnapshotRoutes(app, {
      store,
      metadataReader: {
        getVersionById: async () => fixtureVersion({ id: 1 }),
        getDefinitionById: async () => fixtureDefinition({ id: 11, datasetCode: "other_dataset" }),
      },
    });
    const other = app.listen(0);
    await new Promise<void>((resolve) => other.once("listening", () => resolve()));
    const port = (other.address() as AddressInfo).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/datasets/1/snapshot`);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "SNAPSHOT_NOT_SUPPORTED" });
    } finally {
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });

  it("returns 400 for a non-positive or non-numeric id", async () => {
    const response = await fetch(`${baseUrl}/api/datasets/not-a-number/snapshot`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "SNAPSHOT_VERSION_ID_INVALID" });
  });
});
