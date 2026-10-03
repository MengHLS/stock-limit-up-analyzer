# MODULE-MAP — 当前模块地图

> 建立时间：**2026-10-03**（任务 `CODE-AGENT-INFRA-001`）· 判定方式：**实查当前代码的调用关系**（`rg` 引用方 / router 键枚举 / barrel 实读）。
> 🔴 **状态不由目录名推断**，只看「谁实际 import 它、它是否在生产请求路径上、有没有专属测试」。
> `Status` 取值：`CORE`（语义/事实的权威源）· `ACTIVE`（在产但非唯一权威）· `LEGACY`（旧路径，不得当生产路径）· `TRANSITION`（迁移中/部分接线）· `UNKNOWN`（无法判定，如实登记）。
> 配套：`ARCHITECTURE.md` · `LEGACY-MAP.md` · `DEPENDENCY-MAP.md` · `system-manifest.yaml`。

---

## 1. 模块地图

| Module | Purpose | Main Entry | Dependencies | Consumers | Tests | Status |
|---|---|---|---|---|---|---|
| **Market Data Foundation** | 行情 / 证券身份 / 状态 / 复权 / 流动性 / 指数 / 行业的取数与 PIT 维护 | `server/marketData/index.ts` · `server/security/index.ts` · `server/corporateActions/index.ts` | `drizzle/schema.ts` · tushare / baostock provider | `datasetRegistry`（只读）· `backfill` · `marketSync` · routers | `tests/server/{marketData(9),security(8),securityStatus(3),corporateActions(4),historicalState(5),backfill(14)}` | CORE |
| **Dataset Registry** | 原始数据 → 事件检测 → 相对日窗口物化 → **版本化数据集**；构建门禁 / checkpoint / 版本级删除 | `server/datasetRegistry/index.ts`（`plugins.ts` / `builder.ts` / `runner.ts` / `query.ts` / `router.ts`） | marketData / security（只读）· `shared/datasetRegistryContracts.ts` · `ds_*` 五表 | `runWorkbenchAssembly` · tRPC `datasetRegistry` · `/datasets/**` | `tests/server/datasetRegistry(22)` | CORE |
| **Run Workbench Assembly** | A 体系 `dataset_version` → 运行时 Dataset / cursor 的装配桥 | `server/runWorkbenchAssembly/assemble.ts` · `datasetFromRegistry.ts` | `datasetRegistry` · `researchDataset`(types) · `datasetAccess` · `strategyCore/production` | `researchRunRouter` · `researchExperiments` · `paperTrading3fTop3Runner` | `tests/server/runWorkbenchAssembly(11)` | CORE |
| **Runtime Dataset Primitives** | 运行时 Dataset 行模型 + cursor / session / invariants + canonical 序列化 | `server/researchRuntime/{datasetReader,datasetColumns,versionContext}.ts` · `server/research/datasetAccess/index.ts` · `server/researchDataset/{types,version,policy}.ts` | 仅类型 + `researchDataset/version.ts` | `closedLoopWiring` · `compositeRunner` · `signalEngine` · `researchExperiments/datasetPort` · `paperTrading3fTop3Runner` | `tests/server/research/datasetAccess/datasetAccess.test.ts` | CORE |
| **Strategy Core** | 策略规则图求值 / 时间语义 / 特征注册 / 参数解析 / 版本不可变 / 运行快照 | `server/strategyCore/index.ts`（`runtime.ts#StrategyRuntime.evaluate`） | 无 DB / 无 IO（纯域层） | `strategyCore/production` · `adapters/legacyDefinition` · `strategySchema` · `backtest` | `tests/server/strategyCore(11 文件)` | CORE |
| **Strategy Production Wiring** | Core ⇄ legacy 之间的生产接线（barWindow / eventSource / coreDecision / versionFromDocument / runRecord） | `server/strategyCore/production/index.ts` | `strategyCore` · `datasetAccess` · `researchDataset` | `closedLoopWiring` · `runWorkbenchAssembly` | `tests/server/strategyCore/production/*(4)` | CORE |
| **Strategy Schema（存储编码）** | `StrategyDocument` / `StrategyDefinition` 类型与校验 + canonical 序列化 + 5 类投影派生 | `server/research/strategySchema/index.ts` | `shared/researchContracts.ts` · `strategyCore`（值等价） | `strategyPersistence` · `strategyCandidate/definitionBuild` · `runWorkbenchAssembly` | `tests/server/research/strategySchema(2)` | CORE |
| **Strategy Persistence** | 不可变版本 + 演进链 + 状态列 + 5 投影表同事务写入 | `server/research/strategyPersistence/index.ts` | `strategySchema` · `drizzle/schema.ts` | `strategyDomainRouter` · `strategyCandidate` · `researchExperiments/strategyBridge` | `tests/server/research/strategyPersistence(3)` | CORE |
| **Strategy Lifecycle** | §23 八态状态机 + 迁移表 + append-only ledger | `server/research/lifecycle/index.ts` | — | `strategyDomainRouter` · `researchRunRouter` · `runWorkbenchAssembly/lifecycleConfig` | `tests/server/research/lifecycle(1)` | CORE |
| **recipeRegistry** | 配方（recipe）注册表 + 原子条件 / 参数声明（首板回踩等） | `server/research/recipeRegistry.ts` · `recipeRegistryAtoms.ts` | `patternSemantics` · `researchContracts` | `conditionSignal/compile` · `patternLibrary` · `runWorkbenchAssembly/assemble` · `strategySchema/definition` · `strategyCandidate/definitionBuild` | `tests/server/research/recipeRegistryParameters.test.ts` | CORE |
| **conditionSignal** | 声明式条件 → 信号编译 | `server/research/conditionSignal/index.ts` | `recipeRegistry` | `runWorkbenchAssembly/assemble` | `tests/server/research/conditionSignal(1)` | ACTIVE |
| **Pattern Library** | 可复用模式 / 策略骨架 → StrategyDocument 投影 | `server/research/patternLibrary/index.ts` | `recipeRegistry` | `researchExperiments/registry` · `paperTrading3fTop3Runner` · `client` | `tests/server/research/patternLibrary(2)` | ACTIVE |
| **signalEngine** | 研究侧信号求值（cursor 驱动） | `server/research/signalEngine/index.ts` | `datasetAccess` | `research/framework` · 研究侧 | `tests/server/research/signalEngine(2)` | ACTIVE |
| **Trade Simulator** | 策略决策 → 撮合编排（含高级止损 / 移动止损 / 再入场） | `server/research/simulator/index.ts`（`engine.ts`） | `backtest/**` · `portfolio` · `datasetAccess` | `closedLoopWiring` · `runtime` | `tests/server/research/simulator(5)` | CORE |
| **Backtest Core** | 领域模型 / 数据接口 / 规则 / 成本 / 执行 / 持仓 / 组合 / 指标 / 审计 / 序列化 | `server/backtest/index.ts` | `drizzle/schema.ts`(只读) · `portfolio` | `simulator` · `strategyEvaluation` · `closedLoopBacktestRun` | `tests/server/backtest(9)` | CORE |
| **canonicalMetrics** | 指标唯一出口（年化口径常量 + canonical 指标 + digest） | `server/backtest/backtestResult.ts#canonicalMetrics` | `backtest/types.ts` | `strategyEvaluation` · `closedLoopBacktestRun` · OOS / WFA / Robustness | `tests/server/backtest/*` | CORE |
| **Strategy Evaluation** | 策略评估 + 参数空间派生 + 唯一回测桥 | `server/research/strategyEvaluation/index.ts` | `backtest/backtestBridge`（唯一） · `canonicalMetrics` | `parameterSearch` · `oosValidation` · `walkForward` | `tests/server/research/strategyEvaluation(1)` | CORE |
| **Parameter Search** | 参数空间搜索 + 组合采样 + 稳定区判定 + 滚动优化 | `server/research/parameterSearch/index.ts` + `server/paramSearchRouter.ts` | `strategyEvaluation` · `strategyCore/parameterResolver` | tRPC `paramSearch` · OOS / WFA（复用其 application service） | `tests/server/research/parameterSearch(3)` | ACTIVE |
| **Search Robustness** | 搜索结果**邻域稳定性分析**（零重跑） | `server/research/searchRobustness/index.ts` | `parameterSearch`（只读） | tRPC `paramSearch.robustness` | `tests/server/research/searchRobustness(2)` | ACTIVE |
| **OOS Validation** | 冻结候选参数的样本外**真实重跑**验证 + 隔离账本 | `server/research/oosValidation/index.ts` | `strategyEvaluation/backtestBridge`（必含） · `oosIsolation` | tRPC `walkForward.oos` | `tests/server/research/oosValidation(2)` | ACTIVE |
| **Walk-Forward** | 逐 Fold 独立搜索 → 冻结候选 → 紧邻样本外真实重跑 → 多 Fold 描述性汇总 | `server/research/walkForward/index.ts` + `server/walkForwardRouter.ts` | 注入的钩子（唯一执行通道） · `walkForwardRun/windows` | tRPC `walkForward` · `/validation/walk-forward` | `tests/server/research/walkForward(2)` + `walkForwardRun(1)` | ACTIVE |
| **Overfitting Detection** | CSCV-PBO + 参数敏感性 | `server/research/overfittingDetection/index.ts` | `parameterSearch` | tRPC `walkForward.overfit` | `tests/server/research/overfittingDetection(1)` | ACTIVE |
| **Robustness（多维/随机化）** | 成本 / 滑点 / 参数 / 执行扰动 + 随机化稳健性 | `server/research/robustness/index.ts` · `stochasticRobustness/**` | `strategyEvaluation` | `research-experiments/robustnessBridge` | `tests/server/research/{robustness(2),stochasticRobustness(1)}` | ACTIVE |
| **factorAblation** | 因子消融 | `server/research/factorAblation/index.ts` | — | `closedLoopWiring/requirements.ts`（声明） | `tests/server/research/factorAblation(1)` | TRANSITION |
| **Performance / Risk-Adjusted Metrics** | 绩效与风险调整指标 + 滚动优化 | `server/research/performanceMetrics/index.ts` · `riskAdjustedMetrics/**` · `rollingOptimization/**` | `canonicalMetrics` | `closedLoopBacktestRun/summary` · 前端绩效面板 | `tests/server/research/{performanceMetrics(1),riskAdjustedMetrics(1),rollingOptimization(1)}` | ACTIVE |
| **Portfolio** | 组合层边界契约 / 账户 / 记账 | `server/portfolio/index.ts`（`domain.ts`） | `riskEngine` | `backtest/**` · `server/engine` · `PaperTrading` 页 | `tests/server/portfolio(1)` | ACTIVE |
| **Risk Engine** | 盘前 / 盘后风控与限额 | `server/riskEngine/index.ts` | — | `portfolio/domain.ts` | `tests/server/riskEngine(1)` | ACTIVE |
| **Risk（legacy 风控适配）** | `RiskManager` / `PositionSizer`（供 legacy 引擎路径） | `server/risk/manager.ts` | `server/engine` 语义 | `server/engine/engine.ts#runBacktestWithRisk`（默认注入） | `tests/server/risk(2)` | LEGACY（在产） |
| **Paper Account** | 模拟账户 + 约束 + 运行（研究侧前向纸面） | `server/research/paperAccount/index.ts` | — | `research/closedLoop`（paper 阶段 notWired） | `tests/server/research/paperAccount(1)` | ACTIVE |
| **Paper Trading 3F Top3 Runner** | 3F Top-N 策略的模拟账户推进 / 前向 | `server/paperTrading3fTop3Runner/service.ts` | `compositeRunner` · `patternLibrary` | `paperTradingScheduler` · `sentiment` 端点 | `tests/server/paperTrading3fTop3Runner(2)` | ACTIVE |
| **Paper Trading（scheduler）** | 定时推进纸面交易 + 设置 | `server/paperTrading.ts` · `server/paperTradingScheduler.ts` | legacy 语义 | `_core/index.ts`（启动调度）· tRPC `sentiment` | `tests/server/paperTrading.test.ts` | TRANSITION |
| **Market Regime** | 七维 PIT 状态标签 + 归因 | `server/research/marketRegime/index.ts` | `datasetAccess` · `experimentLineage` | tRPC `marketRegime` · `/regime-report` | `tests/server/research/marketRegime(1)` | ACTIVE |
| **Trade Journal** | 交易日志草稿 / 账本 / 对账 / 复盘 | `server/research/tradeJournal/index.ts` | — | tRPC `review` · `/review-workbench` | `tests/server/research/tradeJournal(1)` | ACTIVE |
| **Discipline Feedback** | 纪律反馈 | `server/research/disciplineFeedback/index.ts` | — | tRPC `review` · `strategyCandidate/router` · `oosValidation/window` | `tests/server/research/disciplineFeedback(1)` | ACTIVE |
| **Experiment Lineage** | 实验血缘 | `server/research/experimentLineage/index.ts` | — | `strategyDomainRouter` · `marketRegime/adapters` | `tests/server/research/experimentLineage(1)` | ACTIVE |
| **Independent Research Experiments（作者面）** | 一个目录 = 一个 `ExperimentDefinition`（取数 + 计算 + 结果 + 页面） | `research-experiments/manifest.ts` · `research-experiments/template/**` | `@shared/researchExperimentsContracts`（只许 import type 进 server） | `server/researchExperiments/registry` · `client` | `tests/server/researchExperiments(48)` | CORE |
| **Research Experiment Runtime** | 实验注册 / 运行 / 持久化 / 产物发布 | `server/researchExperiments/index.ts` + `persistence/index.ts` | `researchRuntime/datasetReader` · `artifactStorage` | tRPC `researchExperiments` / `experimentStrategy` · 前端 `/research-experiments/**` | `tests/server/researchExperiments(48)` | CORE |
| **Artifact Storage** | 产物对象存储端口（唯一出口） | `server/artifactStorage/index.ts`（`factory.ts`） | MinIO SDK（仅在此层） | `researchExperiments/persistence/artifactPublisher` · `GET /api/experiments/artifact` | `tests/server/researchExperiments/*`（间接） | CORE |
| **Closed Loop Orchestration** | 14 阶段状态机 / 审计 / 指纹 / 交接 | `server/research/closedLoop/orchestrator.ts` + `closedLoopWiring/requirements.ts` | `spec.ts`（契约） · 注入的 stage runners | `researchRunRouter#loopRun` | `tests/server/research/{closedLoop,closedLoopWiring}(2)` | CORE |
| **closedLoopBacktestRun（留档/读取）** | 闭环回测留档的读写与兼容 | `server/closedLoopBacktestRun/repository.ts` | `drizzle/schema.ts` · `backtest/backtestResult` | `researchRunRouter.{listBacktests,getBacktest,getFinalEvaluation}` · 前端 `/backtest-runs` | `tests/server/closedLoopBacktestRun(8)` | ACTIVE |
| **Composite Runner** | 组合（多因子）候选排序 → 回测的编排桥 | `server/research/compositeRunner/index.ts` | `researchDataset/version` · `researchDataset/policy` | `paperTrading3fTop3Runner` · `researchExperiments/compositeDatasetProvider` · `research-experiments/compositeRunnerBridge` | 间接（`tests/server/paperTrading3fTop3Runner(2)`） | ACTIVE |
| **Research Dataset（B 体系）** | 内容寻址 Dataset + `research_datasets` 行表（旧体系） | `server/researchDatasetRouter.ts` + `server/researchDataset/{index,db,assemble,builder}.ts` | `research_datasets` 表 | tRPC `researchDataset`（仍注册） | `tests/server/researchDataset(9)` | LEGACY |
| **Legacy Engine（Step 2 Core）** | 生产旧回测引擎 + 风控链路 | `server/engine/engine.ts#runBacktestWithRisk` | `server/strategy` · `server/risk` · `realisticBacktest` | `leaderCandidateStrategyBacktest` → `db.getLeaderCandidateBacktest` → tRPC `sentiment.getLeaderCandidateBacktest` | `tests/server/{engine(3),risk(2),features(2)}` | LEGACY（在产） |
| **Legacy Strategy Engine** | legacy `StrategyRegistry` + `StrategyContract` + `strategyBacktest` | `server/strategy/index.ts` | `server/engine` | 仅测试（`strategyBacktest.test.ts` / `productionIntegration.test.ts`） | `tests/server/strategy(5)` | LEGACY |
| **Legacy realisticBacktest** | 逐日 T+1/T+2 模拟器 | `server/realisticBacktest.ts` | — | `leaderCandidateStrategyBacktest`（映射字段，不重跑其逻辑）· 研究出口 | `tests/server/{realisticBacktest,realisticSimulationSemantics}` | LEGACY |
| **Legacy LeakageGuard** | 研究侧未来函数守卫（**恒通过**） | `server/research/framework/leakage.ts` | — | 仅测试 | `tests/server/step11.pitAdversarial.test.ts` | LEGACY（语义失效） |
| **signalToPnl** | 信号 → PnL 编排引擎 | `server/research/signalToPnl/engine.ts` | — | `closedLoopWiring/requirements.ts`（声明） | `tests/server/research/signalToPnl(1)` | TRANSITION |
| **Legacy Research Tables** | 已退役的旧研究表 | `drizzle/0046_legacy_research_retire.sql` | — | **零代码引用** | — | LEGACY（归档存储） |

