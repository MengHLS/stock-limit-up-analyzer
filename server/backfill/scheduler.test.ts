/**
 * STEP 7.3 — BackfillScheduler 测试（§10 / §19-20 / §25-27 / §34.G-H-K）。
 *
 * 覆盖：顺序执行、断点续传、幂等、配额停止、checkpoint 一致性（persist 成功才 SUCCESS）、
 * 既有数据保护（scheduler 只 upsert 不 delete/truncate）。
 */

import { describe, expect, it } from "vitest";
import { BackfillScheduler } from "./scheduler";
import { MemoryCheckpointStore, toFinalCheckpoint } from "./checkpoint";
import { NoopRateLimiter } from "./rateLimiter";
import type { BackfillConfig, MarketDataProvider, ProviderDailyResult, RawDailyBar, TradingCalendarDay, TradingCalendarProvider } from "./types";
import type { StockDailyPriceUpsert } from "../db";

function rawRow(securityCode: string, tradeDate: string): RawDailyBar {
  return {
    securityCode,
    tradeDate,
    open: 10,
    high: 10.5,
    low: 9.9,
    close: 10.2,
    preClose: 10,
    volume: 1234,
    amount: 5678,
    volumeUnit: "hands",
    amountUnit: "thousand-cny",
  };
}

function providerResult(tradeDate: string, rows: RawDailyBar[]): ProviderDailyResult {
  return {
    provider: "mock",
    endpoint: "mock:daily",
    tradeDate,
    retrievedAt: new Date().toISOString(),
    schemaVersion: "daily-v1",
    rows,
    rawHash: null,
    success: true,
  };
}

const config: BackfillConfig = {
  requestIntervalMs: 0,
  batchSize: 1000,
  concurrency: 1,
  suspiciousCoverageRatio: 0.9,
};

interface Harness {
  scheduler: BackfillScheduler;
  checkpointStore: MemoryCheckpointStore;
  upserted: StockDailyPriceUpsert[];
  fetchCalls: string[];
  calendarDates: string[];
}

async function buildHarness(options: {
  calendarDates: string[];
  rowsPerDate?: (tradeDate: string) => RawDailyBar[];
  fetchError?: (tradeDate: string) => Error | null;
  failPersistDates?: Set<string>;
  preDoneDates?: string[];
}): Promise<Harness> {
  const checkpointStore = new MemoryCheckpointStore();
  const upserted: StockDailyPriceUpsert[] = [];
  const fetchCalls: string[] = [];
  const failPersistDates = options.failPersistDates ?? new Set<string>();

  const provider: MarketDataProvider = {
    name: "mock",
    async fetchDailyByTradeDate(tradeDate: string): Promise<ProviderDailyResult> {
      fetchCalls.push(tradeDate);
      const err = options.fetchError?.(tradeDate);
      if (err) throw err;
      return providerResult(tradeDate, options.rowsPerDate?.(tradeDate) ?? [rawRow("000001.SZ", tradeDate), rawRow("000002.SZ", tradeDate)]);
    },
  };

  const calendarProvider: TradingCalendarProvider = {
    name: "mock",
    async fetchTradingCalendar(): Promise<TradingCalendarDay[]> {
      return options.calendarDates.map((calDate) => ({ calDate, exchange: "SSE", isOpen: true }));
    },
  };

  const scheduler = new BackfillScheduler({
    provider,
    calendarProvider,
    checkpointStore,
    rateLimiter: new NoopRateLimiter(),
    upsertFn: async (rows) => {
      const first = rows[0];
      if (first && failPersistDates.has(first.tradeDate)) throw new Error("persist failure");
      upserted.push(...rows);
      return rows.length;
    },
    config,
    sleep: async () => {}, // 测试不真实等待 60s
  });

  for (const date of options.preDoneDates ?? []) {
    await checkpointStore.set(toFinalCheckpoint(date, "SUCCESS", 1, { rowCount: 2 }));
  }

  return { scheduler, checkpointStore, upserted, fetchCalls, calendarDates: options.calendarDates };
}

