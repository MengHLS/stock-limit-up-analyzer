/**
 * STEP 25 / C-25.1 — Closed Loop（Production Quant Platform 全链编排）：类型权威源。
 *
 * 实例化 ROADMAP §27 闭环形状：
 *
 *   Data → Research → Strategy → Backtest → Evaluation → Optimization → Robustness
 *     → OOS → Overfitting → Regime → Paper Trading → Review → Discipline（+ 可选 finalize）
 *
 * 设计哲学（编排骨架 + 契约 + 注入式执行器 + 状态机 + 审计）：
 *   - 编排器不实现任何阶段算法；每阶段执行器由调用方注入
 *     `(ctx, stageInput) => stageOutput`（参照 C-19.1/C-20.1 evaluator 注入范式）。
 *   - 阶段间以「版本化交接摘要（handoff）」流转，rows 级大对象不经编排器；
 *     ref 只携带来源模块 runId/指纹/关键结论。
 *   - 阶段状态机：READY（就绪未执行）/ EXECUTED / BLOCKED（+ reasonCode）/ SKIPPED（未被请求）。
 *   - PIT 安全：asOf===tradeDate 不变量由各阶段模块保证；本层只流转不计算，不引入未来信息。
 *   - 确定性：createdAt / runId 由调用方注入，纯函数 + readonly，无 Date.now/Math.random/IO。
 *   - 诚实边界：真实数据不可用 → BLOCKED（CL_DATA_NOT_INJECTED / CL_DATASET_GATE_NOT_PASS）；
 *     无证据 → 生命周期不推进（CL_GATE_EVIDENCE_MISSING）；合成产物打 synthetic:true。
 *
 * 命名纪律：全部顶层符号带 ClosedLoop / CLOSED_LOOP_ / CL_ 域前缀（§49；先全库查重零冲突）。
 * 本目录新建文件不改任何既有文件；不 import server/research/index.ts（ESM 循环）。
 */

import type { CostModel } from "../../engine/domain";
import type { ResearchParameterSet } from "../types";
import type { ExperimentLineageRecord } from "../experimentLineage/types";
import type { ClosedLoopBlockedReasonCode } from "./blockers";

// ---------------------------------------------------------------------------
// 阶段链常量
// ---------------------------------------------------------------------------

/** §27 闭环 14 阶段（13 核心 + 可选 finalize），canonical 拓扑顺序（严禁重排）。 */
export const CLOSED_LOOP_STAGE_IDS = [
  "data",
  "research",
  "strategy",
  "backtest",
  "evaluation",
  "optimization",
  "robustness",
  "oos",
  "overfitting",
  "regime",
  "paper",
  "review",
  "discipline",
  "finalize",
] as const;

/** 阶段 id 类型。 */
export type ClosedLoopStageId = (typeof CLOSED_LOOP_STAGE_IDS)[number];

/** 是否为合法阶段 id。 */
export function isClosedLoopStageId(value: string): value is ClosedLoopStageId {
  return (CLOSED_LOOP_STAGE_IDS as readonly string[]).includes(value);
}

/** canonical 阶段序号（id → index；非法值返回 null）。 */
export function closedLoopStageIndex(stageId: ClosedLoopStageId): number {
  return CLOSED_LOOP_STAGE_IDS.indexOf(stageId);
}

// ---------------------------------------------------------------------------
// 阶段状态机
// ---------------------------------------------------------------------------

/**
 * 阶段状态机（§7 之外的阶段粒度状态；BLOCKED_* 以 reasonCode 细分，见 blockers.ts）：
 *   - READY    ：阶段已被请求、前驱已过，尚未执行（编排器内部过渡态；终态 run 不保留）；
 *   - EXECUTED ：执行器成功运行，产出交接摘要（source ref + 结论）；
 *   - BLOCKED  ：因数据未注入 / gate 未 PASS / runner 未注入 / 输入缺失 / 上游阻塞等
 *                显式阻塞（携带 reasonCode；合法判定，不抛错）；
 *   - SKIPPED  ：阶段未被请求（subset 链）；在 run 记录中保留以完整呈现 §27 形状。
 */
export const CLOSED_LOOP_STAGE_STATES = ["READY", "EXECUTED", "BLOCKED", "SKIPPED"] as const;

/** 阶段状态。 */
export type ClosedLoopStageState = (typeof CLOSED_LOOP_STAGE_STATES)[number];

