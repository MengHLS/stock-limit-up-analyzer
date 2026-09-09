import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("行情同步检查页面", () => {
  it("注册页面路由与导航入口", () => {
    const appSource = readFileSync(resolve(import.meta.dirname, "../client/src/App.tsx"), "utf8");
    const shellSource = readFileSync(resolve(import.meta.dirname, "../client/src/components/AppShell.tsx"), "utf8");
    expect(appSource).toContain("./pages/StockSync");
    expect(appSource).toContain('path="/stock-sync"');
    expect(shellSource).toContain('path: "/stock-sync"');
    expect(shellSource).toContain("行情同步");
  });

  it("展示缺失明细并提供筛选和手动同步操作", () => {
    const pageSource = readFileSync(resolve(import.meta.dirname, "../client/src/pages/StockSync.tsx"), "utf8");
    expect(pageSource).toContain("getStockSyncStatus");
    expect(pageSource).toContain("syncCandidateDailyPrices");
    expect(pageSource).toContain("syncStockPriceForDate");
    expect(pageSource).toContain("missingDates");
    expect(pageSource).toContain("全量同步");
    expect(pageSource).toContain("同步最近8个交易日");
  });
});
