/**
 * PATTERN-LIBRARY-001 — 候选草图的「**执行假设**」默认值。
 *
 * ## 为什么它**不**放在模式声明里
 *
 * 一个交易模式（「守线 + 缩量」）回答的是**语义**问题：什么时候算满足条件。
 * 而「佣金率 / 印花税 / 滑点 / 手数 / 仓位比例 / 止损 / 初始资金」回答的是**执行环境**问题 ——
 * 同一个模式完全可以用不同的成本假设跑出不同结论，两者**正交**。
 * 把执行假设焊进模式声明，等于让所有模式共用一套成本模型，且换一次成本假设要改 8 个声明文件。
 *
 * ## 为什么这些值可以直接用（而不是「编」）
 *
 * 逐项抄自 `scripts/verifyResearch00641Promote.mts#promotableSketch()` ——
 * 那是**已在真实库上证明能通过 `buildStrategyDefinition` + canonical validate** 的一份，
 * 不是本轮新编的数字。改它之前请先跑 `verifyResearch00641Promote.mts`。
 *
 * ## 与模式声明的合并方式
 *
 * `projectCandidateSketch` 把它作为**默认值**铺进 `entryRule.extra`；
 * 调用方传 `entryRule` 时按 **`extra` 逐键浅合并**（声明为底、调用方覆盖）
 * ⇒ 调用方只补一个键**不会**丢掉声明里投影出来的 `recipe`。
 * 这个细节是真实的：不浅合并的话，「补 trigger」就会让 recipe 消失，转正又落兜底配方。
 */

/** 事件参数默认值（首板判定比例 10%）。 */
export const DEFAULT_ENTRY_EVENT_PARAMS: Readonly<Record<string, unknown>> = {
  limitUpRatio: 0.1,
};

/**
 * 策略文档级的执行假设默认值（与模式无关，可被调用方逐键覆盖）。
 *
 * 结构对齐 `CANDIDATE_SKETCH_EXTENSION_KEYS` 的 `execution` / `position` / `risk` / `document` 四槽。
 */
export const DEFAULT_EXECUTION_ASSUMPTIONS: Readonly<Record<string, unknown>> = {
  execution: {
    quantityMethod: "TARGET_WEIGHT",
    lotSize: 100,
    slippageModel: "BPS",
    commissionModel: "BPS",
    executionConstraints: ["一字板（开盘即涨停）不成交", "停牌顺延至下一交易日"],
  },
  position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2, maxExposure: 0.8 },
  risk: { stopLoss: 0.08, maxExposure: 0.8, maxDrawdown: 0.25 },
  document: {
    backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
    costModel: {
      commissionRate: 0.00025,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      slippageBps: 5,
      lotSize: 100,
      minCommission: 5,
    },
  },
};

/**
 * 退出规则默认值（文档级，与模式正交：同一模式可以配不同持仓天数 / 止盈止损）。
 *
 * 🔴 它必须存在：2026-09-17 真机全链实测，缺 `riskRule` 时 promote 直接抛
 * `PROMOTE_SKETCH_INCOMPLETE`（「Service 不会补默认值」）。
 */
export const DEFAULT_EXIT_RULE: Readonly<Record<string, unknown>> = {
  holdingDays: 3,
  takeProfit: 0.15,
  stopLoss: 0.08,
};

/** 风控规则默认值（文档级，可被调用方覆盖）。 */
export const DEFAULT_RISK_RULE: Readonly<Record<string, unknown>> = {
  maxPositions: 5,
  maxPositionWeight: 0.3,
};
