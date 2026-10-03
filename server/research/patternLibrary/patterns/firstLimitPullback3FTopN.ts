/**
 * 交易模式：首板回踩 · 3F 综合评分 TopN（**纯执行模式**，N = 3 / 5）。
 *
 * ## 这个模式在赌什么
 *
 * 首板之后第 5 个交易日（T+5）收盘，用 **3F 合成分**给当日候选打分并降序排名，只买排名前 N 名，
 * **次一交易日开盘**（T+6）成交；候选评分只负责买入，不触发卖出。退出由
 * `STOP_LOSS = 5%`、`TRAILING_TAKE_PROFIT = 峰值盈利后回撤 5%` 与
 * `TIME_EXIT = 持有满 5 个交易日` 共同决定。
 *
 * 3F = `maxAmplitude`(LOW) + `meanAmplitude`(LOW) + `t1VolumeRatio`(HIGH)，等权各 1/3，
 * 口径**零复制**沿用冻结契约 `FROZEN-BUCKET-CONTRACT-001` 的唯一落地处
 * （`research-experiments/first-board-pullback/twelve-factor-composite-study/result.ts`，
 * 经 `recipeFeatures/threeFactorScoreFeatures.ts` 桥到执行侧）。
 *
 * ## 观察窗口 = `[5, 15]`，它在架构里承担**两件不同的事**
 *
 * ### ① 决策日资格（语义面）：起点 `start = 5` 是 PIT 闸门
 *
 * 3F 的三个因子用到 T+1..T+5 五根 bar，因此 **T+5 收盘是「3F 首次可算」的最早时点**，
 * 早于此日不得评估（禁未来数据）。`start = 5` 就是这条闸门。
 *
 * ### ② 执行面板深度（机械面）：末端 `end` 决定**退出订单能不能有行情**
 *
 * 🔴 直读桥按策略声明的窗口投影行情：面板 = `rd 0` 与 `rd ∈ [1, end+1]`
 * （`datasetFromRegistry.ts` 的 `neededMaxRelativeDay = window.end + 1`），
 * 而卖出订单的 `executionTime` 固定是**下一交易日**（NEXT_OPEN），成交前置条件是
 * 「**执行日在数据集里有该证券的行**」（`simulator/engine.ts` 第 9(c) 步）。
 * ⚠️ 无行 ⇒ 该日卖单拒单 `SUSPENDED`；强制退出会在后续决策日重新生成卖单。若面板内一直没有
 * 该证券的真实行情，仓位会保持到期末，以 `openAtEnd` 计入权益，而不是伪造一笔收盘价成交。
 *
 * ⇒ **`end` 不只是「看几天」，它是「允许退出发生在多久之内」**：退出订单在次一交易日执行，
 * 还可能因 T+1 冻结（`FROZEN_EXIT_DEFERRED`）与跌停（`LIMIT_DOWN`）顺延；若执行日没有该证券
 * 行情，当日订单只会被拒 `SUSPENDED`，不会用前一日收盘价伪造成交。若面板内始终没有后续行情，
 * 持仓必须如实以 `openAtEnd` 收尾（期末估值），不能改写成完成的已实现交易。
 *
 * `end = 15`（面板到 `rd = 16`）是此前实测覆盖「正常退出 + 冻结/跌停顺延」最远路径的最小取值；
 * 2026-09-27 删除「面板末日清算」伪成交后，旧窗口对比表中的完成卖出/期末持仓数字已失效，
 * 必须随下一次全量回测重新产出，不能继续作为当前口径结论引用。
 *
 * ⚠️ 代价：面板行数 ∝ `end + 2` 行/事件 ⇒ v5（73,003 事件）在 `end = 15` 下需约 124 万行，
 * 已超过直读桥护栏的原值 400,000（护栏已于 2026-09-26 提高到 1,400,000，理由见
 * `datasetFromRegistry.ts` 的 `REGISTRY_BRIDGE_MAX_ROWS` 注释）。
 *
 * ⚠️ 「窗口加宽不改变入选集合」已实测：执行面板以 `eventId` 隔离同一证券的多个首板事件，
 * Core 的 `firesToday = satisfiedToday && !satisfiedBefore`（语义 = 「每个事件的首个成立日」）
 * ⇒ 每个事件只在 T+5 出一次信号，同一证券的后续首板事件仍会独立进入判定。
 * 实测 `[5,5]` / `[5,9]` / `[5,15]` 三档的 **信号数、入选数完全相同**（761 / 100），
 * 窗口只改评估量与面板深度 —— 所以把 `end` 放大到 15 是**零口径代价**的纯机械调整。
 *
 * ### 🔴 实现该窗口需要一条**恒真条件哨兵**（架构限制，非口径选择）
 *
 * 适配器 `strategyCore/adapters/legacyDefinition.ts:356` 在 **enabled 条件为空时直接丢弃
 * WINDOW 节点**，规则图退化为 `SEQUENCE[EVENT, TRIGGER]`；而 TRIGGER 的候选日取自 WINDOW
 * 写入的 journal（`ruleGraph.ts:437`：无 journal ⇒ `allValidDays = [currentDay]`），
 * 于是 `NEXT_TRADING_DAY` 的 `currentDay === last + 1` **恒不成立** ⇒ 策略**零信号且不报错**。
 * 因此策略文档必须放一条**恒真**条件（本策略用 `bar.close > 0`）让窗口真正进入规则图；
 * 它不改变入选集合（字段缺失/非有限时如实判不成立，不臆造）。
 *
 * ## 退出与持有期
 *
 * 本模式显式声明 `candidateExitPolicy = DISABLED`：Core 每个事件仍只出一次买入信号，
 * 但该信号不再被解释为「次日不入选即卖」。持仓只在以下三种情况下退出：
 *
 * 1. 盘中相对建仓成本亏损达到 5%；
 * 2. 持仓期峰值收益转正后，从最高收盘价回撤达到 5%；
 * 3. 持有满 5 个交易日的收盘时间上限。
 *
 * 因此执行持有期与研究侧 `T+6 开盘 → T+10 收盘` 的 5 个交易日窗口一致；执行日仍按
 * `NEXT_OPEN`，时间退出会在第 5 个持有交易日后的下一交易日开盘成交。
 *
 * ⚠️ **「执行日无行情」必须按真实成交处理（2026-09-27 修正）**：跌停连板/停牌会把执行日推出
 * 面板时，旧实现以当日收盘价强制清算，制造了一笔实际不可成交的卖出。该伪成交已删除：无行情
 * 只登记 `SUSPENDED`，后续有真实行情才可成交；面板内始终无行情则 `openAtEnd`，不把停牌/缺数据
 * 变成已实现收益。加宽窗口只能降低这种边界发生的频率，不能替代真实可成交性。
 *
 * ## 为什么是 `gated` + 空 `gates`，而不是 `weighted`
 *
 * `gated` 的语义是「硬门槛全过才产信号，信号值 = 排序特征」；空 `gates` 是官方支持语义
 * （退化为「只要排序特征可用即入选」）。本模式**没有**任何硬门槛 —— 入选条件就是
 * 「3F 合成分可算」，所以空门槛正是它要的语义，且排序值直接等于合成分。
 * `weighted` 支的排序值走 `Σ wᵢ·fᵢ`，要让合成分成为排序键就得再写一遍「合成分」作为权重面
 * ⇒ 会在 Core 里出现**第二套 3F 口径**，与本项目的「禁第二套口径」纪律冲突。
 *
 * ## 🔴 为什么登记成**两个**模式（N3 / N5）而不是一个带 `topN` 参数的模式
 *
 * `topN` 在投影层是**静态**的（`project.ts` 把它写进 `selectionConfig.method.n = execution.topN`），
 * 不参与运行期参数解析（`makeStrategyRecipeRuntime` 只让 `buildGates` 吃参数）。
 * 因此「N 不同」在当前架构下只能表达为**两个配方 id**。见库内既有先例：
 * `PatternParameterKey` 里的 `topN` 至今没有任何消费者 —— 本模式不去伪造一个
 * 「声明了却不生效」的 `topN` 参数（那是本项目明令禁止的静默无效面）。
 *
 * ## `parameters: []` 是刻意的
 *
 * 本模式的全部口径（因子集合、方向、桶边界、合成分公式、N、窗口、退出）都在声明里**固定**，
 * 没有留给 Parameter Search 的维度 ⇒ 不声明任何参数。声明一个不被读取的参数 = 假的可搜索性。
 */

