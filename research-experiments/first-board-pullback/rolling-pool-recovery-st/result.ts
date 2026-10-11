/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` · 结果结构与组装。
 *
 * | 文件 | 回答的问题 |
 * | --- | --- |
 * | `experiment.ts` | 研究什么、怎么算（元数据 + 取数 + 两组买点 + **ST 覆盖闸门** + 真实撮合 + 统计） |
 * | `result.ts` | 结果长什么样（自有 schema + 表格 / 统计怎么组装） |
 *
 * 🔴 schema 与组装函数**必须同文件**：口径与产物放一起，schema 就不可能和真实产物漂移。
 * 🔴 本文件**只** import `zod` / `@shared` 类型 / `@experiments/shared/**` 纯模块 ——
 *    绝不 import `server/**` 运行时（页面会经类型引用它）。
 *
 * ## 🔴 本实验最重要的一条事实
 *
 * **S1 审计判定 ST 源不可 PIT 核验**（`AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md` §0）。
 * 因此 `experiment.ts#run()` 在**任何**撮合之前调用 ST 覆盖闸门（`summarizeStCoverage`）：
 * 只要有一个计划检查时点缺可核验结论（或 provider 在窗口探针上无结论），Run 就以
 * **`ST_COVERAGE_BLOCKED`** 收口 —— 但**不是**抛异常，而是
 * `assembleRecoveryStBlockedResult(...)` **正常返回**一份显式暂停结果：
 *
 * - `customPayload.status = "ST_COVERAGE_BLOCKED"` / `matrixEmitted = false`；
 * - `eligibleCount = 0`、收益类统计一律 `value: null`（**不是 0**）；
 * - **没有**交易 / 权益 / 收益表与图；
 * - 交付的产物**只有覆盖缺口**（`st-coverage-gap-summary.json` / `status-coverage.csv` / …）。
 *
 * 🔴 为什么不是 `throw`：平台 Runner 在失败路径**丢弃全部产物**
 * （`server/researchExperiments/runner.ts`：`artifactFiles: failure === null ? artifactFiles : []`），
 * 于是「先交付覆盖缺口」（目标 §4）就只剩下异常消息里的一段文字。抛异常入口仍保留给
 * 「宁可失败也不产出」的直接调用方（`experiment.ts#stCoverageReportOf`）。
 */
import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
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
import {
  CONFIRM_MAX_RD,
  CONFIRM_MIN_RD,
  RECOVERY_COMPUTATION_VERSION,
  RECOVERY_GROUP_IDS,
  RECOVERY_WINDOW_DAYS,
  REPAIR_SCORE_TOTAL_MIN,
  WATCH_MAX_RD,
  type RecoveryGroupId,
} from "@experiments/shared/rollingPoolRecovery";
import {
  DEFAULT_BOOTSTRAP_QUANTILES,
  type BootstrapQuantiles,
} from "@experiments/shared/dateClusterBootstrap";

/** 本实验计算口径版本（= `descriptor.version`，同时是 customPayload 的 `z.literal`）。 */
export const COMPUTATION_VERSION = RECOVERY_COMPUTATION_VERSION;

// ---------------------------------------------------------------------------
// 一、冻结配置（目标 §2 / §5，逐字；`experiment.ts` 在运行期再断言一次）
// ---------------------------------------------------------------------------

/** 主决策窗口（与 001/002/003 逐字一致：同一窗口的探索性续研，**不是**新 OOS）。 */
export const MAIN_WINDOW = ROUND1_MAIN_WINDOW;

export const FROZEN_DATASET_CODE = FIRST_BOARD_DATASET_CODE;
export const FROZEN_DATASET_VERSION = FROZEN_DATASET_VERSION_LABEL;
/** 参考坐标（只读核验用；运行期以 `dataset.facts.datasetVersionId` 为准）。 */
export const FROZEN_DATASET_VERSION_ID_REFERENCE = 780_004;
/** 参考数据集物理 post 上界（`postWindowDays=80`）。 */
export const FROZEN_DATASET_POST_MAX_RELATIVE_DAY = 80;

/** 每日候选上限（人数不足**不补齐**）。 */
export const DAILY_TOP_K = TOP_K;
/** 随机账户数缺省 = 20 ⇒ 每组 `R + 20 Random` = 21 账户；两组共 **42**。 */
export const RANDOM_ACCOUNT_COUNT_DEFAULT = 20;
/** 实现支持的上界（本任务**不自动扩跑**；扩跑需独立参数记录与**新 Run**）。 */
export const RANDOM_ACCOUNT_COUNT_MAX = 200;
/** SMOKE：每组 `R + 第 1/2 个种子` = 3 账户；两组共 **6**。 */
export const SMOKE_RANDOM_ACCOUNT_COUNT = 2;
/** `seedIndex = RANDOM_SEED_INDEX_BASE + i`（i = 0..N−1；两组同 i 同种子 = 同一个「随机账户编号」）。 */
export const RANDOM_SEED_INDEX_BASE = RANDOM_SEED_BASE;

/** 账户冻结参数（目标 §5，逐字）。 */
export const INITIAL_CAPITAL = 100_000;
export const MAX_POSITIONS = 5;
export const MAX_DAILY_BUYS = 2;
/**
 * 每笔预算 = **决策日收盘当前总权益 × 20%**（`EQUITY_FRACTION`）。
 *
 * 🔴 此处是**字面量副本**：`result.ts` 不得运行时 import `server/**`；
 *    `experiment.ts` 在运行期用真实导出断言两者相等（漂移即响亮失败）。
 */
export const POSITION_FRACTION = 0.2;
/** 冻结 Runner 续持上界（持有日）——同样由 `experiment.ts` 断言未漂移。 */
export const RUNNER_EXTEND_HOLDING_DAYS = RUNNER_EXTEND_TO_HOLDING_DAYS;
/** 组合执行仍需要约 `rd94`（`L=20 + 73`）；Dataset 只到 rd80（S1 审计 §2 已实测零暴露）。 */
export const REQUIRED_POST_RELATIVE_DAY_FOR_FULL_RUNNER = 20 + RUNNER_EXTEND_HOLDING_DAYS;

/** 冻结退出政策的唯一继承物坐标（`experiment.ts` 断言指纹与版本行主键未漂移）。 */
export const FROZEN_STRATEGY_REFERENCE = Object.freeze({
  strategyVersionId: 3_600_005,
  strategyId: "first-limit-pullback-3f-top3-runner-t74",
  version: "2.0.0",
  fingerprint: "f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c",
  referenceRunId: "eval-3600005-promoted-t74",
});

/** 统计口径（目标 §6）：配对日期块 bootstrap、1000 次、95% 双侧。 */
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_PRIMARY = 20;
export const BOOTSTRAP_BLOCK_SENSITIVITY = 40;
export const BOOTSTRAP_SEED_PRIMARY = RANDOM_SEED_BASE;
export const BOOTSTRAP_SEED_SENSITIVITY = 20_261_011;
export const BOOTSTRAP_QUANTILES_95: BootstrapQuantiles = DEFAULT_BOOTSTRAP_QUANTILES;

/** 尾部阈值（%）：≥+20% 是**主靶**，50/100 是稀疏辅助（**不挑阈值**）。 */
export const TAIL_THRESHOLDS_PCT = [20, 50, 100] as const;
export const LEFT_TAIL_THRESHOLD_PCT = -20;
/** 事前判据要求的**最小唯一命中锚点数**（每组，目标 §6）。 */
export const MIN_UNIQUE_TAIL_ANCHORS = 50;
/** 逐年前 3 / 5 个交易日的不利波动（目标 §6 次要清单）。 */
export const ADVERSE_EXCURSION_HORIZONS = [3, 5] as const;
/** 逐年报告闸门年度（主窗口内）。 */
export const GATE_YEARS = [2024, 2025] as const;

// ---------------------------------------------------------------------------
// 二、两组矩阵（目标 §2，逐字冻结）
// ---------------------------------------------------------------------------

/** 组 id 与规则库的 `RecoveryGroupId` **同字面量**（避免两套命名）。 */
export const GROUP_IDS = RECOVERY_GROUP_IDS;
export type GroupId = RecoveryGroupId;

/** 破位后的处置方式：A 永久停买；B 进入 §3.3 修复分支。 */
export const BREACH_POLICIES = ["PERMANENT_DISABLE", "RECOVERY_AFTER_BREACH"] as const;
export type BreachPolicy = (typeof BREACH_POLICIES)[number];

export interface RecoveryGroupSpec {
  readonly id: GroupId;
  /** 规则库里的组名（与 `id` 同字面量；此处显式保留以便 grep）。 */
  readonly recoveryGroup: RecoveryGroupId;
  readonly breachPolicy: BreachPolicy;
  /** 最晚**实际成交**相对日 `L`（两组同 T+20，**不增加 T+40 对照**）。 */
  readonly entryFillMaxRd: number;
  readonly confirmMinRd: number;
  readonly confirmMaxRd: number;
  /** 原分支观察日数 N（两组相同）。 */
  readonly originalObservationDays: number;
  /** 破位后修复分支的窗口长度与综合分下限。 */
  readonly repairWindowDays: number;
  readonly repairScoreTotalMin: number;
  readonly label: string;
  readonly purpose: string;
}

const GROUP_SPECS: Readonly<Record<GroupId, RecoveryGroupSpec>> = Object.freeze({
  A_STRICT_20: Object.freeze({
    id: "A_STRICT_20",
    recoveryGroup: "A_STRICT_20",
    breachPolicy: "PERMANENT_DISABLE",
    entryFillMaxRd: 20,
    confirmMinRd: CONFIRM_MIN_RD,
    confirmMaxRd: CONFIRM_MAX_RD,
    originalObservationDays: 5,
    repairWindowDays: RECOVERY_WINDOW_DAYS,
    repairScoreTotalMin: REPAIR_SCORE_TOTAL_MIN,
    label: "A · STRICT_20（003 的 D：N=5 / T+20 / 破位永久停买）",
    purpose: "原规则对照：首次可靠破位后**永久**禁止该锚点买入（继续观察）",
  }),
  B_RECOVERY_20: Object.freeze({
    id: "B_RECOVERY_20",
    recoveryGroup: "B_RECOVERY_20",
    breachPolicy: "RECOVERY_AFTER_BREACH",
    entryFillMaxRd: 20,
    confirmMinRd: CONFIRM_MIN_RD,
    confirmMaxRd: CONFIRM_MAX_RD,
    originalObservationDays: 5,
    repairWindowDays: RECOVERY_WINDOW_DAYS,
    repairScoreTotalMin: REPAIR_SCORE_TOTAL_MIN,
    label: "B · RECOVERY_20（未破位同 A；破位后走五日综合修复分支）",
    purpose: "修复再触发：局部低点 `F` + `W=[d−5,d−1]` 综合分 ≥15 + 确认日突破放量",
  }),
});

/** 两组主配置（顺序 = 展示顺序；`A` 在前 = 对照臂）。 */
export const GROUPS: readonly RecoveryGroupSpec[] = Object.freeze([
  GROUP_SPECS.A_STRICT_20,
  GROUP_SPECS.B_RECOVERY_20,
]);

export function groupSpecOf(id: GroupId): RecoveryGroupSpec {
  return GROUP_SPECS[id];
}

/** 每组账户数 = `1 + randomAccountCount`。 */
export function accountsPerGroupOf(randomAccountCount: number): number {
  return 1 + randomAccountCount;
}
/** 合计账户数（两组）。 */
export function totalAccountCountOf(randomAccountCount: number): number {
  return accountsPerGroupOf(randomAccountCount) * GROUPS.length;
}
/** 随机种子序号（`i = 0..count−1` ⇒ `seedIndex = 20261010 + i`）。 */
export function randomSeedIndexesOf(randomAccountCount: number): readonly number[] {
  return Array.from({ length: randomAccountCount }, (_unused, index) => RANDOM_SEED_INDEX_BASE + index);
}

