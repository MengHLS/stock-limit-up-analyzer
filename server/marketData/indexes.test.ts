import { describe, it, expect } from "vitest";
import {
  assertUniqueIndexDaily,
  mapIndexCode,
  normalizeIndexCode,
  sortIndexDaily,
  verifyIndexIdentity,
  CORE_INDEX_IDENTITY,
} from "./indexes";
import type { IndexDailyBar, IndexMasterEntry } from "./types";

describe("index mapping（代码规范化）", () => {
  it("裸 6 位 000300 → 000300.SH", () => {
    expect(normalizeIndexCode("000300")).toBe("000300.SH");
  });
  it("sina 前缀 sh000300 → 000300.SH", () => {
    expect(normalizeIndexCode("sh000300")).toBe("000300.SH");
  });
  it("已带后缀 000300.SH → 幂等", () => {
    expect(normalizeIndexCode("000300.SH")).toBe("000300.SH");
  });
  it("深证指数 399006 → 399006.SZ", () => {
    expect(normalizeIndexCode("399006")).toBe("399006.SZ");
  });
  it("中证500 000905 → 000905.SH（指数段 ≠ 股票段 0→SZ）", () => {
    expect(normalizeIndexCode("000905")).toBe("000905.SH");
  });
  it("mapIndexCode 复用 normalizeIndexCode", () => {
    expect(mapIndexCode("sz399001")).toBe("399001.SZ");
  });
  it("无法识别 → 抛错", () => {
    expect(() => normalizeIndexCode("123456")).toThrow(/无法推断/);
  });
  it("非法输入 → 抛错", () => {
    expect(() => normalizeIndexCode("abc")).toThrow(/无效指数代码/);
  });
});

describe("index identity 校验", () => {
  function entry(overrides: Partial<IndexMasterEntry> = {}): IndexMasterEntry {
    return {
      indexCode: "000300.SH",
      indexName: "沪深300",
      provider: "sina",
      providerCode: "sh000300",
      firstDate: "2005-04-08",
      lastDate: "2026-09-05",
      source: "sina",
      retrievedAt: "2026-09-06T00:00:00.000Z",
      ...overrides,
    };
  }

  it("身份一致 → PASS", () => {
    expect(verifyIndexIdentity(entry()).verdict).toBe("PASS");
  });

  it("名称不符 → CONCERN", () => {
    const result = verifyIndexIdentity(entry({ indexName: "沪深300指数(错误名)" }));
    expect(result.verdict).toBe("CONCERN");
    expect(result.issues.some((issue) => issue.code === "NAME_MISMATCH")).toBe(true);
  });

  it("数据早于官方发布日（Sina 000300 自 2002 起）→ CONCERN", () => {
    const result = verifyIndexIdentity(entry({ firstDate: "2002-01-04" }));
    expect(result.verdict).toBe("CONCERN");
    expect(result.issues.some((issue) => issue.code === "DATA_BEFORE_LAUNCH")).toBe(true);
  });

  it("数据早于基期 → CONCERN（强烈身份疑点）", () => {
    const result = verifyIndexIdentity(entry({ firstDate: "2000-01-01" }));
    expect(result.issues.some((issue) => issue.code === "DATA_BEFORE_BASE")).toBe(true);
  });

  it("未知指数 → BLOCKED", () => {
    const result = verifyIndexIdentity(entry({ indexCode: "999999.SH", indexName: "未知指数" }));
    expect(result.verdict).toBe("BLOCKED");
    expect(result.issues.some((issue) => issue.code === "UNKNOWN_INDEX_IDENTITY")).toBe(true);
  });

  it("核心指数参考表包含 6 只目标指数", () => {
    for (const code of ["000001.SH", "399001.SZ", "399006.SZ", "000300.SH", "000905.SH", "000852.SH"]) {
      expect(CORE_INDEX_IDENTITY[code]).toBeDefined();
    }
  });
});

describe("index duplicate / missing", () => {
  const bar = (tradeDate: string): IndexDailyBar => ({
    indexCode: "000300.SH",
    tradeDate,
    open: 1000,
    high: 1000,
    low: 1000,
    close: 1000,
    amount: null,
    volume: null,
    source: "sina",
  });

  it("assertUniqueIndexDaily 检出重复", () => {
    expect(() => assertUniqueIndexDaily([bar("2026-01-05"), bar("2026-01-05")])).toThrow(/重复/);
  });

  it("assertUniqueIndexDaily 对无重复不抛错", () => {
    expect(() => assertUniqueIndexDaily([bar("2026-01-05"), bar("2026-01-06")])).not.toThrow();
  });

  it("sortIndexDaily 按日期升序", () => {
    const sorted = sortIndexDaily([bar("2026-01-06"), bar("2026-01-05")]);
    expect(sorted.map((b) => b.tradeDate)).toEqual(["2026-01-05", "2026-01-06"]);
  });
});