import type { PatternFeatureKey, TradingPatternSpec } from "../types";

/**
 * 观察窗口（相对首板日的**交易日**偏移）：`[5, 15]`。
 *
 * - `start = 5`：3F 首次可算日（PIT 闸门，**唯一有语义的那一端**）；
 * - `end = 15`：纯**机械**取值 —— 决定直读桥执行面板的深度（面板 `rd ∈ [0, end+1]`）。
 *   三档窗口的入选集合完全相同（Core 只在首个成立日出信号），但窗口越深，退出（含 T+1
 *   冻结与跌停顺延）越有机会落在面板内；面板内始终无真实行情时仍按 `openAtEnd` 如实收尾。
 *   详见文件头“执行面板深度”说明；2026-09-27 删除伪清算后，窗口对比结果需重新回测。
 */
export const THREE_FACTOR_TOPN_OBSERVATION_WINDOW = {
  start: 5,
  end: 15,
  unit: "TRADING_DAY",
} as const;

/** 时间退出阈值（交易日）：持有期上限。 */
export const THREE_FACTOR_TOPN_MAX_HOLDING_DAYS = 5;

/** 盘中固定比例止损：相对建仓成本亏 5% 时卖出全部可卖份额。 */
export const THREE_FACTOR_TOPN_STOP_LOSS_RATIO = 0.05;

