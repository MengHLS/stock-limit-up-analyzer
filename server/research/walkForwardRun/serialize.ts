/**
 * STEP 19 / C-19.1 — WalkForwardRun 序列化 / 反序列化 / 指纹 / 结构校验。
 *
 * 防篡改范式（对齐 C-17.1 / C-17.2 / C-18.1）：
 *   - canonical 序列化：`canonicalStringify`（server/researchDataset/version.ts，键字典序递归
 *     排序）→ 同一内容必然同一字符串；
 *   - 指纹：`sha256(canonical(body))`，body = 除 fingerprint 外的全部字段（含嵌套
 *     ParameterSearchRun / 冻结参数 / OOS 绩效）；
 *   - round-trip：`deserializeWalkForwardRun` 先做结构校验（validateWalkForwardRun，含嵌套
 *     C-17.1 `validateParameterSearchRun`）再复核指纹，任一不符 → 响亮抛错（篡改拒绝）；
 *   - NaN / Infinity 严格拒绝（JSON 会把它变成 null，属静默数据丢失，必须拦在序列化前）。
 *
 * 铁律：纯函数、无 IO；反序列化不做「尽力修复」，只做「全对或抛错」。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { validateParameterSearchRun } from "../parameterSearch/serialize";
import {
  WALK_FORWARD_RUN_RECORD_KIND,
  WALK_FORWARD_RUN_RECORD_VERSION,
  WALK_FORWARD_SKIP_REASON_CODES,
  type WalkForwardRun,
  type WalkForwardWindowRecord,
} from "./types";

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

/** WalkForwardRun 内容指纹（sha256，十六进制；除 fingerprint 字段外的 canonical JSON 摘要）。 */
export function computeWalkForwardRunFingerprint(body: Omit<WalkForwardRun, "fingerprint">): string {
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

/** 递归检查是否存在 NaN / Infinity（JSON.stringify 会把它们静默变成 null，必须拦在序列化前）。 */
function hasNonFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasNonFiniteNumber);
  }
  return false;
}

/**
 * 序列化 WalkForwardRun（canonical JSON；键序稳定，可直接入库 / 落盘 / 参与指纹）。
 * 含 NaN / Infinity → 响亮抛错（禁止静默变成 null）。
 */
