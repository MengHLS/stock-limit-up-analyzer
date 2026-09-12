/**
 * STEP DATASET-001 — 真实 DB 实现（TiDB / MySQL，沿用 drizzle + getDb）。
 *
 * 两部分：
 *   1. DbDatasetRegistry：dataset_definition / dataset_version / dataset_build_job 的落库与读取；
 *   2. DbDatasetBuildIO：首板回踩构建的 IO（stock_daily_prices 逐日下推 + keyset、PIT ST、
 *      流动性/行业富集、ds_* 表幂等 upsert）。
 *
 * 不引入新 ORM / 新库 / 队列。所有 ds_* 插入走 ON DUPLICATE KEY（幂等，§28）。
 */

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  datasetBuildConfigBoards,
  datasetBuildConfigEvents,
  datasetBuildConfigs,
  datasetBuildJobs,
  datasetDefinitions,
  datasetVersions,
  firstLimitPullbackEvents,
  firstLimitPullbackOutcomes,
  firstLimitPullbackPaths,
  firstLimitPullbackPosts,
  firstLimitPullbackPrefixes,
  indexDaily,
  industryAssignments,
  liquidityDaily,
  researchSecurityIdentifierHistory,
  researchSecurityStatusHistory,
  stockDailyPrices,
} from "../../drizzle/schema";
import { resolveSecurityStatus } from "../securityStatus/timeline";
import type { SecurityStatusInterval } from "../securityStatus/types";
import type { DatasetRegistryRepository, JobTransitionPatch } from "./registry";
import type { JobStatus } from "./lifecycle";
import type {
  DatasetBoard,
  DatasetBuildConfigRecord,
  DatasetBuildJob,
  DatasetDefinition,
  DatasetEventKind,
  DatasetEventSpec,
  DatasetVersion,
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "./types";
import type { DatasetBuildIO, LiquidityEnrichment } from "./builder";
import { liquidityKey } from "./builder";
import { LIMIT_UP_CANDIDATE_SQL_PREDICATE, type DailyBar, type StStatus } from "./detection";
import {
  CANDIDATE_RANGE_MAX_MONTHS,
  chunkArray,
  defaultConcurrency,
  mapWithConcurrency,
  MAX_ROWS_PER_STATEMENT,
  SYMBOL_BATCH_SIZE,
} from "./concurrency";

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  return toIso(value);
}

/** 把 full code（600001.SH）拆成 (code, exchange)。 */
function splitSymbol(symbol: string): { code: string; exchange: string } {
  const idx = symbol.lastIndexOf(".");
  if (idx <= 0) return { code: symbol, exchange: "" };
  return { code: symbol.slice(0, idx), exchange: symbol.slice(idx + 1) };
}

/** stock_daily_prices varchar 行 → DailyBar。 */
function rowToDailyBar(row: typeof stockDailyPrices.$inferSelect): DailyBar {
  return {
    symbol: row.stockCode,
    tradeDate: row.tradeDate,
    open: parseNumber(row.openPrice),
    high: parseNumber(row.highPrice),
    low: parseNumber(row.lowPrice),
    close: parseNumber(row.closePrice),
    preClose: parseNumber(row.preClosePrice),
    volume: parseNumber(row.volume),
    amount: parseNumber(row.amount),
  };
}

/**
 * 把 `[startDate, endDate]` 切成**自然月**分片（含首尾，日期边界夹取到区间内）。
 *
 * 用于涨停候选查询的并发下推：月份分片天然对齐业务语义（月内交易日数接近），
 * 且分片间**日期不相交** → 结果按分片顺序拼接即为全局有序，无重复、无遗漏。
 */
