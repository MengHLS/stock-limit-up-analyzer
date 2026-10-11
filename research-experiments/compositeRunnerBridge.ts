/**
 * COMPOSITE-RUNNER-BRIDGE-001 —— 组合执行能力的**实验侧唯一入口**（零实现，只有 re-export）。
 *
 * 与既有 `@experiments/robustnessBridge` 同一纪律：方法（组合回测）是跨阶段通用的，
 * 实验**可以消费**它，但实现只有一处（`server/research/compositeRunner`），
 * 这里不写任何逻辑、不新增第二套引擎。
 *
 * 使用前提：实验 descriptor 必须声明 `executionSurface: "COMPOSITE_PORTFOLIO"`。
 */
export {
  buildFirstLimitPullback3FTop3SourceRun,
  buildCompositeEvents,
  buildCompositeSourceRun,
  buildCompositeExecutionDataset,
  rebuildCompositeRun,
  applyCompositeCarryover,
  applyCompositeLateEntry,
  applyCompositeEventGate,
  runCompositeRunnerBacktest,
  /**
   * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005` 续修（Finding A）—— **权威装配配置入口**
   * （只装配、**不撮合**）。研究实验需要「权威 `simulationConfig`」而不需要那次顺带的真实撮合时，
   * 用它替代 `runCompositeRunnerBacktest`：既有调用方与缺省行为**逐字节不变**。
   */
  assembleCompositeRunnerSimulationConfig,
  COMPOSITE_ASSEMBLY_CONFIG_CONTRACT_VERSION,
  COMPOSITE_RUNNER_TOP_N,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
} from "../server/research/compositeRunner/index";
export {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_CREATED_AT,
} from "../server/research/patternLibrary/threeFactorTopNStrategy";
export { buildThreeFactorTopNFamilyArmInput } from "../server/research/patternLibrary/threeFactorTopNFamilies";
export type {
  CompositeExecutionSurfacePayload,
  CompositeEventMetadata,
  ExperimentCompositeDatasetProvider,
} from "../server/researchExperiments/compositeDatasetProvider";
export {
  CARRY_REFRESH_COMPONENT_IDS,
  computeCarryRefreshComponents,
} from "../server/research/recipeFeatures/carryRefreshScoreFeatures";
export {
  LATE_ENTRY_SCORE_VERSION,
  computeLateEntryScore,
} from "../server/research/recipeFeatures/lateEntryScoreFeatures";
export type {
  CarryRefreshComponents,
} from "../server/research/recipeFeatures/carryRefreshScoreFeatures";
export type {
  ResearchDataset,
  ResearchDatasetRow,
  CompositeSelectedEvent,
  CompositeExtensionBar,
  BuiltCompositeArm,
  CompositeCarryoverPolicy,
  CompositeCarryoverAccounting,
  CompositeCarryoverRefreshPolicy,
  CompositeLateEntryPolicy,
  CompositeLateEntryAccounting,
  CompositeEventGatePolicy,
  CompositeEventGateAccounting,
  ListingFilterAccounting,
  CompositeArmKind,
  CompositeRunnerBacktestResult,
  /** `FIX-005` 续修（Finding A）：权威装配配置入口的产物类型（无任何撮合结果）。 */
  CompositeRunnerAssemblyConfigResult,
} from "../server/research/compositeRunner/index";

// ---------------------------------------------------------------------------
// `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` 追加（**零实现，只有 re-export**）
//
// 为什么需要：早入场研究的候选集由**实验自己**产出（观察买点 + preReturn10 排序 / 200 随机种子），
// 而 `runTradeSimulation` 的唯一入口需要 `{dataset, sourceRun, simConfig}` 三件套。
// 既有 `runCompositeRunnerBacktest` 只接受**已构造好**的 `dataset`/`sourceRun`，
// 但其候选构造器（`buildCompositeSourceRun`）绑定 3F 候选 —— 无法表达本轮的买点。
// 因此这里把**既有权威实现**按名导出，供实验侧组装；**不新增任何逻辑、不新增第二套引擎**。
// ---------------------------------------------------------------------------

/** 唯一撮合引擎（`server/research/simulator/engine.ts#runTradeSimulation`）。 */
export { runTradeSimulation } from "../server/research/simulator/engine";
/** 候选层评价（构造 `CandidateEvaluationRun.evaluation` 的唯一实现）。 */
export { evaluateCandidateRun } from "../server/research/signalEngine/evaluate";
/** 候选记录内容指纹（构造 `sourceRun.fingerprint` 的唯一实现）。 */
export { computeCandidateEvaluationRunFingerprint } from "../server/research/signalEngine/serialize";
/** 指标**唯一出口**（I-8：任何消费方不得自行从曲线/台账再算一遍）。 */
export { canonicalMetrics } from "../server/backtest/backtestResult";
export type { CanonicalMetricsDetail } from "../server/backtest/backtestResult";

