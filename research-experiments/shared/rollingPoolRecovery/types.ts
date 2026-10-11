/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` §3 —— 破位修复再触发：冻结常量与类型。
 *
 * 权威规则：`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md` §3（唯一规则定义）、
 * §2（两组矩阵）、§4（每日 ST 硬闸门）、§8（S3 与关键测试）。
 * S1 审计：`docs/research/AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`。
 *
 * ## 本模块表达什么
 *
 * 「锚点事件（首板 rd0）在 rd1..40 的每一天，**价格上**处于什么状态、**能否买**、账上是否持仓，
 *  以及当天全部原始证据」。它是**纯函数**：无 IO、无 `Math.random`、无 `Date.now`。
 *
 * ## 本模块**不做**什么
 *
 * 不排序、不随机、不撮合、不算成本、不做退出。那些各有唯一实现（账户层 / 唯一引擎 / 冻结 Runner 政策）。
 *
 * ## 🔴 PIT 不变量
 *
 *  - 只用**当日及以前**的行情（确认日收盘形成信号，次一交易日开盘执行）；
 *  - 不使用未来最高价、完整未来路径、下一日能否成交；
 *  - `maxAmp5`（rd15 才可得）**完全不参与**本规则与任何排序。
 *
 * ## 🔴 单一求值实现
 *
 * 修复分支与原分支**同处一个求值器**（`entry.ts#evaluateRecoveryDays`），逐日证据一次性产出，
 * 归因直接消费它 —— 目标 §3 末段明确禁止再写一套「接近但不相同」的条件解释器。
 */

import type { PoolBar, PoolEvent } from "../rollingPoolRightTail/projection";
import type {
  EarlyEntryEvaluation,
  ObservationMissingReason,
  ObservationScoreItem,
} from "../rollingPoolEarlyEntry";
import type {
  BuyEligibility,
  SecurityStatusFact,
  SecurityStatusProvider,
} from "./stGate";

export type { PoolBar, PoolEvent, EarlyEntryEvaluation, BuyEligibility, SecurityStatusFact };

// ---------------------------------------------------------------------------
// 一、冻结常量（目标 §2 / §3，逐字；改动即新实验，必须升版本）
// ---------------------------------------------------------------------------

/** 本模块计算口径版本（= `descriptor.version`）。 */
export const RECOVERY_COMPUTATION_VERSION = "1.0.0";

/** A 组（= 003 的 D）与原分支共用的连续观察日数 `N`。 */
export const ORIGINAL_OBSERVATION_DAYS = 5;
/** A 组（= 003 的 D）与原分支共用的最晚**实际成交**相对日 `L`。 */
export const ORIGINAL_ENTRY_FILL_MAX_RD = 20;
/** 最早确认日 = `N + 1`。 */
export const CONFIRM_MIN_RD = ORIGINAL_OBSERVATION_DAYS + 1;
/** 最晚确认日 = `L − 1` = **rd19**（rd19 允许、rd20 不允许）。 */
export const CONFIRM_MAX_RD = ORIGINAL_ENTRY_FILL_MAX_RD - 1;
/** 池观察上界（rd1..40，与 003 一致；到期后只观察、不新买）。 */
export const WATCH_MAX_RD = 40;
/** 修复观察窗口长度 `W = [d−5, d−1]`。 */
export const RECOVERY_WINDOW_DAYS = 5;
/** 修复综合分下限：`ΣQ_j ≥ 15`（满分 20）。**不要求**单日 `Q ≥ 3`。 */
export const REPAIR_SCORE_TOTAL_MIN = 15;
/** 修复综合分满分（5 日 × 4 分）。 */
export const REPAIR_SCORE_MAX = RECOVERY_WINDOW_DAYS * 4;
/** 浮点比较容差（价格/成交量）。 */
export const EPSILON = 1e-9;

/** 原分支逐日观察分四项（`S_j`）。 */
export const ORIGINAL_SCORE_ITEMS: readonly ObservationScoreItem[] = Object.freeze([
  "support",
  "shrink",
  "lowStable",
  "closeImprove",
]);
/** 修复分支逐日综合分四项（`Q_j`，目标 §3.3-4）。 */
export const REPAIR_SCORE_ITEM_KEYS = [
  "atOrAboveLocalLow",
  "shrink",
  "lowStable",
  "closeImprove",
] as const;
export type RepairScoreItemKey = (typeof REPAIR_SCORE_ITEM_KEYS)[number];

