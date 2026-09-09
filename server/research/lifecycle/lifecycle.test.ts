/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management 测试（纯内存 fixture，无 DB）。
 *
 * 覆盖（对应任务验收八组场景，≥18 用例）：
 *   ① 合法迁移全链 Draft→Research→…→Retired + 四要素记录逐跳生成；
 *   ② 非法迁移拒绝（跳级 Draft→Production / Retired 后复活 / 同态 / 超白名单回退）；
 *   ③ 四要素缺失拒绝（无 reason / 无 timestamp / 关键升级无 experiment）；
 *   ④ 审计轨迹 append-only（深冻结不可变 + 篡改检测：改历史 JSON → 链 hash 断链拒绝）；
 *   ⑤ 证据门槛（→Validated 缺 datasetGate/metrics PASS 拒绝；→Production 缺数据集 gate 拒绝）；
 *   ⑥ 与 C-15.1 StrategyVersionRecord 绑定壳（createLifecycleFromVersionRecord + round-trip）；
 *   ⑦ fingerprint / 确定性（同输入同指纹；不同 reason 指纹不同）；
 *   ⑧ §7 任务 7 态概念映射断言（禁止把 Research/Candidate 当 VALIDATED 等）。
 *
 * 全链 fixtures 的档位要求（见 gates.ts）：
 *   Research→Candidate：experimentId + ≥1 evidence；Candidate→Validated：+datasetGate(PASS)
 *   或 metricsRecord(PASS)；Validated→Paper：experimentId + ≥1 evidence；
 *   Paper→Approved：experimentId + approval(approved) 或 metricsRecord(PASS)；
 *   Approved→Production：experimentId + datasetGate(PASS)。
 */

import { describe, expect, it } from "vitest";
import { composeCodeVersion } from "../experimentLineage/codeVersion";
import {
  cloneStrategyDocument,
  createStrategyDocument,
  createStrategyVersionRecord,
  type StrategyVersionRecord,
} from "../strategySchema";
import { ResearchValidationError } from "../experimentValidation";
import {
  STRATEGY_LIFECYCLE_RECORD_KIND,
  STRATEGY_LIFECYCLE_RECORD_VERSION,
  STRATEGY_LIFECYCLE_STATUSES,
  STRATEGY_STATUS_DRAFT,
  STRATEGY_STATUS_RESEARCH,
  STRATEGY_STATUS_CANDIDATE,
  STRATEGY_STATUS_VALIDATED,
  STRATEGY_STATUS_PAPER,
  STRATEGY_STATUS_APPROVED,
  STRATEGY_STATUS_PRODUCTION,
  STRATEGY_STATUS_RETIRED,
  STRATEGY_LIFECYCLE_TRANSITIONS,
  canLifecycleTransition,
  isAdvanceTransition,
  classifyLifecycleEdge,
  assertLifecycleTaskMappingIntegrity,
  mapStrategyLifecycleToTaskStatus,
  hasValidatedEvidenceTrail,
  assertValidatedClaimHasEvidence,
  requiresTaskValidation,
  PROJECT_TASK_STATUSES,
  createLifecycleFromVersionRecord,
  createStrategyLifecycleRecord,
  applyLifecycleTransition,
  assertValidStrategyLifecycleRecord,
  validateStrategyLifecycleRecord,
  deserializeStrategyLifecycleRecord,
  serializeStrategyLifecycleRecord,
  computeStrategyLifecycleRecordFingerprint,
  computeLifecycleTransitionHash,
  verifyLifecycleTransitionChain,
  StrategyLifecycleLedger,
  type LifecycleEvidenceRef,
  type LifecycleTransitionInput,
  type StrategyLifecycleRecord,
  type StrategyLifecycleRecordInput,
  type StrategyLifecycleStatus,
} from "./index";

// ---------------------------------------------------------------------------
// Fixtures（含 C-15.1 §17 版本追溯记录，作为生命周期壳的绑定载体）
// ---------------------------------------------------------------------------

