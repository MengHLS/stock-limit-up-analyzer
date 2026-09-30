import {
  compareOutcomeKeys,
  comparePathKeys,
  eventRowToDomain,
  outcomeRowToDomain,
  pathRowToDomain,
  rawBarRowToDomain,
  type ColumnProjection,
  type DatasetDataReader,
  type DatasetVersionCounts,
  type EventPageQuery,
  type OutcomeBatchQuery,
  type OutcomePageQuery,
  type PathBatchQuery,
  type PathPageQuery,
  type RawBarBatchQuery,
  type RawBarPageQuery,
} from "../query";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../types";
import type { DatasetPage } from "../../../shared/datasetRegistryContracts";
import {
  DatabaseSync,
  type DatabaseSync as DatabaseSyncType,
} from "./nodeSqlite";
import {
  SNAPSHOT_CONTENT_ROLES,
  snapshotTableColumns,
  type SnapshotContentRole,
} from "./sqliteSchema";

type SnapshotRow = Record<string, unknown>;

const MAX_SQLITE_BIND_VALUES = 900;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function resolveColumns(role: SnapshotContentRole, columns: ColumnProjection | undefined): {
  names: readonly string[];
  sql: string;
  selected: Set<string> | null;
} {
  const allowed = snapshotTableColumns(role);
  if (!columns || columns.length === 0) {
    return { names: allowed, sql: "*", selected: null };
  }
  const selected = new Set<string>();
  for (const column of columns) {
    if (!allowed.includes(column)) {
      throw new Error(`[DatasetSnapshot] unknown column "${column}" for snapshot table "${role}"`);
    }
    selected.add(column);
  }
  return {
    names: [...selected],
    sql: [...selected].map(quoteIdentifier).join(", "),
    selected,
  };
}

