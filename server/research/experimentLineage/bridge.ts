/**
 * STEP 13 / C-13.3 — Experiment Lineage：与既有 ExperimentRegistry 的桥（只读包装）。
 *
 * 设计纪律：
 *   - 绝不修改 / 扩展既有 ExperimentRegistry 类（它已负责 experimentId 存取与 mutation
 *     isolation），本桥只做「组合式只读包装」，把 registry 里的实验映射为 §28 谱系记录；
 *   - 纯函数映射 + registry 副本语义：get/list 均返回独立副本，本桥不缓存、不改状态；
 *   - 无 DB：不做任何持久化（持久化属既有 ExperimentRepository 职责，本模块不越界）；
 *   - 失败响亮：未知 experimentId 由底层 registry.get 抛错，不静默返回缺省记录。
 */

import { ExperimentRegistry } from "../experimentRegistry";
import type { ExperimentLineageRecord } from "./types";
import { experimentToLineageRecord, type ExperimentLineageMappingContext } from "./map";
import {
  validateExperimentLineageRecord,
  type ExperimentLineageValidationOptions,
} from "./validate";
import type { ResearchValidationResult } from "../experimentValidation";

/** 只读桥：把 ExperimentRegistry 的实验视图映射为 §28 谱系记录视图。 */
export class ExperimentLineageBridge {
  constructor(private readonly registry: ExperimentRegistry) {}

  /** registry 是否已注册该实验（透传只读）。 */
  has(experimentId: string): boolean {
    return this.registry.has(experimentId);
  }

  /** 取单个实验的谱系记录（未注册 → 底层抛错，响亮暴露）。 */
  getLineage(experimentId: string, context: ExperimentLineageMappingContext): ExperimentLineageRecord {
    const experiment = this.registry.get(experimentId);
    return experimentToLineageRecord(experiment, context);
  }

  /** 列出 registry 全部实验的谱系记录（按 experimentId 字典序，确定性）。 */
  listLineages(context: ExperimentLineageMappingContext): ExperimentLineageRecord[] {
    return this.registry.list().map((experiment) => experimentToLineageRecord(experiment, context));
  }

  /**
   * §28 齐备性机器检查（回答「结果怎么产生的」）：映射后跑 validateExperimentLineageRecord。
   * 缺项 / 格式非法 / 版本格式错 → 结构化 ResearchValidationResult；未注册 → 底层抛错。
   */
  validateLineage(
    experimentId: string,
    context: ExperimentLineageMappingContext,
    options?: ExperimentLineageValidationOptions,
  ): ResearchValidationResult {
    const record = this.getLineage(experimentId, context);
    return validateExperimentLineageRecord(record, options);
  }
}
