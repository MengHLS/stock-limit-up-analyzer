/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management：证据门槛与四要素规则（纯函数）。
 *
 * ROADMAP §23：每次状态变化必须有 timestamp / reason / experiment / evidence 四要素；
 * 「禁止无记录修改」。§45.2：研究结论（Research→Candidate）到生产前必须 Validated
 * （数据链就绪认证），禁止无证据升级。
 *
 * 本模块是 evidence 引用格式 + 各迁移档位最低要求的**唯一权威来源**。铁律与本任务范围：
 *   - 只校验「格式 + 必填性 + 门槛形状」，不连 DB、不跑真实 gate、不执行真实验证——
 *     引用由调用方（未来 runner）在真实 gate/评估通过后注入，本模块只保证
 *     「缺引用 / 引用格式错 / 档位要求未满足」在状态变化时 fail fast；
 *   - 失败信息带中文、可定位（path 前缀，由 validate/map 层 rebase 到 transitions[i]）。
 *
 * 档位规则（设计决策，逐个文档化）：
 *   1. 一切迁移（含 genesis）都强制 reason + timestamp（§23「无记录修改」底线）；
 *   2. genesis Draft：实验 / evidence 可空（记录诞生，尚无实验可引）；
 *      genesis Research：必须携带 inheritance evidence（版本演进继承）；Draft 父壳不得
 *      被继承为 Research——未进入研究的设计变更应留在 Draft 走完设计；
 *   3. Draft→Research（研究启动）：实验 / evidence 可空（研究活动自此开始，之前无实验）；
 *   4. 前进 Research→Candidate：必填 experimentId + ≥1 evidence（研究结论产生候选）；
 *   5. 前进 Candidate→Validated（→Validated 证据门槛）：必填 experimentId，且 evidence
 *      必须含 datasetGate PASS（数据链就绪认证，§45.2）或 metricsRecord PASS（绩效达标）；
 *   6. 前进 Validated→Paper / Paper→Approved：必填 experimentId + ≥1 evidence；
 *      Paper→Approved 额外要求 evidence 含 approval(approved) 或 metricsRecord(PASS)
 *      （审批文档或纸面绩效二者其一支撑进入 Approved）；
 *   7. 前进 Approved→Production（→Production 证据门槛）：必填 experimentId，且 evidence
 *      必须含 datasetGate PASS——生产前数据链再认证；「APPROVED 先行」已由迁移表保证
 *      （Production 唯一前置 = Approved，见 transition.ts）；
 *   8. 回退 / 退役：仅 reason + timestamp（治理决策，非实验结论；append-only 链仍然强制）。
 */

import type { ResearchValidationIssue } from "../experimentValidation";
import { isValidDatasetVersionFormat } from "../experimentLineage/validate";
import {
  STRATEGY_LIFECYCLE_GENESIS_STATUSES,
  STRATEGY_STATUS_DRAFT,
  STRATEGY_STATUS_RESEARCH,
  STRATEGY_STATUS_VALIDATED,
  STRATEGY_STATUS_APPROVED,
  STRATEGY_STATUS_PRODUCTION,
  isStrategyLifecycleStatus,
  type LifecycleEvidenceRef,
  type StrategyLifecycleGenesisStatus,
  type StrategyLifecycleStatus,
} from "./types";
import { classifyLifecycleEdge, describeTransitionViolation, type LifecycleEdgeKind } from "./transition";

// ---------------------------------------------------------------------------
// Evidence 引用格式校验
// ---------------------------------------------------------------------------

const LIFECYCLE_DATASET_GATE_VALUES = ["FAIL", "PASS", "INCONCLUSIVE"] as const;
const LIFECYCLE_METRICS_RESULT_VALUES = ["PASS", "FAIL"] as const;
const LIFECYCLE_APPROVAL_DECISION_VALUES = ["approved", "rejected"] as const;

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

/** 非空且不含空白/控制字符的引用 id 检查（runId/metricsId/documentId 等）。 */
function checkRefId(value: unknown, path: string, code: string, label: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "" || /\s/.test(value)) {
    issues.push(issue(code, path, `${label} 必须是非空字符串且不含空白（引用 id 形态），实际：${String(value)}`));
  }
}

