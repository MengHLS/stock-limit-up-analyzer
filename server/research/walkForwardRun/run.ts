/**
 * STEP 19 / C-19.1 — WFO 编排：Train → Optimize → Freeze → Test → Move Window。
 *
 * 编排流程（逐窗推进，全部同步、纯函数、evaluator 注入）：
 *   1. 校验请求（strategy 身份 / method / 参数空间 / 交易日历 / 窗口划分配置 / 稳定区口径 /
 *      冻结口径 / 两个 evaluator 工厂 / seed / budget / maxCombinations）；退化输入结构化抛错；
 *   2. 生成 Train/Test 成对窗口（windows.ts，交易日锚定；不足窗响亮报错）；
 *   3. **Train/Optimize**：复用 C-17.1 runParameterSearch 在 `optimizationDates`（已扣除
 *      embargo 尾部）上执行搜索（import 只读，不复制搜索逻辑）；窗上下文不含任何 test 数据；
 *   4. **Freeze**：从该窗稳定区合格成员取「下中位数」参数并深冻结（freeze.ts，显式非 argmax）；
 *      无合格成员 → 该窗 skipped（原因码 WFO19_NO_QUALIFIED_PARAMETERS），绝不静默；
 *   5. **Test/OOS**：以冻结参数的**深冻结副本**为唯一入参调用 test 评估器（test 上下文不含
 *      searchRun / 候选 / 参数空间）；实测 Object.isFrozen 记档；
 *   6. **Move Window**：推进下一窗（窗口几何由 step 决定，rolling 同步推进、anchored 扩张）；
 *   7. 组装 WalkForwardRun：身份 / 输入快照 / splitConfig / analysisConfig / freezeSelection /
 *      windows[] / freezeIntegrity（机器检查）/ aggregate（最小 OOS 聚合）/ createdAt / fingerprint。
 *
 * 确定性纪律：编排内容（窗口划分 + 逐窗采样与评估序 + 冻结选择 + OOS 绩效）由
 * (tradeDates, parameterSpace, method, seed, budget, analysis, splitConfig, freezeSelection)
 * 完全决定；runId / createdAt 是运行元数据（默认随运行实例生成，调用方可注入固定值使整条
 * 记录确定性可复现）。
 *
 * 铁律：无 DB / 网络；无 Math.random（random 仅用 seedable PRNG 派生种子）；无 Date.now 依赖
 * （createdAt 由调用方注入）；禁止 NaN / Infinity；失败响亮；不修改入参。
 * **不做 promotion**：本模块不产出候选策略记录、不含任何 lifecycle / Final|Production 语义。
 */

import { randomBytes, createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { calculateCombinationCount } from "../combinationGenerator";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import {
  DEFAULT_RANDOM_SEARCH_BUDGET,
  runParameterSearch,
} from "../parameterSearch";
import { validateParameterSearchMetrics } from "../parameterSearch/metrics";
import { resolveRegionAnalysisConfig } from "../parameterSearch/region";
import { rollingParameterSetKey } from "../rollingOptimization/stability";
import { validateParameterSpace } from "../parameterSpace";
import { computeParameterSpaceFingerprint } from "../sweep";
import type { ResearchParameterSet } from "../types";
import { computeWalkForwardAggregate } from "./aggregate";
import {
  assertWalkForwardFreezeDiscipline,
  deepFreezeParameterSet,
  selectWalkForwardFrozenParameters,
  verifyWalkForwardFreezeDiscipline,
} from "./freeze";
import { computeWalkForwardRunFingerprint } from "./serialize";
import {
  WALK_FORWARD_RUN_ID_PREFIX,
  WALK_FORWARD_RUN_RECORD_KIND,
  WALK_FORWARD_RUN_RECORD_VERSION,
  DEFAULT_WALK_FORWARD_FREEZE_SELECTION,
  type WalkForwardRequest,
  type WalkForwardRun,
  type WalkForwardSplit,
  type WalkForwardTestStage,
  type WalkForwardWindowRecord,
  type WalkForwardSkipReasonCode,
} from "./types";
import {
  generateWalkForwardSplits,
  resolveWalkForwardSplitConfig,
  validateWalkForwardTradeDates,
} from "./windows";

// ---------------------------------------------------------------------------
// Run ID（运行元数据；风格对齐 SEARCH-* / ROLLING-*）
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 组装 WalkForwardRun ID（`WFA-YYYYMMDD-XXXXXXXX`）。 */
export function formatWalkForwardRunId(date: string, suffix: string): string {
  return `${WALK_FORWARD_RUN_ID_PREFIX}-${date}-${suffix}`;
}

/** 生成 WalkForwardRun ID；注入 suffix 时（测试）确定性；属于运行元数据，允许随机后缀。 */
export function generateWalkForwardRunId(now: Date = new Date(), suffix?: string): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatWalkForwardRunId(date, resolvedSuffix);
}

