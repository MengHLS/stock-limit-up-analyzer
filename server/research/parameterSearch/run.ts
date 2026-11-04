/**
 * STEP 17 / C-17.1 — Grid / Random 搜索运行编排（纯函数搜索器）。
 *
 * 职责：一次搜索（request）→ 完整 SearchRun 记录：
 *   1. 校验请求（method / strategy 身份 / 参数空间 / evaluator / seed / budget /
 *      maxCombinations / 稳定区口径）；退化输入结构化抛错（ResearchValidationError）；
 *   2. 采样：grid → 桥接 combinationGenerator 全组合；random → seedable PRNG 无放回采样；
 *   3. 逐样本注入 evaluator 评估（不执行 IO / 回测）；evaluator 抛错或产物非法 → 该样本
 *      转记为 failed（结构化可见，不静默吞掉）;
 *   4. 稳定区判定（region.ts）→ 候选策略产出（candidate.ts，kind = "candidate"，非生产）；
 *   5. 组装 SearchRun：method / seed / budget / combinationCount / sampleCount /
 *      parameterSpace 快照 + 指纹 / analysisConfig / evaluatedSamples / region /
 *      candidates / createdAt / fingerprint。
 *
 * 确定性纪律：搜索内容（采样 + 评估序 + 区域 + 候选）由 (space, method, seed, budget,
 * analysis) 完全决定；searchRunId / createdAt 是运行元数据（默认随运行实例生成，调用方可
 * 注入固定值使整条记录确定性可复现）。
 *
 * 铁律：纯函数、无 DB / 网络；无 Math.random（random 仅用 seedable PRNG）；禁止 NaN /
 * Infinity；失败响亮；mutation isolation（不修改入参 space / evaluator 之外的任何状态）。
 */

import { randomBytes } from "node:crypto";
import {
  DEFAULT_MAX_COMBINATIONS,
} from "../combinationGenerator";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { validateParameterSpace } from "../parameterSpace";
import { computeParameterSpaceFingerprint } from "../sweep";
import type { ResearchParameterSet } from "../types";
import { buildCandidateStrategies } from "./candidate";
import { validateParameterSearchMetrics } from "./metrics";
import { analyzeCandidateRegion, resolveRegionAnalysisConfig } from "./region";
import { gridParameterSets, sampleRandomParameterSets } from "./sampler";
import { computeParameterSearchRunFingerprint } from "./serialize";
import {
  PARAMETER_SEARCH_RUN_RECORD_KIND,
  PARAMETER_SEARCH_RUN_RECORD_VERSION,
  SEARCH_RUN_ID_PREFIX,
  DEFAULT_RANDOM_SEARCH_BUDGET,
  type ParameterSearchEvaluatedSample,
  type ParameterSearchRun,
  type ParameterSearchRequest,
  type ParameterSearchSampleOutcome,
} from "./types";

// ---------------------------------------------------------------------------
// SearchRun ID（运行元数据；风格对齐 sweep.generateBatchId）
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 组装 SearchRun ID（`SEARCH-YYYYMMDD-XXXXXXXX`）。 */
export function formatSearchRunId(date: string, suffix: string): string {
  return `${SEARCH_RUN_ID_PREFIX}-${date}-${suffix}`;
}

/** 生成 SearchRun ID；注入 suffix 时（测试）确定性；属于运行元数据，允许随机后缀。 */
export function generateSearchRunId(now: Date = new Date(), suffix?: string): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatSearchRunId(date, resolvedSuffix);
}

