/**
 * RESEARCH-006.2 — `research.strategyCandidate.*` tRPC Router。
 *
 * 端点（006.0 §11.1 / 006.2 §19，按项目既有命名规范呈现）：
 *   GET  research.strategyCandidate.get                  → publicProcedure
 *   POST research.strategyCandidate.createFromConclusion → adminProcedure
 *   POST research.strategyCandidate.update               → adminProcedure
 *   POST research.strategyCandidate.transition           → adminProcedure
 *
 * 纪律：
 *   - **Router 只做**输入校验 / 权限 / 调 Service / 输出 DTO —— Conclusion 查询链、Dataset 解析、
 *     Evidence 解析、Candidate 映射、状态机**全部**在 `StrategyCandidateService`（006.2 §20）；
 *   - 权限沿用项目既有体系（读 `publicProcedure` / 写 `adminProcedure`），**不新造**权限模型；
 *   - 领域错误 → 稳定 tRPC code（与 `researchEngineRouter` 同风格）；
 *   - ❌ **不存在** `promote` / `createFromConclusion` 之外的自动转正路径（006.2 §2 / §29）。
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import {
  ResearchCandidateError,
  ResearchConflictError,
  ResearchReferenceError,
  createDbResearchRepositories,
} from "../../researchCore";
import {
  STRATEGY_CANDIDATE_ERROR,
  StrategyCandidateError,
} from "./candidateTypes";
import { RegistryDatasetVersionReadPort } from "./datasetVersionPort";
import {
  createStrategyCandidateService,
  type StrategyCandidateService,
} from "./service";

// ---------------------------------------------------------------------------
// 入参 schema（zod v4；`strictObject` ⇒ 未知字段直接 BAD_REQUEST，不静默丢弃）
// ---------------------------------------------------------------------------

const candidateIdInput = z.strictObject({ candidateId: z.number().int().positive() });

const overridesSchema = z
  .strictObject({
    entryRule: z.unknown().optional(),
    filterRule: z.unknown().optional(),
    exitRule: z.unknown().optional(),
    riskRule: z.unknown().optional(),
    parameterSpace: z.unknown().optional(),
  })
  .optional();

const createFromConclusionInput = z.strictObject({
  conclusionId: z.number().int().positive(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  overrides: overridesSchema,
});

/**
 * 普通 update 的 patch：**只列可编辑草图字段**。
 *
 * `strictObject` 让 `{ status: ... }` / `{ experimentId: ... }` 这类越界请求在**传输层**即被拒
 * （BAD_REQUEST，`unrecognized_keys`）；服务层的闭集白名单是第二道防线（§15 / §16）。
 */
const updateInput = z.strictObject({
  candidateId: z.number().int().positive(),
  patch: z.strictObject({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    entryRule: z.unknown().optional(),
    filterRule: z.unknown().optional(),
    exitRule: z.unknown().optional(),
    riskRule: z.unknown().optional(),
    parameterSpace: z.unknown().optional(),
  }),
});

const transitionInput = z.strictObject({
  candidateId: z.number().int().positive(),
  /**
   * 目标状态。`CONVERTED` **故意留在枚举里**：让它走到 Service 的专属拒绝
   * （`CONVERSION_REQUIRES_PROMOTE`）而不是被 zod 的「非枚举值」挡掉 ——
   * 调用方需要看到「要走 promote」这条架构信息，而不是一句 BAD_REQUEST。
   */
  to: z.enum(["REVIEW", "ACCEPTED", "REJECTED", "ARCHIVED", "CONVERTED"]),
});

// ---------------------------------------------------------------------------
// Router 构造
// ---------------------------------------------------------------------------

export interface StrategyCandidateRouterDeps {
  service: StrategyCandidateService;
}

/** 领域错误 → 稳定 tRPC code。 */
function toTrpcError(e: unknown): never {
  if (e instanceof StrategyCandidateError) {
    switch (e.code) {
      case STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_FOUND:
      case STRATEGY_CANDIDATE_ERROR.EXPERIMENT_NOT_FOUND:
      case STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_FOUND:
      case STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND:
        throw new TRPCError({ code: "NOT_FOUND", message: e.message });
      case STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_CANDIDATE_ELIGIBLE:
      case STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY:
      case STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_INVALID:
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
      case STRATEGY_CANDIDATE_ERROR.CANDIDATE_ALREADY_EXISTS:
      case STRATEGY_CANDIDATE_ERROR.CONVERSION_REQUIRES_PROMOTE:
      case STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID:
        throw new TRPCError({ code: "CONFLICT", message: e.message });
      case STRATEGY_CANDIDATE_ERROR.INVALID_INPUT:
        throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
      default:
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
    }
  }
  // 仓储层（软引用完整性 / 既有候选状态机）——不吞、不改写语义，只做 code 映射。
  if (e instanceof ResearchReferenceError) {
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  }
  if (e instanceof ResearchCandidateError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  }
  if (e instanceof ResearchConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  }
  throw e;
}

export function buildStrategyCandidateRouter(deps: StrategyCandidateRouterDeps) {
  const { service } = deps;

  return router({
    /** 读取候选（含 experiment / conclusion 摘要 + 来源 Dataset label；来源缺失如实标注）。 */
    get: publicProcedure
      .input(candidateIdInput)
      .query(async ({ input }) => {
        try {
          return await service.get(input.candidateId);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /** 登记候选（人的动作 ①）：Research Conclusion → Strategy Candidate。写操作 → admin。 */
    createFromConclusion: adminProcedure
      .input(createFromConclusionInput)
      .mutation(async ({ input }) => {
        try {
          return await service.createFromConclusion({
            conclusionId: input.conclusionId,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.overrides === undefined ? {} : { overrides: input.overrides }),
          });
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /** 有限编辑研究草图（白名单闭集；状态 / 结构锚 / 来源快照一律拒绝）。写 → admin。 */
    update: adminProcedure
      .input(updateInput)
      .mutation(async ({ input }) => {
        try {
          return await service.update(input.candidateId, input.patch);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * 生命周期迁移（写 → admin）。
     * 🔴 `to = CONVERTED` 一律拒绝并提示走未来 006.3 的 `promote`（§17）。
     */
    transition: adminProcedure
      .input(transitionInput)
      .mutation(async ({ input }) => {
        try {
          return await service.transition({ candidateId: input.candidateId, to: input.to });
        } catch (e) {
          toTrpcError(e);
        }
      }),
  });
}

/** 默认实例（真实 TiDB，惰性连接；Dataset 校验走 Dataset Registry 只读端口）。 */
export const strategyCandidateRouter = buildStrategyCandidateRouter({
  service: createStrategyCandidateService({
    repos: createDbResearchRepositories(),
    datasetVersions: new RegistryDatasetVersionReadPort(),
  }),
});

export type StrategyCandidateRouter = ReturnType<typeof buildStrategyCandidateRouter>;
