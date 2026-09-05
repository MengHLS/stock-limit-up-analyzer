/**
 * STEP 9 — Risk Engine · 测试套件。
 *
 * 覆盖规范 §六/§七/§八/§九/§十 要求的全部场景：
 *   position/cash exposure、single-stock concentration、sector exposure、
 *   gross/net exposure、drawdown、daily loss、volatility interface、
 *   risk limits、pre-trade validateOrder（PASS/REJECT + reasonCode）、
 *   post-trade calculatePortfolioRisk、determinism。
 */

import { describe, expect, it } from "vitest";
import { sampleStandardDeviation } from "../../shared/quant-stats";
import type { PortfolioSnapshot, PositionSnapshot } from "../portfolio";
import {
  DEFAULT_RISK_LIMITS,
  assertValidRiskLimits,
  calculatePortfolioRisk,
  validateOrder,
  validateRiskLimits,
  type RiskLimit,
} from "./index";

/** 构造组合快照。 */
function snap(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    date: "2026-01-05",
    cash: 100_000,
    marketValue: 0,
    equity: 100_000,
    realizedPnL: 0,
    unrealizedPnL: 0,
    fees: 0,
    tax: 0,
    exposure: 0,
    positions: [],
    ...overrides,
  };
}

/** 构造持仓快照。 */
function pos(symbol: string, quantity: number, marketValue: number, availableQuantity = quantity, sector?: string): PositionSnapshot {
  return {
    symbol,
    quantity,
    availableQuantity,
    averageCost: marketValue / quantity,
    marketPrice: marketValue / quantity,
    marketValue,
    unrealizedPnL: 0,
    realizedPnL: 0,
    sector,
  };
}

