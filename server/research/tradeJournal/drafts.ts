/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录：从 C-23.2 run 提取 journal 素材（draft builder）。
 *
 * 职责：读取 SignalToPnlRun（C-23.2）的订单流 / 成交流 / 拒绝审计，为每笔订单生成
 * 一条「待标注 draft」TradeJournalEntry：
 *   - planned 事实 = 决策日生成的订单意图（run.orders，含 tradeDate=决策日 D）；
 *   - actual 事实   = executionTime 的成交流（run.fills）；
 *   - 未成交原因    = run.rejectionLedger 的约束违反 reasonCode（原样引用，不翻译）；
 *   - planned vs actual 机器核对（reconcilePlanVsActual）自动填，annotation=null 待人工；
 *   - run 里无对应记录处诚实跳过 + 计数（skipped + counts）。
 *
 * planned 参考价口径（PIT 安全说明）：
 *   run 的订单不存价格字段（market order，requestedPrice=null），决策日 D close 也未
 *   逐单落盘；但成交记录 fill.basePrice = 执行日前一交易日收盘价，而 C-23.2 保证订单
 *   executionTime = tradingCalendar 中 tradeDate 的下一交易日（相邻交易日不变量），故
 *   fill.basePrice 数值恰为决策日 D close（已知于 D，PIT 安全）。本构建器**先实查
 *   相邻性**（order.executionTime === calendar[index(tradeDate)+1]），断言通过才将该值
 *   作为 planned.referencePrice 并标注 basis；断言失败 → 显式 unassessed
 *   （EXECUTION_DAY_NON_ADJACENT），绝不猜。REJECTED 订单无成交 → 参考价 unassessed。
 *
 * 铁律：纯函数、readonly、无 IO/Date.now/Math.random；来源 run 必须结构有效 + 指纹
 * 一致（assertValidSignalToPnlRun + computeSignalToPnlRunFingerprint），不一致响亮抛错；
 * 不产出任何 reason/emotion/rule violation（annotation=null，留给人工）。
 */

import type { PaperAccountOrder } from "../paperAccount/types";
import type { SignalToPnlRun } from "../signalToPnl/types";
import { assertValidSignalToPnlRun } from "../signalToPnl/validate";
import { computeSignalToPnlRunFingerprint } from "../signalToPnl/serialize";
import { TJ_ERROR_CODES, TradeJournalError } from "./errors";
import type {
  JournalDraftExtraction,
  JournalDraftSkipRecord,
  JournalOrderRef,
  JournalRunRef,
  ReconcileActualFill,
  TJUnassessedReasonCode,
  TradeJournalEntry,
} from "./types";
import { TJ_UNASSESSED_REASON_CODES, JOURNAL_DRAFT_SKIP_REASON_CODES } from "./types";
import { buildJournalActualFacts, reconcilePlanVsActual } from "./reconcile";
import { computeTradeJournalEntryFingerprint } from "./serialize";
import {
  TRADE_JOURNAL_ENTRY_KIND,
  TRADE_JOURNAL_ENTRY_RECORD_VERSION,
} from "./types";

/** draft 构建选项。 */
export interface BuildJournalDraftsOptions {
  /** 条目录入时点（注入式 ISO-8601 UTC；必须不早于该 run 的成交时点，校验在 validate）。 */
  readonly createdAt: string;
}

/** 内部：按订单聚合的成交 + 拒绝审计。 */
interface OrderAuditContext {
  readonly fills: readonly ReconcileActualFill[];
  readonly rejectionCode: string | null;
  readonly rejectionReason: string | null;
}

/** 构建 journalId / entryId（确定性；跨 run 不冲突）。 */
export function journalIdOf(runId: string, orderId: string): string {
  return `${runId}#${orderId}`;
}

export function journalEntryIdOf(journalId: string, version: number): string {
  return `${journalId}#v${version}`;
}

/**
 * 从 SignalToPnlRun 提取 journal draft（每笔订单 → 一条 draft entry）。
 *
 * @throws TradeJournalError —— run 结构/指纹不合法、订单终态与成交流矛盾等记录不一致。
 */
