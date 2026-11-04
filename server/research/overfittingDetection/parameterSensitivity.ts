/**
 * STEP 20 / C-20.1 — 参数敏感性（Parameter Sensitivity）。
 *
 * 定位：
 *   - **在固定 OOS 集合上**对参数做局部邻域扰动，重估绩效，观察敏感度——
 *     **不是**「在 OOS 上重训」（重训属 C-17.2 跨窗一致性）；
 *   - 扰动集合**直接 import 复用** C-18.1 `generateParameterPerturbationVariants`——
 *     不再自造，避免重复实现 ±%/±档 邻域几何；
 *   - 敏感度判定沿用 C-18.1 阈值语义（收益 5pp / 回撤 3pp），但**只 import 类型与缺省
 *     常量**，不 import 其实现（域耦合最小化）。
 *
 * 算法：
 *   1. 复用 C-18.1 `generateParameterPerturbationVariants(base, { rules })` 产出扰动清单
 *      （axis="parameter"，索引 0 = baseline）；
 *   2. 逐条扰动调 evaluator 注入式评估（evaluator 由调用方提供，本模块不执行 IO / 回测）；
 *   3. 基准条目评估失败 → 结构化抛错（PS_BASELINE_FAILED，拒绝产出无意义结果）；
 *   4. 逐非基准条目：相对基准的收益漂移 / 回撤恶化 → 命中阈值 → "sensitive"，否则 "stable"；
 *   5. 聚合：敏感度度量（max 偏离 / σ / CV / 弹性）+ 判定结论。
 *
 * 边界：
 *   - 只对**数值**参数做扰动；非数值参数被 C-18.1 生成器结构化跳过，本模块尊重跳过结果；
 *   - rules 为空 → 仅产出 baseline → NO_VARIANTS + PS_RULES_EMPTY；
 *   - 全部扰动被生成器跳过 → NO_VARIANTS + PS_ALL_PERTURBATIONS_SKIPPED；
 *   - 全部非基准扰动评估失败 → INCONCLUSIVE + PS_ALL_PERTURBATIONS_FAILED；
 *   - 敏感度度量**仅描述性**——不下「稳定性评分」式单一数字（无统计依据时不可编造）。
 *
 * 铁律：纯函数、确定性、只读入参、无 IO / Date.now / Math.random；返回独立副本。
 */

import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import {
  DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
  DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
  type PerturbationItem,
  type RobustnessEvaluator,
  type RobustnessMetricsView,
  generateParameterPerturbationVariants,
} from "../robustness";
import type { ResearchParameterSet } from "../types";
import {
  PARAMETER_SENSITIVITY_RECORD_VERSION,
  type OverfittingMetricsView,
  type OverfittingSampleOutcome,
  type ParameterSensitivityConclusion,
  type ParameterSensitivityDrift,
  type ParameterSensitivityEvaluator,
  type ParameterSensitivityFlag,
  type ParameterSensitivityInput,
  type ParameterSensitivityMeasure,
  type ParameterSensitivityReasonCode,
  type ParameterSensitivityResult,
  type ParameterSensitivityRule,
  type ParameterSensitivitySample,
  type ParameterSensitivityThresholds,
  type ResolvedParameterSensitivityThresholds,
} from "./types";

// ---------------------------------------------------------------------------
// 阈值解析（沿用 C-18.1 DEFAULT_*_PCT 常量）
// ---------------------------------------------------------------------------

/**
 * 解析敏感度阈值（缺省补齐 + 形态校验；非法 → ResearchValidationError）。
 */
