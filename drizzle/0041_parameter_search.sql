-- PARAMETER-001 — Parameter Search 三表（运行 / 组合 / 结果）
--
-- 依据：`paramSearchRouter.ts` 全文**零写库调用**（R-01 实查）⇒ 参数搜索「跑完即弃」，
--   刷新页面无法回看，也答不出「这个结果是怎么来的」。本 migration 只做一件事：
--   新建三张留档表，让搜索 Run 变成可回看 / 可续跑 / 可重试的实验记录。
--
-- 🔴 硬约束（违反即架构错误）：
--   - 三张表**不参与任何执行路径**：清空它们不影响回测正确性，只影响「能不能回看 / 续跑」；
--   - **零 FK**（全库既有原则）：`strategyId` / `datasetVersionId` / `backtestRunId` 全为
--     快照值 + 软引用，不加任何 FOREIGN KEY；
--   - **不回填、不迁移历史数据**：新表从 0 行开始；
--   - 指标列**只写评估端口读数**（`canonicalMetrics` 优先），本层不做任何派生计算；
--   - `parameterSpaceJson` 写入即冻结（历史 Run 的参数空间不被未来策略修改重新解释）。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行，重复运行无副作用
--   （第二次应为 0 executed / 3 skipped）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`（自 0024 起停维护）。

-- @guard: table parameter_search_run
CREATE TABLE IF NOT EXISTS `parameter_search_run` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `searchRunId` varchar(80) NOT NULL COMMENT '业务身份（PSRUN-YYYYMMDD-XXXXXXXX）；UNIQUE，重放幂等收敛为一行',
  `strategyId` varchar(64) NOT NULL COMMENT '策略坐标快照（软引用无 FK）',
  `strategyVersion` varchar(32) NOT NULL COMMENT 'semver 快照；与 strategyId 合成规格里的 strategyVersionId',
  `datasetVersionId` bigint NULL COMMENT '运行时唯一权威 Dataset 坐标 → dataset_version.id（软引用无 FK）',
  `datasetVersionLabel` varchar(96) NULL COMMENT 'Dataset label 快照（仅展示，不是坐标）',
  `startDate` date NOT NULL COMMENT '回测窗口起（含）；FIXED 参数',
  `endDate` date NOT NULL COMMENT '回测窗口止（含）；FIXED 参数',
  `searchMethod` varchar(24) NOT NULL COMMENT '本阶段只有 GRID_SEARCH；其余为已登记未实现',
  `status` varchar(16) NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED / RUNNING / COMPLETED / FAILED / CANCELLED',
  `parameterSpaceJson` longtext NOT NULL COMMENT '参数空间快照（富定义 JSON）；写入即冻结，永不 UPDATE',
  `parameterSpaceFingerprint` varchar(64) NOT NULL COMMENT '快照指纹 sha256（覆盖策略身份 + 富定义）',
  `fixedCoordinatesJson` text NOT NULL COMMENT 'FIXED 坐标快照 JSON（策略版本 / 数据集坐标 / 窗口 / 执行政策 / 评估配置指纹）',
  `executionPolicyVersion` int NOT NULL COMMENT '回测执行政策版本（cache 判据之一）',
  `evaluationConfigFingerprint` varchar(64) NOT NULL COMMENT '评估配置指纹 sha256（cache 判据之一）',
  `combinationCount` int NOT NULL COMMENT '组合总数（笛卡尔积基数）',
  `completedCount` int NOT NULL DEFAULT 0 COMMENT '已评估成功组合数',
  `failedCount` int NOT NULL DEFAULT 0 COMMENT '已评估失败组合数（与 completed 互斥；SKIPPED 不计入）',
  `combinationSetFingerprint` varchar(64) NOT NULL COMMENT '组合集指纹 sha256',
  `notesJson` longtext NULL COMMENT '运行说明 JSON 数组（cache 命中 / resume 跳过 / 派生说明；不静默）',
  `errorCode` varchar(64) NULL COMMENT '失败原因码（FAILED 时非空）',
  `errorMessage` text NULL COMMENT '失败原因',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `startedAt` timestamp NULL COMMENT '首次进入 RUNNING 的时间',
  `completedAt` timestamp NULL COMMENT '进入终态的时间（由调用方给真实完成时刻，不用 NOW() 冒充）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_parameter_search_run_id` (`searchRunId`),
  KEY `idx_parameter_search_run_created` (`createdAt`),
  KEY `idx_parameter_search_run_strategy` (`strategyId`,`createdAt`),
  KEY `idx_parameter_search_run_status` (`status`)
) COMMENT 'Parameter Search 运行留档（PARAMETER-001 §7）';

