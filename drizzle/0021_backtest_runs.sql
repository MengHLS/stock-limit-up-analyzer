-- Baseline correction — backtest_runs（回测结果持久化表）
-- 说明：该表历史上通过 scripts/migrate_add_backtest_runs.ts 手动脚本创建（项目早期采用 push 而非 migrate 日志），
--   已存在于生产库与 drizzle/meta 快照中，但缺少对应 migration 文件。
--   本文件为 reconciliation 阶段补全，使用 IF NOT EXISTS 保持幂等，语义与 drizzle/schema.ts 的 backtestRuns 完全一致。

CREATE TABLE IF NOT EXISTS `backtest_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paramsHash` varchar(64) NOT NULL,
	`paramsJson` text NOT NULL,
	`summaryJson` text,
	`resultJson` longtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backtest_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_hash` ON `backtest_runs` (`paramsHash`);--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_created` ON `backtest_runs` (`createdAt`);
