/**
 * RESEARCH-006.2 — `StrategyCandidateService`：**Conclusion → Strategy Candidate** 的业务入口。
 *
 * 架构依据：`docs/research/RESEARCH-006.0-architecture.md` §7 / §9 / §10.1 / §11.1~11.2 / §12。
 *
 * 边界（本 STEP 的硬约束）：
 *   - ✅ 只做 **候选的登记 / 读取 / 有限编辑 / 状态迁移**；
 *   - ❌ **不做** `promote` / `cloneVersion` / 构建 `StrategyDefinition` / 写任何 `strategy_*` 表
 *     （006.2 §2；promote 属 006.3）；
 *   - ❌ 本文件**不 import** `strategyPersistence` / `strategySchema`（§21）。
 *
 * 三条不可让渡的纪律：
 *   ① **来源坐标只从上游复制**：`sourceDatasetVersionId` 恒取 `research_experiment.datasetVersionId`，
 *      调用方无法覆盖（006.0 §9 / §11.2）；
 *   ② **提不出就写 NULL**：`sourceResearchRunId` 需要 `evidence → analysisId → runId` 两跳解析，
 *      解析不唯一/查不到即 `null`，**绝不猜、绝不伪造**（006.0 §8.1）；
 *   ③ **Research 没研究出来的内容，Service 不猜**（006.2 §11）：`entryRule` / `exitRule` /
 *      `riskRule` / `parameterSpace` 只接受调用方（人）显式传入的 `overrides`，
 *      真实 Conclusion 结构里没有策略规则信息，就**不生成**。
 */

import {
  RESEARCH_CANDIDATE_STATUSES,
  isCandidateTransitionAllowed,
  type ResearchCandidateStatus,
  type ResearchConclusion,
  type ResearchRepositories,
  type ResearchStrategyCandidate,
} from "../../researchCore";
import {
  CANDIDATE_EDITABLE_FIELDS,
  CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES,
  CANDIDATE_TRANSITION_TARGETS,
  STRATEGY_CANDIDATE_ERROR,
  StrategyCandidateError,
  assertCandidateName,
  assertCandidateOverridesKeys,
  assertCandidateUpdateWhitelist,
  type StrategyCandidateUpdateInput,
} from "./candidateTypes";
import {
  buildSourceTrace,
  evidenceAnalysisIdCandidates,
  parseConclusionEvidence,
  type RunResolution,
} from "./evidenceTrace";

// ---------------------------------------------------------------------------
// Dataset Registry 只读端口（注入式；缺省实现走真实 Registry）
// ---------------------------------------------------------------------------

/**
 * 研究来源 Dataset Version 的**只读**快照（只暴露登记候选所需的三件事）。
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
  /** 人写的草图；不传即留空（**不自动生成**）。 */
  overrides?: Partial<
    Pick<
      ResearchStrategyCandidate,
      "entryRule" | "filterRule" | "exitRule" | "riskRule" | "parameterSpace"
    >
  >;
}

export interface TransitionCandidateInput {
  candidateId: number;
  /** 目标状态字面量（由调用方给出；服务层做白名单 + 状态机双重判定）。 */
  to: string;
}

export interface StrategyCandidateService {
  /**
   * 登记候选（人的动作 ①）。校验链顺序固定，逐条响亮失败（006.0 §11.2）。
   */
  createFromConclusion(input: CreateCandidateFromConclusionInput): Promise<StrategyCandidateView>;
  get(candidateId: number): Promise<StrategyCandidateView>;
  /** 普通编辑：**只**改研究草图字段（闭集白名单）。 */
  update(candidateId: number, input: StrategyCandidateUpdateInput): Promise<ResearchStrategyCandidate>;
  /**
   * 生命周期迁移。🔴 `CONVERTED` **一律拒绝**（`CONVERSION_REQUIRES_PROMOTE`）：
   * 只有 006.3 的 `promote()` 才能产生「已转正」。
   */
  transition(input: TransitionCandidateInput): Promise<ResearchStrategyCandidate>;
}

export interface StrategyCandidateServiceDeps {
  repos: ResearchRepositories;
  datasetVersions: DatasetVersionReadPort;
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
  const { repos, datasetVersions } = deps;

