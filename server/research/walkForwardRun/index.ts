/**
 * STEP 19 / C-19.1 — Walk-Forward Optimization（WFO）统一出口。
 *
 * 职责边界：Train → Optimize → Freeze → Test → Move Window 的窗口划分 + 冻结纪律 + 逐窗编排。
 * 不做 promotion、不做 OOS 隔离记录持久化与聚合报告（C-19.2）、不做过拟合结论判定（C-20）。
 */

export * from "./types";
export * from "./windows";
export * from "./freeze";
export * from "./aggregate";
export * from "./serialize";
export * from "./run";
