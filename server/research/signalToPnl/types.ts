/**
 * STEP 23 / C-23.2 — 信号→订单→成交→PnL 闭环编排：类型契约。
 *
 * 定位与边界（对齐 TASK_TRACKING §3.8 C-23.2）：
 *   本目录交付「信号→订单→成交→PnL」的多日编排器，把 C-13.2 候选记录 →
 *   C-23.1 模拟账户状态机 → C-14.3 执行约束声明 → C-14.2 成本声明 → 行级行情快照
 *   串成一份带指纹的 SignalToPnlRun 不可变总记录，并向下游 C-16.3 提供映射接口。
 *   本目录**只做编排**，账户状态机/约束检查/成本分解全部只读复用既有原子函数。
 *
 * 复用（只读 import，不复制不重写）：
 *   - C-13.2 signalEngine：CandidateEvaluationRun / CandidateDayRecord（信号来源）；
 *   - C-23.1 paperAccount：PaperAccount + 8 个原语 + checkPaperOrder + 约束能力矩阵；
 *   - C-14.2 costModel：CostModelDeclaration + computeFillCostBreakdown；
 *   - C-14.3 executionConstraints：ExecutionConstraintDeclaration + 17 轴能力矩阵
 *     + DEFAULT_LOT_SIZE + computeExecutionConstraintDeclarationFingerprint；
 *   - C-14.1 simulator/plan.ts：planDecisionDay（候选意图 → 订单映射，hold-while-selected
 *     longOnly 进出场，与本编排共享同一计划语义，绝不重写）。
 *   - researchDataset/version：canonicalStringify（指纹序列化）。
 *
 * PIT 纪律（编排层核心不变量）：
 *   - 决策日 D 的订单 executionTime = D 的下一交易日 D+1（持仓 D+1 才可卖）；
 *   - D+1 是执行日，成交价严格取 D+1 open（不取 D close，避免 look-ahead）；
 *   - 价格/成交额全部由调用方 priceSource 注入式提供，编排层**绝不读 dataset / data 源**；
 *   - 账户 asOf === 当前交易日（settlePaperAccountT1/applyPaperBuyFill 自动推进）。
 *
 * 铁律：纯函数、readonly 入参、无 Date.now/Math.random/IO；非法输入抛
 * SignalToPnlError（稳定 code），绝不静默 clamp。
 */

import type { Side } from "../../backtest/types";
import type {
  PaperAccount,
  PaperAccountFill,
  PaperAccountOrder,
  PaperAccountPositionSnapshot,
  PaperAccountRun,
  PaperCashLedgerEntry,
  PaperPnlBreakdown,
} from "../paperAccount/types";
import type {
  ExecutionConstraintDeclaration,
} from "../executionConstraints/types";
import type { CostModelDeclaration } from "../costModel/types";
import type { ConstraintCoverageItem } from "../executionConstraints/map";
import type { CandidateEvaluationRun } from "../signalEngine/types";
import type { SkippedIntentEntry } from "../simulator/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const SIGNAL_TO_PNL_RUN_KIND = "SIGNAL_TO_PNL_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const SIGNAL_TO_PNL_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 行级价格快照（PIT 数据源接口）
// ---------------------------------------------------------------------------

/**
 * 单个 (tradeDate, securityId) 行级价格快照。
 *
 * 字段语义（必须由调用方按 PIT 纪律注入）：
 *   - open：执行日开盘价；用于 buy/sell 成交报价；
 *   - prevClose：执行日前一交易日收盘价；用于涨跌停判定（对齐 STEP 8 limitState）；
 *   - close：当日收盘价；用于 mark-to-market 与决策日预算分摊；
 *   - amount：当日成交额（千元）；用于市场冲击 / 滑点分层参考，可为 null。
 *
 * 任一字段缺失/无效 → 对应拒绝路径（停牌/无行情由 checkPaperOrder 显式拒绝）。
 */
export interface PnlLoopPriceSnapshot {
  readonly open: number | null;
  readonly prevClose: number | null;
  readonly close: number | null;
  readonly amount: number | null;
}

