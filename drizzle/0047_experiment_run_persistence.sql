-- RESEARCH-EXPERIMENT-004 — Independent Experiment 持久化（Run 元数据落 TiDB）
--
-- 依据：规格 §5「先确认 migration ledger」+ §12「Run 执行生命周期」+ §21「完成标准 A」。
--   ledger 实查：`drizzle/*.sql` 已至 `0046_legacy_research_retire.sql`（003 产出）
--   ⇒ 本 migration 取号 **0047**（禁 `db:push` / 禁 `drizzle-kit generate`；
--   自 0024 起 `drizzle/meta/_journal.json` 已停维护，**不是**编号真源）。
--
-- 本 migration 只做一件事（纯增量、不改名、不重建、不删数据、不迁移数据）：
--   ① `research_experiment_run` —— 新表（独立实验体系的 **Run 元数据**）
--
-- 🔴 为什么**不**同时建 `experiment` 表（规格 §4 的 Experiment 元数据）：
--   本体系的 Experiment 元数据是**代码声明**的（`research-experiments/manifest.ts` +
--   `server/researchExperiments/registry.ts`），随 git 版本化；再建一张 DB 表会让
--   「代码里的定义」与「DB 里的行」成为**两个真源**，漂移时无法判定谁对。
--   规格 §4 自己写明「优先扩展现有表，不重复创建同义表」、§20 禁止「重做 Experiment Framework」。
--   「历史 Run 仍可读懂」改由**快照列**兑现：experimentName / experimentVersion /
--   datasetCode / datasetVersionLabel / parametersJson 都写下运行当时的值。
--
-- 🔴 落库边界（规格 §2 / §17）：
--   - **进本表**：Run 身份 / 实验坐标快照 / Dataset 坐标 / 参数快照 / 生命周期状态 /
--     起止时间 / 耗时 / 错误码与消息 / Manifest 对象 Key / 结果 schema 版本 / 轻量摘要；
--   - **不进本表**：结果信封本体、表格 / 图表 / CSV / Parquet / 日志 ——
--     它们是「大产物」，一律落对象存储（MinIO），本表只存引用。
--   - **不复制 Dataset**：只有 `datasetVersionId` 一个坐标（软引用）。
--
-- 🔴 硬约束（违反即架构错误）：
--   - **零 FK**（全库既有原则：soft reference + 应用层校验）⇒ 本 migration 不加任何 FK；
--   - JSON 列一律 `longtext` 且列名以 `Json` 结尾（与 `strategy_research_provenance` 等一致）；
--   - 状态列 `varchar` + 集中 TS 联合类型（不用 `mysqlEnum`，便于扩状态而不动 DDL）；
--   - 与已退役的 `research_experiments`（003 已 DROP）**无任何关系**；
--     本表不出现 Analysis / Finding / Conclusion 任何锚列（规格 §20 禁恢复旧 Research）；
--   - 本 migration **零 DML**（只有 DDL）⇒ 不改任何既有行的内容，无 backfill。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行，重复运行无副作用
--   （第二次应为 0 executed / 5 skipped）。
-- 回滚（如需要）：DROP TABLE `research_experiment_run`（Run 元数据随之消失；
--   对象存储里的产物需要另行清理 —— 这是刻意的：本任务不实现跨介质级联删除）。
--
-- 应用：`node scripts/applySqlMigration.mjs drizzle/0047_experiment_run_persistence.sql`

-- ===========================================================================
-- ① research_experiment_run —— 新表（Run 元数据）
-- ===========================================================================

-- @guard: table research_experiment_run
CREATE TABLE IF NOT EXISTS `research_experiment_run` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`runId` varchar(80) NOT NULL,
	`experimentId` varchar(96) NOT NULL,
	`experimentName` varchar(200) NOT NULL,
	`experimentVersion` varchar(32) NOT NULL,
	`datasetVersionId` bigint NOT NULL,
	`datasetCode` varchar(64) NOT NULL,
	`datasetVersionLabel` varchar(96) NOT NULL,
	`parametersJson` longtext NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'PENDING',
	`startedAt` timestamp NULL,
	`completedAt` timestamp NULL,
	`durationMs` int,
	`errorCode` varchar(64),
	`errorMessage` text,
	`resultManifestKey` varchar(512),
	`resultSchemaVersion` varchar(32),
	`summaryJson` longtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_experiment_run_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_research_experiment_run_id` UNIQUE(`runId`)
);
--> statement-breakpoint
-- @guard: index research_experiment_run.idx_research_experiment_run_experiment
CREATE INDEX `idx_research_experiment_run_experiment` ON `research_experiment_run` (`experimentId`, `id`);
--> statement-breakpoint
-- @guard: index research_experiment_run.idx_research_experiment_run_status
CREATE INDEX `idx_research_experiment_run_status` ON `research_experiment_run` (`status`);
--> statement-breakpoint
-- @guard: index research_experiment_run.idx_research_experiment_run_dataset
CREATE INDEX `idx_research_experiment_run_dataset` ON `research_experiment_run` (`datasetVersionId`);
--> statement-breakpoint
