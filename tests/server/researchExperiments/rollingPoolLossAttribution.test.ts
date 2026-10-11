/**
 * `FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001` —— 纯分析库测试（**全部为合成夹具**）。
 *
 * 🔴 本文件**不读** Run 产物、**不连**数据库、**不重跑**实验：只喂**手工构造**的
 *    已解析行，锁定冻结口径：标签边界、21 根收盘窗口、逐日排序破平键、
 *    8 桶互斥优先级、`S1`↔`S6c` 分离与交叉表、`BIG50_PATH`-only 不得进漏斗。
 */
import { describe, expect, it } from "vitest";
import {
  ACTIONABLE_HOLDING_DAYS,
  BIG50_THRESHOLD,
  BUCKET_IDS,
  DAILY_TOP_K,
  S6_SUB_BUCKET_IDS,
  aggregateFunnel,
  buildOpportunityLabel,
  booleanOrNull,
  classifyOpportunity,
  coOccurrenceOf,
  compareCandidates,
  derivePrimaryRejection,
  describeStats,
  exitReasonBucketOf,
  isFunnelOpportunity,
  labelEntryDay,
  numberOrNull,
  parseCsvTable,
  pathLabel,
  rankCandidatesPerDay,
  summarizeGiveUp,
  toCsvText,
  tradeForwardRows,
  triggerSelectionOf,
  type CandidateDayRow,
  type FailedAttemptRow,
  type ForwardBar,
  type ForwardBars,
  type GroupSpecLite,
  type ObservationLedgerRow,
  type OpportunityClassificationInput,
  type OpportunityLabel,
  type PrimaryRejection,
  type TradeRow,
} from "../../../research-experiments/shared/rollingPoolLossAttribution";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const GROUP_A: GroupSpecLite = {
  id: "A",
  observationDays: 2,
  entryFillMaxRd: 10,
  reentryKind: "SIGNAL_REENTRY",
};
const GROUP_E: GroupSpecLite = {
  id: "E",
  observationDays: 5,
  entryFillMaxRd: 20,
  reentryKind: "SINGLE_ENTRY",
};

interface BarInput {
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
  readonly tradeDate?: string;
}

function makeBars(entries: Readonly<Record<number, BarInput>>): ForwardBars {
  const map = new Map<number, ForwardBar>();
  for (const [key, value] of Object.entries(entries)) {
    const relativeDay = Number(key);
    map.set(relativeDay, {
      relativeDay,
      tradeDate: value.tradeDate ?? `2025-03-${String(relativeDay).padStart(2, "0")}`,
      open: value.open ?? null,
      high: value.high ?? null,
      low: value.low ?? null,
      close: value.close ?? null,
    });
  }
  return map;
}

/** 入场日开盘 `entryOpen`，其后窗口内最高收盘 `maxClose`（其余日收盘更低）。 */
function flatWindowBars(args: {
  readonly confirmRd: number;
  readonly entryOpen: number;
  readonly maxClose: number;
  readonly spikeAt?: number;
}): ForwardBars {
  const fillRd = args.confirmRd + 1;
  const entries: Record<number, BarInput> = {
    [fillRd]: { open: args.entryOpen, high: args.entryOpen, low: args.entryOpen, close: args.entryOpen },
  };
  for (let rd = fillRd + 1; rd <= fillRd + ACTIONABLE_HOLDING_DAYS; rd += 1) {
    entries[rd] = { close: args.entryOpen * 0.99, high: args.entryOpen * 0.99 };
  }
  const spikeAt = args.spikeAt ?? fillRd;
  entries[spikeAt] = { ...entries[spikeAt], close: args.maxClose, high: args.maxClose };
  return makeBars(entries);
}

const ANCHOR = "600000.SH@2025-02-10";

function candidateRow(confirmRd: number, overrides: Partial<CandidateDayRow> = {}): CandidateDayRow {
  return {
    date: `2025-03-${String(confirmRd).padStart(2, "0")}`,
    anchorEventId: ANCHOR,
    symbol: "600000.SH",
    securityId: "sec_test",
    eventAge: confirmRd,
    confirmRd,
    fillRd: confirmRd + 1,
    fillDate: `2025-03-${String(confirmRd + 1).padStart(2, "0")}`,
    preReturn10: 0.02,
    triggerOrdinal: 1,
    isLaterTriggerDay: false,
    ...overrides,
  };
}

