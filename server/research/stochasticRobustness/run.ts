/**
 * STEP 18 / C-18.2 — 随机化鲁棒性运行编排（Monte Carlo / Bootstrap / Trade Order）。
 *
 * 主入口 `runStochasticRobustness`：请求 → 完整 `StochasticRobustnessRun` 记录。
 *   1. 校验请求（身份 / runId / createdAt / method / seed / iterations / alpha /
 *      年化因子 / 尾部阈值 / 序列合法性）—— 退化输入结构化抛错（ResearchValidationError），
 *      禁止静默降级；
 *   2. 解析口径（resolveStochasticConfig）：确定 method → 源序列 → tradeCount →
 *      基准绩效（调用方注入优先，否则按内置确定性复利口径计算）；
 *   3. 生成 seeded 样本（MC / Bootstrap = 有放回重抽样，Trade Order = 无放回置换）；
 *   4. 逐样本统计（缺省内置复利统计；调用方可注入 evaluator 接真实模拟器）；
 *      evaluator 抛错 / 返回非法标量 → 该样本转记 failed（结构化可见，不静默吞掉）；
 *   5. 分布摘要 + 尾部概率 + 基准位置（distribution.ts）；
 *   6. 结论（verdict.ts，阈值复用 C-18.1 resolveRobustnessThresholds）+ 指纹 + 冻结。
 *
 * 确定性纪律：无 Date.now / Math.random / IO；`stochasticRunId` / `createdAt` 由调用方
 * 注入；同请求（含同 evaluator）必得同记录同指纹。
 */

import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import { resolveRobustnessThresholds } from "../robustness/drift";
import { assessStochasticBootstrapSignificance, generateBootstrapSpecimens } from "./bootstrap";
import {
  computeStochasticTailProbabilities,
  summarizeStochasticDistribution,
} from "./distribution";
import { resolveStochasticMonteCarloSource, generateMonteCarloSpecimens } from "./monteCarlo";
import {
  computeStochasticPathMetrics,
  validateStochasticMetricsView,
  validateStochasticSeries,
} from "./statistics";
import {
  assertStochasticOrderTotalReturnInvariant,
  generateTradeOrderSpecimens,
} from "./tradeOrder";
import {
  computeStochasticDrawFingerprint,
  computeStochasticInputFingerprint,
  computeStochasticRunFingerprint,
} from "./serialize";
import { buildStochasticConclusion } from "./verdict";
import {
  STOCHASTIC_DEFAULT_ALPHA,
  STOCHASTIC_DEFAULT_ANNUALIZATION_FACTOR,
  STOCHASTIC_DEFAULT_ITERATIONS,
  STOCHASTIC_DEFAULT_MIN_ITERATIONS_FOR_VERDICT,
  STOCHASTIC_DEFAULT_TAIL_DRAWDOWN_THRESHOLD_PCT,
  STOCHASTIC_METHOD_BOOTSTRAP,
  STOCHASTIC_METHOD_MONTE_CARLO,
  STOCHASTIC_METHOD_ORDER_RANDOMIZATION,
  STOCHASTIC_ROBUSTNESS_RUN_ID_PREFIX,
  STOCHASTIC_ROBUSTNESS_RUN_RECORD_KIND,
  STOCHASTIC_ROBUSTNESS_RUN_RECORD_VERSION,
  type StochasticBootstrapSignificance,
  type StochasticDistributionSummary,
  type StochasticIterationSample,
  type StochasticMetricsView,
  type StochasticResolvedConfig,
  type StochasticRobustnessRequest,
  type StochasticRobustnessRun,
  type StochasticSourceKind,
  type StochasticSpecimen,
  type StochasticTailProbabilities,
} from "./types";

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** 生成确定性 run id（`STOCH-MC-<seed>` / `STOCH-BOOT-<seed>` / `STOCH-ORD-<seed>`）。 */
export function generateStochasticRobustnessRunId(
  method: StochasticRobustnessRequest["method"],
  seed: number
): string {
  const short =
    method === STOCHASTIC_METHOD_MONTE_CARLO
      ? "MC"
      : method === STOCHASTIC_METHOD_BOOTSTRAP
        ? "BOOT"
        : "ORD";
  return `${STOCHASTIC_ROBUSTNESS_RUN_ID_PREFIX}-${short}-${seed}`;
}

// ---------------------------------------------------------------------------
// 配置解析
// ---------------------------------------------------------------------------

