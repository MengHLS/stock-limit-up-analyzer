/**
 * 首个真实迁移策略（龙头候选原始评分 baseline）测试。
 *
 * 覆盖：BUY 信号、数据不足、确定性、实例隔离（A/B/A）、未来数据污染（T1-T3 vs T1-T6）、
 * Legacy 行为对照、Registry + Backtest Core 集成、minScore 阈值、maxSignals 上限。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_COST_MODEL, runBacktest, runBacktestWithRisk, type MarketBar } from "../engine";
import { buildLeaderCandidatesForDate, type LeaderCandidateSourceRecord } from "../leaderCandidates";
import { buildLeaderCandidateDataViewForDate, buildStrategySignalProvider, toCoreSignals } from "./adapter";
import { strategyRegistry } from "./registry";
import { registerBuiltInStrategies } from "./strategies";
import { leaderCandidateBaselineStrategy, type LeaderCandidateBaselineConfig } from "./strategies/leaderCandidateBaseline";

registerBuiltInStrategies(strategyRegistry);

const D = (index: number) => `2026-08-${String(index + 18).padStart(2, "0")}`;
const T1 = D(0), T2 = D(1), T3 = D(2), T4 = D(3), T5 = D(4), T6 = D(5);

const rec = (stockCode: string, limitUpDate: string, overrides: Partial<LeaderCandidateSourceRecord> = {}): LeaderCandidateSourceRecord => ({
  stockCode,
  stockName: `股票${stockCode}`,
  limitUpDate,
  limitUpTime: "09:40:00",
  sector: "题材A",
  turnover: "20",
  circulationValue: "100",
  ...overrides,
});

/** A 在 T1..T3 连续涨停（3板），B 在 T2..T3（2板），C 仅 T3（首板）。 */
function recordsThroughT3(): LeaderCandidateSourceRecord[] {
  return [
    rec("600001.SH", T1), rec("600001.SH", T2), rec("600001.SH", T3),
    rec("600002.SH", T2), rec("600002.SH", T3),
    rec("600003.SH", T3),
  ];
}

function recordsThroughT6(): LeaderCandidateSourceRecord[] {
  return [
    ...recordsThroughT3(),
    rec("600001.SH", T4), rec("600001.SH", T5), rec("600001.SH", T6),
    rec("600002.SH", T4),
    rec("600004.SH", T4), rec("600004.SH", T5),
  ];
}

const portfolio = () => ({ cash: 100000, equity: 100000, openPositionCount: 0, openPositionSymbols: [] as readonly string[] });

const evaluateBaseline = (records: LeaderCandidateSourceRecord[], signalTime: string, config?: Partial<LeaderCandidateBaselineConfig>) =>
  leaderCandidateBaselineStrategy.evaluate({
    signalTime,
    data: buildLeaderCandidateDataViewForDate(records, signalTime),
    portfolio: portfolio(),
    config: leaderCandidateBaselineStrategy.normalizeConfig(config),
  });

