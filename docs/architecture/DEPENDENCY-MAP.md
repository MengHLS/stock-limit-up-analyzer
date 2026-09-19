# DEPENDENCY-MAP — 依赖图（Domain → Domain / Module → Module）

> Baseline **v1.0.0** · auditedAt **2026-09-19**
> 判定依据 = 实际 `import` 引用 + grep 引用方；**本任务只登记，不重构**。

---

## 1. Domain → Domain（依赖方向）

```text
                        ┌──────────────────────────────────────┐
                        │  Market Data Foundation (STEP 12 A–H)│
                        │  stock_daily_prices / securities /    │
                        │  status / CA / liquidity / index /    │
                        │  industry                             │
                        └───────────────┬──────────────────────┘
                                        │ 只读
                                        ▼
┌───────────────────────────────────────────────────────────────────┐
│  Dataset（A 体系 datasetRegistry）                                 │
│    ▲ 被依赖：Research / Backtest / 前端                             │
│    └ 依赖：Market Data Foundation（只读）                            │
└───────────────┬───────────────────────────────────────────────────┘
                │ datasetVersionId（软引用，无 FK）
                ▼
        ┌───────────────────────────────────────────┐
        │  Research（researchCore 单数 10 表）       │
        │    └─ researchEngine / researchPlanner     │
        │    └─ strategyCandidate（转正桥）           │
        └───────┬───────────────────────────────────┘
                │ 只经 strategyPromotionPort.ts
                ▼
        ┌───────────────────────────────────────────┐
        │  Strategy                                  │
        │    core(语义) → production(接线)            │
        │    strategySchema(存储编码) → persistence   │
        └───────┬───────────────────────────────────┘
                │ StrategyDocument + datasetVersionId
                ▼
        ┌───────────────────────────────────────────┐
        │  Backtest（backtest/** Core + simulator）   │
        └───────┬───────────────────────────────────┘
                ▼
        ┌───────────────────────────────────────────┐
        │  Evaluation（strategyEvaluation + 三指标域）│
        └───────┬───────────────────────────────────┘
                ├──────────────┬──────────────┬──────────────┐
                ▼              ▼              ▼              ▼
        Robustness        OOS / WFA     Overfitting     Market Regime
        (扰动/随机化)     (隔离/滚动窗)  (PBO/敏感性)    (七维标签)
                └──────────────┴──────┬───────┴──────────────┘
                                      ▼
                              Simulation / Paper
                                      ▼
                     Lifecycle / Candidate / Review / Discipline
                                      ▼
                         Production（PLANNED，无实现）
```

**规则：箭头只允许单向向下。** 反向依赖 = 架构违规。

---

## 2. 禁止依赖 × 现状核对

| # | 禁止项 | 现状 | 判定 | 证据 |
|---|---|---|---|---|
| 1 | Dataset → Strategy | 不存在 | ✅ 合规 | `server/datasetRegistry/**` 零 import strategy |
| 2 | Research → Parameter Search | 不存在（researchCore 只到 candidate） | ✅ 合规 | grep |
| 3 | Backtest → 反向修改 Strategy Definition | 不存在 | ✅ 合规 | 唯一允许 UPDATE 的列 = `status`（`strategyPersistence/contract.ts:6-7`） |
| 4 | researchCore → strategyPersistence / strategySchema | **只允许经桥** | ✅ 合规（**有测试固化**） | `tests/server/research/strategyCandidate/importBoundary.test.ts:69-131` |
| 5 | 反向：strategyPersistence / strategySchema → researchCore | 同上禁止 | ✅ 合规 | 同上 |
| 6 | 桥不得 import `server/research` 主 barrel（因它是 legacy） | 已固化 | ✅ 合规 | `importBoundary.test.ts:127-131` |
| 7 | `client/**` → `server/**` **运行时值** | 不存在（全部 `import type`，编译期擦除） | ✅ 合规 | grep 全仓；`client/src/lib/trpc.ts:2` 等 |
| 8 | Strategy Definition → Dataset / 引擎坐标 | 由机器拒绝 | ✅ 合规 | `DATASET_BINDING_IN_DEFINITION_FORBIDDEN`（`dataRequirements.ts:350`） |
| 9 | `@shared/*` 被 client 使用 | 允许 | ✅ 合规 | 别名在 `vite.config.ts:14-18` / `tsconfig.json:18-21` / `vitest.config.ts:9-13` |
| 10 | 核心域 → Provider 细节 | Provider 不得污染 Research Engine | ⚠️ 部分：`server/tushare.ts` / `backfill/**` 在边界外，未进研究链 | ✅ 实际合规 |

