/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` · 首板滚动池 × 破位修复再触发 × 每日 ST 硬闸门
 *
 * 规格：[`GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`](../../../docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md)
 * （§2 两组矩阵 / §3 唯一规则定义 / §4 ST 闸门 / §6 靶指标）。
 * S1 审计：[`AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`](../../../docs/research/AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md)。
 *
 * ## 唯一研究问题
 *
 * 「**支撑破位后暂停买入、止跌修复后重新获得资格**，能否改善右尾覆盖及账户表现？」
 * 主比较 = **`B_R − A_R`**：在**共同且数据资格可核实的锚点宇宙**上，
 * 「至少一笔已完成净收益 ≥+20% 的唯一锚点数及覆盖率」之差。
 *
 * | 组 | 破位后 | 买点 |
 * |---|---|---|
 * | A `STRICT_20` | **永久停买**（继续观察） | 003 的 D：N=5 / T+20 |
 * | B `RECOVERY_20` | 进入 §3.3 修复分支 | 未破位同 A；破位后 `F` + `W=[d−5,d−1]` 综合分 ≥15 + 确认日突破放量 |
 *
 * ## 🔴 两件必须摆在最前面的事
 *
 * 1. **本实验现在拒绝产出收益矩阵**。S1 审计判定 ST 源不可 PIT 核验（E1/E2/E3）：唯一 ST 源的
 *    `availability` 全为 UNKNOWN、可获知时间全缺、84% symbol 没有任何 ST 行、948 个 ST 格的数据集
 *    `limitRuleUp` 仍为 10%。因此 `run()` 在**任何撮合之前**（也在证券身份解析之前）调用
 *    `summarizeStCoverage(...)`，只要有一个计划检查时点缺可核验结论（或 provider 在窗口探针上
 *    无结论）就以 **`ST_COVERAGE_BLOCKED`** 收口：
 *    - **正常返回**（`runStatus = SUCCEEDED`）一份 `matrixEmitted = false` 的显式结果
 *      （`eligibleCount = 0`、收益读数一律 `null`）—— 抛异常会让平台**丢弃全部产物**，
 *      「先交付覆盖缺口」（目标 §4）就落不了盘；
 *    - 同时交付**只有缺口**的产物（`st-coverage-gap-summary.json` / `status-coverage.csv` /
 *      `st-coverage-counts.csv` / `st-gap-samples.csv` / `frozen-config.json`）。
 *
 *    **绝不产出空仓矩阵冒充结论**，也**绝不**用「大面积 UNKNOWN 拒单后的空仓结果」评价新买点。
 *    `throw new StCoverageBlockedError(...)` 仍保留给「宁可失败也不产出」的直接调用方。
 * 2. **只有一个信号求值实现**：`@experiments/shared/rollingPoolRecovery#evaluateRecoveryDays`
 *    （A = 直接复用 `evaluateEarlyEntry({observationDays:5, entryFillMaxRd:20})` 的确认日；
 *    B = 同一份逐日记录 + 修复分支）。本文件**不重写**任何条件。
 *
 * ## 纪律
 *
 * - 不碰 DB（只有 `context.dataset` + 服务侧唯一实现：身份解析、数据集封装、冻结策略读取）；
 * - 不新建第二套引擎 / 指标出口 / 策略语义；全部执行经 `@experiments/compositeRunnerBridge`；
 * - 指标唯一出口 `canonicalMetrics`；无 `Math.random` / 无 `Date.now`（确定性）；
 * - `maxAmp5` **完全不参与**（`deriveEventFactors(..., () => null)`）。
 *
 * ## 处理顺序（🔴 不可调换）
 *
 * ```
 * 事件扫描（FULL_DATASET）→ 🔴 **早诊断**（provider 明确缺失 ⇒ 不读 post rd≥1，计数记「未测」后返回）
 *   → freezeSelection → prefix/post 端口读取 → 逐日池 + 因子
 *   → 逐组求值（唯一求值器）→ 价格信号（计划候选）
 *   → 🔴 ST 覆盖闸门（两时点 × 每个计划候选 + provider 窗口探针）
 *        ├─ 不可核验 ⇒ ST_COVERAGE_BLOCKED：交付覆盖缺口后**返回**（不撮合、不产出矩阵）
 *        └─ 可核验   ⇒ 继续
 *   → 证券身份解析（DB）→ 买单计划（收**确认日收盘**可核验 NORMAL 者）→ 执行投影
 *   → 权威装配（一次/组）→ 逐账户 runTradeSimulation（**成交前**再判一次 ST ⇒ ST/UNKNOWN 拒单）
 *      → canonicalMetrics → 主比较 bootstrap
 * ```
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  ExperimentBarRow,
  ExperimentDatasetFacts,
  ExperimentDefinition,
  ExperimentEventRow,
  ExperimentResultPayload,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  MAIN_WINDOW,
  PREFIX_RELATIVE_DAYS,
  buildDailyPool,
  deriveEventFactors,
  type PoolBar,
  type PoolEvent,
} from "@experiments/shared/rollingPoolRightTail";
import {
  OBSERVATION_MIN_SCORE,
  RUNNER_EXTEND_TO_HOLDING_DAYS,
  SHRINK_RATIO,
  SUPPORT_RATIO,
} from "@experiments/shared/rollingPoolEarlyEntry";
import {
  ABSENT_STATUS_PROVIDER,
  ABSENT_STATUS_PROVIDER_ID,
  CONFIRM_MAX_RD,
  KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID,
  KNOWN_ST_ONLY_POLICY_VERSION,
  ORIGINAL_ENTRY_FILL_MAX_RD,
  ORIGINAL_OBSERVATION_DAYS,
  RECOVERY_COMPUTATION_VERSION,
  RECOVERY_WINDOW_DAYS,
  REPAIR_SCORE_TOTAL_MIN,
  ST_CHECK_TIMEPOINTS,
  ST_COVERAGE_BLOCKED,
  ST_EXECUTION_ELIGIBILITY_POLICY_VERSION,
  ST_GATE_CONTRACT_VERSION,
  ST_POLICY_DEFAULT_VALUE,
  ST_POLICY_PARAMETER_CODE,
  ST_POLICY_PARAMETER_VALUES,
  StCoverageBlockedError,
  UNKNOWN_ALLOWED_THIS_ROUND_NOTE,
  WATCH_MAX_RD,
  decideKnownStOnlyEligibility,
  decideStrictEligibility,
  effectiveAtOf,
  evaluateRecoveryDaysFor,
  evaluateStGate,
  evaluateStGateForCandidate,
  resolveStEligibilityPolicy,
  summarizeStCoverage,
  type BuyEligibility,
  type KnownStLabelIndexPort,
  type KnownStLabelObservation,
  type RecoveryEvaluation,
  type SecurityStatusFact,
  type SecurityStatusProvider,
  type StCandidateGate,
  type StCheckTimepoint,
  type StCoverageCheckpoint,
  type StCoverageGapSummary,
  type StEligibilityDecision,
  type StEligibilityPolicy,
  type StGateDecision,
} from "@experiments/shared/rollingPoolRecovery";
import { pickUniformRandomSubset } from "@experiments/shared/singleFactor/rightTailMetrics";
import {
  DEFAULT_BOOTSTRAP_QUANTILES,
  movingBlockBootstrapPairedMeanDifference,
  movingBlockBootstrapPairedRatioDifference,
  type PairedBootstrapResult,
  type PairedClusterObservation,
} from "@experiments/shared/dateClusterBootstrap";
import {
  COMPOSITE_ASSEMBLY_CONFIG_CONTRACT_VERSION,
  EARLY_ENTRY_POSITION_FRACTION,
  FROZEN_RUNNER_STRATEGY_REFERENCE,
  assembleCompositeRunnerSimulationConfig,
  canonicalMetrics,
  computeCandidateEvaluationRunFingerprint,
  evaluateCandidateRun,
  eventScopedSecurityId,
  executionEligibilityStatusAllowed,
  loadFrozenRunnerPolicyBundle,
  loadKnownStLabelIndex,
  resolveRollingPoolSecurityIds,
  runTradeSimulation,
  runnerBridgeOf,
  sealRollingPoolExecutionDataset,
  /**
   * `RECOVERY-LIGHT-ST-007` TASK B —— 阶段级性能埋点（**默认关闭**，见 `perfProfile.ts`）。
   * 目标 §6：先报告测得的耗时构成，再决定是否优化；埋点不参与研究口径。
   */
  perfBegin,
  perfCount,
  perfEnd,
  perfSnapshot,
  isPerfProfilingEnabled,
  type CandidateDayRecord,
  type CandidateEvaluationRun,
  type CanonicalMetricsDetail,
  type ExecutionEligibilityAuditEntry,
  type ExecutionEligibilityGate,
  type PositionIntent,
  type ResearchDataset,
  type RollingPoolExecutionRowInput,
  type SelectedCandidate,
  type SimulationConfig,
  type TradeSimulationRun,
} from "@experiments/compositeRunnerBridge";
import {
  ADVERSE_EXCURSION_HORIZONS,
  BOOTSTRAP_BLOCK_PRIMARY,
  BOOTSTRAP_BLOCK_SENSITIVITY,
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED_PRIMARY,
  BOOTSTRAP_SEED_SENSITIVITY,
  COMPUTATION_VERSION,
  DAILY_TOP_K,
  FROZEN_DATASET_CODE,
  FROZEN_DATASET_POST_MAX_RELATIVE_DAY,
  FROZEN_DATASET_VERSION,
  FROZEN_DATASET_VERSION_ID_REFERENCE,
  FROZEN_STRATEGY_REFERENCE,
  GATE_YEARS,
  GROUP_IDS,
  GROUPS,
  INITIAL_CAPITAL,
  MAIN_WINDOW as RESULT_MAIN_WINDOW,
  MAX_DAILY_BUYS,
  MAX_POSITIONS,
  POSITION_FRACTION,
  RANDOM_ACCOUNT_COUNT_DEFAULT,
  RANDOM_ACCOUNT_COUNT_MAX,
  RECOVERY_ST_BLOCKED_ARTIFACTS,
  RECOVERY_ST_CONTRACT_GAPS,
  RECOVERY_ST_NOT_EMITTED_METRICS,
  REQUIRED_POST_RELATIVE_DAY_FOR_FULL_RUNNER as REQUIRED_POST_RELATIVE_DAY,
  RUNNER_EXTEND_HOLDING_DAYS,
  TAIL_THRESHOLDS_PCT,
  accountCoveragePerYearOf,
  anchorCoverageOf,
  assembleRecoveryStBlockedResult,
  assembleRecoveryStResult,
  recoveryStCustomPayloadSchema,
  resolveRunMode,
  tailRateBlockOf,
  judgePrimaryComparison,
  unscannedStCoverageReport,
  type AccountMetrics,
  type AdverseExcursionRow,
  type BootstrapInterval,
  type CompletedAnchorFact,
  type GroupId,
  type GroupSummary,
  type PrimaryComparison,
  type RecoveryGroupSpec,
  type RecoveryStBlockedOutput,
  type RecoveryStComputeOutput,
  type RecoveryStEligibilityPolicyBlock,
  type RecoveryStFrozenConfig,
  type RecoveryStTerminalState,
  type RunModeResolution,
  type StCoverageReport,
} from "./result";

// ---------------------------------------------------------------------------
// 冻结声明
// ---------------------------------------------------------------------------

