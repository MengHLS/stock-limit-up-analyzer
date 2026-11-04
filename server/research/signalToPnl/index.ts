/**
 * STEP 23 / C-23.2 — 信号→订单→成交→PnL 闭环编排（Signal → Order → Fill → PnL closed-loop）。
 *
 * 交付内容：
 *   - types.ts      领域类型契约（SignalToPnlRun / PnlLoop* + 记录身份常量）；
 *   - errors.ts     结构化错误（SignalToPnlError，稳定 code，FAIL FAST）；
 *   - engine.ts     主编排器 runSignalToPnlLoop（多日 T+1 结算 + 决策 + 执行 + 估值）；
 *   - run.ts        C-16.3 适配（toTradeQualityEvaluationInput）+ PaperAccountRun 视图映射；
 *   - serialize.ts  canonical + sha256 指纹 + round-trip + 篡改拒绝；
 *   - validate.ts   SignalToPnlRun 结构复核。
 *
 * 复用（C-23.2 = 串联器，编排即调用既有原语）：
 *   - C-13.2 signalEngine：CANDIDATE_EVALUATION_RUN + computeCandidateEvaluationRunFingerprint；
 *   - C-23.1 paperAccount：8 个账户状态原语 + checkPaperOrder + computePaperPnlBreakdown
 *     + describeExecutionConstraintCoverage；
 *   - C-14.2 costModel：computeFillCostBreakdown + toEngineCostModel；
 *   - C-14.3 executionConstraints：computeExecutionConstraintDeclarationFingerprint；
 *   - C-14.1 simulator/plan.ts：planDecisionDay（候选意图 → 订单映射，hold-while-selected
 *     longOnly 进出场，绝不重写）。
 *
 * 纯模块：无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、确定性。
 * 边界：不做信号生成（注入式 priceSource / signalSelector）；不做交易日志（Planned vs
 * Actual / Deviation / Reason / Emotion / Rule Violation / Post-review 留给 C-24.1）。
 */

export * from "./types";
export * from "./errors";
export * from "./engine";
export * from "./run";
export * from "./serialize";
export * from "./validate";