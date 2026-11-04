import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DatasetDefinition, DatasetVersion } from "../types";
import type { DatasetVersionCounts } from "../query";
import {
  DATASET_SNAPSHOT_FILE_NAME,
  DATASET_SNAPSHOT_FORMAT_VERSION,
  DATASET_SNAPSHOT_MANIFEST_FILE_NAME,
  parseDatasetSnapshotManifest,
  type DatasetSnapshotManifest,
} from "./manifest";
import { DatabaseSync, type DatabaseSync as DatabaseSyncType } from "./nodeSqlite";
import { SNAPSHOT_TABLE_DEFINITIONS } from "./sqliteSchema";
import { DatasetSnapshotError } from "./errors";
import {
  datasetSnapshotManifestPath,
  datasetSnapshotRoot,
  datasetSnapshotSqlitePath,
  datasetSnapshotVersionDir,
  isTemporarySnapshotDirectory,
} from "./paths";

export interface SnapshotMetadataExpectation {
  version: DatasetVersion;
  definition: DatasetDefinition;
}

export interface ValidatedDatasetSnapshot {
  datasetVersionId: number;
  manifest: DatasetSnapshotManifest;
  manifestPath: string;
  sqlitePath: string;
  sqliteSize: number;
  manifestMtimeMs: number;
  sqliteMtimeMs: number;
}

interface SnapshotFacts {
  counts: DatasetVersionCounts;
  identityCount: number;
  tableNames: Set<string>;
  columnsByTable: Map<string, Array<{ name: string; type: string }>>;
  indexesByTable: Map<
    string,
    Array<{ name: string; unique: boolean; columns: string[] }>
  >;
  pathRelativeDayRange: { min: number; max: number } | null;
  postRelativeDayRange: { min: number; max: number } | null;
}

function asError(cause: unknown): DatasetSnapshotError {
  return cause instanceof DatasetSnapshotError
    ? cause
    : new DatasetSnapshotError("SNAPSHOT_INVALID", cause instanceof Error ? cause.message : String(cause), {
        cause,
      });
}

