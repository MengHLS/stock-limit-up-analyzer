/**
 * RESEARCH-FINDING-001 B4 —— §12 Interaction / Conditional Finding。
 *
 * 任务书 §12 的硬要求：
 *   - 允许 Finding 从**多个 Analysis / Result** 形成条件组合；
 *   - 并比较「单条件效果 vs 组合条件效果」；
 *   - 🔴 **如果组合结果实际不存在于 Result 中** ⇒ 形成 `UNTESTED_HYPOTHESIS`，
 *     **绝不**产 Finding —— 「不允许系统假装已经验证过」。
 *
 * 因此本文件有两个出口，且**绝不互相混淆**：
 *   - `confirmed`：组合**真的被某个 CONDITIONAL 分析跑过**，产出 `INTERACTION` Finding；
 *   - `untested` ：组合**没有** Result 支撑，产出待验证假设（进 Hypothesis 引导，**不进 Finding 表**）。
 *
 * 判定纪律（不追求布尔等价，只求「敢说验证过」这件事成立）：
 *   组合 (A, B) 被视为**已被测试**，当且仅当存在另一个 CONDITIONAL 分析 X（X ≠ A, X ≠ B）满足：
 *     ① X 的条件子句集合 **⊇** A ∪ B 的全部子句（字段 + 运算符 + 值三者全等才算子句相同）；
 *     ② X 的条件是**纯合取**（组内逻辑符全 AND、组间全 AND，无 OR / NOT）——
 *        否则 (A AND B) 与 X 不是同一命题，谈不上「组合已被验证」；
 *     ③ X 有可用的条件组均值（真实 Result）。
 *   ⚠️ 这是**保守充分条件**，不是布尔等价判定；无法识别的等价写法会落到 `untested`，
 *      即「宁可说没验证过，也不谎称验证过」。该局限会写进 Finding 的 limitations。
 */

import type {
  FindingPolicy,
  ResearchConditionSet,
  ResearchFinding,
  ResearchFindingInteraction,
} from "../../researchCore";
import { buildFingerprint } from "./findingDetector";
import type { AnalysisSeries, FindingDraft, UntestedInteraction } from "./types";

/** 参与两两组合的 Finding 上限（按 researchStrength 降序取）。
 *  为什么要上限：组合是 O(n²)，180 个条件分析会产生上万对；研究上真正值得组合的只有头部几个。 */
export const INTERACTION_TOP_N = 8;

/** 单条条件的规范化键（字段 + 运算符 + 值；值用 JSON 稳定串）。 */
function clauseKey(clause: { fieldName: string; operator: string; value: unknown }): string {
  return `${clause.fieldName}|${clause.operator}|${JSON.stringify(clause.value ?? null)}`;
}

/** 条件集合的**子句键集合**（忽略逻辑连接符）。 */
function clauseKeysOf(set: ResearchConditionSet): Set<string> {
  const keys = new Set<string>();
  for (const group of set.groups) {
    for (const c of group.conditions) keys.add(clauseKey(c));
  }
  return keys;
}

/** 是否纯合取（组内除首条外全 AND；组间全 AND；无 OR / NOT）。 */
export function isPureConjunction(set: ResearchConditionSet): boolean {
  if (set.groups.length === 0) return false;
  for (let gi = 0; gi < set.groups.length; gi += 1) {
    const group = set.groups[gi]!;
    if (gi > 0 && group.groupLogicalOperator !== "AND") return false;
    for (let ci = 0; ci < group.conditions.length; ci += 1) {
      const c = group.conditions[ci]!;
      if (ci === 0) continue; // 组内首条忽略连接符
      if (c.logicalOperator !== "AND") return false;
    }
  }
  return true;
}

function isSubsetOf(subset: ReadonlySet<string>, superset: ReadonlySet<string>): boolean {
  for (const k of subset) if (!superset.has(k)) return false;
  return true;
}

/** 单个 CONDITIONAL 分析的「真实组合效应」（优先取已落库的 DIFFERENCE Result）。 */
function combinedEffectOf(series: AnalysisSeries): number | null {
  const stored = series.scalars.get("DIFFERENCE")?.metricValue ?? null;
  if (stored !== null) return stored;
  const condition = series.buckets[0];
  const bench = series.benchmark?.metricValue ?? null;
  if (condition?.metricValue === null || condition?.metricValue === undefined || bench === null) return null;
  return condition.metricValue - bench;
}

export interface InteractionAnalyzeInput {
  /** **已落库**的基础 Finding（需要真实 id 才能写 `interaction.findingIds`）。 */
  baseFindings: readonly ResearchFinding[];
  /** analysisId → 序列（取组合效应用）。 */
  seriesByAnalysisId: ReadonlyMap<number, AnalysisSeries>;
  /** analysisId → 条件集合（仅 CONDITIONAL 分析有）。 */
  conditionSets: ReadonlyMap<number, ResearchConditionSet>;
  policy: FindingPolicy;
  /** 参与组合的 Finding 上限覆盖值。 */
  topN?: number;
}

export interface InteractionAnalyzeResult {
  confirmed: FindingDraft[];
  untested: UntestedInteraction[];
}

