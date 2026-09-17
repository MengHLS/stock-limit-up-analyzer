/**
 * 交易模式：持有期研究（**纯研究模式**）。
 *
 * 与「入场时点」成对：一个回答「什么时候买」，一个回答「拿多久」。
 * `preferredHorizons` 覆盖 1~20 日，因为这个问题本身就是「视界之间的取舍」。
 */

import type { TradingPatternSpec } from "../types";

export const HOLDING_PERIOD_RESEARCH: TradingPatternSpec = {
  patternId: "holding-period-research",
  label: "持有期研究",
  purpose: "比较不同持有视界的收益 / 回撤，回答「持有多久性价比最高」。",
  whenToUse: [
    "研究问题里出现「持有 / 拿几天 / 多久 / 短线几天」",
    "需要在多个视界之间做取舍",
  ],
  research: {
    moduleKey: "HOLDING_PERIOD_RESEARCH",
    researchType: "EVENT_STUDY",
    requiredCapabilities: ["path", "outcome"],
    keywords: ["持有", "拿几天", "多久", "视界", "周期", "持有期", "holding", "horizon", "days to hold"],
    primaryKeywords: ["持有", "拿几天", "多久", "持有期", "几天最好"],
    primaryAnalysisType: "EVENT_STUDY",
    recommendedAnalysisTypes: ["EVENT_STUDY", "QUANTILE", "SEGMENT_RELATION", "STABILITY"],
    targetKinds: ["future_return", "max_drawdown", "min_return"],
    preferredHorizons: [1, 2, 3, 5, 10, 20],
    entryEvaluations: [],
    guardRecipes: [],
    refinementRecipes: [],
    controlRecipes: [],
    quantileFeatures: ["turnover", "limit_up_premium"],
    groupingDimensions: ["year"],
    stabilityDimension: "year",
    conclusionTypes: ["INCONCLUSIVE", "SUPPORTED"],
    minSampleCount: 100,
    primaryTargetKinds: ["future_return", "max_drawdown"],
    defaultPriority: "P0",
  },
  execution: null,
};
