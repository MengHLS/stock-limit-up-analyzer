/**
 * STEP 9 — Risk Engine · 领域模型（Risk Domain）。
 *
 * 独立于 Backtest Core（server/engine/）与 Risk Layer（server/risk/）。
 * 只依赖 server/portfolio 的组合快照类型（PortfolioSnapshot / PositionSnapshot），
 * 是「组合 → 风控」之间唯一的数据契约。
 *
 * 前置风控（validateOrder）与后置风控（calculatePortfolioRisk）都是纯函数，
 * 输入组合快照 + 风险限额 + 历史上下文，输出确定性结果。
 */

import type { PortfolioSnapshot } from "../portfolio";

/**
 * 风险限额（配置，非策略参数）。
 * 所有字段都作为输入传入，本引擎不写死任何具体策略数值；
 * DEFAULT_RISK_LIMITS 仅为基础/演示用保守默认，调用方可整体覆盖。
 *
 * 取值约定（与项目既有 maxPositionAmountRatio「0 表示不限」口径一致）：
 *   - 数值型限额（maxPositionWeight / maxSectorWeight / maxGrossExposure /
 *     maxNetExposure / maxDrawdown / maxDailyLoss）：<= 0 表示「不启用该检查」。
 *   - 计数型限额 maxPositions：<= 0 表示「不限制持仓数」。
 */
export interface RiskLimit {
  /** 最大同时持仓数。 */
  maxPositions: number;
  /** 单一标的持仓市值占权益的最大权重（0~1）。 */
  maxPositionWeight: number;
  /** 单一行业持仓市值占权益的最大权重（0~1）。 */
  maxSectorWeight: number;
  /** 总敞口上限（0~1；>1 表示允许杠杆）。 */
  maxGrossExposure: number;
  /** 净敞口上限（0~1；>1 表示允许杠杆）。 */
  maxNetExposure: number;
  /** 最大回撤（0~1，当前回撤超过即触发）。 */
  maxDrawdown: number;
  /** 单日最大亏损（0~1，占权益，超过即触发）。 */
  maxDailyLoss: number;
}

/** 保守默认限额（非策略参数，仅供演示/兜底）。 */
export const DEFAULT_RISK_LIMITS: RiskLimit = {
  maxPositions: 10,
  maxPositionWeight: 0.2,
  maxSectorWeight: 0.4,
  maxGrossExposure: 1.0,
  maxNetExposure: 1.0,
  maxDrawdown: 0.15,
  maxDailyLoss: 0.05,
};

/** 前置风控原因码（与 STEP 9 规范 §八 对齐）。 */
export type RiskReasonCode =
  | "INVALID_ORDER"
  | "INSUFFICIENT_CASH"
  | "MAX_POSITION"
  | "MAX_EXPOSURE"
  | "RISK_LIMIT";

/** 前置风控裁决结果。 */
export type OrderValidationResult =
  | { verdict: "PASS" }
  | { verdict: "REJECT"; reasonCode: RiskReasonCode; message: string };

/** 单行业敞口。 */
export interface SectorExposure {
  sector: string;
  /** 该行业持仓市值。 */
  marketValue: number;
  /** 该行业权重 = marketValue / equity。 */
  weight: number;
}

/** 单个限额被击穿的记录（后置风控）。 */
export interface RiskBreach {
  /** 限额名（如 maxPositionWeight）。 */
  code: string;
  /** 限额值。 */
  limit: number;
  /** 实际值。 */
  actual: number;
  /** 人类可读解释。 */
  message: string;
}

/** 后置风险快照。 */
export interface RiskSnapshot {
  /** 总敞口 = |long| / equity。 */
  grossExposure: number;
  /** 净敞口 = (long − short) / equity。 */
  netExposure: number;
  /** 现金敞口 = cash / equity。 */
  cashExposure: number;
  /** 持仓敞口 = marketValue / equity。 */
  positionExposure: number;
  /** 单股集中度 = max(单股持仓市值 / equity)。 */
  singleStockConcentration: number;
  /** 行业敞口（仅含可解析行业的持仓；未分类持仓不参与）。 */
  sectorExposures: SectorExposure[];
  /** 当前回撤（0~1，正数表示回撤深度）。 */
  drawdown: number;
  /** 当日亏损（0~1，正数表示亏损，盈利时为 0）。 */
  dailyLoss: number;
  /** 组合年化波动率（接口；无日收益序列时为 null）。 */
  annualizedVolatility: number | null;
  /** 被击穿的限额列表（按固定顺序）。 */
  breaches: RiskBreach[];
}

/**
 * 历史上下文（供 drawdown / daily loss / volatility 计算）。
 * 由上层维护权益曲线后传入；Risk Engine 自身不保存时间序列，保持无状态纯函数。
 */
export interface RiskHistory {
  /** 历史峰值权益（含当前时点）。 */
  peakEquity: number;
  /** 上一交易日权益（用于 daily loss）。 */
  previousEquity: number;
  /** 日收益率序列（用于年化波动率）。 */
  dailyReturns: number[];
}

/** 行业解析函数（symbol → 行业名），由上层注入（依赖 STEP 7.x 历史行业数据）。 */
export type SectorResolver = (symbol: string) => string | undefined;
