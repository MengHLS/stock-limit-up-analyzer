/**
 * RESEARCH-006.1 — Research → Strategy 桥：**Strategy 侧溯源切面**的领域模型与错误码。
 *
 * 架构依据（唯一基准）：docs/research/RESEARCH-006.0-architecture.md §7.2 / §8 / §13.2 / §16。
 *
 * 定位铁律（防污染）：
 *   - 溯源是**独立切面**：`Strategy Version ─┬─ 5 张投影`
 *     `                                       └─ strategy_research_provenance`
 *     **不是** `strategy_versions` 的列，**更不是** `StrategyDocument.definition` 的字段；
 *   - **display-only**：不参与 `StrategyDefinition` / `StrategyDocument` / **执行语义指纹** /
 *     5 投影 / `validate` / `backtest` / 参数搜索 / 模拟 / 执行 —— 即 Research 模块整个不可用，
 *     Strategy Version 仍必须能独立运行；
 *     ⚠️ STRATEGY-RESEARCH-BRIDGE-001：研究证据另有**一个只属于自己的内容指纹**
 *     （`researchEvidenceFingerprint`，见 `./researchEvidence.ts` 文件头）。它与
 *     `strategy_versions.fingerprint`（执行语义指纹）**同名不同义**：前者是「这份溯源引用了
 *     哪些研究运行」的身份，后者是「这份执行语义是什么」的身份 —— 前者仍严格不进后者，
 *     也不被任何执行路径读取。
 *   - 所有 `sourceXxx` 是**快照值**（**不是 FK**）：上游行删除后仍能回答「这个策略从哪来」。
 *
 * 依赖方向（单向，禁环）：
 *   本模块（`server/research/strategyCandidate/`）是本项目**唯一**允许同时看见
 *   `researchCore` 与 `strategySchema|strategyPersistence` 的地方 —— 它就是桥本身。
 */

import { assertDeclaredResearchEvidence } from "./researchEvidence";

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/**
 * 溯源来源方式。
 *   - `DIRECT`：未来 `promote()` 由候选转正时**直接产出**；
 *   - `INHERITED`：未来 `cloneVersion()` 从源版本**继承**而来。
 *
 * ⚠️ 本 STEP（006.1）只落地字段与仓储能力，**不实现** promote / clone 的溯源写入。
 */
export const STRATEGY_RESEARCH_PROVENANCE_ORIGINS = ["DIRECT", "INHERITED"] as const;
export type StrategyResearchProvenanceOrigin =
  (typeof STRATEGY_RESEARCH_PROVENANCE_ORIGINS)[number];

// ---------------------------------------------------------------------------
// 领域对象
// ---------------------------------------------------------------------------

/**
 * 溯源**来源体系**（RESEARCH-EXPERIMENT-002）。
 *
 * 为什么需要它：`promote` 出来的策略可能来自两套体系，而这两套的**来源锚形状不同**：
 *
 *   - `RESEARCH_CONCLUSION`：旧 Research 链路（`Conclusion → Candidate → Strategy`）。
 *     来源锚是三个正整数 id（candidate / conclusion / experiment）。
 *   - `INDEPENDENT_EXPERIMENT`：独立实验体系（`Experiment Result → Strategy`）。
 *     独立实验**没有数据库行**（001 零新表），因此没有 `conclusionId` / `experimentId`
 *     可写；其身份是 `experimentRef` 字符串（`<group>/<key>`）。
 *     三个旧锚写 **NULL**，而不是伪造 0 / 哨兵 id。
 */
export const STRATEGY_RESEARCH_PROVENANCE_KINDS = [
  "RESEARCH_CONCLUSION",
  "INDEPENDENT_EXPERIMENT",
] as const;
export type StrategyResearchProvenanceKind =
  (typeof STRATEGY_RESEARCH_PROVENANCE_KINDS)[number];

