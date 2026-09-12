/**
 * RESEARCH-006.2 / 006.3 — `research.strategyCandidate.*` tRPC Router。
 *
 * 端点（006.0 §11.1 / 006.2 §19 / 006.3 §33，按项目既有命名规范呈现）：
 *   GET  research.strategyCandidate.get                  → publicProcedure
 *   POST research.strategyCandidate.createFromConclusion  → adminProcedure
 *   POST research.strategyCandidate.update                → adminProcedure
 *   POST research.strategyCandidate.transition            → adminProcedure
 *   POST research.strategyCandidate.promote               → adminProcedure（006.3 新增）
 *   GET  research.strategyCandidate.getVersionProvenance  → publicProcedure（006.4.1-B 新增，只读）
 *
 * 纪律：
 *   - **Router 只做**输入校验 / 权限 / 调 Service / 输出 DTO —— Conclusion 查询链、Dataset 解析、
 *     Evidence 解析、Candidate 映射、状态机、Definition 构建、Strategy 写入**全部**在
 *     `StrategyCandidateService`（006.2 §20 / 006.3 §34）；
 *   - 权限沿用项目既有体系（读 `publicProcedure` / 写 `adminProcedure`），**不新造**权限模型；
 *     🔴 `promote` 是**不可逆的跨模块写**，只开 `adminProcedure`，**不开放 public**（006.3 §33）；
 *   - 领域错误 → 稳定 tRPC code（与 `researchEngineRouter` 同风格）；
 *   - `promote` 的入参**只允许** `datasetBinding.datasetVersionId` 与 `datasetDivergenceReason`：
 *     调用方**永远不能**提交 StrategyDefinition / 文档正文（006.3 §4，`strictObject` + Service 闭集双闸）。
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
import { DbStrategyResearchProvenanceRepository } from "./provenance";
import { createStrategyPromotionPort } from "./strategyPromotionPort";
import {
  createStrategyCandidateService,
  type StrategyCandidateService,
} from "./service";
import {
  STRATEGY_PROVENANCE_ERROR,
  StrategyProvenanceError,
} from "./types";

// ---------------------------------------------------------------------------
// 领域码 → message（006.4.1-B §7）
// ---------------------------------------------------------------------------

/**
 * 领域码**必须**跨 tRPC 边界（006.4.1-B §7）：tRPC 的 `data.code` 只有语义大类
 * （`PRECONDITION_FAILED` / `BAD_REQUEST` / `CONFLICT` / …），**装不下**
 * `PROMOTE_SKETCH_INCOMPLETE` 这类业务码。不补的话，
 * `PROMOTE_SOURCE_INCOMPLETE` / `PROMOTE_SKETCH_INCOMPLETE` / `PROMOTE_DEFINITION_INVALID` /
 * `CANDIDATE_NOT_ACCEPTED` 会**塌缩成同一个** `PRECONDITION_FAILED`，前端无法给出不同提示。
 *
 * 复用仓库**既有**约定 `[DOMAIN_CODE] message`（先例：`server/research/disciplineFeedback/errors.ts`
 * 的 `super(\`[${code}] ${message}\`)`；消费端：`client/src/adapters/researchEngineAdapter.ts`
 * 的 `rpcErrorToDiagnostic` 用 `/\\[([A-Z_]{3,})\\]/u` 抠码）—— **不新造错误传输协议**。
 *
 * ⚠️ 只补前缀，**不改 tRPC code**（§7.2）。
 */
function withDomainCode(code: string, message: string): string {
  return `[${code}] ${message}`;
}

// ---------------------------------------------------------------------------
// 入参 schema（zod v4；`strictObject` ⇒ 未知字段直接 BAD_REQUEST，不静默丢弃）
// ---------------------------------------------------------------------------

const candidateIdInput = z.strictObject({ candidateId: z.number().int().positive() });

/** 溯源读取入参：**只按 Strategy 侧坐标**（`strategyId` + semver），不问 Research（§24）。 */
const provenanceLookupInput = z.strictObject({
  strategyId: z.string().min(1),
  version: z.string().min(1),
});

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

/**
 * `promote` 的 overrides：**只有两项**，且 `datasetBinding` 里**只有 `datasetVersionId`**。
 *
 * 🔴 这里是 006.3 §4 在传输层的落点：调用方**不能**提交 definition / 文档 / 参数空间 ——
 * 想改定义请回去改候选草稿（`update`），而不是在转正时绕过草稿直接塞一份定义进来。
 * `strictObject` 让 `{ definition: ... }` / `{ strategyId: ... }` / `{ datasetId: ... }`
 * 这类越界请求在传输层即 BAD_REQUEST；Service 的 `assertPromoteOverridesKeys` 是第二道防线。
 */
