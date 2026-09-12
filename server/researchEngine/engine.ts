/**
 * RESEARCH-002 — ResearchEngine（编排层）。
 *
 * 两个入口，共用同一条执行核心：
 *
 * **① `run({ experimentId, runId })` —— 整轮执行（10 步，指令 §4）**
 *   1. Load Experiment
 *   2. Load Run（并校验 Run 属于该 Experiment）
 *   3. Validate Dataset Version（存在 + READY + 与 Experiment 绑定一致）
 *   4. Load Analysis definitions（并加载 CONDITIONAL 的结构化条件）
 *   5. Resolve Dataset input（变量需求并集 → 最小化装配样本）
 *   6. Execute analyses（经 Registry 派发到**每类一个**独立 executor）
 *   7. Calculate metrics（executor 内部统一走 MetricCalculator）
 *   8. Persist results（`research_result`：先清旧行再批量写）
 *   9. Generate conclusion（ConclusionBuilder → `research_conclusion`）
 *  10. Update Run / Experiment status
 *
 * **② `runIncremental({ experimentId, runId, analysisIds? })` —— 增量补跑**
 *   只补算「尚无有效结果」的分析（PENDING / FAILED / CANCELLED），**不重跑已完成的**。
 *   三条硬约束（缺一即不成立）：
 *   - **复用 Run 冻结的基准**：Dataset Version 与日期窗口一律取自 `run.inputSnapshot`
 *     （不是 Experiment 的当前配置）。样本集只由「Dataset Version + 日期窗口」决定
 *     （`buildSampleSet` 不按条件过滤事件，变量只是投影列），因此补跑出的结果与
 *     原批次**同一基准**，可比。
 *   - **显式记账**：每批追加一条 `run.executionLog`。`inputSnapshot` 是不可变基准，
 *     不能改；不记账就会让「一条 Run 分多批跑」被误读成「只跑过一批」。
 *   - **不生成结论**：`AnalysisSummary` 是执行期产物、未落库，无法重建**已跳过**分析的
 *     历史摘要 ⇒ 拼不出完整结论。故增量批次返回 `conclusionId = null` +
 *     `conclusionSkippedReason`，并**保留**既有结论不动（其证据未被改写）。
 *
 * 生命周期：`PENDING → RUNNING → COMPLETED`；异常 → `RUNNING → FAILED`，
 * 且 **必须**把 `errorCode` / `errorMessage` 落到 `research_run`（不吞错、不静默成功）。
 *
 * 边界：本层**不写 Dataset**、**不做回测**、**不碰正式 Strategy**、
 *       统计计算一律委托 MetricCalculator（Engine 自己不算任何统计量）。
 */

import type {
  ResearchAnalysis,
  ResearchConditionSet,
  ResearchExperimentStatus,
  ResearchRepositories,
  ResearchRun,
  ResearchRunExecutionLogEntry,
  ResearchRunUpdatePatch,
} from "../researchCore";
import {
  appendExecutionLogEntry,
  groupConditions,
  nextExecutionSequence,
  settleExecutionLogEntry,
} from "../researchCore";
import { createDefaultAnalysisExecutorRegistry, type AnalysisExecutorRegistry } from "./analyses/registry";
import { resolveEngineAnalysisConfig } from "./analysisConfig";
import { buildConclusion, type ConclusionPolicy } from "./conclusion";
import type { ResearchDatasetReader } from "./datasetReader";
import { ResearchEngineError, engineAssert, toResearchEngineError } from "./errors";
import { DEFAULT_EVENT_PAGE_SIZE, DEFAULT_MAX_SAMPLES, buildSampleSet } from "./sampleSet";
import type {
  AnalysisExecutionContext,
  AnalysisSummary,
  ResearchDatasetVersionContext,
  ResearchEngineIncrementalInput,
  ResearchEngineIncrementalResult,
  ResearchEngineRunResult,
  ResearchVariableRequirement,
} from "./types";
import { ResearchVariableCatalog, type RegimeTagProvider } from "./variables";

export interface ResearchEngineDeps {
  repos: ResearchRepositories;
  reader: ResearchDatasetReader;
  /** 分析执行器注册表；缺省 = RESEARCH-002 MVP 的 5 类分析。 */
  registry?: AnalysisExecutorRegistry;
  /** 结论判定策略覆盖（缺省用 DEFAULT_CONCLUSION_POLICY）。 */
  conclusionPolicy?: Partial<ConclusionPolicy>;
  /** 市场环境标签源（STABILITY 按 regime 分组时必须提供）。 */
  regimeProvider?: RegimeTagProvider;
  /** 事件分页大小。 */
  eventPageSize?: number;
  /** 样本硬上限（超限诚实失败，不 OOM）。 */
  maxSamples?: number;
  /** 是否在执行前清空该 Run 下既有结果（重跑幂等）。缺省 true。 */
  resetExistingResults?: boolean;
}

export interface ResearchEngineRunInput {
  experimentId: number;
  runId: number;
}