function checkOptionalNote(note: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (note === undefined || note === null) return;
  if (typeof note !== "string" || note.trim() === "") {
    issues.push(issue("LIFECYCLE_EVIDENCE_NOTE_INVALID", path, "note 若提供必须是非空字符串"));
  }
}

/** 校验单条 evidence 引用的形态与枚举值域（不校验「门槛」——门槛见 collectThresholdIssues）。 */
export function checkEvidenceRefIssues(ref: unknown, path: string): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
    issues.push(issue("LIFECYCLE_EVIDENCE_REF_INVALID", path, "evidence 引用必须是对象"));
    return issues;
  }
  const r = ref as Record<string, unknown>;
  switch (r.kind) {
    case "datasetGate": {
      const gate = r.gate;
      if (typeof gate !== "string" || !(LIFECYCLE_DATASET_GATE_VALUES as readonly string[]).includes(gate)) {
        issues.push(issue(
          "LIFECYCLE_EVIDENCE_GATE_INVALID",
          `${path}.gate`,
          `datasetGate.gate 必须是 ${LIFECYCLE_DATASET_GATE_VALUES.join(" | ")}（与 researchDataset ResearchDatasetGate 对齐），实际：${String(gate)}`,
        ));
      }
      const datasetVersion = r.datasetVersion;
      if (typeof datasetVersion !== "string" || !isValidDatasetVersionFormat(datasetVersion)) {
        issues.push(issue(
          "LIFECYCLE_EVIDENCE_DATASET_VERSION_INVALID",
          `${path}.datasetVersion`,
          `datasetGate.datasetVersion 必须是 rd-… 内容寻址数据集版本（如 rd-1.0.0-1-cffc2a0e66efbf0b），实际：${String(datasetVersion)}`,
        ));
      }
      checkOptionalNote(r.note, `${path}.note`, issues);
      return issues;
    }
    case "metricsRecord": {
      checkRefId(r.metricsId, `${path}.metricsId`, "LIFECYCLE_EVIDENCE_METRICS_ID_INVALID", "metricsRecord.metricsId", issues);
      const result = r.result;
      if (typeof result !== "string" || !(LIFECYCLE_METRICS_RESULT_VALUES as readonly string[]).includes(result)) {
        issues.push(issue(
          "LIFECYCLE_EVIDENCE_METRICS_RESULT_INVALID",
          `${path}.result`,
          `metricsRecord.result 必须是 ${LIFECYCLE_METRICS_RESULT_VALUES.join(" | ")}，实际：${String(result)}`,
        ));
      }
      checkOptionalNote(r.note, `${path}.note`, issues);
      return issues;
    }
    case "searchRun":
      checkRefId(r.runId, `${path}.runId`, "LIFECYCLE_EVIDENCE_SEARCH_RUN_ID_INVALID", "searchRun.runId", issues);
      return issues;
    case "paperRun":
      checkRefId(r.runId, `${path}.runId`, "LIFECYCLE_EVIDENCE_PAPER_RUN_ID_INVALID", "paperRun.runId", issues);
      return issues;
    case "approval": {
      checkRefId(r.documentId, `${path}.documentId`, "LIFECYCLE_EVIDENCE_APPROVAL_DOC_INVALID", "approval.documentId", issues);
      const decision = r.decision;
      if (typeof decision !== "string" || !(LIFECYCLE_APPROVAL_DECISION_VALUES as readonly string[]).includes(decision)) {
        issues.push(issue(
          "LIFECYCLE_EVIDENCE_APPROVAL_DECISION_INVALID",
          `${path}.decision`,
          `approval.decision 必须是 ${LIFECYCLE_APPROVAL_DECISION_VALUES.join(" | ")}，实际：${String(decision)}`,
        ));
      }
      return issues;
    }
    case "inheritance": {
      checkRefId(
        r.parentLifecycleId,
        `${path}.parentLifecycleId`,
        "LIFECYCLE_EVIDENCE_INHERITANCE_ID_INVALID",
        "inheritance.parentLifecycleId",
        issues,
      );
      const parentStatus = r.parentStatus;
      if (typeof parentStatus !== "string" || !isStrategyLifecycleStatus(parentStatus)) {
        issues.push(issue(
          "LIFECYCLE_EVIDENCE_INHERITANCE_STATUS_INVALID",
          `${path}.parentStatus`,
          `inheritance.parentStatus 必须是合法生命周期状态，实际：${String(parentStatus)}`,
        ));
      } else if (parentStatus === STRATEGY_STATUS_DRAFT) {
        issues.push(issue(
          "LIFECYCLE_EVIDENCE_INHERITANCE_FROM_DRAFT",
          `${path}.parentStatus`,
          "inheritance.parentStatus 不得为 Draft：Draft 阶段的设计变更应留在 Draft 走完，禁止借版本演进跳过设计直接进入 Research",
        ));
      }
      return issues;
    }
    default:
      issues.push(issue(
        "LIFECYCLE_EVIDENCE_KIND_INVALID",
        `${path}.kind`,
        `evidence 引用 kind 必须是 datasetGate | metricsRecord | searchRun | paperRun | approval | inheritance，实际：${String(r.kind)}`,
      ));
      return issues;
  }
}