export function buildJournalDraftsFromRun(
  run: SignalToPnlRun,
  options: BuildJournalDraftsOptions
): JournalDraftExtraction {
  // ====== 1. 来源可信复核 ======
  assertValidSignalToPnlRun(run);
  const recomputed = computeSignalToPnlRunFingerprint(run);
  if (run.fingerprint !== recomputed) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.DRAFTS_RUN_FINGERPRINT_MISMATCH,
      `buildJournalDraftsFromRun：来源 SignalToPnlRun 指纹不一致（期望 ${recomputed}，实际 ${run.fingerprint}）`
    );
  }
  if (typeof options?.createdAt !== "string" || options.createdAt.trim() === "") {
    throw new TradeJournalError(
      TJ_ERROR_CODES.INPUT_INVALID,
      "buildJournalDraftsFromRun：options.createdAt 必须是非空注入式时间戳"
    );
  }

  // ====== 2. 索引 ======
  const orders = run.orders;
  const fillsByOrder = new Map<string, ReconcileActualFill[]>();
  for (const fill of run.fills) {
    const list = fillsByOrder.get(fill.orderId);
    const entry: ReconcileActualFill = {
      fillId: fill.fillId,
      securityId: fill.securityId,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      timestamp: fill.timestamp,
      basePrice: fill.basePrice,
    };
    if (list === undefined) fillsByOrder.set(fill.orderId, [entry]);
    else list.push(entry);
  }
  const rejectionByOrder = new Map<string, { code: string; reason: string }>();
  for (const rejection of run.rejectionLedger) {
    if (!rejectionByOrder.has(rejection.orderId)) {
      rejectionByOrder.set(rejection.orderId, {
        code: rejection.rejectionCode,
        reason: rejection.reason,
      });
    }
  }
  const orderIds = new Set(orders.map((o) => o.orderId));

  // ====== 3. 孤儿成交计数（run 中无对应订单的成交——诚实跳过 + 计数） ======
  const skipped: JournalDraftSkipRecord[] = [];
  let orphanFills = 0;
  for (const fill of run.fills) {
    if (!orderIds.has(fill.orderId)) {
      orphanFills += 1;
      skipped.push({
        ref: fill.fillId,
        reasonCode: JOURNAL_DRAFT_SKIP_REASON_CODES.ORPHAN_FILL,
        reason: `成交 ${fill.fillId}（securityId=${fill.securityId}）无对应订单，不进入日志`,
      });
    }
  }

  // ====== 4. 逐订单构建 ======
  const entries: TradeJournalEntry[] = [];
  let skippedOrders = 0;
  for (const order of orders) {
    const audit = resolveOrderAudit(order, fillsByOrder, rejectionByOrder);
    if (audit === null) {
      // 终态与记录不一致 / 非终态 —— 诚实跳过 + 计数（不建日志、不静默）。
      skippedOrders += 1;
      skipped.push({
        ref: order.orderId,
        reasonCode: skipReasonForOrder(order, fillsByOrder, rejectionByOrder),
        reason: `订单 ${order.orderId}（status=${order.status}）不能生成日志条目`,
      });
      continue;
    }

    const entry = buildDraftEntryForOrder(run, order, audit, options.createdAt);
    entries.push(entry);
  }

  // ====== 5. 汇总 ======
  const unJournaledIntents = run.days.reduce((sum, day) => sum + day.skipped.length, 0);
  entries.sort((a, b) => a.entryId.localeCompare(b.entryId));
  skipped.sort((a, b) => a.ref.localeCompare(b.ref));

  const counts = {
    ordersInRun: orders.length,
    fillsInRun: run.fills.length,
    entriesBuilt: entries.length,
    skippedOrders,
    orphanFills,
    unJournaledIntents,
  };

  return { entries, skipped, counts };
}

/** 解析单订单的成交 + 拒绝审计上下文；记录不一致/非终态 → null（调用方跳过计数）。 */
function resolveOrderAudit(
  order: PaperAccountOrder,
  fillsByOrder: ReadonlyMap<string, ReconcileActualFill[]>,
  rejectionByOrder: ReadonlyMap<string, { code: string; reason: string }>
): OrderAuditContext | null {
  const fills = fillsByOrder.get(order.orderId) ?? [];
  const rejection = rejectionByOrder.get(order.orderId) ?? null;

  if (order.status === "FILLED" || order.status === "PARTIALLY_FILLED") {
    if (fills.length === 0) return null; // 终态成交但无成交记录 → 不一致。
    return { fills, rejectionCode: null, rejectionReason: null };
  }
  if (order.status === "REJECTED") {
    if (rejection === null) return null; // 终态拒绝但无拒绝审计 → 不一致。
    return { fills: [], rejectionCode: rejection.code, rejectionReason: rejection.reason };
  }
  // NEW / SUBMITTED / CANCELLED / EXPIRED：非终态 → 不建日志（跳过）。
  return null;
}

function skipReasonForOrder(
  order: PaperAccountOrder,
  fillsByOrder: ReadonlyMap<string, ReconcileActualFill[]>,
  rejectionByOrder: ReadonlyMap<string, { code: string; reason: string }>
): JournalDraftSkipRecord["reasonCode"] {
  const fills = fillsByOrder.get(order.orderId) ?? [];
  const rejection = rejectionByOrder.get(order.orderId) ?? null;
  if ((order.status === "FILLED" || order.status === "PARTIALLY_FILLED") && fills.length === 0) {
    return JOURNAL_DRAFT_SKIP_REASON_CODES.ORDER_FILL_RECORD_MISSING;
  }
  if (order.status === "REJECTED" && rejection === null) {
    return JOURNAL_DRAFT_SKIP_REASON_CODES.ORDER_REJECT_RECORD_MISSING;
  }
  return JOURNAL_DRAFT_SKIP_REASON_CODES.ORDER_NON_TERMINAL;
}