/** 运行模式（**工具不得自动扩跑**；扩跑需独立参数记录与新 Run）。 */
export const RUN_MODES = ["SMOKE", "STUDY", "CUSTOM"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface RunModeResolution {
  readonly mode: RunMode;
  readonly randomAccountCount: number;
  readonly accountsPerGroup: number;
  readonly groupCount: number;
  readonly totalAccountCount: number;
  readonly seedIndexes: readonly number[];
  readonly note: string;
}

/**
 * `randomAccountCount` ⇒ 运行模式。
 *
 * - `2` ⇒ **SMOKE**（两组 `R + 前 2 个种子` = 6 账户；只验证工程正确，不做收益筛选）；
 * - `20` ⇒ **STUDY**（两组 `R + 20 随机` = 42 账户；目标 §2 的默认正式产物）；
 * - 其他（含 200）⇒ `CUSTOM`：**如实标注**，需独立 Run，不覆盖 42 账户产物。
 *
 * 🔴 本函数**不触发任何运行**：它只把参数翻译成坐标，供 `run()` 记录进冻结配置。
 */
export function resolveRunMode(randomAccountCount: number): RunModeResolution {
  if (!Number.isInteger(randomAccountCount) || randomAccountCount < 1) {
    throw new Error(
      `RECOVERY-ST-004：randomAccountCount 必须是 >=1 的整数，实际 ${randomAccountCount}。`,
    );
  }
  if (randomAccountCount > RANDOM_ACCOUNT_COUNT_MAX) {
    throw new Error(
      `RECOVERY-ST-004：randomAccountCount=${randomAccountCount} 超出上界 `
      + `${RANDOM_ACCOUNT_COUNT_MAX}（实现支持 200，但扩跑需独立 Run）。`,
    );
  }
  const mode: RunMode = randomAccountCount === SMOKE_RANDOM_ACCOUNT_COUNT
    ? "SMOKE"
    : randomAccountCount === RANDOM_ACCOUNT_COUNT_DEFAULT
      ? "STUDY"
      : "CUSTOM";
  const accountsPerGroup = accountsPerGroupOf(randomAccountCount);
  const totalAccountCount = totalAccountCountOf(randomAccountCount);
  const note = mode === "SMOKE"
    ? `SMOKE：两组 × (R + ${randomAccountCount} 随机) = ${totalAccountCount} 账户；只验证工程正确，`
      + "**不做收益筛选**（阶段结果不得说成 42 账户研究完成）。"
    : mode === "STUDY"
      ? `STUDY：两组 × (R + ${randomAccountCount} 随机) = ${totalAccountCount} 账户；`
        + "这是目标 §2 的默认正式产物（EXPLORATORY）。"
      : `CUSTOM：randomAccountCount=${randomAccountCount} ⇒ ${totalAccountCount} 账户；`
        + "**不是** SMOKE(6) 也不是 STUDY(42)，需独立参数记录与新 Run，**不覆盖** 42 账户产物。";
  return {
    mode,
    randomAccountCount,
    accountsPerGroup,
    groupCount: GROUPS.length,
    totalAccountCount,
    seedIndexes: randomSeedIndexesOf(randomAccountCount),
    note,
  };
}

// ---------------------------------------------------------------------------
// 三、自有结构（由 `experiment.ts` 产出）
// ---------------------------------------------------------------------------

/** 单账户的 canonical 指标 + 覆盖事实（**唯一指标出口 = `canonicalMetrics`**）。 */
export interface AccountMetrics {
  readonly group: GroupId;
  /** 组内账户序号：0 = R，1..N = Random。 */
  readonly accountIndex: number;
  readonly kind: "R" | "RANDOM";
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
  readonly averageHoldingPeriod: number | null;
  readonly finalCashSharePct: number | null;
  readonly skippedIntentCount: number;
  readonly fillCount: number;
  readonly rejectedOrderCount: number;
  /** 该账户「第 2 笔及以后」的建仓笔数（再入场实际发生量）。 */
  readonly reentryEntryCount: number;
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
  readonly uniqueTail20AnchorCount: number;
  readonly uniqueTail20StockCount: number;
  readonly fillCount: number;
  readonly skippedIntentCount: number;
  readonly rejectedOrderCount: number;
}

/** 「≥+20% 唯一锚点覆盖率」（主靶的**分子/分母**）。 */
export interface AnchorCoverage {
  readonly group: GroupId;
  /** 分母 = 共同且数据资格可核实的锚点宇宙大小。 */
  readonly universeAnchorCount: number;
  /** 分子 = 该组内至少一笔**已完成净收益 ≥+20%** 的唯一锚点数。 */
  readonly hitAnchorCount: number;
  /** `hitAnchorCount / universeAnchorCount`（分母 0 ⇒ null，**不填 0**）。 */
  readonly coverage: number | null;
  readonly uniqueStockHitCount: number;
  /** 锚点整链净损益（扣全部试错成本；按锚点聚合）。 */
  readonly anchorChainNetPnlSum: number;
  readonly anchorChainMeanNetPnl: number | null;
}

/** 一次配对 bootstrap 的区间读数。 */
export interface BootstrapInterval {
  readonly low: number;
  readonly high: number;
  readonly iterations: number;
  readonly blockLength: number;
  readonly clusterCount: number;
  readonly seed: number;
  readonly zeroDenominatorIterations: number;
  readonly calendarLength: number;
  readonly ignoredObservationCount: number;
  readonly quantiles: { readonly low: number; readonly high: number };
}

/** 主比较（`B_R − A_R`）：点估计 + block20 主 / block40 敏感性 + 均值型配对差。 */
export interface PrimaryComparison {
  readonly key: string;
  readonly classification: string;
  readonly fromGroup: GroupId;
  readonly toGroup: GroupId;
  readonly pointEstimate: number | null;
  readonly difference: {
    readonly metric: string;
    readonly pointEstimate: number | null;
    readonly blockPrimary: BootstrapInterval | null;
    readonly blockSensitivity: BootstrapInterval | null;
    readonly meanPrimary: BootstrapInterval | null;
  };
  readonly clusterKey: string;
  readonly calendarLength: number;
  readonly sampleGateMet: boolean;
  readonly gateReason: string;
  readonly supported: boolean;
  readonly note: string;
}

/** 一组的不利波动画像（前 3 / 5 个交易日）。 */
export interface AdverseExcursionRow {
  readonly horizonDays: number;
  readonly sampleCount: number;
  readonly worstPct: number | null;
  readonly meanPct: number | null;
}

/** 单组的完整读数（账户 + 锚点覆盖 + 逐年前 3/5 日波动）。 */
export interface GroupSummary {
  readonly group: GroupId;
  readonly label: string;
  readonly breachPolicy: BreachPolicy;
  readonly decisionDateCount: number;
  readonly candidateRowCount: number;
  readonly triggerAnchorCount: number;
  readonly breachedAnchorCount: number;
  readonly permanentlyDisabledAnchorCount: number;
  readonly recoverySignalCount: number;
  readonly gapBrokenEpisodeCount: number;
  readonly dailyUnknownBlockedDayCount: number;
  readonly dailyStBlockedDayCount: number;
  readonly fillCount: number;
  readonly rejectedOrderCount: number;
  readonly skippedIntentCount: number;
  readonly accounts: readonly AccountMetrics[];
  readonly rTail: TailRateBlock;
  readonly randomPooledTail: TailRateBlock;
  readonly coverage: AnchorCoverage;
  readonly adverseExcursion: readonly AdverseExcursionRow[];
  readonly perYear: readonly {
    readonly year: number;
    readonly universeAnchorCount: number;
    readonly hitAnchorCount: number;
    readonly coverage: number | null;
    readonly rTotalReturnPct: number | null;
  }[];
  readonly configSnapshotJson: string;
}

/** ST 覆盖闸门的读数（**一等状态**：`ST_COVERAGE_BLOCKED` 时没有任何矩阵）。 */
export interface StCoverageReport {
  /** 判别式：**已测**（逐检查点真实统计）。未测路径见 `StCoverageUnscannedReport`。 */
  readonly measurement: "MEASURED";
  readonly status: "ST_COVERAGE_BLOCKED" | "ST_COVERAGE_VERIFIED";
  readonly contractVersion: string;
  readonly providerId: string;
  readonly candidateCount: number;
  readonly timepointChecks: number;
  readonly verifiedNormalCount: number;
  readonly stRejectedCount: number;
  readonly unknownCount: number;
  readonly unknownByTimepoint: Readonly<Record<string, number>>;
  readonly unknownByReason: Readonly<Record<string, number>>;
  readonly gapSamples: readonly {
    readonly anchorEventId: string;
    readonly symbol: string;
    readonly group: string;
    readonly tradeDate: string;
    readonly timepoint: string;
    readonly reason: string;
  }[];
  readonly blocked: boolean;
  readonly note: string;
}

/**
 * FIX-005 / F3 — provider **明确缺失**时的**未测**覆盖读数。
 *
 * 🔴 与 `StCoverageReport` 的区别不是「缺了几个字段」，而是**语义**：
 *    这里**根本没有扫描** post rd≥1（不为再次证明同一缺口重复读全量 post80），
 *    因此候选数 / 覆盖分母一律 `null` = **未测**，**不是** `0`。
 *    `0` 会被读成「查过了、没有候选 / 没有缺口」，与事实相反。
 */
export interface StCoverageUnscannedReport {
  /** 判别式：未测路径的唯一取值。 */
  readonly measurement: "NOT_SCANNED_PROVIDER_ABSENT";
  readonly status: "ST_COVERAGE_BLOCKED";
  readonly contractVersion: string;
  readonly providerId: string;
  readonly candidateCount: null;
  readonly timepointChecks: null;
  readonly verifiedNormalCount: null;
  readonly stRejectedCount: null;
  readonly unknownCount: null;
  readonly unknownByTimepoint: null;
  readonly unknownByReason: null;
  readonly gapSamples: null;
  readonly blocked: true;
  readonly note: string;
}

/** 暂停路径的覆盖读数：**已测**（`StCoverageReport`）或**未测**（`StCoverageUnscannedReport`）。 */
export type StCoverageReading = StCoverageReport | StCoverageUnscannedReport;

// ---------------------------------------------------------------------------
// 六之三、`RECOVERY-LIGHT-ST-007` §4 / §7 问题 5 —— 轻量 ST 政策的来源覆盖与政策描述
// ---------------------------------------------------------------------------

/**
 * 终态（目标 §8，**四选一**）。
 *
 * 🔴 未知 ST 状态**本身不是**停止条件 —— 那是用户已确认的本轮政策。
 * 🔴 `DATA_LIMITED` **只**在「实际缺数据使退出 / 估值 / 指标无法完整计算」时使用；
 *    未平仓 / 尾部截断 / 延长持有**本身**不构成 `DATA_LIMITED`（另列观测）。
 */
export const RECOVERY_ST_TERMINAL_STATES = [
  "EXPLORATORY_COMPLETED",
  "SMOKE_ENGINEERING_FAILED",
  "DATA_LIMITED",
  "EXECUTION_FAILED",
] as const;
export type RecoveryStTerminalState = (typeof RECOVERY_ST_TERMINAL_STATES)[number];

/**
 * 轻量 ST 政策的**来源覆盖与政策描述**读数。
 *
 * 🔴 这些数字是**来源覆盖与政策描述**，**不是**另一个优化目标。
 * 🔴 任何计数为 `null` 都表示**未测**（不是 0）。
 */
export interface RecoveryStEligibilityPolicyBlock {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly parameterValue: string;
  /** `true` ⇒ **不是**严格 PIT 研究。 */
  readonly exploratory: boolean;
  /** `true` ⇒ 缺省政策（未显式选择变体）。 */
  readonly strictDefault: boolean;
  readonly knownStOnly: boolean;
  readonly strictPit: boolean;
  readonly label: string;
  /** `UNKNOWN` 被放行时的唯一措辞（严格模式 ⇒ `null`）。 */
  readonly unknownAllowedThisRoundNote: string | null;
  readonly source: {
    readonly policyId: string;
    readonly policyVersion: string;
    readonly exploratory: true;
    readonly strictPit: false;
    readonly sourceId: string;
    readonly sourceFingerprint: string;
    readonly rowsRead: number;
    readonly securityCount: number;
    readonly identifierRowCount: number;
    readonly explicitNormalRowCount: number;
    readonly availabilityCounts: Readonly<Record<string, number>>;
    readonly confidenceCounts: Readonly<Record<string, number>>;
    readonly tablesRead: readonly string[];
    readonly note: string;
  } | null;
  readonly checks: {
    readonly lookups: number;
    readonly confirmKnownSt: number;
    readonly confirmExplicitNormal: number;
    readonly confirmUnknown: number;
    readonly labelReasonCounts: Readonly<Record<string, number>>;
  };
  readonly counts: {
    readonly labelRowsRead: number | null;
    readonly labelSecurities: number | null;
    readonly identityRowsRead: number | null;
    readonly explicitNormalRowsInSource: number | null;
    readonly knownStExcludedCandidates: number;
    readonly knownStExcludedCandidatesByGroup: Readonly<Record<string, number>>;
    readonly participatingKnownStByGroup: Readonly<Record<string, number>>;
    readonly participatingUnknownByGroup: Readonly<Record<string, number>>;
    readonly participatingExplicitNormalByGroup: Readonly<Record<string, number>>;
    readonly matchingOrders: Readonly<Record<string, number>>;
  };
  readonly strictPitEvidence: {
    readonly status: string;
    readonly blocked: boolean;
    readonly providerId: string;
    readonly providerVerifiable: boolean;
    readonly candidateCount: number;
    readonly timepointChecks: number;
    readonly verifiedNormalCount: number;
    readonly stRejectedCount: number;
    readonly unknownCount: number;
  };
  readonly dataLimited: boolean;
  readonly dataLimitedReasons: readonly string[];
  readonly terminalState: RecoveryStTerminalState;
  readonly note: string;
}

/** `experiment.ts` 交给 `result.ts` 组装的完整计算产物。 */
export interface RecoveryStComputeOutput {
  readonly computationVersion: string;
  readonly runMode: RunModeResolution;
  /**
   * 🔴 `RECOVERY-LIGHT-ST-007`：矩阵路径的**显式终态声明**。
   *
   * 旧代码**从不**产出矩阵 ⇒ 从未写过这两个字段，于是「跑成功并产出矩阵」与
   * 「刻意暂停（`ST_COVERAGE_BLOCKED`）」在信封上无法区分（自动化只能靠猜）。
   * 现在矩阵路径**必须**显式声明：`matrixEmitted = true` +
   * `status ∈ {ST_COVERAGE_VERIFIED（严格）, EXPLORATORY_KNOWN_ST_ONLY（轻量）}`。
   */
  readonly status?: "ST_COVERAGE_VERIFIED" | "EXPLORATORY_KNOWN_ST_ONLY";
  readonly matrixEmitted?: boolean;
  readonly frozenConfig: {
    readonly datasetCode: string;
    readonly datasetVersionId: number;
    readonly datasetVersionLabel: string;
    readonly mainWindowStart: string;
    readonly mainWindowEnd: string;
    readonly positionFraction: number;
    readonly maxPositions: number;
    readonly maxDailyBuys: number;
    readonly initialCapital: number;
    readonly dailyTopK: number;
    readonly randomAccountCount: number;
    readonly randomSeedIndexBase: number;
    readonly runMode: RunMode;
    readonly accountsPerGroup: number;
    readonly totalAccountCount: number;
    readonly supportRatio: number;
    readonly shrinkRatio: number;
    readonly observationMinScore: number;
    readonly runnerExtendHoldingDays: number;
    readonly datasetPostMaxRelativeDay: number;
    readonly strategyVersionId: number;
    readonly strategyVersion: string;
    readonly strategyFingerprint: string;
    readonly referenceRunId: string;
    readonly bootstrapIterations: number;
    readonly bootstrapBlockPrimary: number;
    readonly bootstrapBlockSensitivity: number;
    readonly bootstrapSeedPrimary: number;
    readonly bootstrapSeedSensitivity: number;
    readonly stGateContractVersion: string;
    /**
     * 🔴 `RECOVERY-LIGHT-ST-007` §4：本轮 **ST 资格政策身份**（缺省 = 原严格政策）。
     *
     * 这五个字段使「同一冻结配置冒充两种结果」在结构上不可能：轻量模式跑出的冻结配置
     * 在 `id` / `version` / `parameter` / `exploratory` 四处都与严格模式不同。
     */
    readonly stEligibilityPolicyId: string;
    readonly stEligibilityPolicyVersion: string;
    readonly stEligibilityPolicyParameter: string;
    readonly stEligibilityPolicyExploratory: boolean;
    readonly stEligibilityPolicyStrictDefault: boolean;
    readonly repairWindowDays: number;
    readonly repairScoreTotalMin: number;
    readonly watchMaxRelativeDay: number;
  };
  readonly commonAnchorUniverseSize: number;
  readonly groups: readonly GroupSummary[];
  readonly primaryComparison: PrimaryComparison;
  readonly stCoverage: StCoverageReport | null;
  /**
   * 🔴 `RECOVERY-LIGHT-ST-007` §4：本轮 ST 资格政策的**来源覆盖与政策描述**。
   *
   * 严格模式（缺省）也会填充该块（政策 id = 严格），因此「哪一版政策跑出这个结果」永远可对账。
   */
  readonly stEligibilityPolicy?: RecoveryStEligibilityPolicyBlock | null;
  /** 终态（§8）：`EXPLORATORY_COMPLETED` / `DATA_LIMITED`。 */
  readonly terminalState?: RecoveryStTerminalState;
  readonly contractGaps: readonly string[];
  readonly sampleSummary: {
    readonly candidateCount: number;
    readonly eligibleCount: number;
    readonly excludedCount: number;
    readonly excludedByReason: Record<string, number>;
    readonly notes: readonly string[];
  };
}

// ---------------------------------------------------------------------------
// 四、纯统计原语（可被直接测试，不依赖运行期状态）
// ---------------------------------------------------------------------------

export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}

