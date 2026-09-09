/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录：单测。
 *
 * 测试覆盖（对照任务要求 7）：
 *   A. reconcilePlanVsActual 机器核对正确性（手算数量差/价格差/未成交/部分成交/VWAP/时机）
 *   B. draft 提取（小样本 SignalToPnlRun → 正确 draft 数 / 字段映射 / 拒绝单 UNFILLED 引用）
 *   C. 日志账本 append-only（篡改已落账 entry → 拒绝或断链检出）+ supersedes 修订链
 *   D. PostReviewRecord 复盘快照（单笔/批量 + C-16.3 引用不重算）
 *   E. PIT 时序（planned 早于 actual；事后补录/标注 → 拒绝）
 *   F. 确定性 + round-trip 篡改拒绝 + 退化输入
 */

import { describe, expect, it } from "vitest";
import { createExecutionConstraintDeclaration } from "../executionConstraints/factory";
import { computeCandidateEvaluationRunFingerprint } from "../signalEngine";
import { createPaperAccount } from "../paperAccount/account";
import { PAPER_ACCOUNT_ERROR_CODES } from "../paperAccount/errors";
import type { PaperAccount } from "../paperAccount/types";
import type {
  CandidateDayRecord,
  CandidateEvaluationRun,
  CandidateRunEvaluation,
  SecuritySelectionStat,
} from "../signalEngine/types";
import type { DirectionCounts, PositionIntent } from "../framework/contract";
import type { DecisionPoint } from "../../data";
import type { CostModelDeclaration } from "../costModel/types";
import type { ExecutionConstraintDeclaration } from "../executionConstraints/types";
import type { ResearchParameterSet } from "../types";
import { runSignalToPnlLoop } from "../signalToPnl/engine";
import type {
  PnlLoopPriceSnapshot,
  PnlLoopPriceSource,
  SignalToPnlLoopInput,
  SignalToPnlRun,
} from "../signalToPnl/types";
import {
  buildJournalDraftsFromRun,
  TradeJournalLedger,
  reconcilePlanVsActual,
  createPostReviewRecord,
  createTradeQualityMetricsReference,
  withJournalAnnotation,
  annotateJournalEntry,
  journalIdOf,
  journalEntryIdOf,
  serializeTradeJournalEntry,
  deserializeTradeJournalEntry,
  computeTradeJournalEntryFingerprint,
  assertValidTradeJournalEntry,
  validateTradeJournalEntry,
  TRADE_JOURNAL_ENTRY_KIND,
  TJ_UNASSESSED_REASON_CODES,
  TJ_ERROR_CODES,
  TradeJournalError,
} from ".";

// ---------------------------------------------------------------------------
// 通用 fixture 构造（对齐 C-23.2 signalToPnl.test.ts 的 fixture 形态）
// ---------------------------------------------------------------------------

function snapshot(
  open: number | null,
  prevClose: number | null,
  close: number | null,
  amount: number | null = null
): PnlLoopPriceSnapshot {
  return { open, prevClose, close, amount };
}

function buildCostDeclaration(): CostModelDeclaration {
  return {
    name: "TEST_COST_A_SHARE_STANDARD",
    commissionRate: 0.00025,
    stampDutyRate: 0.0005,
    transferFeeRate: 0.00001,
    slippageBps: 5,
    lotSize: 100,
    minCommission: 5,
    marketImpact: {
      enabled: false,
      coefficient: 10,
      exponent: 0.5,
      maxBps: 100,
      maxParticipation: 0.5,
    },
  };
}

function buildExecutionDeclaration(
  overrides?: Partial<{ initialCapital: number; maxPositionCount: number | null; blockLimitUpBuy: boolean }>
): ExecutionConstraintDeclaration {
  return createExecutionConstraintDeclaration({
    label: "TEST_PAPER_CONSTRAINT",
    initialCapital: overrides?.initialCapital ?? 1_000_000,
    positions: { maxPositionCount: overrides?.maxPositionCount ?? 5, perSecurityEquityCap: null, totalEquityCap: null },
    lot: { lotSize: 100 },
    restrictions: { blockLimitUpBuy: overrides?.blockLimitUpBuy ?? true, blockLimitDownSell: true, buyBanned: [], sellBanned: [] },
    timing: { executionModel: "NEXT_OPEN", allowPartialFill: false },
    marketClaims: {
      tPlus1: true,
      decisionPoint: "close",
      directionPolicy: "longOnly",
      suspensionMode: "REJECT_NO_BAR",
      corporateActions: "NOT_APPLIED",
      boards: {},
    },
  });
}

function intent(
  securityId: string,
  rank: number,
  weight = 1,
  value = 1,
  direction: "long" | "short" | "neutral" = "long"
): PositionIntent {
  return { securityId, direction, rank, percentile: 1 - rank * 0.1, weight, signalValue: value };
}

