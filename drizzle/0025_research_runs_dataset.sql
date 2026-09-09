-- Research Run ↔ Dataset 强绑定（STEP DS-V2）
-- 所有正式 Research Run 必须记录 datasetId / datasetVersion / datasetFingerprint。
-- 三列可为 NULL：legacy 路径（未绑定 C-12.6 Dataset）的 Run 保持 NULL。

ALTER TABLE `research_runs`
	ADD COLUMN `datasetId` varchar(128),
	ADD COLUMN `datasetVersion` varchar(96),
	ADD COLUMN `datasetFingerprint` varchar(64);
--> statement-breakpoint
CREATE INDEX `idx_research_runs_dataset_version` ON `research_runs` (`datasetVersion`);
