import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import { Portfolio } from "../../../../server/engine/portfolio";
import { DEFAULT_COST_MODEL } from "../../../../server/engine/execution";
import { DEFAULT_BACKTEST_EXECUTION_POLICY, mapPositionSizing } from "../../../../server/backtest/context";
import { createStrategyDocumentFromDefinition } from "../../../../server/research/strategySchema/map";
import { createStrongTrendReentryEventResolver, judgeStrongTrendReentryEvent, STRONG_TREND_REENTRY_EVENT_CODE, STRONG_TREND_REENTRY_EVENT_TYPE } from "../../../../server/strategyCore/production";
import { toCoreBarWindow } from "../../../../server/strategyCore/production";
import type { RuntimeContext } from "../../../../server/strategyCore";

function barOf(relativeDay: number, values: Partial<Pick<CanonicalMarketBar, "open" | "high" | "low" | "close" | "preClose" | "volume" | "amount">>): CanonicalMarketBar {
  return { symbol: "600001.SH", relativeDay, timestamp: "2026-01-" + String(relativeDay + 1).padStart(2, "0"), open: values.open ?? values.close ?? 10, high: values.high ?? values.close ?? 10, low: values.low ?? values.close ?? 10, close: values.close ?? 10, preClose: values.preClose ?? 9.8, volume: values.volume ?? 100_000, amount: values.amount ?? 1_000_000, turnoverRate: null, adjustment: "raw" } as unknown as CanonicalMarketBar;
}
function contextOf(bars: readonly CanonicalMarketBar[], currentRelativeDay: number): RuntimeContext {
  const window = toCoreBarWindow(bars.filter(bar => bar.relativeDay <= currentRelativeDay));
  return { timestamp: { date: bars.find(bar => bar.relativeDay === currentRelativeDay)?.timestamp ?? "2026-01-01", point: "close" }, instrument: { securityId: "600001.SH", code: "600001.SH" }, visibleData: window.universe, currentRelativeDay, state: { positionState: "FLAT", openPositions: 0 } };
}
const BASE_BARS = [barOf(0, { close: 10, high: 11, low: 9.5, preClose: 9.09 }), barOf(1, { close: 15, high: 19.9, low: 14, preClose: 10 }), barOf(2, { close: 18, high: 20, low: 5, preClose: 15 }), barOf(3, { close: 17, high: 18.2, low: 16.5, preClose: 18 }), barOf(4, { close: 18.5, high: 19, low: 17, preClose: 17 }), barOf(5, { close: 19.5, high: 20, low: 18.2, preClose: 18.5 })] as const;