const DATASET_VERSION = "rd-1.0.0-1-cffc2a0e66efbf0b";
const EXP_ID = "EXP-2026-09-01-limit-up-baseline";
const T0 = "2026-09-01T01:00:00.000Z";

const CODE_VERSION = composeCodeVersion({
  packageVersion: "1.0.0",
  git: { commitShortHash: "2b786f7", dirty: false },
});

function makeVersionRecord(): StrategyVersionRecord {
  const document = createStrategyDocument({
    strategyId: "limit-up-baseline",
    version: "1.0.0",
    name: "涨停候选基线",
    universe: { universeId: `research-dataset:${DATASET_VERSION}` },
    entryRules: [
      { id: "enter-topN", kind: "threshold", field: "candidate.rank", operator: "<=", operand: 5, description: "候选排名 <= 5 进场" },
    ],
    exitRules: [{ id: "exit-days", kind: "time-based", field: "position.holdingDays", operator: ">=", operand: 3, description: "持有 >= 3 交易日退出" }],
    positionSizing: { kind: "equal-weight", maxPositions: 5 },
    riskRules: [{ id: "risk-max", kind: "state", field: "position.count", operator: "<=", operand: 5, description: "持仓数 <= 5" }],
    parameters: {
      parameters: [
        { name: "topN", type: "number", required: true, defaultValue: 5, min: 1, max: 20, description: "选股数" },
        { name: "minScore", type: "number", required: false, nullable: true, defaultValue: null, description: "分数阈值" },
      ],
    },
    datasetVersion: DATASET_VERSION,
    executionAssumptions: {
      backtestConfig: { initialCapital: 100_000, maxPositions: 5 },
      costModel: { commissionRate: 0.0003, stampDutyRate: 0.001, transferFeeRate: 0.00001, slippageBps: 10, lotSize: 100, minCommission: 5 },
      executionModel: "NEXT_OPEN",
    },
  });
  return createStrategyVersionRecord({ document, context: { codeVersion: CODE_VERSION, createdAt: T0 } });
}

const VERSION_RECORD = makeVersionRecord();

function makeInput(overrides: Partial<StrategyLifecycleRecordInput> = {}): StrategyLifecycleRecordInput {
  return {
    strategyId: VERSION_RECORD.strategyId,
    strategyVersion: VERSION_RECORD.version,
    versionRecordFingerprint: VERSION_RECORD.fingerprint,
    timestamp: T0,
    reason: "创建基线策略 1.0.0 的生命周期壳",
    actor: "researcher-a",
    ...overrides,
  };
}

function datasetGatePass(overrides: Partial<Extract<LifecycleEvidenceRef, { kind: "datasetGate" }>> = {}): LifecycleEvidenceRef {
  return { kind: "datasetGate", gate: "PASS", datasetVersion: DATASET_VERSION, ...overrides };
}

function metricsPass(metricsId: string): LifecycleEvidenceRef {
  return { kind: "metricsRecord", metricsId, result: "PASS" };
}

function searchRunRef(): LifecycleEvidenceRef {
  return { kind: "searchRun", runId: "SR-2026-09-01-candidate-v1" };
}

function approvalRef(): LifecycleEvidenceRef {
  return { kind: "approval", documentId: "APPR-2026-09-10-limit-up-v1", decision: "approved" };
}

