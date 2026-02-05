CREATE TABLE `sentiment_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertDate` date NOT NULL,
	`alertType` enum('warming','cooling','extreme_hot','extreme_cold') NOT NULL,
	`title` varchar(100) NOT NULL,
	`description` text,
	`currentScore` int NOT NULL,
	`previousScore` int,
	`scoreChange` int,
	`totalLimitUp` int,
	`connectionBoards` int,
	`maxBoards` int,
	`isRead` enum('0','1') NOT NULL DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sentiment_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_alert_date` ON `sentiment_alerts` (`alertDate`);--> statement-breakpoint
CREATE INDEX `idx_alert_type` ON `sentiment_alerts` (`alertType`);--> statement-breakpoint
CREATE INDEX `idx_is_read` ON `sentiment_alerts` (`isRead`);