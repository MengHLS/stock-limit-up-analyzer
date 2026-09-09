/**
 * STEP 18 / C-18.2 — StochasticRobustnessRun 序列化 + 指纹 + 结构校验（纯函数、确定性）。
 *
 * 铁律（对齐 C-17.1 / C-18.1 serialize.ts 与 researchDataset canonical 范式）：
 *   - 指纹与序列化使用按键字典序排序的 canonical JSON（复用
 *     `researchDataset/version.canonicalStringify`，import 只读）；
 *   - NaN / ±Infinity 在进入指纹 / 序列化前递归扫描并直接抛错（canonicalStringify
 *     会把 NaN 静默转 null，必须先拦截）；
 *   - fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - deserialize：JSON → 结构校验 → 指纹复核，任何字段被篡改 / 数值退化都会导致
 *     指纹不匹配而抛错。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import {
  STOCHASTIC_ROBUSTNESS_RUN_RECORD_KIND,
  STOCHASTIC_ROBUSTNESS_RUN_RECORD_VERSION,
  STOCHASTIC_METHODS,
  type StochasticDistributionSummary,
  type StochasticMetricsView,
  type StochasticRobustnessRun,
  type StochasticRobustnessVerdict,
  type StochasticReasonCode,
  type StochasticResolvedConfig,
  type StochasticTailProbabilities,
} from "./types";

// ---------------------------------------------------------------------------
// canonical 摘要基础
// ---------------------------------------------------------------------------

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `拒绝含非有限数字 ${String(value)}（${path}）；Stochastic 记录禁止 NaN / Infinity`
      );
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteRecord(item, `${path}[${index}]`));
    return;
  }
  for (const key of Object.keys(value as object)) {
    assertFiniteRecord(
      (value as Record<string, unknown>)[key],
      path === "" ? key : `${path}.${key}`
    );
  }
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function bodyWithoutFingerprint<T>(record: T): Omit<T, "fingerprint"> {
  const body: Record<string, unknown> = { ...(record as object) };
  delete body.fingerprint;
  return body as Omit<T, "fingerprint">;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/** StochasticRobustnessRun 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256。 */
export function computeStochasticRunFingerprint(
  record: Omit<StochasticRobustnessRun, "fingerprint"> | StochasticRobustnessRun
): string {
  assertFiniteRecord(record, "record");
  return sha256Hex(canonicalStringify(bodyWithoutFingerprint(record)));
}

/** 输入指纹：源序列（含 sourceKind）+ tradeCount + 基准绩效的 canonical SHA-256。 */
export function computeStochasticInputFingerprint(input: {
  readonly sourceKind: string;
  readonly source: readonly number[];
  readonly tradeCount: number | null;
  readonly baseline: StochasticMetricsView;
}): string {
  assertFiniteRecord(input, "input");
  return sha256Hex(canonicalStringify(input));
}