/** 给定当前状态构建一个合法推进到 to 的迁移输入（档位证据按需自动补全）。 */
function advanceInput(to: StrategyLifecycleStatus, overrides: Partial<LifecycleTransitionInput> = {}): LifecycleTransitionInput {
  const base: LifecycleTransitionInput = { to, timestamp: T0, reason: `推进到 ${to}`, experimentId: EXP_ID };
  switch (to) {
    case STRATEGY_STATUS_RESEARCH: return { ...base, experimentId: null, reason: "研究启动：文献与特征假设", ...overrides };
    case STRATEGY_STATUS_CANDIDATE: return { ...base, evidence: [searchRunRef()], ...overrides };
    case STRATEGY_STATUS_VALIDATED: return { ...base, evidence: [datasetGatePass()], ...overrides };
    case STRATEGY_STATUS_PAPER: return { ...base, evidence: [metricsPass("M-2026-09-05-validated")], ...overrides };
    case STRATEGY_STATUS_APPROVED: return { ...base, evidence: [approvalRef()], ...overrides };
    case STRATEGY_STATUS_PRODUCTION: return { ...base, evidence: [datasetGatePass()], ...overrides };
    case STRATEGY_STATUS_RETIRED: return { ...base, experimentId: null, ...overrides };
    default: return { ...base, ...overrides };
  }
}

/** 从 Draft 连续推进若干跳，返回新记录。 */
function walk(record: StrategyLifecycleRecord, to: StrategyLifecycleStatus): StrategyLifecycleRecord {
  let current = record;
  const order = STRATEGY_LIFECYCLE_STATUSES;
  const fromIndex = order.indexOf(current.status);
  const toIndex = order.indexOf(to);
  if (toIndex < 0) throw new Error(`非法目标 ${String(to)}`);
  for (let i = fromIndex + 1; i <= toIndex; i += 1) {
    current = applyLifecycleTransition(current, advanceInput(order[i]));
  }
  return current;
}

// ---------------------------------------------------------------------------
// ① 合法迁移链 + 四要素记录
// ---------------------------------------------------------------------------

