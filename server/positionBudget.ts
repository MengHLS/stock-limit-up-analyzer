import type { PositionSizingStrategy } from "./realisticBacktest";

/**
 * 单笔计划预算分配 —— **唯一权威实现**。
 *
 * 为什么独立成文件：同一口径同时被两处需要 ——
 *   ① 交易模拟器（`realisticBacktest`）在每根决策日给「已选中的标的」分配预算，随后买入；
 *   ② 展示层（`leaderCandidates#buildLeaderCandidateStrategyPortfolioSnapshot`）要向用户
 *      回显「下一实际交易日准备买入」每一笔的**计划仓位上限**。
 * 两处若各写一份必然漂移（本项目已多次因「同一口径两份实现」出事故）⇒ 收敛到本函数。
 *
 * 口径（与模拟器逐字节一致）：
 *   · `equal`        → 预算 = 决策时点可用现金 ÷ 本批选中标的数；
 *   · `scoreWeighted`→ 预算 = 可用现金 × 本标的分数 ÷ 本批分数合计（合计为 0 时退化为等权）；
 *   · `fixedPercent` → 预算 = 初始资金 × 固定单笔比例。
 * 其中「分数」必须是**模拟器实际用于加权的分数**（已含风险扣分 / 质量复合等策略加工），
 * 而非原始候选分。
 *
 * 缩放约定：`positionScale` 由调用方选择是否在此施加 ——
 *   · 模拟器里高位连板的缩放**刻意留在原处**（`plannedBudget = 预算 × positionScale`），
 *     以保持该函数改动前后行为不变；
 *   · 展示层直接传入 `positionScale`，拿到「已降仓后的预算上限」。
 *
 * 返回数组与 `targets` 等长且同序；`targets` 为空时返回空数组（不会出现除以 0）。
 */
export type PositionBudgetTarget = {
  /**
   * 策略生效分（模拟器实际用于加权的分数）。
   * 仅 `scoreWeighted` 使用；其余口径忽略。
   */
  score: number;
  /** 高位连板仓位缩放系数（缺省 1 = 不缩放；0 = 连板超参与上限，按风控不分配仓位）。 */
  positionScale?: number;
};

export type PositionBudgetInput = {
  strategy: PositionSizingStrategy;
  /** 决策时点可用现金。 */
  cash: number;
  /** 组合初始资金（`fixedPercent` 口径的分母）。 */
  initialCapital: number;
  /** 固定单笔比例（百分数，如 20 表示 20%）；仅 `fixedPercent` 使用。 */
  fixedPositionPercent: number;
  targets: ReadonlyArray<PositionBudgetTarget>;
};

export function allocatePlannedBudgets(input: PositionBudgetInput): number[] {
  const { strategy, cash, initialCapital, fixedPositionPercent, targets } = input;
  const count = targets.length;
  if (count === 0) return [];
  const scoreTotal = strategy === "scoreWeighted"
    ? targets.reduce((sum, target) => sum + Math.max(target.score, 0), 0)
    : 0;
  return targets.map((target) => {
    const baseBudget = strategy === "scoreWeighted"
      ? (scoreTotal > 0 ? cash * Math.max(target.score, 0) / scoreTotal : cash / count)
      : strategy === "fixedPercent"
        ? initialCapital * fixedPositionPercent / 100
        : cash / count;
    return baseBudget * (target.positionScale ?? 1);
  });
}