function assertManifestVector(
  datasetVersionId: number,
  actual: readonly number[],
  expected: readonly number[],
  field: string,
): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_COUNT_MISMATCH",
      `[DatasetSnapshot] ${datasetVersionId} ${field} 与 SQLite 不一致：manifest=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }
}

function assertSnapshotCounts(
  datasetVersionId: number,
  manifest: DatasetSnapshotManifest,
  facts: SnapshotFacts,
): void {
  const expected = manifest.counts;
  const actual = facts.counts;
  const fields: Array<keyof DatasetVersionCounts> = [
    "eventCount",
    "prefixCount",
    "postCount",
    "pathCount",
    "outcomeCount",
    "rowCount",
    "firstDate",
    "lastDate",
  ];
  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      throw new DatasetSnapshotError(
        "SNAPSHOT_COUNT_MISMATCH",
        `[DatasetSnapshot] ${datasetVersionId} ${field} 与 SQLite 不一致：manifest=${String(expected[field])} actual=${String(actual[field])}`,
      );
    }
  }
  assertManifestVector(datasetVersionId, actual.horizons, expected.horizons, "horizons");
  assertManifestVector(datasetVersionId, manifest.horizons, expected.horizons, "manifest.horizons");
  assertManifestVector(datasetVersionId, actual.horizons, manifest.horizons, "horizons");
  if (manifest.firstDate !== expected.firstDate || manifest.lastDate !== expected.lastDate) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_COUNT_MISMATCH",
      `[DatasetSnapshot] ${datasetVersionId} 顶层日期范围与 counts 不一致`,
    );
  }
  if (facts.identityCount !== manifest.identityCount) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_IDENTITY_MISSING",
      `[DatasetSnapshot] ${datasetVersionId} identityCount 不一致：manifest=${manifest.identityCount} actual=${facts.identityCount}`,
    );
  }
  if (facts.identityCount !== actual.eventCount) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_IDENTITY_MISSING",
      `[DatasetSnapshot] ${datasetVersionId} event_identity=${facts.identityCount} 与 event=${actual.eventCount} 不一致`,
    );
  }
  for (const field of ["pathRelativeDayRange", "postRelativeDayRange"] as const) {
    const actualRange = facts[field];
    const expectedRange = manifest[field];
    if (
      actualRange?.min !== expectedRange?.min ||
      actualRange?.max !== expectedRange?.max
    ) {
      throw new DatasetSnapshotError(
        "SNAPSHOT_COUNT_MISMATCH",
        `[DatasetSnapshot] ${datasetVersionId} ${field} 与 SQLite 不一致`,
      );
    }
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * manifest 的「固定字段」校验：formatVersion 与 SQLite 文件名必须与本实现一致。
 *
 * 抽出来单独用是必要的：缓存命中时也要跑一遍。否则「同一个 mtime/size 但换了 manifest」
 * 的边界（手改 manifest / 时间戳精度不足）会被缓存绕过。
 */
export function assertSnapshotManifestEnvelope(
  manifest: DatasetSnapshotManifest,
): void {
  if (manifest.formatVersion !== DATASET_SNAPSHOT_FORMAT_VERSION) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_MANIFEST_INVALID",
      `[DatasetSnapshot] 不支持的 formatVersion=${String(manifest.formatVersion)}`,
    );
  }
  if (manifest.sqlite.fileName !== DATASET_SNAPSHOT_FILE_NAME) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_MANIFEST_INVALID",
      `[DatasetSnapshot] manifest.sqlite.fileName=${JSON.stringify(manifest.sqlite.fileName)}，期望 ${DATASET_SNAPSHOT_FILE_NAME}`,
    );
  }
}

function assertSnapshotIndexes(
  datasetVersionId: number,
  columnsByTable: Map<string, Array<{ name: string; type: string }>>,
  indexesByTable: Map<string, Array<{ name: string; unique: boolean; columns: string[] }>>,
): void {
  for (const definition of SNAPSHOT_TABLE_DEFINITIONS) {
    const actual = indexesByTable.get(definition.name) ?? [];
    for (const expected of definition.indexes) {
      const match = actual.find((index) => index.name === expected.name);
      if (!match) {
        throw new DatasetSnapshotError(
          "SNAPSHOT_SCHEMA_INVALID",
          `[DatasetSnapshot] ${datasetVersionId} 表 "${definition.name}" 缺少索引 "${expected.name}"`,
        );
      }
      if (match.unique !== (expected.unique ?? false)) {
        throw new DatasetSnapshotError(
          "SNAPSHOT_SCHEMA_INVALID",
          `[DatasetSnapshot] ${datasetVersionId} 索引 "${expected.name}" unique=${match.unique}，期望 ${expected.unique ?? false}`,
        );
      }
      if (
        match.columns.length !== expected.columns.length ||
        match.columns.some((column, index) => column !== expected.columns[index])
      ) {
        throw new DatasetSnapshotError(
          "SNAPSHOT_SCHEMA_INVALID",
          `[DatasetSnapshot] ${datasetVersionId} 索引 "${expected.name}" 列=${JSON.stringify(match.columns)}，期望 ${JSON.stringify(expected.columns)}`,
        );
      }
    }
    if (definition.name === "event_identity") continue;
    // 自增主键必须仍然落在 `id` 上：否则 COUNT/keyset 语义虽不受影响，但插入会静默改主键语义。
    const columns = columnsByTable.get(definition.name) ?? [];
    const idColumn = columns.find((column) => column.name === "id") as
      | { name: string; type: string; pk?: number }
      | undefined;
    if (!idColumn || (idColumn as { pk?: number }).pk !== 1) {
      throw new DatasetSnapshotError(
        "SNAPSHOT_SCHEMA_INVALID",
        `[DatasetSnapshot] ${datasetVersionId} 表 "${definition.name}" 主键不是 id`,
      );
    }
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function readSnapshotFacts(dbPath: string, datasetVersionId: number): SnapshotFacts {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5_000 });
  try {
    db.exec("PRAGMA query_only = ON");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((row) => row.name));
    const columnsByTable = new Map<string, Array<{ name: string; type: string }>>();
    const indexesByTable = new Map<
      string,
      Array<{ name: string; unique: boolean; columns: string[] }>
    >();

    for (const definition of SNAPSHOT_TABLE_DEFINITIONS) {
      if (!tableNames.has(definition.name)) {
        throw new DatasetSnapshotError(
          "SNAPSHOT_SCHEMA_INVALID",
          `[DatasetSnapshot] SQLite 缺少表 "${definition.name}"`,
        );
      }
      const columns = db
        .prepare(`PRAGMA table_info(${quoteIdentifier(definition.name)})`)
        .all() as Array<{ name: string; type: string }>;
      columnsByTable.set(definition.name, columns);
      const actualByName = new Map(columns.map((column) => [column.name, column.type.toUpperCase()]));
      for (const expected of definition.columns) {
        if (!actualByName.has(expected.name)) {
          throw new DatasetSnapshotError(
            "SNAPSHOT_SCHEMA_INVALID",
            `[DatasetSnapshot] 表 "${definition.name}" 缺少列 "${expected.name}"`,
          );
        }
        if (expected.name === "id" && definition.name !== "event_identity") continue;
        const expectedType =
          expected.kind === "number"
            ? "REAL"
            : expected.kind === "text" ||
                expected.kind === "date" ||
                expected.kind === "time" ||
                expected.kind === "timestamp"
              ? "TEXT"
              : "INTEGER";
        const actualType = actualByName.get(expected.name);
        if (actualType !== expectedType && !(expected.name === "id" && actualType === "INTEGER")) {
          throw new DatasetSnapshotError(
            "SNAPSHOT_SCHEMA_INVALID",
            `[DatasetSnapshot] 表 "${definition.name}" 列 "${expected.name}" 类型=${actualType}，期望 ${expectedType}`,
          );
        }
      }
      const indexRows = db
        .prepare(`PRAGMA index_list(${quoteIdentifier(definition.name)})`)
        .all() as Array<{ name: string; unique: number }>;
      indexesByTable.set(
        definition.name,
        indexRows.map((index) => {
          const columnRows = db
            .prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
            .all() as Array<{ name: string | null; seqno: number }>;
          return {
            name: index.name,
            unique: Number(index.unique) === 1,
            columns: columnRows
              .filter((column): column is { name: string; seqno: number } => column.name !== null)
              .sort((a, b) => a.seqno - b.seqno)
              .map((column) => column.name),
          };
        }),
      );
    }
    assertSnapshotIndexes(datasetVersionId, columnsByTable, indexesByTable);

    const counts = {} as Record<"event" | "prefix" | "post" | "path" | "outcome", number>;
    for (const role of ["event", "prefix", "post", "path", "outcome"] as const) {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(role)} WHERE "datasetVersionId" = ?`)
        .get(datasetVersionId) as { n: number } | undefined;
      counts[role] = Number(row?.n ?? 0);
    }
    const eventAgg = db
      .prepare(
        'SELECT MIN("tradeDate") AS firstDate, MAX("tradeDate") AS lastDate FROM "event" WHERE "datasetVersionId" = ?',
      )
      .get(datasetVersionId) as { firstDate: string | null; lastDate: string | null } | undefined;
    const horizons = (
      db
        .prepare(
          'SELECT DISTINCT "horizon" AS horizon FROM "outcome" WHERE "datasetVersionId" = ? ORDER BY "horizon" ASC',
        )
        .all(datasetVersionId) as Array<{ horizon: number }>
    ).map((row) => Number(row.horizon));
    const pathRange = db
      .prepare(
        'SELECT MIN("relativeDay") AS min, MAX("relativeDay") AS max FROM "path" WHERE "datasetVersionId" = ?',
      )
      .get(datasetVersionId) as { min: number | null; max: number | null } | undefined;
    const postRange = db
      .prepare(
        'SELECT MIN("relativeDay") AS min, MAX("relativeDay") AS max FROM "post" WHERE "datasetVersionId" = ?',
      )
      .get(datasetVersionId) as { min: number | null; max: number | null } | undefined;
    const identityCount = Number(
      (
        db.prepare("SELECT COUNT(*) AS n FROM event_identity").get() as
          | { n: number }
          | undefined
      )?.n ?? 0,
    );

    return {
      counts: {
        eventCount: counts.event,
        prefixCount: counts.prefix,
        postCount: counts.post,
        pathCount: counts.path,
        outcomeCount: counts.outcome,
        rowCount: counts.event + counts.prefix + counts.post + counts.path + counts.outcome,
        firstDate: eventAgg?.firstDate ?? null,
        lastDate: eventAgg?.lastDate ?? null,
        horizons,
      },
      identityCount,
      tableNames,
      columnsByTable,
      indexesByTable,
      pathRelativeDayRange:
        pathRange?.min === null || pathRange?.min === undefined || pathRange.max === null || pathRange.max === undefined
          ? null
          : { min: Number(pathRange.min), max: Number(pathRange.max) },
      postRelativeDayRange:
        postRange?.min === null || postRange?.min === undefined || postRange.max === null || postRange.max === undefined
          ? null
          : { min: Number(postRange.min), max: Number(postRange.max) },
    };
  } finally {
    db.close();
  }
}