describe("Risk Engine · validateOrder（Pre-Trade）", () => {
  it("合法买入 PASS", () => {
    const r = validateOrder({
      order: { symbol: "A", side: "buy", quantity: 1000 },
      snapshot: snap(),
      limits: DEFAULT_RISK_LIMITS,
      price: 10,
    });
    expect(r.verdict).toBe("PASS");
  });

  it("合法卖出 PASS", () => {
    const r = validateOrder({
      order: { symbol: "A", side: "sell", quantity: 500 },
      snapshot: snap({ positions: [pos("A", 1000, 10_000, 1000)] }),
      limits: DEFAULT_RISK_LIMITS,
      price: 11,
    });
    expect(r.verdict).toBe("PASS");
  });

  it("INVALID_ORDER：空 symbol / 非整手 / 非正数量 / 缺价", () => {
    const base = { snapshot: snap(), limits: DEFAULT_RISK_LIMITS, price: 10 };
    expect(validateOrder({ ...base, order: { symbol: "", side: "buy", quantity: 100 } }).verdict).toBe("REJECT");
    expect(validateOrder({ ...base, order: { symbol: "A", side: "buy", quantity: 150 } }).verdict).toBe("REJECT");
    expect(validateOrder({ ...base, order: { symbol: "A", side: "buy", quantity: 0 } }).verdict).toBe("REJECT");
    expect(validateOrder({ ...base, order: { symbol: "A", side: "buy", quantity: 100 }, price: null }).verdict).toBe("REJECT");
    const results = [
      validateOrder({ ...base, order: { symbol: "", side: "buy", quantity: 100 } }),
      validateOrder({ ...base, order: { symbol: "A", side: "buy", quantity: 150 } }),
    ];
    for (const r of results) {
      if (r.verdict === "REJECT") expect(r.reasonCode).toBe("INVALID_ORDER");
    }
  });

  it("INVALID_ORDER：卖出无持仓 / T+1 可卖不足", () => {
    const noPos = validateOrder({
      order: { symbol: "A", side: "sell", quantity: 100 },
      snapshot: snap(),
      limits: DEFAULT_RISK_LIMITS,
      price: 10,
    });
    expect(noPos.verdict).toBe("REJECT");
    if (noPos.verdict === "REJECT") expect(noPos.reasonCode).toBe("INVALID_ORDER");

    const locked = validateOrder({
      order: { symbol: "A", side: "sell", quantity: 500 },
      snapshot: snap({ positions: [pos("A", 1000, 10_000, 0)] }),
      limits: DEFAULT_RISK_LIMITS,
      price: 10,
    });
    expect(locked.verdict).toBe("REJECT");
    if (locked.verdict === "REJECT") expect(locked.reasonCode).toBe("INVALID_ORDER");
  });

  it("INSUFFICIENT_CASH", () => {
    const r = validateOrder({
      order: { symbol: "A", side: "buy", quantity: 1000 },
      snapshot: snap({ cash: 1000, equity: 1000 }),
      limits: DEFAULT_RISK_LIMITS,
      price: 10,
    });
    expect(r.verdict).toBe("REJECT");
    if (r.verdict === "REJECT") expect(r.reasonCode).toBe("INSUFFICIENT_CASH");
  });

  it("MAX_POSITION：开新仓超过持仓数上限", () => {
    const r = validateOrder({
      order: { symbol: "A", side: "buy", quantity: 1000 },
      snapshot: snap({ positions: [pos("B", 1000, 10_000)] }),
      limits: { ...DEFAULT_RISK_LIMITS, maxPositions: 1 },
      price: 10,
    });
    expect(r.verdict).toBe("REJECT");
    if (r.verdict === "REJECT") expect(r.reasonCode).toBe("MAX_POSITION");
  });

  it("MAX_EXPOSURE：单一标的敞口超限", () => {
    const r = validateOrder({
      order: { symbol: "A", side: "buy", quantity: 3000 },
      snapshot: snap(),
      limits: { ...DEFAULT_RISK_LIMITS, maxPositionWeight: 0.2 },
      price: 10,
    });
    expect(r.verdict).toBe("REJECT");
    if (r.verdict === "REJECT") expect(r.reasonCode).toBe("MAX_EXPOSURE");
  });

  it("MAX_EXPOSURE：总敞口超限", () => {
    const r = validateOrder({
      order: { symbol: "A", side: "buy", quantity: 6000 },
      snapshot: snap(),
      limits: { ...DEFAULT_RISK_LIMITS, maxPositionWeight: 1, maxGrossExposure: 0.5 },
      price: 10,
    });
    expect(r.verdict).toBe("REJECT");
    if (r.verdict === "REJECT") expect(r.reasonCode).toBe("MAX_EXPOSURE");
  });

  it("MAX_EXPOSURE：行业权重超限", () => {
    const r = validateOrder({
      order: { symbol: "B", side: "buy", quantity: 1000 },
      snapshot: snap({ positions: [pos("A", 3500, 35_000, 3500, "银行")] }),
      limits: { ...DEFAULT_RISK_LIMITS, maxPositionWeight: 1, maxGrossExposure: 1, maxSectorWeight: 0.4 },
      price: 10,
      sectorOf: (s) => ({ A: "银行", B: "银行" }[s]),
    });
    expect(r.verdict).toBe("REJECT");
    if (r.verdict === "REJECT") expect(r.reasonCode).toBe("MAX_EXPOSURE");
  });

  it("RISK_LIMIT：回撤超限禁止新增风险", () => {
    const r = validateOrder({
      order: { symbol: "A", side: "buy", quantity: 100 },
      snapshot: snap(),
      limits: { ...DEFAULT_RISK_LIMITS, maxDrawdown: 0.15 },
      price: 10,
      history: { peakEquity: 120_000, previousEquity: 110_000, dailyReturns: [] },
    });
    expect(r.verdict).toBe("REJECT");
    if (r.verdict === "REJECT") expect(r.reasonCode).toBe("RISK_LIMIT");
  });

  it("RISK_LIMIT：单日亏损超限禁止新增风险", () => {
    const r = validateOrder({
      order: { symbol: "A", side: "buy", quantity: 100 },
      snapshot: snap(),
      limits: { ...DEFAULT_RISK_LIMITS, maxDailyLoss: 0.05 },
      price: 10,
      history: { peakEquity: 100_000, previousEquity: 110_000, dailyReturns: [] },
    });
    expect(r.verdict).toBe("REJECT");
    if (r.verdict === "REJECT") expect(r.reasonCode).toBe("RISK_LIMIT");
  });
});