function applyProjection<T extends object>(row: T, selected: Set<string> | null): T {
  if (selected === null) return row;
  const projected = { ...row } as Record<string, unknown>;
  for (const key of Object.keys(projected)) {
    if (!selected.has(key)) delete projected[key];
  }
  return projected as T;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  if (values.length === 0) return [];
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function appendInCondition(
  conditions: string[],
  params: Array<string | number>,
  column: string,
  values: readonly string[] | readonly number[],
): void {
  if (values.length === 0) return;
  conditions.push(`${quoteIdentifier(column)} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

function mapEventRow(row: SnapshotRow, selected: Set<string> | null): FirstLimitPullbackEvent {
  return applyProjection(eventRowToDomain(row as never), selected);
}

function mapPathRow(row: SnapshotRow, selected: Set<string> | null): FirstLimitPullbackPath {
  return applyProjection(pathRowToDomain(row as never), selected);
}

function mapOutcomeRow(row: SnapshotRow, selected: Set<string> | null): FirstLimitPullbackOutcome {
  return applyProjection(outcomeRowToDomain(row as never), selected);
}

function mapRawBarRow(row: SnapshotRow, selected: Set<string> | null): FirstLimitPullbackRawBar {
  return applyProjection(rawBarRowToDomain(row as never), selected);
}

function eventSortKey(row: FirstLimitPullbackEvent): string {
  return `${row.tradeDate}\u0000${row.eventId}`;
}

/**
 * Synchronous SQLite implementation behind the existing async DatasetDataReader contract.
 *
 * It uses the same domain row mappers and keyset cursor shapes as DbDatasetDataReader;
 * the snapshot is immutable, so no retry / cache invalidation exists at this layer.
 */
export class SnapshotSqliteReader implements DatasetDataReader {
  constructor(private readonly dbPath: string) {}

  private withDatabase<T>(read: (db: DatabaseSyncType) => T): T {
    const db = new DatabaseSync(this.dbPath, { readOnly: true, timeout: 5_000 });
    try {
      db.exec("PRAGMA query_only = ON");
      return read(db);
    } finally {
      // Windows blocks replacing a snapshot while a SQLite handle is open.
      // Opening read-only per operation keeps publication/cleanup atomic.
      db.close();
    }
  }

  async getVersionCounts(datasetVersionId: number): Promise<DatasetVersionCounts> {
    return this.withDatabase((db) => {
      const counts = {} as Record<SnapshotContentRole, number>;
      for (const role of SNAPSHOT_CONTENT_ROLES) {
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
      const horizonRows = db
        .prepare(
          'SELECT DISTINCT "horizon" AS horizon FROM "outcome" WHERE "datasetVersionId" = ? ORDER BY "horizon" ASC',
        )
        .all(datasetVersionId) as Array<{ horizon: number }>;
      return {
        eventCount: counts.event,
        prefixCount: counts.prefix,
        postCount: counts.post,
        pathCount: counts.path,
        outcomeCount: counts.outcome,
        rowCount: counts.event + counts.prefix + counts.post + counts.path + counts.outcome,
        firstDate: eventAgg?.firstDate ?? null,
        lastDate: eventAgg?.lastDate ?? null,
        horizons: horizonRows.map((row) => Number(row.horizon)),
      };
    });
  }

  async listEventsPage(query: EventPageQuery): Promise<DatasetPage<FirstLimitPullbackEvent>> {
    const projection = resolveColumns("event", query.columns);
    const conditions = ['"datasetVersionId" = ?'];
    const params: Array<string | number> = [query.datasetVersionId];
    if (query.fromDate) {
      conditions.push('"tradeDate" >= ?');
      params.push(query.fromDate);
    }
    if (query.toDate) {
      conditions.push('"tradeDate" <= ?');
      params.push(query.toDate);
    }
    if (query.cursor) {
      conditions.push('("tradeDate" > ? OR ("tradeDate" = ? AND "eventId" > ?))');
      params.push(query.cursor.tradeDate, query.cursor.tradeDate, query.cursor.eventId);
    }
    params.push(query.limit + 1);
    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `SELECT ${projection.sql} FROM "event" WHERE ${conditions.join(" AND ")} ORDER BY "tradeDate" ASC, "eventId" ASC LIMIT ?`,
        )
        .all(...params) as SnapshotRow[];
      const items = rows.map((row) => mapEventRow(row, projection.selected));
      const hasMore = items.length > query.limit;
      const page = hasMore ? items.slice(0, query.limit) : items;
      const last = page[page.length - 1];
      return {
        items: page,
        nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ tradeDate: last.tradeDate, eventId: last.eventId })).toString("base64url") : null,
      };
    });
  }

  async listRawBarsPage(
    role: "prefix" | "post",
    query: RawBarPageQuery,
  ): Promise<DatasetPage<FirstLimitPullbackRawBar>> {
    const projection = resolveColumns(role, query.columns);
    const conditions = ['"datasetVersionId" = ?'];
    const params: Array<string | number> = [query.datasetVersionId];
    if (query.eventId) {
      conditions.push('"eventId" = ?');
      params.push(query.eventId);
    }
    if (query.fromDate) {
      conditions.push('"tradeDate" >= ?');
      params.push(query.fromDate);
    }
    if (query.toDate) {
      conditions.push('"tradeDate" <= ?');
      params.push(query.toDate);
    }
    if (query.cursor) {
      conditions.push('("eventId" > ? OR ("eventId" = ? AND "relativeDay" > ?))');
      params.push(query.cursor.eventId, query.cursor.eventId, query.cursor.relativeDay);
    }
    params.push(query.limit + 1);
    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `SELECT ${projection.sql} FROM ${quoteIdentifier(role)} WHERE ${conditions.join(" AND ")} ORDER BY "eventId" ASC, "relativeDay" ASC LIMIT ?`,
        )
        .all(...params) as SnapshotRow[];
      const items = rows.map((row) => mapRawBarRow(row, projection.selected));
      const hasMore = items.length > query.limit;
      const page = hasMore ? items.slice(0, query.limit) : items;
      const last = page[page.length - 1];
      return {
        items: page,
        nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ eventId: last.eventId, relativeDay: last.relativeDay })).toString("base64url") : null,
      };
    });
  }

  async listPathsPage(query: PathPageQuery): Promise<DatasetPage<FirstLimitPullbackPath>> {
    const projection = resolveColumns("path", query.columns);
    const conditions = ['"datasetVersionId" = ?'];
    const params: Array<string | number> = [query.datasetVersionId];
    if (query.eventId) {
      conditions.push('"eventId" = ?');
      params.push(query.eventId);
    }
    if (query.fromDate) {
      conditions.push('"tradeDate" >= ?');
      params.push(query.fromDate);
    }
    if (query.toDate) {
      conditions.push('"tradeDate" <= ?');
      params.push(query.toDate);
    }
    if (query.cursor) {
      conditions.push('("eventId" > ? OR ("eventId" = ? AND "relativeDay" > ?))');
      params.push(query.cursor.eventId, query.cursor.eventId, query.cursor.relativeDay);
    }
    params.push(query.limit + 1);
    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `SELECT ${projection.sql} FROM "path" WHERE ${conditions.join(" AND ")} ORDER BY "eventId" ASC, "relativeDay" ASC LIMIT ?`,
        )
        .all(...params) as SnapshotRow[];
      const items = rows.map((row) => mapPathRow(row, projection.selected));
      const hasMore = items.length > query.limit;
      const page = hasMore ? items.slice(0, query.limit) : items;
      const last = page[page.length - 1];
      return {
        items: page,
        nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ eventId: last.eventId, relativeDay: last.relativeDay })).toString("base64url") : null,
      };
    });
  }

  async listOutcomesPage(query: OutcomePageQuery): Promise<DatasetPage<FirstLimitPullbackOutcome>> {
    const projection = resolveColumns("outcome", query.columns);
    const conditions = ['"datasetVersionId" = ?'];
    const params: Array<string | number> = [query.datasetVersionId];
    if (query.eventId) {
      conditions.push('"eventId" = ?');
      params.push(query.eventId);
    }
    if (query.horizon !== undefined) {
      conditions.push('"horizon" = ?');
      params.push(query.horizon);
    }
    if (query.cursor) {
      conditions.push('("eventId" > ? OR ("eventId" = ? AND "horizon" > ?))');
      params.push(query.cursor.eventId, query.cursor.eventId, query.cursor.horizon);
    }
    params.push(query.limit + 1);
    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `SELECT ${projection.sql} FROM "outcome" WHERE ${conditions.join(" AND ")} ORDER BY "eventId" ASC, "horizon" ASC LIMIT ?`,
        )
        .all(...params) as SnapshotRow[];
      const items = rows.map((row) => mapOutcomeRow(row, projection.selected));
      const hasMore = items.length > query.limit;
      const page = hasMore ? items.slice(0, query.limit) : items;
      const last = page[page.length - 1];
      return {
        items: page,
        nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ eventId: last.eventId, horizon: last.horizon })).toString("base64url") : null,
      };
    });
  }

  async loadOutcomesBatch(query: OutcomeBatchQuery): Promise<FirstLimitPullbackOutcome[]> {
    if (query.eventIds.length === 0) return [];
    const projection = resolveColumns("outcome", query.columns);
    return this.withDatabase((db) => {
      const rows = chunks([...new Set(query.eventIds)], MAX_SQLITE_BIND_VALUES).flatMap((eventIds) => {
        const conditions = ['"datasetVersionId" = ?'];
        const params: Array<string | number> = [query.datasetVersionId];
        appendInCondition(conditions, params, "eventId", eventIds);
        appendInCondition(conditions, params, "horizon", query.horizons ?? []);
        return db
          .prepare(
            `SELECT ${projection.sql} FROM "outcome" WHERE ${conditions.join(" AND ")} ORDER BY "eventId" ASC, "horizon" ASC`,
          )
          .all(...params) as SnapshotRow[];
      });
      return rows
        .map((row) => mapOutcomeRow(row, projection.selected))
        .sort((a, b) => compareOutcomeKeys(a, b));
    });
  }

  async loadPathsBatch(query: PathBatchQuery): Promise<FirstLimitPullbackPath[]> {
    if (query.eventIds.length === 0) return [];
    const projection = resolveColumns("path", query.columns);
    return this.withDatabase((db) => {
      const rows = chunks([...new Set(query.eventIds)], MAX_SQLITE_BIND_VALUES).flatMap((eventIds) => {
        const conditions = ['"datasetVersionId" = ?'];
        const params: Array<string | number> = [query.datasetVersionId];
        appendInCondition(conditions, params, "eventId", eventIds);
        appendInCondition(conditions, params, "relativeDay", query.relativeDays ?? []);
        return db
          .prepare(
            `SELECT ${projection.sql} FROM "path" WHERE ${conditions.join(" AND ")} ORDER BY "eventId" ASC, "relativeDay" ASC`,
          )
          .all(...params) as SnapshotRow[];
      });
      return rows
        .map((row) => mapPathRow(row, projection.selected))
        .sort((a, b) => comparePathKeys(a, b));
    });
  }

  async loadRawBarsBatch(
    role: "prefix" | "post",
    query: RawBarBatchQuery,
  ): Promise<FirstLimitPullbackRawBar[]> {
    if (query.eventIds.length === 0) return [];
    const projection = resolveColumns(role, query.columns);
    return this.withDatabase((db) => {
      const rows = chunks([...new Set(query.eventIds)], MAX_SQLITE_BIND_VALUES).flatMap((eventIds) => {
        const conditions = ['"datasetVersionId" = ?'];
        const params: Array<string | number> = [query.datasetVersionId];
        appendInCondition(conditions, params, "eventId", eventIds);
        appendInCondition(conditions, params, "relativeDay", query.relativeDays ?? []);
        return db
          .prepare(
            `SELECT ${projection.sql} FROM ${quoteIdentifier(role)} WHERE ${conditions.join(" AND ")} ORDER BY "eventId" ASC, "relativeDay" ASC`,
          )
          .all(...params) as SnapshotRow[];
      });
      return rows
        .map((row) => mapRawBarRow(row, projection.selected))
        .sort((a, b) => comparePathKeys(a, b));
    });
  }

  async getPathRelativeDayRange(datasetVersionId: number): Promise<{ min: number; max: number } | null> {
    return this.getRelativeDayRange("path", datasetVersionId);
  }

  async getPostRelativeDayRange(datasetVersionId: number): Promise<{ min: number; max: number } | null> {
    return this.getRelativeDayRange("post", datasetVersionId);
  }

  private getRelativeDayRange(
    role: "path" | "post",
    datasetVersionId: number,
  ): { min: number; max: number } | null {
    return this.withDatabase((db) => {
      const row = db
        .prepare(
          `SELECT MIN("relativeDay") AS min, MAX("relativeDay") AS max FROM ${quoteIdentifier(role)} WHERE "datasetVersionId" = ?`,
        )
        .get(datasetVersionId) as { min: number | null; max: number | null } | undefined;
      if (row?.min === null || row?.min === undefined || row.max === null || row.max === undefined) return null;
      return { min: Number(row.min), max: Number(row.max) };
    });
  }
}
