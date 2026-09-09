/**
 * STEP 17 / C-17.2 — Rolling Optimization 运行编排（纯函数搜索器）。
 *
 * 职责：一次滚动优化请求 → 完整 RollingOptimizationRun 记录：
 *   1. 校验请求（strategy 身份 / method / 参数空间 / 交易日历 / 窗口配置 / 区域口径 /
 *      一致性口径 / evaluator 工厂 / seed / budget / maxCombinations）；退化输入结构化抛错；
 *   2. 生成滚动窗口（windows.ts，交易日锚定）；
 *   3. 逐窗：searchRunId = `${runId}-w${windowIndex}-search`（确定性），random 派生种子 =
 *      seed + windowIndex，复用 C-17.1 runParameterSearch 在窗上执行搜索（evaluator 工厂
 *      先注入窗上下文 → 窗内评估器；评估器异常由 runParameterSearch 转记 failed 样本）；
 *   4. 跨窗一致性判定（stability.ts）→ 跨窗候选产出（candidate.ts，kind = "candidate"）；
 *   5. 组装 RollingOptimizationRun：runId / method / seed / budget / parameterSpace + 指纹 /
 *      tradeDates + 指纹 / windowConfig / analysisConfig / stabilityConfig / windows[] /
 *      stability / candidates / createdAt / fingerprint。
 *
 * 确定性纪律：搜索内容（窗口划分 + 逐窗采样与评估序 + 一致性 + 候选）由 (tradeDates,
 * space, method, seed, budget, analysis, stability, windowConfig) 完全决定；runId / createdAt
 * 是运行元数据（默认随运行实例生成，调用方可注入固定值使整条记录确定性可复现）。
 *
 * 铁律：纯函数、无 DB / 网络；无 Math.random（random 仅用 seedable PRNG 派生种子）；禁止
 * NaN / Infinity；失败响亮；mutation isolation（不修改入参）。
 */

import { randomBytes, createHash } from "node:crypto";
import {
  runParameterSearch,
  DEFAULT_RANDOM_SEARCH_BUDGET,
} from "../parameterSearch";
import { calculateCombinationCount } from "../combinationGenerator";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { validateParameterSpace } from "../parameterSpace";
import { computeParameterSpaceFingerprint } from "../sweep";
import { canonicalStringify } from "../../researchDataset/version";
import { resolveRegionAnalysisConfig } from "../parameterSearch/region";
import { buildRollingOptimizationCandidates } from "./candidate";
import { computeRollingOptimizationRunFingerprint } from "./serialize";
import { analyzeRollingConsistency, resolveRollingStabilityConfig } from "./stability";
import {
  ROLLING_OPTIMIZATION_RUN_RECORD_KIND,
  ROLLING_OPTIMIZATION_RUN_RECORD_VERSION,
  ROLLING_OPTIMIZATION_RUN_ID_PREFIX,
  type RollingOptimizationRun,
  type RollingOptimizationRequest,
  type RollingOptimizationWindowEntry,
  type RollingWindowObservation,
} from "./types";
import {
  generateRollingOptimizationWindows,
  resolveRollingWindowConfig,
  validateRollingTradeDates,
} from "./windows";

// ---------------------------------------------------------------------------
// Run ID（运行元数据；风格对齐 parameterSearch generateSearchRunId）
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 组装 RollingOptimizationRun ID（`ROLLING-YYYYMMDD-XXXXXXXX`）。 */
export function formatRollingOptimizationRunId(date: string, suffix: string): string {
  return `${ROLLING_OPTIMIZATION_RUN_ID_PREFIX}-${date}-${suffix}`;
}

/** 生成 RollingOptimizationRun ID；注入 suffix 时（测试）确定性；属于运行元数据，允许随机后缀。 */
export function generateRollingOptimizationRunId(now: Date = new Date(), suffix?: string): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatRollingOptimizationRunId(date, resolvedSuffix);
}

