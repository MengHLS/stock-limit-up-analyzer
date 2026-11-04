/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management：生命周期壳校验器（纯函数）。
 *
 * 对齐既有校验体系（strategySchema/experimentLineage）：返回 ResearchValidationResult
 * （不抛错），assert* 入口非法时抛 ResearchValidationError；禁止静默 fallback / 兜底。
 *
 * 校验对象：StrategyLifecycleRecord（生命周期壳）
 *   - 书签（recordKind/recordVersion/fingerprint）；
 *   - 绑定身份（strategyId / strategyVersion 严格 semver / versionRecordFingerprint 64hex）；
 *   - transitions 结构（seq 从 0 连续、genesis 首跳 from=null/prevHash=null、非 genesis 跳
 *     from===上一跳 to、记录 status===最后一跳 to、hash/prevHash 形态）；
 *   - 每跳 §23 四要素 + 档位门槛（委托 gates.collectTransitionRequirementIssues：
 *     timestamp/reason 底线、experiment/evidence 档位要求、evidence 引用格式、genesis 限制）。
 *
 * 依赖纪律：结构/语义校验在本文件；**链 hash 重算（crypto）在 serialize.ts**（本文件不
 * import serialize，防循环依赖）；deserialize 时才做 chain 复核 + 指纹复核。
 */

import { ResearchValidationError, type ResearchValidationIssue, type ResearchValidationResult } from "../experimentValidation";
import { isValidStrategyVersionFormat } from "../strategySchema/types";
import { collectTransitionRequirementIssues } from "./gates";
import {
  STRATEGY_LIFECYCLE_RECORD_KIND,
  STRATEGY_LIFECYCLE_RECORD_VERSION,
  isStrategyLifecycleStatus,
  type LifecycleTransition,
  type StrategyLifecycleRecord,
  type StrategyLifecycleStatus,
} from "./types";

const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

function assertValid(r: ResearchValidationResult): void {
  if (!r.valid) throw new ResearchValidationError(r.issues);
}

function checkNonEmptyString(
  value: unknown,
  path: string,
  code: string,
  label: string,
  issues: ResearchValidationIssue[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue(code, path, `${label} 必须是非空字符串，实际：${String(value)}`));
  }
}

// ---------------------------------------------------------------------------
// 单条 transition 的结构 + 语义（含四要素/档位门槛）
// ---------------------------------------------------------------------------

