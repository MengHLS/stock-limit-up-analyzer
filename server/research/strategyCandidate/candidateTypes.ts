/**
 * RESEARCH-006.2 — Conclusion → Strategy Candidate：领域类型 / 错误码 / **写入白名单**。
 *
 * 架构依据（唯一基准）：`docs/research/RESEARCH-006.0-architecture.md`
 *   §7.1 Candidate 字段裁定 / §10.1 Candidate 生命周期两条纪律 / §11.1~11.2 端点与校验链 / §13.1。
 * 前序实施：`docs/research/RESEARCH-006.1-implementation.md`（DB + Domain Model 已落真实 TiDB）。
 *
 * 本文件的定位：**桥的应用层**（不是持久化层，也不是 Canonical Strategy 层）。
 *   - 只做「Research 发现的取舍登记」，**不产出** `StrategyDefinition`（那是 006.3 promote 的职责）；
 *   - 依赖方向：本模块 → `researchCore`（+ 只读 Dataset Registry 端口）；**本 STEP 不 import
 *     `strategyPersistence` / `strategySchema`**（006.2 §21）。
 */

import {
  RESEARCH_CANDIDATE_IMMUTABLE_FIELDS,
  type ResearchStrategyCandidate,
} from "../../researchCore";

// ---------------------------------------------------------------------------
// 写入白名单（普通 update 的**唯一权威**）
// ---------------------------------------------------------------------------

/**
 * 候选**可编辑**字段 —— 即「研究意图草图」。
 *
 * 006.0 §7.1 的字段三分法：
 *   ① 草图（人可编辑）      → 本白名单
 *   ② 来源快照（只由语义入口写） → `RESEARCH_CANDIDATE_IMMUTABLE_FIELDS`（006.1）
 *   ③ 结构 / 状态（只由语义入口写） → `status` / `strategyDefinitionId`（006.1 的 guarded 类）
 *
 * 🔴 **closed by default**：白名单是**闭集** —— 校验实现是「凡不在此列的键一律拒绝」，
 * 因此**将来给 Candidate 加字段时，不显式加进本白名单就不能被 API 修改**（006.2 §16 的最后一句）。
 */
export const CANDIDATE_EDITABLE_FIELDS = [
  "name",
  "description",
  "entryRule",
  "filterRule",
  "exitRule",
  "riskRule",
  "parameterSpace",
] as const;
export type CandidateEditableField = (typeof CANDIDATE_EDITABLE_FIELDS)[number];

/** 普通 update 入参（**只含**白名单字段；服务层仍会再做一次运行时闭集校验）。 */
export type StrategyCandidateUpdateInput = Partial<
  Pick<ResearchStrategyCandidate, CandidateEditableField>
>;

/**
 * 普通 update **绝不允许**出现的字段 —— 只用于把错误信息说得更具体（判据仍是「不在白名单」）。
 *
 * 为什么这些字段必须走语义化入口（006.0 §10.1 两条纪律 / 006.1 §15）：
 *   - `status` / `strategyDefinitionId`：状态迁移只能由 `transition()`（本 STEP）与未来的
 *     `promote()` 驱动（`CONVERTED` **只能**由 promote 到达）；直接改 = 可伪造「已转正」；
 *   - `experimentId` / `conclusionId`：结构锚，写入后不得漂移；
 *   - 4 个 `source*`：**历史事实快照**，可改即等于伪造历史。
 */
export const CANDIDATE_NON_UPDATABLE_FIELDS = [
  "status",
  "strategyDefinitionId",
  ...RESEARCH_CANDIDATE_IMMUTABLE_FIELDS,
] as const;
export type CandidateNonUpdatableField = (typeof CANDIDATE_NON_UPDATABLE_FIELDS)[number];

// ---------------------------------------------------------------------------
// transition 目标白名单
// ---------------------------------------------------------------------------

