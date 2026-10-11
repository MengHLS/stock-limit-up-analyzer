/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` · 结果结构与组装。
 *
 * | 文件 | 回答的问题 |
 * | --- | --- |
 * | `experiment.ts` | 研究什么、怎么算（元数据 + 取数 + 投影 + 买点 + 排序 + 真实撮合） |
 * | `result.ts` | 结果长什么样（自有 schema + 表格 / 统计 / 图表怎么组装） |
 *
 * 🔴 schema 与组装函数**必须同文件**：口径与产物放在一起，schema 就不可能和真实产物漂移。
 * 🔴 页面今天实际渲染的是 `GenericExperimentResult`（信封），所以关键数字必须进
 *    `tables` / `statistics` / `charts`，不能只放在 `customPayload` 里。
 * 🔴 本文件**只** import `zod` / `@shared` 类型 / `@experiments/shared/**` 纯模块 ——
 *    绝不 import `server/**` 运行时（页面会经类型引用它）。
 */

import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import {
  CONFIRM_MAX_RD,
  CONFIRM_MIN_RD,
  ENTRY_FILL_MAX_RD,
  OBSERVATION_MIN_SCORE,
  RUNNER_EXTEND_TO_HOLDING_DAYS,
  SHRINK_RATIO,
  SUPPORT_RATIO,
} from "@experiments/shared/rollingPoolEarlyEntry";
import {
  FROZEN_DATASET_VERSION_LABEL,
  FIRST_BOARD_DATASET_CODE,
  MAIN_WINDOW as ROUND1_MAIN_WINDOW,
  RANDOM_SEED_BASE,
  TOP_K,
} from "@experiments/shared/rollingPoolRightTail";

export const COMPUTATION_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// 一、冻结配置（与 `experiment.ts` 逐字段同源；此处只作**展示与断言**用）
// ---------------------------------------------------------------------------

/**
 * 主决策窗口（与 round-1 逐字一致：首板滚动池的同一窗口，不是新 OOS）。
 *
 * 这里**转发** round-1 的常量而不是重写一遍 —— 两个实验若窗口不同，结论不可比。
 */
export const MAIN_WINDOW = ROUND1_MAIN_WINDOW;

export const FROZEN_DATASET_CODE = FIRST_BOARD_DATASET_CODE;
export const FROZEN_DATASET_VERSION = FROZEN_DATASET_VERSION_LABEL;
export const FROZEN_DATASET_VERSION_ID_REFERENCE = 780_004;

/** 参考数据集物理 post 上界（`postWindowDays=80`）。 */
export const FROZEN_DATASET_POST_MAX_RELATIVE_DAY = 80;

/** 每日候选上限（人数不足**不补齐**）。 */
export const DAILY_TOP_K = TOP_K;
/** 随机对照账户数（每个种子 = 一个独立账户，现金与持仓状态不共享）。 */
export const RANDOM_ACCOUNT_COUNT = 200;
export const RANDOM_SEED_INDEX_BASE = RANDOM_SEED_BASE;

/** 账户冻结参数（来自目标 §5，逐字）。 */
export const INITIAL_CAPITAL = 100_000;
export const MAX_POSITIONS = 5;
export const MAX_DAILY_BUYS = 2;
/**
 * 统一 20% 权益比例（`server/researchExperiments/frozenRunnerExitPolicy.ts#EARLY_ENTRY_POSITION_FRACTION`）。
 *
 * 🔴 此处是**字面量副本**：`result.ts` 不得运行时 import `server/**`。
 *    `experiment.ts` 在运行期用真实导出断言两者相等（漂移即响亮失败）。
 */
export const POSITION_FRACTION = 0.2;
/** 冻结 Runner 续持上界（持有日）——同样由 `experiment.ts` 断言未漂移。 */
export const RUNNER_EXTEND_HOLDING_DAYS = RUNNER_EXTEND_TO_HOLDING_DAYS;

/** 冻结退出政策的唯一继承物坐标（目标 §5；`experiment.ts` 断言指纹未漂移）。 */
export const FROZEN_STRATEGY_REFERENCE = Object.freeze({
  strategyVersionId: 3_600_005,
  strategyId: "first-limit-pullback-3f-top3-runner-t74",
  version: "2.0.0",
  fingerprint: "f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c",
  referenceRunId: "eval-3600005-promoted-t74",
});

/** 统计口径（目标 §7）：95% 双侧、日期移动块 bootstrap、1000 次。 */
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_PRIMARY = 20;
export const BOOTSTRAP_BLOCK_SENSITIVITY = 40;
export const BOOTSTRAP_SEED = RANDOM_SEED_BASE;
export const TAIL_THRESHOLDS_PCT = [20, 50, 100] as const;
export const LEFT_TAIL_THRESHOLD_PCT = -20;

// ---------------------------------------------------------------------------
// 二、自有结构（由 `experiment.ts` 产出）
// ---------------------------------------------------------------------------

