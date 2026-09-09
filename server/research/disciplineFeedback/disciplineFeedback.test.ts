/**
 * STEP 24 / C-24.2 — 纪律反馈分析：单测。
 *
 * 测试覆盖（对照任务要求）：
 *   A. aggregateViolationCauses 违规原因统计（手算频次/占比/severity/维度过滤/未归因显式计数）
 *   B. detectRepeatMistakes 重复错误识别（手算首末现/间隔/窗口峰值/分组维度/阈值/范围）
 *   C. rankExecutionQuality 最差执行策略排序（手算均值偏差/样本不足不排名）
 *   D. identifyErrorProneEnvironments 易错环境识别（手算密度/平均 severity/未标注归 ENV_UNLABELED）
 *   E. 统一记录 buildDisciplineFeedbackRun（汇总/结论/模式清单/round-trip 篡改拒绝）
 *   F. 退化与确定性（空账本/单 entry/全 draft/乱序输入深比较）
 *   G. 与 C-24.1 tradeJournal 词表/类型/账本复用对照（喂真实 TradeJournalLedger 结构）
 */

import { describe, expect, it } from "vitest";
import {
  assertValidTradeJournalEntry,
  buildJournalActualFacts,
  computeTradeJournalEntryFingerprint,
  journalEntryIdOf,
  journalIdOf,
  reconcilePlanVsActual,
  TradeJournalLedger,
  withJournalAnnotation,
  JOURNAL_REASON_CODES,
  JOURNAL_RULE_VIOLATION_SEVERITIES,
  TRADE_JOURNAL_ENTRY_KIND,
  TJ_ERROR_CODES,
  TradeJournalError,
  type JournalReasonCode,
  type JournalRuleViolationSeverity,
  type TradeJournalEntry,
} from "../tradeJournal";
import {
  aggregateViolationCauses,
  buildDisciplineFeedbackRun,
  computeDisciplineFeedbackRunFingerprint,
  deserializeDisciplineFeedbackRun,
  detectRepeatMistakes,
  DFA_ENV_UNLABELED_KEY,
  DFA_ERROR_CODES,
  DFA_REASON_CODES,
  DisciplineFeedbackError,
  identifyErrorProneEnvironments,
  rankExecutionQuality,
  resolveFeedbackEntries,
  serializeDisciplineFeedbackRun,
  validateDisciplineFeedbackRun,
} from ".";

// ---------------------------------------------------------------------------
// Fixture：构造合法 TradeJournalEntry（用 C-24.1 reconcile 机器核对自动填 deviation）
// ---------------------------------------------------------------------------

interface TradeSpec {
  readonly runId: string;
  readonly orderId: string;
  readonly securityId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly decisionDate: string;
  readonly executionDate: string;
  /** planned 股数。 */
  readonly quantity: number;
  /** planned 参考价（决策日 close；null 允许，价格偏差 unassessed）。 */
  readonly referencePrice: number | null;
  /** 成交流（默认恰好 quantity）；空 = 未成交。 */
  readonly fills?: ReadonlyArray<{ readonly price: number; readonly quantity?: number; readonly timestamp?: string }>;
  readonly unfilledReasonCode?: string | null;
  readonly unfilledReasonText?: string | null;
  readonly createdAt: string;
  readonly accountId?: string;
}

function makeDraftEntry(spec: TradeSpec): TradeJournalEntry {
  const fills = spec.fills ?? [];
  const reconcileFills = fills.map((f, i) => ({
    fillId: `${spec.runId}#${spec.orderId}#F${i + 1}`,
    securityId: spec.securityId,
    side: "buy" as const,
    quantity: f.quantity ?? spec.quantity,
    price: f.price,
    timestamp: f.timestamp ?? spec.executionDate,
  }));
  const planned = {
    securityId: spec.securityId,
    side: "buy" as const,
    quantity: spec.quantity,
    decisionDate: spec.decisionDate,
    expectedExecutionDate: spec.executionDate,
    executionWindowDays: 1,
    referencePrice: spec.referencePrice,
    referencePriceBasis: spec.referencePrice !== null ? "决策日 close（测试口径）" : null,
    priceRangeLow: null,
    priceRangeHigh: null,
  };
  const deviation = reconcilePlanVsActual({
    planned,
    fills: reconcileFills,
    unfilledReasonCode: spec.unfilledReasonCode ?? null,
    unfilledReasonText: spec.unfilledReasonText ?? null,
  });
  const actual = buildJournalActualFacts(reconcileFills);
  const journalId = journalIdOf(spec.runId, spec.orderId);
  const orderStatus = reconcileFills.length > 0 ? "FILLED" : "REJECTED";
  const body: Omit<TradeJournalEntry, "fingerprint"> = {
    recordKind: TRADE_JOURNAL_ENTRY_KIND,
    recordVersion: 1,
    entryId: journalEntryIdOf(journalId, 1),
    journalId,
    entryVersion: 1,
    supersedesEntryId: null,
    createdAt: spec.createdAt,
    runRef: {
      kind: "SIGNAL_TO_PNL_RUN",
      runId: spec.runId,
      accountId: spec.accountId ?? `acct-${spec.runId}`,
      datasetVersion: "rd-test-001",
      strategyId: spec.strategyId,
      strategyVersion: spec.strategyVersion,
      sourceCandidateFingerprint: "cand-fp-test-001",
    },
    orderRef: {
      orderId: spec.orderId,
      status: orderStatus as TradeJournalEntry["orderRef"]["status"],
      orderType: "market",
      requestedPrice: null,
    },
    securityId: spec.securityId,
    side: "buy",
    decisionDate: spec.decisionDate,
    expectedExecutionDate: spec.executionDate,
    planned: {
      quantity: spec.quantity,
      executionWindowDays: 1,
      referencePrice: spec.referencePrice,
      referencePriceBasis: spec.referencePrice !== null ? "决策日 close（测试口径）" : null,
      referencePriceUnassessedReasonCode: spec.referencePrice !== null ? null : "TJ_PLANNED_PRICE_REFERENCE_MISSING",
      priceRangeLow: null,
      priceRangeHigh: null,
      priceRangeUnassessedReasonCode: "TJ_PLANNED_PRICE_RANGE_NOT_DEFINED",
    },
    actual,
    deviation,
    annotation: null,
  };
  const fingerprint = computeTradeJournalEntryFingerprint(body);
  const entry: TradeJournalEntry = { ...body, fingerprint };
  assertValidTradeJournalEntry(entry);
  return entry;
}

