-- FIRST-BOARD-PULLBACK -> COMBO-BACKTEST bridge.
--
-- The original combo backtest consumes objective source facts from
-- `limit_up_records` (封板时间 / 题材 / 关键词 / 成交额 / 流通市值).
-- Persist them on the event row so the independent Experiment module can
-- reconstruct the same candidate score without direct DB access.

-- @guard: column ds_first_limit_pullback_event.limitUpTime
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `limitUpTime` varchar(20) NULL AFTER `turnover`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_event.sector
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `sector` varchar(100) NULL AFTER `limitUpTime`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_event.keywords
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `keywords` text NULL AFTER `sector`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_event.sourceTurnoverAmount
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `sourceTurnoverAmount` double NULL AFTER `keywords`;

--> statement-breakpoint

-- @guard: column ds_first_limit_pullback_event.sourceCirculationValue
ALTER TABLE `ds_first_limit_pullback_event`
  ADD COLUMN `sourceCirculationValue` double NULL AFTER `sourceTurnoverAmount`;
