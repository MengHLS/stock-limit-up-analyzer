# CONTRACT-MAP — 核心契约地图

> Baseline **v2.0.0** · auditedAt **2026-09-20**（round-2 全量审计）· 首版 v1.0.0 / 2026-09-19
> 每条契约记录：定义位置 / producer / consumer / schema 或 type / 是否 versioned / 是否持久化 / 是否允许 nullable / 当前状态 / 重要兼容性规则。
> 🔴 **本文件只建立事实基线，不修改任何逻辑。**

---

## 0. 契约总览

| # | Contract | 定义位置 | versioned | 持久化 | 状态 |
|---|---|---|---|---|---|
| C-01 | Dataset Contract（wire） | `shared/datasetRegistryContracts.ts` | ❌（结构演化靠 migration） | ✅ `dataset_definition/version` | READY |
| C-02 | Dataset 领域契约 | `server/datasetRegistry/types.ts` | ❌ | ✅ + `ds_*` 五表 | READY |
| C-03 | Research Contract | `shared/researchContracts.ts` + `server/researchCore/types.ts` | ❌ | ✅ 10 张单数表 | READY |
| C-04 | Strategy Schema | `server/research/strategySchema/types.ts`（`StrategyDocument`）/ `definition.ts`（`StrategyDefinition`） | ✅ 两层指纹 + semver | ✅ `strategyDocumentJson` | READY |
| C-05 | Strategy Runtime Contract | `server/strategyCore/types.ts` + `runtime.ts` | ✅ Definition 指纹 | ⚠️ `StrategyRunSnapshot` 落 `resultJson.strategyRun` | READY |
| C-06 | Backtest Contract | `server/backtest/context.ts` + `types.ts` | ✅ `BACKTEST_EXECUTION_POLICY_VERSION` | ⚠️ 部分进 `resultJson.backtest.executionMetadata` | READY |
| C-07 | `BacktestRunResult` | `server/backtest/backtestResult.ts:65` | ✅ 含 `annualizationBasis` | ✅（有界载荷） | READY |
| C-08 | Canonical Metrics | `server/backtest/backtestResult.ts:392` | ✅ 8 键 + basis | ✅ | **唯一指标来源** |
| C-09 | Execution Policy | `server/backtest/context.ts:48` | ✅ **v1** | ✅ `executionPolicyVersion` | READY |
| C-10 | Evaluation Ref | `server/research/closedLoop/types.ts:375` | ✅ `metricsSource` | ✅ `summaryJson` | PARTIAL |
| C-11 | Closed Loop Contract | `server/research/closedLoop/types.ts` + `closedLoopWiring/requirements.ts` | ✅ 14 阶段 id | ✅ | PARTIAL（8/14 实装） |
| C-12 | `strategyRunRecordSchema` | `shared/researchContracts.ts:884`（zod `:1112`） | ✅ | ✅ `resultJson.strategyRun` | READY |
| C-13 | `backtestRunPayloadSchema` | `shared/researchContracts.ts:976`（zod `:1119`） | ✅ | ✅ `resultJson.backtest` | READY |

---

## C-01 / C-02 · Dataset Contract

| 项 | 内容 |
|---|---|
| **定义位置** | wire：`shared/datasetRegistryContracts.ts`（枚举 + zod + wire 类型 + 默认值）；领域：`server/datasetRegistry/types.ts` |
| **producer** | `DatasetRegistryService.createVersionWithBuildConfig`（`registry.ts:570`）→ `DefaultDatasetBuildRunner.start`（`runner.ts:141`） |
| **consumer** | `datasetRegistry` tRPC（24 procedure）、`DbDatasetDataReader`（研究唯一合法读层）、`datasetFromRegistry` 桥、前端 `/datasets/**` |
| **schema/type** | `DatasetDefinition` / `DatasetVersion` / `DatasetBuildJob` / `DatasetBuildConfigRecord` / `DatasetVersionCounts` |
| **versioned** | ❌ 无契约版本号；演化靠 migration（`0028` → `0029` → `0030`） |
| **持久化** | ✅ `dataset_definition` / `dataset_version` / `dataset_build_job` / `dataset_build_config(+_event,_board)` + `ds_*` 五表 |
| **nullable** | `dataset_version.datasetVersionId` 概念上非空；`ds_*` 行内 `previousClose` / `turnover` / `marketCap` 等**允许 NULL** |
| **兼容性规则** | ① `totalRows` 口径 **必须** = 五表行数之和（本次实查闭合，差 0）；② 没注册插件 code 构建时抛 `BUILDER_NOT_REGISTERED`；③ 未完成/非法筛选 ⇒ `INVALID_BUILD_FILTER`（**不留半成品版本**）；④ 涨停判定必须用四舍五入到分的交易所涨停价 |
| **状态** | READY（FACT） |
| **⚠️ 语义陷阱** | `prefix` 含 **rd = 0**（t 日）；`post`/`path` 只含 **rd ≥ 1**。`path` 仅衍生量、`prefix`/`post` 为原始行情（结构级防 PIT 泄漏，schema.ts:1372-1380） |

---

## C-03 · Research Contract

| 项 | 内容 |
|---|---|
| **定义位置** | wire：`shared/researchContracts.ts`；领域：`server/researchCore/types.ts`（**唯一权威**）+ `conditions.ts` / `results.ts` / `executionLog.ts` / `candidates.ts` / `findings.ts` |
| **producer** | `researchEngine`（分析引擎）/ `researchPlanner` |
| **consumer** | `research.strategyCandidate.*`（转正）、前端 `/research/**`、`researchRun.loopRun` |
| **versioned** | ❌ |
| **持久化** | ✅ 10 张单数表（+ `research_finding` / `research_question` / `research_plan` / 模板表） |
| **nullable** | `research_strategy_candidate.strategyDefinitionId` 允许 NULL（未转正）；`research_run.inputSnapshotJson` 允许 NULL（草稿态） |
| **兼容性规则** | ① `researchCore/types.ts:12-15` 显式声明与 `server/research/types.ts` **同名不同物**；② 不复用 barrel；③ `research_analysis_metric` 目前 **0 行**（结构化落列，非 JSON 一把梭）；④ **转正仅经 `strategyPromotionPort.ts`** |
| **状态** | READY（FACT） |
| **🔴 边界守护** | 原 `tests/server/research/strategyCandidate/importBoundary.test.ts:69-131`（固化「researchCore ↔ strategyPersistence/strategySchema 只允许经桥」）**已失效**（`researchCore` 已删除）。现行守卫 = `tests/server/research/legacyFreeProductionChain.test.ts`（import 图可达性 Gate） |

---

## C-04 · Strategy Schema

