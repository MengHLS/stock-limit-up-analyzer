/**
 * `SORT-PARITY-008` §4.3 —— **接线回归**（不只是排序函数的单元测试）。
 *
 * ## 这些测试防的是什么
 *
 * 007 的缺陷能存活，是因为既有单测只验证 `sortCandidates` 的**返回值**正确，
 * 却**没有**验证 `run → 当日选择 → 计划 → 撮合` 这条线真的用了它。
 * 因此本文件刻意走**实验自己的**函数：
 *
 * | 环节 | 真实实现（本文件直接调用，不另写一套） |
 * |---|---|
 * | 当日排序 + Top3 | `selectDailyTopByFactor`（消费 `sortCandidates` 的返回值） |
 * | 候选是否参与排序 | `candidateExclusionReasonOf` |
 * | 计划构造（真实计划顺序） | `intentsOf` |
 * | 候选排名诊断 | `candidateRankingDiagnosticsRowsOf` |
 * | 撮合 | `runTradeSimulation`（真实引擎，非测试替身） |
 *
 * 🔴 本文件**不**断言 R 的收益 / 指纹（修复后预期变化，见目标 §4.3 末段）；
 *    只断言「决策 → 计划 → 实际成交」的可核实一致性（越界成交必须为 0）。
 */

import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../server/engine/domain";
import type { ResearchDataset } from "../../../server/researchDataset/types";
import { evaluateCandidateRun } from "../../../server/research/signalEngine/evaluate";
import { computeCandidateEvaluationRunFingerprint } from "../../../server/research/signalEngine/serialize";
import type {
  CandidateDayRecord,
  CandidateEvaluationRun,
  PositionIntent,
  SelectedCandidate,
} from "../../../server/research/signalEngine/types";
import { runTradeSimulation } from "../../../server/research/simulator/engine";
import type { SimulationConfig, TradeSimulationRun } from "../../../server/research/simulator/types";
import {
  sealRollingPoolExecutionDataset,
  type RollingPoolExecutionRowInput,
} from "../../../server/researchExperiments/rollingPoolExecutionSupport";
import { pickUniformRandomSubset } from "../../../research-experiments/shared/singleFactor/rightTailMetrics";
import {
  decideKnownStOnlyEligibility,
  decideStrictEligibility,
  type KnownStLabelIndexPort,
  type KnownStLabelObservation,
  type StEligibilityDecision,
} from "../../../research-experiments/shared/rollingPoolRecovery";
import { DAILY_TOP_K } from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/result";
import {
  candidateExclusionReasonOf,
  candidateRankingDiagnosticsRowsOf,
  intentsOf,
  selectDailyTopByFactor,
  sortCandidates,
  type AccountIntent,
  type CandidateRow,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment";

// ---------------------------------------------------------------------------
// 候选夹具（真实 `CandidateRow` 形状；只有排序/资格相关字段参与断言）
// ---------------------------------------------------------------------------

const D0 = "2024-03-01";
const D1 = "2024-03-04";

/** 参与排序的确认日判决（NORMAL / UNKNOWN 可参与；ST 不参与）。 */
function participationDecision(participatesInRanking: boolean): StEligibilityDecision {
  return decideStrictEligibility({
    outcome: participatesInRanking ? "NORMAL" : "ST",
    reason: participatesInRanking ? "TEST_NORMAL" : "TEST_KNOWN_ST",
    observation: null,
  });
}

function candidate(args: {
  readonly symbol: string;
  readonly preReturn10: number;
  readonly date?: string;
  readonly confirmRd?: number;
  readonly eventIdSuffix?: string;
  readonly participatesInRanking?: boolean;
  readonly securityId?: string;
}): CandidateRow {
  const date = args.date ?? D0;
  const confirmRd = args.confirmRd ?? 7;
  return {
    date,
    anchorEventId: `${args.symbol}@2024-02-20${args.eventIdSuffix ?? ""}`,
    symbol: args.symbol,
    securityId: args.securityId ?? `sec_${args.symbol}`,
    eventAge: confirmRd,
    confirmRd,
    fillRd: confirmRd + 1,
    fillDate: D1,
    preReturn10: args.preReturn10,
    branch: "ORIGINAL",
    repairEpisodeId: null,
    localLowRd: null,
    repairWindowScore: null,
    confirmCloseBuyEligibility: (args.participatesInRanking ?? true) ? "NORMAL" : "ST_BLOCKED",
    confirmCloseStatusFact: null,
    confirmCloseStEligibility: participationDecision(args.participatesInRanking ?? true),
  };
}

/** 代码升序一份、因子降序相反的 5 个候选（第 1 名代码最低、因子最差）。 */
function conflictingPool(): readonly CandidateRow[] {
  return [
    candidate({ symbol: "000001.SZ", preReturn10: 0.1 }),   // 代码第 1、因子第 5
    candidate({ symbol: "000002.SZ", preReturn10: 0.2 }),   // 代码第 2、因子第 4
    candidate({ symbol: "000003.SZ", preReturn10: 9.0 }),   // 代码第 3、因子第 3
    candidate({ symbol: "000004.SZ", preReturn10: 10.0 }),  // 代码第 4、因子第 2
    candidate({ symbol: "000005.SZ", preReturn10: 11.0 }),  // 代码第 5、因子第 1
  ];
}

function planOf(
  rows: readonly CandidateRow[],
  pick: (cells: readonly CandidateRow[]) => readonly CandidateRow[],
): ReadonlyMap<string, readonly AccountIntent[]> {
  const byDate = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  return intentsOf(byDate, [...byDate.keys()].sort(), pick);
}

const rPick = (cells: readonly CandidateRow[]): readonly CandidateRow[] =>
  selectDailyTopByFactor(cells, DAILY_TOP_K).selected;

function symbolsOf(intents: readonly AccountIntent[]): string[] {
  return intents.map((intent) => intent.anchorEventId.split("@")[0]!);
}

// ---------------------------------------------------------------------------
// 1) 代码顺序与因子顺序冲突 ⇒ R 计划必须选因子前三名
// ---------------------------------------------------------------------------

describe("1) 同日 ≥5 信号、代码顺序与因子顺序冲突 ⇒ R 计划 = 因子 Top3（§4.3-1）", () => {
  it("低代码低因子候选不得挤入；因子前三 = 000005 / 000004 / 000003", () => {
    const cells = conflictingPool();
    const selection = selectDailyTopByFactor(cells, DAILY_TOP_K);
    expect(selection.ranking.map((row) => row.symbol))
      .toEqual(["000005.SZ", "000004.SZ", "000003.SZ", "000002.SZ", "000001.SZ"]);
    expect(selection.selected.map((row) => row.symbol)).toEqual(["000005.SZ", "000004.SZ", "000003.SZ"]);
    expect(selection.selected.map((row) => row.symbol)).not.toContain("000001.SZ");
    expect(selection.selected.map((row) => row.symbol)).not.toContain("000002.SZ");
    /** 旧缺陷行为（代码顺序前 3）= 000001/000002/000003 ⇒ 必须**不**等于本结果。 */
    const codeOrderTop3 = [...cells]
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
      .slice(0, DAILY_TOP_K)
      .map((row) => row.symbol);
    expect(selection.selected.map((row) => row.symbol)).not.toEqual(codeOrderTop3);
  });

  it("真实计划（intentsOf）逐项等于因子名次，rank = 计划顺序", () => {
    const cells = conflictingPool();
    const plan = planOf(cells, rPick).get(D0)!;
    expect(symbolsOf(plan)).toEqual(["000005.SZ", "000004.SZ", "000003.SZ"]);
    expect(plan.map((intent) => intent.rank)).toEqual([1, 2, 3]);
    expect(plan.map((intent) => intent.signalValue)).toEqual([11, 10, 9]);
  });
});

// ---------------------------------------------------------------------------
// 2) 两个相反的输入顺序 ⇒ 计划相同；并列按 symbol → eventId 破平
// ---------------------------------------------------------------------------

describe("2) 输入顺序无关 + 确定性破平（§4.3-2）", () => {
  it("正序 / 逆序输入给出**逐项相同**的 R 计划", () => {
    const forward = conflictingPool();
    const backward = [...forward].reverse();
    const planForward = planOf(forward, rPick).get(D0)!;
    const planBackward = planOf(backward, rPick).get(D0)!;
    expect(planBackward).toEqual(planForward);
  });

  it("相同 preReturn10 按 symbol 升序；同 symbol 再按 eventId 升序", () => {
    const tied: readonly CandidateRow[] = [
      candidate({ symbol: "000009.SZ", preReturn10: 5 }),
      candidate({ symbol: "000003.SZ", preReturn10: 5 }),
      candidate({ symbol: "000003.SZ", preReturn10: 5, eventIdSuffix: "-b" }),
      candidate({ symbol: "000001.SZ", preReturn10: 5, eventIdSuffix: "-b" }),
      candidate({ symbol: "000001.SZ", preReturn10: 5 }),
    ];
    expect(sortCandidates(tied).map((row) => row.anchorEventId)).toEqual([
      "000001.SZ@2024-02-20",
      "000001.SZ@2024-02-20-b",
      "000003.SZ@2024-02-20",
      "000003.SZ@2024-02-20-b",
      "000009.SZ@2024-02-20",
    ]);
  });

  it("并列破平与输入顺序无关（逆序输入给出同一全序）", () => {
    const tied: readonly CandidateRow[] = [
      candidate({ symbol: "000009.SZ", preReturn10: 5 }),
      candidate({ symbol: "000003.SZ", preReturn10: 5, eventIdSuffix: "-b" }),
      candidate({ symbol: "000003.SZ", preReturn10: 5 }),
    ];
    expect(sortCandidates([...tied].reverse())).toEqual(sortCandidates(tied));
  });
});

// ---------------------------------------------------------------------------
// 3) 排除确认日已知 ST 后，剩余候选正确排序；UNKNOWN 按政策参与 / 严格拒绝
// ---------------------------------------------------------------------------

/** 只声明「哪些 symbol 在确认日是已知 ST」的最小标签索引（其余 → UNKNOWN）。 */
function indexWithKnownSt(stSymbols: readonly string[]): KnownStLabelIndexPort {
  const lookup = (input: { readonly symbol: string; readonly checkDate: string }): KnownStLabelObservation => {
    if (stSymbols.includes(input.symbol)) {
      return {
        symbol: input.symbol,
        checkDate: input.checkDate,
        kind: "KNOWN_ST",
        reason: "KNOWN_ST_INTERVAL_COVERS_CHECK_DATE",
        securityId: `sec_${input.symbol}`,
        fact: {
          statusValue: "ST",
          effectiveFrom: "2024-01-01",
          effectiveTo: null,
          source: "TEST_SORT_PARITY_INDEX",
          confidence: "medium",
          availability: "UNKNOWN",
          retrievedAt: null,
          evidenceFingerprint: `test:${input.symbol}:ST`,
        },
      };
    }
    return {
      symbol: input.symbol,
      checkDate: input.checkDate,
      kind: "UNKNOWN",
      reason: "NO_STATUS_FACT",
      securityId: `sec_${input.symbol}`,
      fact: null,
    };
  };
  return {
    sourceId: "TEST_SORT_PARITY_INDEX",
    sourceFingerprint: "test-sort-parity-index",
    rowCount: stSymbols.length,
    securityCount: stSymbols.length,
    identifierRowCount: 0,
    availabilityCounts: { UNKNOWN: stSymbols.length },
    confidenceCounts: { medium: stSymbols.length },
    explicitNormalRowCount: 0,
    tablesRead: ["TEST_SORT_PARITY_INDEX"],
    lookup,
  };
}

describe("3) 已知 ST 排除后仍正确排序；UNKNOWN 参与 / 严格拒绝（§4.3-3）", () => {
  it("已知 ST 被排除后**不占名次、也不递补第 4 名**：剩余 4 个按因子排序取前三", () => {
    const index = indexWithKnownSt(["000005.SZ"]);
    const raw = conflictingPool();
    /** 真实政策判决（轻量模式）。 */
    const judged = raw.map((row) => ({
      row,
      decision: decideKnownStOnlyEligibility({ index, symbol: row.symbol, checkDate: row.date }),
    }));
    const participants = judged
      .filter((item) => candidateExclusionReasonOf({
        identityResolved: true,
        policyParticipatesInRanking: item.decision.participatesInRanking,
      }) === null)
      .map((item) => item.row);
    const excluded = judged
      .filter((item) => item.decision.participatesInRanking === false)
      .map((item) => item.row.symbol);
    expect(excluded).toEqual(["000005.SZ"]);
    /** 原因子第 1 名被排除 ⇒ 剩余按因子排序：000004 / 000003 / 000002（000001 仍不入围）。 */
    const selection = selectDailyTopByFactor(participants, DAILY_TOP_K);
    expect(selection.selected.map((row) => row.symbol)).toEqual(["000004.SZ", "000003.SZ", "000002.SZ"]);
  });

  it("UNKNOWN 在轻量政策下参与排序；严格政策下拒绝参与", () => {
    const index = indexWithKnownSt([]);
    const unknown = candidate({ symbol: "000007.SZ", preReturn10: 7 });
    const light = decideKnownStOnlyEligibility({ index, symbol: unknown.symbol, checkDate: unknown.date });
    const strict = decideStrictEligibility({ outcome: "UNKNOWN", reason: "NO_STATUS_FACT", observation: null });
    expect(light.status).toBe("UNKNOWN");
    expect(light.participatesInRanking).toBe(true);
    expect(strict.status).toBe("UNKNOWN");
    expect(strict.participatesInRanking).toBe(false);
    expect(candidateExclusionReasonOf({ identityResolved: true, policyParticipatesInRanking: light.participatesInRanking })).toBeNull();
    expect(
      candidateExclusionReasonOf({ identityResolved: true, policyParticipatesInRanking: strict.participatesInRanking }),
    ).toBe("ST_POLICY_NOT_PARTICIPATING");
  });

  it("身份不可解析 ⇒ 明确记为未参与排序（不与参与名次混同）", () => {
    expect(candidateExclusionReasonOf({ identityResolved: false, policyParticipatesInRanking: true }))
      .toBe("IDENTITY_UNRESOLVED");
  });
});

// ---------------------------------------------------------------------------
// 4) 候选排名 / selectedByR / 计划集合逐项相等（≥4 候选，走真实计划与诊断构造）
// ---------------------------------------------------------------------------

describe("4) 排名诊断 ↔ selectedByR ↔ 计划集合逐项相等（§4.3-4）", () => {
  it("≥4 候选：selectedByR ⇔ rPlanOrder 存在；计划集合与诊断入选集合相同", () => {
    const cells = conflictingPool();
    const selection = selectDailyTopByFactor(cells, DAILY_TOP_K);
    const rSelectionByDate = new Map([[D0, selection]]);
    const plan = planOf(cells, rPick).get(D0)!;
    const rows = candidateRankingDiagnosticsRowsOf({
      groupId: "A_STRICT_20",
      signalRows: cells,
      resolvedRows: cells,
      rSelectionByDate,
      candidateGates: new Map(),
      rFillByKey: new Map(),
      rSkipByKey: new Map(),
    });
    expect(rows).toHaveLength(cells.length);
    // ① 每行：selectedByR ⇔ rPlanOrder 有值；且 rPlanOrder = 计划里的 rank
    for (const row of rows) {
      const selected = row.selectedByR as boolean;
      const planOrder = row.rPlanOrder as number | "";
      expect(selected).toBe(planOrder !== "");
      const intent = plan.find((item) => item.anchorEventId === row.anchorEventId);
      if (selected) {
        expect(intent).toBeDefined();
        expect(intent!.rank).toBe(planOrder);
      } else {
        expect(intent).toBeUndefined();
      }
    }
    // ② 集合相等
    const diagnosticSelected = rows.filter((row) => row.selectedByR === true)
      .map((row) => row.anchorEventId).sort();
    const plannedAnchors = plan.map((intent) => intent.anchorEventId).sort();
    expect(diagnosticSelected).toEqual(plannedAnchors);
    // ③ 名次来自同一个 ranking，且参与者都有名次
    for (const row of rows) {
      expect(row.participatesInRanking).toBe(true);
      expect(row.participantCountThatDay).toBe(cells.length);
      expect(row.poolSizeThatDay).toBe(cells.length);
      const rank = row.rankByPreReturn10 as number;
      expect(selection.ranking[rank - 1]!.anchorEventId).toBe(row.anchorEventId);
    }
    // ④ 未参与者名次留空：已知 ST（身份可解析）与身份不可解析各一例
    const knownSt = candidate({ symbol: "000001.SZ", preReturn10: 1, participatesInRanking: false });
    const participating = candidate({ symbol: "000002.SZ", preReturn10: 2 });
    const unresolved = candidate({ symbol: "000009.SZ", preReturn10: 3 });
    const excludedRows = candidateRankingDiagnosticsRowsOf({
      groupId: "B_RECOVERY_20",
      signalRows: [knownSt, participating, unresolved],
      /** `unresolved` 刻意**不在**已解析身份集合里。 */
      resolvedRows: [knownSt, participating],
      rSelectionByDate: new Map([[D0, selectDailyTopByFactor([participating], 3)]]),
      candidateGates: new Map(),
      rFillByKey: new Map(),
      rSkipByKey: new Map(),
    });
    const knownStRow = excludedRows.find((row) => row.symbol === "000001.SZ")!;
    expect(knownStRow.identityResolved).toBe(true);
    expect(knownStRow.participatesInRanking).toBe(false);
    expect(knownStRow.exclusionReason).toBe("ST_POLICY_NOT_PARTICIPATING");
    expect(knownStRow.rankByPreReturn10).toBe("");
    expect(knownStRow.selectedByR).toBe(false);
    expect(knownStRow.rPlanOrder).toBe("");
    expect(knownStRow.sortingSource).toBe("未参与排序");
    /** 🔴 原始价格信号账仍保留该行（不删行），但参与候选数只算真正参与的那个。 */
    const unresolvedRow = excludedRows.find((row) => row.symbol === "000009.SZ")!;
    expect(unresolvedRow.identityResolved).toBe(false);
    expect(unresolvedRow.exclusionReason).toBe("IDENTITY_UNRESOLVED");
    expect(unresolvedRow.rankByPreReturn10).toBe("");
    expect(unresolvedRow.selectedByR).toBe(false);
    expect(unresolvedRow.participantCountThatDay).toBe(1);
    expect(unresolvedRow.poolSizeThatDay).toBe(3);
    const participatingRow = excludedRows.find((row) => row.symbol === "000002.SZ")!;
    expect(participatingRow.participatesInRanking).toBe(true);
    expect(participatingRow.rankByPreReturn10).toBe(1);
    expect(participatingRow.selectedByR).toBe(true);
    expect(participatingRow.rPlanOrder).toBe(1);
  });

  it("诊断输出顺序确定性：与输入顺序无关", () => {
    const cells = conflictingPool();
    const build = (rows: readonly CandidateRow[]): Record<string, unknown>[] =>
      candidateRankingDiagnosticsRowsOf({
        groupId: "A_STRICT_20",
        signalRows: rows,
        resolvedRows: rows,
        rSelectionByDate: new Map([[D0, selectDailyTopByFactor(rows, DAILY_TOP_K)]]),
        candidateGates: new Map(),
        rFillByKey: new Map(),
        rSkipByKey: new Map(),
      });
    expect(build([...cells].reverse())).toEqual(build(cells));
  });
});

// ---------------------------------------------------------------------------
// 5) 真实撮合链：成交必须来自当日实际 Top3；容量跳过不递补第 4 名（§4.3-5）
// ---------------------------------------------------------------------------

const COST_ZERO: CostModel = {
  commissionRate: 0,
  stampDutyRate: 0,
  transferFeeRate: 0,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 0,
};

const DATES: readonly string[] = ["2024-03-01", "2024-03-04", "2024-03-05", "2024-03-06"];

const SORT_SECURITIES: readonly { readonly symbol: string; readonly securityId: string }[] = [
  { symbol: "000001.SZ", securityId: "sec_000001::event:000001.SZ@2024-02-20" },
  { symbol: "000002.SZ", securityId: "sec_000002::event:000002.SZ@2024-02-20" },
  { symbol: "000003.SZ", securityId: "sec_000003::event:000003.SZ@2024-02-20" },
  { symbol: "000004.SZ", securityId: "sec_000004::event:000004.SZ@2024-02-20" },
  { symbol: "000005.SZ", securityId: "sec_000005::event:000005.SZ@2024-02-20" },
];

function executionRow(date: string, securityId: string, open: number): RollingPoolExecutionRowInput {
  return {
    tradeDate: date,
    securityId,
    code: `${securityId.slice(4, 10)}.SZ`,
    exchange: "SZ",
    open,
    high: open + 0.3,
    low: open - 0.3,
    close: open + 0.2,
    preClose: open,
    volume: 1_000_000,
    amount: null,
    barPresent: true,
    suspended: false,
  };
}

function sealSortDataset(): ResearchDataset {
  const rows: RollingPoolExecutionRowInput[] = [];
  for (const security of SORT_SECURITIES) {
    DATES.forEach((date, index) => {
      rows.push(executionRow(date, security.securityId, 10 + index));
    });
  }
  return sealRollingPoolExecutionDataset({
    name: "sort-parity-008-matching",
    startDate: DATES[0]!,
    endDate: DATES[DATES.length - 1]!,
    datasetVersionId: 780_004,
    rows,
    tradingDates: [...DATES],
  });
}

/** 用**真实意图**构造 source run（与实验 `buildSourceRun` 同形：保序、rank 取意图 rank）。 */
function sourceRunFromIntents(
  dataset: ResearchDataset,
  intentsByDate: ReadonlyMap<string, readonly AccountIntent[]>,
  universeByDate: ReadonlyMap<string, readonly string[]>,
): CandidateEvaluationRun {
  const dayRecords: CandidateDayRecord[] = DATES.map((date) => {
    const picked = intentsByDate.get(date) ?? [];
    const universe = [...(universeByDate.get(date) ?? [])].sort();
    const selected: SelectedCandidate[] = picked.map((intent) => ({
      securityId: intent.securityId,
      rank: intent.rank,
      percentile: picked.length === 0 ? 0 : 1 - (intent.rank - 1) / picked.length,
      value: intent.signalValue,
    }));
    const positionIntents: PositionIntent[] = picked.map((intent) => ({
      securityId: intent.securityId,
      direction: "long",
      rank: intent.rank,
      percentile: picked.length === 0 ? 0 : 1 - (intent.rank - 1) / picked.length,
      weight: picked.length === 0 ? 0 : 1 / picked.length,
      signalValue: intent.signalValue,
      confidence: null,
    }));
    return { date, universeMembers: universe, signalCount: universe.length, dropped: [], selected, positionIntents };
  });
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: "CANDIDATE_EVALUATION_RUN",
    recordVersion: 1,
    datasetVersion: dataset.datasetVersion,
    builderVersion: "sort-parity-008-matching-1.0.0",
    rowSchemaVersion: "sort-parity-008-matching-1.0.0",
    datasetGate: dataset.gate,
    universeId: `sort-parity-008-matching:${dataset.datasetVersion}`,
    strategyId: "sort-parity-008-matching",
    strategyVersion: "1.0.0",
    parameters: { dailyTopK: DAILY_TOP_K },
    dateRange: { startDate: DATES[0]!, endDate: DATES[DATES.length - 1]! },
    point: "close",
    signalDescription: "sort-parity-008 matching fixture",
    featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
    rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    selectionConfig: { method: { kind: "topN", n: DAILY_TOP_K } },
    days: dayRecords,
    evaluation: evaluateCandidateRun(dayRecords),
  };
  return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
}

