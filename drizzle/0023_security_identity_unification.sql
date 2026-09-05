-- STEP 11-FINAL-FIX — Canonical Security Identity Unification（PHASE 2）
--
-- 目标：统一「securityId = sec_<uuid>（永久身份，软引用）」与「securityCode = 规范化证券代码（自然键）」。
-- 涉及 4 张 STEP 7.x 表：industry_assignments / liquidity_daily / corporate_actions / adjustment_factors。
-- 这 4 张表当前均为空表（STEP 7.x 数据尚未回填），故可安全地：
--   1) 将 securityId 由 varchar(20) 放宽为 varchar(48) 并置为可空（永久身份，尚未对账到 Security Master 时为 null）；
--   2) 新增 securityCode varchar(20) NOT NULL 作为自然键；
--   3) 将唯一索引/普通索引的主键从 securityId 迁移到 securityCode。
--
-- 约束（遵守任务禁止项）：
--   - 不得直接把 code 写入 securityId；code 只能写入 securityCode。
--   - 本迁移只做结构变更，不写入任何业务数据（securityId 的确定性解析见 server/security/identifierHistory.ts）。
--   - 若未来回填时表非空，须先回填 securityCode 再执行本迁移（当前为空，无需数据迁移）。

-- ---------------------------------------------------------------------------
-- 1. industry_assignments
-- ---------------------------------------------------------------------------
ALTER TABLE `industry_assignments` ADD `securityCode` varchar(20) NOT NULL AFTER `securityId`;
--> statement-breakpoint
ALTER TABLE `industry_assignments` MODIFY `securityId` varchar(48) NULL;
--> statement-breakpoint
ALTER TABLE `industry_assignments` DROP INDEX `uq_industry_assign_security_effective`;
--> statement-breakpoint
ALTER TABLE `industry_assignments` ADD UNIQUE KEY `uq_industry_assign_security_effective` (`securityCode`, `effectiveFrom`);

-- ---------------------------------------------------------------------------
-- 2. liquidity_daily
-- ---------------------------------------------------------------------------
--> statement-breakpoint
ALTER TABLE `liquidity_daily` ADD `securityCode` varchar(20) NOT NULL AFTER `securityId`;
--> statement-breakpoint
ALTER TABLE `liquidity_daily` MODIFY `securityId` varchar(48) NULL;
--> statement-breakpoint
ALTER TABLE `liquidity_daily` DROP INDEX `uq_liquidity_daily_security_date`;
--> statement-breakpoint
ALTER TABLE `liquidity_daily` ADD UNIQUE KEY `uq_liquidity_daily_security_date` (`securityCode`, `tradeDate`);

-- ---------------------------------------------------------------------------
-- 3. corporate_actions
-- ---------------------------------------------------------------------------
--> statement-breakpoint
ALTER TABLE `corporate_actions` ADD `securityCode` varchar(20) NOT NULL AFTER `securityId`;
--> statement-breakpoint
ALTER TABLE `corporate_actions` MODIFY `securityId` varchar(48) NULL;
--> statement-breakpoint
ALTER TABLE `corporate_actions` DROP INDEX `uq_corporate_action_security_date_type`;
--> statement-breakpoint
ALTER TABLE `corporate_actions` ADD UNIQUE KEY `uq_corporate_action_security_date_type` (`securityCode`, `effectiveDate`, `actionType`);
--> statement-breakpoint
ALTER TABLE `corporate_actions` DROP INDEX `idx_corporate_action_security_effective`;
--> statement-breakpoint
ALTER TABLE `corporate_actions` ADD INDEX `idx_corporate_action_security_effective` (`securityCode`, `effectiveDate`);

-- ---------------------------------------------------------------------------
-- 4. adjustment_factors
-- ---------------------------------------------------------------------------
--> statement-breakpoint
ALTER TABLE `adjustment_factors` ADD `securityCode` varchar(20) NOT NULL AFTER `securityId`;
--> statement-breakpoint
ALTER TABLE `adjustment_factors` MODIFY `securityId` varchar(48) NULL;
--> statement-breakpoint
ALTER TABLE `adjustment_factors` DROP INDEX `uq_adjustment_factor_security_date`;
--> statement-breakpoint
ALTER TABLE `adjustment_factors` ADD UNIQUE KEY `uq_adjustment_factor_security_date` (`securityCode`, `effectiveDate`);
--> statement-breakpoint
ALTER TABLE `adjustment_factors` DROP INDEX `idx_adjustment_factor_security_date`;
--> statement-breakpoint
ALTER TABLE `adjustment_factors` ADD INDEX `idx_adjustment_factor_security_date` (`securityCode`, `effectiveDate`);
