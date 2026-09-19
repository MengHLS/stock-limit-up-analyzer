# DATA-FLOW — 数据流与坐标传递

> Baseline **v1.0.0** · auditedAt **2026-09-19**
> 每一跳标注：输入 / 输出 / 关键对象 / DB 表 / API / 调用方 / 被调用方。
> 逐字节执行细节见 `EXECUTION-FLOW.md`；契约定义位置见 `CONTRACT-MAP.md`。

---

## 0. 理想链 vs 实际链

**理想链（ROADMAP §8 / §1）**

```text
Source → Dataset → Research → Strategy → Parameter Search
       → Backtest → Evaluation → Robustness/OOS → Simulation → Production
```

**实际链（本基线实查）**——**两个入口，一条主干，多处分叉**：

```text
   ┌─ 入口 A（研究入口，新）───────────────────────────────────────────────┐
   │ 原始 DB（stock_daily_prices / research_securities / …）              │
   │   → datasetRegistry 构建 → dataset_version(READY) + ds_* 五表        │
   │   → runWorkbenchAssembly/datasetFromRegistry 桥 → ResearchDataset    │
   │   → researchCore（10 张单数表）→ 结论 → candidate                    │
   │   → strategyCandidate.promote → strategies/strategy_versions         │
   │   → researchRun.loopRun（闭环 14 阶段，实装 8）                      │
   │       → strategyCore.production 决策 → simulator 撮合                │
   │       → canonicalMetrics → evaluation → closed_loop_backtest_run     │
   └──────────────────────────────────────────────────────────────────────┘

   ┌─ 入口 B（legacy 前端入口，旧）──────────────────────────────────────┐
   │ sentiment.* router → leaderCandidateStrategyBacktest                 │
   │   → server/strategy/strategyBacktest → server/engine runBacktestWithRisk
   │   → backtest_runs（与 A 的 closed_loop_backtest_run 是**不同的表**） │
   └──────────────────────────────────────────────────────────────────────┘
```

🔴 **A 与 B 不可互换**：`closed_loop_backtest_run` 与 `backtest_runs` 是两张不同表、两套口径，**禁互灌**（`drizzle/0037_closed_loop_backtest_run.sql:8-10`）。

---

## 1. `datasetVersionId` —— 全链唯一的运行时权威坐标（FACT）

这是本基线**最重要的一条**：数据集坐标在整条链上有**三种形态**，只有第一种是运行时权威。

| # | 形态 | 类型 | 载体 | 是否权威 |
|---|---|---|---|---|
| 1 | `datasetVersionId` | bigint | `dataset_version.id` | ✅ **运行时唯一权威** |
| 2 | `datasetVersion` | string（label，如 `"v2"`） | 展示/兼容列 | ❌ 仅展示 |
| 3 | `datasetVersion`（内容寻址串，如 `rd-1.0.0-1-<sha256>`） | string | B 体系 `research_datasets` + 策略文档 legacy 字段 | ❌ LEGACY |

**传递路径（逐跳）**

```text
dataset_version.id
  └─(tRPC createDatasetVersion / 构建完成)
     └─ 前端选择 → researchRun.loopRun 入参
        └─ researchRunRouter#primaryDatasetVersionIdOf   ← 唯一解析点
           └─ runWorkbenchAssembly/datasetFromRegistry#buildResearchDatasetFromRegistry
              └─ DbDatasetDataReader（强制 datasetVersionId 下推，唯一合法读层）
                 ├─→ researchCore（research_experiment.datasetVersionId）
                 ├─→ strategy_versions.datasetVersionId（软引用列）
                 │    └─ strategy_version_datasets.datasetVersionId（投影行）
                 ├─→ research_strategy_candidate.sourceDatasetVersionId
                 ├─→ closed_loop_backtest_run.datasetVersionId（+ datasetSource）
                 └─→ StrategyRunSnapshot.datasetReference.datasetVersionId（运行留档）
```

⚠️ **回落重建时 `datasetVersionId = null`**，且**只继承 boards / excludeSt**，**不继承** event / window / tDayCondition ⇒ **口径不同**。`datasetSource` 字段区分 `"registry"` 与 `"rebuild"` 两种来源。

⚠️ **`datasetVersion`（label）不参与任何运行时判定**——把它当坐标会在重建场景下静默取到不同口径的数据集。

---

## 2. 逐跳明细

### 2.1 Source → Dataset

