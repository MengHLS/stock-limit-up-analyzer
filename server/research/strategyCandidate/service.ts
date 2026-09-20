/**
 * RESEARCH-006.2 / 006.3 — `StrategyCandidateService`：
 *   **Conclusion → Strategy Candidate**（006.2）与 **Candidate → Strategy 转正**（006.3）的业务入口。
 *
 * 架构依据：`docs/research/RESEARCH-006.0-architecture.md` §7 / §9 / §10.1 / §11.1~11.3 / §12。
 *
 * 006.2 已交付：候选的登记 / 读取 / 有限编辑 / 状态迁移（不写任何 `strategy_*` 表）。
 *
 * 006.3 的边界（本 STEP）：
 *   - ✅ `promote`：**唯一**能把候选写成 `CONVERTED` 并产生 Strategy Version 的业务入口；
 *   - ✅ definition 的**唯一**来源是 `definitionBuild.ts`，本文件不自行拼装定义（§7 / §27）；
 *   - ✅ 跨存储失败**不删除**已创建的 Strategy，只抛 `PROMOTE_WRITEBACK_FAILED` 并携带已生成的 id，
 *     由「provenance 幂等闸门 + 版本内容指纹」在重试时自愈（§25 / §26 / §39）；
 *   - ❌ 不做 `cloneVersion` / `origin=INHERITED` / 前端 / Backtest / Parameter Search（§32 / §36）。
 *
 * 三条不可让渡的纪律（006.2 起，006.3 继续）：
 *   ① **来源坐标只从上游复制**：`sourceDatasetVersionId` 恒取 `research_experiment.datasetVersionId`，
 *      调用方无法覆盖（006.0 §9 / §11.2）；
 *   ② **提不出就写 NULL**：`sourceResearchRunId` 需要 `evidence → analysisId → runId` 两跳解析，
 *      解析不唯一/查不到即 `null`，**绝不猜、绝不伪造**（006.0 §8.1）；
 *   ③ **Research 没研究出来的内容，Service 不猜**（006.2 §11 / 006.3 §8）：草稿缺什么就
 *      `PROMOTE_SKETCH_INCOMPLETE` 失败，绝不补默认买入 / 止盈 / 止损 / 持有天数 / 参数。
 */

import {
  RESEARCH_CANDIDATE_STATUSES,
  type ResearchCandidateStatus,
  type ResearchStrategyCandidate,
} from "../vocabulary";
// RESEARCH-EXPERIMENT-003 — 候选的状态机守卫与仓储都在**只服务候选**的模块里
// （旧 `ResearchRepositories` 聚合体已随旧 Research 删除）。
import { isCandidateTransitionAllowed } from "../candidateRules";
import type { ResearchStrategyCandidateRepository } from "../candidateRepository";
import {
  CANDIDATE_EDITABLE_FIELDS,
  CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES,
  CANDIDATE_TRANSITION_TARGETS,
  STRATEGY_CANDIDATE_ERROR,
  StrategyCandidateError,
  assertCandidateName,
  assertCandidateOverridesKeys,
  assertCandidateUpdateWhitelist,
  assertPromoteOverridesKeys,
  type StrategyCandidateUpdateInput,
} from "./candidateTypes";
import {
  PROMOTE_INITIAL_STRATEGY_VERSION,
  PROMOTE_INITIAL_VERSION_STATUS,
  buildExecutionAssumptions,
  buildStrategyDefinition,
  buildStrategyRecipe,
  deriveStrategyId,
  deriveUniverseIdForDataset,
  validateBuiltStrategyDefinition,
} from "./definitionBuild";
import type { StrategyPromotionPort } from "./strategyPromotionPort";
import type { StrategyResearchProvenanceRepository } from "./types";

// ---------------------------------------------------------------------------
// Dataset Registry 只读端口（注入式；缺省实现走真实 Registry）
// ---------------------------------------------------------------------------

/**
 * 研究来源 Dataset Version 的**只读**快照（只暴露登记候选 / 转正所需的事实）。
 * 不复制 Registry 版本表，也不新增第二套 Dataset 坐标（006.0 §9）。
 */
export interface DatasetVersionSnapshot {
  datasetVersionId: number;
  /** `dataset_version.version`（`v1` / `v2` / `rd-…`）——**仅 label**，不是引用坐标。 */
  label: string;
  /** `DRAFT` / `BUILDING` / `READY` / `FAILED`。 */
  status: string;
  /** `dataset_definition.id`（数值），仅作展示。 */
  datasetId: number;
  /**
   * `dataset_definition.datasetCode`（如 `first_limit_pullback`）—— 006.3 起转正需要它填
   * `definition.datasets[PRIMARY].datasetId`。读不到时**留空**，由 promote 响亮拒绝（不猜）。
   */
  datasetCode?: string;
}

export interface DatasetVersionReadPort {
  getVersionById(datasetVersionId: number): Promise<DatasetVersionSnapshot | undefined>;
}

// ---------------------------------------------------------------------------
// 视图（DTO）
// ---------------------------------------------------------------------------

export interface StrategyCandidateExperimentSummary {
  id: number;
  name: string;
  status: string;
  datasetVersionId: number;
}

export interface StrategyCandidateConclusionSummary {
  id: number;
  title: string;
  conclusionType: string;
  status: string;
  confidence: number | null;
}

export type StrategyCandidateSourceMissingReason = "EXPERIMENT" | "CONCLUSION" | "DATASET_VERSION";

/**
 * 候选读取视图：**候选本体 + 上游摘要 + 来源 Dataset label**。
 *
 * `sourceMissing` 是「快照而非 FK」的必然产物（006.0 §8.3）：上游行可能已被删除，
 * 读取时**如实标注**，不伪造、不自动清理、不因缺失而报错。
 */
