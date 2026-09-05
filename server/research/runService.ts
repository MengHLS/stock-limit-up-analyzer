/**
 * STEP 6.2 — ResearchRunService + ResearchRunner（运行编排层）。
 *
 * Runner 职责（orchestration，绝不复制 Backtest Core / 策略 / 成交逻辑）：
 *   load experiment → freeze snapshot → resolve strategy version → validate → 实验状态 running
 *   → create run(running) → execute production backtest → collect result → persist run(succeeded)
 *   或 记录 error + finishedAt 并标记 run(failed)。
 *
 * 本阶段为同步执行（无任务队列）；失败不吞异常（error + finishedAt 持久化，Run 标记 failed，
 * 绝不 catch → return defaultResult）。
 *
 * 前置条件错误（未知策略版本 / 非法快照 / 非法状态迁移）在创建 Run 前即 throw（响亮暴露），
 * 与「执行期失败 → Run FAILED」严格区分。
 */

import { toExperimentSnapshot } from "./experiment";
import { assertValidExperimentSnapshot } from "./experimentValidation";
import { assertExperimentTransition } from "./status";
import { generateRunId } from "./run";
import { runResearchBacktest, summarizeBacktestResult, type ResearchDataLoader } from "./engineAdapter";
import type { ResearchStrategyRegistry } from "./registry";
import type { ExperimentRepository, ResearchRunRepository } from "./persistence/contract";
import type { ResearchStrategyDefinition } from "./strategyContract";
import type { BacktestResult } from "../engine/domain";
import type { ResearchExperimentSnapshot } from "./types";
import type { ResearchRun } from "./run";

/** 执行器：给定冻结快照 + 策略定义，产出 BacktestResult。可注入（失败场景测试）。 */
export type ResearchBacktestExecutor = (
  snapshot: ResearchExperimentSnapshot,
  definition: ResearchStrategyDefinition,
) => Promise<BacktestResult>;

/** 默认执行器：加载数据 → 调用生产 runStrategyEngineBacktest（复用 Backtest Core）。 */
export function createDefaultExecutor(loadData: ResearchDataLoader): ResearchBacktestExecutor {
  return async (snapshot, definition) => {
    const data = await loadData(snapshot.dataset);
    return runResearchBacktest(snapshot, definition, data);
  };
}

export interface ResearchRunServiceDeps {
  strategyRegistry: ResearchStrategyRegistry;
  experimentRepository: ExperimentRepository;
  runRepository: ResearchRunRepository;
  executor: ResearchBacktestExecutor;
}

export class ResearchRunService {
  constructor(private readonly deps: ResearchRunServiceDeps) {}

  async runExperiment(experimentId: string, runId?: string): Promise<ResearchRun> {
    const { strategyRegistry, experimentRepository, runRepository, executor } = this.deps;

    // 1. 加载实验（持久化真相源）。
    const experiment = await experimentRepository.get(experimentId);
    if (!experiment) throw new Error(`未找到实验：${experimentId}`);

    // 2. 冻结 snapshot（独立副本，不依赖当前默认参数 / Feature / Backtest 默认配置）。
    const snapshot = toExperimentSnapshot(experiment);

    // 3. 解析策略版本（未知版本 throw，不伪造版本）。
    const definition = strategyRegistry.get(snapshot.strategyId, snapshot.strategyVersion);

    // 4. 校验实验快照（缺失必需字段 throw，不静默用当前默认值）。
    assertValidExperimentSnapshot(snapshot, definition.parameterSchema);

    // 5. 实验状态 → running（非法迁移 throw）。
    assertExperimentTransition(experiment.status, "running");
    await experimentRepository.updateStatus(experimentId, "running");

    // 6. 创建 Run（running）。
    const resolvedRunId = runId ?? generateRunId(experimentId);
    const startedAt = new Date().toISOString();
    const running: ResearchRun = {
      runId: resolvedRunId,
      experimentId,
      status: "running",
      startedAt,
      result: null,
      error: null,
      createdAt: startedAt,
    };
    await runRepository.saveRun(running);

    // 7. 执行 + 定终态。
    try {
      const result = await executor(snapshot, definition);
      const finishedAt = new Date().toISOString();
      const succeeded: ResearchRun = {
        ...running,
        status: "succeeded",
        finishedAt,
        result: summarizeBacktestResult(result),
        error: null,
      };
      await runRepository.saveRun(succeeded);
      assertExperimentTransition("running", "completed");
      await experimentRepository.updateStatus(experimentId, "completed");
      return structuredClone(succeeded);
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const failed: ResearchRun = {
        ...running,
        status: "failed",
        finishedAt,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
      await runRepository.saveRun(failed);
      assertExperimentTransition("running", "failed");
      await experimentRepository.updateStatus(experimentId, "failed");
      return structuredClone(failed);
    }
  }

  async getRun(runId: string): Promise<ResearchRun | undefined> {
    return this.deps.runRepository.getRun(runId);
  }

  async listRuns(experimentId?: string): Promise<ResearchRun[]> {
    return this.deps.runRepository.listRuns(experimentId);
  }
}
