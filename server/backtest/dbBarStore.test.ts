/**
 * STEP 11-FINAL-FIX — DB 版 HistoricalBarStore 纯映射测试。
 *
 * 只测无 DB 依赖的 stockDailyPriceRowToBar（varchar → number、null 保留、raw 口径），
 * DB 读写路径属 ENVIRONMENTAL（需真实库），在无库环境下跳过。
 */

import { describe, expect, it } from "vitest";
import { stockDailyPriceRowToBar, type StockDailyPriceBarFields } from "./dbBarStore";

function row(overrides: Partial<StockDailyPriceBarFields> = {}): StockDailyPriceBarFields {
  return {
    stockCode: "002361.SZ",
    tradeDate: "2026-01-05",
    openPrice: "10.00",
    closePrice: "10.50",
    highPrice: "10.80",
    lowPrice: "9.90",
    preClosePrice: "9.95",
    volume: "120000",
    amount: "125000.50",
    ...overrides,
  };
}

describe("stockDailyPriceRowToBar — varchar 行 → canonical bar", () => {
  it("正常行：各字段解析为 number，adjustment 恒为 raw", () => {
    const bar = stockDailyPriceRowToBar(row());
    expect(bar.symbol).toBe("002361.SZ");
    expect(bar.timestamp).toBe("2026-01-05");
    expect(bar.open).toBeCloseTo(10.0, 10);
    expect(bar.close).toBeCloseTo(10.5, 10);
    expect(bar.high).toBeCloseTo(10.8, 10);
    expect(bar.low).toBeCloseTo(9.9, 10);
    expect(bar.preClose).toBeCloseTo(9.95, 10);
    expect(bar.volume).toBeCloseTo(120000, 10);
    expect(bar.amount).toBeCloseTo(125000.5, 10);
    expect(bar.turnoverRate).toBeNull();
    expect(bar.adjustment).toBe("raw");
  });

  it("可空列（high/low/volume/amount）缺失 → null，不静默填零", () => {
    const bar = stockDailyPriceRowToBar(row({ highPrice: null, lowPrice: null, volume: null, amount: null }));
    expect(bar.high).toBeNull();
    expect(bar.low).toBeNull();
    expect(bar.volume).toBeNull();
    expect(bar.amount).toBeNull();
  });

  it("空串/非法数值 → null，禁止 NaN/0 伪造", () => {
    const bar = stockDailyPriceRowToBar(row({ closePrice: "", amount: "abc", volume: "0" }));
    expect(bar.close).toBeNull();
    expect(bar.amount).toBeNull();
    // "0" 是合法数值，须如实保留为 0（成交量为 0 是有效信号，不应被抹成 null）。
    expect(bar.volume).toBe(0);
  });

  it("turnoverRate 恒为 null（stock_daily_prices 不提供换手率）", () => {
    expect(stockDailyPriceRowToBar(row()).turnoverRate).toBeNull();
  });
});