| 项 | 内容 |
|---|---|
| 输入 | `stock_daily_prices`（未复权 raw）+ `research_securities`（identity）+ `research_security_status_history`（PIT ST/停牌）+ `industry_assignments` + `liquidity_daily` + `index_daily`（交易日历唯一来源） |
| 构建配置 | `FirstLimitPullbackBuildConfig`：`datasetVersionId / startDate / endDate / boards / excludeSt / events[{relativeDay,kind}] / preWindowDays / postWindowDays / outcomeHorizons / batchSize` |
| 关键对象 | `DatasetBuilder`（`plugins.ts`）→ `DefaultDatasetBuildRunner`（`runner.ts:141`）→ `DbDatasetBuildIO`（`db.ts:622`） |
| 输出 | `dataset_version` 行（status `READY`）+ 五张 `ds_*` 物理表 + `DatasetVersionCounts`（`totalRows` = **五表行数之和**） |
| DB 表 | `dataset_definition` / `dataset_version` / `dataset_build_job` / `dataset_build_config(+_event,_board)` / `ds_first_limit_pullback_{event,prefix,post,path,outcome}` |
| API | `datasetRegistry.*`（`router.ts:522`，24 个 procedure） |
| 前端 | `/datasets` · `/datasets/:datasetId/versions/:versionId` |
| 特殊口径 | 涨停判定必须用 **四舍五入到分** 的交易所涨停价（`server/data/boardRules.ts#exchangeLimitUpPrice`）；用未四舍五入值会漏判（实测 38.03%） |

### 2.2 Dataset → Research

| 项 | 内容 |
|---|---|
| 桥 | `server/runWorkbenchAssembly/datasetFromRegistry.ts:60 buildResearchDatasetFromRegistry`（被 `assemble.ts:419` 调用） |
| 输入 | `datasetVersionId` + 研究请求 |
| 输出 | `ResearchDataset`（扁平逐日 panel）+ `datasetVersion` / `datasetVersionId` 双写 |
| 限制 | 🔴 桥**只支持** `first_limit_pullback`（`datasetFromRegistry.ts:978` 抛 `REGISTRY_DATASET_CODE_UNSUPPORTED`） |
| DB 表 | 读 `ds_*`；写 `research_experiment`（`datasetVersionId` 为输入边界） |
| 消费方 | `researchEngine/**`（分析引擎）、`researchPlanner/**`（提问式研究） |

### 2.3 Research → Strategy

| 项 | 内容 |
|---|---|
| 转正入口 | `research.strategyCandidate.promote`（`strategyCandidate/router.ts:307`） |
| 中间对象 | `research_conclusion` → `research_strategy_candidate`（13 列，含 `conclusionId` / `sourceDatasetVersionId` / `sourceResearchRunId` / `sourceExperimentId`） |
| 跨域收口 | `strategyCandidate/strategyPromotionPort.ts:10-15` —— **桥内唯一允许 import `strategyPersistence` / `strategySchema` 的文件** |
| 写入 | `strategies` + `strategy_versions`（同事务）+ 5 张投影表 + `strategy_research_provenance` |
| 首版本常量 | `version = "1.0.0"`，`status = Draft`（`definitionBuild.ts:1065-1069`） |
| 状态机硬拒 | 直接改 `CONVERTED` 会被拒 ⇒ `CONVERSION_REQUIRES_PROMOTE`（`service.ts:696`） |
| 校验失败 | `PROMOTE_DEFINITION_INVALID`（`definitionBuild.ts:1087`） |

### 2.4 Strategy → Backtest（执行前）

| 项 | 内容 |
|---|---|
| 装配 | `server/runWorkbenchAssembly/assemble.ts` —— `coreVersionFromDocument`（`:697`）→ `createDatasetEventResolver`（`:725`）→ `createCoreDecisionSource`（`:735`）→ 注入 `strategy13.signalBuilder`（`:752-755`） |
| Core 入口 | `server/strategyCore/production/coreDecision.ts:152 createCoreDecisionSource`（**唯一**调用 `StrategyRuntime` 处） |
| 决策对象 | `StrategyDecision`（`strategyCore/decision.ts:27`） |
| 相对日窗口 | `production/barWindow.ts`（legacy bars → Core 相对日窗口，锚定 `SERIES_START`） |
| 事件源 | `production/eventSource.ts:85 createDatasetEventResolver`（数据集事件源声明 → `EventOccurrenceResolver`） |
| 装配层硬约束 | `checkExecutionSemantics()` 不在支持集 ⇒ 抛 `LOOP_RUN_ASSEMBLY_EXECUTION_SEMANTICS_UNSUPPORTED`；未知 `positionSizing` kind ⇒ 抛 `LOOP_RUN_ASSEMBLY_UNKNOWN_POSITION_SIZING` |

### 2.5 Backtest 内部（决策 → 成交 → 权益）

