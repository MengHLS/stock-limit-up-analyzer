# DOMAIN-MAP — 领域边界与职责（含「不负责什么」）

> Baseline: **v2.0.0** · auditedAt **2026-09-20**（round-2 全量审计）· 唯一细则源 = 代码
> 归属标记：`FACT`（代码已存在并可达） / `PARTIAL` / `PLANNED` / `LEGACY` / `BLOCKED` / `OBSERVED`
> 本文件只回答「谁负责什么、谁**不**负责什么」。数据流见 `DATA-FLOW.md`，执行链见 `EXECUTION-FLOW.md`。

---

## 0. 一句话总览

> 🔄 **round-2（2026-09-20）补充**：四阶段 `A(9by) → R1(9bz) → B(9ca) → D(9cb)` 已全部 COMPLETE。**它们改的是「数据域 / 研究域」内部的语义与信息边界，不改 Domain 划分**（唯一新增的跨域结构物 = `shared/patternSemantics.ts` 语义契约，见 §17）。

本项目的领域链是 **Dataset → Research → Strategy → Parameter Search → Backtest → Evaluation → Robustness/OOS/WFA → Simulation → Production**。
但**代码里的真实可达性并不等同于这条理想链**：目前**闭环编排器只装配了 8/14 阶段**，其余 6 阶段（robustness / oos / overfitting / paper / review / discipline）虽在编排器内 `notWired`，却各自**另有独立 tRPC 路由**可达（技术预览口径）。判定见每节 `状态`。

---

## 1. Dataset（数据域）

**状态：READY（FACT）**

| 项 | 内容 |
|---|---|
| 负责 | 原始数据标准化 → 事件检测 → 相对日窗口物化 → **版本化数据集**（`dataset_version.id` 为坐标）；筛选/构建配置固化；构建作业 checkpoint/resume；版本级删除/级联 |
| 不负责 | 策略判断、信号生成、收益撮合、指标计算 |
| 权威入口 | `server/datasetRegistry/**`（17 文件）：领域层 `registry.ts`、物理层 `physicalTables.ts`、插件 `plugins.ts`、查询 `query.ts`、运行 `runner.ts`、tRPC `router.ts` |
| 物理分层 | `ds_{code}_{event,prefix,post,path,outcome}` 五表：身份层 / L-事实(rd≤0，含 rd=0) / L-事实(rd≥1) / L-衍生(rd≥1) / L-聚合(每 event×horizon 一行) |
| 插件机制 | `DatasetPluginRegistry`（`plugins.ts:64`）声明式 DDL + IO；当前**只注册 1 个插件** `first_limit_pullback`（`plugins.ts:249`），未注册 code 构建时抛 `BUILDER_NOT_REGISTERED`（`registry.ts:429`） |

**⚠️ 并存第二套 Dataset 概念（OBSERVED，认知风险）**

| | A 体系（权威） | B 体系（前身 / LEGACY） |
|---|---|---|
| 代码 | `server/datasetRegistry/**` | `server/researchDataset/**` + `server/research/datasetAccess/**` |
| 坐标 | `dataset_version.id`（bigint） | `datasetVersion` 字符串 `rd-1.0.0-1-<sha256>` |
| 落库 | `dataset_definition` / `dataset_version` / `dataset_build_job` / `dataset_build_config` + `ds_*` | `research_datasets`（+ `rd_rows_<buildKey>` 行表） |
| tRPC | `datasetRegistry`（`routers.ts:319`） | `researchDataset`（`routers.ts:316`，**仍存在**） |
| 前端 | `/datasets/**` | 无独立页面 |
| 关系 | 靠 `server/runWorkbenchAssembly/datasetFromRegistry.ts:60` **单向**桥接（B 消费 A） | 桥**仅支持** `first_limit_pullback`（`datasetFromRegistry.ts:978`） |

**不负责**：B 体系（`researchDataset`）不参与新的研究链路；它的 tRPC 端点保留但不再是权威数据源。

---

## 2. Research（研究域）

**状态：READY（FACT）**

