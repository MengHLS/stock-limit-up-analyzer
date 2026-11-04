-- STEP 7.5 — Historical Security Status / ST / Trading Status（1 张新表）
-- 注意：本文件为手动编写（与 drizzle/schema.ts 一致）。
-- 编号：reconciliation 后规范为 0018（原 0017_security_status_history.sql 与 0017_corporate_actions.sql 曾重复编号 0017）。
-- securityId 为软引用 research_securities.securityId（sec_<uuid>），不加 FK；待 7.4 落地后按需补。

CREATE TABLE `research_security_status_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`securityId` varchar(48) NOT NULL,
	`statusType` enum('LISTING','TRADING','ST','DELISTING','SUSPENSION') NOT NULL,
	`statusValue` varchar(32) NOT NULL,
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`source` varchar(64) NOT NULL,
	`retrievedAt` timestamp,
	`confidence` enum('high','medium','low') NOT NULL,
	`availability` enum('IMMEDIATE','T_PLUS_1','UNKNOWN') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_security_status_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_security_status_security_type_from` ON `research_security_status_history` (`securityId`,`statusType`,`effectiveFrom`);
--> statement-breakpoint
CREATE INDEX `idx_security_status_type_from` ON `research_security_status_history` (`statusType`,`effectiveFrom`);