export function resolveParameterSensitivityThresholds(
  input?: ParameterSensitivityThresholds,
): ResolvedParameterSensitivityThresholds {
  if (input === undefined) {
    return {
      returnDriftThresholdPct: DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
      drawdownWorseningThresholdPct: DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
    };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ResearchValidationError([
      {
        code: "PS_THRESHOLDS_INVALID",
        path: "thresholds",
        message: "thresholds 必须是对象",
      },
    ]);
  }
  const returnDriftThresholdPct = input.returnDriftThresholdPct ?? DEFAULT_RETURN_DRIFT_THRESHOLD_PCT;
  const drawdownWorseningThresholdPct =
    input.drawdownWorseningThresholdPct ?? DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT;
  if (
    typeof returnDriftThresholdPct !== "number" ||
    !Number.isFinite(returnDriftThresholdPct) ||
    returnDriftThresholdPct < 0
  ) {
    throw new ResearchValidationError([
      {
        code: "PS_THRESHOLD_RETURN_INVALID",
        path: "thresholds.returnDriftThresholdPct",
        message: `returnDriftThresholdPct 必须是 >= 0 的有限数字，收到 ${String(returnDriftThresholdPct)}`,
      },
    ]);
  }
  if (
    typeof drawdownWorseningThresholdPct !== "number" ||
    !Number.isFinite(drawdownWorseningThresholdPct) ||
    drawdownWorseningThresholdPct < 0
  ) {
    throw new ResearchValidationError([
      {
        code: "PS_THRESHOLD_DRAWDOWN_INVALID",
        path: "thresholds.drawdownWorseningThresholdPct",
        message: `drawdownWorseningThresholdPct 必须是 >= 0 的有限数字，收到 ${String(drawdownWorseningThresholdPct)}`,
      },
    ]);
  }
  return { returnDriftThresholdPct, drawdownWorseningThresholdPct };
}

// ---------------------------------------------------------------------------
// 标量校验 + 评估器桥
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 校验敏感度评估标量；合法 → null；否则 → 错误字符串。 */
function validateMetrics(metrics: OverfittingMetricsView): string | null {
  const problems: string[] = [];
  for (const field of ["totalReturnPct", "maxDrawdownPct"] as const) {
    if (!isFiniteNumber(metrics[field])) {
      problems.push(`${field} 必须是有限数字（禁止 NaN / Infinity）`);
    }
  }
  if (isFiniteNumber(metrics.maxDrawdownPct) && metrics.maxDrawdownPct < 0) {
    problems.push(`maxDrawdownPct 不能为负（实际 ${metrics.maxDrawdownPct}）`);
  }
  if (metrics.tradeCount !== null) {
    if (!Number.isInteger(metrics.tradeCount) || metrics.tradeCount < 0) {
      problems.push(`tradeCount 必须为 null 或 >= 0 整数，收到 ${String(metrics.tradeCount)}`);
    }
  }
  return problems.length === 0 ? null : problems.join("；");
}

/** 评估器桥接：ParameterSensitivityEvaluator → C-18.1 RobustnessEvaluator（同接口）。 */
function bridgeEvaluator(
  evaluator: ParameterSensitivityEvaluator,
): RobustnessEvaluator {
  return (item: PerturbationItem): { status: "succeeded"; metrics: RobustnessMetricsView } | { status: "failed"; error: string } => {
    const outcome: OverfittingSampleOutcome = evaluator(item.config as ResearchParameterSet);
    if (outcome.status === "failed") {
      return { status: "failed", error: outcome.error.trim() === "" ? "评估器返回空错误" : outcome.error };
    }
    return { status: "succeeded", metrics: outcome.metrics };
  };
}

// ---------------------------------------------------------------------------
// 漂移计算与判定
// ---------------------------------------------------------------------------

function computeDrift(
  baseline: OverfittingMetricsView,
  perturbed: OverfittingMetricsView,
): ParameterSensitivityDrift {
  const returnDriftPct = perturbed.totalReturnPct - baseline.totalReturnPct;
  const drawdownChangePct = perturbed.maxDrawdownPct - baseline.maxDrawdownPct;
  return {
    returnDriftPct,
    drawdownChangePct,
    drawdownWorseningPct: Math.max(0, drawdownChangePct),
    flags: [],
  };
}

