/**
 * 交易模式：龙头候选基准（**纯执行模式**）。
 *
 * `research: null` —— 它不是一个「研究出来的模式」，而是既有的**基准配方**：
 * `leader-candidate-baseline` 是 `research/strategyPersistence` 内置策略目录与
 * `scripts/runResearchDatasetE2E.mts` 使用的策略身份，也是装配层
 * `DEFAULT_STRATEGY_RECIPE_ID` 的兜底值。它的语义是「按当日涨跌幅取前 5 名」，
 * 用来给其它模式提供参照系（而不是一个待验证的假设）。
 *
 * ## 🔴 `parameters: []` 是**刻意的**，不是漏写
 *
 * 实查（`docs/evidence/_probe_optimization_parameter_space.out.json`）显示库里两份
 * `limit-up-baseline` 文档声明了 `topN` 与 `minScore` 参数 —— 但本配方
 * **一个都不读**（`selectionConfig` 里 `topN: 5` 是硬编码常量）。
 * 也就是说那两个参数是「声明了却对计算毫无影响」的**静默无效参数**。
 *
 * 本库的纪律是「声明即生效」：既然配方不读参数，这里就不为任何参数背书。
 * 库里那两份文档的问题由实施报告如实登记（属既有数据问题，不回填、不改写）。
 * 若将来要让 `topN` 真正可搜，正确做法是**先让投影把它接进 `selectionConfig`**，
 * 再在下面加一行声明 —— 而不是先把参数写进来。
 */

import type { TradingPatternSpec } from "../types";

export const LEADER_CANDIDATE_BASELINE: TradingPatternSpec = {
  patternId: "leader-candidate-baseline",
  label: "龙头候选基准",
  purpose: "按当日涨跌幅由高到低取前 5 名 —— 所有模式对照用的基准配方。",
  whenToUse: [
    "需要一个「不做任何条件过滤」的参照系",
    "策略文档缺 recipe 时的显式兜底身份（装配层 DEFAULT_STRATEGY_RECIPE_ID）",
  ],
  research: null,
  execution: {
    signalKind: "weighted",
    recipeId: "leader-candidate-baseline",
    point: "close",
    signalFrequency: "daily",
    signalDescription: "按当日涨跌幅择优（long-only 候选研究，close 决策）",
    requiredData: ["OHLCV"],
    selectionSummary: "按当日涨跌幅由高到低取前 5 名",
    randomSeed: 7,
    weights: [{ feature: "pctChange", weight: 1 }],
    rankHigherIsBetter: true,
    topN: 5,
    parameters: [],
  },
};
