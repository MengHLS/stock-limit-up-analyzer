/**
 * `FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003` · 首板滚动池 × 连续观察窗口（N × 最晚成交 L） × 再入场政策 × 固定 Runner
 *
 * 规格：`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md`。
 * 规则：`docs/research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md`（本轮按目标 §3.2 覆盖其「固定两日 / T+10」）。
 * 前序：`FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001`（round-1）、`…-EARLY-ENTRY-RUNNER-002`（round-002）。
 *
 * ## 唯一研究问题
 *
 * 「把**连续观察窗口 N**（2 / 3 / 5 日）与**最晚实际成交期限 L**（T+10 / T+20）拉开后，
 *   相对同日同池**随机选择**的排序/选择增量是否仍成立？允许**平仓后由新买点再次入场**
 *   相对「一次入场」的净增量是什么？」
 *
 * 唯一主要比较 = **`D_R − B_R`**（同 T+20、同允许再入场下，5 日观察 vs 2 日观察的 ≥+20% 尾率差）。
 *
 * ## 五组矩阵（一个 Run 内全部执行；目标 §2）
 *
 * | 组 | N | L | 确认 rd | 再入场 |
 * |---|---:|---:|---|---|
 * | A | 2 | 10 | 3..9 | SIGNAL_REENTRY |
 * | B | 2 | 20 | 3..19 | SIGNAL_REENTRY |
 * | C | 3 | 20 | 4..19 | SIGNAL_REENTRY |
 * | D | 5 | 20 | 6..19 | SIGNAL_REENTRY |
 * | E | 5 | 20 | 6..19 | SINGLE_ENTRY |
 *
 * 每组 R + 200 个固定种子随机账户 = 201；合计 **1005** 个账户，**互相独立**（不承接任何持仓与现金）。
 * 五组共享**一次**端口读取的滚动池（事件扫描 / prefix / post 各一次），只有 N / L / 再入场政策不同。
 *
 * ## 与 8 条修正的对应
 *
 * 1. 🔴 **保留全部触发日**：每个决策日只要 `triggerOn(evaluation, row.eventAge) !== null` 就产出候选；
 *    「不是首个确认日」只计数（`LATER_TRIGGER_DAY_RETAINED`），**不** `continue`（round-002 丢掉了 21% 的后续确认日）。
 * 2. 🔴 **事件作用域证券身份** `sec_<uuid>::event:<symbol>@<date>`：
 *    `panelCodeOf` 会把它剥回 symbol ⇒ `maxConcurrentOpenPerCode` 仍按**同一真实股票**生效；
 *    而 `maxEntriesPerMember` 的键恰好是**锚点事件**（E 组语义）。行唯一性仍是 `(tradeDate, securityId)`。
 * 3. 🔴 **`reentryPolicy` 在 `SimulationConfig` 上**：每组先调用**一次** `runCompositeRunnerBacktest`
 *    拿权威装配结果，再对**全部 201 个账户（含 R）**用**同一个对象引用**调用 `runTradeSimulation`；
 *    组内 `run.config` 快照字节相同（运行期断言）。
 * 4. 🔴 **`amount` 声明并透传**（单位千元）⇒ 恢复引擎的流动性分层滑点。
 * 5. 🔴 **年度判据换靶**：`tail20RateDifference`（实际成交尾率差），账户年度权益收益另表报告；
 *    2026 只有主窗口内确有新入场才进闸门。
 * 6. 🔴 **`openAtEnd` 三分类**（实验侧**启发式**）：正常期末 MTM / 无执行 bar / 停牌无法卖出。
 * 7. 🔴 **Runner 可观测性 = UNOBSERVABLE**：只报「持有到 74 日」的笔数，**绝不**写「Runner 从未触发」。
 * 8. 🔴 **配对日期块 bootstrap**：全部比较臂共享同一组交易日块索引；另有「整条锚点链归属首笔入场日」敏感性。
 *
 * ## 处理顺序（分层不可混淆）
 *
 * ```
 * 当日池成员（round-1 锚点，rd1..40）
 *   → 数据资格（OHLCV 完整 / 非停牌 / 非零量）              ← 只用当日及之前
 *   → N 日观察分 + 六条件触发（N/L 参数化；保留**全部**确认日）
 *   → 因子可评估（preReturn10 缺失 ⇒ R 与 Random 共同不进入）
 *   → 原始买点候选池（同组两臂完全相同；不同组自然不同）
 *   → 排序（R = preReturn10 降序 + symbol/eventId 破平）或随机（200 固定种子，均匀无放回）
 *   → 账户约束（同股并发 / 锚点次数 / 空位 / 每日名额 / 现金 / 20% 权益预算） ← 账户层，不回流改候选池
 *   → 次一交易日开盘真实撮合（成交 rd ≤ L，越界即拒绝）
 * ```
 *
 * ## 纪律
 *
 * - 不碰 DB（只有 `context.dataset` + 服务侧唯一实现：身份解析、数据集封装、冻结策略读取）；
 * - 不新建第二套引擎 / 指标出口 / 策略语义；全部执行经 `@experiments/compositeRunnerBridge`；
 * - 指标唯一出口 `canonicalMetrics`；无 `Math.random` / 无 `Date.now`（确定性）。
 */

import type {
  ExperimentBarRow,
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
  type DailyPoolRow,
  type MaxAmp5Computer,
  type PoolBar,
  type PoolEvent,
} from "@experiments/shared/rollingPoolRightTail";
import {
  ENTRY_FILL_MAX_RD_MATRIX,
  OBSERVATION_DAYS_MATRIX,
  RUNNER_EXTEND_TO_HOLDING_DAYS,
  SHRINK_RATIO,
  SUPPORT_RATIO,
  evaluateEarlyEntries,
  triggerOn,
  type EarlyEntryEvaluation,
  type EntryTrigger,
} from "@experiments/shared/rollingPoolEarlyEntry";
import { pickUniformRandomSubset } from "@experiments/shared/singleFactor/rightTailMetrics";
import {
  DEFAULT_BOOTSTRAP_QUANTILES,
  movingBlockBootstrapPairedMeanDifference,
  movingBlockBootstrapPairedRatioDifference,
  type BootstrapQuantiles,
  type PairedBootstrapResult,
  type PairedClusterObservation,
} from "@experiments/shared/dateClusterBootstrap";
import {
  EARLY_ENTRY_POSITION_FRACTION,
  FROZEN_RUNNER_STRATEGY_REFERENCE,
  canonicalMetrics,
  computeCandidateEvaluationRunFingerprint,
  evaluateCandidateRun,
  eventScopedSecurityId,
  loadFrozenRunnerPolicyBundle,
  resolveRollingPoolSecurityIds,
  runCompositeRunnerBacktest,
  runTradeSimulation,
  runnerBridgeOf,
  sealRollingPoolExecutionDataset,
  type CandidateDayRecord,
  type CandidateEvaluationRun,
  type CanonicalMetricsDetail,
  type PositionIntent,
  type ResearchDataset,
  type RollingPoolExecutionRowInput,
  type SelectedCandidate,
  type SimulationConfig,
  type TradeSimulationRun,
} from "@experiments/compositeRunnerBridge";
import {
  ACCOUNTS_PER_GROUP,
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
  GROUPS,
  INITIAL_CAPITAL,
  LEFT_TAIL_THRESHOLD_PCT,
  MAIN_WINDOW as RESULT_MAIN_WINDOW,
  MAX_DAILY_BUYS,
  MAX_POSITIONS,
  OBSERVATION_WINDOW_CONTRACT_GAPS,
  POSITION_FRACTION,
  RANDOM_ACCOUNT_COUNT,
  RANDOM_SEED_INDEX_BASE,
  RUNNER_EXTEND_HOLDING_DAYS,
  TAIL_THRESHOLDS_PCT,
  TOTAL_ACCOUNT_COUNT,
  assembleObservationWindowResult,
  observationWindowCustomPayloadSchema,
  type AccountMetrics,
  type BootstrapInterval,
  type BoundaryDiagnostics,
  type ComparisonClass,
  type CoverageAccounting,
  type DistributionRow,
  type ExclusionLedgerRow,
  type FillAgeRow,
  type GroupComparison,
  type GroupComputeOutput,
  type GroupId,
  type GroupSpec,
  type ObservationWindowComputeOutput,
  type PairedDifference,
  type RankingResolutionRow,
  type ReentryAccounting,
  type ReentryFailedAttemptRow,
  type ReentryLedgerRow,
  type ReentryOrdinalSummaryRow,
  type TailRateBlock,
  type Verdict,
  type YearlyAccountReturnRow,
  type YearlyTailRow,
} from "./result";

// ---------------------------------------------------------------------------
// 冻结声明
// ---------------------------------------------------------------------------

/**
 * 事件日下界（**只为限制读取量，不改变研究范围**）。
 *
 * 主决策窗口起点 2024-01-02；N=2 的最早确认日在事件 rd3 ⇒ 最早需要的事件日是
 * 「2024-01-02 往前 ≥ 3 个交易日」≈ 2023-12-27。这里取 **2023-11-01** 作安全超集。
 */
const EVENT_DATE_LOWER_BOUND = "2023-11-01";

/** 本轮需要读的 post 相对日上界（= 780004 物理上界）。 */
const POST_MAX_RELATIVE_DAY = FROZEN_DATASET_POST_MAX_RELATIVE_DAY;
const POST_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: POST_MAX_RELATIVE_DAY },
  (_unused, index) => index + 1,
);

/** 执行投影的行起始日（= 主决策窗口起点；早于它的行不会被任何意图用到）。 */
const EXECUTION_ROW_START_DATE = MAIN_WINDOW.startDate;

/** 组装 sourceRun 用的 builder / rowSchema 版本（进指纹，改动即新口径）。 */
const SOURCE_RUN_BUILDER_VERSION = "rolling-pool-observation-window-003-1.0.0";

/**
 * `createdAt`：**冻结常量**，不是 `Date.now()`。
 *
 * 它只参与平台装配（策略文档 / 成本解析），不参与任何研究口径；
 * 固定它才能让同一份代码两次运行的产物**逐字节可比**。
 */
const FROZEN_CREATED_AT = "2026-10-10T00:00:00.000Z";

/** 五组里最大的确认日上界（= max(N+1..L−1)），用于跨组共享的逐日观察账。 */
const MAX_CONFIRM_RD_ACROSS_GROUPS = Math.max(...GROUPS.map((group) => group.confirmMaxRd));
/** 五组里最大的成交相对日上界（= max(L)），用于跨组共享的逐日观察账。 */
const MAX_FILL_RD_ACROSS_GROUPS = Math.max(...GROUPS.map((group) => group.entryFillMaxRd));

/** 交易账 CSV 的分片大小（随机账户数）——避免单产物超限。 */
const TRADE_CSV_ACCOUNT_SHARD = 50;

/** 事件作用域身份分隔符（与 `server/eventIdentity.ts` 同形）。 */
const EVENT_SCOPE_SEPARATOR = "::event:";

/**
 * 长任务进度输出（**只写 stderr，不改变研究语义**）。
 *
 * 置 `OBSERVATION_WINDOW_PROGRESS=1` 时把进度打到 stderr，由调用方落盘。
 */
function progress(message: string): void {
  if (process.env.OBSERVATION_WINDOW_PROGRESS === "1") {
    process.stderr.write(`[observation-window-progress] ${message}\n`);
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

/**
 * 归一化 bar。
 *
 * 🔴 修正 4：本实验在 `requiredColumns.observation` 里声明了 `amount`（单位**千元**）
 *    ⇒ 这里是**真实值**，执行投影据此恢复流动性分层滑点。若端口不给值则如实为 `null`
 *    （引擎回落为基础滑点），**不填 0、不虚构**。
 */
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

/** `"NOT_AVAILABLE"` ⇒ `null`（结果里禁止把「算不出来」伪装成 0）。 */
function toNullable(value: number | "NOT_AVAILABLE"): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function quantileOf(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return quantileOf(sorted, 0.5);
}

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

/** 交易所后缀（`002862.SZ` ⇒ `SZ`）。 */
function exchangeOf(code: string): string {
  const index = code.lastIndexOf(".");
  return index < 0 ? "UNKNOWN" : code.slice(index + 1);
}

/** 事件作用域身份 ⇒ 锚点事件 id（`sec_x::event:<symbol>@<date>` ⇒ `<symbol>@<date>`）。 */
export function anchorEventIdOf(securityId: string): string {
  const index = securityId.indexOf(EVENT_SCOPE_SEPARATOR);
  return index < 0 ? securityId : securityId.slice(index + EVENT_SCOPE_SEPARATOR.length);
}

/** 事件作用域身份 ⇒ 交易代码（与 `server/research/panelIdentity.ts#panelCodeOf` 同形，仅用于产物展示）。 */
export function symbolOfSecurityId(securityId: string): string {
  const eventId = anchorEventIdOf(securityId);
  const at = eventId.indexOf("@");
  return at < 0 ? eventId : eventId.slice(0, at);
}

/** 退出原因分桶（按关键词归一；未命中一律进 `EXIT_OTHER`）。 */
export function exitBucketOf(reason: string | null): string {
  if (reason === null || reason.length === 0) return "EXIT_UNLABELED";
  if (reason.includes("Runner Bridge")) return "EXIT_RUNNER_BRIDGE";
  if (reason.includes("止损")) return "EXIT_STOP_LOSS";
  if (reason.includes("止盈")) return "EXIT_TAKE_PROFIT";
  if (reason.includes("期末")) return "EXIT_OPEN_AT_END";
  if (reason.includes("候选")) return "EXIT_CANDIDATE";
  if (reason.includes("MA")) return "EXIT_MA_CROSS";
  if (reason.includes("时间") || reason.includes("持有满")) return "EXIT_TIME";
  return "EXIT_OTHER";
}

// ---------------------------------------------------------------------------
// 可被直接测试的纯函数（不读 DB、不依赖运行期状态）
// ---------------------------------------------------------------------------

/**
 * 🔴 账户层唯一的入场期限判据（导出以便被**直接**测试）。
 *
 * 收盘确认 → 次日开盘成交 ⇒ `fillRd = confirmRd + 1`。成交最晚 `L`，因此确认日必须
 * 同时落在 `[N+1, L−1]` 且 `confirmRd + 1 ≤ L`。
 * `false` ⇒ 该意图**一律不进入** `sourceRun`（不得靠引擎拒绝或顺延来兜底）。
 */
export function groupFillRdWithinCap(
  confirmRd: number,
  observationDays: number,
  entryFillMaxRd: number,
): boolean {
  return (
    Number.isInteger(confirmRd)
    && Number.isInteger(observationDays)
    && Number.isInteger(entryFillMaxRd)
    && confirmRd >= observationDays + 1
    && confirmRd <= entryFillMaxRd - 1
    && confirmRd + 1 <= entryFillMaxRd
  );
}

export interface DecisionDayCandidate {
  readonly trigger: EntryTrigger;
  /** 该确认日是该锚点的第几个确认日（1 = 首个）。 */
  readonly triggerOrdinal: number;
  /** 🔴 修正 1：非首个确认日**照样**产出候选，只做诊断计数。 */
  readonly isLaterTriggerDay: boolean;
}

/**
 * 某个决策日（锚点年龄 = `eventAge`）是否产出原始候选。
 *
 * 🔴 修正 1：只要 `triggerOn` 命中就产出 —— **不**只保留首个确认日。
 */
export function candidateOnDecisionDay(args: {
  readonly evaluation: EarlyEntryEvaluation;
  readonly eventAge: number;
  readonly observationDays: number;
  readonly entryFillMaxRd: number;
}): DecisionDayCandidate | null {
  const trigger = triggerOn(args.evaluation, args.eventAge);
  if (trigger === null) return null;
  if (trigger.fillRd !== trigger.confirmRd + 1) return null;
  if (!groupFillRdWithinCap(trigger.confirmRd, args.observationDays, args.entryFillMaxRd)) return null;
  const ordinal = args.evaluation.triggers.findIndex(
    (candidate) => candidate.confirmRd === trigger.confirmRd,
  ) + 1;
  return { trigger, triggerOrdinal: ordinal, isLaterTriggerDay: ordinal > 1 };
}

/** 池成员是否可用于**评级**（与规则库 `usableForScoring` 同口径；只用于分层归因，不参与触发判定）。 */
function usableForScoring(bar: PoolBar | undefined): bar is PoolBar {
  return (
    bar !== undefined
    && bar.barPresent
    && !bar.suspended
    && typeof bar.open === "number" && bar.open > 0
    && typeof bar.high === "number" && bar.high > 0
    && typeof bar.low === "number" && bar.low > 0
    && typeof bar.close === "number" && bar.close > 0
    && typeof bar.volume === "number" && bar.volume > 0
    && bar.high >= bar.low
  );
}

function barAt(event: PoolEvent, relativeDay: number): PoolBar | undefined {
  if (relativeDay === 0) return event.prefix.get(0);
  if (relativeDay < 0) return event.prefix.get(relativeDay);
  return event.post.get(relativeDay);
}

export interface DecisionLayerVerdict {
  readonly layer: string;
  readonly code: string;
  /** 该日是否是「支撑永久作废」的**首次**观察日（与重复拒绝日分开计数）。 */
  readonly isFirstSupportInvalidationDay: boolean;
}

/**
 * 逐层归因（观察 → 回撤 → 支撑 → N 日得分 → 突破 → 候选）。
 *
 * 🔴 这**不是**第二套规则引擎：它只对**已在池内**的「锚点 × 决策日」行做**成因归因**，
 *    调用方会对每一行做交叉校验（归因结果与权威 `triggerOn` 必须一致，不一致即计数并响亮报告）。
 */
export function classifyDecisionLayer(args: {
  readonly evaluation: EarlyEntryEvaluation;
  readonly event: PoolEvent;
  readonly eventAge: number;
  readonly observationDays: number;
  readonly confirmMinRd: number;
  readonly confirmMaxRd: number;
}): DecisionLayerVerdict {
  const plain = (layer: string, code: string): DecisionLayerVerdict => ({
    layer,
    code,
    isFirstSupportInvalidationDay: false,
  });
  if (args.eventAge < args.confirmMinRd) return plain("range", "BELOW_CONFIRM_MIN_RD");
  if (args.eventAge > args.confirmMaxRd) return plain("range", "ABOVE_CONFIRM_MAX_RD");
  if (args.evaluation.eventDayOpen === null) return plain("observation", "EVENT_DAY_BAR_UNUSABLE");

  const scoreAt = (relativeDay: number) =>
    args.evaluation.observationDays.find((day) => day.relativeDay === relativeDay) ?? null;

  const today = scoreAt(args.eventAge);
  if (today === null) return plain("observation", "DAY_SCORE_ROW_MISSING");
  if (today.score === null) return plain("observation", `DAY_${today.missingReason ?? "BAR_INVALID"}`);

  const breachRd = args.evaluation.supportBreachRd;
  if (breachRd !== null && breachRd <= args.eventAge) {
    return {
      layer: "support",
      code: breachRd === args.eventAge ? "SUPPORT_BREACHED_FIRST_INVALIDATION" : "SUPPORT_BREACHED_REPEAT",
      isFirstSupportInvalidationDay: breachRd === args.eventAge,
    };
  }
  if (args.evaluation.supportPathIncomplete) return plain("support", "SUPPORT_PATH_INCOMPLETE");

  const pullbackFirstRd = args.evaluation.pullbackFirstRd;
  if (pullbackFirstRd === null || pullbackFirstRd > args.eventAge - 1) {
    return plain("pullback", "NO_PULLBACK_YET");
  }

  for (let cursor = args.eventAge - args.observationDays; cursor <= args.eventAge - 1; cursor += 1) {
    const day = scoreAt(cursor);
    if (day === null || day.score === null) return plain("score", "N_DAY_SCORE_UNASSESSABLE");
    if (day.score < 3) return plain("score", "N_DAY_SCORE_INSUFFICIENT");
  }

  const current = barAt(args.event, args.eventAge);
  const previous1 = barAt(args.event, args.eventAge - 1);
  const previous2 = barAt(args.event, args.eventAge - 2);
  if (!usableForScoring(current) || !usableForScoring(previous1) || !usableForScoring(previous2)) {
    return plain("score", "N_DAY_SCORE_UNASSESSABLE");
  }
  // 🔴 突破参照恒为前**两日**高点（不随 N 改为前 N 日）——与规则库保持同一条口径。
  if (!((current.close as number) > Math.max(previous2.high as number, previous1.high as number))) {
    return plain("breakout", "NO_CLOSE_BREAKOUT");
  }
  if (!((current.volume as number) >= (previous1.volume as number))) {
    return plain("breakout", "VOLUME_NOT_RECOVERED");
  }
  return plain("candidate", "TRIGGER_DAY");
}

export interface OpenAtEndClass {
  readonly kind: "NOT_OPEN_AT_END" | "MTM_VALID" | "NO_EXECUTION_BAR" | "SUSPENDED_CANNOT_SELL";
  readonly note: string;
}

/**
 * 🔴 修正 6：`openAtEnd` 的**三分类**（+ 已平仓）。
 *
 * 引擎**不暴露**「行情用尽」与「停牌卖不掉」的区别 ⇒ 这是实验侧**启发式**：
 *   - `SUSPENDED_CANNOT_SELL`：该 run 对该证券存在**卖不出去**的反查证据（优先，最具体）；
 *   - `NO_EXECUTION_BAR`：期末未平仓且 `exitPrice === null`（连估值价都没有）；
 *   - `MTM_VALID`：期末未平仓但 `exitPrice !== null` ⇒ **正常**的期末 MTM（**不是**数据缺口）。
 *
 * ⚠️ 一笔交易可以同时满足 `MTM_VALID` 的语法条件与「卖不出去」证据；此时按上面的
 * **优先级**归类，重叠笔数单独披露（`mtmValidWithRejectedSellEvidenceCount`）。
 */
export function openAtEndClassOf(input: {
  readonly openAtEnd: boolean;
  readonly exitPrice: number | null;
  readonly hasExitKillEvidence: boolean;
}): OpenAtEndClass {
  if (!input.openAtEnd) {
    return { kind: "NOT_OPEN_AT_END", note: "已平仓：真实退出，不属覆盖问题。" };
  }
  if (input.hasExitKillEvidence) {
    return {
      kind: "SUSPENDED_CANNOT_SELL",
      note:
        "反查到卖不出去的证据（停牌/跌停/无流动性拒单，或 FROZEN_EXIT_DEFERRED / "
        + "NO_NEXT_TRADING_DAY / ZERO_VOLUME 顺延）。",
    };
  }
  if (input.exitPrice === null || !Number.isFinite(input.exitPrice)) {
    return { kind: "NO_EXECUTION_BAR", note: "期末未平仓且没有可用估值价 ⇒ 行情确实缺失。" };
  }
  return {
    kind: "MTM_VALID",
    note: "期末未平仓但按最后有效收盘 MTM 收尾 ⇒ 计作**正常期末 MTM**，不当作数据缺口。",
  };
}

/** 某证券在该 run 里是否存在「卖不出去」的反查证据（修正 6 的第二个判据）。 */
export function exitKillEvidenceIn(run: TradeSimulationRun, securityId: string): boolean {
  for (const order of run.audit.orders) {
    if (order.securityId !== securityId) continue;
    if (order.side !== "sell") continue;
    if (order.status !== "REJECTED") continue;
    if (
      order.rejectionReason === "SUSPENDED"
      || order.rejectionReason === "LIMIT_DOWN"
      || order.rejectionReason === "NO_LIQUIDITY"
    ) {
      return true;
    }
  }
  for (const entry of run.skipped) {
    if (entry.securityId !== securityId) continue;
    if (entry.side !== "sell") continue;
    if (
      entry.code === "FROZEN_EXIT_DEFERRED"
      || entry.code === "NO_NEXT_TRADING_DAY"
      || entry.code === "ZERO_VOLUME"
    ) {
      return true;
    }
  }
  return false;
}

/** 🔴 修正 7：Runner 触发的**可观测性**结论（恒为 UNOBSERVABLE）。 */
export const RUNNER_TRIGGER_OBSERVABILITY = "UNOBSERVABLE" as const;
export const RUNNER_OBSERVABILITY_NOTE =
  "`server/research/simulator/engine.ts` 的 `runnerBridgeExtendedToBySecurity` 是**函数局部 Map** ⇒ "
  + "「Runner 是否触发过」与「触发后是否提前退出」在 `TradeSimulationRun` 契约上**不可区分**。"
  + "因此本轮**只**报「持有期达到 Runner 续持上界（74 持有日）或退出原因命中 Runner Bridge 持有满」的笔数；"
  + "**不**据此推断 Runner 从未触发，**不**做退出消融，因而 Runner 的因果贡献**未被量化**。";

// ---------------------------------------------------------------------------
// 排序与意图
// ---------------------------------------------------------------------------

/** 排序（导出以便被**直接**测试：破平键必须**确定性**，不得由不透明 UUID 决定赢家）。 */
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

function toIntents(rows: readonly CandidateRow[], poolSize: number): AccountIntent[] {
  return rows.map((row, index) => {
    const rank = index + 1;
    return {
      securityId: row.securityId,
      anchorEventId: row.anchorEventId,
      rank,
      percentile: poolSize === 0 ? 0 : 1 - (rank - 1) / poolSize,
      signalValue: row.preReturn10,
      confirmRd: row.confirmRd,
      fillRd: row.fillRd,
    };
  });
}

// ---------------------------------------------------------------------------
// P3 排序分辨力（在**最终触发候选池**上）
// ---------------------------------------------------------------------------

const TIE_BREAK_KEY = "preReturn10 降序 → symbol 升序 → eventId 升序";

/**
 * P3 排序分辨力（在**最终触发候选池**上）。
 *
 * 🔴 单位：`maxValueSharePct` 是**百分数（0–100）**，不是分数（0–1）；空池 ⇒ `null`。
 * 🔴 定义：`maxValueSharePct` = 池内**同一个取值出现次数最多**的那一组（最大并列组）/ 候选行数 × 100，
 *    与 `research-experiments/shared/singleFactor/rankResolution.ts#modalShare`（注释「最大并列组 / 候选数」）
 *    同口径 —— P3 要回答的是「排序是否实质由破平键决定」，**不是**「最高分那一档是否唯一」。
 */
export function rankResolutionOf(
  group: GroupId,
  rows: readonly { readonly date: string; readonly preReturn10: number }[],
): RankingResolutionRow {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row.preReturn10);
    byDate.set(row.date, list);
  }
  const valueCounts = new Map<number, number>();
  let largestSameValueGroup = 0;
  for (const row of rows) {
    const count = (valueCounts.get(row.preReturn10) ?? 0) + 1;
    valueCounts.set(row.preReturn10, count);
    if (count > largestSameValueGroup) largestSameValueGroup = count;
  }

  const boundaryTieSizes: number[] = [];
  for (const list of byDate.values()) {
    const sorted = [...list].sort((left, right) => right - left);
    if (sorted.length <= DAILY_TOP_K) continue;
    const boundaryValue = sorted[DAILY_TOP_K - 1]!;
    const nextValue = sorted[DAILY_TOP_K]!;
    if (boundaryValue !== nextValue) continue;
    boundaryTieSizes.push(sorted.filter((value) => value === boundaryValue).length);
  }
  const sortedTieSizes = [...boundaryTieSizes].sort((left, right) => left - right);

  return {
    group,
    candidateDayCount: byDate.size,
    candidateRowCount: rows.length,
    distinctPreReturn10Count: valueCounts.size,
    maxValueSharePct: rows.length === 0 ? null : (largestSameValueGroup / rows.length) * 100,
    boundaryTieDayCount: boundaryTieSizes.length,
    boundaryTieSizeMedian: medianOf(sortedTieSizes),
    boundaryTieSizeMax: sortedTieSizes.length === 0 ? null : sortedTieSizes[sortedTieSizes.length - 1]!,
    tieBreakKey: TIE_BREAK_KEY,
    interpretation:
      "边界并列日 = 当日池大小 > TopK 且第 TopK 名与第 TopK+1 名因子值相同 ⇒ 排序结果实质由破平键决定。"
      + "并列日占比高时，「排序增量」的归因必须谨慎（目标 §5 P3）。",
  };
}

