-- migration 0030 — 事件窗口五表分层（DATABASE_REDESIGN §2 / 附录 A）
--
-- 目标：Dataset 物理表由 3 张（event / path / outcome）扩为 5 张
--       （event / prefix / post / path / outcome），并按「时间方向 × 数据层级」分行列：
--   - event    事件身份 + 时点属性（**删 6 个日线行情列**：open/high/low/close/volume/amount）
--   - prefix   原始行情，relativeDay ∈ [-preWindowDays, 0]  （后视，PIT 安全特征）
--   - post     原始行情，relativeDay ∈ [1, postWindowDays]   （前视，回测撮合 / 标签）
--   - path     衍生指标，relativeDay ∈ [1, postWindowDays]   （前视，仅打标签）
--   - outcome  按 horizon 聚合（结构不变，仅取数改从 post）
--
-- 本文件只做**非破坏性**变更：dataset_definition 增两个表名列。
-- 物理表结构的重建（DROP + CREATE + 数据重灌）由 scripts/applyDatasetWindowLayering.mts 负责，
-- 因为每个数据集的物理表 DDL 是**插件声明式**的（server/datasetRegistry/plugins.ts），
-- migration 不应复制一套 DDL 而产生第二权威来源。

ALTER TABLE `dataset_definition`
  ADD COLUMN `prefixTableName` varchar(128) DEFAULT NULL AFTER `eventTableName`,
  ADD COLUMN `postTableName` varchar(128) DEFAULT NULL AFTER `prefixTableName`;

-- 回填既有定义的 prefix / post 表名（命名规范 ds_{datasetCode}_{role}，与 naming.ts 同源）。
UPDATE `dataset_definition`
   SET `prefixTableName` = CONCAT('ds_', `datasetCode`, '_prefix'),
       `postTableName`   = CONCAT('ds_', `datasetCode`, '_post')
 WHERE `prefixTableName` IS NULL
    OR `postTableName` IS NULL;