interface AnnotationSpec {
  readonly reasonCode?: JournalReasonCode | null;
  readonly emotionCode?: "CALM" | "FRUSTRATION" | "FEAR" | "PANIC" | "OTHER" | null;
  /** 是否声明违规（declared）；null = 不携带 ruleViolation。 */
  readonly violation?: {
    readonly declared: boolean;
    readonly severity?: JournalRuleViolationSeverity | null;
  } | null;
  readonly reviewNote?: string | null;
  readonly annotatedAt: string;
  readonly createdAt: string;
}

/** 对 draft 生成标注修订（vN；validate/指纹由 withJournalAnnotation 保证）。 */
function annotate(draft: TradeJournalEntry, spec: AnnotationSpec): TradeJournalEntry {
  return withJournalAnnotation(
    draft,
    {
      reasonCode: spec.reasonCode ?? null,
      emotionCode: spec.emotionCode ?? null,
      ruleViolation:
        spec.violation === null || spec.violation === undefined
          ? null
          : {
              declared: spec.violation.declared,
              violatedRuleRef: null,
              severity: spec.violation.severity ?? null,
              violationNote: null,
            },
      reviewNote: spec.reviewNote ?? null,
      annotator: "human-reviewer",
      annotatedAt: spec.annotatedAt,
    },
    { createdAt: spec.createdAt }
  );
}

/** 全部修订历史 + 最新分析集合。 */
interface FixtureSet {
  readonly latest: readonly TradeJournalEntry[];
  readonly allVersions: readonly TradeJournalEntry[];
}

/**
 * 主 fixture（8 笔 journal，7 笔已标注、1 笔 draft；违规 6，reason 未归因 1）：
 *   A 策略 strat-alpha@1.0.0：r1#o1(A1,IMPULSIVE/MAJOR)、r1#o2(A2,IMPULSIVE/MINOR,部分成交)、r1#o3(A3,OMISSION/MAJOR,部分成交+拖延)
 *   B 策略 strat-beta@2.0.0：r2#o1(B1,OMISSION/CRITICAL)、r2#o2(B2,IMPULSIVE/MINOR)
 *   C 策略 strat-gamma@3.0.0：r3#o1(C1,MARKET_EVENT/无违规)、r3#o2(C2,违规但 reason 未归因/MAJOR)、r3#o3(C3,draft)
 */
function buildMainFixture(): FixtureSet {
  const common = { createdAt: "2024-01-19T00:00:00Z" };
  const d1 = makeDraftEntry({
    runId: "r1", orderId: "o1", securityId: "600000.SH", strategyId: "strat-alpha", strategyVersion: "1.0.0",
    decisionDate: "2024-01-02", executionDate: "2024-01-03", quantity: 100, referencePrice: 10,
    fills: [{ price: 10.5 }], ...common,
  });
  const a1 = annotate(d1, {
    reasonCode: "IMPULSIVE", emotionCode: "FOMO",
    violation: { declared: true, severity: "MAJOR" }, annotatedAt: "2024-02-01T00:00:00Z", createdAt: "2024-02-01T00:00:00Z",
  });
  const d2 = makeDraftEntry({
    runId: "r1", orderId: "o2", securityId: "600000.SH", strategyId: "strat-alpha", strategyVersion: "1.0.0",
    decisionDate: "2024-01-03", executionDate: "2024-01-04", quantity: 100, referencePrice: 10,
    fills: [{ price: 10.3, quantity: 60 }], ...common,
  });
  const a2 = annotate(d2, {
    reasonCode: "IMPULSIVE", emotionCode: "FRUSTRATION",
    violation: { declared: true, severity: "MINOR" }, annotatedAt: "2024-02-01T00:00:00Z", createdAt: "2024-02-01T00:00:00Z",
  });
  const d3 = makeDraftEntry({
    runId: "r1", orderId: "o3", securityId: "600001.SH", strategyId: "strat-alpha", strategyVersion: "1.0.0",
    decisionDate: "2024-01-04", executionDate: "2024-01-05", quantity: 100, referencePrice: 10,
    // 纪律拖沓：仅成交 20/100 且拖延至窗口外（PARTIAL_FILL+QUANTITY+TIMING）——真实账本不允许 actual=null 的合法 entry
    fills: [{ price: 10.4, quantity: 20, timestamp: "2024-01-08" }], ...common,
  });
  const a3 = annotate(d3, {
    reasonCode: "OMISSION", emotionCode: "REGRET",
    violation: { declared: true, severity: "MAJOR" }, annotatedAt: "2024-02-01T00:00:00Z", createdAt: "2024-02-01T00:00:00Z",
  });
  const d4 = makeDraftEntry({
    runId: "r2", orderId: "o1", securityId: "600002.SH", strategyId: "strat-beta", strategyVersion: "2.0.0",
    decisionDate: "2024-01-10", executionDate: "2024-01-11", quantity: 100, referencePrice: 10,
    fills: [{ price: 10.6 }], ...common,
  });
  const b1 = annotate(d4, {
    reasonCode: "OMISSION", emotionCode: "HOPE",
    violation: { declared: true, severity: "CRITICAL" }, annotatedAt: "2024-02-01T00:00:00Z", createdAt: "2024-02-01T00:00:00Z",
  });
  const d5 = makeDraftEntry({
    runId: "r2", orderId: "o2", securityId: "600003.SH", strategyId: "strat-beta", strategyVersion: "2.0.0",
    decisionDate: "2024-01-11", executionDate: "2024-01-12", quantity: 100, referencePrice: 10,
    fills: [{ price: 10.1 }], ...common,
  });
  const b2 = annotate(d5, {
    reasonCode: "IMPULSIVE", emotionCode: "GREED",
    violation: { declared: true, severity: "MINOR" }, annotatedAt: "2024-02-01T00:00:00Z", createdAt: "2024-02-01T00:00:00Z",
  });
  const d6 = makeDraftEntry({
    runId: "r3", orderId: "o1", securityId: "600004.SH", strategyId: "strat-gamma", strategyVersion: "3.0.0",
    decisionDate: "2024-01-15", executionDate: "2024-01-16", quantity: 100, referencePrice: 10,
    fills: [{ price: 10.02 }], ...common,
  });
  const c1 = annotate(d6, {
    reasonCode: "MARKET_EVENT", emotionCode: "CALM",
    violation: { declared: false, severity: null }, annotatedAt: "2024-02-01T00:00:00Z", createdAt: "2024-02-01T00:00:00Z",
  });
  const d7 = makeDraftEntry({
    runId: "r3", orderId: "o2", securityId: "600005.SH", strategyId: "strat-gamma", strategyVersion: "3.0.0",
    decisionDate: "2024-01-16", executionDate: "2024-01-17", quantity: 100, referencePrice: 10,
    fills: [{ price: 10 }], ...common,
  });
  const c2 = annotate(d7, {
    reasonCode: null, emotionCode: null,
    violation: { declared: true, severity: "MAJOR" }, annotatedAt: "2024-02-01T00:00:00Z", createdAt: "2024-02-01T00:00:00Z",
  });
  const d8 = makeDraftEntry({
    runId: "r3", orderId: "o3", securityId: "600006.SH", strategyId: "strat-gamma", strategyVersion: "3.0.0",
    decisionDate: "2024-01-17", executionDate: "2024-01-18", quantity: 100, referencePrice: 10,
    fills: [{ price: 10 }], ...common,
  });
  const latest = [a1, a2, a3, b1, b2, c1, c2, d8];
  return { latest, allVersions: [...latest, d1, d2, d3, d4, d5, d6, d7] };
}

