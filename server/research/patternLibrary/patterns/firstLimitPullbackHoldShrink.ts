/**
 * 交易模式：首板回踩 · 守线 + 缩量（**双栖样板**）。
 *
 * 这是本库第一个「研究侧与执行侧**都由同一份声明派生**」的模式，也是 P0-2 / P0-3 的正解所在：
 *
 *   - 迁移前，研究侧的条件配方写在 `moduleRegistry.ts`（变量名 `pullback_holds_event_open_2d`），
 *     执行侧的门槛写在 `recipeRegistry.ts`（特征 `haircutFromEventLow`），两处**互不相识**
 *     ⇒「分析出的结论」转成策略时必然卡在人工翻译上。
 *   - 现在两侧写在**同一个文件**里，作者必须同时给出两者，差异一眼可见、可 review。
 *
 * ## 🔴 两侧的**语义强度差异**（必须如实登记，不得抹平）
 *
 * 「守线」这一条，两侧能表达的最强语义**不同构**：
 *   - 研究侧：`pullback_holds_event_open_{k}d == 1` —— **整个观察窗口 T+1..T+k 全程**未破位
 *     （因为研究有完整 post 数据，可以事后回看）；
 *   - 执行侧：`haircutFromEventLow <= max_drawdown` —— **决策日当日**低点相对首板开盘价的回撤
 *     （执行是逐日决策，当日收盘必须定夺，不可能等窗口走完）。
 *
 * 这不是缺陷，是**数据可得性的真实差异**；把它伪装成「等价」才是缺陷。因此：
 *   - 本文件两侧都写出来，让差异在 review 时可见；
 *   - 候选草图投影（`projectCandidateSketch.ts`）会把这条差异写进 `note`，让转正报告也带着它。
 */

import type { TradingPatternSpec } from "../types";

