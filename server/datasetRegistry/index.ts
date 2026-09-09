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
 *   - ./router     tRPC router（DATASET-002.2）
 */

export * from "./naming";
export * from "./types";
export * from "./registry";
export * from "./detection";
export * from "./path";
export * from "./builder";
export * from "./db";
export * from "./query";
export * from "./router";