  async function requireCandidate(id: number): Promise<ResearchStrategyCandidate> {
    const candidate = await repos.candidates.getById(id);
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

    const experimentRow = await repos.experiments.getById(candidate.experimentId);
    const experiment = experimentRow
      ? {
          id: experimentRow.id as number,
          name: experimentRow.name,
          status: experimentRow.status,
          datasetVersionId: experimentRow.datasetVersionId,
        }
      : null;
    if (!experiment) sourceMissing.push("EXPERIMENT");

    let conclusion: StrategyCandidateConclusionSummary | null = null;
    if (isPositiveInt(candidate.conclusionId)) {
      const row = await repos.conclusions.getById(candidate.conclusionId);
      conclusion = row
        ? {
            id: row.id as number,
            title: row.title,
            conclusionType: row.conclusionType,
            status: row.status,
            confidence: row.confidence ?? null,
          }
        : null;
      if (!conclusion) sourceMissing.push("CONCLUSION");
    }

    let dataset: DatasetVersionSnapshot | null = null;
    if (isPositiveInt(candidate.sourceDatasetVersionId)) {
      const row = await datasetVersions.getVersionById(candidate.sourceDatasetVersionId);
      dataset = row ?? null;
      if (!dataset) sourceMissing.push("DATASET_VERSION");
    }

    return { candidate, experiment, conclusion, dataset, sourceMissing };
  }

  /**
   * `sourceResearchRunId` 的两跳解析（006.0 §8.1 / 006.2 §8）。
   *
   * 唯一性判据：参与的 analysisId 反查出的 **去重 runId 集合长度必须为 1**；
   * 0 个（查不到）/ 多个（跨 Run 的结论）一律 `null`。
   */
  async function resolveSourceRun(
    analysisIds: number[],
    primaryAnalysisId: number | null,
  ): Promise<RunResolution> {
    const distinctRunIds: number[] = [];
    const missingAnalysisIds: number[] = [];
    for (const analysisId of analysisIds) {
      const analysis = await repos.analyses.getById(analysisId);
      if (!analysis) {
        missingAnalysisIds.push(analysisId);
        continue;
      }
      if (isPositiveInt(analysis.runId) && !distinctRunIds.includes(analysis.runId)) {
        distinctRunIds.push(analysis.runId);
      }
    }
    const path: RunResolution["path"] =
      analysisIds.length === 0
        ? "NONE"
        : primaryAnalysisId !== null
          ? "PRIMARY_ANALYSIS"
          : "CONTRIBUTING_ANALYSES";
    return {
      sourceResearchRunId: distinctRunIds.length === 1 ? (distinctRunIds[0] as number) : null,
      path,
      analysisIds,
      distinctRunIds,
      missingAnalysisIds,
    };
  }

