/**
 * STEP DATASET-001 — Dataset Registry + 独立物理表 + 全局命名规范（统一出口）。
 *
 * 组成：
 *   - ./naming     物理表命名规范 ds_{dataset_code}_{role}（校验 + 派生）
 *   - ./types      领域类型（definition / version / build_job / event / path / outcome）
 *   - ./registry   Dataset Registry 领域层 + Repository 契约 + InMemory + Service
 *   - ./detection  首板事件检测（复用 boardRules + PIT ST，纯函数）
 *   - ./path       path + outcome 构建（relative_day 用交易日历，纯函数）
 *   - ./builder    DatasetBuilder 抽象 + FirstLimitPullbackDatasetBuilder（chunk/cursor/batch/checkpoint/幂等）
 *   - ./db         DbDatasetRegistry + DbDatasetBuildIO（真实 TiDB/MySQL）
 *   - ./query      只读查询层（keyset 分页 + 统计聚合，DATASET-002.2）
 *   - ./runner     构建执行器（真实执行 RUNNING 作业 + 进度落库 + 协作式取消，DATASET-002.4B）
 *   - ./plugins    Dataset 构建插件注册表（每数据集独立表结构 / IO / 构建器，DATASET-003A）
 *   - ./physicalTables 物理表存储（建表 / 清版本数据 / DROP 表 + 表名白名单，DATASET-003A）
 *   - ./filter     构建筛选口径（板块 / 排除 ST / 事件维度 / 前后窗口的纯函数判定，DATASET-003B）
 *   - ./concurrency 有界并发原语 + 分片粒度常量（跨境 TiDB 延迟受限下的取数/写入策略，DATASET-PERF-001）
 *   - ./router     tRPC router（DATASET-002.2 / 002.4A / 002.4B / 003A / 003B）
 */

export * from "./naming";
export * from "./types";
export * from "./lifecycle";
export * from "./filter";
export * from "./registry";
export * from "./detection";
export * from "./path";
export * from "./concurrency";
export * from "./builder";
export * from "./db";
export * from "./query";
export * from "./runner";
export * from "./plugins";
export * from "./physicalTables";
export * from "./router";
