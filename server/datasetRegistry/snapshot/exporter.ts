import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DATASET_SNAPSHOT_EXPORTER_VERSION,
  DATASET_SNAPSHOT_FILE_NAME,
  DATASET_SNAPSHOT_FORMAT_VERSION,
  DATASET_SNAPSHOT_MANIFEST_FILE_NAME,
  type DatasetSnapshotManifest,
} from "./manifest";
import { DatasetSnapshotError } from "./errors";
import {
  createSnapshotSqliteSchema,
  insertSnapshotRows,
  prepareSnapshotIdentityInsert,
} from "./sqliteSchema";
import {
  DatabaseSync,
  type DatabaseSync as DatabaseSyncType,
} from "./nodeSqlite";
import {
  decodeEventCursor,
  decodeOutcomeCursor,
  decodePathCursor,
  type DatasetDataReader,
} from "../query";
import type {
  DatasetDefinition,
  DatasetVersion,
  FirstLimitPullbackEvent,
} from "../types";
import {
  fileSizeAndSha256,
  validateDatasetSnapshot,
  type DatasetSnapshotStore,
} from "./store";
import type { DatasetMetadataReader } from "./contentDependencies";
import { withReadRetry } from "../../readRetry";

export const SNAPSHOT_EXPORT_PAGE_SIZE = 5_000;

export type SnapshotExportPhase =
  | "event"
  | "prefix"
  | "post"
  | "path"
  | "outcome"
  | "identity"
  | "index"
  | "verify";

export interface SnapshotExportEvent {
  phase: SnapshotExportPhase;
  event: "progress" | "completed" | "failed";
  message: string;
  datasetVersionId: number;
  rowsWritten?: number;
  totalRows?: number;
  table?: string;
  error?: string;
}

export interface DatasetSnapshotExporterDependencies {
  metadataReader: DatasetMetadataReader;
  reader: DatasetDataReader;
  store: DatasetSnapshotStore;
  identityResolver(
    datasetVersionId: number,
    events: readonly FirstLimitPullbackEvent[]
  ): Promise<ReadonlyMap<string, string>>;
  onEvent?: (event: SnapshotExportEvent) => void;
}

export interface ExportDatasetSnapshotOptions {
  datasetVersionId: number;
  force?: boolean;
}

export interface ExportDatasetSnapshotResult {
  datasetVersionId: number;
  manifest: DatasetSnapshotManifest;
  directory: string;
  sqlitePath: string;
  manifestPath: string;
}

interface RowAccumulator {
  rows: number;
  identityCount: number;
}

const CANONICAL_SECURITY_ID_PATTERN =
  /^sec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function emit(
  deps: DatasetSnapshotExporterDependencies,
  event: Omit<SnapshotExportEvent, "datasetVersionId">,
  datasetVersionId: number
): void {
  deps.onEvent?.({ ...event, datasetVersionId });
}

function begin(db: DatabaseSyncType): void {
  db.exec("BEGIN IMMEDIATE");
}

function discardUncommitted(db: DatabaseSyncType): void {
  try {
    if (db.isTransaction) db.exec("ROLLBACK");
  } catch {
    // A connection/transaction failure should never mask the original read error.
  }
}

/**
 * Run one page as a transaction. Only the DB read outside this helper is retried;
 * retrying the SQLite write would risk re-running already-committed side effects.
 */
function writeTransaction(db: DatabaseSyncType, write: () => void): void {
  discardUncommitted(db);
  begin(db);
  try {
    write();
    db.exec("COMMIT");
  } catch (error) {
    discardUncommitted(db);
    throw error;
  }
}

/** Deepest `cause` message; Drizzle hides the driver error (`ETIMEDOUT`) on the cause chain. */
function rootCauseMessage(error: unknown): string | null {
  let current: unknown = error;
  let deepest: string | null = null;
  const seen = new Set<unknown>();
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      deepest = current.message;
      current = (current as { cause?: unknown }).cause;
    } else {
      deepest = String(current);
      break;
    }
  }
  return deepest;
}

