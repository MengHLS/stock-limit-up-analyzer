/**
 * `FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003` · 结果结构与组装。
 *
 * | 文件 | 回答的问题 |
 * | --- | --- |
 * | `experiment.ts` | 研究什么、怎么算（元数据 + 取数 + 投影 + 五组买点 + 排序 + 真实撮合 + 统计） |
 * | `result.ts` | 结果长什么样（自有 schema + 表格 / 统计 / 图表怎么组装） |
 *
 * 🔴 schema 与组装函数**必须同文件**：口径与产物放在一起，schema 就不可能和真实产物漂移。
 * 🔴 页面今天实际渲染的是 `GenericExperimentResult`（信封），所以关键数字必须进
 *    `tables` / `statistics` / `charts`，不能只放在 `customPayload` 里。
 * 🔴 本文件**只** import `zod` / `@shared` 类型 / `@experiments/shared/**` 纯模块 ——
 *    绝不 import `server/**` 运行时（页面会经类型引用它）。
 *
 * ## 与 round-002（`rolling-pool-early-entry-runner`）的关系
 *
 * - **复用**：买点规则库（`shared/rollingPoolEarlyEntry`，已参数化 N/L）、滚动池投影
 *   （`shared/rollingPoolRightTail`）、冻结退出政策读取器、唯一撮合入口。
 * - **本轮新增**：五组（A..E）在一个 Run 内并行的**组级**结果结构；组间配对 bootstrap；
 *   `tail20RateDifference` 靶的年度判据（修正 5）；`openAtEnd` 三分类（修正 6）；
 *   Runner 可观测性（修正 7）；再入场账（修正 3）。
 * - **不做**：不新建第二套引擎 / 指标出口 / 统计原语 / 策略语义。
 *
 * ## 🔴 信封体积纪律（与 round-002 的一处**有意不同**）
 *
 * round-002 把 `candidateDays` 与 `randomDraws`（≈ 400 日期 × 200 抽样）**整包**放进
 * `customPayload`。本轮是 5 组矩阵 ⇒ 同样的包会放大 5 倍，触到
 * `EXPERIMENT_RESULT_JSON_MAX_BYTES = 8 MiB` 的平台配额。
 * 因此本轮：**逐行明细一律走 `context.artifact`（CSV 文件产物）**，
 * `customPayload` 只保留组级聚合读数。关键数字仍然全部在 `tables` / `statistics` 里。
 */

import { z } from "zod";
import type { ExperimentCell, ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import {
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
 * 主决策窗口（与 round-1 / round-002 逐字一致：同一窗口的探索性续研，**不是**新 OOS）。
 */
export const MAIN_WINDOW = ROUND1_MAIN_WINDOW;

export const FROZEN_DATASET_CODE = FIRST_BOARD_DATASET_CODE;
export const FROZEN_DATASET_VERSION = FROZEN_DATASET_VERSION_LABEL;
export const FROZEN_DATASET_VERSION_ID_REFERENCE = 780_004;

/** 参考数据集物理 post 上界（`postWindowDays=80`）。 */
export const FROZEN_DATASET_POST_MAX_RELATIVE_DAY = 80;

/** 主决策窗口内每日候选上限（人数不足**不补齐**）。 */
export const DAILY_TOP_K = TOP_K;
/** 每组随机对照账户数（每个种子 = 一个独立账户）。 */
export const RANDOM_ACCOUNT_COUNT = 200;
/** 随机种子基址：`seedIndex = 20261010 + i`（i = 0..199，五组同 i 同种子 ⇒ 同「随机账户编号」）。 */
export const RANDOM_SEED_INDEX_BASE = RANDOM_SEED_BASE;

/** 账户冻结参数（目标 §3.4，逐字）。 */
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

/** 冻结退出政策的唯一继承物坐标（`experiment.ts` 断言指纹与版本行主键未漂移）。 */
export const FROZEN_STRATEGY_REFERENCE = Object.freeze({
  strategyVersionId: 3_600_005,
  strategyId: "first-limit-pullback-3f-top3-runner-t74",
  version: "2.0.0",
  fingerprint: "f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c",
  referenceRunId: "eval-3600005-promoted-t74",
});

/** 统计口径（目标 §6.1）：配对日期移动块 bootstrap、1000 次、95% 双侧。 */
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_PRIMARY = 20;
export const BOOTSTRAP_BLOCK_SENSITIVITY = 40;
/**
 * 固定种子（目标 §6.1「预冻结 1000 次」）。
 *
 * - `20_261_010`：block20 主口径（以及「整条锚点链归属首笔入场日」敏感性）；
 * - `20_261_011`：block40 敏感性。
 */
export const BOOTSTRAP_SEED_PRIMARY = RANDOM_SEED_BASE;
export const BOOTSTRAP_SEED_SENSITIVITY = 20_261_011;

export const TAIL_THRESHOLDS_PCT = [20, 50, 100] as const;
export const LEFT_TAIL_THRESHOLD_PCT = -20;

/**
 * 🔴 修正 5：年度**信号稳定性**闸门只看这两年。
 *
 * 靶 = `tail20RateDifference`（实际成交尾率差），**不是**账户年度权益收益。
 * 2026 只含主窗口决策产生的退出尾部 ⇒ 除非主窗口内确有新入场，否则**不进**信号闸门。
 */
export const GATE_YEARS = [2024, 2025] as const;
/** 2026 只有在主决策窗口内存在新入场时才允许进入信号闸门。 */
export const TAIL_YEAR_WITH_FALLBACK_GATE = 2026;

/** 主决策窗口边界（用于判定「某年度是否有主窗口内的新入场」）。 */
export const MAIN_WINDOW_START_DATE = MAIN_WINDOW.startDate;
export const MAIN_WINDOW_END_DATE = MAIN_WINDOW.endDate;

// ---------------------------------------------------------------------------
// 二、五组矩阵（目标 §2，逐字冻结）
// ---------------------------------------------------------------------------

export const GROUP_IDS = ["A", "B", "C", "D", "E"] as const;
export type GroupId = (typeof GROUP_IDS)[number];

export const REENTRY_KINDS = ["SIGNAL_REENTRY", "SINGLE_ENTRY"] as const;
export type ReentryKind = (typeof REENTRY_KINDS)[number];

/**
 * `SimulationConfig.reentryPolicy` 的**字面量副本**（`result.ts` 不 import `server/**`）。
 *
 * `experiment.ts` 在运行期断言它与 `ReentryPolicy` 的结构一致（三键、值域相同）。
 */
export interface ReentryPolicyLiteral {
  readonly securityCooldownTradingDays: number | null;
  readonly maxEntriesPerMember: number | null;
  readonly maxConcurrentOpenPerCode: number | null;
}

/** A/B/C/D 的再入场政策：无冷却、无总次数上限、**同真实股票并发上限 1**。 */
export const SIGNAL_REENTRY_POLICY: Readonly<ReentryPolicyLiteral> = Object.freeze({
  securityCooldownTradingDays: null,
  maxEntriesPerMember: null,
  maxConcurrentOpenPerCode: 1,
});

/**
 * E 的再入场政策：`maxEntriesPerMember = 1`。
 *
 * 🔴 次数键是 **securityId**，而本轮 `securityId` = `sec_<uuid>::event:<symbol>@<date>`
 *    ⇒ 该键恰好是「账户 ＋ **锚点事件**」；同真实股票的**另一个锚点**不会被误伤
 *    （同股票并发由 `maxConcurrentOpenPerCode = 1` 单独保证）。
 */
export const SINGLE_ENTRY_POLICY: Readonly<ReentryPolicyLiteral> = Object.freeze({
  securityCooldownTradingDays: null,
  maxEntriesPerMember: 1,
  maxConcurrentOpenPerCode: 1,
});

export interface GroupSpec {
  readonly id: GroupId;
  /** 连续观察日数 N。 */
  readonly observationDays: number;
  /** 最晚**实际成交**相对日 L。 */
  readonly entryFillMaxRd: number;
  /** 最早确认日 = N + 1。 */
  readonly confirmMinRd: number;
  /** 最晚确认日 = L − 1。 */
  readonly confirmMaxRd: number;
  readonly reentryKind: ReentryKind;
  readonly reentryPolicy: ReentryPolicyLiteral;
  /** 最早可能成交相对日 = N + 2（文档 §2「不是固定买入日」）。 */
  readonly earliestPossibleFillRd: number;
  readonly label: string;
  readonly purpose: string;
}

function groupSpec(args: {
  readonly id: GroupId;
  readonly observationDays: number;
  readonly entryFillMaxRd: number;
  readonly reentryKind: ReentryKind;
  readonly label: string;
  readonly purpose: string;
}): GroupSpec {
  return Object.freeze({
    id: args.id,
    observationDays: args.observationDays,
    entryFillMaxRd: args.entryFillMaxRd,
    confirmMinRd: args.observationDays + 1,
    confirmMaxRd: args.entryFillMaxRd - 1,
    reentryKind: args.reentryKind,
    reentryPolicy: args.reentryKind === "SINGLE_ENTRY" ? SINGLE_ENTRY_POLICY : SIGNAL_REENTRY_POLICY,
    earliestPossibleFillRd: args.observationDays + 2,
    label: args.label,
    purpose: args.purpose,
  });
}

/** 五组主配置（目标 §2 表格逐字）。 */
export const GROUPS: readonly GroupSpec[] = Object.freeze([
  groupSpec({
    id: "A",
    observationDays: 2,
    entryFillMaxRd: 10,
    reentryKind: "SIGNAL_REENTRY",
    label: "A · N2 / T+10 / 允许再入场",
    purpose: "原期限参照（**已允许再入场** ⇒ 不是 round-002 的精确重跑）",
  }),
  groupSpec({
    id: "B",
    observationDays: 2,
    entryFillMaxRd: 20,
    reentryKind: "SIGNAL_REENTRY",
    label: "B · N2 / T+20 / 允许再入场",
    purpose: "单独观察延长期限的影响",
  }),
  groupSpec({
    id: "C",
    observationDays: 3,
    entryFillMaxRd: 20,
    reentryKind: "SIGNAL_REENTRY",
    label: "C · N3 / T+20 / 允许再入场",
    purpose: "三日观察对照（描述性）",
  }),
  groupSpec({
    id: "D",
    observationDays: 5,
    entryFillMaxRd: 20,
    reentryKind: "SIGNAL_REENTRY",
    label: "D · N5 / T+20 / 允许再入场",
    purpose: "五日观察**主配置**",
  }),
  groupSpec({
    id: "E",
    observationDays: 5,
    entryFillMaxRd: 20,
    reentryKind: "SINGLE_ENTRY",
    label: "E · N5 / T+20 / 一次入场",
    purpose: "与 D 同买点池，量化「禁止再次入场」的代价",
  }),
]);

export function groupSpecOf(id: GroupId): GroupSpec {
  const spec = GROUPS.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`OBSERVATION-WINDOW-003：未知组 ${id}`);
  return spec;
}

/** 每组账户数 = R + 200 Random。 */
export const ACCOUNTS_PER_GROUP = 1 + RANDOM_ACCOUNT_COUNT;
/** 五组合计账户数（目标 §2：5 × 201 = 1005）。 */
export const TOTAL_ACCOUNT_COUNT = ACCOUNTS_PER_GROUP * GROUPS.length;

// ---------------------------------------------------------------------------
// 三、自有结构（由 `experiment.ts` 产出）
// ---------------------------------------------------------------------------

/** 单账户的 canonical 指标 + 覆盖事实（**唯一指标出口 = `canonicalMetrics`**）。 */
export interface AccountMetrics {
  readonly group: GroupId;
  /** 组内账户序号：0 = R，1..200 = Random。 */
  readonly accountIndex: number;
  readonly kind: "R" | "RANDOM";
  /** Random 账户的固定种子序号；R 为 null。 */
  readonly seedIndex: number | null;
  readonly decisionDayCount: number;
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
  /** 已平仓交易的平均持有交易日（缺失 ⇒ null，**不填 0**）。 */
  readonly averageHoldingPeriod: number | null;
  /** 期末现金占权益比例（%）。 */
  readonly finalCashSharePct: number | null;
  readonly skippedIntentCount: number;
  readonly fillCount: number;
  readonly rejectedOrderCount: number;
  /** 该账户「第 2 笔及以后」的建仓笔数（再入场实际发生量）。 */
  readonly reentryEntryCount: number;
  /** 持有期达到 Runner 续持上界（74 持有日）的笔数（可观测口径，见修正 7）。 */
  readonly heldToExtendedCapCount: number;
}

/** 一组交易（R 账户 / pooled Random）的尾部与风险读数。 */
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
  readonly winRatePct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly finalCashSharePct: number | null;
  readonly averageHoldingPeriod: number | null;
  readonly fillCount: number;
  readonly skippedIntentCount: number;
  readonly rejectedOrderCount: number;
  /** R 独有：命中 ≥+20% 的**唯一锚点**数（事前判据要用）。 */
  readonly uniqueTail20AnchorCount: number | null;
}