describe("Risk Engine · calculatePortfolioRisk（Post-Trade）", () => {
  it("敞口 / 集中度 / 行业 / 回撤 / 单日亏损 / 波动率正确", () => {
    const snapshot = snap({
      cash: 50_000,
      marketValue: 50_000,
      equity: 100_000,
      positions: [pos("A", 3000, 30_000, 3000, "银行"), pos("B", 2000, 20_000, 2000, "科技")],
    });
    const dailyReturns = [0.01, -0.02, 0.015];
    const risk = calculatePortfolioRisk({
      snapshot,
      limits: DEFAULT_RISK_LIMITS,
      history: { peakEquity: 120_000, previousEquity: 110_000, dailyReturns },
    });

    expect(risk.grossExposure).toBeCloseTo(0.5, 6);
    expect(risk.netExposure).toBeCloseTo(0.5, 6);
    expect(risk.cashExposure).toBeCloseTo(0.5, 6);
    expect(risk.positionExposure).toBeCloseTo(0.5, 6);
    expect(risk.singleStockConcentration).toBeCloseTo(0.3, 6);
    expect(risk.sectorExposures).toEqual([
      { sector: "科技", marketValue: 20_000, weight: 0.2 },
      { sector: "银行", marketValue: 30_000, weight: 0.3 },
    ]);
    expect(risk.drawdown).toBeCloseTo((120_000 - 100_000) / 120_000, 6);
    expect(risk.dailyLoss).toBeCloseTo((110_000 - 100_000) / 110_000, 6);
    expect(risk.annualizedVolatility).toBeCloseTo((sampleStandardDeviation(dailyReturns) ?? 0) * Math.sqrt(252), 6);
  });

  it("行业敞口支持 sectorOf 注入（接口）", () => {
    const snapshot = snap({ positions: [pos("A", 3000, 30_000), pos("B", 2000, 20_000)] });
    const risk = calculatePortfolioRisk({
      snapshot,
      limits: DEFAULT_RISK_LIMITS,
      sectorOf: (s) => ({ A: "银行", B: "银行" }[s]),
    });
    expect(risk.sectorExposures).toEqual([{ sector: "银行", marketValue: 50_000, weight: 0.5 }]);
  });

  it("限额击穿列表正确", () => {
    const snapshot = snap({
      cash: 50_000,
      marketValue: 50_000,
      equity: 100_000,
      positions: [pos("A", 3000, 30_000, 3000, "银行"), pos("B", 2000, 20_000, 2000, "科技")],
    });
    const risk = calculatePortfolioRisk({
      snapshot,
      limits: { ...DEFAULT_RISK_LIMITS, maxPositionWeight: 0.2, maxDrawdown: 0.1 },
      history: { peakEquity: 120_000, previousEquity: 100_000, dailyReturns: [] },
    });
    const codes = risk.breaches.map((b) => b.code);
    expect(codes).toContain("maxPositionWeight");
    expect(codes).toContain("maxDrawdown");
  });

  it("无历史上下文时 drawdown/dailyLoss 为 0、波动率为 null", () => {
    const risk = calculatePortfolioRisk({ snapshot: snap(), limits: DEFAULT_RISK_LIMITS });
    expect(risk.drawdown).toBe(0);
    expect(risk.dailyLoss).toBe(0);
    expect(risk.annualizedVolatility).toBeNull();
    expect(risk.breaches).toEqual([]);
  });

  it("determinism：相同输入产生完全一致的 RiskSnapshot", () => {
    const snapshot = snap({
      cash: 50_000,
      marketValue: 50_000,
      equity: 100_000,
      positions: [pos("A", 3000, 30_000, 3000, "银行"), pos("B", 2000, 20_000, 2000, "科技")],
    });
    const history = { peakEquity: 120_000, previousEquity: 110_000, dailyReturns: [0.01, -0.02, 0.015] };
    const a = calculatePortfolioRisk({ snapshot, limits: DEFAULT_RISK_LIMITS, history });
    const b = calculatePortfolioRisk({ snapshot, limits: DEFAULT_RISK_LIMITS, history });
    expect(a).toEqual(b);
  });
});

describe("Risk Engine · RiskLimit 校验", () => {
  it("合法限额通过，非法限额被捕获", () => {
    expect(validateRiskLimits(DEFAULT_RISK_LIMITS)).toEqual([]);
    expect(validateRiskLimits({ ...DEFAULT_RISK_LIMITS, maxPositionWeight: 1.5 })).toContain("maxPositionWeight 必须在 [0,1]");
    expect(() => assertValidRiskLimits({ ...DEFAULT_RISK_LIMITS, maxDrawdown: -0.1 })).toThrow();
  });

  it("数值型限额 <= 0 表示不启用该检查（0=不限口径）", () => {
    const limits: RiskLimit = {
      maxPositions: 0,
      maxPositionWeight: 0,
      maxSectorWeight: 0,
      maxGrossExposure: 0,
      maxNetExposure: 0,
      maxDrawdown: 0,
      maxDailyLoss: 0,
    };
    const risk = calculatePortfolioRisk({
      snapshot: snap({ positions: [pos("A", 3000, 30_000)] }),
      limits,
      history: { peakEquity: 120_000, previousEquity: 110_000, dailyReturns: [] },
    });
    expect(risk.breaches).toEqual([]);
  });
});