| 项 | 内容 |
|---|---|
| 负责 | 从 `datasetVersionId` 出发的**探索性研究**：假设 → 实验 → 运行 → 分析 → 结果 → 结论 → 候选策略；条件模型 / 结果指标码 / 执行批次日志 / Finding 分级；把结论**转正为策略候选** |
| 不负责 | 交易执行、真实成交撮合、最终策略有效性判定（属 Backtest/Evaluation）；**不负责**定义策略规则本身（属 Strategy） |
| 权威入口 | `server/researchCore/**`（领域类型 + 10 张单数表仓储，`createDbResearchRepositories()` `repository/db.ts:532`）；`server/researchEngine/**`（分析引擎 + planner）；`server/research/strategyCandidate/**`（转正桥） |
| 上游输入 | `datasetVersionId`（软引用 `dataset_version.id`，**无 FK**） |
| 下游消费者 | Strategy（candidate → promote）、前端 `/research/**`、`/research/ask` |

**⚠️ 两套 Research 数据模型并存（OBSERVED）**

| | 新（单数，权威） | 遗留（复数，STEP 6.x） |
|---|---|---|
| 表 | `research_experiment` / `research_hypothesis` / `research_run` / `research_analysis` / `research_analysis_condition` / `research_analysis_metric` / `research_result` / `research_conclusion` / `research_strategy_candidate` / `research_artifact`（+ `research_finding` / `research_question` / `research_plan` / `research_analysis_template`） | `research_experiments` / `research_runs` / `research_experiment_batches` / `research_datasets` |
| 输入边界 | `datasetVersionId` | 字符串 `experimentId` + `strategyId` |
| 生产可达 | ✅ 是 | ❌ 否（`DbExperimentRepository` 等**在 `server/**` 无任何实例化点**，仅测试引用） |
| 目录 | `server/researchCore/**` | `server/research/{experiment,run,sweep}*.ts` + `server/research/persistence/**` |

**不负责**：遗留复数表**不代表**任何当前职责；`server/research/index.ts` 仍 barrel 化它们（加载即求值），属**隐性死代码**。

**边界守护（FACT）**：`tests/server/research/strategyCandidate/importBoundary.test.ts:69-131` 用测试固化「researchCore 不得 import strategyPersistence/strategySchema；反向亦然；只有桥可两侧同时 import」——**这是本项目唯一被测试固化的跨域边界**。

---

## 3. Strategy（策略域）

**状态：READY（FACT，语义权威已建成并接生产）**

| 层 | 位置 | 职责 | 不负责 |
|---|---|---|---|
| **语义权威** | `server/strategyCore/**`（20 文件 / ~6.8k 行，纯域层：无 DB / 无 IO / 无 `Date.now` / 无 `Math.random`） | `StrategyRuntime.evaluate(version, parameterSet, context)` → `StrategyDecision`；规则图求值、时间语义、特征注册、泄漏守卫、版本不可变、运行快照 | 不碰 DB、不碰 Dataset 坐标、不做撮合 |
| **生产接线** | `server/strategyCore/production/**`（6 文件） | `barWindow`（legacy bars → 相对日窗口）、`eventSource`（数据集事件源 → `EventOccurrenceResolver`）、`coreDecision`（Core 决策源）、`versionFromDocument`、`runRecord` | 不自己判事件（必须注入）、不自己读库 |
| **存储编码** | `server/research/strategySchema/**`（12 文件） | `StrategyDocument` / `StrategyDefinition` 类型与校验（含 Look-Ahead L1–L8）、canonical 序列化与指纹、5 类投影派生、v1 有损视图 | **不是**语义权威；Definition 降级为「存储编码 + 兼容视图」（`definition.ts:18-21`） |
| **持久化** | `server/research/strategyPersistence/**`（7 文件） | 不可变版本 + 演进链 + 状态列 + 5 投影表同事务写入；`assertStoredVersionConsistency()` 三方指纹断言 | 唯一允许 UPDATE 的列 = `status`（`contract.ts:6-7`） |
| **生命周期** | `server/research/lifecycle/**`（9 文件） | §23 八态状态机 + 迁移表 + append-only ledger | — |
| **legacy 引擎层** | `server/strategy/**`（8 文件） | `StrategyRegistry` + legacy `StrategyContract` + `strategyBacktest.ts`（供 `server/engine` 回测） | 与 Core **职责正交**；命名易混淆（文档级风险） |

**不负责**：Strategy **不**负责真实成交撮合（属 Backtest）；**不**负责数据集物理数据（只落引用）；Definition 内**禁止**出现 Dataset / 引擎坐标（`DATASET_BINDING_IN_DEFINITION_FORBIDDEN`，机器可查）。

**🔴 四条硬化语义（写错就会踩）**

