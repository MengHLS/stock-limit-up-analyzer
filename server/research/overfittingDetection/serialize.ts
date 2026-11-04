/**
 * STEP 20 / C-20.1 — 过拟合检测（第一批）：序列化 + 指纹 + 结构校验 + round-trip。
 *
 * 铁律（对齐 researchDataset/version.ts canonical 范式与 C-18.1 serialize.ts）：
 *   - 指纹与序列化使用按键字典序排序的 canonical JSON（canonicalStringify），
 *     同内容必同串，不依赖对象键插入顺序；
 *   - NaN / ±Infinity 在进入指纹 / 序列化前直接抛错（绝不静默转 null）；
 *   - fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - deserialize：JSON → 结构校验（validate*）→ 指纹复核（防篡改 / 防字段退化）。
 *
 * 覆盖：
 *   - OfdPboResult 序列化 / 反序列化 / 结构校验 / 指纹复核；
 *   - ParameterSensitivityResult 同上；
 *   - OverfittingAssessmentRun 同上（含 recordKind / recordVersion 守门）。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import {
  OVERFITTING_ASSESSMENT_RUN_RECORD_KIND,
  OVERFITTING_ASSESSMENT_RUN_RECORD_VERSION,
  OFD_PBO_RESULT_RECORD_VERSION,
  PARAMETER_SENSITIVITY_RECORD_VERSION,
  type OverfittingAssessmentRun,
  type ParameterSensitivityResult,
  type OfdPboResult,
} from "./types";

// ---------------------------------------------------------------------------
// canonical 摘要基础
// ---------------------------------------------------------------------------

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝含非有限数字 ${String(value)}（${path}）；C-20.1 记录禁止 NaN / Infinity`);
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
      path === "" ? key : `${path}.${key}`,
    );
  }
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 剔除顶层 fingerprint 字段后的对象（用于指纹摘要与序列化前校验）。 */
function bodyWithoutFingerprint<T>(record: T): Omit<T, "fingerprint"> {
  const body: Record<string, unknown> = { ...(record as object) };
  delete body.fingerprint;
  return body as Omit<T, "fingerprint">;
}

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

// ---------------------------------------------------------------------------
// OfdPboResult
// ---------------------------------------------------------------------------

/** OfdPboResult 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeOfdPboResultFingerprint(
  record: Omit<OfdPboResult, "fingerprint"> | OfdPboResult,
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

/** 序列化 OfdPboResult（canonical JSON；拒绝 NaN / Infinity；同内容必同串）。 */
export function serializeOfdPboResult(record: OfdPboResult): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

const PBO_CONCLUSIONS: readonly string[] = ["OVERFIT_RISK_HIGH", "OVERFIT_RISK_MODERATE", "OVERFIT_RISK_LOW", "INCONCLUSIVE"];
const PBO_METRICS: readonly string[] = ["totalReturnPct", "sharpeRatio", "custom"];
const PBO_DIRECTIONS: readonly string[] = ["maximize", "minimize"];