/** 判定决策日与执行日是否为 run 交易日历中的相邻交易日。 */
function isAdjacentTradingDay(run: SignalToPnlRun, decisionDate: string, executionDate: string): boolean {
  const index = run.tradingCalendar.indexOf(decisionDate);
  if (index < 0 || index + 1 >= run.tradingCalendar.length) return false;
  return run.tradingCalendar[index + 1] === executionDate;
}

/** 为单订单装配 draft entry（planned/actual/deviation 自动填；annotation=null）。 */
function buildDraftEntryForOrder(
  run: SignalToPnlRun,
  order: PaperAccountOrder,
  audit: OrderAuditContext,
  createdAt: string
): TradeJournalEntry {
  const securityId = order.securityId;
  const side = order.side;
  const decisionDate = order.tradeDate;
  const expectedExecutionDate = order.executionTime;

  // ---- planned 参考价（PIT 安全：仅当相邻交易日不变量成立时用 fill.basePrice 推断） ----
  let referencePrice: number | null = null;
  let referencePriceBasis: string | null = null;
  let referencePriceUnassessedReasonCode: TJUnassessedReasonCode | null =
    TJ_UNASSESSED_REASON_CODES.PLANNED_PRICE_REFERENCE_MISSING;
  const adjacent = isAdjacentTradingDay(run, decisionDate, expectedExecutionDate);
  if (audit.fills.length > 0) {
    const basePrice = audit.fills[0]!.basePrice ?? null;
    if (adjacent && basePrice !== null && Number.isFinite(basePrice) && basePrice > 0) {
      referencePrice = basePrice;
      referencePriceUnassessedReasonCode = null;
      referencePriceBasis =
        "决策日 close（成交记录 basePrice = 执行日前一交易日收盘价；run 相邻交易日不变量保证其等于决策日 D close）";
    } else if (!adjacent) {
      referencePriceUnassessedReasonCode = TJ_UNASSESSED_REASON_CODES.EXECUTION_DAY_NON_ADJACENT;
    } else {
      referencePriceUnassessedReasonCode = TJ_UNASSESSED_REASON_CODES.PLANNED_PRICE_REFERENCE_MISSING;
    }
  }

  // ---- planned 价格带（市价单计划未定义价格带；限价单 = 单点带） ----
  let priceRangeLow: number | null = null;
  let priceRangeHigh: number | null = null;
  let priceRangeUnassessedReasonCode: TJUnassessedReasonCode | null =
    TJ_UNASSESSED_REASON_CODES.PLANNED_PRICE_RANGE_NOT_DEFINED;
  if (order.orderType === "limit" && order.requestedPrice !== null && Number.isFinite(order.requestedPrice) && order.requestedPrice > 0) {
    priceRangeLow = order.requestedPrice;
    priceRangeHigh = order.requestedPrice;
    priceRangeUnassessedReasonCode = null;
  }

  // ---- 机器核对 ----
  const deviation = reconcilePlanVsActual({
    planned: {
      securityId,
      side,
      quantity: order.quantity,
      decisionDate,
      expectedExecutionDate,
      executionWindowDays: 1,
      referencePrice,
      referencePriceBasis,
      priceRangeLow,
      priceRangeHigh,
    },
    fills: audit.fills,
    unfilledReasonCode: audit.rejectionCode,
    unfilledReasonText: audit.rejectionReason,
    tradingCalendar: run.tradingCalendar,
  });

  const actual = buildJournalActualFacts(audit.fills);
  const journalId = journalIdOf(run.runId, order.orderId);

  const orderRef: JournalOrderRef = {
    orderId: order.orderId,
    status: order.status,
    orderType: order.orderType,
    requestedPrice: order.requestedPrice,
  };
  const runRef: JournalRunRef = {
    kind: "SIGNAL_TO_PNL_RUN",
    runId: run.runId,
    accountId: run.accountId,
    datasetVersion: run.sourceRef.datasetVersion,
    strategyId: run.sourceRef.strategyId,
    strategyVersion: run.sourceRef.strategyVersion,
    sourceCandidateFingerprint: run.sourceFingerprint,
  };

  const body: Omit<TradeJournalEntry, "fingerprint"> = {
    recordKind: TRADE_JOURNAL_ENTRY_KIND,
    recordVersion: TRADE_JOURNAL_ENTRY_RECORD_VERSION,
    entryId: journalEntryIdOf(journalId, 1),
    journalId,
    entryVersion: 1,
    supersedesEntryId: null,
    createdAt,
    runRef,
    orderRef,
    securityId,
    side,
    decisionDate,
    expectedExecutionDate,
    planned: {
      quantity: order.quantity,
      executionWindowDays: 1,
      referencePrice,
      referencePriceBasis,
      referencePriceUnassessedReasonCode,
      priceRangeLow,
      priceRangeHigh,
      priceRangeUnassessedReasonCode,
    },
    actual,
    deviation,
    annotation: null,
  };
  const fingerprint = computeTradeJournalEntryFingerprint(body);
  return { ...body, fingerprint };
}
