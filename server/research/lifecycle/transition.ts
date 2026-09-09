/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management：迁移表与合法性判定（纯函数、确定性）。
 *
 * §23 完整链路：Draft → Research → Candidate → Validated → Paper → Approved →
 * Production → Retired。本模块是迁移表与边类型的**唯一权威来源**。
 *
 * 迁移规则（设计决策，逐个文档化）：
 *   1. 前进（advance）：只允许沿规范链相邻前进（i → i+1）：
 *        Draft→Research→Candidate→Validated→Paper→Approved→Production；
 *   2. 回退（rollback）：允许退到**前驱状态**（治理性撤回），并显式放行
 *      Production→Research 长程异常回退（生产事故时策略退回研究做根因）；
 *      每条回退边都显式列出（白名单），禁止隐含「任意后退」；
 *   3. 退役（retire）：任意非 Retired 状态可直接 → Retired（项目终止/放弃的治理决策，
 *      由 reason 承载退役依据；禁止无记录修改——reason+timestamp 仍强制）；
 *   4. 终态：Retired 为终态（无出边）。同一策略**版本**退役后不可复活；
 *      「复活」= 由 C-15.1 bump 出新的 StrategyVersionRecord，为新版本另建生命周期壳
 *      genesis Research（evidence 引用 inheritance 父壳，见 gates.ts）。历史链永不改写；
 *   5. 禁止跳级与同态：Draft→Production 之类跳级、to === from 同态一律拒绝
 *      （响亮报错，带中文信息）。
 *
 * 与既有实验/Run/Batch 状态机（status.ts EXPERIMENT_STATUS_TRANSITIONS 等）命名隔离：
 * 全部符号加 LIFECYCLE / STRATEGY_LIFECYCLE 域前缀，避免 future research/index.ts 聚合撞名。
 */

import {
  STRATEGY_LIFECYCLE_STATUS_ORDER,
  STRATEGY_LIFECYCLE_STATUSES,
  STRATEGY_STATUS_APPROVED,
  STRATEGY_STATUS_CANDIDATE,
  STRATEGY_STATUS_DRAFT,
  STRATEGY_STATUS_PAPER,
  STRATEGY_STATUS_PRODUCTION,
  STRATEGY_STATUS_RESEARCH,
  STRATEGY_STATUS_RETIRED,
  STRATEGY_STATUS_VALIDATED,
  isStrategyLifecycleStatus,
  type LifecycleTransition,
  type StrategyLifecycleStatus,
} from "./types";

// ---------------------------------------------------------------------------
// 迁移表（唯一权威来源）
// ---------------------------------------------------------------------------

/**
 * §23 合法迁移表（from → 可到达的 to 集合；白名单制）。
 *
 *   Draft      → Research（前进）｜ Retired（退役）
 *   Research   → Draft（回退）｜ Candidate（前进）｜ Retired
 *   Candidate  → Research（回退）｜ Validated（前进）｜ Retired
 *   Validated  → Candidate（回退）｜ Paper（前进）｜ Retired
 *   Paper      → Validated（回退）｜ Approved（前进）｜ Retired
 *   Approved   → Paper（回退）｜ Production（前进）｜ Retired
 *   Production → Research（异常回退）｜ Retired
 *   Retired    → （无出边，终态）
 */
export const STRATEGY_LIFECYCLE_TRANSITIONS: Readonly<
  Record<StrategyLifecycleStatus, readonly StrategyLifecycleStatus[]>
> = {
  Draft: [STRATEGY_STATUS_RESEARCH, STRATEGY_STATUS_RETIRED],
  Research: [STRATEGY_STATUS_DRAFT, STRATEGY_STATUS_CANDIDATE, STRATEGY_STATUS_RETIRED],
  Candidate: [STRATEGY_STATUS_RESEARCH, STRATEGY_STATUS_VALIDATED, STRATEGY_STATUS_RETIRED],
  Validated: [STRATEGY_STATUS_CANDIDATE, STRATEGY_STATUS_PAPER, STRATEGY_STATUS_RETIRED],
  Paper: [STRATEGY_STATUS_VALIDATED, STRATEGY_STATUS_APPROVED, STRATEGY_STATUS_RETIRED],
  Approved: [STRATEGY_STATUS_PAPER, STRATEGY_STATUS_PRODUCTION, STRATEGY_STATUS_RETIRED],
  Production: [STRATEGY_STATUS_RESEARCH, STRATEGY_STATUS_RETIRED],
  Retired: [],
};

// ---------------------------------------------------------------------------
// 边分类（advance / rollback / retire）
// ---------------------------------------------------------------------------

/** 迁移边种类。 */
export type LifecycleEdgeKind = "advance" | "rollback" | "retire";

