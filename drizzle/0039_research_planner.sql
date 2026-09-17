-- RESEARCH-PLANNER-001 — 自动研究编排层：Research Question + Research Plan（纯增量 migration）
--
-- 目标（用户指令 §0）：把 Research 从「用户手工配置大量 Analysis 参数的实验平台」升级为
-- 「用户提出研究问题 → 系统设计并生成实验 → 复用既有 Analysis Executor 执行 →
--   聚合 Finding → 生成研究结论 → 用户判断是否进入 Candidate」。
--
-- ---------------------------------------------------------------------------
-- 本 migration 只做三件事（纯增量、不改名、不重建、不删数据、不迁移数据）
--   ① research_analysis      +5 列 +1 索引   —— 计划溯源（planId / moduleKey / priority / purpose / requiredFlag）
--   ② research_question      新表（13 列 + 4 索引）—— 研究问题（核心业务对象）
--   ③ research_plan          新表（17 列 + 4 索引）—— 研究计划（可预览、可调整、再落成分析）
--
-- ---------------------------------------------------------------------------
-- 🔴 为什么**不**建 `research_plan_analysis` 关系表（用户指令 §24 明确警告的概念重复）
--
--   计划项落库时就是一条 `research_analysis` 行。「计划 ↔ 分析」的关系用
--   `research_analysis.planId` 一个列就表达完了。
--   若另建关系表，会立刻产生三个问题：
--     (a) 分析的优先级有了两个落点（关系表 + 分析行），必然漂移；
--     (b) 出现第二套「分析生命周期」（计划项 vs 真分析），违反 §24「数据库最终必须只有一个清晰的 Analysis 生命周期」；
--     (c) `deleteAnalysisCascade` / 改口径失效链（`maintenance.ts`）都要跟着改第二处。
--   ⇒ 只加关联列，不加关系表。同理**不建** research_analysis_definition / _config（§24 点名的重复概念）。
--
-- 🔴 为什么 **Research Module 不入库**
--
--   「研究方法」（如 PULLBACK_EFFECTIVENESS / EVENT_RETURN_RESEARCH）是**代码级注册表**
--   （`server/researchEngine/planner/moduleRegistry.ts`），它的字段是函数（推荐分析类型 /
--   推荐视界 / 条件构造器），不是数据。落成表只会得到一张「代码改了表没改」的僵尸表。
--   `research_plan.moduleKeysJson` 只**快照本次用了哪些键**，保证历史计划可复核。
--
-- 🔴 为什么 Research Question 必须独立成表（而不是塞进 research_experiment）
--
--   ① 生命周期不同：Question 可以先存在（DRAFT）、被改、被放弃（REJECTED），
--      而 Experiment 一旦创建就绑定 datasetVersionId 且不可改（既有铁律）。
--   ② 一个 Question 可以产生多份计划（换方法 / 换窗口重试），Experiment 只能有一个 datasetVersionId。
--   ③ 「用户原话」必须原样保留（`questionText`）—— 它是后续一切溯源的根，禁归一化后落库。
--
-- 🔴 硬约束
--   - 全库**零 FK**（项目既有原则：soft reference + 应用层校验）⇒ 本 migration 不加任何 FK；
--   - Dataset 坐标唯一 = `datasetVersionId = dataset_version.id`，本 migration 不引入第二套；
--   - 新增列全部可空 / 新表从 0 行开始，既有 12 实验 / 15 Run / 300+ 分析零影响；
--   - 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`（自 0024 起停维护）。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行，重复运行无副作用。
-- ===========================================================================

-- ===========================================================================
-- ① research_analysis —— 计划溯源（+5 列 +1 索引）
--    5 列全部 NULL-able：人工创建的分析（专家模式）保持 NULL，零回填。
-- ===========================================================================

-- @guard: column research_analysis.planId
ALTER TABLE `research_analysis` ADD COLUMN `planId` bigint;
--> statement-breakpoint
-- @guard: column research_analysis.moduleKey
ALTER TABLE `research_analysis` ADD COLUMN `moduleKey` varchar(64);
--> statement-breakpoint
-- @guard: column research_analysis.priority
ALTER TABLE `research_analysis` ADD COLUMN `priority` varchar(4);
--> statement-breakpoint
-- @guard: column research_analysis.purpose
ALTER TABLE `research_analysis` ADD COLUMN `purpose` varchar(300);
--> statement-breakpoint
-- @guard: column research_analysis.requiredFlag
ALTER TABLE `research_analysis` ADD COLUMN `requiredFlag` tinyint;
--> statement-breakpoint
-- @guard: index research_analysis.idx_research_analysis_plan
CREATE INDEX `idx_research_analysis_plan` ON `research_analysis` (`planId`);
--> statement-breakpoint

-- ===========================================================================
-- ② research_question —— 研究问题（核心业务对象）
-- ===========================================================================

-- @guard: table research_question
CREATE TABLE IF NOT EXISTS `research_question` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`datasetVersionId` bigint NOT NULL,
	`questionText` text NOT NULL,
	`researchType` varchar(32) NOT NULL,
	`createdBy` varchar(16) NOT NULL DEFAULT 'USER',
	`intentJson` longtext,
	`status` varchar(20) NOT NULL DEFAULT 'DRAFT',
	`experimentId` bigint,
	`planId` bigint,
	`runId` bigint,
	`conclusionId` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_question_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- @guard: index research_question.idx_research_question_dataset_version
CREATE INDEX `idx_research_question_dataset_version` ON `research_question` (`datasetVersionId`);
--> statement-breakpoint
-- @guard: index research_question.idx_research_question_status
CREATE INDEX `idx_research_question_status` ON `research_question` (`status`);
--> statement-breakpoint
-- @guard: index research_question.idx_research_question_experiment
CREATE INDEX `idx_research_question_experiment` ON `research_question` (`experimentId`);
--> statement-breakpoint
-- @guard: index research_question.idx_research_question_created
CREATE INDEX `idx_research_question_created` ON `research_question` (`createdAt`);
--> statement-breakpoint

-- ===========================================================================
-- ③ research_plan —— 研究计划（执行前可预览的完整计划 + 落成计数）
-- ===========================================================================

-- @guard: table research_plan
CREATE TABLE IF NOT EXISTS `research_plan` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`questionId` bigint NOT NULL,
	`experimentId` bigint NOT NULL,
	`runId` bigint,
	`datasetVersionId` bigint NOT NULL,
	`moduleKeysJson` longtext,
	`planJson` longtext,
	`plannedCount` int NOT NULL DEFAULT 0,
	`materializedCount` int NOT NULL DEFAULT 0,
	`droppedCount` int NOT NULL DEFAULT 0,
	`maxAnalysisPerPlan` int NOT NULL DEFAULT 0,
	`capApplied` tinyint NOT NULL DEFAULT 0,
	`generatedBy` varchar(16) NOT NULL DEFAULT 'SYSTEM',
	`status` varchar(20) NOT NULL DEFAULT 'PLANNED',
	`notesJson` longtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_plan_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- @guard: index research_plan.idx_research_plan_question
CREATE INDEX `idx_research_plan_question` ON `research_plan` (`questionId`);
--> statement-breakpoint
-- @guard: index research_plan.idx_research_plan_experiment
CREATE INDEX `idx_research_plan_experiment` ON `research_plan` (`experimentId`);
--> statement-breakpoint
-- @guard: index research_plan.idx_research_plan_run
CREATE INDEX `idx_research_plan_run` ON `research_plan` (`runId`);
--> statement-breakpoint
-- @guard: index research_plan.idx_research_plan_status
CREATE INDEX `idx_research_plan_status` ON `research_plan` (`status`);
--> statement-breakpoint