// ---------------------------------------------------------------------------
// 请求校验
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateSearchRequest(
  request: ParameterSearchRequest,
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    issue("SEARCH_REQUEST_INVALID", "request", "request 必须是对象");
    return issues;
  }
  if (request.method !== "grid" && request.method !== "random") {
    issue("SEARCH_METHOD_INVALID", "method", `method=${String(request.method)} 非法（期望 grid | random）`);
  }
  if (typeof request.strategyId !== "string" || request.strategyId.trim() === "") {
    issue("SEARCH_STRATEGY_ID_EMPTY", "strategyId", "strategyId 不能为空");
  }
  if (typeof request.strategyVersion !== "string" || request.strategyVersion.trim() === "") {
    issue("SEARCH_STRATEGY_VERSION_EMPTY", "strategyVersion", "strategyVersion 不能为空");
  }
  const spaceValidation = validateParameterSpace(request.parameterSpace);
  if (!spaceValidation.valid) {
    issues.push(...spaceValidation.issues);
  }
  if (typeof request.evaluator !== "function") {
    issue("SEARCH_EVALUATOR_INVALID", "evaluator", "evaluator 必须是函数");
  }
  if (request.method === "random") {
    if (request.seed === undefined) {
      issue("SEARCH_RANDOM_SEED_MISSING", "seed", "random 搜索必须提供整数 seed");
    } else if (!Number.isInteger(request.seed)) {
      issue("SEARCH_RANDOM_SEED_INVALID", "seed", `seed 必须是整数，实际 ${String(request.seed)}`);
    }
    if (request.budget !== undefined && (!Number.isInteger(request.budget) || request.budget < 1)) {
      issue("SEARCH_RANDOM_BUDGET_INVALID", "budget", `budget 必须是 >= 1 的整数，实际 ${String(request.budget)}`);
    }
  }
  if (request.method === "grid" && request.maxCombinations !== undefined
    && (!Number.isInteger(request.maxCombinations) || request.maxCombinations < 1)) {
    issue("SEARCH_GRID_MAX_COMBINATIONS_INVALID", "maxCombinations", `maxCombinations 必须是 >= 1 的整数，实际 ${String(request.maxCombinations)}`);
  }
  if (request.parameterSpace !== undefined && (request.parameterSpace as { parameters?: unknown }).parameters !== undefined) {
    // 已由 validateParameterSpace 覆盖；占位避免空分支（保持阅读一致性）。
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 执行一次 Grid / Random 参数搜索，产出完整 SearchRun 记录。 */
export function runParameterSearch(request: ParameterSearchRequest): ParameterSearchRun {
  const { config: analysisConfig, issues: analysisIssues } = resolveRegionAnalysisConfig(request.analysis);
  const requestIssues = validateSearchRequest(request);
  const combinedIssues = [...analysisIssues, ...requestIssues];
  if (combinedIssues.length > 0) {
    throw new ResearchValidationError(combinedIssues);
  }

  // ---- 采样 ----
  let parameterSets: ResearchParameterSet[] = [];
  let combinationCountValue = 0;
  if (request.method === "grid") {
    parameterSets = gridParameterSets(request.parameterSpace, {
      maxCombinations: request.maxCombinations ?? DEFAULT_MAX_COMBINATIONS,
    });
    combinationCountValue = parameterSets.length;
  } else {
    const sampling = sampleRandomParameterSets(
      request.parameterSpace,
      request.seed!,
      request.budget ?? DEFAULT_RANDOM_SEARCH_BUDGET,
    );
    parameterSets = sampling.parameterSets;
    combinationCountValue = sampling.combinationCount;
  }

  // ---- 评估（注入式；evaluator 异常 / 非法产物 → 样本转记 failed） ----
  const evaluatedSamples: ParameterSearchEvaluatedSample[] = [];
  for (const parameterSet of parameterSets) {
    let outcome: ParameterSearchSampleOutcome;
    try {
      outcome = request.evaluator(parameterSet);
    } catch (error) {
      evaluatedSamples.push({
        parameterSet,
        status: "failed",
        totalReturnPct: null,
        maxDrawdownPct: null,
        tradeCount: null,
        error: `评估器抛错：${errorMessage(error)}`,
      });
      continue;
    }
    if (outcome.status === "failed") {
      evaluatedSamples.push({
        parameterSet,
        status: "failed",
        totalReturnPct: null,
        maxDrawdownPct: null,
        tradeCount: null,
        error: outcome.error.trim() === "" ? "评估器返回空错误" : outcome.error,
      });
      continue;
    }
    const metricError = validateParameterSearchMetrics(outcome.metrics);
    if (metricError !== null) {
      evaluatedSamples.push({
        parameterSet,
        status: "failed",
        totalReturnPct: null,
        maxDrawdownPct: null,
        tradeCount: null,
        error: `评估产物非法：${metricError}`,
      });
      continue;
    }
    evaluatedSamples.push({
      parameterSet,
      status: "succeeded",
      totalReturnPct: outcome.metrics.totalReturnPct,
      maxDrawdownPct: outcome.metrics.maxDrawdownPct,
      tradeCount: outcome.metrics.tradeCount,
      error: null,
    });
  }

  // ---- 稳定区判定 + 候选策略产出 ----
  const region = analyzeCandidateRegion(evaluatedSamples, analysisConfig);
  const searchRunId = request.searchRunId ?? generateSearchRunId();
  const createdAt = request.createdAt ?? new Date().toISOString();
  const candidates = buildCandidateStrategies({
    searchRunId,
    strategyId: request.strategyId,
    strategyVersion: request.strategyVersion,
    region,
    config: analysisConfig,
  });

  const parameterSpaceFingerprint = computeParameterSpaceFingerprint(request.parameterSpace);
  const body: Omit<ParameterSearchRun, "fingerprint"> = {
    recordKind: PARAMETER_SEARCH_RUN_RECORD_KIND,
    recordVersion: PARAMETER_SEARCH_RUN_RECORD_VERSION,
    searchRunId,
    strategyId: request.strategyId,
    strategyVersion: request.strategyVersion,
    method: request.method,
    seed: request.method === "random" ? request.seed! : null,
    requestedBudget: request.method === "random"
      ? (request.budget ?? DEFAULT_RANDOM_SEARCH_BUDGET)
      : combinationCountValue,
    combinationCount: combinationCountValue,
    sampleCount: evaluatedSamples.length,
    parameterSpace: request.parameterSpace,
    parameterSpaceFingerprint,
    analysisConfig,
    evaluatedSamples,
    region,
    candidates,
    createdAt,
  };
  const fingerprint = computeParameterSearchRunFingerprint(body);
  return { ...body, fingerprint };
}

/** Grid 便捷入口（method 恒为 grid；其余走统一校验）。 */
export function runGridSearch(request: ParameterSearchRequest): ParameterSearchRun {
  return runParameterSearch({ ...request, method: "grid" });
}

/** Random 便捷入口（method 恒为 random；其余走统一校验）。 */
export function runRandomSearch(request: ParameterSearchRequest): ParameterSearchRun {
  return runParameterSearch({ ...request, method: "random" });
}