// ---------------------------------------------------------------------------
// 记录书签常量
// ---------------------------------------------------------------------------

/** 记录种类标签。 */
export const CLOSED_LOOP_RUN_RECORD_KIND = "CLOSED_LOOP_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增。 */
export const CLOSED_LOOP_RUN_RECORD_VERSION = 1 as const;

/** handoff 交接 schema 版本。 */
export const CLOSED_LOOP_HANDOFF_VERSION = 1 as const;

/** 阶段 run id 派生分隔符（runId + sep + stageId）。 */
export const CLOSED_LOOP_STAGE_RUN_SEP = "::" as const;

// ---------------------------------------------------------------------------
// 交接摘要（handoff）kind 常量
// ---------------------------------------------------------------------------

/** 每阶段产出的交接 kind（与阶段一一对应）。 */
export const CLOSED_LOOP_HANDOFF_KINDS = [
  "datasetSummary",
  "researchSummary",
  "strategyDocRef",
  "backtestSummary",
  "evaluationRef",
  "optimizationRef",
  "robustnessRef",
  "oosRef",
  "overfittingRef",
  "regimeRef",
  "paperRef",
  "reviewRef",
  "disciplineRef",
  "finalizeRef",
] as const;

/** 交接 kind 类型。 */
export type ClosedLoopHandoffKind = (typeof CLOSED_LOOP_HANDOFF_KINDS)[number];

/** 阶段 → 其产出的交接 kind。 */
export const CLOSED_LOOP_STAGE_PRODUCED_KIND: Readonly<Record<ClosedLoopStageId, ClosedLoopHandoffKind>> = {
  data: "datasetSummary",
  research: "researchSummary",
  strategy: "strategyDocRef",
  backtest: "backtestSummary",
  evaluation: "evaluationRef",
  optimization: "optimizationRef",
  robustness: "robustnessRef",
  oos: "oosRef",
  overfitting: "overfittingRef",
  regime: "regimeRef",
  paper: "paperRef",
  review: "reviewRef",
  discipline: "disciplineRef",
  finalize: "finalizeRef",
};

/**
 * 阶段 → 其消费的交接 kind（= canonical 前驱阶段的产出）。
 * data 无前驱（消费 null）。可用于 subset 链 seed 校验与输入解析。
 */
export const CLOSED_LOOP_STAGE_CONSUMED_KIND: Readonly<
  Record<ClosedLoopStageId, ClosedLoopHandoffKind | null>
> = {
  data: null,
  research: "datasetSummary",
  strategy: "researchSummary",
  backtest: "strategyDocRef",
  evaluation: "backtestSummary",
  optimization: "evaluationRef",
  robustness: "optimizationRef",
  oos: "robustnessRef",
  overfitting: "oosRef",
  regime: "overfittingRef",
  paper: "regimeRef",
  review: "paperRef",
  discipline: "reviewRef",
  finalize: "disciplineRef",
};

/** 交接 kind → 其产生阶段。 */
export function closedLoopProducerOfKind(kind: ClosedLoopHandoffKind): ClosedLoopStageId {
  for (const stageId of CLOSED_LOOP_STAGE_IDS) {
    if (CLOSED_LOOP_STAGE_PRODUCED_KIND[stageId] === kind) return stageId;
  }
  throw new Error(`closedLoop: 非法交接 kind ${String(kind)}（无对应产生阶段）`);
}

