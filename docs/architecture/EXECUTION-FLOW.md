# EXECUTION-FLOW — 真实执行链（含可达性与阻塞点）

> Baseline **v1.0.0** · auditedAt **2026-09-19**
> 全部结论来自**实际读代码 + grep 引用方**，未修改任何逻辑。可达性判定分三级：
> `可达` = 生产代码（非测试）真实调用；`仅测试` = 只有 `tests/**` 引用；`死代码` = 零引用。
> 本文件**只做架构登记**，不重新讨论已确认的设计决策。

---

## 1. 主执行链（生产，闭环）

```text
tRPC researchRun.loopRun                      researchRunRouter.ts:467
  ├─ 入参归一 + datasetVersionId 解析          researchRunRouter.ts#primaryDatasetVersionIdOf
  ├─ assembleRunWorkbenchInputs                researchRunRouter.ts:548   (useRealData 分支)
  ├─ createClosedLoopWiring(inputs,{requested}) researchRunRouter.ts:622  (实现 executors.ts:713)
  │     └─ 返回 { stageRunners, artifacts }
  ├─ runClosedLoop(...)                         researchRunRouter.ts:625  (closedLoop/orchestrator.ts)
  │     └─ 逐阶段状态机 → 交接（handoff）       closedLoop/spec.ts + guards.ts
  ├─ 投影 ClosedLoopRunResult                   researchRunRouter.ts:636-696
  ├─ 组装策略 Run Record                        researchRunRouter.ts:705-748
  ├─ 构造 BACKTEST-002 有界载荷                 researchRunRouter.ts:753-794
  └─ persistClosedLoopBacktestRun               researchRunRouter.ts:798  (定义 :276, 重试 ≤3)
```

**14 个阶段 id**（`closedLoop/types.ts:34-49`）：`data, research, strategy, backtest, evaluation, optimization, robustness, oos, overfitting, regime, paper, review, discipline, finalize`

| 阶段 | 装配 | 执行器位置 |
|---|---|---|
| `data` | ✅ | `executors.ts:407` |
| `research` | ✅ | `executors.ts:414`（调 `runCandidateEngine` `signalEngine/engine.ts:126`） |
| `strategy` | ✅ | `executors.ts:460` |
| `backtest` | ✅ | `executors.ts:505`（`case "backtest"` → `:516` `runTradeSimulation`） |
| `evaluation` | ✅ | `executors.ts:522` |
| `optimization` | ✅ | `executors.ts:625` |
| `robustness` | ❌ | — |
| `oos` | ❌ | — |
| `overfitting` | ❌ | — |
| `regime` | ✅ | `executors.ts:681` |
| `paper` | ❌ | — |
| `review` | ❌ | — |
| `discipline` | ❌ | — |
| `finalize` | ✅ | 编排器内置路径（`requirements.ts:175`） |

**未装配语义（FACT）**：`requirements.ts` 对 6 个未装配阶段标 `notWired`；`executors.ts:379` `if (!requirement.wired) continue` ⇒ 该阶段以 **`CL_RUNNER_NOT_INJECTED`** 如实 BLOCKED。
🔴 **不是「失败」，是「如实登记未接线」**——不得改成静默 success。

**已装配 8 / 未装配 6**（实查探针 `docs/evidence/_probe_baseline_state.out.json` 的 `wiringWired` / `wiringNotWired` 与代码一致）。

---

## 2. 决策与撮合子链（backtest 阶段内部）

