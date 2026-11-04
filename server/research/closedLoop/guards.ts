/**
 * STEP 25 / C-25.1 — Closed Loop：交接（handoff）契约校验 + run 指纹复核守卫。
 *
 * 运行期校验（注入执行器返回的 stageOutput 是 unknown，必须先过契约才敢流转）：
 *   - 信封层：kind 判别 / handoffVersion / synthetic 布尔 / source 引用形态；
 *   - 结构层：各 kind 必备键存在且类型正确（枚举/字符串/数字/数组/可空）；
 *   - 数值层：全树递归拦截 NaN/Infinity（确定性铁律）；
 *   - 日期层：YYYY-MM-DD / ISO-8601 UTC 形态（出现即校验）。
 *
 * 校验返回 issue 清单（不抛错）；编排器在 output 校验失败时抛
 * ClosedLoopError（CL_STAGE_OUTPUT_INVALID，issues 可审计）。
 */

import {
  CLOSED_LOOP_HANDOFF_KINDS,
  CLOSED_LOOP_HANDOFF_VERSION,
  type ClosedLoopDatasetGate,
  type ClosedLoopHandoff,
  type ClosedLoopHandoffKind,
  type ClosedLoopRun,
} from "./types";
import { CLOSED_LOOP_ERROR_CODES, ClosedLoopError } from "./errors";
import {
  computeClosedLoopRunFingerprint,
  canonicalStringify,
} from "./serialize";

// ---------------------------------------------------------------------------
// issue / 基础谓词
// ---------------------------------------------------------------------------

export interface ClosedLoopValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

function issue(code: string, path: string, message: string): ClosedLoopValidationIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isDate(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && DATE_TIME_RE.test(value);
}

// ---------------------------------------------------------------------------
// 数值 / 日期全树守卫（确定性铁律：拒绝 NaN/Infinity）
// ---------------------------------------------------------------------------

/** 递归收集非有限数字（object/array/number/string/boolean/null/undefined）。 */
export function collectNonFiniteNumbers(value: unknown, path: string, out: ClosedLoopValidationIssue[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      out.push(issue("CL_VALUE_NON_FINITE", path, `含非有限数字 ${String(value)}（${path}）；禁止 NaN / Infinity`));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNonFiniteNumbers(item, `${path}[${index}]`, out));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectNonFiniteNumbers(child, path === "" ? key : `${path}.${key}`, out);
    }
  }
}

/** 递归收集非法日期（字段值像日期但格式不对 → issue；仅校验 key 含 Date / date / DateRange 的对象）。 */
export function collectInvalidDateLikeValues(value: unknown, path: string, out: ClosedLoopValidationIssue[]): void {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (path.endsWith("Date") || path.endsWith("startDate") || path.endsWith("endDate")) {
      if (!DATE_RE.test(value)) {
        out.push(issue("CL_DATE_FORMAT_INVALID", path, `${path}（${value}）必须是 YYYY-MM-DD`));
      }
    }
    if (path.endsWith("createdAt") || path.endsWith("timestamp")) {
      if (!DATE_TIME_RE.test(value)) {
        out.push(issue("CL_DATE_TIME_FORMAT_INVALID", path, `${path}（${value}）必须是 ISO-8601 UTC（…Z）`));
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectInvalidDateLikeValues(item, `${path}[${index}]`, out));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectInvalidDateLikeValues(child, path === "" ? key : `${path}.${key}`, out);
  }
}

// ---------------------------------------------------------------------------
// kind 级必备键（结构契约；类型按 TS 强类型定义，运行期只做存在性 + 大类）
// ---------------------------------------------------------------------------