describe("STRONG_TREND_REENTRY_V1 — resolver", () => {
  it("S 使用首板后首个 high >= 2 × event_close，且 Pullback 不使用 S 当天 low", () => {
    expect(judgeStrongTrendReentryEvent(contextOf(BASE_BARS, 2))).toBe(false);
    expect(judgeStrongTrendReentryEvent(contextOf(BASE_BARS, 3))).toBe(false);
    expect(judgeStrongTrendReentryEvent(contextOf(BASE_BARS, 4))).toBe(true);
  });
  it("Pullback 必须严格晚于 S；S 当天自身 low 不触发 pullback", () => {
    const bars = [barOf(0, { close: 10 }), barOf(1, { close: 15, high: 19.9, low: 1 })];
    expect(judgeStrongTrendReentryEvent(contextOf(bars, 1))).toBe(false);
  });
  it("Pullback 后只认首次 close >= S_close，后续日期不重复发事件", () => {
    const bars = [barOf(0, { close: 10 }), barOf(1, { close: 18, high: 20, low: 17 }), barOf(2, { close: 17.5, low: 17, high: 18 }), barOf(3, { close: 18.1, low: 17.2, high: 18.4 }), barOf(4, { close: 19, low: 18, high: 19.5 })];
    expect(judgeStrongTrendReentryEvent(contextOf(bars, 3))).toBe(true);
    expect(judgeStrongTrendReentryEvent(contextOf(bars, 4))).toBe(false);
  });
  it("未来 bar 进入 visibleData 时响亮拒绝（PIT）", () => {
    const bars = [barOf(0, { close: 10 }), barOf(1, { close: 18, high: 20 })];
    const futureWindow = toCoreBarWindow(bars); expect(() => judgeStrongTrendReentryEvent({ timestamp: { date: "2026-01-01", point: "close" }, instrument: { securityId: "600001.SH", code: "600001.SH" }, visibleData: futureWindow.universe, currentRelativeDay: 0, state: { positionState: "FLAT", openPositions: 0 } })).toThrowError(/未来数据/);
  });
  it("rd0 close 缺失 ⇒ UNDECIDABLE；未知 eventCode / eventType 响亮拒绝", () => {
    const broken = [barOf(0, { close: 0 }), barOf(1, { close: 18, high: 20 })];
    expect(judgeStrongTrendReentryEvent(contextOf(broken, 1))).toBe("UNDECIDABLE");
    const resolver = createStrongTrendReentryEventResolver({ eventAnchored: true, eventTypes: [STRONG_TREND_REENTRY_EVENT_TYPE], declaredBy: "test" });
    expect(() => resolver.resolve(STRONG_TREND_REENTRY_EVENT_TYPE, { eventCode: "OTHER" }, contextOf(BASE_BARS, 4))).toThrowError(/未支持 eventCode/);
    expect(() => resolver.resolve("FIRST_LIMIT_UP", { eventCode: STRONG_TREND_REENTRY_EVENT_CODE }, contextOf(BASE_BARS, 4))).toThrowError(/只接受 eventType=CUSTOM_EVENT/);
  });
});
describe("STRONG_TREND_REENTRY_V1 — execution / position contract", () => {
  const definition = { schemaVersion: "1.0", entry: { event: { type: "CUSTOM_EVENT", params: { eventCode: STRONG_TREND_REENTRY_EVENT_CODE } }, observationWindow: { start: 1, end: 79, unit: "TRADING_DAY" }, conditions: [], trigger: { type: "FIRST_VALID_DAY" } }, exit: { rules: [{ type: "TIME_EXIT", trigger: "ON_CLOSE", threshold: 20, thresholdUnit: "TRADING_DAY", priority: 1, enabled: true }] }, position: { sizingMethod: "EQUAL_WEIGHT", maxPositions: 10000, maxExposure: 1, maxSinglePosition: 1 }, risk: {}, execution: { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN", priceType: "OPEN", quantityMethod: "TARGET_WEIGHT", lotSize: 100, slippageModel: "BPS", commissionModel: "BPS", executionConstraints: ["OPEN_AT_LIMIT_UP_UNFILLED", "SUSPENDED_NEXT_OPEN_UNFILLED"] }, parameters: [], datasets: [{ datasetId: "first_limit_pullback", datasetVersion: "v8", datasetVersionId: 780001, role: "PRIMARY" }] } as const;
  it("RECLAIM close → T+1 Open，固定 20 日退出", () => {
    const document = createStrategyDocumentFromDefinition({ strategyId: "strong-trend-reentry-v1", version: "1.0.0", name: "Strong Trend Re-entry v1", strategyType: "MANUAL", universe: { universeId: "mainboard-nonst-first-limit" }, definition, executionAssumptions: { backtestConfig: { initialCapital: 100000, maxPositions: 10000 }, costModel: DEFAULT_COST_MODEL, executionModel: "NEXT_OPEN" } });
    expect(document.definition?.execution.signalTiming).toBe("T_CLOSE");
    expect(document.definition?.execution.executionTiming).toBe("T_PLUS_1_OPEN");
    expect(document.definition?.execution.priceType).toBe("OPEN");
    expect(document.definition?.exit.rules[0]?.type).toBe("TIME_EXIT");
    expect(document.definition?.exit.rules[0]?.threshold).toBe(20);
  });
  it("maxPositions=10000 是 Schema 哨兵值，不改变 EQUAL_WEIGHT 语义", () => {
    const mapping = mapPositionSizing({ sizingMethod: "EQUAL_WEIGHT", maxPositions: 10000, positionRatio: null, fixedAmount: null });
    expect(mapping.effective).toBe("EQUAL_WEIGHT_CASH_BUDGET");
    expect(mapping.note).toContain("等权现金预算");
  });
  it("重复证券 Entry 被现有 Portfolio lifecycle 拒绝；不同证券可并行", () => {
    const portfolio = new Portfolio(100000, [], { maxPositions: 10000 });
    const fill = { symbol: "600001.SH", side: "buy" as const, quantity: 100, price: 10, basePrice: 10, executedAt: "2026-01-05", fees: 0, slippageAmount: 0, amount: 1_000_000 };
    expect(portfolio.buy(fill, DEFAULT_COST_MODEL).success).toBe(true);
    const duplicate = portfolio.buy(fill, DEFAULT_COST_MODEL);
    expect(duplicate.success).toBe(false);
    expect(duplicate.reason).toContain("同一股票已有持仓");
    expect(portfolio.buy({ ...fill, symbol: "600002.SH" }, DEFAULT_COST_MODEL).success).toBe(true);
  });
  it("执行可行性对齐平台默认政策：开盘涨停不可买 / 停牌拒单 / 零成交拒单", () => {
    // 策略声明的 OPEN_AT_LIMIT_UP_UNFILLED / SUSPENDED_NEXT_OPEN_UNFILLED 由平台默认执行政策落实；
    // 具体 `LIMIT_UP` / `SUSPENDED` / `NO_LIQUIDITY` 拒单行为见
    // tests/server/research/executionConstraints/executionConstraints.test.ts 与 simulator/engine.ts。
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY.blockLimitUpBuys).toBe(true);
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY.suspensionPolicy).toBe("REJECT");
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY.zeroVolumePolicy).toBe("REJECT");
  });
});