```text
strategy 阶段产物（strategyDocument / coreVersion）
  └─ runWorkbenchAssembly/assemble.ts
      ├─ coreVersionFromDocument            assemble.ts:697   (strategyCore/production/versionFromDocument.ts:122)
      ├─ createDatasetEventResolver         assemble.ts:725   (strategyCore/production/eventSource.ts:85)
      ├─ createCoreDecisionSource           assemble.ts:735   (strategyCore/production/coreDecision.ts:152)
      └─ strategy13.signalBuilder = coreDecisionSource?.signalBuilder ?? legacySignalBuilder   assemble.ts:752-755
          ↓
      coreDecision.ts:202-209  resolveEvent: config.eventResolver.resolve
          ├─ StrategyRuntime.evaluate(version, parameterSet, context)   runtime.ts#StrategyRuntime.evaluate
          │    ├─ 关卡① 泄漏/Definition 校验   runtime.ts#evaluateWithDetail（auditDefinitionLeakage → assertNoDefinitionLeakage）
          │    ├─ 关卡④ 运行期特征可用性       runtime.ts（LeakageGuard.assertFeatureUsable / assertNoViolations）
          │    └─ eventOccurred → resolveEvent  runtime.ts#evaluateEventOccurrence（未注入 ⇒ 抛 CORE_DEFINITION_INVALID）
          │    ⚠️ runtime.ts 处于高频编辑中 ⇒ **以符号名为准，不引用行号**
          └─ coreDecision.ts:266-271  探针用 resolveQuiet（**不计数**，避免 Run Record 计数 ×2）
          ↓
      首日判定（关键）：今天成立 ∧ 昨天尚未成立  ⇒ 额外求一次「截到昨天」的窗口
          （WINDOW(ANY_DAY) 一旦成立会永久「已成立」⇒ 不能只看 ruleEvaluation.satisfied）
          ↓
      runTradeSimulation(dataset, sourceRun, simConfig)   simulator/engine.ts:250
          ├─ :440 逐日主循环
          ├─ :671 planDecisionDay                            plan.ts:212
          │    └─ :359 applyPositionSizing                   plan.ts:120（模块私有）
          ├─ :684 positionSizing + initialCapital 透传
          ├─ :512 executionModel.quote
          ├─ :575-576 portfolio.buy / sell
          ├─ :598 computeTradeCost
          └─ :444 portfolio.settle()   ← T+1 三态账本每日结算
          ↓
      TradeSimulationRun { equityCurve, trades, auditTrail }
```

**🔴 必须逐决策日调用 `evaluate`**：`WINDOW` 只考虑「当前决策日及之前」的窗口日（更晚的进 `futureSkipped`）⇒ `evaluate(T)` 不读 T+1 是**结构性事实**，不是约定。

**🔴 legacy 与 Core 的语义差异（未抹平，必须知道）**：legacy 门槛型配方**逐日看当天门槛、满足即出信号**（无窗口/触发概念）；Core 按文档声明的 `observationWindow` + `trigger` 判定，`FIRST_VALID_DAY` 只在**首个成立日**出信号。实测（门槛对齐到声明条件）legacy `[2,3]` vs Core `[2]`，**首个有效日一致**。根因 = legacy 执行侧没实现自己文档声明的 trigger。⇒ **历史回测数字不可直接对比**。

---

## 3. 指标 → 评估 → 留档子链

