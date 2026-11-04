-- STEP STRATEGY-002 — 策略持久化表（strategies + strategy_versions）
-- strategies：策略逻辑实体（strategyId 唯一 + name + latestVersion + status + 时间戳）
-- strategy_versions：不可变版本快照（(strategyId, version) 唯一，strategyDocumentJson + versionRecordJson）
-- 不可变 + 并发兜底：uq_strategy_versions_id_version 唯一约束。

CREATE TABLE IF NOT EXISTS `strategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`latestVersion` varchar(32) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'Draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategies_id` PRIMARY KEY(`id`),
	CONSTRAINT `strategies_strategyId_unique` UNIQUE(`strategyId`)
);
--> statement-breakpoint
CREATE INDEX `idx_strategies_strategy_id` ON `strategies` (`strategyId`);
--> statement-breakpoint
CREATE INDEX `idx_strategies_created` ON `strategies` (`createdAt`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `strategy_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` varchar(64) NOT NULL,
	`version` varchar(32) NOT NULL,
	`strategyDocumentJson` longtext NOT NULL,
	`versionRecordJson` longtext NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`datasetVersion` varchar(96) NOT NULL,
	`universeId` varchar(128) NOT NULL,
	`codeVersion` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `strategy_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_strategy_versions_id_version` UNIQUE(`strategyId`, `version`)
);
--> statement-breakpoint
CREATE INDEX `idx_strategy_versions_strategy` ON `strategy_versions` (`strategyId`);
--> statement-breakpoint
CREATE INDEX `idx_strategy_versions_created` ON `strategy_versions` (`createdAt`);
