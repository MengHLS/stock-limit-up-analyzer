/**
 * RESEARCH-002 — Analysis 公共工具。
 *
 * 只放「多个 Analysis 都要用、且与统计口径无关」的编排型工具：
 *   - 取变量值（按角色从 sample 的正确一侧取，避免手写 `s.features` / `s.outcomes` 取错）；
 *   - 构造结果行的薄包装（复用 researchCore 的 `scalarResult` / `groupedResults`，不另造一套）；
 *   - 小样本门槛的**如实标注**（不给结果打「显著」标签，只记 `lowSample: true`）。
 */

import { groupedResults, scalarResult, type ResearchResult } from "../../researchCore";
import { engineAssert } from "../errors";
import type { AnalysisExecutionContext, ResearchSample, ResearchVariableRole } from "../types";

/** 结果行草稿（`analysisId` 已填，交给 Repository 直接落库）。 */
export type ResultRowDraft = Omit<ResearchResult, "id" | "createdAt">;

/** 取 context 中的 analysisId（Engine 保证已落库，故必然存在）。 */
export function requireAnalysisId(context: AnalysisExecutionContext): number {
  const id = context.analysis.id;
  engineAssert(
    typeof id === "number" && Number.isInteger(id) && id > 0,
    "INVALID_ANALYSIS_CONFIG",
    "分析尚未落库（缺少 analysisId），Engine 必须先持久化 Analysis 再执行",
  );
  return id;
}

/** 按角色取变量值序列（FEATURE 取 `sample.features`；OUTCOME 取 `sample.outcomes`）。 */
export function variableValues(
  samples: readonly ResearchSample[],
  variable: string,
  role: ResearchVariableRole,
): Array<number | null> {
  return samples.map((s) => (role === "FEATURE" ? s.features[variable] : s.outcomes[variable]) ?? null);
}

/** 单值结果行。 */
export function scalarRow(input: {
  analysisId: number;
  metricCode: string;
  metricValue: number | null;
  sampleCount?: number | null;
  details?: unknown;
}): ResultRowDraft {
  return scalarResult({
    analysisId: input.analysisId,
    metricCode: input.metricCode,
    metricValue: input.metricValue,
    sampleCount: input.sampleCount ?? null,
    details: input.details ?? null,
  });
}

/** 分组结果行（一个分组一行）。 */
export function groupedRows(input: {
  analysisId: number;
  metricCode: string;
  dimensionKey: string;
  groups: Array<{ label: string | number; metricValue: number; sampleCount?: number | null }>;
  details?: unknown;
}): ResultRowDraft[] {
  return groupedResults({
    analysisId: input.analysisId,
    metricCode: input.metricCode,
    dimensionKey: input.dimensionKey,
    groups: input.groups,
    details: input.details ?? null,
  });
}

/** 小样本门槛标注（**不**改变数值，只如实标记）。 */
export function sampleNote(sampleCount: number, minSampleCount: number): string | null {
  return sampleCount < minSampleCount
    ? `样本量 ${sampleCount} 低于门槛 ${minSampleCount}，该组结果不可用于结论`
    : null;
}
