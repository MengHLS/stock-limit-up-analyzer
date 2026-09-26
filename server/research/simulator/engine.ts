/**
 * STEP 14 / C-14.1 — 交易模拟核心：多日编排引擎（engine）。
 *
 * 数据流（对 C-13.2 候选记录 + ResearchDataset 做多日交易模拟）：
 *
 *   CandidateEvaluationRun（决策日收盘产出的 PositionIntent）
 *     → 交易日历（dataset universeDays ∩ 模拟窗口）
 *     → 预检（来源记录指纹 / datasetVersion / 决策时点 / (date,securityId) 行齐全）
 *     → 逐日：settle(T+1) → 处理当日到期订单（执行模型报价 + Portfolio 约束裁决）
 *       → 收盘决策（planDecisionDay：hold-while-selected 进出场）→ 权益点
 *     → finalizeOpenTrades → Trade[] / EquityPoint[] / AuditTrail → TradeSimulationRun
 *
 * 复用之墙（重要）：
 *   - 本层只做编排；T+1 持仓账本（PositionBook/Portfolio.settle）、成交约束
 *     （整手/现金/持仓上限/加仓拒绝/部分成交裁决）、执行模型（NEXT_OPEN 等报价 +
 *     涨跌停拦截）、成本（佣金/印花税/过户费/滑点）全部复用 STEP 8 backtest
 *     既有实现（portfolio.ts / execution.ts / cost.ts / marketRules.ts / audit.ts），
 *     不复制不修改 backtest 既有文件；
 *   - 不复用 runBacktestEngine2 主循环的原因（C-14.1 设计决策）：其 SignalGenerator
 *     契约只暴露 openPositionSymbols（无每股可卖数），无法表达研究链「候选退出 =
 *     卖出全部可卖份额」的精确股数，本层改为直接查询 Portfolio.available(securityId)
 *     的薄编排，形态不匹配故不在既有文件内打补丁。
 *
 * 铁律：
 *   - 确定性：无 Date.now / Math.random / IO；pending/订单/成交号严格递增；
 *   - FAIL FAST：来源记录指纹不匹配 / datasetVersion 不一致 / 决策时点非 close /
 *     窗口为空 / 缺 (tradeDate, securityId) 行 / 计划缺价，一律结构化抛错；
 *   - 结果不可变、可 JSON 序列化、sha256 指纹防篡改。
 */

import type { CostModel } from "../../engine/domain";
import type { CanonicalMarketBar } from "../../data/types";
import type { ResearchDatasetRow } from "../../researchDataset/types";
import { computeTradeCost, slippageAmount } from "../../backtest/cost";
import {
  DEFAULT_EXECUTION_RULES,
  DEFAULT_MARKET_RULES,
  resolveExecutionRuleContext,
} from "../../backtest/marketRules";
import { createExecutionModel } from "../../backtest/execution";
import { limitDownPrice, validPrice } from "../../engine/execution";
import { Portfolio } from "../../backtest/portfolio";
import { AuditLog, fillAuditEntry } from "../../backtest/audit";
import { bindResearchDataset } from "../datasetAccess/handle";
import { rowToCanonicalBar } from "../datasetAccess/bars";
import type { PositionIntent } from "../framework/contract";
import type {
  EquityPoint,
  Order,
  RejectionReason,
  Security,
  Side,
  TradeCost,
} from "../../backtest/types";
import {
  assertValidCandidateEvaluationRun,
  computeCandidateEvaluationRunFingerprint,
} from "../signalEngine";
import { planDecisionDay, type PlannedOrder } from "./plan";
import { computeTradeSimulationRunFingerprint } from "./serialize";
import { assertValidSimulationConfig } from "./validate";
import type {
  PlanSkipCode,
  SecurityBoard,
  SimulationConfig,
  SimulationConfigSnapshot,
  SkippedIntentEntry,
  TradeSimulationInput,
  TradeSimulationRun,
} from "./types";
import {
  TRADE_SIMULATION_RUN_RECORD_KIND,
  TRADE_SIMULATION_RUN_RECORD_VERSION,
} from "./types";
// PARAMETER-001-PRE — 性能剖析（默认关闭；`PARAM_PROFILE=1` 才生效）。
import { perfBegin, perfCount, perfEnd, perfRun } from "../../observability";

// ---------------------------------------------------------------------------
// 引擎错误（code 稳定，供程序化处理）
// ---------------------------------------------------------------------------

/** 交易模拟通用错误。 */
export class TradeSimulationError extends Error {
  /** 稳定错误码（非自由文本）。 */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TradeSimulationError";
    this.code = code;
  }
}

/** 数据集/候选记录缺少某 (tradeDate, securityId) 行：逐日 PIT 面板不变量破坏。 */
export class MissingSimulationRowError extends TradeSimulationError {
  readonly tradeDate: string;
  readonly securityId: string;

  constructor(tradeDate: string, securityId: string) {
    super(
      "MISSING_DATASET_ROW",
      `交易模拟：数据集缺行（${tradeDate}, ${securityId}）——决策日长仓候选必须有当日行` +
        `（收盘价用于估量买入股数），禁止以历史/未来行静默替代`
    );
    this.tradeDate = tradeDate;
    this.securityId = securityId;
  }
}

/** 模拟窗口内无交易日或无参与决策的候选日。 */
export class EmptySimulationWindowError extends TradeSimulationError {
  constructor(message: string) {
    super("EMPTY_SIMULATION_WINDOW", message);
  }
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(value: string, label: string): void {
  if (!DATE_RE.test(value)) {
    throw new TradeSimulationError(
      "INVALID_DATE",
      `${label}（${value}）不是 YYYY-MM-DD`
    );
  }
}

/** 深冻结（引擎产物不可变）。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** 在按 (tradeDate, securityId) 升序的 rows 上二分定位某日期连续区段。 */
function dateRowRange(
  rows: readonly ResearchDatasetRow[],
  date: string
): { start: number; end: number } {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid]!.tradeDate < date) low = mid + 1;
    else high = mid;
  }
  const start = low;
  high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid]!.tradeDate === date) low = mid + 1;
    else high = mid;
  }
  return { start, end: low };
}

