-- 版本星标：用户用来自行标记「值得回看的版本」。
-- 仅展示元数据，不参与 strategyDocumentJson / fingerprint / 投影，不影响回测结果。

-- @guard: column strategy_versions.isStarred
ALTER TABLE `strategy_versions`
  ADD COLUMN `isStarred` boolean NOT NULL DEFAULT false AFTER `description`;

--> statement-breakpoint

-- @guard: index idx_strategy_versions_starred
CREATE INDEX `idx_strategy_versions_starred` ON `strategy_versions` (`isStarred`);