export interface StrategyCandidateView {
  candidate: ResearchStrategyCandidate;
  experiment: StrategyCandidateExperimentSummary | null;
  conclusion: StrategyCandidateConclusionSummary | null;
  /** 来源 Dataset Version（由 `sourceDatasetVersionId` 现查 Registry 得到，不落列、不落副本）。 */
  dataset: DatasetVersionSnapshot | null;
  sourceMissing: StrategyCandidateSourceMissingReason[];
}

export interface CreateCandidateFromConclusionInput {
  conclusionId: number;
  /** 缺省 = 结论 `title`。 */
  name?: string;
  /** 缺省 = 结论正文（**原样引用**，不做改写）。 */
  description?: string | null;
  /** 人写的草图；**给到哪一项就以哪一项为准**（派生只补未给的部分）。 */
  overrides?: Partial<
    Pick<
      ResearchStrategyCandidate,
      "entryRule" | "filterRule" | "exitRule" | "riskRule" | "parameterSpace"
    >
  >;
  /**
   * PHASE-D-001 —— 是否启用 Evidence → Rule 确定性派生（缺省 **true**）。
   *
   * 显式传 `false` ⇒ 逐字回到修复前行为（草图 5 列只来自 `overrides`）——
   * 这条开关存在的唯一目的是让「零回归」可被**断言**，而不是靠描述。
   */
  deriveFromEvidence?: boolean;
}

export interface TransitionCandidateInput {
  candidateId: number;
  /** 目标状态字面量（由调用方给出；服务层做白名单 + 状态机双重判定）。 */
  to: string;
}

// ---------------------------------------------------------------------------
// promote（RESEARCH-006.3）
// ---------------------------------------------------------------------------

/**
 * `promote` 的 `overrides` —— **只有这两个键**（006.3 §4 / §12）。
 *
 * 🔴 不接受 `StrategyDefinition` / `strategyId` / `version` / `status`：
 * 定义只能由 `definitionBuild` 从候选草稿生成；允许调用方提交定义 = 用 API 直接写策略。
 */
export interface PromoteCandidateOverrides {
  /** 执行 Dataset 绑定（缺省 = 继承候选的研究来源坐标）。 */
  datasetBinding?: {
    /** `dataset_version.id` —— 唯一跨模块 Dataset 坐标。 */
    datasetVersionId?: number;
  };
  /** 研究来源 ≠ 执行绑定时的**人可读**原因；一致时**必须不填**（§13）。 */
  datasetDivergenceReason?: string;
}

export interface PromoteCandidateInput {
  candidateId: number;
  overrides?: PromoteCandidateOverrides;
}

/** 转正结果（§35；额外字段用于幂等与可审计性）。 */
export interface PromoteCandidateResult {
  candidateId: number;
  strategyId: string;
  /** `strategy_versions.id`（权威行锚）。 */
  strategyVersionId: number;
  /** semver（首次转正恒为 `1.0.0`）。 */
  strategyVersion: string;
  provenanceId: number;
  origin: "DIRECT";
  candidateStatus: "CONVERTED";
  /** 研究**来源**坐标（快照；可能为 null = 提不出）。 */
  sourceDatasetVersionId: number | null;
  /** 研究**来源** label（快照）。 */
  sourceDatasetLabel: string | null;
  /** **执行**绑定坐标（= `strategy_version_datasets.datasetVersionId`）。 */
  executionDatasetVersionId: number;
  /** 两者是否不同（不同时必有人可读原因）。 */
  datasetDivergence: boolean;
  sourceDatasetDivergenceReason: string | null;
  /** canonical 文档指纹（与 `strategy_versions.fingerprint` 一致）。 */
  fingerprint: string;
  /** `true` = 本次**没有**新建 Strategy / Version（幂等命中或跨存储恢复）。 */
  idempotent: boolean;
}

export interface StrategyCandidateService {
  get(candidateId: number): Promise<StrategyCandidateView>;
  /** 普通编辑：**只**改研究草图字段（闭集白名单）。 */
  update(candidateId: number, input: StrategyCandidateUpdateInput): Promise<ResearchStrategyCandidate>;
  /**
   * 生命周期迁移。🔴 `CONVERTED` **一律拒绝**（`CONVERSION_REQUIRES_PROMOTE`）：
   * 只有 006.3 的 `promote()` 才能产生「已转正」。
   */
  transition(input: TransitionCandidateInput): Promise<ResearchStrategyCandidate>;
  /**
   * 转正（人的动作 ②）：**唯一**的 Candidate → Strategy 业务入口（006.3 §2 / §3）。
   *
   * 顺序（§17，实际边界见实施报告）：
   *   载入 → 幂等闸门 → 状态门槛(ACCEPTED) → 来源完整性 → 解析执行 Dataset →
   *   build definition → validate definition → 组装文档 → 写 Strategy Version →
   *   写 provenance → 回写候选 CONVERTED → 复核。
   */
  promote(input: PromoteCandidateInput): Promise<PromoteCandidateResult>;
  /**
   * 读取某 Strategy Version 的 Research 溯源（006.4.1-B §20 ~ §23）。**只读**。
   *
   * 🔴 **可缺、绝不阻断**：溯源行或上游（候选 / 结论 / 实验 / Run / Dataset）不存在时，
   * 如实返回 `provenance: null` 或把缺失项列入 `missingUpstreams` —— **不抛错**。
   * 这是「Strategy 脱离 Research 仍能独立打开」的落点（§14 / §23 / §24）：
   * 溯源只解释「这策略从哪来」，**不参与**任何执行逻辑。
   */
  getVersionProvenance(input: PromotionProvenanceLookupInput): Promise<PromotionProvenanceView>;
}

/** 溯源查询入参 —— 只问 **Strategy 侧坐标**，不去查 Research（§24）。 */
export interface PromotionProvenanceLookupInput {
  /** `strategies.strategyId`。 */
  strategyId: string;
  /** semver 版本号（如 `1.0.0`）。 */
  version: string;
}

/**
 * 上游存活探测的取值集合（006.4.1-B §21 / §23）。
 * 探测**只影响展示**：列出来的意思是「这条来源现在已经查不到了」。
 */
