/**
 * RESEARCH-FINDING-001 — Hypothesis 领域规则（**不落任何统计实现**）。
 *
 * 职责边界：
 *   - 状态机（DRAFT → TESTABLE → TESTED → {SUPPORTED|REJECTED} → PROMOTED）；
 *   - **结构化校验**（任务书 §17：不允许只存 description 式自然语言）；
 *   - 进 Candidate 的**资格判定**（§18 / §26：必须经 User Review → Test → Supported）；
 *   - 条件的**前视护栏**（§21：Outcome 只能当目标变量 / 评价证据，**绝不能**进入 Signal 条件）。
 *
 * 🔴 本文件**不**实现统计检验；也**不**自动把假设推成策略（任务书 §26 / §35.6）。
 */

import type { ResearchConditionSet } from "./conditions";
import { assertConditionSet } from "./conditions";
import {
  RESEARCH_HYPOTHESIS_STATUSES,
  RESEARCH_EXPECTED_DIRECTIONS,
  type ResearchExpectedDirection,
  type ResearchHypothesis,
  type ResearchHypothesisStatus,
} from "./types";

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

/**
 * 允许的假设状态转移。
 *
 * 主轴 = **研究阶段**（不是「结论强度」）：
 *   DRAFT      草稿（可以没有结构化条件）；
 *   TESTABLE   已形式化（条件 / target / horizon 三件套齐备），**可以进 Run 验证**；
 *   TESTED     已跑过 Run（有真实 Result 支撑），等待判定；
 *   SUPPORTED  证据支持（可进 Candidate）；
 *   REJECTED   明确否定（终态）；
 *   PROMOTED   已转成 Strategy Candidate（**唯一**由 `Hypothesis → Candidate` 入口到达）。
 *
 * `PROMOTED` 与 `REJECTED` 均为**终态**：已转正的假设不回溯改状态（要改就新建假设），
 * 避免「已转正的假设后来被标 REJECTED」这种自相矛盾的历史。
 */
export const HYPOTHESIS_STATUS_TRANSITIONS: Record<ResearchHypothesisStatus, readonly ResearchHypothesisStatus[]> = {
  DRAFT: ["TESTABLE", "REJECTED"],
  TESTABLE: ["DRAFT", "TESTED", "REJECTED"],
  TESTED: ["TESTABLE", "SUPPORTED", "REJECTED"],
  SUPPORTED: ["PROMOTED", "REJECTED"],
  REJECTED: [],
  PROMOTED: [],
};

export class ResearchHypothesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchHypothesisError";
  }
}

export function isResearchHypothesisStatus(value: string): value is ResearchHypothesisStatus {
  return (RESEARCH_HYPOTHESIS_STATUSES as readonly string[]).includes(value);
}

export function isHypothesisTransitionAllowed(
  from: ResearchHypothesisStatus,
  to: ResearchHypothesisStatus,
): boolean {
  if (from === to) return true; // 幂等 no-op
  return HYPOTHESIS_STATUS_TRANSITIONS[from].includes(to);
}

export function assertHypothesisTransition(
  from: ResearchHypothesisStatus,
  to: ResearchHypothesisStatus,
): void {
  if (!isResearchHypothesisStatus(from)) {
    throw new ResearchHypothesisError(`非法假设源状态：${String(from)}`);
  }
  if (!isResearchHypothesisStatus(to)) {
    throw new ResearchHypothesisError(`非法假设目标状态：${String(to)}`);
  }
  if (!isHypothesisTransitionAllowed(from, to)) {
    throw new ResearchHypothesisError(
      `非法的假设状态转移：${from} → ${to}（允许：${HYPOTHESIS_STATUS_TRANSITIONS[from].join(" / ") || "无（终态）"}）`,
    );
  }
}

// ---------------------------------------------------------------------------
// 结构化校验（任务书 §17）
// ---------------------------------------------------------------------------

export function isExpectedDirection(value: string): value is ResearchExpectedDirection {
  return (RESEARCH_EXPECTED_DIRECTIONS as readonly string[]).includes(value);
}

