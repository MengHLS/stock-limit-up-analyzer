/**
 * STEP 6.2 — 内存 Persistence 实现（测试 / 无库默认）。
 * 存储与读取均结构化克隆，保证 mutation isolation。
 */

import type { ResearchExperiment, ResearchExperimentStatus } from "../types";
import type { ResearchRun } from "../run";
import type { ExperimentBatch, SweepBatchStatus } from "../sweep";
import type { ExperimentRepository, ResearchRunRepository, SweepBatchRepository } from "./contract";

export class InMemoryExperimentRepository implements ExperimentRepository {
  private readonly byId = new Map<string, ResearchExperiment>();

  async create(experiment: ResearchExperiment): Promise<void> {
    if (this.byId.has(experiment.experimentId)) {
      throw new Error(`实验已存在，拒绝重复创建：${experiment.experimentId}`);
    }
    this.byId.set(experiment.experimentId, structuredClone(experiment));
  }

  async get(experimentId: string): Promise<ResearchExperiment | undefined> {
    const experiment = this.byId.get(experimentId);
    return experiment === undefined ? undefined : structuredClone(experiment);
  }

  async list(): Promise<ResearchExperiment[]> {
    return Array.from(this.byId.values())
      .map((experiment) => structuredClone(experiment))
      .sort((left, right) => left.experimentId.localeCompare(right.experimentId));
  }

  async updateStatus(experimentId: string, status: ResearchExperimentStatus): Promise<void> {
    const experiment = this.byId.get(experimentId);
    if (!experiment) {
      throw new Error(`未找到实验，无法更新状态：${experimentId}`);
    }
    // 只替换状态字段，核心输入字段保持冻结不变。
    this.byId.set(experimentId, { ...structuredClone(experiment), status });
  }

  async delete(experimentId: string): Promise<void> {
    if (!this.byId.has(experimentId)) {
      throw new Error(`未找到实验，无法删除：${experimentId}`);
    }
    this.byId.delete(experimentId);
  }
}

export class InMemoryResearchRunRepository implements ResearchRunRepository {
  private readonly byId = new Map<string, ResearchRun>();

  async saveRun(run: ResearchRun): Promise<void> {
    this.byId.set(run.runId, structuredClone(run));
  }

  async getRun(runId: string): Promise<ResearchRun | undefined> {
    const run = this.byId.get(runId);
    return run === undefined ? undefined : structuredClone(run);
  }

  async listRuns(experimentId?: string): Promise<ResearchRun[]> {
    const runs = Array.from(this.byId.values());
    const filtered = experimentId === undefined ? runs : runs.filter((run) => run.experimentId === experimentId);
    return filtered
      .map((run) => structuredClone(run))
      .sort((left, right) => left.runId.localeCompare(right.runId));
  }
}

export class InMemorySweepBatchRepository implements SweepBatchRepository {
  private readonly byId = new Map<string, ExperimentBatch>();

  async create(batch: ExperimentBatch): Promise<void> {
    if (this.byId.has(batch.batchId)) {
      throw new Error(`批次已存在，拒绝重复创建：${batch.batchId}`);
    }
    this.byId.set(batch.batchId, structuredClone(batch));
  }

  async get(batchId: string): Promise<ExperimentBatch | undefined> {
    const batch = this.byId.get(batchId);
    return batch === undefined ? undefined : structuredClone(batch);
  }

  async list(): Promise<ExperimentBatch[]> {
    return Array.from(this.byId.values())
      .map((batch) => structuredClone(batch))
      .sort((left, right) => left.batchId.localeCompare(right.batchId));
  }

  async updateStatus(batchId: string, status: SweepBatchStatus): Promise<void> {
    const batch = this.byId.get(batchId);
    if (!batch) {
      throw new Error(`未找到批次，无法更新状态：${batchId}`);
    }
    this.byId.set(batchId, { ...structuredClone(batch), status });
  }
}
