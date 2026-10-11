/**
 * RIGHT-TAIL-RESEARCH-002 — **Tail Metrics MVP**：契约常量与类型（唯一真源）。
 *
 * ## 这个模块是什么
 *
 * 「无回踩前置条件的首板事件池 → 单因子横截面排序 → `Top3`/`Top5` → 多持有周期右尾指标」
 * 这一整套流程的**冻结口径声明处**。实现在同名兄弟模块里。
 *
 * ## 🔴 本轮冻结的研究口径（**事后不得修改**；改动即视为新研究）
 *
 * ```
 * Dataset          = first_limit_pullback / datasetVersionId = 780003（v9）
 *                    实际评估窗口 = 2019-01-02 ~ 2025-09-26
 *                    listedAgeDays >= 365（构建期已生效，自然日，基准日 = 事件日）
 *                    无 Pullback Gate
 *                    ⚠️ v9 当前 dataset status = FAILED，本轮使用其**已验证的完整窗口物理数据**
 * T                 = 首板日（rd = 0）
 * 决策时点          = T+5 收盘（信息截止；覆盖全部 12 因子的最早时点）
 * 入场              = T+6 开盘（canBuyAtOpen === true，不成交即剔除，不顺延）
 * 持有              = D1-a：持有 N 个交易日 ⇒ 退出 = close(T+6+N−1)
 * 退出顺延          = 主退出日不可卖 ⇒ 顺延到其后第一个可卖收盘，**最多 +10 个交易日**，且 ≤ rd80
 * 成本              = 往返 20 bps
 * 排序              = 因子**原始值**；HIGH / LOW 两方向都跑
 * 档位              = Top3 / Top5 / All / Bottom3 / Random3
 * 破平键            = ASC / DESC / RAND（固定种子）——**三键都必须报**
 * 尾阈值            = ≥+20%（辅助）/ ≥+50%（主）/ ≥+100%（主）
 * 横截面            = 每个决策日（首板日 T）独立排名
 * 年度切片          = 必须做**年内 rank/percentile 归一化**后再合并
 * ```
 */

// ---------------------------------------------------------------------------
// 一、Dataset 与窗口（冻结）
// ---------------------------------------------------------------------------

export const RIGHT_TAIL_DATASET_CODE = "first_limit_pullback";
export const RIGHT_TAIL_DATASET_VERSION_ID = 780_003;

export const RIGHT_TAIL_EVALUATION_WINDOW = {
  startDate: "2019-01-02",
  endDate: "2025-09-26",
} as const;

/** 构建期已生效的上市龄过滤（自然日，基准日 = 事件日）。 */
export const RIGHT_TAIL_LISTING_AGE_FILTER_DAYS = 365;
export const RIGHT_TAIL_REQUIRE_PULLBACK_GATE = false as const;
/** v9 的 `dataset_version.status`（如实登记；本轮**不修改**它）。 */
export const RIGHT_TAIL_DATASET_STATUS_NOTE = "FAILED（数据可用，未改状态）" as const;

// ---------------------------------------------------------------------------
// 二、因子（F1–F12 冻结定义零改动）
// ---------------------------------------------------------------------------

/** 12 个冻结因子 code（与 `FROZEN-BUCKET-CONTRACT-001` 逐字一致）。 */
export const RIGHT_TAIL_ALL_FACTOR_CODES = [
  "bodyHeight",
  "turnover",
  "amountPercentile",
  "meanAmplitude",
  "maxAmplitude",
  "holdStreak",
  "t1VolumeRatio",
  "limitGap",
  "preReturn10",
  "drawdownDepth",
  "t1OpenGap",
  "historyLimitCount",
] as const;
export type RightTailFactorCode = (typeof RIGHT_TAIL_ALL_FACTOR_CODES)[number];

/**
 * 🔴 **允许进入 `Top-K` 判定的 11 个因子。**
 *
 * `holdStreak` 被排除：P3 实测 `TIE_BREAK_DOMINATED`
 * （每日 distinct 中位数 3、单值最大占比中位数 83.3%、边界并列 ≥K 日占比 73%、
 *  换破平键成员 Jaccard 0.515–0.670）⇒ 其 `Top-K` 结果**不得**用于结论。
 * 它仍可进 `Rank IC`（用全序，不依赖破平键）作为**描述性**结果。
 */
export const RIGHT_TAIL_TOP_K_FACTOR_CODES = RIGHT_TAIL_ALL_FACTOR_CODES.filter(
  (code) => code !== "holdStreak"
);

