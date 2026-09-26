/**
 * 交易模式：首板回踩 · 3F 综合评分 TopN（**纯执行模式**，N = 3 / 5）。
 *
 * ## 这个模式在赌什么
 *
 * 首板之后第 5 个交易日（T+5）收盘，用 **3F 合成分**给当日候选打分并降序排名，只买排名前 N 名，
 * **次一交易日开盘**（T+6）成交；退出由引擎的 hold-while-selected 语义决定
 * （「不再入选」即卖），盘中 `STOP_LOSS = 5%` 与 `TIME_EXIT = 5 个交易日` 封顶。
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
 * ⚠️ 无行 ⇒ 拒单 `SUSPENDED`，且引擎**逐日重试**（不是「不重试」）⇒ 一旦执行日被推出面板，
 * 该仓位会一直重试到期末，形成 `holdingPeriod` 的**超长尾**（实测见下表与「面板末日清算」）。
 *
 * ⇒ **`end` 不只是「看几天」，它是「允许退出发生在多久之内」**。实测（2026-09-26，630001 冒烟，
 * 面板机制其后的当日收盘价清算见下）：
 *
 * | 窗口 | 面板 rd 深度 | 完成的卖出 | 期末仍持仓 | **执行日无行的卖单** |
 * | --- | --- | --- | --- | --- |
 * | `[5, 5]` | 0..6 | 5 | 19 | 229 |
 * | `[5, 9]` | 0..10 | 25 | 16 | 176 |
 * | `[5, 15]` | 0..16 | **44** | **5** | **0** |
 *
 * 机理：`hold-while-selected` 的退出决策日 ≥ T+6，订单在**次一交易日**执行，且会被
 * T+1 冻结（`FROZEN_EXIT_DEFERRED`）与跌停（`LIMIT_DOWN`）反复顺延 ⇒ 正常路径之外还存在
 * 多日顺延路径，实测最远触及 T+16 附近。取 **`end = 15`**（面板到 `rd = 16`）是让
 * 「正常退出 + 冻结/跌停顺延」**全部落在面板内**的最小实测取值；此时上表右列归零。
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
 * ## 退出与持有期（如实登记）
 *
 * 引擎（`simulator/plan.ts`）是 **hold-while-selected**：决策日「持仓 ∉ 当日 desired」即卖出。
 * 由于 Core 每个事件**只出一次信号**（见上），事件在 T+6 起不再入选 ⇒ 实际持有
 * **≈ 2 个交易日敞口（T+6 开盘买入 → T+8 开盘卖出）**，`TIME_EXIT = 5` 是上限而非常态。
 *
 * 🔴 **该实现期与研究侧主口径（T+6 开盘 → T+10 收盘）不等长**：本模式是同一排序信号在
 * 真实撮合下的**短持有期变体**，不能直接当作研究侧结论的验证。成因与它一样是架构性的 ——
 * 「持有满 5 个交易日」需要 Core 支持「逐日重复触发」（当前 `firesToday` 把 `EVERY_VALID_DAY`
 * 降级为首日），属平台改动，不在本模式范围。执行侧结论文档强制登记该差异。
 *
 * ⚠️ **「执行日无行情」已由兜底覆盖（2026-09-26）**：跌停连板/停牌一度会把执行日推出面板，
 * 使该仓位持有到期末（按市价计入期末权益）—— 实测 690001 样本出现 `holdingPeriod`
 * 67/76/108/134 的长尾，`SUSPENDED / 执行日无行` 累计 697 次。现已由
 * `simulator/engine.ts` 的 **(d-2) 面板末日清算**覆盖：持仓证券若在**下一交易日无行情行**，
 * 即以**当日收盘价**强制清算（复用 (c2) 止损/止盈的 syntheticBar → quote → sell 路径，
 * 滑点/费用/涨跌停规则与正常路径一致）⇒ 上述长尾不复存在。
 * ⇒ **加宽窗口与加兜底是两件互补的事**：前者让正常路径不出面板，后者兜住仍然出面板的残差。
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

import type { TradingPatternSpec } from "../types";

/**
 * 观察窗口（相对首板日的**交易日**偏移）：`[5, 15]`。
 *
 * - `start = 5`：3F 首次可算日（PIT 闸门，**唯一有语义的那一端**）；
 * - `end = 15`：纯**机械**取值 —— 决定直读桥执行面板的深度（面板 `rd ∈ [0, end+1]`）。
 *   依据：三档窗口 `[5,5]`/`[5,9]`/`[5,15]` 的入选集合完全相同（Core 只在首个成立日出信号），
 *   但「完成的卖出 / 期末仍持仓 / 执行日无行的卖单」分别为 5/19/229、25/16/176、**44/5/0**
 *   ⇒ `end = 15` 是让退出**（含 T+1 冻结与跌停顺延）全部落在面板内**的最小实测取值。
 *   详见文件头实测表与 `docs/evidence/README.md` 的 2026-09-26 节。
 */
