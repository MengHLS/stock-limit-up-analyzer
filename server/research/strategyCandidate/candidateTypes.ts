/**
 * RESEARCH-006.2 / 006.3 — Conclusion → Strategy Candidate：领域类型 / 错误码 / **写入白名单**。
 *
 * 架构依据（唯一基准）：`docs/research/RESEARCH-006.0-architecture.md`
 *   §7.1 Candidate 字段裁定 / §10.1 Candidate 生命周期两条纪律 / §11.1~11.3 端点与校验链 /
 *   §13.1 最小增列 / §9.2 Dataset 继承与分歧。
 * 前序实施：`docs/research/RESEARCH-006.1-implementation.md`（DB + Domain Model 已落真实 TiDB）、
 *          `docs/research/RESEARCH-006.2-implementation.md`（候选业务线路）。
 *
 * 本文件的定位：**桥的应用层**（不是持久化层，也不是 Canonical Strategy 层）。
 *   - 006.2：只做「Research 发现的取舍登记」；
 *   - 006.3：`promote` 的**入参白名单**与专属错误码也归这里 —— 桥仍然只产出「候选状态」与
 *     「转正结果」，`StrategyDefinition` 的构造始终由 `definitionBuild.ts` 唯一实现。
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
  /** `transition` 试图进入 `CONVERTED` —— 只有 `promote()`（006.3）可以产生。 */
  CONVERSION_REQUIRES_PROMOTE: "STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE",
  /** 状态迁移非法（不在 `CANDIDATE_TRANSITIONS` 内 / 目标不开放 / 状态未变化）。 */
  TRANSITION_INVALID: "STRATEGY_CANDIDATE_TRANSITION_INVALID",
  /** 入参非法（未知字段 / 空补丁 / 名称非法等）。 */
  INVALID_INPUT: "STRATEGY_CANDIDATE_INVALID_INPUT",

  // -------------------------------------------------------------------------
  // RESEARCH-006.3 —— promote() 专属（§5 / §8 / §12 / §14 / §15 / §25）
  // -------------------------------------------------------------------------
  /** 只有 `ACCEPTED` 允许转正；其余状态（DRAFT / REVIEW / REJECTED / ARCHIVED）一律拒绝（§5.3）。 */
  CANDIDATE_NOT_ACCEPTED: "STRATEGY_CANDIDATE_NOT_ACCEPTED",
  /** 候选缺少可写进 provenance 的来源锚（`conclusionId` / `experimentId` 非正整数）（§20）。 */
  PROMOTE_SOURCE_INCOMPLETE: "STRATEGY_CANDIDATE_PROMOTE_SOURCE_INCOMPLETE",
  /** 草图缺少构建 `StrategyDefinition` 的必填字段 —— **绝不补默认值**（§8）。 */
  PROMOTE_SKETCH_INCOMPLETE: "STRATEGY_CANDIDATE_PROMOTE_SKETCH_INCOMPLETE",
  /** 草图字段存在但非法 / 不被 StrategyDefinition 词表支持（如 `BETWEEN` / `regimeGate`）。 */
  PROMOTE_SKETCH_INVALID: "STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID",
  /** 构建出的 `StrategyDefinition` 未通过既有校验（含 Look-Ahead L1–L8）（§10）。 */
  PROMOTE_DEFINITION_INVALID: "STRATEGY_CANDIDATE_PROMOTE_DEFINITION_INVALID",
  /** 研究来源 Dataset ≠ 执行绑定 Dataset，但未提供 `datasetDivergenceReason`（§12）。 */
  DATASET_DIVERGENCE_REASON_REQUIRED: "STRATEGY_CANDIDATE_DATASET_DIVERGENCE_REASON_REQUIRED",
  /** Dataset 坐标存在但无法解析业务码（`dataset_definition.datasetCode`）等绑定语义冲突。 */
  DATASET_BINDING_INVALID: "STRATEGY_CANDIDATE_DATASET_BINDING_INVALID",
  /** 派生出的 `strategyId` 已被**另一个**策略占用（同 id 但该版本不存在）⇒ 拒绝挂靠。 */
  PROMOTE_STRATEGY_ID_CONFLICT: "STRATEGY_CANDIDATE_PROMOTE_STRATEGY_ID_CONFLICT",
  /** 同名版本的指纹不同（内容被改写）⇒ 违反版本不可变，拒绝。 */
  PROMOTE_VERSION_CONFLICT: "STRATEGY_CANDIDATE_PROMOTE_VERSION_CONFLICT",
  /**
   * 跨存储第二步失败（§25 / §26）：Strategy / Version 已创建，但 provenance 或候选回写失败。
   * `details` 必带已生成的 `strategyId` / `strategyVersionId`，供重试通过幂等闸门自愈。
   */
  PROMOTE_WRITEBACK_FAILED: "STRATEGY_CANDIDATE_PROMOTE_WRITEBACK_FAILED",
  /** 候选已是 `CONVERTED` 但**没有**对应 provenance 行 —— 状态与溯源不一致，需人工核对（§19）。 */
  PROMOTE_STATE_INCONSISTENT: "STRATEGY_CANDIDATE_PROMOTE_STATE_INCONSISTENT",
} as const;