/** 校验 OfdPboResult 结构（顶层形态 + 关键字段一致性；指纹完整性由 deserialize 复核）。 */
export function validateOfdPboResult(record: unknown): {
  readonly valid: boolean;
  readonly issues: readonly ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  if (!isPlainObject(record)) {
    return { valid: false, issues: [issue("PBO_RESULT_INVALID", "record", "OfdPboResult 必须是对象")] };
  }
  const r = record as Record<string, unknown>;
  if (r.recordVersion !== OFD_PBO_RESULT_RECORD_VERSION) {
    issues.push(
      issue(
        "PBO_RESULT_VERSION_MISMATCH",
        "recordVersion",
        `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${OFD_PBO_RESULT_RECORD_VERSION}）`,
      ),
    );
  }
  if (!Number.isInteger(r.numPartitions) || (r.numPartitions as number) < 4 || (r.numPartitions as number) % 2 !== 0) {
    issues.push(issue("PBO_RESULT_BLOCKS_INVALID", "numPartitions", "numPartitions 必须为 >= 4 的偶数"));
  }
  if (typeof r.numCombinations !== "number" || !Number.isInteger(r.numCombinations) || r.numCombinations < 0) {
    issues.push(issue("PBO_RESULT_NUM_COMBINATIONS_INVALID", "numCombinations", "numCombinations 必须是非负整数"));
  }
  if (typeof r.evaluatedCombinations !== "number" || !Number.isInteger(r.evaluatedCombinations) || r.evaluatedCombinations < 0) {
    issues.push(issue("PBO_RESULT_EVALUATED_INVALID", "evaluatedCombinations", "evaluatedCombinations 必须是非负整数"));
  }
  if (typeof r.overfitCount !== "number" || !Number.isInteger(r.overfitCount) || r.overfitCount < 0) {
    issues.push(issue("PBO_RESULT_OVERFIT_COUNT_INVALID", "overfitCount", "overfitCount 必须是非负整数"));
  }
  if (r.pbo !== null && (!isFiniteNumber(r.pbo) || (r.pbo as number) < 0 || (r.pbo as number) > 1)) {
    issues.push(issue("PBO_RESULT_VALUE_OUT_OF_RANGE", "pbo", "pbo 必须为 null 或 [0,1] 的有限数字"));
  }
  if (r.status !== "computed" && r.status !== "insufficient_data") {
    issues.push(issue("PBO_RESULT_STATUS_INVALID", "status", "status 必须是 computed | insufficient_data"));
  }
  if (typeof r.metric !== "string" || !PBO_METRICS.includes(r.metric)) {
    issues.push(issue("PBO_RESULT_METRIC_INVALID", "metric", `metric=${String(r.metric)} 非法`));
  }
  if (typeof r.direction !== "string" || !PBO_DIRECTIONS.includes(r.direction)) {
    issues.push(issue("PBO_RESULT_DIRECTION_INVALID", "direction", `direction=${String(r.direction)} 非法`));
  }
  if (typeof r.conclusion !== "string" || !PBO_CONCLUSIONS.includes(r.conclusion)) {
    issues.push(issue("PBO_RESULT_CONCLUSION_INVALID", "conclusion", `conclusion=${String(r.conclusion)} 非法`));
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issues.push(issue("PBO_RESULT_FP_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制字符串"));
  }
  if (!Array.isArray(r.splitResults)) {
    issues.push(issue("PBO_RESULT_SPLITS_INVALID", "splitResults", "splitResults 必须是数组"));
  }
  return { valid: issues.length === 0, issues };
}