/** 每 kind 必备的 summary 根键（存在性校验；越级报 CL_HANDOFF_FIELD_MISSING）。 */
const CLOSED_LOOP_HANDOFF_REQUIRED_KEYS: Readonly<Record<ClosedLoopHandoffKind, readonly string[]>> = {
  datasetSummary: ["datasetVersion", "gate", "coverageGaps"],
  researchSummary: ["datasetVersion", "candidateRunFingerprint", "evaluated", "notes"],
  strategyDocRef: ["strategyId", "strategyVersion", "docFingerprint", "versionRecordFingerprint", "rules"],
  backtestSummary: ["datasetVersion", "datasetGate", "dateRange", "initialCapital", "finalEquity", "equityCurvePointCount", "tradeCount"],
  evaluationRef: ["backtestFingerprint", "performance", "riskAdjusted", "tradeQuality", "evaluatorsCovered"],
  optimizationRef: ["method", "candidateParameterKeys", "evaluatedCandidateCount", "consistency"],
  robustnessRef: ["axes"],
  oosRef: ["windows", "oosMetrics"],
  overfittingRef: ["pbo", "conclusion"],
  regimeRef: ["coverage", "compositeSummary"],
  paperRef: ["accountId", "initialCapital", "finalEquity", "fillCount", "unfilledCount"],
  reviewRef: ["journalEntryCount", "reviewRecordCount", "reconcile", "wiringLimits"],
  disciplineRef: ["conclusionReasonCode", "patterns"],
  finalizeRef: ["lifecycle", "promotion", "runSummary"],
};

/** 枚举值域白名单（越小越严，防拼错）。 */
const CLOSED_LOOP_GATE_VALUES: readonly ClosedLoopDatasetGate[] = ["PASS", "FAIL", "INCONCLUSIVE"];
const CLOSED_LOOP_OPT_METHODS = ["grid", "random", "rolling"] as const;
const CLOSED_LOOP_AXIS_VERDICTS = ["stable", "sensitive", "unassessed"] as const;
const CLOSED_LOOP_CONSISTENCY_STATUSES = ["candidate", "degraded", "noStableRegion"] as const;

function isOneOf(value: unknown, whitelist: readonly string[], path: string, issues: ClosedLoopValidationIssue[], label: string): void {
  if (!whitelist.includes(String(value))) {
    issues.push(issue("CL_HANDOFF_ENUM_INVALID", path, `${path}（${String(value)}）必须是 ${whitelist.join("|")}（${label}）`));
  }
}

