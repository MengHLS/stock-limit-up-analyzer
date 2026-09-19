/**
 * PHASE-A-001 —— Research Report 落库服务（装配 + 幂等）。
 *
 * 职责边界（任务书 §8 / §9 / §2.1）：
 *   - **只装配 + 只落库**：读既有 `research_run / research_experiment / research_analysis /
 *     research_result / research_finding / research_conclusion` 与 Dataset 版本上下文，
 *     交给 `generator.buildResearchReport` 投影，然后把产物写进既有 `research_artifact` 表；
 *   - **不重算任何研究结果**（不查行情、不算收益、不跑分析、不重算 Finding）；
 *   - **不新增第二套** Result / Finding / Conclusion / Artifact / 报告仓储（只用
 *     `ResearchRepositories.artifacts` 既有的 create / list / delete）；
 *   - **零迁移**：`research_artifact` 的列一个都不用改。
 *
 * ============================================================================
 * 幂等实现（§8「同 run + 同 report content ⇒ 相同 checksum ⇒ artifact 行数不增加」）
 * ============================================================================
 *
 * 🔴 审计结论（以当前代码为准，不以计划文档为准）：现有 `ResearchArtifactRepository` 只有
 * `create / getById / list / delete`，**没有** create-or-ignore、也没有 checksum 唯一约束
 * （`drizzle/0031_research_core.sql` 的三条索引均非唯一）。因此不存在「可复用的现成幂等机制」。
 *
 * 本任务**不新建幂等表**（明令禁止），改在服务层用既有仓储方法实现等价语义：
 *
 *     同 run 的既有 REPORT artifact 中，存在 checksum 相同的一条
 *         ⇒ 直接复用它，**一行都不写**（outcome = REUSED）
 *     一条都没有
 *         ⇒ 新建（outcome = CREATED）
 *     有，但 checksum 全部不同（说明该 Run 的结果被重算/补跑过）
 *         ⇒ 先删掉旧的该 Run REPORT artifact，再新建（outcome = SUPERSEDED）
 *
 * 最后一条是刻意的：任务书 A-1 要求「**一个完成的 Run 对应一个最终 REPORT Artifact**」。
 * 若只追加不清理，重复补跑会让同一 Run 挂出多份互相矛盾的「最终报告」。
 * 「删旧 + 建新」用的是既有 `artifacts.delete`，不引入任何新表或新列。
 */

import { findPatternByResearchModuleKey } from "../../research/patternLibrary";
import type {
  ResearchArtifact,
  ResearchConclusion,
  ResearchRepositories,
  ResearchResult,
} from "../../researchCore";
import type { ResearchDatasetReader } from "../datasetReader";
import { ResearchEngineError } from "../errors";
import { buildResearchReport } from "./generator";
import {
  REPORT_ARTIFACT_TYPE,
  REPORT_STORAGE_TYPE,
  buildReportUri,
  type ResearchReportDraft,
  type ResearchReportSource,
} from "./types";

export interface GenerateResearchReportDeps {
  repos: ResearchRepositories;
  reader: ResearchDatasetReader;
}

/** 本次落库的处置结果（三种，互斥）。 */
export type ReportGenerationOutcome =
  /** 该 Run 此前没有 REPORT artifact → 新建。 */
  | "CREATED"
  /** 已存在 checksum 相同的 REPORT artifact → 直接复用，**未写库**。 */
  | "REUSED"
  /** 已存在 REPORT artifact 但内容已变 → 删旧建新（保证「一个 Run 一份最终报告」）。 */
  | "SUPERSEDED";

