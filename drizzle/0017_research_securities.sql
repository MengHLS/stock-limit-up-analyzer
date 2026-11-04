-- STEP 7.4 — Security Master（2 张新表）
-- 说明：本文件为 reconciliation 阶段手动补全的迁移，语义与 drizzle/schema.ts 的
--   researchSecurities / researchSecurityIdentifierHistory 完全一致，亦与
--   scripts/migrate_add_security_master.ts 的历史手动脚本语义一致。
-- 关键约束：
--   - securityId 为系统分配的永久身份（sec_<uuid>），与 stock_code 解耦；UNIQUE 落在 securityId。
--   - 标识符历史表【不设】UNIQUE(securityCode) 全局永久约束；
--     唯一性落在 (exchange, securityCode, identifierType, effectiveFrom)，区间重叠由应用层校验。

CREATE TABLE `research_securities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`securityId` varchar(48) NOT NULL,
	`securityType` enum('stock','etf','index','bond','fund') NOT NULL DEFAULT 'stock',
	`exchange` enum('SH','SZ','BJ') NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'CNY',
	`country` varchar(8) NOT NULL DEFAULT 'CN',
	`status` enum('listed','suspended','delisted','terminated','unknown') NOT NULL DEFAULT 'unknown',
	`listedDate` date,
	`delistedDate` date,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_securities_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_securities_securityId_unique` UNIQUE(`securityId`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_securities_exchange` ON `research_securities` (`exchange`);--> statement-breakpoint
CREATE INDEX `idx_research_securities_status` ON `research_securities` (`status`);
--> statement-breakpoint
CREATE TABLE `research_security_identifier_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`securityId` varchar(48) NOT NULL,
	`exchange` enum('SH','SZ','BJ') NOT NULL,
	`securityCode` varchar(20) NOT NULL,
	`identifierType` enum('primary','tushare_ts_code','sina_symbol','baostock_code','tencent_symbol') NOT NULL DEFAULT 'primary',
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`source` varchar(32) NOT NULL DEFAULT 'unknown',
	`retrievedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_security_identifier_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_security_identifier_security` ON `research_security_identifier_history` (`securityId`);--> statement-breakpoint
CREATE INDEX `idx_security_identifier_code` ON `research_security_identifier_history` (`exchange`,`securityCode`);--> statement-breakpoint
CREATE INDEX `idx_security_identifier_effective` ON `research_security_identifier_history` (`effectiveFrom`,`effectiveTo`);--> statement-breakpoint
ALTER TABLE `research_security_identifier_history` ADD CONSTRAINT `uq_security_identifier_code_effective` UNIQUE(`exchange`,`securityCode`,`identifierType`,`effectiveFrom`);
