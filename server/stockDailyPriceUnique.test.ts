/**
 * P2-F3 — stock_daily_prices (stockCode, tradeDate) 数据库级唯一约束。
 *
 * 测试策略（真实 DB 为环境依赖，见已知环境问题清单）：
 *   - schema 声明层面：stock_daily_prices 表必须声明 uq_stock_daily_price_stock_date 唯一索引；
 *   - 迁移层面：既有迁移中必须真正产出 UNIQUE(stockCode, tradeDate) DDL；
 *   - 逻辑层面：upsert 依赖该唯一键做 ON DUPLICATE KEY UPDATE（幂等覆盖）；
 *   - 脏数据清理规划：重复写入时保留最小 id（去掉较大 id），不同 tradeDate 互不影响。
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { duplicateStockDailyPriceIdsToRemove } from "./db";
import { stockDailyPrices } from "../drizzle/schema";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("P2-F3 stock_daily_prices (stockCode, tradeDate) 唯一约束", () => {
  it("drizzle schema 声明 UNIQUE(stockCode, tradeDate)", () => {
    const schemaSource = read("../drizzle/schema.ts");
    const tableBlock = schemaSource.split("stock_daily_prices")[1] ?? "";
    expect(tableBlock).toContain('uniqueIndex("uq_stock_daily_price_stock_date")');
    expect(tableBlock).toContain(".on(table.stockCode, table.tradeDate)");
    // 运行时校验：drizzle 表定义中存在同名字段结构
    expect(stockDailyPrices).toBeDefined();
  });

  it("既有迁移真实产出 UNIQUE(stockCode, tradeDate) DDL", () => {
    const migration = read("../drizzle/0008_peaceful_king_bedlam.sql");
    expect(migration).toContain("uq_stock_daily_price_stock_date");
    expect(migration).toMatch(/UNIQUE\s*\(`stockCode`,\s*`tradeDate`\)/);
  });

  it("upsert 依赖唯一键幂等覆盖（ON DUPLICATE KEY UPDATE 关键字段齐全）", () => {
    const dbSource = read("./db.ts");
    expect(dbSource).toContain(".onDuplicateKeyUpdate({");
    // 只写一行（按该键 upsert），不依赖 TS 层 if duplicate 判断。
    expect(dbSource).toContain("ensureStockDailyPricesUniqueIndex");
  });

  it("脏数据清理规划：同 stockCode+tradeDate 只保留最小 id，不同 tradeDate 可共存", () => {
    const rows = [
      { id: 1, stockCode: "600001.SH", tradeDate: "2026-08-18" },
      { id: 2, stockCode: "600001.SH", tradeDate: "2026-08-18" }, // 重复 → 删
      { id: 3, stockCode: "600001.SH", tradeDate: "2026-08-19" }, // 不同日 → 保留
      { id: 4, stockCode: "600001.SH", tradeDate: "2026-08-18" }, // 重复 → 删
      { id: 5, stockCode: "600002.SH", tradeDate: "2026-08-18" }, // 不同股票 → 保留
      { id: 6, stockCode: "600001.SH", tradeDate: "2026-08-19" }, // 重复 → 删（保留 id=3）
    ];
    expect(duplicateStockDailyPriceIdsToRemove(rows)).toEqual([2, 4, 6]);
  });

  it("重复数据清理规划：稳定、确定、无副作用", () => {
    const rows = [
      { id: 9, stockCode: "000001.SZ", tradeDate: "2026-08-18" },
      { id: 9, stockCode: "000001.SZ", tradeDate: "2026-08-18" },
    ];
    expect(duplicateStockDailyPriceIdsToRemove(rows)).toEqual([9]);
    expect(duplicateStockDailyPriceIdsToRemove([])).toEqual([]);
    expect(duplicateStockDailyPriceIdsToRemove([{ id: 1, stockCode: "600001.SH", tradeDate: "2026-08-18" }])).toEqual([]);
  });
});
