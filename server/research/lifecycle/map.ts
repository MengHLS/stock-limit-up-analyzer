/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management：组装 / 迁移控制器（纯函数、不可变）。
 *
 * 职责：
 *   - createStrategyLifecycleRecord：给定 §23 生命周期壳输入 → 组装 genesis 首跳 + 全壳
 *     （校验 → 规范 sequence → 计算单跳 hash 与全壳指纹 → 深冻结）；
 *   - createLifecycleFromVersionRecord：由 C-15.1 StrategyVersionRecord 直接建壳
 *     （绑定内容指纹，展示与策略本体的「壳层」关系，不改 strategySchema）；
 *   - applyLifecycleTransition：**唯一**的「状态变更 API」——同步校验迁移合法性 +
 *     §23 四要素 + 档位证据门槛，然后 append 一条 LifecycleTransition 并产出新壳
 *     （原壳不可变）。不存在「只改状态不落审计」的入口（§23 禁止无记录修改，fail fast）。
 *
 * 铁律：纯模块，无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、可序列化、确定性；
 * 失败响亮（ResearchValidationError 携带结构化 issue，中文信息）。
 */

import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import { assertValidStrategyVersionRecord } from "../strategySchema/validate";
import type { StrategyVersionRecord } from "../strategySchema/types";
import { collectTransitionRequirementIssues } from "./gates";
import {
  computeLifecycleTransitionHash,
  computeStrategyLifecycleRecordFingerprint,
} from "./serialize";
import {
  STRATEGY_LIFECYCLE_RECORD_KIND,
  STRATEGY_LIFECYCLE_RECORD_VERSION,
  STRATEGY_STATUS_DRAFT,
  type LifecycleTransition,
  type LifecycleTransitionInput,
  type StrategyLifecycleRecord,
  type StrategyLifecycleRecordInput,
} from "./types";
import { assertValidStrategyLifecycleRecord } from "./validate";

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 深冻结（复制入参后冻结，绝不冻结调用方共享对象）。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

function asIssuesOrThrow(issues: ResearchValidationIssue[]): void {
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}

/** 由字段组装一条 transition（不含 hash——hash 由调用方按字段计算后再挂上）。 */
function buildTransitionBody(
  seq: number,
  from: StrategyLifecycleRecord["status"] | null,
  to: StrategyLifecycleRecord["status"],
  timestamp: string,
  reason: string,
  experimentId: string | null,
  evidence: LifecycleTransition["evidence"],
  actor: string | null,
  prevHash: string | null,
): Omit<LifecycleTransition, "hash"> {
  return { seq, from, to, timestamp, reason, experimentId, evidence, actor, prevHash };
}

// ---------------------------------------------------------------------------
// 组装：genesis 建壳
// ---------------------------------------------------------------------------

/** 由 §23 四要素组装 genesis 首跳的完整记录（含单跳 hash）。 */
function buildGenesisTransition(input: StrategyLifecycleRecordInput): LifecycleTransition {
  const initialStatus = input.initialStatus ?? STRATEGY_STATUS_DRAFT;
  const experimentId = input.experimentId ?? null;
  const evidence = structuredClone(input.evidence ?? []);
  const actor = input.actor ?? null;

  // genesis 门槛：Draft 可空 / Research 需 inheritance；initialStatus 越界拒绝。
  asIssuesOrThrow(collectTransitionRequirementIssues(
    null,
    initialStatus,
    input.timestamp,
    input.reason,
    experimentId,
    evidence,
    actor,
    "genesis",
  ));

  const body = buildTransitionBody(0, null, initialStatus, input.timestamp, input.reason, experimentId, evidence, actor, null);
  const hash = computeLifecycleTransitionHash(body);
  return { ...body, hash };
}

/**
 * 组装 §23 生命周期壳（不可变、确定性）。
 * genesis 首跳 from=null / prevHash=null；后续状态一律经 applyLifecycleTransition append。
 */
