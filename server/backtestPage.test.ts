import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");

describe("独立组合资金回测页面", () => {
  it("注册独立路由，并从龙头候选页提供入口", () => {
    const appSource = readFileSync(resolve(projectRoot, "client/src/App.tsx"), "utf8");
    const candidateSource = readFileSync(resolve(projectRoot, "client/src/pages/LeaderCandidates.tsx"), "utf8");

    expect(appSource).toContain('path="/backtest"');
    expect(appSource).toContain('component={Backtest}');
    expect(candidateSource).toContain('href="/backtest"');
    expect(candidateSource).toContain("组合资金回测已迁移至独立页面");
  });

  it("独立页保留参数、资金审计和完整订单表", () => {
    const pageSource = readFileSync(resolve(projectRoot, "client/src/pages/Backtest.tsx"), "utf8");

    for (const requiredText of [
      "T+1开盘预期过滤",
      "分仓策略",
      "第二日卖出策略",
      "资金与仓位审计",
      "全部模拟订单",
      "minimumExpectedOpenChangePercent",
      "exitStrategy",
    ]) {
      expect(pageSource).toContain(requiredText);
    }
  });
});
