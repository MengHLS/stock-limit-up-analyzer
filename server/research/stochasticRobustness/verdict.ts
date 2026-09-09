/**
 * STEP 18 / C-18.2 — 随机化鲁棒性判定（stable / sensitive / inconclusive + reasonCode）。
 *
 * 与 C-18.1 的口径衔接（import 只读，禁止改写其既有文件）：
 *   - 漂移阈值沿用 `resolveRobustnessThresholds` 的语义（收益绝对差 5pp /
 *     回撤恶化 3pp），使「确定性扰动敏感」与「随机化敏感」在同一把尺子下比较：
 *       · RETURN_DISPERSION   ：总收益 **置信区间宽度** > returnDriftThresholdPct
 *                               （重抽样不确定性超过「可容忍漂移」）；
 *       · DRAWDOWN_TAIL       ：MaxDD 分布 **上尾 p95** 相对基准恶化
 *                               > drawdownWorseningThresholdPct（仅恶化方向，
 *                               与 C-18.1 回撤单向敏感语义一致）。
 *   - 另加两条**随机化特有**标签（C-18.1 无对应，因无分布）：
 *       · RETURN_CI_INCLUDES_ZERO：总收益区间跨 0（正收益与 0 不可区分）；
 *       · BASELINE_TAIL_FAVORABLE：基准总收益百分位 > 100 − alpha/2×100
 *                                 （基准优于绝大多数重抽样 → 可能是尾部幸运样本）。
 *
 * 诚实声明：本判定是**描述性**口径——输出分布位置、区间与尾部概率，不产出 p 值、
 * 不声称统计显著性、不做假设检验承诺。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random。
 */

import type {
  StochasticDistributionSummary,
  StochasticMethod,
  StochasticMetricsView,
  StochasticReasonCode,
  StochasticResolvedConfig,
  StochasticRobustnessConclusion,
  StochasticRobustnessVerdict,
  StochasticSensitivityFlag,
  StochasticTailProbabilities,
} from "./types";
import { STOCHASTIC_METHOD_LABELS } from "./types";

/** 敏感标签中文说明（审计用途，不参与计算）。 */
export const STOCHASTIC_SENSITIVITY_FLAG_LABELS: Readonly<
  Record<StochasticSensitivityFlag, string>
> = Object.freeze({
  RETURN_DISPERSION: "总收益置信区间宽度超过收益漂移阈值（重抽样不确定性过大）",
  RETURN_CI_INCLUDES_ZERO: "总收益置信区间跨 0（正收益与 0 无法区分）",
  DRAWDOWN_TAIL: "回撤分布上尾相对基准恶化超过回撤阈值",
  BASELINE_TAIL_FAVORABLE: "基准结果位于重抽样分布上尾（可能是幸运样本）",
});

/** reasonCode → 中文说明。 */
export const STOCHASTIC_REASON_LABELS: Readonly<Record<StochasticReasonCode, string>> =
  Object.freeze({
    STOCHASTIC_STABLE: "未触发敏感标签：基准结果在随机化分布内不显异常",
    STOCHASTIC_BASELINE_TAIL_FAVORABLE: "基准位于分布上尾，结果可能依赖个别幸运样本",
    STOCHASTIC_RETURN_CI_INCLUDES_ZERO: "总收益置信区间跨 0",
    STOCHASTIC_RETURN_DISPERSION: "总收益分布离散度超过收益漂移阈值",
    STOCHASTIC_DRAWDOWN_TAIL: "回撤分布上尾恶化超过阈值",
    STOCHASTIC_INSUFFICIENT_ITERATIONS: "成功迭代数不足判定门槛",
    STOCHASTIC_INSUFFICIENT_SAMPLES: "无成功迭代样本",
    STOCHASTIC_BASELINE_UNAVAILABLE: "基准绩效不可用（无法定位基准在分布中的位置）",
  });

