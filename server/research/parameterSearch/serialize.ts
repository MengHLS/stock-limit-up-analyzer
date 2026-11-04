/**
 * STEP 17 / C-17.1 — SearchRun / Candidate 序列化 + 指纹（纯函数、确定性）。
 *
 * 铁律（对齐 researchDataset/version.ts canonical 范式与 experimentLineage/serialize.ts）：
 *   - 指纹与序列化使用按键字典序排序的 canonical JSON（canonicalStringify），
 *     同内容必同串，不依赖对象键插入顺序；
 *   - 任何 NaN / Infinity 在进入指纹 / 序列化前直接抛错（绝不静默转 null）；
 *   - fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - deserialize：JSON → 结构校验 → 指纹复核，防篡改 / 防字段退化。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import {
  PARAMETER_SEARCH_RUN_RECORD_KIND,
  PARAMETER_SEARCH_RUN_RECORD_VERSION,
  PARAMETER_SEARCH_CANDIDATE_RECORD_KIND,
  PARAMETER_SEARCH_CANDIDATE_RECORD_VERSION,
  type ParameterSearchRun,
  type ParameterSearchCandidateStrategy,
} from "./types";

// ---------------------------------------------------------------------------
// canonical 摘要基础
// ---------------------------------------------------------------------------

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝含非有限数字 ${value}（${path}）；ParameterSearch 记录禁止 NaN / Infinity`);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteRecord(item, `${path}[${index}]`));
    return;
  }
  for (const key of Object.keys(value as object)) {
    assertFiniteRecord((value as Record<string, unknown>)[key], path === "" ? key : `${path}.${key}`);
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

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/** SearchRun 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeParameterSearchRunFingerprint(
  record: Omit<ParameterSearchRun, "fingerprint"> | ParameterSearchRun,
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

/** Candidate Strategy 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeParameterSearchCandidateFingerprint(
  record: Omit<ParameterSearchCandidateStrategy, "fingerprint"> | ParameterSearchCandidateStrategy,
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

/** 序列化 SearchRun（canonical JSON；拒绝 NaN/Infinity；同内容必同串）。 */
export function serializeParameterSearchRun(record: ParameterSearchRun): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

/** 序列化单个候选策略记录。 */
export function serializeParameterSearchCandidate(candidate: ParameterSearchCandidateStrategy): string {
  assertFiniteRecord(candidate, "candidate");
  return canonicalStringify(candidate);
}

// ---------------------------------------------------------------------------
// 结构校验（供 deserialize / 测试）
// ---------------------------------------------------------------------------