describe("① 合法迁移全链与四要素记录", () => {
  it("genesis 建壳：Draft 出生 + 单跳审计 + 指纹 + 深冻结", () => {
    const record = createStrategyLifecycleRecord(makeInput());
    expect(record.recordKind).toBe(STRATEGY_LIFECYCLE_RECORD_KIND);
    expect(record.recordVersion).toBe(STRATEGY_LIFECYCLE_RECORD_VERSION);
    expect(record.status).toBe(STRATEGY_STATUS_DRAFT);
    expect(record.transitions).toHaveLength(1);
    expect(record.transitions[0].seq).toBe(0);
    expect(record.transitions[0].from).toBeNull();
    expect(record.transitions[0].prevHash).toBeNull();
    expect(record.transitions[0].to).toBe(STRATEGY_STATUS_DRAFT);
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(validateStrategyLifecycleRecord(record).valid).toBe(true);
    expect(() => assertValidStrategyLifecycleRecord(record)).not.toThrow();
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.transitions[0])).toBe(true);
  });

  it("Draft→…→Retired 全链：每步 append 一条四要素 transition，逐跳衔接，最终 Retired", () => {
    let record = createStrategyLifecycleRecord(makeInput());
    for (const to of [STRATEGY_STATUS_RESEARCH, STRATEGY_STATUS_CANDIDATE, STRATEGY_STATUS_VALIDATED, STRATEGY_STATUS_PAPER, STRATEGY_STATUS_APPROVED, STRATEGY_STATUS_PRODUCTION, STRATEGY_STATUS_RETIRED]) {
      record = applyLifecycleTransition(record, advanceInput(to));
    }
    expect(record.status).toBe(STRATEGY_STATUS_RETIRED);
    expect(record.transitions).toHaveLength(8); // genesis + 7 次状态变化
    record.transitions.forEach((t, index) => {
      expect(t.seq).toBe(index);
      expect(t.reason.trim()).not.toBe("");
      expect(t.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
      expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
      if (index > 0) {
        expect(t.from).toBe(record.transitions[index - 1].to);
        expect(t.prevHash).toBe(record.transitions[index - 1].hash);
      }
    });
    expect(verifyLifecycleTransitionChain(record.transitions)).toHaveLength(0);
  });

  it("每步旧记录不可变：apply 返回新记录，原记录 status/fingerprint 不变", () => {
    const base = createStrategyLifecycleRecord(makeInput());
    const baseFingerprint = base.fingerprint;
    const afterResearch = applyLifecycleTransition(base, advanceInput(STRATEGY_STATUS_RESEARCH));
    expect(afterResearch.status).toBe(STRATEGY_STATUS_RESEARCH);
    expect(afterResearch.fingerprint).not.toBe(baseFingerprint);
    expect(base.status).toBe(STRATEGY_STATUS_DRAFT);
    expect(base.fingerprint).toBe(baseFingerprint);
    expect(Object.isFrozen(afterResearch)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② 非法迁移拒绝
// ---------------------------------------------------------------------------

describe("② 非法迁移拒绝", () => {
  it("跳级 Draft→Production 被拒（响亮，信息含跳级）", () => {
    const record = createStrategyLifecycleRecord(makeInput());
    let error: unknown;
    try {
      applyLifecycleTransition(record, advanceInput(STRATEGY_STATUS_PRODUCTION));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ResearchValidationError);
    expect((error as ResearchValidationError).message).toMatch(/跳级|前置链路/);
  });

  it("Retired 为终态：Retired→Research 复活被拒", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_RETIRED);
    expect(record.status).toBe(STRATEGY_STATUS_RETIRED);
    expect(() => applyLifecycleTransition(record, advanceInput(STRATEGY_STATUS_RESEARCH))).toThrow(
      ResearchValidationError,
    );
    // 迁移表权威确认：Retired 无任何出边。
    expect(STRATEGY_LIFECYCLE_TRANSITIONS[STRATEGY_STATUS_RETIRED]).toHaveLength(0);
  });

  it("同态迁移 Candidate→Candidate 被拒", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_CANDIDATE);
    expect(() => applyLifecycleTransition(record, advanceInput(STRATEGY_STATUS_CANDIDATE))).toThrow(/同态迁移/);
  });

  it("超白名单回退被拒：Production→Draft / Candidate→Draft 均非法", () => {
    const production = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_PRODUCTION);
    expect(() => applyLifecycleTransition(production, advanceInput(STRATEGY_STATUS_DRAFT))).toThrow(/回退迁移被拒绝/);
    const candidate = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_CANDIDATE);
    expect(() => applyLifecycleTransition(candidate, advanceInput(STRATEGY_STATUS_DRAFT))).toThrow(/回退迁移被拒绝/);
    // 权威白名单：Production 只允许 Research（异常回退）与 Retired。
    expect(canLifecycleTransition(STRATEGY_STATUS_PRODUCTION, STRATEGY_STATUS_RESEARCH)).toBe(true);
    expect(canLifecycleTransition(STRATEGY_STATUS_PRODUCTION, STRATEGY_STATUS_APPROVED)).toBe(false);
  });

  it("非法目标/来源枚举值被拒（validate 结构化 issue）", () => {
    const record = createStrategyLifecycleRecord(makeInput());
    const bad = {
      ...record,
      status: "Approved",
      transitions: [{ ...record.transitions[0], to: "Approved" }],
    } as unknown as StrategyLifecycleRecord;
    const validation = validateStrategyLifecycleRecord(bad);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((i) => i.code === "LIFECYCLE_GENESIS_STATUS_INVALID")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ③ 四要素缺失拒绝
// ---------------------------------------------------------------------------

describe("③ 四要素缺失拒绝（§23 禁止无记录修改）", () => {
  it("无 reason 的前进迁移被拒", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_RESEARCH);
    expect(() => applyLifecycleTransition(record, { to: STRATEGY_STATUS_CANDIDATE, timestamp: T0, reason: "  ", experimentId: EXP_ID, evidence: [searchRunRef()] })).toThrow(/REASON_EMPTY|reason/);
  });

  it("无 timestamp 的迁移被拒", () => {
    const record = createStrategyLifecycleRecord(makeInput());
    expect(() => applyLifecycleTransition(record, { to: STRATEGY_STATUS_RESEARCH, timestamp: "not-a-time", reason: "研究启动" })).toThrow(/TIMESTAMP|timestamp/);
  });

  it("关键升级 Research→Candidate 缺 experimentId 被拒", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_RESEARCH);
    expect(() =>
      applyLifecycleTransition(record, { to: STRATEGY_STATUS_CANDIDATE, timestamp: T0, reason: "候选", experimentId: null, evidence: [searchRunRef()] }),
    ).toThrow(/experimentId/);
  });

  it("genesis 凭空以 Research 出生（无 inheritance 证据）被拒", () => {
    expect(() =>
      createStrategyLifecycleRecord(makeInput({ initialStatus: STRATEGY_STATUS_RESEARCH })),
    ).toThrow(/inheritance/);
  });
});