1. `WINDOW` 只考虑「当前决策日及之前」的窗口日 ⇒ `evaluate` **必须逐决策日调用**。
2. `updateVersionDefinition()` **恒抛** `VERSION_IMMUTABLE`（`version.ts:180`）；改内容只能 `applyDefinitionChange()` → 新版本。
3. 事件判定**必须由运行方注入**（`context.resolveEvent`）：未注入**抛错**，不静默返回 false（`runtime.ts#evaluateEventOccurrence`）。
4. `datasetVersionId` 只允许在 `StrategyDocument` / `StrategyDatasetBinding` / 投影列 / `StrategyRunSnapshot.datasetReference`，**不得**进 Definition。

---

## 4. Parameter Search（参数搜索域）

**状态：PREPARATION / PARTIAL（FACT 可达但未达研究就绪）**

| 项 | 内容 |
|---|---|
| 负责 | 参数空间派生 → Grid / Random 搜索 → 稳定参数区判定（拒绝高收益坏点）→ 滚动优化；稳健性/随机化重估 |
| 不负责 | 定义策略（属 Strategy）、产出 Production 策略（只产 **candidate**）、消费 OOS 数据做优化 |
| 可达入口 | `paramSearchRouter.ts`：`describe` / `run` / `rolling` / `robustness` / `stochastic`（调用 `runParameterSearch:701`、`runRollingOptimization:761`、`runRobustnessStress:794`、`runStochasticRobustness:840`） |
| 参数空间真源 | `server/research/strategyEvaluation/parameterSpaceFromDocument.ts:54` 从 `document.parameters`（**v1 有损视图**）派生 |
| 前端 | `client/src/pages/ParameterSearch.tsx` |

**❌ 不负责 / 未做到**

- **搜索结果不落库**：`paramSearchRouter.ts` 全文**无任何 insert/update/delete**（只读库 + 返回 bridge）⇒ 搜索无持久化实验记录，无法「事后回答这个结果怎么来的」。
- **`parameterRole` 门槛未生效**：`listSearchableParameters()`（`parameterResolver.ts:365`）是「谁能被搜索」的唯一权威，但**生产代码零调用**（仅测试）⇒ `FIXED` 参数仍会被搜。
- **`derivedFrom` 无求值器**（仅人类可读）。
- **R-06 性能（已定位 + 已修，见 §7）**：单次真实 Run **657.8 s**；主因 = `canonical.ts` **44.3% CPU**（`computeDefinitionFingerprint` 每求值调 2 次）⇒ 已加 WeakMap 缓存，research 阶段 **−52%**、digest 逐字节不变；**剩余瓶颈 = DB 读取 ≈95 s（58 次往返）**。

---

## 5. Backtest（回测域）

**状态：READY（FACT，BACKTEST-002 = COMPLETE）**

| 项 | 内容 |
|---|---|
| 负责 | 历史执行模拟：组合会计、T+1 三态账本、4 种执行模型、涨跌停/停牌拦截、零成交量政策、成本分解、滑点分层、审计轨迹、canonical 指标、有界结果载荷 |
| 不负责 | 策略发现（属 Research）、参数择优（属 Parameter Search）、最终评估结论（属 Evaluation） |
| 权威入口 | `server/backtest/**`（16 文件）= **事实上的 Backtest Core**；生产主链 = `server/research/simulator/engine.ts:250 runTradeSimulation` **全量复用** backtest 原语 |
| 执行政策 | `BACKTEST_EXECUTION_POLICY_VERSION = 1`（`context.ts:48`）；`zeroVolumePolicy` 默认 `REJECT`（`context.ts:84`） |
| 唯一指标出口 | `backtestResult.ts:392 canonicalMetrics()`；`BACKTEST_ANNUALIZATION_DAYS = 252`（`:126`） |

**🔴 禁止事项**

- **禁新建 `server/backtestCore/**`**——`server/backtest/**` 已承担该职责，另建会制造第二套持仓/成本/撮合。
- 禁给 `/backtest` 加 cap：该端点**并存两套交易语义**（快照 = 等权；顶层 = 固定 100 股）。

**⚠️ 三段不可互换的执行契约（OBSERVED，架构风险）**

