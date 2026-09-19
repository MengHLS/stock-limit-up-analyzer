/**
 * BACKTEST-001 — Backtest Context / Execution Policy / Order Intent（**唯一口径入口**）。
 *
 * ## 为什么放在 `server/backtest/` 而不是新建 `server/backtestCore/`
 *
 * Phase A 实测结论：`server/backtest/**`（engine / portfolio / position / execution /
 * marketRules / cost / metrics / types / audit）**已经是事实上的 Backtest Core** ——
 * 生产回测 `research/simulator/engine.ts#runTradeSimulation` **全量复用**它的
 * `portfolio` / `position` / `execution` / `cost` / `marketRules` / `audit` / `types`
 * （见 `simulator/engine.ts:34,36-40,361,364,376,379,467-471,533-536,703`）。
 *
 * ⇒ 新建 `server/backtestCore/**` 只会制造**第二套**持仓/成本/撮合实现。
 *    本文件只补 Phase A 实测出的三处**真实缺口**，不重复任何既有计算：
 *      G1 执行政策（涨跌停 / T+1 / 停牌 / 部分成交）在生产装配里**没被传下去**（默认全关）；
 *      G2 `positionSizing` / `positionRatio` / `fixedAmount` 在 simulator 链**无消费者**；
 *      G3 `ExecutionSemantics`（`signalTiming` / `executionTiming` / `priceReference`）**全仓零消费**。
 *
 * ## 分层纪律（规格 §1.1）
 *
 * Strategy 侧只说「要不要交易、交易什么意图」；本层只说「按这个意图执行，账户会怎样」。
 * **本文件不判断任何策略条件**（不读 RuleGraph、不看首板/回踩）。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import type { CostModel } from "../engine/domain";
import type { ExecutionModelId, ExecutionRuleSet, Order, Side } from "./types";

// ---------------------------------------------------------------------------
// G1 — 执行政策（**一条都不许散落在代码里**，全部在这里显式登记）
// ---------------------------------------------------------------------------

/**
 * 执行政策版本（BACKTEST-002 / B-01）—— **政策本身就是可复现坐标的一部分**。
 *
 * 🔴 为什么必须有：政策默认值会变（本轮 `blockLimitUpBuys` 由默认 false 改为 true、
 * 新增 `zeroVolumePolicy`）。没有版本号，未来看到一条历史回测结果**无法判断它用的是哪套政策**
 * ⇒ 「结果为什么不同」永远说不清。
 *
 * 递增规则：**任何会改变成交结果的默认值变更**都必须 +1，并同步更新
 * `describeExecutionPolicy()` 的文案与 `DEFAULT_BACKTEST_EXECUTION_POLICY`。
 *
 * 版本史：
 *   v1（BACKTEST-002）：T+1 强制；`blockLimitUpBuys` / `blockLimitDownSells` 默认 **true**；
 *     `suspensionPolicy = "REJECT"`；`allowPartialFill = true`；`zeroVolumePolicy = "REJECT"`。
 *     （v0 = 隐式历史行为：涨跌停拦截默认 false、零成交量不看。）
 */
export const BACKTEST_EXECUTION_POLICY_VERSION = 1 as const;

/** 执行政策（Backtest Execution Policy）。 */
export interface BacktestExecutionPolicy {
  /** T+1：当日买入不可当日卖出（A 股强制）。 */
  readonly tPlus1: boolean;
  /** 涨停不可买 / 跌停不可卖（触板即拒单）。 */
  readonly blockLimitUpBuys: boolean;
  readonly blockLimitDownSells: boolean;
  /** 停牌（执行日无行）时的处理：`REJECT`（拒单不顺延）| `DEFER`（顺延到下一可交易日）。 */
  readonly suspensionPolicy: "REJECT" | "DEFER";
  /** 允许部分成交（现金不足时按可买手数缩量）。 */
  readonly allowPartialFill: boolean;
  /**
   * 成交量为 0（或缺失 / 非有限）时的政策（BACKTEST-002 / B-05）。
   *
   * `REJECT`（保守默认）= **不可成交**（拒单，记 `NO_LIQUIDITY` + `ZERO_VOLUME` 计数）；
   * `IGNORE` = 不看成交量（= 改造前行为，只有显式声明才使用）。
   */
  readonly zeroVolumePolicy: "REJECT" | "IGNORE";
}

