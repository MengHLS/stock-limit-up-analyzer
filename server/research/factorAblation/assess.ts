/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化：主编排（assessAblationRun）。
 *
 * 编排：
 *   1. 校验请求（身份 / 成分清单 / mode / order / evaluator / 阈值）；退化输入响亮抛错；
 *   2. 生成消融变体（variants.ts）；
 *   3. IS 轨逐变体注入式求值（isEvaluator）；base 失败 → 抛错（无归因锚点）；
 *   4. OOS 轨逐变体注入式求值（oosEvaluator，可选）；base 失败 → 抛错；
 *      **OOS 只读纪律**：components/order 在求值前已固定；本函数不存在任何
 *      「用 OOS 结果决定顺序/筛选目标」的代码路径；
 *   5. 计算双轨贡献 + OOS 退化信号候选（contribution.ts）；
 *   6. 组装 AblationAssessmentRun（is/oos/contributions/signals/reasonCode/reasons/
 *      thresholds/createdAt/fingerprint），深冻结。
 *
 * 铁律：纯函数、无 IO / Date.now / Math.random；evaluator 注入式；不修改入参。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import {
  ABLATION_ASSESSMENT_RUN_RECORD_KIND,
  ABLATION_ASSESSMENT_RUN_RECORD_VERSION,
  ABLATION_MODES,
  DEFAULT_OOS_NEUTRAL_CEILING_PCT,
  DEFAULT_IS_CONTRIBUTION_FLOOR_PCT,
  type AblationAssessmentRun,
  type AblationEvaluator,
  type AblationMetricsView,
  type AblationReasonCode,
  type AblationRequest,
  type AblationSampleOutcome,
  type AblationSampleResult,
  type AblationTarget,
  type AblationThresholds,
  type AblationTrackResult,
  type AblationVariantSpec,
  type ResolvedAblationThresholds,
} from "./types";
import { buildAblationVariants } from "./variants";
import { computeAblationContributions } from "./contribution";
import { computeAblationAssessmentRunFingerprint } from "./serialize";

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

// ---------------------------------------------------------------------------
// 阈值解析
// ---------------------------------------------------------------------------

/**
 * 解析消融信号阈值（缺省 = DEFAULT_IS_CONTRIBUTION_FLOOR_PCT / DEFAULT_OOS_NEUTRAL_CEILING_PCT）。
 * 非法（NaN/Infinity/负/上界 < 0）→ 响亮抛错，不 clamp。
 */
export function resolveAblationThresholds(
  thresholds: AblationThresholds | undefined,
): ResolvedAblationThresholds {
  const partial = thresholds ?? {};
  const problems: ResearchValidationIssue[] = [];
  const floor = partial.isContributionFloorPct ?? DEFAULT_IS_CONTRIBUTION_FLOOR_PCT;
  const ceiling = partial.oosNeutralCeilingPct ?? DEFAULT_OOS_NEUTRAL_CEILING_PCT;
  if (!Number.isFinite(floor) || floor <= 0) {
    problems.push(issue("ABL_THRESHOLD_FLOOR_INVALID", "thresholds.isContributionFloorPct",
      `isContributionFloorPct 必须是 > 0 的有限数字（实际 ${String(floor)}）`));
  }
  if (!Number.isFinite(ceiling) || ceiling < 0) {
    problems.push(issue("ABL_THRESHOLD_CEILING_INVALID", "thresholds.oosNeutralCeilingPct",
      `oosNeutralCeilingPct 必须是 >= 0 的有限数字（实际 ${String(ceiling)}）`));
  }
  if (problems.length > 0) throw new ResearchValidationError(problems);
  return {
    isContributionFloorPct: floor,
    oosNeutralCeilingPct: ceiling,
  };
}

// ---------------------------------------------------------------------------
// 指标校验（产物进样本前复核；失败响亮，不静默转 null）
// ---------------------------------------------------------------------------