function monthShards(startDate: string, endDate: string): Array<{ start: string; end: string }> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const startYear = Number(startDate.slice(0, 4));
  const startMonth = Number(startDate.slice(5, 7));
  const endYear = Number(endDate.slice(0, 4));
  const endMonth = Number(endDate.slice(5, 7));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return [{ start: startDate, end: endDate }];
  const shards: Array<{ start: string; end: string }> = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const first = `${year}-${pad(month)}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = `${year}-${pad(month)}-${pad(lastDay)}`;
    shards.push({
      start: first < startDate ? startDate : first,
      end: last > endDate ? endDate : last,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return shards;
}

// ===========================================================================
// 1. DbDatasetRegistry
// ===========================================================================

function definitionRowToDomain(row: typeof datasetDefinitions.$inferSelect): DatasetDefinition {
  return {
    id: row.id,
    datasetCode: row.datasetCode,
    name: row.name,
    description: row.description,
    datasetType: row.datasetType as DatasetDefinition["datasetType"],
    storageType: row.storageType as DatasetDefinition["storageType"],
    status: row.status as DatasetDefinition["status"],
    eventTableName: row.eventTableName,
    prefixTableName: row.prefixTableName,
    postTableName: row.postTableName,
    pathTableName: row.pathTableName,
    outcomeTableName: row.outcomeTableName,
    featureTableName: row.featureTableName,
    createdAt: isoOrNull(row.createdAt) ?? undefined,
    updatedAt: isoOrNull(row.updatedAt) ?? undefined,
  };
}

function versionRowToDomain(row: typeof datasetVersions.$inferSelect): DatasetVersion {
  return {
    id: row.id,
    datasetId: row.datasetId,
    version: row.version,
    status: row.status as DatasetVersion["status"],
    startDate: row.startDate,
    endDate: row.endDate,
    universeDefinition: row.universeDefinitionJson ? safeParse(row.universeDefinitionJson) : undefined,
    filterDefinition: row.filterDefinitionJson ? safeParse(row.filterDefinitionJson) : undefined,
    featureVersion: row.featureVersion,
    sourceVersion: row.sourceVersion,
    totalEvents: row.totalEvents,
    totalRows: row.totalRows,
    createdAt: isoOrNull(row.createdAt) ?? undefined,
    completedAt: isoOrNull(row.completedAt),
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

/** 主表行 + 子表多值 → 领域记录（筛选配置）。 */
function buildConfigMasterToDomain(
  row: typeof datasetBuildConfigs.$inferSelect,
  events: readonly DatasetEventSpec[],
  boards: readonly DatasetBoard[],
): DatasetBuildConfigRecord {
  let horizons: number[] = [];
  if (row.outcomeHorizonsJson) {
    const parsed = safeParse(row.outcomeHorizonsJson);
    if (Array.isArray(parsed)) {
      horizons = parsed.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    }
  }
  return {
    id: row.id,
    datasetVersionId: row.datasetVersionId,
    boards: boards.map((b) => b),
    excludeSt: row.excludeSt,
    events: events.map((e) => ({ relativeDay: e.relativeDay, kind: e.kind })),
    preWindowDays: row.preWindowDays,
    postWindowDays: row.postWindowDays,
    outcomeHorizons: horizons,
    batchSize: row.batchSize,
    configVersion: row.configVersion,
    createdAt: isoOrNull(row.createdAt),
    updatedAt: isoOrNull(row.updatedAt),
  };
}

function jobRowToDomain(row: typeof datasetBuildJobs.$inferSelect): DatasetBuildJob {
  return {
    id: row.id,
    datasetVersionId: row.datasetVersionId,
    jobId: row.jobId,
    status: row.status as DatasetBuildJob["status"],
    totalChunks: row.totalChunks,
    completedChunks: row.completedChunks,
    currentChunk: row.currentChunk,
    processedRows: row.processedRows,
    failedRows: row.failedRows,
    lastSymbol: row.lastSymbol,
    lastTradeDate: row.lastTradeDate,
    lastCursor: row.lastCursor,
    startedAt: isoOrNull(row.startedAt),
    updatedAt: isoOrNull(row.updatedAt) ?? undefined,
    completedAt: isoOrNull(row.completedAt),
    errorMessage: row.errorMessage,
  };
}

export class DbDatasetRegistry implements DatasetRegistryRepository {
  async saveDefinition(input: DatasetDefinition): Promise<DatasetDefinition> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const existing = await this.getDefinitionByCode(input.datasetCode);
    if (existing) {
      await db.update(datasetDefinitions).set({
        name: input.name,
        description: input.description ?? null,
        datasetType: input.datasetType,
        storageType: input.storageType,
        status: input.status,
        eventTableName: input.eventTableName,
        prefixTableName: input.prefixTableName,
        postTableName: input.postTableName,
        pathTableName: input.pathTableName,
        outcomeTableName: input.outcomeTableName,
        featureTableName: input.featureTableName,
      }).where(eq(datasetDefinitions.id, existing.id!));
      return (await this.getDefinitionByCode(input.datasetCode))!;
    }
    await db.insert(datasetDefinitions).values({
      datasetCode: input.datasetCode,
      name: input.name,
      description: input.description ?? null,
      datasetType: input.datasetType,
      storageType: input.storageType,
      status: input.status,
      eventTableName: input.eventTableName,
      prefixTableName: input.prefixTableName,
      postTableName: input.postTableName,
      pathTableName: input.pathTableName,
      outcomeTableName: input.outcomeTableName,
      featureTableName: input.featureTableName,
    });
    return (await this.getDefinitionByCode(input.datasetCode))!;
  }

  async getDefinitionByCode(code: string): Promise<DatasetDefinition | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(datasetDefinitions).where(eq(datasetDefinitions.datasetCode, code)).limit(1);
    return rows[0] ? definitionRowToDomain(rows[0]) : undefined;
  }

  async getDefinitionById(id: number): Promise<DatasetDefinition | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(datasetDefinitions).where(eq(datasetDefinitions.id, id)).limit(1);
    return rows[0] ? definitionRowToDomain(rows[0]) : undefined;
  }

  async listDefinitions(): Promise<DatasetDefinition[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(datasetDefinitions).orderBy(asc(datasetDefinitions.id));
    return rows.map(definitionRowToDomain);
  }

  async saveVersion(input: DatasetVersion): Promise<{ outcome: "inserted" | "idempotent-skip" | "conflict"; version: DatasetVersion }> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const existing = await this.getVersion(input.datasetId, input.version);
    if (existing) return { outcome: "idempotent-skip", version: existing };
    await db.insert(datasetVersions).values({
      datasetId: input.datasetId,
      version: input.version,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      universeDefinitionJson: input.universeDefinition === undefined ? null : JSON.stringify(input.universeDefinition),
      filterDefinitionJson: input.filterDefinition === undefined ? null : JSON.stringify(input.filterDefinition),
      featureVersion: input.featureVersion ?? null,
      sourceVersion: input.sourceVersion ?? null,
      totalEvents: input.totalEvents ?? null,
      totalRows: input.totalRows ?? null,
    });
    const created = await this.getVersion(input.datasetId, input.version);
    return { outcome: "inserted", version: created! };
  }

  async getVersion(datasetId: number, version: string): Promise<DatasetVersion | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(datasetVersions)
      .where(and(eq(datasetVersions.datasetId, datasetId), eq(datasetVersions.version, version)))
      .limit(1);
    return rows[0] ? versionRowToDomain(rows[0]) : undefined;
  }

  async getVersionById(id: number): Promise<DatasetVersion | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(datasetVersions).where(eq(datasetVersions.id, id)).limit(1);
    return rows[0] ? versionRowToDomain(rows[0]) : undefined;
  }

  async listVersions(datasetId: number): Promise<DatasetVersion[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(datasetVersions).where(eq(datasetVersions.datasetId, datasetId)).orderBy(asc(datasetVersions.id));
    return rows.map(versionRowToDomain);
  }

  async updateVersion(id: number, patch: Partial<Pick<DatasetVersion, "status" | "totalEvents" | "totalRows" | "completedAt">>): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const set: Record<string, unknown> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.totalEvents !== undefined) set.totalEvents = patch.totalEvents;
    if (patch.totalRows !== undefined) set.totalRows = patch.totalRows;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt === null ? null : new Date(patch.completedAt);
    if (Object.keys(set).length === 0) return;
    await db.update(datasetVersions).set(set).where(eq(datasetVersions.id, id));
  }

  async saveJob(input: DatasetBuildJob): Promise<DatasetBuildJob> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const existing = await this.getJob(input.jobId);
    if (existing) return existing;
    await db.insert(datasetBuildJobs).values({
      datasetVersionId: input.datasetVersionId,
      jobId: input.jobId,
      status: input.status,
      totalChunks: input.totalChunks ?? null,
      completedChunks: input.completedChunks ?? null,
      currentChunk: input.currentChunk ?? null,
      processedRows: input.processedRows ?? null,
      failedRows: input.failedRows ?? null,
      lastSymbol: input.lastSymbol ?? null,
      lastTradeDate: input.lastTradeDate ?? null,
      lastCursor: input.lastCursor ?? null,
      startedAt: input.startedAt ? new Date(input.startedAt) : null,
      completedAt: input.completedAt ? new Date(input.completedAt) : null,
      errorMessage: input.errorMessage ?? null,
    });
    return (await this.getJob(input.jobId))!;
  }

  async getJob(jobId: string): Promise<DatasetBuildJob | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(datasetBuildJobs).where(eq(datasetBuildJobs.jobId, jobId)).limit(1);
    return rows[0] ? jobRowToDomain(rows[0]) : undefined;
  }

  async getJobById(id: number): Promise<DatasetBuildJob | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(datasetBuildJobs).where(eq(datasetBuildJobs.id, id)).limit(1);
    return rows[0] ? jobRowToDomain(rows[0]) : undefined;
  }

  async listJobs(datasetVersionId: number): Promise<DatasetBuildJob[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(datasetBuildJobs).where(eq(datasetBuildJobs.datasetVersionId, datasetVersionId)).orderBy(asc(datasetBuildJobs.id));
    return rows.map(jobRowToDomain);
  }

  async updateJob(id: number, patch: Partial<Omit<DatasetBuildJob, "id" | "datasetVersionId" | "jobId">>): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const set: Record<string, unknown> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.totalChunks !== undefined) set.totalChunks = patch.totalChunks;
    if (patch.completedChunks !== undefined) set.completedChunks = patch.completedChunks;
    if (patch.currentChunk !== undefined) set.currentChunk = patch.currentChunk;
    if (patch.processedRows !== undefined) set.processedRows = patch.processedRows;
    if (patch.failedRows !== undefined) set.failedRows = patch.failedRows;
    if (patch.lastSymbol !== undefined) set.lastSymbol = patch.lastSymbol;
    if (patch.lastTradeDate !== undefined) set.lastTradeDate = patch.lastTradeDate;
    if (patch.lastCursor !== undefined) set.lastCursor = patch.lastCursor;
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt ? new Date(patch.startedAt) : null;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt ? new Date(patch.completedAt) : null;
    if (patch.errorMessage !== undefined) set.errorMessage = patch.errorMessage;
    if (Object.keys(set).length === 0) return;
    await db.update(datasetBuildJobs).set(set).where(eq(datasetBuildJobs.id, id));
  }

  async getRunningJobForVersion(datasetVersionId: number): Promise<DatasetBuildJob | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(datasetBuildJobs)
      .where(and(eq(datasetBuildJobs.datasetVersionId, datasetVersionId), eq(datasetBuildJobs.status, "RUNNING")))
      .limit(1);
    return rows[0] ? jobRowToDomain(rows[0]) : undefined;
  }

  /** 全库 RUNNING 作业（跨数据集 / 跨版本）；孤儿作业回收用。 */
  async listRunningJobs(): Promise<DatasetBuildJob[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(datasetBuildJobs)
      .where(eq(datasetBuildJobs.status, "RUNNING"))
      .orderBy(asc(datasetBuildJobs.id));
    return rows.map(jobRowToDomain);
  }

  async transitionJob(id: number, from: JobStatus, to: JobStatus, patch: JobTransitionPatch = {}): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;
    const set: Record<string, unknown> = { status: to };
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt === null ? null : new Date(patch.startedAt);
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt === null ? null : new Date(patch.completedAt);
    if (patch.errorMessage !== undefined) set.errorMessage = patch.errorMessage;
    const result = await db.update(datasetBuildJobs).set(set)
      .where(and(eq(datasetBuildJobs.id, id), eq(datasetBuildJobs.status, from)));
    const header = Array.isArray(result) ? result[0] : undefined;
    return typeof header?.affectedRows === "number" && header.affectedRows > 0;
  }

  // ---- Deletion（DATASET-003A）----

  async deleteDefinition(id: number): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    await db.delete(datasetDefinitions).where(eq(datasetDefinitions.id, id));
  }

  async deleteVersion(id: number): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    await db.delete(datasetVersions).where(eq(datasetVersions.id, id));
  }

  async deleteJobsByVersion(datasetVersionId: number): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const result = await db.delete(datasetBuildJobs).where(eq(datasetBuildJobs.datasetVersionId, datasetVersionId));
    const header = Array.isArray(result) ? result[0] : undefined;
    return typeof header?.affectedRows === "number" ? header.affectedRows : 0;
  }

  async getRunningJobForDefinition(datasetId: number): Promise<DatasetBuildJob | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const versionIds = (await db.select({ id: datasetVersions.id }).from(datasetVersions)
      .where(eq(datasetVersions.datasetId, datasetId))).map((r) => r.id);
    if (versionIds.length === 0) return undefined;
    const rows = await db.select().from(datasetBuildJobs)
      .where(and(inArray(datasetBuildJobs.datasetVersionId, versionIds), eq(datasetBuildJobs.status, "RUNNING")))
      .limit(1);
    return rows[0] ? jobRowToDomain(rows[0]) : undefined;
  }

  // ---- Build / Filter Config（DATASET-003B）----
  //
  // 与版本 1:1：主表存标量维度，_event / _board 子表存多值维度。
  // 写入策略：主表 ON DUPLICATE KEY UPDATE（幂等覆盖）→ 子表先删后插（整体替换，避免残留旧选项）。
  // 读取：两次小 IN 查询（子表按 configId 拉全量），跨境往返次数固定为 3。

  async saveBuildConfig(input: DatasetBuildConfigRecord): Promise<DatasetBuildConfigRecord> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");

    await db
      .insert(datasetBuildConfigs)
      .values({
        datasetVersionId: input.datasetVersionId,
        excludeSt: input.excludeSt,
        preWindowDays: input.preWindowDays,
        postWindowDays: input.postWindowDays,
        outcomeHorizonsJson: JSON.stringify(input.outcomeHorizons),
        batchSize: input.batchSize,
        configVersion: input.configVersion,
      })
      .onDuplicateKeyUpdate({
        set: {
          excludeSt: input.excludeSt,
          preWindowDays: input.preWindowDays,
          postWindowDays: input.postWindowDays,
          outcomeHorizonsJson: JSON.stringify(input.outcomeHorizons),
          batchSize: input.batchSize,
          configVersion: input.configVersion,
        },
      });

    const rows = await db
      .select()
      .from(datasetBuildConfigs)
      .where(eq(datasetBuildConfigs.datasetVersionId, input.datasetVersionId))
      .limit(1);
    const master = rows[0];
    if (!master) throw new Error(`筛选配置写入后读回失败：datasetVersionId=${input.datasetVersionId}`);
    const configId = master.id;

    await db.delete(datasetBuildConfigEvents).where(eq(datasetBuildConfigEvents.configId, configId));
    await db.delete(datasetBuildConfigBoards).where(eq(datasetBuildConfigBoards.configId, configId));
    if (input.events.length > 0) {
      await db.insert(datasetBuildConfigEvents).values(
        input.events.map((e, i) => ({
          configId,
          relativeDay: e.relativeDay,
          eventKind: e.kind,
          sortOrder: i,
        })),
      );
    }
    if (input.boards.length > 0) {
      await db.insert(datasetBuildConfigBoards).values(
        input.boards.map((b, i) => ({ configId, board: b, sortOrder: i })),
      );
    }

    return buildConfigMasterToDomain(master, input.events, input.boards);
  }

  async getBuildConfig(datasetVersionId: number): Promise<DatasetBuildConfigRecord | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db
      .select()
      .from(datasetBuildConfigs)
      .where(eq(datasetBuildConfigs.datasetVersionId, datasetVersionId))
      .limit(1);
    const master = rows[0];
    if (!master) return undefined;

    const eventRows = await db
      .select()
      .from(datasetBuildConfigEvents)
      .where(eq(datasetBuildConfigEvents.configId, master.id))
      .orderBy(asc(datasetBuildConfigEvents.sortOrder), asc(datasetBuildConfigEvents.id));
    const boardRows = await db
      .select()
      .from(datasetBuildConfigBoards)
      .where(eq(datasetBuildConfigBoards.configId, master.id))
      .orderBy(asc(datasetBuildConfigBoards.sortOrder), asc(datasetBuildConfigBoards.id));

    return buildConfigMasterToDomain(
      master,
      eventRows.map((r) => ({ relativeDay: r.relativeDay, kind: r.eventKind as DatasetEventKind })),
      boardRows.map((r) => r.board as DatasetBoard),
    );
  }

  async deleteBuildConfigsByVersion(datasetVersionId: number): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const rows = await db
      .select({ id: datasetBuildConfigs.id })
      .from(datasetBuildConfigs)
      .where(eq(datasetBuildConfigs.datasetVersionId, datasetVersionId));
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    await db.delete(datasetBuildConfigEvents).where(inArray(datasetBuildConfigEvents.configId, ids));
    await db.delete(datasetBuildConfigBoards).where(inArray(datasetBuildConfigBoards.configId, ids));
    const result = await db.delete(datasetBuildConfigs).where(eq(datasetBuildConfigs.datasetVersionId, datasetVersionId));
    const header = Array.isArray(result) ? result[0] : undefined;
    return typeof header?.affectedRows === "number" ? header.affectedRows : ids.length;
  }
}

// ===========================================================================
// 2. DbDatasetBuildIO
// ===========================================================================

/** 把 PIT ST 解析为 StStatus（NORMAL/ST/*ST/UNKNOWN）。 */
function stValueToStStatus(value: string | undefined): StStatus {
  if (value === "NORMAL" || value === "ST" || value === "*ST") return value;
  return "UNKNOWN";
}

/** 行业归属区间（PIT 解析用）。 */
interface IndustryInterval {
  effectiveFrom: string;
  effectiveTo: string | null;
  industryCode: string;
}

/** 证券索引（PIT ST + 行业归属）—— 小表全量，一次性载入后逐 bar 解析 O(1)。 */
interface SecurityIndex {
  identifiersByCode: Map<string, { securityId: string; effectiveFrom: string; effectiveTo: string | null }[]>;
  stBySecurity: Map<string, SecurityStatusInterval[]>;
  industryByCode: Map<string, IndustryInterval[]>;
}

export class DbDatasetBuildIO implements DatasetBuildIO {
  /** 已就绪的同步索引（`loadSecurityIndexes` 完成后可用；未预热 → null，同步解析退化为 UNKNOWN/null）。 */
  private readyIndex: SecurityIndex | null = null;
  private readyPromise: Promise<SecurityIndex> | null = null;

  /**
   * 预热证券索引（幂等，进程内只加载一次）。
   *
   * 数据量实测：`research_security_identifier_history` / `_status_history(ST)` / `industry_assignments`
   * 都是小表（合计约万行级），全量载入后逐 bar 解析退化为内存查表 —— 取代旧实现
   * 「逐日一次 IN 查询」（一年 242 个交易日 × 0.77s ≈ 186s 的纯往返）。
   */
  async loadSecurityIndexes(): Promise<void> {
    if (this.readyIndex) return;
    if (!this.readyPromise) {
      this.readyPromise = this.buildSecurityIndex().then((index) => {
        this.readyIndex = index;
        return index;
      });
    }
    await this.readyPromise;
  }

  private get syncedIndex(): SecurityIndex | null {
    return this.readyIndex;
  }

  private async buildSecurityIndex(): Promise<SecurityIndex> {
    const db = await getDb();
    const identifiersByCode = new Map<string, { securityId: string; effectiveFrom: string; effectiveTo: string | null }[]>();
    const stBySecurity = new Map<string, SecurityStatusInterval[]>();
    const industryByCode = new Map<string, IndustryInterval[]>();
    if (!db) return { identifiersByCode, stBySecurity, industryByCode };

    const idRows = await db.select().from(researchSecurityIdentifierHistory);
    for (const row of idRows) {
      const fullCode = `${row.securityCode}.${row.exchange}`;
      const list = identifiersByCode.get(fullCode) ?? [];
      list.push({ securityId: row.securityId, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo });
      identifiersByCode.set(fullCode, list);
    }
    for (const list of identifiersByCode.values()) {
      list.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    }

    const stRows = await db.select().from(researchSecurityStatusHistory).where(eq(researchSecurityStatusHistory.statusType, "ST"));
    for (const row of stRows) {
      const interval: SecurityStatusInterval = {
        securityId: row.securityId,
        statusType: row.statusType,
        statusValue: row.statusValue,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        source: row.source,
        retrievedAt: isoOrNull(row.retrievedAt),
        confidence: row.confidence,
        availability: row.availability,
      };
      const list = stBySecurity.get(row.securityId) ?? [];
      list.push(interval);
      stBySecurity.set(row.securityId, list);
    }

    const industryRows = await db.select().from(industryAssignments);
    for (const row of industryRows) {
      const list = industryByCode.get(row.securityCode) ?? [];
      list.push({ effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, industryCode: row.industryCode });
      industryByCode.set(row.securityCode, list);
    }
    for (const list of industryByCode.values()) {
      list.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    }

    return { identifiersByCode, stBySecurity, industryByCode };
  }

  async loadTradingDays(): Promise<string[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.selectDistinct({ tradeDate: indexDaily.tradeDate }).from(indexDaily).orderBy(asc(indexDaily.tradeDate));
    return rows.map((r) => r.tradeDate);
  }

  /** 同步 PIT ST 解析（须先 `loadSecurityIndexes`）。 */
  resolveStSync(symbol: string, tradeDate: string): StStatus {
    const index = this.syncedIndex;
    if (!index) return "UNKNOWN";
    const candidates = index.identifiersByCode.get(symbol);
    if (!candidates || candidates.length === 0) return "UNKNOWN";
    const active = candidates.find((c) => c.effectiveFrom <= tradeDate && (c.effectiveTo === null || c.effectiveTo >= tradeDate));
    if (!active) return "UNKNOWN";
    const intervals = index.stBySecurity.get(active.securityId) ?? [];
    if (intervals.length === 0) return "UNKNOWN";
    const snapshot = resolveSecurityStatus(intervals, active.securityId, tradeDate);
    return stValueToStStatus(snapshot.resolved.ST?.statusValue);
  }

  /**
   * 同步 PIT 行业归属解析（须先 `loadSecurityIndexes`）。
   *
   * 口径与旧 `fetchIndustryForSymbols` 完全一致：`effectiveFrom <= tradeDate` 中**最早**且仍覆盖
   * `tradeDate`（`effectiveTo` 为 null 或 ≥ tradeDate）的归属；均不覆盖 → null（不伪造）。
   */
  resolveIndustrySync(symbol: string, tradeDate: string): string | null {
    const index = this.syncedIndex;
    if (!index) return null;
    const intervals = index.industryByCode.get(symbol);
    if (!intervals) return null;
    for (const interval of intervals) {
      if (interval.effectiveFrom > tradeDate) break; // 已升序：后续必然更晚
      if (interval.effectiveTo === null || interval.effectiveTo >= tradeDate) return interval.industryCode;
    }
    return null;
  }

  async resolveSt(symbol: string, tradeDate: string): Promise<StStatus> {
    await this.loadSecurityIndexes();
    return this.resolveStSync(symbol, tradeDate);
  }

  /**
   * 区间内**涨停候选** bar（SQL 粗筛超集；语义与安全性见 `detection.LIMIT_UP_CANDIDATE_SQL_PREDICATE`）。
   *
   * 性能：整年单次查询实测 12.8s，按月分片 + 有界并发（concurrency=12）降至 3.9s。
   * 每个分片按 (tradeDate, stockCode) 升序，分片按时间顺序拼接 → 全局有序（确定性）。
   */
  async fetchLimitUpCandidateBars(startDate: string, endDate: string): Promise<DailyBar[]> {
    const db = await getDb();
    if (!db) return [];
    const shards = monthShards(startDate, endDate);
    const query = async (range: { start: string; end: string }): Promise<DailyBar[]> => {
      const rows = await db.select().from(stockDailyPrices)
        .where(and(
          gte(stockDailyPrices.tradeDate, range.start),
          lte(stockDailyPrices.tradeDate, range.end),
          sql.raw(LIMIT_UP_CANDIDATE_SQL_PREDICATE),
        ))
        .orderBy(asc(stockDailyPrices.tradeDate), asc(stockDailyPrices.stockCode));
      return rows.map(rowToDailyBar);
    };
    if (shards.length <= CANDIDATE_RANGE_MAX_MONTHS) {
      const only = shards[0];
      return only ? query(only) : [];
    }
    const parts = await mapWithConcurrency(shards, query, defaultConcurrency());
    return parts.flat();
  }

  /**
   * 给定 symbol 集合在区间内的 bar（按 symbol 分批 + 有界并发）。
   *
   * 这是 Phase 2 的定向取数入口：实测「61 天 × 400 只」= 1.6 万行/1.46s，
   * 相比同区间全市场 21.9 万行/16.9s 压缩 13.4×。
   */
  async fetchBarsForSymbolsInRange(
    symbols: readonly string[],
    startDate: string,
    endDate: string,
  ): Promise<DailyBar[]> {
    if (symbols.length === 0) return [];
    const db = await getDb();
    if (!db) return [];
    const batches = chunkArray(Array.from(new Set(symbols)), SYMBOL_BATCH_SIZE);
    const parts = await mapWithConcurrency(
      batches,
      async (batch) => {
        const rows = await db.select().from(stockDailyPrices)
          .where(and(
            inArray(stockDailyPrices.stockCode, batch),
            gte(stockDailyPrices.tradeDate, startDate),
            lte(stockDailyPrices.tradeDate, endDate),
          ))
          .orderBy(asc(stockDailyPrices.tradeDate), asc(stockDailyPrices.stockCode));
        return rows.map(rowToDailyBar);
      },
      defaultConcurrency(),
    );
    // 分批结果按 (tradeDate, stockCode) 归并，保证与单批查询同序（确定性）。
    return parts.flat().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.symbol.localeCompare(b.symbol));
  }

  /** 给定 symbol 集合在区间内的流动性富集（按 symbol 分批 + 并发）；键 = `symbol|tradeDate`。 */
  async fetchLiquidityForSymbolsInRange(
    symbols: readonly string[],
    startDate: string,
    endDate: string,
  ): Promise<Map<string, LiquidityEnrichment>> {
    const result = new Map<string, LiquidityEnrichment>();
    if (symbols.length === 0) return result;
    const db = await getDb();
    if (!db) return result;
    const batches = chunkArray(Array.from(new Set(symbols)), SYMBOL_BATCH_SIZE);
    const parts = await mapWithConcurrency(
      batches,
      async (batch) => db.select().from(liquidityDaily)
        .where(and(
          inArray(liquidityDaily.securityCode, batch),
          gte(liquidityDaily.tradeDate, startDate),
          lte(liquidityDaily.tradeDate, endDate),
        )),
      defaultConcurrency(),
    );
    for (const rows of parts) {
      for (const row of rows) {
        result.set(liquidityKey(row.securityCode, row.tradeDate), {
          turnover: row.turnoverRate,
          marketCap: row.totalMarketCap,
          floatMarketCap: row.circulationMarketCap,
        });
      }
    }
    return result;
  }

  async listEvents(datasetVersionId: number): Promise<FirstLimitPullbackEvent[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(firstLimitPullbackEvents)
      .where(eq(firstLimitPullbackEvents.datasetVersionId, datasetVersionId))
      .orderBy(asc(firstLimitPullbackEvents.eventId));
    return rows.map((row) => ({
      datasetVersionId: row.datasetVersionId,
      eventId: row.eventId,
      symbol: row.symbol,
      tradeDate: row.tradeDate,
      market: row.market,
      industryCode: row.industryCode,
      boardType: row.boardType,
      previousClose: parseNumber(row.previousClose),
      limitUpPrice: parseNumber(row.limitUpPrice),
      turnover: parseNumber(row.turnover),
      isFirstLimit: row.isFirstLimit === null ? null : Boolean(row.isFirstLimit),
      previousLimitDate: row.previousLimitDate,
      daysSincePreviousLimit: row.daysSincePreviousLimit,
      historicalLimitCount: row.historicalLimitCount,
      marketCap: parseNumber(row.marketCap),
      floatMarketCap: parseNumber(row.floatMarketCap),
    }));
  }

  async insertEvents(rows: FirstLimitPullbackEvent[]): Promise<void> {
    const db = await getDb();
    if (!db || rows.length === 0) return;
    // 单语句占位符上限（TiDB 65535）→ 每片最多 MAX_ROWS_PER_STATEMENT 行（event 表 17 列）。
    for (const chunk of chunkArray(rows, MAX_ROWS_PER_STATEMENT)) {
      await db.insert(firstLimitPullbackEvents).values(chunk.map((r) => ({
        datasetVersionId: r.datasetVersionId,
        eventId: r.eventId,
        symbol: r.symbol,
        tradeDate: r.tradeDate,
        market: r.market,
        industryCode: r.industryCode,
        boardType: r.boardType,
        previousClose: r.previousClose,
        limitUpPrice: r.limitUpPrice,
        turnover: r.turnover,
        isFirstLimit: r.isFirstLimit,
        previousLimitDate: r.previousLimitDate,
        daysSincePreviousLimit: r.daysSincePreviousLimit,
        historicalLimitCount: r.historicalLimitCount,
        marketCap: r.marketCap,
        floatMarketCap: r.floatMarketCap,
      }))).onDuplicateKeyUpdate({ set: { id: sql`${firstLimitPullbackEvents.id}` } });
    }
  }

  async insertPrefixes(rows: FirstLimitPullbackRawBar[]): Promise<void> {
    await this.insertRawBars(firstLimitPullbackPrefixes, rows);
  }

  async insertPosts(rows: FirstLimitPullbackRawBar[]): Promise<void> {
    await this.insertRawBars(firstLimitPullbackPosts, rows);
  }

  /** prefix / post 同构：同一条写入路径（不变量 I10 在代码层也保持零重复）。 */
  private async insertRawBars(
    table: typeof firstLimitPullbackPrefixes | typeof firstLimitPullbackPosts,
    rows: FirstLimitPullbackRawBar[],
  ): Promise<void> {
    const db = await getDb();
    if (!db || rows.length === 0) return;
    for (const chunk of chunkArray(rows, MAX_ROWS_PER_STATEMENT)) {
      await db.insert(table).values(chunk.map((r) => ({
        datasetVersionId: r.datasetVersionId,
        eventId: r.eventId,
        symbol: r.symbol,
        tradeDate: r.tradeDate,
        relativeDay: r.relativeDay,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        amount: r.amount,
      }))).onDuplicateKeyUpdate({ set: { id: sql`${table.id}` } });
    }
  }

  async insertPaths(rows: FirstLimitPullbackPath[]): Promise<void> {
    const db = await getDb();
    if (!db || rows.length === 0) return;
    for (const chunk of chunkArray(rows, MAX_ROWS_PER_STATEMENT)) {
      await db.insert(firstLimitPullbackPaths).values(chunk.map((r) => ({
        datasetVersionId: r.datasetVersionId,
        eventId: r.eventId,
        symbol: r.symbol,
        tradeDate: r.tradeDate,
        relativeDay: r.relativeDay,
        highFromEventClose: r.highFromEventClose,
        lowFromEventClose: r.lowFromEventClose,
        closeFromEventClose: r.closeFromEventClose,
        pullbackFromEventHigh: r.pullbackFromEventHigh,
        volumeRatio: r.volumeRatio,
        isBreakout: r.isBreakout,
        breakoutPrice: r.breakoutPrice,
        daysToBreakout: r.daysToBreakout,
      }))).onDuplicateKeyUpdate({ set: { id: sql`${firstLimitPullbackPaths.id}` } });
    }
  }

  async insertOutcomes(rows: FirstLimitPullbackOutcome[]): Promise<void> {
    const db = await getDb();
    if (!db || rows.length === 0) return;
    for (const chunk of chunkArray(rows, MAX_ROWS_PER_STATEMENT)) {
      await db.insert(firstLimitPullbackOutcomes).values(chunk.map((r) => ({
        datasetVersionId: r.datasetVersionId,
        eventId: r.eventId,
        horizon: r.horizon,
        maxReturn: r.maxReturn,
        minReturn: r.minReturn,
        maxDrawdown: r.maxDrawdown,
        isBreakout: r.isBreakout,
        daysToBreakout: r.daysToBreakout,
      }))).onDuplicateKeyUpdate({ set: { id: sql`${firstLimitPullbackOutcomes.id}` } });
    }
  }
}