/** 两个研究组（目标 §2）。 */
export const RECOVERY_GROUP_IDS = ["A_STRICT_20", "B_RECOVERY_20"] as const;
export type RecoveryGroupId = (typeof RECOVERY_GROUP_IDS)[number];

// ---------------------------------------------------------------------------
// 二、状态机（目标 §3.3 末段：三个状态分开记录）
// ---------------------------------------------------------------------------

/**
 * 价格状态（**与 ST / 账户容量无关**）。
 *
 * 🔴 ST 或账户容量**不能**抹掉价格观察历史：一只票可以在同一天
 *    `priceState = "SIGNAL_FORMED"` 而 `buyEligibility = "ST_BLOCKED"`。
 */
export const PRICE_STATES = [
  "ORIGINAL_WATCH",
  "RECOVERY_WATCH",
  "RECOVERY_MATURE",
  "SIGNAL_FORMED",
  "EXPIRED",
] as const;
export type PriceState = (typeof PRICE_STATES)[number];

/** 持仓状态（账户层输入；价格观察与它正交）。 */
export const POSITION_STATES = ["FLAT", "HOLDING"] as const;
export type PositionState = (typeof POSITION_STATES)[number];

/**
 * 拒因（**只增不改**；每个锚点的每一层排除都必须能归因）。
 *
 * 前缀约定：`ORIGINAL_*` = 原分支（= 003 的 D），`REPAIR_*` = 破位后的修复分支。
 */
export const RECOVERY_REJECT_REASONS = [
  // ---- 原分支 ----
  "ORIGINAL_EVENT_DAY_BAR_UNUSABLE",
  "ORIGINAL_SUPPORT_PATH_INCOMPLETE",
  "ORIGINAL_SUPPORT_BREACHED",
  "ORIGINAL_NO_PULLBACK_YET",
  "ORIGINAL_WINDOW_SCORE_INSUFFICIENT",
  "ORIGINAL_NO_CLOSE_BREAKOUT",
  "ORIGINAL_VOLUME_NOT_RECOVERED",
  "ORIGINAL_NOT_CONFIRM_DAY",
  "CONFIRM_WINDOW_EXPIRED",
  "DAY_NOT_ASSESSABLE",
  "PREV_TWO_DAY_UNASSESSABLE",
  // ---- 永久停用（A 组）----
  "ANCHOR_BUY_DISABLED_SUPPORT_BREACHED",
  // ---- 修复分支 ----
  "REPAIR_NO_FRESH_WINDOW_AFTER_LOCAL_LOW",
  "REPAIR_WINDOW_NOT_ASSESSABLE",
  "REPAIR_WINDOW_BELOW_LOCAL_LOW",
  "REPAIR_EPISODE_BROKEN_BY_GAP",
  "REPAIR_EPISODE_RESTARTED_AFTER_GAP",
  "REPAIR_LOCAL_LOW_UPDATED",
  "REPAIR_COMPOSITE_SCORE_INSUFFICIENT",
  "REPAIR_COMPOSITE_OK_AWAITING_CONFIRM",
  "REPAIR_CLOSE_BREAKOUT_MISSING",
  "REPAIR_VOLUME_NOT_RECOVERED",
  "REPAIR_NO_PULLBACK_YET",
  "FACTOR_NOT_ASSESSABLE",
  // ---- ST 闸门（价格状态照记，买入被拒）----
  "ST_BLOCKED_AT_CONFIRM_CLOSE",
  "UNKNOWN_BLOCKED_AT_CONFIRM_CLOSE",
  "ST_BLOCKED_BEFORE_FILL",
  "UNKNOWN_BLOCKED_BEFORE_FILL",
] as const;
export type RecoveryRejectReason = (typeof RECOVERY_REJECT_REASONS)[number];

// ---------------------------------------------------------------------------
// 三、逐日证据
// ---------------------------------------------------------------------------

/** 原分支逐日观察分四项（`S_j`；与 003 的 `ObservationFlags` 同义，此处显式命名以便归因直读）。 */
export interface OriginalScoreComponents {
  /** `L_j >= 0.98 · O_0`。 */
  readonly supportLine: 0 | 1;
  /** `V_j <= 0.5 · V_0`。 */
  readonly shrink: 0 | 1;
  /** `L_j >= L_(j−1)`。 */
  readonly lowStable: 0 | 1;
  /** `C_j > C_(j−1)`。 */
  readonly closeImprove: 0 | 1;
}

