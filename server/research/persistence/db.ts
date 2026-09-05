/**
 * STEP 6.2 — DB Persistence 实现（TiDB / MySQL，沿用现有 drizzle + getDb 基础设施）。
 *
 * 只做实验 / Run 记录的落库与读取；不引入新 ORM / 新库 / 队列。
 * 状态更新仅通过 updateStatus（受约束迁移由上层 Service 保证）。
 * 当前为同步读写；runId 唯一由 DB UNIQUE 约束兜底。
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { researchExperimentBatches, researchExperiments, researchRuns } from "../../../drizzle/schema";
import { toExperimentSnapshot } from "../experiment";
import { deserializeResearchExperimentSnapshot, serializeResearchExperimentSnapshot } from "../serialization";
import { deserializeResearchRunResultSummary, serializeResearchRunResultSummary } from "../run";
import { deserializeParameterSpace, serializeParameterSpace } from "../sweep";
import type { ResearchExperiment, ResearchExperimentStatus } from "../types";
import type { ResearchRun } from "../run";
import type { ExperimentBatch, SweepBatchStatus } from "../sweep";
import type { ExperimentRepository, ResearchRunRepository, SweepBatchRepository } from "./contract";

type ResearchExperimentRow = typeof researchExperiments.$inferSelect;
type ResearchRunRow = typeof researchRuns.$inferSelect;
type ResearchExperimentBatchRow = typeof researchExperimentBatches.$inferSelect;

/** Date / ISO 字符串 → ISO 字符串（null → ""，供领域对象字段兜底）。 */
function toIso(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? "" : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function rowToExperiment(row: ResearchExperimentRow): ResearchExperiment {
  const snapshot = deserializeResearchExperimentSnapshot(row.snapshotJson);
  return {
    ...snapshot,
    status: row.status,
    createdAt: toIso(row.createdAt),
  };
}

function rowToRun(row: ResearchRunRow): ResearchRun {
  return {
    runId: row.runId,
    experimentId: row.experimentId,
    status: row.status,
    startedAt: toIso(row.startedAt),
    finishedAt: row.finishedAt === null ? undefined : toIso(row.finishedAt),
    result: row.resultJson === null ? null : deserializeResearchRunResultSummary(row.resultJson),
    error: row.error,
    createdAt: toIso(row.createdAt),
  };
}

export class DbExperimentRepository implements ExperimentRepository {
  async create(experiment: ResearchExperiment): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法持久化实验");
    const snapshotJson = serializeResearchExperimentSnapshot(toExperimentSnapshot(experiment));
    await db.insert(researchExperiments).values({
      experimentId: experiment.experimentId,
      strategyId: experiment.strategyId,
      strategyVersion: experiment.strategyVersion,
      snapshotJson,
      status: experiment.status,
      createdAt: new Date(experiment.createdAt),
    });
  }

  async get(experimentId: string): Promise<ResearchExperiment | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(researchExperiments)
      .where(eq(researchExperiments.experimentId, experimentId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToExperiment(row);
  }

  async list(): Promise<ResearchExperiment[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(researchExperiments).orderBy(desc(researchExperiments.createdAt));
    return rows.map(rowToExperiment);
  }

  async updateStatus(experimentId: string, status: ResearchExperimentStatus): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法更新实验状态");
    await db.update(researchExperiments)
      .set({ status })
      .where(eq(researchExperiments.experimentId, experimentId));
  }

  async delete(experimentId: string): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法删除实验");
    const result = await db.delete(researchExperiments)
      .where(eq(researchExperiments.experimentId, experimentId));
    if (result[0].affectedRows === 0) {
      throw new Error(`未找到实验，无法删除：${experimentId}`);
    }
  }
}

export class DbResearchRunRepository implements ResearchRunRepository {
  async saveRun(run: ResearchRun): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法持久化 Run");
    const resultJson = run.result === null ? null : serializeResearchRunResultSummary(run.result);
    const existing = await db.select({ id: researchRuns.id }).from(researchRuns)
      .where(eq(researchRuns.runId, run.runId)).limit(1);
    if (existing.length > 0) {
      await db.update(researchRuns)
        .set({
          status: run.status,
          resultJson,
          error: run.error,
          finishedAt: run.finishedAt === undefined ? null : new Date(run.finishedAt),
        })
        .where(eq(researchRuns.runId, run.runId));
      return;
    }
    await db.insert(researchRuns).values({
      runId: run.runId,
      experimentId: run.experimentId,
      status: run.status,
      resultJson,
      error: run.error,
      startedAt: new Date(run.startedAt),
      finishedAt: run.finishedAt === undefined ? null : new Date(run.finishedAt),
      createdAt: new Date(run.createdAt),
    });
  }

  async getRun(runId: string): Promise<ResearchRun | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(researchRuns)
      .where(eq(researchRuns.runId, runId)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToRun(row);
  }

  async listRuns(experimentId?: string): Promise<ResearchRun[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = experimentId === undefined
      ? await db.select().from(researchRuns).orderBy(desc(researchRuns.createdAt))
      : await db.select().from(researchRuns)
        .where(eq(researchRuns.experimentId, experimentId))
        .orderBy(desc(researchRuns.createdAt));
    return rows.map(rowToRun);
  }
}

function rowToBatch(row: ResearchExperimentBatchRow): ExperimentBatch {
  return {
    batchId: row.batchId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    parameterSpace: deserializeParameterSpace(row.parameterSpaceJson),
    parameterSpaceFingerprint: row.parameterSpaceFingerprint,
    experimentIds: parseExperimentIds(row.experimentIdsJson),
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function parseExperimentIds(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) {
    throw new Error("反序列化批次 experimentIds 失败：不是字符串数组");
  }
  return parsed as string[];
}

export class DbSweepBatchRepository implements SweepBatchRepository {
  async create(batch: ExperimentBatch): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法持久化批次");
    await db.insert(researchExperimentBatches).values({
      batchId: batch.batchId,
      strategyId: batch.strategyId,
      strategyVersion: batch.strategyVersion,
      parameterSpaceJson: serializeParameterSpace(batch.parameterSpace),
      parameterSpaceFingerprint: batch.parameterSpaceFingerprint,
      experimentIdsJson: JSON.stringify(batch.experimentIds),
      status: batch.status,
      createdAt: new Date(batch.createdAt),
    });
  }

  async get(batchId: string): Promise<ExperimentBatch | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(researchExperimentBatches)
      .where(eq(researchExperimentBatches.batchId, batchId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToBatch(row);
  }

  async list(): Promise<ExperimentBatch[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(researchExperimentBatches).orderBy(desc(researchExperimentBatches.createdAt));
    return rows.map(rowToBatch);
  }

  async updateStatus(batchId: string, status: SweepBatchStatus): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法更新批次状态");
    await db.update(researchExperimentBatches)
      .set({ status })
      .where(eq(researchExperimentBatches.batchId, batchId));
  }
}
