/**
 * RESEARCH-002 — STABILITY 分析（稳定性研究）。
 *
 * 目的：同一个关系在**不同时间 / 不同市场状态下**是否稳定。
 *
 * 分组来源（`stabilityDimension`）：
 *   - 时间：`year` / `month` / `quarter`（由 `event.tradeDate` 派生，真实列，PIT 安全）；
 *   - 结构：`board`（boardType）/ `market` / `industry`（Dataset event 真实列）；
 *   - 环境：`regime` —— **仅在注入 `RegimeTagProvider` 时可用**。
 *
 *   ⚠️ 当前 Dataset（first_limit_pullback）**没有 market regime 列**，因此默认不提供 regime 分组：
 *   指定 regime 而未注入标签源会直接抛 `REGIME_PROVIDER_UNAVAILABLE`，
 *   **绝不用「看起来像」的标签冒充**（例如拿涨跌幅自制 rough regime）。
 *   本项目 `server/research/marketRegime` 是未来接入该 provider 的正规来源。
 *
 * 输出：每组的 sample_count / mean_return / median_return / win_rate +
 *       整体均值 + 方向一致性（`STABILITY_RATIO`）。
 */

import { ResearchResultError } from "../../researchCore";
import { metricCalculator, directionConsistency, STABILITY_RATIO_DEFINITION } from "../metrics";
import type {
  AnalysisExecutionContext,
  AnalysisExecutionResult,
  AnalysisSummary,
  AnalysisVariableRequirementContext,
  ResolvedEngineAnalysisConfig,
} from "../types";
import { groupedRows, requireAnalysisId, sampleNote, scalarRow, type ResultRowDraft } from "./helpers";

/** 每组输出的指标码。 */
const PER_GROUP_METRICS = ["SAMPLE_COUNT", "MEAN_RETURN", "MEDIAN_RETURN", "WIN_RATE"] as const;