---

## 3. 循环依赖

| # | 状态 | 说明 |
|---|---|---|
| 1 | ✅ **已消除** | `recipeRegistry → patternLibrary → recipeRegistry` 曾是真循环；现有单向化，原因与处置登记在 `server/research/recipeRegistry.ts:41-48`（原子下移到 `recipeRegistryAtoms.ts`） |
| 2 | ⚠️ **隐性双向** | `server/research/index.ts:1-42` 这一**主 barrel 同时聚合 legacy（STEP 6.x）与新模块** ⇒ 任何 `from "./research"` 的消费方（`researchRouter.ts:46`、`researchRunRouter.ts:32`）都会**加载并求值** legacy 死代码。**不是循环，但是「隐性耦合 + 无效加载」** |
| 3 | ✅ 无其他环 | 全仓 import 扫描未发现其余强连通 |

---

## 4. Module → Module 关键边（只列对架构重要的）

### 4.1 Dataset

| from | to | 性质 |
|---|---|---|
| `datasetRegistry/router.ts` | `registry.ts` / `runner.ts` / `query.ts` / `plugins.ts` / `physicalTables.ts` | 同域编排 |
| `runWorkbenchAssembly/datasetFromRegistry.ts` | `datasetRegistry/query.ts`（`DbDatasetDataReader`） | **A → 研究链的唯一读桥** |
| `datasetRegistry/**` | `server/data/boardRules.ts`（`exchangeLimitUpPrice`） | 涨停判定唯一口径 |
| `datasetRegistry/**` | `server/db.ts`（`getDb`） | DB 连接 |
| `server/research/simulator/engine.ts` | `server/researchDataset/**` | ⚠️ B 体系（legacy）仍在被 simulator 引用 |

### 4.2 Research

| from | to | 性质 |
|---|---|---|
| `researchEngine/**` | `researchCore/**`（repository 契约） | 领域层 → 持久化契约 |
| `researchEngine/datasetReader.ts` | `datasetRegistry/query.ts` | 数据集读取（强制 `datasetVersionId` 下推） |
| `strategyCandidate/strategyPromotionPort.ts` | `strategyPersistence/**` + `strategySchema/**` | 🔴 **唯一合法跨域边** |
| `strategyCandidate/{service,router,definitionBuild,provenanceContract}.ts` + `patternLibrary/types.ts` | `researchCore/**` | 桥的合法上游 |
| `server/research/index.ts` | legacy `experiment*.ts` / `run*.ts` / `sweep*.ts` / `persistence/**` | ⚠️ 隐性死代码加载 |

### 4.3 Strategy

| from | to | 性质 |
|---|---|---|
| `strategyCore/runtime.ts` | `strategyCore/**`（纯域内） | 无外部依赖（**结构性保证**） |
| `strategyCore/production/versionFromDocument.ts` | `strategySchema/**` → `adapters/legacyDefinition.ts` → Core | 落库文档 → Core 版本 |
| `runWorkbenchAssembly/assemble.ts` | `strategyCore/production/**` + `strategyEvaluation/**` + `conditionSignal/**` | 装配中枢 |
| `strategyPersistence/db.ts` | `strategySchema/projection.ts` | 投影派生（同事务） |
| `server/strategy/**`（legacy） | `server/engine/**` + `server/backtest?`（经 `strategyBacktest.ts`） | ⚠️ legacy 引擎层，与 Core **正交**但命名易混 |

### 4.4 Backtest / Evaluation

| from | to | 性质 |
|---|---|---|
| `research/simulator/engine.ts` | `backtest/{cost,marketRules,execution,portfolio,audit,position,types}` | 🔴 **全量复用 = 不另建 Core 的依据** |
| `closedLoopWiring/executors.ts` | `simulator/engine.ts` / `backtest/backtestResult.ts` / `strategyEvaluation/**` / `research/signalEngine/**` / `research/marketRegime/**` | 闭环唯一装配点 |
| `backtest/index.ts` | 13 模块 `export *` + `context` + `backtestResult` 点名导出 | 唯一出口 |
| `research/tradeQualityMetrics/analyze.ts:64` | `backtest/metrics.ts`（`computeMetrics`） | ⚠️ 第二套口径的**唯一在产消费方**（read-only，取 trade 段） |
| `backtest/engine.ts:309` | `backtest/metrics.ts` | ⚠️ 仅 legacy `runBacktestEngine2`（生产不可达） |