--> statement-breakpoint

-- @guard: table parameter_search_combination
CREATE TABLE IF NOT EXISTS `parameter_search_combination` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `searchRunId` varchar(80) NOT NULL COMMENT '归属 Search Run（软引用无 FK）',
  `combinationIndex` int NOT NULL COMMENT '组合序号（生成顺序，从 0 起；仅展示与稳定排序）',
  `parameterHash` varchar(64) NOT NULL COMMENT '稳定参数哈希 sha256（strategyVersionId + 规范化参数值）—— 组合身份',
  `parametersJson` longtext NOT NULL COMMENT '参数取值 JSON object（键 = 参数名）',
  `status` varchar(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / RUNNING / SUCCEEDED / FAILED / SKIPPED',
  `attemptCount` int NOT NULL DEFAULT 0 COMMENT '尝试次数（retry 递增）',
  `lastError` text NULL COMMENT '最近一次失败原因；成功时置 NULL（收敛为当前事实）',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_parameter_search_combination_hash` (`searchRunId`,`parameterHash`),
  KEY `idx_parameter_search_combination_run` (`searchRunId`,`combinationIndex`),
  KEY `idx_parameter_search_combination_status` (`searchRunId`,`status`)
) COMMENT 'Parameter Search 参数组合（计划层 + 执行状态；resume/retry 判据）';

--> statement-breakpoint

-- @guard: table parameter_search_result
CREATE TABLE IF NOT EXISTS `parameter_search_result` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `searchRunId` varchar(80) NOT NULL COMMENT '归属 Search Run（软引用无 FK）',
  `combinationIndex` int NOT NULL COMMENT '组合序号（冗余自 combination，便于单表读取）',
  `parameterHash` varchar(64) NOT NULL COMMENT '稳定参数哈希（组合身份）',
  `parametersJson` longtext NOT NULL COMMENT '参数取值快照 JSON object',
  `status` varchar(16) NOT NULL COMMENT 'SUCCEEDED / FAILED（判据 = 评估引用是否存在）',
  `error` text NULL COMMENT '失败原因；成功时 NULL',
  `totalReturnPct` double NULL COMMENT '读数：总收益率 %（canonicalMetrics）',
  `annualizedReturnPct` double NULL COMMENT '读数：年化收益率 %（canonicalMetrics.cagrPct）',
  `maxDrawdownPct` double NULL COMMENT '读数：最大回撤幅度 %（正数幅度口径）',
  `tradeCount` int NULL COMMENT '读数：完成交易数（canonicalMetrics.completedTradeCount）',
  `winRatePct` double NULL COMMENT '读数：胜率 %',
  `profitFactor` double NULL COMMENT '读数：盈亏比',
  `metricsSource` varchar(16) NOT NULL COMMENT 'canonical | evaluators（指标来源自述）',
  `annualizationBasisJson` text NULL COMMENT '年化基数自述 JSON（canonical 缺省时 NULL）',
  `backtestFingerprint` varchar(64) NULL COMMENT '本次撮合指纹（ClosedLoopEvaluationRef#backtestFingerprint）',
  `backtestRunId` varchar(80) NULL COMMENT '落库回测 run id；本阶段评估端口不落 closed_loop_backtest_run 行 ⇒ 恒 NULL（如实登记，不伪造）',
  `evaluationId` varchar(80) NULL COMMENT '评估产物身份（deriveExperimentId）',
  `evaluationRunId` varchar(160) NULL COMMENT '内存态闭环 run id（<前缀>::<experimentId>）',
  `evaluationJson` longtext NULL COMMENT '完整评估引用投影（canonical metrics 原始面 + 指纹）',
  `reproductionJson` text NULL COMMENT '复现要素快照 JSON',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_parameter_search_result_hash` (`searchRunId`,`parameterHash`),
  KEY `idx_parameter_search_result_run` (`searchRunId`,`combinationIndex`),
  KEY `idx_parameter_search_result_status` (`searchRunId`,`status`)
) COMMENT 'Parameter Search 单组合评估产物（§9 可追溯 + §10 指标读数）';
