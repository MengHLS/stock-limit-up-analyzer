/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录：计划 vs 实际 机器核对（纯函数）。
 *
 * 职责：`reconcilePlanVsActual` 从注入的 planned intent（决策日 D 已知）+ actual fill
 * （成交时点 D+1 及之后）计算：
 *   - 数量差：actualQuantity − planned.quantity（FULL / PARTIAL / NONE 三态表达）；
 *   - 价格差：口径 = **实际成交价 vs planned 参考价**（参考价 = 决策日已知价格，
 *     见 ReconcilePlannedIntent.referencePrice / basis；参考价缺失 → 显式
 *     PRICE_DEVIATION_NO_REFERENCE + unassessed，绝不猜）；
 *   - 执行偏移：是否在 planned 执行窗口（D+1）内成交 + 相对 expectedExecutionDate 的
 *     交易日偏移（需调用方注入 tradingCalendar，缺省 → unassessed）；
 *   - 未成交原因：引用 C-23.2 编排审计 rejectionLedger 的约束违反 reasonCode（原样保留）。
 *
 * PIT 铁律：fill.timestamp 早于 planned.decisionDate = 时间序颠倒 → 响亮抛错
 * （TJ_TIME_ORDER_INVERTED）；本函数是纯计算，产出全部机器可计算维度，绝不产出
 * reason/emotion/ruleViolation 等主观内容（那些属 AnnotationBlock，人工注入）。
 *
 * 铁律：纯函数、readonly 入参、无 Date.now/Math.random/IO；输入非法即抛 TradeJournalError。
 */

import type {
  JournalActualFacts,
  JournalDeviation,
  JournalDeviationDimension,
  JournalFillState,
  ReconcileActualFill,
  ReconcilePlanVsActualInput,
  TJUnassessedReasonCode,
} from "./types";
import { TJ_UNASSESSED_REASON_CODES } from "./types";
import { TJ_ERROR_CODES, TradeJournalError } from "./errors";

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): void {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.INPUT_INVALID,
      `reconcile：${label}（${String(value)}）必须是合法 YYYY-MM-DD`
    );
  }
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.INPUT_INVALID,
      `reconcile：${label}（${String(value)}）必须为正有限数字`
    );
  }
}

// ---------------------------------------------------------------------------
// 成交聚合
// ---------------------------------------------------------------------------

/**
 * 由 reconcile 入参的成交流构建 JournalActualFacts（纯函数）。
 * fills 为空 → null。多笔成交：quantity 合计、price = 数量加权平均、
 * fillTimestamp = 末笔（字典序最大）、basePrice 取首笔非空 basePrice。
 */
export function buildJournalActualFacts(
  fills: readonly ReconcileActualFill[]
): JournalActualFacts | null {
  if (fills.length === 0) return null;
  let totalQuantity = 0;
  let weightedSum = 0;
  let lastTimestamp = fills[0]!.timestamp;
  let basePrice: number | null = null;
  const fillRefs: { fillId: string; quantity: number; price: number; timestamp: string }[] = [];
  for (const fill of fills) {
    totalQuantity += fill.quantity;
    weightedSum += fill.price * fill.quantity;
    if (fill.timestamp > lastTimestamp) lastTimestamp = fill.timestamp;
    if (basePrice === null && typeof fill.basePrice === "number" && Number.isFinite(fill.basePrice)) {
      basePrice = fill.basePrice;
    }
    fillRefs.push({
      fillId: fill.fillId,
      quantity: fill.quantity,
      price: fill.price,
      timestamp: fill.timestamp,
    });
  }
  fillRefs.sort((a, b) => a.fillId.localeCompare(b.fillId));
  return {
    fillRefs,
    quantity: totalQuantity,
    price: totalQuantity > 0 ? weightedSum / totalQuantity : 0,
    fillTimestamp: lastTimestamp,
    basePrice,
  };
}

