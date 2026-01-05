CREATE TABLE `limit_up_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stockCode` varchar(20) NOT NULL,
	`stockName` varchar(50) NOT NULL,
	`limitUpDate` date NOT NULL,
	`limitUpTime` varchar(20),
	`boardCount` varchar(20),
	`circulationValue` varchar(20),
	`turnover` varchar(20),
	`sector` varchar(100),
	`keywords` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `limit_up_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `uploaded_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileKey` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`originalName` varchar(255),
	`limitUpDate` date,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `uploaded_images_id` PRIMARY KEY(`id`)
);