/** 决策日索引：date → 当日 PositionIntent（只读引用）。 */
function buildDecisionDayIndex(
  sourceRun: TradeSimulationInput["sourceRun"]
): ReadonlyMap<string, readonly PositionIntent[]> {
  const index = new Map<string, readonly PositionIntent[]>();
  for (const day of sourceRun.days) {
    index.set(day.date, day.positionIntents);
  }
  return index;
}

/** 规范化执行规则。 */
function resolveExecutionRules(config: SimulationConfig): {
  blockLimitUpBuy: boolean;
  blockLimitDownSell: boolean;
} {
  return {
    blockLimitUpBuy:
      config.executionRules?.blockLimitUpBuy ??
      DEFAULT_EXECUTION_RULES.blockLimitUpBuy,
    blockLimitDownSell:
      config.executionRules?.blockLimitDownSell ??
      DEFAULT_EXECUTION_RULES.blockLimitDownSell,
  };
}

/** 装配可序列化执行假设快照。 */
function buildConfigSnapshot(
  config: SimulationConfig,
  dateRange: { startDate: string; endDate: string }
): SimulationConfigSnapshot {
  const executionRules = resolveExecutionRules(config);
  return {
    ...(config.name !== undefined ? { name: config.name } : {}),
    dateRange,
    initialCapital: config.initialCapital,
    cost: config.cost,
    executionModel: config.executionModel ?? "NEXT_OPEN",
    maxPositions: config.maxPositions ?? null,
    maxDailyBuys: config.maxDailyBuys ?? null,
    directionPolicy: config.directionPolicy ?? "longOnly",
    executionRules,
    allowPartialFill: config.allowPartialFill ?? false,
    exitPolicy: {
      stopLossRatio: config.exitPolicy?.stopLossRatio ?? null,
      takeProfitRatio: config.exitPolicy?.takeProfitRatio ?? null,
      maxHoldingDays: config.exitPolicy?.maxHoldingDays ?? null,
    },
    tPlus1: DEFAULT_MARKET_RULES.tPlus1,
    lotSize: config.cost.lotSize > 0 ? Math.floor(config.cost.lotSize) : 1,
    decisionPoint: "close",
    entryExitModel: "HOLD_WHILE_SELECTED_LONG_ONLY_CASH_BUDGET",
    corporateActions: config.corporateActionResolver === undefined ? "NOT_APPLIED" : "APPLIED",
  };
}

/** 深拷贝并冻结一份可序列化快照（不冻结调用方入参）。 */
function frozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

/** 待成交订单（executionTime = 下一交易日）。 */
interface PendingOrder {
  readonly orderId: string;
  readonly securityId: string;
  /** 决策日（信号产生日）。 */
  readonly tradeDate: string;
  readonly side: Side;
  readonly quantity: number;
  readonly executionTime: string;
  /** 决策日成交额（千元），成交时点前已知（滑点分层）。 */
  readonly referenceAmount: number | null;
  /** 退出原因；buy 为 null。 */
  readonly exitReason: string | null;
}

const REJECTION_NOTES: Partial<Record<RejectionReason, string>> = {
  LIMIT_UP: "开盘触及涨停，拒绝买入（blockLimitUpBuy）",
  LIMIT_DOWN: "开盘触及跌停，拒绝卖出（blockLimitDownSell）",
  NO_LIQUIDITY: "当日无有效价格，视为无法成交",
  INSUFFICIENT_CASH: "现金不足以全额成交",
  T_PLUS_1: "T+1 可卖份额不足",
};

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 运行多日交易模拟，产出不可变、可审计的 TradeSimulationRun。
 *
 * @param input.dataset ResearchDataset（只读；datasetVersion 必须与 sourceRun 一致）
 * @param input.sourceRun C-13.2 候选运行记录（结构校验 + 指纹复核）
 * @param input.simConfig 执行假设（窗口/资金/成本/执行模型/涨跌停拦截等）
 */