```text
TradeSimulationRun
  ├─ backtestResult.ts:140 analyzeEquityCurve()    逐点日收益/回撤；聚合 maxDrawdown = **正数幅度**
  ├─ backtestResult.ts:230 computeTradeMetrics()   期末未平仓不计胜率/盈亏比（单独 openAtEndCount）
  ├─ backtestResult.ts:392 canonicalMetrics()      ← **唯一指标出口**
  │     ├─ BACKTEST_ANNUALIZATION_DAYS = 252       backtestResult.ts:126
  │     ├─ BACKTEST_ANNUALIZATION_BASIS            :135  {type:"TRADING_DAYS",daysPerYear:252}
  │     └─ 复用 shared/quant-stats#annualizedReturnFromEquityCurve（n = 权益点数 − 1）
  ├─ closedLoop/adapters.ts:134 composeClosedLoopEvaluationRef
  │     ├─ 5 个重叠标量 + completedTradeCount 取 canonical   :140-197
  │     ├─ canonicalMetrics 挂载                            :212
  │     └─ metricsSource = "canonical" | "evaluators"        :213（未接线时如实标 evaluators）
  ├─ executors.ts:584-592 注入 canonical（锚点 = initialCapital ?? equityCurve[0].equity）
  │     └─ 年化基数不一致 ⇒ 抛 CL_WIRING_ANNUALIZATION_BASIS_MISMATCH   executors.ts:565-574
  ├─ backtestResult.ts:519 buildBacktestRunPayload()
  │     └─ equitySamples(≤60) / tradeSamples / truncated / rollingDigest / equityDigest / tradeDigest
  │        + notes + executionMetadata.executionPolicyVersion
  └─ researchRunRouter.ts:276 persistClosedLoopBacktestRun
        ├─ CLOSED_LOOP_PERSIST_ATTEMPTS = 3        :272
        ├─ CLOSED_LOOP_PERSIST_RETRY_DELAY_MS=300  :274  （线性退避）
        ├─ 重试循环 :285-313（首次失败换连接）
        └─ 终态仅 console.warn :314-316（**best-effort，绝不抛**）
```

**🔴 为什么必须重试（BACKTEST-002 抓出的真实缺陷）**：一次真实 Run 计算 593~627 s 期间不碰 DB ⇒ 结束时池中连接已被链路静默重置 ⇒ **单次 `insert` 必然失败**。判据 = 紧随的只读 SELECT 首发也失败、**重试即成功**。
🔴 **不得改成「失败即抛」**——那会把「历史列表少一条」升级成「回测结果丢失」。

---

## 4. BACKTEST-002 已确认事实（**只登记，不修改**）

| # | 事实 | 位置 |
|---|---|---|
| 1 | Execution Policy version = **1** | `backtest/context.ts:48 BACKTEST_EXECUTION_POLICY_VERSION` |
| 2 | 默认政策：T+1 强制 / 拦涨停买 / 拦跌停卖 / 停牌拒单不顺延 / 允许部分成交 / 零成交量 `REJECT` | `context.ts:78-85 DEFAULT_BACKTEST_EXECUTION_POLICY` |
| 3 | Canonical Metrics **唯一实现** | `backtestResult.ts:392 canonicalMetrics()` |
| 4 | `CANONICAL_METRIC_KEYS` = 8 项 | `backtestResult.ts:336-345` |
| 5 | 年化 = **252 交易日/年**（`n = 权益点数 − 1`） | `backtestResult.ts:126` |
| 6 | `maxDrawdownPct` = **正数幅度**；逐点 `drawdownPct` 才是有符号（≤0） | `analyzeEquityCurve` |
| 7 | 收益率算式形式统一 `(end/start − 1) × 100`（**代数等价但浮点不同**） | `canonicalMetrics` |
| 8 | zero-volume policy 默认 `REJECT` | `context.ts:61-67, 84` |
| 9 | `fixed-amount` 全链进 Strategy Schema | R-02（`types`/`validate`/`legacyViews`/`assemble`/前端） |
| 10 | `BacktestRunResult`（新）与 `backtest/types.ts:401 BacktestResult`（legacy）**同域不同形** | `backtestResult.ts:58-64` 注释 |
| 11 | `resultJson.backtest` 与 `resultJson.strategyRun` **并列、互不覆盖** | `researchRunRouter.ts:746 / :774-791` |
| 12 | `equityDigest` / `tradeDigest` 跨进程**逐字节相同**（实测 #1 与 #3 相同） | `backtestResult.ts:529/535 rollingDigest` |
| 13 | 历史 6 条留档跑在 **v0 隐式政策**下，**未回填**（R-05） | — |

---

## 5. 可达性总表（非闭环路径）

