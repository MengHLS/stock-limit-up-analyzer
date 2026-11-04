CREATE TABLE `research_experiments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`experimentId` varchar(64) NOT NULL,
	`strategyId` varchar(64) NOT NULL,
	`strategyVersion` varchar(32) NOT NULL,
	`snapshotJson` longtext NOT NULL,
	`status` enum('created','running','completed','failed') NOT NULL DEFAULT 'created',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_experiments_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_experiments_experimentId_unique` UNIQUE(`experimentId`)
);
--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(96) NOT NULL,
	`experimentId` varchar(64) NOT NULL,
	`status` enum('running','succeeded','failed') NOT NULL DEFAULT 'running',
	`resultJson` longtext,
	`error` text,
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_runs_runId_unique` UNIQUE(`runId`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_experiments_created` ON `research_experiments` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_research_runs_experiment` ON `research_runs` (`experimentId`);--> statement-breakpoint
CREATE INDEX `idx_research_runs_created` ON `research_runs` (`createdAt`);