-- ROBUSTNESS-001 — Search-Result Robustness Analysis：三张新表 + 源表两列补齐
--
-- 依据：`server/research/parameterSearch/**` 已是「跑完即落档」的持久化搜索（PARAMETER-001），
--   本次只做**下游只读消费**：在**冻结快照**上做邻域稳定性分析，**不重跑回测、不重算指标**。
--
-- 🔴 与既有 C-18.1 的关系（**并存但不同物**）：`server/research/robustness/**` 是「四轴扰动
--   **重估**」（需要注入式 evaluator ⇒ 会重跑），其记录类型是内存态 `ROBUSTNESS_RUN`、**无落库**。
--   本 migration 建的三张表**只服务**「消费已算完的 Parameter Search 结果」的稳定性分析；
--   表名统一带 `search_` 前缀，让「哪一种鲁棒性」在表名上就无歧义。
--
-- 硬约束（违反即架构错误）：
--   - 本 migration **零 DML**（只有 DDL：ALTER ADD COLUMN / CREATE TABLE）⇒ 不改任何历史行；
--   - **零 FK**（全库既有原则）：`sourceSearchRunId` / `parameterHash` 全是快照值 + 软引用；
--   - 三张新表**不参与任何执行路径**：清空它们不影响回测正确性，只影响「能不能回看稳定性结论」；
--   - `searchSnapshotJson` / `analysisConfigJson` 写入即冻结（UPDATE 集合里不含它们）。
--
-- 为什么 ALTER `parameter_search_run` 加两列（PARAMETER-002 §12 的必须补口）：
--   ROBUSTNESS-001 §12 要求稳健性分析**继承**「参数是否真的被策略消费」的结论；而该结论
--   （`referenceCheckApplied` / 被排除的死参数 code）在 PARAMETER-001/002 时**只进了 API 回执、
--   没有落库**。若不补列，下游只能回读**当前**策略版本现算 —— 那正是规格 §9 明禁的
--   「用未来版本重新解释历史搜索」。⇒ 两列均为 NULLable：历史行保持 `NULL`（= 未知），
--   下游据此如实标 `ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED`，**不伪造「已验证」**。
--
-- 幂等：apply 脚本按 `-- @guard:` 先查 information_schema 再执行
--   （第二次应为 0 executed / 4 skipped）。
-- 禁止 `npm run db:push` / `drizzle-kit generate`；禁止手改 `drizzle/meta/_journal.json`（自 0024 起停维护）。

-- @guard: column parameter_search_run.referenceCheckApplied
ALTER TABLE `parameter_search_run`
  ADD COLUMN `referenceCheckApplied` boolean NULL COMMENT 'PARAMETER-002 死参数（规则图未引用）筛查是否执行；NULL=该列之前的历史行（未知）',
  ADD COLUMN `unreferencedTunableCodesJson` longtext NULL COMMENT '被排除的死参数 code 快照（JSON 数组；NULL=未知/无）';

--> statement-breakpoint

