/**
 * WALK-FORWARD-001 — 域内 barrel（`server/research/walkForward/**`）。
 *
 * ## ⚠️ 为什么**刻意不挂** `server/research/index.ts`
 *
 * 该全域 barrel 用的是 `export *`，而本域有两个符号与既有 C-19.1 的
 * `server/research/walkForwardRun/**`（内存态窗口编排原语）近同名：
 *
 * | 本域（持久化滚动验证） | C-19.1（内存态几何原语） |
 * | --- | --- |
 * | `WALK_FORWARD_VALIDATION_RUN_ID_PREFIX = "WFV"` | `WALK_FORWARD_RUN_ID_PREFIX = "WFA"` |
 * | `WALK_FORWARD_VALIDATION_RUN_RECORD_KIND` | `WALK_FORWARD_RUN_RECORD_KIND` |
 *
 * ESM 的 `export *` 遇到同名导出会**静默遮蔽**（不报错），一旦两域并进同一个 barrel，
 * 读者与后续新增导出都极易拿到「看起来对、实际是另一个人写的」那个符号。
 *
 * ⇒ 本域与 `oosValidation/**` / `searchRobustness/**` 采取同一策略：
 *   **提供域内 barrel，但一律按文件路径 import**，不并入全域 `export *` 图。
 *   （这也是 `parameterSearch/index.ts` 刻意不 re-export 执行层的原因之一 —— 避免
 *    经评估端口子图形成运行时循环导入。）
 */
export * from "./types";
export * from "./windowSchedule";
export * from "./lifecycle";
export * from "./leakage";
export * from "./freeze";
export * from "./selection";
export * from "./aggregate";
export * from "./run";
export * from "./persistence";
export * from "./executor";
