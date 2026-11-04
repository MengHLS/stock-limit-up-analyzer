CREATE TABLE `research_experiment_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` varchar(64) NOT NULL,
	`strategyId` varchar(64) NOT NULL,
	`strategyVersion` varchar(32) NOT NULL,
	`parameterSpaceJson` longtext NOT NULL,
	`parameterSpaceFingerprint` varchar(64) NOT NULL,
	`experimentIdsJson` longtext NOT NULL,
	`status` enum('created','running','completed','failed','cancelled') NOT NULL DEFAULT 'created',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_experiment_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_experiment_batches_batchId_unique` UNIQUE(`batchId`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_batches_fingerprint` ON `research_experiment_batches` (`parameterSpaceFingerprint`);--> statement-breakpoint
CREATE INDEX `idx_research_batches_created` ON `research_experiment_batches` (`createdAt`);