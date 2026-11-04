CREATE TABLE `backfill_checkpoints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tradeDate` date NOT NULL,
	`status` enum('PENDING','RUNNING','SUCCESS','FAILED','SUSPICIOUS','QUOTA_STOPPED') NOT NULL DEFAULT 'PENDING',
	`attempts` int NOT NULL DEFAULT 0,
	`rowCount` int,
	`receivedRows` int,
	`completedAt` timestamp,
	`errorCode` varchar(64),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `backfill_checkpoints_id` PRIMARY KEY(`id`),
	CONSTRAINT `backfill_checkpoints_tradeDate_unique` UNIQUE(`tradeDate`)
);
--> statement-breakpoint
CREATE INDEX `idx_backfill_checkpoints_status` ON `backfill_checkpoints` (`status`);--> statement-breakpoint
CREATE INDEX `idx_backfill_checkpoints_trade_date` ON `backfill_checkpoints` (`tradeDate`);
