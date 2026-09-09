/**
 * STEP 18 / C-18.1 — RobustnessRun 序列化 + 指纹 + 结构校验（纯函数、确定性）。
 *
 * 铁律（对齐 C-17.1 serialize.ts / researchDataset version.ts canonical 范式）：
 *   - 指纹与序列化使用按键字典序排序的 canonical JSON（canonicalStringify），
 *     同内容必同串，不依赖对象键插入顺序；NaN / ±Infinity 在进入指纹/序列化前
 *     递归扫描并直接抛错（canonicalStringify 会把 NaN 静默转 null，必须先拦截）；
 *   - fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - deserialize：JSON → 结构校验（validateRobustnessRun）→ 指纹复核，
 *     任何字段被篡改 / 数值退化都会导致指纹不匹配而抛错。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import {
  ROBUSTNESS_RUN_RECORD_KIND,
  ROBUSTNESS_RUN_RECORD_VERSION,
  type PerturbationItem,
  type RobustnessRun,
} from "./types";

// ---------------------------------------------------------------------------
// canonical 摘要基础
// ---------------------------------------------------------------------------

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝含非有限数字 ${String(value)}（${path}）；Robustness 记录禁止 NaN / Infinity`);
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

/** 剔除顶层 fingerprint 字段后的对象（用于指纹摘要）。 */
function bodyWithoutFingerprint<T>(record: T): Omit<T, "fingerprint"> {
  const body: Record<string, unknown> = { ...(record as object) };
  delete body.fingerprint;
  return body as Omit<T, "fingerprint">;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/** RobustnessRun 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeRobustnessRunFingerprint(
  record: Omit<RobustnessRun, "fingerprint"> | RobustnessRun
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

/** 单条扰动「扰动后配置」内容指纹（axis/config 的 canonical SHA-256；用于逐样本回显）。 */
export function computePerturbationConfigFingerprint(item: PerturbationItem): string {
  assertFiniteRecord(item.config, "item.config");
  return sha256Hex(canonicalStringify(item.config));
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

/** 序列化 RobustnessRun（canonical JSON；拒绝 NaN/Infinity；同内容必同串）。 */
export function serializeRobustnessRun(record: RobustnessRun): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

// ---------------------------------------------------------------------------
// 结构校验（供 deserialize / 测试）
// ---------------------------------------------------------------------------

const HEX64_RE = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

const ROBUSTNESS_AXES: readonly string[] = ["cost", "slippage", "parameter", "execution"];
const SAMPLE_VERDICTS: readonly string[] = ["baseline", "stable", "sensitive", "failed"];

/** 校验 RobustnessRun 结构（顶层形态 + samples 关键字段一致性；指纹完整性由 deserialize 复核）。 */
export function validateRobustnessRun(record: unknown): {
  valid: boolean;
  issues: ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  if (!isPlainObject(record)) {
    return {
      valid: false,
      issues: [issue("RB18_RUN_INVALID", "record", "RobustnessRun 必须是对象")],
    };
  }
  const r = record as Record<string, unknown>;
  if (r.recordKind !== ROBUSTNESS_RUN_RECORD_KIND) {
    issues.push(
      issue("RB18_RUN_KIND_MISMATCH", "recordKind", `recordKind=${String(r.recordKind)} 不是 ${ROBUSTNESS_RUN_RECORD_KIND}`)
    );
  }
  if (r.recordVersion !== ROBUSTNESS_RUN_RECORD_VERSION) {
    issues.push(
      issue(
        "RB18_RUN_VERSION_MISMATCH",
        "recordVersion",
        `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${ROBUSTNESS_RUN_RECORD_VERSION}）`
      )
    );
  }
  for (const field of ["robustnessRunId", "strategyId", "strategyVersion", "createdAt"] as const) {
    if (typeof r[field] !== "string" || (r[field] as string).trim() === "") {
      issues.push(issue("RB18_RUN_FIELD_EMPTY", field, `${field} 必须是非空字符串`));
    }
  }
  if (typeof r.axis !== "string" || !ROBUSTNESS_AXES.includes(r.axis)) {
    issues.push(
      issue("RB18_RUN_AXIS_INVALID", "axis", `axis=${String(r.axis)} 非法（期望 ${ROBUSTNESS_AXES.join("|")}）`)
    );
  }
  if (!isPlainObject(r.thresholds)) {
    issues.push(issue("RB18_RUN_THRESHOLDS_INVALID", "thresholds", "thresholds 必须是对象"));
  } else {
    const thresholds = r.thresholds;
    for (const field of ["returnDriftThresholdPct", "drawdownWorseningThresholdPct"] as const) {
      if (!isFiniteNumber(thresholds[field])) {
        issues.push(
          issue("RB18_RUN_THRESHOLD_INVALID", `thresholds.${field}`, `${field} 必须是有限数字`)
        );
      }
    }
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issues.push(issue("RB18_RUN_FP_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制字符串"));
  }

  // samples：数组、非空、索引 0 基准、唯一基准、同轴、逐条形态。
  if (!Array.isArray(r.samples)) {
    issues.push(issue("RB18_RUN_SAMPLES_INVALID", "samples", "samples 必须是数组"));
  } else if ((r.samples as unknown[]).length === 0) {
    issues.push(issue("RB18_RUN_SAMPLES_EMPTY", "samples", "samples 不能为空（至少含基准条目）"));
  } else {
    const samples = r.samples as unknown[];
    samples.forEach((sample, index) => {
      if (!isPlainObject(sample)) {
        issues.push(issue("RB18_RUN_SAMPLE_INVALID", `samples[${index}]`, "样本必须是对象"));
        return;
      }
      const perturbation = sample.perturbation;
      if (!isPlainObject(perturbation)) {
        issues.push(issue("RB18_RUN_SAMPLE_PERT_INVALID", `samples[${index}].perturbation`, "样本缺扰动条目"));
        return;
      }
      const axis = perturbation.axis;
      if (typeof axis !== "string" || !ROBUSTNESS_AXES.includes(axis)) {
        issues.push(issue("RB18_RUN_SAMPLE_AXIS_INVALID", `samples[${index}].perturbation.axis`, "axis 非法"));
      } else if (typeof r.axis === "string" && r.axis !== axis) {
        issues.push(
          issue(
            "RB18_RUN_SAMPLE_AXIS_MIXED",
            `samples[${index}].perturbation.axis`,
            `样本轴 ${axis} 与运行轴 ${r.axis} 不一致`
          )
        );
      }
      for (const field of ["code", "label"] as const) {
        if (typeof perturbation[field] !== "string" || (perturbation[field] as string).trim() === "") {
          issues.push(
            issue("RB18_RUN_SAMPLE_FIELD_EMPTY", `samples[${index}].perturbation.${field}`, `${field} 必须是非空字符串`)
          );
        }
      }
      if (index === 0) {
        if (perturbation.isBaseline !== true) {
          issues.push(
            issue("RB18_RUN_BASELINE_NOT_FIRST", "samples[0].perturbation.isBaseline", "索引 0 必须是基准条目")
          );
        }
      } else if (perturbation.isBaseline === true) {
        issues.push(
          issue(
            "RB18_RUN_BASELINE_DUPLICATE",
            `samples[${index}].perturbation.isBaseline`,
            "基准条目只能存在一条且位于索引 0"
          )
        );
      }
      if (sample.status !== "succeeded" && sample.status !== "failed") {
        issues.push(issue("RB18_RUN_SAMPLE_STATUS_INVALID", `samples[${index}].status`, "status 必须是 succeeded | failed"));
      }
      const isSuccess = sample.status === "succeeded";
      if (isSuccess) {
        if (!isPlainObject(sample.metrics)) {
          issues.push(issue("RB18_RUN_SAMPLE_METRICS_INVALID", `samples[${index}].metrics`, "succeeded 样本必须携带 metrics"));
        } else {
          for (const field of ["totalReturnPct", "maxDrawdownPct"] as const) {
            if (!isFiniteNumber(sample.metrics[field])) {
              issues.push(issue("RB18_RUN_SAMPLE_METRIC_INVALID", `samples[${index}].metrics.${field}`, "指标必须有限"));
            }
          }
          const tradeCount = sample.metrics.tradeCount;
          if (tradeCount !== null && (typeof tradeCount !== "number" || !Number.isInteger(tradeCount) || tradeCount < 0)) {
            issues.push(issue("RB18_RUN_SAMPLE_TRADE_COUNT_INVALID", `samples[${index}].metrics.tradeCount`, "tradeCount 必须为 null 或非负整数"));
          }
        }
        if (sample.error !== null) {
          issues.push(issue("RB18_RUN_SAMPLE_ERROR_INVALID", `samples[${index}].error`, "succeeded 样本 error 必须为 null"));
        }
      } else {
        if (sample.metrics !== null) {
          issues.push(issue("RB18_RUN_SAMPLE_METRICS_INVALID", `samples[${index}].metrics`, "failed 样本 metrics 必须为 null"));
        }
        if (typeof sample.error !== "string" || sample.error.trim() === "") {
          issues.push(issue("RB18_RUN_SAMPLE_ERROR_INVALID", `samples[${index}].error`, "failed 样本 error 必须是非空字符串"));
        }
      }
      const verdict = sample.verdict;
      if (typeof verdict !== "string" || !SAMPLE_VERDICTS.includes(verdict)) {
        issues.push(issue("RB18_RUN_SAMPLE_VERDICT_INVALID", `samples[${index}].verdict`, `verdict=${String(verdict)} 非法`));
      }
      if (!isPlainObject(sample.drift) && sample.drift !== null) {
        issues.push(issue("RB18_RUN_SAMPLE_DRIFT_INVALID", `samples[${index}].drift`, "drift 必须是对象或 null"));
      }
      if (typeof sample.configFingerprint !== "string" || !HEX64_RE.test(sample.configFingerprint)) {
        issues.push(issue("RB18_RUN_SAMPLE_FP_INVALID", `samples[${index}].configFingerprint`, "configFingerprint 必须是 64 位十六进制字符串"));
      }
    });
  }

  if (!isPlainObject(r.conclusion)) {
    issues.push(issue("RB18_RUN_CONCLUSION_INVALID", "conclusion", "conclusion 必须是对象"));
  } else {
    const conclusion = r.conclusion;
    const verdicts = ["sensitive", "stable", "insufficient", "no-variants", "no-conclusion"];
    if (typeof conclusion.axis !== "string" || !ROBUSTNESS_AXES.includes(conclusion.axis)) {
      issues.push(issue("RB18_RUN_CONCLUSION_AXIS_INVALID", "conclusion.axis", "结论轴非法"));
    } else if (typeof r.axis === "string" && conclusion.axis !== r.axis) {
      issues.push(issue("RB18_RUN_CONCLUSION_AXIS_MISMATCH", "conclusion.axis", "结论轴与运行轴不一致"));
    }
    if (typeof conclusion.verdict !== "string" || !verdicts.includes(conclusion.verdict)) {
      issues.push(issue("RB18_RUN_CONCLUSION_VERDICT_INVALID", "conclusion.verdict", "结论 verdict 非法"));
    }
    for (const field of ["sampleCount", "succeededCount", "failedCount", "sensitiveCount", "stableCount"] as const) {
      if (!isFiniteNumber(conclusion[field]) || !Number.isInteger(conclusion[field]) || (conclusion[field] as number) < 0) {
        issues.push(issue("RB18_RUN_CONCLUSION_COUNT_INVALID", `conclusion.${field}`, `${field} 必须是非负整数`));
      }
    }
    if (typeof conclusion.baselineSucceeded !== "boolean") {
      issues.push(issue("RB18_RUN_CONCLUSION_BASELINE_INVALID", "conclusion.baselineSucceeded", "必须是布尔"));
    }
    if (!Array.isArray(conclusion.sensitiveEntries)) {
      issues.push(issue("RB18_RUN_CONCLUSION_ENTRIES_INVALID", "conclusion.sensitiveEntries", "必须是数组"));
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 反序列化
// ---------------------------------------------------------------------------

/** 反序列化 RobustnessRun：结构校验 + 指纹完整性复核（防篡改 / 防字段退化）。 */
export function deserializeRobustnessRun(json: string): RobustnessRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`RobustnessRun 反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  const validation = validateRobustnessRun(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const record = parsed as RobustnessRun;
  const recomputed = computeRobustnessRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new ResearchValidationError([
      {
        code: "RB18_RUN_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
      },
    ]);
  }
  return record;
}
