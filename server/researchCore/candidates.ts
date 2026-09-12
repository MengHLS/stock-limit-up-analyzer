/**
 * RESEARCH-001 — 策略候选领域模型（入口 / 过滤 / 出场 / 风控规则 + 参数空间）。
 *
 * 边界铁律（指令 §12 / §24）：
 *   - Candidate **不是**正式 Strategy：`strategyDefinitionId = null` 是**合法状态**（尚未转正）；
 *   - Research 层**只写** `research_strategy_candidate`，**绝不** INSERT / UPDATE
 *     `strategies` / `strategy_versions`；
 *   - 本文件只做**规则结构的声明与校验**，不做回测、不做参数搜索、不做信号求值。
 */

import { assertConditionSet, type ResearchConditionSet } from "./conditions";
import type { ResearchCandidateStatus, ResearchStrategyCandidate } from "./types";

// ---------------------------------------------------------------------------
// 规则类型
// ---------------------------------------------------------------------------

/** 入场规则（声明式；具体语义由 Strategy 侧解释）。 */
export interface ResearchEntryRule {
  /** 事件锚点类型（如 `FIRST_LIMIT_UP` / `LIMIT_UP` / `CONSECUTIVE_BOARD`）。 */
  event?: string;
  /** 入场时点（如 `NEXT_OPEN` / `NEXT_CLOSE` / `SAME_CLOSE`）。 */
  timing?: string;
  /** 开放扩展。 */
  extra?: Record<string, unknown>;
}

/** 出场规则。 */
export interface ResearchExitRule {
  /** 固定持有交易日数。 */
  holdingDays?: number;
  /** 止盈（收益比例，如 0.10）。 */
  takeProfit?: number;
  /** 止损（亏损比例，如 0.05）。 */
  stopLoss?: number;
  /** 开放扩展。 */
  extra?: Record<string, unknown>;
}

/** 风控规则。 */
export interface ResearchRiskRule {
  /** 最大同时持仓数。 */
  maxPositions?: number;
  /** 单标的仓位上限（占总资金比例）。 */
  maxPositionWeight?: number;
  /** 市场环境闸门（如 `market_strength > 0.6`）。 */
  regimeGate?: ResearchConditionSet;
  /** 开放扩展。 */
  extra?: Record<string, unknown>;
}

/**
 * 待搜参数空间（Research 只声明，**不执行搜索**）。
 * 形如 `{ turnoverLow: { type: "number", min: 5, max: 12, step: 1 } }`。
 */
export type ResearchParameterSpace = Record<
  string,
  {
    type: "number" | "string" | "boolean";
    min?: number;
    max?: number;
    step?: number;
    allowedValues?: ReadonlyArray<string | number | boolean>;
  }
>;

/** 候选规则集（领域形态；落库时各字段分别序列化到独立 Json 列）。 */
export interface ResearchCandidateRuleSet {
  entryRule?: ResearchEntryRule;
  filterRule?: ResearchConditionSet;
  exitRule?: ResearchExitRule;
  riskRule?: ResearchRiskRule;
  parameterSpace?: ResearchParameterSpace;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export class ResearchCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchCandidateError";
  }
}

/** 校验候选入参。`strategyDefinitionId` 允许为 null / undefined（尚未转正）。 */
export function assertCandidateInput(
  input: Pick<ResearchStrategyCandidate, "experimentId" | "name" | "status" | "strategyDefinitionId"> & {
    filterRule?: unknown;
  },
): void {
  if (!Number.isInteger(input.experimentId) || input.experimentId <= 0) {
    throw new ResearchCandidateError(`非法 experimentId：${String(input.experimentId)}`);
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new ResearchCandidateError("候选名称不能为空");
  }
  const sid = input.strategyDefinitionId;
  if (sid !== null && sid !== undefined) {
    if (typeof sid !== "string" || sid.trim().length === 0) {
      throw new ResearchCandidateError("strategyDefinitionId 若存在必须是非空字符串");
    }
  }
  if (input.filterRule !== undefined && input.filterRule !== null) {
    assertConditionSet(input.filterRule as ResearchConditionSet);
  }
}

