-- OOS-001 — Out-of-Sample Validation：两张新表（Run / Result）
--
-- 依据：PARAMETER-001 已让搜索「跑完即落档」，ROBUSTNESS-001 已证明冻结结果可被下游消费。
--   本 migration 建立链路的下一环 —— **样本外验证**：在**与 Search 窗口不重叠**的数据上
--   用**冻结候选参数**（禁止再搜索 / 再调参）**真正重跑 Backtest** 并**真正重算指标**。
--
-- 🔴 与既有 `search_robustness_*` 的关系（**并存但语义相反**）：
--   `search_robustness_*` = 冻结结果上的邻域稳定性，**零重跑零重算**；
--   `oos_validation_*`    = 样本外**真重跑 + 真重算**（规格 §9）。
--   两者共享「消费 Parameter Search 结果」这一输入姿态，因此表名同族、语义必须分清。
--
-- 硬约束（违反即架构错误）：
--   - 本 migration **零 DML**（只有 DDL：CREATE TABLE）⇒ 不改任何历史行；
--   - **零 FK**（全库既有原则）：`sourceSearchRunId` / `sourceParameterHash` / `strategyVersionId` /
--     `datasetVersionId` 全是快照值 + 软引用；
--   - 两张新表**不参与 Parameter Search / Backtest 的执行路径**：清空它们只会丢失
--     「这次样本外验证做过什么」的回看能力，不会改变任何回测正确性；
--   - `resolvedParameterSetJson` / `searchSnapshotJson` 写入即冻结（UPDATE 集合里不含它们）
--     —— 这是规格 §5「OOS 不允许调参」在持久化层的落地；
--   - **不修改** `parameter_search_*` / `closed_loop_backtest_run` / 任何策略与数据集表。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行
--   （第二次应为 0 executed / 2 skipped）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`（自 0024 起停维护）。

-- @guard: table oos_validation_run
CREATE TABLE IF NOT EXISTS `oos_validation_run` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `oosRunId` varchar(80) NOT NULL COMMENT '业务身份（OOSV-YYYYMMDD-XXXXXXXX）；UNIQUE，重放幂等收敛为一行',
  `sourceSearchRunId` varchar(80) NOT NULL COMMENT '源 Parameter Search Run（唯一输入事实源；软引用无 FK）',
  `sourceParameterHash` varchar(64) NOT NULL COMMENT '被验证的冻结候选身份（= 源组合的 parameterHash，本层不重算）',
  `sourceCombinationIndex` int NULL COMMENT '源组合序号（仅展示与稳定排序，不作身份）',
  `strategyId` varchar(64) NOT NULL COMMENT '策略坐标快照（继承自源 Run）',
  `strategyVersion` varchar(32) NOT NULL COMMENT 'semver 快照',
  `strategyVersionId` varchar(96) NOT NULL COMMENT 'strategyId@strategyVersion（规格 §4 第 3 问的完整身份）',
  `strategyDefinitionFingerprint` varchar(64) NULL COMMENT '策略定义指纹（创建时冻结；执行时复核，漂移即拒绝）',
  `datasetVersionId` bigint NULL COMMENT '运行时唯一权威 Dataset 坐标（软引用无 FK）',
  `datasetVersionLabel` varchar(96) NULL COMMENT 'Dataset label 快照（仅展示）',
  `searchStartDate` date NOT NULL COMMENT 'IS / Search 窗口起（含）—— 窗口隔离判定的另一半',
  `searchEndDate` date NOT NULL COMMENT 'IS / Search 窗口止（含）',
  `oosStartDate` date NOT NULL COMMENT 'OOS 窗口起（含）；要求 > searchEndDate（默认禁止重叠，规格 §6）',
  `oosEndDate` date NOT NULL COMMENT 'OOS 窗口止（含）',
  `searchSnapshotJson` longtext NOT NULL COMMENT '源 Run 的参数空间**冻结快照**（写入即冻结，永不 UPDATE）',
  `searchSnapshotFingerprint` varchar(64) NOT NULL COMMENT '继承自源 Run 的快照指纹',
  `fixedCoordinatesJson` text NOT NULL COMMENT '源 Run 的 FIXED 坐标快照（原样继承）',
  `executionPolicyVersion` int NOT NULL COMMENT '继承自源 Run（规格 §4 第 6 问）',
  `evaluationConfigFingerprint` varchar(64) NOT NULL COMMENT '继承自源 Run',
  `resolvedParameterSetJson` longtext NOT NULL COMMENT '**冻结参数集**（写入即冻结；OOS 执行只允许用它 —— 规格 §5）',
  `metricsVersion` varchar(48) NOT NULL COMMENT '指标版本自述（规格 §4 第 8 问；由年化口径常量拼出，不写死数字）',
  `engineVersion` varchar(48) NOT NULL COMMENT '决策引擎版本自述（规格 §4 第 8 问）',
  `status` varchar(16) NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED / RUNNING / COMPLETED / FAILED / CANCELLED',
  `runFingerprint` varchar(64) NOT NULL COMMENT '运行内容指纹 sha256（时间戳不参与）',
  `notesJson` longtext NULL COMMENT '运行说明 JSON 数组（冻结来源 / 窗口隔离判定 / 门禁结论；不静默）',
  `errorCode` varchar(64) NULL COMMENT '失败原因码（FAILED 时非空）',
  `errorMessage` text NULL COMMENT '失败原因',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `startedAt` timestamp NULL COMMENT '首次进入 RUNNING 的时间',
  `completedAt` timestamp NULL COMMENT '进入终态的时间（由调用方给真实完成时刻，不用 NOW() 冒充）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_oos_validation_run_id` (`oosRunId`),
  KEY `idx_oos_validation_run_source` (`sourceSearchRunId`),
  KEY `idx_oos_validation_run_created` (`createdAt`),
  KEY `idx_oos_validation_run_status` (`status`)
) COMMENT 'OOS 验证运行留档（OOS-001 §13）';