/**
 * 价格源回调：编排层调用 (date, securityId) → snapshot 取得该日该标的市场数据。
 *
 * 返回 null 表示当日该标的停牌/无 bar，编排层据此判定订单 SUSPENDED 拒绝。
 *
 * 编排层**绝不缓存**价格源返回值：调用方负责保证 (date, securityId) 的 PIT 一致性
 * （asOf === tradeDate 强不变量由调用方保证），编排层内部仅为性能做确定性格局化。
 */
export type PnlLoopPriceSource = (
  date: string,
  securityId: string
) => PnlLoopPriceSnapshot | null;

// ---------------------------------------------------------------------------
// 信号选择器（默认 = 全部 long 意图；调用方可注入自定义筛选）
// ---------------------------------------------------------------------------

/**
 * 信号选择器：把决策日的 PositionIntent[] 投影为「将被送入 planDecisionDay 的意图子集」。
 *
 * 默认行为（不提供 selector 时）：过滤 direction === "long"（planDecisionDay 本身也做
 * 此过滤，但本层先做可让 skipped 归到本编排而非混到 planDecisionDay 输出中——便于
 * 区分「编排层拒绝（NON_LONG_DIRECTION）」与「计划层拒绝」。
 */
export type PnlLoopSignalSelector = (
  decisionDate: string,
  intents: ReadonlyArray<import("../framework/contract").PositionIntent>
) => ReadonlyArray<import("../framework/contract").PositionIntent>;

// ---------------------------------------------------------------------------
// 来源引用（C-13.2 → C-23.2 链路的版本/指纹追溯）
// ---------------------------------------------------------------------------

/** 来源候选记录的追溯摘要（不内嵌整份 CandidateEvaluationRun，节省空间）。 */
export interface PnlLoopSourceRef {
  /** C-13.2 候选运行指纹（sha256，hex）。 */
  readonly sourceCandidateFingerprint: string;
  /** 数据集版本（与 sourceRun.datasetVersion 一致）。 */
  readonly datasetVersion: string;
  /** 策略身份（与 sourceRun.strategyId 一致）。 */
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 候选决策窗口起止日（与 sourceRun.dateRange 一致）。 */
  readonly sourceDateRange: { readonly startDate: string; readonly endDate: string };
  /** 候选决策日总数（= sourceRun.days.length）。 */
  readonly sourceDecisionDayCount: number;
}

// ---------------------------------------------------------------------------
// 主输入
// ---------------------------------------------------------------------------

/**
 * SignalToPnl 编排器输入。
 *
 * @param sourceRun          C-13.2 候选运行记录（必须 point=close，结构校验 + 指纹复核）
 * @param initialAccount     C-23.1 起始模拟账户（asOf 必须 < tradingCalendar[0]）
 * @param costDeclaration    C-14.2 成本声明
 * @param executionDeclaration C-14.3 执行约束声明
 * @param tradingCalendar    升序交易日序列（窗口 ⊆ sourceRun.dateRange）
 * @param priceSource        PIT 行级价格源（open/prevClose/close/amount）
 * @param signalSelector     可选信号筛选器；缺省 = 全部 long 意图
 * @param runId              此次 paper run 身份
 * @param accountId          账户身份（用于 ledger/accountId 引用）
 * @param createdAt          注入式时间戳（确定性，不读真实时钟）
 */
export interface SignalToPnlLoopInput {
  readonly runId: string;
  readonly accountId: string;
  readonly createdAt: string;
  readonly sourceRun: CandidateEvaluationRun;
  readonly initialAccount: PaperAccount;
  readonly costDeclaration: CostModelDeclaration;
  readonly executionDeclaration: ExecutionConstraintDeclaration;
  readonly tradingCalendar: readonly string[];
  readonly priceSource: PnlLoopPriceSource;
  readonly signalSelector?: PnlLoopSignalSelector;
}

// ---------------------------------------------------------------------------
// 中间态产物（loop 内每步产出的不可变记录）
// ---------------------------------------------------------------------------

/**
 * 待成交订单（决策日提交，executionTime = 下一交易日）。
 * 编排层内部状态；不进总记录字段（订单本体已写入 PaperAccountRun.orders）。
 */
