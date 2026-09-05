/**
 * STEP 8 — Backtest Engine 2.0：统一领域模型（Domain Model）。
 *
 * 这是「研究级回测引擎」的单一事实来源类型层，职责单一、不承载计算逻辑。
 * 与既有 `server/engine/domain.ts`（生产 Step 2 Core）的关系：
 *   - CostModel 仍复用生产层定义（六字段单一来源），本层不复制第二套成本模型；
 *   - 本层引入生产 Core 尚未覆盖的显式概念：Universe、Order 生命周期、T+1 冻结/可用、
 *     Corporate Action 声明、拒绝原因枚举、执行模型枚举、审计与执行统计。
 *
 * 生命周期（Decision → Signal → Order → Execution → Position → Portfolio → PnL → Cost
 *          → Risk → Metrics → Audit）：
 *   1. 策略在 decisionTime（T 日收盘后）产出 Signal（意图），只允许读取 <= T 的信息。
 *   2. Signal 规范化为 Order（带 executionTime = 下一交易日），携带 orderType/requestedPrice/status。
 *   3. ExecutionModel 在 executionTime 依据当时可见的 bar 产出 Fill（或拒绝，rejectionReason 显式化）。
 *   4. PositionBook 应用 Fill，区分 quantity / availableQuantity / frozenQuantity（T+1）。
 *   5. Portfolio 统一核算 cash / marketValue / equity / realizedPnL / unrealizedPnL。
 *   6. Metrics 仅从 equityCurve 与 trades 计算；Audit 逐订单/成交/持仓解释「为什么」。
 *
 * 未来函数防护核心：每个对象显式携带时间戳；引擎以「日期推进」消费数据，
 * 禁止任何对象读取其自身时间戳之后的信息。
 */

import type { CostModel } from "../engine/domain";
import type { CanonicalMarketBar } from "../data/types";
import type { CorporateAction } from "../corporateActions/types";

/** 交易方向。 */
export type Side = "buy" | "sell";

/** 订单类型。market = 市价单；limit = 限价单（requestedPrice 非空）。 */
export type OrderType = "market" | "limit";

/** 订单状态（显式生命周期，Signal ≠ Order ≠ Fill）。 */
export type OrderStatus =
  | "NEW" // 已创建，尚未提交
  | "SUBMITTED" // 已提交，等待成交（进入 executionTime 的待成交队列）
  | "PARTIALLY_FILLED" // 部分成交（剩余未成交）
  | "FILLED" // 全部成交
  | "REJECTED" // 被拒绝（携带 rejectionReason）
  | "CANCELLED" // 被取消（剩余未成交部分作废）
  | "EXPIRED"; // 过期未成交

/**
 * 成交拒绝原因（枚举化，供审计/统计程序化处理，非自由文本）。
 * 当前只声明接口，完整历史涨跌停/停牌规则由 MarketRule / ExecutionRule 注入提供。
 */
export type RejectionReason =
  | "LIMIT_UP" // 涨停（无法买入 / 涨停封板）
  | "LIMIT_DOWN" // 跌停（无法卖出 / 跌停封板）
  | "SUSPENDED" // 停牌（当日无成交）
  | "NO_LIQUIDITY" // 无流动性（成交量为 0 / 无有效价格）
  | "INSUFFICIENT_CASH" // 现金不足
  | "T_PLUS_1" // T+1 限制（当日买入不可当日卖出）
  | "OTHER"; // 其它（数据缺失 / 非整手 / 容量不足等，附 explanation）

/** 执行模型标识。 */
export type ExecutionModelId = "NEXT_OPEN" | "NEXT_CLOSE" | "VWAP_PROXY" | "LIMIT_PRICE";

/** 执行模型在成交时点可用的规则上下文（已按标的板块解析涨跌停幅度）。 */
export interface ExecutionRuleContext {
  limitUpRatio: number;
  limitDownRatio: number;
  blockLimitUpBuy: boolean;
  blockLimitDownSell: boolean;
}

/** 执行报价：可成交价或拒绝（显式拒绝原因）。 */
export interface ExecutionQuote {
  kind: "rejected" | "filled";
  /** rejected 时的原因。 */
  rejectionReason?: RejectionReason;
  /** filled 时的无滑点基准价。 */
  basePrice?: number;
  /** filled 时的成交价（含滑点）。 */
  price?: number;
  /** filled 时的参考成交额（千元，取自成交时点前已可知数据）。 */
  referenceAmount?: number | null;
}

/**
 * 执行模型（注入式）。负责「给定 bar 上订单能否成交、以什么价格成交」，
 * 产出报价或拒绝；资金/持仓/整手/T+1 等会计约束由 PositionBook / Portfolio 裁决。
 */