| 项 | 内容 |
|---|---|
| **定义位置** | `StrategyDocument` → `server/research/strategySchema/types.ts:240`；`StrategyDefinition`（Canonical 富模型）→ `definition.ts:618` |
| **producer** | `map.ts`（组装/克隆）、`projection.ts:151 buildStrategyProjections`（5 投影）、`legacyViews.ts:179 deriveLegacyViews`（v1 有损视图） |
| **consumer** | `strategyPersistence/db.ts`（同事务写 5 表）、`definitionBuild.ts`（转正生成）、Core 适配器、前端 `StrategyDetail.tsx` |
| **schema/type** | `StrategyDocument`（身份 / §16 rules / `parameters` / `datasetVersion(+Id)` / `executionAssumptions` / 可选 `definition` / 可选 `recipe` / `metadata` / `fingerprint`）；`StrategyDefinition`（`entry` / `exit` / `position` / `risk` / `execution` / `parameters` / `datasets`） |
| **versioned** | ✅ **两层指纹**：文档级（`fingerprint` 列）+ 定义级（`computeStrategyDefinitionFingerprint`）；semver `version`（结构→major，参数→minor） |
| **持久化** | ✅ `strategy_versions.strategyDocumentJson`（**唯一完整 SoT**）+ 5 张**单向派生**投影表 |
| **nullable** | `definition?` 与 `recipe?` 均可选（存量 `limit-up-baseline` 无 `definition` ⇒ 走 legacy 回落）；`datasetVersionId?` 可空（legacy 内容寻址路径） |
| **兼容性规则** | ① 🔴 投影表**禁止反向拼装**；② 读取必经 `assertStoredVersionConsistency()`（`consistency.ts:97`）三方指纹断言，不一致**响亮失败、不修复、不择一覆盖**；③ v1 字段是**有损派生视图**（`legacyViews.ts:12` 显式登记损点，`parameterRole`/`unit`/`derivedFrom` 在 v1 无对应位）；④ Look-Ahead 静态校验 L1–L8，**白名单而非黑名单**，时间语义不明默认拒绝 |
| **状态** | READY（FACT） |

---

## C-05 · Strategy Runtime Contract

| 项 | 内容 |
|---|---|
| **定义位置** | `server/strategyCore/types.ts`（`StrategyCoreError`）；入口 `server/strategyCore/runtime.ts#StrategyRuntime.evaluate`（内部 `evaluateWithDetail`）。⚠️ 该文件处于高频编辑中，**以符号名为准**（不再引用行号） |
| **producer** | `strategyCore/production/coreDecision.ts:152 createCoreDecisionSource`（**唯一**调用 `StrategyRuntime` 处） |
| **consumer** | `runWorkbenchAssembly/assemble.ts:752-755`（注入 `strategy13.signalBuilder`）→ `simulator` |
| **schema/type** | `StrategyVersion` / `StrategyCoreDefinition` / `StrategyDecision`（`decision.ts:27`）/ `DecisionEvent` / `EntryIntent` / `StrategyRunSnapshot`（`runSnapshot.ts:108`）/ `DatasetReference`（`:42`） |
| **versioned** | ✅ Definition 指纹（`fingerprint.ts:22 FINGERPRINT_SCOPES`） |
| **持久化** | ⚠️ `StrategyRunSnapshot` 落 `closed_loop_backtest_run.resultJson.strategyRun.strategyRunSnapshot`（**未单独建表**，刻意零 migration） |
| **nullable** | `context.resolveEvent` 可选，但**未注入即抛**（不静默 false）；`datasetReference.datasetVersionId` 在回落重建时可空 |
| **兼容性规则** | ① `updateVersionDefinition()` **恒抛** `VERSION_IMMUTABLE`（`version.ts:180`）；② `WINDOW` 只考虑当前决策日及之前 ⇒ **必须逐决策日 evaluate**；③ `DATASET_BINDING_IN_DEFINITION_FORBIDDEN`（`dataRequirements.ts:350`），禁键表 `:294`（含 `datasetVersionId` / `tableName` / `engineVersion` / `codeVersion`），**机器可查**；④ `usesForwardData=true` **无法注册**为特征；⑤ legacy ⇄ Core 双向翻译靠 `adapters/legacyDefinition.ts`，未登记映射即抛 `LEGACY_MAPPING_UNSUPPORTED` |
| **状态** | READY（FACT，已接生产） |

---

## C-06 / C-09 · Backtest Contract + Execution Policy

| 项 | 内容 |
|---|---|
| **定义位置** | `server/backtest/context.ts`；领域模型 `types.ts` |
| **producer** | `runWorkbenchAssembly/assemble.ts`（机械映射 `document.positionSizing` / execution semantics → `SimulationConfig`） |
| **consumer** | `simulator/engine.ts:250 runTradeSimulation`、`closedLoopWiring/executors.ts:505` |
| **schema/type** | `BacktestContext`（`context.ts:139`）/ `ExecutionPolicy`（`:51`）/ `OrderIntent`（`:342`）/ `PositionSizingMapping`（`:277`）/ `ExecutionModelId`（`types.ts:57`）/ `RejectionReason`（`:47`） |
| **versioned** | ✅ `BACKTEST_EXECUTION_POLICY_VERSION = 1`（`context.ts:48`）+ `BACKTEST_EXECUTION_POLICY_KEYS`（`:87`） |
| **持久化** | ⚠️ 政策全文（含版本号）进 `assembly.strategyDecisionEngineNote` → Run Record + `resultJson.backtest.executionMetadata.executionPolicyVersion` ⇒ **零 schema 变更** |
| **nullable** | `zeroVolumePolicy` 有默认 `REJECT`；`allowPartialFill` 默认 `true`；`suspensionPolicy` 默认 `REJECT` |
| **兼容性规则** | ① 默认政策 = T+1 强制 + 拦涨停买 + 拦跌停卖 + 停牌拒单不顺延 + 允许部分成交；② 执行语义不在 `SUPPORTED_EXECUTION_SEMANTICS`（`:197`）⇒ 装配层**响亮抛错** `..._EXECUTION_SEMANTICS_UNSUPPORTED`（`:223`）；③ 未知 `positionSizing` kind ⇒ 抛 `..._UNKNOWN_POSITION_SIZING`；④ 缺 `fraction` **响亮抛错**，不静默回落到等权；⑤ 🔴 **历史 6 条留档在 v0 隐式政策下，未回填** |
| **状态** | READY（FACT） |

### C-100 RECOVERY-ST-FIX-005 增量：**可选执行资格闸门** `SimulationConfig.executionEligibilityGate`（2026-10-11 · `9c5`）

| 项 | 内容 |
|---|---|
| **定义位置** | `server/research/simulator/types.ts`（`ExecutionEligibilityGate` / `ExecutionEligibilityCheckInput` / `ExecutionEligibilityDecision` / `ExecutionEligibilityAuditEntry`） |
| **producer（注入方）** | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts#createStExecutionEligibilityGate`（研究装配层；`policyVersion = recovery-st-execution-eligibility/1.0.0`） |
| **consumer** | `server/research/simulator/engine.ts#runTradeSimulation`（due-order 循环内的买入分支）+ `validate.ts`（形状与 `FILLED ⇒ NORMAL` 断言） |
| **可选性** | ✅ `readonly executionEligibilityGate?: ExecutionEligibilityGate \| null`，缺省 / `null` ⇒ 既有执行路径**逐字节不变**（含 001/002/003 与正式策略） |
| **快照** | `SimulationConfigSnapshot.executionEligibility?: { gateId, policyVersion }` —— **只放身份，函数不入 JSON** |
| **输出** | `TradeSimulationRun.executionEligibilityAudit?`（仅声明闸门时出现；逐笔 status / reason / providerId / policyVersion / checkedAt / plannedCheckDate / outcome） |
| **语义** | 只约束**买入**；`status !== "NORMAL"` 或 `allowed !== true` ⇒ 拒单（早于现金 / 持仓 / 成本 / 成交计数）；卖出不受影响 |
| **兼容性规则** | ① 未声明 ⇒ 记录与指纹不变（digest 常量锁）；② 声明 ⇒ 新字段出现，快照里只有可序列化身份；③ 非法形状 ⇒ `SIM_CONFIG_EXECUTION_ELIGIBILITY_GATE_INVALID` 响亮失败，不静默退化成「没有闸门」；④ `decideBuy` 返回非对象 ⇒ 引擎抛 `EXECUTION_ELIGIBILITY_GATE_INVALID` |
| **DB 变更** | **0 表 / 0 列 / 0 migration** |
| **状态** | READY（FACT，additive minor；基线 `v2.4.0` → 已在 `v2.8.0` 合并） |

