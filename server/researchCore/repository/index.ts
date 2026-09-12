/**
 * RESEARCH-001 — Repository 层统一出口。
 *
 * 内存替身（测试）与真实 DB 实现共用同一契约（`contract.ts`），
 * 不变量与错误码严格对齐（见各自文件头注释）。
 */

export * from "./contract";
export * from "./errors";
export { createInMemoryResearchRepositories } from "./inMemory";
export type { InMemoryResearchOptions } from "./inMemory";
export { createDbResearchRepositories } from "./db";
