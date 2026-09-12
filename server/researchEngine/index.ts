/**
 * RESEARCH-002 — Research Engine MVP 统一出口。
 *
 * 分层（严格单向依赖）：
 *   engine（编排）
 *     → analyses/*（5 类分析，每类一个文件）
 *       → metrics（**唯一**统计实现，复用 shared/quant-stats）
 *       → variables（变量目录；PIT 角色隔离）
 *     → datasetReader（**唯一** Dataset 读取层）
 *     → sampleSet（最小化装配）
 *     → conclusion（规则型结论）
 *   maintenance（维护服务：leaf-first 级联删除 + 改口径后的产物失效）
 *   batchCreate（批量建分析：预检整批拒绝 + 逐项创建 + 补偿删除 + 部分失败如实回显）
 *
 * 与 `server/researchCore` 的关系：本模块**只消费**其领域类型与 Repository，
 * 不修改其契约（RESEARCH-001 已冻结的表结构与 Repository 形态保持一致）。
 *
 * 反模式检查（本模块**不含**）：
 *   - 无 Dataset 副本表 / 无行情落库 / 无 Dataset 写入；
 *   - Analysis 内无 SQL（全部经 datasetReader）；
 *   - 无回测 / 无参数搜索 / 无正式 Strategy 写入。
 */

export * from "./types";
export * from "./errors";
export * from "./variables";
export * from "./metrics";
export * from "./conditionEvaluator";
export * from "./datasetReader";
export * from "./sampleSet";
export * from "./analysisConfig";
export * from "./conclusion";
export * from "./analyses";
export * from "./engine";
export * from "./maintenance";
export * from "./batchCreate";
export * from "./templates";
