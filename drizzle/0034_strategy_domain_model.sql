-- STEP STRATEGY-003 — Strategy Domain Model & Persistence Architecture
--
-- 目标：在既有 `strategies` / `strategy_versions` 上**增量演进**（不改名、不重建、不删数据），
--       并新建 5 张「由 canonical Definition 单向派生」的可查询投影表。
--
-- Source of Truth（唯一权威，SPEC §46）：
--   strategies                            → 策略身份 / 描述 / 类型 / 状态 / 当前版本指针
--   strategy_versions                     → 版本快照 / 演进链 / 版本状态 / 内容指纹
--   strategy_versions.strategyDocumentJson → 完整 StrategyDefinition 快照（Canonical，物理列名不改）
--   strategy_versions.fingerprint          → canonical 定义指纹（sha256，物理列名不改）
--
-- 以下 5 表是【投影】（projection），永远由 canonical Definition 派生，
-- 禁止任何业务代码把它们拼成第二套 Definition（SPEC §六 / §八）：
--   strategy_parameters / strategy_entry_rules / strategy_exit_rules /
--   strategy_execution_rules / strategy_version_datasets
--
-- 幂等：apply 脚本按 `-- @guard:` 指令先查 information_schema 再执行，重复运行无副作用。
-- 现有两表均为 0 行 ⇒ 无回填、无兼容转换、无 truncate（SPEC §38 自动满足）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`（journal/snapshot 自 0024 起停维护）。

-- ===========================================================================
-- 1. strategies 增量列（+3）
-- ===========================================================================

-- @guard: column strategies.description
ALTER TABLE `strategies` ADD COLUMN `description` varchar(512) NULL COMMENT '策略描述（人类可读，不进版本指纹）';
--> statement-breakpoint
-- @guard: column strategies.strategyType
ALTER TABLE `strategies` ADD COLUMN `strategyType` varchar(32) NULL COMMENT '策略类型标签（自由分类；本任务只落结构，不做枚举强校验）';
--> statement-breakpoint
-- @guard: column strategies.currentVersionId
ALTER TABLE `strategies` ADD COLUMN `currentVersionId` int NULL COMMENT '权威当前版本指针 → strategy_versions.id；latestVersion 降级为兼容性冗余列';
--> statement-breakpoint
-- @guard: index strategies.idx_strategies_current_version
CREATE INDEX `idx_strategies_current_version` ON `strategies` (`currentVersionId`);
--> statement-breakpoint

-- ===========================================================================
-- 2. strategy_versions 增量列（+4）+ 索引（+2）
--    时序：updatedAt 的唯一合法用途 = 状态迁移时间；内容仍禁 UPDATE（不可变，SPEC §8）
-- ===========================================================================

-- @guard: column strategy_versions.parentVersionId
ALTER TABLE `strategy_versions` ADD COLUMN `parentVersionId` int NULL COMMENT '父版本 → strategy_versions.id（软引用，无 FK；表达版本演进链）';
--> statement-breakpoint
-- @guard: column strategy_versions.status
ALTER TABLE `strategy_versions` ADD COLUMN `status` varchar(32) NOT NULL DEFAULT 'Draft' COMMENT '版本生命周期状态（复用 C-21.1 八态 Draft..Retired）';
--> statement-breakpoint
-- @guard: column strategy_versions.description
ALTER TABLE `strategy_versions` ADD COLUMN `description` varchar(512) NULL COMMENT '该版本变更说明（人类可读）';
--> statement-breakpoint
-- @guard: column strategy_versions.updatedAt
ALTER TABLE `strategy_versions` ADD COLUMN `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '状态迁移时间（内容不可变，本列只随 status 变化刷新）';
--> statement-breakpoint
-- @guard: index strategy_versions.idx_strategy_versions_parent
CREATE INDEX `idx_strategy_versions_parent` ON `strategy_versions` (`parentVersionId`);
--> statement-breakpoint
-- @guard: index strategy_versions.idx_strategy_versions_status
CREATE INDEX `idx_strategy_versions_status` ON `strategy_versions` (`status`);
--> statement-breakpoint