export const stabilityExecutor = {
  analysisType: "STABILITY" as const,

  requiredVariables(config: ResolvedEngineAnalysisConfig, _context: AnalysisVariableRequirementContext) {
    return {
      features: [],
      outcomes: config.targetVariable ? [config.targetVariable] : [],
      dimensions: [config.stabilityDimension],
    };
  },

  async execute(context: AnalysisExecutionContext): Promise<AnalysisExecutionResult> {
    const analysisId = requireAnalysisId(context);
    const { targetVariable, stabilityDimension, minSampleCount } = context.config;
    if (!targetVariable) throw new ResearchResultError("STABILITY 分析缺少 targetField");

    const rows: ResultRowDraft[] = [];
    const notes: string[] = [];
    const byGroup = new Map<string, number[]>();
    /** key → 维度原始取值（year 保持 number，避免维度值被 String() 抹成字符串）。 */
    const rawByKey = new Map<string, string | number>();
    let excludedForMissingDimension = 0;
    let excludedForMissingOutcome = 0;

    const values: number[] = [];
    for (const sample of context.samples) {
      const outcome = sample.outcomes[targetVariable];
      if (typeof outcome !== "number" || !Number.isFinite(outcome)) {
        excludedForMissingOutcome += 1;
        continue;
      }
      values.push(outcome);
      const raw = sample.dimensions[stabilityDimension];
      if (raw === null || raw === undefined || raw === "") {
        excludedForMissingDimension += 1;
        continue;
      }
      const key = String(raw);
      if (!rawByKey.has(key)) rawByKey.set(key, raw);
      const list = byGroup.get(key);
      if (list === undefined) byGroup.set(key, [outcome]);
      else list.push(outcome);
    }

    const keys = [...byGroup.keys()].sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
    const labelOf = (key: string): string | number => rawByKey.get(key) ?? key;
    const dimensionKey = context.config.dimensionKey ?? stabilityDimension;

    const meta = {
      outcomeVariable: targetVariable,
      dimension: stabilityDimension,
      dimensionKey,
      groupCount: keys.length,
      excludedForMissingDimension,
      excludedForMissingOutcome,
      stabilityRatioDefinition: STABILITY_RATIO_DEFINITION,
    };

    if (keys.length === 0) {
      notes.push(`维度 ${stabilityDimension} 上没有任何可用分组（全部样本该维度缺失）。`);
    }
    if (excludedForMissingDimension > 0) {
      notes.push(`${excludedForMissingDimension} 个样本因维度 ${stabilityDimension} 缺失被排除（不并入任何组）。`);
    }
    if (excludedForMissingOutcome > 0) {
      notes.push(`${excludedForMissingOutcome} 个样本因结果变量 ${targetVariable} 缺失被排除。`);
    }

    const groupMeans: Array<number | null> = [];
    for (const key of keys) {
      const label = labelOf(key);
      const groupValues = byGroup.get(key)!;
      const low = sampleNote(groupValues.length, minSampleCount);
      if (low) notes.push(`${label}：${low}`);
      const groupDetails = { ...meta, period: label, lowSample: groupValues.length < minSampleCount };
      for (const code of PER_GROUP_METRICS) {
        const value = code === "SAMPLE_COUNT" ? groupValues.length : metricCalculator.compute(code, groupValues);
        if (value === null) continue;
        rows.push(
          ...groupedRows({
            analysisId,
            metricCode: code,
            dimensionKey,
            groups: [{ label, metricValue: value, sampleCount: groupValues.length }],
            details: { ...groupDetails, metricDefinition: metricCalculator.definitionOf(code) ?? null },
          }),
        );
      }
      groupMeans.push(metricCalculator.compute("MEAN_RETURN", groupValues));
    }

    // 整体均值 + 稳定性比率
    const overallMean = metricCalculator.compute("MEAN_RETURN", values);
    /**
     * 只有 ≥2 个分组时「跨组方向一致性」才有信息量。
     * 单组时 `directionConsistency` 恒为 1.0 —— 会被误读为「高度稳定」，
     * 与 QUANTILE 对「实际分组数 < 2」的处理保持一致：**不产出该指标**（返回 null），
     * 并如实说明原因，而不是给出一个看起来漂亮的假数字。
     */
    const canAssessStability = keys.length >= 2;
    const stabilityRatio = canAssessStability ? directionConsistency(groupMeans) : null;
    if (!canAssessStability) {
      notes.push(
        `维度 ${stabilityDimension} 上只有 ${keys.length} 个可用分组，**无法评估跨期稳定性**：` +
          `方向一致性在单组时恒为 1，会被误读为「高度稳定」，故不产出 STABILITY_RATIO（不编造）。` +
          `请改用覆盖多个分组的维度，或使用时间跨度更长的 Dataset Version。`,
      );
    }

    if (overallMean !== null) {
      rows.push(
        ...groupedRows({
          analysisId,
          metricCode: "MEAN_RETURN",
          dimensionKey,
          groups: [{ label: "ALL", metricValue: overallMean, sampleCount: values.length }],
          details: { ...meta, period: "ALL", metricDefinition: metricCalculator.definitionOf("MEAN_RETURN") ?? null },
        }),
      );
    }
    if (stabilityRatio !== null) {
      rows.push(
        scalarRow({
          analysisId,
          metricCode: "STABILITY_RATIO",
          metricValue: stabilityRatio,
          sampleCount: values.length,
          details: { ...meta, metricDefinition: STABILITY_RATIO_DEFINITION },
        }),
      );
    }

    const summary: AnalysisSummary = {
      analysisType: "STABILITY",
      effectLabel: `${stabilityDimension} 分组下 ${targetVariable} 的整体均值`,
      effect: overallMean,
      pValue: null,
      tStat: null,
      sampleCount: values.length,
      minGroupSampleCount: keys.length > 0 ? Math.min(...keys.map((k) => byGroup.get(k)!.length)) : null,
      groupCount: keys.length,
      directionConsistency: stabilityRatio,
      notes: [
        meta.stabilityRatioDefinition,
        "方向一致性 > 0.6 且各组样本达标，才可能支撑「跨期稳定」的判断；本分析自身不下结论。",
        ...notes,
      ],
    };

    return {
      rows,
      summary,
      diagnostics: {
        meta,
        groupMeans: keys.map((key, i) => ({ label: labelOf(key), mean: groupMeans[i], sampleCount: byGroup.get(key)!.length })),
      },
    };
  },
};