// ---------------------------------------------------------------------------
// 基础形态检查（四要素）
// ---------------------------------------------------------------------------

const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** timestamp：§23 四要素之一；必须为注入式 ISO-8601 UTC。 */
export function checkTimestampIssues(timestamp: unknown, path: string): ResearchValidationIssue[] {
  if (typeof timestamp !== "string" || !ISO_TIME_RE.test(timestamp)) {
    return [issue(
      "LIFECYCLE_TIMESTAMP_INVALID",
      path,
      `timestamp 必须是 ISO-8601 UTC 字符串（YYYY-MM-DDTHH:mm:ss[.sss]Z），实际：${String(timestamp)}（§23 四要素；禁止无时间记录的迁移）`,
    )];
  }
  return [];
}

/** reason：§23 四要素之一；必填非空。 */
export function checkReasonIssues(reason: unknown, path: string): ResearchValidationIssue[] {
  if (typeof reason !== "string" || reason.trim() === "") {
    return [issue(
      "LIFECYCLE_REASON_EMPTY",
      path,
      "reason 必须是非空字符串（§23 四要素；禁止无理由的静默状态变化）",
    )];
  }
  return [];
}

/** experimentId：提供时必须是非空无空白引用 id（真实存在性由 future runner 接线后验证）。 */
export function checkExperimentIdIssues(experimentId: unknown, path: string): ResearchValidationIssue[] {
  if (experimentId === undefined || experimentId === null) return [];
  if (typeof experimentId !== "string" || experimentId.trim() === "" || /\s/.test(experimentId)) {
    return [issue(
      "LIFECYCLE_EXPERIMENT_ID_INVALID",
      path,
      `experimentId 若提供必须是非空且不含空白的引用 id（真实存在性由 future runner 接线后验证），实际：${String(experimentId)}`,
    )];
  }
  return [];
}

/** actor：注入式身份；提供时必须是非空字符串（null/undefined 合法 = 匿名操作）。 */
export function checkActorIssues(actor: unknown, path: string): ResearchValidationIssue[] {
  if (actor === undefined || actor === null) return [];
  if (typeof actor !== "string" || actor.trim() === "") {
    return [issue("LIFECYCLE_ACTOR_INVALID", path, "actor 若提供必须是非空字符串（注入式身份；缺省 null = 匿名）")];
  }
  return [];
}

/** evidence 数组：字段必须是数组（可空合法）；逐条引用格式强校验。 */
export function checkEvidenceArrayIssues(evidence: unknown, path: string): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  if (evidence === undefined || evidence === null || !Array.isArray(evidence)) {
    issues.push(issue("LIFECYCLE_EVIDENCE_NOT_ARRAY", path, "evidence 必须是数组（可空数组合法，缺字段或非数组非法）"));
    return issues;
  }
  evidence.forEach((ref, index) => issues.push(...checkEvidenceRefIssues(ref, `${path}[${index}]`)));
  return issues;
}

// ---------------------------------------------------------------------------
// 档位阈值
// ---------------------------------------------------------------------------