/** 一次「已完成交易」的锚点事实（**已完成** = 真实平仓且 `returnPct !== null`）。 */
export interface CompletedAnchorFact {
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly returnPct: number;
  readonly netPnl: number | null;
  readonly entryDate: string;
  readonly group: GroupId;
}

/**
 * 主靶的分子/分母。
 *
 * 🔴 分母 = **共同且数据资格可核实的锚点宇宙**（`commonAnchorIds`），
 *    **不是**各组的成交笔数、也**不是**各组的意图数 —— 目标 §6 明确禁止用成交数当唯一分母。
 * 🔴 每个锚点最多计一次（「唯一锚点数」，不是笔数）。
 */
export function anchorCoverageOf(args: {
  readonly group: GroupId;
  readonly commonAnchorIds: ReadonlySet<string>;
  readonly completed: readonly CompletedAnchorFact[];
  readonly thresholdPct?: number;
}): AnchorCoverage {
  const threshold = args.thresholdPct ?? TAIL_THRESHOLDS_PCT[0];
  const hitAnchors = new Set<string>();
  const hitStocks = new Set<string>();
  const netPnlByAnchor = new Map<string, number>();
  for (const fact of args.completed) {
    if (!args.commonAnchorIds.has(fact.anchorEventId)) continue;
    netPnlByAnchor.set(fact.anchorEventId, (netPnlByAnchor.get(fact.anchorEventId) ?? 0) + (fact.netPnl ?? 0));
    if (fact.returnPct >= threshold) {
      hitAnchors.add(fact.anchorEventId);
      hitStocks.add(fact.symbol);
    }
  }
  const universe = [...args.commonAnchorIds];
  const chainValues = [...netPnlByAnchor.values()];
  return {
    group: args.group,
    universeAnchorCount: universe.length,
    hitAnchorCount: hitAnchors.size,
    coverage: universe.length === 0 ? null : hitAnchors.size / universe.length,
    uniqueStockHitCount: hitStocks.size,
    anchorChainNetPnlSum: chainValues.reduce((sum, value) => sum + value, 0),
    anchorChainMeanNetPnl: meanOf(chainValues),
  };
}

/**
 * 逐年的同靶覆盖率 + 账户年度收益（目标 §6「逐年报告相同靶与账户收益」）。
 *
 * 🔴 逐年分母 = 该年内**首次进入观察池**的共同锚点数（同一年同一套宇宙）；
 *    逐年不是 OOS：2024 / 2025 都是**已见探索窗口**。
 */
export function accountCoveragePerYearOf(args: {
  readonly group: GroupId;
  readonly commonAnchorIds: ReadonlySet<string>;
  readonly completed: readonly CompletedAnchorFact[];
  readonly firstPoolDateByAnchor: ReadonlyMap<string, string>;
  readonly yearlyAccountReturns: ReadonlyMap<number, number>;
  readonly thresholdPct?: number;
}): readonly {
  readonly year: number;
  readonly universeAnchorCount: number;
  readonly hitAnchorCount: number;
  readonly coverage: number | null;
  readonly rTotalReturnPct: number | null;
}[] {
  const threshold = args.thresholdPct ?? TAIL_THRESHOLDS_PCT[0];
  const hitAnchors = new Set<string>();
  for (const fact of args.completed) {
    if (!args.commonAnchorIds.has(fact.anchorEventId)) continue;
    if (fact.returnPct >= threshold) hitAnchors.add(fact.anchorEventId);
  }
  const universeByYear = new Map<number, string[]>();
  for (const anchorEventId of args.commonAnchorIds) {
    const date = args.firstPoolDateByAnchor.get(anchorEventId);
    if (date === undefined) continue;
    const year = Number(date.slice(0, 4));
    const list = universeByYear.get(year) ?? [];
    list.push(anchorEventId);
    universeByYear.set(year, list);
  }
  const years = new Set<number>([...universeByYear.keys(), ...args.yearlyAccountReturns.keys()]);
  return [...years].sort((left, right) => left - right).map((year) => {
    const universe = universeByYear.get(year) ?? [];
    const hits = universe.filter((anchorEventId) => hitAnchors.has(anchorEventId)).length;
    return {
      year,
      universeAnchorCount: universe.length,
      hitAnchorCount: hits,
      coverage: universe.length === 0 ? null : hits / universe.length,
      rTotalReturnPct: args.yearlyAccountReturns.get(year) ?? null,
    };
  });
}

export function tailRateBlockOf(args: {
  readonly label: string;
  readonly completedReturns: readonly number[];
  readonly tradeCount: number;
  readonly openAtEndCount: number;
  readonly fillCount: number;
  readonly skippedIntentCount: number;
  readonly rejectedOrderCount: number;
  readonly uniqueTail20AnchorIds: readonly string[];
  readonly uniqueTail20Symbols: readonly string[];
}): TailRateBlock {
  const completed = args.completedReturns;
  const hit = (threshold: number): number => completed.filter((value) => value >= threshold).length;
  const rate = (count: number): number | null => (completed.length === 0 ? null : count / completed.length);
  return {
    label: args.label,
    tradeCount: args.tradeCount,
    completedTradeCount: completed.length,
    openAtEndCount: args.openAtEndCount,
    hit20Count: hit(TAIL_THRESHOLDS_PCT[0]),
    tail20Rate: rate(hit(TAIL_THRESHOLDS_PCT[0])),
    hit50Count: hit(TAIL_THRESHOLDS_PCT[1]),
    tail50Rate: rate(hit(TAIL_THRESHOLDS_PCT[1])),
    hit100Count: hit(TAIL_THRESHOLDS_PCT[2]),
    tail100Rate: rate(hit(TAIL_THRESHOLDS_PCT[2])),
    loss20Count: completed.filter((value) => value <= LEFT_TAIL_THRESHOLD_PCT).length,
    loss20Rate: rate(completed.filter((value) => value <= LEFT_TAIL_THRESHOLD_PCT).length),
    meanReturnPct: meanOf(completed),
    medianReturnPct: medianOf(completed),
    uniqueTail20AnchorCount: new Set(args.uniqueTail20AnchorIds).size,
    uniqueTail20StockCount: new Set(args.uniqueTail20Symbols).size,
    fillCount: args.fillCount,
    skippedIntentCount: args.skippedIntentCount,
    rejectedOrderCount: args.rejectedOrderCount,
  };
}

/**
 * 事前判据（目标 §6）：主/敏感性区间下界 > 0 + 样本门槛。
 *
 * 🔴 任一条不满足 ⇒ `supported = false`（**不是**「证明无效」，而是「证据不足」）。
 * 🔴 样本量不足**不得**靠扩大随机账户数补足（目标 §6 末段）。
 */
