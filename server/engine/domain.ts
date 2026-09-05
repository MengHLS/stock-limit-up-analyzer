/**
 * Backtest Core — 统一领域模型（Domain Model）。
 *
 * 这是全系统回测的单一事实来源类型层。职责单一、不承载任何计算逻辑。
 *
 * 生命周期（Signal → Order → Fill → Position → Portfolio → Equity → Performance）：
 *   1. 策略在 signalTime 产生 Signal（意图），只允许读取 signalTime 及之前的信息。
 *   2. Signal 规范化为 Order（带 executionTime，即允许成交的最早时点）。
 *   3. ExecutionModel 在 executionTime 依据当时可见的 MarketBar 产生 Fill（或拒绝）。
 *   4. Portfolio 应用 Fill，更新 cash / position / equity。
 *   5. Performance Analytics 仅从 equityCurve 与 trades 计算全部指标。
 *
 * 未来函数防护核心：本模型的每个对象都显式携带时间戳，
 * 引擎以「时间推进」方式消费数据，禁止任何对象读取其自身时间戳之后的信息。
 */

/** 单只股票单个交易日的市场快照（含当日开盘/最高/最低/收盘/前收/成交额）。 */
export interface MarketBar {
  /** 交易日（YYYY-MM-DD），即本 bar 的 dataTime。 */
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  /** 前收盘价，用于涨跌停判定。 */
  prevClose: number | null;
  /** 当日成交额（单位：千元，与 Tushare daily amount 一致），可空。 */
  amount: number | null;
}

/** 交易方向。 */
export type Side = "buy" | "sell";

/** 策略信号（意图）。策略只产生信号，不直接触碰资金/持仓。 */
export interface Signal {
  symbol: string;
  /** 信号产生时点（如 T 日收盘）。策略只能使用 <= signalTime 的信息。 */
  signalTime: string;
  side: Side;
  /** 目标数量（股）；正数。 */
  quantity: number;
  /** 可选的信号强度/评分，用于排序或仓位分配，不参与成交本身。 */
  score?: number;
  /** 可选的解释性标签。 */
  reason?: string | null;
}

/** 只读组合快照（供 Strategy 层在 signalProvider 阶段读取，不暴露可变 API）。 */
export interface ReadonlyPortfolioSnapshot {
  readonly cash: number;
  readonly equity: number;
  readonly openPositionCount: number;
  readonly openPositionSymbols: readonly string[];
}

/** 订单（Order Intent）。由 Signal 规范化而来，声明最早可执行时点。 */
export interface Order {
  symbol: string;
  side: Side;
  quantity: number;
  /** 订单允许成交的最早时点（如 T+1 开盘）。禁止早于 signalTime 成交。 */
  executionTime: string;
  /** 挂单类型；当前仅支持市价单（以执行时点 bar 的开盘价成交）。 */
  orderType: "market";
  /** 来源信号（可选，用于追溯）。 */
  signal?: Signal;
}

/** 成交（Fill）。Order 与实际成交分离：可能被拒绝、部分成交或无法成交。 */
export interface Fill {
  symbol: string;
  side: Side;
  quantity: number;
  /** 实际成交价（含滑点）。 */
  price: number;
  /** 无滑点基准价（如开盘价），用于严格满足 Net PnL = Gross PnL − Fees − Slippage。 */
  basePrice: number;
  /** 成交时点。 */
  executedAt: string;
  /** 本次成交的总费用（佣金 + 印花税 + 过户费，滑点已计入 price）。 */
  fees: number;
  /** 滑点金额（相对无滑点基准价的价差 × 数量），用于透明核算。 */
  slippageAmount: number;
  /** 用于单笔买入容量约束（maxPositionAmountRatio）的参考成交额（单位：千元，与 Tushare daily amount 一致）。
   *  取信号产生日（signalTime）的成交额——该时点在成交日开盘前已可知，避免未来函数。可空。 */
  amount?: number | null;
  /** 拒绝原因（未成交时非 null）。 */
  rejectionReason?: string | null;
}

