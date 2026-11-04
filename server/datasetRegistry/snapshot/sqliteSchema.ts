import { DatabaseSync } from "./nodeSqlite";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../types";

export type SnapshotContentRole = "event" | "prefix" | "post" | "path" | "outcome";
export type SnapshotInsertRole = SnapshotContentRole | "event_identity";

type ColumnKind = "integer" | "number" | "text" | "boolean" | "date" | "time" | "timestamp";

interface SnapshotColumnDefinition {
  name: string;
  kind: ColumnKind;
  notNull?: boolean;
  primaryKey?: boolean;
  autoincrement?: boolean;
  defaultSql?: string;
}

interface SnapshotTableDefinition {
  name: SnapshotContentRole | "event_identity";
  columns: readonly SnapshotColumnDefinition[];
  indexes: readonly {
    name: string;
    columns: readonly string[];
    unique?: boolean;
  }[];
}

const createdAtColumn: SnapshotColumnDefinition = {
  name: "createdAt",
  kind: "timestamp",
  notNull: true,
  defaultSql: "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
};

/**
 * Snapshot table definitions mirror `drizzle/schema.ts`: scalar strings are TEXT,
 * dates/times are TEXT, booleans are INTEGER 0/1, and numeric columns use
 * SQLite INTEGER/REAL. `id` / `createdAt` are retained for schema parity even
 * though domain readers never depend on either.
 */
