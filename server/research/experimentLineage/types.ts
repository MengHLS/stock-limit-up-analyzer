/**
 * STEP 13 / C-13.3 — Experiment Lineage：§28 全字段谱系记录（类型权威源）。
 *
 * 目标（ROADMAP §28）：把「一次研究实验的完整谱系」固化为正式一等记录，使任何历史结果
 * 都能回答「这个结果到底是怎么产生的？」。本目录（experimentLineage/）是纯模块：
 * 不可变、可序列化、确定性；无 DB / 无 Date.now / 无 Math.random / 无 IO。
 *
 * §28 15 字段的载体判定（详见 map.ts 与交付报告）：
 *   - experiment_id / strategy_id / strategy_version / parameter_set / date_range /
 *     created_at      → 直接落在既有 ResearchExperiment 上；
 *   - dataset_version  → ResearchDatasetSpec.datasetVersion（可选，旧实验多为 undefined）；
 *   - universe_version → 当前无独立载体（universe 决议绑定在 Research Dataset 内容指纹内，
 *                        research-dataset: 链路的 universeId = deriveDatasetUniverseId(datasetVersion)）；
 *   - cost_model       → backtestConfig.costModel（创建期冻结的 CostModel）；
 *   - slippage_model   → 当前引擎唯一实现 = 冻结 CostModel.slippageBps（固定基点）；
 *   - execution_model  → backtestConfig.executionModel（可选，如 "next-open"）；
 *   - regime           → 未建模（C-22.1 前禁止编造 regime 标签）：用结构化 unassessed 占位 + reason；
 *   - metrics / result → 运行后才产生（ResearchRun.result），建模为可挂载到记录的 outcome；
 *   - code_version     → 全系统缺失：注入式纯函数 composeCodeVersion（见 codeVersion.ts）解析。
 *
 * 诚实纪律（与 types.ts#ResearchDatasetSpec 一致）：
 *   - 载体中解析不到真实版本时，一律「显式 missing 标记 + 机器码 + 原因」，
 *     绝不猜 "latest" / "deterministic" / "v1" 之类的伪标识；
 *   - metrics / result 未运行时为 null（不是永久缺省，而是「结果谱系尚未挂载」的显式空态）。
 *
 * 铁律：全部字段 readonly；禁止 NaN / Infinity；构造确定性；失败响亮。
 */

import type { CostModel, PerformanceMetrics } from "../../engine/domain";
import type { ResearchParameterSet } from "../types";
import type { ResearchRunResultSummary, ResearchRunStatus } from "../run";

/** 记录种类标签（供序列化 / 反序列化判别，防止类型混淆）。 */
export const EXPERIMENT_LINEAGE_RECORD_KIND = "EXPERIMENT_LINEAGE_RECORD" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const EXPERIMENT_LINEAGE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 显式缺省标记（版本 / 模型口径解析不到时使用，禁止猜默认值）
// ---------------------------------------------------------------------------

/** 显式缺省码白名单（稳定机器码，validator 校验其合法性）。 */
export const LINEAGE_MISSING_CODES = {
  DATASET_VERSION_UNRESOLVED: "LINEAGE_DATASET_VERSION_UNRESOLVED",
  UNIVERSE_VERSION_UNRESOLVED: "LINEAGE_UNIVERSE_VERSION_UNRESOLVED",
  CODE_VERSION_UNRESOLVED: "LINEAGE_CODE_VERSION_UNRESOLVED",
  COST_MODEL_UNRESOLVED: "LINEAGE_COST_MODEL_UNRESOLVED",
  EXECUTION_MODEL_UNRESOLVED: "LINEAGE_EXECUTION_MODEL_UNRESOLVED",
  SLIPPAGE_MODEL_UNRESOLVED: "LINEAGE_SLIPPAGE_MODEL_UNRESOLVED",
} as const;

/** 缺省码类型。 */
export type LineageMissingCode = (typeof LINEAGE_MISSING_CODES)[keyof typeof LINEAGE_MISSING_CODES];

/** 值是否为合法缺省码。 */
export function isLineageMissingCode(value: string): value is LineageMissingCode {
  return (Object.values(LINEAGE_MISSING_CODES) as string[]).includes(value);
}

/** 显式缺省：字段在既有载体中不可解析（不静默兜底）。 */
export interface ExperimentLineageMissing {
  readonly kind: "missing";
  /** 稳定机器码（白名单见 LINEAGE_MISSING_CODES）。 */
  readonly code: string;
  /** 原因（中文，人类可读；说明为什么缺、调用方可如何补齐）。 */
  readonly reason: string;
}

/** 解析到真实字符串值（dataset / universe / code / execution 版本引用）。 */
export interface ExperimentLineageResolvedString {
  readonly kind: "resolved";
  readonly value: string;
}

/** §28 版本类字段引用：resolved（真实值）| missing（显式缺省）。 */
export type ExperimentLineageStringRef = ExperimentLineageResolvedString | ExperimentLineageMissing;