### C-101 RECOVERY-ST-FIX-005 **续修 / Finding A** 增量：**权威装配配置入口契约** `composite-assembly-config/1.0.0`（2026-10-11 · `9c5b`）

| 项 | 内容 |
|---|---|
| **定义位置** | `server/research/compositeRunner/index.ts`：`COMPOSITE_ASSEMBLY_CONFIG_CONTRACT_VERSION` / `AssembleCompositeRunnerSimulationConfigInput` / `CompositeRunnerAssemblyConfigResult` / `assembleCompositeRunnerSimulationConfig` / `fingerprintSimulationConfig` |
| **契约版本** | ✅ `COMPOSITE_ASSEMBLY_CONFIG_CONTRACT_VERSION = "composite-assembly-config/1.0.0"`（随产物返回，进留档） |
| **producer** | `assembleCompositeRunnerSimulationConfig(input)`（**只装配、不撮合**） |
| **consumer** | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts#run`（经 `@experiments/compositeRunnerBridge` 零实现 re-export）；`runCompositeRunnerBacktest` 内部同一实现 |
| **入参** | `Omit<RunCompositeRunnerBacktestInput, "sourceRun">` + 可选 `corporateActionResolver`（缺省 ⇒ 装配层照旧读 `corporate_actions`，请求对象**不多键**） |
| **产物** | `{ contractVersion, simulationConfig, assemblyConfigFingerprint, assembly }` —— 🔴 **结构上不存在** `run` / 交易 / 权益曲线（不是「结果被丢弃」，而是**没有产生结果**） |
| **装配链（未改）** | → `server/runWorkbenchAssembly/assemble.ts#assembleRunWorkbenchInputs`（唯一装配实现；注入数据集 ⇒ `resolveDataset` = `injected`） |
| **指纹** | `fingerprintSimulationConfig(config) = sha256(canonicalJson(配置可序列化面))`（hex 64）；函数值以 `fn:<name>` 占位（**不静默丢弃**）；⚠️ **不是** `run.fingerprint` |
| **兼容性规则** | ① 既有调用方（`paperTrading3fTop3Runner/**`、其它 `research-experiments/**`）**零改动**；② 与 `runCompositeRunnerBacktest` 的 `simulationConfig` 深层相等 + 指纹相等（测试实测）；③ 缺省（无闸门）真实撮合的 `tradeDigest` / `equityDigest` / `run.fingerprint` / `canonicalMetrics` 与旧路径**逐字节相同**；④ 纯撮合层 `server/research/simulator/**` **零改动**，无反向依赖、不连 DB |
| **DB 变更** | **0 表 / 0 列 / 0 migration / 0 写入** |
| **状态** | READY（FACT，additive minor；基线 `v2.8.0`；验收见 `tests/server/researchExperiments/rollingPoolRecoveryStAuxiliaryAssembly.test.ts`） |

---

## C-07 / C-08 · `BacktestRunResult` 与 Canonical Metrics

| 项 | 内容 |
|---|---|
| **定义位置** | `server/backtest/backtestResult.ts`：`BacktestRunResult:65` / `BacktestMetrics:41` / `BacktestRunPayload:451` / `NOT_AVAILABLE:30` / `canonicalMetrics():392` / `CANONICAL_METRIC_KEYS:336` |
| **producer** | `buildBacktestResult()`（`:267`，内部调 `canonicalMetrics`）/ `buildBacktestRunPayload()`（`:519`） |
| **consumer** | `closedLoop/adapters.ts:134 composeClosedLoopEvaluationRef`、`closedLoopWiring/executors.ts:584-592`、`closedLoopBacktestRun/repository.ts`、前端 `BacktestRuns.tsx` |
| **schema/type** | `CanonicalMetrics`（8 键）/ `CanonicalMetricsDetail` / `BacktestRunPayload` |
| **versioned** | ✅ `BACKTEST_ANNUALIZATION_BASIS`（`{type:"TRADING_DAYS",daysPerYear:252}`，可序列化自述） |
| **持久化** | ✅ `resultJson.backtest`（`equitySamples ≤ 60` / `tradeSamples` / `truncated` / `rollingDigest` / `equityDigest` / `tradeDigest`） |
| **nullable** | `NOT_AVAILABLE` 哨兵值；`openAtEndCount` 独立计数（期末未平仓**不计**胜率/盈亏比） |
| **🔴 兼容性铁律** | ① **canonicalMetrics 是 Backtest 的唯一指标来源**；② **Evaluation 在已有 canonical 时不得重新计算重叠指标**；③ `NOT_AVAILABLE` **不得**被评估器数值顶替（有测试）；④ 年化 **252**（`n = 权益点数 − 1`）且**必须复用** `shared/quant-stats#annualizedReturnFromEquityCurve`；⑤ `maxDrawdownPct` = **正数幅度**，逐点 `drawdownPct` 才是有符号；⑥ 收益率算式统一 `(end/start − 1) × 100`——**代数等价但浮点不同**，写法必须逐字符一致；⑦ `BacktestRunResult`（新）与 `types.ts:401 BacktestResult`（legacy）**同域不同形**，禁混用；⑧ `backtest` 段在共享契约中**可选** ⇒ 历史留档不受影响 |
| **状态** | READY（FACT） |

---

## C-10 / C-11 · Evaluation Ref 与 Closed Loop Contract