### 4.5 基础设施

| from | to | 性质 |
|---|---|---|
| `server/routers.ts` | 12 个 `*Router.ts` + 2 个工厂式 router | 21 个顶层 key |
| `server/_core/index.ts` | `trpc.ts` / `context.ts` / `sdk.ts` + `startPaperTradingScheduler` + marketSync + orphan reclaim | 启动装配 |
| `server/db.ts` | `drizzle/schema.ts` + `mysql2` | 唯一 DB 出口 |
| `shared/*` | 零依赖（被 client + server 双向 import） | 契约层 |

---

## 5. 依赖图上的架构风险

| # | 风险 | 证据 | 等级 | 建议（**本任务不执行**） |
|---|---|---|---|---|
| AR-1 | `server/research/index.ts` barrel 混居 legacy + 新模块 ⇒ 隐性加载死代码 | `index.ts:1-42` | 中 | 拆 barrel / 删 legacy 导出 |
| AR-2 | `simulator/engine.ts` 仍 import B 体系 `researchDataset` | `simulator/engine.ts:43-44` | 中 | 收敛到 A 体系 `datasetAccess` |
| AR-3 | 4 个同名 `adapter.ts`（`engine` / `research` / `strategy` / `data`）语义无关 | 全仓 | 低（认知） | 重命名 |
| AR-4 | `server/strategy/**`（legacy 引擎策略）与 `server/research/strategySchema/**`（版本 SoT）命名撞车 | 全仓 | 低（认知） | 重命名 legacy |
| AR-5 | 三段不可互换执行契约并存（`runBacktestWithRisk` / `runTradeSimulation` / `simulateRealisticTPlus1ToTPlus2`） | 见 `EXECUTION-FLOW.md` §7 E-1 | **高** | 需专门决策 |
| AR-6 | `server/engine/adapter.ts` 为孤儿死代码（零引用） | grep 实证 | 低 | 可删除或注明用途 |
| AR-7 | 遗留复数表与单数表**仅差一个 `s`**（`research_experiments` vs `research_experiment`） | `drizzle/schema.ts:338` / `:1512` | 中 | 清理遗留时**优先重命名遗留表** |
| AR-8 | 策略层无独立未来函数防护（legacy `LeakageGuard` 因 `EPOCH_FLOOR_DATE` 恒通过） | `recipeRegistryAtoms.ts:47-58`；Core 侧守卫**真实生效** | 中 | 把生产执行面切到 Core 守卫（已部分完成） |

---

## 6. 依赖健康度小结

| 维度 | 判定 |
|---|---|
| Domain 方向 | ✅ 全部单向向下，**无反向依赖** |
| 跨域收口 | ✅ 唯一跨域写入口（`strategyPromotionPort`）**有测试固化** |
| 强连通分量 | ✅ 无（唯一历史环已消除） |
| 前后端边界 | ✅ 零运行时值 import（全 `import type`） |
| Definition 纯净性 | ✅ 机器可查（禁 Dataset/引擎坐标） |
| 死代码 | ⚠️ 存在 5 处（`runBacktestEngine2` / `engine/adapter.ts` / 3 个 Db 仓储 / 5 个 STEP 6.x service / `factorAblation`） |
| 命名混淆 | ⚠️ 4 处（`adapter.ts` ×4、`research` 单复数、`strategy` ×2、`select` 类） |
| 隐性加载 | ⚠️ 1 处（主 barrel 混居 legacy） |

---

## D-90 PARAMETER-001 增量：新增依赖边（2026-09-19 · `9bs`）

**新增依赖（全部在 `parameterSearch` 域内或其下游，未触碰基线 §2 的禁止边）**：

