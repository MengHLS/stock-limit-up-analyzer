-- STEP DATASET-001 — Dataset Registry + 首板回踩 Dataset 独立物理表
-- 架构：Raw Data → Common Data → Dataset Registry → Dataset Physical Tables → Strategy → Backtest
--
-- 核心原则（不可违背）：
--   1. 一个逻辑 Dataset = 一组固定物理表；多个 Dataset Version 通过 dataset_version_id 隔离；
--      禁止「一个 Version 创建一套物理表」（禁止 ds_xxx_v1_event / ds_xxx_v2_event）。
--   2. 物理表命名 = ds_{dataset_code}_{role}（role ∈ event/path/outcome/feature）。
--   3. Dataset 只描述客观市场事实（事件/路径/特征/未来结果），禁止绑定 Strategy
--      （禁止 buy_signal/stop_loss/position_size/strategy_id 等字段）。
--   4. 不复制公共 OHLCV（stock_daily_prices）——Dataset 通过 symbol+trade_date 引用公共数据层。
--   5. path.relative_day 必须用交易日历（Trading Calendar），禁止自然日 +1。
--   6. 严格防 Future Leakage：event/path 的事实字段仅用 D0 及之前信息；outcome 可存未来结果
--      但不得泄漏进 Signal（feature 与 outcome 边界在代码/查询接口层强制）。
--
-- 列名口径：沿用项目 camelCase 列约定（与 drizzle schema.ts / 既有表一致）；
-- 表名沿用 snake_case（与 research_datasets / strategy_versions 一致）。
-- id 使用 BIGINT（STEP §7/§9/§11/§13/§15/§17 显式要求），为 path 千万级行留余量。

-- ===========================================================================
-- Dataset Registry：dataset_definition（逻辑 Dataset）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `dataset_definition` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetCode` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`datasetType` varchar(32) NOT NULL,
	`storageType` varchar(32) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`eventTableName` varchar(128),
	`pathTableName` varchar(128),
	`outcomeTableName` varchar(128),
	`featureTableName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dataset_definition_id` PRIMARY KEY(`id`),
	CONSTRAINT `dataset_definition_dataset_code_unique` UNIQUE(`datasetCode`)
);
--> statement-breakpoint
CREATE INDEX `idx_dataset_definition_type` ON `dataset_definition` (`datasetType`);
--> statement-breakpoint
CREATE INDEX `idx_dataset_definition_status` ON `dataset_definition` (`status`);

-- ===========================================================================
-- Dataset Registry：dataset_version（逻辑版本，不创建物理表）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `dataset_version` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetId` bigint NOT NULL,
	`version` varchar(32) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'DRAFT',
	`startDate` date,
	`endDate` date,
	`universeDefinitionJson` longtext,
	`filterDefinitionJson` longtext,
	`featureVersion` varchar(32),
	`sourceVersion` varchar(32),
	`totalEvents` bigint,
	`totalRows` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `dataset_version_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dataset_version_dataset_version` UNIQUE(`datasetId`, `version`)
);
--> statement-breakpoint
CREATE INDEX `idx_dataset_version_dataset` ON `dataset_version` (`datasetId`);
--> statement-breakpoint
CREATE INDEX `idx_dataset_version_status` ON `dataset_version` (`status`);

-- ===========================================================================
-- Dataset Registry：dataset_build_job（构建作业，支持 resume/retry/checkpoint）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `dataset_build_job` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetVersionId` bigint NOT NULL,
	`jobId` varchar(64) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'PENDING',
	`totalChunks` bigint,
	`completedChunks` bigint,
	`currentChunk` bigint,
	`processedRows` bigint,
	`failedRows` bigint,
	`lastSymbol` varchar(32),
	`lastTradeDate` date,
	`lastCursor` longtext,
	`startedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	`errorMessage` text,
	CONSTRAINT `dataset_build_job_id` PRIMARY KEY(`id`),
	CONSTRAINT `dataset_build_job_job_id_unique` UNIQUE(`jobId`)
);
--> statement-breakpoint
CREATE INDEX `idx_dataset_build_job_version` ON `dataset_build_job` (`datasetVersionId`);
--> statement-breakpoint
CREATE INDEX `idx_dataset_build_job_status` ON `dataset_build_job` (`status`);

