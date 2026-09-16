/**
 * RESEARCH-FINDING-001 —— Conclusion 领域规则（**§15 升级**）。
 *
 * 边界：与 `findings.ts` / `hypotheses.ts` 同一纪律 —— 只放**域规则**
 * （状态机 / 资格闸门 / 派生映射），不含统计、不读 DB、不碰 Dataset。
 *
 * 为什么需要本文件（审计报告 §5.4 / §5.5 的两处缺口）：
 *   ① `research_conclusion.status` 原本**没有任何写路径**（恒为 DRAFT），于是「结论引用 Finding」
 *      这件事即使落了库也永远停在草稿；升级 Conclusion 必须**同时**给出状态转移规则，
 *      否则 `CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES`（DRAFT / FINAL）里的 `FINAL` 永远到不了；
 *   ② 「结论 → 假设状态」原本**无联动**，使任务书 §26 的
 *      `Hypothesis → Tested → Supported → Promote` 链条缺一环。本文件给出**确定性映射**，
 *      由 Engine 在 Run 收口时按规则回写（写入前置条件见 `assertHypothesisWriteback`）。
 */

import {
  type ResearchConclusion,
  type ResearchConclusionStatus,
  type ResearchConclusionType,
  type ResearchHypothesisStatus,
  RESEARCH_CONCLUSION_STATUSES,
} from "./types";
import { assertHypothesisTransition } from "./hypotheses";

export class ResearchConclusionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchConclusionError";
  }
}

/**
 * 允许的结论状态转移。
 *
 * 设计取舍：
 *   - `DRAFT ↔ FINAL` **双向允许** —— 两者都是「可编辑的结论」，区别只是是否已认作定稿；
 *     禁止回退会让「手滑定稿」无法挽回，而真正的不可逆语义由 `SUPERSEDED` 承担；
 *   - `SUPERSEDED` 是**终态**（已被取代的结论不应复活 —— 复活会让「哪条结论算数」变得不可判定）。
 */
export const CONCLUSION_STATUS_TRANSITIONS: Record<
  ResearchConclusionStatus,
  readonly ResearchConclusionStatus[]
> = {
  DRAFT: ["FINAL", "SUPERSEDED"],
  FINAL: ["DRAFT", "SUPERSEDED"],
  SUPERSEDED: [],
};

export function isConclusionTransitionAllowed(
  from: ResearchConclusionStatus,
  to: ResearchConclusionStatus,
): boolean {
  if (from === to) return true; // 幂等 no-op
  return CONCLUSION_STATUS_TRANSITIONS[from].includes(to);
}

export function assertConclusionTransition(
  from: ResearchConclusionStatus,
  to: ResearchConclusionStatus,
): void {
  if (!(RESEARCH_CONCLUSION_STATUSES as readonly string[]).includes(from)) {
    throw new ResearchConclusionError(`非法结论源状态：${String(from)}`);
  }
  if (!(RESEARCH_CONCLUSION_STATUSES as readonly string[]).includes(to)) {
    throw new ResearchConclusionError(`非法结论目标状态：${String(to)}`);
  }
  if (!isConclusionTransitionAllowed(from, to)) {
    throw new ResearchConclusionError(
      `非法的结论状态转移：${from} → ${to}（允许：${CONCLUSION_STATUS_TRANSITIONS[from].join(" / ") || "无（终态）"}）`,
    );
  }
}

/**
 * §15 —— 「定稿（FINAL）」的资格。
 *
 * 🔴 结论不允许凭空产生：任务书 §15 要求 `Conclusion 必须能够引用相关 Finding`。
 * 因此定稿必须有**至少一条**可回溯的 Finding；`findingIds` 为空只允许停留在 `DRAFT`。
 *
 * ⚠️ 这**不**追溯既有 12 条 DRAFT 结论（它们的 `findingIds` 为空是历史事实，读路径不受影响）。
 */
