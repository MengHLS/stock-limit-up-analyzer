/**
 * RESEARCH-EXPERIMENT-003 —— 策略候选（`research_strategy_candidate`）的**唯一**仓储实现。
 *
 * ## 为什么重建一个「只服务候选」的仓储
 *
 * 旧实现住在 `server/researchCore/repository/{contract,db,inMemory}.ts`：一个 `ResearchRepositories`
 * 聚合体，一次性暴露 15 个实体的仓储（experiment / hypothesis / run / analysis / condition /
 * metric / result / conclusion / finding / artifact / template / question / plan / candidate …）。
 * 那 15 个实体里，**只有 candidate 在旧 Research 被删除后仍有业务位置**（规格 §4：
 * 候选可作为「策略创建过程中的过渡实体」保留）。
 *
 * 若继续保留聚合体，就必须保留 `research_analysis` / `research_conclusion` / `research_finding`
 * 等全部旧表对象与读写实现 —— 那等于把旧 Research 的运行时依赖留在生产代码里。
 * 因此本文件把候选切片**单独实现**（语义逐字对齐旧实现），聚合体与其余实体一并删除。
 *
 * ## 与旧实现的差异（有意为之，且只有这一处）
 *
 * 🔴 **本仓储不提供 `create`**：旧 `create` 的语义包含两条父引用存在性校验
 * （`research_experiment` / `research_conclusion`），而这两张表已随旧 Research 归档
 * ⇒ 该写入路径在结构上不再成立。候选因此成为**只读 + 编辑 + 转正的过渡实体**：
 * 既有行可查看、可改草图、可流转状态、可转正；不再有新的写入来源。
 * （008 的 §4 复核结论与 004 待办：候选的未来来源应是 Experiment，届时另开写入入口。）
 *
 * ## 不变量（与旧实现一致，逐条可断言）
 *
 *   - `update` 的 patch 携带硬拒字段（结构锚 `experimentId` / `conclusionId`、4 个 `source*`）
 *     ⇒ 当场抛错，不静默忽略（`assertCandidateUpdatePatchKeys`）；
 *   - `status` / `strategyDefinitionId` 只能按状态机迁移，且 `CONVERTED` 必须挂
 *     `strategyDefinitionId`（`assertCandidateTransition` + `assertCandidateConversionCoherence`）；
 *   - `sourceDatasetDivergenceReason` 是**历史事实快照**：写一次即定；相同值幂等返回；
 *     不同值**拒绝**（`setSourceDatasetDivergenceReason`，语义化单列入口）；
 *   - 目标行不存在 ⇒ `ResearchReferenceError`（稳定错误码，不返回 `undefined` 让调用方猜）。
 *
 * 零数据库 FK：引用合法性由应用层负责，本文件不引入任何跨表外键。
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { researchStrategyCandidate } from "../../drizzle/schema";
import {
  ResearchCandidateError,
  assertCandidateConversionCoherence,
  assertCandidateTransition,
  assertCandidateUpdatePatchKeys,
} from "./candidateRules";
import {
  RESEARCH_REFERENCE_ERROR,
  ResearchReferenceError,
} from "./candidateRepositoryErrors";
import { encodeJson, toIso } from "./jsonCodec";
import type { ResearchStrategyCandidate } from "./vocabulary";

// ---------------------------------------------------------------------------
// 契约
// ---------------------------------------------------------------------------

export interface ResearchCandidateListFilter {
  /** 按 Candidate 自身主键过滤。 */
  id?: number;
  experimentId?: number;
  conclusionId?: number;
  status?: ResearchStrategyCandidate["status"];
  strategyDefinitionId?: string;
  /** 按研究来源 Dataset Version 坐标（`dataset_version.id`）过滤。 */
  sourceDatasetVersionId?: number;
  /** 缺省不截断。 */
  limit?: number;
  /** 缺省 `"asc"`。 */
  order?: "asc" | "desc";
}

/** 普通更新补丁：只含人可编辑草图和状态机守卫字段（其余字段类型层即不可表达）。 */
export type ResearchStrategyCandidateUpdatePatch = Partial<
  Pick<
    ResearchStrategyCandidate,
    | "name"
    | "description"
    | "entryRule"
    | "filterRule"
    | "exitRule"
    | "riskRule"
    | "parameterSpace"
    | "status"
    | "strategyDefinitionId"
  >