export function runTradeSimulation(
  input: TradeSimulationInput
): TradeSimulationRun {
  const { dataset, sourceRun, simConfig } = input;

  // 1. 输入形态校验（FAIL FAST）。
  assertValidSimulationConfig(simConfig);
  assertValidCandidateEvaluationRun(sourceRun);
  if (sourceRun.recordKind !== "CANDIDATE_EVALUATION_RUN") {
    throw new TradeSimulationError(
      "SOURCE_KIND_INVALID",
      `来源记录 recordKind=${sourceRun.recordKind} 不是 CANDIDATE_EVALUATION_RUN`
    );
  }
  const recomputedFingerprint =
    computeCandidateEvaluationRunFingerprint(sourceRun);
  if (sourceRun.fingerprint !== recomputedFingerprint) {
    throw new TradeSimulationError(
      "SOURCE_FINGERPRINT_MISMATCH",
      `来源候选记录指纹不匹配：内容已被篡改或退化（期望 ${recomputedFingerprint}，实际 ${sourceRun.fingerprint}）`
    );
  }

  // 2. 决策时点：交易模拟只支持「决策日收盘 → 次一交易日执行」语义。
  if (sourceRun.point !== "close") {
    throw new TradeSimulationError(
      "UNSUPPORTED_DECISION_POINT",
      `来源候选记录决策时点 point=${sourceRun.point}；交易模拟要求 close` +
        `（候选在决策日收盘后可知，订单最早可执行时点为下一交易日）`
    );
  }

  // 3. dataset 绑定 + 版本一致性（datasetVersion 内容寻址，必须与来源记录一致）。
  const handle = perfRun("backtest.dataset_bind", () => bindResearchDataset(dataset));
  if (handle.datasetVersion !== sourceRun.datasetVersion) {
    throw new TradeSimulationError(
      "DATASET_VERSION_MISMATCH",
      `模拟数据集版本 ${handle.datasetVersion} 与来源候选记录 datasetVersion=${sourceRun.datasetVersion} 不一致；` +
        `禁止用错误版本数据集回测候选记录`
    );
  }

  // 4. 模拟窗口解析（缺省 = 来源候选 dateRange），必须 ⊆ 数据集窗口。
  const requestedRange = simConfig.dateRange ?? {
    startDate: sourceRun.dateRange.startDate,
    endDate: sourceRun.dateRange.endDate,
  };
  assertValidDate(requestedRange.startDate, "simConfig.dateRange.startDate");
  assertValidDate(requestedRange.endDate, "simConfig.dateRange.endDate");
  if (requestedRange.startDate > requestedRange.endDate) {
    throw new TradeSimulationError(
      "SIM_RANGE_REVERSED",
      `模拟窗口倒序 startDate(${requestedRange.startDate}) > endDate(${requestedRange.endDate})`
    );
  }
  if (
    requestedRange.startDate < handle.startDate ||
    requestedRange.endDate > handle.endDate
  ) {
    throw new TradeSimulationError(
      "SIM_RANGE_OUT_OF_DATASET",
      `模拟窗口 [${requestedRange.startDate}, ${requestedRange.endDate}] 超出数据集窗口 ` +
        `[${handle.startDate}, ${handle.endDate}]（闭区间）；越界日期无行，禁止以部分数据集冒充全窗口`
    );
  }

  // 5. 模拟交易日序列（升序）+ 决策日索引。
  const tradingDates: string[] = [];
  for (const day of handle.universeDays) {
    if (!day.isTradingDay) continue;
    if (day.tradeDate < requestedRange.startDate) continue;
    if (day.tradeDate > requestedRange.endDate) break;
    tradingDates.push(day.tradeDate);
  }
  if (tradingDates.length === 0) {
    throw new EmptySimulationWindowError(
      `模拟窗口 [${requestedRange.startDate}, ${requestedRange.endDate}] 内无交易日`
    );
  }
  const decisionIndex = buildDecisionDayIndex(sourceRun);
  const decisionDates = tradingDates.filter(date => decisionIndex.has(date));
  if (decisionDates.length === 0) {
    throw new EmptySimulationWindowError(
      `模拟窗口 [${requestedRange.startDate}, ${requestedRange.endDate}] 与来源候选记录决策日无交集，无法驱动任何交易`
    );
  }

  // 6. 行齐全预检：每个参与决策的候选日的每个 long 意图必须有当日行。
  //    （卖出依赖持仓，不需要当日行；涨停/停牌等在执行日由无行/报价拒绝显式化。）
  const rowsDateSet = new Set<string>();
  const rowKeys = new Set<string>();
  const __btPrecheck = perfBegin("backtest.row_precheck");
  for (const row of handle.rows) {
    rowsDateSet.add(row.tradeDate);
    rowKeys.add(`${row.tradeDate}\u0000${row.securityId}`);
  }
  for (const date of decisionDates) {
    const intents = decisionIndex.get(date) ?? [];
    if (intents.length === 0) continue;
    if (!rowsDateSet.has(date)) {
      throw new TradeSimulationError(
        "DECISION_DAY_NO_ROWS",
        `交易模拟：决策日 ${date} 为交易日但日期切片内无任何行，数据集在该日缺失`
      );
    }
    for (const intent of intents) {
      if (intent.direction !== "long") continue; // longOnly 只交易 long；short/neutral 无需行
      if (!rowKeys.has(`${date}\u0000${intent.securityId}`)) {
        throw new MissingSimulationRowError(date, intent.securityId);
      }
    }
  }
  perfEnd(__btPrecheck);
  perfCount("backtest.trading_days", tradingDates.length);
  perfCount("backtest.decision_days", decisionDates.length);
  perfCount("backtest.dataset_rows", handle.rows.length);

  // 7. 规则/配置装配（冻结快照）。
  const executionModel = createExecutionModel(
    simConfig.executionModel ?? "NEXT_OPEN"
  );
  const marketRules = DEFAULT_MARKET_RULES;
  const executionRules = resolveExecutionRules(simConfig);
  const allowPartialFill = simConfig.allowPartialFill ?? false;
  // BACKTEST-002（B-05）— 成交量为 0 的政策：缺省 REJECT（保守）；只有显式声明才 IGNORE。
  const zeroVolumePolicy = simConfig.zeroVolumePolicy ?? "REJECT";
  const maxPositions = simConfig.maxPositions ?? null;
  const maxDailyBuys = simConfig.maxDailyBuys ?? null;
  const directionPolicy = simConfig.directionPolicy ?? "longOnly";
  const securityBoards = simConfig.securityBoards;
  const configSnapshot = buildConfigSnapshot(simConfig, {
    startDate: tradingDates[0]!,
    endDate: tradingDates[tradingDates.length - 1]!,
  });
  const cost: CostModel = frozenClone(simConfig.cost);

  const portfolio = new Portfolio(simConfig.initialCapital, tradingDates, {
    ...(maxPositions === null ? {} : { maxPositions }),
  });
  const audit = new AuditLog();

  // 8. 执行统计 / 成本累加器（STEP 8 口径）。
  const costSummary = {
    buyCommission: 0,
    sellCommission: 0,
    stampDuty: 0,
    transferFee: 0,
    slippage: 0,
    otherFees: 0,
    totalFees: 0,
    totalCost: 0,
  };
  const stats = {
    totalSignals: 0,
    totalOrders: 0,
    totalFills: 0,
    rejectedOrders: 0,
    partialFills: 0,
    byReason: {} as Partial<Record<RejectionReason, number>>,
  };
  const accumulateCost = (
    side: Side,
    tradeCost: TradeCost,
    slippage: number
  ): void => {
    if (side === "buy") costSummary.buyCommission += tradeCost.commission;
    else costSummary.sellCommission += tradeCost.commission;
    costSummary.stampDuty += tradeCost.stampDuty;
    costSummary.transferFee += tradeCost.transferFee;
    costSummary.otherFees += tradeCost.otherFees;
    costSummary.slippage += slippage;
    costSummary.totalFees += tradeCost.total;
    costSummary.totalCost += tradeCost.total + slippage;
  };

  const securityOf = (securityId: string): Security => ({
    securityId,
    ...(securityBoards && securityBoards[securityId] !== undefined
      ? { board: securityBoards[securityId] as SecurityBoard }
      : {}),
  });

  const equityCurve: EquityPoint[] = [];
  const skippedEntries: SkippedIntentEntry[] = [];
  let pending: PendingOrder[] = [];
  /**
   * 已触发止损的持仓。
   *
   * 止损卖单可能因开盘跌停/停牌被拒；该状态必须跨日保留，直到真正清仓。
   * 否则后续候选退出/时间退出成交时会把最终 Trade.reason 覆盖掉，页面看起来
   * 像“止损从未触发”，实际是风控卖单被拒后没有继承原始退出原因。
   */
  const stopLossTriggered = new Map<string, string>();
  let orderSeq = 0;
  let fillSeq = 0;
  let lastClosePrices = new Map<string, number>();

  // 9. 逐模拟交易日推进（镜像 STEP 8 engine 事件顺序）。
  const __btDayLoop = perfBegin("backtest.decision_day_loop");
  for (let dateIndex = 0; dateIndex < tradingDates.length; dateIndex += 1) {
    const date = tradingDates[dateIndex]!;

    // (a) T+1 结算：前一日冻结份额转可卖。
    portfolio.settle();

    // (a2) 公司行为：先于当日订单与估值应用分红/送转/配股/拆合股。
    if (simConfig.corporateActionResolver !== undefined) {
      for (const securityId of portfolio.openPositionSymbols()) {
        const actions = simConfig.corporateActionResolver.actionsFor(securityId, date);
        if (actions.length > 0) portfolio.applyCorporateAction(securityId, actions);
      }
    }

    // (b) 当日行切片 + bar 索引（一个 chunk，处理完即弃，内存克制）。
    const { start, end } = dateRowRange(handle.rows, date);
    const dayBars = new Map<string, CanonicalMarketBar>();
    for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
      const row = handle.rows[rowIndex]!;
      dayBars.set(row.securityId, rowToCanonicalBar(row));
    }

    // (c) 处理 executionTime == date 的待成交订单。
    const due = pending.filter(entry => entry.executionTime === date);
    pending = pending.filter(entry => entry.executionTime !== date);
    for (const entry of due) {
      const effectiveExitReason =
        entry.side === "sell"
          ? stopLossTriggered.get(entry.securityId) ?? entry.exitReason
          : null;
      const bar = dayBars.get(entry.securityId);
      if (!bar) {
        // 停牌：当日非 universe 成员 → 无行 → 无成交（显式拒绝，不静默顺延）。
        stats.rejectedOrders += 1;
        stats.byReason.SUSPENDED = (stats.byReason.SUSPENDED ?? 0) + 1;
        audit.recordOrder({
          orderId: entry.orderId,
          securityId: entry.securityId,
          tradeDate: entry.tradeDate,
          side: entry.side,
          requestedQuantity: entry.quantity,
          filledQuantity: 0,
          status: "REJECTED",
          rejectionReason: "SUSPENDED",
          explanation: "停牌/当日非 universe 成员无行情，无法成交",
        });
        continue;
      }

      // BACKTEST-002（B-05）— 成交量为 0（或缺失）⇒ 不可成交。
      //
      // 🔴 为什么必须在这里拦：改造前只有 `VWAP_PROXY` 会看 volume（`backtest/execution.ts:93-101`
      // 要求 volume>0，否则回落 OHLC 均值），其余执行模型**完全不看成交量** ⇒
      // 零成交日会按正常价成交（规格 §19 点名的缺陷形态）。政策显式化后由本关卡统一兜住。
      if (zeroVolumePolicy === "REJECT") {
        const volume = bar.volume;
        if (volume === null || volume === undefined || !Number.isFinite(volume) || volume <= 0) {
          stats.rejectedOrders += 1;
          // 具名原因沿用既有词表（`backtest/types.ts:51` 的 `NO_LIQUIDITY` =
          // 「无流动性（成交量为 0 / 无有效价格）」）——不新造一套原因码，
          // 「因为 zeroVolumePolicy 拒的」这层信息由 explanation 如实带出。
          stats.byReason.NO_LIQUIDITY = (stats.byReason.NO_LIQUIDITY ?? 0) + 1;
          audit.recordOrder({
            orderId: entry.orderId,
            securityId: entry.securityId,
            tradeDate: entry.tradeDate,
            side: entry.side,
            requestedQuantity: entry.quantity,
            filledQuantity: 0,
            status: "REJECTED",
            rejectionReason: "NO_LIQUIDITY",
            explanation:
              "执行日成交量为 0 / 缺失（zeroVolumePolicy=REJECT）⇒ 不可成交；" +
              "成交量=" + JSON.stringify(volume ?? null),
          });
          continue;
        }
      }

      const ruleContext = resolveExecutionRuleContext(
        securityOf(entry.securityId),
        marketRules,
        executionRules,
        entry.tradeDate
      );
      const quote = executionModel.quote(
        {
          orderId: entry.orderId,
          securityId: entry.securityId,
          tradeDate: entry.tradeDate,
          side: entry.side,
          quantity: entry.quantity,
          orderType: "market",
          requestedPrice: null,
          status: "SUBMITTED",
          executionTime: entry.executionTime,
          filledQuantity: 0,
          averageFillPrice: null,
          rejectionReason: null,
          createdAt: "deterministic",
        },
        bar,
        ruleContext,
        cost,
        entry.referenceAmount
      );

      if (quote.kind === "rejected") {
        stats.rejectedOrders += 1;
        const reason = quote.rejectionReason ?? "OTHER";
        stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
        audit.recordOrder({
          orderId: entry.orderId,
          securityId: entry.securityId,
          tradeDate: entry.tradeDate,
          side: entry.side,
          requestedQuantity: entry.quantity,
          filledQuantity: 0,
          status: "REJECTED",
          rejectionReason: reason,
          explanation: REJECTION_NOTES[reason] ?? `执行模型拒绝：${reason}`,
        });
        continue;
      }

      const basePrice = quote.basePrice!;
      const price = quote.price!;
      const fill = {
        fillId: `FILL-${fillSeq}`,
        orderId: entry.orderId,
        securityId: entry.securityId,
        side: entry.side,
        quantity: entry.quantity,
        price,
        basePrice,
        timestamp: date,
        cost: {
          commission: 0,
          stampDuty: 0,
          transferFee: 0,
          otherFees: 0,
          total: 0,
        },
        slippageAmount: 0,
        referenceAmount: entry.referenceAmount,
        reason: effectiveExitReason,
      };
      const result =
        entry.side === "buy"
          ? portfolio.buy(fill, cost, allowPartialFill)
          : portfolio.sell(fill, cost, allowPartialFill);

      if (!result.success) {
        stats.rejectedOrders += 1;
        const reason = result.rejectionReason ?? "OTHER";
        stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
        audit.recordOrder({
          orderId: entry.orderId,
          securityId: entry.securityId,
          tradeDate: entry.tradeDate,
          side: entry.side,
          requestedQuantity: entry.quantity,
          filledQuantity: 0,
          status: "REJECTED",
          rejectionReason: reason,
          explanation: result.reason,
        });
        continue;
      }

      const filledQuantity = result.filledQuantity;
      const gross = price * filledQuantity;
      const tradeCost = computeTradeCost(entry.side, gross, cost);
      const slippage = slippageAmount(price, basePrice, filledQuantity);
      const orderStatus = result.status;
      if (result.status === "PARTIALLY_FILLED") stats.partialFills += 1;
      stats.totalFills += 1;
      accumulateCost(entry.side, tradeCost, slippage);

      audit.recordFill(
        fillAuditEntry(
          `FILL-${fillSeq}`,
          entry.orderId,
          entry.securityId,
          entry.side,
          filledQuantity,
          price,
          basePrice,
          date,
          slippage,
          tradeCost
        )
      );
      fillSeq += 1;
      audit.recordOrder({
        orderId: entry.orderId,
        securityId: entry.securityId,
        tradeDate: entry.tradeDate,
        side: entry.side,
        requestedQuantity: entry.quantity,
        filledQuantity,
        status: orderStatus,
        rejectionReason: orderStatus === "PARTIALLY_FILLED" ? "OTHER" : null,
        explanation: `${entry.side === "buy" ? "买入" : "卖出"}成交 ${filledQuantity} 股 @ ${price}`,
      });

      const afterQuantity = portfolio.quantity(entry.securityId);
      const beforeQuantity =
        entry.side === "buy"
          ? afterQuantity - filledQuantity
          : afterQuantity + filledQuantity;
      audit.recordPosition({
        securityId: entry.securityId,
        timestamp: date,
        event:
          entry.side === "buy"
            ? "open"
            : afterQuantity === 0
              ? "close"
              : "decrease",
        beforeQuantity,
        afterQuantity,
        availableQuantity: portfolio.available(entry.securityId),
        frozenQuantity: afterQuantity - portfolio.available(entry.securityId),
        explanation: entry.side === "buy" ? "买入增加持仓" : "卖出减少持仓",
      });
      if (entry.side === "sell" && afterQuantity === 0) {
        stopLossTriggered.delete(entry.securityId);
      }
    }

    // (c2) 盘中阈值退出：止损 / 止盈按当日 OHLC 触发并成交。
    const exitPolicy = simConfig.exitPolicy;
    if (exitPolicy && (exitPolicy.stopLossRatio !== null || exitPolicy.takeProfitRatio !== null)) {
      const details = portfolio.openTradeDetails().sort((a, b) => a.securityId.localeCompare(b.securityId));
      for (const detail of details) {
        const bar = dayBars.get(detail.securityId);
        if (!bar || bar.high === null || bar.low === null) continue;
        const available = portfolio.available(detail.securityId);
        if (available <= 0) continue;

        const stopPrice = exitPolicy.stopLossRatio === null
          ? null
          : detail.entryPrice * (1 - exitPolicy.stopLossRatio);
        const takeProfitPrice = exitPolicy.takeProfitRatio === null
          ? null
          : detail.entryPrice * (1 + exitPolicy.takeProfitRatio);
        const ruleContext = resolveExecutionRuleContext(
          securityOf(detail.securityId),
          marketRules,
          executionRules,
          date,
        );
        let exitReason: string | null = null;
        let triggerPrice: number | null = null;
        if (stopPrice !== null && bar.low <= stopPrice) {
          exitReason = `止损（${(exitPolicy.stopLossRatio! * 100).toFixed(2)}%）`;
          stopLossTriggered.set(detail.securityId, exitReason);
          if (bar.open !== null && bar.open <= stopPrice) {
            const openAtLimitDown =
              ruleContext.limitDownRatio > 0
              &&
              validPrice(bar.preClose)
              && validPrice(bar.open)
              && bar.open <= limitDownPrice(bar.preClose as number, ruleContext.limitDownRatio);
            // 开盘跌停但盘中重新拉回止损价上方时，不能把开盘价当成全天唯一
            // 可成交价；按拉回后的止损价成交。只有全天封死跌停（high 未回到
            // 止损价）才继续由执行模型拒绝并顺延。
            triggerPrice =
              openAtLimitDown
              && bar.high !== null
              && bar.high >= stopPrice
                ? stopPrice
                : bar.open;
          } else {
            triggerPrice = stopPrice;
          }
        } else if (takeProfitPrice !== null && bar.high >= takeProfitPrice) {
          exitReason = `止盈（${(exitPolicy.takeProfitRatio! * 100).toFixed(2)}%）`;
          triggerPrice = bar.open !== null && bar.open >= takeProfitPrice ? bar.open : takeProfitPrice;
        }
        if (exitReason === null || triggerPrice === null) continue;

        orderSeq += 1;
        const orderId = `ORD-${orderSeq}`;
        stats.totalOrders += 1;
        const syntheticBar: CanonicalMarketBar = {
          ...bar,
          open: triggerPrice,
          high: triggerPrice,
          low: triggerPrice,
          close: triggerPrice,
        };
        const quote = executionModel.quote(
          {
            orderId,
            securityId: detail.securityId,
            tradeDate: date,
            side: "sell",
            quantity: available,
            orderType: "market",
            requestedPrice: null,
            status: "SUBMITTED",
            executionTime: date,
            filledQuantity: 0,
            averageFillPrice: null,
            rejectionReason: null,
            createdAt: "deterministic",
          },
          syntheticBar,
          ruleContext,
          cost,
          null,
        );
        if (quote.kind === "rejected") {
          stats.rejectedOrders += 1;
          const reason = quote.rejectionReason ?? "OTHER";
          stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
          audit.recordOrder({
            orderId,
            securityId: detail.securityId,
            tradeDate: date,
            side: "sell",
            requestedQuantity: available,
            filledQuantity: 0,
            status: "REJECTED",
            rejectionReason: reason,
            explanation: `${exitReason} 触发，但执行模型拒绝：${REJECTION_NOTES[reason] ?? reason}`,
          });
          continue;
        }

        const fill = {
          fillId: `FILL-${fillSeq}`,
          orderId,
          securityId: detail.securityId,
          side: "sell" as const,
          quantity: available,
          price: quote.price!,
          basePrice: quote.basePrice!,
          timestamp: date,
          cost: { commission: 0, stampDuty: 0, transferFee: 0, otherFees: 0, total: 0 },
          slippageAmount: 0,
          referenceAmount: null,
          reason: exitReason,
        };
        const result = portfolio.sell(fill, cost, allowPartialFill);
        if (!result.success) {
          stats.rejectedOrders += 1;
          const reason = result.rejectionReason ?? "OTHER";
          stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
          audit.recordOrder({
            orderId,
            securityId: detail.securityId,
            tradeDate: date,
            side: "sell",
            requestedQuantity: available,
            filledQuantity: 0,
            status: "REJECTED",
            rejectionReason: reason,
            explanation: `${exitReason} 触发，但组合约束拒绝：${result.reason}`,
          });
          continue;
        }

        const filledQuantity = result.filledQuantity;
        const gross = fill.price * filledQuantity;
        const tradeCost = computeTradeCost("sell", gross, cost);
        const slippage = slippageAmount(fill.price, fill.basePrice, filledQuantity);
        if (result.status === "PARTIALLY_FILLED") stats.partialFills += 1;
        stats.totalFills += 1;
        accumulateCost("sell", tradeCost, slippage);
        audit.recordFill(
          fillAuditEntry(
            `FILL-${fillSeq}`,
            orderId,
            detail.securityId,
            "sell",
            filledQuantity,
            fill.price,
            fill.basePrice,
            date,
            slippage,
            tradeCost,
          ),
        );
        fillSeq += 1;
        audit.recordOrder({
          orderId,
          securityId: detail.securityId,
          tradeDate: date,
          side: "sell",
          requestedQuantity: available,
          filledQuantity,
          status: result.status,
          rejectionReason: result.status === "PARTIALLY_FILLED" ? "OTHER" : null,
          explanation: `${exitReason}：卖出成交 ${filledQuantity} 股 @ ${fill.price}`,
        });
        const afterQuantity = portfolio.quantity(detail.securityId);
        audit.recordPosition({
          securityId: detail.securityId,
          timestamp: date,
          event: afterQuantity === 0 ? "close" : "decrease",
          beforeQuantity: afterQuantity + filledQuantity,
          afterQuantity,
          availableQuantity: portfolio.available(detail.securityId),
          frozenQuantity: afterQuantity - portfolio.available(detail.securityId),
          explanation: exitReason,
        });
        if (afterQuantity === 0) stopLossTriggered.delete(detail.securityId);
      }
    }

    // (d) 收盘后决策（仅候选日）：hold-while-selected 进出场。
    const nextDate =
      dateIndex + 1 < tradingDates.length ? tradingDates[dateIndex + 1]! : null;
    const intents = decisionIndex.get(date) ?? [];
    const forcedExitReasons = new Map<string, string>();
    const maxHoldingDays = exitPolicy?.maxHoldingDays ?? null;
    if (maxHoldingDays !== null) {
      for (const detail of portfolio.openTradeDetails().sort((a, b) => a.securityId.localeCompare(b.securityId))) {
        const holdingDays = portfolio.holdingDaysBetween(detail.entryTime, date);
        if (holdingDays !== null && holdingDays >= maxHoldingDays) {
          forcedExitReasons.set(detail.securityId, `持有满${maxHoldingDays}个交易日`);
        }
      }
    }
    if (intents.length > 0 || forcedExitReasons.size > 0) {
      const holdings = Array.from(portfolio.openPositionSymbols()).sort();
      const availableBySecurity = new Map<string, number>();
      for (const securityId of holdings)
        availableBySecurity.set(securityId, portfolio.available(securityId));
      const closePriceBySecurity = new Map<string, number>();
      const amountBySecurity = new Map<string, number | null>();
      for (const [securityId, bar] of Array.from(dayBars.entries())) {
        if (bar.close !== null && Number.isFinite(bar.close) && bar.close > 0)
          closePriceBySecurity.set(securityId, bar.close);
        amountBySecurity.set(securityId, bar.amount ?? null);
      }
      const plan = perfRun("backtest.plan", () =>
        planDecisionDay({
        decisionDate: date,
        intents,
        forcedExitReasons,
        holdings,
        availableBySecurity,
        cash: portfolio.cash,
        maxPositions,
        maxDailyBuys,
        hasNextTradingDay: nextDate !== null,
        closePriceBySecurity,
        amountBySecurity,
        cost,
        directionPolicy,
        // BACKTEST-002（B-02）— 仓位口径与计量基数透传（min 收窄，不放大）。
        ...(simConfig.positionSizing !== undefined ? { positionSizing: simConfig.positionSizing } : {}),
        initialCapital: simConfig.initialCapital,
        }),
      );

      for (const item of plan.orders as readonly PlannedOrder[]) {
        if (!nextDate) {
          throw new TradeSimulationError(
            "INTERNAL_PLAN_NEXT_DAY",
            `计划层返回订单但窗口无下一交易日（date=${date}），应在上层拦截`
          );
        }
        orderSeq += 1;
        const orderId = `ORD-${orderSeq}`;
        const exitReason = item.kind === "sell" ? item.reason : null;
        const order: Order = {
          orderId,
          securityId: item.securityId,
          tradeDate: date,
          side: item.kind,
          quantity: item.quantity,
          orderType: "market",
          requestedPrice: null,
          status: "SUBMITTED",
          executionTime: nextDate,
          filledQuantity: 0,
          averageFillPrice: null,
          rejectionReason: null,
          createdAt: "deterministic",
        };
        stats.totalOrders += 1;
        pending.push({
          orderId,
          securityId: item.securityId,
          tradeDate: date,
          side: item.kind,
          quantity: item.quantity,
          executionTime: nextDate,
          referenceAmount: item.kind === "buy" ? item.referenceAmount : null,
          exitReason:
            item.kind === "sell"
              ? stopLossTriggered.get(item.securityId) ?? exitReason
              : exitReason,
        });
        audit.recordOrder({
          orderId,
          securityId: item.securityId,
          tradeDate: date,
          side: item.kind,
          requestedQuantity: item.quantity,
          filledQuantity: 0,
          status: "SUBMITTED",
          rejectionReason: null,
          explanation:
            item.kind === "buy"
              ? `信号买入 ${item.quantity} 股（候选进入）`
              : `${exitReason ?? "候选退出"}：卖出 ${item.quantity} 股`,
        });
      }
      skippedEntries.push(...plan.skipped);
    }

    // (d-2) 面板末日清算（防悬挂）。
    //
    // 🔴 问题：卖出订单的 `executionTime` 固定是 **nextDate**（NEXT_OPEN 语义）。若某证券在
    // nextDate **没有行情行**，这笔卖出注定被拒，而引擎会**逐日重试直到期末** ⇒ 持仓永久
    // 悬挂。实测（690001 / 2025-11..2026-09）：`holdingPeriod` 出现 67/76/108/134 的长尾，
    // `SUSPENDED / 执行日无行` 累计 697 次、`SUBMITTED / 执行日无行` 705 次。
    //
    // 🔴 判据：**明日无行**即清算（不是「最后一个有行情日」—— 同一证券的多个事件会让
    // 面板行跨度达 34~210 行，按末日判定永远不触发，第一版兜底因此完全无效）。
    //
    // 修正动作：当日还有行情 ⇒ **按当日收盘价**强制清算，仍走
    // 「syntheticBar → executionModel.quote → portfolio.sell」以保留滑点与费用；
    // 但把 syntheticBar.preClose 设为收盘价，显式绕过「最后一行跌停无法再次重试」
    // 的僵局。该绕过仅在事件面板没有下一行时发生，并写入退出原因。
    if (nextDate !== null) {
      for (const detail of portfolio.openTradeDetails().sort((a, b) => a.securityId.localeCompare(b.securityId))) {
        // 明日仍有行 ⇒ 正常退出路径可行，不干预。
        if (rowKeys.has(`${nextDate}\u0000${detail.securityId}`)) continue;
        const bar = dayBars.get(detail.securityId);
        const closePrice =
          bar !== undefined
          && bar.close !== null
          && Number.isFinite(bar.close)
          && bar.close > 0
            ? bar.close
            : lastClosePrices.get(detail.securityId) ?? null;
        if (closePrice === null || !Number.isFinite(closePrice) || closePrice <= 0) continue;
        const available = portfolio.available(detail.securityId);
        if (available <= 0) continue; // T+1 冻结，留到下一交易日再判

        const exitReason =
          `面板末日清算（下一交易日 ${nextDate} 无行情，按当日收盘价平仓，避免悬挂到期末）`;
        orderSeq += 1;
        const orderId = `ORD-${orderSeq}`;
        stats.totalOrders += 1;
        // The event panel has no later executable bar. A normal NEXT_OPEN
        // retry is impossible, so close directly at the last known close with
        // the configured sell slippage; fees are still applied below.
        const forcedPrice = Number(
          (closePrice * (1 - Math.max(0, cost.slippageBps) / 10_000)).toFixed(4),
        );
        const fill = {
          fillId: `FILL-${fillSeq}`,
          orderId,
          securityId: detail.securityId,
          side: "sell" as const,
          quantity: available,
          price: forcedPrice,
          basePrice: closePrice,
          timestamp: date,
          cost: { commission: 0, stampDuty: 0, transferFee: 0, otherFees: 0, total: 0 },
          slippageAmount: 0,
          referenceAmount: null,
          reason: exitReason,
        };
        const result = portfolio.sell(fill, cost, allowPartialFill);
        if (!result.success) {
          stats.rejectedOrders += 1;
          const reason = result.rejectionReason ?? "OTHER";
          stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
          audit.recordOrder({
            orderId,
            securityId: detail.securityId,
            tradeDate: date,
            side: "sell",
            requestedQuantity: available,
            filledQuantity: 0,
            status: "REJECTED",
            rejectionReason: reason,
            explanation: `${exitReason}：组合约束拒绝（${result.reason}）`,
          });
          continue;
        }
        const filledQuantity = result.filledQuantity;
        const gross = fill.price * filledQuantity;
        const tradeCost = computeTradeCost("sell", gross, cost);
        const slippage = slippageAmount(fill.price, fill.basePrice, filledQuantity);
        if (result.status === "PARTIALLY_FILLED") stats.partialFills += 1;
        stats.totalFills += 1;
        accumulateCost("sell", tradeCost, slippage);
        audit.recordFill(
          fillAuditEntry(
            `FILL-${fillSeq}`,
            orderId,
            detail.securityId,
            "sell",
            filledQuantity,
            fill.price,
            fill.basePrice,
            date,
            slippage,
            tradeCost,
          ),
        );
        fillSeq += 1;
        audit.recordOrder({
          orderId,
          securityId: detail.securityId,
          tradeDate: date,
          side: "sell",
          requestedQuantity: available,
          filledQuantity,
          status: result.status,
          rejectionReason: result.status === "PARTIALLY_FILLED" ? "OTHER" : null,
          explanation: `${exitReason}：卖出成交 ${filledQuantity} 股 @ ${fill.price}`,
        });
        const afterQuantity = portfolio.quantity(detail.securityId);
        audit.recordPosition({
          securityId: detail.securityId,
          timestamp: date,
          event: afterQuantity === 0 ? "close" : "decrease",
          beforeQuantity: afterQuantity + filledQuantity,
          afterQuantity,
          availableQuantity: portfolio.available(detail.securityId),
          frozenQuantity: afterQuantity - portfolio.available(detail.securityId),
          explanation: exitReason,
        });
      }
    }

    // (e) 收盘后记录权益点。
    const closePrices = new Map<string, number>();
    for (const [securityId, bar] of Array.from(dayBars.entries())) {
      if (bar.close !== null && Number.isFinite(bar.close) && bar.close > 0)
        closePrices.set(securityId, bar.close);
    }
    lastClosePrices = closePrices;
    equityCurve.push(portfolio.equityPoint(date, closePrices));
  }
  perfEnd(__btDayLoop);

  // 10. 期末：估值未平仓交易 + 全部交易 + 最终状态。
  portfolio.finalizeOpenTrades(lastClosePrices);
  const finalState = portfolio.portfolioState(lastClosePrices);
  const trades = portfolio.allTrades();
  stats.totalSignals = orderSeq;
  stats.totalOrders = orderSeq;

  // 11. 不可变总记录（追溯字段 + 指纹）。
  const body: Omit<TradeSimulationRun, "fingerprint"> = {
    recordKind: TRADE_SIMULATION_RUN_RECORD_KIND,
    recordVersion: TRADE_SIMULATION_RUN_RECORD_VERSION,
    datasetVersion: handle.datasetVersion,
    builderVersion: handle.builderVersion,
    rowSchemaVersion: handle.rowSchemaVersion,
    datasetGate: handle.gate,
    universeId: handle.universeId,
    strategyId: sourceRun.strategyId,
    strategyVersion: sourceRun.strategyVersion,
    parameters: frozenClone(sourceRun.parameters),
    sourceFingerprint: sourceRun.fingerprint,
    decisionDateRange: {
      startDate: sourceRun.dateRange.startDate,
      endDate: sourceRun.dateRange.endDate,
    },
    decisionDayCount: decisionDates.length,
    dateRange: {
      startDate: tradingDates[0]!,
      endDate: tradingDates[tradingDates.length - 1]!,
    },
    initialCapital: simConfig.initialCapital,
    finalEquity: finalState.equity,
    config: frozenClone(configSnapshot),
    equityCurve: equityCurve.map(point => deepFreeze(point)),
    trades: trades.map(trade => deepFreeze(trade)),
    positions: finalState.positions.map(position => deepFreeze(position)),
    costs: deepFreeze({ ...costSummary }),
    executionStats: deepFreeze({ ...stats, byReason: { ...stats.byReason } }),
    skipped: skippedEntries.map(entry => deepFreeze(entry)),
    audit: deepFreeze(audit.snapshot()),
  };
  const fingerprint = perfRun("backtest.fingerprint", () => computeTradeSimulationRunFingerprint(body));
  perfCount("backtest.trades", trades.length);
  perfCount("backtest.equity_points", equityCurve.length);
  return deepFreeze<TradeSimulationRun>({ ...body, fingerprint });
}
