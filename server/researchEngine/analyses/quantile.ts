/**
 * RESEARCH-002 — QUANTILE 分析（分位研究）。
 *
 * 输入：一个**特征**变量（PIT 安全，如 `turnover`）+ 一个**结果**变量（如 `future_return_5d`）。
 * 输出：Q1..Qn 每组的 sample_count / mean / median / win_rate / std，以及顶底分位差。
 *
 * ### 分组算法（口径必须唯一，故在此写死并记录到结果 metadata）
 *   1. 取 (特征值, 结果值) 同时有限的配对，按特征值升序排序（稳定，不依赖输入顺序）；
 *   2. 切点 `c_k = percentile(feature, k/G)`，k = 1..G−1（线性插值，与 shared/quant-stats 同源）；
 *   3. `group(v) = 1 + |{k : v > c_k}|`。
 *
 *   该定义保证：**相同特征值永不落入不同分组**（并列不劈开）。代价是当大量并列值跨越切点时，
 *   实际分组数会**少于** G —— 这时 `groupCount` 与实际分组数如实不一致，
 *   并在结果 metadata 里以 `requestedGroups` / `actualGroups` 明示，**不做静默补齐**。
 *
 * ### 顶底分位差定义
 *   `SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)`；
 *   若实际分组数 < 2（极端并列），不产出该指标（返回 null），而非编造 0。
 */

import { percentile } from "../../../shared/quant-stats";
import { ResearchResultError } from "../../researchCore";
import { metricCalculator } from "../metrics";
import type {
  AnalysisExecutionContext,
  AnalysisExecutionResult,
  AnalysisSummary,
  AnalysisVariableRequirementContext,
  ResolvedEngineAnalysisConfig,
} from "../types";
import { groupedRows, requireAnalysisId, sampleNote, scalarRow, type ResultRowDraft } from "./helpers";

/** 每个分位组输出的指标码。 */
const PER_GROUP_METRICS = ["SAMPLE_COUNT", "MEAN_RETURN", "MEDIAN_RETURN", "WIN_RATE", "STD_RETURN"] as const;

/** 分位边界（供诊断 / 复现）。 */
export interface QuantileCutPoints {
  requestedGroups: number;
  actualGroups: number;
  cutPoints: number[];
  featureVariable: string;
  outcomeVariable: string;
}

/** 计算切点。 */
export function computeCutPoints(featureValues: readonly number[], groups: number): number[] {
  const cuts: number[] = [];
  for (let k = 1; k < groups; k += 1) {
    const c = percentile([...featureValues], (k / groups) * 100);
    if (c !== null) cuts.push(c);
  }
  return cuts;
}

/** 按切点分组（相同值不劈开）。 */
export function assignQuantileGroups(featureValues: readonly number[], cutPoints: readonly number[]): number[] {
  return featureValues.map((v) => 1 + cutPoints.filter((c) => v > c).length);
}

