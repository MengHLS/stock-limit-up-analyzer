/**
 * STEP 6.2 — ExperimentService：实验创建 / 查询 / 冻结 / 状态管理（编排层）。
 *
 * 职责：
 *   - createExperiment：解析参数（应用 schema 默认值）→ 构造实验（status=created）→ 注册 → 持久化；
 *   - get/list：查询（以 Repository 为持久化真相源）；
 *   - transitionStatus：仅通过受约束状态机迁移，绝不提供修改核心输入字段的入口。
 *
 * 依赖注入：ResearchStrategyRegistry（研究层）+ ExperimentRegistry（进程内索引）+ ExperimentRepository（持久化）。
 */

import { createExperiment, toExperimentSnapshot, type CreateExperimentInput } from "./experiment";
import { ExperimentRegistry } from "./experimentRegistry";
import { assertExperimentTransition } from "./status";
import type { ResearchStrategyRegistry } from "./registry";
import type { ExperimentRepository } from "./persistence/contract";
import type { ResearchExperiment, ResearchExperimentSnapshot, ResearchExperimentStatus } from "./types";

export interface ExperimentServiceDeps {
  strategyRegistry: ResearchStrategyRegistry;
  experimentRegistry: ExperimentRegistry;
  experimentRepository: ExperimentRepository;
}

export class ExperimentService {
  constructor(private readonly deps: ExperimentServiceDeps) {}

  async createExperiment(input: CreateExperimentInput): Promise<ResearchExperiment> {
    const { strategyRegistry, experimentRegistry, experimentRepository } = this.deps;
    const definition = strategyRegistry.get(input.strategyId, input.strategyVersion);
    const experiment = createExperiment(input, definition);
    experimentRegistry.register(experiment);
    try {
      await experimentRepository.create(experiment);
    } catch (error) {
      // 持久化失败即整体失败：注销进程内注册，避免留下「仅存在于 Registry、不存在于持久层」的孤儿。
      experimentRegistry.unregister(experiment.experimentId);
      throw error;
    }
    return structuredClone(experiment);
  }

  /**
   * 删除实验（进程内 Registry 与持久化 Repository 同步删除）。
   * 仅供编排层在创建流程中途失败时精确回滚「本次调用自己创建的实验」使用，
   * 不允许按 strategyId / fingerprint 等条件批量删除历史实验。
   */
  async deleteExperiment(experimentId: string): Promise<void> {
    const { experimentRegistry, experimentRepository } = this.deps;
    await experimentRepository.delete(experimentId);
    experimentRegistry.unregister(experimentId);
  }

  async getExperiment(experimentId: string): Promise<ResearchExperiment> {
    const experiment = await this.deps.experimentRepository.get(experimentId);
    if (!experiment) throw new Error(`未找到实验：${experimentId}`);
    return experiment;
  }

  async listExperiments(): Promise<ResearchExperiment[]> {
    return this.deps.experimentRepository.list();
  }

  /** 冻结实验输入（canonical snapshot，独立副本，不受后续默认值 / 实验对象变更影响）。 */
  freezeExperiment(experiment: ResearchExperiment): ResearchExperimentSnapshot {
    return toExperimentSnapshot(experiment);
  }

  /** 受约束状态迁移（非法迁移 throw；绝不修改核心输入字段）。 */
  async transitionStatus(experimentId: string, to: ResearchExperimentStatus): Promise<void> {
    const experiment = await this.getExperiment(experimentId);
    assertExperimentTransition(experiment.status, to);
    await this.deps.experimentRepository.updateStatus(experimentId, to);
  }
}