/**
 * 修复分支逐日综合分四项（`Q_j`，目标 §3.3-4）。
 *
 * 🔴 四项**原始值全部保留**（`repairScore` 只是它们的和）：只报总分会让
 *    「同样的 15 分，一种是守线为主、一种是缩量为主」无法区分。
 */
export interface RepairScoreComponents {
  /** `L_j >= F`（相对**局部低点**，不是 `0.98·O_0`）。 */
  readonly atOrAboveLocalLow: 0 | 1;
  /** `V_j <= 0.5 · V_0`。 */
  readonly shrink: 0 | 1;
  /** `L_j >= L_(j−1)`。 */
  readonly lowStable: 0 | 1;
  /** `C_j > C_(j−1)`。 */
  readonly closeImprove: 0 | 1;
}

/** 一个局部修复段（`repairEpisodeId = anchorEventId + p`）。 */
export interface RepairEpisode {
  /** `anchorEventId + p`（**不是**新锚点、**不是**新期限）。 */
  readonly repairEpisodeId: string;
  /** 局部低点所在的相对日 `p`。 */
  readonly localLowRd: number;
  /** 局部低点价位 `F`（破位后分支的参考支撑；**不是退出价**）。 */
  readonly localLow: number;
  /** 本段起始相对日（= 建立本段低点基准的那一天）。 */
  readonly startedRd: number;
  /** 本段被无效日打断的相对日（未被打断 ⇒ null）。 */
  readonly brokenAtRd: number | null;
  /** 本段内见过的最高窗口综合分（证据用）。 */
  readonly maxWindowScore: number | null;
  readonly maxWindowScoreRd: number | null;
}

/** 单个观察日的完整记录（**归因直接消费**）。 */
export interface RecoveryDayRecord {
  readonly relativeDay: number;
  readonly tradeDate: string | null;
  readonly priceState: PriceState;
  readonly buyEligibility: BuyEligibility;
  readonly positionState: PositionState;
  /** 当日是否形成（价格意义上的）信号。 */
  readonly signalFormed: boolean;
  /** 当日是否**永久**禁止买入（A 组破位后为 true；B 组恒 false）。 */
  readonly buyDisabled: boolean;
  /** 永久停用的原因（未停用 ⇒ null）。 */
  readonly buyDisabledReason: RecoveryRejectReason | null;
  /** 原分支逐日观察分 `S_j`（0..4）；不可评估 / 超出评分视界 ⇒ null。 */
  readonly originalScore: number | null;
  readonly originalComponents: OriginalScoreComponents | null;
  readonly originalMissingReason: ObservationMissingReason | null;
  /** 修复分支当日综合分 `Q_t`；不适用（未破位 / 不可评估 / 超期）⇒ null。 */
  readonly repairScore: number | null;
  readonly repairComponents: RepairScoreComponents | null;
  /** `W = [d−5, d−1]`（rd 升序）；当前不构成完整窗口 ⇒ 空数组。 */
  readonly repairWindow: readonly number[];
  /** `ΣQ_j`（W 上五项之和，满分 20）；窗口缺失/不可评估 ⇒ null。 */
  readonly repairWindowScore: number | null;
  /** 局部低点相对日 `p`（尚未破位 ⇒ null）。 */
  readonly localLowRd: number | null;
  /** 局部低点价位 `F`（尚未破位 ⇒ null）。 */
  readonly localLow: number | null;
  /** `anchorEventId + p`（尚未破位 ⇒ null）。 */
  readonly repairEpisodeId: string | null;
  /** 当日是否创出**更低**低点（与 `F` 相等**不算**）。 */
  readonly localLowUpdated: boolean;
  /** 当日是否因无效日而**重开**修复段（下一有效日建立新低点基准）。 */
  readonly episodeRestarted: boolean;
  /** 当日是否因无效日**中断**了修复段。 */
  readonly episodeBroken: boolean;
  /** 截至当日的路径最低 low（证据用；不可评估 ⇒ null 不参与）。 */
  readonly runningMinLow: number | null;
  /** 当日因子（`preReturn10`）是否可评估；未注入判定器 ⇒ null（**不假装可评估**）。 */
  readonly factorAssessable: boolean | null;
  /** 当日命中的 ST 状态证据（无 ⇒ null）。 */
  readonly statusFact: SecurityStatusFact | null;
  readonly rejectionReasons: readonly RecoveryRejectReason[];
}