export function assertConclusionFinalizable(
  conclusion: Pick<ResearchConclusion, "findingIds"> & { status?: ResearchConclusionStatus },
): void {
  const ids = conclusion.findingIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ResearchConclusionError(
      "结论定稿（FINAL）要求至少引用 1 条 Finding：无证据支撑的结论只能停留在 DRAFT"
      + "（任务书 §15「Conclusion 不允许凭空产生」）。请先运行 Finding 检测并把结论绑定到 Finding。",
    );
  }
}

/**
 * §26 —— 「结论类型 → 假设应被回写的状态」的**确定性映射**。
 *
 *   - `SUPPORTED`            ⇒ 假设 `SUPPORTED`（预设规则下证据支持）
 *   - `REJECTED`             ⇒ 假设 `REJECTED`（未观察到达到最小实际效应的差异）
 *   - `PARTIALLY_SUPPORTED`  ⇒ 假设 `TESTED`（**已测毕但无定论** —— 不得升格为 SUPPORTED）
 *   - `INCONCLUSIVE`         ⇒ 假设 `TESTED`（样本不足 / 方向不稳定同样只是「测过」）
 *
 * 🔴 绝不把 `PARTIALLY_SUPPORTED` / `INCONCLUSIVE` 映射成 `SUPPORTED`：
 *    那正是任务书 §13/§26 反复禁止的「把没验证的事说成已验证」。
 */
export function deriveHypothesisTargetStatus(
  conclusionType: ResearchConclusionType,
): ResearchHypothesisStatus | null {
  switch (conclusionType) {
    case "SUPPORTED":
      return "SUPPORTED";
    case "REJECTED":
      return "REJECTED";
    case "PARTIALLY_SUPPORTED":
    case "INCONCLUSIVE":
      return "TESTED";
    default:
      return null;
  }
}

/**
 * 回写前置校验（写入必须过假设状态机）。
 *
 * 与 `assertHypothesisTransition` 的关系：本函数是**语义包装**，
 * 让调用方（Engine）能捕获「回写不合法」并如实记原因，而不是抛出去影响 Run 终态。
 */
export function assertHypothesisWriteback(
  from: ResearchHypothesisStatus,
  to: ResearchHypothesisStatus,
): void {
  assertHypothesisTransition(from, to);
}

/**
 * 计算从当前状态走到目标状态的**合法状态链**（含起点与终点）。
 *
 * 返回 null = 不存在合法路径（例如假设仍是 `DRAFT` 而不具备可测条件）。
 * 为什么需要它：`DRAFT → SUPPORTED` 是**非法直跳**（状态机只允许逐级推进），
 * 但「结论已出、假设却没跟着走」会让 §26 的链条事实上断掉。此处显式给出逐级路径，
 * 由 Engine 依次写入 —— 每一步都是真实的阶段推进，不是状态伪造。
 */
export function planHypothesisStatusPath(
  from: ResearchHypothesisStatus,
  to: ResearchHypothesisStatus,
): ResearchHypothesisStatus[] | null {
  if (from === to) return [from];
  /** 逐级推进图（**必须是 `HYPOTHESIS_STATUS_TRANSITIONS` 的子集**，否则实际写入会被状态机拒绝）。 */
  const forward: Record<ResearchHypothesisStatus, ResearchHypothesisStatus[]> = {
    DRAFT: ["TESTABLE"],
    TESTABLE: ["TESTED"],
    TESTED: ["SUPPORTED", "REJECTED"],
    SUPPORTED: ["PROMOTED", "REJECTED"],
    REJECTED: [],
    PROMOTED: [],
  };
  // BFS（状态数极少，无需优化；显式给出最短合法链便于审计）
  const queue: ResearchHypothesisStatus[][] = [[from]];
  const seen = new Set<ResearchHypothesisStatus>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    for (const next of forward[last]) {
      if (next === to) return [...path, next];
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}