---

## 2. 状态判定依据（易误判项）

| 模块 | 为什么是这个状态（**不按目录名**） |
|---|---|
| `server/researchDataset/**` | **同目录不同命运**：`types.ts` / `version.ts` / `policy.ts` 被 `closedLoopWiring` / `datasetAccess` / `compositeRunner` / `paperTrading3fTop3Runner` **运行时 import**（⇒ `CORE` 原语）；而 `researchDatasetRouter.ts` + `registry*.ts`（`research_datasets` 行表）是旧 B 体系（⇒ `LEGACY`）。**不要整体删除该目录。** |
| `server/research/factorAblation/**` | 只被 `closedLoopWiring/requirements.ts` **声明式**引用，无真实 runner ⇒ `TRANSITION`（不是 ACTIVE）。 |
| `server/research/signalToPnl/**` | 同上：声明存在、闭环 `paper` 阶段 `notWired` ⇒ `TRANSITION`。 |
| `server/engine/**` / `server/strategy/**` | 目录名像是「旧代码」，但 `runBacktestWithRisk` **确实在生产请求路径上**（`sentiment.getLeaderCandidateBacktest`）⇒ 标「LEGACY（在产）」，**不是死代码**。 |
| `server/research/framework/leakage.ts` | 在产 import 但恒通过（`EPOCH_FLOOR_DATE`）⇒ 语义失效，安全性全靠数据层 PIT。 |
| `recipeRegistry` | 目录名像「旧研究」，实际被 5 处生产模块消费 ⇒ `CORE`，**不是** legacy。 |
| `server/research/closedLoopWiring/executors.ts` | 只实装 data/research/strategy/backtest/evaluation；`optimization` / `regime` / `finalize` 在 requirements 里 `wired: true` 但**无 runner** ⇒ 见 `ARCHITECTURE.md` §11 BD-14（**UNKNOWN，待核**）。 |

