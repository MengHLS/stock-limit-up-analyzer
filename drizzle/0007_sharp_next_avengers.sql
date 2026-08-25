CREATE TABLE `stock_daily_prices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stockCode` varchar(20) NOT NULL,
	`tradeDate` date NOT NULL,
	`openPrice` varchar(24) NOT NULL,
	`closePrice` varchar(24) NOT NULL,
	`preClosePrice` varchar(24) NOT NULL,
	`source` varchar(32) NOT NULL DEFAULT 'tushare',
	`sourceUpdatedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stock_daily_prices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_stock_daily_price_stock_date` ON `stock_daily_prices` (`stockCode`,`tradeDate`);--> statement-breakpoint
CREATE INDEX `idx_stock_daily_price_trade_date` ON `stock_daily_prices` (`tradeDate`);