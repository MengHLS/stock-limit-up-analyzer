/**
 * RESEARCH-EXPERIMENT-002 —— **Experiment Result → Strategy** 桥（规格 §5 / §6 / §12）。
 *
 * ## 它消灭的是什么
 *
 * 002 之前，创建策略的唯一生产路径是：
 *
 * ```text
 * Research Conclusion → Strategy Candidate → Strategy Version
 * ```
 *
 * `server/research/strategyCandidate/service.ts#createFromConclusion` 的硬前置是
 * 「Conclusion 必须存在、必须属于某个 Experiment、状态必须是 DRAFT/FINAL」
 * ⇒ **没有旧 Research 结论就没有策略**。这正是 002 要解除的那条生产依赖。
 *
 * 新链路：
 *
 * ```text
 * Independent Experiment（真实跑一次）→ Experiment Result
 *        ↓  （本桥：一次调用内完成）
 *   Strategy Version（复用既有 createStrategyVersion 幂等创建）
 *        ↓
 *   strategy_research_provenance（sourceKind = INDEPENDENT_EXPERIMENT）
 * ```
 *
 * ## 三条「复用而非重写」
 *
 * 1. **执行入口唯一** = `ExperimentRunner`（001 的 Runner）—— 本桥不自己跑实验，
 *    也不接受调用方自报的结果；
 * 2. **草稿 → 策略定义唯一** = `definitionBuild.ts` 的三个既有转换器
 *    （`buildStrategyDefinition` / `buildExecutionAssumptions` / `buildStrategyRecipe`）——
 *    本桥**不另写**一份 Candidate → Strategy 转换；
 * 3. **策略落库唯一** = `StrategyPromotionPort.createStrategyVersion`
 *    （幂等 + 版本冲突检测 + canonical 组装 + 5 投影 + Dataset Binding 校验）。
 *
 * ## 关于 `CandidateSketchCarrier`（必须读）
 *
 * 既有转换器的入参类型是 `ResearchStrategyCandidate`（旧 Research 的**行类型**）。本桥没有
 * 候选行（独立实验来源刻意**不建**候选行），因此传入一个**从不落库**的载体对象：
 * 它只承载 4 个草图字段（`entryRule` / `parameterSpace` / `exitRule` / `riskRule`），
 * 三个旧 Research 锚（candidate / conclusion / experiment id）填 `null`。
 *
 * 🔴 「转换器不会读那三个锚」不是注释式承诺，而是**可断言的测试事实**：
 * `tests/server/researchExperiments/strategyBridge.test.ts` 用**两组不同的锚值**跑同一份草稿，
 * 断言产出的 `definition` / `executionAssumptions` / `recipe` **逐字节相等** ——
 * 将来若有人让转换器依赖旧锚，该测试立刻变红。
 *
 * ## provenance 的「可验证」而不是「声明」
 *
 * `experimentResultDigest` 由**服务端真实重跑**该实验后对结果算 canonical 指纹得到，
 * 不接受调用方传入 ⇒ 「这份溯源对应的就是那一次运行」是可复核的事实。
 */

import { createHash } from "node:crypto";
import type {
  ExperimentExecution,
  ExperimentParameterValues,
  ExperimentResultEnvelope,
  ExperimentRunOutcome,
} from "@shared/researchExperimentsContracts";
import type { StrategyDefinitionInput } from "../research/strategySchema/definition";
import type { StrategyRecipe } from "../research/strategySchema/types";
import type { ResearchStrategyCandidate } from "../research/vocabulary";
import {
  buildExecutionAssumptions,
  buildStrategyDefinition,
  buildStrategyRecipe,
  deriveUniverseIdForDataset,
  PROMOTE_INITIAL_STRATEGY_VERSION,
} from "../research/strategyCandidate/definitionBuild";
import type { StrategyPromotionPort } from "../research/strategyCandidate/strategyPromotionPort";
import {
  STRATEGY_PROVENANCE_ERROR,
  type StrategyResearchProvenanceRepository,
} from "../research/strategyCandidate/types";
import {
  RESEARCH_EVIDENCE_ERROR,
  ResearchEvidenceError,
  assertResearchEvidenceRefs,
  buildResearchEvidenceSnapshot,
  computeResearchEvidenceFingerprint,
  readResearchEvidenceFingerprint,
  resolveEvidenceReference,
  resolveSingleDatasetVersionId,
  type ResearchEvidenceRecord,
  type ResearchEvidenceRef,
} from "../research/strategyCandidate/researchEvidence";
import { serializeCanonical } from "../research/searchRobustness/canonical";
import type { ExperimentEvidenceRunReader, PersistedEvidenceRun } from "./evidenceRunReader";
import type { ExperimentRunner } from "./runner";

// ---------------------------------------------------------------------------
// 契约
// ---------------------------------------------------------------------------