-- ===========================================================================
-- 3. 投影表 1/5 — strategy_parameters（ParameterDefinition 投影）
--    UNIQUE(strategyVersionId, code)
-- ===========================================================================

-- @guard: table strategy_parameters
CREATE TABLE IF NOT EXISTS `strategy_parameters` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `strategyVersionId` int NOT NULL COMMENT '所属版本 → strategy_versions.id（权威）',
  `strategyId` varchar(64) NOT NULL COMMENT '所属策略（冗余，便于直查，避免 JOIN）',
  `strategyVersion` varchar(32) NOT NULL COMMENT '版本号（冗余，便于直查）',
  `code` varchar(64) NOT NULL COMMENT '参数 code（版本内唯一）',
  `name` varchar(128) NOT NULL,
  `dataType` varchar(16) NOT NULL COMMENT 'number | string | boolean',
  `parameterRole` varchar(16) NOT NULL COMMENT 'FIXED | TUNABLE | DERIVED',
  `defaultValueJson` longtext NULL COMMENT '默认值 canonical JSON（可空）',
  `minValue` double NULL,
  `maxValue` double NULL,
  `stepValue` double NULL,
  `unit` varchar(32) NULL,
  `description` varchar(512) NULL,
  `required` boolean NOT NULL DEFAULT false,
  `ordinal` int NOT NULL COMMENT '在 Definition.parameters 内的顺序（逐行比对用）',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_strategy_parameters_version_code` (`strategyVersionId`, `code`),
  KEY `idx_strategy_parameters_strategy` (`strategyId`),
  KEY `idx_strategy_parameters_role` (`parameterRole`)
);
--> statement-breakpoint

-- ===========================================================================
-- 4. 投影表 2/5 — strategy_entry_rules（EntryDefinition.conditions 投影）
--    UNIQUE(strategyVersionId, ruleId)；event/window/trigger 冗余到每行，保证无 condition 时也可查
-- ===========================================================================

-- @guard: table strategy_entry_rules
CREATE TABLE IF NOT EXISTS `strategy_entry_rules` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `strategyVersionId` int NOT NULL,
  `strategyId` varchar(64) NOT NULL,
  `strategyVersion` varchar(32) NOT NULL,
  `ruleId` varchar(64) NOT NULL COMMENT 'condition id；无 condition 时为 "entry"（承载 event/window/trigger）',
  `ruleType` varchar(32) NOT NULL COMMENT 'CONDITION | EVENT_OBSERVATION',
  `eventType` varchar(48) NOT NULL COMMENT 'FIRST_LIMIT_UP | LIMIT_UP | ...',
  `windowStart` int NOT NULL,
  `windowEnd` int NOT NULL,
  `windowUnit` varchar(16) NOT NULL COMMENT 'TRADING_DAY | CALENDAR_DAY',
  `triggerType` varchar(32) NOT NULL COMMENT 'FIRST_VALID_DAY | ...',
  `conditionJson` longtext NULL COMMENT '该 condition 的 canonical JSON（无 condition 时为 NULL）',
  `conditionCount` int NOT NULL COMMENT 'EntryDefinition.conditions 总数（每行冗余，便于查询）',
  `priority` int NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_strategy_entry_rules_version_rule` (`strategyVersionId`, `ruleId`),
  KEY `idx_strategy_entry_rules_strategy` (`strategyId`),
  KEY `idx_strategy_entry_rules_event` (`eventType`)
);
--> statement-breakpoint

-- ===========================================================================
-- 5. 投影表 3/5 — strategy_exit_rules（ExitDefinition.rules 投影）
--    UNIQUE(strategyVersionId, ruleId)
-- ===========================================================================

