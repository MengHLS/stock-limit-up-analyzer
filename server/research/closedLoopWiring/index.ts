/**
 * 闭环装配层（closedLoopWiring）— 统一出口。
 *
 * 职责边界：把 `server/research/closedLoop/` 的 14 阶段编排骨架接到**真实**研究模块上，
 * 并把「哪些阶段真的能跑」变成可计算的事实（`assessClosedLoopWiringCoverage`），
 * 取代 `server/researchRunRouter.ts` 里硬编码的 `executorBound = false`。
 *
 * 本层：
 *   - **零 IO / 不读 DB / 不构建数据集**（`data` 阶段吃调用方注入的真实 `ResearchDataset`）；
 *   - **不伪造**：未装配的阶段不注册执行器，由编排器如实发出 `CL_RUNNER_NOT_INJECTED`；
 *   - **不重写口径**：交接摘要优先复用 `closedLoop/adapters.ts` 的既有投影。
 *
 * 已装配：`data / research / strategy / backtest / evaluation`（+ `finalize` 走编排器内置路径）。
 * 未装配阶段的**确切原因**见 `requirements.ts` 的 `notWiredReason`（声明表即待办清单）。
 */

export * from "./types";
export * from "./requirements";
export * from "./coverage";
export * from "./executors";
