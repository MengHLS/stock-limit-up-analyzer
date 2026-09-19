/**
 * STRATEGY-ARCH-002 — 生产接线层的唯一出口。
 *
 * 分层（自下而上）：
 *
 *   barWindow           legacy bars → Core 相对日窗口（锚定策略显式登记）
 *   eventSource         数据集事件源声明 → Core `EventOccurrenceResolver`（生产注入）
 *   coreDecision        配置 → Core 决策源（`SignalBuilder` + 决策摘要）
 *   versionFromDocument 落库文档 → Core `StrategyVersion`（唯一构造入口）
 *   runRecord           运行留档组装（进 `closed_loop_backtest_run.resultJson`，零 schema 变更）
 *
 * 纪律：本目录**不 import** DB / router；`coreDecision` 是唯一会调 `StrategyRuntime` 的地方。
 */

export * from "./barWindow";
export * from "./eventSource";
export * from "./coreDecision";
export * from "./versionFromDocument";
export * from "./runRecord";
