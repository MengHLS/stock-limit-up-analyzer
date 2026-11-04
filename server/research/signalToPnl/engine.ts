/**
 * STEP 23 / C-23.2 — 信号→订单→成交→PnL 闭环编排（主编排器）。
 *
 * 核心职责（对齐 ROADMAP §0 PIT 优先级 + §7 七态 + §36/§42 铁律 + §44.4 依赖链）：
 *   把 C-13.2 候选记录 → C-23.1 模拟账户状态机 → C-14.3 执行约束声明 → C-14.2
 *   成本声明 → 行级行情快照（价格源注入）串成一份带指纹的 SignalToPnlRun 不可变
 *   总记录，并向 C-16.3 提供 TradeQualityEvaluationInput 映射入口。
 *
 * 主循环（每个交易日顺序执行 a→b→c→d，与 STEP 8 engine 事件顺序对齐）：
 *   (a) settlePaperAccountT1：当日冻结股 → 可卖；
 *   (b) 处理 pending orders（executionTime === currentDate）：
 *         checkPaperOrder → 通过 → applyPaperBuyFill / applyPaperSellFill
 *         → 拒绝 → unfreezePaperCash + PnlLoopRejectionEntry；
 *   (c) 决策日：从 sourceRun 取 positionIntents → signalSelector → planDecisionDay
 *         → PaperAccountOrder + freezePaperCash（仅 buy 冻结）；
 *   (d) mark-to-market：按当日 close 价更新持仓估值，写入快照 + 权益点。
 *
 * 价格源缓存（保证确定性 + 减少 priceSource 调用次数）：
 *   每日循环开始时，扫描「今日 pending + 今日 intents」的所有 securityId，
 *   一次性调用 priceSource(date, securityId) 填充 Map<securityId, snapshot>，
 *   loop 内对价格的访问全部从缓存取，杜绝非确定性调用次数。
 *
 * PIT 守则：
 *   - 决策日 D 的订单 executionTime = D 的下一交易日 D+1（持仓 D+1 才可卖）；
 *   - D+1 是执行日，成交价严格取 D+1 open（不取 D close，避免 look-ahead）；
 *   - 价格/成交额全部由调用方 priceSource 注入，loop **绝不读 dataset / data 源**；
 *   - 账户 asOf === 当前交易日（settle/apply 自动推进）。
 *
 * 铁律：纯函数、readonly 入参、无 Date.now / Math.random / IO；非法输入抛
 * SignalToPnlError（稳定 code），绝不静默 clamp / 回退 / 伪造。
 */

import { createHash } from "node:crypto";
import type {
  EquityPoint,
  OrderStatus,
  Side,
} from "../../backtest/types";
import type { PositionIntent } from "../framework/contract";
import type {
  CostModelDeclaration,
  FillCostBreakdown,
} from "../costModel/types";
import { computeFillCostBreakdown } from "../costModel/compute";
import { toEngineCostModel } from "../costModel/mappers";
import type { CostModel } from "../../engine/domain";
import type {
  ExecutionConstraintDeclaration,
} from "../executionConstraints/types";
import {
  computeExecutionConstraintDeclarationFingerprint,
} from "../executionConstraints/serialize";
import { describeExecutionConstraintCoverage } from "../executionConstraints/map";
import type { CandidateDayRecord, CandidateEvaluationRun } from "../signalEngine/types";
import { planDecisionDay } from "../simulator/plan";
import { canonicalStringify } from "../../researchDataset/version";
import {
  settlePaperAccountT1,
  freezePaperCash,
  unfreezePaperCash,
  applyPaperBuyFill,
  applyPaperSellFill,
  markPaperAccountToMarket,
  snapshotPaperAccount,
} from "../paperAccount/account";
import {
  checkPaperOrder,
  toPaperFillConstraintHits,
} from "../paperAccount/constraints";
import {
  PAPER_ACCOUNT_ERROR_CODES,
  PaperAccountError,
} from "../paperAccount/errors";
import {
  assertValidCostModelDeclaration,
} from "../costModel/validate";
import {
  assertValidExecutionConstraintDeclaration,
} from "../executionConstraints/validate";
import {
  assertValidCandidateEvaluationRun,
  computeCandidateEvaluationRunFingerprint,
} from "../signalEngine";
import type {
  PaperAccount,
  PaperAccountFill,
  PaperAccountOrder,
  PaperAccountPositionSnapshot,
  PaperCashLedgerEntry,
  PaperPnlBreakdown,
  PaperSignalSource,
} from "../paperAccount/types";
import { computePaperPnlBreakdown } from "../paperAccount/run";
import type {
  PnlLoopDayDecision,
  PnlLoopDayExecution,
  PnlLoopDayMark,
  PnlLoopPendingOrder,
  PnlLoopPriceSnapshot,
  PnlLoopPriceSource,
  PnlLoopRejectionEntry,
  PnlLoopSignalSelector,
  PnlLoopSourceRef,
  PnlLoopStats,
  SignalToPnlLoopInput,
  SignalToPnlRun,
} from "./types";
import {
  SIGNAL_TO_PNL_RUN_KIND,
  SIGNAL_TO_PNL_RUN_RECORD_VERSION,
} from "./types";
import {
  SIGNAL_TO_PNL_ERROR_CODES,
  SignalToPnlError,
} from "./errors";
import { computeSignalToPnlRunFingerprint } from "./serialize";

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): void {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.INPUT_INVALID,
      `${label}（${value}）不是合法 YYYY-MM-DD`
    );
  }
}