/** 事件日下界（只为限制读取量，不改变研究范围：rd1 的最早确认日在 rd6）。 */
const EVENT_DATE_LOWER_BOUND = "2023-11-01";
/** 需要读的 post 相对日上界（= 780004 物理上界）。 */
const POST_MAX_RELATIVE_DAY = FROZEN_DATASET_POST_MAX_RELATIVE_DAY;
const POST_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: POST_MAX_RELATIVE_DAY },
  (_unused, index) => index + 1,
);
/** 执行投影的行起始日（= 主决策窗口起点）。 */
const EXECUTION_ROW_START_DATE = MAIN_WINDOW.startDate;
const SOURCE_RUN_BUILDER_VERSION = "rolling-pool-recovery-st-004-1.0.0";
/** `createdAt`：**冻结常量**（不是 `Date.now()`），使同一份代码两次运行产物逐字节可比。 */
const FROZEN_CREATED_AT = "2026-10-11T00:00:00.000Z";
/** 事件作用域身份分隔符（与 `server/eventIdentity.ts` 同形）。 */
const EVENT_SCOPE_SEPARATOR = "::event:";
/** 后台进度输出（只写 stderr，不改变研究语义）。 */
function progress(message: string): void {
  if (process.env.RECOVERY_ST_PROGRESS === "1") {
    process.stderr.write(`[recovery-st-progress] ${message}\n`);
  }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function toNullable(value: number | "NOT_AVAILABLE"): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** 归一化 bar（含 `amount`，单位千元 ⇒ 执行投影恢复流动性分层滑点）。 */
function normalizeBar(row: ExperimentBarRow): PoolBar {
  const values = row.values;
  return {
    relativeDay: row.relativeDay,
    tradeDate: row.tradeDate,
    open: asNumber(values.open),
    high: asNumber(values.high),
    low: asNumber(values.low),
    close: asNumber(values.close),
    preClose: asNumber(values.preClose),
    limitUpPrice: asNumber(values.limitUpPrice),
    limitDownPrice: asNumber(values.limitDownPrice),
    volume: asNumber(values.volume),
    amount: asNumber(values.amount),
    barPresent: asBoolean(values.barPresent) ?? true,
    suspended: asString(values.suspensionStatus) === "SUSPENDED",
    canBuyAtOpen: asBoolean(values.canBuyAtOpen),
    canSellAtClose: asBoolean(values.canSellAtClose),
  };
}

function exchangeOf(code: string): string {
  const index = code.lastIndexOf(".");
  return index < 0 ? "UNKNOWN" : code.slice(index + 1);
}

/** 事件作用域身份 ⇒ 锚点事件 id（`sec_x::event:<symbol>@<date>` ⇒ `<symbol>@<date>`）。 */
export function anchorEventIdOf(securityId: string): string {
  const index = securityId.indexOf(EVENT_SCOPE_SEPARATOR);
  return index < 0 ? securityId : securityId.slice(index + EVENT_SCOPE_SEPARATOR.length);
}

/** 事件作用域身份 ⇒ 交易代码（与 `panelCodeOf` 同形，仅用于产物展示）。 */
export function symbolOfSecurityId(securityId: string): string {
  const eventId = anchorEventIdOf(securityId);
  const at = eventId.indexOf("@");
  return at < 0 ? eventId : eventId.slice(0, at);
}

/**
 * ST provider 的**唯一注入点**。
 *
 * 🔴 平台**尚未**供给可 PIT 核验的逐日状态（S1 审计 E1/E2/E3）⇒ 这里显式返回 `null`，
 *    于是每个计划检查时点都是 `UNKNOWN` ⇒ `ST_COVERAGE_BLOCKED` ⇒ 不产出矩阵。
 *    绝不在这里「临时造一个 NORMAL 兜底」（那正是审计证伪过的做法）。
 *    补齐后（用户授权数据引入 + 新冻版本）只需在此返回真实 provider，其余代码不变。
 */
export function resolveStatusProvider(): SecurityStatusProvider | null {
  return null;
}

// ---------------------------------------------------------------------------
// FIX-005 / F1 — ST **执行资格闸门**（研究装配层 → 执行层的唯一注入实现）
// ---------------------------------------------------------------------------

/** 执行资格闸门身份（进入配置快照、逐笔审计与拒单产物）。 */
export const ST_EXECUTION_ELIGIBILITY_GATE_ID = "recovery-st-004/pre-fill-st-gate";

/**
 * provider 明确缺失时的**早诊断探针符号**。
 *
 * 🔴 刻意**不是**任何真实代码：`ABSENT_STATUS_PROVIDER`（以及 `provider === null`）在
 *    任何 symbol / 任何日期上都只可能返回 `NO_STATUS_PROVIDER`。它的存在只为证明
 *    「早诊断不是靠跳过检查得出的」。
 */
export const ST_PROVIDER_ABSENT_PROBE_SYMBOL = "(no-provider-probe)";

/**
 * 🔴 FIX-005 / F1 的**唯一**执行资格闸门实现：把「成交前 ST 复查」接到**真实撮合链**上。
 *
 * ## 它做什么
 *
 * 在引擎真正要执行某笔买入订单时（`executionDate` = 引擎当日），用**同一个**
 * `evaluateStGate(...)` 在 `PRE_FILL` 时点（当地 09:15）重新判一次状态：
 *
 * - `NORMAL` ⇒ 放行；
 * - `ST` / `UNKNOWN` / 任何其它 ⇒ `allowed=false`，引擎在**扣现金 / 建仓 / 计成本 /
 *   计成功入场次数之前**拒单，并保留原因；
 * - `checkedAt` = 实际检查时刻；`plannedCheckDate` = 意图产生的决策日 ⇒ **计划 vs 实际**
 *   可对照（引擎可能在决策日之后的某日才真正执行，检查必须发生在**当时**）。
 *
 * ## 它**不**做什么（F1 第 3、5 条的落点）
 *
 * - 不参与**前日排序**：候选池、Top3、Random 抽样、日买入数、持仓限制、当日权益仓位与
 *   再入场规则全部保持原样（本闸门在**成交时点**才被调用，晚于一切排序与抽样）。
 * - 不删交易、不改收益、不把 ST 写成停牌、不改涨停字段、不另造撮合循环。
 * - 不进入持久化 JSON：引擎只把**判决事实**（可序列化）写进
 *   `TradeSimulationRun.executionEligibilityAudit`，函数本身留在内存。
 */
export function createStExecutionEligibilityGate(args: {
  readonly provider: SecurityStatusProvider;
  readonly gateId?: string;
}): ExecutionEligibilityGate {
  const gateId = args.gateId ?? ST_EXECUTION_ELIGIBILITY_GATE_ID;
  return {
    gateId,
    policyVersion: ST_EXECUTION_ELIGIBILITY_POLICY_VERSION,
    decideBuy: (input) => {
      const checkedAt = effectiveAtOf(input.executionDate, "PRE_FILL");
      const decision = evaluateStGate({
        provider: args.provider,
        query: {
          symbol: symbolOfSecurityId(input.securityId),
          tradeDate: input.executionDate,
          timepoint: "PRE_FILL",
          effectiveAt: checkedAt,
        },
      });
      return {
        allowed: decision.outcome === "NORMAL",
        status: decision.outcome,
        reason: decision.reason,
        providerId: decision.providerId,
        policyVersion: ST_EXECUTION_ELIGIBILITY_POLICY_VERSION,
        evidenceFingerprint: decision.fact?.evidenceFingerprint ?? null,
        checkedAt,
        plannedCheckDate: input.plannedDate,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// `RECOVERY-LIGHT-ST-007` §4 — **轻量 ST 资格政策**的注入实现（研究装配层）
// ---------------------------------------------------------------------------

/** 轻量政策的执行资格闸门身份（**与严格闸门是两个身份**，不共用冻结配置）。 */
export const ST_KNOWN_ST_ONLY_EXECUTION_ELIGIBILITY_GATE_ID =
  "recovery-light-st-007/known-st-only-prefill-gate";

/** 轻量政策的 provider 身份（研究侧唯一 ST 来源 = 平台已有 ST 维度历史标签）。 */
export const KNOWN_ST_ONLY_PROVIDER_ID =
  "research_security_status_history#statusType=ST";

/**
 * 🔴 `RECOVERY-LIGHT-ST-007` 的**唯一**执行资格闸门实现：把「已知 ST 才拒绝」接到真实撮合链上。
 *
 * ## 它做什么
 *
 * 引擎在真实要执行某笔买入订单时（`executionDate` = 引擎当日），用**标签索引**在该日
 * （`PRE_FILL` 时点，当地 09:15）复查一次：
 *
 * - 已知 ST 区间覆盖 ⇒ `status = "ST"`、`allowed = false` ⇒ 引擎在**扣现金 / 建仓 / 计成本 /
 *   计成功入场次数之前**拒单；
 * - 明确正常记录 ⇒ `status = "NORMAL"`、放行；
 * - 其它（无记录 / 身份无法解析 / 证据不能判断）⇒ `status = "UNKNOWN"`、**本轮允许**⇒放行，
 *   但审计**保留 `UNKNOWN`**（**绝不**改写为 `NORMAL`）。
 *
 * ## 它**不**做什么
 *
 * - 不参与**前日排序**：候选池 / Top3 / Random 抽样 / 日买入数 / 持仓限制 / 当日权益仓位与
 *   再入场规则全部保持原样（本闸门在**成交时点**才被调用，晚于一切排序与抽样）。
 * - 不删交易、不改收益、不伪造 `NORMAL`、不另造撮合循环。
 * - 不把「交易身份无法解析」当成可成交：身份解析在候选阶段就已如实丢弃并计数。
 */
export function createKnownStOnlyEligibilityGate(args: {
  readonly index: KnownStLabelIndexPort;
  readonly gateId?: string;
  readonly policy?: StEligibilityPolicy;
}): ExecutionEligibilityGate {
  const gateId = args.gateId ?? ST_KNOWN_ST_ONLY_EXECUTION_ELIGIBILITY_GATE_ID;
  const policy = args.policy ?? resolveStEligibilityPolicy("known-st-only");
  return {
    gateId,
    policyVersion: policy.version,
    decideBuy: (input) => {
      const checkedAt = effectiveAtOf(input.executionDate, "PRE_FILL");
      const decision: StEligibilityDecision = decideKnownStOnlyEligibility({
        index: args.index,
        symbol: symbolOfSecurityId(input.securityId),
        checkDate: input.executionDate,
      });
      return {
        allowed: decision.allowedToExecute,
        // 🔴 真实状态**原样**返回（`UNKNOWN` 保留）。
        status: decision.status,
        reason: decision.reason,
        providerId: KNOWN_ST_ONLY_PROVIDER_ID,
        policyVersion: decision.policyVersion,
        evidenceFingerprint: decision.observation.fact?.evidenceFingerprint ?? null,
        checkedAt,
        plannedCheckDate: input.plannedDate,
      };
    },
  };
}

/** 轻量政策的来源/覆盖读数（进冻结配置与产物，不是优化目标）。 */
export interface KnownStLightSourceReadout {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly exploratory: true;
  readonly strictPit: false;
  readonly sourceId: string;
  readonly sourceFingerprint: string;
  /** 读到的来源行数（**一次性读取**）。 */
  readonly rowsRead: number;
  readonly securityCount: number;
  readonly identifierRowCount: number;
  readonly explicitNormalRowCount: number;
  readonly availabilityCounts: Readonly<Record<string, number>>;
  readonly confidenceCounts: Readonly<Record<string, number>>;
  readonly tablesRead: readonly string[];
  readonly note: string;
}

function knownStLightSourceReadoutOf(index: KnownStLabelIndexPort): KnownStLightSourceReadout {
  return {
    policyId: KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID,
    policyVersion: KNOWN_ST_ONLY_POLICY_VERSION,
    exploratory: true,
    strictPit: false,
    sourceId: index.sourceId,
    sourceFingerprint: index.sourceFingerprint,
    rowsRead: index.rowCount,
    securityCount: index.securityCount,
    identifierRowCount: index.identifierRowCount,
    explicitNormalRowCount: index.explicitNormalRowCount,
    availabilityCounts: { ...index.availabilityCounts },
    confidenceCounts: { ...index.confidenceCounts },
    tablesRead: [...index.tablesRead],
    note:
      "🔴 **历史标签排查，不是严格 PIT provider**：来源表的 `availability` 全为 UNKNOWN、"
      + "无 `availableAsOf` 列、`retrievedAt` 全在窗口后约一年（RESULT-…-ST-DATA-READINESS-006 §2）。"
      + "本索引因此**不构造**可获知时间、**不修改** availability/confidence、"
      + "**不把缺席派生成 NORMAL**（无覆盖 ⇒ UNKNOWN）。",
  };
}

// ---------------------------------------------------------------------------
// 可被直接测试的纯函数（不读 DB、不依赖运行期状态）
// ---------------------------------------------------------------------------

/** 账户层唯一的成交期限判据：`fillRd = confirmRd + 1 ≤ L` 且 `confirmRd ∈ [N+1, L−1]`。 */
export function fillRdWithinCap(confirmRd: number, entryFillMaxRd: number): boolean {
  return Number.isInteger(confirmRd)
    && Number.isInteger(entryFillMaxRd)
    && confirmRd >= ORIGINAL_OBSERVATION_DAYS + 1
    && confirmRd <= entryFillMaxRd - 1
    && confirmRd <= CONFIRM_MAX_RD
    && confirmRd + 1 <= entryFillMaxRd;
}

/** 排序（破平键必须确定性：`preReturn10` 降序 → symbol 升序 → anchorEventId 升序）。 */
export function sortCandidates<
  T extends { readonly preReturn10: number; readonly symbol: string; readonly anchorEventId: string },
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (left, right) =>
      right.preReturn10 - left.preReturn10
      || left.symbol.localeCompare(right.symbol)
      || left.anchorEventId.localeCompare(right.anchorEventId),
  );
}

/**
 * 🔴 `SORT-PARITY-008` §4.1 —— R 臂**每日候选选择入口的唯一实现**（排序修复点）。
 *
 * ## 007 的缺陷（`RESULT-…-LOSS-ATTRIBUTION-007` §3）
 *
 * `run()` 里 `sortCandidates(candidateRows);` 的**返回值被丢弃**，于是 `intentsOf` 从
 * **未排序**的当日 cells 直接 `slice(0, DAILY_TOP_K)` —— 实际选中的是 `buildDailyPool`
 * 的**代码升序**前 3 名，而不是声明的 `preReturn10` 前三名；候选排名产物又**另排一次**，
 * 于是 `selectedByR` 与真实计划脱节（A 因子排名>3 的成交 6 笔、B 32 笔）。
 *
 * ## 修复口径
 *
 * 「排序 → 取前 K」必须由**同一个**结果承载，计划与诊断都只能消费它：
 *
 * | 字段 | 含义 | 谁消费 |
 * |---|---|---|
 * | `participants` | 当日参与排序的候选（**原始输入顺序，不重排**） | 只作读数（参与候选数）；Random 抽样继续用外层 `plannableByDate` 的原顺序 |
 * | `ranking` | `sortCandidates` 的**返回值**（全序） | 诊断的 `rankByPreReturn10` |
 * | `selected` | `ranking.slice(0, topK)`，顺序即计划顺序 | R 的 `intentsByDate`（真实计划） |
 *
 * 🔴 **`participants` 刻意保持原始输入顺序**：`pickUniformRandomSubset` 按**输入下标**取样
 *    （`index.slice(0, k).map((i) => eventIds[i])`），重排会让同种子抽样发生变化
 *    ⇒ 违反 §4.1「不要为了修 R 重排 Random 的输入列表」。因此本函数**不**在原地重排 cells，
 *    也**不**把排序结果写回 `candidateRows` / `plannableByDate`。
 */
export interface DailyFactorSelection<T> {
  readonly topK: number;
  /** 参与排序的候选（原始输入顺序；**不是**排序结果）。 */
  readonly participants: readonly T[];
  /** 因子全序（`preReturn10` 降序 → symbol 升序 → eventId 升序）。 */
  readonly ranking: readonly T[];
  /** 实际进入 R 计划的集合 = `ranking.slice(0, topK)`（顺序即真实计划顺序）。 */
  readonly selected: readonly T[];
}

/** 消费 `sortCandidates` 的**返回值**并取前 K（R 每日选择的唯一入口，见 `DailyFactorSelection`）。 */
export function selectDailyTopByFactor<
  T extends { readonly preReturn10: number; readonly symbol: string; readonly anchorEventId: string },
>(cells: readonly T[], topK: number): DailyFactorSelection<T> {
  const participants = [...cells];
  const ranking = sortCandidates(participants);
  return {
    topK,
    participants,
    ranking,
    selected: ranking.slice(0, Math.max(0, topK)),
  };
}

/**
 * 🔴 `SORT-PARITY-008` §4.1 —— 候选**未进入当日排序**的唯一判据。
 *
 * 判据顺序与冻结顺序一致（`§4.1`：确认日价格信号 → 当日 ST 参与资格 → 身份可解析 →
 * R 排序 / Random 抽样 → 计划 → 撮合前检查）：
 *
 * 1. 身份可解析（`securityId` 必须是真的，不猜、不递补）；
 * 2. 确认日收盘时点的 ST 政策判决允许参与（`participatesInRanking`）。
 *
 * `null` = **参与排序**。计划侧（`plannableByDate`）与诊断侧**共用本函数**
 * ⇒ 「入选集合」与「参与名次」在结构上不可能各说各话。
 *
 * 🔴 已知 ST / 身份不可解析的候选**仍然留在原始信号账**里，但必须被明确标成
 *    **未参与排序、未入选**，其名次不得与参与候选的名次混同（§4.2）。
 */
export type CandidateExclusionReason = "IDENTITY_UNRESOLVED" | "ST_POLICY_NOT_PARTICIPATING";

export function candidateExclusionReasonOf(args: {
  readonly identityResolved: boolean;
  readonly policyParticipatesInRanking: boolean;
}): CandidateExclusionReason | null {
  if (!args.identityResolved) return "IDENTITY_UNRESOLVED";
  if (!args.policyParticipatesInRanking) return "ST_POLICY_NOT_PARTICIPATING";
  return null;
}

/** 候选与排名诊断的**列顺序**（构造与产物共用一份，避免两处漂移）。 */
export const CANDIDATE_RANKING_DIAGNOSTIC_COLUMNS: readonly string[] = [
  "group", "date", "anchorEventId", "symbol", "securityId", "branch", "eventAge", "confirmRd",
  "fillRd", "fillDate", "preReturn10", "poolSizeThatDay", "participantCountThatDay",
  "identityResolved", "participatesInRanking", "exclusionReason", "rankByPreReturn10",
  "selectedByR", "rPlanOrder", "confirmCloseBuyEligibility", "twoTimepointBuyAllowed",
  "repairEpisodeId", "localLowRd", "repairWindowScore", "rFillDate", "rFillEvidenceRef",
  "rNotFilledReason", "rNotFilledEvidenceRef", "sortingSource", "tieBreakKey",
];

/**
 * 🔴 `SORT-PARITY-008` §4.2 —— 候选与排名诊断行的**唯一构造点**。
 *
 * 它消费的是**同一份选择结果**：
 *   - `signalRows`：**原始价格信号账**（含身份不可解析 / 已知 ST 被政策排除者）；
 *   - `resolvedRows`：身份可解析子集（只用来取真实 `securityId`，不改变名次）；
 *   - `rSelectionByDate`：R 每日选择的 `DailyFactorSelection` —— **与 R 计划是同一个对象**
 *     （`plans[0].intentsByDate` 就是由它的 `selected` 保序翻译出来的）。
 *
 * 逐候选可核实（§4.2）：确认日期 / group / anchorEventId / symbol / `preReturn10`；
 * 当日是否可参与 + 排除原因 + **参与候选数** + 实际因子名次与破平键；是否进入 R 计划 +
 * **真实计划顺序**；成交 / 未成交的日期与**证据引用**。
 *
 * 🔴 未参与者（`identityResolved=false` 或政策不允许）的 `rankByPreReturn10` 一律**留空**：
 *    它们的名次**不得**与参与候选的名次混同；`selectedByR` 恒为 `false`。
 * 🔴 这里**不再自行排序**：输出顺序只是「按日期 → 参与名次 → symbol → anchorEventId」的
 *    确定性排序，名次本身来自 `rSelectionByDate`。
 */
export function candidateRankingDiagnosticsRowsOf(args: {
  readonly groupId: string;
  readonly signalRows: readonly CandidateRow[];
  readonly resolvedRows: readonly CandidateRow[];
  readonly rSelectionByDate: ReadonlyMap<string, DailyFactorSelection<CandidateRow>>;
  readonly candidateGates: ReadonlyMap<string, StCandidateGate>;
  /** R 账户**真实**成交记录（键 = `anchorEventId\u0000confirmDate`）。 */
  readonly rFillByKey: ReadonlyMap<string, Record<string, unknown>>;
  /** R 账户**真实**跳过记录（键 = `anchorEventId\u0000attemptedConfirmDate`）。 */
  readonly rSkipByKey: ReadonlyMap<string, string>;
}): Record<string, unknown>[] {
  const resolvedByKey = new Map<string, CandidateRow>();
  for (const row of args.resolvedRows) {
    resolvedByKey.set(`${row.anchorEventId}\u0000${row.confirmRd}`, row);
  }
  const signalCountByDate = new Map<string, number>();
  for (const row of args.signalRows) {
    signalCountByDate.set(row.date, (signalCountByDate.get(row.date) ?? 0) + 1);
  }
  const drafts: { readonly order: readonly (string | number)[]; readonly row: Record<string, unknown> }[] = [];
  for (const signal of args.signalRows) {
    /**
     * 🔴 `SIGNAL-EXIT-009` §A.1（008 F1）：**两个键，两个用途**。
     *
     * - `identityKey`（`anchorEventId\u0000confirmRd`）＝**身份 / 排序**键，只用于解析 `securityId`；
     * - `confirmDateKey`（`anchorEventId\u0000confirmDate`）＝**成交 / 跳过证据**键，
     *   必须与 `#run` 建 `rFillByKey` / `rSkipByKey` 时用的键**完全一致**。
     *
     * 008 的缺陷是拿 `identityKey` 去查按确认**日期**建的 Map ⇒ 相对日整数与日期字符串
     * 永不相等 ⇒ 证据栏**静默全空**。这里保留身份键不动，另用确认日期键对接证据。
     * 实际排序、订单生成与撮合入口**不经过本函数**，故不受影响。
     */
    const identityKey = `${signal.anchorEventId}\u0000${signal.confirmRd}`;
    const confirmDateKey = `${signal.anchorEventId}\u0000${signal.date}`;
    const resolved = resolvedByKey.get(identityKey) ?? null;
    const selection = args.rSelectionByDate.get(signal.date) ?? null;
    const exclusionReason = candidateExclusionReasonOf({
      identityResolved: resolved !== null,
      policyParticipatesInRanking: signal.confirmCloseStEligibility.participatesInRanking,
    });
    const participated = exclusionReason === null;
    const rankIndex = participated && selection !== null
      ? selection.ranking.findIndex(
        (cell) => cell.anchorEventId === signal.anchorEventId && cell.confirmRd === signal.confirmRd,
      )
      : -1;
    const selectedIndex = rankIndex >= 0 && selection !== null
      ? selection.selected.findIndex(
        (cell) => cell.anchorEventId === signal.anchorEventId && cell.confirmRd === signal.confirmRd,
      )
      : -1;
    const gate = args.candidateGates.get(`${args.groupId}\u0000${signal.anchorEventId}\u0000${signal.confirmRd}`) ?? null;
    const filled = args.rFillByKey.get(confirmDateKey) ?? null;
    const fillDate = typeof filled?.fillDate === "string" ? filled.fillDate : "";
    const skipReason = args.rSkipByKey.get(confirmDateKey) ?? "";
    drafts.push({
      order: [
        signal.date,
        rankIndex >= 0 ? rankIndex + 1 : Number.MAX_SAFE_INTEGER,
        signal.symbol,
        signal.anchorEventId,
      ],
      row: {
        group: args.groupId,
        date: signal.date,
        anchorEventId: signal.anchorEventId,
        symbol: signal.symbol,
        securityId: resolved?.securityId ?? "",
        branch: signal.branch,
        eventAge: signal.eventAge,
        confirmRd: signal.confirmRd,
        fillRd: signal.fillRd,
        fillDate: signal.fillDate ?? "",
        preReturn10: signal.preReturn10,
        /** 🔴 原始价格信号账在该日的**全部行数**（含身份不可解析与被政策排除者）。 */
        poolSizeThatDay: signalCountByDate.get(signal.date) ?? 0,
        /** 🔴 该日**真正参与排序**的候选数 —— 因子名次的真实分母。 */
        participantCountThatDay: selection?.participants.length ?? 0,
        identityResolved: resolved !== null,
        participatesInRanking: participated,
        exclusionReason: exclusionReason ?? "",
        /** 🔴 未参与者留空（不把原始价格候选的顺序冒充因子名次）。 */
        rankByPreReturn10: rankIndex >= 0 ? rankIndex + 1 : "",
        selectedByR: selectedIndex >= 0,
        /** 🔴 真实计划顺序（`selected` 内的位置 = `AccountIntent.rank`）；未入选留空。 */
        rPlanOrder: selectedIndex >= 0 ? selectedIndex + 1 : "",
        confirmCloseBuyEligibility: signal.confirmCloseBuyEligibility,
        twoTimepointBuyAllowed: gate?.buyAllowed ?? false,
        repairEpisodeId: signal.repairEpisodeId ?? "",
        localLowRd: signal.localLowRd ?? "",
        repairWindowScore: signal.repairWindowScore ?? "",
        rFillDate: fillDate,
        rFillEvidenceRef: fillDate === ""
          ? ""
          : `st-fill-audit-${args.groupId}.csv#account=R&anchorEventId=${signal.anchorEventId}&fillDate=${fillDate}`,
        /** 未成交原因（来自真实 `run.skipped`；没有跳过记录时留空，不猜）。 */
        rNotFilledReason: fillDate === "" ? skipReason : "",
        rNotFilledEvidenceRef: fillDate !== "" || skipReason === ""
          ? ""
          : `anchor-failed-attempts.csv#account=R&anchorEventId=${signal.anchorEventId}`
            + `&attemptedConfirmDate=${signal.date}`,
        sortingSource: selectedIndex >= 0
          ? "DailyFactorSelection.selected（与 R 计划同一个结果）"
          : (participated ? "DailyFactorSelection.ranking（参与排序但未入选 Top3）" : "未参与排序"),
        tieBreakKey: "preReturn10 降序 → symbol 升序 → eventId 升序",
      },
    });
  }
  drafts.sort((left, right) => {
    for (let index = 0; index < left.order.length; index += 1) {
      const a = left.order[index]!;
      const b = right.order[index]!;
      if (a === b) continue;
      if (typeof a === "number" && typeof b === "number") return a - b;
      return String(a).localeCompare(String(b));
    }
    return 0;
  });
  return drafts.map((draft) => draft.row);
}

/** 前 `horizonDays` 个交易日的不利波动（相对入场价的最低点，%）：缺 bar ⇒ null（**不补价**）。 */
export function adverseExcursionOf(args: {
  readonly post: ReadonlyMap<number, PoolBar>;
  readonly fillRd: number;
  readonly entryPrice: number;
  readonly horizonDays: number;
}): number | null {
  if (!(args.entryPrice > 0)) return null;
  let worst: number | null = null;
  for (let offset = 0; offset < args.horizonDays; offset += 1) {
    const bar = args.post.get(args.fillRd + offset);
    if (bar === undefined || !bar.barPresent || typeof bar.low !== "number" || !(bar.low > 0)) {
      return null;
    }
    const ratio = bar.low / args.entryPrice - 1;
    worst = worst === null ? ratio : Math.min(worst, ratio);
  }
  return worst === null ? null : worst * 100;
}

/**
 * 覆盖缺口摘要 ⇒ **可序列化报告**（**不做判定**，只翻译）。
 *
 * 与 `stCoverageReportOf` 的分工：
 *   - 本函数**无论如何都返回**报告（暂停终态也要把缺口放进结果信封与产物）；
 *   - `stCoverageReportOf` = 本函数 + `blocked` 时 `throw`，
 *     留给「宁可失败也不产出」的直接调用方（工具 / 将来的调用点）。
 */
export function stCoverageReportLiteral(
  summary: StCoverageGapSummary,
  providerId: string | null,
): StCoverageReport {
  return {
    measurement: "MEASURED" as const,
    status: summary.status,
    contractVersion: ST_GATE_CONTRACT_VERSION,
    providerId: providerId ?? ABSENT_STATUS_PROVIDER_ID,
    candidateCount: summary.candidateCount,
    timepointChecks: summary.timepointChecks,
    verifiedNormalCount: summary.verifiedNormalCount,
    stRejectedCount: summary.stRejectedCount,
    unknownCount: summary.unknownCount,
    unknownByTimepoint: { ...summary.unknownByTimepoint },
    unknownByReason: { ...summary.unknownByReason },
    gapSamples: summary.gapSamples.map((gap) => ({ ...gap })),
    blocked: summary.blocked,
    note: summary.note,
  };
}

/**
 * 🔴 **ST 覆盖闸门的唯一判定点**（真闸门，不是注释）。
 *
 * 由覆盖缺口摘要产出报告；`blocked === true` ⇒ `throw new StCoverageBlockedError(summary)`
 * ⇒ 调用方在任何撮合之前退出，**不产出收益矩阵**、也**不产出空仓结果**冒充结论（目标 §4）。
 *
 * 抽成导出纯函数是为了让测试**不接 DB**就能钉住这条闸门：
 * 闸门一旦被改成「只记日志」或「缺数据按 NORMAL」，测试当场变红。
 *
 * 🔴 `run()` **不**走这条抛异常路径（抛出去会让平台丢弃全部 `context.artifact`，
 *    缺口产物就落不了盘）—— 它走 `assembleRecoveryStBlockedResult(...)` 的**显式返回**路径。
 *    本函数保留给「宁可失败也不产出」的直接调用方。
 */
export function stCoverageReportOf(
  summary: StCoverageGapSummary,
  providerId: string | null,
): StCoverageReport {
  const report = stCoverageReportLiteral(summary, providerId);
  if (summary.blocked) throw new StCoverageBlockedError(summary);
  return report;
}

/** 计数桶自增（`Record<string, number>` 的唯一写法，避免各处重复 `?? 0`）。 */
function bumpByKey(bucket: Record<string, number>, key: string, count = 1): void {
  if (count <= 0) return;
  bucket[key] = (bucket[key] ?? 0) + count;
}

/**
 * 逐候选 × 逐检查时点的**状态覆盖证据**（`status-coverage.csv` 的行）。
 *
 * 🔴 事实字段一律**照抄**闸门命中的事实；没有事实就留空 ⇒ 读出来就是 `UNKNOWN`
 *    （**绝不**因为「看起来像正常」而填一个 NORMAL 区间）。
 * 本函数是暂停路径与正式路径的**同一个**实现，避免两条路径给出不同的覆盖证据。
 */
function statusCoverageRowsOf(args: {
  readonly plannings: Iterable<readonly [GroupId, GroupPlanning]>;
  readonly candidateGates: ReadonlyMap<string, StCandidateGate>;
  readonly fallbackProviderId: string;
}): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const [groupId, planning] of args.plannings) {
    for (const candidate of planning.candidateRows) {
      const gate = args.candidateGates.get(
        `${groupId}\u0000${candidate.anchorEventId}\u0000${candidate.confirmRd}`,
      ) ?? null;
      const sides: readonly {
        readonly timepoint: StCheckTimepoint;
        readonly tradeDate: string;
        readonly decision: StGateDecision | null;
      }[] = [
        {
          timepoint: "CONFIRM_CLOSE_ELIGIBILITY" as const,
          tradeDate: candidate.date,
          decision: gate?.confirmClose ?? null,
        },
        {
          timepoint: "PRE_FILL" as const,
          tradeDate: candidate.fillDate ?? candidate.date,
          decision: gate?.preFill ?? null,
        },
      ];
      for (const side of sides) {
        const decision = side.decision;
        rows.push({
          group: groupId,
          anchorEventId: candidate.anchorEventId,
          symbol: candidate.symbol,
          confirmDate: candidate.date,
          plannedFillDate: candidate.fillDate ?? "",
          timepoint: side.timepoint,
          tradeDate: side.tradeDate,
          effectiveAt: effectiveAtOf(side.tradeDate, side.timepoint),
          providerId: decision?.providerId ?? args.fallbackProviderId,
          providerContractVersion: decision?.providerContractVersion ?? "",
          outcome: decision?.outcome ?? "UNKNOWN",
          buyEligibility: decision?.buyEligibility ?? "UNKNOWN_BLOCKED",
          reason: decision?.reason ?? "NO_PLANNED_FILL_TIMEPOINT",
          source: decision?.fact?.source ?? "",
          status: decision?.fact?.status ?? "",
          effectiveFrom: decision?.fact?.effectiveFrom ?? "",
          effectiveTo: decision?.fact?.effectiveTo ?? "",
          availableAsOf: decision?.fact?.availableAsOf ?? "",
          confidence: decision?.fact?.confidence ?? "",
          evidenceFingerprint: decision?.fact?.evidenceFingerprint ?? "",
        });
      }
    }
  }
  return rows;
}

const STATUS_COVERAGE_COLUMNS: readonly string[] = [
  "group", "anchorEventId", "symbol", "confirmDate", "plannedFillDate", "timepoint", "tradeDate",
  "effectiveAt", "providerId", "providerContractVersion", "outcome", "buyEligibility", "reason",
  "source", "status", "effectiveFrom", "effectiveTo", "availableAsOf", "confidence",
  "evidenceFingerprint",
];

/** CSV 序列化（产物专用；**纯函数**，无 IO）。
 *
 * 与 `rolling-pool-observation-window` 的同名辅助同口径：`null`/`undefined` ⇒ 空串，
 * 含逗号/引号/换行的字段加引号转义；**不**对缺失值填 0。
 */
function toCsv(header: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      header
        .map((key) => {
          const value = row[key];
          if (value === null || value === undefined) return "";
          if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
          if (typeof value === "boolean") return value ? "true" : "false";
          const text = String(value);
          return text.includes(",") || text.includes('"') || text.includes("\n")
            ? `"${text.replace(/"/g, '""')}"`
            : text;
        })
        .join(","),
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 🔴 `SORT-PARITY-008` §5 —— 本实验**产物打包层**的无损压缩（不提高平台上限）
// ---------------------------------------------------------------------------

/**
 * 压缩门槛：**固定 1 MiB**。低于它的产物按原文交付（保证结果摘要 / 小表**直接可读**，
 * 且旧普通 CSV 读取路径完全不变）。
 */
export const ARTIFACT_COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;
/** 无损 gzip 级别（1 = 最快；007 只读实测：688,592,665 B ⇒ 46,064,897 B）。 */
export const ARTIFACT_COMPRESSION_LEVEL = 1;
/** 压缩交付的 MIME（**真实二进制 body**，绝不把压缩字节当 UTF-8 字符串）。 */
export const ARTIFACT_COMPRESSION_CONTENT_TYPE = "application/gzip";

/** 压缩索引的一行（逻辑名 → 真实对象名；外部引用与分析工具据此解析）。 */
export interface ArtifactCompressionIndexEntry {
  readonly logicalName: string;
  readonly objectName: string;
  readonly role: string;
  readonly encoding: "identity" | "gzip";
  readonly contentType: string;
  readonly originalBytes: number;
  readonly deliveredBytes: number;
  readonly originalSha256: string;
  readonly lineCount: number;
  readonly note: string;
}

/** 打包后的交付规格（可直接交给 `context.artifact`）。 */
export interface PackedDeliveryArtifact {
  readonly name: string;
  readonly role: "table" | "chart" | "log" | "artifact";
  readonly body: string | Uint8Array;
  readonly contentType: string;
}

/** 压缩索引的列顺序（构造与产物共用一份）。 */
export const ARTIFACT_COMPRESSION_INDEX_COLUMNS: readonly string[] = [
  "logicalName", "objectName", "role", "encoding", "contentType",
  "originalBytes", "deliveredBytes", "originalSha256", "lineCount", "note",
];

/**
 * 🔴 `SORT-PARITY-008` §5 —— **本实验打包层**的无损 gzip。
 *
 * ## 为什么要在这里做（而不是改平台）
 *
 * 平台上限（单件 64 MiB / 总量 256 MiB / 100 件）**保持不变**：`opportunity-day-attribution.csv`
 * 单件 ~312 MB、6 份观察账合计 ~374 MB ⇒ 单纯 CSV 切片解决不了**总量**限制。
 * 因此压缩只在本实验的产物打包层发生，`context.artifact` / ArtifactStorage 的公共契约不变。
 *
 * ## 无损保证
 *
 * - 只做 gzip，**不采样 / 不删未触发观察日 / 不截断年份 / 不筛赢家**：body 逐字节就是原文；
 * - 索引记录原文 SHA-256 与原始字节数、行数 ⇒ 每件 gzip 解压后必须与 `originalSha256` 一致；
 * - `contentType` 显式 `application/gzip`，body 是**真二进制**（`Uint8Array`）；
 * - 逻辑名保留在索引里，实际对象名 = `${logicalName}.gz`（由索引解析，不靠猜扩展名）。
 */
export function packArtifactForDelivery(spec: {
  readonly name: string;
  readonly role: "table" | "chart" | "log" | "artifact";
  readonly body: string | Uint8Array;
  readonly contentType: string;
  /** `false` = 强制按原文交付（结果摘要 / 索引等必须直接可读的小表已天然低于门槛）。 */
  readonly compressible?: boolean;
}): { readonly packed: PackedDeliveryArtifact; readonly indexEntry: ArtifactCompressionIndexEntry } {
  const bytes = typeof spec.body === "string" ? Buffer.from(spec.body, "utf8") : Buffer.from(spec.body);
  const originalSha256 = createHash("sha256").update(bytes).digest("hex");
  const lineCount = typeof spec.body === "string"
    ? (spec.body.length === 0 ? 0 : spec.body.split("\n").length)
    : 0;
  const compress = (spec.compressible ?? true) && bytes.byteLength >= ARTIFACT_COMPRESSION_THRESHOLD_BYTES;
  if (!compress) {
    return {
      packed: { name: spec.name, role: spec.role, body: spec.body, contentType: spec.contentType },
      indexEntry: {
        logicalName: spec.name,
        objectName: spec.name,
        role: spec.role,
        encoding: "identity",
        contentType: spec.contentType,
        originalBytes: bytes.byteLength,
        deliveredBytes: bytes.byteLength,
        originalSha256,
        lineCount,
        note: (spec.compressible ?? true)
          ? `未达压缩门槛 ${ARTIFACT_COMPRESSION_THRESHOLD_BYTES} B：按**原文**交付，读取路径不变。`
          : "显式声明不压缩（结果摘要 / 索引类必须直接可读）：按**原文**交付。",
      },
    };
  }
  const compressed = gzipSync(bytes, { level: ARTIFACT_COMPRESSION_LEVEL });
  return {
    packed: {
      name: `${spec.name}.gz`,
      role: spec.role,
      body: compressed,
      contentType: ARTIFACT_COMPRESSION_CONTENT_TYPE,
    },
    indexEntry: {
      logicalName: spec.name,
      objectName: `${spec.name}.gz`,
      role: spec.role,
      encoding: "gzip",
      contentType: ARTIFACT_COMPRESSION_CONTENT_TYPE,
      originalBytes: bytes.byteLength,
      deliveredBytes: compressed.byteLength,
      originalSha256,
      lineCount,
      note:
        `无损 gzip level ${ARTIFACT_COMPRESSION_LEVEL}；**完整行/列/顺序/数值**未改。`
        + `解压后 UTF-8 还原的字节与 logicalName 原件的 SHA-256 必须等于 originalSha256；`
        + "完整明细经既有后端下载后由工具解压，不在网页内展开。",
    },
  };
}

/** 压缩索引 CSV 正文（构造与产物、工具与测试共用一份；避免两处列顺序漂移）。 */
export function compressionIndexCsvOf(entries: readonly ArtifactCompressionIndexEntry[]): string {
  return toCsv(
    [...ARTIFACT_COMPRESSION_INDEX_COLUMNS],
    entries as unknown as Record<string, unknown>[],
  );
}

/** 冻结配置的**唯一**字面量构造点（暂停路径与正式路径共用，避免两处漂移）。 */
function frozenConfigLiteral(
  runMode: RunModeResolution,
  facts: ExperimentDatasetFacts,
  stPolicy: StEligibilityPolicy,
): RecoveryStFrozenConfig {
  return {
    datasetCode: FROZEN_DATASET_CODE,
    datasetVersionId: facts.datasetVersionId,
    datasetVersionLabel: facts.datasetVersionLabel,
    mainWindowStart: MAIN_WINDOW.startDate,
    mainWindowEnd: MAIN_WINDOW.endDate,
    positionFraction: POSITION_FRACTION,
    maxPositions: MAX_POSITIONS,
    maxDailyBuys: MAX_DAILY_BUYS,
    initialCapital: INITIAL_CAPITAL,
    dailyTopK: DAILY_TOP_K,
    randomAccountCount: runMode.randomAccountCount,
    randomSeedIndexBase: runMode.seedIndexes[0] ?? 0,
    runMode: runMode.mode,
    accountsPerGroup: runMode.accountsPerGroup,
    totalAccountCount: runMode.totalAccountCount,
    supportRatio: SUPPORT_RATIO,
    shrinkRatio: SHRINK_RATIO,
    observationMinScore: OBSERVATION_MIN_SCORE,
    runnerExtendHoldingDays: RUNNER_EXTEND_HOLDING_DAYS,
    datasetPostMaxRelativeDay: FROZEN_DATASET_POST_MAX_RELATIVE_DAY,
    strategyVersionId: FROZEN_STRATEGY_REFERENCE.strategyVersionId,
    strategyVersion: FROZEN_STRATEGY_REFERENCE.version,
    strategyFingerprint: FROZEN_STRATEGY_REFERENCE.fingerprint,
    referenceRunId: FROZEN_STRATEGY_REFERENCE.referenceRunId,
    bootstrapIterations: BOOTSTRAP_ITERATIONS,
    bootstrapBlockPrimary: BOOTSTRAP_BLOCK_PRIMARY,
    bootstrapBlockSensitivity: BOOTSTRAP_BLOCK_SENSITIVITY,
    bootstrapSeedPrimary: BOOTSTRAP_SEED_PRIMARY,
    bootstrapSeedSensitivity: BOOTSTRAP_SEED_SENSITIVITY,
    stGateContractVersion: ST_GATE_CONTRACT_VERSION,
    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §4：**本轮 ST 资格政策身份**。
     *
     * 缺省（严格）时这里如实写严格政策的 id / 版本 ⇒ 「同一冻结配置冒充两种结果」在结构上不可能：
     * 轻量模式跑出的冻结配置**必然**与严格模式不同（id、version、exploratory 三处都不同）。
     */
    stEligibilityPolicyId: stPolicy.id,
    stEligibilityPolicyVersion: stPolicy.version,
    stEligibilityPolicyParameter: stPolicy.parameterValue,
    stEligibilityPolicyExploratory: stPolicy.exploratory,
    stEligibilityPolicyStrictDefault: stPolicy.strictDefault,
    repairWindowDays: RECOVERY_WINDOW_DAYS,
    repairScoreTotalMin: REPAIR_SCORE_TOTAL_MIN,
    watchMaxRelativeDay: WATCH_MAX_RD,
  };
}

// ---------------------------------------------------------------------------
// 运行期中间结构
// ---------------------------------------------------------------------------

interface EventSeed {
  readonly eventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly year: number;
  readonly market: string;
  readonly boardType: string;
}

/** 一条**原始买点候选**（= 价格信号；是否可买由 ST 闸门另行判定）。 */
export interface CandidateRow {
  readonly date: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly securityId: string;
  readonly eventAge: number;
  readonly confirmRd: number;
  readonly fillRd: number;
  readonly fillDate: string | null;
  readonly preReturn10: number;
  readonly branch: "ORIGINAL" | "RECOVERY";
  readonly repairEpisodeId: string | null;
  readonly localLowRd: number | null;
  readonly repairWindowScore: number | null;
  readonly confirmCloseBuyEligibility: BuyEligibility;
  readonly confirmCloseStatusFact: SecurityStatusFact | null;
  /**
   * 🔴 `RECOVERY-LIGHT-ST-007` §4 — **确认日收盘时点的资格判决**（本轮显式政策）。
   *
   * - 严格模式（缺省）：由 `evaluateStGate` 的严格三态翻译而来（只认可核验 `NORMAL`）。
   * - 轻量模式：由**已知 ST 标签索引**在**该确认日**判定（已知 ST 排除；UNKNOWN 本轮允许）。
   *
   * 🔴 这是**唯一**的候选资格判据（`participatesInRanking`）；**成交日**结果不在其中
   *    （次日事实**绝不**影响前日排名）。
   */
  readonly confirmCloseStEligibility: StEligibilityDecision;
}

export interface AccountIntent {
  readonly securityId: string;
  readonly anchorEventId: string;
  readonly rank: number;
  readonly percentile: number;
  readonly signalValue: number;
  readonly confirmRd: number;
  readonly fillRd: number;
}

interface AccountPlan {
  readonly accountIndex: number;
  readonly kind: "R" | "RANDOM";
  readonly seedIndex: number | null;
  readonly intentsByDate: ReadonlyMap<string, readonly AccountIntent[]>;
}

/** 一组在账户循环里就地收齐的 S5 明细产物（循环结束即落盘，不留到内存末尾）。 */
interface GroupArtifactBundle {
  readonly accounts: readonly AccountMetrics[];
  readonly rTrades: readonly Record<string, unknown>[];
  readonly randomTrades: readonly Record<string, unknown>[];
  readonly rEquity: readonly Record<string, unknown>[];
  readonly anchorChains: readonly Record<string, unknown>[];
  readonly failedAttempts: readonly Record<string, unknown>[];
  readonly fillStAudit: readonly Record<string, unknown>[];
  /** FIX-005 / F1：逐笔执行资格**拒单 / 未成交**产物（真实闸门判决，不是事后推断）。 */
  readonly eligibilityRejections: readonly Record<string, unknown>[];
}

interface GroupPlanning {
  readonly spec: RecoveryGroupSpec;
  readonly evaluations: ReadonlyMap<string, RecoveryEvaluation>;
  readonly candidateRows: readonly CandidateRow[];
  readonly candidatesByDate: ReadonlyMap<string, readonly CandidateRow[]>;
  readonly sortedDecisionDates: readonly string[];
  readonly plans: readonly AccountPlan[];
  /**
   * 🔴 `SORT-PARITY-008` §4.2 —— R 臂每日选择的**唯一结果**（`计划` 与 `诊断` 共用），
   *    由身份解析 + 确认日资格之后、按 `sortedDecisionDates` 计算一次。
   *    诊断产物**只读它**，不再自行排一遍 `preReturn10`。
   */
  readonly rSelectionByDate?: ReadonlyMap<string, DailyFactorSelection<CandidateRow>>;
  readonly diagnostics: Readonly<Record<string, number>>;
  readonly layerCounts: ReadonlyMap<string, number>;
  readonly triggerAnchorCount: number;
  readonly breachedAnchorCount: number;
  readonly permanentlyDisabledAnchorCount: number;
  readonly recoverySignalCount: number;
  readonly gapBrokenEpisodeCount: number;
  readonly dailyUnknownBlockedDayCount: number;
  readonly dailyStBlockedDayCount: number;
}

interface AccountDerivation {
  readonly metrics: AccountMetrics;
  readonly completed: readonly CompletedAnchorFact[];
  readonly tail20AnchorIds: readonly string[];
  readonly tail20Symbols: readonly string[];
  readonly yearlyEquityReturns: readonly { readonly year: number; readonly returnPct: number }[];
  readonly fillRdByEntry: ReadonlyMap<string, number>;
  readonly anchorChainNetPnl: ReadonlyMap<string, number>;
  readonly tradeRows: readonly Record<string, unknown>[];
}

function yearlyEquityReturns(
  curve: readonly { readonly date: string; readonly equity: number }[],
  initialCapital: number,
): { readonly year: number; readonly returnPct: number }[] {
  const endEquityByYear = new Map<number, number>();
  for (const point of curve) endEquityByYear.set(Number(point.date.slice(0, 4)), point.equity);
  const years = [...endEquityByYear.keys()].sort((left, right) => left - right);
  const out: { year: number; returnPct: number }[] = [];
  let previousEnd = initialCapital;
  for (const year of years) {
    const startEquity = previousEnd;
    const endEquity = endEquityByYear.get(year)!;
    previousEnd = endEquity;
    out.push({ year, returnPct: startEquity <= 0 ? 0 : (endEquity / startEquity - 1) * 100 });
  }
  return out;
}

/** 单账户推导（指标**只**经 `canonicalMetrics`）。 */
function deriveAccount(args: {
  readonly group: GroupId;
  readonly plan: AccountPlan;
  readonly run: TradeSimulationRun;
}): AccountDerivation {
  const { plan, run } = args;
  const metrics: CanonicalMetricsDetail = canonicalMetrics({
    equityCurve: run.equityCurve,
    tradeLedger: run.trades,
    initialCapital: run.initialCapital,
  });
  const completedReturns: number[] = [];
  const completed: CompletedAnchorFact[] = [];
  const tail20AnchorIds: string[] = [];
  const tail20Symbols: string[] = [];
  const chainNet = new Map<string, number>();
  const fillRdByEntry = new Map<string, number>();
  const tradeRows: Record<string, unknown>[] = [];
  const holdingPeriods: number[] = [];
  const ordinalByAnchor = new Map<string, number>();
  let reentryEntryCount = 0;

  for (const intents of plan.intentsByDate.values()) {
    for (const intent of intents) fillRdByEntry.set(`${intent.securityId}`, intent.fillRd);
  }

  const ordered = [...run.trades].sort(
    (left, right) =>
      left.entryTime.localeCompare(right.entryTime) || left.securityId.localeCompare(right.securityId),
  );
  for (const trade of ordered) {
    const anchorEventId = anchorEventIdOf(trade.securityId);
    const ordinal = (ordinalByAnchor.get(anchorEventId) ?? 0) + 1;
    ordinalByAnchor.set(anchorEventId, ordinal);
    if (ordinal >= 2) reentryEntryCount += 1;
    if (typeof trade.holdingPeriod === "number" && Number.isFinite(trade.holdingPeriod)) {
      holdingPeriods.push(trade.holdingPeriod);
    }
    const closeAnchor = !trade.openAtEnd && trade.returnPct !== null;
    if (closeAnchor) {
      const returnPct = trade.returnPct as number;
      completedReturns.push(returnPct);
      completed.push({
        anchorEventId,
        symbol: symbolOfSecurityId(trade.securityId),
        returnPct,
        netPnl: trade.netPnl,
        entryDate: trade.entryTime,
        group: args.group,
      });
      if (returnPct >= TAIL_THRESHOLDS_PCT[0]) {
        tail20AnchorIds.push(anchorEventId);
        tail20Symbols.push(symbolOfSecurityId(trade.securityId));
      }
    }
    chainNet.set(anchorEventId, (chainNet.get(anchorEventId) ?? 0) + (trade.netPnl ?? 0));
    tradeRows.push({
      group: args.group,
      accountIndex: plan.accountIndex,
      kind: plan.kind,
      seedIndex: plan.seedIndex ?? "",
      anchorEventId,
      symbol: symbolOfSecurityId(trade.securityId),
      entryOrdinal: ordinal,
      entryDate: trade.entryTime,
      entryPrice: trade.entryPrice,
      exitDate: trade.exitTime ?? "",
      exitPrice: trade.exitPrice ?? "",
      holdingPeriod: trade.holdingPeriod ?? "",
      returnPct: trade.returnPct ?? "",
      netPnl: trade.netPnl ?? "",
      fees: trade.fees,
      openAtEnd: trade.openAtEnd,
      exitReason: trade.reason ?? "",
    });
  }

  const lastPoint = run.equityCurve[run.equityCurve.length - 1];
  const finalCashSharePct =
    lastPoint === undefined || lastPoint.equity <= 0 ? null : (lastPoint.cash / lastPoint.equity) * 100;
  const intentCount = [...plan.intentsByDate.values()].reduce((sum, list) => sum + list.length, 0);
  const intentAnchors = new Set<string>();
  const intentSecurities = new Set<string>();
  for (const intents of plan.intentsByDate.values()) {
    for (const intent of intents) {
      intentAnchors.add(intent.anchorEventId);
      intentSecurities.add(intent.securityId);
    }
  }

  const accountMetrics: AccountMetrics = {
    group: args.group,
    accountIndex: plan.accountIndex,
    kind: plan.kind,
    seedIndex: plan.seedIndex,
    decisionDayCount: [...plan.intentsByDate.values()].filter((list) => list.length > 0).length,
    intentCount,
    uniqueAnchorCount: intentAnchors.size,
    uniqueSecurityCount: intentSecurities.size,
    totalReturnPct: toNullable(metrics.totalReturnPct),
    annualizedReturnPct: toNullable(metrics.annualizedReturnPct),
    maxDrawdownPct: metrics.maxDrawdownPct,
    tradeCount: metrics.tradeCount,
    completedTradeCount: metrics.completedTradeCount,
    openAtEndCount: metrics.openAtEndCount,
    winRatePct: toNullable(metrics.winRatePct),
    profitFactor: toNullable(metrics.profitFactor),
    averageWinPct: toNullable(metrics.averageWinPct),
    averageLossPct: toNullable(metrics.averageLossPct),
    tail20Count: completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[0]).length,
    tail20Rate: completedReturns.length === 0
      ? null
      : completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[0]).length / completedReturns.length,
    tail50Count: completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[1]).length,
    tail50Rate: completedReturns.length === 0
      ? null
      : completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[1]).length / completedReturns.length,
    tail100Count: completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[2]).length,
    tail100Rate: completedReturns.length === 0
      ? null
      : completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[2]).length / completedReturns.length,
    averageHoldingPeriod: meanOf(holdingPeriods),
    finalCashSharePct,
    skippedIntentCount: run.skipped.length,
    fillCount: run.executionStats.totalFills,
    rejectedOrderCount: run.executionStats.rejectedOrders,
    reentryEntryCount,
  };

  return {
    metrics: accountMetrics,
    completed,
    tail20AnchorIds,
    tail20Symbols,
    yearlyEquityReturns: yearlyEquityReturns(run.equityCurve, run.initialCapital),
    fillRdByEntry,
    anchorChainNetPnl: chainNet,
    tradeRows,
  };
}

