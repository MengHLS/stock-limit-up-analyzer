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
  datasetBuildJobs,
  datasetDefinitions,
  datasetVersions,
  firstLimitPullbackEvents,
  firstLimitPullbackOutcomes,
  firstLimitPullbackPaths,
  indexDaily,
  industryAssignments,
  liquidityDaily,
  researchSecurityIdentifierHistory,
  researchSecurityStatusHistory,
  stockDailyPrices,
} from "../../drizzle/schema";
import { resolveSecurityStatus } from "../securityStatus/timeline";
import type { SecurityStatusInterval } from "../securityStatus/types";
import type { DatasetRegistryRepository } from "./registry";
import type {
  DatasetBuildJob,
  DatasetDefinition,
  DatasetVersion,
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
} from "./types";
import type { DatasetBuildIO, LiquidityEnrichment } from "./builder";
import type { DailyBar, StStatus } from "./detection";

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
}

// ===========================================================================
// 2. DbDatasetBuildIO
// ===========================================================================

/** 把 PIT ST 解析为 StStatus（NORMAL/ST/*ST/UNKNOWN）。 */
function stValueToStStatus(value: string | undefined): StStatus {
  if (value === "NORMAL" || value === "ST" || value === "*ST") return value;
  return "UNKNOWN";
}

export class DbDatasetBuildIO implements DatasetBuildIO {
  private stIndexPromise: Promise<{
    identifiersByCode: Map<string, { securityId: string; effectiveFrom: string; effectiveTo: string | null }[]>;
    stBySecurity: Map<string, SecurityStatusInterval[]>;
  }> | null = null;

  /** 惰性构建 code→securityId 与 securityId→ST 区间索引（全量加载一次，逐 bar 解析 O(1)）。 */
  private stIndex(): Promise<{
    identifiersByCode: Map<string, { securityId: string; effectiveFrom: string; effectiveTo: string | null }[]>;
    stBySecurity: Map<string, SecurityStatusInterval[]>;
  }> {
    if (!this.stIndexPromise) {
      this.stIndexPromise = this.buildStIndex();
    }
    return this.stIndexPromise;
  }