>;

export interface ResearchStrategyCandidateRepository {
  getById(id: number): Promise<ResearchStrategyCandidate | undefined>;
  list(filter?: ResearchCandidateListFilter): Promise<ResearchStrategyCandidate[]>;
  update(id: number, patch: ResearchStrategyCandidateUpdatePatch): Promise<ResearchStrategyCandidate>;
  /** 语义化单列写入口：记录「研究来源 Dataset ≠ 执行绑定 Dataset」的原因（写一次即定）。 */
  setSourceDatasetDivergenceReason(id: number, reason: string): Promise<ResearchStrategyCandidate>;
  delete(id: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// 真实 DB 实现
// ---------------------------------------------------------------------------

type CandidateRow = typeof researchStrategyCandidate.$inferSelect;

function mapCandidate(row: CandidateRow): ResearchStrategyCandidate {
  return {
    id: row.id,
    experimentId: row.experimentId,
    conclusionId: row.conclusionId,
    strategyDefinitionId: row.strategyDefinitionId,
    name: row.name,
    description: row.description,
    entryRule: decodeField(row.entryRuleJson, "research_strategy_candidate.entryRuleJson"),
    filterRule: decodeField(row.filterRuleJson, "research_strategy_candidate.filterRuleJson"),
    exitRule: decodeField(row.exitRuleJson, "research_strategy_candidate.exitRuleJson"),
    riskRule: decodeField(row.riskRuleJson, "research_strategy_candidate.riskRuleJson"),
    parameterSpace: decodeField(row.parameterSpaceJson, "research_strategy_candidate.parameterSpaceJson"),
    sourceDatasetVersionId: row.sourceDatasetVersionId,
    sourceResearchRunId: row.sourceResearchRunId,
    sourceResearchPlanId: row.sourceResearchPlanId,
    sourceTraceJson: decodeField(row.sourceTraceJson, "research_strategy_candidate.sourceTraceJson"),
    sourceDatasetDivergenceReason: row.sourceDatasetDivergenceReason,
    sourceHypothesisId: row.sourceHypothesisId,
    sourceFindingIds: decodeField(
      row.sourceFindingIdsJson,
      "research_strategy_candidate.sourceFindingIdsJson",
    ) as ResearchStrategyCandidate["sourceFindingIds"],
    status: row.status as ResearchStrategyCandidate["status"],
    createdAt: toIso(row.createdAt) ?? undefined,
    updatedAt: toIso(row.updatedAt) ?? undefined,
  };
}

/** JSON 列解码（与 `jsonCodec.decodeJson` 同语义；此处只声明本地别名以免循环依赖）。 */
function decodeField<T = unknown>(text: string | null | undefined, field: string): T | undefined {
  if (text === null || text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${field} 不是合法 JSON：${String(text).slice(0, 120)}`);
  }
}

export function createDbResearchCandidateRepository(): ResearchStrategyCandidateRepository {
  async function requireDb() {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用（getDb() 返回 undefined）");
    return db;
  }

  const repo: ResearchStrategyCandidateRepository = {
    async getById(id) {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchStrategyCandidate)
        .where(eq(researchStrategyCandidate.id, id))
        .limit(1);
      return rows[0] ? mapCandidate(rows[0]) : undefined;
    },

    async list(filter: ResearchCandidateListFilter = {}) {
      const db = await requireDb();
      const conds = [];
      if (filter.id !== undefined) conds.push(eq(researchStrategyCandidate.id, filter.id));
      if (filter.experimentId !== undefined) {
        conds.push(eq(researchStrategyCandidate.experimentId, filter.experimentId));
      }
      if (filter.conclusionId !== undefined) {
        conds.push(eq(researchStrategyCandidate.conclusionId, filter.conclusionId));
      }
      if (filter.status !== undefined) conds.push(eq(researchStrategyCandidate.status, filter.status));
      if (filter.strategyDefinitionId !== undefined) {
        conds.push(eq(researchStrategyCandidate.strategyDefinitionId, filter.strategyDefinitionId));
      }
      if (filter.sourceDatasetVersionId !== undefined) {
        conds.push(
          eq(researchStrategyCandidate.sourceDatasetVersionId, filter.sourceDatasetVersionId),
        );
      }
      const ordered = (conds.length > 0
        ? db.select().from(researchStrategyCandidate).where(and(...conds))
        : db.select().from(researchStrategyCandidate)
      ).orderBy(
        filter.order === "desc"
          ? desc(researchStrategyCandidate.id)
          : asc(researchStrategyCandidate.id),
      );
      const rows = await (filter.limit === undefined ? ordered : ordered.limit(filter.limit));
      return rows.map(mapCandidate);
    },

    async update(id, patch) {
      const db = await requireDb();
      assertCandidateUpdatePatchKeys(patch as Record<string, unknown>);
      const current = await repo.getById(id);
      if (!current) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `更新失败，Candidate 不存在：${id}`,
        );
      }
      if (patch.status !== undefined && patch.status !== current.status) {
        assertCandidateTransition(current.status, patch.status);
      }
      const nextStatus = patch.status ?? current.status;
      const nextSid =
        patch.strategyDefinitionId === undefined
          ? current.strategyDefinitionId
          : patch.strategyDefinitionId;
      assertCandidateConversionCoherence({ status: nextStatus, strategyDefinitionId: nextSid });
      await db
        .update(researchStrategyCandidate)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.description === undefined ? {} : { description: patch.description }),
          ...(patch.entryRule === undefined
            ? {}
            : { entryRuleJson: encodeJson(patch.entryRule, "entryRuleJson") }),
          ...(patch.filterRule === undefined
            ? {}
            : { filterRuleJson: encodeJson(patch.filterRule, "filterRuleJson") }),
          ...(patch.exitRule === undefined
            ? {}
            : { exitRuleJson: encodeJson(patch.exitRule, "exitRuleJson") }),
          ...(patch.riskRule === undefined
            ? {}
            : { riskRuleJson: encodeJson(patch.riskRule, "riskRuleJson") }),
          ...(patch.parameterSpace === undefined
            ? {}
            : { parameterSpaceJson: encodeJson(patch.parameterSpace, "parameterSpaceJson") }),
          ...(patch.strategyDefinitionId === undefined
            ? {}
            : { strategyDefinitionId: patch.strategyDefinitionId }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
        })
        .where(eq(researchStrategyCandidate.id, id));
      const updated = await repo.getById(id);
      if (!updated) throw new Error(`Candidate 更新后读取失败：${id}`);
      return updated;
    },

    async setSourceDatasetDivergenceReason(id, reason) {
      const db = await requireDb();
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new ResearchCandidateError("sourceDatasetDivergenceReason 必须是非空字符串");
      }
      const current = await repo.getById(id);
      if (!current) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `写入来源分歧原因失败，Candidate 不存在：${id}`,
        );
      }
      const trimmed = reason.trim();
      const existing = current.sourceDatasetDivergenceReason ?? null;
      if (existing !== null) {
        if (existing === trimmed) return current;
        throw new ResearchCandidateError(
          `Candidate #${id} 已记录来源分歧原因（${existing}），不可改写为 ${trimmed}`,
        );
      }
      await db
        .update(researchStrategyCandidate)
        .set({ sourceDatasetDivergenceReason: trimmed })
        .where(eq(researchStrategyCandidate.id, id));
      const updated = await repo.getById(id);
      if (!updated) throw new Error(`Candidate 更新后读取失败：${id}`);
      return updated;
    },