/** 校验交接根对象是否匹配 kind（结构契约；不抛错）。 */
export function validateClosedLoopHandoffShape(value: unknown, path = "stageOutput"): ClosedLoopValidationIssue[] {
  const issues: ClosedLoopValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push(issue("CL_HANDOFF_NOT_OBJECT", path, "阶段输出必须是交接对象"));
    return issues;
  }
  if (!CLOSED_LOOP_HANDOFF_KINDS.includes(value.kind as ClosedLoopHandoffKind)) {
    issues.push(issue("CL_HANDOFF_KIND_INVALID", `${path}.kind`, `交接 kind 非法：${String(value.kind)}`));
    return issues;
  }
  const kind = value.kind as ClosedLoopHandoffKind;
  if (value.handoffVersion !== CLOSED_LOOP_HANDOFF_VERSION) {
    issues.push(issue("CL_HANDOFF_VERSION_INVALID", `${path}.handoffVersion`, `交接版本必须 = ${CLOSED_LOOP_HANDOFF_VERSION}，实际 ${String(value.handoffVersion)}`));
  }
  if (typeof value.synthetic !== "boolean") {
    issues.push(issue("CL_HANDOFF_SYNTHETIC_INVALID", `${path}.synthetic`, "synthetic 必须是布尔（合成产物显式标记，禁止缺省）"));
  }
  // -- source ref 形态 --
  const source = value.source;
  if (!isRecord(source)) {
    issues.push(issue("CL_HANDOFF_SOURCE_MISSING", `${path}.source`, "source 引用缺失"));
  } else {
    if (typeof source.module !== "string" || source.module.trim() === "") {
      issues.push(issue("CL_HANDOFF_SOURCE_MODULE_INVALID", `${path}.source.module`, "source.module 必须是非空字符串"));
    }
    if (source.moduleRunKind !== null && (typeof source.moduleRunKind !== "string" || source.moduleRunKind.trim() === "")) {
      issues.push(issue("CL_HANDOFF_SOURCE_RUN_KIND_INVALID", `${path}.source.moduleRunKind`, "source.moduleRunKind 必须是非空字符串或 null"));
    }
    if (source.runId !== null && (typeof source.runId !== "string" || source.runId.trim() === "")) {
      issues.push(issue("CL_HANDOFF_SOURCE_RUN_ID_INVALID", `${path}.source.runId`, "source.runId 必须是非空字符串或 null（内容寻址记录可无 id）"));
    }
    if (source.fingerprint !== null && (typeof source.fingerprint !== "string" || source.fingerprint.trim() === "")) {
      issues.push(issue("CL_HANDOFF_SOURCE_FINGERPRINT_INVALID", `${path}.source.fingerprint`, "source.fingerprint 必须是非空字符串或 null"));
    }
  }

  // -- kind 必备键存在性 --
  for (const key of CLOSED_LOOP_HANDOFF_REQUIRED_KEYS[kind]) {
    if (!(key in value)) {
      issues.push(issue("CL_HANDOFF_FIELD_MISSING", `${path}.${key}`, `${kind} 交接缺必备键 ${key}`));
    }
  }

  // -- kind 级枚举 / 关键形态 --
  switch (kind) {
    case "datasetSummary": {
      const gate = value.gate as unknown;
      isOneOf(gate, CLOSED_LOOP_GATE_VALUES, `${path}.gate`, issues, "dataset gate");
      if (gate === "PASS" && (typeof value.datasetVersion !== "string" || value.datasetVersion.trim() === "")) {
        issues.push(issue("CL_HANDOFF_DATASET_VERSION_REQUIRED", `${path}.datasetVersion`, "gate=PASS 时 datasetVersion 必须是非空字符串（rd-… 内容寻址）"));
      }
      if (value.datasetVersion !== null && (typeof value.datasetVersion !== "string" || value.datasetVersion.trim() === "")) {
        issues.push(issue("CL_HANDOFF_DATASET_VERSION_INVALID", `${path}.datasetVersion`, "datasetVersion 必须是非空字符串或 null"));
      }
      break;
    }
    case "strategyDocRef": {
      if (typeof value.strategyId !== "string" || value.strategyId.trim() === "") {
        issues.push(issue("CL_HANDOFF_STRATEGY_ID_INVALID", `${path}.strategyId`, "strategyId 必须是非空字符串"));
      }
      if (typeof value.strategyVersion !== "string" || value.strategyVersion.trim() === "") {
        issues.push(issue("CL_HANDOFF_STRATEGY_VERSION_INVALID", `${path}.strategyVersion`, "strategyVersion 必须是非空字符串"));
      }
      break;
    }
    case "backtestSummary": {
      if (typeof value.datasetVersion !== "string" || value.datasetVersion.trim() === "") {
        issues.push(issue("CL_HANDOFF_BACKTEST_DATASET_MISSING", `${path}.datasetVersion`, "backtestSummary.datasetVersion 必须是非空字符串"));
      }
      break;
    }
    case "evaluationRef": {
      if (typeof value.backtestFingerprint !== "string" || value.backtestFingerprint.trim() === "") {
        issues.push(issue("CL_HANDOFF_EVAL_BACKTEST_FP_MISSING", `${path}.backtestFingerprint`, "evaluationRef.backtestFingerprint 必须是非空字符串（绑定被评回测）"));
      }
      break;
    }
    case "optimizationRef": {
      isOneOf(value.method, CLOSED_LOOP_OPT_METHODS as readonly string[], `${path}.method`, issues, "优化方法");
      if (value.consistency !== null && typeof value.consistency === "object") {
        const c = value.consistency as Record<string, unknown>;
        isOneOf(c.status, CLOSED_LOOP_CONSISTENCY_STATUSES as readonly string[], `${path}.consistency.status`, issues, "一致性状态");
      }
      break;
    }
    case "robustnessRef": {
      if (Array.isArray(value.axes)) {
        (value.axes as unknown[]).forEach((ax, i) => {
          if (isRecord(ax)) {
            isOneOf(ax.verdict, CLOSED_LOOP_AXIS_VERDICTS as readonly string[], `${path}.axes[${i}].verdict`, issues, "轴级结论");
          }
        });
      }
      break;
    }
    case "finalizeRef": {
      if (isRecord(value.lifecycle)) {
        const lc = value.lifecycle as Record<string, unknown>;
        if (typeof lc.advanced !== "boolean") {
          issues.push(issue("CL_HANDOFF_FINALIZE_ADVANCED_INVALID", `${path}.lifecycle.advanced`, "advanced 必须为布尔"));
        }
        if (typeof lc.from !== "string" || typeof lc.to !== "string") {
          issues.push(issue("CL_HANDOFF_FINALIZE_STATUS_INVALID", `${path}.lifecycle`, "lifecycle.from/to 必须为字符串"));
        }
      }
      break;
    }
    default:
      break;
  }

  // -- 数值 / 日期全树守卫 --
  collectNonFiniteNumbers(value, path, issues);
  collectInvalidDateLikeValues(value, path, issues);
  return issues;
}