function resolveSupportedVersion(
  version: DatasetVersion | undefined,
  definition: DatasetDefinition | undefined,
  datasetVersionId: number
): {
  version: DatasetVersion & { id: number };
  definition: DatasetDefinition & { id: number };
} {
  if (!version) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_NOT_SUPPORTED",
      `[DatasetSnapshot] 未找到 dataset_version.id=${datasetVersionId}`
    );
  }
  if (version.id === undefined) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_NOT_SUPPORTED",
      `[DatasetSnapshot] dataset_version.id=${datasetVersionId} 缺少持久化 ID`
    );
  }
  if (version.status !== "READY") {
    throw new DatasetSnapshotError(
      "SNAPSHOT_NOT_SUPPORTED",
      `[DatasetSnapshot] dataset_version.id=${datasetVersionId} status=${version.status}，只有 READY 可导出`
    );
  }
  if (!definition || definition.id === undefined) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_NOT_SUPPORTED",
      `[DatasetSnapshot] dataset_version.id=${datasetVersionId} 的定义不存在或缺少 ID`
    );
  }
  if (definition.datasetCode !== "first_limit_pullback") {
    throw new DatasetSnapshotError(
      "SNAPSHOT_NOT_SUPPORTED",
      `[DatasetSnapshot] datasetCode=${JSON.stringify(definition.datasetCode)} 暂不支持；v1 仅支持 first_limit_pullback`
    );
  }
  return {
    version: version as DatasetVersion & { id: number },
    definition: definition as DatasetDefinition & { id: number },
  };
}

async function exportEvents(
  db: DatabaseSyncType,
  deps: DatasetSnapshotExporterDependencies,
  datasetVersionId: number,
  accumulator: RowAccumulator
): Promise<{ firstDate: string | null; lastDate: string | null }> {
  const insertIdentity = prepareSnapshotIdentityInsert(db);
  let cursor: { tradeDate: string; eventId: string } | null = null;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (;;) {
    const page = await withReadRetry(
      `datasetSnapshot.events dsv=${datasetVersionId}`,
      () =>
        deps.reader.listEventsPage({
          datasetVersionId,
          cursor,
          limit: SNAPSHOT_EXPORT_PAGE_SIZE,
        })
    );
    if (page.items.length === 0) break;
    const securityIds = await withReadRetry(
      `datasetSnapshot.identities dsv=${datasetVersionId}`,
      () => deps.identityResolver(datasetVersionId, page.items)
    );

    writeTransaction(db, () => {
      for (const event of page.items) {
        const securityId = securityIds.get(event.eventId);
        if (!securityId || !CANONICAL_SECURITY_ID_PATTERN.test(securityId)) {
          throw new DatasetSnapshotError(
            "SNAPSHOT_IDENTITY_MISSING",
            `[DatasetSnapshot] 事件 ${event.eventId} 无法解析唯一 canonical sec_<uuid>（得到 ${JSON.stringify(securityId ?? null)}）`
          );
        }
        insertIdentity.run(event.eventId, securityId);
      }
      insertSnapshotRows(db, "event", page.items);
    });
    accumulator.identityCount += page.items.length;
    accumulator.rows += page.items.length;
    firstDate ??= page.items[0]!.tradeDate;
    lastDate = page.items[page.items.length - 1]!.tradeDate;
    emit(
      deps,
      {
        phase: "event",
        event: "progress",
        message: `event 已导出 ${accumulator.rows} 行`,
        rowsWritten: accumulator.rows,
      },
      datasetVersionId
    );
    cursor = page.nextCursor ? decodeEventCursor(page.nextCursor) : null;
    if (!cursor) break;
  }
  return { firstDate, lastDate };
}

