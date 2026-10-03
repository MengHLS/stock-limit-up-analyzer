# LEGACY-MAP — 当前 legacy 路径地图

> 建立时间：**2026-10-03**（任务 `CODE-AGENT-INFRA-001`）· 判定方式：**实查当前代码的 import 引用方 + 生产可达性**。
> 🔴 **本任务不删除任何 legacy。** 本文件只建立地图。
> 可达性分级：`在产`（真实生产请求路径）· `研究出口`（研究侧合法入口）· `仅测试`（无生产实例化点）· `零引用`（死代码）。
> 配套：`ARCHITECTURE.md` §10 · `MODULE-MAP.md` · `SYSTEM-BASELINE.md` §11。

---

## 1. Legacy 路径清单

| # | Legacy Path | Current Consumer | Replacement | Migration Status | Risk |
|---|---|---|---|---|---|
| **L-01** | **旧 Research 领域层**（原 `server/researchCore/**` / `researchEngine/**` / `researchPlanner/**`） | **零引用**（目录已不存在） | `server/research/**`（原语） + `server/researchExperiments/**`（独立实验） | ✅ **已完成**（提交 `e79b510` 拆解；barrel 删除） | 中：**文档/记忆仍在指向已删除目录**（见 `ARCHITECTURE.md` §11 BD-11），新 Agent 会按旧路径找不到文件 |
| **L-02** | **旧 Research 数据模型**（旧单数 10 表 + 复数 4 表：`research_experiment(s)` / `research_run(s)` / `research_analysis*` / `research_result` / `research_conclusion` / `research_finding` / `research_question` / `research_plan` / `research_artifact` / `research_hypothesis`） | **零代码引用**（实查：`research_experiments` / `research_experiment_batches` / `archive_research` 在 `server/**` + `client/**` + `shared/**` 零命中） | Run 元数据 → `research_experiment_run`；结果/产物 → `server/artifactStorage/**` | ⚠️ **已归档**（migration `0046_legacy_research_retire.sql`：零行表 `DROP`；有历史行的表 `RENAME` 为 `archive_research_*`，**数据一行不丢**） | 中：`archive_research_*` 若被误接回读路径，会读到「不再写入、不再进入生产计算」的陈旧快照 |
| **L-03** | **B 体系 Dataset**（内容寻址 `rd-1.0.0-1-<sha256>` + `research_datasets` + `rd_rows_<buildKey>` 动态行表） | `server/researchDatasetRouter.ts` → tRPC **`researchDataset`**（`routers.ts` 中仍注册） | A 体系 `server/datasetRegistry/**`（`dataset_version.id` 为坐标） | ❌ **未迁移**（A 权威 / B 并存；桥 `server/runWorkbenchAssembly/datasetFromRegistry.ts` 仅单向 B 消费 A，且**仅支持** `first_limit_pullback`） | **高**：两套坐标极易混用 —— 内容寻址串**不是** `datasetVersionId`；label 不是坐标 |
| **L-04** | **`runBacktestEngine2`**（`server/backtest/engine.ts:56`） | **仅测试**（`tests/server/backtest/{backtest2,corporateActionIntegration}.test.ts`） | `runTradeSimulation`（`server/research/simulator/**`） + `canonicalMetrics` | ❌ 未迁移（**规格 §4 明确要求不删**） | 低：生产不可达；但它是**另一套结果对象形态**（`BacktestResult` vs `BacktestRunResult`），误用会得到不可比的数字 |
| **L-05** | **legacy 逐日模拟器**（`server/realisticBacktest.ts`） | `server/leaderCandidateStrategyBacktest.ts`（**字段映射**，不重跑其执行逻辑） + 研究出口 | `server/research/simulator/**` + `server/backtest/**` | ❌ 未迁移 | **高**：三段不可互换的执行契约并存（`runBacktestWithRisk` / `runTradeSimulation` / `simulateRealisticTPlus1ToTPlus2`）⇒ **同策略换入口得不同数字**（AR-1） |
| **L-06** | **legacy 交易模拟唯一合法出口**（`server/research/legacyTransactionSimulator.ts`，`productionRuntime:false`） | 在产 import：`server/downsideRisk.ts` · `server/overfittingGuard.ts` · `server/leaderCandidates.ts`（均只取 `RESEARCH_LEGACY_SIMULATION_SOURCE` 常量/函数）· `server/paperTrading.ts`（注释对照） | `server/research/simulator/**` | ❌ 未迁移 | 中：`productionRuntime:false` 是**约定**，不是类型/运行时强约束；若被生产路径调用会绕过 Core |
| **L-07** | **`server/strategy/**` legacy 引擎策略**（`StrategyRegistry` + legacy `StrategyContract` + `strategyBacktest.ts`） | **仅测试**（`tests/server/strategy/{strategyBacktest,productionIntegration,registry,leaderCandidateBaseline}.test.ts`；`server/research/strategySchema/goldenSample.ts` 取 registry 做黄金样本） | `server/strategyCore/**` + `research/strategySchema/**` | ❌ 未迁移 | 中：命名混淆（`strategy` vs `strategyCore`）；新策略写进 legacy 路径 = 绕开 Core |
| **L-08** | **`server/engine/**`（Step 2 Core）** | **在产**：`leaderCandidateStrategyBacktest.ts` → `db.getLeaderCandidateBacktest` → tRPC **`sentiment.getLeaderCandidateBacktest`** | `strategyCore` + `simulator` + `canonicalMetrics` | ❌ 未迁移（`runBacktestWithRisk` 是当前生产核心路径） | **高**：`server/engine/**` **完全不执行止损**（AR-3）；止损三落点互不相通（`realisticBacktest` / `paperTrading` / `server/engine`） |
| **L-09** | **`server/engine/adapter.ts`** | **零引用**（实查：全仓 `from ".../engine/adapter"` 零命中） | 无（删除候选） | ❌ 未清理 | 低：死代码；删除需单独低风险任务 + Architecture 分析 |
| **L-10** | **旧 Research 死代码文件**：`server/research/experiment.ts` · `server/research/status.ts` · `server/research/engineAdapter.ts` | **零引用**（实查：`server/**` + `client/**` + `shared/**` + `tests/**` 精确 import 零命中） | 无 | ❌ 未清理 | 低：三个文件是 **UNKNOWN→零引用** 的死代码候选；**删除前须由 Architecture Agent 确认**（不属本任务） |
| **L-11** | **legacy `LeakageGuard`**（`server/research/framework/leakage.ts`，`EPOCH_FLOOR_DATE` 导致**恒通过**） | 仅测试（`tests/server/step11.pitAdversarial.test.ts`） | 数据层 PIT（结构级防线）+ `strategyCore/leakageGuard.ts` | ⚠️ **DEPRECATED（语义失效）** | 中：若被误认为「策略层已防未来函数」会产生虚假安全感 —— 真实安全性全靠数据层 PIT |
| **L-12** | **`DATASET_BUILD_CONFIG_DEFAULTS`**（`shared/datasetRegistryContracts.ts`，已标 `@deprecated`） | 仅测试（`tests/shared/datasetRegistryContracts.test.ts`） | `DATASET_BUILD_CONFIG_LIMITS` + 显式构建配置（口径建版本时固化） | ⚠️ **DEPRECATED** | 低 |
| **L-13** | **`server/backtest/metrics.ts` 第二套口径** | 在产：`server/research/{performanceMetrics,riskAdjustedMetrics,tradeQualityMetrics}/**` 消费 | `canonicalMetrics()`（`backtest/backtestResult.ts`） | ⚠️ **DEPRECATED（待收口）** | **高**：两套 Metrics 口径并存 ⇒ 「A 比 B 好」可能只是口径差（AR-6 / R-06） |
| **L-14** | **B 体系动态行表** `rd_rows_<buildKey>` | `server/researchDataset/{buildKey,rowsTable,partitionedBuilder,persist}.ts` | A 体系 `ds_*` 五表 | ❌ 未迁移 | 中：动态表名机制与 A 体系 `physicalTables` 白名单机制并存，审计口径不同 |
| **L-15** | **legacy Paper Trading 语义**（`server/paperTrading.ts` + `paperTradingScheduler.ts`，经 tRPC `sentiment.*`） | 在产（调度器 + `sentiment` 端点） | `server/research/paperAccount/**` + `server/paperTrading3fTop3Runner/**` | 🔄 **TRANSITION**（两条纸面路径并存） | 中：两条前向纸面路径状态口径不同，前端展示需明确来源 |
| **L-16** | **`factorAblation` / `signalToPnl` 编排引擎**（`server/research/{factorAblation,signalToPnl}/**`） | 仅 `closedLoopWiring/requirements.ts` **声明式**引用 + 测试 | 待接线（闭环 `robustness` / `paper` 阶段） | ⚠️ **CODE_READY 未接线**（`notWired`） | 低-中：闭环如实发 `CL_RUNNER_NOT_INJECTED`；**禁止**改成静默 success 凑绿 |

