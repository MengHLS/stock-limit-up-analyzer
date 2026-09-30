/**
 * LOCAL-DATASET-SNAPSHOT 测试夹具：构造一份自洽的 SQLite 快照（六表 + manifest）。
 *
 * 只在测试内使用。故意不复用导出器（`exportDatasetSnapshot`），因为导出器依赖
 * `DatasetDataReader` + `metadataReader`；夹具直接按 SQLite schema 写入固定行，
 * 便于逐项构造「坏快照」（缺表 / 错版本 / checksum / count / 未知格式）。
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "../../../../server/datasetRegistry/snapshot/nodeSqlite";
import {
  createSnapshotSqliteSchema,
  insertSnapshotIdentities,
  insertSnapshotRows,
} from "../../../../server/datasetRegistry/snapshot/sqliteSchema";
import {
  DATASET_SNAPSHOT_EXPORTER_VERSION,
  DATASET_SNAPSHOT_FILE_NAME,
  DATASET_SNAPSHOT_FORMAT_VERSION,
  DATASET_SNAPSHOT_MANIFEST_FILE_NAME,
  type DatasetSnapshotManifest,
} from "../../../../server/datasetRegistry/snapshot/manifest";
import { fileSizeAndSha256 } from "../../../../server/datasetRegistry/snapshot/store";
import type {
  DatasetDefinition,
  DatasetVersion,
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../../../../server/datasetRegistry/types";

export const FIXTURE_DATASET_VERSION_ID = 1;

export function fixtureDefinition(overrides: Partial<DatasetDefinition> = {}): DatasetDefinition {
  return {
    id: 11,
    datasetCode: "first_limit_pullback",
    name: "首板回踩（夹具）",
    description: null,
    datasetType: "EVENT",
    storageType: "DATABASE",
    status: "ACTIVE",
    eventTableName: "ds_first_limit_pullback_events",
    prefixTableName: "ds_first_limit_pullback_prefixes",
    postTableName: "ds_first_limit_pullback_posts",
    pathTableName: "ds_first_limit_pullback_paths",
    outcomeTableName: "ds_first_limit_pullback_outcomes",
    featureTableName: null,
    ...overrides,
  };
}

export function fixtureVersion(overrides: Partial<DatasetVersion> = {}): DatasetVersion {
  return {
    id: FIXTURE_DATASET_VERSION_ID,
    datasetId: 11,
    version: "v-fixture",
    status: "READY",
    startDate: "2024-01-02",
    endDate: "2024-01-05",
    ...overrides,
  };
}

export function makeEvent(
  datasetVersionId: number,
  eventId: string,
  tradeDate: string,
  overrides: Partial<FirstLimitPullbackEvent> = {},
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
    ...overrides,
  };
}

export function makeRawBar(
  datasetVersionId: number,
  eventId: string,
  relativeDay: number,
  post = false,
  overrides: Partial<FirstLimitPullbackRawBar> = {},
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId,
    eventId,
    symbol: eventId.split("@")[0]!,
    tradeDate: `2024-0${post ? 2 : 1}-${String(Math.abs(relativeDay) + 1).padStart(2, "0")}`,
    relativeDay,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    preClose: 10,
    // prefix/post 在领域层严格同构；prefix 的 post 专用字段统一为 null。
    limitUpPrice: null,
    limitDownPrice: null,
    limitRuleUp: null,
    limitRuleDown: null,
    limitRuleVersion: null,
    barPresent: null,
    suspensionStatus: null,
    suspensionSource: null,
    openAtLimitUp: null,
    closeAtLimitDown: null,
    oneWordLimitUp: null,
    oneWordLimitDown: null,
    canBuyAtOpen: null,
    canSellAtClose: null,
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
    ...overrides,
  };
}

export function makePath(
  datasetVersionId: number,
  eventId: string,
  relativeDay: number,
  overrides: Partial<FirstLimitPullbackPath> = {},
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
    ...overrides,
  };
}

export function makeOutcome(
  datasetVersionId: number,
  eventId: string,
  horizon: number,
  overrides: Partial<FirstLimitPullbackOutcome> = {},
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
    ...overrides,
  };
}

export interface SnapshotFixtureRows {
  events: FirstLimitPullbackEvent[];
  prefixes: FirstLimitPullbackRawBar[];
  posts: FirstLimitPullbackRawBar[];
  paths: FirstLimitPullbackPath[];
  outcomes: FirstLimitPullbackOutcome[];
  /** 缺省时按 `events` 生成确定性 `sec_<uuid>`（仅用于读取测试，不参与导出校验）。 */
  identities?: Map<string, string> | Record<string, string>;
}