export function judgePrimaryComparison(args: {
  readonly fromCoverage: AnchorCoverage;
  readonly toCoverage: AnchorCoverage;
  readonly blockPrimary: BootstrapInterval | null;
  readonly blockSensitivity: BootstrapInterval | null;
  readonly pointEstimate: number | null;
  readonly sameDirectionYears: readonly number[];
  readonly gateYears: readonly number[];
}): { readonly sampleGateMet: boolean; readonly supported: boolean; readonly gateReason: string; readonly note: string } {
  const fromHits = args.fromCoverage.hitAnchorCount;
  const toHits = args.toCoverage.hitAnchorCount;
  const sampleGateMet = fromHits >= MIN_UNIQUE_TAIL_ANCHORS && toHits >= MIN_UNIQUE_TAIL_ANCHORS;
  const gateReason = sampleGateMet
    ? `两组 ≥+20% 唯一命中锚点数 = ${fromHits} / ${toHits}（事前门槛 ≥ ${MIN_UNIQUE_TAIL_ANCHORS}）⇒ 满足。`
    : `两组 ≥+20% 唯一命中锚点数 = ${fromHits} / ${toHits}，未同时达到事前门槛 `
      + `${MIN_UNIQUE_TAIL_ANCHORS} ⇒ 样本量不足，**不得**用扩大随机账户数补足（目标 §6 末段）。`;
  const low = args.blockPrimary?.low ?? null;
  const sensitivityLow = args.blockSensitivity?.low ?? null;
  const supported = sampleGateMet
    && low !== null
    && low > 0
    && (sensitivityLow === null || sensitivityLow > 0)
    && args.gateYears.length > 0
    && args.gateYears.every((year) => args.sameDirectionYears.includes(year));
  return {
    sampleGateMet,
    supported,
    gateReason,
    note: supported
      ? "满足事前条件（主区间下界 > 0、block40 不反向、逐年同向）。这是**探索性历史证据**，"
        + "不能升级为 OOS 通过，也不是盈利承诺。"
      : "未满足全部事前条件 ⇒ `INSUFFICIENT_EVIDENCE`（不等同于证明无效）；**不追**参数或种子找正结论。",
  };
}

// ---------------------------------------------------------------------------
// 五、自有 payload schema（`descriptor.resultSchema`）
// ---------------------------------------------------------------------------

/**
 * 两个终态分支**共有**的字段（逐字相同）。
 *
 * 🔴 `commonAnchorUniverseSize` **刻意不在这里**：它按分支取值 ——
 *    非暂停 ⇒ `number`（锚点宇宙**已计算**）；暂停 ⇒ `null`（**未计算**）。
 *    在暂停路径上写 `0` 会被读成「查过了、但没有锚点」，而事实是
 *    「因为 ST 闸门而根本没有算」—— 两者不是同一件事（与 `notEmittedMetrics` 同一纪律）。
 */
const recoveryStCustomPayloadBaseSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  /**
   * 终态（`.optional()` 是为**向后兼容**：非暂停路径的 `customPayload` 就是计算产物本体）。
   *
   * 🔴 严格暂停只有一种：`ST_COVERAGE_BLOCKED`（覆盖缺口 ⇒ **没有**收益矩阵）。
   *    `EXPLORATORY_KNOWN_ST_ONLY` = `RECOVERY-LIGHT-ST-007` 的**显式政策变体**
   *    （UNKNOWN 可参与 ⇒ 产出矩阵，但**不是**严格 PIT 结论）。
   */
  status: z.enum([
    "ST_COVERAGE_BLOCKED",
    "ST_COVERAGE_VERIFIED",
    "EXPLORATORY_KNOWN_ST_ONLY",
  ]).optional(),
  /** `false` ⇒ 本次 Run **未产出**收益矩阵（暂停终态）。 */
  matrixEmitted: z.boolean().optional(),
  /** 终态（§8 四选一；`RECOVERY-LIGHT-ST-007` 新增）。 */
  terminalState: z.enum(RECOVERY_ST_TERMINAL_STATES).optional(),
  /** 🔴 本轮 ST 资格政策的来源覆盖与政策描述（`RECOVERY-LIGHT-ST-007` §4）；旧载荷可为空。 */
  stEligibilityPolicy: z
    .object({
      policyId: z.string().min(1),
      policyVersion: z.string().min(1),
      parameterValue: z.string().min(1),
      exploratory: z.boolean(),
      strictDefault: z.boolean(),
      knownStOnly: z.boolean(),
      strictPit: z.boolean(),
      label: z.string().min(1),
      unknownAllowedThisRoundNote: z.string().min(1).nullable(),
      source: z.object({
        policyId: z.string().min(1),
        policyVersion: z.string().min(1),
        exploratory: z.literal(true),
        strictPit: z.literal(false),
        sourceId: z.string().min(1),
        sourceFingerprint: z.string().min(1),
        rowsRead: z.number().int().nonnegative(),
        securityCount: z.number().int().nonnegative(),
        identifierRowCount: z.number().int().nonnegative(),
        explicitNormalRowCount: z.number().int().nonnegative(),
        availabilityCounts: z.record(z.string(), z.number().int().nonnegative()),
        confidenceCounts: z.record(z.string(), z.number().int().nonnegative()),
        tablesRead: z.array(z.string().min(1)),
        note: z.string().min(1),
      }).nullable(),
      checks: z.object({
        lookups: z.number().int().nonnegative(),
        confirmKnownSt: z.number().int().nonnegative(),
        confirmExplicitNormal: z.number().int().nonnegative(),
        confirmUnknown: z.number().int().nonnegative(),
        labelReasonCounts: z.record(z.string(), z.number().int().nonnegative()),
      }),
      counts: z.object({
        labelRowsRead: z.number().int().nonnegative().nullable(),
        labelSecurities: z.number().int().nonnegative().nullable(),
        identityRowsRead: z.number().int().nonnegative().nullable(),
        explicitNormalRowsInSource: z.number().int().nonnegative().nullable(),
        knownStExcludedCandidates: z.number().int().nonnegative(),
        knownStExcludedCandidatesByGroup: z.record(z.string(), z.number().int().nonnegative()),
        participatingKnownStByGroup: z.record(z.string(), z.number().int().nonnegative()),
        participatingUnknownByGroup: z.record(z.string(), z.number().int().nonnegative()),
        participatingExplicitNormalByGroup: z.record(z.string(), z.number().int().nonnegative()),
        matchingOrders: z.record(z.string(), z.number().int().nonnegative()),
      }),
      strictPitEvidence: z.object({
        status: z.string().min(1),
        blocked: z.boolean(),
        providerId: z.string().min(1),
        providerVerifiable: z.boolean(),
        candidateCount: z.number().int().nonnegative(),
        timepointChecks: z.number().int().nonnegative(),
        verifiedNormalCount: z.number().int().nonnegative(),
        stRejectedCount: z.number().int().nonnegative(),
        unknownCount: z.number().int().nonnegative(),
      }),
      dataLimited: z.boolean(),
      dataLimitedReasons: z.array(z.string().min(1)),
      terminalState: z.enum(RECOVERY_ST_TERMINAL_STATES),
      note: z.string().min(1),
    })
    .nullable()
    .optional(),
  /** 本次 Run 实际交付的产物清单（名字 / 角色 / 用途；逐份可对账）。 */
  artifactManifest: z
    .array(z.object({
      name: z.string().min(1),
      role: z.enum(["table", "chart", "log", "artifact"]),
      purpose: z.string().min(1),
    }))
    .optional(),
  /** 本次 Run 使用的 ST provider 身份（缺省 = `ABSENT_STATUS_PROVIDER`）。 */
  stProvider: z
    .object({
      providerId: z.string().min(1),
      contractVersion: z.string().nullable(),
      source: z.string().min(1),
      verifiable: z.boolean(),
      note: z.string().min(1),
    })
    .optional(),
  /** 暂停终态的缺口明细（`ST_COVERAGE_BLOCKED` 时必填）。 */
  stCoverageBlocked: z
    .object({
      status: z.literal("ST_COVERAGE_BLOCKED"),
      matrixEmitted: z.literal(false),
      /** FIX-005 / F3：`NOT_SCANNED_PROVIDER_ABSENT` = 未测（计数一律 null，不是 0）。 */
      measurement: z.enum(["MEASURED", "NOT_SCANNED_PROVIDER_ABSENT"]).optional(),
      providerId: z.string().min(1),
      providerVerifiable: z.boolean(),
      plannedCandidateCount: z.number().int().nonnegative().nullable(),
      candidatesWithPlannedFillCount: z.number().int().nonnegative().nullable(),
      candidatesWithoutPlannedFillCount: z.number().int().nonnegative().nullable(),
      unknownBlockedCandidateCount: z.number().int().nonnegative().nullable(),
      fullyVerifiedNormalCandidateCount: z.number().int().nonnegative().nullable(),
      stRejectedCandidateCount: z.number().int().nonnegative().nullable(),
      unknownBlockedCandidateCountByGroup: z.record(z.string(), z.number().int().nonnegative()).nullable(),
      plannedCandidateCountByGroup: z.record(z.string(), z.number().int().nonnegative()).nullable(),
      priceStateCountsByGroup: z.record(
        z.string(),
        z.record(z.string(), z.number().int().nonnegative()),
      ).nullable(),
      timepointChecks: z.number().int().nonnegative().nullable(),
      verifiedNormalTimepointCheckCount: z.number().int().nonnegative().nullable(),
      stRejectedTimepointCheckCount: z.number().int().nonnegative().nullable(),
      unknownTimepointCheckCount: z.number().int().nonnegative().nullable(),
      unknownByTimepoint: z.record(z.string(), z.number().int().nonnegative()).nullable(),
      unknownByReason: z.record(z.string(), z.number().int().nonnegative()).nullable(),
      providerProbeCount: z.number().int().nonnegative(),
      providerProbeUnknownCount: z.number().int().nonnegative(),
      gapSampleCount: z.number().int().nonnegative().nullable(),
      blockedReasons: z.array(z.string().min(1)),
      scannedEventCount: z.number().int().nonnegative(),
      watchPoolEventCount: z.number().int().nonnegative().nullable(),
      watchPoolDecisionDateCount: z.number().int().nonnegative().nullable(),
      /** 因暂停而**刻意未产出**的读数清单（逐条说明，避免被误读成 0）。 */
      notEmittedMetrics: z.array(z.string().min(1)),
      note: z.string().min(1),
    })
    /**
     * 🔴 FIX-005 / F3：`measurement` 与计数**必须一致** —— 「未测」= 全 `null`（不是 0），
     *    「已实测」= 真数字（不许偷懒全填 `null`）。这条只有 schema 能钉住。
     */
    .superRefine((value, ctx) => {
      const measurement = value.measurement;
      if (measurement === undefined) return; // 兼容旧载荷（无 discriminant）
      const unscanned = measurement === "NOT_SCANNED_PROVIDER_ABSENT";
      const nullableCountFields = [
        "plannedCandidateCount",
        "candidatesWithPlannedFillCount",
        "candidatesWithoutPlannedFillCount",
        "unknownBlockedCandidateCount",
        "fullyVerifiedNormalCandidateCount",
        "stRejectedCandidateCount",
        "unknownBlockedCandidateCountByGroup",
        "plannedCandidateCountByGroup",
        "priceStateCountsByGroup",
        "timepointChecks",
        "verifiedNormalTimepointCheckCount",
        "stRejectedTimepointCheckCount",
        "unknownTimepointCheckCount",
        "unknownByTimepoint",
        "unknownByReason",
        "gapSampleCount",
        "watchPoolEventCount",
        "watchPoolDecisionDateCount",
      ] as const;
      for (const field of nullableCountFields) {
        const isNull = value[field] === null;
        if (unscanned && !isNull) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: "measurement=NOT_SCANNED_PROVIDER_ABSENT ⇒ 未测字段必须是 null（不是 0）",
          });
        }
        if (!unscanned && isNull) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: "measurement=MEASURED ⇒ 已实测字段必须是真实计数（不得为 null）",
          });
        }
      }
    })
    .nullable()
    .optional(),
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
    runMode: z.enum(RUN_MODES),
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
    stGateContractVersion: z.string().min(1),
    /**
     * 🔴 `RECOVERY-LIGHT-ST-007`：政策身份（`optional` 以兼容旧载荷；新 Run 一律写入）。
     */
    stEligibilityPolicyId: z.string().min(1).optional(),
    stEligibilityPolicyVersion: z.string().min(1).optional(),
    stEligibilityPolicyParameter: z.string().min(1).optional(),
    stEligibilityPolicyExploratory: z.boolean().optional(),
    stEligibilityPolicyStrictDefault: z.boolean().optional(),
    repairWindowDays: z.number().int().positive(),
    repairScoreTotalMin: z.number().int().positive(),
    watchMaxRelativeDay: z.number().int().positive(),
  }),
  runMode: z.object({
    mode: z.enum(RUN_MODES),
    randomAccountCount: z.number().int().positive(),
    accountsPerGroup: z.number().int().positive(),
    groupCount: z.number().int().positive(),
    totalAccountCount: z.number().int().positive(),
    note: z.string().min(1),
  }),
  groups: z.array(z.object({
    group: z.enum(GROUP_IDS),
    label: z.string().min(1),
    breachPolicy: z.enum(BREACH_POLICIES),
    decisionDateCount: z.number().int().nonnegative(),
    candidateRowCount: z.number().int().nonnegative(),
    triggerAnchorCount: z.number().int().nonnegative(),
    breachedAnchorCount: z.number().int().nonnegative(),
    permanentlyDisabledAnchorCount: z.number().int().nonnegative(),
    recoverySignalCount: z.number().int().nonnegative(),
    gapBrokenEpisodeCount: z.number().int().nonnegative(),
    dailyUnknownBlockedDayCount: z.number().int().nonnegative(),
    dailyStBlockedDayCount: z.number().int().nonnegative(),
    fillCount: z.number().int().nonnegative(),
    rejectedOrderCount: z.number().int().nonnegative(),
    skippedIntentCount: z.number().int().nonnegative(),
    accounts: z.array(z.unknown()),
    rTail: z.record(z.string(), z.unknown()),
    randomPooledTail: z.record(z.string(), z.unknown()),
    coverage: z.record(z.string(), z.unknown()),
    adverseExcursion: z.array(z.record(z.string(), z.unknown())),
    perYear: z.array(z.record(z.string(), z.unknown())),
    configSnapshotJson: z.string().min(1),
  })),
  primaryComparison: z.record(z.string(), z.unknown()).nullable(),
  stCoverage: z.record(z.string(), z.unknown()).nullable(),
  contractGaps: z.array(z.string()),
  sampleSummary: z.object({
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    excludedByReason: z.record(z.string(), z.number().int().nonnegative()),
    notes: z.array(z.string()),
  }),
});

