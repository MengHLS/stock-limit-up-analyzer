# STRATEGY-ARCH-001-IMPLEMENTATION-MAP（Phase A 过程记录）

> 性质：**Phase A 临时工作记录**（实施过程用）。最终交付 = `STRATEGY-ARCH-001-IMPLEMENTATION-REPORT.md`（本文件为其第 2 节的完整底稿）。
> 全部结论来自**实读代码**（`server/**` / `drizzle/schema.ts` / `client/src/**` / `tests/**`），不采信任何报告转述。
> 基线事实：`tsc` / `vitest` 基线 = **8 失败文件 / 17 失败用例 / 4304 用例**（2026-09-19 实跑）。

---

## 0. 规格文档可得性（先声明）

规格 §0 引用了 `STRATEGY-ARCH-001 — Strategy Core Architecture Design` 设计方案。**实查仓内不存在该文件**
（`find . -maxdepth 3 -iname "*STRATEGY-ARCH*"` 仅命中本文件与 `STRATEGY-AUDIT-001.md`）。
⇒ 实施以**规格正文 §3–§17 给的目标架构**为准；`docs/research/STRATEGY-AUDIT-001.md`（上一轮审计）作为现状底稿。

---

## 1. 当前 Strategy 架构图（实读）

```
client/src/pages
  ├── StrategyList.tsx:41        → research.strategy.list
  └── StrategyDetail.tsx:524     → validate/save/createVersion/load/loadVersion/listVersions
                                   + researchRun.readiness/listBacktests/getBacktest/loopRun
        ▲
server/router
  ├── research.strategy.*        server/researchRouter.ts:105-233      （16 端点）
  ├── research.strategyCandidate.* server/research/strategyCandidate/router.ts:245-342
  └── researchRun.*              server/researchRunRouter.ts:274-651
        ▲
domain（4 套并存，互不引用）
 ① 治理型  server/research/strategySchema/{types,definition,definitionValidation,validate,map,projection,legacyViews,serialize,compare,version,goldenSample}.ts
 ② 执行型  server/strategy/{contract,adapter,registry,strategies/leaderCandidateBaseline}.ts
 ③ 研究型  server/research/framework/{contract,leakage,gatedSignal,validation,featureProvider,pipeline}.ts
 ④ 声明型  server/research/patternLibrary/**（8 个 pattern 声明 + project.ts / projectRecipe.ts）
        ▲
执行链（**三条并存**）
 A. 闭环：assembleRunWorkbenchInputs → recipeRegistry.resolveParameters → signalBuilder → runTradeSimulation(closedLoopWiring/executors.ts)
 B. 评估端口：strategyEvaluation/{evaluate,evaluator,backtestBridge}.ts →（复用 A 的装配）
 C. legacy：realisticBacktest.simulateRealisticTPlus1ToTPlus2 ← legacyTransactionSimulator.ts
        ▲
repository
  strategies / strategy_versions / 5 投影表（strategyPersistence/db.ts）
  strategy_research_provenance（strategyCandidate/provenance.ts）
  closed_loop_backtest_run（closedLoopBacktestRun/repository.ts）
```

---

## 2. Strategy 数据模型映射