export interface PnlLoopPendingOrder {
  readonly order: PaperAccountOrder;
  /** 决策日（信号产生日）。 */
  readonly decisionDate: string;
  /** 订单批准时刻冻结的资金金额（仅 buy 订单；>0，应用于成交/拒绝时解冻）。 */
  readonly frozenAmount: number;
  /** 决策日成交额（千元），用于成交价滑点分层。 */
  readonly referenceAmount: number | null;
}

/**
 * 拒绝条目（执行日未能成交的订单原因）。
 */
export interface PnlLoopRejectionEntry {
  readonly orderId: string;
  readonly securityId: string;
  readonly side: Side;
  readonly decisionDate: string;
  readonly executionDate: string;
  readonly rejectionCode: string;
  readonly reason: string;
}

/**
 * 单决策日产物（信号→订单）。
 */
export interface PnlLoopDayDecision {
  readonly decisionDate: string;
  /** 当日由 selector 选中的意图数（long only 过滤后）。 */
  readonly selectedIntentCount: number;
  /** 计划层生成的订单数（sell 在前、buy 在后）。 */
  readonly orderCount: number;
  /** 当日决策产生的 buy 订单冻结金额合计。 */
  readonly totalFrozenAmount: number;
  /** 跳过的意图（来自 planDecisionDay.skipped，本编排原样透传）。 */
  readonly skipped: readonly SkippedIntentEntry[];
  /** 新挂的 buy 订单 ID 集合（便于 loop 调试与追溯）。 */
  readonly newOrderIds: readonly string[];
}

/**
 * 单执行日产物（订单→成交）。
 */
export interface PnlLoopDayExecution {
  readonly executionDate: string;
  /** 待执行订单数。 */
  readonly dueOrderCount: number;
  /** 实际成交数。 */
  readonly fillCount: number;
  /** 拒绝数。 */
  readonly rejectionCount: number;
  /** 该执行日新产生的成交 ID。 */
  readonly newFillIds: readonly string[];
  /** 该执行日新产生的拒绝条目。 */
  readonly newRejections: readonly PnlLoopRejectionEntry[];
}

/**
 * 单日 mark-to-market 产物（每交易日结束点账户截面 + 权益点）。
 */
export interface PnlLoopDayMark {
  readonly tradeDate: string;
  /** 收盘后权益（= account.equity）。 */
  readonly equity: number;
  /** 收盘后可用现金（= account.cash）。 */
  readonly cash: number;
  /** 收盘后冻结资金（= account.frozen）。 */
  readonly frozen: number;
  /** 收盘后持仓市值（= Σ marketValue）。 */
  readonly marketValue: number;
  /** 收盘后累计已实现盈亏（= account.realizedPnL）。 */
  readonly realizedPnL: number;
}

// ---------------------------------------------------------------------------
// 总记录
// ---------------------------------------------------------------------------

/**
 * 一次 signal → PnL 闭环编排的不可变总记录（C-23.2 交付物）。
 *
 * 字段语义：
 *   - sourceRef / sourceFingerprint：C-13.2 候选链路引用（版本/指纹对账）；
 *   - declarations 指纹 + 能力矩阵快照：对齐 C-23.1 PaperAccountRun 的双声明指纹范式；
 *   - days：逐决策日编排日志（信号→订单）；
 *   - executions：逐执行日编排日志（订单→成交/拒绝）；
 *   - dailyMarks：逐交易日 mark-to-market 产物（含权益曲线点数据）；
 *   - orders / fills / snapshots / cashLedger / equityCurve / pnlBreakdown：
 *     全部来自 C-23.1 状态机 + 6 个原语的累加结果（不重算）；
 *   - frozenTimeline：每交易日末冻结金额合计（便于审计冻结/解冻的生命周期）；
 *   - rejectionSummary：按 rejectionCode 聚合的拒绝计数；
 *   - rejectionLedger：扁平拒绝条目（升序 by executionDate）；
 *   - stats：累计统计（信号/订单/成交/拒绝/部分成交）；
 *   - fingerprint：sha256 内容指纹（除本字段外全部字段的 deterministic JSON 摘要）。
 *
 * 不可变性：所有字段 readonly；总记录由 serialize 进一步深冻结。
 */
