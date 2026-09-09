/**
 * STEP 14 / C-14.1 — 交易模拟核心：候选意图 → 买/卖计划（纯函数）。
 *
 * 语义（hold-while-selected 长仓进出场，A 股 longOnly）：
 *   - desired = 当日意图中 direction == "long" 的候选（rank 升序 + securityId 破平）；
 *   - 退出：当前持仓中不在 desired 的证券 → 卖出**全部可卖份额**（整手），
 *     可卖为 0（当日买入仍冻结，T+1）→ 顺延（FROZEN_EXIT_DEFERRED），不静默；
 *   - 进入：desired 中当前未持仓的候选 → 按意图权重在「决策日收盘可用现金」上
 *     分配预算 → 买入股数（整手、含佣金估算，保证不超预算）；
 *     并发持仓达上限 → MAX_POSITIONS_REACHED；预算不足一手 → BUDGET_BELOW_MIN_LOT；
 *   - 决策日无候选意图 → 视为信息不足，持仓不变（不强制清仓）；
 *   - 窗口最后交易日无下一交易日 → 全部意图 NO_NEXT_TRADING_DAY。
 *
 * 铁律：纯函数、确定性、无副作用；不触碰 Portfolio / 不读取日期之后数据；
 * 缺 price（决策日收盘价）即抛错，绝不静默填空。
 */

import type { CostModel } from "../../engine/domain";
import type { PositionIntent } from "../framework/contract";
import type { Side } from "../../backtest/types";
import type {
  DirectionPolicy,
  PlanSkipCode,
  SkippedIntentEntry,
} from "./types";

/** 计划买入意图（待转订单）。 */
export interface PlannedBuy {
  readonly kind: "buy";
  readonly securityId: string;
  /** 目标股数（整手，正数）。 */
  readonly quantity: number;
  /** 该候选在当日候选中的权重（预算分配依据，>0）。 */
  readonly weight: number;
  /** 决策日成交额（千元），成交时点前已知，供滑点分层；可为 null。 */
  readonly referenceAmount: number | null;
}

/** 计划卖出意图（待转订单）。 */
export interface PlannedSell {
  readonly kind: "sell";
  readonly securityId: string;
  /** 目标股数 = 决策日收盘时点可卖份额。 */
  readonly quantity: number;
}

export type PlannedOrder = PlannedBuy | PlannedSell;

/** 单决策日计划结果。 */
export interface DecisionPlan {
  /** 待下单意图（sell 在前、buy 在后，确定性顺序）。 */
  readonly orders: readonly PlannedOrder[];
  /** 被跳过的意图（含原因），保证不静默。 */
  readonly skipped: readonly SkippedIntentEntry[];
}

/** 计划层输入（全部由引擎在决策日收盘时点装配，纯数据）。 */
export interface PlanDecisionInput {
  readonly decisionDate: string;
  /** 当日候选意图（C-13.2 产出，顺序即候选 rank 升序）。 */
  readonly intents: readonly PositionIntent[];
  /** 当前持仓 securityId（引擎负责确定性排序）。 */
  readonly holdings: readonly string[];
  /** securityId → 决策日收盘可卖股数。 */
  readonly availableBySecurity: ReadonlyMap<string, number>;
  /** 决策日收盘现金。 */
  readonly cash: number;
  /** 并发持仓上限；null = 不限。 */
  readonly maxPositions: number | null;
  /** 决策日是否仍有下一交易日（可执行日）。 */
  readonly hasNextTradingDay: boolean;
  /** 决策日收盘价（securityId → 元）；缺失=数据缺失。 */
  readonly closePriceBySecurity: ReadonlyMap<string, number>;
  /** 决策日成交额（securityId → 千元），滑点分层用。 */
  readonly amountBySecurity: ReadonlyMap<string, number | null>;
  readonly cost: CostModel;
  readonly directionPolicy: DirectionPolicy;
}

function commissionFor(gross: number, cost: CostModel): number {
  return Math.max(cost.minCommission, gross * cost.commissionRate);
}

/** 在预算内取最大整手数量（含佣金估算，对齐 Portfolio.buy 现金约束口径）。 */
function maxLotsWithinBudget(
  budget: number,
  price: number,
  cost: CostModel
): number {
  const lotSize = cost.lotSize > 0 ? Math.floor(cost.lotSize) : 1;
  let quantity = Math.floor(budget / price / lotSize) * lotSize;
  while (quantity >= lotSize) {
    const gross = quantity * price;
    if (gross + commissionFor(gross, cost) <= budget + 1e-8) break;
    quantity -= lotSize;
  }
  return quantity >= lotSize ? quantity : 0;
}

/** 过滤并确定排序 long 意图（rank 升序 + securityId 破平）。 */
function desiredLongIntents(
  intents: readonly PositionIntent[]
): PositionIntent[] {
  return intents
    .filter(intent => intent.direction === "long")
    .slice()
    .sort((left, right) =>
      left.rank !== right.rank
        ? left.rank - right.rank
        : left.securityId.localeCompare(right.securityId)
    );
}

function skip(
  date: string,
  securityId: string,
  side: Side,
  code: PlanSkipCode,
  reason: string
): SkippedIntentEntry {
  return { date, securityId, side, code, reason };
}

/**
 * 装配单决策日的计划（纯函数）。
 *
 * 返回 orders 与 skipped 均按确定性顺序排列：orders = 先 sell（按 securityId 升序）
 * 后 buy（按 rank+securityId）；skipped 按出现顺序（holdings/意图顺序确定性）。
 */
