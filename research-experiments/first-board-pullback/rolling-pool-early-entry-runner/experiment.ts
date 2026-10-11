/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` · 首板滚动池 × 连续观察买点 × preReturn10 排序 × 固定 Runner
 *
 * 规格：`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md`。
 * 规则：`docs/research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md`。
 * 执行面门禁：`docs/research/S1-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-GATE-002.md` /
 * `docs/research/S3-FIRSTBOARD-ROLLING-EARLY-ENTRY-EXECUTION-GATE-002.md`。
 *
 * ## 唯一研究问题
 *
 * 「在首板触发的滚动观察池中，股票于 **T+10 以内**触发同一条明确买点后，按 `preReturn10` HIGH 排序，
 *   能否在**固定退出政策**与**真实账户约束**下，比同批候选**随机选择**捕获更多**可实现右尾**？」
 *
 * ## 与 round-1（`rolling-pool-right-tail-mvp`）的关系
 *
 * - **复用**：入池 / 留池 rd1..40 / 锚点（同股最早未过期）/ 逐日状态账 / 因子口径 / 数据端口读取形状。
 * - **新建**：连续观察买点（`shared/rollingPoolEarlyEntry`，纯研究投影）+ 真实账户执行。
 * - **不使用**：round-1 的 `signalEligible`（它要求 `maxAmp5` 可评估 ⇒ 实际下界 rd15，
 *   照搬会让 T+10 之前的候选**恒为空**）；本轮 `maxAmp5` **完全不参与**（规则 §1）。
 *
 * ## 处理顺序（目标 §4，分层不可混淆）
 *
 * ```
 * 当日池成员（round-1 锚点，rd1..40）
 *   → 数据资格（OHLCV 完整 / 非停牌 / 非零量）            ← 只用当日及之前
 *   → 观察分 S_d（四项单列）+ 六条件触发                   ← 只用当日及之前
 *   → 因子可评估（preReturn10 缺失 ⇒ R 与 Random 共同不进入）
 *   → 原始买点候选池（两臂完全相同）
 *   → 排序（R = preReturn10 降序 + symbol/eventId 破平）或随机（200 固定种子，均匀无放回）
 *   → 账户约束（同股持仓 / 空位 / 每日名额 / 现金 / 20% 权益预算）   ← 账户层，不回流改候选池
 *   → 次一交易日开盘真实撮合（锚点 rd ≤ 10，越界即拒绝）
 * ```
 *
 * ## 🔴 身份键：真实股票身份（目标 §2「不能通过不同 eventId 绕过」）
 *
 * Dataset 端口的 `symbol` 是**代码不是身份**；身份由
 * `resolveRollingPoolSecurityIds()`（唯一解析实现）给出 canonical `sec_<uuid>`。
 * 既有约定会给每个事件拼 `::event:<code>@<date>` 后缀（`eventScopedSecurityId`），
 * **本实验刻意不使用该后缀**：`planDecisionDay` 的 `holdingSet` 按 `securityId` 判定
 * 「已持仓不加仓」，若同股两个事件用两个不同 id，同一只股票就会被**重复建仓**。
 * 因此本实验把 `securityId` 定为 canonical **base** id，并据此**按 `(tradeDate, baseSecurityId)`
 * 去重**所有执行/退出行。代价是放弃 `::event:` 消歧（同一股的重叠面板不再有独立行身份），
 * 换来的是目标 §2 要求的正确持仓身份。这一取舍在 `result.ts#contractGaps` 里如实披露。
 *
 * ## 🔴 事件级「首发优先」
 *
 * 规则库返回**全部**确认日（规则 §4 允许「未成交后重新触发再参与排名」）。但 `sourceRun`
 * 必须在**撮合之前**组装完成、拿不到成交事实 ⇒ 本轮采用**首发优先**：每个锚点只在其
 * **最早**确认日进入候选一次。这自动满足目标 §5「同一锚点最多一次成功建仓」，
 * 代价是放弃「首次未成交后的重试」（如实披露，不伪称已实现）。
 *
 * ## 🔴 数据覆盖
 *
 * 780004 物理 `post ≤ rd80`；「rd4..10 成交 + Runner 续持至 74 持有日」最远约 rd84
 * ⇒ 期末未平仓者按最后有效收盘 MTM 收尾（引擎**没有**覆盖信号）⇒ 实验侧自检
 * `openAtEnd` 与「持有期达到 Runner 续持上界」两类计数并标记 `DATA_COVERAGE_BLOCKED`
 * （目标 §6 处置 C-1：**不**缩短 74 日政策、**不**在 rd80 强制卖出、**不**剔除长持赢家）。
 *
 * ## 纪律
 *
 * - 不碰 DB（只有 `context.dataset` + 两个**服务侧唯一实现**：身份解析与数据集封装）；
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
  type MaxAmp5Computer,
  type PoolBar,
  type PoolEvent,
} from "@experiments/shared/rollingPoolRightTail";
import {
  CONFIRM_MAX_RD,
  CONFIRM_MIN_RD,
  ENTRY_FILL_MAX_RD,
  RUNNER_EXTEND_TO_HOLDING_DAYS,
  evaluateEarlyEntries,
  triggerOn,
  type EarlyEntryEvaluation,
} from "@experiments/shared/rollingPoolEarlyEntry";
import { pickUniformRandomSubset } from "@experiments/shared/singleFactor/rightTailMetrics";
import {
  DEFAULT_BOOTSTRAP_QUANTILES,
  movingBlockBootstrapDifference,
} from "@experiments/shared/dateClusterBootstrap";
import {
  EARLY_ENTRY_POSITION_FRACTION,
  FROZEN_RUNNER_STRATEGY_REFERENCE,
  baseSecurityIdOf,
  canonicalMetrics,
  computeCandidateEvaluationRunFingerprint,
  evaluateCandidateRun,
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
  BOOTSTRAP_BLOCK_PRIMARY,
  BOOTSTRAP_BLOCK_SENSITIVITY,
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  COMPUTATION_VERSION,
  DAILY_TOP_K,
  FROZEN_DATASET_POST_MAX_RELATIVE_DAY,
  FROZEN_DATASET_VERSION,
  FROZEN_STRATEGY_REFERENCE,
  INITIAL_CAPITAL,
  LEFT_TAIL_THRESHOLD_PCT,
  MAIN_WINDOW as RESULT_MAIN_WINDOW,
  MAX_DAILY_BUYS,
  MAX_POSITIONS,
  POSITION_FRACTION,
  RANDOM_ACCOUNT_COUNT,
  RANDOM_SEED_INDEX_BASE,
  RUNNER_EXTEND_HOLDING_DAYS,
  TAIL_THRESHOLDS_PCT,
  assembleEarlyEntryRunnerResult,
  earlyEntryRunnerCustomPayloadSchema,
  type AccountMetrics,
  type CandidateDayRow,
  type DataCoverageAccounting,
  type EarlyEntryComputeOutput,
  type EarlyEntryVerdict,
  type ObservationLedgerRow,
  type PairedTailDifference,
  type TailRateBlock,
  type TailSummary,
  type YearlyComparisonRow,
} from "./result";

// ---------------------------------------------------------------------------
// 冻结声明
// ---------------------------------------------------------------------------

/**
 * 事件日下界（**只为限制读取量，不改变研究范围**）。
 *
 * 主决策窗口起点 2024-01-02；买点最早在事件 rd3 确认 ⇒ 最早需要的事件日是
 * 「2024-01-02 往前 ≥ 3 个交易日」≈ 2023-12-27。这里取 **2023-11-01**
 * （≈ 40 个交易日缓冲），仍是**安全超集**：窗口外的决策日由 `buildDailyPool` 的
 * `window` 过滤，窗口内的候选不会漏。
 */
const EVENT_DATE_LOWER_BOUND = "2023-11-01";

/** 本轮需要读的 post 相对日上界（= 780004 物理上界；成交 rd4..10 + 退出尾部全长）。 */
const POST_MAX_RELATIVE_DAY = FROZEN_DATASET_POST_MAX_RELATIVE_DAY;
const POST_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: POST_MAX_RELATIVE_DAY },
  (_unused, index) => index + 1,
);

/** 执行投影的行起始日（= 主决策窗口起点；早于它的行不会被任何意图用到）。 */
const EXECUTION_ROW_START_DATE = MAIN_WINDOW.startDate;

/** 组装 sourceRun 用的 builder / rowSchema 版本（进指纹，改动即新口径）。 */
const SOURCE_RUN_BUILDER_VERSION = "early-entry-rolling-pool-002-1.0.0";

/**
 * `createdAt`：**冻结常量**，不是 `Date.now()`。
 *
 * 它只参与平台装配（策略文档 / 成本解析），不参与任何研究口径；
 * 固定它才能让同一份代码两次运行的产物**逐字节可比**。
 */
const FROZEN_CREATED_AT = "2026-10-10T00:00:00.000Z";

/** 交易账 CSV 的分片大小（账户数）—— 单账户交易可能上千笔，按账户分片保证远低于 64MB。 */
const TRADE_CSV_ACCOUNT_SHARD = 25;

/**
 * 长任务进度输出（**只写 stderr，不改变研究语义**）。
 *
 * `context.log` 只在 Run 结束时随 outcome 下发 ⇒ 长 Run 期间看不到进度。
 * 置 `EARLY_ENTRY_PROGRESS=1` 时把进度打到 stderr，由调用方落盘。
 */