function simConfigFixture(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    initialCapital: 100_000,
    cost: COST_ZERO,
    maxPositions: 5,
    maxDailyBuys: 2,
    positionSizing: { sizingMethod: "EQUITY_FRACTION", fraction: 0.2, fixedAmount: null },
    dateRange: { startDate: DATES[0]!, endDate: DATES[DATES.length - 1]! },
    ...overrides,
  };
}

/** 从事件作用域身份里取 symbol（`<base>::event:<symbol>@<date>`）。 */
function symbolOfSecurityId(securityId: string): string {
  const match = /event:([^@]+)@/u.exec(securityId);
  return match?.[1] ?? securityId;
}

function fillSymbolsOf(run: TradeSimulationRun): string[] {
  return run.trades.map((trade) => symbolOfSecurityId(trade.securityId));
}

describe("5) 真实撮合链：成交 ⊆ 当日实际 Top3；容量跳过不递补第 4 名（§4.3-5）", () => {
  const cells = conflictingPool();
  const selection = selectDailyTopByFactor(cells, DAILY_TOP_K);
  const top3Symbols = selection.selected.map((row) => row.symbol);
  /** 真实身份（与 `conflictingPool` 的 symbol 对齐）。 */
  const identityBySymbol = new Map(SORT_SECURITIES.map((item) => [item.symbol, item.securityId]));
  const cellsWithIdentity: readonly CandidateRow[] = cells.map((row) => ({
    ...row,
    securityId: identityBySymbol.get(row.symbol)!,
  }));
  const plan = planOf(cellsWithIdentity, rPick).get(D0)!;
  const universe = cellsWithIdentity.map((row) => row.securityId);

  it("每日最多 2 次买入 ⇒ 成交恰好是因子第 1 / 第 2 名（不是代码前两名）", () => {
    const dataset = sealSortDataset();
    const sourceRun = sourceRunFromIntents(
      dataset,
      new Map([[D0, plan]]),
      new Map([[D0, universe]]),
    );
    const run = runTradeSimulation({ dataset, sourceRun, simConfig: simConfigFixture() });
    const filled = [...new Set(fillSymbolsOf(run))];
    expect(filled).toEqual([top3Symbols[0], top3Symbols[1]]);
    /** 代码顺序前两名（000001 / 000002）**不得**成交。 */
    expect(filled).not.toContain("000001.SZ");
    expect(filled).not.toContain("000002.SZ");
  });

  it("容量只允许 1 个持仓 ⇒ 只有因子第 1 名成交，第 4/5 名**绝不**递补", () => {
    const dataset = sealSortDataset();
    const sourceRun = sourceRunFromIntents(
      dataset,
      new Map([[D0, plan]]),
      new Map([[D0, universe]]),
    );
    const run = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfigFixture({ maxPositions: 1, maxDailyBuys: 1 }),
    });
    const filled = [...new Set(fillSymbolsOf(run))];
    expect(filled).toEqual([top3Symbols[0]]);
    for (const symbol of ["000001.SZ", "000002.SZ", "000003.SZ", "000004.SZ", "000005.SZ"]) {
      if (top3Symbols.includes(symbol)) continue;
      expect(filled).not.toContain(symbol);
    }
    /** 逐笔可追溯：每一笔成交都对应**当日实际 Top3**（越界成交 0）。 */
    for (const trade of run.trades) {
      expect(top3Symbols).toContain(symbolOfSecurityId(trade.securityId));
    }
  });
});