// ---------------------------------------------------------------------------
// 配对日期块 bootstrap（修正 8）
// ---------------------------------------------------------------------------

interface ClusterCell {
  hits: number;
  completed: number;
  sumReturn: number;
}

function addCell(
  cells: Map<string, ClusterCell>,
  date: string,
  input: { readonly hit: boolean; readonly returnPct: number },
): void {
  const cell = cells.get(date) ?? { hits: 0, completed: 0, sumReturn: 0 };
  cell.hits += input.hit ? 1 : 0;
  cell.completed += 1;
  cell.sumReturn += input.returnPct;
  cells.set(date, cell);
}

/** 簇单元 → 配对观测（**稳定升序**，保证确定性）。 */
export function clusterObservationsOf(
  cells: ReadonlyMap<string, ClusterCell>,
): PairedClusterObservation[] {
  return [...cells.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, cell]) => ({
      date,
      hits: cell.hits,
      completed: cell.completed,
      sumReturn: cell.sumReturn,
    }));
}

export interface PairedDifferenceInput {
  readonly calendar: readonly string[];
  readonly arms: Readonly<Record<string, readonly PairedClusterObservation[]>>;
  readonly compare: readonly [string, string];
  readonly iterations: number;
  readonly blockLength: number;
  readonly seed: number;
  readonly quantiles: BootstrapQuantiles;
}

/**
 * 比率差（分子分母同簇重采样）——直接调用 `shared/dateClusterBootstrap` 的**唯一**实现。
 *
 * 🔴 本函数**不实现任何统计**，只是把调用点收在一处，便于实验与测试用同一参数。
 */
export function pairedRatioDifference(input: PairedDifferenceInput): PairedBootstrapResult | null {
  return movingBlockBootstrapPairedRatioDifference({ ...input });
}

/** 配对均值差 —— 同一个唯一实现（`movingBlockBootstrapPairedMeanDifference`）。 */
export function pairedMeanDifference(input: PairedDifferenceInput): PairedBootstrapResult | null {
  return movingBlockBootstrapPairedMeanDifference({ ...input });
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
    quantiles: { low: result.quantiles.low, high: result.quantiles.high },
    zeroDenominatorIterations: result.zeroDenominatorIterations,
    calendarLength: result.calendarLength,
    ignoredObservationCount: result.ignoredObservationCount,
  };
}

/** 一组比较臂的完整配对读数（block20 主 / block40 敏感性 / 锚点链敏感性 / 配对均值）。 */
function buildPairedDifference(args: {
  readonly metric: string;
  readonly calendar: readonly string[];
  readonly fromArm: readonly PairedClusterObservation[];
  readonly toArm: readonly PairedClusterObservation[];
  readonly fromChainArm: readonly PairedClusterObservation[];
  readonly toChainArm: readonly PairedClusterObservation[];
  readonly pointEstimate: number | null;
}): PairedDifference {
  const base = {
    calendar: args.calendar,
    arms: { from: args.fromArm, to: args.toArm },
    compare: ["from", "to"] as const,
    iterations: BOOTSTRAP_ITERATIONS,
    quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
  };
  const chain = { ...base, arms: { from: args.fromChainArm, to: args.toChainArm } };
  return {
    metric: args.metric,
    pointEstimate: args.pointEstimate,
    blockPrimary: toBootstrapInterval(
      pairedRatioDifference({ ...base, blockLength: BOOTSTRAP_BLOCK_PRIMARY, seed: BOOTSTRAP_SEED_PRIMARY }),
    ),
    blockSensitivity: toBootstrapInterval(
      pairedRatioDifference({
        ...base,
        blockLength: BOOTSTRAP_BLOCK_SENSITIVITY,
        seed: BOOTSTRAP_SEED_SENSITIVITY,
      }),
    ),
    anchorChainPrimary: toBootstrapInterval(
      pairedRatioDifference({
        ...chain,
        blockLength: BOOTSTRAP_BLOCK_PRIMARY,
        seed: BOOTSTRAP_SEED_PRIMARY,
      }),
    ),
    meanPrimary: toBootstrapInterval(
      pairedMeanDifference({ ...base, blockLength: BOOTSTRAP_BLOCK_PRIMARY, seed: BOOTSTRAP_SEED_PRIMARY }),
    ),
  };
}

// ---------------------------------------------------------------------------
// 判定（修正 5：年度闸门换靶）
// ---------------------------------------------------------------------------

function tailRateDifferenceOfCounts(
  fromCompleted: number,
  fromHits: number,
  toCompleted: number,
  toHits: number,
): number | null {
  if (fromCompleted === 0 || toCompleted === 0) return null;
  return fromHits / fromCompleted - toHits / toCompleted;
}

/**
 * 单组的 R − Random 判定。
 *
 * 🔴 修正 5：年度同向判据 = `tail20RateDifference > 0`（**实际成交尾率差**），只看 2024 / 2025；
 *    账户年度权益收益**不参与**。
 */
export function judgeGroupVerdict(args: {
  readonly group: GroupId;
  readonly candidateDayCount: number;
  readonly rBlock: TailRateBlock;
  readonly randomBlock: TailRateBlock;
  readonly difference: PairedDifference;
  readonly yearly: readonly YearlyTailRow[];
  readonly rTotalReturnPct: number | null;
  readonly randomMedianTotalReturnPct: number | null;
  readonly rMaxDrawdownPct: number;
  readonly randomMedianMaxDrawdownPct: number | null;
}): Verdict {
  if (args.candidateDayCount === 0 || args.rBlock.tradeCount === 0) {
    return {
      verdict: "NO_TRIGGER_IN_WINDOW",
      reasons: [
        `组 ${args.group} 在本窗口内没有任何买点候选（决策日 ${args.candidateDayCount} 天）⇒ 尾率不可定义，`
        + "账户为空仓收益 0。这不是数据失败，也不是有效性通过（目标 §6.2）。",
      ],
    };
  }
  const reasons: string[] = [];
  const uniqueTail20Anchors = args.rBlock.uniqueTail20AnchorCount ?? 0;
  const gateRows = args.yearly.filter((row) => row.inSignalGate);
  const positiveGateYears = gateRows.filter(
    (row) => (row.tail20RateDifference ?? Number.NEGATIVE_INFINITY) > 0,
  );
  reasons.push(
    `R 已平仓 ${args.rBlock.completedTradeCount} 笔、≥+20% ${args.rBlock.hit20Count} 笔（唯一锚点 ${uniqueTail20Anchors} 个）；`
    + `pooled Random 已平仓 ${args.randomBlock.completedTradeCount} 笔、≥+20% ${args.randomBlock.hit20Count} 笔。`,
  );
  reasons.push(
    `≥+20% 比例差（R − Random）= ${(args.difference.pointEstimate ?? 0).toFixed(6)}，`
    + `block${BOOTSTRAP_BLOCK_PRIMARY} 95% 区间 `
    + `[${args.difference.blockPrimary?.low.toFixed(6) ?? "—"}, ${args.difference.blockPrimary?.high.toFixed(6) ?? "—"}]。`,
  );
  reasons.push(
    `年度同靶（实际成交尾率差）闸门年度 = ${gateRows.map((row) => row.year).join(" / ") || "无"}；`
    + `同向年度 = ${positiveGateYears.map((row) => row.year).join(" / ") || "无"}。`,
  );

  if (args.rBlock.completedTradeCount === 0) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: [...reasons, "R 没有任何**已平仓**交易 ⇒ 尾率不可定义。"],
    };
  }
  if (uniqueTail20Anchors < 50) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: [
        ...reasons,
        `R 的 ≥+20% **唯一锚点**只有 ${uniqueTail20Anchors} 个（事前判据要求 ≥ 50）⇒ 命中计数不足以支撑「有排序增量」。`,
      ],
    };
  }
  const low = args.difference.blockPrimary?.low ?? null;
  const high = args.difference.blockPrimary?.high ?? null;
  if (low === null || high === null) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: [...reasons, "日期簇不足 ⇒ 移动块 bootstrap 无法给出区间（不伪造区间）。"],
    };
  }
  const sameDirection = gateRows.length >= 2 && positiveGateYears.length === gateRows.length;
  if (high < 0) {
    return {
      verdict: "NO_SUPPORT",
      reasons: [...reasons, "区间整体在 0 以下 ⇒ 本组在可实现尾率上**劣于**同日同池随机选择。"],
    };
  }
  if (low <= 0 || !sameDirection) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: [
        ...reasons,
        low <= 0
          ? "区间跨 0 ⇒ 尾部增量证据不足（不等同于证明无效）。"
          : "年度同靶未同向 ⇒ 不满足事前判据。",
      ],
    };
  }
  const riskWorse =
    args.rTotalReturnPct !== null
    && args.randomMedianTotalReturnPct !== null
    && args.rTotalReturnPct < args.randomMedianTotalReturnPct
    && args.randomMedianMaxDrawdownPct !== null
    && args.rMaxDrawdownPct > args.randomMedianMaxDrawdownPct;
  if (riskWorse) {
    return {
      verdict: "RISK_TRADEOFF",
      reasons: [
        ...reasons,
        "尾部有证据，但账户复合总收益低于随机中位且回撤高于随机中位 ⇒ 只能作为**风险权衡**读数，不能称可交易。",
      ],
    };
  }
  return {
    verdict: "RIGHT_TAIL_EVIDENCE",
    reasons: [
      ...reasons,
      "满足事前右尾证据条件（区间下界 > 0 且年度同靶同向）。这仍**不是**可交易资格，也不是盈利承诺。",
    ],
  };
}

// ---------------------------------------------------------------------------
// 输入形状 / 运行期中间结构
// ---------------------------------------------------------------------------

interface EventSeed {
  readonly eventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly year: number;
  readonly market: string;
  readonly boardType: string;
}

/** 一条**原始买点候选**（当日池成员 × 六条件触发（N/L 参数化）× preReturn10 可评估）。 */
interface CandidateRow {
  readonly date: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  /** 🔴 修正 2：事件作用域身份 `sec_<uuid>::event:<symbol>@<date>`。 */
  readonly securityId: string;
  readonly eventAge: number;
  readonly confirmRd: number;
  readonly fillRd: number;
  readonly fillDate: string | null;
  readonly preReturn10: number;
  readonly triggerOrdinal: number;
  readonly isLaterTriggerDay: boolean;
}