function observationRow(
  relativeDay: number,
  overrides: Partial<ObservationLedgerRow> = {},
): ObservationLedgerRow {
  return {
    anchorEventId: ANCHOR,
    symbol: "600000.SH",
    eventDate: "2025-02-10",
    relativeDay,
    tradeDate: `2025-02-${String(10 + relativeDay).padStart(2, "0")}`,
    support: 1,
    shrink: 1,
    lowStable: 1,
    closeImprove: 1,
    score: 4,
    missingReason: null,
    supportBreached: false,
    triggerGroups: [],
    isCandidateAnchor: true,
    ...overrides,
  };
}

function tradeRow(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    securityId: "sec_test",
    anchorEventId: ANCHOR,
    symbol: "600000.SH",
    entryTime: "2025-03-11",
    entryPrice: 10,
    exitTime: "2025-03-14",
    exitPrice: 10.5,
    quantity: 1_000,
    returnPct: 5,
    netPnl: 500,
    fees: 20,
    holdingPeriod: 3,
    openAtEnd: false,
    reason: "止损（轨10.5，约6.00%）",
    ...overrides,
  };
}

function failedAttempt(overrides: Partial<FailedAttemptRow> = {}): FailedAttemptRow {
  return {
    accountId: "E#0",
    group: "E",
    anchorEventId: ANCHOR,
    symbol: "600000.SH",
    attemptedConfirmDate: "2025-03-10",
    plannedFillDate: "2025-03-11",
    skipCode: "MEMBER_ENTRY_LIMIT_REACHED",
    reason: "同锚点累计买入次数已达上限 1",
    priorEntryOrdinalActual: 1,
    priorActualExitDate: null,
    ...overrides,
  };
}

function actionableLabel(confirmRd: number, maxReturn = 0.6): OpportunityLabel {
  return {
    big50Actionable: true,
    actionableDay: {
      confirmRd,
      fillRd: confirmRd + 1,
      fillDate: "2025-03-11",
      entryOpen: 10,
      windowBarCount: 21,
      maxClose: 16,
      maxCloseRd: confirmRd + 4,
      maxReturn,
      reached: true,
    },
    big100Actionable: false,
    big50Path: {
      base: 9,
      windowBarCount: 40,
      maxClose: 16,
      maxCloseRd: 20,
      maxReturn: maxReturn,
      reached: true,
    },
    big100Path: {
      base: 9,
      windowBarCount: 40,
      maxClose: 16,
      maxCloseRd: 20,
      maxReturn: maxReturn,
      reached: false,
    },
  };
}

/** 让某个锚点在给定日期拿到指定名次（用更高因子值的填充行垫出 rank − 1 行）。 */
function rowsForRank(args: {
  readonly date: string;
  readonly anchorEventId: string;
  readonly rank: number;
  readonly preReturn10: number;
}): CandidateDayRow[] {
  const rows: CandidateDayRow[] = [];
  for (let index = 1; index < args.rank; index += 1) {
    rows.push(
      candidateRow(0, {
        date: args.date,
        anchorEventId: `FILLER${index}.SH@2025-01-01`,
        symbol: `F${String(index).padStart(3, "0")}.SH`,
        preReturn10: args.preReturn10 + 0.01 * index,
      }),
    );
  }
  rows.push(
    candidateRow(0, {
      date: args.date,
      anchorEventId: args.anchorEventId,
      preReturn10: args.preReturn10,
    }),
  );
  return rows;
}

function classificationInput(
  overrides: Partial<OpportunityClassificationInput> & {
    readonly rank?: number;
    readonly actionableConfirmRd?: number;
  } = {},
): OpportunityClassificationInput {
  const actionableConfirmRd = overrides.actionableConfirmRd ?? 7;
  const rank = overrides.rank ?? 1;
  const triggerDays = overrides.triggerDays ?? [candidateRow(9)];
  const actionableRow =
    overrides.actionableRow === undefined
      ? candidateRow(actionableConfirmRd, { date: "2025-03-07" })
      : overrides.actionableRow;
  const probe = triggerDays[0] ?? candidateRow(actionableConfirmRd, { date: "2025-03-07" });
  const ranking = rankCandidatesPerDay(
    rowsForRank({ date: probe.date, anchorEventId: probe.anchorEventId, rank, preReturn10: probe.preReturn10 ?? 0.02 }),
  );
  const selection =
    overrides.selection
    ?? triggerSelectionOf({
      anchorEventId: probe.anchorEventId,
      triggerDays,
      ranking,
      actionableDate: actionableRow?.date ?? null,
    });
  return {
    group: "E",
    anchorEventId: ANCHOR,
    symbol: "600000.SH",
    eventDate: "2025-02-10",
    label: overrides.label ?? actionableLabel(actionableConfirmRd),
    triggerDays,
    actionableRow,
    observationRows: overrides.observationRows ?? [observationRow(1), observationRow(2)],
    rejection: overrides.rejection ?? null,
    selection,
    trades: overrides.trades ?? [],
    failedAttempts: overrides.failedAttempts ?? [],
  };
}

