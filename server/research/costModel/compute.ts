/**
 * STEP 14 / C-14.2 — 成本模型：单笔成交成本分解（与 STEP 8 原子函数组合，只读复用）。
 *
 * 组合方式（目标 ⑤ 的交付，铁律：不重写 STEP 8）：
 *   - 现金费用 commission / stampDuty / transferFee / otherFees：逐字段来自
 *     backtest/cost#computeTradeCost(side, grossAmount, engineCostModel) 的分解，
 *     不做任何二次计算——审计值与既有回测逐分一致；
 *   - slippage：来自 backtest/cost#slippageAmount(price, basePrice, quantity)，
 *     有符号口径原样保留（buy ≥ 0 / sell ≤ 0），见 types#FillCostBreakdown；
 *   - marketImpact：本目录 impact.ts 的新模型，金额 = grossAmount × impactBps / 10^4，
 *     符号与 slippage 对齐（buy ≥ 0 / sell ≤ 0），basis 说明见 types.ts；
 *   - totalCostDrag = |slippage| + cashFees + |marketImpact|（相对 baseNotional 的
 *     总摩擦，恒非负）。
 *
 * FAIL LOUD：价格/数量/参考成交额非法即抛 CostModel14Error（FILL_INPUT_INVALID /
 * IMPACT_*）；市场冲击启用而流动性缺失 → 抛错（不静默给 0）。declaration 须先经
 * assertValidCostModelDeclaration（结构边界在声明层校验，本函数只做成交级输入校验）。
 *
 * 确定性：无 IO / Date.now / Math.random；同输入恒同输出，可安全进入审计记录。
 */

import { computeTradeCost, slippageAmount } from "../../backtest/cost";
import { CostModel14Error } from "./errors";
import { estimateMarketImpact } from "./impact";
import { toEngineCostModel } from "./mappers";
import type { CostModelDeclaration, FillCostBreakdown, FillCostInput } from "./types";

/** 基点换算（1bp = 0.01% = 1/10^4）。 */
const BPS_PER_UNIT = 10_000;

function assertFillPrice(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CostModel14Error(
      "FILL_INPUT_INVALID",
      `成本分解：${label} 必须为正有限数字，收到 ${String(value)}`
    );
  }
  return value;
}

function assertFillQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CostModel14Error(
      "FILL_INPUT_INVALID",
      `成本分解：quantity 必须为正有限数字，收到 ${String(value)}`
    );
  }
  return value;
}

/**
 * 单笔成交成本分解（确定性纯函数）。
 *
 * @throws CostModel14Error 输入非法 / 冲击启用但流动性缺失或参与率超界。
 */
export function computeFillCostBreakdown(
  input: FillCostInput
): FillCostBreakdown {
  const { side, declaration, referenceAmountKqian } = input;
  const price = assertFillPrice(input.price, "price");
  const basePrice = assertFillPrice(input.basePrice, "basePrice");
  const quantity = assertFillQuantity(input.quantity);

  const grossAmount = price * quantity;
  const baseNotional = basePrice * quantity;

  // STEP 8 原子费用（经 mapper 投影成 engine CostModel，保证声明即被既有回测消费）。
  const engineCost = toEngineCostModel(declaration);
  const tradeCost = computeTradeCost(side, grossAmount, engineCost);
  const slippage = slippageAmount(price, basePrice, quantity);

  // 市场冲击（本目录增量；enabled = false 时经声明关闭 → 不读取流动性）。
  const estimate = estimateMarketImpact({
    orderNotionalYuan: grossAmount,
    referenceAmountKqian,
    params: declaration.marketImpact,
  });
  const impactMagnitude = (grossAmount * estimate.impactBps) / BPS_PER_UNIT;
  const marketImpact =
    side === "buy" ? impactMagnitude : -impactMagnitude;

  const cashFees = tradeCost.total;
  const totalCostDrag =
    Math.abs(slippage) + cashFees + Math.abs(marketImpact);

  return {
    side,
    baseNotional,
    grossAmount,
    commission: tradeCost.commission,
    stampDuty: tradeCost.stampDuty,
    transferFee: tradeCost.transferFee,
    otherFees: tradeCost.otherFees,
    cashFees,
    slippage,
    slippageBps: baseNotional > 0 ? (Math.abs(slippage) / baseNotional) * BPS_PER_UNIT : 0,
    marketImpact,
    impactBps: estimate.impactBps,
    impactApplied: declaration.marketImpact.enabled,
    participation: estimate.participation,
    referenceAmountKqian,
    totalCostDrag,
  };
}