| 链 | 入口 | 可达性 | 说明 |
|---|---|---|---|
| legacy 前端回测 | `sentiment.getLeaderCandidateBacktest`（`routers.ts:1346`）→ `server/strategy/strategyBacktest.ts:263` → `server/engine/engine.ts:221 runBacktestWithRisk` → `db.ts:2484` | **可达** | 与闭环链**语义不同** |
| 闭环留档查询 | `researchRun.listBacktests:338` / `getBacktest:354` | **可达** | `BacktestRuns.tsx:121` |
| 指标端点 | `research.metrics.evaluate:279` | **可达** | `PerformanceDashboard.tsx:292` |
| 参数搜索 | `paramSearch.run:701` / `rolling:761` | **可达（技术预览）** | `paramSearchRouter.ts:648` 自述非 RESEARCH_READY 口径 |
| 稳健性 / 随机化 | `paramSearch.robustness:794` / `stochastic:840` | **可达（技术预览）** | — |
| **搜索结果邻域稳定性** | `paramSearch.createRobustnessRun` / `listRobustnessRuns` / `getRobustnessRun` / `startRobustnessRun` / `cancelRobustnessRun` / `getRobustnessResults` | **可达（已持久化）** | 状态机同 PS（CREATED/RUNNING/COMPLETED/FAILED/CANCELLED，**复用唯一权威迁移表**） |
| | | | ⚠️ 执行语义**不重跑**：只读 `parameter_search_*` 冻结结果 → 纯函数分析 → 落三表 |
| WFO / OOS / 过拟合 | `walkForward.run:561` / `oos:605` / `overfit:698` | **可达（技术预览）** | `walkForwardRouter.ts:444` 自述 |
| Regime | `marketRegime.run:266` | **可达** | 闭环 `regime` 阶段亦已装配 |
| 纸面交易（legacy） | `sentiment.createPaperTradingRun` 等 5 端点 + `_core/index.ts:169` 调度 | **可达** | `PaperTrading.tsx` |
| 模拟账户 | `review.paper.run`（`reviewRouter.ts:121`） | **可达** | `ReviewWorkbench.tsx` |
| 交易日志 / 纪律 | `review.journal.*` / `review.discipline.run` | **可达** | `ReviewWorkbench.tsx:147,416` |
| 策略生命周期 | `research.lifecycle.describe:241` / `transition:250` | **可达** | `StrategyAdvancedTools.tsx:182-185` |
| 候选转正 | `research.strategyCandidate.promote` | **可达** | — |
| STEP 6.x 实验/扫描服务 | `evaluationService` / `experimentService` / `runService` / `sweepService` / `status` | **仅测试** | barrel 化但**零生产调用点** |
| `factorAblation` | — | **仅测试** | 同上 |
| `signalToPnl` 编排 | `runSignalToPnlLoop`（`engine.ts:280`） | **仅测试** | 闭环 `paper` 阶段 `notWired` |

---

## 6. 死代码 / 孤儿（FACT，本任务**不删除**）

| 对象 | 位置 | 引用方 | 处置 |
|---|---|---|---|
| `runBacktestEngine2` | `server/backtest/engine.ts:56` | 仅 3 个测试 + barrel 再导出；注释提及 `simulator/engine.ts:19`、`positionIntentAdapter.ts:141` | 保留（BACKTEST-001 规格 §4 要求**不删**） |
| `server/engine/adapter.ts` | 整个文件 | **零引用** | 保留（文件头自述「迁移期兼容层」） |
| `DbExperimentRepository` / `DbResearchRunRepository` / `DbSweepBatchRepository` | `server/research/persistence/db.ts:61/112/191` | 仅测试 | 保留（legacy 链路的一部分） |
| `server/research/index.ts` legacy barrel | `index.ts:1-42` | 被 `researchRouter.ts:46` / `researchRunRouter.ts:32` 间接加载 | 保留；**加载即求值**（隐性成本） |
| `server/engine/adapter.ts` 之外另 3 个同名 `adapter.ts` | `server/research/adapter.ts`（在产）/ `server/strategy/adapter.ts`（在产）/ `server/data/adapter.ts`（barrel） | — | 保留；命名易混淆（文档级风险） |