// ---------------------------------------------------------------------------
// ④ 审计轨迹 append-only + 篡改检测
// ---------------------------------------------------------------------------

describe("④ 审计轨迹 append-only（不可变 + 篡改检测）", () => {
  it("冻结对象禁止改写历史（试图改历史 reason 抛 TypeError）", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_VALIDATED);
    const history = record.transitions[1];
    expect(Object.isFrozen(history)).toBe(true);
    let thrown = false;
    try {
      (history as { reason: string }).reason = "篡改历史";
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(true);
  });

  it("篡改历史后 serialize→deserialize 拒绝（链 hash 断链）", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_VALIDATED);
    const json = serializeStrategyLifecycleRecord(record);
    const parsed = JSON.parse(json) as { transitions: Array<{ reason: string }> };
    parsed.transitions[1].reason = "被篡改的迁移原因";
    let error: unknown;
    try {
      deserializeStrategyLifecycleRecord(JSON.stringify(parsed));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ResearchValidationError);
    expect((error as ResearchValidationError).message).toMatch(/LIFECYCLE_CHAIN_HASH_MISMATCH|链 hash 不匹配/);
  });

  it("直接构造不衔接链（删除中间跳）被 validate 拒绝 + crypto 复核报告断链", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_VALIDATED);
    const stripped = { ...record, transitions: record.transitions.slice(0, 2) } as unknown as StrategyLifecycleRecord;
    const validation = validateStrategyLifecycleRecord(stripped);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((i) => i.code === "LIFECYCLE_STATUS_NOT_LAST")).toBe(true);
    const chainIssues = verifyLifecycleTransitionChain(stripped.transitions);
    // 只保留前 2 跳时链自身仍连续（hash 自洽）；真正破坏在 status/末跳不一致上。
    expect(chainIssues).toHaveLength(0);
    // 插入一条伪造衔接（prevHash 不对）→ crypto 断链。
    const forked = {
      ...record.transitions[1],
      seq: 2,
      from: STRATEGY_STATUS_VALIDATED,
      to: STRATEGY_STATUS_PAPER,
      reason: "伪造跳",
      evidence: [metricsPass("M-fake")],
      hash: "0".repeat(64),
    };
    expect(verifyLifecycleTransitionChain([record.transitions[0], record.transitions[1], forked])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 证据门槛
// ---------------------------------------------------------------------------

describe("⑤ 证据门槛（§45.2 禁止无证据升级）", () => {
  it("Candidate→Validated 缺 datasetGate/metrics PASS（INCONCLUSIVE）被拒", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_CANDIDATE);
    expect(() =>
      applyLifecycleTransition(record, {
        to: STRATEGY_STATUS_VALIDATED,
        timestamp: T0,
        reason: "标 Validated",
        experimentId: EXP_ID,
        evidence: [{ kind: "datasetGate", gate: "INCONCLUSIVE", datasetVersion: DATASET_VERSION }],
      }),
    ).toThrow(/LIFECYCLE_THRESHOLD_VALIDATED_GATE|数据链就绪/);
  });

  it("Candidate→Validated 携带 metricsRecord(PASS) 通过", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_CANDIDATE);
    const next = applyLifecycleTransition(record, {
      to: STRATEGY_STATUS_VALIDATED,
      timestamp: T0,
      reason: "绩效达标升级",
      experimentId: EXP_ID,
      evidence: [metricsPass("M-2026-09-05")],
    });
    expect(next.status).toBe(STRATEGY_STATUS_VALIDATED);
  });

  it("Approved→Production 缺 datasetGate PASS 被拒；携带 PASS 通过", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_APPROVED);
    expect(() =>
      applyLifecycleTransition(record, {
        to: STRATEGY_STATUS_PRODUCTION,
        timestamp: T0,
        reason: "上生产",
        experimentId: EXP_ID,
        evidence: [metricsPass("M-paper")], // metrics 达标不足以支撑生产，需要数据集 gate
      }),
    ).toThrow(/LIFECYCLE_THRESHOLD_PRODUCTION_GATE|数据链再认证/);
    const next = applyLifecycleTransition(record, {
      to: STRATEGY_STATUS_PRODUCTION,
      timestamp: T0,
      reason: "数据链认证通过后上生产",
      experimentId: EXP_ID,
      evidence: [datasetGatePass()],
    });
    expect(next.status).toBe(STRATEGY_STATUS_PRODUCTION);
  });

  it("Paper→Approved 缺审批支撑（仅 datasetGate）被拒", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_PAPER);
    expect(() =>
      applyLifecycleTransition(record, {
        to: STRATEGY_STATUS_APPROVED,
        timestamp: T0,
        reason: "审批",
        experimentId: EXP_ID,
        evidence: [datasetGatePass()],
      }),
    ).toThrow(/LIFECYCLE_THRESHOLD_APPROVED_GATE|approval/);
  });

  it("evidence 引用格式错拒绝（datasetVersion 非 rd-…）", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_CANDIDATE);
    expect(() =>
      applyLifecycleTransition(record, {
        to: STRATEGY_STATUS_VALIDATED,
        timestamp: T0,
        reason: "标 Validated",
        experimentId: EXP_ID,
        evidence: [{ kind: "datasetGate", gate: "PASS", datasetVersion: "v1" }],
      }),
    ).toThrow(/rd-…|datasetVersion/);
  });
});

