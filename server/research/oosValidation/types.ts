/**
 * OOS-001 — Out-of-Sample Validation 领域类型与常量。
 *
 * ## 这个域在链路里的位置（规格 §0）
 *
 * ```text
 * Parameter Search Result
 *   → 冻结候选参数（**禁止再搜索 / 再调参**）
 *   → 确定 OOS 数据窗口（**与 Search 窗口不重叠**）
 *   → 用同一份 Strategy / Dataset 定义
 *   → 在 OOS 窗口**重新执行 Backtest**
 *   → Canonical Metrics
 *   → OOS Result 持久化
 *   → IS / OOS 对照
 * ```
 *
 * ## 与 `searchRobustness/**` 的关系（**并列，语义相反**）
 *
 * - `searchRobustness/**`：冻结结果上的**邻域稳定性** —— **零重跑、零重算**（静态守卫钉死）；
 * - 本域：**必须真正重跑 Backtest、必须真正重算 OOS Metrics**（规格 §9）。
 *
 * ⇒ 两者是**并列兄弟模块**：把 OOS 塞进 `searchRobustness/**` 会让那条「零重跑」的
 *   静态守卫立刻变红，且语义直接冲突（规格 §2 明禁）。
 *
 * ## 复用的唯一权威（本域**不新建**任何一套）
 *
 * | 能力 | 唯一权威 |
 * | --- | --- |
 * | 回测执行 | `server/research/strategyEvaluation/backtestBridge.ts#createStrategyBacktestBridge` |
 * | 指标 | `server/backtest/backtestResult.ts#canonicalMetrics()`（经 `ClosedLoopEvaluationRef#canonicalMetrics` 投影） |
 * | 状态迁移表 | `server/research/parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS` |
 * | canonical 序列化 / 指纹 | `server/researchDataset/version.ts#canonicalStringify` |
 *
 * 🔴 本域**禁止**：import `parameterSearch/executor`（= 再搜索）、复制 Search Result 的指标、
 *   用当前策略版本重新推导历史参数（规格 §5）。
 */

import type {
  OosComparisonView,
  OosMetricsView,
  OosMetricsSource,
  OosValidationResultView,
  OosValidationRunStatus,
} from "../../../shared/oosValidationContracts";
import { BACKTEST_ANNUALIZATION_DAYS } from "../../backtest/backtestResult";

// ---------------------------------------------------------------------------
// 身份 / 版本自述
// ---------------------------------------------------------------------------

/** OOS Run ID 前缀（`OOSV-YYYYMMDD-XXXXXXXX`）。 */
export const OOS_VALIDATION_RUN_ID_PREFIX = "OOSV";

/**
 * 指标版本自述（回答规格 §4 的第 8 问「使用什么 metrics version」）。
 *
 * 🔴 由**年化口径常量**拼出，不写死数字 —— 口径一变，自述跟着变，
 *   历史留档里那句话就**不会**被误读成「和新口径一样」。
 */
export const OOS_METRICS_VERSION = `canonicalMetrics@${String(BACKTEST_ANNUALIZATION_DAYS)}d`;

/**
 * 决策引擎版本自述（回答规格 §4 的第 8 问）。
 *
 * 与 `researchRunRouter.loopRun` 留档里使用的字面量一致（本域只做**如实自述**，
 * 不去解析构建信息 —— `strategy_versions.codeVersion` 实测恒为 `1.0.0+gunknown`）。
 */
export const OOS_ENGINE_VERSION = "strategy-core/1.0.0";

// ---------------------------------------------------------------------------
// 领域常量
// ---------------------------------------------------------------------------

/** 列表默认返回上限（超出由调用方分页，不静默截断语义）。 */
export const DEFAULT_OOS_RUN_LIST_LIMIT = 50;

/** 状态词表（复用 PS；此处只做本域导出，避免消费者再 import 两个 barrel）。 */
export type { OosValidationRunStatus };

/** 空指标读数（`CREATED` / 未执行时的如实占位 —— 全 `null`，不是全 0）。 */
export const EMPTY_OOS_METRICS: OosMetricsView = {
  totalReturnPct: null,
  annualizedReturnPct: null,
  maxDrawdownPct: null,
  tradeCount: null,
  winRatePct: null,
  profitFactor: null,
};

/** 空对照（未执行 / 失败时为 null，不用空对象冒充）。 */
export type { OosComparisonView, OosMetricsSource };

// ---------------------------------------------------------------------------
// 领域中间形态
// ---------------------------------------------------------------------------

/**
 * 冻结候选（从源 Search Run 的组合行读出；**参数值不由调用方提供**）。
 *
 * `parameters` 是 Search 当时的**快照取值**；`parameterHash` 是它当时的身份。
 * 两者在 `freeze.ts` 里做**重算比对**：不一致即响亮拒绝（行被外部篡改 / 哈希口径变过）。
 *
 * ⚠️ **为什么不叫 `FrozenOosCandidate`**：仓库里**已经有一个同名类型**
 *   （`server/research/validationSelection.ts#FrozenOosCandidate`，STEP 6.4 的
 *   「选中实验 → 冻结候选」，被 `evaluationService` / `oosEvaluation` / `walkForwardService` 使用，
 *   且经 `server/research/index.ts` 全域 re-export）。两处同名会让读者与
 *   `export *` 都发生**静默遮蔽** ⇒ 本域改用无歧义的名字。
 *   两者语义也不同：那边是「进程内评估计划的候选」，这边是「**某次真实 Parameter Search Run
 *   里某条组合行的可复核快照**」（带 `parameterHash` 重算复核 + `sourceCombinationIndex`）。
 */
export interface FrozenCandidateSnapshot {
  readonly sourceSearchRunId: string;
  readonly combinationIndex: number;
  readonly parameterHash: string;
  readonly parameters: Readonly<Record<string, number | string | boolean | null>>;
  /** 该组合在源 Run 里是否已有成功结果（IS 侧的来源判据）。 */
  readonly hasSucceededResult: boolean;
}

/** 源 Search Run 的冻结坐标（OOS Run 原样继承，不复算）。 */
export interface OosSourceCoordinates {
  readonly searchRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly parameterSpaceFingerprint: string;
  readonly fixedCoordinatesJson: string;
  readonly executionPolicyVersion: number;
  readonly evaluationConfigFingerprint: string;
}

/** IS 侧读数（源 `parameter_search_result` 的**冻结副本**）。 */
export interface IsMetricsSnapshot {
  readonly metrics: OosMetricsView;
  readonly metricsSource: OosMetricsSource;
  readonly annualizationBasis: { readonly type: "TRADING_DAYS"; readonly daysPerYear: number } | null;
}

/** 一次 OOS 执行的产物（组装 Result 行的输入）。 */
export interface OosExecutionOutcome {
  readonly oosMetrics: OosMetricsView;
  readonly oosMetricsSource: OosMetricsSource;
  readonly annualizationBasis: { readonly type: "TRADING_DAYS"; readonly daysPerYear: number } | null;
  readonly backtestFingerprint: string | null;
  readonly evaluationId: string | null;
  readonly evaluationRunId: string | null;
  readonly error: string | null;
}

/** 结果行的领域视图（= 契约视图；此处只做别名，避免两处形状漂移）。 */
export type OosResultRecordView = OosValidationResultView;
