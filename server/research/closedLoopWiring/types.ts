/**
 * 闭环装配层（closedLoopWiring）— 类型权威源。
 *
 * 解决的问题：`server/research/closedLoop/` 是**注入式**编排骨架，14 个阶段全部靠
 * `request.stageRunners` 注入执行器；而生产代码里**一个执行器都没注入**，于是
 * `server/researchRunRouter.ts` 只能硬编码 `executorBound = false`。本层的职责就是
 * 把「哪些阶段真的能跑、靠什么真实入参跑」变成**可计算、可验证**的事实。
 *
 * 三条设计纪律：
 *   1. **不猜不造**：本层不构造任何模拟数据；每个执行器只调用真实模块，入参由调用方
 *      提供（`ClosedLoopWiringInputs`）。缺入参 → **不注册执行器**（让编排器如实发出
 *      `CL_RUNNER_NOT_INJECTED`），而不是塞一个占位实现。
 *   2. **不读 DB**：本层零 IO。`data` 阶段吃的是调用方注入的 `ResearchDataset`；本层
 *      不去 `research_datasets` / `ds_*` 里捞数据（避免与 Dataset 侧产生隐式耦合）。
 *   3. **重对象走旁路**：交接摘要（handoff）按 §27 只携带 ref/指纹/摘要，rows 级大对象
 *      经由**每次运行的产物旁路**（`ClosedLoopWiringArtifacts`）在阶段间传递。
 *
 * 命名纪律：全部顶层符号带 ClosedLoop / CLOSED_LOOP_ / CL_ 域前缀（ROADMAP §49）。
 * 本层不 import `server/research/index.ts`（ESM 循环），只按目录精确 import。
 */

import type { EquityPoint, Trade } from "../../backtest/types";
import type { ResearchDataset } from "../../researchDataset/types";
import type { ExperimentConfig, StrategyContract } from "../framework/contract";
import type { CandidateEvaluationRun, Strategy13 } from "../signalEngine/types";
import type { SimulationConfig, TradeSimulationRun } from "../simulator/types";
import type {
  StrategyDocument,
  StrategyDocumentInput,
  StrategyVersionRecord,
} from "../strategySchema/types";
import type { StrategyVersionRecordInput } from "../strategySchema/map";
import type { ClosedLoopBlockedReasonCode } from "../closedLoop/blockers";
import type { ClosedLoopLifecycleConfig, ClosedLoopStageId } from "../closedLoop/types";

// ---------------------------------------------------------------------------
// 真实入参（全部可选：缺失即「该阶段未覆盖」，不再靠硬编码布尔冒充）
// ---------------------------------------------------------------------------

/**
 * evaluation 阶段的直供评估输入。
 *
 * 两个来源二选一，**都必须是真实数据**：
 *   - `backtest` 阶段已在同一链内执行 → 直接复用其真实 `TradeSimulationRun`（首选）；
 *   - 该链不含 `backtest`（subset 链）→ 由调用方给出真实的权益曲线与交易清单。
 */
export interface ClosedLoopEvaluationWiringInput {
  /**
   * **必填**：这条曲线所来自的**真实**回测的内容指纹（`TradeSimulationRun.fingerprint`）。
   *
   * 为什么必填：`evaluationRef` 契约要求 `backtestFingerprint` 非空（`guards.ts:212`），
   * 语义是「评估结果必须可追溯到被评的那次回测」。允许匿名曲线等于允许评估结果与实际
   * 回测脱钩——因此这里**强制调用方声明来源指纹**，不提供缺省值。
   */
  readonly backtestFingerprint: string;
  /** 逐模拟交易日收盘权益点（升序，每点一个交易日）。 */
  readonly equityCurve: readonly EquityPoint[];
  /** 全部交易生命周期（可省略；省略时交易质量组为 null）。 */
  readonly trades?: readonly Trade[];
  /** 年化交易日数（默认由模块自身决定 = 252）。 */
  readonly annualizationFactor?: number;
  /** 回撤剖面过滤阈值（%，C-16.1 用）。 */
  readonly drawdownThresholdPct?: number;
  /** 下行偏差目标日收益（小数，C-16.1/16.2 用）。 */
  readonly downsideTarget?: number;
  /** 无风险年利率（%，C-16.2 用）。 */
  readonly rfAnnualPct?: number;
}

