/**
 * RESEARCH-006.1 — Research → Strategy 桥：**Strategy 侧溯源切面**的领域模型与错误码。
 *
 * 架构依据（唯一基准）：docs/research/RESEARCH-006.0-architecture.md §7.2 / §8 / §13.2 / §16。
 *
 * 定位铁律（防污染）：
 *   - 溯源是**独立切面**：`Strategy Version ─┬─ 5 张投影`
 *     `                                       └─ strategy_research_provenance`
 *     **不是** `strategy_versions` 的列，**更不是** `StrategyDocument.definition` 的字段；
 *   - **display-only**：不参与 `StrategyDefinition` / `StrategyDocument` / 指纹 / 5 投影 /
 *     `validate` / `backtest` / 参数搜索 / 模拟 / 执行 —— 即 Research 模块整个不可用，
 *     Strategy Version 仍必须能独立运行；
 *   - 所有 `sourceXxx` 是**快照值**（**不是 FK**）：上游行删除后仍能回答「这个策略从哪来」。
 *
 * 依赖方向（单向，禁环）：
 *   本模块（`server/research/strategyCandidate/`）是本项目**唯一**允许同时看见
 *   `researchCore` 与 `strategySchema|strategyPersistence` 的地方 —— 它就是桥本身。
 */

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
  /** 来源 `research_strategy_candidate.id`（快照值，非 FK）。 */
  sourceCandidateId: number;
  /** 来源 `research_conclusion.id`（快照值，非 FK）。 */
  sourceConclusionId: number;
  /** 来源 `research_experiment.id`（快照值，非 FK）。 */
  sourceExperimentId: number;
  /** 来源 `research_run.id`；**可空**（Conclusion 无 runId 列，部分证据提不出，空值 = 如实承认）。 */
  sourceResearchRunId?: number | null;
  /** 研究**来源** Dataset 坐标快照 → `dataset_version.id`（与 Strategy 执行绑定可不同）。 */
  sourceDatasetVersionId?: number | null;
  /** 来源 label 快照（`v1` / `v2` / `rd-…`），**仅显示**；引用坐标是 `sourceDatasetVersionId`。 */
  sourceDatasetLabel?: string | null;
  /** `sourceTraceJson` 的副本（含免责声明摘要）。display-only。 */
  sourceSnapshotJson?: unknown;
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
 */
export function assertProvenanceInput(input: StrategyResearchProvenanceCreateInput): void {
  requirePositiveInt(input.strategyVersionId, "strategyVersionId");
  requireNonEmptyString(input.strategyId, "strategyId");
  requireNonEmptyString(input.strategyVersion, "strategyVersion");
  requirePositiveInt(input.sourceCandidateId, "sourceCandidateId");
  requirePositiveInt(input.sourceConclusionId, "sourceConclusionId");
  requirePositiveInt(input.sourceExperimentId, "sourceExperimentId");
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