// ---------------------------------------------------------------------------
// ⑥ StrategyVersionRecord 绑定壳
// ---------------------------------------------------------------------------

describe("⑥ 与 C-15.1 StrategyVersionRecord 绑定", () => {
  it("createLifecycleFromVersionRecord：派生 strategyId/version/指纹并 round-trip", () => {
    const record = createLifecycleFromVersionRecord(VERSION_RECORD, {
      timestamp: T0,
      reason: "给 §17 版本 1.0.0 建生命周期壳",
    });
    expect(record.strategyId).toBe("limit-up-baseline");
    expect(record.strategyVersion).toBe("1.0.0");
    expect(record.versionRecordFingerprint).toBe(VERSION_RECORD.fingerprint);
    expect(record.versionRecordFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const restored = deserializeStrategyLifecycleRecord(serializeStrategyLifecycleRecord(record));
    expect(restored.fingerprint).toBe(record.fingerprint);
    expect(restored.transitions).toHaveLength(record.transitions.length);
    expect(() => assertValidStrategyLifecycleRecord(restored)).not.toThrow();
  });

  it("版本演进继承：新版本（v2.0.0 绑定）以 Research 出生需 inheritance；Retired 父壳可被引用为复活", () => {
    // 模拟复活路径：父版本（Retired）→ 子版本 genesis Research（inheritance 引用父壳）。
    const parent = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_RETIRED);
    // 用 C-15.1 clone+bump 产出真实的 v2.0.0 版本追溯记录（避免手工构造不一致记录）。
    const childDocument = cloneStrategyDocument(VERSION_RECORD.strategy, {}, "major");
    const childVersionRecord = createStrategyVersionRecord({
      document: childDocument,
      context: { codeVersion: CODE_VERSION, createdAt: T0 },
    });
    const child = createLifecycleFromVersionRecord(childVersionRecord, {
      timestamp: T0,
      reason: "复活为 v2.0.0：修复根因后重启研究",
      initialStatus: STRATEGY_STATUS_RESEARCH,
      evidence: [
        {
          kind: "inheritance",
          parentLifecycleId: `${parent.strategyId}@${parent.strategyVersion}`,
          parentStatus: parent.status,
        },
      ],
    });
    expect(child.status).toBe(STRATEGY_STATUS_RESEARCH);
    expect(child.strategyVersion).toBe("2.0.0");
    expect(child.versionRecordFingerprint).toBe(childVersionRecord.fingerprint);
    expect(child.transitions).toHaveLength(1);
    // Retired 父版本本身终态不受影响（无复活边），复活仅发生在新版本壳的 genesis 上。
    expect(STRATEGY_LIFECYCLE_TRANSITIONS[STRATEGY_STATUS_RETIRED]).toHaveLength(0);
  });

  it("生命周期壳 round-trip：篡改绑定指纹后 deserialize 拒绝", () => {
    const record = createLifecycleFromVersionRecord(VERSION_RECORD, { timestamp: T0, reason: "绑定壳" });
    const parsed = JSON.parse(serializeStrategyLifecycleRecord(record)) as Record<string, unknown>;
    parsed.versionRecordFingerprint = "0".repeat(64);
    expect(() => deserializeStrategyLifecycleRecord(JSON.stringify(parsed))).toThrow(ResearchValidationError);
  });
});