function validateMetrics(metrics: AblationMetricsView): string | null {
  if (metrics === null || typeof metrics !== "object") {
    return "评估产物 metrics 必须是对象";
  }
  if (typeof metrics.totalReturnPct !== "number" || !Number.isFinite(metrics.totalReturnPct)) {
    return "评估产物 totalReturnPct 必须为有限数字";
  }
  if (typeof metrics.maxDrawdownPct !== "number" || !Number.isFinite(metrics.maxDrawdownPct)) {
    return "评估产物 maxDrawdownPct 必须为有限数字";
  }
  if (metrics.maxDrawdownPct < 0) {
    return `评估产物 maxDrawdownPct=${metrics.maxDrawdownPct} 不能为负`;
  }
  if (metrics.tradeCount !== null && (!Number.isInteger(metrics.tradeCount) || metrics.tradeCount < 0)) {
    return `评估产物 tradeCount=${String(metrics.tradeCount)} 必须是 null 或 >= 0 整数`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 单轨求值
// ---------------------------------------------------------------------------

/** 单轨（IS 或 OOS）逐变体求值（每个变体 evaluator 恰调用一次）；base 失败 → 响亮抛错。 */
function evaluateAblationTrack(
  track: "IS" | "OOS",
  variants: readonly AblationVariantSpec[],
  evaluator: AblationEvaluator,
): AblationTrackResult {
  if (typeof evaluator !== "function") {
    throw new ResearchValidationError([
      issue("ABL_EVALUATOR_INVALID", `${track.toLowerCase()}Evaluator`,
        `${track} 评估器必须是函数`),
    ]);
  }
  // 先求值 base（index 0）；失败 → 抛错（漂移/贡献无锚点）。base 评估成功后才能算 delta。
  const baseResult = evaluateVariantOnce(variants[0]!, evaluator, null);
  if (baseResult.status !== "succeeded" || baseResult.metrics === null) {
    throw new ResearchValidationError([
      issue(track === "IS" ? "ABL_IS_BASE_FAILED" : "ABL_OOS_BASE_FAILED", `${track}.base`,
        `${track} 轨 base 变体评估失败：${baseResult.error ?? "评估产物非法"}`),
    ]);
  }

  const samples: AblationSampleResult[] = [baseResult];
  for (const variant of variants.slice(1)) {
    samples.push(evaluateVariantOnce(variant, evaluator, baseResult.metrics));
  }

  const nonBase = samples.filter((sample) => !sample.variant.isBase);
  return {
    track,
    samples,
    baseSucceeded: samples[0]?.status === "succeeded",
    evaluatedCount: nonBase.filter((sample) => sample.status === "succeeded").length,
    failedCount: nonBase.filter((sample) => sample.status === "failed").length,
  };
}

/** 求值单个变体（一次调用）：catch 抛错 / failed / 产物非法 → 该样本转记 failed。 */
function evaluateVariantOnce(
  variant: AblationVariantSpec,
  evaluator: AblationEvaluator,
  baseMetrics: AblationMetricsView | null,
): AblationSampleResult {
  let outcome: AblationSampleOutcome;
  try {
    outcome = evaluator(variant);
  } catch (error) {
    return sampleResult(variant, {
      status: "failed",
      error: `评估器抛错：${errorMessage(error)}`,
    }, baseMetrics);
  }
  if (outcome === null || typeof outcome !== "object") {
    return sampleResult(variant, {
      status: "failed",
      error: "评估器返回非法产物（非对象）",
    }, baseMetrics);
  }
  if (outcome.status === "failed") {
    return sampleResult(variant, {
      status: "failed",
      error: outcome.error.trim() === "" ? "评估器返回空错误" : outcome.error,
    }, baseMetrics);
  }
  const metricProblem = validateMetrics(outcome.metrics);
  if (metricProblem !== null) {
    return sampleResult(variant, {
      status: "failed",
      error: `评估产物非法：${metricProblem}`,
    }, baseMetrics);
  }
  return sampleResult(variant, {
    status: "succeeded",
    metrics: outcome.metrics,
    error: null,
  }, baseMetrics);
}

function sampleResult(
  variant: AblationVariantSpec,
  outcome: { status: "succeeded"; metrics: AblationMetricsView; error: null }
    | { status: "failed"; error: string },
  baseMetrics: AblationMetricsView | null,
): AblationSampleResult {
  if (outcome.status === "failed") {
    return {
      variant,
      status: "failed",
      metrics: null,
      error: outcome.error,
      absoluteDeltaPct: null,
      relativeDeltaPct: null,
    };
  }
  const metrics = outcome.metrics;
  let absoluteDeltaPct: number | null = null;
  let relativeDeltaPct: number | null = null;
  if (baseMetrics !== null && !variant.isBase) {
    absoluteDeltaPct = metrics.totalReturnPct - baseMetrics.totalReturnPct;
    if (Math.abs(baseMetrics.totalReturnPct) >= 1e-9) {
      relativeDeltaPct = (absoluteDeltaPct / baseMetrics.totalReturnPct) * 100;
    }
  }
  return {
    variant,
    status: "succeeded",
    metrics,
    error: null,
    absoluteDeltaPct,
    relativeDeltaPct,
  };
}

// ---------------------------------------------------------------------------
// 审计文本
// ---------------------------------------------------------------------------

function buildReasons(
  mode: string,
  components: readonly AblationTarget[],
  is: AblationTrackResult,
  oos: AblationTrackResult | null,
  thresholds: ResolvedAblationThresholds,
  signalsCount: number,
  reasonCode: AblationReasonCode | null,
): readonly string[] {
  const reasons: string[] = [];
  const baseIs = is.samples[0];
  const baseMetrics = baseIs?.status === "succeeded" && baseIs.metrics !== null ? baseIs.metrics : null;
  if (baseMetrics !== null) {
    reasons.push(
      `IS 轨 base（${mode}）绩效：totalReturn=${baseMetrics.totalReturnPct.toFixed(2)}%, maxDD=${baseMetrics.maxDrawdownPct.toFixed(2)}%`,
    );
  }
  if (oos !== null) {
    const baseOos = oos.samples[0];
    const oosMetrics = baseOos?.status === "succeeded" && baseOos.metrics !== null ? baseOos.metrics : null;
    if (oosMetrics !== null) {
      reasons.push(
        `OOS 轨 base 绩效：totalReturn=${oosMetrics.totalReturnPct.toFixed(2)}%, maxDD=${oosMetrics.maxDrawdownPct.toFixed(2)}%`,
      );
    }
  } else {
    reasons.push("OOS 轨未注入评估器 → IS/OOS 对照与过拟合信号候选 unassessed（ABL_NO_OOS_TRACK）");
  }
  reasons.push(
    `成分数 = ${components.length}；模式 = ${mode}；可评估非 base 变体 IS=${is.evaluatedCount}/${components.length}`
    + (oos !== null ? `，OOS=${oos.evaluatedCount}/${components.length}` : ""),
  );
  reasons.push(
    `信号阈值：isContributionFloor=${thresholds.isContributionFloorPct.toFixed(2)}pp, `
    + `oosNeutralCeiling=${thresholds.oosNeutralCeilingPct.toFixed(2)}pp`,
  );
  reasons.push(
    signalsCount > 0
      ? `过拟合信号候选 = ${signalsCount} 个（描述性；不下因果/聚合结论）`
      : "过拟合信号候选 = 0 个",
  );
  if (reasonCode !== null) reasons.push(`未评估原因：${reasonCode}`);
  reasons.push("贡献排序为描述性归因（显式非单点 argmax），不用于自动剔除/重训/改参");
  return reasons;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 执行一次因子消融 + IS/OOS 退化评估，产出完整 AblationAssessmentRun 记录。
 *
 * 退化输入（全部响亮抛错）：
 *   - 请求非对象 / 身份字段空 / components 空 / 成分数 < 2 / id 重复 / kind 非法；
 *   - mode 非法 / 顺序非全排列（CUMULATIVE_REMOVE / FORWARD_ADD）；
 *   - 阈值非法（非有限 / floor <= 0 / ceiling < 0）；
 *   - IS 或 OOS（若注入）轨 base 变体评估失败。
 *
 * 非抛错 unassessed（显式 reasonCode）：无 OOS 轨 → ABL_NO_OOS_TRACK；
 * IS 轨全部非 base 变体失败 → ABL_NO_IS_VARIANTS；OOS 轨全部非 base 变体失败 → ABL_NO_OOS_VARIANTS。
 */
export function assessAblationRun(request: AblationRequest): AblationAssessmentRun {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new ResearchValidationError([
      issue("ABL_REQUEST_INVALID", "request", "request 必须是对象"),
    ]);
  }
  const problems: ResearchValidationIssue[] = [];
  for (const field of ["strategyId", "strategyVersion", "ablationRunId", "createdAt"] as const) {
    const value = (request as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || (value as string).trim() === "") {
      problems.push(issue("ABL_REQUEST_FIELD_EMPTY", field, `${field} 必须是非空字符串`));
    }
  }
  if (typeof request.mode !== "string" || !ABLATION_MODES.includes(request.mode as never)) {
    problems.push(issue("ABL_MODE_INVALID", "mode", `mode=${String(request.mode)} 非法`));
  }
  if (typeof request.isEvaluator !== "function") {
    problems.push(issue("ABL_EVALUATOR_INVALID", "isEvaluator", "isEvaluator 必须是函数"));
  }
  if (request.oosEvaluator !== undefined && request.oosEvaluator !== null
    && typeof request.oosEvaluator !== "function") {
    problems.push(issue("ABL_EVALUATOR_INVALID", "oosEvaluator",
      "oosEvaluator 必须是函数或 null/undefined"));
  }
  if (problems.length > 0) {
    throw new ResearchValidationError(problems);
  }

  const thresholds = resolveAblationThresholds(request.thresholds);
  const variants = buildAblationVariants({
    mode: request.mode,
    components: request.components,
    order: request.order,
  });

  // ---- 双轨求值（顺序在求值前已固定：OOS 只读，不参与任何目标筛选/排序） ----
  const is = evaluateAblationTrack("IS", variants, request.isEvaluator);
  const oos = request.oosEvaluator === undefined || request.oosEvaluator === null
    ? null
    : evaluateAblationTrack("OOS", variants, request.oosEvaluator);

  const { contributions, signals } = computeAblationContributions({
    mode: request.mode,
    components: request.components,
    is,
    oos,
    thresholds,
  });

  // ---- 记录级未评估原因码（优先级：IS 无可归因变体 > 无 OOS 轨 > OOS 无可归因变体） ----
  let unassessedReasonCode: AblationReasonCode | null = null;
  if (is.evaluatedCount === 0) {
    unassessedReasonCode = "ABL_NO_IS_VARIANTS";
  } else if (oos === null) {
    unassessedReasonCode = "ABL_NO_OOS_TRACK";
  } else if (oos.evaluatedCount === 0) {
    unassessedReasonCode = "ABL_NO_OOS_VARIANTS";
  }

  const reasons = buildReasons(
    request.mode,
    request.components,
    is,
    oos,
    thresholds,
    signals.length,
    unassessedReasonCode,
  );

  const body: Omit<AblationAssessmentRun, "fingerprint"> = {
    recordKind: ABLATION_ASSESSMENT_RUN_RECORD_KIND,
    recordVersion: ABLATION_ASSESSMENT_RUN_RECORD_VERSION,
    ablationRunId: request.ablationRunId,
    strategyId: request.strategyId,
    strategyVersion: request.strategyVersion,
    mode: request.mode,
    components: request.components,
    order: request.order ?? null,
    thresholds,
    is,
    oos,
    contributions,
    signals,
    oosAssessed: oos !== null && is.evaluatedCount > 0 && oos.evaluatedCount > 0,
    unassessedReasonCode,
    reasons,
    createdAt: request.createdAt,
  };
  const fingerprint = computeAblationAssessmentRunFingerprint(body);
  return deepFreeze<AblationAssessmentRun>({ ...body, fingerprint });
}