/** 断言交接形状合法（非法即抛 CL_STAGE_OUTPUT_INVALID；供编排器 output 契约校验）。 */
export function assertClosedLoopHandoffValid(value: unknown, expectedKind: ClosedLoopHandoffKind): ClosedLoopHandoff {
  if (!isRecord(value)) {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_STAGE_OUTPUT_INVALID, "阶段输出不是对象", {
      issues: validateClosedLoopHandoffShape(value),
    });
  }
  if (value.kind !== expectedKind) {
    throw new ClosedLoopError(
      CLOSED_LOOP_ERROR_CODES.CL_STAGE_OUTPUT_INVALID,
      `阶段输出 kind 不匹配：期望 ${expectedKind}，实际 ${String(value.kind)}（交接类型契约失败）`,
      { issues: validateClosedLoopHandoffShape(value) },
    );
  }
  const issues = validateClosedLoopHandoffShape(value);
  if (issues.length > 0) {
    throw new ClosedLoopError(
      CLOSED_LOOP_ERROR_CODES.CL_STAGE_OUTPUT_INVALID,
      `阶段输出契约校验失败（${issues.length} 项）`,
      { issues },
    );
  }
  return value as unknown as ClosedLoopHandoff;
}

// ---------------------------------------------------------------------------
// 深度相等（确定性深比较；用于「同输入两次 run 逐位一致」）
// ---------------------------------------------------------------------------

/** canonical JSON 深比较（键序无关、undefined 忽略，与指纹同一语义）。 */
export function closedLoopHandoffsDeepEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

// ---------------------------------------------------------------------------
// Run 指纹复核（round-trip 篡改拒绝）
// ---------------------------------------------------------------------------

/** 复核 run 链指纹是否与内容一致（防篡改 / 防字段退化）。 */
export function verifyClosedLoopRunFingerprint(run: ClosedLoopRun): boolean {
  if (run === null || typeof run !== "object") return false;
  const { fingerprint, ...rest } = run;
  const expected = fingerprint;
  const recomputed = computeClosedLoopRunFingerprint(rest as Omit<ClosedLoopRun, "fingerprint">);
  return expected === recomputed;
}

/** 校验日期窗口对象。 */
export function isClosedLoopDateRange(value: unknown): value is { startDate: string; endDate: string } {
  return (
    isRecord(value) &&
    typeof value.startDate === "string" &&
    DATE_RE.test(value.startDate) &&
    typeof value.endDate === "string" &&
    DATE_RE.test(value.endDate) &&
    value.startDate <= value.endDate
  );
}

/** 值是否为 ISO-8601 UTC 时间字符串。 */
export function isClosedLoopIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && DATE_TIME_RE.test(value);
}
