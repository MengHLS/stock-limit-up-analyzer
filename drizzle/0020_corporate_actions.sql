-- STEP 7.7 — Corporate Action & Adjustment Data 基础设施（2 张新表）
-- 说明：本文件为手动编写（与 drizzle/schema.ts 的 corporateActions / adjustmentFactors 一致）。
-- 编号：reconciliation 后规范为 0020（原 0017_corporate_actions.sql，与 0017_security_status_history.sql 曾重复编号 0017）。
-- 本迁移只建表，不写入任何数据（复权层为 Derived Layer，后续回填）。

CREATE TABLE `corporate_actions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `securityId` varchar(20) NOT NULL,
  `actionType` enum('dividend','bonus_issue','transfer','rights_issue','split','reverse_split','other') NOT NULL,
  `effectiveDate` date NOT NULL,
  `recordDate` date,
  `announcementDate` date,
  `cashAmount` varchar(32),
  `bonusRatio` varchar(32),
  `transferRatio` varchar(32),
  `rightsRatio` varchar(32),
  `rightsPrice` varchar(32),
  `splitRatio` varchar(32),
  `description` text,
  `source` varchar(32) NOT NULL,
  `retrievedAt` timestamp NOT NULL DEFAULT (now()),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `corporate_actions_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_corporate_action_security_date_type` UNIQUE(`securityId`,`effectiveDate`,`actionType`)
);
--> statement-breakpoint
CREATE INDEX `idx_corporate_action_security_effective` ON `corporate_actions` (`securityId`,`effectiveDate`);
--> statement-breakpoint
CREATE TABLE `adjustment_factors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `securityId` varchar(20) NOT NULL,
  `effectiveDate` date NOT NULL,
  `foreFactor` varchar(32) NOT NULL,
  `backFactor` varchar(32) NOT NULL,
  `source` varchar(32) NOT NULL,
  `retrievedAt` timestamp NOT NULL DEFAULT (now()),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `adjustment_factors_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_adjustment_factor_security_date` UNIQUE(`securityId`,`effectiveDate`)
);
--> statement-breakpoint
CREATE INDEX `idx_adjustment_factor_security_date` ON `adjustment_factors` (`securityId`,`effectiveDate`);
