-- RESEARCH-FINDING-001 — Research Finding & Hypothesis Engine（Result → Finding → Hypothesis → Candidate 闭环）
--
-- 依据：`docs/research/RESEARCH-FINDING-001-audit.md`（Phase A 实查审计，2026-09-16）
--   真库事实：新 Research 主链路（experiment/hypothesis/run/analysis/result/conclusion/candidate）**已完整存在**；
--   `research_hypothesis` 已接线但 **0 行**；`research_conclusion` 12 行；`research_result` **5083 行**；
--   **`research_finding` 不存在**，且全库无任何含 `finding` 的表名/列名 ⇒ Finding 是本任务**唯一新增实体**。
--
-- 本 migration 只做四件事（纯增量、不改名、不重建、不删数据、不迁移数据）：
--   ① `research_finding`  新表（Result 与 Conclusion 之间的**发现层**）
--   ② `research_hypothesis` +9 列 +1 索引   —— 假设**结构化**（conditions/target/horizon/expected*）+ 来源锚
--   ③ `research_conclusion` +5 列           —— 结论**引用 Finding**（findingIds/limitations/nextQuestions）
--   ④ `research_strategy_candidate` +2 列 +1 索引 —— 来源 Hypothesis / Finding 谱系锚
--
-- 🔴 硬约束（违反即架构错误）：
--   - **零 FK**（项目既有原则，soft reference + 应用层校验）⇒ 本 migration 不加任何 FK；
--   - 全部 JSON 列 `longtext` + 列名以 `Json` 结尾；状态 / 类型列 `varchar` + 集中 TS 联合类型（不用 `mysqlEnum`）；
--   - 新增列**全部可空** ⇒ 既有 12 条 conclusion / 9 条 candidate / 0 条 hypothesis 全部保持可读（**读路径零破坏**）；
--   - `research_finding` **只由确定性 Finding Engine 写入**；禁止 LLM 决定 Finding、
--     禁止为了 Demo 人工制造统计结果（任务书 §35.4 / §35.8）；
--   - 不新建第二套 Research Engine / Candidate→Strategy 体系（任务书 §35.2 / §35.3）；
--   - `research_conclusion` / `research_strategy_candidate` 既有列语义**零变化**（只追加）。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行，重复运行无副作用。
-- 无回填：新增列全部可空，不 backfill 伪造历史（既有 candidate 的 `sourceHypothesisId` 如实为 NULL）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`（自 0024 起停维护）。

-- ===========================================================================
-- ① research_finding —— 新表（发现层）
-- ===========================================================================

-- @guard: table research_finding
CREATE TABLE IF NOT EXISTS `research_finding` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`experimentId` bigint NOT NULL,
	`runId` bigint,
	`primaryAnalysisId` bigint,
	`findingType` varchar(32) NOT NULL,
	`title` varchar(300) NOT NULL,
	`summary` text,
	`status` varchar(20) NOT NULL DEFAULT 'DISCOVERED',
	`target` varchar(200),
	`dimensionJson` longtext,
	`sourceResultIdsJson` longtext,
	`effectJson` longtext,
	`sampleJson` longtext,
	`horizonJson` longtext,
	`stabilityJson` longtext,
	`monotonicityJson` longtext,
	`interactionJson` longtext,
	`effectStrength` double,
	`sampleStrength` double,
	`stabilityStrength` double,
	`horizonConsistency` double,
	`monotonicityStrength` double,
	`researchStrength` double,
	`researchStrengthGrade` varchar(16),
	`policyJson` longtext,
	`limitationsJson` longtext,
	`evidenceJson` longtext,
	`fingerprint` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_finding_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_research_finding_fingerprint` UNIQUE(`fingerprint`)
);
--> statement-breakpoint
-- @guard: index research_finding.idx_research_finding_experiment
CREATE INDEX `idx_research_finding_experiment` ON `research_finding` (`experimentId`);
--> statement-breakpoint
-- @guard: index research_finding.idx_research_finding_run
CREATE INDEX `idx_research_finding_run` ON `research_finding` (`runId`);
--> statement-breakpoint
-- @guard: index research_finding.idx_research_finding_status
CREATE INDEX `idx_research_finding_status` ON `research_finding` (`status`);
--> statement-breakpoint
-- @guard: index research_finding.idx_research_finding_type
CREATE INDEX `idx_research_finding_type` ON `research_finding` (`findingType`);
--> statement-breakpoint
-- @guard: index research_finding.idx_research_finding_strength
CREATE INDEX `idx_research_finding_strength` ON `research_finding` (`researchStrength`);
--> statement-breakpoint
-- @guard: index research_finding.idx_research_finding_analysis
CREATE INDEX `idx_research_finding_analysis` ON `research_finding` (`primaryAnalysisId`);
--> statement-breakpoint

