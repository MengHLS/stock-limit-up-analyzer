-- RESEARCH-EXPERIMENT-004 hardening — Run 执行代码指纹
--
-- 目的：`experimentVersion` 是作者声明的语义版本，不能证明历史 Run 实际执行了哪份代码。
-- 本 migration 只增加一个可空列，历史 Run 保持 NULL；新 Run 由 Runner 计算并写入。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行。
-- 回滚：ALTER TABLE `research_experiment_run` DROP COLUMN `experimentCodeDigest`。

-- @guard: column research_experiment_run.experimentCodeDigest
ALTER TABLE `research_experiment_run`
  ADD COLUMN `experimentCodeDigest` varchar(96) NULL AFTER `experimentVersion`;
