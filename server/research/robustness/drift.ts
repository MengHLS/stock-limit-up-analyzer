/**
 * STEP 18 / C-18.1 — 漂移判定与敏感性评估（基准 vs 扰动的结构化判定）。
 *
 * 判定口径（显式非「单点好即好」）：
 *   - 逐样本：把扰动后绩效与基准绩效逐维对比——
 *       · 收益维度：|ΔtotalReturnPct| > returnDriftThresholdPct → RETURN_DRIFT（双向敏感：
 *         收益暴涨同样可疑——扰动应「不显著改变」结论，而非只防恶化）；
 *       · 风险维度：ΔmaxDrawdownPct（仅恶化方向）> drawdownWorseningThresholdPct →
 *         DRAWDOWN_WORSENING（回撤改善不判敏感）；
 *       · 任一 flag → 该扰动样本 verdict="sensitive"，否则 "stable"。
 *   - 轴级：单轴一次运行（编排器强制同轴），逐条非基准扰动聚合 →
 *     RobustnessAxisConclusion（敏感/稳定/不足/无扰动/无结论），归因到轴。
 *
 * 边界：
 *   - 基准条目（isBaseline）恒 verdict="baseline"、drift=null；
 *   - 评估失败样本 verdict="failed"、drift=null，不参与敏感判定；
 *   - 基准条目评估失败 → 无漂移锚点：assessRobustnessSensitivity 结构化抛错
 *     （编排器因此拒绝产出无意义的 run；纯判定函数保留 no-conclusion 防御值）。
 *   - 绩效标量校验（validateRobustnessMetrics）：NaN/±Infinity / 负回撤 / 非法
 *     tradeCount 一律拒绝（失败响亮）。
 *
 * 铁律：纯函数、确定性、只读入参；无 IO / Date.now / Math.random。
 */

import { ResearchValidationError } from "../experimentValidation";
import type { PerformanceEvaluationRun } from "../performanceMetrics/types";
import { computePerturbationConfigFingerprint } from "./serialize";
import type {
  PerturbationDrift,
  PerturbationItem,
  ResolvedRobustnessThresholds,
  RobustnessAxisConclusion,
  RobustnessMetricsView,
  RobustnessSample,
  RobustnessSampleVerdict,
  RobustnessSensitivityFlag,
  RobustnessThresholds,
} from "./types";
import {
  DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
  DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
} from "./types";

// ---------------------------------------------------------------------------
// 绩效标量校验 + C-16.1 桥
// ---------------------------------------------------------------------------

/** 校验绩效视图；合法返回 null，否则返回人类可读错误串。 */
export function validateRobustnessMetrics(metrics: RobustnessMetricsView): string | null {
  if (metrics === null || typeof metrics !== "object") {
    return "评估成功产物必须是对象";
  }
  const problems: string[] = [];
  for (const field of ["totalReturnPct", "maxDrawdownPct"] as const) {
    if (typeof metrics[field] !== "number" || !Number.isFinite(metrics[field])) {
      problems.push(`${field} 必须是有限数字（禁止 NaN / Infinity）`);
    }
  }
  if (typeof metrics.maxDrawdownPct === "number" && metrics.maxDrawdownPct < 0) {
    problems.push(`maxDrawdownPct 不能为负（实际 ${metrics.maxDrawdownPct}）`);
  }
  if (metrics.tradeCount !== null) {
    if (typeof metrics.tradeCount !== "number" || !Number.isInteger(metrics.tradeCount)) {
      problems.push("tradeCount 必须为 null 或整数");
    } else if (metrics.tradeCount < 0) {
      problems.push(`tradeCount 不能为负（实际 ${metrics.tradeCount}）`);
    }
  }
  return problems.length === 0 ? null : problems.join("；");
}

/**
 * 桥接 C-16.1 PerformanceEvaluationRun → 本层绩效视图（import 只读，不重写 C-16.1 口径）。
 * 研究链典型装配：caller 的 evaluator = (item) => { 用 item.config 驱动模拟 → evaluatePerformance
 * → { status:"succeeded", metrics: toRobustnessMetricsView(run) } }。
 */