| 项 | 内容 |
|---|---|
| 编排 | `server/research/simulator/engine.ts:250 runTradeSimulation` |
| 逐日 | `:440` 主循环 → `:671 planDecisionDay`（`plan.ts:212`） |
| 仓位 | `plan.ts:120 applyPositionSizing`（模块私有）+ `runWorkbenchAssembly/assemble.ts:96 mapDeclaredPositionSizing`；一律 `min(...)` **只收窄不放大**；`RISK_BASED` **拒绝** |
| 撮合 | `portfolio.buy:129` / `portfolio.sell:198`（整手 / 去重 / 上限 / 容量 / 现金 / 部分成交裁决） |
| 账本 | `position.ts:61-121` T+1 三态：`quantity / availableQuantity / frozenQuantity` |
| 执行模型 | `execution.ts`：`NEXT_OPEN(104)` / `NEXT_CLOSE(113)` / `VWAP_PROXY(122)` / `LIMIT_PRICE(132)` |
| 拦截 | 涨跌停（`limitState:55`）、停牌拒单不顺延（`suspensionPolicy:"REJECT"`）、**零成交量政策** `zeroVolumePolicy`（默认 `REJECT`，`simulator/engine.ts` T+1 循环统一把关） |
| 成本 | `cost.ts` 四类分解（commission / stampDuty / transferFee / otherFees）+ `engine/execution.ts` 滑点分层（按成交额，只用信号日成交额防未来函数） |
| 输出 | `TradeSimulationRun`：`equityCurve: EquityPoint[]` / `trades: Trade[]` / `AuditTrail` |

### 2.6 → 指标 → 评估 → 留档

| 项 | 内容 |
|---|---|
| canonical | `backtestResult.ts:392 canonicalMetrics()`（`CANONICAL_METRIC_KEYS` 8 项，`:336`）；`analyzeEquityCurve:140` / `computeTradeMetrics:230` |
| 评估参考 | `closedLoop/adapters.ts:134 composeClosedLoopEvaluationRef` —— 5 个重叠标量 + `completedTradeCount` 取 canonical；`metricsSource` 如实标注 |
| 有界载荷 | `backtestResult.ts:519 buildBacktestRunPayload()`（`equitySamples ≤ 60` / `tradeSamples` / `truncated` / `rollingDigest` / `equityDigest` / `tradeDigest`） |
| 落库 | `researchRunRouter.ts:276 persistClosedLoopBacktestRun`（**有界重试 ≤3**，best-effort **不抛**）；`:798` 调用 |
| 表 | `closed_loop_backtest_run`（23 列）；`resultJson` = `{ ...既有, strategyRun, backtest }`（**两段并列，互不覆盖**） |
| 幂等 | 唯一索引 `uq_closed_loop_backtest_run_run(runId)` + `onDuplicateKeyUpdate`（`repository.ts:112-139`） |

---

## 3. 数据格式与版本化对照

| 层 | 格式 | 版本化方式 | 可空 |
|---|---|---|---|
| Dataset | 物理表行 | `dataset_version.version`（label）+ `datasetVersionId`（bigint） | `status` 可为 `DRAFT/BUILDING/READY/FAILED` |
| Dataset 构建配置 | `DatasetBuildConfigRecord`（主表 + 2 子表） | 与 `dataset_version` **1:1 UNIQUE** | — |
| Research | 领域对象 + JSON 列 | `research_run.runNo`（同 experiment 内递增，DB 唯一约束） | `datasetVersionId` **非空**（输入边界） |
| Strategy | `strategyDocumentJson`（唯一 SoT）+ 5 投影表 | semver `version` + 两层指纹（文档级 / 定义级） | `datasetVersionId` 允许 NULL（legacy 内容寻址串路径） |
| Backtest 结果 | `resultJson` 内 `backtest` 段 | `executionMetadata.executionPolicyVersion`（当前 `1`）；`annualizationBasis` | `backtest` 段**可选**（历史留档无此段） |

---

## 4. 数据流上的 OBSERVED（观察到的断点）

