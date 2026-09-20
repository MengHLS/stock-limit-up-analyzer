-- RESEARCH-EXPERIMENT-003 —— 旧 Research 表退役（DROP 空表 / ARCHIVE 有历史行的表）
--
-- 依据：规格 §8「数据库删除必须遵守当前项目 migration 纪律」+ §3「只有在确认无历史/审计/生产
--   用途后才删除；对于仍需要历史保留的对象：明确 archive、不再写入、不再进入生产计算、
--   不作为正式 UI 入口」+ §9「对于无法确认的对象：保留。不要猜。」
--
-- 判据（本 migration 执行前的实查，见 docs/evidence/_probe_re3_db_inventory.mts 输出）：
--   · research_analysis_metric / research_analysis_template / research_analysis_template_item
--     / research_experiments / research_experiment_batches：**零行**，且只为旧结构存在 ⇒ DROP；
--   · 其余旧单数表 + research_runs：**有历史行**（analysis 351 / result 6680 / finding 68 /
--     conclusion 15 / artifact 38 / experiment 7 / run 17 / condition 733 / hypothesis 5 /
--     plan 3 / question 3 / runs 2）⇒ **RENAME 为 `archive_research_*`**：数据一行不丢，
--     但表名显式表达「已归档」，且代码侧已**零引用**（旧领域层与研究引擎已整体删除）。
--
-- 保留不动：`research_strategy_candidate`（规格 §4 允许保留的过渡实体）、
--   `strategy_research_provenance`（Strategy 溯源）、`research_datasets` / `research_securities`
--   / `research_security_identifier_history` / `research_security_status_history`（Dataset 与
--   证券身份域，**不属于**旧 Research）。
--
-- 硬约束：零 DML（只有 DDL，且 RENAME 不改行内容）；零 FK；不改任何计算相关表。
-- 幂等：`-- @guard:` 先查 information_schema；第二次执行应为 0 executed / N skipped。
-- 回滚：把 `archive_research_*` 改回原名并重建被 DROP 的空表（见文件末 C 段）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`。

-- 🔴 本段刻意**不加** `@guard`：guard 语义是「目标已存在即跳过」，而这里的目标
--    正是「要删的表」——加了 guard 就永远删不掉。`DROP TABLE IF EXISTS` 自身即幂等。
DROP TABLE IF EXISTS `research_analysis_metric`;

--> statement-breakpoint

-- 🔴 本段刻意**不加** `@guard`：guard 语义是「目标已存在即跳过」，而这里的目标
--    正是「要删的表」——加了 guard 就永远删不掉。`DROP TABLE IF EXISTS` 自身即幂等。
DROP TABLE IF EXISTS `research_analysis_template`;

--> statement-breakpoint

-- 🔴 本段刻意**不加** `@guard`：guard 语义是「目标已存在即跳过」，而这里的目标
--    正是「要删的表」——加了 guard 就永远删不掉。`DROP TABLE IF EXISTS` 自身即幂等。
DROP TABLE IF EXISTS `research_analysis_template_item`;

--> statement-breakpoint

-- 🔴 本段刻意**不加** `@guard`：guard 语义是「目标已存在即跳过」，而这里的目标
--    正是「要删的表」——加了 guard 就永远删不掉。`DROP TABLE IF EXISTS` 自身即幂等。
DROP TABLE IF EXISTS `research_experiments`;

--> statement-breakpoint

-- 🔴 本段刻意**不加** `@guard`：guard 语义是「目标已存在即跳过」，而这里的目标
--    正是「要删的表」——加了 guard 就永远删不掉。`DROP TABLE IF EXISTS` 自身即幂等。
DROP TABLE IF EXISTS `research_experiment_batches`;

--> statement-breakpoint

-- @guard: table archive_research_experiment
RENAME TABLE `research_experiment` TO `archive_research_experiment`;

--> statement-breakpoint

-- @guard: table archive_research_hypothesis
RENAME TABLE `research_hypothesis` TO `archive_research_hypothesis`;

--> statement-breakpoint

-- @guard: table archive_research_run
RENAME TABLE `research_run` TO `archive_research_run`;

--> statement-breakpoint

-- @guard: table archive_research_analysis
RENAME TABLE `research_analysis` TO `archive_research_analysis`;

--> statement-breakpoint

-- @guard: table archive_research_analysis_condition
RENAME TABLE `research_analysis_condition` TO `archive_research_analysis_condition`;

--> statement-breakpoint

-- @guard: table archive_research_result
RENAME TABLE `research_result` TO `archive_research_result`;

--> statement-breakpoint

-- @guard: table archive_research_conclusion
RENAME TABLE `research_conclusion` TO `archive_research_conclusion`;

--> statement-breakpoint

-- @guard: table archive_research_artifact
RENAME TABLE `research_artifact` TO `archive_research_artifact`;

--> statement-breakpoint

-- @guard: table archive_research_finding
RENAME TABLE `research_finding` TO `archive_research_finding`;

--> statement-breakpoint

-- @guard: table archive_research_question
RENAME TABLE `research_question` TO `archive_research_question`;

--> statement-breakpoint

-- @guard: table archive_research_plan
RENAME TABLE `research_plan` TO `archive_research_plan`;

--> statement-breakpoint

-- @guard: table archive_research_runs
RENAME TABLE `research_runs` TO `archive_research_runs`;

--> statement-breakpoint

-- 回滚（C 段；执行前请确认 archive_* 未被外部引用）：
--   C1. RENAME TABLE `archive_<t>` TO `<t>`（对每个 ARCHIVE 表）；
--   C2. 重建被 DROP 的 5 张空表（结构见 `drizzle/0031_research_core.sql` /
--       `drizzle/0033_research_analysis_template.sql` / `drizzle/0014_flaky_punisher.sql` /
--       `drizzle/0015_chunky_namora.sql`）。
