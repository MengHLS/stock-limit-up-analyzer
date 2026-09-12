/**
 * RESEARCH-006.1 / 006.2 / 006.3 — Research → Strategy 边界的统一出口。
 *
 * 本目录是 006.0 §12 定义的**唯一桥**：同时依赖 `researchCore`（Research 领域）与
 * Strategy 领域（`strategySchema` / `strategyPersistence`），而那两个模块**互不 import**。
 *
 * 已交付：
 *   - ✅ 006.1：候选 4 个来源快照字段的读写、provenance 领域类型与仓储；
 *   - ✅ 006.2：`createFromConclusion` / `get` / `update` / `transition` 的领域服务与 tRPC 端点；
 *   - ✅ 006.3：`promote`（唯一 Candidate → Strategy 转正入口）+ `definitionBuild`（唯一转换器）
 *     + `strategyPromotionPort`（桥内唯一跨界写 Strategy 的端口）+ `research.strategyCandidate.promote`。
 * 尚未交付（006.4+）：转正的**前端**（本 STEP 只做领域 + 传输层）。
 *
 * 出口范围（刻意收窄）：
 *   - 导出 `candidateTypes` / `evidenceTrace` / `service` / `definitionBuild`（纯领域层，
 *     无传输、无 DB 连接）；
 *   - **不**从本 barrel 导出 `router.ts`（传输层）、`datasetVersionPort.ts`（直连 Registry）、
 *     `strategyPromotionPort.ts`（直连 Strategy 持久化）—— 需要它们的地方显式 import，
 *     避免任何消费本 barrel 的单测被动拉起 DB 层。
 */
export * from "./candidateTypes";
export * from "./definitionBuild";
export * from "./evidenceTrace";
export * from "./service";
export * from "./types";
export * from "./provenance";