| # | 断点 | 证据 | 影响 |
|---|---|---|---|
| 1 | 闭环 6 阶段无执行器 | `closedLoopWiring/requirements.ts:128-169` | `robustness/oos/overfitting/paper/review/discipline` 在闭环内恒 BLOCKED（但各自另有 tRPC 可达） |
| 2 | 搜索结果不落库 | `paramSearchRouter.ts` 全文零写库调用 | 无法回答「这个搜索结果怎么来的」 |
| 3 | 运行级复现快照缺失 | `closed_loop_backtest_run` 无 `parameterSet`/`codeVersion`/`engineVersion`/`seed`/`Universe`/`startedAt` 列；`resultJson` 6/6 行这些键零命中 | 同配置可复现性不完整 |
| 4 | 两套 Metrics 口径并存 | `backtest/metrics.ts:56` vs `backtestResult.ts:392` | 「A 比 B 好」可能只是口径差（8 项重叠量已由测试锁死） |
| 5 | 策略层无独立未来函数防护 | `recipeRegistryAtoms.ts:47` `EPOCH_FLOOR_DATE` 恒置远古日 ⇒ legacy `LeakageGuard` 恒通过 | 安全性全靠数据层 PIT（`datasetAccess/invariants.ts`）；Core 侧守卫**真实生效** |
| 6 | 数据集视界逐决策日不可知 | N-06 | 兼容性报告不做视界校验 |
| 7 | `researchDataset`（B 体系）仍在产 | `routers.ts:316` | 认知混淆；桥仅支持单一 datasetCode |

---

## D-90 PARAMETER-001 增量：参数搜索数据流（2026-09-19 · `9bs`）

```text
StrategyDocument（+ 参数投影 parameterRole）
        │  派生（searchSpace.ts#deriveParameterSearchSpaceFromProjection）
        ▼
ParameterSearchSpaceDefinition（快照，写入即冻结）
        │  Cartesian Product（复用 combinationGenerator#generateParameterCombinations）
        ▼
ParameterCombination[]（含稳定 parameterHash）
        │  落库 parameter_search_combination（计划层 + 执行状态）
        ▼
executeParameterSearchRun
        │  逐组合 → createStrategyBacktestBridge（**按区间缓存数据集**）
        ▼
evaluateStrategyParameters（既有真实闭环 data→research→strategy→backtest→evaluation）
        │
        ▼
ClosedLoopEvaluationRef.canonicalMetrics（唯一读数面）
        │  只读投影（searchResult.ts#projectCanonicalMetrics，**零重算**）
        ▼
parameter_search_result（六指标 + metricsSource + backtestFingerprint + evaluationId）

```text
# ROBUSTNESS-001 —— Parameter Search → Robustness（**新增数据流**）
parameter_search_run（冻结参数空间快照 + FIXED 坐标 + 评估配置指纹）
parameter_search_combination（组合成员 + parameterHash）
parameter_search_result（六指标读数，metricsSource = canonical）
        │  ↓ **只读消费**（Validity Gate：源 Run 必须 COMPLETED ∧ 有结果 ∧ 全部 canonical ∧ 不跨 Run 混行）
        │  ↓ 冻结继承（规格 §9：**不重读当前 Strategy Version**）
        ▼
searchRobustness/analysis.ts#analyzeSearchRobustness（**纯函数**）
        · domainValues：冻结搜索域 → 有序取值序列（决定「相邻」的含义）
        · neighborhood：轴对齐 ±1..±N 步邻域（缺失格 MISSING_COMBINATION，**不补值**）
        · 稳定性（双容差，口径随 Run 持久化）· 敏感性 · 六指标离散度 · 二维稳定性矩阵
        ▼
search_robustness_run / search_robustness_result / search_robustness_parameter_analysis
```

🔴 **本流不产生任何反向边**：稳健性分析**不写** `parameter_search_*`、**不调用** Backtest / 评估端口、**不重算** canonical metrics（源结果全列快照在分析前后逐字节相等，已由真实 E2E 断言）。
🔴 **唯一新增的反向字段**：`parameter_search_run.referenceCheckApplied` / `unreferencedTunableCodesJson`（由 PARAMETER-001/002 的创建路径写入），目的是让稳健性分析能从**冻结快照**继承「参数是否真被策略消费」的结论，而不是回读当前策略版本。

        │
        ▼
getSearchResults（服务端排序 / 过滤）→ 前端
```

**断点修复**：基线 §4「断点 2：搜索结果不落库」**已消除**。

**范围与约束（如实）**：
- `datasetVersionId` 是唯一权威数据集坐标；`datasetVersionLabel` 仅展示（与基线 §1 口径一致）。
- 缓存判据 = 策略版本 + 数据集坐标 + `parameterHash` + 执行政策版本 + 评估配置指纹（**含回测窗口**）。
- `parameter_search_result.backtestRunId` 恒 NULL（评估端口不落 `closed_loop_backtest_run` 行）⇒ 追溯用指纹 + 坐标。

---

# OOS-001 —— Parameter Search → OOS Validation（**新增数据流，且是唯一“必须重跑”的消费边**）