export function assertManifestMatchesMetadata(
  manifest: DatasetSnapshotManifest,
  expected: SnapshotMetadataExpectation,
): void {
  const versionId = expected.version.id;
  const definitionId = expected.definition.id;
  if (
    versionId === undefined ||
    definitionId === undefined ||
    manifest.datasetVersionId !== versionId ||
    manifest.datasetId !== expected.version.datasetId ||
    manifest.version.id !== versionId ||
    manifest.version.label !== expected.version.version ||
    manifest.version.status !== expected.version.status ||
    manifest.definition.id !== definitionId ||
    manifest.definition.datasetCode !== expected.definition.datasetCode
  ) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_VERSION_MISMATCH",
      `[DatasetSnapshot] manifest 元数据与 dataset_version.id=${versionId} 不一致`,
    );
  }
}

export interface DatasetSnapshotValidationOptions {
  manifest: DatasetSnapshotManifest;
  sqlitePath: string;
  expectedMetadata?: SnapshotMetadataExpectation;
  sqliteSize?: number;
  sha256?: string;
}

export async function validateDatasetSnapshot(
  options: DatasetSnapshotValidationOptions,
): Promise<{ manifest: DatasetSnapshotManifest; facts: SnapshotFacts }> {
  const { manifest, sqlitePath } = options;
  assertSnapshotManifestEnvelope(manifest);
  if (options.expectedMetadata) assertManifestMatchesMetadata(manifest, options.expectedMetadata);

  const fileStat = await stat(sqlitePath).catch((cause: unknown) => {
    throw new DatasetSnapshotError("SNAPSHOT_NOT_FOUND", `[DatasetSnapshot] SQLite 文件不存在：${sqlitePath}`, {
      cause,
    });
  });
  if (!fileStat.isFile()) {
    throw new DatasetSnapshotError("SNAPSHOT_INVALID", `[DatasetSnapshot] SQLite 路径不是文件：${sqlitePath}`);
  }
  const actualSize = options.sqliteSize ?? fileStat.size;
  if (fileStat.size !== actualSize || manifest.sqlite.size !== actualSize) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_COUNT_MISMATCH",
      `[DatasetSnapshot] SQLite 大小不一致：manifest=${manifest.sqlite.size} stat=${fileStat.size}`,
    );
  }
  const actualSha256 = options.sha256 ?? (await sha256File(sqlitePath));
  if (actualSha256.toLowerCase() !== manifest.sqlite.sha256.toLowerCase()) {
    throw new DatasetSnapshotError(
      "SNAPSHOT_CHECKSUM_MISMATCH",
      `[DatasetSnapshot] SQLite SHA-256 不一致：manifest=${manifest.sqlite.sha256} actual=${actualSha256}`,
    );
  }
  const facts = readSnapshotFacts(sqlitePath, manifest.datasetVersionId);
  assertSnapshotCounts(manifest.datasetVersionId, manifest, facts);
  return { manifest, facts };
}

