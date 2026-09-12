-- STEP STRATEGY-004 — Strategy ↔ Dataset Registry 绑定对齐（datasetVersionId 权威坐标）
--
-- 背景（AUDIT-DRS-001 §8 断点①）：
--   Strategy 侧 Dataset 绑定长期沿用旧 researchDataset 的 `rd-…` 字符串；Dataset Registry
--   （DATASET-002/003）的真实版本坐标是 `dataset_version.id`，label 才是 `v1 / v2`。
--   两套坐标不接头 ⇒ Research → Strategy 连一个合法的数据坐标都不存在。
--
-- 本 migration 只做**增量列 + 索引**（不改名、不重建、不删数据、不建第二套 ID 体系）：
--   strategy_version_datasets.datasetVersionId → dataset_version.id   （权威绑定坐标，SPEC §4）
--   strategy_versions.datasetVersionId         → dataset_version.id   （PRIMARY 绑定镜像列）
--
-- 语义（SPEC §2.1 A）：
--   datasetVersionId = dataset_version.id  = 跨模块唯一 Dataset Version 引用（权威）；
--   datasetVersion   = v1 / v2 等 label    = 显示 / 兼容 / 快照（**不再是**跨模块唯一引用）；
--   rd-… 旧兼容分支保留：datasetVersionId IS NULL 时 datasetVersion 仍为 rd-… 格式串。
--
-- 引用完整性由**应用层**保证（项目惯例：不加 FK，SPEC §14）：
--   写入前查 dataset_version，必须「存在 AND status=READY AND datasetId 一致」，否则拒绝保存。
--
-- 幂等：apply 脚本按 `-- @guard:` 指令先查 information_schema 再执行，重复运行无副作用。
-- 现有两表均为 0 行 ⇒ 无回填、无兼容转换（SPEC §4 自动满足）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`（journal/snapshot 自 0024 起停维护）。

-- ===========================================================================
-- 1. strategy_version_datasets — Dataset 绑定投影的权威坐标列（+1 列 +1 索引）
--    UNIQUE 约束不加 datasetVersionId：绑定唯一性仍以 (version, datasetId, version, role)
--    表达；同一绑定重复写同一 datasetVersionId 不应产生第二行。
-- ===========================================================================

-- @guard: column strategy_version_datasets.datasetVersionId
ALTER TABLE `strategy_version_datasets` ADD COLUMN `datasetVersionId` bigint NULL COMMENT 'Dataset Registry 权威坐标 → dataset_version.id（软引用，无 FK）；NULL = legacy rd-… 绑定';
--> statement-breakpoint
-- @guard: index strategy_version_datasets.idx_strategy_version_datasets_version_id
CREATE INDEX `idx_strategy_version_datasets_version_id` ON `strategy_version_datasets` (`datasetVersionId`);
--> statement-breakpoint

-- ===========================================================================
-- 2. strategy_versions — PRIMARY 绑定镜像列（+1 列 +1 索引）
--    与既有 `datasetVersion`（label / 快照）成对，保证「一个 id + 一个 label」同时可查，
--    使无富 definition 的历史文档（UI 产生的 v1 形态）也能落一个真实可校验的数据坐标。
-- ===========================================================================

-- @guard: column strategy_versions.datasetVersionId
ALTER TABLE `strategy_versions` ADD COLUMN `datasetVersionId` bigint NULL COMMENT 'Dataset Registry 权威坐标 → dataset_version.id（PRIMARY 绑定镜像；NULL = legacy rd-… 绑定）';
--> statement-breakpoint
-- @guard: index strategy_versions.idx_strategy_versions_dataset_version_id
CREATE INDEX `idx_strategy_versions_dataset_version_id` ON `strategy_versions` (`datasetVersionId`);