export const THREE_FACTOR_TOPN_OBSERVATION_WINDOW = {
  start: 5,
  end: 15,
  unit: "TRADING_DAY",
} as const;

/** 时间退出阈值（交易日）：持有期**上限**（常态由 hold-while-selected 的候选退出更早触发）。 */
export const THREE_FACTOR_TOPN_MAX_HOLDING_DAYS = 5;

/** 盘中固定比例止损：相对建仓成本亏 5% 时卖出全部可卖份额。 */
export const THREE_FACTOR_TOPN_STOP_LOSS_RATIO = 0.05;

/** 3F TopN 模式的声明（N 参数化；`topN` 必须 > 0）。 */
function makeThreeFactorTopNPattern(topN: number): TradingPatternSpec {
  if (!Number.isInteger(topN) || topN <= 0) {
    throw new Error(`3F TopN 模式：topN 必须是正整数，实际 ${String(topN)}。`);
  }
  const recipeId = `first-limit-pullback-3f-top${topN}`;
  return {
    patternId: recipeId,
    label: `首板回踩 · 3F 综合评分 Top${topN}`,
    purpose:
      `首板后第 5 个交易日收盘，按 3F 等权合成分（双振幅 LOW + T+1 量比 HIGH）降序排名，`
      + `只买前 ${topN} 名并于次日开盘成交，赌「3F 高分候选的后续收益优于同池平均」。`,
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
        `退出 = 「不再入选（候选退出）」、「盘中亏损达 ${(THREE_FACTOR_TOPN_STOP_LOSS_RATIO * 100).toFixed(0)}%（止损）」与「持有满 ${THREE_FACTOR_TOPN_MAX_HOLDING_DAYS} 个交易日（时间退出）」先到者；实测常态是候选退出（≈2 个交易日敞口）。`,
        "窗口末端 end=15 是**执行面板深度**的声明（面板 rd ≤ end+1），不是「观察多久」：三档 [5,5]/[5,9]/[5,15] 入选集合完全相同，但完成的卖出 5/25/44、期末持仓 19/16/5 ⇒ 它决定退出能不能成交（见文件头实测表）。",
        "面板按 eventId 保留同一证券的多个事件序列；Core 对每个事件只出一次信号 ⇒ 加宽窗口不改变该事件入选集合，只增评估量与面板深度。",
        "策略文档必须带一条恒真条件哨兵（bar.close > 0）才能让窗口进入规则图，否则零信号且不报错（见文件头）。",
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
      features: ["threeFactorComposite"],
      // 空门槛 = 官方支持语义「只要排序特征可用即入选」。本模式无硬门槛。
      gates: [],
      rankFeature: "threeFactorComposite",
      rankHigherIsBetter: true,
      topN,
      parameters: [],
    },
  };
}

/** 3F 综合评分 TopN 策略（N = 3）。 */
export const FIRST_LIMIT_PULLBACK_3F_TOPN3: TradingPatternSpec = makeThreeFactorTopNPattern(3);

/** 3F 综合评分 TopN 策略（N = 5）。 */
export const FIRST_LIMIT_PULLBACK_3F_TOPN5: TradingPatternSpec = makeThreeFactorTopNPattern(5);