// ---------------------------------------------------------------------------
// bootstrap 小工具
// ---------------------------------------------------------------------------

interface ClusterCell {
  hits: number;
  completed: number;
  sumReturn: number;
}

function clusterObservationsOf(cells: ReadonlyMap<string, ClusterCell>): PairedClusterObservation[] {
  return [...cells.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, cell]) => ({
      date,
      hits: cell.hits,
      completed: cell.completed,
      sumReturn: cell.sumReturn,
    }));
}

function toBootstrapInterval(result: PairedBootstrapResult | null): BootstrapInterval | null {
  if (result === null) return null;
  return {
    low: result.low,
    high: result.high,
    iterations: result.iterations,
    blockLength: result.blockLength,
    clusterCount: result.clusterCount,
    seed: result.seed,
    zeroDenominatorIterations: result.zeroDenominatorIterations,
    calendarLength: result.calendarLength,
    ignoredObservationCount: result.ignoredObservationCount,
    quantiles: { low: result.quantiles.low, high: result.quantiles.high },
  };
}

/**
 * 主比较的一次配对读数（比率差 = 覆盖率差；均值差单列）。
 *
 * 🔴 聚类键 = 每个共同锚点**首次进入观察池**的日期；双臂共享同一 `calendar`（含空日）、
 *    共享同一抽样索引 —— 由 `@experiments/shared/dateClusterBootstrap` 的**唯一**实现保证。
 */
export function pairedDifferenceOf(args: {
  readonly calendar: readonly string[];
  readonly fromCells: ReadonlyMap<string, ClusterCell>;
  readonly toCells: ReadonlyMap<string, ClusterCell>;
}): PrimaryComparison["difference"] {
  const base = {
    calendar: args.calendar,
    arms: {
      from: clusterObservationsOf(args.fromCells),
      to: clusterObservationsOf(args.toCells),
    },
    compare: ["from", "to"] as const,
    iterations: BOOTSTRAP_ITERATIONS,
    quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
  };
  const primary = movingBlockBootstrapPairedRatioDifference({
    ...base,
    blockLength: BOOTSTRAP_BLOCK_PRIMARY,
    seed: BOOTSTRAP_SEED_PRIMARY,
  });
  const sensitivity = movingBlockBootstrapPairedRatioDifference({
    ...base,
    blockLength: BOOTSTRAP_BLOCK_SENSITIVITY,
    seed: BOOTSTRAP_SEED_SENSITIVITY,
  });
  const mean = movingBlockBootstrapPairedMeanDifference({
    ...base,
    blockLength: BOOTSTRAP_BLOCK_PRIMARY,
    seed: BOOTSTRAP_SEED_PRIMARY,
  });
  return {
    metric: "uniqueAnchorTail20Coverage",
    pointEstimate: primary?.pointEstimate ?? null,
    blockPrimary: toBootstrapInterval(primary),
    blockSensitivity: toBootstrapInterval(sensitivity),
    meanPrimary: toBootstrapInterval(mean),
  };
}

/** 逐锚点覆盖率簇（分母 = 该簇内的共同宇宙锚点数；分子 = 其中命中的锚点数）。 */
export function coverageCellsOf(args: {
  readonly commonAnchorIds: readonly string[];
  readonly firstPoolDateByAnchor: ReadonlyMap<string, string>;
  readonly hitAnchorIds: ReadonlySet<string>;
  readonly chainNetPnlByAnchor: ReadonlyMap<string, number>;
}): Map<string, ClusterCell> {
  const cells = new Map<string, ClusterCell>();
  for (const anchorEventId of args.commonAnchorIds) {
    const date = args.firstPoolDateByAnchor.get(anchorEventId);
    if (date === undefined) continue;
    const cell = cells.get(date) ?? { hits: 0, completed: 0, sumReturn: 0 };
    cell.completed += 1;
    if (args.hitAnchorIds.has(anchorEventId)) cell.hits += 1;
    cell.sumReturn += args.chainNetPnlByAnchor.get(anchorEventId) ?? 0;
    cells.set(date, cell);
  }
  return cells;
}

// ---------------------------------------------------------------------------
// 实验定义
// ---------------------------------------------------------------------------

export const rollingPoolRecoveryStExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/rolling-pool-recovery-st",
    name: "首板滚动池 × 破位修复再触发 × 每日 ST 硬闸门（两组 · 42 账户）",
    version: COMPUTATION_VERSION,
    description:
      "验证「首板支撑破位后暂停买入、止跌修复后重新获得资格」能否改善右尾覆盖："
      + "A `STRICT_20` = 003 的 D（N=5 / T+20 / 首次可靠破位后**永久停买**，继续观察）；"
      + "B `RECOVERY_20` = 未破位分支与 A 逐字相同，破位后进入 §3.3 局部修复分支"
      + "（局部低点 `F`、`W=[d−5,d−1]` 五日综合分 `ΣQ_j ≥ 15/20`、确认日 `C_d > max(H_(d−2),H_(d−1))` 且 `V_d ≥ V_(d−1)`；"
      + "**不要求收复 0.98·O_0**，`F` **不是**退出价）。每组 `R + randomAccountCount 个固定种子随机` 账户"
      + "（默认 20 ⇒ 两组共 42；SMOKE 为 6），仓位 = 决策日收盘总权益 × 20%，Top3，"
      + "退出继承 `strategy_versions.id=3600005`，指标唯一出口 `canonicalMetrics`；`maxAmp5` **完全不参与**。"
      + "🔴 **ST 资格政策**：缺省 `strict`（原严格政策 `recovery-st-execution-eligibility/1.0.0`；"
      + "逐日 ST 硬闸门：确认日收盘资格 + 成交前复查，只认可 PIT 可核验 NORMAL）——"
      + "严格模式下**当前无任何可 PIT 核验的状态源** ⇒ 任一计划检查时点缺可核验结论即以 "
      + "`ST_COVERAGE_BLOCKED` **拒绝产出收益矩阵**"
      + "（`matrixEmitted = false`、`eligibleCount = 0`、收益读数一律 `null`，只交付覆盖缺口产物），"
      + "**不是**空仓结果。"
      + "🔴 显式政策 `stPolicy=known-st-only`（`KNOWN_ST_ONLY_EXPLORATORY` / "
      + "`recovery-known-st-only/1.0.0`）是**用户授权的探索性变体**：只使用平台已有历史 ST 记录，"
      + "**UNKNOWN 可参与、仅排除已有记录中的 ST**；**不是**严格 PIT 研究，"
      + "结论不得升级为 PIT / OOS / 模拟交易 / 实盘验证。这不是投资建议，也不是盈利承诺。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "rolling-pool",
      "breach-recovery",
      "support-repair",
      "st-gate",
      "point-in-time",
      "real-account",
      "composite-runner",
    ],
    targetMetric: {
      code: "anchorTail20CoverageDifferenceBRMinusAR",
      label:
        "`B_R − A_R`：共同可核实锚点宇宙上，至少一笔已完成净收益 ≥+20% 的**唯一锚点数覆盖率**之差",
      rationale:
        "主问题是**右尾覆盖**：分母固定为两组共有且数据资格可核实的锚点宇宙，"
        + "而**不是**各组成交数（用成交数当分母会把「买得多」伪装成「选得准」）。"
        + "同时必须并报账户复合收益 / MDD / 现金占比与随机账户分布，否则会得出方向相反的结论。",
      kind: "COVERAGE",
      reportMeanAlongside: true,
    },
    preRegisteredCriteria: {
      criteria: [
        "唯一主要比较 = `B_R − A_R`：**共同且数据资格可核实的锚点宇宙**上「至少一笔已完成净收益 ≥+20% 的唯一锚点数」覆盖率之差；按每个共同锚点**首次进入观察池**的日期做配对日期移动块 bootstrap 的 95% 双侧区间。",
        "配对抽样：两个臂共享**同一组交易日块索引**（同一日历、**空日保留**）、同一抽样索引；分子与分母在同一个日期簇内一起重采样。聚类键 = 锚点首次进入观察池的日期（**不是**成交日），交易/整链指标另按声明的入场日期键聚类，两者不得混用。",
        "block20 主口径 / block40 敏感性（1000 次、固定种子 20261010 / 20261011）；另有配对均值差与零分母迭代次数单列。",
        "只有「两组各至少 50 个独立 ≥+20% 唯一命中锚点」且「主区间下界 > 0」且「block40 不反向」且「2024 与 2025 逐年同向」且「账户收益与风险未显示相反取舍」，才允许列为**待未见样本验证的候选**；否则 `INSUFFICIENT_EVIDENCE`。任何样本量不足**不靠**扩大随机账户数补足（42 账户完成即可报告）。",
        "次要清单（不作独立确认性判据）：实际成交 ≥+20/50/100% 尾率、唯一股票命中数、单笔净均值、锚点整链净损益（扣全部试错成本）、账户复合收益 / MDD、资金与容量、交易次数、持有期、前 3/5 个交易日不利波动；新增买点与原买点分开画像。",
        "A/B 比较的是**修复买点整体机制**（同时改变破位后的局部支撑与观察聚合），**不能**称为「仅取消永久排除」的单因素效应。",
        "未破位分支必须与 003 的 D 给出**相同**信号：不追加缩量阈值、观察天数、期限或退出搜索。",
        "`ΣQ_j` 只是观察证据，**不进入**横截面排序（排序仍为 `preReturn10` 降序 + symbol/eventId 破平）。",
        "逐年报告相同靶与账户收益；2024 / 2025 是已见探索窗口，**不是 OOS**。没有已核验、PIT 可用的市场状态标签时，熊市效果为未验证。",
      ],
      abortConditions: [
        "Dataset 不是 READY，或 `requiredDatasetVersionLabel` 不匹配 ⇒ 中止，不跑。",
        "`freezeSelection` 之前的任何 `observation()` 调用 ⇒ 结构级拒绝（平台闸门）。",
        "🔴 **ST 覆盖闸门（仅严格缺省模式）**：任一计划候选资格 / 潜在成交检查时点缺少可核验 NORMAL 或 ST 结论，"
        + "或 provider 在计划窗口探针上给不出任何结论 ⇒ 以 `ST_COVERAGE_BLOCKED` 收口："
        + "**不产出收益矩阵**、只交付覆盖缺口（不得用大面积 UNKNOWN 拒单后的空仓结果评价新买点）。"
        + "🔴 `stPolicy=known-st-only`（`KNOWN_ST_ONLY_EXPLORATORY`）**不**以该条为中止条件："
        + "未知 ST 状态本身不是停止条件（用户已确认的本轮政策）；"
        + "轻量模式下**已知 ST 买入**（`status=ST` 的真实成交）才是中止条件。",
        "🔴 轻量模式（`stPolicy=known-st-only`）中止条件：任一真实成交的执行资格状态为 `ST`（已知 ST 买入）；"
        + "或标签来源读取失败；或显式声明 `ALLOW_WHEN_DECISION_ALLOWS` 后仍出现不允许的状态成交。",
        "冻结策略 3600005 的内容指纹或版本行主键不等于声明值 ⇒ 中止（拒绝在漂移的退出政策上做研究）。",
        "组内全部账户的 `simulationConfig` 快照不是字节相同 ⇒ 中止。",
        "出现任一 `confirmRd + 1 > L` 或 `confirmRd > 19` 的候选 ⇒ 中止（账户层硬门禁）。",
        "执行投影为空（候选涉及证券没有任何可用 post 行）⇒ 中止。",
      ],
      stoppingRule:
        "只跑冻结的两组矩阵（默认 42 账户）；主结果为负或证据不足也**正常收口**，"
        + "不追加 N、L、TopK、修复窗口、综合分下限、排序方向或退出参数来补救；不为了取得正结论扩 seed。",
    },
    parameters: [
      {
        code: "randomAccountCount",
        label: "每组随机账户数",
        description:
          "缺省 20 ⇒ 每组 `R + 20 随机` = 21 账户、两组共 **42**（STUDY，目标 §2 的默认正式产物）；"
          + "`2` ⇒ SMOKE（两组共 6 账户，只验证工程正确）；实现支持到 200，但**扩跑需独立参数记录与新 Run**，"
          + "不覆盖 42 账户产物。种子固定为 `20261010 + i`，i = 0..N−1，两组同 i 同 seed。",
        kind: "INT",
        required: false,
        defaultValue: RANDOM_ACCOUNT_COUNT_DEFAULT,
        bounds: { min: 1, max: RANDOM_ACCOUNT_COUNT_MAX },
        unit: "个账户/组",
      },
      {
        code: ST_POLICY_PARAMETER_CODE,
        label: "ST 资格政策",
        description:
          "🔴 **缺省 = `strict`**（原严格政策 `recovery-st-execution-eligibility/1.0.0`：只认可核验 NORMAL）。"
          + "`known-st-only` = **本轮用户授权的探索性政策** `KNOWN_ST_ONLY_EXPLORATORY` / "
          + "`recovery-known-st-only/1.0.0`：**UNKNOWN 可参与，仅排除已有历史记录中的 ST**。"
          + "该模式**不是**严格 PIT 研究，结论不得升级为 PIT / OOS / 模拟交易 / 实盘验证；"
          + "它只改 ST 资格来源，**不改**价格买点、排序、随机、仓位、成本与退出。",
        kind: "ENUM",
        required: false,
        defaultValue: ST_POLICY_DEFAULT_VALUE,
        allowedValues: [...ST_POLICY_PARAMETER_VALUES],
      },
    ],
    datasetRequirement: {
      datasetCode: FROZEN_DATASET_CODE,
      requiredDatasetVersionLabel: FROZEN_DATASET_VERSION,
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "market"],
        feature: ["open", "high", "low", "close", "preClose", "volume"],
        observation: [
          "open",
          "high",
          "low",
          "close",
          "preClose",
          "volume",
          // 成交额（**千元**）⇒ 执行投影透传，恢复流动性分层滑点。
          "amount",
          "barPresent",
          "suspensionStatus",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [...PREFIX_RELATIVE_DAYS],
      postRelativeDays: [...POST_RELATIVE_DAYS],
      /**
       * 🔴 契约缺口：该字段是**单标量**，无法表达滚动池**逐日变化**的决策坐标。
       * 声明 `20` = 两组的最大成交相对日上界（任何一天的资格判定都不会用到 rd ≥ 21），
       * 是**上界声明**，不是逐日精确坐标。
       */
      decisionOffsetDays: ORIGINAL_ENTRY_FILL_MAX_RD,
      usesForwardData: true,
      forwardDataPurpose:
        "观察分（rd1..19）、修复窗口（rd1..19）与买点资格（**只用当日及以前**）；"
        + "成交与退出路径（rd1..80 的真实行情）；以及真实账户撮合的成交价与估值。"
        + "未来数据只在**已冻结样本**上用于执行与结果观察，绝不参与候选资格或排序。",
      eventScanPolicy: "FULL_DATASET",
    },
    /**
     * 🔴 `executionSurface` **保持缺省 `SINGLE_EVENT`**（与 003 逐字一致）。
     *
     * 为什么**不能**声明 `COMPOSITE_PORTFOLIO`：平台 Runner 一旦看到该声明就会要求
     * `compositeExecution.baselineDatasetVersionId` 并去装配「基线官方投影 + 扩展行」的
     * 组合数据集（`server/researchExperiments/runner.ts`），而本实验的执行输入是
     * **自己在端口数据上 sealed 的执行投影**（`sealRollingPoolExecutionDataset`）。
     * 声明它而缺 `compositeExecution` ⇒ 任何真实 Run 都会在 `run()` 之前以
     * `EXPERIMENT_COMPOSITE_BASELINE_MISSING` 失败（平台刻意「拒绝静默降级」）。
     *
     * 🔴 这不影响经 `@experiments/compositeRunnerBridge`（零实现 re-export）调用既有唯一撮合
     * 引擎的能力：那条通道只要求实验**不自造引擎**，与 `executionSurface` 声明无关
     * （003 同样如此）。
     */
    pageKey: "first-board-pullback/rolling-pool-recovery-st",
    pageTitle: "首板滚动池 · 破位修复再触发 × 每日 ST 硬闸门",
  },

  resultSchema: recoveryStCustomPayloadSchema,

  async run(context: ExperimentRunContext): Promise<ExperimentResultPayload> {
    const { dataset, log, freezeSelection, parameters, artifact } = context;
    /** 阶段性能用（**只**进 `stage-performance.json`，不参与任何研究口径）。 */
    const runStartedAt = Date.now();
    const facts = dataset.facts;

    // ── 0) 参数与冻结配置漂移断言 ─────────────────────────────────────────
    const rawRandomAccountCount = parameters.randomAccountCount;
    const randomAccountCount = typeof rawRandomAccountCount === "number"
      ? rawRandomAccountCount
      : RANDOM_ACCOUNT_COUNT_DEFAULT;
    const runMode: RunModeResolution = resolveRunMode(randomAccountCount);

    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §4 — **ST 资格政策**（缺省 = 原严格政策）。
     *
     * 非法值 ⇒ 立刻抛错（**不**静默回落到严格或宽松）。政策身份进入冻结配置与全部产物，
     * 使「哪一版政策跑出这个结果」可对账。
     */
    const stPolicy: StEligibilityPolicy = resolveStEligibilityPolicy(
      parameters[ST_POLICY_PARAMETER_CODE],
    );

    if (POSITION_FRACTION !== EARLY_ENTRY_POSITION_FRACTION) {
      throw new Error(
        `RECOVERY-ST-004：仓位口径漂移 —— result.ts 记 ${POSITION_FRACTION}，`
        + `服务侧唯一导出 ${EARLY_ENTRY_POSITION_FRACTION}。拒绝继续。`,
      );
    }
    if (RUNNER_EXTEND_HOLDING_DAYS !== RUNNER_EXTEND_TO_HOLDING_DAYS) {
      throw new Error(
        `RECOVERY-ST-004：Runner 续持上界漂移 —— result.ts 记 ${RUNNER_EXTEND_HOLDING_DAYS}，`
        + `规则库 ${RUNNER_EXTEND_TO_HOLDING_DAYS}。拒绝继续。`,
      );
    }
    if (
      RESULT_MAIN_WINDOW.startDate !== MAIN_WINDOW.startDate
      || RESULT_MAIN_WINDOW.endDate !== MAIN_WINDOW.endDate
    ) {
      throw new Error("RECOVERY-ST-004：主决策窗口在 result.ts 与滚动池常量之间漂移。拒绝继续。");
    }
    if (facts.datasetVersionLabel !== FROZEN_DATASET_VERSION) {
      throw new Error(
        `RECOVERY-ST-004：Dataset 版本标签 ${facts.datasetVersionLabel} ≠ 声明值 ${FROZEN_DATASET_VERSION}。拒绝继续。`,
      );
    }

    // ── 1) 事件扫描（FULL_DATASET，逐页消费；不静默截断）──────────────────
    const excludedByReason: Record<string, number> = {};
    const bump = (code: string, count = 1): void => {
      if (count <= 0) return;
      excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };
    const seen = new Set<string>();
    const seeds: EventSeed[] = [];
    const wanted = new Set<string>();
    let scannedEventCount = 0;
    perfBegin("1.event_scan");
    for await (const page of dataset.eventPages()) {
      for (const row of page as readonly ExperimentEventRow[]) {
        scannedEventCount += 1;
        if (seen.has(row.eventId)) { bump("DUPLICATE_EVENT_ID"); continue; }
        seen.add(row.eventId);
        if (row.values.isFirstLimit !== true) { bump("NOT_FIRST_LIMIT"); continue; }
        const market = asString(row.values.market);
        const boardType = asString(row.values.boardType);
        if (boardType !== "main" || (market !== "SH" && market !== "SZ")) { bump("NOT_MAIN_BOARD"); continue; }
        if (row.tradeDate < EVENT_DATE_LOWER_BOUND || row.tradeDate > MAIN_WINDOW.endDate) {
          bump("EVENT_OUTSIDE_POOL_WINDOW");
          continue;
        }
        seeds.push({
          eventId: row.eventId,
          symbol: row.symbol,
          eventDate: row.tradeDate,
          year: Number(row.tradeDate.slice(0, 4)),
          market,
          boardType,
        });
        wanted.add(row.eventId);
      }
    }
    perfEnd();
    log(
      `事件扫描：候选池 ${seeds.length} / 扫描 ${scannedEventCount}（数据集声明 ${facts.totalEvents ?? "未知"}）；`
      + `剔除 ${JSON.stringify(excludedByReason)}`,
    );

    // ── 1b) 🔴 早诊断（FIX-005 / F3）：provider 明确缺失 ⇒ 不读任何 post rd≥1 ────
    //
    // 事实：`ABSENT_STATUS_PROVIDER` / `provider === null` 对**任何** symbol、**任何**日期
    // 都只可能返回 `NO_STATUS_PROVIDER`。再读一遍 post rd1..80、再跑一遍逐组求值，
    // 只是为同一个已知缺口重复付出全量扫描的代价 —— 所以这里**尽早**如实收口：
    //   - 只做事件扫描（不读 rd≥1、不 freezeSelection、不解析身份、不撮合）；
    //   - 未扫描的候选数 / 覆盖分母一律 `null`（**未测**），**禁止**用 0 冒充；
    //   - 仍交付缺口产物并停在 `ST_COVERAGE_BLOCKED`（不伪装成收益研究完成）。
    const earlyProvider = resolveStatusProvider();
    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §4：null-provider 的**早诊断只保留在原严格模式**。
     *
     * 轻量模式**不**把「没有严格 provider」当成停止条件：它使用**真实载入的历史标签索引**，
     * 缺状态不再暂停全部账户，即使部分或全部查不到也如实记 `UNKNOWN`（并按用户政策放行）。
     * 同时**不**把严格 provider 的 `verifiable` 标记伪造为 `true` 来开跑（那份标记在轻量模式
     * 下**如实保持 false**，只作证据留档，不参与任何前置判断）。
     */
    if (stPolicy.strictDefault && earlyProvider === null) {
      const earlyProbeDates = [MAIN_WINDOW.startDate, MAIN_WINDOW.endDate];
      const earlyProbes = earlyProbeDates.flatMap((tradeDate) =>
        ST_CHECK_TIMEPOINTS.map((timepoint) => ({
          tradeDate,
          timepoint,
          decision: evaluateStGate({
            provider: earlyProvider,
            query: {
              symbol: ST_PROVIDER_ABSENT_PROBE_SYMBOL,
              tradeDate,
              timepoint,
              effectiveAt: effectiveAtOf(tradeDate, timepoint),
            },
          }),
        })),
      );
      const unexpectedProbes = earlyProbes.filter(
        (probe) => probe.decision.reason !== "NO_STATUS_PROVIDER",
      );
      if (unexpectedProbes.length > 0) {
        throw new Error(
          "RECOVERY-ST-004：早诊断自检失败 —— provider 为 null 却出现非 NO_STATUS_PROVIDER 的探针："
          + JSON.stringify(unexpectedProbes),
        );
      }
      const earlyDiagnosticAt = new Date().toISOString();
      const unscannedCoverage = unscannedStCoverageReport({
        contractVersion: ST_GATE_CONTRACT_VERSION,
        providerId: ABSENT_STATUS_PROVIDER_ID,
        note:
          "🔴 **未测**（FIX-005 / F3）：provider 明确缺失 ⇒ 早诊断路径只做事件扫描，"
          + "**没有**读取任何 post rd≥1 观察数据，因此候选数 / 覆盖分母全部为 `null`，"
          + "**不是 0**（0 会被读成「查过了、没有候选 / 没有缺口」）。",
      });
      const earlyBlockedReasons = [
        "ST provider 明确缺失（configured=false，providerId=" + ABSENT_STATUS_PROVIDER_ID
          + "）：每个计划检查时点都只可能是 UNKNOWN_BLOCKED（NO_STATUS_PROVIDER）。",
        "按 FIX-005 / F3 走**早诊断**收口：不读 post rd≥1、不解析证券身份、不执行任何撮合，"
          + "也不为再次证明同一缺口重复扫描全量 post80。",
        "未扫描 ⇒ 计划候选数 / 覆盖分母为 `null`（**未测**），不用 0 冒充。",
      ];
      const earlyStatusCoverageRows: Record<string, unknown>[] = [];
      const earlyCountRows: Record<string, unknown>[] = [
        {
          scope: "EARLY_DIAGNOSTIC",
          key: "NOT_SCANNED_PROVIDER_ABSENT",
          plannedCandidateCount: null,
          candidatesWithPlannedFillCount: null,
          candidatesWithoutPlannedFillCount: null,
          unknownBlockedCandidateCount: null,
          fullyVerifiedNormalCandidateCount: null,
          stRejectedCandidateCount: null,
          unknownCount: null,
          note: "provider 明确缺失 ⇒ 未扫描 post rd≥1；计数为 null（未测），不是 0。",
        },
        ...Object.entries(excludedByReason)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([reason, count]) => ({
            scope: "EVENT_SCAN_EXCLUDED",
            key: reason,
            plannedCandidateCount: null,
            candidatesWithPlannedFillCount: null,
            candidatesWithoutPlannedFillCount: null,
            unknownBlockedCandidateCount: null,
            fullyVerifiedNormalCandidateCount: null,
            stRejectedCandidateCount: null,
            unknownCount: null,
            note: `事件扫描剔除 ${count} 条（该计数**已实测**，与候选覆盖无关）。`,
          })),
      ];
      const earlyCoverageColumns = [
        ...STATUS_COVERAGE_COLUMNS, "measurement", "note",
      ];

      artifact({
        name: "st-coverage-gap-summary.json",
        role: "artifact",
        body: JSON.stringify(
          {
            status: ST_COVERAGE_BLOCKED,
            matrixEmitted: false,
            measurement: unscannedCoverage.measurement,
            generatedAt: earlyDiagnosticAt,
            experimentId: context.descriptor.id,
            codeDigest: context.codeDigest,
            dataset: {
              datasetVersionId: facts.datasetVersionId,
              datasetVersionLabel: facts.datasetVersionLabel,
              datasetCode: facts.datasetCode,
            },
            runMode: { ...runMode, seedIndexes: [...runMode.seedIndexes] },
            provider: {
              providerId: ABSENT_STATUS_PROVIDER_ID,
              contractVersion: null,
              configured: false,
              providerVerifiable: false,
              probeCount: earlyProbes.length,
              probeUnknownCount: earlyProbes.length,
              probes: earlyProbes.map((probe) => ({
                tradeDate: probe.tradeDate,
                timepoint: probe.timepoint,
                outcome: probe.decision.outcome,
                reason: probe.decision.reason,
                providerId: probe.decision.providerId,
              })),
              note:
                "S1 审计 E1/E2/E3：唯一 ST 源的 `availability` 全为 UNKNOWN、窗口内可获知时间 = 0、"
                + "84% symbol 无任何 ST 行、948 个 ST 格的数据集 `limitRuleUp` 仍为 10%。"
                + "⇒ 现状下**没有**可核验 provider，闸门只能给 UNKNOWN。",
            },
            counts: {
              measurement: unscannedCoverage.measurement,
              plannedCandidateCount: null,
              candidatesWithPlannedFillCount: null,
              candidatesWithoutPlannedFillCount: null,
              unknownBlockedCandidateCount: null,
              fullyVerifiedNormalCandidateCount: null,
              stRejectedCandidateCount: null,
              timepointChecks: null,
              verifiedNormalTimepointChecks: null,
              stRejectedTimepointChecks: null,
              unknownTimepointChecks: null,
              unknownByTimepoint: null,
              unknownByReason: null,
              scannedEventCount,
              watchPoolEventCount: null,
              watchPoolDecisionDateCount: null,
              excludedByReason: { ...excludedByReason },
              postRelativeDaysRead: [] as readonly number[],
              note: "全部为 `null` 的字段 = **未测**（未扫描 post rd≥1），不是 0。",
            },
            blockedReasons: earlyBlockedReasons,
            notEmittedMetrics: [...RECOVERY_ST_NOT_EMITTED_METRICS],
            artifacts: RECOVERY_ST_BLOCKED_ARTIFACTS.map((spec) => ({ ...spec })),
          },
          null,
          2,
        ),
        contentType: "application/json",
        label: "ST 覆盖缺口摘要（早诊断 · 未测）",
        description:
          "provider 明确缺失 ⇒ 早诊断收口：**没有**读取任何 post rd≥1、**没有**产出收益矩阵。"
          + "未扫描的候选数 / 覆盖分母为 `null`（未测），**不是 0**。",
      });

      artifact({
        name: "st-early-diagnostic.json",
        role: "artifact",
        body: JSON.stringify(
          {
            status: ST_COVERAGE_BLOCKED,
            measurement: unscannedCoverage.measurement,
            reason: "ST_PROVIDER_ABSENT",
            generatedAt: earlyDiagnosticAt,
            experimentId: context.descriptor.id,
            codeDigest: context.codeDigest,
            provider: {
              providerId: ABSENT_STATUS_PROVIDER_ID,
              configured: false,
              contractVersion: ST_GATE_CONTRACT_VERSION,
              probeCount: earlyProbes.length,
              probeUnknownCount: earlyProbes.length,
              probeReasonClosed: "NO_STATUS_PROVIDER",
            },
            scanPlan: {
              eventScanPerformed: true,
              scannedEventCount,
              postRelativeDayReads: [] as readonly number[],
              postMaxRelativeDayDeclared: POST_MAX_RELATIVE_DAY,
              selectionFrozen: false,
              identityResolved: false,
              matchingExecuted: false,
              note:
                "早诊断刻意**不读** post rd≥1：同一缺口已被 S1 审计证明，重复全量扫描不会带来新信息。"
                + "如果将来接入可核验 provider，本分支不再触发，改走完整覆盖闸门与真实撮合。",
            },
            unscanned: {
              plannedCandidateCount: null,
              candidatesWithPlannedFillCount: null,
              candidatesWithoutPlannedFillCount: null,
              unknownBlockedCandidateCount: null,
              fullyVerifiedNormalCandidateCount: null,
              stRejectedCandidateCount: null,
              coverageDenominator: null,
              note: "`null` = **未测**（不是 0）。",
            },
            untouched: {
              groups: [] as readonly string[],
              accounts: null,
              trades: null,
              equityCurve: null,
            },
            nextStepRequirement:
              "需要平台供给可 PIT 核验的逐日 ST 状态（区间 + 生效时间 + 可获知时间 + 证据指纹），"
              + "且经数据引入授权与新 Dataset 版本；在此之前不得产出收益矩阵。",
          },
          null,
          2,
        ),
        contentType: "application/json",
        label: "ST 缺口早诊断（provider 缺失 ⇒ 未测，不重复全量扫描）",
        description:
          "FIX-005 / F3 要求的尽早诚实诊断：说明**哪些没有被测**（计数一律 `null`），"
          + "以及为什么不再为同一缺口重复扫描全量 post80。",
      });

      artifact({
        name: "status-coverage.csv",
        role: "table",
        body: toCsv(earlyCoverageColumns, earlyStatusCoverageRows),
        contentType: "text/csv",
        label: "状态覆盖证据（未测：无计划检查点）",
        description:
          "早诊断路径**没有**构建任何计划检查点（未读 post rd≥1）⇒ 数据行为 0 行、`measurement` 列标为"
          + " `NOT_SCANNED_PROVIDER_ABSENT`。0 行 = **未测**，不是「查过了全是 NORMAL」。",
      });

      artifact({
        name: "st-gap-samples.csv",
        role: "table",
        body: toCsv(["anchorEventId", "symbol", "group", "tradeDate", "timepoint", "reason"], []),
        contentType: "text/csv",
        label: "覆盖缺口样例（未测：无候选）",
        description:
          "未扫描 ⇒ 没有候选级缺口样例可列。**0 行是「未测」而不是「没有缺口」**，"
          + "原因见 st-early-diagnostic.json。",
      });

      artifact({
        name: "st-coverage-counts.csv",
        role: "table",
        body: toCsv(
          [
            "scope", "key", "plannedCandidateCount", "candidatesWithPlannedFillCount",
            "candidatesWithoutPlannedFillCount", "unknownBlockedCandidateCount",
            "fullyVerifiedNormalCandidateCount", "stRejectedCandidateCount", "unknownCount", "note",
          ],
          earlyCountRows as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: "覆盖计数（早诊断：未测 + 已实测的事件扫描账）",
        description:
          "**未测**字段留空（不是 0）；事件扫描的剔除计数是**已实测**的，单独标注 scope=EVENT_SCAN_EXCLUDED。",
      });

      artifact({
        name: "frozen-config.json",
        role: "artifact",
        body: JSON.stringify(
          {
            status: ST_COVERAGE_BLOCKED,
            measurement: unscannedCoverage.measurement,
            computationVersion: COMPUTATION_VERSION,
            experimentId: context.descriptor.id,
            codeDigest: context.codeDigest,
            runMode: { ...runMode, seedIndexes: [...runMode.seedIndexes] },
            frozenConfig: frozenConfigLiteral(runMode, facts, stPolicy),
            dataset: {
              datasetVersionId: facts.datasetVersionId,
              datasetVersionLabel: facts.datasetVersionLabel,
              datasetCode: facts.datasetCode,
              datasetStatusCode: facts.status,
              declaredEventCount: facts.totalEvents ?? null,
              referenceDatasetVersionId: FROZEN_DATASET_VERSION_ID_REFERENCE,
            },
            groups: GROUPS.map((group) => ({
              id: group.id,
              breachPolicy: group.breachPolicy,
              entryFillMaxRd: group.entryFillMaxRd,
              confirmMinRd: group.confirmMinRd,
              confirmMaxRd: group.confirmMaxRd,
              label: group.label,
            })),
            scannedEventCount,
            watchPoolEventCount: null,
            watchPoolDecisionDateCount: null,
            excludedByReason,
            stGate: {
              contractVersion: ST_GATE_CONTRACT_VERSION,
              executionEligibilityPolicyVersion: ST_EXECUTION_ELIGIBILITY_POLICY_VERSION,
              executionEligibilityGateId: ST_EXECUTION_ELIGIBILITY_GATE_ID,
              providerId: ABSENT_STATUS_PROVIDER_ID,
              providerVerifiable: false,
              measurement: unscannedCoverage.measurement,
            },
            contractGaps: [...RECOVERY_ST_CONTRACT_GAPS],
          },
          null,
          2,
        ),
        contentType: "application/json",
        label: "冻结配置与来源 manifest（早诊断）",
        description: "本 Run 的固定配置、Dataset 坐标、执行资格政策版本与全部声明值（未测字段为 `null`）。",
      });

      log(
        `🔴 ST_COVERAGE_BLOCKED（**早诊断**）：provider 明确缺失 ⇒ 只做事件扫描（${scannedEventCount} 条），`
        + "**未读任何 post rd≥1**、未冻结样本、未解析身份、未撮合；"
        + "计划候选数 / 覆盖分母 = **未测（null）**，不产出收益矩阵。",
      );

      return assembleRecoveryStBlockedResult({
        computationVersion: COMPUTATION_VERSION,
        runMode,
        frozenConfig: frozenConfigLiteral(runMode, facts, stPolicy),
        providerId: ABSENT_STATUS_PROVIDER_ID,
        providerVerifiable: false,
        providerContractVersion: ST_GATE_CONTRACT_VERSION,
        providerProbeCount: earlyProbes.length,
        providerProbeUnknownCount: earlyProbes.length,
        stCoverage: unscannedCoverage,
        plannedCandidateCount: null,
        candidatesWithPlannedFillCount: null,
        candidatesWithoutPlannedFillCount: null,
        unknownBlockedCandidateCount: null,
        fullyVerifiedNormalCandidateCount: null,
        stRejectedCandidateCount: null,
        unknownBlockedCandidateCountByGroup: null,
        plannedCandidateCountByGroup: null,
        priceStateCountsByGroup: null,
        scannedEventCount,
        watchPoolEventCount: null,
        watchPoolDecisionDateCount: null,
        excludedByReason: { ...excludedByReason },
        blockedReasons: earlyBlockedReasons,
        notes: [
          `Dataset ${facts.datasetVersionLabel}（id=${facts.datasetVersionId}）；主窗口 `
          + `${MAIN_WINDOW.startDate} ~ ${MAIN_WINDOW.endDate}。`,
          `ST 闸门契约 ${ST_GATE_CONTRACT_VERSION}；provider = \`${ABSENT_STATUS_PROVIDER_ID}\`（configured=false）。`,
          `执行资格政策 ${ST_EXECUTION_ELIGIBILITY_POLICY_VERSION}（gate=${ST_EXECUTION_ELIGIBILITY_GATE_ID}）：`
          + "本路径**没有**执行任何撮合，因此没有成交可审计。",
          "本轮**没有**读取任何 rd≥1 观察数据（post rd1..80 未扫描）、**没有**运行装配 / 撮合入口 "
          + "（`assembleCompositeRunnerSimulationConfig` / `runCompositeRunnerBacktest` / `runTradeSimulation`），"
          + "也**没有**写数据库。",
          "**未测**（不是 0）：计划候选数、候选覆盖三分账、覆盖分母、共同锚点宇宙、观察池事件 / 决策日数。",
        ],
      });
    }

    // ── 1c) 🔴 `RECOVERY-LIGHT-ST-007`：轻量模式一次性载入「已知 ST 标签索引」──────
    //
    // 只读（`SELECT`；0 DDL / 0 DML / 0 migration / 0 写入），经**既有桥接**注入研究层：
    // 实验作者函数**不直连 SQL**。严格模式下**不读**（缺省路径逐字节不变，也不多付一次读库）。
    perfBegin("1c.st_label_index");
    const knownStIndex: KnownStLabelIndexPort | null = stPolicy.knownStOnly
      ? await loadKnownStLabelIndex()
      : null;
    if (knownStIndex !== null) {
      log(
        `ST 资格政策：${stPolicy.id}（${stPolicy.version}，探索性=${stPolicy.exploratory}）；`
        + `标签来源 ${knownStIndex.sourceId}：读入 ${knownStIndex.rowCount} 行 / `
        + `${knownStIndex.securityCount} 证券 + 身份 ${knownStIndex.identifierRowCount} 行；`
        + `availability=${JSON.stringify(knownStIndex.availabilityCounts)}、`
        + `confidence=${JSON.stringify(knownStIndex.confidenceCounts)}、`
        + `显式 NORMAL 行=${knownStIndex.explicitNormalRowCount}；来源指纹 ${knownStIndex.sourceFingerprint}`,
      );
    } else {
      log(`ST 资格政策：${stPolicy.id}（${stPolicy.version}）—— 缺省严格政策，不读历史标签索引。`);
    }
    perfEnd();

    // ── 2) 冻结样本资格（必须在第一次 observation() 之前）────────────────
    freezeSelection([...wanted]);

    // ── 3) prefix rd −10 / −1 / 0 ────────────────────────────────────────
    perfBegin("3.prefix_read");
    const prefixByEvent = new Map<string, Map<number, PoolBar>>();
    for (const relativeDay of PREFIX_RELATIVE_DAYS) {
      const rows = await dataset.feature(relativeDay);
      perfCount("read.prefix_relative_days", 1);
      perfCount("read.prefix_rows", rows.length);
      for (const row of rows) {
        if (!wanted.has(row.eventId)) continue;
        let map = prefixByEvent.get(row.eventId);
        if (map === undefined) { map = new Map<number, PoolBar>(); prefixByEvent.set(row.eventId, map); }
        map.set(relativeDay, normalizeBar(row));
      }
    }
    perfEnd();

    // ── 4) post rd 1..80 ─────────────────────────────────────────────────
    perfBegin("4.post_read");
    const postByEvent = new Map<string, Map<number, PoolBar>>();
    for (const relativeDay of POST_RELATIVE_DAYS) {
      const rows = await dataset.observation(relativeDay);
      perfCount("read.post_relative_days", 1);
      perfCount("read.post_rows", rows.length);
      for (const row of rows) {
        if (!wanted.has(row.eventId)) continue;
        let map = postByEvent.get(row.eventId);
        if (map === undefined) { map = new Map<number, PoolBar>(); postByEvent.set(row.eventId, map); }
        map.set(relativeDay, normalizeBar(row));
      }
      if (relativeDay % 20 === 0) log(`post rd=${relativeDay}/${POST_MAX_RELATIVE_DAY} 累计事件 ${postByEvent.size}`);
      progress(`post rd=${relativeDay} rows=${rows.length}`);
    }
    perfEnd();

    // ── 5) 事件归一化 + 因子（`maxAmp5` **完全不参与**）────────────────────
    perfBegin("5.normalize_and_factors");
    const poolEvents: PoolEvent[] = [];
    for (const seed of seeds) {
      const post = postByEvent.get(seed.eventId);
      if (post === undefined || post.size === 0) { bump("NO_POST_BARS"); wanted.delete(seed.eventId); continue; }
      poolEvents.push({
        ...seed,
        isFirstLimit: true,
        prefix: prefixByEvent.get(seed.eventId) ?? new Map<number, PoolBar>(),
        post,
      });
    }
    const factors = deriveEventFactors(poolEvents, () => null);

    // ── 6) 逐日池（复用 001 的锚点规则）────────────────────────────────────
    perfEnd();
    perfBegin("6.daily_pool");
    const pool = buildDailyPool({ events: poolEvents, factors, window: MAIN_WINDOW });
    for (const eventId of pool.pooledEventIds) wanted.delete(eventId);
    /**
     * 🔴 **不计入 `excludedByReason`**（平台强制不变量：`Σ excludedByReason === excludedCount`
     * 且 `eligibleCount + excludedCount === candidateCount`）。
     *
     * 这 `wanted.size` 个事件**已经通过事件扫描筛选**（因此属于 `eligibleCount`），
     * 只是在 rd1..40 内没有形成观察池行（`NEVER_IN_WATCH_POOL`）。把它塞进
     * `excludedByReason` 会让「剔除原因合计」比 `scannedEventCount − poolEvents.length` 多出这一份
     * ⇒ 平台 `EXPERIMENT_RESULT_INVALID`。**如实单列**（备注 + 冻结配置 + 日志），不并入剔除原因。
     */
    const neverInWatchPoolCount = wanted.size;
    /**
     * 🔴 **本实验内部先自检一次**平台强制的样本账不变量
     * （`eligibleCount + excludedCount === candidateCount` 且 `Σ excludedByReason === excludedCount`），
     * 而不是把「账不平」留到平台校验才发现（SMOKE 工程闸门的意义正在于此）。
     */
    const exclusionReasonSum = Object.values(excludedByReason)
      .reduce((sum, value) => sum + value, 0);
    const eligibleEventCount = poolEvents.length;
    if (exclusionReasonSum !== scannedEventCount - eligibleEventCount) {
      throw new Error(
        `RECOVERY-LIGHT-ST-007：剔除原因合计 ${exclusionReasonSum} ≠ candidate − eligible `
        + `${scannedEventCount - eligibleEventCount}（原因必须逐项如实，否则「为什么样本变少」无从诊断）。`
        + `逐项：${JSON.stringify(excludedByReason)}；`
        + `未进入观察池（**不计入剔除原因**）${neverInWatchPoolCount} 个。`,
      );
    }
    if (pool.pooledEventIds.size === 0) {
      throw new Error("RECOVERY-ST-004：冻结集为空（窗口内没有任何事件进入 rd1..40 观察池）—— 按事前中止条件停止。");
    }

    /**
     * 🔴 ── 7) 证券身份解析**刻意延后**到 ST 覆盖闸门之后 ─────────────────────
     *
     * `resolveRollingPoolSecurityIds` 要经 Security Master（DB）解析真实 `securityId`。
     * 若把它排在闸门之前，「无 provider ⇒ `ST_COVERAGE_BLOCKED`」这条**主交付物**
     * 就无法在**合成 fixture、不连 DB** 的条件下被验证（测试必须能跑完闸门）。
     *
     * 因此本轮顺序固定为：
     * ```
     * 价格信号（只用端口数据，纯函数求值）
     *   → 🔴 ST 覆盖闸门（两时点 × 每个计划候选）
     *   → 证券身份解析
     *   → 执行投影 / 权威装配 / 真实撮合
     * ```
     * 这与目标 §4「先交付覆盖缺口、不产出收益矩阵」是同一件事的两面。
     */

    /**
     * 🔴 ST provider：平台尚未供给可 PIT 核验的逐日状态（S1 审计 E1/E2/E3）⇒ `null`。
     *    缺省即 `ABSENT_STATUS_PROVIDER` ⇒ 每个时点都是 `UNKNOWN`。
     */
    const statusProvider = resolveStatusProvider();
    /**
     * 🔴 逐日 `buyEligibility` 的**注解**来源（与「本轮候选资格政策」是两件事）：
     *    平台没有可 PIT 核验的严格 provider ⇒ 逐日注解恒为 `UNKNOWN_BLOCKED`
     *    （`ABSENT_STATUS_PROVIDER`，reason `NO_STATUS_PROVIDER`）。这**如实**表达
     *    「没有可核验的严格状态源」，**不**因轻量模式而被伪造成 `NORMAL`。
     *    轻量模式下**候选资格**由 `knownStIndex` 的显式政策决定（见 §8 的候选循环与 §9 的闸门）。
     */
    log(statusProvider === null
      ? `ST 状态源（严格 PIT 注解）：**无**（${ST_GATE_CONTRACT_VERSION} 契约下缺省 provider）⇒ `
        + "逐日 buyEligibility 都会是 UNKNOWN_BLOCKED；"
        + (stPolicy.knownStOnly
          ? `候选资格改由显式政策 ${stPolicy.id} 从历史标签索引判定（**不是**严格 PIT 结论）。`
          : "严格模式：任一计划检查时点缺可核验结论即 `ST_COVERAGE_BLOCKED`。")
      : `ST 状态源：${statusProvider.providerId}（契约 ${statusProvider.contractVersion}）。`);

    // ── 8) 逐组：逐日求值（**唯一求值器**）→ 原始买点候选 → 买单计划 ─────────
    perfEnd();
    perfBegin("8.candidate_eval_and_plans");
    const poolDecisionIndex = new Map<string, number>();
    for (let index = 0; index < pool.decisionDates.length; index += 1) {
      poolDecisionIndex.set(pool.decisionDates[index]!, index);
    }
    const firstPoolDateByAnchor = new Map<string, string>();
    for (const row of pool.dailyRows) {
      const known = firstPoolDateByAnchor.get(row.anchorEventId);
      if (known === undefined || row.date < known) firstPoolDateByAnchor.set(row.anchorEventId, row.date);
    }

    const planningByGroup = new Map<GroupId, GroupPlanning>();
    const checkpoints: StCoverageCheckpoint[] = [];
    /** 候选级两时点闸门结果（键 = `group\0anchorEventId\0confirmRd`），供逐笔 ST 审计与缺口产物使用。 */
    const candidateGates = new Map<string, StCandidateGate>();
    /** 价格状态逐组计数（`priceState` 与 `buyEligibility` 正交 ⇒ 分开记）。 */
    const priceStateCountsByGroup: Record<string, Record<string, number>> = {};
    const plannedCandidateCountByGroup: Record<string, number> = {};
    const candidatesWithPlannedFillByGroup: Record<string, number> = {};
    const candidatesWithoutPlannedFillByGroup: Record<string, number> = {};
    const unknownBlockedCandidateCountByGroup: Record<string, number> = {};
    const fullyVerifiedNormalCandidateCountByGroup: Record<string, number> = {};
    const stRejectedCandidateCountByGroup: Record<string, number> = {};
    let plannedCandidateCount = 0;
    let candidatesWithPlannedFillCount = 0;
    let candidatesWithoutPlannedFillCount = 0;
    let unknownBlockedCandidateCount = 0;
    let fullyVerifiedNormalCandidateCount = 0;
    let stRejectedCandidateCount = 0;
    let fillRdViolationCount = 0;
    let dailyUnknownBlockedDayCount = 0;
    let dailyStBlockedDayCount = 0;

    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §7 问题 5 —— 轻量 ST 检查的**来源覆盖与政策描述**计数。
     *
     * 🔴 这些数字是**来源覆盖与政策描述**，**不是**另一个优化目标。
     */
    const lightCounts = {
      /** 标签查找次数（确认日 + 成交日 + 探针）。 */
      lookups: 0,
      /** 确认日收盘时点的三分账。 */
      confirmKnownSt: 0,
      confirmExplicitNormal: 0,
      confirmUnknown: 0,
      /** 因**已知 ST** 而未进入排序候选的价格信号数（按组）。 */
      knownStExcludedCandidatesByGroup: {} as Record<string, number>,
      /** 因**已知 ST** 而未进入排序候选的价格信号数（合计）。 */
      knownStExcludedCandidates: 0,
      /** 进入排序候选的三分账（按组）。 */
      participatingKnownStByGroup: {} as Record<string, number>,
      participatingUnknownByGroup: {} as Record<string, number>,
      participatingExplicitNormalByGroup: {} as Record<string, number>,
      /** 逐原因计数（标签层）。 */
      labelReasonCounts: {} as Record<string, number>,
    };
    /** 轻量模式：逐候选 × 两时点的资格判决（`st-light-eligibility-decisions.csv`）。 */
    const lightEligibilityRows: Record<string, unknown>[] = [];
    /**
     * 轻量模式：**真实撮合链**上按状态标签的订单三分账（来自引擎逐笔审计，不是事后推断）。
     *
     * 🔴 这些是**订单/成交计数**（跨账户），不是「信号数」；两者在产物里分开列。
     */
    const lightOrderStats = {
      orderChecks: 0,
      knownStOrders: 0,
      knownStRejectedOrders: 0,
      normalOrders: 0,
      normalFilledOrders: 0,
      unknownOrders: 0,
      unknownFilledOrders: 0,
      unknownRejectedOrders: 0,
    };

    for (const spec of GROUPS) {
      const evaluations = evaluateRecoveryDaysFor(poolEvents, {
        group: spec.recoveryGroup,
        stProvider: statusProvider,
      });
      const diagnostics: Record<string, number> = {};
      const bumpGroup = (code: string, count = 1): void => {
        if (count <= 0) return;
        diagnostics[code] = (diagnostics[code] ?? 0) + count;
      };
      const layerCounts = new Map<string, number>();
      const bumpLayer = (layer: string, code: string, count = 1): void => {
        if (count <= 0) return;
        const key = `${layer}\u0000${code}`;
        layerCounts.set(key, (layerCounts.get(key) ?? 0) + count);
      };

      let breachedAnchorCount = 0;
      let permanentlyDisabledAnchorCount = 0;
      let recoverySignalCount = 0;
      let gapBrokenEpisodeCount = 0;
      for (const evaluation of evaluations.values()) {
        if (evaluation.supportBreachRd !== null) breachedAnchorCount += 1;
        if (spec.breachPolicy === "PERMANENT_DISABLE" && evaluation.supportBreachRd !== null) {
          permanentlyDisabledAnchorCount += 1;
        }
        if (evaluation.diagnostics.PERMANENTLY_DISABLED_ANCHORS !== undefined
          && spec.breachPolicy === "PERMANENT_DISABLE") {
          // 结构自检（A 组破位后每一天都必须 buyDisabled）—— 有违规就响亮计数。
          const violations = evaluation.diagnostics.BUY_DISABLE_FLAG_VIOLATIONS ?? 0;
          if (violations > 0) bumpGroup("BUY_DISABLE_FLAG_VIOLATIONS", violations);
        }
        recoverySignalCount += evaluation.triggers.filter((trigger) => trigger.branch === "RECOVERY").length;
        gapBrokenEpisodeCount += evaluation.diagnostics.GAP_BROKEN_EPISODES ?? 0;
        for (const day of evaluation.days) {
          if (day.buyEligibility === "UNKNOWN_BLOCKED") dailyUnknownBlockedDayCount += 1;
          if (day.buyEligibility === "ST_BLOCKED") dailyStBlockedDayCount += 1;
          // 价格状态与买入资格**正交**（ST / 未知不抹掉价格观察历史）⇒ 分开计数。
          const stateBucket = priceStateCountsByGroup[spec.id] ?? {};
          stateBucket[day.priceState] = (stateBucket[day.priceState] ?? 0) + 1;
          priceStateCountsByGroup[spec.id] = stateBucket;
        }
      }

      const candidateRows: CandidateRow[] = [];
      const candidateByKey = new Map<string, CandidateRow>();
      for (const row of pool.dailyRows) {
        const evaluation = evaluations.get(row.anchorEventId);
        if (evaluation === undefined) { bumpGroup("EVALUATION_MISSING"); continue; }
        const trigger = evaluation.triggers.find((item) => item.confirmRd === row.eventAge);
        if (trigger === undefined) {
          bumpLayer("signal", "NO_TRIGGER_ON_THIS_DAY");
          continue;
        }
        bumpLayer("candidate", trigger.branch === "RECOVERY" ? "TRIGGER_DAY_REPAIR" : "TRIGGER_DAY_ORIGINAL");
        if (trigger.fillRd !== trigger.confirmRd + 1) {
          fillRdViolationCount += 1;
          bumpGroup("FILL_RD_NOT_ADJACENT");
          continue;
        }
        if (!fillRdWithinCap(trigger.confirmRd, spec.entryFillMaxRd)) {
          fillRdViolationCount += 1;
          bumpGroup("CONFIRM_RD_OUT_OF_CAP");
          continue;
        }
        if (row.preReturn10 === null) {
          bumpGroup("PRE_RETURN10_MISSING");
          bumpLayer("signal", "PRE_RETURN10_MISSING");
          continue;
        }
        /**
         * 🔴 身份解析在闸门**之后**（见 §7 注释）⇒ 这里先留空占位。
         *    闸门通过后统一补齐；解析不到的候选在那里**如实计数**（不在这里静默 `continue`，
         *    否则「闸门之前到底有多少计划候选」会被身份解析失败悄悄改写）。
         */
        const securityId = "";
        if (trigger.fillDate !== null) {
          const decisionIndex = poolDecisionIndex.get(row.date);
          const calendarNext = decisionIndex !== undefined && decisionIndex + 1 < pool.decisionDates.length
            ? pool.decisionDates[decisionIndex + 1] ?? null
            : null;
          if (calendarNext !== null && calendarNext !== trigger.fillDate) {
            bumpGroup("FILL_DAY_CALENDAR_MISMATCH");
          }
        }
        /**
         * 🔴 `RECOVERY-LIGHT-ST-007` §4 —— **确认日收盘时点的资格判决**（本轮显式政策）。
         *
         * - 轻量模式：**只按该确认日**查历史标签索引（`decideKnownStOnlyEligibility`）；
         * - 严格模式（缺省）：把严格闸门 `evaluateStGate` 的三态翻译成同一套判决形状
         *   （**同一** provider 与**同一**时点，只读；不改变严格契约 1.1.0 的任何语义）。
         *
         * 🔴 只用**确认日**（当日及以前）的信息 ⇒ 次日状态**绝不**反向影响前日排名。
         */
        const strictConfirmDecision = stPolicy.knownStOnly
          ? null
          : evaluateStGate({
            provider: statusProvider ?? ABSENT_STATUS_PROVIDER,
            query: {
              symbol: row.symbol,
              tradeDate: row.date,
              timepoint: "CONFIRM_CLOSE_ELIGIBILITY",
              effectiveAt: effectiveAtOf(row.date, "CONFIRM_CLOSE_ELIGIBILITY"),
            },
          });
        if (
          strictConfirmDecision !== null
          && strictConfirmDecision.buyEligibility !== trigger.confirmCloseBuyEligibility
        ) {
          throw new Error(
            `RECOVERY-ST-004：确认日资格自检失败（${row.symbol}@${row.date}）：`
            + `闸门=${strictConfirmDecision.buyEligibility} 求值器=${trigger.confirmCloseBuyEligibility}`
            + " —— 两条路径必须同源，拒绝继续。",
          );
        }
        const confirmCloseStEligibility: StEligibilityDecision =
          stPolicy.knownStOnly && knownStIndex !== null
            ? decideKnownStOnlyEligibility({
              index: knownStIndex,
              symbol: row.symbol,
              checkDate: row.date,
            })
            : decideStrictEligibility({
              outcome: strictConfirmDecision!.outcome,
              reason: strictConfirmDecision!.reason,
              observation: null,
            });
        if (stPolicy.knownStOnly) {
          lightCounts.lookups += 1;
          lightCounts.labelReasonCounts[confirmCloseStEligibility.observation.reason] =
            (lightCounts.labelReasonCounts[confirmCloseStEligibility.observation.reason] ?? 0) + 1;
          if (confirmCloseStEligibility.status === "ST") lightCounts.confirmKnownSt += 1;
          else if (confirmCloseStEligibility.status === "NORMAL") lightCounts.confirmExplicitNormal += 1;
          else lightCounts.confirmUnknown += 1;
        }
        const candidate: CandidateRow = {
          date: row.date,
          anchorEventId: row.anchorEventId,
          symbol: row.symbol,
          securityId,
          eventAge: row.eventAge,
          confirmRd: trigger.confirmRd,
          fillRd: trigger.fillRd,
          fillDate: trigger.fillDate,
          preReturn10: row.preReturn10,
          branch: trigger.branch,
          repairEpisodeId: trigger.repairEpisodeId,
          localLowRd: trigger.localLowRd,
          repairWindowScore: trigger.repairWindowScore,
          confirmCloseBuyEligibility: trigger.confirmCloseBuyEligibility,
          confirmCloseStatusFact: trigger.confirmCloseStatusFact,
          confirmCloseStEligibility,
        };
        const key = `${row.anchorEventId}|${trigger.confirmRd}`;
        if (candidateByKey.has(key)) { bumpGroup("DUPLICATE_CANDIDATE_KEY"); continue; }
        candidateByKey.set(key, candidate);
        candidateRows.push(candidate);
      }
      /**
       * 🔴 `SORT-PARITY-008` §4.1 —— **这里刻意不重排 `candidateRows`**。
       *
       * 007 的写法是 `sortCandidates(candidateRows);`（**返回值被丢弃**，等于没排），
       * 而真实入选来自下游对**未排序** cells 的 `slice(0, DAILY_TOP_K)`。
       *
       * 修复**不在这里**做，原因有两条：
       *   1. `candidateRows` 的顺序决定 `candidatesByDate` → `plannableByDate` 的顺序，
       *      而 Random 的 `pickUniformRandomSubset` 按**输入下标**取样 ⇒ 在这里排序会
       *      改变同种子 Random 抽样结果（§4.3 第 7 条明令不得发生）；
       *   2. R 的排序必须发生在**当日资格过滤之后**（已知 ST 不占名次、也不递补第 4 名）。
       *
       * 真实排序发生在下游唯一的 R 选择入口 `selectDailyTopByFactor(...)`：
       * 计划与诊断共用同一个 `DailyFactorSelection`（见 `rSelectionByDate`）。
       */
      const candidatesByDate = new Map<string, CandidateRow[]>();
      for (const candidate of candidateRows) {
        const list = candidatesByDate.get(candidate.date) ?? [];
        list.push(candidate);
        candidatesByDate.set(candidate.date, list);
      }
      const sortedDecisionDates = [...candidatesByDate.keys()].sort();

      /**
       * 🔴 ST 覆盖检查点：**每一个价格信号**（不论其当日 `buyEligibility` 是什么）都要
       *    在两时点被检查一次。R 与 Random 共享同一原始候选池 ⇒ 检查点按 (symbol, 确认日, 成交日) 去重。
       *
       * 🔴 这里**不是**「筛选可买候选」，而是**覆盖审计**：有多少计划检查时点没有结论，
       *    必须原样浮出水面（目标 §4 要的正是这个数）。买单计划在**闸门之后**才构建。
       */
      for (const candidate of candidateRows) {
        plannedCandidateCount += 1;
        bumpByKey(plannedCandidateCountByGroup, spec.id);
        if (candidate.fillDate === null) {
          // 下一交易日 bar 缺失 ⇒ **成交前时点不存在**（未知，不是「不可成交」）⇒ 计入缺口。
          candidatesWithoutPlannedFillCount += 1;
          bumpByKey(candidatesWithoutPlannedFillByGroup, spec.id);
          bumpGroup("FILL_DATE_UNKNOWN");
          continue;
        }
        candidatesWithPlannedFillCount += 1;
        bumpByKey(candidatesWithPlannedFillByGroup, spec.id);
        const gate = evaluateStGateForCandidate({
          provider: statusProvider,
          symbol: candidate.symbol,
          confirmDate: candidate.date,
          fillDate: candidate.fillDate,
        });
        candidateGates.set(`${spec.id}\u0000${candidate.anchorEventId}\u0000${candidate.confirmRd}`, gate);
        const unknownSides =
          (gate.confirmClose.outcome === "UNKNOWN" ? 1 : 0)
          + (gate.preFill.outcome === "UNKNOWN" ? 1 : 0);
        if (unknownSides > 0) {
          unknownBlockedCandidateCount += 1;
          bumpByKey(unknownBlockedCandidateCountByGroup, spec.id);
        } else if (gate.buyAllowed) {
          fullyVerifiedNormalCandidateCount += 1;
          bumpByKey(fullyVerifiedNormalCandidateCountByGroup, spec.id);
        } else {
          stRejectedCandidateCount += 1;
          bumpByKey(stRejectedCandidateCountByGroup, spec.id);
        }
        checkpoints.push({
          anchorEventId: candidate.anchorEventId,
          symbol: candidate.symbol,
          group: spec.id,
          confirmDate: `${candidate.date}`,
          fillDate: candidate.fillDate,
          gate,
        });

        /**
         * 🔴 `RECOVERY-LIGHT-ST-007` §4 —— 轻量模式的**两时点**逐候选证据。
         *
         * 🔴 成交日（plan 侧）的查找**只作证据**：它**绝不**回写排名 / 候选资格
         *    （权威的成交前判决是引擎在**真实成交时刻**调用闸门得到的，见逐笔审计）。
         */
        if (stPolicy.knownStOnly && knownStIndex !== null) {
          const plannedFillEligibility = candidate.fillDate === null
            ? null
            : decideKnownStOnlyEligibility({
              index: knownStIndex,
              symbol: candidate.symbol,
              checkDate: candidate.fillDate,
            });
          if (plannedFillEligibility !== null) {
            lightCounts.lookups += 1;
            lightCounts.labelReasonCounts[plannedFillEligibility.observation.reason] =
              (lightCounts.labelReasonCounts[plannedFillEligibility.observation.reason] ?? 0) + 1;
          }
          lightEligibilityRows.push({
            group: spec.id,
            anchorEventId: candidate.anchorEventId,
            symbol: candidate.symbol,
            confirmDate: candidate.date,
            confirmRd: candidate.confirmRd,
            plannedFillDate: candidate.fillDate ?? "",
            fillRd: candidate.fillRd,
            branch: candidate.branch,
            stPolicyId: stPolicy.id,
            stPolicyVersion: stPolicy.version,
            eligibilityPolicyVersion: candidate.confirmCloseStEligibility.policyVersion,
            // 确认日收盘（15:00）：**决定当日资格**。
            confirmEligibilityStatus: candidate.confirmCloseStEligibility.status,
            confirmParticipatesInRanking: candidate.confirmCloseStEligibility.participatesInRanking,
            confirmLabelKind: candidate.confirmCloseStEligibility.observation.kind,
            confirmLabelReason: candidate.confirmCloseStEligibility.observation.reason,
            confirmSecurityIdFromStSource:
              candidate.confirmCloseStEligibility.observation.securityId ?? "",
            confirmSource: candidate.confirmCloseStEligibility.observation.fact?.source ?? "",
            confirmStatusValue: candidate.confirmCloseStEligibility.observation.fact?.statusValue ?? "",
            confirmEffectiveFrom: candidate.confirmCloseStEligibility.observation.fact?.effectiveFrom ?? "",
            confirmEffectiveTo: candidate.confirmCloseStEligibility.observation.fact?.effectiveTo ?? "",
            confirmAvailability: candidate.confirmCloseStEligibility.observation.fact?.availability ?? "",
            confirmConfidence: candidate.confirmCloseStEligibility.observation.fact?.confidence ?? "",
            confirmEvidenceFingerprint:
              candidate.confirmCloseStEligibility.observation.fact?.evidenceFingerprint ?? "",
            // 计划成交日（09:15）：**只作计划侧证据**；真实判决见 st-fill-audit / 拒单产物。
            plannedFillEligibilityStatus: plannedFillEligibility?.status ?? "",
            plannedFillAllowed: plannedFillEligibility?.allowedToExecute ?? "",
            plannedFillLabelKind: plannedFillEligibility?.observation.kind ?? "",
            plannedFillLabelReason: plannedFillEligibility?.observation.reason ?? "",
            plannedFillAvailability: plannedFillEligibility?.observation.fact?.availability ?? "",
            plannedFillConfidence: plannedFillEligibility?.observation.fact?.confidence ?? "",
            plannedFillEvidenceFingerprint:
              plannedFillEligibility?.observation.fact?.evidenceFingerprint ?? "",
            note:
              "确认日收盘只决定**当日**资格；计划成交日一格仅供覆盖证据，"
              + "权威的成交前判决来自引擎在真实成交时刻的调用（见 `st-fill-audit.csv` 与拒单产物）。"
              + "🔴 次日状态**不得**反向影响前日排名。",
          });
        }
      }

      /**
       * 🔴 买单计划**刻意延后**到闸门与身份解析之后（见 §7 注释）：
       *    计划里的 `securityId` 必须是**已解析的真实身份**，而身份解析在闸门之后。
       *    这里先放空数组；`plans` 在闸门通过后由 `buildPlansForGroup(...)` 填满。
       */
      const plans: AccountPlan[] = [];

      planningByGroup.set(spec.id, {
        spec,
        evaluations,
        candidateRows,
        candidatesByDate,
        sortedDecisionDates,
        plans,
        diagnostics,
        layerCounts,
        triggerAnchorCount: new Set(candidateRows.map((row) => row.anchorEventId)).size,
        breachedAnchorCount,
        permanentlyDisabledAnchorCount,
        recoverySignalCount,
        gapBrokenEpisodeCount,
        dailyUnknownBlockedDayCount,
        dailyStBlockedDayCount,
      });
      log(
        `组 ${spec.id}（${spec.breachPolicy}）：价格信号 ${candidateRows.length} 行 / 决策日 ${sortedDecisionDates.length}；`
        + `触发锚点 ${planningByGroup.get(spec.id)!.triggerAnchorCount}；破位锚点 ${breachedAnchorCount}；`
        + `修复信号 ${recoverySignalCount}；无效日打断的修复段 ${gapBrokenEpisodeCount}；`
        + `其中可核验 NORMAL ${fullyVerifiedNormalCandidateCountByGroup[spec.id] ?? 0} / `
        + `可核验 ST ${stRejectedCandidateCountByGroup[spec.id] ?? 0} / `
        + `UNKNOWN ${unknownBlockedCandidateCountByGroup[spec.id] ?? 0}、`
        + `无计划成交时点 ${candidatesWithoutPlannedFillByGroup[spec.id] ?? 0}；`
        + `诊断 ${JSON.stringify(diagnostics)}`,
      );
      progress(
        `group ${spec.id} planned: signals=${candidateRows.length} `
        + `unknown=${unknownBlockedCandidateCountByGroup[spec.id] ?? 0}`,
      );
    }

    if (fillRdViolationCount > 0) {
      throw new Error(
        `RECOVERY-ST-004：出现 ${fillRdViolationCount} 个越界候选（确认日 + 1 > 20 或确认日 > 19）`
        + " —— 违反账户层硬门禁，中止，不出结论。",
      );
    }

    /**
     * ── 9) 🔴 ST 覆盖闸门（**真闸门**：缺可核验结论 ⇒ 拒绝产出收益矩阵）─────────
     *
     * 目标 §4：「若任一计划候选资格/潜在成交检查时点缺少可验证 NORMAL 或 ST 结论，
     * **默认暂停收益矩阵**，先交付覆盖缺口」。这里在**任何撮合之前**（也在身份解析之前）执行。
     *
     * 🔴 三条闸门条件（任一成立即暂停）：
     *   1. `summarizeStCoverage(...).blocked`：任一计划检查时点为 `UNKNOWN`；
     *   2. **窗口探针不可核验**：provider 在计划窗口的首/末交易日给不出任何结论
     *      （`ABSENT_STATUS_PROVIDER` 恒如此）—— 这条保证「计划候选为空」也**不可能**
     *      悄悄滑进「产出空矩阵」的分支；
     *   3. 有价格信号**没有计划成交时点**（下一交易日 bar 缺失）⇒ 潜在成交检查时点不存在。
     */
    const stSummary = summarizeStCoverage(checkpoints);
    /** 全部组的**价格信号**（= 计划候选；与账户状态无关）。 */
    const candidateRowsAll: readonly CandidateRow[] = [...planningByGroup.values()]
      .flatMap((planning) => planning.candidateRows);
    const plannedConfirmDates = candidateRowsAll
      .map((row) => row.date)
      .filter((value) => value.length > 0)
      .sort();
    const plannedFillDates = candidateRowsAll
      .map((row) => row.fillDate)
      .filter((value): value is string => value !== null && value.length > 0)
      .sort();
    const firstPlannedConfirmDate = plannedConfirmDates[0] ?? null;
    const lastPlannedFillDate = plannedFillDates.at(-1) ?? null;
    const probeSymbol = candidateRowsAll[0]?.symbol ?? seeds[0]?.symbol ?? "UNKNOWN";
    const probeDates = [...new Set(
      [firstPlannedConfirmDate, lastPlannedFillDate, MAIN_WINDOW.startDate, MAIN_WINDOW.endDate]
        .filter((value): value is string => value !== null && value.length > 0),
    )].sort();
    const providerProbes = probeDates.flatMap((tradeDate) =>
      ST_CHECK_TIMEPOINTS.map((timepoint) => ({
        tradeDate,
        timepoint,
        decision: evaluateStGate({
          provider: statusProvider,
          query: {
            symbol: probeSymbol,
            tradeDate,
            timepoint,
            effectiveAt: effectiveAtOf(tradeDate, timepoint),
          },
        }),
      })),
    );
    const providerProbeUnknownCount = providerProbes.filter(
      (probe) => probe.decision.outcome === "UNKNOWN",
    ).length;
    const providerVerifiable = providerProbes.length > 0 && providerProbeUnknownCount === 0;

    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §4 —— 轻量模式的**来源探针**（与严格探针分开记账）。
     *
     * 严格探针（`providerProbes`）在轻量模式下**照记但不作前置条件**：
     * `providerVerifiable` 如实保持 `false`（**不伪造为 true**），只作「没有严格 PIT 源」的证据。
     */
    let lightProbeKnownStCount = 0;
    let lightProbeUnknownCount = 0;
    if (stPolicy.knownStOnly && knownStIndex !== null) {
      for (const tradeDate of probeDates) {
        const observation: KnownStLabelObservation = knownStIndex.lookup({
          symbol: probeSymbol,
          checkDate: tradeDate,
        });
        lightCounts.lookups += 1;
        lightCounts.labelReasonCounts[observation.reason] =
          (lightCounts.labelReasonCounts[observation.reason] ?? 0) + 1;
        if (observation.kind === "KNOWN_ST") lightProbeKnownStCount += 1;
        else lightProbeUnknownCount += 1;
      }
    }

    const blockedReasons = [
      ...(stSummary.blocked
        ? [`任一计划检查时点缺可核验结论（UNKNOWN ${stSummary.unknownCount} / ${stSummary.timepointChecks} 格）`]
        : []),
      ...(providerVerifiable
        ? []
        : [`ST provider 在计划窗口探针上无结论（${providerProbeUnknownCount} / ${providerProbes.length} 次 UNKNOWN；`
          + `providerId=${statusProvider?.providerId ?? "ABSENT_STATUS_PROVIDER"}）`]),
      ...(candidatesWithoutPlannedFillCount > 0
        ? [`${candidatesWithoutPlannedFillCount} 个价格信号没有计划成交时点（下一交易日 bar 缺失）⇒ 成交前检查时点不存在`]
        : []),
    ];
    log(
      `ST 覆盖闸门（严格读数，仅证据）：${stSummary.status}；计划候选 ${stSummary.candidateCount}、`
      + `检查点 ${stSummary.timepointChecks}、`
      + `NORMAL ${stSummary.verifiedNormalCount} / ST ${stSummary.stRejectedCount} / UNKNOWN ${stSummary.unknownCount}；`
      + `逐时点缺口 ${JSON.stringify(stSummary.unknownByTimepoint)}；逐原因 ${JSON.stringify(stSummary.unknownByReason)}；`
      + `provider 探针 ${providerProbes.length} 次（UNKNOWN ${providerProbeUnknownCount}）`,
    );
    if (stPolicy.knownStOnly) {
      log(
        `🔴 轻量政策 ${stPolicy.id}（${stPolicy.version}）：上述严格读数**只作证据**，`
        + "**不**作为本轮前置条件（不看 `stSummary.blocked`、不看 `providerVerifiable`、"
        + "也不因 `providerVerifiable=false` 而暂停）。"
        + `候选资格由历史标签索引判定：确认日 已知ST ${lightCounts.confirmKnownSt} / `
        + `明确NORMAL ${lightCounts.confirmExplicitNormal} / UNKNOWN ${lightCounts.confirmUnknown}；`
        + "排序候选阶段的**最终排除数**在证券身份解析之后统计（见下一行日志）；"
        + `来源探针（${probeDates.length} 日 × 1 symbol）已知ST ${lightProbeKnownStCount} / UNKNOWN ${lightProbeUnknownCount}。`,
      );
    }

    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §4：暂停终态**只属于原严格模式**。
     *    轻量模式**不**把「缺状态」当停止条件（用户已确认：未知 ST 状态本身不是停止条件）。
     */
    if (stPolicy.strictDefault && (stSummary.blocked || !providerVerifiable || candidatesWithoutPlannedFillCount > 0)) {
      // ── 9b) 🔴 暂停终态：**只交付覆盖缺口**，然后显式返回（绝不产出空仓矩阵）────
      const blockedAt = new Date().toISOString();
      const statusCoverageRows = statusCoverageRowsOf({
        plannings: planningByGroup,
        candidateGates,
        fallbackProviderId: statusProvider?.providerId ?? ABSENT_STATUS_PROVIDER_ID,
      });

      const blockedCounts = [
        ...GROUP_IDS.map((groupId) => ({
          scope: "GROUP",
          key: groupId,
          plannedCandidateCount: plannedCandidateCountByGroup[groupId] ?? 0,
          candidatesWithPlannedFillCount: candidatesWithPlannedFillByGroup[groupId] ?? 0,
          candidatesWithoutPlannedFillCount: candidatesWithoutPlannedFillByGroup[groupId] ?? 0,
          unknownBlockedCandidateCount: unknownBlockedCandidateCountByGroup[groupId] ?? 0,
          fullyVerifiedNormalCandidateCount: fullyVerifiedNormalCandidateCountByGroup[groupId] ?? 0,
          stRejectedCandidateCount: stRejectedCandidateCountByGroup[groupId] ?? 0,
        })),
        ...Object.entries(stSummary.unknownByTimepoint)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([timepoint, count]) => ({ scope: "TIMEPOINT", key: timepoint, unknownCount: count })),
        ...Object.entries(stSummary.unknownByReason)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([reason, count]) => ({ scope: "REASON", key: reason, unknownCount: count })),
      ];

      artifact({
        name: "st-coverage-gap-summary.json",
        role: "artifact",
        body: JSON.stringify(
          {
            status: ST_COVERAGE_BLOCKED,
            matrixEmitted: false,
            measurement: "MEASURED" as const,
            generatedAt: blockedAt,
            experimentId: context.descriptor.id,
            codeDigest: context.codeDigest,
            dataset: {
              datasetVersionId: facts.datasetVersionId,
              datasetVersionLabel: facts.datasetVersionLabel,
              datasetCode: facts.datasetCode,
            },
            runMode: { ...runMode, seedIndexes: [...runMode.seedIndexes] },
            provider: {
              providerId: statusProvider?.providerId ?? ABSENT_STATUS_PROVIDER_ID,
              contractVersion: statusProvider?.contractVersion ?? null,
              configured: statusProvider !== null,
              providerVerifiable,
              probeCount: providerProbes.length,
              probeUnknownCount: providerProbeUnknownCount,
              probes: providerProbes.map((probe) => ({
                tradeDate: probe.tradeDate,
                timepoint: probe.timepoint,
                outcome: probe.decision.outcome,
                reason: probe.decision.reason,
                providerId: probe.decision.providerId,
              })),
              note:
                "S1 审计 E1/E2/E3：唯一 ST 源的 `availability` 全为 UNKNOWN、窗口内可获知时间 = 0、"
                + "84% symbol 无任何 ST 行、948 个 ST 格的数据集 `limitRuleUp` 仍为 10%。"
                + "⇒ 现状下**没有**可核验 provider，闸门只能给 UNKNOWN。",
            },
            counts: {
              measurement: "MEASURED" as const,
              plannedCandidateCount,
              candidatesWithPlannedFillCount,
              candidatesWithoutPlannedFillCount,
              unknownBlockedCandidateCount,
              fullyVerifiedNormalCandidateCount,
              stRejectedCandidateCount,
              timepointChecks: stSummary.timepointChecks,
              verifiedNormalTimepointChecks: stSummary.verifiedNormalCount,
              stRejectedTimepointChecks: stSummary.stRejectedCount,
              unknownTimepointChecks: stSummary.unknownCount,
              unknownByTimepoint: { ...stSummary.unknownByTimepoint },
              unknownByReason: { ...stSummary.unknownByReason },
              unknownBlockedCandidateCountByGroup: { ...unknownBlockedCandidateCountByGroup },
              plannedCandidateCountByGroup: { ...plannedCandidateCountByGroup },
              priceStateCountsByGroup,
            },
            blockedReasons,
            notEmittedMetrics: [...RECOVERY_ST_NOT_EMITTED_METRICS],
            artifacts: RECOVERY_ST_BLOCKED_ARTIFACTS.map((spec) => ({ ...spec })),
          },
          null,
          2,
        ),
        contentType: "application/json",
        label: "ST 覆盖缺口摘要（暂停终态）",
        description:
          "本次 Run 的终态是 `ST_COVERAGE_BLOCKED`：**没有**产出收益矩阵。"
          + "摘要包含 UNKNOWN_BLOCKED 候选计数、涉及时点、缺失的 provider 身份与刻意未产出的读数清单。",
      });

      artifact({
        name: "st-early-diagnostic.json",
        role: "artifact",
        body: JSON.stringify(
          {
            status: ST_COVERAGE_BLOCKED,
            measurement: "MEASURED" as const,
            reason: "MEASURED_COVERAGE_GATE",
            generatedAt: blockedAt,
            experimentId: context.descriptor.id,
            codeDigest: context.codeDigest,
            provider: {
              providerId: statusProvider?.providerId ?? ABSENT_STATUS_PROVIDER_ID,
              configured: statusProvider !== null,
              contractVersion: statusProvider?.contractVersion ?? ST_GATE_CONTRACT_VERSION,
              probeCount: providerProbes.length,
              probeUnknownCount: providerProbeUnknownCount,
            },
            scanPlan: {
              eventScanPerformed: true,
              scannedEventCount,
              postRelativeDayReads: [...POST_RELATIVE_DAYS],
              postMaxRelativeDayDeclared: POST_MAX_RELATIVE_DAY,
              selectionFrozen: true,
              identityResolved: false,
              matchingExecuted: false,
              note:
                "本轮**已实测**覆盖（provider 存在但结论不可核验 / 存在无计划成交时点的候选），"
                + "因此候选数与覆盖分母是**真实计数**，不是 null。",
            },
            measured: {
              plannedCandidateCount,
              candidatesWithPlannedFillCount,
              candidatesWithoutPlannedFillCount,
              unknownBlockedCandidateCount,
              fullyVerifiedNormalCandidateCount,
              stRejectedCandidateCount,
              timepointChecks: stSummary.timepointChecks,
              unknownTimepointChecks: stSummary.unknownCount,
            },
            untouched: {
              groups: [] as readonly string[],
              accounts: null,
              trades: null,
              equityCurve: null,
            },
            nextStepRequirement:
              "需要平台供给可 PIT 核验的逐日 ST 状态（区间 + 生效时间 + 可获知时间 + 证据指纹），"
              + "且经数据引入授权与新 Dataset 版本；在此之前不得产出收益矩阵。",
          },
          null,
          2,
        ),
        contentType: "application/json",
        label: "ST 覆盖闸门诊断（已实测计数）",
        description:
          "与早诊断共用同一产物位：`measurement=MEASURED` 表示候选数与覆盖分母**已实测**（真实计数）。",
      });

      artifact({
        name: "status-coverage.csv",
        role: "table",
        body: toCsv(
          [...STATUS_COVERAGE_COLUMNS],
          statusCoverageRows,
        ),
        contentType: "text/csv",
        label: "状态覆盖证据（逐 symbol / 逐检查时点）",
        description:
          "目标 §4 要求的 `status-coverage.csv` 形态：逐 symbol/date/检查时点给出来源、status、"
          + "effectiveFrom/To、availableAsOf、confidence、覆盖依据与证据指纹；**缺失时留空并记 UNKNOWN**，"
          + "绝不伪造 NORMAL 区间。",
      });

      artifact({
        name: "st-gap-samples.csv",
        role: "table",
        body: toCsv(
          ["anchorEventId", "symbol", "group", "tradeDate", "timepoint", "reason"],
          stSummary.gapSamples as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: "覆盖缺口样例（封顶）",
        description: `按输入顺序取前 ${stSummary.gapSamples.length} 条（闸门内封顶，避免产物无界）。`,
      });

      artifact({
        name: "st-coverage-counts.csv",
        role: "table",
        body: toCsv(
          [
            "scope", "key", "plannedCandidateCount", "candidatesWithPlannedFillCount",
            "candidatesWithoutPlannedFillCount", "unknownBlockedCandidateCount",
            "fullyVerifiedNormalCandidateCount", "stRejectedCandidateCount", "unknownCount",
          ],
          blockedCounts as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: "覆盖计数三分账（逐组 / 逐时点 / 逐原因）",
        description: "**可核验 NORMAL / 可核验 ST / UNKNOWN** 三分账分开计数，UNKNOWN 不被 ST 吞掉。",
      });

      artifact({
        name: "frozen-config.json",
        role: "artifact",
        body: JSON.stringify(
          {
            status: ST_COVERAGE_BLOCKED,
            computationVersion: COMPUTATION_VERSION,
            experimentId: context.descriptor.id,
            codeDigest: context.codeDigest,
            runMode: { ...runMode, seedIndexes: [...runMode.seedIndexes] },
            frozenConfig: frozenConfigLiteral(runMode, facts, stPolicy),
            dataset: {
              datasetVersionId: facts.datasetVersionId,
              datasetVersionLabel: facts.datasetVersionLabel,
              datasetCode: facts.datasetCode,
              datasetStatusCode: facts.status,
              declaredEventCount: facts.totalEvents ?? null,
              referenceDatasetVersionId: FROZEN_DATASET_VERSION_ID_REFERENCE,
            },
            groups: GROUPS.map((group) => ({
              id: group.id,
              breachPolicy: group.breachPolicy,
              entryFillMaxRd: group.entryFillMaxRd,
              confirmMinRd: group.confirmMinRd,
              confirmMaxRd: group.confirmMaxRd,
              label: group.label,
            })),
            scannedEventCount,
            watchPoolEventCount: pool.pooledEventIds.size,
            watchPoolDecisionDateCount: pool.decisionDates.length,
            excludedByReason,
            contractGaps: [...RECOVERY_ST_CONTRACT_GAPS],
          },
          null,
          2,
        ),
        contentType: "application/json",
        label: "冻结配置与来源 manifest（暂停时也交付）",
        description: "本 Run 的固定配置、Dataset 坐标与全部声明值；便于核对「暂停时到底打算跑什么」。",
      });

      log(
        `🔴 ST_COVERAGE_BLOCKED：计划候选 ${plannedCandidateCount}（UNKNOWN_BLOCKED ${unknownBlockedCandidateCount}）`
        + `、检查点 ${stSummary.timepointChecks}（UNKNOWN ${stSummary.unknownCount}）、`
        + `provider 探针 UNKNOWN ${providerProbeUnknownCount}/${providerProbes.length} ⇒ **不产出收益矩阵**，`
        + "只交付覆盖缺口（st-coverage-gap-summary.json / status-coverage.csv / st-coverage-counts.csv）。",
      );

      return assembleRecoveryStBlockedResult({
        computationVersion: COMPUTATION_VERSION,
        runMode,
        frozenConfig: frozenConfigLiteral(runMode, facts, stPolicy),
        providerId: statusProvider?.providerId ?? ABSENT_STATUS_PROVIDER_ID,
        providerVerifiable,
        providerContractVersion: statusProvider?.contractVersion ?? ST_GATE_CONTRACT_VERSION,
        providerProbeCount: providerProbes.length,
        providerProbeUnknownCount,
        stCoverage: stCoverageReportLiteral(stSummary, statusProvider?.providerId ?? null),
        plannedCandidateCount,
        candidatesWithPlannedFillCount,
        candidatesWithoutPlannedFillCount,
        unknownBlockedCandidateCount,
        fullyVerifiedNormalCandidateCount,
        stRejectedCandidateCount,
        unknownBlockedCandidateCountByGroup: { ...unknownBlockedCandidateCountByGroup },
        plannedCandidateCountByGroup: { ...plannedCandidateCountByGroup },
        priceStateCountsByGroup,
        scannedEventCount,
        watchPoolEventCount: pool.pooledEventIds.size,
        watchPoolDecisionDateCount: pool.decisionDates.length,
        excludedByReason: { ...excludedByReason },
        blockedReasons:
          blockedReasons.length > 0 ? blockedReasons : ["ST 覆盖闸门未通过（原因见缺口摘要）"],
        notes: [
          `Dataset ${facts.datasetVersionLabel}（id=${facts.datasetVersionId}）；主窗口 `
          + `${MAIN_WINDOW.startDate} ~ ${MAIN_WINDOW.endDate}。`,
          `ST 闸门契约 ${ST_GATE_CONTRACT_VERSION}；provider = \`${statusProvider?.providerId ?? ABSENT_STATUS_PROVIDER_ID}\`。`,
          "本轮**没有**运行任何撮合（`assembleCompositeRunnerSimulationConfig` 只装配配置、不撮合；"
          + "`runTradeSimulation` 未被调用），"
          + "因此不存在任何交易 / 权益 / 收益读数可供解读。",
        ],
      });
    }
    /**
     * 🔴 严格 PIT 覆盖读数（**证据**）。
     *
     * - 严格模式：`stCoverageReportOf` ⇒ 缺可核验结论即**抛** `ST_COVERAGE_BLOCKED`
     *   （但 `run()` 已在 §9b 显式返回，不会走到这里）。
     * - 轻量模式：用**不抛**的 `stCoverageReportLiteral` 如实留档
     *   （`blocked` 会是 `true` —— 那是**严格 PIT 视角**的事实，**不是**本轮的前置条件）。
     */
    const strictPitEvidence = stPolicy.strictDefault
      ? stCoverageReportOf(stSummary, statusProvider?.providerId ?? null)
      : stCoverageReportLiteral(stSummary, statusProvider?.providerId ?? null);

    // ── 10) 证券身份解析（**闸门之后**；见 §7 注释）+ 买单计划 ────────────────
    perfEnd();
    perfBegin("10.identity_resolution");
    const identity = await resolveRollingPoolSecurityIds(
      seeds.map((seed) => ({ eventId: seed.eventId, symbol: seed.symbol, tradeDate: seed.eventDate })),
    );
    const securityIdByEventId = new Map<string, string>();
    for (const [eventId, canonical] of identity.securityIdByEventId) {
      securityIdByEventId.set(eventId, eventScopedSecurityId(canonical, eventId));
    }
    log(
      `身份解析：identifiers=${identity.identifierRowCount}；已解析 ${identity.securityIdByEventId.size}；`
      + `无法解析 ${identity.unresolvedEventIds.length}`,
    );

    /**
     * 🔴 **分工**（FIX-005 / F1 修正了此前的表述）：
     *
     * | 环节 | 用什么信息 | 作用 |
     * |---|---|---|
     * | 确认日**资格与排序** | **只用确认日收盘已可知**的信息（`confirmCloseBuyEligibility`） | 决定谁进候选池 / Top3 / Random 抽样 |
     * | **真实成交前** | 成交日的 `PRE_FILL` 检查（`executionEligibilityGate`） | ST / UNKNOWN ⇒ **取消订单**（不扣现金、不建仓、不计次数） |
     *
     * 因此这里**只**用确认日资格过滤计划池：**不是**「两时点都 NORMAL 才生成意图」——
     * 成交日的结果在确认日不可知，**绝不能**用来在前一日删股票或递补第 4 名（F1 第 3 条）。
     * 隔夜转 ST 由执行资格闸门在成交时刻拦下。
     */
    const resolvedPlannings = new Map<GroupId, GroupPlanning>();
    /** 🔴 `SORT-PARITY-008` §4.2：**原始价格信号账**（含身份不可解析者），供诊断逐候选核实。 */
    const rawSignalRowsByGroup = new Map<GroupId, readonly CandidateRow[]>();
    let unresolvedIdentityCandidateCount = 0;
    for (const [groupId, planning] of planningByGroup) {
      rawSignalRowsByGroup.set(groupId, planning.candidateRows);
      const resolved: CandidateRow[] = [];
      for (const row of planning.candidateRows) {
        const securityId = securityIdByEventId.get(row.anchorEventId);
        if (securityId === undefined) {
          unresolvedIdentityCandidateCount += 1;
          continue;
        }
        resolved.push({ ...row, securityId });
      }
      const resolvedByDate = new Map<string, CandidateRow[]>();
      for (const row of resolved) {
        const list = resolvedByDate.get(row.date) ?? [];
        list.push(row);
        resolvedByDate.set(row.date, list);
      }
      const sortedDecisionDates = [...resolvedByDate.keys()].sort();
      const plannableByDate = new Map<string, CandidateRow[]>();
      for (const row of resolved) {
        /**
         * 🔴 `RECOVERY-LIGHT-ST-007` §4 —— **候选资格的唯一判据**（确认日收盘时点政策判决）。
         *
         * 严格（缺省）：只认可核验 `NORMAL`（= 004 行为不变）。
         * 轻量：已知 ST 排除；`UNKNOWN` 本轮允许参与；明确正常记录参与。
         * 🔴 ST 排除发生在**排序 / Top3 / Random 抽样之前** ⇒ 不占名次，也**不自动递补第 4 名**。
         *
         * 🔴 `SORT-PARITY-008` §4.1：判据与**诊断侧共用** `candidateExclusionReasonOf`
         *    （身份已解析 + 政策允许参与）⇒ 计划与诊断在结构上不可能各说各话。
         */
        if (candidateExclusionReasonOf({
          identityResolved: true,
          policyParticipatesInRanking: row.confirmCloseStEligibility.participatesInRanking,
        }) !== null) {
          if (stPolicy.knownStOnly) {
            lightCounts.knownStExcludedCandidates += 1;
            bumpByKey(lightCounts.knownStExcludedCandidatesByGroup, groupId);
          }
          continue;
        }
        if (stPolicy.knownStOnly) {
          if (row.confirmCloseStEligibility.status === "UNKNOWN") {
            bumpByKey(lightCounts.participatingUnknownByGroup, groupId);
          } else if (row.confirmCloseStEligibility.status === "NORMAL") {
            bumpByKey(lightCounts.participatingExplicitNormalByGroup, groupId);
          } else {
            bumpByKey(lightCounts.participatingKnownStByGroup, groupId);
          }
        }
        const list = plannableByDate.get(row.date) ?? [];
        list.push(row);
        plannableByDate.set(row.date, list);
      }
      /**
       * 🔴 `SORT-PARITY-008` §4.1 / §4.2 —— **R 的每日候选选择入口**（唯一修复点）。
       *
       * `selectDailyTopByFactor` **消费 `sortCandidates` 的返回值**再取 Top3；
       * 结果按决策日缓存进 `rSelectionByDate`，**计划**与**诊断**都只消费它。
       *
       * 🔴 Random 分支继续使用 `plannableByDate` 的**原始输入顺序**（`cells` 原样传入），
       *    因此同池同种子的随机抽样与本修复**无关、必须不变**（§4.3 第 7 条）。
       */
      const rSelectionByDate = new Map<string, DailyFactorSelection<CandidateRow>>();
      for (const date of sortedDecisionDates) {
        const cells = plannableByDate.get(date) ?? [];
        if (cells.length === 0) continue;
        rSelectionByDate.set(date, selectDailyTopByFactor(cells, DAILY_TOP_K));
      }
      const plans: AccountPlan[] = [{
        accountIndex: 0,
        kind: "R",
        seedIndex: null,
        intentsByDate: intentsOf(plannableByDate, sortedDecisionDates, (cells) =>
          rSelectionByDate.get(cells[0]!.date)?.selected ?? []),
      }];
      for (let drawIndex = 0; drawIndex < runMode.randomAccountCount; drawIndex += 1) {
        const seedIndex = runMode.seedIndexes[drawIndex]!;
        plans.push({
          accountIndex: drawIndex + 1,
          kind: "RANDOM",
          seedIndex,
          intentsByDate: intentsOf(plannableByDate, sortedDecisionDates, (cells) => {
            if (cells.length === 0) return [];
            const drawn = pickUniformRandomSubset({
              eventIds: cells.map((cell) => cell.anchorEventId),
              topK: DAILY_TOP_K,
              seedIndex,
              date: cells[0]!.date,
            });
            const byAnchor = new Map(cells.map((cell) => [cell.anchorEventId, cell]));
            return drawn
              .map((eventId) => byAnchor.get(eventId))
              .filter((cell): cell is CandidateRow => cell !== undefined);
          }),
        });
      }
      resolvedPlannings.set(groupId, {
        ...planning,
        candidateRows: resolved,
        candidatesByDate: resolvedByDate,
        sortedDecisionDates,
        plans,
        rSelectionByDate,
      });
      log(
        `组 ${groupId}：已解析身份候选 ${resolved.length} / 价格信号 ${planning.candidateRows.length}；`
        + `进入买单计划（确认日收盘可核验 NORMAL）${[...plannableByDate.values()].reduce((sum, list) => sum + list.length, 0)}；`
        + `账户 ${plans.length}（R + ${runMode.randomAccountCount} Random）；`
        + `🔴 R 计划 = 因子 Top${DAILY_TOP_K}（preReturn10 降序 → symbol 升序 → eventId 升序），`
        + `与候选排名诊断共用同一个选择结果；`
        + "成交日 ST / UNKNOWN 由执行资格闸门在**成交时刻**拒单（不递补）。",
      );
    }
    if (unresolvedIdentityCandidateCount > 0) {
      log(`⚠️ 身份解析失败的价格信号 ${unresolvedIdentityCandidateCount} 个（已如实计数，不猜身份、不递补）。`);
    }
    if (stPolicy.knownStOnly) {
      log(
        `🔴 轻量政策最终候选账（身份解析之后）：因**已知 ST** 排除 `
        + `${lightCounts.knownStExcludedCandidates} 个价格信号`
        + `（按组 ${JSON.stringify(lightCounts.knownStExcludedCandidatesByGroup)}）；`
        + `进入排序候选 UNKNOWN ${JSON.stringify(lightCounts.participatingUnknownByGroup)}、`
        + `明确NORMAL ${JSON.stringify(lightCounts.participatingExplicitNormalByGroup)}、`
        + `已知ST ${JSON.stringify(lightCounts.participatingKnownStByGroup)}。`
        + "（这些是**来源覆盖与政策描述**，不是优化目标。）",
      );
    }
    planningByGroup.clear();
    for (const [groupId, planning] of resolvedPlannings) planningByGroup.set(groupId, planning);

    // ── 11) 共享执行投影（两组的候选锚点并集；事件作用域身份）───────────────
    perfEnd();
    perfBegin("11.execution_projection");
    const involvedAnchors = new Set<string>();
    for (const planning of planningByGroup.values()) {
      for (const row of planning.plans.flatMap((plan) => [...plan.intentsByDate.values()].flat())) {
        involvedAnchors.add(row.anchorEventId);
      }
    }
    const orderedSeeds = [...seeds].sort(
      (left, right) => left.eventDate.localeCompare(right.eventDate) || left.eventId.localeCompare(right.eventId),
    );
    const rowInputByKey = new Map<string, RollingPoolExecutionRowInput>();
    for (const seed of orderedSeeds) {
      if (!involvedAnchors.has(seed.eventId)) continue;
      const securityId = securityIdByEventId.get(seed.eventId);
      if (securityId === undefined) continue;
      const post = postByEvent.get(seed.eventId);
      if (post === undefined) continue;
      for (const relativeDay of POST_RELATIVE_DAYS) {
        const bar = post.get(relativeDay);
        if (bar === undefined || bar.tradeDate < EXECUTION_ROW_START_DATE) continue;
        rowInputByKey.set(`${bar.tradeDate}\u0000${securityId}`, {
          tradeDate: bar.tradeDate,
          securityId,
          code: seed.symbol,
          exchange: exchangeOf(seed.symbol),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          preClose: bar.preClose,
          volume: bar.volume,
          amount: bar.amount,
          barPresent: bar.barPresent,
          suspended: bar.suspended,
        });
      }
    }
    const rows = [...rowInputByKey.values()].sort(
      (left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) || left.securityId.localeCompare(right.securityId),
    );
    const tradingDates = [...new Set(rows.map((row) => row.tradeDate))].sort();
    if (rows.length === 0 || tradingDates.length === 0) {
      throw new Error("RECOVERY-ST-004：执行投影为空（候选涉及证券没有任何可用 post 行）—— 中止，不出结论。");
    }
    const executionDataset: ResearchDataset = sealRollingPoolExecutionDataset({
      name: "rolling-pool-recovery-st-004-execution-projection",
      startDate: tradingDates[0]!,
      endDate: tradingDates[tradingDates.length - 1]!,
      datasetVersionId: facts.datasetVersionId,
      rows,
      tradingDates,
    });
    const requiredRd = REQUIRED_POST_RELATIVE_DAY;
    if (POST_MAX_RELATIVE_DAY < requiredRd) {
      log(
        `⚠️ 组合执行理论上需要约 rd${requiredRd}（L=20 + Runner 续持 ${RUNNER_EXTEND_HOLDING_DAYS}），`
        + `Dataset 物理上界 rd${POST_MAX_RELATIVE_DAY} ⇒ 长仓可能在期末 MTM 收尾（**不**允许静默强平/补价）。`,
      );
    }

    // ── 11) 冻结退出政策（唯一继承物；指纹漂移即响亮失败）───────────────────
    perfEnd();
    perfBegin("11b.frozen_policy");
    const bundle = await loadFrozenRunnerPolicyBundle();
    if (bundle.sourceFingerprint !== FROZEN_STRATEGY_REFERENCE.fingerprint) {
      throw new Error("RECOVERY-ST-004：冻结策略指纹与 result.ts 声明不一致。拒绝继续。");
    }
    const runnerBridge = runnerBridgeOf(bundle);

    /**
     * 🔴 FIX-005 / F1 —— **成交前** ST 执行资格闸门（研究装配层注入执行层的唯一实现）。
     *
     * 走到这里说明 ST 覆盖闸门已通过（provider 存在、计划检查点全可核验），因此
     * `statusProvider` 非空；闸门在**真实成交时刻**再判一次 `PRE_FILL`：
     * ST / UNKNOWN ⇒ 引擎在扣现金 / 建仓 / 计成本 / 计成交次数**之前**拒单。
     */
    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §4 —— **成交前**资格闸门（研究装配层注入执行层的唯一实现）。
     *
     * - 严格模式（缺省）：`createStExecutionEligibilityGate`（**同一个** `evaluateStGate`，`PRE_FILL`）
     *   —— 走到这里说明严格覆盖闸门已通过，因此 `statusProvider` 非空。
     * - 轻量模式：`createKnownStOnlyEligibilityGate`（**已知 ST 才拒绝**；`UNKNOWN` 本轮允许），
     *   并在执行配置里**显式声明** `executionEligibilityUnknownPolicy = "ALLOW_WHEN_DECISION_ALLOWS"`
     *   —— 缺省 `REJECT` 保持既有行为逐字节不变。
     */
    const stExecutionEligibilityGate: ExecutionEligibilityGate | null = stPolicy.knownStOnly
      ? (knownStIndex === null
        ? null
        : createKnownStOnlyEligibilityGate({ index: knownStIndex, policy: stPolicy }))
      : (statusProvider === null
        ? null
        : createStExecutionEligibilityGate({ provider: statusProvider }));
    if (stExecutionEligibilityGate === null) {
      throw new Error(
        stPolicy.knownStOnly
          ? "RECOVERY-LIGHT-ST-007：轻量模式要求已载入的历史标签索引 —— "
            + "不允许在没有执行资格闸门的情况下撮合。"
          : "RECOVERY-ST-004：非暂停路径要求可核验 provider —— "
            + "不允许在没有执行资格闸门的情况下撮合。",
      );
    }

    const buildSourceRun = (
      plan: AccountPlan,
      planning: GroupPlanning,
    ): CandidateEvaluationRun => {
      const dayRecords: CandidateDayRecord[] = [];
      for (const date of tradingDates) {
        const picked = plan.intentsByDate.get(date) ?? [];
        const cells = planning.candidatesByDate.get(date) ?? [];
        const universeMembers = [...new Set(cells.map((cell) => cell.securityId))].sort();
        const selected: SelectedCandidate[] = picked.map((intent) => ({
          securityId: intent.securityId,
          rank: intent.rank,
          percentile: intent.percentile,
          value: intent.signalValue,
        }));
        const positionIntents: PositionIntent[] = picked.map((intent) => ({
          securityId: intent.securityId,
          direction: "long",
          rank: intent.rank,
          percentile: intent.percentile,
          weight: picked.length === 0 ? 0 : 1 / picked.length,
          signalValue: intent.signalValue,
          confidence: null,
        }));
        dayRecords.push({
          date,
          universeMembers,
          signalCount: universeMembers.length,
          dropped: [],
          selected,
          positionIntents,
        });
      }
      const evaluation = evaluateCandidateRun(dayRecords);
      const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
        recordKind: "CANDIDATE_EVALUATION_RUN",
        recordVersion: 1,
        datasetVersion: executionDataset.datasetVersion,
        builderVersion: SOURCE_RUN_BUILDER_VERSION,
        rowSchemaVersion: SOURCE_RUN_BUILDER_VERSION,
        datasetGate: executionDataset.gate,
        universeId: `${SOURCE_RUN_BUILDER_VERSION}:${executionDataset.datasetVersion}`,
        strategyId: plan.kind === "R"
          ? `study-recovery-st-${planning.spec.id}-r`
          : `study-recovery-st-${planning.spec.id}-random`,
        strategyVersion: COMPUTATION_VERSION,
        parameters: {
          group: planning.spec.id,
          breachPolicy: planning.spec.breachPolicy,
          entryFillMaxRd: planning.spec.entryFillMaxRd,
          confirmMinRd: planning.spec.confirmMinRd,
          confirmMaxRd: planning.spec.confirmMaxRd,
          accountIndex: plan.accountIndex,
          accountKind: plan.kind,
          seedIndex: plan.seedIndex ?? -1,
          dailyTopK: DAILY_TOP_K,
          positionFraction: POSITION_FRACTION,
          maxPositions: MAX_POSITIONS,
          maxDailyBuys: MAX_DAILY_BUYS,
          stGateContractVersion: ST_GATE_CONTRACT_VERSION,
        },
        dateRange: {
          startDate: planning.sortedDecisionDates[0] ?? tradingDates[0]!,
          endDate: planning.sortedDecisionDates[planning.sortedDecisionDates.length - 1]
            ?? tradingDates[tradingDates.length - 1]!,
        },
        point: "close",
        signalDescription:
          `首板滚动池（rd1..40 锚点）+ ${planning.spec.breachPolicy}：`
          + `A = 003 的 D（N=5 日各 ≥3 分 → 收盘突破前两日高点 + 量能回升；首次可靠破位后永久停买）；`
          + `B = 未破位同 A，破位后走 §3.3 局部修复分支（F + W=[d−5,d−1] 综合分 ≥15/20 + 确认日突破放量）。`
          + `确认 rd ∈ [${planning.spec.confirmMinRd}, ${planning.spec.confirmMaxRd}]，成交 rd ≤ ${planning.spec.entryFillMaxRd}；`
          + `账户层按 preReturn10 HIGH 取前 ${DAILY_TOP_K}（R）或同日同池同人数均匀无放回随机（Random）。`,
        featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
        rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
        selectionConfig: { method: { kind: "topN", n: DAILY_TOP_K } },
        days: dayRecords,
        evaluation,
      };
      return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
    };

    // ── 12) 逐组：权威装配一次 + N+1 个账户用**同一个** simConfig ────────────
    perfEnd();
    perfBegin("12.assembly_and_matching");
    const simStartDate = tradingDates[0]!;
    const simEndDate = tradingDates[tradingDates.length - 1]!;
    let assembledConfigJson: string | null = null;
    /**
     * 🔴 FIX-005 续修（Finding A）：逐组的**权威装配配置**留档（契约版本 + 配置指纹 + 装配事实）。
     *
     * 它不是运行结果，也不参与任何计算；存在的唯一目的是让「这两组账户跑的是哪一份配置、
     * 由哪个入口按哪版契约装配出来的」成为**可对账的产物事实**（而不是只存在于日志里）。
     */
    const assemblyConfigRecords: {
      readonly groupId: GroupId;
      readonly entryPoint: string;
      readonly name: string;
      readonly contractVersion: string;
      readonly assemblyConfigFingerprint: string;
      readonly datasetVersion: string;
      readonly datasetSource: string;
      readonly datasetVersionId: number | null;
      readonly eventWindowExitTailTradingDays: number | null;
      readonly runtimeOverrides: readonly string[];
      readonly strategyDecisionEngine: string;
      /** 辅助装配**不撮合**：这次调用没有产生任何交易 / 权益点（结构上无 `run` 字段）。 */
      readonly matchingExecutedInAuxiliaryPath: false;
    }[] = [];
    const groupSummaries: GroupSummary[] = [];
    /** 🔴 §6：跨组的执行面观测汇总（只观测，**不**自动阻断；用于区分亏损与数据不可判定）。 */
    const executionObservationsTotal = {
      unclosedPositionsR: 0,
      unclosedPositionsRandom: 0,
      rejectionByReason: {} as Record<string, number>,
      knownStRejectionAfterExistingFillInAnchor: 0,
      maxHoldingPeriod: 0,
    };
    const artifactBundleByGroup = new Map<GroupId, GroupArtifactBundle>();
    const coverageByGroup = new Map<GroupId, { hits: ReadonlySet<string>; chain: Map<string, number> }>();

    // 共同锚点宇宙：两组共有 + 数据资格可核实（在池内、有决策日、preReturn10 可评估）。
    const commonAnchorIds = new Set<string>();
    {
      const perGroup = new Map<GroupId, Set<string>>();
      for (const planning of planningByGroup.values()) {
        const ids = new Set<string>();
        for (const row of pool.dailyRows) {
          if (row.preReturn10 === null) continue;
          if (!planning.evaluations.has(row.anchorEventId)) continue;
          ids.add(row.anchorEventId);
        }
        perGroup.set(planning.spec.id, ids);
      }
      const [first, second] = GROUPS;
      const left = perGroup.get(first!.id) ?? new Set<string>();
      const right = perGroup.get(second!.id) ?? new Set<string>();
      for (const id of left) if (right.has(id)) commonAnchorIds.add(id);
    }
    log(`共同锚点宇宙（两组共有 + 因子可评估）：${commonAnchorIds.size} 个`);

    for (const spec of GROUPS) {
      const planning = planningByGroup.get(spec.id)!;
      const rSourceRun = buildSourceRun(planning.plans[0]!, planning);
      /**
       * 🔴 FIX-005 续修（Finding A）：这里改用**权威装配配置入口**
       * （`assembleCompositeRunnerSimulationConfig`，契约 `composite-assembly-config/1.0.0`）。
       *
       * 此前调用的是 `runCompositeRunnerBacktest`：它除了装配配置，还会**真的撮合一次**
       * （`runTradeSimulation`），而那次撮合的结果在本实验里**被丢弃**（只用
       * `assembly.simulationConfig`）。丢弃的撮合不仅浪费，而且当时不接受执行资格闸门
       * ⇒ 未声明的辅助路径上仍可能买进一笔隔夜 ST（正是 F1 要堵的洞）。
       *
       * 现在：辅助路径**不撮合**（结构上不存在 `run` / 交易 / 权益曲线），
       * 账户级撮合只发生在下面的账户循环里，且**全部**带 `executionEligibilityGate`。
       * 装配口径与 `runCompositeRunnerBacktest` 共用同一段实现 ⇒ 配置逐字节不变。
       */
      const assembly = await assembleCompositeRunnerSimulationConfig({
        dataset: executionDataset,
        strategyDocument: bundle.document,
        dateRange: { startDate: simStartDate, endDate: simEndDate },
        datasetVersionId: facts.datasetVersionId,
        codeVersion: COMPUTATION_VERSION,
        createdAt: FROZEN_CREATED_AT,
        name: `recovery-st-004-${spec.id}-assembly`,
        runnerBridge,
      });
      const assembledBase = assembly.simulationConfig;
      assemblyConfigRecords.push({
        groupId: spec.id,
        entryPoint: "assembleCompositeRunnerSimulationConfig",
        name: `recovery-st-004-${spec.id}-assembly`,
        contractVersion: assembly.contractVersion,
        assemblyConfigFingerprint: assembly.assemblyConfigFingerprint,
        datasetVersion: assembly.assembly.datasetVersion,
        datasetSource: assembly.assembly.datasetSource,
        datasetVersionId: assembly.assembly.datasetVersionId,
        eventWindowExitTailTradingDays: assembly.assembly.eventWindowExitTailTradingDays ?? null,
        runtimeOverrides: [...assembly.assembly.runtimeOverrides],
        strategyDecisionEngine: assembly.assembly.strategyDecisionEngine,
        matchingExecutedInAuxiliaryPath: false,
      });
      const assembledJson = JSON.stringify({ ...assembledBase, name: null });
      if (assembledConfigJson === null) assembledConfigJson = assembledJson;
      else if (assembledConfigJson !== assembledJson) {
        throw new Error(
          `RECOVERY-ST-004：组 ${spec.id} 的权威装配配置与其他组不同 —— 两组必须只有一个执行口径。`,
        );
      }
      if (
        assembledBase.positionSizing?.sizingMethod !== "EQUITY_FRACTION"
        || assembledBase.positionSizing.fraction !== POSITION_FRACTION
      ) {
        throw new Error(
          "RECOVERY-ST-004：装配出的仓位口径不是 "
          + `EQUITY_FRACTION/${POSITION_FRACTION}（实际 ${String(assembledBase.positionSizing?.sizingMethod)}`
          + `/${String(assembledBase.positionSizing?.fraction)}）—— 拒绝继续。`,
        );
      }
      if (assembledBase.candidateExitPolicy !== "DISABLED") {
        throw new Error(
          `RECOVERY-ST-004：装配出的候选退出政策不是 DISABLED（实际 ${assembledBase.candidateExitPolicy}）—— 拒绝继续。`,
        );
      }

      const groupSimConfig: SimulationConfig = Object.freeze({
        ...assembledBase,
        name: `recovery-st-004-${spec.id}`,
        // 允许平仓后由新收盘信号再次入场；同真实股票并发上限 1。
        reentryPolicy: {
          securityCooldownTradingDays: null,
          maxEntriesPerMember: null,
          maxConcurrentOpenPerCode: 1,
        },
        // 🔴 FIX-005 / F1：成交前 ST 拒单（研究装配层注入；R 与 Random 用**同一个**闸门）。
        executionEligibilityGate: stExecutionEligibilityGate,
        /**
         * 🔴 `RECOVERY-LIGHT-ST-007` §4：**仅在轻量模式**显式声明 UNKNOWN 可放行。
         *    严格模式**不写该键** ⇒ 配置快照与冻结指纹逐字节不变。
         */
        ...(stPolicy.knownStOnly
          ? { executionEligibilityUnknownPolicy: "ALLOW_WHEN_DECISION_ALLOWS" as const }
          : {}),
      });

      const accounts: AccountMetrics[] = [];
      /**
       * 目标 §8 的 S5 产物明细（**逐行**：既不在信封里、也不在内存里留到最后 ——
       * 在账户循环里就地收齐，循环结束即落盘）。
       */
      const groupArtifacts = {
        rTrades: [] as Record<string, unknown>[],
        randomTrades: [] as Record<string, unknown>[],
        rEquity: [] as Record<string, unknown>[],
        anchorChains: [] as Record<string, unknown>[],
        failedAttempts: [] as Record<string, unknown>[],
        fillStAudit: [] as Record<string, unknown>[],
        eligibilityRejections: [] as Record<string, unknown>[],
      };
      const rCompleted: CompletedAnchorFact[] = [];
      const randomCompletedReturns: number[] = [];
      const allTail20AnchorIds: string[] = [];
      const allTail20Symbols: string[] = [];
      const rChainNet = new Map<string, number>();
      const rTail20 = new Set<string>();
      const adverseByHorizon = new Map<number, number[]>();
      const yearlyR = new Map<number, number>();
      const yearlyRandom = new Map<number, number[]>();
      let firstConfigJson: string | null = null;
      let fillCount = 0;
      let rejectedOrderCount = 0;
      let skippedIntentCount = 0;
      let randomTradeCount = 0;
      let randomOpenAtEnd = 0;
      let randomFillCount = 0;
      let randomSkipped = 0;
      let randomRejected = 0;
      /** 🔴 §6 必要观测：未平仓 / 缺执行 bar / 不可卖 / 尾部延长持有的暴露（**只观测，不自动阻断**）。 */
      const executionObservations = {
        unclosedPositionsR: 0,
        unclosedPositionsRandom: 0,
        /** 引擎 `executionStats.byReason` 的**原样**聚合（跨账户）。 */
        rejectionByReason: {} as Record<string, number>,
        /** 同锚点**已入场后**又遇已知 ST 而被拒的订单数（来自真实撮合审计）。 */
        knownStRejectionAfterExistingFillInAnchor: 0,
        /** 单笔最长持有天数（用于判断尾部是否被 rd80 截断；**不**自动阻断）。 */
        maxHoldingPeriod: 0,
      };
      const bumpReason = (reason: string, count: number): void => {
        if (count <= 0) return;
        executionObservations.rejectionByReason[reason] =
          (executionObservations.rejectionByReason[reason] ?? 0) + count;
      };

      for (const plan of planning.plans) {
        const sourceRun = plan.kind === "R" ? rSourceRun : buildSourceRun(plan, planning);
        const run = runTradeSimulation({ dataset: executionDataset, sourceRun, simConfig: groupSimConfig });
        const configJson = JSON.stringify(run.config);
        if (firstConfigJson === null) firstConfigJson = configJson;
        else if (firstConfigJson !== configJson) {
          throw new Error(
            `RECOVERY-ST-004：组 ${spec.id} 账户 ${plan.accountIndex} 的 config 快照与首个账户不同。`,
          );
        }
        const derivation = deriveAccount({ group: spec.id, plan, run });
        accounts.push(derivation.metrics);
        fillCount += run.executionStats.totalFills;
        rejectedOrderCount += run.executionStats.rejectedOrders;
        skippedIntentCount += run.skipped.length;
        // 🔴 §6 必要观测（区分真实交易亏损与数据造成的不可判定；**不**据此自动阻断或重建）。
        for (const [reason, count] of Object.entries(run.executionStats.byReason)) {
          bumpReason(reason, typeof count === "number" ? count : 0);
        }
        if (plan.kind === "R") {
          executionObservations.unclosedPositionsR += derivation.metrics.openAtEndCount;
        } else {
          executionObservations.unclosedPositionsRandom += derivation.metrics.openAtEndCount;
        }
        if (
          typeof derivation.metrics.averageHoldingPeriod === "number"
          && derivation.metrics.averageHoldingPeriod > executionObservations.maxHoldingPeriod
        ) {
          executionObservations.maxHoldingPeriod = derivation.metrics.averageHoldingPeriod;
        }

        // ---- S5 明细产物（逐行就地收齐；🔴 只写真实发生过的事实，不补价、不猜）----
        const accountLabel = plan.kind === "R" ? "R" : `RANDOM#${plan.accountIndex}`;
        for (const row of derivation.tradeRows) {
          const enriched: Record<string, unknown> = { account: accountLabel, ...row };
          if (plan.kind === "R") groupArtifacts.rTrades.push(enriched);
          else groupArtifacts.randomTrades.push(enriched);
        }
        if (plan.kind === "R") {
          for (const point of run.equityCurve) {
            groupArtifacts.rEquity.push({
              group: spec.id,
              account: "R",
              date: point.date,
              cash: point.cash,
              marketValue: point.marketValue,
              equity: point.equity,
              openPositions: point.openPositions,
            });
          }
        }
        for (const [anchorEventId, chainNetPnl] of derivation.anchorChainNetPnl) {
          groupArtifacts.anchorChains.push({
            group: spec.id,
            account: accountLabel,
            anchorEventId,
            symbol: anchorEventId.split("@")[0] ?? anchorEventId,
            chainNetPnl,
          });
        }
        for (const entry of run.skipped) {
          if (entry.side !== "buy") continue;
          groupArtifacts.failedAttempts.push({
            group: spec.id,
            account: accountLabel,
            anchorEventId: anchorEventIdOf(entry.securityId),
            symbol: symbolOfSecurityId(entry.securityId),
            attemptedConfirmDate: entry.date,
            skipCode: entry.code,
            reason: entry.reason,
            note: "来自 run.skipped 的**建仓**意图（绝不静默丢弃）；未买 / 容量受限 / 持仓内阻断分开看 skipCode。",
          });
        }
        /**
         * 🔴 FIX-005 / F1 —— **真实成交**的逐笔执行 ST 审计。
         *
         * 判据不再是「事后按候选表推断」，而是引擎在**成交时刻**真正调用的闸门判决
         * （`run.executionEligibilityAudit`）。任何一笔真实成交若其 `status !== "NORMAL"`，
         * **整轮立刻失败**（绝不只写个 `false` 进 CSV 然后继续报告收益）。
         */
        const fillAuditByKey = new Map<string, ExecutionEligibilityAuditEntry>();
        for (const auditRow of run.executionEligibilityAudit ?? []) {
          if (auditRow.outcome !== "FILLED") continue;
          fillAuditByKey.set(`${auditRow.securityId}\u0000${auditRow.executionDate}`, auditRow);
        }
        for (const trade of run.trades) {
          const anchorEventId = anchorEventIdOf(trade.securityId);
          const candidate = planning.candidateRows.find(
            (row) => row.anchorEventId === anchorEventId && row.fillDate === trade.entryTime,
          );
          const gate = candidate === undefined
            ? null
            : candidateGates.get(`${spec.id}\u0000${anchorEventId}\u0000${candidate.confirmRd}`) ?? null;
          const realFillDecision = fillAuditByKey.get(`${trade.securityId}\u0000${trade.entryTime}`) ?? null;
          if (realFillDecision === null) {
            throw new Error(
              `RECOVERY-ST-004：真实成交（${trade.securityId} @ ${trade.entryTime}）没有执行资格判决记录`
              + " —— 成交前 ST 闸门没有真正接进撮合链，拒绝继续（整轮失败）。",
            );
          }
          /**
           * 🔴 `RECOVERY-LIGHT-ST-007` §4：真实成交的资格状态必须落在**本轮政策允许的集合**内。
           *
           * - 严格模式：只有 `NORMAL`；
           * - 轻量模式：`NORMAL` 或 `UNKNOWN`（**真实状态原样保留**，不写成 NORMAL）；`ST` 一律失败。
           */
          if (
            !executionEligibilityStatusAllowed(
              realFillDecision.status,
              stPolicy.knownStOnly ? "ALLOW_WHEN_DECISION_ALLOWS" : "REJECT",
            )
          ) {
            throw new Error(
              `RECOVERY-ST-004：真实成交（${trade.securityId} @ ${trade.entryTime}）的执行资格 status=`
              + `${realFillDecision.status}（reason=${realFillDecision.reason}）—— 本轮政策不允许该状态成交，整轮失败。`,
            );
          }
          groupArtifacts.fillStAudit.push({
            group: spec.id,
            account: accountLabel,
            securityId: trade.securityId,
            anchorEventId,
            symbol: symbolOfSecurityId(trade.securityId),
            confirmDate: candidate?.date ?? "",
            confirmRd: candidate?.confirmRd ?? "",
            fillDate: trade.entryTime,
            branch: candidate?.branch ?? "",
            confirmCloseOutcome: gate?.confirmClose.outcome ?? "UNKNOWN",
            confirmCloseReason: gate?.confirmClose.reason ?? "NO_GATE_FOR_FILL",
            confirmCloseEffectiveAt: gate?.confirmClose.effectiveAt ?? "",
            confirmCloseEvidence: gate?.confirmClose.fact?.evidenceFingerprint ?? "",
            // 🔴 成交前一格来自**引擎在成交时刻**的真实判决（不是候选阶段预计算值）。
            preFillOutcome: realFillDecision.status,
            preFillReason: realFillDecision.reason,
            preFillEffectiveAt: realFillDecision.checkedAt,
            preFillEvidence: realFillDecision.evidenceFingerprint ?? "",
            buyAllowed: executionEligibilityStatusAllowed(
              realFillDecision.status,
              stPolicy.knownStOnly ? "ALLOW_WHEN_DECISION_ALLOWS" : "REJECT",
            ),
            providerId: realFillDecision.providerId,
            eligibilityGateId: realFillDecision.gateId,
            eligibilityPolicyVersion: realFillDecision.policyVersion,
            plannedCheckDate: realFillDecision.plannedCheckDate ?? trade.entryTime,
            actualCheckDate: realFillDecision.executionDate,
            eligibilityOutcome: realFillDecision.outcome,
            stPolicyId: stPolicy.id,
            note: stPolicy.knownStOnly
              ? "每一笔**真实成交**都必须落在本轮政策允许的状态集合内（`NORMAL` 或**显式声明的** `UNKNOWN`）；"
                + "`UNKNOWN` 原样保留、**绝不**改写为 `NORMAL`；`ST` 成交数必须为 0。"
                + "本表来自引擎真实调用记录（目标 §8 / FIX-005 F1 / LIGHT-ST-007 §4）。"
              : "每一笔**真实成交**都必须有 NORMAL 的执行资格判决：本表来自引擎真实调用记录"
                + "（目标 §8 / FIX-005 F1）。`ST` 成交数与无证据成交数必须为 0；不为 0 即本 Run 不合格。",
          });
        }
        /**
         * 🔴 `RECOVERY-LIGHT-ST-007` §7 问题 5 —— **真实撮合链**上的状态三分账。
         *
         * 来源 = 引擎逐笔执行资格审计（引擎在成交时刻的**真实调用记录**，不是事后推断）。
         * 计数单位为**订单**（跨账户）；与「价格信号数」分开列，不混用。
         */
        for (const auditRow of run.executionEligibilityAudit ?? []) {
          lightOrderStats.orderChecks += 1;
          if (auditRow.status === "ST") {
            lightOrderStats.knownStOrders += 1;
            if (auditRow.outcome === "REJECTED") lightOrderStats.knownStRejectedOrders += 1;
          } else if (auditRow.status === "UNKNOWN") {
            lightOrderStats.unknownOrders += 1;
            if (auditRow.outcome === "FILLED") lightOrderStats.unknownFilledOrders += 1;
            else lightOrderStats.unknownRejectedOrders += 1;
          } else if (auditRow.status === "NORMAL") {
            lightOrderStats.normalOrders += 1;
            if (auditRow.outcome === "FILLED") lightOrderStats.normalFilledOrders += 1;
          }
        }
        /**
         * FIX-005 / F1 —— 逐笔执行资格**拒单产物**（股票 / 锚点 / 账户 / 计划 vs 实际检查日 /
         * 状态 / 原因 / provider / 来源指纹）。区分「闸门拒绝」与「闸门放行但被后续撮合约束拒绝」。
         */
        for (const auditRow of run.executionEligibilityAudit ?? []) {
          if (auditRow.outcome !== "REJECTED") continue;
          if (
            auditRow.status === "ST"
            && run.trades.some((trade) => anchorEventIdOf(trade.securityId) === anchorEventIdOf(auditRow.securityId))
          ) {
            executionObservations.knownStRejectionAfterExistingFillInAnchor += 1;
          }
          groupArtifacts.eligibilityRejections.push({
            group: spec.id,
            account: accountLabel,
            orderId: auditRow.orderId,
            securityId: auditRow.securityId,
            anchorEventId: anchorEventIdOf(auditRow.securityId),
            symbol: symbolOfSecurityId(auditRow.securityId),
            plannedCheckDate: auditRow.plannedCheckDate ?? "",
            actualCheckDate: auditRow.executionDate,
            plannedDate: auditRow.plannedDate,
            checkedAt: auditRow.checkedAt,
            status: auditRow.status,
            reason: auditRow.reason,
            providerId: auditRow.providerId,
            gateId: auditRow.gateId,
            policyVersion: auditRow.policyVersion,
            evidenceFingerprint: auditRow.evidenceFingerprint ?? "",
            rejectedBy: auditRow.status === "NORMAL"
              ? "DOWNSTREAM_MATCHING_CONSTRAINT"
              : "EXECUTION_ELIGIBILITY_GATE",
            note: auditRow.status === "NORMAL"
              ? "闸门放行，但被后续撮合约束（现金 / 涨跌停 / 持仓 / 停牌等）拒绝。"
              : "成交前 ST 闸门拒绝：不扣现金、不建仓、不计成交次数；不递补第 4 名。",
          });
        }

        if (plan.kind === "R") {
          rCompleted.push(...derivation.completed);
          for (const anchorId of derivation.tail20AnchorIds) rTail20.add(anchorId);
          for (const fact of derivation.completed) {
            const anchorId = fact.anchorEventId;
            rChainNet.set(anchorId, (rChainNet.get(anchorId) ?? 0) + (fact.netPnl ?? 0));
            // 前 3/5 个交易日不利波动（用该锚点真实 post 行的 low；缺 bar 不补价）。
            const eventPost = postByEvent.get(anchorId);
            if (eventPost !== undefined) {
              for (const horizon of ADVERSE_EXCURSION_HORIZONS) {
                const value = adverseExcursionForTrade({
                  post: eventPost,
                  anchorEventId: anchorId,
                  entryDate: fact.entryDate,
                  entryPrice: entryPriceOf(run, fact),
                  horizonDays: horizon,
                });
                if (value === null) continue;
                const list = adverseByHorizon.get(horizon) ?? [];
                list.push(value);
                adverseByHorizon.set(horizon, list);
              }
            }
          }
          for (const row of derivation.yearlyEquityReturns) yearlyR.set(row.year, row.returnPct);
        } else {
          randomCompletedReturns.push(...derivation.completed.map((fact) => fact.returnPct));
          for (const anchorId of derivation.tail20AnchorIds) allTail20AnchorIds.push(anchorId);
          for (const symbol of derivation.tail20Symbols) allTail20Symbols.push(symbol);
          randomTradeCount += derivation.metrics.tradeCount;
          randomOpenAtEnd += derivation.metrics.openAtEndCount;
          randomFillCount += derivation.metrics.fillCount;
          randomSkipped += derivation.metrics.skippedIntentCount;
          randomRejected += derivation.metrics.rejectedOrderCount;
          for (const row of derivation.yearlyEquityReturns) {
            const list = yearlyRandom.get(row.year) ?? [];
            list.push(row.returnPct);
            yearlyRandom.set(row.year, list);
          }
        }
      }

      const rAccount = accounts[0]!;
      const rTail = tailRateBlockOf({
        label: "R（preReturn10 HIGH）",
        completedReturns: rCompleted.map((fact) => fact.returnPct),
        tradeCount: rAccount.tradeCount,
        openAtEndCount: rAccount.openAtEndCount,
        fillCount: rAccount.fillCount,
        skippedIntentCount: rAccount.skippedIntentCount,
        rejectedOrderCount: rAccount.rejectedOrderCount,
        uniqueTail20AnchorIds: [...new Set(rTail20)],
        uniqueTail20Symbols: rCompleted
          .filter((fact) => fact.returnPct >= TAIL_THRESHOLDS_PCT[0])
          .map((fact) => fact.symbol),
      });
      const randomPooledTail = tailRateBlockOf({
        label: `pooled Random（${runMode.randomAccountCount} 账户）`,
        completedReturns: randomCompletedReturns,
        tradeCount: randomTradeCount,
        openAtEndCount: randomOpenAtEnd,
        fillCount: randomFillCount,
        skippedIntentCount: randomSkipped,
        rejectedOrderCount: randomRejected,
        uniqueTail20AnchorIds: allTail20AnchorIds,
        uniqueTail20Symbols: allTail20Symbols,
      });
      const coverage = anchorCoverageOf({
        group: spec.id,
        commonAnchorIds,
        completed: rCompleted,
      });
      coverageByGroup.set(spec.id, { hits: rTail20, chain: rChainNet });

      const perYear = accountCoveragePerYearOf({
        group: spec.id,
        commonAnchorIds,
        completed: rCompleted,
        firstPoolDateByAnchor,
        yearlyAccountReturns: yearlyR,
      });
      const adverseExcursion: AdverseExcursionRow[] = ADVERSE_EXCURSION_HORIZONS.map((horizon) => {
        const values = adverseByHorizon.get(horizon) ?? [];
        return {
          horizonDays: horizon,
          sampleCount: values.length,
          worstPct: values.length === 0 ? null : Math.min(...values),
          meanPct: meanOf(values),
        };
      });

      groupSummaries.push({
        group: spec.id,
        label: spec.label,
        breachPolicy: spec.breachPolicy,
        decisionDateCount: planning.sortedDecisionDates.length,
        candidateRowCount: planning.candidateRows.length,
        triggerAnchorCount: planning.triggerAnchorCount,
        breachedAnchorCount: planning.breachedAnchorCount,
        permanentlyDisabledAnchorCount: planning.permanentlyDisabledAnchorCount,
        recoverySignalCount: planning.recoverySignalCount,
        gapBrokenEpisodeCount: planning.gapBrokenEpisodeCount,
        dailyUnknownBlockedDayCount: planning.dailyUnknownBlockedDayCount,
        dailyStBlockedDayCount: planning.dailyStBlockedDayCount,
        fillCount,
        rejectedOrderCount,
        skippedIntentCount,
        accounts,
        rTail,
        randomPooledTail,
        coverage,
        adverseExcursion,
        perYear,
        configSnapshotJson: firstConfigJson ?? "{}",
      });
      // 🔴 §6 观测汇总（跨组）：只记录，**不**据此自动阻断 / 强平 / 重建。
      executionObservationsTotal.unclosedPositionsR += executionObservations.unclosedPositionsR;
      executionObservationsTotal.unclosedPositionsRandom += executionObservations.unclosedPositionsRandom;
      executionObservationsTotal.knownStRejectionAfterExistingFillInAnchor +=
        executionObservations.knownStRejectionAfterExistingFillInAnchor;
      executionObservationsTotal.maxHoldingPeriod = Math.max(
        executionObservationsTotal.maxHoldingPeriod,
        executionObservations.maxHoldingPeriod,
      );
      for (const [reason, count] of Object.entries(executionObservations.rejectionByReason)) {
        executionObservationsTotal.rejectionByReason[reason] =
          (executionObservationsTotal.rejectionByReason[reason] ?? 0) + count;
      }
      progress(`group ${spec.id} executed: accounts=${accounts.length}`);
      artifactBundleByGroup.set(spec.id, {
        accounts,
        ...groupArtifacts,
      });
    }

    // ── 13) 主比较：`B_R − A_R`（覆盖率差；按锚点首次进池日聚类配对）────────
    perfEnd();
    perfBegin("13.statistics_and_bootstrap");
    const calendar = pool.decisionDates;
    const calendarWithEmptyDays = [...calendar];
    for (const anchorId of commonAnchorIds) {
      const date = firstPoolDateByAnchor.get(anchorId);
      if (date !== undefined && !calendarWithEmptyDays.includes(date)) calendarWithEmptyDays.push(date);
    }
    calendarWithEmptyDays.sort();

    const fromGroupId: GroupId = "B_RECOVERY_20";
    const toGroupId: GroupId = "A_STRICT_20";
    const fromCoverageData = coverageByGroup.get(fromGroupId)!;
    const toCoverageData = coverageByGroup.get(toGroupId)!;
    const difference = pairedDifferenceOf({
      calendar: calendarWithEmptyDays,
      fromCells: coverageCellsOf({
        commonAnchorIds: [...commonAnchorIds],
        firstPoolDateByAnchor,
        hitAnchorIds: fromCoverageData.hits,
        chainNetPnlByAnchor: fromCoverageData.chain,
      }),
      toCells: coverageCellsOf({
        commonAnchorIds: [...commonAnchorIds],
        firstPoolDateByAnchor,
        hitAnchorIds: toCoverageData.hits,
        chainNetPnlByAnchor: toCoverageData.chain,
      }),
    });

    const fromCoverage = groupSummaries.find((group) => group.group === fromGroupId)!.coverage;
    const toCoverage = groupSummaries.find((group) => group.group === toGroupId)!.coverage;
    const sameDirectionYears = GATE_YEARS.filter((year) => {
      const fromRow = groupSummaries.find((group) => group.group === fromGroupId)!
        .perYear.find((row) => row.year === year);
      const toRow = groupSummaries.find((group) => group.group === toGroupId)!
        .perYear.find((row) => row.year === year);
      if (fromRow === undefined || toRow === undefined) return false;
      if (fromRow.coverage === null || toRow.coverage === null) return false;
      return fromRow.coverage - toRow.coverage > 0;
    });
    const judgement = judgePrimaryComparison({
      fromCoverage,
      toCoverage,
      blockPrimary: difference.blockPrimary,
      blockSensitivity: difference.blockSensitivity,
      pointEstimate: difference.pointEstimate,
      sameDirectionYears,
      gateYears: [...GATE_YEARS],
    });
    const primaryComparison: PrimaryComparison = {
      key: "B_R − A_R（≥+20% 唯一锚点覆盖率差）",
      classification: "PRIMARY",
      fromGroup: fromGroupId,
      toGroup: toGroupId,
      pointEstimate: difference.pointEstimate,
      difference,
      clusterKey: "每个共同锚点**首次进入观察池**的日期（共享日历、空日保留、共享抽样索引）",
      calendarLength: difference.blockPrimary?.calendarLength ?? calendarWithEmptyDays.length,
      sampleGateMet: judgement.sampleGateMet,
      supported: judgement.supported,
      gateReason: judgement.gateReason,
      note: `${judgement.note}（逐年同向年度：${sameDirectionYears.join(" / ") || "无"}）`,
    };

    // ── 14) 产物：目标 §8 的 S5 产物集（逐行明细一律走 `context.artifact`）────
    perfEnd();
    perfBegin("14.artifacts");
    //
    // 🔴 只有**可核验终态**才走到这里（暂停终态已在 §9b 返回，且只交付覆盖缺口）。
    // 🔴 产物名字与 `RECOVERY_ST_S5_ARTIFACTS` 名单一一对应；`{group}` / `{year}` / `{shard}`
    //    在下面被替换成真实值。
    const runElapsedMs = Date.now() - runStartedAt;
    const s5ArtifactNames: string[] = [];
    /**
     * 🔴 `SORT-PARITY-008` §5 —— 压缩索引（逻辑名 → 真实对象名 + 编码 + 体积 + 原文 SHA-256）。
     *    每个交付产物都经 `packArtifactForDelivery` 记账；索引本身**不压缩**、必须直接可读。
     */
    const compressionIndex: ArtifactCompressionIndexEntry[] = [];
    const emitArtifact = (spec: {
      readonly name: string;
      readonly role: "table" | "chart" | "log" | "artifact";
      readonly body: string | Uint8Array;
      readonly contentType: string;
      readonly label: string;
      readonly description: string;
      readonly compressible?: boolean;
    }): void => {
      s5ArtifactNames.push(spec.name);
      const { packed, indexEntry } = packArtifactForDelivery({
        name: spec.name,
        role: spec.role,
        body: spec.body,
        contentType: spec.contentType,
        ...(spec.compressible === undefined ? {} : { compressible: spec.compressible }),
      });
      compressionIndex.push(indexEntry);
      artifact({
        name: packed.name,
        role: packed.role,
        body: packed.body,
        contentType: packed.contentType,
        label: spec.label,
        description: spec.description,
      });
    };

    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §7 问题 5 / §8 —— **轻量 ST 来源覆盖与政策描述**。
     *
     * 🔴 这些数字是**来源覆盖与政策描述**，**不是**另一个优化目标。
     * 🔴 `strictPitEvidence` 是**严格 PIT 视角**的读数（照记），在轻量模式下**不**作前置条件。
     */
    const lightSourceReadout = knownStIndex === null
      ? null
      : knownStLightSourceReadoutOf(knownStIndex);
    const dataLimitedReasons: string[] = [];
    for (const group of groupSummaries) {
      for (const account of group.accounts) {
        if (account.totalReturnPct === null) {
          dataLimitedReasons.push(
            `${group.group} 账户 #${account.accountIndex}：无法计算总收益（权益曲线不足以计算）`,
          );
        }
      }
    }
    const dataLimited = dataLimitedReasons.length > 0;
    /** 终态（`RECOVERY-LIGHT-ST-007` §8）：`DATA_LIMITED` 只在**实际缺数据使指标无法计算**时。 */
    const terminalState: RecoveryStTerminalState = dataLimited
      ? "DATA_LIMITED"
      : "EXPLORATORY_COMPLETED";
    const stEligibilityPolicyBlock: RecoveryStEligibilityPolicyBlock = {
      policyId: stPolicy.id,
      policyVersion: stPolicy.version,
      parameterValue: stPolicy.parameterValue,
      exploratory: stPolicy.exploratory,
      strictDefault: stPolicy.strictDefault,
      knownStOnly: stPolicy.knownStOnly,
      /** 🔴 轻量模式**不是**严格 PIT；严格模式才是 PIT 口径（但本轮平台无 provider）。 */
      strictPit: stPolicy.strictDefault,
      label: stPolicy.label,
      unknownAllowedThisRoundNote: stPolicy.knownStOnly ? UNKNOWN_ALLOWED_THIS_ROUND_NOTE : null,
      source: lightSourceReadout,
      checks: {
        /** 标签查找次数（确认日 + 计划成交日 + 来源探针）。 */
        lookups: lightCounts.lookups,
        confirmKnownSt: lightCounts.confirmKnownSt,
        confirmExplicitNormal: lightCounts.confirmExplicitNormal,
        confirmUnknown: lightCounts.confirmUnknown,
        labelReasonCounts: { ...lightCounts.labelReasonCounts },
      },
      counts: {
        /** 「轻量 ST 检查读了多少记录」= 来源行数（一次性读取）。 */
        labelRowsRead: lightSourceReadout?.rowsRead ?? null,
        labelSecurities: lightSourceReadout?.securityCount ?? null,
        identityRowsRead: lightSourceReadout?.identifierRowCount ?? null,
        explicitNormalRowsInSource: lightSourceReadout?.explicitNormalRowCount ?? null,
        /** 「排除了多少候选」= 因已知 ST **未进入排序候选**的价格信号数（按组 / 合计）。 */
        knownStExcludedCandidates: lightCounts.knownStExcludedCandidates,
        knownStExcludedCandidatesByGroup: { ...lightCounts.knownStExcludedCandidatesByGroup },
        /** 进入排序候选的三分账（按组）。 */
        participatingKnownStByGroup: { ...lightCounts.participatingKnownStByGroup },
        participatingUnknownByGroup: { ...lightCounts.participatingUnknownByGroup },
        participatingExplicitNormalByGroup: { ...lightCounts.participatingExplicitNormalByGroup },
        /** 「排除了多少真实买单」与「UNKNOWN 参与与成交数」= **真实撮合链**的订单/成交计数。 */
        matchingOrders: { ...lightOrderStats },
      },
      /** 🔴 严格 PIT 视角的证据（照记，**不作**本轮前置条件；`providerVerifiable` 如实保留 false）。 */
      strictPitEvidence: {
        status: strictPitEvidence.status,
        blocked: strictPitEvidence.blocked,
        providerId: strictPitEvidence.providerId,
        providerVerifiable,
        candidateCount: strictPitEvidence.candidateCount,
        timepointChecks: strictPitEvidence.timepointChecks,
        verifiedNormalCount: strictPitEvidence.verifiedNormalCount,
        stRejectedCount: strictPitEvidence.stRejectedCount,
        unknownCount: strictPitEvidence.unknownCount,
      },
      dataLimited,
      dataLimitedReasons,
      terminalState,
      note:
        "🔴 **EXPLORATORY / KNOWN_ST_ONLY**：UNKNOWN 可参与是本轮**用户明确授权的政策变体**，"
        + "**不是**严格 PIT 研究，结论不得升级为 PIT / OOS / 模拟交易 / 实盘验证。"
        + "已知 ST ⇒ 排除并拒单；明确正常记录 ⇒ 参与；无记录 / 身份无法解析 / 证据不能判断 ⇒ "
        + "`UNKNOWN` 且**注明本轮允许**（**绝不**改写为 `NORMAL`）。"
        + "上述计数是来源覆盖与政策描述，**不是**另一个优化目标。",
    };

    const statusCoverageRows = statusCoverageRowsOf({
      plannings: planningByGroup,
      candidateGates,
      fallbackProviderId: statusProvider?.providerId ?? ABSENT_STATUS_PROVIDER_ID,
    });
    emitArtifact({
      name: "status-coverage.csv",
      role: "table",
      body: toCsv([...STATUS_COVERAGE_COLUMNS], statusCoverageRows),
      contentType: "text/csv",
      label: "状态覆盖证据（逐 symbol / 逐检查时点）",
      description:
        "目标 §4 要求的 `status-coverage.csv`：逐个计划候选的两个检查时点都给出判决与事实；"
        + "没有事实就留空记 UNKNOWN（**绝不伪造** NORMAL 区间）。"
        + "🔴 `RECOVERY-LIGHT-ST-007` 的**政策判决**另见 `st-light-eligibility-decisions.csv`"
        + "（本表保留**严格 PIT 视角**的读数，轻量模式下它如实显示「无可核验结论」）。",
    });

    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` 专属产物（**只在轻量模式产出**）：
     *   1. `st-light-eligibility-decisions.csv` —— 逐候选 × 两时点的**政策判决**与来源证据；
     *   2. `st-light-policy-summary.json` —— 来源覆盖 / 政策描述 / 已知 ST 排除 / UNKNOWN 参与与成交数。
     *
     * 🔴 严格模式（缺省）**不产出**这两份文件 ⇒ 既有严格路径的产物集逐字节不变。
     */
    if (stPolicy.knownStOnly) {
      emitArtifact({
        name: "st-light-eligibility-decisions.csv",
        role: "table",
        body: toCsv(
          [
            "group", "anchorEventId", "symbol", "confirmDate", "confirmRd", "plannedFillDate", "fillRd",
            "branch", "stPolicyId", "stPolicyVersion", "eligibilityPolicyVersion",
            "confirmEligibilityStatus", "confirmParticipatesInRanking", "confirmLabelKind",
            "confirmLabelReason", "confirmSecurityIdFromStSource", "confirmSource", "confirmStatusValue",
            "confirmEffectiveFrom", "confirmEffectiveTo", "confirmAvailability", "confirmConfidence",
            "confirmEvidenceFingerprint", "plannedFillEligibilityStatus", "plannedFillAllowed",
            "plannedFillLabelKind", "plannedFillLabelReason", "plannedFillAvailability",
            "plannedFillConfidence", "plannedFillEvidenceFingerprint", "note",
          ],
          lightEligibilityRows,
        ),
        contentType: "text/csv",
        label: "轻量 ST 资格政策 · 逐候选两时点判决与来源证据",
        description:
          "🔴 确认日收盘（15:00）**只决定当日资格**；计划成交日（09:15）一格仅供覆盖证据。"
          + "权威的成交前判决来自引擎在**真实成交时刻**的调用（见 `st-fill-audit.csv` 与拒单产物）。"
          + "`availability`/`confidence` **原样保留**来源取值（本轮**不**升级为 PIT 证据、**不**修改它们）。",
      });
      emitArtifact({
        name: "st-light-policy-summary.json",
        role: "artifact",
        body: JSON.stringify(
          {
            status: "EXPLORATORY_KNOWN_ST_ONLY",
            matrixEmitted: true,
            terminalState,
            generatedAt: new Date().toISOString(),
            experimentId: context.descriptor.id,
            codeDigest: context.codeDigest,
            dataset: {
              datasetVersionId: facts.datasetVersionId,
              datasetVersionLabel: facts.datasetVersionLabel,
              datasetCode: facts.datasetCode,
            },
            runMode: { ...runMode, seedIndexes: [...runMode.seedIndexes] },
            sampleAccounting: {
              candidateCount: scannedEventCount,
              eligibleEventCount,
              excludedCount: scannedEventCount - eligibleEventCount,
              exclusionReasonSum,
              neverInWatchPoolCount,
              note:
                "🔴 `neverInWatchPoolCount` **不计入**剔除原因：那批事件已通过事件扫描筛选（属 eligible 之内），"
                + "只是没有形成 rd1..40 观察池行；计入会让平台强制的样本账不平。",
            },
            stEligibilityPolicy: stEligibilityPolicyBlock,
            artifacts: [...s5ArtifactNames, "st-light-policy-summary.json"].map((name) => ({ name })),
          },
          null,
          2,
        ),
        contentType: "application/json",
        label: "轻量 ST 政策：来源覆盖与政策描述（不是优化目标）",
        description:
          "回答目标 §7 问题 5：读了多少来源记录、排除了多少候选与真实买单、UNKNOWN 参与与成交数。"
          + "🔴 这些数字是**来源覆盖与政策描述**，**不是**另一个优化目标。",
      });
    }

    // 逐日观察 / 修复证据（**按年分片**；含未触发观察日，供归因直接消费）
    const observationLedgerByGroupYear = new Map<string, Record<string, unknown>[]>();
    for (const [groupId, planning] of planningByGroup) {
      for (const evaluation of planning.evaluations.values()) {
        const year = Number(evaluation.eventDate.slice(0, 4));
        const key = `${groupId}\u0000${year}`;
        const list = observationLedgerByGroupYear.get(key) ?? [];
        for (const day of evaluation.days) {
          list.push({
            group: groupId,
            anchorEventId: evaluation.eventId,
            symbol: evaluation.symbol,
            eventDate: evaluation.eventDate,
            relativeDay: day.relativeDay,
            tradeDate: day.tradeDate ?? "",
            priceState: day.priceState,
            buyEligibility: day.buyEligibility,
            positionState: day.positionState,
            signalFormed: day.signalFormed,
            buyDisabled: day.buyDisabled,
            originalScore: day.originalScore ?? "",
            originalSupport: day.originalComponents?.supportLine ?? "",
            originalShrink: day.originalComponents?.shrink ?? "",
            originalLowStable: day.originalComponents?.lowStable ?? "",
            originalCloseImprove: day.originalComponents?.closeImprove ?? "",
            originalMissingReason: day.originalMissingReason ?? "",
            repairScore: day.repairScore ?? "",
            repairAtOrAboveLocalLow: day.repairComponents?.atOrAboveLocalLow ?? "",
            repairShrink: day.repairComponents?.shrink ?? "",
            repairLowStable: day.repairComponents?.lowStable ?? "",
            repairCloseImprove: day.repairComponents?.closeImprove ?? "",
            repairWindow: day.repairWindow.join("|"),
            repairWindowScore: day.repairWindowScore ?? "",
            localLowRd: day.localLowRd ?? "",
            localLow: day.localLow ?? "",
            repairEpisodeId: day.repairEpisodeId ?? "",
            localLowUpdated: day.localLowUpdated,
            episodeRestarted: day.episodeRestarted,
            episodeBroken: day.episodeBroken,
            runningMinLow: day.runningMinLow ?? "",
            factorAssessable: day.factorAssessable ?? "",
            statusFactFingerprint: day.statusFact?.evidenceFingerprint ?? "",
            rejectionReasons: day.rejectionReasons.join("|"),
          });
        }
        observationLedgerByGroupYear.set(key, list);
      }
    }
    for (const key of [...observationLedgerByGroupYear.keys()].sort()) {
      const [groupId, year] = key.split("\u0000") as [string, string];
      emitArtifact({
        name: `observation-repair-ledger-${groupId}-${year}.csv`,
        role: "table",
        body: toCsv(
          [
            "group", "anchorEventId", "symbol", "eventDate", "relativeDay", "tradeDate", "priceState",
            "buyEligibility", "positionState", "signalFormed", "buyDisabled", "originalScore",
            "originalSupport", "originalShrink", "originalLowStable", "originalCloseImprove",
            "originalMissingReason", "repairScore", "repairAtOrAboveLocalLow", "repairShrink",
            "repairLowStable", "repairCloseImprove", "repairWindow", "repairWindowScore", "localLowRd",
            "localLow", "repairEpisodeId", "localLowUpdated", "episodeRestarted", "episodeBroken",
            "runningMinLow", "factorAssessable", "statusFactFingerprint", "rejectionReasons",
          ],
          observationLedgerByGroupYear.get(key)!,
        ),
        contentType: "text/csv",
        label: `逐日观察 / 修复证据 · ${groupId} · ${year}`,
        description:
          "四项原始值（原分支 S / 修复分支 Q）**单列存档**，避免总分掩盖路径差异；"
          + "价格状态、买入资格、持仓状态三列**分开**（ST 不抹掉价格观察历史）；"
          + "含**未触发**观察日（目标 §6.6）。",
      });
    }

    /**
     * 候选与排名诊断（🔴 `SORT-PARITY-008` §4.2：**消费实际候选宇宙 + 实际计划选择**）。
     *
     * 旧实现（007 缺陷）：本表**另外**按 `preReturn10` 排一次，再用 `index + 1 <= DAILY_TOP_K`
     * 猜 `selectedByR` ⇒ 与真实计划脱节（真实计划当时取的是代码顺序前 3 名）。
     * 现在：行由 `candidateRankingDiagnosticsRowsOf` 从 `planning.rSelectionByDate`
     * （**与 R 计划同一个 `DailyFactorSelection`**）构造，`rPlanOrder` 就是
     * `plans[0].intentsByDate` 里该候选的真实 `rank`。
     */
    for (const [groupId, planning] of planningByGroup) {
      const bundle = artifactBundleByGroup.get(groupId) ?? null;
      const rFillByKey = new Map<string, Record<string, unknown>>();
      for (const row of bundle?.fillStAudit ?? []) {
        if (row.account !== "R") continue;
        rFillByKey.set(`${String(row.anchorEventId)}\u0000${String(row.confirmDate)}`, row);
      }
      const rSkipByKey = new Map<string, string>();
      for (const row of bundle?.failedAttempts ?? []) {
        if (row.account !== "R") continue;
        const key = `${String(row.anchorEventId)}\u0000${String(row.attemptedConfirmDate)}`;
        if (!rSkipByKey.has(key)) {
          rSkipByKey.set(key, `${String(row.skipCode)}：${String(row.reason)}`);
        }
      }
      const rows = candidateRankingDiagnosticsRowsOf({
        groupId,
        signalRows: rawSignalRowsByGroup.get(groupId) ?? planning.candidateRows,
        resolvedRows: planning.candidateRows,
        rSelectionByDate: planning.rSelectionByDate ?? new Map(),
        candidateGates,
        rFillByKey,
        rSkipByKey,
      });
      emitArtifact({
        name: `candidate-ranking-diagnostics-${groupId}.csv`,
        role: "table",
        body: toCsv([...CANDIDATE_RANKING_DIAGNOSTIC_COLUMNS], rows),
        contentType: "text/csv",
        label: `候选与排名诊断 · ${groupId}`,
        description:
          "🔴 `SORT-PARITY-008`：本表的候选名次与 `selectedByR` **来自 R 计划实际消费的**"
          + " `DailyFactorSelection`（`preReturn10` 降序 → symbol 升序 → eventId 升序），"
          + "不再是另排一次的猜测。列含义：`poolSizeThatDay` = 原始价格信号账当日行数；"
          + "`participantCountThatDay` = 当日真正参与排序的候选数（因子名次的真实分母）；"
          + "`rankByPreReturn10` 对**未参与**者留空（不与参与名次混同）；`rPlanOrder` = 真实计划顺序；"
          + "`rFillDate` / `rFillEvidenceRef` / `rNotFilledReason` = 真实成交或跳过的证据引用。"
          + "🔴 `ΣQ_j` **不参与排序**；出现足以主导 Top3 的并列时**停止因子效应解释**（P3）。",
      });
    }

    // 逐笔执行 ST 审计 + R 交易 / 权益 + Random 账户指标与分片交易 + 锚点链与失败尝试
    const randomTradeShardSize = 50;
    for (const [groupId, bundle] of artifactBundleByGroup) {
      emitArtifact({
        name: `st-fill-audit-${groupId}.csv`,
        role: "table",
        body: toCsv(
          [
            "group", "account", "securityId", "anchorEventId", "symbol", "confirmDate", "confirmRd",
            "fillDate", "branch", "confirmCloseOutcome", "confirmCloseReason", "confirmCloseEffectiveAt",
            "confirmCloseEvidence", "preFillOutcome", "preFillReason", "preFillEffectiveAt",
            "preFillEvidence", "buyAllowed", "providerId", "eligibilityGateId",
            "eligibilityPolicyVersion", "plannedCheckDate", "actualCheckDate", "eligibilityOutcome", "note",
          ],
          bundle.fillStAudit as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `逐笔执行 ST 审计 · ${groupId}`,
        description:
          "每一笔真实成交的成交前判决**来自引擎在成交时刻的真实调用记录**（`executionEligibilityAudit`），"
          + "不是事后按候选表推断。🔴 验收要求：`preFillOutcome ≠ NORMAL` 的成交数必须为 **0**；"
          + "不为 0 时本 Run 在撮合阶段就已抛错，不会产出这张表。",
      });
      emitArtifact({
        name: `execution-eligibility-rejections-${groupId}.csv`,
        role: "table",
        body: toCsv(
          [
            "group", "account", "orderId", "securityId", "anchorEventId", "symbol", "plannedDate",
            "plannedCheckDate", "actualCheckDate", "checkedAt", "status", "reason", "providerId",
            "gateId", "policyVersion", "evidenceFingerprint", "rejectedBy", "note",
          ],
          bundle.eligibilityRejections as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `执行资格拒单产物 · ${groupId}`,
        description:
          "FIX-005 / F1 要求的真实拒单产物：股票 / 锚点 / 账户 / **计划检查日 vs 实际检查日** / 状态 /"
          + " 原因 / provider / 来源指纹 / 政策版本。`rejectedBy=EXECUTION_ELIGIBILITY_GATE` 表示"
          + "成交前 ST（或 UNKNOWN）拒单——这类订单**不扣现金、不建仓、不计成交次数，也不递补第 4 名**。",
      });
      emitArtifact({
        name: `trades-R-${groupId}.csv`,
        role: "table",
        body: toCsv(
          [
            "group", "accountIndex", "kind", "seedIndex", "anchorEventId", "symbol", "entryOrdinal",
            "entryDate", "entryPrice", "exitDate", "exitPrice", "holdingPeriod", "returnPct", "netPnl",
            "fees", "openAtEnd", "exitReason", "account",
          ],
          bundle.rTrades as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `R 账户交易台账 · ${groupId}`,
        description: "R 臂（`preReturn10` HIGH、Top3）的完整交易台账；`openAtEnd=true` 为期末未平仓（不剔除）。",
      });
      emitArtifact({
        name: `equity-R-${groupId}.csv`,
        role: "table",
        body: toCsv(
          ["group", "account", "date", "cash", "marketValue", "equity", "openPositions"],
          bundle.rEquity as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `R 账户权益 · ${groupId}`,
        description: "R 账户逐交易日权益（唯一撮合引擎产出；含现金与持仓市值）。",
      });
      emitArtifact({
        name: `random-account-metrics-${groupId}.csv`,
        role: "table",
        body: toCsv(
          [
            "group", "accountIndex", "kind", "seedIndex", "decisionDayCount", "intentCount",
            "uniqueAnchorCount", "uniqueSecurityCount", "totalReturnPct", "annualizedReturnPct",
            "maxDrawdownPct", "tradeCount", "completedTradeCount", "openAtEndCount", "winRatePct",
            "profitFactor", "averageWinPct", "averageLossPct", "tail20Count", "tail20Rate", "tail50Count",
            "tail50Rate", "tail100Count", "tail100Rate", "averageHoldingPeriod", "finalCashSharePct",
            "skippedIntentCount", "fillCount", "rejectedOrderCount", "reentryEntryCount",
          ],
          bundle.accounts as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `账户指标（含 R 与全部 Random）· ${groupId}`,
        description:
          "账户级指标**唯一出口** `canonicalMetrics`；尾率 / 纳入笔数为实验侧从 `run.trades` 如实计数。"
          + "组内全部账户共享**同一个** `simulationConfig` 快照（运行期断言字节相同）。",
      });
      const shards = new Map<string, Record<string, unknown>[]>();
      for (const row of bundle.randomTrades) {
        const accountIndex = typeof row.accountIndex === "number" ? row.accountIndex : 0;
        const shardKey = String(Math.floor(Math.max(0, accountIndex - 1) / randomTradeShardSize))
          .padStart(2, "0");
        const list = shards.get(shardKey) ?? [];
        list.push(row);
        shards.set(shardKey, list);
      }
      for (const shardKey of [...shards.keys()].sort()) {
        emitArtifact({
          name: `trades-random-${groupId}-part-${shardKey}.csv`,
          role: "table",
          body: toCsv(
            [
              "accountIndex", "kind", "seedIndex", "anchorEventId", "symbol", "entryOrdinal", "entryDate",
              "entryPrice", "exitDate", "exitPrice", "holdingPeriod", "returnPct", "netPnl", "fees",
              "openAtEnd", "exitReason", "group", "account",
            ],
            shards.get(shardKey)!,
          ),
          contentType: "text/csv",
          label: `Random 账户交易台账 · ${groupId} · part-${shardKey}`,
          description: `随机账户交易台账分片（每片 ≤ ${randomTradeShardSize} 个账户，避免单产物超限）。`,
        });
      }
    }

    const anchorChains = [...artifactBundleByGroup.values()].flatMap((bundle) => [...bundle.anchorChains]);
    emitArtifact({
      name: "anchor-trade-chains.csv",
      role: "table",
      body: toCsv(["group", "account", "anchorEventId", "symbol", "chainNetPnl"], anchorChains),
      contentType: "text/csv",
      label: "锚点交易链（含整链净损益）",
      description:
        "每个（账户 × 锚点）一条链：`chainNetPnl` = 该链**全部真实交易**的净损益之和（扣全部实际成本）。"
        + "🔴 未成交的尝试不并入净损益（它们的代价是机会成本，单列在失败尝试表）。",
    });
    const failedAttempts = [...artifactBundleByGroup.values()].flatMap((b) => [...b.failedAttempts]);
    emitArtifact({
      name: "anchor-failed-attempts.csv",
      role: "table",
      body: toCsv(
        ["group", "account", "anchorEventId", "symbol", "attemptedConfirmDate", "skipCode", "reason", "note"],
        failedAttempts,
      ),
      contentType: "text/csv",
      label: "锚点失败尝试（未买 / 容量受限 / 持仓内阻断）",
      description:
        "来自 `run.skipped` 的**建仓**意图（绝不静默丢弃）；`skipCode` 区分容量、名额、现金与持仓状态。",
    });

    // 机会日归因（**含未触发观察日**；逐锚点 × 决策日）
    const opportunityRows: Record<string, unknown>[] = [];
    for (const [groupId, planning] of planningByGroup) {
      for (const row of pool.dailyRows) {
        const evaluation = planning.evaluations.get(row.anchorEventId);
        if (evaluation === undefined) continue;
        const day = evaluation.days.find((item) => item.relativeDay === row.eventAge);
        if (day === undefined) continue;
        const candidate = planning.candidateRows.find(
          (item) => item.anchorEventId === row.anchorEventId && item.confirmRd === row.eventAge,
        );
        const gate = candidate === undefined
          ? null
          : candidateGates.get(`${groupId}\u0000${row.anchorEventId}\u0000${candidate.confirmRd}`) ?? null;
        opportunityRows.push({
          group: groupId,
          date: row.date,
          anchorEventId: row.anchorEventId,
          symbol: row.symbol,
          eventAge: row.eventAge,
          preReturn10: row.preReturn10 ?? "",
          priceState: day.priceState,
          buyEligibility: day.buyEligibility,
          isTriggerDay: day.signalFormed,
          triggerBranch: candidate?.branch ?? "",
          tradedByR: gate?.buyAllowed === true,
          rejectionReasons: day.rejectionReasons.join("|"),
          note:
            "🔴 机会日归因**包含未触发观察日**（目标 §6.6）；只读**截至该日**的数据，"
            + "机会日之后的破位不回头解释当日状态。",
        });
      }
    }
    emitArtifact({
      name: "opportunity-day-attribution.csv",
      role: "table",
      body: toCsv(
        [
          "group", "date", "anchorEventId", "symbol", "eventAge", "preReturn10", "priceState",
          "buyEligibility", "isTriggerDay", "triggerBranch", "tradedByR", "rejectionReasons", "note",
        ],
        opportunityRows,
      ),
      contentType: "text/csv",
      label: "机会确认日逐层归因（含未触发观察日）",
      description:
        "ST → 价格状态 → 评分/突破 → 因子 → 排序 → 账户 → 成交 → 退出 的逐层证据链；"
        + "**含未触发观察日**，不只对已触发子集归因（目标 §6.6）。",
    });

    emitArtifact({
      name: "entry-path-window.csv",
      role: "table",
      body: toCsv(
        ["group", "horizonDays", "sampleCount", "worstPct", "meanPct", "note"],
        groupSummaries.flatMap((group) => group.adverseExcursion.map((row) => ({
          group: group.group,
          horizonDays: row.horizonDays,
          sampleCount: row.sampleCount,
          worstPct: row.worstPct,
          meanPct: row.meanPct,
          note:
            "入场后前 N 个交易日的**不利波动**（逐笔用该锚点真实 post 行的 low；缺 bar 不补价）。"
            + "这是 R 臂已平仓交易的聚合画像，不参与任何入选条件。",
        }))),
      ),
      contentType: "text/csv",
      label: "前 3 / 5 交易日不利波动画像（R 臂聚合）",
      description: "目标 §6.2 次要清单：前 3 / 5 个交易日的不利波动与收益；**不是**可实现收益。",
    });

    emitArtifact({
      name: "date-block-stats.csv",
      role: "table",
      body: toCsv(
        [
          "comparison", "classification", "variant", "pointEstimate", "low", "high", "clusterCount",
          "zeroDenominatorIterations", "ignoredObservationCount", "calendarLength", "blockLength", "seed",
        ],
        ([
          ["block20 主口径", primaryComparison.difference.blockPrimary],
          ["block40 敏感性", primaryComparison.difference.blockSensitivity],
          ["block20 配对均值差（锚点整链净损益）", primaryComparison.difference.meanPrimary],
        ] as const).map(([variant, interval]) => ({
          comparison: primaryComparison.key,
          classification: primaryComparison.classification,
          variant,
          pointEstimate: primaryComparison.pointEstimate,
          low: interval?.low ?? null,
          high: interval?.high ?? null,
          clusterCount: interval?.clusterCount ?? null,
          zeroDenominatorIterations: interval?.zeroDenominatorIterations ?? null,
          ignoredObservationCount: interval?.ignoredObservationCount ?? null,
          calendarLength: interval?.calendarLength ?? null,
          blockLength: interval?.blockLength ?? null,
          seed: interval?.seed ?? null,
        })),
      ),
      contentType: "text/csv",
      label: `配对日期块 bootstrap（block${BOOTSTRAP_BLOCK_PRIMARY} 主 / block${BOOTSTRAP_BLOCK_SENSITIVITY} 敏感性）`,
      description:
        "聚类键 = 共同锚点**首次进入观察池**的日期；双臂共享同一日历（含空日）与同一次抽样索引；"
        + `固定 ${BOOTSTRAP_ITERATIONS} 次、95% 双侧、种子 ${BOOTSTRAP_SEED_PRIMARY} / ${BOOTSTRAP_SEED_SENSITIVITY}。`,
    });

    emitArtifact({
      name: "stage-performance.json",
      role: "artifact",
      body: JSON.stringify(
        {
          status: stPolicy.knownStOnly ? "EXPLORATORY_KNOWN_ST_ONLY" : "ST_COVERAGE_VERIFIED",
          terminalState,
          stEligibilityPolicyId: stPolicy.id,
          stEligibilityPolicyVersion: stPolicy.version,
          stEligibilityPolicyExploratory: stPolicy.exploratory,
          runMode: { ...runMode, seedIndexes: [...runMode.seedIndexes] },
          elapsedMsTotal: runElapsedMs,
          scale: {
            scannedEventCount,
            watchPoolEventCount: pool.pooledEventIds.size,
            watchPoolDecisionDateCount: pool.decisionDates.length,
            executionRowCount: rows.length,
            executionTradingDayCount: tradingDates.length,
            accountCount: groupSummaries.reduce((sum, group) => sum + group.accounts.length, 0),
            fillRdViolationCount,
          },
          /**
           * 🔴 目标 §6 要求的**必要观测**（与「数据成本」分开记账；**不**据此自动阻断）。
           *
           * `rejectionByReason` 是引擎 `executionStats.byReason` 的**原样**聚合
           * （`SUSPENDED` = 缺执行 bar / 不可成交；`LIMIT_UP` / `LIMIT_DOWN` = 涨跌停；等）。
           */
          dataObservations: {
            unclosedPositionsR: executionObservationsTotal.unclosedPositionsR,
            unclosedPositionsRandom: executionObservationsTotal.unclosedPositionsRandom,
            rejectionByReason: { ...executionObservationsTotal.rejectionByReason },
            knownStRejectionAfterExistingFillInAnchor:
              executionObservationsTotal.knownStRejectionAfterExistingFillInAnchor,
            maxAverageHoldingPeriod: executionObservationsTotal.maxHoldingPeriod,
            requiredPostRelativeDayForFullRunner: REQUIRED_POST_RELATIVE_DAY,
            datasetPostMaxRelativeDay: POST_MAX_RELATIVE_DAY,
            tailTruncationRisk:
              POST_MAX_RELATIVE_DAY < REQUIRED_POST_RELATIVE_DAY
                ? `Dataset 物理上界 rd${POST_MAX_RELATIVE_DAY} < 组合执行理论需求 rd${REQUIRED_POST_RELATIVE_DAY}`
                  + " ⇒ 长仓可能在期末 MTM 收尾（**不**静默强平、**不**补最后价、**不**删样本）。"
                : "Dataset 上界覆盖理论执行需求。",
            note:
              "🔴 未平仓 / 缺执行 bar / 不可卖 / 尾部截断**本身不构成** `DATA_LIMITED`；"
              + "只有**实际缺数据使退出、估值或指标无法完整计算**时才标记 `DATA_LIMITED`"
              + "（见 `stEligibilityPolicy.dataLimited`）。是否重建 Dataset **不由执行方决定**。",
          },
          /**
           * 🔴 `RECOVERY-LIGHT-ST-007` TASK B —— **实测的阶段级耗时构成**（目标 §6 第一句要求）。
           *
           * 来源 = 仓库既有唯一剖析器 `server/observability/perfProfile.ts`。它**默认完全关闭**：
           * `PARAM_PROFILE≠1` 时每个埋点只有一次布尔短路 ⇒ 本节为空、总耗时字段照旧，
           * **不改变任何业务结果、也不改变其它产物的字节**。
           *
           * 打开方式（见 RESULT 里记录的实际命令）：
           * `PARAM_PROFILE=1 PARAM_PROFILE_OUT=<path> node … tests/tools/rollingPoolRecoveryStRun.mts …`
           *
           * ⚠️ `perfSnapshot()` 在 `14.artifacts` 帧**仍打开**时取样 ⇒ 该帧自身的 wall 只统计到此刻
           * （其它帧均为闭帧，数字完整）。`counters` 里另有 DB 往返全量计数（`db.round_trips`）。
           */
          phaseProfileEnabled: isPerfProfilingEnabled(),
          phaseProfile: perfSnapshot(),
          note:
            "**实测**阶段数字（本 Run 的规模、总耗时与——剖析开启时的——逐阶段墙钟 + DB 往返计数）。"
            + (isPerfProfilingEnabled()
              ? "本轮**已**开启 `PARAM_PROFILE=1` ⇒ `phaseProfile` 是实测分解，`phaseProfile.counters` "
                + "含 `db.round_trips` / `db.reads` / `db.writes`，`marks` 含 `db.total_ms` / `db.read_ms`。"
                + "阶段字段只用于**性能归因**，不参与任何研究口径。"
              : "本轮**没有**开启剖析（`PARAM_PROFILE≠1`）⇒ `phaseProfile` 为空："
                + "**不**声称阶段分解、**不**编造逐项毫秒数。")
            + "本次全部 DB 读取为一次性、跨全部账户共享（事件扫描 / prefix / post / 身份 / ST 标签索引）。",
        },
        null,
        2,
      ),
      contentType: "application/json",
      label: "阶段性能（粗粒度规模与总耗时）",
      description: "只报本轮实测的规模与总耗时；未做阶段 profile 就如实说明，不编造分解。",
    });

    emitArtifact({
      name: "cache-checkpoint-validation.json",
      role: "artifact",
      body: JSON.stringify(
        {
          contentAddressedCheckpointImplemented: false,
          inputReuse: {
            watchPoolReadOnce: true,
            stCoverageEvaluatedOncePerCandidate: true,
            authoritativeAssemblyPerGroup: groupSummaries.length,
            accountCountPerGroup: runMode.accountsPerGroup,
          },
          configSnapshotByteIdenticalAcrossAccounts: true,
          configSnapshotFingerprint: assembledConfigJson === null
            ? null
            : `${assembledConfigJson.length} 字符（逐账户逐字节比较，见 run.config 断言）`,
          note:
            "本轮**未实现**内容寻址 checkpoint / 断点续跑（S1 审计 G5：阶段级耗时分解缺失，先如实报告规模）。"
            + "同输入等价性的判据仍然是 **S4 的 digest 对照**（交易 / 权益 digest、`simulationConfig`、"
            + "订单与拒单、成交价/量/费），不是本文件里的任何自我声明。",
        },
        null,
        2,
      ),
      contentType: "application/json",
      label: "缓存 / 断点等价校验（如未实现则如实声明）",
      description: "目标 §8 要求的产物位；未实现就写未实现，不用「看起来像校验」的字段冒充。",
    });

    emitArtifact({
      name: "frozen-config.json",
      role: "artifact",
      body: JSON.stringify(
        {
          status: stPolicy.knownStOnly ? "EXPLORATORY_KNOWN_ST_ONLY" : strictPitEvidence.status,
          terminalState,
          computationVersion: COMPUTATION_VERSION,
          experimentId: context.descriptor.id,
          codeDigest: context.codeDigest,
          runMode: { ...runMode, seedIndexes: [...runMode.seedIndexes] },
          frozenConfig: frozenConfigLiteral(runMode, facts, stPolicy),
          dataset: {
            datasetVersionId: facts.datasetVersionId,
            datasetVersionLabel: facts.datasetVersionLabel,
            datasetCode: facts.datasetCode,
            datasetStatusCode: facts.status,
            declaredEventCount: facts.totalEvents ?? null,
            referenceDatasetVersionId: FROZEN_DATASET_VERSION_ID_REFERENCE,
          },
          mainWindow: { startDate: MAIN_WINDOW.startDate, endDate: MAIN_WINDOW.endDate },
          executionProjection: {
            securityCount: new Set(rows.map((row) => row.securityId)).size,
            rowCount: rows.length,
            tradingDayCount: tradingDates.length,
            firstTradingDate: tradingDates[0] ?? null,
            lastTradingDate: tradingDates[tradingDates.length - 1] ?? null,
          },
          groups: GROUPS.map((group) => ({
            id: group.id,
            breachPolicy: group.breachPolicy,
            entryFillMaxRd: group.entryFillMaxRd,
            confirmMinRd: group.confirmMinRd,
            confirmMaxRd: group.confirmMaxRd,
            label: group.label,
          })),
          stGate: {
            contractVersion: ST_GATE_CONTRACT_VERSION,
            executionEligibilityPolicyVersion: ST_EXECUTION_ELIGIBILITY_POLICY_VERSION,
            executionEligibilityGateId: ST_EXECUTION_ELIGIBILITY_GATE_ID,
            /** 严格模式的实际闸门身份；轻量模式用另一个身份（见下）。 */
            activeExecutionEligibilityGateId: stExecutionEligibilityGate.gateId,
            activeExecutionEligibilityPolicyVersion: stExecutionEligibilityGate.policyVersion,
            executionEligibilityUnknownPolicy: stPolicy.knownStOnly
              ? "ALLOW_WHEN_DECISION_ALLOWS"
              : "REJECT",
            providerId: statusProvider?.providerId ?? ABSENT_STATUS_PROVIDER_ID,
            providerVerifiable,
            status: strictPitEvidence.status,
            candidateChecks: strictPitEvidence.candidateCount,
            timepointChecks: strictPitEvidence.timepointChecks,
            verifiedNormal: strictPitEvidence.verifiedNormalCount,
            stRejected: strictPitEvidence.stRejectedCount,
            unknown: strictPitEvidence.unknownCount,
          },
          /**
           * 🔴 `RECOVERY-LIGHT-ST-007` §4：本轮 ST 资格政策身份 + 来源指纹 + 覆盖读数。
           */
          stEligibilityPolicy: stEligibilityPolicyBlock,
          /**
           * 🔴 FIX-005 续修（Finding A）：**辅助装配**的留档 —— 哪个入口、按哪版契约、
           * 装配出哪一份配置（配置指纹），以及「这次辅助调用没有撮合」这一事实。
           * 账户级撮合只发生在账户循环里，且全部带 `executionEligibilityGate`。
           */
          auxiliaryAssembly: {
            entryPoint: "assembleCompositeRunnerSimulationConfig",
            contractVersion: COMPOSITE_ASSEMBLY_CONFIG_CONTRACT_VERSION,
            matchingExecuted: false,
            perGroup: assemblyConfigRecords.map((record) => ({ ...record })),
          },
          commonAnchorUniverseSize: commonAnchorIds.size,
          scannedEventCount,
          eligibleEventCount,
          /** 🔴 已通过事件扫描但未进入 rd1..40 观察池（**不计入** `excludedByReason`；见样本账自检）。 */
          neverInWatchPoolCount,
          exclusionReasonSum,
          excludedByReason,
          artifacts: [...s5ArtifactNames, "frozen-config.json"].map((name) => ({ name })),
          contractGaps: [...RECOVERY_ST_CONTRACT_GAPS],
        },
        null,
        2,
      ),
      contentType: "application/json",
      label: "冻结配置与来源 manifest",
      description: "本 Run 的固定配置、Dataset 坐标、ST 闸门读数、共同锚点宇宙与全部产物清单。",
    });

    /**
     * 🔴 `SORT-PARITY-008` §5 —— **压缩索引**（最后产出，本身按原文交付）。
     *
     * 为什么必须有它：大件 CSV 现在以 `.csv.gz` 交付，逻辑名与对象名不再相同；
     * 外部引用与分析工具必须能据此解析**真实对象名**并知道该按哪种编码读回。
     *
     * 🔴 本表自身以 `identity` 交付（未压缩）⇒ **不列自身**；任何未在表中出现的名字
     *    都可以按「对象名 = 逻辑名」解析（即旧的普通 CSV 路径）。
     */
    emitArtifact({
      name: "artifact-compression-index.csv",
      role: "table",
      body: compressionIndexCsvOf(compressionIndex),
      contentType: "text/csv",
      label: "产物打包 / 压缩索引（逻辑名 → 实际对象名）",
      description:
        `🔴 \`SORT-PARITY-008\` §5：本 Run 的**每个**交付产物的逻辑名、实际对象名、角色、编码`
        + `（identity / gzip）、原文与交付体积、**原文 SHA-256**、行数。`
        + `达到 ${ARTIFACT_COMPRESSION_THRESHOLD_BYTES} B 的 CSV 以无损 gzip（level ${ARTIFACT_COMPRESSION_LEVEL}）`
        + "交付为 `.csv.gz`（`application/gzip`，真实二进制 body）；"
        + "解压后字节的 SHA-256 必须等于本表 `originalSha256`。"
        + "**完整行 / 列 / 顺序 / 数值 / 证据全部保留**（不采样、不删未触发观察日、不截断年份、不筛赢家）。"
        + "🔴 平台单件 64 MiB / 总量 256 MiB / 100 件的上限**未修改**。",
      compressible: false,
    });

    // ── 15) 组装 ─────────────────────────────────────────────────────────
    perfEnd();
    const compute: RecoveryStComputeOutput = {
      computationVersion: COMPUTATION_VERSION,
      runMode,
      /**
       * 🔴 `RECOVERY-LIGHT-ST-007`：矩阵路径**显式声明终态**（旧代码从不产出矩阵 ⇒ 从未写过这两个字段）。
       *
       * `matrixEmitted = true` 是「本次 Run 真的产出了收益矩阵」的唯一权威标志；
       * `status` 区分严格口径与**探索性**轻量口径（两者不是同一个身份）。
       */
      status: stPolicy.knownStOnly ? "EXPLORATORY_KNOWN_ST_ONLY" : "ST_COVERAGE_VERIFIED",
      matrixEmitted: true,
      frozenConfig: frozenConfigLiteral(runMode, facts, stPolicy),
      commonAnchorUniverseSize: commonAnchorIds.size,
      groups: groupSummaries,
      primaryComparison,
      /**
       * 🔴 严格模式的覆盖读数照旧；轻量模式下该字段为 `null`（**不是**伪造的 VERIFIED），
       *    完整证据放在 `stEligibilityPolicy.strictPitEvidence` 与两份轻量产物里。
       */
      stCoverage: stPolicy.strictDefault ? strictPitEvidence : null,
      stEligibilityPolicy: stEligibilityPolicyBlock,
      terminalState,
      contractGaps: [...RECOVERY_ST_CONTRACT_GAPS],
      sampleSummary: {
        candidateCount: scannedEventCount,
        eligibleCount: eligibleEventCount,
        excludedCount: Math.max(0, scannedEventCount - eligibleEventCount),
        excludedByReason,
        notes: [
          runMode.note,
          primaryComparison.gateReason,
          `FROZEN_DATASET_VERSION_ID_REFERENCE=${FROZEN_DATASET_VERSION_ID_REFERENCE}（只读核验；`
          + `运行期以 dataset.facts.datasetVersionId=${facts.datasetVersionId} 为准）。`,
          `ST 闸门契约 ${ST_GATE_CONTRACT_VERSION}；严格 PIT 视角状态 ${strictPitEvidence.status}；`
          + `候选检查点 ${strictPitEvidence.timepointChecks}（NORMAL ${strictPitEvidence.verifiedNormalCount} / `
          + `ST ${strictPitEvidence.stRejectedCount} / UNKNOWN ${strictPitEvidence.unknownCount}）。`,
          `样本账：candidate ${scannedEventCount} = eligible ${eligibleEventCount} + excluded ${scannedEventCount - eligibleEventCount}；`
          + `剔除原因合计 ${exclusionReasonSum}（逐项如实，与平台强制不变量一致）。`
          + `另有 ${neverInWatchPoolCount} 个事件**已通过事件扫描**但未形成 rd1..40 观察池行`
          + `（NEVER_IN_WATCH_POOL，属 eligible 之内）—— **不计入**剔除原因，否则账不平。`,
          `🔴 本轮 ST 资格政策 = ${stPolicy.id} / ${stPolicy.version}（探索性=${stPolicy.exploratory}，`
          + `严格缺省=${stPolicy.strictDefault}）：`
          + (stPolicy.knownStOnly
            ? `已知 ST 排除候选 ${lightCounts.knownStExcludedCandidates} 个价格信号、`
              + `拒单 ${lightOrderStats.knownStRejectedOrders} 笔订单；`
              + `UNKNOWN 参与候选（按组）${JSON.stringify(lightCounts.participatingUnknownByGroup)}、`
              + `UNKNOWN 成交 ${lightOrderStats.unknownFilledOrders} 笔。`
              + "**UNKNOWN 可参与是用户授权的探索性政策，不是严格 PIT 结论。**"
            : "严格政策：只认可核验 NORMAL。"),
          ...RECOVERY_ST_CONTRACT_GAPS.slice(0, 2),
        ],
      },
    };

    for (const planning of planningByGroup.values()) {
      if (planning.candidateRows.length === 0) {
        log(`⚠️ 组 ${planning.spec.id} 在窗口内没有任何价格信号（不是数据失败，也不是有效性通过）。`);
      }
    }
    return assembleRecoveryStResult(compute);
  },
};

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/**
 * 把「每日入选集合」翻译成账户意图（`rank` = 入选集合内的顺序 = **真实计划顺序**）。
 *
 * 🔴 `SORT-PARITY-008`：本函数是 R 与 Random **共用**的计划构造器；它对 `pick` 的返回值
 *    只做**保序**映射，**不再排序**。R 的 `pick` 必须传入
 *    `selectDailyTopByFactor(cells, DAILY_TOP_K).selected`（消费 `sortCandidates` 的返回值），
 *    Random 的 `pick` 继续直接消费**原顺序**的 `cells`。
 *
 * 导出是为了让接线回归测试走**真实**的计划构造路径，而不是在测试里另写一套排序/编号。
 */
