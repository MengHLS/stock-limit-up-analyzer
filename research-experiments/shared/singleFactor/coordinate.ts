/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **冻结坐标的唯一引入点**。
 *
 * ## 为什么单独一个文件
 *
 * 模板要求「所有因子使用完全相同的 Entry / Exit / Position / Cost 规则」。
 * 这条要求的兑现方式**不是**在本目录里再抄一份 `ENTRY_DAY = 6`，
 * 而是把 `FROZEN-BUCKET-CONTRACT-001` 已经冻结的那套坐标**原样引入**：
 *
 * | 坐标 | 值 | 唯一实现 |
 * | --- | --- | --- |
 * | 入场 | `T+6` 开盘 | `twelve-factor-composite-study/derive.ts` |
 * | 主退出 | `T+10` 收盘 | 同上（不可卖则顺延，≤ `T+20`） |
 * | 成本 | 往返 20 bps | 同上（`ROUND_TRIP_COST_BPS`） |
 *
 * ⇒ 单因子实验结果与 12F / Top-N 两个实验**逐笔可比**（同一份样本、同一坐标、同一成本）。
 *
 * ## 不变量由函数断言，而不是 import 期抛错
 *
 * `assertTemplateCoordinate()` 在 `run()` 开头调用。做成函数而不是模块顶层 `throw`，
 * 是为了让「引入本模块」永远安全（顶层抛错会让整个 bundle / 测试收集期崩掉，
 * 而不是在真正用到的时候给出一条可读的错误）。
 */

import {
  BUCKET_CONTRACT_ID,
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  MAX_RELATIVE_DAY,
  PRIMARY_HOLDING_DAY,
  ROUND_TRIP_COST_BPS,
} from "../../first-board-pullback/twelve-factor-composite-study/result";
import { DEFAULT_FOUNDATION_COST } from "../firstBoardPullback/types";
import { PIT_INFORMATION_CUTOFF_RELATIVE_DAY } from "./types";

export {
  BUCKET_CONTRACT_ID,
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  MAX_RELATIVE_DAY,
  PRIMARY_HOLDING_DAY,
  ROUND_TRIP_COST_BPS,
};

/** 退出候选相对日（`T+10` .. `T+20`）：主退出不可卖时的顺延搜索范围。 */
export const EXIT_CANDIDATE_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: MAX_RELATIVE_DAY - EXIT_RELATIVE_DAY + 1 },
  (_, index) => EXIT_RELATIVE_DAY + index
);

/** 公共成本模型给出的**往返**成本（bps）= 2×单边(佣金+滑点+冲击) + 印花税。 */
export const FOUNDATION_ROUND_TRIP_COST_BPS =
  2 *
    (DEFAULT_FOUNDATION_COST.commissionBpsPerSide +
      DEFAULT_FOUNDATION_COST.slippageBpsPerSide +
      DEFAULT_FOUNDATION_COST.impactBpsPerSide) +
  DEFAULT_FOUNDATION_COST.stampDutyBps;

/** 单边滑点（bps）——逐笔留档里的 `slippage` 口径。 */
export const SLIPPAGE_BPS_PER_SIDE = DEFAULT_FOUNDATION_COST.slippageBpsPerSide;

/**
 * 入场策略（统一入场条件，唯一一条）。
 *
 * 🔴 「观察窗内首次满足统一入场条件」的准确含义：
 *   观察窗 `T+1..T+5` 是**取信息**的窗口，决策在 `T+5` 收盘做，
 *   因此最早的合法成交点是 **`T+6` 开盘** —— 不存在「窗口内买入」这回事
 *   （那会用到当天收盘才能知道的信息）。
 */
export const UNIFIED_ENTRY_POLICY = {
  relativeDay: ENTRY_DAY,
  priceField: "open",
  /** 唯一入场条件：该日开盘可买。 */
  condition: "canBuyAtOpen === true",
  onUnfilled: "剔除该事件（记 ENTRY_UNFILLABLE），不顺延、不换价",
} as const;

/** 退出策略（统一退出条件，唯一一条）。 */
export const UNIFIED_EXIT_POLICY = {
  primaryRelativeDay: EXIT_RELATIVE_DAY,
  priceField: "close",
  condition: "canSellAtClose === true",
  deferred:
    `主退出日不可卖 ⇒ 从 T+${EXIT_RELATIVE_DAY + 1} 起顺延到第一个可卖日的收盘，` +
    `最多到 T+${MAX_RELATIVE_DAY}`,
  onUnfilled: "剔除该事件（记 NO_EXECUTABLE_EXIT）",
} as const;

/**
 * 模板坐标不变量。
 *
 * 三条都必须成立，任一条不成立说明「冻结契约被改过」或「模板与 12F 已经漂移」——
 * 这时**必须响亮失败**，而不是带着两套坐标继续算（那会产出一份与他人不可比的结果）。
 */
export function assertTemplateCoordinate(): void {
  const problems: string[] = [];
  if (ENTRY_DAY !== PIT_INFORMATION_CUTOFF_RELATIVE_DAY + 1) {
    problems.push(
      `入场必须紧接信息截止日：ENTRY_DAY=${ENTRY_DAY}，信息截止=T+${PIT_INFORMATION_CUTOFF_RELATIVE_DAY}`
    );
  }
  if (EXIT_RELATIVE_DAY !== ENTRY_DAY + PRIMARY_HOLDING_DAY - 1) {
    problems.push(
      `主退出日必须由持有日推出：EXIT=${EXIT_RELATIVE_DAY} ≠ ENTRY(${ENTRY_DAY}) + HOLDING(${PRIMARY_HOLDING_DAY}) - 1`
    );
  }
  if (FOUNDATION_ROUND_TRIP_COST_BPS !== ROUND_TRIP_COST_BPS) {
    problems.push(
      `公共成本模型往返 ${FOUNDATION_ROUND_TRIP_COST_BPS} bps ≠ 冻结往返成本 ${ROUND_TRIP_COST_BPS} bps` +
        "（成本口径一旦不一致，本模板与 12F 的数字就不可比）"
    );
  }
  if (problems.length > 0) {
    throw new Error(`SINGLE_FACTOR 模板坐标不变量被破坏：\n- ${problems.join("\n- ")}`);
  }
}