| 项 | 内容 |
|---|---|
| **定义位置** | `server/research/closedLoop/types.ts`（`ClosedLoopEvaluationRef:375`、`CLOSED_LOOP_STAGE_IDS:34-49`）/ `spec.ts`（StageSpec + 拓扑校验）/ `blockers.ts`（合法 BLOCKED reasonCode）/ `guards.ts`（handoff 契约 + NaN/Infinity 拦截） |
| **producer** | `runClosedLoop`（`closedLoop/orchestrator.ts`）；装配 `createClosedLoopWiring`（`closedLoopWiring/executors.ts:713`） |
| **consumer** | `researchRunRouter.loopRun:625`；前端 `BacktestRuns.tsx` / `PerformanceDashboard.tsx` |
| **schema/type** | `ClosedLoopRunResult` / `ClosedLoopEvaluationRef`（含 `performance` / `riskAdjusted` / `tradeQuality` / `backtestFingerprint` / `canonicalMetrics` / `metricsSource` / `annualizationBasis`） |
| **versioned** | ✅ 阶段 id 集（14 项）+ `executionPolicyVersion` |
| **持久化** | ✅ `summaryJson` + `resultJson`；列表**不读** `resultJson`（`SUMMARY_COLUMNS`） |
| **nullable** | `canonicalMetrics` 可空 ⇒ 此时 `metricsSource = "evaluators"`（**如实降级**）；`firstBlockedReasonCode` 允许 NULL |
| **兼容性规则** | ① 未装配阶段**必须**以 `CL_RUNNER_NOT_INJECTED` 如实 BLOCKED（`executors.ts:379` `if (!requirement.wired) continue`），🔴 **不得改成静默 success**；② 年化基数不一致 ⇒ 抛 `CL_WIRING_ANNUALIZATION_BASIS_MISMATCH`（`executors.ts:565-574`）；③ handoff 契约由 `guards.ts` 强制，NaN/Infinity 拦截；④ `metricsSource` 只允许 `"canonical"` \| `"evaluators"` |
| **状态** | **PARTIAL**（14 阶段实装 **8**：`data` / `research` / `strategy` / `backtest` / `evaluation` / `optimization` / `regime` / `finalize`；未装配 6：`robustness` / `oos` / `overfitting` / `paper` / `review` / `discipline`） |

---

## C-12 / C-13 · 留档载荷契约

| 项 | `strategyRunRecordSchema`（C-12） | `backtestRunPayloadSchema`（C-13） |
|---|---|---|
| 定义位置 | `shared/researchContracts.ts:884`（zod `:1112`） | `shared/researchContracts.ts:976`（zod `:1119`） |
| producer | `strategyCore/production/runRecord.ts:99 buildStrategyRunRecord` | `backtest/backtestResult.ts:519 buildBacktestRunPayload` |
| consumer | `closedLoopBacktestRun/repository.ts` + 前端 adapter | 同左 |
| 落点 | `resultJson.strategyRun`（`researchRunRouter.ts:746`） | `resultJson.backtest`（`:774-791`） |
| versioned | ✅ | ✅（含 `executionMetadata.executionPolicyVersion`） |
| 持久化 | ✅（实测 1/7 行有） | ✅（实测 1/7 行有 `policyVer=1`） |
| nullable | 段可选 | **段可选** ⇒ 历史留档零影响 |
| 兼容性规则 | 🔴 与 `backtest` 段**并列、互不覆盖** | 🔴 有界（≤60 采样）+ 双 digest 保证「同配置可复现 / 跨参数可比对」 |
| 状态 | READY | READY |

---

## 附录 · 契约兼容性检查清单（后续改动必查）

1. 改 `canonicalMetrics` / 年化 / 算式形式 ⇒ 必跑 `canonicalMetricsParity.test.ts`（10 位小数逐位相等）。
2. 改 `ExecutionPolicy` ⇒ 必须 bump `BACKTEST_EXECUTION_POLICY_VERSION`，且**不得**回填历史留档。
3. 改 Strategy Schema ⇒ 必须同步 5 投影派生 + `assertStoredVersionConsistency` 三方指纹。
4. 改 Core Definition 结构 ⇒ 必须过 `adapters/legacyDefinition.ts` 双向翻译测试（`legacy→Core→legacy→Core` 指纹逐字节相等）。
5. 新增 `resultJson` 段 ⇒ 必须**可选**（zod optional），否则历史留档读取会炸。
6. 改 Research 表 ⇒ 必须过 `tests/server/research/legacyFreeProductionChain.test.ts`（生产链 import 图可达性；原 `importBoundary.test.ts` 已删除）。
7. 改 Dataset 物理表 ⇒ 必须同步插件声明式 DDL + `apply*` 脚本 + `totalRows` 口径（五表之和）。

---

## C-94 PHASE-R1-001 增量：**判定日契约** `decisionOffsetDays`（2026-09-20 · `9bz`）

| 项 | 内容 |
|---|---|
| **定义位置** | wire: `shared/researchContracts.ts` 的 `pullbackScreenConditionSchema.decisionOffsetDays`（**必填、无 default、`.int().min(1).max(10)`**）；领域: `server/researchDataset/types.ts` `PullbackScreenCondition.decisionOffsetDays` |
| **producer** | 数据集构建请求（用户/tRPC）→ `researchDataset/builder.ts` 落 `universeDefinition.pullbackDecisionOffsetDays`（随版本冻结）；研究侧另有 Run/Experiment/Analysis 三级声明 |
| **consumer** | `researchDataset/pullback.ts#resolveDecisionOffsetDays`（截断池子）；`researchEngine/variables.ts#resolveEffectiveDecisionOffset` → `assertGroupObservationPitSafe` |
| **versioned** | ✅ 随 `dataset_version` 冻结（`universeDefinitionJson`，**零新列**） |
| **持久化** | ✅ `dataset_version.universeDefinitionJson` + `research_run/experiment/analysis.config` JSON |
| **nullable** | ❌ 数据集侧**必填**；读取侧 `ResearchDatasetVersionContext.decisionOffsetDays: number \| null`（**取不到即 null，不默认整窗**） |
| **🔴 兼容性铁律** | ① 四级**同值**，异值 ⇒ `DECISION_OFFSET_CONFLICT`；② 存在但非法 ⇒ `INVALID_DECISION_OFFSET`；③ 四级全空 + 引用观察日变量 ⇒ `OBSERVATION_WITHOUT_DECISION_DAY`（**拒绝整个 Run**）；④ `d = N` 时与修复前整窗语义**逐字等价**（判定函数未改 + 窗口集合相同）⇒ 可作修复前后对照；⑤ **老数据集（无声明）上一切观察日条件会被拒绝**（这是刻意行为，不是回归） |
| **状态** | READY（FACT）；⚠️ 已知缺口：`INVALID_PULLBACK_DECISION_OFFSET`（数据集校验码）**未映射 tRPC code** ⇒ 落 `INTERNAL_SERVER_ERROR` |

## C-95 PHASE-B-001 增量：**Pattern 语义契约** `shared/patternSemantics.ts`（2026-09-20 · `9ca`）

