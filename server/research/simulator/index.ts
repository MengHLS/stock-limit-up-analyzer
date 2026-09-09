/**
 * STEP 14 / C-14.1 — 交易模拟核心统一出口。
 *
 * 候选（C-13.2）→ 交易模拟的多日编排薄层：把 CandidateEvaluationRun 的逐日
 * PositionIntent 翻译为 T+1 订单（复用 STEP 8 Portfolio/ExecutionModel/Cost/Audit
 * 原子能力），产出不可变、可审计、带追溯字段的 TradeSimulationRun
 * （C-16.1 收益/风险/回撤指标将消费其中的 EquityPoint / Trade 记录流）。
 *
 * 边界：只做编排与记录；不实现新成本/滑点模型（C-14.2）、执行/约束模型本体
 * （C-14.3）、收益指标（C-16.1）、regime（C-22.1）。
 */

export * from "./types";
export * from "./plan";
export * from "./validate";
export * from "./serialize";
export * from "./engine";
