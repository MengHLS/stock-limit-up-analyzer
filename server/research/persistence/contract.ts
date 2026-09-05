/**
 * STEP 6.2 — Persistence 契约（Repository 接口）。
 *
 * 职责边界：
 *   - ExperimentRepository 只负责实验记录的存取与「状态」更新，绝不提供修改核心输入
 *     （strategyId / strategyVersion / parameterSet / dataset / featureConfig / backtestConfig / snapshot）的入口；
 *   - ResearchRunRepository 只负责 Run 记录的存取。
 * Service / Runner 通过接口依赖，与具体存储（内存 / DB）解耦。
 */

import type { ResearchExperiment, ResearchExperimentStatus } from "../types";
import type { ResearchRun } from "../run";
import type { ExperimentBatch, SweepBatchStatus } from "../sweep";

export interface ExperimentRepository {
  create(experiment: ResearchExperiment): Promise<void>;
  get(experimentId: string): Promise<ResearchExperiment | undefined>;
  list(): Promise<ResearchExperiment[]>;
  /** 仅允许更新状态；禁止触碰 snapshot / 参数 / 数据集等核心输入字段。 */
  updateStatus(experimentId: string, status: ResearchExperimentStatus): Promise<void>;
  /**
   * 删除实验记录。
   * 仅供编排层在创建流程中途失败时精确回滚「本次调用自己创建的实验」使用；
   * 不允许按 strategyId / fingerprint 等条件批量删除历史实验。
   * 删除不存在的 experimentId 抛错（与 updateStatus 一致，暴露异常而非静默吞掉）。
   */
  delete(experimentId: string): Promise<void>;
}

export interface ResearchRunRepository {
  saveRun(run: ResearchRun): Promise<void>;
  getRun(runId: string): Promise<ResearchRun | undefined>;
  /** 按 experimentId 过滤列出 Run（缺省列出全部）。 */
  listRuns(experimentId?: string): Promise<ResearchRun[]>;
}

/**
 * STEP 6.3 — Sweep Batch 持久化契约。
 * 只负责批记录的存取与「状态」更新；核心输入（strategyId / strategyVersion /
 * parameterSpace / experimentIds / fingerprint）一经创建即冻结，绝不提供修改入口。
 */
export interface SweepBatchRepository {
  create(batch: ExperimentBatch): Promise<void>;
  get(batchId: string): Promise<ExperimentBatch | undefined>;
  list(): Promise<ExperimentBatch[]>;
  /** 仅允许更新状态。 */
  updateStatus(batchId: string, status: SweepBatchStatus): Promise<void>;
}