/** 最小化但完全合法的 CandidateEvaluationRun（绕过 runCandidateEngine）。 */
function buildCandidateRun(
  days: readonly CandidateDayRecord[],
  options?: Partial<{ datasetVersion: string; dateRange: { startDate: string; endDate: string }; point: DecisionPoint }>
): CandidateEvaluationRun {
  const startDate = days[0]?.date ?? "2024-01-01";
  const endDate = days[days.length - 1]?.date ?? startDate;
  const distinctUniverse = Array.from(new Set(days.flatMap((d) => d.universeMembers))).sort();
  const distinctSelected = Array.from(new Set(days.flatMap((d) => d.selected.map((s) => s.securityId)))).sort();
  const allValues = days.flatMap((d) => d.selected.map((s) => s.value));
  const dirCounts: DirectionCounts = { long: 0, short: 0, neutral: 0 };
  for (const day of days) for (const pi of day.positionIntents) dirCounts[pi.direction] += 1;
  const selectionStatMap = new Map<string, number>();
  for (const day of days) {
    const seen = new Set<string>();
    for (const sel of day.selected) {
      if (!seen.has(sel.securityId)) {
        seen.add(sel.securityId);
        selectionStatMap.set(sel.securityId, (selectionStatMap.get(sel.securityId) ?? 0) + 1);
      }
    }
  }
  const selectionStats: SecuritySelectionStat[] = Array.from(selectionStatMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([securityId, count]) => ({ securityId, selectionDays: count, selectionFrequency: days.length > 0 ? count / days.length : 0 }));
  const evaluation: CandidateRunEvaluation = {
    decisionDayCount: days.length,
    dates: days.map((d) => d.date),
    totalSelectedSlots: days.reduce((s, d) => s + d.selected.length, 0),
    meanSelectedPerDay: days.length > 0 ? days.reduce((s, d) => s + d.selected.length, 0) / days.length : 0,
    minSelectedPerDay: days.length > 0 ? Math.min(...days.map((d) => d.selected.length)) : 0,
    maxSelectedPerDay: days.length > 0 ? Math.max(...days.map((d) => d.selected.length)) : 0,
    distinctUniverseSecurities: distinctUniverse,
    distinctSelectedSecurities: distinctSelected,
    universeCoveragePct: distinctUniverse.length > 0 ? (distinctSelected.length / distinctUniverse.length) * 100 : 0,
    selectionStats,
    alwaysSelectedSecurities: selectionStats.filter((s) => s.selectionDays === days.length).map((s) => s.securityId),
    selectedDirectionCounts: dirCounts,
    meanSelectedValue: allValues.length > 0 ? allValues.reduce((s, v) => s + v, 0) / allValues.length : 0,
    minSelectedValue: allValues.length > 0 ? Math.min(...allValues) : 0,
    maxSelectedValue: allValues.length > 0 ? Math.max(...allValues) : 0,
  };
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: "CANDIDATE_EVALUATION_RUN",
    recordVersion: 1,
    datasetVersion: options?.datasetVersion ?? "ds-test-001",
    builderVersion: "builder-test-001",
    rowSchemaVersion: "row-v1",
    datasetGate: "ALLOW",
    universeId: "research-dataset:ds-test-001",
    strategyId: "strat-test-001",
    strategyVersion: "1.0.0",
    parameters: { lookback: 20 } satisfies ResearchParameterSet,
    dateRange: options?.dateRange ?? { startDate, endDate },
    point: options?.point ?? "close",
    featureVersions: [],
    rankingConfig: { higherIsBetter: true },
    selectionConfig: { method: { kind: "topN", n: 5 } },
    days,
    evaluation,
  };
  const fingerprint = computeCandidateEvaluationRunFingerprint(body);
  return { ...body, fingerprint };
}

function buildDay(date: string, intents: readonly PositionIntent[], universeMembers: readonly string[] = []): CandidateDayRecord {
  const universe = universeMembers.length > 0
    ? Array.from(new Set([...universeMembers, ...intents.map((i) => i.securityId)])).sort()
    : Array.from(new Set(intents.map((i) => i.securityId))).sort();
  const selected = intents
    .filter((i) => i.direction === "long")
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.securityId.localeCompare(b.securityId)))
    .map((pi) => ({ securityId: pi.securityId, rank: pi.rank, percentile: pi.percentile, value: pi.signalValue }));
  return { date, universeMembers: universe, signalCount: intents.length, dropped: [], selected, positionIntents: intents };
}

function buildPriceSource(byDate: ReadonlyMap<string, ReadonlyMap<string, PnlLoopPriceSnapshot>>): PnlLoopPriceSource {
  return (date, securityId) => {
    const dateMap = byDate.get(date);
    if (dateMap === undefined) return null;
    return dateMap.get(securityId) ?? null;
  };
}

function buildLoopInput(input: {
  readonly sourceRun: CandidateEvaluationRun;
  readonly tradingCalendar: readonly string[];
  readonly priceSource: PnlLoopPriceSource;
  readonly initialAccount?: PaperAccount;
  readonly costDeclaration?: CostModelDeclaration;
  readonly executionDeclaration?: ExecutionConstraintDeclaration;
  readonly runId?: string;
  readonly accountId?: string;
  readonly createdAt?: string;
}): SignalToPnlLoopInput {
  return {
    runId: input.runId ?? "run-tj-test-001",
    accountId: input.accountId ?? "acct-tj-001",
    createdAt: input.createdAt ?? "2024-01-01T00:00:00Z",
    sourceRun: input.sourceRun,
    initialAccount: input.initialAccount ?? createPaperAccount({ accountId: "acct-tj-001", initialCapital: 2000, asOf: "2024-01-01" }),
    costDeclaration: input.costDeclaration ?? buildCostDeclaration(),
    executionDeclaration: input.executionDeclaration ?? buildExecutionDeclaration({ initialCapital: 2000 }),
    tradingCalendar: input.tradingCalendar,
    priceSource: input.priceSource,
  };
}

// ---------------------------------------------------------------------------
// A. reconcilePlanVsActual 机器核对正确性
// ---------------------------------------------------------------------------