-- ===========================================================================
-- 首板回踩 Dataset：event（一行 = 一只股票某交易日一次「首板」事件）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `ds_first_limit_pullback_event` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetVersionId` bigint NOT NULL,
	`eventId` varchar(64) NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`tradeDate` date NOT NULL,
	`market` varchar(16),
	`industryCode` varchar(32),
	`boardType` varchar(32),
	`open` double,
	`high` double,
	`low` double,
	`close` double,
	`previousClose` double,
	`limitUpPrice` double,
	`volume` double,
	`amount` double,
	`turnover` double,
	`isFirstLimit` boolean,
	`previousLimitDate` date,
	`daysSincePreviousLimit` int,
	`historicalLimitCount` int,
	`marketCap` double,
	`floatMarketCap` double,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ds_flp_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ds_flp_event_version_event` UNIQUE(`datasetVersionId`, `eventId`)
);
--> statement-breakpoint
CREATE INDEX `idx_ds_flp_event_version_date` ON `ds_first_limit_pullback_event` (`datasetVersionId`, `tradeDate`);
--> statement-breakpoint
CREATE INDEX `idx_ds_flp_event_symbol_date` ON `ds_first_limit_pullback_event` (`symbol`, `tradeDate`);

-- ===========================================================================
-- 首板回踩 Dataset：path（一行 = 一个 event + 一个 relative trading day）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `ds_first_limit_pullback_path` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetVersionId` bigint NOT NULL,
	`eventId` varchar(64) NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`tradeDate` date NOT NULL,
	`relativeDay` int NOT NULL,
	`open` double,
	`high` double,
	`low` double,
	`close` double,
	`volume` double,
	`amount` double,
	`turnover` double,
	`returnFromEventClose` double,
	`highFromEventClose` double,
	`lowFromEventClose` double,
	`closeFromEventClose` double,
	`pullbackFromEventClose` double,
	`pullbackFromEventHigh` double,
	`volumeRatio` double,
	`isBreakout` boolean,
	`breakoutPrice` double,
	`daysToBreakout` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ds_flp_path_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ds_flp_path_version_event_day` UNIQUE(`datasetVersionId`, `eventId`, `relativeDay`)
);
--> statement-breakpoint
CREATE INDEX `idx_ds_flp_path_event_day` ON `ds_first_limit_pullback_path` (`eventId`, `relativeDay`);
--> statement-breakpoint
CREATE INDEX `idx_ds_flp_path_symbol_date` ON `ds_first_limit_pullback_path` (`symbol`, `tradeDate`);
--> statement-breakpoint
CREATE INDEX `idx_ds_flp_path_version_day` ON `ds_first_limit_pullback_path` (`datasetVersionId`, `relativeDay`);

-- ===========================================================================
-- 首板回踩 Dataset：outcome（一行 = 一个 event + 一个 horizon 的未来结果）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `ds_first_limit_pullback_outcome` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetVersionId` bigint NOT NULL,
	`eventId` varchar(64) NOT NULL,
	`horizon` int NOT NULL,
	`maxReturn` double,
	`minReturn` double,
	`maxDrawdown` double,
	`isBreakout` boolean,
	`daysToBreakout` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ds_flp_outcome_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ds_flp_outcome_version_event_horizon` UNIQUE(`datasetVersionId`, `eventId`, `horizon`)
);
--> statement-breakpoint
CREATE INDEX `idx_ds_flp_outcome_event_horizon` ON `ds_first_limit_pullback_outcome` (`eventId`, `horizon`);