| 实现 | 入口 | 可达性 |
|---|---|---|
| `runBacktestWithRisk` | `server/engine/engine.ts:221` → `server/strategy/strategyBacktest.ts:263` → `leaderCandidateStrategyBacktest.ts` → `routers.ts:1346`（`sentiment.getLeaderCandidateBacktest`） | **生产可达**（legacy 语义） |
| `runTradeSimulation` | `server/research/simulator/engine.ts:250` | **生产可达**（闭环主链） |
| `simulateRealisticTPlus1ToTPlus2` | `server/realisticBacktest.ts:246` | 研究段可达（被 `paramSearchRouter` / `walkForwardRouter` / `overfittingGuard` / `leaderCandidates` 消费） |

---

## 6. Evaluation（评估域）

**状态：PARTIAL（FACT 可达，两套口径尚未完全收口）**

| 项 | 内容 |
|---|---|
| 负责 | 收益 / 风险 / 回撤 / 交易质量指标；策略参数评估端口；闭环 evaluation 阶段 |
| 不负责 | 撮合（属 Backtest）；稳健性扰动（属 Robustness）；**搜索结果的邻域稳定性分析**（属 Robustness 的 `searchRobustness` 子模块，**只读**本域结果） |
| 权威入口 | `server/research/strategyEvaluation/**`（5 文件）：`evaluateStrategyParameters`（`evaluate.ts:159`）、`createStrategyParameterEvaluator`、`deriveParameterSpaceFromDocument`、`createStrategyBacktestBridge` |
| 主输出字段 | `StrategyEvaluationResult.evaluation: ClosedLoopEvaluationRef` |
| 指标出口 | `performanceMetrics/evaluate.ts:100` · `riskAdjustedMetrics/evaluate.ts:83` · `tradeQualityMetrics/evaluate.ts:87` |
| canonical 接线 | `closedLoop/adapters.ts:134 composeClosedLoopEvaluationRef`：5 个重叠标量 + `completedTradeCount` 取 canonical；`metricsSource` = `"canonical"` \| `"evaluators"`（未接线时**如实**标 `evaluators`，`adapters.ts:213`） |

**🔴 硬约束**：**已有 canonical 时不得重新计算重叠指标**；`NOT_AVAILABLE` **不得**被评估器数值顶替（有专门测试 `canonicalMetricsParity.test.ts`）。年化基数两边不一致时**响亮抛错** `CL_WIRING_ANNUALIZATION_BASIS_MISMATCH`（`executors.ts:565-574`）。

**⚠️ 未收口**：`server/backtest/metrics.ts:56 computeMetrics`（第二套口径）**仍存在**，被 `tradeQualityMetrics/analyze.ts:442` 以 read-only import 消费（仅取 trade 段，注释声明逐位一致）。

**⚠️ `dataReady` 陷阱（FACT）**：`server/historicalState/audit/runAudit.ts:74` `dataReady = options.dataReady ?? false` ⇒ 调用方**必须显式传 `true`**，否则 `INCONCLUSIVE`。

---

## 7. Robustness（稳健性域）

**状态：FACT（技术预览口径，非 RESEARCH_READY）**

| 子模块 | 位置 | 职责 | 可达性 |
|---|---|---|---|
| 扰动重估 | `server/research/robustness/**`（8 文件） | 成本 / 滑点 / 参数 / 执行四轴扰动 + 漂移归因 | ✅ `paramSearchRouter.ts:794` |
| 随机化 | `server/research/stochasticRobustness/**`（12 文件） | Monte Carlo / Bootstrap / 成交顺序随机化 | ✅ `paramSearchRouter.ts:840` |
| **搜索结果邻域稳定性**（ROBUSTNESS-001） | `server/research/searchRobustness/**`（11 文件） | 消费**已算完**的 Parameter Search 结果，在**冻结快照**上做邻域稳定性 / 敏感性 / 离散度 / 二维稳定性矩阵分析 —— **零重跑回测、零重算指标**（结构性不可重跑，静态守卫测试钉住）；结论落三表并通过 6 个端点可达 | ✅ `paramSearchRouter.ts`（`createRobustnessRun` / `listRobustnessRuns` / `getRobustnessRun` / `startRobustnessRun` / `cancelRobustnessRun` / `getRobustnessResults`） |
| 因子消融 | `server/research/factorAblation/**`（9 文件） | IS-OOS 双轨因子消融 + 贡献 | ❌ **仅测试可达**（CODE_READY） |
| legacy 守卫 | `server/overfittingGuard.ts` | DSR / PSR / bootstrap / monkey / cost-sensitivity | ✅ `db.ts:74`、`leaderCandidates.ts:1271`、`factorScore.ts:3` |

