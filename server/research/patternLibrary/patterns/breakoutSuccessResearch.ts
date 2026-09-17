/**
 * 交易模式：突破成功率研究（**纯研究模式**）。
 *
 * 这是唯一一个同时需要四类数据能力（`path` / `outcome` / `features`）的模块 ——
 * 因为目标族含 `is_breakout`（「有没有突破」）与 `days_to_breakout`（「第几天突破」）。
 */

import type { TradingPatternSpec } from "../types";

export const BREAKOUT_SUCCESS_RESEARCH: TradingPatternSpec = {
  patternId: "breakout-success-research",
  label: "突破成功率研究",
  purpose: "检验「T+h 窗口内是否突破首板日高点」的驱动因素，以及突破之后的表现。",
  whenToUse: [
    "研究问题里出现「突破 / 新高 / 创新高 / 冲高」",
    "想回答「什么样的首板更容易再上台阶」",
  ],
  research: {
    moduleKey: "BREAKOUT_SUCCESS_RESEARCH",
    researchType: "FEATURE",
    requiredCapabilities: ["path", "outcome", "features"],
    keywords: ["突破", "新高", "冲高", "创新高", "breakout", "new high"],
    primaryKeywords: ["突破", "新高", "冲高", "创新高"],
    primaryAnalysisType: "QUANTILE",
    recommendedAnalysisTypes: ["QUANTILE", "CONDITIONAL", "STABILITY", "EVENT_STUDY", "DESCRIPTIVE"],
    targetKinds: ["is_breakout", "future_return"],
    preferredHorizons: [5, 10],
    entryEvaluations: [3],
    guardRecipes: [{ kind: "guard", floor: "low" }],
    refinementRecipes: [
      { kind: "aboveEventClose" },
      { kind: "shrinkVolume", ratio: 0.5, tag: "50" },
    ],
    controlRecipes: [],
    quantileFeatures: [
      "limit_up_premium",
      "turnover",
      "float_market_cap",
      "historical_limit_count",
      "pre_volatility_20d",
      "pre_volume_ratio_5d_20d",
    ],
    groupingDimensions: ["year", "board"],
    stabilityDimension: "year",
    conclusionTypes: ["SUPPORTED", "INCONCLUSIVE", "REJECTED"],
    minSampleCount: 100,
    primaryTargetKinds: ["is_breakout"],
    defaultPriority: "P0",
  },
  execution: null,
};