--> statement-breakpoint

-- @guard: table oos_validation_result
CREATE TABLE IF NOT EXISTS `oos_validation_result` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `oosRunId` varchar(80) NOT NULL COMMENT '归属 OOS Run（软引用无 FK）',
  `sourceSearchRunId` varchar(80) NOT NULL COMMENT '源 Search Run（冗余，便于单表排查）',
  `sourceParameterHash` varchar(64) NOT NULL COMMENT '冻结候选身份（与 Run 冗余）',
  `sourceCombinationIndex` int NULL COMMENT '源组合序号（仅展示）',
  `strategyVersionId` varchar(96) NOT NULL COMMENT '策略身份快照',
  `datasetVersionId` bigint NULL COMMENT 'Dataset 坐标快照',
  `resolvedParameterSetJson` longtext NOT NULL COMMENT '本次实际使用的冻结参数集（与 Run 上的一致）',
  `searchStartDate` date NOT NULL COMMENT 'IS 窗口起（含）',
  `searchEndDate` date NOT NULL COMMENT 'IS 窗口止（含）',
  `oosStartDate` date NOT NULL COMMENT 'OOS 窗口起（含）',
  `oosEndDate` date NOT NULL COMMENT 'OOS 窗口止（含）',
  `isTotalReturnPct` double NULL COMMENT 'IS 读数：总收益率 %（**源结果冻结副本**，零派生计算）',
  `isAnnualizedReturnPct` double NULL COMMENT 'IS 读数：年化收益率 %（冻结副本）',
  `isMaxDrawdownPct` double NULL COMMENT 'IS 读数：最大回撤幅度 %（冻结副本；正数幅度口径）',
  `isTradeCount` int NULL COMMENT 'IS 读数：完成交易数（冻结副本）',
  `isWinRatePct` double NULL COMMENT 'IS 读数：胜率 %（冻结副本）',
  `isProfitFactor` double NULL COMMENT 'IS 读数：盈亏比（冻结副本）',
  `isMetricsSource` varchar(16) NOT NULL COMMENT 'IS 读数来源（建库时要求 canonical；否则拒绝建 Run）',
  `isAnnualizationBasisJson` text NULL COMMENT 'IS 年化基数自述 JSON',
  `oosTotalReturnPct` double NULL COMMENT 'OOS 读数：总收益率 %（**本次重跑真实产物**，非复制 IS）',
  `oosAnnualizedReturnPct` double NULL COMMENT 'OOS 读数：年化收益率 %（本次重跑）',
  `oosMaxDrawdownPct` double NULL COMMENT 'OOS 读数：最大回撤幅度 %（本次重跑）',
  `oosTradeCount` int NULL COMMENT 'OOS 读数：完成交易数（本次重跑）',
  `oosWinRatePct` double NULL COMMENT 'OOS 读数：胜率 %（本次重跑）',
  `oosProfitFactor` double NULL COMMENT 'OOS 读数：盈亏比（本次重跑）',
  `oosMetricsSource` varchar(16) NOT NULL COMMENT 'OOS 读数来源（canonical / evaluators）',
  `oosAnnualizationBasisJson` text NULL COMMENT 'OOS 年化基数自述 JSON',
  `comparisonJson` longtext NOT NULL COMMENT 'IS / OOS 对照 JSON（delta / ratio / 退化 / 回撤变化；不含结论性判定）',
  `status` varchar(16) NOT NULL COMMENT 'SUCCEEDED / FAILED（判据 = 是否产出可用 evaluation 引用）',
  `error` text NULL COMMENT '失败原因；成功时 NULL',
  `backtestFingerprint` varchar(64) NULL COMMENT '本次 OOS 撮合指纹（ClosedLoopEvaluationRef#backtestFingerprint）',
  `evaluationId` varchar(80) NULL COMMENT '评估产物身份（deriveExperimentId）',
  `evaluationRunId` varchar(160) NULL COMMENT '内存态闭环 run id（<前缀>::<experimentId>）',
  `executionPolicyVersion` int NOT NULL COMMENT '本次执行政策版本',
  `metricsVersion` varchar(48) NOT NULL COMMENT '指标版本自述',
  `engineVersion` varchar(48) NOT NULL COMMENT '决策引擎版本自述',
  `fingerprint` varchar(64) NOT NULL COMMENT '内容指纹 sha256（确定性判据：同输入 ⇒ 同指纹）',
  `notesJson` longtext NOT NULL COMMENT '结果说明 JSON 数组（含对照不可用原因；不静默）',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_oos_validation_result_candidate` (`oosRunId`,`sourceParameterHash`),
  KEY `idx_oos_validation_result_run` (`oosRunId`,`sourceCombinationIndex`),
  KEY `idx_oos_validation_result_status` (`oosRunId`,`status`)
) COMMENT 'OOS 验证结果（IS 基线 × OOS 重跑对照；OOS-001 §13）';