-- @guard: table strategy_exit_rules
CREATE TABLE IF NOT EXISTS `strategy_exit_rules` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `strategyVersionId` int NOT NULL,
  `strategyId` varchar(64) NOT NULL,
  `strategyVersion` varchar(32) NOT NULL,
  `ruleId` varchar(64) NOT NULL,
  `ruleType` varchar(32) NOT NULL COMMENT 'TAKE_PROFIT | STOP_LOSS | TIME_EXIT | SIGNAL_EXIT | FORCED_EXIT',
  `triggerType` varchar(32) NOT NULL COMMENT 'ON_OPEN | ON_CLOSE | INTRADAY | ON_ENTRY',
  `thresholdValue` double NULL,
  `thresholdUnit` varchar(32) NULL COMMENT 'RATIO | PERCENT | TRADING_DAY | PRICE',
  `parameterCode` varchar(64) NULL COMMENT '阈值由参数表达时的参数 code',
  `conditionJson` longtext NULL,
  `priority` int NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `ordinal` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_strategy_exit_rules_version_rule` (`strategyVersionId`, `ruleId`),
  KEY `idx_strategy_exit_rules_strategy` (`strategyId`),
  KEY `idx_strategy_exit_rules_type` (`ruleType`)
);
--> statement-breakpoint

-- ===========================================================================
-- 6. 投影表 4/5 — strategy_execution_rules（ExecutionDefinition 1:1 投影）
--    UNIQUE(strategyVersionId)
-- ===========================================================================

-- @guard: table strategy_execution_rules
CREATE TABLE IF NOT EXISTS `strategy_execution_rules` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `strategyVersionId` int NOT NULL,
  `strategyId` varchar(64) NOT NULL,
  `strategyVersion` varchar(32) NOT NULL,
  `signalTiming` varchar(16) NOT NULL COMMENT 'T_OPEN | T_CLOSE（信号产生时点）',
  `executionTiming` varchar(24) NOT NULL COMMENT 'T_CLOSE | T_PLUS_1_OPEN | ...（成交时点，与 signalTiming 分离）',
  `priceType` varchar(16) NOT NULL COMMENT 'OPEN | CLOSE | HIGH | LOW | VWAP',
  `quantityMethod` varchar(24) NOT NULL COMMENT 'FIXED_SHARES | TARGET_WEIGHT | AMOUNT',
  `lotSize` int NOT NULL,
  `slippageModel` varchar(32) NULL,
  `commissionModel` varchar(32) NULL,
  `executionConstraintsJson` longtext NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_strategy_execution_rules_version` (`strategyVersionId`),
  KEY `idx_strategy_execution_rules_strategy` (`strategyId`)
);
--> statement-breakpoint

-- ===========================================================================
-- 7. 投影表 5/5 — strategy_version_datasets（Dataset 绑定引用，SPEC §21）
--    UNIQUE(strategyVersionId, datasetId, datasetVersion, role)
--    只建立引用：不复制 Dataset 数据、不改 ds_* 物理结构
-- ===========================================================================

-- @guard: table strategy_version_datasets
CREATE TABLE IF NOT EXISTS `strategy_version_datasets` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `strategyVersionId` int NOT NULL,
  `strategyId` varchar(64) NOT NULL,
  `strategyVersion` varchar(32) NOT NULL,
  `datasetId` varchar(128) NOT NULL COMMENT 'Dataset 标识（如 ds_first_limit_pullback）',
  `datasetVersion` varchar(96) NOT NULL COMMENT 'rd-… 内容寻址数据集版本',
  `role` varchar(16) NOT NULL COMMENT 'PRIMARY | VALIDATION | OOS',
  `note` varchar(512) NULL,
  `ordinal` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_strategy_version_datasets_binding` (`strategyVersionId`, `datasetId`, `datasetVersion`, `role`),
  KEY `idx_strategy_version_datasets_strategy` (`strategyId`),
  KEY `idx_strategy_version_datasets_version` (`datasetVersion`),
  KEY `idx_strategy_version_datasets_role` (`role`)
);
