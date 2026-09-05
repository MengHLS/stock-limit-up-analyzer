/**
 * STEP 6.3 — SweepService + SweepRunner（参数扫描编排层）。
 *
 * 职责（orchestration，绝不复制 Backtest Core / 策略 / 成交 / 持仓逻辑）：
 *
 *   createSweep：
 *     校验参数空间 → 计算组合数并强制 maxCombinations → 生成确定性组合
 *     → 预校验每个组合（复用 resolveParameterSet，失败即 FAIL FAST，不产生孤儿实验）
 *     → 每个组合走 STEP 6.2 标准 createExperiment（独立 Experiment + Snapshot），记录本次成功创建的 ID
 *     → 组装并持久化 ExperimentBatch（冻结参数空间快照 + fingerprint）
 *     → 任一步失败：只回滚本次调用创建的 Experiment（不触碰历史实验），随后重新抛出原始异常。
 *
 *   runSweep（SweepRunner）：
 *     Batch → 逐个 Experiment → runService.runExperiment（复用生产 Backtest Core）
 *     → 汇总 total / succeeded / failed / cancelled → 定 Batch 终态。
 *
 *   getSweepResults：
 *     从已持久化的 Experiment + Run 记录重构可追溯结果（实验 id / run id / 完整参数集 / 指标 / 错误）。
 *
 * 边界铁律：
 *   - Sweep 是「实验编排工具」，不是「寻找历史最优参数的自动优化器」；
 *   - 不提供 selectBestParameters；sortSweepResults 仅排序；
 *   - 不实现并发调度器（顺序执行，正确性优先）；
 *   - 不吞异常：执行期失败由 runService 记录为 FAILED Run（不 throw）；
 *     前置条件错误（未知实验 / 非法状态）throw 响亮暴露，绝不 catch 后返回默认结果。
 */

import { generateParameterCombinations, type CombinationGenerationOptions } from "./combinationGenerator";
import { resolveParameterSet } from "./experiment";
import { generateExperimentId } from "./experimentIdentity";
import type { ExperimentService } from "./experimentService";
import type { ResearchStrategyRegistry } from "./registry";
import type { ResearchRunService } from "./runService";
import { assertBatchTransition } from "./status";
import { computeParameterSpaceFingerprint, generateBatchId } from "./sweep";
import type { ExperimentBatch, SweepBatchStatus, SweepResult, SweepResultStatus, SweepSummary } from "./sweep";
import type { ParameterSpace } from "./parameterSpace";
import type { ResearchRun } from "./run";
import type { ResearchBacktestConfig, ResearchDatasetSpec, ResearchFeatureConfig } from "./types";
import type { SweepBatchRepository } from "./persistence/contract";

/** 创建 Sweep 的输入。 */
export interface CreateSweepInput {
  strategyId: string;
  strategyVersion: string;
  parameterSpace: ParameterSpace;
  dataset: ResearchDatasetSpec;
  featureConfig?: ResearchFeatureConfig;
  backtestConfig: ResearchBacktestConfig;
  /** 组合数量上限（缺省 DEFAULT_MAX_COMBINATIONS）。 */
  maxCombinations?: number;
  /** 批 ID（缺省自动生成）。 */
  batchId?: string;
  /** 创建时间（测试可注入；缺省当前时间）。 */
  createdAt?: string;
}

export interface SweepServiceDeps {
  strategyRegistry: ResearchStrategyRegistry;
  experimentService: ExperimentService;
  runService: ResearchRunService;
  batchRepository: SweepBatchRepository;
}

export class SweepService {
  constructor(private readonly deps: SweepServiceDeps) {}

