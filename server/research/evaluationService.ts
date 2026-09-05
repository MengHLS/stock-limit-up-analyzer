/**
 * STEP 6.4 — Research Evaluation Service（Train / Validation / OOS 编排层）。
 *
 * 职责（orchestration，绝不复制 Backtest Core / 策略 / 成交 / 持仓逻辑）：
 *
 *   evaluateValidation：候选快照逐个在 Validation 区间运行（复用 ResearchBacktestExecutor →
 *                       Production Backtest Core），产出 ValidationCandidateResult[]；
 *   selectValidationCandidate：Validation-only 选择（委托 validationSelection，签名不接收 OOS）；
 *   freezeSelectedCandidate：把选中实验冻结为 FrozenOosCandidate（参数/版本/成本模型锁定）；
 *   evaluateOos：冻结候选在 OOS 区间运行（只接受 FrozenOosCandidate，不接受 ParameterSpace），
 *                产出 immutable OosEvaluationResult。
 *
 * 关键设计（反过拟合）：
 *   - OOS 只能消费 FrozenOosCandidate（类型层面强制，§30「OOS 未完成 Validation 不可运行」）；
 *   - 区间重定向 `retargetSnapshot` 只改 dataset 日期，**保留冻结 costModel / backtestConfig /
 *     featureConfig**（不重读 DEFAULT_COST_MODEL，见 §21）；
 *   - 策略版本通过 `strategyRegistry.get(strategyId, strategyVersion)` 精确解析（§47：绝不 getLatest）。
 *
 * 边界铁律：Research 可以调用 Production Backtest Core（正向），Production 不得反向依赖 Research。
 */

import type { PerformanceMetrics } from "../engine/domain";
import type { ResearchDatasetRange } from "./datasetSplit";
import { buildOosEvaluationResult, type OosEvaluationResult } from "./oosEvaluation";
import type { ResearchStrategyRegistry } from "./registry";
import type { ResearchBacktestExecutor } from "./runService";
import type { TrainCandidateResult } from "./trainEvaluation";
import {
  assertValidResearchEvaluationPlan,
  type ResearchEvaluationPlan,
} from "./trainValidationOos";
import type { ResearchExperimentSnapshot } from "./types";
import {
  freezeOosCandidate,
  selectBestValidationResult,
  type FrozenOosCandidate,
  type ValidationCandidateResult,
  type ValidationSelectionResult,
} from "./validationSelection";

/** 评估服务依赖。executor 即 ResearchRunService 内部使用的同一生产核心网关。 */
export interface ResearchEvaluationServiceDeps {
  strategyRegistry: ResearchStrategyRegistry;
  executor: ResearchBacktestExecutor;
}

export class ResearchEvaluationService {
  constructor(private readonly deps: ResearchEvaluationServiceDeps) {}

