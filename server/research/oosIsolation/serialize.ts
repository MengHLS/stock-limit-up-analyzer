/**
 * STEP 19 / C-19.2 — OosIsolationRun 序列化 / 反序列化 / 指纹 / 结构校验。
 *
 * 防篡改范式（对齐 C-19.1 serialize.ts / C-16.1 evaluate.ts）：
 *   - canonical 序列化：`canonicalStringify`（键字典序递归排序）→ 同内容必同串；
 *   - 指纹：`sha256(canonical(body))`，body = 除 fingerprint 外的全部字段（含嵌套
 *     WindowResultRecord / OosAggregationReport / PerformanceEvaluationRun 等）；
 *   - round-trip：`deserializeOosIsolationRun` 先结构校验（validateOosIsolationRun），再复核
 *     内容指纹，再复核**隔离纪律**（verifyOosIsolation 必须 passed）——任一不符 → 响亮抛错
 *     （篡改拒绝 + 隔离破坏拒绝）；
 *   - NaN / Infinity 严格拒绝（JSON 会静默变 null，必须拦在序列化前）。
 *
 * 铁律：纯函数、无 IO；反序列化不做「尽力修复」，只做「全对或抛错」。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { verifyOosIsolation } from "./discipline";
import {
  OOS_ISOLATION_RUN_RECORD_KIND,
  OOS_ISOLATION_RUN_RECORD_VERSION,
  OOS_ISOLATION_SKIP_REASON_CODES,
  type OosIsolationRun,
  type WindowResultRecord,
} from "./types";

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

/** OosIsolationRun 内容指纹（sha256，十六进制；除 fingerprint 字段外的 canonical JSON 摘要）。 */
export function computeOosIsolationRunFingerprint(
  body: Omit<OosIsolationRun, "fingerprint">,
): string {
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

/** 递归检查是否存在 NaN / Infinity（JSON.stringify 会静默变 null，必须拦在序列化前）。 */
function hasNonFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasNonFiniteNumber);
  }
  return false;
}

/** 序列化 OosIsolationRun（canonical JSON；含 NaN / Infinity → 响亮抛错）。 */
export function serializeOosIsolationRun(record: OosIsolationRun): string {
  if (hasNonFiniteNumber(record)) {
    throw new ResearchValidationError([
      {
        code: "OOS19_RUN_NON_FINITE_NUMBER",
        path: "record",
        message: "OosIsolationRun 含 NaN / Infinity，禁止序列化（会静默丢失为 null）",
      },
    ]);
  }
  return canonicalStringify(record);
}

// ---------------------------------------------------------------------------
// 结构校验
// ---------------------------------------------------------------------------

const HEX64_RE = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function checkWindowRecord(
  value: unknown,
  index: number,
  issues: ResearchValidationIssue[],
  path: string,
): void {
  const issue = (code: string, p: string, message: string): void => {
    issues.push({ code, path: p, message });
  };
  if (!isPlainObject(value)) {
    issue("OOS19_RUN_WINDOW_INVALID", path, `windows[${index}] 必须是对象`);
    return;
  }
  const w = value;
  if (!isNonEmptyString(w.windowId)) {
    issue("OOS19_RUN_WINDOW_INVALID", `${path}.windowId`, "windowId 必须是非空字符串");
  }
  if (typeof w.windowIndex !== "number" || !Number.isInteger(w.windowIndex) || (w.windowIndex as number) < 0) {
    issue("OOS19_RUN_WINDOW_INVALID", `${path}.windowIndex`, "windowIndex 必须是 >= 0 的整数");
  } else if ((w.windowIndex as number) !== index) {
    issue("OOS19_RUN_WINDOW_INDEX_MISMATCH", `${path}.windowIndex`, `windows[${index}] 的 windowIndex 必须等于 ${index}`);
  }
  if (!isPlainObject(w.train) || !isPlainObject(w.test) || !isPlainObject(w.isolation)) {
    issue("OOS19_RUN_WINDOW_INVALID", path, "train / test / isolation 必须是对象");
  }
  if (typeof w.fingerprint !== "string" || !HEX64_RE.test(w.fingerprint)) {
    issue("OOS19_RUN_WINDOW_FINGERPRINT_INVALID", `${path}.fingerprint`, "fingerprint 必须是 64 位十六进制 sha256");
  }
}