```text
parameter_search_run（COMPLETED）
parameter_search_combination（parameterHash → **冻结候选身份**）
parameter_search_result（六指标冻结副本，metricsSource = canonical ⇒ OOS 的 IS 基线）
        │  ↓ **只读消费 + 身份三重复核**（源 Run COMPLETED ∧ 有结果 ∧ 选中组合的读数 canonical）
        │  ↓ 参数冻结：读源组合行 → **重算 parameterHash 复核** → 冻结成 resolvedParameterSet
        │  ↓ 窗口隔离：oosStart > searchEnd ∧ 不重叠 ∧ 落在绑定数据集可用区间内
        ▼
oos_validation_run（先落库，state = CREATED；**此时还没跑任何回测**）
        │  ↓ 显式 start（**create 与 start 必须分开**：创建便宜、执行昂贵）
        ▼
strategyEvaluation/backtestBridge#createStrategyBacktestBridge（**唯一权威回测入口**）
        → 在 **OOS 窗口**上真实执行（不是复用 IS 结果、不是缩放 IS 结果）
        ▼
projectCanonicalMetrics（**必须重算**，metricsSource = canonical）
        ▼
oos_validation_result（OOS 六指标 + IS 冻结副本 + 六项 delta/ratio + 三项派生对照 + 撮合指纹）
```

🔴 **唯一反向边 = 零**：本流**不写** `parameter_search_*`、**不改**历史 Backtest Run、
**不修改**源 Run 的任何一行（已由真实 E2E 对源三表做**表级 digest** 三次采样、逐字节相等断言）。
🔴 **主判据是撮合指纹差异**（`backtestFingerprint`）：OOS 的指纹与源指纹**不同**才证明「真在不同数据上重跑」——
只看指标差异会误判，因为 `tradeCount = 0` 时两侧指标**天然全相等**。
⚠️ `IS` 侧读数来自 `toResultView` 的**冻结副本**（建库时已要求 canonical），**不是**此刻回读当前策略版本重算的。

# WALK-FORWARD-001 —— Parameter Search × OOS 的**滚动编排**数据流（2026-09-19 · `9bw`）

```
datasetVersionId ──┐
                   ├─→ windowSchedule（交易日序列 → Fold 坐标 + 双重指纹，创建时冻结）
strategyVersion ───┘        │
                            ▼
              ┌── Fold #0 ──┬─ IS 窗口 → parameter_search_run → 候选组合行 → 冻结（parameterHash 复核）
              │             └─ OOS 窗口 + 冻结参数 → oos_validation_run → canonical 指标
              │                        ↓
              │             walk_forward_fold（窗口 / 状态 / 子 Run 身份 / 冻结候选 / 双侧指标 / 撮合指纹）
              ├── Fold #1 ── （同上，**独立搜索、独立 OOS Run，不共享任何候选**）
              ▼
        walk_forward_run（六项冻结坐标 + scheduleJson + aggregateJson 描述性汇总）
```

## 坐标传递

- 🔴 **运行时权威坐标仍是 `datasetVersionId`**；`windowSchedule` 只承载**几何**（哪些交易日属于哪一折）。
- 🔴 **切窗不拉全量 OHLC**：Node 侧只取**交易日序列**（`index_daily`），切窗是**下标运算**；
  真实行情只在服务端既有回测引擎内按窗口取用（规格 §20）。
- 🔴 **六项冻结坐标随 Fold 行一起落库**（不只存在 Run 行上）⇒ 单看一个 Fold 行即可自证「没漂移」。

## 与前两条消费边的区别（**三条边产物表互不重叠**）

| 边 | 输入 | 输出表 | 是否重跑 |
|---|---|---|---|
| ROBUSTNESS-001 | `parameter_search_*` 冻结快照 | `search_robustness_*` | ❌ 零重跑 |
| OOS-001 | 源 Search Run + `parameterHash` + 一个 OOS 窗口 | `oos_validation_*` | ✅ 重跑一次 |
| **WALK-FORWARD-001** | 冻结配置 + 交易日序列（自己派生子窗口） | **`walk_forward_*`** | ✅ **逐 Fold 各重跑一次** |

⚠️ **「真在不同数据上重跑」的主判据是撮合指纹 `backtestFingerprint` 差异，不是指标差异** ——
因为 `tradeCount = 0` 时两侧指标**天然全相等**（本项目实测 Fold#1 的 IS 就是 0 笔）。

⚠️ **禁「先跑整个 Parameter Search 再把结果切成多 OOS Fold」**：每 Fold 必须**独立搜索**
（`WALK_FORWARD_SEARCH_NOT_INDEPENDENT`）；E2E 以「两 Fold 的 `sourceSearchRunId` 互不相同」为判据。