/** 结构化三件套（条件 / 目标 / 视界）。缺一即「未形式化」。 */
export interface HypothesisGaps {
  missingConditions: boolean;
  missingTarget: boolean;
  missingHorizon: boolean;
  missingExpectedDirection: boolean;
  /** 是否已具备进入 Run 验证的最低形式化程度。 */
  testable: boolean;
}

/** 如实列出还差什么（供 UI 提示；**不**替用户猜）。 */
export function describeHypothesisGaps(hypothesis: {
  conditions?: ResearchConditionSet | null;
  target?: string | null;
  horizon?: string | null;
  expectedDirection?: string | null;
}): HypothesisGaps {
  const missingConditions = !hasUsableConditions(hypothesis.conditions);
  const missingTarget = !isNonEmpty(hypothesis.target);
  const missingHorizon = !isNonEmpty(hypothesis.horizon);
  const missingExpectedDirection = !isNonEmpty(hypothesis.expectedDirection);
  return {
    missingConditions,
    missingTarget,
    missingHorizon,
    missingExpectedDirection,
    // 预期方向缺失**不阻塞**验证（它是先验声明，不是执行必需）。
    testable: !missingConditions && !missingTarget && !missingHorizon,
  };
}

/** 条件集合「可用」= 非空且至少有一条条件。 */
export function hasUsableConditions(conditions?: ResearchConditionSet | null): boolean {
  if (!conditions || !Array.isArray(conditions.groups)) return false;
  return conditions.groups.some((g) => Array.isArray(g.conditions) && g.conditions.length > 0);
}

/**
 * 校验假设的**结构合法性**（创建 / 更新时调用）。
 *
 * 只做「结构」判定：`name` / `statement` 必填；`conditions` 若给出则必须**结构合法**
 * （组号连续、sortOrder 唯一、值元数匹配）。
 * **不**要求三件套齐备 —— 那是 `TESTABLE` 的门槛，不是创建的门槛。
 */
export function assertHypothesisStructure(hypothesis: {
  name: string;
  statement: string;
  conditions?: ResearchConditionSet | null;
  expectedDirection?: string | null;
}): void {
  if (typeof hypothesis.name !== "string" || hypothesis.name.trim().length === 0) {
    throw new ResearchHypothesisError("假设 name 不能为空");
  }
  if (typeof hypothesis.statement !== "string" || hypothesis.statement.trim().length === 0) {
    throw new ResearchHypothesisError("假设 statement 不能为空");
  }
  if (hypothesis.expectedDirection !== null && hypothesis.expectedDirection !== undefined) {
    if (!isExpectedDirection(hypothesis.expectedDirection)) {
      throw new ResearchHypothesisError(
        `非法 expectedDirection：${String(hypothesis.expectedDirection)}`
        + `（允许：${RESEARCH_EXPECTED_DIRECTIONS.join(" / ")}）`,
      );
    }
  }
  if (hypothesis.conditions !== null && hypothesis.conditions !== undefined) {
    if (typeof hypothesis.conditions !== "object" || !Array.isArray(hypothesis.conditions.groups)) {
      throw new ResearchHypothesisError("conditions 必须是 ResearchConditionSet（{ groups: [...] }）");
    }
    assertConditionSet(hypothesis.conditions);
  }
}

/**
 * 流转到 `TESTABLE` 时的**额外门槛**：三件套必须齐备。
 * 理由：`TESTABLE` 的定义就是「可以进 Run 验证」，没有条件/目标/视界就跑不了。
 */