/**
 * 一条 Strategy Version 的 Research 溯源快照。
 *
 * 冗余字段说明（`strategyId` / `strategyVersion`）：与 5 张投影表同风格，
 * 目的是「按策略直查」不必 JOIN `strategy_versions`。**冗余不等于第二真相** ——
 * 权威行锚永远是 `strategyVersionId`。
 */
export interface StrategyResearchProvenance {
  id?: number;
  /** 权威行锚 → `strategy_versions.id`（int，与投影表同型）。一版本最多一条（UNIQUE）。 */
  strategyVersionId: number;
  /** 冗余便于直查。 */
  strategyId: string;
  /** semver 冗余快照。 */
  strategyVersion: string;
  /**
   * 来源体系。缺省（历史行）按 `RESEARCH_CONCLUSION` 读取 —— 与 DB 默认值一致，
   * 因此既有 9 行无需 backfill。
   */
  sourceKind?: StrategyResearchProvenanceKind;
  /** 来源 `research_strategy_candidate.id`（快照值，非 FK）；**INDEPENDENT_EXPERIMENT 时为 null**。 */
  sourceCandidateId: number | null;
  /** 来源 `research_conclusion.id`（快照值，非 FK）；**INDEPENDENT_EXPERIMENT 时为 null**。 */
  sourceConclusionId: number | null;
  /** 来源 `research_experiment.id`（快照值，非 FK）；**INDEPENDENT_EXPERIMENT 时为 null**。 */
  sourceExperimentId: number | null;
  /** 来源 `research_run.id`；**可空**（Conclusion 无 runId 列，部分证据提不出，空值 = 如实承认）。 */
  sourceResearchRunId?: number | null;
  /** 研究**来源** Dataset 坐标快照 → `dataset_version.id`（与 Strategy 执行绑定可不同）。 */
  sourceDatasetVersionId?: number | null;
  /** 来源 label 快照（`v1` / `v2` / `rd-…`），**仅显示**；引用坐标是 `sourceDatasetVersionId`。 */
  sourceDatasetLabel?: string | null;
  /** `sourceTraceJson` 的副本（含免责声明摘要）。display-only。 */
  sourceSnapshotJson?: unknown;
  /** 独立实验 id（`<group>/<key>`）；仅 `INDEPENDENT_EXPERIMENT` 有值。 */
  experimentRef?: string | null;
  /** 实验自身版本（`descriptor.version`）快照。 */
  experimentVersion?: string | null;
  /** 生成该策略时**实际使用**的实验参数快照（已归并默认值；写入即冻结）。 */
  experimentParametersJson?: unknown;
  /** 实验结果的 canonical 指纹（sha256 前缀）—— 服务端**真实重跑**后算出，非调用方自报。 */
  experimentResultDigest?: string | null;
  origin: StrategyResearchProvenanceOrigin;
  createdAt?: string;
}

/** 创建入参：`id` / `createdAt` 由仓储负责；`origin` 缺省 `DIRECT`。 */
export type StrategyResearchProvenanceCreateInput = Omit<
  StrategyResearchProvenance,
  "id" | "createdAt" | "origin"
> & { origin?: StrategyResearchProvenanceOrigin };

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------

export const STRATEGY_PROVENANCE_ERROR = {
  /** 该 Strategy Version 已存在溯源行（`UNIQUE(strategyVersionId)`）。 */
  ALREADY_EXISTS: "STRATEGY_PROVENANCE_ALREADY_EXISTS",
  /** 指定的溯源行 / 版本不存在。 */
  NOT_FOUND: "STRATEGY_PROVENANCE_NOT_FOUND",
  /** 入参非法（id 非正整数 / 必填空串 / origin 非枚举值）。 */
  INVALID_INPUT: "STRATEGY_PROVENANCE_INVALID_INPUT",
} as const;

export type StrategyProvenanceErrorCode =
  (typeof STRATEGY_PROVENANCE_ERROR)[keyof typeof STRATEGY_PROVENANCE_ERROR];

export class StrategyProvenanceError extends Error {
  readonly code: StrategyProvenanceErrorCode;