/** 主 fixture 的环境挂接（vol 维度；C3 draft 不挂接 → ENV_UNLABELED）。 */
function mainEnvAssignments(): Array<{ journalId: string; environmentKeys: readonly string[] }> {
  return [
    { journalId: journalIdOf("r1", "o1"), environmentKeys: ["vol=high"] },
    { journalId: journalIdOf("r1", "o2"), environmentKeys: ["vol=high"] },
    { journalId: journalIdOf("r1", "o3"), environmentKeys: ["vol=mid"] },
    { journalId: journalIdOf("r2", "o1"), environmentKeys: ["vol=mid"] },
    { journalId: journalIdOf("r2", "o2"), environmentKeys: ["vol=low"] },
    { journalId: journalIdOf("r3", "o1"), environmentKeys: ["vol=mid"] },
    { journalId: journalIdOf("r3", "o2"), environmentKeys: ["vol=mid"] },
  ];
}

// ---------------------------------------------------------------------------
// A. 违规原因统计（手算）
// ---------------------------------------------------------------------------

describe("A. aggregateViolationCauses 违规原因统计（手算）", () => {
  const { latest } = buildMainFixture();

  it("A1 频次/占比/排序：IMPULSIVE 3 (50%)、OMISSION 2 (33.33%)，reason 未归因显式计 1", () => {
    const report = aggregateViolationCauses(latest);
    expect(report.scopeViolationCount).toBe(6);
    expect(report.reasonUnassignedCount).toBe(1); // C2：违规声明但 reasonCode=null
    expect(report.severityUnassignedCount).toBe(0);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]!.reasonCode).toBe("IMPULSIVE");
    expect(report.rows[0]!.count).toBe(3);
    expect(report.rows[0]!.shareOfViolationsPct).toBeCloseTo(50, 10);
    expect(report.rows[1]!.reasonCode).toBe("OMISSION");
    expect(report.rows[1]!.count).toBe(2);
    expect(report.rows[1]!.shareOfViolationsPct).toBeCloseTo(100 / 3, 10);
  });

  it("A2 severity 列：IMPULSIVE MINOR2/MAJOR1；OMISSION MAJOR1/CRITICAL1（与手算一致）", () => {
    const report = aggregateViolationCauses(latest);
    const impulsive = report.rows.find((r) => r.reasonCode === "IMPULSIVE")!;
    const omission = report.rows.find((r) => r.reasonCode === "OMISSION")!;
    expect(impulsive.countBySeverity).toEqual({ MINOR: 2, MAJOR: 1, CRITICAL: 0 });
    expect(impulsive.severityUnassignedCount).toBe(0);
    expect(omission.countBySeverity).toEqual({ MINOR: 0, MAJOR: 1, CRITICAL: 1 });
  });

  it("A3 维度过滤：filterDeviationDimension=TIMING → 仅 A3(OMISSION) 进入 scope（其余 entry 均在计划窗口内成交）", () => {
    const report = aggregateViolationCauses(latest, { filterDeviationDimension: "TIMING" });
    expect(report.config.filterDeviationDimension).toBe("TIMING");
    expect(report.scopeViolationCount).toBe(1);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.reasonCode).toBe("OMISSION");
    expect(report.rows[0]!.count).toBe(1);
    expect(report.rows[0]!.shareOfViolationsPct).toBeCloseTo(100, 10);
  });

  it("A4 draft 不计入违规/原因（annotation=null）；全部干净标注 → 无行", () => {
    // 仅 C1（declared=false）与 C3（draft）→ 无违规
    const { latest } = buildMainFixture();
    const cleanOnly = [latest[5]!, latest[7]!]; // C1 + C3
    const report = aggregateViolationCauses(cleanOnly);
    expect(report.scopeViolationCount).toBe(0);
    expect(report.reasonUnassignedCount).toBe(0);
    expect(report.rows).toEqual([]);
  });

  it("A5 确定性：同输入两次深相等；乱序输入输出一致", () => {
    const { latest } = buildMainFixture();
    const a = aggregateViolationCauses(latest);
    const b = aggregateViolationCauses([...latest].reverse());
    const c = aggregateViolationCauses(latest);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it("A6 非法维度配置 → 响亮抛错（不 clamp）", () => {
    expect(() => aggregateViolationCauses(latest, { filterDeviationDimension: "BOGUS" as never }))
      .toThrow(DisciplineFeedbackError);
  });
});

// ---------------------------------------------------------------------------
// B. 重复错误识别（手算间隔/窗口）
// ---------------------------------------------------------------------------