interface AccountIntent {
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

interface CompletedEntryFact {
  readonly securityId: string;
  readonly anchorEventId: string;
  readonly entryTime: string;
  readonly exitTime: string | null;
  readonly returnPct: number;
  readonly netPnl: number | null;
  readonly entryOrdinal: number;
}

/** 每组「规划阶段」的产物（与账户执行无关）。 */
interface GroupPlanning {
  readonly spec: GroupSpec;
  readonly candidateRows: readonly CandidateRow[];
  readonly candidatesByDate: ReadonlyMap<string, readonly CandidateRow[]>;
  readonly sortedDecisionDates: readonly string[];
  readonly plans: readonly AccountPlan[];
  readonly rIntents: ReadonlyMap<string, readonly AccountIntent[]>;
  readonly diagnostics: Readonly<Record<string, number>>;
  readonly layerCounts: ReadonlyMap<string, number>;
  readonly poolSizeHistogram: { readonly le2: number; readonly eq3: number; readonly gt3: number };
  readonly poolSizeByDate: { readonly min: number; readonly median: number; readonly max: number };
  readonly triggerAnchorCount: number;
  readonly multiTriggerAnchorCount: number;
  readonly retriggerDayCount: number;
  readonly laterTriggerDayRetainedCount: number;
  readonly boundary: Omit<BoundaryDiagnostics, "group">;
  readonly rankingResolution: RankingResolutionRow;
}

/** 每组「账户执行阶段」的产物。 */
interface GroupExecution {
  readonly spec: GroupSpec;
  readonly configSnapshotJson: string;
  readonly accounts: readonly AccountMetrics[];
  readonly rCompletedReturns: readonly number[];
  readonly randomCompletedReturns: readonly number[];
  readonly rCompletedEntries: readonly CompletedEntryFact[];
  readonly coverage: CoverageAccounting;
  readonly ordinalRows: readonly ReentryOrdinalSummaryRow[];
  readonly ledgerRows: readonly ReentryLedgerRow[];
  readonly failedRows: readonly ReentryFailedAttemptRow[];
  readonly reentryAccounting: ReentryAccounting;
  readonly exclusionLedger: readonly ExclusionLedgerRow[];
  readonly fillAge: readonly FillAgeRow[];
  readonly rBlock: TailRateBlock;
  readonly randomPooled: TailRateBlock;
  readonly difference: PairedDifference;
  readonly yearlyTail: readonly YearlyTailRow[];
  readonly yearlyAccountReturns: readonly YearlyAccountReturnRow[];
  readonly randomDistribution: readonly DistributionRow[];
  readonly rArmCells: ReadonlyMap<string, ClusterCell>;
  readonly randomArmCells: ReadonlyMap<string, ClusterCell>;
  readonly rChainCells: ReadonlyMap<string, ClusterCell>;
  readonly randomChainCells: ReadonlyMap<string, ClusterCell>;
  readonly fillCount: number;
  readonly rejectedOrderCount: number;
  readonly skippedIntentCount: number;
  readonly verdict: Verdict;
  readonly rTradeRows: readonly Record<string, unknown>[];
  readonly randomTradeShards: readonly {
    readonly key: string;
    readonly rows: readonly Record<string, unknown>[];
  }[];
}

// ---------------------------------------------------------------------------
// 单账户推导（一次遍历得出指标 / 再入场账 / 覆盖分类 / 配对簇事实）
// ---------------------------------------------------------------------------

interface AccountDerivation {
  readonly metrics: AccountMetrics;
  readonly completedEntries: readonly CompletedEntryFact[];
  readonly ledgerRows: readonly ReentryLedgerRow[];
  readonly failedRows: readonly ReentryFailedAttemptRow[];
  readonly tradeRows: readonly Record<string, unknown>[];
  readonly rTradeRows: readonly Record<string, unknown>[];
  readonly reentryEntryCount: number;
  readonly coverage: {
    readonly tradesTotal: number;
    readonly tradesCompleted: number;
    readonly tradesOpenAtEnd: number;
    readonly mtmValidCount: number;
    readonly noExecutionBarCount: number;
    readonly suspendedCannotSellCount: number;
    readonly overlapCount: number;
    readonly heldToExtendedCapCount: number;
    readonly runnerBridgeExitReasonCount: number;
  };
  /** 每个「第 n 笔」的跨账户汇总单元（同一 ordinal 可横跨多个锚点）。 */
  readonly ordinalFacts: readonly {
    readonly ordinal: number;
    readonly tradeCount: number;
    readonly completedCount: number;
    readonly hit20Count: number;
    readonly returns: readonly number[];
    readonly netPnlSum: number;
    readonly feesSum: number;
  }[];
  /** 该账户每条（锚点）交易链的**首笔入场日**（修正 8 的链敏感性簇键）。 */
  readonly chainFirstEntryByAnchor: ReadonlyMap<string, string>;
  readonly chains: readonly {
    readonly firstEntryDate: string;
    readonly netPnl: number;
    readonly hasHit20: boolean;
    readonly allClosed: boolean;
  }[];
  readonly fillAgeFacts: readonly {
    readonly fillRd: number | null;
    readonly anchorEventId: string;
    readonly closed: boolean;
    readonly returnPct: number | null;
  }[];
  readonly fillAgeUnknownCount: number;
  readonly skipCodes: ReadonlyMap<string, number>;
  readonly rejectedReasons: ReadonlyMap<string, number>;
  readonly exitBuckets: ReadonlyMap<string, number>;
  readonly layerCounters: ReadonlyMap<string, number>;
  readonly yearlyEquityReturns: readonly { readonly year: number; readonly returnPct: number }[];
  readonly equityFinalCashSharePct: number | null;
  readonly equityMaxDrawdownPct: number;
  readonly equityWinRatePct: number | null;
  readonly equityAverageHoldingPeriod: number | null;
}

/** 年度权益收益（基数 = 上一年末权益；第一个年度用初始本金）。 */
function yearlyEquityReturns(
  curve: readonly { readonly date: string; readonly equity: number }[],
  initialCapital: number,
): { readonly year: number; readonly returnPct: number }[] {
  const endEquityByYear = new Map<number, number>();
  for (const point of curve) {
    endEquityByYear.set(Number(point.date.slice(0, 4)), point.equity);
  }
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

function deriveAccount(args: {
  readonly groupId: GroupId;
  readonly plan: AccountPlan;
  readonly run: TradeSimulationRun;
  readonly tradingDates: readonly string[];
  readonly tradingDayIndex: ReadonlyMap<string, number>;
}): AccountDerivation {
  const { plan, run } = args;
  const accountId = `${args.groupId}#${plan.accountIndex}`;
  const metrics: CanonicalMetricsDetail = canonicalMetrics({
    equityCurve: run.equityCurve,
    tradeLedger: run.trades,
    initialCapital: run.initialCapital,
  });

  const ledgerRows: ReentryLedgerRow[] = [];
  const failedRows: ReentryFailedAttemptRow[] = [];
  const tradeRows: Record<string, unknown>[] = [];
  const rTradeRows: Record<string, unknown>[] = [];
  const completedReturns: number[] = [];
  const completedEntries: CompletedEntryFact[] = [];
  const ordinalByAnchor = new Map<string, number>();
  const lastExitByAnchor = new Map<string, string>();
  const tradesByAnchor = new Map<string, (typeof run.trades)[number][]>();
  const ordinalCells = new Map<
    number,
    {
      tradeCount: number;
      completedCount: number;
      hit20Count: number;
      returns: number[];
      netPnlSum: number;
      feesSum: number;
    }
  >();
  const chains: { firstEntryDate: string; netPnl: number; hasHit20: boolean; allClosed: boolean }[] = [];
  const fillAgeFacts: { fillRd: number | null; anchorEventId: string; closed: boolean; returnPct: number | null }[] = [];
  const skipCodes = new Map<string, number>();
  const rejectedReasons = new Map<string, number>();
  const exitBuckets = new Map<string, number>();
  const chainFirstEntryByAnchor = new Map<string, string>();
  const layerCounters = new Map<string, number>();
  const bumpLayer = (layer: string, code: string, count = 1): void => {
    if (count <= 0) return;
    layerCounters.set(`${layer}\u0000${code}`, (layerCounters.get(`${layer}\u0000${code}`) ?? 0) + count);
  };
  const holdingPeriods: number[] = [];
  const winReturns: number[] = [];
  let heldToExtendedCapCount = 0;
  let runnerBridgeExitReasonCount = 0;
  let tradesCompleted = 0;
  let tradesOpenAtEnd = 0;
  let mtmValidCount = 0;
  let noExecutionBarCount = 0;
  let suspendedCannotSellCount = 0;
  let overlapCount = 0;
  let fillAgeUnknownCount = 0;
  let reentryEntryCount = 0;

  const equityByDate = new Map(run.equityCurve.map((point) => [point.date, point.equity]));
  const orderedTrades = [...run.trades].sort(
    (left, right) =>
      left.entryTime.localeCompare(right.entryTime) || left.securityId.localeCompare(right.securityId),
  );

  for (const trade of orderedTrades) {
    const anchorEventId = anchorEventIdOf(trade.securityId);
    const ordinal = (ordinalByAnchor.get(anchorEventId) ?? 0) + 1;
    ordinalByAnchor.set(anchorEventId, ordinal);
    if (ordinal >= 2) reentryEntryCount += 1;
    const list = tradesByAnchor.get(anchorEventId) ?? [];
    list.push(trade);
    tradesByAnchor.set(anchorEventId, list);

    const previousExit = lastExitByAnchor.get(anchorEventId) ?? null;
    const entryIndex = args.tradingDayIndex.get(trade.entryTime) ?? null;
    const decisionDate =
      entryIndex === null || entryIndex === 0 ? null : args.tradingDates[entryIndex - 1] ?? null;
    const intent =
      decisionDate === null
        ? undefined
        : (plan.intentsByDate.get(decisionDate) ?? []).find(
          (candidate) => candidate.securityId === trade.securityId,
        );
    const entryEquity = decisionDate === null ? null : equityByDate.get(decisionDate) ?? null;

    ledgerRows.push({
      accountId,
      group: args.groupId,
      anchorEventId,
      symbol: symbolOfSecurityId(trade.securityId),
      entryOrdinal: ordinal,
      previousActualExitDate: ordinal === 1 ? null : previousExit,
      newConfirmDate: decisionDate,
      newFillDate: trade.entryTime,
      entryEquity,
      targetBudget: entryEquity === null ? null : entryEquity * POSITION_FRACTION,
      exitReason: trade.reason ?? null,
      netPnl: trade.netPnl,
    });
    if (!trade.openAtEnd && trade.exitTime !== null) lastExitByAnchor.set(anchorEventId, trade.exitTime);

    const fillRd = intent?.fillRd ?? null;
    if (fillRd === null) fillAgeUnknownCount += 1;
    fillAgeFacts.push({
      fillRd,
      anchorEventId,
      closed: !trade.openAtEnd && trade.returnPct !== null,
      returnPct: trade.openAtEnd ? null : trade.returnPct,
    });

    // 覆盖三分类（修正 6）
    const killEvidence = exitKillEvidenceIn(run, trade.securityId);
    const classification = openAtEndClassOf({
      openAtEnd: trade.openAtEnd,
      exitPrice: trade.exitPrice,
      hasExitKillEvidence: killEvidence,
    });
    if (classification.kind === "MTM_VALID") mtmValidCount += 1;
    if (classification.kind === "NO_EXECUTION_BAR") noExecutionBarCount += 1;
    if (classification.kind === "SUSPENDED_CANNOT_SELL") suspendedCannotSellCount += 1;
    if (trade.openAtEnd && trade.exitPrice !== null && killEvidence) overlapCount += 1;
    if (trade.openAtEnd) tradesOpenAtEnd += 1;
    else tradesCompleted += 1;

    // Runner 可观测性（修正 7）：只按持有期 / 退出原因计数
    const runnerBridgeReason =
      typeof trade.reason === "string" && trade.reason.includes("Runner Bridge持有满");
    if (runnerBridgeReason) runnerBridgeExitReasonCount += 1;
    if (
      runnerBridgeReason
      || (typeof trade.holdingPeriod === "number" && trade.holdingPeriod >= RUNNER_EXTEND_HOLDING_DAYS)
    ) {
      heldToExtendedCapCount += 1;
    }
    if (typeof trade.holdingPeriod === "number" && Number.isFinite(trade.holdingPeriod)) {
      holdingPeriods.push(trade.holdingPeriod);
    }
    const exitBucket = exitBucketOf(trade.reason ?? null);
    exitBuckets.set(exitBucket, (exitBuckets.get(exitBucket) ?? 0) + 1);

    const tradeCell = ordinalCells.get(ordinal) ?? {
      tradeCount: 0,
      completedCount: 0,
      hit20Count: 0,
      returns: [] as number[],
      netPnlSum: 0,
      feesSum: 0,
    };
    tradeCell.tradeCount += 1;
    tradeCell.feesSum += trade.fees;
    const closed = !trade.openAtEnd && typeof trade.returnPct === "number" && Number.isFinite(trade.returnPct);
    if (closed) {
      tradeCell.completedCount += 1;
      tradeCell.returns.push(trade.returnPct as number);
      tradeCell.netPnlSum += trade.netPnl ?? 0;
      if ((trade.returnPct as number) >= TAIL_THRESHOLDS_PCT[0]) tradeCell.hit20Count += 1;
      completedReturns.push(trade.returnPct as number);
      winReturns.push(trade.returnPct as number);
      completedEntries.push({
        securityId: trade.securityId,
        anchorEventId,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime,
        returnPct: trade.returnPct as number,
        netPnl: trade.netPnl,
        entryOrdinal: ordinal,
      });
    }
    ordinalCells.set(ordinal, tradeCell);

    const row: Record<string, unknown> = {
      securityId: trade.securityId,
      anchorEventId,
      symbol: symbolOfSecurityId(trade.securityId),
      entryTime: trade.entryTime,
      entryPrice: trade.entryPrice,
      exitTime: trade.exitTime,
      exitPrice: trade.exitPrice,
      quantity: trade.quantity,
      returnPct: trade.returnPct,
      netPnl: trade.netPnl,
      fees: trade.fees,
      holdingPeriod: trade.holdingPeriod,
      openAtEnd: trade.openAtEnd,
      reason: trade.reason ?? null,
    };
    if (plan.kind === "R") rTradeRows.push(row);
    else tradeRows.push({ accountIndex: plan.accountIndex, seedIndex: plan.seedIndex, ...row });
  }

  for (const [anchorEventId, trades] of tradesByAnchor) {
    const ordered = [...trades].sort((left, right) => left.entryTime.localeCompare(right.entryTime));
    let netPnl = 0;
    let hasHit20 = false;
    let allClosed = true;
    for (const trade of ordered) {
      if (trade.openAtEnd || trade.returnPct === null) {
        allClosed = false;
        continue;
      }
      netPnl += trade.netPnl ?? 0;
      if (trade.returnPct >= TAIL_THRESHOLDS_PCT[0]) hasHit20 = true;
    }
    chains.push({ firstEntryDate: ordered[0]!.entryTime, netPnl, hasHit20, allClosed });
    chainFirstEntryByAnchor.set(anchorEventId, ordered[0]!.entryTime);
  }

  for (const entry of run.skipped) {
    if (entry.side !== "buy") continue;
    skipCodes.set(entry.code, (skipCodes.get(entry.code) ?? 0) + 1);
    const entryIndex = args.tradingDayIndex.get(entry.date) ?? null;
    const plannedFillDate = entryIndex === null ? null : args.tradingDates[entryIndex + 1] ?? null;
    const anchorEventId = anchorEventIdOf(entry.securityId);
    failedRows.push({
      accountId,
      group: args.groupId,
      anchorEventId,
      symbol: symbolOfSecurityId(entry.securityId),
      attemptedConfirmDate: entry.date,
      plannedFillDate,
      skipCode: entry.code,
      reason: entry.reason,
      priorEntryOrdinalActual: ordinalByAnchor.get(anchorEventId) ?? 0,
      priorActualExitDate: lastExitByAnchor.get(anchorEventId) ?? null,
    });
  }
  for (const order of run.audit.orders) {
    if (order.status !== "REJECTED") continue;
    const reason = order.rejectionReason ?? "UNKNOWN";
    rejectedReasons.set(reason, (rejectedReasons.get(reason) ?? 0) + 1);
  }
  let intentCount = 0;
  const intentAnchors = new Set<string>();
  const intentSecurities = new Set<string>();
  for (const intents of plan.intentsByDate.values()) {
    intentCount += intents.length;
    for (const intent of intents) {
      intentAnchors.add(intent.anchorEventId);
      intentSecurities.add(intent.securityId);
    }
  }
  const lastPoint = run.equityCurve[run.equityCurve.length - 1];
  const finalCashSharePct =
    lastPoint === undefined || lastPoint.equity <= 0 ? null : (lastPoint.cash / lastPoint.equity) * 100;

  bumpLayer("order", "INTENTS_TOTAL", intentCount);
  bumpLayer("order", "ORDERS_TOTAL", run.executionStats.totalOrders);
  bumpLayer("order", "SKIPPED_TOTAL", run.skipped.length);
  bumpLayer("fill", "FILLS_TOTAL", run.executionStats.totalFills);
  bumpLayer("fill", "REJECTED_TOTAL", run.executionStats.rejectedOrders);

  const completedCount = completedReturns.length;
  const metricsOut: AccountMetrics = {
    group: args.groupId,
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
    tail20Rate:
      completedCount === 0
        ? null
        : completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[0]).length / completedCount,
    tail50Count: completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[1]).length,
    tail50Rate:
      completedCount === 0
        ? null
        : completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[1]).length / completedCount,
    tail100Count: completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[2]).length,
    tail100Rate:
      completedCount === 0
        ? null
        : completedReturns.filter((value) => value >= TAIL_THRESHOLDS_PCT[2]).length / completedCount,
    averageHoldingPeriod: meanOf(holdingPeriods),
    finalCashSharePct,
    skippedIntentCount: run.skipped.length,
    fillCount: run.executionStats.totalFills,
    rejectedOrderCount: run.executionStats.rejectedOrders,
    reentryEntryCount,
    heldToExtendedCapCount,
  };

  return {
    metrics: metricsOut,
    completedEntries,
    ledgerRows,
    failedRows,
    tradeRows,
    rTradeRows,
    reentryEntryCount,
    coverage: {
      tradesTotal: run.trades.length,
      tradesCompleted,
      tradesOpenAtEnd,
      mtmValidCount,
      noExecutionBarCount,
      suspendedCannotSellCount,
      overlapCount,
      heldToExtendedCapCount,
      runnerBridgeExitReasonCount,
    },
    ordinalFacts: [...ordinalCells.entries()]
      .sort(([left], [right]) => left - right)
      .map(([ordinal, cell]) => ({ ordinal, ...cell })),
    chainFirstEntryByAnchor,
    chains,
    fillAgeFacts,
    fillAgeUnknownCount,
    skipCodes,
    rejectedReasons,
    exitBuckets,
    layerCounters,
    yearlyEquityReturns: yearlyEquityReturns(run.equityCurve, run.initialCapital),
    equityFinalCashSharePct: finalCashSharePct,
    equityMaxDrawdownPct: metrics.maxDrawdownPct,
    equityWinRatePct: toNullable(metrics.winRatePct),
    equityAverageHoldingPeriod: meanOf(holdingPeriods),
  };
}

// ---------------------------------------------------------------------------
// 尾率块
// ---------------------------------------------------------------------------

function tailRateBlockOf(args: {
  readonly label: string;
  readonly completedReturns: readonly number[];
  readonly tradeCount: number;
  readonly openAtEndCount: number;
  readonly fillCount: number;
  readonly skippedIntentCount: number;
  readonly rejectedOrderCount: number;
  readonly winRatePct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly finalCashSharePct: number | null;
  readonly averageHoldingPeriod: number | null;
  readonly uniqueTail20AnchorCount: number | null;
}): TailRateBlock {
  const completed = args.completedReturns;
  const hit = (threshold: number): number => completed.filter((value) => value >= threshold).length;
  return {
    label: args.label,
    tradeCount: args.tradeCount,
    completedTradeCount: completed.length,
    openAtEndCount: args.openAtEndCount,
    hit20Count: hit(TAIL_THRESHOLDS_PCT[0]),
    tail20Rate: completed.length === 0 ? null : hit(TAIL_THRESHOLDS_PCT[0]) / completed.length,
    hit50Count: hit(TAIL_THRESHOLDS_PCT[1]),
    tail50Rate: completed.length === 0 ? null : hit(TAIL_THRESHOLDS_PCT[1]) / completed.length,
    hit100Count: hit(TAIL_THRESHOLDS_PCT[2]),
    tail100Rate: completed.length === 0 ? null : hit(TAIL_THRESHOLDS_PCT[2]) / completed.length,
    loss20Count: completed.filter((value) => value <= LEFT_TAIL_THRESHOLD_PCT).length,
    loss20Rate:
      completed.length === 0
        ? null
        : completed.filter((value) => value <= LEFT_TAIL_THRESHOLD_PCT).length / completed.length,
    meanReturnPct: meanOf(completed),
    medianReturnPct: medianOf(completed),
    winRatePct: args.winRatePct,
    maxDrawdownPct: args.maxDrawdownPct,
    finalCashSharePct: args.finalCashSharePct,
    averageHoldingPeriod: args.averageHoldingPeriod,
    fillCount: args.fillCount,
    skippedIntentCount: args.skippedIntentCount,
    rejectedOrderCount: args.rejectedOrderCount,
    uniqueTail20AnchorCount: args.uniqueTail20AnchorCount,
  };
}

// ---------------------------------------------------------------------------
// 全研究收口判定
// ---------------------------------------------------------------------------

