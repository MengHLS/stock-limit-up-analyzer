/**
 * 交易模式：稳定性 / 市场环境研究（**纯研究模式**）。
 *
 * 它是「任何研究进入 Candidate 之前的稳定性复核」——
 * 因此 `groupingDimensions` 含 `board`、`stabilityDimension = "year"`，
 * 且只需要 `outcome` 一类能力（它不研究形态，只研究「结论在分组间是否一致」）。
 */

import type { TradingPatternSpec } from "../types";

export const MARKET_REGIME_STABILITY: TradingPatternSpec = {
  patternId: "market-regime-stability",
  label: "稳定性 / 市场环境研究",
  purpose: "检验某个结论是否只在特定年份 / 板块成立（跨期一致性），而不是全样本平均出来的假象。",
  whenToUse: [
    "研究问题里出现「稳定 / 一直有效 / 不同年份 / 不同市场 / 环境」",
    "任何研究在进入 Candidate 之前的稳定性复核",
  ],
  research: {
    moduleKey: "MARKET_REGIME_STABILITY",
    researchType: "REGIME",
    requiredCapabilities: ["outcome"],
    keywords: ["稳定", "一致性", "不同年份", "分年", "市场环境", "牛熊", "regime", "stability", "consistent"],
    primaryKeywords: ["稳定", "一致性", "不同年份", "分年", "牛熊", "市场环境"],
    primaryAnalysisType: "STABILITY",
    recommendedAnalysisTypes: ["STABILITY", "QUANTILE", "DESCRIPTIVE"],
    targetKinds: ["future_return"],
    preferredHorizons: [5, 10],
    entryEvaluations: [],
    guardRecipes: [],
    refinementRecipes: [],
    controlRecipes: [],
    quantileFeatures: ["turnover"],
    groupingDimensions: ["year", "board"],
    stabilityDimension: "year",
    conclusionTypes: ["INCONCLUSIVE", "SUPPORTED", "REJECTED"],
    minSampleCount: 100,
    primaryTargetKinds: ["future_return"],
    defaultPriority: "P0",
  },
  execution: null,
};
