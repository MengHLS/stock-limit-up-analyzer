/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化：序列化 + 指纹 + 结构校验 + round-trip。
 *
 * 铁律（对齐 researchDataset/version.ts canonical 范式与 C-20.1/C-18.1 serialize）：
 *   - 指纹与序列化使用按键字典序排序的 canonical JSON（canonicalStringify）；
 *   - NaN / ±Infinity 在进入指纹 / 序列化前直接抛错（绝不静默转 null）；
 *   - fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - deserialize：JSON → 结构校验（validateAblationAssessmentRun）→ 指纹复核
 *     （防篡改 / 防字段退化）。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import {
  ABLATION_ASSESSMENT_RUN_RECORD_KIND,
  ABLATION_ASSESSMENT_RUN_RECORD_VERSION,
  ABLATION_COMPONENT_KINDS,
  ABLATION_MODES,
  ABLATION_OVERFIT_SIGNAL_CODES,
  ABLATION_REASON_CODES,
  type AblationAssessmentRun,
} from "./types";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝含非有限数字 ${String(value)}（${path}）；C-20.2 记录禁止 NaN / Infinity`);
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

/** AblationAssessmentRun 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeAblationAssessmentRunFingerprint(
  record: Omit<AblationAssessmentRun, "fingerprint"> | AblationAssessmentRun,
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

/** 序列化 AblationAssessmentRun（canonical JSON；拒绝 NaN / Infinity；同内容必同串）。 */
export function serializeAblationAssessmentRun(record: AblationAssessmentRun): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

/** 校验 AblationAssessmentRun 结构（顶层形态 + 关键字段一致性；指纹完整性由 deserialize 复核）。 */
export function validateAblationAssessmentRun(record: unknown): {
  readonly valid: boolean;
  readonly issues: readonly ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  if (!isPlainObject(record)) {
    return {
      valid: false,
      issues: [issue("ABL_RUN_INVALID", "record", "AblationAssessmentRun 必须是对象")],
    };
  }
  const r = record as Record<string, unknown>;
  if (r.recordKind !== ABLATION_ASSESSMENT_RUN_RECORD_KIND) {
    issues.push(
      issue(
        "ABL_RUN_KIND_MISMATCH",
        "recordKind",
        `recordKind=${String(r.recordKind)} 不是 ${ABLATION_ASSESSMENT_RUN_RECORD_KIND}`,
      ),
    );
  }
  if (r.recordVersion !== ABLATION_ASSESSMENT_RUN_RECORD_VERSION) {
    issues.push(
      issue(
        "ABL_RUN_VERSION_MISMATCH",
        "recordVersion",
        `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${ABLATION_ASSESSMENT_RUN_RECORD_VERSION}）`,
      ),
    );
  }
  for (const field of ["ablationRunId", "strategyId", "strategyVersion", "createdAt"] as const) {
    if (typeof r[field] !== "string" || (r[field] as string).trim() === "") {
      issues.push(issue("ABL_RUN_FIELD_EMPTY", field, `${field} 必须是非空字符串`));
    }
  }
  if (typeof r.mode !== "string" || !ABLATION_MODES.includes(r.mode as never)) {
    issues.push(issue("ABL_RUN_MODE_INVALID", "mode", `mode=${String(r.mode)} 非法`));
  }
  if (!Array.isArray(r.components) || r.components.length < 2) {
    issues.push(issue("ABL_RUN_COMPONENTS_INVALID", "components", "components 必须是 >= 2 的数组"));
  } else {
    (r.components as unknown[]).forEach((component, index) => {
      if (!isPlainObject(component)) {
        issues.push(issue("ABL_RUN_COMPONENT_INVALID", `components[${index}]`, "成分必须是对象"));
        return;
      }
      if (typeof component.targetId !== "string" || (component.targetId as string).trim() === "") {
        issues.push(issue("ABL_RUN_COMPONENT_ID_INVALID", `components[${index}].targetId`, "targetId 必须是非空字符串"));
      }
      if (typeof component.kind !== "string" || !ABLATION_COMPONENT_KINDS.includes(component.kind as never)) {
        issues.push(issue("ABL_RUN_COMPONENT_KIND_INVALID", `components[${index}].kind`, `kind=${String(component.kind)} 非法`));
      }
    });
  }
  if (r.order !== null && !Array.isArray(r.order)) {
    issues.push(issue("ABL_RUN_ORDER_INVALID", "order", "order 必须为 null 或字符串数组"));
  }
  if (!isPlainObject(r.thresholds)) {
    issues.push(issue("ABL_RUN_THRESHOLDS_INVALID", "thresholds", "thresholds 必须是对象"));
  } else {
    for (const field of ["isContributionFloorPct", "oosNeutralCeilingPct"] as const) {
      if (!isFiniteNumber(r.thresholds[field])) {
        issues.push(issue("ABL_RUN_THRESHOLD_INVALID", `thresholds.${field}`, `${field} 必须是有限数字`));
      }
    }
  }
  for (const field of ["is", "oos"] as const) {
    const track = r[field];
    if (field === "is" && !isPlainObject(track)) {
      issues.push(issue("ABL_RUN_IS_INVALID", "is", "is 轨必须是对象"));
      continue;
    }
    if (field === "oos" && track !== null && !isPlainObject(track)) {
      issues.push(issue("ABL_RUN_OOS_INVALID", "oos", "oos 轨必须为 null 或对象"));
    }
    if (track !== null && isPlainObject(track)) {
      if (typeof track.track !== "string" || (track.track !== "IS" && track.track !== "OOS")) {
        issues.push(issue("ABL_RUN_TRACK_LABEL_INVALID", `${field}.track`, `track=${String(track.track)} 非法`));
      }
      if (!Array.isArray(track.samples) || track.samples.length === 0) {
        issues.push(issue("ABL_RUN_TRACK_SAMPLES_INVALID", `${field}.samples`, "samples 必须是非空数组"));
      }
    }
  }
  if (!Array.isArray(r.contributions)) {
    issues.push(issue("ABL_RUN_CONTRIBUTIONS_INVALID", "contributions", "contributions 必须是数组"));
  }
  if (!Array.isArray(r.signals)) {
    issues.push(issue("ABL_RUN_SIGNALS_INVALID", "signals", "signals 必须是数组"));
  } else {
    (r.signals as unknown[]).forEach((signal, index) => {
      if (!isPlainObject(signal)) {
        issues.push(issue("ABL_RUN_SIGNAL_INVALID", `signals[${index}]`, "信号必须是对象"));
        return;
      }
      if (typeof signal.code !== "string" || !ABLATION_OVERFIT_SIGNAL_CODES.includes(signal.code as never)) {
        issues.push(issue("ABL_RUN_SIGNAL_CODE_INVALID", `signals[${index}].code`, `code=${String(signal.code)} 非法`));
      }
    });
  }
  if (typeof r.oosAssessed !== "boolean") {
    issues.push(issue("ABL_RUN_OOS_ASSESSED_INVALID", "oosAssessed", "oosAssessed 必须是布尔值"));
  }
  if (r.unassessedReasonCode !== null && (typeof r.unassessedReasonCode !== "string"
    || !ABLATION_REASON_CODES.includes(r.unassessedReasonCode as never))) {
    issues.push(issue("ABL_RUN_REASON_CODE_INVALID", "unassessedReasonCode",
      `unassessedReasonCode=${String(r.unassessedReasonCode)} 非法`));
  }
  if (!Array.isArray(r.reasons) || !(r.reasons as unknown[]).every((reason) => typeof reason === "string")) {
    issues.push(issue("ABL_RUN_REASONS_INVALID", "reasons", "reasons 必须是非空字符串数组"));
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issues.push(issue("ABL_RUN_FP_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制字符串"));
  }
  return { valid: issues.length === 0, issues };
}

/** 反序列化 AblationAssessmentRun：结构校验 + 指纹完整性复核（防篡改 / 防字段退化）。 */
export function deserializeAblationAssessmentRun(json: string): AblationAssessmentRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`AblationAssessmentRun 反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  const validation = validateAblationAssessmentRun(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError([...validation.issues]);
  }
  const record = parsed as AblationAssessmentRun;
  const recomputed = computeAblationAssessmentRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new ResearchValidationError([
      {
        code: "ABL_RUN_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
      },
    ]);
  }
  return structuredClone(record);
}