/**
 * **非暂停**分支（`ST_COVERAGE_VERIFIED` / 计算产物本体）：
 * 锚点宇宙**已计算** ⇒ `commonAnchorUniverseSize` 必须是整数，**不允许** `null`。
 */
export const recoveryStVerifiedCustomPayloadSchema = recoveryStCustomPayloadBaseSchema.extend({
  commonAnchorUniverseSize: z.number().int().nonnegative(),
});

/**
 * **暂停终态**分支（`ST_COVERAGE_BLOCKED`）：
 * 锚点宇宙**未计算** ⇒ `commonAnchorUniverseSize` 必须是 `null`（**不是 0**）。
 * 反向也钉住：`status` / `matrixEmitted` 必须是暂停字面量 ——
 * 即 `null` 只在暂停路径合法，非暂停路径拿到 `null` 会被 schema 拒绝。
 */
export const recoveryStBlockedCustomPayloadSchema = recoveryStCustomPayloadBaseSchema.extend({
  status: z.literal("ST_COVERAGE_BLOCKED"),
  matrixEmitted: z.literal(false),
  commonAnchorUniverseSize: z.null(),
});

/**
 * 自有 payload 的唯一契约：`暂停终态 | 非暂停产物` 的**联合**（不是把非暂停路径放宽成 `number | null`）。
 */
export const recoveryStCustomPayloadSchema = z.union([
  recoveryStBlockedCustomPayloadSchema,
  recoveryStVerifiedCustomPayloadSchema,
]);
export type RecoveryStCustomPayload = z.infer<typeof recoveryStCustomPayloadSchema>;

// ---------------------------------------------------------------------------
// 六、组装（信封 + 自有结构）
// ---------------------------------------------------------------------------

function pct(value: number | null): number | null {
  return value === null ? null : Number((value * 100).toFixed(4));
}

/** 组装唯一入口：`experiment.ts` 只调它，不自己拼信封。 */
export function assembleRecoveryStResult(
  compute: RecoveryStComputeOutput,
): ExperimentResultPayload {
  const primary = compute.primaryComparison;
  const groupRows = compute.groups.map((group) => ({
    group: group.group,
    label: group.label,
    breachPolicy: group.breachPolicy,
    decisionDays: group.decisionDateCount,
    candidateRows: group.candidateRowCount,
    triggerAnchors: group.triggerAnchorCount,
    breachedAnchors: group.breachedAnchorCount,
    permanentlyDisabledAnchors: group.permanentlyDisabledAnchorCount,
    recoverySignals: group.recoverySignalCount,
    gapBrokenEpisodes: group.gapBrokenEpisodeCount,
    universeAnchors: group.coverage.universeAnchorCount,
    hit20Anchors: group.coverage.hitAnchorCount,
    coveragePct: pct(group.coverage.coverage),
    uniqueStockHits: group.coverage.uniqueStockHitCount,
    rTail20RatePct: pct(group.rTail.tail20Rate),
    randomTail20RatePct: pct(group.randomPooledTail.tail20Rate),
    rFillCount: group.fillCount,
    rRejectedOrders: group.rejectedOrderCount,
    rSkippedIntents: group.skippedIntentCount,
    rTotalReturnPct: group.accounts[0]?.totalReturnPct ?? null,
    rMaxDrawdownPct: group.accounts[0]?.maxDrawdownPct ?? null,
    rFinalCashSharePct: group.accounts[0]?.finalCashSharePct ?? null,
    unknownBlockedDays: group.dailyUnknownBlockedDayCount,
    stBlockedDays: group.dailyStBlockedDayCount,
  }));

  const bootstrapRows = [
    ["block20 主口径", primary.difference.blockPrimary],
    ["block40 敏感性", primary.difference.blockSensitivity],
    ["block20 配对均值差", primary.difference.meanPrimary],
  ] as const;

  const stCoverage = compute.stCoverage;
  /** 🔴 `RECOVERY-LIGHT-ST-007`：本轮 ST 资格政策的来源覆盖与政策描述。 */
  const lightPolicy = compute.stEligibilityPolicy ?? null;

  return {
    sampleSummary: {
      candidateCount: compute.sampleSummary.candidateCount,
      eligibleCount: compute.sampleSummary.eligibleCount,
      excludedCount: compute.sampleSummary.excludedCount,
      excludedByReason: compute.sampleSummary.excludedByReason,
      notes: [...compute.sampleSummary.notes],
    },
    tables: [
      {
        key: "recoveryStGroups",
        title: "两组读数（A = 003 的 D 永久停买 / B = 破位后修复）",
        description:
          "分母 = **共同且数据资格可核实的锚点宇宙**（不是各组成交数）；"
          + "主靶分子 = 至少一笔已完成净收益 ≥+20% 的**唯一锚点数**。",
        columns: [
          { key: "group", label: "组" },
          { key: "breachPolicy", label: "破位后处置" },
          { key: "decisionDays", label: "决策日", align: "RIGHT" },
          { key: "candidateRows", label: "候选行", align: "RIGHT" },
          { key: "triggerAnchors", label: "触发锚点", align: "RIGHT" },
          { key: "breachedAnchors", label: "破位锚点", align: "RIGHT" },
          { key: "recoverySignals", label: "修复信号", align: "RIGHT" },
          { key: "universeAnchors", label: "共同宇宙锚点", align: "RIGHT" },
          { key: "hit20Anchors", label: "≥+20% 唯一锚点", align: "RIGHT" },
          { key: "coveragePct", label: "覆盖率", unit: "%", align: "RIGHT", digits: 4 },
          { key: "uniqueStockHits", label: "唯一股票命中", align: "RIGHT" },
          { key: "rTail20RatePct", label: "R 成交尾率", unit: "%", align: "RIGHT", digits: 4 },
          { key: "randomTail20RatePct", label: "Random 尾率", unit: "%", align: "RIGHT", digits: 4 },
          { key: "rTotalReturnPct", label: "R 总收益", unit: "%", align: "RIGHT", digits: 4 },
          { key: "rMaxDrawdownPct", label: "R MDD", unit: "%", align: "RIGHT", digits: 4 },
          { key: "unknownBlockedDays", label: "UNKNOWN_BLOCKED 日", align: "RIGHT" },
          { key: "stBlockedDays", label: "ST_BLOCKED 日", align: "RIGHT" },
        ],
        rows: [...groupRows] as unknown as Record<string, string | number | boolean | null>[],
      },
      {
        key: "recoveryStBootstrap",
        title: "主比较 `B_R − A_R`：配对日期块 bootstrap（1000 次）",
        description:
          "聚类键 = 每个共同锚点**首次进入观察池**的日期；双臂共享同一日历与同一抽样索引；空日保留。"
          + "block20 主口径 / block40 敏感性 / 配对均值差。",
        columns: [
          { key: "variant", label: "口径" },
          { key: "pointEstimate", label: "点估计", align: "RIGHT", digits: 6 },
          { key: "low", label: "95% 下界", align: "RIGHT", digits: 6 },
          { key: "high", label: "95% 上界", align: "RIGHT", digits: 6 },
          { key: "clusterCount", label: "簇数", align: "RIGHT" },
          { key: "zeroDenominatorIterations", label: "零分母迭代", align: "RIGHT" },
          { key: "calendarLength", label: "日历长度", align: "RIGHT" },
        ],
        rows: bootstrapRows.map(([variant, interval]) => ({
          variant,
          pointEstimate: primary.pointEstimate,
          low: interval?.low ?? null,
          high: interval?.high ?? null,
          clusterCount: interval?.clusterCount ?? null,
          zeroDenominatorIterations: interval?.zeroDenominatorIterations ?? null,
          calendarLength: interval?.calendarLength ?? null,
        })),
      },
      {
        key: "recoveryStYearly",
        title: "逐年同靶读数（2024 / 2025 已见探索窗口，**不是 OOS**）",
        description: "逐年报告相同靶（≥+20% 唯一锚点覆盖率）与账户收益；不事后择市场分段。",
        columns: [
          { key: "group", label: "组" },
          { key: "year", label: "年", align: "RIGHT" },
          { key: "universeAnchors", label: "共同宇宙锚点", align: "RIGHT" },
          { key: "hit20Anchors", label: "≥+20% 唯一锚点", align: "RIGHT" },
          { key: "coveragePct", label: "覆盖率", unit: "%", align: "RIGHT", digits: 4 },
          { key: "rTotalReturnPct", label: "R 年度收益", unit: "%", align: "RIGHT", digits: 4 },
        ],
        rows: compute.groups.flatMap((group) => group.perYear.map((row) => ({
          group: group.group,
          year: row.year,
          universeAnchors: row.universeAnchorCount,
          hit20Anchors: row.hitAnchorCount,
          coveragePct: pct(row.coverage),
          rTotalReturnPct: row.rTotalReturnPct,
        }))),
      },
      {
        key: "recoveryStStCoverage",
        title: "ST 覆盖闸门（两时点 × 每个计划候选）",
        description:
          "🔴 `RECOVERY-LIGHT-ST-007`：严格 PIT 视角的读数**照记但不作前置条件**（轻量模式下 `blocked` 会是 true，"
          + "那是严格视角的事实，**不是**本轮的停止条件）。轻量模式的**资格政策**读数见下一张表。"
          + "严格模式（缺省）下，任一计划检查时点缺可核验 NORMAL/ST 结论 ⇒ `ST_COVERAGE_BLOCKED` ⇒ 不产出收益矩阵。",
        columns: [
          { key: "status", label: "状态" },
          { key: "providerId", label: "provider" },
          { key: "providerVerifiable", label: "provider 可核验" },
          { key: "candidateCount", label: "候选数", align: "RIGHT" },
          { key: "timepointChecks", label: "检查点", align: "RIGHT" },
          { key: "verifiedNormalCount", label: "可核验 NORMAL", align: "RIGHT" },
          { key: "stRejectedCount", label: "可核验 ST", align: "RIGHT" },
          { key: "unknownCount", label: "UNKNOWN", align: "RIGHT" },
        ],
        rows: [{
          status: stCoverage?.status ?? lightPolicy?.strictPitEvidence.status ?? "ST_COVERAGE_BLOCKED",
          providerId: stCoverage?.providerId ?? lightPolicy?.strictPitEvidence.providerId ?? "ABSENT_STATUS_PROVIDER",
          providerVerifiable: lightPolicy?.strictPitEvidence.providerVerifiable ?? false,
          candidateCount: stCoverage?.candidateCount ?? lightPolicy?.strictPitEvidence.candidateCount ?? 0,
          timepointChecks: stCoverage?.timepointChecks ?? lightPolicy?.strictPitEvidence.timepointChecks ?? 0,
          verifiedNormalCount:
            stCoverage?.verifiedNormalCount ?? lightPolicy?.strictPitEvidence.verifiedNormalCount ?? 0,
          stRejectedCount: stCoverage?.stRejectedCount ?? lightPolicy?.strictPitEvidence.stRejectedCount ?? 0,
          unknownCount: stCoverage?.unknownCount ?? lightPolicy?.strictPitEvidence.unknownCount ?? 0,
        }],
      },
      {
        key: "recoveryStEligibilityPolicy",
        title: "ST 资格政策（本轮显式政策：缺省严格 / 本轮 `KNOWN_ST_ONLY_EXPLORATORY`）",
        description:
          "回答目标 §7 问题 5：读了多少来源记录、排除了多少候选与真实买单、UNKNOWN 参与与成交数。"
          + "🔴 这些数字是**来源覆盖与政策描述**，**不是**另一个优化目标。"
          + "🔴 轻量模式**不是**严格 PIT 研究；UNKNOWN 可参与是用户授权的政策变体。",
        columns: [
          { key: "policyId", label: "政策 id" },
          { key: "policyVersion", label: "政策版本" },
          { key: "exploratory", label: "探索性" },
          { key: "labelRowsRead", label: "读取来源行", align: "RIGHT" },
          { key: "knownStExcludedCandidates", label: "已知ST 排除候选", align: "RIGHT" },
          { key: "knownStRejectedOrders", label: "已知ST 拒单(订单)", align: "RIGHT" },
          { key: "participatingUnknownCandidates", label: "UNKNOWN 参与候选", align: "RIGHT" },
          { key: "unknownFilledOrders", label: "UNKNOWN 成交(订单)", align: "RIGHT" },
          { key: "unknownRejectedOrders", label: "UNKNOWN 拒单(订单)", align: "RIGHT" },
          { key: "terminalState", label: "终态" },
        ],
        rows: [{
          policyId: lightPolicy?.policyId ?? "STRICT_VERIFIED_NORMAL_ONLY（缺省）",
          policyVersion: lightPolicy?.policyVersion ?? "recovery-st-execution-eligibility/1.0.0",
          exploratory: lightPolicy?.exploratory ?? false,
          labelRowsRead: lightPolicy?.counts.labelRowsRead ?? null,
          knownStExcludedCandidates: lightPolicy?.counts.knownStExcludedCandidates ?? 0,
          knownStRejectedOrders: lightPolicy?.counts.matchingOrders.knownStRejectedOrders ?? 0,
          participatingUnknownCandidates:
            Object.values(lightPolicy?.counts.participatingUnknownByGroup ?? {})
              .reduce((sum, value) => sum + value, 0),
          unknownFilledOrders: lightPolicy?.counts.matchingOrders.unknownFilledOrders ?? 0,
          unknownRejectedOrders: lightPolicy?.counts.matchingOrders.unknownRejectedOrders ?? 0,
          terminalState: compute.terminalState ?? "EXPLORATORY_COMPLETED",
        }],
      },
    ],
    statistics: [
      {
        code: "anchorTail20CoverageBRMinusAR",
        label: "主靶：`B_R − A_R` 的 ≥+20% 唯一锚点覆盖率差",
        value: primary.pointEstimate,
        digits: 6,
        sampleCount: compute.commonAnchorUniverseSize,
        note: primary.note,
      },
      {
        code: "anchorTail20CoverageAR",
        label: "A_R：003 的 D 的 ≥+20% 唯一锚点覆盖率",
        value: compute.groups[0]?.coverage.coverage ?? null,
        digits: 6,
        sampleCount: compute.groups[0]?.coverage.universeAnchorCount ?? null,
      },
      {
        code: "anchorTail20CoverageBR",
        label: "B_R：修复分支的 ≥+20% 唯一锚点覆盖率",
        value: compute.groups[1]?.coverage.coverage ?? null,
        digits: 6,
        sampleCount: compute.groups[1]?.coverage.universeAnchorCount ?? null,
      },
      {
        code: "commonAnchorUniverseSize",
        label: "共同且数据资格可核实的锚点宇宙大小（主靶分母）",
        value: compute.commonAnchorUniverseSize,
        digits: 0,
      },
      {
        code: "runModeTotalAccountCount",
        label: `运行模式 ${compute.runMode.mode} 的账户总数`,
        value: compute.runMode.totalAccountCount,
        digits: 0,
        note: compute.runMode.note,
      },
      {
        code: "stEligibilityPolicyId",
        label: "本轮 ST 资格政策（缺省 = 严格；`KNOWN_ST_ONLY_EXPLORATORY` = 用户授权的探索性变体）",
        value: null,
        digits: 0,
        sampleCount: null,
        note: lightPolicy === null
          ? "未记录政策块（旧载荷）。"
          : `${lightPolicy.policyId} / ${lightPolicy.policyVersion}（探索性=${lightPolicy.exploratory}，`
            + `严格缺省=${lightPolicy.strictDefault}，严格PIT=${lightPolicy.strictPit}）；`
            + `终态 ${compute.terminalState ?? "EXPLORATORY_COMPLETED"}。`
            + (lightPolicy.exploratory
              ? " 🔴 UNKNOWN 可参与是**用户授权的探索性政策**，**不是**严格 PIT 结论，"
                + "不得升级为 PIT / OOS / 模拟交易 / 实盘验证。"
              : ""),
      },
      {
        code: "knownStOnlyExcludedCandidates",
        label: "轻量 ST 检查排除的排序候选数（因已知 ST；**政策描述，不是优化目标**）",
        value: lightPolicy?.counts.knownStExcludedCandidates ?? null,
        digits: 0,
        sampleCount: lightPolicy?.counts.labelRowsRead ?? null,
        note: lightPolicy === null
          ? "严格模式：不适用。"
          : `读取来源行 ${lightPolicy.counts.labelRowsRead ?? "未测"}；`
            + `真实撮合链已知 ST 拒单（订单）${lightPolicy.counts.matchingOrders.knownStRejectedOrders ?? 0}；`
            + `UNKNOWN 成交（订单）${lightPolicy.counts.matchingOrders.unknownFilledOrders ?? 0}。`,
      },
    ],
    customPayload: compute satisfies RecoveryStComputeOutput,
  };
}