function hasDatasetGatePass(evidence: readonly LifecycleEvidenceRef[]): boolean {
  return evidence.some((ref) => ref.kind === "datasetGate" && ref.gate === "PASS");
}

function hasMetricsRecordPass(evidence: readonly LifecycleEvidenceRef[]): boolean {
  return evidence.some((ref) => ref.kind === "metricsRecord" && ref.result === "PASS");
}

function hasApprovalApproved(evidence: readonly LifecycleEvidenceRef[]): boolean {
  return evidence.some((ref) => ref.kind === "approval" && ref.decision === "approved");
}

function hasInheritanceRef(evidence: readonly LifecycleEvidenceRef[]): boolean {
  return evidence.some((ref) => ref.kind === "inheritance");
}

/** 按迁移边档位收集阈值 issue（evidence 门槛；不含格式层——格式已由 checkEvidenceArrayIssues 把关）。 */
function collectEdgeThresholdIssues(
  from: StrategyLifecycleStatus,
  to: StrategyLifecycleStatus,
  kind: LifecycleEdgeKind,
  experimentId: string | null,
  evidence: readonly LifecycleEvidenceRef[],
  path: string,
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];

  if (kind === "rollback" || kind === "retire") {
    // 档位 8：回退 / 退役只需 reason + timestamp（治理决策非实验结论）。
    return issues;
  }

  // kind === "advance"（前进档位；Draft→Research 与更靠后的前进细分）。
  const isResearchStart = from === STRATEGY_STATUS_DRAFT && to === STRATEGY_STATUS_RESEARCH;
  if (isResearchStart) {
    // 档位 3：Draft→Research 研究启动，之前尚无实验可引。
    return issues;
  }

  // 其余前进（Research→Candidate 及以后）：必须引用实验（§23 experiment 四要素）。
  if (experimentId === null) {
    issues.push(issue(
      "LIFECYCLE_THRESHOLD_EXPERIMENT_REQUIRED",
      path,
      `${from} → ${to} 属证据升级迁移，必须携带 experimentId（引用产生该次结论的实验；§23 experiment 四要素）`,
    ));
  }

  if (evidence.length === 0) {
    issues.push(issue(
      "LIFECYCLE_THRESHOLD_EVIDENCE_REQUIRED",
      path,
      `${from} → ${to} 属证据升级迁移，evidence 必须至少 1 条引用（§23 evidence 四要素；禁止无证据升级）`,
    ));
  }

  if (to === STRATEGY_STATUS_VALIDATED) {
    // 档位 5：→Validated 需数据链就绪认证或绩效达标。
    if (!hasDatasetGatePass(evidence) && !hasMetricsRecordPass(evidence)) {
      issues.push(issue(
        "LIFECYCLE_THRESHOLD_VALIDATED_GATE",
        path,
        "Candidate → Validated 必须携带数据链就绪证据：evidence 需含 datasetGate(gate=PASS, datasetVersion=rd-…) 或 metricsRecord(result=PASS)（§45.2 数据链就绪认证；禁止无证据标 Validated）",
      ));
    }
  }

  if (to === STRATEGY_STATUS_APPROVED) {
    // 档位 6：Paper→Approved 需审批文档或纸面绩效达标。
    if (!hasApprovalApproved(evidence) && !hasMetricsRecordPass(evidence)) {
      issues.push(issue(
        "LIFECYCLE_THRESHOLD_APPROVED_GATE",
        path,
        "Paper → Approved 必须携带审批支撑：evidence 需含 approval(decision=approved)（审批文档）或 metricsRecord(result=PASS)（纸面绩效达标），实际缺省（禁止无审批依据进入 Approved）",
      ));
    }
  }

  if (to === STRATEGY_STATUS_PRODUCTION) {
    // 档位 7：→Production 需数据链再认证（APPROVED 先行由迁移表保证：Production 唯一前置 = Approved）。
    if (!hasDatasetGatePass(evidence)) {
      issues.push(issue(
        "LIFECYCLE_THRESHOLD_PRODUCTION_GATE",
        path,
        "Approved → Production 必须携带数据链再认证证据：evidence 需含 datasetGate(gate=PASS, datasetVersion=rd-…)（§45.2 生产前数据链就绪认证；禁止无证据上生产）",
      ));
    }
  }

  return issues;
}

