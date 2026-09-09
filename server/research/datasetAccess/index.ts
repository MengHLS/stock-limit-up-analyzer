/**
 * STEP 13 / C-13.1 — Research Dataset 访问层：统一出口。
 *
 * 适配 ResearchDataset（C-12.6.1 权威逐日 PIT panel）到 STEP 10 framework 契约
 * （UniverseProvider / ResearchDataSource），供 Research Engine 消费。策略代码不得
 * 绕过本层去拼原始 DB 表（§12 铁律）。
 */

export * from "./handle";
export * from "./universe";
export * from "./bars";
export * from "./slice";
export * from "./session";
