/**
 * STEP 8 — Backtest Engine 2.0 统一出口。
 *
 * 分层导出：领域模型 / 数据接口 / 规则 / 成本 / 执行 / 持仓 / 组合 / 指标 / 审计 / 序列化 /
 * 结果 / 引擎编排。不触碰生产 `server/engine`（Step 2 Core）与 `server/research`（STEP 6）。
 */

export * from "./types";
export * from "./dataSource";
export * from "./dbBarStore";
export * from "./marketRules";
export * from "./cost";
export * from "./execution";
export * from "./position";
export * from "./portfolio";
export * from "./metrics";
export * from "./audit";
export * from "./serialization";
export * from "./result";
export * from "./engine";