async function exportRawBars(
  db: DatabaseSyncType,
  deps: DatasetSnapshotExporterDependencies,
  datasetVersionId: number,
  role: "prefix" | "post",
  accumulator: RowAccumulator
): Promise<{ min: number | null; max: number | null }> {
  let cursor: { eventId: string; relativeDay: number } | null = null;
  let roleRows = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (;;) {
    const page = await withReadRetry(
      `datasetSnapshot.${role} dsv=${datasetVersionId}`,
      () =>
        deps.reader.listRawBarsPage(role, {
          datasetVersionId,
          cursor,
          limit: SNAPSHOT_EXPORT_PAGE_SIZE,
        })
    );
    if (page.items.length === 0) break;
    for (const row of page.items) {
      min = min === null ? row.relativeDay : Math.min(min, row.relativeDay);
      max = max === null ? row.relativeDay : Math.max(max, row.relativeDay);
    }

    writeTransaction(db, () => {
      insertSnapshotRows(db, role, page.items);
    });
    accumulator.rows += page.items.length;
    roleRows += page.items.length;
    emit(
      deps,
      {
        phase: role,
        event: "progress",
        message: `${role} 已累计导出 ${roleRows} 行`,
        rowsWritten: roleRows,
        table: role,
      },
      datasetVersionId
    );
    cursor = page.nextCursor ? decodePathCursor(page.nextCursor) : null;
    if (!cursor) break;
  }
  return { min, max };
}

async function exportPaths(
  db: DatabaseSyncType,
  deps: DatasetSnapshotExporterDependencies,
  datasetVersionId: number,
  accumulator: RowAccumulator
): Promise<{ min: number | null; max: number | null }> {
  let cursor: { eventId: string; relativeDay: number } | null = null;
  let roleRows = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (;;) {
    const page = await withReadRetry(
      `datasetSnapshot.paths dsv=${datasetVersionId}`,
      () =>
        deps.reader.listPathsPage({
          datasetVersionId,
          cursor,
          limit: SNAPSHOT_EXPORT_PAGE_SIZE,
        })
    );
    if (page.items.length === 0) break;
    for (const row of page.items) {
      min = min === null ? row.relativeDay : Math.min(min, row.relativeDay);
      max = max === null ? row.relativeDay : Math.max(max, row.relativeDay);
    }

    writeTransaction(db, () => {
      insertSnapshotRows(db, "path", page.items);
    });
    accumulator.rows += page.items.length;
    roleRows += page.items.length;
    emit(
      deps,
      {
        phase: "path",
        event: "progress",
        message: `path 已累计导出 ${roleRows} 行`,
        rowsWritten: roleRows,
        table: "path",
      },
      datasetVersionId
    );
    cursor = page.nextCursor ? decodePathCursor(page.nextCursor) : null;
    if (!cursor) break;
  }
  return { min, max };
}

async function exportOutcomes(
  db: DatabaseSyncType,
  deps: DatasetSnapshotExporterDependencies,
  datasetVersionId: number,
  accumulator: RowAccumulator
): Promise<number[]> {
  let cursor: { eventId: string; horizon: number } | null = null;
  let roleRows = 0;
  const horizons = new Set<number>();
  for (;;) {
    const page = await withReadRetry(
      `datasetSnapshot.outcomes dsv=${datasetVersionId}`,
      () =>
        deps.reader.listOutcomesPage({
          datasetVersionId,
          cursor,
          limit: SNAPSHOT_EXPORT_PAGE_SIZE,
        })
    );
    if (page.items.length === 0) break;
    for (const row of page.items) horizons.add(row.horizon);

    writeTransaction(db, () => {
      insertSnapshotRows(db, "outcome", page.items);
    });
    accumulator.rows += page.items.length;
    roleRows += page.items.length;
    emit(
      deps,
      {
        phase: "outcome",
        event: "progress",
        message: `outcome 已累计导出 ${roleRows} 行`,
        rowsWritten: roleRows,
        table: "outcome",
      },
      datasetVersionId
    );
    cursor = page.nextCursor ? decodeOutcomeCursor(page.nextCursor) : null;
    if (!cursor) break;
  }
  return [...horizons].sort((a, b) => a - b);
}