export function serializeWalkForwardRun(record: WalkForwardRun): string {
  if (hasNonFiniteNumber(record)) {
    throw new ResearchValidationError([
      {
        code: "WFO19_RUN_NON_FINITE_NUMBER",
        path: "record",
        message: "WalkForwardRun 含 NaN / Infinity，禁止序列化（会静默丢失为 null）",
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

function isFiniteNumberOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function checkAggregate(value: unknown, issues: ResearchValidationIssue[], path: string): void {
  const issue = (code: string, p: string, message: string): void => {
    issues.push({ code, path: p, message });
  };
  if (!isPlainObject(value)) {
    issue("WFO19_RUN_AGGREGATE_INVALID", path, "aggregate 必须是对象");
    return;
  }
  const a = value as Record<string, unknown>;
  for (const field of [
    "plannedWindowCount",
    "optimizedWindowCount",
    "frozenWindowCount",
    "testedWindowCount",
    "skippedWindowCount",
  ] as const) {
    if (typeof a[field] !== "number" || !Number.isInteger(a[field]) || (a[field] as number) < 0) {
      issue("WFO19_RUN_AGGREGATE_INVALID", `${path}.${field}`, `${field} 必须是 >= 0 的整数`);
    }
  }
  for (const field of [
    "meanTrainTotalReturnPct",
    "meanTrainMaxDrawdownPct",
    "meanTestTotalReturnPct",
    "medianTestTotalReturnPct",
    "minTestTotalReturnPct",
    "maxTestTotalReturnPct",
    "meanTestMaxDrawdownPct",
    "maxTestMaxDrawdownPct",
    "cumulatedTestReturnPct",
    "oosDegradationPp",
  ] as const) {
    if (!isFiniteNumberOrNull(a[field])) {
      issue("WFO19_RUN_AGGREGATE_INVALID", `${path}.${field}`, `${field} 必须是有限数字或 null`);
    }
  }
}

function checkFreezeAudit(value: unknown, issues: ResearchValidationIssue[], path: string): void {
  const issue = (code: string, p: string, message: string): void => {
    issues.push({ code, path: p, message });
  };
  if (!isPlainObject(value)) {
    issue("WFO19_RUN_FREEZE_AUDIT_INVALID", path, "freezeIntegrity 必须是对象");
    return;
  }
  const a = value as Record<string, unknown>;
  for (const field of ["windowCount", "frozenWindowCount", "testedWindowCount"] as const) {
    if (typeof a[field] !== "number" || !Number.isInteger(a[field]) || (a[field] as number) < 0) {
      issue("WFO19_RUN_FREEZE_AUDIT_INVALID", `${path}.${field}`, `${field} 必须是 >= 0 的整数`);
    }
  }
  for (const field of [
    "allTestStageKeysMatchFrozen",
    "allTestStageParametersFrozen",
    "allTestWindowsAfterTrain",
    "passed",
  ] as const) {
    if (typeof a[field] !== "boolean") {
      issue("WFO19_RUN_FREEZE_AUDIT_INVALID", `${path}.${field}`, `${field} 必须是布尔值`);
    }
  }
  if (!Array.isArray(a.violations)) {
    issue("WFO19_RUN_FREEZE_AUDIT_INVALID", `${path}.violations`, "violations 必须是字符串数组");
  }
}

function checkWindow(
  value: unknown,
  index: number,
  issues: ResearchValidationIssue[],
  path: string,
): void {
  const issue = (code: string, p: string, message: string): void => {
    issues.push({ code, path: p, message });
  };
  if (!isPlainObject(value)) {
    issue("WFO19_RUN_WINDOW_INVALID", path, `windows[${index}] 必须是对象`);
    return;
  }
  const w = value as Record<string, unknown>;
  if (!isNonEmptyString(w.windowId)) {
    issue("WFO19_RUN_WINDOW_INVALID", `${path}.windowId`, "windowId 必须是非空字符串");
  }
  if (typeof w.windowIndex !== "number" || !Number.isInteger(w.windowIndex) || (w.windowIndex as number) < 0) {
    issue("WFO19_RUN_WINDOW_INVALID", `${path}.windowIndex`, "windowIndex 必须是 >= 0 的整数");
  } else if ((w.windowIndex as number) !== index) {
    issue("WFO19_RUN_WINDOW_INDEX_MISMATCH", `${path}.windowIndex`, `windows[${index}] 的 windowIndex 必须等于 ${index}`);
  }
  if (w.mode !== "rolling" && w.mode !== "anchored") {
    issue("WFO19_RUN_WINDOW_MODE_INVALID", `${path}.mode`, `mode=${String(w.mode)} 非法（期望 rolling | anchored）`);
  }

  // ---- Train 阶段（嵌套 C-17.1 SearchRun 完整校验）----
  if (!isPlainObject(w.train)) {
    issue("WFO19_RUN_TRAIN_INVALID", `${path}.train`, "train 必须是对象");
  } else {
    const t = w.train as Record<string, unknown>;
    if (!isNonEmptyString(t.windowId)) {
      issue("WFO19_RUN_TRAIN_INVALID", `${path}.train.windowId`, "train.windowId 必须是非空字符串");
    }
    for (const field of ["firstTrainDate", "lastTrainDate", "firstOptimizationDate", "lastOptimizationDate"] as const) {
      if (!isNonEmptyString(t[field])) {
        issue("WFO19_RUN_TRAIN_INVALID", `${path}.train.${field}`, `${field} 必须是非空字符串（YYYY-MM-DD）`);
      }
    }
    for (const field of ["trainDayCount", "optimizationDayCount", "embargoDayCount"] as const) {
      if (typeof t[field] !== "number" || !Number.isInteger(t[field]) || (t[field] as number) < 0) {
        issue("WFO19_RUN_TRAIN_INVALID", `${path}.train.${field}`, `${field} 必须是 >= 0 的整数`);
      }
    }
    if (t.windowIndex !== w.windowIndex) {
      issue("WFO19_RUN_TRAIN_INVALID", `${path}.train.windowIndex`, "train.windowIndex 必须与窗口一致");
    }
    const searchIssues = validateParameterSearchRun(t.searchRun).issues;
    for (const si of searchIssues) {
      issue(si.code, `${path}.train.searchRun.${si.path}`, si.message);
    }
  }

  // ---- 冻结参数 ----
  if (w.frozen !== null) {
    if (!isPlainObject(w.frozen)) {
      issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen`, "frozen 必须是对象或 null");
    } else {
      const f = w.frozen as Record<string, unknown>;
      if (!isNonEmptyString(f.parameterSetKey)) {
        issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen.parameterSetKey`, "parameterSetKey 必须是非空字符串");
      }
      if (!isPlainObject(f.parameterSet)) {
        issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen.parameterSet`, "parameterSet 必须是对象");
      }
      if (f.selection !== "median-qualified") {
        issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen.selection`, `selection=${String(f.selection)} 非法（期望 median-qualified）`);
      }
      for (const field of ["trainTotalReturnPct", "trainMaxDrawdownPct", "trainTradeCount"] as const) {
        if (!isFiniteNumberOrNull(f[field])) {
          issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen.${field}`, `${field} 必须是有限数字或 null`);
        }
      }
      if (!isNonEmptyString(f.regionVerdict)) {
        issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen.regionVerdict`, "regionVerdict 必须是非空字符串");
      }
      for (const field of ["qualifiedMemberCount", "memberIndex"] as const) {
        if (typeof f[field] !== "number" || !Number.isInteger(f[field]) || (f[field] as number) < 0) {
          issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen.${field}`, `${field} 必须是 >= 0 的整数`);
        }
      }
      if (!isNonEmptyString(f.sourceSearchRunId)) {
        issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen.sourceSearchRunId`, "sourceSearchRunId 必须是非空字符串");
      }
      if (!isNonEmptyString(f.frozenAt)) {
        issue("WFO19_RUN_FROZEN_INVALID", `${path}.frozen.frozenAt`, "frozenAt 必须是非空字符串（ISO-8601 UTC）");
      }
      if (typeof f.fingerprint !== "string" || !HEX64_RE.test(f.fingerprint)) {
        issue("WFO19_RUN_FROZEN_FINGERPRINT_INVALID", `${path}.frozen.fingerprint`, "fingerprint 必须是 64 位十六进制 sha256");
      }
    }
  }

  // ---- Test 阶段 ----
  if (!isPlainObject(w.test)) {
    issue("WFO19_RUN_TEST_INVALID", `${path}.test`, "test 必须是对象");
  } else {
    const s = w.test as Record<string, unknown>;
    for (const field of ["firstTestDate", "lastTestDate"] as const) {
      if (!isNonEmptyString(s[field])) {
        issue("WFO19_RUN_TEST_INVALID", `${path}.test.${field}`, `${field} 必须是非空字符串（YYYY-MM-DD）`);
      }
    }
    if (typeof s.testDayCount !== "number" || !Number.isInteger(s.testDayCount) || (s.testDayCount as number) < 1) {
      issue("WFO19_RUN_TEST_INVALID", `${path}.test.testDayCount`, "testDayCount 必须是 >= 1 的整数");
    }
    if (s.status !== "succeeded" && s.status !== "skipped") {
      issue("WFO19_RUN_TEST_INVALID", `${path}.test.status`, `status=${String(s.status)} 非法（期望 succeeded | skipped）`);
    }
    if (s.status === "succeeded") {
      if (!isPlainObject(s.parameterSet)) {
        issue("WFO19_RUN_TEST_INVALID", `${path}.test.parameterSet`, "succeeded 的 test 必须带 parameterSet");
      }
      if (!isNonEmptyString(s.parameterSetKey)) {
        issue("WFO19_RUN_TEST_INVALID", `${path}.test.parameterSetKey`, "succeeded 的 test 必须带 parameterSetKey");
      }
      if (s.parameterSetFrozen !== true) {
        issue("WFO19_FREEZE_NOT_FROZEN", `${path}.test.parameterSetFrozen`, "succeeded 的 test 参数集必须已深冻结（true）");
      }
      if (!isFiniteNumberOrNull(s.totalReturnPct) || !isFiniteNumberOrNull(s.maxDrawdownPct)) {
        issue("WFO19_RUN_TEST_INVALID", `${path}.test.metrics`, "succeeded 的 test 绩效必须是有限数字");
      }
    } else if (s.skipReasonCode === null || !WALK_FORWARD_SKIP_REASON_CODES.includes(s.skipReasonCode as never)) {
      issue("WFO19_RUN_TEST_INVALID", `${path}.test.skipReasonCode`, `skipReasonCode=${String(s.skipReasonCode)} 非法（skipped 必须给出合法原因码）`);
    }
  }
}

/**
 * 校验 WalkForwardRun 记录结构（顶层形态 + 嵌套 SearchRun / 冻结参数 / OOS 阶段 + 冻结纪律
 * 关键不变量）。指纹由 deserializeWalkForwardRun 复核，不在本函数内。
 */
export function validateWalkForwardRun(record: unknown): {
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
      issues: [{ code: "WFO19_RUN_INVALID", path: "record", message: "WalkForwardRun 必须是对象" }],
    };
  }
  const r = record;

  if (r.recordKind !== WALK_FORWARD_RUN_RECORD_KIND) {
    issue("WFO19_RUN_KIND_MISMATCH", "recordKind", `recordKind=${String(r.recordKind)} 不是 ${WALK_FORWARD_RUN_RECORD_KIND}`);
  }
  if (r.recordVersion !== WALK_FORWARD_RUN_RECORD_VERSION) {
    issue("WFO19_RUN_VERSION_MISMATCH", "recordVersion", `recordVersion=${String(r.recordVersion)} 不受支持（期望 ${WALK_FORWARD_RUN_RECORD_VERSION}）`);
  }
  for (const field of ["runId", "strategyId", "strategyVersion", "createdAt"] as const) {
    if (!isNonEmptyString(r[field])) {
      issue("WFO19_RUN_FIELD_EMPTY", field, `${field} 必须是非空字符串`);
    }
  }
  if (r.method !== "grid" && r.method !== "random") {
    issue("WFO19_RUN_METHOD_INVALID", "method", `method=${String(r.method)} 非法（期望 grid | random）`);
  }
  if (r.seed !== null && (typeof r.seed !== "number" || !Number.isInteger(r.seed))) {
    issue("WFO19_RUN_SEED_INVALID", "seed", "seed 必须为整数或 null");
  } else if (r.method === "random" && (typeof r.seed !== "number" || !Number.isInteger(r.seed))) {
    issue("WFO19_RUN_SEED_REQUIRED", "seed", "random 的 seed 必须是整数");
  }
  if (typeof r.requestedBudget !== "number" || !Number.isInteger(r.requestedBudget) || (r.requestedBudget as number) < 1) {
    issue("WFO19_RUN_BUDGET_INVALID", "requestedBudget", "requestedBudget 必须是 >= 1 的整数");
  }
  if (!isPlainObject(r.parameterSpace)) {
    issue("WFO19_RUN_SPACE_INVALID", "parameterSpace", "parameterSpace 必须是对象");
  }
  if (!isNonEmptyString(r.parameterSpaceFingerprint)) {
    issue("WFO19_RUN_SPACE_FP_INVALID", "parameterSpaceFingerprint", "parameterSpaceFingerprint 必须是非空字符串");
  }
  if (!Array.isArray(r.tradeDates)) {
    issue("WFO19_RUN_TRADE_DATES_INVALID", "tradeDates", "tradeDates 必须是数组");
  }
  if (!isNonEmptyString(r.tradeDatesFingerprint)) {
    issue("WFO19_RUN_TRADE_DATES_FP_INVALID", "tradeDatesFingerprint", "tradeDatesFingerprint 必须是非空字符串");
  }

  // ---- 窗口划分配置 ----
  if (!isPlainObject(r.splitConfig)) {
    issue("WFO19_RUN_SPLIT_CONFIG_INVALID", "splitConfig", "splitConfig 必须是对象");
  } else {
    const sc = r.splitConfig;
    if (sc.mode !== "rolling" && sc.mode !== "anchored") {
      issue("WFO19_RUN_SPLIT_CONFIG_INVALID", "splitConfig.mode", `mode=${String(sc.mode)} 非法（期望 rolling | anchored）`);
    }
    for (const field of ["trainWindow", "testWindow", "step"] as const) {
      if (typeof sc[field] !== "number" || !Number.isInteger(sc[field]) || (sc[field] as number) < 1) {
        issue("WFO19_RUN_SPLIT_CONFIG_INVALID", `splitConfig.${field}`, `${field} 必须是 >= 1 的整数`);
      }
    }
    for (const field of ["gap", "embargo"] as const) {
      if (typeof sc[field] !== "number" || !Number.isInteger(sc[field]) || (sc[field] as number) < 0) {
        issue("WFO19_RUN_SPLIT_CONFIG_INVALID", `splitConfig.${field}`, `${field} 必须是 >= 0 的整数`);
      }
    }
    if (sc.maxWindows !== null && (typeof sc.maxWindows !== "number" || !Number.isInteger(sc.maxWindows) || (sc.maxWindows as number) < 1)) {
      issue("WFO19_RUN_SPLIT_CONFIG_INVALID", "splitConfig.maxWindows", "maxWindows 必须为 null 或 >= 1 的整数");
    }
  }

  if (r.freezeSelection !== "median-qualified") {
    issue("WFO19_RUN_FREEZE_SELECTION_INVALID", "freezeSelection", `freezeSelection=${String(r.freezeSelection)} 非法（期望 median-qualified）`);
  }

  // ---- 逐窗记录 ----
  if (!Array.isArray(r.windows)) {
    issue("WFO19_RUN_WINDOWS_INVALID", "windows", "windows 必须是数组");
  } else {
    if (typeof r.windowCount !== "number" || !Number.isInteger(r.windowCount) || (r.windowCount as number) !== r.windows.length) {
      issue("WFO19_RUN_WINDOW_COUNT_INVALID", "windowCount", "windowCount 必须等于 windows.length");
    }
    r.windows.forEach((window, index) => checkWindow(window, index, issues, `windows[${index}]`));
  }

  checkFreezeAudit(r.freezeIntegrity, issues, "freezeIntegrity");
  checkAggregate(r.aggregate, issues, "aggregate");

  if (typeof r.fingerprint !== "string" || !HEX64_RE.test(r.fingerprint)) {
    issue("WFO19_RUN_FINGERPRINT_INVALID", "fingerprint", "fingerprint 必须是 64 位十六进制 sha256");
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 反序列化（结构校验 + 指纹复核；篡改即抛错）
// ---------------------------------------------------------------------------

/**
 * 反序列化 WalkForwardRun：先结构校验，再复核内容指纹。任一不符 → 响亮抛错。
 * 禁止「尽力修复」：被篡改 / 被截断的记录必须失败，而不是被静默接受。
 */
export function deserializeWalkForwardRun(json: string): WalkForwardRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ResearchValidationError([
      {
        code: "WFO19_RUN_JSON_INVALID",
        path: "json",
        message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
  const validation = validateWalkForwardRun(parsed);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const record = parsed as WalkForwardRun;
  const body: Omit<WalkForwardRun, "fingerprint"> = { ...record, fingerprint: undefined } as Omit<
    WalkForwardRun,
    "fingerprint"
  >;
  const expected = computeWalkForwardRunFingerprint(body);
  if (expected !== record.fingerprint) {
    throw new ResearchValidationError([
      {
        code: "WFO19_RUN_FINGERPRINT_MISMATCH",
        path: "fingerprint",
        message: `指纹不匹配（期望 ${expected}，实际 ${record.fingerprint}）：记录被篡改或字段被改动`,
      },
    ]);
  }
  return record;
}

// ---------------------------------------------------------------------------
// 便捷：窗口级冻结记录读取（供下游只读消费）
// ---------------------------------------------------------------------------

/** 取出全部成功冻结的参数集（windowIndex 升序；未冻结的窗跳过）。 */
export function collectWalkForwardFrozenParameterSets(
  windows: readonly WalkForwardWindowRecord[],
): { readonly windowIndex: number; readonly parameterSetKey: string }[] {
  return windows
    .filter((window) => window.frozen !== null)
    .map((window) => ({
      windowIndex: window.windowIndex,
      parameterSetKey: window.frozen!.parameterSetKey,
    }));
}