/** 装配层可接受的全部真实入参（按阶段分组；全部可选）。 */
export interface ClosedLoopWiringInputs {
  /** **data**：真实 ResearchDataset（调用方注入；本层不读 DB/不构建）。 */
  readonly researchDataset?: ResearchDataset;

  /** **research**：完整实验配置。 */
  readonly experimentConfig?: ExperimentConfig;
  /** **research**：完整策略契约（身份须与 experimentConfig 一致）。 */
  readonly strategyContract?: StrategyContract;
  /** **research**：C-13.2 最小策略配方（决策时点 + 特征 + 信号 + 排序 + 选择）。 */
  readonly strategy13?: Strategy13;

  /** **strategy**：策略本体声明（喂给 `createStrategyDocument` 的真实入参）。 */
  readonly strategyDocumentInput?: StrategyDocumentInput;
  /** **strategy**（可选）：§17 版本记录输入；提供后才产出 `versionRecordFingerprint`。 */
  readonly strategyVersionRecordInput?: StrategyVersionRecordInput;

  /** **backtest**：交易模拟执行配置（数据集与候选运行来自同链上游的真实产物）。 */
  readonly simulationConfig?: SimulationConfig;

  /** **evaluation**：直供评估输入（未提供时用同链 `backtest` 的真实产物）。 */
  readonly evaluationInput?: ClosedLoopEvaluationWiringInput;

  /**
   * **finalize**：生命周期推进配置。
   *
   * 提供后由**编排器内置路径**完成（`closedLoop/orchestrator.ts` 在
   * `runner.finalize === undefined && request.lifecycle !== undefined` 时走
   * `attemptClosedLoopLifecycleAdvance`），因此本层**不需要**为 finalize 注册执行器；
   * 但覆盖率仍要如实要求该配置存在——否则编排器会以 `CL_LIFECYCLE_CONFIG_MISSING` 阻塞。
   */
  readonly lifecycle?: ClosedLoopLifecycleConfig;
}

// ---------------------------------------------------------------------------
// 运行期产物旁路（阶段间传递 rows 级重对象；不进 run 指纹）
// ---------------------------------------------------------------------------

/** 旁路中可存放的重对象（每项至多一个来源阶段）。 */
export interface ClosedLoopWiringArtifactByKey {
  readonly dataset: ResearchDataset;
  readonly candidateRun: CandidateEvaluationRun;
  readonly strategyDocument: StrategyDocument;
  readonly strategyVersionRecord: StrategyVersionRecord;
  readonly tradeSimulationRun: TradeSimulationRun;
}

/** 产物键。 */
export type ClosedLoopWiringArtifactKey = keyof ClosedLoopWiringArtifactByKey;

/** 产物 → 唯一产生阶段（覆盖率据此判断「上游是否在链内且已覆盖」）。 */
export const CLOSED_LOOP_ARTIFACT_PRODUCER: Readonly<
  Record<ClosedLoopWiringArtifactKey, ClosedLoopStageId>
> = {
  dataset: "data",
  candidateRun: "research",
  strategyDocument: "strategy",
  strategyVersionRecord: "strategy",
  tradeSimulationRun: "backtest",
};

/**
 * 每次运行的产物旁路（可变容器）。
 *
 * 为什么可变：阶段按序推进，后一阶段需要前一阶段的**完整产物**；而 §27 明确禁止把
 * rows 级对象塞进交接摘要。旁路是「编排器之外的执行上下文」，不参与 run 指纹，
 * 因此可变不破坏确定性（同一批入参 → 同一批产物 → 同一指纹）。
 */
export interface ClosedLoopWiringArtifacts {
  dataset?: ResearchDataset;
  candidateRun?: CandidateEvaluationRun;
  strategyDocument?: StrategyDocument;
  strategyVersionRecord?: StrategyVersionRecord;
  tradeSimulationRun?: TradeSimulationRun;
}

/** 新建一份空产物旁路。 */
export function createClosedLoopWiringArtifacts(): ClosedLoopWiringArtifacts {
  return {};
}

