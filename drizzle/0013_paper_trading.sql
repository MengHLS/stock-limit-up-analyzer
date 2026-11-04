CREATE TABLE `paper_trading_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(120) NOT NULL,
	`strategyKey` varchar(32) NOT NULL,
	`paramsJson` text NOT NULL,
	`initialCapital` int NOT NULL,
	`status` enum('active','paused','completed') NOT NULL DEFAULT 'active',
	`lastProcessedDate` date,
	`stateJson` longtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paper_trading_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_paper_runs_status` ON `paper_trading_runs` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_paper_runs_created` ON `paper_trading_runs` (`createdAt`);