/** genesis 档位阈值（初始状态 Draft / Research 二选一，见 types.ts）。 */
function collectGenesisThresholdIssues(
  to: StrategyLifecycleGenesisStatus,
  experimentId: string | null,
  evidence: readonly LifecycleEvidenceRef[],
  path: string,
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  if (to === STRATEGY_STATUS_DRAFT) {
    return issues; // 档位 2a：genesis Draft 实验/evidence 可空。
  }
  // 档位 2b：genesis Research = 版本演进继承，必须携带 inheritance。
  if (!hasInheritanceRef(evidence)) {
    issues.push(issue(
      "LIFECYCLE_THRESHOLD_GENESIS_RESEARCH_INHERITANCE",
      path,
      "genesis 初始状态 Research 必须携带 inheritance evidence（引用父生命周期壳；新版本经 C-15.1 bump 演进而来；禁止凭空以 Research 出生绕过 Draft→Research 记录）",
    ));
  }
  if (experimentId !== null) {
    issues.push(issue(
      "LIFECYCLE_THRESHOLD_GENESIS_EXPERIMENT_UNEXPECTED",
      path,
      "genesis 不应携带 experimentId（出生非实验结论；如需引用父版本实验请放入 evidence 的 inheritance/metricsRecord 引用）",
    ));
  }
  return issues;
}

/**
 * 完整迁移四要素 + 档位门槛检查（一条记录的全部规则入口）。
 *
 * @param from null = genesis（记录诞生）。
 * @param actor 注入式身份；本层仅形态校验。
 * @param path 校验路径前缀（validate/map 调用时给 transitions[i] / genesis）。
 */
export function collectTransitionRequirementIssues(
  from: StrategyLifecycleStatus | null,
  to: StrategyLifecycleStatus,
  timestamp: unknown,
  reason: unknown,
  experimentId: unknown,
  evidence: unknown,
  actor: unknown,
  path: string,
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];

  // -- 迁移边合法性（genesis 不适用；非法边先响亮指出根因，不再堆叠门槛噪音） --
  if (from !== null) {
    const violation = describeTransitionViolation(from, to);
    if (violation !== null) {
      issues.push(issue("LIFECYCLE_MIGRATION_FORBIDDEN", path, violation));
      return issues;
    }
  } else if (!(STRATEGY_LIFECYCLE_GENESIS_STATUSES as readonly string[]).includes(to)) {
    issues.push(issue(
      "LIFECYCLE_GENESIS_STATUS_INVALID",
      path,
      `genesis 初始状态只能是 ${STRATEGY_LIFECYCLE_GENESIS_STATUSES.join(" | ")}（生命周期壳从出生即需走完整证据链；Draft 默认 / Research 需 inheritance 证据），实际：${String(to)}`,
    ));
    return issues;
  }

  // -- §23 底线：timestamp + reason --（档位 1）
  issues.push(...checkTimestampIssues(timestamp, `${path}.timestamp`));
  issues.push(...checkReasonIssues(reason, `${path}.reason`));

  // -- 引用形态：experimentId / actor / evidence 数组逐条 --（格式错一律拒绝）
  issues.push(...checkExperimentIdIssues(experimentId, `${path}.experimentId`));
  issues.push(...checkActorIssues(actor, `${path}.actor`));
  issues.push(...checkEvidenceArrayIssues(evidence, `${path}.evidence`));

  const experimentRef: string | null =
    experimentId !== undefined && experimentId !== null ? String(experimentId) : null;
  const evidenceList: readonly LifecycleEvidenceRef[] =
    evidence !== undefined && evidence !== null && Array.isArray(evidence)
      ? (evidence as LifecycleEvidenceRef[])
      : [];

  // -- 档位阈值 --
  const thresholdIssues =
    from === null
      ? collectGenesisThresholdIssues(to as StrategyLifecycleGenesisStatus, experimentRef, evidenceList, path)
      : collectEdgeThresholdIssues(
          from,
          to,
          classifyLifecycleEdge(from, to),
          experimentRef,
          evidenceList,
          path,
        );
  issues.push(...thresholdIssues);

  return issues;
}