/** 校验 reconcile 入参（planned 侧 + fills 侧交叉一致性 + PIT 时序）。 */
function assertReconcileInput(input: ReconcilePlanVsActualInput): void {
  const { planned, fills } = input;
  assertIsoDate(planned.decisionDate, "planned.decisionDate");
  assertIsoDate(planned.expectedExecutionDate, "planned.expectedExecutionDate");
  if (planned.expectedExecutionDate < planned.decisionDate) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.TIME_ORDER_INVERTED,
      `reconcile：planned.expectedExecutionDate（${planned.expectedExecutionDate}）早于 decisionDate（${planned.decisionDate}）——执行窗口不得早于决策日`
    );
  }
  assertFinitePositive(planned.quantity, "planned.quantity");
  if (
    !Number.isInteger(planned.executionWindowDays) ||
    planned.executionWindowDays < 1
  ) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.INPUT_INVALID,
      `reconcile：executionWindowDays（${String(planned.executionWindowDays)}）必须是 ≥1 的整数`
    );
  }
  if (planned.referencePrice !== null) assertFinitePositive(planned.referencePrice, "planned.referencePrice");
  if (planned.priceRangeLow !== null && planned.priceRangeHigh !== null) {
    if (planned.priceRangeLow > planned.priceRangeHigh) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.INPUT_INVALID,
        `reconcile：planned 价格带下界（${planned.priceRangeLow}）不得高于上界（${planned.priceRangeHigh}）`
      );
    }
  }
  const hasRejection = input.unfilledReasonCode !== null && input.unfilledReasonCode !== undefined;
  if (fills.length > 0 && hasRejection) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.INPUT_INVALID,
      `reconcile：成交流非空时不得同时携带 unfilledReasonCode（${String(input.unfilledReasonCode)}）——成交与拒绝互斥`
    );
  }
  for (const fill of fills) {
    assertIsoDate(fill.timestamp, "fill.timestamp");
    assertFinitePositive(fill.quantity, "fill.quantity");
    assertFinitePositive(fill.price, "fill.price");
    if (fill.securityId !== planned.securityId) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.RECONCILE_MISMATCH,
        `reconcile：成交 ${fill.fillId} 的 securityId（${fill.securityId}）与 planned（${planned.securityId}）不一致，拒绝核对`
      );
    }
    if (fill.side !== planned.side) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.RECONCILE_MISMATCH,
        `reconcile：成交 ${fill.fillId} 的方向（${fill.side}）与 planned（${planned.side}）不一致，拒绝核对`
      );
    }
    // PIT 铁律：actual 早于 planned → 响亮拒绝（时间序颠倒）。
    if (fill.timestamp < planned.decisionDate) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.TIME_ORDER_INVERTED,
        `reconcile：成交 ${fill.fillId} 的时点（${fill.timestamp}）早于决策日（${planned.decisionDate}），` +
          `实际不可早于计划——疑似事后回填伪装成当时决策，拒绝核对`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 机器偏差维度判定（确定性排序）
// ---------------------------------------------------------------------------

function sortedDimensions(dims: Set<JournalDeviationDimension>): JournalDeviationDimension[] {
  const order: readonly JournalDeviationDimension[] = [
    "UNFILLED",
    "PARTIAL_FILL",
    "QUANTITY",
    "PRICE",
    "TIMING",
  ];
  return order.filter((d) => dims.has(d));
}

// ---------------------------------------------------------------------------
// 主核对函数
// ---------------------------------------------------------------------------

/**
 * 计划 vs 实际 机器核对（纯函数）。
 *
 * fills 空 = 未成交（fillState=NONE）：unfilledReasonCode 引用 C-23.2 审计
 * rejectionLedger 的约束违反 reasonCode（原样保留，不翻译）。
 *
 * @throws TradeJournalError —— 时间序颠倒 / 成交与计划不一致 / 非法输入（FAIL FAST）。
 */
