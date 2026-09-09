/**
 * STEP 14 / C-14.2 — 成本模型：与 engine/domain#CostModel 的双向映射。
 *
 * 关系（C-14.2 目标 ⑥ 的交付）：
 *   - simulator（C-14.1）的 SimulationConfig.cost 消费的是 engine/domain#CostModel
 *     （六字段：commissionRate / stampDutyRate / transferFeeRate / slippageBps /
 *     lotSize / minCommission），且 backtest/cost.ts 的原子费用函数也以该类型为入参。
 *   - 本目录的 CostModelDeclaration 是「上游声明层」：在 engine 六字段之上叠加
 *     市场冲击子模型（engine 无对应字段）。因此声明 → engine 是**投影**（丢弃冲击），
 *     供既有回测/模拟消费；engine → 声明是**回填**（冲击必须由调用方显式给出，
 *     不发明默认冲击参数——杜绝「隐式启用未标定模型」）。
 *
 * 铁律：纯函数、不修改入参；只做字段搬运（含 lotSize 取整归一，非正整数回退 1，
 * 与 backtest/portfolio 语义一致）；引擎侧无冲击字段，故 mapper 不丢失信息。
 */

import type { CostModel } from "../../engine/domain";
import type { CostModelDeclaration, MarketImpactParams } from "./types";

/** 声明 → engine CostModel 投影（六字段，不含市场冲击）。 */
export function toEngineCostModel(
  declaration: Readonly<CostModelDeclaration>
): CostModel {
  const lotSize =
    Number.isFinite(declaration.lotSize) && declaration.lotSize > 0
      ? Math.floor(declaration.lotSize)
      : 1;
  return {
    commissionRate: declaration.commissionRate,
    stampDutyRate: declaration.stampDutyRate,
    transferFeeRate: declaration.transferFeeRate,
    slippageBps: declaration.slippageBps,
    lotSize,
    minCommission: declaration.minCommission,
  };
}

/** engine CostModel → 声明（冲击参数由调用方显式给出；name 默认自动标注）。 */
export function fromEngineCostModel(
  cost: CostModel,
  marketImpact: Readonly<MarketImpactParams>,
  name = "FROM_ENGINE_COST_MODEL"
): CostModelDeclaration {
  return {
    name,
    commissionRate: cost.commissionRate,
    stampDutyRate: cost.stampDutyRate,
    transferFeeRate: cost.transferFeeRate,
    slippageBps: cost.slippageBps,
    lotSize:
      Number.isFinite(cost.lotSize) && cost.lotSize > 0
        ? Math.floor(cost.lotSize)
        : 1,
    minCommission: cost.minCommission,
    marketImpact: { ...marketImpact },
  };
}
