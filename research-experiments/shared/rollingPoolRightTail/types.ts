/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` —— 冻结常量与数据结构。
 *
 * 本模块是**纯研究投影**：不含 IO、不含 `Math.random`、不含 `Date.now`。
 * 所有区间 / 阈值 / TopK / 成本 / 种子都在这里**冻结**，任何改动都视为新实验（升 version）。
 *
 * 规格：`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001.md` §3–§5。
 */

/** 计算口径版本（= `descriptor.version`，同时是 customPayload 的 `z.literal`）。 */
export const ROLLING_POOL_COMPUTATION_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// 一、冻结范围（规格 §3）
// ---------------------------------------------------------------------------

/** 权威首板事件 `firstBoard`（今日涨停 ∧ 前一交易日非涨停）由 Dataset 构建期固化。 */
export const FIRST_BOARD_DATASET_CODE = "first_limit_pullback";
/** 冻结 Dataset 版本标签（**精确匹配**；不靠版本名称判断可用性，可用性由 READY 闸门保证）。 */
export const FROZEN_DATASET_VERSION_LABEL = "v10-listed365-pre10-post80";
/** 参考坐标（只读核验用；不作为运行参数）。 */
export const FROZEN_DATASET_VERSION_ID_REFERENCE = 780_004;

/** 留池窗口：事件年龄 rd1..40；rd40 收盘之后该成员过期。 */
export const WATCH_MIN_AGE = 1;
export const WATCH_MAX_AGE = 40;

/** 可选候选窗口：rd5..40。 */
export const SELECT_MIN_AGE = 5;
export const SELECT_MAX_AGE = 40;

/**
 * 🔴 `maxAmp5` 的**决策时点下界 = rd15**（Core 冻结口径 `EVENT_STATE_AMPLITUDE_WINDOW={11,15}`）。
 *
 * 规格 §3 写「可选候选 rd5..40，确保两规则均有完整既有 5 日特征」，并同时规定
 * 「两主臂及 Random 共同使用**两因子均可评估**的当日池」。
 * 两条合起来的**唯一自洽解**就是「两因子均可评估」的交集 ⇒ **有效可选年龄 = rd15..40**。
 * 这不是执行模型私自改值：`rd5..40` 是**上界声明**，`rd15` 由权威特征定义决定；
 * 交集由规格自己的条款确定。结果中必须把这个结构性事实**显式披露**
 * （`rd5..14` 仍在观察账里，拒绝原因 = `MAXAMP5_NOT_AVAILABLE_BEFORE_RD15`）。
 */
export const SELECTABLE_AGE_LOWER_BOUND = 15;

/** `preReturn10` 前缀窗（冻结：`close(rd−1) / close(rd−10) − 1`）。 */
export const PRE_RETURN10_PREFIX_DAYS = [-10, -1] as const;

/** 每日 TopK：最多 3 只；人数不足**不补齐**；不比较 Top5/10。 */
export const TOP_K = 3;

/** 标签 A：入场 = 决策后**下一交易日开盘**；持有 20 个交易日。 */
export const HOLDING_DAYS = 20;
/** 主退出不可卖时的顺延上限（交易日）。 */
export const EXIT_DEFERRAL_MAX_TRADING_DAYS = 10;

/**
 * 本 MVP 需要读的 post 相对日上界。
 *
 * `SELECT_MAX_AGE(40) + 1`（下一交易日开盘入场）`+ (HOLDING_DAYS − 1)(= 19) `+ 顺延 10 = **70**。
 * 与 `holding_day = exitDay − entryDay + 1` 的既有口径一致（`panel.ts`）。
 */
export const MAX_POST_RELATIVE_DAY_NEEDED =
  SELECT_MAX_AGE + 1 + (HOLDING_DAYS - 1) + EXIT_DEFERRAL_MAX_TRADING_DAYS;

/** 需要读的 post 相对日（1..70，升序）。 */
export const POST_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: MAX_POST_RELATIVE_DAY_NEEDED },
  (_, index) => index + 1,
);

/** 需要读的 prefix 相对日：`−10/−1`（preReturn10 两端）+ `0`（事件日收盘，maxAmp5 链式前收起点）。 */
export const PREFIX_RELATIVE_DAYS: readonly number[] = [-10, -1, 0];

/** 主研究窗口（决策日）。 */
export const MAIN_WINDOW = Object.freeze({
  startDate: "2024-01-02",
  endDate: "2025-09-30",
});

/** 预检片段（只查池 / 时点 / 计算 / 确定性；**不据预检收益改配置**）。 */
export const PRECHECK_WINDOW = Object.freeze({
  startDate: "2024-01-02",
  endDate: "2024-03-29",
});

// ---------------------------------------------------------------------------
// 二、两固定选择臂 + 控制臂（规格 §3）
// ---------------------------------------------------------------------------

export const ARM_IDS = ["R", "M", "RANDOM"] as const;
export type ArmId = (typeof ARM_IDS)[number];

export const ARM_LABELS: Readonly<Record<ArmId, string>> = Object.freeze({
  R: "R · preReturn10 HIGH（原冻结定义，右尾候选）",
  M: "M · maxAmp5 LOW（既有 Core 定义，近 5 日低振幅参照）",
  RANDOM: "Random · 同日同池均匀无放回（200 固定种子）",
});

/** R 臂：`preReturn10` **高值优先**（右尾方向）。 */
export const R_ARM_DIRECTION = "HIGH" as const;
/** M 臂：`maxAmp5` **低值优先**（Core `higherIsBetter=false`）。 */
export const M_ARM_DIRECTION = "LOW" as const;

/** 随机对照：200 个**固定**种子。 */
export const RANDOM_DRAW_COUNT = 200;
/** 随机种子基址（规格 §S4：本轮固定值起连续序号）。 */
export const RANDOM_SEED_BASE = 20_261_010;

// ---------------------------------------------------------------------------
// 三、成本（研究标签口径，**不是**账户费率/冲击模型）
// ---------------------------------------------------------------------------

export const COST_PRIMARY_ROUND_TRIP_BPS = 20;
export const COST_SENSITIVITY_ROUND_TRIP_BPS = 50;

// ---------------------------------------------------------------------------
// 四、统计（规格 §5.2）
// ---------------------------------------------------------------------------

export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_PRIMARY = 20;
export const BOOTSTRAP_BLOCK_SENSITIVITY = 40;
export const BOOTSTRAP_SEED = 20_261_010;
/**
 * Bonferroni 同时区间：两条**预声明主臂** ⇒ 每臂 **97.5% 双侧 CI**
 * ⇒ 分位点 `0.0125 / 0.9875`。
 */
export const CI_QUANTILES = Object.freeze({ low: 0.0125, high: 0.9875 });
/** 作为对照一并报出的 95% 双侧（既有缺省分位点）。 */
export const CI_QUANTILES_95 = Object.freeze({ low: 0.025, high: 0.975 });

export const PRIMARY_TAIL_THRESHOLD = 0.2;
export const TAIL_THRESHOLDS = [0.2, 0.5, 1.0] as const;
export const LOSS_THRESHOLD = -0.1;
export const MIN_UNIQUE_OPPORTUNITY_SEGMENTS = 50;

/** 收口判定（规格 §5.3）。 */
export const RESEARCH_VERDICTS = [
  "RIGHT_TAIL_EVIDENCE",
  "RISK_TRADEOFF",
  "INSUFFICIENT_EVIDENCE",
  "NO_SUPPORT",
] as const;
export type ResearchVerdict = (typeof RESEARCH_VERDICTS)[number];

// ---------------------------------------------------------------------------
// 五、每日股票级研究面板（规格 §4）
// ---------------------------------------------------------------------------

/**
 * 三态区分（规格 §4.6）：
 * - `inWatchPool`     —— rd1..40，**只用当日已知**（是否为池成员）；
 * - `signalEligible`  —— rd5..40 ∧ 两因子均可评估 ∧ 当日 bar 可用，**只用当日已知**；
 * - `nextOpenExecutable` —— **下一交易日真实执行结果**，`null` = 未评估（仅对选中信号评估）。
 */
export const MEMBER_STATE_FIELDS = ["inWatchPool", "signalEligible", "nextOpenExecutable"] as const;

/** 资格拒绝原因闭集（键 = 机器可读码，值 = 人读说明）。 */
export const REJECTION_REASON_LABELS = {
  AGE_BELOW_SELECT_MIN: "事件年龄 < rd5（仍在观察，不参与本轮选择）",
  MAXAMP5_NOT_AVAILABLE_BEFORE_RD15: "maxAmp5 的决策时点下界 = rd15（Core 冻结口径）",
  MISSING_PREFIX_PATH: "T−1 / T−10 收盘不可得（preReturn10 无法评估）",
  MISSING_MAXAMP5_PATH: "rd0~rd15 链式前收路径不全（maxAmp5 无法评估）",
  EVENT_DAY_BAR_UNUSABLE: "事件日（rd0）bar 缺失或不可用",
  CURRENT_BAR_UNUSABLE: "当日 bar 缺失 / 停牌 / 结构非法",
} as const;
export type RejectionReasonCode = keyof typeof REJECTION_REASON_LABELS;

/** 信号标签结果码（**不删样本**：缺口一律显式登记）。 */
export const SIGNAL_LABEL_LABELS = {
  EXECUTABLE: "下一交易日开盘可买且窗口内可卖",
  NO_FILL: "下一交易日开盘不可买（涨/跌停或停牌）⇒ 记录 NO_FILL，**不递补第 4 名**",
  UNEXITED_MTM: "持续不可卖且超过顺延上限 ⇒ 用上限日收盘 MTM，标记未退出",
  RIGHT_CENSORED: "末端没有完整未来窗（右删失），保留在信号账",
  MISSING_NEXT_BAR: "下一交易日 bar 缺失，无法判定执行性",
} as const;
export type SignalLabelCode = keyof typeof SIGNAL_LABEL_LABELS;

/** 逐日池成员账（一股票一行；`symbol` 当日唯一）。 */
export interface DailyPoolRow {
  readonly date: string;
  readonly symbol: string;
  readonly anchorEventId: string;
  readonly eventAge: number;
  /** 同日同股其它未过期事件（升序、`|` 分隔；无则空串）。 */
  readonly relatedEventIds: string;
  /** 锚点是否相对上一交易日发生了切换。 */
  readonly anchorChanged: boolean;
  readonly inWatchPool: true;
  readonly signalEligible: boolean;
  /** 拒绝原因码（`|` 分隔；无则空串）。 */
  readonly rejectionReasons: string;
  readonly preReturn10: number | null;
  readonly maxAmp5: number | null;
  /** 截至当天的路径状态（规格 §4.4，**仅描述**）。 */
  readonly limitUpCount3: number | null;
  readonly limitUpCount5: number | null;
  readonly consecutiveLimitUp: number | null;
  readonly daysSinceLastLimitUp: number | null;
  /** 连续跌停天数（截至当天；**不用于过滤或删样本**）。 */
  readonly limitDownStreak: number | null;
  /** 当日可买（= 当日 open 是否可成交；截至收盘已知）。 */
  readonly canBuyAtOpenToday: boolean | null;
  /** 当日收盘可卖。 */
  readonly canSellAtCloseToday: boolean | null;
  /** 🔴 下一交易日真实执行结果 —— **不得用于任何排名 / 资格**。 */
  readonly nextOpenExecutable: boolean | null;
  /** 逐日 ST 事实是否可得（本轮为 `UNAVAILABLE`，见 SPEC 缺口）。 */
  readonly dailyStStatus: DailyStStatus;
}

export type DailyStStatus = "UNAVAILABLE";

/** 一条信号的标签（逐臂逐日）。 */
export interface SignalLabelRow {
  readonly date: string;
  readonly arm: ArmId;
  /** Random 臂的第几次抽样；R/M 恒为 -1。 */
  readonly drawIndex: number;
  readonly symbol: string;
  readonly anchorEventId: string;
  readonly eventAge: number;
  readonly labelCode: SignalLabelCode;
  readonly entryDate: string | null;
  readonly entryRelativeDay: number | null;
  readonly exitDate: string | null;
  readonly exitRelativeDay: number | null;
  readonly deferredTradingDays: number | null;
  /** 毛收益（下一开盘入场 → 出场价）。 */
  readonly grossReturn: number | null;
  /** 净收益（20bps 主口径）。 */
  readonly netReturn20bps: number | null;
  /** 净收益（50bps 敏感性）。 */
  readonly netReturn50bps: number | null;
  /** 标签 B（辅助）：未来持有窗内最高价相对入场价的涨幅 —— **不是可实现收益**。 */
  readonly pathMaxReturn: number | null;
  /** 标签 B 达到 +20% 的提前量（交易日，从入场日起算；未达到 = null）。 */
  readonly pathPlus20TradingDay: number | null;
}

/** 逐日逐臂的当日统计（用于配对差序列）。 */
export interface DailyArmStat {
  readonly date: string;
  readonly year: number;
  readonly poolSize: number;
  readonly signalCount: number;
  /** 决策槽位效用：NO_FILL 记 0（现金）；**同时**单独报可成交子集。 */
  readonly meanNetReturn: number | null;
  /** 50bps 敏感性净均值（同一口径）。 */
  readonly meanNetReturn50: number | null;
  readonly medianNetReturn: number | null;
  readonly winRate: number | null;
  readonly loss10Rate: number | null;
  readonly q05: number | null;
  readonly tail20Rate: number | null;
  readonly tail50Rate: number | null;
  readonly tail100Rate: number | null;
  /** 50bps 敏感性下的 ≥+20% 概率。 */
  readonly tail20Rate50: number | null;
  readonly pathTail20Rate: number | null;
  readonly noFillRate: number | null;
}

/** 一个「唯一机会段」：同 symbol 的相邻信号标签窗共享交易日。 */
export interface OpportunitySegment {
  readonly symbol: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly signalDates: readonly string[];
  readonly arms: readonly ArmId[];
  readonly tail20Hit: boolean;
  readonly firstSignalDate: string;
}

/** 事件级资格账。 */
export interface EventAccounting {
  readonly scannedEventCount: number;
  readonly eligibleEventCount: number;
  readonly excludedByReason: Record<string, number>;
  readonly unscannedEventCount: number;
  readonly datasetDeclaredEventCount: number | null;
}
