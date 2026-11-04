/**
 * Risk Layer — 统一风险契约（Risk Policy Contract）。
 *
 * 职责边界（四层职责分离）：
 *   - Strategy 决定「我想做什么」→ 产出 Signal / Intent。
 *   - PositionSizer 决定「建议做多少」→ 产出 proposed quantity。
 *   - RiskPolicy / RiskManager 决定「允许不允许、允许多少」→ 产出 RiskDecision。
 *   - Backtest Core（Execution + Portfolio）决定「最终如何成交」→ 产出 Fill / Position。
 *
 * 关键约束：
 *   - RiskPolicy 是纯函数：只读 RiskContext，返回 RiskDecision，禁止修改 Portfolio / cash / position，
 *     禁止产生 Fill、写数据库、请求网络、读取未来数据。
 *   - 每个被拒/被限制的决策必须给出结构化 reason/code，禁止只返回 boolean。
 *   - 决策可追踪：RiskDecision 保留 requestedQuantity → approvedQuantity 及全部 violations，
 *     使回测报告能够回答「为什么这笔交易最终只有 N 股」。
 */

import type { CostModel, Side } from "../engine/domain";

/** 交易意图（由 Signal / PositionSizer 提议而来）。策略只表达「想做什么」，不决定最终数量。 */
export interface OrderIntent {
  symbol: string;
  side: Side;
  /** 提议数量（股），由 PositionSizer 产出（或策略原始请求）。 */
  requestedQuantity: number;
  /** 信号时点。 */
  signalTime: string;
  /** 可选信号评分（用于排序/仓位分配，不参与成交本身）。 */
  score?: number;
  /** 可选解释性标签。 */
  reason?: string | null;
}

/** 风险决策类型：通过 / 缩放 / 拒绝。 */
export type RiskDecisionKind = "APPROVE" | "RESIZE" | "REJECT";

/** 结构化风险违规记录（可解释）。 */
export interface RiskViolation {
  /** 结构化原因码，如 MAX_POSITIONS_EXCEEDED / INVALID_LOT_SIZE / INSUFFICIENT_CASH。 */
  code: string;
  /** 人类可读解释。 */
  message: string;
  /** 触发该违规的 Policy 名。 */
  policy: string;
}

/** 风险决策：可解释、可追踪。 */
export interface RiskDecision {
  kind: RiskDecisionKind;
  /** 最终批准数量（股）。REJECT 时为 0。 */
  approvedQuantity: number;
  /** 原始提议数量（股）。 */
  requestedQuantity: number;
  /** 违规 / 限制记录（APPROVE 时为空数组）。 */
  violations: RiskViolation[];
}

/** 风险上下文中的持仓快照（只读）。 */
export interface RiskPosition {
  symbol: string;
  quantity: number;
  /** 该持仓当前市值。 */
  marketValue: number;
}

/**
 * 风险上下文（只读快照，由上层从 Portfolio / 行情派生后传入）。
 * Risk Layer 自身不访问数据库 / 网络 / Portfolio 可变 API。
 */
export interface RiskContext {
  /** 决策时点（交易日）。 */
  timestamp: string;
  /** 当前组合权益。 */
  equity: number;
  /** 当前现金。 */
  cash: number;
  /** 可用现金（当前模型下等于 cash；预留流动性占用扩展）。 */
  availableCash: number;
  /** 当前持仓（只读）。 */
  positions: readonly RiskPosition[];
  /** 当前开仓数量。 */
  openPositionCount: number;
  /** 当前标的市场价（用于估算敞口/成本），可空表示未知。 */
  marketPrice: number | null;
  /** 当前组合总敞口 = 持仓市值 / equity（0~1）。 */
  portfolioExposure: number;
  /** 当前标的敞口 = 该标的市值 / equity（0~1）。 */
  symbolExposure: number;
  /** 该标的参考成交额（单位：千元，取信号日，T+1 开盘前已知），用于流动性容量约束，可空。 */
  referenceAmount: number | null;
  /** 成本模型（供 CashPolicy 估算费用，禁止策略自行扣费）。 */
  cost: CostModel;
}

/**
 * 风险策略：检查一个交易意图是否允许执行。
 * 纯函数，无副作用——只读 context，返回决策，绝不修改任何状态。
 */
export interface RiskPolicy {
  /** 策略名（用于 violations.policy 追溯）。 */
  name: string;
  /** 检查意图，返回 APPROVE / RESIZE / REJECT。 */
  check(intent: OrderIntent, context: RiskContext): RiskDecision;
}

/** 统一风险决策管道：组合多个 Policy，形成唯一决策。 */
export interface RiskManager {
  /** 对意图做完整风险裁决。 */
  check(intent: OrderIntent, context: RiskContext): RiskDecision;
}

/**
 * 风险决策追踪记录（用于回测报告回答「为什么这笔交易最终只有 N 股」）。
 */
export interface RiskDecisionTrace {
  symbol: string;
  signalTime: string;
  /** 策略原始请求数量。 */
  requestedQuantity: number;
  /** PositionSizer 建议数量（若未启用 sizer 则等于 requestedQuantity）。 */
  proposedQuantity: number;
  decision: RiskDecisionKind;
  /** 最终批准数量（REJECT 时为 0）。 */
  approvedQuantity: number;
  /** 触发的违规/限制记录。 */
  violations: { code: string; message: string; policy: string }[];
}

/** 仓位模型：根据意图与上下文计算建议数量（proposed quantity），不直接执行交易。 */
export interface PositionSizer {
  /** 仓位模型名。 */
  name: string;
  /** 计算建议数量（股，向下取整到整手）。 */
  propose(intent: OrderIntent, context: RiskContext): number;
}
