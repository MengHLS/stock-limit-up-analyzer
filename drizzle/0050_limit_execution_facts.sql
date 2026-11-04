-- LIMIT-EXECUTION-FACTS-001 —— first_limit_pullback v3 execution/tradability columns.
--
-- Existing v1/v2 rows stay readable with NULLs; only newly built versions populate
-- these columns through the dataset builder.

-- @guard: column ds_first_limit_pullback_event.limitDownPrice
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `limitDownPrice` double NULL AFTER `limitUpPrice`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_event.limitRuleUp
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `limitRuleUp` double NULL AFTER `limitDownPrice`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_event.limitRuleDown
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `limitRuleDown` double NULL AFTER `limitRuleUp`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_event.limitRuleVersion
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `limitRuleVersion` varchar(32) NULL AFTER `limitRuleDown`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_prefix.preClose
ALTER TABLE `ds_first_limit_pullback_prefix`
  ADD COLUMN `preClose` double NULL AFTER `close`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.preClose
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `preClose` double NULL AFTER `close`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.limitUpPrice
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `limitUpPrice` double NULL AFTER `preClose`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.limitDownPrice
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `limitDownPrice` double NULL AFTER `limitUpPrice`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.limitRuleUp
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `limitRuleUp` double NULL AFTER `limitDownPrice`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.limitRuleDown
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `limitRuleDown` double NULL AFTER `limitRuleUp`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.limitRuleVersion
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `limitRuleVersion` varchar(32) NULL AFTER `limitRuleDown`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.barPresent
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `barPresent` boolean NULL AFTER `limitRuleVersion`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.suspensionStatus
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `suspensionStatus` varchar(16) NULL AFTER `barPresent`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.suspensionSource
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `suspensionSource` varchar(24) NULL AFTER `suspensionStatus`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.openAtLimitUp
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `openAtLimitUp` boolean NULL AFTER `suspensionSource`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.closeAtLimitDown
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `closeAtLimitDown` boolean NULL AFTER `openAtLimitUp`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.oneWordLimitUp
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `oneWordLimitUp` boolean NULL AFTER `closeAtLimitDown`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.oneWordLimitDown
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `oneWordLimitDown` boolean NULL AFTER `oneWordLimitUp`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.canBuyAtOpen
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `canBuyAtOpen` boolean NULL AFTER `oneWordLimitDown`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_post.canSellAtClose
ALTER TABLE `ds_first_limit_pullback_post`
  ADD COLUMN `canSellAtClose` boolean NULL AFTER `canBuyAtOpen`;