describe("A. reconcilePlanVsActual 机器核对", () => {
  const planned = {
    securityId: "600000.SH",
    side: "buy" as const,
    quantity: 100,
    decisionDate: "2024-01-02",
    expectedExecutionDate: "2024-01-03",
    executionWindowDays: 1,
    referencePrice: 10,
    referencePriceBasis: "决策日 close",
    priceRangeLow: null,
    priceRangeHigh: null,
  };

  it("A1 全额成交：数量差 0；价格差手算（参考价 10 vs 成交价 10.3 → +0.3）", () => {
    const result = reconcilePlanVsActual({
      planned,
      fills: [{ fillId: "F1", securityId: "600000.SH", side: "buy", quantity: 100, price: 10.3, timestamp: "2024-01-03" }],
      tradingCalendar: ["2024-01-02", "2024-01-03"],
    });
    expect(result.fillState).toBe("FULL");
    expect(result.quantityDeviation).toBe(0);
    expect(result.actualQuantity).toBe(100);
    expect(result.actualFillPrice).toBe(10.3);
    expect(result.priceDeviation).toBeCloseTo(0.3, 10);
    expect(result.priceDeviationBasis).toContain("实际成交价 −");
    expect(result.priceDeviationBasis).toContain("决策日 close");
    expect(result.executedInPlannedWindow).toBe(true);
    expect(result.executionOffsetTradingDays).toBe(0);
    expect(result.machineDeviationDimensions).toEqual([]);
  });

  it("A2 部分成交：数量差 −50；PARTIAL_FILL + QUANTITY 维度；剩余 50", () => {
    const result = reconcilePlanVsActual({
      planned,
      fills: [{ fillId: "F1", securityId: "600000.SH", side: "buy", quantity: 60, price: 10.2, timestamp: "2024-01-03" }],
      tradingCalendar: ["2024-01-02", "2024-01-03"],
    });
    expect(result.fillState).toBe("PARTIAL");
    expect(result.quantityDeviation).toBe(-40);
    expect(result.partialFillRemainingQuantity).toBe(40);
    expect(result.actualQuantity).toBe(60);
    expect(result.machineDeviationDimensions).toEqual(["PARTIAL_FILL", "QUANTITY"]);
  });

  it("A3 两笔部分成交聚合：VWAP 价格与数量合计", () => {
    const result = reconcilePlanVsActual({
      planned,
      fills: [
        { fillId: "F1", securityId: "600000.SH", side: "buy", quantity: 60, price: 10, timestamp: "2024-01-03" },
        { fillId: "F2", securityId: "600000.SH", side: "buy", quantity: 40, price: 11, timestamp: "2024-01-04" },
      ],
      tradingCalendar: ["2024-01-02", "2024-01-03", "2024-01-04"],
    });
    expect(result.fillState).toBe("FULL");
    expect(result.actualQuantity).toBe(100);
    // VWAP = (60*10 + 40*11)/100 = 10.4
    expect(result.actualFillPrice).toBeCloseTo(10.4, 10);
    expect(result.priceDeviation).toBeCloseTo(0.4, 10);
    // 第二笔在 2024-01-04（窗口外）→ TIMING
    expect(result.executedInPlannedWindow).toBe(false);
    expect(result.executionOffsetTradingDays).toBe(1);
    expect(result.machineDeviationDimensions).toEqual(["TIMING"]);
  });

  it("A4 未成交：引用 C-23.2 审计 reasonCode 原样保留 + UNFILLED 维度", () => {
    const result = reconcilePlanVsActual({
      planned,
      fills: [],
      unfilledReasonCode: PAPER_ACCOUNT_ERROR_CODES.CHECK_LIMIT_UP,
      unfilledReasonText: "开盘涨停拒买",
      tradingCalendar: ["2024-01-02", "2024-01-03"],
    });
    expect(result.fillState).toBe("NONE");
    expect(result.actualQuantity).toBeNull();
    expect(result.unfilledReasonCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_LIMIT_UP);
    expect(result.unfilledReasonText).toBe("开盘涨停拒买");
    expect(result.machineDeviationDimensions).toEqual(["UNFILLED"]);
    expect(result.reconcileNote).toContain(PAPER_ACCOUNT_ERROR_CODES.CHECK_LIMIT_UP);
  });

  it("A5 无成交也无可引用审计码：NONE + NO_FILL_RECORDED + 显式附注", () => {
    const result = reconcilePlanVsActual({ planned, fills: [] });
    expect(result.fillState).toBe("NONE");
    expect(result.priceDeviationUnassessedReasonCode).toBe(TJ_UNASSESSED_REASON_CODES.NO_FILL_RECORDED);
    expect(result.reconcileNote).toContain("无成交记录");
  });

  it("A6 无 planned 参考价：价格偏差显式 unassessed（PRICE_DEVIATION_NO_REFERENCE），不猜", () => {
    const result = reconcilePlanVsActual({
      planned: { ...planned, referencePrice: null, referencePriceBasis: null },
      fills: [{ fillId: "F1", securityId: "600000.SH", side: "buy", quantity: 100, price: 10.3, timestamp: "2024-01-03" }],
    });
    expect(result.priceDeviation).toBeNull();
    expect(result.priceDeviationUnassessedReasonCode).toBe(TJ_UNASSESSED_REASON_CODES.PRICE_DEVIATION_NO_REFERENCE);
    expect(result.quantityDeviation).toBe(0);
  });

  it("A7 planned 价格带被突破 → PRICE 维度", () => {
    const result = reconcilePlanVsActual({
      planned: { ...planned, priceRangeLow: 10, priceRangeHigh: 10 },
      fills: [{ fillId: "F1", securityId: "600000.SH", side: "buy", quantity: 100, price: 10.5, timestamp: "2024-01-03" }],
    });
    expect(result.machineDeviationDimensions).toEqual(["PRICE"]);
  });

  it("A8 无交易日历时执行偏移 unassessed，仅按字符串判断是否恰在 D+1 成交", () => {
    const result = reconcilePlanVsActual({
      planned,
      fills: [{ fillId: "F1", securityId: "600000.SH", side: "buy", quantity: 100, price: 10.3, timestamp: "2024-01-04" }],
    });
    expect(result.executedInPlannedWindow).toBe(false);
    expect(result.executionOffsetTradingDays).toBeNull();
    expect(result.executionOffsetUnassessedReasonCode).toBe(TJ_UNASSESSED_REASON_CODES.EXECUTION_OFFSET_CALENDAR_MISSING);
  });

  it("A9 PIT：actual 早于 planned（fill.timestamp < decisionDate）→ 响亮拒绝稳定 code", () => {
    try {
      reconcilePlanVsActual({
        planned,
        fills: [{ fillId: "F0", securityId: "600000.SH", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-01" }],
      });
      expect.unreachable("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(TradeJournalError);
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.TIME_ORDER_INVERTED);
    }
  });

  it("A10 reconcile 交叉不一致：成交 securityId/side 与 planned 不符 → RECONCILE_MISMATCH", () => {
    const mismatchFills: Array<{ fillId: string; securityId: string; side: "buy" | "sell" }> = [
      { fillId: "F1", securityId: "OTHER.SH", side: "buy" },
      { fillId: "F1", securityId: "600000.SH", side: "sell" },
    ];
    for (const badFill of mismatchFills) {
      try {
        reconcilePlanVsActual({
          planned,
          fills: [{ fillId: badFill.fillId, securityId: badFill.securityId, side: badFill.side, quantity: 100, price: 10, timestamp: "2024-01-03" }],
        });
        expect.unreachable("应当抛错");
      } catch (error) {
        expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.RECONCILE_MISMATCH);
      }
    }
  });

  it("A11 确定性：同输入两次核对结果 JSON 完全一致", () => {
    const input = {
      planned,
      fills: [
        { fillId: "F1", securityId: "600000.SH", side: "buy" as const, quantity: 60, price: 10, timestamp: "2024-01-03" },
        { fillId: "F2", securityId: "600000.SH", side: "buy" as const, quantity: 40, price: 11, timestamp: "2024-01-03" },
      ],
      tradingCalendar: ["2024-01-02", "2024-01-03"],
    };
    expect(JSON.stringify(reconcilePlanVsActual(input))).toBe(JSON.stringify(reconcilePlanVsActual(input)));
  });

  it("A12 自相矛盾输入：成交流与未成交审计码同时给出 → 响亮拒绝", () => {
    try {
      reconcilePlanVsActual({
        planned,
        fills: [{ fillId: "F1", securityId: "600000.SH", side: "buy", quantity: 100, price: 10.3, timestamp: "2024-01-03" }],
        unfilledReasonCode: "PAPER_CHECK_LIMIT_UP",
      });
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.INPUT_INVALID);
    }
  });
});

