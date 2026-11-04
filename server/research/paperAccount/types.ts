/**
 * STEP 23 / C-23.1 — 模拟账户与持仓（Paper Trading Account）：类型契约。
 *
 * 定位与边界（对齐 TASK_TRACKING §3.8 C-23.1）：
 *   C-23.1 只交付「账户/持仓状态机 + 订单/成交/持仓/资金/PnL 的记录模型与更新原语」，
 *   让 Signal/Position/Execution/Risk/Capital/Cost 六维贴近实盘并记录 paper run 的
 *   完整可审计信息。信号→订单→成交→PnL 的**闭环编排属于 C-23.2**，本目录绝不实现。
 *
 * 复用（只读 import，不复制不重写）：
 *   - C-14.3 executionConstraints：ExecutionConstraintDeclaration（约束声明）+
 *     describeExecutionConstraintCoverage（17 轴能力矩阵）+ DEFAULT_LOT_SIZE（一手 100）
 *     + computeExecutionConstraintDeclarationFingerprint（声明指纹）。
 *   - C-14.2 costModel：CostModelDeclaration + computeFillCostBreakdown（五维成本分解）。
 *   - STEP 8 backtest/types：Side / EquityPoint / OrderStatus（订单状态单一来源）。
 *   - STEP 8 marketRules + engine/execution：涨跌停幅度解析与涨跌停价计算口径。
 *   - researchDataset/version：canonicalStringify（指纹序列化）。
 *   - C-16.3 tradeQualityMetrics：TradeQualityEvaluationInput（适配目标，纯映射）。
 *
 * 铁律：
 *   - PIT 安全：账户状态在 asOf(T) 时刻只能由 T 及之前已知信息更新；本目录无任何
 *     市场数据读取，成交价/涨跌停判定所需 open/prevClose/referenceAmount 一律由
 *     调用方注入（asOf === tradeDate 强不变量由调用方保证，本目录校验订单 tradeDate）。
 *   - 确定性：纯函数、readonly 入参；无 Date.now / Math.random / IO；时间戳注入式。
 *   - 指纹防篡改：canonicalStringify（键字典序）+ sha256；serialize/deserialize/validate
 *     round-trip + 篡改拒绝。
 *   - FAIL FAST：资金不足 / 负现金 / 非法订单 / 持仓异常 → 响亮抛错（稳定 error code），
 *     绝不静默 clamp。
 *   - 诚实边界：不做信号生成（注入式 PaperSignalSource）；不做闭环编排（C-23.2）；
 *     对 C-14.3 标 blocker 但账户层可执行的轴（perSecurityEquityCap/totalEquityCap/
 *     buyBanned/sellBanned）如实声明「账户层强制执行」；对账户层仍不能执行的轴
 *     （LIMIT_PRICE / executionModel 时机）如实声明「仅记录，不强制执行」（见 constraints.ts）。
 */

import type { EquityPoint, OrderStatus, Side } from "../../backtest/types";
import type { CostModelDeclaration, FillCostBreakdown } from "../costModel/types";
import type {
  ExecutionConstraintDeclaration,
} from "../executionConstraints/types";
import type { ConstraintCoverageItem } from "../executionConstraints/map";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const PAPER_ACCOUNT_RUN_KIND = "PAPER_ACCOUNT_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const PAPER_ACCOUNT_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 信号来源（注入式记录，不做生成）
// ---------------------------------------------------------------------------

/**
 * 信号来源快照（C-23.1「Signal 维」只记录来源，不做信号生成）。
 * 由调用方（C-23.2 编排 / 策略层）在创建订单时注入；本目录只做不可变记录与追溯。
 */
export interface PaperSignalSource {
  /** 信号身份（可选）。 */
  readonly signalId?: string;
  /** 产生信号的策略身份（可选，用于追溯「结果怎么产生的」）。 */
  readonly strategyId?: string;
  readonly strategyVersion?: string;
  /** 标的。 */
  readonly securityId: string;
  /** 信号方向。 */
  readonly side: Side;
  /** 信号产生时点（YYYY-MM-DD，决策日；只能使用 <= signalTime 的信息）。 */
  readonly signalTime: string;
  /** 信号强度/评分（可选，仅审计）。 */
  readonly score?: number;
  /** 解释性标签（可选）。 */
  readonly reason?: string | null;
}

// ---------------------------------------------------------------------------
// 订单（Paper Account Order）
// ---------------------------------------------------------------------------

/**
 * 模拟订单（贴近实盘的订单记录模型）。
 * 语义与 STEP 8 Order 对齐（status 复用 OrderStatus 单一来源），但不内嵌 STEP 8
 * Signal（signal 来源用 PaperSignalSource 记录）。
 */