| 项 | 内容 |
|---|---|
| **定义位置** | `shared/patternSemantics.ts`（**全新，零依赖纯函数，放 `shared/` 以便两侧共用**）：`SEMANTIC_OPERATORS`（**16 项白名单**：比较 9 + 聚合 7）、`PatternSemanticDeclaration`（**纯数据**）、`expandPatternSemantics()`（**唯一 Expander**）、`buildSemanticVariableName()` |
| **producer** | Pattern 声明文件（`server/research/patternLibrary/patterns/*.ts` 的 `semantics?`）+ 唯一 SoT 注册表 `server/research/patternLibrary/semanticRegistry.ts`（**深冻结 + 注册期响亮拒绝**：`MISSING_SEMANTICS_VERSION` / `SEMANTIC_REDEFINITION` / `SEMANTIC_ID_COLLISION` / `INVALID_SEMANTIC_DECLARATION`） |
| **consumer** | 研究侧 `server/researchEngine/semanticProjection.ts`（→ 观察日变量目录，**已接生产** `engine.ts`）；策略侧 `server/research/patternLibrary/strategyProjection.ts`（→ 策略特征，**仅测试可达**）；派生桥 `strategyCandidate/evidenceDerivation.ts` 用它当**唯一翻译层** |
| **versioned** | ✅ 注册表 fingerprint（sha256 over 键序固定 JSON）+ `patternId@version` 唯一 |
| **持久化** | ⚠️ 注册表本身在内存（模块级冻结缓存）；投影产物随 `research_artifact` / `sourceTraceJson` 留档 |
| **nullable** | `TradingPatternSpec.semantics?` 可选（未声明 ⇒ 该 Pattern 的语义变量不进目录） |
| **🔴 兼容性铁律** | ① 声明**不含实现**（无回调/SQL）；② **唯一 Expander**：两侧只消费展开产物，**不得自行展开**；③ 可用性由**真实决策日**推导 + 投影期 `availableFromOffset ≤ 决策日` **可失败**闸门（**不再用 `1990-01-01` 恒真日期**）；④ 旧 `samePointAvailability`（`recipeRegistryAtoms.ts`）保留但**不再被新投影消费** |
| **状态** | 研究侧 READY（FACT）；**策略侧 CODE_READY（未接线）** |

## C-96 PHASE-A-001 / PHASE-D-001 增量（2026-09-20 · `9by` / `9cb`）

| Contract | 定义位置 | 关键纪律 | 状态 |
|---|---|---|---|
| **Report Artifact**（A） | `server/researchEngine/report/types.ts`（`REPORT_ARTIFACT_TYPE=REPORT` / `REPORT_STORAGE_TYPE=INLINE` / `buildReportUri`）+ `generator.ts`（**纯投影、不读时钟**）+ `service.ts`（装配 + 幂等落库） | checksum = sha256 over **报告正文 utf8**；幂等 = **服务层 checksum 比较**（`CREATED`/`REUSED`/`SUPERSEDED`），**DB 无唯一约束**；`emitReportArtifact` **best-effort 吞错** | READY（FACT，已观测到真实 Run 触发） |
| **Evidence Derivation**（D） | `server/research/strategyCandidate/evidenceDerivation.ts`（`:302+` 输入、`:320 deriveCandidateRules()`、`:176-200` 输出 `CandidateDerivation`） | 输入 = conclusion + findings + `semanticIndex` + `parameterCodes`；**翻译层 = Pattern 语义声明**；`filterRule` 用 `bar.<featureId>` + `thresholdParam`（**参数引用，不写死数字**）；不可翻译走闭集 `DERIVATION_SKIP_REASONS`（**绝不猜**）；`deriveFromEvidence:false` ⇒ **逐字回到修复前行为**（`filterRule=null`） | READY（FACT） |

---

## C-90 PARAMETER-001 增量：新增契约 `shared/parameterSearchContracts.ts`（2026-09-19 · `9bs`）

| 项 | 值 |
|---|---|
| 定义位置 | `shared/parameterSearchContracts.ts`（zod schema + `z.infer` 派生类型，**同文件**） |
| producer | `server/research/parameterSearch/searchSpace.ts` / `combination.ts` / `parameterHash.ts` / `searchRun.ts` / `searchResult.ts` / `executor.ts` |
| consumer | `server/paramSearchRouter.ts`（7 端点入参 / 出参校验）、`client/src/components/parameterSearch/PersistedParameterSearchPanel.tsx` |
| versioned | **是**：`PARAMETER_SEARCH_SPACE_RECORD_VERSION = 1` / `PARAMETER_SEARCH_RESULT_RECORD_VERSION = 1`（字段语义变更必须递增） |
| 持久化 | **是**：参数空间快照 → `parameter_search_run.parameterSpaceJson`；结果视图 → `parameter_search_result` 各列 |
| nullable | 指标六项 + `backtestFingerprint` / `backtestRunId` / `evaluationId` / `evaluationRunId` / `annualizationBasis` 均可为 `null`（**`null` = 不可用，不等于 0**） |
| 兼容性规则 | **新增字段一律可选**（历史行读取不得炸）；`recordKind` / `recordVersion` 为判别字段；每次读库都重新校验结构，非法即抛（不返回半个对象） |
| 状态 | FACT（真实端点 + 真实落库 + 真实 E2E 通过） |

**契约三要素（本契约特有的两条纪律）**：

1. 🔴 **指标是「读数快照」不是「计算契约」**：`parameterSearchMetricsViewSchema` 的六项全部来自
   `ClosedLoopEvaluationRef#canonicalMetrics`（缺省时回落 `performance` / `tradeQuality` 并标 `metricsSource="evaluators"`）。
   契约层**不得**新增任何派生指标字段。
2. 🔴 **`searchMethod` 的扩展位是「已登记未实现」**：`PARAMETER_SEARCH_METHODS` 含 `RANDOM_SEARCH` / `BAYESIAN` / `TPE`，
   但 `IMPLEMENTED_PARAMETER_SEARCH_METHODS` 只有 `GRID_SEARCH` ⇒ 未实现的方法**入参层响亮拒绝**，**不静默降级**为 GRID_SEARCH。

## C-91 ROBUSTNESS-001 增量：新增契约 `shared/searchRobustnessContracts.ts`（2026-09-19 · `9bu`）

| 项 | 内容 |
|---|---|
| 定义位置 | `shared/searchRobustnessContracts.ts`（zod schema + `z.infer` 派生类型，**同文件**） |
| producer | `server/research/searchRobustness/{analysis,executor,persistence,run}.ts` |
| consumer | `server/paramSearchRouter.ts`（6 端点入参 / 出参校验）、`client/src/components/robustness/SearchRobustnessPanel.tsx` |
| 复用（**不重复定义**） | `parameterSearchValueSchema`（参数值同域）、`parameterSearchSpaceDefinitionSchema`（冻结快照同域）、`parameterSearchRunStatusSchema`（状态机同词表） |
| 持久化 | **是**：Run 视图 ↔ `search_robustness_run`；Result 视图 ↔ `search_robustness_result`；参数分析视图 ↔ `search_robustness_parameter_analysis` |
| Breaking | **否**：全新文件；`C-90` 只**向后兼容**新增两个**可选**字段（`referenceCheckApplied` / `unreferencedTunableCodes`）⇒ 历史行读取不炸 |

### 契约纪律（本契约特有）

1. 🔴 **不得出现结论性词汇**（「最佳 / 最优 / 推荐 / winner / best / optimal」）：排序字段只有描述性维度（`combinationIndex` / 六指标 / `stabilityRatio`）。该禁令由 `tests/server/research/searchRobustness/robustnessBoundary.test.ts` 以**源码扫描 + 负例自测**钉住（守卫自身失效也会被抓到）。
2. 🔴 **`null` 就是 `null`**：指标不可用、`stabilityRatio` 无有效邻居 / 基准不可判、`withinTolerance` 无基准 —— 契约里全部显式 `.nullable()`，**禁止**用 0 / 100 冒充。
3. ⚠️ 矩阵单元格 `status` 的私有取值 `MISSING` / `AMBIGUOUS` **不属于**运行期判定枚举（`ROBUSTNESS_COMBINATION_STATUSES`）—— 它们是「矩阵投影层」的格状态，刻意分开，避免下游把「源 Search 缺该组合」误当「判定结论」。