/**
 * `transition()` 允许的目标状态（006.0 §11.1：`to ∈ {REVIEW, ACCEPTED, REJECTED, ARCHIVED}`）。
 *
 * 🔴 `CONVERTED` **不在**此列，且必须给出**专属错误码**（`CONVERSION_REQUIRES_PROMOTE`）而不是
 * 泛化的「非法迁移」——「要走 promote」是一个**架构裁定**，不是一次状态机拒绝。
 *
 * ⚠️ 已登记的行为边界：状态机本身允许 `REVIEW → DRAFT`（退回），但本 STEP 不暴露该目标
 * （与 006.0 §11.1 一致）。**未开放 ≠ 已禁止**，属 006.4 可重新裁定的范围。
 */
export const CANDIDATE_TRANSITION_TARGETS = ["REVIEW", "ACCEPTED", "REJECTED", "ARCHIVED"] as const;
export type CandidateTransitionTarget = (typeof CANDIDATE_TRANSITION_TARGETS)[number];

// ---------------------------------------------------------------------------
// Conclusion 资格
// ---------------------------------------------------------------------------

/**
 * 允许登记为 Candidate 的 Conclusion 状态（006.0 §11.2 第 5 条）。
 *
 * `DRAFT`（在研）与 `FINAL`（定稿）均可登记；`SUPERSEDED`（已被取代）**拒绝** ——
 * 让被取代的结论产出策略，等于让已作废的发现进入执行链路。
 *
 * ⚠️ 真实库现状：7 行结论**全为 `DRAFT`**（结论 `status` 目前无写入路径，见 006.0 §4.1 B2），
 * 因此 `FINAL` 分支当前只能由单测覆盖，不假装它在真实数据上已被验证。
 */
export const CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES = ["DRAFT", "FINAL"] as const;

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------

export const STRATEGY_CANDIDATE_ERROR = {
  /** 指定的 Conclusion 不存在。 */
  CONCLUSION_NOT_FOUND: "STRATEGY_CANDIDATE_CONCLUSION_NOT_FOUND",
  /** Conclusion 归属的 Experiment 不存在（数据完整性缺口）。 */
  EXPERIMENT_NOT_FOUND: "STRATEGY_CANDIDATE_EXPERIMENT_NOT_FOUND",
  /** Experiment 的 `datasetVersionId` 不是合法正整数 ⇒ 研究来源坐标无法确定。 */
  DATASET_VERSION_INVALID: "STRATEGY_CANDIDATE_DATASET_VERSION_INVALID",
  /** 来源 Dataset Version 在 Registry 中不存在。 */
  DATASET_VERSION_NOT_FOUND: "STRATEGY_CANDIDATE_DATASET_VERSION_NOT_FOUND",
  /** 来源 Dataset Version 存在但未 READY（DRAFT / BUILDING / FAILED）⇒ 不得作为研究依据登记。 */
  DATASET_VERSION_NOT_READY: "STRATEGY_CANDIDATE_DATASET_VERSION_NOT_READY",
  /** Conclusion 状态不允许登记为 Candidate（`SUPERSEDED`）。 */
  CONCLUSION_NOT_CANDIDATE_ELIGIBLE: "STRATEGY_CANDIDATE_CONCLUSION_NOT_ELIGIBLE",
  /** 同一 Conclusion 下同名候选已存在（应用层软拒绝；**不加** DB 唯一约束，见 006.0 §13.1）。 */
  CANDIDATE_ALREADY_EXISTS: "STRATEGY_CANDIDATE_ALREADY_EXISTS",
  /** 指定的 Candidate 不存在。 */
  CANDIDATE_NOT_FOUND: "STRATEGY_CANDIDATE_NOT_FOUND",
  /** `transition` 试图进入 `CONVERTED` —— 必须走未来的 `promote()`（006.3）。 */
  CONVERSION_REQUIRES_PROMOTE: "STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE",
  /** 状态迁移非法（不在 `CANDIDATE_TRANSITIONS` 内 / 目标不开放 / 状态未变化）。 */
  TRANSITION_INVALID: "STRATEGY_CANDIDATE_TRANSITION_INVALID",
  /** 入参非法（未知字段 / 空补丁 / 名称非法等）。 */
  INVALID_INPUT: "STRATEGY_CANDIDATE_INVALID_INPUT",
} as const;

