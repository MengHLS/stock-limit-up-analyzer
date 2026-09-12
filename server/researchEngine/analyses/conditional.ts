/**
 * RESEARCH-002 — CONDITIONAL 分析（条件研究）。
 *
 * 输入：`research_analysis_condition` 的结构化条件集（**复用 RESEARCH-001 领域模型**，
 *       不重新设计条件结构）+ 一个结果变量。
 * 输出：全样本 vs 条件样本的 sample_count / mean_return / median_return / win_rate /
 *       max_drawdown，以及 difference / relative_difference 与组间差 Welch t / p 值。
 *
 * 纪律：
 *   - 条件集为空 → `INVALID_ANALYSIS_CONFIG`（**不**静默退化成「等于全样本」的分析）；
 *   - 条件字段可以是特征变量，也可以是分组维度（board / market / year…），两者都必须真实存在；
 *   - 不自动声称「显著」：t / p 值只作为 `research_result` 的一部分如实保存，
 *     结论判定统一由 ConclusionBuilder 按预设规则做。
 */

import { ResearchResultError } from "../../researchCore";
import { evaluateConditionSet } from "../conditionEvaluator";
import { metricCalculator } from "../metrics";
import type {
  AnalysisExecutionContext,
  AnalysisExecutionResult,
  AnalysisSummary,
  AnalysisVariableRequirementContext,
  ResolvedEngineAnalysisConfig,
} from "../types";
import { groupedRows, requireAnalysisId, sampleNote, scalarRow, type ResultRowDraft } from "./helpers";

/** 两组各自输出的指标码。 */
const PER_GROUP_METRICS = [
  "SAMPLE_COUNT",
  "MEAN_RETURN",
  "MEDIAN_RETURN",
  "WIN_RATE",
  "STD_RETURN",
] as const;