export const SNAPSHOT_TABLE_DEFINITIONS: readonly SnapshotTableDefinition[] = [
  {
    name: "event",
    columns: [
      { name: "id", kind: "integer", primaryKey: true, autoincrement: true },
      { name: "datasetVersionId", kind: "integer", notNull: true },
      { name: "eventId", kind: "text", notNull: true },
      { name: "symbol", kind: "text", notNull: true },
      { name: "tradeDate", kind: "date", notNull: true },
      { name: "market", kind: "text" },
      { name: "industryCode", kind: "text" },
      { name: "boardType", kind: "text" },
      { name: "previousClose", kind: "number" },
      { name: "limitUpPrice", kind: "number" },
      { name: "limitDownPrice", kind: "number" },
      { name: "limitRuleUp", kind: "number" },
      { name: "limitRuleDown", kind: "number" },
      { name: "limitRuleVersion", kind: "text" },
      { name: "turnover", kind: "number" },
      { name: "limitUpTime", kind: "time" },
      { name: "sector", kind: "text" },
      { name: "keywords", kind: "text" },
      { name: "sourceTurnoverAmount", kind: "number" },
      { name: "sourceCirculationValue", kind: "number" },
      { name: "isFirstLimit", kind: "boolean" },
      { name: "previousLimitDate", kind: "date" },
      { name: "daysSincePreviousLimit", kind: "integer" },
      { name: "historicalLimitCount", kind: "integer" },
      { name: "marketCap", kind: "number" },
      { name: "floatMarketCap", kind: "number" },
      createdAtColumn,
    ],
    indexes: [
      { name: "uq_snapshot_event_version_event", columns: ["datasetVersionId", "eventId"], unique: true },
      { name: "idx_snapshot_event_version_date_event", columns: ["datasetVersionId", "tradeDate", "eventId"] },
    ],
  },
  {
    name: "prefix",
    columns: [
      { name: "id", kind: "integer", primaryKey: true, autoincrement: true },
      { name: "datasetVersionId", kind: "integer", notNull: true },
      { name: "eventId", kind: "text", notNull: true },
      { name: "symbol", kind: "text", notNull: true },
      { name: "tradeDate", kind: "date", notNull: true },
      { name: "relativeDay", kind: "integer", notNull: true },
      { name: "open", kind: "number" },
      { name: "high", kind: "number" },
      { name: "low", kind: "number" },
      { name: "close", kind: "number" },
      { name: "preClose", kind: "number" },
      { name: "volume", kind: "number" },
      { name: "amount", kind: "number" },
      createdAtColumn,
    ],
    indexes: [
      { name: "uq_snapshot_prefix_version_event_day", columns: ["datasetVersionId", "eventId", "relativeDay"], unique: true },
      { name: "idx_snapshot_prefix_version_day", columns: ["datasetVersionId", "relativeDay"] },
    ],
  },
  {
    name: "post",
    columns: [
      { name: "id", kind: "integer", primaryKey: true, autoincrement: true },
      { name: "datasetVersionId", kind: "integer", notNull: true },
      { name: "eventId", kind: "text", notNull: true },
      { name: "symbol", kind: "text", notNull: true },
      { name: "tradeDate", kind: "date", notNull: true },
      { name: "relativeDay", kind: "integer", notNull: true },
      { name: "open", kind: "number" },
      { name: "high", kind: "number" },
      { name: "low", kind: "number" },
      { name: "close", kind: "number" },
      { name: "preClose", kind: "number" },
      { name: "limitUpPrice", kind: "number" },
      { name: "limitDownPrice", kind: "number" },
      { name: "limitRuleUp", kind: "number" },
      { name: "limitRuleDown", kind: "number" },
      { name: "limitRuleVersion", kind: "text" },
      { name: "barPresent", kind: "boolean" },
      { name: "suspensionStatus", kind: "text" },
      { name: "suspensionSource", kind: "text" },
      { name: "openAtLimitUp", kind: "boolean" },
      { name: "closeAtLimitDown", kind: "boolean" },
      { name: "oneWordLimitUp", kind: "boolean" },
      { name: "oneWordLimitDown", kind: "boolean" },
      { name: "canBuyAtOpen", kind: "boolean" },
      { name: "canSellAtClose", kind: "boolean" },
      { name: "volume", kind: "number" },
      { name: "amount", kind: "number" },
      createdAtColumn,
    ],
    indexes: [
      { name: "uq_snapshot_post_version_event_day", columns: ["datasetVersionId", "eventId", "relativeDay"], unique: true },
      { name: "idx_snapshot_post_version_day", columns: ["datasetVersionId", "relativeDay"] },
    ],
  },
  {
    name: "path",
    columns: [
      { name: "id", kind: "integer", primaryKey: true, autoincrement: true },
      { name: "datasetVersionId", kind: "integer", notNull: true },
      { name: "eventId", kind: "text", notNull: true },
      { name: "symbol", kind: "text", notNull: true },
      { name: "tradeDate", kind: "date", notNull: true },
      { name: "relativeDay", kind: "integer", notNull: true },
      { name: "highFromEventClose", kind: "number" },
      { name: "lowFromEventClose", kind: "number" },
      { name: "closeFromEventClose", kind: "number" },
      { name: "pullbackFromEventHigh", kind: "number" },
      { name: "volumeRatio", kind: "number" },
      { name: "isBreakout", kind: "boolean" },
      { name: "breakoutPrice", kind: "number" },
      { name: "daysToBreakout", kind: "integer" },
      createdAtColumn,
    ],
    indexes: [
      { name: "uq_snapshot_path_version_event_day", columns: ["datasetVersionId", "eventId", "relativeDay"], unique: true },
      { name: "idx_snapshot_path_version_day", columns: ["datasetVersionId", "relativeDay"] },
    ],
  },
  {
    name: "outcome",
    columns: [
      { name: "id", kind: "integer", primaryKey: true, autoincrement: true },
      { name: "datasetVersionId", kind: "integer", notNull: true },
      { name: "eventId", kind: "text", notNull: true },
      { name: "horizon", kind: "integer", notNull: true },
      { name: "maxReturn", kind: "number" },
      { name: "minReturn", kind: "number" },
      { name: "maxDrawdown", kind: "number" },
      { name: "isBreakout", kind: "boolean" },
      { name: "daysToBreakout", kind: "integer" },
      createdAtColumn,
    ],
    indexes: [
      { name: "uq_snapshot_outcome_version_event_horizon", columns: ["datasetVersionId", "eventId", "horizon"], unique: true },
      { name: "idx_snapshot_outcome_version_horizon", columns: ["datasetVersionId", "horizon"] },
    ],
  },
  {
    name: "event_identity",
    columns: [
      { name: "event_id", kind: "text", primaryKey: true },
      { name: "security_id", kind: "text", notNull: true },
    ],
    indexes: [],
  },
] as const;

export const SNAPSHOT_CONTENT_ROLES = ["event", "prefix", "post", "path", "outcome"] as const;
export const SNAPSHOT_TABLE_NAMES = SNAPSHOT_TABLE_DEFINITIONS.map((definition) => definition.name);

