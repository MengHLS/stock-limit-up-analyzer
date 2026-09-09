import { describe, it, expect } from "vitest";
import {
  buildIndexMasterEntry,
  deriveIndexDateRange,
  indexDailyBarToInsert,
  indexDailyIdempotencyKey,
  indexMasterEntryToInsert,
  indexMasterIdempotencyKey,
} from "./indexStorage";
import type { IndexDailyBar, IndexMasterEntry } from "./types";

const bar = (tradeDate: string): IndexDailyBar => ({
  indexCode: "000300.SH",
  tradeDate,
  open: 1000,
  high: 1010,
  low: 990,
  close: 1005,
  amount: 123456,
  volume: 7890,
  source: "tushare",
});

describe("index_daily 解析 / 转换（bar → DB 行）", () => {
  it("indexDailyBarToInsert 字段对齐，单位不变", () => {
    const insert = indexDailyBarToInsert(bar("2026-01-05"));
    expect(insert).toEqual({
      indexCode: "000300.SH",
      tradeDate: "2026-01-05",
      open: 1000,
      high: 1010,
      low: 990,
      close: 1005,
      amount: 123456,
      volume: 7890,
      source: "tushare",
    });
  });

  it("nullable 字段透传 null（不伪造）", () => {
    const insert = indexDailyBarToInsert({ ...bar("2026-01-05"), amount: null, volume: null });
    expect(insert.amount).toBeNull();
    expect(insert.volume).toBeNull();
  });
});

describe("index_master 构建", () => {
  it("buildIndexMasterEntry 从 bars 推导 firstDate/lastDate", () => {
    const entry = buildIndexMasterEntry({
      indexCode: "000300.SH",
      indexName: "沪深300",
      provider: "tushare",
      providerCode: "000300.SH",
      bars: [bar("2026-01-06"), bar("2026-01-05")],
      source: "tushare index_daily",
      retrievedAt: "2026-09-06T00:00:00.000Z",
    });
    expect(entry.firstDate).toBe("2026-01-05");
    expect(entry.lastDate).toBe("2026-01-06");
    expect(entry.indexName).toBe("沪深300");
    expect(entry.provider).toBe("tushare");
  });

  it("空 bars → firstDate/lastDate 为 null", () => {
    const entry = buildIndexMasterEntry({
      indexCode: "000300.SH",
      indexName: "",
      provider: "sina",
      providerCode: "sh000300",
      bars: [],
      source: "sina",
    });
    expect(entry.firstDate).toBeNull();
    expect(entry.lastDate).toBeNull();
  });

  it("indexMasterEntryToInsert 将 retrievedAt ISO string 转 Date", () => {
    const entry: IndexMasterEntry = {
      indexCode: "000300.SH",
      indexName: "沪深300",
      provider: "tushare",
      providerCode: "000300.SH",
      firstDate: "2005-04-08",
      lastDate: null,
      source: "tushare index_daily",
      retrievedAt: "2026-09-06T00:00:00.000Z",
    };
    const insert = indexMasterEntryToInsert(entry);
    expect(insert.retrievedAt).toBeInstanceOf(Date);
    expect((insert.retrievedAt as Date).toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(insert.firstDate).toBe("2005-04-08");
    expect(insert.lastDate).toBeNull();
  });
});

describe("幂等键", () => {
  it("indexDailyIdempotencyKey 与 uq_index_daily_code_date 对齐", () => {
    expect(indexDailyIdempotencyKey("000300.SH", "2026-01-05")).toBe("000300.SH|2026-01-05");
  });

  it("indexMasterIdempotencyKey 与 uq_index_master_code_provider 对齐", () => {
    expect(indexMasterIdempotencyKey("000300.SH", "tushare")).toBe("000300.SH|tushare");
  });

  it("deriveIndexDateRange 返回 min/max", () => {
    expect(deriveIndexDateRange([bar("2026-01-06"), bar("2026-01-05")])).toEqual({
      firstDate: "2026-01-05",
      lastDate: "2026-01-06",
    });
  });
});