export function toRobustnessMetricsView(run: PerformanceEvaluationRun): RobustnessMetricsView {
  return {
    totalReturnPct: run.metrics.returns.totalReturnPct,
    maxDrawdownPct: run.metrics.drawdown.maxDrawdownPct,
    tradeCount: run.input.tradeCount,
  };
}

// ---------------------------------------------------------------------------
// 阈值解析
// ---------------------------------------------------------------------------

/** 解析漂移阈值（缺省补齐 + 合法性校验；非法 → ResearchValidationError）。 */
export function resolveRobustnessThresholds(
  input?: RobustnessThresholds
): ResolvedRobustnessThresholds {
  if (input === undefined) {
    return {
      returnDriftThresholdPct: DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
      drawdownWorseningThresholdPct: DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
    };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ResearchValidationError([
      { code: "RB18_THRESHOLDS_INVALID", path: "thresholds", message: "thresholds 必须是对象" },
    ]);
  }
  const returnDriftThresholdPct = input.returnDriftThresholdPct ?? DEFAULT_RETURN_DRIFT_THRESHOLD_PCT;
  const drawdownWorseningThresholdPct = input.drawdownWorseningThresholdPct ?? DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT;
  if (
    typeof returnDriftThresholdPct !== "number" ||
    !Number.isFinite(returnDriftThresholdPct) ||
    returnDriftThresholdPct < 0
  ) {
    throw new ResearchValidationError([
      {
        code: "RB18_THRESHOLD_RETURN_INVALID",
        path: "thresholds.returnDriftThresholdPct",
        message: `returnDriftThresholdPct 必须是 >= 0 的有限数字（百分点），收到 ${String(returnDriftThresholdPct)}`,
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
        code: "RB18_THRESHOLD_DRAWDOWN_INVALID",
        path: "thresholds.drawdownWorseningThresholdPct",
        message: `drawdownWorseningThresholdPct 必须是 >= 0 的有限数字（百分点），收到 ${String(drawdownWorseningThresholdPct)}`,
      },
    ]);
  }
  return { returnDriftThresholdPct, drawdownWorseningThresholdPct };
}

// ---------------------------------------------------------------------------
// 漂移计算与逐样本判定
// ---------------------------------------------------------------------------

function requireFiniteMetrics(metrics: RobustnessMetricsView, label: string): void {
  const problem = validateRobustnessMetrics(metrics);
  if (problem !== null) {
    throw new ResearchValidationError([
      {
        code: "RB18_METRICS_INVALID",
        path: label,
        message: `参与漂移计算的绩效标量非法：${problem}`,
      },
    ]);
  }
}

/**
 * 计算单条扰动的漂移分解（不应用阈值，仅数值分解 + 无 flag）。
 * 输入标量非法 → ResearchValidationError。
 */
export function computeRobustnessDrift(
  baselineMetrics: RobustnessMetricsView,
  perturbedMetrics: RobustnessMetricsView
): PerturbationDrift {
  requireFiniteMetrics(baselineMetrics, "baselineMetrics");
  requireFiniteMetrics(perturbedMetrics, "perturbedMetrics");
  const returnDriftPct = perturbedMetrics.totalReturnPct - baselineMetrics.totalReturnPct;
  const drawdownChangePct = perturbedMetrics.maxDrawdownPct - baselineMetrics.maxDrawdownPct;
  return {
    returnDriftPct,
    drawdownChangePct,
    drawdownWorseningPct: Math.max(0, drawdownChangePct),
    flags: [],
  };
}

/** 依据阈值给漂移打敏感 flag（收益双向 / 回撤仅恶化方向）。 */
export function applyDriftThresholds(
  drift: PerturbationDrift,
  thresholds: ResolvedRobustnessThresholds
): readonly RobustnessSensitivityFlag[] {
  const flags: RobustnessSensitivityFlag[] = [];
  if (Math.abs(drift.returnDriftPct) > thresholds.returnDriftThresholdPct) {
    flags.push("RETURN_DRIFT");
  }
  if (drift.drawdownWorseningPct > thresholds.drawdownWorseningThresholdPct) {
    flags.push("DRAWDOWN_WORSENING");
  }
  return flags;
}