// ---------------------------------------------------------------------------
// B. buildJournalDraftsFromRun draft 提取
// ---------------------------------------------------------------------------

describe("B. buildJournalDraftsFromRun draft 提取", () => {
  it("B1 小样本 run（买→gap→持仓）→ 每笔订单一条 draft；planned/actual/deviation 映射正确", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"];
    const day1 = buildDay("2024-01-02", [intent("600000.SH", 1, 1, 10)]);
    const day3 = buildDay("2024-01-04", [intent("600000.SH", 1, 1, 10)]); // hold
    const sourceRun = buildCandidateRun([day1, day3], {
      dateRange: { startDate: "2024-01-02", endDate: "2024-01-04" },
    });
    const priceByDate = new Map<string, Map<string, PnlLoopPriceSnapshot>>();
    priceByDate.set("2024-01-02", new Map([["600000.SH", snapshot(10, 10, 10, 1000)]]));
    priceByDate.set("2024-01-03", new Map([["600000.SH", snapshot(9.5, 10, 11, 1000)]]));
    priceByDate.set("2024-01-04", new Map([["600000.SH", snapshot(11, 11, 11, 1000)]]));
    const priceSource = buildPriceSource(priceByDate);
    const run = runSignalToPnlLoop(
      buildLoopInput({ sourceRun, tradingCalendar: calendar, priceSource, executionDeclaration: buildExecutionDeclaration({ initialCapital: 2000 }) })
    );

    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    expect(extraction.counts.ordersInRun).toBe(run.orders.length);
    expect(extraction.counts.fillsInRun).toBe(run.fills.length);
    expect(run.fills.length).toBe(1);
    expect(extraction.counts.entriesBuilt).toBe(1);
    expect(extraction.counts.skippedOrders).toBe(0);
    expect(extraction.counts.orphanFills).toBe(0);
    expect(extraction.skipped).toEqual([]);

    const entry = extraction.entries[0]!;
    expect(entry.recordKind).toBe(TRADE_JOURNAL_ENTRY_KIND);
    expect(entry.entryVersion).toBe(1);
    expect(entry.annotation).toBeNull();
    expect(entry.runRef.runId).toBe(run.runId);
    expect(entry.runRef.sourceCandidateFingerprint).toBe(run.sourceFingerprint);
    expect(entry.securityId).toBe("600000.SH");
    expect(entry.side).toBe("buy");
    expect(entry.decisionDate).toBe("2024-01-02");
    expect(entry.expectedExecutionDate).toBe("2024-01-03");
    // planned 参考价 = 决策日 close = 10（经成交 basePrice=prevClose=10 推断，PIT 安全）
    expect(entry.planned.referencePrice).toBe(10);
    expect(entry.planned.referencePriceUnassessedReasonCode).toBeNull();
    expect(entry.planned.referencePriceBasis).toContain("决策日 close");
    expect(entry.planned.priceRangeUnassessedReasonCode).toBe(TJ_UNASSESSED_REASON_CODES.PLANNED_PRICE_RANGE_NOT_DEFINED);
    // actual = D2 成交：9.5；基准价 = 10
    expect(entry.actual).not.toBeNull();
    expect(entry.actual!.quantity).toBe(100);
    expect(entry.actual!.price).toBe(9.5);
    expect(entry.actual!.basePrice).toBe(10);
    expect(entry.actual!.fillTimestamp).toBe("2024-01-03");
    // deviation：FULL、数量差 0、价格差 = 9.5 − 10 = −0.5、准时
    expect(entry.deviation.fillState).toBe("FULL");
    expect(entry.deviation.quantityDeviation).toBe(0);
    expect(entry.deviation.priceDeviation).toBeCloseTo(-0.5, 10);
    expect(entry.deviation.executedInPlannedWindow).toBe(true);
    expect(entry.deviation.machineDeviationDimensions).toEqual([]);
    // 结构有效 + 指纹自洽
    expect(validateTradeJournalEntry(entry).valid).toBe(true);
    assertValidTradeJournalEntry(entry);
  });

  it("B2 涨跌停拒买 run → draft 为 UNFILLED 且引用 C-23.2 reasonCode", () => {
    const calendar = ["2024-01-02", "2024-01-03"];
    const day1 = buildDay("2024-01-02", [intent("600000.SH", 1, 1, 10)]);
    const sourceRun = buildCandidateRun([day1], { dateRange: { startDate: "2024-01-02", endDate: "2024-01-02" } });
    const priceByDate = new Map<string, Map<string, PnlLoopPriceSnapshot>>();
    priceByDate.set("2024-01-02", new Map([["600000.SH", snapshot(10, 10, 10, 1000)]]));
    priceByDate.set("2024-01-03", new Map([["600000.SH", snapshot(11, 10, 11, 1000)]]));
    const priceSource = buildPriceSource(priceByDate);
    const run = runSignalToPnlLoop(
      buildLoopInput({
        sourceRun,
        tradingCalendar: calendar,
        priceSource,
        executionDeclaration: buildExecutionDeclaration({ initialCapital: 1_000_000, blockLimitUpBuy: true }),
        initialAccount: createPaperAccount({ accountId: "acct-lim", initialCapital: 1_000_000, asOf: "2024-01-01" }),
      })
    );
    expect(run.stats.totalFills).toBe(0);
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    expect(extraction.counts.ordersInRun).toBe(1);
    expect(extraction.counts.entriesBuilt).toBe(1);
    const entry = extraction.entries[0]!;
    expect(entry.deviation.fillState).toBe("NONE");
    expect(entry.actual).toBeNull();
    expect(entry.deviation.unfilledReasonCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_LIMIT_UP);
    expect(entry.deviation.unfilledReasonText).toContain("涨停");
    expect(entry.planned.referencePrice).toBeNull();
    expect(entry.planned.referencePriceUnassessedReasonCode).toBe(TJ_UNASSESSED_REASON_CODES.PLANNED_PRICE_REFERENCE_MISSING);
    expect(entry.orderRef.status).toBe("REJECTED");
    expect(entry.deviation.machineDeviationDimensions).toEqual(["UNFILLED"]);
  });

  it("B3 确定性：同一 run 两次提取，draft 指纹一致", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"];
    const day1 = buildDay("2024-01-02", [intent("600000.SH", 1, 1, 10)]);
    const day3 = buildDay("2024-01-04", [intent("600000.SH", 1, 1, 10)]);
    const sourceRun = buildCandidateRun([day1, day3]);
    const priceSource = (() => {
      const byDate = new Map<string, Map<string, PnlLoopPriceSnapshot>>();
      byDate.set("2024-01-02", new Map([["600000.SH", snapshot(10, 10, 10, 1000)]]));
      byDate.set("2024-01-03", new Map([["600000.SH", snapshot(9.5, 10, 11, 1000)]]));
      byDate.set("2024-01-04", new Map([["600000.SH", snapshot(11, 11, 11, 1000)]]));
      return buildPriceSource(byDate);
    })();
    const run = runSignalToPnlLoop(buildLoopInput({ sourceRun, tradingCalendar: calendar, priceSource, executionDeclaration: buildExecutionDeclaration({ initialCapital: 2000 }) }));
    const a = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const b = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    expect(a.entries.map((e) => e.fingerprint)).toEqual(b.entries.map((e) => e.fingerprint));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("B4 退化输入：run 指纹被篡改 → 响亮拒绝 DRAFTS_RUN_FINGERPRINT_MISMATCH", () => {
    const calendar = ["2024-01-02", "2024-01-03"];
    const day1 = buildDay("2024-01-02", [intent("600000.SH", 1, 1, 10)]);
    const sourceRun = buildCandidateRun([day1]);
    const priceByDate = new Map<string, Map<string, PnlLoopPriceSnapshot>>();
    priceByDate.set("2024-01-02", new Map([["600000.SH", snapshot(10, 10, 10, 1000)]]));
    priceByDate.set("2024-01-03", new Map([["600000.SH", snapshot(10, 10, 10, 1000)]]));
    const run = runSignalToPnlLoop(buildLoopInput({ sourceRun, tradingCalendar: calendar, priceSource: buildPriceSource(priceByDate) }));
    const tampered = { ...run, initialCapital: 999 };
    try {
      buildJournalDraftsFromRun(tampered, { createdAt: "2024-01-05T00:00:00Z" });
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.DRAFTS_RUN_FINGERPRINT_MISMATCH);
    }
  });

  it("B5 退化输入：末决策日无下一交易日 → 订单数为 0，draft 数 0、skip 意图如实计数", () => {
    const calendar = ["2024-01-02"];
    const day1 = buildDay("2024-01-02", [intent("600000.SH", 1, 1, 10)]);
    const sourceRun = buildCandidateRun([day1], { dateRange: { startDate: "2024-01-02", endDate: "2024-01-02" } });
    const byDate = new Map<string, Map<string, PnlLoopPriceSnapshot>>();
    byDate.set("2024-01-02", new Map([["600000.SH", snapshot(10, 10, 10, 1000)]]));
    const priceSource = buildPriceSource(byDate);
    const run = runSignalToPnlLoop(
      buildLoopInput({
        sourceRun,
        tradingCalendar: calendar,
        priceSource,
        executionDeclaration: buildExecutionDeclaration({ initialCapital: 2000 }),
      })
    );
    expect(run.orders.length).toBe(0);
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    expect(extraction.counts.entriesBuilt).toBe(0);
    expect(extraction.counts.skippedOrders).toBe(0);
    expect(extraction.counts.unJournaledIntents).toBeGreaterThan(0); // NO_NEXT_TRADING_DAY 等 plan 层 skip
    expect(extraction.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C. TradeJournalLedger append-only + supersedes 修订链 + 断链检测
// ---------------------------------------------------------------------------

describe("C. TradeJournalLedger append-only", () => {
  function makeRunFixture(): SignalToPnlRun {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"];
    const day1 = buildDay("2024-01-02", [intent("600000.SH", 1, 1, 10)]);
    const day3 = buildDay("2024-01-04", [intent("600000.SH", 1, 1, 10)]);
    const sourceRun = buildCandidateRun([day1, day3]);
    const byDate = new Map<string, Map<string, PnlLoopPriceSnapshot>>();
    byDate.set("2024-01-02", new Map([["600000.SH", snapshot(10, 10, 10, 1000)]]));
    byDate.set("2024-01-03", new Map([["600000.SH", snapshot(9.5, 10, 11, 1000)]]));
    byDate.set("2024-01-04", new Map([["600000.SH", snapshot(11, 11, 11, 1000)]]));
    const run = runSignalToPnlLoop(
      buildLoopInput({
        sourceRun,
        tradingCalendar: calendar,
        priceSource: buildPriceSource(byDate),
        executionDeclaration: buildExecutionDeclaration({ initialCapital: 2000 }),
        runId: "run-ledger-001",
      })
    );
    return run;
  }

  it("C1 落账 v1 后：重复 entryId 拒绝；篡改已落账 entry 的副本不影响账本", () => {
    const run = makeRunFixture();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const entry = extraction.entries[0]!;
    const ledger = new TradeJournalLedger();
    const returned = ledger.appendEntry(entry);
    expect(ledger.countEntries()).toBe(1);

    // 重复 entryId → LEDGER_ENTRY_EXISTS
    try {
      ledger.appendEntry(entry);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.LEDGER_ENTRY_EXISTS);
    }
    // 篡改返回副本（用户侧）不影响账本
    (returned as { annotation: unknown }).annotation = { reasonCode: "OTHER", annotatedAt: "2024-01-05T00:00:00Z" } as never;
    expect(ledger.getEntry(entry.entryId).annotation).toBeNull();
    expect(ledger.countEntries()).toBe(1);
  });

  it("C2 supersedes 修订链：人工标注 bump v2，链衔接校验；annotateJournalEntry 再 bump v3", () => {
    const run = makeRunFixture();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const entry = extraction.entries[0]!;
    const ledger = new TradeJournalLedger();
    ledger.appendEntry(entry);

    const v2 = withJournalAnnotation(entry, {
      reasonCode: "EXECUTION_TECHNICAL",
      reasonNote: "开盘缺口大，成交价偏离决策日收盘",
      emotionCode: "FRUSTRATION",
      ruleViolation: { declared: false, violatedRuleRef: null, severity: null, violationNote: null },
      annotatedAt: "2024-01-05T12:00:00Z",
      annotator: "human-reviewer",
    }, { createdAt: "2024-01-05T12:00:00Z" });
    const storedV2 = ledger.appendEntry(v2);
    expect(storedV2.entryVersion).toBe(2);
    expect(storedV2.supersedesEntryId).toBe(entry.entryId);
    expect(storedV2.annotation?.reasonCode).toBe("EXECUTION_TECHNICAL");
    expect(ledger.journalHistory(entry.journalId).length).toBe(2);

    // 便捷入口：读最新 v2 → 修订 v3 → append（链校验由账本承担）
    const v3 = annotateJournalEntry(
      ledger,
      entry.journalId,
      { reviewNote: "补充复盘：确认未违反仓位规则", annotator: "human-reviewer", annotatedAt: "2024-01-06T09:00:00Z" },
      { createdAt: "2024-01-06T09:00:00Z" }
    );
    expect(v3.entryVersion).toBe(3);
    expect(v3.supersedesEntryId).toBe(v2.entryId);
    expect(ledger.getLatestEntry(entry.journalId).entryVersion).toBe(3);
    expect(ledger.getLatestEntry(entry.journalId).entryId).toBe(v3.entryId);
    expect(ledger.journalHistory(entry.journalId).length).toBe(3);
  });

  it("C3 append-only：版本回退（再投 v2）/断链（supersedes 指向非最新）→ 拒绝稳定 code", () => {
    const run = makeRunFixture();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const v1 = extraction.entries[0]!;
    const ledger = new TradeJournalLedger();
    ledger.appendEntry(v1);
    const v2 = withJournalAnnotation(v1, { annotatedAt: "2024-01-05T12:00:00Z" }, { createdAt: "2024-01-05T12:00:00Z" });
    ledger.appendEntry(v2);

    // 版本回退：构造指纹自洽但 entryVersion=2（不大于最新 2）的「重复版本」
    const rogueV2 = { ...v2, entryId: `${v2.journalId}#rogue-v2` };
    (rogueV2 as { fingerprint: string }).fingerprint = computeTradeJournalEntryFingerprint(rogueV2);
    try {
      ledger.appendEntry(rogueV2);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.LEDGER_VERSION_REGRESSION);
    }
    // 断链：指纹自洽的 v3 但 supersedes 指向 v1（而非最新 v2）
    const brokenV3 = { ...v1, entryId: journalEntryIdOf(v1.journalId, 3), entryVersion: 3, supersedesEntryId: v1.entryId };
    (brokenV3 as { fingerprint: string }).fingerprint = computeTradeJournalEntryFingerprint(brokenV3);
    try {
      ledger.appendEntry(brokenV3);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.LEDGER_CHAIN_BROKEN);
    }
    // 账本保持原状
    expect(ledger.countEntries()).toBe(2);
  });

  it("C4 append-only：首次落账跳过 v1 直接 v2 → 拒绝；v1 携带 supersedes → 拒绝", () => {
    const run = makeRunFixture();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const v1 = extraction.entries[0]!;
    const ledger = new TradeJournalLedger();
    const asV2 = { ...v1, entryId: journalEntryIdOf(v1.journalId, 2), entryVersion: 2, supersedesEntryId: v1.entryId };
    (asV2 as { fingerprint: string }).fingerprint = computeTradeJournalEntryFingerprint(asV2);
    try {
      ledger.appendEntry(asV2);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.LEDGER_CHAIN_BROKEN);
    }
    const v1WithSupersedes = { ...v1, supersedesEntryId: "ghost" };
    (v1WithSupersedes as { fingerprint: string }).fingerprint = computeTradeJournalEntryFingerprint(v1WithSupersedes);
    try {
      ledger.appendEntry(v1WithSupersedes);
      expect.unreachable("应当抛错");
    } catch (error) {
      // v1 携带 supersedes 属结构非法（validate 先行拦截）→ ENTRY_INVALID。
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.ENTRY_INVALID);
    }
  });

  it("C5 账本 round-trip：serialize → deserialize 等价；篡改字段/断链 → 检出", () => {
    const run = makeRunFixture();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const ledger = new TradeJournalLedger();
    for (const entry of extraction.entries) ledger.appendEntry(entry);
    // 追加一条标注修订，形成 2 版本链（供断链篡改测试）。
    annotateJournalEntry(
      ledger,
      extraction.entries[0]!.journalId,
      { reasonCode: "EXECUTION_TECHNICAL", annotatedAt: "2024-01-06T10:00:00Z" },
      { createdAt: "2024-01-06T10:00:00Z" }
    );
    const review = createPostReviewRecord({
      reviewId: "rev-1",
      createdAt: "2024-01-06T00:00:00Z",
      reviewerId: "human",
      journalIds: extraction.entries.map((e) => e.journalId),
      plannedQualityRating: 4,
      plannedQualityNote: "决策清晰",
      executionQualityRating: 2,
      executionQualityNote: "执行偏差大",
      ruleAdherenceRating: 3,
      nextImprovements: ["开盘后确认流动性再下单"],
      metricsReferences: [createTradeQualityMetricsReference("tq-run-1", null)],
    });
    ledger.appendReview(review);
    expect(ledger.countEntries()).toBe(2);
    expect(ledger.countReviews()).toBe(1);
    const json = ledger.serialize();
    const restored = TradeJournalLedger.deserialize(json);
    expect(restored.countEntries()).toBe(ledger.countEntries());
    expect(restored.countReviews()).toBe(1);

    // 篡改任意已落账 entry 的字段（改 planned 数量）→ 反序列化拒绝（指纹不符）
    const tampered = JSON.parse(json);
    const rawEntries = (tampered as { entries: Record<string, unknown>[] }).entries;
    rawEntries[0]!.planned = { ...(rawEntries[0]!.planned as Record<string, unknown>), quantity: 99999 };
    try {
      TradeJournalLedger.deserialize(JSON.stringify(tampered));
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.LEDGER_INVALID);
    }
    // 篡改修订链（把 v2 的 supersedesEntryId 改坏）→ 仅剩断链一条缺陷（指纹已重算自洽）
    const tamperedChain = JSON.parse(json);
    const chainEntries = (tamperedChain as { entries: Record<string, unknown>[] }).entries;
    chainEntries[1]!.supersedesEntryId = "BOGUS-ENTRY";
    (chainEntries[1] as { fingerprint: string }).fingerprint = computeTradeJournalEntryFingerprint(
      chainEntries[1] as unknown as Parameters<typeof computeTradeJournalEntryFingerprint>[0]
    );
    try {
      TradeJournalLedger.deserialize(JSON.stringify(tamperedChain));
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.LEDGER_INVALID);
    }
  });

  it("C6 复盘记录 append-only：reviewId 重复 → 拒绝", () => {
    const ledger = new TradeJournalLedger();
    const review = createPostReviewRecord({
      reviewId: "rev-dup",
      createdAt: "2024-01-06T00:00:00Z",
      journalIds: ["run-1#ord-1"],
      ruleAdherenceRating: 5,
    });
    ledger.appendReview(review);
    try {
      ledger.appendReview(review);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.LEDGER_REVIEW_EXISTS);
    }
  });
});