  constructor(code: StrategyProvenanceErrorCode, message: string) {
    super(message);
    this.name = "StrategyProvenanceError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function requirePositiveInt(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new StrategyProvenanceError(
      STRATEGY_PROVENANCE_ERROR.INVALID_INPUT,
      `${field} 必须是正整数，实际：${String(value)}`,
    );
  }
  return value as number;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StrategyProvenanceError(
      STRATEGY_PROVENANCE_ERROR.INVALID_INPUT,
      `${field} 必须是非空字符串`,
    );
  }
  return value;
}

/**
 * 入参校验（DB / InMemory 共用，保证两个实现语义一致）。
 *
 * 🔴 不校验「上游是否仍存在」：`sourceXxx` 是快照值、**零 FK**，来源存活与否只能**读取时探测**
 * 并如实标注 —— 这正是「快照而非 FK」的全部价值（006.0 §8.3）。
 *
 * RESEARCH-EXPERIMENT-002 起按 **sourceKind** 分派必填面（缺省 = 旧体系，历史行为逐字不变）：
 *   - `RESEARCH_CONCLUSION`（缺省）：三个旧来源锚**必须**是正整数（与 002 之前完全一致）；
 *   - `INDEPENDENT_EXPERIMENT`：三个旧锚**必须为 null**（如实承认「没有旧 Research 坐标」，
 *     禁止用一个假 id 凑数），且 `experimentRef` / `experimentVersion` /
 *     `experimentResultDigest` 必须非空（否则这份溯源回答不了 §6 的任何一问）。
 */