export const PROMOTION_MISSING_UPSTREAMS = [
  "SOURCE_CANDIDATE",
  "SOURCE_CONCLUSION",
  "SOURCE_EXPERIMENT",
  "SOURCE_RESEARCH_RUN",
  "SOURCE_DATASET_VERSION",
  /**
   * RESEARCH-EXPERIMENT-002 —— 独立实验来源的「上游」是**实验定义本身**
   * （仓库里的 `research-experiments/**`，不是数据库行）。它被改名 / 删除后，
   * 溯源仍能读（快照值），但要在视图里如实标注 —— 与其它 missing 项同一纪律。
   */
  "SOURCE_EXPERIMENT_REF",
] as const;

export type PromotionMissingUpstream = (typeof PROMOTION_MISSING_UPSTREAMS)[number];

/**
 * Strategy Version 的 Research 溯源**视图**（display-only；006.4.1-B §21）。
 *
 * 四个概念的实际关系（§42 §7 要求说清）：
 *   - `provenance.*` = **研究来源快照**：promote 时刻冻结、零 FK，上游删除后仍可读；
 *   - `executionDatasetVersionId` = **执行绑定**：Strategy 侧事实（`strategy_version_datasets`
 *     的 doc 级 PRIMARY 镜像）—— 与研究来源**允许不同**，且它的权威落点是 Strategy 侧；
 *   - `sourceDatasetDivergenceReason` = 两者不同时由**人**在 promote 时填写的原因
 *     （**转正时的执行覆盖记录**，不是不可变来源快照的一部分 —— 候选在转正前没有任何写入路径）；
 *   - `missingUpstreams` = 上游存活探测结果（**只读、只展示**）。
 */
export interface PromotionProvenanceView {
  strategyId: string;
  version: string;
  /** `strategy_versions.id` 行锚；版本行读不到时为 `null`（不伪造）。 */
  strategyVersionId: number | null;
  /** 溯源快照；未转正 / 非本系统产出 / 溯源行缺失时为 `null`。 */
  provenance: {
    id: number;
    origin: string;
    /**
     * 来源体系（RESEARCH-EXPERIMENT-002）。
     *   - `RESEARCH_CONCLUSION`：旧 Research 链路 ⇒ 三个旧来源锚非空；
     *   - `INDEPENDENT_EXPERIMENT`：独立实验体系 ⇒ 三个旧来源锚**必为 null**，
     *     来源坐标改看 `experimentRef` / `experimentVersion` / `experimentResultDigest`。
     */
    sourceKind: string;
    sourceCandidateId: number | null;
    sourceConclusionId: number | null;
    sourceExperimentId: number | null;
    sourceResearchRunId: number | null;
    sourceDatasetVersionId: number | null;
    sourceDatasetLabel: string | null;
    /** 独立实验 id（`<group>/<key>`）；非独立实验来源时为 `null`。 */
    experimentRef: string | null;
    /** 实验自身版本快照。 */
    experimentVersion: string | null;
    /** 生成该策略时实际使用的实验参数快照（已归并默认值）。 */
    experimentParameters: unknown;
    /** 实验结果 canonical 指纹（服务端真实重跑后算出）。 */
    experimentResultDigest: string | null;
    createdAt: string | null;
  } | null;
  /** **执行**绑定坐标（Strategy 侧；与来源可不同）。 */
  executionDatasetVersionId: number | null;
  /** 执行绑定 label（Dataset Registry 读数；取不到即 `null`，不猜）。 */
  executionDatasetLabel: string | null;
  /** 来源 ≠ 执行时的人可读原因；一致 / 无记录时 `null`。 */
  sourceDatasetDivergenceReason: string | null;
  /** 已不存在的上游（**只列出，不抛错**）。 */
  missingUpstreams: readonly PromotionMissingUpstream[];
}

export interface StrategyCandidateServiceDeps {
  /** 候选仓储（只服务 `research_strategy_candidate` 一张表）。 */
  candidates: ResearchStrategyCandidateRepository;
  datasetVersions: DatasetVersionReadPort;
  /**
   * 006.3：Strategy 侧转正端口。**可选** —— 006.2 的四个能力完全不需要它
   * （不装配时 `promote` 会以配置错误响亮失败，而不是静默降级）。
   */
  strategies?: StrategyPromotionPort;
  /** 006.3：Strategy 侧溯源仓储（promote 幂等闸门 + 溯源写入）。 */
  provenance?: StrategyResearchProvenanceRepository;
  /**
   * RESEARCH-EXPERIMENT-002：独立实验注册表（只用来回答「`experimentRef` 指向的实验是否还存在」）。
   *
   * **可选**：未注入时**不做该探测、也绝不谎报 missing** —— 「没探测」与「探测到不存在」
   * 是两件事，把前者写成后者会凭空造出一条假告警（本仓反复踩过的「静默/误报」形态）。
   *
   * 只要求 `exists`：本层不需要读实验定义，**避免**为了一个存活探测把 DB / researchEngine
   * 拉进桥的运行时模块图（002 把「生产链不传递依赖旧 Research」做成了图可达性判据）。
   */
  experimentDefinitions?: { exists(id: string): boolean };
  // ⚠️ 这里**故意没有** `now`：版本追溯记录里的 `createdAt` / `codeVersion` 属于 Strategy 侧事实，
  //    统一由 `createStrategyPromotionPort({codeVersion, now})` 在端口构造时注入（同一事实只声明一处）。
  //    若在这里再放一个时钟，就会出现「同一次 promote 里两个时间源」的歧义。
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function createStrategyCandidateService(
  deps: StrategyCandidateServiceDeps,
): StrategyCandidateService {
  const { candidates: candidatesRepo, datasetVersions } = deps;

  async function requireCandidate(id: number): Promise<ResearchStrategyCandidate> {
    const candidate = await candidatesRepo.getById(id);
    if (!candidate) {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_FOUND,
        `未找到 Strategy Candidate：${id}`,
      );
    }
    return candidate;
  }