## C-92 OOS-001 增量：新增契约 `shared/oosValidationContracts.ts`（2026-09-19 · `9bv`）

| 项 | 内容 |
|---|---|
| 定义位置 | `shared/oosValidationContracts.ts`（zod schema + `z.infer` 派生类型，**同文件**） |
| producer | `server/research/oosValidation/{freeze,window,gate,comparison,run,definitionFingerprint,persistence,executor}.ts` |
| consumer | `server/paramSearchRouter.ts`（6 端点入参 / 出参校验）、`client/src/components/oos/OosValidationPanel.tsx` |
| 复用（**不重复定义**） | `parameterSearchValueSchema`（参数值同域）、`PARAMETER_SEARCH_RUN_STATUSES`（**状态机同词表**：`OOS_VALIDATION_RUN_STATUSES = PARAMETER_SEARCH_RUN_STATUSES`） |
| 持久化 | **是**：Run 视图 ↔ `oos_validation_run`；Result 视图 ↔ `oos_validation_result` |
| Breaking | **否**：全新文件；**未改动**任何既有契约（`C-90` / `C-91` 本轮零改动） |

### 契约纪律（本契约特有）

1. 🔴 **创建入参只有 4 个键**（`sourceSearchRunId` / `parameterHash` / `oosWindow` / `metricsVersion?`）
   —— **没有放参数值的位置**。这是规格 §5「OOS 不允许再调参」在**契约层**的落地：
   让「顺手传一组更好的参数」**在类型层面就无处可写**（UI 侧由 DOM 探针实测「创建区 `<input>` 恰为 4 个」）。
2. 🔴 **`create` 与 `start` 是两个入参 / 两个端点**：`createOosValidationInputSchema` 只冻结配置，
   执行由 `oosValidationRunIdInputSchema` + `startOosRun` 单独触发 ⇒ 契约层就**不允许**「创建即执行」。
3. 🔴 **不得出现结论性词汇**（「最佳 / 最优 / 推荐 / winner / best / optimal」）：
   `oosComparisonSchema` 只承载 **delta / ratio / 退化 / 回撤变化** 这类**描述性量**，
   **不含**任何 verdict 字段。该禁令由 `tests/server/research/oosValidation/oosValidationBoundary.test.ts`
   以**源码扫描**钉住。
4. 🔴 **`null` 就是 `null`**：`oosMetricsSchema` 六项全部 `.nullable()`；
   `ratio` 在 IS = 0 时**必须**为 `null`（**不许**用 0 / 100 冒充）；
   `comparisonJson` 的 `notes` 显式说明「为何不可比」⇒ 不静默。
5. ⚠️ `oosComparisonSchema` **不是索引签名**而是**显式命名字段**（`totalReturnPctDelta` / `…Ratio` …）
   ⇒ 新增指标时**必须同时**改契约与前端 `METRIC_ROWS`，否则前端显示「—」而不是编一个数
   （这个「漏改就显示 —」的性质是**刻意**的，不是疏漏）。
6. ⚠️ `OosContractAssertion<A, B>` 类型断言用于把「视图类型」与「领域层返回类型」钉成同一份，
   避免两处各自漂移。

## C-93 WALK-FORWARD-001 增量：新增契约 `shared/walkForwardContracts.ts`（2026-09-19 · `9bw`）

| 项 | 内容 |
|---|---|
| 定义位置 | `shared/walkForwardContracts.ts`（zod schema + `z.infer` 派生类型，**同文件**） |
| producer | `server/research/walkForward/{types,windowSchedule,lifecycle,leakage,freeze,selection,aggregate,run,persistence,executor}.ts` |
| consumer | `server/paramSearchRouter.ts`（6 端点入参 / 出参校验）、`client/src/components/walkForward/WalkForwardPanel.tsx` |
| 复用（**不重复定义**） | `parameterSearchValueSchema`（参数值同域）、`PARAMETER_SEARCH_RUN_STATUSES` 家族（**状态机同词表**）、`OOS_ENGINE_VERSION` / `OOS_METRICS_VERSION`（**只取常量**，见 §契约纪律 5） |
| 持久化 | **是**：Run 视图 ↔ `walk_forward_run`；Fold 视图 ↔ `walk_forward_fold` |
| Breaking | **否**：全新文件；**未改动**任何既有契约（`C-90` / `C-91` / `C-92` 本轮零改动） |

### 契约纪律（本契约特有）

1. 🔴 **窗口几何四键的单位是「交易日个数」**（`isWindowDays` / `oosWindowDays` / `stepDays` + `windowMode`）——
   不是日历天。契约层与 UI 层（`#wf-is-days` 旁的单位提示）**双处写明**。
2. 🔴 **`create` 与 `start` 是两个入参 / 两个端点**：`createWalkForwardValidationInputSchema` 只冻结排程与身份，
   执行由 `walkForwardRunIdInputSchema` + `startWalkForwardRun` 单独触发 ⇒ 契约层就**不允许**「创建即执行」。
3. 🔴 **无死旋钮**：创建入参里的**每一个键**都必须被真实读到 —— 要么进域执行器的
   `request.${key}`，要么进 Router 端点段 `input.${key}`。该断言由
   `tests/server/research/walkForward/walkForwardBoundary.test.ts` §13 **逐键扫描**钉住。
   （本轮据此**删除**了原本「被接受但从未生效」的 `parameterSearchSpace`。）
4. 🔴 **不得出现结论性词汇**（「最佳 / 最优 / 推荐 / winner / best / optimal / 评级 / 择优」）：
   `walkForwardSelectionPolicySchema` 只承载**位置规则**（`FIRST_ELIGIBLE_COMBINATION` / `EXPLICIT_PARAMETER_HASH`），
   `walkForwardAggregateSchema` 只承载**描述性统计**（`foldCount` / 各计数 / `isStats` / `oosStats`），
   **不含**任何 verdict 字段。源码扫描守卫钉住。
5. 🔴 **跨域只取常量、不取实现**：本契约与域层引用 `oosValidation/types` 仅为
   `OOS_ENGINE_VERSION` / `OOS_METRICS_VERSION` ⇒ 静态守卫为这条路径留**后缀级窄豁免**，
   并**断言豁免面恰为 `["../oosValidation/types"]`**（豁免面扩大即测试变红）。
6. 🔴 **冻结坐标六项**：创建时冻结 `strategyFingerprint` / `datasetVersionId` / `windowSchedule` /
   `selectionPolicy` / `engineVersion` / `metricsVersion`；运行期任一不一致 ⇒ **FAIL LOUDLY**，**不自动修复**。

---

## C-97 PD-03 增量：候选列表只读契约 `strategyDomain.strategyCandidate.list`（2026-10-03）