// ---------------------------------------------------------------------------
// 1) 标签边界与窗口口径
// ---------------------------------------------------------------------------

describe("标签：口径与边界（规格 §3）", () => {
  it("+49.99% 不达标，+50.00% 达标（两端闭的 21 根收盘窗口）", () => {
    const below = labelEntryDay(flatWindowBars({ confirmRd: 0, entryOpen: 10, maxClose: 14.999 }), 0, BIG50_THRESHOLD);
    const exactly = labelEntryDay(flatWindowBars({ confirmRd: 0, entryOpen: 10, maxClose: 15 }), 0, BIG50_THRESHOLD);
    expect(below.maxReturn).toBeCloseTo(0.4999, 10);
    expect(below.reached).toBe(false);
    expect(exactly.maxReturn).toBeCloseTo(0.5, 12);
    expect(exactly.reached).toBe(true);
  });

  it("窗口是 [fillRd, fillRd + 20]：第 21 根收盘计入，第 22 根不计入", () => {
    const confirmRd = 0;
    const fillRd = confirmRd + 1;
    const onEdge = flatWindowBars({
      confirmRd,
      entryOpen: 10,
      maxClose: 15,
      spikeAt: fillRd + ACTIONABLE_HOLDING_DAYS,
    });
    const beyondOnly = flatWindowBars({
      confirmRd,
      entryOpen: 10,
      maxClose: 15,
      spikeAt: fillRd + ACTIONABLE_HOLDING_DAYS + 1,
    });
    expect(onEdge.get(fillRd + ACTIONABLE_HOLDING_DAYS)?.close).toBeCloseTo(15, 10);
    expect(beyondOnly.get(fillRd + ACTIONABLE_HOLDING_DAYS + 1)?.close).toBeCloseTo(15, 10);
    expect(labelEntryDay(onEdge, confirmRd, BIG50_THRESHOLD).reached).toBe(true);
    // 尖峰只在窗口外的第 22 根 ⇒ 不得达标（窗口两端闭在 fillRd + 20）。
    expect(labelEntryDay(beyondOnly, confirmRd, BIG50_THRESHOLD).reached).toBe(false);
    expect(ACTIONABLE_HOLDING_DAYS).toBe(20);
  });

  it("缺少入场 bar（无 open）⇒ 不可评估，绝不当作达标", () => {
    const bars = makeBars({ 2: { close: 100, high: 100 } });
    const label = labelEntryDay(bars, 0, BIG50_THRESHOLD);
    expect(label.entryOpen).toBeNull();
    expect(label.maxReturn).toBeNull();
    expect(label.reached).toBe(false);
  });

  it("背景标签 BIG50_PATH 用 close(rd0) 为基准、窗口 rd1..rd40（+49.99% vs +50.00%）", () => {
    const build = (close: number): ForwardBars => {
      const entries: Record<number, BarInput> = {};
      for (let rd = 1; rd <= 40; rd += 1) entries[rd] = { close: rd === 40 ? close : 11 };
      return makeBars(entries);
    };
    expect(pathLabel(build(14.999), 10, BIG50_THRESHOLD).reached).toBe(false);
    expect(pathLabel(build(15), 10, BIG50_THRESHOLD).reached).toBe(true);
    expect(pathLabel(build(100), 10, BIG50_THRESHOLD).maxCloseRd).toBe(40);
  });

  it("BIG50_PATH-only（大涨但不在任何可入场窗口内）**不进入漏斗**", () => {
    // 尖峰在 rd40（在 path 窗口内），但确认日 rd1..9 的入场窗口最远只到 rd30。
    const entries: Record<number, BarInput> = { 0: { close: 10 } };
    for (let rd = 1; rd <= 40; rd += 1) {
      entries[rd] = { open: 10, close: rd === 40 ? 16 : 10, high: rd === 40 ? 16 : 10 };
    }
    const bars = makeBars(entries);
    const label = buildOpportunityLabel({ bars, rd0Close: 10, candidateConfirmRds: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    expect(label.big50Path.reached).toBe(true);
    expect(label.actionableDay).toBeNull();
    expect(isFunnelOpportunity(label)).toBe(false);
    expect(() =>
      classifyOpportunity(classificationInput({ label, actionableConfirmRd: 7 })),
    ).toThrow(/BIG50_PATH_ONLY/);

    // 漏斗计数：被过滤掉的机会不计入任何桶，但 8 行仍然全部出现（含 0）。
    const funnel = aggregateFunnel([]);
    expect(funnel.total).toBe(0);
    expect(funnel.rows.map((row) => row.bucket)).toEqual([...BUCKET_IDS]);
    expect(funnel.rows.every((row) => row.count === 0 && row.share === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2) 逐日排序与破平键
// ---------------------------------------------------------------------------

describe("逐日 R 排序（规格 §4 第 5 行）", () => {
  it("preReturn10 降序 → symbol 升序 → eventId 升序；TopK=3", () => {
    const rows = [
      candidateRow(0, { date: "2025-03-01", anchorEventId: "B@1", symbol: "B.SZ", preReturn10: 0.1 }),
      candidateRow(0, { date: "2025-03-01", anchorEventId: "A2@1", symbol: "A.SZ", preReturn10: 0.2 }),
      candidateRow(0, { date: "2025-03-01", anchorEventId: "A1@1", symbol: "A.SZ", preReturn10: 0.2 }),
      candidateRow(0, { date: "2025-03-01", anchorEventId: "C@1", symbol: "C.SZ", preReturn10: 0.05 }),
      candidateRow(0, { date: "2025-03-01", anchorEventId: "N@1", symbol: "N.SZ", preReturn10: null }),
    ];
    const ranking = rankCandidatesPerDay(rows);
    expect(ranking.byDate.get("2025-03-01")?.map((row) => row.anchorEventId)).toEqual([
      "A1@1",
      "A2@1",
      "B@1",
      "C@1",
    ]);
    expect(ranking.rankOf.get("2025-03-01|C@1")).toBe(4);
    expect(ranking.topKAnchors.get("2025-03-01")).toEqual(new Set(["A1@1", "A2@1", "B@1"]));
    // `preReturn10` 缺失的行**不参与排序**（不猜名次）。
    expect(ranking.rankOf.has("2025-03-01|N@1")).toBe(false);
    expect(DAILY_TOP_K).toBe(3);
  });

  it("破平键在因子值完全相同的边界上决定 TopK，并如实计入 boundaryTieDayCount", () => {
    const rows = [
      candidateRow(0, { date: "2025-03-02", anchorEventId: "B@1", symbol: "B.SZ", preReturn10: 0.2 }),
      candidateRow(0, { date: "2025-03-02", anchorEventId: "A@1", symbol: "A.SZ", preReturn10: 0.2 }),
      candidateRow(0, { date: "2025-03-02", anchorEventId: "D@1", symbol: "D.SZ", preReturn10: 0.2 }),
      candidateRow(0, { date: "2025-03-02", anchorEventId: "C@1", symbol: "C.SZ", preReturn10: 0.2 }),
    ];
    const ranking = rankCandidatesPerDay(rows);
    // 因子值完全相同时，**名次由破平键决定**（symbol 升序）⇒ C 在 D 之前进入 TopK。
    expect(ranking.byDate.get("2025-03-02")?.map((row) => row.anchorEventId)).toEqual([
      "A@1",
      "B@1",
      "C@1",
      "D@1",
    ]);
    expect(ranking.rankOf.get("2025-03-02|C@1")).toBe(3);
    expect(ranking.rankOf.get("2025-03-02|D@1")).toBe(4);
    expect(ranking.boundaryTieDayCount).toBe(1);
    expect(compareCandidates(rows[0] as CandidateDayRow, rows[1] as CandidateDayRow)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3) 「从未触发」的首要拒绝原因（S2/S3 的分流依据）
// ---------------------------------------------------------------------------

describe("首要拒绝原因（规则库顺序重放，仅用产物 + 只读行情）", () => {
  const rows = (overrides: Readonly<Record<number, Partial<ObservationLedgerRow>>>): ObservationLedgerRow[] =>
    Array.from({ length: 9 }, (_, index) => observationRow(index + 1, overrides[index + 1] ?? {}));

  function barsFor(pullbackClose: number, closeAt9: number, high: number): ForwardBars {
    const entries: Record<number, BarInput> = {};
    for (let rd = 1; rd <= 9; rd += 1) {
      entries[rd] = {
        close: rd === 9 ? closeAt9 : rd === 1 ? pullbackClose : 10,
        high,
        open: 10,
        low: 9,
      };
    }
    return makeBars(entries);
  }

  it("支撑破位优先于其它一切", () => {
    const rejection = derivePrimaryRejection({
      spec: GROUP_A,
      observationRows: rows({ 3: { supportBreached: true } }),
      bars: barsFor(9, 11, 10.5),
      rd0Close: 10,
    });
    expect(rejection.code).toBe("SUPPORT_BREACHED");
    expect(rejection.evaluatedConfirmRd).toBe(9);
  });

  it("不可评估观察日 ⇒ SUPPORT_PATH_INCOMPLETE", () => {
    const rejection = derivePrimaryRejection({
      spec: GROUP_A,
      observationRows: rows({ 5: { score: null, missingReason: "BAR_SUSPENDED", supportBreached: null } }),
      bars: barsFor(9, 11, 10.5),
      rd0Close: 10,
    });
    expect(rejection.code).toBe("SUPPORT_PATH_INCOMPLETE");
  });

  it("从未回撤 ⇒ NO_PULLBACK_YET（S3）", () => {
    const rejection = derivePrimaryRejection({
      spec: GROUP_A,
      observationRows: rows({}),
      bars: barsFor(10.5, 11, 10.5),
      rd0Close: 10,
    });
    expect(rejection.layer).toBe("pullback");
    expect(rejection.code).toBe("NO_PULLBACK_YET");
  });

  it("N 日观察分不足 ⇒ PREV_TWO_DAY_SCORE_INSUFFICIENT（S2）", () => {
    const rejection = derivePrimaryRejection({
      spec: GROUP_A,
      observationRows: rows({ 8: { score: 2 } }),
      bars: barsFor(9, 11, 10.5),
      rd0Close: 10,
    });
    expect(rejection.layer).toBe("score");
    expect(rejection.code).toBe("PREV_TWO_DAY_SCORE_INSUFFICIENT");
  });

  it("未突破前两日高点 ⇒ NO_CLOSE_BREAKOUT（S3）", () => {
    const rejection = derivePrimaryRejection({
      spec: GROUP_A,
      observationRows: rows({}),
      bars: barsFor(9, 10, 11),
      rd0Close: 10.5,
    });
    expect(rejection.layer).toBe("breakout");
    expect(rejection.code).toBe("NO_CLOSE_BREAKOUT");
  });
});

// ---------------------------------------------------------------------------
// 4) 8 桶：可达性 + 首次命中即止
// ---------------------------------------------------------------------------

describe("8 桶漏斗（互斥；1→8 首次命中即止）", () => {
  it("8 个桶全部可达，且聚合结果恒为 8 行、顺序即优先级", () => {
    const results = [
      // S1：可入场日之前已破位
      classifyOpportunity(
        classificationInput({
          actionableConfirmRd: 7,
          observationRows: [observationRow(3, { supportBreached: true })],
        }),
      ),
      // S2：从未触发 + 观察分不足
      classifyOpportunity(
        classificationInput({
          triggerDays: [],
          actionableRow: null,
          rejection: {
            layer: "score",
            code: "PREV_TWO_DAY_SCORE_INSUFFICIENT",
            evaluatedConfirmRd: 9,
            note: "",
          } satisfies PrimaryRejection,
        }),
      ),
      // S3：从未触发 + 其它层
      classifyOpportunity(
        classificationInput({
          triggerDays: [],
          actionableRow: null,
          rejection: { layer: "pullback", code: "NO_PULLBACK_YET", evaluatedConfirmRd: 9, note: "" },
        }),
      ),
      // S4：可入场日不在候选池里
      classifyOpportunity(classificationInput({ actionableConfirmRd: 7, actionableRow: null, rank: 1 })),
      // S5：触发过但排名在 TopK 之外
      classifyOpportunity(classificationInput({ actionableConfirmRd: 9, rank: 5 })),
      // S6：进过 TopK 但账户买不到
      classifyOpportunity(
        classificationInput({
          actionableConfirmRd: 9,
          rank: 1,
          failedAttempts: [failedAttempt()],
        }),
      ),
      // S7：买过但提前退出
      classifyOpportunity(
        classificationInput({ actionableConfirmRd: 9, rank: 1, trades: [tradeRow({ returnPct: 6 })] }),
      ),
      // X：抓住
      classifyOpportunity(
        classificationInput({ actionableConfirmRd: 9, rank: 1, trades: [tradeRow({ returnPct: 25 })] }),
      ),
    ];
    expect(results.map((item) => item.bucket)).toEqual([...BUCKET_IDS]);
    const funnel = aggregateFunnel(results);
    expect(funnel.total).toBe(8);
    expect(funnel.rows.map((row) => row.count)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(funnel.rows.map((row) => row.share)).toEqual(new Array(8).fill(0.125));
    expect(Object.keys(funnel.s6SubCounts)).toEqual([...S6_SUB_BUCKET_IDS]);
    expect(funnel.s6SubCounts.S6c_REENTRY_BLOCKED).toBe(1);
  });

  it("S1 压过后续所有层：既在 TopK、又能被 E 政策阻断、也无成交 ⇒ 仍是 S1", () => {
    const result = classifyOpportunity(
      classificationInput({
        group: "E",
        actionableConfirmRd: 9,
        rank: 1,
        observationRows: [observationRow(2, { supportBreached: true })],
        failedAttempts: [failedAttempt({ skipCode: "MEMBER_ENTRY_LIMIT_REACHED" })],
      }),
    );
    expect(result.bucket).toBe("S1_SUPPORT_INVALIDATED");
    expect(result.s6SubBucket).toBeNull();
  });

  it("S2/S3 压过 S4/S5：从未触发时按拒绝原因分流，不再看排序", () => {
    const score = classifyOpportunity(
      classificationInput({
        triggerDays: [],
        actionableRow: null,
        rejection: { layer: "score", code: "N_DAY_SCORE_UNASSESSABLE", evaluatedConfirmRd: 9, note: "" },
      }),
    );
    const other = classifyOpportunity(
      classificationInput({
        triggerDays: [],
        actionableRow: null,
        rejection: { layer: "breakout", code: "NO_CLOSE_BREAKOUT", evaluatedConfirmRd: 9, note: "" },
      }),
    );
    expect(score.bucket).toBe("S2_SCORE_INSUFFICIENT");
    expect(other.bucket).toBe("S3_NO_OTHER_TRIGGER");
  });

  it("S4 压过 S5/S6：可入场日没有候选行时，即便别的触发日进了 TopK 也算不可排序", () => {
    const result = classifyOpportunity(
      classificationInput({ actionableConfirmRd: 7, actionableRow: null, rank: 1, trades: [] }),
    );
    expect(result.bucket).toBe("S4_NOT_RANKABLE");
    expect(result.subReason).toBe("ACTIONABLE_DAY_NOT_IN_CANDIDATE_POOL");
  });

  it("S6 压过 S7：无成交时按首次阻断原因细分；有成交则不再进 S6", () => {
    const blocked = classifyOpportunity(
      classificationInput({
        actionableConfirmRd: 9,
        rank: 1,
        failedAttempts: [
          failedAttempt({ attemptedConfirmDate: "2025-03-09", skipCode: "MAX_DAILY_BUYS_REACHED" }),
          failedAttempt({ attemptedConfirmDate: "2025-03-08", skipCode: "MAX_POSITIONS_REACHED" }),
        ],
      }),
    );
    expect(blocked.bucket).toBe("S6_ACCOUNT_UNABLE_TO_BUY");
    // 最早一次尝试（03-08）是持仓上限 ⇒ S6a；后一次的单日买入上限归 S6e_OTHER（映射见 types.ts）。
    expect(blocked.s6SubBucket).toBe("S6a_CAPACITY");
    expect(blocked.subReason).toBe("MAX_POSITIONS_REACHED");

    const residual = classifyOpportunity(classificationInput({ actionableConfirmRd: 9, rank: 1 }));
    expect(residual.s6SubBucket).toBe("S6d_NO_FILL");
    expect(residual.subReason).toBe("NO_SKIP_RECORD");

    const traded = classifyOpportunity(
      classificationInput({
        actionableConfirmRd: 9,
        rank: 1,
        trades: [tradeRow({ returnPct: 3 })],
        failedAttempts: [failedAttempt()],
      }),
    );
    expect(traded.bucket).toBe("S7_BOUGHT_EXITED_EARLY");
  });

  it("X_CAPTURED 用「最好的一笔」判定：多笔中有一笔 ≥+20% 即为抓住", () => {
    const result = classifyOpportunity(
      classificationInput({
        actionableConfirmRd: 9,
        rank: 1,
        trades: [tradeRow({ returnPct: -8 }), tradeRow({ returnPct: 20 })],
      }),
    );
    expect(result.bucket).toBe("X_CAPTURED");
  });
});

// ---------------------------------------------------------------------------
// 5) S1 ↔ S6c 分离与交叉表（规格 §5）
// ---------------------------------------------------------------------------

describe("S1 与 S6c 必须分开统计（规格 §5）", () => {
  const s1 = classifyOpportunity(
    classificationInput({
      group: "E",
      actionableConfirmRd: 9,
      rank: 1,
      observationRows: [observationRow(4, { supportBreached: true })],
      trades: [tradeRow({ returnPct: -3 })],
      failedAttempts: [failedAttempt({ priorActualExitDate: "2025-03-20" })],
    }),
  );
  const s6c = classifyOpportunity(
    classificationInput({
      group: "E",
      actionableConfirmRd: 9,
      rank: 1,
      observationRows: [observationRow(1), observationRow(2)],
      failedAttempts: [failedAttempt({ priorActualExitDate: "2025-03-20" })],
    }),
  );

  it("同一机会不会同时落入 S1 与 S6c（互斥 + 优先级）", () => {
    expect(s1.bucket).toBe("S1_SUPPORT_INVALIDATED");
    expect(s6c.bucket).toBe("S6_ACCOUNT_UNABLE_TO_BUY");
    expect(s6c.s6SubBucket).toBe("S6c_REENTRY_BLOCKED");
    expect(s1.bucket).not.toBe(s6c.bucket);
  });

  it("交叉表把「两个原因并存」的机会单列，不并入任一桶", () => {
    const crossTab = coOccurrenceOf([
      { bucket: s1.bucket, s6SubBucket: s1.s6SubBucket, hasTrades: true, hasPriorActualExit: true },
      { bucket: s6c.bucket, s6SubBucket: s6c.s6SubBucket, hasTrades: false, hasPriorActualExit: true },
    ]);
    expect(crossTab.s1Count).toBe(1);
    expect(crossTab.s1WithTrades).toBe(1);
    expect(crossTab.s1WithPriorExit).toBe(1);
    expect(crossTab.s1WithPriorExitOrTrades).toBe(1);
    expect(crossTab.s6cCount).toBe(1);
    expect(crossTab.s6cWithPriorExit).toBe(1);
    expect(crossTab.note).toContain("SINGLE_ENTRY");
  });

  it("A–D 组结构上不可能出现 S6c（只有 E 组会映射到该子桶）", () => {
    const aToD = classifyOpportunity(
      classificationInput({
        group: "D",
        actionableConfirmRd: 9,
        rank: 1,
        failedAttempts: [
          failedAttempt({ skipCode: "MAX_POSITIONS_REACHED" }),
          failedAttempt({ skipCode: "MAX_DAILY_BUYS_REACHED" }),
        ],
      }),
    );
    expect(aToD.s6SubBucket).not.toBe("S6c_REENTRY_BLOCKED");
  });
});

// ---------------------------------------------------------------------------
// 6) S7「让出多少」与退出原因分组（规格 §6.3）
// ---------------------------------------------------------------------------

describe("S7 让出量化（规格 §6.3）", () => {
  const firstSpec = GROUP_E;
  void firstSpec;

  it("退出原因自由文本 → 冻结分组（strongHold 先于时间退出判定）", () => {
    expect(exitReasonBucketOf("止损（轨10.5，约6.00%）")).toBe("止损");
    expect(exitReasonBucketOf("MA趋势止盈（峰值收益5.77%，收盘3.6 < MA5 3.678）")).toBe("MA_CROSS");
    expect(exitReasonBucketOf("持有满5个交易日")).toBe("时间退出");
    expect(exitReasonBucketOf("强势续持后持有满10个交易日")).toBe("strongHold");
    expect(exitReasonBucketOf("期末 MTM 收尾")).toBe("期末");
    expect(exitReasonBucketOf("")).toBe("其他");
  });

  it("逐笔让出额 = 自实际入场起 20 日最大收盘涨幅 − 已实现收益", () => {
    const bars = flatWindowBars({ confirmRd: 9, entryOpen: 10, maxClose: 16 });
    const barsByAnchor = new Map([[ANCHOR, bars]]);
    const trades = [
      tradeRow({ entryTime: "2025-03-10", entryPrice: 10, returnPct: 5, reason: "止损（轨10.5，约6.00%）" }),
      tradeRow({ entryTime: "2025-03-10", entryPrice: 10, returnPct: -2, reason: "止损（轨9.8，约-2.00%）" }),
      tradeRow({ entryTime: "2025-03-10", entryPrice: 10, returnPct: 12, reason: "持有满5个交易日" }),
    ];
    const rows = tradeForwardRows({ group: "E", trades, barsByAnchor });
    expect(rows).toHaveLength(3);
    expect(rows[0]?.entryRd).toBe(10);
    expect(rows[0]?.maxForwardFromEntryPct).toBeCloseTo(60, 6);
    expect(rows[0]?.giveUpPct).toBeCloseTo(55, 6);
    const summary = summarizeGiveUp(rows);
    expect(summary.tradeCount).toBe(3);
    expect(summary.evaluableCount).toBe(3);
    // 让出额 = [55, 62, 48] ⇒ 合计 165 / 中位 55。
    expect(summary.totalGiveUpPct).toBeCloseTo(165, 6);
    expect(summary.medianGiveUpPct).toBeCloseTo(55, 6);
    expect(summary.byExitReason.map((item) => item.exitReasonBucket)).toEqual(["止损", "时间退出"]);
    expect(summary.byExitReason[0]?.tradeCount).toBe(2);
    expect(summary.byExitReason[0]?.totalGiveUpPct).toBeCloseTo(117, 6);
    expect(summary.byExitReason[1]?.totalGiveUpPct).toBeCloseTo(48, 6);
  });

  it("入场日不在行情里 ⇒ 让出额不可评估（不猜、不插值）", () => {
    const bars = flatWindowBars({ confirmRd: 9, entryOpen: 10, maxClose: 16 });
    const rows = tradeForwardRows({
      group: "E",
      trades: [tradeRow({ entryTime: "2099-01-01" })],
      barsByAnchor: new Map([[ANCHOR, bars]]),
    });
    expect(rows[0]?.entryRd).toBeNull();
    expect(rows[0]?.giveUpPct).toBeNull();
    expect(summarizeGiveUp(rows).evaluableCount).toBe(0);
    expect(summarizeGiveUp(rows).totalGiveUpPct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7) CSV 解析（引号感知；全角逗号不得错列）
// ---------------------------------------------------------------------------

describe("CSV 解析 / 序列化（引号感知，绝不 split(\",\")）", () => {
  it("引号字段内的逗号（含全角）、转义引号与 CRLF 都被正确处理", () => {
    const text =
      'a,b,c\r\n'
      + '1,"止损（轨8.188，约-4.12%）","含""引号""与, 半角逗号"\r\n'
      + '2,持有满5个交易日,\r\n';
    const rows = parseCsvTable(text, "synthetic.csv");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.b).toBe("止损（轨8.188，约-4.12%）");
    expect(rows[0]?.c).toBe('含"引号"与, 半角逗号');
    expect(rows[1]?.c).toBe("");
  });

  it("列数不等于表头时**抛错**（拒绝静默错位）", () => {
    expect(() => parseCsvTable("a,b\n1,2,3\n", "bad.csv")).toThrow(/列数/);
  });

  it("数字 / 布尔解析：空串 → null，非数字 → 抛错", () => {
    expect(numberOrNull("", "x")).toBeNull();
    expect(numberOrNull("1.5", "x")).toBe(1.5);
    expect(() => numberOrNull("abc", "x")).toThrow(/期望数字/);
    expect(booleanOrNull("true", "x")).toBe(true);
    expect(booleanOrNull("", "x")).toBeNull();
    expect(() => booleanOrNull("yes", "x")).toThrow(/期望 true\/false/);
  });

  it("序列化对含逗号 / 引号 / 换行的字段加引号并转义（LF 行尾）", () => {
    const text = toCsvText(["a", "b"], [{ a: 'x,"y"', b: null }]);
    expect(text).toBe('a,b\n"x,""y""",\n');
  });

  it("描述统计：中位 / 均值 / 分位，并如实报告缺失数", () => {
    const stats = describeStats([1, 2, 3, 4, null]);
    expect(stats.count).toBe(4);
    expect(stats.missing).toBe(1);
    expect(stats.median).toBeCloseTo(2.5, 10);
    expect(stats.mean).toBeCloseTo(2.5, 10);
    expect(stats.p25).toBeCloseTo(1.75, 10);
    expect(stats.p75).toBeCloseTo(3.25, 10);
    expect(describeStats([]).median).toBeNull();
  });
});
