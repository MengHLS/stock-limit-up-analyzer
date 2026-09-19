/**
 * STRATEGY-ARCH-001 — ExecutionSemantics（规格 §11）。
 *
 * 回答一个**Strategy 必须说清、Backtest 不该替它决定**的问题：
 *
 *   > StrategyDecision **什么时候**产生，以及它**代表什么**？
 *
 * 五个面：
 *   signalTiming        信号基于哪一根 bar 的哪个时点（T 开盘 / T 收盘）
 *   confirmationTiming  信号在该 bar 内**何时被确认**（开盘确认 / 收盘确认）
 *   executionTiming     成交时点（相对信号 bar，本项目 T+1 模型的关键）
 *   priceReference      成交价参考（OPEN / CLOSE / HIGH / LOW / VWAP）
 *   stateTransition     状态迁移表（FLAT → PENDING_ENTRY → LONG → PENDING_EXIT → FLAT）
 *
 * ⚠️ 边界（规格 §11 / §12）：StrategyRuntime **不负责撮合** —— 不产生 Order / Fill，
 *    不碰滑点 / 手续费 / 现金 / 持仓 / PnL。本模块只**声明语义**并给出状态迁移的
 *    合法下一步；真正的撮合由 Backtest / 执行引擎负责。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import {
  CONFIRMATION_TIMINGS,
  EXECUTION_TIMINGS,
  POSITION_STATES,
  PRICE_REFERENCES,
  SIGNAL_TIMINGS,
  StrategyCoreError,
  validationIssue,
  type ConfirmationTiming,
  type CoreValidationIssue,
  type ExecutionTiming,
  type IntentKind,
  type PositionState,
  type PriceReference,
  type SignalTiming,
} from "./types";

/** 状态迁移边。 */
export interface StateTransition {
  readonly from: PositionState;
  readonly on: IntentKind;
  readonly to: PositionState;
}

/** 执行语义（StrategyVersion.definition 的一段）。 */
export interface ExecutionSemantics {
  readonly signalTiming: SignalTiming;
  readonly confirmationTiming: ConfirmationTiming;
  readonly executionTiming: ExecutionTiming;
  readonly priceReference: PriceReference;
  readonly stateTransition: readonly StateTransition[];
}

/** 默认状态迁移表（做多单标的的常规闭环；可被调用方整体替换）。 */
export const DEFAULT_LONG_ONLY_TRANSITIONS: readonly StateTransition[] = [
  { from: "FLAT", on: "OPEN", to: "PENDING_ENTRY" },
  { from: "PENDING_ENTRY", on: "OPEN", to: "LONG" },
  { from: "PENDING_ENTRY", on: "CLOSE", to: "FLAT" },
  { from: "LONG", on: "CLOSE", to: "PENDING_EXIT" },
  { from: "PENDING_EXIT", on: "CLOSE", to: "FLAT" },
  { from: "FLAT", on: "HOLD", to: "FLAT" },
  { from: "PENDING_ENTRY", on: "HOLD", to: "PENDING_ENTRY" },
  { from: "LONG", on: "HOLD", to: "LONG" },
  { from: "PENDING_EXIT", on: "HOLD", to: "PENDING_EXIT" },
];

/** 默认执行语义（T 收盘出信号 → T+1 开盘成交；对齐本项目 T+1 模型）。 */
export const DEFAULT_EXECUTION_SEMANTICS: ExecutionSemantics = {
  signalTiming: "T_CLOSE",
  confirmationTiming: "ON_BAR_CLOSE",
  executionTiming: "T_PLUS_1_OPEN",
  priceReference: "OPEN",
  stateTransition: DEFAULT_LONG_ONLY_TRANSITIONS,
};

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/**
 * 执行语义校验。
 *
 * 覆盖的方向翻转规则（每条都对照「什么时候能知道什么」推出，不靠取反蒙混）：
 *   E1 信号与确认必须同类：`T_OPEN` ⇒ `ON_BAR_OPEN`；`T_CLOSE` ⇒ `ON_BAR_CLOSE`。
 *   E2 成交不得早于信号：`signalTiming = T_CLOSE` 时禁止同 bar 收盘成交（本项目 T+1 模型）。
 *   E3 价格参考必须与成交时点语义一致：`*_OPEN` ⇒ `OPEN`；`*_CLOSE` ⇒ `CLOSE`。
 *   E4 迁移表：from/to/on 必须属闭集；不允许自环（`from === to` 且 `on` 非 HOLD）。
 *   E5 可达性：所有出现在迁移表里的状态必须能从 `FLAT` 出发到达（无孤儿状态）。
 */
