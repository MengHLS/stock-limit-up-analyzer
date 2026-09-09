/**
 * STEP 12.6 — Research Dataset（C-12.6.1）：统一出口。
 *
 * 组成：
 *   - ./types     领域类型（请求 / 行 / universe_definition / data_snapshot / artifact / gate）
 *   - ./validate  请求规范化与校验（纯函数）
 *   - ./version   dataset_version 派生（canonical JSON + SHA-256，确定性）
 *   - ./universe  逐日 universe 决议（复用 STEP 11，PIT asOf）
 *   - ./assemble  静态上下文构建 + 单日标准行装配（复用 STEP 12.5 reconstruct 纯函数）
 *   - ./policy    策略元数据（§12 9 类 policy：类型/派生/指纹，纯函数）
 *   - ./policyValidate  策略一致性校验（9 类齐备 + 声明 vs 数据集语义冲突检测，纯函数）
 *   - ./versionSnapshot 版本快照产物（version/fingerprint/policySet 绑定，可序列化 round-trip）
 *   - ./db        真实 DB 批量加载（universe 级接线）
 *   - ./builder   编排 buildResearchDataset
 *
 * 状态纪律：编码链目标 = CODE_READY；DATA_READY / VALIDATED 需 G1（A~H 全 DATA_READY）
 *   汇合后按 gate 判定（§0.2 禁止越级）。
 */

export * from "./types";
export * from "./validate";
export * from "./version";
export * from "./universe";
export * from "./assemble";
export * from "./db";
export * from "./builder";
export * from "./policy";
export * from "./policyValidate";
export * from "./versionSnapshot";
