/**
 * STRATEGY-3570001-FINAL-EVALUATION-001 —— 正式评估留档的**纯选择逻辑**（可单测，无 DB）。
 *
 * 职责：从闭环留档列表中挑出本任务的两条运行（基线 1.62.1 / 提升版 3570001），
 * 并把 `result.evaluationDetail` 原样取出交给前端。
 *
 * 纪律：只搬运、不重算；缺失即 null（不伪造、不用空对象冒充）。
 */

export const FINAL_EVALUATION_EXPERIMENT_ID = "STRATEGY-3570001-FINAL-EVALUATION-001";
export const FINAL_EVALUATION_PROMOTED_STRATEGY_ID = "first-limit-pullback-3f-top3-runner-hold20";
export const FINAL_EVALUATION_BASELINE_VERSION = "1.62.1";

export interface FinalEvaluationRunLike {
  readonly id: number;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly result: unknown;
}

export interface FinalEvaluationRowLike {
  readonly id: number;
  readonly experimentId: string | null;
}

export interface FinalEvaluationPair<T> {
  readonly baseline: T | null;
  readonly promoted: T | null;
  readonly evaluationDetail: unknown;
}

/** 筛选出本任务的留档行 id（保持入参顺序）。 */
export function selectFinalEvaluationRunIds<T extends FinalEvaluationRowLike>(
  rows: readonly T[],
): number[] {
  return rows.filter((row) => row.experimentId === FINAL_EVALUATION_EXPERIMENT_ID).map((row) => row.id);
}

/** 从已读回的详情里挑出基线与提升版，并取出 `evaluationDetail`。 */
export function selectFinalEvaluationPair<T extends FinalEvaluationRunLike>(
  details: readonly T[],
): FinalEvaluationPair<T> {
  const promoted =
    details.find((row) => row.strategyId === FINAL_EVALUATION_PROMOTED_STRATEGY_ID) ?? null;
  const baseline =
    details.find((row) => row.strategyVersion === FINAL_EVALUATION_BASELINE_VERSION) ?? null;
  const source = (promoted ?? baseline)?.result as { evaluationDetail?: unknown } | null | undefined;
  return { baseline, promoted, evaluationDetail: source?.evaluationDetail ?? null };
}
