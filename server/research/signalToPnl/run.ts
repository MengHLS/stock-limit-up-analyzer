/**
 * STEP 23 / C-23.2 — 信号→订单→成交→PnL 闭环编排：适配层。
 *
 * 职责：
 *   - toSignalToPnlAsPaperAccountView：把 SignalToPnlRun 投影为 PaperAccountRun 兼容形态
 *     （纯字段搬运，便于 C-23.1 toTradeQualityEvaluationInput 复用）；
 *   - toTradeQualityEvaluationInput：直接构造 C-16.3 TradeQualityEvaluationInput
 *     （跳过 PaperAccountRun 中转，纯映射，不重算指标；trades 省略，因账户层
 *     不维护 STEP 8 Trade 生命周期，C-16.3 交易质量指标将得到 tradeQuality=null，
 *     月度/年度一致性照常由 equityCurve 评估）。
 *
 * 铁律：纯函数、readonly 入参、无 IO / Date.now / Math.random。
 */

import type { TradeQualityEvaluationInput } from "../tradeQualityMetrics/types";
import type { SignalToPnlRun } from "./types";

/**
 * 把 SignalToPnlRun 投影为 TradeQualityEvaluationInput（直接构造，跳过 PaperAccountRun 中转）。
 *
 * trades 省略：C-23.2 编排层不维护 STEP 8 Trade 生命周期（建仓→清仓配对属本编排的
 * 「凭仓位 + 成本基推断」而非 STEP 8 Trade 记录的「进出场成对」），故 C-16.3 交易质量
 * 指标将得到 tradeQuality=null（未提供交易），月度/年度一致性照常由 equityCurve 评估。
 *
 * 与 C-23.1 toTradeQualityEvaluationInput 的语义差异：本函数直接消费 SignalToPnlRun
 * 的 equityCurve（与 C-23.1 同源），不经过 PaperAccountRun 中转，避免冗余字段拷贝。
 */
export function toTradeQualityEvaluationInput(
  run: SignalToPnlRun,
  annualizationFactor?: number
): TradeQualityEvaluationInput {
  return {
    equityCurve: run.equityCurve,
    ...(annualizationFactor !== undefined ? { annualizationFactor } : {}),
  };
}

// ---------------------------------------------------------------------------
// SignalToPnlRun → PaperAccountRun 等价数据装配（便于既有 C-23.1 适配）
// ---------------------------------------------------------------------------

/**
 * 从 SignalToPnlRun 装配等价的 PaperAccountRun 视图（纯映射）。
 *
 * 用途：
 *   - 复用 C-23.1 toTradeQualityEvaluationInput 的等价映射（对账/测试用途）；
 *   - 让 C-23.2 编排结果可被 C-23.1 的 serialize / validate round-trip 链路复用。
 *
 * 注意：调用方负责持有 SignalToPnlRun（已深冻结）；返回的对象**不重新冻结**，
 * 如需冻结请自行调用 deepFreeze。
 */
export function toPaperAccountRunView(run: SignalToPnlRun): import("../paperAccount/types").PaperAccountRun {
  // 构造 Omit<PaperAccountRun, "fingerprint"> 再计算指纹 → 便于 C-23.1 复用 serialize。
  // 这里只做字段搬运，指纹由调用方按需计算。
  return {
    recordKind: "PAPER_ACCOUNT_RUN",
    recordVersion: 1,
    runId: run.runId,
    createdAt: run.createdAt,
    initialCapital: run.initialCapital,
    costDeclarationFingerprint: run.costDeclarationFingerprint,
    executionDeclarationFingerprint: run.executionDeclarationFingerprint,
    executionCoverage: run.executionCoverage,
    orders: run.orders,
    fills: run.fills,
    positionSnapshots: run.positionSnapshots,
    cashLedger: run.cashLedger,
    equityCurve: run.equityCurve,
    pnlBreakdown: run.pnlBreakdown,
    fingerprint: "PENDING",
  };
}