| 规格要求的名字 | 现实中是否存在 | 当前类/类型 | 所在文件 | 职责 | 实际调用方 | 输入 → 输出 | 与其他模型关系 | 语义重复 |
|---|---|---|---|---|---|---|---|---|
| `Strategy` | ✅（两处，不同义） | ①`strategies` 行（实体） ②`interface Strategy` | ①`drizzle/schema.ts:485-511` ②`server/strategy/contract.ts:112-119` | ①身份+元数据 ②纯函数策略 | ①`strategyPersistence/db.ts` ②`leaderCandidateBaseline` | ②`StrategyContext` → `StrategyDecision` | 二者**无引用关系** | ⚠️ 同名不同义 |
| `StrategyVersion` | ✅ | `strategy_versions` 行 + `StrategyVersionRecord` | `drizzle/schema.ts:528-575` / `strategySchema/types.ts:331-361` | 不可变版本 + §17 九项追溯 | `strategyPersistence/db.ts:223-311` | 文档 → 行 | 1 Strategy : N Version | 无 |
| `StrategyDefinition` | ✅ | `interface StrategyDefinition` | `strategySchema/definition.ts:618-627` | Version 的完整富定义（canonical） | `map.ts` / `validate.ts` / `projection.ts` / `definitionBuild.ts` | 无参（类型） | 嵌入 `StrategyDocument.definition` | 无 |
| `StrategyDocument` | ✅ | `interface StrategyDocument` | `strategySchema/types.ts:231-298` | v1 本体 + 可选 `definition` + 顶层 `recipe` | 持久化 / 前端 / 装配 | — | 外层容器 | ⚠️ 与 definition 有**有损单向派生** |
| `StrategyContract` | ✅ | `interface StrategyContract` | `research/framework/contract.ts:38-51` | 研究层策略身份 + `requiredData` | `signalEngine` | — | **与 ①②④ 都无引用** | ⚠️ 第 3 套契约 |
| `StrategyRule` | ❌ **不存在该表/类型名** | 实际是 `DeclaredRule`(v1) / `ConditionDefinition`(富) / `FeatureGate`(执行) | `types.ts:91-104` / `definition.ts:461-472` / `framework/gatedSignal.ts:28-33` | 三层不同表达力 | 见 §4 | — | 无统一抽象 | ⚠️ **三层语义不同构** |
| `StrategyParameter` | ✅ | `ParameterDefinition`(富) / `ResearchParameterDefinition`(v1) / `SweepNumberParameter`(搜索) | `definition.ts:566-586` / `research/types.ts:25-46` / `research/parameterSpace.ts:23-60` | 参数元数据 | `definitionBuild.ts:479-599` / `parameterSpaceFromDocument.ts:54` | — | ①→② **有损派生**；②→③ 派生 | ⚠️ **三处表示** |
| `Feature` | ✅（两套） | `FeatureProvider` | `framework/contract.ts:85`+`featureProvider.ts` / 实现散在 `recipeFeatures/pullbackFeatures.ts`、`features/basic.ts` | 特征计算 | `signalEngine` / `conditionSignal/compile.ts` | `FeatureComputeInput` → `number\|null` | 注册在 `recipeRegistryAtoms.ts` | ⚠️ 无统一 Registry（**硬编码 id 列表**） |
| `FeatureGate` | ✅ | `interface FeatureGate` | `framework/gatedSignal.ts:28-33` | 执行侧门槛（AND 语义） | `signalEngine` / `conditionSignal/compile.ts:76-82` | — | 由 `ConditionDefinition` 编译而来 | 无 |
| `SignalEngine` | ✅ | `runCandidateEngine` | `research/signalEngine/engine.ts:124` | 逐决策日产出候选 | 闭环 `executors.ts:406` | `CandidateEngineInput` → `CandidateEvaluationRun` | 消费 `Strategy13` 配方 | 与 ② 的 `Strategy.evaluate` 并行 |
| `Simulator` | ✅（三套） | `runTradeSimulation` / `simulateRealisticTPlus1ToTPlus2` / `runBacktestWithRisk` | `research/simulator/engine.ts:248` / `realisticBacktest.ts:246` / `engine/engine.ts:221` | 撮合 | 见审计 §9.1 | — | 三套互不通用 | ⚠️ 重复 |
| `StrategyRuntime` | ❌ **不存在** | 最接近 = `signalEngine` + `recipeRegistry.resolveParameters` + `assemble` 的组合 | — | — | — | — | — | — |
| `StrategyDecision` | ⚠️ 仅执行型有 | `StrategyDecision`(②) / `CandidateEvaluationRun`(③) | `server/strategy/contract.ts:60-67` | 决策产出 | ② 的 evaluate | — | 与 ③ 不同构 | ⚠️ 两套输出模型 |

---

## 3. StrategyVersion 映射

