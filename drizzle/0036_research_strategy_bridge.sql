-- RESEARCH-006.1 — Research → Strategy Candidate 桥：数据库 + Domain Model（**只建桥，不接线路**）
--
-- 依据（唯一架构基准）：docs/research/RESEARCH-006.0-architecture.md
--   §7 Domain Model / §8 Provenance / §9 Dataset 坐标 / §13 Database Logical Design / §15 006.1 / §16
--
-- 本 migration 只做两件事（纯增量、不改名、不重建、不删数据、不迁移数据）：
--   ① research_strategy_candidate  +4 列 +1 索引   —— 研究**来源**快照（Dataset 坐标 / Run / 证据 / 偏差原因）
--   ② strategy_research_provenance 新表（12 列 + 1 UNIQUE + 3 索引）—— Strategy 侧溯源切面
--
-- 为什么必须有 ②（006.0 §4.2 F）：Research 侧的 Result **重算即覆盖**、且
-- `deleteExperimentCascade` **连 candidate 一起删** ⇒ 溯源只留在 Research 侧就会永久丢失。
-- 故 Strategy 侧必须留**快照值**（不是 FK）。
--
-- 🔴 硬约束（违反即架构错误）：
--   - `datasetVersionId = dataset_version.id` 是**唯一**跨模块 Dataset 坐标；禁止第二套 ID、
--     禁止把 label（`v1`/`v2`）当引用坐标；
--   - 溯源**不得**污染 Strategy Canonical：不给 `strategy_versions` / `strategy_version_datasets`
--     加任何 research 列，不改 `strategyDocumentJson` / `versionRecordJson` / 指纹；
--   - 全库**零 FK**（项目既有原则，soft reference + 应用层校验）⇒ 本 migration 不加任何 FK；
--   - 不建 `strategy_drafts`（006.0 §5 拒绝方案 A/B）。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行，重复运行无副作用。
-- 无回填、无数据迁移：新增列全部可空，既有 0 行 candidate 保持 0 行，新表从 0 行开始。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`（自 0024 起停维护）。

-- ===========================================================================
-- 1. research_strategy_candidate — 研究来源快照（+4 列 +1 索引）
--    4 列全部 NULL-able：候选可以先于「来源解析」存在（如 runId 提不出），零回填。
-- ===========================================================================

-- @guard: column research_strategy_candidate.sourceDatasetVersionId
ALTER TABLE `research_strategy_candidate` ADD COLUMN `sourceDatasetVersionId` bigint NULL COMMENT '研究来源 Dataset 坐标快照 → dataset_version.id（软引用，无 FK）；复制自 research_experiment.datasetVersionId，之后不随上游变化';
--> statement-breakpoint
-- @guard: column research_strategy_candidate.sourceResearchRunId
ALTER TABLE `research_strategy_candidate` ADD COLUMN `sourceResearchRunId` bigint NULL COMMENT '来源 research_run.id（软引用，无 FK，可空）；Conclusion 无 runId 列，经 evidence.primaryAnalysis.analysisId 两跳解析，提不出即 NULL，禁止伪造';
--> statement-breakpoint
-- @guard: column research_strategy_candidate.sourceTraceJson
ALTER TABLE `research_strategy_candidate` ADD COLUMN `sourceTraceJson` longtext NULL COMMENT '研究证据快照（provenance snapshot，非 research_result 第二份存储）：conclusionId/analysisId/metricCode/effectLabel/disclaimer 摘要';
--> statement-breakpoint
-- @guard: column research_strategy_candidate.sourceDatasetDivergenceReason
ALTER TABLE `research_strategy_candidate` ADD COLUMN `sourceDatasetDivergenceReason` varchar(512) NULL COMMENT 'Research Source Dataset ≠ Strategy Execution Dataset 时的原因；一致时必须为 NULL，禁止填无意义默认文本';
--> statement-breakpoint
-- @guard: index research_strategy_candidate.idx_research_candidate_source_dataset_version
CREATE INDEX `idx_research_candidate_source_dataset_version` ON `research_strategy_candidate` (`sourceDatasetVersionId`);
--> statement-breakpoint

-- ===========================================================================
-- 2. strategy_research_provenance — Strategy 侧溯源切面（新表）
--    独立切面，不是 strategy_versions 的列；display-only，不进任何执行路径。
--    UNIQUE(strategyVersionId)：一个 Strategy Version 最多一条溯源。
--    三索引分别支撑：按策略列、反向查「这个结论产出过哪些策略」、promote 幂等闸门（按候选查）。
-- ===========================================================================

-- @guard: table strategy_research_provenance
CREATE TABLE `strategy_research_provenance` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `strategyVersionId` int NOT NULL COMMENT '权威行锚 → strategy_versions.id（软引用，无 FK）；UNIQUE',
  `strategyId` varchar(64) NOT NULL COMMENT '冗余便于直查（与 5 张投影表同风格）',
  `strategyVersion` varchar(32) NOT NULL COMMENT 'semver 冗余快照',
  `sourceCandidateId` bigint NOT NULL COMMENT '来源 research_strategy_candidate.id（快照值，非 FK）',
  `sourceConclusionId` bigint NOT NULL COMMENT '来源 research_conclusion.id（快照值，非 FK）',
  `sourceExperimentId` bigint NOT NULL COMMENT '来源 research_experiment.id（快照值，非 FK）',
  `sourceResearchRunId` bigint NULL COMMENT '来源 research_run.id（可空，提不出即 NULL）',
  `sourceDatasetVersionId` bigint NULL COMMENT '研究来源 Dataset 坐标快照 → dataset_version.id（与 Strategy 执行绑定可不同）',
  `sourceDatasetLabel` varchar(96) NULL COMMENT '来源 label 快照（v1/v2/rd-…），仅显示；引用坐标是 sourceDatasetVersionId',
  `sourceSnapshotJson` longtext NULL COMMENT 'sourceTraceJson 副本；display-only，不参与 definition/fingerprint/validate/backtest',
  `origin` varchar(16) NOT NULL DEFAULT 'DIRECT' COMMENT 'DIRECT（promote 产出）/ INHERITED（clone 继承）',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_strategy_research_provenance_version` (`strategyVersionId`),
  KEY `idx_strategy_research_provenance_strategy` (`strategyId`),
  KEY `idx_strategy_research_provenance_conclusion` (`sourceConclusionId`),
  KEY `idx_strategy_research_provenance_candidate` (`sourceCandidateId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RESEARCH-006.1 — Strategy 侧 Research 溯源快照（display-only，零 FK）';