// ---------------------------------------------------------------------------
// D. PostReviewRecord 复盘快照
// ---------------------------------------------------------------------------

describe("D. PostReviewRecord 复盘快照", () => {
  it("D1 单笔/批量 scope + 评级 + C-16.3 引用（不重算）", () => {
    const single = createPostReviewRecord({
      reviewId: "rev-single",
      createdAt: "2024-01-06T00:00:00Z",
      journalIds: ["run-a#ord-1"],
      plannedQualityRating: 5,
      executionQualityRating: 3,
      ruleAdherenceRating: 4,
      nextImprovements: ["设定最大单笔风险"],
      metricsReferences: [createTradeQualityMetricsReference("tq-run-a")],
    });
    expect(single.scope.scopeType).toBe("SINGLE_ENTRY");
    expect(single.scope.journalIds).toEqual(["run-a#ord-1"]);
    expect(single.metricsReferences[0]!.kind).toBe("TRADE_QUALITY_EVALUATION_RUN");
    expect(single.metricsReferences[0]!.recordId).toBe("tq-run-a");
    expect(single.plannedQuality.rating).toBe(5);

    const batch = createPostReviewRecord({
      reviewId: "rev-batch",
      createdAt: "2024-01-06T00:00:00Z",
      journalIds: ["run-a#ord-2", "run-a#ord-1", "run-a#ord-1"], // 去重升序
      ruleAdherenceNote: "批量复盘",
    });
    expect(batch.scope.scopeType).toBe("ENTRY_BATCH");
    expect(batch.scope.journalIds).toEqual(["run-a#ord-1", "run-a#ord-2"]);
    expect(batch.plannedQuality.rating).toBeNull();
    expect(batch.ruleAdherence.note).toBe("批量复盘");
  });

  it("D2 非法评级 / 空 journalIds / 引用形状 → 响亮拒绝", () => {
    expect(() =>
      createPostReviewRecord({ reviewId: "rev-bad-rating", createdAt: "2024-01-06T00:00:00Z", journalIds: ["a#1"], plannedQualityRating: 9 as never })
    ).toThrow(TradeJournalError);
    expect(() =>
      createPostReviewRecord({ reviewId: "rev-empty", createdAt: "2024-01-06T00:00:00Z", journalIds: [] })
    ).toThrow(TradeJournalError);
    expect(() =>
      createPostReviewRecord({
        reviewId: "rev-bad-metrics",
        createdAt: "2024-01-06T00:00:00Z",
        journalIds: ["a#1"],
        metricsReferences: [{ kind: "NOT_A_KIND" as never, recordId: "x", recordFingerprint: null }],
      })
    ).toThrow(TradeJournalError);
  });

  it("D3 人工标注修订：annotatedAt 早于成交时点（PIT 事后补录伪装）→ 拒绝", () => {
    const run = makeLedgerRun();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const entry = extraction.entries[0]!;
    // 成交日 2024-01-03；标注时间回拨到 2024-01-02（决策日当天）→ 拒绝（事后补录伪装成当时决策）
    expect(() =>
      withJournalAnnotation(entry, { reasonCode: "OMISSION", annotatedAt: "2024-01-02T10:00:00Z" }, { createdAt: "2024-01-05T00:00:00Z" })
    ).toThrow(TradeJournalError);
  });
});

