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
import type { StrategyResearchProvenanceRepository } from "../research/strategyCandidate/types";
import { serializeCanonical } from "../research/searchRobustness/canonical";
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

export interface ExperimentStrategyBridgeDeps {
  /** 001 的 Runner（唯一执行入口）。 */
  readonly runner: ExperimentRunner;
  /** Strategy 侧转正端口（幂等创建策略 + 首版本）。 */
  readonly strategies: StrategyPromotionPort;
  /** Strategy 侧溯源仓储（既有唯一落点）。 */
  readonly provenance: StrategyResearchProvenanceRepository;
}

export interface ExperimentStrategyBridge {
  createStrategyFromExperiment(
    input: CreateStrategyFromExperimentInput,
  ): Promise<CreateStrategyFromExperimentResult>;
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/**
 * 计算实验结果指纹（canonical JSON + sha256，取前 16 位）。
 *
 * 🔴 复用 `searchRobustness/canonical` 的 `canonicalJsonOf`（**不新造第二套 canonicalizer**）：
 * 指纹要跨进程 / 跨时间稳定，第二套序列化实现迟早会漂移。
 */
export function digestOfExperimentResult(outcome: ExperimentRunOutcome): string {
  const payload = {
    experimentId: outcome.descriptor.id,
    experimentVersion: outcome.descriptor.version,
    datasetVersionId: outcome.execution.datasetFacts.datasetVersionId,
    parameters: outcome.execution.resolvedParameters,
    sampleSummary: outcome.result?.sampleSummary ?? null,
    statistics: outcome.result?.statistics ?? null,
    tables: outcome.result?.tables ?? null,
    distributions: outcome.result?.distributions ?? null,
    comparisons: outcome.result?.comparisons ?? null,
    charts: outcome.result?.charts ?? null,
    customPayload: outcome.result?.customPayload ?? null,
  };
  return `exp-sha256:${createHash("sha256").update(serializeCanonical(payload)).digest("hex").slice(0, 16)}`;
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

      // ---- 2) 草稿 → 策略定义（复用既有唯一转换器）----
      const carrier = buildSketchCarrier(input.draft);
      const executionDataset = {
        datasetVersionId: input.datasetVersionId,
        datasetVersionLabel: outcome.execution.datasetFacts.datasetVersionLabel,
        datasetCode: outcome.execution.datasetFacts.datasetCode,
      };
      let definition: StrategyDefinitionInput;
      let executionAssumptions: ReturnType<typeof buildExecutionAssumptions>;
      let recipe: StrategyRecipe | undefined;
      try {
        definition = buildStrategyDefinition({ candidate: carrier, executionDataset });
        executionAssumptions = buildExecutionAssumptions(carrier);
        recipe = buildStrategyRecipe(carrier);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.DRAFT_INVALID,
          `草案无法转成策略定义：${message}`,
          { cause: (error as { code?: string }).code ?? null },
        );
      }

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
        const message = error instanceof Error ? error.message : String(error);
        // 🔴 如实回报**已产生的坐标**：策略版本已经存在，不装成「什么都没发生」。
        throw new ExperimentStrategyError(
          EXPERIMENT_STRATEGY_ERROR.PROVENANCE_WRITE_FAILED,
          `策略已创建（strategyId=${input.strategyId} version=${strategyVersion} ` +
            `versionRowId=${creation.versionRowId}）但溯源写入失败：${message}。` +
            "该策略版本**仍然可用**，但「从哪个实验来」目前查不到 —— 请重试或用 "
            + "`getVersionProvenance` 确认后再决定是否补写。",
          {
            strategyId: input.strategyId,
            strategyVersion,
            versionRowId: creation.versionRowId,
            created: creation.created,
            provenanceError: (error as { code?: string }).code ?? null,
          },
        );
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
  };
}