function checkDiscipline(value: unknown, issues: ResearchValidationIssue[], path: string): void {
  const issue = (code: string, p: string, message: string): void => {
    issues.push({ code, path: p, message });
  };
  if (!isPlainObject(value)) {
    issue("OOS19_RUN_DISCIPLINE_INVALID", path, "discipline 必须是对象");
    return;
  }
  const d = value;
  if (typeof d.windowCount !== "number" || !Number.isInteger(d.windowCount) || (d.windowCount as number) < 0) {
    issue("OOS19_RUN_DISCIPLINE_INVALID", `${path}.windowCount`, "windowCount 必须是 >= 0 的整数");
  }
  for (const field of [
    "allWindowIdsUnique",
    "allWindowIndexesUnique",
    "allTestStrictlyAfterTrain",
    "allTrainTestNonOverlapping",
    "allParamsFrozenFromTrain",
    "noTestResultWritesBackParams",
    "passed",
  ] as const) {
    if (typeof d[field] !== "boolean") {
      issue("OOS19_RUN_DISCIPLINE_INVALID", `${path}.${field}`, `${field} 必须是布尔值`);
    }
  }
  if (!Array.isArray(d.violations)) {
    issue("OOS19_RUN_DISCIPLINE_INVALID", `${path}.violations`, "violations 必须是字符串数组");
  }
}

function checkReport(value: unknown, issues: ResearchValidationIssue[], path: string): void {
  const issue = (code: string, p: string, message: string): void => {
    issues.push({ code, path: p, message });
  };
  if (!isPlainObject(value)) {
    issue("OOS19_RUN_REPORT_INVALID", path, "report 必须是对象");
    return;
  }
  const r = value;
  for (const field of ["windowCount", "evaluatedWindowCount", "skippedWindowCount"] as const) {
    if (typeof r[field] !== "number" || !Number.isInteger(r[field]) || (r[field] as number) < 0) {
      issue("OOS19_RUN_REPORT_INVALID", `${path}.${field}`, `${field} 必须是 >= 0 的整数`);
    }
  }
  if (!isPlainObject(r.walkForwardAggregate)) {
    issue("OOS19_RUN_REPORT_INVALID", `${path}.walkForwardAggregate`, "walkForwardAggregate 必须是对象");
  }
  if (r.oosDegradationPp !== null && (typeof r.oosDegradationPp !== "number" || !Number.isFinite(r.oosDegradationPp))) {
    issue("OOS19_RUN_REPORT_INVALID", `${path}.oosDegradationPp`, "oosDegradationPp 必须是有限数字或 null");
  }
  if (typeof r.oosEquityCurveAssessed !== "boolean") {
    issue("OOS19_RUN_REPORT_INVALID", `${path}.oosEquityCurveAssessed`, "oosEquityCurveAssessed 必须是布尔值");
  }
  if (!Array.isArray(r.segments) || !Array.isArray(r.skipped) || !isPlainObject(r.oosSegmentAggregate)) {
    issue("OOS19_RUN_REPORT_INVALID", path, "segments / skipped / oosSegmentAggregate 结构非法");
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issue("OOS19_RUN_REPORT_FINGERPRINT_INVALID", `${path}.fingerprint`, "report.fingerprint 必须是 64 位十六进制 sha256");
  }
}