| 项 | 现状 | 证据 |
|---|---|---|
| 结构版本 | `STRATEGY_DEFINITION_SCHEMA_VERSION = "1.0"`（白名单仅 `"1.0"`） | `definition.ts:55-60` |
| 策略版本号 | `StrategyDocument.version` 严格 semver | `types.ts:237` + `version.ts` |
| §17 九项追溯 | 全部落在 `versionRecordJson` | `types.ts:331-361` / `schema.ts:537` |
| 不可变 | ✅ 强证据（契约 + conflict 闸门 + 无 update 端点） | `strategyPersistence/contract.ts:5-21` / `db.ts:237-240,293-296` |
| Fingerprint | ✅ sha256，覆盖除自身外全字段 | `types.ts:297` / `serialize.ts` |
| 缺失 | `engineVersion`（0 命中）；`codeVersion` 实测 11/11 为 `1.0.0+gunknown` | 探针 `_probe_strategy_audit_state.out.json` |

---

## 4. Rule 映射（三层，表达力逐层收窄）

| 层 | 载体 | 逻辑能力 | 位置 |
|---|---|---|---|
| L1 研究侧 | `ResearchConditionSet{groups,logicalOperator,groupLogicalOperator}` | 组内 `AND/OR/NOT` + 组间 `AND/OR`（左结合） | `researchCore/types.ts:232-263,323-344`；求值 `conditionEvaluator.ts:98-133` |
| L2 声明侧 | `ConditionDefinition{id?,field,operator,value,valueType,enabled}` | **单谓词**，无逻辑位；`entry.conditions[]` 数组内即全 AND | `definition.ts:461-472` |
| L3 执行侧 | `FeatureGate{kind,featureId,bound,label}`，kind 仅 5 种 | 全 AND | `gatedSignal.ts:28-33`；映射 `compile.ts:76-82` |

- 运算符闭集：`STRATEGY_CONDITION_OPERATORS` 8 个（`definition.ts:90-100`）→ 可执行映射仅 5 条（`compile.ts:76-82`）⇒ `NOT_EQUAL/IN/NOT_IN` 编译期拒绝。
- 右值类型闭集：`CONSTANT | FIELD_REFERENCE | PARAMETER_REFERENCE`（`definition.ts:103-108`）⇒ **无算术形态**（这直接导致 `volume > MA5*2` 写不下）。
- 字段引用：`parseStrategyFieldReference`（`definition.ts:314-340`），5 种形态 + `unknown` 默认拒绝。
- **无** `ALL/ANY/NOT/SEQUENCE/TRIGGER` 节点 ⇒ 无 `A AND (B OR C)`、无路径、无多阶段。

---

## 5. Parameter 映射

| 项 | 现状 | 证据 |
|---|---|---|
| 定义（富） | `ParameterDefinition{code,name,dataType,parameterRole,defaultValue?,nullable?,min?,max?,step?,allowedValues?,unit?,required,derivedFrom?}` | `definition.ts:566-586` |
| 定义（v1） | `ResearchParameterDefinition{name,type,required,defaultValue?,...}`，**无 role/code/unit/derivedFrom** | `research/types.ts:25-46` |
| 解析器 | `recipeRegistry.resolveParameters(schema, overrides)`，override → defaultValue，缺则抛 `RECIPE_PARAMETER_NO_DEFAULT`，未知键抛 `RECIPE_PARAMETER_UNKNOWN` | `recipeRegistry.ts:246-274` |
| DERIVED | ❌ **仅声明 + 校验，无求值器**（`derivedFrom` 是自由文本） | `definitionValidation.ts:369-377`；grep 无读取方 |
| role 消费 | 校验器 / 转正构建 / 声明投影 / 投影落库 / v1 兼容视图（有损丢弃）；**运行期派生器不读** | `parameterSpaceFromDocument.ts:54-101` |
| 搜索空间 | `SweepNumberParameter`，仅 number + min/max/step | `research/parameterSpace.ts:23-60` |

---

## 6. Feature 映射（当前 = 闭集）

