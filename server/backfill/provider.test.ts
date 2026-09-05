/**
 * STEP 7.3 — Provider Adapter 测试（§5 / §34.A）。
 */

import { describe, expect, it } from "vitest";
import { TushareMarketDataProvider, computeRawHash, tusharePriceToRawBar } from "./provider";
import type { TushareDailyPrice } from "../tushare";

function tushareRow(overrides: Partial<TushareDailyPrice> = {}): TushareDailyPrice {
  return {
    stockCode: "000001.SZ",
    tradeDate: "2026-09-04",
    openPrice: 10,
    closePrice: 10.2,
    highPrice: 10.5,
    lowPrice: 9.9,
    amount: 5678,
    volume: 1234,
    preClosePrice: 10,
    ...overrides,
  };
}

describe("tusharePriceToRawBar", () => {
  it("映射到 provider-neutral RawDailyBar（保留原始单位）", () => {
    const bar = tusharePriceToRawBar(tushareRow());
    expect(bar.securityCode).toBe("000001.SZ");
    expect(bar.tradeDate).toBe("2026-09-04");
    expect(bar.volume).toBe(1234);
    expect(bar.volumeUnit).toBe("hands");
    expect(bar.amount).toBe(5678);
    expect(bar.amountUnit).toBe("thousand-cny");
  });
});

describe("computeRawHash", () => {
  it("空行 → null", () => {
    expect(computeRawHash([])).toBeNull();
  });
  it("相同内容 → 相同 hash，不同内容 → 不同 hash", () => {
    const a = computeRawHash([tusharePriceToRawBar(tushareRow())]);
    const b = computeRawHash([tusharePriceToRawBar(tushareRow())]);
    const c = computeRawHash([tusharePriceToRawBar(tushareRow({ closePrice: 11 }))]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("TushareMarketDataProvider", () => {
  it("正常响应 → success + provenance", async () => {
    const provider = new TushareMarketDataProvider(async () => [tushareRow()]);
    const result = await provider.fetchDailyByTradeDate("2026-09-04");
    expect(result.success).toBe(true);
    expect(result.provider).toBe("tushare");
    expect(result.tradeDate).toBe("2026-09-04");
    expect(result.rows).toHaveLength(1);
    expect(result.rawHash).not.toBeNull();
  });

  it("空响应 → success + 0 行 + rawHash null", async () => {
    const provider = new TushareMarketDataProvider(async () => []);
    const result = await provider.fetchDailyByTradeDate("2026-09-04");
    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(0);
    expect(result.rawHash).toBeNull();
  });

  it("fetcher 抛错 → 向上抛出（由 retry 层分类）", async () => {
    const provider = new TushareMarketDataProvider(async () => {
      throw new Error("每分钟最多访问该接口（40203）");
    });
    await expect(provider.fetchDailyByTradeDate("2026-09-04")).rejects.toThrow(/40203/);
  });
});