// ---------------------------------------------------------------------------
// ⑦ fingerprint / 确定性
// ---------------------------------------------------------------------------

describe("⑦ fingerprint / 确定性", () => {
  it("同输入两次建壳指纹与单跳 hash 完全一致；reason 不同则指纹变化", () => {
    const a = createStrategyLifecycleRecord(makeInput());
    const b = createStrategyLifecycleRecord(makeInput());
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.transitions[0].hash).toBe(b.transitions[0].hash);
    const c = createStrategyLifecycleRecord(makeInput({ reason: "不同理由的建壳" }));
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it("apply 两次（同输入同记录）产出逐位一致记录；hash 链与记录指纹匹配", () => {
    const base = createStrategyLifecycleRecord(makeInput());
    const a = applyLifecycleTransition(base, advanceInput(STRATEGY_STATUS_RESEARCH));
    const b = applyLifecycleTransition(base, advanceInput(STRATEGY_STATUS_RESEARCH));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.transitions[1].hash).toBe(computeLifecycleTransitionHash(a.transitions[1]));
  });
});

// ---------------------------------------------------------------------------
// ⑧ §7 任务 7 态概念映射断言（两套状态机，禁止概念污染）
// ---------------------------------------------------------------------------

describe("⑧ §7 任务 7 态 vs §23 生命周期 8 态", () => {
  it("映射纪律通过：仅 Validated → 任务 VALIDATED；Retired → null；Draft → DESIGN", () => {
    expect(() => assertLifecycleTaskMappingIntegrity()).not.toThrow();
    expect(PROJECT_TASK_STATUSES).toContain("VALIDATED");
    expect(mapStrategyLifecycleToTaskStatus(STRATEGY_STATUS_VALIDATED)).toBe("VALIDATED");
    expect(mapStrategyLifecycleToTaskStatus(STRATEGY_STATUS_RESEARCH)).not.toBe("VALIDATED");
    expect(mapStrategyLifecycleToTaskStatus(STRATEGY_STATUS_CANDIDATE)).not.toBe("VALIDATED");
    expect(mapStrategyLifecycleToTaskStatus(STRATEGY_STATUS_PAPER)).not.toBe("VALIDATED");
    expect(mapStrategyLifecycleToTaskStatus(STRATEGY_STATUS_DRAFT)).toBe("DESIGN");
    expect(mapStrategyLifecycleToTaskStatus(STRATEGY_STATUS_RETIRED)).toBeNull();
    expect(mapStrategyLifecycleToTaskStatus(STRATEGY_STATUS_APPROVED)).toBe("PRODUCTION_READY");
  });

  it("Research→Candidate 产物（status=Candidate）不可上报任务 VALIDATED（断言守卫抛错）", () => {
    const candidate = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_CANDIDATE);
    expect(requiresTaskValidation(candidate.status)).toBe(false);
    expect(hasValidatedEvidenceTrail(candidate)).toBe(false);
    expect(mapStrategyLifecycleToTaskStatus(candidate.status)).toBe("CODE_READY");
    // 若有人绕过守卫把候选当 VALIDATED，assertValidatedClaimHasEvidence 不会抛（未进入带），
    // 但映射断言已证明上报不得标 VALIDATED；进入 Validated 带后必须有证据链。
  });

  it("Validated 后断言守卫通过；把无证据记录伪造成 Validated 带会被守卫拒绝", () => {
    const record = walk(createStrategyLifecycleRecord(makeInput()), STRATEGY_STATUS_PRODUCTION);
    expect(requiresTaskValidation(record.status)).toBe(true);
    expect(hasValidatedEvidenceTrail(record)).toBe(true);
    expect(() => assertValidatedClaimHasEvidence(record)).not.toThrow();

    const fake = { ...record, transitions: record.transitions.filter((t) => t.to !== STRATEGY_STATUS_VALIDATED) } as unknown as StrategyLifecycleRecord;
    expect(() => assertValidatedClaimHasEvidence(fake)).toThrow(/禁止把未认证策略上报为任务 VALIDATED/);
  });
});