/** 交易日历内容指纹：canonical JSON 摘要（sha256）。 */
function tradeDatesFingerprint(tradeDates: readonly string[]): string {
  return createHash("sha256").update(canonicalStringify(tradeDates), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 请求校验
// ---------------------------------------------------------------------------

/** 校验滚动优化请求；issues 为空即合法。 */
export function validateRollingOptimizationRequest(
  request: RollingOptimizationRequest,
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    issues.push({ code: "ROLLING_REQUEST_INVALID", path: "request", message: "request 必须是对象" });
    return issues;
  }
  if (typeof request.strategyId !== "string" || request.strategyId.trim() === "") {
    issue("ROLLING_STRATEGY_ID_EMPTY", "strategyId", "strategyId 不能为空");
  }
  if (typeof request.strategyVersion !== "string" || request.strategyVersion.trim() === "") {
    issue("ROLLING_STRATEGY_VERSION_EMPTY", "strategyVersion", "strategyVersion 不能为空");
  }
  if (request.method !== "grid" && request.method !== "random") {
    issue("ROLLING_METHOD_INVALID", "method", `method=${String(request.method)} 非法（期望 grid | random）`);
  }
  const spaceValidation = validateParameterSpace(request.parameterSpace);
  if (!spaceValidation.valid) {
    issues.push(...spaceValidation.issues);
  }
  const dateValidation = validateRollingTradeDates(request.tradeDates);
  if (!dateValidation.valid) {
    issues.push(...dateValidation.issues);
  }
  if (typeof request.evaluatorFactory !== "function") {
    issue("ROLLING_EVALUATOR_FACTORY_INVALID", "evaluatorFactory", "evaluatorFactory 必须是函数");
  }
  if (request.windowConfig === undefined) {
    issue("ROLLING_WINDOW_CONFIG_MISSING", "windowConfig", "windowConfig 必填（windowLength / stepLength 无缺省值）");
  }
  if (request.method === "random") {
    if (request.seed === undefined) {
      issue("ROLLING_SEED_MISSING", "seed", "random 搜索必须提供整数 seed");
    } else if (!Number.isInteger(request.seed)) {
      issue("ROLLING_SEED_INVALID", "seed", `seed 必须是整数，实际 ${String(request.seed)}`);
    }
    if (request.budget !== undefined && (!Number.isInteger(request.budget) || request.budget < 1)) {
      issue("ROLLING_BUDGET_INVALID", "budget", `budget 必须是 >= 1 的整数，实际 ${String(request.budget)}`);
    }
  }
  if (request.method === "grid" && request.maxCombinations !== undefined
    && (!Number.isInteger(request.maxCombinations) || request.maxCombinations < 1)) {
    issue("ROLLING_MAX_COMBINATIONS_INVALID", "maxCombinations", `maxCombinations 必须是 >= 1 的整数，实际 ${String(request.maxCombinations)}`);
  }
  if (request.runId !== undefined && (typeof request.runId !== "string" || request.runId.trim() === "")) {
    issue("ROLLING_RUN_ID_INVALID", "runId", "runId 必须是非空字符串");
  }
  if (request.createdAt !== undefined && (typeof request.createdAt !== "string" || request.createdAt.trim() === "")) {
    issue("ROLLING_CREATED_AT_INVALID", "createdAt", "createdAt 必须是非空字符串（ISO-8601 UTC）");
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 执行一次 Rolling Optimization，产出完整 RollingOptimizationRun 记录。 */
export function runRollingOptimization(request: RollingOptimizationRequest): RollingOptimizationRun {
  const requestIssues = validateRollingOptimizationRequest(request);
  const windowConfigResult = resolveRollingWindowConfig(request.windowConfig);
  const windowConfigIssues = windowConfigResult.config === null ? windowConfigResult.issues : [];
  const stabilityResult = resolveRollingStabilityConfig(request.stability);
  const analysisResult = resolveRegionAnalysisConfig(request.analysis);
  const combinedIssues = [
    ...requestIssues,
    ...windowConfigIssues,
    ...stabilityResult.issues,
    ...analysisResult.issues,
  ];
  if (combinedIssues.length > 0) {
    throw new ResearchValidationError(combinedIssues);
  }

  const analysisConfig = analysisResult.config;
  const stabilityConfig = stabilityResult.config;
  const windowConfig = windowConfigResult.config!;
  const runId = request.runId ?? generateRollingOptimizationRunId();
  const createdAt = request.createdAt ?? new Date().toISOString();

  // ---- 窗口生成（交易日锚定；不足首个窗口 → 结构化抛错）----
  const windows = generateRollingOptimizationWindows(request.tradeDates, windowConfig);

  // ---- 逐窗搜索（复用 C-17.1 runParameterSearch；确定性 searchRunId / 派生种子）----
  const windowEntries: RollingOptimizationWindowEntry[] = [];
  for (const window of windows) {
    const windowId = `${runId}-w${window.windowIndex}`;
    const searchRunId = `${runId}-w${window.windowIndex}-search`;
    const windowEvaluator = request.evaluatorFactory({
      windowId,
      windowIndex: window.windowIndex,
      tradeDates: window.tradeDates,
      firstTradeDate: window.firstTradeDate,
      lastTradeDate: window.lastTradeDate,
      tradeDayCount: window.tradeDayCount,
    });
    const searchRun = runParameterSearch({
      strategyId: request.strategyId,
      strategyVersion: request.strategyVersion,
      method: request.method,
      parameterSpace: request.parameterSpace,
      evaluator: windowEvaluator,
      seed: request.method === "random" ? (request.seed! + window.windowIndex) : undefined,
      budget: request.budget,
      maxCombinations: request.maxCombinations,
      analysis: request.analysis,
      searchRunId,
      createdAt,
    });
    windowEntries.push({
      windowId,
      windowIndex: window.windowIndex,
      firstTradeDate: window.firstTradeDate,
      lastTradeDate: window.lastTradeDate,
      tradeDayCount: window.tradeDayCount,
      searchRun,
    });
  }

  // ---- 跨窗一致性判定 + 候选产出 ----
  const observations: RollingWindowObservation[] = windowEntries.map((entry) => ({
    windowId: entry.windowId,
    windowIndex: entry.windowIndex,
    evaluatedSamples: entry.searchRun.evaluatedSamples,
  }));
  const stability = analyzeRollingConsistency(observations, analysisConfig, stabilityConfig);
  const candidates = buildRollingOptimizationCandidates({
    runId,
    strategyId: request.strategyId,
    strategyVersion: request.strategyVersion,
    report: stability,
    config: stabilityConfig,
  });

  const parameterSpaceFingerprint = computeParameterSpaceFingerprint(request.parameterSpace);
  const gridCombinationCount = calculateCombinationCount(request.parameterSpace);
  const body: Omit<RollingOptimizationRun, "fingerprint"> = {
    recordKind: ROLLING_OPTIMIZATION_RUN_RECORD_KIND,
    recordVersion: ROLLING_OPTIMIZATION_RUN_RECORD_VERSION,
    runId,
    strategyId: request.strategyId,
    strategyVersion: request.strategyVersion,
    method: request.method,
    seed: request.method === "random" ? request.seed! : null,
    requestedBudget: request.method === "random"
      ? (request.budget ?? DEFAULT_RANDOM_SEARCH_BUDGET)
      : gridCombinationCount,
    parameterSpace: request.parameterSpace,
    parameterSpaceFingerprint,
    tradeDates: [...request.tradeDates],
    tradeDatesFingerprint: tradeDatesFingerprint(request.tradeDates),
    windowConfig,
    analysisConfig,
    stabilityConfig,
    windowCount: windowEntries.length,
    windows: windowEntries,
    stability,
    candidates,
    createdAt,
  };
  const fingerprint = computeRollingOptimizationRunFingerprint(body);
  return { ...body, fingerprint };
}