  async function buildView(candidate: ResearchStrategyCandidate): Promise<StrategyCandidateView> {
    const sourceMissing: StrategyCandidateSourceMissingReason[] = [];

    // 🔴 RESEARCH-EXPERIMENT-003 —— 上游 Experiment / Conclusion 属**旧 Research**
    // （表已归档、领域实现已整体删除）⇒ 本视图如实返回 `null`，并且**不再**把它们
    // 记进 `sourceMissing`：「上游层已经不存在」不是「上游丢了」，否则每条候选都会
    // 恒定显示「上游缺失」，把一条结构性事实伪装成数据异常。
    const experiment: StrategyCandidateExperimentSummary | null = null;
    const conclusion: StrategyCandidateConclusionSummary | null = null;

    let dataset: DatasetVersionSnapshot | null = null;
    if (isPositiveInt(candidate.sourceDatasetVersionId)) {
      const row = await datasetVersions.getVersionById(candidate.sourceDatasetVersionId);
      dataset = row ?? null;
      if (!dataset) sourceMissing.push("DATASET_VERSION");
    }

    return { candidate, experiment, conclusion, dataset, sourceMissing };
  }

  // =========================================================================
  // promote（RESEARCH-006.3）—— 唯一 Candidate → Strategy 转正入口
  // =========================================================================