  private async buildStIndex(): Promise<{
    identifiersByCode: Map<string, { securityId: string; effectiveFrom: string; effectiveTo: string | null }[]>;
    stBySecurity: Map<string, SecurityStatusInterval[]>;
  }> {
    const db = await getDb();
    const identifiersByCode = new Map<string, { securityId: string; effectiveFrom: string; effectiveTo: string | null }[]>();
    const stBySecurity = new Map<string, SecurityStatusInterval[]>();
    if (!db) return { identifiersByCode, stBySecurity };

    const idRows = await db.select().from(researchSecurityIdentifierHistory);
    for (const row of idRows) {
      const fullCode = `${row.securityCode}.${row.exchange}`;
      const list = identifiersByCode.get(fullCode) ?? [];
      list.push({ securityId: row.securityId, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo });
      identifiersByCode.set(fullCode, list);
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
    return { identifiersByCode, stBySecurity };
  }

  async loadTradingDays(): Promise<string[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.selectDistinct({ tradeDate: indexDaily.tradeDate }).from(indexDaily).orderBy(asc(indexDaily.tradeDate));
    return rows.map((r) => r.tradeDate);
  }

  async fetchBarsForDay(tradeDate: string): Promise<DailyBar[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(stockDailyPrices).where(eq(stockDailyPrices.tradeDate, tradeDate)).orderBy(asc(stockDailyPrices.stockCode));
    return rows.map(rowToDailyBar);
  }

  async resolveSt(symbol: string, tradeDate: string): Promise<StStatus> {
    const { identifiersByCode, stBySecurity } = await this.stIndex();
    const candidates = identifiersByCode.get(symbol);
    if (!candidates || candidates.length === 0) return "UNKNOWN";
    const active = candidates.find((c) => c.effectiveFrom <= tradeDate && (c.effectiveTo === null || c.effectiveTo >= tradeDate));
    if (!active) return "UNKNOWN";
    const intervals = stBySecurity.get(active.securityId) ?? [];
    if (intervals.length === 0) return "UNKNOWN";
    const snapshot = resolveSecurityStatus(intervals, active.securityId, tradeDate);
    return stValueToStStatus(snapshot.resolved.ST?.statusValue);
  }

  async fetchSymbolBars(symbol: string, startDate: string, endDate: string): Promise<DailyBar[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(stockDailyPrices)
      .where(and(eq(stockDailyPrices.stockCode, symbol), gte(stockDailyPrices.tradeDate, startDate), lte(stockDailyPrices.tradeDate, endDate)))
      .orderBy(asc(stockDailyPrices.tradeDate));
    return rows.map(rowToDailyBar);
  }

  async fetchBarsRange(startDate: string, endDate: string): Promise<DailyBar[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(stockDailyPrices)
      .where(and(gte(stockDailyPrices.tradeDate, startDate), lte(stockDailyPrices.tradeDate, endDate)))
      .orderBy(asc(stockDailyPrices.tradeDate), asc(stockDailyPrices.stockCode));
    return rows.map(rowToDailyBar);
  }

  async fetchLiquidityForSymbols(symbols: string[], tradeDate: string): Promise<Map<string, LiquidityEnrichment>> {
    const result = new Map<string, LiquidityEnrichment>();
    if (symbols.length === 0) return result;
    const db = await getDb();
    if (!db) return result;
    const rows = await db.select().from(liquidityDaily)
      .where(and(eq(liquidityDaily.tradeDate, tradeDate), inArray(liquidityDaily.securityCode, symbols)));
    for (const row of rows) {
      result.set(row.securityCode, {
        turnover: row.turnoverRate,
        marketCap: row.totalMarketCap,
        floatMarketCap: row.circulationMarketCap,
      });
    }
    return result;
  }

  async fetchIndustryForSymbols(symbols: string[], tradeDate: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (symbols.length === 0) return result;
    const db = await getDb();
    if (!db) return result;
    const rows = await db.select().from(industryAssignments)
      .where(and(
        inArray(industryAssignments.securityCode, symbols),
        lte(industryAssignments.effectiveFrom, tradeDate),
      ))
      .orderBy(asc(industryAssignments.securityCode), asc(industryAssignments.effectiveFrom));
    // 与单行 fetchIndustry 口径一致：取 effectiveFrom 最早且仍覆盖 tradeDate 的归属（首条命中）。
    for (const row of rows) {
      if (result.has(row.securityCode)) continue;
      if (row.effectiveTo !== null && row.effectiveTo < tradeDate) continue;
      result.set(row.securityCode, row.industryCode);
    }
    return result;
  }

  async fetchLiquidity(symbol: string, tradeDate: string): Promise<LiquidityEnrichment | null> {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(liquidityDaily)
      .where(and(eq(liquidityDaily.securityCode, symbol), eq(liquidityDaily.tradeDate, tradeDate)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      turnover: row.turnoverRate,
      marketCap: row.totalMarketCap,
      floatMarketCap: row.circulationMarketCap,
    };
  }

  async fetchIndustry(symbol: string, tradeDate: string): Promise<string | null> {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(industryAssignments)
      .where(and(
        eq(industryAssignments.securityCode, symbol),
        lte(industryAssignments.effectiveFrom, tradeDate),
      ))
      .orderBy(asc(industryAssignments.effectiveFrom));
    // 选 effectiveFrom <= tradeDate 且 effectiveTo 覆盖 tradeDate 的最新归属。
    for (const row of rows) {
      if (row.effectiveTo === null || row.effectiveTo >= tradeDate) return row.industryCode;
    }
    return null;
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
      open: parseNumber(row.open),
      high: parseNumber(row.high),
      low: parseNumber(row.low),
      close: parseNumber(row.close),
      previousClose: parseNumber(row.previousClose),
      limitUpPrice: parseNumber(row.limitUpPrice),
      volume: parseNumber(row.volume),
      amount: parseNumber(row.amount),
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
    await db.insert(firstLimitPullbackEvents).values(rows.map((r) => ({
      datasetVersionId: r.datasetVersionId,
      eventId: r.eventId,
      symbol: r.symbol,
      tradeDate: r.tradeDate,
      market: r.market,
      industryCode: r.industryCode,
      boardType: r.boardType,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      previousClose: r.previousClose,
      limitUpPrice: r.limitUpPrice,
      volume: r.volume,
      amount: r.amount,
      turnover: r.turnover,
      isFirstLimit: r.isFirstLimit,
      previousLimitDate: r.previousLimitDate,
      daysSincePreviousLimit: r.daysSincePreviousLimit,
      historicalLimitCount: r.historicalLimitCount,
      marketCap: r.marketCap,
      floatMarketCap: r.floatMarketCap,
    }))).onDuplicateKeyUpdate({ set: { id: sql`${firstLimitPullbackEvents.id}` } });
  }

  async insertPaths(rows: FirstLimitPullbackPath[]): Promise<void> {
    const db = await getDb();
    if (!db || rows.length === 0) return;
    await db.insert(firstLimitPullbackPaths).values(rows.map((r) => ({
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
      turnover: r.turnover,
      returnFromEventClose: r.returnFromEventClose,
      highFromEventClose: r.highFromEventClose,
      lowFromEventClose: r.lowFromEventClose,
      closeFromEventClose: r.closeFromEventClose,
      pullbackFromEventClose: r.pullbackFromEventClose,
      pullbackFromEventHigh: r.pullbackFromEventHigh,
      volumeRatio: r.volumeRatio,
      isBreakout: r.isBreakout,
      breakoutPrice: r.breakoutPrice,
      daysToBreakout: r.daysToBreakout,
    }))).onDuplicateKeyUpdate({ set: { id: sql`${firstLimitPullbackPaths.id}` } });
  }

  async insertOutcomes(rows: FirstLimitPullbackOutcome[]): Promise<void> {
    const db = await getDb();
    if (!db || rows.length === 0) return;
    await db.insert(firstLimitPullbackOutcomes).values(rows.map((r) => ({
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