---

## 7. 执行链上的 OBSERVED（未修，登记为架构风险）

| # | 现象 | 证据 | 影响 |
|---|---|---|---|
| E-1 | 三段**不可互换**的执行契约并存 | `runBacktestWithRisk` / `runTradeSimulation` / `simulateRealisticTPlus1ToTPlus2` | 同策略换入口得不同数字 |
| E-2 | `positionSizing` 曾被静默忽略 | B-02 已修（`plan.ts:120` 真实参与预算）；但 `RANK_WEIGHTED` 与等权同口径（如实降级）、`RISK_BASED` 拒绝 | 参数敏感性已有测试证明 |
| E-3 | `signalTiming` / `executionTiming` / `priceReference` 曾全仓零消费 | B-01 已加 `checkExecutionSemantics()` 响亮抛错 | 不再静默 |
| E-4 | Core 每决策日**二次求值**（「截到昨天」探针） | `production/coreDecision.ts:233-281` | 成本 ≈ ×2 |
| E-5 | 单次真实 Run **657.8 s**；**主因已定位**（`canonical.ts` 44.3% CPU，fingerprint 每求值 2 次）**且已修**（research −52%，digest 不变） | R-06；`_probe_param001_pre_profile.*` / `_probe_param001_stage_bench.{before,after}.*` | **剩余阻塞 = DB 读取 ≈95 s** |
| E-6 | 阈值型出场（TAKE_PROFIT / STOP_LOSS / TIME_EXIT）需「入场价/入场日」运行态引用 | N-03：仍以 `exitRules` 声明保留，未进 `exitRuleGraph` | 未被真正执行 |
| E-7 | **止损三落点互不相通** | `realisticBacktest.ts` / `paperTrading.ts` / `server/engine/**`；`server/engine/**` **完全不执行**止损 | 跨入口止损不可比 |
| E-8 | `/backtest` 并存两套交易语义（快照 = 等权；顶层 = 固定 100 股） | — | **禁加 cap** |
| E-9 | `ALL_DAYS` 在 legacy 侧不可表达 | N-04：适配器一律译 `ANY_DAY` 并写入 notes | 语义损失已登记 |

---

## E-90 PARAMETER-001 增量：参数搜索执行链（2026-09-19 · `9bs`）

基线主链（§1 `researchRun.loopRun` / §2 backtest 内部 / §3 指标→评估→留档）**未改动**。
本节登记**新增的一条并行执行链**：

| 跳 | 落点 | 说明 |
|---|---|---|
| 1 | `paramSearch.createSearch` | 读策略版本包（`DbStrategyRepository#getVersionBundle`）→ 派生搜索空间 → 生成组合 → 落 Run + 组合计划（**不跑回测**） |
| 2 | `paramSearch.startSearch` | 状态迁移 `→ RUNNING`；先把遗留 `RUNNING` 组合收敛为 `FAILED`（不假装还在跑） |
| 3 | `executor#executeParameterSearchRun` | 逐组合：本 Run 已成功 ⇒ **Resume 跳过**；命中五要素 cache ⇒ **复用**；否则评估 |
| 4 | `strategyEvaluation/backtestBridge#createStrategyBacktestBridge` | **按区间缓存数据集**（第 1 个组合付解析代价，其余复用 ⇒ `datasetSource=injected`） |
| 5 | `strategyEvaluation/evaluate#evaluateStrategyParameters` | 既有真实闭环 5 阶段（`data→research→strategy→backtest→evaluation`）；**不自建子链** |
| 6 | `searchResult#projectCanonicalMetrics` | 六项指标**只读数**（canonical 优先，缺省回落 evaluators 面并如实标注） |
| 7 | `persistence#upsertParameterSearchResult` + `recomputeRunCounters` | 落结果行；计数**由结果行重算**（不靠累加） |
| 8 | `paramSearch.getSearchResults` | 服务端排序 / 过滤（只提供能力，**不产出「最佳参数」结论**） |

