CREATE INDEX `idx_limit_up_date` ON `limit_up_records` (`limitUpDate`);--> statement-breakpoint
CREATE INDEX `idx_stock_code` ON `limit_up_records` (`stockCode`);--> statement-breakpoint
CREATE INDEX `idx_sector` ON `limit_up_records` (`sector`);--> statement-breakpoint
CREATE INDEX `idx_created_by` ON `limit_up_records` (`createdBy`);--> statement-breakpoint
CREATE INDEX `idx_date_stock` ON `limit_up_records` (`limitUpDate`,`stockCode`);--> statement-breakpoint
CREATE INDEX `idx_date_sector` ON `limit_up_records` (`limitUpDate`,`sector`);--> statement-breakpoint
CREATE INDEX `idx_data_date` ON `market_data` (`dataDate`);--> statement-breakpoint
CREATE INDEX `idx_user_id` ON `stock_watchlist` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_user_stock` ON `stock_watchlist` (`userId`,`stockCode`);--> statement-breakpoint
CREATE INDEX `idx_status` ON `uploaded_images` (`status`);--> statement-breakpoint
CREATE INDEX `idx_created_by_images` ON `uploaded_images` (`createdBy`);