// ---------------------------------------------------------------------------
// 阶段装配声明
// ---------------------------------------------------------------------------

/** 单个阶段的装配声明（声明式；覆盖率与执行器注册都以它为准）。 */
export interface ClosedLoopStageWiringRequirement {
  readonly stageId: ClosedLoopStageId;
  /** 绑定的真实模块（人类可读；与 `spec.ts#moduleBindings` 对齐）。 */
  readonly module: string;
  /**
   * 入参来源（**来源之间取 OR；来源内部的 inputs 与 artifacts 同时都要满足**）。
   *
   * 用它而不是给个别阶段写特判，是因为 evaluation 确实有两条合法路径（同链 backtest 的真实
   * 产物 / 调用方直供的曲线），而 research、backtest 这类阶段则是「自己的配置 + 上游产物」
   * **同时**需要 —— 后者若误用 OR，就会在自己配置还没给的情况下被注册执行器，把「缺配置」
   * 伪装成「执行失败」。
   */
  readonly satisfyVia: readonly ClosedLoopInputSource[];
  /** 本层调用的真实入口（`函数名` 或 `文件:行`，仅文档用途，不参与运行）。 */
  readonly entryPoints: readonly string[];
  /** 是否已装配真实执行器。false = 覆盖率恒为未覆盖（理由见 `notWiredReason`）。 */
  readonly wired: boolean;
  /** 未装配的确切原因（`wired=false` 时必填，禁止含糊）。 */
  readonly notWiredReason: string | null;
}

/**
 * 一条入参来源：**来源内所有列出的 inputs 与 artifacts 必须同时齐备**。
 *
 * 两条来源之间是 OR（任一成立即视为该阶段入参齐备）。
 */
export interface ClosedLoopInputSource {
  /** 需要的调用方真实入参（AND 语义）。 */
  readonly inputs?: readonly (keyof ClosedLoopWiringInputs)[];
  /** 需要的同链上游产物（AND 语义）。 */
  readonly artifacts?: readonly ClosedLoopWiringArtifactKey[];
}

// ---------------------------------------------------------------------------
// 覆盖率（取代硬编码 executorBound）
// ---------------------------------------------------------------------------

/** 单阶段覆盖判定。 */
export interface ClosedLoopStageCoverage {
  readonly stageId: ClosedLoopStageId;
  readonly module: string;
  /** 是否已装配真实执行器。 */
  readonly wired: boolean;
  /** 入参是否齐备（存在至少一个成立且上游产物可得的来源）。 */
  readonly inputsSatisfied: boolean;
  /** 成立的来源描述（如 `input:evaluationInput` / `artifact:tradeSimulationRun`）；未成立为 null。 */
  readonly satisfiedBy: string | null;
  /** 缺哪些**调用方入参**（键名；空 = 该维度齐备）。 */
  readonly missingInputs: readonly string[];
  /** 缺哪些**上游产物**（键名；空 = 该维度齐备）。 */
  readonly missingArtifacts: readonly string[];
  /** 最终是否覆盖（= wired ∧ 入参齐备）。 */
  readonly covered: boolean;
  /** 未覆盖时编排器会发出的 reasonCode（覆盖时为 null）。 */
  readonly blockedReasonCode: ClosedLoopBlockedReasonCode | null;
  /** 未覆盖原因（人类可读；覆盖时为 null）。 */
  readonly note: string | null;
}

/** 一次覆盖率评估结果。 */
export interface ClosedLoopWiringCoverage {
  /** 被请求的阶段（canonical 保序）。 */
  readonly requested: readonly ClosedLoopStageId[];
  readonly stages: readonly ClosedLoopStageCoverage[];
  readonly coveredStages: readonly ClosedLoopStageId[];
  readonly uncoveredStages: readonly ClosedLoopStageId[];
  /**
   * **可执行的装配探测结果**：被请求阶段是否**全部**覆盖。
   *
   * 这是 `executorBound` 的真实取值——它随「请求的阶段集 + 调用方真实入参」变化，
   * 而不是一个写死的常量。
   */
  readonly executorBound: boolean;
}