| 项 | 内容 |
|---|---|
| **定义位置** | `server/research/strategyCandidate/router.ts`（`candidateListInput` / `candidateListRowSchema`，zod + TS 同源由 `.output()` 收口） |
| **producer** | `StrategyCandidateService.list(filter)` → `ResearchStrategyCandidateRepository.list(filter)` |
| **consumer** | 前端候选列表页 `client/src/pages/candidates/CandidateList.tsx`（路由 `/candidates`） |
| **versioned** | ❌ |
| **持久化** | 读 `research_strategy_candidate`（**零 DDL / 零 migration**） |
| **nullable** | `sourceDatasetVersionId` / `strategyDefinitionId` / `createdAt` / `updatedAt` 允许 `null` |
| **Breaking** | **否**：新增只读端点；既有 `get` / `update` / `transition` / `promote` / `getVersionProvenance` 签名与行为零改动 |
| **状态** | READY（FACT） |

### 契约纪律（本契约特有）

1. 🔴 **只读**：本端点不写库、不改状态；写操作仍只经 `update` / `transition` / `promote`。
2. 🔴 **不得出现旧链遗留列**：`experimentId` / `conclusionId`（旧 Research 链，已随 `RESEARCH-EXPERIMENT-003` 退役）
   **禁止**进入 input 契约；仓储层虽保留这两个 key，但新 API 不得把退役结构固化下来。
3. 🔴 **轻量行**：输出恰好为 `id` / `name` / `status` / `sourceDatasetVersionId` / `strategyDefinitionId` /
   `createdAt` / `updatedAt` / `hasSourceDatasetDivergence` —— **不含** entry/filter/exit/risk/parameterSpace 五套 JSON。
4. 🔴 **无 N+1**：列表**不解析** Dataset 版本（那是 `get` 的职责）；`hasSourceDatasetDivergence` 仅由快照列
   `sourceDatasetDivergenceReason` 派生。
5. 🔴 **来源 ≠ 执行绑定**：`sourceDatasetVersionId` 是「基于哪份数据研究出来的」，不是 Strategy 的执行绑定坐标；
   两者不同的候选必须在 UI 上可见（分歧标记）。
6. **状态闭集单一来源** = `server/research/vocabulary.ts#RESEARCH_CANDIDATE_STATUSES`（router 不另抄一份）。

---

## C-98 SCOPE-002 增量：策略创作工作台契约 `strategyDomain.authoring.*`（2026-10-03）

| 项 | 内容 |
|---|---|
| **契约** | `strategyDomain.authoring.{getVocabulary, getBlankDraft, materializePreset, previewDocument, saveDraft}` |
| **定义位置** | `server/research/strategyAuthoring/router.ts`（挂载于 `server/strategyDomainRouter.ts`） |
| **共享 schema** | `shared/researchContracts.ts`：`strategyAuthoringSlotSchema` · `strategyPresetParameterValueSchema` · `strategyAuthoringBlankInputSchema` · `materializeStrategyPresetInputSchema` · `strategyAuthoringDraftOriginSchema` · `saveStrategyAuthoringDraftInputSchema` · `previewStrategyAuthoringDocumentInputSchema` |
| **语义** | 只做「把用户选择变成 canonical 文档」的**辅助**：词表（预设 / recipe / runner 状态 / strategyType / lifecycle）· 空白草稿骨架 · 预设物化（RFC 6901 JSON Pointer + 既有校验器）· 保存前预检 · 保存 Draft（复用 `StrategyService.save`） |
| **权限** | 只读 / 物化 / 预检 = `publicProcedure`；`saveDraft` = `adminProcedure`（与 `strategy.save` 同口径） |
| **唯一权威复用** | `exitPolicyExperiments#STOP_POLICY_EXPERIMENTS`（EXIT_POLICY 基座）· `recipeRegistry#projectStrategyRecipe`（RECIPE 投影**唯一实现**）· `stateFactorRegistry#RUNNER_STATE_DEFINITIONS` · `strategySchema`（校验）· `lifecycle/types`（八态） |
| **不变量** | I-5 StrategyVersion 不可变（`saveDraft` 不覆盖既有版本）· I-6 Strategy Core 唯一权威（零新引擎）· **DB 变更 = 0** |
| **consumer** | `client/src/pages/StrategyDetail.tsx`（新建/编辑工作台）· `client/src/components/strategy/PresetEditor.tsx` · `tests/server/research/strategyAuthoring/equivalence3570001.test.ts`（验收） |
| **状态** | **IMPLEMENTED**（`check` 0 错；`strategyAuthoring` 66/66；3570001 等价 diff `equal:true`） |

---

## C-99 SCOPE-002 S7 增量：按策略版本坐标读回留档（通用评估 / 模拟盘端点）

| 项 | 内容 |
|---|---|
| **契约** | `researchRun.getStrategyVersionEvaluation` · `researchRun.getStrategyVersionPaperTrading` |
| **定义位置** | `server/researchRunRouter.ts`；选择逻辑在 `server/closedLoopBacktestRun/strategyVersionArtifacts.ts`（纯选择器 + 只读加载） |
| **共享 schema** | `strategyVersionCoordinatesInputSchema`（`{ strategyId, strategyVersion }`） |
| **语义** | 按 `(strategyId, strategyVersion)` **原样直读** `closed_loop_backtest_run.resultJson` 的扩展载荷：评估取 `result.evaluationDetail`（并补读同 `experimentId` 的对照组作 baseline）；模拟盘取 `result.paperTradingState` / `paperTradingForwardState`。查不到 ⇒ `null`（**不伪造**） |
| **收敛** | 原专项端点 `getFinalEvaluation` / `getPaperTrading3570001` **变成薄封装**（固定 3570001 坐标），返回形状逐字段不变 ⇒ 专项页无需改动 |
| **读取路径** | 新增 `listClosedLoopBacktestRunRawResults({ strategyId?, strategyVersion?, experimentId?, runIdPrefix?, limit? })`（**不经旧 reconcile**，与 `getClosedLoopBacktestRunRawResult` 同一纪律） |
| **consumer** | `client/src/components/strategy/StrategyVersionArtifactsTabs.tsx`（策略详情「最终评估 / 模拟盘」Tab —— 2026-10-07 起是**唯一**留档展示入口，见下行） |
| **DB 变更** | **0 表 / 0 列 / 0 migration** |
| **状态** | **IMPLEMENTED**（`check` 0 错；通用端点 vs 专项端点真实库比对一致；浏览器 Tab 实测通过） |
| **2026-10-07 更新（单策略专项页收敛）** | 侧栏删除「最终评估 3570001（专项）」「模拟盘 3570001（专项）」两项；旧路径 `/strategy-final-evaluation` · `/paper-trading-3570001` 改为 `<Redirect>` 到 `/strategies/<坐标>?version=…&tab=evaluation\|paper`；两个专项页文件删除；策略详情新增 `?tab=` 深链（白名单 + 切换 `replace` 写回 URL）。**端点契约零变化**：`getStrategyVersionEvaluation` / `getStrategyVersionPaperTrading` 不被改动，`getFinalEvaluation` / `getPaperTrading3570001` 仍保留为薄封装（现无前端消费者） |

---

### C-102 RECOVERY-LIGHT-ST-007 增量：**可选 UNKNOWN 处理声明** `SimulationConfig.executionEligibilityUnknownPolicy`（2026-10-11 · `9c5b` 之后）