/** 盈利回撤止盈：峰值一进入盈利即启动；从最高收盘价回撤达到该比例时退出。 */
export const THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO = 0.05;

interface ThreeFactorTopNPatternOptions {
  /**
   * true = 保留「首板回踩」资格门槛（观察窗内必须出现收盘低于首板日收盘价）；
   * false = 1.13.0 变体，移除该门槛，让纯上升路径也进入 3F 横截面排序。
   */
  readonly requirePullback: boolean;
  /** 配方 id 后缀；用于在同一策略族下区分不同执行口径。 */
  readonly recipeIdSuffix?: string;
}

/** 3F TopN 模式的声明（N 参数化；`topN` 必须 > 0）。 */
function makeThreeFactorTopNPattern(
  topN: number,
  options: ThreeFactorTopNPatternOptions,
): TradingPatternSpec {
  if (!Number.isInteger(topN) || topN <= 0) {
    throw new Error(`3F TopN 模式：topN 必须是正整数，实际 ${String(topN)}。`);
  }
  const recipeId =
    `first-limit-pullback-3f-top${topN}${options.recipeIdSuffix ?? ""}`;
  const rankFeature: PatternFeatureKey = options.requirePullback
    ? "threeFactorComposite"
    : "threeFactorCompositeNoPullbackGate";
  return {
    patternId: recipeId,
    label:
      `首板${options.requirePullback ? "回踩" : ""} · 3F 综合评分 Top${topN}`
      + (options.requirePullback ? "" : "（无回踩门槛）"),
    purpose:
      `首板后第 5 个交易日收盘，按 3F 等权合成分（双振幅 LOW + T+1 量比 HIGH）降序排名，`
      + `只买前 ${topN} 名并于次日开盘成交，赌「3F 高分候选的后续收益优于同池平均」。`
      + (options.requirePullback
        ? ""
        : "该变体移除「观察窗内必须出现收盘回踩」的候选资格门槛。"),
    whenToUse: [
      "要把「3F 综合评分降序取 TopN」落成可回测的完整策略（评分→排名→入选→交易）",
      "检验 3F 排名信号在**真实撮合**（含 T+1 冻结、整手、佣金/印花税/滑点、涨跌停）下是否仍成立",
    ],

    sketch: {
      event: "FIRST_LIMIT_UP",
      timing: "NEXT_OPEN",
      // 窗口首个有效日 = rd 5 = 实际决策日（Core 对每个事件只在此日出信号），声明与实际行为一致。
      trigger: "FIRST_VALID_DAY",
      observationWindow: { ...THREE_FACTOR_TOPN_OBSERVATION_WINDOW },
      notes: [
        "决策日 = 首板后第 5 个交易日（T+5）；T+5 是 3F 首次可算日（PIT，禁未来数据）。",
        "买入时点 = 决策日的次一交易日开盘（T+6）；决策点固定为收盘（point=close）。",
        `退出 = 「盘中亏损达 ${(THREE_FACTOR_TOPN_STOP_LOSS_RATIO * 100).toFixed(0)}%（止损）」、「盈利峰值回撤 ${(THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO * 100).toFixed(0)}%（回撤止盈）」与「持有满 ${THREE_FACTOR_TOPN_MAX_HOLDING_DAYS} 个交易日（时间退出）」先到者；候选评分只控制买入。`,
        "窗口末端 end=15 是**执行面板深度**的声明（面板 rd ≤ end+1），不是「观察多久」：它决定冻结/跌停后的退出能否遇到真实行情。执行日无行只记 SUSPENDED；面板内始终无行情则按 openAtEnd 估值，禁止用前一日收盘价伪造成交。",
        "面板按 eventId 保留同一证券的多个事件序列；Core 对每个事件只出一次信号 ⇒ 加宽窗口不改变该事件入选集合，只增评估量与面板深度。",
        "策略文档必须带一条恒真条件哨兵（bar.close > 0）才能让窗口进入规则图，否则零信号且不报错（见文件头）。",
        ...(options.requirePullback
          ? []
          : [
              "本变体移除「观察窗 T+1..T+5 内必须出现收盘价低于首板日收盘价」的候选资格门槛；"
              + "没有回踩、但 3F 三因子可算的事件也会进入横截面排序。",
            ]),
      ],
    },

    // 纯执行模式：3F 的研究侧结论早已由平台协议 Run 产出（见 docs/research/RESULT-OOS-COMPOSITE-3F-001.md），
    // 本模式不重复因子实验，只承载「把它落成策略」这一件事。
    research: null,

    execution: {
      signalKind: "gated",
      recipeId,
      point: "close",
      signalFrequency: "daily",
      signalDescription:
        `首板回踩 3F 等权合成分（maxAmplitude / meanAmplitude 取 LOW，t1VolumeRatio 取 HIGH，`
        + `桶位分各 1/3）—— 无硬门槛，合成分可算即入选，横截面按合成分降序取前 ${topN} 名`,
      requiredData: ["OHLCV"],
      selectionSummary:
        `按 3F 合成分由高到低取前 ${topN} 名（同值按 securityId 破平，破平只影响边界名次）`,
      randomSeed: 23,
      features: [rankFeature],
      // 空门槛 = 官方支持语义「只要排序特征可用即入选」。本模式无硬门槛。
      gates: [],
      rankFeature,
      rankHigherIsBetter: true,
      topN,
      parameters: [],
    },
  };
}