// ---------------------------------------------------------------------------
// E. PIT 时序（entry 级）
// ---------------------------------------------------------------------------

describe("E. PIT 时序（entry 级）", () => {
  it("E1 createdAt 早于决策日 / 成交日 → validate 拒绝", () => {
    const run = makeLedgerRun();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const entry = extraction.entries[0]!;
    // 直接把 createdAt 回拨到 2024-01-01（早于决策日）→ 结构校验失败
    const tamperedCreated = { ...entry, createdAt: "2024-01-01T00:00:00Z" };
    const result = validateTradeJournalEntry(tamperedCreated);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "TJ_PIT_ORDER_VIOLATION")).toBe(true);
  });

  it("E2 决策日 > 执行日（执行窗口早于决策日）→ validate 拒绝", () => {
    const run = makeLedgerRun();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const entry = extraction.entries[0]!;
    const inverted = { ...entry, expectedExecutionDate: "2023-12-31" };
    const result = validateTradeJournalEntry(inverted);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "expectedExecutionDate")).toBe(true);
  });

  it("E3 round-trip 篡改拒绝：单条 entry serialize → 改字段 → deserialize 抛 ENTRY_FINGERPRINT_MISMATCH", () => {
    const run = makeLedgerRun();
    const extraction = buildJournalDraftsFromRun(run, { createdAt: "2024-01-05T00:00:00Z" });
    const entry = extraction.entries[0]!;
    const json = serializeTradeJournalEntry(entry);
    const restored = deserializeTradeJournalEntry(json);
    expect(restored.fingerprint).toBe(entry.fingerprint);

    const tampered = JSON.parse(json);
    (tampered as Record<string, unknown>).deviation = { ...(tampered as Record<string, unknown>).deviation as Record<string, unknown>, quantityDeviation: 12345 };
    try {
      deserializeTradeJournalEntry(JSON.stringify(tampered));
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.ENTRY_FINGERPRINT_MISMATCH);
    }
  });
});