export function assertProvenanceInput(input: StrategyResearchProvenanceCreateInput): void {
  requirePositiveInt(input.strategyVersionId, "strategyVersionId");
  requireNonEmptyString(input.strategyId, "strategyId");
  requireNonEmptyString(input.strategyVersion, "strategyVersion");

  const kind: StrategyResearchProvenanceKind = input.sourceKind ?? "RESEARCH_CONCLUSION";
  if (!STRATEGY_RESEARCH_PROVENANCE_KINDS.includes(kind)) {
    throw new StrategyProvenanceError(
      STRATEGY_PROVENANCE_ERROR.INVALID_INPUT,
      `sourceKind 只能是 ${STRATEGY_RESEARCH_PROVENANCE_KINDS.join(" / ")}，实际：${String(kind)}`,
    );
  }

  if (kind === "RESEARCH_CONCLUSION") {
    requirePositiveInt(input.sourceCandidateId, "sourceCandidateId");
    requirePositiveInt(input.sourceConclusionId, "sourceConclusionId");
    requirePositiveInt(input.sourceExperimentId, "sourceExperimentId");
  } else {
    for (const field of ["sourceCandidateId", "sourceConclusionId", "sourceExperimentId"] as const) {
      const value = input[field];
      if (value !== null && value !== undefined) {
        throw new StrategyProvenanceError(
          STRATEGY_PROVENANCE_ERROR.INVALID_INPUT,
          `sourceKind=INDEPENDENT_EXPERIMENT 时 ${field} 必须为 null（独立实验没有旧 Research 坐标，`
            + `不得用假 id 凑数），实际：${String(value)}`,
        );
      }
    }
    requireNonEmptyString(input.experimentRef, "experimentRef");
    requireNonEmptyString(input.experimentVersion, "experimentVersion");
    requireNonEmptyString(input.experimentResultDigest, "experimentResultDigest");
    if (input.experimentParametersJson === undefined || input.experimentParametersJson === null) {
      throw new StrategyProvenanceError(
        STRATEGY_PROVENANCE_ERROR.INVALID_INPUT,
        "sourceKind=INDEPENDENT_EXPERIMENT 时必须给 experimentParametersJson（否则「用了什么参数」无从回答）",
      );
    }
  }

  if (input.sourceResearchRunId !== null && input.sourceResearchRunId !== undefined) {
    requirePositiveInt(input.sourceResearchRunId, "sourceResearchRunId");
  }
  if (input.sourceDatasetVersionId !== null && input.sourceDatasetVersionId !== undefined) {
    requirePositiveInt(input.sourceDatasetVersionId, "sourceDatasetVersionId");
  }
  if (input.sourceDatasetLabel !== null && input.sourceDatasetLabel !== undefined) {
    requireNonEmptyString(input.sourceDatasetLabel, "sourceDatasetLabel");
  }
  if (input.origin !== undefined && !STRATEGY_RESEARCH_PROVENANCE_ORIGINS.includes(input.origin)) {
    throw new StrategyProvenanceError(
      STRATEGY_PROVENANCE_ERROR.INVALID_INPUT,
      `origin 只能是 ${STRATEGY_RESEARCH_PROVENANCE_ORIGINS.join(" / ")}，实际：${String(input.origin)}`,
    );
  }

  /**
   * STRATEGY-RESEARCH-BRIDGE-001 —— 研究证据段的**声明即受校验**。
   *
   * 语义刻意是「声明了就受校验」而不是「必须声明」：
   *   - 历史行 / 非证据型溯源（如旧 `RESEARCH_CONCLUSION`）不带 `researchEvidences` ⇒ **逐字不变**；
   *   - 一旦带上（`buildResearchEvidenceSnapshot` 的产物）⇒ 列表非空、每条形态合法、
   *     且 `researchEvidenceFingerprint` 必须与列表**自洽**（否则就是「声明与事实不符」）。
   *
   * `ResearchEvidenceError` 在这里翻译成**本层唯一**的领域错误码 ——
   * 调用方只需要认识 `StrategyProvenanceError` 一套（与 006.3 在桥里翻译 Dataset Binding 错误同纪律）。
   */
  try {
    assertDeclaredResearchEvidence(input.sourceSnapshotJson);
  } catch (error) {
    throw new StrategyProvenanceError(
      STRATEGY_PROVENANCE_ERROR.INVALID_INPUT,
      `sourceSnapshotJson 的研究证据段不合法：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 仓储契约
// ---------------------------------------------------------------------------

/**
 * 溯源仓储。
 *
 * 能力范围（006.0 §12 / §18）：只提供 `create` / 读取 / 删除；**不提供任何 update**
 * —— 溯源是历史事实快照，可改即伪造历史。
 *
 * ⚠️ 未来 `promote` 需要的「幂等闸门」由此处的 `getBySourceCandidateId` 提供
 *    （已产出过策略的候选不得再产第二份）；`cloneVersion` 需要的继承由调用方
 *    读取源版本 provenance 后 `create({ origin: "INHERITED" })` 完成。
 *    **本 STEP 不实现 promote / clone**。
 */
export interface StrategyResearchProvenanceRepository {
  /** 写入一条溯源。同 `strategyVersionId` 重复写入 → `ALREADY_EXISTS`（UNIQUE 兜底）。 */
  create(input: StrategyResearchProvenanceCreateInput): Promise<StrategyResearchProvenance>;
  getByStrategyVersionId(
    strategyVersionId: number,
  ): Promise<StrategyResearchProvenance | undefined>;
  /** 某策略全部版本的溯源（按 strategyVersionId 升序）。 */
  listByStrategyId(strategyId: string): Promise<StrategyResearchProvenance[]>;
  /** promote 幂等闸门：该候选是否已产出过溯源行。 */
  getBySourceCandidateId(
    sourceCandidateId: number,
  ): Promise<StrategyResearchProvenance | undefined>;
  /**
   * 删除某策略的全部溯源。**非级联**：由未来 `deleteStrategy` 的应用层入口**显式同事务调用**
   * （全库零 FK，DB 不会替我们做这件事）。返回删除行数。
   */
  deleteByStrategyId(strategyId: string): Promise<number>;
  /** 删除某版本的溯源（不存在即 `NOT_FOUND`）。 */
  deleteByStrategyVersionId(strategyVersionId: number): Promise<void>;
}
