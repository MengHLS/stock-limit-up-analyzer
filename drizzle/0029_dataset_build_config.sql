-- STEP DATASET-003B — Dataset 构建 / 筛选配置持久化（dataset_build_config 三表）
--
-- 背景：DATASET-002.4B 的「构建新版本」只暴露 3 项执行参数（回踩窗口 / 结果视界 / 批大小），
-- 缺少真正的**数据筛选条件**（板块、排除 ST、事件维度、t 前 / t 后窗口）。本 migration 引入
-- 独立配置表承载完整筛选口径。
--
-- 核心原则（不可违背）：
--   1. 配置与 dataset_version **一对一**（uq_dataset_build_config_version）：配置是「这一版取了
--      哪些数据」的生成参数，必须与版本同生共死（可复现性铁律）。禁止把配置放到 dataset_definition
--      —— 那是「这是什么数据集」，多版本需要各自不同的筛选。
--   2. 标量维度入列（可索引 / 可反查），多值维度入子表（datasetBuildConfigEvent / Board）；
--      不用纯 JSON 一把梭，否则「哪些版本用了 T-1 日首板」无法走索引。
--   3. 不改动 dataset_version 既有列（universeDefinitionJson / filterDefinitionJson 保留为
--      历史与审计镜像），因此本 migration 对既有数据零破坏、可回滚（DROP 三表即回退）。
--   4. relativeDay ≤ 0：0 = t 日（事件日当天），-1 = t-1 日，-2 = t-2 日。语义见
--      server/datasetRegistry/builder.ts 的 anchorDay 说明。
--
-- 列名口径：沿用项目 camelCase 列约定；表名沿用 snake_case。

-- ===========================================================================
-- 构建 / 筛选配置主表（标量维度 + 执行参数）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `dataset_build_config` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetVersionId` bigint NOT NULL,
	`excludeSt` boolean NOT NULL DEFAULT false,
	`preWindowDays` int NOT NULL DEFAULT 0,
	`postWindowDays` int NOT NULL DEFAULT 20,
	`outcomeHorizonsJson` longtext,
	`batchSize` int NOT NULL DEFAULT 1000,
	`configVersion` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dataset_build_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dataset_build_config_version` UNIQUE(`datasetVersionId`)
);
--> statement-breakpoint

-- ===========================================================================
-- 事件维度（相对日 × 事件类型，多值，OR 语义）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `dataset_build_config_event` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`configId` bigint NOT NULL,
	`relativeDay` int NOT NULL,
	`eventKind` varchar(32) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `dataset_build_config_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dbc_event_config_day_kind` UNIQUE(`configId`,`relativeDay`,`eventKind`)
);
--> statement-breakpoint
CREATE INDEX `idx_dbc_event_config` ON `dataset_build_config_event` (`configId`);
--> statement-breakpoint

-- ===========================================================================
-- 板块（多值；空 = 不过滤）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `dataset_build_config_board` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`configId` bigint NOT NULL,
	`board` varchar(32) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `dataset_build_config_board_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dbc_board_config_board` UNIQUE(`configId`,`board`)
);
--> statement-breakpoint
CREATE INDEX `idx_dbc_board_config` ON `dataset_build_config_board` (`configId`);