const definitionsByRole = new Map(
  SNAPSHOT_TABLE_DEFINITIONS.map((definition) => [definition.name, definition]),
);

function sqliteType(column: SnapshotColumnDefinition): string {
  if (column.kind === "integer" || column.kind === "boolean") return "INTEGER";
  if (column.kind === "number") return "REAL";
  return "TEXT";
}

function renderColumn(column: SnapshotColumnDefinition): string {
  const parts = [quoteIdentifier(column.name)];
  if (column.primaryKey && column.kind === "integer" && column.autoincrement) {
    parts.push("INTEGER PRIMARY KEY AUTOINCREMENT");
    return parts.join(" ");
  }
  parts.push(column.kind === "date" || column.kind === "time" || column.kind === "timestamp" ? "TEXT" : sqliteType(column));
  if (column.primaryKey) parts.push("PRIMARY KEY");
  if (column.notNull) parts.push("NOT NULL");
  if (column.defaultSql) parts.push(`DEFAULT ${column.defaultSql}`);
  return parts.join(" ");
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Create the six snapshot tables and all required keyset/read indexes. */
export function createSnapshotSqliteSchema(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA synchronous = FULL");
  for (const definition of SNAPSHOT_TABLE_DEFINITIONS) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(definition.name)} (${definition.columns
        .map(renderColumn)
        .join(", ")})`,
    );
    for (const index of definition.indexes) {
      db.exec(
        `CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quoteIdentifier(index.name)} ON ${quoteIdentifier(
          definition.name,
        )} (${index.columns.map(quoteIdentifier).join(", ")})`,
      );
    }
  }
}

export function snapshotTableColumns(role: SnapshotInsertRole): readonly string[] {
  const definition = definitionsByRole.get(role);
  if (!definition) throw new Error(`Unknown snapshot table role "${role}"`);
  return definition.columns.map((column) => column.name);
}

export function snapshotWritableColumns(role: SnapshotInsertRole): readonly string[] {
  return snapshotTableColumns(role).filter((name) => name !== "id" && name !== "createdAt");
}

function toSqliteValue(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  throw new Error(`Unsupported SQLite snapshot value type "${typeof value}"`);
}

export function insertSnapshotRows(
  db: DatabaseSync,
  role: SnapshotContentRole,
  rows:
    | readonly FirstLimitPullbackEvent[]
    | readonly FirstLimitPullbackRawBar[]
    | readonly FirstLimitPullbackPath[]
    | readonly FirstLimitPullbackOutcome[]
    | readonly Record<string, unknown>[],
): void {
  if (rows.length === 0) return;
  const columns = snapshotWritableColumns(role);
  const statement = db.prepare(
    `INSERT OR REPLACE INTO ${quoteIdentifier(role)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns
      .map(() => "?")
      .join(", ")})`,
  );
  for (const row of rows) {
    statement.run(...columns.map((column) => toSqliteValue((row as Record<string, unknown>)[column])));
  }
}

export function insertSnapshotIdentities(
  db: DatabaseSync,
  rows: readonly { eventId: string; securityId: string }[],
): void {
  if (rows.length === 0) return;
  const statement = prepareSnapshotIdentityInsert(db);
  for (const row of rows) statement.run(row.eventId, row.securityId);
}

export interface SnapshotSqliteStatement {
  run(...params: ReadonlyArray<string | number | null>): unknown;
}

/**
 * 预编译 event_identity 插入语句。
 *
 * 导出器逐行写入身份时必须复用同一 statement：每行重新 `db.prepare` 在百万事件级别会
 * 把准备成本放大成主导开销（SQLite 每次 prepare 都要重新解析 + 规划）。
 */
export function prepareSnapshotIdentityInsert(db: DatabaseSync): SnapshotSqliteStatement {
  return db.prepare(
    'INSERT OR REPLACE INTO "event_identity" ("event_id", "security_id") VALUES (?, ?)',
  ) as unknown as SnapshotSqliteStatement;
}

export function insertSnapshotIdentity(
  db: DatabaseSync,
  eventId: string,
  securityId: string,
): void {
  prepareSnapshotIdentityInsert(db).run(eventId, securityId);
}