export type {
  CandidateDayRecord,
  CandidateEvaluationRun,
} from "../server/research/signalEngine/types";
export type {
  PositionIntent,
  SelectedCandidate,
} from "../server/research/framework/contract";
export type {
  SimulationConfig,
  TradeSimulationRun,
  SecurityBoard,
  /**
   * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005` / F1 — 可选执行资格闸门
   * （**零实现 re-export**：研究装配层注入实现，纯撮合层不反向依赖研究模块）。
   */
  ExecutionEligibilityAuditEntry,
  ExecutionEligibilityCheckInput,
  ExecutionEligibilityDecision,
  ExecutionEligibilityGate,
  /** `RECOVERY-LIGHT-ST-007` §4 — 可选 UNKNOWN 处理声明（缺省 = REJECT）。 */
  ExecutionEligibilityUnknownPolicy,
} from "../server/research/simulator/types";

/**
 * `RECOVERY-LIGHT-ST-007` §4 — **未核验状态处理政策的唯一放行判据**（零实现 re-export）。
 *
 * 🔴 研究侧与撮合侧**必须**用同一个函数判断「某状态标签能否真实成交」，
 *    否则会出现「研究侧以为会放行、引擎拒单」这类只有跑起来才发现的偏差。
 */
export {
  DEFAULT_EXECUTION_ELIGIBILITY_UNKNOWN_POLICY,
  EXECUTION_ELIGIBILITY_UNKNOWN_POLICIES,
  executionEligibilityStatusAllowed,
} from "../server/research/simulator/types";

/** `EARLY-ENTRY-002`：真实证券身份（复用唯一解析实现）。 */
export {
  resolveRollingPoolSecurityIds,
  sealRollingPoolExecutionDataset,
} from "../server/researchExperiments/rollingPoolExecutionSupport";
export type {
  RollingPoolIdentityEvent,
  RollingPoolIdentityResult,
  RollingPoolExecutionRowInput,
  SealRollingPoolExecutionDatasetInput,
} from "../server/researchExperiments/rollingPoolExecutionSupport";

/** `EARLY-ENTRY-002`：冻结退出政策的唯一读取器（含指纹断言）。 */
export {
  loadFrozenRunnerPolicyBundle,
  runnerBridgeOf,
  FROZEN_RUNNER_STRATEGY_REFERENCE,
  EARLY_ENTRY_POSITION_FRACTION,
} from "../server/researchExperiments/frozenRunnerExitPolicy";
export type { FrozenRunnerPolicyBundle } from "../server/researchExperiments/frozenRunnerExitPolicy";

/**
 * `OBSERVATION-WINDOW-003` 追加（**零实现，只有 re-export**）。
 *
 * 为什么需要：`FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003` 的证券身份改为平台的
 * **事件作用域**惯例 `sec_<uuid>::event:<symbol>@<eventDate>`（`server/eventIdentity.ts`）。
 * 这样既能让 `panelCodeOf` 把身份剥回真实 symbol（⇒ 同真实股票并发上限仍生效），
 * 又能让 `maxEntriesPerMember` 的次数键恰好落在**锚点事件**上（E 组「同锚点一次入场」）。
 *
 * 🔴 `baseSecurityIdOf` 的来源改为 `server/eventIdentity`（它同时处理 `::event:` 与 `::pool:`），
 *    因此原先从 `compositeRunner/index` 的**同名** re-export 已移除 —— 两者对 `::event:`
 *    行为逐字节一致（见 `tests/server/eventIdentity.test.ts` 与 compositeRunner 的实现），
 *    改名不改语义；保留同名双出口会造成 ESM/TS 的二义性错误。
 */
export { eventScopedSecurityId, baseSecurityIdOf } from "../server/eventIdentity";

/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` 追加（**零实现，只有 re-export**）。
 *
 * 为什么需要：本轮的轻量 ST 资格政策要消费平台**已有的** ST 维度历史标签，
 * 而「读取来源 + 身份映射 + 区间索引 + 来源指纹」只能在**服务侧**做（研究层禁止直连 SQL）。
 * 因此把**既有唯一实现**按名导出，供实验侧经本桥接注入研究层；**不新增任何逻辑**。
 *
 * 🔴 返回值是**历史标签索引**（`KnownStLabelIndexPort`），**不是**严格 PIT provider：
 *    它**没有** `availableAsOf`（来源表根本没有该列），因此**不得**喂给 `evaluateStGate`。
 * 🔴 只读：0 DDL / 0 DML / 0 migration / 0 写入。
 */
export {
  KNOWN_ST_LABEL_SOURCE_ID,
  KNOWN_ST_LABEL_TABLES_READ,
  loadKnownStLabelIndex,
} from "../server/researchExperiments/knownStLabelIndex";

/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` TASK B 追加（**零实现，只有 re-export**）。
 *
 * 为什么需要：目标 §6 要求「**先报告测得的耗时构成**，再决定是否优化」，而实验侧只能经
 * 本桥接触达服务侧能力。`server/observability/perfProfile.ts` 是仓库既有的唯一剖析器：
 *   - **默认完全关闭**（`PARAM_PROFILE≠1` 时每个入口只有一次布尔短路，不取时间、不分配）
 *     ⇒ 不改变任何业务结果、也不改变产物字节；
 *   - 产物只进内存，由调用方决定落盘（本实验写进 `stage-performance.json`），**不写库**。
 *
 * 🔴 埋点只测「哪一段花了多少墙钟」，**不参与任何研究口径**，也不得用于改判据。
 */
export {
  isPerfProfilingEnabled,
  perfBegin,
  perfCount,
  perfEnd,
  perfMark,
  perfRun,
  perfRunAsync,
  perfSnapshot,
} from "../server/observability/perfProfile";

