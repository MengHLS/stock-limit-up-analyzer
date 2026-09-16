/**
 * RESEARCH-FINDING-001 B4 —— §14 研究评分（**研究优先级**，不是策略评分）。
 *
 * 纪律（任务书 §14 原文）：
 *   - 拆成 `effectStrength / sampleStrength / stabilityStrength / horizonConsistency / monotonicityStrength`；
 *   - 合成 `researchStrength`；
 *   - 🔴 **禁止**「Strategy Score = 87 / 推荐买入」。本文件的产物只回答
 *     「哪些发现值得进一步研究」，不含任何交易方向或仓位含义。
 *
 * 缺失维度 = **不参与加权**（重归一化），不是补 0 —— 见 `researchCore/findings.ts#composeResearchStrength`
 * 的详细理由（补 0 会把「没测」当成「测出来很差」，系统性压低数据不足但真实有效的发现）。
 *
 * 统计复用：秩相关一律走 `shared/quant-stats.spearmanCorrelation`（全仓唯一实现）。
 */

import {
  composeResearchStrength,
  effectStrengthOf,
  sampleStrengthOf,
  type FindingPolicy,
  type ResearchFinding,
  type ResearchStrengthGrade,
} from "../../researchCore";
import { spearmanCorrelation } from "../../../shared/quant-stats";
import { stabilityStrengthOf } from "./findingStabilityAnalyzer";
import type { FindingDraft } from "./types";

/** 五维分项（与 `ResearchFinding` 的 DB 列 1:1）。 */
export interface StrengthBreakdown {
  effectStrength: number | null;
  sampleStrength: number | null;
  stabilityStrength: number | null;
  horizonConsistency: number | null;
  monotonicityStrength: number | null;
  researchStrength: number | null;
  researchStrengthGrade: ResearchStrengthGrade | null;
}

/**
 * 效应量（**证据形态决定，不按「哪个数最大」挑**）。
 *
 * 优先级：
 *   ① 有基准 ⇒ |excessReturn|（= 条件组 − 基准，最直接的可比效应）；
 *   ② 无基准但有序档位 ≥2 个 ⇒ |max − min|（档位间的**真实差异**，任务书 §6
 *      「不只寻找绝对最高值，而是寻找具有明显差异的结果」）；
 *   ③ 只有单组均值 ⇒ 不评分（null）—— 「收益本身就是正」不是「发现」。
 */
export function evidenceEffectMagnitude(draft: FindingDraft): number | null {
  const effect = draft.effect ?? null;
  if (effect !== null && effect.excessReturn !== null && Number.isFinite(effect.excessReturn)) {
    return Math.abs(effect.excessReturn);
  }
  const buckets = effect?.buckets ?? [];
  const values = buckets.map((b) => b.metricValue).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length >= 2) {
    return Math.abs(Math.max(...values) - Math.min(...values));
  }
  return null;
}

/** 有序档位上的单调性强度（§9；`PEAK`/`VALLEY` 取**两条腿里更强的单调腿**）。 */
export function monotonicityStrengthOf(draft: FindingDraft, policy: FindingPolicy): number | null {
  const section = draft.monotonicity ?? null;
  if (section === null) return null;
  const values = section.buckets
    .map((b) => b.metricValue)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length < policy.monotonicMinBuckets) return null;

  const rank = (arr: readonly number[]): number | null => {
    if (arr.length < 3) return null;
    const xs = arr.map((_, i) => i);
    const r = spearmanCorrelation(xs, [...arr]);
    return r === null || !Number.isFinite(r) ? null : Math.abs(r);
  };

  switch (section.pattern) {
    case "MONOTONIC_INCREASING":
    case "MONOTONIC_DECREASING":
      return section.rankCorrelation === null ? rank(values) : Math.abs(section.rankCorrelation);
    case "PEAK":
    case "VALLEY": {
      let extreme = 0;
      for (let i = 1; i < values.length; i += 1) {
        const better = section.pattern === "PEAK" ? values[i]! > values[extreme]! : values[i]! < values[extreme]!;
        if (better) extreme = i;
      }
      const legs = [values.slice(0, extreme + 1), values.slice(extreme)];
      const scores = legs.map(rank).filter((r): r is number => r !== null);
      return scores.length === 0 ? null : Math.max(...scores);
    }
    case "NONE":
      // 判据齐备、结论就是「无单调关系」⇒ 0 分是**实测结果**，不是缺失。
      return 0;
    default:
      return null;
  }
}

/** 视界一致性（§10）：直接用分析层已算出的方向一致性。 */
export function horizonConsistencyOf(draft: FindingDraft): number | null {
  const h = draft.horizon ?? null;
  if (h === null) return null;
  if (h.directionConsistency === null || !Number.isFinite(h.directionConsistency)) return null;
  return h.directionConsistency;
}

export const FindingScorer = {
  /** 逐维打分（不合成）。 */
  breakdown(draft: FindingDraft, policy: FindingPolicy): StrengthBreakdown {
    const magnitude = evidenceEffectMagnitude(draft);
    const effectStrength = magnitude === null ? null : effectStrengthOf(magnitude, policy);

    const sampleCount = draft.sample?.sampleCount ?? null;
    const sampleStrength =
      sampleCount === null || !Number.isFinite(sampleCount) ? null : sampleStrengthOf(sampleCount, policy);

    const stabilityStrength = draft.stability === null || draft.stability === undefined
      ? null
      : stabilityStrengthOf(draft.stability);

    const horizonConsistency = horizonConsistencyOf(draft);
    const monotonicityStrength = monotonicityStrengthOf(draft, policy);

    const composed = composeResearchStrength(
      { effectStrength, sampleStrength, stabilityStrength, horizonConsistency, monotonicityStrength },
      policy,
    );
    return {
      effectStrength: composed.effectStrength,
      sampleStrength: composed.sampleStrength,
      stabilityStrength: composed.stabilityStrength,
      horizonConsistency: composed.horizonConsistency,
      monotonicityStrength: composed.monotonicityStrength,
      researchStrength: composed.researchStrength,
      // `composeResearchStrength` 把分级命名为 `grade`；此处映射到 Finding 的列名。
      researchStrengthGrade: composed.grade,
    };
  },

  /**
   * 写回五维 + 总分 + 分级。
   *
   * 🔴 只写**引擎算出的**分项；调用方不得在别处覆写（Scorer 是唯一评分入口）。
   */
  score(draft: FindingDraft, policy: FindingPolicy): ResearchFinding {
    const b = FindingScorer.breakdown(draft, policy);
    return {
      ...draft,
      status: "DISCOVERED",
      effectStrength: b.effectStrength,
      sampleStrength: b.sampleStrength,
      stabilityStrength: b.stabilityStrength,
      horizonConsistency: b.horizonConsistency,
      monotonicityStrength: b.monotonicityStrength,
      researchStrength: b.researchStrength,
      researchStrengthGrade: b.researchStrengthGrade,
    } as ResearchFinding;
  },
};
