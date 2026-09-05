/**
 * STEP 5 P1-F1/F2 —— 生产组装点集成测试（Production Integration Test）。
 *
 * 审计结论：Feature Pipeline 此前是「孤儿代码」——只有测试文件调用 runFeaturePipeline，
 * 生产 buildStrategySignalProvider 组装点从不消费 context.features。本测试锁定修复：
 *
 *    Raw(limit_up_records + stock_daily_prices 行)
 *      → runStrategyEngineBacktest（生产组装点，strategyBacktest.ts）
 *        → buildStrategySignalProvider（真实生产 Provider）
 *          → buildFeatures(date)（真实生产 Feature 注入）
 *            → FeatureSnapshotBundle
 *              → StrategyContext.features
 *                → leader-candidate-baseline evaluate（featureMode="limit-up-confirm" 真实读取）
 *                  → Signal → RiskManager → Approved Order → Backtest Core
 *
 * 覆盖（均为断言性证据，非 mock）：
 *   1. 生产组装点真实成交：A 价格库确认涨停 → BUY → T+1 开盘成交；
 *   2. Feature 真实改变策略决策：同候选池同行情下 featureMode off=3 单 / limit-up-confirm=1 单；
 *   3. 修改 Feature 输入（价格库 B 的 D1 收盘 10.20 → 涨停 11.00，候选记录不变）→ 决策随之改变；
 *   4. 无未来数据渗漏：X 的 D2（未来）涨停 bar 不改变 D1 的 Strategy Decision；
 *   5. 确定性与隔离：相同输入两次运行结果深度相等。
 *
 * 日期：D0=2026-01-05(周一) D1=2026-01-06(周二) D2=2026-01-07(周三)。
 * 全部为主板非 ST（600xxx.SH，±10%），避免板块/ST 干扰。
 */

import { describe, expect, it } from "vitest";
import { toCanonicalBar, type RawDailyPriceRow } from "../data";
import { runFeaturePipeline } from "../features";
import { runStrategyEngineBacktest, type StrategyEngineBacktestProbe } from "./strategyBacktest";

const D0 = "2026-01-05";
const D1 = "2026-01-06";
const D2 = "2026-01-07";

const A = "600001.SH"; // 记录称 D1 涨停，价格库 D1 收盘确实涨停 → 应被确认
const B = "600002.SH"; // 记录称 D1 涨停，价格库 D1 收盘未涨停 → 应被 Feature 排除（默认）
const X = "600003.SH"; // 记录称 D1 涨停，价格库 D1 收盘未涨停、D2（未来）涨停 → 渗漏探针

/** 一档来源记录（limit_up_records 形状）。 */
function rec(stockCode: string, overrides: Partial<{ stockName: string; limitUpTime: string; sector: string; turnover: string; circulationValue: string }> = {}) {
  return {
    stockCode,
    stockName: `示例${stockCode.replace(/\.\w+$/, "")}`,
    limitUpDate: D1,
    limitUpTime: "09:45:00",
    sector: "半导体",
    turnover: "12",
    circulationValue: "80",
    ...overrides,
  };
}

/** 价格库原始行（stock_daily_prices / Tushare 数字行形状；字符串模拟 DB varchar）。 */
function row(stockCode: string, tradeDate: string, open: number, close: number, high: number, low: number, preClose: number): RawDailyPriceRow {
  return {
    stockCode,
    tradeDate,
    openPrice: String(open),
    closePrice: String(close),
    highPrice: String(high),
    lowPrice: String(low),
    preClosePrice: String(preClose),
    volume: "150000",
    amount: "88000",
  };
}

interface PriceScenario {
  /** 600001.SH D1 收盘价（默认 11.00 = 涨停）。 */
  aD1Close?: number;
  /** 600002.SH D1 收盘价（默认 10.20 = 非涨停）。 */
  bD1Close?: number;
  /** 600003.SH D2 收盘价（默认 10.60 = 非涨停；11.50 = 未来涨停）。 */
  xD2Close?: number;
}

/**
 * 生成场景价格库：
 *  - A D0 收 10.00 → D1 preClose 10.00，D1 收涨停价 11.00；
 *  - B D0 收 10.00 → D1 preClose 10.00，D1 收盘按 bD1Close（10.20 或 11.00）；
 *  - X D0 收 10.00、D1 收 10.20 → D2 preClose 10.20，D2 收盘按 xD2Close。
 */