export function validateExecutionSemantics(
  semantics: ExecutionSemantics,
  path = "executionSemantics",
): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];

  if (!(SIGNAL_TIMINGS as readonly string[]).includes(semantics.signalTiming)) {
    issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".signalTiming", "未知信号时点 " + String(semantics.signalTiming)));
  }
  if (!(CONFIRMATION_TIMINGS as readonly string[]).includes(semantics.confirmationTiming)) {
    issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".confirmationTiming", "未知确认时点 " + String(semantics.confirmationTiming)));
  }
  if (!(EXECUTION_TIMINGS as readonly string[]).includes(semantics.executionTiming)) {
    issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".executionTiming", "未知成交时点 " + String(semantics.executionTiming)));
  }
  if (!(PRICE_REFERENCES as readonly string[]).includes(semantics.priceReference)) {
    issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".priceReference", "未知价格参考 " + String(semantics.priceReference)));
  }

  // E1
  if (semantics.signalTiming === "T_OPEN" && semantics.confirmationTiming !== "ON_BAR_OPEN") {
    issues.push(
      validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".confirmationTiming", "signalTiming=T_OPEN 时确认时点必须是 ON_BAR_OPEN"),
    );
  }
  if (semantics.signalTiming === "T_CLOSE" && semantics.confirmationTiming !== "ON_BAR_CLOSE") {
    issues.push(
      validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".confirmationTiming", "signalTiming=T_CLOSE 时确认时点必须是 ON_BAR_CLOSE"),
    );
  }

  // E2
  if (semantics.signalTiming === "T_CLOSE" && semantics.executionTiming === "T_CLOSE") {
    issues.push(
      validationIssue(
        "EXECUTION_SEMANTICS_INVALID",
        path + ".executionTiming",
        "成交不得早于信号：signalTiming=T_CLOSE 时禁止同 bar 收盘成交（本项目 T+1 模型）",
      ),
    );
  }

  // E3
  if (semantics.executionTiming.endsWith("_OPEN") && semantics.priceReference !== "OPEN") {
    issues.push(
      validationIssue(
        "EXECUTION_SEMANTICS_INVALID",
        path + ".priceReference",
        "executionTiming=" + semantics.executionTiming + " 要求 priceReference=OPEN，实际 " + semantics.priceReference,
      ),
    );
  }
  if (semantics.executionTiming.endsWith("_CLOSE") && semantics.priceReference !== "CLOSE") {
    issues.push(
      validationIssue(
        "EXECUTION_SEMANTICS_INVALID",
        path + ".priceReference",
        "executionTiming=" + semantics.executionTiming + " 要求 priceReference=CLOSE，实际 " + semantics.priceReference,
      ),
    );
  }

  // E4
  const declaredStates = new Set<string>();
  for (let index = 0; index < semantics.stateTransition.length; index += 1) {
    const transition = semantics.stateTransition[index] as StateTransition;
    const at = path + ".stateTransition[" + String(index) + "]";
    if (!(POSITION_STATES as readonly string[]).includes(transition.from)) {
      issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", at + ".from", "未知状态 " + String(transition.from)));
    }
    if (!(POSITION_STATES as readonly string[]).includes(transition.to)) {
      issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", at + ".to", "未知状态 " + String(transition.to)));
    }
    if (transition.on !== "OPEN" && transition.on !== "CLOSE" && transition.on !== "HOLD") {
      issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", at + ".on", "未知意图 " + String(transition.on)));
    }
    if (transition.from === transition.to && transition.on !== "HOLD") {
      issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", at, "自环只允许出现在 on=HOLD（实际 on=" + transition.on + "）"));
    }
    declaredStates.add(transition.from);
    declaredStates.add(transition.to);
  }
  if (semantics.stateTransition.length === 0) {
    issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".stateTransition", "状态迁移表不能为空"));
  }

  // E5
  if (!declaredStates.has("FLAT")) {
    issues.push(validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".stateTransition", "状态迁移表必须包含 FLAT（起始状态）"));
  } else {
    const reachable = new Set<PositionState>(["FLAT"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const transition of semantics.stateTransition) {
        if (!reachable.has(transition.from)) continue;
        if (reachable.has(transition.to)) continue;
        reachable.add(transition.to);
        changed = true;
      }
    }
    for (const state of [...declaredStates].sort()) {
      if (!reachable.has(state as PositionState)) {
        issues.push(
          validationIssue("EXECUTION_SEMANTICS_INVALID", path + ".stateTransition", "状态 " + state + " 无法从 FLAT 到达（孤儿状态）"),
        );
      }
    }
  }

  return issues;
}

/** 非法即抛。 */
export function assertValidExecutionSemantics(semantics: ExecutionSemantics): void {
  const issues = validateExecutionSemantics(semantics);
  if (issues.length === 0) return;
  const first = issues[0] as CoreValidationIssue;
  throw new StrategyCoreError(
    "EXECUTION_SEMANTICS_INVALID",
    issues.map((issue) => issue.path + ": " + issue.message).join(" | "),
    { issueCode: first.code, issueCount: issues.length },
  );
}

/**
 * 状态迁移（唯一权威）：给定当前状态与实际发生的意图，返回下一状态。
 * 迁移表里没有登记的边 ⇒ 响亮抛错（**不猜**、不默认保持原状态）。
 */
export function nextPositionState(
  semantics: ExecutionSemantics,
  current: PositionState,
  intent: IntentKind,
): PositionState {
  const match = semantics.stateTransition.find((transition) => transition.from === current && transition.on === intent);
  if (match === undefined) {
    throw new StrategyCoreError(
      "EXECUTION_SEMANTICS_INVALID",
      "状态迁移未登记：" + current + " --" + intent + "--> ?（拒绝默认保持原状态）",
      { from: current, on: intent },
    );
  }
  return match.to;
}

/** 执行语义的「版本」标识（供 RunSnapshot 记录；语义改动必须体现在该串上）。 */
export function executionSemanticsVersion(semantics: ExecutionSemantics): string {
  return [
    semantics.signalTiming,
    semantics.confirmationTiming,
    semantics.executionTiming,
    semantics.priceReference,
    "st" + String(semantics.stateTransition.length),
  ].join("/");
}
