/**
 * PHASE-A-001 —— Research Report Artifact 统一出口。
 *
 * 分层（严格单向）：
 *   service（装配 + 幂等落库；唯一触碰 Repository / datasetReader 的一层）
 *     → generator（**纯投影**：既有 Result / Finding / Conclusion → markdown + metadata + checksum）
 *       → types（数据契约，零 IO）
 *
 * 反模式检查（本模块**不含**）：
 *   - 无第二套 Result / Finding / Conclusion / Artifact / 报告仓储（只用既有 `research_artifact`）；
 *   - 无研究重算（不 import metrics / analyses/* / engine，不查行情）；
 *   - 无 PDF / 图表 / 对象存储 / 报告编辑器（第一版只产 markdown，INLINE 落 `metadataJson`）；
 *   - 零迁移（不改 `research_artifact` 任何列）。
 */

export * from "./types";
export * from "./generator";
export * from "./service";
