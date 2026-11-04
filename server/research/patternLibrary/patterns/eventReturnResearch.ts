/**
 * 交易模式：事件后收益研究（**纯研究模式**）。
 *
 * `execution: null` 是一个**被声明的结论** —— 这个模式目前只有研究侧形态，
 * 还没有可执行的配方。它刻画「首板事件本身」之后的收益分布，为其它研究提供参照系。
 */

import type { TradingPatternSpec } from "../types";

export const EVENT_RETURN_RESEARCH: TradingPatternSpec = {
  patternId: "event-return-research",
  label: "事件后收益研究",
  purpose: "刻画「首板事件本身」之后不同视界的收益分布与基准水平，为其它研究提供参照系。",
  whenToUse: [
    "研究问题是开放式的「首板之后会怎样」",
    "需要先拿到全样本基准，才能判断某个条件下的样本是否真的更好",
  ],
  research: {
    moduleKey: "EVENT_RETURN_RESEARCH",
    researchType: "EVENT_STUDY",
    requiredCapabilities: ["path", "outcome"],
    keywords: ["收益", "涨幅", "基准", "全样本", "分布", "表现", "return", "baseline", "event study"],
    primaryKeywords: [],
    primaryAnalysisType: "EVENT_STUDY",
    recommendedAnalysisTypes: ["EVENT_STUDY", "DESCRIPTIVE", "STABILITY", "QUANTILE"],
    targetKinds: ["future_return", "max_drawdown", "min_return"],
    preferredHorizons: [5, 10, 20],
    entryEvaluations: [],
    guardRecipes: [],
    refinementRecipes: [],
    controlRecipes: [],
    quantileFeatures: ["turnover", "limit_up_premium", "historical_limit_count"],
    groupingDimensions: ["year"],
    stabilityDimension: "year",
    conclusionTypes: ["INCONCLUSIVE", "SUPPORTED"],
    minSampleCount: 100,
    primaryTargetKinds: ["future_return"],
    defaultPriority: "P0",
  },
  execution: null,
};