const promoteOverridesSchema = z
  .strictObject({
    datasetBinding: z
      .strictObject({ datasetVersionId: z.number().int().positive() })
      .optional(),
    datasetDivergenceReason: z.string().min(1).optional(),
  })
  .optional();

const promoteInput = z.strictObject({
  candidateId: z.number().int().positive(),
  overrides: promoteOverridesSchema,
});

// ---------------------------------------------------------------------------
// Router 构造
// ---------------------------------------------------------------------------

export interface StrategyCandidateRouterDeps {
  service: StrategyCandidateService;
}

/**
 * `PROMOTE_WRITEBACK_FAILED` 必须让调用方知道**已经建出来的东西是什么**
 * （006.3 §25 / §26：错误必须携带 `strategyId` / `strategyVersionId`，
 * 否则重试者无从判断「是新建还是恢复」）。把 details 关键项拼进 message，
 * 保证跨 tRPC 边界（`data.message`）也能读到。
 */
function describeDetails(details: Readonly<Record<string, unknown>> | undefined): string {
  if (details === undefined) return "";
  const keys = ["strategyId", "strategyVersionId", "strategyVersion", "stage"];
  const parts = keys
    .filter((key) => details[key] !== undefined)
    .map((key) => `${key}=${String(details[key])}`);
  return parts.length === 0 ? "" : `（${parts.join(" / ")}）`;
}

