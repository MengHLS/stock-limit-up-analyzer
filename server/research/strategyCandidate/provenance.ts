/**
 * RESEARCH-006.1 — Strategy 侧 Research 溯源仓储（DB / InMemory **同语义**双实现）。
 *
 * 语义对齐（与 `researchCore/repository` 同纪律）：
 *   - 同一批不变量、同一批错误码，差异仅在存储介质；
 *   - JSON 列（`sourceSnapshotJson`）走 `researchCore/serialization` 的编解码原子函数
 *     （不新造第二套 JSON 纪律）；
 *   - 零 FK ⇒ 「上游是否仍存在」**不在写入时校验**，只能读取时探测并如实标注。
 *
 * 为什么本文件在 `server/research/strategyCandidate/`：这是 006.0 §12 定义的**边界层**
 * —— 它是全项目**唯一**允许同时 import `researchCore` 与 Strategy 领域的地方。
 * `researchCore` 不得 import Strategy；`strategyPersistence` 不得 import `researchCore`。
 */

import { asc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { strategyResearchProvenance } from "../../../drizzle/schema";
import { decodeJson, encodeJson, toIso } from "../../researchCore/serialization";
import {
  STRATEGY_PROVENANCE_ERROR,
  StrategyProvenanceError,
  assertProvenanceInput,
  type StrategyResearchProvenance,
  type StrategyResearchProvenanceCreateInput,
  type StrategyResearchProvenanceRepository,
} from "./types";

type ProvenanceRow = typeof strategyResearchProvenance.$inferSelect;

/** MySQL / TiDB 唯一键冲突判定（先查后插之外的第二道防线；不依赖驱动文案）。 */
function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number } | null;
  return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
}