describe("龙头候选原始评分策略（baseline）", () => {
  it("产生按评分降序的 BUY 信号（3 只候选）", () => {
    const decision = evaluateBaseline(recordsThroughT3(), T3);
    expect(decision.insufficientData).toBe(false);
    expect(decision.signals.map((s) => s.symbol)).toEqual(["600001.SH", "600002.SH", "600003.SH"]);
    expect(decision.signals.every((s) => s.action === "BUY")).toBe(true);
    // 评分严格降序
    const scores = decision.signals.map((s) => s.score!);
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
    expect(scores[1]!).toBeGreaterThan(scores[2]!);
  });

  it("数据不足：无候选日返回 insufficientData=true 且无信号", () => {
    const decision = evaluateBaseline([], "2026-09-01");
    expect(decision.insufficientData).toBe(true);
    expect(decision.signals).toHaveLength(0);
  });

  it("确定性：相同输入两次评估结果深度相等", () => {
    expect(evaluateBaseline(recordsThroughT3(), T3)).toEqual(evaluateBaseline(recordsThroughT3(), T3));
  });

  it("minScore 阈值过滤候选", () => {
    const decision = evaluateBaseline(recordsThroughT3(), T3, { minScore: 61, maxSignals: 10 });
    // 67(A) 通过，60(B)、53(C) 被过滤
    expect(decision.signals.map((s) => s.symbol)).toEqual(["600001.SH"]);
  });

  it("maxSignals 限制输出意图数量", () => {
    const decision = evaluateBaseline(recordsThroughT3(), T3, { maxSignals: 1 });
    expect(decision.signals.map((s) => s.symbol)).toEqual(["600001.SH"]);
  });

  it("实例隔离：A/B/A 三次评估，两次 A 完全一致", () => {
    const a1 = strategyRegistry.evaluate("leader-candidate-baseline", T3, buildLeaderCandidateDataViewForDate(recordsThroughT3(), T3), portfolio());
    const b = strategyRegistry.evaluate("leader-candidate-baseline", T4, buildLeaderCandidateDataViewForDate(recordsThroughT6(), T4), portfolio());
    const a2 = strategyRegistry.evaluate("leader-candidate-baseline", T3, buildLeaderCandidateDataViewForDate(recordsThroughT3(), T3), portfolio());
    expect(a1).toEqual(a2);
    expect(b.signals.length).toBeGreaterThan(0);
  });

  it("未来数据污染：T1-T3 与 T1-T6 在 T3 的信号完全一致", () => {
    const short = evaluateBaseline(recordsThroughT3(), T3);
    const long = evaluateBaseline(recordsThroughT6(), T3);
    expect(long.signals).toEqual(short.signals);
  });

  it("Legacy 行为对照：信号顺序与 legacy 候选排序一致", () => {
    const legacy = buildLeaderCandidatesForDate(recordsThroughT3(), T3);
    const decision = evaluateBaseline(recordsThroughT3(), T3, { maxSignals: 100 });
    expect(decision.signals.map((s) => s.symbol)).toEqual(legacy.candidates.map((c) => c.stockCode));
  });

  it("P3-1 回归：准入候选超过 20 只时 adapter 视图不受默认 20 只截断", () => {
    // 25 只同题材、早封板候选（sectorCount=25>=3、limitUpTime=09:40<=13:30），全部通过准入过滤。
    const manyRecords: LeaderCandidateSourceRecord[] = Array.from({ length: 25 }, (_, i) =>
      rec(`600${String(i + 1).padStart(3, "0")}.SH`, T3),
    );
    const view = buildLeaderCandidateDataViewForDate(manyRecords, T3);
    expect(view.candidates).toHaveLength(25);
    // 与 legacy 回测口径（candidateLimit: null）严格一致
    const legacy = buildLeaderCandidatesForDate(manyRecords, T3, { candidateLimit: null });
    expect(view.candidates.map((c) => c.stockCode)).toEqual(legacy.candidates.map((c) => c.stockCode));
  });
});