/** 校验单条 transition（不含链连续性——连续性由记录级 iterateTransitions 统一把关）。 */
function validateTransitionShape(
  transition: unknown,
  index: number,
  issues: ResearchValidationIssue[],
): void {
  const base = `transitions[${index}]`;
  if (transition === null || typeof transition !== "object" || Array.isArray(transition)) {
    issues.push(issue("LIFECYCLE_TRANSITION_INVALID", base, `transitions[${index}] 必须是对象`));
    return;
  }
  const t = transition as unknown as LifecycleTransition;

  if (t.seq !== index) {
    issues.push(issue(
      "LIFECYCLE_TRANSITION_SEQ_INVALID",
      `${base}.seq`,
      `transitions[${index}].seq 必须是 ${index}（seq 从 0 连续递增，append-only 不许重排/插入），实际：${String(t.seq)}`,
    ));
  }

  // from/to 状态值域。
  if (t.from !== null && !isStrategyLifecycleStatus(String(t.from))) {
    issues.push(issue("LIFECYCLE_TRANSITION_FROM_INVALID", `${base}.from`, `transitions[${index}].from 非法：${String(t.from)}`));
  }
  if (!isStrategyLifecycleStatus(String(t.to))) {
    issues.push(issue("LIFECYCLE_TRANSITION_TO_INVALID", `${base}.to`, `transitions[${index}].to 非法：${String(t.to)}`));
  }

  // prevHash / hash 形态（crypto 复核在 serialize）。
  if (t.prevHash !== null && (typeof t.prevHash !== "string" || !FINGERPRINT_RE.test(t.prevHash))) {
    issues.push(issue("LIFECYCLE_TRANSITION_PREV_HASH_INVALID", `${base}.prevHash`, `prevHash 必须是 null（genesis）或 64 位 hex（sha256），实际：${String(t.prevHash)}`));
  }
  if (typeof t.hash !== "string" || !FINGERPRINT_RE.test(t.hash)) {
    issues.push(issue("LIFECYCLE_TRANSITION_HASH_INVALID", `${base}.hash`, `hash 必须是 64 位 hex（sha256），实际：${String(t.hash)}`));
  }
  if (t.experimentId !== null && t.experimentId !== undefined) {
    if (typeof t.experimentId !== "string") {
      issues.push(issue("LIFECYCLE_TRANSITION_EXPERIMENT_INVALID", `${base}.experimentId`, `experimentId 必须是 string | null，实际：${String(t.experimentId)}`));
    }
  }
  if (t.actor !== null && t.actor !== undefined && typeof t.actor !== "string") {
    issues.push(issue("LIFECYCLE_TRANSITION_ACTOR_INVALID", `${base}.actor`, `actor 必须是 string | null，实际：${String(t.actor)}`));
  }

  // §23 四要素 + 档位门槛（含 evidence 引用格式与阈值，一次覆盖；见 gates.collectTransitionRequirementIssues）。
  const toValid = isStrategyLifecycleStatus(String(t.to));
  const fromValid = t.from === null || isStrategyLifecycleStatus(String(t.from));
  if (toValid && fromValid) {
    const to = t.to as StrategyLifecycleStatus;
    const from = t.from === null ? null : (t.from as StrategyLifecycleStatus);
    issues.push(...collectTransitionRequirementIssues(
      from,
      to,
      t.timestamp,
      t.reason,
      t.experimentId ?? null,
      t.evidence ?? [],
      t.actor ?? null,
      base,
    ));
  }
}

// ---------------------------------------------------------------------------
// 记录级不变量（链连续性 / status 一致 / 绑定身份）
// ---------------------------------------------------------------------------