/** 全研究收口判定（唯一主要比较 + 风险代价）。 */
export function judgeStudyVerdict(args: {
  readonly primary: GroupComparison;
  readonly groups: readonly {
    readonly group: GroupId;
    readonly tail20Rate: number | null;
    readonly totalReturnPct: number | null;
    readonly meanReturnPct: number | null;
    readonly maxDrawdownPct: number;
  }[];
}): Verdict {
  const via = args.groups.find((row) => row.group === args.primary.fromGroup);
  const to = args.groups.find((row) => row.group === args.primary.toGroup);
  if (via === undefined || to === undefined) {
    return { verdict: "INSUFFICIENT_EVIDENCE", reasons: ["主比较的两端组缺失 ⇒ 无法收口。"] };
  }
  if (!args.primary.sampleGateMet) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: [
        args.primary.gateReason,
        "唯一主要比较的样本门槛未满足 ⇒ 即使某组总收益很高，也不得称「本窗口有右尾改善证据」（目标 §6.2）。",
      ],
    };
  }
  const low = args.primary.difference.blockPrimary?.low ?? null;
  const high = args.primary.difference.blockPrimary?.high ?? null;
  const sensitivityLow = args.primary.difference.blockSensitivity?.low ?? null;
  const reasons: string[] = [
    `主比较 ${args.primary.key}：点估计 ${(args.primary.difference.pointEstimate ?? 0).toFixed(6)}，`
    + `block${BOOTSTRAP_BLOCK_PRIMARY} 区间 [${low === null ? "—" : low.toFixed(6)}, ${high === null ? "—" : high.toFixed(6)}]，`
    + `block${BOOTSTRAP_BLOCK_SENSITIVITY} 下界 ${sensitivityLow === null ? "—" : sensitivityLow.toFixed(6)}；`
    + `同靶同向年度 = ${args.primary.sameDirectionYears.join(" / ") || "无"}；`
    + `零分母迭代次数 = ${args.primary.difference.blockPrimary?.zeroDenominatorIterations ?? "—"}`
    + `（日历长度 ${args.primary.difference.blockPrimary?.calendarLength ?? "—"}）。`,
  ];
  if (high !== null && high < 0) {
    return {
      verdict: "NO_SUPPORT",
      reasons: [
        ...reasons,
        "主比较区间整体在 0 以下 ⇒ 五日观察在可实现尾率上**劣于**两日观察的同政策对照。",
      ],
    };
  }
  if (!args.primary.supported) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: [
        ...reasons,
        low === null || low <= 0
          ? "主比较 95% 区间下界未 > 0 ⇒ 未获得「本窗口五日观察有右尾改善」的证据（不等同于证明无效）。"
          : `未满足全部事前条件（block${BOOTSTRAP_BLOCK_SENSITIVITY} `
            + `${sensitivityLow === null ? "无区间" : `下界 ${sensitivityLow.toFixed(6)}`}；`
            + `2024 / 2025 同靶同向年度 = ${args.primary.sameDirectionYears.join(" / ") || "无"}）。`,
      ],
    };
  }
  const meanWorse = via.meanReturnPct !== null && to.meanReturnPct !== null && via.meanReturnPct < to.meanReturnPct;
  const totalWorse =
    via.totalReturnPct !== null && to.totalReturnPct !== null && via.totalReturnPct < to.totalReturnPct;
  if (meanWorse || totalWorse) {
    return {
      verdict: "RISK_TRADEOFF",
      reasons: [
        ...reasons,
        `尾部改善有证据，但${meanWorse ? "单笔净均值" : ""}${meanWorse && totalWorse ? " 与 " : ""}`
        + `${totalWorse ? "账户复合总收益" : ""}在五日观察下更差 ⇒ 只能作为**风险权衡**读数，不能称可交易（目标 §6.2）。`,
      ],
    };
  }
  return {
    verdict: "RIGHT_TAIL_EVIDENCE",
    reasons: [
      ...reasons,
      "满足事前条件（主比较区间下界 > 0、block40 不反向、2024/2025 同靶同向）。"
      + "这是**探索性历史证据**，不能升级为 OOS 通过，也不是盈利承诺。",
    ],
  };
}

// ---------------------------------------------------------------------------
// 组装辅助
// ---------------------------------------------------------------------------

function groupsToComputeOutputs(
  executions: readonly GroupExecution[],
  plannings: ReadonlyMap<GroupId, GroupPlanning>,
): GroupComputeOutput[] {
  return executions.map((execution) => {
    const planning = plannings.get(execution.spec.id)!;
    return {
      group: execution.spec,
      reentryPolicy: execution.spec.reentryPolicy,
      configSnapshotJson: execution.configSnapshotJson,
      decisionDateCount: planning.sortedDecisionDates.length,
      candidateRowCount: planning.candidateRows.length,
      candidateDayCount: planning.sortedDecisionDates.length,
      poolSizeByDate: planning.poolSizeByDate,
      poolSizeHistogram: planning.poolSizeHistogram,
      triggerAnchorCount: planning.triggerAnchorCount,
      multiTriggerAnchorCount: planning.multiTriggerAnchorCount,
      retriggerDayCount: planning.retriggerDayCount,
      laterTriggerDayRetainedCount: planning.laterTriggerDayRetainedCount,
      fillCount: execution.fillCount,
      rejectedOrderCount: execution.rejectedOrderCount,
      skippedIntentCount: execution.skippedIntentCount,
      accounts: execution.accounts,
      tail: {
        r: execution.rBlock,
        randomPooled: execution.randomPooled,
        difference: execution.difference,
      },
      yearlyTail: execution.yearlyTail,
      yearlyAccountReturns: execution.yearlyAccountReturns,
      randomDistribution: execution.randomDistribution,
      fillAge: execution.fillAge,
      boundary: { group: execution.spec.id, ...planning.boundary },
      exclusionLedger: execution.exclusionLedger,
      reentry: execution.reentryAccounting,
      rankingResolution: planning.rankingResolution,
      coverage: execution.coverage,
      verdict: execution.verdict,
    };
  });
}

interface BootstrapCsvRow extends Record<string, unknown> {
  readonly comparison: string;
  readonly classification: string;
  readonly variant: string;
  readonly pointEstimate: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly clusterCount: number | null;
  readonly zeroDenominatorIterations: number | null;
  readonly ignoredObservationCount: number | null;
  readonly calendarLength: number | null;
  readonly blockLength: number | null;
  readonly seed: number | null;
}

function bootstrapCsvRowsFor(args: {
  readonly key: string;
  readonly classification: string;
  readonly pointEstimate: number | null;
  readonly difference: PairedDifference;
}): BootstrapCsvRow[] {
  const variants: readonly (readonly [string, BootstrapInterval | null])[] = [
    ["block20 主口径", args.difference.blockPrimary],
    ["block40 敏感性", args.difference.blockSensitivity],
    ["block20 锚点链归属首笔入场日", args.difference.anchorChainPrimary],
    ["block20 配对均值差", args.difference.meanPrimary],
  ];
  return variants.map(([variant, interval]) => ({
    comparison: args.key,
    classification: args.classification,
    variant,
    pointEstimate: args.pointEstimate,
    low: interval?.low ?? null,
    high: interval?.high ?? null,
    clusterCount: interval?.clusterCount ?? null,
    zeroDenominatorIterations: interval?.zeroDenominatorIterations ?? null,
    ignoredObservationCount: interval?.ignoredObservationCount ?? null,
    calendarLength: interval?.calendarLength ?? null,
    blockLength: interval?.blockLength ?? null,
    seed: interval?.seed ?? null,
  }));
}

// ---------------------------------------------------------------------------
// 实验定义
// ---------------------------------------------------------------------------

export const rollingPoolObservationWindowExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/rolling-pool-observation-window",
    name: "首板滚动池 × 连续观察窗口（N × 最晚成交 L） × 再入场政策 × 固定 Runner",
    version: COMPUTATION_VERSION,
    description:
      "round-002 的续研版本：把**连续观察窗口 N**（2 / 3 / 5 日）与**最晚实际成交期限 L**（T+10 / T+20）"
      + "在**同一正式 Run** 内拉开成五组矩阵（A..E），并允许**平仓后由新买点再次入场**（E 组为「一次入场」对照）。"
      + "保留**全部**确认日（不再首发优先截断）；证券身份改为事件作用域 `sec_<uuid>::event:<code>@<date>`"
      + "（同真实股票并发上限仍由 `maxConcurrentOpenPerCode` 生效，E 的锚点次数上限由 `maxEntriesPerMember` 表达）；"
      + "`amount` 声明并透传，恢复流动性分层滑点。每组 R + 200 个固定种子随机账户，共 1005 个独立账户，"
      + "仓位 = 决策日收盘总权益 × 20%，退出继承 `strategy_versions.id=3600005`，指标唯一出口 `canonicalMetrics`。"
      + "`maxAmp5` **完全不参与**。这不是投资建议，也不是盈利承诺。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "rolling-pool",
      "observation-window",
      "entry-window",
      "reentry",
      "pre-return",
      "real-account",
      "composite-runner",
    ],
    targetMetric: {
      code: "tail20RateDifferenceDRMinusBR",
      label: "`D_R − B_R`：同期限同再入场政策下，5 日观察相对 2 日观察的已平仓交易 ≥+20% 比例差",
      rationale:
        "唯一主要比较写成组间**尾率差**，因为账户复合收益是少数几笔的统计量；"
        + "同时报告账户总收益 / 回撤 / 现金占比与 200 个随机账户分布，否则会得出方向相反的结论。",
      kind: "TAIL",
      reportMeanAlongside: true,
    },
    /**
     * `PLAN-RESEARCH-DESIGN-001` P5 —— 事前判据（目标 §6.2），**事后不得修改**。
     */
    preRegisteredCriteria: {
      criteria: [
        "唯一主要比较 = `D_R − B_R`：相同 T+20 期限、相同 SIGNAL_REENTRY 政策下，5 日观察相对 2 日观察的「已平仓交易 ≥+20% 比例」差，按**真实入场日**做配对日期移动块 bootstrap 的 95% 双侧区间。",
        "配对抽样：全部比较臂共享**同一组交易日块索引**（同一日历、含无入场日），分子与分母在同一个日期簇内一起重采样；比率**不是**逐日小样本比率的分位数平均。",
        "block20 主口径 / block40 敏感性（1000 次、固定种子 20261010 / 20261011）；另有「整条锚点链归属其首笔入场日」的敏感性与配对均值差。零分母迭代次数单列。",
        "主比较需 `D_R` 与 `B_R` **各至少 50 个唯一 ≥+20% 命中锚点**且日期重采样有足够有效观测；否则 `INSUFFICIENT_EVIDENCE`（即使某组总收益很高）。",
        "只有「主尾率差 95% 区间下界 > 0」且「block40 不反向」且「2024 与 2025 的**同靶尾率差**均为正」，才允许称「本窗口五日观察有右尾改善证据」。这是探索性历史证据，不能升级为 OOS 通过。",
        "年度判据的靶 = **实际成交 ≥+20% 尾率差**；账户年度权益收益另表报告。2026 只有在主决策窗口内确有新入场时才进入信号闸门。",
        "`D_R − E_R` 单列再入场增量；`B_R − A_R` 为期限延长比较；`C_R − B_R` 为三日观察描述性对照；各组 `R − Random` 为排序诊断。这些次要区间**不**作为独立确认性成功判据，不挑最好组替代主要比较。",
        "≥+50% / ≥+100% 作为稀疏尾部辅助一并报告，**不挑阈值**。",
        "`openAtEnd` 必须按三分类如实单列（正常期末 MTM / 无执行 bar / 停牌无法卖出）；**不得**因此删样本、递补候选或在 rd80 强平。Runner 的触发与否在该契约上**不可观测** ⇒ 不做退出消融、不声称「Runner 从未触发」。",
        "同组 R 与全部 Random 使用**完全相同的原始候选池**；账户再入场限制、持仓与现金可以让实际可买集合不同，原因单列（`run.skipped`）。D/E 的原始买点池完全相同，只在账户层阻断。",
        "再入场的多笔交易**不是**新增独立首板事件：首次 / 第二次及后续分开报告；每个锚点在「≥+20% 唯一命中」里最多计一次。",
      ],
      abortConditions: [
        "Dataset 不是 READY，或 `requiredDatasetVersionLabel` 不匹配 ⇒ 中止，不跑。",
        "`freezeSelection` 之前的任何 `observation()` 调用 ⇒ 结构级拒绝（平台闸门）。",
        "冻结集为空、池决策日 < 2、或**没有任何买点候选** ⇒ 中止，不出结论。",
        "出现任一 `confirmRd + 1 > L` 的意图、或任一意图在决策日缺行 ⇒ 中止（账户层硬门禁）。",
        "组内 201 个账户的 `simulationConfig` 快照**不是字节相同** ⇒ 中止（修正 3 的结构级断言）。",
        "冻结策略 3600005 的内容指纹或版本行主键不等于声明值 ⇒ 中止（拒绝在漂移的退出政策上做研究）。",
      ],
      stoppingRule:
        "只跑冻结的五组矩阵；主结果为负或证据不足也**正常收口**，不追加 N、L、TopK、排序方向或退出参数来补救。",
    },
    parameters: [],
    datasetRequirement: {
      datasetCode: FROZEN_DATASET_CODE,
      requiredDatasetVersionLabel: FROZEN_DATASET_VERSION,
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "market"],
        /**
         * 🔴 首板日 rd0 的 bar 来自 `feature`（prefix）层：守线锚点 `O_0` 与缩量分母 `V_0` 都读它
         * ⇒ `volume` **必须**在此声明（round-002 的 S5 预检抓到的真实缺陷）。
         */
        feature: ["open", "high", "low", "close", "preClose", "volume"],
        observation: [
          "open",
          "high",
          "low",
          "close",
          "preClose",
          // 观察分「缩量 V_d ≤ 0.5·V_0」与「量能回升 V_d ≥ V_(d-1)」都读 volume。
          "volume",
          // 🔴 修正 4：成交额（**千元**）—— 执行投影透传给引擎，恢复流动性分层滑点。
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
       * 🔴 契约缺口（与 round-1/round-002 同源）：该字段是**单标量**，无法表达滚动池**逐日变化**的
       * 决策坐标。这里声明 `20` = 五组里**最大**的成交相对日上界（任何一天的资格判定都不会用到 rd ≥ 21），
       * 是**上界声明**，不是逐日精确坐标。
       */
      decisionOffsetDays: MAX_FILL_RD_ACROSS_GROUPS,
      usesForwardData: true,
      forwardDataPurpose:
        "观察分、六条件触发与买点资格（rd1..19，**只用当日及之前**）；成交与退出路径（rd1..80 的真实行情）；"
        + "以及真实账户撮合的成交价与估值。未来数据只在**已冻结样本**上用于执行与结果观察，"
        + "绝不参与候选资格或排序。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/rolling-pool-observation-window",
    pageTitle: "首板滚动池 · 连续观察窗口 × 再入场政策 × 固定 Runner",
  },

  resultSchema: observationWindowCustomPayloadSchema,

  async run(context: ExperimentRunContext): Promise<ExperimentResultPayload> {
    const { dataset, log, artifact, freezeSelection } = context;
    const facts = dataset.facts;

    // ── 0) 冻结配置漂移断言（本地字面量 vs 服务侧唯一导出）──────────────────
    if (POSITION_FRACTION !== EARLY_ENTRY_POSITION_FRACTION) {
      throw new Error(
        `OBSERVATION-WINDOW-003：仓位口径漂移 —— result.ts 记 ${POSITION_FRACTION}，`
        + `服务侧唯一导出 ${EARLY_ENTRY_POSITION_FRACTION}。拒绝继续。`,
      );
    }
    if (RUNNER_EXTEND_HOLDING_DAYS !== RUNNER_EXTEND_TO_HOLDING_DAYS) {
      throw new Error(
        `OBSERVATION-WINDOW-003：Runner 续持上界漂移 —— result.ts 记 ${RUNNER_EXTEND_HOLDING_DAYS}，`
        + `规则库 ${RUNNER_EXTEND_TO_HOLDING_DAYS}。拒绝继续。`,
      );
    }
    if (
      RESULT_MAIN_WINDOW.startDate !== MAIN_WINDOW.startDate
      || RESULT_MAIN_WINDOW.endDate !== MAIN_WINDOW.endDate
    ) {
      throw new Error("OBSERVATION-WINDOW-003：主决策窗口在 result.ts 与 round-1 常量之间漂移。拒绝继续。");
    }
    if (facts.datasetVersionLabel !== FROZEN_DATASET_VERSION) {
      throw new Error(
        `OBSERVATION-WINDOW-003：Dataset 版本标签 ${facts.datasetVersionLabel} ≠ 声明值 ${FROZEN_DATASET_VERSION}。拒绝继续。`,
      );
    }
    for (const group of GROUPS) {
      if (
        group.confirmMinRd !== group.observationDays + 1
        || group.confirmMaxRd !== group.entryFillMaxRd - 1
      ) {
        throw new Error(`OBSERVATION-WINDOW-003：组 ${group.id} 的确认区间与 N/L 不一致（冻结声明被破坏）。`);
      }
      if (!(OBSERVATION_DAYS_MATRIX as readonly number[]).includes(group.observationDays)) {
        throw new Error(`OBSERVATION-WINDOW-003：组 ${group.id} 的 N=${group.observationDays} 不在冻结矩阵内。`);
      }
      if (!(ENTRY_FILL_MAX_RD_MATRIX as readonly number[]).includes(group.entryFillMaxRd)) {
        throw new Error(`OBSERVATION-WINDOW-003：组 ${group.id} 的 L=${group.entryFillMaxRd} 不在冻结矩阵内。`);
      }
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
    for await (const page of dataset.eventPages()) {
      for (const row of page as readonly ExperimentEventRow[]) {
        scannedEventCount += 1;
        if (seen.has(row.eventId)) {
          bump("DUPLICATE_EVENT_ID");
          continue;
        }
        seen.add(row.eventId);
        if (row.values.isFirstLimit !== true) {
          bump("NOT_FIRST_LIMIT");
          continue;
        }
        const market = asString(row.values.market);
        const boardType = asString(row.values.boardType);
        if (boardType !== "main" || (market !== "SH" && market !== "SZ")) {
          bump("NOT_MAIN_BOARD");
          continue;
        }
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
    log(
      `事件扫描：候选池 ${seeds.length} / 扫描 ${scannedEventCount}（数据集声明 ${facts.totalEvents ?? "未知"}）；`
      + `剔除 ${JSON.stringify(excludedByReason)}`,
    );

    // ── 2) 冻结样本资格（必须在第一次 observation() 之前）───────────────
    freezeSelection([...wanted]);

    // ── 3) prefix：rd −10 / −1 / 0（preReturn10 只读 rd ≤ 0）─────────────
    const prefixByEvent = new Map<string, Map<number, PoolBar>>();
    for (const relativeDay of PREFIX_RELATIVE_DAYS) {
      const rows = await dataset.feature(relativeDay);
      for (const row of rows) {
        if (!wanted.has(row.eventId)) continue;
        let map = prefixByEvent.get(row.eventId);
        if (map === undefined) {
          map = new Map<number, PoolBar>();
          prefixByEvent.set(row.eventId, map);
        }
        map.set(relativeDay, normalizeBar(row));
      }
      log(`prefix rd=${relativeDay} 读入 ${rows.length} 行`);
    }

    // ── 4) post：rd 1..80（观察分 / 触发 / 成交 / 退出路径）───────────────
    const postByEvent = new Map<string, Map<number, PoolBar>>();
    for (const relativeDay of POST_RELATIVE_DAYS) {
      const rows = await dataset.observation(relativeDay);
      for (const row of rows) {
        if (!wanted.has(row.eventId)) continue;
        let map = postByEvent.get(row.eventId);
        if (map === undefined) {
          map = new Map<number, PoolBar>();
          postByEvent.set(row.eventId, map);
        }
        map.set(relativeDay, normalizeBar(row));
      }
      if (relativeDay % 10 === 0 || relativeDay === POST_MAX_RELATIVE_DAY) {
        log(`post rd=${relativeDay}/${POST_MAX_RELATIVE_DAY} 累计事件 ${postByEvent.size}`);
      }
      progress(`post rd=${relativeDay}/${POST_MAX_RELATIVE_DAY} rows=${rows.length}`);
    }

    // ── 5) 事件归一化 ────────────────────────────────────────────────
    const poolEvents: PoolEvent[] = [];
    for (const seed of seeds) {
      const post = postByEvent.get(seed.eventId);
      if (post === undefined || post.size === 0) {
        bump("NO_POST_BARS");
        wanted.delete(seed.eventId);
        continue;
      }
      poolEvents.push({
        ...seed,
        isFirstLimit: true,
        prefix: prefixByEvent.get(seed.eventId) ?? new Map<number, PoolBar>(),
        post,
      });
    }
    const eventById = new Map(poolEvents.map((event) => [event.eventId, event]));

    // ── 6) 因子：`preReturn10` 走既有实现；`maxAmp5` **完全不参与** ────────
    const nullMaxAmp5: MaxAmp5Computer = () => null;
    const factors = deriveEventFactors(poolEvents, nullMaxAmp5);

    // ── 7) 逐日池（复用 round-1 锚点规则；窗口 = 主决策窗口）───────────────
    const pool = buildDailyPool({ events: poolEvents, factors, window: MAIN_WINDOW });
    progress(`daily pool built: rows=${pool.dailyRows.length} dates=${pool.decisionDates.length}`);
    for (const eventId of pool.pooledEventIds) wanted.delete(eventId);
    bump("NEVER_IN_WATCH_POOL", wanted.size);
    if (pool.pooledEventIds.size === 0) {
      throw new Error(
        "OBSERVATION-WINDOW-003：冻结集为空（窗口内没有任何事件进入 rd1..40 观察池）—— 按事前中止条件停止，不出结论。",
      );
    }

    // ── 8) 真实证券身份（**调用一次**）───────────────────────────────────
    const identity = await resolveRollingPoolSecurityIds(
      seeds.map((seed) => ({ eventId: seed.eventId, symbol: seed.symbol, tradeDate: seed.eventDate })),
    );
    log(
      `身份解析：identifiers=${identity.identifierRowCount}；已解析 ${identity.securityIdByEventId.size}；`
      + `无法解析 ${identity.unresolvedEventIds.length}`,
    );
    /**
     * 🔴 修正 2：`securityId = eventScopedSecurityId(canonical, eventId)`。
     *
     * 平台 `eventId = <symbol>@<tradeDate>`（`server/datasetRegistry/detection.ts#computeEventId`）
     * ⇒ 身份形如 `sec_<uuid>::event:000001.SZ@2024-03-01`，与 `panelIdentity.panelCodeOf` 的正则同形
     * ⇒ 同真实股票的并发限制仍然生效，而同锚点次数限制按**事件**计数。
     */
    const securityIdByEventId = new Map<string, string>();
    for (const [eventId, canonical] of identity.securityIdByEventId) {
      securityIdByEventId.set(eventId, eventScopedSecurityId(canonical, eventId));
    }

    const poolDecisionIndex = new Map<string, number>();
    for (let index = 0; index < pool.decisionDates.length; index += 1) {
      poolDecisionIndex.set(pool.decisionDates[index]!, index);
    }

    // ── 9) 逐组：观察评估 → 原始候选池 → 意图计划 ─────────────────────────
    let fillDayCalendarMismatchCount = 0;
    const planningByGroup = new Map<GroupId, GroupPlanning>();
    /** 跨组共享的逐日观察账索引：`eventId|rd` → 该 rd 是哪些组的确认日。 */
    const triggerGroupsByEventRd = new Map<string, string[]>();

    for (const spec of GROUPS) {
      const evaluations = evaluateEarlyEntries(poolEvents, {
        observationDays: spec.observationDays,
        entryFillMaxRd: spec.entryFillMaxRd,
      });
      const diagnostics: Record<string, number> = {};
      const bumpGroup = (code: string, count = 1): void => {
        if (count <= 0) return;
        diagnostics[code] = (diagnostics[code] ?? 0) + count;
      };
      const layerCounts = new Map<string, number>();
      const bumpLayer = (layer: string, code: string, count = 1): void => {
        if (count <= 0) return;
        layerCounts.set(`${layer}\u0000${code}`, (layerCounts.get(`${layer}\u0000${code}`) ?? 0) + count);
      };

      const candidateRows: CandidateRow[] = [];
      let fillRdViolationCount = 0;
      let belowConfirmMinDayCount = 0;
      let aboveConfirmMaxDayCount = 0;
      let layerMismatchCount = 0;

      for (const row of pool.dailyRows as readonly DailyPoolRow[]) {
        const evaluation = evaluations.get(row.anchorEventId);
        if (evaluation === undefined) {
          bumpGroup("EVALUATION_MISSING");
          continue;
        }
        const event = eventById.get(row.anchorEventId);
        if (event === undefined) {
          bumpGroup("EVENT_MISSING");
          continue;
        }
        if (evaluation.triggers.length === 0) {
          bumpGroup(`NO_TRIGGER__${evaluation.finalState}__${String(evaluation.finalReason)}`);
        }
        if (row.eventAge < spec.confirmMinRd) belowConfirmMinDayCount += 1;
        if (row.eventAge > spec.confirmMaxRd) aboveConfirmMaxDayCount += 1;

        const attribution = classifyDecisionLayer({
          evaluation,
          event,
          eventAge: row.eventAge,
          observationDays: spec.observationDays,
          confirmMinRd: spec.confirmMinRd,
          confirmMaxRd: spec.confirmMaxRd,
        });
        const decision = candidateOnDecisionDay({
          evaluation,
          eventAge: row.eventAge,
          observationDays: spec.observationDays,
          entryFillMaxRd: spec.entryFillMaxRd,
        });
        // 交叉校验：归因的最后一层必须与权威规则库一致（不一致即计数，绝不静默）。
        if ((decision !== null) !== (attribution.code === "TRIGGER_DAY")) layerMismatchCount += 1;

        if (decision === null) {
          bumpLayer(attribution.layer, attribution.code);
          continue;
        }
        bumpLayer("candidate", "TRIGGER_DAY");
        if (decision.isLaterTriggerDay) {
          // 🔴 修正 1：只计数，**不** continue。
          bumpGroup("LATER_TRIGGER_DAY_RETAINED");
          bumpLayer("candidate", "LATER_TRIGGER_DAY_RETAINED");
        } else {
          bumpGroup("FIRST_TRIGGER_DAY");
        }

        const trigger = decision.trigger;
        if (
          trigger.fillRd !== trigger.confirmRd + 1
          || !groupFillRdWithinCap(trigger.confirmRd, spec.observationDays, spec.entryFillMaxRd)
        ) {
          fillRdViolationCount += 1;
          continue;
        }
        if (row.preReturn10 === null) {
          bumpGroup("PRE_RETURN10_MISSING");
          bumpLayer("signal", "PRE_RETURN10_MISSING");
          continue;
        }
        const securityId = securityIdByEventId.get(row.anchorEventId);
        if (securityId === undefined) {
          bumpGroup("UNRESOLVED_SECURITY_ID");
          bumpLayer("signal", "UNRESOLVED_SECURITY_ID");
          continue;
        }
        if (trigger.fillDate !== null) {
          const decisionIndex = poolDecisionIndex.get(row.date);
          const calendarNext =
            decisionIndex !== undefined && decisionIndex + 1 < pool.decisionDates.length
              ? pool.decisionDates[decisionIndex + 1] ?? null
              : null;
          if (calendarNext !== null && calendarNext !== trigger.fillDate) {
            fillDayCalendarMismatchCount += 1;
          }
        }
        const triggerKey = `${row.anchorEventId}|${trigger.confirmRd}`;
        const groupsForDay = triggerGroupsByEventRd.get(triggerKey) ?? [];
        if (!groupsForDay.includes(spec.id)) groupsForDay.push(spec.id);
        triggerGroupsByEventRd.set(triggerKey, groupsForDay);

        candidateRows.push({
          date: row.date,
          anchorEventId: row.anchorEventId,
          symbol: row.symbol,
          securityId,
          eventAge: row.eventAge,
          confirmRd: trigger.confirmRd,
          fillRd: trigger.fillRd,
          fillDate: trigger.fillDate,
          preReturn10: row.preReturn10,
          triggerOrdinal: decision.triggerOrdinal,
          isLaterTriggerDay: decision.isLaterTriggerDay,
        });
      }
      bumpLayer("candidate", "LAYER_ATTRIBUTION_MISMATCH", layerMismatchCount);
      if (layerMismatchCount > 0) {
        log(`⚠️ 组 ${spec.id}：逐层归因与权威触发判定不一致 ${layerMismatchCount} 次（已如实计数）。`);
      }

      sortCandidates(candidateRows);
      const candidatesByDate = new Map<string, CandidateRow[]>();
      for (const row of candidateRows) {
        const list = candidatesByDate.get(row.date) ?? [];
        list.push(row);
        candidatesByDate.set(row.date, list);
      }
      const sortedDecisionDates = [...candidatesByDate.keys()].sort();

      const candidateByAnchor = new Map<string, CandidateRow[]>();
      for (const row of candidateRows) {
        const list = candidateByAnchor.get(row.anchorEventId) ?? [];
        list.push(row);
        candidateByAnchor.set(row.anchorEventId, list);
      }
      const retriggerDayCount = candidateRows.filter((row) => row.isLaterTriggerDay).length;
      const triggerAnchorCount = candidateByAnchor.size;
      const multiTriggerAnchorCount = [...candidateByAnchor.values()].filter((list) => list.length > 1).length;

      const poolSizes = sortedDecisionDates.map((date) => (candidatesByDate.get(date) ?? []).length);
      const poolSizeHistogram = {
        le2: poolSizes.filter((size) => size <= 2).length,
        eq3: poolSizes.filter((size) => size === 3).length,
        gt3: poolSizes.filter((size) => size > 3).length,
      };

      const rIntents = new Map<string, readonly AccountIntent[]>();
      for (const date of sortedDecisionDates) {
        const cells = candidatesByDate.get(date)!;
        rIntents.set(date, toIntents(cells.slice(0, DAILY_TOP_K), cells.length));
      }
      const plans: AccountPlan[] = [
        { accountIndex: 0, kind: "R", seedIndex: null, intentsByDate: rIntents },
      ];
      for (let drawIndex = 0; drawIndex < RANDOM_ACCOUNT_COUNT; drawIndex += 1) {
        // 🔴 目标 §2：种子 = 20261010 + i ⇒ 五组同一个 i 是**同一个随机账户编号**。
        const seedIndex = RANDOM_SEED_INDEX_BASE + drawIndex;
        const intents = new Map<string, readonly AccountIntent[]>();
        for (const date of sortedDecisionDates) {
          const cells = candidatesByDate.get(date)!;
          if (cells.length === 0) continue;
          const drawn = pickUniformRandomSubset({
            eventIds: cells.map((cell) => cell.anchorEventId),
            topK: DAILY_TOP_K,
            seedIndex,
            date,
          });
          const byAnchor = new Map(cells.map((cell) => [cell.anchorEventId, cell]));
          const picked = drawn
            .map((eventId) => byAnchor.get(eventId))
            .filter((cell): cell is CandidateRow => cell !== undefined);
          intents.set(date, toIntents(picked, cells.length));
        }
        plans.push({ accountIndex: drawIndex + 1, kind: "RANDOM", seedIndex, intentsByDate: intents });
      }

      const observedConfirmRds = candidateRows.map((row) => row.confirmRd);
      const observedFillRds = candidateRows.map((row) => row.fillRd);
      planningByGroup.set(spec.id, {
        spec,
        candidateRows,
        candidatesByDate,
        sortedDecisionDates,
        plans,
        rIntents,
        diagnostics,
        layerCounts,
        poolSizeHistogram,
        poolSizeByDate: {
          min: poolSizes.length === 0 ? 0 : Math.min(...poolSizes),
          median: medianOf(poolSizes) ?? 0,
          max: poolSizes.length === 0 ? 0 : Math.max(...poolSizes),
        },
        triggerAnchorCount,
        multiTriggerAnchorCount,
        retriggerDayCount,
        laterTriggerDayRetainedCount: retriggerDayCount,
        boundary: {
          observationDays: spec.observationDays,
          entryFillMaxRd: spec.entryFillMaxRd,
          confirmMinRd: spec.confirmMinRd,
          confirmMaxRd: spec.confirmMaxRd,
          earliestPossibleFillRd: spec.earliestPossibleFillRd,
          observedMinConfirmRd: observedConfirmRds.length === 0 ? null : Math.min(...observedConfirmRds),
          observedMaxConfirmRd: observedConfirmRds.length === 0 ? null : Math.max(...observedConfirmRds),
          observedMinFillRd: observedFillRds.length === 0 ? null : Math.min(...observedFillRds),
          observedMaxFillRd: observedFillRds.length === 0 ? null : Math.max(...observedFillRds),
          candidatesAtMinConfirmRd: candidateRows.filter((row) => row.confirmRd === spec.confirmMinRd).length,
          candidatesAtMaxConfirmRd: candidateRows.filter((row) => row.confirmRd === spec.confirmMaxRd).length,
          candidatesAtFillCap: candidateRows.filter((row) => row.fillRd === spec.entryFillMaxRd).length,
          fillRdViolationCount,
          belowConfirmMinDayCount,
          aboveConfirmMaxDayCount,
          note:
            `N=${spec.observationDays} / L=${spec.entryFillMaxRd} ⇒ 确认 rd ∈ [${spec.confirmMinRd}, ${spec.confirmMaxRd}]，`
            + `最早可能成交 rd=${spec.earliestPossibleFillRd}（**不是固定买入日**）。`
            + `越界候选必须为 0：本组实测 ${fillRdViolationCount}。`,
        },
        rankingResolution: rankResolutionOf(spec.id, candidateRows),
      });
      log(
        `组 ${spec.id}（N=${spec.observationDays} / L=${spec.entryFillMaxRd} / ${spec.reentryKind}）：`
        + `候选 ${candidateRows.length} 行 / 决策日 ${sortedDecisionDates.length}；`
        + `触发锚点 ${triggerAnchorCount}（多次触发 ${multiTriggerAnchorCount}）；再触发日 ${retriggerDayCount}；`
        + `越界 ${fillRdViolationCount}；诊断 ${JSON.stringify(diagnostics)}`,
      );
      progress(`group ${spec.id} planned: candidates=${candidateRows.length}`);
      if (fillRdViolationCount > 0) {
        throw new Error(
          `OBSERVATION-WINDOW-003：组 ${spec.id} 出现 ${fillRdViolationCount} 个「确认日 + 1 > `
          + `${spec.entryFillMaxRd}」的候选 —— 违反账户层硬门禁，中止，不出结论。`,
        );
      }
    }

    if (![...planningByGroup.values()].some((planning) => planning.candidateRows.length > 0)) {
      throw new Error(
        "OBSERVATION-WINDOW-003：五组都没有任何买点候选 —— 按事前中止条件停止，不出结论（不伪造成交）。",
      );
    }
    const basePlanning = planningByGroup.get("B") ?? planningByGroup.get("A")!;

    // ── 10) 共享执行投影（五组涉及的锚点并集；**事件作用域身份**）────────────
    const involvedSecurityIds = new Set<string>();
    const rowInputByKey = new Map<string, RollingPoolExecutionRowInput>();
    let barValueConflictCount = 0;
    const involvedAnchors = new Set<string>();
    for (const planning of planningByGroup.values()) {
      for (const row of planning.candidateRows) involvedAnchors.add(row.anchorEventId);
    }
    const orderedSeeds = [...seeds].sort(
      (left, right) => left.eventDate.localeCompare(right.eventDate) || left.eventId.localeCompare(right.eventId),
    );
    for (const seed of orderedSeeds) {
      if (!involvedAnchors.has(seed.eventId)) continue;
      const securityId = securityIdByEventId.get(seed.eventId);
      if (securityId === undefined) continue;
      involvedSecurityIds.add(securityId);
      const post = postByEvent.get(seed.eventId);
      if (post === undefined) continue;
      for (const relativeDay of POST_RELATIVE_DAYS) {
        const bar = post.get(relativeDay);
        if (bar === undefined) continue;
        if (bar.tradeDate < EXECUTION_ROW_START_DATE) continue;
        const key = `${bar.tradeDate}\u0000${securityId}`;
        const candidate: RollingPoolExecutionRowInput = {
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
          // 🔴 修正 4：声明并透传成交额（**千元**）⇒ 引擎按流动性分层加成滑点。
          amount: bar.amount,
          barPresent: bar.barPresent,
          suspended: bar.suspended,
        };
        const before = rowInputByKey.get(key);
        if (before === undefined) {
          rowInputByKey.set(key, candidate);
          continue;
        }
        // 行键 = (tradeDate, 事件作用域 securityId) ⇒ 同一事件不可能有两行；
        // 这里只在**真的**出现冲突时如实计数（正常应为 0）。
        if (
          before.open !== candidate.open
          || before.high !== candidate.high
          || before.low !== candidate.low
          || before.close !== candidate.close
          || before.volume !== candidate.volume
          || before.amount !== candidate.amount
        ) {
          barValueConflictCount += 1;
        }
      }
    }
    const rows = [...rowInputByKey.values()].sort(
      (left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) || left.securityId.localeCompare(right.securityId),
    );
    const tradingDates = [...new Set(rows.map((row) => row.tradeDate))].sort();
    if (rows.length === 0 || tradingDates.length === 0) {
      throw new Error(
        "OBSERVATION-WINDOW-003：执行投影为空（候选涉及的证券没有任何可用 post 行）—— 中止，不出结论。",
      );
    }
    const tradingDayIndex = new Map<string, number>();
    for (let index = 0; index < tradingDates.length; index += 1) {
      tradingDayIndex.set(tradingDates[index]!, index);
    }
    const simStartDate = tradingDates[0]!;
    const simEndDate = tradingDates[tradingDates.length - 1]!;
    const executionDataset: ResearchDataset = sealRollingPoolExecutionDataset({
      name: "rolling-pool-observation-window-003-execution-projection",
      startDate: simStartDate,
      endDate: simEndDate,
      datasetVersionId: facts.datasetVersionId,
      rows,
      tradingDates,
    });
    const amountRowCount = rows.filter((row) => row.amount !== null && row.amount > 0).length;
    log(
      `执行投影：证券 ${involvedSecurityIds.size}、行 ${rows.length}（其中 amount 有效 ${amountRowCount}）、`
      + `交易日 ${tradingDates.length} [${simStartDate} ~ ${simEndDate}]；bar 值冲突 ${barValueConflictCount}`,
    );
    if (amountRowCount === 0) {
      log("⚠️ 执行投影里没有任何有效 amount ⇒ 滑点回落为基础值（如实披露，不伪造金额）。");
    }

    // ── 11) 冻结退出政策（唯一继承物；指纹漂移即响亮失败）───────────────────
    const bundle = await loadFrozenRunnerPolicyBundle();
    if (bundle.sourceFingerprint !== FROZEN_STRATEGY_REFERENCE.fingerprint) {
      throw new Error(
        "OBSERVATION-WINDOW-003：冻结策略指纹与 result.ts 声明不一致（服务侧读取器已断言一次，这里是二次锚点）。",
      );
    }
    const runnerBridge = runnerBridgeOf(bundle);

    const buildSourceRun = (plan: AccountPlan, planning: GroupPlanning): CandidateEvaluationRun => {
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
        strategyId:
          plan.kind === "R"
            ? `study-observation-window-${planning.spec.id}-r`
            : `study-observation-window-${planning.spec.id}-random`,
        strategyVersion: COMPUTATION_VERSION,
        parameters: {
          group: planning.spec.id,
          observationDays: planning.spec.observationDays,
          entryFillMaxRd: planning.spec.entryFillMaxRd,
          reentryKind: planning.spec.reentryKind,
          accountIndex: plan.accountIndex,
          accountKind: plan.kind,
          seedIndex: plan.seedIndex ?? -1,
          dailyTopK: DAILY_TOP_K,
          positionFraction: POSITION_FRACTION,
          maxPositions: MAX_POSITIONS,
          maxDailyBuys: MAX_DAILY_BUYS,
        },
        dateRange: {
          startDate: planning.sortedDecisionDates[0] ?? simStartDate,
          endDate:
            planning.sortedDecisionDates[planning.sortedDecisionDates.length - 1] ?? simEndDate,
        },
        point: "close",
        signalDescription:
          `首板滚动池（rd1..40 锚点）+ 连续观察买点（N=${planning.spec.observationDays} 日各 ≥3 分 → `
          + `收盘突破前两日高点 + 量能回升；确认 rd ∈ [${planning.spec.confirmMinRd}, ${planning.spec.confirmMaxRd}]，`
          + `成交 rd ≤ ${planning.spec.entryFillMaxRd}，**保留全部确认日**）`
          + `；账户层按 preReturn10 HIGH 取前 ${DAILY_TOP_K}（R）或同日同池同人数均匀无放回随机（Random）。`,
        featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
        rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
        selectionConfig: { method: { kind: "topN", n: DAILY_TOP_K } },
        days: dayRecords,
        evaluation,
      };
      return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
    };

    // ── 12) 逐组：权威装配一次 + 201 个账户用**同一个** simConfig ──────────
    const executions = new Map<GroupId, GroupExecution>();
    let assembledConfigJson: string | null = null;

    for (const spec of GROUPS) {
      const planning = planningByGroup.get(spec.id)!;
      const rSourceRun = buildSourceRun(planning.plans[0]!, planning);
      // 🔴 修正 3 第一步：唯一一次权威装配（它自己的 run **不进入**结果，只为拿 simulationConfig）。
      const assembly = await runCompositeRunnerBacktest({
        dataset: executionDataset,
        sourceRun: rSourceRun,
        strategyDocument: bundle.document,
        dateRange: { startDate: simStartDate, endDate: simEndDate },
        datasetVersionId: facts.datasetVersionId,
        codeVersion: COMPUTATION_VERSION,
        createdAt: FROZEN_CREATED_AT,
        name: `observation-window-003-${spec.id}-assembly`,
        runnerBridge,
      });
      const assembledBase = assembly.simulationConfig;
      const assembledJson = JSON.stringify({ ...assembledBase, name: null });
      if (assembledConfigJson === null) assembledConfigJson = assembledJson;
      else if (assembledConfigJson !== assembledJson) {
        throw new Error(
          `OBSERVATION-WINDOW-003：组 ${spec.id} 的权威装配配置与其他组不同 —— 五组必须只有一个执行口径（修正 3）。`,
        );
      }
      if (
        assembledBase.positionSizing?.sizingMethod !== "EQUITY_FRACTION"
        || assembledBase.positionSizing.fraction !== POSITION_FRACTION
      ) {
        throw new Error(
          "OBSERVATION-WINDOW-003：装配出的仓位口径不是 "
          + `EQUITY_FRACTION/${POSITION_FRACTION}（实际 ${String(assembledBase.positionSizing?.sizingMethod)}`
          + `/${String(assembledBase.positionSizing?.fraction)}）—— 拒绝继续。`,
        );
      }
      if (assembledBase.candidateExitPolicy !== "DISABLED") {
        throw new Error(
          `OBSERVATION-WINDOW-003：装配出的候选退出政策不是 DISABLED（实际 ${assembledBase.candidateExitPolicy}）—— 拒绝继续。`,
        );
      }

      /**
       * 🔴 修正 3：组内 **201 个账户（含 R）共享同一个对象引用**。
       *
       * `runCompositeRunnerBacktest` **不接受** `reentryPolicy` ⇒ 这里显式覆盖它，
       * 然后一律走 `runTradeSimulation`（唯一撮合入口）。
       */
      const groupSimConfig: SimulationConfig = Object.freeze({
        ...assembledBase,
        name: `observation-window-003-${spec.id}`,
        reentryPolicy: { ...spec.reentryPolicy },
      });

      const accounts: AccountMetrics[] = [];
      const rCompletedReturns: number[] = [];
      const randomCompletedReturns: number[] = [];
      const rCompletedEntries: CompletedEntryFact[] = [];
      const ledgerRows: ReentryLedgerRow[] = [];
      const failedRows: ReentryFailedAttemptRow[] = [];
      const rTradeRows: Record<string, unknown>[] = [];
      const randomTradeShards = new Map<string, Record<string, unknown>[]>();
      const rArmCells = new Map<string, ClusterCell>();
      const randomArmCells = new Map<string, ClusterCell>();
      const rChainCells = new Map<string, ClusterCell>();
      const randomChainCells = new Map<string, ClusterCell>();
      const rYearly = new Map<number, { completed: number; hits: number }>();
      const randomYearly = new Map<number, { completed: number; hits: number }>();
      const randomYearlyReturns = new Map<number, number[]>();
      const rYearlyEquityReturns = new Map<number, number>();
      const skipCodeCounts = new Map<string, number>();
      const rejectedReasonCounts = new Map<string, number>();
      const layerCounts = new Map<string, number>(planning.layerCounts);
      const ordinalTradeCount = new Map<number, number>();
      const ordinalCompleted = new Map<number, number>();
      const ordinalHits = new Map<number, number>();
      const ordinalReturns = new Map<number, number[]>();
      const ordinalNetPnl = new Map<number, number>();
      const ordinalFees = new Map<number, number>();
      const chainsAll: { firstEntryDate: string; netPnl: number; hasHit20: boolean; allClosed: boolean }[] = [];
      const fillAgeCells = new Map<number, { fillCount: number; anchors: Set<string>; returns: number[] }>();
      const randomTotalReturns: number[] = [];
      const randomDrawdowns: number[] = [];
      const randomCashShares: number[] = [];
      const randomWinRates: number[] = [];
      const randomHolding: number[] = [];
      const randomSkips: number[] = [];
      const randomFills: number[] = [];
      const randomRejections: number[] = [];
      const randomTradeCounts: number[] = [];
      const randomCompletedCounts: number[] = [];
      const randomOpenCounts: number[] = [];
      const randomTail20: number[] = [];
      const randomTail50: number[] = [];
      const randomTail100: number[] = [];
      const randomAnnualized: number[] = [];
      const entryYearsInMainWindow = new Set<number>();
      let tradesTotal = 0;
      let tradesCompleted = 0;
      let tradesOpenAtEnd = 0;
      let mtmValidCount = 0;
      let noExecutionBarCount = 0;
      let suspendedCannotSellCount = 0;
      let overlapCount = 0;
      let heldToExtendedCapCount = 0;
      let runnerBridgeExitReasonCount = 0;
      let fillCountTotal = 0;
      let rejectedOrderTotal = 0;
      let skippedIntentTotal = 0;
      let fillAgeUnknownCount = 0;
      let firstConfigJson: string | null = null;

      const bumpLayer = (layer: string, code: string, count = 1): void => {
        if (count <= 0) return;
        layerCounts.set(`${layer}\u0000${code}`, (layerCounts.get(`${layer}\u0000${code}`) ?? 0) + count);
      };

      for (const plan of planning.plans) {
        const sourceRun = plan.kind === "R" ? rSourceRun : buildSourceRun(plan, planning);
        // 🔴 修正 3：同一个对象引用（不 spread、不改 name）⇒ 组内快照字节相同。
        const run = runTradeSimulation({ dataset: executionDataset, sourceRun, simConfig: groupSimConfig });
        const runConfigJson = JSON.stringify(run.config);
        if (firstConfigJson === null) firstConfigJson = runConfigJson;
        else if (firstConfigJson !== runConfigJson) {
          throw new Error(
            `OBSERVATION-WINDOW-003：组 ${spec.id} 账户 ${plan.accountIndex} 的 config 快照与首个账户不同 `
            + "—— 违反修正 3 的「组内字节相同」断言。",
          );
        }

        const derivation = deriveAccount({
          groupId: spec.id,
          plan,
          run,
          tradingDates,
          tradingDayIndex,
        });
        accounts.push(derivation.metrics);
        ledgerRows.push(...derivation.ledgerRows);
        failedRows.push(...derivation.failedRows);
        chainsAll.push(...derivation.chains);
        fillAgeUnknownCount += derivation.fillAgeUnknownCount;
        tradesTotal += derivation.coverage.tradesTotal;
        tradesCompleted += derivation.coverage.tradesCompleted;
        tradesOpenAtEnd += derivation.coverage.tradesOpenAtEnd;
        mtmValidCount += derivation.coverage.mtmValidCount;
        noExecutionBarCount += derivation.coverage.noExecutionBarCount;
        suspendedCannotSellCount += derivation.coverage.suspendedCannotSellCount;
        overlapCount += derivation.coverage.overlapCount;
        heldToExtendedCapCount += derivation.coverage.heldToExtendedCapCount;
        runnerBridgeExitReasonCount += derivation.coverage.runnerBridgeExitReasonCount;
        fillCountTotal += run.executionStats.totalFills;
        rejectedOrderTotal += run.executionStats.rejectedOrders;
        skippedIntentTotal += run.skipped.length;
        for (const [code, count] of derivation.skipCodes) {
          skipCodeCounts.set(code, (skipCodeCounts.get(code) ?? 0) + count);
        }
        for (const [reason, count] of derivation.rejectedReasons) {
          rejectedReasonCounts.set(reason, (rejectedReasonCounts.get(reason) ?? 0) + count);
        }
        for (const [bucket, count] of derivation.exitBuckets) {
          // 退出层并入逐层账（观察 → … → 成交 → **退出**）
          layerCounts.set(`exit\u0000${bucket}`, (layerCounts.get(`exit\u0000${bucket}`) ?? 0) + count);
        }
        for (const [key, count] of derivation.layerCounters) {
          layerCounts.set(key, (layerCounts.get(key) ?? 0) + count);
        }
        for (const fact of derivation.ordinalFacts) {
          ordinalTradeCount.set(fact.ordinal, (ordinalTradeCount.get(fact.ordinal) ?? 0) + fact.tradeCount);
          ordinalCompleted.set(
            fact.ordinal,
            (ordinalCompleted.get(fact.ordinal) ?? 0) + fact.completedCount,
          );
          if (fact.hit20Count > 0) {
            ordinalHits.set(fact.ordinal, (ordinalHits.get(fact.ordinal) ?? 0) + fact.hit20Count);
          }
          if (fact.returns.length > 0) {
            const list = ordinalReturns.get(fact.ordinal) ?? [];
            list.push(...fact.returns);
            ordinalReturns.set(fact.ordinal, list);
          }
          ordinalNetPnl.set(fact.ordinal, (ordinalNetPnl.get(fact.ordinal) ?? 0) + fact.netPnlSum);
          ordinalFees.set(fact.ordinal, (ordinalFees.get(fact.ordinal) ?? 0) + fact.feesSum);
        }
        for (const fact of derivation.fillAgeFacts) {
          if (fact.fillRd === null) continue;
          const cell = fillAgeCells.get(fact.fillRd) ?? {
            fillCount: 0,
            anchors: new Set<string>(),
            returns: [] as number[],
          };
          cell.fillCount += 1;
          cell.anchors.add(fact.anchorEventId);
          if (fact.closed && fact.returnPct !== null) cell.returns.push(fact.returnPct);
          fillAgeCells.set(fact.fillRd, cell);
        }

        if (plan.kind === "R") {
          rTradeRows.push(...derivation.rTradeRows);
          rCompletedReturns.push(...derivation.completedEntries.map((entry) => entry.returnPct));
          rCompletedEntries.push(...derivation.completedEntries);
          for (const row of derivation.yearlyEquityReturns) {
            rYearlyEquityReturns.set(row.year, row.returnPct);
          }
          for (const entry of derivation.completedEntries) {
            const year = Number(entry.entryTime.slice(0, 4));
            if (entry.entryTime >= MAIN_WINDOW.startDate && entry.entryTime <= MAIN_WINDOW.endDate) {
              entryYearsInMainWindow.add(year);
            }
            const isHit = entry.returnPct >= TAIL_THRESHOLDS_PCT[0];
            addCell(rArmCells, entry.entryTime, { hit: isHit, returnPct: entry.returnPct });
            const chainFirst = derivation.chainFirstEntryByAnchor.get(entry.anchorEventId)
              ?? entry.entryTime;
            addCell(rChainCells, chainFirst, { hit: isHit, returnPct: entry.returnPct });
            const cell = rYearly.get(year) ?? { completed: 0, hits: 0 };
            cell.completed += 1;
            cell.hits += isHit ? 1 : 0;
            rYearly.set(year, cell);
          }
        } else {
          randomCompletedReturns.push(...derivation.completedEntries.map((entry) => entry.returnPct));
          for (const entry of derivation.completedEntries) {
            const year = Number(entry.entryTime.slice(0, 4));
            if (entry.entryTime >= MAIN_WINDOW.startDate && entry.entryTime <= MAIN_WINDOW.endDate) {
              entryYearsInMainWindow.add(year);
            }
            const isHit = entry.returnPct >= TAIL_THRESHOLDS_PCT[0];
            addCell(randomArmCells, entry.entryTime, { hit: isHit, returnPct: entry.returnPct });
            const chainFirst = derivation.chainFirstEntryByAnchor.get(entry.anchorEventId)
              ?? entry.entryTime;
            addCell(randomChainCells, chainFirst, { hit: isHit, returnPct: entry.returnPct });
            const cell = randomYearly.get(year) ?? { completed: 0, hits: 0 };
            cell.completed += 1;
            cell.hits += isHit ? 1 : 0;
            randomYearly.set(year, cell);
          }
          randomTotalReturns.push(derivation.metrics.totalReturnPct ?? 0);
          randomDrawdowns.push(derivation.metrics.maxDrawdownPct);
          randomCashShares.push(derivation.metrics.finalCashSharePct ?? 0);
          if (derivation.metrics.winRatePct !== null) randomWinRates.push(derivation.metrics.winRatePct);
          if (derivation.metrics.averageHoldingPeriod !== null) {
            randomHolding.push(derivation.metrics.averageHoldingPeriod);
          }
          randomSkips.push(derivation.metrics.skippedIntentCount);
          randomFills.push(derivation.metrics.fillCount);
          randomRejections.push(derivation.metrics.rejectedOrderCount);
          randomAnnualized.push(derivation.metrics.annualizedReturnPct ?? 0);
          randomTradeCounts.push(derivation.metrics.tradeCount);
          randomCompletedCounts.push(derivation.metrics.completedTradeCount);
          randomOpenCounts.push(derivation.metrics.openAtEndCount);
          randomTail20.push((derivation.metrics.tail20Rate ?? 0) * 100);
          randomTail50.push((derivation.metrics.tail50Rate ?? 0) * 100);
          randomTail100.push((derivation.metrics.tail100Rate ?? 0) * 100);
          for (const row of derivation.yearlyEquityReturns) {
            const list = randomYearlyReturns.get(row.year) ?? [];
            list.push(row.returnPct);
            randomYearlyReturns.set(row.year, list);
          }
          const shardKey = String(
            Math.floor((plan.accountIndex - 1) / TRADE_CSV_ACCOUNT_SHARD),
          ).padStart(2, "0");
          const bucket = randomTradeShards.get(shardKey) ?? [];
          bucket.push(...derivation.tradeRows);
          randomTradeShards.set(shardKey, bucket);
        }
        if (plan.accountIndex % 50 === 0 || plan.kind === "R") {
          progress(`group ${spec.id} account ${plan.accountIndex}/${RANDOM_ACCOUNT_COUNT} done`);
        }
      }

      const rAccount = accounts[0]!;
      const rBlock = tailRateBlockOf({
        label: "R（preReturn10 HIGH）",
        completedReturns: rCompletedReturns,
        tradeCount: rAccount.tradeCount,
        openAtEndCount: rAccount.openAtEndCount,
        fillCount: rAccount.fillCount,
        skippedIntentCount: rAccount.skippedIntentCount,
        rejectedOrderCount: rAccount.rejectedOrderCount,
        winRatePct: rAccount.winRatePct,
        maxDrawdownPct: rAccount.maxDrawdownPct,
        finalCashSharePct: rAccount.finalCashSharePct,
        averageHoldingPeriod: rAccount.averageHoldingPeriod,
        uniqueTail20AnchorCount: new Set(
          rCompletedEntries
            .filter((entry) => entry.returnPct >= TAIL_THRESHOLDS_PCT[0])
            .map((entry) => entry.anchorEventId),
        ).size,
      });
      const randomPooled = tailRateBlockOf({
        label: `pooled Random（${RANDOM_ACCOUNT_COUNT} 账户全部保留）`,
        completedReturns: randomCompletedReturns,
        tradeCount: randomTradeCounts.reduce((sum, value) => sum + value, 0),
        openAtEndCount: randomOpenCounts.reduce((sum, value) => sum + value, 0),
        fillCount: randomFills.reduce((sum, value) => sum + value, 0),
        skippedIntentCount: randomSkips.reduce((sum, value) => sum + value, 0),
        rejectedOrderCount: randomRejections.reduce((sum, value) => sum + value, 0),
        winRatePct: meanOf(randomWinRates),
        maxDrawdownPct: medianOf(randomDrawdowns),
        finalCashSharePct: medianOf(randomCashShares),
        averageHoldingPeriod: meanOf(randomHolding),
        uniqueTail20AnchorCount: null,
      });
      const difference = buildPairedDifference({
        metric: "tail20Rate",
        calendar: tradingDates,
        fromArm: clusterObservationsOf(rArmCells),
        toArm: clusterObservationsOf(randomArmCells),
        fromChainArm: clusterObservationsOf(rChainCells),
        toChainArm: clusterObservationsOf(randomChainCells),
        pointEstimate:
          rBlock.tail20Rate === null || randomPooled.tail20Rate === null
            ? null
            : rBlock.tail20Rate - randomPooled.tail20Rate,
      });

      // 年度信号分层（靶 = 实际成交尾率差；2026 需主窗口内新入场才进闸门）
      const entryYears = new Set<number>([...rYearly.keys(), ...randomYearly.keys()]);
      const yearlyTail: YearlyTailRow[] = [...entryYears].sort((left, right) => left - right).map((year) => {
        const rCell = rYearly.get(year) ?? { completed: 0, hits: 0 };
        const randomCell = randomYearly.get(year) ?? { completed: 0, hits: 0 };
        const hasMainWindowEntry = entryYearsInMainWindow.has(year);
        const inSignalGate =
          (GATE_YEARS as readonly number[]).includes(year) || (year === 2026 && hasMainWindowEntry);
        return {
          year,
          rCompletedCount: rCell.completed,
          rHit20Count: rCell.hits,
          rTail20Rate: rCell.completed === 0 ? null : rCell.hits / rCell.completed,
          randomCompletedCount: randomCell.completed,
          randomHit20Count: randomCell.hits,
          randomTail20Rate: randomCell.completed === 0 ? null : randomCell.hits / randomCell.completed,
          tail20RateDifference: tailRateDifferenceOfCounts(
            rCell.completed,
            rCell.hits,
            randomCell.completed,
            randomCell.hits,
          ),
          hasMainWindowEntry,
          inSignalGate,
          gateNote: inSignalGate
            ? "进入信号稳定性闸门（靶 = 实际成交 ≥+20% 尾率差）。"
            : `不进入闸门：${year} 年`
              + (hasMainWindowEntry ? "不在冻结闸门年度内" : "没有主决策窗口内的新入场（只可能是退出尾部）")
              + "。",
        };
      });

      const yearlyAccountReturns: YearlyAccountReturnRow[] = [
        ...new Set<number>([...rYearlyEquityReturns.keys(), ...randomYearlyReturns.keys()]),
      ]
        .sort((left, right) => left - right)
        .map((year) => {
          const randomValues = randomYearlyReturns.get(year) ?? [];
          const sortedRandom = [...randomValues].sort((left, right) => left - right);
          return {
            year,
            rReturnPct: rYearlyEquityReturns.get(year) ?? null,
            randomMeanReturnPct: meanOf(randomValues),
            randomMedianReturnPct: medianOf(randomValues),
            randomPositiveSharePct:
              randomValues.length === 0
                ? null
                : (randomValues.filter((value) => value > 0).length / randomValues.length) * 100,
            randomP25ReturnPct: quantileOf(sortedRandom, 0.25),
            randomP75ReturnPct: quantileOf(sortedRandom, 0.75),
          };
        });

      const distributionSpec: readonly {
        readonly field: string;
        readonly label: string;
        readonly unit: string;
        readonly values: readonly number[];
        readonly rValue: number | null;
      }[] = [
        { field: "totalReturnPct", label: "复合总收益", unit: "%", values: randomTotalReturns, rValue: rAccount.totalReturnPct },
        { field: "annualizedReturnPct", label: "年化收益", unit: "%", values: randomAnnualized, rValue: rAccount.annualizedReturnPct },
        { field: "maxDrawdownPct", label: "最大回撤", unit: "%", values: randomDrawdowns, rValue: rAccount.maxDrawdownPct },
        { field: "tradeCount", label: "交易笔数", unit: "笔", values: randomTradeCounts, rValue: rAccount.tradeCount },
        { field: "completedTradeCount", label: "已平仓笔数", unit: "笔", values: randomCompletedCounts, rValue: rAccount.completedTradeCount },
        { field: "winRatePct", label: "胜率", unit: "%", values: randomWinRates, rValue: rAccount.winRatePct },
        { field: "tail20Rate", label: "≥+20% 比例", unit: "%", values: randomTail20, rValue: rAccount.tail20Rate === null ? null : rAccount.tail20Rate * 100 },
        { field: "tail50Rate", label: "≥+50% 比例", unit: "%", values: randomTail50, rValue: rAccount.tail50Rate === null ? null : rAccount.tail50Rate * 100 },
        { field: "tail100Rate", label: "≥+100% 比例", unit: "%", values: randomTail100, rValue: rAccount.tail100Rate === null ? null : rAccount.tail100Rate * 100 },
        { field: "openAtEndCount", label: "期末未平仓", unit: "笔", values: randomOpenCounts, rValue: rAccount.openAtEndCount },
        { field: "skippedIntentCount", label: "被跳过意图", unit: "条", values: randomSkips, rValue: rAccount.skippedIntentCount },
        { field: "fillCount", label: "成交笔数", unit: "笔", values: randomFills, rValue: rAccount.fillCount },
      ];
      const randomDistribution: DistributionRow[] = distributionSpec.map((item) => {
        const sorted = [...item.values].sort((left, right) => left - right);
        const rValue = item.rValue;
        const belowOrEqual = rValue === null ? null : sorted.filter((value) => value <= rValue).length;
        return {
          group: spec.id,
          field: item.field,
          label: item.label,
          unit: item.unit,
          min: sorted.length === 0 ? null : sorted[0]!,
          p05: quantileOf(sorted, 0.05),
          p25: quantileOf(sorted, 0.25),
          p50: quantileOf(sorted, 0.5),
          p75: quantileOf(sorted, 0.75),
          p95: quantileOf(sorted, 0.95),
          max: sorted.length === 0 ? null : sorted[sorted.length - 1]!,
          mean: meanOf(sorted),
          rValue,
          rPercentile:
            belowOrEqual === null || sorted.length === 0 ? null : (belowOrEqual / sorted.length) * 100,
        };
      });

      const fillAge: FillAgeRow[] = [...fillAgeCells.entries()]
        .sort(([left], [right]) => left - right)
        .map(([fillRd, cell]) => ({
          group: spec.id,
          fillRd,
          fillCount: cell.fillCount,
          uniqueAnchorCount: cell.anchors.size,
          completedTradeCount: cell.returns.length,
          hit20Count: cell.returns.filter((value) => value >= TAIL_THRESHOLDS_PCT[0]).length,
          tail20Rate:
            cell.returns.length === 0
              ? null
              : cell.returns.filter((value) => value >= TAIL_THRESHOLDS_PCT[0]).length / cell.returns.length,
        }));

      const ordinals: ReentryOrdinalSummaryRow[] = [...ordinalTradeCount.keys()]
        .sort((left, right) => left - right)
        .map((ordinal) => {
          const completed = ordinalCompleted.get(ordinal) ?? 0;
          const hits = ordinalHits.get(ordinal) ?? 0;
          const returns = ordinalReturns.get(ordinal) ?? [];
          return {
            group: spec.id,
            entryOrdinal: ordinal,
            tradeCount: ordinalTradeCount.get(ordinal) ?? 0,
            completedCount: completed,
            hit20Count: hits,
            tail20Rate: completed === 0 ? null : hits / completed,
            meanReturnPct: meanOf(returns),
            medianReturnPct: medianOf(returns),
            netPnlSum: ordinalNetPnl.get(ordinal) ?? null,
            feesSum: ordinalFees.get(ordinal) ?? null,
          };
        });
      const closedChains = chainsAll.filter((chain) => chain.allClosed);
      const failedByCode: Record<string, number> = {};
      for (const [code, count] of skipCodeCounts) failedByCode[code] = count;
      const reentryAccounting: ReentryAccounting = {
        ordinals,
        filledAnchorCount: chainsAll.length,
        anchorWithAtLeastOneHit20Count: chainsAll.filter((chain) => chain.hasHit20).length,
        anchorChainNetPnlSum:
          closedChains.length === 0 ? null : closedChains.reduce((sum, chain) => sum + chain.netPnl, 0),
        anchorChainHitButNetLossCount: closedChains.filter((chain) => chain.hasHit20 && chain.netPnl < 0).length,
        failedAttemptCount: failedRows.length,
        failedAttemptsByCode: failedByCode,
        note:
          "「第 n 笔」按（账户 × 锚点事件）的**实际建仓时间序**编号；被阻断 / 未成交的尝试**不**编号。"
          + `锚点链净损益与「命中但整链净亏」只统计**全部平仓**的 ${closedChains.length} 条链`
          + `（另有 ${chainsAll.length - closedChains.length} 条含期末未平仓，单列不并入）。`,
      };

      const exclusionLedger: ExclusionLedgerRow[] = [];
      const layerNotes: Record<string, string> = {
        range: "决策日年龄落在本组确认区间之外（越界记账，不是候选）。",
        observation: "数据资格层：事件日 bar 不可用 / 当日 bar 缺失、停牌、零量。",
        pullback: "历史回撤层：到该日为止尚未出现 C_j < C_0（j ≤ d−1）。",
        support: "支撑层：支撑永久作废（首次失效与重复拒绝**分开计数**）或支撑路径不可评估。",
        score: "N 日得分层：紧邻确认日的 N 个观察日必须**每天分别** ≥3 分且可评估。",
        breakout: "突破层：收盘突破前**两日**高点（参照恒为前两日，不随 N 改变）+ 量能回升。",
        candidate: "候选层：通过全部条件并进入原始候选池。",
        signal: "信号层：因子（preReturn10）不可评估或证券身份无法解析。",
        order: "下单层：账户层意图 / 订单 / 被跳过（含再入场阻断）。",
        fill: "成交层：真实撮合成交与被拒订单。",
        exit: "退出层：退出原因分桶 + 期末未平仓。",
      };
      for (const [key, count] of [...layerCounts.entries()].sort()) {
        const [layer, code] = key.split("\u0000") as [string, string];
        exclusionLedger.push({
          group: spec.id,
          layer,
          code,
          count,
          unit:
            layer === "order" || layer === "fill" || layer === "exit"
              ? "笔 / 条（组内 201 账户合计）"
              : "锚点×决策日行",
          note: layerNotes[layer] ?? "",
        });
      }
      for (const [code, count] of [...skipCodeCounts.entries()].sort()) {
        exclusionLedger.push({
          group: spec.id,
          layer: "order",
          code: `SKIPPED__${code}`,
          count,
          unit: "条（组内 201 账户合计）",
          note: "被计划层跳过的**建仓**意图（绝不静默丢弃）。",
        });
      }
      for (const [reason, count] of [...rejectedReasonCounts.entries()].sort()) {
        exclusionLedger.push({
          group: spec.id,
          layer: "fill",
          code: `REJECTED__${reason}`,
          count,
          unit: "笔（组内 201 账户合计）",
          note: "被拒订单（含买/卖两侧）。",
        });
      }
      exclusionLedger.push({
        group: spec.id,
        layer: "fill",
        code: "FILL_AGE_UNKNOWN",
        count: fillAgeUnknownCount,
        unit: "笔（组内 201 账户合计）",
        note: "成交年龄无法从「决策日意图」反推的笔数（如实计数，不猜）。",
      });

      const coverage: CoverageAccounting = {
        group: spec.id,
        tradesTotal,
        tradesCompleted,
        tradesOpenAtEnd,
        mtmValidCount,
        noExecutionBarCount,
        suspendedCannotSellCount,
        mtmValidWithRejectedSellEvidenceCount: overlapCount,
        heldToExtendedCapCount,
        runnerBridgeExitReasonCount,
        runnerTriggerObservability: RUNNER_TRIGGER_OBSERVABILITY,
        runnerObservabilityNote: RUNNER_OBSERVABILITY_NOTE,
        requiredPostRelativeDayForFullRunner: spec.entryFillMaxRd + RUNNER_EXTEND_HOLDING_DAYS,
        physicalPostMaxRelativeDay: POST_MAX_RELATIVE_DAY,
        firstObservedTradingDate: simStartDate,
        lastObservedTradingDate: simEndDate,
        classifierNote:
          "三分类 = 实验侧**启发式**：`SUSPENDED_CANNOT_SELL`（run 级 + 证券级的卖出拒单/顺延反查）优先于 "
          + "`NO_EXECUTION_BAR`（exitPrice === null）优先于 `MTM_VALID`（正常期末 MTM）。"
          + `同时满足 MTM_VALID 语法条件与「卖不出去」证据的笔数 = ${overlapCount}（已单列，不隐藏）。`,
      };

      const verdict = judgeGroupVerdict({
        group: spec.id,
        candidateDayCount: planning.sortedDecisionDates.length,
        rBlock,
        randomBlock: randomPooled,
        difference,
        yearly: yearlyTail,
        rTotalReturnPct: rAccount.totalReturnPct,
        randomMedianTotalReturnPct: medianOf(randomTotalReturns),
        rMaxDrawdownPct: rAccount.maxDrawdownPct,
        randomMedianMaxDrawdownPct: medianOf(randomDrawdowns),
      });

      executions.set(spec.id, {
        spec,
        configSnapshotJson: firstConfigJson ?? "",
        accounts,
        rCompletedReturns,
        randomCompletedReturns,
        rCompletedEntries,
        coverage,
        ordinalRows: ordinals,
        ledgerRows,
        failedRows,
        reentryAccounting,
        exclusionLedger,
        fillAge,
        rBlock,
        randomPooled,
        difference,
        yearlyTail,
        yearlyAccountReturns,
        randomDistribution,
        rArmCells,
        randomArmCells,
        rChainCells,
        randomChainCells,
        fillCount: fillCountTotal,
        rejectedOrderCount: rejectedOrderTotal,
        skippedIntentCount: skippedIntentTotal,
        verdict,
        rTradeRows,
        randomTradeShards: [...randomTradeShards.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, shardRows]) => ({ key, rows: shardRows })),
      });
      log(
        `组 ${spec.id} 完成：账户 ${accounts.length}；R 总收益 ${rAccount.totalReturnPct ?? "—"}% / `
        + `MDD ${rAccount.maxDrawdownPct.toFixed(4)}% / 已平仓 ${rBlock.completedTradeCount}`
        + `（≥+20% ${rBlock.hit20Count}）；判定 ${verdict.verdict}`,
      );
    }

    // ── 13) 组间配对比较（唯一主要 = D_R − B_R）────────────────────────────
    const comparisonOf = (args: {
      readonly fromGroup: GroupId;
      readonly toGroup: GroupId;
      readonly classification: ComparisonClass;
      readonly label: string;
      readonly note: string;
    }): GroupComparison => {
      const from = executions.get(args.fromGroup)!;
      const to = executions.get(args.toGroup)!;
      const difference = buildPairedDifference({
        metric: "tail20Rate",
        calendar: tradingDates,
        fromArm: clusterObservationsOf(from.rArmCells),
        toArm: clusterObservationsOf(to.rArmCells),
        fromChainArm: clusterObservationsOf(from.rChainCells),
        toChainArm: clusterObservationsOf(to.rChainCells),
        pointEstimate:
          from.rBlock.tail20Rate === null || to.rBlock.tail20Rate === null
            ? null
            : from.rBlock.tail20Rate - to.rBlock.tail20Rate,
      });
      const key = `${args.fromGroup}_R − ${args.toGroup}_R`;
      const sampleGateMet =
        (from.rBlock.uniqueTail20AnchorCount ?? 0) >= 50
        && (to.rBlock.uniqueTail20AnchorCount ?? 0) >= 50
        && (difference.blockPrimary?.clusterCount ?? 0) >= 2;
      const sameDirectionYears: number[] = [];
      for (const year of GATE_YEARS) {
        const fromRow = from.yearlyTail.find((row) => row.year === year);
        const toRow = to.yearlyTail.find((row) => row.year === year);
        if (fromRow === undefined || toRow === undefined) continue;
        const yearDifference = tailRateDifferenceOfCounts(
          fromRow.rCompletedCount,
          fromRow.rHit20Count,
          toRow.rCompletedCount,
          toRow.rHit20Count,
        );
        if (yearDifference !== null && yearDifference > 0) sameDirectionYears.push(year);
      }
      const low = difference.blockPrimary?.low ?? null;
      const high = difference.blockPrimary?.high ?? null;
      const sensitivityLow = difference.blockSensitivity?.low ?? null;
      const sensitivityNotReversed = sensitivityLow === null ? null : sensitivityLow > 0;
      const supported =
        args.classification === "PRIMARY_CONFIRMATORY"
        && sampleGateMet
        && low !== null
        && low > 0
        && sensitivityNotReversed === true
        && GATE_YEARS.every((year) => sameDirectionYears.includes(year));
      const gateReason = sampleGateMet
        ? `样本门槛满足（${args.fromGroup}_R 唯一命中锚点 ${from.rBlock.uniqueTail20AnchorCount ?? 0}，`
          + `${args.toGroup}_R ${to.rBlock.uniqueTail20AnchorCount ?? 0}，`
          + `日期簇 ${difference.blockPrimary?.clusterCount ?? 0}）。`
        : `样本门槛**未**满足（${args.fromGroup}_R 唯一命中锚点 ${from.rBlock.uniqueTail20AnchorCount ?? 0}，`
          + `${args.toGroup}_R ${to.rBlock.uniqueTail20AnchorCount ?? 0}；事前要求各 ≥ 50）。`;
      return {
        key,
        label: args.label,
        fromGroup: args.fromGroup,
        toGroup: args.toGroup,
        classification: args.classification,
        difference,
        sampleGateMet,
        gateReason,
        sameDirectionYears,
        sensitivityNotReversed,
        supported,
        note:
          `${gateReason} 点估计 ${(difference.pointEstimate ?? 0).toFixed(6)}；`
          + `block${BOOTSTRAP_BLOCK_PRIMARY} 区间 `
          + `[${low === null ? "—" : low.toFixed(6)}, ${high === null ? "—" : high.toFixed(6)}]；`
          + `block${BOOTSTRAP_BLOCK_SENSITIVITY} 下界 ${sensitivityLow === null ? "—" : sensitivityLow.toFixed(6)}；`
          + `2024/2025 同靶同向年度 = ${sameDirectionYears.join(" / ") || "无"}；`
          + `零分母迭代次数 = ${difference.blockPrimary?.zeroDenominatorIterations ?? "—"}`
          + `（日历长度 ${difference.blockPrimary?.calendarLength ?? "—"}）。`
          + ` ${args.note}`,
      };
    };

    const primaryComparison = comparisonOf({
      fromGroup: "D",
      toGroup: "B",
      classification: "PRIMARY_CONFIRMATORY",
      label: "唯一主要比较：D_R − B_R（同 T+20、同允许再入场；5 日观察 vs 2 日观察）",
      note:
        "这是本轮**唯一**确认性比较；窗口效应只由同政策组比较，再入场效应由 D/E 比较。"
        + "这是探索性历史证据，不能升级为 OOS 通过。",
    });
    const secondaryComparisons: GroupComparison[] = [
      comparisonOf({
        fromGroup: "D",
        toGroup: "E",
        classification: "SECONDARY_DESCRIPTIVE",
        label: "D_R − E_R（再入场增量）",
        note:
          "D/E 的**原始买点池相同**，只在账户层用 `reentryPolicy` 区分；差异包含现金、名额与后续选择联动，"
          + "不能只加总第二次交易的利润。",
      }),
      comparisonOf({
        fromGroup: "B",
        toGroup: "A",
        classification: "SECONDARY_DESCRIPTIVE",
        label: "B_R − A_R（期限延长 T+10 → T+20）",
        note: "A 已允许再入场 ⇒ **不能**与 round-002 的一次入场结果直接相减。",
      }),
      comparisonOf({
        fromGroup: "C",
        toGroup: "B",
        classification: "SECONDARY_DESCRIPTIVE",
        label: "C_R − B_R（三日观察对照）",
        note: "描述性对照；不作为独立确认性成功判据。",
      }),
    ];

    // ── 14) 全研究收口 ────────────────────────────────────────────────────
    const executionList = [...executions.values()];
    const studyVerdict = judgeStudyVerdict({
      primary: primaryComparison,
      groups: executionList.map((execution) => ({
        group: execution.spec.id,
        tail20Rate: execution.rBlock.tail20Rate,
        totalReturnPct: execution.accounts[0]!.totalReturnPct,
        meanReturnPct: execution.rBlock.meanReturnPct,
        maxDrawdownPct: execution.accounts[0]!.maxDrawdownPct,
      })),
    });

    // ── 15) 全研究覆盖三分类（= 五组合计）────────────────────────────────
    const overallCoverage: CoverageAccounting = {
      group: "ALL",
      tradesTotal: executionList.reduce((sum, execution) => sum + execution.coverage.tradesTotal, 0),
      tradesCompleted: executionList.reduce((sum, execution) => sum + execution.coverage.tradesCompleted, 0),
      tradesOpenAtEnd: executionList.reduce((sum, execution) => sum + execution.coverage.tradesOpenAtEnd, 0),
      mtmValidCount: executionList.reduce((sum, execution) => sum + execution.coverage.mtmValidCount, 0),
      noExecutionBarCount: executionList.reduce((sum, execution) => sum + execution.coverage.noExecutionBarCount, 0),
      suspendedCannotSellCount: executionList.reduce(
        (sum, execution) => sum + execution.coverage.suspendedCannotSellCount,
        0,
      ),
      mtmValidWithRejectedSellEvidenceCount: executionList.reduce(
        (sum, execution) => sum + execution.coverage.mtmValidWithRejectedSellEvidenceCount,
        0,
      ),
      heldToExtendedCapCount: executionList.reduce(
        (sum, execution) => sum + execution.coverage.heldToExtendedCapCount,
        0,
      ),
      runnerBridgeExitReasonCount: executionList.reduce(
        (sum, execution) => sum + execution.coverage.runnerBridgeExitReasonCount,
        0,
      ),
      runnerTriggerObservability: RUNNER_TRIGGER_OBSERVABILITY,
      runnerObservabilityNote: RUNNER_OBSERVABILITY_NOTE,
      requiredPostRelativeDayForFullRunner: MAX_FILL_RD_ACROSS_GROUPS + RUNNER_EXTEND_HOLDING_DAYS,
      physicalPostMaxRelativeDay: POST_MAX_RELATIVE_DAY,
      firstObservedTradingDate: simStartDate,
      lastObservedTradingDate: simEndDate,
      classifierNote:
        "五组合计；三分类口径同各组（实验侧启发式）。"
        + `「完整跑完冻结 Runner 所需 rd」取五组最大 L（${MAX_FILL_RD_ACROSS_GROUPS}）+ ${RUNNER_EXTEND_HOLDING_DAYS}。`,
    };

    // ── 16) 逐日池汇总（供信封表）────────────────────────────────────────
    const candidateCountByDate = new Map<string, Record<string, number>>();
    for (const [groupId, planning] of planningByGroup) {
      for (const [date, list] of planning.candidatesByDate) {
        const bucket = candidateCountByDate.get(date) ?? {};
        bucket[groupId] = list.length;
        candidateCountByDate.set(date, bucket);
      }
    }
    const poolSizeByDate = new Map<string, number>();
    for (const row of pool.dailyRows as readonly DailyPoolRow[]) {
      poolSizeByDate.set(row.date, (poolSizeByDate.get(row.date) ?? 0) + 1);
    }
    const poolDailySummary = [...candidateCountByDate.keys()].sort().map((date) => ({
      date,
      poolSize: poolSizeByDate.get(date) ?? 0,
      candidateCountByGroup: candidateCountByDate.get(date) ?? {},
      rSelected: (basePlanning.rIntents.get(date) ?? []).length,
    }));

    // ── 17) 逐日观察账（**跨组共享**：四项分项与触发组标）──────────────────
    const observationLedgerByYear = new Map<number, Record<string, unknown>[]>();
    const sharedEvaluations = evaluateEarlyEntries(
      poolEvents.filter((event) => pool.pooledEventIds.has(event.eventId)),
      { observationDays: 2, entryFillMaxRd: MAX_FILL_RD_ACROSS_GROUPS },
    );
    const candidateAnchors = new Set(
      [...planningByGroup.values()].flatMap((planning) =>
        planning.candidateRows.map((row) => row.anchorEventId),
      ),
    );
    for (const event of poolEvents) {
      if (!pool.pooledEventIds.has(event.eventId)) continue;
      const evaluation = sharedEvaluations.get(event.eventId);
      if (evaluation === undefined) continue;
      const list = observationLedgerByYear.get(event.year) ?? [];
      for (const day of evaluation.observationDays) {
        if (day.relativeDay > MAX_CONFIRM_RD_ACROSS_GROUPS) continue;
        list.push({
          anchorEventId: event.eventId,
          symbol: event.symbol,
          eventDate: event.eventDate,
          relativeDay: day.relativeDay,
          tradeDate: day.tradeDate,
          support: day.flags?.support ?? null,
          shrink: day.flags?.shrink ?? null,
          lowStable: day.flags?.lowStable ?? null,
          closeImprove: day.flags?.closeImprove ?? null,
          score: day.score,
          missingReason: day.missingReason,
          supportBreached: day.supportBreached,
          triggerGroups: (triggerGroupsByEventRd.get(`${event.eventId}|${day.relativeDay}`) ?? []).join("|"),
          isCandidateAnchor: candidateAnchors.has(event.eventId),
        });
      }
      observationLedgerByYear.set(event.year, list);
    }

    // ── 18) 产物（逐行明细一律走 CSV 文件产物）────────────────────────────
    for (const execution of executionList) {
      const groupId = execution.spec.id;
      artifact({
        name: `group-${groupId}-accounts.csv`,
        role: "table",
        body: toCsv(
          [
            "group", "accountIndex", "kind", "seedIndex", "decisionDayCount", "intentCount",
            "uniqueAnchorCount", "uniqueSecurityCount", "totalReturnPct", "annualizedReturnPct",
            "maxDrawdownPct", "tradeCount", "completedTradeCount", "openAtEndCount", "winRatePct",
            "profitFactor", "averageWinPct", "averageLossPct", "tail20Count", "tail20Rate",
            "tail50Count", "tail50Rate", "tail100Count", "tail100Rate", "averageHoldingPeriod",
            "finalCashSharePct", "skippedIntentCount", "fillCount", "rejectedOrderCount",
            "reentryEntryCount", "heldToExtendedCapCount",
          ],
          execution.accounts as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `组 ${groupId} · 逐账户指标（CSV，唯一出口 canonicalMetrics）`,
        description:
          "账户 0 = R（preReturn10 HIGH）；1..200 = 固定种子随机账户（种子 = 20261010 + (accountIndex − 1)）。"
          + "全部账户级指标来自 `canonicalMetrics`；尾率 / 覆盖 / 再入场计数为实验侧从 `run.trades` 如实计数。",
      });

      artifact({
        name: `group-${groupId}-candidate-days.csv`,
        role: "table",
        body: toCsv(
          [
            "date", "anchorEventId", "symbol", "securityId", "eventAge", "confirmRd", "fillRd", "fillDate",
            "preReturn10", "triggerOrdinal", "isLaterTriggerDay",
          ],
          planningByGroup.get(groupId)!.candidateRows as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `组 ${groupId} · 原始买点候选池（CSV）`,
        description:
          "候选 = 当日锚点触发连续观察买点（**保留全部确认日**，修正 1）∧ `preReturn10` 可评估 ∧ 身份可解析。"
          + "R 与 200 个随机账户使用**完全相同**的这一池。",
      });

      artifact({
        name: `group-${groupId}-reentry-ledger.csv`,
        role: "table",
        body: toCsv(
          [
            "accountId", "group", "anchorEventId", "symbol", "entryOrdinal", "previousActualExitDate",
            "newConfirmDate", "newFillDate", "entryEquity", "targetBudget", "exitReason", "netPnl",
          ],
          execution.ledgerRows as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `组 ${groupId} · 再入场账（CSV）`,
        description:
          "每一笔**真实**建仓一行（含 `entryOrdinal` = 该账户在该锚点上的第几笔）。"
          + "`previousActualExitDate` / `newConfirmDate` / `entryEquity` 由实验侧从交易台账、权益曲线与意图日历反推；"
          + "`targetBudget` = `entryEquity` × 20%。",
      });

      artifact({
        name: `group-${groupId}-reentry-failed-attempts.csv`,
        role: "table",
        body: toCsv(
          [
            "accountId", "group", "anchorEventId", "symbol", "attemptedConfirmDate", "plannedFillDate",
            "skipCode", "reason", "priorEntryOrdinalActual", "priorActualExitDate",
          ],
          execution.failedRows as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `组 ${groupId} · 未成交 / 被阻断的建仓尝试（CSV）`,
        description:
          "来自 `run.skipped` 的**建仓**意图（绝不静默丢弃）。这些尝试**不**增加成功入场序号。"
          + "`MEMBER_ENTRY_LIMIT_REACHED` 出现在 E 组 = 同锚点第二次建仓被政策阻断。",
      });

      artifact({
        name: `group-${groupId}-exclusion-ledger.csv`,
        role: "table",
        body: toCsv(
          ["group", "layer", "code", "count", "unit", "note"],
          execution.exclusionLedger as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `组 ${groupId} · 逐层排除 / 归因账（CSV）`,
        description:
          "观察 → 历史回撤 → 支撑 → N 日得分 → 突破 → 候选 → 信号 → 下单 → 成交 → 退出。"
          + "支撑的**首次失效**（`SUPPORT_BREACHED_FIRST_INVALIDATION`）与**重复拒绝日**（`…_REPEAT`）分开计数。",
      });

      artifact({
        name: `group-${groupId}-p3-ranking-diagnostics.csv`,
        role: "table",
        body: toCsv(
          [
            "group", "candidateDayCount", "candidateRowCount", "distinctPreReturn10Count",
            "maxValueSharePct", "boundaryTieDayCount", "boundaryTieSizeMedian", "boundaryTieSizeMax",
            "tieBreakKey", "interpretation",
          ],
          [planningByGroup.get(groupId)!.rankingResolution as unknown as Record<string, unknown>],
        ),
        contentType: "text/csv",
        label: `组 ${groupId} · P3 排序分辨力诊断（CSV）`,
        description: "在**最终触发候选池**上统计：不同取值数、最大取值占比、边界并列规模、破平键。",
      });

      artifact({
        name: `group-${groupId}-fill-age-distribution.csv`,
        role: "table",
        body: toCsv(
          ["group", "fillRd", "fillCount", "uniqueAnchorCount", "completedTradeCount", "hit20Count", "tail20Rate"],
          execution.fillAge as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `组 ${groupId} · 成交年龄分布（CSV）`,
        description: "实际成交相对锚点的 rd 分布（成交年龄 = confirmRd + 1）。",
      });

      artifact({
        name: `group-${groupId}-trades-R.csv`,
        role: "table",
        body: toCsv(
          [
            "securityId", "anchorEventId", "symbol", "entryTime", "entryPrice", "exitTime", "exitPrice",
            "quantity", "returnPct", "netPnl", "fees", "holdingPeriod", "openAtEnd", "reason",
          ],
          execution.rTradeRows,
        ),
        contentType: "text/csv",
        label: `组 ${groupId} · R 账户交易台账（CSV）`,
        description: "主臂（R）的完整交易台账，逐笔可核对成交年龄、再入场与退出原因。",
      });

      for (const shard of execution.randomTradeShards) {
        artifact({
          name: `group-${groupId}-trades-random-part-${shard.key}.csv`,
          role: "table",
          body: toCsv(
            [
              "accountIndex", "seedIndex", "securityId", "anchorEventId", "symbol", "entryTime",
              "entryPrice", "exitTime", "exitPrice", "quantity", "returnPct", "netPnl", "fees",
              "holdingPeriod", "openAtEnd", "reason",
            ],
            shard.rows,
          ),
          contentType: "text/csv",
          label: `组 ${groupId} · 随机账户交易台账 part-${shard.key}（CSV）`,
          description:
            "随机账户的完整交易台账（按账户分片，避免单产物超限）。"
            + "`openAtEnd=true` ⇒ 按三分类在覆盖表里如实归类。",
        });
      }
    }

    for (const year of [...observationLedgerByYear.keys()].sort((left, right) => left - right)) {
      artifact({
        name: `observation-ledger-${year}.csv`,
        role: "table",
        body: toCsv(
          [
            "anchorEventId", "symbol", "eventDate", "relativeDay", "tradeDate", "support", "shrink",
            "lowStable", "closeImprove", "score", "missingReason", "supportBreached", "triggerGroups",
            "isCandidateAnchor",
          ],
          observationLedgerByYear.get(year)!,
        ),
        contentType: "text/csv",
        label: `逐事件逐观察日评分账 ${year}（CSV，跨组共享）`,
        description:
          "四项分项**单列存档**（避免总分掩盖路径差异）；不可评估日 `score=null` + 原因，**不打 0 分、不插值**。"
          + "`triggerGroups` 标明该 rd 是哪些组的确认日（同一份观察分对所有 N 都成立）。",
      });
    }

    artifact({
      name: "coverage-observability.csv",
      role: "table",
      body: toCsv(
        [
          "group", "tradesTotal", "tradesCompleted", "tradesOpenAtEnd", "mtmValidCount",
          "noExecutionBarCount", "suspendedCannotSellCount", "mtmValidWithRejectedSellEvidenceCount",
          "heldToExtendedCapCount", "runnerBridgeExitReasonCount", "runnerTriggerObservability",
          "requiredPostRelativeDayForFullRunner", "physicalPostMaxRelativeDay", "firstObservedTradingDate",
          "lastObservedTradingDate",
        ],
        [...executionList.map((execution) => ({ ...execution.coverage })), { ...overallCoverage }] as unknown as
          Record<string, unknown>[],
      ),
      contentType: "text/csv",
      label: "数据覆盖与可观测性（CSV，修正 6 + 修正 7）",
      description: "三分类 = 实验侧**启发式**；Runner 触发与否**不可观测** ⇒ 只报「持有到 74 日」的笔数。",
    });

    artifact({
      name: "pool-daily-summary.csv",
      role: "table",
      body: toCsv(
        ["date", "poolSize", "candidateA", "candidateB", "candidateC", "candidateD", "candidateE", "rSelected"],
        poolDailySummary.map((row) => ({
          date: row.date,
          poolSize: row.poolSize,
          candidateA: row.candidateCountByGroup.A ?? 0,
          candidateB: row.candidateCountByGroup.B ?? 0,
          candidateC: row.candidateCountByGroup.C ?? 0,
          candidateD: row.candidateCountByGroup.D ?? 0,
          candidateE: row.candidateCountByGroup.E ?? 0,
          rSelected: row.rSelected,
        })),
      ),
      contentType: "text/csv",
      label: "逐日池与各组候选数（CSV）",
      description: "五组共享同一份滚动池投影（rd1..40 锚点规则），只有 N/L 不同 ⇒ 候选数自然不同。",
    });

    artifact({
      name: "paired-bootstrap.csv",
      role: "table",
      body: toCsv(
        [
          "comparison", "classification", "variant", "pointEstimate", "low", "high", "clusterCount",
          "zeroDenominatorIterations", "ignoredObservationCount", "calendarLength", "blockLength", "seed",
        ],
        [
          ...executionList.flatMap((execution) =>
            bootstrapCsvRowsFor({
              key: `${execution.spec.id}_R − ${execution.spec.id}_Random`,
              classification: "SECONDARY_DESCRIPTIVE",
              pointEstimate: execution.difference.pointEstimate,
              difference: execution.difference,
            }),
          ),
          ...bootstrapCsvRowsFor({
            key: primaryComparison.key,
            classification: primaryComparison.classification,
            pointEstimate: primaryComparison.difference.pointEstimate,
            difference: primaryComparison.difference,
          }),
          ...secondaryComparisons.flatMap((comparison) =>
            bootstrapCsvRowsFor({
              key: comparison.key,
              classification: comparison.classification,
              pointEstimate: comparison.difference.pointEstimate,
              difference: comparison.difference,
            }),
          ),
        ],
      ),
      contentType: "text/csv",
      label: "配对日期块 bootstrap（CSV，修正 8）",
      description:
        "全部比较臂共享同一组交易日块索引；block20 主 / block40 敏感性 / 锚点链敏感性 / 配对均值差。"
        + "固定 1000 次、95% 双侧、种子 20261010 / 20261011。",
    });

    artifact({
      name: "frozen-config.json",
      role: "artifact",
      body: JSON.stringify(
        {
          computationVersion: COMPUTATION_VERSION,
          experimentId: context.descriptor.id,
          codeDigest: context.codeDigest,
          sourceRunBuilderVersion: SOURCE_RUN_BUILDER_VERSION,
          dataset: {
            datasetVersionId: facts.datasetVersionId,
            datasetVersionLabel: facts.datasetVersionLabel,
            datasetCode: FROZEN_DATASET_CODE,
            datasetStatusCode: facts.status,
            declaredEventCount: facts.totalEvents ?? null,
            referenceDatasetVersionId: FROZEN_DATASET_VERSION_ID_REFERENCE,
          },
          mainWindow: MAIN_WINDOW,
          executionProjectionWindow: { startDate: simStartDate, endDate: simEndDate },
          executionProjection: {
            securityCount: involvedSecurityIds.size,
            rowCount: rows.length,
            tradingDayCount: tradingDates.length,
            amountAvailableRowCount: amountRowCount,
          },
          positionFraction: POSITION_FRACTION,
          maxPositions: MAX_POSITIONS,
          maxDailyBuys: MAX_DAILY_BUYS,
          initialCapital: INITIAL_CAPITAL,
          dailyTopK: DAILY_TOP_K,
          randomAccountCount: RANDOM_ACCOUNT_COUNT,
          randomSeedIndexBase: RANDOM_SEED_INDEX_BASE,
          accountsPerGroup: ACCOUNTS_PER_GROUP,
          totalAccountCount: TOTAL_ACCOUNT_COUNT,
          frozenStrategy: { ...FROZEN_STRATEGY_REFERENCE },
          runnerBridge,
          executionContract: {
            identityConvention: "sec_<uuid>::event:<symbol>@<tradeDate>",
            baseSecurityIdConvention: "sec_<uuid>",
            sameStockConcurrency:
              "ReentryPolicy.maxConcurrentOpenPerCode = 1（panelCodeOf 把事件作用域身份剥回 symbol）",
            memberEntryLimit:
              "ReentryPolicy.maxEntriesPerMember（E = 1；键 = 事件作用域 securityId = 锚点事件）",
            runnerTriggerObservability: RUNNER_TRIGGER_OBSERVABILITY,
          },
          bootstrap: {
            iterations: BOOTSTRAP_ITERATIONS,
            blockPrimary: BOOTSTRAP_BLOCK_PRIMARY,
            blockSensitivity: BOOTSTRAP_BLOCK_SENSITIVITY,
            seedPrimary: BOOTSTRAP_SEED_PRIMARY,
            seedSensitivity: BOOTSTRAP_SEED_SENSITIVITY,
            quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
            clusterKey: "真实入场日；敏感性另按「整条锚点链的首笔入场日」",
          },
          groups: GROUPS.map((group) => ({
            id: group.id,
            observationDays: group.observationDays,
            entryFillMaxRd: group.entryFillMaxRd,
            confirmMinRd: group.confirmMinRd,
            confirmMaxRd: group.confirmMaxRd,
            reentryKind: group.reentryKind,
            reentryPolicy: group.reentryPolicy,
            candidateRowCount: planningByGroup.get(group.id)?.candidateRows.length ?? 0,
            candidateDayCount: planningByGroup.get(group.id)?.sortedDecisionDates.length ?? 0,
            fillRdViolationCount:
              planningByGroup.get(group.id)?.boundary.fillRdViolationCount ?? 0,
            configSnapshot: executions.get(group.id)?.configSnapshotJson ?? null,
          })),
          entryRule: {
            supportRatio: SUPPORT_RATIO,
            shrinkRatio: SHRINK_RATIO,
            observationMinScore: 3,
            breakoutReference: "前两日高点（不随 N 改变）",
          },
          scannedEventCount,
          pooledEventCount: pool.pooledEventIds.size,
          anchorSwitchCount: pool.anchorSwitchCount,
          poolDecisionDateCount: pool.decisionDates.length,
          barValueConflictCount,
          fillDayCalendarMismatchCount,
          groupDiagnostics: Object.fromEntries(
            [...planningByGroup.entries()].map(([groupId, planning]) => [groupId, planning.diagnostics]),
          ),
          unresolvedIdentityEventCount: identity.unresolvedEventIds.length,
        },
        null,
        2,
      ),
      contentType: "application/json",
      label: "冻结配置与坐标（JSON）",
      description: "本 Run 的固定配置、Dataset 坐标、执行投影规模、协议指纹与全部边界断言计数。",
    });

    // ── 19) 信封 ─────────────────────────────────────────────────────
    const output: ObservationWindowComputeOutput = {
      scannedEventCount,
      eligibleEventCount: pool.pooledEventIds.size,
      excludedByReason,
      datasetDeclaredEventCount: facts.totalEvents,
      unresolvedIdentityEventCount: identity.unresolvedEventIds.length,
      poolDecisionDateCount: pool.decisionDates.length,
      anchorSwitchCount: pool.anchorSwitchCount,
      executionRowCount: rows.length,
      executionSecurityCount: involvedSecurityIds.size,
      tradingDayCount: tradingDates.length,
      tradingDayCalendarFirst: simStartDate,
      tradingDayCalendarLast: simEndDate,
      barValueConflictCount,
      fillDayCalendarMismatchCount,
      groups: groupsToComputeOutputs(executionList, planningByGroup),
      primaryComparison,
      secondaryComparisons,
      studyVerdict,
      coverage: overallCoverage,
      contractGaps: OBSERVATION_WINDOW_CONTRACT_GAPS,
      coverageNotes: [
        `执行投影 [${simStartDate} ~ ${simEndDate}]（= 数据集物理末端）；交易日 ${tradingDates.length}；`
        + `事件作用域证券 ${involvedSecurityIds.size}；行 ${rows.length}（amount 有效 ${amountRowCount}）。`,
        "五组共享**一次**端口读取的滚动池（事件扫描、prefix、post 各一次）；只有 N / L / 再入场政策随组变化。",
        `账户合计 ${executionList.reduce((sum, execution) => sum + execution.accounts.length, 0)} 个`
        + `（约定 ${TOTAL_ACCOUNT_COUNT}）；每组 201 个账户共享**同一个** simulationConfig 对象（快照字节相同，运行期断言）。`,
        "修正 1：非首个确认日**保留**为候选 —— 五组合计 "
        + `${executionList.reduce(
          (sum, execution) =>
            sum + (planningByGroup.get(execution.spec.id)?.laterTriggerDayRetainedCount ?? 0),
          0,
        )} 个（round-002 会全部丢弃）。`,
        "修正 4："
        + (amountRowCount === 0
          ? "执行投影里**没有**有效 amount ⇒ 滑点回落基础值（如实披露）。"
          : `执行投影里 ${amountRowCount} 行有有效 amount ⇒ 引擎按流动性分层加成滑点（单位千元）。`),
        `修正 6：期末未平仓 ${overallCoverage.tradesOpenAtEnd} 笔中，正常期末 MTM ${overallCoverage.mtmValidCount}、`
        + `无执行 bar ${overallCoverage.noExecutionBarCount}、停牌无法卖出 ${overallCoverage.suspendedCannotSellCount}`
        + `（两类判据重叠 ${overallCoverage.mtmValidWithRejectedSellEvidenceCount} 笔，已单列）。`,
        `修正 7：Runner 可观测性 = ${RUNNER_TRIGGER_OBSERVABILITY}；只报告「持有到 ${RUNNER_EXTEND_HOLDING_DAYS} 持有日」的 `
        + `${overallCoverage.heldToExtendedCapCount} 笔，**不**据此声称 Runner 是否触发，也**未**做退出消融。`,
        "可比性披露：账户复合收益相对随机账户分布的位置属**描述性对照**，不等于通过随机种子取得市场历史独立性。",
      ],
      poolDailySummary,
    };

    return assembleObservationWindowResult({
      output,
      datasetVersionId: facts.datasetVersionId,
      datasetVersionLabel: facts.datasetVersionLabel,
    });
  },
};

/**
 * 某个（账户 × 锚点）交易链的**首笔入场日**（修正 8 的链敏感性簇键）。
 *
 * 反推规则：从该锚点的交易清单里取最早的入场日；若找不到（理论上不会发生）则回落到本笔入场日，
 * 并如实保留（不猜、不合并到别的簇）。
 */
function chainFirstEntryDateOf(
  derivation: AccountDerivation,
  anchorEventId: string,
  fallbackEntryTime: string,
): string {
  return derivation.chainFirstEntryByAnchor.get(anchorEventId) ?? fallbackEntryTime;
}

export default rollingPoolObservationWindowExperiment;
