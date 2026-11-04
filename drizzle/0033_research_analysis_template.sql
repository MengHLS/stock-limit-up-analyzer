-- migration 0033 — 分析模板（RESEARCH-002C）
--
-- 背景：用户「我需要手动建立很多分析，有没有什么办法可以减少这个过程」。
-- 除了「一次提交建一组」（批量矩阵 / 标准套件，纯请求侧能力、无需落库）之外，
-- 还有一类重复跨实验复现：同一套分析设计换个数据集/换个实验还要再来一遍。
-- 本 migration 为它提供**可跨实验复用**的持久化「配方」。
--
-- 表结构（主表 + 子表，沿用 DATASET-003B 定下的纪律）：
--   research_analysis_template        模板头（名字全局唯一 → 「一键铺开」时不歧义）
--   research_analysis_template_item   模板明细（一个待展开的分析定义）
--
-- 为什么是两张表而不是「一个 JSON 存全部」（DATASET-003B 明确拒绝纯 JSON 一把梭）：
--   1. 明细项需要**确定性顺序**（`sortOrder`）与按模板的整体替换语义 —— 关系表天然表达；
--   2. 明细项需要被单独检索/统计（例：哪些模板用到 QUANTILE），结构化列可索引；
--   3. 模板头需要**唯一约束**（name），JSON 里做不到。
--   例外：明细项的**条件**用 `conditionsJson`（而非第三张关系表）。理由是条件是「配置快照」，
--   既不索引也不约束；且**真正落库为分析时仍写 `research_analysis_condition` 关系表**，
--   口径不降级。详见 server/researchCore/types.ts#ResearchAnalysisTemplateItem 的注释。
--
-- 身份与引用：
--   - 模板**不属于任何 Run / Experiment**（那是展开时的目标，不是模板的属性）；
--   - `sourceExperimentId` 仅作溯源展示，可为空，**不参与展开逻辑**；
--   - 零数据库 FK（沿用项目 soft reference 纪律，引用合法性由领域层校验）。
--
-- 本 migration 为**纯新增**（CREATE TABLE IF NOT EXISTS），对既有表零改动；
-- 回滚 = DROP 这两张表，不影响任何研究产物。
--
-- 列名口径：沿用项目 camelCase 列约定；表名 snake_case 单数；
-- 状态 / 类型列：varchar + 应用层 TS 联合类型（不用 mysqlEnum）。

-- ===========================================================================
-- 1. research_analysis_template —— 模板头
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_analysis_template` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`sourceExperimentId` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_analysis_template_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_analysis_template_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_template_source_experiment` ON `research_analysis_template` (`sourceExperimentId`);
--> statement-breakpoint

-- ===========================================================================
-- 2. research_analysis_template_item —— 模板明细（一个待展开的分析定义）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS `research_analysis_template_item` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`templateId` bigint NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`analysisType` varchar(32) NOT NULL,
	`name` varchar(200) NOT NULL,
	`target` varchar(128),
	`configJson` longtext,
	`conditionsJson` longtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_analysis_template_item_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_research_template_item_template` ON `research_analysis_template_item` (`templateId`);
