/**
 * RESEARCH-002 — Analysis Executor Registry（策略派发）。
 *
 * 纪律（指令 §3 / §19）：
 *   - **一类分析一个实现**，禁止把所有逻辑堆在一个 `research-engine.ts`；
 *   - 派发**只经本注册表**：未注册的分析类型 → `UNKNOWN_ANALYSIS_TYPE`（不静默跳过）；
 *   - 同一类型重复注册直接拒绝（防运行期静默覆盖）。
 */

import type { ResearchAnalysisType } from "../../researchCore";
import { engineAssert } from "../errors";
import type { AnalysisExecutor } from "../types";
import { conditionalExecutor } from "./conditional";
import { descriptiveExecutor } from "./descriptive";
import { eventStudyExecutor } from "./eventStudy";
import { quantileExecutor } from "./quantile";
import { segmentRelationExecutor } from "./segmentRelation";
import { stabilityExecutor } from "./stability";

export class AnalysisExecutorRegistry {
  private readonly executors = new Map<ResearchAnalysisType, AnalysisExecutor>();

  register(executor: AnalysisExecutor): void {
    if (this.executors.has(executor.analysisType)) {
      throw new Error(`分析执行器已注册，禁止覆盖：${executor.analysisType}`);
    }
    this.executors.set(executor.analysisType, executor);
  }

  get(type: ResearchAnalysisType): AnalysisExecutor | undefined {
    return this.executors.get(type);
  }

  /** 取执行器；未注册 → `UNKNOWN_ANALYSIS_TYPE`（具名失败，不返回 undefined 让调用方猜）。 */
  require(type: ResearchAnalysisType): AnalysisExecutor {
    const executor = this.executors.get(type);
    engineAssert(executor !== undefined, "UNKNOWN_ANALYSIS_TYPE", `分析类型 ${type} 未在 RESEARCH-002 中实现`, {
      analysisType: type,
      registered: this.listTypes(),
    });
    return executor;
  }

  has(type: ResearchAnalysisType): boolean {
    return this.executors.has(type);
  }

  listTypes(): ResearchAnalysisType[] {
    return [...this.executors.keys()].sort();
  }

  list(): AnalysisExecutor[] {
    return [...this.executors.values()].sort((a, b) => a.analysisType.localeCompare(b.analysisType));
  }
}

/** RESEARCH-002 MVP 的 5 类分析 + RESEARCH-004 的 SEGMENT_RELATION。 */
export function createDefaultAnalysisExecutorRegistry(): AnalysisExecutorRegistry {
  const registry = new AnalysisExecutorRegistry();
  registry.register(descriptiveExecutor);
  registry.register(eventStudyExecutor);
  registry.register(quantileExecutor);
  registry.register(conditionalExecutor);
  registry.register(stabilityExecutor);
  registry.register(segmentRelationExecutor);
  return registry;
}
