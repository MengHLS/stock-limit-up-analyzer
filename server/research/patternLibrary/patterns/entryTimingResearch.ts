/**
 * 交易模式：入场时点研究（**纯研究模式**）。
 *
 * 两条条件配方是**互为对照**的一对：`T+k 收盘高于 / 低于首板日收盘` ——
 * 少了任何一条，「早买 vs 等确认」这个问题就问不出答案。
 */

import type { TradingPatternSpec } from "../types";

export const ENTRY_TIMING_RESEARCH: TradingPatternSpec = {
  patternId: "entry-timing-research",
  label: "入场时点研究",
  purpose: "检验「等 T+k 再入场」与「更早/更晚入场」相比，后续收益是否有系统性差异。",
  whenToUse: [
    "研究问题里出现「什么时候买 / 第几天买 / 确认后买 / 等几天」",
    "想回答「早买 vs 等确认」的取舍",
  ],
  research: {
    moduleKey: "ENTRY_TIMING_RESEARCH",
    researchType: "FEATURE",
    requiredCapabilities: ["post", "path", "outcome"],
    keywords: ["入场", "时点", "什么时候买", "第几天", "确认", "等", "追高", "timing", "entry", "when to buy"],
    primaryKeywords: ["入场", "什么时候买", "第几天", "追高", "等确认", "入场时点"],
    primaryAnalysisType: "CONDITIONAL",
    recommendedAnalysisTypes: ["CONDITIONAL", "EVENT_STUDY", "STABILITY", "SEGMENT_RELATION"],
    targetKinds: ["future_return", "max_drawdown"],
    preferredHorizons: [5, 10],
    entryEvaluations: [1, 2, 3, 4, 5],
    guardRecipes: [],
    refinementRecipes: [
      {
        kind: "obsDay",
        id: "above_event_close",
        label: "T+k 收盘仍高于首板日收盘",
        purpose: "「还没跌回首板日收盘」——检验强势整理是否比弱势整理更值得等。",
        field: "return_from_event_close",
        operator: ">",
        value: 0,
      },
      {
        kind: "obsDay",
        id: "below_event_close",
        label: "T+k 收盘已低于首板日收盘（对照组）",
        purpose: "对照组：已经跌回首板日收盘之下的样本后续如何走。",
        field: "return_from_event_close",
        operator: "<=",
        value: 0,
      },
    ],
    controlRecipes: [],
    quantileFeatures: ["turnover", "limit_up_premium"],
    groupingDimensions: ["year"],
    stabilityDimension: "year",
    conclusionTypes: ["SUPPORTED", "INCONCLUSIVE", "REJECTED"],
    minSampleCount: 100,
    primaryTargetKinds: ["future_return"],
    defaultPriority: "P0",
  },
  execution: null,
};
