/**
 * RESEARCH-006.1 / 006.2 — Research → Strategy 边界的统一出口。
 *
 * 本目录是 006.0 §12 定义的**唯一桥**：同时依赖 `researchCore`（Research 领域）与
 * Strategy 领域（未来的 `strategySchema` / `strategyPersistence`），而那两个模块**互不 import**。
 *
 * 已交付：
 *   - ✅ 006.1：候选 4 个来源快照字段的读写、provenance 领域类型与仓储；
 *   - ✅ 006.2：`createFromConclusion` / `get` / `update` / `transition` 的领域服务与 tRPC 端点。
 * 尚未交付（006.3~006.5）：`promote` / `definitionBuild` / provenance 写入 / 前端 / 真实 tRPC 全链。
 *
 * 出口范围（刻意收窄）：
 *   - 导出 `candidateTypes` / `evidenceTrace` / `service`（纯领域层，无传输、无 DB 连接）；
 *   - **不**从本 barrel 导出 `router.ts`（传输层）与 `datasetVersionPort.ts`（直连 Registry）——
 *     需要它们的地方显式 import，避免任何消费本 barrel 的单测被动拉起 DB 层。
 */
export * from "./candidateTypes";
export * from "./evidenceTrace";
export * from "./service";
export * from "./types";
export * from "./provenance";