export class DatasetSnapshotStore {
  private readonly validated = new Map<string, ValidatedDatasetSnapshot>();

  constructor(private readonly cwd = process.cwd()) {}

  rootDir(): string {
    return datasetSnapshotRoot(this.cwd);
  }

  versionDir(datasetVersionId: number): string {
    return datasetSnapshotVersionDir(datasetVersionId, this.cwd);
  }

  manifestPath(datasetVersionId: number): string {
    return datasetSnapshotManifestPath(datasetVersionId, this.cwd);
  }

  sqlitePath(datasetVersionId: number): string {
    return datasetSnapshotSqlitePath(datasetVersionId, this.cwd);
  }

  async loadValid(
    datasetVersionId: number,
    expectedMetadata?: SnapshotMetadataExpectation,
  ): Promise<ValidatedDatasetSnapshot | null> {
    // `.tmp-*` 是发布过程中的未完成目录，绝不参与自动读取（即使是同名的 .tmp-<id>）。
    const versionDirName = path.basename(this.versionDir(datasetVersionId));
    if (isTemporarySnapshotDirectory(versionDirName)) return null;

    const manifestPath = this.manifestPath(datasetVersionId);
    const sqlitePath = this.sqlitePath(datasetVersionId);
    const [manifestStat, sqliteStat] = await Promise.all([
      stat(manifestPath).catch(() => null),
      stat(sqlitePath).catch(() => null),
    ]);
    if (!manifestStat && !sqliteStat) return null;
    if (!manifestStat || !sqliteStat || !manifestStat.isFile() || !sqliteStat.isFile()) {
      throw new DatasetSnapshotError(
        "SNAPSHOT_INVALID",
        `[DatasetSnapshot] ${datasetVersionId} 快照目录残缺：manifest 与 dataset.sqlite 必须同时存在`,
      );
    }

    const cacheKey = `${manifestPath}:${manifestStat.mtimeMs}:${sqlitePath}:${sqliteStat.size}:${sqliteStat.mtimeMs}`;
    const cached = this.validated.get(cacheKey);
    if (cached) {
      // 缓存命中也要校验固定字段 + 元数据：磁盘上的 mtime/size 可能被伪造或精度不足。
      assertSnapshotManifestEnvelope(cached.manifest);
      if (cached.manifest.datasetVersionId !== datasetVersionId || cached.manifest.version.id !== datasetVersionId) {
        throw new DatasetSnapshotError(
          "SNAPSHOT_VERSION_MISMATCH",
          `[DatasetSnapshot] manifest.datasetVersionId=${cached.manifest.datasetVersionId} / version.id=${cached.manifest.version.id}，期望 ${datasetVersionId}`,
        );
      }
      if (expectedMetadata) assertManifestMatchesMetadata(cached.manifest, expectedMetadata);
      return cached;
    }

    try {
      const manifest = parseDatasetSnapshotManifest(
        JSON.parse(await readFile(manifestPath, "utf8")),
      );
      if (manifest.datasetVersionId !== datasetVersionId || manifest.version.id !== datasetVersionId) {
        throw new DatasetSnapshotError(
          "SNAPSHOT_VERSION_MISMATCH",
          `[DatasetSnapshot] manifest.datasetVersionId=${manifest.datasetVersionId} / version.id=${manifest.version.id}，期望 ${datasetVersionId}`,
        );
      }
      await validateDatasetSnapshot({
        manifest,
        sqlitePath,
        ...(expectedMetadata ? { expectedMetadata } : {}),
      });
      const validated: ValidatedDatasetSnapshot = {
        datasetVersionId,
        manifest,
        manifestPath,
        sqlitePath,
        sqliteSize: sqliteStat.size,
        manifestMtimeMs: manifestStat.mtimeMs,
        sqliteMtimeMs: sqliteStat.mtimeMs,
      };
      this.validated.set(cacheKey, validated);
      return validated;
    } catch (error) {
      throw asError(error);
    }
  }

