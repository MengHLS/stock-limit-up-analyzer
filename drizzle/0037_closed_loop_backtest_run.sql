-- CLOSED-LOOP-BACKTEST-PERSIST-001 — 闭环回测结果持久化（新表 closed_loop_backtest_run）
--
-- 依据：`researchRun.loopRun`（`server/researchRunRouter.ts`）原为**无状态、不落库**的一次性
--   调用（其注释即如此声明）⇒ 运行结果跑完即弃，界面刷新后无法回看，也答不出「上次跑出什么」。
--   本 migration 只做一件事：新建 `closed_loop_backtest_run`，把每次闭环运行的结果留档。
--
-- 🔴 硬约束（违反即架构错误）：
--   - 与 legacy `backtest_runs`（龙头候选回测）**不是同一张表、不共用口径**：
--     那张存 `LeaderCandidateBacktestResult`，本表存 `ClosedLoopRunResult`；禁止两类结果互灌；
--   - `resultJson` 只存运行结果的**原样投影** —— 禁止在本表写入派生值 / 估算值；
--   - 全库**零 FK**（项目既有原则）⇒ `strategyId` / `datasetVersionId` 均为快照值 + 软引用；
--   - 本表**不参与任何执行路径**：清空它不影响回测正确性，只影响「能不能回看」。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行，重复运行无副作用。
-- 无回填、无数据迁移：新表从 0 行开始。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`（自 0024 起停维护）。

-- @guard: table closed_loop_backtest_run
CREATE TABLE IF NOT EXISTS `closed_loop_backtest_run` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `runId` varchar(80) NOT NULL COMMENT '闭环运行 id（clrun-…）；UNIQUE，同一次运行的重试幂等收敛为一行',
  `experimentId` varchar(80) NOT NULL COMMENT '谱系锚点 §28（快照值，软引用无 FK）',
  `strategyId` varchar(64) NOT NULL COMMENT '策略坐标快照（软引用无 FK）',
  `strategyVersion` varchar(32) NOT NULL COMMENT 'semver 快照',
  `startDate` date NOT NULL COMMENT '回测窗口起（含）',
  `endDate` date NOT NULL COMMENT '回测窗口止（含）',
  `datasetVersion` varchar(96) NULL COMMENT 'Dataset label 快照（仅显示用）',
  `datasetVersionId` bigint NULL COMMENT '真实 Dataset 坐标 → dataset_version.id（软引用无 FK）；直读未命中为 NULL',
  `datasetSource` varchar(16) NULL COMMENT '数据来源：registry（直读已落库数据集）| rebuild（回落从零重建）',
  `recipeId` varchar(96) NULL COMMENT '本次使用的配方 id（装配层记录的事实，软引用）',
  `status` varchar(24) NOT NULL COMMENT 'ALL_EXECUTED / PARTIAL_BLOCKED / NO_STAGE_EXECUTED',
  `executedStageCount` int NOT NULL COMMENT '真正执行完成的阶段数',
  `blockedStageCount` int NOT NULL COMMENT '被阻塞的阶段数',
  `skippedStageCount` int NOT NULL COMMENT '未请求（跳过）的阶段数',
  `firstBlockedReasonCode` varchar(64) NULL COMMENT '首个阻塞原因码；无阻塞为 NULL',
  `initialCapital` double NULL COMMENT '摘要：初始资金（元）',
  `finalEquity` double NULL COMMENT '摘要：期末权益（元）',
  `tradeCount` int NULL COMMENT '摘要：成交笔数',
  `equityCurvePointCount` int NULL COMMENT '摘要：权益曲线点数',
  `summaryJson` text NULL COMMENT '扁平摘要 JSON（列表页展示；权威值在 resultJson）',
  `resultJson` longtext NULL COMMENT '运行结果完整投影（详情页用；**列表页不读此列**）',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '留档时间（UTC 墙钟）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_closed_loop_backtest_run_run` (`runId`),
  KEY `idx_closed_loop_backtest_run_created` (`createdAt`),
  KEY `idx_closed_loop_backtest_run_strategy` (`strategyId`, `createdAt`)
) COMMENT '闭环回测结果留档（与 legacy backtest_runs 不同表、不同口径）'