export interface ExecutionModel {
  readonly id: ExecutionModelId;
  quote(
    order: Order,
    bar: CanonicalMarketBar,
    rules: ExecutionRuleContext,
    cost: CostModel,
    referenceAmount: number | null,
  ): ExecutionQuote;
}

/**
 * Corporate Action（除权除息）处理声明。
 * STEP 7.7 尚未完成，故引擎必须能显式声明口径，绝不假设 adjusted price 已处理。
 */
export type CorporateActionMode = "RAW" | "ADJUSTED" | "CORPORATE_ACTION_UNAVAILABLE";

/** 证券静态元数据（名称/板块用于涨跌停幅度解析，非逐日状态）。 */
export interface Security {
  /** 股票代码（带交易所后缀，如 "002361.SZ"）。 */
  securityId: string;
  /** 股票名称（可选）。 */
  name?: string;
  /** 板块（用于涨跌停幅度），可空。 */
  board?: "main" | "gem" | "star" | "bse";
}

/** Universe 定义：一组证券。 */
export interface Universe {
  /** Universe 标识（可审计）。 */
  id: string;
  /** 证券列表。 */
  securities: readonly Security[];
}

/** 停牌解析器（注入式规则）。默认实现按「交易日无 bar」推断停牌。 */
export interface SuspensionResolver {
  /** securityId 在 date 是否停牌。 */
  isSuspended(securityId: string, date: string): boolean;
}

/**
 * 公司行为解析器（注入式，STEP 11 接线）。
 * 返回某证券在指定交易日生效（effectiveDate === date）的公司行为集；无事件返回空数组。
 * 引擎在每个交易日开始时对持仓证券调用，把份额/成本基/现金变换应用到 Portfolio。
 */
export interface CorporateActionResolver {
  /** 返回 securityId 在 date 生效的公司行为（按 effectiveDate 精确匹配）。 */
  actionsFor(securityId: string, date: string): readonly CorporateAction[];
}

/** 涨跌停幅度（比例，如 0.10 表示 ±10%）。 */
export interface PriceLimit {
  limitUpRatio: number;
  limitDownRatio: number;
}

/** 市场规则（注入式）：T+1、一手股数、涨跌停幅度解析。 */
export interface MarketRuleSet {
  /** 是否启用 T+1（当日买入不可当日卖出）。 */
  tPlus1: boolean;
  /** 一手股数（最小交易单位）。 */
  lotSize: number;
  /** 按标的板块解析涨跌停幅度；返回 null 表示不设涨跌停。 */
  resolvePriceLimit(security: Security): PriceLimit | null;
}

/** 执行规则（注入式）：涨跌停拦截开关。 */
export interface ExecutionRuleSet {
  /** 买入时若开盘触及涨停则拒绝。 */
  blockLimitUpBuy: boolean;
  /** 卖出时若开盘触及跌停则拒绝。 */
  blockLimitDownSell: boolean;
}

/** 策略信号（意图）。策略只产生信号，不直接触碰资金/持仓。 */
export interface Signal {
  /** 信号身份（可选，用于审计关联）。 */
  signalId?: string;
  /** 标的代码。 */
  securityId: string;
  /** 信号产生时点（决策日，YYYY-MM-DD）。策略只能使用 <= signalTime 的信息。 */
  signalTime: string;
  side: Side;
  /** 目标数量（股），正数。 */
  quantity: number;
  /** 可选评分/强度，用于排序或仓位分配，不参与成交本身。 */
  score?: number;
  /** 可选限价（提供时归一化为 limit 订单，配合 LIMIT_PRICE 执行模型）。 */
  limitPrice?: number;
  /** 可选解释性标签（回答「为什么产生该信号」）。 */
  reason?: string | null;
}

/** 订单（Order Intent）。由 Signal 规范化而来，声明最早可执行时点与挂单类型。 */
export interface Order {
  orderId: string;
  securityId: string;
  /** 下单日（决策日）。 */
  tradeDate: string;
  side: Side;
  /** 目标数量（股），正数。 */
  quantity: number;
  orderType: OrderType;
  /** 限价单的委托价；市价单为 null。 */
  requestedPrice: number | null;
  status: OrderStatus;
  /** 订单允许成交的最早时点（下一交易日）。 */
  executionTime: string;
  /** 已成交数量。 */
  filledQuantity: number;
  /** 加权平均成交价（未成交为 null）。 */
  averageFillPrice: number | null;
  /** 拒绝原因（未成交/被拒时非 null）。 */
  rejectionReason: RejectionReason | null;
  /** 来源信号（可选，用于追溯）。 */
  signal?: Signal;
  /** 订单创建时点（确定性回测中为固定标记，非真实时钟）。 */
  createdAt: string;
}

