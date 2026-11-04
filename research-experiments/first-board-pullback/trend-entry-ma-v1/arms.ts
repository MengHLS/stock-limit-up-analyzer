/**
 * 趋势入场（MA5/10/20/60）· **预注册臂（冻结配置）**。
 *
 * 用户裁定（2026-10-07）：
 *   - 条件词表**恰好四类**（PRICE_VS_MA / MA_ORDER / MA_SLOPE / RETURN_OVER）—— 不再增删；
 *   - 入场**不钉死固定日**，由「观察窗内首个满足全部条件的交易日」决定；
 *   - 收益**不钉死固定日期**，按「实际入场 → 实际退出」计算；
 *   - 「先暂时写死成配置」⇒ 本文件就是那 3 条臂的**唯一权威**，运行前不得改成员/阈值。
 *
 * 🔴 纪律：这是**预注册**配置，不是参数搜索的起点。若后续要改任一条件/阈值/窗口，
 *    必须**新开臂 id** 并单独登记（原地改 = 换定义，旧结论作废）。
 */
import type { TrendEntryConfig, TrendExitConfig } from "../../shared/firstBoardPullback/trendEntry";

/**
 * 需要物化的前置相对日 = −59..0。
 *
 * MA60 在 rd 处需要 60 根收盘（rd−59..rd）；观察窗到 rd 20 ⇒ 最迟需要 rd−59 ⇒ 前置 59 根。
 * 必须与数据集的 `preWindowDays ≥ 60` 一致（v9 = 60）。
 */
export const TREND_ENTRY_PREFIX_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: 60 },
  (_, index) => index - 59,
);

/** 需要物化的后置相对日 = 1..80（退出窗口上限，与数据集 postWindowDays=80 一致）。 */
export const TREND_ENTRY_POST_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: 80 },
  (_, index) => index + 1,
);

/** 退出判定可用的最大相对日（＝数据集 postWindowDays）。 */
export const TREND_ENTRY_MAX_RELATIVE_DAY = 80;

/** 观察窗：首板日之后 rd 1..20（与 v8/v9 的后窗口径一致；不做参数搜索）。 */
export const TREND_ENTRY_WINDOW = { fromRd: 1, toRd: 20 } as const;

/**
 * 统一退出（三条臂共用，**不作为自变量**）：
 *   - MIXED = 「持有期满 20 日」与「收盘跌破 MA10」取先到；
 *   - 盘中止损 −6%（按止损价成交，不假设更好）；
 *   - 条件命中默认次一交易日开盘成交（不可卖则继续持有）。
 */
export const TREND_ENTRY_EXIT: TrendExitConfig = Object.freeze({
  mode: "MIXED",
  horizonDays: 20,
  conditions: [{ kind: "PRICE_VS_MA", ma: 10, op: "LT" }],
  stopRatio: 0.06,
  exitAt: "NEXT_OPEN",
}) as TrendExitConfig;

export interface TrendEntryArm {
  readonly id: string;
  readonly label: string;
  /** 该臂的完整口径（运行前冻结）。 */
  readonly entry: TrendEntryConfig;
  readonly exit: TrendExitConfig;
}

/** 共享的入场执行语义（非自变量）。 */
const ENTRY_SHELL = {
  window: TREND_ENTRY_WINDOW,
  execution: "NEXT_OPEN",
  onNoTrigger: "SKIP",
} as const;

/**
 * 三条预注册臂（**写死，不做搜索**）。
 *
 * A1 多头排列：MA5>MA10 ∧ MA10>MA20 ∧ MA20>MA60 ∧ close>MA5
 * A2 回踩转强：close>MA10 ∧ close>MA5 ∧ MA20 五日斜率为正
 * A3 站上长均线：close>MA60 ∧ MA5>MA10
 */
export const TREND_ENTRY_ARMS: readonly TrendEntryArm[] = [
  {
    id: "a1-bull-stack",
    label: "A1 · 多头排列（MA5>MA10>MA20>MA60 且 close>MA5）",
    entry: {
      ...ENTRY_SHELL,
      trigger: {
        all: [
          { kind: "MA_ORDER", fast: 5, slow: 10, op: "GT" },
          { kind: "MA_ORDER", fast: 10, slow: 20, op: "GT" },
          { kind: "MA_ORDER", fast: 20, slow: 60, op: "GT" },
          { kind: "PRICE_VS_MA", ma: 5, op: "GT" },
        ],
        any: [],
      },
    },
    exit: TREND_ENTRY_EXIT,
  },
  {
    id: "a2-pullback-reclaim",
    label: "A2 · 回踩转强（close>MA10 ∧ close>MA5 ∧ MA20 五日斜率为正）",
    entry: {
      ...ENTRY_SHELL,
      trigger: {
        all: [
          { kind: "PRICE_VS_MA", ma: 10, op: "GT" },
          { kind: "PRICE_VS_MA", ma: 5, op: "GT" },
          { kind: "MA_SLOPE", ma: 20, lookback: 5, op: "GT", pct: 0 },
        ],
        any: [],
      },
    },
    exit: TREND_ENTRY_EXIT,
  },
  {
    id: "a3-above-ma60",
    label: "A3 · 站上长均线（close>MA60 ∧ MA5>MA10）",
    entry: {
      ...ENTRY_SHELL,
      trigger: {
        all: [
          { kind: "PRICE_VS_MA", ma: 60, op: "GT" },
          { kind: "MA_ORDER", fast: 5, slow: 10, op: "GT" },
        ],
        any: [],
      },
    },
    exit: TREND_ENTRY_EXIT,
  },
];

/** 四类条件的白名单（运行前自检用；出现第五类即视为配置越界）。 */
export const TREND_CONDITION_KINDS = [
  "PRICE_VS_MA",
  "MA_ORDER",
  "MA_SLOPE",
  "RETURN_OVER",
] as const;
