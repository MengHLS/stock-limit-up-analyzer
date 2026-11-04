-- RESEARCH-EXPERIMENT-002 — Strategy 溯源表支持「独立实验」来源（Experiment provenance）
--
-- 依据：规格 §6 要求建立**新的 Experiment provenance**，回答「这个 Strategy 从哪个 Experiment 来 /
--   用了哪个 Dataset 与 Dataset Version / Experiment version / Experiment parameters / 生成时间」，
--   同时明确「不得重新建立复杂的 Finding/Conclusion provenance」并「优先复用现有 Strategy
--   snapshot/version 机制」。
--
-- 为什么落在 `strategy_research_provenance`（而不是新表、也不是 strategy_versions）：
--   1. 该表的**既有定位就是「溯源独立切面」**（`strategyCandidate/types.ts` 头注释）：
--      display-only，不参与 StrategyDefinition / 指纹 / 5 投影 / validate / backtest /
--      参数搜索 / 模拟 / 执行 ⇒ 动它**不可能**影响任何计算口径（这也是它比
--      `strategy_versions.versionRecordJson` 更安全的原因：后者带 §17 追溯指纹）；
--   2. 它就是「现有 Strategy 版本机制」里的溯源落点，旧 Research 来源与新独立实验来源
--      **同一张表、同一个读取端点**，不会出现「两处 provenance」；
--   3. **不新增表**：规格 §11 明令不得为「看起来干净」删表，也倡导能不加表就不加。
--
-- 变更内容（**全部是放宽 / 新增，零收紧、零历史改写**）：
--   A. 三个旧 Research 来源锚放宽为 NULL —— 独立实验来源**没有**旧 Research 坐标，
--      写 null 是「如实承认缺失」，而不是伪造一个 0 / 哨兵 id；
--      （`sourceCandidateId` 同批处理：它同理只对 Conclusion→Candidate 链有意义。）
--   B. 新增 5 列描述「独立实验来源」：sourceKind / experimentRef / experimentVersion /
--      experimentParametersJson / experimentResultDigest。
--
-- 硬约束（违反即架构错误）：
--   - 本 migration **零 DML**（只有 ALTER TABLE 的 DDL）⇒ 不改任何历史行的**内容**；
--     `sourceKind` 带 NOT NULL DEFAULT 'RESEARCH_CONCLUSION'，既有 13 行按默认值读取即为
--     「旧 Research 来源」，语义正确且无需 UPDATE（**没有 backfill UPDATE**）；
--   - 零 FK（全库既有原则）；
--   - 不修改任何**计算**相关表（strategy_versions / strategy_* 投影 / parameter_search_* /
--     oos_validation_* / walk_forward_* / ds_* / research_* 一律不动）；
--   - 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行
--     （第二次应为 0 executed / 8 skipped）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`。
--
-- 回滚（`0` = 未执行；执行前请先确认**没有** `sourceKind='INDEPENDENT_EXPERIMENT'` 的行，
--   否则 C 段会因 NULL 值而失败 —— 这是刻意的：回滚不该悄悄丢掉新来源的行）：
--   C1. ALTER TABLE `strategy_research_provenance` MODIFY COLUMN `experimentResultDigest` ... ;
--       —— 实际回滚 = DROP COLUMN experimentResultDigest / experimentParametersJson /
--          experimentVersion / experimentRef / sourceKind（倒序）
--   C2. ALTER TABLE `strategy_research_provenance` MODIFY COLUMN `sourceCandidateId` bigint NOT NULL,
--         MODIFY COLUMN `sourceConclusionId` bigint NOT NULL,
--         MODIFY COLUMN `sourceExperimentId` bigint NOT NULL;

-- @guard: column strategy_research_provenance.sourceKind
ALTER TABLE `strategy_research_provenance`
  ADD COLUMN `sourceKind` varchar(32) NOT NULL DEFAULT 'RESEARCH_CONCLUSION'
  COMMENT '来源体系：RESEARCH_CONCLUSION（旧 Research 链路）/ INDEPENDENT_EXPERIMENT（RESEARCH-EXPERIMENT-001 独立实验）';

--> statement-breakpoint

-- @guard: column strategy_research_provenance.experimentRef
ALTER TABLE `strategy_research_provenance`
  ADD COLUMN `experimentRef` varchar(96) NULL
  COMMENT '独立实验 id（`<group>/<key>`；软引用，非 FK）—— 回答「这个 Strategy 从哪个 Experiment 来」';

--> statement-breakpoint

-- @guard: column strategy_research_provenance.experimentVersion
ALTER TABLE `strategy_research_provenance`
  ADD COLUMN `experimentVersion` varchar(32) NULL
  COMMENT '实验自身版本（descriptor.version）快照';

--> statement-breakpoint

-- @guard: column strategy_research_provenance.experimentParametersJson
ALTER TABLE `strategy_research_provenance`
  ADD COLUMN `experimentParametersJson` longtext NULL
  COMMENT '生成该策略时**实际使用**的实验参数快照（已归并默认值；写入即冻结）';

--> statement-breakpoint

-- @guard: column strategy_research_provenance.experimentResultDigest
ALTER TABLE `strategy_research_provenance`
  ADD COLUMN `experimentResultDigest` varchar(64) NULL
  COMMENT '实验结果的 canonical 指纹（sha256 前缀）—— 证明这份溯源对应的就是那一次运行';

--> statement-breakpoint

-- @guard: nullable strategy_research_provenance.sourceCandidateId
ALTER TABLE `strategy_research_provenance`
  MODIFY COLUMN `sourceCandidateId` bigint NULL
  COMMENT '来源 research_strategy_candidate.id（快照值，非 FK）；独立实验来源为 NULL';

--> statement-breakpoint

-- @guard: nullable strategy_research_provenance.sourceConclusionId
ALTER TABLE `strategy_research_provenance`
  MODIFY COLUMN `sourceConclusionId` bigint NULL
  COMMENT '来源 research_conclusion.id（快照值，非 FK）；独立实验来源为 NULL';

--> statement-breakpoint

-- @guard: nullable strategy_research_provenance.sourceExperimentId
ALTER TABLE `strategy_research_provenance`
  MODIFY COLUMN `sourceExperimentId` bigint NULL
  COMMENT '来源 research_experiment.id（快照值，非 FK）；独立实验来源为 NULL（其身份是 experimentRef 字符串）';
