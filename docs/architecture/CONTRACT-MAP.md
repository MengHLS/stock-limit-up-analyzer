# CONTRACT-MAP — 核心契约地图

> Baseline **v1.0.0** · auditedAt **2026-09-19**
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
| **🔴 边界守护** | `tests/server/research/strategyCandidate/importBoundary.test.ts:69-131` 固化「researchCore ↔ strategyPersistence/strategySchema 只允许经桥」 |

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
6. 改 Research 表 ⇒ 必须过 `importBoundary.test.ts`（跨域 import 方向）。
7. 改 Dataset 物理表 ⇒ 必须同步插件声明式 DDL + `apply*` 脚本 + `totalRows` 口径（五表之和）。

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