/** 交易日历内容指纹：canonical JSON 摘要（sha256）。 */
function tradeDatesFingerprint(tradeDates: readonly string[]): string {
  return createHash("sha256").update(canonicalStringify(tradeDates), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 请求校验
// ---------------------------------------------------------------------------

/** 校验 WFO 请求；issues 为空即合法。 */
export function validateWalkForwardRequest(request: WalkForwardRequest): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    issue("WFO19_REQUEST_INVALID", "request", "request 必须是对象");
    return issues;
  }
  if (typeof request.strategyId !== "string" || request.strategyId.trim() === "") {
    issue("WFO19_STRATEGY_ID_EMPTY", "strategyId", "strategyId 不能为空");
  }
  if (typeof request.strategyVersion !== "string" || request.strategyVersion.trim() === "") {
    issue("WFO19_STRATEGY_VERSION_EMPTY", "strategyVersion", "strategyVersion 不能为空");
  }
  if (request.method !== "grid" && request.method !== "random") {
    issue("WFO19_METHOD_INVALID", "method", `method=${String(request.method)} 非法（期望 grid | random）`);
  }
  const spaceValidation = validateParameterSpace(request.parameterSpace);
  if (!spaceValidation.valid) {
    issues.push(...spaceValidation.issues);
  }
  const dateValidation = validateWalkForwardTradeDates(request.tradeDates);
  if (!dateValidation.valid) {
    issues.push(...dateValidation.issues);
  }
  if (typeof request.optimizeEvaluatorFactory !== "function") {
    issue("WFO19_OPTIMIZE_EVALUATOR_FACTORY_INVALID", "optimizeEvaluatorFactory", "optimizeEvaluatorFactory 必须是函数");
  }
  if (typeof request.testEvaluatorFactory !== "function") {
    issue("WFO19_TEST_EVALUATOR_FACTORY_INVALID", "testEvaluatorFactory", "testEvaluatorFactory 必须是函数");
  }
  if (request.splitConfig === undefined) {
    issue("WFO19_SPLIT_CONFIG_MISSING", "splitConfig", "splitConfig 必填（trainWindow / testWindow / step 无缺省值）");
  }
  if (request.freezeSelection !== undefined && request.freezeSelection !== "median-qualified") {
    issue("WFO19_FREEZE_SELECTION_INVALID", "freezeSelection", `freezeSelection=${String(request.freezeSelection)} 非法（期望 median-qualified）`);
  }
  if (request.method === "random") {
    if (request.seed === undefined) {
      issue("WFO19_SEED_MISSING", "seed", "random 搜索必须提供整数 seed");
    } else if (!Number.isInteger(request.seed)) {
      issue("WFO19_SEED_INVALID", "seed", `seed 必须是整数，实际 ${String(request.seed)}`);
    }
    if (request.budget !== undefined && (!Number.isInteger(request.budget) || request.budget < 1)) {
      issue("WFO19_BUDGET_INVALID", "budget", `budget 必须是 >= 1 的整数，实际 ${String(request.budget)}`);
    }
  }
  if (request.method === "grid" && request.maxCombinations !== undefined
    && (!Number.isInteger(request.maxCombinations) || request.maxCombinations < 1)) {
    issue("WFO19_MAX_COMBINATIONS_INVALID", "maxCombinations", `maxCombinations 必须是 >= 1 的整数，实际 ${String(request.maxCombinations)}`);
  }
  if (request.runId !== undefined && (typeof request.runId !== "string" || request.runId.trim() === "")) {
    issue("WFO19_RUN_ID_INVALID", "runId", "runId 必须是非空字符串");
  }
  if (request.createdAt !== undefined && (typeof request.createdAt !== "string" || request.createdAt.trim() === "")) {
    issue("WFO19_CREATED_AT_INVALID", "createdAt", "createdAt 必须是非空字符串（ISO-8601 UTC）");
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Test 阶段执行（冻结纪律的落点）
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function skippedTestStage(
  windowId: string,
  windowIndex: number,
  split: WalkForwardSplit,
  reasonCode: WalkForwardSkipReasonCode,
  error: string | null = null,
): WalkForwardTestStage {
  return {
    windowId,
    windowIndex,
    firstTestDate: split.firstTestDate,
    lastTestDate: split.lastTestDate,
    testDayCount: split.testDayCount,
    status: "skipped",
    parameterSet: null,
    parameterSetKey: null,
    parameterSetFrozen: null,
    totalReturnPct: null,
    maxDrawdownPct: null,
    tradeCount: null,
    error,
    skipReasonCode: reasonCode,
  };
}

/**
 * 执行 Test（OOS）阶段。
 *
 * 冻结纪律落点：
 *   - 唯一入参 = `frozenParameterSet` 的**深冻结副本**（deepFreezeParameterSet）；
 *   - 调用前实测 `Object.isFrozen` 并记档到 `parameterSetFrozen`；
 *   - 记录到 `parameterSetKey` 的是「实际传给评估器那个对象」的 canonical 键（不是从冻结
 *     记录抄过来的），供 verifyWalkForwardFreezeDiscipline 事后机器比对；
 *   - test 上下文不含 searchRun / 候选 / 参数空间（结构解耦，见 types.ts）。
 */
function runTestStage(
  request: WalkForwardRequest,
  split: WalkForwardSplit,
  windowId: string,
  frozenParameterSet: ResearchParameterSet,
  lastTrainDate: string,
): WalkForwardTestStage {
  if (split.testDates.length === 0) {
    return skippedTestStage(windowId, split.windowIndex, split, "WFO19_TEST_WINDOW_EMPTY");
  }

  const testEvaluator = request.testEvaluatorFactory({
    windowId,
    windowIndex: split.windowIndex,
    mode: split.mode,
    testDates: split.testDates,
    firstTestDate: split.firstTestDate,
    lastTestDate: split.lastTestDate,
    testDayCount: split.testDayCount,
    lastTrainDate,
  });

  // 冻结纪律：交给 test 评估器的是深冻结副本，且实测记档。
  const passedParameterSet = deepFreezeParameterSet(frozenParameterSet);
  const frozenAtCall = Object.isFrozen(passedParameterSet);

  let outcome: ReturnType<typeof testEvaluator>;
  try {
    outcome = testEvaluator(passedParameterSet);
  } catch (error) {
    return skippedTestStage(
      windowId,
      split.windowIndex,
      split,
      "WFO19_TEST_EVALUATOR_THREW",
      `Test 评估器抛错：${errorMessage(error)}`,
    );
  }
  if (outcome.status === "failed") {
    return skippedTestStage(
      windowId,
      split.windowIndex,
      split,
      "WFO19_TEST_EVALUATION_FAILED",
      outcome.error.trim() === "" ? "Test 评估器返回空错误" : outcome.error,
    );
  }
  const metricError = validateParameterSearchMetrics(outcome.metrics);
  if (metricError !== null) {
    return skippedTestStage(
      windowId,
      split.windowIndex,
      split,
      "WFO19_TEST_METRICS_INVALID",
      `Test 评估产物非法：${metricError}`,
    );
  }

  return {
    windowId,
    windowIndex: split.windowIndex,
    firstTestDate: split.firstTestDate,
    lastTestDate: split.lastTestDate,
    testDayCount: split.testDayCount,
    status: "succeeded",
    parameterSet: passedParameterSet,
    parameterSetKey: rollingParameterSetKey(passedParameterSet),
    parameterSetFrozen: frozenAtCall,
    totalReturnPct: outcome.metrics.totalReturnPct,
    maxDrawdownPct: outcome.metrics.maxDrawdownPct,
    tradeCount: outcome.metrics.tradeCount,
    error: null,
    skipReasonCode: null,
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 执行一次 Walk-Forward Optimization，产出完整 WalkForwardRun 记录。 */
export function runWalkForward(request: WalkForwardRequest): WalkForwardRun {
  const requestIssues = validateWalkForwardRequest(request);
  const splitResult = resolveWalkForwardSplitConfig(request.splitConfig);
  const analysisResult = resolveRegionAnalysisConfig(request.analysis);
  const combinedIssues = [
    ...requestIssues,
    ...(splitResult.config === null ? splitResult.issues : []),
    ...analysisResult.issues,
  ];
  if (combinedIssues.length > 0) {
    throw new ResearchValidationError([...combinedIssues]);
  }

  const splitConfig = splitResult.config!;
  const analysisConfig = analysisResult.config;
  const freezeSelection = request.freezeSelection ?? DEFAULT_WALK_FORWARD_FREEZE_SELECTION;
  const runId = request.runId ?? generateWalkForwardRunId();
  const createdAt = request.createdAt ?? new Date().toISOString();

  // ---- 窗口划分（交易日锚定；不足首个完整窗口 → 结构化抛错）----
  const splits = generateWalkForwardSplits(request.tradeDates, request.splitConfig);

  // ---- 逐窗：Train/Optimize → Freeze → Test → Move Window ----
  const windows: WalkForwardWindowRecord[] = [];
  for (const split of splits) {
    const windowId = `${runId}-w${split.windowIndex}`;
    const searchRunId = `${runId}-w${split.windowIndex}-train`;

    // -- Train / Optimize：复用 C-17.1（上下文不含任何 test 数据）--
    const optimizeEvaluator = request.optimizeEvaluatorFactory({
      windowId,
      windowIndex: split.windowIndex,
      mode: split.mode,
      optimizationDates: split.optimizationDates,
      firstTrainDate: split.firstTrainDate,
      lastTrainDate: split.lastTrainDate,
      trainDayCount: split.trainDayCount,
      optimizationDayCount: split.optimizationDayCount,
      embargoDates: split.embargoDates,
      embargoDayCount: split.embargoDayCount,
    });
    const searchRun = runParameterSearch({
      strategyId: request.strategyId,
      strategyVersion: request.strategyVersion,
      method: request.method,
      parameterSpace: request.parameterSpace,
      evaluator: optimizeEvaluator,
      seed: request.method === "random" ? (request.seed! + split.windowIndex) : undefined,
      budget: request.budget,
      maxCombinations: request.maxCombinations,
      analysis: request.analysis,
      searchRunId,
      createdAt,
    });

    // -- Freeze：稳定区合格成员的下中位数，深冻结 --
    const freezeResult = selectWalkForwardFrozenParameters({
      searchRun,
      selection: freezeSelection,
      frozenAt: createdAt,
    });

    // -- Test / OOS：冻结参数为唯一输入 --
    const test = freezeResult.frozen === null
      ? skippedTestStage(windowId, split.windowIndex, split, freezeResult.reasonCode!)
      : runTestStage(request, split, windowId, freezeResult.frozen.parameterSet, split.lastTrainDate);

    windows.push({
      windowId,
      windowIndex: split.windowIndex,
      mode: split.mode,
      train: {
        windowId,
        windowIndex: split.windowIndex,
        mode: split.mode,
        trainStartIndex: split.trainStartIndex,
        firstTrainDate: split.firstTrainDate,
        lastTrainDate: split.lastTrainDate,
        trainDayCount: split.trainDayCount,
        optimizationDayCount: split.optimizationDayCount,
        embargoDayCount: split.embargoDayCount,
        firstOptimizationDate: split.optimizationDates[0] ?? split.firstTrainDate,
        lastOptimizationDate: split.optimizationDates[split.optimizationDates.length - 1] ?? split.lastTrainDate,
        searchRun,
      },
      frozen: freezeResult.frozen,
      test,
    });
  }

  const freezeIntegrity = verifyWalkForwardFreezeDiscipline(windows);

  const body: Omit<WalkForwardRun, "fingerprint"> = {
    recordKind: WALK_FORWARD_RUN_RECORD_KIND,
    recordVersion: WALK_FORWARD_RUN_RECORD_VERSION,
    runId,
    strategyId: request.strategyId,
    strategyVersion: request.strategyVersion,
    method: request.method,
    seed: request.method === "random" ? request.seed! : null,
    requestedBudget: request.method === "random"
      ? (request.budget ?? DEFAULT_RANDOM_SEARCH_BUDGET)
      : calculateCombinationCount(request.parameterSpace),
    parameterSpace: request.parameterSpace,
    parameterSpaceFingerprint: computeParameterSpaceFingerprint(request.parameterSpace),
    tradeDates: [...request.tradeDates],
    tradeDatesFingerprint: tradeDatesFingerprint(request.tradeDates),
    splitConfig,
    analysisConfig,
    freezeSelection,
    windowCount: windows.length,
    windows,
    freezeIntegrity,
    aggregate: computeWalkForwardAggregate(windows),
    createdAt,
  };
  const fingerprint = computeWalkForwardRunFingerprint(body);
  const run: WalkForwardRun = { ...body, fingerprint };

  // 出口断言：冻结纪律必须成立（violations 非空 → 响亮抛错，不产出可疑记录）。
  assertWalkForwardFreezeDiscipline(windows);
  return run;
}
