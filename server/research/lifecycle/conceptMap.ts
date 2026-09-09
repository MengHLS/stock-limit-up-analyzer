/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management：与 §7 项目任务 7 态的概念映射。
 *
 * 两套状态机是**不同维度**，禁止概念污染（这是本模块存在的意义）：
 *
 *   1. ROADMAP §7「项目任务 7 态」（DESIGN/CODE_READY/DATA_READY/VALIDATED/
 *      RESEARCH_READY/PRODUCTION_READY/BLOCKED）描述**子系统/交付物**的开发成熟度——
 *      由协调者在 ROADMAP §44/TASK_TRACKING 记账（如「engine 层 CODE_READY；
 *      VALIDATED 依赖数据链就绪后认证」）。它回答「这个系统模块能用了吗」；
 *   2. §23「策略生命周期 8 态」（Draft/Research/Candidate/Validated/Paper/Approved/
 *      Production/Retired，本目录）描述**单个策略本体版本**（C-15.1 StrategyVersionRecord）
 *      的研究治理状态。它回答「这个策略版本处于哪一研究/决策阶段、凭什么升级」。
 *
 * 二者的关系（务必文档化，防误用）：
 *   - 生命周期 Validated ≠ 任务 7 态 VALIDATED：策略想被上报为「数据链认证 VALIDATED」，
 *     必须在 →Validated 与 →Production 迁移上携带 datasetGate(PASS) 证据（引用已认证的
 *     rd-… 数据集版本）——这是策略**引用**任务态认证结果，而非替代任务状态记账；
 *   - 生命周期 Research/Candidate/Paper… 一律**不得**上报为任务 VALIDATED——
 *     「Research→Candidate 完成了」只说明研究产出候选，不说明任何系统级验证通过；
 *   - 生命周期 Research ≠ 任务 RESEARCH_READY：RESEARCH_READY 是研究基础设施就绪，
 *     生命周期 Research 是该策略正被研究，两者名称相近但语义不同，禁止混用。
 *
 * 因此本模块只提供「汇报用」的近似映射（有损、注释标明）与若干守卫断言；真实任务
 * 状态记账仍以 ROADMAP/TASK_TRACKING 为准。守卫不连 DB、不跑真实 gate（对齐 C-21.1 边界）。
 */

import {
  STRATEGY_STATUS_APPROVED,
  STRATEGY_STATUS_DRAFT,
  STRATEGY_STATUS_PAPER,
  STRATEGY_STATUS_PRODUCTION,
  STRATEGY_STATUS_RETIRED,
  STRATEGY_STATUS_VALIDATED,
  type LifecycleEvidenceRef,
  type StrategyLifecycleRecord,
  type StrategyLifecycleStatus,
} from "./types";

// ---------------------------------------------------------------------------
// §7 项目任务 7 态（仅作汇报类型引用；权威记账在 ROADMAP §44 / TASK_TRACKING）
// ---------------------------------------------------------------------------

/** §7 任务 7 态（DESIGN/CODE_READY/DATA_READY/VALIDATED/RESEARCH_READY/PRODUCTION_READY/BLOCKED）。 */
export const PROJECT_TASK_STATUSES = [
  "DESIGN",
  "CODE_READY",
  "DATA_READY",
  "VALIDATED",
  "RESEARCH_READY",
  "PRODUCTION_READY",
  "BLOCKED",
] as const;

export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];

