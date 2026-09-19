/**
 * STRATEGY-ARCH-001 — StrategyDecision（规格 §13）。
 *
 * 统一输出模型（**不同执行引擎只消费自己需要的部分**）：
 *
 *   StrategyDecision
 *   ├── events         命中的事件（Event Study 消费）
 *   ├── conditions     每个条件节点的求值结果（说明性 / 诊断）
 *   ├── signals        信号（Signal Backtest 消费）
 *   ├── entryIntents   入场意图（Signal / Portfolio Backtest 消费）
 *   ├── exitIntents    出场意图
 *   ├── positionIntents 仓位意图（Portfolio Backtest 消费）
 *   ├── ruleTrace      全量规则轨迹（可审计）
 *   └── explanation    人类可读解释（**由结构生成，不是手写文案**）
 *
 * 🔴 `StrategyRuntime` **不返回任何 Backtest 专用对象**（没有 Order / Fill / PnL /
 *   权益曲线）—— 那些属于执行引擎（规格 §12）。
 *
 * 纯数据（可 JSON 序列化）；构造后深冻结。
 */

import type { CoreValue, EvaluationTime, IntentKind, PositionState, RelativeDay } from "./types";
import type { RuleNodeTrace } from "./ruleGraph";
import type { PositionSizingMethod } from "./definition";

/** 命中的事件。 */
export interface DecisionEvent {
  readonly nodeId: string;
  readonly eventType: string;
  readonly params: Readonly<Record<string, CoreValue>>;
  readonly occurredAtDay: RelativeDay;
}

/** 条件求值结果。 */
export interface DecisionCondition {
  readonly nodeId: string;
  readonly satisfied: boolean | null;
  readonly detail: string;
}

/** 信号（= `TRIGGER` 成立的那一天产出）。 */
export interface DecisionSignal {
  readonly nodeId: string;
  readonly signalTime: EvaluationTime;
  /** 信号基于的相对日（T = 0）。 */
  readonly signalDay: RelativeDay;
  readonly triggerType: string;
  readonly reason: string;
}

/** 入场意图。 */
export interface EntryIntent {
  readonly signalNodeId: string;
  readonly intent: IntentKind;
  /** 本意图发生后的持仓状态。 */
  readonly resultingState: PositionState;
  readonly reasoning: string;
}

/** 出场意图。 */
export interface ExitIntent {
  readonly nodeId: string;
  readonly intent: IntentKind;
  readonly resultingState: PositionState;
  readonly reasoning: string;
}

/** 仓位意图（**只声明怎么定仓位**，不决定成交数量）。 */
export interface PositionIntent {
  readonly sizingMethod: PositionSizingMethod;
  readonly maxPositions: number;
  readonly positionRatio: number | null;
  readonly fixedAmount: number | null;
  readonly parameter: string | null;
}

/** 统一决策输出。 */
export interface StrategyDecision {
  readonly decisionTime: EvaluationTime;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly definitionFingerprint: string;
  readonly events: readonly DecisionEvent[];
  readonly conditions: readonly DecisionCondition[];
  readonly signals: readonly DecisionSignal[];
  readonly entryIntents: readonly EntryIntent[];
  readonly exitIntents: readonly ExitIntent[];
  readonly positionIntents: readonly PositionIntent[];
  readonly ruleTrace: readonly RuleNodeTrace[];
  /** 输入数据不足以可靠决策时为 true（仍可返回空意图）。 */
  readonly insufficientData: boolean;
  /** 由结构生成的解释（顺序稳定）。 */
  readonly explanation: readonly string[];
}

/** 深冻结（决策对象对外不可变）。 */
export function freezeDecision(decision: StrategyDecision): StrategyDecision {
  const freeze = <T>(value: T): T => {
    if (value === null || typeof value !== "object") return value;
    if (Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    return value;
  };
  return freeze(decision);
}

/** 空决策（无信号时使用；保持字段齐全，便于消费方无分支处理）。 */
export function emptyDecision(input: {
  readonly decisionTime: EvaluationTime;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly definitionFingerprint: string;
  readonly insufficientData?: boolean;
  readonly explanation?: readonly string[];
}): StrategyDecision {
  return freezeDecision({
    decisionTime: input.decisionTime,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    definitionFingerprint: input.definitionFingerprint,
    events: [],
    conditions: [],
    signals: [],
    entryIntents: [],
    exitIntents: [],
    positionIntents: [],
    ruleTrace: [],
    insufficientData: input.insufficientData === true,
    explanation: [...(input.explanation ?? [])],
  });
}

/** 从规则轨迹里抽出事件 / 条件（**不再二次求值**，避免两套判定）。 */
export function extractDecisionParts(traces: readonly RuleNodeTrace[]): {
  readonly eventNodeIds: readonly string[];
  readonly conditionResults: readonly DecisionCondition[];
} {
  const eventNodeIds: string[] = [];
  const conditionResults: DecisionCondition[] = [];
  for (const trace of traces) {
    if (trace.kind === "EVENT" && trace.satisfied === true) eventNodeIds.push(trace.nodeId);
    if (trace.kind === "CONDITION") {
      conditionResults.push({ nodeId: trace.nodeId, satisfied: trace.satisfied, detail: trace.detail });
    }
  }
  return { eventNodeIds, conditionResults };
}

/** 决策的稳定摘要（供日志 / 报告，不含全量轨迹）。 */
export function summarizeDecision(decision: StrategyDecision): {
  readonly eventCount: number;
  readonly conditionCount: number;
  readonly satisfiedConditionCount: number;
  readonly signalCount: number;
  readonly entryIntentCount: number;
  readonly exitIntentCount: number;
  readonly positionIntentCount: number;
  readonly insufficientData: boolean;
} {
  return {
    eventCount: decision.events.length,
    conditionCount: decision.conditions.length,
    satisfiedConditionCount: decision.conditions.filter((condition) => condition.satisfied === true).length,
    signalCount: decision.signals.length,
    entryIntentCount: decision.entryIntents.length,
    exitIntentCount: decision.exitIntents.length,
    positionIntentCount: decision.positionIntents.length,
    insufficientData: decision.insufficientData,
  };
}