/** 单笔成交的分解成本（费用类，与滑点分离）。 */
export interface TradeCost {
  /** 佣金。 */
  commission: number;
  /** 印花税（仅卖出）。 */
  stampDuty: number;
  /** 过户费（双边）。 */
  transferFee: number;
  /** 其它费用（预留）。 */
  otherFees: number;
  /** 现金费用合计 = commission + stampDuty + transferFee + otherFees。 */
  total: number;
}

/** 成交（Fill）。Order 与实际成交分离：可能被拒绝、部分成交或无法成交。 */
export interface Fill {
  fillId: string;
  orderId: string;
  securityId: string;
  side: Side;
  quantity: number;
  /** 实际成交价（含滑点）。 */
  price: number;
  /** 无滑点基准价（如开盘价/收盘价），用于严格满足 Net PnL = Gross PnL − Fees − Slippage。 */
  basePrice: number;
  /** 成交时点（YYYY-MM-DD）。 */
  timestamp: string;
  /** 分解费用（现金费用）。 */
  cost: TradeCost;
  /** 滑点金额（相对基准价的价差 × 数量），已计入 price。 */
  slippageAmount: number;
  /** 用于单笔买入容量约束的参考成交额（千元），必须取自成交时点之前已可知数据。 */
  referenceAmount?: number | null;
}

/** 持仓（Position）。区分总量 / 可卖 / 冻结（T+1）。 */
export interface Position {
  securityId: string;
  /** 持仓总量。 */
  quantity: number;
  /** 可卖数量（已结算，T+1 后可用）。 */
  availableQuantity: number;
  /** 冻结数量（当日买入，T+1 前不可卖）。 */
  frozenQuantity: number;
  /** 加权平均买入成本价（含滑点，不含费用）。 */
  averageEntryPrice: number;
  /** 最近可见市场价，用于 mark-to-market。 */
  marketPrice: number | null;
  /** 持仓市值。 */
  marketValue: number;
  /** 该持仓累计已实现盈亏。 */
  realizedPnL: number;
  /** 未实现盈亏（市值 − 成本基）。 */
  unrealizedPnL: number;
}

/** 组合状态（确定性快照）。 */
export interface PortfolioState {
  cash: number;
  positions: readonly Position[];
  marketValue: number;
  equity: number;
  realizedPnL: number;
  unrealizedPnL: number;
}

/** 只读组合快照（供策略在信号阶段读取，不暴露可变 API）。 */
export interface ReadonlyPortfolioSnapshot {
  readonly cash: number;
  readonly equity: number;
  readonly openPositionCount: number;
  readonly openPositionSymbols: readonly string[];
}

/** 完整交易生命周期（一次建仓到清仓，或回测期末仍持仓）。 */
export interface Trade {
  securityId: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string | null;
  exitPrice: number | null;
  quantity: number;
  grossPnL: number | null;
  fees: number;
  slippageAmount: number;
  netPnl: number | null;
  /** 净收益率（%）。清仓时 = netPnl / 总成本 × 100；未清仓为 null。 */
  returnPct: number | null;
  /** 持有交易日数；未清仓为 null。 */
  holdingPeriod: number | null;
  /** 期末仍持仓则为 true。 */
  openAtEnd: boolean;
  /** 解释性标签（止盈/止损/到期/期末估值等）。 */
  reason?: string | null;
}

/** 权益曲线上的一个点。 */
export interface EquityPoint {
  date: string;
  cash: number;
  marketValue: number;
  equity: number;
  openPositions: number;
}

/** 绩效指标（统一从 equityCurve 与 trades 计算，复用 shared/quant-stats 原语）。 */
export interface Metrics {
  totalReturnPct: number;
  annualizedReturnPct: number | null;
  annualizedVolatilityPct: number | null;
  sharpeRatio: number | null;
  maxDrawdownPct: number;
  tradeCount: number;
  completedTradeCount: number;
  winRatePct: number | null;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;
  openPositionCount: number;
}

/** 成本汇总（全回测期，按 buy/sell 区分）。 */
export interface CostSummary {
  buyCommission: number;
  sellCommission: number;
  stampDuty: number;
  transferFee: number;
  slippage: number;
  otherFees: number;
  /** 现金费用合计。 */
  totalFees: number;
  /** 含滑点的总成本（费用 + 滑点）。 */
  totalCost: number;
}

/** 执行统计（信号/订单/成交/拒绝计数）。 */
export interface ExecutionStats {
  totalSignals: number;
  totalOrders: number;
  totalFills: number;
  rejectedOrders: number;
  partialFills: number;
  /** 按拒绝原因计数。 */
  byReason: Partial<Record<RejectionReason, number>>;
}