**不负责**：不做 OOS 隔离（属 OOS 域）、不做 PBO（属 Overfitting 域）。

---

## 8. OOS / Walk-Forward（样本外 / 滚动窗）

**状态：FACT（tRPC 可达，技术预览）**

| 子模块 | 位置 | 可达性 |
|---|---|---|
| IS/OOS 隔离 | `server/research/oosIsolation/**`（8 文件） | ✅ `walkForwardRouter.ts:605`（`walkForward.oos`） |
| WFO 编排 | `server/research/walkForwardRun/**`（7 文件） | ✅ `walkForwardRouter.ts:561`（`walkForward.run`） |
| legacy 6.4/6.5 | `oosEvaluation.ts` / `walkForward.ts` / `walkForwardService.ts` / `trainValidationOos.ts` / `parameterStability.ts` | ❌ **仅测试可达**（CODE_READY） |
| 切分工具 | `datasetSplit.ts` | ⚠️ PARTIAL：纯工具被 `walkForwardRun/windows.ts:43` 等生产引用，服务本体无调用 |

**负责**：Train → Optimize → Freeze → Test → Move Window 编排，window id / train period / test period / parameters / result / metrics 留档。
**不负责**：不负责参数择优算法（属 Parameter Search）；**禁止** OOS 数据参与参数优化。

---

## 9. Overfitting Detection（过拟合检测）

**状态：FACT（tRPC 可达，技术预览）**

| 子模块 | 位置 | 可达性 |
|---|---|---|
| CSCV-PBO + 参数敏感性 + 聚合结论 | `server/research/overfittingDetection/**`（7 文件） | ✅ `walkForwardRouter.ts:698`（`walkForward.overfit`） |
| legacy PBO / 过拟合评估 | `server/research/pbo.ts`、`overfittingAssessment.ts` | ❌ 仅测试可达（CODE_READY） |

---

## 10. Simulation / Paper Trading（模拟交易）

**状态：FACT（生产可达）+ 编排引擎 CODE_READY**

| 子模块 | 位置 | 可达性 |
|---|---|---|
| 注入式模拟账户（C-23.1，六维贴近实盘） | `server/research/paperAccount/**`（8 文件） | ✅ `reviewRouter.ts:121`（`review.paper.run`）；`signalToPnl/engine.ts:65-93` 复用其原语 |
| 前向纸面交易（legacy，DB 支撑） | `server/paperTrading.ts` | ✅ `db.ts:90,2815-2983`；`sentiment.*` 五个端点 |
| 定时推进 | `server/paperTradingScheduler.ts` | ✅ `_core/index.ts:14,169` 启动 |
| signal→order→fill→PnL 闭环引擎 | `server/research/signalToPnl/**` | ❌ `runSignalToPnlLoop`（`engine.ts:280`）**无生产调用**（闭环 `paper` 阶段 `notWired`） |

**负责**：用与真实交易尽可能一致的 signal / position / execution / risk / capital / cost 口径模拟，并记录 run / version / dataset / order / fill / position / PnL。
**不负责**：不负责真实下单（**无 Live Trading 实现**）。

---

## 11. Production / Lifecycle / Review（生产与生命周期）

**状态：Lifecycle / Review = FACT（技术预览）；Production = PLANNED**

| 子域 | 位置 | 职责 | 可达性 |
|---|---|---|---|
| 策略生命周期 | `server/research/lifecycle/**`（9 文件） | §23 八态 + 迁移表 + append-only ledger | ✅ `research.lifecycle.*`；闭环 `finalize` 阶段已装配（`researchRunRouter.ts:503-514`） |
| 候选转正 | `server/research/strategyCandidate/**`（11 文件） | 结论 → 候选 → 策略版本；跨域写入收口在 `strategyPromotionPort.ts` | ✅ `research.strategyCandidate.promote`（`router.ts:307`） |
| 纪律反馈 | `server/research/disciplineFeedback/**`（11 文件） | 违规归因 / 重复错误 / 执行质量 / 环境分布 | ✅ `review.discipline.run` |
| 交易日志 | `server/research/tradeJournal/**`（9 文件） | 计划 vs 实际核对 + 复盘草稿 | ✅ `review.journal.reconcile` / `review.journal.drafts` |
| 市场状态 | `server/research/marketRegime/**`（12 文件） | 七维 PIT 状态标签 + 归因 | ✅ `marketRegime.run`；闭环 `regime` 阶段已装配 |
| **生产平台** | — | 完整闭环部署 / 实盘对接 | **PLANNED（无实现）** |