/** 值是否为 §7 任务态。 */
export function isProjectTaskStatus(value: unknown): value is ProjectTaskStatus {
  return typeof value === "string" && (PROJECT_TASK_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 汇报用映射（有损；禁止据此推进任何真实状态）
// ---------------------------------------------------------------------------

/**
 * 策略生命周期 → §7 任务态（仅汇报，有损）。设计决策逐条注释：
 *   - Draft      → DESIGN：设计期，等价成立；
 *   - Research   → CODE_READY：正在研究（≠ RESEARCH_READY！RESEARCH_READY 是基础设施
 *                  就绪，生命周期 Research 是活动进行中，二者概念不同，禁止等同）；
 *   - Candidate  → CODE_READY：候选未认证，等价「代码在但未验证」；
 *   - Validated  → VALIDATED：**唯一**允许映射任务 VALIDATED 的生命周期态
 *                  （且要求 evidence 带数据链 gate=PASS / metrics PASS，见守卫）；
 *   - Paper      → RESEARCH_READY：纸面/模拟盘运行需研究基础设施至少 RESEARCH_READY
 *                  （任务态无「纸面」档，取最近基础设施档，注释标明有损）；
 *   - Approved   → PRODUCTION_READY：审批通过 = 生产就绪裁定；
 *   - Production → PRODUCTION_READY：生产中亦属生产就绪档；
 *   - Retired    → null：任务态无退役档（BLOCKED 表示存在阻塞依赖，与退役语义相反，
 *                  禁止用 BLOCKED 冒充 Retired）。
 */
export const STRATEGY_LIFECYCLE_TO_TASK_STATUS: Readonly<
  Record<StrategyLifecycleStatus, ProjectTaskStatus | null>
> = {
  Draft: "DESIGN",
  Research: "CODE_READY",
  Candidate: "CODE_READY",
  Validated: "VALIDATED",
  Paper: "RESEARCH_READY",
  Approved: "PRODUCTION_READY",
  Production: "PRODUCTION_READY",
  Retired: null,
};

/** 汇报映射取值（可能为 null = 任务态无对应档，如 Retired）。 */
export function mapStrategyLifecycleToTaskStatus(status: StrategyLifecycleStatus): ProjectTaskStatus | null {
  return STRATEGY_LIFECYCLE_TO_TASK_STATUS[status];
}

// ---------------------------------------------------------------------------
// 概念守卫
// ---------------------------------------------------------------------------

/** 迁移历史里是否存在 →Validated 且携带证据门槛（datasetGate PASS / metrics PASS）的记录。 */
export function hasValidatedEvidenceTrail(record: StrategyLifecycleRecord): boolean {
  return record.transitions.some((transition) => {
    if (transition.to !== STRATEGY_STATUS_VALIDATED) return false;
    return (transition.evidence as readonly LifecycleEvidenceRef[]).some(
      (ref) =>
        (ref.kind === "datasetGate" && ref.gate === "PASS") ||
        (ref.kind === "metricsRecord" && ref.result === "PASS"),
    );
  });
}

/**
 * 静态守卫：断言映射表不犯「概念污染」。规则：
 *   - 仅 Validated 映射到任务 VALIDATED（Research/Candidate/Paper… 一律不得——
 *     Research→Candidate 不是系统级验证，禁止把候选当 VALIDATED 上报）；
 *   - 仅 Approved/Production 映射到任务 PRODUCTION_READY（Draft/Research/Candidate 不得
 *     假装生产就绪）；
 *   - Draft 只映射 DESIGN（生命周期 Draft 永不等于任何就绪档）；
 *   - Retired 映射 null（禁止用 BLOCKED 冒充退役）。
 */
export function assertLifecycleTaskMappingIntegrity(): void {
  const violations: string[] = [];
  for (const [status, task] of Object.entries(STRATEGY_LIFECYCLE_TO_TASK_STATUS)) {
    const lifecycle = status as StrategyLifecycleStatus;
    if (lifecycle === STRATEGY_STATUS_VALIDATED && task !== "VALIDATED") {
      violations.push(`生命周期 Validated 必须映射任务 VALIDATED（实际 ${String(task)}）`);
    }
    if (lifecycle !== STRATEGY_STATUS_VALIDATED && task === "VALIDATED") {
      violations.push(`生命周期 ${lifecycle} 不得映射任务 VALIDATED（Research→Candidate 不是系统级验证，禁止概念污染）`);
    }
    if (task === "PRODUCTION_READY" && lifecycle !== STRATEGY_STATUS_APPROVED && lifecycle !== STRATEGY_STATUS_PRODUCTION) {
      violations.push(`只有 Approved/Production 可映射 PRODUCTION_READY（当前 ${lifecycle} 映射为 PRODUCTION_READY）`);
    }
  }
  if (STRATEGY_LIFECYCLE_TO_TASK_STATUS[STRATEGY_STATUS_DRAFT] !== "DESIGN") {
    violations.push("Draft 必须映射 DESIGN（设计期等价）");
  }
  if (STRATEGY_LIFECYCLE_TO_TASK_STATUS[STRATEGY_STATUS_RETIRED] !== null) {
    violations.push("Retired 必须映射 null（任务态无退役档；禁止用 BLOCKED 冒充 Retired）");
  }
  if (violations.length > 0) {
    throw new Error(`生命周期↔任务态映射违反概念纪律：\n  - ${violations.join("\n  - ")}`);
  }
}

/**
 * 是否处于「要求数据链任务 VALIDATED」的生命周期带（Validated 及之后；进这些档的迁移
 * 在 apply 时强制携带 datasetGate(PASS) 或 metrics(PASS)，见 gates.ts 档位 5/7）。
 */
export function requiresTaskValidation(status: StrategyLifecycleStatus): boolean {
  return (
    status === STRATEGY_STATUS_VALIDATED ||
    status === STRATEGY_STATUS_PAPER ||
    status === STRATEGY_STATUS_APPROVED ||
    status === STRATEGY_STATUS_PRODUCTION
  );
}

/**
 * 守卫断言（汇报场景用）：若生命周期已进入 Validated/Paper/Approved/Production 带，
 * 迁移历史必须存在 →Validated 的证据门槛记录（datasetGate PASS 或 metrics PASS），否则
 * 说明记录被旁路伪造——响亮抛错（§45.2 禁止无证据标 Validated）。
 * apply 已做强门槛，此守卫是二次防御（如外部反序列化 / 未来 DB 回放）。
 */
export function assertValidatedClaimHasEvidence(record: StrategyLifecycleRecord): void {
  if (!requiresTaskValidation(record.status)) return;
  if (!hasValidatedEvidenceTrail(record)) {
    throw new Error(
      `生命周期 ${record.strategyId}@${record.strategyVersion} 状态为 ${record.status}，` +
        "但迁移历史缺少 →Validated 的 datasetGate(PASS)/metrics(PASS) 证据门槛记录；" +
        "禁止把未认证策略上报为任务 VALIDATED（§45.2）",
    );
  }
}