/**
 * 🔴 **默认政策 = A 股最保守口径（全部开启约束）**。
 *
 * 为什么要改默认值：Phase A 实测 `runWorkbenchAssembly/assemble.ts:726-734` 生产装配
 * **不传** `executionRules` ⇒ 走 `marketRules.ts:30-33` 的默认，而那里
 * `blockLimitUpBuys / blockLimitDownSells` **默认 false** ⇒ **生产回测默认按正常价成交涨停/跌停单**
 * （正是规格 §18 点名的缺陷形态）。本常量把这个「静默的宽松默认」翻成「显式的保守默认」。
 */
export const DEFAULT_BACKTEST_EXECUTION_POLICY: BacktestExecutionPolicy = Object.freeze({
  tPlus1: true,
  blockLimitUpBuys: true,
  blockLimitDownSells: true,
  suspensionPolicy: "REJECT",
  allowPartialFill: true,
  zeroVolumePolicy: "REJECT",
});

export const BACKTEST_EXECUTION_POLICY_KEYS = [
  "tPlus1",
  "blockLimitUpBuys",
  "blockLimitDownSells",
  "suspensionPolicy",
  "allowPartialFill",
  "zeroVolumePolicy",
] as const;

/**
 * 政策 → 既有 `ExecutionRuleSet`（`server/backtest/types.ts:152`）。
 *
 * **不新造规则结构**：既有引擎只认 `ExecutionRuleSet`，这里只做字段映射。
 * `marketRules`（涨跌幅比例、lotSize）由调用方按板块给出（`marketRules.ts:12-27`）。
 */
export function toExecutionRuleSet(policy: BacktestExecutionPolicy): ExecutionRuleSet {
  // 既有 `ExecutionRuleSet`（`types.ts:152`）只表达**涨跌停拦截开关**两项；
  // `tPlus1` / `allowPartialFill` 在既有引擎里由 `MarketRuleSet.tPlus1` 与
  // `portfolio` 的现金/整手约束承担（`position.ts:61-93` / `portfolio.ts:134-137,204-213`）
  // ⇒ 这里**不新造字段**，只映射引擎真正认的两项；政策其余项进 Run Record 的 notes。
  return {
    blockLimitUpBuy: policy.blockLimitUpBuys,
    blockLimitDownSell: policy.blockLimitDownSells,
  };
}

/** 政策的人话摘要（进 Run Record 的 notes —— 「这次按什么规则成交」必须可解释）。 */
export function describeExecutionPolicy(policy: BacktestExecutionPolicy): readonly string[] {
  return [
    "T+1 = " + (policy.tPlus1 ? "强制（当日买入不可当日卖出）" : "关闭（⚠️ 非 A 股口径）"),
    "涨跌停拦截 = " +
      (policy.blockLimitUpBuys || policy.blockLimitDownSells
        ? [
            policy.blockLimitUpBuys ? "涨停不可买" : null,
            policy.blockLimitDownSells ? "跌停不可卖" : null,
          ]
            .filter((item): item is string => item !== null)
            .join(" / ")
        : "全部关闭（⚠️ 会按正常价成交触板单）"),
    "停牌处理 = " + (policy.suspensionPolicy === "REJECT" ? "拒单不顺延" : "顺延到下一可交易日"),
    "部分成交 = " + (policy.allowPartialFill ? "允许（现金不足按可买手数缩量）" : "不允许（不足即拒）"),
    "成交量为 0 = " +
      (policy.zeroVolumePolicy === "REJECT" ? "不可成交（保守；记 NO_LIQUIDITY）" : "忽略成交量（⚠️ 可能按正常价成交零成交日）"),
    "执行政策版本 = v" + String(BACKTEST_EXECUTION_POLICY_VERSION),
  ];
}

// ---------------------------------------------------------------------------
// BacktestContext（规格 §6）
// ---------------------------------------------------------------------------

