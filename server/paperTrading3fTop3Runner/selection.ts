/** STRATEGY-3570001-PAPER-TRADING-001 —— 模拟盘留档的纯选择逻辑（可单测，无 DB）。 */
export const PAPER_TRADING_3570001_EXPERIMENT = "STRATEGY-3570001-PAPER-TRADING-001";
export const PAPER_TRADING_3570001_STRATEGY = "first-limit-pullback-3f-top3-runner-hold20";

export interface PaperRowLike { readonly id: number; readonly experimentId: string | null }
export interface PaperRunLike { readonly id: number; readonly strategyId: string; readonly result: unknown }

/** 筛选本任务留档行 id（保持入参顺序）。 */
export function selectPaperTradingRunIds<T extends PaperRowLike>(rows: readonly T[]): number[] {
  return rows.filter((row) => row.experimentId === PAPER_TRADING_3570001_EXPERIMENT).map((row) => row.id);
}

/** 取最近一条（入参按 id 降序）本策略留档的 `paperTradingState`；缺失 ⇒ null（不伪造）。 */
export function selectPaperTradingState<T extends PaperRunLike>(details: readonly T[]): unknown {
  const run = details.find((row) => row.strategyId === PAPER_TRADING_3570001_STRATEGY) ?? null;
  const state = (run?.result as { paperTradingState?: unknown } | null | undefined)?.paperTradingState;
  return state ?? null;
}