/** P3 判定为 `TIE_BREAK_DOMINATED`、禁止进入 `Top-K` 的因子。 */
export const RIGHT_TAIL_TOP_K_EXCLUDED_FACTOR_CODES = ["holdStreak"] as const;

/** 累计量因子：年度切片**必须**年内归一化（否则会复现年份漂移假信号）。 */
export const RIGHT_TAIL_YEAR_NORMALIZED_FACTOR_CODES = [
  "historyLimitCount",
] as const;

// ---------------------------------------------------------------------------
// 三、档位 / 方向 / 破平键
// ---------------------------------------------------------------------------

export const RIGHT_TAIL_RANKING_DIRECTIONS = ["HIGH", "LOW"] as const;
export type RightTailRankingDirection =
  (typeof RIGHT_TAIL_RANKING_DIRECTIONS)[number];

export const RIGHT_TAIL_TOP_K_SIZES = [3, 5] as const;
export type RightTailTopKSize = (typeof RIGHT_TAIL_TOP_K_SIZES)[number];

export const RIGHT_TAIL_SELECTION_KINDS = [
  "Top3",
  "Top5",
  "All",
  "Bottom3",
  "Random3",
] as const;
export type RightTailSelectionKind = (typeof RIGHT_TAIL_SELECTION_KINDS)[number];

/**
 * 破平键。**三键都必须输出**（P3 已证单一 `eventId` 键会与 `symbol` 键等价而失效）。
 *
 * - `ASC`  = 同值时按 `eventId` 升序（= 现行 `shared/singleFactor/ranker.ts` 的行为）
 * - `DESC` = 同值时按 `eventId` 降序
 * - `RAND` = 同值时按固定种子伪随机序
 */
export const RIGHT_TAIL_TIE_BREAK_KEYS = ["ASC", "DESC", "RAND"] as const;
export type RightTailTieBreakKey = (typeof RIGHT_TAIL_TIE_BREAK_KEYS)[number];

/** 破平键固定种子（明文，可复现）。 */
export const RIGHT_TAIL_TIE_BREAK_SEED = 20_261_008;
/** `Random3` 档的模拟次数。 */
export const RIGHT_TAIL_RANDOM3_DRAWS = 1_000;
/** 随机 K 子集置换检验的次数（每年每 (K, 期限) 一次，与因子无关）。 */
export const RIGHT_TAIL_PERMUTATION_ITERATIONS = 1_000;

// ---------------------------------------------------------------------------
// 四、持有周期（D1-a）与右尾阈值
// ---------------------------------------------------------------------------

export interface RightTailHorizon {
  /** 持有交易日数 `N`。 */
  readonly holdingDays: number;
  /** 主退出相对日（`T+6+N−1`）。 */
  readonly primaryExitRelativeDay: number;
  /** 顺延搜索上界（`primary + 10`，并被数据视界 rd80 夹取）。 */
  readonly lastExitRelativeDay: number;
  readonly label: string;
  /** 该期限上 `≥+100%` 的可测性判定（冻结，事前写死）。 */
  readonly measurabilityOf100: "MEASURABLE" | "INSUFFICIENT" | "NOT_MEASURABLE_BY_CONSTRUCTION";
  /** 不可测/样本不足的原因（仅当 `measurabilityOf100 !== "MEASURABLE"`）。 */
  readonly note?: string;
}

/**
 * 四个持有周期。`T+5` 与 `T+10` 的 `≥+100%` 判定为**事前冻结**：
 * - `T+5 × ≥+100%`：主板 ±10% ⇒ 5 日理论上限 61.05% ⇒ **构造上不可能**
 * - `T+10 × ≥+100%`：理论上限 159.37%，但 P3 实测池基线仅 0.058%（≈32 例）⇒ **样本不足**
 */
export const RIGHT_TAIL_HORIZONS: readonly RightTailHorizon[] = [
  {
    holdingDays: 5,
    primaryExitRelativeDay: 10,
    lastExitRelativeDay: 20,
    label: "T+5",
    measurabilityOf100: "NOT_MEASURABLE_BY_CONSTRUCTION",
    note: "主板 ±10%，5 个交易日理论上限 1.1^5−1 = 61.05% ⇒ 不可能达到 +100%（P3 实测池基线 0.000%）",
  },
  {
    holdingDays: 10,
    primaryExitRelativeDay: 15,
    lastExitRelativeDay: 25,
    label: "T+10",
    measurabilityOf100: "INSUFFICIENT",
    note: "理论上限 159.37%，但 P3 实测池基线仅 0.058%（≈32 例）< ABORT-10 阈值 30 的边界",
  },
  {
    holdingDays: 20,
    primaryExitRelativeDay: 25,
    lastExitRelativeDay: 35,
    label: "T+20",
    measurabilityOf100: "MEASURABLE",
  },
  {
    holdingDays: 60,
    primaryExitRelativeDay: 65,
    lastExitRelativeDay: 75,
    label: "T+60",
    measurabilityOf100: "MEASURABLE",
  },
] as const;