function priceRows(scenario: PriceScenario = {}): RawDailyPriceRow[] {
  const aD1Close = scenario.aD1Close ?? 11.0; // 涨停：limitUpPrice(10,0.1)=11
  const bD1Close = scenario.bD1Close ?? 10.2; // 非涨停
  const xD2Close = scenario.xD2Close ?? 10.6; // 非涨停（默认）；11.5 为涨停
  const rows: RawDailyPriceRow[] = [
    // A：D0 平收 10.00；D1 以 11.00 收盘（触及涨停）；D2 高开回落但仍为正。
    row(A, D0, 10.0, 10.0, 10.0, 10.0, 10.0),
    row(A, D1, 10.2, aD1Close, 11.0, 10.15, 10.0),
    row(A, D2, 11.5, 11.9, 12.0, 11.4, 11.0),
    // B：D1 收盘按 bD1Close（10.2 未涨停 / 11.0 涨停）。
    row(B, D0, 10.0, 10.0, 10.0, 10.0, 10.0),
    row(B, D1, 10.05, bD1Close, Math.max(10.35, bD1Close), 10.02, 10.0),
    row(B, D2, bD1Close === 11 ? 11.4 : 10.4, bD1Close === 11 ? 11.7 : 10.6, bD1Close === 11 ? 11.9 : 10.75, 10.35, bD1Close),
    // X：D1 收 10.2（未涨停）；D2 收盘按 xD2Close（未来；11.5 触发涨停、10.6 未触发）。
    row(X, D0, 10.0, 10.0, 10.0, 10.0, 10.0),
    row(X, D1, 10.1, 10.2, 10.3, 10.05, 10.0),
    row(X, D2, 10.3, xD2Close, Math.max(10.7, xD2Close), 10.25, 10.2),
  ];
  return rows;
}

/** 默认候选记录：A/B/X 三只均在 D1 涨停（来源库口径），价格库口径只在 A 处一致。 */
function sourceRecords() {
  return [
    rec(A, { stockName: "中科蓝海", limitUpTime: "09:35:00" }),
    rec(B, { stockName: "东方华电", limitUpTime: "09:52:00" }),
    rec(X, { stockName: "天启智能", limitUpTime: "10:05:00" }),
  ];
}

/** 生产组装点调用简写。 */
function runProbe(scenario: PriceScenario, strategyConfig: Record<string, unknown>): StrategyEngineBacktestProbe {
  return runStrategyEngineBacktest({
    records: sourceRecords(),
    rawRows: priceRows(scenario),
    options: {
      strategyId: "leader-candidate-baseline",
      strategyConfig: { minScore: null, maxSignals: 10, ...strategyConfig },
      maxPositions: 5,
      requestedQuantity: 100,
      features: [{ id: "limitUpHit" }],
    },
  });
}

