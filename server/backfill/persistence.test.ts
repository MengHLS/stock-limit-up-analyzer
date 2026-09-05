/**
 * STEP 7.3 — Persistence（bounded batch + idempotency）测试（§17 / §18 / §34.I-H）。
 */

import { describe, expect, it } from "vitest";
import {
  hasRequiredPrices,
  persistInBatches,
  rawBarToUpsert,
  toNullableText,
  toPersistableUpsert,
} from "./persistence";
import type { RawDailyBar } from "./types";

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

describe("toNullableText", () => {
  it("null/undefined/NaN → null", () => {
    expect(toNullableText(null)).toBeNull();
    expect(toNullableText(undefined)).toBeNull();
    expect(toNullableText(Number.NaN)).toBeNull();
  });
  it("有限数值 → 字符串", () => {
    expect(toNullableText(10.2)).toBe("10.2");
    expect(toNullableText(0)).toBe("0");
  });
});

describe("rawBarToUpsert", () => {
  it("映射到表写入候选行（raw 单位 手/千元）", () => {
    const row = rawBarToUpsert(raw(), "tushare");
    expect(row.openPrice).toBe("10");
    expect(row.volume).toBe("1234"); // 手，不转换
    expect(row.amount).toBe("5678"); // 千元，不转换
    expect(row.source).toBe("tushare");
  });

  it("缺失 open/close/preClose → null（由 hasRequiredPrices 过滤）", () => {
    const row = rawBarToUpsert(raw({ open: null }), "tushare");
    expect(row.openPrice).toBeNull();
    expect(hasRequiredPrices(row)).toBe(false);
  });

  it("toPersistableUpsert 窄化后非 null", () => {
    const candidate = rawBarToUpsert(raw(), "tushare");
    expect(hasRequiredPrices(candidate)).toBe(true);
    const upsert = toPersistableUpsert(candidate);
    expect(upsert.openPrice).toBe("10");
    expect(upsert.closePrice).toBe("10.2");
    expect(upsert.preClosePrice).toBe("10");
  });
});

describe("persistInBatches（有界分批）", () => {
  it("按 batchSize 分批调用 upsertFn", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => toPersistableUpsert(rawBarToUpsert(raw({ securityCode: `${i}`.padStart(6, "0") + ".SZ" }), "tushare")));
    const batchSizes: number[] = [];
    let written = 0;
    const result = await persistInBatches(rows, async (batch) => {
      batchSizes.push(batch.length);
      written += batch.length;
      return batch.length;
    }, 1000);
    expect(result.batches).toBe(3);
    expect(batchSizes).toEqual([1000, 1000, 500]);
    expect(written).toBe(2500);
  });

  it("空行 → 0 批次", async () => {
    let calls = 0;
    const result = await persistInBatches([], async () => {
      calls += 1;
      return 0;
    }, 1000);
    expect(result.batches).toBe(0);
    expect(calls).toBe(0);
  });

  it("单批失败向上抛出", async () => {
    const rows = [toPersistableUpsert(rawBarToUpsert(raw(), "tushare"))];
    await expect(
      persistInBatches(rows, async () => {
        throw new Error("DB down");
      }, 1000),
    ).rejects.toThrow("DB down");
  });
});

describe("幂等性（§17）", () => {
  it("同一 stockCode+tradeDate 重复映射产生相同候选行（由 DB 唯一约束承担最终一致性）", () => {
    const a = rawBarToUpsert(raw(), "tushare");
    const b = rawBarToUpsert(raw(), "tushare");
    expect(a.stockCode).toBe(b.stockCode);
    expect(a.tradeDate).toBe(b.tradeDate);
    expect(a.openPrice).toBe(b.openPrice);
  });
});
