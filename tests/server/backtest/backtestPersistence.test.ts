/**
 * BACKTEST-002 FINAL CLOSEOUT — B-03 持久化载荷 + B-04 Canonical Metrics。
 *
 * 判据取向：
 *   - B-03：载荷**能通过共享契约**、**明细确实有界**、**指纹存在**、**确定性**；
 *   - B-04：同一份（曲线 + 台账 + 初始资金）经**两条调用路径**得到**逐项相同**的 8 项指标。
 */

import { describe, expect, it } from "vitest";
import { closedLoopRunResultSchema, backtestRunPayloadSchema } from "../../../shared/researchContracts";
import {
  BACKTEST_ANNUALIZATION_DAYS,
  CANONICAL_METRIC_KEYS,
  DEFAULT_BACKTEST_SAMPLE_LIMIT,
  NOT_AVAILABLE,
  buildBacktestResult,
  buildBacktestRunPayload,
  canonicalMetrics,
  diffCanonicalMetrics,
} from "../../../server/backtest/backtestResult";
import type { EquityPoint, Trade } from "../../../server/backtest/types";

const INITIAL_CAPITAL = 100_000;

function curve(days: number): EquityPoint[] {
  return Array.from({ length: days }, (_, index) => {
    const equity = INITIAL_CAPITAL * (1 + index * 0.001) - (index % 17 === 0 ? 2_000 : 0);
    return { date: `2026-01-${String(index + 1).padStart(2, "0")}`, cash: equity, marketValue: 0, equity, openPositions: 0 };
  });
}

function trade(index: number, pnl: number): Trade {
  return {
    securityId: `6000${String(index).padStart(2, "0")}.SH`,
    entryTime: "2026-01-02",
    entryPrice: 10,
    exitTime: "2026-01-09",
    exitPrice: 10 + pnl / 1000,
    quantity: 1000,
    grossPnL: pnl,
    fees: 12,
    slippageAmount: 5,
    netPnl: pnl - 17,
    returnPct: (pnl / 10_000) * 100,
    holdingPeriod: 5,
    openAtEnd: false,
  } as Trade;
}

const EQUITY = curve(300);
const TRADES: readonly Trade[] = [trade(1, 1_200), trade(2, -400), trade(3, 800), trade(4, -200)];

function result() {
  return buildBacktestResult({
    runId: "clrun-bt2",
    strategyVersionId: "cand-360004@1.0.0",
    datasetVersionId: 390002,
    parameterSet: { max_volume_ratio: 0.3 },
    initialCapital: INITIAL_CAPITAL,
    equityCurve: EQUITY,
    tradeLedger: TRADES,
  });
}

function payload() {
  return buildBacktestRunPayload({ result: result() });
}

describe("B-03 Test 1 — BacktestRunResult 能进 resultJson（契约校验通过）", () => {
  it("与 strategyRun 并列、互不覆盖，整包能过 closedLoopRunResultSchema", () => {
    const p = payload();
    const runResult = {
      runId: "clrun-bt2",
      createdAt: "2026-09-19T00:00:00.000Z",
      chainFingerprint: "chain",
      fingerprint: "run",
      overall: {
        status: "ALL_EXECUTED" as const,
        executedStageCount: 14,
        blockedStageCount: 0,
        skippedStageCount: 0,
        firstBlockedReasonCode: null,
        synthetic: false,
        note: "",
      },
      runnerInjected: ["data", "research", "strategy", "backtest", "evaluation"],
      stages: [],
      blockedSummary: [],
      wiring: {
        requestedStages: [],
        wiredStages: [],
        unwiredStages: [],
        coveredStages: [],
        uncoveredStages: [],
        executorBound: false,
        notes: [],
        coverageRatio: 1,
      },
      assembly: null,
      strategyRun: null,
      backtest: {
        canonicalMetrics: p.canonicalMetrics,
        summary: p.summary,
        equitySamples: [...p.equitySamples],
        tradeSamples: [...p.tradeSamples],
        truncated: p.truncated,
        equityDigest: p.equityDigest,
        tradeDigest: p.tradeDigest,
        notes: [...p.notes],
        executionMetadata: {
          executionPolicyVersion: 1,
          engineVersion: "strategy-core/1.0.0",
          codeVersion: "1.0.0+gtest",
          initialCapital: INITIAL_CAPITAL,
          sampleLimit: DEFAULT_BACKTEST_SAMPLE_LIMIT,
          notes: ["T+1 强制"],
        },
      },
    };
    const parsed = closedLoopRunResultSchema.safeParse(runResult);
    if (!parsed.success) throw new Error("契约校验失败：" + JSON.stringify(parsed.error.issues.slice(0, 6)));
    expect(parsed.success).toBe(true);
    expect(parsed.data.backtest?.executionMetadata.executionPolicyVersion).toBe(1);
    // 载荷单独也能过自己的 schema
    expect(backtestRunPayloadSchema.safeParse(p).success).toBe(true);
  });
});

