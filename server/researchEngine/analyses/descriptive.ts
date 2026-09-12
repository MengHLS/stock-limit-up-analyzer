/**
 * RESEARCH-002 — DESCRIPTIVE 分析。
 *
 * 口径（指令 §7）：对**特征变量与结果变量同时可用**，逐变量输出
 *   sample_count / missing_count / missing_rate / mean / median / std / min / max / p01…p99。
 *
 * 结果形态：`dimension = { variable: "<变量名>" }`（GROUPED），
 * 即「一个变量 × 一个指标 = 一行」，可按 metric_code 排序、按 dimension 过滤，**全部结构化**。
 */

import { ResearchResultError } from "../../researchCore";
import { metricCalculator, missingStatistics, finiteValues } from "../metrics";
import type {
  AnalysisExecutionContext,
  AnalysisExecutionResult,
  AnalysisSummary,
  AnalysisVariableRequirementContext,
  ResolvedEngineAnalysisConfig,
  ResearchVariableRole,
} from "../types";
import { groupedRows, requireAnalysisId, variableValues, type ResultRowDraft } from "./helpers";
import { FEATURE_VARIABLES } from "../variables";

/** DESCRIPTIVE 输出的指标码（顺序即展示顺序）。 */
const DESCRIPTIVE_METRIC_CODES = [
  "SAMPLE_COUNT",
  "MISSING_COUNT",
  "MISSING_RATE",
  "MEAN",
  "MEDIAN",
  "STD",
  "MIN",
  "MAX",
  "P01",
  "P05",
  "P10",
  "P25",
  "P50",
  "P75",
  "P90",
  "P95",
  "P99",
  "SKEWNESS",
  "KURTOSIS",
] as const;

/** 判断变量角色（供 Engine 装配样本时区分读取）。 */
export function descriptiveRoleOf(name: string): ResearchVariableRole {
  return Object.prototype.hasOwnProperty.call(FEATURE_VARIABLES, name) ? "FEATURE" : "OUTCOME";
}

export const descriptiveExecutor = {
  analysisType: "DESCRIPTIVE" as const,

  requiredVariables(config: ResolvedEngineAnalysisConfig, _context: AnalysisVariableRequirementContext) {
    const variables =
      config.variables.length > 0
        ? config.variables
        : [config.featureVariable, config.targetVariable].filter((v): v is string => typeof v === "string");
    const features = variables.filter((v) => descriptiveRoleOf(v) === "FEATURE");
    const outcomes = variables.filter((v) => descriptiveRoleOf(v) === "OUTCOME");
    return { features, outcomes };
  },

  async execute(context: AnalysisExecutionContext): Promise<AnalysisExecutionResult> {
    const analysisId = requireAnalysisId(context);
    const variables =
      context.config.variables.length > 0
        ? context.config.variables
        : [context.config.featureVariable, context.config.targetVariable].filter(
            (v): v is string => typeof v === "string",
          );
    if (variables.length === 0) {
      throw new ResearchResultError("DESCRIPTIVE 分析没有可统计的变量");
    }

    const rows: ResultRowDraft[] = [];
    /** metricCode → groups（一次按维度聚合，避免每指标一次重复扫描）。 */
    const bucket = new Map<string, Array<{ label: string; metricValue: number; sampleCount: number | null }>>();
    for (const code of DESCRIPTIVE_METRIC_CODES) bucket.set(code, []);

    /** 变量 → 角色（写进结果 details，便于前端区分特征 / 结果）。 */
    const roleDetails = new Map<string, { role: ResearchVariableRole; variable: string }>();
    const perVariable: Array<{ variable: string; role: ResearchVariableRole; sampleCount: number; missingRate: number }> = [];

    for (const variable of variables) {
      const role = descriptiveRoleOf(variable);
      const values = variableValues(context.samples, variable, role);
      const missing = missingStatistics(values);
      const finite = finiteValues(values);
      perVariable.push({
        variable,
        role,
        sampleCount: finite.length,
        missingRate: missing.missingRate,
      });

      const details = { role, variable };

      // SAMPLE_COUNT / MISSING_COUNT / MISSING_RATE 直接来自样本层，不走分布统计。
      bucket.get("SAMPLE_COUNT")!.push({ label: variable, metricValue: finite.length, sampleCount: context.samples.length });
      bucket.get("MISSING_COUNT")!.push({
        label: variable,
        metricValue: missing.missingCount,
        sampleCount: context.samples.length,
      });
      bucket.get("MISSING_RATE")!.push({
        label: variable,
        metricValue: missing.missingRate,
        sampleCount: context.samples.length,
      });
      roleDetails.set(variable, details);

      for (const code of DESCRIPTIVE_METRIC_CODES) {
        if (code === "SAMPLE_COUNT" || code === "MISSING_COUNT" || code === "MISSING_RATE") continue;
        const value = metricCalculator.compute(code, values);
        if (value === null) continue; // 样本不足 → 不落行（不编造 0）
        bucket.get(code)!.push({ label: variable, metricValue: value, sampleCount: finite.length });
      }
    }

    for (const code of DESCRIPTIVE_METRIC_CODES) {
      const groups = bucket.get(code)!;
      if (groups.length === 0) continue;
      rows.push(
        ...groupedRows({
          analysisId,
          metricCode: code,
          dimensionKey: "variable",
          groups,
          details: {
            metricDefinition: metricCalculator.definitionOf(code) ?? null,
            groupBy: "variable",
            roles: Object.fromEntries([...roleDetails.entries()].map(([k, v]) => [k, v.role])),
          },
        }),
      );
    }

    const summary: AnalysisSummary = {
      analysisType: "DESCRIPTIVE",
      effectLabel: "描述性统计（无主效应）",
      effect: null,
      pValue: null,
      tStat: null,
      sampleCount: context.samples.length,
      minGroupSampleCount: perVariable.length > 0 ? Math.min(...perVariable.map((v) => v.sampleCount)) : null,
      groupCount: perVariable.length,
      directionConsistency: null,
      notes: [
        "DESCRIPTIVE 只描述分布，不做任何假设检验，因此不产出结论方向。",
        ...perVariable
          .filter((v) => v.missingRate > 0)
          .map((v) => `变量 ${v.variable} 缺失率 ${(v.missingRate * 100).toFixed(2)}%（缺失值不参与统计）`),
      ],
    };

    return { rows, summary, diagnostics: { variables: perVariable } };
  },
};