/** 单账户的 canonical 指标 + 覆盖事实（**唯一指标出口 = `canonicalMetrics`**）。 */
export interface AccountMetrics {
  readonly accountIndex: number;
  readonly kind: "R" | "RANDOM";
  /** Random 账户的固定种子序号；R 为 null。 */
  readonly seedIndex: number | null;
  /** 实际参与决策的决策日数（落在模拟窗口内且当日有意图）。 */
  readonly decisionDayCount: number;
  /** 全部 `positionIntents` 条数（账户无关的候选经过账户约束前的意图数）。 */
  readonly intentCount: number;
  readonly uniqueAnchorCount: number;
  readonly uniqueSecurityCount: number;
  readonly totalReturnPct: number | null;
  readonly annualizedReturnPct: number | null;
  readonly maxDrawdownPct: number;
  readonly tradeCount: number;
  readonly completedTradeCount: number;
  readonly openAtEndCount: number;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly averageWinPct: number | null;
  readonly averageLossPct: number | null;
  readonly tail20Count: number;
  readonly tail20Rate: number | null;
  readonly tail50Count: number;
  readonly tail50Rate: number | null;
  readonly tail100Count: number;
  readonly tail100Rate: number | null;
  /** 持有期达到 Runner 续持上界的**已平仓**笔数。 */
  readonly runnerExtensionReachedCount: number;
  /** `openAtEnd === true` 的笔数（= 数据覆盖阻断的**候选**笔，实验侧自检）。 */
  readonly dataCoverageBlockedCount: number;
  readonly maxHoldingPeriod: number | null;
  /** 被计划层跳过的意图数（= `run.skipped.length`；不静默丢弃）。 */
  readonly skippedIntentCount: number;
  readonly fillCount: number;
  readonly rejectedOrderCount: number;
  /** 期末现金占权益比例（%）。 */
  readonly finalCashSharePct: number | null;
}

/** 一组交易（R 账户 / pooled Random）的尾部与均值读数。 */
export interface TailRateBlock {
  readonly label: string;
  readonly tradeCount: number;
  readonly completedTradeCount: number;
  readonly openAtEndCount: number;
  readonly hit20Count: number;
  readonly tail20Rate: number | null;
  readonly hit50Count: number;
  readonly tail50Rate: number | null;
  readonly hit100Count: number;
  readonly tail100Rate: number | null;
  readonly loss20Count: number;
  readonly loss20Rate: number | null;
  readonly meanReturnPct: number | null;
  readonly medianReturnPct: number | null;
  /** R 独有的口径：命中 ≥+20% 的**唯一锚点**数（事前判据要用）。 */
  readonly uniqueTail20AnchorCount: number | null;
}

export interface BootstrapInterval {
  readonly low: number;
  readonly high: number;
  readonly iterations: number;
  readonly blockLength: number;
  readonly clusterCount: number;
  readonly seed: number;
}

export interface PairedTailDifference {
  readonly metric: string;
  readonly pointEstimate: number | null;
  readonly blockPrimary: BootstrapInterval | null;
  readonly blockSensitivity: BootstrapInterval | null;
}

/** 数据覆盖阻断的如实记账（目标 §6 / S3 门禁 C 的处置 C-1）。 */
export interface DataCoverageAccounting {
  readonly tradesTotal: number;
  readonly tradesOpenAtEnd: number;
  readonly runnerExtensionReachedTrades: number;
  readonly runnerExtensionReachedOpenAtEndTrades: number;
  readonly dataCoverageBlockedTrades: number;
  readonly dataCoverageBlockedSharePct: number | null;
  /** 数据集的物理末端交易日（模拟窗口终点）。 */
  readonly lastObservedTradingDate: string;
  readonly firstObservedTradingDate: string;
  /** 数据集物理 post 上界（相对日）。 */
  readonly physicalPostMaxRelativeDay: number;
  /** 完整跑完冻结 Runner 所需的最小 post 相对日（理论下界）。 */
  readonly requiredPostRelativeDayForFullRunner: number;
  readonly note: string;
}

export interface YearlyAccountReturn {
  readonly year: number;
  readonly startEquity: number;
  readonly endEquity: number;
  readonly returnPct: number;
}

export interface YearlyComparisonRow {
  readonly year: number;
  readonly rReturnPct: number | null;
  readonly randomMeanReturnPct: number | null;
  readonly randomMedianReturnPct: number | null;
  readonly randomPositiveSharePct: number | null;
}

export const RESEARCH_VERDICTS = [
  "RIGHT_TAIL_EVIDENCE",
  "RISK_TRADEOFF",
  "INSUFFICIENT_EVIDENCE",
  "NO_SUPPORT",
] as const;
export type EarlyEntryVerdictCode = (typeof RESEARCH_VERDICTS)[number];

export interface EarlyEntryVerdict {
  readonly verdict: EarlyEntryVerdictCode;
  readonly reasons: readonly string[];
}

/** 逐日候选池一行（供 CSV / 信封表）。 */
export interface CandidateDayRow {
  readonly date: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly securityId: string;
  readonly eventAge: number;
  readonly confirmRd: number;
  readonly fillRd: number;
  readonly preReturn10: number | null;
  readonly rRank: number | null;
  readonly selectedByR: boolean;
  readonly randomPickCount: number;
}

/** 逐事件逐观察日的分项账（规则 §2 要求**单列存档**）。 */
export interface ObservationLedgerRow {
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly relativeDay: number;
  readonly tradeDate: string | null;
  readonly support: 0 | 1 | null;
  readonly shrink: 0 | 1 | null;
  readonly lowStable: 0 | 1 | null;
  readonly closeImprove: 0 | 1 | null;
  readonly score: number | null;
  readonly missingReason: string | null;
  readonly supportBreached: boolean | null;
  readonly isTriggerDay: boolean;
  readonly isEarliestTriggerDay: boolean;
}

export interface TailSummary {
  readonly r: TailRateBlock;
  readonly randomPooled: TailRateBlock;
  readonly differences: readonly PairedTailDifference[];
}