-- @guard: table search_robustness_run
CREATE TABLE IF NOT EXISTS `search_robustness_run` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `robustnessRunId` varchar(80) NOT NULL COMMENT '业务身份（SROB-YYYYMMDD-XXXXXXXX）；UNIQUE，重放幂等收敛为一行',
  `sourceSearchRunId` varchar(80) NOT NULL COMMENT '唯一输入事实源（规格 §8）；软引用无 FK',
  `strategyId` varchar(64) NOT NULL COMMENT '策略坐标快照（继承自源 Run）',
  `strategyVersion` varchar(32) NOT NULL COMMENT 'semver 快照',
  `datasetVersionId` bigint NULL COMMENT '运行时唯一权威 Dataset 坐标（继承；软引用无 FK）',
  `datasetVersionLabel` varchar(96) NULL COMMENT 'Dataset label 快照（仅展示）',
  `startDate` date NOT NULL COMMENT '回测窗口起（含）；继承自源 Run',
  `endDate` date NOT NULL COMMENT '回测窗口止（含）；继承自源 Run',
  `searchMethod` varchar(24) NOT NULL COMMENT '源 Run 的搜索方法快照',
  `searchSnapshotJson` longtext NOT NULL COMMENT '源 Run 的参数空间**冻结快照**（写入即冻结，永不 UPDATE）',
  `searchSnapshotFingerprint` varchar(64) NOT NULL COMMENT '继承自源 Run 的快照指纹',
  `fixedCoordinatesJson` text NOT NULL COMMENT '源 Run 的 FIXED 坐标快照（原样继承）',
  `executionPolicyVersion` int NOT NULL COMMENT '继承自源 Run',
  `evaluationConfigFingerprint` varchar(64) NOT NULL COMMENT '继承自源 Run',
  `sourceReferenceCheckApplied` boolean NULL COMMENT '源 Run 是否做过死参数筛查；NULL=历史行（未验证）',
  `sourceUnreferencedCodesJson` text NULL COMMENT '源 Run 排除的死参数 code 快照（JSON 数组）',
  `analysisConfigJson` text NOT NULL COMMENT '稳定性判定口径（持久化；不写死前端、不随数据变化）',
  `status` varchar(16) NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED / RUNNING / COMPLETED / FAILED / CANCELLED',
  `summaryJson` longtext NULL COMMENT '汇总快照 JSON（analyzed/stable/unstable/insufficient/邻域不完整）',
  `analyzedCount` int NOT NULL DEFAULT 0 COMMENT '已进入判定的组合数',
  `stableCount` int NOT NULL DEFAULT 0 COMMENT '判定 STABLE 的组合数',
  `unstableCount` int NOT NULL DEFAULT 0 COMMENT '判定 UNSTABLE 的组合数',
  `insufficientCount` int NOT NULL DEFAULT 0 COMMENT '结论不可用类合计（活动不足 + 邻域不足 + 源结果不可用）',
  `neighborhoodIncompleteCount` int NOT NULL DEFAULT 0 COMMENT '邻域不完整（源 Search 缺邻居组合）的组合数',
  `parameterReferenceUnverified` boolean NOT NULL DEFAULT true COMMENT '参数引用未验证（源 Run 无筛查记录）⇒ 前端必须提示',
  `notesJson` longtext NULL COMMENT '分析说明 JSON 数组（含 gate 说明与缺格统计；不静默）',
  `errorCode` varchar(64) NULL COMMENT '失败原因码（FAILED 时非空）',
  `errorMessage` text NULL COMMENT '失败原因',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `startedAt` timestamp NULL COMMENT '首次进入 RUNNING 的时间',
  `completedAt` timestamp NULL COMMENT '进入终态的时间（由调用方给真实完成时刻，不用 NOW() 冒充）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_search_robustness_run_id` (`robustnessRunId`),
  KEY `idx_search_robustness_run_source` (`sourceSearchRunId`),
  KEY `idx_search_robustness_run_created` (`createdAt`),
  KEY `idx_search_robustness_run_status` (`status`)
) COMMENT '稳健性分析运行留档（ROBUSTNESS-001 §14）';

--> statement-breakpoint