const HEX64_RE = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 校验 SearchRun 记录结构（顶层形态 + 关键字段一致性；指纹完整性由 deserialize 复核）。 */
export function validateParameterSearchRun(record: unknown): {
  valid: boolean;
  issues: ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (!isPlainObject(record)) {
    return { valid: false, issues: [{ code: "SEARCH_RUN_INVALID", path: "record", message: "SearchRun 必须是对象" }] };
  }

  const r = record as Record<string, unknown>;
  const expectedKind = PARAMETER_SEARCH_RUN_RECORD_KIND;
  const expectedVersion = PARAMETER_SEARCH_RUN_RECORD_VERSION;
  if (r.recordKind !== expectedKind) {
    issue("SEARCH_RUN_KIND_MISMATCH", "recordKind", `recordKind=${String(r.recordKind)} 不是 ${expectedKind}`);
  }
  if (r.recordVersion !== expectedVersion) {
    issue("SEARCH_RUN_VERSION_MISMATCH", "recordVersion", `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${expectedVersion}）`);
  }
  for (const field of ["searchRunId", "strategyId", "strategyVersion", "createdAt"] as const) {
    if (typeof r[field] !== "string" || (r[field] as string).trim() === "") {
      issue("SEARCH_RUN_FIELD_EMPTY", field, `${field} 必须是非空字符串`);
    }
  }
  if (r.method !== "grid" && r.method !== "random") {
    issue("SEARCH_RUN_METHOD_INVALID", "method", `method=${String(r.method)} 非法（期望 grid | random）`);
  }
  if (r.seed !== null && typeof r.seed !== "number") {
    issue("SEARCH_RUN_SEED_INVALID", "seed", "seed 必须为整数或 null");
  } else if (r.method === "random" && (typeof r.seed !== "number" || !Number.isInteger(r.seed))) {
    issue("SEARCH_RUN_SEED_REQUIRED", "seed", "random 搜索的 seed 必须是整数");
  } else if (r.method === "grid" && r.seed !== null) {
    issue("SEARCH_RUN_SEED_NOT_NULL", "seed", "grid 搜索的 seed 必须为 null");
  }
  for (const field of ["requestedBudget", "combinationCount", "sampleCount"] as const) {
    if (typeof r[field] !== "number" || !Number.isInteger(r[field]) || (r[field] as number) < 1) {
      issue("SEARCH_RUN_BUDGET_INVALID", field, `${field} 必须是 >= 1 的整数`);
    }
  }
  if (!isPlainObject(r.parameterSpace)) {
    issue("SEARCH_RUN_SPACE_INVALID", "parameterSpace", "parameterSpace 必须是对象");
  }
  if (typeof r.parameterSpaceFingerprint !== "string" || r.parameterSpaceFingerprint.length === 0) {
    issue("SEARCH_RUN_SPACE_FP_INVALID", "parameterSpaceFingerprint", "parameterSpaceFingerprint 必须是非空字符串");
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issue("SEARCH_RUN_FP_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制字符串");
  }

  // evaluatedSamples
  if (!Array.isArray(r.evaluatedSamples)) {
    issue("SEARCH_RUN_SAMPLES_INVALID", "evaluatedSamples", "evaluatedSamples 必须是数组");
  } else {
    (r.evaluatedSamples as unknown[]).forEach((sample, index) => {
      if (!isPlainObject(sample)) {
        issue("SEARCH_RUN_SAMPLE_INVALID", `evaluatedSamples[${index}]`, "样本必须是对象");
        return;
      }
      if (sample.status !== "succeeded" && sample.status !== "failed") {
        issue("SEARCH_RUN_SAMPLE_STATUS_INVALID", `evaluatedSamples[${index}].status`, "status 必须是 succeeded | failed");
      }
      const isSuccess = sample.status === "succeeded";
      for (const field of ["totalReturnPct", "maxDrawdownPct", "tradeCount"] as const) {
        const value = sample[field];
        if (isSuccess && typeof value !== "number") {
          issue("SEARCH_RUN_SAMPLE_METRIC_INVALID", `evaluatedSamples[${index}].${field}`, "succeeded 样本必须携带数值指标");
        }
        if (!isSuccess && value !== null) {
          issue("SEARCH_RUN_SAMPLE_METRIC_INVALID", `evaluatedSamples[${index}].${field}`, "failed 样本指标必须为 null");
        }
      }
      if (isSuccess && sample.error !== null) {
        issue("SEARCH_RUN_SAMPLE_ERROR_INVALID", `evaluatedSamples[${index}].error`, "succeeded 样本 error 必须为 null");
      }
      if (!isSuccess && (typeof sample.error !== "string" || sample.error.trim() === "")) {
        issue("SEARCH_RUN_SAMPLE_ERROR_INVALID", `evaluatedSamples[${index}].error`, "failed 样本 error 必须是非空字符串");
      }
    });
  }

  // region 基本形态
  if (!isPlainObject(r.region)) {
    issue("SEARCH_RUN_REGION_INVALID", "region", "region 必须是对象");
  } else {
    const region = r.region as Record<string, unknown>;
    const verdicts = ["stable", "degraded-bad-point-rate", "insufficient-qualified-samples", "no-qualified-samples"];
    if (typeof region.verdict !== "string" || !verdicts.includes(region.verdict)) {
      issue("SEARCH_RUN_REGION_VERDICT_INVALID", "region.verdict", `verdict=${String(region.verdict)} 非法`);
    }
    for (const field of ["evaluatedCount", "succeededCount", "failedCount", "qualifiedCount", "lowReturnCount", "badDrawdownCount"] as const) {
      if (typeof region[field] !== "number" || !Number.isInteger(region[field]) || (region[field] as number) < 0) {
        issue("SEARCH_RUN_REGION_COUNT_INVALID", `region.${field}`, `${field} 必须是非负整数`);
      }
    }
    if (!Array.isArray(region.members)) {
      issue("SEARCH_RUN_REGION_MEMBERS_INVALID", "region.members", "region.members 必须是数组");
    }
  }

  // candidates 基本形态
  if (!Array.isArray(r.candidates)) {
    issue("SEARCH_RUN_CANDIDATES_INVALID", "candidates", "candidates 必须是数组");
  } else {
    (r.candidates as unknown[]).forEach((candidate, index) => {
      if (!isPlainObject(candidate)) {
        issue("SEARCH_RUN_CANDIDATE_INVALID", `candidates[${index}]`, "候选必须是对象");
        return;
      }
      if (candidate.recordKind !== PARAMETER_SEARCH_CANDIDATE_RECORD_KIND) {
        issue("SEARCH_RUN_CANDIDATE_KIND_INVALID", `candidates[${index}].recordKind`, "候选 recordKind 非法");
      }
      if (candidate.recordVersion !== PARAMETER_SEARCH_CANDIDATE_RECORD_VERSION) {
        issue("SEARCH_RUN_CANDIDATE_VERSION_INVALID", `candidates[${index}].recordVersion`, "候选 recordVersion 非法");
      }
      if (candidate.strategyKind !== "candidate") {
        issue("SEARCH_RUN_CANDIDATE_STRATEGY_KIND_INVALID", `candidates[${index}].strategyKind`, "候选 strategyKind 必须为 candidate");
      }
      if (typeof candidate.fingerprint !== "string" || !HEX64_RE.test(candidate.fingerprint as string)) {
        issue("SEARCH_RUN_CANDIDATE_FP_INVALID", `candidates[${index}].fingerprint`, "候选 fingerprint 必须是 64 位十六进制字符串");
      }
    });
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 反序列化
// ---------------------------------------------------------------------------

/** 反序列化 SearchRun：结构校验 + 指纹完整性复核（防篡改 / 防字段退化）。 */
export function deserializeParameterSearchRun(json: string): ParameterSearchRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`ParameterSearchRun 反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  const validation = validateParameterSearchRun(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const record = parsed as ParameterSearchRun;
  const recomputed = computeParameterSearchRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    const issues: ResearchValidationIssue[] = [{
      code: "SEARCH_RUN_FINGERPRINT_MISMATCH",
      path: "fingerprint",
      message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
    }];
    throw new ResearchValidationError(issues);
  }
  return record;
}

/** 反序列化单个候选策略记录（结构 + 指纹复核）。 */
export function deserializeParameterSearchCandidate(json: string): ParameterSearchCandidateStrategy {
  const parsed: unknown = JSON.parse(json);
  if (!isPlainObject(parsed)) {
    throw new Error("候选策略反序列化失败：顶层必须是对象");
  }
  if (parsed.recordKind !== PARAMETER_SEARCH_CANDIDATE_RECORD_KIND) {
    throw new Error(`候选策略 recordKind=${String(parsed.recordKind)} 非法`);
  }
  const candidate = parsed as unknown as ParameterSearchCandidateStrategy;
  const recomputed = computeParameterSearchCandidateFingerprint(candidate);
  if (candidate.fingerprint !== recomputed) {
    throw new ResearchValidationError([{
      code: "SEARCH_RUN_CANDIDATE_FINGERPRINT_MISMATCH",
      path: "fingerprint",
      message: `候选指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${candidate.fingerprint}）`,
    }]);
  }
  return candidate;
}