export function reconcilePlanVsActual(
  input: ReconcilePlanVsActualInput
): JournalDeviation {
  assertReconcileInput(input);
  const { planned, fills, tradingCalendar } = input;
  const unfilledReasonCode = input.unfilledReasonCode ?? null;
  const unfilledReasonText = input.unfilledReasonText ?? null;

  const actual = buildJournalActualFacts(fills);
  if (actual === null) {
    return {
      fillState: "NONE",
      actualQuantity: null,
      quantityDeviation: null,
      partialFillRemainingQuantity: null,
      actualFillPrice: null,
      actualFillTimestamp: null,
      priceDeviation: null,
      priceDeviationBasis: null,
      priceDeviationUnassessedReasonCode: TJ_UNASSESSED_REASON_CODES.NO_FILL_RECORDED,
      executedInPlannedWindow: null,
      executionOffsetTradingDays: null,
      executionOffsetUnassessedReasonCode:
        TJ_UNASSESSED_REASON_CODES.EXECUTION_OFFSET_CALENDAR_MISSING,
      unfilledReasonCode,
      unfilledReasonText,
      machineDeviationDimensions: sortedDimensions(new Set<JournalDeviationDimension>(["UNFILLED"])),
      reconcileNote:
        unfilledReasonCode !== null
          ? `未成交：${String(unfilledReasonCode)}（引用 C-23.2 编排审计 reasonCode）`
          : "无成交记录（未提供 fill 也未提供未成交审计码）",
    };
  }

  // ---- 成交状态与数量偏差 ----
  let fillState: JournalFillState = "FULL";
  if (actual.quantity < planned.quantity) fillState = "PARTIAL";
  const quantityDeviation = actual.quantity - planned.quantity;
  const partialFillRemainingQuantity =
    actual.quantity < planned.quantity ? planned.quantity - actual.quantity : null;

  // ---- 价格偏差（口径：实际成交价 vs planned 参考价） ----
  let priceDeviation: number | null = null;
  let priceDeviationBasis: string | null = null;
  let priceDeviationUnassessedReasonCode: TJUnassessedReasonCode | null = null;
  if (planned.referencePrice !== null && planned.referencePrice > 0) {
    priceDeviation = actual.price - planned.referencePrice;
    priceDeviationBasis =
      planned.referencePriceBasis !== null && planned.referencePriceBasis !== ""
        ? `实际成交价 − ${planned.referencePriceBasis}`
        : "实际成交价 − planned 参考价";
  } else {
    priceDeviationUnassessedReasonCode =
      TJ_UNASSESSED_REASON_CODES.PRICE_DEVIATION_NO_REFERENCE;
  }

  // ---- 执行偏移 ----
  let executedInPlannedWindow: boolean | null = null;
  let executionOffsetTradingDays: number | null = null;
  let executionOffsetUnassessedReasonCode: TJUnassessedReasonCode | null = null;
  const hasCalendar = tradingCalendar !== null && tradingCalendar !== undefined;
  if (hasCalendar) {
    const execIndex = tradingCalendar.indexOf(planned.expectedExecutionDate);
    const fillIndex = tradingCalendar.indexOf(actual.fillTimestamp);
    if (execIndex >= 0 && fillIndex >= 0) {
      executionOffsetTradingDays = fillIndex - execIndex;
      // 窗口 = [expectedExecutionDate, expectedExecutionDate + windowDays - 1]（交易日）。
      executedInPlannedWindow =
        executionOffsetTradingDays >= 0 &&
        executionOffsetTradingDays < planned.executionWindowDays;
    } else {
      executedInPlannedWindow = null;
      executionOffsetTradingDays = null;
      executionOffsetUnassessedReasonCode =
        TJ_UNASSESSED_REASON_CODES.EXECUTION_OFFSET_CALENDAR_MISSING;
    }
  } else {
    // 无交易日历：按字符串精确比较判断「是否恰在 expectedExecutionDate 成交」。
    executedInPlannedWindow = actual.fillTimestamp === planned.expectedExecutionDate;
    executionOffsetUnassessedReasonCode =
      TJ_UNASSESSED_REASON_CODES.EXECUTION_OFFSET_CALENDAR_MISSING;
  }

  // ---- 机器偏差维度 ----
  const dims = new Set<JournalDeviationDimension>();
  if (fillState === "PARTIAL") {
    dims.add("PARTIAL_FILL");
    dims.add("QUANTITY");
  } else if (quantityDeviation !== 0) {
    // 全额成交但数量不一致（超额/亏额全额成交）→ QUANTITY。
    dims.add("QUANTITY");
  }
  if (
    planned.priceRangeLow !== null &&
    planned.priceRangeHigh !== null &&
    (actual.price < planned.priceRangeLow || actual.price > planned.priceRangeHigh)
  ) {
    dims.add("PRICE");
  }
  if (executedInPlannedWindow === false) dims.add("TIMING");

  const noteParts: string[] = [];
  if (fillState === "PARTIAL") {
    noteParts.push(`部分成交：实际 ${actual.quantity} 股 / planned ${planned.quantity} 股`);
  }
  if (quantityDeviation !== 0 && fillState !== "PARTIAL") {
    noteParts.push(`数量偏差 ${quantityDeviation > 0 ? "+" : ""}${quantityDeviation} 股`);
  }
  if (noteParts.length === 0 && executedInPlannedWindow === true) {
    noteParts.push("按 planned 执行窗口（D+1）成交，无数量/时机偏差");
  }

  return {
    fillState,
    actualQuantity: actual.quantity,
    quantityDeviation,
    partialFillRemainingQuantity,
    actualFillPrice: actual.price,
    actualFillTimestamp: actual.fillTimestamp,
    priceDeviation,
    priceDeviationBasis,
    priceDeviationUnassessedReasonCode,
    executedInPlannedWindow,
    executionOffsetTradingDays,
    executionOffsetUnassessedReasonCode,
    unfilledReasonCode: null,
    unfilledReasonText: null,
    machineDeviationDimensions: sortedDimensions(dims),
    reconcileNote: noteParts.length > 0 ? noteParts.join("；") : null,
  };
}
