/**
 * STEP 17 / C-17.2 — RollingOptimizationRun / 跨窗候选 序列化 + 指纹（纯函数、确定性）。
 *
 * 铁律（对齐 parameterSearch / experimentLineage serialize.ts 范式）：
 *   - 指纹与序列化使用按键字典序排序的 canonical JSON（canonicalStringify），同内容必
 *     同串，不依赖对象键插入顺序；
 *   - 任何 NaN / Infinity 在进入指纹 / 序列化前直接抛错（绝不静默转 null）；
 *   - fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - deserialize：JSON → 结构校验（含嵌套 SearchRun 复用 validateParameterSearchRun）→
 *     指纹复核，防篡改 / 防字段退化。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { validateRollingTradeDates } from "./windows";
import { validateParameterSearchRun } from "../parameterSearch/serialize";
import { isValidDateString } from "../datasetSplit";
import {
  ROLLING_OPTIMIZATION_RUN_RECORD_KIND,
  ROLLING_OPTIMIZATION_RUN_RECORD_VERSION,
  ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND,
  ROLLING_OPTIMIZATION_CANDIDATE_RECORD_VERSION,
  type RollingOptimizationRun,
  type RollingOptimizationCandidate,
} from "./types";

// ---------------------------------------------------------------------------
// canonical 摘要基础
// ---------------------------------------------------------------------------

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝含非有限数字 ${value}（${path}）；RollingOptimization 记录禁止 NaN / Infinity`);
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

/** RollingOptimizationRun 内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeRollingOptimizationRunFingerprint(
  record: Omit<RollingOptimizationRun, "fingerprint"> | RollingOptimizationRun,
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

/** 跨窗候选内容指纹：除 fingerprint 外全部字段的 canonical SHA-256 摘要。 */
export function computeRollingOptimizationCandidateFingerprint(
  record: Omit<RollingOptimizationCandidate, "fingerprint"> | RollingOptimizationCandidate,
): string {
  assertFiniteRecord(record, "record");
  const body = bodyWithoutFingerprint(record);
  return sha256Hex(canonicalStringify(body));
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

/** 序列化 RollingOptimizationRun（canonical JSON；拒绝 NaN/Infinity；同内容必同串）。 */
export function serializeRollingOptimizationRun(record: RollingOptimizationRun): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

/** 序列化单个跨窗候选记录。 */
export function serializeRollingOptimizationCandidate(candidate: RollingOptimizationCandidate): string {
  assertFiniteRecord(candidate, "candidate");
  return canonicalStringify(candidate);
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

/** 解析后的稳定区口径（逐窗一致）形态校验。 */
function checkAnalysisConfig(value: unknown, issues: ResearchValidationIssue[], path: string): void {
  const issue = (code: string, p: string, message: string): void => {
    issues.push({ code, path: p, message });
  };
  if (!isPlainObject(value)) {
    issue("ROLLING_ANALYSIS_CONFIG_INVALID", path, "analysisConfig 必须是对象");
    return;
  }
  const r = value;
  if (typeof r.minReturnPct !== "number" || !Number.isFinite(r.minReturnPct)) {
    issue("ROLLING_ANALYSIS_CONFIG_INVALID", `${path}.minReturnPct`, "minReturnPct 必须是有限数字");
  }
  if (typeof r.maxDrawdownPct !== "number" || !Number.isFinite(r.maxDrawdownPct) || (r.maxDrawdownPct as number) < 0) {
    issue("ROLLING_ANALYSIS_CONFIG_INVALID", `${path}.maxDrawdownPct`, "maxDrawdownPct 必须是 >= 0 的有限数字");
  }
  if (typeof r.maxBadPointRatePct !== "number" || !Number.isFinite(r.maxBadPointRatePct)
    || (r.maxBadPointRatePct as number) < 0 || (r.maxBadPointRatePct as number) > 100) {
    issue("ROLLING_ANALYSIS_CONFIG_INVALID", `${path}.maxBadPointRatePct`, "maxBadPointRatePct 必须是 0..100 的有限数字");
  }
  if (typeof r.minQualifiedSamples !== "number" || !Number.isInteger(r.minQualifiedSamples) || (r.minQualifiedSamples as number) < 1) {
    issue("ROLLING_ANALYSIS_CONFIG_INVALID", `${path}.minQualifiedSamples`, "minQualifiedSamples 必须是 >= 1 的整数");
  }
  if (r.maxCandidates !== null && (typeof r.maxCandidates !== "number" || !Number.isInteger(r.maxCandidates) || (r.maxCandidates as number) < 1)) {
    issue("ROLLING_ANALYSIS_CONFIG_INVALID", `${path}.maxCandidates`, "maxCandidates 必须为 null 或 >= 1 的整数");
  }
  if (typeof r.requireStableCandidates !== "boolean") {
    issue("ROLLING_ANALYSIS_CONFIG_INVALID", `${path}.requireStableCandidates`, "requireStableCandidates 必须是布尔值");
  }
}

/** 校验 RollingOptimizationRun 记录结构（顶层形态 + 嵌套 SearchRun/报告；指纹由 deserialize 复核）。 */
export function validateRollingOptimizationRun(record: unknown): {
  valid: boolean;
  issues: ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (!isPlainObject(record)) {
    return { valid: false, issues: [{ code: "ROLLING_RUN_INVALID", path: "record", message: "RollingOptimizationRun 必须是对象" }] };
  }
  const r = record as Record<string, unknown>;

  if (r.recordKind !== ROLLING_OPTIMIZATION_RUN_RECORD_KIND) {
    issue("ROLLING_RUN_KIND_MISMATCH", "recordKind", `recordKind=${String(r.recordKind)} 不是 ${ROLLING_OPTIMIZATION_RUN_RECORD_KIND}`);
  }
  if (r.recordVersion !== ROLLING_OPTIMIZATION_RUN_RECORD_VERSION) {
    issue("ROLLING_RUN_VERSION_MISMATCH", "recordVersion", `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${ROLLING_OPTIMIZATION_RUN_RECORD_VERSION}）`);
  }
  for (const field of ["runId", "strategyId", "strategyVersion", "createdAt"] as const) {
    if (!isNonEmptyString(r[field])) {
      issue("ROLLING_RUN_FIELD_EMPTY", field, `${field} 必须是非空字符串`);
    }
  }
  if (r.method !== "grid" && r.method !== "random") {
    issue("ROLLING_RUN_METHOD_INVALID", "method", `method=${String(r.method)} 非法（期望 grid | random）`);
  }
  if (r.seed !== null && typeof r.seed !== "number") {
    issue("ROLLING_RUN_SEED_INVALID", "seed", "seed 必须为整数或 null");
  } else if (r.method === "random" && (typeof r.seed !== "number" || !Number.isInteger(r.seed))) {
    issue("ROLLING_RUN_SEED_REQUIRED", "seed", "random 搜索的 seed 必须是整数");
  } else if (r.method === "grid" && r.seed !== null) {
    issue("ROLLING_RUN_SEED_NOT_NULL", "seed", "grid 搜索的 seed 必须为 null");
  }
  if (typeof r.requestedBudget !== "number" || !Number.isInteger(r.requestedBudget) || (r.requestedBudget as number) < 1) {
    issue("ROLLING_RUN_BUDGET_INVALID", "requestedBudget", "requestedBudget 必须是 >= 1 的整数");
  }
  if (!isPlainObject(r.parameterSpace)) {
    issue("ROLLING_RUN_SPACE_INVALID", "parameterSpace", "parameterSpace 必须是对象");
  }
  if (!isNonEmptyString(r.parameterSpaceFingerprint)) {
    issue("ROLLING_RUN_SPACE_FP_INVALID", "parameterSpaceFingerprint", "parameterSpaceFingerprint 必须是非空字符串");
  }
  if (!Array.isArray(r.tradeDates)) {
    issue("ROLLING_RUN_TRADE_DATES_INVALID", "tradeDates", "tradeDates 必须是数组");
  } else {
    const dateIssues = validateRollingTradeDates(r.tradeDates as readonly string[]).issues;
    issues.push(...dateIssues);
  }
  if (!isNonEmptyString(r.tradeDatesFingerprint)) {
    issue("ROLLING_RUN_TRADE_DATES_FP_INVALID", "tradeDatesFingerprint", "tradeDatesFingerprint 必须是非空字符串");
  }
  if (!isPlainObject(r.windowConfig)) {
    issue("ROLLING_RUN_WINDOW_CONFIG_INVALID", "windowConfig", "windowConfig 必须是对象");
  } else {
    const wc = r.windowConfig;
    if (wc.mode !== "rolling") {
      issue("ROLLING_RUN_WINDOW_MODE_INVALID", "windowConfig.mode", "mode 必须为 rolling（expanding 属 C-19.1）");
    }
    for (const field of ["windowLength", "stepLength"] as const) {
      if (typeof wc[field] !== "number" || !Number.isInteger(wc[field]) || (wc[field] as number) < 1) {
        issue("ROLLING_RUN_WINDOW_CONFIG_INVALID", `windowConfig.${field}`, `${field} 必须是 >= 1 的整数`);
      }
    }
    if (wc.maxWindows !== null && (typeof wc.maxWindows !== "number" || !Number.isInteger(wc.maxWindows) || (wc.maxWindows as number) < 1)) {
      issue("ROLLING_RUN_WINDOW_CONFIG_INVALID", "windowConfig.maxWindows", "maxWindows 必须为 null 或 >= 1 的整数");
    }
  }
  checkAnalysisConfig(r.analysisConfig, issues, "analysisConfig");
  if (!isPlainObject(r.stabilityConfig)) {
    issue("ROLLING_RUN_STABILITY_CONFIG_INVALID", "stabilityConfig", "stabilityConfig 必须是对象");
  } else {
    const sc = r.stabilityConfig;
    if (typeof sc.minEvaluatedWindows !== "number" || !Number.isInteger(sc.minEvaluatedWindows) || (sc.minEvaluatedWindows as number) < 1) {
      issue("ROLLING_RUN_STABILITY_CONFIG_INVALID", "stabilityConfig.minEvaluatedWindows", "minEvaluatedWindows 必须是 >= 1 的整数");
    }
    if (sc.maxCandidates !== null && (typeof sc.maxCandidates !== "number" || !Number.isInteger(sc.maxCandidates) || (sc.maxCandidates as number) < 1)) {
      issue("ROLLING_RUN_STABILITY_CONFIG_INVALID", "stabilityConfig.maxCandidates", "maxCandidates 必须为 null 或 >= 1 的整数");
    }
  }
  if (typeof r.windowCount !== "number" || !Number.isInteger(r.windowCount) || (r.windowCount as number) < 1) {
    issue("ROLLING_RUN_WINDOW_COUNT_INVALID", "windowCount", "windowCount 必须是 >= 1 的整数");
  }
  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issue("ROLLING_RUN_FP_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制字符串");
  }

  // windows
  if (!Array.isArray(r.windows)) {
    issue("ROLLING_RUN_WINDOWS_INVALID", "windows", "windows 必须是数组");
  } else {
    const windows = r.windows as unknown[];
    const seenWindowIds = new Set<string>();
    windows.forEach((entry, index) => {
      const path = `windows[${index}]`;
      if (!isPlainObject(entry)) {
        issue("ROLLING_RUN_WINDOW_INVALID", path, "窗口条目必须是对象");
        return;
      }
      if (!isNonEmptyString(entry.windowId)) {
        issue("ROLLING_RUN_WINDOW_ID_INVALID", `${path}.windowId`, "windowId 必须是非空字符串");
      } else if (seenWindowIds.has(entry.windowId)) {
        issue("ROLLING_RUN_WINDOW_ID_INVALID", `${path}.windowId`, `windowId=${String(entry.windowId)} 重复`);
      } else {
        seenWindowIds.add(entry.windowId);
      }
      if (entry.windowIndex !== index) {
        issue("ROLLING_RUN_WINDOW_INDEX_INVALID", `${path}.windowIndex`, `windowIndex=${String(entry.windowIndex)} 不等于数组下标 ${index}`);
      }
      if (!isNonEmptyString(entry.firstTradeDate) || !isValidDateString(entry.firstTradeDate)) {
        issue("ROLLING_RUN_WINDOW_DATE_INVALID", `${path}.firstTradeDate`, "firstTradeDate 必须是 YYYY-MM-DD");
      }
      if (!isNonEmptyString(entry.lastTradeDate) || !isValidDateString(entry.lastTradeDate)) {
        issue("ROLLING_RUN_WINDOW_DATE_INVALID", `${path}.lastTradeDate`, "lastTradeDate 必须是 YYYY-MM-DD");
      } else if (isNonEmptyString(entry.firstTradeDate) && isValidDateString(entry.firstTradeDate)
        && entry.firstTradeDate > entry.lastTradeDate) {
        issue("ROLLING_RUN_WINDOW_DATE_REVERSED", path, `firstTradeDate(${String(entry.firstTradeDate)}) 晚于 lastTradeDate(${String(entry.lastTradeDate)})`);
      }
      if (typeof entry.tradeDayCount !== "number" || !Number.isInteger(entry.tradeDayCount) || (entry.tradeDayCount as number) < 1) {
        issue("ROLLING_RUN_WINDOW_COUNT_INVALID", `${path}.tradeDayCount`, "tradeDayCount 必须是 >= 1 的整数");
      }
      if (!isPlainObject(entry.searchRun)) {
        issue("ROLLING_RUN_WINDOW_SEARCH_RUN_INVALID", `${path}.searchRun`, "searchRun 必须是对象");
        return;
      }
      const nested = validateParameterSearchRun(entry.searchRun);
      if (!nested.valid) {
        issues.push(...nested.issues.map((i) => ({ ...i, path: `${path}.searchRun.${i.path}` })));
      }
    });
    if (isNonEmptyString(r.runId) && r.windowCount !== windows.length) {
      issue("ROLLING_RUN_WINDOW_COUNT_MISMATCH", "windowCount", `windowCount=${String(r.windowCount)} 与 windows.length=${windows.length} 不一致`);
    }
  }

  // stability 报告基本形态
  if (!isPlainObject(r.stability)) {
    issue("ROLLING_RUN_STABILITY_INVALID", "stability", "stability 必须是对象");
  } else {
    const st = r.stability as Record<string, unknown>;
    const verdicts = ["stable-across-windows", "no-consistent-parameters", "no-qualified-parameters"];
    if (typeof st.verdict !== "string" || !verdicts.includes(st.verdict)) {
      issue("ROLLING_RUN_STABILITY_VERDICT_INVALID", "stability.verdict", `verdict=${String(st.verdict)} 非法`);
    }
    for (const field of ["windowCount", "uniqueParameterCount", "everQualifiedParameterCount", "consistentParameterCount"] as const) {
      if (typeof st[field] !== "number" || !Number.isInteger(st[field]) || (st[field] as number) < 0) {
        issue("ROLLING_RUN_STABILITY_COUNT_INVALID", `stability.${field}`, `${field} 必须是非负整数`);
      }
    }
    if (!Array.isArray(st.parameters)) {
      issue("ROLLING_RUN_STABILITY_PARAMETERS_INVALID", "stability.parameters", "parameters 必须是数组");
    }
  }

  // candidates 基本形态
  if (!Array.isArray(r.candidates)) {
    issue("ROLLING_RUN_CANDIDATES_INVALID", "candidates", "candidates 必须是数组");
  } else {
    (r.candidates as unknown[]).forEach((candidate, index) => {
      const path = `candidates[${index}]`;
      if (!isPlainObject(candidate)) {
        issue("ROLLING_RUN_CANDIDATE_INVALID", path, "候选必须是对象");
        return;
      }
      if (candidate.recordKind !== ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND) {
        issue("ROLLING_RUN_CANDIDATE_KIND_INVALID", `${path}.recordKind`, "候选 recordKind 非法");
      }
      if (candidate.recordVersion !== ROLLING_OPTIMIZATION_CANDIDATE_RECORD_VERSION) {
        issue("ROLLING_RUN_CANDIDATE_VERSION_INVALID", `${path}.recordVersion`, "候选 recordVersion 非法");
      }
      if (candidate.strategyKind !== "candidate") {
        issue("ROLLING_RUN_CANDIDATE_STRATEGY_KIND_INVALID", `${path}.strategyKind`, "候选 strategyKind 必须为 candidate");
      }
      if (typeof candidate.fingerprint !== "string" || !HEX64_RE.test(candidate.fingerprint)) {
        issue("ROLLING_RUN_CANDIDATE_FP_INVALID", `${path}.fingerprint`, "候选 fingerprint 必须是 64 位十六进制字符串");
      }
    });
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 反序列化
// ---------------------------------------------------------------------------

/** 反序列化 RollingOptimizationRun：结构校验 + 指纹完整性复核（防篡改 / 防字段退化）。 */
export function deserializeRollingOptimizationRun(json: string): RollingOptimizationRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`RollingOptimizationRun 反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  const validation = validateRollingOptimizationRun(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const record = parsed as RollingOptimizationRun;
  const recomputed = computeRollingOptimizationRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new ResearchValidationError([{
      code: "ROLLING_RUN_FINGERPRINT_MISMATCH",
      path: "fingerprint",
      message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
    }]);
  }
  return record;
}

/** 反序列化单个跨窗候选（结构 + 指纹复核）。 */
export function deserializeRollingOptimizationCandidate(json: string): RollingOptimizationCandidate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`跨窗候选反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error("跨窗候选反序列化失败：顶层必须是对象");
  }
  if (parsed.recordKind !== ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND) {
    throw new Error(`跨窗候选 recordKind=${String(parsed.recordKind)} 非法`);
  }
  if (parsed.recordVersion !== ROLLING_OPTIMIZATION_CANDIDATE_RECORD_VERSION) {
    throw new Error(`跨窗候选 recordVersion=${String(parsed.recordVersion)} 非法`);
  }
  const candidate = parsed as unknown as RollingOptimizationCandidate;
  const recomputed = computeRollingOptimizationCandidateFingerprint(candidate);
  if (candidate.fingerprint !== recomputed) {
    throw new ResearchValidationError([{
      code: "ROLLING_RUN_CANDIDATE_FINGERPRINT_MISMATCH",
      path: "fingerprint",
      message: `候选指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${candidate.fingerprint}）`,
    }]);
  }
  return candidate;
}
