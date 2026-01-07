CREATE TABLE `market_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dataDate` date NOT NULL,
	`turnover` varchar(20) NOT NULL,
	`marginBalance` varchar(20) NOT NULL,
	`note` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `market_data_id` PRIMARY KEY(`id`),
	CONSTRAINT `market_data_dataDate_unique` UNIQUE(`dataDate`)
);