/** 交接 kind → 其消费者（canonical 下一阶段；finalizeRef 无后继 → null）。 */
export function closedLoopConsumerOfKind(kind: ClosedLoopHandoffKind): ClosedLoopStageId | null {
  for (const stageId of CLOSED_LOOP_STAGE_IDS) {
    if (CLOSED_LOOP_STAGE_CONSUMED_KIND[stageId] === kind) return stageId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 来源引用（handoff 的 ref：runId/指纹/来源模块）
// ---------------------------------------------------------------------------

/**
 * 交接的来源模块 run 引用（「引用 + 摘要」流转的核心；rows 级对象不经编排器）。
 * runId 可空：C-14.1/16.x 等多条记录为内容寻址（无独立 runId，身份 = fingerprint）。
 */
export interface ClosedLoopSourceRef {
  /** 来源模块语义名（如 "simulator"/"performanceMetrics"；人类可读）。 */
  readonly module: string;
  /** 来源模块记录 kind（如 "TRADE_SIMULATION_RUN"；无则 null）。 */
  readonly moduleRunKind: string | null;
  /** 来源模块 run id（内容寻址记录可空）。 */
  readonly runId: string | null;
  /** 来源记录内容指纹（sha256 hex 或 null）。 */
  readonly fingerprint: string | null;
}

// ---------------------------------------------------------------------------
// 交接摘要 base
// ---------------------------------------------------------------------------

/** handoff 公共信封（判别联合靠 kind）。 */
export interface ClosedLoopHandoffBase {
  /** 交接 kind（判别字段）。 */
  readonly kind: ClosedLoopHandoffKind;
  /** 交接 schema 版本（语义变更递增）。 */
  readonly handoffVersion: typeof CLOSED_LOOP_HANDOFF_VERSION;
  /**
   * 合成产物标记：true = 该交接来自合成/注入 evaluator 或合成数据，**不得与真实
   * 结论混淆**。编排器聚合 run.synthetic = 任一已执行交接 synthetic。
   */
  readonly synthetic: boolean;
  /** 来源模块 run 引用。 */
  readonly source: ClosedLoopSourceRef;
}

// ---------------------------------------------------------------------------
// 各阶段交接摘要（结构化、版本化、字段与来源模块 run 摘要对齐）
// ---------------------------------------------------------------------------

/** 通用日期窗口（闭区间）。 */
export interface ClosedLoopDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

/** datasetGate 值域（对齐 C-12.6 gate）。 */
export type ClosedLoopDatasetGate = "PASS" | "FAIL" | "INCONCLUSIVE";

/** data → 产出 datasetSummary（复用 researchDataset builder 摘要语义）。 */
export interface ClosedLoopDatasetSummary extends ClosedLoopHandoffBase {
  readonly kind: "datasetSummary";
  /** 内容寻址数据集版本（rd-…；gate=PASS 时必填）。 */
  readonly datasetVersion: string | null;
  /** 数据集 gate（PASS 才允许下游研究结论）。 */
  readonly gate: ClosedLoopDatasetGate;
  readonly dateRange: ClosedLoopDateRange | null;
  /** 构建器 / schema 版本（自描述；未构建为 null）。 */
  readonly builderVersion: string | null;
  readonly rowSchemaVersion: string | null;
  readonly rowCount: number | null;
  readonly universeCount: number | null;
  /** 覆盖缺口清单（C-12.6 coverageGaps 语义；空数组 = 无缺口声明）。 */
  readonly coverageGaps: readonly string[];
}

/** research → 产出 researchSummary（C-13.2 signalEngine 候选运行摘要）。 */
export interface ClosedLoopResearchSummary extends ClosedLoopHandoffBase {
  readonly kind: "researchSummary";
  /** 消费的 datasetVersion（镜像上游；下游校验防串库）。 */
  readonly datasetVersion: string | null;
  /** C-13.2 CandidateEvaluationRun 内容指纹（内容寻址）。 */
  readonly candidateRunFingerprint: string | null;
  readonly evaluated: {
    readonly candidateCount: number;
    readonly decisionDateRange: ClosedLoopDateRange | null;
  };
  readonly notes: readonly string[];
}

/** strategy → 产出 strategyDocRef（C-15.1 StrategyDocument 规则壳引用）。 */
export interface ClosedLoopStrategyDocRef extends ClosedLoopHandoffBase {
  readonly kind: "strategyDocRef";
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 策略本体指纹（C-15.1 serialize fingerprint）。 */
  readonly docFingerprint: string;
  /** §17 版本追溯记录指纹（生命周期壳绑定用；可空 = 尚未建版本记录）。 */
  readonly versionRecordFingerprint: string | null;
  readonly rules: {
    readonly entryRuleCount: number;
    readonly exitRuleCount: number;
    readonly sizingRuleCount: number;
    readonly riskRuleCount: number;
  };
}

/** backtest → 产出 backtestSummary（复用 C-14.1 TradeSimulationRun 摘要字段）。 */
export interface ClosedLoopBacktestSummary extends ClosedLoopHandoffBase {
  readonly kind: "backtestSummary";
  readonly datasetVersion: string;
  readonly datasetGate: string;
  readonly dateRange: ClosedLoopDateRange;
  readonly initialCapital: number;
  readonly finalEquity: number;
  readonly decisionDayCount: number;
  readonly equityCurvePointCount: number;
  readonly tradeCount: number;
}

/** evaluation → 产出 evaluationRef（C-16.1/16.2/16.3 记录引用 + 标量结论，不重算）。 */
export interface ClosedLoopEvaluationRef extends ClosedLoopHandoffBase {
  readonly kind: "evaluationRef";
  readonly backtestFingerprint: string;
  readonly performance: {
    readonly fingerprint: string | null;
    readonly inputFingerprint: string | null;
    readonly totalReturnPct: number | null;
    readonly cagrPct: number | null;
    readonly maxDrawdownPct: number | null;
  } | null;
  readonly riskAdjusted: {
    readonly fingerprint: string | null;
    readonly sharpeRatio: number | null;
    readonly sortinoRatio: number | null;
    readonly calmarRatio: number | null;
  } | null;
  readonly tradeQuality: {
    readonly fingerprint: string | null;
    readonly winRatePct: number | null;
    readonly profitFactor: number | null;
    readonly completedTradeCount: number | null;
  } | null;
  /** 已覆盖的评估器清单（"performanceMetrics" 等）。 */
  readonly evaluatorsCovered: readonly string[];
}

/** optimization → 产出 optimizationRef（C-17.1/C-17.2 搜索/滚动候选摘要）。 */
export interface ClosedLoopOptimizationRef extends ClosedLoopHandoffBase {
  readonly kind: "optimizationRef";
  readonly method: "grid" | "random" | "rolling";
  /** 候选策略参数键（跨窗稳定区；显式非 argmax 语义）。 */
  readonly candidateParameterKeys: readonly string[];
  readonly evaluatedCandidateCount: number | null;
  readonly consistency: {
    readonly status: "candidate" | "degraded" | "noStableRegion";
    readonly note: string;
  };
}

/** robustness → 产出 robustnessRef（C-18.1/C-18.2 扰动重估轴级结论）。 */
export interface ClosedLoopRobustnessRef extends ClosedLoopHandoffBase {
  readonly kind: "robustnessRef";
  readonly axes: readonly {
    readonly axis: string;
    readonly verdict: "stable" | "sensitive" | "unassessed";
    readonly driftNotes: readonly string[];
  }[];
}

/** oos → 产出 oosRef（C-19.1/C-19.2 WFO/OOS 隔离摘要）。 */
export interface ClosedLoopOosRef extends ClosedLoopHandoffBase {
  readonly kind: "oosRef";
  readonly windows: readonly {
    readonly windowId: string;
    readonly train: ClosedLoopDateRange;
    readonly test: ClosedLoopDateRange;
  }[];
  readonly oosMetrics: {
    readonly totalReturnPct: number | null;
    readonly maxDrawdownPct: number | null;
  } | null;
}

/** overfitting → 产出 overfittingRef（C-20.1/C-20.2 PBO/敏感性/消融结论）。 */
export interface ClosedLoopOverfittingRef extends ClosedLoopHandoffBase {
  readonly kind: "overfittingRef";
  readonly pbo: {
    readonly pboValue: number | null;
    readonly verdict: string;
  } | null;
  readonly conclusion: {
    readonly verdict: string;
    readonly reasonCode: string;
  };
}

/** regime → 产出 regimeRef（C-22.1 market regime 标签摘要）。 */
export interface ClosedLoopRegimeRef extends ClosedLoopHandoffBase {
  readonly kind: "regimeRef";
  readonly coverage: {
    readonly assessedDayCount: number;
    readonly unassessedDayCount: number;
  };
  /** 复合状态逐标签天数（升序键）。 */
  readonly compositeSummary: readonly {
    readonly compositeKey: string;
    readonly dayCount: number;
  }[];
}

/** paper → 产出 paperRef（C-23.2 SignalToPnlRun / C-23.1 paperAccount 摘要）。 */
export interface ClosedLoopPaperRef extends ClosedLoopHandoffBase {
  readonly kind: "paperRef";
  readonly accountId: string | null;
  readonly initialCapital: number;
  readonly finalEquity: number;
  readonly netReturnPct: number | null;
  readonly fillCount: number;
  readonly unfilledCount: number;
}

/** 接线限制（诚实记录：编排遇到但暂不可在 CODE_READY 处理的接线约束）。 */
export interface ClosedLoopWiringLimit {
  /** 稳定机器码（CL_*；如 CL_REVIEW_UNFILLED_VALIDATION_DEFERRED）。 */
  readonly code: string;
  /** 人类可读说明。 */
  readonly detail: string;
}

/** review → 产出 reviewRef（C-24.1 tradeJournal 复盘摘要）。 */
export interface ClosedLoopReviewRef extends ClosedLoopHandoffBase {
  readonly kind: "reviewRef";
  readonly journalEntryCount: number;
  readonly reviewRecordCount: number;
  readonly reconcile: {
    readonly matchedCount: number;
    readonly deviatedCount: number;
    readonly unfilledCount: number;
  };
  /** 触发的上游接线限制（空 = 无）。 */
  readonly wiringLimits: readonly ClosedLoopWiringLimit[];
}

/** discipline → 产出 disciplineRef（C-24.2 disciplineFeedback 运行摘要）。 */
export interface ClosedLoopDisciplineRef extends ClosedLoopHandoffBase {
  readonly kind: "disciplineRef";
  readonly conclusionReasonCode: string | null;
  readonly patterns: readonly {
    readonly patternKey: string;
    readonly reasonCode: string;
    readonly occurrenceCount: number;
  }[];
}

/** finalize → 产出 finalizeRef（生命周期整合 + 全链摘要）。 */
export interface ClosedLoopFinalizeRef extends ClosedLoopHandoffBase {
  readonly kind: "finalizeRef";
  readonly lifecycle: {
    readonly strategyId: string;
    readonly strategyVersion: string;
    readonly from: string;
    /** 推进成功后的新状态；未推进 = 原状态。 */
    readonly to: string;
    readonly advanced: boolean;
    /** 推进成功的 transition seq；未推进 null。 */
    readonly transitionSeq: number | null;
    readonly recordFingerprint: string | null;
    readonly blockedReasonCode: string | null;
  };
  readonly promotion: {
    readonly considered: boolean;
    readonly applied: boolean;
    /** 推进依据的 evidence 是否全为合成（synthetic:true 链上仅测试允许）。 */
    readonly evidenceIsSynthetic: boolean;
    readonly detail: string;
  };
  readonly runSummary: {
    readonly executedStageCount: number;
    readonly blockedStageCount: number;
    readonly synthetic: boolean;
    readonly note: string;
  };
}

/** 交接摘记 union（全部 kind）。 */
export type ClosedLoopHandoff =
  | ClosedLoopDatasetSummary
  | ClosedLoopResearchSummary
  | ClosedLoopStrategyDocRef
  | ClosedLoopBacktestSummary
  | ClosedLoopEvaluationRef
  | ClosedLoopOptimizationRef
  | ClosedLoopRobustnessRef
  | ClosedLoopOosRef
  | ClosedLoopOverfittingRef
  | ClosedLoopRegimeRef
  | ClosedLoopPaperRef
  | ClosedLoopReviewRef
  | ClosedLoopDisciplineRef
  | ClosedLoopFinalizeRef;

// ---------------------------------------------------------------------------
// 元数据 / §28 研究身份（request 与 run 记录共用）
// ---------------------------------------------------------------------------

/**
 * 闭环研究身份与 §28 版本元数据（每阶段 lineage anchor 的基底）。
 *
 * 诚实纪律（对齐 C-13.3）：datasetVersion / codeVersion 等解析不到真实值时置 null，
 * 由 lineage 适配器显式转 missing 标记，禁止猜 "latest" 等伪标识。
 */
export interface ClosedLoopRunMetadata {
  /** 实验 id（EXP-YYYYMMDD-XXXXXXXX 形态；C-13.3 validator 强校验）。 */
  readonly experimentId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** §28 窗口（该次闭环研究覆盖的 date_range）。 */
  readonly dateRange: ClosedLoopDateRange;
  /** §28 dataset_version（rd-…；真实数据集可用后注入，否则 null → lineage missing）。 */
  readonly datasetVersion: string | null;
  /** §28 universe_version（= datasetVersion 内容指纹语义；null → missing）。 */
  readonly universeVersion: string | null;
  /** §28 code_version（composeCodeVersion 解析注入；null → missing）。 */
  readonly codeVersion: string | null;
  /** 创建期冻结成本模型（STEP 8 CostModel；null → lineage cost missing）。 */
  readonly costModel: CostModel | null;
  /** §28 execution_model（如 next-open；null → missing）。 */
  readonly executionModel: string | null;
  /** 参数集（§17；缺省空对象合法——lineage 记录允许空 parameterSet）。 */
  readonly parameterSet: Readonly<ResearchParameterSet>;
}

/** metadata 的构造时默认值（空参数集 / 显式 null 版本，供便捷工厂使用）。 */
export const DEFAULT_CLOSED_LOOP_METADATA_VERSIONS = {
  datasetVersion: null,
  universeVersion: null,
  codeVersion: null,
  costModel: null,
  executionModel: null,
} as const;

// ---------------------------------------------------------------------------
// 生命周期整合配置（finalize 阶段；C-21.1 复用）
// ---------------------------------------------------------------------------

import type {
  LifecycleTransitionInput,
  StrategyLifecycleRecord,
} from "../lifecycle/types";

/** finalize 阶段的生命周期推进意图（由调用方 / 人工声明，编排器不自动 promotion）。 */
export interface ClosedLoopLifecycleConfig {
  /** 当前生命周期壳（C-21.1 StrategyLifecycleRecord）。 */
  readonly lifecycleRecord: StrategyLifecycleRecord;
  /** 期望执行的一次迁移（相邻边；证据/experiment 等四要素由调用方声明）。 */
  readonly transition: LifecycleTransitionInput;
  /**
   * 仅测试用显式放行：当闭环链为 synthetic（无真实数据 gate PASS）时，生命周期
   * evidence 若引用 datasetGate PASS 属合成声明——除非显式 opt-in 否则视为
   * CL_GATE_EVIDENCE_MISSING 阻塞，防「合成结果冒充真实认证」。生产路径禁止置 true。
   */
  readonly allowSyntheticEvidence?: boolean;
}

// ---------------------------------------------------------------------------
// 数据提供者（data 阶段注入；CODE_READY 阶段为合成 smoke 入口）
// ---------------------------------------------------------------------------

/** data 阶段的数据提供者签名：返回 datasetSummary（gate 判定由 provider 自证）。 */
export type ClosedLoopDataProvider = () => ClosedLoopDatasetSummary;

// ---------------------------------------------------------------------------
// 执行上下文与阶段执行器
// ---------------------------------------------------------------------------

/** 阶段执行上下文（只读；runId/createdAt 由调用方注入，编排器不取时钟）。 */
export interface ClosedLoopStageContext {
  readonly runId: string;
  /** ISO-8601 UTC；注入式，非复现输入。 */
  readonly createdAt: string;
}

/** kind → handoff 类型映射。 */
export interface ClosedLoopHandoffByKind {
  datasetSummary: ClosedLoopDatasetSummary;
  researchSummary: ClosedLoopResearchSummary;
  strategyDocRef: ClosedLoopStrategyDocRef;
  backtestSummary: ClosedLoopBacktestSummary;
  evaluationRef: ClosedLoopEvaluationRef;
  optimizationRef: ClosedLoopOptimizationRef;
  robustnessRef: ClosedLoopRobustnessRef;
  oosRef: ClosedLoopOosRef;
  overfittingRef: ClosedLoopOverfittingRef;
  regimeRef: ClosedLoopRegimeRef;
  paperRef: ClosedLoopPaperRef;
  reviewRef: ClosedLoopReviewRef;
  disciplineRef: ClosedLoopDisciplineRef;
  finalizeRef: ClosedLoopFinalizeRef;
}

/** 阶段 → 阶段产出（EXECUTED 时的 handoff）。 */
export interface ClosedLoopStageOutputById {
  data: ClosedLoopDatasetSummary;
  research: ClosedLoopResearchSummary;
  strategy: ClosedLoopStrategyDocRef;
  backtest: ClosedLoopBacktestSummary;
  evaluation: ClosedLoopEvaluationRef;
  optimization: ClosedLoopOptimizationRef;
  robustness: ClosedLoopRobustnessRef;
  oos: ClosedLoopOosRef;
  overfitting: ClosedLoopOverfittingRef;
  regime: ClosedLoopRegimeRef;
  paper: ClosedLoopPaperRef;
  review: ClosedLoopReviewRef;
  discipline: ClosedLoopDisciplineRef;
  finalize: ClosedLoopFinalizeRef;
}

/** 阶段 → 阶段输入（= canonical 前驱产出；data 无输入 → null）。 */
export interface ClosedLoopStageInputById {
  data: null;
  research: ClosedLoopDatasetSummary;
  strategy: ClosedLoopResearchSummary;
  backtest: ClosedLoopStrategyDocRef;
  evaluation: ClosedLoopBacktestSummary;
  optimization: ClosedLoopEvaluationRef;
  robustness: ClosedLoopOptimizationRef;
  oos: ClosedLoopRobustnessRef;
  overfitting: ClosedLoopOosRef;
  regime: ClosedLoopOverfittingRef;
  paper: ClosedLoopRegimeRef;
  review: ClosedLoopPaperRef;
  discipline: ClosedLoopReviewRef;
  finalize: ClosedLoopDisciplineRef;
}

/** 阶段执行器：接收阶段输入 → 返阶段交接（注入式；编排器不实现阶段算法）。 */
export type ClosedLoopStageExecutor<S extends ClosedLoopStageId> = (
  ctx: ClosedLoopStageContext,
  input: ClosedLoopStageInputById[S],
) => ClosedLoopStageOutputById[S];

/** 执行器注入表（Partial：未被请求阶段 / 合法 BLOCKED 场景允许缺失）。 */
export type ClosedLoopStageRunnerMap = { [S in ClosedLoopStageId]?: ClosedLoopStageExecutor<S> };

/** 便捷：把严格类型的执行器装入 runner map（可读性辅助）。 */
export function defineClosedLoopStageExecutor<S extends ClosedLoopStageId>(
  _stageId: S,
  executor: ClosedLoopStageExecutor<S>,
): ClosedLoopStageExecutor<S> {
  return executor;
}

// ---------------------------------------------------------------------------
// 请求类型
// ---------------------------------------------------------------------------

/** 阶段链选择（缺省 = canonical 全 14 阶段；子集必须保序无重复）。 */
export type ClosedLoopStageSelection = readonly ClosedLoopStageId[];

/** 单条 seed（subset 链中，为「未请求阶段的产出 kind」提供交接输入）。 */
export interface ClosedLoopSeedHandoff {
  readonly kind: ClosedLoopHandoffKind;
  readonly handoff: ClosedLoopHandoffByKind[ClosedLoopHandoffKind];
}

/**
 * runClosedLoop 请求。runId/createdAt 注入式（确定性）；执行器/数据提供者/seed/lifecycle
 * 全部可选（缺省 → 诚实 BLOCKED 或 SKIPPED，绝不伪造中间产物）。
 */
export interface ClosedLoopRunRequest {
  /** 本次闭环 run id（注入式，非空）。 */
  readonly runId: string;
  /** 创建时间（ISO-8601 UTC；注入式）。 */
  readonly createdAt: string;
  /** §28 研究身份元数据。 */
  readonly metadata: ClosedLoopRunMetadata;
  /** 阶段选择：缺省全 14 阶段；必须为 canonical 保序子集（拓扑校验抛错）。 */
  readonly stageIds?: ClosedLoopStageSelection;
  /** 阶段执行器注入表。 */
  readonly stageRunners?: ClosedLoopStageRunnerMap;
  /** data 阶段数据提供者（CODE_READY 阶段不接真实 DB；缺省 → CL_DATA_NOT_INJECTED）。 */
  readonly dataProvider?: ClosedLoopDataProvider;
  /** 交接种子（subset 链 / 测试注入；kind 的产生阶段必须不在 stageIds 内）。 */
  readonly seedHandoffs?: readonly ClosedLoopSeedHandoff[];
  /** finalize 阶段生命周期推进配置（提供后可使用内置生命周期执行器）。 */
  readonly lifecycle?: ClosedLoopLifecycleConfig;
}

// ---------------------------------------------------------------------------
// Run 记录（每阶段审计 + 链指纹 + blocked 汇总）
// ---------------------------------------------------------------------------

/** 阶段级 §28 谱系锚点（experiment_id/strategy/date_range/code_version/created_at）。 */
export interface ClosedLoopStageLineageAnchor {
  /** 阶段内 run id（= `${runId}::${stageId}`，确定性派生）。 */
  readonly stageRunId: string;
  readonly stageId: ClosedLoopStageId;
  readonly experimentId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly dateRange: ClosedLoopDateRange;
  readonly datasetVersion: string | null;
  readonly codeVersion: string | null;
  readonly createdAt: string;
  /**
   * §28 全字段谱系记录（C-13.3 createExperimentLineageRecord 产物；EXECUTED 阶段
   * 非 null，落账该阶段的一次研究 run 谱系；版本/成本解析不到 → 显式 missing 标记）。
   */
  readonly lineageRecord: ExperimentLineageRecord | null;
}

/** 阶段阻塞详情。 */
export interface ClosedLoopBlockedDetail {
  /** 稳定机器码（CL_*，见 blockers.ts）。 */
  readonly reasonCode: ClosedLoopBlockedReasonCode;
  readonly detail: string;
  /** 触发本阻塞的上游阶段（上游阻塞传递时非 null）。 */
  readonly upstreamStageId: ClosedLoopStageId | null;
  /** 阶段执行器抛错 / 输出非法时的原始错误 code（可空）。 */
  readonly errorCode: string | null;
  /** 阶段执行器抛错信息摘要（可空；不吞异常，审计可查）。 */
  readonly errorMessage: string | null;
}

/** 单阶段 run 记录（含交接摘要、fingerprint、谱系锚点、状态）。 */
export interface ClosedLoopStageRunRecord {
  readonly stageId: ClosedLoopStageId;
  /** READY/EXECUTED/BLOCKED/SKIPPED。 */
  readonly state: ClosedLoopStageState;
  /** 消费的交接 kind（data = null）。 */
  readonly consumedHandoffKind: ClosedLoopHandoffKind | null;
  /** 产出的交接 kind。 */
  readonly producedHandoffKind: ClosedLoopHandoffKind;
  /** 产出交接的内容指纹（sha256 hex；未产出 null）。 */
  readonly outputHandoffFingerprint: string | null;
  /** EXECUTED 时的交接摘要（SKIPPED/BLOCKED = null，禁伪造）。 */
  readonly output: ClosedLoopHandoff | null;
  /** 阻塞详情（BLOCKED 才有）。 */
  readonly blocked: ClosedLoopBlockedDetail | null;
  /** 阶段级 §28 谱系锚点（EXECUTED 才有）。 */
  readonly lineage: ClosedLoopStageLineageAnchor | null;
}

/** blocked 汇总条目。 */
export interface ClosedLoopBlockedSummaryItem {
  readonly stageId: ClosedLoopStageId;
  readonly reasonCode: ClosedLoopBlockedReasonCode;
  readonly detail: string;
  readonly upstreamStageId: ClosedLoopStageId | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/** 全链汇总。 */
export type ClosedLoopRunStatus = "ALL_EXECUTED" | "PARTIAL_BLOCKED" | "NO_STAGE_EXECUTED";

/** 闭环 run 记录（不可变、可序列化、指纹防篡改）。 */
export interface ClosedLoopRun {
  readonly recordKind: typeof CLOSED_LOOP_RUN_RECORD_KIND;
  readonly recordVersion: typeof CLOSED_LOOP_RUN_RECORD_VERSION;
  /** run id（注入式）。 */
  readonly runId: string;
  /** createdAt（注入式 ISO-8601 UTC）。 */
  readonly createdAt: string;
  /** §28 研究身份（回显）。 */
  readonly metadata: ClosedLoopRunMetadata;
  /** 请求摘要（执行器函数不入记录；只记注入情况）。 */
  readonly request: {
    readonly stageIds: readonly ClosedLoopStageId[];
    readonly runnerInjected: readonly ClosedLoopStageId[];
    readonly dataProviderInjected: boolean;
    readonly seedKinds: readonly ClosedLoopHandoffKind[];
    readonly lifecycleConfigPresent: boolean;
  };
  /** 全 14 阶段记录（§27 完整形状；未请求 = SKIPPED）。 */
  readonly stages: readonly ClosedLoopStageRunRecord[];
  /** BLOCKED 汇总（保序；空 = 无阻塞）。 */
  readonly blockedSummary: readonly ClosedLoopBlockedSummaryItem[];
  /** 链指纹（sha256 hex）：除本字段外全部字段的 canonical 摘要。 */
  readonly chainFingerprint: string;
  readonly overall: {
    readonly status: ClosedLoopRunStatus;
    readonly executedStageCount: number;
    readonly blockedStageCount: number;
    readonly skippedStageCount: number;
    /** 首阻塞 reasonCode（无阻塞 null）。 */
    readonly firstBlockedReasonCode: ClosedLoopBlockedReasonCode | null;
    /** 任一已执行交接 synthetic → true（合成产物不得与真实结论混淆）。 */
    readonly synthetic: boolean;
    readonly promotionApplied: boolean;
    readonly note: string;
  };
  /** 内容指纹（sha256 hex）：除本字段外全部字段的 canonical 摘要。 */
  readonly fingerprint: string;
}
