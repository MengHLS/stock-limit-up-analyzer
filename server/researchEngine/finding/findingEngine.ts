/**
 * RESEARCH-FINDING-001 B4 —— FindingEngine（编排 + 落库）。
 *
 * 职责：`Run 的 Result` → `research_finding` 行。
 *
 * 执行序列（**确定性**，同输入必同输出）：
 *   1. 载入 Experiment / Run（校验归属）；
 *   2. 取该 Run 的 Analysis（缺省只取 `COMPLETED`）；
 *   3. **逐分析读 `research_result`**（`repos.results.list({analysisId})`）→ `parseAnalysisSeries`；
 *   4. `resetExisting` ⇒ 先清理该 Run 既有 Finding（重跑幂等）；
 *   5. 建立基准索引（真实「全样本」行，来自 DESCRIPTIVE / STABILITY / CONDITIONAL）；
 *   6. 逐序列探测（§6–§11）→ 打分（§14）→ 落库（`fingerprint` 幂等）；
 *   7. **组合探测（§12）在基础 Finding 落库之后**运行 —— 因为交互 Finding 要引用真实的
 *      `findingIds`；无 Result 支撑的组合只回传 `untestedInteractions`，**不落 Finding 表**；
 *   8. 汇总。
 *
 * 🔴 性能（任务书 §28）：**只读 `research_result`**。本文件不 import `datasetReader`，
 *    不出现任何 `dataset_*` / `limit_up_records` 查询 —— 这是本阶段的硬边界。
 * 🔴 状态：引擎**只能**写 `DISCOVERED`（`findings.ts#assertEngineFindingCreationStatus` 兜底）。
 */

import type {
  FindingPolicy,
  ResearchConditionSet,
  ResearchFinding,
  ResearchRepositories,
} from "../../researchCore";
import { groupConditions, resolveFindingPolicy, renderFindingPolicy } from "../../researchCore";
import { ResearchEngineError, engineAssert } from "../errors";
import { buildBaselineIndex, buildFingerprint, FindingDetector, type DetectContext } from "./findingDetector";
import { FindingInteractionAnalyzer } from "./findingInteractionAnalyzer";
import { FindingScorer } from "./findingScorer";
import { parseAnalysisSeries } from "./resultView";
import type {
  AnalysisSeries,
  FindingDraft,
  FindingEngineDetectInput,
  FindingEngineDetectResult,
} from "./types";

export interface FindingEngineDeps {
  repos: ResearchRepositories;
  /** 判定策略覆盖（缺省 `DEFAULT_FINDING_POLICY`）；最终快照进每条 Finding 的 `policyJson`。 */
  policy?: Partial<FindingPolicy>;
}

/** 该 Run 下**可参与检测**的分析状态。 */
const DETECTABLE_ANALYSIS_STATUS = "COMPLETED";

export class FindingEngine {
  private readonly repos: ResearchRepositories;
  private readonly policy: FindingPolicy;

  constructor(deps: FindingEngineDeps) {
    this.repos = deps.repos;
    this.policy = resolveFindingPolicy(deps.policy ?? null);
  }

  /** 当前生效的判定策略（供 API 回显）。 */
  policySnapshot(): FindingPolicy {
    return this.policy;
  }