describe("P1-F1/F2 生产组装点集成：Feature 不再孤儿、真实流入 Strategy 决策", () => {
  it("生产 Provider 全链路真实成交：仅价格库确认涨停的 A 被买入（D1 信号 → D2 开盘成交）", () => {
    // 默认：A 涨停确认；B、X 虽在涨停候选记录中，价格库 D1 未确认涨停。
    const probe = runProbe({}, { featureMode: "limit-up-confirm" });

    // 生产组装点确实为信号日构建了 Feature（否则 featureDates 为空）。
    expect(probe.featureDates).toEqual([D1]);

    // 确认集合来自 Feature 快照：只有 A（limitUpHit=1）；B/X 因价格库未确认被跳过。
    expect(probe.confirmedSymbols).toEqual([A]);
    expect(probe.skippedSymbols.sort()).toEqual([B, X].sort());

    // 引擎级证据：只有 1 笔真实成交，即 A，T+1 开盘成交。
    expect(probe.result.metadata.strategyId).toBe("leader-candidate-baseline");
    expect(probe.result.trades).toHaveLength(1);
    expect(probe.result.trades[0]!.symbol).toBe(A);
    expect(probe.result.trades[0]!.entryTime).toBe(D2);
    expect(probe.result.trades[0]!.quantity).toBe(100);
  });

  it("Feature 真实改变策略决策：featureMode=off 3 单 vs limit-up-confirm 1 单（同候选池、同行情）", () => {
    const off = runProbe({}, { featureMode: "off" });
    const confirm = runProbe({}, { featureMode: "limit-up-confirm" });

    // off：B/X 不被 Feature 过滤 → 3 只全部 BUY 并于 D2 成交。
    expect(off.result.trades.map((t) => t.symbol).sort()).toEqual([A, B, X].sort());
    expect(off.result.trades).toHaveLength(3);

    // limit-up-confirm：Feature 过滤后仅 A 成交。
    expect(confirm.result.trades.map((t) => t.symbol)).toEqual([A]);
    expect(confirm.result.trades).toHaveLength(1);

    // 风险管道同步反映：3 条 vs 1 条 buy 裁决，均 APPROVE。
    const tracesOf = (probe: StrategyEngineBacktestProbe) =>
      (probe.result as unknown as { riskDecisions?: { decision: string; approvedQuantity: number }[] }).riskDecisions ?? [];
    expect(tracesOf(off)).toHaveLength(3);
    expect(tracesOf(confirm)).toHaveLength(1);
    expect(tracesOf(confirm)![0]!.decision).toBe("APPROVE");
    expect(tracesOf(confirm)![0]!.approvedQuantity).toBe(100);
  });

  it("修改 Feature 输入（价格库 B 收盘改为涨停）即改变策略决策：候选记录不变，B 从跳过变为纳入", () => {
    // B 的候选记录仍是「D1 涨停」，但价格库 D1 收盘由 10.20 → 11.00（真实涨停）。
    const before = runProbe({}, { featureMode: "limit-up-confirm" });
    const after = runProbe({ bD1Close: 11.0 }, { featureMode: "limit-up-confirm" });

    // Feature 集合变化：B 进入 confirmedSymbols。
    expect(before.confirmedSymbols).toEqual([A]);
    expect(after.confirmedSymbols).toEqual([A, B]);

    // 策略决策随之变化：成交从 1 单变为 2 单（A+B）。
    expect(before.result.trades).toHaveLength(1);
    expect(after.result.trades.map((t) => t.symbol).sort()).toEqual([A, B].sort());
    expect(after.result.trades).toHaveLength(2);
  });

  it("无未来数据渗漏：X 的 D2（未来）涨停不会改变 D1 的 Strategy Decision", () => {
    // X 的 D2 收盘分别取「非涨停 10.60」与「涨停 11.50」；两条数据只在 D2（未来）不同。
    const noFutureLimitUp = runProbe({ xD2Close: 10.6 }, { featureMode: "limit-up-confirm" });
    const withFutureLimitUp = runProbe({ xD2Close: 11.5 }, { featureMode: "limit-up-confirm" });

    // 两条运行中 X 的 D1 特征一致：X 始终未被 D1 确认（若 D2 渗漏进 D1，会变成已确认）。
    expect(withFutureLimitUp.confirmedSymbols).toEqual(noFutureLimitUp.confirmedSymbols);
    expect(withFutureLimitUp.skippedSymbols).toEqual(noFutureLimitUp.skippedSymbols);
    expect(withFutureLimitUp.featureDates).toEqual(noFutureLimitUp.featureDates);
    expect(withFutureLimitUp.confirmedSymbols).toEqual([A]);
    expect(withFutureLimitUp.skippedSymbols).toContain(X);

    // 引擎决策一致：成交单数与标的完全相同。
    expect(withFutureLimitUp.result.trades).toEqual(noFutureLimitUp.result.trades);
    expect(withFutureLimitUp.result.trades.map((t) => t.symbol)).toEqual([A]);
  });

  it("渗漏探针有效性：X 的 D2 bar 在 D2 视角确为涨停（证明上述断言能捕获未来渗漏）", () => {
    // 若特征管道把 D2 的 bar 误带入 D1 快照，limitUpHit(D1) 会从 0 变 1、X 被错误确认；
    // 本用例直接证明 D2 bar 确实是「会被误判为涨停」的数据。
    const barsX = priceRows({ xD2Close: 11.5 }).filter((r) => r.stockCode === X);
    const atD1 = runFeaturePipeline({
      symbol: X,
      stockName: "天启智能",
      bars: barsX.map((r) => toCanonicalBar(r)),
      decisionDate: D1,
      decisionPoint: "close",
      features: [{ id: "limitUpHit" }],
    });
    const atD2 = runFeaturePipeline({
      symbol: X,
      stockName: "天启智能",
      bars: barsX.map((r) => toCanonicalBar(r)),
      decisionDate: D2,
      decisionPoint: "close",
      features: [{ id: "limitUpHit" }],
    });

    expect(atD1.features.limitUpHit).toMatchObject({ status: "READY", value: 0 });
    expect(atD2.features.limitUpHit).toMatchObject({ status: "READY", value: 1 });
    // 两视角 asOf 正确区分，未共用快照。
    expect(atD1.asOf.decisionDate).toBe(D1);
    expect(atD2.asOf.decisionDate).toBe(D2);
  });

  it("确定性/隔离：相同输入两次运行结果深度相等（无共享可变状态、无随机）", () => {
    const first = runProbe({}, { featureMode: "limit-up-confirm" });
    const second = runProbe({}, { featureMode: "limit-up-confirm" });
    expect(second).toEqual(first);
    expect(first.result.trades).toHaveLength(1);
  });
});
