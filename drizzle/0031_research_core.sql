-- migration 0031 — Research 核心持久层（RESEARCH-001 §3~§13）
--
-- 目标：建立 Dataset-Registry 原生的 Research 领域持久层（10 张表），
--       支撑 Dataset Version → Experiment → Run → Analysis → Result → Conclusion → Strategy Candidate。
--
-- ⚠️ 与遗留 `research_experiments` / `research_runs` / `research_datasets`（复数）**无关**：
--    遗留三表属 STEP 6.x 链路（字符串 experimentId 业务键 + snapshotJson 单一大 JSON + strategyId 驱动），
--    本 migration 的 10 张表（**单数**）以 `datasetVersionId`（bigint，软引用 `dataset_version.id`）为输入边界。
--    两套并存、互不引用、互不读写。详见 docs/research/RESEARCH-001-AUDIT.md §4。
--
-- 核心原则（不可违背）：
--   1. **零数据库 FK** —— 沿用项目 soft reference / application-level integrity 策略；
--      引用合法性由 server/researchCore 的 Domain / Repository 层保证。
--   2. **不复制 Dataset 任何数据** —— 无行情表、无 event/prefix/post/path/outcome 副本；
--      只通过 `datasetVersionId` 引用。
--   3. **结构化优先** —— 查询 / 排序 / 过滤 / 聚合用到的字段一律结构化列；
--      只有开放扩展性质的配置才用 JSON（一律 longtext）。
--   4. **Research Result 是统计层，不是样本层** —— 禁止为每个 Dataset 样本生成一行。
--   5. 本 migration 为**纯新增**（CREATE TABLE IF NOT EXISTS），对既有表零改动、可回滚（DROP 10 表即回退）。
--
-- 列名口径：沿用项目 camelCase 列约定；表名 snake_case 单数。
-- 状态 / 类型列：varchar + 应用层 TS 联合类型（与 dataset_* 新表一致，不用 mysqlEnum）。

-- ===========================================================================
-- 1. research_experiment —— 研究实验（输入边界 = 单一 datasetVersionId）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_experiment` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetVersionId` bigint NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`researchType` varchar(32) NOT NULL DEFAULT 'CUSTOM',
	`status` varchar(20) NOT NULL DEFAULT 'DRAFT',
	`configJson` longtext,
	`sampleCount` int,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_experiment_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_experiment_dataset_version` ON `research_experiment` (`datasetVersionId`);
--> statement-breakpoint
CREATE INDEX `idx_research_experiment_status` ON `research_experiment` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_research_experiment_created` ON `research_experiment` (`createdAt`);
--> statement-breakpoint

-- ===========================================================================
-- 2. research_hypothesis —— 研究假设（研究意图；非 Analysis、非 Conclusion）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_hypothesis` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`experimentId` bigint NOT NULL,
	`name` varchar(200) NOT NULL,
	`statement` text NOT NULL,
	`nullHypothesis` text,
	`alternativeHypothesis` text,
	`status` varchar(32) NOT NULL DEFAULT 'DRAFT',
	`conclusion` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_hypothesis_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_hypothesis_experiment` ON `research_hypothesis` (`experimentId`);
--> statement-breakpoint
CREATE INDEX `idx_research_hypothesis_status` ON `research_hypothesis` (`status`);
--> statement-breakpoint