  /**
   * 检测并落库。
   *
   * `resetExisting` 语义：缺省 true（整轮重跑幂等）。
   * ⚠️ 指定 `analysisIds` 时**强制**不清理 —— 否则会连带删掉本次未触及分析产出的 Finding。
   */
  async detect(input: FindingEngineDetectInput): Promise<FindingEngineDetectResult> {
    const startedAt = Date.now();
    const { repos } = this;

    // ---- 1. Experiment / Run ----
    const experiment = await repos.experiments.getById(input.experimentId);
    engineAssert(
      experiment !== undefined,
      "EXPERIMENT_NOT_FOUND",
      `未找到 Research Experiment：${input.experimentId}`,
      { experimentId: input.experimentId },
    );
    const run = await repos.runs.getById(input.runId);
    engineAssert(run !== undefined, "RUN_NOT_FOUND", `未找到 Research Run：${input.runId}`, {
      runId: input.runId,
    });
    engineAssert(
      run.experimentId === experiment.id,
      "RUN_EXPERIMENT_MISMATCH",
      `Run ${run.id} 属于 Experiment ${run.experimentId}，与请求的 ${experiment.id} 不一致`,
      { runId: run.id, runExperimentId: run.experimentId, experimentId: experiment.id },
    );

    // ---- 2. 选定候选分析 ----
    const allAnalyses = await repos.analyses.list({ runId: run.id! });
    const explicit = input.analysisIds;
    let targets = allAnalyses.filter((a) => a.status === DETECTABLE_ANALYSIS_STATUS);
    if (explicit !== undefined && explicit.length > 0) {
      const wanted = new Set(explicit);
      targets = allAnalyses.filter((a) => wanted.has(a.id!));
      engineAssert(
        targets.length > 0,
        "NO_ANALYSES",
        `指定 analysisIds 在该 Run 下不存在：${explicit.join(", ")}`,
        { runId: run.id, analysisIds: explicit },
      );
    }
    engineAssert(
      targets.length > 0,
      "NO_ANALYSES",
      `Run ${run.id} 下没有可检测的分析（需要 ${DETECTABLE_ANALYSIS_STATUS}）；请先执行引擎。`,
      { runId: run.id, analysisCount: allAnalyses.length },
    );

    // ---- 3. 逐分析读 Result → 序列 ----
    const seriesList: AnalysisSeries[] = [];
    const skipped: FindingEngineDetectResult["skipped"] = [];
    let resultCount = 0;
    for (const analysis of targets) {
      const results = await repos.results.list({ analysisId: analysis.id! });
      resultCount += results.length;
      const series = parseAnalysisSeries({
        analysisId: analysis.id!,
        analysisType: analysis.analysisType,
        target: analysis.target ?? null,
        results,
      });
      if (series === null) {
        skipped.push({
          analysisId: analysis.id!,
          analysisType: analysis.analysisType,
          reason: "该分析没有任何 Result 行（未产出结果，不推断）",
        });
        continue;
      }
      if (!series.assessable) {
        skipped.push({
          analysisId: analysis.id!,
          analysisType: analysis.analysisType,
          reason: "该分析类型不构成「有序关系」证据（如 DESCRIPTIVE 的档位是变量名，无自然顺序）",
        });
      }
      seriesList.push(series);
    }

    // ---- 4. 清理既有 Finding（重跑幂等）----
    const reset = input.resetExisting !== false && (explicit === undefined || explicit.length === 0);
    if (reset) await repos.findings.deleteByRun(run.id!);
    const preExisting = await repos.findings.list({ runId: run.id! });
    const preIds = new Set(preExisting.map((f) => f.id));

    // ---- 5. 基准索引（DESCRIPTIVE 优先；真实 Result 行）----
    const baselineOrder = [...seriesList].sort((a, b) => rankOfBaseline(a) - rankOfBaseline(b) || a.analysisId - b.analysisId);
    const ctx: DetectContext = { baselines: buildBaselineIndex(baselineOrder), policy: this.policy };

    // ---- 6. 探测 + 打分 + 落库 ----
    const assessable = seriesList.filter((s) => s.assessable);
    const drafts = FindingDetector.detectAll(assessable, ctx);
    const persistedBase: ResearchFinding[] = [];
    for (const draft of drafts) {
      const row = await this.persist(draft, experiment.id!, run.id!);
      persistedBase.push(row);
    }

    // ---- 7. §12 组合（基础 Finding 已落库 ⇒ 可引用真实 findingIds）----
    const conditionSets = await this.loadConditionSets(targets);
    const seriesByAnalysisId = new Map(seriesList.map((s) => [s.analysisId, s]));
    const interaction = FindingInteractionAnalyzer.analyze({
      baseFindings: persistedBase,
      seriesByAnalysisId,
      conditionSets,
      policy: this.policy,
    });
    const persistedInteraction: ResearchFinding[] = [];
    for (const draft of interaction.confirmed) {
      persistedInteraction.push(await this.persist(draft, experiment.id!, run.id!));
    }

    // ---- 8. 汇总 ----
    const allPersisted = [...persistedBase, ...persistedInteraction];
    const finalRows = await repos.findings.list({ runId: run.id! });
    const createdCount = finalRows.filter((f) => !preIds.has(f.id)).length;
    const findingsByType: Record<string, number> = {};
    for (const f of finalRows) findingsByType[f.findingType] = (findingsByType[f.findingType] ?? 0) + 1;

    return {
      experimentId: experiment.id!,
      runId: run.id!,
      analysisCount: targets.length,
      resultCount,
      detectedCount: allPersisted.length,
      createdCount,
      reusedCount: allPersisted.length - createdCount,
      findingIds: finalRows.map((f) => f.id!).sort((a, b) => a - b),
      findingsByType,
      untestedInteractions: interaction.untested,
      skipped,
      policySnapshot: { policy: this.policy, rendered: renderFindingPolicy(this.policy) },
      durationMs: Date.now() - startedAt,
    };
  }

