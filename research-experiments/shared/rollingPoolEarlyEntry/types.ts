/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` —— 入场观察规则：冻结常量与类型。
 *
 * 权威规则文本：[`RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md`](../../../docs/research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md)。
 * 本模块只表达**规则**，不含任何账户 / 撮合 / 排序逻辑（那些分别在账户层与执行层）。
 *
 * 🔴 PIT 不变量（本模块的全部输出只能使用「当日及之前」的真实行情）：
 *   - 不使用未来最高价、完整未来路径、下一日能否成交、后来是否涨停；
 *   - `maxAmp5`（rd15 才可得）**完全不参与**入场与排序；
 *   - 观察分 `S_d` 只用 rd0..rd 自己的 bar；连续两日只看 `S_(d-2)`、`S_(d-1)`。
 */

export const EARLY_ENTRY_COMPUTATION_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// 一、冻结参数（规则 §7：全部是本轮研究假设，**不是**已证明最优参数；冻结后不搜索）
// ---------------------------------------------------------------------------

/** 首板参考支撑位 = `O_0`（**首板日开盘价**，不是低点、不是涨停价、不是 MA）。 */
export const SUPPORT_ANCHOR_FIELD = "eventDayOpen" as const;
/** 守线容差：`L_d >= 0.98 · O_0`。 */
export const SUPPORT_RATIO = 0.98;
/** 缩量阈值：`V_d <= 0.50 · V_0`。 */
export const SHRINK_RATIO = 0.5;
/** 连续两日观察合格所需的最低分（四项各 1 分，总分 0..4）。 */
export const OBSERVATION_MIN_SCORE = 3;
/** 观察分四项（等权，各 1 分）。 */
export const OBSERVATION_SCORE_ITEMS = ["support", "shrink", "lowStable", "closeImprove"] as const;
export type ObservationScoreItem = (typeof OBSERVATION_SCORE_ITEMS)[number];

/** 确认日下界：先有两个完整观察日（rd1、rd2），故最早 rd3。 */
export const CONFIRM_MIN_RD = 3;
/** 确认日上界：T+9 收盘确认 ⇒ T+10 开盘成交。 */
export const CONFIRM_MAX_RD = 9;
/** 成交相对日上界（含）：`rd <= 10`。 */
export const ENTRY_FILL_MAX_RD = 10;

// ---------------------------------------------------------------------------
// 二·补、可参数化的观察窗口与入场期限（`OBSERVATION-WINDOW-003`）
//
// 规则：`N+1 <= d <= L-1`，其中 N = 连续观察日数、L = 最晚**实际成交**相对日。
// 🔴 `N=2 / L=10` 是 001/002 的冻结口径；默认值即该口径 ⇒ **旧版本可精确重放**。
// ---------------------------------------------------------------------------

/** 默认连续观察日数（= 001/002 冻结值）。 */
export const OBSERVATION_DAYS_DEFAULT = 2;
/** 默认最晚实际成交相对日（= 001/002 冻结值）。 */
export const ENTRY_FILL_MAX_RD_DEFAULT = 10;
/** 本轮矩阵用到的观察窗口取值（**冻结，不再追加**）。 */
export const OBSERVATION_DAYS_MATRIX = [2, 3, 5] as const;
/** 本轮矩阵用到的最晚成交相对日（**冻结，不再追加**）。 */
export const ENTRY_FILL_MAX_RD_MATRIX = [10, 20] as const;

/** 评估参数（缺省 = 001/002 冻结口径）。 */
export interface EarlyEntryOptions {
  /** 连续观察日数 N（>=1）。默认 2。 */
  readonly observationDays?: number;
  /** 最晚**实际成交**相对日 L（>= N+2）。默认 10。 */
  readonly entryFillMaxRd?: number;
}

/** 与固定退出政策一致的 Runner 最长续持（仅用于声明执行尾部视界，不参与入场）。 */
export const RUNNER_EXTEND_TO_HOLDING_DAYS = 74;

// ---------------------------------------------------------------------------
// 二、状态机（规则 §4）
// ---------------------------------------------------------------------------

export const ENTRY_STATES = [
  "OBSERVING",
  "ARMED",
  "TRIGGERED",
  "HELD",
  "INVALIDATED_SUPPORT",
  "ENTRY_EXPIRED",
  "UNASSESSABLE",
] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

/**
 * 逐日/逐事件拒绝原因码（**只增不改**；每个锚点的每一层排除都必须能归因）。
 *
 * - `EVENT_DAY_BAR_UNUSABLE`：首板日 bar 不可用 ⇒ 无法确定 `O_0`/`V_0` ⇒ 整个锚点本轮不可评估；
 * - `SUPPORT_PATH_INCOMPLETE`：rd1..d 中存在无法评估的 bar ⇒ **不能声称「全程未破位」**；
 * - `SUPPORT_BREACHED`：某日可靠低点 < `0.98·O_0` ⇒ 本轮资格作废且**不恢复**；
 * - `NO_PULLBACK_YET`：到该日为止尚未出现 `C_j < C_0`（j ≤ d−1）；
 * - `PREV_TWO_DAY_SCORE_INSUFFICIENT`：`S_(d-2) < 3` 或 `S_(d-1) < 3`（含其中之一不可评估）；
 * - `NO_CLOSE_BREAKOUT`：`C_d <= max(H_(d-2), H_(d-1))`；
 * - `VOLUME_NOT_RECOVERED`：`V_d < V_(d-1)`；
 * - `ENTRY_WINDOW_EXPIRED`：已过 rd9 仍未触发；
 * - `NOT_OBSERVATION_DAY`：rd 不在 3..9（仅记账，不是失败）。
 */
export const ENTRY_REJECT_REASONS = [
  "EVENT_DAY_BAR_UNUSABLE",
  "SUPPORT_PATH_INCOMPLETE",
  "SUPPORT_BREACHED",
  "NO_PULLBACK_YET",
  "PREV_TWO_DAY_SCORE_INSUFFICIENT",
  "NO_CLOSE_BREAKOUT",
  "VOLUME_NOT_RECOVERED",
  "ENTRY_WINDOW_EXPIRED",
  "NOT_OBSERVATION_DAY",
] as const;
export type EntryRejectReason = (typeof ENTRY_REJECT_REASONS)[number];

/** 单个观察日的分项不可评估原因（缺数据**不打 0 分、不插值**）。 */
export const OBSERVATION_MISSING_REASONS = [
  "BAR_MISSING",
  "BAR_SUSPENDED",
  "BAR_INVALID",
  "ZERO_VOLUME",
  "PREV_BAR_MISSING",
  "EVENT_BAR_UNUSABLE",
] as const;
export type ObservationMissingReason = (typeof OBSERVATION_MISSING_REASONS)[number];

// ---------------------------------------------------------------------------
// 三、产物类型
// ---------------------------------------------------------------------------

/** 四项 0/1 分项（**单列存档**，避免总分掩盖路径差异 —— 规则 §2）。 */
export interface ObservationFlags {
  /** `L_d >= 0.98 · O_0`（首板开盘支撑未明显失守）。 */
  readonly support: 0 | 1;
  /** `V_d <= 0.50 · V_0`（相对首板日缩量）。 */
  readonly shrink: 0 | 1;
  /** `L_d >= L_(d-1)`（当日没有继续创新低）。 */
  readonly lowStable: 0 | 1;
  /** `C_d > C_(d-1)`（收盘开始改善）。 */
  readonly closeImprove: 0 | 1;
}

/** 单个观察日（rd ≥ 1）的评分记录。`score = null` 表示**不可评估**（含原因）。 */
export interface ObservationDayScore {
  readonly relativeDay: number;
  /** 当日实际交易日（缺失该 bar 时为 null）。 */
  readonly tradeDate: string | null;
  /** 分项；不可评估时为 null。 */
  readonly flags: ObservationFlags | null;
  /** 总分 0..4；不可评估时为 null。 */
  readonly score: number | null;
  readonly missingReason: ObservationMissingReason | null;
  /** 当日是否低于支撑（可靠 low 且破位）；不可评估时 null。 */
  readonly supportBreached: boolean | null;
}

/** 一个确认日的完整成立证据（T+9 确认 ⇒ T+10 开盘成交）。 */
export interface EntryTrigger {
  /** 确认日相对日 ∈ [3,9]。 */
  readonly confirmRd: number;
  readonly confirmDate: string;
  /** 成交相对日 = confirmRd + 1 ∈ [4,10]。 */
  readonly fillRd: number;
  /** 若下一交易日 bar 缺失则为 null（**不是**「不可成交」，是「未知」）。 */
  readonly fillDate: string | null;
  /** 触发当日六条件的证据快照（可审计）。 */
  readonly evidence: {
    /** 首次出现 `C_j < C_0` 的相对日 j（≤ confirmRd−1）。 */
    readonly pullbackFirstRd: number;
    /** rd1..confirmRd 的最小 low。 */
    readonly supportMinLow: number;
    /** `0.98 · O_0`。 */
    readonly supportFloor: number;
    readonly scorePrev2: number;
    readonly scorePrev1: number;
    readonly closePrev2High: number;
    readonly closeConfirm: number;
    readonly volumePrev1: number;
    readonly volumeConfirm: number;
  };
}

/**
 * 单个锚点事件的完整入场评估。
 *
 * 🔴 这是**纯研究投影**：不含账户状态（同股持仓 / 同锚点曾买 / 空位 / 现金），
 *    那些属账户层，在排序**之后**检查，且**不得回流**改变本对象。
 */
export interface EarlyEntryEvaluation {
  readonly eventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  /** 首板日开盘价 `O_0`（事件日 bar 不可用时 null）。 */
  readonly eventDayOpen: number | null;
  readonly eventDayVolume: number | null;
  /** `0.98 · O_0`。 */
  readonly supportFloor: number | null;
  /** rd1..rd9 的逐日评分（**始终单列四项**）。 */
  readonly observationDays: readonly ObservationDayScore[];
  /** 首次出现 `C_j < C_0` 的相对日（无则 null）。 */
  readonly pullbackFirstRd: number | null;
  /** 首次可靠 low < `0.98·O_0` 的相对日（无则 null）。 */
  readonly supportBreachRd: number | null;
  /** 是否存在无法评估 rd1..d 从而不能声称「全程未破位」的观察日。 */
  readonly supportPathIncomplete: boolean;
  /**
   * 全部成立的确认日（升序）。
   *
   * 🔴 返回**全部**而非只取首个：规则 §4「拒单或未选中不视为成功建仓……
   * 之后只有**重新满足全部触发条件**且仍可 T+10 前成交，才允许再次参与排名」。
   * 具体采用「首发优先、首个**实际成交**的确认日」由账户层决定。
   */
  readonly triggers: readonly EntryTrigger[];
  /** rd9 结束后的终态。 */
  readonly finalState: Exclude<EntryState, "HELD">;
  /** 终态的最后一条原因（可空）。 */
  readonly finalReason: EntryRejectReason | null;
}