/** 主导 reasonCode 选取优先级（数组顺序即优先级，从高到低）。 */
export const STOCHASTIC_FLAG_PRIORITY: readonly StochasticSensitivityFlag[] = Object.freeze([
  "BASELINE_TAIL_FAVORABLE",
  "RETURN_CI_INCLUDES_ZERO",
  "RETURN_DISPERSION",
  "DRAWDOWN_TAIL",
]);

/** flag → reasonCode。 */
export const STOCHASTIC_FLAG_REASON_CODES: Readonly<
  Record<StochasticSensitivityFlag, StochasticReasonCode>
> = Object.freeze({
  BASELINE_TAIL_FAVORABLE: "STOCHASTIC_BASELINE_TAIL_FAVORABLE",
  RETURN_CI_INCLUDES_ZERO: "STOCHASTIC_RETURN_CI_INCLUDES_ZERO",
  RETURN_DISPERSION: "STOCHASTIC_RETURN_DISPERSION",
  DRAWDOWN_TAIL: "STOCHASTIC_DRAWDOWN_TAIL",
});

function fixed(value: number | null, digits = 4): string {
  return value === null || !Number.isFinite(value) ? "N/A" : value.toFixed(digits);
}

/**
 * 计算敏感标签集合（不含数据充足性判定；返回顺序按 STOCHASTIC_FLAG_PRIORITY）。
 */
export function collectStochasticSensitivityFlags(input: {
  readonly distribution: StochasticDistributionSummary;
  readonly baseline: StochasticMetricsView;
  readonly alpha: number;
  readonly thresholds: StochasticResolvedConfig["thresholds"];
}): readonly StochasticSensitivityFlag[] {
  const { distribution, baseline, alpha, thresholds } = input;
  const flags = new Set<StochasticSensitivityFlag>();

  const returnPercentile = distribution.totalReturnPct.baselinePercentile;
  if (returnPercentile !== null && returnPercentile > 100 - alpha * 50) {
    flags.add("BASELINE_TAIL_FAVORABLE");
  }

  const ci = distribution.totalReturnPct.confidenceInterval;
  if (ci.lower <= 0 && ci.upper >= 0) {
    flags.add("RETURN_CI_INCLUDES_ZERO");
  }
  if (ci.upper - ci.lower > thresholds.returnDriftThresholdPct) {
    flags.add("RETURN_DISPERSION");
  }
  if (
    distribution.maxDrawdownPct.summary.p95 - baseline.maxDrawdownPct >
    thresholds.drawdownWorseningThresholdPct
  ) {
    flags.add("DRAWDOWN_TAIL");
  }

  return STOCHASTIC_FLAG_PRIORITY.filter((flag) => flags.has(flag));
}

function buildInterpretation(input: {
  readonly method: StochasticMethod;
  readonly verdict: StochasticRobustnessVerdict;
  readonly reasonCode: StochasticReasonCode;
  readonly distribution: StochasticDistributionSummary | null;
  readonly tailProbabilities: StochasticTailProbabilities | null;
  readonly successCount: number;
  readonly failedCount: number;
  readonly config: StochasticResolvedConfig;
}): string {
  const { distribution, tailProbabilities, config } = input;
  const ci = distribution?.totalReturnPct.confidenceInterval ?? null;
  const percentile = distribution?.totalReturnPct.baselinePercentile ?? null;
  const head =
    `${STOCHASTIC_METHOD_LABELS[input.method]}：成功 ${input.successCount} 次 / 失败 ` +
    `${input.failedCount} 次；` +
    (ci === null
      ? "无可用分布摘要（成功样本不足）；"
      : `基准总收益位于重抽样分布第 ` +
        `${percentile === null ? "N/A" : percentile.toFixed(2)} 百分位，` +
        `${ci.levelPct.toFixed(0)}% 置信区间 [${fixed(ci.lower)}, ${fixed(ci.upper)}]pp；`) +
    (tailProbabilities === null
      ? ""
      : `P(收益<0)=${fixed(tailProbabilities.probLossPct, 2)}%，` +
        `P(MaxDD>${fixed(tailProbabilities.drawdownThresholdPct, 2)}%)=` +
        `${fixed(tailProbabilities.probDrawdownExceedsPct, 2)}%；`) +
    `回撤 p95=${fixed(distribution?.maxDrawdownPct.summary.p95 ?? null)}pp。`;
  const verdictWord =
    input.verdict === "stable" ? "stable（稳定）"
      : input.verdict === "sensitive" ? "sensitive（敏感）"
        : "inconclusive（证据不足）";
  const tail =
    `结论 ${verdictWord}，reasonCode=${input.reasonCode}（${STOCHASTIC_REASON_LABELS[input.reasonCode]}）。` +
    `判定口径：收益漂移阈值 ${fixed(config.thresholds.returnDriftThresholdPct, 2)}pp、` +
    `回撤恶化阈值 ${fixed(config.thresholds.drawdownWorseningThresholdPct, 2)}pp（复用 C-18.1）；` +
    `本结论为描述性口径，非假设检验承诺（无 p 值、未做偏差校正）。`;
  return `${head}${tail}`;
}

