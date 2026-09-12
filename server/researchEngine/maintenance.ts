/**
 * RESEARCH-002 — 研究实验维护服务（级联删除 + 产物失效）。
 *
 * 为什么单独有这一层：
 *   - `server/researchCore/repository` 只做**单实体** CRUD，不做跨实体编排；
 *   - 本项目**零数据库外键**（soft reference），删父行不会级联 → 「leaf-first
 *     删除顺序」是**领域规则**，必须由领域层显式承载；
 *   - 该规则此前只实现在 `scripts/verifyResearchEngine.mts` 的脚本内部（为了
 *     E2E 可重复执行而清残留），**产品化路径不可达** → 删 Experiment 必然留孤儿。
 *
 * 结论归属（本模块最关键的判断）：
 *   `research_conclusion` **没有 runId**，只有 `experimentId` + `hypothesisId`。
 *   所以「删某个 Run 该不该连带删结论」无法靠字段判断。本模块改为从结论证据里
 *   **精确提取分析 id**（`evidence.primaryAnalysis.analysisId` 与
 *   `evidence.contributingAnalyses[].analysisId`，兼容旧分支键
 *   `evidence.analyses[].analysisId`），与「本次删除涉及的分析集合」求交：
 *     - 命中   → 该结论由被删分析产出 → 一并删除（不留悬空证据）；
 *     - 未命中 → 属于其它 Run → **保留**；
 *     - 提不出 id（证据形状不可解析）→ **不删**，计入 `unattributedConclusions`
 *       如实上报 —— 宁可留下可核查的记录，也不猜着删。
 *
 * 纪律：本模块只做编排与引用完整性，**不做任何统计计算**（与 Repository 同一边界）。
 */

import type { ResearchRepositories } from "../researchCore/repository/contract";
import type { ResearchAnalysisCondition } from "../researchCore/types";
import { ResearchEngineError } from "./errors";

/**
 * 条件草稿（写入前的形态）：`logicalOperator` / `groupLogicalOperator` 可省，
 * 由本模块补默认值 `"AND"` —— 与 `createAnalysis` 的既有语义保持一致。
 */
export type ResearchConditionDraft = Omit<
  ResearchAnalysisCondition,
  "id" | "analysisId" | "createdAt" | "logicalOperator" | "groupLogicalOperator"
> & {
  logicalOperator?: ResearchAnalysisCondition["logicalOperator"];
  groupLogicalOperator?: ResearchAnalysisCondition["groupLogicalOperator"];
};

/**
 * 执行中拒绝删除（domain guard）。
 *
 * 为什么要拦：`RUNNING` 表示引擎正在逐分析写库；此时删父行会让「正在飞行中的
 * 写入」落到已被删除的分析上，产生**无法归因的半成品**。宁可让调用方等一会，
 * 也不要留下一条谁也解释不清的记录。
 */
function assertNotRunning(status: string, entityLabel: string, id: number): void {
  if (status === "RUNNING") {
    throw new ResearchEngineError(
      "DELETE_CONFLICT",
      `${entityLabel}（id=${id}）正在执行中（RUNNING）：请等待本次执行结束，或先将其置为 CANCELLED 再删除。`,
      { entityLabel, id, status },
    );
  }
}

// ---------------------------------------------------------------------------
// 结果类型
// ---------------------------------------------------------------------------

/** 删除计数（按实体分类，供 UI 如实回显「删了什么」）。 */
export interface MaintenanceDeletionCounts {
  experiments: number;
  hypotheses: number;
  runs: number;
  analyses: number;
  conditions: number;
  metrics: number;
  results: number;
  conclusions: number;
  candidates: number;
  artifacts: number;
}

/** Run 删除结果：计数 + 无法归属的结论数（如实上报，不隐藏）。 */
export interface DeleteRunResult {
  counts: MaintenanceDeletionCounts;
  /**
   * 证据里提不出分析 id 的**实验级结论**条数。这些结论**未被删除**
   * （无法证明它们属于被删的 Run），UI 应提示人工核查。
   */
  unattributedConclusions: number;
}

/** 分析失效结果（改条件后旧产物不再有效）。 */
export interface InvalidateAnalysisResult {
  /** 被清除的旧结果行数。 */
  deletedResults: number;
  /** 因证据指向该分析而被删除的结论条数。 */
  deletedConclusions: number;
  /** 被回退为 PENDING 的分析 id（= 入参）。 */
  analysisId: number;
  /** 被回退为 PENDING 的 Run id（无 Run 时为 null）。 */
  runId: number | null;
}