export interface SnapshotFixtureResult {
  versionDir: string;
  manifestPath: string;
  sqlitePath: string;
  manifest: DatasetSnapshotManifest;
  definition: DatasetDefinition & { id: number };
  version: DatasetVersion & { id: number };
}

function identitySeq(index: number): string {
  const hex = index.toString(16).padStart(12, "0");
  return `sec_00000000-0000-4000-8000-${hex}`;
}

function normaliseIdentities(
  events: readonly FirstLimitPullbackEvent[],
  identities: SnapshotFixtureRows["identities"],
): Map<string, string> {
  const resolved = new Map<string, string>();
  if (identities instanceof Map) {
    for (const [eventId, securityId] of identities) resolved.set(eventId, securityId);
  } else if (identities) {
    for (const [eventId, securityId] of Object.entries(identities)) resolved.set(eventId, securityId);
  }
  for (const [index, event] of events.entries()) {
    if (!resolved.has(event.eventId)) resolved.set(event.eventId, identitySeq(index + 1));
  }
  return resolved;
}

/**
 * 写入一份**自洽**快照（行数 / 日期 / horizon / 相对日范围 / identity / size / sha256
 * 全部与 manifest 一致），可直接被 `DatasetSnapshotStore#loadValid` 读通。
 */
export async function writeSnapshotFixture(
  versionDir: string,
  rows: SnapshotFixtureRows,
  options: {
    datasetVersionId?: number;
    definition?: Partial<DatasetDefinition>;
    version?: Partial<DatasetVersion>;
  } = {},
): Promise<SnapshotFixtureResult> {
  const datasetVersionId = options.datasetVersionId ?? FIXTURE_DATASET_VERSION_ID;
  const definition = fixtureDefinition(options.definition);
  const version = fixtureVersion({
    id: datasetVersionId,
    datasetId: definition.id!,
    ...options.version,
  });
  const versionId = version.id!;
  const definitionId = definition.id!;

  await mkdir(versionDir, { recursive: true });
  const sqlitePath = path.join(versionDir, DATASET_SNAPSHOT_FILE_NAME);
  const manifestPath = path.join(versionDir, DATASET_SNAPSHOT_MANIFEST_FILE_NAME);
  const identities = normaliseIdentities(rows.events, rows.identities);

  const db = new DatabaseSync(sqlitePath);
  createSnapshotSqliteSchema(db);
  insertSnapshotRows(db, "event", rows.events);
  insertSnapshotRows(db, "prefix", rows.prefixes);
  insertSnapshotRows(db, "post", rows.posts);
  insertSnapshotRows(db, "path", rows.paths);
  insertSnapshotRows(db, "outcome", rows.outcomes);
  insertSnapshotIdentities(
    db,
    [...identities].map(([eventId, securityId]) => ({ eventId, securityId })),
  );
  db.close();

  const dates = rows.events.map((event) => event.tradeDate).sort();
  const horizons = [...new Set(rows.outcomes.map((outcome) => outcome.horizon))].sort(
    (a, b) => a - b,
  );
  const pathDays = rows.paths.map((row) => row.relativeDay);
  const postDays = rows.posts.map((row) => row.relativeDay);
  const counts = {
    eventCount: rows.events.length,
    prefixCount: rows.prefixes.length,
    postCount: rows.posts.length,
    pathCount: rows.paths.length,
    outcomeCount: rows.outcomes.length,
    rowCount:
      rows.events.length +
      rows.prefixes.length +
      rows.posts.length +
      rows.paths.length +
      rows.outcomes.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    horizons,
  };
  const pathRelativeDayRange =
    pathDays.length === 0
      ? null
      : { min: Math.min(...pathDays), max: Math.max(...pathDays) };
  const postRelativeDayRange =
    postDays.length === 0
      ? null
      : { min: Math.min(...postDays), max: Math.max(...postDays) };

  const { size, sha256 } = await fileSizeAndSha256(sqlitePath);
  const manifest: DatasetSnapshotManifest = {
    formatVersion: DATASET_SNAPSHOT_FORMAT_VERSION,
    exporterVersion: DATASET_SNAPSHOT_EXPORTER_VERSION,
    datasetVersionId: versionId,
    datasetId: version.datasetId,
    definition: { id: definitionId, datasetCode: definition.datasetCode, name: definition.name },
    version: {
      id: versionId,
      datasetId: version.datasetId,
      label: version.version,
      status: "READY",
      startDate: version.startDate,
      endDate: version.endDate,
    },
    counts,
    firstDate: counts.firstDate,
    lastDate: counts.lastDate,
    horizons,
    pathRelativeDayRange,
    postRelativeDayRange,
    identityCount: identities.size,
    sqlite: { fileName: DATASET_SNAPSHOT_FILE_NAME, size, sha256 },
    exportedAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    versionDir,
    manifestPath,
    sqlitePath,
    manifest,
    definition: definition as DatasetDefinition & { id: number },
    version: version as DatasetVersion & { id: number },
  };
}