describe("Registry + Backtest Core 集成", () => {
  it("策略经 Registry 驱动 Backtest Core 产生成交", () => {
    // 信号日 T1 三只同题材候选（sectorCount=3 通过准入），评分通过流通市值区分：
    // A(100→53)、B(500→47)、C(10→41)；maxSignals=1 → 仅 A 发出买入意图，T2 开盘成交。
    const records: LeaderCandidateSourceRecord[] = [
      rec("600001.SH", T1, { circulationValue: "100" }),
      rec("600002.SH", T1, { circulationValue: "500" }),
      rec("600003.SH", T1, { circulationValue: "10" }),
    ];

    const bar = (date: string, open: number | null, close: number | null, prevClose: number | null, amount: number | null = null): MarketBar =>
      ({ date, open, high: null, low: null, close, prevClose, amount });

    const barsByDate = new Map<string, Map<string, MarketBar>>([
      [T1, new Map([
        ["600001.SH", bar(T1, null, 10, 9.5, null)],
        ["600002.SH", bar(T1, null, 9, 8.5, null)],
        ["600003.SH", bar(T1, null, 8, 7.5, null)],
      ])],
      [T2, new Map([
        ["600001.SH", bar(T2, 10.2, 10.3, 10, null)],
        ["600002.SH", bar(T2, 9.1, 9.2, 9, null)],
        ["600003.SH", bar(T2, 8.1, 8.2, 8, null)],
      ])],
    ]);

    const result = runBacktest({
      config: {
        strategyId: "leader-candidate-baseline",
        strategyVersion: leaderCandidateBaselineStrategy.metadata.version,
        initialCapital: 100000,
        startDate: T1,
        endDate: T2,
        cost: DEFAULT_COST_MODEL,
        maxPositions: 5,
        maxPositionAmountRatio: 0,
      },
      tradingDates: [T1, T2],
      barsByDate,
      signalProvider: (date) => {
        const decision = strategyRegistry.evaluate(
          "leader-candidate-baseline",
          date,
          buildLeaderCandidateDataViewForDate(records, date),
          portfolio(),
          { maxSignals: 1 },
        );
        return toCoreSignals(decision, { requestedQuantity: 100 });
      },
    });

    expect(result.metadata.strategyId).toBe("leader-candidate-baseline");
    expect(result.metadata.strategyVersion).toBe(leaderCandidateBaselineStrategy.metadata.version);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.symbol).toBe("600001.SH");
    expect(result.trades[0]!.entryTime).toBe(T2);
    expect(result.trades[0]!.quantity).toBe(100);
  });

  it("buildStrategySignalProvider + runBacktestWithRisk 固化 Strategy→Risk→Core 链路", () => {
    const records: LeaderCandidateSourceRecord[] = [
      rec("600001.SH", T1, { circulationValue: "100" }),
      rec("600002.SH", T1, { circulationValue: "500" }),
      rec("600003.SH", T1, { circulationValue: "10" }),
    ];
    const bar = (date: string, open: number | null, close: number | null, prevClose: number | null, amount: number | null = null): MarketBar =>
      ({ date, open, high: null, low: null, close, prevClose, amount });
    const barsByDate = new Map<string, Map<string, MarketBar>>([
      [T1, new Map([
        ["600001.SH", bar(T1, null, 10, 9.5, 500_000)],
        ["600002.SH", bar(T1, null, 9, 8.5, 500_000)],
        ["600003.SH", bar(T1, null, 8, 7.5, 500_000)],
      ])],
      [T2, new Map([
        ["600001.SH", bar(T2, 10.2, 10.3, 10, 500_000)],
        ["600002.SH", bar(T2, 9.1, 9.2, 9, 500_000)],
        ["600003.SH", bar(T2, 8.1, 8.2, 8, 500_000)],
      ])],
    ]);

    // 固化桥接：Strategy → registry.evaluate → toCoreSignals → signalProvider。
    const signalProvider = buildStrategySignalProvider(
      "leader-candidate-baseline",
      (date) => buildLeaderCandidateDataViewForDate(records, date),
      { config: { maxSignals: 1 }, requestedQuantity: 100 },
    );

    // 统一入口：默认注入与 config 对齐的 RiskManager。
    const result = runBacktestWithRisk({
      config: {
        strategyId: "leader-candidate-baseline",
        strategyVersion: leaderCandidateBaselineStrategy.metadata.version,
        initialCapital: 100000,
        startDate: T1,
        endDate: T2,
        cost: DEFAULT_COST_MODEL,
        maxPositions: 5,
        maxPositionAmountRatio: 0,
      },
      tradingDates: [T1, T2],
      barsByDate,
      signalProvider,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.symbol).toBe("600001.SH");
    expect(result.trades[0]!.quantity).toBe(100);
    // 默认 RiskManager 已注入，产生可解释的风险决策追踪。
    const rd = (result as unknown as { riskDecisions?: { decision: string; approvedQuantity: number }[] }).riskDecisions;
    expect(rd).toHaveLength(1);
    expect(rd![0]!.decision).toBe("APPROVE");
    expect(rd![0]!.approvedQuantity).toBe(100);
  });
});