export function planDecisionDay(input: PlanDecisionInput): DecisionPlan {
  const {
    decisionDate,
    intents,
    holdings,
    availableBySecurity,
    cash,
    maxPositions,
    hasNextTradingDay,
    closePriceBySecurity,
    amountBySecurity,
    cost,
    directionPolicy,
  } = input;

  // 决策日无候选意图 → 信息不足，持仓不变（不强制清仓），无任何计划。
  if (intents.length === 0) {
    return { orders: [], skipped: [] };
  }

  const orders: PlannedOrder[] = [];
  const skipped: SkippedIntentEntry[] = [];

  if (directionPolicy !== "longOnly") {
    throw new Error(
      `TradeSimulator: 不支持的方向策略 ${String(directionPolicy)}（当前仅支持 longOnly）`
    );
  }

  const longs = desiredLongIntents(intents);
  const desired = new Set(longs.map(intent => intent.securityId));
  const holdingSet = new Set(holdings);

  // ---- 退出：当前持仓不在 desired → 卖出全部可卖份额 ----
  const nextDayMessage = "模拟窗口最后交易日，无下一交易日可执行";
  for (const securityId of holdings) {
    if (desired.has(securityId)) continue;
    if (!hasNextTradingDay) {
      skipped.push(
        skip(
          decisionDate,
          securityId,
          "sell",
          "NO_NEXT_TRADING_DAY",
          nextDayMessage
        )
      );
      continue;
    }
    const available = availableBySecurity.get(securityId) ?? 0;
    if (available <= 0) {
      skipped.push(
        skip(
          decisionDate,
          securityId,
          "sell",
          "FROZEN_EXIT_DEFERRED",
          "可卖份额为 0（T+1 冻结中），卖出顺延至后续决策日再评估"
        )
      );
      continue;
    }
    orders.push({ kind: "sell", securityId, quantity: available });
  }

  // ---- 进入：desired 中未持仓的新候选，按预算进入 ----
  // 说明：longOnly 下 short/neutral 候选不可建仓；如未持仓则按策略跳过记录（不静默）。
  if (!hasNextTradingDay) {
    for (const intent of longs) {
      if (holdingSet.has(intent.securityId)) continue;
      skipped.push(
        skip(
          decisionDate,
          intent.securityId,
          "buy",
          "NO_NEXT_TRADING_DAY",
          nextDayMessage
        )
      );
    }
    for (const intent of intents) {
      if (intent.direction === "long") continue;
      if (holdingSet.has(intent.securityId)) continue; // 未持仓的 short/neutral：信息性记录
      skipped.push(
        skip(
          decisionDate,
          intent.securityId,
          "buy",
          "NON_LONG_DIRECTION",
          `方向 ${intent.direction} 在 longOnly 策略下不可建仓`
        )
      );
    }
    return { orders, skipped };
  }

  // 并发持仓上限（跳过超限候选）。
  const openPositionCount = holdingSet.size;
  const slotCap =
    maxPositions === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, maxPositions - openPositionCount);
  const entries: PositionIntent[] = [];
  const blockedByCap: PositionIntent[] = [];
  for (const intent of longs) {
    if (holdingSet.has(intent.securityId)) continue; // 已持有：hold，不加仓（STEP 8 Portfolio 不支持加仓）
    if (entries.length < slotCap) entries.push(intent);
    else blockedByCap.push(intent);
  }
  for (const intent of blockedByCap) {
    skipped.push(
      skip(
        decisionDate,
        intent.securityId,
        "buy",
        "MAX_POSITIONS_REACHED",
        `并发持仓已达上限 ${maxPositions}，新候选无空位`
      )
    );
  }

  // short/neutral 意图信息性跳过（未持仓）。
  for (const intent of intents) {
    if (intent.direction === "long") continue;
    if (holdingSet.has(intent.securityId)) continue; // 已持仓的按退出路径处理（不在 desired）
    skipped.push(
      skip(
        decisionDate,
        intent.securityId,
        "buy",
        "NON_LONG_DIRECTION",
        `方向 ${intent.direction} 在 longOnly 策略下不可建仓`
      )
    );
  }

  // 预算分配：决策日收盘可用现金 × 权重占比（不预支次日卖出回款）。
  const totalWeight = entries.reduce((sum, intent) => sum + intent.weight, 0);
  if (entries.length > 0 && totalWeight <= 0) {
    throw new Error(`TradeSimulator: ${decisionDate} 候选意图权重合计必须为正`);
  }
  for (const intent of entries) {
    const budget = totalWeight > 0 ? (cash * intent.weight) / totalWeight : 0;
    const price = closePriceBySecurity.get(intent.securityId);
    if (price === undefined || !Number.isFinite(price) || price <= 0) {
      throw new Error(
        `TradeSimulator: ${decisionDate} 候选 ${intent.securityId} 缺有效决策日收盘价，无法估量买入股数`
      );
    }
    const quantity = maxLotsWithinBudget(budget, price, cost);
    if (quantity <= 0) {
      skipped.push(
        skip(
          decisionDate,
          intent.securityId,
          "buy",
          "BUDGET_BELOW_MIN_LOT",
          "现金预算不足一手（含佣金估算），未买入"
        )
      );
      continue;
    }
    orders.push({
      kind: "buy",
      securityId: intent.securityId,
      quantity,
      weight: intent.weight,
      referenceAmount: amountBySecurity.get(intent.securityId) ?? null,
    });
  }

  return { orders, skipped };
}