**🔴 已知缺口（FACT）**：`setVersionStatus`（`strategyPersistence/service.ts:362`）**不吃 §23 迁移表**——只校验「属于八态」字面量 ⇒ `Draft → Production` 跳级在**写入路径上不被拒**（迁移表只在 `lifecycle` router 的 `transition` + 纯函数 `transition.ts` 生效）。

---

## 12. 数据地基（STEP 12 / A–H 域）

**状态：DATA_READY / `RESEARCH_READY = TRUE`（gate 17/17，2026-09-09 判定）**

| 域 | 表 | 状态 | 备注 |
|---|---|---|---|
| A OHLCV | `stock_daily_prices` | DATA_READY | 缺口 0 / 重复 0 |
| B Security Master + Identifier | `research_securities` / `research_security_identifier_history` | DATA_READY | 含退市股（anti-survivorship） |
| C Status | `research_security_status_history` | DATA_READY | **事件态表**（只存发生过停牌/ST 的证券） |
| D Corp Actions + Adjustment | `corporate_actions` / `adjustment_factors` | DATA_READY | CA 为**事件态表** |
| E Liquidity | `liquidity_daily` | DATA_READY | — |
| F Index | `index_master` / `index_daily` | DATA_READY | **交易日历唯一来源** |
| G Industry | `industry_assignments` | DATA_READY（两项 PENDING） | `securityId` 曾全 NULL；`effectiveFrom` 单点（BaoStock 只给当前快照） |
| H Gate | — | RESEARCH_READY | — |

**🔴 铁律**：交易日历**唯一来源 = `index_daily`**；该表停更时会**静默 no-op 却报成功**，补数必须 `--force`。

---

## 13. 域间边界速查（谁不能依赖谁）

| 禁止的依赖 | 现状 | 判定 |
|---|---|---|
| Dataset → Strategy | 不存在 | ✅ 合规 |
| Research → Parameter Search | 不存在（researchCore 只到 candidate） | ✅ 合规 |
| Backtest → 反向修改 Strategy Definition | 不存在（唯一允许 UPDATE 的是 `status`） | ✅ 合规 |
| researchCore ↔ strategyPersistence/strategySchema | **只允许经桥** `strategyCandidate/strategyPromotionPort.ts` | ✅ 有测试固化 |
| `client/**` → `server/**` 运行时值 | 不存在（全部 `import type`，编译期擦除） | ✅ 合规 |
| Strategy Definition → Dataset / 引擎坐标 | 由 `DATASET_BINDING_IN_DEFINITION_FORBIDDEN` 机器拒绝 | ✅ 合规 |

详见 `DEPENDENCY-MAP.md`。

---

## 17. PHASE-A / R1 / B / D 增量（2026-09-20 · `9by` / `9bz` / `9ca` / `9cb`）

**四个阶段的职责边界变化（唯一表述）**

| 阶段 | 谁的职责被改变 | 变化 | **新增的「不负责」** |
|---|---|---|---|
| **A**（`9by`） | Research 域 | 新增 `researchEngine/report/**`：把已完成的 `Result→Finding→Conclusion` 沉淀为可持久化/可追溯/可重看的 `research_artifact(REPORT/INLINE)` | **不产生新结论**（纯投影）；**不改 Run 状态**（best-effort，吞错仅 `console.warn`） |
| **R1**（`9bz`） | Dataset 域 + Research 域 | **判定日（`decisionOffsetDays`）成为「样本资格的唯一信息边界」**：数据集层按 `T+1..T+d` 截断池子；研究层护栏改为按声明的判定日校验 | Dataset **不负责**声明「本次研究在 T+d 判定」（那是 Run/分析意图）；Research **不负责**替调用方猜判定日（四级全空 ⇒ 拒绝） |
| **B**（`9ca`） | Pattern 库 + Research/Strategy 两侧 | 新增 `shared/patternSemantics.ts` **语义契约** + `semanticRegistry` **唯一 SoT**；Pattern 声明 → 唯一 Expander → 两侧投影（研究变量目录 / 策略特征） | Pattern 声明**不含实现**（纯数据，无回调/无 SQL）；两侧投影**不得自行展开**语义 |
| **D**（`9cb`） | Research→Strategy 转正链 | `createFromConclusion` **默认从研究证据派生候选规则**（`evidenceDerivation.ts` 唯一实现），provenance 落 `sourceFindingIdsJson` + `sourceTraceJson.derivation` | **不推断阈值数值**（D.3 禁黑箱）——只产参数引用，取值交 Parameter Search；不可翻译**必须如实登记**，绝不猜 |