/** 组装结果所需的一切（由 `experiment.ts` 产出）。 */
export interface EarlyEntryComputeOutput {
  readonly scannedEventCount: number;
  readonly eligibleEventCount: number;
  readonly excludedByReason: Readonly<Record<string, number>>;
  readonly datasetDeclaredEventCount: number | null;
  readonly unresolvedIdentityEventCount: number;
  readonly decisionDateCount: number;
  readonly candidateDayRowCount: number;
  readonly poolSizeByDate: { readonly min: number; readonly median: number; readonly max: number };
  readonly accounts: readonly AccountMetrics[];
  readonly tailSummary: TailSummary;
  readonly coverage: DataCoverageAccounting;
  readonly yearly: readonly YearlyComparisonRow[];
  readonly verdict: EarlyEntryVerdict;
  readonly candidateDays: readonly CandidateDayRow[];
  readonly randomDraws: readonly {
    readonly date: string;
    readonly drawIndex: number;
    readonly seedIndex: number;
    readonly poolSize: number;
    readonly anchorEventIds: readonly string[];
  }[];
  readonly randomDistribution: readonly {
    readonly field: string;
    readonly label: string;
    readonly unit: string;
    readonly min: number | null;
    readonly p05: number | null;
    readonly p25: number | null;
    readonly p50: number | null;
    readonly p75: number | null;
    readonly p95: number | null;
    readonly max: number | null;
    readonly mean: number | null;
    readonly rValue: number | null;
    readonly rPercentile: number | null;
  }[];
  readonly tradingDayCount: number;
  readonly intentCountTotal: number;
  readonly tPlusTenViolationCount: number;
  readonly fillDayCalendarMismatchCount: number;
  /** 买点诊断计数（未触发 / 非首发确认日 / preReturn10 缺失 / 身份未解析 …）。 */
  readonly entryDiagnostics: Readonly<Record<string, number>>;
  readonly coverageNotes: readonly string[];
}

// ---------------------------------------------------------------------------
// 三、自有 payload schema
// ---------------------------------------------------------------------------

const accountMetricsSchema = z.object({
  accountIndex: z.number().int().nonnegative(),
  kind: z.enum(["R", "RANDOM"]),
  seedIndex: z.number().int().nullable(),
  decisionDayCount: z.number().int().nonnegative(),
  intentCount: z.number().int().nonnegative(),
  uniqueAnchorCount: z.number().int().nonnegative(),
  uniqueSecurityCount: z.number().int().nonnegative(),
  totalReturnPct: z.number().nullable(),
  annualizedReturnPct: z.number().nullable(),
  maxDrawdownPct: z.number(),
  tradeCount: z.number().int().nonnegative(),
  completedTradeCount: z.number().int().nonnegative(),
  openAtEndCount: z.number().int().nonnegative(),
  winRatePct: z.number().nullable(),
  profitFactor: z.number().nullable(),
  averageWinPct: z.number().nullable(),
  averageLossPct: z.number().nullable(),
  tail20Count: z.number().int().nonnegative(),
  tail20Rate: z.number().nullable(),
  tail50Count: z.number().int().nonnegative(),
  tail50Rate: z.number().nullable(),
  tail100Count: z.number().int().nonnegative(),
  tail100Rate: z.number().nullable(),
  runnerExtensionReachedCount: z.number().int().nonnegative(),
  dataCoverageBlockedCount: z.number().int().nonnegative(),
  maxHoldingPeriod: z.number().int().nullable(),
  skippedIntentCount: z.number().int().nonnegative(),
  fillCount: z.number().int().nonnegative(),
  rejectedOrderCount: z.number().int().nonnegative(),
  finalCashSharePct: z.number().nullable(),
});

const tailRateBlockSchema = z.object({
  label: z.string().min(1),
  tradeCount: z.number().int().nonnegative(),
  completedTradeCount: z.number().int().nonnegative(),
  openAtEndCount: z.number().int().nonnegative(),
  hit20Count: z.number().int().nonnegative(),
  tail20Rate: z.number().nullable(),
  hit50Count: z.number().int().nonnegative(),
  tail50Rate: z.number().nullable(),
  hit100Count: z.number().int().nonnegative(),
  tail100Rate: z.number().nullable(),
  loss20Count: z.number().int().nonnegative(),
  loss20Rate: z.number().nullable(),
  meanReturnPct: z.number().nullable(),
  medianReturnPct: z.number().nullable(),
  uniqueTail20AnchorCount: z.number().int().nonnegative().nullable(),
});

const bootstrapIntervalSchema = z.object({
  low: z.number(),
  high: z.number(),
  iterations: z.number().int().positive(),
  blockLength: z.number().int().positive(),
  clusterCount: z.number().int().nonnegative(),
  seed: z.number().int(),
});