/** 分析状态中「尚无有效结果」的集合 —— 增量补跑只受理这些。 */
const RUNNABLE_ANALYSIS_STATUSES: ReadonlySet<string> = new Set(["PENDING", "FAILED", "CANCELLED"]);

/** 增量批次不生成结论的确切原因（写入 `executionLog[].conclusionSkippedReason`）。 */
export const INCREMENTAL_CONCLUSION_SKIPPED_REASON =
  "INCREMENTAL_EXECUTION: 增量批次只补算部分分析。结论需要**该 Run 全部分析**的摘要，" +
  "而 AnalysisSummary 是执行期产物、未落库，无法重建已跳过分析的历史摘要。" +
  "因此本批次不生成结论，并保留既有结论不动（其证据未被改写）。" +
  "如需产出反映全部分析的新结论，请新建 Run 或整轮重跑。";

/** 已解析的分析执行单元（配置 + 变量需求 + 执行器）。 */
interface ResolvedAnalysis {
  analysis: ResearchAnalysis;
  config: ReturnType<typeof resolveEngineAnalysisConfig>;
  requirement: ResearchVariableRequirement;
  executor: ReturnType<AnalysisExecutorRegistry["require"]>;
}

/** 逐分析执行并落库的产物。 */
interface ExecuteAnalysesResult {
  outcomes: ResearchEngineRunResult["analyses"];
  summaries: Array<{
    analysisId: number;
    analysisType: ResearchAnalysis["analysisType"];
    summary: AnalysisSummary;
  }>;
  resultCount: number;
}

/** Run 冻结的样本基准（取自不可变的 `inputSnapshot`）。 */
interface RunSnapshotBasis {
  datasetVersionId: number;
  startDate?: string;
  endDate?: string;
  /** 原批次的变量并集（可能缺失：属早期数据，缺失不影响事件集，仅少投影若干列）。 */
  variables?: ResearchVariableRequirement;
}

export class ResearchEngine {
  private readonly repos: ResearchRepositories;
  private readonly reader: ResearchDatasetReader;
  private readonly registry: AnalysisExecutorRegistry;
  private readonly conclusionPolicy: Partial<ConclusionPolicy> | undefined;
  private readonly regimeProvider: RegimeTagProvider | undefined;
  private readonly eventPageSize: number;
  private readonly maxSamples: number;
  private readonly resetExistingResults: boolean;

  constructor(deps: ResearchEngineDeps) {
    this.repos = deps.repos;
    this.reader = deps.reader;
    this.registry = deps.registry ?? createDefaultAnalysisExecutorRegistry();
    this.conclusionPolicy = deps.conclusionPolicy;
    this.regimeProvider = deps.regimeProvider;
    this.eventPageSize = deps.eventPageSize ?? DEFAULT_EVENT_PAGE_SIZE;
    this.maxSamples = deps.maxSamples ?? DEFAULT_MAX_SAMPLES;
    this.resetExistingResults = deps.resetExistingResults ?? true;
  }

  // =-------------------------------------------------------------------------
  // 入口 ①：整轮执行
  // =-------------------------------------------------------------------------

