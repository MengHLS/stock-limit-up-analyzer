-- WALK-FORWARD-001 — Walk-Forward 验证闭环：两张新表（Run / Fold）
--
-- 依据：链路已走到 `Dataset → Research → Strategy → Parameter Search → Search Robustness
--   → OOS Validation`。OOS-001 证明了「一个冻结候选可以在一个样本外窗口上被真实重跑」。
--   本 migration 建立链路的下一环 —— **时间滚动编排**：把「窗口 → 搜索 → 冻结 → 样本外」
--   串成多个 Fold，并在 Fold 之间严格隔离数据（规格 §1 / §11）。
--
-- 🔴 本域是**编排层，不是新引擎**（规格 §3 / §6 Step E / §22）：
--   - 每个 Fold 的搜索 = 真建一条 `parameter_search_run`（**独立搜索**，不是把一次全局搜索切段）；
--   - 每个 Fold 的样本外 = 真建一条 `oos_validation_run`（它内部已经真重跑 Backtest + 真重算指标）。
--   因此本表只存「排程 + Fold 冻结坐标 + 两个子 Run 的软引用 + 读数快照」。
--
-- 硬约束（违反即架构错误）：
--   - 本 migration **零 DML**（只有 DDL：CREATE TABLE）⇒ 不改任何历史行；
--   - **零 FK**（全库既有原则）：`sourceSearchRunId` / `oosRunId` / `strategyVersionId` /
--     `datasetVersionId` 全是快照值 + 软引用；
--   - 两张新表**不参与 Backtest / Parameter Search / OOS 的执行路径**：清空它们只会丢失
--     「这次滚动验证做过什么」的回看能力，不改变任何回测正确性；
--   - `scheduleJson` / `selectionPolicyJson` / `resolvedParameterSetJson` 写入即冻结
--     （UPDATE 集合里不含它们）—— 这是规格 §7 / §10「选择策略与参数必须可审计、历史可追溯」在持久化层的落地；
--   - **不修改** `parameter_search_*` / `oos_validation_*` / `closed_loop_backtest_run` /
--     任何策略与数据集表；
--   - **只有两张表**：Fold 的结果快照（IS / OOS 读数 + 对照）不足以撑起第三张表（规格 §8）。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行
--   （第二次应为 0 executed / 2 skipped）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`（自 0024 起停维护）。

-- @guard: table walk_forward_run
CREATE TABLE IF NOT EXISTS `walk_forward_run` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `walkForwardRunId` varchar(80) NOT NULL COMMENT '业务身份（WFV-YYYYMMDD-XXXXXXXX）；UNIQUE，重放幂等收敛为一行',
  `strategyId` varchar(64) NOT NULL COMMENT '被滚动的策略坐标（创建时冻结，不是 latest）',
  `strategyVersion` varchar(32) NOT NULL COMMENT 'semver 快照',
  `strategyVersionId` varchar(96) NOT NULL COMMENT 'strategyId@strategyVersion 完整身份',
  `strategyFingerprint` varchar(64) NULL COMMENT '策略定义指纹（创建时冻结；执行前复核，漂移即响亮拒绝）',
  `datasetVersionId` bigint NULL COMMENT '运行时唯一权威 Dataset 坐标（软引用无 FK）',
  `datasetVersionLabel` varchar(96) NULL COMMENT 'Dataset label 快照（仅展示）',
  `scheduleJson` longtext NOT NULL COMMENT '窗口排程**冻结快照**（配置 + 交易日序列 + 全部 Fold 端点）；写入即冻结',
  `scheduleFingerprint` varchar(64) NOT NULL COMMENT '排程指纹（不含 Run id / 时间戳 ⇒ 跨运行稳定，规格 §16）',
  `selectionPolicyJson` text NOT NULL COMMENT '候选选择策略快照（规格 §7：必须可审计「怎么挑的」）',
  `searchMethod` varchar(32) NOT NULL COMMENT '每 Fold 的搜索方法（复用 PS 词表）',
  `maxCombinationsPerFold` int NULL COMMENT '每 Fold 的组合数上限（NULL = 不设上限）',
  `totalFoldCount` int NOT NULL COMMENT '总 Fold 数（创建时由排程唯一确定）',
  `completedFoldCount` int NOT NULL DEFAULT 0 COMMENT '已走完样本外的 Fold 数',
  `failedFoldCount` int NOT NULL DEFAULT 0 COMMENT '失败的 Fold 数（失败不伪造成功）',
  `currentFoldIndex` int NULL COMMENT '当前推进到的 Fold 序号（全部结束后为 NULL）',
  `metricsVersion` varchar(48) NOT NULL COMMENT '指标版本自述（沿用 OOS 域同一条，唯一口径 = canonical）',
  `engineVersion` varchar(48) NOT NULL COMMENT '决策引擎版本自述',
  `status` varchar(16) NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED / RUNNING / COMPLETED / FAILED / CANCELLED',
  `runFingerprint` varchar(64) NOT NULL COMMENT '运行内容指纹（时间戳与计数不参与）',
  `aggregateJson` longtext NULL COMMENT '多 Fold 汇总（**只做描述性统计**，不排序不评级）；未完成时为 NULL',
  `notesJson` text NULL COMMENT '运行说明 JSON 数组（不静默）',
  `errorCode` varchar(64) NULL COMMENT '失败领域码',
  `errorMessage` text NULL COMMENT '失败原因',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `startedAt` timestamp NULL COMMENT '开始执行时间',
  `completedAt` timestamp NULL COMMENT '进入终态的时间（由调用方给真实完成时刻，不用 now() 冒充）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_walk_forward_run_id` (`walkForwardRunId`),
  KEY `idx_walk_forward_run_strategy` (`strategyId`,`strategyVersion`),
  KEY `idx_walk_forward_run_created` (`createdAt`),
  KEY `idx_walk_forward_run_status` (`status`)
) COMMENT 'Walk-Forward 运行（滚动窗口编排；WALK-FORWARD-001 §8）';