export const FindingInteractionAnalyzer = {
  analyze(input: InteractionAnalyzeInput): InteractionAnalyzeResult {
    const { baseFindings, seriesByAnalysisId, conditionSets } = input;
    const topN = input.topN ?? INTERACTION_TOP_N;

    // 候选 = 由 CONDITIONAL 分析产出的 EFFECT Finding（有真实条件行才谈得上组合）。
    const candidates = baseFindings
      .filter((f) => f.id !== undefined && f.findingType === "EFFECT" && f.primaryAnalysisId !== null
        && conditionSets.has(f.primaryAnalysisId!))
      .sort((a, b) => (b.researchStrength ?? 0) - (a.researchStrength ?? 0) || (a.id! - b.id!))
      .slice(0, topN);

    const confirmed: FindingDraft[] = [];
    const untested: UntestedInteraction[] = [];
    const seenPairs = new Set<string>();

    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const a = candidates[i]!;
        const b = candidates[j]!;
        if (a.primaryAnalysisId === b.primaryAnalysisId) continue;
        const pairKey = `${a.id}+${b.id}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const setA = conditionSets.get(a.primaryAnalysisId!)!;
        const setB = conditionSets.get(b.primaryAnalysisId!)!;

        // A 与 B 必须**互不包含**（否则「组合」只是把同一条件再说一遍，无信息量）。
        const keysA = clauseKeysOf(setA);
        const keysB = clauseKeysOf(setB);
        if (isSubsetOf(keysA, keysB) || isSubsetOf(keysB, keysA)) continue;

        const union = new Set<string>([...keysA, ...keysB]);

        // ---- 找一个「真的把 A+B 一起跑过」的分析 ----
        let testedBy: number | null = null;
        for (const [analysisId, set] of conditionSets) {
          if (analysisId === a.primaryAnalysisId || analysisId === b.primaryAnalysisId) continue;
          if (!isPureConjunction(set)) continue;
          const keys = clauseKeysOf(set);
          if (isSubsetOf(union, keys) && keys.size > keysA.size && keys.size > keysB.size) {
            const series = seriesByAnalysisId.get(analysisId);
            if (series !== undefined && combinedEffectOf(series) !== null) {
              testedBy = analysisId;
              break; // 取**最小 id** 的那个（Map 插入序 = 分析 id 升序，确定性）
            }
          }
        }

        const singleEffect = Math.max(
          Math.abs(a.effect?.excessReturn ?? 0),
          Math.abs(b.effect?.excessReturn ?? 0),
        );

        if (testedBy === null) {
          untested.push({
            title: `组合条件「${a.title.replace(/^满足条件「|」的样本.*$/g, "")} AND ${b.title.replace(/^满足条件「|」的样本.*$/g, "")}」尚未被任何 Result 验证`,
            findingIds: [a.id!, b.id!],
            combinedConditions: null,
            reason:
              "同 Run 内没有**纯合取**的条件分析同时覆盖这两组子句 ⇒ 组合效果无真实 Result 支撑。"
              + "按任务书 §12，此处只登记待验证假设，**不产出 Finding**。请新建覆盖该组合的 CONDITIONAL 分析后重跑。",
          });
          continue;
        }

        const series = seriesByAnalysisId.get(testedBy)!;
        const combinedEffect = combinedEffectOf(series)!;
        const enhanced = Math.abs(combinedEffect) > singleEffect;
        const interaction: ResearchFindingInteraction = {
          findingIds: [a.id!, b.id!],
          combinedConditions: conditionSets.get(testedBy) ?? null,
          singleEffect,
          combinedEffect,
          tested: true,
          untestedReason: null,
        };

        const dimension: Record<string, string | number> = {
          dimensionKey: "interaction",
          sourceFindingIds: `${a.id}+${b.id}`,
          combinedAnalysisId: testedBy,
        };

        const findingType = "INTERACTION" as const;
        const limitations = [
          "组合判定用**保守充分条件**（子句集合包含 + 纯合取），不是布尔等价；等价改写可能被误判为未验证。",
          "组合分析的条件组仍是全样本子集，与单条件组**不是独立样本**，两者差异不能直接做显著性比较。",
          "「组合更强」只是**研究优先级**提示，不构成策略评分或买卖建议（任务书 §14）。",
          `单条件效应取两条中较大者（|${singleEffect.toFixed(4)}|），未做多重比较校正。`,
        ];

        confirmed.push({
          findingType,
          title: `条件组合（Finding #${a.id} AND #${b.id}）${enhanced ? "增强" : "未增强"}：组合效应 ${combinedEffect.toFixed(4)} vs 单条件 ${singleEffect.toFixed(4)}`,
          summary:
            `组合条件由分析 #${testedBy} **真实跑出**：组合效应 ${combinedEffect.toFixed(4)}，`
            + `单条件最大效应 ${singleEffect.toFixed(4)}，${enhanced ? "组合更强" : "组合未更强"}。`,
          target: a.target ?? b.target ?? null,
          dimension,
          primaryAnalysisId: testedBy,
          sourceResultIds: [...series.allResultIds].sort((x, y) => x - y),
          effect: null,
          sample: a.sample ?? b.sample ?? null,
          horizon: null,
          stability: null,
          monotonicity: null,
          interaction,
          limitations,
          evidence: {
            detector: "INTERACTION",
            sourceFindingIds: [a.id!, b.id!],
            sourceAnalysisIds: [a.primaryAnalysisId, b.primaryAnalysisId],
            combinedAnalysisId: testedBy,
            combinationMatchRule:
              "组合被判定为「已测试」当且仅当：存在纯合取的 CONDITIONAL 分析，其子句集合 ⊇ 两个来源的子句并集，且有真实条件组均值。",
            singleEffect,
            combinedEffect,
            enhanced,
            resultRowCount: series.allResultIds.length,
          },
          fingerprint: buildFingerprint({ runId: 0, findingType, primaryAnalysisId: testedBy, dimension }),
        });
      }
    }

    return { confirmed, untested };
  },
};