/** 本实验自有结果结构（进 `customPayload`；页面已渲染 `tables`，此处作机器可读副本）。 */
export const earlyEntryRunnerCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  frozenConfig: z.object({
    datasetCode: z.string().min(1),
    datasetVersionId: z.number().int().positive(),
    datasetVersionLabel: z.string().min(1),
    mainWindowStart: z.string().min(1),
    mainWindowEnd: z.string().min(1),
    positionFraction: z.number(),
    maxPositions: z.number().int().positive(),
    maxDailyBuys: z.number().int().positive(),
    initialCapital: z.number().positive(),
    dailyTopK: z.number().int().positive(),
    randomAccountCount: z.number().int().positive(),
    randomSeedIndexBase: z.number().int(),
    supportRatio: z.number(),
    shrinkRatio: z.number(),
    observationMinScore: z.number().int().nonnegative(),
    confirmMinRd: z.number().int().positive(),
    confirmMaxRd: z.number().int().positive(),
    entryFillMaxRd: z.number().int().positive(),
    runnerExtendHoldingDays: z.number().int().positive(),
    datasetPostMaxRelativeDay: z.number().int().positive(),
    strategyVersionId: z.number().int().positive(),
    strategyVersion: z.string().min(1),
    strategyFingerprint: z.string().min(1),
    referenceRunId: z.string().min(1),
    bootstrapIterations: z.number().int().positive(),
    bootstrapBlockPrimary: z.number().int().positive(),
    bootstrapBlockSensitivity: z.number().int().positive(),
  }),
  contractGaps: z.array(z.string().min(1)),
  tPlusTenViolationCount: z.number().int().nonnegative(),
  fillDayCalendarMismatchCount: z.number().int().nonnegative(),
  unresolvedIdentityEventCount: z.number().int().nonnegative(),
  decisionDateCount: z.number().int().nonnegative(),
  candidateDayRowCount: z.number().int().nonnegative(),
  tPlusTenCap: z.string().min(1),
  rAccount: accountMetricsSchema,
  tailSummary: z.object({
    r: tailRateBlockSchema,
    randomPooled: tailRateBlockSchema,
    differences: z.array(
      z.object({
        metric: z.string().min(1),
        pointEstimate: z.number().nullable(),
        blockPrimary: bootstrapIntervalSchema.nullable(),
        blockSensitivity: bootstrapIntervalSchema.nullable(),
      }),
    ),
  }),
  coverage: z.object({
    tradesTotal: z.number().int().nonnegative(),
    tradesOpenAtEnd: z.number().int().nonnegative(),
    runnerExtensionReachedTrades: z.number().int().nonnegative(),
    runnerExtensionReachedOpenAtEndTrades: z.number().int().nonnegative(),
    dataCoverageBlockedTrades: z.number().int().nonnegative(),
    dataCoverageBlockedSharePct: z.number().nullable(),
    lastObservedTradingDate: z.string().min(1),
    firstObservedTradingDate: z.string().min(1),
    physicalPostMaxRelativeDay: z.number().int().positive(),
    requiredPostRelativeDayForFullRunner: z.number().int().positive(),
    note: z.string().min(1),
  }),
  yearly: z.array(
    z.object({
      year: z.number().int(),
      rReturnPct: z.number().nullable(),
      randomMeanReturnPct: z.number().nullable(),
      randomMedianReturnPct: z.number().nullable(),
      randomPositiveSharePct: z.number().nullable(),
    }),
  ),
  verdict: z.object({
    verdict: z.enum(RESEARCH_VERDICTS),
    reasons: z.array(z.string()),
  }),
  randomDistribution: z.array(
    z.object({
      field: z.string().min(1),
      label: z.string().min(1),
      unit: z.string(),
      min: z.number().nullable(),
      p05: z.number().nullable(),
      p25: z.number().nullable(),
      p50: z.number().nullable(),
      p75: z.number().nullable(),
      p95: z.number().nullable(),
      max: z.number().nullable(),
      mean: z.number().nullable(),
      rValue: z.number().nullable(),
      rPercentile: z.number().nullable(),
    }),
  ),
});

export type EarlyEntryRunnerCustomPayload = z.infer<typeof earlyEntryRunnerCustomPayloadSchema>;

const CONTRACT_GAPS = [
  "`decisionOffsetDays` 是**单标量** ⇒ 滚动池逐日变化的决策坐标只能表达为内存投影。本实验声明 `10`（成交截止的**上界**），与 round-1 声明 `40`（资格上界）同理，是上界声明而不是逐日精确坐标。",
  "`observation(rd)` 无 `eventId` / 日期参数 ⇒ 逐日池只能从「整层 rd」投影；`freezeSelection` 一次性，冻结集 = 候选宇宙而非逐日成员。",
  "逐日 ST / 上市龄不在 Dataset 端口内 ⇒ 事件日非 ST 与上市龄 ≥ 365 自然日由**构建期**保证；逐日 ST 记 `UNAVAILABLE`，**未实现每日非 ST 控制**（不伪造）。",
  "本轮 `maxAmp5` **完全不参与**（规则 §1）：`MaxAmp5Computer` 恒返回 `null` ⇒ 逐日账里 `maxAmp5` 恒为 `null`；round-1 的 `signalEligible` 因此**恒为 false**，本实验**不使用**它，候选资格只由连续观察买点 + `preReturn10` 可评估决定。",
  "规则 §4 允许「未成交后重新触发再参与排名」，但 `sourceRun` 必须在撮合**之前**组装完成、拿不到成交事实 ⇒ 本实验采用**首发优先**口径（每个锚点只在其**最早**确认日进入候选一次）。这自动满足目标 §5「同一锚点最多一次成功建仓」，代价是放弃了「首次未成交后的重试」；如实披露，不伪称已实现重试。",
  "780004 物理 post 上界 = rd80，而「rd4..10 成交 + 冻结 Runner 续持至 74 持有日」最远约 rd84 ⇒ 期末仍有未平仓的持仓按「最后有效收盘 MTM」收尾并标记 `DATA_COVERAGE_BLOCKED`（目标 §6 处置 C-1：不缩短 74 日政策、不在 rd80 强制卖出、不剔除长持赢家）。引擎**不存在**该信号 ⇒ 由实验侧自检。",
  "真实股票身份用 canonical `sec_<uuid>`（去 `::event:` 后缀）作为 `securityId`：同一个股的两个事件面板**共享同一身份键**，从而 `planDecisionDay` 的 `holdingSet` 会阻止重复建仓（目标 §2「必须用真实股票身份，不能通过不同 eventId 绕过」）。代价是行/意图必须按 `(tradeDate, baseSecurityId)` 去重，`::event:` 消歧后缀被**刻意**放弃。",
  "`executionSurface` 保持缺省 `SINGLE_EVENT`（S3 门禁：`COMPOSITE_PORTFOLIO` provider 不可用）。本实验经零实现桥 `@experiments/compositeRunnerBridge` 调用既有唯一撮合引擎，**不新建引擎 / 指标出口 / 策略语义**。",
];

// ---------------------------------------------------------------------------
// 四、组装
// ---------------------------------------------------------------------------

function pct(value: number | null): number | null {
  return value === null ? null : value * 100;
}