/** 解析结果：配置 + 实际源序列 + 成交笔数 + 基准绩效。 */
export interface StochasticResolvedRunContext {
  readonly config: StochasticResolvedConfig;
  readonly source: readonly number[];
  readonly tradeCount: number | null;
  readonly baseline: StochasticMetricsView;
}

/**
 * 解析运行口径（独立可测）：method → 源序列 → tradeCount → 基准绩效。
 * 退化/非法输入一律 ResearchValidationError（FAIL FAST，不 clamp、不静默降级）。
 */
export function resolveStochasticRunContext(
  request: StochasticRobustnessRequest
): StochasticResolvedRunContext {
  const problems: ResearchValidationIssue[] = [];
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new ResearchValidationError([issue("STOCH18_REQUEST_INVALID", "request", "request 必须是对象")]);
  }
  for (const field of ["strategyId", "strategyVersion", "stochasticRunId", "createdAt"] as const) {
    const value = (request as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || (value as string).trim() === "") {
      problems.push(issue("STOCH18_REQUEST_FIELD_EMPTY", field, `${field} 必须是非空字符串`));
    }
  }
  const method = request.method;
  if (method !== STOCHASTIC_METHOD_MONTE_CARLO && method !== STOCHASTIC_METHOD_BOOTSTRAP && method !== STOCHASTIC_METHOD_ORDER_RANDOMIZATION) {
    throw new ResearchValidationError([
      issue("STOCH18_METHOD_INVALID", "method", `method=${String(method)} 非法（期望 monteCarlo | bootstrap | orderRandomization）`),
    ]);
  }
  if (!Number.isInteger(request.seed)) {
    problems.push(issue("STOCH18_SEED_INVALID", "seed", `seed 必须是整数，实际 ${String(request.seed)}`));
  }

  const iterations = request.iterations ?? STOCHASTIC_DEFAULT_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 1) {
    problems.push(issue("STOCH18_ITERATIONS_INVALID", "iterations", `iterations 必须是 >= 1 的整数，实际 ${String(iterations)}`));
  }
  const alpha = request.alpha ?? STOCHASTIC_DEFAULT_ALPHA;
  if (typeof alpha !== "number" || !Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    problems.push(issue("STOCH18_ALPHA_INVALID", "alpha", `alpha 必须位于 (0, 1)，实际 ${String(alpha)}`));
  }
  const annualizationFactor = request.annualizationFactor ?? STOCHASTIC_DEFAULT_ANNUALIZATION_FACTOR;
  if (typeof annualizationFactor !== "number" || !Number.isFinite(annualizationFactor) || annualizationFactor <= 0) {
    problems.push(issue("STOCH18_ANNUALIZATION_INVALID", "annualizationFactor", `annualizationFactor 必须 > 0，实际 ${String(annualizationFactor)}`));
  }
  const tailDrawdownThresholdPct =
    request.tailDrawdownThresholdPct ?? STOCHASTIC_DEFAULT_TAIL_DRAWDOWN_THRESHOLD_PCT;
  if (typeof tailDrawdownThresholdPct !== "number" || !Number.isFinite(tailDrawdownThresholdPct) || tailDrawdownThresholdPct < 0) {
    problems.push(issue("STOCH18_TAIL_THRESHOLD_INVALID", "tailDrawdownThresholdPct", `tailDrawdownThresholdPct 必须 >= 0，实际 ${String(tailDrawdownThresholdPct)}`));
  }
  const minIterationsForVerdict =
    request.minIterationsForVerdict ?? STOCHASTIC_DEFAULT_MIN_ITERATIONS_FOR_VERDICT;
  if (!Number.isInteger(minIterationsForVerdict) || minIterationsForVerdict < 1) {
    problems.push(issue("STOCH18_MIN_ITERATIONS_INVALID", "minIterationsForVerdict", `minIterationsForVerdict 必须是 >= 1 的整数，实际 ${String(minIterationsForVerdict)}`));
  }
  if (request.evaluator !== undefined && typeof request.evaluator !== "function") {
    problems.push(issue("STOCH18_EVALUATOR_INVALID", "evaluator", "evaluator 必须是函数"));
  }
  if (problems.length > 0) {
    throw new ResearchValidationError(problems);
  }

  const thresholds = resolveRobustnessThresholds(request.thresholds);

  // ---- 源序列选择（按方法；缺失 → 响亮失败，不静默降级） ----
  let sourceKind: StochasticSourceKind;
  let source: readonly number[];
  if (method === STOCHASTIC_METHOD_MONTE_CARLO) {
    const resolved = resolveStochasticMonteCarloSource(request);
    sourceKind = resolved.sourceKind;
    source = resolved.source;
  } else {
    if (!Array.isArray(request.tradeReturns)) {
      throw new ResearchValidationError([
        issue(
          "STOCH18_TRADE_RETURNS_MISSING",
          "tradeReturns",
          `${method} 需要 trade 级收益序列（bootstrap / orderRandomization 不支持日收益 i.i.d. 重抽样：会破坏自相关与波动率聚集，block bootstrap 未实现）`
        ),
      ]);
    }
    sourceKind = "tradeReturn";
    source = request.tradeReturns;
  }

  const seriesProblem = validateStochasticSeries(source, sourceKind === "dailyReturn" ? "dailyReturns" : "tradeReturns");
  if (seriesProblem !== null) {
    throw new ResearchValidationError([
      issue(
        sourceKind === "dailyReturn" ? "STOCH18_DAILY_RETURNS_INVALID" : "STOCH18_TRADE_RETURNS_INVALID",
        sourceKind === "dailyReturn" ? "dailyReturns" : "tradeReturns",
        seriesProblem
      ),
    ]);
  }

  const tradeCount =
    request.tradeCount === undefined
      ? sourceKind === "tradeReturn"
        ? source.length
        : null
      : request.tradeCount;

  // ---- 基准绩效（注入优先，否则按内置口径计算） ----
  let baseline: StochasticMetricsView;
  if (request.baseline !== undefined && request.baseline !== null) {
    const baselineProblem = validateStochasticMetricsView(request.baseline);
    if (baselineProblem !== null) {
      throw new ResearchValidationError([
        issue("STOCH18_BASELINE_INVALID", "baseline", `注入的基准绩效非法：${baselineProblem}`),
      ]);
    }
    baseline = request.baseline;
  } else {
    baseline = computeStochasticPathMetrics({
      stepReturns: source,
      sourceKind,
      annualizationFactor,
      tradeCount,
    });
  }

  const config: StochasticResolvedConfig = {
    method,
    iterations,
    alpha,
    confidenceLevelPct: (1 - alpha) * 100,
    annualizationFactor,
    sourceKind,
    sourceLength: source.length,
    tailDrawdownThresholdPct,
    minIterationsForVerdict,
    thresholds,
  };

  return { config, source, tradeCount, baseline };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 执行一次随机化鲁棒性测试，产出完整 StochasticRobustnessRun 记录。
 *
 * 契约：
 *   - 退化输入（空序列 / 单点序列 / 非法 seed / 非法次数 / 收益 <= -100% /
 *     缺失必需序列）→ ResearchValidationError，不产出半成品记录；
 *   - 成功样本不足判定门槛 → verdict="inconclusive"（结构化可见，非失败）。
 */