  /** 落库单条草稿：补 `experimentId` / `runId` / 用**真实 runId** 重算 fingerprint / 过 Scorer。 */
  private async persist(draft: FindingDraft, experimentId: number, runId: number): Promise<ResearchFinding> {
    const fingerprint = buildFingerprint({
      runId,
      findingType: draft.findingType,
      primaryAnalysisId: draft.primaryAnalysisId ?? null,
      dimension: draft.dimension ?? null,
    });
    const scored = FindingScorer.score(draft, this.policy);
    const created = await this.repos.findings.create({
      ...scored,
      experimentId,
      runId,
      status: "DISCOVERED",
      fingerprint,
      // 策略快照必须落库：否则事后调阈值会让历史 Finding 不可复核（任务书 §7）。
      policy: { ...this.policy, rendered: renderFindingPolicy(this.policy), engine: "RESEARCH-FINDING-001" },
    });
    return created;
  }

  /** 载入 CONDITIONAL 分析的结构化条件（§12 组合判定需要真实条件行，不是文本）。 */
  private async loadConditionSets(
    analyses: readonly { id?: number; analysisType: string }[],
  ): Promise<Map<number, ResearchConditionSet>> {
    const out = new Map<number, ResearchConditionSet>();
    for (const analysis of analyses) {
      if (analysis.analysisType !== "CONDITIONAL") continue;
      const rows = await this.repos.conditions.listByAnalysis(analysis.id!);
      out.set(analysis.id!, { groups: groupConditions(rows) });
    }
    return out;
  }
}

/** 基准优先级：DESCRIPTIVE 最纯（对变量本身做全样本统计）⇒ 排最前。 */
function rankOfBaseline(series: AnalysisSeries): number {
  if (series.analysisType === "DESCRIPTIVE") return 0;
  if (series.benchmark !== null) return 1;
  return 2;
}

/** 便利出口：默认策略的引擎。 */
export function createFindingEngine(deps: FindingEngineDeps): FindingEngine {
  return new FindingEngine(deps);
}

/** 供上游（engine.ts）在 Run 完成后调用；失败**不吞**，由调用方决定是否影响 Run 终态。 */
export async function detectAndPersistFindings(
  deps: FindingEngineDeps,
  input: FindingEngineDetectInput,
): Promise<FindingEngineDetectResult> {
  const engine = new FindingEngine(deps);
  try {
    return await engine.detect(input);
  } catch (err) {
    if (err instanceof ResearchEngineError) throw err;
    throw new ResearchEngineError(
      "FINDING_DETECTION_FAILED",
      `Finding 检测失败：${err instanceof Error ? err.message : String(err)}`,
      { experimentId: input.experimentId, runId: input.runId },
    );
  }
}