export interface GenerateResearchReportResult {
  artifact: ResearchArtifact;
  outcome: ReportGenerationOutcome;
  checksum: string;
  /** 正文 UTF-8 字节数。 */
  bodyBytes: number;
  /** 被本方法删除的旧 REPORT artifact id（`SUPERSEDED` 时非空）。 */
  supersededArtifactIds: number[];
  /** 投影期的可读告警（不阻断落库）。 */
  warnings: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 把**实验级**结论归属到**本 Run**。
 *
 * `research_conclusion` 没有 `runId` 列（Schema 事实），唯一允许的解析路径是
 * `evidence.primaryAnalysis.analysisId → research_analysis.runId`。
 * 解析不出就返回 `null` + 原因，**绝不用「实验下最新结论」冒充**。
 */
function resolveConclusionForRun(
  conclusions: readonly ResearchConclusion[],
  analysisIds: ReadonlySet<number>,
): { conclusion: ResearchConclusion | null; resolution: string | null } {
  if (conclusions.length === 0) {
    return { conclusion: null, resolution: "该实验下没有任何 `research_conclusion` 行" };
  }
  const matched = conclusions.filter((c) => {
    const evidence = asRecord(c.evidence);
    const primary = evidence ? asRecord(evidence["primaryAnalysis"]) : null;
    const analysisId = primary ? primary["analysisId"] : null;
    return typeof analysisId === "number" && analysisIds.has(analysisId);
  });
  if (matched.length === 0) {
    return {
      conclusion: null,
      resolution:
        `该实验有 ${conclusions.length} 条结论，但没有任何一条的 ` +
        "`evidenceJson.primaryAnalysis.analysisId` 落在本 Run 的分析集合内（无法归属，不冒充）",
    };
  }
  const sorted = [...matched].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  const picked = sorted[0]!;
  return {
    conclusion: picked,
    resolution:
      matched.length === 1
        ? "按 `evidenceJson.primaryAnalysis.analysisId → research_analysis.runId` 两跳解析，命中 1 条"
        : `两跳解析命中 ${matched.length} 条（${sorted.map((c) => `#${c.id ?? "?"}`).join(", ")}），确定性取 id 最大者 #${picked.id ?? "?"}`,
  };
}

/** 装配投影输入（**只读**，全部来自既有表）。 */
export async function loadReportSource(
  deps: GenerateResearchReportDeps,
  runId: number,
): Promise<{ source: ResearchReportSource }> {
  const { repos, reader } = deps;

  const run = await repos.runs.getById(runId);
  if (!run) {
    throw new ResearchEngineError("RUN_NOT_FOUND", `未找到 Research Run：${runId}`, { runId });
  }
  if (run.status !== "COMPLETED") {
    // §9：Report Artifact 必须建立在一个已经完成的 Research Run 上。
    throw new ResearchEngineError(
      "REPORT_RUN_NOT_COMPLETED",
      `Run ${runId} 当前状态为 ${run.status}，只有 COMPLETED 的 Run 才能产出最终报告`,
      { runId, status: run.status },
    );
  }

  const experiment = await repos.experiments.getById(run.experimentId);
  if (!experiment) {
    throw new ResearchEngineError(
      "EXPERIMENT_NOT_FOUND",
      `未找到 Research Experiment：${run.experimentId}`,
      { experimentId: run.experimentId },
    );
  }

  // Dataset 版本上下文（只读；取不到即 null，报告里如实写「不可达」，不编造）。
  const dataset = (await reader.getVersionContext(experiment.datasetVersionId)) ?? null;

  const analyses = (await repos.analyses.list({ runId })).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  // 结果：按 Analysis 逐条取（仓储契约只有 `list({ analysisId })` 一种过滤方式）。
  const resultsByAnalysisId = new Map<number, ResearchResult[]>();
  for (const analysis of analyses) {
    const analysisId = analysis.id;
    if (analysisId === undefined) continue;
    resultsByAnalysisId.set(analysisId, await repos.results.list({ analysisId }));
  }

  const findings = (await repos.findings.list({ runId })).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  const conclusions = await repos.conclusions.list({ experimentId: experiment.id! });
  const analysisIdSet = new Set(
    analyses.map((a) => a.id).filter((id): id is number => typeof id === "number"),
  );
  const { conclusion, resolution } = resolveConclusionForRun(conclusions, analysisIdSet);

  // Pattern：只能经 `analysis.moduleKey` 反查声明库（Run ↔ pattern 无直接列）。
  const patternMap = new Map<string, { patternId: string; label: string }>();
  for (const analysis of analyses) {
    const moduleKey = analysis.moduleKey;
    if (typeof moduleKey !== "string" || moduleKey.length === 0) continue;
    const pattern = findPatternByResearchModuleKey(moduleKey);
    if (!pattern) continue;
    if (!patternMap.has(pattern.patternId)) {
      patternMap.set(pattern.patternId, { patternId: pattern.patternId, label: pattern.label });
    }
  }
  const patterns = Array.from(patternMap.values()).sort((a, b) => a.patternId.localeCompare(b.patternId));

  const source: ResearchReportSource = {
    experiment,
    run: {
      id: run.id!,
      runNo: run.runNo,
      status: run.status,
      sampleCount: run.sampleCount ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      inputSnapshot: run.inputSnapshot ?? null,
    },
    dataset,
    analyses,
    resultsByAnalysisId,
    findings,
    conclusion,
    patterns,
    conclusionResolution: resolution,
  };
  return { source };
}

/**
 * 生成并落库某 Run 的 REPORT artifact（幂等，见文件头）。
 *
 * 调用方：
 *   - `ResearchEngine.run()` 在 Run 落 COMPLETED 之后（best-effort，失败不影响 Run 结论）；
 *   - `scripts/generateResearchReport.mts`（历史已完成 Run 的一次性回填 / 人工重生成）。
 */
export async function generateResearchReport(
  deps: GenerateResearchReportDeps,
  runId: number,
): Promise<GenerateResearchReportResult> {
  const { repos } = deps;
  const { source } = await loadReportSource(deps, runId);
  const draft: ResearchReportDraft = buildResearchReport(source);

  const existing = (await repos.artifacts.list({ runId, artifactType: REPORT_ARTIFACT_TYPE })).sort(
    (a, b) => (a.id ?? 0) - (b.id ?? 0),
  );

  const reusable = existing.find((a) => a.checksum === draft.checksum);
  if (reusable) {
    return {
      artifact: reusable,
      outcome: "REUSED",
      checksum: draft.checksum,
      bodyBytes: draft.metadata.report.bytes,
      supersededArtifactIds: [],
      warnings: draft.warnings,
    };
  }

  const supersededArtifactIds: number[] = [];
  for (const stale of existing) {
    if (stale.id === undefined) continue;
    await repos.artifacts.delete(stale.id);
    supersededArtifactIds.push(stale.id);
  }

  const artifact = await repos.artifacts.create({
    experimentId: source.experiment.id ?? null,
    runId,
    artifactType: REPORT_ARTIFACT_TYPE,
    storageType: REPORT_STORAGE_TYPE,
    uri: buildReportUri(runId),
    checksum: draft.checksum,
    metadata: draft.metadata,
  });

  return {
    artifact,
    outcome: supersededArtifactIds.length > 0 ? "SUPERSEDED" : "CREATED",
    checksum: draft.checksum,
    bodyBytes: draft.metadata.report.bytes,
    supersededArtifactIds,
    warnings: draft.warnings,
  };
}
