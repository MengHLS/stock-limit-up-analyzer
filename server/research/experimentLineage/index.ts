/**
 * STEP 13 / C-13.3 — Experiment Lineage（§28 实验谱系追踪）统一出口。
 *
 * 交付内容（C-13.3）：
 *   - types.ts     §28 全字段谱系记录类型 + 显式 missing/regime/outcome 语义；
 *   - codeVersion.ts  注入式 code_version 纯函数（package version + git HEAD，无 IO）；
 *   - map.ts       既有 ResearchExperiment/Snapshot → 谱系记录的兼容映射 + outcome 挂载；
 *   - validate.ts  §28 齐备性 / 格式 / metrics-result 语义校验器；
 *   - serialize.ts canonical 序列化 + fingerprint + round-trip 复核；
 *   - bridge.ts    与既有 ExperimentRegistry 的只读桥（不修改既有类）。
 *
 * 纯模块：无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、可序列化、确定性。
 */

export * from "./types";
export * from "./codeVersion";
export * from "./map";
export * from "./validate";
export * from "./serialize";
export * from "./bridge";