/** 三个事件 + 五表行，供 parity / store / awareReader 共用（版本 1 与版本 2 同一文件）。 */
export function defaultFixtureRows(): SnapshotFixtureRows {
  const events = [
    makeEvent(1, "600002.SH@2024-01-02", "2024-01-02"),
    makeEvent(1, "000001.SZ@2024-01-02", "2024-01-02", { market: "SZ" }),
    makeEvent(1, "600001.SH@2024-01-03", "2024-01-03"),
    makeEvent(2, "300001.SZ@2024-01-02", "2024-01-02", { market: "SZ" }),
  ];
  return {
    events,
    prefixes: [
      makeRawBar(1, "600002.SH@2024-01-02", 0),
      makeRawBar(1, "600002.SH@2024-01-02", -1),
      makeRawBar(1, "000001.SZ@2024-01-02", 0),
      makeRawBar(2, "300001.SZ@2024-01-02", 0),
    ],
    posts: [
      makeRawBar(1, "600002.SH@2024-01-02", 1, true),
      makeRawBar(1, "600002.SH@2024-01-02", 2, true),
      makeRawBar(1, "000001.SZ@2024-01-02", 1, true),
      makeRawBar(2, "300001.SZ@2024-01-02", 1, true),
    ],
    paths: [
      makePath(1, "600002.SH@2024-01-02", 1),
      makePath(1, "600002.SH@2024-01-02", 2),
      makePath(1, "600002.SH@2024-01-02", 3),
      makePath(1, "000001.SZ@2024-01-02", 1),
      makePath(1, "000001.SZ@2024-01-02", 2),
      makePath(2, "300001.SZ@2024-01-02", 1),
    ],
    outcomes: [
      makeOutcome(1, "600002.SH@2024-01-02", 5),
      makeOutcome(1, "600002.SH@2024-01-02", 10),
      makeOutcome(1, "600002.SH@2024-01-02", 20),
      makeOutcome(1, "000001.SZ@2024-01-02", 5),
      makeOutcome(2, "300001.SZ@2024-01-02", 5),
    ],
  };
}

/**
 * 只保留某个版本的行。
 *
 * `defaultFixtureRows()` 故意把版本 1 / 2 塞进同一个 SQLite 文件（用于验证 reader 的版本隔离），
 * 但 `DatasetSnapshotStore` 会校验 `identityCount === 该版本 eventCount`——真实快照文件一个版本一份。
 * 因此走 store 的测试用本函数取「单版本」行集。
 */
export function singleVersionFixtureRows(datasetVersionId: number): SnapshotFixtureRows {
  const rows = defaultFixtureRows();
  return {
    events: rows.events.filter((row) => row.datasetVersionId === datasetVersionId),
    prefixes: rows.prefixes.filter((row) => row.datasetVersionId === datasetVersionId),
    posts: rows.posts.filter((row) => row.datasetVersionId === datasetVersionId),
    paths: rows.paths.filter((row) => row.datasetVersionId === datasetVersionId),
    outcomes: rows.outcomes.filter((row) => row.datasetVersionId === datasetVersionId),
  };
}