function emptyCounts(): MaintenanceDeletionCounts {
  return {
    experiments: 0,
    hypotheses: 0,
    runs: 0,
    analyses: 0,
    conditions: 0,
    metrics: 0,
    results: 0,
    conclusions: 0,
    candidates: 0,
    artifacts: 0,
  };
}

// ---------------------------------------------------------------------------
// 证据 → 分析 id 提取
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectIdsFromAnalysisList(value: unknown, out: Set<number>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const id = record["analysisId"];
    if (typeof id === "number" && Number.isInteger(id) && id > 0) out.add(id);
  }
}

/**
 * 从结论证据中提取其依据的全部分析 id（去重、仅取正整数）。
 *
 * 显式不做「猜」：形状不认识就返回空数组，由调用方按「不可归属」处理。
 * 未知键不会让我误删证据指向其它分析的结论。
 */
export function analysisIdsReferencedByConclusionEvidence(evidence: unknown): number[] {
  const root = asRecord(evidence);
  if (!root) return [];
  const out = new Set<number>();
  const primary = asRecord(root["primaryAnalysis"]);
  if (primary) {
    const id = primary["analysisId"];
    if (typeof id === "number" && Number.isInteger(id) && id > 0) out.add(id);
  }
  collectIdsFromAnalysisList(root["contributingAnalyses"], out);
  // 兼容旧 evidence 分支键（见 conclusion.ts buildEvidence 的历史形状）。
  collectIdsFromAnalysisList(root["analyses"], out);
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 内部：leaf-first 删除
// ---------------------------------------------------------------------------

/** 删除单个 Analysis 的全部子行（结果 / 条件 / 指标定义）。 */
async function deleteAnalysisChildren(
  repos: ResearchRepositories,
  analysisId: number,
): Promise<{ conditions: number; metrics: number; results: number }> {
  const results = await repos.results.deleteByAnalysis(analysisId);
  const conditions = await repos.conditions.deleteByAnalysis(analysisId);
  const metrics = await repos.metrics.listByAnalysis(analysisId);
  for (const metric of metrics) {
    if (metric.id !== undefined) await repos.metrics.delete(metric.id);
  }
  return { conditions, metrics: metrics.length, results };
}

/**
 * 删除「证据指向给定分析集合」的实验级结论；其余保留。
 * 返回删除条数与无法归属条数（无法归属的一律不删）。
 */
async function removeConclusionsReferencing(
  repos: ResearchRepositories,
  experimentId: number,
  analysisIds: ReadonlySet<number>,
): Promise<{ deleted: number; unattributed: number }> {
  if (analysisIds.size === 0) return { deleted: 0, unattributed: 0 };
  const conclusions = await repos.conclusions.list({ experimentId });
  let deleted = 0;
  let unattributed = 0;
  for (const conclusion of conclusions) {
    const referenced = analysisIdsReferencedByConclusionEvidence(conclusion.evidence);
    if (referenced.length === 0) {
      unattributed += 1;
      continue;
    }
    if (!referenced.some((id) => analysisIds.has(id))) continue;
    if (conclusion.id === undefined) continue;
    await repos.conclusions.delete(conclusion.id);
    deleted += 1;
  }
  return { deleted, unattributed };
}

/**
 * 删除一条 Analysis 及其全部子行 + 证据指向它的结论。
 *
 * ⚠️ **刻意不清理 `run.executionLog` 中引用该 analysisId 的历史条目**：
 * 批次日志是**追加式的历史事实**（「第 2 批当时执行了这些分析」），删掉分析并不会让
 * 这条历史变成假的；反过来去改写/剔除条目才会破坏「append-only 可追溯」这条纪律。
 * 后果是日志里可能出现已删除的分析 id —— 消费方（UI / 报告）需容忍「查不到该分析」。
 */
async function deleteOneAnalysis(
  repos: ResearchRepositories,
  analysisId: number,
  experimentId: number | null,
): Promise<{ conditions: number; metrics: number; results: number; conclusions: number }> {
  const children = await deleteAnalysisChildren(repos, analysisId);
  const { deleted } =
    experimentId === null
      ? { deleted: 0 }
      : await removeConclusionsReferencing(repos, experimentId, new Set([analysisId]));
  await repos.analyses.delete(analysisId);
  return { ...children, conclusions: deleted };
}

// ---------------------------------------------------------------------------
// 对外：级联删除
// ---------------------------------------------------------------------------

/** 删除单个分析（+ 子行 + 证据指向它的结论）。 */
export async function deleteAnalysisCascade(
  repos: ResearchRepositories,
  analysisId: number,
): Promise<MaintenanceDeletionCounts> {
  const analysis = await repos.analyses.getById(analysisId);
  if (!analysis) {
    throw new ResearchEngineError("ANALYSIS_NOT_FOUND", `未找到 Research Analysis：${analysisId}`);
  }
  assertNotRunning(analysis.status, "Research Analysis", analysisId);
  const run = await repos.runs.getById(analysis.runId);
  const counts = emptyCounts();
  const removed = await deleteOneAnalysis(repos, analysisId, run?.experimentId ?? null);
  counts.analyses = 1;
  counts.conditions = removed.conditions;
  counts.metrics = removed.metrics;
  counts.results = removed.results;
  counts.conclusions = removed.conclusions;
  return counts;
}

/**
 * 删除一个 Run（+ 其全部分析及子行 + 证据指向这些分析的结论），并把它回退前
 * 产生的实验级结论按证据归属精确处理。
 *
 * **不**删除提不出分析 id 的结论（无法证明归属）—— 计入 `unattributedConclusions`。
 */
export async function deleteRunCascade(
  repos: ResearchRepositories,
  runId: number,
): Promise<DeleteRunResult> {
  const run = await repos.runs.getById(runId);
  if (!run) {
    throw new ResearchEngineError("RUN_NOT_FOUND", `未找到 Research Run：${runId}`);
  }
  assertNotRunning(run.status, "Research Run", runId);
  const analyses = await repos.analyses.list({ runId });
  const analysisIds = new Set<number>();
  for (const analysis of analyses) {
    if (analysis.id !== undefined) analysisIds.add(analysis.id);
  }

  const { deleted: deletedConclusions, unattributed } = await removeConclusionsReferencing(
    repos,
    run.experimentId,
    analysisIds,
  );

  const counts = emptyCounts();
  counts.conclusions = deletedConclusions;
  for (const analysis of analyses) {
    if (analysis.id === undefined) continue;
    const removed = await deleteAnalysisChildren(repos, analysis.id);
    counts.conditions += removed.conditions;
    counts.metrics += removed.metrics;
    counts.results += removed.results;
    await repos.analyses.delete(analysis.id);
    counts.analyses += 1;
  }
  await repos.runs.delete(runId);
  counts.runs = 1;

  return { counts, unattributedConclusions: unattributed };
}

/**
 * 删除整个 Experiment（leaf-first 全量：runs → analyses → 子行 → hypotheses /
 * conclusions / candidates / artifacts → experiment）。
 *
 * 这是**唯一**「目标不产生孤儿」的删除入口 —— 与 E2E 脚本的清理顺序一致。
 */
export async function deleteExperimentCascade(
  repos: ResearchRepositories,
  experimentId: number,
): Promise<MaintenanceDeletionCounts> {
  const experiment = await repos.experiments.getById(experimentId);
  if (!experiment) {
    throw new ResearchEngineError(
      "EXPERIMENT_NOT_FOUND",
      `未找到 Research Experiment：${experimentId}`,
    );
  }
  const counts = emptyCounts();

  const runs = await repos.runs.list({ experimentId });
  for (const run of runs) {
    if (run.id !== undefined) assertNotRunning(run.status, "Research Run", run.id);
  }
  for (const run of runs) {
    if (run.id === undefined) continue;
    const analyses = await repos.analyses.list({ runId: run.id });
    for (const analysis of analyses) {
      if (analysis.id === undefined) continue;
      const removed = await deleteAnalysisChildren(repos, analysis.id);
      counts.conditions += removed.conditions;
      counts.metrics += removed.metrics;
      counts.results += removed.results;
      await repos.analyses.delete(analysis.id);
      counts.analyses += 1;
    }
    await repos.runs.delete(run.id);
    counts.runs += 1;
  }

  for (const hypothesis of await repos.hypotheses.listByExperiment(experimentId)) {
    if (hypothesis.id === undefined) continue;
    await repos.hypotheses.delete(hypothesis.id);
    counts.hypotheses += 1;
  }
  for (const conclusion of await repos.conclusions.list({ experimentId })) {
    if (conclusion.id === undefined) continue;
    await repos.conclusions.delete(conclusion.id);
    counts.conclusions += 1;
  }
  for (const candidate of await repos.candidates.list({ experimentId })) {
    if (candidate.id === undefined) continue;
    await repos.candidates.delete(candidate.id);
    counts.candidates += 1;
  }
  for (const artifact of await repos.artifacts.list({ experimentId })) {
    if (artifact.id === undefined) continue;
    await repos.artifacts.delete(artifact.id);
    counts.artifacts += 1;
  }

  await repos.experiments.delete(experimentId);
  counts.experiments = 1;
  return counts;
}

/** 删除单个假设（+ 证据指向它的结论）。 */
export async function deleteHypothesisCascade(
  repos: ResearchRepositories,
  hypothesisId: number,
): Promise<MaintenanceDeletionCounts> {
  const hypothesis = await repos.hypotheses.getById(hypothesisId);
  if (!hypothesis) {
    throw new ResearchEngineError("HYPOTHESIS_NOT_FOUND", `未找到 Research Hypothesis：${hypothesisId}`);
  }
  const counts = emptyCounts();
  const conclusions = await repos.conclusions.list({
    experimentId: hypothesis.experimentId,
    hypothesisId,
  });
  for (const conclusion of conclusions) {
    if (conclusion.id === undefined) continue;
    await repos.conclusions.delete(conclusion.id);
    counts.conclusions += 1;
  }
  await repos.hypotheses.delete(hypothesisId);
  counts.hypotheses = 1;
  return counts;
}

// ---------------------------------------------------------------------------
// 对外：产物失效
// ---------------------------------------------------------------------------

/**
 * 让一个 Analysis 的既有产物失效（改口径后必须调用，否则 UI 会继续展示用**旧
 * 口径**算出的结果 —— 这是比报错更危险的静默不实）。
 *
 * 做三件事：
 *   1. 删除该分析的旧结果行；
 *   2. 删除证据指向该分析的结论（结论描述的是一次已不存在的计算）；
 *   3. 把 Analysis 与所属 Run 回退为 `PENDING` —— 于是 `runEngine` 的
 *      `RUN_NOT_PENDING` 前置恰好放行重跑，不需要额外入口。
 */
export async function invalidateAnalysis(
  repos: ResearchRepositories,
  analysisId: number,
): Promise<InvalidateAnalysisResult> {
  const analysis = await repos.analyses.getById(analysisId);
  if (!analysis) {
    throw new ResearchEngineError("ANALYSIS_NOT_FOUND", `未找到 Research Analysis：${analysisId}`);
  }
  const run = await repos.runs.getById(analysis.runId);
  const experimentId = run?.experimentId ?? null;

  const deletedResults = await repos.results.deleteByAnalysis(analysisId);
  const { deleted: deletedConclusions } =
    experimentId === null
      ? { deleted: 0 }
      : await removeConclusionsReferencing(repos, experimentId, new Set([analysisId]));

  await repos.analyses.update(analysisId, { status: "PENDING", completedAt: null });
  if (run?.id !== undefined) {
    await repos.runs.update(run.id, { status: "PENDING", completedAt: null });
  }

  return {
    analysisId,
    deletedResults,
    deletedConclusions,
    runId: run?.id ?? null,
  };
}

/**
 * 改口径的唯一入口：**先守卫、再替换条件、最后让旧产物失效**。
 *
 * 顺序不可颠倒 —— 若先把条件写进去再发现分析正在执行（RUNNING），条件已经变了、
 * 结果却还是旧口径的，正好制造出「条件与结果不符」的静默不实。
 */
export async function replaceConditionsAndInvalidate(
  repos: ResearchRepositories,
  analysisId: number,
  conditions: ResearchConditionDraft[],
): Promise<{ conditions: ResearchAnalysisCondition[]; invalidation: InvalidateAnalysisResult }> {
  const analysis = await repos.analyses.getById(analysisId);
  if (!analysis) {
    throw new ResearchEngineError("ANALYSIS_NOT_FOUND", `未找到 Research Analysis：${analysisId}`);
  }
  assertNotRunning(analysis.status, "Research Analysis", analysisId);

  const replaced = await repos.conditions.replaceForAnalysis(
    analysisId,
    conditions.map((c) => ({
      groupNo: c.groupNo,
      sortOrder: c.sortOrder,
      fieldName: c.fieldName,
      operator: c.operator,
      value: c.value,
      logicalOperator: c.logicalOperator ?? "AND",
      groupLogicalOperator: c.groupLogicalOperator ?? "AND",
    })),
  );
  const invalidation = await invalidateAnalysis(repos, analysisId);
  return { conditions: replaced, invalidation };
}

/** 供 UI / 日志汇总一句话（不隐藏任何一项）。 */
export function describeDeletionCounts(counts: MaintenanceDeletionCounts): string {
  const parts: string[] = [];
  const push = (n: number, label: string) => {
    if (n > 0) parts.push(`${n} 个${label}`);
  };
  push(counts.experiments, "实验");
  push(counts.runs, "Run");
  push(counts.analyses, "分析");
  push(counts.hypotheses, "假设");
  push(counts.results, "结果行");
  push(counts.conditions, "条件");
  push(counts.metrics, "指标定义");
  push(counts.conclusions, "结论");
  push(counts.candidates, "候选");
  push(counts.artifacts, "产物");
  return parts.length === 0 ? "未删除任何记录" : `已删除 ${parts.join(" / ")}`;
}
