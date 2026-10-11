/**
 * `FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001` —— 事后归因纯库：**类型与冻结常量**。
 *
 * 规格（**实现前冻结**）：[`docs/research/PREREG-FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001.md`](../../../docs/research/PREREG-FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001.md)。
 *
 * 🔴 纪律（规格 §7）：
 *   1. 本库是**纯函数库**：无 IO、无 DB、无时钟、无随机 ⇒ 同输入必得同输出；
 *   2. 标签（`BIG50_ACTIONABLE` / `BIG50_PATH`）是**事后（hindsight）**口径，
 *      **只用于归因**，**绝不回流**到资格 / 评分 / 排序 / 仓位 / 退出或任何规则；
 *   3. 本库**不新增实验、不新增引擎、不新增指标出口**；它读的是既有 Run 的**已持久化产物**。
 */

/** 归因口径版本（口径变化必须显式升版，便于将来对账）。 */
export const LOSS_ATTRIBUTION_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// 一、冻结阈值（规格 §3）
// ---------------------------------------------------------------------------

/** 主标签阈值：+50%。 */
export const BIG50_THRESHOLD = 0.5;

/** 稀疏性检查阈值：+100%（规格 §3.3「同口径再报」）。 */
export const BIG100_THRESHOLD = 1.0;

/**
 * 主标签（`BIG50_ACTIONABLE`）的持有窗口**偏移上界**。
 *
 * 规格 §3.1 逐字：`max( close(rd_{d+1} … rd_{d+1+20}) ) / open(rd_{d+1}) − 1 >= +50%`
 * ⇒ 入场相对日 `fillRd = d+1`，窗口 = `[fillRd, fillRd + 20]` = **21 根收盘**（两端闭）。
 * 这与「`max L=20 ⇒ fill ≤ 20`，`+20 ⇒ rd ≤ 40`」的读入需求一致（行情只需 rd ≤ 40）。
 */
export const ACTIONABLE_HOLDING_DAYS = 20;

/** 背景标签（`BIG50_PATH`）窗口：规格 §3.2 逐字 `max(close(rd1 … rd40)) / close(rd0) − 1`。 */
export const PATH_WINDOW_START_RD = 1;
export const PATH_WINDOW_END_RD = 40;

/** 对照桶 `X_CAPTURED` 的阈值：已实现 ≥ +20%（规格 §4 第 8 行）。 */
export const X_CAPTURED_THRESHOLD_PCT = 20;

/** R（主臂）排序的每日取前 K（与 003 Run 的 `DAILY_TOP_K` 同源 = `TOP_K` = 3）。 */
export const DAILY_TOP_K = 3;

/** 排序破平键（与 003 Run 的 `sortCandidates` 逐字一致）。 */
export const RANK_TIE_BREAK_KEY = "preReturn10 降序 → symbol 升序 → eventId 升序";

// ---------------------------------------------------------------------------
// 二、漏斗桶（规格 §4，**互斥，1→8 首次命中即止**）
// ---------------------------------------------------------------------------

/**
 * 8 个互斥桶，**顺序即优先级**（= 决策管线施加顺序：
 * 池 → 支撑 → 观察分 → 突破 → 因子可评估 → 排序 → 账户 → 退出）。
 */
export const BUCKET_IDS = [
  "S1_SUPPORT_INVALIDATED",
  "S2_SCORE_INSUFFICIENT",
  "S3_NO_OTHER_TRIGGER",
  "S4_NOT_RANKABLE",
  "S5_RANK_NOT_SELECTED",
  "S6_ACCOUNT_UNABLE_TO_BUY",
  "S7_BOUGHT_EXITED_EARLY",
  "X_CAPTURED",
] as const;

export type BucketId = (typeof BUCKET_IDS)[number];

/** `S6` 的 5 个**子**原因（规格 §4 第 6 行；子桶之间也互斥，按下列顺序首次命中即止）。 */
export const S6_SUB_BUCKET_IDS = [
  "S6a_CAPACITY",
  "S6b_SAME_STOCK",
  "S6c_REENTRY_BLOCKED",
  "S6d_NO_FILL",
  "S6e_OTHER",
] as const;

export type S6SubBucketId = (typeof S6_SUB_BUCKET_IDS)[number];

