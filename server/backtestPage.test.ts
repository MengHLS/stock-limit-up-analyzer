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
    expect(candidateSource).not.toContain("realisticConfig");
  });

  it("独立页保留参数、资金审计和完整订单表", () => {
    const pageSource = readFileSync(resolve(projectRoot, "client/src/pages/Backtest.tsx"), "utf8");

    for (const requiredText of [
      "T+1开盘预期过滤",
      "分仓策略",
      "唯一退出策略：动态止盈、止损与强势续持",
      "累计收益率",
      "下行风险评分实验框架",
      "下行风险研究参数",
      "featureMatrix",
      "riskTiers",
      "downsideRiskCurve",
      "downsideRiskResearch.experiments",
      "rollingTrainTradingDays",
      "rollingValidationTradingDays",
      "dailyPriceCoverage",
      "滚动样本外窗口",
      "低价覆盖",
      "资金与仓位审计",
      "全部模拟订单",
      "minimumExpectedOpenChangePercent",
      "oneWordLimitDownSellProbability",
      "一字跌停保守成交概率",
      "trailingProfitActivationPercent",
      "trailingDrawdownPercent",
    ]) {
      expect(pageSource).toContain(requiredText);
    }
    expect(pageSource).not.toContain("退出策略对比实验台");
    expect(pageSource).not.toContain("固定T+2收盘");
    expect(pageSource).not.toContain("exitStrategyComparison");
    expect(pageSource).not.toContain("comparisonCurve");
    expect(pageSource).not.toContain("exitStrategy:");
    const candidateSource = readFileSync(resolve(projectRoot, "client/src/pages/LeaderCandidates.tsx"), "utf8");
    const researchSource = readFileSync(resolve(projectRoot, "server/downsideRisk.ts"), "utf8");
    expect(candidateSource).not.toContain("trailingProfitActivationPercent");
    expect(candidateSource).not.toContain("trailingDrawdownPercent");
    expect(candidateSource).toContain("龙头评分");
    expect(candidateSource).toContain("下行风险");
    expect(candidateSource).toContain("风险扣分");
    expect(candidateSource).toContain("净评分");
    expect(candidateSource).toContain("龙头/风险/净评分");
    expect(candidateSource).toContain("风险分只使用每行信号日信息");
    expect(candidateSource).toContain("当日主板1–4板评分列表");
    expect(candidateSource).toContain("allScoredStocks");
    expect(candidateSource).toContain("重点候选");
    expect(researchSource).toContain("风险扣分策略");
    expect(researchSource).toContain("高风险硬过滤");
    expect(researchSource).toContain("日线成交额");
  });
});
