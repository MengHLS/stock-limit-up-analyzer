/**
 * STEP 7.7 — Corporate Action & Adjustment Data 层统一出口。
 *
 * 分层：
 *   - types.ts       provider-neutral 领域类型
 *   - engine.ts      确定性复权引擎（纯函数，raw → adjusted）
 *   - provider.ts    BaoStock 归一化解析（纯函数）
 *   - validation.ts  数据质量校验
 *   - storage.ts     持久化（integration，需 DB）
 */

export * from "./types";
export * from "./engine";
export * from "./provider";
export * from "./validation";
export * from "./storage";