/**
 * `skipCode` → `S6` 子桶的**唯一映射**（来源：`server/research/simulator/types.ts#PlanSkipCode`
 * 与 `server/research/simulator/plan.ts#planDecisionDay` 的真实取值）。
 *
 * 🔴 两点必须在报告里披露：
 *   - 规格只点名了 `MAX_POSITIONS_REACHED` / `CONCURRENT_CODE_POSITION_LIMIT` /
 *     `MEMBER_ENTRY_LIMIT_REACHED` 三个码；**实测该 Run 还会产出**
 *     `MAX_DAILY_BUYS_REACHED`（单日新建仓上限）⇒ 按语义归入 `S6e_OTHER`（不是容量/持仓上限）；
 *   - `S6d_NO_FILL` 是**残差桶**：进入 R 的 TopK、既无成交、又**没有任何** skip 记录
 *     ⇒ 意图在下单/撮合层被拒（涨停 / 停牌 / 无流动性 / 无次一交易日）。逐账户拒单**不在**
 *     本 Run 的产物里（只有组级合计 `REJECTED__*`），因此只能以残差如实归类。
 */
export const S6_SKIP_CODE_TO_SUB_BUCKET: Readonly<Record<string, S6SubBucketId>> = Object.freeze({
  MAX_POSITIONS_REACHED: "S6a_CAPACITY",
  CONCURRENT_CODE_POSITION_LIMIT: "S6b_SAME_STOCK",
  MEMBER_ENTRY_LIMIT_REACHED: "S6c_REENTRY_BLOCKED",
  NO_NEXT_TRADING_DAY: "S6d_NO_FILL",
  ZERO_VOLUME: "S6d_NO_FILL",
  BUDGET_BELOW_MIN_LOT: "S6e_OTHER",
  POSITION_SIZING_ZERO_BUDGET: "S6e_OTHER",
  NON_LONG_DIRECTION: "S6e_OTHER",
  MARKET_REGIME_BLOCKED: "S6e_OTHER",
  REENTRY_COOLDOWN_ACTIVE: "S6e_OTHER",
  MAX_DAILY_BUYS_REACHED: "S6e_OTHER",
});

/** 退出原因（自由文本 `reason`）→ 规格 §4 第 7 行点名的分组。 */
export const EXIT_REASON_BUCKETS = ["止损", "MA_CROSS", "时间退出", "strongHold", "期末", "其他"] as const;
export type ExitReasonBucket = (typeof EXIT_REASON_BUCKETS)[number];

/** 「从未触发」的首要拒绝原因码（规则库 `EntryRejectReason`，见 `shared/rollingPoolEarlyEntry/types.ts`）。 */
export const S2_REJECTION_CODES: readonly string[] = Object.freeze([
  "PREV_TWO_DAY_SCORE_INSUFFICIENT",
  "N_DAY_SCORE_INSUFFICIENT",
  "N_DAY_SCORE_UNASSESSABLE",
]);

// ---------------------------------------------------------------------------
// 三、已解析的行（库只吃**已解析**的行，解析在 `csv.ts` / 工具里）
// ---------------------------------------------------------------------------

/** 未来行情的一根 bar（Dataset `*_post`；`rd ≥ 1`）。 */
export interface ForwardBar {
  readonly relativeDay: number;
  readonly tradeDate: string | null;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly close: number | null;
}

/** `relativeDay → bar`（缺失的相对日**不插值、不补行**）。 */
export type ForwardBars = ReadonlyMap<number, ForwardBar>;

/** `observation-ledger-{year}.csv` 一行（跨组共享的逐日观察账）。 */
export interface ObservationLedgerRow {
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly relativeDay: number;
  readonly tradeDate: string | null;
  readonly support: number | null;
  readonly shrink: number | null;
  readonly lowStable: number | null;
  readonly closeImprove: number | null;
  readonly score: number | null;
  readonly missingReason: string | null;
  readonly supportBreached: boolean | null;
  /** 该 rd 是哪些组的**确认日**（`|` 分隔；来自 Run 的 `triggerGroupsByEventRd`）。 */
  readonly triggerGroups: readonly string[];
  readonly isCandidateAnchor: boolean;
}

/** `group-{A..E}-candidate-days.csv` 一行（真实买点候选 = 确认日）。 */
export interface CandidateDayRow {
  readonly date: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly securityId: string;
  readonly eventAge: number;
  readonly confirmRd: number;
  readonly fillRd: number;
  readonly fillDate: string | null;
  readonly preReturn10: number | null;
  readonly triggerOrdinal: number;
  readonly isLaterTriggerDay: boolean;
}