  /**
   * 候选快照逐个在 Train 区间运行，产出 TrainCandidateResult[]（STEP 6.5-FIX-1）。
   *
   * 与 evaluateValidation 复用同一 Production Backtest Core，唯一区别是数据集区间重定向到
   * plan.split.train（§八/§九：retargetSnapshot 只改日期，保留冻结 strategyVersion / costModel）。
   * 执行失败记录为 failed（error 保留），绝不 catch → 静默当作 metric=0（§二十四）。
   */
  async evaluateTrain(
    candidates: readonly ResearchExperimentSnapshot[],
    plan: ResearchEvaluationPlan,
  ): Promise<TrainCandidateResult[]> {
    assertValidResearchEvaluationPlan(plan);
    const definition = this.deps.strategyRegistry.get(plan.strategyId, plan.strategyVersion);
    const results: TrainCandidateResult[] = [];

    for (const snapshot of candidates) {
      const trainSnapshot = retargetSnapshot(snapshot, plan.split.train);
      try {
        const result = await this.deps.executor(trainSnapshot, definition);
        results.push({
          experimentId: snapshot.experimentId,
          parameterSet: structuredClone(snapshot.parameterSet),
          status: "succeeded",
          metrics: structuredClone(result.performance),
        });
      } catch (error) {
        results.push({
          experimentId: snapshot.experimentId,
          parameterSet: structuredClone(snapshot.parameterSet),
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /**
   * 候选快照逐个在 Validation 区间运行，产出 ValidationCandidateResult[]。
   * 执行失败记录为 failed（error 保留），绝不 catch → return 空结果（§52）。
   */
  async evaluateValidation(
    candidates: readonly ResearchExperimentSnapshot[],
    plan: ResearchEvaluationPlan,
  ): Promise<ValidationCandidateResult[]> {
    assertValidResearchEvaluationPlan(plan);
    const definition = this.deps.strategyRegistry.get(plan.strategyId, plan.strategyVersion);
    const results: ValidationCandidateResult[] = [];

    for (const snapshot of candidates) {
      const validationSnapshot = retargetSnapshot(snapshot, plan.split.validation);
      try {
        const result = await this.deps.executor(validationSnapshot, definition);
        results.push({
          experimentId: snapshot.experimentId,
          parameterSet: structuredClone(snapshot.parameterSet),
          status: "succeeded",
          metrics: structuredClone(result.performance),
        });
      } catch (error) {
        results.push({
          experimentId: snapshot.experimentId,
          parameterSet: structuredClone(snapshot.parameterSet),
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** Validation-only 选择（仅接受 Validation 结果，天然不接受 OOS）。 */
  selectValidationCandidate(
    results: readonly ValidationCandidateResult[],
    plan: ResearchEvaluationPlan,
  ): ValidationSelectionResult {
    assertValidResearchEvaluationPlan(plan);
    return selectBestValidationResult({
      candidates: results,
      selectionMetric: plan.selectionMetric,
      selectionDirection: plan.selectionDirection,
      validationFingerprint: plan.datasetSplitFingerprint,
    });
  }

  /** 把选中实验冻结为 OOS 候选（snapshot 为身份/参数/成本模型的单一事实来源）。 */
  freezeSelectedCandidate(
    selection: ValidationSelectionResult,
    candidates: readonly ResearchExperimentSnapshot[],
  ): FrozenOosCandidate {
    const snapshot = candidates.find((candidate) => candidate.experimentId === selection.selectedExperimentId);
    if (!snapshot) {
      throw new Error(`未找到选中实验的快照：${selection.selectedExperimentId}`);
    }
    return freezeOosCandidate({
      experimentId: selection.selectedExperimentId,
      snapshot,
      validationMetric: selection.selectionMetric,
      validationValue: selection.selectionValue,
      validationFingerprint: selection.validationFingerprint,
    });
  }

  /**
   * 冻结候选在 OOS 区间运行（最终隔离评估）。
   * 只接受 FrozenOosCandidate（不接受 ParameterSpace / 原始参数），产出 immutable OosEvaluationResult。
   */
  async evaluateOos(candidate: FrozenOosCandidate, plan: ResearchEvaluationPlan): Promise<OosEvaluationResult> {
    assertValidResearchEvaluationPlan(plan);
    // 精确解析策略版本（§47：绝不 getLatest）。
    const definition = this.deps.strategyRegistry.get(candidate.strategyId, candidate.strategyVersion);
    const oosSnapshot = retargetSnapshot(candidate.snapshot, plan.split.oos);

    try {
      const result = await this.deps.executor(oosSnapshot, definition);
      return buildOosEvaluationResult({
        candidate,
        datasetSplitFingerprint: plan.datasetSplitFingerprint,
        oosRange: structuredClone(plan.split.oos),
        status: "succeeded",
        metrics: structuredClone(result.performance),
        executedAt: new Date().toISOString(),
      });
    } catch (error) {
      return buildOosEvaluationResult({
        candidate,
        datasetSplitFingerprint: plan.datasetSplitFingerprint,
        oosRange: structuredClone(plan.split.oos),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        executedAt: new Date().toISOString(),
      });
    }
  }
}

/**
 * 区间重定向：克隆快照并把 dataset 日期改为目标区间。
 * 关键：只改日期，保留冻结的 costModel / backtestConfig / featureConfig（§21：不重读默认成本模型）。
 */
export function retargetSnapshot(snapshot: ResearchExperimentSnapshot, range: ResearchDatasetRange): ResearchExperimentSnapshot {
  return {
    ...structuredClone(snapshot),
    dataset: {
      ...structuredClone(snapshot.dataset),
      startDate: range.start,
      endDate: range.end,
    },
  };
}

/** 供测试 / 下游复用：构造最小合法的 PerformanceMetrics（全部字段显式）。 */
export function makePerformanceMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    totalReturnPct: 0,
    annualizedReturnPct: null,
    annualizedVolatilityPct: null,
    sharpeRatio: null,
    maxDrawdownPct: 0,
    tradeCount: 0,
    completedTradeCount: 0,
    winRatePct: null,
    profitFactor: null,
    averageWin: null,
    averageLoss: null,
    expectancy: null,
    openPositionCount: 0,
    ...overrides,
  };
}
