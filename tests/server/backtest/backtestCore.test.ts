/**
 * BACKTEST-001 — Backtest Core 纯逻辑测试（规格 §29 A/B/F/G/I/J 中**可用纯函数判定**的部分）。
 *
 * 覆盖：BacktestContext 校验 / 执行政策（含 G1 默认值翻转）/ 执行语义一致性（G3）/
 * 仓位口径映射（G2）/ OrderIntent 派生 / 权益曲线指标（年化、回撤）/ 交易指标（胜率、盈亏比）/
 * 有界载荷（§23 摘要+样本+指纹）/ 确定性。
 *
 * ⚠️ 不覆盖：真实撮合链（T+1 / 涨跌停 / 停牌 / 成本）——那些**既有测试已覆盖**
 * （`tests/server/backtest/backtest2.test.ts`、`tests/server/research/simulator/simulator.test.ts`），
 * 本轮不重复；本轮的接线改动由 tsc + 全量回归与 `executionRules` 显式传入保证。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKTEST_EXECUTION_POLICY,
  NOT_AVAILABLE,
  ORDER_INTENT_TO_SIDE,
  analyzeEquityCurve,
  assertValidBacktestContext,
  buildBacktestResult,
  buildBacktestRunPayload,
  checkExecutionSemantics,
  computeTradeMetrics,
  deriveOrderIntents,
  describeExecutionPolicy,
  mapPositionSizing,
  toExecutionRuleSet,
  type BacktestContext,
} from "../../../server/backtest";
import type { EquityPoint, Trade } from "../../../server/backtest/types";

function equityPoint(date: string, equity: number): EquityPoint {
  return { date, cash: equity, marketValue: 0, equity, openPositions: 0 };
}

function closedTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    securityId: "600001.SH",
    entryTime: "2026-09-10",
    entryPrice: 10,
    exitTime: "2026-09-15",
    exitPrice: 11,
    quantity: 1000,
    grossPnL: 1000,
    fees: 12,
    slippageAmount: 5,
    netPnl: 983,
    returnPct: 9.83,
    holdingPeriod: 5,
    openAtEnd: false,
    ...overrides,
  } as Trade;
}

function context(): BacktestContext {
  return {
    runId: "clrun-test",
    createdAt: "2026-09-19T00:00:00.000Z",
    strategyId: "cand-360004",
    strategyVersion: "1.0.0",
    datasetVersionId: 390002,
    datasetVersion: "v2",
    parameterSet: { max_volume_ratio: 0.3 },
    resolvedParameterSet: { max_volume_ratio: 0.3 },
    initialCapital: 100_000,
    currency: "CNY",
    universeId: "research-dataset:v2",
    dateRange: { startDate: "2026-01-01", endDate: "2026-09-15" },
    executionSemantics: {
      signalTiming: "T_CLOSE",
      confirmationTiming: "ON_BAR_CLOSE",
      executionTiming: "T_PLUS_1_OPEN",
      priceReference: "OPEN",
    },
    executionModel: "NEXT_OPEN",
    costModel: {
      commissionRate: 0.0003,
      stampDutyRate: 0.001,
      transferFeeRate: 0.00001,
      slippageBps: 10,
      lotSize: 100,
      minCommission: 5,
    },
    policy: DEFAULT_BACKTEST_EXECUTION_POLICY,
    maxPositions: 5,
    seed: null,
    positionSizing: { sizingMethod: "EQUAL_WEIGHT", maxPositions: 5, positionRatio: null, fixedAmount: null },
  } as unknown as BacktestContext;
}

describe("BacktestContext（§6）", () => {
  it("合法上下文通过校验", () => {
    expect(() => assertValidBacktestContext(context())).not.toThrow();
  });

  it("非法初始资金 / 起止颠倒 ⇒ 响亮抛错", () => {
    expect(() => assertValidBacktestContext({ ...context(), initialCapital: 0 })).toThrowError(/initialCapital/);
    expect(() =>
      assertValidBacktestContext({ ...context(), dateRange: { startDate: "2026-02-02", endDate: "2026-01-01" } }),
    ).toThrowError(/起止颠倒/);
  });
});

describe("G1 — 执行政策（默认值有意翻转）", () => {
  it("默认政策 = 保守口径（T+1 + 拦涨停买 + 拦跌停卖 + 拒单不顺延 + 允许部分成交 + 零成交量不可成交）", () => {
    // BACKTEST-002（B-01）：新增 `zeroVolumePolicy`（v1）。判据随之更新（产品行为有意变更，非放宽）。
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY).toEqual({
      tPlus1: true,
      blockLimitUpBuys: true,
      blockLimitDownSells: true,
      suspensionPolicy: "REJECT",
      allowPartialFill: true,
      zeroVolumePolicy: "REJECT",
    });
  });

  it("政策 → 既有 ExecutionRuleSet 只映射引擎真认的两项（不新造字段）", () => {
    const rules = toExecutionRuleSet(DEFAULT_BACKTEST_EXECUTION_POLICY);
    expect(Object.keys(rules).sort()).toEqual(["blockLimitDownSell", "blockLimitUpBuy"]);
    expect(rules.blockLimitUpBuy).toBe(true);
    expect(rules.blockLimitDownSell).toBe(true);
  });

  it("关闭拦截时说明文案必须带警告（防「静默宽松」）", () => {
    const text = describeExecutionPolicy({
      ...DEFAULT_BACKTEST_EXECUTION_POLICY,
      blockLimitUpBuys: false,
      blockLimitDownSells: false,
    }).join(" ");
    expect(text).toContain("⚠️");
  });
});

describe("G3 — 执行语义一致性", () => {
  it("文档声明的 T_CLOSE → T+1 OPEN 在支持集内", () => {
    const check = checkExecutionSemantics({
      signalTiming: "T_CLOSE",
      executionTiming: "T_PLUS_1_OPEN",
      priceReference: "OPEN",
      decisionPoint: "close",
    });
    expect(check.supported).toBe(true);
  });

  it("声明了引擎不支持的语义 ⇒ 不支持（由调用方响亮拒绝，不静默按默认跑）", () => {
    const check = checkExecutionSemantics({
      signalTiming: "T_OPEN",
      executionTiming: "T_OPEN",
      priceReference: "OPEN",
      decisionPoint: "close",
    });
    expect(check.supported).toBe(false);
    expect(check.detail).toContain("不在回测实现的支持集内");
  });

  it("决策时点不是 close ⇒ 直接不支持", () => {
    expect(
      checkExecutionSemantics({
        signalTiming: "T_CLOSE",
        executionTiming: "T_PLUS_1_OPEN",
        priceReference: "OPEN",
        decisionPoint: "open",
      }).supported,
    ).toBe(false);
  });
});

describe("G2 — 仓位口径映射（如实登记未消费者）", () => {
  it("声明 EQUAL_WEIGHT ⇒ 与引擎实际口径一致，无被忽略项", () => {
    const mapping = mapPositionSizing({ sizingMethod: "EQUAL_WEIGHT", maxPositions: 5, positionRatio: null, fixedAmount: null });
    expect(mapping.effective).toBe("EQUAL_WEIGHT_CASH_BUDGET");
    expect(mapping.ignoredDeclarations).toEqual([]);
  });

  it("声明 FIXED_RATIO + positionRatio ⇒ BACKTEST-002 起**真正生效**（不再是「不消费」）", () => {
    // BACKTEST-002（B-02）：仓位口径已接入 `plan.ts#applyPositionSizing` ⇒ 判据从「登记不消费」
    // 升级为「真实生效」。这是产品行为的有意变更，不是放宽断言。
    const mapping = mapPositionSizing({ sizingMethod: "FIXED_RATIO", maxPositions: 5, positionRatio: 0.2, fixedAmount: null });
    expect(mapping.effective).toBe("FIXED_FRACTION_OF_INITIAL_CAPITAL");
    expect(mapping.ignoredDeclarations).toEqual([]);
    expect(mapping.note).toContain("收窄每笔成交预算");
  });
});

describe("OrderIntent（§7）", () => {
  it("有入场信号 ⇒ OPEN_LONG；有出场意图 ⇒ CLOSE_LONG；方向沿用既有 Side 词表", () => {
    const intents = deriveOrderIntents({
      decisionDate: "2026-09-12",
      securityId: "600001.SH",
      entryIntentNodeIds: ["entry.trigger"],
      exitIntentNodeIds: ["exit.bearish"],
      hasEntrySignal: true,
      targetWeight: 0.2,
    });
    expect(intents.map((item) => item.kind)).toEqual(["OPEN_LONG", "CLOSE_LONG"]);
    expect(intents[0]!.targetWeight).toBe(0.2);
    expect(ORDER_INTENT_TO_SIDE.OPEN_LONG).toBe("buy");
    expect(ORDER_INTENT_TO_SIDE.CLOSE_LONG).toBe("sell");
  });

  it("无信号无意图 ⇒ 空数组（显式空，不是隐式「什么都不做」对象）", () => {
    expect(
      deriveOrderIntents({
        decisionDate: "2026-09-12",
        securityId: "600001.SH",
        entryIntentNodeIds: [],
        exitIntentNodeIds: [],
        hasEntrySignal: false,
      }),
    ).toEqual([]);
  });
});

describe("§13/§20 — 权益曲线指标（Test I 回撤）", () => {
  it("100 → 110 → 105 → 90 → 120 的最大回撤 = −18.18%（90 相对峰值 110）", () => {
    const curve = ["100", "110", "105", "90", "120"].map((value, index) =>
      equityPoint(`2026-01-0${index + 1}`, Number(value)),
    );
    const analysis = analyzeEquityCurve(curve, 100);
    // B-04 判据更新（随有意的产品行为变更）：`maxDrawdownPct` 改为**正数幅度**，
    // 与全项目既有口径一致（`performanceMetrics.analyzeDrawdown.depthPct` / calmar / engine 同）。
    // 逐点 `drawdownPct` 仍为有符号（≤ 0）的水下深度 —— 两者是不同的量，分别断言。
    expect(analysis.maxDrawdownPct).toBeCloseTo(((110 - 90) / 110) * 100, 10);
    expect(analysis.maxDrawdownPct).toBeCloseTo(18.1818181818, 8);
    expect(analysis.points[3]!.drawdownPct).toBeLessThan(0);
    expect(analysis.points[0]!.dailyReturn).toBeNull();
    expect(analysis.points[1]!.dailyReturn).toBeCloseTo(0.1, 10);
    expect(analysis.points[4]!.cumulativeReturnPct).toBeCloseTo(20, 10);
  });

  it("空曲线 ⇒ 0 回撤 + 年化 NOT_AVAILABLE（不编年化）", () => {
    const analysis = analyzeEquityCurve([], 100);
    expect(analysis.maxDrawdownPct).toBe(0);
    expect(analysis.annualizedReturnPct).toBe(NOT_AVAILABLE);
    expect(analysis.tradingDayCount).toBe(0);
  });
});

describe("§20 — 交易指标（Test B/F）", () => {
  it("胜率 / 平均盈亏 / 盈亏比；期末未平仓单独计数且不进胜率", () => {
    const trades: Trade[] = [
      closedTrade({ netPnl: 1000, returnPct: 10 }),
      closedTrade({ netPnl: -500, returnPct: -5 }),
      closedTrade({ netPnl: 500, returnPct: 5 }),
      closedTrade({ openAtEnd: true, exitTime: null, exitPrice: null, netPnl: null, returnPct: null }),
    ];
    const metrics = computeTradeMetrics(trades);
    expect(metrics.tradeCount).toBe(4);
    expect(metrics.closedCount).toBe(3);
    expect(metrics.openAtEndCount).toBe(1);
    expect(metrics.winRatePct).toBeCloseTo((2 / 3) * 100, 10);
    expect(metrics.averageWinPct).toBeCloseTo(7.5, 10);
    expect(metrics.averageLossPct).toBeCloseTo(-5, 10);
    expect(metrics.profitFactor).toBeCloseTo(1500 / 500, 10);
  });

  it("无亏损笔 ⇒ 盈亏比 NOT_AVAILABLE（不编 Infinity）", () => {
    const metrics = computeTradeMetrics([closedTrade({ netPnl: 100 })]);
    expect(metrics.profitFactor).toBe(NOT_AVAILABLE);
  });
});

describe("§19/§23 — BacktestResult 与有界载荷", () => {
  const curve = Array.from({ length: 300 }, (_, index) => equityPoint(`2026-${index}`, 100_000 + index * 10));

  it("Test A：无交易 ⇒ 期末权益 = 初始资金、交易数 0、胜率 NOT_AVAILABLE", () => {
    const flat = [equityPoint("2026-01-01", 100_000), equityPoint("2026-01-02", 100_000)];
    const result = buildBacktestResult({
      runId: "r",
      strategyVersionId: "s@1.0.0",
      datasetVersionId: 390002,
      parameterSet: {},
      initialCapital: 100_000,
      equityCurve: flat,
      tradeLedger: [],
    });
    expect(result.finalEquity).toBe(100_000);
    expect(result.totalReturnPct).toBe(0);
    expect(result.tradeCount).toBe(0);
    expect(result.winRatePct).toBe(NOT_AVAILABLE);
    expect(result.maxDrawdownPct).toBe(0);
  });

  it("Test J：同输入两次 ⇒ 载荷逐字节相同（含两个滚动指纹）", () => {
    const build = () =>
      buildBacktestRunPayload({
        result: buildBacktestResult({
          runId: "r",
          strategyVersionId: "s@1.0.0",
          datasetVersionId: 1,
          parameterSet: { a: 1 },
          initialCapital: 100_000,
          equityCurve: curve,
          tradeLedger: [closedTrade()],
        }),
        sampleLimit: 20,
      });
    const a = build();
    const b = build();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.equityDigest).toBe(b.equityDigest);
    expect(a.tradeDigest).toBe(b.tradeDigest);
  });

  it("§23：300 点曲线被抽样到 20 点且标 truncated；摘要仍含全量规模", () => {
    const payload = buildBacktestRunPayload({
      result: buildBacktestResult({
        runId: "r",
        strategyVersionId: "s@1.0.0",
        datasetVersionId: 1,
        parameterSet: {},
        initialCapital: 100_000,
        equityCurve: curve,
        tradeLedger: [],
      }),
      sampleLimit: 20,
    });
    expect(payload.equitySamples.length).toBe(20);
    expect(payload.truncated.equity).toBe(true);
    expect(payload.summary.equityPointCount).toBe(300);
    expect(payload.summary.tradingDayCount).toBe(300);
    // 首尾必含（抽样不能丢掉端点）
    expect(payload.equitySamples[0]!.date).toBe(curve[0]!.date);
    expect(payload.equitySamples[payload.equitySamples.length - 1]!.date).toBe(curve[299]!.date);
  });

  it("指纹对明细敏感（改一笔 ⇒ 指纹变）", () => {
    const build = (trade: Trade) =>
      buildBacktestRunPayload({
        result: buildBacktestResult({
          runId: "r",
          strategyVersionId: "s@1.0.0",
          datasetVersionId: 1,
          parameterSet: {},
          initialCapital: 100_000,
          equityCurve: curve,
          tradeLedger: [trade],
        }),
      });
    expect(build(closedTrade()).tradeDigest).not.toBe(build(closedTrade({ netPnl: 1 })).tradeDigest);
  });
});