**🔴 round-2 新增的域间硬约束**

1. **判定日四方同值**：`analysis.config` / `run.config` / `experiment.config` / `dataset_version.universeDefinition` 四处若都声明，**必须同值**；异值 ⇒ `DECISION_OFFSET_CONFLICT`（不是「按优先级取一个」）。
2. **Research 域新增对 Pattern 声明库的依赖**：`server/researchEngine/**` → `server/research/patternLibrary/**`（`semanticRegistry`）。**这条边当前未被 `importBoundary.test.ts` 守护**（见 `DEPENDENCY-MAP.md` D-92）。
3. **`research_artifact` 幂等只在应用层**（无 DB 唯一约束）⇒ 并发/多进程下无 DB 兜底。

---

## 14. PARAMETER-001 增量（2026-09-19 · `9bs`）

**§4 Parameter Search 的更新**（其余章节不变）：

- **状态**：`PREPARATION / PARTIAL` → **READY**。
- **新增能力**：持久化搜索 Run（`CREATED / RUNNING / COMPLETED / FAILED / CANCELLED` 五态）+ 组合计划 + 单组合结果留档，
  支持 **Resume（跳过已成功）/ Retry（单独重跑失败）/ Cache（五要素一致复用成功结果）**。
- **新增入口**（同域，**不新开 router**）：
  `server/research/parameterSearch/executor.ts#createParameterSearchRun` / `#executeParameterSearchRun` / `#retryParameterSearchCombination` / `#cancelParameterSearchRun`；
  端点 `paramSearch.{createSearch,listSearches,getSearch,startSearch,cancelSearch,getSearchResults,retrySearchCombination}`。
- **域边界未变**：仍**不负责**定义策略、**不产出** Production 策略（只产 candidate）、**禁止** OOS 数据参与参数优化。
- **不产出系统性结论**：只提供数据 + 排序 / 过滤能力；默认排序是 `combinationIndex`（**刻意不是收益降序**），
  前端与报告都**不得**出现「最佳参数 / 最优策略 / 推荐参数」这类措辞。
- **指标口径**：唯一读数面仍是 `ClosedLoopEvaluationRef#canonicalMetrics`（六项只读投影，**零重算**）。

---

## 15. OOS-001 增量（2026-09-19 · `9bv`）

**§8 OOS 的更新**（其余章节不变；§7 Robustness 的**新增一条并列模块**见下）：

- **新增模块**：`server/research/oosValidation/**`（10 文件）—— **冻结候选参数的样本外真实重跑验证**。
- **新增能力**：OOS Run 五态状态机（`CREATED / RUNNING / COMPLETED / FAILED / CANCELLED`）；
  **参数冻结可复核**（源组合行重算 `parameterHash`）；**真进闭环重跑回测**并重算 canonical 指标；
  **IS/OOS 六项逐项对照** + 三项派生（收益退化 / 回撤变化 / 交易笔数变化）；落两表。
- **新增入口**（同域，**不新开 router**）：`server/research/oosValidation/executor.ts#createOosValidationRun` /
  `#startOosValidationRun` / `#cancelOosValidationRun` / `#readOosValidationRun` / `#readOosValidationResult`；
  端点 `paramSearch.{createOosRun,listOosRuns,getOosRun,startOosRun,cancelOosRun,getOosResult}`。
- 🔴 **与 §7 Robustness 的并列关系（语义正好相反，不许合并）**：

| 模块 | 问题 | 是否重跑 | 守卫方向 |
|---|---|---|---|
| `searchRobustness/**`（§7，`9bu`） | 「同一份结果**邻域**稳不稳？」 | ❌ 零重跑零重算 | import **黑名单** |
| `oosValidation/**`（本节，`9bv`） | 「换到**没见过**的数据上**还成立吗**？」 | ✅ **必须重跑 + 重算** | import **必含清单** |