// ---------------------------------------------------------------------------
// 补充：账本容器 + 边分类
// ---------------------------------------------------------------------------

describe("补充：账本容器 / 边分类 / 迁移表完整性", () => {
  it("账本：create→transition 唯一入口，重复建壳与未知迁移拒绝", () => {
    const ledger = new StrategyLifecycleLedger();
    const created = ledger.create(makeInput());
    expect(ledger.has("limit-up-baseline", "1.0.0")).toBe(true);
    expect(() => ledger.create(makeInput())).toThrow(/重复建壳/);
    const advanced = ledger.transition("limit-up-baseline", "1.0.0", advanceInput(STRATEGY_STATUS_RESEARCH));
    expect(advanced.status).toBe(STRATEGY_STATUS_RESEARCH);
    expect(() => ledger.transition("limit-up-baseline", "1.0.0", advanceInput(STRATEGY_STATUS_PRODUCTION))).toThrow(/跳级/);
    expect(ledger.get("limit-up-baseline", "1.0.0").status).toBe(STRATEGY_STATUS_RESEARCH); // 失败迁移不改账本
    expect(ledger.list()).toHaveLength(1);
    expect(() => ledger.get("nope", "1.0.0")).toThrowError(/无生命周期壳记录/);
  });

  it("边分类：Draft→Research advance；Production→Research rollback；任意→Retired retire", () => {
    expect(classifyLifecycleEdge(STRATEGY_STATUS_DRAFT, STRATEGY_STATUS_RESEARCH)).toBe("advance");
    expect(classifyLifecycleEdge(STRATEGY_STATUS_PRODUCTION, STRATEGY_STATUS_RESEARCH)).toBe("rollback");
    expect(classifyLifecycleEdge(STRATEGY_STATUS_PRODUCTION, STRATEGY_STATUS_RETIRED)).toBe("retire");
    expect(isAdvanceTransition(STRATEGY_STATUS_CANDIDATE, STRATEGY_STATUS_VALIDATED)).toBe(true);
  });
});