-- ===========================================================================
-- 3. research_run —— 一次实验执行（Experiment ≠ Run；runNo 在实验内唯一）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_run` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`experimentId` bigint NOT NULL,
	`runNo` int NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'PENDING',
	`configJson` longtext,
	`inputSnapshotJson` longtext,
	`sampleCount` int,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`errorCode` varchar(64),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_run_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_research_run_experiment_run_no` UNIQUE(`experimentId`,`runNo`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_run_experiment` ON `research_run` (`experimentId`);
--> statement-breakpoint
CREATE INDEX `idx_research_run_status` ON `research_run` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_research_run_created` ON `research_run` (`createdAt`);
--> statement-breakpoint

-- ===========================================================================
-- 4. research_analysis —— 分析定义（「要执行什么分析」；结果在 research_result）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_analysis` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`runId` bigint NOT NULL,
	`analysisType` varchar(32) NOT NULL,
	`name` varchar(200) NOT NULL,
	`target` varchar(200),
	`configJson` longtext,
	`status` varchar(20) NOT NULL DEFAULT 'PENDING',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `research_analysis_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_analysis_run` ON `research_analysis` (`runId`);
--> statement-breakpoint
CREATE INDEX `idx_research_analysis_type` ON `research_analysis` (`analysisType`);
--> statement-breakpoint
CREATE INDEX `idx_research_analysis_status` ON `research_analysis` (`status`);
--> statement-breakpoint

-- ===========================================================================
-- 5. research_analysis_condition —— 条件研究（结构化条件；支持条件组 AND/OR/NOT）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_analysis_condition` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`analysisId` bigint NOT NULL,
	`groupNo` int NOT NULL DEFAULT 0,
	`sortOrder` int NOT NULL DEFAULT 0,
	`fieldName` varchar(128) NOT NULL,
	`operator` varchar(16) NOT NULL,
	`valueJson` longtext NOT NULL,
	`logicalOperator` varchar(8) NOT NULL DEFAULT 'AND',
	`groupLogicalOperator` varchar(8) NOT NULL DEFAULT 'AND',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_analysis_condition_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_condition_analysis` ON `research_analysis_condition` (`analysisId`);
--> statement-breakpoint
CREATE INDEX `idx_research_condition_field` ON `research_analysis_condition` (`fieldName`);
--> statement-breakpoint

-- ===========================================================================
-- 6. research_analysis_metric —— 分析指标**定义**（实际值在 research_result）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_analysis_metric` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`analysisId` bigint NOT NULL,
	`metricCode` varchar(64) NOT NULL,
	`metricName` varchar(128) NOT NULL,
	`configJson` longtext,
	`displayOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_analysis_metric_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_research_analysis_metric_analysis_code` UNIQUE(`analysisId`,`metricCode`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_metric_analysis` ON `research_analysis_metric` (`analysisId`);
--> statement-breakpoint
CREATE INDEX `idx_research_metric_code` ON `research_analysis_metric` (`metricCode`);
--> statement-breakpoint

-- ===========================================================================
-- 7. research_result —— **统计分析结果层**（单值 / 分组 / 序列；非样本层）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_result` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`analysisId` bigint NOT NULL,
	`resultType` varchar(32) NOT NULL DEFAULT 'SCALAR',
	`dimensionJson` longtext,
	`metricCode` varchar(64) NOT NULL,
	`metricValue` double,
	`sampleCount` int,
	`resultJson` longtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_result_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_result_analysis_metric` ON `research_result` (`analysisId`,`metricCode`);
--> statement-breakpoint
CREATE INDEX `idx_research_result_analysis` ON `research_result` (`analysisId`);
--> statement-breakpoint
CREATE INDEX `idx_research_result_metric` ON `research_result` (`metricCode`);
--> statement-breakpoint

-- ===========================================================================
-- 8. research_conclusion —— 研究结论（必须关联 Experiment；confidence 非 p-value）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_conclusion` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`experimentId` bigint NOT NULL,
	`hypothesisId` bigint,
	`conclusionType` varchar(32) NOT NULL,
	`title` varchar(200) NOT NULL,
	`conclusion` text NOT NULL,
	`evidenceJson` longtext,
	`confidence` double,
	`status` varchar(20) NOT NULL DEFAULT 'DRAFT',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_conclusion_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_conclusion_experiment` ON `research_conclusion` (`experimentId`);
--> statement-breakpoint
CREATE INDEX `idx_research_conclusion_hypothesis` ON `research_conclusion` (`hypothesisId`);
--> statement-breakpoint
CREATE INDEX `idx_research_conclusion_status` ON `research_conclusion` (`status`);
--> statement-breakpoint

-- ===========================================================================
-- 9. research_strategy_candidate —— Research 出口（strategyDefinitionId NULL = 未转正，合法）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_strategy_candidate` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`experimentId` bigint NOT NULL,
	`conclusionId` bigint,
	`strategyDefinitionId` varchar(64),
	`name` varchar(200) NOT NULL,
	`description` text,
	`entryRuleJson` longtext,
	`filterRuleJson` longtext,
	`exitRuleJson` longtext,
	`riskRuleJson` longtext,
	`parameterSpaceJson` longtext,
	`status` varchar(20) NOT NULL DEFAULT 'DRAFT',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_strategy_candidate_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_candidate_experiment` ON `research_strategy_candidate` (`experimentId`);
--> statement-breakpoint
CREATE INDEX `idx_research_candidate_conclusion` ON `research_strategy_candidate` (`conclusionId`);
--> statement-breakpoint
CREATE INDEX `idx_research_candidate_status` ON `research_strategy_candidate` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_research_candidate_strategy` ON `research_strategy_candidate` (`strategyDefinitionId`);
--> statement-breakpoint

-- ===========================================================================
-- 10. research_artifact —— 文件型产物（只存 uri + checksum，禁二进制入库）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_artifact` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`experimentId` bigint,
	`runId` bigint,
	`artifactType` varchar(32) NOT NULL,
	`storageType` varchar(32) NOT NULL DEFAULT 'FILE',
	`uri` text NOT NULL,
	`checksum` varchar(64),
	`metadataJson` longtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_artifact_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_artifact_experiment` ON `research_artifact` (`experimentId`);
--> statement-breakpoint
CREATE INDEX `idx_research_artifact_run` ON `research_artifact` (`runId`);
--> statement-breakpoint
CREATE INDEX `idx_research_artifact_type` ON `research_artifact` (`artifactType`);
