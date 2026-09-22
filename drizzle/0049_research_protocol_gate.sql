-- RESEARCH-EXPERIMENT-005 —— Research Protocol / phase / confirmatory gate.
--
-- 历史 Run 全部保持 NULL，继续按 EXPLORATORY 读取；新确认性 Run 才写这些列。

-- @guard: column research_experiment_run.researchPhase
ALTER TABLE `research_experiment_run`
  ADD COLUMN `researchPhase` varchar(16) NULL AFTER `experimentCodeDigest`;

--> statement-breakpoint

-- @guard: column research_experiment_run.protocolId
ALTER TABLE `research_experiment_run`
  ADD COLUMN `protocolId` varchar(96) NULL AFTER `researchPhase`;

--> statement-breakpoint

-- @guard: column research_experiment_run.protocolVersion
ALTER TABLE `research_experiment_run`
  ADD COLUMN `protocolVersion` varchar(32) NULL AFTER `protocolId`;

--> statement-breakpoint

-- @guard: column research_experiment_run.protocolFingerprint
ALTER TABLE `research_experiment_run`
  ADD COLUMN `protocolFingerprint` varchar(96) NULL AFTER `protocolVersion`;

--> statement-breakpoint

-- @guard: column research_experiment_run.parentRunId
ALTER TABLE `research_experiment_run`
  ADD COLUMN `parentRunId` varchar(80) NULL AFTER `protocolFingerprint`;

--> statement-breakpoint

-- @guard: column research_experiment_run.evaluationStartDate
ALTER TABLE `research_experiment_run`
  ADD COLUMN `evaluationStartDate` date NULL AFTER `parentRunId`;

--> statement-breakpoint

-- @guard: column research_experiment_run.evaluationEndDate
ALTER TABLE `research_experiment_run`
  ADD COLUMN `evaluationEndDate` date NULL AFTER `evaluationStartDate`;

--> statement-breakpoint

-- @guard: column research_experiment_run.confirmatoryGateJson
ALTER TABLE `research_experiment_run`
  ADD COLUMN `confirmatoryGateJson` longtext NULL AFTER `resultSchemaVersion`;

--> statement-breakpoint

-- @guard: column research_experiment_run.datasetBindingsJson
ALTER TABLE `research_experiment_run`
  ADD COLUMN `datasetBindingsJson` longtext NULL AFTER `datasetVersionLabel`;

--> statement-breakpoint

-- @guard: index research_experiment_run.idx_research_experiment_protocol
CREATE INDEX `idx_research_experiment_protocol`
  ON `research_experiment_run` (`protocolFingerprint`, `id`);

--> statement-breakpoint

-- @guard: index research_experiment_run.idx_research_experiment_parent
CREATE INDEX `idx_research_experiment_parent`
  ON `research_experiment_run` (`parentRunId`);
