/**
 * STEP 7.3 扩展 — BaoStock Provider 测试。
 *
 * 覆盖：代码映射、单位归一（股→手 / 元→千元）、按交易日分桶与缓存、
 * 逐票失败隔离（failedCodes / abortOnStockFailure）、progress 文件断点续跑。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BAOSTOCK_ENDPOINT,
  BaoStockMarketDataProvider,
  baostockRowToRawBar,
  toBaostockCode,
  type BaoStockDailyRow,
} from "../../../server/backfill/providerBaostock";
import { NoopRateLimiter } from "../../../server/backfill/rateLimiter";

function row(overrides: Partial<BaoStockDailyRow> = {}): BaoStockDailyRow {
  return {
    date: "2026-09-30",
    open: "9.2200",
    high: "9.4900",
    low: "9.1600",
    close: "9.4800",
    preClose: "9.1800",
    volume: "147484820",
    amount: "1386209937.3800",
    turn: "0.442800",
    tradestatus: "1",
    isST: "0",
    ...overrides,
  };
}

describe("toBaostockCode", () => {
  it("规范化代码 → BaoStock 代码", () => {
    expect(toBaostockCode("600000.SH")).toBe("sh.600000");
    expect(toBaostockCode("000001.SZ")).toBe("sz.000001");
    expect(toBaostockCode("920000.BJ")).toBe("bj.920000");
  });

  it("非法代码抛错", () => {
    expect(() => toBaostockCode("sh.600000")).toThrow();
    expect(() => toBaostockCode("600000")).toThrow();
  });
});

describe("baostockRowToRawBar", () => {
  it("价格字符串 → number，volume/amount 归一到 手/千元 并显式声明单位", () => {
    const bar = baostockRowToRawBar(row(), "600000.SH");
    expect(bar.securityCode).toBe("600000.SH");
    expect(bar.tradeDate).toBe("2026-09-30");
    expect(bar.open).toBeCloseTo(9.22, 6);
    expect(bar.high).toBeCloseTo(9.49, 6);
    expect(bar.low).toBeCloseTo(9.16, 6);
    expect(bar.close).toBeCloseTo(9.48, 6);
    expect(bar.preClose).toBeCloseTo(9.18, 6);
    expect(bar.volume).toBeCloseTo(1_474_848.2, 4);
    expect(bar.amount).toBeCloseTo(1_386_209.93738, 4);
    expect(bar.volumeUnit).toBe("hands");
    expect(bar.amountUnit).toBe("thousand-cny");
  });

  it("空字符串 / 缺失字段 → null（不静默填零，交由 validation 拒绝）", () => {
    const bar = baostockRowToRawBar(row({ preClose: "", volume: "", amount: "" }), "000001.SZ");
    expect(bar.preClose).toBeNull();
    expect(bar.volume).toBeNull();
    expect(bar.amount).toBeNull();
  });
});

describe("BaoStockMarketDataProvider", () => {
  it("逐票取数一次，按 tradeDate 分桶，多日调用命中缓存", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (code: string) => {
      calls.push(code);
      return [row({ date: "2026-09-29" }), row({ date: "2026-09-30" })];
    });
    const provider = new BaoStockMarketDataProvider({
      securityCodes: ["600000.SH", "000001.SZ"],
      startDate: "2026-09-29",
      endDate: "2026-09-30",
      fetchStockDaily: fetcher,
      rateLimiter: new NoopRateLimiter(),
      progressFilePath: null,
    });

    const d30 = await provider.fetchDailyByTradeDate("2026-09-30");
    const d29 = await provider.fetchDailyByTradeDate("2026-09-29");
    await provider.fetchDailyByTradeDate("2026-09-30");

    expect(fetcher).toHaveBeenCalledTimes(2); // 每股一次（不按天重复）
    expect(calls.slice().sort()).toEqual(["sh.600000", "sz.000001"]);
    expect(d30.rows).toHaveLength(2);
    expect(d29.rows).toHaveLength(2);
    expect(d30.provider).toBe("baostock");
    expect(d30.endpoint).toBe(BAOSTOCK_ENDPOINT);
    expect(d30.success).toBe(true);
    expect(d30.rawHash).not.toBeNull();
    expect(d30.rows.map((r) => r.volumeUnit)).toEqual(["hands", "hands"]);

    const empty = await provider.fetchDailyByTradeDate("2026-09-28");
    expect(empty.rows).toHaveLength(0);
    expect(empty.rawHash).toBeNull();
  });

  it("单票重试耗尽 → 记入 failedCodes，其余股票仍返回（默认不中断）", async () => {
    const fetcher = vi.fn(async (code: string) => {
      if (code === "sz.000001") throw new Error("网络接收错误。");
      return [row()];
    });
    const provider = new BaoStockMarketDataProvider({
      securityCodes: ["600000.SH", "000001.SZ"],
      startDate: "2026-09-30",
      endDate: "2026-09-30",
      fetchStockDaily: fetcher,
      rateLimiter: new NoopRateLimiter(),
      retryPolicy: { transientDelaysMs: [0, 0], rateLimitBackoffMs: 0, maxRateLimitRetries: 0 },
      progressFilePath: null,
      logger: { info: () => {}, warn: () => {} },
    });

    const result = await provider.fetchDailyByTradeDate("2026-09-30");
    expect(result.rows).toHaveLength(1);
    expect(provider.getFailedSecurityCodes()).toEqual(["000001.SZ"]);
    expect(provider.getCompletedSecurityCodes().has("600000.SH")).toBe(true);
  });

  it("abortOnStockFailure=true → 重试耗尽直接抛出", async () => {
    const provider = new BaoStockMarketDataProvider({
      securityCodes: ["000001.SZ"],
      startDate: "2026-09-30",
      endDate: "2026-09-30",
      fetchStockDaily: async () => {
        throw new Error("网络接收错误。");
      },
      rateLimiter: new NoopRateLimiter(),
      retryPolicy: { transientDelaysMs: [0], rateLimitBackoffMs: 0, maxRateLimitRetries: 0 },
      progressFilePath: null,
      abortOnStockFailure: true,
      logger: { info: () => {}, warn: () => {} },
    });

    await expect(provider.fetchDailyByTradeDate("2026-09-30")).rejects.toThrow(/网络/);
  });

  it("progress 文件断点续跑：同区间重启不重复请求；异区间进度被忽略", async () => {
    const dir = mkdtempSync(join(tmpdir(), "baostock-progress-"));
    const file = join(dir, "progress.jsonl");
    try {
      const first = new BaoStockMarketDataProvider({
        securityCodes: ["600000.SH"],
        startDate: "2026-09-30",
        endDate: "2026-09-30",
        fetchStockDaily: async () => [row()],
        rateLimiter: new NoopRateLimiter(),
        progressFilePath: file,
      });
      expect((await first.fetchDailyByTradeDate("2026-09-30")).rows).toHaveLength(1);
      expect(readFileSync(file, "utf8").trim().length).toBeGreaterThan(0);

      const resumedFetcher = vi.fn(async () => {
        throw new Error("resume 失败：不应再请求");
      });
      const resumed = new BaoStockMarketDataProvider({
        securityCodes: ["600000.SH"],
        startDate: "2026-09-30",
        endDate: "2026-09-30",
        fetchStockDaily: resumedFetcher,
        rateLimiter: new NoopRateLimiter(),
        progressFilePath: file,
      });
      expect((await resumed.fetchDailyByTradeDate("2026-09-30")).rows).toHaveLength(1);
      expect(resumedFetcher).not.toHaveBeenCalled();

      const otherRangeFetcher = vi.fn(async () => [row()]);
      const otherRange = new BaoStockMarketDataProvider({
        securityCodes: ["600000.SH"],
        startDate: "2026-09-29",
        endDate: "2026-09-30",
        fetchStockDaily: otherRangeFetcher,
        rateLimiter: new NoopRateLimiter(),
        progressFilePath: file,
      });
      await otherRange.fetchDailyByTradeDate("2026-09-30");
      expect(otherRangeFetcher).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});