export const conditionalExecutor = {
  analysisType: "CONDITIONAL" as const,

  /**
   * 条件研究的变量需求**由条件字段推导**：
   *   - 条件字段是特征变量 → 加入 features（PIT 安全地过滤）；
   *   - 条件字段是结果变量 → 加入 outcomes（允许「按 T+5 收益分档」这类未来条件，但必须显式登记）；
   *   - 其余字段必须是合法分组维度（由 Engine 在配置校验阶段把关），加入 dimensions；
   *   - 结果变量 target + 同视界的 max_drawdown 变量（若存在）必加载。
   */
  requiredVariables(config: ResolvedEngineAnalysisConfig, context: AnalysisVariableRequirementContext) {
    const fields = [...new Set(context.conditionSet.groups.flatMap((g) => g.conditions.map((c) => c.fieldName)))];
    const features: string[] = [];
    const outcomes: string[] = [];
    const dimensions: string[] = [];
    for (const field of fields) {
      if (context.catalog.hasFeature(field)) features.push(field);
      else if (context.catalog.hasOutcome(field)) outcomes.push(field);
      else dimensions.push(field);
    }
    if (config.targetVariable) outcomes.push(config.targetVariable);
    // 回撤列来自 outcome 表，而 outcome 只覆盖它自己声明的视界（本项目 = {5,10,20}）；
    // 目标若是 path 独有视界（如 future_return_3d），则没有 max_drawdown_3d，
    // 必须按目录确认存在后再请求，否则引擎在解析需求阶段就会 UNKNOWN_VARIABLE 失败。
    const drawdown = drawdownVariableFor(config.targetVariable);
    if (drawdown && context.catalog.hasOutcome(drawdown)) outcomes.push(drawdown);
    return { features: [...new Set(features)], outcomes: [...new Set(outcomes)], dimensions: [...new Set(dimensions)] };
  },

  async execute(context: AnalysisExecutionContext): Promise<AnalysisExecutionResult> {
    const analysisId = requireAnalysisId(context);
    const { targetVariable, minSampleCount } = context.config;
    if (!targetVariable) throw new ResearchResultError("CONDITIONAL 分析缺少 targetField");

    const conditionSet = context.conditionSet;
    const conditionCount = conditionSet.groups.reduce((sum, g) => sum + g.conditions.length, 0);
    if (conditionCount === 0) {
      throw new ResearchResultError(
        "CONDITIONAL 分析没有任何条件（research_analysis_condition 为空）：无条件的条件研究没有意义，请先写入条件",
      );
    }

    // 条件字段解析器：先查特征变量，再查分组维度，最后查结果变量（显式失败，不返回 undefined 蒙混）
    const fieldResolver = (field: string): number | string | null => {
      const sample = currentSample;
      if (sample === null) return null;
      if (Object.prototype.hasOwnProperty.call(sample.features, field)) return sample.features[field] ?? null;
      if (Object.prototype.hasOwnProperty.call(sample.dimensions, field)) return sample.dimensions[field] ?? null;
      if (Object.prototype.hasOwnProperty.call(sample.outcomes, field)) {
        // 允许用结果变量做条件（例如「T+5 收益 > 0」），但必须显式登记过，避免手滑。
        return sample.outcomes[field] ?? null;
      }
      throw new ResearchResultError(`条件字段 "${field}" 未在样本中登记（既非特征变量、也非维度、也非已加载结果变量）`);
    };

    let currentSample: (typeof context.samples)[number] | null = null;
    const allOutcomes: number[] = [];
    const conditionOutcomes: number[] = [];
    let matched = 0;

    for (const sample of context.samples) {
      currentSample = sample;
      const outcome = sample.outcomes[targetVariable];
      if (typeof outcome !== "number" || !Number.isFinite(outcome)) continue;
      allOutcomes.push(outcome);
      if (evaluateConditionSet(conditionSet, fieldResolver)) {
        conditionOutcomes.push(outcome);
        matched += 1;
      }
    }
    currentSample = null;

    const rows: ResultRowDraft[] = [];
    const notes: string[] = [];
    const renderRule = conditionSet.groups
      .map((g) => g.conditions.map((c) => `${c.fieldName} ${c.operator} ${JSON.stringify(c.value)}`).join(" AND "))
      .join(" OR ");

    const meta = {
      outcomeVariable: targetVariable,
      conditionRule: renderRule,
      conditionCount,
      totalSampleCount: allOutcomes.length,
      conditionSampleCount: conditionOutcomes.length,
      differenceDefinition: "DIFFERENCE = mean(条件样本) − mean(全样本)。",
      relativeDifferenceDefinition: "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
    };

    if (allOutcomes.length === 0) {
      notes.push("没有任何可用结果样本，条件分析无法进行。");
    }
    if (conditionOutcomes.length === 0) {
      notes.push("没有样本满足条件，条件组统计不可用（不编造 0）。");
    }
    const lowAll = sampleNote(allOutcomes.length, minSampleCount);
    if (lowAll) notes.push(`全样本：${lowAll}`);
    const lowCond = sampleNote(conditionOutcomes.length, minSampleCount);
    if (lowCond) notes.push(`条件组：${lowCond}`);

    const groups: Array<{ key: "ALL" | "CONDITION"; values: number[] }> = [
      { key: "ALL", values: allOutcomes },
      { key: "CONDITION", values: conditionOutcomes },
    ];
    for (const group of groups) {
      for (const code of PER_GROUP_METRICS) {
        const value = code === "SAMPLE_COUNT" ? group.values.length : metricCalculator.compute(code, group.values);
        if (value === null) continue;
        rows.push(
          ...groupedRows({
            analysisId,
            metricCode: code,
            dimensionKey: "group",
            groups: [{ label: group.key, metricValue: value, sampleCount: group.values.length }],
            details: {
              ...meta,
              metricDefinition: metricCalculator.definitionOf(code) ?? null,
              group: group.key,
            },
          }),
        );
      }
    }

    // 条件组内的最大回撤（若样本集加载了 max_drawdown_* 则单独用；否则不产出，不臆造）
    const drawdownVariable = pickDrawdownVariable(context, targetVariable);
    if (drawdownVariable) {
      const ddAll: number[] = [];
      const ddCond: number[] = [];
      currentSample = null;
      for (const sample of context.samples) {
        currentSample = sample;
        const dd = sample.outcomes[drawdownVariable];
        if (typeof dd !== "number" || !Number.isFinite(dd)) continue;
        ddAll.push(dd);
        if (evaluateConditionSet(conditionSet, fieldResolver)) ddCond.push(dd);
      }
      currentSample = null;
      for (const group of [
        { key: "ALL" as const, values: ddAll },
        { key: "CONDITION" as const, values: ddCond },
      ]) {
        const value = metricCalculator.compute("MAX_DRAWDOWN", group.values);
        if (value === null) continue;
        rows.push(
          ...groupedRows({
            analysisId,
            metricCode: "MAX_DRAWDOWN",
            dimensionKey: "group",
            groups: [{ label: group.key, metricValue: value, sampleCount: group.values.length }],
            details: { ...meta, metricDefinition: metricCalculator.definitionOf("MAX_DRAWDOWN") ?? null, group: group.key, variable: drawdownVariable },
          }),
        );
      }
    }

    // 差值 / 相对差值 / 组间差检验
    const difference = metricCalculator.computeBinary("DIFFERENCE", conditionOutcomes, allOutcomes);
    const relative = metricCalculator.computeBinary("RELATIVE_DIFFERENCE", conditionOutcomes, allOutcomes);
    const tStat = metricCalculator.computeBinary("T_STAT_DIFFERENCE", conditionOutcomes, allOutcomes);
    const pValue = metricCalculator.computeBinary("P_VALUE_DIFFERENCE", conditionOutcomes, allOutcomes);
    for (const [code, value] of [
      ["DIFFERENCE", difference],
      ["RELATIVE_DIFFERENCE", relative],
      ["T_STAT_DIFFERENCE", tStat],
      ["P_VALUE_DIFFERENCE", pValue],
    ] as const) {
      if (value === null) continue;
      rows.push(
        scalarRow({
          analysisId,
          metricCode: code,
          metricValue: value,
          sampleCount: conditionOutcomes.length,
          details: { ...meta, metricDefinition: metricCalculator.definitionOf(code) ?? null },
        }),
      );
    }

    const summary: AnalysisSummary = {
      analysisType: "CONDITIONAL",
      effectLabel: `条件组 − 全样本的 ${targetVariable} 均值差`,
      effect: difference,
      pValue,
      tStat,
      sampleCount: allOutcomes.length,
      minGroupSampleCount:
        allOutcomes.length === 0 ? null : Math.min(allOutcomes.length, conditionOutcomes.length),
      groupCount: 2,
      directionConsistency: null,
      notes: [
        meta.differenceDefinition,
        meta.relativeDifferenceDefinition,
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；"
          + "「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。",
        ...notes,
      ],
    };

    return {
      rows,
      summary,
      diagnostics: { meta, matchedConditionSamples: matched },
    };
  },
};

/** 从结果变量名推导同视界的最大回撤变量（如 `future_return_5d` → `max_drawdown_5d`）。 */
export function drawdownVariableFor(targetVariable: string | undefined): string | null {
  if (!targetVariable) return null;
  const m = /_(\d+)d$/.exec(targetVariable);
  return m ? `max_drawdown_${m[1]}d` : null;
}

/** 尝试从结果变量名推导同视界的最大回撤变量，并确认样本集中确实加载了它。 */
function pickDrawdownVariable(context: AnalysisExecutionContext, targetVariable: string): string | null {
  const candidate = drawdownVariableFor(targetVariable);
  if (!candidate) return null;
  const first = context.samples[0];
  if (!first) return null;
  return Object.prototype.hasOwnProperty.call(first.outcomes, candidate) ? candidate : null;
}