/**
 * 配对 bootstrap 区间（`shared/dateClusterBootstrap` 的 `PairedBootstrapResult`）。
 *
 * 🔴 全部比较臂**共享同一组交易日块索引**（配对抽样）；比率 = 分子分母同簇重采样。
 */
export interface BootstrapInterval {
  readonly low: number;
  readonly high: number;
  readonly iterations: number;
  readonly blockLength: number;
  readonly clusterCount: number;
  readonly seed: number;
  readonly quantiles: { readonly low: number; readonly high: number };
  readonly zeroDenominatorIterations: number;
  readonly calendarLength: number;
  /** 日期不在 calendar 内而被忽略的观测条数（唯一统计原语如实回写）。 */
  readonly ignoredObservationCount: number;
}

export interface PairedDifference {
  readonly metric: string;
  readonly pointEstimate: number | null;
  readonly blockPrimary: BootstrapInterval | null;
  readonly blockSensitivity: BootstrapInterval | null;
  /** 敏感性：整条锚点链归属其**首笔入场日**再抽样一次。 */
  readonly anchorChainPrimary: BootstrapInterval | null;
  /**
   * 同一配对日期块下的**均值差**区间（`movingBlockBootstrapPairedMeanDifference`）。
   *
   * 目标 §6.1 要求「不先算每日小样本尾率再平均」；均值口径由唯一统计原语给出，
   * 与比率口径并列报告（比率是主判据，均值是辅助读数）。
   */
  readonly meanPrimary: BootstrapInterval | null;
}

/** 年度**信号**分层（靶 = 实际成交 ≥+20% 尾率差，修正 5）。 */
export interface YearlyTailRow {
  readonly year: number;
  readonly rCompletedCount: number;
  readonly rHit20Count: number;
  readonly rTail20Rate: number | null;
  readonly randomCompletedCount: number;
  readonly randomHit20Count: number;
  readonly randomTail20Rate: number | null;
  readonly tail20RateDifference: number | null;
  /** 该年度是否在**主决策窗口内**有新入场（2026 的闸门资格判据）。 */
  readonly hasMainWindowEntry: boolean;
  /** 是否进入信号稳定性闸门。 */
  readonly inSignalGate: boolean;
  readonly gateNote: string;
}

/** 年度**账户权益**收益（修正 5：与信号判据**分开**报告）。 */
export interface YearlyAccountReturnRow {
  readonly year: number;
  readonly rReturnPct: number | null;
  readonly randomMeanReturnPct: number | null;
  readonly randomMedianReturnPct: number | null;
  readonly randomPositiveSharePct: number | null;
  readonly randomP25ReturnPct: number | null;
  readonly randomP75ReturnPct: number | null;
}

export interface DistributionRow {
  readonly group: GroupId;
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
}

/** 逐层排除 / 归因账（观察 → 回撤 → 支撑 → N 日得分 → 突破 → 候选 → 下单 → 成交 → 退出）。 */
export interface ExclusionLedgerRow {
  readonly group: GroupId;
  readonly layer: string;
  readonly code: string;
  readonly count: number;
  readonly unit: string;
  readonly note: string;
}

/** 成交年龄分布（相对锚点的成交相对日）。 */
export interface FillAgeRow {
  readonly group: GroupId;
  readonly fillRd: number;
  readonly fillCount: number;
  readonly uniqueAnchorCount: number;
  readonly completedTradeCount: number;
  readonly hit20Count: number;
  readonly tail20Rate: number | null;
}

/** 再入场账的一行（每次**真实**建仓）。 */
export interface ReentryLedgerRow {
  readonly accountId: string;
  readonly group: GroupId;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly entryOrdinal: number;
  readonly previousActualExitDate: string | null;
  readonly newConfirmDate: string | null;
  readonly newFillDate: string;
  readonly entryEquity: number | null;
  readonly targetBudget: number | null;
  readonly exitReason: string | null;
  readonly netPnl: number | null;
}

/** 未成交 / 被阻断的建仓尝试（**不**增加 `entryOrdinal`）。 */
export interface ReentryFailedAttemptRow {
  readonly accountId: string;
  readonly group: GroupId;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly attemptedConfirmDate: string;
  readonly plannedFillDate: string | null;
  readonly skipCode: string;
  readonly reason: string;
  readonly priorEntryOrdinalActual: number;
  readonly priorActualExitDate: string | null;
}

/** 第 n 笔建仓的汇总（首次 / 第二次 / 后续）。 */
export interface ReentryOrdinalSummaryRow {
  readonly group: GroupId;
  readonly entryOrdinal: number;
  readonly tradeCount: number;
  readonly completedCount: number;
  readonly hit20Count: number;
  readonly tail20Rate: number | null;
  readonly meanReturnPct: number | null;
  readonly medianReturnPct: number | null;
  readonly netPnlSum: number | null;
  readonly feesSum: number | null;
}

/** 再入场总账（含「同锚点整条链」口径，目标 §6.1）。 */
export interface ReentryAccounting {
  readonly ordinals: readonly ReentryOrdinalSummaryRow[];
  readonly filledAnchorCount: number;
  readonly anchorWithAtLeastOneHit20Count: number;
  readonly anchorChainNetPnlSum: number | null;
  /** 命中一笔大涨但整条链净亏的锚点数（单列，目标 §6.1）。 */
  readonly anchorChainHitButNetLossCount: number;
  readonly failedAttemptCount: number;
  readonly failedAttemptsByCode: Readonly<Record<string, number>>;
  readonly note: string;
}

/** P3 排序分辨力（在**最终触发候选池**上）。 */
export interface RankingResolutionRow {
  readonly group: GroupId;
  readonly candidateDayCount: number;
  readonly candidateRowCount: number;
  readonly distinctPreReturn10Count: number;
  /** 最大并列组占比（**百分数 0–100**）= 同一取值出现次数最多的一组 / 候选行数 × 100；空池 ⇒ `null`。 */
  readonly maxValueSharePct: number | null;
  readonly boundaryTieDayCount: number;
  readonly boundaryTieSizeMedian: number | null;
  readonly boundaryTieSizeMax: number | null;
  readonly tieBreakKey: string;
  readonly interpretation: string;
}

/** N/L 边界诊断（目标 §5 预检闸门）。 */
export interface BoundaryDiagnostics {
  readonly group: GroupId;
  readonly observationDays: number;
  readonly entryFillMaxRd: number;
  readonly confirmMinRd: number;
  readonly confirmMaxRd: number;
  readonly earliestPossibleFillRd: number;
  readonly observedMinConfirmRd: number | null;
  readonly observedMaxConfirmRd: number | null;
  readonly observedMinFillRd: number | null;
  readonly observedMaxFillRd: number | null;
  readonly candidatesAtMinConfirmRd: number;
  readonly candidatesAtMaxConfirmRd: number;
  readonly candidatesAtFillCap: number;
  /** 必须为 0：`fillRd > L` 的候选（账户层硬门禁）。 */
  readonly fillRdViolationCount: number;
  /** 观察池里落在本组确认区间**之前**的「锚点×决策日」行数（越界记账，不是候选）。 */
  readonly belowConfirmMinDayCount: number;
  /** 落在本组确认区间**之后**的行数。 */
  readonly aboveConfirmMaxDayCount: number;
  readonly note: string;
}

