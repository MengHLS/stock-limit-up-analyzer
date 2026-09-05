/**
 * STEP 5 P2-3 —— backfill_high_volume 数据边界回归测试。
 *
 * 回填脚本（scripts/backfill_high_volume.ts）是生产数据写入路径，必须经过与生产同步
 * 完全相同的边界：Raw → toCanonicalBar → validateMarketBar → toValidatedStockDailyPriceUpserts → DB。
 *
 * 验收口径（§5.5）：
 *   - valid price         → 正常写入
 *   - null price          → DB = null，绝不写入 "null"
 *   - undefined price     → DB = null，绝不写入 "undefined"
 *   - invalid market bar  → 被拒绝（invalidCount / unpersistableCount 计数）
 *
 * 脚本本身会连库并执行 main()，无法在单元测试中直接运行；因此这里同时用
 * 「静态源码断言」锁定脚本不得再出现 String(price.x) 之类的静默降级。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toValidatedStockDailyPriceUpserts, type ValidatedPriceQualityIssue } from "./stockPriceSync";
import type { TushareDailyPrice } from "./tushare";

const BACKFILL_SCRIPT = resolve(import.meta.dirname, "../scripts/backfill_high_volume.ts");
const CODES = new Set(["600001.SH"]);

/** Tushare daily 接口返回的原始行形状（数字字段；缺失时可能为 null/undefined）。 */
function tushareRow(overrides: Partial<TushareDailyPrice> = {}): TushareDailyPrice {
  return {
    stockCode: "600001.SH",
    tradeDate: "2026-08-18",
    openPrice: 10,
    closePrice: 11,
    highPrice: 11.2,
    lowPrice: 9.9,
    amount: 88000,
    volume: 150000,
    preClosePrice: 10,
    ...overrides,
  };
}

describe("backfill_high_volume 数据边界（Canonical → Validation → Persist）", () => {
  it("valid price：合法行正常转换为可写入行（数值以字符串落库，非 null）", () => {
    const result = toValidatedStockDailyPriceUpserts([tushareRow()], CODES);
    expect(result.rows).toHaveLength(1);
    expect(result.invalidCount).toBe(0);
    expect(result.unpersistableCount).toBe(0);
    expect(result.qualityIssues).toHaveLength(0);
    expect(result.rows[0]).toEqual({
      stockCode: "600001.SH",
      tradeDate: "2026-08-18",
      openPrice: "10",
      closePrice: "11",
      highPrice: "11.2",
      lowPrice: "9.9",
      amount: "88000",
      volume: "150000",
      preClosePrice: "10",
      source: "tushare",
    });
  });

  it("null price：源数据为 null 时 DB 落 null，绝不产生 \"null\" 字面量", () => {
    // 可空列（high/low/amount/volume）缺失去回填正是本脚本要修的场景：原实现写 String(null)="null"。
    const result = toValidatedStockDailyPriceUpserts(
      [tushareRow({ highPrice: null as unknown as number, volume: null as unknown as number })],
      CODES,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.highPrice).toBeNull();
    expect(result.rows[0]!.volume).toBeNull();
    // 逐字段断言：任何数值列都不允许出现 "null" / "undefined" 字符串。
    for (const [key, value] of Object.entries(result.rows[0]!)) {
      if (key === "stockCode" || key === "tradeDate" || key === "source") continue;
      expect(value === null || typeof value === "string" ? value : null).not.toBe("null");
      expect(value).not.toBe("undefined");
      if (value !== null) expect(Number.isFinite(Number(value))).toBe(true);
    }
  });

  it("undefined price：源字段缺失时 DB 落 null，绝不产生 \"undefined\" 字面量", () => {
    const row = tushareRow();
    const withMissing = { ...row, lowPrice: undefined, amount: undefined } as unknown as TushareDailyPrice;
    const result = toValidatedStockDailyPriceUpserts([withMissing], CODES);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.lowPrice).toBeNull();
    expect(result.rows[0]!.amount).toBeNull();
    expect(JSON.stringify(result.rows[0])).not.toContain("undefined");
    expect(JSON.stringify(result.rows[0])).not.toContain('"null"');
  });

  it("NOT NULL 列（open/close/preClose）缺失时不可持久化，绝不静默填 0", () => {
    const missingClose = toValidatedStockDailyPriceUpserts(
      [tushareRow({ closePrice: null as unknown as number })],
      CODES,
    );
    expect(missingClose.rows).toHaveLength(0);
    expect(missingClose.unpersistableCount).toBe(1);
    const issue: ValidatedPriceQualityIssue | undefined = missingClose.qualityIssues[0];
    expect(issue?.status).toBe("UNPERSISTABLE");
    expect(issue?.codes).toContain("REQUIRED_PRICE_MISSING");
  });

  it("invalid market bar：OHLC 矛盾的行被拒绝，不进入 upsert", () => {
    const result = toValidatedStockDailyPriceUpserts([tushareRow({ highPrice: 10.8, closePrice: 11 })], CODES);
    expect(result.rows).toHaveLength(0);
    expect(result.invalidCount).toBe(1);
    expect(result.qualityIssues.some((issue) => issue.status === "INVALID" && issue.codes.includes("HIGH_LT_MAX"))).toBe(true);
  });

  it("非目标股票代码的行被过滤，不写入", () => {
    const result = toValidatedStockDailyPriceUpserts([tushareRow({ stockCode: "600999.SH" })], CODES);
    expect(result.rows).toHaveLength(0);
    expect(result.invalidCount).toBe(0);
    expect(result.unpersistableCount).toBe(0);
  });

  it("脚本源码不得再使用 String(price.x) 静默降级，必须复用生产校验入口", () => {
    const source = readFileSync(BACKFILL_SCRIPT, "utf8");
    expect(source).toContain("toValidatedStockDailyPriceUpserts");
    expect(source).not.toMatch(/String\(\s*price\./);
    expect(source).not.toMatch(/String\(\s*price\[/);
  });
});
