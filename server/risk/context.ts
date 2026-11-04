/**
 * Risk Layer — RiskContext 派生工具。
 *
 * Risk Layer 自身不访问 Portfolio 可变 API / 数据库 / 网络。
 * 本模块提供纯函数 `buildRiskContext`，由上层从 Portfolio 快照 + 行情派生 RiskContext 后传入。
 */

import type { RiskContext, RiskPosition } from "./contract";
import type { CostModel } from "../engine/domain";

/** 派生 RiskContext 的输入（只读快照，可由 Portfolio.snapshotPositions() + markToMarket() 提供）。 */
export interface BuildRiskContextInput {
  timestamp: string;
  equity: number;
  cash: number;
  availableCash: number;
  positions: readonly RiskPosition[];
  /** 当前决策标的（用于计算单标的敞口）。 */
  symbol: string;
  /** 当前标的市场价（用于估算敞口/成本），可空。 */
  marketPrice: number | null;
  /** 该标的参考成交额（单位：千元，信号日），可空。 */
  referenceAmount: number | null;
  cost: CostModel;
}

/** 从只读快照派生 RiskContext，自动计算组合敞口与单标的敞口。 */
export function buildRiskContext(input: BuildRiskContextInput): RiskContext {
  const marketValue = input.positions.reduce((sum, p) => sum + p.marketValue, 0);
  const symbolValue = input.positions.filter((p) => p.symbol === input.symbol).reduce((sum, p) => sum + p.marketValue, 0);
  const equity = input.equity > 0 ? input.equity : 1;
  return {
    timestamp: input.timestamp,
    equity: input.equity,
    cash: input.cash,
    availableCash: input.availableCash,
    positions: input.positions,
    openPositionCount: input.positions.length,
    marketPrice: input.marketPrice,
    portfolioExposure: marketValue / equity,
    symbolExposure: symbolValue / equity,
    referenceAmount: input.referenceAmount,
    cost: input.cost,
  };
}