## 3. UNKNOWN（无法判定，如实登记）

| 项 | 为什么无法判定 | 需要什么才能判定 |
|---|---|---|
| `optimization` / `regime` / `finalize` 阶段的真实执行路径 | `requirements.ts` 声明 `wired: true`，`executors.ts` 无对应 runner；是否存在其它注入点未证实 | 追踪 `runClosedLoop` 调用方是否在别处补齐 stageRunners（或在真机跑一次带这些阶段声明的 Run 看是否 `CL_RUNNER_NOT_INJECTED`） |
| `server/observability/**`（`PARAM_PROFILE=1` 性能剖析） | 无专属测试；只知道被生产用 | 查 `perfProfile.ts` 的实际调用点 + 运行时验证 |
| `server/research/framework/**` 其余模块 | 部分只被测试引用，部分是生产原语 | 逐文件 grep 引用方 + 判定生产可达性 |

---

## 4. 维护规则

1. 新增/删除模块 ⇒ 更新本表一行（含 `Status` 与判定依据）。
2. `Status` 变化（例如 `TRANSITION → CORE`）⇒ 同步更新 `ARCHITECTURE.md` + `CHANGE-AUDIT.md`。
3. 发现本表与代码不一致 ⇒ 标 `BASELINE_DRIFT`，**改文档不改代码**。