/** 校验 OosIsolationRun 结构（顶层形态 + 逐窗记录 + discipline + report）。指纹复核由反序列化承担。 */
export function validateOosIsolationRun(record: unknown): {
  valid: boolean;
  issues: ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (!isPlainObject(record)) {
    return {
      valid: false,
      issues: [{ code: "OOS19_RUN_INVALID", path: "record", message: "OosIsolationRun 必须是对象" }],
    };
  }
  const r = record;

  if (r.recordKind !== OOS_ISOLATION_RUN_RECORD_KIND) {
    issue("OOS19_RUN_KIND_MISMATCH", "recordKind", `recordKind=${String(r.recordKind)} 不是 ${OOS_ISOLATION_RUN_RECORD_KIND}`);
  }
  if (r.recordVersion !== OOS_ISOLATION_RUN_RECORD_VERSION) {
    issue("OOS19_RUN_VERSION_MISMATCH", "recordVersion", `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${OOS_ISOLATION_RUN_RECORD_VERSION}）`);
  }
  for (const field of ["runId", "sourceWalkForwardRunId", "strategyId", "strategyVersion", "tradeDatesFingerprint", "createdAt"] as const) {
    if (!isNonEmptyString(r[field])) {
      issue("OOS19_RUN_FIELD_EMPTY", field, `${field} 必须是非空字符串`);
    }
  }
  if (typeof r.sourceWalkForwardRunFingerprint !== "string" || !HEX64_RE.test(r.sourceWalkForwardRunFingerprint)) {
    issue("OOS19_RUN_SOURCE_FP_INVALID", "sourceWalkForwardRunFingerprint", "sourceWalkForwardRunFingerprint 必须是 64 位十六进制 sha256");
  }
  if (!Array.isArray(r.windows)) {
    issue("OOS19_RUN_WINDOWS_INVALID", "windows", "windows 必须是数组");
  } else {
    if (r.windows.length === 0) {
      issue("OOS19_RUN_WINDOWS_EMPTY", "windows", "windows 不能为空");
    }
    if (typeof r.windowCount !== "number" || !Number.isInteger(r.windowCount) || (r.windowCount as number) !== r.windows.length) {
      issue("OOS19_RUN_WINDOW_COUNT_INVALID", "windowCount", "windowCount 必须等于 windows.length");
    }
    r.windows.forEach((window: unknown, index: number) => checkWindowRecord(window, index, issues, `windows[${index}]`));
  }
  checkDiscipline(r.discipline, issues, "discipline");
  checkReport(r.report, issues, "report");
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issue("OOS19_RUN_FINGERPRINT_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制 sha256");
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 反序列化（结构校验 + 指纹复核 + 隔离纪律复核；篡改即抛错）
// ---------------------------------------------------------------------------

/**
 * 反序列化 OosIsolationRun：先结构校验，再复核内容指纹，再复核隔离纪律。
 * 任一不符 → 响亮抛错（被篡改 / 被截断 / 隔离被破坏的记录必须失败，而非被静默接受）。
 */
export function deserializeOosIsolationRun(json: string): OosIsolationRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ResearchValidationError([
      {
        code: "OOS19_RUN_JSON_INVALID",
        path: "json",
        message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
  const validation = validateOosIsolationRun(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const record = parsed as OosIsolationRun;
  const body: Omit<OosIsolationRun, "fingerprint"> = { ...record, fingerprint: undefined } as Omit<
    OosIsolationRun,
    "fingerprint"
  >;
  const expected = computeOosIsolationRunFingerprint(body);
  if (expected !== record.fingerprint) {
    throw new ResearchValidationError([
      {
        code: "OOS19_RUN_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配（期望 ${expected}，实际 ${record.fingerprint}）：记录被篡改或字段被改动`,
      },
    ]);
  }
  // 隔离纪律复核：归档内容必须仍满足 IS/OOS 隔离。
  const discipline = verifyOosIsolation(record.windows as WindowResultRecord[]);
  if (!discipline.passed) {
    throw new ResearchValidationError(
      discipline.violations.map((violation, index) => ({
        code: "OOS19_ISOLATION_VIOLATION",
        path: `windows[${index}]`,
        message: `反序列化后隔离纪律被破坏：${violation}`,
      })),
    );
  }
  return record;
}