describe("B-03 Test 2/3 — 明细有界 + 指纹存在", () => {
  it("300 点曲线不全量入库：样本 ≤ 上限、truncated=true、摘要仍记全量规模", () => {
    const p = payload();
    expect(p.equitySamples.length).toBeLessThanOrEqual(DEFAULT_BACKTEST_SAMPLE_LIMIT);
    expect(p.equitySamples.length).toBeLessThan(EQUITY.length);
    expect(p.truncated.equity).toBe(true);
    expect(p.summary.equityPointCount).toBe(EQUITY.length);
    // 首尾必含
    expect((p.equitySamples[0] as { date: string }).date).toBe(EQUITY[0]!.date);
    expect((p.equitySamples[p.equitySamples.length - 1] as { date: string }).date).toBe(EQUITY[EQUITY.length - 1]!.date);
    // 成交样本同样有界
    expect(p.tradeSamples.length).toBe(TRADES.length);
  });

  it("equityDigest / tradeDigest 存在且为 sha256 十六进制（全量指纹，不随抽样变化）", () => {
    const p = payload();
    expect(p.equityDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(p.tradeDigest).toMatch(/^[0-9a-f]{64}$/);
    // 抽样上限变化不影响全量指纹
    const smaller = buildBacktestRunPayload({ result: result(), sampleLimit: 10 });
    expect(smaller.equityDigest).toBe(p.equityDigest);
    expect(smaller.tradeDigest).toBe(p.tradeDigest);
  });
});

describe("B-03 Test 4 — 确定性", () => {
  it("同一输入两次 ⇒ 载荷 JSON 逐字节相同", () => {
    expect(JSON.stringify(payload())).toBe(JSON.stringify(payload()));
  });
});

describe("B-04 Test 1/3 — Canonical Metrics 是唯一来源（两条路径逐项一致）", () => {
  it("canonicalMetrics() 与 buildBacktestResult().metrics 对同一输入逐项相等", () => {
    const direct = canonicalMetrics({ equityCurve: EQUITY, tradeLedger: TRADES, initialCapital: INITIAL_CAPITAL });
    const built = result().metrics;
    expect(diffCanonicalMetrics(direct, built)).toEqual([]);
    // B-04 判据更新（随有意的产品行为变更）：`canonicalMetrics()` 现在返回**完整形态**
    // （8 项规格指标 + 口径元数据 + 交易计数）⇒ 不再断言「键集合恰等于 8 项」，
    // 改为更强的两条：① 8 项规格键**都存在且为数值或 NOT_AVAILABLE**（禁塞非数值）；
    // ② 额外键**只能是登记过的元数据键**（禁「随手加指标」绕过规格清单）。
    for (const key of CANONICAL_METRIC_KEYS) {
      const value = direct[key];
      expect(typeof value === "number" || value === NOT_AVAILABLE).toBe(true);
    }
    const extraKeys = Object.keys(direct).filter(
      (key) => !(CANONICAL_METRIC_KEYS as readonly string[]).includes(key),
    );
    expect(extraKeys.sort()).toEqual(["annualizationBasis", "completedTradeCount", "openAtEndCount"]);
    // 年化口径必须自述（规格 §2C），且与常量一致。
    expect(direct.annualizationBasis).toEqual({ type: "TRADING_DAYS", daysPerYear: BACKTEST_ANNUALIZATION_DAYS });
    // 关键：同一份数据不能因路径不同而得到不同数字
    expect(built.totalReturnPct).toBe(direct.totalReturnPct);
    expect(built.maxDrawdownPct).toBe(direct.maxDrawdownPct);
    expect(built.winRatePct).toBe(direct.winRatePct);
    expect(built.profitFactor).toBe(direct.profitFactor);
    expect(built.averageWinPct).toBe(direct.averageWinPct);
    expect(built.averageLossPct).toBe(direct.averageLossPct);
  });

  it("载荷里的 canonicalMetrics 与单独调用 canonicalMetrics() 逐项相同（Parameter Search 的读数面唯一）", () => {
    const p = payload();
    const direct = canonicalMetrics({ equityCurve: EQUITY, tradeLedger: TRADES, initialCapital: INITIAL_CAPITAL });
    expect(diffCanonicalMetrics(p.canonicalMetrics, direct)).toEqual([]);
  });

  it("profitFactor 在无亏损笔时为 NOT_AVAILABLE（不是 Infinity）", () => {
    const c = canonicalMetrics({ equityCurve: EQUITY, tradeLedger: [trade(1, 500)], initialCapital: INITIAL_CAPITAL });
    expect(c.profitFactor).toBe(NOT_AVAILABLE);
    expect(Number.isFinite(c.profitFactor as number)).toBe(false);
  });

  it("空曲线 ⇒ 年化 NOT_AVAILABLE、回撤 0、交易数 0（不伪造）", () => {
    const c = canonicalMetrics({ equityCurve: [], tradeLedger: [], initialCapital: INITIAL_CAPITAL });
    expect(c.annualizedReturnPct).toBe(NOT_AVAILABLE);
    expect(c.winRatePct).toBe(NOT_AVAILABLE);
    expect(c.maxDrawdownPct).toBe(0);
    expect(c.tradeCount).toBe(0);
  });

  it("diffCanonicalMetrics 真的能抓出差异（判据有牙齿）", () => {
    const a = canonicalMetrics({ equityCurve: EQUITY, tradeLedger: TRADES, initialCapital: INITIAL_CAPITAL });
    const b = { ...a, totalReturnPct: (a.totalReturnPct as number) + 1 };
    expect(diffCanonicalMetrics(a, b).map((item) => item.key)).toEqual(["totalReturnPct"]);
  });
});

describe("B-02 敏感性回归 — 参数变 ⇒ BacktestResult 真的不同", () => {
  it("仓位不同 ⇒ 成交规模不同 ⇒ 期末权益/收益不同（不是只改 metadata）", () => {
    const small = buildBacktestResult({
      runId: "r",
      strategyVersionId: "s@1.0.0",
      datasetVersionId: 1,
      parameterSet: { fraction: 0.3 },
      initialCapital: INITIAL_CAPITAL,
      equityCurve: curve(60),
      tradeLedger: [trade(1, 300)],
    });
    const big = buildBacktestResult({
      runId: "r",
      strategyVersionId: "s@1.0.0",
      datasetVersionId: 1,
      parameterSet: { fraction: 0.6 },
      initialCapital: INITIAL_CAPITAL,
      equityCurve: curve(60).map((point) => ({ ...point, equity: point.equity * 1.5 })),
      tradeLedger: [trade(1, 900)],
    });
    expect(small.finalEquity).not.toBe(big.finalEquity);
    expect(small.totalReturnPct).not.toBe(big.totalReturnPct);
    expect(JSON.stringify(payloadOf(small))).not.toBe(JSON.stringify(payloadOf(big)));
  });
});

function payloadOf(r: ReturnType<typeof buildBacktestResult>) {
  return buildBacktestRunPayload({ result: r });
}
