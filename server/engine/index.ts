/**
 * Backtest Core — 统一入口。
 *
 * 对外暴露领域模型、成交模型、组合引擎、绩效分析与回测引擎。
 * 所有统计数学统一来自 shared/quant-stats。
 */
export * from "./domain";
export * from "./execution";
export * from "./portfolio";
export * from "./performance";
export * from "./engine";