/**
 * 逐样本判定（核心决策函数；独立可测）：
 *   - status="failed"            → verdict="failed"，drift=null；
 *   - isBaseline 且 succeeded     → verdict="baseline"，drift=null；
 *   - 其余 succeeded              → 按漂移阈值 verdict="sensitive" | "stable"。
 * 非基准 succeeded 而缺基线指标 → ResearchValidationError（无漂移锚点）。
 */
export function classifyRobustnessSample(
  input: {
    readonly isBaseline: boolean;
    readonly status: "succeeded" | "failed";
    readonly metrics: RobustnessMetricsView | null;
    readonly baselineMetrics: RobustnessMetricsView | null;
    readonly thresholds: ResolvedRobustnessThresholds;
  }
): { verdict: RobustnessSampleVerdict; drift: PerturbationDrift | null } {
  if (input.status === "failed") {
    return { verdict: "failed", drift: null };
  }
  const metrics = input.metrics;
  if (metrics === null) {
    throw new ResearchValidationError([
      { code: "RB18_SAMPLE_METRICS_MISSING", path: "metrics", message: "succeeded 样本缺 metrics" },
    ]);
  }
  if (input.isBaseline) {
    return { verdict: "baseline", drift: null };
  }
  if (input.baselineMetrics === null) {
    throw new ResearchValidationError([
      {
        code: "RB18_BASELINE_METRICS_MISSING",
        path: "baselineMetrics",
        message: "非基准样本需要基准指标才能计算漂移（基准条目评估失败 → 无锚点）",
      },
    ]);
  }
  const drift = computeRobustnessDrift(input.baselineMetrics, metrics);
  const flags = applyDriftThresholds(drift, input.thresholds);
  const flagged: PerturbationDrift = { ...drift, flags };
  return {
    verdict: flags.length > 0 ? "sensitive" : "stable",
    drift: flagged,
  };
}

// ---------------------------------------------------------------------------
// 轴级结论
// ---------------------------------------------------------------------------

/** 由已判定样本聚合轴级结论（samples[0] 须为基准；axis 取自全部样本且须一致）。 */
export function buildRobustnessConclusion(
  samples: readonly RobustnessSample[]
): RobustnessAxisConclusion {
  if (samples.length === 0) {
    throw new ResearchValidationError([
      { code: "RB18_SAMPLES_EMPTY", path: "samples", message: "样本列表不能为空" },
    ]);
  }
  const axis = samples[0]!.perturbation.axis;
  const baselineSample = samples.find((sample) => sample.perturbation.isBaseline);
  const baselineSucceeded = baselineSample !== undefined && baselineSample.status === "succeeded";

  const nonBaseline = samples.filter((sample) => !sample.perturbation.isBaseline);
  const succeeded = nonBaseline.filter((sample) => sample.status === "succeeded");
  const failedCount = nonBaseline.length - succeeded.length;
  const sensitive = succeeded.filter((sample) => sample.verdict === "sensitive");
  const stableCount = succeeded.length - sensitive.length;

  let verdict: RobustnessAxisConclusion["verdict"];
  if (!baselineSucceeded) {
    verdict = "no-conclusion";
  } else if (nonBaseline.length === 0) {
    verdict = "no-variants";
  } else if (succeeded.length === 0) {
    verdict = "insufficient";
  } else if (sensitive.length > 0) {
    verdict = "sensitive";
  } else {
    verdict = "stable";
  }

  return {
    axis,
    sampleCount: samples.length,
    baselineSucceeded,
    succeededCount: succeeded.length,
    failedCount,
    sensitiveCount: sensitive.length,
    stableCount,
    sensitiveEntries: sensitive.map((sample) => ({
      code: sample.perturbation.code,
      label: sample.perturbation.label,
    })),
    verdict,
  };
}