---

## 2. 重点检查项核实结果（任务 §12 指定）

| 指定项 | 核实结论 | 证据 |
|---|---|---|
| **recipeRegistry** | ✅ **不是 legacy**。`server/research/recipeRegistry.ts` + `recipeRegistryAtoms.ts` 被 5 处生产模块消费（`conditionSignal/compile` · `patternLibrary` · `runWorkbenchAssembly/assemble` · `strategySchema/definition` · `strategyCandidate/definitionBuild`）⇒ `CORE` | `rg -l "recipeRegistry" server` |
| **signalEngine** | ✅ **不是 legacy**。`server/research/signalEngine/**` 为研究侧信号求值，生产 import 存在（`datasetAccess` 消费方）⇒ `ACTIVE` | `rg -l "signalEngine" server` |
| **旧 Runner** | ⚠️ **确为 legacy 且在产** = `server/engine/**`（`runBacktestWithRisk`）。生产可达：`sentiment.getLeaderCandidateBacktest`。见 L-08 | `server/routers.ts:1352` + `server/leaderCandidateStrategyBacktest.ts` |
| **旧 Strategy 执行路径** | ⚠️ **确为 legacy**：`server/strategy/**`（仅测试） + `server/engine/**`（在产）。见 L-07 / L-08 | `rg -l "server/strategy" server` |
| **旧 Research 执行路径** | ✅ **已退役**：`server/researchCore/**` / `researchEngine/**` / `researchPlanner/**` 已删除；旧表已 DROP/RENAME（migration `0046`）。见 L-01 / L-02 | `Test-Path` 三目录 = False；`rg "archive_research"` 在代码中零命中 |

---

## 3. 判定方法与纪律

1. **判定「在产」的唯一依据** = 是否存在从 `server/routers.ts` 出发的**运行时 import 路径**（`import type` 不算可达）。
2. **判定「仅测试」** = `server/**` + `client/**` + `shared/**` 无运行时 import，只有 `tests/**` 引用。
3. **判定「零引用」** = 全仓（含 `tests/**`）精确 import 零命中 ⇒ 死代码候选，但**删除须由 Architecture Agent 确认**。
4. 🔴 **本文件不授权删除任何东西。** 任何 legacy 删除都属于独立任务，必须：Architecture 分析 → Scope 声明 → 测试基线 → 行为验证。
5. 发现新的 legacy 路径 ⇒ 在本表**追加一行**（不改历史行），并同步 `MODULE-MAP.md` 对应 `Status`。
6. 发现本表与代码不一致 ⇒ 标 `BASELINE_DRIFT`，**改文档不改代码**。