/** 单次迭代抽样下标序列指纹（用于逐迭代复现审计）。 */
export function computeStochasticDrawFingerprint(drawIndexes: readonly number[]): string {
  assertFiniteRecord(drawIndexes, "drawIndexes");
  return sha256Hex(canonicalStringify(drawIndexes));
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

/** 序列化 StochasticRobustnessRun（canonical JSON；拒绝 NaN/Infinity；同内容必同串）。 */
export function serializeStochasticRobustnessRun(record: StochasticRobustnessRun): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

// ---------------------------------------------------------------------------
// 结构校验
// ---------------------------------------------------------------------------

const HEX64_RE = /^[0-9a-f]{64}$/;

const VERDICTS: readonly StochasticRobustnessVerdict[] = ["stable", "sensitive", "inconclusive"];
const REASON_CODES: readonly StochasticReasonCode[] = [
  "STOCHASTIC_STABLE",
  "STOCHASTIC_BASELINE_TAIL_FAVORABLE",
  "STOCHASTIC_RETURN_CI_INCLUDES_ZERO",
  "STOCHASTIC_RETURN_DISPERSION",
  "STOCHASTIC_DRAWDOWN_TAIL",
  "STOCHASTIC_INSUFFICIENT_ITERATIONS",
  "STOCHASTIC_INSUFFICIENT_SAMPLES",
  "STOCHASTIC_BASELINE_UNAVAILABLE",
];
const FLAGS: readonly string[] = [
  "RETURN_DISPERSION",
  "RETURN_CI_INCLUDES_ZERO",
  "DRAWDOWN_TAIL",
  "BASELINE_TAIL_FAVORABLE",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function checkMetricsView(
  value: unknown,
  path: string,
  issues: ResearchValidationIssue[]
): void {
  if (!isPlainObject(value)) {
    issues.push(issue("STOCH18_METRICS_INVALID", path, "绩效视图必须是对象"));
    return;
  }
  for (const field of ["totalReturnPct", "maxDrawdownPct"] as const) {
    if (!isFiniteNumber(value[field])) {
      issues.push(issue("STOCH18_METRIC_INVALID", `${path}.${field}`, `${field} 必须是有限数字`));
    }
  }
  if (isFiniteNumber(value.maxDrawdownPct) && value.maxDrawdownPct < 0) {
    issues.push(issue("STOCH18_METRIC_INVALID", `${path}.maxDrawdownPct`, "maxDrawdownPct 不能为负"));
  }
  if (value.sharpe !== null && !isFiniteNumber(value.sharpe)) {
    issues.push(issue("STOCH18_METRIC_INVALID", `${path}.sharpe`, "sharpe 必须为 null 或有限数字"));
  }
  if (value.tradeCount !== null && (typeof value.tradeCount !== "number" || !Number.isInteger(value.tradeCount) || value.tradeCount < 0)) {
    issues.push(issue("STOCH18_METRIC_INVALID", `${path}.tradeCount`, "tradeCount 必须为 null 或非负整数"));
  }
}

function checkInference(
  value: unknown,
  path: string,
  issues: ResearchValidationIssue[]
): void {
  if (!isPlainObject(value)) {
    issues.push(issue("STOCH18_INFERENCE_INVALID", path, "分布推断必须是对象"));
    return;
  }
  if (!isPlainObject(value.summary)) {
    issues.push(issue("STOCH18_SUMMARY_INVALID", `${path}.summary`, "分位摘要必须是对象"));
  } else {
    const summary = value.summary;
    if (!isFiniteNumber(summary.count) || (summary.count as number) < 1) {
      issues.push(issue("STOCH18_SUMMARY_COUNT_INVALID", `${path}.summary.count`, "count 必须是 >= 1 的整数"));
    }
    for (const field of ["mean", "min", "max", "p05", "p25", "median", "p75", "p95"] as const) {
      if (!isFiniteNumber(summary[field])) {
        issues.push(issue("STOCH18_SUMMARY_FIELD_INVALID", `${path}.summary.${field}`, `${field} 必须是有限数字`));
      }
    }
    if (summary.stdDev !== null && !isFiniteNumber(summary.stdDev)) {
      issues.push(issue("STOCH18_SUMMARY_FIELD_INVALID", `${path}.summary.stdDev`, "stdDev 必须为 null 或有限数字"));
    }
  }
  if (!isPlainObject(value.confidenceInterval)) {
    issues.push(issue("STOCH18_CI_INVALID", `${path}.confidenceInterval`, "置信区间必须是对象"));
  } else {
    for (const field of ["levelPct", "lower", "upper"] as const) {
      if (!isFiniteNumber(value.confidenceInterval[field])) {
        issues.push(issue("STOCH18_CI_FIELD_INVALID", `${path}.confidenceInterval.${field}`, `${field} 必须是有限数字`));
      }
    }
  }
  if (value.baselinePercentile !== null && !isFiniteNumber(value.baselinePercentile)) {
    issues.push(issue("STOCH18_PERCENTILE_INVALID", `${path}.baselinePercentile`, "baselinePercentile 必须为 null 或有限数字"));
  }
  if (typeof value.baselineWithinCi !== "boolean") {
    issues.push(issue("STOCH18_CI_FLAG_INVALID", `${path}.baselineWithinCi`, "必须是布尔"));
  }
  if (typeof value.baselineInTail !== "boolean") {
    issues.push(issue("STOCH18_CI_FLAG_INVALID", `${path}.baselineInTail`, "必须是布尔"));
  }
}

/** 校验 StochasticRobustnessRun 结构（顶层形态 + 关键字段一致性；指纹由 deserialize 复核）。 */
export function validateStochasticRobustnessRun(record: unknown): {
  valid: boolean;
  issues: ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  if (!isPlainObject(record)) {
    return {
      valid: false,
      issues: [issue("STOCH18_RUN_INVALID", "record", "StochasticRobustnessRun 必须是对象")],
    };
  }
  const r = record;
  if (r.recordKind !== STOCHASTIC_ROBUSTNESS_RUN_RECORD_KIND) {
    issues.push(
      issue("STOCH18_RUN_KIND_MISMATCH", "recordKind", `recordKind=${String(r.recordKind)} 不是 ${STOCHASTIC_ROBUSTNESS_RUN_RECORD_KIND}`)
    );
  }
  if (r.recordVersion !== STOCHASTIC_ROBUSTNESS_RUN_RECORD_VERSION) {
    issues.push(
      issue("STOCH18_RUN_VERSION_MISMATCH", "recordVersion", `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${STOCHASTIC_ROBUSTNESS_RUN_RECORD_VERSION}）`)
    );
  }
  for (const field of ["stochasticRunId", "strategyId", "strategyVersion", "createdAt"] as const) {
    if (typeof r[field] !== "string" || (r[field] as string).trim() === "") {
      issues.push(issue("STOCH18_RUN_FIELD_EMPTY", field, `${field} 必须是非空字符串`));
    }
  }
  if (typeof r.method !== "string" || !STOCHASTIC_METHODS.includes(r.method as never)) {
    issues.push(issue("STOCH18_RUN_METHOD_INVALID", "method", `method=${String(r.method)} 非法`));
  }
  if (!Number.isInteger(r.seed)) {
    issues.push(issue("STOCH18_RUN_SEED_INVALID", "seed", "seed 必须是整数"));
  }
  if (!Number.isInteger(r.iterations) || (r.iterations as number) < 1) {
    issues.push(issue("STOCH18_RUN_ITERATIONS_INVALID", "iterations", "iterations 必须是 >= 1 的整数"));
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issues.push(issue("STOCH18_RUN_FP_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制字符串"));
  }
  if (typeof r.inputFingerprint !== "string" || !HEX64_RE.test(r.inputFingerprint)) {
    issues.push(issue("STOCH18_RUN_INPUT_FP_INVALID", "inputFingerprint", "inputFingerprint 必须是 64 位十六进制字符串"));
  }

  // config
  if (!isPlainObject(r.config)) {
    issues.push(issue("STOCH18_CONFIG_INVALID", "config", "config 必须是对象"));
  } else {
    const config = r.config;
    for (const field of ["alpha", "confidenceLevelPct", "annualizationFactor", "tailDrawdownThresholdPct"] as const) {
      if (!isFiniteNumber(config[field])) {
        issues.push(issue("STOCH18_CONFIG_FIELD_INVALID", `config.${field}`, `${field} 必须是有限数字`));
      }
    }
    for (const field of ["iterations", "sourceLength", "minIterationsForVerdict"] as const) {
      if (!isFiniteNumber(config[field]) || !Number.isInteger(config[field]) || (config[field] as number) < 1) {
        issues.push(issue("STOCH18_CONFIG_FIELD_INVALID", `config.${field}`, `${field} 必须是 >= 1 的整数`));
      }
    }
    if (config.sourceKind !== "dailyReturn" && config.sourceKind !== "tradeReturn") {
      issues.push(issue("STOCH18_CONFIG_SOURCE_INVALID", "config.sourceKind", "sourceKind 非法"));
    }
    if (!isPlainObject(config.thresholds)) {
      issues.push(issue("STOCH18_CONFIG_THRESHOLDS_INVALID", "config.thresholds", "thresholds 必须是对象"));
    } else {
      for (const field of ["returnDriftThresholdPct", "drawdownWorseningThresholdPct"] as const) {
        if (!isFiniteNumber(config.thresholds[field])) {
          issues.push(issue("STOCH18_CONFIG_THRESHOLD_INVALID", `config.thresholds.${field}`, `${field} 必须是有限数字`));
        }
      }
    }
  }

  checkMetricsView(r.baseline, "baseline", issues);

  // distribution（成功样本为 0 时允许为 null，禁止伪造空分布）
  if (r.distribution === null) {
    // ok：inconclusive 情形
  } else if (!isPlainObject(r.distribution)) {
    issues.push(issue("STOCH18_DISTRIBUTION_INVALID", "distribution", "distribution 必须是对象或 null"));
  } else {
    const distribution = r.distribution as unknown as StochasticDistributionSummary;
    checkInference(distribution.totalReturnPct, "distribution.totalReturnPct", issues);
    checkInference(distribution.maxDrawdownPct, "distribution.maxDrawdownPct", issues);
    if (distribution.sharpe !== null && distribution.sharpe !== undefined) {
      checkInference(distribution.sharpe, "distribution.sharpe", issues);
    }
  }

  // tailProbabilities（同 distribution：允许 null）
  if (r.tailProbabilities === null) {
    // ok
  } else if (!isPlainObject(r.tailProbabilities)) {
    issues.push(issue("STOCH18_TAIL_INVALID", "tailProbabilities", "tailProbabilities 必须是对象或 null"));
  } else {
    const tail = r.tailProbabilities as unknown as StochasticTailProbabilities;
    for (const field of ["probLossPct", "probDrawdownExceedsPct", "drawdownThresholdPct"] as const) {
      if (!isFiniteNumber(tail[field])) {
        issues.push(issue("STOCH18_TAIL_FIELD_INVALID", `tailProbabilities.${field}`, `${field} 必须是有限数字`));
      }
    }
    if (tail.probNegativeSharpePct !== null && !isFiniteNumber(tail.probNegativeSharpePct)) {
      issues.push(issue("STOCH18_TAIL_FIELD_INVALID", "tailProbabilities.probNegativeSharpePct", "必须为 null 或有限数字"));
    }
  }

  // samples
  if (!Array.isArray(r.samples)) {
    issues.push(issue("STOCH18_SAMPLES_INVALID", "samples", "samples 必须是数组"));
  } else {
    (r.samples as unknown[]).forEach((sample, index) => {
      if (!isPlainObject(sample)) {
        issues.push(issue("STOCH18_SAMPLE_INVALID", `samples[${index}]`, "样本必须是对象"));
        return;
      }
      if (!Number.isInteger(sample.iteration) || (sample.iteration as number) < 0) {
        issues.push(issue("STOCH18_SAMPLE_ITERATION_INVALID", `samples[${index}].iteration`, "iteration 必须是非负整数"));
      }
      if (sample.status !== "succeeded" && sample.status !== "failed") {
        issues.push(issue("STOCH18_SAMPLE_STATUS_INVALID", `samples[${index}].status`, "status 必须是 succeeded | failed"));
      } else if (sample.status === "succeeded") {
        if (sample.metrics === null) {
          issues.push(issue("STOCH18_SAMPLE_METRICS_INVALID", `samples[${index}].metrics`, "succeeded 样本必须携带 metrics"));
        } else {
          checkMetricsView(sample.metrics, `samples[${index}].metrics`, issues);
        }
        if (sample.error !== null) {
          issues.push(issue("STOCH18_SAMPLE_ERROR_INVALID", `samples[${index}].error`, "succeeded 样本 error 必须为 null"));
        }
      } else {
        if (sample.metrics !== null) {
          issues.push(issue("STOCH18_SAMPLE_METRICS_INVALID", `samples[${index}].metrics`, "failed 样本 metrics 必须为 null"));
        }
        if (typeof sample.error !== "string" || sample.error.trim() === "") {
          issues.push(issue("STOCH18_SAMPLE_ERROR_INVALID", `samples[${index}].error`, "failed 样本 error 必须是非空字符串"));
        }
      }
      if (typeof sample.drawFingerprint !== "string" || !HEX64_RE.test(sample.drawFingerprint)) {
        issues.push(issue("STOCH18_SAMPLE_FP_INVALID", `samples[${index}].drawFingerprint`, "drawFingerprint 必须是 64 位十六进制字符串"));
      }
    });
  }

  // conclusion
  if (!isPlainObject(r.conclusion)) {
    issues.push(issue("STOCH18_CONCLUSION_INVALID", "conclusion", "conclusion 必须是对象"));
  } else {
    const conclusion = r.conclusion;
    if (typeof conclusion.verdict !== "string" || !VERDICTS.includes(conclusion.verdict as StochasticRobustnessVerdict)) {
      issues.push(issue("STOCH18_CONCLUSION_VERDICT_INVALID", "conclusion.verdict", `verdict=${String(conclusion.verdict)} 非法`));
    }
    if (typeof conclusion.reasonCode !== "string" || !REASON_CODES.includes(conclusion.reasonCode as StochasticReasonCode)) {
      issues.push(issue("STOCH18_CONCLUSION_REASON_INVALID", "conclusion.reasonCode", `reasonCode=${String(conclusion.reasonCode)} 非法`));
    }
    if (!Array.isArray(conclusion.flags)) {
      issues.push(issue("STOCH18_CONCLUSION_FLAGS_INVALID", "conclusion.flags", "flags 必须是数组"));
    } else {
      (conclusion.flags as unknown[]).forEach((flag, index) => {
        if (typeof flag !== "string" || !FLAGS.includes(flag)) {
          issues.push(issue("STOCH18_CONCLUSION_FLAG_INVALID", `conclusion.flags[${index}]`, `flag=${String(flag)} 非法`));
        }
      });
    }
    for (const field of ["successCount", "failedCount", "minIterationsForVerdict"] as const) {
      if (!isFiniteNumber(conclusion[field]) || !Number.isInteger(conclusion[field]) || (conclusion[field] as number) < 0) {
        issues.push(issue("STOCH18_CONCLUSION_COUNT_INVALID", `conclusion.${field}`, `${field} 必须是非负整数`));
      }
    }
    if (typeof conclusion.interpretation !== "string" || conclusion.interpretation.trim() === "") {
      issues.push(issue("STOCH18_CONCLUSION_TEXT_INVALID", "conclusion.interpretation", "interpretation 必须是非空字符串"));
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 反序列化
// ---------------------------------------------------------------------------

/** 反序列化 StochasticRobustnessRun：结构校验 + 指纹完整性复核（防篡改 / 防退化）。 */
export function deserializeStochasticRobustnessRun(json: string): StochasticRobustnessRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `StochasticRobustnessRun 反序列化失败：JSON 解析错误（${(error as Error).message}）`
    );
  }
  const validation = validateStochasticRobustnessRun(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const record = parsed as StochasticRobustnessRun;
  const recomputed = computeStochasticRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new ResearchValidationError([
      {
        code: "STOCH18_RUN_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
      },
    ]);
  }
  return record;
}

/** 断言记录合法（结构 + 指纹）；非法抛 ResearchValidationError。 */
export function assertValidStochasticRobustnessRun(record: unknown): void {
  const validation = validateStochasticRobustnessRun(record);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const typed = record as StochasticRobustnessRun;
  const recomputed = computeStochasticRunFingerprint(typed);
  if (typed.fingerprint !== recomputed) {
    throw new ResearchValidationError([
      {
        code: "STOCH18_RUN_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配：期望 ${recomputed}，实际 ${typed.fingerprint}`,
      },
    ]);
  }
}

/** 解析后的配置结构校验（供 run.ts 出口自检）。 */
export function isResolvedStochasticConfig(value: unknown): value is StochasticResolvedConfig {
  return (
    isPlainObject(value) &&
    typeof value.method === "string" &&
    STOCHASTIC_METHODS.includes(value.method as never)
  );
}