-- ===========================================================================
-- ② research_hypothesis —— 假设结构化（9 列）
--
-- 既有 4 列（statement / nullHypothesis / alternativeHypothesis / conclusion）语义不变。
-- 状态集**严格**取 RESEARCH-FINDING-001 §16 的 6 态，废弃 TESTING / PARTIALLY_SUPPORTED / INCONCLUSIVE
-- （该表 **0 行**，无数据迁移负担；应用层联合类型同步修改）。
-- ===========================================================================

-- @guard: column research_hypothesis.runId
ALTER TABLE `research_hypothesis` ADD COLUMN `runId` bigint;
--> statement-breakpoint
-- @guard: column research_hypothesis.researchQuestion
ALTER TABLE `research_hypothesis` ADD COLUMN `researchQuestion` text;
--> statement-breakpoint
-- @guard: column research_hypothesis.conditionsJson
ALTER TABLE `research_hypothesis` ADD COLUMN `conditionsJson` longtext;
--> statement-breakpoint
-- @guard: column research_hypothesis.target
ALTER TABLE `research_hypothesis` ADD COLUMN `target` varchar(200);
--> statement-breakpoint
-- @guard: column research_hypothesis.horizon
ALTER TABLE `research_hypothesis` ADD COLUMN `horizon` varchar(32);
--> statement-breakpoint
-- @guard: column research_hypothesis.expectedDirection
ALTER TABLE `research_hypothesis` ADD COLUMN `expectedDirection` varchar(16);
--> statement-breakpoint
-- @guard: column research_hypothesis.expectedEffect
ALTER TABLE `research_hypothesis` ADD COLUMN `expectedEffect` varchar(200);
--> statement-breakpoint
-- @guard: column research_hypothesis.sourceFindingIdsJson
ALTER TABLE `research_hypothesis` ADD COLUMN `sourceFindingIdsJson` longtext;
--> statement-breakpoint
-- @guard: column research_hypothesis.sourceConclusionId
ALTER TABLE `research_hypothesis` ADD COLUMN `sourceConclusionId` bigint;
--> statement-breakpoint
-- @guard: index research_hypothesis.idx_research_hypothesis_run
CREATE INDEX `idx_research_hypothesis_run` ON `research_hypothesis` (`runId`);
--> statement-breakpoint

-- ===========================================================================
-- ③ research_conclusion —— 结论引用 Finding（5 列）
--
-- 既有 `evidenceJson` 语义不变（仍由 `conclusionBuilder#buildEvidence` 唯一构造）。
-- `findingIdsJson` 为空数组**不等于**无结论，仅表示「该结论不依赖 Finding」（既有 12 条即如此）。
-- ===========================================================================

-- @guard: column research_conclusion.researchQuestion
ALTER TABLE `research_conclusion` ADD COLUMN `researchQuestion` text;
--> statement-breakpoint
-- @guard: column research_conclusion.evidenceSummary
ALTER TABLE `research_conclusion` ADD COLUMN `evidenceSummary` text;
--> statement-breakpoint
-- @guard: column research_conclusion.findingIdsJson
ALTER TABLE `research_conclusion` ADD COLUMN `findingIdsJson` longtext;
--> statement-breakpoint
-- @guard: column research_conclusion.limitationsJson
ALTER TABLE `research_conclusion` ADD COLUMN `limitationsJson` longtext;
--> statement-breakpoint
-- @guard: column research_conclusion.nextQuestionsJson
ALTER TABLE `research_conclusion` ADD COLUMN `nextQuestionsJson` longtext;
--> statement-breakpoint

-- ===========================================================================
-- ④ research_strategy_candidate —— 来源谱系锚（2 列）
--
-- `sourceHypothesisId` 可空：既有 9 条 candidate 走的是 `Conclusion → Candidate` 老路径，
-- 无假设环节 ⇒ 如实 NULL，**不 backfill 伪造**。新路径 `Hypothesis → Candidate` 必须写入。
-- ===========================================================================

-- @guard: column research_strategy_candidate.sourceHypothesisId
ALTER TABLE `research_strategy_candidate` ADD COLUMN `sourceHypothesisId` bigint;
--> statement-breakpoint
-- @guard: column research_strategy_candidate.sourceFindingIdsJson
ALTER TABLE `research_strategy_candidate` ADD COLUMN `sourceFindingIdsJson` longtext;
--> statement-breakpoint
-- @guard: index research_strategy_candidate.idx_research_candidate_hypothesis
CREATE INDEX `idx_research_candidate_hypothesis` ON `research_strategy_candidate` (`sourceHypothesisId`);
--> statement-breakpoint