/** 一个确认日（收盘确认 ⇒ 次一交易日开盘计划成交）。 */
export interface RecoveryTrigger {
  readonly confirmRd: number;
  readonly confirmDate: string;
  readonly fillRd: number;
  /** 次一交易日 bar 缺失 ⇒ null（**不是**「不可成交」，是「未知」）。 */
  readonly fillDate: string | null;
  /** 走到这个信号的**分支**：`ORIGINAL` = 未破位的原分支，`RECOVERY` = 破位后的修复分支。 */
  readonly branch: "ORIGINAL" | "RECOVERY";
  /** 修复段 id（`ORIGINAL` 分支 ⇒ null）。 */
  readonly repairEpisodeId: string | null;
  readonly localLowRd: number | null;
  readonly localLow: number | null;
  /** 修复窗口 `W` 与 `ΣQ_j`（`ORIGINAL` 分支 ⇒ 空 / null）。 */
  readonly repairWindow: readonly number[];
  readonly repairWindowScore: number | null;
  readonly closePrev2High: number;
  readonly closeConfirm: number;
  readonly volumePrev1: number;
  readonly volumeConfirm: number;
  /** 确认日之前**确实发生过** `C_j < C_0` 回撤的相对日（系统要求，非空）。 */
  readonly pullbackFirstRd: number;
  /** 该确认日收盘时点的买入资格（**信号成立不等于能买**）。 */
  readonly confirmCloseBuyEligibility: BuyEligibility;
  readonly confirmCloseStatusFact: SecurityStatusFact | null;
}

/** 单个锚点的完整评估（**纯研究投影**，不含账户状态）。 */
export interface RecoveryEvaluation {
  readonly eventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly group: RecoveryGroupId;
  readonly eventDayOpen: number | null;
  readonly eventDayVolume: number | null;
  readonly eventDayClose: number | null;
  /** `0.98 · O_0`。 */
  readonly supportFloor: number | null;
  /** rd1..40 的逐日记录。 */
  readonly days: readonly RecoveryDayRecord[];
  /** 全部成立的确认日（升序）；**保留全部**（未成交可重试、平仓后可再入场）。 */
  readonly triggers: readonly RecoveryTrigger[];
  /** 分组自带的原分支评估（A 组 = 003 的 D，逐字节同义；B 组同样复用它的**未破位分支**）。 */
  readonly originalEvaluation: EarlyEntryEvaluation;
  /** 首次可靠 `L_t < 0.98·O_0` 的相对日（无 ⇒ null）。 */
  readonly supportBreachRd: number | null;
  /** 全部修复段（升序）。 */
  readonly repairEpisodes: readonly RepairEpisode[];
  /** 观察期结束时的价格状态。 */
  readonly finalPriceState: PriceState;
  readonly finalReason: RecoveryRejectReason | null;
  /** 诊断计数（如 `GAP_BROKEN_EPISODES` / `RESTARTED_EPISODES` / `LOCAL_LOW_UPDATES`）。 */
  readonly diagnostics: Readonly<Record<string, number>>;
}

/** 求值参数。 */
export interface RecoveryEvaluationOptions {
  /** 研究组（**必填**，没有缺省 —— 缺省会让 A/B 混用而不自知）。 */
  readonly group: RecoveryGroupId;
  /**
   * ST 状态 provider。
   *
   * 🔴 缺省 = `ABSENT_STATUS_PROVIDER` ⇒ 逐日 `buyEligibility` 恒为 `UNKNOWN_BLOCKED`。
   *    **没有**任何「缺数据按 NORMAL」的缺省。
   */
  readonly stProvider?: SecurityStatusProvider | null;
  /** 持仓状态注入（账户层事实）；缺省恒 `FLAT`。 */
  readonly positionStateOf?: (input: {
    readonly relativeDay: number;
    readonly tradeDate: string | null;
  }) => PositionState;
  /**
   * 因子可评估判定（`preReturn10` 是否可得）。
   *
   * 缺省 ⇒ 逐日记 `null`（**未判定**），信号照样产出，由账户层按 003 的做法过滤；
   * 注入后 ⇒ 确认日因子不可评估则**不发信号**（目标 §3.3-5「当日因子可评估」）。
   */
  readonly factorAssessableOf?: (input: {
    readonly relativeDay: number;
    readonly tradeDate: string | null;
  }) => boolean | null;
  /** 观察上界（缺省 `WATCH_MAX_RD` = 40）。 */
  readonly maxRelativeDay?: number;
}