-- @guard: table search_robustness_result
CREATE TABLE IF NOT EXISTS `search_robustness_result` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `robustnessRunId` varchar(80) NOT NULL COMMENT '归属 Robustness Run（软引用无 FK）',
  `sourceSearchRunId` varchar(80) NOT NULL COMMENT '源 Search Run（冗余，便于单表排查）',
  `parameterHash` varchar(64) NOT NULL COMMENT '组合身份唯一权威 = 源组合的 parameterHash（本层不重算）',
  `combinationIndex` int NOT NULL COMMENT '源组合序号（展示与稳定排序用，不作身份）',
  `parametersJson` longtext NOT NULL COMMENT '参数取值快照 JSON object',
  `totalReturnPct` double NULL COMMENT '读数：总收益率 %（**源结果冻结副本**，零派生计算）',
  `annualizedReturnPct` double NULL COMMENT '读数：年化收益率 %（冻结副本）',
  `maxDrawdownPct` double NULL COMMENT '读数：最大回撤幅度 %（冻结副本）',
  `tradeCount` int NULL COMMENT '读数：完成交易数（冻结副本；0 = 无交易活动，单列状态处理）',
  `winRatePct` double NULL COMMENT '读数：胜率 %（冻结副本）',
  `profitFactor` double NULL COMMENT '读数：盈亏比（冻结副本）',
  `metricsSource` varchar(16) NOT NULL COMMENT '源结果的指标来源（canonical / missing）',
  `status` varchar(32) NOT NULL COMMENT 'STABLE / UNSTABLE / INSUFFICIENT_TRADING_ACTIVITY / INSUFFICIENT_NEIGHBORHOOD / SOURCE_RESULT_UNAVAILABLE',
  `stable` boolean NOT NULL DEFAULT false COMMENT '仅当状态 STABLE 才为 true；证据不足一律 false，不冒充',
  `stabilityRatio` double NULL COMMENT 'stableNeighborCount / validNeighborCount；无有效邻居为 NULL',
  `stableNeighborCount` int NOT NULL DEFAULT 0 COMMENT '容差内的有效邻居数',
  `validNeighborCount` int NOT NULL DEFAULT 0 COMMENT '有效邻居数（存在 ∧ 读数完整 ∧ tradeCount>0）',
  `expectedNeighborCount` int NOT NULL DEFAULT 0 COMMENT '冻结空间内理论邻居数（沿各轴 ±1..±distance 步）',
  `presentNeighborCount` int NOT NULL DEFAULT 0 COMMENT '其中在源 Search 里真实存在组合的数量',
  `neighborhoodIncomplete` boolean NOT NULL DEFAULT false COMMENT '邻域不完整（present < expected）⇒ NEIGHBORHOOD_INCOMPLETE',
  `statusReason` text NULL COMMENT '判定不可用的如实原因（含缺失格 / 零成交 / 证据不足）',
  `neighborsJson` longtext NOT NULL COMMENT '邻域明细 JSON（含缺失格原因；**不补值**）',
  `dispersionJson` longtext NOT NULL COMMENT '六指标邻域离散度 JSON（count=0 时统计字段全 NULL）',
  `sensitivityJson` longtext NOT NULL COMMENT '逐参数敏感性 JSON（绝对值 + 数值型才有相对值）',
  `fingerprint` varchar(64) NOT NULL COMMENT '内容指纹 sha256',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_search_robustness_result_hash` (`robustnessRunId`,`parameterHash`),
  KEY `idx_search_robustness_result_run` (`robustnessRunId`,`combinationIndex`),
  KEY `idx_search_robustness_result_status` (`robustnessRunId`,`status`)
) COMMENT '单组合稳健性结果（ROBUSTNESS-001 §15）';

--> statement-breakpoint

-- @guard: table search_robustness_parameter_analysis
CREATE TABLE IF NOT EXISTS `search_robustness_parameter_analysis` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `robustnessRunId` varchar(80) NOT NULL COMMENT '归属 Robustness Run（软引用无 FK）',
  `sourceSearchRunId` varchar(80) NOT NULL COMMENT '源 Search Run（冗余）',
  `parameterName` varchar(64) NOT NULL COMMENT '参数名（行身份 = robustnessRunId + parameterName）',
  `domainMode` varchar(24) NOT NULL COMMENT 'FIXED / ENUM / INTEGER_RANGE / DECIMAL_RANGE（冻结快照形态）',
  `domainValueCount` int NOT NULL COMMENT '冻结搜索域里的取值个数',
  `numeric` boolean NOT NULL COMMENT '数值型（决定敏感性是否给相对变化；枚举给相对变化即伪语义）',
  `analyzedValueCount` int NOT NULL DEFAULT 0 COMMENT '参与分析的取值数',
  `stableCombinationCount` int NOT NULL DEFAULT 0 COMMENT '该参数切片上判 STABLE 的组合数',
  `unstableCombinationCount` int NOT NULL DEFAULT 0 COMMENT '该参数切片上判 UNSTABLE 的组合数',
  `verdict` varchar(16) NOT NULL COMMENT 'sensitive / insensitive / insufficient（描述性，不是「该参数好不好」）',
  `sensitivityJson` longtext NOT NULL COMMENT '单参数敏感性 JSON（entries + 均值/极值）',
  `valueDispersionJson` longtext NOT NULL COMMENT '取值维离散度 JSON（每值先取均值，再对均值做统计）',
  `fingerprint` varchar(64) NOT NULL COMMENT '内容指纹 sha256',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC 墙钟）',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_search_robustness_parameter_name` (`robustnessRunId`,`parameterName`),
  KEY `idx_search_robustness_parameter_run` (`robustnessRunId`)
) COMMENT '单参数稳健性分析（ROBUSTNESS-001 §13）';