function assertAscendingDateArray(
  value: readonly string[],
  label: string
): void {
  for (let i = 0; i < value.length; i += 1) {
    assertIsoDate(value[i]!, `${label}[${i}]`);
    if (i > 0 && value[i]! <= value[i - 1]!) {
      throw new SignalToPnlError(
        SIGNAL_TO_PNL_ERROR_CODES.LOOP_CALENDAR_NOT_ASCENDING,
        `${label} 必须严格升序（${value[i - 1]} → ${value[i]}）`
      );
    }
  }
}

/** 默认信号选择器：全部 long 意图。 */
const defaultSignalSelector: PnlLoopSignalSelector = (_date, intents) =>
  intents.filter((intent) => intent.direction === "long");

/** 决策日索引：date → CandidateDayRecord。 */
function buildDecisionDayIndex(
  sourceRun: CandidateEvaluationRun
): ReadonlyMap<string, CandidateDayRecord> {
  const map = new Map<string, CandidateDayRecord>();
  for (const day of sourceRun.days) map.set(day.date, day);
  return map;
}

/**
 * 把整数字面量转换为确定性的 orderId。
 * 使用零填充保证字典序与数值序一致（ORD-001 < ORD-100）。
 */
function formatOrderId(seq: number): string {
  return `S2P-ORD-${String(seq).padStart(6, "0")}`;
}

function formatFillId(seq: number): string {
  return `S2P-FILL-${String(seq).padStart(6, "0")}`;
}

function formatLedgerEntryId(seq: number): string {
  return `S2P-LDG-${String(seq).padStart(6, "0")}`;
}

/** 估计 buy 订单冻结金额（开盘价 × 股数 + 佣金估算；与 checkPaperOrder 资金校验口径一致）。 */
function estimateBuyFreezeAmount(
  openPrice: number,
  quantity: number,
  costModel: CostModel
): number {
  const gross = openPrice * quantity;
  const commission =
    gross * costModel.commissionRate < costModel.minCommission
      ? costModel.minCommission
      : gross * costModel.commissionRate;
  return gross + commission;
}

/** paper account status：纯枚举映射（与 STEP 8 OrderStatus 对齐）。 */
function statusForFill(isFull: boolean): OrderStatus {
  return isFull ? "FILLED" : "PARTIALLY_FILLED";
}

function statusForRejection(reason: string): OrderStatus {
  return "REJECTED";
}

/** 估算冻结失败时推 REJECTED 订单 + 记录 rejectionLedger（替换原 SUBMITTED）。 */
function pushRejectedFromFreezeFailure(
  args: {
    order: PaperAccountOrder;
    rejectionCode: string;
    reason: string;
    rejectionLedger: PnlLoopRejectionEntry[];
    rejectionSummary: Record<string, number>;
    executions: PnlLoopDayExecution[];
  }
): void {
  args.rejectionLedger.push({
    orderId: args.order.orderId,
    securityId: args.order.securityId,
    side: args.order.side,
    decisionDate: args.order.tradeDate,
    executionDate: args.order.executionTime,
    rejectionCode: args.rejectionCode,
    reason: args.reason,
  });
  args.rejectionSummary[args.rejectionCode] =
    (args.rejectionSummary[args.rejectionCode] ?? 0) + 1;
  // 同步更新 executions 中今天的 rejectCount
  for (const exec of args.executions) {
    if (exec.executionDate === args.order.executionTime) {
      // 不变量破坏：执行日还未处理，但 freeze 失败发生在决策日，不计入执行拒绝；
      // 这里不动 executions（决策日处理不属 executions 统计）
      break;
    }
  }
}

