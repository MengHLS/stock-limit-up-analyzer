/**
 * STEP STRATEGY-002 — DB Strategy Persistence 实现（TiDB / MySQL，沿用 drizzle + getDb 基础设施）。
 *
 * 只做策略实体与不可变版本的落库与读取；不引入新 ORM / 新库 / 队列。
 * 幂等 / 指纹冲突 / 不可变（§7/§18/§19）：
 *   - saveVersion 先查后插（幂等 + 冲突判定），并发由 DB 唯一约束 (strategyId, version) 兜底；
 *   - 版本内容一经写入，绝不提供 UPDATE 入口（改内容必须新建版本）。
 * fingerprint 验证（§6）：读取时 deserializeStrategyVersionRecord / deserializeStrategyDocument
 * 会重算指纹并拒绝篡改（不静默接受）。
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { strategies, strategyVersions } from "../../../drizzle/schema";
import {
  deserializeStrategyDocument,
  deserializeStrategyVersionRecord,
  serializeStrategyDocument,
  serializeStrategyVersionRecord,
} from "../strategySchema/serialize";
import { compareStrategyVersions } from "../strategySchema/version";
import type { StrategyDocument, StrategyVersionRecord } from "../strategySchema/types";
import type {
  SaveVersionResult,
  StrategyEntityInput,
  StrategyRepository,
  StrategySummary,
  StrategyVersionInput,
  StrategyVersionSummary,
} from "./contract";

type StrategyRow = typeof strategies.$inferSelect;
type StrategyVersionRow = typeof strategyVersions.$inferSelect;

/** MySQL 唯一约束冲突错误码（并发兜底）。 */
const ER_DUP_ENTRY = 1062;

/** Date / ISO 字符串 → ISO 字符串（null → ""）。 */
function toIso(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? "" : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function rowToSummary(row: StrategyRow): StrategySummary {
  return {
    strategyId: row.strategyId,
    name: row.name,
    latestVersion: row.latestVersion,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function rowToVersionSummary(row: StrategyVersionRow): StrategyVersionSummary {
  return {
    strategyId: row.strategyId,
    version: row.version,
    fingerprint: row.fingerprint,
    datasetVersion: row.datasetVersion,
    universeId: row.universeId,
    codeVersion: row.codeVersion,
    createdAt: toIso(row.createdAt),
  };
}

function isDupEntry(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const err = error as { errno?: unknown; code?: unknown };
  return err.errno === ER_DUP_ENTRY || err.code === "ER_DUP_ENTRY";
}

export class DbStrategyRepository implements StrategyRepository {
  async saveStrategy(input: StrategyEntityInput): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法持久化策略");
    const existing = await db.select({ id: strategies.id })
      .from(strategies)
      .where(eq(strategies.strategyId, input.strategyId))
      .limit(1);
    if (existing.length > 0) {
      await db.update(strategies)
        .set({
          name: input.name,
          latestVersion: input.latestVersion,
          status: input.status,
        })
        .where(eq(strategies.strategyId, input.strategyId));
      return;
    }
    await db.insert(strategies).values({
      strategyId: input.strategyId,
      name: input.name,
      latestVersion: input.latestVersion,
      status: input.status,
    });
  }

  async getStrategy(strategyId: string): Promise<StrategySummary | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(strategies)
      .where(eq(strategies.strategyId, strategyId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToSummary(row);
  }

  async listStrategies(): Promise<StrategySummary[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(strategies).orderBy(desc(strategies.updatedAt));
    return rows.map(rowToSummary);
  }

  async deleteStrategy(strategyId: string): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法删除策略");
    // 级联：先删版本，再删实体（无 FK，应用层保证顺序）。
    await db.delete(strategyVersions).where(eq(strategyVersions.strategyId, strategyId));
    const result = await db.delete(strategies).where(eq(strategies.strategyId, strategyId));
    if (result[0].affectedRows === 0) {
      throw new Error(`未找到策略，无法删除：${strategyId}`);
    }
  }

  async saveVersion(input: StrategyVersionInput): Promise<SaveVersionResult> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法持久化策略版本");
    const { strategyId } = input;
    const version = input.document.version;
    const fingerprint = input.document.fingerprint;

    const existing = await db.select({ fingerprint: strategyVersions.fingerprint })
      .from(strategyVersions)
      .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.version, version)))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].fingerprint === fingerprint) {
        return { outcome: "idempotent-skip", version, fingerprint };
      }
      return {
        outcome: "conflict",
        version,
        fingerprint,
        existingFingerprint: existing[0].fingerprint,
      };
    }

    const strategyDocumentJson = serializeStrategyDocument(input.document);
    const versionRecordJson = serializeStrategyVersionRecord(input.versionRecord);
    try {
      await db.insert(strategyVersions).values({
        strategyId,
        version,
        strategyDocumentJson,
        versionRecordJson,
        fingerprint,
        datasetVersion: input.document.datasetVersion,
        universeId: input.document.universe.universeId,
        codeVersion: input.versionRecord.codeVersion,
        createdAt: new Date(input.versionRecord.createdAt),
      });
    } catch (error) {
      if (isDupEntry(error)) {
        // 并发兜底：唯一约束冲突 → 重新判定幂等 vs 冲突。
        const raced = await db.select({ fingerprint: strategyVersions.fingerprint })
          .from(strategyVersions)
          .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.version, version)))
          .limit(1);
        if (raced.length > 0 && raced[0].fingerprint === fingerprint) {
          return { outcome: "idempotent-skip", version, fingerprint };
        }
        return {
          outcome: "conflict",
          version,
          fingerprint,
          existingFingerprint: raced[0]?.fingerprint,
        };
      }
      throw error;
    }
    return { outcome: "inserted", version, fingerprint };
  }

  async getVersion(strategyId: string, version: string): Promise<StrategyVersionRecord | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(strategyVersions)
      .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.version, version)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return undefined;
    // 反序列化含指纹复核（篡改即抛错，不静默接受，§6）。
    return deserializeStrategyVersionRecord(row.versionRecordJson);
  }

  async listVersions(strategyId: string): Promise<StrategyVersionSummary[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(strategyVersions)
      .where(eq(strategyVersions.strategyId, strategyId))
      .orderBy(desc(strategyVersions.createdAt));
    return rows
      .map(rowToVersionSummary)
      .sort((a, b) => compareStrategyVersions(b.version, a.version));
  }

  async getLatestVersion(strategyId: string): Promise<StrategyVersionRecord | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(strategyVersions)
      .where(eq(strategyVersions.strategyId, strategyId));
    if (rows.length === 0) return undefined;
    let latest = rows[0];
    for (const row of rows) {
      if (compareStrategyVersions(row.version, latest.version) > 0) {
        latest = row;
      }
    }
    return deserializeStrategyVersionRecord(latest.versionRecordJson);
  }
}

/** 反序列化策略本体（供 load 复用；含指纹复核）。 */
export function deserializeStoredDocument(json: string): StrategyDocument {
  return deserializeStrategyDocument(json);
}
