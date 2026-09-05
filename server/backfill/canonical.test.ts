/**
 * STEP 7.3 — Canonical Mapper 测试（§7 / §6）。
 */

import { describe, expect, it } from "vitest";
import { mapRawToCanonical, mapRawToCanonicalBatch, type CanonicalizationContext } from "./canonical";
import type { RawDailyBar } from "./types";

const ctx: CanonicalizationContext = {
  source: "tushare",
  sourceVersion: "daily-v1",
  retrievedAt: "2026-09-06T00:00:00.000Z",
  rawHash: "abc123",
};

function raw(overrides: Partial<RawDailyBar> = {}): RawDailyBar {
  return {
    securityCode: "000001.SZ",
    tradeDate: "2026-09-04",
    open: 10,
    high: 10.5,
    low: 9.9,
    close: 10.2,
    preClose: 10,
    volume: 1234,
    amount: 5678,
    volumeUnit: "hands",
    amountUnit: "thousand-cny",
    ...overrides,
  };
}

describe("mapRawToCanonical", () => {
  it("字段重命名映射", () => {
    const bar = mapRawToCanonical(raw(), ctx);
    expect(bar.securityCode).toBe("000001.SZ");
    expect(bar.tradeDate).toBe("2026-09-04");
    expect(bar.openPrice).toBe(10);
    expect(bar.highPrice).toBe(10.5);
    expect(bar.lowPrice).toBe(9.9);
    expect(bar.closePrice).toBe(10.2);
    expect(bar.preClosePrice).toBe(10);
  });

  it("单位转换：volume 手→shares、amount 千元→CNY", () => {
    const bar = mapRawToCanonical(raw({ volume: 1234, amount: 5678 }), ctx);
    expect(bar.volume).toBe(123400);
    expect(bar.amount).toBe(5_678_000);
  });

  it("shares/cny 单位原样保留（不二次换算）", () => {
    const bar = mapRawToCanonical(raw({ volumeUnit: "shares", amountUnit: "cny", volume: 500, amount: 1000 }), ctx);
    expect(bar.volume).toBe(500);
    expect(bar.amount).toBe(1000);
  });

  it("provenance 挂载", () => {
    const bar = mapRawToCanonical(raw(), ctx);
    expect(bar.source).toBe("tushare");
    expect(bar.sourceVersion).toBe("daily-v1");
    expect(bar.retrievedAt).toBe("2026-09-06T00:00:00.000Z");
    expect(bar.rawHash).toBe("abc123");
    expect(bar.adjustment).toBe("raw");
  });

  it("null 数值保持 null（不静默填零）", () => {
    const bar = mapRawToCanonical(raw({ high: null, volume: null, amount: null }), ctx);
    expect(bar.highPrice).toBeNull();
    expect(bar.volume).toBeNull();
    expect(bar.amount).toBeNull();
  });

  it("批量映射保持输入顺序", () => {
    const bars = mapRawToCanonicalBatch([raw({ securityCode: "A.SH" }), raw({ securityCode: "B.SZ" })], ctx);
    expect(bars.map((b) => b.securityCode)).toEqual(["A.SH", "B.SZ"]);
  });
});