/** 反序列化 OfdPboResult：结构校验 + 指纹完整性复核（防篡改 / 防字段退化）。 */
export function deserializeOfdPboResult(json: string): OfdPboResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`OfdPboResult 反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  const validation = validateOfdPboResult(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError([...validation.issues]);
  }
  const record = parsed as OfdPboResult;
  const recomputed = computeOfdPboResultFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new ResearchValidationError([
      {
        code: "PBO_RESULT_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
      },
    ]);
  }
  return structuredClone(record);
}

// ---------------------------------------------------------------------------
// ParameterSensitivityResult
// ---------------------------------------------------------------------------

const PS_VERDICTS: readonly string[] = ["baseline", "stable", "sensitive", "failed", "skipped"];
const PS_CONCLUSIONS: readonly string[] = ["SENSITIVE", "STABLE", "INCONCLUSIVE", "NO_VARIANTS"];

/** ParameterSensitivityResult 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeParameterSensitivityResultFingerprint(
  record: Omit<ParameterSensitivityResult, "fingerprint"> | ParameterSensitivityResult,
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

/** 序列化 ParameterSensitivityResult（canonical JSON；拒绝 NaN / Infinity）。 */
export function serializeParameterSensitivityResult(record: ParameterSensitivityResult): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

/** 校验 ParameterSensitivityResult 结构（顶层形态 + 关键字段一致性）。 */
export function validateParameterSensitivityResult(record: unknown): {
  readonly valid: boolean;
  readonly issues: readonly ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  if (!isPlainObject(record)) {
    return {
      valid: false,
      issues: [issue("PS_RESULT_INVALID", "record", "ParameterSensitivityResult 必须是对象")],
    };
  }
  const r = record as Record<string, unknown>;
  if (r.recordVersion !== PARAMETER_SENSITIVITY_RECORD_VERSION) {
    issues.push(
      issue(
        "PS_RESULT_VERSION_MISMATCH",
        "recordVersion",
        `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${PARAMETER_SENSITIVITY_RECORD_VERSION}）`,
      ),
    );
  }
  if (!isPlainObject(r.baseParameterSet)) {
    issues.push(issue("PS_RESULT_BASE_INVALID", "baseParameterSet", "baseParameterSet 必须是对象"));
  }
  if (!Array.isArray(r.rules)) {
    issues.push(issue("PS_RESULT_RULES_INVALID", "rules", "rules 必须是数组"));
  }
  if (!isPlainObject(r.thresholds)) {
    issues.push(issue("PS_RESULT_THRESHOLDS_INVALID", "thresholds", "thresholds 必须是对象"));
  } else {
    for (const field of ["returnDriftThresholdPct", "drawdownWorseningThresholdPct"] as const) {
      if (!isFiniteNumber(r.thresholds[field])) {
        issues.push(
          issue("PS_RESULT_THRESHOLD_INVALID", `thresholds.${field}`, `${field} 必须是有限数字`),
        );
      }
    }
  }
  if (!Array.isArray(r.samples) || r.samples.length === 0) {
    issues.push(issue("PS_RESULT_SAMPLES_INVALID", "samples", "samples 必须是非空数组"));
  } else {
    (r.samples as unknown[]).forEach((sample, index) => {
      if (!isPlainObject(sample)) {
        issues.push(issue("PS_RESULT_SAMPLE_INVALID", `samples[${index}]`, "样本必须是对象"));
        return;
      }
      if (typeof sample.perturbationCode !== "string" || (sample.perturbationCode as string).trim() === "") {
        issues.push(
          issue(
            "PS_RESULT_SAMPLE_CODE_EMPTY",
            `samples[${index}].perturbationCode`,
            "perturbationCode 必须是非空字符串",
          ),
        );
      }
      if (typeof sample.verdict !== "string" || !PS_VERDICTS.includes(sample.verdict as string)) {
        issues.push(
          issue(
            "PS_RESULT_SAMPLE_VERDICT_INVALID",
            `samples[${index}].verdict`,
            `verdict=${String(sample.verdict)} 非法`,
          ),
        );
      }
      if (!isPlainObject(sample.perturbedParameterSet)) {
        issues.push(
          issue(
            "PS_RESULT_SAMPLE_PARAM_SET_INVALID",
            `samples[${index}].perturbedParameterSet`,
            "perturbedParameterSet 必须是对象",
          ),
        );
      }
    });
  }
  if (typeof r.conclusion !== "string" || !PS_CONCLUSIONS.includes(r.conclusion as string)) {
    issues.push(issue("PS_RESULT_CONCLUSION_INVALID", "conclusion", `conclusion=${String(r.conclusion)} 非法`));
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issues.push(issue("PS_RESULT_FP_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制字符串"));
  }
  return { valid: issues.length === 0, issues };
}

/** 反序列化 ParameterSensitivityResult：结构校验 + 指纹完整性复核。 */
export function deserializeParameterSensitivityResult(json: string): ParameterSensitivityResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`ParameterSensitivityResult 反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  const validation = validateParameterSensitivityResult(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError([...validation.issues]);
  }
  const record = parsed as ParameterSensitivityResult;
  const recomputed = computeParameterSensitivityResultFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new ResearchValidationError([
      {
        code: "PS_RESULT_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
      },
    ]);
  }
  return structuredClone(record);
}

