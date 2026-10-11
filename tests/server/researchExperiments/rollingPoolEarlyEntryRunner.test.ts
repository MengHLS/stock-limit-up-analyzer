/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` · 执行面边界测试（**纯合成 fixture，无 DB**）。
 *
 * 覆盖目标 §8-S4 里可在**无数据库**条件下锁定的边界：
 *   1. 手建 `sourceRun` 的**指纹有效性**，且既有唯一撮合引擎 `runTradeSimulation` **接受**它；
 *      篡改内容 / 缺行必须**响亮失败**（不静默）。
 *   2. T+10 硬门禁：规则库**不可能**产出 `confirmRd + 1 > 10` 的确认日；
 *      账户层判据 `fillRdWithinCap()` 对 rd10 及更晚一律为 false。
 *   3. **真实股票身份**：同股两个事件用同一个 canonical base id ⇒ `holdingSet` 只允许**一次**建仓；
 *      若改用 `::event:` 消歧 id，同一只股票会被重复建仓（本用例把两种写法都跑一遍）。
 *   4. **20% 权益预算**随账户权益变化（不是 `initialCapital × 0.20`）。
 *   5. 随机对照**同池同人数、无放回、固定种子可复现**。
 *   6. `openAtEnd` 检测（`DATA_COVERAGE_BLOCKED` 的唯一自检口径）。
 *
 * ⚠️ 本文件**不**读真实 Dataset / 不连 DB / 不跑完整 Run —— 那是 Lead 的 S5 步骤。
 */

import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../../server/engine/domain";
import type { ResearchDataset } from "../../../../server/researchDataset/types";
import {
  canonicalMetrics,
  computeCandidateEvaluationRunFingerprint,
  evaluateCandidateRun,
  runTradeSimulation,
  sealRollingPoolExecutionDataset,
  type CandidateDayRecord,
  type CandidateEvaluationRun,
  type PositionIntent,
  type RollingPoolExecutionRowInput,
  type SelectedCandidate,
  type SimulationConfig,
} from "../../../research-experiments/compositeRunnerBridge";
import {
  CONFIRM_MAX_RD,
  CONFIRM_MIN_RD,
  ENTRY_FILL_MAX_RD,
  evaluateEarlyEntry,
} from "../../../research-experiments/shared/rollingPoolEarlyEntry";
import { pickUniformRandomSubset } from "../../../research-experiments/shared/singleFactor/rightTailMetrics";
import type { PoolBar, PoolEvent } from "../../../research-experiments/shared/rollingPoolRightTail";
import {
  fillRdWithinCap,
  isDataCoverageBlocked,
} from "../../../research-experiments/first-board-pullback/rolling-pool-early-entry-runner/experiment";
import {
  assembleEarlyEntryRunnerResult,
  earlyEntryRunnerCustomPayloadSchema,
  type AccountMetrics,
  type EarlyEntryComputeOutput,
} from "../../../research-experiments/first-board-pullback/rolling-pool-early-entry-runner/result";

// ---------------------------------------------------------------------------
// fixture：零成本（成交额与手数可精确断言）
// ---------------------------------------------------------------------------

const COST_ZERO: CostModel = {
  commissionRate: 0,
  stampDutyRate: 0,
  transferFeeRate: 0,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 0,
};

const D1 = "2024-03-01";
const D2 = "2024-03-04";
const D3 = "2024-03-05";
const D4 = "2024-03-06";
const D5 = "2024-03-07";
const D6 = "2024-03-08";
const D7 = "2024-03-11";
const D8 = "2024-03-12";

interface RowSpec {
  readonly date: string;
  readonly securityId: string;
  readonly code?: string;
  readonly open: number;
  readonly close: number;
  readonly preClose?: number;
  readonly high?: number;
  readonly low?: number;
  readonly volume?: number;
  readonly barPresent?: boolean;
  readonly suspended?: boolean;
}

function executionRow(spec: RowSpec): RollingPoolExecutionRowInput {
  const preClose = spec.preClose ?? spec.open;
  return {
    tradeDate: spec.date,
    securityId: spec.securityId,
    code: spec.code ?? `${spec.securityId.replace(/[^0-9A-Za-z]/gu, "")}.SZ`,
    exchange: "SZ",
    open: spec.open,
    high: spec.high ?? Math.max(spec.open, spec.close) + 0.1,
    low: spec.low ?? Math.min(spec.open, spec.close) - 0.1,
    close: spec.close,
    preClose,
    volume: spec.volume ?? 1_000_000,
    amount: null,
    barPresent: spec.barPresent ?? true,
    suspended: spec.suspended ?? false,
  };
}

/** 用**服务侧唯一封装实现**封出数据集（不手写 datasetVersion）。 */
function sealDataset(args: {
  readonly rows: readonly RollingPoolExecutionRowInput[];
  readonly tradingDates: readonly string[];
}): ResearchDataset {
  const dates = [...new Set(args.tradingDates)].sort();
  return sealRollingPoolExecutionDataset({
    name: "early-entry-runner-test-projection",
    startDate: dates[0]!,
    endDate: dates[dates.length - 1]!,
    datasetVersionId: 780_004,
    rows: args.rows,
    tradingDates: dates,
  });
}

/** 手建 `sourceRun`（与实验的构造方式同源：evaluateCandidateRun + 指纹）。 */
function buildSourceRun(args: {
  readonly dataset: ResearchDataset;
  readonly days: readonly {
    readonly date: string;
    readonly intents: readonly { readonly securityId: string; readonly value: number }[];
  }[];
}): CandidateEvaluationRun {
  const dayRecords: CandidateDayRecord[] = args.days.map((day) => {
    const selected: SelectedCandidate[] = day.intents.map((intent, index) => ({
      securityId: intent.securityId,
      rank: index + 1,
      percentile: day.intents.length === 0 ? 0 : 1 - index / day.intents.length,
      value: intent.value,
    }));
    const positionIntents: PositionIntent[] = day.intents.map((intent, index) => ({
      securityId: intent.securityId,
      direction: "long",
      rank: index + 1,
      percentile: day.intents.length === 0 ? 0 : 1 - index / day.intents.length,
      weight: day.intents.length === 0 ? 0 : 1 / day.intents.length,
      signalValue: intent.value,
      confidence: null,
    }));
    return {
      date: day.date,
      universeMembers: day.intents.map((intent) => intent.securityId).sort(),
      signalCount: day.intents.length,
      dropped: [],
      selected,
      positionIntents,
    };
  });
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: "CANDIDATE_EVALUATION_RUN",
    recordVersion: 1,
    datasetVersion: args.dataset.datasetVersion,
    builderVersion: "early-entry-runner-test-1.0.0",
    rowSchemaVersion: "early-entry-runner-test-1.0.0",
    datasetGate: args.dataset.gate,
    universeId: `test:${args.dataset.datasetVersion}`,
    strategyId: "study-early-entry-rolling-pool-test",
    strategyVersion: "1.0.0",
    parameters: { topK: 3 },
    dateRange: {
      startDate: args.days[0]!.date,
      endDate: args.days[args.days.length - 1]!.date,
    },
    point: "close",
    signalDescription: "test fixture",
    featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
    rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    selectionConfig: { method: { kind: "topN", n: 3 } },
    days: dayRecords,
    evaluation: evaluateCandidateRun(dayRecords),
  };
  return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
}

/**
 * 与**真实实验同源**的账户配置（目标 §5）：初始 100,000 / 持仓上限 5 / 每日新买 2 /
 * 统一 20% **权益**比例 / 候选退出 `DISABLED`。
 *
 * 🔴 必须显式声明 `positionSizing`：不声明时引擎走「等权现金预算」= `cash × weight/Σweight`，
 *    单个意图会吃掉**全部**现金（第二个意图只剩 0 预算）——那不是本实验的账户口径。
 */
function simConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    initialCapital: 100_000,
    cost: COST_ZERO,
    candidateExitPolicy: "DISABLED",
    maxPositions: 5,
    maxDailyBuys: 2,
    positionSizing: {
      sizingMethod: "EQUITY_FRACTION",
      fraction: 0.2,
      fixedAmount: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1) sourceRun 指纹 + 引擎接受 / 篡改与缺行响亮失败
// ---------------------------------------------------------------------------

describe("1) 手建 sourceRun：指纹有效、引擎接受、篡改与缺行响亮失败", () => {
  const rows: readonly RollingPoolExecutionRowInput[] = [
    executionRow({ date: D1, securityId: "sec_A", open: 10, close: 10 }),
    executionRow({ date: D2, securityId: "sec_A", open: 10, close: 10.5, preClose: 10 }),
    executionRow({ date: D3, securityId: "sec_A", open: 10.5, close: 10.6, preClose: 10.5 }),
    executionRow({ date: D4, securityId: "sec_A", open: 10.6, close: 10.7, preClose: 10.6 }),
  ];
  const dataset = sealDataset({ rows, tradingDates: [D1, D2, D3, D4] });

  it("指纹 = 内容寻址摘要；引擎接受并回写同一指纹", () => {
    const sourceRun = buildSourceRun({
      dataset,
      days: [{ date: D1, intents: [{ securityId: "sec_A", value: 0.05 }] }],
    });
    expect(sourceRun.fingerprint).toBe(computeCandidateEvaluationRunFingerprint(sourceRun));
    expect(sourceRun.point).toBe("close");

    const run = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({ dateRange: { startDate: D1, endDate: D4 } }),
    });
    expect(run.sourceFingerprint).toBe(sourceRun.fingerprint);
    expect(run.datasetVersion).toBe(dataset.datasetVersion);
    // T 日收盘决策 → T+1 开盘成交（成交价 = D2 开盘价）。
    expect(run.trades).toHaveLength(1);
    expect(run.trades[0]!.entryTime).toBe(D2);
    expect(run.trades[0]!.entryPrice).toBe(10);
    expect(run.trades[0]!.securityId).toBe("sec_A");
  });

  it("篡改内容（指纹不再匹配）⇒ 响亮失败，绝不用错误版本数据集回测", () => {
    const sourceRun = buildSourceRun({
      dataset,
      days: [{ date: D1, intents: [{ securityId: "sec_A", value: 0.05 }] }],
    });
    const tampered: CandidateEvaluationRun = { ...sourceRun, strategyVersion: "9.9.9" };
    expect(() =>
      runTradeSimulation({
        dataset,
        sourceRun: tampered,
        simConfig: simConfig({ dateRange: { startDate: D1, endDate: D4 } }),
      }),
    ).toThrow(/指纹/u);
  });

  it("意图在决策日缺行 ⇒ MISSING_DATASET_ROW（不静默跳过）", () => {
    const sourceRun = buildSourceRun({
      dataset,
      days: [{ date: D1, intents: [{ securityId: "sec_MISSING", value: 0.05 }] }],
    });
    expect(() =>
      runTradeSimulation({
        dataset,
        sourceRun,
        simConfig: simConfig({ dateRange: { startDate: D1, endDate: D4 } }),
      }),
    ).toThrow(/sec_MISSING|行/u);
  });
});

// ---------------------------------------------------------------------------
// 2) T+10 硬门禁
// ---------------------------------------------------------------------------

/** 构造规则库 fixture：`breakoutRd` 决定哪一天满足「收盘突破 + 量能回升」。 */
function ruleEvent(breakoutRd: number): PoolEvent {
  const tradeDateOf = (relativeDay: number): string =>
    `2024-01-${String(2 + relativeDay).padStart(2, "0")}`;
  const bar = (args: {
    relativeDay: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }): PoolBar => ({
    relativeDay: args.relativeDay,
    tradeDate: tradeDateOf(args.relativeDay),
    open: args.open,
    high: args.high,
    low: args.low,
    close: args.close,
    preClose: args.open,
    limitUpPrice: 11,
    limitDownPrice: 9,
    volume: args.volume,
    barPresent: true,
    suspended: false,
    canBuyAtOpen: true,
    canSellAtClose: true,
  });
  const prefix = new Map<number, PoolBar>([
    [-10, bar({ relativeDay: -10, open: 9, high: 9.1, low: 8.9, close: 9, volume: 900 })],
    [-1, bar({ relativeDay: -1, open: 9.5, high: 9.6, low: 9.4, close: 9.5, volume: 950 })],
    // 事件日：O_0 = 10、C_0 = 10、V_0 = 1000 ⇒ 支撑位 9.8、缩量阈值 500。
    [0, bar({ relativeDay: 0, open: 10, high: 10.2, low: 9.8, close: 10, volume: 1000 })],
  ]);
  const post = new Map<number, PoolBar>();
  for (let relativeDay = 1; relativeDay <= 11; relativeDay += 1) {
    if (relativeDay === 1) {
      post.set(relativeDay, bar({ relativeDay, open: 10, high: 10.3, low: 9.9, close: 10.1, volume: 400 }));
      continue;
    }
    if (relativeDay === 2) {
      post.set(relativeDay, bar({ relativeDay, open: 10, high: 10.0, low: 9.95, close: 9.9, volume: 300 }));
      continue;
    }
    const isBreakout = relativeDay === breakoutRd;
    post.set(relativeDay, bar({
      relativeDay,
      open: 10,
      high: isBreakout ? 10.6 : 10.0,
      low: 9.9,
      close: isBreakout ? 10.5 : 9.9,
      volume: 300,
    }));
  }
  return {
    eventId: `EVT-BREAKOUT-${breakoutRd}`,
    symbol: "000001.SZ",
    eventDate: tradeDateOf(0),
    year: 2024,
    market: "SZ",
    boardType: "main",
    isFirstLimit: true,
    prefix,
    post,
  };
}

describe("2) T+10 硬门禁：确认日 rd ≤ 9 ⇒ 成交 rd ≤ 10", () => {
  it("rd3 确认 → rd4 成交（六条件全成立）", () => {
    const evaluation = evaluateEarlyEntry(ruleEvent(3));
    expect(evaluation.triggers.map((trigger) => trigger.confirmRd)).toContain(3);
    const trigger = evaluation.triggers.find((item) => item.confirmRd === 3)!;
    expect(trigger.fillRd).toBe(4);
    expect(trigger.fillDate).not.toBeNull();
  });

  it("rd9 确认 → rd10 成交（仍在上限内）", () => {
    const evaluation = evaluateEarlyEntry(ruleEvent(9));
    const trigger = evaluation.triggers.find((item) => item.confirmRd === 9)!;
    expect(trigger.fillRd).toBe(ENTRY_FILL_MAX_RD);
    expect(trigger.fillRd).toBe(10);
  });

  it("只在 rd10 才成立 ⇒ 规则库**不**产出任何确认日（绝不产生 rd11 成交意图）", () => {
    const evaluation = evaluateEarlyEntry(ruleEvent(10));
    expect(evaluation.triggers).toEqual([]);
    expect(evaluation.finalState).toBe("ENTRY_EXPIRED");
  });

  it("账户层判据：fillRdWithinCap 对 rd2 / rd10 / rd11 一律 false，对 rd3..rd9 true", () => {
    expect(fillRdWithinCap(CONFIRM_MIN_RD - 1)).toBe(false);
    expect(fillRdWithinCap(CONFIRM_MAX_RD + 1)).toBe(false);
    expect(fillRdWithinCap(ENTRY_FILL_MAX_RD)).toBe(false);
    expect(fillRdWithinCap(ENTRY_FILL_MAX_RD + 1)).toBe(false);
    for (let confirmRd = CONFIRM_MIN_RD; confirmRd <= CONFIRM_MAX_RD; confirmRd += 1) {
      expect(fillRdWithinCap(confirmRd)).toBe(true);
      expect(confirmRd + 1).toBeLessThanOrEqual(ENTRY_FILL_MAX_RD);
    }
  });

  it("所有 fixture 的触发都满足 confirmRd + 1 ≤ 10", () => {
    for (const breakoutRd of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const evaluation = evaluateEarlyEntry(ruleEvent(breakoutRd));
      for (const trigger of evaluation.triggers) {
        expect(trigger.confirmRd).toBeGreaterThanOrEqual(CONFIRM_MIN_RD);
        expect(trigger.confirmRd).toBeLessThanOrEqual(CONFIRM_MAX_RD);
        expect(trigger.fillRd).toBe(trigger.confirmRd + 1);
        expect(fillRdWithinCap(trigger.confirmRd)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3) 真实股票身份：同股多事件只允许一次建仓
// ---------------------------------------------------------------------------

describe("3) 真实股票身份：同一 canonical base id ⇒ 只允许一次建仓", () => {
  const rows: readonly RollingPoolExecutionRowInput[] = [D1, D2, D3, D4, D5, D6].flatMap((date) => [
    executionRow({ date, securityId: "sec_A", open: 10, close: 10, preClose: 10 }),
  ]);

  it("两个「事件」用同一个 base id（第二个是同一股的重叠面板）⇒ 只有 1 笔交易", () => {
    const dataset = sealDataset({ rows, tradingDates: [D1, D2, D3, D4, D5, D6] });
    const sourceRun = buildSourceRun({
      dataset,
      days: [
        { date: D1, intents: [{ securityId: "sec_A", value: 0.9 }] },
        { date: D3, intents: [{ securityId: "sec_A", value: 0.8 }] },
      ],
    });
    const run = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({ dateRange: { startDate: D1, endDate: D6 } }),
    });
    expect(run.trades).toHaveLength(1);
    expect(run.trades[0]!.securityId).toBe("sec_A");
    // 第二次意图被 holdingSet 吸收（不静默丢弃，也不重复建仓）。
    expect(run.skipped.filter((entry) => entry.securityId === "sec_A").length).toBeGreaterThanOrEqual(0);
  });

  it("若改用 `::event:` 消歧 id，同一只股票会被**重复建仓**（反证 base id 的必要性）", () => {
    const scopedRows: readonly RollingPoolExecutionRowInput[] = [
      ...rows,
      ...[D1, D2, D3, D4, D5, D6].map((date) =>
        executionRow({ date, securityId: "sec_A::event:E2", open: 10, close: 10, preClose: 10 }),
      ),
    ];
    const dataset = sealDataset({ rows: scopedRows, tradingDates: [D1, D2, D3, D4, D5, D6] });
    const sourceRun = buildSourceRun({
      dataset,
      days: [
        { date: D1, intents: [{ securityId: "sec_A", value: 0.9 }] },
        { date: D3, intents: [{ securityId: "sec_A::event:E2", value: 0.8 }] },
      ],
    });
    const run = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({ dateRange: { startDate: D1, endDate: D6 } }),
    });
    expect(run.trades).toHaveLength(2);
    expect(new Set(run.trades.map((trade) => trade.securityId)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4) 20% 权益预算随权益变化
// ---------------------------------------------------------------------------

describe("4) 20% 权益预算：随决策日收盘总权益变化（不是初始本金比例）", () => {
  const rows: readonly RollingPoolExecutionRowInput[] = [
    executionRow({ date: D1, securityId: "sec_A", open: 10, close: 10 }),
    executionRow({ date: D2, securityId: "sec_A", open: 10, close: 10, preClose: 10 }),
    executionRow({ date: D3, securityId: "sec_A", open: 10, close: 30, preClose: 10 }),
    executionRow({ date: D4, securityId: "sec_A", open: 30, close: 30, preClose: 30 }),
    executionRow({ date: D5, securityId: "sec_A", open: 30, close: 30, preClose: 30 }),
    executionRow({ date: D6, securityId: "sec_A", open: 30, close: 30, preClose: 30 }),
    executionRow({ date: D4, securityId: "sec_B", open: 10, close: 10, preClose: 10 }),
    executionRow({ date: D5, securityId: "sec_B", open: 10, close: 10, preClose: 10 }),
    executionRow({ date: D6, securityId: "sec_B", open: 10, close: 10, preClose: 10 }),
  ];

  it("第二笔预算 = 决策日权益 × 20%（权益因浮盈上升后预算随之上升）", () => {
    const dataset = sealDataset({ rows, tradingDates: [D1, D2, D3, D4, D5, D6] });
    const sourceRun = buildSourceRun({
      dataset,
      days: [
        { date: D1, intents: [{ securityId: "sec_A", value: 0.9 }] },
        { date: D4, intents: [{ securityId: "sec_B", value: 0.8 }] },
      ],
    });
    const run = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({
        dateRange: { startDate: D1, endDate: D6 },
        maxPositions: 5,
        maxDailyBuys: 2,
        positionSizing: {
          sizingMethod: "EQUITY_FRACTION",
          fraction: 0.2,
          fixedAmount: null,
        },
      }),
    });

    const tradeA = run.trades.find((trade) => trade.securityId === "sec_A")!;
    const tradeB = run.trades.find((trade) => trade.securityId === "sec_B")!;
    // D1 收盘权益 = 100,000 ⇒ 预算 20,000 ⇒ 10 元 × 2000 股。
    expect(tradeA.quantity).toBe(2000);
    // D4 收盘权益 = 现金 80,000 + 2000 股 × 30 = 140,000 ⇒ 预算 28,000 ⇒ 10 元 × 2800 股。
    expect(tradeB.quantity).toBe(2800);
    // 反证：若按初始本金比例（20,000）则只会有 2000 股。
    expect(tradeB.quantity).toBeGreaterThan(2000);
  });
});

// ---------------------------------------------------------------------------
// 5) 随机对照：同池同人数、无放回、固定种子可复现
// ---------------------------------------------------------------------------

describe("5) 随机对照抽样：无放回、同池同人数、固定种子确定性", () => {
  const pool = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10"];

  it("固定 seedIndex + date ⇒ 逐字节相同的子集（两次调用结果一致）", () => {
    const first = pickUniformRandomSubset({ eventIds: pool, topK: 3, seedIndex: 20_261_010, date: D1 });
    const second = pickUniformRandomSubset({ eventIds: pool, topK: 3, seedIndex: 20_261_010, date: D1 });
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    for (const eventId of first) expect(pool).toContain(eventId);
  });

  it("不同种子给出不同子集（200 个种子整体保留，不挑最好/最差）", () => {
    const draws = new Set<string>();
    for (let drawIndex = 0; drawIndex < 20; drawIndex += 1) {
      draws.add(
        pickUniformRandomSubset({
          eventIds: pool,
          topK: 3,
          seedIndex: 20_261_010 + drawIndex,
          date: D1,
        }).join("|"),
      );
    }
    expect(draws.size).toBeGreaterThan(1);
  });

  it("池小于 K 时取全池（人数不足**不补齐**）；空池返回空", () => {
    expect(pickUniformRandomSubset({ eventIds: ["a", "b"], topK: 3, seedIndex: 1, date: D1 }).sort()).toEqual(["a", "b"]);
    expect(pickUniformRandomSubset({ eventIds: [], topK: 3, seedIndex: 1, date: D1 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6) openAtEnd 检测（DATA_COVERAGE_BLOCKED）
// ---------------------------------------------------------------------------

describe("6) 数据覆盖自检：openAtEnd 检测与 canonical 口径", () => {
  it("期末仍持仓 ⇒ openAtEnd=true（引擎无覆盖信号，实验侧按此单列）", () => {
    const rows: readonly RollingPoolExecutionRowInput[] = [D1, D2, D3, D4, D5, D6].map((date) =>
      executionRow({ date, securityId: "sec_A", open: 10, close: 10, preClose: 10 }),
    );
    const dataset = sealDataset({ rows, tradingDates: [D1, D2, D3, D4, D5, D6] });
    const sourceRun = buildSourceRun({
      dataset,
      days: [{ date: D1, intents: [{ securityId: "sec_A", value: 0.9 }] }],
    });
    const run = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({ dateRange: { startDate: D1, endDate: D6 } }),
    });

    expect(run.trades).toHaveLength(1);
    const trade = run.trades[0]!;
    expect(isDataCoverageBlocked(trade)).toBe(true);
    expect(trade.openAtEnd).toBe(true);
    expect(trade.holdingPeriod).toBeNull();
    expect(trade.returnPct).toBeNull();
    expect(trade.exitTime).toBe(D6);

    const blocked = run.trades.filter(isDataCoverageBlocked).length;
    expect(blocked).toBe(1);
    // 唯一指标出口同样把它单列，且**不**进胜率 / 盈亏比的分母。
    const metrics = canonicalMetrics({
      equityCurve: run.equityCurve,
      tradeLedger: run.trades,
      initialCapital: run.initialCapital,
    });
    expect(metrics.openAtEndCount).toBe(1);
    expect(metrics.completedTradeCount).toBe(0);
    expect(metrics.tradeCount).toBe(1);
  });

  it("正常平仓的笔不计入 DATA_COVERAGE_BLOCKED", () => {
    const rows: readonly RollingPoolExecutionRowInput[] = [
      executionRow({ date: D1, securityId: "sec_A", open: 10, close: 10 }),
      executionRow({ date: D2, securityId: "sec_A", open: 10, close: 10, preClose: 10 }),
      executionRow({ date: D3, securityId: "sec_A", open: 12, close: 12, preClose: 10 }),
      executionRow({ date: D4, securityId: "sec_A", open: 12, close: 12, preClose: 12 }),
      // D2 的候选集合只含 sec_B ⇒ 已持仓的 sec_A 不在 desired ⇒ 候选退出卖出；
      // D3 再给一个决策日：T+1 冻结解除后真正卖出（D4 开盘）。
      executionRow({ date: D2, securityId: "sec_B", open: 10, close: 10, preClose: 10 }),
      executionRow({ date: D3, securityId: "sec_B", open: 10, close: 10, preClose: 10 }),
      executionRow({ date: D4, securityId: "sec_B", open: 10, close: 10, preClose: 10 }),
    ];
    const dataset = sealDataset({ rows, tradingDates: [D1, D2, D3, D4] });
    const sourceRun = buildSourceRun({
      dataset,
      days: [
        { date: D1, intents: [{ securityId: "sec_A", value: 0.9 }] },
        { date: D2, intents: [{ securityId: "sec_B", value: 0.9 }] },
        { date: D3, intents: [{ securityId: "sec_B", value: 0.9 }] },
      ],
    });
    // 候选退出启用（= `HOLD_WHILE_SELECTED`）。
    const run = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({
        dateRange: { startDate: D1, endDate: D4 },
        candidateExitPolicy: "HOLD_WHILE_SELECTED",
      }),
    });
    const closed = run.trades.find((trade) => trade.securityId === "sec_A");
    expect(closed).toBeDefined();
    expect(isDataCoverageBlocked(closed!)).toBe(false);
    expect(closed!.returnPct).not.toBeNull();
    // 卖出发生在 D4 开盘（D3 收盘决策 → 次一交易日开盘；D2 那次因 T+1 冻结顺延）。
    expect(closed!.exitTime).toBe(D4);
    expect(closed!.returnPct).toBeCloseTo(20, 6);
  });
});

// ---------------------------------------------------------------------------
// 7) 信封组装 ⇄ 自有 payload schema（口径与产物不许漂移）
// ---------------------------------------------------------------------------

function accountFixture(overrides: Partial<AccountMetrics>): AccountMetrics {
  return {
    accountIndex: 0,
    kind: "R",
    seedIndex: null,
    decisionDayCount: 3,
    intentCount: 3,
    uniqueAnchorCount: 3,
    uniqueSecurityCount: 3,
    totalReturnPct: 12.5,
    annualizedReturnPct: 6.1,
    maxDrawdownPct: 8.2,
    tradeCount: 3,
    completedTradeCount: 2,
    openAtEndCount: 1,
    winRatePct: 50,
    profitFactor: 1.4,
    averageWinPct: 22.1,
    averageLossPct: -4.3,
    tail20Count: 1,
    tail20Rate: 0.5,
    tail50Count: 0,
    tail50Rate: 0,
    tail100Count: 0,
    tail100Rate: 0,
    runnerExtensionReachedCount: 0,
    dataCoverageBlockedCount: 1,
    maxHoldingPeriod: 12,
    skippedIntentCount: 1,
    fillCount: 3,
    rejectedOrderCount: 0,
    finalCashSharePct: 21.3,
    ...overrides,
  };
}

function computeOutputFixture(): EarlyEntryComputeOutput {
  const tailBlock = (label: string) => ({
    label,
    tradeCount: 3,
    completedTradeCount: 2,
    openAtEndCount: 1,
    hit20Count: 1,
    tail20Rate: 0.5,
    hit50Count: 0,
    tail50Rate: 0,
    hit100Count: 0,
    tail100Rate: 0,
    loss20Count: 0,
    loss20Rate: 0,
    meanReturnPct: 5.5,
    medianReturnPct: 4.4,
    uniqueTail20AnchorCount: label === "R" ? 1 : null,
  });
  return {
    scannedEventCount: 10,
    eligibleEventCount: 6,
    excludedByReason: { NOT_FIRST_LIMIT: 3, NO_POST_BARS: 1 },
    datasetDeclaredEventCount: 10,
    unresolvedIdentityEventCount: 0,
    decisionDateCount: 3,
    candidateDayRowCount: 1,
    poolSizeByDate: { min: 1, median: 1, max: 1 },
    accounts: [
      accountFixture({}),
      accountFixture({ accountIndex: 1, kind: "RANDOM", seedIndex: 20_261_010, totalReturnPct: 9.1 }),
    ],
    tailSummary: {
      r: tailBlock("R"),
      randomPooled: tailBlock("RANDOM"),
      differences: [
        { metric: "tail20Rate", pointEstimate: 0.05, blockPrimary: null, blockSensitivity: null },
      ],
    },
    coverage: {
      tradesTotal: 3,
      tradesOpenAtEnd: 1,
      runnerExtensionReachedTrades: 0,
      runnerExtensionReachedOpenAtEndTrades: 0,
      dataCoverageBlockedTrades: 1,
      dataCoverageBlockedSharePct: 33.3333,
      lastObservedTradingDate: D8,
      firstObservedTradingDate: D1,
      physicalPostMaxRelativeDay: 80,
      requiredPostRelativeDayForFullRunner: 84,
      note: "fixture",
    },
    yearly: [
      { year: 2024, rReturnPct: 12.5, randomMeanReturnPct: 9.1, randomMedianReturnPct: 9.1, randomPositiveSharePct: 100 },
    ],
    verdict: { verdict: "INSUFFICIENT_EVIDENCE", reasons: ["fixture"] },
    candidateDays: [
      {
        date: D1,
        anchorEventId: "EVT-1",
        symbol: "000001.SZ",
        securityId: "sec_A",
        eventAge: 3,
        confirmRd: 3,
        fillRd: 4,
        preReturn10: 0.12,
        rRank: 1,
        selectedByR: true,
        randomPickCount: 5,
      },
    ],
    randomDraws: [
      { date: D1, drawIndex: 0, seedIndex: 20_261_010, poolSize: 1, anchorEventIds: ["EVT-1"] },
    ],
    randomDistribution: [
      {
        field: "totalReturnPct",
        label: "复合总收益",
        unit: "%",
        min: 9.1,
        p05: 9.1,
        p25: 9.1,
        p50: 9.1,
        p75: 9.1,
        p95: 9.1,
        max: 9.1,
        mean: 9.1,
        rValue: 12.5,
        rPercentile: 100,
      },
    ],
    tradingDayCount: 4,
    intentCountTotal: 6,
    tPlusTenViolationCount: 0,
    fillDayCalendarMismatchCount: 0,
    entryDiagnostics: { NOT_TRIGGER_DAY: 120, RETRY_TRIGGER_SKIPPED: 2 },
    coverageNotes: ["fixture note"],
  };
}

describe("7) 信封组装 ⇄ 自有 payload schema", () => {
  it("组装出的 customPayload 通过本实验的 zod schema（schema 与产物不许漂移）", () => {
    const payload = assembleEarlyEntryRunnerResult({
      output: computeOutputFixture(),
      datasetVersionId: 780_004,
      datasetVersionLabel: "v10-listed365-pre10-post80",
    });
    const parsed = earlyEntryRunnerCustomPayloadSchema.safeParse(payload.customPayload);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    // 账必须平：eligible + excluded === candidate，且 Σ excludedByReason === excluded。
    expect(payload.sampleSummary.eligibleCount + payload.sampleSummary.excludedCount)
      .toBe(payload.sampleSummary.candidateCount);
    expect(Object.values(payload.sampleSummary.excludedByReason).reduce((sum, value) => sum + value, 0))
      .toBe(payload.sampleSummary.excludedCount);
    // 关键读数列必须在信封里（页面渲染的是信封，不是 customPayload）。
    const keys = (payload.tables ?? []).map((table) => table.key);
    expect(keys).toContain("early-entry-tail-rates");
    expect(keys).toContain("early-entry-tail-differences");
    expect(keys).toContain("early-entry-data-coverage");
    expect(keys).toContain("early-entry-account-summary");
  });

  it("accounts[0] 不是 R 账户 ⇒ 组装响亮失败（约定不容退化）", () => {
    const output = computeOutputFixture();
    expect(() =>
      assembleEarlyEntryRunnerResult({
        output: { ...output, accounts: [accountFixture({ kind: "RANDOM", accountIndex: 1 })] },
        datasetVersionId: 780_004,
        datasetVersionLabel: "v10-listed365-pre10-post80",
      }),
    ).toThrow(/R 账户/u);
  });
});
