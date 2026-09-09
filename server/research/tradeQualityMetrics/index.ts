/**
 * STEP 16 / C-16.3 — 策略评价·交易质量与稳定性指标统一出口。
 *
 * 消费与 C-16.1 / C-16.2 同一份（equityCurve + trades）记录流，产出研究链路专用的
 * 交易质量（WinRate/Profit Factor/Expectancy/Turnover/平均持仓/交易数）与稳定性
 * （月度一致性/年度一致性/regime 占位）确定性评估。Sharpe/Sortino/Calmar 属 C-16.2、
 * 收益/风险/回撤属 C-16.1、regime 体系属 C-22.1，本目录不实现。
 */

export * from "./types";
export * from "./analyze";
export * from "./evaluate";
// 共享结构化错误（C-16.1 定义，本任务复用；重新导出便于单一 import 消费 instanceof）。
export { PerformanceEvaluationError } from "../performanceMetrics/analyze";
