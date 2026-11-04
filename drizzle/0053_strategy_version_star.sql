-- 策略版本星标：独立存储星标元数据；锚定的版本必须先物化到 strategy_versions。
-- 0052 的 strategy_versions.isStarred 保留为历史列，0053 起星标元数据以本表为准。

-- @guard: table strategy_version_star
CREATE TABLE `strategy_version_star` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `strategyId` varchar(64) NOT NULL,
  `version` varchar(32) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_strategy_version_star_strategy_version` (`strategyId`, `version`),
  KEY `idx_strategy_version_star_strategy` (`strategyId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--> statement-breakpoint

-- 回填 0052 已存在的星标；重复执行由唯一键收敛。
INSERT IGNORE INTO `strategy_version_star` (`strategyId`, `version`)
SELECT `strategyId`, `version`
FROM `strategy_versions`
WHERE `isStarred` = TRUE;
