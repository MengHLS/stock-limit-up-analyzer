/**
 * 交易模式：破位 / 止损研究（**纯研究模式**）。
 *
 * 🔴 它的条件配方**只有对照组**（`guardControl`），没有守卫 —— 这不是遗漏：
 * 「破位了会怎样」这个问题本身就是对照组的问法（破位样本的后续表现）。
 * 补一个守卫进来会把研究对象从「破位样本」换成「未破位样本」，答非所问。
 */

import type { TradingPatternSpec } from "../types";

export const STOP_LOSS_RESEARCH: TradingPatternSpec = {
  patternId: "stop-loss-research",
  label: "破位 / 止损研究",
  purpose: "检验「跌破支撑位之后是否应当离场」——破位样本的后续收益与回撤代价。",
  whenToUse: [
    "研究问题里出现「止损 / 离场 / 破位 / 破了就走 / 割」",
    "想给一条入场逻辑配一个可量化的离场条件",
  ],
  research: {
    moduleKey: "STOP_LOSS_RESEARCH",
    researchType: "FEATURE",
    requiredCapabilities: ["post", "path", "outcome"],
    keywords: ["止损", "离场", "破位", "割肉", "走坏", "stop loss", "exit", "break down"],
    primaryKeywords: ["止损", "离场", "割肉", "走坏", "破位就走"],
    primaryAnalysisType: "CONDITIONAL",
    recommendedAnalysisTypes: ["CONDITIONAL", "SEGMENT_RELATION", "STABILITY"],
    targetKinds: ["future_return", "max_drawdown", "min_return"],
    preferredHorizons: [5, 10],
    entryEvaluations: [2, 3, 5],
    guardRecipes: [],
    refinementRecipes: [],
    controlRecipes: [
      { kind: "guardControl", floor: "low" },
      { kind: "guardControl", floor: "open" },
    ],
    quantileFeatures: [],
    groupingDimensions: ["year"],
    stabilityDimension: "year",
    conclusionTypes: ["SUPPORTED", "INCONCLUSIVE", "REJECTED"],
    minSampleCount: 100,
    primaryTargetKinds: ["future_return", "max_drawdown"],
    defaultPriority: "P0",
  },
  execution: null,
};