/** 一次回测所需的全部上下文（**只声明，不做 IO**）。 */
export interface BacktestContext {
  readonly runId: string;
  readonly createdAt: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 数据集坐标（`dataset_version.id`；未绑定时 null）。 */
  readonly datasetVersionId: number | null;
  readonly datasetVersion: string;
  /** 本次运行的参数（原始 + 解析后）。 */
  readonly parameterSet: Readonly<Record<string, unknown>>;
  readonly resolvedParameterSet: Readonly<Record<string, unknown>>;
  readonly initialCapital: number;
  readonly currency: string;
  readonly universeId: string;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  /** 策略声明的执行语义（**只记录 + 校验**，不在此层解释）。 */
  readonly executionSemantics: {
    readonly signalTiming: string;
    readonly confirmationTiming: string;
    readonly executionTiming: string;
    readonly priceReference: string;
  };
  readonly executionModel: ExecutionModelId;
  readonly costModel: CostModel;
  readonly policy: BacktestExecutionPolicy;
  readonly maxPositions: number | null;
  readonly seed: number | null;
  /** 策略声明的仓位口径（**原样带过来**；映射见 `mapPositionSizing`）。 */
  readonly positionSizing: {
    readonly sizingMethod: string;
    readonly maxPositions: number | null;
    readonly positionRatio: number | null;
    readonly fixedAmount: number | null;
  };
}

/** 上下文校验（**响亮**，不静默取默认）。 */
export function assertValidBacktestContext(context: BacktestContext): void {
  const fail = (message: string): never => {
    throw new Error("[BACKTEST_CONTEXT_INVALID] " + message);
  };
  if (context.runId.trim() === "") fail("runId 不能为空");
  if (!Number.isFinite(context.initialCapital) || context.initialCapital <= 0) {
    fail("initialCapital 必须是 > 0 的有限数字，实际 " + JSON.stringify(context.initialCapital));
  }
  if (context.dateRange.startDate > context.dateRange.endDate) {
    fail("dateRange 起止颠倒：" + context.dateRange.startDate + " > " + context.dateRange.endDate);
  }
  if (context.maxPositions !== null && (!Number.isInteger(context.maxPositions) || context.maxPositions < 1)) {
    fail("maxPositions 必须是 >= 1 的整数或 null");
  }
}

// ---------------------------------------------------------------------------
// G3 — ExecutionSemantics 与执行模型的一致性校验
// ---------------------------------------------------------------------------