/** `group-{A..E}-trades-R.csv` 一行（R 账户真实成交）。 */
export interface TradeRow {
  readonly securityId: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly entryTime: string;
  readonly entryPrice: number;
  readonly exitTime: string | null;
  readonly exitPrice: number | null;
  readonly quantity: number;
  /** 已实现收益（**百分数**，例 `-3.2492` = −3.25%）。 */
  readonly returnPct: number;
  readonly netPnl: number;
  readonly fees: number;
  readonly holdingPeriod: number;
  readonly openAtEnd: boolean;
  readonly reason: string;
}

/** `group-{A..E}-reentry-failed-attempts.csv` 一行（未成交 / 被阻断的**建仓**尝试）。 */
export interface FailedAttemptRow {
  readonly accountId: string;
  readonly group: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly attemptedConfirmDate: string;
  readonly plannedFillDate: string | null;
  readonly skipCode: string;
  readonly reason: string;
  readonly priorEntryOrdinalActual: number | null;
  readonly priorActualExitDate: string | null;
}

/** 五组冻结配置的**最小投影**（数值与 `rolling-pool-observation-window/result.ts#GROUPS` 同源）。 */
export interface GroupSpecLite {
  readonly id: string;
  readonly observationDays: number;
  readonly entryFillMaxRd: number;
  readonly reentryKind: "SIGNAL_REENTRY" | "SINGLE_ENTRY";
}

/** 最早确认日 = `N + 1`（先有 N 个完整观察日）。 */
export function confirmMinRdOf(spec: GroupSpecLite): number {
  return spec.observationDays + 1;
}

/** 最晚确认日 = `L − 1`（T+L 开盘成交）。 */
export function confirmMaxRdOf(spec: GroupSpecLite): number {
  return spec.entryFillMaxRd - 1;
}

// ---------------------------------------------------------------------------
// 四、标签（规格 §3；**事后口径，绝不回流**）
// ---------------------------------------------------------------------------

/** 某个「确认日 `d` ⇒ 次日开盘入场」的标签结果。 */
export interface EntryDayLabel {
  readonly confirmRd: number;
  /** 入场相对日 = `confirmRd + 1`（真实计划成交日）。 */
  readonly fillRd: number;
  readonly fillDate: string | null;
  readonly entryOpen: number | null;
  /** 窗口内**可用**（收盘有限）的 bar 数；`0` ⇒ 该日不可评估。 */
  readonly windowBarCount: number;
  readonly maxClose: number | null;
  readonly maxCloseRd: number | null;
  /** `maxClose / entryOpen − 1`（分数，非百分数）。 */
  readonly maxReturn: number | null;
  /** 是否达到阈值。 */
  readonly reached: boolean;
}

/** 背景标签 `BIG50_PATH`（锚点级，与入场时点无关）。 */
export interface PathLabel {
  readonly base: number | null;
  readonly windowBarCount: number;
  readonly maxClose: number | null;
  readonly maxCloseRd: number | null;
  readonly maxReturn: number | null;
  readonly reached: boolean;
}

/** 一个锚点在某组下的两个标签（主 = actionable，背景 = path）。 */
export interface OpportunityLabel {
  /** 主标签：`BIG50_ACTIONABLE` ⇒ **进入漏斗**。 */
  readonly big50Actionable: boolean;
  /** 主标签的**首个**可行入场日（`null` ⇒ 不成立）。 */
  readonly actionableDay: EntryDayLabel | null;
  /** 主标签的稀疏变体（+100%）。 */
  readonly big100Actionable: boolean;
  /** 背景标签：`BIG50_PATH` ⇒ **不进漏斗**，仅报数量。 */
  readonly big50Path: PathLabel;
  /** 背景标签的稀疏变体（+100%）。 */
  readonly big100Path: PathLabel;
}

// ---------------------------------------------------------------------------
// 五、排序（规格 §4 第 5 行）
// ---------------------------------------------------------------------------

/** 某日某锚点的排名（`rank` 从 1 起；`inTopK` = `rank <= TopK`）。 */
export interface RankedDayRow {
  readonly date: string;
  readonly anchorEventId: string;
  readonly rank: number;
  readonly inTopK: boolean;
  readonly preReturn10: number;
}

/** 逐日横截面排序结果（**只由候选行决定**，与账户层无关）。 */
export interface DailyRanking {
  readonly byDate: ReadonlyMap<string, readonly RankedDayRow[]>;
  /** `` `${date}|${anchorEventId}` `` → rank。 */
  readonly rankOf: ReadonlyMap<string, number>;
  readonly topKAnchors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly boundaryTieDayCount: number;
}

