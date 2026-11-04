/**
 * C-18.1 泛化扩展 —— 声明式比较（规格 §4）与**容差判定的唯一实现**。
 *
 * ## 为什么要有这一层
 *
 * C-18.1 的比较口径是**两个固定阈值字段**（`returnDriftThresholdPct` /
 * `drawdownWorseningThresholdPct`），判定逻辑写在 `drift.ts#applyDriftThresholds`。
 * 研究实验要用的是同一件事 —— 「扰动后指标相对基准变化了多少、超没超容差」——
 * 但指标是**自己声明的**（`medianCloseReturn` / `breakoutVsCloseRate` / …）。
 *
 * ⇒ 于是把判定提炼成：
 *
 * ```text
 * evaluateTolerance(delta, tolerance, direction) → 布尔
 * ```
 *
 * **只有一份实现**：C-18.1 的 `applyDriftThresholds` 与本研究侧的比较器都走它
 * （前者把自己的两个阈值投影成 `direction = "both"` / `"increase"` 两次调用）。
 * 这样「容差语义」就不会在仓里长出第二份 —— 审计 P1-3 说的正是这类重复
 * （`overfittingDetection/parameterSensitivity.ts` 当时自己复制了一套漂移判定）。
 *
 * ## 刻意的「不看指标名」
 *
 * 本文件（以及整个泛化层）**不出现任何具体指标名**，也**没有** `if (metric === "…")`
 * 这类分支：`metric` 只被当作**字典键**在声明与快照之间对齐。
 * 研究侧要比较哪个指标、容差多大、是双向还是单向，**全部由调用方声明**。
 *
 * 铁律：纯函数、确定性、无 IO / `Date.now` / `Math.random`；退化输入结构化抛错。
 */

import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import type {
  RobustnessMetricSnapshot,
  RobustnessSampleAccounting,
} from "./dimension";

// ---------------------------------------------------------------------------
// 声明（规格 §4：metric / tolerance / direction）
// ---------------------------------------------------------------------------

/**
 * 容差方向语义。
 *
 * - `"both"`：`|delta| > tolerance` 即敏感（**收益类**指标的既有口径：扰动应「不显著改变」
 *   结论，涨同样可疑 —— 这正是 C-18.1 `RETURN_DRIFT` 的双向语义）；
 * - `"increase"`：仅 `delta > tolerance` 敏感（恶化方向 = 变大，如回撤深度
 *   —— 对应 `DRAWDOWN_WORSENING`）；
 * - `"decrease"`：仅 `-delta > tolerance` 敏感（恶化方向 = 变小）。
 *
 * 🔴 三种方向**不猜、不倒推**：声明里写哪个就是哪个。C-18.1 的历史教训是
 *    「把源运算符直接当目标门槛用」⇒ `bar.low >= open` 被译成方向相反的规则。
 */
export const COMPARISON_DIRECTIONS = ["both", "increase", "decrease"] as const;
export type ComparisonDirection = (typeof COMPARISON_DIRECTIONS)[number];

/** 单条比较声明（**声明式**：本层不含任何「哪个指标该怎么比」的内建知识）。 */
export interface MetricComparisonSpec {
  /** 指标名（必须 ∈ 本次运行的指标词表）。 */
  readonly metric: string;
  /** 容差（同指标的**同一量纲**；>= 0；严格大于才判敏感）。 */
  readonly tolerance: number;
  readonly direction: ComparisonDirection;
  /** 人读标签（进结果与页面；缺省用 metric）。 */
  readonly label?: string;
  /** 量纲（人读；如 `%` / `比率`）。 */
  readonly unit?: string;
}

/** 比较结果（逐指标一行；规格 §4 的结构化输出）。 */
export const COMPARISON_VERDICTS = ["stable", "sensitive", "insufficient"] as const;
export type MetricComparisonVerdict = (typeof COMPARISON_VERDICTS)[number];

export interface MetricComparisonResult {
  readonly metric: string;
  readonly label: string;
  readonly unit: string | null;
  /** 基准值（不可用时 null —— **不伪造 0**）。 */
  readonly baselineValue: number | null;
  readonly variantValue: number | null;
  readonly delta: number | null;
  readonly absoluteDelta: number | null;
  readonly tolerance: number;
  readonly direction: ComparisonDirection;
  readonly verdict: MetricComparisonVerdict;
  /** `insufficient` 的原因（如「变体侧指标不可用：样本量不足」）；其余为 null。 */
  readonly reason: string | null;
  /**
   * 样本集合上下文（规格 §6）：样本集合变了就**必须显式暴露** ——
   * 「不同样本总体直接当同一总体比较」是本层要堵的静默失真。
   */
  readonly baselineSampleCount: number | null;
  readonly variantSampleCount: number | null;
  readonly excludedSampleCount: number | null;
  /** `variantSampleCount !== baselineSampleCount`（任一侧未知时为 null）。 */
  readonly sampleSetChanged: boolean | null;
}