| 特征 id | 版本 | lookback 需求 | availability | compute | 被策略侧消费 |
|---|---|---|---|---|---|
| `haircutFromEventLow` | 1.0.0 | 需 `bars[0]`=事件日 | `samePointAvailability`（恒 `1990-01-01`） | `recipeFeatures/pullbackFeatures.ts:81` | ✅ |
| `volumeRatio` | 1.0.0 | 同上 | 同上 | `:92` | ✅ |
| `isBullish` | 1.0.0 | 仅当根 bar | 同上 | `:107` | ✅ |
| `momentumFromEventClose` | 1.0.0 | 需 `bars[0]` | 同上 | `:119` | ✅ |
| `pctChange` | 1.0.0 | 仅当根 bar | 同上 | `recipeRegistryAtoms.ts:76` | ✅（排序） |
| `sma/return/avgAmount/avgVolume/volatility/amplitude/limitUpHit` | — | — | — | `features/basic.ts:113-222` | ❌ 无策略侧消费 |

- **无统一 Registry**：特征 id 是散落的常量对象（`PULLBACK_FEATURE_IDS`、`PCT_CHANGE_FEATURE_ID`）。
- **无 `lookback` 声明**（规格 §8 要求）。
- **availability 恒为常量** ⇒ `LeakageGuard` 恒通过（见审计 §11.2）。

---

## 7. Runtime 映射（当前无「StrategyRuntime」这一层）

实际运行 = **三段拼接**，不是一个 Runtime：

```
① 参数解析   recipeRegistry.resolveParameters(document.parameters, overrides)      → parameterSet
② 装配       assembleRunWorkbenchInputs → recipeRuntime.buildSignalBuilder(ps)     → signalBuilder
③ 执行       runCandidateEngine(逐决策日) → PositionIntent[] → runTradeSimulation  → 成交
```
证据：`assemble.ts:556,572,584` / `signalEngine/engine.ts:124-218` / `closedLoopWiring/executors.ts:406-512`。
⇒ **无 `RuntimeContext` / 无统一 `evaluate(context)`**；参数解析在装配层、规则判定在 signalEngine、特征在 pipeline。

---

## 8. Strategy Run 映射

| 表 | 承担什么 | 证据 |
|---|---|---|
| `strategy_versions.strategyDocumentJson` | **Definition**（canonical 文档） | `schema.ts:535` |
| `strategy_versions.versionRecordJson` | **Run 级追溯快照**（§17 九项，含 `parameterSet`） | `schema.ts:537` |
| `closed_loop_backtest_run.resultJson` | **Runtime 轨迹**（stages / assembly / simulation） | `schema.ts:2069` |
| `closed_loop_backtest_run` 摘要列 | 列表展示 | `schema.ts:2052-2065` |

🔴 **Run Snapshot 缺失项**（实测 6/6 行 `resultJson` 零命中）：`parameterSet` · `codeVersion` · `engineVersion` · `seed` · `universe` · `startedAt` · `completedAt`。

---

## 9. API 映射

见 `docs/research/STRATEGY-AUDIT-001.md` §12。要点：
- 策略本体 16 端点（读 7 / 写 6 admin / 纯函数 3），无独立顶层 router（全在 `research.*`）。
- **缺** Publish / Archive / Update Draft；`loadBundle` 与 `getVersionBundle` **同实现别名**。
- 3 套 `listRuns/getRun`（`researchEngine` / `researchRun` / `sentiment`）。
- 版本内容不可改（conflict 闸门）；**状态可无门槛改**（`service.ts:361-369` 不吃 §23 迁移表）。

---

## 10. Frontend 映射

| 页面 | 依赖的 Contract | 改造后是否受影响 |
|---|---|---|
| `/strategies` `StrategyList.tsx:41` | `research.strategy.list` → `StrategySummary` | ❌ 不受影响（本任务不改该端点） |
| `/strategies/:id` `StrategyDetail.tsx:524` | `load/loadVersion/listVersions/validate/save/createVersion` + `researchRun.*` | ❌ 不受影响（无端点签名变更） |
| `components/strategy/DefinitionFields.tsx` | 结构驱动，读 `document.definition` | ❌ 不受影响（不改 legacy 定义 schema） |
| `components/strategy/RunConfigPanel.tsx` | `researchRun.loopRun` 入参 | ❌ 不受影响 |
| `/research/candidates/:id` | 候选 DTO | ❌ 不受影响 |