/** 审计条目（订单）。 */
export interface OrderAuditEntry {
  orderId: string;
  securityId: string;
  tradeDate: string;
  side: Side;
  requestedQuantity: number;
  filledQuantity: number;
  status: OrderStatus;
  rejectionReason: RejectionReason | null;
  /** 为什么买/卖/没成交/被拒。 */
  explanation: string;
}

/** 审计条目（成交）。 */
export interface FillAuditEntry {
  fillId: string;
  orderId: string;
  securityId: string;
  side: Side;
  quantity: number;
  price: number;
  basePrice: number;
  timestamp: string;
  slippageAmount: number;
  cost: TradeCost;
}

/** 审计条目（持仓变动）。 */
export interface PositionAuditEntry {
  securityId: string;
  timestamp: string;
  /** 事件：open / increase / decrease / close / mark。 */
  event: "open" | "increase" | "decrease" | "close" | "mark";
  beforeQuantity: number;
  afterQuantity: number;
  availableQuantity: number;
  frozenQuantity: number;
  explanation: string;
}

/** 审计追踪：逐订单/成交/持仓解释回测的每一步「为什么」。 */
export interface AuditTrail {
  orders: OrderAuditEntry[];
  fills: FillAuditEntry[];
  positions: PositionAuditEntry[];
}

/** 统一回测结果（可序列化）。 */
export interface BacktestResult {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  /** 数据集版本；未建立版本机制时必须为 undefined，禁止伪造。 */
  datasetVersion?: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalEquity: number;
  /** 冻结后的完整引擎配置（含 CostModel 六字段）。 */
  config: BacktestEngineConfig;
  trades: Trade[];
  equityCurve: EquityPoint[];
  /** 期末持仓。 */
  positions: readonly Position[];
  metrics: Metrics;
  costs: CostSummary;
  executionStats: ExecutionStats;
  audit: AuditTrail;
}

/** 引擎冻结配置（必须能完整复现本次回测；CostModel 六字段 deep-freeze）。 */
export interface BacktestEngineConfig {
  strategyId: string;
  strategyVersion: string;
  initialCapital: number;
  startDate: string;
  endDate: string;
  cost: CostModel;
  executionModel: ExecutionModelId;
  corporateActionMode: CorporateActionMode;
  maxPositions: number;
  maxPositionAmountRatio: number;
  /** 随机种子（确定性模型不消费，仅为未来随机执行模型预留的复现契约）。 */
  seed: number;
  /** 是否启用部分成交。 */
  allowPartialFill: boolean;
  /** 规则开关（T+1 / 涨跌停拦截等）回显。 */
  rules: {
    tPlus1: boolean;
    blockLimitUpBuy: boolean;
    blockLimitDownSell: boolean;
  };
}

/** 回测规范（输入）。 */
export interface BacktestSpec {
  /** 回测运行身份；缺省时由规范确定性派生（可复现）。 */
  runId?: string;
  strategyId: string;
  strategyVersion: string;
  /** 数据集版本；未建立版本机制时必须为 undefined。 */
  datasetVersion?: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  /** 成本模型（六字段）；创建时 deep-freeze。 */
  cost: CostModel;
  /** 执行模型标识或自定义 ExecutionModel。 */
  executionModel: ExecutionModelId | ExecutionModel;
  /** Universe。 */
  universe: Universe;
  /** 停牌解析器（可选，缺省按「无 bar」推断）。 */
  suspensionResolver?: SuspensionResolver;
  /** 公司行为解析器（可选，缺省不应用任何公司行为）。 */
  corporateActionResolver?: CorporateActionResolver;
  /** 市场规则（缺省 A 股默认：T+1、一手 100、板块涨跌停）。 */
  marketRules?: MarketRuleSet;
  /** 执行规则（缺省不拦截涨跌停）。 */
  executionRules?: ExecutionRuleSet;
  maxPositions?: number;
  maxPositionAmountRatio?: number;
  /** 是否允许部分成交（缺省 false：全量成交或拒绝）。 */
  allowPartialFill?: boolean;
  /** 随机种子（缺省 0）。 */
  seed?: number;
  /** 策略信号生成器（纯函数，只允许读取 <= decisionDate 的信息）。 */
  signalGenerator: SignalGenerator;
}

/** 信号生成器（同步、纯函数、确定性）。 */
export interface SignalGenerator {
  (
    date: string,
    portfolio: ReadonlyPortfolioSnapshot,
    data: SignalDataView,
  ): Signal[];
}

/** 信号阶段的数据视图（asOf 过滤，只暴露 <= decisionDate 的 bar）。 */
export interface SignalDataView {
  /** 决策日。 */
  decisionDate: string;
  /** 当前 Universe（只读）。 */
  universe: readonly Security[];
  /** 指定证券截至决策日的可见 bar（升序）；未知/无数据返回 undefined。 */
  bars(securityId: string): readonly CanonicalMarketBar[] | undefined;
}