  async function assertConclusionEligible(conclusion: ResearchConclusion): Promise<void> {
    if (!(CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES as readonly string[]).includes(conclusion.status)) {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_CANDIDATE_ELIGIBLE,
        `Conclusion #${conclusion.id} 当前状态为 ${conclusion.status}，`
          + `只有 ${CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES.join(" / ")} 状态的结论允许登记为候选`
          + "（已被取代的结论不得进入策略链路）",
      );
    }
  }

  return {
    async createFromConclusion(input) {
      // ---- 0. 入参 ----
      if (!isPositiveInt(input.conclusionId)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
          `conclusionId 必须是正整数，实际：${String(input.conclusionId)}`,
        );
      }
      if (input.overrides !== undefined) {
        assertCandidateOverridesKeys(input.overrides as Record<string, unknown>);
      }

      // ---- 1. Conclusion 存在 ----
      const conclusion = await repos.conclusions.getById(input.conclusionId);
      if (!conclusion) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_FOUND,
          `未找到 Research Conclusion：${input.conclusionId}`,
        );
      }

      // ---- 2. 归属 Experiment 存在 ----
      const experiment = await repos.experiments.getById(conclusion.experimentId);
      if (!experiment) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.EXPERIMENT_NOT_FOUND,
          `Conclusion #${conclusion.id} 归属的 Experiment 不存在：${conclusion.experimentId}`,
        );
      }

      // ---- 3. 研究来源 Dataset 坐标（**只从 Experiment 复制**）----
      const sourceDatasetVersionId = experiment.datasetVersionId;
      if (!isPositiveInt(sourceDatasetVersionId)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_INVALID,
          `Experiment #${experiment.id} 的 datasetVersionId 非法：${String(sourceDatasetVersionId)}`,
        );
      }

      // ---- 4. Dataset Version 存在 ∧ READY ----
      const datasetVersion = await datasetVersions.getVersionById(sourceDatasetVersionId);
      if (!datasetVersion) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND,
          `研究来源 Dataset Version 不存在：${sourceDatasetVersionId}`,
        );
      }
      if (datasetVersion.status !== "READY") {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY,
          `研究来源 Dataset Version ${sourceDatasetVersionId}（${datasetVersion.label}）`
            + `状态为 ${datasetVersion.status}，未 READY，不得作为研究依据登记候选`,
        );
      }

      // ---- 5. Conclusion 资格 ----
      await assertConclusionEligible(conclusion);

      // ---- 6. 重复登记（同结论 + 同名 ⇒ 软拒绝）----
      const name = assertCandidateName(input.name ?? conclusion.title);
      const siblings = await repos.candidates.list({ conclusionId: conclusion.id as number });
      const duplicated = siblings.some((c) => c.name.trim() === name);
      if (duplicated) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.CANDIDATE_ALREADY_EXISTS,
          `Conclusion #${conclusion.id} 下已存在同名候选「${name}」；`
            + "如需调整请改用 update（同一结论允许存在多份**不同名**的候选）",
        );
      }

      // ---- 7. 证据快照 + Run 两跳解析 ----
      const parsedEvidence = parseConclusionEvidence(conclusion.evidence);
      const analysisIds = evidenceAnalysisIdCandidates(parsedEvidence);
      const primaryAnalysisId = parsedEvidence.primaryAnalysis?.analysisId ?? null;
      const runResolution = await resolveSourceRun(analysisIds, primaryAnalysisId);
      const sourceTraceJson = buildSourceTrace({
        conclusionId: conclusion.id as number,
        experimentId: experiment.id as number,
        hypothesisId: conclusion.hypothesisId ?? null,
        conclusionType: conclusion.conclusionType,
        conclusionStatus: conclusion.status,
        confidence: conclusion.confidence ?? null,
        evidence: parsedEvidence,
        runResolution,
      });

      // ---- 8. 落库（初始状态恒为 DRAFT：绝不传 status）----
      const created = await repos.candidates.create({
        experimentId: experiment.id as number,
        conclusionId: conclusion.id as number,
        name,
        description: input.description ?? conclusion.conclusion,
        ...(input.overrides?.entryRule !== undefined ? { entryRule: input.overrides.entryRule } : {}),
        ...(input.overrides?.filterRule !== undefined ? { filterRule: input.overrides.filterRule } : {}),
        ...(input.overrides?.exitRule !== undefined ? { exitRule: input.overrides.exitRule } : {}),
        ...(input.overrides?.riskRule !== undefined ? { riskRule: input.overrides.riskRule } : {}),
        ...(input.overrides?.parameterSpace !== undefined
          ? { parameterSpace: input.overrides.parameterSpace }
          : {}),
        sourceDatasetVersionId,
        sourceResearchRunId: runResolution.sourceResearchRunId,
        sourceTraceJson,
      });

      if (created.status !== "DRAFT") {
        // 不可达：本路径从不传 status（仓储缺省 DRAFT）。真出现即优先级最高的缺陷。
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
          `createFromConclusion 只允许产生 DRAFT 候选，实际得到 ${created.status}`,
        );
      }

      return buildView(created);
    },

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
      return repos.candidates.update(candidateId, patch);
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
      const updated = await repos.candidates.update(input.candidateId, { status: target });
      if (!(RESEARCH_CANDIDATE_STATUSES as readonly string[]).includes(updated.status)) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
          `迁移后状态非法：${String(updated.status)}`,
        );
      }
      return updated;
    },
  };
}