- **与仓库既有四套 OOS 模块的分工**（**不重复实现**）：
  `research/trainValidationOos.ts`（纯模型，不可执行）· `research/validationSelection.ts`（进程内计划候选
  `FrozenOosCandidate`）· `research/oosEvaluation.ts`（自述「不实现任何回测 / 交易」）·
  `research/oosIsolation/**`（记录 / 检查层，无重跑语义）。
  本域的**根本差别四条**：① Run 身份与状态机；② 参数冻结**可复核**；③ **真进闭环重跑**；④ **落库可追溯**。
- **域边界**：**不负责**挑参数（参数择优属 Parameter Search）；**不修改**源 Search Run / 结果 / 历史 Backtest Run；
  **不产出**「最佳 / 最优 / 推荐」结论；**不定义** Walk-Forward 编排（下一阶段才可能）。
- **指标口径**：OOS 侧**必须重算**（`projectCanonicalMetrics` 经闭环重跑读数），
  IS 侧取源 Search 结果的**冻结副本**（`toResultView`）⇒ 两侧同表头对齐，口径差异**看得见**。
- 🔴 **`null` ≠ `0`**：算不出来显示「—」，不用 0 顶替；`averageWin` / `averageLoss` **两侧都拿不到**
  ⇒ 如实登记为 Known Risk，**不补值**。

---

## 16. WALK-FORWARD-001 增量（2026-09-19 · `9bw`）

**新增模块**：`server/research/walkForward/**`（11 文件）—— **持久化滚动窗口验证的编排层**。

- **新增能力**：窗口排程冻结（`ROLLING` / `EXPANDING`；四个几何量单位 = **交易日个数**）+ 双重指纹；
  Fold 六态生命周期；**Leakage Guard**；候选冻结（源组合行重算 `parameterHash` 复核）；
  **逐 Fold 独立搜索 + 紧邻样本外真实重跑**；多 Fold **描述性**汇总；落两表。
- **新增入口**（同域，**不新开 router**）：`server/research/walkForward/executor.ts#createWalkForwardValidationRun` /
  `#startWalkForwardValidationRun` / `#cancelWalkForwardValidationRun` / `#readWalkForwardValidationRun` /
  `#readWalkForwardValidationFold` / `#listWalkForwardValidationRuns`；
  端点 `paramSearch.{createWalkForwardRun,listWalkForwardRuns,getWalkForwardRun,getWalkForwardFold,startWalkForwardRun,cancelWalkForwardRun}`。
- 🔴 **与 §7 / §15 的三方并列关系（语义各不相同，禁合并、禁互相搬移）**：

| 模块 | 问题 | 是否重跑 | 守卫方向 |
|---|---|---|---|
| `searchRobustness/**`（§7，`9bu`） | 「同一份结果**邻域**稳不稳？」 | ❌ 零重跑零重算 | import **黑名单** |
| `oosValidation/**`（§15，`9bv`） | 「换到**没见过**的一个窗口上还成立吗？」 | ✅ 必须重跑 + 重算 | import **必含清单** |
| `walkForward/**`（本节，`9bw`） | 「**滚动一串窗口**、每折各自独立搜参后，还成立吗？」 | ✅ 必须**逐 Fold** 重跑（每 Fold 一个独立搜索 + 一个独立 OOS Run） | **黑名单 +「执行只能经由注入钩子」** |

- **与 C-19.1 `server/research/walkForwardRun/**` 的分工**（**不重复实现**）：后者是**内存态窗口几何原语**
  （`generateWalkForwardSplits`，id 前缀 `WFA`），无持久化、无状态机、无冻结、无重跑；
  本域**复用它的切窗函数**（`windowSchedule.ts`），并在其上叠加「身份 / 状态机 / 冻结 / 真实重跑 / 落库」。
  ⇒ 两者**刻意不并入同一个 barrel**（同名导出会静默遮蔽）。
- **域边界**：**不负责**挑参数（参数择优属 Parameter Search）；**不修改**源 Search Run / 结果 / 历史 Backtest / OOS Run；
  **不产出**「最佳 / 推荐 / 最优 Fold」结论，**不做**策略评级，**不自动淘汰**任何 Fold；
  取消只在**下一个 Fold 边界**生效（逐 Fold 串行）。
- 🔴 **`null` ≠ `0`**：可用 Fold 为 0 时六项统计量全 `null`、`availableCount = 0`，**不退化成 0**；
  `INSUFFICIENT_TRADING_ACTIVITY` 是**事实**（既不算成功也不算失败），**不计入**均值 / 中位数。