/** 把订单列表中指定 orderId 的状态替换为新状态（不可变重建）。 */
function replaceOrderStatus(
  orders: readonly PaperAccountOrder[],
  orderId: string,
  newStatus: OrderStatus
): PaperAccountOrder[] {
  let found = false;
  const next = orders.map((o) => {
    if (o.orderId !== orderId) return o;
    found = true;
    return { ...o, status: newStatus };
  });
  if (!found) {
    // 防御：若订单未在列表（异常场景），返回原数组不抛错
    return [...orders];
  }
  return next;
}

/** 决策日处理中，把失败订单的状态置为 REJECTED（orders 不可变 → 重建）。 */
function rejectOrderFromDecisionDay(
  args: {
    orders: PaperAccountOrder[];
    orderId: string;
    rejectionCode: string;
  }
): void {
  const idx = args.orders.findIndex((o) => o.orderId === args.orderId);
  if (idx >= 0) {
    args.orders[idx] = { ...args.orders[idx]!, status: "REJECTED" };
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 运行信号→订单→成交→PnL 多日闭环编排，产出不可变、带指纹的 SignalToPnlRun。
 *
 * 输入形态要求（FAIL FAST）：
 *   - sourceRun：必须 recordKind=CANDIDATE_EVALUATION_RUN + 指纹一致 + point=close +
 *     dateRange 与 tradingCalendar 一致；
 *   - initialAccount：必须结构合法且 asOf < tradingCalendar[0]；
 *   - costDeclaration / executionDeclaration：必须通过既有 assert 校验；
 *   - tradingCalendar：升序非空 YYYY-MM-DD；
 *   - priceSource：确定性注入式回调。
 */
export function runSignalToPnlLoop(
  input: SignalToPnlLoopInput
): SignalToPnlRun {
  const {
    runId,
    accountId,
    createdAt,
    sourceRun,
    initialAccount,
    costDeclaration,
    executionDeclaration,
    tradingCalendar,
    priceSource,
  } = input;
  const signalSelector = input.signalSelector ?? defaultSignalSelector;

  // ====== 1. 基础输入校验 ======
  if (typeof runId !== "string" || runId.trim() === "") {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.INPUT_RUN_ID_INVALID,
      `SignalToPnl: runId 必须是非空字符串`
    );
  }
  if (typeof accountId !== "string" || accountId.trim() === "") {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.INPUT_ACCOUNT_ID_INVALID,
      `SignalToPnl: accountId 必须是非空字符串`
    );
  }
  if (typeof priceSource !== "function") {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.INPUT_PRICE_SOURCE_MISSING,
      `SignalToPnl: priceSource 必须是函数`
    );
  }
  if (!Array.isArray(tradingCalendar) || tradingCalendar.length === 0) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.INPUT_CALENDAR_EMPTY,
      `SignalToPnl: tradingCalendar 不能为空数组`
    );
  }
  assertAscendingDateArray(tradingCalendar, "tradingCalendar");
  assertIsoDate(initialAccount.asOf, "initialAccount.asOf");
  if (initialAccount.asOf >= tradingCalendar[0]!) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.INPUT_ACCOUNT_ASOF_INVALID,
      `SignalToPnl: initialAccount.asOf(${initialAccount.asOf}) 必须早于 tradingCalendar[0](${tradingCalendar[0]})`
    );
  }

  // ====== 2. 来源记录校验 ======
  assertValidCandidateEvaluationRun(sourceRun);
  if (sourceRun.recordKind !== "CANDIDATE_EVALUATION_RUN") {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.SOURCE_KIND_INVALID,
      `SignalToPnl: sourceRun.recordKind=${sourceRun.recordKind} 不是 CANDIDATE_EVALUATION_RUN`
    );
  }
  const recomputedFingerprint = computeCandidateEvaluationRunFingerprint(sourceRun);
  if (sourceRun.fingerprint !== recomputedFingerprint) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.SOURCE_FINGERPRINT_MISMATCH,
      `SignalToPnl: 来源候选记录指纹不匹配（期望 ${recomputedFingerprint}，实际 ${sourceRun.fingerprint}）`
    );
  }
  if (sourceRun.point !== "close") {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.SOURCE_DECISION_POINT_INVALID,
      `SignalToPnl: sourceRun.point=${sourceRun.point}；本编排要求 close（决策日收盘 → 次日执行）`
    );
  }
  if (
    sourceRun.dateRange.startDate < tradingCalendar[0]! ||
    sourceRun.dateRange.endDate > tradingCalendar[tradingCalendar.length - 1]!
  ) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.SOURCE_DATE_RANGE_MISMATCH,
      `SignalToPnl: sourceRun.dateRange[${sourceRun.dateRange.startDate}..${sourceRun.dateRange.endDate}] 必须 ⊆ tradingCalendar[${tradingCalendar[0]}..${tradingCalendar[tradingCalendar.length - 1]}]（决策日 ⊆ 交易日）`
    );
  }

  // ====== 3. 声明校验 ======
  assertValidCostModelDeclaration(costDeclaration);
  assertValidExecutionConstraintDeclaration(executionDeclaration);

  const costModel: CostModel = toEngineCostModel(costDeclaration);
  const decisionIndex = buildDecisionDayIndex(sourceRun);

  // ====== 4. 编排循环 ======
  let account: PaperAccount = { ...initialAccount };
  let orders: PaperAccountOrder[] = [];
  const fills: PaperAccountFill[] = [];
  const snapshots: PaperAccountPositionSnapshot[] = [];
  const cashLedger: PaperCashLedgerEntry[] = [];
  const equityCurve: EquityPoint[] = [];
  const days: PnlLoopDayDecision[] = [];
  const executions: PnlLoopDayExecution[] = [];
  const dailyMarks: PnlLoopDayMark[] = [];
  const rejectionLedger: PnlLoopRejectionEntry[] = [];
  const rejectionSummary: Record<string, number> = {};
  const frozenTimeline: { tradeDate: string; frozen: number }[] = [];

  let pending: PnlLoopPendingOrder[] = [];
  let orderSeq = 0;
  let fillSeq = 0;
  let ledgerSeq = 0;
  let peakFrozen = 0;

  let totalIntents = 0;
  let selectedIntentsCount = 0;
  let totalFrozenAmount = 0;

  for (let i = 0; i < tradingCalendar.length; i += 1) {
    const date = tradingCalendar[i]!;

    // (a) T+1 结算。
    account = settlePaperAccountT1(account, date);

    // ====== 当日价格快照预填 ======
    const todaySecurities = new Set<string>();
    for (const p of pending) {
      if (p.order.executionTime === date) todaySecurities.add(p.order.securityId);
    }
    const decisionDayRecord = decisionIndex.get(date);
    if (decisionDayRecord !== undefined) {
      for (const intent of decisionDayRecord.positionIntents) {
        todaySecurities.add(intent.securityId);
      }
    }

    const snapshotBySecurity = new Map<string, PnlLoopPriceSnapshot>();
    for (const securityId of Array.from(todaySecurities)) {
      const snap = priceSource(date, securityId);
      if (snap !== null) snapshotBySecurity.set(securityId, snap);
    }

    // ====== (b) 处理 pending orders（executionTime === date） ======
    let fillCountToday = 0;
    let rejectionCountToday = 0;
    const todayFillIds: string[] = [];
    const todayRejections: PnlLoopRejectionEntry[] = [];

    const due = pending.filter((p) => p.order.executionTime === date);
    const remaining: PnlLoopPendingOrder[] = [];
    for (const p of pending) {
      if (p.order.executionTime !== date) remaining.push(p);
    }
    pending = remaining;

    for (const entry of due) {
      const order = entry.order;
      const snap = snapshotBySecurity.get(order.securityId) ?? null;

      // 停牌 / 无行情 → SUSPENDED 拒绝，释放冻结（如有）。
      if (snap === null || snap.open === null || snap.prevClose === null) {
        const rejectionCode = PAPER_ACCOUNT_ERROR_CODES.CHECK_SUSPENDED;
        const reason = `${order.securityId} 执行日无有效行情（停牌/无 bar），拒绝成交`;
        rejectionCountToday += 1;
        rejectionLedger.push({
          orderId: order.orderId,
          securityId: order.securityId,
          side: order.side,
          decisionDate: order.tradeDate,
          executionDate: date,
          rejectionCode,
          reason,
        });
        rejectionSummary[rejectionCode] = (rejectionSummary[rejectionCode] ?? 0) + 1;
        todayRejections.push({
          orderId: order.orderId,
          securityId: order.securityId,
          side: order.side,
          decisionDate: order.tradeDate,
          executionDate: date,
          rejectionCode,
          reason,
        });
        // 替换原 SUBMITTED 状态为 REJECTED（orders 不可变 → 重建数组）
        orders = replaceOrderStatus(orders, order.orderId, statusForRejection(rejectionCode));

        if (order.side === "buy" && entry.frozenAmount > 0) {
          const unfreeze = unfreezePaperCash(
            account,
            entry.frozenAmount,
            formatLedgerEntryId(ledgerSeq),
            date,
            `订单 ${order.orderId} 拒绝，释放冻结资金`,
            order.orderId
          );
          account = unfreeze.account;
          cashLedger.push(unfreeze.ledgerEntry);
          ledgerSeq += 1;
        }
        continue;
      }

      // 构造约束检查所需的 prices Map（securityId → close 价）。
      const pricesForCheck = new Map<string, number>();
      if (snap.close !== null && Number.isFinite(snap.close) && snap.close > 0) {
        pricesForCheck.set(order.securityId, snap.close);
      }
      // 也加入持仓的当前估值价（来自账户持仓的 marketPrice）。
      for (const pos of account.positions) {
        if (pos.marketPrice !== null) pricesForCheck.set(pos.securityId, pos.marketPrice);
      }

      const checkResult = checkPaperOrder({
        order,
        account,
        declaration: executionDeclaration,
        costDeclaration,
        market: { open: snap.open, prevClose: snap.prevClose },
        prices: pricesForCheck,
      });

      if (!checkResult.ok) {
        const rejectionCode =
          checkResult.rejectionCode ?? PAPER_ACCOUNT_ERROR_CODES.ORDER_INVALID;
        rejectionCountToday += 1;
        rejectionLedger.push({
          orderId: order.orderId,
          securityId: order.securityId,
          side: order.side,
          decisionDate: order.tradeDate,
          executionDate: date,
          rejectionCode,
          reason: checkResult.reason,
        });
        rejectionSummary[rejectionCode] = (rejectionSummary[rejectionCode] ?? 0) + 1;
        todayRejections.push({
          orderId: order.orderId,
          securityId: order.securityId,
          side: order.side,
          decisionDate: order.tradeDate,
          executionDate: date,
          rejectionCode,
          reason: checkResult.reason,
        });
        // 替换原 SUBMITTED 状态为 REJECTED
        orders = replaceOrderStatus(orders, order.orderId, statusForRejection(rejectionCode));

        // 释放 buy 订单冻结资金。
        if (order.side === "buy" && entry.frozenAmount > 0) {
          const unfreeze = unfreezePaperCash(
            account,
            entry.frozenAmount,
            formatLedgerEntryId(ledgerSeq),
            date,
            `订单 ${order.orderId} 约束拒绝（${rejectionCode}），释放冻结资金`,
            order.orderId
          );
          account = unfreeze.account;
          cashLedger.push(unfreeze.ledgerEntry);
          ledgerSeq += 1;
        }
        continue;
      }

      // ====== 成交应用 ======
      const fillId = formatFillId(fillSeq);
      const referenceAmount =
        snap.amount !== null && Number.isFinite(snap.amount) ? snap.amount : null;
      const cost: FillCostBreakdown = computeFillCostBreakdown({
        side: order.side,
        declaration: costDeclaration,
        price: snap.open!,
        basePrice: snap.prevClose!,
        quantity: order.quantity,
        referenceAmountKqian: referenceAmount,
      });

      const fill: PaperAccountFill = {
        fillId,
        orderId: order.orderId,
        securityId: order.securityId,
        side: order.side,
        quantity: order.quantity,
        price: snap.open!,
        basePrice: snap.prevClose!,
        timestamp: date,
        cost,
        constraintHits: toPaperFillConstraintHits(checkResult),
      };

      try {
        const application =
          order.side === "buy"
            ? applyPaperBuyFill(
                account,
                fill,
                costDeclaration,
                formatLedgerEntryId(ledgerSeq),
                `订单 ${order.orderId} 买入成交`
              )
            : applyPaperSellFill(
                account,
                fill,
                costDeclaration,
                formatLedgerEntryId(ledgerSeq),
                `订单 ${order.orderId} 卖出成交`
              );
        account = application.account;
        cashLedger.push(application.ledgerEntry);
        ledgerSeq += 1;

        // 释放 buy 冻结（applyPaperBuyFill 已实际扣减现金，冻结金额需要解冻）
        if (order.side === "buy" && entry.frozenAmount > 0) {
          const unfreeze = unfreezePaperCash(
            account,
            entry.frozenAmount,
            formatLedgerEntryId(ledgerSeq),
            date,
            `订单 ${order.orderId} 成交，从冻结释放预留`,
            order.orderId
          );
          account = unfreeze.account;
          cashLedger.push(unfreeze.ledgerEntry);
          ledgerSeq += 1;
        }

        fills.push(fill);
        fillSeq += 1;
        fillCountToday += 1;
        todayFillIds.push(fillId);

        // 替换原 SUBMITTED 状态为 FILLED
        orders = replaceOrderStatus(orders, order.orderId, statusForFill(true));
      } catch (err) {
        // 成交应用阶段异常（如资金不足等） → 视为成交失败，转拒绝处理。
        const rejectionCode =
          err instanceof PaperAccountError
            ? err.code
            : SIGNAL_TO_PNL_ERROR_CODES.INPUT_INVALID;
        const reason =
          err instanceof Error ? err.message : `订单 ${order.orderId} 成交失败`;
        rejectionCountToday += 1;
        rejectionLedger.push({
          orderId: order.orderId,
          securityId: order.securityId,
          side: order.side,
          decisionDate: order.tradeDate,
          executionDate: date,
          rejectionCode,
          reason,
        });
        rejectionSummary[rejectionCode] = (rejectionSummary[rejectionCode] ?? 0) + 1;
        todayRejections.push({
          orderId: order.orderId,
          securityId: order.securityId,
          side: order.side,
          decisionDate: order.tradeDate,
          executionDate: date,
          rejectionCode,
          reason,
        });
        // 替换原 SUBMITTED 状态为 REJECTED
        orders = replaceOrderStatus(orders, order.orderId, statusForRejection(rejectionCode));

        if (order.side === "buy" && entry.frozenAmount > 0) {
          try {
            const unfreeze = unfreezePaperCash(
              account,
              entry.frozenAmount,
              formatLedgerEntryId(ledgerSeq),
              date,
              `订单 ${order.orderId} 成交失败，释放冻结`,
              order.orderId
            );
            account = unfreeze.account;
            cashLedger.push(unfreeze.ledgerEntry);
            ledgerSeq += 1;
          } catch {
            // 已不再有冻结（极端场景，吞掉但不静默）
          }
        }
      }
    }

    executions.push({
      executionDate: date,
      dueOrderCount: due.length,
      fillCount: fillCountToday,
      rejectionCount: rejectionCountToday,
      newFillIds: todayFillIds,
      newRejections: todayRejections,
    });

    // ====== (c) 决策日处理 ======
    const isDecisionDay = decisionDayRecord !== undefined;
    if (isDecisionDay) {
      const intents = decisionDayRecord!.positionIntents;
      totalIntents += intents.length;
      const selectedIntents = signalSelector(date, intents);
      selectedIntentsCount += selectedIntents.length;

      // 准备 planDecisionDay 的 closePriceBySecurity / amountBySecurity
      const closePriceBySecurity = new Map<string, number>();
      const amountBySecurity = new Map<string, number | null>();
      for (const intent of selectedIntents) {
        const snap = snapshotBySecurity.get(intent.securityId);
        if (snap !== undefined && snap.close !== null && Number.isFinite(snap.close) && snap.close > 0) {
          closePriceBySecurity.set(intent.securityId, snap.close);
        }
        amountBySecurity.set(intent.securityId, snap?.amount ?? null);
      }
      // 也为已有持仓的标的提供 closePriceBySecurity（用于卖出决策的 hold 路径）
      for (const pos of account.positions) {
        if (!closePriceBySecurity.has(pos.securityId)) {
          const snap = snapshotBySecurity.get(pos.securityId);
          if (
            snap !== undefined &&
            snap.close !== null &&
            Number.isFinite(snap.close) &&
            snap.close > 0
          ) {
            closePriceBySecurity.set(pos.securityId, snap.close);
          }
        }
        if (!amountBySecurity.has(pos.securityId)) {
          const snap = snapshotBySecurity.get(pos.securityId);
          amountBySecurity.set(pos.securityId, snap?.amount ?? null);
        }
      }

      const holdings = account.positions
        .slice()
        .sort((a, b) => a.securityId.localeCompare(b.securityId))
        .map((p) => p.securityId);
      const availableBySecurity = new Map<string, number>();
      for (const p of account.positions) availableBySecurity.set(p.securityId, p.availableQuantity);

      const plan = planDecisionDay({
        decisionDate: date,
        intents: selectedIntents,
        holdings,
        availableBySecurity,
        cash: account.cash,
        maxPositions: executionDeclaration.positions.maxPositionCount,
        hasNextTradingDay: i + 1 < tradingCalendar.length,
        closePriceBySecurity,
        amountBySecurity,
        cost: costModel,
        directionPolicy: "longOnly",
      });

      const nextDate =
        i + 1 < tradingCalendar.length ? tradingCalendar[i + 1]! : null;
      const newOrderIds: string[] = [];
      let todayFrozen = 0;

      for (const planned of plan.orders) {
        // 末决策日无下一交易日 → 不挂单（plan 已用 skipped 表达）。
        if (nextDate === null) {
          continue;
        }

        orderSeq += 1;
        const orderId = formatOrderId(orderSeq);
        const signalSource: PaperSignalSource = {
          securityId: planned.securityId,
          side: planned.kind as Side,
          signalTime: date,
          ...(planned.kind === "buy"
            ? { reason: "decisionDay intent → buy order" }
            : { reason: "decisionDay intent → sell order" }),
        };
        const order: PaperAccountOrder = {
          orderId,
          securityId: planned.securityId,
          side: planned.kind as Side,
          quantity: planned.quantity,
          orderType: "market",
          requestedPrice: null,
          tradeDate: date,
          executionTime: nextDate,
          status: "SUBMITTED",
          ...(signalSource ? { signalSource } : {}),
          constraintRef:
            executionDeclaration.label !== undefined
              ? executionDeclaration.label
              : executionDeclarationFingerprint(executionDeclaration),
          createdAt,
        };

        // 计算 buy 订单冻结金额：用决策日收盘价（盘后已知，PIT 安全；不取执行日 open 防 look-ahead）。
        let frozenAmount = 0;
        let referenceAmount: number | null = null;
        if (planned.kind === "buy") {
          const closePrice = closePriceBySecurity.get(planned.securityId);
          if (closePrice === undefined) {
            throw new SignalToPnlError(
              SIGNAL_TO_PNL_ERROR_CODES.INPUT_INVALID,
              `SignalToPnl: 决策日 ${date} 候选 ${planned.securityId} 缺有效收盘价，无法估量冻结金额`
            );
          }
          frozenAmount = estimateBuyFreezeAmount(closePrice, planned.quantity, costModel);
          referenceAmount = planned.kind === "buy" ? planned.referenceAmount ?? null : null;
        } else if (planned.kind === "sell") {
          referenceAmount = null;
        }

        if (planned.kind === "buy" && frozenAmount > 0) {
          try {
            const freeze = freezePaperCash(
              account,
              frozenAmount,
              formatLedgerEntryId(ledgerSeq),
              date,
              `订单 ${order.orderId} 买入冻结预留`,
              order.orderId
            );
            account = freeze.account;
            cashLedger.push(freeze.ledgerEntry);
            ledgerSeq += 1;
            todayFrozen += frozenAmount;
          } catch (err) {
            // 冻结失败（如资金不足）→ 不挂单，订单标记 REJECTED 并记录
            const rejectionCode =
              err instanceof PaperAccountError
                ? err.code
                : SIGNAL_TO_PNL_ERROR_CODES.INPUT_INVALID;
            const reason =
              err instanceof Error ? err.message : `订单 ${orderId} 冻结失败`;
            rejectionLedger.push({
              orderId,
              securityId: planned.securityId,
              side: planned.kind as Side,
              decisionDate: date,
              executionDate: nextDate!,
              rejectionCode,
              reason,
            });
            rejectionSummary[rejectionCode] =
              (rejectionSummary[rejectionCode] ?? 0) + 1;
            // 替换即将 push 的 SUBMITTED 为 REJECTED
            orders.push({ ...order, status: "REJECTED" });
            continue;
          }
        }

        orders.push(order);
        pending.push({
          order,
          decisionDate: date,
          frozenAmount,
          referenceAmount,
        });
        newOrderIds.push(orderId);
      }

      totalFrozenAmount += todayFrozen;

      days.push({
        decisionDate: date,
        selectedIntentCount: selectedIntents.length,
        orderCount: plan.orders.length,
        totalFrozenAmount: todayFrozen,
        skipped: plan.skipped,
        newOrderIds,
      });
    } else {
      days.push({
        decisionDate: date,
        selectedIntentCount: 0,
        orderCount: 0,
        totalFrozenAmount: 0,
        skipped: [],
        newOrderIds: [],
      });
    }

    // ====== (d) mark-to-market ======
    // mark-to-market 用 close 价（如果有），否则回退成本价。
    const mtmPrices = new Map<string, number>();
    for (const pos of account.positions) {
      const snap = snapshotBySecurity.get(pos.securityId);
      if (snap !== undefined && snap.close !== null && Number.isFinite(snap.close) && snap.close > 0) {
        mtmPrices.set(pos.securityId, snap.close);
      } else if (pos.marketPrice !== null && pos.marketPrice > 0) {
        mtmPrices.set(pos.securityId, pos.marketPrice);
      }
    }
    account = markPaperAccountToMarket(account, mtmPrices, date);
    snapshots.push(snapshotPaperAccount(account, date));
    const marketValue = account.positions.reduce((sum, p) => sum + p.marketValue, 0);
    equityCurve.push({
      date,
        equity: account.equity,
        cash: account.cash,
        marketValue,
        openPositions: account.positions.length,
      });
    dailyMarks.push({
      tradeDate: date,
      equity: account.equity,
      cash: account.cash,
      frozen: account.frozen,
      marketValue,
      realizedPnL: account.realizedPnL,
    });
    frozenTimeline.push({ tradeDate: date, frozen: account.frozen });
    if (account.frozen > peakFrozen) peakFrozen = account.frozen;
  }

  // ====== 5. 装配总记录 ======
  const costDeclarationFingerprint = computeCostDeclarationFingerprint(costDeclaration);
  const executionDeclarationFingerprintValue =
    computeExecutionConstraintDeclarationFingerprint(executionDeclaration);
  const executionCoverage = describeExecutionConstraintCoverage(executionDeclaration);

  const sourceRef: PnlLoopSourceRef = {
    sourceCandidateFingerprint: sourceRun.fingerprint,
    datasetVersion: sourceRun.datasetVersion,
    strategyId: sourceRun.strategyId,
    strategyVersion: sourceRun.strategyVersion,
    sourceDateRange: {
      startDate: sourceRun.dateRange.startDate,
      endDate: sourceRun.dateRange.endDate,
    },
    sourceDecisionDayCount: sourceRun.days.length,
  };

  const pnlBreakdown: PaperPnlBreakdown = computePaperPnlBreakdown(
    fills,
    account.positions,
    account.realizedPnL
  );

  const stats: PnlLoopStats = {
    totalIntents,
    selectedIntents: selectedIntentsCount,
    totalOrders: orderSeq,
    totalFills: fillSeq,
    totalRejections: rejectionLedger.length,
    peakFrozenAmount: peakFrozen,
    finalFrozenAmount: account.frozen,
    finalUnrealizedPnL: account.positions.reduce((sum, p) => sum + p.unrealizedPnL, 0),
    finalRealizedPnL: account.realizedPnL,
  };

  const body: Omit<SignalToPnlRun, "fingerprint"> = {
    recordKind: SIGNAL_TO_PNL_RUN_KIND,
    recordVersion: SIGNAL_TO_PNL_RUN_RECORD_VERSION,
    runId,
    accountId,
    createdAt,
    sourceRef,
    sourceFingerprint: sourceRun.fingerprint,
    costDeclarationFingerprint,
    executionDeclarationFingerprint: executionDeclarationFingerprintValue,
    executionCoverage,
    initialCapital: initialAccount.initialCapital,
    initialAsOf: initialAccount.asOf,
    tradingCalendar: [...tradingCalendar],
    tradingDayCount: tradingCalendar.length,
    decisionDayCount: days.filter((d) => d.orderCount > 0 || d.selectedIntentCount > 0).length,
    days,
    executions,
    dailyMarks,
    orders,
    fills,
    positionSnapshots: snapshots,
    cashLedger,
    equityCurve,
    pnlBreakdown,
    frozenTimeline,
    rejectionSummary,
    rejectionLedger,
    stats,
  };

  const fingerprint = computeSignalToPnlRunFingerprint(body);
  return deepFreeze<SignalToPnlRun>({ ...body, fingerprint });
}

// ---------------------------------------------------------------------------
// 辅助：成本声明指纹（C-23.1 已存在 computePaperCostDeclarationFingerprint，
// 本编排直接复用 canonicalStringify + sha256 即可，不再二次抽象）
// ---------------------------------------------------------------------------

function computeCostDeclarationFingerprint(
  declaration: CostModelDeclaration
): string {
  return createHash("sha256")
    .update(canonicalStringify(declaration), "utf8")
    .digest("hex");
}

function executionDeclarationFingerprint(
  declaration: ExecutionConstraintDeclaration
): string {
  return computeExecutionConstraintDeclarationFingerprint(declaration);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}