/** 某锚点在 R 侧的选中情况。 */
export interface TriggerSelection {
  readonly selectedConfirmRds: readonly number[];
  readonly selectedDates: readonly string[];
  /** 全部触发日中的**最好**名次（最小 rank）。 */
  readonly bestRank: number | null;
  readonly rankOnActionableDay: number | null;
  readonly selectedOnActionableDay: boolean;
}

// ---------------------------------------------------------------------------
// 六、分类（8 桶，首次命中即止）
// ---------------------------------------------------------------------------

/** 「从未触发」的首要拒绝原因（由 `derivePrimaryRejection` 依规则库顺序推出）。 */
export interface PrimaryRejection {
  readonly layer: string;
  readonly code: string;
  readonly evaluatedConfirmRd: number;
  readonly note: string;
}

export interface OpportunityClassificationInput {
  readonly group: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly label: OpportunityLabel;
  /** 该锚点在该组下的**全部**确认日（candidate-days 行）。 */
  readonly triggerDays: readonly CandidateDayRow[];
  /** `label.actionableDay.confirmRd` 那一行的候选行（**没有则 `null`** ⇒ 不可排序）。 */
  readonly actionableRow: CandidateDayRow | null;
  readonly observationRows: readonly ObservationLedgerRow[];
  /** 从未触发时必填（否则 `S2`/`S3` 无法区分）。 */
  readonly rejection: PrimaryRejection | null;
  readonly selection: TriggerSelection;
  /** R 账户在**该锚点**上的全部成交。 */
  readonly trades: readonly TradeRow[];
  /** R 账户在**该锚点**上的全部被阻断 / 未成交建仓尝试。 */
  readonly failedAttempts: readonly FailedAttemptRow[];
}

/** 分类结果（互斥）。 */
export interface ClassificationResult {
  readonly bucket: BucketId;
  readonly s6SubBucket: S6SubBucketId | null;
  /** 桶内细分原因（自由文本，稳定前缀便于对账）。 */
  readonly subReason: string;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// 七、聚合产物
// ---------------------------------------------------------------------------

/** 桶 × 计数 × 占比（**空桶也出行**，`count = 0`）。 */
export interface BucketCountRow {
  readonly bucket: BucketId;
  readonly order: number;
  readonly count: number;
  /** `count / total`（分数，非百分数；`total = 0` ⇒ 0）。 */
  readonly share: number;
}

export interface FunnelAggregate {
  readonly total: number;
  readonly rows: readonly BucketCountRow[];
  readonly s6SubCounts: Readonly<Record<S6SubBucketId, number>>;
}

/** 描述统计（`null` 值**不参与**，并单列缺失数）。 */
export interface DescribeStats {
  readonly count: number;
  readonly missing: number;
  readonly median: number | null;
  readonly mean: number | null;
  readonly p25: number | null;
  readonly p75: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

/** 逐笔「让出多少」（规格 §6.3）。 */
export interface S7GiveUpRow {
  readonly group: string;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly entryTime: string;
  readonly entryRd: number | null;
  readonly entryPrice: number;
  readonly exitTime: string | null;
  readonly holdingPeriod: number;
  /** 已实现收益（百分数）。 */
  readonly realizedReturnPct: number;
  /** 自**实际入场**起 20 个交易日的最大收盘涨幅（百分数；不可评估 ⇒ `null`）。 */
  readonly maxForwardFromEntryPct: number | null;
  /** 让出额 = `maxForwardFromEntryPct − realizedReturnPct`（两者都有才算）。 */
  readonly giveUpPct: number | null;
  readonly forwardBarCount: number;
  readonly exitReason: string;
  readonly exitReasonBucket: ExitReasonBucket;
}

export interface GiveUpSummary {
  readonly tradeCount: number;
  readonly evaluableCount: number;
  readonly totalGiveUpPct: number | null;
  readonly medianGiveUpPct: number | null;
  readonly meanGiveUpPct: number | null;
  readonly byExitReason: readonly {
    readonly exitReasonBucket: ExitReasonBucket;
    readonly tradeCount: number;
    readonly totalGiveUpPct: number | null;
    readonly medianGiveUpPct: number | null;
    readonly meanGiveUpPct: number | null;
  }[];
}

/** `S1` ↔ `S6c` 的交叉表（规格 §5）。 */
export interface CauseCoOccurrence {
  readonly s1Count: number;
  readonly s1WithTrades: number;
  readonly s1WithPriorExit: number;
  readonly s1WithPriorExitOrTrades: number;
  readonly s6cCount: number;
  readonly s6cWithPriorExit: number;
  readonly note: string;
}