/** 数据覆盖 / 可观测性（修正 6 + 修正 7）。 */
export interface CoverageAccounting {
  readonly group: GroupId | "ALL";
  readonly tradesTotal: number;
  readonly tradesCompleted: number;
  readonly tradesOpenAtEnd: number;
  /** 三分类（**启发式**，见 note）：正常期末 MTM。 */
  readonly mtmValidCount: number;
  /** 三分类：期末未平仓但无执行 bar（`exitPrice === null`）。 */
  readonly noExecutionBarCount: number;
  /** 三分类：有「卖不出去」的反查证据（停牌 / 跌停 / 无流动性 / 顺延）。 */
  readonly suspendedCannotSellCount: number;
  /** 同时满足 MTM_VALID 的语法条件与「卖不出去」证据的笔数（重叠如实披露）。 */
  readonly mtmValidWithRejectedSellEvidenceCount: number;
  /** 持有期达到 Runner 续持上界的笔数（`holdingPeriod >= 74` 或退出原因命中）。 */
  readonly heldToExtendedCapCount: number;
  /** 退出原因命中 `Runner Bridge持有满<k>个交易日` 的笔数。 */
  readonly runnerBridgeExitReasonCount: number;
  /** 🔴 恒为 `"UNOBSERVABLE"`。 */
  readonly runnerTriggerObservability: "UNOBSERVABLE";
  readonly runnerObservabilityNote: string;
  /** `L + 74`（完整跑完冻结 Runner 所需的最小 post 相对日）。 */
  readonly requiredPostRelativeDayForFullRunner: number;
  readonly physicalPostMaxRelativeDay: number;
  readonly firstObservedTradingDate: string;
  readonly lastObservedTradingDate: string;
  readonly classifierNote: string;
}

export const RESEARCH_VERDICTS = [
  "RIGHT_TAIL_EVIDENCE",
  "RISK_TRADEOFF",
  "INSUFFICIENT_EVIDENCE",
  "NO_SUPPORT",
  "NO_TRIGGER_IN_WINDOW",
] as const;
export type VerdictCode = (typeof RESEARCH_VERDICTS)[number];

export interface Verdict {
  readonly verdict: VerdictCode;
  readonly reasons: readonly string[];
}

export type ComparisonClass = "PRIMARY_CONFIRMATORY" | "SECONDARY_DESCRIPTIVE";

/** 组间（R 臂）配对比较。 */
export interface GroupComparison {
  readonly key: string;
  readonly label: string;
  readonly fromGroup: GroupId;
  readonly toGroup: GroupId;
  readonly classification: ComparisonClass;
  readonly difference: PairedDifference;
  readonly sampleGateMet: boolean;
  readonly gateReason: string;
  readonly sameDirectionYears: readonly number[];
  readonly sensitivityNotReversed: boolean | null;
  readonly supported: boolean;
  readonly note: string;
}

export interface GroupComputeOutput {
  readonly group: GroupSpec;
  /** 组内 201 个账户共享的同一 `reentryPolicy`（字节相同，运行期断言）。 */
  readonly reentryPolicy: ReentryPolicyLiteral;
  /** 组内 201 个账户共享的 `run.config` 快照 JSON（字节相同，运行期断言）。 */
  readonly configSnapshotJson: string;
  readonly decisionDateCount: number;
  readonly candidateRowCount: number;
  readonly candidateDayCount: number;
  readonly poolSizeByDate: { readonly min: number; readonly median: number; readonly max: number };
  readonly poolSizeHistogram: { readonly le2: number; readonly eq3: number; readonly gt3: number };
  readonly triggerAnchorCount: number;
  readonly multiTriggerAnchorCount: number;
  readonly retriggerDayCount: number;
  readonly laterTriggerDayRetainedCount: number;
  readonly fillCount: number;
  readonly rejectedOrderCount: number;
  readonly skippedIntentCount: number;
  readonly accounts: readonly AccountMetrics[];
  readonly tail: {
    readonly r: TailRateBlock;
    readonly randomPooled: TailRateBlock;
    readonly difference: PairedDifference;
  };
  readonly yearlyTail: readonly YearlyTailRow[];
  readonly yearlyAccountReturns: readonly YearlyAccountReturnRow[];
  readonly randomDistribution: readonly DistributionRow[];
  readonly fillAge: readonly FillAgeRow[];
  readonly boundary: BoundaryDiagnostics;
  readonly exclusionLedger: readonly ExclusionLedgerRow[];
  readonly reentry: ReentryAccounting;
  readonly rankingResolution: RankingResolutionRow;
  readonly coverage: CoverageAccounting;
  readonly verdict: Verdict;
}

/** 组装结果所需的一切（由 `experiment.ts` 产出）。 */
export interface ObservationWindowComputeOutput {
  readonly scannedEventCount: number;
  readonly eligibleEventCount: number;
  readonly excludedByReason: Readonly<Record<string, number>>;
  readonly datasetDeclaredEventCount: number | null;
  readonly unresolvedIdentityEventCount: number;
  readonly poolDecisionDateCount: number;
  readonly anchorSwitchCount: number;
  readonly executionRowCount: number;
  readonly executionSecurityCount: number;
  readonly tradingDayCount: number;
  readonly tradingDayCalendarFirst: string;
  readonly tradingDayCalendarLast: string;
  readonly barValueConflictCount: number;
  readonly fillDayCalendarMismatchCount: number;
  readonly groups: readonly GroupComputeOutput[];
  readonly primaryComparison: GroupComparison;
  readonly secondaryComparisons: readonly GroupComparison[];
  readonly studyVerdict: Verdict;
  readonly coverage: CoverageAccounting;
  readonly contractGaps: readonly string[];
  readonly coverageNotes: readonly string[];
  readonly poolDailySummary: readonly {
    readonly date: string;
    readonly poolSize: number;
    readonly candidateCountByGroup: Readonly<Record<string, number>>;
    readonly rSelected: number;
  }[];
}

// ---------------------------------------------------------------------------
// 四、自有 payload schema
// ---------------------------------------------------------------------------

const reentryPolicySchema = z.object({
  securityCooldownTradingDays: z.number().int().nullable(),
  maxEntriesPerMember: z.number().int().nullable(),
  maxConcurrentOpenPerCode: z.number().int().nullable(),
});

const bootstrapIntervalSchema = z.object({
  low: z.number(),
  high: z.number(),
  iterations: z.number().int().positive(),
  blockLength: z.number().int().positive(),
  clusterCount: z.number().int().nonnegative(),
  seed: z.number().int(),
  quantiles: z.object({ low: z.number(), high: z.number() }),
  zeroDenominatorIterations: z.number().int().nonnegative(),
  calendarLength: z.number().int().nonnegative(),
  ignoredObservationCount: z.number().int().nonnegative(),
});

const pairedDifferenceSchema = z.object({
  metric: z.string().min(1),
  pointEstimate: z.number().nullable(),
  blockPrimary: bootstrapIntervalSchema.nullable(),
  blockSensitivity: bootstrapIntervalSchema.nullable(),
  anchorChainPrimary: bootstrapIntervalSchema.nullable(),
  meanPrimary: bootstrapIntervalSchema.nullable(),
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
  winRatePct: z.number().nullable(),
  maxDrawdownPct: z.number().nullable(),
  finalCashSharePct: z.number().nullable(),
  averageHoldingPeriod: z.number().nullable(),
  fillCount: z.number().int().nonnegative(),
  skippedIntentCount: z.number().int().nonnegative(),
  rejectedOrderCount: z.number().int().nonnegative(),
  uniqueTail20AnchorCount: z.number().int().nonnegative().nullable(),
});

const coverageSchema = z.object({
  group: z.string().min(1),
  tradesTotal: z.number().int().nonnegative(),
  tradesCompleted: z.number().int().nonnegative(),
  tradesOpenAtEnd: z.number().int().nonnegative(),
  mtmValidCount: z.number().int().nonnegative(),
  noExecutionBarCount: z.number().int().nonnegative(),
  suspendedCannotSellCount: z.number().int().nonnegative(),
  mtmValidWithRejectedSellEvidenceCount: z.number().int().nonnegative(),
  heldToExtendedCapCount: z.number().int().nonnegative(),
  runnerBridgeExitReasonCount: z.number().int().nonnegative(),
  runnerTriggerObservability: z.literal("UNOBSERVABLE"),
  runnerObservabilityNote: z.string().min(1),
  requiredPostRelativeDayForFullRunner: z.number().int().positive(),
  physicalPostMaxRelativeDay: z.number().int().positive(),
  firstObservedTradingDate: z.string().min(1),
  lastObservedTradingDate: z.string().min(1),
  classifierNote: z.string().min(1),
});

/**
 * 本实验自有结果结构（进 `customPayload`）。
 *
 * 🔴 逐行明细（候选日 / 交易台账 / 再入场账 / 逐日评分）**不在**这里 ——
 *    它们在 `context.artifact` 的 CSV 文件产物里（见文件头「信封体积纪律」）。
 */