/** §28 成本模型引用：frozen（创建期冻结 CostModel）| missing。 */
export type ExperimentLineageCostModelRef =
  | { readonly kind: "frozen"; readonly model: CostModel }
  | ExperimentLineageMissing;

/** §28 滑点模型引用：resolved（固定基点，= 冻结 CostModel.slippageBps）| missing。 */
export type ExperimentLineageSlippageRef =
  | { readonly kind: "resolved"; readonly model: "fixed-bps"; readonly slippageBps: number }
  | ExperimentLineageMissing;

// ---------------------------------------------------------------------------
// 日期范围
// ---------------------------------------------------------------------------

/** 实验日期窗口（闭区间 [startDate, endDate]，两端点含；= dataset 窗口）。 */
export interface ExperimentLineageDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

// ---------------------------------------------------------------------------
// Regime（C-22.1 前禁止实现体系，只允许结构化占位）
// ---------------------------------------------------------------------------

/** unassessed 占位 reasonCode（当前唯一合法值）。 */
export const REGIME_UNASSESSED_REASON_CODE = "REGIME_NOT_ASSESSED" as const;

/** 缺省占位原因（供构造期使用；调用方可用显式 reason 覆盖）。 */
export const DEFAULT_REGIME_UNASSESSED_REASON =
  "regime 体系未落地（C-22.1 交付前禁止编造 regime 标签）；该实验记录未做 regime 评估";

/**
 * §28 regime 字段：assessed（C-22.1 交付后的显式评估）| unassessed（当前必须的占位）。
 * 本模块不实现 regime 体系，assessed 仅作为未来形态预留，不提供任何评估入口。
 */
export type ExperimentLineageRegime =
  | { readonly kind: "assessed"; readonly regimeId: string; readonly note?: string }
  | { readonly kind: "unassessed"; readonly reasonCode: typeof REGIME_UNASSESSED_REASON_CODE; readonly reason: string };

// ---------------------------------------------------------------------------
// Outcome（metrics / result 的可挂载结果谱系）
// ---------------------------------------------------------------------------

/**
 * 结果谱系挂载：一次「成功执行」的 Run 结果（§28 metrics + result 的载体）。
 *
 * 语义：
 *   - 一个 ExperimentLineageRecord 至多挂载一个 outcome；换 Run 请重新映射生成新记录
 *     （挂载即冻结，禁止覆盖）；
 *   - 只有 status="succeeded" 的 Run 才有非空 result，failed / running 无 metrics/result；
 *   - metrics 恒等于 result.performance 的冻结副本（builder 保证，validator 复核）。
 */
export interface ExperimentLineageOutcome {
  /** 产生该结果的 Run 身份（RUN-<experimentId>-<suffix>）。 */
  readonly runId: string;
  /** 挂载终态（只有 succeeded 才允许携带 metrics/result）。 */
  readonly status: ResearchRunStatus;
  /** §28 metrics：绩效指标（= result.performance 冻结副本）。 */
  readonly metrics: PerformanceMetrics;
  /** §28 result：结构化运行结果摘要（metadata/config/performance/finalEquity）。 */
  readonly result: ResearchRunResultSummary;
  /** 结果冻结时间（ISO；取自 run.finishedAt，实验元数据非复现输入）。 */
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------
// §28 全字段谱系记录
// ---------------------------------------------------------------------------

/**
 * 一次研究实验的 §28 全字段谱系记录（不可变、可序列化、确定性）。
 *
 * 覆盖 ROADMAP §28 全部 15 字段：
 *   experiment_id / strategy_id / strategy_version / dataset_version / universe_version /
 *   parameter_set / date_range / cost_model / slippage_model / execution_model / regime /
 *   metrics（outcome.metrics）/ result（outcome.result）/ code_version / created_at。
 *
 * 额外书签：recordKind / recordVersion / fingerprint（除 fingerprint 外全部字段的
 * canonical SHA-256 摘要，防篡改 / 防字段退化）。
 */
export interface ExperimentLineageRecord {
  readonly recordKind: typeof EXPERIMENT_LINEAGE_RECORD_KIND;
  readonly recordVersion: typeof EXPERIMENT_LINEAGE_RECORD_VERSION;

  // -- §28 身份 --
  readonly experimentId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;

  // -- §28 数据 / universe 版本 --
  readonly datasetVersion: ExperimentLineageStringRef;
  readonly universeVersion: ExperimentLineageStringRef;

  // -- §28 参数与窗口 --
  readonly parameterSet: Readonly<ResearchParameterSet>;
  readonly dateRange: ExperimentLineageDateRange;

  // -- §28 模型口径 --
  readonly costModel: ExperimentLineageCostModelRef;
  readonly slippageModel: ExperimentLineageSlippageRef;
  readonly executionModel: ExperimentLineageStringRef;

  // -- §28 regime --
  readonly regime: ExperimentLineageRegime;

  // -- §28 结果（运行后挂载；未运行时为 null = 显式空态，非永久缺省） --
  readonly outcome: ExperimentLineageOutcome | null;

  // -- §28 代码版本 / 创建时间 --
  readonly codeVersion: ExperimentLineageStringRef;
  readonly createdAt: string;

  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}