⇒ **本任务不改任何 tRPC 契约、不改任何前端文件**（§2.4「不要求重新设计 UI，但必须保证 Core 改造后不留下明显失效接口」在本方案下自动满足）。

---

## 11. Backtest 依赖映射

| 消费者 | 依赖 Strategy 的什么 | 接入方式 | 是否有根本冲突 |
|---|---|---|---|
| Event Study（`analyses/eventStudy.ts:65`） | 无直接依赖（纯分析类型） | — | ❌ |
| Signal Backtest（`closedLoopWiring/executors.ts:406-512`） | `strategy13` 配方（`features` + `signalBuilder` + 排序/选择） | 由 `assemble` 装配 | ⚠️ 只认 `FeatureGate[]` |
| Portfolio Backtest（`simulator/engine.ts:248`） | `PositionIntent[]` | 上游给 | ❌ |
| 生产 Engine（`engine/engine.ts:221`） | `Strategy`（执行型契约）+ 特征快照 | `strategyBacktest.ts` 桥 | ⚠️ 只认 `FeatureSnapshot` |
| Evaluation 端口 | 策略文档 + `parameterOverrides` | `assemble` | ❌ |
| Param Search / WFO | 同上（并回落 legacy） | 同上 | ❌ |

⇒ **核心冲突点只有 1 个**：执行侧只能吃 `FeatureGate[]` + `FeatureProvider`（闭集）。这正是本次要解决的。

---

## 12. Legacy / Duplicate 映射

| 项 | 归属判定 | 本轮处置 |
|---|---|---|
| `legacyTransactionSimulator.ts` 出口 | 正在使用（唯一合法 legacy 出口） | **保留不动** |
| `server/backtest/engine.ts#runBacktestEngine2` | 生产不可达（仅 3 测试引用） | **保留不动**（§20 不做重写） |
| `paperTrading.ts:723-734` 内联分仓 | 确定重复（第二份 `allocatePlannedBudgets`） | **不动**（改分仓会重算历史数值 ⇒ 需用户授权） |
| `research/persistence/db.ts` 复数 3 表 Repository | 有类无实例（表 0 行） | **不动**（仅登记） |
| `research/strategySchema/goldenSample.ts` | 测试 fixture（不入 index.ts） | **不动** |
| 4 套策略模型（治理/执行/研究/声明） | 都在用，职责不同 | **新增 Core + Adapter 收敛**，不删旧 |

---

## 13. Target Architecture → Current Code 对照表

| Target（规格 §3） | Current | 本方案落点 | 类型 |
|---|---|---|---|
| `Strategy`（身份） | `strategies` 行 | **复用** | 无改动 |
| `StrategyVersion`（不可变） | `strategy_versions` 行 | **复用** | 无改动 |
| `Definition`（canonical） | `StrategyDocument.definition`（持久化编码） | **新增 Core `StrategyCoreDefinition` 为语义权威；legacy 定义为编码/兼容面** | 新增 + Adapter |
| `RuleGraph` | ❌（扁平 conditions） | **新增** | 新增 |
| `FeatureRequirements` | ❌（硬编码 id） | **新增** | 新增 |
| `ParameterSchema` + Resolver（含 DERIVED） | 部分（无求值器） | **新增**（canonical）+ Resolver | 新增 |
| `DataRequirements` | ❌ | **新增** | 新增 |
| `ExecutionSemantics` | `ExecutionDefinition`（部分） | **新增**（统一 signal/confirmation/execution timing） | 新增 + Adapter |
| `Capabilities` | ❌（隐含在 backtestType/pipeline） | **新增** | 新增 |
| `Fingerprint` | ✅ `StrategyDocument.fingerprint` | **新增 Core fingerprint（覆盖新面）** | 新增 |
| `Metadata` | `document.metadata` | 复用 | 无改动 |
| `StrategyRuntime.evaluate(context)` | ❌（三段拼接） | **新增** | 新增 |
| `StrategyDecision` | ⚠️ 两套 | **新增统一模型** | 新增 |
| `LeakageGuard` | ✅ 但恒通过 | **新增统一信息可用性守卫（含字段引用 + 特征 + 派生表达式）** | 新增 |
| `StrategyRunSnapshot` | ❌ | **新增（域对象 + 构建/校验/重建）** | 新增 |