export const quantileExecutor = {
  analysisType: "QUANTILE" as const,

  requiredVariables(config: ResolvedEngineAnalysisConfig, _context: AnalysisVariableRequirementContext) {
    return {
      features: config.featureVariable ? [config.featureVariable] : [],
      outcomes: config.targetVariable ? [config.targetVariable] : [],
    };
  },

  async execute(context: AnalysisExecutionContext): Promise<AnalysisExecutionResult> {
    const analysisId = requireAnalysisId(context);
    const { featureVariable, targetVariable, quantileGroups, minSampleCount } = context.config;
    if (!featureVariable || !targetVariable) {
      throw new ResearchResultError("QUANTILE 分析缺少 featureField / targetField");
    }

    // 配对（两个变量同时有限）
    const pairs: Array<{ feature: number; outcome: number }> = [];
    for (const sample of context.samples) {
      const f = sample.features[featureVariable];
      const o = sample.outcomes[targetVariable];
      if (typeof f === "number" && Number.isFinite(f) && typeof o === "number" && Number.isFinite(o)) {
        pairs.push({ feature: f, outcome: o });
      }
    }
    pairs.sort((a, b) => a.feature - b.feature);

    const missingPairs = context.samples.length - pairs.length;
    const cutPoints = computeCutPoints(pairs.map((p) => p.feature), quantileGroups);
    const groupIds = assignQuantileGroups(pairs.map((p) => p.feature), cutPoints);
    const actualGroups = groupIds.length === 0 ? 0 : Math.max(...groupIds);

    const byGroup = new Map<number, number[]>();
    for (let i = 0; i < groupIds.length; i += 1) {
      const g = groupIds[i]!;
      const list = byGroup.get(g);
      if (list === undefined) byGroup.set(g, [pairs[i]!.outcome]);
      else list.push(pairs[i]!.outcome);
    }
    const groupLabels = [...byGroup.keys()].sort((a, b) => a - b);

    const rows: ResultRowDraft[] = [];
    const notes: string[] = [];
    const groupSummaries: Array<{ label: number; sampleCount: number; mean: number | null; median: number | null; winRate: number | null }> = [];

    const meta = {
      featureVariable,
      outcomeVariable: targetVariable,
      requestedGroups: quantileGroups,
      actualGroups,
      cutPoints,
      pairCount: pairs.length,
      excludedForMissing: missingPairs,
      groupingRule: "group(v) = 1 + |{k : v > percentile(feature, k/G)}|；相同特征值不劈开分组。",
      spreadDefinition: "SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)。",
    };

    for (const label of groupLabels) {
      const outcomes = byGroup.get(label)!;
      const low = sampleNote(outcomes.length, minSampleCount);
      if (low) notes.push(`Q${label}：${low}`);
      const groupDetails = { ...meta, quantileGroup: label, lowSample: outcomes.length < minSampleCount };

      for (const code of PER_GROUP_METRICS) {
        const value =
          code === "SAMPLE_COUNT" ? outcomes.length : metricCalculator.compute(code, outcomes);
        if (value === null) continue;
        rows.push(
          ...groupedRows({
            analysisId,
            metricCode: code,
            dimensionKey: "quantile",
            groups: [{ label, metricValue: value, sampleCount: outcomes.length }],
            details: { ...groupDetails, metricDefinition: metricCalculator.definitionOf(code) ?? null },
          }),
        );
      }

      groupSummaries.push({
        label,
        sampleCount: outcomes.length,
        mean: metricCalculator.compute("MEAN_RETURN", outcomes),
        median: metricCalculator.compute("MEDIAN_RETURN", outcomes),
        winRate: metricCalculator.compute("WIN_RATE", outcomes),
      });
    }

    // ---- 顶底分位差 ----
    const bottom = groupLabels[0];
    const top = groupLabels[groupLabels.length - 1];
    const canComputeSpread = groupLabels.length >= 2 && bottom !== undefined && top !== undefined;
    const bottomOutcomes = canComputeSpread ? byGroup.get(bottom!)! : [];
    const topOutcomes = canComputeSpread ? byGroup.get(top!)! : [];
    const spread = canComputeSpread
      ? metricCalculator.computeBinary("SPREAD_TOP_BOTTOM", topOutcomes, bottomOutcomes)
      : null;

    if (spread !== null) {
      rows.push(
        scalarRow({
          analysisId,
          metricCode: "SPREAD_TOP_BOTTOM",
          metricValue: spread,
          sampleCount: topOutcomes.length + bottomOutcomes.length,
          details: {
            ...meta,
            metricDefinition: metricCalculator.definitionOf("SPREAD_TOP_BOTTOM") ?? null,
            topGroup: top,
            bottomGroup: bottom,
            topMean: metricCalculator.compute("MEAN_RETURN", topOutcomes),
            bottomMean: metricCalculator.compute("MEAN_RETURN", bottomOutcomes),
          },
        }),
      );
    } else if (groupLabels.length < 2) {
      notes.push(
        `实际分组数 ${groupLabels.length} < 2（特征值大量并列，切点未产生有效分隔），故不产出顶底分位差。`,
      );
    }

    // 组间差检验（Welch t 的 t / p 值，作为统计辅助）
    let diffT: number | null = null;
    let diffP: number | null = null;
    if (canComputeSpread && groupLabels.length >= 2) {
      diffT = metricCalculator.computeBinary("T_STAT_DIFFERENCE", topOutcomes, bottomOutcomes);
      diffP = metricCalculator.computeBinary("P_VALUE_DIFFERENCE", topOutcomes, bottomOutcomes);
      for (const [code, value] of [
        ["T_STAT_DIFFERENCE", diffT],
        ["P_VALUE_DIFFERENCE", diffP],
      ] as const) {
        if (value === null) continue;
        rows.push(
          scalarRow({
            analysisId,
            metricCode: code,
            metricValue: value,
            sampleCount: topOutcomes.length + bottomOutcomes.length,
            details: {
              ...meta,
              metricDefinition: metricCalculator.definitionOf(code) ?? null,
              topGroup: top,
              bottomGroup: bottom,
            },
          }),
        );
      }
    }

    if (actualGroups > 0 && actualGroups < quantileGroups) {
      notes.push(`特征值并列导致实际分组数 ${actualGroups} 少于请求的 ${quantileGroups}（未静默补齐）。`);
    }
    if (missingPairs > 0) {
      notes.push(`${missingPairs} 个样本因特征或结果缺失被排除（缺失不冒充有效样本）。`);
    }

    const summary: AnalysisSummary = {
      analysisType: "QUANTILE",
      effectLabel: `Q${top ?? "?"} − Q${bottom ?? "?"} 的 ${targetVariable} 均值差`,
      effect: spread,
      pValue: diffP,
      tStat: diffT,
      sampleCount: pairs.length,
      minGroupSampleCount: groupLabels.length > 0 ? Math.min(...groupLabels.map((l) => byGroup.get(l)!.length)) : null,
      groupCount: groupLabels.length,
      directionConsistency: monotonicConsistency(groupLabels.map((l) => metricCalculator.compute("MEAN_RETURN", byGroup.get(l)!))),
      notes: [
        meta.groupingRule,
        meta.spreadDefinition,
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验；未校正多重比较与重叠视界，仅作研究辅助。",
        ...notes,
      ],
    };

    return { rows, summary, diagnostics: { meta, groupSummaries } };
  },
};

/**
 * 单调性代理：相邻组均值变动的方向与整体趋势一致的占比。
 *
 * 导出以**共用同一实现**（SEGMENT_RELATION 也用它衡量分档单调性）——
 * 「同名统计两处各写一份」正是本仓库反复禁止的漂移来源。
 */
export function monotonicConsistency(groupMeans: readonly (number | null)[]): number | null {
  const usable = groupMeans.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (usable.length < 3) return null;
  const deltas: number[] = [];
  for (let i = 1; i < usable.length; i += 1) deltas.push(usable[i]! - usable[i - 1]!);
  const overall = usable[usable.length - 1]! - usable[0]!;
  if (overall === 0) return null;
  return deltas.filter((d) => Math.sign(d) === Math.sign(overall)).length / deltas.length;
}