export const observationWindowCustomPayloadSchema = z.object({
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
    accountsPerGroup: z.number().int().positive(),
    totalAccountCount: z.number().int().positive(),
    supportRatio: z.number(),
    shrinkRatio: z.number(),
    observationMinScore: z.number().int().nonnegative(),
    runnerExtendHoldingDays: z.number().int().positive(),
    datasetPostMaxRelativeDay: z.number().int().positive(),
    strategyVersionId: z.number().int().positive(),
    strategyVersion: z.string().min(1),
    strategyFingerprint: z.string().min(1),
    referenceRunId: z.string().min(1),
    bootstrapIterations: z.number().int().positive(),
    bootstrapBlockPrimary: z.number().int().positive(),
    bootstrapBlockSensitivity: z.number().int().positive(),
    bootstrapSeedPrimary: z.number().int(),
    bootstrapSeedSensitivity: z.number().int(),
    gateYears: z.array(z.number().int()).min(1),
  }),
  groupSummaries: z.array(
    z.object({
      groupId: z.string().min(1),
      observationDays: z.number().int().positive(),
      entryFillMaxRd: z.number().int().positive(),
      confirmMinRd: z.number().int().positive(),
      confirmMaxRd: z.number().int().positive(),
      reentryKind: z.string().min(1),
      reentryPolicy: reentryPolicySchema,
      accountCount: z.number().int().positive(),
      decisionDateCount: z.number().int().nonnegative(),
      candidateRowCount: z.number().int().nonnegative(),
      triggerAnchorCount: z.number().int().nonnegative(),
      multiTriggerAnchorCount: z.number().int().nonnegative(),
      retriggerDayCount: z.number().int().nonnegative(),
      laterTriggerDayRetainedCount: z.number().int().nonnegative(),
      fillCount: z.number().int().nonnegative(),
      rejectedOrderCount: z.number().int().nonnegative(),
      rTradeCount: z.number().int().nonnegative(),
      rCompletedTradeCount: z.number().int().nonnegative(),
      rOpenAtEndCount: z.number().int().nonnegative(),
      rTail20Rate: z.number().nullable(),
      rTail50Rate: z.number().nullable(),
      rTail100Rate: z.number().nullable(),
      rMeanReturnPct: z.number().nullable(),
      rMedianReturnPct: z.number().nullable(),
      rWinRatePct: z.number().nullable(),
      rMaxDrawdownPct: z.number().nullable(),
      rFinalCashSharePct: z.number().nullable(),
      rAverageHoldingPeriod: z.number().nullable(),
      rTotalReturnPct: z.number().nullable(),
      rTotalReturnPercentile: z.number().nullable(),
      randomPooledTail20Rate: z.number().nullable(),
      randomPooledMeanReturnPct: z.number().nullable(),
      tail20RateDifference: z.number().nullable(),
      reentryEntryCount: z.number().int().nonnegative(),
      heldToExtendedCapCount: z.number().int().nonnegative(),
      verdict: z.enum(RESEARCH_VERDICTS),
      verdictReasons: z.array(z.string()),
    }),
  ),
  primaryComparison: z.object({
    key: z.string().min(1),
    fromGroup: z.string().min(1),
    toGroup: z.string().min(1),
    pointEstimate: z.number().nullable(),
    low: z.number().nullable(),
    high: z.number().nullable(),
    sensitivityLow: z.number().nullable(),
    sensitivityHigh: z.number().nullable(),
    anchorChainLow: z.number().nullable(),
    anchorChainHigh: z.number().nullable(),
    meanLow: z.number().nullable(),
    meanHigh: z.number().nullable(),
    zeroDenominatorIterations: z.number().int().nonnegative(),
    calendarLength: z.number().int().nonnegative(),
    clusterCount: z.number().int().nonnegative(),
    ignoredObservationCount: z.number().int().nonnegative(),
    sampleGateMet: z.boolean(),
    sameDirectionYears: z.array(z.number().int()),
    supported: z.boolean(),
    note: z.string().min(1),
  }),
  secondaryComparisons: z.array(
    z.object({
      key: z.string().min(1),
      classification: z.string().min(1),
      pointEstimate: z.number().nullable(),
      low: z.number().nullable(),
      high: z.number().nullable(),
      note: z.string().min(1),
    }),
  ),
  studyVerdict: z.object({
    verdict: z.enum(RESEARCH_VERDICTS),
    reasons: z.array(z.string()),
  }),
  coverage: coverageSchema,
  contractGaps: z.array(z.string().min(1)),
});

export type ObservationWindowCustomPayload = z.infer<typeof observationWindowCustomPayloadSchema>;

// ---------------------------------------------------------------------------
// 五、契约缺口与披露
// ---------------------------------------------------------------------------

const CONTRACT_GAPS = [
  "`decisionOffsetDays` 是**单标量** ⇒ 滚动池逐日变化的决策坐标只能表达为内存投影。本实验声明 `20`（= 五组里最大的成交相对日上界），是**上界声明**而不是逐日精确坐标（与 round-1 声明 40、round-002 声明 10 同理）。",
  "`observation(rd)` 无 `eventId` / 日期参数 ⇒ 逐日池只能从「整层 rd」投影；`freezeSelection` 一次性，冻结集 = 候选宇宙而非逐日成员。",
  "逐日 ST / 上市龄不在 Dataset 端口内 ⇒ 事件日非 ST 与上市龄 ≥ 365 自然日由**构建期**保证；逐日 ST 记 `UNAVAILABLE`，**未实现每日非 ST 控制**（不伪造）。",
  "`maxAmp5` **完全不参与**（目标 §3.1）：`MaxAmp5Computer` 恒返回 `null` ⇒ round-1 的 `signalEligible` 恒为 false，本实验**不使用**它；候选资格只由连续观察买点（N/L 参数化）+ `preReturn10` 可评估决定。",
  "`reentryPolicy` **不在** `runCompositeRunnerBacktest` 的入参里（它在更底层的 `SimulationConfig` 上）⇒ 本轮对每组先调用**一次** `runCompositeRunnerBacktest` 拿到权威装配的 `simulationConfig`，再对**全部 201 个账户（含 R）**用同一个对象引用调用 `runTradeSimulation`。被丢弃的那一次 R 装配运行只用于取配置，其本身**不进入**结果。",
  "Runner 的 `runnerBridgeExtendedToBySecurity` 是 `server/research/simulator/engine.ts` 内的**函数局部 Map** ⇒ 「是否触发过 Runner」「触发后是否提前退出」在 `TradeSimulationRun` 契约上**不可观测**。本轮只报「持有到 74 日的笔数」并显式标注 `runnerTriggerObservability = UNOBSERVABLE`，**不**做退出消融、**不**据此声称 Runner 从未触发。",
  "「行情用尽」在引擎里**没有**信号：期末仍持仓者按最后有效收盘 MTM 收尾。本轮的三分类（`MTM_VALID` / `NO_EXECUTION_BAR` / `SUSPENDED_CANNOT_SELL`）是**实验侧启发式**，其第三类靠 `run.audit.orders` 的卖出拒单理由与 `run.skipped` 的顺延码反查（**运行级 + 证券级**，不是逐笔因果）。两类判据可能重叠，重叠笔数单列披露。",
  "`780004` 物理 post 上界 = rd80，而「T+20 成交 + 冻结 Runner 续持至 74 持有日」最远约 rd94 ⇒ 期末未平仓按「最后有效收盘 MTM」收尾。按目标 §5：**不**缩短 74 日政策、**不**在 rd80 强制卖出、**不**剔除长持赢家；缺口用 `L + 74` 与 `physicalPostMaxRelativeDay` 并列披露。",
  "再入场账里的 `previousActualExitDate` / `newConfirmDate` / `entryEquity` 由**实验侧**从交易台账、账户权益曲线与意图日历**反推**（引擎不导出再入场状态机）。反推规则写死在 `experiment.ts`，且与「决策在收盘、成交在次一交易日开盘」的既定语义一致。",
  "五组的原始候选池**自然不同**（N/L 改变触发条件）⇒ 组间不做交易数量对齐；D/E 的**原始买点池**相同，只在账户层用 `reentryPolicy` 区分。",
  "`executionSurface` 保持缺省 `SINGLE_EVENT`。本实验经零实现桥 `@experiments/compositeRunnerBridge` 调用既有唯一撮合引擎，**不新建引擎 / 指标出口 / 策略语义**。",
  "`customPayload` 有意**不含**逐行明细（round-002 把 `candidateDays` / `randomDraws` 整包放进 payload；五组会放大 5 倍并触到 `result.json` 的 8 MiB 配额）⇒ 逐行数据全部走 CSV 文件产物。",
];

// ---------------------------------------------------------------------------
// 六、小工具
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
    { key: "clusterCount", label: "日期簇数", digits: 0, align: "RIGHT" as const },
    { key: "zeroDenominatorIterations", label: "零分母迭代", digits: 0, align: "RIGHT" as const },
    { key: "ignoredObservationCount", label: "越界观测", digits: 0, align: "RIGHT" as const },
    { key: "blockLength", label: "block", digits: 0, align: "RIGHT" as const },
  ];
}

function bootstrapCells(interval: BootstrapInterval | null): Record<string, ExperimentCell> {
  return {
    pointEstimate: null,
    low: interval?.low ?? null,
    high: interval?.high ?? null,
    clusterCount: interval?.clusterCount ?? null,
    zeroDenominatorIterations: interval?.zeroDenominatorIterations ?? null,
    ignoredObservationCount: interval?.ignoredObservationCount ?? null,
    blockLength: interval?.blockLength ?? null,
  };
}

// ---------------------------------------------------------------------------
// 七、组装
// ---------------------------------------------------------------------------

function groupSummaryRow(output: GroupComputeOutput): Record<string, ExperimentCell> {
  const r = output.tail.r;
  const random = output.tail.randomPooled;
  return {
    group: output.group.id,
    label: output.group.label,
    observationDays: output.group.observationDays,
    entryFillMaxRd: output.group.entryFillMaxRd,
    confirmRange: `${output.group.confirmMinRd}..${output.group.confirmMaxRd}`,
    reentryKind: output.group.reentryKind,
    maxEntriesPerMember: output.group.reentryPolicy.maxEntriesPerMember ?? "不限",
    maxConcurrentOpenPerCode: output.group.reentryPolicy.maxConcurrentOpenPerCode ?? "不限",
    accountCount: output.accounts.length,
    candidateDayCount: output.candidateDayCount,
    candidateRowCount: output.candidateRowCount,
    triggerAnchorCount: output.triggerAnchorCount,
    multiTriggerAnchorCount: output.multiTriggerAnchorCount,
    retriggerDayCount: output.retriggerDayCount,
    fillCount: output.fillCount,
    rejectedOrderCount: output.rejectedOrderCount,
    completedTradeCount: r.completedTradeCount,
    tail20RatePct: pct(r.tail20Rate),
    tail50RatePct: pct(r.tail50Rate),
    tail100RatePct: pct(r.tail100Rate),
    meanReturnPct: r.meanReturnPct,
    medianReturnPct: r.medianReturnPct,
    winRatePct: r.winRatePct,
    maxDrawdownPct: r.maxDrawdownPct,
    finalCashSharePct: r.finalCashSharePct,
    averageHoldingPeriod: r.averageHoldingPeriod,
    totalReturnPct: output.accounts.find((account) => account.kind === "R")?.totalReturnPct ?? null,
    randomTail20RatePct: pct(random.tail20Rate),
    tail20RateDifference: output.tail.difference.pointEstimate,
    verdict: output.verdict.verdict,
  };
}