| 方向 | 说明 |
|---|---|
| `server/research/parameterSearch/**` → `server/research/strategyEvaluation/{backtestBridge,evaluate}` | 执行链复用评估端口（**运行时值**）；`backtestBridge` → `parameterSearch/types` 为**类型导入**（被擦除）⇒ **无运行时环** |
| `server/paramSearchRouter.ts` → `server/research/parameterSearch/{executor,coordinates,searchRun}` | 7 端点的域层落点 |
| `server/research/parameterSearch/executor.ts` → `drizzle/schema` / `server/db` | 新增三表的读写（**唯一落点** = `persistence.ts`） |
| `client/src/components/parameterSearch/**` → `shared/parameterSearchContracts`（类型） + `@/lib/trpc` | **不 import `server/**` 运行时值**（只经 `ParamSearchRouter` 的**类型**推断） |
| `server/research/searchRobustness/**` → `server/research/parameterSearch/{persistence,searchRun}` | **只读复用**既有读函数与状态机迁移表（唯一权威）⇒ 不新写一套 SQL、不新建第二张迁移表 |
| `server/research/searchRobustness/**` → `server/researchDataset/version#canonicalStringify` / `shared/quant-stats`（mean/median/standardDeviation） / `server/research/experimentValidation` | 复用 canonical 序列化、统计与错误类型的**唯一权威** |
| `server/paramSearchRouter.ts` → `server/research/searchRobustness/{executor,analysis,run,persistence}` | 6 端点的域层落点（**同域扩端点，零新 router**） |
| `client/src/components/robustness/**` → `shared/searchRobustnessContracts`（类型） + `@/lib/trpc` | **不 import `server/**` 运行时值** |
| `server/research/oosValidation/**` → `server/research/parameterSearch/{persistence,executor,searchRun,parameterHash}` | **只读复用**：源 Run / 组合 / 结果读函数、`toResultView`（IS 冻结副本）、状态机迁移表、`computeParameterHash`（**重算复核**）⇒ 不新写一套 SQL、不新建第二张迁移表、不重定义状态机 |
| `server/research/oosValidation/**` → `server/research/strategyEvaluation/backtestBridge#createStrategyBacktestBridge` + `server/research/parameterSearch/searchResult#projectCanonicalMetrics` | 🔴 **必含边**：这两条 import **必须存在** —— 它们是「**真重跑 + 真重算**」的结构证据（与下面 robustness 的黑名单**镜像相反**） |
| `server/research/oosValidation/**` → `server/researchDataset/version#canonicalStringify` + `server/research/experimentValidation#ResearchValidationError` | 复用 canonical 序列化与错误类型的**唯一权威**（不自造错误类、不自造指纹算法） |
| `server/paramSearchRouter.ts` → `server/research/oosValidation/{executor,freeze,window,gate,comparison,run}` | 6 端点的域层落点（**同域扩端点，零新 router**） |
| `client/src/components/oos/**` → `shared/oosValidationContracts`（类型） + `@/lib/trpc` | **不 import `server/**` 运行时值** |
| 🔴 **禁止边（结构性不存在）** | `server/research/searchRobustness/**` **不得** import `backtest` / `strategyEvaluation` / `closedLoop` / `strategyCore` / `runWorkbenchAssembly` / `researchEngine` / `leaderCandidates` —— 这是「**零重跑**」的**结构证据**，由静态守卫测试（import 白名单 + 黑名单）钉死；反之 `robustness/**`（C-18.1）**允许**注入式评估器（那正是两者语义差别的来源） |
| 🔴 **镜像边（两域守卫方向相反，是本仓的一条架构判据）** | `searchRobustness/**` = **黑名单**（必须**够不到**回测 / 评估端口）；`oosValidation/**` = **必含清单**（必须**够得到** `createStrategyBacktestBridge` 与 `projectCanonicalMetrics`）。两侧测试文件亦**镜像**（`robustnessBoundary.test.ts` vs `oosValidationBoundary.test.ts`）⇒ **任何**把实现从一域搬到另一域的动作都会让对侧测试立刻变红 |
| 🔴 **写入面白名单** | `oosValidation/**` 只允许写两张表：`oos_validation_run` / `oos_validation_result`（由 `oosValidationBoundary.test.ts` 以词边界正则扫描钉死，避开 `updateOosValidationRun(` 这类函数名的误判）；对 `parameter_search_*` **只读** |

**未新增（刻意）**：
- ❌ `server/research/**` → `server/strategyCore/**`：**零新增**。搜索域派生需要「谁能被搜索」的判据，
  但为避免给 `server/research/**` 引入跨域生产依赖，改为在投影层实现同一判据并由**测试**断言与
  `strategyCore/parameterResolver.ts#listSearchableParameters` 等价（测试可以跨域，生产代码不跨）。
- ❌ 未新建 `backtestCore/**`、未建第二个 `paramSearch` router、未建第二套 `canonicalMetrics`。
- ❌ **OOS-001 未新建第二套回测**：`oosValidation/**` 全部回测都经由既有
  `strategyEvaluation/backtestBridge`（唯一权威入口）⇒ 「样本外重跑」与「参数搜索内评估」
  跑的是**同一条链**，只是窗口与参数来源不同（这正是「可比」的前提）。