--> statement-breakpoint

-- @guard: table walk_forward_fold
CREATE TABLE IF NOT EXISTS `walk_forward_fold` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `walkForwardRunId` varchar(80) NOT NULL COMMENT '所属 Run（软引用无 FK）',
  `foldIndex` int NOT NULL COMMENT 'Fold 序号（从 0 起；UNIQUE(walkForwardRunId, foldIndex)）',
  `isStart` date NOT NULL COMMENT 'IS（样本内）窗口起（含）',
  `isEnd` date NOT NULL COMMENT 'IS 窗口止（含）；硬约束 isEnd < oosStart',
  `oosStart` date NOT NULL COMMENT 'OOS 窗口起（含）；gap=0 时即 isEnd 的下一个交易日',
  `oosEnd` date NOT NULL COMMENT 'OOS 窗口止（含）',
  `sourceSearchRunId` varchar(80) NULL COMMENT '该 Fold **自己的** Parameter Search Run（每 Fold 独立搜索，规格 §11）',
  `searchStartDate` date NULL COMMENT '搜索 Run 行上的窗口起（泄漏守卫比对用；落库后不是内存入参）',
  `searchEndDate` date NULL COMMENT '搜索 Run 行上的窗口止',
  `sourceCombinationIndex` int NULL COMMENT '冻结候选的组合序号（仅展示与稳定排序，不作身份）',
  `parameterHash` varchar(64) NULL COMMENT '冻结候选身份（= 源组合 parameterHash；执行前重算复核）',
  `resolvedParameterSetJson` longtext NULL COMMENT '**冻结参数快照**（写入即冻结，永不 UPDATE）',
  `strategyVersionId` varchar(96) NOT NULL COMMENT '策略身份快照（继承创建时冻结值）',
  `strategyFingerprint` varchar(64) NULL COMMENT '策略定义指纹快照（继承创建时冻结值）',
  `datasetVersionId` bigint NULL COMMENT '数据集坐标快照（继承创建时冻结值）',
  `oosRunId` varchar(80) NULL COMMENT '该 Fold **自己的** OOS Run（软引用 → oos_validation_run.oosRunId）',
  `oosWindowStartDate` date NULL COMMENT 'OOS Run 行上的窗口起（泄漏守卫要求与排程逐字相等）',
  `oosWindowEndDate` date NULL COMMENT 'OOS Run 行上的窗口止',
  `status` varchar(24) NOT NULL DEFAULT 'WINDOW_CREATED' COMMENT 'WINDOW_CREATED / SEARCH_RUNNING / SEARCH_COMPLETED / CANDIDATE_FROZEN / OOS_RUNNING / OOS_COMPLETED / FAILED',
  `outcome` varchar(32) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / SUCCEEDED / INSUFFICIENT_TRADING_ACTIVITY / FAILED（结果语义，与生命周期正交）',
  `isMetricsJson` longtext NULL COMMENT 'IS 读数快照（源 Search 结果的冻结副本；本域零重算）',
  `isMetricsSource` varchar(16) NULL COMMENT 'IS 指标来源自述（canonical | evaluators）',
  `oosMetricsJson` longtext NULL COMMENT 'OOS 读数快照（本次真实重跑读数，来自 OOS 结果行）',
  `oosMetricsSource` varchar(16) NULL COMMENT 'OOS 指标来源自述',
  `comparisonJson` longtext NULL COMMENT 'IS/OOS 对照快照（复用 OOS 域既有对照，零重算）',
  `oosBacktestFingerprint` varchar(64) NULL COMMENT '本次 OOS 撮合指纹（证明「真在不同数据上重跑」的主判据）',
  `executionFingerprint` varchar(64) NOT NULL COMMENT 'Fold 级执行指纹（窗口 + 冻结坐标 + 两个子 Run 身份）',
  `errorCode` varchar(64) NULL COMMENT '该 Fold 失败的领域码',
  `errorMessage` text NULL COMMENT '该 Fold 失败原因',
  `notesJson` text NULL COMMENT 'Fold 说明 JSON 数组（含泄漏守卫结论；不静默）',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `completedAt` timestamp NULL COMMENT '该 Fold 进入终态的时间',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_walk_forward_fold_index` (`walkForwardRunId`,`foldIndex`),
  KEY `idx_walk_forward_fold_run` (`walkForwardRunId`,`foldIndex`),
  KEY `idx_walk_forward_fold_status` (`walkForwardRunId`,`status`),
  KEY `idx_walk_forward_fold_search` (`sourceSearchRunId`),
  KEY `idx_walk_forward_fold_oos` (`oosRunId`)
) COMMENT 'Walk-Forward 单个 Fold（窗口 + 冻结候选 + 两个子 Run 软引用 + 读数快照；WALK-FORWARD-001 §8）';