function intervalColumns(): readonly {
  key: string;
  label: string;
  digits: number;
  align: "RIGHT";
}[] {
  return [
    { key: "pointEstimate", label: "点估计", digits: 6, align: "RIGHT" as const },
    { key: "low", label: "95%下界", digits: 6, align: "RIGHT" as const },
    { key: "high", label: "95%上界", digits: 6, align: "RIGHT" as const },
    { key: "dayCount", label: "日期簇数", digits: 0, align: "RIGHT" as const },
    { key: "blockLength", label: "block", digits: 0, align: "RIGHT" as const },
  ];
}

/** 组装最终结果（表格 / 统计 / 图表 / 自有结构 + 如实样本账）。 */
export function assembleEarlyEntryRunnerResult(args: {
  readonly output: EarlyEntryComputeOutput;
  readonly datasetVersionId: number;
  readonly datasetVersionLabel: string;
}): ExperimentResultPayload {
  const { output, datasetVersionId, datasetVersionLabel } = args;
  const rAccount = output.accounts[0];
  if (rAccount === undefined || rAccount.kind !== "R") {
    throw new Error("EARLY-ENTRY-002：结果组装要求 accounts[0] 是 R 账户（约定：账户 0 = R，1..200 = Random）。");
  }
  const randomAccounts = output.accounts.filter((account) => account.kind === "RANDOM");
  const excludedCount = output.scannedEventCount - output.eligibleEventCount;

  const customPayload: EarlyEntryRunnerCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    frozenConfig: {
      datasetCode: FROZEN_DATASET_CODE,
      datasetVersionId,
      datasetVersionLabel,
      mainWindowStart: MAIN_WINDOW.startDate,
      mainWindowEnd: MAIN_WINDOW.endDate,
      positionFraction: POSITION_FRACTION,
      maxPositions: MAX_POSITIONS,
      maxDailyBuys: MAX_DAILY_BUYS,
      initialCapital: INITIAL_CAPITAL,
      dailyTopK: DAILY_TOP_K,
      randomAccountCount: RANDOM_ACCOUNT_COUNT,
      randomSeedIndexBase: RANDOM_SEED_INDEX_BASE,
      supportRatio: SUPPORT_RATIO,
      shrinkRatio: SHRINK_RATIO,
      observationMinScore: OBSERVATION_MIN_SCORE,
      confirmMinRd: CONFIRM_MIN_RD,
      confirmMaxRd: CONFIRM_MAX_RD,
      entryFillMaxRd: ENTRY_FILL_MAX_RD,
      runnerExtendHoldingDays: RUNNER_EXTEND_HOLDING_DAYS,
      datasetPostMaxRelativeDay: FROZEN_DATASET_POST_MAX_RELATIVE_DAY,
      strategyVersionId: FROZEN_STRATEGY_REFERENCE.strategyVersionId,
      strategyVersion: FROZEN_STRATEGY_REFERENCE.version,
      strategyFingerprint: FROZEN_STRATEGY_REFERENCE.fingerprint,
      referenceRunId: FROZEN_STRATEGY_REFERENCE.referenceRunId,
      bootstrapIterations: BOOTSTRAP_ITERATIONS,
      bootstrapBlockPrimary: BOOTSTRAP_BLOCK_PRIMARY,
      bootstrapBlockSensitivity: BOOTSTRAP_BLOCK_SENSITIVITY,
    },
    contractGaps: [...CONTRACT_GAPS],
    tPlusTenViolationCount: output.tPlusTenViolationCount,
    fillDayCalendarMismatchCount: output.fillDayCalendarMismatchCount,
    unresolvedIdentityEventCount: output.unresolvedIdentityEventCount,
    decisionDateCount: output.decisionDateCount,
    candidateDayRowCount: output.candidateDayRowCount,
    tPlusTenCap:
      `成交相对日 rd ≤ ${ENTRY_FILL_MAX_RD}（确认日 rd ∈ [${CONFIRM_MIN_RD}, ${CONFIRM_MAX_RD}]）` +
      `；账户层另有硬断言：确认日 + 1 > ${ENTRY_FILL_MAX_RD} 的意图**一律不进入** sourceRun。`,
    rAccount,
    tailSummary: {
      r: output.tailSummary.r,
      randomPooled: output.tailSummary.randomPooled,
      differences: output.tailSummary.differences.map((difference) => ({
        metric: difference.metric,
        pointEstimate: difference.pointEstimate,
        blockPrimary: difference.blockPrimary,
        blockSensitivity: difference.blockSensitivity,
      })),
    },
    coverage: {
      tradesTotal: output.coverage.tradesTotal,
      tradesOpenAtEnd: output.coverage.tradesOpenAtEnd,
      runnerExtensionReachedTrades: output.coverage.runnerExtensionReachedTrades,
      runnerExtensionReachedOpenAtEndTrades: output.coverage.runnerExtensionReachedOpenAtEndTrades,
      dataCoverageBlockedTrades: output.coverage.dataCoverageBlockedTrades,
      dataCoverageBlockedSharePct: output.coverage.dataCoverageBlockedSharePct,
      lastObservedTradingDate: output.coverage.lastObservedTradingDate,
      firstObservedTradingDate: output.coverage.firstObservedTradingDate,
      physicalPostMaxRelativeDay: output.coverage.physicalPostMaxRelativeDay,
      requiredPostRelativeDayForFullRunner: output.coverage.requiredPostRelativeDayForFullRunner,
      note: output.coverage.note,
    },
    yearly: output.yearly.map((row) => ({ ...row })),
    verdict: { verdict: output.verdict.verdict, reasons: [...output.verdict.reasons] },
    randomDistribution: output.randomDistribution.map((row) => ({ ...row })),
  };

  // ---- 表 1：账户总览（R vs 200 Random 分布）-----------------------------
  const accountSummaryTable = {
    key: "early-entry-account-summary",
    title: "R 账户 vs 200 个固定种子随机账户（真实撮合 + canonical 指标）",
    description:
      "账户 0 = R（preReturn10 HIGH）；账户 1..200 = 同日同池同人数均匀无放回随机（各自独立现金与持仓）。" +
      "全部数字来自唯一指标出口 `canonicalMetrics`；随机账户的离散度必须与 R 并列读，不能只挑最好/最差。",
    columns: [
      { key: "account", label: "账户", align: "LEFT" as const },
      { key: "seedIndex", label: "种子序号", align: "RIGHT" as const },
      { key: "totalReturnPct", label: "复合总收益", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "annualizedReturnPct", label: "年化", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "maxDrawdownPct", label: "最大回撤", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tradeCount", label: "交易笔数", align: "RIGHT" as const },
      { key: "completedTradeCount", label: "已平仓", align: "RIGHT" as const },
      { key: "openAtEndCount", label: "期末未平仓", align: "RIGHT" as const },
      { key: "winRatePct", label: "胜率", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail20RatePct", label: "≥+20% 比例", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail50RatePct", label: "≥+50% 比例", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "finalCashSharePct", label: "期末现金占比", unit: "%", digits: 2, align: "RIGHT" as const },
      { key: "skippedIntentCount", label: "被跳过意图", align: "RIGHT" as const },
    ],
    rows: output.accounts.map((account) => ({
      account: account.kind === "R" ? "R" : `RANDOM#${account.accountIndex}`,
      seedIndex: account.seedIndex,
      totalReturnPct: account.totalReturnPct,
      annualizedReturnPct: account.annualizedReturnPct,
      maxDrawdownPct: account.maxDrawdownPct,
      tradeCount: account.tradeCount,
      completedTradeCount: account.completedTradeCount,
      openAtEndCount: account.openAtEndCount,
      winRatePct: account.winRatePct,
      tail20RatePct: pct(account.tail20Rate),
      tail50RatePct: pct(account.tail50Rate),
      finalCashSharePct: account.finalCashSharePct,
      skippedIntentCount: account.skippedIntentCount,
    })),
  };

  // ---- 表 2：尾部读数与配对差 ------------------------------------------
  const tailTable = {
    key: "early-entry-tail-rates",
    title: "可实现尾部读数：R vs pooled Random（按**真实入场日**聚簇）",
    description:
      "分母 = 已平仓交易（`openAtEnd === false` 且 `returnPct !== null`）；期末未平仓**不进**尾率（另见覆盖表）。" +
      "差值 = R 的交易指示序列均值 − pooled Random 的对应均值（比率分子分母在同一个日期簇内一起重采样）。",
    columns: [
      { key: "block", label: "口径", align: "LEFT" as const },
      { key: "tradeCount", label: "交易笔数", align: "RIGHT" as const },
      { key: "completedTradeCount", label: "已平仓", align: "RIGHT" as const },
      { key: "hit20Count", label: "≥+20% 笔数", align: "RIGHT" as const },
      { key: "tail20RatePct", label: "≥+20%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "hit50Count", label: "≥+50% 笔数", align: "RIGHT" as const },
      { key: "tail50RatePct", label: "≥+50%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "hit100Count", label: "≥+100% 笔数", align: "RIGHT" as const },
      { key: "tail100RatePct", label: "≥+100%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "loss20RatePct", label: "≤−20%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "meanReturnPct", label: "净均值", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "medianReturnPct", label: "净中位", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "uniqueTail20AnchorCount", label: "≥+20% 唯一锚点", align: "RIGHT" as const },
    ],
    rows: [output.tailSummary.r, output.tailSummary.randomPooled].map((block) => ({
      block: block.label,
      tradeCount: block.tradeCount,
      completedTradeCount: block.completedTradeCount,
      hit20Count: block.hit20Count,
      tail20RatePct: pct(block.tail20Rate),
      hit50Count: block.hit50Count,
      tail50RatePct: pct(block.tail50Rate),
      hit100Count: block.hit100Count,
      tail100RatePct: pct(block.tail100Rate),
      loss20RatePct: pct(block.loss20Rate),
      meanReturnPct: block.meanReturnPct,
      medianReturnPct: block.medianReturnPct,
      uniqueTail20AnchorCount: block.uniqueTail20AnchorCount,
    })),
  };

  const differenceTable = {
    key: "early-entry-tail-differences",
    title: "尾部差值（R − pooled Random）· 日期移动块 bootstrap 95% 双侧",
    description:
      "block20 主口径 / block40 敏感性，固定 1000 次、固定种子（目标 §7）。" +
      "区间不跨 0 才算稳；比率**不是**逐日分位数平均。",
    columns: [
      { key: "metric", label: "指标", align: "LEFT" as const },
      { key: "block", label: "block", align: "RIGHT" as const },
      ...intervalColumns(),
    ],
    rows: output.tailSummary.differences.flatMap((difference) =>
      ([
        ["primary", difference.blockPrimary],
        ["sensitivity", difference.blockSensitivity],
      ] as const).flatMap(([label, interval]) => {
        if (interval === null) return [];
        return [{
          metric: difference.metric,
          block: label === "primary" ? BOOTSTRAP_BLOCK_PRIMARY : BOOTSTRAP_BLOCK_SENSITIVITY,
          pointEstimate: difference.pointEstimate,
          low: interval.low,
          high: interval.high,
          dayCount: interval.clusterCount,
          blockLength: interval.blockLength,
        }];
      }),
    ),
  };

  // ---- 表 3：随机账户分布 + R 的分位 --------------------------------
  const distributionTable = {
    key: "early-entry-random-distribution",
    title: "200 个随机账户的指标分布，以及 R 在同一分布中的位置",
    description:
      "R 相对随机账户分布的位置是**描述性对照**，不等于通过随机种子取得市场历史独立性（目标 §7）。",
    columns: [
      { key: "label", label: "指标", align: "LEFT" as const },
      { key: "unit", label: "单位", align: "LEFT" as const },
      { key: "min", label: "min", digits: 4, align: "RIGHT" as const },
      { key: "p05", label: "p05", digits: 4, align: "RIGHT" as const },
      { key: "p25", label: "p25", digits: 4, align: "RIGHT" as const },
      { key: "p50", label: "中位", digits: 4, align: "RIGHT" as const },
      { key: "p75", label: "p75", digits: 4, align: "RIGHT" as const },
      { key: "p95", label: "p95", digits: 4, align: "RIGHT" as const },
      { key: "max", label: "max", digits: 4, align: "RIGHT" as const },
      { key: "mean", label: "均值", digits: 4, align: "RIGHT" as const },
      { key: "rValue", label: "R", digits: 4, align: "RIGHT" as const },
      { key: "rPercentile", label: "R 分位", digits: 2, align: "RIGHT" as const },
    ],
    rows: output.randomDistribution.map((row) => ({ ...row })),
  };

  // ---- 表 4：数据覆盖阻断记账 ----------------------------------------
  const coverageTable = {
    key: "early-entry-data-coverage",
    title: "数据覆盖阻断记账（`DATA_COVERAGE_BLOCKED`，实验侧自检）",
    description:
      "引擎对「行情用尽」**没有**任何信号：期末仍持仓者按最后有效收盘 MTM 收尾，看起来像正常期末持仓。" +
      "因此这里逐项如实计数，不把它当正常退出。",
    columns: [
      { key: "item", label: "项", align: "LEFT" as const },
      { key: "value", label: "值", digits: 4, align: "RIGHT" as const },
      { key: "note", label: "说明", align: "LEFT" as const },
    ],
    rows: [
      {
        item: "openAtEnd 笔数（全部账户合计）",
        value: output.coverage.tradesOpenAtEnd,
        note: "`Trade.openAtEnd === true`；引擎在模拟窗口末端按最后有效收盘 MTM 收尾。",
      },
      {
        item: "持有期达到 Runner 续持上界的已平仓笔数",
        value: output.coverage.runnerExtensionReachedTrades,
        note: `\`holdingPeriod >= ${RUNNER_EXTEND_HOLDING_DAYS}\`；即真的用到了续持尾部。`,
      },
      {
        item: "上述两者交集（同时命中）",
        value: output.coverage.runnerExtensionReachedOpenAtEndTrades,
        note: "既用到了续持尾部、又在期末仍未平仓 ⇒ 覆盖缺口最直接命中的那一类。",
      },
      {
        item: "DATA_COVERAGE_BLOCKED 笔数",
        value: output.coverage.dataCoverageBlockedTrades,
        note: "实验侧口径 = 期末未平仓（`openAtEnd === true`）的全部笔数。",
      },
      {
        item: "DATA_COVERAGE_BLOCKED 占比（%）",
        value: output.coverage.dataCoverageBlockedSharePct,
        note: "分母 = 全部交易笔数；占比不可忽略时按目标 §6 停止并申请更长 post 的新版本。",
      },
      {
        item: "数据集物理 post 上界（相对日）",
        value: output.coverage.physicalPostMaxRelativeDay,
        note: "780004 `postWindowDays=80`。",
      },
      {
        item: "完整跑完冻结 Runner 所需的最小 post 相对日",
        value: output.coverage.requiredPostRelativeDayForFullRunner,
        note: "理论下界（成交 rd + 74 持有日）；**不**因此缩短政策、**不**在 rd80 强制卖出。",
      },
    ],
  };

  // ---- 表 5：年度分层 -------------------------------------------------
  const yearlyTable = {
    key: "early-entry-yearly",
    title: "年度分层：R vs Random 账户（基数 = 上一年末权益，2024 用初始本金）",
    columns: [
      { key: "year", label: "年", align: "RIGHT" as const },
      { key: "rReturnPct", label: "R 收益", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomMeanReturnPct", label: "Random 均值", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomMedianReturnPct", label: "Random 中位", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomPositiveSharePct", label: "Random 正收益占比", unit: "%", digits: 2, align: "RIGHT" as const },
    ],
    rows: output.yearly.map((row) => ({ ...row })),
  };

  // ---- 表 6：判定 ------------------------------------------------------
  const verdictTable = {
    key: "early-entry-verdict",
    title: "研究判定（事前收口规则；**不是**投资资格）",
    columns: [
      { key: "verdict", label: "判定", align: "LEFT" as const },
      { key: "reasons", label: "理由", align: "LEFT" as const },
    ],
    rows: [{
      verdict: output.verdict.verdict,
      reasons: output.verdict.reasons.join("；"),
    }],
  };

  // ---- 表 7：逐日候选池 ----------------------------------------------
  const poolAggregate = new Map<string, { poolSize: number; selectedByR: number; randomPickTotal: number }>();
  for (const row of output.candidateDays) {
    const bucket = poolAggregate.get(row.date) ?? { poolSize: 0, selectedByR: 0, randomPickTotal: 0 };
    bucket.poolSize += 1;
    if (row.selectedByR) bucket.selectedByR += 1;
    bucket.randomPickTotal += row.randomPickCount;
    poolAggregate.set(row.date, bucket);
  }
  const poolTable = {
    key: "early-entry-daily-pool",
    title: "逐日原始买点候选池（两臂**完全相同**）",
    description:
      "候选 = 当日锚点触发连续观察买点 ∧ `preReturn10` 可评估 ∧ 是该锚点的**最早**确认日。" +
      "R 取前 3 名（preReturn10 降序，symbol 升序，eventId 升序）；Random 从同一池均匀无放回取同人数。",
    columns: [
      { key: "date", label: "决策日", align: "LEFT" as const },
      { key: "poolSize", label: "候选池", align: "RIGHT" as const },
      { key: "selectedByR", label: "R 选中", align: "RIGHT" as const },
      { key: "randomPickMean", label: "Random 平均被抽中次数", digits: 4, align: "RIGHT" as const },
    ],
    rows: [...poolAggregate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, bucket]) => ({
        date,
        poolSize: bucket.poolSize,
        selectedByR: bucket.selectedByR,
        randomPickMean: bucket.poolSize === 0 ? null : bucket.randomPickTotal / bucket.poolSize,
      })),
  };

  return {
    // 🔴 账必须平：eligible + excluded === candidate，且 Σ excludedByReason === excluded。
    sampleSummary: {
      candidateCount: output.scannedEventCount,
      eligibleCount: output.eligibleEventCount,
      excludedCount,
      excludedByReason: { ...output.excludedByReason },
      notes: [
        `样本单位 = 一个权威首板事件。扫描量 = ${output.scannedEventCount}；数据集声明 ${output.datasetDeclaredEventCount ?? "未知"}。`,
        `主决策窗口 ${MAIN_WINDOW.startDate} ~ ${MAIN_WINDOW.endDate}；留池 rd1..40（沿用 round-1 锚点规则）；决策日 ${output.decisionDateCount} 天。`,
        `原始买点候选行 ${output.candidateDayRowCount}；账户 ${output.accounts.length} 个（R 1 + Random ${randomAccounts.length}），意图合计 ${output.intentCountTotal}。`,
        `T+10 硬门禁违规 ${output.tPlusTenViolationCount} 次（必须为 0：确认日 + 1 > ${ENTRY_FILL_MAX_RD} 的意图一律不进入 sourceRun）。`,
        `成交日与日历不一致 ${output.fillDayCalendarMismatchCount} 次（锚点 rd+1 的 bar 日期 ≠ 数据集日历的下一交易日；如实计数，不静默）。`,
        `身份无法解析的事件 ${output.unresolvedIdentityEventCount} 个（响亮计数，不按代码兜底）。`,
        `数据覆盖阻断 ${output.coverage.dataCoverageBlockedTrades} 笔（${output.coverage.dataCoverageBlockedSharePct ?? "—"}%）。`,
        ...output.coverageNotes,
      ],
    },
    tables: [
      accountSummaryTable,
      tailTable,
      differenceTable,
      distributionTable,
      coverageTable,
      yearlyTable,
      poolTable,
      verdictTable,
    ],
    statistics: [
      {
        code: "early_entry_decision_days",
        label: "决策日数",
        value: output.decisionDateCount,
        unit: "个交易日",
        digits: 0,
      },
      {
        code: "early_entry_candidate_rows",
        label: "原始买点候选行数",
        value: output.candidateDayRowCount,
        unit: "行",
        digits: 0,
      },
      {
        code: "early_entry_pool_size_median",
        label: "每日候选池 · 中位",
        value: output.poolSizeByDate.median,
        unit: "只",
        digits: 1,
      },
      {
        code: "early_entry_r_total_return",
        label: "R 复合总收益（canonical）",
        value: rAccount.totalReturnPct,
        unit: "%",
        digits: 4,
      },
      {
        code: "early_entry_r_max_drawdown",
        label: "R 最大回撤（canonical）",
        value: rAccount.maxDrawdownPct,
        unit: "%",
        digits: 4,
      },
      {
        code: "early_entry_r_tail20_rate",
        label: "R 已平仓交易 ≥+20% 比例",
        value: pct(output.tailSummary.r.tail20Rate),
        unit: "%",
        digits: 4,
        sampleCount: output.tailSummary.r.completedTradeCount,
      },
      {
        code: "early_entry_random_tail20_rate",
        label: "pooled Random 已平仓交易 ≥+20% 比例",
        value: pct(output.tailSummary.randomPooled.tail20Rate),
        unit: "%",
        digits: 4,
        sampleCount: output.tailSummary.randomPooled.completedTradeCount,
      },
      {
        code: "early_entry_tail20_difference",
        label: "≥+20% 比例差（R − pooled Random）",
        value: output.tailSummary.differences.find((item) => item.metric === "tail20")?.pointEstimate ?? null,
        unit: "比例",
        digits: 6,
      },
      {
        code: "early_entry_data_coverage_blocked",
        label: "DATA_COVERAGE_BLOCKED 笔数",
        value: output.coverage.dataCoverageBlockedTrades,
        unit: "笔",
        digits: 0,
        note: output.coverage.note,
      },
    ],
    charts: [
      {
        key: "early-entry-tail20-comparison",
        title: "已平仓交易 ≥+20% 比例：R vs pooled Random",
        kind: "BAR" as const,
        xLabel: "口径",
        yLabel: "比例",
        unit: "比例",
        series: [
          {
            key: "tail20",
            label: "≥+20% 比例",
            points: [
              { x: "R", y: output.tailSummary.r.tail20Rate },
              { x: "Random(pooled)", y: output.tailSummary.randomPooled.tail20Rate },
            ],
          },
        ],
      },
      {
        key: "early-entry-random-total-return",
        title: "200 个随机账户的复合总收益（R 为对照点）",
        kind: "BAR" as const,
        xLabel: "账户",
        yLabel: "复合总收益",
        unit: "%",
        series: [
          {
            key: "random",
            label: "Random 账户",
            points: randomAccounts.map((account) => ({
              x: `#${account.accountIndex}`,
              y: account.totalReturnPct,
            })),
          },
          {
            key: "r",
            label: "R",
            points: [{ x: "R", y: rAccount.totalReturnPct }],
          },
        ],
      },
    ],
    customPayload,
  };
}