/** 某合法迁移边是否前进（沿规范链 rank 上升）。 */
export function isAdvanceTransition(from: StrategyLifecycleStatus, to: StrategyLifecycleStatus): boolean {
  return STRATEGY_LIFECYCLE_STATUS_ORDER[to] > STRATEGY_LIFECYCLE_STATUS_ORDER[from];
}

/** 某合法迁移边是否回退（沿规范链 rank 下降；退役单独分类）。 */
export function isRollbackTransition(from: StrategyLifecycleStatus, to: StrategyLifecycleStatus): boolean {
  return STRATEGY_LIFECYCLE_STATUS_ORDER[to] < STRATEGY_LIFECYCLE_STATUS_ORDER[from];
}

/** 某合法迁移边是否退役（→ Retired）。 */
export function isRetireTransition(_from: StrategyLifecycleStatus, to: StrategyLifecycleStatus): boolean {
  return to === STRATEGY_STATUS_RETIRED;
}

/** 合法迁移边的分类（供 evidence 阈值选择；非法迁移抛错）。 */
export function classifyLifecycleEdge(from: StrategyLifecycleStatus, to: StrategyLifecycleStatus): LifecycleEdgeKind {
  assertLifecycleTransitionAllowed(from, to);
  if (isRetireTransition(from, to)) return "retire";
  if (isAdvanceTransition(from, to)) return "advance";
  return "rollback";
}

// ---------------------------------------------------------------------------
// 合法性判定
// ---------------------------------------------------------------------------

/** 是否为合法迁移边（不含 genesis from=null 情形）。 */
export function canLifecycleTransition(from: StrategyLifecycleStatus, to: StrategyLifecycleStatus): boolean {
  return (STRATEGY_LIFECYCLE_TRANSITIONS[from] as readonly StrategyLifecycleStatus[]).includes(to);
}

/** from/to 均合法时的迁移解释（用于响亮报错；不抛）。 */
export function describeTransitionViolation(from: unknown, to: unknown): string | null {
  if (!isStrategyLifecycleStatus(String(from))) {
    return `迁移源状态非法：${String(from)}（不是 §23 生命周期状态）`;
  }
  if (!isStrategyLifecycleStatus(String(to))) {
    return `迁移目标状态非法：${String(to)}（不是 §23 生命周期状态）`;
  }
  const fromStatus = from as StrategyLifecycleStatus;
  const toStatus = to as StrategyLifecycleStatus;
  if (fromStatus === toStatus) {
    return `同态迁移被拒绝：${fromStatus} → ${toStatus}（状态未变化，禁止无意义的空迁移入审计链）`;
  }
  if (!canLifecycleTransition(fromStatus, toStatus)) {
    if (toStatus === STRATEGY_STATUS_RETIRED) {
      return `非法迁移：${fromStatus} → ${toStatus} 不允许（退役后为终态，同一版本不可复活；复活请 bump 新版本并另建生命周期壳）`;
    }
    if (STRATEGY_LIFECYCLE_STATUS_ORDER[toStatus] > STRATEGY_LIFECYCLE_STATUS_ORDER[fromStatus]) {
      const requiredPrefix = STRATEGY_LIFECYCLE_STATUSES.slice(0, STRATEGY_LIFECYCLE_STATUS_ORDER[toStatus]).join(" → ");
      return `跳级迁移被拒绝：${fromStatus} → ${toStatus}（§23 只允许沿 Draft→Research→Candidate→Validated→Paper→Approved→Production 相邻前进；` +
        `目标 ${toStatus} 的前置链路 ${requiredPrefix} 尚未走完，禁止无记录/无证据升级）`;
    }
    return `回退迁移被拒绝：${fromStatus} → ${toStatus}（迁移表为白名单制，只允许退到前驱状态，或 Production→Research 显式异常回退，见 transition.ts 迁移表）`;
  }
  return null;
}

/** 非法迁移响亮抛错（中文信息；不静默接受）。 */
export function assertLifecycleTransitionAllowed(from: StrategyLifecycleStatus, to: StrategyLifecycleStatus): void {
  const violation = describeTransitionViolation(from, to);
  if (violation !== null) {
    throw new Error(`生命周期迁移非法：${violation}`);
  }
}

// ---------------------------------------------------------------------------
// 面向 LifecycleTransition 的合法性判定（from 可空 = genesis）
// ---------------------------------------------------------------------------

/**
 * 校验一条 transition 的迁移边本身是否合法。
 * genesis（from=null）不做迁移表校验（出生不是迁移）；非 genesis 必须走迁移表。
 */
export function assertTransitionEdgeLegal(transition: LifecycleTransition): void {
  if (transition.from === null) {
    return; // genesis：出生非迁移，边合法性不适用；字段与阈值由 validate/gates 层复核。
  }
  assertLifecycleTransitionAllowed(transition.from, transition.to);
}
