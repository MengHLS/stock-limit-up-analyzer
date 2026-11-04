/**
 * 运行工作台装配层统一出口。
 *
 * 职责（见各文件头）：把「策略 + 时间窗」装配为 `ClosedLoopWiringInputs`，让运行工作台的
 * 「运行策略」按钮能真正跑通 4 个已装配阶段（data / research / backtest / evaluation）。
 *
 * ⚠️ 本层**不**导出到 `server/research/index.ts`：它是「运行工作台」这一交付面的专属装配层，
 * 不属 C-STEP 研究模块谱系（命名纪律见 ROADMAP §49）。
 */

export * from "./assemble";
export * from "./datasetFromRegistry";
export * from "./executionModel";
export * from "./lifecycleConfig";