/** 桥的领域错误码（跨 tRPC 边界时写进 message：`[CODE] …`）。 */
export const EXPERIMENT_STRATEGY_ERROR = {
  /** 实验未注册 / 参数非法 / Dataset 不可用 —— Runner 的**执行前**错误原样透出。 */
  EXPERIMENT_INVALID: "EXPERIMENT_STRATEGY_EXPERIMENT_INVALID",
  /** 实验**执行期**失败（`runStatus=FAILED`）—— 不拿失败的结果去造策略。 */
  EXPERIMENT_RUN_FAILED: "EXPERIMENT_STRATEGY_EXPERIMENT_RUN_FAILED",
  /** 草案缺必填 / 内容非法（透出既有 `PROMOTE_SKETCH_*` 的语义，不另立一套）。 */
  DRAFT_INVALID: "EXPERIMENT_STRATEGY_DRAFT_INVALID",
  /** 策略创建失败（透出既有转正端口的错误码与消息）。 */
  STRATEGY_CREATE_FAILED: "EXPERIMENT_STRATEGY_CREATE_FAILED",
  /** 策略**已创建**但溯源写入失败 —— 必须如实回报已产生的坐标，不装成「什么都没发生」。 */
  PROVENANCE_WRITE_FAILED: "EXPERIMENT_STRATEGY_PROVENANCE_WRITE_FAILED",
  // ---- STRATEGY-RESEARCH-BRIDGE-001：按**真实持久化 Run** 建策略的失败面 ----
  /** 证据引用本身非法（空列表 / runId 形态错 / kind 越界 / reference 非点分路径 / 重复）。 */
  EVIDENCE_INVALID: "EXPERIMENT_STRATEGY_EVIDENCE_INVALID",
  /** 声明的 `runId` 在 `research_experiment_run` 里**不存在**（拒绝手写不存在的 Run id）。 */
  EVIDENCE_RUN_NOT_FOUND: "EXPERIMENT_STRATEGY_EVIDENCE_RUN_NOT_FOUND",
  /** 该 Run 不是 `COMPLETED`（失败 / 进行中的运行不得作为策略的研究依据）。 */
  EVIDENCE_RUN_NOT_COMPLETED: "EXPERIMENT_STRATEGY_EVIDENCE_RUN_NOT_COMPLETED",
  /** 该 Run 的**结果信封读不回来**（对象存储不可用 / 声明了却不存在）—— 不拿读不到的当证据。 */
  EVIDENCE_RESULT_UNAVAILABLE: "EXPERIMENT_STRATEGY_EVIDENCE_RESULT_UNAVAILABLE",
  /**
   * `reference` 在**该 Run 的结果信封里解析不到**（规格 §12「不得虚构 artifact」）。
   * 与 `EVIDENCE_INVALID`（语法就不对）分开：这条意味着「坐标像真的，但结果里没有」。
   */
  EVIDENCE_REFERENCE_UNRESOLVED: "EXPERIMENT_STRATEGY_EVIDENCE_REFERENCE_UNRESOLVED",
  /** 多份证据指向不同 Dataset 版本 ⇒ 无法确定唯一执行绑定。 */
  EVIDENCE_DATASET_MISMATCH: "EXPERIMENT_STRATEGY_EVIDENCE_DATASET_MISMATCH",
  /** 装配未注入 Run 读回端口（配置错误，响亮失败而不是静默降级）。 */
  EVIDENCE_READER_UNAVAILABLE: "EXPERIMENT_STRATEGY_EVIDENCE_READER_UNAVAILABLE",
  /**
   * 该 (strategyId, version) 已有一条溯源，且其证据指纹与本次**不同** ⇒ 既不是幂等、也不是新建。
   * 溯源是历史事实快照、仓储连 `update` 都不提供 ⇒ 只能**如实拒绝**，绝不覆盖。
   */
  EVIDENCE_PROVENANCE_CONFLICT: "EXPERIMENT_STRATEGY_EVIDENCE_PROVENANCE_CONFLICT",
} as const;

export type ExperimentStrategyErrorCode =
  (typeof EXPERIMENT_STRATEGY_ERROR)[keyof typeof EXPERIMENT_STRATEGY_ERROR];

export class ExperimentStrategyError extends Error {
  readonly code: ExperimentStrategyErrorCode;
  readonly detail: unknown;