// ---------------------------------------------------------------------------
// 评估输入与主入口
// ---------------------------------------------------------------------------

/** 逐扰动评估原始输入（编排器或测试直接构造；metrics/error 与 status 互斥约束见下）。 */
export interface RobustnessEntryInput {
  readonly perturbation: PerturbationItem;
  readonly status: "succeeded" | "failed";
  /** status="succeeded" 时非 null；否则须为 null。 */
  readonly metrics: RobustnessMetricsView | null;
  /** status="failed" 时非空串；否则须为 null。 */
  readonly error: string | null;
}

/** 敏感性评估结果：逐样本（含判定）+ 轴级结论。 */
export interface RobustnessAssessment {
  readonly samples: readonly RobustnessSample[];
  readonly conclusion: RobustnessAxisConclusion;
}

function assertSameAxis(entries: readonly RobustnessEntryInput[]): void {
  const axis = entries[0]!.perturbation.axis;
  for (const entry of entries) {
    if (entry.perturbation.axis !== axis) {
      throw new ResearchValidationError([
        {
          code: "RB18_AXIS_MIXED",
          path: "perturbations",
          message: `扰动清单混轴：${axis} 与 ${entry.perturbation.axis}（归因需单轴运行）`,
        },
      ]);
    }
  }
}

/**
 * 敏感性主入口：对逐扰动评估输入做漂移判定 + 轴级结论。
 *
 * 契约（退化输入结构化处理）：
 *   - entries 为空 → RB18_ENTRIES_EMPTY；
 *   - 恰一条 isBaseline 条目（缺失 → RB18_BASELINE_MISSING；多条 → RB18_BASELINE_DUPLICATE）；
 *   - 全部条目同轴（混轴 → RB18_AXIS_MIXED）；
 *   - 基准条目必须评估成功（失败 → RB18_BASELINE_FAILED），否则漂移无锚点。
 */
export function assessRobustnessSensitivity(
  entries: readonly RobustnessEntryInput[],
  thresholds: ResolvedRobustnessThresholds
): RobustnessAssessment {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ResearchValidationError([
      { code: "RB18_ENTRIES_EMPTY", path: "entries", message: "评估输入不能为空" },
    ]);
  }
  assertSameAxis(entries);

  const baselineIndexes = entries
    .map((entry, index) => (entry.perturbation.isBaseline ? index : -1))
    .filter((index) => index >= 0);
  if (baselineIndexes.length === 0) {
    throw new ResearchValidationError([
      { code: "RB18_BASELINE_MISSING", path: "entries", message: "扰动清单缺基准条目（isBaseline=true）" },
    ]);
  }
  if (baselineIndexes.length > 1) {
    throw new ResearchValidationError([
      { code: "RB18_BASELINE_DUPLICATE", path: "entries", message: "扰动清单存在多条基准条目（应恰一条）" },
    ]);
  }
  const baselineEntry = entries[baselineIndexes[0]!]!;
  if (baselineEntry.status !== "succeeded" || baselineEntry.metrics === null) {
    throw new ResearchValidationError([
      {
        code: "RB18_BASELINE_FAILED",
        path: "entries",
        message:
          `基准条目评估失败（${baselineEntry.error ?? "无错误信息"}）；漂移无锚点，拒绝产出鲁棒性结论`,
      },
    ]);
  }
  const baselineMetrics = baselineEntry.metrics;

  const samples: readonly RobustnessSample[] = entries.map((entry) => {
    const classification = classifyRobustnessSample({
      isBaseline: entry.perturbation.isBaseline,
      status: entry.status,
      metrics: entry.metrics,
      baselineMetrics,
      thresholds,
    });
    return {
      perturbation: entry.perturbation,
      status: entry.status,
      metrics: entry.metrics,
      error: entry.error,
      verdict: classification.verdict,
      drift: classification.drift,
      configFingerprint: computePerturbationConfigFingerprint(entry.perturbation),
    };
  });

  const conclusion = buildRobustnessConclusion(samples);
  return { samples, conclusion };
}