/** 主校验：StrategyLifecycleRecord。 */
export function validateStrategyLifecycleRecord(record: StrategyLifecycleRecord | undefined | null): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return result([issue("LIFECYCLE_RECORD_INVALID", "record", "生命周期壳缺失或非对象")]);
  }
  const r = record as unknown as StrategyLifecycleRecord;

  // -- 书签 --
  if (r.recordKind !== STRATEGY_LIFECYCLE_RECORD_KIND) {
    issues.push(issue("LIFECYCLE_KIND_INVALID", "recordKind", `recordKind 必须是 ${STRATEGY_LIFECYCLE_RECORD_KIND}，实际：${String(r.recordKind)}`));
  }
  if (r.recordVersion !== STRATEGY_LIFECYCLE_RECORD_VERSION) {
    issues.push(issue("LIFECYCLE_RECORD_VERSION_INVALID", "recordVersion", `recordVersion 必须是 ${STRATEGY_LIFECYCLE_RECORD_VERSION}，实际：${String(r.recordVersion)}`));
  }

  // -- 绑定身份 --
  checkNonEmptyString(r.strategyId, "strategyId", "LIFECYCLE_STRATEGY_ID_EMPTY", "strategyId", issues);
  if (typeof r.strategyVersion !== "string" || !isValidStrategyVersionFormat(r.strategyVersion)) {
    issues.push(issue(
      "LIFECYCLE_STRATEGY_VERSION_INVALID",
      "strategyVersion",
      `strategyVersion 必须是合法 major.minor.patch（与 StrategyVersionRecord.version 对齐），实际：${String(r.strategyVersion)}`,
    ));
  }
  if (typeof r.versionRecordFingerprint !== "string" || !FINGERPRINT_RE.test(r.versionRecordFingerprint)) {
    issues.push(issue(
      "LIFECYCLE_VERSION_RECORD_FINGERPRINT_INVALID",
      "versionRecordFingerprint",
      `versionRecordFingerprint 必须是 64 位 hex（绑定的 §17 StrategyVersionRecord 内容指纹），实际：${String(r.versionRecordFingerprint)}`,
    ));
  }

  // -- status 值域 --
  if (!isStrategyLifecycleStatus(String(r.status))) {
    issues.push(issue("LIFECYCLE_STATUS_INVALID", "status", `status 必须是合法生命周期状态，实际：${String(r.status)}`));
  }

  // -- transitions --
  if (r.transitions === null || !Array.isArray(r.transitions) || r.transitions.length === 0) {
    issues.push(issue("LIFECYCLE_TRANSITIONS_EMPTY", "transitions", "transitions 必须是非空数组（至少含 genesis 首跳；生命周期壳从诞生即审计）"));
    return result(issues);
  }

  r.transitions.forEach((transition, index) => validateTransitionShape(transition, index, issues));

  // -- 链结构不变量：genesis 首跳 + 逐跳衔接 + status===末跳 to --
  const first = r.transitions[0] as unknown as LifecycleTransition;
  if (first.from !== null) {
    issues.push(issue("LIFECYCLE_GENESIS_NOT_FIRST", "transitions[0].from", "transitions[0] 必须是 genesis 首跳（from=null）：生命周期壳从出生即审计，禁止凭空插入前驱"));
  }
  if (first.prevHash !== null) {
    issues.push(issue("LIFECYCLE_GENESIS_PREV_HASH_NOT_NULL", "transitions[0].prevHash", "genesis 首跳 prevHash 必须为 null（链头）"));
  }

  let expectedFrom: StrategyLifecycleRecord["status"] | null = null;
  for (let i = 1; i < r.transitions.length; i += 1) {
    const prev = r.transitions[i - 1] as unknown as LifecycleTransition;
    const cur = r.transitions[i] as unknown as LifecycleTransition;
    expectedFrom = prev.to;
    if (cur.from !== expectedFrom) {
      issues.push(issue(
        "LIFECYCLE_CHAIN_FROM_MISMATCH",
        `transitions[${i}].from`,
        `transitions[${i}].from（${String(cur.from)}）必须等于上一跳 to（${String(expectedFrom)}）；审计链按 §23 顺序逐跳衔接，禁止跳级改写`,
      ));
    }
    if (cur.prevHash !== prev.hash) {
      issues.push(issue(
        "LIFECYCLE_CHAIN_LINK_MISMATCH",
        `transitions[${i}].prevHash`,
        `transitions[${i}].prevHash 必须等于 transitions[${i - 1}].hash（审计链 append-only，hash 逐跳衔接；crypto 复核见 serialize.verifyLifecycleTransitionChain）`,
      ));
    }
  }

  if (isStrategyLifecycleStatus(String(r.status)) && r.transitions.length > 0) {
    const lastTo = (r.transitions[r.transitions.length - 1] as unknown as LifecycleTransition).to;
    if (r.status !== lastTo) {
      issues.push(issue(
        "LIFECYCLE_STATUS_NOT_LAST",
        "status",
        `status（${r.status}）必须等于最后一跳 to（${String(lastTo)}）；禁止 status 与迁移历史脱节（只改状态不落审计 = 无记录修改）`,
      ));
    }
  }

  // -- fingerprint 非空 --
  if (typeof r.fingerprint !== "string" || r.fingerprint.trim() === "") {
    issues.push(issue("LIFECYCLE_FINGERPRINT_EMPTY", "fingerprint", "fingerprint 必须是非空字符串"));
  }

  return result(issues);
}

/** 生命周期壳非法即抛 ResearchValidationError。 */
export function assertValidStrategyLifecycleRecord(record: StrategyLifecycleRecord | undefined | null): void {
  assertValid(validateStrategyLifecycleRecord(record));
}