// ---------------------------------------------------------------------------
// 6) 同池同种子：R 排序修复**不得**改变 Random 抽样（§4.3-7）
// ---------------------------------------------------------------------------

describe("6) R 排序修复不改变 Random 抽样 / 不重排输入（§4.3-7）", () => {
  it("`selectDailyTopByFactor` 不修改输入数组（Random 按输入下标取样）", () => {
    const cells = conflictingPool();
    const before = cells.map((row) => row.anchorEventId);
    selectDailyTopByFactor(cells, DAILY_TOP_K);
    expect(cells.map((row) => row.anchorEventId)).toEqual(before);
  });

  it("同池同种子：调用 R 选择前后，Random 抽样结果逐项相同", () => {
    const cells = conflictingPool();
    const eventIds = cells.map((row) => row.anchorEventId);
    const baseline = pickUniformRandomSubset({ eventIds, topK: DAILY_TOP_K, seedIndex: 20_261_010, date: D0 });
    // 修复路径（会算一次全序），但**不得**改动 cells 顺序。
    const selection = selectDailyTopByFactor(cells, DAILY_TOP_K);
    expect(selection.selected.length).toBeGreaterThan(0);
    const after = pickUniformRandomSubset({
      eventIds: cells.map((row) => row.anchorEventId),
      topK: DAILY_TOP_K,
      seedIndex: 20_261_010,
      date: D0,
    });
    expect(after).toEqual(baseline);
  });

  it("Random 计划逐项相同（同池同种子，即使 R 计划是因子排序）", () => {
    const cells = conflictingPool();
    const seedIndex = 20_261_011;
    const randomPick = (dayCells: readonly CandidateRow[]): readonly CandidateRow[] => {
      const drawn = pickUniformRandomSubset({
        eventIds: dayCells.map((cell) => cell.anchorEventId),
        topK: DAILY_TOP_K,
        seedIndex,
        date: dayCells[0]!.date,
      });
      const byAnchor = new Map(dayCells.map((cell) => [cell.anchorEventId, cell]));
      return drawn.map((eventId) => byAnchor.get(eventId)!).filter((cell) => cell !== undefined);
    };
    const planWithoutFix = planOf(cells, randomPick);
    /** 先跑一次 R 选择（可能带来任何隐藏的重排），再构造 Random 计划。 */
    planOf(cells, rPick);
    const planAfterFix = planOf(cells, randomPick);
    expect(planAfterFix).toEqual(planWithoutFix);
    /** 键顺序也必须一致（Map 逐项相等已覆盖，这里再显式钉一次顺序）。 */
    expect([...planAfterFix.keys()]).toEqual([...planWithoutFix.keys()]);
  });
});

