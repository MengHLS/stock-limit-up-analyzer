/**
 * STEP 7.3 — DB-backed Checkpoint 存储。
 *
 * 依赖 `backfill_checkpoints` 表（schema + migration 0016）。upsert 语义（onDuplicateKeyUpdate），
 * 由 tradeDate 唯一约束承担最终一致性。表未迁移时读写会抛出明确错误，提示先应用 migration 0016。
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../db";
import { backfillCheckpoints } from "../../drizzle/schema";
import type { BackfillCheckpoint, CheckpointStore } from "./types";

function toIso(date: Date | null): string | null {
  return date ? new Date(date).toISOString() : null;
}

function rowToCheckpoint(row: typeof backfillCheckpoints.$inferSelect): BackfillCheckpoint {
  return {
    tradeDate: row.tradeDate,
    status: row.status,
    attempts: row.attempts,
    rowCount: row.rowCount,
    receivedRows: row.receivedRows,
    completedAt: toIso(row.completedAt),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  };
}

/** DB-backed checkpoint store。 */
export class DbCheckpointStore implements CheckpointStore {
  async get(tradeDate: string): Promise<BackfillCheckpoint | null> {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(backfillCheckpoints).where(eq(backfillCheckpoints.tradeDate, tradeDate));
    return rows[0] ? rowToCheckpoint(rows[0]) : null;
  }

  async set(checkpoint: BackfillCheckpoint): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法写入 backfill checkpoint");
    await db.insert(backfillCheckpoints).values({
      tradeDate: checkpoint.tradeDate,
      status: checkpoint.status,
      attempts: checkpoint.attempts,
      rowCount: checkpoint.rowCount,
      receivedRows: checkpoint.receivedRows,
      completedAt: checkpoint.completedAt ? new Date(checkpoint.completedAt) : null,
      errorCode: checkpoint.errorCode,
      errorMessage: checkpoint.errorMessage,
    }).onDuplicateKeyUpdate({
      set: {
        status: checkpoint.status,
        attempts: checkpoint.attempts,
        rowCount: checkpoint.rowCount,
        receivedRows: checkpoint.receivedRows,
        completedAt: checkpoint.completedAt ? new Date(checkpoint.completedAt) : null,
        errorCode: checkpoint.errorCode,
        errorMessage: checkpoint.errorMessage,
        updatedAt: new Date(),
      },
    });
  }

  async list(startDate: string, endDate: string): Promise<BackfillCheckpoint[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(backfillCheckpoints)
      .where(and(gte(backfillCheckpoints.tradeDate, startDate), lte(backfillCheckpoints.tradeDate, endDate)))
      .orderBy(backfillCheckpoints.tradeDate);
    return rows.map(rowToCheckpoint);
  }
}
