import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("行情同步检查页面", () => {
  it("注册页面路由与首页导航入口", () => {
    const appSource = readFileSync(resolve(import.meta.dirname, "../client/src/App.tsx"), "utf8");
    const homeSource = readFileSync(resolve(import.meta.dirname, "../client/src/pages/Home.tsx"), "utf8");
    expect(appSource).toContain("./pages/StockPriceSync");
    expect(appSource).toContain('path="/stock-price-sync"');
    expect(homeSource).toContain('href="/stock-price-sync"');
    expect(homeSource).toContain("行情检查");
  });

  it("展示缺失明细并提供筛选和手动同步操作", () => {
    const pageSource = readFileSync(resolve(import.meta.dirname, "../client/src/pages/StockPriceSync.tsx"), "utf8");
    expect(pageSource).toContain("getMissingStockPrices");
    expect(pageSource).toContain("syncMissingStockPrices");
    expect(pageSource).toContain("sync-stock-code");
    expect(pageSource).toContain("sync-signal-date");
    expect(pageSource).toContain("missingTradeDates");
    expect(pageSource).toContain("同步当前筛选");
    expect(pageSource).toContain("手动同步");
  });
});
