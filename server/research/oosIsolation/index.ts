/**
 * STEP 19 / C-19.2 — 样本内/外（IS/OOS）隔离记录与归档统一出口。
 *
 * 职责边界：IS/OOS 隔离记录模型 + 隔离纪律机器检查 + OOS 结果聚合报告 + 归档账本 +
 * 序列化 round-trip。复用 C-19.1 walkForwardRun（窗口几何 / 最小聚合 / WalkForwardRun）、
 * C-16.1 performanceMetrics、C-16.2 riskAdjustedMetrics。
 * 不做 promotion、不做「过拟合/未过拟合」结论（C-20 职责）。
 */

export * from "./types";
export * from "./discipline";
export * from "./record";
export * from "./aggregate";
export * from "./ledger";
export * from "./serialize";
export * from "./run";