/**
 * RESEARCH-006.1 — **普通 update 的写入边界**（Domain Model 层强制）。
 *
 * 分两类，差别是「能不能靠断言补救」：
 *
 * ① `RESEARCH_CANDIDATE_IMMUTABLE_FIELDS` —— **硬拒**。它们是**结构锚**与**历史事实快照**，
 *    没有任何合法理由在候选存续期内改变；可改即等于伪造历史：
 *      - `experimentId` / `conclusionId`：候选属于哪个实验 / 哪个结论；
 *      - 4 个 `source*`：研究来源 Dataset 坐标 / Run / 证据快照 / 偏差原因。
 *
 * ② `RESEARCH_CANDIDATE_GUARDED_TRANSITION_FIELDS` —— **只许走状态机守卫**（见下）。
 *    取值必须过 `assertCandidateTransition` + `assertCandidateConversionCoherence`：
 *      - `status`：`DRAFT→REVIEW→ACCEPTED→CONVERTED`（`CONVERTED` 还需要 `strategyDefinitionId`）；
 *      - `strategyDefinitionId`：与 `status` 强耦合（非 `CONVERTED` 时不得已挂）。
 *
 *    ⚠️ 006.0 §10.1 已裁定：**API 层（006.2）必须把这两个字段从通用 update 白名单摘出**，
 *    只走语义化 `transition` / `promote`；到 006.3，`CONVERTED` 只能由 `promote` 到达。
 *    本 STEP **不重构**既有状态迁移路径（006.1 §16 / §17），只在 Domain Model 里把边界写清楚。
 */
export const RESEARCH_CANDIDATE_IMMUTABLE_FIELDS = [
  "experimentId",
  "conclusionId",
  "sourceDatasetVersionId",
  "sourceResearchRunId",
  "sourceTraceJson",
  "sourceDatasetDivergenceReason",
] as const;

export type ResearchCandidateImmutableField = (typeof RESEARCH_CANDIDATE_IMMUTABLE_FIELDS)[number];

/** 只允许经状态机守卫迁移的字段（不是「可随意改」，见上方 ② 的说明）。 */
export const RESEARCH_CANDIDATE_GUARDED_TRANSITION_FIELDS = ["status", "strategyDefinitionId"] as const;

export type ResearchCandidateGuardedTransitionField =
  (typeof RESEARCH_CANDIDATE_GUARDED_TRANSITION_FIELDS)[number];

/**
 * 断言普通 update 的 patch **不含**任何硬拒字段（出现即响亮失败，不静默忽略）。
 * `patch` 形参声明为开放记录，正是为了在**类型已挡住**的前提下再加一层运行时防线
 * （DB / InMemory 两个实现共用同一判据，保证语义一致）。
 */
export function assertCandidateUpdatePatchKeys(patch: Record<string, unknown>): void {
  const offenders = RESEARCH_CANDIDATE_IMMUTABLE_FIELDS.filter(
    (key) => key in patch && patch[key] !== undefined,
  );
  if (offenders.length > 0) {
    throw new ResearchCandidateError(
      `以下字段不可经普通 Candidate update 修改（结构锚与来源快照只能由语义化入口写入）：${offenders.join(", ")}`,
    );
  }
}

/**
 * 候选状态机（应用层强制；DB 只存值 —— 与 `server/datasetRegistry/lifecycle` 同风格）。
 */
const CANDIDATE_TRANSITIONS: Record<ResearchCandidateStatus, readonly ResearchCandidateStatus[]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["ACCEPTED", "REJECTED", "DRAFT", "ARCHIVED"],
  ACCEPTED: ["CONVERTED", "ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  CONVERTED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function isCandidateTransitionAllowed(
  from: ResearchCandidateStatus,
  to: ResearchCandidateStatus,
): boolean {
  return CANDIDATE_TRANSITIONS[from].includes(to);
}

export function assertCandidateTransition(from: ResearchCandidateStatus, to: ResearchCandidateStatus): void {
  if (!isCandidateTransitionAllowed(from, to)) {
    throw new ResearchCandidateError(`非法候选状态迁移：${from} → ${to}`);
  }
}

/**
 * 转正前置校验：`CONVERTED` 状态**必须**有 `strategyDefinitionId`，
 * 且非 `CONVERTED` 状态**不应**已有 `strategyDefinitionId`（避免「未转正却已挂策略」的歧义）。
 */
export function assertCandidateConversionCoherence(candidate: {
  status: ResearchCandidateStatus;
  strategyDefinitionId?: string | null;
}): void {
  const hasLink = candidate.strategyDefinitionId !== null && candidate.strategyDefinitionId !== undefined;
  if (candidate.status === "CONVERTED" && !hasLink) {
    throw new ResearchCandidateError("CONVERTED 状态的候选必须提供 strategyDefinitionId");
  }
  if (candidate.status !== "CONVERTED" && hasLink) {
    throw new ResearchCandidateError(
      `候选状态为 ${candidate.status} 时不应已绑定 strategyDefinitionId（转正须经 CONVERTED）`,
    );
  }
}