- ❌ **OOS-001 未新建第二套状态机**：`OOS_VALIDATION_RUN_STATUSES = PARAMETER_SEARCH_RUN_STATUSES`
  （**同词表**），迁移表复用既有 `PARAMETER_SEARCH_RUN_TRANSITIONS`。
- ⚠️ **命名不遮蔽**：`oosValidation/**` 的三个导出与本仓既有同名符号**刻意改名**以免 ESM `export *`
  静默遮蔽：`FrozenCandidateSnapshot`（原 `FrozenOosCandidate`，与 `validationSelection.ts` 同名）、
  `oosFingerprintOf`（与 2 处同名）、`oosCalendarDaysBetween`（与 1 处同名）。
  该纪律由 `oosValidationBoundary.test.ts` 的**命名不遮蔽守卫**钉住（比对 `server/**` + `shared/**` 的顶层导出名）。

**`index.ts` barrel 纪律**：`server/research/parameterSearch/index.ts` **刻意不 re-export** `executor.ts` / `persistence.ts` ——
因为执行层运行时 import 的评估端口子图会**回到** `closedLoopWiring/executors`（它又 import 本 barrel）⇒ 会形成运行时循环导入。
消费方一律**按显式路径**引用，与「桥只允许显式引用具体模块」的既有纪律一致。

## D-91 WALK-FORWARD-001 增量：新增依赖边 + 第三方向镜像边（2026-09-19 · `9bw`）

### 新增边

| 边 | 方向 | 说明 |
|---|---|---|
| `paramSearchRouter` → `walkForward/executor` | 组合根 → 域 | 6 端点入口 |
| `paramSearchRouter` **实现** `WalkForwardExecutionHooks` | 组合根 → 域（**注入**） | 用**既有** PS / OOS application service 实现；域层只见接口 |
| `walkForward/windowSchedule` → `walkForwardRun/windows#generateWalkForwardSplits` | 域 → 既有原语 | **复用切窗算法**，不重写 |
| `walkForward/*` → `oosValidation/types` | 域 → 域（**仅常量**） | `OOS_ENGINE_VERSION` / `OOS_METRICS_VERSION`；守卫留**后缀级窄豁免** |
| `client/components/walkForward` → `shared/walkForwardContracts` | 前端 → 契约 | 类型与校验同源 |

### 🔴 禁止边（静态守卫钉住）

- ❌ `walkForward/**` → `backtest/**` / `strategyEvaluation/**` / `closedLoop*` / `strategyCore` / `searchRobustness/**`；
- ❌ `walkForward/**` → `runWorkbenchAssembly` / `researchEngine` / `leaderCandidates`；
- ❌ **域层绕过 `hooks` 自行触达执行面**（「执行只能经由注入钩子」）；
- ❌ `WalkForward → HTTP → OOS API → HTTP → Backtest` 自调用链。

### 第三方向镜像边（本任务最重要的依赖事实）

三条并列执行边的守卫方向**互不相同，不可搬移**：

| 执行边 | 守卫形态 | 关键词 |
|---|---|---|
| `searchRobustness/**`（`9bu`） | import **黑名单** | 禁够到回测 / 评估端口 ⇒ **零重跑** |
| `oosValidation/**`（`9bv`） | import **必含清单** | 必须够到 `createStrategyBacktestBridge` + `projectCanonicalMetrics` ⇒ **必须重跑** |
| `walkForward/**`（`9bw`） | **黑名单 +「执行只能经由注入钩子」** | 可 import OOS **类型**，但不得自行触达执行面 ⇒ **逐 Fold 重跑且零复制** |

把任一域的实现搬进另一域，对侧静态守卫会**立刻变红**。

### 命名不遮蔽纪律（本任务新增）

🔴 ESM 的 `export *` 遇**同名导出**会**静默遮蔽**（不报错）。本域与 C-19.1 `walkForwardRun/**`
存在近同名符号（`WALK_FORWARD_VALIDATION_*` vs `WALK_FORWARD_*`；
`computeWalkForwardValidationRunFingerprint` vs `computeWalkForwardRunFingerprint`）
⇒ **本域与 `walkForwardRun/**` 刻意不并入全域 `export *`，一律按文件路径 import**
（与 `oosValidation` / `searchRobustness` 同策略；本轮已把一个真实重名函数改名）。