export interface SignalToPnlRun {
  readonly recordKind: typeof SIGNAL_TO_PNL_RUN_KIND;
  readonly recordVersion: typeof SIGNAL_TO_PNL_RUN_RECORD_VERSION;

  /** run 身份。 */
  readonly runId: string;
  readonly accountId: string;
  /** 创建时点（注入式）。 */
  readonly createdAt: string;

  // 来源引用
  readonly sourceRef: PnlLoopSourceRef;
  /** 来源候选记录的指纹（与 sourceRef.sourceCandidateFingerprint 一致，独立字段便于下游指纹对账）。 */
  readonly sourceFingerprint: string;

  // 声明指纹与能力矩阵（对齐 C-23.1）
  readonly costDeclarationFingerprint: string;
  readonly executionDeclarationFingerprint: string;
  readonly executionCoverage: readonly ConstraintCoverageItem[];

  // 初始账户
  readonly initialCapital: number;
  readonly initialAsOf: string;

  // 窗口与统计
  readonly tradingCalendar: readonly string[];
  readonly tradingDayCount: number;
  readonly decisionDayCount: number;

  // 编排日志
  readonly days: readonly PnlLoopDayDecision[];
  readonly executions: readonly PnlLoopDayExecution[];
  readonly dailyMarks: readonly PnlLoopDayMark[];

  // 累加产物（来自 C-23.1 原语）
  readonly orders: readonly PaperAccountOrder[];
  readonly fills: readonly PaperAccountFill[];
  readonly positionSnapshots: readonly PaperAccountPositionSnapshot[];
  readonly cashLedger: readonly PaperCashLedgerEntry[];
  readonly equityCurve: readonly import("../../backtest/types").EquityPoint[];
  readonly pnlBreakdown: PaperPnlBreakdown;

  // 编排层自有审计字段
  readonly frozenTimeline: readonly { readonly tradeDate: string; readonly frozen: number }[];
  readonly rejectionSummary: Readonly<Record<string, number>>;
  readonly rejectionLedger: readonly PnlLoopRejectionEntry[];
  readonly stats: PnlLoopStats;

  /** 内容指纹（sha256 十六进制）。 */
  readonly fingerprint: string;
}

/**
 * 编排层统计（信号→订单→成交→PnL 全链路计数）。
 */
export interface PnlLoopStats {
  /** C-13.2 总意图数（按 sourceRun.days 累计 positionIntents.length）。 */
  readonly totalIntents: number;
  /** 经 signalSelector 筛后的意图数。 */
  readonly selectedIntents: number;
  /** 决策日产生的总订单数（含 sell 与 buy）。 */
  readonly totalOrders: number;
  /** 实际成交的订单数。 */
  readonly totalFills: number;
  /** 拒绝的订单数。 */
  readonly totalRejections: number;
  /** 累计冻结金额峰值（决策日 buy 订单冻结资金历史最大值）。 */
  readonly peakFrozenAmount: number;
  /** 期末冻结金额（最后一个交易日 account.frozen）。 */
  readonly finalFrozenAmount: number;
  /** 期末未实现盈亏（= 期末持仓 Σ unrealizedPnL）。 */
  readonly finalUnrealizedPnL: number;
  /** 期末已实现盈亏（= account.realizedPnL）。 */
  readonly finalRealizedPnL: number;
}

// ---------------------------------------------------------------------------
// 适配类型
// ---------------------------------------------------------------------------

/**
 * C-23.2 → C-23.1 记录视图（只读投影）。
 * 提供「C-23.2 run → PaperAccountRun 等价数据」用于 C-23.1 toTradeQualityEvaluationInput
 * 适配。本类型不创建独立字段，仅做编译期引用。
 */
// 当前实现里，C-23.2 直接组装等价于 PaperAccountRun 的数据再交给
// `toTradeQualityEvaluationInput`，不暴露独立类型；保留此注释避免后续误解。
export type _SignalToPnlRunAsPaperAccountView = PaperAccountRun;