**取消语义**：每个组合开始前**重读 Run 状态**，`CANCELLED` 即停 ⇒ 剩余组合保持 `PENDING`，再 `start` 即**断点续跑**。

**可达性总表（§5）补充**：
`paramSearch.createSearch` / `listSearches` / `getSearch` / `getSearchResults` = 可达（只读 / 创建）；
`paramSearch.startSearch` / `cancelSearch` / `retrySearchCombination` = 可达（写；真实回测，长请求）。

---

## E-91 OOS-001 增量：样本外验证执行链（2026-09-19 · `9bv`）

基线主链（§1 `researchRun.loopRun` / §2 backtest 内部 / §3 指标→评估→留档）**未改动**，
E-90（参数搜索）也**一行未改**。本节登记**新增的一条并行执行链** —— 它是全仓**唯一**
「消费搜索结果且**必须重跑回测**」的边：

| 跳 | 落点 | 说明 |
|---|---|---|
| 1 | `paramSearch.createOosRun` | **只冻结配置，不执行**：读源 Run / 组合 / 结果 → 复核 `parameterHash` → 窗口隔离 → 落 `oos_validation_run`（`CREATED`）。**接口层没有参数值位置** ⇒ 顺手传「更好的参数」无处可写 |
| 2 | `oosValidation/run.ts#assertOosRunCanExecute` | 🔴 `COMPLETED` ⇒ `OOS_RUN_ALREADY_COMPLETED`（**不允许再次执行**）；`RUNNING` ⇒ `OOS_RUN_ALREADY_RUNNING`。状态迁移走既有 `PARAMETER_SEARCH_RUN_TRANSITIONS` 口径 |
| 3 | `paramSearch.startOosRun` | 状态 `CREATED → RUNNING`；已 `COMPLETED` 时**幂等返回**既有结果（`executed = false`，不重跑不重算） |
| 4 | `oosValidation/gate.ts#assertOosSourceGate` | 源 Run `COMPLETED` ∧ 有组合 ∧ 有结果 ∧ 选中组合读数 `canonical`，否则四条领域码**响亮拒绝** |
| 5 | `strategyEvaluation/backtestBridge#createStrategyBacktestBridge` | **复用唯一权威回测入口**（不自建第二套引擎）；在 **OOS 窗口**上真实执行 |
| 6 | `parameterSearch/searchResult.ts#projectCanonicalMetrics` | OOS 侧指标**必须重算**；IS 侧取 `toResultView` 的**冻结副本** |
| 7 | `oosValidation/comparison.ts#buildOosComparison` | 六项逐项 delta / ratio（IS = 0 ⇒ ratio 为 `null`，**不编数**）+ 三项派生（收益退化 / 回撤变化 / 交易笔数变化）；`comparable = isAvailable ∧ comparableCount > 0` |
| 8 | `persistence#upsertOosValidationResult` + `updateOosValidationRun` | 落结果行 + Run 转 `COMPLETED` |
| 9 | `paramSearch.getOosRun` / `getOosResult` / `listOosRuns` | 服务端只读查询（**不产出「最佳 / 最优 / 推荐」结论**） |

**守卫方向（与 E-90 / ROBUSTNESS-001 相反，这是本链的结构特征）**：
`oosValidation/**` 的 import 集被**必含清单**正向钉死 —— 必须出现 `createStrategyBacktestBridge`
与 `projectCanonicalMetrics`。`searchRobustness/**` 则被**黑名单**钉死不得出现它们。
两条守卫**镜像相反** ⇒ 实现不可互相搬移。