| 项 | 内容 |
|---|---|
| **定义位置** | `server/research/simulator/types.ts`（`EXECUTION_ELIGIBILITY_UNKNOWN_POLICIES` / `ExecutionEligibilityUnknownPolicy` / `DEFAULT_EXECUTION_ELIGIBILITY_UNKNOWN_POLICY` / `executionEligibilityStatusAllowed`）；字段挂在既有 `SimulationConfig` 上 |
| **契约形状** | `readonly executionEligibilityUnknownPolicy?: "REJECT" \| "ALLOW_WHEN_DECISION_ALLOWS" \| null`；**缺省 = `REJECT`**（失败关闭） |
| **producer（注入方）** | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts#run`（**仅**轻量政策组 `stPolicy=known-st-only` 时写入 `ALLOW_WHEN_DECISION_ALLOWS`；严格缺省**不写该键**） |
| **consumer** | `server/research/simulator/engine.ts#runTradeSimulation`（due-order 循环放行判据 + 收尾硬断言）、`server/research/simulator/validate.ts`（配置形状 + 记录校验） |
| **放行语义** | `allowed === true` **且** `status === "NORMAL"` ⇒ 放行；`status === "UNKNOWN"` **仅当显式声明** `ALLOW_WHEN_DECISION_ALLOWS` 时放行；`status === "ST"` **永远拒绝**（即使 `allowed = true`）；其它取值一律拒绝 |
| **审计（真实状态）** | `TradeSimulationRun.executionEligibilityAudit[].status` **保留** `UNKNOWN`（**禁止**改写为 `NORMAL`）；收尾断言 `FILLED ⇒ statusAllowed(status, policy)`，违反抛 `EXECUTION_ELIGIBILITY_VIOLATION` |
| **快照** | `SimulationConfigSnapshot.executionEligibility.unknownPolicy?` —— **只在显式声明时出现** ⇒ 未声明的既有快照与冻结指纹**逐字节不变** |
| **兼容性规则** | ① 缺省 / `null` ⇒ 既有执行路径与记录指纹**逐字节不变**；② 取值非法 ⇒ `SIM_CONFIG_EXECUTION_ELIGIBILITY_UNKNOWN_POLICY_INVALID`（引擎抛 `..._UNKNOWN_POLICY_INVALID`）；③ 声明了政策却没有闸门 ⇒ `SIM_CONFIG_EXECUTION_ELIGIBILITY_UNKNOWN_POLICY_WITHOUT_GATE`（引擎抛 `..._WITHOUT_GATE`）—— 不静默忽略；④ **禁止**：把 `UNKNOWN` 改写为 `NORMAL`、移除整个执行闸门、另开第二条模拟器路径 |
| **DB 变更** | **0 表 / 0 列 / 0 migration** |
| **状态** | READY（FACT，additive minor；基线 `v2.8.0`） |

### C-103 RECOVERY-LIGHT-ST-007 增量：**探索性轻量 ST 资格政策** `KNOWN_ST_ONLY_EXPLORATORY`（2026-10-11 · `9c5b` 之后）

| 项 | 内容 |
|---|---|
| **定义位置** | `research-experiments/shared/rollingPoolRecovery/knownStPolicy.ts`（政策 id 闭集 `ST_ELIGIBILITY_POLICY_IDS` / `resolveStEligibilityPolicy` / `decideKnownStOnlyEligibility` / `decideStrictEligibility` / `KnownStLabelIndexPort`）；经 `research-experiments/shared/rollingPoolRecovery/index.ts` 零逻辑导出 |
| **政策版本** | 严格（缺省）= `recovery-st-execution-eligibility/1.0.0`（**未改**）；本轮探索性 = **`recovery-known-st-only/1.0.0`**（id `KNOWN_ST_ONLY_EXPLORATORY`） |
| **producer（来源）** | `server/researchExperiments/knownStLabelIndex.ts#loadKnownStLabelIndex`（**只读** `SELECT` `research_security_status_history`（`statusType='ST'`）+ `research_security_identifier_history`（primary），建 `(symbol, 日期)` 索引 + 来源指纹 + availability/confidence 分布）；经 `research-experiments/compositeRunnerBridge.ts` **零实现 re-export** 注入研究层 |
| **consumer** | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts`（确认日收盘候选资格 + `createKnownStOnlyEligibilityGate` 成交前复查）；`result.ts`（payload schema / 表 / 统计）；`tests/tools/rollingPoolRecoveryStRun.mts`（`--st-policy`） |
| **行为表（逐字）** | 已有记录明确 ST/\*ST ⇒ **不进入排序候选 + 成交前拒单**（审计 `ST` + 来源 / 生效区间 / 证据指纹）；明确正常记录 ⇒ 参与 + 可执行（`NORMAL`）；无记录 / 身份无法解析 / 证据不能判断 ⇒ **`UNKNOWN`，注明"本轮允许"**（参与 + 可执行） |
| **实验参数** | `descriptor.parameters` 新增 `stPolicy`（`kind: "ENUM"`，`required: false`，`defaultValue: "strict"`，`allowedValues: ["strict","known-st-only"]`）；CLI `tests/tools/rollingPoolRecoveryStRun.mts --st-policy <strict\|known-st-only>`，非法值 exit 2 |
| **PIT 边界（不伪造）** | 来源**没有** `availableAsOf` 列 ⇒ 索引**不构造**可获知时间；`availability` / `confidence` **原样保留**；**不把缺席派生成 `NORMAL`**；边界 / 重叠 / 非法时间 / 不可识别取值 ⇒ `UNKNOWN`；身份解析用**该日期对应**的证券身份（`resolveSecurityIdByEngineKey`），**不用今天的名称**、**不用行情涨跌停字段**、**不凭空生成 `securityId`** |
| **与严格契约的关系** | `stGate.ts` / `ST_GATE_CONTRACT_VERSION = "1.1.0"` / `evaluateStGate` **零改动**；轻量政策是**另一个有版本的资格决策**，两者并存且**缺省为严格** |
| **轻量模式不继承的前置** | 不用 `stSummary.blocked` / `providerVerifiable`；不伪造 `verifiable=true`；null-provider 早诊断只属严格模式；`ST_COVERAGE_BLOCKED` **不是**轻量模式的必然终点（终态见 §8 四选一） |
| **快照 / 身份** | `frozenConfig` 增 `stEligibilityPolicyId/Version/Parameter/Exploratory/StrictDefault` ⇒ 两种政策**不可能**共用同一份冻结配置；`customPayload.status` 新增 `EXPLORATORY_KNOWN_ST_ONLY`、新增 `terminalState` 与 `stEligibilityPolicy`（来源覆盖与政策描述） |
| **兼容性规则** | ① 缺省严格 ⇒ 004 行为、产物集与断言**不变**；② 轻量模式**新增**两份产物（`st-light-eligibility-decisions.csv` / `st-light-policy-summary.json`），严格模式**不产出**；③ 新字段在 zod schema 中为 `optional`（旧载荷仍可校验）；④ 结论只能是**探索性**：UNKNOWN 被接受 + 历史（非 PIT）标签 + 旧 Dataset 局限 |
| **DB 变更** | **0 表 / 0 列 / 0 migration / 0 写入**（标签索引为只读 `SELECT`） |
| **状态** | READY（FACT，additive minor；基线 `v2.8.0`；验收见 `tests/server/researchExperiments/rollingPoolRecoveryStLightPolicy.test.ts`） |
