CREATE TABLE `stock_suspension_windows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stockCode` varchar(20) NOT NULL,
	`startDate` date NOT NULL,
	`endDate` date NOT NULL,
	`source` enum('tushare-daily-infer','manual') NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stock_suspension_windows_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_suspension_stock_dates` UNIQUE(`stockCode`,`startDate`,`endDate`)
);
--> statement-breakpoint
CREATE INDEX `idx_suspension_stock` ON `stock_suspension_windows` (`stockCode`);