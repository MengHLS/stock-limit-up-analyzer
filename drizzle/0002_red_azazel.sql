CREATE TABLE `stock_watchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stockCode` varchar(20) NOT NULL,
	`stockName` varchar(50) NOT NULL,
	`watchType` enum('normal','important') NOT NULL DEFAULT 'normal',
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stock_watchlist_id` PRIMARY KEY(`id`)
);