  constructor(code: ExperimentStrategyErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "ExperimentStrategyError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 草稿（= 候选草图的最小面，与 `patternLibrary#projectCandidateSketch` 的产物同形）。
 *
 * 只承载 4 个草图字段：与既有 `CandidateSketchFields` 的**语义面**一致，
 * 不含任何旧 Research 坐标（本桥的来源坐标是实验，不是结论）。
 */
export interface ExperimentStrategyDraft {
  readonly entryRule: Readonly<Record<string, unknown>>;
  /**
   * 执行侧筛选条件（可选）。
   *
   * 🔴 什么时候需要它：参数**只有出现在条件里**（作为 `PARAMETER_REFERENCE`）才会进规则图；
   * 而参数搜索对「规则图从未引用」的 TUNABLE 参数会**响亮拒绝**
   * （`PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER` —— 那会把「搜了但每组结果都一样」
   * 伪装成有效证据）。因此想让某个 TUNABLE 真被搜到，就必须在条件里引用它。
   *
   * 字段名必须是**执行侧**可解析的引用（如 `bar.low` / `prefix.rd0.open`）；
   * 研究侧变量名（`pat_*`）会被既有校验拒（`PROMOTE_SKETCH_INVALID`）—— 那是既有纪律，不在此放宽。
   */
  readonly filterRule?: Readonly<Record<string, unknown>>;
  readonly parameterSpace: Readonly<Record<string, Record<string, unknown>>>;
  readonly exitRule: Readonly<Record<string, unknown>>;
  readonly riskRule: Readonly<Record<string, unknown>>;
  /** 人读备注（可空）。 */
  readonly notes?: readonly string[];
}

export interface CreateStrategyFromExperimentInput {
  /** 独立实验 id（`<group>/<key>`）。 */
  readonly experimentId: string;
  /** 实验使用的 Dataset 版本（= 来源坐标，也是执行绑定，除非调用方显式覆盖）。 */
  readonly datasetVersionId: number;
  /** 实验参数（缺省由 Runner 用声明里的默认值归并）。 */
  readonly experimentParameters?: ExperimentParameterValues;
  readonly strategyId: string;
  readonly name: string;
  readonly description?: string;
  readonly draft: ExperimentStrategyDraft;
  /**
   * 执行绑定覆盖（缺省 = 与来源同坐标）。
   *
   * 研究来源 ≠ 执行绑定时必须给 `datasetDivergenceReason`（沿用既有 §13 纪律）。
   */
  readonly executionBinding?: {
    readonly datasetVersionId?: number;
    readonly datasetDivergenceReason?: string;
  };
}

export interface CreateStrategyFromExperimentResult {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyVersionId: number;
  /** `created=false` = 该 (strategyId, version) 已存在且指纹一致（幂等，未重复写入）。 */
  readonly created: boolean;
  readonly provenanceId: number;
  readonly sourceKind: "INDEPENDENT_EXPERIMENT";
  readonly experimentId: string;
  readonly experimentVersion: string;
  readonly experimentParameters: ExperimentParameterValues;
  /** 实验结果的 canonical 指纹（服务端真实重跑后算出）。 */
  readonly experimentResultDigest: string;
  /** 实验执行事实（耗时 / 读取量）；调用方可如实展示。 */
  readonly experimentExecution: ExperimentExecution;
}

// ---------------------------------------------------------------------------
// STRATEGY-RESEARCH-BRIDGE-001 —— 按**真实持久化 Run** 建策略（第二条取证据路径）
// ---------------------------------------------------------------------------

/**
 * 输入：证据引用（`runId` + 引用了运行的哪一部分）+ 草稿 + 策略身份。
 *
 * 🔴 调用方**只给 `runId`**，不给 `experimentCode` / `experimentVersion` / `datasetVersionId` ——
 * 那三项是 Run 行的函数，由服务端从**真实 Run** 读回（规格 §12：引用必须指向真实存在的 Run，
 * 不得手写不存在的 id）。
 */
export interface CreateStrategyFromEvidenceRunsInput {
  readonly evidences: readonly ResearchEvidenceRef[];
  readonly strategyId: string;
  readonly name: string;
  readonly description?: string;
  readonly draft: ExperimentStrategyDraft;
  /** 执行绑定覆盖（缺省 = 与证据同坐标）；研究来源 ≠ 执行绑定时必须给原因（沿用既有 §13 纪律）。 */
  readonly executionBinding?: {
    readonly datasetVersionId?: number;
    readonly datasetDivergenceReason?: string;
  };
}

export interface CreateStrategyFromEvidenceRunsResult {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyVersionId: number;
  /** `false` = 该 (strategyId, version) 已存在且指纹一致（幂等，未重复写入）。 */
  readonly created: boolean;
  readonly provenanceId: number;
  readonly sourceKind: "INDEPENDENT_EXPERIMENT";
  /** 已核实并**冻结**的证据列表（Run 行事实 + 结果摘要指纹）。 */
  readonly evidences: readonly ResearchEvidenceRecord[];
  /**
   * 研究证据的**内容指纹**（规格 §6 的「可追溯身份」）。
   * ⚠️ **同名不同义**：它与 `strategy_versions.fingerprint`（执行语义指纹）是两件事，
   * 见 `researchEvidence.ts` 文件头。
   */
  readonly researchEvidenceFingerprint: string;
  /** 多份证据共同的 Dataset 版本（= 默认的执行绑定坐标）。 */
  readonly datasetVersionId: number;
  readonly datasetVersionLabel: string | null;
}

export interface ExperimentStrategyBridgeDeps {
  /** 001 的 Runner（唯一执行入口）。 */
  readonly runner: ExperimentRunner;
  /** Strategy 侧转正端口（幂等创建策略 + 首版本）。 */
  readonly strategies: StrategyPromotionPort;
  /** Strategy 侧溯源仓储（既有唯一落点）。 */
  readonly provenance: StrategyResearchProvenanceRepository;
  /**
   * 持久化 Run 的只读读回端口（STRATEGY-RESEARCH-BRIDGE-001）。
   *
   * **可选**：不注入时 `createStrategyFromEvidenceRuns` 以配置错误**响亮失败**
   * （而不是静默降级成「不核实证据」）。既有的实时重跑路径完全不需要它。
   */
  readonly evidenceRuns?: ExperimentEvidenceRunReader;
}

export interface ExperimentStrategyBridge {
  createStrategyFromExperiment(
    input: CreateStrategyFromExperimentInput,
  ): Promise<CreateStrategyFromExperimentResult>;
  /**
   * 按**已持久化的真实 Run** 建策略（规格 §7 / §12 / §19）。
   *
   * 与 `createStrategyFromExperiment` 的分工：那条路径在**还没有**持久化 Run 时先实时跑一次；
   * 本路径在**已经有**真实 Run 时按 Run 建策略。两者的下游（草稿 → 定义 → 版本 → 溯源）
   * **完全共用同一段实现**，不复制第二套。
   */
  createStrategyFromEvidenceRuns(
    input: CreateStrategyFromEvidenceRunsInput,
  ): Promise<CreateStrategyFromEvidenceRunsResult>;
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/**
 * 结果指纹的**唯一载荷口径**（canonical JSON + sha256，取前 16 位）。
 *
 * 🔴 复用 `searchRobustness/canonical` 的 `serializeCanonicalOf`（**不新造第二套 canonicalizer**）：
 * 指纹要跨进程 / 跨时间稳定，第二套序列化实现迟早会漂移。
 *
 * 🔴 **实时重跑**与**读回持久化结果**两条路径必须产生**同一载荷**（否则「同一次运行」
 * 会因取数路径不同得到两个指纹）。因此两者都经本函数，`digestOfExperimentResult` 只是
 * 「实时 outcome → 载荷」的一层薄适配。
 */
export function digestOfResultPayload(payload: {
  readonly experimentId: string;
  readonly experimentVersion: string;
  readonly datasetVersionId: number | null;
  readonly parameters: unknown;
  readonly result: ExperimentResultEnvelope | null;
}): string {
  const body = {
    experimentId: payload.experimentId,
    experimentVersion: payload.experimentVersion,
    datasetVersionId: payload.datasetVersionId,
    parameters: payload.parameters,
    sampleSummary: payload.result?.sampleSummary ?? null,
    statistics: payload.result?.statistics ?? null,
    tables: payload.result?.tables ?? null,
    distributions: payload.result?.distributions ?? null,
    comparisons: payload.result?.comparisons ?? null,
    charts: payload.result?.charts ?? null,
    customPayload: payload.result?.customPayload ?? null,
  };
  return `exp-sha256:${createHash("sha256").update(serializeCanonical(body)).digest("hex").slice(0, 16)}`;
}

/** 实时重跑路径的结果指纹（逐字保持 002 的既有口径；实现改为委托给唯一载荷口径）。 */
export function digestOfExperimentResult(outcome: ExperimentRunOutcome): string {
  return digestOfResultPayload({
    experimentId: outcome.descriptor.id,
    experimentVersion: outcome.descriptor.version,
    datasetVersionId: outcome.execution.datasetFacts.datasetVersionId,
    parameters: outcome.execution.resolvedParameters,
    result: outcome.result,
  });
}

/** 读回持久化路径的结果指纹（同一载荷口径；输入是 Run 行 + 对象存储里的结果信封）。 */
export function digestOfPersistedEvidence(run: PersistedEvidenceRun): string {
  return digestOfResultPayload({
    experimentId: run.experimentCode,
    experimentVersion: run.experimentVersion,
    datasetVersionId: run.datasetVersionId,
    parameters: run.parameters,
    result: run.result,
  });
}

/**
 * 把草稿装进既有转换器所需的**候选形状载体**（从不落库）。
 *
 * 🔴 载体填的是领域类型的**已解析**字段（`entryRule` / `exitRule` / `riskRule` /
 * `parameterSpace`），**不是** DB 行的 `*Json` 变体 ——
 * 领域仓库负责 JSON ⇄ 对象互转，转换器读的是对象。
 * （本会话第一版填了 `entryRuleJson` ⇒ 转换器报「缺少 entryRule」，真库实测暴露。）
 *
 * 三个旧 Research 锚恒为 `null` —— 且「转换器不读它们」由单测断言（见文件头）。
 */
function buildSketchCarrier(draft: ExperimentStrategyDraft): ResearchStrategyCandidate {
  return {
    experimentId: 0,
    conclusionId: null,
    strategyDefinitionId: null,
    name: "(experiment-sourced draft)",
    description: null,
    entryRule: draft.entryRule,
    filterRule: draft.filterRule ?? null,
    exitRule: draft.exitRule,
    riskRule: draft.riskRule,
    parameterSpace: draft.parameterSpace,
    sourceDatasetVersionId: null,
    sourceResearchRunId: null,
    sourceResearchPlanId: null,
    sourceTraceJson: null,
    sourceDatasetDivergenceReason: null,
    status: "ACCEPTED",
    sourceHypothesisId: null,
    sourceFindingIds: null,
  } as unknown as ResearchStrategyCandidate;
}

/** 草稿 → （定义 + 文档级假设 + 执行配方）。两条取证据路径**共用**，不复制第二套。 */
function buildDraftDefinition(
  draft: ExperimentStrategyDraft,
  executionDataset: {
    readonly datasetVersionId: number;
    readonly datasetVersionLabel: string;
    readonly datasetCode: string;
  },
): {
  definition: StrategyDefinitionInput;
  executionAssumptions: ReturnType<typeof buildExecutionAssumptions>;
  recipe: StrategyRecipe | undefined;
} {
  const carrier = buildSketchCarrier(draft);
  try {
    return {
      definition: buildStrategyDefinition({ candidate: carrier, executionDataset }),
      executionAssumptions: buildExecutionAssumptions(carrier),
      recipe: buildStrategyRecipe(carrier),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExperimentStrategyError(
      EXPERIMENT_STRATEGY_ERROR.DRAFT_INVALID,
      `草案无法转成策略定义：${message}`,
      { cause: (error as { code?: string }).code ?? null },
    );
  }
}

/**
 * 草稿 → （定义 + 文档级执行假设 + 执行配方）的**公开纯函数**入口。
 *
 * 存在的理由只有一个：让「这份草稿到底能不能转成一个**合法的** StrategyDefinition」
 * 可以在**不碰 DB、不碰对象存储、不 mock 任何东西**的前提下被验证
 * （§18.5 / §18.6 的最小真实消费前置，以及「首板回踩 1.0.0 的规则确实进了规则图」这条判据）。
 *
 * 🔴 内部实现与两条建策略路径**共用同一段** `buildDraftDefinition`，不复制第二套。
 */
export function buildExperimentStrategyArtifacts(
  draft: ExperimentStrategyDraft,
  executionDataset: {
    readonly datasetVersionId: number;
    readonly datasetVersionLabel: string;
    readonly datasetCode: string;
  },
): ReturnType<typeof buildDraftDefinition> {
  return buildDraftDefinition(draft, executionDataset);
}

/** 溯源写失败时的统一出口：**如实回报已产生的策略坐标**（不装成「什么都没发生」）。 */
function provenanceWriteFailure(
  error: unknown,
  where: { strategyId: string; strategyVersion: string; versionRowId: number; created: boolean },
): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new ExperimentStrategyError(
    EXPERIMENT_STRATEGY_ERROR.PROVENANCE_WRITE_FAILED,
    `策略已创建（strategyId=${where.strategyId} version=${where.strategyVersion} ` +
      `versionRowId=${where.versionRowId}）但溯源写入失败：${message}。` +
      "该策略版本**仍然可用**，但「从哪个实验来」目前查不到 —— 请重试或用 "
      + "`getVersionProvenance` 确认后再决定是否补写。",
    {
      strategyId: where.strategyId,
      strategyVersion: where.strategyVersion,
      versionRowId: where.versionRowId,
      created: where.created,
      provenanceError: (error as { code?: string }).code ?? null,
    },
  );
}

export function createExperimentStrategyBridge(
  deps: ExperimentStrategyBridgeDeps,
): ExperimentStrategyBridge {
  return {
    async createStrategyFromExperiment(input) {
      // ---- 1) 真实跑一次实验（唯一执行入口；不接受调用方自报结果）----
      let outcome: ExperimentRunOutcome;
      try {
        outcome = await deps.runner.run({
          experimentId: input.experimentId,
          datasetVersionId: input.datasetVersionId,
          ...(input.experimentParameters !== undefined
            ? { parameters: input.experimentParameters }
            : {}),
        });
      } catch (error) {
        // 执行前错误（未注册 / 参数非法 / 版本不可用）原样透出领域码。
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as { code?: string }).code ?? "UNKNOWN";
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.EXPERIMENT_INVALID,
          `实验 ${input.experimentId} 不可运行（[${code}] ${message}）`,
          { experimentId: input.experimentId, code },
        );
      }

      if (outcome.runStatus !== "SUCCEEDED" || outcome.result === null) {
        // 🔴 失败的结果**不得**用来造策略：否则会产出一个「看起来有研究依据」的策略。
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.EXPERIMENT_RUN_FAILED,
          `实验 ${input.experimentId} 执行失败（[${outcome.error?.code ?? "UNKNOWN"}] ${outcome.error?.message ?? ""}）` +
            "—— 不拿失败的结果去创建策略",
          { error: outcome.error, execution: outcome.execution },
        );
      }

      // ---- 2) 草稿 → 策略定义（复用既有唯一转换器；两条取证据路径**共用**同一段）----
      const executionDataset = {
        datasetVersionId: input.datasetVersionId,
        datasetVersionLabel: outcome.execution.datasetFacts.datasetVersionLabel,
        datasetCode: outcome.execution.datasetFacts.datasetCode,
      };
      const { definition, executionAssumptions, recipe } = buildDraftDefinition(
        input.draft,
        executionDataset,
      );

      // ---- 3) 策略 + 首版本（复用既有幂等创建路径）----
      const strategyVersion = PROMOTE_INITIAL_STRATEGY_VERSION;
      let creation: Awaited<ReturnType<StrategyPromotionPort["createStrategyVersion"]>>;
      try {
        creation = await deps.strategies.createStrategyVersion({
          strategyId: input.strategyId,
          version: strategyVersion,
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          universe: { universeId: deriveUniverseIdForDataset(executionDataset.datasetVersionLabel) },
          definition,
          executionAssumptions,
          ...(recipe !== undefined ? { recipe } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.STRATEGY_CREATE_FAILED,
          `策略创建失败：${message}`,
          { code: (error as { code?: string }).code ?? null },
        );
      }

      // ---- 4) 溯源（既有唯一落点；来源体系 = INDEPENDENT_EXPERIMENT）----
      const experimentResultDigest = digestOfExperimentResult(outcome);
      const resolvedParameters = outcome.execution.resolvedParameters;
      let provenanceId: number;
      try {
        const row = await deps.provenance.create({
          strategyVersionId: creation.versionRowId,
          strategyId: input.strategyId,
          strategyVersion,
          sourceKind: "INDEPENDENT_EXPERIMENT",
          // 🔴 三个旧 Research 锚如实置 null（独立实验没有这些坐标；不伪造 0 / 哨兵 id）。
          sourceCandidateId: null,
          sourceConclusionId: null,
          sourceExperimentId: null,
          sourceResearchRunId: null,
          sourceDatasetVersionId: input.datasetVersionId,
          sourceDatasetLabel: executionDataset.datasetVersionLabel,
          // 旧链路的证据快照位放「实验执行摘要」，便于一屏读全「当初凭什么」。
          sourceSnapshotJson: {
            kind: "INDEPENDENT_EXPERIMENT",
            experimentRef: input.experimentId,
            experimentVersion: outcome.descriptor.version,
            experimentResultDigest,
            datasetVersionLabel: executionDataset.datasetVersionLabel,
            sampleSummary: outcome.result.sampleSummary,
            execution: {
              durationMs: outcome.execution.durationMs,
              eventCount: outcome.execution.datasetFacts.eventCount,
              postRowCount: outcome.execution.datasetFacts.postRowCount,
              forwardDataRead: outcome.execution.datasetFacts.forwardDataRead,
            },
            notes: [
              "本溯源由 RESEARCH-EXPERIMENT-002 的 Experiment → Strategy 桥写入。",
              "来源坐标是**独立实验**（不是旧 Research 结论）：三个旧来源锚为 null 是如实缺失。",
            ],
          },
          experimentRef: input.experimentId,
          experimentVersion: outcome.descriptor.version,
          experimentParametersJson: resolvedParameters,
          experimentResultDigest,
          origin: "DIRECT",
        });
        provenanceId = row.id ?? 0;
        if (!Number.isFinite(provenanceId) || provenanceId <= 0) {
          throw new Error("溯源写入后未取得自增 id");
        }
      } catch (error) {
        provenanceWriteFailure(error, {
          strategyId: input.strategyId,
          strategyVersion,
          versionRowId: creation.versionRowId,
          created: creation.created,
        });
      }

      return {
        strategyId: input.strategyId,
        strategyVersion,
        strategyVersionId: creation.versionRowId,
        created: creation.created,
        provenanceId,
        sourceKind: "INDEPENDENT_EXPERIMENT",
        experimentId: input.experimentId,
        experimentVersion: outcome.descriptor.version,
        experimentParameters: resolvedParameters,
        experimentResultDigest,
        experimentExecution: outcome.execution,
      };
    },

    /**
     * 按**已持久化的真实 Run** 建策略（规格 §7 / §12 / §19）。
     *
     * 顺序（每一步都在副作用之前完成校验）：
     *   0 装配闸门 → 1 声明面校验 → 2 逐条从真实 Run 读回并冻结事实 → 3 唯一 Dataset 坐标 →
     *   4 证据指纹 → 5 草稿 → 定义 → 6 幂等创建策略 + 首版本 → 7 写溯源（含证据段）。
     *
     * 🔴 「不接受调用方自报坐标」是本方法的**要害**：`experimentCode` / `experimentVersion` /
     * `datasetVersionId` / `resultDigest` 全部来自 `reader.read(runId)` 的真实读数，
     * 因此「引用指向真实存在的 Run」是**结构性**事实，而不是一句声明。
     */
    async createStrategyFromEvidenceRuns(input) {
      // ---- 0) 装配闸门（缺端口 ⇒ 响亮失败，绝不静默降级成「不核实证据」）----
      const reader = deps.evidenceRuns;
      if (reader === undefined) {
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.EVIDENCE_READER_UNAVAILABLE,
          "未注入持久化 Run 读回端口（deps.evidenceRuns）—— 无法核实证据引用，"
            + "拒绝在「不核实」的前提下创建策略",
        );
      }

      // ---- 1) 声明面校验（空 / runId 形态 / kind 闭集 / reference 点分路径 / 重复）----
      try {
        assertResearchEvidenceRefs(input.evidences);
      } catch (error) {
        if (error instanceof ResearchEvidenceError) {
          throw new ExperimentStrategyError(
            EXPERIMENT_STRATEGY_ERROR.EVIDENCE_INVALID,
            `证据引用非法（[${error.code}] ${error.message}）`,
            { code: error.code },
          );
        }
        throw error;
      }

      // ---- 2) 逐条从**真实 Run** 读回并冻结事实 ----
      const resolved: Array<{ ref: ResearchEvidenceRef; run: PersistedEvidenceRun }> = [];
      for (const ref of input.evidences) {
        const run = await reader.read(ref.runId);
        if (run === null) {
          throw new ExperimentStrategyError(
            EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RUN_NOT_FOUND,
            `证据引用的 Run 不存在：${ref.runId}`
              + "（拒绝手写不存在的 Run id —— 请给出真实持久化 Run）",
            { runId: ref.runId },
          );
        }
        if (run.status !== "COMPLETED") {
          throw new ExperimentStrategyError(
            EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RUN_NOT_COMPLETED,
            `证据引用的 Run 未完成（status=${run.status}）：${ref.runId}`
              + " —— 不拿未完成 / 失败的运行当研究依据",
            { runId: ref.runId, status: run.status },
          );
        }
        if (!run.resultAvailable || run.result === null) {
          throw new ExperimentStrategyError(
            EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RESULT_UNAVAILABLE,
            `证据引用的 Run 结果信封读不回来：${ref.runId}`
              + `（${run.resultUnavailableReason ?? "原因未知"}）—— 不拿读不到的结果当证据`,
            { runId: ref.runId, reason: run.resultUnavailableReason },
          );
        }
        if (run.datasetVersionId === null || run.datasetVersionLabel === null) {
          throw new ExperimentStrategyError(
            EXPERIMENT_STRATEGY_ERROR.EVIDENCE_INVALID,
            `证据引用的 Run 缺 Dataset 坐标 / label：${ref.runId}`,
            { runId: ref.runId },
          );
        }
        if (run.parameters === null || run.parameters === undefined) {
          throw new ExperimentStrategyError(
            EXPERIMENT_STRATEGY_ERROR.EVIDENCE_INVALID,
            `证据引用的 Run 没有参数快照：${ref.runId}`
              + "（溯源必须能回答「用了什么参数」，不接受空参数）",
            { runId: ref.runId },
          );
        }
        // 🔴 规格 §12：`reference` 必须在该 Run 的**真实结果信封**里解析得到。
        //    只做语法校验时，「引用一个不存在的字段」与「引用真实字段」在数据上完全同形 ——
        //    这一步把「引用真实存在的东西」从一句声明变成一次**可失败的解析**。
        try {
          resolveEvidenceReference(run.result, ref.reference);
        } catch (error) {
          if (error instanceof ResearchEvidenceError) {
            throw new ExperimentStrategyError(
              EXPERIMENT_STRATEGY_ERROR.EVIDENCE_REFERENCE_UNRESOLVED,
              `证据引用在该 Run 的结果里解析不到（[${error.code}] ${error.message}）`
                + ` —— Run ${ref.runId} 的 reference=${JSON.stringify(ref.reference)}`,
              { runId: ref.runId, reference: ref.reference, code: error.code },
            );
          }
          throw error;
        }
        resolved.push({ ref, run });
      }

      const records: ResearchEvidenceRecord[] = resolved.map(({ ref, run }) => ({
        experimentCode: run.experimentCode,
        experimentVersion: run.experimentVersion,
        runId: run.runId,
        datasetVersionId: run.datasetVersionId as number,
        datasetVersionLabel: run.datasetVersionLabel,
        evidenceKind: ref.evidenceKind,
        reference: ref.reference,
        ...(ref.description === undefined ? {} : { description: ref.description }),
        resultDigest: digestOfPersistedEvidence(run),
        runStatus: run.status,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
      }));

      // ---- 3) 唯一 Dataset 坐标（多份证据必须同源）----
      let datasetVersionId: number;
      try {
        datasetVersionId = resolveSingleDatasetVersionId(records);
      } catch (error) {
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.EVIDENCE_DATASET_MISMATCH,
          error instanceof Error ? error.message : String(error),
          { code: (error as { code?: string }).code ?? null },
        );
      }

      // ---- 3b) 执行绑定：本路径**以证据 Dataset 为准**；显式要求分歧时响亮拒绝（不静默忽略）----
      const requested = input.executionBinding?.datasetVersionId;
      if (requested !== undefined && requested !== datasetVersionId) {
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.EVIDENCE_DATASET_MISMATCH,
          `本路径的执行绑定以证据 Dataset 为准（${datasetVersionId}），`
            + `但调用方要求绑定到 ${requested} —— 该分歧形态尚未在本路径实现，`
            + "为避免「声明了执行覆盖却被静默忽略」而直接拒绝",
          { evidenceDatasetVersionId: datasetVersionId, requestedDatasetVersionId: requested },
        );
      }

      // ---- 4) 证据指纹（规格 §6 的「可追溯身份」）----
      const researchEvidenceFingerprint = computeResearchEvidenceFingerprint(records);
      const primary = records[0];
      const primaryRun = resolved[0];
      if (primary === undefined || primaryRun === undefined) {
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.EVIDENCE_INVALID,
          "证据列表为空（应已被 assertResearchEvidenceRefs 拦下，此处为兜底）",
        );
      }
      const evidenceSnapshot = buildResearchEvidenceSnapshot(records);