**可达性总表（§5）补充**：
`paramSearch.createOosRun` / `listOosRuns` / `getOosRun` / `getOosResult` = 可达（只读 / 创建）；
`paramSearch.startOosRun` / `cancelOosRun` = 可达（写；**真实重跑回测，长请求**，前端按钮 pending 必须换文案）；
`/parameter-search` 页内 OOS 面板 = 可达（深链 `?oosRunId=` 可自渲染，已量 DOM）。

## E-92 WALK-FORWARD-001 增量：滚动窗口验证执行链（2026-09-19 · `9bw`）

### 链路

```
paramSearchRouter（组合根）
  │  用【既有】PS / OOS application service 实现三个钩子
  ▼
WalkForwardExecutionHooks { readCurrentContext, runFoldSearch, runFoldOos }
  ▼
walkForward/executor.ts   ← 逐 Fold 串行编排（零回测代码、零 HTTP 自调用）
  ├─ Fold i : 校验窗口（leakage） → hooks.runFoldSearch(该 Fold 的 IS 窗口)
  │            → 冻结候选（源组合行 + parameterHash 复核）
  │            → hooks.runFoldOos(紧邻 OOS 窗口, 冻结参数)
  │            → 读 canonical 指标 → 落 walk_forward_fold
  ▼
多 Fold 全部走完 → aggregate（描述性）→ 落 walk_forward_run
```

### 🔴 与 E-90（PARAMETER-001）/ E-91（OOS-001）的并列关系

- E-90 = 参数搜索主链（**写 `parameter_search_*`**）；
- E-91 = 单窗口样本外（**消费 E-90 的产物 + 必须重跑**，写 `oos_validation_*`）；
- **E-92 = 滚动编排（本链）**：**每一折各造一个 E-90 链与一个 E-91 链**，自己只写 `walk_forward_*`。
  ⇒ E-92 **不新建引擎**，而是**把既有两条链按时间轴串起来**；三条链的产物表**互不重叠**。

### 接缝（本链最关键的架构事实）

- 🔴 域层**不得** import 回测 / 评估 / 闭环执行面；**执行只能经由 `hooks`**。
  ⇒ 静态守卫同时钉死「黑名单」与「唯一通路」两件事。
- 🔴 域层**允许** import `oosValidation/types`（只为 `OOS_ENGINE_VERSION` / `OOS_METRICS_VERSION` 两个常量）；
  这是**规格要求的复用**，守卫因此留了后缀级窄豁免并断言豁免面最小。
- 🔴 明禁 `WalkForward → HTTP → OOS API → HTTP → Backtest`：本链**零 HTTP 自调用**。

### 可达性

`paramSearch.createWalkForwardRun` = 可达（写；**只冻结**，不跑回测，秒级）；
`paramSearch.startWalkForwardRun` = 可达（写；**逐 Fold 真实搜索 + 真实样本外，长请求，分钟级**，
前端 `#wf-start-button` pending **必须换文案**为「执行中…（逐 Fold 真实回测，分钟级）」）；
`cancelWalkForwardRun` = 可达（写；**在下一个 Fold 边界生效**）；
`getWalkForwardRun` / `getWalkForwardFold` / `listWalkForwardRuns` = 可达（只读）；
`/parameter-search` 页内 Walk-Forward 面板 = 可达（**深链 `?walkForwardRunId=…&foldIndex=…` 可自渲染，且连 Fold 选中一并还原**，已量 DOM）。

### 幂等与确定性（三层，逐层加严）

1. **同进程**：`COMPLETED` 后重复 `start` ⇒ `executed=false`，Fold 行**逐字节不变**（不重跑不重算）；
2. **跨进程**（本轮新增判据 W15）：**换一个进程**再执行 ⇒ `executed=false`、耗时 **7 s**、**零新增行**；
   且全部读取判据在新进程里**逐条复现一致**（含四条撮合指纹）。
   🔴 二者不可互相替代：若「已完成」的判定依赖内存态，第 1 层会绿、第 2 层会露馅；
3. **创建级**：同冻结配置的副 Run ⇒ `scheduleFingerprint` / fold 坐标一致。