function applyDriftThresholds(
  drift: ParameterSensitivityDrift,
  thresholds: ResolvedParameterSensitivityThresholds,
): readonly ParameterSensitivityFlag[] {
  const flags: ParameterSensitivityFlag[] = [];
  if (Math.abs(drift.returnDriftPct) > thresholds.returnDriftThresholdPct) {
    flags.push("RETURN_DRIFT");
  }
  if (drift.drawdownWorseningPct > thresholds.drawdownWorseningThresholdPct) {
    flags.push("DRAWDOWN_WORSENING");
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 敏感度度量
// ---------------------------------------------------------------------------

function computeMeasure(
  samples: readonly ParameterSensitivitySample[],
): ParameterSensitivityMeasure {
  const nonBaseline = samples.filter((s) => !s.isBaseline);
  const succeeded = nonBaseline.filter(
    (s) => s.status === "succeeded" && s.drift !== null,
  ) as ReadonlyArray<ParameterSensitivitySample & { drift: ParameterSensitivityDrift }>;
  const failedCount = nonBaseline.filter((s) => s.status === "failed").length;
  const sensitiveCount = succeeded.filter((s) => s.drift.flags.length > 0).length;
  const stableCount = succeeded.length - sensitiveCount;

  if (succeeded.length === 0) {
    return {
      evaluatedNonBaselineCount: succeeded.length,
      failedNonBaselineCount: failedCount,
      sensitiveNonBaselineCount: 0,
      stableNonBaselineCount: 0,
      maxReturnDriftPct: null,
      maxDrawdownWorseningPct: null,
      returnDriftStdDevPct: null,
      drawdownStdDevPct: null,
      returnDriftCvPct: null,
      elasticityPct: null,
    };
  }

  const returnDrifts = succeeded.map((s) => s.drift.returnDriftPct);
  const ddChanges = succeeded.map((s) => s.drift.drawdownChangePct);
  // maxReturnDriftPct：|漂移| 的最大值（始终为非负；保留方向信息用 single-sample 的 drift.returnDriftPct）。
  const maxReturnDriftPct = returnDrifts.reduce(
    (acc, v) => (Math.abs(v) > acc ? Math.abs(v) : acc),
    0,
  );
  const maxDrawdownWorseningPct = succeeded.reduce(
    (acc, s) => (s.drift.drawdownWorseningPct > acc ? s.drift.drawdownWorseningPct : acc),
    0,
  );
  // 样本标准差（n 为样本数；与 C-18.1 内部 statistic 一致）。
  const returnDriftStdDevPct = stdDev(returnDrifts);
  const drawdownStdDevPct = stdDev(ddChanges);
  const meanReturnDrift = mean(returnDrifts);
  const returnDriftCvPct = meanReturnDrift === null
    ? null
    : meanReturnDrift === 0
      ? null
      : (returnDriftStdDevPct === null ? null : Math.abs(returnDriftStdDevPct / Math.abs(meanReturnDrift)));
  const baselineSample = samples.find((s) => s.isBaseline);
  const baselineReturn = baselineSample?.totalReturnPct ?? null;
  const elasticityPct =
    baselineReturn === null || meanReturnDrift === null
      ? null
      : baselineReturn === 0
        ? null
        : Math.abs(meanReturnDrift / Math.abs(baselineReturn));

  return {
    evaluatedNonBaselineCount: succeeded.length,
    failedNonBaselineCount: failedCount,
    sensitiveNonBaselineCount: sensitiveCount,
    stableNonBaselineCount: stableCount,
    maxReturnDriftPct,
    maxDrawdownWorseningPct,
    returnDriftStdDevPct,
    drawdownStdDevPct,
    returnDriftCvPct,
    elasticityPct,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** 总体标准差（与 C-18.1 robustness 标准差语义一致）。 */
function stdDev(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const m = mean(values);
  if (m === null) return null;
  let sq = 0;
  for (const v of values) sq += (v - m) ** 2;
  return Math.sqrt(sq / values.length);
}

// ---------------------------------------------------------------------------
// 输入校验
// ---------------------------------------------------------------------------

function assertInputValid(input: ParameterSensitivityInput): void {
  const issues: ResearchValidationIssue[] = [];
  if (!input || typeof input !== "object") {
    throw new ResearchValidationError([
      { code: "PS_INPUT_INVALID", path: "input", message: "ParameterSensitivityInput 必须是对象" },
    ]);
  }
  if (
    input.baseParameterSet === null ||
    typeof input.baseParameterSet !== "object" ||
    Array.isArray(input.baseParameterSet)
  ) {
    issues.push({
      code: "PS_BASE_INVALID",
      path: "baseParameterSet",
      message: "baseParameterSet 必须是对象",
    });
  }
  if (!Array.isArray(input.rules)) {
    issues.push({
      code: "PS_RULES_INVALID",
      path: "rules",
      message: "rules 必须是数组",
    });
  }
  if (typeof input.evaluator !== "function") {
    issues.push({
      code: "PS_EVALUATOR_INVALID",
      path: "evaluator",
      message: "evaluator 必须是函数",
    });
  }
  if (issues.length > 0) throw new ResearchValidationError(issues);
}

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";

function computeParameterSensitivityResultFingerprint(
  body: Omit<ParameterSensitivityResult, "fingerprint">,
): string {
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 计算参数敏感性（纯函数、确定性、注入式评估）。
 *
 * 退化输入：
 *   - rules 为空 → NO_VARIANTS + PS_RULES_EMPTY（仅 baseline，无可判扰动）；
 *   - 全部扰动被 C-18.1 生成器跳过（非法参数 / 非数值）→ NO_VARIANTS +
 *     PS_ALL_PERTURBATIONS_SKIPPED；
 *   - 基准评估失败 → PS_BASELINE_FAILED 抛错（无漂移锚点）；
 *   - 全部非基准扰动评估失败 → INCONCLUSIVE + PS_ALL_PERTURBATIONS_FAILED；
 *   - 阈值非法 → PS_THRESHOLD_RETURN_INVALID / PS_THRESHOLD_DRAWDOWN_INVALID 抛错。
 */
export function computeParameterSensitivity(
  input: ParameterSensitivityInput,
): ParameterSensitivityResult {
  assertInputValid(input);

  const thresholds = resolveParameterSensitivityThresholds(input.thresholds);

  // 复用 C-18.1 生成器（axis="parameter"）。rules 为空 → 仅 baseline，跳过清单为空。
  const { variants, skipped } = generateParameterPerturbationVariants(input.baseParameterSet, {
    rules: input.rules,
  });

  if (variants.length === 0 || (variants.length === 1 && variants[0]!.isBaseline)) {
    const reasonCode: ParameterSensitivityReasonCode =
      input.rules.length === 0 ? "PS_RULES_EMPTY" : "PS_ALL_PERTURBATIONS_SKIPPED";
    const conclusion: ParameterSensitivityConclusion = "NO_VARIANTS";
  const body: Omit<ParameterSensitivityResult, "fingerprint"> = {
    recordVersion: PARAMETER_SENSITIVITY_RECORD_VERSION,
    baseParameterSet: { ...input.baseParameterSet },
    rules: input.rules.map((r) => ({ ...r })),
    thresholds,
    samples: [
      {
        perturbedParameterSet: { ...input.baseParameterSet },
        perturbationCode: "BASELINE",
        perturbationLabel: "基准（原参数集）",
        isBaseline: true,
        status: "failed",
        totalReturnPct: null,
        maxDrawdownPct: null,
        tradeCount: null,
        error: skipped.length === 0 ? null : "基准尚未评估（NO_VARIANTS 场景）",
        verdict: "skipped",
        drift: null,
      },
    ],
    measure: {
      evaluatedNonBaselineCount: 0,
      failedNonBaselineCount: 0,
      sensitiveNonBaselineCount: 0,
      stableNonBaselineCount: 0,
      maxReturnDriftPct: null,
      maxDrawdownWorseningPct: null,
      returnDriftStdDevPct: null,
      drawdownStdDevPct: null,
      returnDriftCvPct: null,
      elasticityPct: null,
    },
    conclusion,
    reasonCode,
  };
    const fingerprint = computeParameterSensitivityResultFingerprint(body);
    return { ...body, fingerprint };
  }

  // ---- 逐扰动注入式评估（evaluator 抛错 → 样本转记 failed） ----
  const bridgedEvaluator = bridgeEvaluator(input.evaluator);
  const rawSamples: ParameterSensitivitySample[] = [];
  let baselineOutcome: { readonly status: "succeeded"; readonly metrics: OverfittingMetricsView } | null = null;
  let baselineError: string | null = null;

  for (const item of variants) {
    let outcome: { status: "succeeded"; metrics: RobustnessMetricsView } | { status: "failed"; error: string };
    try {
      outcome = bridgedEvaluator(item);
    } catch (error) {
      outcome = { status: "failed", error: `评估器抛错：${error instanceof Error ? error.message : String(error)}` };
    }
    const baseSet: ResearchParameterSet = { ...input.baseParameterSet };
    if (item.isBaseline) {
      if (outcome.status === "failed") {
        baselineError = outcome.error;
      } else {
        baselineOutcome = { status: "succeeded", metrics: outcome.metrics };
      }
      rawSamples.push({
        perturbedParameterSet: baseSet,
        perturbationCode: item.code,
        perturbationLabel: item.label,
        isBaseline: true,
        status: outcome.status === "succeeded" ? "succeeded" : "failed",
        totalReturnPct: outcome.status === "succeeded" ? outcome.metrics.totalReturnPct : null,
        maxDrawdownPct: outcome.status === "succeeded" ? outcome.metrics.maxDrawdownPct : null,
        tradeCount: outcome.status === "succeeded" ? outcome.metrics.tradeCount : null,
        error: outcome.status === "failed" ? outcome.error : null,
        verdict: outcome.status === "succeeded" ? "baseline" : "failed",
        drift: null,
      });
      continue;
    }
    rawSamples.push({
      perturbedParameterSet: { ...(item.config as ResearchParameterSet) },
      perturbationCode: item.code,
      perturbationLabel: item.label,
      isBaseline: false,
      status: outcome.status === "succeeded" ? "succeeded" : "failed",
      totalReturnPct: outcome.status === "succeeded" ? outcome.metrics.totalReturnPct : null,
      maxDrawdownPct: outcome.status === "succeeded" ? outcome.metrics.maxDrawdownPct : null,
      tradeCount: outcome.status === "succeeded" ? outcome.metrics.tradeCount : null,
      error: outcome.status === "failed" ? outcome.error : null,
      verdict: "stable", // 稍后基于 baseline 重判
      drift: null,
    });
  }

  if (baselineOutcome === null || baselineError !== null) {
    throw new ResearchValidationError([
      {
        code: "PS_BASELINE_FAILED",
        path: "samples[0]",
        message: `基准条目评估失败（${baselineError ?? "无错误信息"}）；敏感度无锚点，拒绝产出结论`,
      },
    ]);
  }
  const baseline = baselineOutcome.metrics;

  // 复核 succeeded 样本的 metrics 合法（bridgeEvaluator 已校验，但需再次防御）。
  const baselineProblem = validateMetrics(baseline);
  if (baselineProblem !== null) {
    throw new ResearchValidationError([
      {
        code: "PS_BASELINE_METRICS_INVALID",
        path: "samples[0].metrics",
        message: `基准指标非法：${baselineProblem}`,
      },
    ]);
  }

  // 逐非基准样本判定 verdict + drift（不修改 rawSamples）。
  const samples: ParameterSensitivitySample[] = rawSamples.map((sample) => {
    if (sample.isBaseline) return sample;
    if (sample.status === "failed") {
      return { ...sample, verdict: "failed" as const, drift: null };
    }
    if (
      sample.totalReturnPct === null ||
      sample.maxDrawdownPct === null
    ) {
      return {
        ...sample,
        verdict: "failed" as const,
        error: sample.error ?? "评估成功但缺指标",
        drift: null,
      };
    }
    const perturbed: OverfittingMetricsView = {
      totalReturnPct: sample.totalReturnPct,
      maxDrawdownPct: sample.maxDrawdownPct,
      tradeCount: sample.tradeCount,
    };
    const problem = validateMetrics(perturbed);
    if (problem !== null) {
      return {
        ...sample,
        status: "failed" as const,
        verdict: "failed" as const,
        error: `评估产物非法：${problem}`,
        drift: null,
      };
    }
    const drift = computeDrift(baseline, perturbed);
    const flags = applyDriftThresholds(drift, thresholds);
    const flaggedDrift: ParameterSensitivityDrift = { ...drift, flags };
    return {
      ...sample,
      drift: flaggedDrift,
      verdict: flags.length > 0 ? ("sensitive" as const) : ("stable" as const),
    };
  });

  const measure = computeMeasure(samples);

  // 判定结论
  let conclusion: ParameterSensitivityConclusion;
  let reasonCode: ParameterSensitivityReasonCode | null = null;
  const nonBaselineSamples = samples.filter((s) => !s.isBaseline);
  const nonBaselineAllFailed = nonBaselineSamples.every((s) => s.verdict === "failed");
  if (nonBaselineSamples.length === 0) {
    conclusion = "NO_VARIANTS";
    reasonCode = "PS_RULES_EMPTY";
  } else if (nonBaselineAllFailed) {
    conclusion = "INCONCLUSIVE";
    reasonCode = "PS_ALL_PERTURBATIONS_FAILED";
  } else if (measure.sensitiveNonBaselineCount > 0) {
    conclusion = "SENSITIVE";
  } else {
    conclusion = "STABLE";
  }

  const body: Omit<ParameterSensitivityResult, "fingerprint"> = {
    recordVersion: PARAMETER_SENSITIVITY_RECORD_VERSION,
    baseParameterSet: { ...input.baseParameterSet },
    rules: input.rules.map((r) => ({ ...r })),
    thresholds,
    samples,
    measure,
    conclusion,
    reasonCode,
  };
  const fingerprint = computeParameterSensitivityResultFingerprint(body);
  return { ...body, fingerprint };
}
