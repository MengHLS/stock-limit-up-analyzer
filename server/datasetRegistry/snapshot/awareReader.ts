import type {
  DatasetDataReader,
  DatasetVersionCounts,
  EventPageQuery,
  OutcomeBatchQuery,
  OutcomePageQuery,
  PathBatchQuery,
  PathPageQuery,
  RawBarBatchQuery,
  RawBarPageQuery,
} from "../query";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../types";
import type { DatasetPage } from "../../../shared/datasetRegistryContracts";
import type { DatasetRawBarRole } from "../query";
import { DatasetSnapshotError } from "./errors";
import { SnapshotSqliteReader } from "./sqliteReader";
import type { DatasetSnapshotStore } from "./store";
import { DatabaseSync, type DatabaseSync as DatabaseSyncType } from "./nodeSqlite";

const IDENTITY_BATCH_SIZE = 900;

export interface DatasetEventIdentityReader {
  resolveSecurityIdsByEvent(
    datasetVersionId: number,
    events: readonly FirstLimitPullbackEvent[],
  ): Promise<Map<string, string>>;
}

export type DatasetFallbackIdentityResolver = (
  datasetVersionId: number,
  events: readonly FirstLimitPullbackEvent[],
) => Promise<Map<string, string>>;

export interface SnapshotAwareDatasetDataReaderOptions {
  store: DatasetSnapshotStore;
  dbReader: DatasetDataReader;
  fallbackIdentityResolver?: DatasetFallbackIdentityResolver;
}

function deDuplicateIds(eventIds: readonly string[]): string[] {
  return [...new Set(eventIds)];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  if (values.length === 0) return [];
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

/**
 * Select a validated local SQLite snapshot when one exists, otherwise use the existing DB
 * reader. Snapshot integrity failures intentionally do not fall back.
 */
export class SnapshotAwareDatasetDataReader
  implements DatasetDataReader, DatasetEventIdentityReader
{
  private readonly store: DatasetSnapshotStore;
  private readonly dbReader: DatasetDataReader;
  private readonly fallbackIdentityResolver: DatasetFallbackIdentityResolver | undefined;

  constructor(options: SnapshotAwareDatasetDataReaderOptions) {
    this.store = options.store;
    this.dbReader = options.dbReader;
    this.fallbackIdentityResolver = options.fallbackIdentityResolver;
  }

  private async readerFor(datasetVersionId: number): Promise<DatasetDataReader> {
    const snapshot = await this.store.loadValid(datasetVersionId);
    return snapshot ? new SnapshotSqliteReader(snapshot.sqlitePath) : this.dbReader;
  }

  /**
   * 把一个 datasetVersion 的内容读取面固定在当前快照/DB 选择上。
   * 长窗口流式运行必须调用；否则运行中快照变为有效会让前后查询落到不同物理源。
   */
  async pinReader(datasetVersionId: number): Promise<DatasetDataReader> {
    return this.readerFor(datasetVersionId);
  }

  async getVersionCounts(datasetVersionId: number): Promise<DatasetVersionCounts> {
    return (await this.readerFor(datasetVersionId)).getVersionCounts(datasetVersionId);
  }

  async listEventsPage(query: EventPageQuery): Promise<DatasetPage<FirstLimitPullbackEvent>> {
    return (await this.readerFor(query.datasetVersionId)).listEventsPage(query);
  }

  async listRawBarsPage(
    role: DatasetRawBarRole,
    query: RawBarPageQuery,
  ): Promise<DatasetPage<FirstLimitPullbackRawBar>> {
    return (await this.readerFor(query.datasetVersionId)).listRawBarsPage(role, query);
  }

  async listPathsPage(query: PathPageQuery): Promise<DatasetPage<FirstLimitPullbackPath>> {
    return (await this.readerFor(query.datasetVersionId)).listPathsPage(query);
  }

  async listOutcomesPage(
    query: OutcomePageQuery,
  ): Promise<DatasetPage<FirstLimitPullbackOutcome>> {
    return (await this.readerFor(query.datasetVersionId)).listOutcomesPage(query);
  }

  async loadOutcomesBatch(query: OutcomeBatchQuery): Promise<FirstLimitPullbackOutcome[]> {
    return (await this.readerFor(query.datasetVersionId)).loadOutcomesBatch(query);
  }

  async loadPathsBatch(query: PathBatchQuery): Promise<FirstLimitPullbackPath[]> {
    return (await this.readerFor(query.datasetVersionId)).loadPathsBatch(query);
  }

  async loadRawBarsBatch(
    role: DatasetRawBarRole,
    query: RawBarBatchQuery,
  ): Promise<FirstLimitPullbackRawBar[]> {
    return (await this.readerFor(query.datasetVersionId)).loadRawBarsBatch(role, query);
  }

  async getPathRelativeDayRange(
    datasetVersionId: number,
  ): Promise<{ min: number; max: number } | null> {
    return (await this.readerFor(datasetVersionId)).getPathRelativeDayRange(datasetVersionId);
  }

  async getPostRelativeDayRange(
    datasetVersionId: number,
  ): Promise<{ min: number; max: number } | null> {
    return (await this.readerFor(datasetVersionId)).getPostRelativeDayRange(datasetVersionId);
  }

  async resolveSecurityIdsByEvent(
    datasetVersionId: number,
    events: readonly FirstLimitPullbackEvent[],
  ): Promise<Map<string, string>> {
    if (events.length === 0) return new Map();
    const snapshot = await this.store.loadValid(datasetVersionId);
    if (!snapshot) {
      if (!this.fallbackIdentityResolver) {
        throw new DatasetSnapshotError(
          "SNAPSHOT_NOT_FOUND",
          `[DatasetSnapshot] ${datasetVersionId} 无本地快照，且未配置 DB identity resolver`,
        );
      }
      return this.fallbackIdentityResolver(datasetVersionId, events);
    }

    let db: DatabaseSyncType | null = null;
    try {
      db = new DatabaseSync(snapshot.sqlitePath, { readOnly: true, timeout: 5_000 });
      db.exec("PRAGMA query_only = ON");
      const resolved = new Map<string, string>();
      for (const batch of chunks(deDuplicateIds(events.map((event) => event.eventId)), IDENTITY_BATCH_SIZE)) {
        const rows = db
          .prepare(
            `SELECT "event_id" AS eventId, "security_id" AS securityId FROM "event_identity" WHERE "event_id" IN (${batch
              .map(() => "?")
              .join(", ")})`,
          )
          .all(...batch) as Array<{ eventId: string; securityId: string }>;
        for (const row of rows) resolved.set(row.eventId, row.securityId);
      }
      const missing = events
        .map((event) => event.eventId)
        .filter((eventId) => !resolved.has(eventId));
      if (missing.length > 0) {
        throw new DatasetSnapshotError(
          "SNAPSHOT_IDENTITY_MISSING",
          `[DatasetSnapshot] ${datasetVersionId} 缺少 ${missing.length} 个事件身份，首个=${missing[0]}`,
        );
      }
      return resolved;
    } finally {
      db?.close();
    }
  }
}