// ---------------------------------------------------------------------------
// 七、如实登记的契约缺口（目标 §3 末段 / §4；S1 审计 §6）
// ---------------------------------------------------------------------------

export const RECOVERY_ST_CONTRACT_GAPS: readonly string[] = Object.freeze([
  "🔴 ST 逐日状态源**不可 PIT 核验**（S1 审计 E1/E2/E3）：唯一 ST 源 `research_security_status_history` "
  + "的 ST 行 `availability` 全为 UNKNOWN、可获知时间全缺；2,378/2,827（84%）symbol 在窗口内没有任何 ST 行；"
  + "948 个 ST 格的数据集 `limitRuleUp` 仍为 10%、`canBuyAtOpen=1`。"
  + "⇒ 严格模式（缺省）在**没有**可核验 provider 时 `summarizeStCoverage().blocked === true`，"
  + "`run()` 在任何撮合之前以 `ST_COVERAGE_BLOCKED` **正常返回**一份 `matrixEmitted = false` 的显式结果"
  + "并交付覆盖缺口产物（`throw new StCoverageBlockedError` 只留给直接调用方）⇒ **不产出收益矩阵**"
  + "（不是空仓结果）。",
  "`ΣQ_j`（修复综合分）只是**观察证据**，**不进入横截面排序**（排序仍为 `preReturn10` 降序 + symbol/eventId 破平）。",
  "A/B 是**机制级**对照：同时改变「破位后的局部支撑」与「观察聚合方式」，"
  + "**不能**称为「仅取消永久排除」的单因素效应（目标 §2 已事前声明；与归因报告 §14.4 建议 3 方向相反，由用户指示覆盖）。",
  "`maxAmp5` **完全不参与**（既不参与资格也不参与排序）；本实验用 `deriveEventFactors(..., () => null)`。",
  "Dataset 物理 post 上界 rd80，而组合执行理论上需要约 rd94；S1 审计实测上一轮 **零暴露**"
  + "（openAtEnd=0 / noExecutionBar=0 / suspendedCannotSell=0）。本轮**不允许**在 rd80 静默强平、"
  + "补最后价或事后剔除长持仓；若出现暴露必须停并报告。",
  "`decisionOffsetDays` 是**单标量**（= 20），无法表达滚动池逐日变化的决策坐标 ⇒ 声明的是**上界**，不是逐日精确坐标。",
  "环境与排序：严格模式（缺省）**未接入**可核验 ST provider ⇒ 严格模式下**任何** Run 都会以 "
  + "`ST_COVERAGE_BLOCKED` 结束（刻意行为，S3 的交付就是这条闸门）。",
  "🔴 `RECOVERY-LIGHT-ST-007`：轻量政策 `KNOWN_ST_ONLY_EXPLORATORY`（`recovery-known-st-only/1.0.0`）"
  + "是**用户明确授权的资格政策变体**：`UNKNOWN` 可参与、仅排除已有历史记录中的 `ST`。"
  + "它**不是**严格 PIT / OOS / 模拟交易 / 实盘验证：来源行 `availability` 全为 `UNKNOWN`、"
  + "无 `availableAsOf` 列、`retrievedAt` 全在窗口后约一年，平台 ST 维度**没有** `NORMAL` 行"
  + "⇒ `UNKNOWN` 只能读作「未发现 ST 记录」，**不是**「当日确实非 ST」。"
  + "`ST` 在两种政策下都**恒拒绝**；`UNKNOWN` **绝不**被改写为 `NORMAL`。",
  "🔴 轻量模式**不**把严格视图的 `stSummary.blocked` / `providerVerifiable` 作为前置条件，"
  + "也**不**把 `providerVerifiable` 伪造为 `true`；缺状态**不再**暂停全部账户"
  + "（未知 ST 状态本身不是停止条件 —— 那是用户已确认的本轮政策）。",
]);

// ---------------------------------------------------------------------------
// 八、暂停终态（`ST_COVERAGE_BLOCKED`）：缺口明细与**只交付缺口**的组装
// ---------------------------------------------------------------------------

/**
 * 🔴 为什么暂停终态走「**正常返回** + 显式状态」而不是 `throw`：
 *
 * 平台 Runner 在 `run()` 抛异常时返回 `runStatus = FAILED`，并且
 * `server/researchExperiments/runner.ts` **丢弃全部 `context.artifact`**
 * （`artifactFiles: failure === null ? artifactFiles : []`）。
 * 于是「先交付覆盖缺口」（目标 §4）中的**缺口产物根本不会落盘**，
 * 只剩异常消息里的一段文字。
 *
 * 因此本实验的暂停路径：
 *   1. 先 `context.artifact(...)` 落 `st-coverage-gap-summary.json` / `status-coverage.csv` /
 *      `st-gap-samples.csv` / `st-coverage-counts.csv`（**只有覆盖缺口**，没有交易与权益）；
 *   2. 再返回一份 `customPayload.status = "ST_COVERAGE_BLOCKED"`、`matrixEmitted = false` 的**显式**结果：
 *      收益类统计一律 `value: null`（**不是 0**），`eligibleCount = 0`，
 *      并且**没有任何**交易 / 权益 / 收益表与图。
 *
 * 🔴 `throw new StCoverageBlockedError(...)` 仍保留为**给直接调用方**的强中断入口
 *    （例如工具与将来的调用点要「宁可失败也不产出」）；`run()` 本身走上面的可交付路径。
 */
export const RECOVERY_ST_BLOCKED_ARTIFACTS: readonly {
  readonly name: string;
  readonly role: "table" | "chart" | "log" | "artifact";
  readonly purpose: string;
}[] = Object.freeze([
  {
    name: "st-coverage-gap-summary.json",
    role: "artifact",
    purpose: "覆盖缺口摘要（状态字面量 + 计数 + 涉及时点 + 缺失的 provider 身份 + 阻断原因）",
  },
  {
    name: "st-early-diagnostic.json",
    role: "artifact",
    purpose:
      "FIX-005 / F3 早诊断：provider 明确缺失时逐条列出**未测**读数（计数 `null`，不是 0）"
      + "与「不再重复扫描全量 post80」的理由",
  },
  {
    name: "status-coverage.csv",
    role: "table",
    purpose: "逐 symbol / 逐检查时点的状态覆盖证据（来源 / 生效区间 / 可获知时间 / 置信度 / 证据指纹；缺失记 UNKNOWN，不伪造）",
  },
  {
    name: "st-gap-samples.csv",
    role: "table",
    purpose: "缺口样例（封顶，逐候选 / 逐时点 / 逐原因）",
  },
  {
    name: "st-coverage-counts.csv",
    role: "table",
    purpose: "覆盖计数三分账（逐组 / 逐时点 / 逐原因）",
  },
  {
    name: "frozen-config.json",
    role: "artifact",
    purpose: "冻结配置与来源 manifest（暂停时也交付，便于核对本轮声明与坐标）",
  },
]);