export function createStrategyLifecycleRecord(input: StrategyLifecycleRecordInput): StrategyLifecycleRecord {
  const genesis = buildGenesisTransition(input);
  const body = {
    recordKind: STRATEGY_LIFECYCLE_RECORD_KIND,
    recordVersion: STRATEGY_LIFECYCLE_RECORD_VERSION,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    versionRecordFingerprint: input.versionRecordFingerprint,
    status: genesis.to,
    transitions: [genesis],
  };
  const fingerprint = computeStrategyLifecycleRecordFingerprint(body);
  const record = { ...body, fingerprint } as unknown as StrategyLifecycleRecord;
  assertValidStrategyLifecycleRecord(record);
  return deepFreeze(record);
}

/**
 * 由 C-15.1 StrategyVersionRecord（§17 版本追溯记录）直接建壳（展示壳层绑定）。
 * strategyId / strategyVersion / versionRecordFingerprint 从版本记录派生，杜绝手填串绑；
 * 版本记录本身先经 assertValidStrategyVersionRecord（非法即抛，不改 strategySchema）。
 */
export function createLifecycleFromVersionRecord(
  versionRecord: StrategyVersionRecord,
  input: Omit<
    StrategyLifecycleRecordInput,
    "strategyId" | "strategyVersion" | "versionRecordFingerprint"
  >,
): StrategyLifecycleRecord {
  assertValidStrategyVersionRecord(versionRecord);
  return createStrategyLifecycleRecord({
    strategyId: versionRecord.strategyId,
    strategyVersion: versionRecord.version,
    versionRecordFingerprint: versionRecord.fingerprint,
    ...input,
  });
}

// ---------------------------------------------------------------------------
// 控制器：状态变更 = 迁移合法性 + 四要素 + 档位证据门槛 → append 新跳（不可变）
// ---------------------------------------------------------------------------

/**
 * §23 状态变更控制器：`applyTransition(record, input) → 新壳（追加一条 transition）`。
 *
 * 行为契约（fail fast，禁止无记录修改）：
 *   1. 目标状态非法 / 迁移边非法（跳级、回退超白名单、同态、对 Retired 复活）→ 抛错；
 *   2. §23 四要素（timestamp/reason/experiment/evidence）缺失 → 抛错；
 *   3. 档位证据门槛（→Validated/→Production 等 datasetGate/metrics 引用）未满足 → 抛错；
 *   4. 全部通过才 append：seq=原链长度、from=原 status、prevHash=原末跳 hash、
 *      单跳 hash=sha256(本跳全部字段 + prevHash)，status 推进到 to；
 *   5. 原记录不被修改（不可变；返回全新深冻结记录）。
 */
export function applyLifecycleTransition(
  record: StrategyLifecycleRecord,
  input: LifecycleTransitionInput,
): StrategyLifecycleRecord {
  assertValidStrategyLifecycleRecord(record);

  const from = record.status;
  const to = input.to;
  const experimentId = input.experimentId ?? null;
  const evidence = structuredClone(input.evidence ?? []);
  const actor = input.actor ?? null;

  // -- 迁移合法性 + §23 四要素 + 档位证据门槛（一次校验；不满足立即抛，不产新记录） --
  asIssuesOrThrow(collectTransitionRequirementIssues(
    from,
    to,
    input.timestamp,
    input.reason,
    experimentId,
    evidence,
    actor,
    `transition(${from} → ${to})`,
  ));

  const lastTransition = record.transitions[record.transitions.length - 1];
  if (lastTransition === undefined) {
    throw new Error(`applyLifecycleTransition: 生命周期壳 ${record.strategyId}@${record.strategyVersion} 的 transitions 为空（数据损坏，应至少含 genesis 首跳）`);
  }

  const seq = record.transitions.length;
  const body = buildTransitionBody(seq, from, to, input.timestamp, input.reason, experimentId, evidence, actor, lastTransition.hash);
  const transition: LifecycleTransition = { ...body, hash: computeLifecycleTransitionHash(body) };

  const nextBody = {
    recordKind: record.recordKind,
    recordVersion: record.recordVersion,
    strategyId: record.strategyId,
    strategyVersion: record.strategyVersion,
    versionRecordFingerprint: record.versionRecordFingerprint,
    status: to,
    transitions: [...record.transitions, transition],
  };
  const fingerprint = computeStrategyLifecycleRecordFingerprint(nextBody);
  const next = { ...nextBody, fingerprint } as unknown as StrategyLifecycleRecord;
  assertValidStrategyLifecycleRecord(next);
  return deepFreeze(next);
}