function tailRateTableRows(output: GroupComputeOutput): Record<string, ExperimentCell>[] {
  return [output.tail.r, output.tail.randomPooled].map((block) => ({
    group: output.group.id,
    block: block.label,
    tradeCount: block.tradeCount,
    completedTradeCount: block.completedTradeCount,
    openAtEndCount: block.openAtEndCount,
    hit20Count: block.hit20Count,
    tail20RatePct: pct(block.tail20Rate),
    hit50Count: block.hit50Count,
    tail50RatePct: pct(block.tail50Rate),
    hit100Count: block.hit100Count,
    tail100RatePct: pct(block.tail100Rate),
    loss20RatePct: pct(block.loss20Rate),
    meanReturnPct: block.meanReturnPct,
    medianReturnPct: block.medianReturnPct,
    winRatePct: block.winRatePct,
    maxDrawdownPct: block.maxDrawdownPct,
    finalCashSharePct: block.finalCashSharePct,
    averageHoldingPeriod: block.averageHoldingPeriod,
    fillCount: block.fillCount,
    skippedIntentCount: block.skippedIntentCount,
    rejectedOrderCount: block.rejectedOrderCount,
    uniqueTail20AnchorCount: block.uniqueTail20AnchorCount,
  }));
}

/** 组装最终结果（表格 / 统计 / 图表 / 自有结构 + 如实样本账）。 */
export function assembleObservationWindowResult(args: {
  readonly output: ObservationWindowComputeOutput;
  readonly datasetVersionId: number;
  readonly datasetVersionLabel: string;
}): ExperimentResultPayload {
  const { output, datasetVersionId, datasetVersionLabel } = args;
  const excludedCount = output.scannedEventCount - output.eligibleEventCount;
  const firstGroup = output.groups[0];
  if (firstGroup === undefined) {
    throw new Error("OBSERVATION-WINDOW-003：结果组装要求至少一个组。");
  }

  const customPayload: ObservationWindowCustomPayload = {
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
      accountsPerGroup: ACCOUNTS_PER_GROUP,
      totalAccountCount: TOTAL_ACCOUNT_COUNT,
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
      gateYears: [...GATE_YEARS],
    },
    groupSummaries: output.groups.map((group) => {
      const r = group.tail.r;
      const random = group.tail.randomPooled;
      const rAccount = group.accounts.find((account) => account.kind === "R") ?? null;
      const totalReturnRow = group.randomDistribution.find((row) => row.field === "totalReturnPct");
      return {
        groupId: group.group.id,
        observationDays: group.group.observationDays,
        entryFillMaxRd: group.group.entryFillMaxRd,
        confirmMinRd: group.group.confirmMinRd,
        confirmMaxRd: group.group.confirmMaxRd,
        reentryKind: group.group.reentryKind,
        reentryPolicy: { ...group.group.reentryPolicy },
        accountCount: group.accounts.length,
        decisionDateCount: group.candidateDayCount,
        candidateRowCount: group.candidateRowCount,
        triggerAnchorCount: group.triggerAnchorCount,
        multiTriggerAnchorCount: group.multiTriggerAnchorCount,
        retriggerDayCount: group.retriggerDayCount,
        laterTriggerDayRetainedCount: group.laterTriggerDayRetainedCount,
        fillCount: group.fillCount,
        rejectedOrderCount: group.rejectedOrderCount,
        rTradeCount: r.tradeCount,
        rCompletedTradeCount: r.completedTradeCount,
        rOpenAtEndCount: r.openAtEndCount,
        rTail20Rate: r.tail20Rate,
        rTail50Rate: r.tail50Rate,
        rTail100Rate: r.tail100Rate,
        rMeanReturnPct: r.meanReturnPct,
        rMedianReturnPct: r.medianReturnPct,
        rWinRatePct: r.winRatePct,
        rMaxDrawdownPct: r.maxDrawdownPct,
        rFinalCashSharePct: r.finalCashSharePct,
        rAverageHoldingPeriod: r.averageHoldingPeriod,
        rTotalReturnPct: rAccount?.totalReturnPct ?? null,
        rTotalReturnPercentile: totalReturnRow?.rPercentile ?? null,
        randomPooledTail20Rate: random.tail20Rate,
        randomPooledMeanReturnPct: random.meanReturnPct,
        tail20RateDifference: group.tail.difference.pointEstimate,
        reentryEntryCount: group.reentry.ordinals
          .filter((row) => row.entryOrdinal >= 2)
          .reduce((sum, row) => sum + row.tradeCount, 0),
        heldToExtendedCapCount: group.coverage.heldToExtendedCapCount,
        verdict: group.verdict.verdict,
        verdictReasons: [...group.verdict.reasons],
      };
    }),
    primaryComparison: {
      key: output.primaryComparison.key,
      fromGroup: output.primaryComparison.fromGroup,
      toGroup: output.primaryComparison.toGroup,
      pointEstimate: output.primaryComparison.difference.pointEstimate,
      low: output.primaryComparison.difference.blockPrimary?.low ?? null,
      high: output.primaryComparison.difference.blockPrimary?.high ?? null,
      sensitivityLow: output.primaryComparison.difference.blockSensitivity?.low ?? null,
      sensitivityHigh: output.primaryComparison.difference.blockSensitivity?.high ?? null,
      anchorChainLow: output.primaryComparison.difference.anchorChainPrimary?.low ?? null,
      anchorChainHigh: output.primaryComparison.difference.anchorChainPrimary?.high ?? null,
      meanLow: output.primaryComparison.difference.meanPrimary?.low ?? null,
      meanHigh: output.primaryComparison.difference.meanPrimary?.high ?? null,
      zeroDenominatorIterations:
        output.primaryComparison.difference.blockPrimary?.zeroDenominatorIterations ?? 0,
      calendarLength: output.primaryComparison.difference.blockPrimary?.calendarLength ?? 0,
      clusterCount: output.primaryComparison.difference.blockPrimary?.clusterCount ?? 0,
      ignoredObservationCount:
        output.primaryComparison.difference.blockPrimary?.ignoredObservationCount ?? 0,
      sampleGateMet: output.primaryComparison.sampleGateMet,
      sameDirectionYears: [...output.primaryComparison.sameDirectionYears],
      supported: output.primaryComparison.supported,
      note: output.primaryComparison.note,
    },
    secondaryComparisons: output.secondaryComparisons.map((comparison) => ({
      key: comparison.key,
      classification: comparison.classification,
      pointEstimate: comparison.difference.pointEstimate,
      low: comparison.difference.blockPrimary?.low ?? null,
      high: comparison.difference.blockPrimary?.high ?? null,
      note: comparison.note,
    })),
    studyVerdict: {
      verdict: output.studyVerdict.verdict,
      reasons: [...output.studyVerdict.reasons],
    },
    coverage: { ...output.coverage },
    contractGaps: [...output.contractGaps],
  };

  // ---- 表 1：五组总览 --------------------------------------------------
  const overviewTable = {
    key: "observation-window-group-overview",
    title: "五组矩阵总览（N / L / 再入场政策 × R 臂读数）",
    description:
      "A/B/C/D 只改 N、L；D/E 只改再入场政策。所有账户独立、均从 100,000 元开始，仓位 = 决策日收盘总权益 × 20%。" +
      "全部账户级指标来自唯一出口 `canonicalMetrics`；尾率为实验侧从 `run.trades` 如实计数（未平仓不进分母）。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "observationDays", label: "N", align: "RIGHT" as const },
      { key: "entryFillMaxRd", label: "L", align: "RIGHT" as const },
      { key: "confirmRange", label: "确认 rd", align: "RIGHT" as const },
      { key: "reentryKind", label: "再入场", align: "LEFT" as const },
      { key: "maxEntriesPerMember", label: "锚点次数上限", align: "RIGHT" as const },
      { key: "accountCount", label: "账户数", align: "RIGHT" as const },
      { key: "candidateDayCount", label: "候选日", align: "RIGHT" as const },
      { key: "candidateRowCount", label: "候选行", align: "RIGHT" as const },
      { key: "triggerAnchorCount", label: "触发锚点", align: "RIGHT" as const },
      { key: "retriggerDayCount", label: "再触发日", align: "RIGHT" as const },
      { key: "fillCount", label: "成交笔数", align: "RIGHT" as const },
      { key: "completedTradeCount", label: "R 已平仓", align: "RIGHT" as const },
      { key: "tail20RatePct", label: "R ≥+20%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail50RatePct", label: "R ≥+50%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "meanReturnPct", label: "R 净均值", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "medianReturnPct", label: "R 净中位", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "winRatePct", label: "R 胜率", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "maxDrawdownPct", label: "R MDD", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "finalCashSharePct", label: "R 现金占比", unit: "%", digits: 2, align: "RIGHT" as const },
      { key: "averageHoldingPeriod", label: "R 平均持有", unit: "日", digits: 2, align: "RIGHT" as const },
      { key: "totalReturnPct", label: "R 复合总收益", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomTail20RatePct", label: "Random ≥+20%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail20RateDifference", label: "R − Random", digits: 6, align: "RIGHT" as const },
      { key: "verdict", label: "判定", align: "LEFT" as const },
    ],
    rows: output.groups.map(groupSummaryRow),
  };

  // ---- 表 2：逐组尾部读数（含均值/中位/胜率/MDD/现金/持有/拒单）--------
  const tailTable = {
    key: "observation-window-tail-rates",
    title: "逐组尾部与风险读数：R vs pooled Random（按**真实入场日**聚簇）",
    description:
      "分母 = 已平仓交易（`openAtEnd === false` 且 `returnPct !== null`）；期末未平仓**不进**尾率（另见覆盖表）。" +
      "pooled Random 的胜率 / 持有期取 200 个账户的合并口径，MDD 与现金占比取账户中位数。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "block", label: "口径", align: "LEFT" as const },
      { key: "tradeCount", label: "交易笔数", align: "RIGHT" as const },
      { key: "completedTradeCount", label: "已平仓", align: "RIGHT" as const },
      { key: "openAtEndCount", label: "期末未平仓", align: "RIGHT" as const },
      { key: "hit20Count", label: "≥+20% 笔数", align: "RIGHT" as const },
      { key: "tail20RatePct", label: "≥+20%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail50RatePct", label: "≥+50%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail100RatePct", label: "≥+100%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "loss20RatePct", label: "≤−20%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "meanReturnPct", label: "净均值", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "medianReturnPct", label: "净中位", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "winRatePct", label: "胜率", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "maxDrawdownPct", label: "MDD", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "finalCashSharePct", label: "期末现金占比", unit: "%", digits: 2, align: "RIGHT" as const },
      { key: "averageHoldingPeriod", label: "平均持有", unit: "日", digits: 2, align: "RIGHT" as const },
      { key: "fillCount", label: "成交笔数", align: "RIGHT" as const },
      { key: "skippedIntentCount", label: "被跳过意图", align: "RIGHT" as const },
      { key: "rejectedOrderCount", label: "被拒订单", align: "RIGHT" as const },
      { key: "uniqueTail20AnchorCount", label: "≥+20% 唯一锚点", align: "RIGHT" as const },
    ],
    rows: output.groups.flatMap(tailRateTableRows),
  };

  // ---- 表 3：组间 / 组内配对 bootstrap --------------------------------
  const comparisonRows: Record<string, ExperimentCell>[] = [];
  const pushComparison = (
    key: string,
    label: string,
    classification: ComparisonClass,
    difference: PairedDifference,
  ): void => {
    comparisonRows.push({
      comparison: key,
      label,
      classification,
      variant: "block20 主口径",
      pointEstimate: difference.pointEstimate,
      ...bootstrapCells(difference.blockPrimary),
    });
    comparisonRows.push({
      comparison: key,
      label,
      classification,
      variant: "block40 敏感性",
      pointEstimate: difference.pointEstimate,
      ...bootstrapCells(difference.blockSensitivity),
    });
    comparisonRows.push({
      comparison: key,
      label,
      classification,
      variant: "block20 锚点链归属首笔入场日",
      pointEstimate: difference.pointEstimate,
      ...bootstrapCells(difference.anchorChainPrimary),
    });
    comparisonRows.push({
      comparison: key,
      label,
      classification,
      variant: "block20 均值差（配对）",
      pointEstimate: difference.meanPrimary !== null
        ? (difference.meanPrimary.low + difference.meanPrimary.high) / 2
        : null,
      ...bootstrapCells(difference.meanPrimary),
    });
  };
  for (const group of output.groups) {
    pushComparison(
      `${group.group.id}_R − ${group.group.id}_Random`,
      `${group.group.id}：R − pooled Random`,
      "SECONDARY_DESCRIPTIVE",
      group.tail.difference,
    );
  }
  pushComparison(
    output.primaryComparison.key,
    output.primaryComparison.label,
    output.primaryComparison.classification,
    output.primaryComparison.difference,
  );
  for (const comparison of output.secondaryComparisons) {
    pushComparison(comparison.key, comparison.label, comparison.classification, comparison.difference);
  }
  const comparisonTable = {
    key: "observation-window-paired-bootstrap",
    title: "配对日期移动块 bootstrap（同一组交易日块索引；比率 = 分子分母同簇重采样）",
    description:
      "唯一主要比较 = `D_R − B_R`；`D_R − E_R` / `B_R − A_R` / `C_R − B_R` 与各组 `R − Random` 均为次要/描述性。" +
      "block20 主口径 / block40 敏感性（1000 次，95% 双侧，固定种子 20261010 / 20261011）；" +
      "另有「整条锚点链归属其首笔入场日」的敏感性。零分母迭代次数单列。",
    columns: [
      { key: "comparison", label: "比较", align: "LEFT" as const },
      { key: "classification", label: "类别", align: "LEFT" as const },
      { key: "variant", label: "口径", align: "LEFT" as const },
      ...intervalColumns(),
    ],
    rows: comparisonRows,
  };

  // ---- 表 4：候选日人数分布 + P3 排序分辨力 ---------------------------
  const headcountTable = {
    key: "observation-window-candidate-headcount",
    title: "候选日人数分布（≤2 / =3 / >3）与 P3 排序分辨力",
    description:
      "人数 = 当日**原始买点候选池**的锚点数。=3 与 >3 的日子才是排序真正面临选择的日子；" +
      "P3 只在**最终触发候选池**上统计（不同取值数、最大取值占比、边界并列规模、破平键）。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "candidateDayCount", label: "候选日", align: "RIGHT" as const },
      { key: "daysLe2", label: "≤2 人日", align: "RIGHT" as const },
      { key: "daysEq3", label: "=3 人日", align: "RIGHT" as const },
      { key: "daysGt3", label: ">3 人日", align: "RIGHT" as const },
      { key: "candidateRowCount", label: "候选行", align: "RIGHT" as const },
      { key: "distinctPreReturn10Count", label: "不同因子取值数", align: "RIGHT" as const },
      { key: "maxValueSharePct", label: "最大取值占比", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "boundaryTieDayCount", label: "边界并列日", align: "RIGHT" as const },
      { key: "boundaryTieSizeMedian", label: "边界并列中位", digits: 2, align: "RIGHT" as const },
      { key: "boundaryTieSizeMax", label: "边界并列最大", digits: 0, align: "RIGHT" as const },
      { key: "tieBreakKey", label: "破平键", align: "LEFT" as const },
    ],
    rows: output.groups.map((group) => ({
      group: group.group.id,
      candidateDayCount: group.candidateDayCount,
      daysLe2: group.poolSizeHistogram.le2,
      daysEq3: group.poolSizeHistogram.eq3,
      daysGt3: group.poolSizeHistogram.gt3,
      candidateRowCount: group.candidateRowCount,
      distinctPreReturn10Count: group.rankingResolution.distinctPreReturn10Count,
      maxValueSharePct: group.rankingResolution.maxValueSharePct,
      boundaryTieDayCount: group.rankingResolution.boundaryTieDayCount,
      boundaryTieSizeMedian: group.rankingResolution.boundaryTieSizeMedian,
      boundaryTieSizeMax: group.rankingResolution.boundaryTieSizeMax,
      tieBreakKey: group.rankingResolution.tieBreakKey,
    })),
  };

  // ---- 表 5：成交年龄分布 ---------------------------------------------
  const fillAgeTable = {
    key: "observation-window-fill-age",
    title: "成交年龄分布（实际成交相对锚点的 rd）与 N/L 边界诊断",
    description:
      "成交年龄 = 该锚点下实际成交日的相对日（rd = confirmRd + 1）。边界列给出 observed min/max 与「是否出现越界」。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "fillRd", label: "成交 rd", align: "RIGHT" as const },
      { key: "fillCount", label: "成交笔数", align: "RIGHT" as const },
      { key: "uniqueAnchorCount", label: "唯一锚点", align: "RIGHT" as const },
      { key: "completedTradeCount", label: "已平仓", align: "RIGHT" as const },
      { key: "hit20Count", label: "≥+20%", align: "RIGHT" as const },
      { key: "tail20RatePct", label: "≥+20% 比例", unit: "%", digits: 4, align: "RIGHT" as const },
    ],
    rows: output.groups.flatMap((group) =>
      group.fillAge.map((row) => ({
        group: group.group.id,
        fillRd: row.fillRd,
        fillCount: row.fillCount,
        uniqueAnchorCount: row.uniqueAnchorCount,
        completedTradeCount: row.completedTradeCount,
        hit20Count: row.hit20Count,
        tail20RatePct: pct(row.tail20Rate),
      })),
    ),
  };

  const boundaryTable = {
    key: "observation-window-nl-boundary",
    title: "N/L 边界诊断（目标 §5 预检闸门）",
    description:
      "`fillRdViolationCount` 必须为 0：账户层硬门禁不把 `confirmRd + 1 > L` 的意图放进 sourceRun。" +
      "`below/above` 是观察池里落在本组确认区间之外的行数（越界记账，不是候选）。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "observationDays", label: "N", align: "RIGHT" as const },
      { key: "entryFillMaxRd", label: "L", align: "RIGHT" as const },
      { key: "confirmRange", label: "确认 rd 区间", align: "RIGHT" as const },
      { key: "observedMinConfirmRd", label: "实测最小确认 rd", align: "RIGHT" as const },
      { key: "observedMaxConfirmRd", label: "实测最大确认 rd", align: "RIGHT" as const },
      { key: "observedMinFillRd", label: "实测最小成交 rd", align: "RIGHT" as const },
      { key: "observedMaxFillRd", label: "实测最大成交 rd", align: "RIGHT" as const },
      { key: "candidatesAtMinConfirmRd", label: "区间下界候选", align: "RIGHT" as const },
      { key: "candidatesAtMaxConfirmRd", label: "区间上界候选", align: "RIGHT" as const },
      { key: "candidatesAtFillCap", label: "成交到 cap 的候选", align: "RIGHT" as const },
      { key: "fillRdViolationCount", label: "越界候选（须 0）", align: "RIGHT" as const },
      { key: "belowConfirmMinDayCount", label: "区间前观察日", align: "RIGHT" as const },
      { key: "aboveConfirmMaxDayCount", label: "区间后观察日", align: "RIGHT" as const },
    ],
    rows: output.groups.map((group) => ({
      group: group.group.id,
      observationDays: group.boundary.observationDays,
      entryFillMaxRd: group.boundary.entryFillMaxRd,
      confirmRange: `${group.boundary.confirmMinRd}..${group.boundary.confirmMaxRd}`,
      observedMinConfirmRd: group.boundary.observedMinConfirmRd,
      observedMaxConfirmRd: group.boundary.observedMaxConfirmRd,
      observedMinFillRd: group.boundary.observedMinFillRd,
      observedMaxFillRd: group.boundary.observedMaxFillRd,
      candidatesAtMinConfirmRd: group.boundary.candidatesAtMinConfirmRd,
      candidatesAtMaxConfirmRd: group.boundary.candidatesAtMaxConfirmRd,
      candidatesAtFillCap: group.boundary.candidatesAtFillCap,
      fillRdViolationCount: group.boundary.fillRdViolationCount,
      belowConfirmMinDayCount: group.boundary.belowConfirmMinDayCount,
      aboveConfirmMaxDayCount: group.boundary.aboveConfirmMaxDayCount,
    })),
  };

  // ---- 表 6：逐层排除账 -----------------------------------------------
  const exclusionTable = {
    key: "observation-window-exclusion-ledger",
    title: "逐层排除 / 归因账（观察 → 回撤 → 支撑 → N 日得分 → 突破 → 候选 → 下单 → 成交 → 退出）",
    description:
      "首次失效（支撑永久作废的**首次**观察日）与重复拒绝日（此后每天的再次拒绝）**分开计数**。" +
      "下单 / 成交 / 退出层是组内 201 个账户的**合计**；观察层是「锚点 × 决策日」行级计数。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "layer", label: "层", align: "LEFT" as const },
      { key: "code", label: "原因码", align: "LEFT" as const },
      { key: "count", label: "计数", align: "RIGHT" as const },
      { key: "unit", label: "单位", align: "LEFT" as const },
      { key: "note", label: "说明", align: "LEFT" as const },
    ],
    rows: output.groups.flatMap((group) =>
      group.exclusionLedger.map((row) => ({
        group: row.group,
        layer: row.layer,
        code: row.code,
        count: row.count,
        unit: row.unit,
        note: row.note,
      })),
    ),
  };

  // ---- 表 7：再入场账（汇总口径）--------------------------------------
  const reentryTable = {
    key: "observation-window-reentry",
    title: "再入场账：第 n 笔建仓的成交数 / 尾率 / 均值 / 净损益",
    description:
      "首次 / 第二次及后续**分开**报告。命中一笔大涨但整条链净亏的锚点数单列。" +
      "未成交尝试另记（CSV 产物），**不**增加成功入场序号。D/E 差异包含现金、名额与后续选择联动，" +
      "**不得**把「D 中第二次交易利润之和」冒充整个政策增量。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "entryOrdinal", label: "第 n 笔", align: "RIGHT" as const },
      { key: "tradeCount", label: "成交笔数", align: "RIGHT" as const },
      { key: "completedCount", label: "已平仓", align: "RIGHT" as const },
      { key: "hit20Count", label: "≥+20%", align: "RIGHT" as const },
      { key: "tail20RatePct", label: "≥+20% 比例", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "meanReturnPct", label: "净均值", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "medianReturnPct", label: "净中位", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "netPnlSum", label: "净损益合计", unit: "元", digits: 2, align: "RIGHT" as const },
    ],
    rows: output.groups.flatMap((group) =>
      group.reentry.ordinals.map((row) => ({
        group: row.group,
        entryOrdinal: row.entryOrdinal,
        tradeCount: row.tradeCount,
        completedCount: row.completedCount,
        hit20Count: row.hit20Count,
        tail20RatePct: pct(row.tail20Rate),
        meanReturnPct: row.meanReturnPct,
        medianReturnPct: row.medianReturnPct,
        netPnlSum: row.netPnlSum,
      })),
    ),
  };

  const reentryAnchorTable = {
    key: "observation-window-reentry-anchors",
    title: "再入场的锚点级口径（唯一命中门槛 + 整条链净损益）",
    description:
      "每个锚点在「≥+20% 唯一命中」里最多计一次；同锚点整条交易链共同归属锚点**首笔入场日**做日期块敏感性。" +
      "锚点净损益不是账户复合收益的替代值。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "filledAnchorCount", label: "有成交的锚点", align: "RIGHT" as const },
      { key: "anchorWithAtLeastOneHit20Count", label: "≥1 笔 ≥+20% 的锚点", align: "RIGHT" as const },
      { key: "anchorChainHitButNetLossCount", label: "命中但整链净亏的锚点", align: "RIGHT" as const },
      { key: "anchorChainNetPnlSum", label: "锚点链净损益合计", unit: "元", digits: 2, align: "RIGHT" as const },
      { key: "failedAttemptCount", label: "未成交尝试", align: "RIGHT" as const },
    ],
    rows: output.groups.map((group) => ({
      group: group.group.id,
      filledAnchorCount: group.reentry.filledAnchorCount,
      anchorWithAtLeastOneHit20Count: group.reentry.anchorWithAtLeastOneHit20Count,
      anchorChainHitButNetLossCount: group.reentry.anchorChainHitButNetLossCount,
      anchorChainNetPnlSum: group.reentry.anchorChainNetPnlSum,
      failedAttemptCount: group.reentry.failedAttemptCount,
    })),
  };

  // ---- 表 8：年度信号尾率（靶 = tail20RateDifference）------------------
  const yearlyTailTable = {
    key: "observation-window-yearly-tail",
    title: "年度信号尾率（靶 = ≥+20% 尾率差；闸门只看 2024 / 2025）",
    description:
      "🔴 修正 5：年度同向判据用的是**实际成交尾率差**，**不是**账户年度权益收益（后者见下一张表）。" +
      "2026 只有在主决策窗口内确有新入场时才进入信号闸门，否则只作退出尾部单列。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "year", label: "年", align: "RIGHT" as const },
      { key: "rCompletedCount", label: "R 已平仓", align: "RIGHT" as const },
      { key: "rHit20Count", label: "R ≥+20%", align: "RIGHT" as const },
      { key: "rTail20RatePct", label: "R 尾率", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomCompletedCount", label: "Random 已平仓", align: "RIGHT" as const },
      { key: "randomHit20Count", label: "Random ≥+20%", align: "RIGHT" as const },
      { key: "randomTail20RatePct", label: "Random 尾率", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail20RateDifference", label: "尾率差", digits: 6, align: "RIGHT" as const },
      { key: "hasMainWindowEntry", label: "主窗口内有入场", align: "LEFT" as const },
      { key: "inSignalGate", label: "进入信号闸门", align: "LEFT" as const },
    ],
    rows: output.groups.flatMap((group) =>
      group.yearlyTail.map((row) => ({
        group: group.group.id,
        year: row.year,
        rCompletedCount: row.rCompletedCount,
        rHit20Count: row.rHit20Count,
        rTail20RatePct: pct(row.rTail20Rate),
        randomCompletedCount: row.randomCompletedCount,
        randomHit20Count: row.randomHit20Count,
        randomTail20RatePct: pct(row.randomTail20Rate),
        tail20RateDifference: row.tail20RateDifference,
        hasMainWindowEntry: row.hasMainWindowEntry,
        inSignalGate: row.inSignalGate,
      })),
    ),
  };

  const yearlyAccountTable = {
    key: "observation-window-yearly-account-returns",
    title: "年度账户权益收益（**另报**：不参与信号稳定性判据）",
    description:
      "基数 = 上一年末权益，首个年度用初始本金。这一张表是**描述性**的：它不构成「同靶同向」证据。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "year", label: "年", align: "RIGHT" as const },
      { key: "rReturnPct", label: "R 收益", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomMeanReturnPct", label: "Random 均值", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomMedianReturnPct", label: "Random 中位", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomP25ReturnPct", label: "Random p25", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomP75ReturnPct", label: "Random p75", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "randomPositiveSharePct", label: "Random 正收益占比", unit: "%", digits: 2, align: "RIGHT" as const },
    ],
    rows: output.groups.flatMap((group) =>
      group.yearlyAccountReturns.map((row) => ({
        group: group.group.id,
        year: row.year,
        rReturnPct: row.rReturnPct,
        randomMeanReturnPct: row.randomMeanReturnPct,
        randomMedianReturnPct: row.randomMedianReturnPct,
        randomP25ReturnPct: row.randomP25ReturnPct,
        randomP75ReturnPct: row.randomP75ReturnPct,
        randomPositiveSharePct: row.randomPositiveSharePct,
      })),
    ),
  };

  // ---- 表 9：覆盖 / 可观测性 -------------------------------------------
  const coverageTable = {
    key: "observation-window-coverage",
    title: "数据覆盖与可观测性（修正 6 三分类 + 修正 7 Runner 可观测性）",
    description:
      "🔴 三分类是**实验侧启发式**：引擎不暴露「行情用尽」与「停牌无法卖出」的区别。" +
      "🔴 Runner 触发与否在该契约上**不可观测** ⇒ 只报「持有到 74 日」的笔数，**绝不**写「Runner 从未触发」，也不做退出消融。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "tradesTotal", label: "交易笔数", align: "RIGHT" as const },
      { key: "tradesCompleted", label: "已平仓", align: "RIGHT" as const },
      { key: "tradesOpenAtEnd", label: "期末未平仓", align: "RIGHT" as const },
      { key: "mtmValidCount", label: "MTM_VALID（正常期末 MTM）", align: "RIGHT" as const },
      { key: "noExecutionBarCount", label: "NO_EXECUTION_BAR", align: "RIGHT" as const },
      { key: "suspendedCannotSellCount", label: "SUSPENDED_CANNOT_SELL", align: "RIGHT" as const },
      { key: "mtmValidWithRejectedSellEvidenceCount", label: "两类判据重叠", align: "RIGHT" as const },
      { key: "heldToExtendedCapCount", label: "持有到 74 日", align: "RIGHT" as const },
      { key: "runnerBridgeExitReasonCount", label: "Runner Bridge 退出原因", align: "RIGHT" as const },
      { key: "runnerTriggerObservability", label: "Runner 可观测性", align: "LEFT" as const },
      { key: "requiredPostRelativeDayForFullRunner", label: "完整 Runner 所需 rd（L+74）", align: "RIGHT" as const },
      { key: "physicalPostMaxRelativeDay", label: "物理 post 上界", align: "RIGHT" as const },
    ],
    rows: [
      ...output.groups.map((group) => ({ ...group.coverage })),
      { ...output.coverage },
    ],
  };

  // ---- 表 10：判定 ------------------------------------------------------
  const verdictRows: Record<string, ExperimentCell>[] = [
    ...output.groups.map((group) => ({
      scope: `组 ${group.group.id}（R − Random）`,
      verdict: group.verdict.verdict,
      reasons: group.verdict.reasons.join("；"),
    })),
    {
      scope: `唯一主要比较 ${output.primaryComparison.key}`,
      verdict: output.primaryComparison.supported ? "RIGHT_TAIL_EVIDENCE" : output.studyVerdict.verdict,
      reasons: output.primaryComparison.note,
    },
    ...output.secondaryComparisons.map((comparison) => ({
      scope: `次要比较 ${comparison.key}`,
      verdict: comparison.supported ? "RIGHT_TAIL_EVIDENCE" : "INSUFFICIENT_EVIDENCE",
      reasons: comparison.note,
    })),
    {
      scope: "全研究（收口）",
      verdict: output.studyVerdict.verdict,
      reasons: output.studyVerdict.reasons.join("；"),
    },
  ];
  const verdictTable = {
    key: "observation-window-verdicts",
    title: "研究判定（事前收口规则；**不是**投资资格）",
    description:
      "唯一主要比较 = `D_R − B_R`（同期限、同再入场政策下 5 日观察 vs 2 日观察）。" +
      "次要区间**不**作为独立确认性成功判据，也不挑最好组替代主要比较。",
    columns: [
      { key: "scope", label: "范围", align: "LEFT" as const },
      { key: "verdict", label: "判定", align: "LEFT" as const },
      { key: "reasons", label: "理由", align: "LEFT" as const },
    ],
    rows: verdictRows,
  };

  // ---- 表 11：逐账户指标（1005 行，唯一出口 canonicalMetrics）---------
  const accountTable = {
    key: "observation-window-account-metrics",
    title: `逐账户指标（${TOTAL_ACCOUNT_COUNT} 个账户：5 组 ×（R + ${RANDOM_ACCOUNT_COUNT} Random））`,
    description:
      "每组账户 0 = R（`preReturn10` HIGH）；1..200 = 固定种子随机账户（种子 = 20261010 + (accountIndex − 1)，" +
      "五组同 i 同种子）。全部账户级指标来自 `canonicalMetrics`；尾率 / 覆盖计数为实验侧从 `run.trades` 如实计数。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
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
      { key: "finalCashSharePct", label: "期末现金占比", unit: "%", digits: 2, align: "RIGHT" as const },
      { key: "reentryEntryCount", label: "再入场笔数", align: "RIGHT" as const },
      { key: "skippedIntentCount", label: "被跳过意图", align: "RIGHT" as const },
    ],
    rows: output.groups.flatMap((group) =>
      group.accounts.map((account) => ({
        group: account.group,
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
        finalCashSharePct: account.finalCashSharePct,
        reentryEntryCount: account.reentryEntryCount,
        skippedIntentCount: account.skippedIntentCount,
      })),
    ),
  };

  // ---- 表 12：随机分布（R 在同组 200 个随机账户中的位置）--------------
  const distributionTable = {
    key: "observation-window-random-distribution",
    title: "每组 200 个随机账户的指标分布，以及 R 在同一分布中的位置",
    description:
      "R 相对随机账户分布的位置是**描述性对照**，不等于通过随机种子取得市场历史独立性。五组同 i 同种子 ⇒ 同一「随机账户编号」跨组可比。",
    columns: [
      { key: "group", label: "组", align: "LEFT" as const },
      { key: "label", label: "指标", align: "LEFT" as const },
      { key: "unit", label: "单位", align: "LEFT" as const },
      { key: "p05", label: "p05", digits: 4, align: "RIGHT" as const },
      { key: "p25", label: "p25", digits: 4, align: "RIGHT" as const },
      { key: "p50", label: "中位", digits: 4, align: "RIGHT" as const },
      { key: "p75", label: "p75", digits: 4, align: "RIGHT" as const },
      { key: "p95", label: "p95", digits: 4, align: "RIGHT" as const },
      { key: "mean", label: "均值", digits: 4, align: "RIGHT" as const },
      { key: "rValue", label: "R", digits: 4, align: "RIGHT" as const },
      { key: "rPercentile", label: "R 分位", digits: 2, align: "RIGHT" as const },
    ],
    rows: output.groups.flatMap((group) =>
      group.randomDistribution.map((row) => ({ ...row })),
    ),
  };

  // ---- 表 13：逐日池 ----------------------------------------------------
  const poolTable = {
    key: "observation-window-daily-pool",
    title: "逐日原始买点候选池（各组一行；R 与 Random 共享同一池）",
    description:
      "候选 = 当日锚点**触发**连续观察买点（保留**全部**确认日，修正 1）∧ `preReturn10` 可评估 ∧ 身份可解析。" +
      "R 取前 3 名（preReturn10 降序，symbol 升序，eventId 升序）；Random 从同一池均匀无放回取同人数。",
    columns: [
      { key: "date", label: "决策日", align: "LEFT" as const },
      { key: "poolSize", label: "池大小（决策日）", align: "RIGHT" as const },
      { key: "candidateA", label: "A 候选", align: "RIGHT" as const },
      { key: "candidateB", label: "B 候选", align: "RIGHT" as const },
      { key: "candidateC", label: "C 候选", align: "RIGHT" as const },
      { key: "candidateD", label: "D 候选", align: "RIGHT" as const },
      { key: "candidateE", label: "E 候选", align: "RIGHT" as const },
      { key: "rSelected", label: "R 选中（基准组 B）", align: "RIGHT" as const },
    ],
    rows: output.poolDailySummary.map((row) => ({
      date: row.date,
      poolSize: row.poolSize,
      candidateA: row.candidateCountByGroup.A ?? 0,
      candidateB: row.candidateCountByGroup.B ?? 0,
      candidateC: row.candidateCountByGroup.C ?? 0,
      candidateD: row.candidateCountByGroup.D ?? 0,
      candidateE: row.candidateCountByGroup.E ?? 0,
      rSelected: row.rSelected,
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
        `主决策窗口 ${MAIN_WINDOW.startDate} ~ ${MAIN_WINDOW.endDate}；留池 rd1..40（沿用 round-1 锚点规则）；池决策日 ${output.poolDecisionDateCount} 天。`,
        `五组账户合计 ${output.groups.reduce((sum, group) => sum + group.accounts.length, 0)} 个（每组 R 1 + Random ${RANDOM_ACCOUNT_COUNT}），约定合计 ${TOTAL_ACCOUNT_COUNT}。`,
        `执行投影：${output.executionSecurityCount} 个事件作用域证券 / ${output.executionRowCount} 行 / ${output.tradingDayCount} 个交易日 [${output.tradingDayCalendarFirst} ~ ${output.tradingDayCalendarLast}]。`,
        `同一 (tradeDate, securityId) 由两个事件面板给出的 bar 值冲突 ${output.barValueConflictCount} 次（本轮身份含 "::event:"，同一事件行键唯一 ⇒ 冲突应恒为 0）。`,
        `成交日与「决策日序列下一项」不一致 ${output.fillDayCalendarMismatchCount} 次（如实计数，不静默）。`,
        `身份无法解析的事件 ${output.unresolvedIdentityEventCount} 个（响亮计数，不按代码兜底）。`,
        ...output.coverageNotes,
      ],
    },
    tables: [
      overviewTable,
      tailTable,
      comparisonTable,
      headcountTable,
      fillAgeTable,
      boundaryTable,
      exclusionTable,
      reentryTable,
      reentryAnchorTable,
      yearlyTailTable,
      yearlyAccountTable,
      coverageTable,
      distributionTable,
      poolTable,
      accountTable,
      verdictTable,
    ],
    statistics: [
      {
        code: "observation_window_group_count",
        label: "组数",
        value: output.groups.length,
        unit: "组",
        digits: 0,
      },
      {
        code: "observation_window_account_count",
        label: "账户总数",
        value: output.groups.reduce((sum, group) => sum + group.accounts.length, 0),
        unit: "个",
        digits: 0,
      },
      {
        code: "observation_window_primary_difference",
        label: `主比较 ${output.primaryComparison.key} · ≥+20% 尾率差`,
        value: output.primaryComparison.difference.pointEstimate,
        unit: "比例",
        digits: 6,
      },
      {
        code: "observation_window_primary_low",
        label: `主比较 ${output.primaryComparison.key} · block${BOOTSTRAP_BLOCK_PRIMARY} 95% 下界`,
        value: output.primaryComparison.difference.blockPrimary?.low ?? null,
        unit: "比例",
        digits: 6,
      },
      {
        code: "observation_window_primary_zero_denominator",
        label: "主比较 · 零分母迭代次数",
        value: output.primaryComparison.difference.blockPrimary?.zeroDenominatorIterations ?? null,
        unit: "次",
        digits: 0,
      },
      {
        code: "observation_window_coverage_blocked",
        label: "期末未平仓（三分类合计）",
        value: output.coverage.tradesOpenAtEnd,
        unit: "笔",
        digits: 0,
        note: output.coverage.classifierNote,
      },
      {
        code: "observation_window_held_to_extended_cap",
        label: `持有期达到 Runner 续持上界 ${RUNNER_EXTEND_HOLDING_DAYS} 日的笔数`,
        value: output.coverage.heldToExtendedCapCount,
        unit: "笔",
        digits: 0,
        note: output.coverage.runnerObservabilityNote,
      },
    ],
    charts: [
      {
        key: "observation-window-tail20-by-group",
        title: "各组 ≥+20% 尾率：R vs pooled Random",
        kind: "BAR" as const,
        xLabel: "组",
        yLabel: "≥+20% 比例",
        unit: "比例",
        series: [
          {
            key: "r",
            label: "R",
            points: output.groups.map((group) => ({
              x: group.group.id,
              y: group.tail.r.tail20Rate,
            })),
          },
          {
            key: "random",
            label: "pooled Random",
            points: output.groups.map((group) => ({
              x: group.group.id,
              y: group.tail.randomPooled.tail20Rate,
            })),
          },
        ],
      },
      {
        key: "observation-window-primary-difference",
        title: `主比较 ${output.primaryComparison.key}：点估计与 95% 区间`,
        kind: "BAR" as const,
        xLabel: "口径",
        yLabel: "尾率差",
        unit: "比例",
        series: [
          {
            key: "difference",
            label: "尾率差",
            points: [
              { x: "点估计", y: output.primaryComparison.difference.pointEstimate },
              { x: "block20 下界", y: output.primaryComparison.difference.blockPrimary?.low ?? null },
              { x: "block20 上界", y: output.primaryComparison.difference.blockPrimary?.high ?? null },
              { x: "block40 下界", y: output.primaryComparison.difference.blockSensitivity?.low ?? null },
              { x: "block40 上界", y: output.primaryComparison.difference.blockSensitivity?.high ?? null },
            ],
          },
        ],
      },
      {
        key: "observation-window-reentry-ordinals",
        title: "各组「第 n 笔建仓」的成交数（再入场实际发生量）",
        kind: "BAR" as const,
        xLabel: "组 / 第 n 笔",
        yLabel: "成交笔数",
        unit: "笔",
        series: [
          {
            key: "trades",
            label: "成交笔数",
            points: output.groups.flatMap((group) =>
              group.reentry.ordinals.map((row) => ({
                x: `${group.group.id}#${row.entryOrdinal}`,
                y: row.tradeCount,
              })),
            ),
          },
        ],
      },
    ],
    customPayload,
  };
}

/** 契约缺口清单（`experiment.ts` 直接复用，避免两处漂移）。 */
export const OBSERVATION_WINDOW_CONTRACT_GAPS: readonly string[] = CONTRACT_GAPS;