/** 目标 §8 要求的 S5 产物集（**名单即契约**；非暂停路径交付）。 */
export const RECOVERY_ST_S5_ARTIFACTS: readonly {
  readonly name: string;
  readonly role: "table" | "chart" | "log" | "artifact";
  readonly purpose: string;
}[] = Object.freeze([
  { name: "frozen-config.json", role: "artifact", purpose: "冻结配置与来源 manifest（Dataset / 策略 / 参数 / ST 资格政策 / 指纹）" },
  { name: "status-coverage.csv", role: "table", purpose: "逐 symbol/date/检查时点的状态覆盖证据（严格 PIT 视角）" },
  {
    name: "st-light-eligibility-decisions.csv",
    role: "table",
    purpose:
      "`RECOVERY-LIGHT-ST-007` 专属：逐候选两时点的**政策判决**与来源证据"
      + "（已知 ST / 明确 NORMAL / UNKNOWN+本轮允许）；**只在轻量模式产出**",
  },
  {
    name: "st-light-policy-summary.json",
    role: "artifact",
    purpose:
      "`RECOVERY-LIGHT-ST-007` 专属：来源覆盖与政策描述（读了多少记录、排除多少候选与真实买单、"
      + "UNKNOWN 参与与成交数）；**只在轻量模式产出**",
  },
  {
    name: "st-fill-audit.csv",
    role: "table",
    purpose:
      "逐笔执行 ST 审计（成交前判决来自引擎真实调用记录；严格模式必须全为 NORMAL，"
      + "轻量模式允许**显式声明的** UNKNOWN 且**保留真实状态**、绝不改写为 NORMAL）",
  },
  {
    name: "execution-eligibility-rejections-{group}.csv",
    role: "table",
    purpose:
      "FIX-005 / F1 真实拒单产物（股票 / 锚点 / 账户 / 计划 vs 实际检查日 / 状态 / 原因 / provider / 来源指纹）",
  },
  { name: "observation-repair-ledger-{year}.csv", role: "table", purpose: "逐日观察 / 修复证据（四项原始值 + 状态机 + 拒因）" },
  { name: "candidate-ranking-diagnostics.csv", role: "table", purpose: "候选与排名诊断（含 P3 排序分辨力与破平键）" },
  {
    name: "artifact-compression-index.csv",
    role: "table",
    purpose:
      "`SORT-PARITY-008` §5 专属：本 Run 全部交付产物的**逻辑名 → 实际对象名**、编码（identity / gzip）、"
      + "原文与交付体积、**原文 SHA-256**、行数。达到 1 MiB 的 CSV 以无损 gzip（level 1）交付为 `.csv.gz`；"
      + "本表自身按原文交付、**不列自身**（未列出的名字按「对象名 = 逻辑名」解析）",
  },
  { name: "trades-R-{group}.csv", role: "table", purpose: "R 账户全交易台账" },
  { name: "equity-R-{group}.csv", role: "table", purpose: "R 账户权益曲线" },
  { name: "random-account-metrics-{group}.csv", role: "table", purpose: "Random 账户逐账户指标（唯一出口 canonicalMetrics）" },
  { name: "trades-random-{group}-part-{shard}.csv", role: "table", purpose: "Random 账户交易台账（分片）" },
  { name: "anchor-trade-chains.csv", role: "table", purpose: "锚点交易链（含整链净损益与失败尝试成本）" },
  { name: "anchor-failed-attempts.csv", role: "table", purpose: "锚点失败尝试（未买 / 容量迟买 / 退出后上涨分开）" },
  { name: "opportunity-day-attribution.csv", role: "table", purpose: "机会确认日逐层归因（含**未触发**观察日）" },
  { name: "entry-path-window.csv", role: "table", purpose: "前 3 / 5 交易日不利波动与收益画像" },
  { name: "date-block-stats.csv", role: "table", purpose: "配对日期块 bootstrap（block20 主 / block40 敏感性）" },
  { name: "stage-performance.json", role: "artifact", purpose: "阶段性能（逐阶段耗时与规模）" },
  { name: "cache-checkpoint-validation.json", role: "artifact", purpose: "缓存 / 断点等价校验（同输入冷热一致）" },
]);

/** 因 `ST_COVERAGE_BLOCKED` 而**刻意未产出**的读数（逐条列出，避免被误读为 0）。 */
export const RECOVERY_ST_NOT_EMITTED_METRICS: readonly string[] = Object.freeze([
  "主指标 `B_R − A_R` 的共同锚点 ≥+20% 覆盖率差（点估计 + block20 主区间 + block40 敏感性）",
  "≥+20% / ≥+50% / ≥+100% 实际成交尾率（R 臂与 pooled Random）",
  "≥+20% 唯一命中锚点数与唯一命中股票数",
  "单笔净收益均值 / 中位数与锚点整链净损益（扣全部试错成本）",
  "账户复合收益 / 年化 / MDD / 期末现金占比 / 容量与交易次数 / 持有期",
  "前 3 / 5 个交易日不利波动与收益画像",
  "配对日期块 bootstrap 的全部区间（含零分母迭代与越界观测计数）",
  "逐年（2024 / 2025）同靶覆盖率与账户年度收益",
  "逐笔执行 ST 审计、R/Random 交易台账、权益曲线与全部 S5 明细产物",
]);

export type RecoveryStFrozenConfig = RecoveryStComputeOutput["frozenConfig"];

/** `experiment.ts` 在暂停路径交给组装函数的全部事实（**可序列化**）。 */
export interface RecoveryStBlockedOutput {
  readonly computationVersion: string;
  readonly runMode: RunModeResolution;
  readonly frozenConfig: RecoveryStFrozenConfig;
  /** provider 身份（无可核验源时为 `null` 身份 ⇒ 逐时点 UNKNOWN）。 */
  readonly providerId: string;
  readonly providerVerifiable: boolean;
  readonly providerContractVersion: string;
  /** 窗口探针（证明「不是没查，而是查不到」）。 */
  readonly providerProbeCount: number;
  readonly providerProbeUnknownCount: number;
  /** 覆盖读数：**已测**（逐检查点统计）或**未测**（provider 明确缺失 ⇒ 不扫描）。 */
  readonly stCoverage: StCoverageReading;
  /**
   * 🔴 计划候选计数：`null` = **未测**（provider 明确缺失时不在 post rd≥1 上扫描，
   * FIX-005 / F3）。**绝不**用 `0` 冒充「查过了、没有候选」。
   */
  readonly plannedCandidateCount: number | null;
  readonly candidatesWithPlannedFillCount: number | null;
  readonly candidatesWithoutPlannedFillCount: number | null;
  readonly unknownBlockedCandidateCount: number | null;
  readonly fullyVerifiedNormalCandidateCount: number | null;
  readonly stRejectedCandidateCount: number | null;
  readonly unknownBlockedCandidateCountByGroup: Record<string, number> | null;
  readonly plannedCandidateCountByGroup: Record<string, number> | null;
  readonly priceStateCountsByGroup: Record<string, Record<string, number>> | null;
  /** 事件扫描计数（**不读 rd≥1** ⇒ 早诊断路径也有真实值）。 */
  readonly scannedEventCount: number;
  /** 观察池事件 / 决策日数：`null` = 未测（需要 post rd≥1）。 */
  readonly watchPoolEventCount: number | null;
  readonly watchPoolDecisionDateCount: number | null;
  readonly excludedByReason: Record<string, number>;
  readonly blockedReasons: readonly string[];
  readonly notes: readonly string[];
}

/**
 * FIX-005 / F3 —— provider 明确缺失时的**未测**覆盖读数（计数一律 `null`）。
 *
 * 🔴 为什么需要它：provider 缺失时**没有**任何计划检查点可以统计，`summarizeStCoverage([])`
 *    会返回 `timepointChecks = 0 / blocked = false` —— 那是**伪造的绿**。未测就是未测。
 */
export function unscannedStCoverageReport(args: {
  readonly contractVersion: string;
  readonly providerId: string;
  readonly note: string;
}): StCoverageUnscannedReport {
  return {
    measurement: "NOT_SCANNED_PROVIDER_ABSENT",
    status: "ST_COVERAGE_BLOCKED",
    contractVersion: args.contractVersion,
    providerId: args.providerId,
    candidateCount: null,
    timepointChecks: null,
    verifiedNormalCount: null,
    stRejectedCount: null,
    unknownCount: null,
    unknownByTimepoint: null,
    unknownByReason: null,
    gapSamples: null,
    blocked: true,
    note: args.note,
  };
}

/**
 * 组装暂停终态信封（**只有覆盖缺口**）。
 *
 * 🔴 三条硬约束（本函数就是它们的兑现）：
 *   1. `customPayload.status = "ST_COVERAGE_BLOCKED"` 且 `matrixEmitted = false`（显式终态，不静默）；
 *   2. **不产出**任何交易 / 权益 / 收益表与图；收益类统计一律 `value: null` + `note` 说明「未产出」，
 *      **不得**用 0 冒充（0 与 null 的差别正是「跑了但空仓」与「根本没跑」的差别）；
 *   3. 样本账必须平（`eligible + excluded === candidate`，`Σ excludedByReason === excluded`），
 *      否则 Runner 的信封校验会拒绝，把「如实暂停」退化成「结果不可读」。
 *
 * 🔴 FIX-005 / F3：`stCoverage.measurement === "NOT_SCANNED_PROVIDER_ABSENT"` 时，
 *    逐候选 / 逐时点的计数一律 `null`（**未测**），并且**不产出**任何逐检查点行。
 */