// ---------------------------------------------------------------------------
// 辅助：供 E / D3 复用的标准 run
// ---------------------------------------------------------------------------

function makeLedgerRun(): SignalToPnlRun {
  const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"];
  const day1 = buildDay("2024-01-02", [intent("600000.SH", 1, 1, 10)]);
  const day3 = buildDay("2024-01-04", [intent("600000.SH", 1, 1, 10)]);
  const sourceRun = buildCandidateRun([day1, day3]);
  const byDate = new Map<string, Map<string, PnlLoopPriceSnapshot>>();
  byDate.set("2024-01-02", new Map([["600000.SH", snapshot(10, 10, 10, 1000)]]));
  byDate.set("2024-01-03", new Map([["600000.SH", snapshot(9.5, 10, 11, 1000)]]));
  byDate.set("2024-01-04", new Map([["600000.SH", snapshot(11, 11, 11, 1000)]]));
  return runSignalToPnlLoop(
    buildLoopInput({
      sourceRun,
      tradingCalendar: calendar,
      priceSource: buildPriceSource(byDate),
      executionDeclaration: buildExecutionDeclaration({ initialCapital: 2000 }),
      runId: "run-pit-001",
    })
  );
}

// 类型自检
const _journalIds: string[] = [journalIdOf("run", "ord")];
void _journalIds;