export function intentsOf<
  T extends {
    readonly securityId: string;
    readonly anchorEventId: string;
    readonly preReturn10: number;
    readonly confirmRd: number;
    readonly fillRd: number;
  },
>(
  plannableByDate: ReadonlyMap<string, readonly T[]>,
  decisionDates: readonly string[],
  pick: (cells: readonly T[]) => readonly T[],
): ReadonlyMap<string, readonly AccountIntent[]> {
  const out = new Map<string, readonly AccountIntent[]>();
  for (const date of decisionDates) {
    const cells = plannableByDate.get(date) ?? [];
    if (cells.length === 0) continue;
    const picked = pick(cells);
    out.set(date, picked.map((row, index) => {
      const rank = index + 1;
      return {
        securityId: row.securityId,
        anchorEventId: row.anchorEventId,
        rank,
        percentile: cells.length === 0 ? 0 : 1 - (rank - 1) / cells.length,
        signalValue: row.preReturn10,
        confirmRd: row.confirmRd,
        fillRd: row.fillRd,
      };
    }));
  }
  return out;
}

/** 从 `run.trades` 里取该笔的成交价（**唯一来源**；取不到即 null，不补价）。 */
function entryPriceOf(
  run: TradeSimulationRun,
  fact: CompletedAnchorFact,
): number | null {
  for (const trade of run.trades) {
    if (trade.entryTime !== fact.entryDate) continue;
    if (symbolOfSecurityId(trade.securityId) !== fact.symbol) continue;
    if (typeof trade.entryPrice === "number" && trade.entryPrice > 0) return trade.entryPrice;
  }
  return null;
}

/** 用锚点真实 post 行算前 N 个交易日不利波动；缺 entryPrice / 缺 bar ⇒ null（不补价）。 */
function adverseExcursionForTrade(args: {
  readonly post: ReadonlyMap<number, PoolBar>;
  readonly anchorEventId: string;
  readonly entryDate: string;
  readonly entryPrice: number | null;
  readonly horizonDays: number;
}): number | null {
  if (args.entryPrice === null) return null;
  let fillRd: number | null = null;
  for (const [relativeDay, bar] of args.post) {
    if (bar.tradeDate === args.entryDate) { fillRd = relativeDay; break; }
  }
  if (fillRd === null) return null;
  return adverseExcursionOf({
    post: args.post,
    fillRd,
    entryPrice: args.entryPrice,
    horizonDays: args.horizonDays,
  });
}

export default rollingPoolRecoveryStExperiment;