/** 领域错误 → 稳定 tRPC code（消息带 `[领域码]` 前缀，见 `withDomainCode`）。 */
function toTrpcError(e: unknown): never {
  if (e instanceof StrategyCandidateError) {
    const message = withDomainCode(e.code, e.message);
    switch (e.code) {
      case STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_FOUND:
      case STRATEGY_CANDIDATE_ERROR.EXPERIMENT_NOT_FOUND:
      case STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_FOUND:
      case STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND:
        throw new TRPCError({ code: "NOT_FOUND", message });
      case STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_CANDIDATE_ELIGIBLE:
      case STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY:
      case STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_INVALID:
      // --- 006.3 promote：前置条件不满足（不是调用方写错了参数，而是「现在不允许转正」）---
      case STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED:
      case STRATEGY_CANDIDATE_ERROR.PROMOTE_SOURCE_INCOMPLETE:
      case STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE:
      case STRATEGY_CANDIDATE_ERROR.PROMOTE_DEFINITION_INVALID:
        throw new TRPCError({ code: "PRECONDITION_FAILED", message });
      // --- 调用方给的东西本身不合法 ---
      case STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID:
      case STRATEGY_CANDIDATE_ERROR.DATASET_DIVERGENCE_REASON_REQUIRED:
      case STRATEGY_CANDIDATE_ERROR.DATASET_BINDING_INVALID:
        throw new TRPCError({ code: "BAD_REQUEST", message });
      case STRATEGY_CANDIDATE_ERROR.CANDIDATE_ALREADY_EXISTS:
      case STRATEGY_CANDIDATE_ERROR.CONVERSION_REQUIRES_PROMOTE:
      case STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID:
      // --- 006.3 promote：与既有事实冲突（身份 / 版本内容 / 状态与溯源不一致）---
      case STRATEGY_CANDIDATE_ERROR.PROMOTE_STRATEGY_ID_CONFLICT:
      case STRATEGY_CANDIDATE_ERROR.PROMOTE_VERSION_CONFLICT:
      case STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT:
        throw new TRPCError({ code: "CONFLICT", message });
      case STRATEGY_CANDIDATE_ERROR.INVALID_INPUT:
        throw new TRPCError({ code: "BAD_REQUEST", message });
      // 跨存储写回失败：Strategy 可能已经建出来了 ⇒ 必须让调用方看到「已产出什么、下一步重试即可」。
      // details（strategyId / strategyVersionId / strategyVersion / stage）同样拼进 message ——
      // 它是调用方判断「新建还是恢复」的唯一依据（006.3 §25 / §26；006.4.1-B §11）。
      case STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED:
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: withDomainCode(e.code, `${e.message} ${describeDetails(e.details)}`.trim()),
        });
      default:
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  }
  // 溯源仓储 —— 只读路径的错误也走同一套领域码前缀（前端据此区分 404 与入参错）。
  if (e instanceof StrategyProvenanceError) {
    throw new TRPCError({
      code: e.code === STRATEGY_PROVENANCE_ERROR.NOT_FOUND ? "NOT_FOUND" : "BAD_REQUEST",
      message: withDomainCode(e.code, e.message),
    });
  }
  // 仓储层（软引用完整性 / 既有候选状态机）——不吞、不改写语义，只做 code 映射。
  if (e instanceof ResearchReferenceError) {
    throw new TRPCError({ code: "NOT_FOUND", message: withDomainCode(e.code, e.message) });
  }
  if (e instanceof ResearchCandidateError) {
    // ⚠️ `ResearchCandidateError` **没有** `code` 字段（`researchCore/candidates.ts` 只带 message）
    // ⇒ 只透传原文，**不编造**领域码。
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  }
  if (e instanceof ResearchConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: withDomainCode(e.code, e.message) });
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
     * 🔴 `to = CONVERTED` 一律拒绝并指向 `promote`（006.2 §17 / 006.3 §3）：
     *    「已转正」**只能**由 promote 产生，状态机自己走不到那儿。
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

    /**
     * 转正（人的动作 ②）—— **唯一** Candidate → Strategy 入口（006.3 §2 / §3 / §33）。
     *
     * 输入只有 `candidateId` + 极窄 overrides；输出 DTO 至少含
     * `{ candidateId, strategyId, strategyVersionId, strategyVersion, provenanceId }`
     * （外加来源 / 执行 Dataset 坐标、divergence、指纹、`idempotent` 便于调用方判断重试语义）。
     *
     * 幂等：重复调用**不会**产生第二个 Strategy Version —— 第二次会命中
     * `strategy_research_provenance.sourceCandidateId` 闸门，返回同一份结果（`idempotent=true`）。
     */
    promote: adminProcedure
      .input(promoteInput)
      .mutation(async ({ input }) => {
        try {
          return await service.promote({
            candidateId: input.candidateId,
            ...(input.overrides === undefined ? {} : { overrides: input.overrides }),
          });
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * 读取某 Strategy Version 的 Research 溯源（006.4.1-B §20 ~ §23）—— **只读**。
     *
     * 为什么需要它：溯源表 `strategy_research_provenance` 只落在桥里，此前**没有任何读取入口**
     * ⇒ Strategy 侧 UI 无法展示「这策略从哪来」。本端点是**纯读**，位置在桥内（唯一同时看得见
     * 两侧模块的地方），**不引入第二套 Candidate → Strategy 转换**（§15）。
     *
     * 🔴 语义 = **可缺、不阻断**：溯源查询只回答「从哪来」，**绝不**成为 Strategy 能否打开的前提
     * （§14 / §23 / §24）。上游被删 ⇒ `missingUpstreams` 如实列出，本调用仍然成功。
     * 读权限与 `get` 同口径（`publicProcedure`）。
     */
    getVersionProvenance: publicProcedure
      .input(provenanceLookupInput)
      .query(async ({ input }) => {
        try {
          return await service.getVersionProvenance({
            strategyId: input.strategyId,
            version: input.version,
          });
        } catch (e) {
          toTrpcError(e);
        }
      }),
  });
}

export type StrategyCandidateRouter = ReturnType<typeof buildStrategyCandidateRouter>;

export interface StrategyCandidateRouterOptions {
  /** `composeCodeVersion` 产物；由入口注入（与 `researchRouter` 同口径）。缺省 `unknown`。 */
  readonly codeVersion?: string;
}

/**
 * 默认实例（真实 TiDB，惰性连接；Dataset 校验走 Dataset Registry 只读端口）。
 *
 * `codeVersion` 由**入口**注入（`researchRouter` 的 `CODE_VERSION`），缺省 `unknown` ——
 * 版本追溯记录宁可标记「未知」，也不编一个版本号（006.3 §17 / §53）。
 */
export function createDefaultStrategyCandidateRouter(
  options: StrategyCandidateRouterOptions = {},
): StrategyCandidateRouter {
  return buildStrategyCandidateRouter({
    service: createStrategyCandidateService({
      repos: createDbResearchRepositories(),
      datasetVersions: new RegistryDatasetVersionReadPort(),
      strategies: createStrategyPromotionPort(
        options.codeVersion === undefined ? {} : { codeVersion: options.codeVersion },
      ),
      provenance: new DbStrategyResearchProvenanceRepository(),
    }),
  });
}

/** 默认实例（`codeVersion` 缺省 `unknown`；入口若知版本请用 `createDefaultStrategyCandidateRouter`）。 */
export const strategyCandidateRouter = createDefaultStrategyCandidateRouter();
