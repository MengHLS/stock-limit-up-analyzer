/**
 * RESEARCH-FINDING-001 B4 —— §11 稳定性分析器。
 *
 * 职责：把「同一关系在不同切片上的取值」判定为稳定 / 冲突 / 不可评估。
 * 切片维度第一版 = **时间（年）**；但本文件对切片**来源无假设**，
 * 因此 `month / quarter / board / market / industry / regime` 一律可复用同一实现（§11 允许扩展）。
 *
 * 🔴 统计一律复用 `metrics.ts` 的 `directionConsistency`（与 STABILITY 分析同源），
 *    本文件不实现任何相关性 / 均值：避免「同名统计两处各写一份」（仓库明令禁止的漂移来源）。
 *
 * 🔴 为什么不把「总体均值」当稳定：任务书 §11 末句明确禁止。稳定性问的是**切片之间的方向是否一致**，
 *    与整体均值大小无关；一条「整体 +3% 但 2024 亏 9.8%、2025 亏 1.2%」的关系是**不稳定**的。
 */

import type { FindingPolicy, ResearchFindingStability } from "../../researchCore";
import { directionConsistency } from "../metrics";

/** 切片（一个维度取值下的真实 Result 行聚合）。 */
export interface StabilitySlice {
  label: string;
  metricValue: number | null;
  sampleCount: number | null;
}

export interface StabilityAssessment {
  section: ResearchFindingStability;
  /** 稳定性强度分 [0,1]；不可评估时为 null（**不是 0** —— 0 表示「测了很差」）。 */
  strength: number | null;
  /** 人读说明（进 limitations / evidence）。 */
  note: string;
}

/**
 * 稳定性强度（**唯一实现**，供分析器与 Scorer 共用，避免两处各写一份）。
 *
 * 口径：一致性比例原样给分；被判定为「明显冲突」时**打半折** ——
 * 冲突的关系不该与稳定关系拿同样的研究优先级。不可算一致性时返回 null（不可用，不是 0）。
 */
export function stabilityStrengthOf(
  section: Pick<ResearchFindingStability, "consistentRatio" | "contradicted">,
): number | null {
  if (section.consistentRatio === null) return null;
  if (!Number.isFinite(section.consistentRatio)) return null;
  return section.contradicted ? section.consistentRatio * 0.5 : section.consistentRatio;
}

export const FindingStabilityAnalyzer = {
  /**
   * 判定稳定性。
   *
   * 返回 null 表示**不可评估**（切片数 < `stabilityMinSlices`）——
   * 此时调用方必须让 `stability` 字段为 null、强度为 null，**不得**填一个默认「稳定」。
   */
  assess(slices: readonly StabilitySlice[], policy: FindingPolicy): StabilityAssessment | null {
    const usable = slices.filter(
      (s): s is StabilitySlice & { metricValue: number } =>
        typeof s.metricValue === "number" && Number.isFinite(s.metricValue),
    );
    if (usable.length < policy.stabilityMinSlices) return null;

    const values = usable.map((s) => s.metricValue);
    const ratio = directionConsistency(values);

    const pos = values.filter((v) => v > 0).length;
    const neg = values.filter((v) => v < 0).length;
    const zero = values.length - pos - neg;
    const minority = Math.min(pos, neg);
    const minorityRatio = values.length === 0 ? 0 : minority / values.length;

    // 冲突判据：**两侧都出现**，且少数侧占比 ≥ (1 − consistencyMin)。
    // 与 consistencyMin=0.6 配套 ⇒ 少数侧 ≥ 40% 即视为明显冲突（如 1 正 1 负）。
    const contradicted = pos > 0 && neg > 0 && minorityRatio >= 1 - policy.consistencyMin;

    const stable =
      ratio !== null && ratio >= policy.consistencyMin && !contradicted;

    const parts: string[] = [];
    parts.push(`${usable.length} 个切片：正 ${pos} / 负 ${neg}${zero > 0 ? ` / 零 ${zero}` : ""}`);
    if (ratio !== null) parts.push(`方向一致性 ${ratio.toFixed(3)}（下限 ${policy.consistencyMin}）`);
    else parts.push("方向一致性不可算（整体均值为 0）");
    if (contradicted) parts.push(`⚠️ 出现明显方向冲突（少数侧占比 ${minorityRatio.toFixed(3)}）`);

    const section: ResearchFindingStability = {
      dimensionKey: "slice",
      slices: slices.map((s) => ({ label: s.label, metricValue: s.metricValue, sampleCount: s.sampleCount })),
      stable,
      contradicted,
      consistentRatio: ratio,
    };

    return {
      section,
      strength: stabilityStrengthOf(section),
      note: parts.join("；"),
    };
  },
};