// ---------------------------------------------------------------------------
// OverfittingAssessmentRun
// ---------------------------------------------------------------------------

const OFA_CONCLUSIONS: readonly string[] = ["OVERFIT", "OVERFIT_RISK", "NOT_OVERFIT", "INCONCLUSIVE", "NO_EVAL"];

/** OverfittingAssessmentRun 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeOverfittingAssessmentRunFingerprint(
  record: Omit<OverfittingAssessmentRun, "fingerprint"> | OverfittingAssessmentRun,
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

/** 序列化 OverfittingAssessmentRun（canonical JSON；拒绝 NaN / Infinity）。 */
export function serializeOverfittingAssessmentRun(record: OverfittingAssessmentRun): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

/** 校验 OverfittingAssessmentRun 结构（顶层形态 + 关键字段一致性）。 */
export function validateOverfittingAssessmentRun(record: unknown): {
  readonly valid: boolean;
  readonly issues: readonly ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  if (!isPlainObject(record)) {
    return {
      valid: false,
      issues: [issue("OFA_RUN_INVALID", "record", "OverfittingAssessmentRun 必须是对象")],
    };
  }
  const r = record as Record<string, unknown>;
  if (r.recordKind !== OVERFITTING_ASSESSMENT_RUN_RECORD_KIND) {
    issues.push(
      issue(
        "OFA_RUN_KIND_MISMATCH",
        "recordKind",
        `recordKind=${String(r.recordKind)} 不是 ${OVERFITTING_ASSESSMENT_RUN_RECORD_KIND}`,
      ),
    );
  }
  if (r.recordVersion !== OVERFITTING_ASSESSMENT_RUN_RECORD_VERSION) {
    issues.push(
      issue(
        "OFA_RUN_VERSION_MISMATCH",
        "recordVersion",
        `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${OVERFITTING_ASSESSMENT_RUN_RECORD_VERSION}）`,
      ),
    );
  }
  for (const field of ["assessmentRunId", "strategyId", "strategyVersion", "createdAt"] as const) {
    if (typeof r[field] !== "string" || (r[field] as string).trim() === "") {
      issues.push(issue("OFA_RUN_FIELD_EMPTY", field, `${field} 必须是非空字符串`));
    }
  }
  if (!isPlainObject(r.thresholds)) {
    issues.push(issue("OFA_RUN_THRESHOLDS_INVALID", "thresholds", "thresholds 必须是对象"));
  } else {
    for (const field of ["pboHigh", "pboMedium"] as const) {
      if (!isFiniteNumber(r.thresholds[field])) {
        issues.push(issue("OFA_RUN_THRESHOLD_INVALID", `thresholds.${field}`, `${field} 必须是有限数字`));
      }
    }
  }
  if (typeof r.conclusion !== "string" || !OFA_CONCLUSIONS.includes(r.conclusion as string)) {
    issues.push(issue("OFA_RUN_CONCLUSION_INVALID", "conclusion", `conclusion=${String(r.conclusion)} 非法`));
  }
  if (!Array.isArray(r.reasons)) {
    issues.push(issue("OFA_RUN_REASONS_INVALID", "reasons", "reasons 必须是数组"));
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issues.push(issue("OFA_RUN_FP_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制字符串"));
  }
  return { valid: issues.length === 0, issues };
}

/** 反序列化 OverfittingAssessmentRun：结构校验 + 指纹完整性复核。 */
export function deserializeOverfittingAssessmentRun(json: string): OverfittingAssessmentRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`OverfittingAssessmentRun 反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  const validation = validateOverfittingAssessmentRun(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError([...validation.issues]);
  }
  const record = parsed as OverfittingAssessmentRun;
  const recomputed = computeOverfittingAssessmentRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new ResearchValidationError([
      {
        code: "OFA_RUN_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
      },
    ]);
  }
  return structuredClone(record);
}
