-- Research Dataset 分片行表关联（STEP DS-V2-FINAL 分区构建）
-- 分片构建时把标准行写入独立行表 rd_rows_<buildKey>，本列记录该行表名。
-- NULL = 非分片（内存）构建，无行表。

ALTER TABLE `research_datasets`
	ADD COLUMN `rowsTableName` varchar(64);