  /** 执行一次研究 Run。失败时 Run 落 FAILED + errorCode / errorMessage，然后重新抛出。 */
  async run(input: ResearchEngineRunInput): Promise<ResearchEngineRunResult> {
    const startedAt = Date.now();
    /** 是否已真正进入执行阶段（RUNNING 之后）。 */
    let runStarted = false;
    /**
     * Run 是否已被确认存在、属于该 Experiment、且状态可执行。
     * 预检失败（配置非法、Dataset 未就绪等）同样必须把失败原因落库，
     * 否则 Run 会永久停在 PENDING —— 用户只能看到「没跑」却看不到「为什么没跑」。
     */
    let runIdentified = false;
    /** 本批次序号与「已追加 RUNNING 条目」的日志（失败时用于收敛为 FAILED）。 */
    let batchSequence: number | null = null;
    let batchLog: ResearchRunExecutionLogEntry[] | null = null;

    try {
      // ---- 1. Load Experiment ----
      const experiment = await this.repos.experiments.getById(input.experimentId);
      engineAssert(
        experiment !== undefined,
        "EXPERIMENT_NOT_FOUND",
        `未找到 Research Experiment：${input.experimentId}`,
        { experimentId: input.experimentId },
      );

      // ---- 2. Load Run ----
      const run = await this.repos.runs.getById(input.runId);
      engineAssert(run !== undefined, "RUN_NOT_FOUND", `未找到 Research Run：${input.runId}`, {
        runId: input.runId,
      });
      engineAssert(
        run.experimentId === experiment.id,
        "RUN_EXPERIMENT_MISMATCH",
        `Run ${run.id} 属于 Experiment ${run.experimentId}，与请求的 ${experiment.id} 不一致`,
        { runId: run.id, runExperimentId: run.experimentId, experimentId: experiment.id },
      );
      engineAssert(
        run.status === "PENDING" || run.status === "FAILED" || run.status === "CANCELLED",
        "RUN_NOT_PENDING",
        `Run ${run.id} 当前状态为 ${run.status}，只有 PENDING / FAILED / CANCELLED 可执行`,
        { runId: run.id, status: run.status },
      );
      // 到此为止，本次执行可以归因到这个 Run —— 后续任何失败都必须可追溯。
      runIdentified = true;

      // ---- 3. Validate Dataset Version ----
      const datasetVersionId = experiment.datasetVersionId;
      const versionContext = await this.reader.getVersionContext(datasetVersionId);
      engineAssert(
        versionContext !== null,
        "DATASET_VERSION_NOT_FOUND",
        `未找到 Dataset Version：${datasetVersionId}`,
        { datasetVersionId },
      );
      engineAssert(
        versionContext.status === "READY",
        "DATASET_VERSION_NOT_READY",
        `Dataset Version ${datasetVersionId} 状态为 ${versionContext.status}，只有 READY 版本可用于研究`,
        { datasetVersionId, status: versionContext.status },
      );

      // ---- 4. Load Analysis definitions ----
      const analyses = await this.repos.analyses.list({ runId: run.id! });
      engineAssert(
        analyses.length > 0,
        "NO_ANALYSES",
        `Run ${run.id} 下没有任何 Analysis，无法执行`,
        { runId: run.id },
      );

      const catalog = this.buildCatalog(versionContext);
      const conditionSets = await this.loadConditionSets(analyses, catalog);

      // 逐分析解析配置（**在 RUNNING 之前**完成校验，配置错误不留下「跑了一半」的状态）
      const resolved = this.resolveAnalyses({ analyses, experiment, catalog, conditionSets });

      // ---- 5. Resolve Dataset input（最小化装配）----
      const unionRequirement = unionRequirementOf(resolved);
      const dateRange = resolveRunDateRange(experiment, run);

      // ---- 状态：RUNNING（在此之后任何异常都必须落 FAILED）----
      // 同时追加本批次（mode=FULL）的执行日志条目：这是一条 Run 的**基准批次**。
      const batchStartedAt = new Date().toISOString();
      batchSequence = nextExecutionSequence(run);
      batchLog = appendExecutionLogEntry(run, {
        sequence: batchSequence,
        mode: "FULL",
        analysisIds: analyses.map((a) => a.id!).sort((x, y) => x - y),
        sampleCount: null,
        status: "RUNNING",
        startedAt: batchStartedAt,
        completedAt: null,
      });
      await this.repos.runs.update(run.id!, {
        status: "RUNNING",
        startedAt: batchStartedAt,
        // 🔴 重跑（FAILED / CANCELLED 后再次执行）**必须清掉上一轮的失败残留**，否则：
        //   ① RUNNING 的 Run 会带着旧 errorCode / errorMessage，UI 同时显示「执行中 + 上一次的错误」；
        //   ② `completedAt < startedAt`，破坏「completedAt 是否为空 / startedAt 是否为空」
        //      区分「预检拒绝 / 执行中崩溃 / 已收口」的既有语义（见 §19 与 maintenance 约定）。
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        inputSnapshot: {
          datasetVersionId,
          datasetCode: versionContext.datasetCode,
          datasetVersionLabel: versionContext.versionLabel,
          ...(dateRange.startDate !== undefined ? { startDate: dateRange.startDate } : {}),
          ...(dateRange.endDate !== undefined ? { endDate: dateRange.endDate } : {}),
          runConfig: run.config ?? null,
          researchType: experiment.researchType,
          variables: unionRequirement,
          analysisTypes: analyses.map((a) => a.analysisType),
          snapshotAt: batchStartedAt,
        },
        executionLog: batchLog,
      });
      await this.repos.experiments.update(experiment.id!, { status: "RUNNING" });
      runStarted = true;

      const sampleSet = await buildSampleSet({
        reader: this.reader,
        datasetVersionId,
        catalog,
        requirement: unionRequirement,
        dimensionKeys: unionRequirement.dimensions ?? [],
        ...(this.regimeProvider !== undefined ? { regimeProvider: this.regimeProvider } : {}),
        dateRange,
        eventPageSize: this.eventPageSize,
        maxSamples: this.maxSamples,
      });

      engineAssert(
        sampleSet.samples.length > 0,
        "EMPTY_SAMPLE_SET",
        `Dataset Version ${datasetVersionId} 在给定条件下没有产生任何样本`,
        { datasetVersionId, dateRange },
      );

      // ---- 6/7/8. Execute analyses → persist results ----
      const { outcomes: analysisOutcome, summaries, resultCount } = await this.executeAnalyses({
        resolved,
        sampleSet: sampleSet.samples,
        versionContext,
        conditionSets,
      });

      // ---- 9. Generate conclusion ----
      const hypotheses = await this.repos.hypotheses.listByExperiment(experiment.id!);
      const hypothesis = hypotheses[0] ?? null;
      const built = buildConclusion({
        experiment: { id: experiment.id, name: experiment.name, researchType: experiment.researchType },
        hypothesis,
        analyses: summaries,
        ...(this.conclusionPolicy !== undefined ? { policy: this.conclusionPolicy } : {}),
      });
      const conclusion = await this.repos.conclusions.create({
        experimentId: experiment.id!,
        hypothesisId: hypothesis?.id ?? null,
        conclusionType: built.draft.conclusionType,
        title: built.draft.title,
        conclusion: built.draft.conclusion,
        evidence: built.draft.evidence,
        confidence: built.draft.confidence,
        status: "DRAFT",
      });

      // ---- 10. Update Run / Experiment ----
      const completedAt = new Date().toISOString();
      await this.repos.runs.update(run.id!, {
        status: "COMPLETED",
        completedAt,
        sampleCount: sampleSet.samples.length,
        errorCode: null,
        errorMessage: null,
        executionLog: settleExecutionLogEntry({ executionLog: batchLog }, batchSequence, {
          status: "COMPLETED",
          completedAt,
          sampleCount: sampleSet.samples.length,
        }),
      });
      await this.repos.experiments.update(experiment.id!, {
        status: "COMPLETED",
        sampleCount: sampleSet.samples.length,
        completedAt,
        ...(experiment.startedAt === null || experiment.startedAt === undefined
          ? { startedAt: completedAt }
          : {}),
      });

      return {
        experimentId: experiment.id!,
        runId: run.id!,
        datasetVersionId,
        sampleCount: sampleSet.samples.length,
        analysisCount: resolved.length,
        resultCount,
        conclusionId: conclusion.id ?? null,
        conclusionType: conclusion.conclusionType,
        analyses: analysisOutcome,
        sampleBuildMs: sampleSet.buildMs,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const e = toResearchEngineError(err);
      if (runIdentified) {
        // 尽力落 FAILED（失败原因必须可追溯）；此处再失败也不能掩盖原始错误。
        try {
          const failedAt = new Date().toISOString();
          const patch: ResearchRunUpdatePatch = {
            status: "FAILED",
            completedAt: failedAt,
            errorCode: e.code,
            errorMessage: e.message,
          };
          // 已追加批次日志 → 把它收敛为 FAILED（**不新增条目**、不留 RUNNING 悬挂态）。
          if (batchSequence !== null && batchLog !== null) {
            patch.executionLog = settleExecutionLogEntry({ executionLog: batchLog }, batchSequence, {
              status: "FAILED",
              completedAt: failedAt,
              errorCode: e.code,
              errorMessage: e.message,
            });
          }
          await this.repos.runs.update(input.runId, patch);
          if (runStarted) {
            // 已真正开始执行后失败 → Experiment 一并标记 FAILED。
            // 预检阶段失败（配置非法 / Dataset 未就绪等）只标记 Run：
            // Experiment 仍保持原状态，修正配置后可直接重跑。
            await this.repos.experiments.update(input.experimentId, { status: "FAILED" });
          }
        } catch {
          // 有意忽略：原始错误优先。
        }
      }
      throw e;
    }
  }

  // =-------------------------------------------------------------------------
  // 入口 ②：增量补跑
  // =-------------------------------------------------------------------------

  /**
   * 增量补跑：只补算指定（或全部「尚无有效结果」的）分析，复用 Run 已冻结的样本基准。
   *
   * 与 `run()` 的关键差别：
   *   - Run **必须已经整轮执行过**（`inputSnapshot` 存在）—— 否则没有可比基准，应走 `run()`；
   *   - **不覆盖**已 COMPLETED 的分析（要重跑请新建 Run，保持结果不可覆盖）；
   *   - **不生成结论**（见 `INCREMENTAL_CONCLUSION_SKIPPED_REASON`）；
   *   - Run 终态由「该 Run 下是否仍有未完成的分析」决定。
   *
   * 失败时仍按既有纪律落 Run `FAILED` + `errorCode` / `errorMessage`，并把本批次日志
   * 收敛为 FAILED；**此前批次已产出的结果原样保留**。
   */
  async runIncremental(
    input: ResearchEngineIncrementalInput,
  ): Promise<ResearchEngineIncrementalResult> {
    const startedAt = Date.now();
    let runStarted = false;
    let runIdentified = false;
    let batchSequence: number | null = null;
    let batchLog: ResearchRunExecutionLogEntry[] | null = null;
    /** 增量不应永久改写 Experiment 的既有状态；失败/未完成时按原值回滚。 */
    let previousExperimentStatus: ResearchExperimentStatus | null = null;

    try {
      // ---- 1. Load Experiment ----
      const experiment = await this.repos.experiments.getById(input.experimentId);
      engineAssert(
        experiment !== undefined,
        "EXPERIMENT_NOT_FOUND",
        `未找到 Research Experiment：${input.experimentId}`,
        { experimentId: input.experimentId },
      );
      previousExperimentStatus = experiment.status;

      // ---- 2. Load Run ----
      const run = await this.repos.runs.getById(input.runId);
      engineAssert(run !== undefined, "RUN_NOT_FOUND", `未找到 Research Run：${input.runId}`, {
        runId: input.runId,
      });
      engineAssert(
        run.experimentId === experiment.id,
        "RUN_EXPERIMENT_MISMATCH",
        `Run ${run.id} 属于 Experiment ${run.experimentId}，与请求的 ${experiment.id} 不一致`,
        { runId: run.id, runExperimentId: run.experimentId, experimentId: experiment.id },
      );
      engineAssert(
        run.status !== "RUNNING",
        "RUN_ALREADY_RUNNING",
        `Run ${run.id} 正在执行中（status=RUNNING），请等当前批次结束后再补跑`,
        { runId: run.id, status: run.status },
      );
      runIdentified = true;

      // ---- 3. 基准：一律取自 Run 冻结的快照（不取 Experiment 当前配置）----
      const basis = readSnapshotBasis(run);
      engineAssert(
        basis.datasetVersionId === experiment.datasetVersionId,
        "DATASET_VERSION_DRIFT",
        `Run ${run.id} 的快照基准指向 Dataset Version ${basis.datasetVersionId}，` +
          `与 Experiment 当前绑定的 ${experiment.datasetVersionId} 不一致：补跑将失去可比性，已拒绝。`,
        {
          runId: run.id,
          snapshotDatasetVersionId: basis.datasetVersionId,
          experimentDatasetVersionId: experiment.datasetVersionId,
        },
      );

      const versionContext = await this.reader.getVersionContext(basis.datasetVersionId);
      engineAssert(
        versionContext !== null,
        "DATASET_VERSION_NOT_FOUND",
        `未找到 Dataset Version：${basis.datasetVersionId}`,
        { datasetVersionId: basis.datasetVersionId },
      );
      engineAssert(
        versionContext.status === "READY",
        "DATASET_VERSION_NOT_READY",
        `Dataset Version ${basis.datasetVersionId} 状态为 ${versionContext.status}，只有 READY 版本可用于研究`,
        { datasetVersionId: basis.datasetVersionId, status: versionContext.status },
      );

      // ---- 4. 选定补跑目标（在 RUNNING 之前完成全部校验）----
      const allAnalyses = await this.repos.analyses.list({ runId: run.id! });
      const targets = selectRunnableAnalyses(allAnalyses, run.id!, input.analysisIds);
      engineAssert(
        targets.length > 0,
        "NO_RUNNABLE_ANALYSES",
        `Run ${run.id} 下没有可补跑的分析（只有 PENDING / FAILED / CANCELLED 可补跑）。` +
          `已 COMPLETED 的分析不会被覆盖；要重跑请新建 Run。`,
        { runId: run.id, analysisCount: allAnalyses.length },
      );

      const catalog = this.buildCatalog(versionContext);
      const conditionSets = await this.loadConditionSets(targets, catalog);
      const resolved = this.resolveAnalyses({ analyses: targets, experiment, catalog, conditionSets });

      // ---- 5. 样本基准：Dataset Version + 日期窗口取自快照；变量投影 = 原批次并集 ∪ 目标需求 ----
      // 事件集只由「Dataset Version + 日期窗口」决定（buildSampleSet 不按条件过滤事件），
      // 变量只是投影列 ⇒ 并上目标分析的新变量不会改变样本集，补跑结果与原批次可比。
      const requirement = mergeRequirements(basis.variables, unionRequirementOf(resolved));

      const batchStartedAt = new Date().toISOString();
      batchSequence = nextExecutionSequence(run);
      batchLog = appendExecutionLogEntry(run, {
        sequence: batchSequence,
        mode: "INCREMENTAL",
        analysisIds: targets.map((a) => a.id!).sort((x, y) => x - y),
        sampleCount: null,
        status: "RUNNING",
        startedAt: batchStartedAt,
        completedAt: null,
      });
      await this.repos.runs.update(run.id!, {
        status: "RUNNING",
        startedAt: batchStartedAt,
        // 同 run()：补跑也可能发生在一次 FAILED 之后，必须清掉失败残留（否则 errorCode 会「粘住」）。
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        executionLog: batchLog,
      });
      await this.repos.experiments.update(experiment.id!, { status: "RUNNING" });
      runStarted = true;

      const sampleSet = await buildSampleSet({
        reader: this.reader,
        datasetVersionId: basis.datasetVersionId,
        catalog,
        requirement,
        dimensionKeys: requirement.dimensions ?? [],
        ...(this.regimeProvider !== undefined ? { regimeProvider: this.regimeProvider } : {}),
        dateRange: {
          ...(basis.startDate !== undefined ? { startDate: basis.startDate } : {}),
          ...(basis.endDate !== undefined ? { endDate: basis.endDate } : {}),
        },
        eventPageSize: this.eventPageSize,
        maxSamples: this.maxSamples,
      });

      engineAssert(
        sampleSet.samples.length > 0,
        "EMPTY_SAMPLE_SET",
        `Dataset Version ${basis.datasetVersionId} 在基准日期窗口内没有产生任何样本`,
        { datasetVersionId: basis.datasetVersionId, startDate: basis.startDate, endDate: basis.endDate },
      );

      // ---- 6. 只执行目标分析 ----
      const { outcomes: analysisOutcome, resultCount } = await this.executeAnalyses({
        resolved,
        sampleSet: sampleSet.samples,
        versionContext,
        conditionSets,
      });

      // ---- 7. 收敛 Run / Experiment 终态（Run 终态 = 是否仍有未完成分析）----
      const completedAt = new Date().toISOString();
      const after = await this.repos.analyses.list({ runId: run.id! });
      const allCompleted = after.every((a) => a.status === "COMPLETED");
      await this.repos.runs.update(run.id!, {
        status: allCompleted ? "COMPLETED" : "PENDING",
        completedAt,
        sampleCount: sampleSet.samples.length,
        errorCode: null,
        errorMessage: null,
        executionLog: settleExecutionLogEntry({ executionLog: batchLog }, batchSequence, {
          status: "COMPLETED",
          completedAt,
          sampleCount: sampleSet.samples.length,
          conclusionSkippedReason: INCREMENTAL_CONCLUSION_SKIPPED_REASON,
        }),
      });
      await this.repos.experiments.update(experiment.id!, {
        // 全部完成 → COMPLETED；仍有未完成分析 → 回滚到补跑前的状态（不臆造新状态）
        status: allCompleted ? "COMPLETED" : (previousExperimentStatus ?? experiment.status),
        ...(allCompleted ? { completedAt } : {}),
      });

      return {
        experimentId: experiment.id!,
        runId: run.id!,
        executionSequence: batchSequence,
        datasetVersionId: basis.datasetVersionId,
        basisSource: "run-snapshot",
        sampleCount: sampleSet.samples.length,
        analysisCount: resolved.length,
        resultCount,
        conclusionId: null,
        conclusionSkippedReason: INCREMENTAL_CONCLUSION_SKIPPED_REASON,
        analyses: analysisOutcome,
        sampleBuildMs: sampleSet.buildMs,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const e = toResearchEngineError(err);
      if (runIdentified) {
        try {
          const failedAt = new Date().toISOString();
          const patch: ResearchRunUpdatePatch = {
            status: "FAILED",
            completedAt: failedAt,
            errorCode: e.code,
            errorMessage: e.message,
          };
          if (batchSequence !== null && batchLog !== null) {
            patch.executionLog = settleExecutionLogEntry({ executionLog: batchLog }, batchSequence, {
              status: "FAILED",
              completedAt: failedAt,
              errorCode: e.code,
              errorMessage: e.message,
            });
          }
          await this.repos.runs.update(input.runId, patch);
          if (runStarted && previousExperimentStatus !== null) {
            // 增量失败不改写 Experiment 的既有结论性状态：回滚到补跑前的值。
            await this.repos.experiments.update(input.experimentId, {
              status: previousExperimentStatus,
            });
          }
        } catch {
          // 有意忽略：原始错误优先。
        }
      }
      throw e;
    }
  }

  // =-------------------------------------------------------------------------
  // 共用执行核心
  // =-------------------------------------------------------------------------

  /** 变量目录：视界来自 Dataset 的**真实值**（outcome.horizon 与 path.relativeDay 范围）。 */
  private buildCatalog(versionContext: ResearchDatasetVersionContext): ResearchVariableCatalog {
    const pathHorizons = versionContext.pathRelativeDayRange
      ? rangeInclusive(1, versionContext.pathRelativeDayRange.max)
      : [];
    return new ResearchVariableCatalog(versionContext.horizons, pathHorizons);
  }

  /** 条件集（仅 CONDITIONAL 需要；其余分析为空集），并校验字段可解析。 */
  private async loadConditionSets(
    analyses: readonly ResearchAnalysis[],
    catalog: ResearchVariableCatalog,
  ): Promise<Map<number, ResearchConditionSet>> {
    const conditionSets = new Map<number, ResearchConditionSet>();
    for (const analysis of analyses) {
      if (analysis.analysisType !== "CONDITIONAL") continue;
      const rows = await this.repos.conditions.listByAnalysis(analysis.id!);
      const set: ResearchConditionSet = { groups: groupConditions(rows) };
      this.assertConditionFieldsKnown(set, catalog);
      conditionSets.set(analysis.id!, set);
    }
    return conditionSets;
  }

  /** 逐分析解析配置并推导变量需求（变量名一律过目录，未登记 / 角色反用 → 具名失败）。 */
  private resolveAnalyses(args: {
    analyses: readonly ResearchAnalysis[];
    experiment: { config?: unknown };
    catalog: ResearchVariableCatalog;
    conditionSets: Map<number, ResearchConditionSet>;
  }): ResolvedAnalysis[] {
    const { analyses, experiment, catalog, conditionSets } = args;
    const experimentDefaults =
      (experiment.config as { analysisDefaults?: Record<string, unknown> } | null | undefined)
        ?.analysisDefaults ?? null;
    const resolved: ResolvedAnalysis[] = [];
    for (const analysis of analyses) {
      const executor = this.registry.require(analysis.analysisType);
      const config = resolveEngineAnalysisConfig({
        analysis,
        defaults: experimentDefaults as never,
        catalog,
        ...(this.regimeProvider !== undefined ? { regimeProvider: this.regimeProvider } : {}),
      });
      const conditionSet = conditionSets.get(analysis.id!) ?? { groups: [] };
      const requirement = executor.requiredVariables(config, { catalog, conditionSet });
      for (const name of requirement.features) catalog.resolveFeature(name);
      for (const name of requirement.outcomes) catalog.resolveOutcome(name);
      resolved.push({ analysis, config, requirement, executor });
    }
    return resolved;
  }

  /**
   * 逐分析执行并落库。
   * 任一分析失败 → 该分析落 FAILED，然后抛 `ANALYSIS_FAILED`（由调用方决定 Run 终态）。
   */
  private async executeAnalyses(args: {
    resolved: readonly ResolvedAnalysis[];
    sampleSet: readonly AnalysisExecutionContext["samples"][number][];
    versionContext: ResearchDatasetVersionContext;
    conditionSets: Map<number, ResearchConditionSet>;
  }): Promise<ExecuteAnalysesResult> {
    const { resolved, sampleSet, versionContext, conditionSets } = args;
    const outcomes: ResearchEngineRunResult["analyses"] = [];
    const summaries: ExecuteAnalysesResult["summaries"] = [];
    let resultCount = 0;

    for (const item of resolved) {
      const analysisId = item.analysis.id!;
      await this.repos.analyses.update(analysisId, { status: "RUNNING" });
      const analysisStartedAt = Date.now();
      try {
        const context: AnalysisExecutionContext = {
          analysis: item.analysis,
          config: item.config,
          datasetVersionId: versionContext.datasetVersionId,
          samples: sampleSet,
          horizons: versionContext.horizons,
          conditionSet: conditionSets.get(analysisId) ?? { groups: [] },
        };
        const executed = await item.executor.execute(context);

        if (this.resetExistingResults) {
          await this.repos.results.deleteByAnalysis(analysisId);
        }
        const written = await this.repos.results.createMany(executed.rows);
        resultCount += written.length;

        await this.repos.analyses.update(analysisId, {
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
        });
        summaries.push({ analysisId, analysisType: item.analysis.analysisType, summary: executed.summary });
        outcomes.push({
          analysisId,
          analysisType: item.analysis.analysisType,
          status: "COMPLETED",
          resultCount: written.length,
          durationMs: Date.now() - analysisStartedAt,
        });
      } catch (err) {
        const e = toResearchEngineError(err);
        await this.repos.analyses.update(analysisId, {
          status: "FAILED",
          completedAt: new Date().toISOString(),
        });
        outcomes.push({
          analysisId,
          analysisType: item.analysis.analysisType,
          status: "FAILED",
          resultCount: 0,
          durationMs: Date.now() - analysisStartedAt,
          errorCode: e.code,
        });
        throw new ResearchEngineError(
          "ANALYSIS_FAILED",
          `分析 ${item.analysis.analysisType}（id=${analysisId}）执行失败：${e.message}`,
          { analysisId, analysisType: item.analysis.analysisType, cause: e.code },
        );
      }
    }
    return { outcomes, summaries, resultCount };
  }

  /** 条件字段必须能解析（特征 / 结果 / 合法维度之一），否则早失败。 */
  private assertConditionFieldsKnown(set: ResearchConditionSet, catalog: ResearchVariableCatalog): void {
    const known = new Set<string>([
      ...catalog.listFeatures(),
      ...catalog.listOutcomes(),
      ...["year", "month", "quarter", "board", "market", "industry", "regime"],
    ]);
    for (const group of set.groups) {
      for (const condition of group.conditions) {
        engineAssert(
          known.has(condition.fieldName),
          "UNKNOWN_VARIABLE",
          `条件字段 "${condition.fieldName}" 不是已知变量或分组维度`,
          { fieldName: condition.fieldName },
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 纯函数辅助
// ---------------------------------------------------------------------------

/** 变量需求并集（去重，保持出现顺序）。 */
function unionRequirementOf(resolved: readonly ResolvedAnalysis[]): ResearchVariableRequirement {
  return {
    features: [...new Set(resolved.flatMap((r) => r.requirement.features))],
    outcomes: [...new Set(resolved.flatMap((r) => r.requirement.outcomes))],
    dimensions: [...new Set(resolved.flatMap((r) => r.requirement.dimensions ?? []))],
  };
}

/** 两份变量需求的并集（用于把补跑的新变量并到原批次基准上）。 */
function mergeRequirements(
  base: ResearchVariableRequirement | undefined,
  extra: ResearchVariableRequirement,
): ResearchVariableRequirement {
  if (base === undefined) return extra;
  return {
    features: [...new Set([...base.features, ...extra.features])],
    outcomes: [...new Set([...base.outcomes, ...extra.outcomes])],
    dimensions: [...new Set([...(base.dimensions ?? []), ...(extra.dimensions ?? [])])],
  };
}

/**
 * 读取 Run 冻结的样本基准。
 * 快照缺失或 `datasetVersionId` 不可用 → `RUN_SNAPSHOT_MISSING`（响亮失败，不猜一个基准出来）。
 */
function readSnapshotBasis(run: ResearchRun): RunSnapshotBasis {
  const snap = run.inputSnapshot;
  engineAssert(
    snap !== null && snap !== undefined && typeof snap === "object" && !Array.isArray(snap),
    "RUN_SNAPSHOT_MISSING",
    `Run ${run.id} 没有可用的执行基准快照（从未整轮执行过）。` +
      `请先对该 Run 点「运行引擎」完成一次整轮执行，之后再补跑新增分析。`,
    { runId: run.id },
  );
  const s = snap as Record<string, unknown>;

  const datasetVersionId = s.datasetVersionId;
  engineAssert(
    typeof datasetVersionId === "number" && Number.isInteger(datasetVersionId) && datasetVersionId > 0,
    "RUN_SNAPSHOT_MISSING",
    `Run ${run.id} 的执行快照缺少可用的 datasetVersionId（实得 ${String(datasetVersionId)}），无法确定样本基准。`,
    { runId: run.id, datasetVersionId },
  );

  const basis: RunSnapshotBasis = { datasetVersionId: datasetVersionId as number };
  if (typeof s.startDate === "string" && s.startDate.length > 0) basis.startDate = s.startDate;
  if (typeof s.endDate === "string" && s.endDate.length > 0) basis.endDate = s.endDate;

  const v = s.variables;
  if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
    const vr = v as Record<string, unknown>;
    const names = (x: unknown): string[] =>
      Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
    basis.variables = {
      features: names(vr.features),
      outcomes: names(vr.outcomes),
      dimensions: names(vr.dimensions),
    };
  }
  return basis;
}

/**
 * 选定补跑目标。
 * - `explicitIds` 省略 → 该 Run 下全部「尚无有效结果」的分析（PENDING / FAILED / CANCELLED）；
 * - 指定 id 时：不属于该 Run → `ANALYSIS_NOT_IN_RUN`；已 COMPLETED / 正在 RUNNING → `ANALYSIS_NOT_RUNNABLE`。
 */
function selectRunnableAnalyses(
  all: readonly ResearchAnalysis[],
  runId: number,
  explicitIds: readonly number[] | undefined,
): ResearchAnalysis[] {
  if (explicitIds === undefined) {
    return all.filter((a) => RUNNABLE_ANALYSIS_STATUSES.has(a.status));
  }
  const byId = new Map<number, ResearchAnalysis>();
  for (const a of all) byId.set(a.id!, a);

  const out: ResearchAnalysis[] = [];
  const seen = new Set<number>();
  for (const id of explicitIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const analysis = byId.get(id);
    engineAssert(
      analysis !== undefined,
      "ANALYSIS_NOT_IN_RUN",
      `分析 ${id} 不属于 Run ${runId}，无法在它上面补跑`,
      { analysisId: id, runId },
    );
    engineAssert(
      RUNNABLE_ANALYSIS_STATUSES.has(analysis!.status),
      "ANALYSIS_NOT_RUNNABLE",
      `分析 ${id} 当前状态为 ${analysis!.status}，不可补跑（只有 PENDING / FAILED / CANCELLED 可补跑；` +
        `已 COMPLETED 的分析不会被覆盖，要重跑请新建 Run）`,
      { analysisId: id, status: analysis!.status },
    );
    out.push(analysis!);
  }
  return out;
}

/** 生成 [from, to] 闭区间整数序列。 */
function rangeInclusive(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

/** Run 级日期范围优先于 Experiment 级。 */
function resolveRunDateRange(
  experiment: { config?: unknown },
  run: { config?: unknown },
): { startDate?: string; endDate?: string } {
  const fromRun = (run.config as { dateRange?: { startDate?: string; endDate?: string } } | null | undefined)?.dateRange;
  const fromExp = (experiment.config as { dateRange?: { startDate?: string; endDate?: string } } | null | undefined)
    ?.dateRange;
  const merged: { startDate?: string; endDate?: string } = {};
  const start = fromRun?.startDate ?? fromExp?.startDate;
  const end = fromRun?.endDate ?? fromExp?.endDate;
  if (start !== undefined) merged.startDate = start;
  if (end !== undefined) merged.endDate = end;
  return merged;
}