      // ---- 5) 草稿 → 策略定义（与实时重跑路径**共用**同一段实现）----
      const executionDataset = {
        datasetVersionId,
        datasetVersionLabel: primary.datasetVersionLabel as string,
        datasetCode: primaryRun.run.datasetCode ?? "",
      };
      const { definition, executionAssumptions, recipe } = buildDraftDefinition(
        input.draft,
        executionDataset,
      );

      // ---- 6) 策略 + 首版本（复用既有幂等创建路径）----
      const strategyVersion = PROMOTE_INITIAL_STRATEGY_VERSION;
      let creation: Awaited<ReturnType<StrategyPromotionPort["createStrategyVersion"]>>;
      try {
        creation = await deps.strategies.createStrategyVersion({
          strategyId: input.strategyId,
          version: strategyVersion,
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          universe: { universeId: deriveUniverseIdForDataset(executionDataset.datasetVersionLabel) },
          definition,
          executionAssumptions,
          ...(recipe !== undefined ? { recipe } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.STRATEGY_CREATE_FAILED,
          `策略创建失败：${message}`,
          { code: (error as { code?: string }).code ?? null },
        );
      }

      // ---- 7) 溯源（既有唯一落点；证据列表冻结进 sourceSnapshotJson，规格 §20 零 migration）----
      let provenanceId: number;
      try {
        const row = await deps.provenance.create({
          strategyVersionId: creation.versionRowId,
          strategyId: input.strategyId,
          strategyVersion,
          sourceKind: "INDEPENDENT_EXPERIMENT",
          // 🔴 三个旧 Research 锚如实置 null（独立实验没有这些坐标；不伪造 0 / 哨兵 id）。
          sourceCandidateId: null,
          sourceConclusionId: null,
          sourceExperimentId: null,
          sourceResearchRunId: null,
          sourceDatasetVersionId: datasetVersionId,
          sourceDatasetLabel: executionDataset.datasetVersionLabel,
          sourceSnapshotJson: {
            kind: "INDEPENDENT_EXPERIMENT",
            // 主证据坐标：与既有「单实验」形态**向后兼容**（同名字段同义）。
            experimentRef: primary.experimentCode,
            experimentVersion: primary.experimentVersion,
            experimentResultDigest: primary.resultDigest,
            datasetVersionLabel: executionDataset.datasetVersionLabel,
            execution: {
              runStatus: primary.runStatus,
              startedAt: primary.startedAt,
              durationMs: primary.durationMs,
            },
            // 完整证据列表 + 内容指纹（唯一权威读写口：researchEvidence.ts）。
            ...evidenceSnapshot,
            notes: [
              "本溯源由 STRATEGY-RESEARCH-BRIDGE-001 的「按真实持久化 Run 建策略」路径写入。",
              "来源坐标是**独立实验 Run**（不是旧 Research 结论）：三个旧来源锚为 null 是如实缺失。",
              "researchEvidences 里的每条记录都是服务端按 runId 从真实 Run 读回后冻结的事实，"
                + "不接受调用方自报坐标。",
              "researchEvidenceFingerprint 是**研究证据的内容指纹**，与 "
                + "strategy_versions.fingerprint（执行语义指纹）同名不同义，不参与回测 / 参数搜索。",
            ],
          },
          experimentRef: primary.experimentCode,
          experimentVersion: primary.experimentVersion,
          experimentParametersJson: primaryRun.run.parameters,
          experimentResultDigest: primary.resultDigest,
          origin: "DIRECT",
        });
        provenanceId = row.id ?? 0;
        if (!Number.isFinite(provenanceId) || provenanceId <= 0) {
          throw new Error("溯源写入后未取得自增 id");
        }
      } catch (error) {
        // 幂等闸门：一版本最多一条溯源（UNIQUE）。已存在时**只接受指纹一致**的重放；
        // 指纹不同 ⇒ 这是「同一版本挂着另一套研究证据」，绝不能覆盖（本仓无 update 口）。
        if ((error as { code?: string }).code === STRATEGY_PROVENANCE_ERROR.ALREADY_EXISTS) {
          const existing = await deps.provenance.getByStrategyVersionId(creation.versionRowId);
          if (existing !== undefined) {
            const existingFingerprint = readResearchEvidenceFingerprint(existing.sourceSnapshotJson);
            if (existingFingerprint === researchEvidenceFingerprint) {
              return {
                strategyId: input.strategyId,
                strategyVersion,
                strategyVersionId: creation.versionRowId,
                created: creation.created,
                provenanceId: existing.id ?? 0,
                sourceKind: "INDEPENDENT_EXPERIMENT",
                evidences: records,
                researchEvidenceFingerprint,
                datasetVersionId,
                datasetVersionLabel: executionDataset.datasetVersionLabel,
              };
            }
            throw new ExperimentStrategyError(
              EXPERIMENT_STRATEGY_ERROR.EVIDENCE_PROVENANCE_CONFLICT,
              `${input.strategyId}@${strategyVersion} 已有研究溯源，但证据指纹不同`
                + `（既有 ${existingFingerprint ?? "（无指纹，非证据型溯源）"}，本次 ${researchEvidenceFingerprint}）。`
                + "溯源是历史事实快照、不提供 update 入口 ⇒ 拒绝覆盖；请改用新的策略版本号承载新的研究证据。",
              {
                strategyVersionId: creation.versionRowId,
                existingFingerprint,
                incomingFingerprint: researchEvidenceFingerprint,
              },
            );
          }
        }
        provenanceWriteFailure(error, {
          strategyId: input.strategyId,
          strategyVersion,
          versionRowId: creation.versionRowId,
          created: creation.created,
        });
      }

      return {
        strategyId: input.strategyId,
        strategyVersion,
        strategyVersionId: creation.versionRowId,
        created: creation.created,
        provenanceId,
        sourceKind: "INDEPENDENT_EXPERIMENT",
        evidences: records,
        researchEvidenceFingerprint,
        datasetVersionId,
        datasetVersionLabel: executionDataset.datasetVersionLabel,
      };
    },
  };
}
