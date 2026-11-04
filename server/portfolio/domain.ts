/**
 * STEP 9 — Portfolio Engine · 领域模型（Domain Model）。
 *
 * 这是「组合层」的单一事实来源类型层，独立于 Backtest Core（server/engine/）与
 * Risk Layer（server/risk/）。本目录不 import engine/risk/strategy/research 的任何
 * 实现或类型，只定义「资金 → 持仓 → 组合」的确定性会计语义。
 *
 * 职责边界（与 STEP 8 严格隔离）：
 *   - STEP 8（server/engine/）负责 Backtest execution lifecycle（Signal→Order→Fill→
 *     Position→Portfolio→Equity→Performance），其 Portfolio 与 Execution/CostModel
 *     强耦合，是「回测专用」的组合。
 *   - STEP 9（本目录 + server/riskEngine/）提供一套与 Signal/Order/Fill/成交模型
 *     完全解耦的通用组合 + 风控基础，可被 Backtest / Paper / Live 复用。
 *   - 两者通过「接口」连接（详见 STEP_9_PORTFOLIO_ARCHITECTURE.md 的边界契约），
 *     禁止把本目录的 Portfolio 复制进 STEP 8。
 */

/** 交易方向。 */
export type Side = "buy" | "sell";

/**
 * 费用/税模型（确定性，独立于回测引擎的 CostModel）。
 *
 * 全部金额单位为人民币元；费率为小数（0.0003 = 万三）。
 * 本模型是 Portfolio Engine 会计结算的输入，禁止策略/组合层自行内联扣费公式。
 */
export interface FeeSchedule {
  /** 佣金费率（双边）。 */
  commissionRate: number;
  /** 最低佣金（元）。 */
  minCommission: number;
  /** 印花税（仅卖出）。 */
  stampDutyRate: number;
  /** 过户费（双边）。 */
  transferFeeRate: number;
  /** 最小交易单位（买入必须为整手）。 */
  lotSize: number;
}

/** 默认 A 股费用/税模型（与项目既有回测默认口径一致，仅供测试与演示，非策略参数）。 */
export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  commissionRate: 0.0003,
  minCommission: 5,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  lotSize: 100,
};

/** 订单意图（Portfolio Engine 的输入，独立于策略层 Signal/OrderIntent）。 */
export interface OrderRequest {
  symbol: string;
  side: Side;
  /** 股数（正整数；买入必须为整手，卖出可为非整手清仓）。 */
  quantity: number;
}

/**
 * 成交（Fill）：订单以指定价格成交后的确定性会计结果。
 * 费用（佣金+过户费）与税（印花税）由 Accounting 层计算，现金变动在此显式化。
 */
export interface Fill {
  symbol: string;
  side: Side;
  quantity: number;
  /** 实际成交价。 */
  price: number;
  /** 成交金额 = price × quantity。 */
  grossAmount: number;
  /** 费用（佣金 + 过户费）。 */
  fees: number;
  /** 税（印花税，仅卖出，买入为 0）。 */
  tax: number;
  /** 现金净变动（买入为负、卖出为正）。 */
  netCash: number;
  /** 成交日（YYYY-MM-DD）。 */
  executedAt: string;
}

/** 持仓快照（对外只读）。 */
export interface PositionSnapshot {
  symbol: string;
  /** 总持仓股数。 */
  quantity: number;
  /**
   * 可卖出股数（T+1 预留）：今日买入部分尚不可卖出，等于 quantity − lockedQuantity。
   * 卖出校验只能使用 availableQuantity。
   */
  availableQuantity: number;
  /** 加权平均成本（元/股，含买入费用，即 costBasis / quantity）。 */
  averageCost: number;
  /** 最近可见市场价（用于 mark-to-market），可空表示未估值。 */
  marketPrice: number | null;
  /** 当前市值 = marketPrice × quantity。 */
  marketValue: number;
  /** 未实现盈亏 = marketValue − costBasis。 */
  unrealizedPnL: number;
  /** 该持仓累计已实现盈亏（减仓/清仓时结转）。 */
  realizedPnL: number;
  /** 可选行业分类（来自 STEP 7.x 历史行业数据；本引擎不内置行业映射）。 */
  sector?: string;
}

/**
 * 组合快照（Risk Engine 的输入）。
 * 由 PortfolioAccount.snapshot() 生成，是组合层与风控层之间的唯一数据契约。
 */
export interface PortfolioSnapshot {
  /** 快照时点（交易日）。 */
  date: string;
  /** 现金。 */
  cash: number;
  /** 持仓总市值。 */
  marketValue: number;
  /** 权益 = cash + marketValue。 */
  equity: number;
  /** 累计已实现盈亏。 */
  realizedPnL: number;
  /** 累计未实现盈亏（持仓市值 − 成本基）。 */
  unrealizedPnL: number;
  /** 累计费用（佣金 + 过户费）。 */
  fees: number;
  /** 累计税（印花税）。 */
  tax: number;
  /** 总敞口 = marketValue / equity（0~1，多头；equity<=0 时为 0）。 */
  exposure: number;
  /** 持仓列表（按 symbol 升序，确定性）。 */
  positions: PositionSnapshot[];
}

/** 会计操作结果（买/卖），供完整性测试与审计使用。 */
export interface AccountingResult {
  success: boolean;
  /** 失败原因码（成功为空）。 */
  reason?: string;
  /** 成功时返回本次成交明细。 */
  fill?: Fill;
}