  /**
   * 创建一次参数扫描：生成确定性组合 → 每个组合走标准 createExperiment → 持久化 Batch。
   *
   * 原子性保证：
   *   - 组合在创建任何 Experiment 之前统一预校验（resolveParameterSet），非法即抛错，零创建零孤儿；
   *   - 实验创建 / Batch 持久化任一步失败：回滚删除本次调用自己成功创建的 Experiment（只按实验 ID，
   *     绝不按 strategyId / fingerprint 等条件批量删除历史实验），然后重新抛出原始异常；
   *   - 回滚删除自身的失败逐个记录（console.error）且不阻断其余清理，但绝不伪装成成功。
   */
  async createSweep(input: CreateSweepInput): Promise<ExperimentBatch> {
    const { strategyRegistry, experimentService, batchRepository } = this.deps;

    // 1. 校验策略身份存在（未知策略版本 throw，不伪造版本）。
    const definition = strategyRegistry.get(input.strategyId, input.strategyVersion);

    // 2. 生成确定性组合（内部完成：校验参数空间 → 计算数量 → 强制上限 → 生成）。
    const options: CombinationGenerationOptions = input.maxCombinations === undefined
      ? {}
      : { maxCombinations: input.maxCombinations };
    const combinations = generateParameterCombinations(input.parameterSpace, options);

    // 3. 预校验每个组合（复用 STEP 6.1 resolveParameterSet：应用默认值 + 严格类型校验）。
    //    任一组合非法 → 在创建任何 Experiment 之前 FAIL FAST，避免部分创建造成孤儿实验。
    for (const parameterSet of combinations) {
      resolveParameterSet(parameterSet, definition.parameterSchema);
    }

    // 4. 每个组合走 STEP 6.2 标准创建流程（独立 Experiment + canonical Snapshot）。
    //    记录本次调用成功创建的 ID：任一步（实验创建 / Batch 持久化）失败时只回滚这些 ID，
    //    绝不按 strategyId / fingerprint 等条件删除历史实验。
    const experimentIds: string[] = [];
    const createdExperimentIds: string[] = [];
    try {
      for (const parameterSet of combinations) {
        const experiment = await experimentService.createExperiment({
          experimentId: generateExperimentId(),
          strategyId: input.strategyId,
          strategyVersion: input.strategyVersion,
          parameterSet,
          dataset: input.dataset,
          featureConfig: input.featureConfig,
          backtestConfig: input.backtestConfig,
        });
        createdExperimentIds.push(experiment.experimentId);
        experimentIds.push(experiment.experimentId);
      }

      // 5. 组装 + 持久化 Batch（冻结参数空间快照 + fingerprint，可追溯「当时搜了哪些参数」）。
      const batch: ExperimentBatch = {
        batchId: input.batchId ?? generateBatchId(),
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        parameterSpace: structuredClone(input.parameterSpace),
        parameterSpaceFingerprint: computeParameterSpaceFingerprint(input.parameterSpace),
        experimentIds,
        status: "created",
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      await batchRepository.create(batch);
      return structuredClone(batch);
    } catch (error) {
      // 回滚：删除本次 createSweep 自己创建成功的实验，随后重新抛出原始异常（绝不吞掉）。
      const rollbackFailedIds = await this.rollbackCreatedExperiments(createdExperimentIds);
      if (rollbackFailedIds.length > 0) {
        // 回滚自身失败必须可观察 / 记录；原始业务异常仍由 throw error 向上传播，不伪装成功。
        console.error(
          `[createSweep] 回滚不完整：本次创建 ${createdExperimentIds.length} 个实验，${rollbackFailedIds.length} 个删除失败（可能残留孤儿）：`,
          rollbackFailedIds,
        );
      }
      throw error;
    }
  }

  /**
   * 回滚删除本次 createSweep 调用自己创建的实验（仅限本次调用记录的 experimentId）。
   * 逐个删除并收集删除失败的 ID；单个删除失败不阻断其余清理。
   * 返回删除失败的 experimentId 列表，供调用方记录 / 观察。
   */
  private async rollbackCreatedExperiments(createdExperimentIds: readonly string[]): Promise<string[]> {
    const failedIds: string[] = [];
    for (const experimentId of createdExperimentIds) {
      try {
        await this.deps.experimentService.deleteExperiment(experimentId);
      } catch (deleteError) {
        failedIds.push(experimentId);
        console.error(`[createSweep] 回滚删除实验失败：${experimentId}`, deleteError);
      }
    }
    return failedIds;
  }

  /**
   * SweepRunner：Batch → 逐个 Experiment → ResearchRun → 现有 Backtest Core。
   * 只做编排，不实现回测。返回 SweepSummary（total / succeeded / failed / cancelled）。
   */
  async runSweep(batchId: string): Promise<SweepSummary> {
    const { batchRepository, runService } = this.deps;
    const batch = await batchRepository.get(batchId);
    if (!batch) throw new Error(`未找到批次：${batchId}`);

    assertBatchTransition(batch.status, "running");
    await batchRepository.updateStatus(batchId, "running");

    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;

    try {
      for (const experimentId of batch.experimentIds) {
        const run = await runService.runExperiment(experimentId);
        if (run.status === "succeeded") {
          succeeded += 1;
        } else if (run.status === "failed") {
          failed += 1;
        } else {
          cancelled += 1;
        }
      }
    } catch (error) {
      // 前置条件错误（未知实验 / 非法快照 / 非法状态）→ 标记批次失败并重新抛出（不吞异常）。
      await batchRepository.updateStatus(batchId, "failed");
      throw error;
    }

    const finalStatus: SweepBatchStatus = failed > 0 ? "failed" : "completed";
    await batchRepository.updateStatus(batchId, finalStatus);

    return {
      batchId,
      total: batch.experimentIds.length,
      succeeded,
      failed,
      cancelled,
    };
  }

  async getBatch(batchId: string): Promise<ExperimentBatch> {
    const batch = await this.deps.batchRepository.get(batchId);
    if (!batch) throw new Error(`未找到批次：${batchId}`);
    return batch;
  }

  async listBatches(): Promise<ExperimentBatch[]> {
    return this.deps.batchRepository.list();
  }

  /**
   * 从已持久化的 Experiment + Run 重构 Sweep 结果（可追溯：实验 id / run id / 完整参数集 / 指标 / 错误）。
   * 每个实验取最近一次 Run（本阶段顺序执行，每次实验仅一次 Run）。
   */
  async getSweepResults(batchId: string): Promise<SweepResult[]> {
    const { batchRepository, experimentService, runService } = this.deps;
    const batch = await batchRepository.get(batchId);
    if (!batch) throw new Error(`未找到批次：${batchId}`);

    const results: SweepResult[] = [];
    for (const experimentId of batch.experimentIds) {
      const experiment = await experimentService.getExperiment(experimentId);
      const runs = await runService.listRuns(experimentId);
      const latestRun = pickLatestRun(runs);
      if (!latestRun) {
        results.push({ experimentId, parameterSet: structuredClone(experiment.parameterSet), status: "cancelled" });
        continue;
      }

      const status: SweepResultStatus = latestRun.status === "succeeded"
        ? "succeeded"
        : latestRun.status === "failed" ? "failed" : "cancelled";

      results.push({
        experimentId,
        runId: latestRun.runId,
        parameterSet: structuredClone(experiment.parameterSet),
        status,
        metrics: latestRun.result === null ? undefined : structuredClone(latestRun.result.performance),
        error: latestRun.error === null ? undefined : latestRun.error,
      });
    }
    return results;
  }
}

/** 选择最近一次 Run（按 createdAt 降序；本阶段每实验仅一次 Run，取唯一即可）。 */
function pickLatestRun(runs: readonly ResearchRun[]): ResearchRun | undefined {
  if (runs.length === 0) return undefined;
  return [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}