  /** 装配检查：缺依赖是**配置缺陷**（不是领域错误），响亮失败而不是静默降级。 */
  function requirePromotionDeps(): {
    strategies: StrategyPromotionPort;
    provenance: StrategyResearchProvenanceRepository;
  } {
    if (deps.strategies === undefined || deps.provenance === undefined) {
      throw new Error(
        "promote 需要装配 Strategy 转正端口：请用 createStrategyPromotionPort() 与 "
          + "DbStrategyResearchProvenanceRepository 构造 Service（006.3 §25 的跨存储恢复依赖它们）",
      );
    }
    return { strategies: deps.strategies, provenance: deps.provenance };
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function normalizeOptionalText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
        `datasetDivergenceReason 必须是字符串，实际：${typeof value}`,
      );
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  /**
   * 解析**执行** Dataset（006.3 §11~§16）：缺省继承研究来源坐标；显式指定时校验存在 ∧ READY。
   * 唯一坐标 = `dataset_version.id`；`label` / `datasetId` 只从 Registry 取回，绝不自行拼装。
   */
  async function resolveExecutionDataset(requested: unknown): Promise<{
    datasetVersionId: number;
    label: string;
    datasetCode: string;
  }> {
    if (!isPositiveInt(requested)) {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_INVALID,
        `执行 Dataset 坐标必须是正整数（dataset_version.id），实际：${String(requested)}；`
          + "既没有 overrides.datasetBinding.datasetVersionId，候选也没有可继承的 sourceDatasetVersionId",
      );
    }
    const snapshot = await datasetVersions.getVersionById(requested);
    if (!snapshot) {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND,
        `执行 Dataset Version 不存在：${requested}（Dataset Registry 未自动创建，也不接受第二套坐标）`,
      );
    }
    if (snapshot.status !== "READY") {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY,
        `执行 Dataset Version ${requested}（${snapshot.label}）状态为 ${snapshot.status}，未 READY，`
          + "不得作为策略执行绑定",
      );
    }
    if (typeof snapshot.datasetCode !== "string" || snapshot.datasetCode.trim() === "") {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.DATASET_BINDING_INVALID,
        `无法解析 Dataset Version ${requested} 所属 Dataset 的业务码（dataset_definition.datasetCode）⇒ `
          + "definition.datasets[PRIMARY].datasetId 无权威取值；不猜、不伪造",
      );
    }
    return {
      datasetVersionId: snapshot.datasetVersionId,
      label: snapshot.label,
      datasetCode: snapshot.datasetCode,
    };
  }

  /**
   * 跨存储第二步：候选侧回写（§23 / §24 / §25）。
   *
   * 顺序：先写「来源分歧原因」（此时候选仍是 `ACCEPTED`，语义化入口才允许写），
   * 再写 `status=CONVERTED` + `strategyDefinitionId`（经既有
   * `assertCandidateTransition` + `assertCandidateConversionCoherence` 二次把关）。
   *
   * 🔴 任何一步失败都**不删除**已创建的 Strategy，只抛 `PROMOTE_WRITEBACK_FAILED`
   * 并携带 `strategyId` / `strategyVersionId` —— 重试由幂等闸门兜底（§25 / §26）。
   */
  async function commitCandidateConversion(args: {
    candidateId: number;
    strategyId: string;
    strategyVersionId: number;
    strategyVersion: string;
    divergence: boolean;
    divergenceReason: string | null;
  }): Promise<ResearchStrategyCandidate> {
    const details = {
      strategyId: args.strategyId,
      strategyVersionId: args.strategyVersionId,
      strategyVersion: args.strategyVersion,
    };
    if (args.divergence && args.divergenceReason !== null) {
      try {
        await candidatesRepo.setSourceDatasetDivergenceReason(args.candidateId, args.divergenceReason);
      } catch (error) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED,
          `Strategy ${args.strategyId}@${args.strategyVersion} 已创建，但写入「研究来源 ≠ 执行绑定」原因失败：`
            + `${errorMessage(error)}；已创建的 Strategy **不会被删除**，请重试 promote（幂等闸门会复用既有版本）`,
          { ...details, stage: "DIVERGENCE_REASON_WRITEBACK", cause: errorMessage(error) },
        );
      }
    }
    try {
      return await candidatesRepo.update(args.candidateId, {
        status: "CONVERTED",
        strategyDefinitionId: args.strategyId,
      });
    } catch (error) {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED,
        `Strategy ${args.strategyId}@${args.strategyVersion} 已创建，但候选回写 CONVERTED 失败：`
          + `${errorMessage(error)}；已创建的 Strategy **不会被删除**，请重试 promote（幂等闸门会复用既有版本）`,
        { ...details, stage: "CANDIDATE_WRITEBACK", cause: errorMessage(error) },
      );
    }
  }

  return {
    async get(candidateId) {
      return buildView(await requireCandidate(candidateId));
    },

    async update(candidateId, input) {
      // 闭集白名单（§15/§16）：越界字段**响亮失败**，不静默丢弃。
      assertCandidateUpdateWhitelist(input as Record<string, unknown>);
      await requireCandidate(candidateId);

      // 显式逐字段构造 patch（**不是** spread / Object.assign）：
      // 「哪些字段可写」由这份代码形状表达，将来新增字段默认不可写。
      const patch: StrategyCandidateUpdateInput = {};
      if (input.name !== undefined) patch.name = assertCandidateName(input.name);
      if (input.description !== undefined) patch.description = input.description;
      if (input.entryRule !== undefined) patch.entryRule = input.entryRule;
      if (input.filterRule !== undefined) patch.filterRule = input.filterRule;
      if (input.exitRule !== undefined) patch.exitRule = input.exitRule;
      if (input.riskRule !== undefined) patch.riskRule = input.riskRule;
      if (input.parameterSpace !== undefined) patch.parameterSpace = input.parameterSpace;
      if (Object.keys(patch).length === 0) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
          `未提供任何可更新的 Candidate 草图字段（可写集合：${CANDIDATE_EDITABLE_FIELDS.join(" / ")}）`,
        );
      }
      // 状态机 / 结构锚 / 来源快照一律不经此路径：仓储层还会用
      // `assertCandidateUpdatePatchKeys` + `assertCandidateTransition` 再挡一次。
      return candidatesRepo.update(candidateId, patch);
    },

    async transition(input) {
      // ① CONVERTED 是**架构裁定**，不是普通非法迁移 ⇒ 专属错误码（006.0 §10.1 / 006.2 §17）。
      if (input.to === "CONVERTED") {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.CONVERSION_REQUIRES_PROMOTE,
          "CONVERTED 只能由 RESEARCH-006.3 的 promote() 产生（需经 build StrategyDefinition → "
            + "validate → Dataset Registry 校验 → 写 Strategy Version），不能经 transition 直接进入",
        );
      }
      if (!(CANDIDATE_TRANSITION_TARGETS as readonly string[]).includes(input.to)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
          `transition 目标只能是 ${CANDIDATE_TRANSITION_TARGETS.join(" / ")}，实际：${input.to}`,
        );
      }
      if (!isPositiveInt(input.candidateId)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
          `candidateId 必须是正整数，实际：${String(input.candidateId)}`,
        );
      }
      const target = input.to as ResearchCandidateStatus;
      const current = await requireCandidate(input.candidateId);
      if (current.status === target) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
          `Candidate #${input.candidateId} 当前已是 ${target}，状态未变化（不返回假成功）`,
        );
      }
      // ② 复用既有状态机（**不是**第二套迁移表）。
      if (!isCandidateTransitionAllowed(current.status, target)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
          `非法候选状态迁移：${current.status} → ${target}`,
        );
      }
      const updated = await candidatesRepo.update(input.candidateId, { status: target });
      if (!(RESEARCH_CANDIDATE_STATUSES as readonly string[]).includes(updated.status)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
          `迁移后状态非法：${String(updated.status)}`,
        );
      }
      return updated;
    },

    /**
     * 转正（人的动作 ②）—— **唯一** Candidate → Strategy 入口（006.3 §2 / §3 / §17）。
     *
     * 顺序（每一步都先于副作用前完成校验；数据库边界见实施报告）：
     *   0 入参 → 1 载入 → 2 幂等闸门 → 3 状态门槛 → 4 来源完整性 → 5 执行 Dataset →
     *   6 build → 7 validate → 8 文档级假设 → 9 写 Strategy Version → 10 写 provenance →
     *   11 回写候选 → 12 复核。
     */
    async promote(input) {
      // ---- 0. 入参（§5.1 / §4）----
      if (!isPositiveInt(input.candidateId)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
          `candidateId 必须是正整数，实际：${String(input.candidateId)}`,
        );
      }
      if (input.overrides !== undefined && input.overrides !== null) {
        assertPromoteOverridesKeys(input.overrides as Record<string, unknown>);
      }
      const { strategies, provenance } = requirePromotionDeps();
      const candidateId = input.candidateId;

      // ---- 1. 载入候选（§5.2）----
      const candidate = await requireCandidate(candidateId);

      // ---- 2. 幂等闸门（§18 / §19）----
      //   闸门键 = provenance.sourceCandidateId（006.1 已建 UNIQUE(strategyVersionId) + 该查询）。
      //   命中 ⇒ 已经产出过策略：**绝不**再建第二份，直接复用既有结果（必要时补齐候选回写）。
      const existing = await provenance.getBySourceCandidateId(candidateId);
      if (existing !== undefined) {
        const provenanceId = existing.id;
        if (provenanceId === undefined) {
          throw new StrategyCandidateError(
            STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT,
            `候选 #${candidateId} 的 provenance 行缺少 id，无法作为幂等结果返回`,
          );
        }
        const inspected = await strategies.inspectVersion(existing.strategyId, existing.strategyVersion);
        // provenance 指向的版本行必须**读得到**：读不到就不是「已完成」，而是状态与溯源不一致。
        // 这里绝不退化成 null 让上层以为幂等成功（§53：不为「看起来成功」放宽规则）。
        if (inspected === undefined) {
          throw new StrategyCandidateError(
            STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT,
            `候选 #${candidateId} 的 provenance 指向 ${existing.strategyId}@${existing.strategyVersion}，`
              + "但该 Strategy 版本读不到 —— 溯源与 Strategy 侧事实不一致，需人工核对",
          );
        }
        if (inspected.datasetVersionId === null) {
          throw new StrategyCandidateError(
            STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT,
            `${existing.strategyId}@${existing.strategyVersion} 缺少 doc 级 Dataset 坐标 `
              + "（strategy_version_datasets 绑定缺失）—— 与转正契约不符，需人工核对",
          );
        }
        const executionDatasetVersionId = inspected.datasetVersionId;
        const sourceDatasetVersionId =
          isPositiveInt(existing.sourceDatasetVersionId) ? existing.sourceDatasetVersionId : null;
        const divergence = sourceDatasetVersionId !== null
          && executionDatasetVersionId !== sourceDatasetVersionId;

        // 幂等路径**绝不静默忽略**调用方输入（§53）：overrides 必须与已记录的事实相容，
        // 否则调用方会以为「我这次的绑定被采纳了」，而实际用的是上一次的。
        const requestedBinding = input.overrides?.datasetBinding?.datasetVersionId;
        if (requestedBinding !== undefined && requestedBinding !== executionDatasetVersionId) {
          throw new StrategyCandidateError(
            STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
            `候选 #${candidateId} 已转正并绑定执行 Dataset ${executionDatasetVersionId}，`
              + `不能再改绑到 ${requestedBinding}（转正是不可逆写；要换 Dataset 请新建候选）`,
          );
        }
        const reason = normalizeOptionalText(input.overrides?.datasetDivergenceReason);
        if (divergence) {
          if (candidate.status === "CONVERTED") {
            // 原因已在转正时作为历史事实落库 ⇒ 这里只做「不许改写」的核对。
            const recorded = candidate.sourceDatasetDivergenceReason ?? null;
            if (reason !== null && reason !== recorded) {
              throw new StrategyCandidateError(
                STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
                `已转正记录的 divergence 原因不可改写（记录：${String(recorded)}，本次：${reason}）`,
              );
            }
          } else if (reason === null) {
            // 跨存储恢复（§25）：Strategy / Version / provenance 都在，只差候选回写。
            throw new StrategyCandidateError(
              STRATEGY_CANDIDATE_ERROR.DATASET_DIVERGENCE_REASON_REQUIRED,
              `恢复转正仍需提供 datasetDivergenceReason（执行绑定 ${String(executionDatasetVersionId)} ≠ `
                + `研究来源 ${String(sourceDatasetVersionId)}）`,
            );
          }
        } else if (reason !== null) {
          throw new StrategyCandidateError(
            STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
            "执行绑定与研究来源一致，不存在 divergence；禁止填写 datasetDivergenceReason（一致时必须是 NULL）",
          );
        }

        let finalCandidate = candidate;
        if (candidate.status !== "CONVERTED") {
          if (candidate.status !== "ACCEPTED") {
            throw new StrategyCandidateError(
              STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT,
              `候选 #${candidateId} 状态为 ${candidate.status}，但 provenance 里已有其转正记录`
                + `（${existing.strategyId}@${existing.strategyVersion}）—— 状态与溯源不一致，需人工核对`,
            );
          }
          finalCandidate = await commitCandidateConversion({
            candidateId,
            strategyId: existing.strategyId,
            strategyVersionId: existing.strategyVersionId,
            strategyVersion: existing.strategyVersion,
            divergence,
            divergenceReason: divergence ? reason : null,
          });
        }

        return {
          candidateId,
          strategyId: existing.strategyId,
          strategyVersionId: existing.strategyVersionId,
          strategyVersion: existing.strategyVersion,
          provenanceId,
          origin: "DIRECT",
          candidateStatus: "CONVERTED",
          sourceDatasetVersionId,
          sourceDatasetLabel: existing.sourceDatasetLabel ?? null,
          executionDatasetVersionId,
          datasetDivergence: divergence,
          sourceDatasetDivergenceReason: finalCandidate.sourceDatasetDivergenceReason ?? null,
          // 幂等返回的指纹只能来自**真实版本行**（上面已强制 inspected 存在与坐标非空）。
          fingerprint: inspected.fingerprint,
          idempotent: true,
        };
      }

      // 已 CONVERTED 却查不到 provenance ⇒ 状态与溯源不一致（不许「看起来已完成」）。
      if (candidate.status === "CONVERTED") {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT,
          `候选 #${candidateId} 已是 CONVERTED，但 provenance 中查不到它产出的策略版本 —— `
            + "状态与溯源不一致（可疑：历史上被绕过 promote 直接改写状态），需人工核对",
        );
      }

      // ---- 3. 状态门槛：只有 ACCEPTED 允许转正（§5.3）----
      if (candidate.status !== "ACCEPTED") {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED,
          `只有 ACCEPTED 候选允许转正，Candidate #${candidateId} 当前状态为 ${candidate.status}`,
        );
      }

      // ---- 4. 来源完整性（§20：provenance 必填锚）----
      if (!isPositiveInt(candidate.conclusionId) || !isPositiveInt(candidate.experimentId)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.PROMOTE_SOURCE_INCOMPLETE,
          `候选 #${candidateId} 缺少 provenance 必填来源锚：`
            + `conclusionId=${String(candidate.conclusionId)} / experimentId=${String(candidate.experimentId)}`,
        );
      }
      const conclusionId = candidate.conclusionId;
      const experimentId = candidate.experimentId;

      // ---- 5. 执行 Dataset（§11 ~ §16）----
      const sourceDatasetVersionId = isPositiveInt(candidate.sourceDatasetVersionId)
        ? candidate.sourceDatasetVersionId
        : null;
      const requested = input.overrides?.datasetBinding?.datasetVersionId ?? candidate.sourceDatasetVersionId;
      const executionDataset = await resolveExecutionDataset(requested);
      const divergence = sourceDatasetVersionId !== null
        && executionDataset.datasetVersionId !== sourceDatasetVersionId;
      const providedReason = normalizeOptionalText(input.overrides?.datasetDivergenceReason);
      if (divergence && providedReason === null) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.DATASET_DIVERGENCE_REASON_REQUIRED,
          `执行绑定 Dataset Version ${executionDataset.datasetVersionId} 与研究来源 `
            + `${sourceDatasetVersionId} 不同，必须提供 overrides.datasetDivergenceReason（人可读原因）`,
        );
      }
      if (!divergence && providedReason !== null) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
          "执行绑定与研究来源一致，不存在 divergence；禁止填写 datasetDivergenceReason"
            + "（一致时必须是 NULL —— 「same dataset / inherit / N/A」这类占位文本不算原因）",
        );
      }
      const divergenceReason = divergence ? providedReason : null;
      const sourceDatasetLabel = sourceDatasetVersionId === null
        ? null
        : ((await datasetVersions.getVersionById(sourceDatasetVersionId))?.label ?? null);

      // ---- 6. build StrategyDefinition（唯一转换器；缺字段即响亮失败，绝不补默认）----
      const definitionInput = buildStrategyDefinition({
        candidate,
        executionDataset: {
          datasetVersionId: executionDataset.datasetVersionId,
          datasetVersionLabel: executionDataset.label,
          datasetCode: executionDataset.datasetCode,
        },
      });

      // ---- 7. validate StrategyDefinition（§10：失败 ⇒ 零 Strategy 数据）----
      const definition = validateBuiltStrategyDefinition(definitionInput);

      // ---- 8. 文档级执行假设（无法从 definition 派生，同样只能来自草稿）----
      const executionAssumptions = buildExecutionAssumptions(candidate);

      // ---- 8b. 执行配方引用（同样只能来自草稿；缺省 = 未声明）----
      // 🔴 缺 `recipe` ⇒ 装配层落 DEFAULT_STRATEGY_RECIPE_ID（「按涨跌幅取前 5 名」）
      // ⇒ 声明「守线 + 缩量」的策略在回测里跑的是别的东西。这是本次改造消灭的断点。
      const recipe = buildStrategyRecipe(candidate);

      const strategyId = deriveStrategyId(candidateId);
      const version = PROMOTE_INITIAL_STRATEGY_VERSION;

      // ---- 9. 写 Strategy + Version（复用 StrategyService；同事务 5 投影 + Binding 校验）----
      // `codeVersion` / `createdAt` 不在入参里：它们由端口构造时注入（同一条版本追溯事实只声明一次）。
      const creation = await strategies.createStrategyVersion({
        strategyId,
        version,
        name: candidate.name,
        ...(candidate.description === null || candidate.description === undefined
          ? {}
          : { description: candidate.description }),
        universe: { universeId: deriveUniverseIdForDataset(executionDataset.label) },
        definition,
        executionAssumptions,
        ...(recipe === undefined ? {} : { recipe }),
      });

      // ---- 10. 写 provenance（跨存储第二步）----
      let provenanceRow;
      try {
        provenanceRow = await provenance.create({
          strategyVersionId: creation.versionRowId,
          strategyId,
          strategyVersion: version,
          sourceCandidateId: candidateId,
          sourceConclusionId: conclusionId,
          sourceExperimentId: experimentId,
          sourceResearchRunId: candidate.sourceResearchRunId ?? null,
          sourceDatasetVersionId,
          sourceDatasetLabel,
          sourceSnapshotJson: candidate.sourceTraceJson ?? null,
          origin: "DIRECT",
        });
      } catch (error) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED,
          `Strategy ${strategyId}@${version} 已创建，但写入 strategy_research_provenance 失败：`
            + `${errorMessage(error)}；已创建的 Strategy **不会被删除**（§26），请重试 promote —— `
            + "重试会命中既有版本（指纹一致）并补齐溯源，绝不会产生第二份 Strategy",
          {
            strategyId,
            strategyVersionId: creation.versionRowId,
            strategyVersion: version,
            stage: "PROVENANCE_WRITEBACK",
            cause: errorMessage(error),
          },
        );
      }

      // ---- 11. 回写候选（先原因、后 CONVERTED；§23 / §24）----
      const converted = await commitCandidateConversion({
        candidateId,
        strategyId,
        strategyVersionId: creation.versionRowId,
        strategyVersion: version,
        divergence,
        divergenceReason,
      });

      // ---- 12. 复核（§31）----
      const inspected = await strategies.inspectVersion(strategyId, version);
      const provenanceId = provenanceRow.id;
      const writebackFailure: (reason: string) => never = (reason) => {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED,
          `转正复核失败：${reason}（Strategy ${strategyId}@${version} 已创建，不会被删除；请重试 promote）`,
          {
            strategyId,
            strategyVersionId: creation.versionRowId,
            strategyVersion: version,
            stage: "POST_WRITE_VERIFY",
          },
        );
      };
      if (inspected === undefined) writebackFailure("读不到刚写入的 Strategy Version");
      if (inspected.fingerprint !== creation.fingerprint) {
        writebackFailure(`版本指纹与本次写入不一致（${inspected.fingerprint} ≠ ${creation.fingerprint}）`);
      }
      if (!inspected.hasDefinition) writebackFailure("版本缺少 canonical definition");
      if (inspected.datasetBindingCount < 1) writebackFailure("版本没有 Dataset Binding 投影行");
      if (inspected.status !== PROMOTE_INITIAL_VERSION_STATUS) {
        writebackFailure(`版本初始状态应为 ${PROMOTE_INITIAL_VERSION_STATUS}，实际 ${inspected.status}`);
      }
      if (inspected.datasetVersionId !== executionDataset.datasetVersionId) {
        writebackFailure(
          `版本 doc 级 Dataset 坐标（${String(inspected.datasetVersionId)}）与执行绑定`
            + `（${executionDataset.datasetVersionId}）不一致`,
        );
      }
      if (provenanceId === undefined) writebackFailure("provenance 行缺少 id");
      const rereadProvenance = await provenance.getBySourceCandidateId(candidateId);
      if (rereadProvenance === undefined || rereadProvenance.sourceCandidateId !== candidateId) {
        writebackFailure("provenance.sourceCandidateId 与候选不一致");
      }
      if (rereadProvenance.strategyVersionId !== creation.versionRowId) {
        writebackFailure("provenance.strategyVersionId 与本次版本行不一致");
      }
      if (converted.status !== "CONVERTED" || converted.strategyDefinitionId !== strategyId) {
        writebackFailure(
          `候选回写结果不符（status=${converted.status} / strategyDefinitionId=${String(converted.strategyDefinitionId)}）`,
        );
      }

      return {
        candidateId,
        strategyId,
        strategyVersionId: creation.versionRowId,
        strategyVersion: version,
        provenanceId,
        origin: "DIRECT",
        candidateStatus: "CONVERTED",
        sourceDatasetVersionId,
        sourceDatasetLabel,
        executionDatasetVersionId: executionDataset.datasetVersionId,
        datasetDivergence: divergence,
        sourceDatasetDivergenceReason: divergenceReason,
        fingerprint: creation.fingerprint,
        idempotent: !creation.created,
      };
    },

    /**
     * 读取 Strategy Version 的 Research 溯源（006.4.1-B §20 ~ §23）。**只读、可缺、不阻断**。
     *
     * 实现纪律：
     *   - 只按 **Strategy 侧坐标**查（`strategyId` + semver），**不要求** Research 任何行存在；
     *   - 溯源行取 `listByStrategyId` 里 `strategyVersion` 相等那条 —— **不新增仓储方法**；
     *   - 上游存活探测**全部容错**：探测本身失败只记 `missingUpstreams`，绝不让读取失败；
     *   - 执行绑定 label 走 Dataset Registry **只读**端口，取不到即 `null`（不猜）。
     */
    async getVersionProvenance(input) {
      const strategyId = typeof input.strategyId === "string" ? input.strategyId.trim() : "";
      const version = typeof input.version === "string" ? input.version.trim() : "";
      if (strategyId === "" || version === "") {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
          "strategyId / version 都必须是非空字符串，实际："
            + `strategyId=${JSON.stringify(input.strategyId)} / version=${JSON.stringify(input.version)}`,
        );
      }
      const { strategies, provenance } = requirePromotionDeps();

      // ① 版本行事实（Strategy 侧）。读不到**不算错** —— 溯源快照行仍可能有。
      const inspected = await strategies.inspectVersion(strategyId, version);

      // ② 溯源快照行（同 strategyId 可能多版本，取 semver 相等那条）。
      const rows = await provenance.listByStrategyId(strategyId);
      const row = rows.find((r) => r.strategyVersion === version);

      // ③ 执行绑定 label（Dataset Registry 只读；取不到即 null）。
      const executionDatasetVersionId = inspected?.datasetVersionId ?? null;
      const executionDatasetLabel = executionDatasetVersionId === null
        ? null
        : ((await datasetVersions.getVersionById(executionDatasetVersionId))?.label ?? null);

      // ④ 上游存活探测 + divergence 原因（**探测失败只记 missing，绝不抛**）。
      //
      // 🔴 RESEARCH-EXPERIMENT-002：**只探测非空的来源锚**。
      //    `INDEPENDENT_EXPERIMENT` 来源的三个旧锚合法为 null（独立实验没有旧 Research
      //    坐标）⇒ 若照旧无条件探测，会把「本来就没有」误报成 `missingUpstreams`，
      //    即把「如实的缺失」伪装成「上游丢失」。
      const missing: PromotionMissingUpstream[] = [];
      let divergenceReason: string | null = null;
      if (row !== undefined) {
        const candidateId = row.sourceCandidateId ?? null;
        if (candidateId !== null) {
          const candidate = await candidatesRepo.getById(candidateId);
          if (candidate === undefined) {
            missing.push("SOURCE_CANDIDATE");
          } else {
            divergenceReason = candidate.sourceDatasetDivergenceReason ?? null;
          }
        }
        // 🔴 RESEARCH-EXPERIMENT-003 —— 旧 Research 的三个来源锚（candidate / conclusion /
        // experiment / researchRun）**不再探测**：它们指向的表已归档、领域层已删除。
        // 保留 `sourceCandidateId` 一项（候选仍在系统内，可探测），其余锚只作为**历史快照值**
        // 原样回显（见下方 provenance 返回体），不再参与「上游存活」判定。
        const sourceDatasetVersionId = row.sourceDatasetVersionId ?? null;
        if (
          sourceDatasetVersionId !== null
          && (await datasetVersions.getVersionById(sourceDatasetVersionId)) === undefined
        ) {
          missing.push("SOURCE_DATASET_VERSION");
        }
        // 独立实验来源：探测「实验定义是否仍在注册表里」。
        // 未注入注册表 ⇒ **不做探测、也不报 missing**（不把「没探测」伪装成「不存在」）。
        const experimentRef = row.experimentRef ?? null;
        if (experimentRef !== null && deps.experimentDefinitions !== undefined
          && !deps.experimentDefinitions.exists(experimentRef)) {
          missing.push("SOURCE_EXPERIMENT_REF");
        }
      }

      return {
        strategyId,
        version,
        strategyVersionId: inspected?.versionRowId ?? null,
        provenance: row === undefined || row.id === undefined
          ? null
          : {
              id: row.id,
              origin: row.origin,
              sourceKind: row.sourceKind ?? "RESEARCH_CONCLUSION",
              sourceCandidateId: row.sourceCandidateId ?? null,
              sourceConclusionId: row.sourceConclusionId ?? null,
              sourceExperimentId: row.sourceExperimentId ?? null,
              sourceResearchRunId: row.sourceResearchRunId ?? null,
              sourceDatasetVersionId: row.sourceDatasetVersionId ?? null,
              sourceDatasetLabel: row.sourceDatasetLabel ?? null,
              experimentRef: row.experimentRef ?? null,
              experimentVersion: row.experimentVersion ?? null,
              experimentParameters: row.experimentParametersJson ?? null,
              experimentResultDigest: row.experimentResultDigest ?? null,
              createdAt: row.createdAt ?? null,
            },
        executionDatasetVersionId,
        executionDatasetLabel,
        sourceDatasetDivergenceReason: divergenceReason,
        missingUpstreams: missing,
      };
    },
  };
}