// ---------------------------------------------------------------------------
// 7) 证据连接：**真实的非空 Map**（`SIGNAL-EXIT-009` §A.1 / 008 F1）
// ---------------------------------------------------------------------------

/**
 * 008 的缺陷能存活，是因为既有诊断测试**全部**传空 Map：
 * 空 Map 查什么键都返回 `undefined`，于是「键错了」与「没成交」不可区分。
 * 本节因此按 `#run` 的**真实建键方式**构造非空 Map：
 *   - 成交：`anchorEventId\u0000confirmDate`（`st-fill-audit-#account=R` 的 `confirmDate`）；
 *   - 跳过：`anchorEventId\u0000attemptedConfirmDate`（`anchor-failed-attempts`）。
 * 而 `candidateRankingDiagnosticsRowsOf` 的**身份 / 排序**键仍是相对日
 * `anchorEventId\u0000confirmRd` —— 两个键不可混用。
 */

/** 与 `#run` 一致：按**确认日期**建成交 Map。 */
function rFillMapOf(rows: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) map.set(`${String(row.anchorEventId)}\u0000${String(row.confirmDate)}`, row);
  return map;
}

/** 与 `#run` 一致：按**尝试确认日期**建跳过 Map（同一键只保留首条）。 */
function rSkipMapOf(rows: readonly Record<string, unknown>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = `${String(row.anchorEventId)}\u0000${String(row.attemptedConfirmDate)}`;
    if (!map.has(key)) map.set(key, `${String(row.skipCode)}：${String(row.reason)}`);
  }
  return map;
}