/** 右尾阈值（百分点）。`≥+20%` 为辅助输出。 */
export const RIGHT_TAIL_THRESHOLDS_PCT = [20, 50, 100] as const;
export type RightTailThresholdPct = (typeof RIGHT_TAIL_THRESHOLDS_PCT)[number];

/** 主判据阈值（`≥+50%` / `≥+100%`）。 */
export const RIGHT_TAIL_PRIMARY_THRESHOLDS_PCT = [50, 100] as const;
/** 辅助阈值。 */
export const RIGHT_TAIL_AUXILIARY_THRESHOLDS_PCT = [20] as const;

// ---------------------------------------------------------------------------
// 五、统计门槛（冻结）
// ---------------------------------------------------------------------------

/** 往返成本（比例）。 */
export const RIGHT_TAIL_ROUND_TRIP_COST = 0.002;
/** 单笔往返成本（bps）。 */
export const RIGHT_TAIL_ROUND_TRIP_COST_BPS = 20;
/** 判定所需最少决策日数。 */
export const RIGHT_TAIL_MIN_DECISION_DAYS = 100;
/** 某 `(期限, 阈值)` 格子内尾事件数少于此值 ⇒ `INSUFFICIENT`（ABORT-10）。 */
export const RIGHT_TAIL_MIN_TAIL_EVENT_COUNT = 30;
/** 日期聚类 Moving-Block Bootstrap 参数（与既有实现一致）。 */
export const RIGHT_TAIL_BOOTSTRAP_ITERATIONS = 1_000;
export const RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS = 20;
export const RIGHT_TAIL_BOOTSTRAP_SEED = 20_261_008;

// ---------------------------------------------------------------------------
// 六、行/样本类型（与平台 `ExperimentEventRow` / `ExperimentBarRow` 结构兼容）
// ---------------------------------------------------------------------------

export type CellValue = number | boolean | string | null;

export interface RightTailEventRow {
  readonly eventId: string;
  readonly symbol: string;
  readonly tradeDate: string;
  readonly values: Readonly<Record<string, CellValue>>;
}

export interface RightTailBarRow {
  readonly eventId: string;
  readonly symbol: string;
  readonly tradeDate: string;
  readonly relativeDay: number;
  readonly values: Readonly<Record<string, CellValue>>;
}

/**
 * 取数端口（与 `ExperimentDatasetAccess` 的 `events` / `feature` / `observation` 同形）。
 *
 * 平台运行时直接传 `context.dataset`；只读数值核对走 DB 适配器。
 * 🔴 本模块**不含任何 IO**，端口由调用方注入。
 */
export interface RightTailDatasetAccess {
  events(): Promise<readonly RightTailEventRow[]>;
  feature(relativeDay: number): Promise<readonly RightTailBarRow[]>;
  observation(relativeDay: number): Promise<readonly RightTailBarRow[]>;
}

/** 一个入池样本。 */
export interface RightTailSample {
  readonly eventId: string;
  readonly symbol: string;
  /** 首板日 `T`（= 决策日，= 横截面分组键）。 */
  readonly decisionDate: string;
  readonly year: number;
  /** 入场价 = `open(T+6)`。 */
  readonly entryOpen: number;
  /** 12 个冻结因子原始值（`limitGap` 的 `null` = 无前次涨停，不是插补）。 */
  readonly factorValue: Readonly<Record<RightTailFactorCode, number | null>>;
}

/** 逐 `(样本, 期限)` 的净收益。 */
export interface RightTailOutcome {
  readonly eventId: string;
  readonly holdingDays: number;
  readonly exitRelativeDay: number;
  /** 真实退出交易日。 */
  readonly exitDate: string;
  readonly exitPrice: number;
  readonly grossReturn: number;
  readonly netReturn: number;
  /** 是否使用了顺延（`exitRelativeDay !== primaryExitRelativeDay`）。 */
  readonly deferred: boolean;
}

/** 缺失码（**单独记录，不插补**）。 */
export const RIGHT_TAIL_MISSING_CODES = {
  FACTOR_VALUE_MISSING: "FACTOR_VALUE_MISSING",
} as const;

