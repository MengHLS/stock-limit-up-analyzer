/**
 * STEP 7.3 — Keyset Pagination 测试（§21 / §32 / §34.J）。
 *
 * 用 100k+ 模拟行验证：keyset 分页逐页 yield、内存有界（不一次性物化全量）、
 * 游标单调前进不重不漏、空页终止。
 */

import { describe, expect, it } from "vitest";
import {
  compareStockDailyPriceKey,
  isAfterStockDailyPriceCursor,
  iterateKeysetPages,
  nextStockDailyPriceCursor,
} from "./pagination";

interface Key {
  tradeDate: string;
  stockCode: string;
}

function generateKeys(count: number): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = Math.floor(i / 5000); // 每 5000 行换一天
    const date = `2026-01-${String((day % 28) + 1).padStart(2, "0")}`;
    keys.push({ tradeDate: date, stockCode: `${i % 100000}`.padStart(6, "0") + ".SZ" });
  }
  // 按 (tradeDate, stockCode) 排序
  return keys.sort((a, b) => compareStockDailyPriceKey(a, b));
}

describe("compareStockDailyPriceKey", () => {
  it("先按 tradeDate 再按 stockCode", () => {
    expect(compareStockDailyPriceKey({ tradeDate: "2026-01-01", stockCode: "A" }, { tradeDate: "2026-01-02", stockCode: "A" })).toBeLessThan(0);
    expect(compareStockDailyPriceKey({ tradeDate: "2026-01-01", stockCode: "A" }, { tradeDate: "2026-01-01", stockCode: "B" })).toBeLessThan(0);
    expect(compareStockDailyPriceKey({ tradeDate: "2026-01-01", stockCode: "B" }, { tradeDate: "2026-01-01", stockCode: "B" })).toBe(0);
  });
});

describe("isAfterStockDailyPriceCursor", () => {
  it("null 游标 → 全通过", () => {
    expect(isAfterStockDailyPriceCursor({ tradeDate: "2026-01-01", stockCode: "A" }, null)).toBe(true);
  });
  it("严格大于语义", () => {
    const cursor = { tradeDate: "2026-01-02", stockCode: "000001.SZ" };
    expect(isAfterStockDailyPriceCursor({ tradeDate: "2026-01-03", stockCode: "000001.SZ" }, cursor)).toBe(true);
    expect(isAfterStockDailyPriceCursor({ tradeDate: "2026-01-02", stockCode: "000002.SZ" }, cursor)).toBe(true);
    expect(isAfterStockDailyPriceCursor({ tradeDate: "2026-01-02", stockCode: "000001.SZ" }, cursor)).toBe(false);
    expect(isAfterStockDailyPriceCursor({ tradeDate: "2026-01-01", stockCode: "999999.SZ" }, cursor)).toBe(false);
  });
});

describe("nextStockDailyPriceCursor", () => {
  it("页非空 → 最后一行的 key", () => {
    const cursor = nextStockDailyPriceCursor([{ tradeDate: "2026-01-01", stockCode: "A" }, { tradeDate: "2026-01-01", stockCode: "B" }], null);
    expect(cursor).toEqual({ tradeDate: "2026-01-01", stockCode: "B" });
  });
  it("页空 → 返回原游标", () => {
    const current = { tradeDate: "2026-01-01", stockCode: "B" };
    expect(nextStockDailyPriceCursor([], current)).toEqual(current);
  });
});

describe("iterateKeysetPages（100k+ 模拟行，内存有界）", () => {
  it("分页完整、不重不漏、每页 <= batchSize", async () => {
    const total = 100_000;
    const keys = generateKeys(total);

    let fetchedPages = 0;
    const seen: string[] = [];
    const batchSize = 10_000;

    const iterator = iterateKeysetPages<Key>(async (cursor, limit) => {
      fetchedPages += 1;
      const filtered = cursor ? keys.filter((k) => isAfterStockDailyPriceCursor(k, cursor)) : keys;
      return filtered.slice(0, limit);
    }, batchSize);

    for await (const page of iterator) {
      expect(page.length).toBeLessThanOrEqual(batchSize);
      seen.push(...page.map((k) => `${k.tradeDate}|${k.stockCode}`));
    }

    // 10 页非空 + 1 次空页探测 = 11 次 fetchPage 调用。
    expect(fetchedPages).toBe(Math.ceil(total / batchSize) + 1);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total); // 无重复
  });

  it("空数据 → 立即终止", async () => {
    let calls = 0;
    const iterator = iterateKeysetPages<Key>(async () => {
      calls += 1;
      return [];
    }, 1000);
    const collected: Key[][] = [];
    for await (const page of iterator) collected.push(page);
    expect(collected).toHaveLength(0);
    expect(calls).toBe(1);
  });

  it("游标未前进（防死循环）→ 有限页后终止", async () => {
    let calls = 0;
    const iterator = iterateKeysetPages<Key>(async () => {
      calls += 1;
      // 永远返回同一行，游标不前进（病态 fetchPage）
      return [{ tradeDate: "2026-01-01", stockCode: "A" }];
    }, 1000);
    const collected: Key[][] = [];
    for await (const page of iterator) collected.push(page);
    // 关键断言：迭代终止（未死循环）。病态 fetchPage 下最多 yield 2 页即检测到游标未前进。
    expect(collected.length).toBeLessThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(3);
  });
});