/** 持仓（Position）。账户内某只股票的净敞口与成本。 */
export interface Position {
  symbol: string;
  quantity: number;
  /** 加权平均买入成本价（含滑点，不含费用）。 */
  averageEntryPrice: number;
  /** 最近可见市场价，用于 mark-to-market 估值。 */
  marketPrice: number | null;
  marketValue: number;
  unrealizedPnL: number;
  /** 该持仓累计已实现盈亏（减仓/清仓时结转）。 */
  realizedPnL: number;
}

/** 完整交易生命周期（一次建仓到清仓，或回测期末仍持仓）。 */
export interface Trade {
  symbol: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string | null;
  exitPrice: number | null;
  quantity: number;
  grossPnL: number | null;
  fees: number;
  slippageAmount: number;
  netPnl: number | null;
  /** 净收益率（%）。清仓时为 netPnl / 总成本 × 100；未清仓为 null。 */
  returnPct: number | null;
  /** 持有交易日数；未清仓时为 null。 */
  holdingPeriod: number | null;
  /** 期末仍持仓则为 true（按最后估值价虚拟估值，不计入已实现收益）。 */
  openAtEnd: boolean;
  /** 可选的解释性标签（止损/止盈/到期/期末估值等）。 */
  reason?: string | null;
}

/** 权益曲线上的一个点（每个有效回测时点）。 */
export interface EquityPoint {
  /** 时点（交易日）。 */
  timestamp: string;
  cash: number;
  marketValue: number;
  equity: number;
  openPositions: number;
}

/** 回测配置（必须能完整复现本次回测）。 */
export interface BacktestConfig {
  strategyId: string;
  strategyVersion: string;
  initialCapital: number;
  startDate: string;
  endDate: string;
  /** 成本模型。 */
  cost: CostModel;
  /** 最大同时持仓数。 */
  maxPositions: number;
  /** 单笔最大买入金额占当日成交额比例上限（0 = 不限），用于容量约束。 */
  maxPositionAmountRatio: number;
}

/** 成本模型（全系统唯一手续费/滑点定义）。 */
export interface CostModel {
  /** 佣金费率（双边）。 */
  commissionRate: number;
  /** 印花税（仅卖出）。 */
  stampDutyRate: number;
  /** 过户费（双边）。 */
  transferFeeRate: number;
  /** 滑点（基点，1bp = 0.01%）。买入上浮、卖出下浮。 */
  slippageBps: number;
  /** 最小交易单位（一手股数）。 */
  lotSize: number;
  /** 最低佣金（元），默认 5 元。 */
  minCommission: number;
}

/** 绩效指标（统一从 equityCurve 与 trades 计算）。 */
export interface PerformanceMetrics {
  totalReturnPct: number;
  /** 几何年化收益 CAGR（%），n<1 时 null。 */
  annualizedReturnPct: number | null;
  /** 年化波动率（%）。 */
  annualizedVolatilityPct: number | null;
  /** 夏普比率（算术年化，统一使用 shared/quant-stats 定义）。 */
  sharpeRatio: number | null;
  maxDrawdownPct: number;
  tradeCount: number;
  completedTradeCount: number;
  winRatePct: number | null;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;
  /** 期末未平仓数量。 */
  openPositionCount: number;
}

/** 统一回测结果。 */
export interface BacktestResult {
  metadata: {
    strategyId: string;
    strategyVersion: string;
    startDate: string;
    endDate: string;
    initialCapital: number;
    generatedAt: string;
  };
  config: BacktestConfig;
  trades: Trade[];
  equityCurve: EquityPoint[];
  finalPortfolio: {
    cash: number;
    marketValue: number;
    equity: number;
    positions: Position[];
  };
  performance: PerformanceMetrics;
}