export const FIRST_LIMIT_PULLBACK_HOLD_SHRINK: TradingPatternSpec = {
  patternId: "first-limit-pullback-hold-shrink",
  label: "首板回踩 · 守线 + 缩量",
  purpose:
    "首板之后出现回踩，只要没跌破首板日开盘价、且量能收缩，就买入并持有 —— "
    + "赌「回踩是洗盘而不是走坏」。",
  whenToUse: [
    "研究问题里出现「回踩 / 缩量 / 不破首板开盘价 / 洗盘」",
    "想验证「等回踩再买」是否优于直接追首板",
  ],

  sketch: {
    event: "FIRST_LIMIT_UP",
    timing: "NEXT_OPEN",
    trigger: "FIRST_VALID_DAY",
    observationWindow: { start: 2, end: 2, unit: "TRADING_DAY" },
    notes: [
      "入场口径为「次一交易日开盘买入」（A 股 T+1 最常用），",
      "决策日资格窗口为 T+2 单日 —— 研究侧回看的 entryEvaluations [2,3,5] 是**可比较的观察日**，",
      "而执行只能选**一个**决策日；这里取 2（首板后回踩两日再定夺）。",
    ],
  },

  /**
   * **受控语义声明槽**（PHASE-B-001）。
   *
   * 这里声明的两个语义（守线深度 / 缩量比）在研究侧与策略侧**都由这一份声明派生**：
   *   - 研究侧 → `pat_pullback_hold_depth_2d` / `pat_pullback_shrink_ratio_2d`（观察日变量，PIT 上界 = T+2）；
   *   - 策略侧 → `haircutFromEventLow` / `volumeRatio`（可用性由 `availableFromOffset` 推导，不再恒用同点下界）。
   *
   * 🔴 `availableFromOffset` 必须等于 `windowDays`：窗口末端就是最早可见时点，
   * 声称更早可见等于把未来数据当成当时已知（注册期强校验）。
   */
  semantics: {
    version: "1.0.0",
    declarations: [
      {
        semanticId: "pullback_hold_depth",
        label: "回踩守线深度",
        definition:
          "事件后窗口 T+1..T+2 内最低价相对首板日开盘价的回撤深度："
          + "(t0Open − min(Low[T+1..T+2])) / t0Open。≤ 0 表示全程未跌破首板开盘价。",
        source: "POST_BAR",
        field: "low",
        aggregation: "MIN",
        windowDays: 2,
        availableFromOffset: 2,
        intent: {
          question: "首板后 2 个交易日内不跌破首板开盘价的样本，后续收益是否优于全样本？",
          suggestedTarget: "future_return_5d",
        },
        strategyProjection: {
          featureId: "haircutFromEventLow",
          comparison: "LTE",
          thresholdParam: "max_drawdown",
          noteAboutResearchDifference:
            "研究侧是**累积整窗** T+1..T+2 的最低价；执行侧只能看**决策日当日**低点（逐日决策，当日收盘必须定夺）。"
            + "两者不同构，不得抹平（见本文件顶部「语义强度差异」）。",
        },
      },
      {
        semanticId: "pullback_shrink_ratio",
        label: "回踩期缩量比",
        definition:
          "事件后窗口 T+1..T+2 内最小成交量 / 首板日成交量（< 1 为缩量）。",
        source: "POST_BAR",
        field: "volume",
        aggregation: "MIN",
        windowDays: 2,
        availableFromOffset: 2,
        intent: {
          question: "缩量回踩的样本，后续收益是否优于放量回踩？",
          suggestedTarget: "future_return_5d",
        },
        strategyProjection: {
          featureId: "volumeRatio",
          comparison: "LTE",
          thresholdParam: "max_volume_ratio",
        },
      },
    ],
  },

  research: {
    moduleKey: "PULLBACK_EFFECTIVENESS",
    moduleLabel: "回踩有效性研究",
    modulePurpose:
      "检验「首板之后出现回踩，只要没跌破某个支撑位，后续收益是否仍优于全样本」——"
      + "即回踩是「洗盘」还是「走坏」。",
    moduleWhenToUse: [
      "研究问题里出现「回踩 / 回调 / 洗盘 / 不破某价位 / 缩量」等表述",
      "想验证一条「等回踩再买」的入场逻辑是否真的比直接追首板好",
    ],
    researchType: "FEATURE",
    requiredCapabilities: ["post", "path", "outcome"],
    keywords: [
      "回踩", "回调", "洗盘", "不破", "未破", "破位", "支撑", "缩量", "放量",
      "pullback", "dip", "retrace",
    ],
    primaryKeywords: [
      "回踩", "回调", "洗盘", "缩量", "放量", "不破", "未破", "跌破", "守住", "生命线", "支撑位",
    ],
    primaryAnalysisType: "CONDITIONAL",
    recommendedAnalysisTypes: [
      "CONDITIONAL", "SEGMENT_RELATION", "STABILITY", "QUANTILE", "EVENT_STUDY", "DESCRIPTIVE",
    ],
    targetKinds: ["future_return", "max_drawdown", "min_return"],
    preferredHorizons: [5, 10, 20],
    entryEvaluations: [2, 3, 5],
    guardRecipes: [
      { kind: "guard", floor: "open" },
      { kind: "guard", floor: "low" },
    ],
    refinementRecipes: [
      { kind: "shrinkVolume", ratio: 0.5, tag: "50" },
      { kind: "shrinkVolume", ratio: 0.3, tag: "30" },
      { kind: "volumeExpansion" },
      { kind: "lastBullish" },
      { kind: "aboveEventClose" },
      { kind: "depthBand", offset: 0, lower: 0.98, upper: 1, tag: "shallow" },
      { kind: "depthBand", offset: 0, lower: 0.95, upper: 0.98, tag: "normal" },
      { kind: "depthBand", offset: 0, lower: null, upper: 0.95, tag: "deep" },
    ],
    controlRecipes: [
      { kind: "guardControl", floor: "open" },
      { kind: "guardControl", floor: "low" },
    ],
    quantileFeatures: ["turnover", "limit_up_premium", "market_cap", "pre_volatility_20d"],
    groupingDimensions: ["year", "board"],
    stabilityDimension: "year",
    conclusionTypes: ["SUPPORTED", "INCONCLUSIVE", "REJECTED"],
    minSampleCount: 100,
    primaryTargetKinds: ["future_return"],
    defaultPriority: "P0",
  },

  execution: {
    signalKind: "gated",
    recipeId: "first-limit-pullback-hold-shrink",
    point: "close",
    signalFrequency: "daily",
    signalDescription:
      "首板回踩守线 + 缩量（+ 红盘）：观察日未跌破首板日开盘价超过阈值、且量能相对首板日收缩到阈值以内",
    requiredData: ["OHLCV"],
    selectionSummary: "在满足「守线 + 缩量（+ 红盘）」的候选中，按相对首板日收盘的涨幅由高到低取前 N 名",
    randomSeed: 11,
    features: ["haircut", "volumeRatio", "isBullish", "momentum"],
    gates: [
      { kind: "lte", feature: "haircut", bound: { kind: "parameter", parameter: "maxDrawdown" }, label: "守线" },
      { kind: "lte", feature: "volumeRatio", bound: { kind: "parameter", parameter: "maxVolumeRatio" }, label: "缩量" },
      {
        kind: "gte",
        feature: "isBullish",
        bound: { kind: "constant", value: 1 },
        label: "红盘",
        enabledWhen: { parameter: "requireBullish", operator: "gte", value: 1 },
      },
    ],
    rankFeature: "momentum",
    rankHigherIsBetter: true,
    topN: 5,
    parameters: [
      {
        key: "maxVolumeRatio",
        name: "max_volume_ratio",
        role: "tunable",
        declaration: {
          name: "max_volume_ratio",
          type: "number",
          required: false,
          defaultValue: 0.3,
          min: 0.05,
          max: 1,
          step: 0.05,
          description: "缩量阈值：决策日量能比 ≤ 该值才成立（0.3 = 相对首板日缩到 30% 以内）。",
        },
      },
      {
        key: "maxDrawdown",
        name: "max_drawdown",
        role: "tunable",
        declaration: {
          name: "max_drawdown",
          type: "number",
          required: false,
          defaultValue: 0.02,
          min: 0,
          max: 0.3,
          step: 0.01,
          description: "守线阈值：低点相对首板日开盘价的回撤 ≤ 该值才成立（0.02 = 允许破位 2% 以内）。",
        },
      },
      {
        key: "requireBullish",
        name: "require_bullish",
        role: "tunable",
        declaration: {
          name: "require_bullish",
          type: "number",
          required: false,
          defaultValue: 0,
          min: 0,
          max: 1,
          step: 1,
          description: "是否要求决策日为阳线：1 = 要求（追加「红盘」门槛），0 = 不要求。",
        },
      },
    ],
  },
};

/**
 * 两侧语义强度差异的**如实登记**（进候选草图 note 与转正报告）。
 *
 * 写成常量而不是散落在注释里：它是**产品要展示给用户的事实**，不是给开发者看的说明。
 */
export const FIRST_LIMIT_PULLBACK_HOLD_SHRINK_NOTES: readonly string[] = [
  "「守线」两侧语义强度不同：研究侧是「截至 T+k 全程未破位」（有完整 post 数据可回看），"
    + "执行侧是「决策日当日未破位」（逐日决策当日定夺）。这是数据可得性差异，不是等价改写。",
  "「红盘」门槛仅在 require_bullish >= 1 时生效（与迁移前的 buildPullbackGates 一致）。",
];
