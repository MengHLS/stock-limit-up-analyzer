-- Research Dataset 持久化表（P2-T1 / G2）
-- 把 buildResearchDataset 产物落库：datasetVersion + 版本快照 + policySet + data_snapshot + universe。
-- 幂等：datasetId 唯一（DS-<datasetVersion>）；同内容重跑不产生重复行。

CREATE TABLE IF NOT EXISTS `research_datasets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`datasetId` varchar(128) NOT NULL,
	`datasetVersion` varchar(96) NOT NULL,
	`name` varchar(128) NOT NULL,
	`startDate` date NOT NULL,
	`endDate` date NOT NULL,
	`asOfPerTradeDate` enum('true','false') NOT NULL DEFAULT 'true',
	`asOf` date,
	`rowsFingerprint` varchar(64) NOT NULL,
	`policySetFingerprint` varchar(64) NOT NULL,
	`versionSnapshotFingerprint` varchar(64) NOT NULL,
	`versionSnapshotJson` longtext NOT NULL,
	`dataSnapshotJson` longtext NOT NULL,
	`universeDefinitionJson` longtext NOT NULL,
	`rowCount` int NOT NULL,
	`gate` varchar(16) NOT NULL,
	`gateNotesJson` longtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_datasets_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_datasets_datasetId_unique` UNIQUE(`datasetId`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_datasets_version` ON `research_datasets` (`datasetVersion`);
--> statement-breakpoint
CREATE INDEX `idx_research_datasets_name` ON `research_datasets` (`name`);
--> statement-breakpoint
CREATE INDEX `idx_research_datasets_created` ON `research_datasets` (`createdAt`);
