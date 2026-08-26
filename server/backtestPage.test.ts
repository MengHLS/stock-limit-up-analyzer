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
      "autoTunePenaltyWeight",
      "自动寻优",
      "rollingTrainTradingDays: 45",
      "rollingValidationTradingDays: 14",
      "默认45日训练、14日验证",
      "10个连续无重叠样本外窗口",
      "data-ten-window-stability",
      "窗口样本外泛化稳定性",
      "风险扣分正收益窗口",
      "相对原始优胜窗口",
      "训练期选中权重分布",
      "rollingRiskStability",
      "手动回退权重",
      "选出权重",
      "训练目标",
      "trainingObjectiveValue",
      "全周期三策略收益对比",
      "data-full-cycle-comparison",
      "fullCycleRiskCurve",
      "fullCycleExperiments",
      "全周期累计收益",
      "逐笔交易差异对比",
      "data-trade-difference-table",
      "fullCycleTradeDifferences",
      "仅看有差异订单",
      "高风险过滤",
      "风险扣分策略表现归因",
      "data-risk-penalty-attribution",
      "riskPenaltyAttribution",
      "原始独有成交",
      "扣分独有成交",
      "自动 / 回退权重信号",
      "风险评分负向因子消融",
      "data-factor-ablation",
      "factorAblations",
      "样本外 Δ回撤",
      "全周期表象负向，样本外未复现",
      "当前没有在全周期与严格样本外同时复现的核心负向因子",
      "stableNegativeFactors",
      "fullCycleOnlyNegativeFactors",
      "样本外累计拼接曲线",
      "data-walk-forward",
      "walkForward.equityCurve",
      "样本外累计收益",
      "全样本原始收益（未扣风险分）",
      "样本外风险扣分收益",
      "dailyPriceCoverage",
      "data-market-factor-coverage",
      "市场因子数据覆盖",
      "marketFactorCoverage",
      "项目涨停数覆盖",
      "已验证市场数据",
      "沪深成交额覆盖",
      "两融余额覆盖",
      "Tushare daily 聚合",
      "零贡献",
      "marginBalanceComparableSampleSize",
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
    const styleSource = readFileSync(resolve(projectRoot, "client/src/index.css"), "utf8");
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
    expect(researchSource).toContain("fullCycle");
    expect(researchSource).toContain("tradeDifferences");
    expect(researchSource).toContain("hardFilterExcluded");
    expect(researchSource).toContain("riskPenaltyAttribution");
    expect(researchSource).toContain("baselineOnlyNetPnl");
    expect(researchSource).toContain("buildFactorAblations");
    expect(researchSource).toContain("riskContributions");
    expect(researchSource).toContain("相同资金、成本、仓位、入场和唯一退出约束连续回测");
    expect(researchSource).toContain("日线成交额");
    expect(researchSource).toContain("项目涨停数");
    expect(researchSource).toContain("沪深两市成交额");
    expect(researchSource).toContain("两融余额偏离");
    expect(pageSource).toContain("date >= startDate");
    expect(pageSource).toContain("downsideRiskResearch?.fullCycle.startDate");
    expect(styleSource).toContain("[data-trade-difference-table] > div:last-child");
    expect(styleSource).toContain("max-height: 42rem");
    expect(styleSource).toContain("position: sticky");
  });
});