export function limitGapMissingCode(): string {
  return `${RIGHT_TAIL_MISSING_CODES.FACTOR_VALUE_MISSING}:limitGap`;
}

// ---------------------------------------------------------------------------
// 七、`RIGHT-TAIL-ENTRY-TIMING-001`：入场时点 × 固定持有长度（冻结）
// ---------------------------------------------------------------------------

/**
 * 入场时点（相对首板日 `T` 的开盘）。
 *
 * 🔴 决策时点恒为 `T+5` 收盘（与 RIGHT-TAIL-RESEARCH-002 一致）；本维度**只推迟入场**。
 */
export const RIGHT_TAIL_ENTRY_RELATIVE_DAYS = [6, 7, 8, 10] as const;
export type RightTailEntryRelativeDay = (typeof RIGHT_TAIL_ENTRY_RELATIVE_DAYS)[number];
export const RIGHT_TAIL_ENTRY_TIMING_LABELS: Readonly<Record<number, string>> = Object.freeze({
  6: "T+6",
  7: "T+7",
  8: "T+8",
  10: "T+10",
});

/**
 * 固定持有长度（交易日）。
 *
 * 🔴 定义（本实验冻结）：`Entry = 入场日 Open`，`Exit = Entry 后第 N 个交易日 Close`
 * ⇒ `exitRelativeDay = entryRelativeDay + N`。
 *
 * ⚠️ 与 RIGHT-TAIL-RESEARCH-002 的 `D1-a`（`exit = entry + N − 1`）**相差一个相对日** ——
 * 本实验内部四个入场时点使用**同一持有规则**，故跨入场时点比较自洽；跨实验比较需注意此偏移。
 */
export const RIGHT_TAIL_HOLDING_PERIODS = [5, 10, 20, 60] as const;
export type RightTailHoldingPeriod = (typeof RIGHT_TAIL_HOLDING_PERIODS)[number];

/** 退出顺延上限（交易日）：主退出日之后最多 +10 日（沿用既有规则）。 */
export const RIGHT_TAIL_DEFERRAL_MAX_DAYS = 10;
/** 数据视界上界（v9 `postWindowDays = 80`）。 */
export const RIGHT_TAIL_MAX_RELATIVE_DAY = 80;

/**
 * 🔴 **RIGHT-TAIL-RESEARCH-002 已确认有效的 8 个右尾因子及其方向**。
 *
 * 方向来源：`docs/research/RESULT-RIGHT-TAIL-METRICS-MVP-001.md` §0.1 / §5
 * （按 `Top3` 尾识别 `Lift` 最大者；`F7`/`F8` 为 `LOW`，其余为 `HIGH`）。
 * **禁止在本实验重新选择方向**（任务书 §3）。
 */
export const RIGHT_TAIL_EFFECTIVE_FACTORS: readonly {
  readonly code: RightTailFactorCode;
  readonly direction: RightTailRankingDirection;
}[] = [
  { code: "bodyHeight", direction: "HIGH" },
  { code: "turnover", direction: "HIGH" },
  { code: "meanAmplitude", direction: "HIGH" },
  { code: "maxAmplitude", direction: "HIGH" },
  { code: "t1VolumeRatio", direction: "LOW" },
  { code: "limitGap", direction: "LOW" },
  { code: "preReturn10", direction: "HIGH" },
  { code: "drawdownDepth", direction: "HIGH" },
];

/** 本实验的入场时点 × 持有长度所需的退出相对日窗口（`[primary, primary + 10]` 的并集）。 */
export function rightTailEntryExitRanges(
  /** 退出相对日偏移（见 `deriveEntryTimingOutcomes` 的 `exitOffsetDays`）。 */
  exitOffsetDays = 0
): readonly (readonly [number, number])[] {
  const ranges: [number, number][] = [];
  for (const entry of RIGHT_TAIL_ENTRY_RELATIVE_DAYS) {
    for (const holding of RIGHT_TAIL_HOLDING_PERIODS) {
      const primary = entry + holding + exitOffsetDays;
      ranges.push([primary, Math.min(primary + RIGHT_TAIL_DEFERRAL_MAX_DAYS, RIGHT_TAIL_MAX_RELATIVE_DAY)]);
    }
  }
  return ranges;
}

/** 把若干区间合并为互不重叠的升序区间（供批量取数使用）。 */
export function rightTailMergeRanges(
  ranges: readonly (readonly [number, number])[]
): readonly (readonly [number, number])[] {
  const sorted = [...ranges].map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}