function progress(message: string): void {
  if (process.env.EARLY_ENTRY_PROGRESS === "1") {
    process.stderr.write(`[early-entry-progress] ${new Date().toISOString()} ${message}\n`);
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

/** 归一化 bar（缺列 → `null`；本实验**声明**了 `volume`，因此它是真实值）。 */
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

// ---------------------------------------------------------------------------
// 输入形状
// ---------------------------------------------------------------------------

interface EventSeed {
  readonly eventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly year: number;
  readonly market: string;
  readonly boardType: string;
}

/** 一条**原始买点候选**（当日池成员 × 六条件触发 × preReturn10 可评估 × 首发优先）。 */
interface CandidateRow {
  readonly date: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  /** canonical base securityId（真实股票身份；见模块头注释）。 */
  readonly securityId: string;
  readonly eventAge: number;
  readonly confirmRd: number;
  readonly fillRd: number;
  readonly fillDate: string | null;
  readonly preReturn10: number;
}

interface AccountIntent {
  readonly securityId: string;
  readonly anchorEventId: string;
  readonly rank: number;
  readonly percentile: number;
  readonly signalValue: number;
}

interface AccountPlan {
  readonly accountIndex: number;
  readonly kind: "R" | "RANDOM";
  readonly seedIndex: number | null;
  readonly intentsByDate: ReadonlyMap<string, readonly AccountIntent[]>;
}

/**
 * 🔴 T+10 硬门禁（账户层唯一的入场期限判据；导出以便被**直接**测试）。
 *
 * 收盘确认 → 次日开盘成交 ⇒ `fillRd = confirmRd + 1`。成交最晚 `rd10`，
 * 因此确认日必须同时落在 `[CONFIRM_MIN_RD, CONFIRM_MAX_RD]` 且 `confirmRd + 1 ≤ ENTRY_FILL_MAX_RD`。
 * `false` ⇒ 该意图**一律不进入** `sourceRun`（不得靠引擎拒绝或顺延来兜底）。
 */
export function fillRdWithinCap(confirmRd: number): boolean {
  return (
    Number.isInteger(confirmRd)
    && confirmRd >= CONFIRM_MIN_RD
    && confirmRd <= CONFIRM_MAX_RD
    && confirmRd + 1 <= ENTRY_FILL_MAX_RD
  );
}

function sortPool(rows: readonly CandidateRow[]): CandidateRow[] {
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
    };
  });
}

// ---------------------------------------------------------------------------
// 交易账 / 指标辅助
// ---------------------------------------------------------------------------

interface TradeFacts {
  readonly tradeCount: number;
  readonly completedReturns: readonly number[];
  readonly completedEntries: readonly { readonly entryTime: string; readonly securityId: string; readonly returnPct: number }[];
  readonly openAtEndCount: number;
  readonly runnerExtensionReachedCount: number;
  readonly runnerExtensionReachedOpenAtEndCount: number;
  readonly maxHoldingPeriod: number | null;
}

/**
 * `DATA_COVERAGE_BLOCKED` 的判定（导出以便被**直接**测试）。
 *
 * 🔴 引擎对「行情用尽」**没有**任何信号：期末仍持仓者按最后有效收盘 MTM 收尾，
 *    看起来像正常期末持仓（S3 门禁 B）。所以这是实验侧的**唯一**自检口径：
 *    `openAtEnd === true` ⇒ 该笔的真实退出不可观测，必须单列而不是当成正常退出。
 */
export function isDataCoverageBlocked(trade: { readonly openAtEnd: boolean }): boolean {
  return trade.openAtEnd === true;
}

function collectTradeFacts(run: TradeSimulationRun): TradeFacts {
  const completedReturns: number[] = [];
  const completedEntries: { entryTime: string; securityId: string; returnPct: number }[] = [];
  let openAtEndCount = 0;
  let runnerExtensionReachedCount = 0;
  let runnerExtensionReachedOpenAtEndCount = 0;
  let maxHoldingPeriod: number | null = null;
  for (const trade of run.trades) {
    if (isDataCoverageBlocked(trade)) openAtEndCount += 1;
    const holdingPeriod = trade.holdingPeriod;
    if (typeof holdingPeriod === "number" && Number.isFinite(holdingPeriod)) {
      if (maxHoldingPeriod === null || holdingPeriod > maxHoldingPeriod) maxHoldingPeriod = holdingPeriod;
      if (holdingPeriod >= RUNNER_EXTEND_HOLDING_DAYS) {
        runnerExtensionReachedCount += 1;
        if (isDataCoverageBlocked(trade)) runnerExtensionReachedOpenAtEndCount += 1;
      }
    }
    const returnPct = trade.returnPct;
    if (!trade.openAtEnd && typeof returnPct === "number" && Number.isFinite(returnPct)) {
      completedReturns.push(returnPct);
      completedEntries.push({
        entryTime: trade.entryTime,
        securityId: trade.securityId,
        returnPct,
      });
    }
  }
  return {
    tradeCount: run.trades.length,
    completedReturns,
    completedEntries,
    openAtEndCount,
    runnerExtensionReachedCount,
    runnerExtensionReachedOpenAtEndCount,
    maxHoldingPeriod,
  };
}

function buildAccountMetrics(args: {
  readonly accountIndex: number;
  readonly kind: "R" | "RANDOM";
  readonly seedIndex: number | null;
  readonly intentCount: number;
  readonly decisionDayCount: number;
  readonly uniqueAnchorCount: number;
  readonly uniqueSecurityCount: number;
  readonly run: TradeSimulationRun;
  readonly metrics: CanonicalMetricsDetail;
  readonly facts: TradeFacts;
}): AccountMetrics {
  const { metrics, facts } = args;
  const completed = facts.completedReturns.length;
  const hit = (threshold: number): number => facts.completedReturns.filter((value) => value >= threshold).length;
  const lastPoint = args.run.equityCurve[args.run.equityCurve.length - 1];
  return {
    accountIndex: args.accountIndex,
    kind: args.kind,
    seedIndex: args.seedIndex,
    decisionDayCount: args.decisionDayCount,
    intentCount: args.intentCount,
    uniqueAnchorCount: args.uniqueAnchorCount,
    uniqueSecurityCount: args.uniqueSecurityCount,
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
    tail20Count: hit(TAIL_THRESHOLDS_PCT[0]),
    tail20Rate: completed === 0 ? null : hit(TAIL_THRESHOLDS_PCT[0]) / completed,
    tail50Count: hit(TAIL_THRESHOLDS_PCT[1]),
    tail50Rate: completed === 0 ? null : hit(TAIL_THRESHOLDS_PCT[1]) / completed,
    tail100Count: hit(TAIL_THRESHOLDS_PCT[2]),
    tail100Rate: completed === 0 ? null : hit(TAIL_THRESHOLDS_PCT[2]) / completed,
    runnerExtensionReachedCount: facts.runnerExtensionReachedCount,
    dataCoverageBlockedCount: facts.openAtEndCount,
    maxHoldingPeriod: facts.maxHoldingPeriod,
    skippedIntentCount: args.run.skipped.length,
    fillCount: args.run.executionStats.totalFills,
    rejectedOrderCount: args.run.executionStats.rejectedOrders,
    finalCashSharePct:
      lastPoint === undefined || lastPoint.equity <= 0 ? null : (lastPoint.cash / lastPoint.equity) * 100,
  };
}

function tailRateBlockOf(args: {
  readonly label: string;
  readonly completedReturns: readonly number[];
  readonly tradeCount: number;
  readonly openAtEndCount: number;
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
    uniqueTail20AnchorCount: args.uniqueTail20AnchorCount,
  };
}

/** 年度权益收益（基数 = 上一年末权益；第一个年度用初始本金）。 */
function yearlyEquityReturns(
  curve: readonly { readonly date: string; readonly equity: number }[],
  initialCapital: number,
): { readonly year: number; readonly startEquity: number; readonly endEquity: number; readonly returnPct: number }[] {
  const endEquityByYear = new Map<number, number>();
  for (const point of curve) {
    endEquityByYear.set(Number(point.date.slice(0, 4)), point.equity);
  }
  const years = [...endEquityByYear.keys()].sort((left, right) => left - right);
  const out: { year: number; startEquity: number; endEquity: number; returnPct: number }[] = [];
  let previousEnd = initialCapital;
  for (const year of years) {
    const startEquity = previousEnd;
    const endEquity = endEquityByYear.get(year)!;
    previousEnd = endEquity;
    out.push({
      year,
      startEquity,
      endEquity,
      returnPct: startEquity <= 0 ? 0 : (endEquity / startEquity - 1) * 100,
    });
  }
  return out;
}

/** 把「已平仓交易的指示序列」按**真实入场日**聚簇（分子分母同一个日期簇）。 */
function indicatorSamples(
  entries: readonly { readonly entryTime: string; readonly returnPct: number }[],
  predicate: (returnPct: number) => boolean,
): { readonly eventDate: string; readonly value: number }[] {
  return entries.map((entry) => ({
    eventDate: entry.entryTime,
    value: predicate(entry.returnPct) ? 1 : 0,
  }));
}

function valueSamples(
  entries: readonly { readonly entryTime: string; readonly returnPct: number }[],
): { readonly eventDate: string; readonly value: number }[] {
  return entries.map((entry) => ({ eventDate: entry.entryTime, value: entry.returnPct }));
}