/** 交易压缩实验（TRADE-COMPRESSION-001）：3F 综合评分 TopN（N = 1）。其余口径与 N3 逐项一致。 */
export const FIRST_LIMIT_PULLBACK_3F_TOPN1: TradingPatternSpec = makeThreeFactorTopNPattern(
  1,
  { requirePullback: true },
);

/** 交易压缩实验（TRADE-COMPRESSION-001）：3F 综合评分 TopN（N = 2）。其余口径与 N3 逐项一致。 */
export const FIRST_LIMIT_PULLBACK_3F_TOPN2: TradingPatternSpec = makeThreeFactorTopNPattern(
  2,
  { requirePullback: true },
);

/** 3F 综合评分 TopN 策略（N = 3）。 */
export const FIRST_LIMIT_PULLBACK_3F_TOPN3: TradingPatternSpec = makeThreeFactorTopNPattern(
  3,
  { requirePullback: true },
);

/** 3F 综合评分 TopN 策略（N = 5）。 */
export const FIRST_LIMIT_PULLBACK_3F_TOPN5: TradingPatternSpec = makeThreeFactorTopNPattern(
  5,
  { requirePullback: true },
);

/** 1.13.0 变体：Top3，移除观察窗收盘回踩资格门槛。 */
export const FIRST_LIMIT_3F_TOPN3_NO_PULLBACK_GATE: TradingPatternSpec =
  makeThreeFactorTopNPattern(3, {
    requirePullback: false,
    recipeIdSuffix: "-no-pullback-gate",
  });

/** 1.13.0 变体：Top5，移除观察窗收盘回踩资格门槛。 */
export const FIRST_LIMIT_3F_TOPN5_NO_PULLBACK_GATE: TradingPatternSpec =
  makeThreeFactorTopNPattern(5, {
    requirePullback: false,
    recipeIdSuffix: "-no-pullback-gate",
  });