export type StrategyCandidateErrorCode =
  (typeof STRATEGY_CANDIDATE_ERROR)[keyof typeof STRATEGY_CANDIDATE_ERROR];

/**
 * 桥的领域错误。
 *
 * `details` 只在**跨存储恢复**场景使用（006.3 §25）：`PROMOTE_WRITEBACK_FAILED` 必须携带已经
 * 写入成功的 `strategyId` / `strategyVersionId`，否则调用方无法判断「要不要重试」与「重试会不会
 * 产生第二份 Strategy」。
 */
export class StrategyCandidateError extends Error {
  readonly code: StrategyCandidateErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: StrategyCandidateErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "StrategyCandidateError";
    this.code = code;
    if (details !== undefined) this.details = details;
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

// ---------------------------------------------------------------------------
// promote 入参白名单（RESEARCH-006.3 §4）
// ---------------------------------------------------------------------------

/**
 * `promote` 的 `overrides` **只**接受这两个键 —— 这是 006.3 §4 的全部覆盖面。
 *
 * 🔴 明确**不接受**调用方提交 `StrategyDefinition` / `strategyId` / `version` / `status`：
 * `StrategyDefinition` 只能由唯一的 `definitionBuild` 转换器从候选草稿生成（§4 末段 / §7）。
 * 允许覆盖即等于把「转正」变成「用 API 直接写策略」。
 */
export const PROMOTE_OVERRIDE_KEYS = ["datasetBinding", "datasetDivergenceReason"] as const;
export type PromoteOverrideKey = (typeof PROMOTE_OVERRIDE_KEYS)[number];

/** `overrides.datasetBinding` 允许的键（唯一坐标：`datasetVersionId`）。 */
export const PROMOTE_DATASET_BINDING_KEYS = ["datasetVersionId"] as const;

export function assertPromoteOverridesKeys(input: Record<string, unknown>): void {
  const offenders = Object.keys(input).filter(
    (key) => !(PROMOTE_OVERRIDE_KEYS as readonly string[]).includes(key) && input[key] !== undefined,
  );
  if (offenders.length > 0) {
    throw new StrategyCandidateError(
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
      `promote 的 overrides 只接受 ${PROMOTE_OVERRIDE_KEYS.join(" / ")}；以下被拒绝：${offenders.join("、")}`
        + "（StrategyDefinition 只能由 definitionBuild 从候选草稿生成，不接受调用方提交）",
    );
  }
  const binding = input.datasetBinding;
  if (binding !== undefined && binding !== null) {
    if (typeof binding !== "object" || Array.isArray(binding)) {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
        "overrides.datasetBinding 必须是对象，形如 { datasetVersionId: 390002 }",
      );
    }
    const bindingOffenders = Object.keys(binding as Record<string, unknown>).filter(
      (key) =>
        !(PROMOTE_DATASET_BINDING_KEYS as readonly string[]).includes(key)
        && (binding as Record<string, unknown>)[key] !== undefined,
    );
    if (bindingOffenders.length > 0) {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
        `overrides.datasetBinding 只接受 ${PROMOTE_DATASET_BINDING_KEYS.join(" / ")}；`
          + `以下被拒绝：${bindingOffenders.join("、")}`
          + "（唯一 Dataset 坐标是 dataset_version.id，不接受 datasetId + version / label / rd-* 等第二套坐标）",
      );
    }
  }
}