// ---------------------------------------------------------------------------
// 容差判定（**唯一实现**：C-18.1 与本研究侧共用）
// ---------------------------------------------------------------------------

function assertTolerance(tolerance: number): void {
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
    throw new ResearchValidationError([
      {
        code: "RB18X_TOLERANCE_INVALID",
        path: "tolerance",
        message: `容差必须是 >= 0 的有限数字，收到 ${String(tolerance)}`,
      },
    ]);
  }
}

/**
 * 容差判定（**两个阶段共用的那一个函数**）。
 *
 * 严格大于（`>`）而非 `>=`：等于容差即「在容差内」，与 C-18.1 的既有口径逐字一致
 * （`Math.abs(drift.returnDriftPct) > thresholds.returnDriftThresholdPct`）。
 */
export function evaluateTolerance(
  delta: number,
  tolerance: number,
  direction: ComparisonDirection
): boolean {
  assertTolerance(tolerance);
  if (typeof delta !== "number" || !Number.isFinite(delta)) {
    throw new ResearchValidationError([
      {
        code: "RB18X_DELTA_NON_FINITE",
        path: "delta",
        message: `参与容差判定的变化量必须是有限数字，收到 ${String(delta)}`,
      },
    ]);
  }
  switch (direction) {
    case "both":
      return Math.abs(delta) > tolerance;
    case "increase":
      return delta > tolerance;
    case "decrease":
      return -delta > tolerance;
    default: {
      // 运行期防御（类型层面不可能到达）：不猜方向、不默认双向。
      throw new ResearchValidationError([
        {
          code: "RB18X_COMPARISON_DIRECTION_UNKNOWN",
          path: "direction",
          message: `未知容差方向：${String(direction)}`,
        },
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// 声明校验
// ---------------------------------------------------------------------------

/** 校验比较声明（metric ∈ 词表 / 容差合法 / 方向合法 / 唯一）。返回规范化后的声明。 */
export function resolveComparisonSpecs(
  specs: readonly MetricComparisonSpec[],
  metricNames: readonly string[]
): readonly MetricComparisonSpec[] {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new ResearchValidationError([
      { code: "RB18X_COMPARISON_SPECS_EMPTY", path: "comparisons", message: "比较声明不能为空" },
    ]);
  }
  const vocabulary = new Set(metricNames);
  const seen = new Set<string>();
  const problems: ResearchValidationIssue[] = [];
  const resolved: MetricComparisonSpec[] = [];
  specs.forEach((spec, index) => {
    const path = `comparisons[${index}]`;
    if (spec === null || typeof spec !== "object") {
      problems.push({ code: "RB18X_COMPARISON_SPEC_INVALID", path, message: "比较声明必须是对象" });
      return;
    }
    if (typeof spec.metric !== "string" || spec.metric.trim() === "") {
      problems.push({ code: "RB18X_COMPARISON_METRIC_EMPTY", path: `${path}.metric`, message: "metric 必须是非空字符串" });
    } else if (!vocabulary.has(spec.metric)) {
      problems.push({
        code: "RB18X_COMPARISON_METRIC_NOT_DECLARED",
        path: `${path}.metric`,
        message: `比较声明的指标 "${spec.metric}" 不在指标词表里（${[...vocabulary].sort().join(", ")}）`,
      });
    } else if (seen.has(spec.metric)) {
      problems.push({
        code: "RB18X_COMPARISON_METRIC_DUPLICATE",
        path: `${path}.metric`,
        message: `指标 "${spec.metric}" 被重复声明比较（同一指标只允许一条口径）`,
      });
    } else {
      seen.add(spec.metric);
    }
    if (typeof spec.tolerance !== "number" || !Number.isFinite(spec.tolerance) || spec.tolerance < 0) {
      problems.push({
        code: "RB18X_COMPARISON_TOLERANCE_INVALID",
        path: `${path}.tolerance`,
        message: `tolerance 必须是 >= 0 的有限数字，收到 ${String(spec.tolerance)}`,
      });
    }
    if (!COMPARISON_DIRECTIONS.includes(spec.direction)) {
      problems.push({
        code: "RB18X_COMPARISON_DIRECTION_INVALID",
        path: `${path}.direction`,
        message: `direction 必须是 ${COMPARISON_DIRECTIONS.join(" | ")} 之一，收到 ${String(spec.direction)}`,
      });
    }
    if (spec.label !== undefined && (typeof spec.label !== "string" || spec.label.trim() === "")) {
      problems.push({ code: "RB18X_COMPARISON_LABEL_EMPTY", path: `${path}.label`, message: "label 不得为空串" });
    }
    resolved.push({
      metric: spec.metric,
      tolerance: spec.tolerance,
      direction: spec.direction,
      ...(spec.label !== undefined ? { label: spec.label } : {}),
      ...(spec.unit !== undefined ? { unit: spec.unit } : {}),
    });
  });
  if (problems.length > 0) throw new ResearchValidationError(problems);
  return resolved;
}

// ---------------------------------------------------------------------------
// 比较器
// ---------------------------------------------------------------------------

function sampleCountOf(accounting: RobustnessSampleAccounting | null): number | null {
  return accounting === null ? null : accounting.validCount;
}

/**
 * 逐指标比较（基准快照 vs 变体快照）。
 *
 * 判定规则（**确定性**，无「差不多」）：
 *   1. 任一侧该指标不可用 ⇒ `insufficient` + 原因（**不拿 null 当 0 算差值**）；
 *   2. 否则 `delta = variant − baseline`，`|delta| / 方向` 超容差 ⇒ `sensitive`，否则 `stable`。
 *
 * 样本集合上下文（`baselineSampleCount` / `variantSampleCount` / `excludedSampleCount`）
 * 逐行附带，并在两侧都已知时给出 `sampleSetChanged` —— 「换了样本总体还在比」这件事
 * 在结果里**必须看得见**（规格 §6）。
 */
export function compareMetricSnapshot(args: {
  readonly baseline: RobustnessMetricSnapshot;
  readonly variant: RobustnessMetricSnapshot;
  readonly baselineAccounting: RobustnessSampleAccounting | null;
  readonly variantAccounting: RobustnessSampleAccounting | null;
  readonly specs: readonly MetricComparisonSpec[];
}): readonly MetricComparisonResult[] {
  const baselineSampleCount = sampleCountOf(args.baselineAccounting);
  const variantSampleCount = sampleCountOf(args.variantAccounting);
  return args.specs.map((spec) => {
    const metric = spec.metric;
    const label = spec.label ?? metric;
    const unit = spec.unit ?? null;
    const baselineValue = Object.prototype.hasOwnProperty.call(args.baseline.metrics, metric)
      ? (args.baseline.metrics[metric] as number)
      : null;
    const variantValue = Object.prototype.hasOwnProperty.call(args.variant.metrics, metric)
      ? (args.variant.metrics[metric] as number)
      : null;
    const baselineReason = args.baseline.unavailable[metric] ?? null;
    const variantReason = args.variant.unavailable[metric] ?? null;

    const sampleSetChanged =
      baselineSampleCount === null || variantSampleCount === null
        ? null
        : baselineSampleCount !== variantSampleCount;

    const common = {
      metric,
      label,
      unit,
      tolerance: spec.tolerance,
      direction: spec.direction,
      baselineSampleCount,
      variantSampleCount,
      excludedSampleCount: args.variantAccounting === null ? null : args.variantAccounting.excludedCount,
      sampleSetChanged,
    } as const;

    if (baselineValue === null || variantValue === null) {
      const parts: string[] = [];
      if (baselineValue === null) parts.push(`基准侧不可用（${baselineReason ?? "未给出原因"}）`);
      if (variantValue === null) parts.push(`变体侧不可用（${variantReason ?? "未给出原因"}）`);
      return {
        ...common,
        baselineValue,
        variantValue,
        delta: null,
        absoluteDelta: null,
        verdict: "insufficient" as const,
        reason: parts.join("；"),
      };
    }

    const delta = variantValue - baselineValue;
    const sensitive = evaluateTolerance(delta, spec.tolerance, spec.direction);
    return {
      ...common,
      baselineValue,
      variantValue,
      delta,
      absoluteDelta: Math.abs(delta),
      verdict: sensitive ? ("sensitive" as const) : ("stable" as const),
      reason: null,
    };
  });
}

/** 单元判定（含 `failed`）：逐指标的 verdict 聚合成一个单元的结论。 */
export const UNIT_VERDICTS = ["baseline", "stable", "sensitive", "insufficient", "failed"] as const;
export type UnitVerdict = (typeof UNIT_VERDICTS)[number];

/**
 * 聚合逐指标比较 → 单元 verdict。
 *
 * 优先级（**显式约定，不是实现细节**）：`sensitive` > `insufficient` > `stable`
 * —— 敏感性是**正面发现**（扰动真的改变了结论），必须先被看见；
 * `insufficient` 是**口径缺口**（指标算不出来 / 样本不足），不能被「其余都稳」掩盖。
 */
export function summarizeUnitVerdict(input: {
  readonly anyFailed: boolean;
  readonly comparisons: readonly MetricComparisonResult[];
}): UnitVerdict {
  if (input.anyFailed) return "failed";
  const verdicts = input.comparisons.map((item) => item.verdict);
  if (verdicts.length === 0) return "insufficient";
  if (verdicts.includes("sensitive")) return "sensitive";
  if (verdicts.includes("insufficient")) return "insufficient";
  return "stable";
}