  async inspect(
    datasetVersionId: number,
    expectedMetadata?: SnapshotMetadataExpectation,
  ): Promise<ValidatedDatasetSnapshot | null> {
    return this.loadValid(datasetVersionId, expectedMetadata);
  }

  invalidate(datasetVersionId: number): void {
    const prefix = this.versionDir(datasetVersionId);
    for (const key of this.validated.keys()) {
      if (key.startsWith(prefix)) this.validated.delete(key);
    }
  }

  async ensureVersionDirectory(datasetVersionId: number): Promise<string> {
    const directory = this.versionDir(datasetVersionId);
    await mkdir(path.dirname(directory), { recursive: true });
    return directory;
  }

  async readManifest(datasetVersionId: number): Promise<DatasetSnapshotManifest | null> {
    try {
      const raw = await readFile(this.manifestPath(datasetVersionId), "utf8");
      return parseDatasetSnapshotManifest(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw asError(error);
    }
  }

  async openSqlite(datasetVersionId: number): Promise<DatabaseSyncType> {
    const db = new DatabaseSync(this.sqlitePath(datasetVersionId), {
      readOnly: true,
      timeout: 5_000,
    });
    db.exec("PRAGMA query_only = ON");
    return db;
  }
}

export async function fileSizeAndSha256(filePath: string): Promise<{ size: number; sha256: string }> {
  const handle = await open(filePath, "r");
  try {
    const fileStat = await handle.stat();
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return { size: fileStat.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}