function buildDifference(args: {
  readonly metric: string;
  readonly rSamples: readonly { readonly eventDate: string; readonly value: number }[];
  readonly randomSamples: readonly { readonly eventDate: string; readonly value: number }[];
  readonly pointEstimate: number | null;
}): PairedTailDifference {
  const primary = movingBlockBootstrapDifference({
    positive: args.rSamples,
    negative: args.randomSamples,
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_PRIMARY,
    seed: BOOTSTRAP_SEED,
    quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
  });
  const sensitivity = movingBlockBootstrapDifference({
    positive: args.rSamples,
    negative: args.randomSamples,
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_SENSITIVITY,
    seed: BOOTSTRAP_SEED + 1,
    quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
  });
  return {
    metric: args.metric,
    pointEstimate: args.pointEstimate,
    blockPrimary: primary,
    blockSensitivity: sensitivity,
  };
}

function judgeVerdict(args: {
  readonly decisionDateCount: number;
  readonly rBlock: TailRateBlock;
  readonly randomBlock: TailRateBlock;
  readonly primary: PairedTailDifference | undefined;
  readonly yearly: readonly YearlyComparisonRow[];
  readonly rTotalReturnPct: number | null;
  readonly randomMedianTotalReturnPct: number | null;
  readonly rMaxDrawdownPct: number;
  readonly randomMedianMaxDrawdownPct: number | null;
  readonly anchorFallbackCount: number;
}): EarlyEntryVerdict {
  const reasons: string[] = [];
  const uniqueTail20Anchors = args.rBlock.uniqueTail20AnchorCount ?? 0;
  if (args.decisionDateCount < 2 || args.rBlock.completedTradeCount === 0) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: [
        `决策日 ${args.decisionDateCount} 天、R 已平仓 ${args.rBlock.completedTradeCount} 笔 ⇒ 样本不足以形成任何尾部结论。`,
      ],
    };
  }
  if (uniqueTail20Anchors < 50) {
    reasons.push(
      `R 的 ≥+20% **唯一锚点**只有 ${uniqueTail20Anchors} 个（事前判据要求 ≥ 50）⇒ 命中计数不足以支撑「有排序增量」的结论。`,
    );
    return { verdict: "INSUFFICIENT_EVIDENCE", reasons };
  }

  const primary = args.primary;
  const low = primary?.blockPrimary?.low ?? null;
  const high = primary?.blockPrimary?.high ?? null;
  if (args.anchorFallbackCount > 0) {
    reasons.push(
      `有 ${args.anchorFallbackCount} 笔命中交易无法从「决策日意图」回溯到锚点，唯一锚点计数按 securityId 兜底（如实披露）。`,
    );
  }
  if (low === null || high === null) {
    reasons.push("日期簇不足 2 个 ⇒ 移动块 bootstrap 无法给出区间（不伪造区间）。");
    return { verdict: "INSUFFICIENT_EVIDENCE", reasons };
  }

  const positiveYears = args.yearly.filter(
    (row) => (row.rReturnPct ?? 0) > (row.randomMedianReturnPct ?? 0),
  ).length;
  const yearlySameDirection = args.yearly.length >= 2 && positiveYears === args.yearly.length;

  reasons.push(
    `R 已平仓 ${args.rBlock.completedTradeCount} 笔、≥+20% ${args.rBlock.hit20Count} 笔；` +
      `pooled Random 已平仓 ${args.randomBlock.completedTradeCount} 笔、≥+20% ${args.randomBlock.hit20Count} 笔。`,
  );
  reasons.push(
    `≥+20% 比例差（R − Random）= ${(primary?.pointEstimate ?? 0).toFixed(6)}，` +
      `block${BOOTSTRAP_BLOCK_PRIMARY} 95% 区间 [${low.toFixed(6)}, ${high.toFixed(6)}]。`,
  );
  reasons.push(
    `年度同向检查：${args.yearly.length} 个年度片段中 R 超过 Random 中位的有 ${positiveYears} 个。`,
  );

  if (high < 0) {
    return {
      verdict: "NO_SUPPORT",
      reasons: [...reasons, "区间整体在 0 以下 ⇒ 本配置在可实现尾率上**劣于**同日同池随机选择。"],
    };
  }
  if (low <= 0 || !yearlySameDirection) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: [
        ...reasons,
        low <= 0
          ? "区间跨 0 ⇒ 尾部增量证据不足（不等同于证明无效）。"
          : "年度片段未同向 ⇒ 不满足事前判据。",
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
      "满足事前右尾证据条件（区间下界 > 0 且年度同向）；账户层未出现「收益更差且回撤更大」的组合。" +
        "这仍**不是**可交易资格，也不是盈利承诺。",
    ],
  };
}

// ---------------------------------------------------------------------------
// 实验定义
// ---------------------------------------------------------------------------

export const rollingPoolEarlyEntryRunnerExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/rolling-pool-early-entry-runner",
    name: "首板滚动观察池 × 连续观察买点 × preReturn10 排序 × 固定 Runner",
    version: COMPUTATION_VERSION,
    description:
      "round-1 滚动观察池的**续研版本**：保留入池 / 留池 rd1..40 / 锚点规则，新增**连续观察买点**" +
      "（先回撤 → 前两个观察日各 ≥3 分 → 收盘突破确认，最晚 T+9 确认、T+10 开盘成交）；" +
      "买点触发后才按 `preReturn10` HIGH 排序（R）或同日同池同人数均匀无放回随机（200 固定种子）；" +
      "两臂都跑**真实撮合**（既有唯一 `runTradeSimulation`）、**固定退出政策**（继承 3600005 的 exit + " +
      "executionAssumptions，仓位改为统一 20% 权益比例）、指标唯一出口 `canonicalMetrics`。" +
      "`maxAmp5` **完全不参与**。这不是投资建议，也不是盈利承诺。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "rolling-pool",
      "early-entry",
      "observation-entry",
      "pre-return",
      "real-account",
      "composite-runner",
    ],
    targetMetric: {
      code: "tail20RateDifferenceVsSameDayRandomPool",
      label: "已平仓交易净收益 ≥ +20% 的比例 − 同日同池同人数 Random 的对应比例",
      rationale:
        "本轮目标是「早期买点 + 排序是否比别人多抓到可实现右尾」；账户复合总收益是少数几笔的统计量，" +
        "必须把尾部比例列为主判据，并**同时**报告账户总收益 / 回撤与随机账户分布，否则会得出方向相反的结论。",
      kind: "TAIL",
      reportMeanAlongside: true,
    },
    /**
     * `PLAN-RESEARCH-DESIGN-001` P5 —— 事前判据，**事后不得修改**（目标 §7）。
     */
    preRegisteredCriteria: {
      criteria: [
        "主右尾判据 = 已平仓交易的「净收益 ≥ +20%」比例，R 减去 pooled Random（200 账户全部保留），按**真实入场日**做日期移动块 bootstrap 的 95% 双侧区间：block20 主、block40 敏感性、固定 1000 次、固定种子。",
        "比率**不是**逐日交易比率的分位数平均：分子分母在同一个日期簇内一起重采样。",
        "≥+50% / ≥+100% 作为稀疏尾部辅助一并报告，**不挑阈值**。",
        "区间下界 > 0、年度片段（2024 / 2025）同向、且 R 有 ≥ 50 个 ≥+20% 的唯一锚点，才允许称「本轮有排序增量」。",
        "可实现尾率有正增量但账户复合总收益 / 最大回撤相对随机账户中位恶化 ⇒ 单独报告，**不得**称可交易。",
        "未平仓（`openAtEnd`）与 Runner 尾部覆盖阻断（`DATA_COVERAGE_BLOCKED`）必须单列，且**不得**因此删样本或递补候选。",
        "两臂的原始买点候选池**完全相同**；账户约束后的实际可买集合与成交笔数可以不同，原因单列（`run.skipped`）。",
      ],
      abortConditions: [
        "Dataset 不是 READY，或 `requiredDatasetVersionLabel` 不匹配 ⇒ 中止，不跑。",
        "`freezeSelection` 之前的任何 `observation()` 调用 ⇒ 结构级拒绝（平台闸门）。",
        "冻结集为空、决策日 < 2、或**没有任何买点候选** ⇒ 中止，不出结论。",
        "出现任一 `confirmRd + 1 > 10` 的意图、或任一意图在决策日缺行 ⇒ 中止（目标 §4 的 T+10 硬门禁）。",
        "冻结策略 3600005 的内容指纹不等于声明值 ⇒ 中止（拒绝在漂移的退出政策上做研究）。",
      ],
      stoppingRule:
        "只跑冻结的 R 与 200 个固定种子随机账户；主结果为负或证据不足也**正常收口**，" +
        "不追加买点、TopK、排序方向、持有期限或退出参数来补救。",
    },
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredDatasetVersionLabel: FROZEN_DATASET_VERSION,
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "market"],
        /**
         * 🔴 **首板日 rd0 的 bar 来自 `feature`（prefix）层**，观察规则的
         * `O_0`（守线锚点）与 `V_0`（缩量分母）**都读它** ⇒ `volume` **必须**在此声明。
         * 只声明在 `observation` 是不够的：`feature` 缺 `volume` ⇒ `V_0 = null`
         * ⇒ `EVENT_DAY_BAR_UNUSABLE` ⇒ 每个锚点每个观察日都不可评估 ⇒ **候选恒为 0**。
         * 这一条是 S5 预检抓到的真实缺陷（首跑 `NO_TRIGGER: 87110`），已在诊断里单列。
         */
        feature: ["open", "high", "low", "close", "preClose", "volume"],
        observation: [
          "open",
          "high",
          "low",
          "close",
          "preClose",
          // 🔴 本轮**必须**声明 volume：观察分「缩量 V_d ≤ 0.5·V_0」与「量能回升 V_d ≥ V_(d-1)」
          //    都读它；不声明 ⇒ 恒 null ⇒ 每个观察日都不可评估（ZERO_VOLUME）。
          "volume",
          "barPresent",
          "suspensionStatus",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [...PREFIX_RELATIVE_DAYS],
      postRelativeDays: [...POST_RELATIVE_DAYS],
      /**
       * 🔴 契约缺口（与 round-1 同源）：该字段是**单标量**，无法表达滚动池**逐日变化**的决策坐标。
       * 这里声明 `10` = 成交相对日的**上界**（任何一天的资格判定都不会用到 rd ≥ 11），
       * 是**上界声明**，不是逐日精确坐标。逐日坐标由内存投影表达。
       */
      decisionOffsetDays: ENTRY_FILL_MAX_RD,
      usesForwardData: true,
      forwardDataPurpose:
        "观察分、六条件触发与买点资格（rd1..9，**只用当日及之前**）；成交与退出路径（rd4..80 的真实行情）；" +
        "以及真实账户撮合的成交价与估值。未来数据只在**已冻结样本**上用于执行与结果观察，" +
        "绝不参与候选资格或排序。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/rolling-pool-early-entry-runner",
    pageTitle: "首板滚动池 × 连续观察买点 × 固定 Runner",
  },

  resultSchema: earlyEntryRunnerCustomPayloadSchema,

  async run(context: ExperimentRunContext): Promise<ExperimentResultPayload> {
    const { dataset, log, artifact, freezeSelection } = context;
    const facts = dataset.facts;

    // ── 0) 冻结配置漂移断言（本地字面量 vs 服务侧唯一导出）──────────────────
    if (POSITION_FRACTION !== EARLY_ENTRY_POSITION_FRACTION) {
      throw new Error(
        `EARLY-ENTRY-002：仓位口径漂移 —— result.ts 记 ${POSITION_FRACTION}，` +
          `服务侧唯一导出 ${EARLY_ENTRY_POSITION_FRACTION}。拒绝继续。`,
      );
    }
    if (RUNNER_EXTEND_HOLDING_DAYS !== RUNNER_EXTEND_TO_HOLDING_DAYS) {
      throw new Error(
        `EARLY-ENTRY-002：Runner 续持上界漂移 —— result.ts 记 ${RUNNER_EXTEND_HOLDING_DAYS}，` +
          `规则库 ${RUNNER_EXTEND_TO_HOLDING_DAYS}。拒绝继续。`,
      );
    }
    if (RESULT_MAIN_WINDOW.startDate !== MAIN_WINDOW.startDate || RESULT_MAIN_WINDOW.endDate !== MAIN_WINDOW.endDate) {
      throw new Error("EARLY-ENTRY-002：主决策窗口在 result.ts 与 round-1 常量之间漂移。拒绝继续。");
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
      `事件扫描：候选池 ${seeds.length} / 扫描 ${scannedEventCount}（数据集声明 ${facts.totalEvents ?? "未知"}）；` +
        `剔除 ${JSON.stringify(excludedByReason)}`,
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

    // ── 6) 因子：`preReturn10` 走既有实现；`maxAmp5` **完全不参与** ────────
    // 传一个恒返回 null 的计算器（不读任何振幅特征、不碰 Core 振幅口径）。
    const nullMaxAmp5: MaxAmp5Computer = () => null;
    const factors = deriveEventFactors(poolEvents, nullMaxAmp5);

    // ── 7) 逐日池（复用 round-1 锚点规则；窗口 = 主决策窗口）───────────────
    const pool = buildDailyPool({ events: poolEvents, factors, window: MAIN_WINDOW });
    progress(`daily pool built: rows=${pool.dailyRows.length} dates=${pool.decisionDates.length}`);
    for (const eventId of pool.pooledEventIds) wanted.delete(eventId);
    bump("NEVER_IN_WATCH_POOL", wanted.size);
    if (pool.pooledEventIds.size === 0) {
      throw new Error(
        "EARLY-ENTRY-002：冻结集为空（窗口内没有任何事件进入 rd1..40 观察池）—— 按事前中止条件停止，不出结论。",
      );
    }

    // ── 8) 连续观察买点评估（纯研究投影；只用当日及之前）─────────────────
    const evaluations = evaluateEarlyEntries(poolEvents);
    // 池决策日的下标（用于把「锚点 rd+1 的 bar 日期」与「池投影的下一决策日」对照，如实计数）。
    const poolDecisionIndex = new Map<string, number>();
    for (let index = 0; index < pool.decisionDates.length; index += 1) {
      poolDecisionIndex.set(pool.decisionDates[index]!, index);
    }

    // ── 9) 真实证券身份（**调用一次**；不按 symbol 兜底）───────────────────
    const identity = await resolveRollingPoolSecurityIds(
      seeds.map((seed) => ({ eventId: seed.eventId, symbol: seed.symbol, tradeDate: seed.eventDate })),
    );
    log(
      `身份解析：identifiers=${identity.identifierRowCount}；已解析 ${identity.securityIdByEventId.size}；` +
        `无法解析 ${identity.unresolvedEventIds.length}`,
    );

    // ── 10) 原始买点候选池（两臂完全相同）───────────────────────────────
    const identityMissCounts: Record<string, number> = {};
    const bumpIdentity = (code: string): void => {
      identityMissCounts[code] = (identityMissCounts[code] ?? 0) + 1;
    };
    let tPlusTenViolationCount = 0;
    let fillDayCalendarMismatchCount = 0;
    const candidateRows: CandidateRow[] = [];
    for (const row of pool.dailyRows) {
      const evaluation: EarlyEntryEvaluation | undefined = evaluations.get(row.anchorEventId);
      if (evaluation === undefined) {
        bumpIdentity("EVALUATION_MISSING");
        continue;
      }
      const earliest = evaluation.triggers[0];
      if (earliest === undefined) {
        // 🔴 必须把「不可评估」与「评估了但没触发」分开，否则一个系统性缺陷
        //    （例如 `V_0` 缺失导致全窗不可评估）会被 `NO_TRIGGER` 掩盖成「规则不触发」。
        bumpIdentity(`NO_TRIGGER__${evaluation.finalState}__${String(evaluation.finalReason)}`);
        continue;
      }
      const trigger = triggerOn(evaluation, row.eventAge);
      if (trigger === null) {
        // 该锚点在今天没有确认信号（含「非首个确认日」的情形）。
        bumpIdentity("NOT_TRIGGER_DAY");
        continue;
      }
      if (trigger.confirmRd !== earliest.confirmRd) {
        // 规则 §4 允许的「未成交后重试」——本轮首发优先，如实计数并跳过。
        bumpIdentity("RETRY_TRIGGER_SKIPPED");
        continue;
      }
      // 🔴 T+10 硬门禁：确认日 + 1 必须仍可成交（规则库已保证，这里再断言一次）。
      if (trigger.fillRd !== trigger.confirmRd + 1 || !fillRdWithinCap(trigger.confirmRd)) {
        tPlusTenViolationCount += 1;
        continue;
      }
      if (row.preReturn10 === null) {
        // 因子不可评估 ⇒ R 与 Random **共同**不进入（目标 §7）。
        bumpIdentity("PRE_RETURN10_MISSING");
        continue;
      }
      const canonical = identity.securityIdByEventId.get(row.anchorEventId);
      if (canonical === undefined) {
        bumpIdentity("UNRESOLVED_SECURITY_ID");
        continue;
      }
      // 🔴 真实股票身份：用 canonical base id（去 `::event:` 后缀），保证同股同键。
      const baseSecurityId = baseSecurityIdOf(canonical);
      const fillDate = trigger.fillDate;
      if (fillDate !== null) {
        const decisionIndex = poolDecisionIndex.get(row.date);
        const calendarNext =
          decisionIndex !== undefined && decisionIndex + 1 < pool.decisionDates.length
            ? pool.decisionDates[decisionIndex + 1] ?? null
            : null;
        if (calendarNext !== null && calendarNext !== fillDate) {
          // 诚实计数：锚点 rd+1 的 bar 日期 ≠ 决策日序列的下一项（决策日序列来自池投影，
          // 与全局交易日历不完全等价）。不静默、不替换。
          fillDayCalendarMismatchCount += 1;
        }
      }
      candidateRows.push({
        date: row.date,
        anchorEventId: row.anchorEventId,
        symbol: row.symbol,
        securityId: baseSecurityId,
        eventAge: row.eventAge,
        confirmRd: trigger.confirmRd,
        fillRd: trigger.fillRd,
        fillDate,
        preReturn10: row.preReturn10,
      });
    }
    candidateRows.sort(
      (left, right) =>
        left.date.localeCompare(right.date)
        || right.preReturn10 - left.preReturn10
        || left.symbol.localeCompare(right.symbol)
        || left.anchorEventId.localeCompare(right.anchorEventId),
    );
    log(
      `原始买点候选：${candidateRows.length} 行；诊断 ${JSON.stringify(identityMissCounts)}；` +
        `T+10 违规 ${tPlusTenViolationCount}；成交日日历不一致 ${fillDayCalendarMismatchCount}`,
    );
    if (tPlusTenViolationCount > 0) {
      throw new Error(
        `EARLY-ENTRY-002：出现 ${tPlusTenViolationCount} 个「确认日 + 1 > ${ENTRY_FILL_MAX_RD}」的意图` +
          "—— 违反目标 §4 的 T+10 硬门禁，中止，不出结论。",
      );
    }

    const candidatesByDate = new Map<string, CandidateRow[]>();
    for (const row of candidateRows) {
      const list = candidatesByDate.get(row.date) ?? [];
      list.push(row);
      candidatesByDate.set(row.date, list);
    }
    if (candidatesByDate.size < 2) {
      throw new Error(
        `EARLY-ENTRY-002：有买点候选的决策日只有 ${candidatesByDate.size} 天（< 2）—— 按事前中止条件停止，不出结论。`,
      );
    }
    const sortedDecisionDates = [...candidatesByDate.keys()].sort();
    for (const [date, list] of candidatesByDate) candidatesByDate.set(date, sortPool(list));

    // ── 11) 201 个账户的逐日意图（R + 200 固定种子随机）────────────────────
    const plans: AccountPlan[] = [];
    const randomDrawRows: EarlyEntryComputeOutput["randomDraws"][number][] = [];
    const randomPickCountByCandidate = new Map<string, number>();
    const candidateKey = (row: CandidateRow): string => `${row.date}|${row.anchorEventId}`;

    // 账户 0 = R：preReturn10 降序 + symbol/eventId 破平，取前 K。
    const rIntents = new Map<string, readonly AccountIntent[]>();
    for (const date of sortedDecisionDates) {
      const cells = candidatesByDate.get(date)!;
      const picked = cells.slice(0, DAILY_TOP_K);
      rIntents.set(date, toIntents(picked, cells.length));
    }
    plans.push({ accountIndex: 0, kind: "R", seedIndex: null, intentsByDate: rIntents });

    for (let drawIndex = 0; drawIndex < RANDOM_ACCOUNT_COUNT; drawIndex += 1) {
      const seedIndex = RANDOM_SEED_INDEX_BASE + drawIndex;
      const intents = new Map<string, readonly AccountIntent[]>();
      for (const date of sortedDecisionDates) {
        const cells = candidatesByDate.get(date)!;
        if (cells.length === 0) continue;
        const poolAnchorIds = cells.map((cell) => cell.anchorEventId);
        const drawn = pickUniformRandomSubset({
          eventIds: poolAnchorIds,
          topK: DAILY_TOP_K,
          seedIndex,
          date,
        });
        const byAnchor = new Map(cells.map((cell) => [cell.anchorEventId, cell]));
        const picked = drawn
          .map((eventId) => byAnchor.get(eventId))
          .filter((cell): cell is CandidateRow => cell !== undefined);
        for (const cell of picked) {
          const key = candidateKey(cell);
          randomPickCountByCandidate.set(key, (randomPickCountByCandidate.get(key) ?? 0) + 1);
        }
        intents.set(date, toIntents(picked, cells.length));
        randomDrawRows.push({
          date,
          drawIndex,
          seedIndex,
          poolSize: cells.length,
          anchorEventIds: drawn,
        });
      }
      plans.push({ accountIndex: drawIndex + 1, kind: "RANDOM", seedIndex, intentsByDate: intents });
    }

    // ── 12) 执行投影：意图涉及的证券 × 其锚点事件的完整 post 路径 ──────────
    // 行键 = (tradeDate, baseSecurityId)；同一股的重叠事件面板**共享**同一身份键。
    const involvedSecurityIds = new Set<string>();
    const rowInputByKey = new Map<string, RollingPoolExecutionRowInput>();
    let barValueConflictCount = 0;
    const orderedSeeds = [...seeds].sort(
      (left, right) => left.eventDate.localeCompare(right.eventDate) || left.eventId.localeCompare(right.eventId),
    );
    const candidatesByAnchor = new Map<string, CandidateRow[]>();
    for (const row of candidateRows) {
      const list = candidatesByAnchor.get(row.anchorEventId) ?? [];
      list.push(row);
      candidatesByAnchor.set(row.anchorEventId, list);
    }
    for (const seed of orderedSeeds) {
      const cells = candidatesByAnchor.get(seed.eventId);
      if (cells === undefined) continue;
      const securityId = cells[0]!.securityId;
      involvedSecurityIds.add(securityId);
      const post = postByEvent.get(seed.eventId);
      if (post === undefined) continue;
      for (const relativeDay of POST_RELATIVE_DAYS) {
        const bar = post.get(relativeDay);
        if (bar === undefined) continue;
        if (bar.tradeDate < EXECUTION_ROW_START_DATE) continue;
        const key = `${bar.tradeDate}\u0000${securityId}`;
        const before = rowInputByKey.get(key);
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
          // 🔴 Dataset 端口**不提供成交额** ⇒ 如实 `null`（引擎回落为基础滑点，
          //    缺少流动性分层加成）。这是契约缺口，见 customPayload.contractGaps。
          amount: null,
          barPresent: bar.barPresent,
          suspended: bar.suspended,
        };
        if (before === undefined) {
          rowInputByKey.set(key, candidate);
          continue;
        }
        // 同一 (tradeDate, baseSecurityId) 有两个事件面板给出 bar：
        // 保留 eventId 升序的第一个（上面已按 eventDate/eventId 升序处理），并如实计数差异。
        if (
          before.open !== candidate.open
          || before.high !== candidate.high
          || before.low !== candidate.low
          || before.close !== candidate.close
          || before.volume !== candidate.volume
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
        "EARLY-ENTRY-002：执行投影为空（意图涉及的证券没有任何可用 post 行）—— 中止，不出结论。",
      );
    }
    const simStartDate = tradingDates[0]!;
    const simEndDate = tradingDates[tradingDates.length - 1]!;
    const executionDataset: ResearchDataset = sealRollingPoolExecutionDataset({
      name: "early-entry-rolling-pool-002-execution-projection",
      startDate: simStartDate,
      endDate: simEndDate,
      datasetVersionId: facts.datasetVersionId,
      rows,
      tradingDates,
    });
    log(
      `执行投影：证券 ${involvedSecurityIds.size}、行 ${rows.length}、交易日 ${tradingDates.length} ` +
        `[${simStartDate} ~ ${simEndDate}]；bar 值冲突 ${barValueConflictCount}`,
    );

    // ── 13) 冻结退出政策（唯一继承物；指纹漂移即响亮失败）───────────────────
    const bundle = await loadFrozenRunnerPolicyBundle();
    if (bundle.sourceFingerprint !== FROZEN_STRATEGY_REFERENCE.fingerprint) {
      throw new Error(
        "EARLY-ENTRY-002：冻结策略指纹与 result.ts 声明不一致（服务侧读取器已断言一次，这里是二次锚点）。",
      );
    }
    const runnerBridge = runnerBridgeOf(bundle);

    // ── 14) 逐账户真实撮合：账户 0 = R（唯一一次完整装配），1..200 复用 simulationConfig ──
    const buildSourceRun = (plan: AccountPlan): CandidateEvaluationRun => {
      const dayRecords: CandidateDayRecord[] = [];
      for (const date of tradingDates) {
        const picked = plan.intentsByDate.get(date) ?? [];
        const cells = candidatesByDate.get(date) ?? [];
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
        strategyId: plan.kind === "R" ? "study-early-entry-rolling-pool-r" : "study-early-entry-rolling-pool-random",
        strategyVersion: COMPUTATION_VERSION,
        parameters: {
          accountIndex: plan.accountIndex,
          accountKind: plan.kind,
          seedIndex: plan.seedIndex ?? -1,
          dailyTopK: DAILY_TOP_K,
          positionFraction: POSITION_FRACTION,
          maxPositions: MAX_POSITIONS,
          maxDailyBuys: MAX_DAILY_BUYS,
        },
        dateRange: {
          startDate: sortedDecisionDates[0]!,
          endDate: sortedDecisionDates[sortedDecisionDates.length - 1]!,
        },
        point: "close",
        signalDescription:
          "首板滚动池（rd1..40 锚点）+ 连续观察买点（τ 回撤 → 两日各 ≥3 分 → 收盘突破 + 量能回升，rd3..9 确认、rd4..10 成交）" +
          + "；账户层按 preReturn10 HIGH 取前 3（R）或同日同池同人数均匀无放回随机（Random）。",
        featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
        rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
        selectionConfig: { method: { kind: "topN", n: DAILY_TOP_K } },
        days: dayRecords,
        evaluation,
      };
      return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
    };

    const accounts: AccountMetrics[] = [];
    const tradeFactsByAccount = new Map<number, TradeFacts>();
    const runsByAccount = new Map<number, TradeSimulationRun>();
    const tradeCsvShards = new Map<string, Record<string, unknown>[]>();
    const shardKeyOf = (accountIndex: number): string =>
      String(Math.floor((accountIndex - 1) / TRADE_CSV_ACCOUNT_SHARD)).padStart(2, "0");

    let rSimulationConfig: SimulationConfig | null = null;
    for (const plan of plans) {
      const sourceRun = buildSourceRun(plan);
      let run: TradeSimulationRun;
      if (plan.kind === "R") {
        const result = await runCompositeRunnerBacktest({
          dataset: executionDataset,
          sourceRun,
          strategyDocument: bundle.document,
          dateRange: { startDate: simStartDate, endDate: simEndDate },
          datasetVersionId: facts.datasetVersionId,
          codeVersion: COMPUTATION_VERSION,
          createdAt: FROZEN_CREATED_AT,
          name: "early-entry-rolling-pool-002-R",
          runnerBridge,
        });
        run = result.run;
        rSimulationConfig = result.simulationConfig;
      } else {
        if (rSimulationConfig === null) {
          throw new Error("EARLY-ENTRY-002：账户 0（R）未产出 simulationConfig ⇒ 无法复用装配结果。");
        }
        run = runTradeSimulation({
          dataset: executionDataset,
          sourceRun,
          simConfig: { ...rSimulationConfig, name: `early-entry-rolling-pool-002-random-${plan.accountIndex}` },
        });
      }
      const metrics = canonicalMetrics({
        equityCurve: run.equityCurve,
        tradeLedger: run.trades,
        initialCapital: run.initialCapital,
      });
      const tradeFacts = collectTradeFacts(run);
      let intentCount = 0;
      const anchors = new Set<string>();
      const securities = new Set<string>();
      for (const intents of plan.intentsByDate.values()) {
        intentCount += intents.length;
        for (const intent of intents) {
          anchors.add(intent.anchorEventId);
          securities.add(intent.securityId);
        }
      }
      const decisionDayCount = [...plan.intentsByDate.values()].filter((list) => list.length > 0).length;
      accounts.push(buildAccountMetrics({
        accountIndex: plan.accountIndex,
        kind: plan.kind,
        seedIndex: plan.seedIndex,
        intentCount,
        decisionDayCount,
        uniqueAnchorCount: anchors.size,
        uniqueSecurityCount: securities.size,
        run,
        metrics,
        facts: tradeFacts,
      }));
      tradeFactsByAccount.set(plan.accountIndex, tradeFacts);
      runsByAccount.set(plan.accountIndex, run);
      if (plan.kind === "RANDOM") {
        const shard = shardKeyOf(plan.accountIndex);
        const bucket = tradeCsvShards.get(shard) ?? [];
        for (const trade of run.trades) {
          bucket.push({
            accountIndex: plan.accountIndex,
            seedIndex: plan.seedIndex,
            securityId: trade.securityId,
            entryTime: trade.entryTime,
            entryPrice: trade.entryPrice,
            exitTime: trade.exitTime,
            exitPrice: trade.exitPrice,
            quantity: trade.quantity,
            returnPct: trade.returnPct,
            holdingPeriod: trade.holdingPeriod,
            openAtEnd: trade.openAtEnd,
            reason: trade.reason ?? null,
          });
        }
        tradeCsvShards.set(shard, bucket);
      }
      if (plan.accountIndex % 25 === 0 || plan.kind === "R") {
        progress(`account ${plan.accountIndex}/${RANDOM_ACCOUNT_COUNT} done`);
      }
    }

    const rAccount = accounts[0]!;
    const rRun = runsByAccount.get(0)!;
    const rFacts = tradeFactsByAccount.get(0)!;
    const randomAccounts = accounts.filter((account) => account.kind === "RANDOM");

    // ── 15) 尾部读数与配对差（唯一统计原语：日期移动块 bootstrap）──────────
    let anchorFallbackCount = 0;
    const anchorOfTrade = (entryTime: string, securityId: string): string => {
      const index = tradingDates.indexOf(entryTime);
      const decisionDate = index > 0 ? tradingDates[index - 1] ?? null : null;
      if (decisionDate !== null) {
        const intents = rIntents.get(decisionDate) ?? [];
        for (const intent of intents) {
          if (intent.securityId === securityId) return intent.anchorEventId;
        }
      }
      anchorFallbackCount += 1;
      return `${securityId}@${entryTime}`;
    };
    const rTail20AnchorSet = new Set(
      rFacts.completedEntries
        .filter((entry) => entry.returnPct >= TAIL_THRESHOLDS_PCT[0])
        .map((entry) => anchorOfTrade(entry.entryTime, entry.securityId)),
    );

    const pooledRandomEntries = randomAccounts.flatMap(
      (account) => tradeFactsByAccount.get(account.accountIndex)?.completedEntries ?? [],
    );
    const pooledRandomCompleted = pooledRandomEntries.map((entry) => entry.returnPct);
    const rBlock = tailRateBlockOf({
      label: "R（preReturn10 HIGH）",
      completedReturns: rFacts.completedReturns,
      tradeCount: rFacts.tradeCount,
      openAtEndCount: rFacts.openAtEndCount,
      uniqueTail20AnchorCount: rTail20AnchorSet.size,
    });
    const randomBlock = tailRateBlockOf({
      label: `pooled Random（${randomAccounts.length} 账户全部保留）`,
      completedReturns: pooledRandomCompleted,
      tradeCount: randomAccounts.reduce((sum, account) => sum + account.tradeCount, 0),
      openAtEndCount: randomAccounts.reduce((sum, account) => sum + account.openAtEndCount, 0),
      uniqueTail20AnchorCount: null,
    });
    const differences: PairedTailDifference[] = [
      buildDifference({
        metric: "tail20Rate",
        rSamples: indicatorSamples(rFacts.completedEntries, (value) => value >= TAIL_THRESHOLDS_PCT[0]),
        randomSamples: indicatorSamples(pooledRandomEntries, (value) => value >= TAIL_THRESHOLDS_PCT[0]),
        pointEstimate:
          rBlock.tail20Rate === null || randomBlock.tail20Rate === null
            ? null
            : rBlock.tail20Rate - randomBlock.tail20Rate,
      }),
      buildDifference({
        metric: "tail50Rate",
        rSamples: indicatorSamples(rFacts.completedEntries, (value) => value >= TAIL_THRESHOLDS_PCT[1]),
        randomSamples: indicatorSamples(pooledRandomEntries, (value) => value >= TAIL_THRESHOLDS_PCT[1]),
        pointEstimate:
          rBlock.tail50Rate === null || randomBlock.tail50Rate === null
            ? null
            : rBlock.tail50Rate - randomBlock.tail50Rate,
      }),
      buildDifference({
        metric: "tail100Rate",
        rSamples: indicatorSamples(rFacts.completedEntries, (value) => value >= TAIL_THRESHOLDS_PCT[2]),
        randomSamples: indicatorSamples(pooledRandomEntries, (value) => value >= TAIL_THRESHOLDS_PCT[2]),
        pointEstimate:
          rBlock.tail100Rate === null || randomBlock.tail100Rate === null
            ? null
            : rBlock.tail100Rate - randomBlock.tail100Rate,
      }),
      buildDifference({
        metric: "loss20Rate",
        rSamples: indicatorSamples(rFacts.completedEntries, (value) => value <= LEFT_TAIL_THRESHOLD_PCT),
        randomSamples: indicatorSamples(pooledRandomEntries, (value) => value <= LEFT_TAIL_THRESHOLD_PCT),
        pointEstimate:
          rBlock.loss20Rate === null || randomBlock.loss20Rate === null
            ? null
            : rBlock.loss20Rate - randomBlock.loss20Rate,
      }),
      buildDifference({
        metric: "meanReturnPct",
        rSamples: valueSamples(rFacts.completedEntries),
        randomSamples: valueSamples(pooledRandomEntries),
        pointEstimate:
          rBlock.meanReturnPct === null || randomBlock.meanReturnPct === null
            ? null
            : rBlock.meanReturnPct - randomBlock.meanReturnPct,
      }),
    ];
    const tailSummary: TailSummary = { r: rBlock, randomPooled: randomBlock, differences };

    // ── 16) 覆盖记账（`DATA_COVERAGE_BLOCKED`；引擎无此信号 ⇒ 实验侧自检）──
    const tradesTotal = accounts.reduce((sum, account) => sum + account.tradeCount, 0);
    const tradesOpenAtEnd = accounts.reduce((sum, account) => sum + account.openAtEndCount, 0);
    const runnerReached = accounts.reduce((sum, account) => sum + account.runnerExtensionReachedCount, 0);
    const runnerReachedOpenAtEnd = [...tradeFactsByAccount.values()].reduce(
      (sum, facts) => sum + facts.runnerExtensionReachedOpenAtEndCount,
      0,
    );
    const requiredPostRelativeDayForFullRunner = ENTRY_FILL_MAX_RD + RUNNER_EXTEND_HOLDING_DAYS;
    const coverage: DataCoverageAccounting = {
      tradesTotal,
      tradesOpenAtEnd,
      runnerExtensionReachedTrades: runnerReached,
      runnerExtensionReachedOpenAtEndTrades: runnerReachedOpenAtEnd,
      dataCoverageBlockedTrades: tradesOpenAtEnd,
      dataCoverageBlockedSharePct: tradesTotal === 0 ? null : (tradesOpenAtEnd / tradesTotal) * 100,
      lastObservedTradingDate: simEndDate,
      firstObservedTradingDate: simStartDate,
      physicalPostMaxRelativeDay: POST_MAX_RELATIVE_DAY,
      requiredPostRelativeDayForFullRunner,
      note:
        "引擎对「行情用尽」**没有**任何信号：期末仍持仓者按最后有效收盘 MTM 收尾，看起来像正常期末持仓。" +
        `因此这里把 openAtEnd（${tradesOpenAtEnd} 笔）单独列为 DATA_COVERAGE_BLOCKED，` +
        `并另报「持有期达到 Runner 续持上界 ${RUNNER_EXTEND_HOLDING_DAYS} 持有日」的笔数（${runnerReached} 笔）。` +
        "按目标 §6 处置 C-1：不缩短 74 日政策、不在 rd80 强制卖出、不剔除需要长持有的赢家。",
    };

    // ── 17) 年度分层 + 随机分布 + 判定 ────────────────────────────────
    const rYearly = yearlyEquityReturns(rRun.equityCurve, rRun.initialCapital);
    const yearly: YearlyComparisonRow[] = rYearly.map((row) => {
      const randomReturns = randomAccounts
        .map((account) => {
          const factsForAccount = tradeFactsByAccount.get(account.accountIndex);
          if (factsForAccount === undefined) return null;
          const curve = runsByAccount.get(account.accountIndex)?.equityCurve;
          if (curve === undefined) return null;
          const yearlyRow = yearlyEquityReturns(curve, INITIAL_CAPITAL).find((item) => item.year === row.year);
          return yearlyRow === undefined ? null : yearlyRow.returnPct;
        })
        .filter((value): value is number => value !== null);
      return {
        year: row.year,
        rReturnPct: row.returnPct,
        randomMeanReturnPct: meanOf(randomReturns),
        randomMedianReturnPct: medianOf(randomReturns),
        randomPositiveSharePct:
          randomReturns.length === 0
            ? null
            : (randomReturns.filter((value) => value > 0).length / randomReturns.length) * 100,
      };
    });

    const distributionSpec: readonly {
      readonly field: keyof AccountMetrics;
      readonly label: string;
      readonly unit: string;
      readonly scale: number;
    }[] = [
      { field: "totalReturnPct", label: "复合总收益", unit: "%", scale: 1 },
      { field: "annualizedReturnPct", label: "年化收益", unit: "%", scale: 1 },
      { field: "maxDrawdownPct", label: "最大回撤", unit: "%", scale: 1 },
      { field: "tradeCount", label: "交易笔数", unit: "笔", scale: 1 },
      { field: "completedTradeCount", label: "已平仓笔数", unit: "笔", scale: 1 },
      { field: "winRatePct", label: "胜率", unit: "%", scale: 1 },
      { field: "tail20Rate", label: "≥+20% 比例", unit: "%", scale: 100 },
      { field: "tail50Rate", label: "≥+50% 比例", unit: "%", scale: 100 },
      { field: "tail100Rate", label: "≥+100% 比例", unit: "%", scale: 100 },
      { field: "openAtEndCount", label: "期末未平仓", unit: "笔", scale: 1 },
      { field: "skippedIntentCount", label: "被跳过意图", unit: "条", scale: 1 },
      { field: "fillCount", label: "成交笔数", unit: "笔", scale: 1 },
    ];
    const randomDistribution = distributionSpec.map((spec) => {
      const rawValues: number[] = [];
      for (const account of randomAccounts) {
        const value = account[spec.field];
        if (typeof value === "number" && Number.isFinite(value)) rawValues.push(value * spec.scale);
      }
      const sorted = [...rawValues].sort((left, right) => left - right);
      const rRaw = rAccount[spec.field];
      const rValue = typeof rRaw === "number" && Number.isFinite(rRaw) ? rRaw * spec.scale : null;
      const belowOrEqual = rValue === null ? null : rawValues.filter((value) => value <= rValue).length;
      return {
        field: spec.field,
        label: spec.label,
        unit: spec.unit,
        min: sorted.length === 0 ? null : sorted[0]!,
        p05: quantileOf(sorted, 0.05),
        p25: quantileOf(sorted, 0.25),
        p50: quantileOf(sorted, 0.5),
        p75: quantileOf(sorted, 0.75),
        p95: quantileOf(sorted, 0.95),
        max: sorted.length === 0 ? null : sorted[sorted.length - 1]!,
        mean: meanOf(sorted),
        rValue,
        rPercentile: belowOrEqual === null || rawValues.length === 0 ? null : (belowOrEqual / rawValues.length) * 100,
      };
    });

    const randomTotalReturns = randomAccounts
      .map((account) => account.totalReturnPct)
      .filter((value): value is number => value !== null);
    const randomDrawdowns = randomAccounts.map((account) => account.maxDrawdownPct);
    const verdict = judgeVerdict({
      decisionDateCount: candidatesByDate.size,
      rBlock,
      randomBlock,
      primary: differences.find((difference) => difference.metric === "tail20Rate"),
      yearly,
      rTotalReturnPct: rAccount.totalReturnPct,
      randomMedianTotalReturnPct: medianOf(randomTotalReturns),
      rMaxDrawdownPct: rAccount.maxDrawdownPct,
      randomMedianMaxDrawdownPct: medianOf(randomDrawdowns),
      anchorFallbackCount,
    });
    log(
      `完成：候选 ${candidateRows.length} 行 / 决策日 ${candidatesByDate.size}；账户 ${accounts.length}；` +
        `R 总收益 ${rAccount.totalReturnPct ?? "—"}% / MDD ${rAccount.maxDrawdownPct.toFixed(4)}% / ` +
        `已平仓 ${rBlock.completedTradeCount}（≥+20% ${rBlock.hit20Count}）；判定 ${verdict.verdict}`,
    );

    // ── 18) 产物 ─────────────────────────────────────────────────────
    const randomPickCountOf = (row: CandidateRow): number =>
      randomPickCountByCandidate.get(candidateKey(row)) ?? 0;
    const candidateDays: CandidateDayRow[] = candidateRows.map((row) => {
      const rIntent = (rIntents.get(row.date) ?? []).find(
        (intent) => intent.anchorEventId === row.anchorEventId,
      );
      return {
        date: row.date,
        anchorEventId: row.anchorEventId,
        symbol: row.symbol,
        securityId: row.securityId,
        eventAge: row.eventAge,
        confirmRd: row.confirmRd,
        fillRd: row.fillRd,
        preReturn10: row.preReturn10,
        rRank: rIntent?.rank ?? null,
        selectedByR: rIntent !== undefined,
        randomPickCount: randomPickCountOf(row),
      };
    });
    artifact({
      name: "candidate-days.csv",
      role: "table",
      body: toCsv(
        [
          "date", "anchorEventId", "symbol", "securityId", "eventAge", "confirmRd", "fillRd",
          "preReturn10", "selectedByR", "rRank", "randomPickCount",
        ],
        candidateDays as unknown as Record<string, unknown>[],
      ),
      contentType: "text/csv",
      label: "原始买点候选池（CSV）",
      description:
        "两臂**完全相同**的原始买点候选池：当日锚点触发连续观察买点（且是**最早**确认日）∧ preReturn10 可评估。" +
        "`randomPickCount` = 200 次随机抽样中该候选被抽中的次数。",
    });

    // 观察分逐项账（规则 §2 要求四项单列存档）——按事件年份分片。
    const observationLedgerByYear = new Map<number, ObservationLedgerRow[]>();
    for (const seed of orderedSeeds) {
      const evaluation = evaluations.get(seed.eventId);
      if (evaluation === undefined) continue;
      const earliest = evaluation.triggers[0];
      const list = observationLedgerByYear.get(seed.year) ?? [];
      for (const day of evaluation.observationDays) {
        list.push({
          anchorEventId: seed.eventId,
          symbol: seed.symbol,
          eventDate: seed.eventDate,
          relativeDay: day.relativeDay,
          tradeDate: day.tradeDate,
          support: day.flags?.support ?? null,
          shrink: day.flags?.shrink ?? null,
          lowStable: day.flags?.lowStable ?? null,
          closeImprove: day.flags?.closeImprove ?? null,
          score: day.score,
          missingReason: day.missingReason,
          supportBreached: day.supportBreached,
          isTriggerDay:
            earliest !== undefined && evaluation.triggers.some((trigger) => trigger.confirmRd === day.relativeDay),
          isEarliestTriggerDay: earliest !== undefined && earliest.confirmRd === day.relativeDay,
        });
      }
      observationLedgerByYear.set(seed.year, list);
    }
    for (const year of [...observationLedgerByYear.keys()].sort((left, right) => left - right)) {
      const list = observationLedgerByYear.get(year)!;
      artifact({
        name: `observation-ledger-${year}.csv`,
        role: "table",
        body: toCsv(
          [
            "anchorEventId", "symbol", "eventDate", "relativeDay", "tradeDate", "support", "shrink",
            "lowStable", "closeImprove", "score", "missingReason", "supportBreached",
            "isTriggerDay", "isEarliestTriggerDay",
          ],
          list as unknown as Record<string, unknown>[],
        ),
        contentType: "text/csv",
        label: `逐事件逐观察日评分账 ${year}（CSV）`,
        description:
          "规则 §2 要求四项分项**单列存档**（避免总分掩盖路径差异）。不可评估日 `score=null` + 原因，" +
          "**不打 0 分、不插值**；停牌 / 零量日不得被当成「缩量优秀」。按事件年份分片。",
      });
      observationLedgerByYear.delete(year);
    }

    artifact({
      name: "random-draws.csv",
      role: "table",
      body: toCsv(
        ["date", "drawIndex", "seedIndex", "poolSize", "anchorEventIds"],
        randomDrawRows.map((row) => ({
          date: row.date,
          drawIndex: row.drawIndex,
          seedIndex: row.seedIndex,
          poolSize: row.poolSize,
          anchorEventIds: row.anchorEventIds.join("|"),
        })),
      ),
      contentType: "text/csv",
      label: "随机对照抽样明细（CSV）",
      description:
        `同日同池、同人数、均匀**无放回**；种子规则 = FNV-1a("uniform-random"|seedIndex|date)，` +
        `seedIndex = ${RANDOM_SEED_INDEX_BASE} + drawIndex（既有唯一原语 \`pickUniformRandomSubset\`）。` +
        "每个种子是一个**独立账户**，现金与持仓状态不共享。",
    });

    artifact({
      name: "account-metrics.csv",
      role: "table",
      body: toCsv(
        [
          "accountIndex", "kind", "seedIndex", "decisionDayCount", "intentCount", "uniqueAnchorCount",
          "uniqueSecurityCount", "totalReturnPct", "annualizedReturnPct", "maxDrawdownPct", "tradeCount",
          "completedTradeCount", "openAtEndCount", "winRatePct", "profitFactor", "averageWinPct",
          "averageLossPct", "tail20Count", "tail20Rate", "tail50Count", "tail50Rate", "tail100Count",
          "tail100Rate", "runnerExtensionReachedCount", "dataCoverageBlockedCount", "maxHoldingPeriod",
          "skippedIntentCount", "fillCount", "rejectedOrderCount", "finalCashSharePct",
        ],
        accounts as unknown as Record<string, unknown>[],
      ),
      contentType: "text/csv",
      label: "逐账户指标（CSV，唯一出口 canonicalMetrics）",
      description:
        "账户 0 = R；1..200 = 固定种子随机账户。全部账户级指标来自 `canonicalMetrics`；" +
        "尾率 / 覆盖计数为实验侧从 `run.trades` 如实计数（未平仓不进尾率分母）。",
    });

    for (const shard of [...tradeCsvShards.keys()].sort()) {
      artifact({
        name: `account-trades-part-${shard}.csv`,
        role: "table",
        body: toCsv(
          [
            "accountIndex", "seedIndex", "securityId", "entryTime", "entryPrice", "exitTime", "exitPrice",
            "quantity", "returnPct", "holdingPeriod", "openAtEnd", "reason",
          ],
          tradeCsvShards.get(shard)!,
        ),
        contentType: "text/csv",
        label: `随机账户交易台账 part-${shard}（CSV）`,
        description:
          "随机账户的完整交易台账（按账户分片，避免单产物超过 64MB）。" +
          "`openAtEnd=true` 即 `DATA_COVERAGE_BLOCKED`（期末未平仓、按最后有效收盘 MTM）。",
      });
      tradeCsvShards.delete(shard);
    }
    // R 账户单独一份（账户 0 的交易是主臂台账，便于逐笔复核）。
    artifact({
      name: "account-trades-R.csv",
      role: "table",
      body: toCsv(
        [
          "accountIndex", "seedIndex", "securityId", "entryTime", "entryPrice", "exitTime", "exitPrice",
          "quantity", "returnPct", "holdingPeriod", "openAtEnd", "reason",
        ],
        rRun.trades.map((trade) => ({
          accountIndex: 0,
          seedIndex: null,
          securityId: trade.securityId,
          entryTime: trade.entryTime,
          entryPrice: trade.entryPrice,
          exitTime: trade.exitTime,
          exitPrice: trade.exitPrice,
          quantity: trade.quantity,
          returnPct: trade.returnPct,
          holdingPeriod: trade.holdingPeriod,
          openAtEnd: trade.openAtEnd,
          reason: trade.reason ?? null,
        })),
      ),
      contentType: "text/csv",
      label: "R 账户交易台账（CSV）",
      description:
        "主臂（R）的完整交易台账。逐笔可核对「锚点 rd ≤ 10 成交」「同股不重复建仓」「退出政策生效方式」。",
    });

    artifact({
      name: "early-entry-runner-config.json",
      role: "artifact",
      body: JSON.stringify(
        {
          computationVersion: COMPUTATION_VERSION,
          experimentId: context.descriptor.id,
          codeDigest: context.codeDigest,
          sourceRunBuilderVersion: SOURCE_RUN_BUILDER_VERSION,
          datasetVersionId: facts.datasetVersionId,
          datasetVersionLabel: facts.datasetVersionLabel,
          datasetStatusCode: facts.status,
          mainWindow: MAIN_WINDOW,
          executionProjectionWindow: { startDate: simStartDate, endDate: simEndDate },
          positionFraction: POSITION_FRACTION,
          maxPositions: MAX_POSITIONS,
          maxDailyBuys: MAX_DAILY_BUYS,
          initialCapital: INITIAL_CAPITAL,
          dailyTopK: DAILY_TOP_K,
          randomAccountCount: RANDOM_ACCOUNT_COUNT,
          randomSeedIndexBase: RANDOM_SEED_INDEX_BASE,
          frozenStrategy: { ...FROZEN_STRATEGY_REFERENCE },
          runnerBridge,
          entryRule: {
            supportRatio: 0.98,
            shrinkRatio: 0.5,
            observationMinScore: 3,
            confirmMinRd: CONFIRM_MIN_RD,
            confirmMaxRd: CONFIRM_MAX_RD,
            entryFillMaxRd: ENTRY_FILL_MAX_RD,
          },
          scannedEventCount,
          pooledEventCount: pool.pooledEventIds.size,
          anchorSwitchCount: pool.anchorSwitchCount,
          decisionDateCount: pool.decisionDates.length,
          candidateRowCount: candidateRows.length,
          involvedSecurityCount: involvedSecurityIds.size,
          executionRowCount: rows.length,
          tradingDayCount: tradingDates.length,
          barValueConflictCount,
          fillDayCalendarMismatchCount,
          tPlusTenViolationCount,
          identityMissCounts,
          unresolvedIdentityEventCount: identity.unresolvedEventIds.length,
        },
        null,
        2,
      ),
      contentType: "application/json",
      label: "冻结配置与坐标（JSON）",
      description: "本 Run 的固定配置、Dataset 坐标、执行投影规模与全部边界断言计数，供复现核对。",
    });

    // ── 19) 信封 ─────────────────────────────────────────────────────
    const poolSizes = sortedDecisionDates.map((date) => (candidatesByDate.get(date) ?? []).length);
    const intentCountTotal = accounts.reduce((sum, account) => sum + account.intentCount, 0);
    const output: EarlyEntryComputeOutput = {
      scannedEventCount,
      eligibleEventCount: pool.pooledEventIds.size,
      excludedByReason,
      datasetDeclaredEventCount: facts.totalEvents,
      unresolvedIdentityEventCount: identity.unresolvedEventIds.length,
      decisionDateCount: candidatesByDate.size,
      candidateDayRowCount: candidateDays.length,
      poolSizeByDate: {
        min: poolSizes.length === 0 ? 0 : Math.min(...poolSizes),
        median: medianOf(poolSizes) ?? 0,
        max: poolSizes.length === 0 ? 0 : Math.max(...poolSizes),
      },
      accounts,
      tailSummary,
      coverage,
      yearly,
      verdict,
      candidateDays,
      randomDraws: randomDrawRows,
      randomDistribution,
      tradingDayCount: tradingDates.length,
      intentCountTotal,
      tPlusTenViolationCount,
      fillDayCalendarMismatchCount,
      entryDiagnostics: identityMissCounts,
      coverageNotes: [
        `执行投影窗口 [${simStartDate} ~ ${simEndDate}]（= 数据集物理末端）；交易日 ${tradingDates.length}；涉及证券 ${involvedSecurityIds.size}；行 ${rows.length}。`,
        `成交截止 = 锚点 rd ≤ ${ENTRY_FILL_MAX_RD}（确认日 rd ∈ [${CONFIRM_MIN_RD}, ${CONFIRM_MAX_RD}]）：本 Run 违规 ${tPlusTenViolationCount} 次。`,
        `买点诊断分布：${JSON.stringify(identityMissCounts)}。`,
        `身份无法解析的事件 ${identity.unresolvedEventIds.length} 个（响亮计数，不按代码兜底）。`,
        `同一 (tradeDate, baseSecurityId) 由两个事件面板给出的 bar 值冲突 ${barValueConflictCount} 次（保留 eventId 升序的第一个）。`,
        `成交日与「决策日序列下一项」不一致 ${fillDayCalendarMismatchCount} 次（锚点 rd+1 的 bar 日期与池投影的决策日序列不同；如实计数，不静默）。`,
        `审计：轨迹根 = 主臂 R 的 sourceRun 指纹进 TradeSimulationRun.sourceFingerprint；账户 1..200 复用 R 的 simulationConfig（唯一一次平台装配）。`,
        `成本披露：Dataset 端口不提供成交额 ⇒ 执行滑点只能走 base ${5}bps，缺少 engine 的流动性分层加成（<1 亿 +20bps 等）⇒ 相对参考 Run 6210006 成本被**系统性低估**。如实披露，不伪造 amount。`,
        "可比性披露：账户复合总收益相对随机账户分布的位置属**描述性对照**，不等于通过随机种子取得市场历史独立性。",
      ],
    };

    return assembleEarlyEntryRunnerResult({
      output,
      datasetVersionId: facts.datasetVersionId,
      datasetVersionLabel: facts.datasetVersionLabel,
    });
  },
};

export default rollingPoolEarlyEntryRunnerExperiment;