export function assembleRecoveryStBlockedResult(
  output: RecoveryStBlockedOutput,
): ExperimentResultPayload {
  const gap = output.stCoverage;
  const unscanned = gap.measurement === "NOT_SCANNED_PROVIDER_ABSENT";
  const ledger: Record<string, number> = { ...output.excludedByReason };
  const used = Object.values(ledger).reduce((sum, value) => sum + value, 0);
  const residual = output.scannedEventCount - used;
  if (residual > 0) {
    // 未测路径的残余**单独命名**：它们不是「被 ST 闸门剔除」，而是「因 provider 缺失未评估」。
    ledger[unscanned ? "NOT_SCANNED_PROVIDER_ABSENT" : "ST_COVERAGE_BLOCKED"] = residual;
  }

  const groupRows = GROUP_IDS.map((groupId) => ({
    group: groupId,
    label: groupSpecOf(groupId).label,
    breachPolicy: groupSpecOf(groupId).breachPolicy,
    plannedCandidateCount: output.plannedCandidateCountByGroup?.[groupId] ?? null,
    unknownBlockedCandidateCount: output.unknownBlockedCandidateCountByGroup?.[groupId] ?? null,
    providerId: output.providerId,
    providerVerifiable: output.providerVerifiable,
    status: gap.status,
  }));

  const timepointRows = unscanned
    ? []
    : Object.entries(gap.unknownByTimepoint)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([timepoint, count]) => ({
        timepoint,
        unknownCount: count,
        semantic:
          timepoint === "CONFIRM_CLOSE_ELIGIBILITY"
            ? "确认日**收盘**：候选资格时点（当日非 ST 才允许进入次日买入计划）"
            : "**成交前**（成交日开盘前）：隔夜转 ST 必须取消订单",
      }));

  const reasonRows = unscanned
    ? []
    : Object.entries(gap.unknownByReason)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => ({ reason, count }));

  const priceStateRows = output.priceStateCountsByGroup === null
    ? []
    : GROUP_IDS.flatMap((groupId) =>
      Object.entries(output.priceStateCountsByGroup?.[groupId] ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([priceState, count]) => ({
          group: groupId,
          priceState,
          dayCount: count,
        })),
    );

  const customPayload = {
    computationVersion: COMPUTATION_VERSION,
    status: "ST_COVERAGE_BLOCKED" as const,
    matrixEmitted: false as const,
    artifactManifest: RECOVERY_ST_BLOCKED_ARTIFACTS.map((spec) => ({ ...spec })),
    stProvider: {
      providerId: output.providerId,
      contractVersion: output.providerContractVersion,
      source: output.providerId === "ABSENT_STATUS_PROVIDER" ? "ABSENT_DEFAULT" : "PLATFORM_STATUS_SERVICE",
      verifiable: output.providerVerifiable,
      note:
        output.providerVerifiable
          ? "窗口探针全部给出可核验结论。"
          : "🔴 **没有**可核验的 ST 状态源 ⇒ 每个计划检查时点都是 `UNKNOWN_BLOCKED`；"
            + "绝不在这里「临时造一个 NORMAL 兜底」（S1 审计正是否证了这条捷径）。",
    },
    stCoverageBlocked: {
      status: "ST_COVERAGE_BLOCKED" as const,
      matrixEmitted: false as const,
      measurement: gap.measurement,
      providerId: output.providerId,
      providerVerifiable: output.providerVerifiable,
      plannedCandidateCount: output.plannedCandidateCount,
      candidatesWithPlannedFillCount: output.candidatesWithPlannedFillCount,
      candidatesWithoutPlannedFillCount: output.candidatesWithoutPlannedFillCount,
      unknownBlockedCandidateCount: output.unknownBlockedCandidateCount,
      fullyVerifiedNormalCandidateCount: output.fullyVerifiedNormalCandidateCount,
      stRejectedCandidateCount: output.stRejectedCandidateCount,
      unknownBlockedCandidateCountByGroup: output.unknownBlockedCandidateCountByGroup === null
        ? null
        : { ...output.unknownBlockedCandidateCountByGroup },
      plannedCandidateCountByGroup: output.plannedCandidateCountByGroup === null
        ? null
        : { ...output.plannedCandidateCountByGroup },
      priceStateCountsByGroup: output.priceStateCountsByGroup === null
        ? null
        : Object.fromEntries(
          GROUP_IDS.map((groupId) => [groupId, { ...(output.priceStateCountsByGroup?.[groupId] ?? {}) }]),
        ),
      timepointChecks: unscanned ? null : gap.timepointChecks,
      verifiedNormalTimepointCheckCount: unscanned ? null : gap.verifiedNormalCount,
      stRejectedTimepointCheckCount: unscanned ? null : gap.stRejectedCount,
      unknownTimepointCheckCount: unscanned ? null : gap.unknownCount,
      unknownByTimepoint: unscanned ? null : { ...gap.unknownByTimepoint },
      unknownByReason: unscanned ? null : { ...gap.unknownByReason },
      providerProbeCount: output.providerProbeCount,
      providerProbeUnknownCount: output.providerProbeUnknownCount,
      gapSampleCount: unscanned ? null : gap.gapSamples.length,
      blockedReasons: [...output.blockedReasons],
      scannedEventCount: output.scannedEventCount,
      watchPoolEventCount: output.watchPoolEventCount,
      watchPoolDecisionDateCount: output.watchPoolDecisionDateCount,
      notEmittedMetrics: [...RECOVERY_ST_NOT_EMITTED_METRICS],
      note:
        "🔴 本次 Run 的终态是 `ST_COVERAGE_BLOCKED`：**没有执行任何撮合、没有产出收益矩阵**。"
        + "这不是「跑了但空仓」，而是「按目标 §4 默认条款刻意暂停」，"
        + "因为计划候选资格 / 成交前时点缺少可核验的 NORMAL/ST 结论。",
    },
    frozenConfig: output.frozenConfig,
    runMode: {
      mode: output.runMode.mode,
      randomAccountCount: output.runMode.randomAccountCount,
      accountsPerGroup: output.runMode.accountsPerGroup,
      groupCount: output.runMode.groupCount,
      totalAccountCount: output.runMode.totalAccountCount,
      note: output.runMode.note,
    },
    /**
     * 🔴 `null`（**不是 0**）：共同锚点宇宙**未计算** —— 闸门在任何撮合之前就把 Run 停在
     * `ST_COVERAGE_BLOCKED`，因此这个分母根本没被算出来。写 `0` 会被读成
     * 「查过了、没有共同锚点」，那是另一件事（与 `notEmittedMetrics` 同一纪律）。
     */
    commonAnchorUniverseSize: null,
    groups: [] as readonly unknown[],
    primaryComparison: null,
    stCoverage: { ...gap } as Readonly<Record<string, unknown>>,
    contractGaps: [...RECOVERY_ST_CONTRACT_GAPS],
    sampleSummary: {
      candidateCount: output.scannedEventCount,
      eligibleCount: 0,
      excludedCount: output.scannedEventCount,
      excludedByReason: ledger,
      notes: [
        unscanned
          ? "🔴 终态 `ST_COVERAGE_BLOCKED`（**未测**）：provider 明确缺失 ⇒ 按 FIX-005 / F3 走"
            + "**早诊断**路径，只做事件扫描，**不读任何 post rd≥1 观察数据**，"
            + "因此计划候选数 / 覆盖分母一律为 `null`（**未测**，不是 0）。"
          : `🔴 终态 \`ST_COVERAGE_BLOCKED\`：计划候选 ${output.plannedCandidateCount} 个，`
            + `其中 ${output.unknownBlockedCandidateCount} 个（UNKNOWN_BLOCKED）在候选资格或成交前时点`
            + "缺少可核验的 NORMAL/ST 结论。",
        `provider 身份：\`${output.providerId}\`（contractVersion=${output.providerContractVersion}、`
        + `窗口探针 ${output.providerProbeCount} 次中 ${output.providerProbeUnknownCount} 次无结论）`
        + `；可核验 = ${String(output.providerVerifiable)}。`,
        "`eligibleCount = 0` 表示**没有样本参与统计**（不是「跑了但空仓」）；"
        + "收益类读数一律为 `null`（未产出），**没有**交易 / 权益产物。",
        unscanned
          ? `覆盖读数：**未测**（measurement=${gap.measurement}）—— 未扫描的候选数与覆盖分母为 \`null\`，`
            + "未扫描原因逐条见 st-early-diagnostic.json 与 st-coverage-gap-summary.json。"
          : `缺口逐时点：${Object.entries(gap.unknownByTimepoint)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([timepoint, count]) => `${timepoint}=${count}`)
            .join("，") || "无"}；逐原因：`
            + `${Object.entries(gap.unknownByReason)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([reason, count]) => `${reason}=${count}`)
              .join("，") || "无"}。`,
        ...output.notes,
        output.runMode.note,
      ],
    },
  };

  return {
    sampleSummary: {
      candidateCount: customPayload.sampleSummary.candidateCount,
      eligibleCount: customPayload.sampleSummary.eligibleCount,
      excludedCount: customPayload.sampleSummary.excludedCount,
      excludedByReason: customPayload.sampleSummary.excludedByReason,
      notes: [...customPayload.sampleSummary.notes],
    },
    statistics: [
      {
        code: "stCoverageBlocked",
        label: "ST 覆盖缺口守卫（1 = 已暂停收益矩阵）",
        value: 1,
        unit: "0/1",
        note: "目标 §4：任一计划候选资格 / 成交前时点缺少可核验结论即暂停；**不产出**空仓结果冒充结论。",
      },
      {
        code: "matrixEmitted",
        label: "收益矩阵是否产出（1 = 已产出）",
        value: 0,
        unit: "0/1",
        note: "0 ⇒ 本次 Run 没有任何交易 / 权益 / 收益读数。",
      },
      {
        code: "plannedCandidateCount",
        label: "计划候选数（价格信号成立）",
        value: output.plannedCandidateCount,
        unit: "个",
        note: unscanned
          ? "**未测**（`null`）：provider 明确缺失 ⇒ 早诊断路径不读 post rd≥1，因此没有统计候选数。"
            + "**不是 0**（0 会被读成「查过了、没有信号」）。"
          : "价格信号成立但未完成 ST 资格判定 ⇒ 不进入排序；规则确实产出了候选（不是「没有信号」）。",
      },
      {
        code: "unknownBlockedCandidateCount",
        label: "UNKNOWN_BLOCKED 候选数",
        value: output.unknownBlockedCandidateCount,
        unit: "个",
        note: unscanned
          ? "**未测**（`null`）：未扫描 ⇒ 无候选级计数。见 st-early-diagnostic.json。"
          : "至少一个检查时点缺少可核验的 NORMAL/ST 结论。",
      },
      {
        code: "unknownTimepointChecks",
        label: "无结论检查时点数",
        value: unscanned ? null : gap.unknownCount,
        unit: "格",
        note: unscanned
          ? "**未测**（`null`）：未构建计划检查点 ⇒ 覆盖分母未测，不是 0 缺口。"
          : `全部计划检查时点 ${gap.timepointChecks} 格；逐时点 / 逐原因见 st-coverage-counts.csv。`,
      },
      {
        code: "providerProbeUnknownCount",
        label: "provider 窗口探针无结论次数",
        value: output.providerProbeUnknownCount,
        unit: "次",
        note: `共探针 ${output.providerProbeCount} 次 ⇒ 证明「不是没查，而是查不到可核验结论」。`,
      },
      ...RECOVERY_ST_NOT_EMITTED_METRICS.map((label, index) => ({
        code: `notEmitted_${index + 1}`,
        label: `未产出：${label}`,
        value: null as number | null,
        note: "**未产出**（`ST_COVERAGE_BLOCKED`）—— 不是 0，也不是空仓收益。",
      })),
    ],
    tables: [
      {
        key: "st-coverage-status",
        title: "ST 覆盖状态（暂停终态）",
        description:
          "🔴 本次 Run **没有**产出任何收益矩阵：收益类统计一律为 `null`。"
          + "此表逐组给出计划候选数、UNKNOWN_BLOCKED 候选数与缺失的 provider 身份。",
        columns: [
          { key: "group", label: "组" },
          { key: "breachPolicy", label: "破位后处置" },
          { key: "plannedCandidateCount", label: "计划候选", align: "RIGHT" },
          { key: "unknownBlockedCandidateCount", label: "UNKNOWN_BLOCKED 候选", align: "RIGHT" },
          { key: "providerId", label: "缺失的 provider" },
          { key: "providerVerifiable", label: "provider 可核验" },
          { key: "status", label: "终态" },
        ],
        rows: groupRows,
      },
      {
        key: "st-coverage-by-timepoint",
        title: "覆盖缺口 · 逐检查时点",
        description:
          "两个时点由 `evaluateStGateForCandidate` 唯一组合器产出；R / Random / 首次 / 重试 / 再入场共用同一闸门。",
        columns: [
          { key: "timepoint", label: "检查时点" },
          { key: "unknownCount", label: "无结论格数", align: "RIGHT" },
          { key: "semantic", label: "语义" },
        ],
        rows: timepointRows,
      },
      {
        key: "st-coverage-by-reason",
        title: "覆盖缺口 · 逐原因",
        description: "原因码来自闸门闭集（`NO_STATUS_PROVIDER` / `NO_STATUS_FACT` / `NOT_AVAILABLE_AS_OF` …）。",
        columns: [
          { key: "reason", label: "原因码" },
          { key: "count", label: "格数", align: "RIGHT" },
        ],
        rows: reasonRows,
      },
      {
        key: "planned-candidate-price-state",
        title: "计划候选的价格状态分布（暂停时）",
        description:
          "证明「规则确实产出了候选，但矩阵因 ST 覆盖被暂停」——既不是「没有信号」，也不是「空仓结果」。"
          + "价格状态与买入资格**正交**：ST / 未知不会抹掉价格观察历史。",
        columns: [
          { key: "group", label: "组" },
          { key: "priceState", label: "价格状态" },
          { key: "dayCount", label: "日数", align: "RIGHT" },
        ],
        rows: priceStateRows,
      },
      {
        key: "not-emitted-metrics",
        title: "刻意未产出的读数（逐条）",
        description: "收益矩阵暂停 ⇒ 下列读数**没有**产生；它们既不是 0，也不代表「空仓」或「无效」。",
        columns: [
          { key: "index", label: "#", align: "RIGHT" },
          { key: "metric", label: "未产出的读数" },
          { key: "reason", label: "原因" },
        ],
        rows: RECOVERY_ST_NOT_EMITTED_METRICS.map((metric, index) => ({
          index: index + 1,
          metric,
          reason: "ST_COVERAGE_BLOCKED（目标 §4 默认条款：先交付覆盖缺口）",
        })),
      },
    ],
    customPayload,
  };
}