export function assertHypothesisTestable(hypothesis: {
  conditions?: ResearchConditionSet | null;
  target?: string | null;
  horizon?: string | null;
}): void {
  const gaps = describeHypothesisGaps(hypothesis);
  if (!gaps.testable) {
    const missing: string[] = [];
    if (gaps.missingConditions) missing.push("conditions（结构化条件）");
    if (gaps.missingTarget) missing.push("target（目标变量）");
    if (gaps.missingHorizon) missing.push("horizon（验证视界）");
    throw new ResearchHypothesisError(
      `假设尚未形式化，不能置为 TESTABLE —— 缺少：${missing.join("、")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 进 Candidate 的资格（§18 / §26）
// ---------------------------------------------------------------------------

/**
 * 校验假设是否**有资格**转成 Strategy Candidate。
 *
 * 🔴 任务书 §26「不要自动生成 Strategy」：只有 `SUPPORTED`（= 用户验证过）才可转。
 *    `PROMOTED` 亦放行（幂等：重复 promote 由 provenance 闸门兜底，此处不重复拒绝）。
 */
export function assertHypothesisReadyForCandidate(hypothesis: ResearchHypothesis): void {
  const status = hypothesis.status;
  if (status !== "SUPPORTED" && status !== "PROMOTED") {
    throw new ResearchHypothesisError(
      `假设当前状态为 ${status}，不具备转 Candidate 的资格（须为 SUPPORTED）——`
      + "正确流程：Test Hypothesis → Supported → Promote Candidate（任务书 §26）",
    );
  }
  assertHypothesisTestable(hypothesis);
}

// ---------------------------------------------------------------------------
// 前视护栏（§21）
// ---------------------------------------------------------------------------

/**
 * 校验假设条件**不含 Outcome 变量**。
 *
 * 与既有护栏的分工：
 *   - 本函数是 Hypothesis 域的**早失败**（在条件被写进假设之前就拒绝，
 *     避免用户把 `future_return_5d` 写成 entry 条件）；
 *   - 真正的执行期护栏仍是 `researchEngine/variables.ts#assertObservationConditionsPitSafe`
 *     + `research/framework/leakage.ts#LeakageGuard`（条件 → Analysis / Strategy 时复用，**不另起一套**）。
 *
 * `isOutcomeVariable` 由调用方注入（依赖变量目录，属 Engine 层知识），
 * 因此本文件不反向依赖 `researchEngine`。
 */
export function assertConditionsSignalSafe(
  conditions: ResearchConditionSet | null | undefined,
  isOutcomeVariable: (fieldName: string) => boolean,
): void {
  if (!hasUsableConditions(conditions)) return;
  const offending: string[] = [];
  for (const g of conditions!.groups) {
    for (const c of g.conditions) {
      if (isOutcomeVariable(c.fieldName)) offending.push(c.fieldName);
    }
  }
  if (offending.length > 0) {
    throw new ResearchHypothesisError(
      "假设条件引用了 Outcome（未来结果）变量，构成前视，拒绝写入："
      + `${[...new Set(offending)].join("、")} —— `
      + "Outcome 只能作为研究的目标变量 / 评价证据，不能进入 Signal 条件（任务书 §21）",
    );
  }
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/** 渲染结构化假设（供前端 / 报告复用；**不是**求值器）。 */
export function renderHypothesisBrief(hypothesis: {
  name: string;
  statement: string;
  conditions?: ResearchConditionSet | null;
  target?: string | null;
  horizon?: string | null;
  expectedDirection?: string | null;
}): string {
  const lines: string[] = [hypothesis.name, hypothesis.statement];
  if (hasUsableConditions(hypothesis.conditions)) {
    for (const g of hypothesis.conditions!.groups) {
      for (const c of g.conditions) {
        const value = Array.isArray(c.value) ? `[${c.value.join(", ")}]` : String(c.value);
        lines.push(`  · ${c.fieldName} ${c.operator} ${value}`);
      }
    }
  }
  if (isNonEmpty(hypothesis.target)) lines.push(`  目标：${hypothesis.target}`);
  if (isNonEmpty(hypothesis.horizon)) lines.push(`  视界：${hypothesis.horizon}`);
  if (isNonEmpty(hypothesis.expectedDirection)) lines.push(`  预期方向：${hypothesis.expectedDirection}`);
  return lines.join("\n");
}

function isNonEmpty(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}