    async delete(id) {
      const db = await requireDb();
      const res = await db
        .delete(researchStrategyCandidate)
        .where(eq(researchStrategyCandidate.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `删除失败，Candidate 不存在：${id}`,
        );
      }
    },
  };

  return repo;
}

// ---------------------------------------------------------------------------
// 内存替身（测试用；语义与真实实现逐条对齐）
// ---------------------------------------------------------------------------

export interface InMemoryCandidateSeed {
  rows?: readonly ResearchStrategyCandidate[];
  now?: () => Date;
}

/**
 * 构造内存替身。
 *
 * 🔴 纪律（与既有内存替身一致）：**外部持引用改写内部状态必须被阻断** ——
 * 真实 DB 每次查询都返回新对象，内存替身若直接回传内部数组元素，测试会掩盖真实缺陷。
 * 因此所有出参都做一层浅拷贝（JSON 字段再走 `JSON.parse(JSON.stringify(...))`）。
 */
export function createInMemoryResearchCandidateRepository(
  seed: InMemoryCandidateSeed = {},
): ResearchStrategyCandidateRepository {
  const now = seed.now ?? (() => new Date());
  const rows: Array<ResearchStrategyCandidate & { id: number }> = (seed.rows ?? []).map((row, index) => ({
    ...cloneJson(row),
    id: row.id ?? index + 1,
  }));
  let seq = rows.length;

  function cloneJson<T>(value: T): T {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function clone(row: ResearchStrategyCandidate & { id: number }): ResearchStrategyCandidate {
    return cloneJson(row);
  }

  function find(id: number): (ResearchStrategyCandidate & { id: number }) | undefined {
    return rows.find((row) => row.id === id);
  }

  const repo: ResearchStrategyCandidateRepository = {
    async getById(id) {
      const row = find(id);
      return row === undefined ? undefined : clone(row);
    },

    async list(filter: ResearchCandidateListFilter = {}) {
      let out = rows.slice();
      if (filter.id !== undefined) out = out.filter((r) => r.id === filter.id);
      if (filter.experimentId !== undefined) out = out.filter((r) => r.experimentId === filter.experimentId);
      if (filter.conclusionId !== undefined) out = out.filter((r) => r.conclusionId === filter.conclusionId);
      if (filter.status !== undefined) out = out.filter((r) => r.status === filter.status);
      if (filter.strategyDefinitionId !== undefined) {
        out = out.filter((r) => r.strategyDefinitionId === filter.strategyDefinitionId);
      }
      if (filter.sourceDatasetVersionId !== undefined) {
        out = out.filter((r) => r.sourceDatasetVersionId === filter.sourceDatasetVersionId);
      }
      out.sort((a, b) => (filter.order === "desc" ? b.id - a.id : a.id - b.id));
      if (filter.limit !== undefined) out = out.slice(0, filter.limit);
      return out.map(clone);
    },

    async update(id, patch) {
      assertCandidateUpdatePatchKeys(patch as Record<string, unknown>);
      const row = find(id);
      if (!row) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `更新失败，Candidate 不存在：${id}`,
        );
      }
      if (patch.status !== undefined && patch.status !== row.status) {
        assertCandidateTransition(row.status, patch.status);
      }
      const nextStatus = patch.status ?? row.status;
      const nextSid =
        patch.strategyDefinitionId === undefined ? row.strategyDefinitionId : patch.strategyDefinitionId;
      assertCandidateConversionCoherence({ status: nextStatus, strategyDefinitionId: nextSid });
      const next: ResearchStrategyCandidate & { id: number } = {
        ...row,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.entryRule === undefined ? {} : { entryRule: cloneJson(patch.entryRule) }),
        ...(patch.filterRule === undefined ? {} : { filterRule: cloneJson(patch.filterRule) }),
        ...(patch.exitRule === undefined ? {} : { exitRule: cloneJson(patch.exitRule) }),
        ...(patch.riskRule === undefined ? {} : { riskRule: cloneJson(patch.riskRule) }),
        ...(patch.parameterSpace === undefined ? {} : { parameterSpace: cloneJson(patch.parameterSpace) }),
        ...(patch.strategyDefinitionId === undefined
          ? {}
          : { strategyDefinitionId: patch.strategyDefinitionId }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        updatedAt: now().toISOString(),
      };
      const index = rows.findIndex((r) => r.id === id);
      rows[index] = next;
      return clone(next);
    },

    async setSourceDatasetDivergenceReason(id, reason) {
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new ResearchCandidateError("sourceDatasetDivergenceReason 必须是非空字符串");
      }
      const row = find(id);
      if (!row) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `写入来源分歧原因失败，Candidate 不存在：${id}`,
        );
      }
      const trimmed = reason.trim();
      const existing = row.sourceDatasetDivergenceReason ?? null;
      if (existing !== null) {
        if (existing === trimmed) return clone(row);
        throw new ResearchCandidateError(
          `Candidate #${id} 已记录来源分歧原因（${existing}），不可改写为 ${trimmed}`,
        );
      }
      row.sourceDatasetDivergenceReason = trimmed;
      row.updatedAt = now().toISOString();
      return clone(row);
    },

    async delete(id) {
      const index = rows.findIndex((r) => r.id === id);
      if (index < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `删除失败，Candidate 不存在：${id}`,
        );
      }
      rows.splice(index, 1);
    },
  };

  void seq;
  return repo;
}
