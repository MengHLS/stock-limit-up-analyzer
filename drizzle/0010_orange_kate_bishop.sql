CREATE TABLE `operation_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operationType` enum('image_recognition','date_refresh') NOT NULL,
	`status` enum('processing','success','empty','failed') NOT NULL,
	`imageId` int,
	`fileName` varchar(255),
	`requestedDate` date,
	`effectiveDate` date,
	`recognizedCount` int,
	`refreshedCount` int,
	`message` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operation_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_operation_logs_user_created` ON `operation_logs` (`createdBy`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_operation_logs_type_status` ON `operation_logs` (`operationType`,`status`);--> statement-breakpoint
CREATE INDEX `idx_operation_logs_requested_date` ON `operation_logs` (`requestedDate`);--> statement-breakpoint
CREATE INDEX `idx_operation_logs_image` ON `operation_logs` (`imageId`);