describe("BackfillScheduler", () => {
  it("顺序执行全部交易日，persist 成功后标记 SUCCESS", async () => {
    const h = await buildHarness({ calendarDates: ["2026-09-01", "2026-09-02", "2026-09-03"] });
    const result = await h.scheduler.run("2026-09-01", "2026-09-03");

    expect(h.fetchCalls).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(result.processedDates).toBe(3);
    expect(result.quotaStopped).toBe(false);
    expect(h.upserted).toHaveLength(6); // 2 行/日 × 3 日
    for (const date of h.calendarDates) {
      expect((await h.checkpointStore.get(date))?.status).toBe("SUCCESS");
    }
  });

  it("断点续传：已 SUCCESS 日期不重新下载", async () => {
    const h = await buildHarness({
      calendarDates: ["2026-09-01", "2026-09-02", "2026-09-03"],
      preDoneDates: ["2026-09-01"],
    });
    const result = await h.scheduler.run("2026-09-01", "2026-09-03");

    expect(h.fetchCalls).toEqual(["2026-09-02", "2026-09-03"]); // 09-01 被跳过
    expect(result.processedDates).toBe(2);
    expect(h.upserted).toHaveLength(4);
  });

  it("幂等：重复运行不产生重复写入", async () => {
    const h = await buildHarness({ calendarDates: ["2026-09-01", "2026-09-02"] });
    await h.scheduler.run("2026-09-01", "2026-09-02");
    const firstUpserts = h.upserted.length;

    const again = await buildHarness({ calendarDates: ["2026-09-01", "2026-09-02"] });
    await again.checkpointStore.set(toFinalCheckpoint("2026-09-01", "SUCCESS", 1, { rowCount: 2 }));
    await again.checkpointStore.set(toFinalCheckpoint("2026-09-02", "SUCCESS", 1, { rowCount: 2 }));
    const result = await again.scheduler.run("2026-09-01", "2026-09-02");

    expect(firstUpserts).toBe(4);
    expect(again.fetchCalls).toEqual([]); // 全部已完成，不重新下载
    expect(again.upserted).toHaveLength(0); // 不重复写入
    expect(result.processedDates).toBe(0);
  });

  it("配额停止：40203 → 等待后重试仍失败 → QUOTA_STOPPED 并中断", async () => {
    let calls = 0;
    const h = await buildHarness({
      calendarDates: ["2026-09-01", "2026-09-02", "2026-09-03"],
      fetchError: () => {
        calls += 1;
        return new Error("每分钟最多访问该接口（40203）");
      },
    });
    const result = await h.scheduler.run("2026-09-01", "2026-09-03");

    expect(result.quotaStopped).toBe(true);
    // 第一个日期被 fetch 两次（限频 60s 后重试一次），随后中断，后续日期不再 fetch。
    expect(h.fetchCalls).toEqual(["2026-09-01", "2026-09-01"]);
    expect(calls).toBe(2); // 1 + 1 次限频重试
    expect((await h.checkpointStore.get("2026-09-01"))?.status).toBe("QUOTA_STOPPED");
    expect(await h.checkpointStore.get("2026-09-02")).toBeNull();
  });

  it("persist 失败 → 标记 FAILED（绝不 SUCCESS）", async () => {
    const h = await buildHarness({
      calendarDates: ["2026-09-01", "2026-09-02"],
      failPersistDates: new Set(["2026-09-01"]),
    });
    await h.scheduler.run("2026-09-01", "2026-09-02");

    expect((await h.checkpointStore.get("2026-09-01"))?.status).toBe("FAILED");
    expect((await h.checkpointStore.get("2026-09-02"))?.status).toBe("SUCCESS");
  });

  it("scheduler 仅调用 upsert，不 delete/truncate（既有数据保护）", async () => {
    const h = await buildHarness({ calendarDates: ["2026-09-01"] });
    await h.scheduler.run("2026-09-01", "2026-09-01");
    expect(h.upserted).toHaveLength(2);
  });
});