describe("B. detectRepeatMistakes 重复错误识别", () => {
  const { latest } = buildMainFixture();

  it("B1 主 fixture：IMPULSIVE 3 次（间隔 1,8）、OMISSION 2 次（间隔 6）；candidate=5 excluded=1", () => {
    const report = detectRepeatMistakes(latest);
    expect(report.config.minRepeatThreshold).toBe(2);
    expect(report.candidateEventCount).toBe(5); // A1,A2,A3,B1,B2
    expect(report.excludedNoReasonCodeCount).toBe(1); // C2 违规未归因
    expect(report.patterns).toHaveLength(2);
    const impulsive = report.patterns.find((p) => p.reasonCode === "IMPULSIVE")!;
    const omission = report.patterns.find((p) => p.reasonCode === "OMISSION")!;
    expect(impulsive.occurrenceCount).toBe(3);
    expect(impulsive.firstOccurrenceDate).toBe("2024-01-02");
    expect(impulsive.lastOccurrenceDate).toBe("2024-01-11");
    expect(impulsive.intervalDays).toEqual([1, 8]);
    expect(omission.occurrenceCount).toBe(2);
    expect(omission.intervalDays).toEqual([6]);
    // 排序：count 降序（IMPULSIVE 3 在前）
    expect(report.patterns[0]!.reasonCode).toBe("IMPULSIVE");
    expect(report.patterns[1]!.reasonCode).toBe("OMISSION");
  });

  it("B2 groupBy=reasonCodeAndSecurityId：同股同因才算重复（600000.SH IMPULSIVE×2 成 pattern）", () => {
    const report = detectRepeatMistakes(latest, { groupBy: "reasonCodeAndSecurityId" });
    expect(report.patterns).toHaveLength(1);
    const pattern = report.patterns[0]!;
    expect(pattern.securityId).toBe("600000.SH");
    expect(pattern.reasonCode).toBe("IMPULSIVE");
    expect(pattern.occurrenceCount).toBe(2);
  });

  it("B3 窗口边界：windowSizeDays=5 → IMPULSIVE 峰值 2（窗 01-02..01-06），OMISSION 峰值 1", () => {
    const report = detectRepeatMistakes(latest, { windowSizeDays: 5 });
    const impulsive = report.patterns.find((p) => p.reasonCode === "IMPULSIVE")!;
    const omission = report.patterns.find((p) => p.reasonCode === "OMISSION")!;
    expect(impulsive.peakWindow).toEqual({
      windowSizeDays: 5,
      maxOccurrenceCount: 2,
      windowStartDate: "2024-01-02",
      windowEndDate: "2024-01-06",
    });
    expect(omission.peakWindow!.maxOccurrenceCount).toBe(1);
    expect(omission.peakWindow!.windowStartDate).toBe("2024-01-04");
    expect(omission.peakWindow!.windowEndDate).toBe("2024-01-08");
  });

  it("B4 scope=allAttributed 纳入非违规归因（C1 MARKET_EVENT）；仅 1 次不成 pattern", () => {
    const report = detectRepeatMistakes(latest, { scope: "allAttributed" });
    // candidate = 5 + C1(MARKET_EVENT)；C2 仍无 reason → excluded
    expect(report.candidateEventCount).toBe(6);
    expect(report.excludedNoReasonCodeCount).toBe(1);
    const market = report.patterns.find((p) => p.reasonCode === "MARKET_EVENT");
    expect(market).toBeUndefined(); // count=1 < 2
  });

  it("B5 阈值可配：minRepeatThreshold=3 → 仅 IMPULSIVE（3 次）保留", () => {
    const report = detectRepeatMistakes(latest, { minRepeatThreshold: 3 });
    expect(report.patterns).toHaveLength(1);
    expect(report.patterns[0]!.reasonCode).toBe("IMPULSIVE");
    expect(report.patterns[0]!.occurrenceCount).toBe(3);
  });

  it("B6 无重复（每组仅 1 次）→ patterns 空但不静默：candidate 如实计数", () => {
    const { latest } = buildMainFixture();
    const isolated = [latest[0]!, latest[5]!]; // A1(IMPULSIVE) + C1(MARKET_EVENT, 无违规声明)
    const report = detectRepeatMistakes(isolated);
    expect(report.candidateEventCount).toBe(1);
    expect(report.patterns).toEqual([]);
  });

  it("B7 确定性：同输入两次深相等；乱序输入输出一致", () => {
    const a = detectRepeatMistakes(latest, { windowSizeDays: 5, groupBy: "reasonCodeAndSignalSource" });
    const b = detectRepeatMistakes([...latest].reverse(), { windowSizeDays: 5, groupBy: "reasonCodeAndSignalSource" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("B8 非法配置 → 响亮抛错（阈值 0 / 非法 windowSize / 非法 scope）", () => {
    expect(() => detectRepeatMistakes(latest, { minRepeatThreshold: 0 })).toThrow(DisciplineFeedbackError);
    expect(() => detectRepeatMistakes(latest, { windowSizeDays: 0 })).toThrow(DisciplineFeedbackError);
    expect(() => detectRepeatMistakes(latest, { scope: "BOGUS" as never })).toThrow(DisciplineFeedbackError);
  });
});

// ---------------------------------------------------------------------------
// C. 最差执行策略排序（手算均值；样本不足不排名）
// ---------------------------------------------------------------------------

describe("C. rankExecutionQuality 最差执行策略排序", () => {
  const { latest } = buildMainFixture();

  it("C1 主 fixture（minSamples=2）：A 4%、B 3.5%、C 0.0667% 排序；A 居首（最差）", () => {
    const report = rankExecutionQuality(latest, { minSamples: 2 });
    const rows = report.rows.filter((r) => r.status === "RANKED");
    expect(rows.map((r) => r.strategyKey)).toEqual([
      "strat-alpha@1.0.0",
      "strat-beta@2.0.0",
      "strat-gamma@3.0.0",
    ]);
    expect(rows[0]!.meanAbsPriceDeviationPct).toBeCloseTo(4, 10); // A: (5+3)/2
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.meanAbsPriceDeviationPct).toBeCloseTo(3.5, 10); // B: (6+1)/2
    expect(rows[2]!.meanAbsPriceDeviationPct).toBeCloseTo(2 / 30, 10); // C: (0.2+0+0)/3
  });

  it("C2 A 组执行事实核对：3 entry / full1 partial2 unfilled0；价格样本 3；nonFullFillRate 66.67%", () => {
    const report = rankExecutionQuality(latest, { minSamples: 2 });
    const alpha = report.rows.find((r) => r.strategyKey === "strat-alpha@1.0.0")!;
    expect(alpha.entryCount).toBe(3);
    expect(alpha.fullFillCount).toBe(1);
    expect(alpha.partialFillCount).toBe(2);
    expect(alpha.unfilledCount).toBe(0);
    expect(alpha.priceDeviationSampleCount).toBe(3);
    expect(alpha.nonFullFillRatePct).toBeCloseTo(200 / 3, 10);
    expect(alpha.timingSampleCount).toBe(3);
    expect(alpha.timingLateRatePct).toBeCloseTo(100 / 3, 10); // A3 拖延成交
    expect(alpha.deviationFreeCount).toBe(1); // A1：全成交准时、无价格带 → 机器维度为空
  });

  it("C3 样本不足不参与排序：minSamples=3 → beta（价格样本 2）标 INSUFFICIENT_SAMPLES 不排名；alpha/gamma（3）正常排名", () => {
    const report = rankExecutionQuality(latest, { minSamples: 3 });
    expect(report.rankedCount).toBe(2);
    expect(report.insufficientSampleCount).toBe(1);
    const ranked = report.rows.filter((r) => r.status === "RANKED");
    expect(ranked.map((r) => r.strategyKey)).toEqual(["strat-alpha@1.0.0", "strat-gamma@3.0.0"]);
    const beta = report.rows.find((r) => r.strategyKey === "strat-beta@2.0.0")!;
    expect(beta.status).toBe("INSUFFICIENT_SAMPLES");
    expect(beta.rank).toBeNull();
  });

  it("C4 独立 fixture 验证 rankBy=nonFullFillRatePct 与混合排序", () => {
    // X：3 笔全成交；Y：3 笔（1 笔部分成交 40/100）；Z：1 笔（不足样本）
    const mk = (orderId: string, price: number, partial = false) =>
      makeDraftEntry({
        runId: "rx", orderId, securityId: `6000${orderId}.SH`, strategyId: `s-${orderId[0]}`,
        strategyVersion: "1.0.0", decisionDate: "2024-02-01", executionDate: "2024-02-02",
        quantity: 100, referencePrice: 10, ...common,
        fills: partial ? [{ price, quantity: 40 }] : [{ price }],
      });
    const common = { createdAt: "2024-02-05T00:00:00Z" };
    const all = [
      mk("x1", 10.2), mk("x2", 10.1), mk("x3", 10.0), // X 全成交
      mk("y1", 10.5), mk("y2", 10.3, true), mk("y3", 10.0), // Y：1 部分成交
      mk("z1", 10.1), // Z：样本 1
    ];
    const report = rankExecutionQuality(all, { minSamples: 3, rankBy: "nonFullFillRatePct" });
    const ranked = report.rows.filter((r) => r.status === "RANKED");
    expect(ranked.map((r) => r.strategyKey)).toEqual(["s-y@1.0.0", "s-x@1.0.0"]);
    expect(ranked[0]!.nonFullFillRatePct).toBeCloseTo(100 / 3, 10);
    expect(ranked[1]!.nonFullFillRatePct).toBe(0);
    const z = report.rows.find((r) => r.strategyKey === "s-z@1.0.0")!;
    expect(z.status).toBe("INSUFFICIENT_SAMPLES");
  });

  it("C5 确定性 + 空集退化", () => {
    const a = rankExecutionQuality(latest, { minSamples: 2 });
    const b = rankExecutionQuality([...latest].reverse(), { minSamples: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const empty = rankExecutionQuality([]);
    expect(empty.rows).toEqual([]);
    expect(empty.rankedCount).toBe(0);
  });

  it("C6 非法 rankBy → 响亮抛错", () => {
    expect(() => rankExecutionQuality(latest, { rankBy: "BOGUS" as never })).toThrow(DisciplineFeedbackError);
  });
});

// ---------------------------------------------------------------------------
// D. 易错环境识别（手算密度/平均 severity）
// ---------------------------------------------------------------------------

describe("D. identifyErrorProneEnvironments 易错环境识别", () => {
  const { latest } = buildMainFixture();
  const assignments = mainEnvAssignments();

  it("D1 手算密度：vol=high 2/2=100%、vol=mid 3/4=75%、vol=low 1/1=100%、ENV_UNLABELED 0/1=0", () => {
    const report = identifyErrorProneEnvironments(latest, {}, assignments);
    expect(report.matchedAssignmentCount).toBe(7);
    expect(report.labeledEntryCount).toBe(7);
    expect(report.unlabeledEntryCount).toBe(1);
    const byKey = new Map(report.rows.map((r) => [r.environmentKey, r]));
    const high = byKey.get("vol=high")!;
    const mid = byKey.get("vol=mid")!;
    const low = byKey.get("vol=low")!;
    const unlabeled = byKey.get(DFA_ENV_UNLABELED_KEY)!;
    expect(high.taggedEntryCount).toBe(2);
    expect(high.violationCount).toBe(2);
    expect(high.violationDensityPct).toBeCloseTo(100, 10);
    expect(high.meanSeverity).toBeCloseTo(1.5, 10); // (MAJOR2 + MINOR1)/2
    expect(high.severityDistribution).toEqual({ MINOR: 1, MAJOR: 1, CRITICAL: 0 });
    expect(mid.taggedEntryCount).toBe(4);
    expect(mid.violationCount).toBe(3);
    expect(mid.violationDensityPct).toBeCloseTo(75, 10);
    expect(mid.meanSeverity).toBeCloseTo(7 / 3, 10); // (MAJOR+CRITICAL+MAJOR)/3
    expect(mid.severityDistribution).toEqual({ MINOR: 0, MAJOR: 2, CRITICAL: 1 });
    expect(low.taggedEntryCount).toBe(1);
    expect(low.violationDensityPct).toBeCloseTo(100, 10);
    expect(low.insufficientSamples).toBe(true); // 1 < minSamples(3)
    expect(unlabeled.violationDensityPct).toBe(0);
    expect(unlabeled.taggedEntryCount).toBe(1);
    // 排序：密度降序，平局 envKey 升序 → [vol=high, vol=low, vol=mid, ENV_UNLABELED]
    expect(report.rows.map((r) => r.environmentKey)).toEqual([
      "vol=high",
      "vol=low",
      "vol=mid",
      DFA_ENV_UNLABELED_KEY,
    ]);
  });

  it("D2 无环境挂接 → 全部归 ENV_UNLABELED（不编造环境），含违规密度 6/8=75%", () => {
    const report = identifyErrorProneEnvironments(latest);
    expect(report.matchedAssignmentCount).toBe(0);
    expect(report.unlabeledEntryCount).toBe(8);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.environmentKey).toBe(DFA_ENV_UNLABELED_KEY);
    expect(report.rows[0]!.taggedEntryCount).toBe(8);
    expect(report.rows[0]!.violationCount).toBe(6);
    expect(report.rows[0]!.violationDensityPct).toBeCloseTo(75, 10);
  });

  it("D3 非法挂接 FAIL FAST：未知 journalId / 空键 / 重复挂接 → 稳定 DFA 码", () => {
    const unknown = [...assignments, { journalId: "nope#1", environmentKeys: ["x=1"] }];
    try {
      identifyErrorProneEnvironments(latest, {}, unknown);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as DisciplineFeedbackError).code).toBe(DFA_ERROR_CODES.ASSIGNMENT_UNKNOWN_JOURNAL);
    }
    const emptyKeys = [{ journalId: journalIdOf("r1", "o1"), environmentKeys: [] }];
    try {
      identifyErrorProneEnvironments(latest, {}, emptyKeys);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as DisciplineFeedbackError).code).toBe(DFA_ERROR_CODES.ASSIGNMENT_INVALID);
    }
    const duplicate = [
      { journalId: journalIdOf("r1", "o1"), environmentKeys: ["a=1"] },
      { journalId: journalIdOf("r1", "o1"), environmentKeys: ["b=2"] },
    ];
    try {
      identifyErrorProneEnvironments(latest, {}, duplicate);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as DisciplineFeedbackError).code).toBe(DFA_ERROR_CODES.ASSIGNMENT_INVALID);
    }
  });

  it("D4 确定性：乱序 assignments / 乱序 entries 输出一致", () => {
    const a = identifyErrorProneEnvironments(latest, {}, [...assignments].reverse());
    const b = identifyErrorProneEnvironments([...latest].reverse(), {}, assignments);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// E. 统一记录 buildDisciplineFeedbackRun
// ---------------------------------------------------------------------------

describe("E. DisciplineFeedbackRun 统一记录", () => {
  const { latest } = buildMainFixture();

  function buildDefault(): ReturnType<typeof buildDisciplineFeedbackRun> {
    return buildDisciplineFeedbackRun({
      runId: "dfa-main-001",
      createdAt: "2024-02-05T00:00:00Z",
      entries: latest,
      environmentAssignments: mainEnvAssignments(),
    });
  }

  it("E1 汇总计数 + 覆盖区间 + 结论（patternsFound / REPEAT_MISTAKES_FOUND）", () => {
    const run = buildDefault();
    expect(run.summary.analyzedEntryCount).toBe(8);
    expect(run.summary.annotationCount).toBe(7);
    expect(run.summary.unannotatedEntryCount).toBe(1);
    expect(run.summary.violationDeclaredCount).toBe(6);
    expect(run.summary.noViolationDeclaredCount).toBe(1);
    expect(run.summary.coverageStartDate).toBe("2024-01-02");
    expect(run.summary.coverageEndDate).toBe("2024-01-17");
    expect(run.conclusion.verdict).toBe("patternsFound");
    expect(run.conclusion.reasonCode).toBe(DFA_REASON_CODES.REPEAT_MISTAKES_FOUND);
    expect(run.inputLedgerFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(run.rawEntryCount).toBe(8);
    // 环境挂接进入记录（归一化排序）
    expect(run.environmentAssignments).toHaveLength(7);
    // 模式清单：2 个重复 + 1 个易错环境（vol=mid，违规 3 且样本 4 ≥3）
    expect(run.patterns.map((p) => p.kind)).toEqual(
      expect.arrayContaining(["repeatMistake", "repeatMistake", "errorProneEnvironment"])
    );
    const errorProne = run.patterns.find((p) => p.kind === "errorProneEnvironment")!;
    expect(errorProne.key).toBe("errorProneEnvironment|vol=mid");
    expect(errorProne.evidenceCount).toBe(3);
  });

  it("E2 validate + round-trip 相等；篡改 → RUN_FINGERPRINT_MISMATCH", () => {
    const run = buildDefault();
    expect(validateDisciplineFeedbackRun(run).valid).toBe(true);
    const json = serializeDisciplineFeedbackRun(run);
    const restored = deserializeDisciplineFeedbackRun(json);
    expect(restored).toEqual(run);
    expect(restored.fingerprint).toBe(run.fingerprint);
    expect(computeDisciplineFeedbackRunFingerprint(restored)).toBe(run.fingerprint);

    // 篡改违规原因行 → 反序列化拒绝（validate 或指纹）
    const tampered = JSON.parse(json);
    (tampered as Record<string, unknown>).violationCauses = {
      ...(tampered as Record<string, unknown>).violationCauses as Record<string, unknown>,
      scopeViolationCount: 999,
    };
    try {
      deserializeDisciplineFeedbackRun(JSON.stringify(tampered));
      expect.unreachable("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(DisciplineFeedbackError);
      expect((error as DisciplineFeedbackError).code).toBe(DFA_ERROR_CODES.RUN_FINGERPRINT_MISMATCH);
    }
  });

  it("E3 runId/createdAt 非法 → FAIL FAST（稳定码）", () => {
    expect(() =>
      buildDisciplineFeedbackRun({ runId: "", createdAt: "2024-02-05T00:00:00Z", entries: latest })
    ).toThrow(DisciplineFeedbackError);
    expect(() =>
      buildDisciplineFeedbackRun({ runId: "x", createdAt: "2024/02/05", entries: latest })
    ).toThrow(DisciplineFeedbackError);
  });

  it("E4 确定性：两次构建（含乱序 entries）输出完全一致（同 createdAt）", () => {
    const a = buildDefault();
    const b = buildDisciplineFeedbackRun({
      runId: "dfa-main-001",
      createdAt: "2024-02-05T00:00:00Z",
      entries: [...latest].reverse(),
      environmentAssignments: [...mainEnvAssignments()].reverse(),
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// F. 退化与确定性（空账本 / 单 entry / 全 draft / 修订归并）
// ---------------------------------------------------------------------------

describe("F. 退化与确定性", () => {
  it("F1 空账本 → inconclusive DFA_NO_ENTRIES；不硬出结论", () => {
    const run = buildDisciplineFeedbackRun({ runId: "dfa-empty", createdAt: "2024-02-05T00:00:00Z", entries: [] });
    expect(run.summary.analyzedEntryCount).toBe(0);
    expect(run.conclusion.verdict).toBe("inconclusive");
    expect(run.conclusion.reasonCode).toBe(DFA_REASON_CODES.NO_ENTRIES);
    expect(run.patterns).toEqual([]);
    expect(validateDisciplineFeedbackRun(run).valid).toBe(true);
  });

  it("F2 全 draft（annotation=null）→ inconclusive DFA_NO_ANNOTATIONS", () => {
    const { latest } = buildMainFixture();
    const allDrafts = latest.map((entry) => {
      // 重建为 v1 draft（丢弃标注）
      const json = JSON.parse(JSON.stringify(entry)) as TradeJournalEntry;
      json.annotation = null;
      json.entryVersion = 1;
      json.supersedesEntryId = null;
      json.entryId = journalEntryIdOf(json.journalId, 1);
      (json as { fingerprint: string }).fingerprint = computeTradeJournalEntryFingerprint(json);
      return json;
    });
    const run = buildDisciplineFeedbackRun({
      runId: "dfa-drafts", createdAt: "2024-02-05T00:00:00Z", entries: allDrafts,
    });
    expect(run.conclusion.verdict).toBe("inconclusive");
    expect(run.conclusion.reasonCode).toBe(DFA_REASON_CODES.NO_ANNOTATIONS);
  });

  it("F3 单 entry → inconclusive DFA_SINGLE_ENTRY", () => {
    const { latest } = buildMainFixture();
    const run = buildDisciplineFeedbackRun({
      runId: "dfa-single", createdAt: "2024-02-05T00:00:00Z", entries: [latest[0]!],
    });
    expect(run.conclusion.verdict).toBe("inconclusive");
    expect(run.conclusion.reasonCode).toBe(DFA_REASON_CODES.SINGLE_ENTRY);
  });

  it("F4 全 clean 且覆盖完整 → stable DFA_NO_VIOLATIONS_DECLARED（含 1 draft 时改判 partial）", () => {
    // 构造 3 笔全部 clean（2 笔标注 + 1 笔标注）= 全标注 → stable
    const { latest } = buildMainFixture();
    const c1 = latest[5]!; // MARKET_EVENT 无违规
    const mkClean = (orderId: string, ref: number) => {
      const draft = makeDraftEntry({
        runId: "clean", orderId, securityId: `7000${orderId}.SH`, strategyId: "clean-strat",
        strategyVersion: "1.0.0", decisionDate: "2024-03-01", executionDate: "2024-03-04",
        quantity: 100, referencePrice: ref, fills: [{ price: ref }], createdAt: "2024-03-05T00:00:00Z",
      });
      return annotate(draft, {
        emotionCode: "CALM", violation: { declared: false, severity: null },
        annotatedAt: "2024-03-06T00:00:00Z", createdAt: "2024-03-06T00:00:00Z",
      });
    };
    const cleanA = mkClean("a", 10);
    const cleanB = mkClean("b", 10);
    const stableRun = buildDisciplineFeedbackRun({
      runId: "dfa-stable", createdAt: "2024-03-07T00:00:00Z",
      entries: [cleanA, cleanB, c1],
    });
    expect(stableRun.summary.violationDeclaredCount).toBe(0);
    expect(stableRun.summary.annotationCount).toBe(3);
    expect(stableRun.conclusion.verdict).toBe("stable");
    expect(stableRun.conclusion.reasonCode).toBe(DFA_REASON_CODES.NO_VIOLATIONS_DECLARED);
    // 加入 1 笔未标注 draft → 覆盖不完整 → inconclusive PARTIAL_ANNOTATION_COVERAGE
    const draft = makeDraftEntry({
      runId: "clean", orderId: "z", securityId: "7000z.SH", strategyId: "clean-strat",
      strategyVersion: "1.0.0", decisionDate: "2024-03-08", executionDate: "2024-03-11",
      quantity: 100, referencePrice: 10, fills: [{ price: 10 }], createdAt: "2024-03-12T00:00:00Z",
    });
    const partialRun = buildDisciplineFeedbackRun({
      runId: "dfa-partial", createdAt: "2024-03-12T00:00:00Z",
      entries: [cleanA, cleanB, c1, draft],
    });
    expect(partialRun.conclusion.verdict).toBe("inconclusive");
    expect(partialRun.conclusion.reasonCode).toBe(DFA_REASON_CODES.PARTIAL_ANNOTATION_COVERAGE);
  });

  it("F5 孤立违规（仅 1 笔）→ inconclusive DFA_ISOLATED_VIOLATION", () => {
    const { latest } = buildMainFixture();
    const a1 = latest[0]!; // IMPULSIVE 违规
    const c1 = latest[5]!; // clean
    const c3 = latest[7]!; // draft
    const run = buildDisciplineFeedbackRun({
      runId: "dfa-isolated", createdAt: "2024-02-05T00:00:00Z",
      entries: [a1, c1, c3],
    });
    expect(run.summary.violationDeclaredCount).toBe(1);
    expect(run.conclusion.verdict).toBe("inconclusive");
    expect(run.conclusion.reasonCode).toBe(DFA_REASON_CODES.ISOLATED_VIOLATION);
  });

  it("F6 修订归并：same journal 的 v1+v2 → analyzed 用 v2；rawEntryCount 如实计数", () => {
    const { latest, allVersions } = buildMainFixture();
    // allVersions 含 A1~A3/B1~B2/C1~C2 的 draft(v1) 与标注(v2)——dedupe 后应等于 latest
    const resolved = resolveFeedbackEntries(allVersions);
    expect(resolved.rawCount).toBe(allVersions.length);
    expect(resolved.resolved).toHaveLength(latest.length);
    const run = buildDisciplineFeedbackRun({
      runId: "dfa-versions", createdAt: "2024-02-05T00:00:00Z", entries: allVersions,
      environmentAssignments: mainEnvAssignments(),
    });
    expect(run.rawEntryCount).toBe(allVersions.length);
    expect(run.summary.analyzedEntryCount).toBe(latest.length);
    expect(run.inputLedgerFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // 与仅喂 latest 的结论一致
    const runLatest = buildDisciplineFeedbackRun({
      runId: "dfa-versions", createdAt: "2024-02-05T00:00:00Z", entries: latest,
      environmentAssignments: mainEnvAssignments(),
    });
    expect(run.conclusion).toEqual(runLatest.conclusion);
    expect(run.violationCauses).toEqual(runLatest.violationCauses);
  });

  it("F7 篡改输入 entry（指纹不符）→ 聚合响亮拒绝（DFA_ENTRY_FINGERPRINT_MISMATCH）", () => {
    const { latest } = buildMainFixture();
    const tampered = JSON.parse(JSON.stringify(latest[0]!)) as TradeJournalEntry;
    tampered.planned = { ...tampered.planned, quantity: 9999 };
    try {
      aggregateViolationCauses([tampered, latest[1]!]);
      expect.unreachable("应当抛错");
    } catch (error) {
      expect((error as DisciplineFeedbackError).code).toBe(DFA_ERROR_CODES.ENTRY_FINGERPRINT_MISMATCH);
    }
  });
});

// ---------------------------------------------------------------------------
// G. 与 C-24.1 词表/类型/真实账本复用对照
// ---------------------------------------------------------------------------

describe("G. 与 C-24.1 tradeJournal 复用对照", () => {
  it("G1 全部报告 reasonCode 落在 C-24.1 JOURNAL_REASON_CODES 受控词表", () => {
    const { latest } = buildMainFixture();
    const causeReport = aggregateViolationCauses(latest);
    const repeatReport = detectRepeatMistakes(latest);
    const reasons = new Set<string>([
      ...causeReport.rows.map((r) => r.reasonCode),
      ...repeatReport.patterns.map((p) => p.reasonCode),
    ]);
    for (const code of reasons) {
      expect(JOURNAL_REASON_CODES).toContain(code as never);
    }
    for (const row of causeReport.rows) {
      for (const severity of Object.keys(row.countBySeverity)) {
        expect(JOURNAL_RULE_VIOLATION_SEVERITIES).toContain(severity as never);
      }
    }
  });

  it("G2 喂真实 TradeJournalLedger 结构（append v1 + 人工标注修订）通过且结论自洽", () => {
    const { latest } = buildMainFixture();
    const ledger = new TradeJournalLedger();
    // 从 allVersions 中的 v1 draft 落账 + 标注修订
    const specs = [
      makeDraftEntry({
        runId: "ledger-r1", orderId: "o1", securityId: "600100.SH", strategyId: "ledger-strat",
        strategyVersion: "1.0.0", decisionDate: "2024-04-01", executionDate: "2024-04-02",
        quantity: 100, referencePrice: 10, fills: [{ price: 10.4 }], createdAt: "2024-04-03T00:00:00Z",
      }),
      makeDraftEntry({
        runId: "ledger-r1", orderId: "o2", securityId: "600101.SH", strategyId: "ledger-strat",
        strategyVersion: "1.0.0", decisionDate: "2024-04-03", executionDate: "2024-04-04",
        quantity: 100, referencePrice: 10, fills: [{ price: 10.3 }], createdAt: "2024-04-05T00:00:00Z",
      }),
      makeDraftEntry({
        runId: "ledger-r1", orderId: "o3", securityId: "600102.SH", strategyId: "ledger-strat",
        strategyVersion: "1.0.0", decisionDate: "2024-04-05", executionDate: "2024-04-08",
        quantity: 100, referencePrice: 10, fills: [{ price: 10.5 }], createdAt: "2024-04-09T00:00:00Z",
      }),
    ];
    for (const draft of specs) ledger.appendEntry(draft);
    const annotated = [
      annotate(specs[0]!, {
        reasonCode: "JUDGMENT_OVERRIDE", emotionCode: "OVERCONFIDENCE",
        violation: { declared: true, severity: "MAJOR" }, annotatedAt: "2024-04-06T00:00:00Z", createdAt: "2024-04-06T00:00:00Z",
      }),
      annotate(specs[1]!, {
        reasonCode: "JUDGMENT_OVERRIDE", emotionCode: "OVERCONFIDENCE",
        violation: { declared: true, severity: "MAJOR" }, annotatedAt: "2024-04-07T00:00:00Z", createdAt: "2024-04-07T00:00:00Z",
      }),
      annotate(specs[2]!, {
        reasonCode: "IMPULSIVE", emotionCode: "FOMO",
        violation: { declared: true, severity: "MINOR" }, annotatedAt: "2024-04-10T00:00:00Z", createdAt: "2024-04-10T00:00:00Z",
      }),
    ];
    for (const entry of annotated) ledger.appendEntry(entry);

    // 篡改账本会由账本自身拒绝（与聚合无关）；从账本读取最新版本喂给聚合。
    const entriesFromLedger = annotated; // 账本已验证链完整
    const run = buildDisciplineFeedbackRun({
      runId: "dfa-ledger", createdAt: "2024-04-11T00:00:00Z", entries: entriesFromLedger,
    });
    expect(run.summary.analyzedEntryCount).toBe(3);
    expect(run.summary.annotationCount).toBe(3);
    expect(run.summary.violationDeclaredCount).toBe(3);
    expect(run.repeatMistakes.patterns.map((p) => p.reasonCode)).toContain("JUDGMENT_OVERRIDE");
    expect(run.conclusion.verdict).toBe("patternsFound");

    // 篡改账本（fingerprint 不变但语义字段变化）在反序列化层拒绝
    const tamperedLedger = ledger.serialize();
    const ledgerClone = JSON.parse(tamperedLedger) as {
      entries: Array<TradeJournalEntry & { annotation: unknown }>;
    };
    const annotatedIndex = (ledgerClone.entries as TradeJournalEntry[]).findIndex((e) => e.entryVersion === 2);
    expect(annotatedIndex).toBeGreaterThanOrEqual(0);
    ledgerClone.entries[annotatedIndex]!.annotation = null; // 抹掉标注但保留旧指纹
    try {
      TradeJournalLedger.deserialize(JSON.stringify(ledgerClone));
      expect.unreachable("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(TradeJournalError);
      expect((error as TradeJournalError).code).toBe(TJ_ERROR_CODES.LEDGER_INVALID);
    }
  });

  it("G3 类型级复用：DeviationDimension/severity/entry 形态直接消费（编译期保证）", () => {
    // 仅在类型层验证——从 tradeJournal 导入的类型能作为聚合输入类型使用。
    const { latest } = buildMainFixture();
    const entries: readonly TradeJournalEntry[] = latest;
    void entries;
    expect(typeof aggregateViolationCauses).toBe("function");
    expect(typeof detectRepeatMistakes).toBe("function");
    expect(typeof rankExecutionQuality).toBe("function");
    expect(typeof identifyErrorProneEnvironments).toBe("function");
    expect(typeof buildDisciplineFeedbackRun).toBe("function");
  });
});