export type StrategyCandidateErrorCode =
  (typeof STRATEGY_CANDIDATE_ERROR)[keyof typeof STRATEGY_CANDIDATE_ERROR];

export class StrategyCandidateError extends Error {
  readonly code: StrategyCandidateErrorCode;

  constructor(code: StrategyCandidateErrorCode, message: string) {
    super(message);
    this.name = "StrategyCandidateError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 校验（纯函数，可单测）
// ---------------------------------------------------------------------------

/**
 * 普通 update 的**闭集白名单**校验（006.2 §15 / §16）。
 *
 * 行为约定：
 *   - 键值为 `undefined` 视为「未提供」（与仓储层断言同口径）；
 *   - 出现任何不在 `CANDIDATE_EDITABLE_FIELDS` 的键 ⇒ **响亮失败**，错误信息点名该字段；
 *   - 一个可写字段都没有 ⇒ 失败（不返回「成功但没变」的假结果，与 researchEngineRouter 同纪律）。
 */
export function assertCandidateUpdateWhitelist(input: Record<string, unknown>): void {
  const provided = Object.keys(input).filter((key) => input[key] !== undefined);
  const offenders = provided.filter(
    (key) => !(CANDIDATE_EDITABLE_FIELDS as readonly string[]).includes(key),
  );
  if (offenders.length > 0) {
    const named = offenders.map((key) =>
      (CANDIDATE_NON_UPDATABLE_FIELDS as readonly string[]).includes(key)
        ? `${key}（须走 transition / promote 等语义化入口）`
        : `${key}（不在可编辑白名单内）`,
    );
    throw new StrategyCandidateError(
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
      `Candidate 普通 update 只允许修改研究草图字段（${CANDIDATE_EDITABLE_FIELDS.join(" / ")}），`
        + `以下字段被拒绝：${named.join("、")}`,
    );
  }
  if (provided.length === 0) {
    throw new StrategyCandidateError(
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
      "未提供任何可更新的 Candidate 草图字段",
    );
  }
}

/** 候选名称约束（与 `research_strategy_candidate.name varchar(200)` 对齐）。 */
export const CANDIDATE_NAME_MAX_LENGTH = 200;

export function assertCandidateName(name: unknown): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new StrategyCandidateError(
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
      "候选名称必须是非空字符串",
    );
  }
  const trimmed = name.trim();
  if (trimmed.length > CANDIDATE_NAME_MAX_LENGTH) {
    throw new StrategyCandidateError(
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
      `候选名称最长 ${CANDIDATE_NAME_MAX_LENGTH} 字符，实际 ${trimmed.length}`,
    );
  }
  return trimmed;
}

/**
 * `createFromConclusion` 的 `overrides` 只允许填**研究草图**（5 个 `*Json` 列）。
 *
 * 🔴 明确**不接受** `datasetVersionId`（006.0 §11.2）：研究来源坐标恒取
 * `experiment.datasetVersionId`，允许调用方覆盖即等于允许改写研究历史。
 */
export function assertCandidateOverridesKeys(input: Record<string, unknown>): void {
  const offenders = Object.keys(input).filter(
    (key) => !(CANDIDATE_EDITABLE_FIELDS as readonly string[]).includes(key) && input[key] !== undefined,
  );
  if (offenders.length > 0) {
    throw new StrategyCandidateError(
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
      `overrides 只接受候选草图字段（${CANDIDATE_EDITABLE_FIELDS.join(" / ")}）；`
        + `以下被拒绝：${offenders.join("、")}`
        + "（研究来源 Dataset 坐标恒取自 Experiment，不接受调用方覆盖）",
    );
  }
}