function mapRow(r: ProvenanceRow): StrategyResearchProvenance {
  return {
    id: r.id,
    strategyVersionId: r.strategyVersionId,
    strategyId: r.strategyId,
    strategyVersion: r.strategyVersion,
    sourceCandidateId: r.sourceCandidateId,
    sourceConclusionId: r.sourceConclusionId,
    sourceExperimentId: r.sourceExperimentId,
    sourceResearchRunId: r.sourceResearchRunId,
    sourceDatasetVersionId: r.sourceDatasetVersionId,
    sourceDatasetLabel: r.sourceDatasetLabel,
    sourceSnapshotJson: decodeJson(r.sourceSnapshotJson, "strategy_research_provenance.sourceSnapshotJson"),
    origin: r.origin as StrategyResearchProvenance["origin"],
    createdAt: toIso(r.createdAt) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// DB 实现
// ---------------------------------------------------------------------------

export class DbStrategyResearchProvenanceRepository implements StrategyResearchProvenanceRepository {
  private async requireDb() {
    const db = await getDb();
    if (!db) {
      throw new Error("数据库不可用（DATABASE_URL 未配置或连接失败），无法执行溯源持久化操作");
    }
    return db;
  }

  async create(input: StrategyResearchProvenanceCreateInput): Promise<StrategyResearchProvenance> {
    assertProvenanceInput(input);
    const db = await this.requireDb();
    const existing = await this.getByStrategyVersionId(input.strategyVersionId);
    if (existing) {
      throw new StrategyProvenanceError(
        STRATEGY_PROVENANCE_ERROR.ALREADY_EXISTS,
        `strategyVersionId=${input.strategyVersionId} 已有溯源行（一版本最多一条）`,
      );
    }
    try {
      const result = (await db.insert(strategyResearchProvenance).values({
        strategyVersionId: input.strategyVersionId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        sourceCandidateId: input.sourceCandidateId,
        sourceConclusionId: input.sourceConclusionId,
        sourceExperimentId: input.sourceExperimentId,
        sourceResearchRunId: input.sourceResearchRunId ?? null,
        sourceDatasetVersionId: input.sourceDatasetVersionId ?? null,
        sourceDatasetLabel: input.sourceDatasetLabel ?? null,
        sourceSnapshotJson: encodeJson(input.sourceSnapshotJson, "sourceSnapshotJson"),
        origin: input.origin ?? "DIRECT",
      })) as Array<{ insertId: number }>;
      const id = Number(result[0]?.insertId);
      if (!Number.isFinite(id)) throw new Error("溯源插入成功但未取得自增 id");
      const created = await this.getByStrategyVersionId(input.strategyVersionId);
      if (!created) throw new Error(`溯源创建后读取失败：strategyVersionId=${input.strategyVersionId}`);
      return created;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new StrategyProvenanceError(
          STRATEGY_PROVENANCE_ERROR.ALREADY_EXISTS,
          `strategyVersionId=${input.strategyVersionId} 已有溯源行（唯一约束）`,
        );
      }
      throw err;
    }
  }

  async getByStrategyVersionId(
    strategyVersionId: number,
  ): Promise<StrategyResearchProvenance | undefined> {
    const db = await this.requireDb();
    const rows = await db
      .select()
      .from(strategyResearchProvenance)
      .where(eq(strategyResearchProvenance.strategyVersionId, strategyVersionId))
      .limit(1);
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async listByStrategyId(strategyId: string): Promise<StrategyResearchProvenance[]> {
    const db = await this.requireDb();
    const rows = await db
      .select()
      .from(strategyResearchProvenance)
      .where(eq(strategyResearchProvenance.strategyId, strategyId))
      .orderBy(asc(strategyResearchProvenance.strategyVersionId));
    return rows.map(mapRow);
  }

  async getBySourceCandidateId(
    sourceCandidateId: number,
  ): Promise<StrategyResearchProvenance | undefined> {
    const db = await this.requireDb();
    const rows = await db
      .select()
      .from(strategyResearchProvenance)
      .where(eq(strategyResearchProvenance.sourceCandidateId, sourceCandidateId))
      .limit(1);
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async deleteByStrategyId(strategyId: string): Promise<number> {
    const db = await this.requireDb();
    const res = (await db
      .delete(strategyResearchProvenance)
      .where(eq(strategyResearchProvenance.strategyId, strategyId))) as Array<{ affectedRows: number }>;
    return Number(res[0]?.affectedRows ?? 0);
  }

  async deleteByStrategyVersionId(strategyVersionId: number): Promise<void> {
    const db = await this.requireDb();
    const res = (await db
      .delete(strategyResearchProvenance)
      .where(
        eq(strategyResearchProvenance.strategyVersionId, strategyVersionId),
      )) as Array<{ affectedRows: number }>;
    if (Number(res[0]?.affectedRows ?? 0) === 0) {
      throw new StrategyProvenanceError(
        STRATEGY_PROVENANCE_ERROR.NOT_FOUND,
        `删除失败，溯源不存在：strategyVersionId=${strategyVersionId}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// InMemory 实现（测试替身；与 DB 同语义）
// ---------------------------------------------------------------------------

export interface InMemoryStrategyProvenanceStore {
  rows: Array<StrategyResearchProvenance & { id: number }>;
}

export function createInMemoryStrategyResearchProvenanceRepository(options?: {
  now?: () => Date;
}): StrategyResearchProvenanceRepository & { store: InMemoryStrategyProvenanceStore } {
  const store: InMemoryStrategyProvenanceStore = { rows: [] };
  const now = options?.now ?? (() => new Date());
  let seq = 1;

  return {
    store,
    async create(input) {
      assertProvenanceInput(input);
      if (store.rows.some((r) => r.strategyVersionId === input.strategyVersionId)) {
        throw new StrategyProvenanceError(
          STRATEGY_PROVENANCE_ERROR.ALREADY_EXISTS,
          `strategyVersionId=${input.strategyVersionId} 已有溯源行（一版本最多一条）`,
        );
      }
      const row: StrategyResearchProvenance & { id: number } = {
        ...input,
        id: seq++,
        origin: input.origin ?? "DIRECT",
        sourceResearchRunId: input.sourceResearchRunId ?? null,
        sourceDatasetVersionId: input.sourceDatasetVersionId ?? null,
        sourceDatasetLabel: input.sourceDatasetLabel ?? null,
        sourceSnapshotJson: input.sourceSnapshotJson ?? null,
        createdAt: now().toISOString(),
      };
      store.rows.push(row);
      return { ...row };
    },
    async getByStrategyVersionId(strategyVersionId) {
      const found = store.rows.find((r) => r.strategyVersionId === strategyVersionId);
      return found ? { ...found } : undefined;
    },
    async listByStrategyId(strategyId) {
      return store.rows
        .filter((r) => r.strategyId === strategyId)
        .sort((a, b) => a.strategyVersionId - b.strategyVersionId)
        .map((r) => ({ ...r }));
    },
    async getBySourceCandidateId(sourceCandidateId) {
      const found = store.rows.find((r) => r.sourceCandidateId === sourceCandidateId);
      return found ? { ...found } : undefined;
    },
    async deleteByStrategyId(strategyId) {
      const before = store.rows.length;
      store.rows = store.rows.filter((r) => r.strategyId !== strategyId);
      return before - store.rows.length;
    },
    async deleteByStrategyVersionId(strategyVersionId) {
      const idx = store.rows.findIndex((r) => r.strategyVersionId === strategyVersionId);
      if (idx < 0) {
        throw new StrategyProvenanceError(
          STRATEGY_PROVENANCE_ERROR.NOT_FOUND,
          `删除失败，溯源不存在：strategyVersionId=${strategyVersionId}`,
        );
      }
      store.rows.splice(idx, 1);
    },
  };
}