export interface PaperAccountOrder {
  readonly orderId: string;
  readonly securityId: string;
  readonly side: Side;
  /** 目标股数（正数；合法性要求 = 100 整数倍，由 checkPaperOrder 校验）。 */
  readonly quantity: number;
  /** 挂单类型：market / limit。 */
  readonly orderType: "market" | "limit";
  /** 限价单委托价；市价单为 null。 */
  readonly requestedPrice: number | null;
  /** 下单日（决策日，YYYY-MM-DD）。 */
  readonly tradeDate: string;
  /** 订单允许成交的最早时点（下一交易日，T+1）。 */
  readonly executionTime: string;
  /** 订单状态（复用 STEP 8 OrderStatus）。 */
  readonly status: OrderStatus;
  /** 来源信号（注入式记录）。 */
  readonly signalSource?: PaperSignalSource;
  /** 执行约束声明引用（声明指纹或 label；审计用途）。 */
  readonly constraintRef?: string;
  /** 订单创建时点（注入式，非真实时钟）。 */
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// 成交（Paper Account Fill）
// ---------------------------------------------------------------------------

/** 成交约束命中/生效快照（回答「这笔成交走了哪些约束」）。 */
export interface PaperFillConstraintHits {
  /** 已生效的约束轴 key（对齐 C-14.3 describeExecutionConstraintCoverage 的 key）。 */
  readonly enforced: readonly string[];
  /** 声明但账户层仅记录、未强制执行的约束轴 key。 */
  readonly recordedOnly: readonly string[];
}

/**
 * 模拟成交（贴近实盘）。费用五维分解复用 C-14.2 FillCostBreakdown；
 * 滑点/冲击由分解记录承载；约束命中情况由 checkPaperOrder 时点写入。
 */
export interface PaperAccountFill {
  readonly fillId: string;
  readonly orderId: string;
  readonly securityId: string;
  readonly side: Side;
  /** 成交股数（100 整数倍）。 */
  readonly quantity: number;
  /** 实际成交价（含滑点，元/股）。 */
  readonly price: number;
  /** 无滑点基准价（如开盘价，元/股）。 */
  readonly basePrice: number;
  /** 成交时点（YYYY-MM-DD）。 */
  readonly timestamp: string;
  /** 五维成本分解（复用 C-14.2）。 */
  readonly cost: FillCostBreakdown;
  /** 成交约束命中/生效快照。 */
  readonly constraintHits: PaperFillConstraintHits;
}

// ---------------------------------------------------------------------------
// 持仓（Paper Account Position）
// ---------------------------------------------------------------------------

/**
 * 模拟持仓（贴近实盘，三态股数对齐 STEP 8 Position：总量 / 可卖 / 冻结 T+1）。
 * 可卖股数受 T+1 冻结约束：availableQuantity + frozenQuantity === quantity。
 */
export interface PaperAccountPosition {
  readonly securityId: string;
  /** 持仓总量（股）。 */
  readonly quantity: number;
  /** 可卖数量（已结算，T+1 后可用）。 */
  readonly availableQuantity: number;
  /** 冻结数量（当日买入，T+1 前不可卖）。 */
  readonly frozenQuantity: number;
  /** 加权平均买入成本价（含滑点，不含费用/冲击，对齐 STEP 8 PositionBook）。 */
  readonly averageEntryPrice: number;
  /** 总成本基（含费用与冲击，用于已实现/未实现盈亏结转）。 */
  readonly totalCostBasis: number;
  /** 最近估值价（mark-to-market 写入；无则 null）。 */
  readonly marketPrice: number | null;
  /** 持仓市值 = marketPrice × quantity（无估值价时回退成本）。 */
  readonly marketValue: number;
  /** 未实现盈亏 = marketValue − totalCostBasis。 */
  readonly unrealizedPnL: number;
  /** 该持仓累计已实现盈亏（减仓/清仓结转）。 */
  readonly realizedPnL: number;
}

// ---------------------------------------------------------------------------
// 模拟账户（Paper Account）
// ---------------------------------------------------------------------------

/**
 * 模拟账户（不可变状态核心）。
 * 会计恒等式：equity === cash + frozen + Σ position.marketValue。
 * frozen = 已下单未成交买单的预留资金（冻结资金），equity 不因冻结而变。
 */
export interface PaperAccount {
  /** 账户标识（审计用途）。 */
  readonly accountId: string;
  /** 初始资金（元，>0）。 */
  readonly initialCapital: number;
  /** 可用现金（元，不含冻结；恒 >= 0）。 */
  readonly cash: number;
  /** 冻结资金（元，挂单买单预留；>= 0）。 */
  readonly frozen: number;
  /** 持仓列表（按 securityId 升序，确定性）。 */
  readonly positions: readonly PaperAccountPosition[];
  /** 累计已实现盈亏（元）。 */
  readonly realizedPnL: number;
  /** 总权益（元）= cash + frozen + Σ marketValue。 */
  readonly equity: number;
  /** 交易日锚定（YYYY-MM-DD，asOf === tradeDate 强不变量由调用方保证）。 */
  readonly asOf: string;
}

// ---------------------------------------------------------------------------
// 持仓快照 / 现金账本 / PnL 分解
// ---------------------------------------------------------------------------

/** 持仓快照（某交易日收盘时点的账户截面，供 paper run 记录）。 */
export interface PaperAccountPositionSnapshot {
  /** 快照时点（YYYY-MM-DD）。 */
  readonly asOf: string;
  /** 现金。 */
  readonly cash: number;
  /** 冻结资金。 */
  readonly frozen: number;
  /** 持仓市值合计。 */
  readonly marketValue: number;
  /** 总权益。 */
  readonly equity: number;
  /** 该时点持仓列表（升序）。 */
  readonly positions: readonly PaperAccountPosition[];
}

/** 现金账本条目种类（每笔资金变动可追溯）。 */
export type PaperCashLedgerEntryKind =
  | "INITIAL_DEPOSIT" // 初始入金
  | "BUY_CASH_OUT" // 买入现金流出（成交额 + 费用 + 冲击）
  | "SELL_CASH_IN" // 卖出现金流入（成交额 − 费用 − 冲击）
  | "FREEZE" // 冻结资金（买单预留）
  | "UNFREEZE" // 解冻资金
  | "CASH_ADJUSTMENT"; // 其它现金调整（预留）

/** 现金账本条目（每笔资金变动可追溯，balanceAfter 为变动后可用现金余额）。 */
export interface PaperCashLedgerEntry {
  /** 条目身份。 */
  readonly entryId: string;
  /** 交易日（YYYY-MM-DD）。 */
  readonly asOf: string;
  /** 变动种类。 */
  readonly kind: PaperCashLedgerEntryKind;
  /** 变动金额（元；正 = 流入，负 = 流出）。 */
  readonly amount: number;
  /** 变动后可用现金余额（元）。 */
  readonly balanceAfter: number;
  /** 关联订单/成交（可选）。 */
  readonly orderId?: string;
  readonly fillId?: string;
  /** 说明（审计用途）。 */
  readonly description: string;
}

/** PnL 分解（贴合 STEP 8 CostSummary 语义 + C-14.2 冲击）。 */
export interface PaperPnlBreakdown {
  /** 累计已实现盈亏。 */
  readonly realizedPnL: number;
  /** 期末未实现盈亏。 */
  readonly unrealizedPnL: number;
  /** 毛盈亏（纯价格差，不含费用/滑点/冲击）。 */
  readonly grossPnl: number;
  /** 现金费用合计（佣金 + 印花税 + 过户费 + 其它）。 */
  readonly totalFees: number;
  /** 滑点合计（有符号口径，见 C-14.2）。 */
  readonly slippage: number;
  /** 市场冲击合计（有符号口径，见 C-14.2）。 */
  readonly marketImpact: number;
  /** 总摩擦成本（恒非负）= |slippage| + totalFees + |marketImpact|。 */
  readonly totalCostDrag: number;
}

// ---------------------------------------------------------------------------
// Paper Account Run（paper run 完整记录）
// ---------------------------------------------------------------------------

/**
 * 一次 paper trading run 的不可变总记录（C-23.1 交付的「paper run 完整可审计信息」）。
 * 含 run id / version / dataset·strategy 引用 / 初始资金 / 成本·执行声明指纹 /
 * 订单流 / 成交流 / 持仓快照 / 现金账本 / 权益曲线 / PnL 分解 / sha256 指纹 / createdAt 注入。
 */
export interface PaperAccountRun {
  readonly recordKind: typeof PAPER_ACCOUNT_RUN_KIND;
  readonly recordVersion: typeof PAPER_ACCOUNT_RUN_RECORD_VERSION;

