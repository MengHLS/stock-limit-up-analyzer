/**
 * STEP 16 / C-16.2 — 策略评价·风险调整指标（Sharpe/Sortino/Calmar）统一出口。
 *
 * 消费 C-16.1 performanceMetrics 已交付的纯函数（日收益序列/回撤分段/曲线校验）与
 * 共享统计原语（shared/quant-stats），产出研究链路专用的风险调整比率确定性评估
 * （交易质量属 C-16.3、参数优化属 C-17.x，本目录不实现）。
 */

export * from "./types";
export * from "./analyze";
export * from "./evaluate";
