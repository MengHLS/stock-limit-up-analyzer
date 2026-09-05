-- Baseline correction — stock_daily_prices.highPrice / volume 两列
-- 说明：这两列历史上通过 scripts/migrate_add_high_volume.ts 手动脚本添加（项目早期采用 push 而非 migrate 日志），
--   已存在于生产库与 drizzle/meta 快照中，但缺少对应 migration 文件。
--   本文件为 reconciliation 阶段补全，语义与 drizzle/schema.ts 的 stockDailyPrices 完全一致。
--   注：生产库这两列已存在；本迁移用于保证全新库的完整重建。若在已含这两列的库上重复执行会报 duplicate column，
--   因此 reconciliation 应用脚本会先检测列是否已存在，已存在则跳过（视为已应用）。

ALTER TABLE `stock_daily_prices` ADD `highPrice` varchar(24);
--> statement-breakpoint
ALTER TABLE `stock_daily_prices` ADD `volume` varchar(32);