export function runStochasticRobustness(
  request: StochasticRobustnessRequest
): StochasticRobustnessRun {
  const context = resolveStochasticRunContext(request);
  const { config, source, tradeCount, baseline } = context;
  const method = config.method;

  // ---- 生成 seeded 样本 ----
  const specimens: readonly StochasticSpecimen[] =
    method === STOCHASTIC_METHOD_MONTE_CARLO
      ? generateMonteCarloSpecimens({
          seed: request.seed,
          iterations: config.iterations,
          source,
          sourceKind: config.sourceKind,
          tradeCount,
        })
      : method === STOCHASTIC_METHOD_BOOTSTRAP
        ? generateBootstrapSpecimens({
            seed: request.seed,
            iterations: config.iterations,
            tradeReturns: source,
            tradeCount,
          })
        : generateTradeOrderSpecimens({
            seed: request.seed,
            iterations: config.iterations,
            tradeReturns: source,
            tradeCount,
          });

  // ---- 逐样本统计 ----
  const samples: StochasticIterationSample[] = [];
  const succeeded: StochasticMetricsView[] = [];
  for (const specimen of specimens) {
    let metrics: StochasticMetricsView;
    try {
      metrics =
        request.evaluator !== undefined
          ? request.evaluator(specimen)
          : computeStochasticPathMetrics({
              stepReturns: specimen.stepReturns,
              sourceKind: config.sourceKind,
              annualizationFactor: config.annualizationFactor,
              tradeCount: specimen.tradeCount,
            });
    } catch (error) {
      samples.push({
        iteration: specimen.iteration,
        status: "failed",
        metrics: null,
        error: `评估器抛错：${errorMessage(error)}`,
        drawFingerprint: computeStochasticDrawFingerprint(specimen.drawIndexes),
      });
      continue;
    }
    const problem = validateStochasticMetricsView(metrics);
    if (problem !== null) {
      samples.push({
        iteration: specimen.iteration,
        status: "failed",
        metrics: null,
        error: `评估产物非法：${problem}`,
        drawFingerprint: computeStochasticDrawFingerprint(specimen.drawIndexes),
      });
      continue;
    }
    samples.push({
      iteration: specimen.iteration,
      status: "succeeded",
      metrics,
      error: null,
      drawFingerprint: computeStochasticDrawFingerprint(specimen.drawIndexes),
    });
    succeeded.push(metrics);
  }

  // ---- 顺序随机化的集合不变性守卫（仅内置统计口径成立；注入 evaluator 时跳过） ----
  if (method === STOCHASTIC_METHOD_ORDER_RANDOMIZATION && request.evaluator === undefined && succeeded.length > 0) {
    assertStochasticOrderTotalReturnInvariant(succeeded);
  }

  // ---- 分布 / 尾部 / 结论 ----
  const distribution: StochasticDistributionSummary | null =
    succeeded.length > 0
      ? summarizeStochasticDistribution({
          samples: succeeded,
          baseline,
          alpha: config.alpha,
        })
      : null;
  const tailProbabilities: StochasticTailProbabilities | null =
    succeeded.length > 0
      ? computeStochasticTailProbabilities({
          samples: succeeded,
          drawdownThresholdPct: config.tailDrawdownThresholdPct,
        })
      : null;
  const bootstrapSignificance: StochasticBootstrapSignificance | null =
    method === STOCHASTIC_METHOD_BOOTSTRAP && distribution !== null
      ? assessStochasticBootstrapSignificance({
          totalReturn: distribution.totalReturnPct,
          alpha: config.alpha,
          baselineTotalReturnPct: baseline.totalReturnPct,
        })
      : null;

  const conclusion = buildStochasticConclusion({
    method,
    distribution,
    tailProbabilities,
    baseline,
    successCount: succeeded.length,
    failedCount: samples.length - succeeded.length,
    config,
  });

  const inputFingerprint = computeStochasticInputFingerprint({
    sourceKind: config.sourceKind,
    source,
    tradeCount,
    baseline,
  });

  const body: Omit<StochasticRobustnessRun, "fingerprint"> = {
    recordKind: STOCHASTIC_ROBUSTNESS_RUN_RECORD_KIND,
    recordVersion: STOCHASTIC_ROBUSTNESS_RUN_RECORD_VERSION,
    stochasticRunId: request.stochasticRunId,
    strategyId: request.strategyId,
    strategyVersion: request.strategyVersion,
    method,
    seed: request.seed,
    iterations: config.iterations,
    config,
    inputFingerprint,
    baseline,
    distribution,
    tailProbabilities,
    bootstrapSignificance,
    samples,
    conclusion,
    createdAt: request.createdAt,
  };
  const fingerprint = computeStochasticRunFingerprint(body);
  return deepFreeze<StochasticRobustnessRun>({ ...body, fingerprint });
}

// ---------------------------------------------------------------------------
// 便捷入口（强制 method，避免调用方传错字面量）
// ---------------------------------------------------------------------------

/** Monte Carlo 重采样（dailyReturn / tradeReturn 可选，见 monteCarlo.ts）。 */
export function runMonteCarloRobustness(
  request: Omit<StochasticRobustnessRequest, "method">
): StochasticRobustnessRun {
  return runStochasticRobustness({ ...request, method: STOCHASTIC_METHOD_MONTE_CARLO });
}

/** Bootstrap（trade 级有放回重抽样 → 置信区间 + 描述性显著性）。 */
export function runBootstrapRobustness(
  request: Omit<StochasticRobustnessRequest, "method">
): StochasticRobustnessRun {
  return runStochasticRobustness({ ...request, method: STOCHASTIC_METHOD_BOOTSTRAP });
}

/** Trade Order Randomization（成交顺序随机化 → 路径依赖 vs 集合依赖）。 */
export function runTradeOrderRandomization(
  request: Omit<StochasticRobustnessRequest, "method">
): StochasticRobustnessRun {
  return runStochasticRobustness({ ...request, method: STOCHASTIC_METHOD_ORDER_RANDOMIZATION });
}