  /** run 身份。 */
  readonly runId: string;
  /** 创建时点（注入式）。 */
  readonly createdAt: string;

  /** 数据集/策略引用（可选，缺省显式 undefined，不伪造）。 */
  readonly datasetVersion?: string;
  readonly strategyId?: string;
  readonly strategyVersion?: string;

  /** 初始资金。 */
  readonly initialCapital: number;

  /** 成本模型声明指纹（C-14.2 声明经 canonicalStringify + sha256）。 */
  readonly costDeclarationFingerprint: string;
  /** 执行约束声明指纹（复用 C-14.3 computeExecutionConstraintDeclarationFingerprint）。 */
  readonly executionDeclarationFingerprint: string;
  /** C-14.3 17 轴能力矩阵快照（逐轴可执行性，诚实 blocker）。 */
  readonly executionCoverage: readonly ConstraintCoverageItem[];

  /** 订单流（按 createdAt/tradeDate 升序）。 */
  readonly orders: readonly PaperAccountOrder[];
  /** 成交流（按 timestamp 升序）。 */
  readonly fills: readonly PaperAccountFill[];
  /** 持仓快照序列（按 asOf 升序）。 */
  readonly positionSnapshots: readonly PaperAccountPositionSnapshot[];
  /** 现金账本（按 asOf/entryId 升序）。 */
  readonly cashLedger: readonly PaperCashLedgerEntry[];
  /** 权益曲线（复用 STEP 8 EquityPoint，供 C-16.3 消费）。 */
  readonly equityCurve: readonly EquityPoint[];
  /** PnL 分解。 */
  readonly pnlBreakdown: PaperPnlBreakdown;

  /** 内容指纹（sha256 十六进制）：除本字段外全部字段的确定性 JSON 摘要。 */
  readonly fingerprint: string;
}