/** 生产回测**实际支持**的执行语义（其余组合一律拒绝，而不是静默按默认跑）。 */
export const SUPPORTED_EXECUTION_SEMANTICS: readonly {
  readonly signalTiming: string;
  readonly executionTiming: string;
  readonly priceReference: string;
}[] = Object.freeze([
  { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN", priceReference: "OPEN" },
  { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_CLOSE", priceReference: "CLOSE" },
]);

export interface ExecutionSemanticsCheck {
  readonly supported: boolean;
  readonly detail: string;
}

/**
 * 校验策略声明的执行语义是否被当前回测实现支持。
 *
 * 🔴 为什么必须校验而不是忽略：Phase A 实测 `signalTiming` / `executionTiming` /
 * `priceReference` **全仓零消费** —— 策略声明 `T_CLOSE → T+1 OPEN`，而引擎实际
 * 硬编码 `decisionPoint=close` + `executionTime=nextDate`（`simulator/engine.ts:272-278,662`）。
 * 对**当前**声明这恰好一致（所以历史结果没错），但一旦有人声明别的语义，
 * 引擎会**静默按默认口径跑**并给出一个看起来正常的结果 —— 这正是规格 §9/§10 要堵的洞。
 *
 * ⇒ 判据：声明必须在支持集内；不在集内 ⇒ **响亮拒绝**（由调用方决定是否回落），
 *    绝不静默继续。
 */
export function checkExecutionSemantics(input: {
  readonly signalTiming: string;
  readonly executionTiming: string;
  readonly priceReference: string;
  readonly decisionPoint: string;
}): ExecutionSemanticsCheck {
  if (input.decisionPoint !== "close") {
    return {
      supported: false,
      detail:
        "回测引擎的决策时点恒为 close（simulator/engine.ts:272-278 硬校验），实际 " +
        input.decisionPoint + " —— 声明与实现不一致，拒绝静默按 close 跑。",
    };
  }
  const hit = SUPPORTED_EXECUTION_SEMANTICS.some(
    (item) =>
      item.signalTiming === input.signalTiming &&
      item.executionTiming === input.executionTiming &&
      item.priceReference === input.priceReference,
  );
  if (hit) {
    return {
      supported: true,
      detail:
        "执行语义 " + input.signalTiming + " → " + input.executionTiming + "@" + input.priceReference +
        " 在支持集内（决策 T 收盘后确认、T+1 执行）。",
    };
  }
  return {
    supported: false,
    detail:
      "执行语义 " + input.signalTiming + " → " + input.executionTiming + "@" + input.priceReference +
      " **不在回测实现的支持集内**（支持：" +
      SUPPORTED_EXECUTION_SEMANTICS.map((item) => item.signalTiming + "→" + item.executionTiming + "@" + item.priceReference).join("、") +
      "）—— 拒绝静默按默认口径跑出一个看起来正常的结果。",
  };
}

// ---------------------------------------------------------------------------
// G2 — Position Sizing 映射
// ---------------------------------------------------------------------------

/**
 * 仓位口径在回测引擎里的**实际支持度**（实测，不是设计愿望）。
 *
 * Phase A 实测：生产 `SimulationConfig` 只吃 `initialCapital / cost / executionModel /
 * maxPositions / directionPolicy`（`assemble.ts:726-734`）；实际成交预算 =
 * **等权现金预算**（`pipeline.ts:141` 的 `weight = 1/selected.length`
 * → `simulator/plan.ts:267-279` 的 `budget = cash*weight/Σweight` → 整手取整）。
 * ⇒ `positionRatio` / `fixedAmount` **无消费者**。
 *
 * 本函数**不伪造支持**：把「声明了什么」映射为「引擎实际怎么执行」+ 明确标注
 * 哪些声明被忽略（进 Run Record，界面可见）。
 */
export interface PositionSizingMapping {
  /** 引擎实际生效的口径（BACKTEST-002 起 `FIXED_FRACTION` 真正生效）。 */
  readonly effective: "EQUAL_WEIGHT_CASH_BUDGET" | "FIXED_FRACTION_OF_INITIAL_CAPITAL";
  /** 声明了但**未被引擎消费**的项（如实登记，绝不静默）。 */
  readonly ignoredDeclarations: readonly string[];
  readonly note: string;
}

export function mapPositionSizing(positionSizing: BacktestContext["positionSizing"]): PositionSizingMapping {
  const ignored: string[] = [];
  const method = positionSizing.sizingMethod;
  // BACKTEST-002（B-02）：`FIXED_FRACTION` 已真正参与成交预算计算（见 plan.ts#applyPositionSizing）。
  if (method === "FIXED_FRACTION" || method === "FIXED_RATIO") {
    const fraction = positionSizing.positionRatio;
    const valid = typeof fraction === "number" && Number.isFinite(fraction) && fraction > 0;
    if (!valid) ignored.push("fraction=" + JSON.stringify(fraction ?? null));
    return {
      effective: "FIXED_FRACTION_OF_INITIAL_CAPITAL",
      ignoredDeclarations: ignored,
      note:
        "声明 " + method + "（fraction=" + String(fraction ?? "缺失") + "）⇒ 引擎按「初始资金 × fraction，且不超过可分配现金」收窄每笔成交预算" +
        (valid ? "" : "；⚠️ fraction 缺失/非法 ⇒ 引擎会**响亮抛错**（不静默回落等权）"),
    };
  }
  if (positionSizing.fixedAmount !== null && positionSizing.fixedAmount !== undefined) {
    ignored.push("fixedAmount=" + String(positionSizing.fixedAmount) + "（策略文档当前不产出该声明）");
  }
  if (method !== "EQUAL_WEIGHT" && method !== "RANK_WEIGHTED") {
    ignored.push("sizingMethod=" + method);
  }
  if (method === "RANK_WEIGHTED") {
    ignored.push("RANK_WEIGHTED 当前与等权同口径（研究侧 weight 已是 1/N）");
  }
  return {
    effective: "EQUAL_WEIGHT_CASH_BUDGET",
    ignoredDeclarations: ignored,
    note:
      ignored.length === 0
        ? "声明 " + method + " = 引擎实际口径（等权现金预算 ÷ 整手）；无被忽略的声明项"
        : "声明 " + method + " 的以下项**当前引擎不消费**：" + ignored.join("、") +
          "；实际口径 = 等权现金预算 ÷ 整手（maxPositions=" + String(positionSizing.maxPositions ?? "不限") + "）",
  };
}

// ---------------------------------------------------------------------------
// Order Intent（规格 §7）
// ---------------------------------------------------------------------------

/**
 * 统一交易意图（Strategy 与 Fill 之间的那一层）。
 *
 * 值域刻意**贴着既有 `Side`（`types.ts:28`）**，不新造第二套方向词表。
 */
export const ORDER_INTENTS = ["OPEN_LONG", "ADD_LONG", "REDUCE_LONG", "CLOSE_LONG"] as const;
export type OrderIntentKind = (typeof ORDER_INTENTS)[number];

/** 意图 → 订单方向（既有 `Side`）。 */
export const ORDER_INTENT_TO_SIDE: Readonly<Record<OrderIntentKind, Side>> = Object.freeze({
  OPEN_LONG: "buy",
  ADD_LONG: "buy",
  REDUCE_LONG: "sell",
  CLOSE_LONG: "sell",
});

/** 单条交易意图（**尚未成为 Order**：数量 / 价格由执行层决定）。 */
export interface OrderIntent {
  readonly kind: OrderIntentKind;
  readonly securityId: string;
  /** 产生该意图的决策时点（`YYYY-MM-DD`）。 */
  readonly decisionDate: string;
  /** 签名 / 排序用来源（信号节点 id 或出场规则 id）。 */
  readonly sourceId: string;
  /** 目标仓位权重（研究侧给出的意图权重；未给出为 null）。 */
  readonly targetWeight: number | null;
  readonly reason: string;
}

/** StrategyDecision 里本层需要消费的最小面（**不 import Strategy Core 类型**，避免反向依赖）。 */
export interface DecisionIntentView {
  readonly decisionDate: string;
  readonly securityId: string;
  readonly entryIntentNodeIds: readonly string[];
  readonly exitIntentNodeIds: readonly string[];
  /** `decision.signals.length > 0` = 当次有入场信号。 */
  readonly hasEntrySignal: boolean;
  readonly targetWeight?: number | null;
}

/**
 * 由 `StrategyDecision` 派生交易意图（**唯一映射**）。
 *
 * 语义（与既有 simulator 一致，不引入新语义）：
 *   - 有入场信号且有出场意图 ⇒ 同时产出 `OPEN_LONG` 与 `CLOSE_LONG`（由执行层按
 *     「先平后开」的既有次序处理；本层**不排序**）；
 *   - 只有入场信号 ⇒ `OPEN_LONG`；
 *   - 只有出场意图 ⇒ `CLOSE_LONG`；
 *   - 都没有 ⇒ 空数组（不是「什么都不做」的隐式对象，而是明确的空）。
 */
export function deriveOrderIntents(view: DecisionIntentView): readonly OrderIntent[] {
  const intents: OrderIntent[] = [];
  for (const nodeId of view.entryIntentNodeIds) {
    intents.push({
      kind: "OPEN_LONG",
      securityId: view.securityId,
      decisionDate: view.decisionDate,
      sourceId: nodeId,
      targetWeight: view.targetWeight ?? null,
      reason: "策略入场意图（signalNodeId=" + nodeId + "）",
    });
  }
  if (view.entryIntentNodeIds.length === 0 && view.hasEntrySignal) {
    intents.push({
      kind: "OPEN_LONG",
      securityId: view.securityId,
      decisionDate: view.decisionDate,
      sourceId: "signal",
      targetWeight: view.targetWeight ?? null,
      reason: "策略信号成立（无显式 entryIntent 节点）",
    });
  }
  for (const nodeId of view.exitIntentNodeIds) {
    intents.push({
      kind: "CLOSE_LONG",
      securityId: view.securityId,
      decisionDate: view.decisionDate,
      sourceId: nodeId,
      targetWeight: null,
      reason: "策略出场意图（exitNodeId=" + nodeId + "）",
    });
  }
  return intents;
}

/** 由 `Order` 反查其意图（供 ledger / 审计展示「这笔单为什么下」）。 */
export function intentKindOfOrder(order: Pick<Order, "side">, isOpening: boolean): OrderIntentKind {
  if (order.side === "buy") return isOpening ? "OPEN_LONG" : "ADD_LONG";
  return isOpening ? "REDUCE_LONG" : "CLOSE_LONG";
}