/**
 * 生成随机化鲁棒性结论。
 *
 * 判定顺序（数据充足性优先于敏感标签，避免用少量样本下强结论）：
 *   1. 成功样本数 = 0                      → inconclusive / INSUFFICIENT_SAMPLES；
 *   2. 成功样本数 < minIterationsForVerdict → inconclusive / INSUFFICIENT_ITERATIONS；
 *   3. 基准绩效不可用                       → inconclusive / BASELINE_UNAVAILABLE；
 *   4. 命中任一敏感标签                     → sensitive（reasonCode 按优先级取主导）；
 *   5. 否则                                 → stable / STOCHASTIC_STABLE。
 */
export function buildStochasticConclusion(input: {
  readonly method: StochasticMethod;
  readonly distribution: StochasticDistributionSummary | null;
  readonly tailProbabilities: StochasticTailProbabilities | null;
  readonly baseline: StochasticMetricsView;
  readonly successCount: number;
  readonly failedCount: number;
  readonly config: StochasticResolvedConfig;
}): StochasticRobustnessConclusion {
  const { config } = input;
  const baselineAvailable =
    Number.isFinite(input.baseline.totalReturnPct) && Number.isFinite(input.baseline.maxDrawdownPct);

  let verdict: StochasticRobustnessVerdict;
  let reasonCode: StochasticReasonCode;
  let flags: readonly StochasticSensitivityFlag[] = [];

  if (input.distribution === null || input.tailProbabilities === null || input.successCount === 0) {
    verdict = "inconclusive";
    reasonCode = "STOCHASTIC_INSUFFICIENT_SAMPLES";
  } else if (input.successCount < config.minIterationsForVerdict) {
    verdict = "inconclusive";
    reasonCode = "STOCHASTIC_INSUFFICIENT_ITERATIONS";
  } else if (!baselineAvailable) {
    verdict = "inconclusive";
    reasonCode = "STOCHASTIC_BASELINE_UNAVAILABLE";
  } else {
    flags = collectStochasticSensitivityFlags({
      distribution: input.distribution,
      baseline: input.baseline,
      alpha: config.alpha,
      thresholds: config.thresholds,
    });
    if (flags.length > 0) {
      verdict = "sensitive";
      reasonCode = STOCHASTIC_FLAG_REASON_CODES[flags[0]!];
    } else {
      verdict = "stable";
      reasonCode = "STOCHASTIC_STABLE";
    }
  }

  return {
    method: input.method,
    verdict,
    reasonCode,
    flags,
    successCount: input.successCount,
    failedCount: input.failedCount,
    minIterationsForVerdict: config.minIterationsForVerdict,
    interpretation: buildInterpretation({
      method: input.method,
      verdict,
      reasonCode,
      distribution: input.distribution,
      tailProbabilities: input.tailProbabilities,
      successCount: input.successCount,
      failedCount: input.failedCount,
      config,
    }),
  };
}