---

## 14. 实际改造范围（本轮要改的）

**新增（全部纯模块，零 DB / 零 IO）** —— 新顶层目录 `server/strategyCore/`：

```
server/strategyCore/
├── types.ts                 规格 §3/§13/§14 的 canonical 类型与常量
├── temporal.ts              §6 时间语义（T/T-1/T+1/T+N/WINDOW/SEQUENCE + evaluation-time）
├── expression.ts            §9 Derived expression 求值器（常量/字段/参数/算术/引用）
├── ruleGraph.ts             §5 RuleGraph 节点 + 求值 + 校验（ALL/ANY/NOT/CONDITION/EVENT/WINDOW/SEQUENCE/TRIGGER）
├── featureRegistry.ts       §8 Feature Registry（name/version/inputs/lookback/availability/leakage/compute）
├── features/builtins.ts     §8 内置特征（OHLCV + MA/EMA/RSI/ATR + 回踩四件 + pctChange）
├── parameterResolver.ts     §9 ParameterSchema/Set/ResolvedParameterSet/Resolver（FIXED/TUNABLE/DERIVED + 循环依赖）
├── dataRequirements.ts      §10 DataRequirements（frequency/requiredFields/lookback/forwardHorizon/requiredFeatures/eventRequirements）
├── executionSemantics.ts    §11 signal/confirmation/execution timing + price reference + state transition
├── capabilities.ts          §14 Capabilities（eventObservation/signalGeneration/entryIntent/exitIntent/positionIntent）
├── leakageGuard.ts          §15 统一信息可用性校验
├── decision.ts              §13 StrategyDecision
├── runtime.ts               §12 StrategyRuntime.evaluate
├── fingerprint.ts           §17 行为级 fingerprint
├── runSnapshot.ts           §16 StrategyRunSnapshot（build / verify / rebuildRuntimeConfig）
├── version.ts               §4 StrategyVersion 不可变语义（create / publish / 改内容 ⇒ 新版本）
├── adapters/legacyDefinition.ts  §4/§19 双向适配（legacy StrategyDefinition ⇄ Core）
└── index.ts                 唯一出口
```

**新增测试**：`tests/server/strategyCore/*.test.ts`（覆盖规格 §23.1–§23.9 九组）。

## 15. 明确不改范围（本轮禁止触碰）

| 范围 | 原因 |
|---|---|
| `drizzle/**`（无 migration） | Core 是纯域层；`strategyDocumentJson` 已能承载 legacy 编码，新增表=制造第二套 SoT（§18） |
| `shared/researchContracts.ts` | 不改 tRPC 契约 ⇒ 前端零影响（§2.4） |
| `server/routers.ts` / 任何 router | §20「不做」清单；新增 API 数 = 0（技能纪律：越少越好） |
| `client/**` | §2.4 不要求重做 UI；本方案无契约变更 |
| `server/research/**` 既有 30+ 文件 | §21 不重构 Research；只**新增** Adapter，不改既有实现 |
| `server/backtest/**`、`engine/**`、`realisticBacktest.ts` | §20 不做重写 |
| `parameterSearch` / `walkForward` / `paperTrading` | §20 不做 |
| 分仓口径、`paperTrading.ts` 重复实现 | 改口径会重算历史数值 ⇒ 需用户授权 |
| 既有 11 行 `strategy_versions` 数据 | 不可变纪律 + 禁破坏现有数据（§18） |
