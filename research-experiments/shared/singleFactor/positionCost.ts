/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Position / Cost Engine**（通用基础之三）。
 *
 * ## Position
 *
 * 只有一种：**全仓等权**（`POSITION_MODEL = EQUAL_WEIGHT`）。
 * 每个决策日拿出 1 单位资金，在当日选中的 N 只上各放 `1/N`；
 * 组合的当日收益 = 选中样本净收益的**等权平均**。
 * ⇒ 「组合收益」与「逐笔均值」在等权口径下是同一个量，不会出现两套说法。
 *
 * ## Cost
 *
 * 复用公共成本模型（`shared/firstBoardPullback/cost.ts` 的 `resolveFoundationCost`
 * 与 `DEFAULT_FOUNDATION_COST`），往返口径：
 *
 * ```
 * 买入：佣金 2.5 + 滑点 2.5 + 冲击 2.5            =  7.5 bps
 * 卖出：佣金 2.5 + 滑点 2.5 + 冲击 2.5 + 印花税 5 = 12.5 bps
 * 往返合计                                        = 20.0 bps
 * ```
 *
 * 🔴 这个 20.0 bps **恰好等于** `FROZEN-BUCKET-CONTRACT-001` 冻结的
 *    `ROUND_TRIP_COST_BPS`（由 `coordinate.ts` 的 `assertTemplateCoordinate()` 断言）。
 *    因此单因子实验的 `netReturn` 与 12F / Top-N 的 `netReturn` **逐位相同**。
 *
 * ⚠️ 记账方式：`netReturn = grossReturn − cost`（**比例直接相减**），
 *    与公共底座 `derive.ts` 的写法逐字一致。
 *    另一条等价近似是「先乘买卖调整价再相除」（`cost.ts#netReturn`），
 *    两者相差约 `2e-6 × (1+r)`；本模板**只用前者**，以免与 12F 的数字出现尾数差。
 */

import {
  DEFAULT_FOUNDATION_COST,
  type FoundationCostConfig,
} from "../firstBoardPullback/types";
import { resolveFoundationCost } from "../firstBoardPullback/cost";
import {
  FOUNDATION_ROUND_TRIP_COST_BPS,
  ROUND_TRIP_COST_BPS,
  SLIPPAGE_BPS_PER_SIDE,
} from "./coordinate";
import { POSITION_MODEL, POSITION_MODEL_LABEL } from "./types";

/** 本次运行实际生效的成本模型（哨兵值归并后的完整配置）。 */
export function resolveTemplateCost(
  input?: Partial<FoundationCostConfig>
): FoundationCostConfig {
  return resolveFoundationCost(input ?? DEFAULT_FOUNDATION_COST);
}

export interface CostModelRecord {
  roundTripCostBps: number;
  foundationRoundTripCostBps: number;
  slippageBpsPerSide: number;
  commissionBpsPerSide: number;
  impactBpsPerSide: number;
  stampDutyBps: number;
  accounting: string;
}

export function costModelRecordOf(
  input?: Partial<FoundationCostConfig>
): CostModelRecord {
  const cost = resolveTemplateCost(input);
  return {
    roundTripCostBps: ROUND_TRIP_COST_BPS,
    foundationRoundTripCostBps: FOUNDATION_ROUND_TRIP_COST_BPS,
    slippageBpsPerSide: SLIPPAGE_BPS_PER_SIDE,
    commissionBpsPerSide: cost.commissionBpsPerSide,
    impactBpsPerSide: cost.impactBpsPerSide,
    stampDutyBps: cost.stampDutyBps,
    accounting: "netReturn = grossReturn − 20bps（比例直接相减，与公共底座逐字一致）",
  };
}

/** 单笔往返成本（比例）。 */
export function roundTripCostRatio(): number {
  return ROUND_TRIP_COST_BPS / 10_000;
}

export interface PositionModelRecord {
  model: typeof POSITION_MODEL;
  label: string;
  disclosure: string;
}

export const POSITION_MODEL_RECORD: PositionModelRecord = {
  model: POSITION_MODEL,
  label: POSITION_MODEL_LABEL,
  disclosure:
    "每个决策日投入 1 单位资金、在当日 Top-N 上等权分配；不做资金管理、不做仓位缩放、" +
    "不设持仓上限。因此「组合收益」是策略层面的口径，不等于任何实盘资金曲线。",
};

/** 等权平均（**唯一**的组合聚合函数）。空集返回 `null`（禁 0 兜底）。 */
export function equalWeightMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export interface PortfolioDayReturn {
  gross: number | null;
  net: number | null;
}

/** 当日组合（等权）的毛/净收益。 */
export function portfolioDayReturnOf(
  members: readonly { grossReturn: number; netReturn: number }[]
): PortfolioDayReturn {
  return {
    gross: equalWeightMean(members.map(member => member.grossReturn)),
    net: equalWeightMean(members.map(member => member.netReturn)),
  };
}

/**
 * 逐笔成本自查：`gross − cost === net`（容差 1e-12）。
 *
 * 🔴 这是**恒等式不是近似**：公共底座的 `netReturn` 就是 `exitPrice/entryOpen − 1 − 0.002`
 *    按同一顺序算出来的。若这条不成立，说明成本口径被人改过。
 */
export function assertTradeCostReconciles(trade: {
  eventId: string;
  grossReturn: number;
  cost: number;
  netReturn: number;
}): void {
  const delta = trade.grossReturn - trade.cost - trade.netReturn;
  if (Math.abs(delta) > 1e-12) {
    throw new Error(
      `逐笔成本恒等式不成立：事件 ${trade.eventId} gross=${trade.grossReturn} ` +
        `cost=${trade.cost} net=${trade.netReturn}（差值 ${delta}）`
    );
  }
}