async function publishSnapshot(
  temporaryDirectory: string,
  finalDirectory: string,
  force: boolean
): Promise<void> {
  const backup = `${finalDirectory}.tmp-backup-${randomUUID()}`;
  let movedOld = false;
  try {
    if (force) {
      try {
        await rename(finalDirectory, backup);
        movedOld = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(temporaryDirectory, finalDirectory);
    if (movedOld) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedOld) {
      await rm(finalDirectory, { recursive: true, force: true }).catch(
        () => undefined
      );
      await rename(backup, finalDirectory).catch(() => undefined);
    }
    throw new DatasetSnapshotError(
      "SNAPSHOT_PUBLISH_FAILED",
      `[DatasetSnapshot] 发布快照失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export async function exportDatasetSnapshot(
  deps: DatasetSnapshotExporterDependencies,
  options: ExportDatasetSnapshotOptions
): Promise<ExportDatasetSnapshotResult> {
  const { datasetVersionId } = options;
  const storedVersion = await withReadRetry(
    `datasetSnapshot.getVersionById dsv=${datasetVersionId}`,
    () => deps.metadataReader.getVersionById(datasetVersionId)
  );
  const storedDefinition = storedVersion
    ? await withReadRetry(
        `datasetSnapshot.getDefinitionById datasetId=${storedVersion.datasetId}`,
        () => deps.metadataReader.getDefinitionById(storedVersion.datasetId)
      )
    : undefined;
  const { version, definition } = resolveSupportedVersion(
    storedVersion,
    storedDefinition,
    datasetVersionId
  );

  const finalDirectory = deps.store.versionDir(datasetVersionId);
  const temporaryDirectory = path.join(
    deps.store.rootDir(),
    `.tmp-${datasetVersionId}-${randomUUID()}`
  );
  await mkdir(path.dirname(finalDirectory), { recursive: true });
  await mkdir(temporaryDirectory, { recursive: true });
  const sqlitePath = path.join(temporaryDirectory, DATASET_SNAPSHOT_FILE_NAME);
  const manifestPath = path.join(
    temporaryDirectory,
    DATASET_SNAPSHOT_MANIFEST_FILE_NAME
  );
  const db = new DatabaseSync(sqlitePath, { timeout: 5_000 });
  const accumulator: RowAccumulator = { rows: 0, identityCount: 0 };
  const counts = {
    eventCount: 0,
    prefixCount: 0,
    postCount: 0,
    pathCount: 0,
    outcomeCount: 0,
  };

  try {
    createSnapshotSqliteSchema(db);
    const eventRange = await exportEvents(
      db,
      deps,
      datasetVersionId,
      accumulator
    );
    counts.eventCount = accumulator.rows;
    const rowsBeforePrefix = accumulator.rows;
    const prefixRange = await exportRawBars(
      db,
      deps,
      datasetVersionId,
      "prefix",
      accumulator
    );
    counts.prefixCount = accumulator.rows - rowsBeforePrefix;
    const rowsBeforePost = accumulator.rows;
    const postRange = await exportRawBars(
      db,
      deps,
      datasetVersionId,
      "post",
      accumulator
    );
    counts.postCount = accumulator.rows - rowsBeforePost;
    const rowsBeforePath = accumulator.rows;
    const pathRange = await exportPaths(
      db,
      deps,
      datasetVersionId,
      accumulator
    );
    counts.pathCount = accumulator.rows - rowsBeforePath;
    const rowsBeforeOutcome = accumulator.rows;
    const horizons = await exportOutcomes(
      db,
      deps,
      datasetVersionId,
      accumulator
    );
    counts.outcomeCount = accumulator.rows - rowsBeforeOutcome;

    emit(
      deps,
      {
        phase: "identity",
        event: "progress",
        message: `写入 ${accumulator.identityCount} 个事件身份`,
        rowsWritten: accumulator.identityCount,
      },
      datasetVersionId
    );

    emit(
      deps,
      { phase: "index", event: "progress", message: "执行 SQLite ANALYZE" },
      datasetVersionId
    );
    db.exec("ANALYZE");
    db.exec("PRAGMA optimize");

    emit(
      deps,
      {
        phase: "verify",
        event: "progress",
        message: "校验行数、日期范围、视界与 identity",
      },
      datasetVersionId
    );
    db.close();

    const { size, sha256 } = await fileSizeAndSha256(sqlitePath);
    const manifest: DatasetSnapshotManifest = {
      formatVersion: DATASET_SNAPSHOT_FORMAT_VERSION,
      exporterVersion: DATASET_SNAPSHOT_EXPORTER_VERSION,
      datasetVersionId,
      datasetId: version.datasetId,
      definition: {
        id: definition.id,
        datasetCode: definition.datasetCode,
        name: definition.name,
      },
      version: {
        id: version.id,
        datasetId: version.datasetId,
        label: version.version,
        status: "READY",
        startDate: version.startDate ?? null,
        endDate: version.endDate ?? null,
      },
      counts: {
        ...counts,
        rowCount:
          counts.eventCount +
          counts.prefixCount +
          counts.postCount +
          counts.pathCount +
          counts.outcomeCount,
        firstDate: eventRange.firstDate,
        lastDate: eventRange.lastDate,
        horizons,
      },
      firstDate: eventRange.firstDate,
      lastDate: eventRange.lastDate,
      horizons,
      pathRelativeDayRange:
        pathRange.min === null || pathRange.max === null
          ? null
          : { min: pathRange.min, max: pathRange.max },
      postRelativeDayRange:
        postRange.min === null || postRange.max === null
          ? null
          : { min: postRange.min, max: postRange.max },
      identityCount: accumulator.identityCount,
      sqlite: {
        fileName: DATASET_SNAPSHOT_FILE_NAME,
        size,
        sha256,
      },
      exportedAt: new Date().toISOString(),
    };

    await validateDatasetSnapshot({
      manifest,
      sqlitePath,
      expectedMetadata: { version, definition },
      sqliteSize: size,
      sha256,
    });
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    await publishSnapshot(
      temporaryDirectory,
      finalDirectory,
      options.force ?? false
    );
    deps.store.invalidate(datasetVersionId);
    emit(
      deps,
      {
        phase: "verify",
        event: "completed",
        message: `快照发布完成：${manifest.counts.rowCount} 行`,
        rowsWritten: manifest.counts.rowCount,
        totalRows: manifest.counts.rowCount,
      },
      datasetVersionId
    );
    return {
      datasetVersionId,
      manifest,
      directory: finalDirectory,
      sqlitePath: path.join(finalDirectory, DATASET_SNAPSHOT_FILE_NAME),
      manifestPath: path.join(
        finalDirectory,
        DATASET_SNAPSHOT_MANIFEST_FILE_NAME
      ),
    };
  } catch (error) {
    try {
      discardUncommitted(db);
      db.close();
    } catch {
      // Already closed after verification.
    }
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(
      () => undefined
    );
    const cause = rootCauseMessage(error);
    const detail = error instanceof Error ? error.message : String(error);
    const wrapped =
      error instanceof DatasetSnapshotError
        ? error
        : new DatasetSnapshotError(
            "SNAPSHOT_EXPORT_FAILED",
            `[DatasetSnapshot] 导出失败：${detail}${
              cause && cause !== detail ? `（根因：${cause}）` : ""
            }`,
            { cause: error }
          );
    emit(
      deps,
      {
        phase: "verify",
        event: "failed",
        message: wrapped.message,
        error: wrapped.message,
      },
      datasetVersionId
    );
    throw wrapped;
  }
}