/** 一组「同一锚点、两个确认日」的夹具（测试 §A.1 的多日期不串记录）。 */
const ANCHOR_X = "600179.SH@2025-08-25";
const X_D1_CONFIRM = "2025-09-12";
const X_D1_RD = 12;
const X_D1_FILL = "2025-09-15";
const X_D2_CONFIRM = "2025-09-16";
const X_D2_RD = 16;
const X_D2_FILL = "2025-09-17";

function anchorXOn(confirmDate: string, confirmRd: number, preReturn10: number): CandidateRow {
  return {
    date: confirmDate,
    anchorEventId: ANCHOR_X,
    symbol: "600179.SH",
    securityId: `sec_x::event:${ANCHOR_X}`,
    eventAge: confirmRd,
    confirmRd,
    fillRd: confirmRd + 1,
    fillDate: confirmDate,
    preReturn10,
    branch: "ORIGINAL",
    repairEpisodeId: null,
    localLowRd: null,
    repairWindowScore: null,
    confirmCloseBuyEligibility: "UNKNOWN_BLOCKED",
    confirmCloseStatusFact: null,
    confirmCloseStEligibility: participationDecision(true),
  };
}

describe("7) 非空证据 Map：成交 / 跳过按**确认日期**键对接（§A.1 / 008 F1）", () => {
  const row0 = anchorXOn(X_D1_CONFIRM, X_D1_RD, 3);
  const row1 = anchorXOn(X_D2_CONFIRM, X_D2_RD, 1);

  it("正常成交：`rFillDate` = 真实成交日，证据引用含成交日与确认日坐标", () => {
    const rows = candidateRankingDiagnosticsRowsOf({
      groupId: "A_STRICT_20",
      signalRows: [row0],
      resolvedRows: [row0],
      /**
       * 🔴 身份 / 排序仍按相对日：传入的 `resolvedRows` 用 `confirmRd` 建键，
       *    因此 `securityId` 能解析 ⇒ 证明身份键**没有**被日期键替换掉。
       */
      rSelectionByDate: new Map([[X_D1_CONFIRM, selectDailyTopByFactor([row0], DAILY_TOP_K)]]),
      candidateGates: new Map(),
      rFillByKey: rFillMapOf([
        { anchorEventId: ANCHOR_X, confirmDate: X_D1_CONFIRM, fillDate: X_D1_FILL, branch: "ORIGINAL" },
      ]),
      rSkipByKey: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.securityId).toBe(`sec_x::event:${ANCHOR_X}`);
    expect(rows[0]!.rFillDate).toBe(X_D1_FILL);
    expect(String(rows[0]!.rFillEvidenceRef)).toContain(`fillDate=${X_D1_FILL}`);
    expect(String(rows[0]!.rFillEvidenceRef)).toContain(ANCHOR_X);
    /** 已成交 ⇒ 不再写「未成交原因」。 */
    expect(rows[0]!.rNotFilledReason).toBe("");
    expect(rows[0]!.rNotFilledEvidenceRef).toBe("");
  });

  it("建仓跳过：`rNotFilledReason` = 真实 `skipCode：reason`，证据引用指向尝试确认日", () => {
    const rows = candidateRankingDiagnosticsRowsOf({
      groupId: "A_STRICT_20",
      signalRows: [row0],
      resolvedRows: [row0],
      rSelectionByDate: new Map([[X_D1_CONFIRM, selectDailyTopByFactor([row0], DAILY_TOP_K)]]),
      candidateGates: new Map(),
      rFillByKey: new Map(),
      rSkipByKey: rSkipMapOf([
        {
          anchorEventId: ANCHOR_X,
          attemptedConfirmDate: X_D1_CONFIRM,
          skipCode: "MAX_POSITIONS_REACHED",
          reason: "并发持仓已达上限 5，新候选无空位",
        },
      ]),
    });
    expect(rows[0]!.rFillDate).toBe("");
    expect(rows[0]!.rNotFilledReason).toBe("MAX_POSITIONS_REACHED：并发持仓已达上限 5，新候选无空位");
    expect(String(rows[0]!.rNotFilledEvidenceRef)).toContain(`attemptedConfirmDate=${X_D1_CONFIRM}`);
  });

  it("同一锚点不同确认日**互不串记录**：只有被成交的那一天有证据", () => {
    const rows = candidateRankingDiagnosticsRowsOf({
      groupId: "A_STRICT_20",
      signalRows: [row0, row1],
      resolvedRows: [row0, row1],
      rSelectionByDate: new Map([
        [X_D1_CONFIRM, selectDailyTopByFactor([row0], DAILY_TOP_K)],
        [X_D2_CONFIRM, selectDailyTopByFactor([row1], DAILY_TOP_K)],
      ]),
      candidateGates: new Map(),
      /** 只有第二个确认日成交。 */
      rFillByKey: rFillMapOf([
        { anchorEventId: ANCHOR_X, confirmDate: X_D2_CONFIRM, fillDate: X_D2_FILL, branch: "RECOVERY" },
      ]),
      rSkipByKey: rSkipMapOf([
        {
          anchorEventId: ANCHOR_X,
          attemptedConfirmDate: X_D1_CONFIRM,
          skipCode: "MAX_POSITIONS_REACHED",
          reason: "满仓",
        },
      ]),
    });
    const first = rows.find((row) => row.date === X_D1_CONFIRM)!;
    const second = rows.find((row) => row.date === X_D2_CONFIRM)!;
    /** 相对日不同 ⇒ 两行都在，且各自的身份可解析（身份键仍是相对日）。 */
    expect(rows).toHaveLength(2);
    expect(first.confirmRd).toBe(X_D1_RD);
    expect(second.confirmRd).toBe(X_D2_RD);
    expect(first.rFillDate).toBe("");
    expect(first.rNotFilledReason).toBe("MAX_POSITIONS_REACHED：满仓");
    expect(second.rFillDate).toBe(X_D2_FILL);
    expect(second.rNotFilledReason).toBe("");
    /** 🔴 关键反例：同锚点另一日的成交**不得**被写成本行的成交证据。 */
    expect(String(second.rFillEvidenceRef)).not.toContain(X_D1_CONFIRM);
    expect(String(first.rFillEvidenceRef)).toBe("");
  });

  it("再入场：同一锚点两次成交各自对接自己的确认日记录", () => {
    const rows = candidateRankingDiagnosticsRowsOf({
      groupId: "B_RECOVERY_20",
      signalRows: [row0, row1],
      resolvedRows: [row0, row1],
      rSelectionByDate: new Map([
        [X_D1_CONFIRM, selectDailyTopByFactor([row0], DAILY_TOP_K)],
        [X_D2_CONFIRM, selectDailyTopByFactor([row1], DAILY_TOP_K)],
      ]),
      candidateGates: new Map(),
      rFillByKey: rFillMapOf([
        { anchorEventId: ANCHOR_X, confirmDate: X_D1_CONFIRM, fillDate: X_D1_FILL, branch: "ORIGINAL" },
        { anchorEventId: ANCHOR_X, confirmDate: X_D2_CONFIRM, fillDate: X_D2_FILL, branch: "RECOVERY" },
      ]),
      rSkipByKey: new Map(),
    });
    expect(rows.map((row) => row.rFillDate).sort()).toEqual([X_D1_FILL, X_D2_FILL]);
    /** 两次成交的证据引用**不同**且各含自己的成交日。 */
    const refs = rows.map((row) => String(row.rFillEvidenceRef)).sort();
    expect(new Set(refs).size).toBe(2);
    expect(refs[0]).toContain(X_D1_FILL);
    expect(refs[1]).toContain(X_D2_FILL);
  });

  it("未入选候选不会误领另一日成交证据；相对日键**不再**用于查证据", () => {
    /** 当日 3 个更高因子候选占满 Top3 ⇒ `row1` 参与排序但**未入选**（名次 4/4）。 */
    const stronger: readonly CandidateRow[] = [30, 20, 10].map((value, index) => ({
      ...anchorXOn(X_D2_CONFIRM, X_D2_RD, value),
      anchorEventId: `00000${index + 1}.SZ@2025-08-25`,
      symbol: `00000${index + 1}.SZ`,
      securityId: `sec_${index + 1}::event:00000${index + 1}.SZ@2025-08-25`,
    }));
    const selection = selectDailyTopByFactor([...stronger, row1], DAILY_TOP_K);
    expect(selection.selected).toHaveLength(3);
    expect(selection.selected.map((row) => row.anchorEventId)).not.toContain(ANCHOR_X);
    expect(selection.ranking.findIndex((row) => row.anchorEventId === ANCHOR_X) + 1).toBe(4);
    const rows = candidateRankingDiagnosticsRowsOf({
      groupId: "B_RECOVERY_20",
      signalRows: [row1],
      resolvedRows: [row1],
      rSelectionByDate: new Map([[X_D2_CONFIRM, selection]]),
      candidateGates: new Map(),
      /**
       * 🔴 陷阱：**同一个锚点**在**另一天**（`X_D1_CONFIRM`）有真实成交。
       *    未入选的这一行**不得**领用那一天成交证据。
       */
      rFillByKey: rFillMapOf([
        { anchorEventId: ANCHOR_X, confirmDate: X_D1_CONFIRM, fillDate: X_D1_FILL, branch: "ORIGINAL" },
      ]),
      rSkipByKey: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rankByPreReturn10).toBe(4);
    expect(rows[0]!.selectedByR).toBe(false);
    expect(rows[0]!.rFillDate).toBe("");
    expect(rows[0]!.rFillEvidenceRef).toBe("");
    expect(rows[0]!.rNotFilledReason).toBe("");
    /**
     * 🔴 缺陷回归锁：把**旧实现**用的相对日键 `anchorEventId\u0000confirmRd` 放进 Map，
     *    本函数**必须**读不到它（证据只认确认日期键）。这条断言直接钉住 008 F1 的键口径。
     */
    const staleRelativeDayOnly = candidateRankingDiagnosticsRowsOf({
      groupId: "B_RECOVERY_20",
      signalRows: [row1],
      resolvedRows: [row1],
      rSelectionByDate: new Map([[X_D2_CONFIRM, selection]]),
      candidateGates: new Map(),
      rFillByKey: new Map([
        [`${ANCHOR_X}\u0000${X_D2_RD}`, { anchorEventId: ANCHOR_X, confirmDate: X_D2_CONFIRM, fillDate: X_D2_FILL }],
      ]),
      rSkipByKey: new Map(),
    });
    expect(staleRelativeDayOnly[0]!.rFillDate).toBe("");
    /** 身份 / 排序仍走相对日键：即使证据为空，`securityId` 依然解析出来。 */
    expect(staleRelativeDayOnly[0]!.securityId).toBe(`sec_x::event:${ANCHOR_X}`);
  });
});
