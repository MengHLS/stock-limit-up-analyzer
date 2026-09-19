/**
 * PARAMETER-001 §9/§10 — Search Result（单组合评估产物 · canonical metrics **只读数**）。
 *
 * ## 铁律：不重算指标（规格 §10）
 *
 * 六个标量**全部**取自评估端口返回的 `ClosedLoopEvaluationRef`：
 *
 * | 本模块字段            | 来源（唯一口径面）                              |
 * |-----------------------|------------------------------------------------|
 * | `totalReturnPct`      | `canonicalMetrics.totalReturnPct`              |
 * | `annualizedReturnPct` | `canonicalMetrics.cagrPct`                     |
 * | `maxDrawdownPct`      | `canonicalMetrics.maxDrawdownPct`              |
 * | `tradeCount`          | `canonicalMetrics.completedTradeCount`         |
 * | `winRatePct`          | `canonicalMetrics.winRatePct`                  |
 * | `profitFactor`        | `canonicalMetrics.profitFactor`                |
 *
 * 🔴 `canonicalMetrics` 缺省为 `null`（历史留档 / 未接线）时，**按既有语义**回落
 *   `performance` / `tradeQuality`，并如实标注 `metricsSource = "evaluators"`。
 *   这是 `ClosedLoopEvaluationRef` 自己声明的降级语义，不是本模块自创的兜底 ——
 *   且**绝不**把缺失值编成 0 / 1 之类看起来正常的数。
 *
 * ## 为什么不做任何派生计算
 *
 * 计算年化需要权益曲线与年化基数；计算盈亏比需要逐笔成交。两样都在评估端口内部
 * （`backtestResult.ts#canonicalMetrics`）。在本层再算一遍就是**第二套口径** ——
 * 全仓已有一次真实教训（`5.3` vs `5.299999999999994`）。⇒ 本模块只做**投影**。
 */

import {
  PARAMETER_SEARCH_RESULT_RECORD_KIND,
  PARAMETER_SEARCH_RESULT_RECORD_VERSION,
  type ParameterSearchMetricsSource,
  type ParameterSearchMetricsView,
  type ParameterSearchResultView,
} from "../../../shared/parameterSearchContracts";
import type { ClosedLoopEvaluationRef } from "../closedLoop/types";
import type { ResearchParameterSet } from "../types";

/** 指标投影结果（读数 + 来源自述 + 年化基数自述）。 */
export interface ParameterSearchMetricsProjection {
  readonly metrics: ParameterSearchMetricsView;
  readonly metricsSource: ParameterSearchMetricsSource;
  readonly annualizationBasis: { readonly type: "TRADING_DAYS"; readonly daysPerYear: number } | null;
}

const EMPTY_METRICS: ParameterSearchMetricsView = {
  totalReturnPct: null,
  annualizedReturnPct: null,
  maxDrawdownPct: null,
  tradeCount: null,
  winRatePct: null,
  profitFactor: null,
};

/**
 * 从评估引用投影六个 canonical 标量（**纯投影，零重算**）。
 *
 * `evaluation === null`（评估失败）⇒ 全部为 `null` + `metricsSource = "evaluators"`。
 */
export function projectCanonicalMetrics(
  evaluation: ClosedLoopEvaluationRef | null,
): ParameterSearchMetricsProjection {
  if (evaluation === null) {
    return { metrics: { ...EMPTY_METRICS }, metricsSource: "evaluators", annualizationBasis: null };
  }

  const canonical = evaluation.canonicalMetrics;
  if (canonical !== null) {
    return {
      metrics: {
        totalReturnPct: canonical.totalReturnPct,
        annualizedReturnPct: canonical.cagrPct,
        maxDrawdownPct: canonical.maxDrawdownPct,
        tradeCount: canonical.completedTradeCount,
        winRatePct: canonical.winRatePct,
        profitFactor: canonical.profitFactor,
      },
      metricsSource: "canonical",
      annualizationBasis: {
        type: canonical.annualizationBasis.type,
        daysPerYear: canonical.annualizationBasis.daysPerYear,
      },
    };
  }

  // 降级：评估引用自述 metricsSource === "evaluators"（未接线 canonical）⇒ 取评估器面，
  // 并如实标注来源。重叠的 5 个标量仍在 `performance` / `tradeQuality` 上。
  return {
    metrics: {
      totalReturnPct: evaluation.performance?.totalReturnPct ?? null,
      annualizedReturnPct: evaluation.performance?.cagrPct ?? null,
      maxDrawdownPct: evaluation.performance?.maxDrawdownPct ?? null,
      tradeCount: evaluation.tradeQuality?.completedTradeCount ?? null,
      winRatePct: evaluation.tradeQuality?.winRatePct ?? null,
      profitFactor: evaluation.tradeQuality?.profitFactor ?? null,
    },
    metricsSource: "evaluators",
    annualizationBasis: null,
  };
}

/** 组装 Result 的输入（全部来自真实评估产物；缺一即如实置 null，不猜）。 */
export interface BuildParameterSearchResultInput {
  readonly searchRunId: string;
  readonly combinationIndex: number;
  readonly parameterHash: string;
  readonly parameters: ResearchParameterSet;
  readonly evaluationConfigFingerprint: string;
  readonly createdAt: string;
  readonly evaluation: ClosedLoopEvaluationRef | null;
  readonly experimentId: string | null;
  readonly evaluationRunId: string | null;
  readonly backtestFingerprint: string | null;
  readonly error: string | null;
}

/**
 * 组装单组合结果视图。
 *
 * `status` 的判据**只看评估引用是否存在**（`evaluation !== null` ⇒ SUCCEEDED），
 * 不看指标是否为 null —— 「成功但某指标不可用」与「失败」是两件事，不得混淆。
 */
export function buildParameterSearchResult(
  input: BuildParameterSearchResultInput,
): ParameterSearchResultView {
  const projection = projectCanonicalMetrics(input.evaluation);
  const succeeded = input.evaluation !== null && input.error === null;
  return {
    recordKind: PARAMETER_SEARCH_RESULT_RECORD_KIND,
    recordVersion: PARAMETER_SEARCH_RESULT_RECORD_VERSION,
    searchRunId: input.searchRunId,
    combinationIndex: input.combinationIndex,
    parameterHash: input.parameterHash,
    parameters: input.parameters,
    status: succeeded ? "SUCCEEDED" : "FAILED",
    error: succeeded ? null : (input.error ?? "评估未产出可用的 evaluation 引用"),
    backtestFingerprint: input.backtestFingerprint,
    backtestRunId: null,
    evaluationId: input.experimentId,
    evaluationRunId: input.evaluationRunId,
    evaluation: input.evaluation,
    metrics: projection.metrics,
    metricsSource: projection.metricsSource,
    annualizationBasis: projection.annualizationBasis,
    evaluationConfigFingerprint: input.evaluationConfigFingerprint,
    createdAt: input.createdAt,
  };
}

/**
 * 指标是否「六项全不可用」。
 *
 * 用于 UI 一次性提示「该组合评估成功但指标不可用」，避免逐格显示 `—` 让人误以为界面坏了。
 */
export function isMetricsFullyUnavailable(metrics: ParameterSearchMetricsView): boolean {
  return (
    metrics.totalReturnPct === null
    && metrics.annualizedReturnPct === null
    && metrics.maxDrawdownPct === null
    && metrics.tradeCount === null
    && metrics.winRatePct === null
    && metrics.profitFactor === null
  );
}
