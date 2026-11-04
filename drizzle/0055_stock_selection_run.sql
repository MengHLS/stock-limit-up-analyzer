-- STOCK-SELECTION-005 — 选股结果持久化（`stock_selection_run`）
--
-- 依据：用户授权（2026-10-06「允许执行 0055 + 手动保存(B) + 同页历史(A)」）+
--   影响报告六项（见 docs/architecture/CHANGE-AUDIT.md · STOCK-SELECTION-005）。
--   ledger 实查：`drizzle/*.sql` 已至 `0054_first_limit_pool_streaming_index.sql`
--   ⇒ 本 migration 取号 **0055**（禁 `db:push` / 禁 `drizzle-kit generate`；
--   自 0024 起 `drizzle/meta/_journal.json` 已停维护，**不是**编号真源）。
--
-- 本 migration 只做一件事（纯增量、不改名、不重建、不删数据、不迁移数据）：
--   ① `stock_selection_run` —— 新表（每次**手动保存**的选股结果快照 + 剔除统计）
--
-- 🔴 落库边界：
--   - **进本表**：选股坐标快照（strategy/source/datasetVersionId/decisionDate/topN）+
--     选股清单（`picksJson`）+ **剔除统计（`excludedJson`）** + 数据窗口 + 捕获时间；
--   - **不进本表**：不复制行情 / 不复制数据集 / 不建第二套打分口径 —— 本表只冻结
--     「当时算出来的是什么」，重算永远走既有权威实现。
--   - **datasetVersionId 可空**：`live` 载体无数据集坐标；`dataset` 载体才有值（软引用
--     `dataset_version.id`，全库 0 FK 原则）。
--   - **runId 确定性**：同一 (strategyId, sourceKind, datasetVersionId, decisionDate, topN)
--     复用同一 runId ⇒ 重复保存是 **UPSERT 覆盖**，不产生重复行。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行；重复运行无副作用
--   （第二次应为 0 executed / 3 skipped）。
-- 回滚：DROP TABLE `stock_selection_run`（会一并丢弃已保存的历史选股结果）。
--   如需保留历史：`RENAME TABLE `stock_selection_run` TO `archive_stock_selection_run_<date>``。
--
-- 应用：`node scripts/applySqlMigration.mjs drizzle/0055_stock_selection_run.sql`

-- ===========================================================================
-- ① stock_selection_run —— 新表（选股结果 + 剔除统计快照）
-- ===========================================================================

-- @guard: table stock_selection_run
CREATE TABLE IF NOT EXISTS `stock_selection_run` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`runId` varchar(80) NOT NULL,
	`strategyId` varchar(64) NOT NULL,
	`strategyLabel` varchar(200) NOT NULL,
	`sourceKind` varchar(16) NOT NULL,
	`sourceLabel` varchar(96) NOT NULL,
	`datasetVersionId` bigint,
	`decisionDate` date NOT NULL,
	`topN` int NOT NULL,
	`candidateEventCount` int NOT NULL,
	`rankedCandidateCount` int NOT NULL,
	`excludedJson` longtext NOT NULL,
	`picksJson` longtext NOT NULL,
	`dataWindowStartDate` date,
	`dataWindowEndDate` date,
	`capturedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stock_selection_run_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_selection_run_runId` UNIQUE(`runId`)
);
--> statement-breakpoint
-- @guard: index stock_selection_run.idx_stock_selection_run_decision
CREATE INDEX `idx_stock_selection_run_decision` ON `stock_selection_run` (`decisionDate`, `id`);
--> statement-breakpoint
-- @guard: index stock_selection_run.idx_stock_selection_run_strategy
CREATE INDEX `idx_stock_selection_run_strategy` ON `stock_selection_run` (`strategyId`, `decisionDate`);
--> statement-breakpoint