/**
 * STEP 6.2 — Experiment Registry（实验注册中心，与 Strategy Registry 分离）。
 *
 *   experimentId → ResearchExperiment
 *
 * 职责：以 experimentId 为身份键存取完整实验；重复 experimentId 拒绝；get/list 返回独立副本
 * （mutation isolation，外部无法经返回值篡改 registry 内部状态）。
 * 不依赖 Database / Network / Date.now / Math.random。
 */

import type { ResearchExperiment } from "./types";

export class ExperimentRegistry {
  private readonly byId = new Map<string, ResearchExperiment>();

  /** 注册实验；同 experimentId 已存在时抛错。 */
  register(experiment: ResearchExperiment): void {
    if (this.byId.has(experiment.experimentId)) {
      throw new Error(`实验已注册，拒绝重复注册：${experiment.experimentId}`);
    }
    this.byId.set(experiment.experimentId, structuredClone(experiment));
  }

  /** 是否已注册指定 experimentId。 */
  has(experimentId: string): boolean {
    return this.byId.has(experimentId);
  }

  /** 按 experimentId 取实验；未知身份抛错。返回独立副本。 */
  get(experimentId: string): ResearchExperiment {
    const experiment = this.byId.get(experimentId);
    if (!experiment) {
      throw new Error(`未注册的实验：${experimentId}`);
    }
    return structuredClone(experiment);
  }

  /** 列出全部实验（按 experimentId 字典序稳定排序；返回独立副本）。 */
  list(): ResearchExperiment[] {
    return Array.from(this.byId.values())
      .map((experiment) => structuredClone(experiment))
      .sort((left, right) => left.experimentId.localeCompare(right.experimentId));
  }

  /**
   * 注销指定实验；仅供编排层在创建流程中途失败时精确回滚「本次调用自己注册的实验」使用。
   * 未注册的 experimentId 静默忽略（幂等；与 register 的重复拒绝语义互补）。
   */
  unregister(experimentId: string): void {
    this.byId.delete(experimentId);
  }
}
