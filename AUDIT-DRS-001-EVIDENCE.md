# AUDIT-DRS-001-EVIDENCE

> **Dataset + Research + New Strategy 联合架构审计证据文档**
> 性质：**只读、架构级联合审计**（AUDIT ONLY）
> 时间：2026-09-12 GMT+8
> 证据基线：**当前代码 + 真实 TiDB 实查**（不以历史报告作为最终事实）
> 数据库：`DATABASE_URL` 指向的 TiDB Cloud（`DATABASE()` = `VWwjFDE663Dhej4TohVzPQ`，58 张表）
> 实查方法：`information_schema` 结构查询 + 逐表 `COUNT(*)` + 关键行抽样 + 全库 Grep 调用链追踪（探针脚本落在系统临时目录，仓库零改动）

---

## 1. Executive Summary

Dataset 与 Research 都已经**真实可用**（v2 版本 2 年窗口、2.4 万事件、真实跑通 6 类分析并落库 674 条结果）；最新 Strategy Domain Model（STRATEGY-003）**自身完成度很高且纪律严格**（canonical SoT + 单向投影 + 两层指纹 + Look-Ahead 静态校验，7 张表已建、当前 0 行），但它目前是一座**孤岛**：

> **Dataset / Research 用的是「新 Dataset Registry」坐标系（`dataset_version.version` = `v1` / `v2`），而 Strategy 的 Dataset 绑定用的是「旧 researchDataset」坐标系（`rd-1.0.0-1-<sha16>`）——两套标识互不承认。**

这不是「两个模块还没写完」，而是**同一个概念（Dataset 版本）在 Strategy 侧指向了另一套体系**。后果是：Research 用 `v1`/`v2` 做出来的结论，**无法被任何 Strategy Version 合法绑定**（Strategy 绑定校验器 `DATASET_VERSION_FORMAT_RE` 会直接拒收 `"v1"`）。因此 Research → Strategy 的交接**连一个合法的数据坐标都不存在**，更谈不上交接。

**当前真正的唯一断点**：Strategy 与 Dataset Registry 的标识体系未对齐（含零引用完整性、零外键）。它同时阻塞了「Research 结论 → Strategy」的交接与「Strategy → Dataset 取数」的执行。

---

## 2. 审计范围与方法

### 2.1 范围（严格三模块）

```
Dataset   ├── Registry / Definition / Version / Build / Physical Tables / Consumption API
Research  ├── Analysis / Config / Run / Result / Variables / Horizon / Statistics / API / Frontend
New Strategy ├── Strategy / Version / Definition / Parameters / Entry / Exit / Position / Risk /
             │   Execution / Dataset Binding / Version Lifecycle
Legacy Strategy ── 仅作历史兼容/风险审计对象（不重构）
```

### 2.2 方法

| 手段 | 具体做法 |
|---|---|
| 代码取证 | 全库 Grep + 逐文件 Read，所有结论附 `文件:行号` |
| 真实 DB 取证 | `information_schema.tables/columns/statistics/key_column_usage` + 逐表精确 `COUNT(*)` + 关键行抽样 |
| 调用链追踪 | 从前端 tRPC hook → Router → Service → Domain → Repository → 物理表逐跳确认 |
| 反证 | 对「宣称已实现」的能力做**反向查找**（找它的消费方；找不到即记 NOT CONNECTED） |

### 2.3 本次实查的关键数据库事实（一次性列出，后文引用）

```
总表数                                  58
全库外键数（information_schema）         0     ← 整个库一张外键都没有
dataset_definition                       1
dataset_version                          2     （v1=390001 READY / v2=390002 READY）
dataset_build_job                        4
strategies / strategy_versions           0 / 0
strategy_parameters / entry / exit       0 / 0 / 0
strategy_execution_rules / version_datasets  0 / 0
research_experiment                      2
research_run                             8
research_analysis                        19
research_result                          674
research_conclusion                      7
research_hypothesis / candidate / artifact  0 / 0 / 0
research_analysis_template(_item)        0 / 0
research_experiments（遗留复数）          0
research_runs（遗留复数）                 2
research_datasets（遗留复数）             7
```

---

## 3. 先识别四套东西（对应 §3）

| 模块 | 当前状态 | 是否权威 | 后续定位 |
|---|---|---|---|
| **Dataset** | **可用（DATA_READY）**：Registry 三实体 + 5 张物理表 + keyset 读取 API + 生命周期（取消=回滚 / 重建=从零 / 孤儿回收）全部真实落地并跑通；v1/v2 均 READY | **是**（Dataset 唯一权威） | 冻结为研究数据源，**不再开发**（用户已明确「Dataset 当前已经可以使用」） |
| **Research** | **可用（探索性研究闭环真实跑通）**：`researchCore` 10 表 + `researchEngine` 6 类分析 + 30 个 tRPC 端点 + 前端工作台；真实数据端到端产出 674 条结果 / 7 条结论 | **是**（探索性研究唯一权威） | 当前主战场；缺「策略研究」层（见 §5.4） |
| **New Strategy** | **模型完整、链路成孤岛**：`server/research/strategySchema` + `strategyPersistence` + 7 张表（0 行）+ 11 个 tRPC 端点（v1 兼容面）；STRATEGY-003 的新能力**未暴露**；Dataset 绑定指向**旧体系** | **是**（Strategy 唯一权威 SoT） | 需要「接入现有数据坐标系」，**不得推翻 STRATEGY-003** |
| **Legacy Strategy** | **仍在生产路径上 ACTIVE**：`server/strategy/`（1 个策略 + 注册表 + adapter）、`paramSearch` / `walkForward` / `leaderCandidates` 全部注册在 appRouter 且有前端页面 | **否**（仅历史兼容 + 现有页面支撑） | **保持现状、不重构、不迁入**；新模型不得被它污染 |

**红线**：New Strategy ≠ Legacy Strategy。本报告所有「Strategy」默认指 **STRATEGY-003 新模型**，Legacy 一律显式标注。

---

## 4. Dataset 当前能力（对应 §4）

### 4.1 真实能力清单（全部有代码坐标）

| 能力 | 真实实现 | 入口 / 证据 |
|---|---|---|
| Dataset Definition CRUD | ✅ | `datasetRegistry/registry.ts:455/522/532/1029`；tRPC `datasetRegistry/router.ts:181-248`（写端点 admin） |
| Dataset Version | ✅ 创建 / 列出 / 读取 / 删除 / 状态 | `registry.ts:539/570`（建）、`:987`（删）、`:655/663/676`（状态）；tRPC `router.ts:251-316` |
| Dataset Build Job | ✅ 创建 / 启动 / 进度落库 / 取消 / 重试 / 孤儿回收 | `registry.ts:687/716/918/747/953/872`；tRPC `router.ts:319-432` |
| Dataset Build | ✅ 真实执行器（events + windows 两阶段） | `builder.ts:320`；`runner.ts:104` |
| Dataset 物理表读取 | ✅ 5 层 reader + 分页 + 批量 + 范围 | `query.ts:336-353`（`DatasetDataReader`）、`:655/689/718/748/779/797/815/843` |
| Dataset 查询 API（用户可见） | ✅ keyset 分页 5 端点 | `router.ts:444-517`（listEvents/listPaths/listPrefix/listPost/listOutcomes，`limit ≤ 200`） |
| Dataset Preview | ⚠️ **新 router 无 preview 端点**；前端由 5 个 keyset 端点拼装 | `client/src/components/datasetRegistry/DatasetPreviewTable.tsx:103-115`；旧体系另有 `researchDatasetRouter.ts:102` |
| Dataset 状态机 | ✅ `DRAFT/BUILDING/READY/FAILED` + 合法转换断言 | `lifecycle.ts:94/107/115-139`；`types.ts:43` |
| Version 生命周期 | ✅ 取消=回滚（清数据保留表结构）、重建=从零（build 前 purge）、孤儿回收（启动钩子） | `registry.ts:815`、`runner.ts:243-254`、`registry.ts:872` + `_core/index.ts:179` |

**实查证据（真实 TiDB）**

```
dataset_definition : 1 行（datasetCode=first_limit_pullback，datasetType=EVENT，
                     featureTableName = NULL  ← 声明了但空）
dataset_version    : 2 行
  390001  v1  READY  1,130 事件 / 60,002 行  窗口 2026-07-31→2026-08-30
  390002  v2  READY 23,978 事件 / 1,543,082 行 窗口 2024-08-31→2026-08-31
dataset_build_job  : 4 行
  450001 v1 COMPLETED
  450002 v2 CANCELLED（cancelled by user）
  540001 v2 CANCELLED（orphan reclaimed：停更 55 分钟无进度更新）   ← 孤儿回收真实生效
  630008 v2 COMPLETED（24462 chunks）
```

五层行数（实查，按版本）：

| datasetVersionId | event | prefix | post | path | outcome |
|---|---|---|---|---|---|
| 390001（v1） | 1,130 | 23,730 | 15,876 | 15,876 | 3,390 |
| 390002（v2） | 23,978 | 503,538 | 471,816 | 471,816 | 71,934 |

`v1: 1130+23730+15876+15876+3390 = 60,002` ✅ 与 `totalRows` 逐字相符
`v2: 23978+503538+471816+471816+71934 = 1,543,082` ✅ 与 `totalRows` 逐字相符

### 4.2 五层语义与代码一致（对应 §4.2）

| 层 | 代码定义 | 相对日 | 真实列 |
|---|---|---|---|
| `event` | `types.ts:90-110`、DDL `plugins.ts:104-128` | 时点（无 OHLCV） | eventId, symbol, tradeDate, market, industryCode, boardType, previousClose, limitUpPrice, turnover, isFirstLimit, previousLimitDate, daysSincePreviousLimit, historicalLimitCount, marketCap, floatMarketCap |
| `prefix` | `types.ts:116-129` | **rd ∈ [-20, 0]**（实查前缀 min=-20 max=0） | relativeDay, open, high, low, close, volume, amount |
| `post` | 同构 | **rd ∈ [1, 20]** | 同上 |
| `path` | `types.ts:143-157`、`path.ts:184-196` | **rd ∈ [1, 20]**（实查） | highFromEventClose, lowFromEventClose, closeFromEventClose, pullbackFromEventHigh, volumeRatio, isBreakout, breakoutPrice, daysToBreakout |
| `outcome` | `types.ts:160-169`、`path.ts:207-240` | **horizon ∈ {5, 10, 20}**（实查） | maxReturn, minReturn, maxDrawdown, isBreakout, daysToBreakout |

### 4.3 feature / target 划分（对应 §4.2）

- **Dataset 层没有 feature / target 语义**。`eventTableName`…`outcomeTableName` 已落地 5 张；`featureTableName` / `featureVersion`（`dataset_definition.featureTableName` = **NULL** 实查；`types.ts:33,50`）**只声明未实现**（`plugins.ts:220-226` 只注册 5 张表）。
- 划分**全部由 Research 变量层承担**：`researchEngine/variables.ts:67` `FeatureVariableDefinition(role:"FEATURE")`、`:79` `OutcomeVariableDefinition(role:"OUTCOME")`；目录 `:876 listFeatures` / `:888 listOutcomes`；用反即抛 `VARIABLE_ROLE_VIOLATION`（`:896,913`）。
- 因此：
  - **feature** = Research 的 FEATURE 变量（读 `event` / `prefix`）
  - **target** = Research 的 OUTCOME 变量（读 `path` / `outcome`）
  - **未来信息** = `post` / `path` / `outcome`（Dataset 明示「前视，仅打标签」）

### 4.4 Dataset → Research 的消费边界（对应 §4.2 第 5 问）

**存在且唯一**：

```
researchEngineRouter.ts:432 runEngine
  → engine.ts（ResearchEngine）
  → sampleSet.ts:153 buildSampleSet
  → datasetReader.ts:97 RegistryResearchDatasetReader
       loadEventPage/loadPrefixBars/loadPaths/loadOutcomes（datasetReader.ts:129/160/151/142）
  → query.ts DbDatasetDataReader → drizzle 表对象（query.ts:42-47）→ ds_* 物理表
  + registryRepo 读 dataset_version / dataset_definition 取上下文（datasetReader.ts:106-127）
```

契约接口 `ResearchDatasetReader`（`datasetReader.ts:73-84`）**强制 `datasetVersionId` 下推**，是「稳定消费边界」的真实载体。

**如实说明两点**：
1. Research **直接读 `ds_*` 物理表**（经唯一 reader 封装）；Dataset Registry 在此链路上**只提供元数据与版本状态**，不代理数据读取。
2. 生产逻辑**没有裸字符串表名 SQL**；表名绑定集中在 `drizzle/schema.ts:1272/1309/1335/1367/1397`（`mysqlTable("ds_first_limit_pullback_*")`）。

### 4.5 新旧 Dataset API 并行（对应 §7 第 8 问）

**是的，两套并存且都在 appRouter 上**（`routers.ts:283` vs `:286`）：

| | 新 | 旧 |
|---|---|---|
| 路由 | `datasetRegistry`（`routers.ts:286`） | `researchDataset`（`routers.ts:283`） |
| 表 | `dataset_definition` / `dataset_version` / `dataset_build_job` / `ds_*` | `research_datasets` / `rd_rows_*` |
| 版本标识 | **`v1` / `v2`**（`DATASET_VERSION_LABEL_PATTERN`，`shared/datasetRegistryContracts.ts:61`） | **`rd-1.0.0-1-<sha16>`**（`researchDataset/version.ts:43`） |
| 真实数据 | 2 版本 / 5 层齐备 | 7 行 dataset + 2 张 `rd_rows_*` 行表（实查） |
| 被谁消费 | Research Engine（`researchEngineRouter.ts:785`）、Dataset 页面 | `server/research/datasetAccess`（framework 链）、**Strategy 编辑器**（见 §12） |

> 🔴 **这是本次审计最重要的前置事实：两套 Dataset 版本标识体系同时存在，而 Strategy 站在旧的一边。**

### 4.6 Dataset 结论：是否需要继续开发？

**NO（作为 Research 数据源）。** 理由：v2 五层齐备、2.4 万事件、2 年窗口、真实跑通 6 类分析；取消/重建/孤儿回收等生命周期能力已落地并有真实证据（job 540001 被自动回收）。

**但必须登记三个数据可用性缺口（属数据广度，不阻塞当前链路）**——实查 v2：

```
marketCap        NULL 23,978 / 23,978  = 100%     ← 市值特征不可用
floatMarketCap   NULL 23,978 / 23,978  = 100%     ← 流通盘特征不可用
industryCode     NULL 23,858 / 23,978  = 99.47%   ← 行业维度不可用
boardType        distinct = 1（全部 'main'）      ← 板块维度退化为单值
market           distinct = 2
tradeDate 年份   2024 / 2025 / 2026 (5,078 / 10,309 / 8,591)  ← 年度维度可用
```

---

## 5. Research 当前能力（对应 §5 / §6）

### 5.1 功能清单（真实存在）

#### Analysis（CRUD / Config / Status）

| 能力 | 端点 | 位置 |
|---|---|---|
| List | `listAnalyses`（public） | `researchEngineRouter.ts:567-576` |
| Create | `createAnalysis`（admin）/ `createAnalyses`（admin 批量） | `:493-536` / `:552-565`、`batchCreate.ts:130` |
| Update | `updateAnalysis`（admin，可改 name/target/config/status，**`runId` 不可改**） | `:605-629`、`contract.ts:63-65` |
| Delete | `deleteAnalysis`（admin） | `:632-641`、`maintenance.ts:225` |
| Configuration | `setAnalysisConditions`（admin） | `:650-663`、`maintenance.ts:428` |
| Status | Run/Analysis 状态列 | `:604-628` |

⚠️ **口径缺口（如实登记，不修改）**：`updateAnalysis` 改 `config` **不失效旧结果**（无 `invalidate` 调用）；只有 `setAnalysisConditions` 会「删旧结果 + 删失效结论 + 回退 `PENDING`」（`maintenance.ts:392-420,428-453`）。⇒ 改 config 后 UI 仍会展示旧口径算出的数字。

#### Variables（变量系统，`researchEngine/variables.ts`）

| 类别 | 支持情况 | 证据 |
|---|---|---|
| Feature Variable | ✅ 4 族：事件静态量（turnover/previous_close/limit_up_price/limit_up_premium/days_since_previous_limit/historical_limit_count/market_cap/float_market_cap）、prefix 价格量（pre_close/pre_return_5d·20d/pre_volatility_20d/pre_volume_ratio_5d·20d）、事件日形态（event_low_offset/event_open_offset/is_one_word_open/is_one_word_hold） | `:146-328`、导出 `:331` |
| Target Variable | ✅ 4 族：path 族（future_return/high_return/low_return/volume_ratio/pullback_from_event_high）、outcome 聚合族（max_return/min_return/max_drawdown）、flag 族（is_breakout/days_to_breakout）、事件日最低价守护族（holds_event_low_*/event_low_margin_*）、分段族（segment_{stat}_{a}_{b}d，按需构造**不进目录**） | `:340-508`、`:538-632`、`:664,735-803` |
| Horizon | ✅ 来自 Dataset 真实值：path 1..20、outcome {5,10,20}；**多视界仅 EVENT_STUDY 支持**（`eventStudy.ts:106` 遍历 `config.horizons`），其余编码在变量名里 | `engine.ts:629-634`、`variables.ts:436`、`eventStudy.ts:48-49` |
| Descriptive Statistics Variable | ✅ 19 个指标码 + 实现；且 `DESCRIPTIVE` 支持 `variables[]` **多变量** | `descriptive.ts:25-45`、`metrics.ts:100-253`、`descriptive.ts:55-72` |
| Category / Group | ✅ QUANTILE 分组（`quantile.ts:46-58`） | — |
| Filter / Condition | ✅ 条件组结构（`conditions.ts:44-55`）、运算符（`types.ts:151-183`）、组号**唯一且连续 `0..n-1`**（`conditions.ts:160-184`）、字段白名单 = 特征∪结果∪7 维度键（`engine.ts:754-770`）、求值语义（`conditionEvaluator.ts:97-133`，空集恒真） | — |
| 多变量 | ⚠️ **仅 DESCRIPTIVE** 支持多变量；其余单 target / 单 feature | `descriptive.ts:55-63,68-72` |
| 多 Horizon | ⚠️ **仅 EVENT_STUDY**；其余单 horizon | `eventStudy.ts:106` |
| PIT 保护 | ✅ 三重：`FeatureSources`/`OutcomeSources` **类型互斥**（`variables.ts:36-61`）+ 具名拒绝 `VARIABLE_ROLE_VIOLATION`（`:896-943`）+ 运行期角色断言（`sampleSet.ts:169-170,272-276`）；另有列投影守卫 `PROJECTION_MISSING_COLUMN`（`types.ts:233-241`） | — |

#### Execution

| 能力 | 真实情况 | 证据 |
|---|---|---|
| Analysis Run | ✅ `createRun`（admin）**只创建、不执行** | `researchEngineRouter.ts:379-398` |
| Run Status | ✅ PENDING/RUNNING/COMPLETED/FAILED/CANCELLED | `engine.ts:191-196` |
| Run Input Snapshot | ✅ **有**，且实现比声明多字段 | `engine.ts:258-269`（写入）；声明 `config.ts:130-146` |
| Dataset Binding | ⚠️ **`research_run` 表没有 `datasetVersionId` 列**（实查 `information_schema`）；绑定经 `research_experiment.datasetVersionId` + 快照 | `schema.ts:1497-1531`、`engine.ts:201` |
| Execution Engine | ✅ `researchEngine/engine.ts`，`run()` 与 `runIncremental()` **共用 4 个核心** | `engine.ts` |
| Result Persistence | ✅ `resetExistingResults` = 先 `deleteByAnalysis` 再 `createMany`（幂等） | `engine.ts:711-714`、`db.ts:878` |
| Failure Handling | ✅ Run FAILED + errorCode/errorMessage；单分析失败 → `ANALYSIS_FAILED` | `engine.ts:358-391`、`:729-748` |
| Retry | ⚠️ 只读重试 3 次（`readRetry.ts:100-119`，**不是任务重试**）；重跑仅允许 `PENDING|FAILED|CANCELLED` | `engine.ts:191-196` |
| Idempotency | ✅ Run `(experimentId, runNo)` DB 唯一 | `schema.ts:1527` |
| 后台 worker | 🔴 **不存在**。服务端无任何 cron/worker 消费 `PENDING` Run ⇒ 空 Run 永不自动出结果；必须人工点「运行引擎」/「补跑」 | `docs/research/LAYER_CONVENTIONS.md:59` + 全库搜索无 Research 命中 |
| 增量补跑 | ✅ `runIncremental`：复用冻结快照基准、断言 `DATASET_VERSION_DRIFT`、**不生成结论**、追加 `executionLogJson` | `engine.ts:410-622`、`:452-463`、`:96-100`、`:499-509` |
| Run 孤儿回收 | 🔴 **缺失**（dataset 侧有、research 侧没有）。实查已产生一次真实事故：Run `330003` 被 dev 热重启杀死后永久 `RUNNING`，**2026-09-12 15:37 人工收敛**为 `FAILED / RUN_ORPHANED` | `research_run.id=330003` 实查 |

**实查 Run 快照内容（`inputSnapshotJson` 真实键）**：

```
datasetVersionId, datasetCode, datasetVersionLabel, runConfig,
researchType, variables, analysisTypes, snapshotAt
例：run 390001 → { datasetVersionId: 390002, datasetCode: "first_limit_pullback",
                  datasetVersionLabel: "v2", snapshotAt: "2026-09-12T07:36:45.066Z" }
```

⇒ **Research 侧对 Dataset 版本的可追溯性是真实且具体的**（bigint id + registry label + 冻结时间）。

### 5.2 已实现的分析类型（6 种）

| analysisType | 研究问题 | 执行器 |
|---|---|---|
| `DESCRIPTIVE` | 变量的分布 / 缺失 | `analyses/descriptive.ts` |
| `EVENT_STUDY` | 各 horizon 收益 / MFE / MAE / 突破 | `analyses/eventStudy.ts` |
| `QUANTILE` | 特征分位 → 结果差 | `analyses/quantile.ts` |
| `CONDITIONAL` | 条件组 vs 全样本 | `analyses/conditional.ts` |
| `STABILITY` | 跨维度稳定性 | `analyses/stability.ts` |
| `SEGMENT_RELATION` | 两窗关系（配对相关） | `analyses/segmentRelation.ts` |

未实现类型（`analysisConfig.ts:163-170` 抛 `UNKNOWN_ANALYSIS_TYPE`）：`DISTRIBUTION` / `IC` / `CORRELATION` / `PATH` / `REGIME` / `SIGNIFICANCE`。

### 5.3 前端与端点规模

- `researchEngine` tRPC 端点 **30 个**（实查枚举：listVariables / createExperiment / listExperiments / getExperiment / updateExperiment / deleteExperiment / createHypothesis / updateHypothesis / deleteHypothesis / createRun / listRuns / getRun / deleteRun / runEngine / runIncremental / createAnalysis / createAnalyses / listAnalyses / getAnalysis / getAnalysisResults / updateAnalysis / deleteAnalysis / setAnalysisConditions / listConclusions / listCandidates / getConclusionPolicy / listAnalysisTemplates / createAnalysisTemplate / deleteAnalysisTemplate / applyAnalysisTemplate）。
- `researchRun` 端点 3 个：`list` / `readiness` / `loopRun`。
- `research.strategy` 端点 11 个（见 §6.4）。
- 前端页面：`/research`、`/research/:experimentId`；组件 `CreateExperimentDialog` / `CreateAnalysisDialog` / `BatchAnalysisDialog` / `RunEngineButton` / `RunIncrementalButton` / `AnalysisResultsView` / `ConclusionPanel` / `ConditionGroupsEditor` / `AnalysisConditionEditor` / `ExperimentActions` 等。

### 5.4 八个研究问题的逐条判定（对应 §6）

| # | 研究问题 | 判定 | 依据 |
|---|---|---|---|
| A | 某个变量的分布是什么？ | **SUPPORTED** | `DESCRIPTIVE` + 19 指标码 + 多变量（`descriptive.ts:25-72`） |
| B | 某个变量和未来收益有什么关系？ | **SUPPORTED** | `QUANTILE`（特征分位 → 结果差）+ `EVENT_STUDY`（`quantile.ts` / `eventStudy.ts`） |
| C | 不同变量区间下收益是否不同？ | **SUPPORTED** | `QUANTILE` 分档；实证已产出（如 `分位分析：turnover 分 10 组 → future_return_5d`，53 行结果） |
| D | 不同 Horizon 下结果是否不同？ | **PARTIAL** | 仅 `EVENT_STUDY` 支持多 horizon（1/3/5/10/15/20 实证已跑）；`QUANTILE`/`CONDITIONAL` 单 horizon（编码在变量名里，需建多条分析） |
| E | 多个条件同时成立时结果如何？ | **SUPPORTED** | `CONDITIONAL` + 条件组（组内 `logicalOperator`、组间 `groupLogicalOperator`）+ 组号连续校验（`conditions.ts:160-184`） |
| F | 不同时间区间是否稳定？ | **SUPPORTED** | `STABILITY` 的 year / month / quarter 维度；**实证可用**：v2 跨 2024/2025/2026 三年（5,078 / 10,309 / 8,591） |
| G | 不同市场状态是否稳定？ | **NOT_SUPPORTED**（regime）／**PARTIAL**（其余维度） | 🔴 `regime` **被显式标为不可用**：`researchEngineRouter.ts:210-211` `unavailableDimensions: [{ key: "regime", reason: "当前 Dataset 未提供市场环境列，且未接入 RegimeTagProvider" }]`；`industry` 不可用（99.47% NULL）；`board` 退化（distinct=1）；`market` / `year` 可用 |
| H | 某个 Strategy Version 的规则是否有效？ | **NOT_SUPPORTED** | 研究链路对 `strategyId` / `strategyVersionId` **零引用**（见 §9）；`StrategyDefinition` 不作为任何分析的输入；无「策略规则 → 研究」的求值路径 |

**§11 两层次判定**

| 层次 | 内容 | 现状 |
|---|---|---|
| **A. Exploratory Research**（Dataset→Feature→Target→Horizon→Statistics） | 从数据中发现规律 | **基本完备（~85%）**：6 类分析、变量目录、条件/分组、稳定性、PIT 三重防线、增量补跑、结果落库、前端工作台。缺：regime/行业/市值/板块维度、多 horizon 仅 EVENT_STUDY、无 IC/RankIC |
| **B. Strategy Research**（Dataset + Strategy Version → Entry/Exit/Position/Risk/Execution → Research） | 验证已定义好的交易规则 | **NOT SUPPORTED（0%）**：Strategy Version 完全不是 Research 的输入 |

---

## 6. New Strategy Domain Model 当前能力（对应 §8）

> 前置：STRATEGY-003 已完成（`docs/strategy/STRATEGY-003-report.md`）。本节**以代码 + 真实 DB 重新独立确认**，不采信报告结论。

### 6.1 Canonical SoT 与投影方向 ✅ 成立

- `strategy_versions.strategyDocumentJson` 是唯一 canonical 完整 `StrategyDefinition`：`strategyPersistence/contract.ts:11-15`、`drizzle/schema.ts:576-583`、`drizzle/0034_strategy_domain_model.sql:6-15`。
- 写入严格 `Canonical → Projection`：`db.ts:224-227` 由 `document.definition` 调 `buildStrategyProjections`，**同一事务**落库（`db.ts:231-252`）。
- 投影模块明示禁止反向：`projection.ts:4-10`；读取投影仅服务查询/漂移比对（`db.ts:345-346`、`service.ts:327-332`）。
- ✅ **未发现任何「DB 投影 → 反向拼回 Definition」的路径**。

### 6.2 StrategyDefinition 结构 ✅ 与约定一致

`definition.ts:534-543`：`schemaVersion / entry / exit / position / risk / execution / parameters / datasets`

| 子结构 | 位置 |
|---|---|
| `entry`（event / observationWindow / trigger / conditions） | `definition.ts:413-418` |
| `exit`（rules[]） | `:439-441` |
| `position`（sizingMethod / parameter / positionRatio / fixedAmount / maxPositions / maxExposure / maxSinglePosition） | `:444-458` |
| `risk`（maxPositions / maxExposure / maxSinglePosition / stopLoss） | `:464-481` |
| `execution` | `:484-494` |
| `parameters[]` | `:497-517` |
| `datasets[]` | `:520-526` |

**`signalTiming` / `executionTiming` 已明确分离**：
- `signalTiming` 枚举 `T_OPEN | T_CLOSE`（`definition.ts:138`）
- `executionTiming` 枚举 `T_CLOSE | T_PLUS_1_OPEN | T_PLUS_1_CLOSE | T_PLUS_2_OPEN`（`definition.ts:142-147`）
- 分离由 Look-Ahead 校验 L6/L7/L8 强制（`definitionValidation.ts:703-740`）

### 6.3 Parameter 三角色 ✅ 真实进入领域模型

- `STRATEGY_PARAMETER_ROLES = FIXED | TUNABLE | DERIVED`（`definition.ts:163-164`），字段 `parameterRole`（`definition.ts:502`）。
- **TUNABLE 强制搜索边界**：数值参数须同时有 `min` + `max`（`definitionValidation.ts:343-353`，code `..._TUNABLE_RANGE`）；非数值须非空 `allowedValues`（`:354-360`）；`step` 另有独立校验（`:371-375`）。
- **DERIVED 必填 `derivedFrom`**（`definition.ts:515-516`；校验 `definitionValidation.ts:361-368`）。
- 投影落库：`strategy_parameters.minValue / maxValue / stepValue / parameterRole / ordinal`（实查列存在）。
- ⇒ **Strategy 已具备被后续 Parameter Search 消费的结构**（本轮不实现搜索，仅确认结构）。

### 6.4 Dataset Binding 🔴 **完成度最低、且指向错误体系**

**字段**（`definition.ts:520-526`）：`datasetId / datasetVersion / role(PRIMARY|VALIDATION|OOS) / note`

**校验（`definitionValidation.ts:750-782`）**：
- `datasetId` 非空字符串 ✅
- `datasetVersion` 必须过 `isValidDatasetVersionFormat(...)`（`:759-765`）
- `role` 白名单 + PRIMARY 唯一 + 绑定去重 ✅
- 🔴 **没有任何「dataset_version 真实存在」的校验**——不查 datasetRegistry、不校验 datasetId 与版本归属、**无外键**（`0034...sql:181-196` 仅 UNIQUE）。

**决定性证据（这是本次审计的核心发现）**：

```ts
// server/research/experimentLineage/validate.ts:51-58
export const DATASET_VERSION_FORMAT_RE = /^rd-\d+\.\d+\.\d+-\d+-[0-9a-f]{16}$/;
export function isValidDatasetVersionFormat(value: string): boolean {
  return DATASET_VERSION_FORMAT_RE.test(value);
}
// 同文件的测试明确锁定该语义（experimentLineage.test.ts:245）：
expect(isValidDatasetVersionFormat("v1")).toBe(false);
```

而 **真实 Dataset Registry 的版本标签是 `v1` / `v2`**：
- 实查 `dataset_version.version` = `v1`（id 390001）、`v2`（id 390002）
- 合法模式 `DATASET_VERSION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/`（`shared/datasetRegistryContracts.ts:61`）

⇒ 🔴 **`StrategyDatasetBinding.datasetVersion` 无法表达 `v1` / `v2`；能表达的是旧 `researchDataset` 的 `rd-…` 版本**。而 STRATEGY-003 的 golden sample 也印证了这一点：`goldenSample.ts:31` `FIRST_BOARD_PULLBACK_DATASET_VERSION = "rd-1.0.0-1-cffc2a0e66efbf0b"` —— 该字符串**在真实库中并不存在**（真实 `research_datasets` 的 7 个版本见 §8）。

**同一概念的第二份定义**：`strategy_versions.datasetVersion varchar(96) NOT NULL`（v1 遗留单值列，**实查存在**）与 `strategy_version_datasets` 表（新多值绑定）并存。

### 6.5 新能力的暴露面（真实）

`research.strategy.*`（`researchRouter.ts:82-154`，注册于 `routers.ts:284`）**11 个端点，全部 `publicProcedure`**：
`validate` / `bump` / `compare` / `create` / `save` / `load` / `list` / `delete` / `createVersion` / `loadVersion` / `listVersions`

- 真实落库：`strategyService = new StrategyService(new DbStrategyRepository(), ...)`（`researchRouter.ts:68`）→ `strategies` / `strategy_versions`。
- 🔴 **STRATEGY-003 新增能力未暴露**：`cloneVersion` / `loadBundle` / `validateVersion` / `setVersionStatus` / `getVersionBundle`（`service.ts:209/258/306/320/345`）**仅被测试与 `scripts/verifyStrategyDomainModel.mts` 调用**，未接入任何 router。
- 🔴 **权限口径不一致**：Strategy 全部端点 `publicProcedure`，而 Dataset/Research 的写端点一律 `adminProcedure`。

### 6.6 真实 DB 结构（实查）

7 张表全部存在，**当前全部 0 行**：

| 表 | 关键列（实查） | 约束 |
|---|---|---|
| `strategies` | id, strategyId(UNI), name, latestVersion, status, description, strategyType, **currentVersionId** | `idx_strategies_current_version` |
| `strategy_versions` | id, strategyId, version, **strategyDocumentJson(NOT NULL)**, versionRecordJson, fingerprint, **datasetVersion(NOT NULL)**, universeId, codeVersion, **parentVersionId**, **status DEFAULT 'Draft'**, description | `uq_strategy_versions_id_version`、`idx_strategy_versions_parent`、`idx_strategy_versions_status` |
| `strategy_parameters` | strategyVersionId, code, dataType, **parameterRole**, defaultValueJson, **minValue/maxValue/stepValue**, required, ordinal | `uq_strategy_parameters_version_code` |
| `strategy_entry_rules` | ruleId, ruleType, eventType, windowStart/End/Unit, triggerType, conditionJson, conditionCount, priority, enabled | `uq_strategy_entry_rules_version_rule` |
| `strategy_exit_rules` | ruleId, ruleType, triggerType, thresholdValue/Unit, parameterCode, priority, enabled, ordinal | `uq_strategy_exit_rules_version_rule` |
| `strategy_execution_rules` | **signalTiming**, **executionTiming**, priceType, quantityMethod, lotSize, slippageModel, commissionModel, executionConstraintsJson | `uq_strategy_execution_rules_version`（1:1） |
| `strategy_version_datasets` | datasetId, **datasetVersion**, **role**, note, ordinal | `uq_strategy_version_datasets_binding` |

### 6.7 结论：可作为唯一 Strategy SoT？

**YES（模型层）／NO（接入层）。**
- 模型层：canonical SoT + 单向投影 + 两层指纹 + Look-Ahead 8 规则 + clone 幂等三态，纪律成立，**可且应当作为唯一 Strategy SoT**。
- 接入层：Dataset 绑定指向旧体系、零引用完整性、新能力未暴露、权限为 public ⇒ **当前还不能被任何上游/下游真实接入**。

---

## 7. Legacy Strategy 当前依赖（对应 §9）

### 7.1 依赖清单与分类

| 对象 | 位置 | 分类 | 证据 |
|---|---|---|---|
| `server/strategy/`（contract / registry / adapter / index） | `server/strategy/` | **ACTIVE** | `research/adapter.ts:15` `registerBuiltInResearchStrategies`，经 `researchRunRouter.ts:66` 运行时装配 |
| `server/strategy/strategies/` | 仅 **1 个**：`leaderCandidateBaselineStrategy` | **ACTIVE** | `strategies/leaderCandidateBaseline.ts:182`、`strategies/index.ts:12`；调用方 `strategyBacktest.ts:29-30,121` |
| `server/strategy/strategyBacktest.ts` | — | **ACTIVE** | `leaderCandidateStrategyBacktest.ts:27,207` → `db.ts:6,2207` 生产调用 |
| `leaderCandidates.ts` / `leaderCandidateStrategyBacktest.ts` | — | **ACTIVE** | `db.ts:2207`；`routers.ts:1275-1420` |
| `backtestCache.ts` | — | **ACTIVE** | `db.ts:64` |
| `realisticBacktest.ts` / `backtest/` | — | **ACTIVE** | `downsideRisk.ts`、`leaderCandidates.ts`、`paperTrading.ts`、`leaderCandidateStrategyBacktest.ts:39` |
| `paramSearchRouter.ts` | — | **ACTIVE** | `routers.ts:294`；前端 `ParameterSearch.tsx:192-199` |
| `walkForwardRouter.ts` | — | **ACTIVE** | `routers.ts:295`；前端 `WalkForwardAnalysis.tsx:146-153` |
| `research/signalEngine/`、`research/simulator/` | — | **ACTIVE** | `closedLoopWiring/executors.ts:35,37` → `researchRunRouter.ts:339` |
| `research/parameterSearch/` | — | **ACTIVE** | `paramSearchRouter.ts:49` |
| `research/strategyContract.ts` | — | **ACTIVE** | `research/registry.ts:16`、`experiment.ts:23` |
| `research/experiment.ts` / `experimentService.ts` / `runService.ts` / `engineAdapter.ts` | — | **COMPATIBILITY** | 已导出，运行时仅测试可见（`experimentPersistence.test.ts:46`、`researchRun.test.ts:113`），无 appRouter 端点 |
| `downsideRisk.ts` 中的 5 策略（baseline/riskPenalty/hardFilter/qualityBlend/qualityGate） | — | **ACTIVE**（未迁入 `server/strategy`） | `downsideRisk.test.ts:185` |
| 无独立 `strategyRouter` / `strategyService` 路由 | — | — | `routers.ts` 中不存在；`strategyService` 专指新模型 `StrategyService` |

**实查数据侧旁证**：`backtest_runs` 1 行（legacy 回测链在跑）。

### 7.2 Legacy 一览图

```
Legacy Strategy
  ├── server/strategy/  (contract · registry · adapter · strategyBacktest)
  │     └── strategies/leaderCandidateBaseline        ACTIVE  ← db.ts:2207 / research/adapter.ts:15
  ├── downsideRisk.ts (5 个硬编码策略 + 评分)          ACTIVE
  ├── leaderCandidates.ts / leaderCandidateStrategyBacktest.ts  ACTIVE
  ├── backtestCache.ts / realisticBacktest.ts / backtest/       ACTIVE
  ├── research/parameterSearch/ + paramSearchRouter.ts          ACTIVE（前端有页）
  ├── walkForwardRouter.ts                                     ACTIVE（前端有页）
  ├── research/signalEngine/ + simulator/                      ACTIVE（闭环装配）
  ├── research/experiment*.ts / runService.ts / engineAdapter.ts COMPATIBILITY（仅测试）
  └── shared/types.ts 策略类型                                   未发现
```

> **Legacy 仍在生产路径上，是否应继续作为主模型：NO。** 但**本轮不重构、不迁移**（越界）；新模型不得因它而改形。

---

## 8. 三者真实调用关系（代码级）

### 8.1 Dataset → Research 调用链（对应 §7）

```
Frontend  /research/:experimentId
   CreateExperimentDialog.tsx:66,84   datasetRegistry.listDefinitions / getDefinition（仅 READY）
        ↓
tRPC      appRouter.researchEngine         routers.ts:288
        ↓
Router    researchEngineRouter.ts:216 createExperiment
          :432 runEngine   :471 runIncremental
        ↓
Domain    researchEngine/engine.ts  (ResearchEngine)
        ↓
Reader    datasetReader.ts:97 RegistryResearchDatasetReader（契约 datasetReader.ts:73-84）
             ├── loadEventPage  :129
             ├── loadPaths      :151
             ├── loadPrefixBars :160
             └── loadOutcomes   :142
        ↓
Access    datasetRegistry/query.ts:655/815/797/779 DbDatasetDataReader
        ↓
DB        drizzle 表对象 query.ts:42-47  →  ds_first_limit_pullback_{event,prefix,post,path,outcome}
```

**逐条回答 §7 的 8 个问题**：

| # | 问题 | 结论 |
|---|---|---|
| 1 | Dataset Version 是否固定 | ✅ 固定：`research_experiment.datasetVersionId`（创建即冻结，`updateExperiment` schema **无** `datasetVersionId` 键） |
| 2 | 是否可能读取错误 Dataset Version | ⚠️ 有守卫但非绝对：增量断言 `DATASET_VERSION_DRIFT`（`engine.ts:452-463`）；但 Run 表本身**无 datasetVersionId 列**，一旦 experiment 侧被绕开即无第二道锁 |
| 3 | Analysis Run 是否保存 Dataset Version | ✅ 保存于 `inputSnapshotJson`（`datasetVersionId` + `datasetCode` + `datasetVersionLabel`） |
| 4 | Result 是否能够追溯 Dataset Version | ⚠️ **只能逐级 join**：`research_result.analysisId` → `research_analysis.runId` → `research_run.experimentId` → `research_experiment.datasetVersionId`（4 跳，无任何捷径列） |
| 5 | 是否存在「读最新 Dataset」导致历史结果漂移 | ✅ **不存在**：全程用冻结的 `datasetVersionId`；无 `latest` 概念 |
| 6 | Research 是否绕过 Dataset Registry | ⚠️ **部分**：元数据经 registry；**数据读取直接打 `ds_*` 物理表**（经唯一 reader 封装）。旧链路 `research/datasetAccess`（`handle.ts:23-30,159`）则读 `research_datasets` 行表，**完全绕过 Registry** |
| 7 | 是否存在硬编码物理表名 | ✅ 生产逻辑无裸 SQL 表名；绑定集中在 `drizzle/schema.ts:1272/1309/1335/1367/1397`（+ 测试/脚本 fixture） |
| 8 | 旧/新 Dataset API 是否并行 | 🔴 **是**：`routers.ts:283 researchDataset`（旧）与 `:286 datasetRegistry`（新）同时在线 |

### 8.2 Research → Strategy 调用链（对应 §10）

```
Research Analysis
      ↓
strategyId ?      →  不存在（researchEngine 全链路零引用）
strategyVersionId? →  不存在
      ↓
Strategy Domain Model ?
```

**判定：`NOT CONNECTED`**

真实取证：
- 全库实查「Research 表中与 strategy 相关的列」只有 3 处，**全部是自由文本、且不属于 Research Engine 链路**：

| 表 | 列 | 性质 |
|---|---|---|
| `research_experiments`（遗留复数） | `strategyId varchar(64)` / `strategyVersion varchar(32)` | 自由文本，0 行，属 STEP 6.x 旧链路 |
| `research_experiment_batches`（遗留） | `strategyId` / `strategyVersion` | 同上 |
| `research_strategy_candidate` | `strategyDefinitionId varchar(64)` | 软引用 `strategies.strategyId`，**无外键**，当前 **0 行** |

- `research_run` / `research_analysis` / `research_result` / `research_conclusion` **没有任何 strategy 列**（实查列清单）。
- `research_strategy_candidate` 有 repository（`researchCore/candidates.ts`、`repository/contract.ts:219-223`）与 `listCandidates` 端点（public），但**没有任何「创建候选」的引擎或端点**；前端 `CandidatesPanel.tsx:44-47` 明确标注「引擎不做自动策略生成，所以通常为空」。
- `researchRun.loopRun` 的 metadata 可携带 `strategyId` / `strategyVersion`（`researchRunRouter.ts:328-329`、`shared/researchContracts.ts:705-706`），但该端点**无状态、不落库**（`researchRunRouter.ts:238-246,385`）。

### 8.3 Strategy → Dataset 调用链（🔴 断点所在）

```
Strategy Version (canonical StrategyDefinition.datasets[])
      ↓  strategySchema/definitionValidation.ts:759  isValidDatasetVersionFormat()
      ↓  DATASET_VERSION_FORMAT_RE = /^rd-\d+\.\d+\.\d+-\d+-[0-9a-f]{16}$/
      ↓
  只接受 rd-…  ←──────────┐
                          │  两套体系在此不接头
  真实 Dataset Registry   │
  dataset_version.version ─┘
  = "v1" / "v2"（id 390001 / 390002）
  DATASET_VERSION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/
```

**前端侧同样错位**：`client/src/components/strategy/StrategyBasicInfo.tsx:42` 用的是 **`trpc.researchDataset.list`**（旧 Research Dataset 构建器），并派生 `universeId = research-dataset:<datasetVersion>`（`:28-29,55`）——即 **Strategy UI 的 Dataset 绑定完全走旧体系**，而 Research UI 走 `datasetRegistry`（`CreateExperimentDialog.tsx:66,84`）。

⇒ **Strategy 与 Research 之间连「同一个数据集坐标」都不共享。**

---

## 9. Research Result 可追溯性（对应 §12）

对一条 `research_result` 反查：

| 项 | 能否回答 | 载体 | 判定 |
|---|---|---|---|
| 使用了哪个 Dataset | ✅ | `inputSnapshotJson.datasetCode`（如 `first_limit_pullback`） | **IMMUTABLE** |
| 哪个 Dataset Version | ✅ | `inputSnapshotJson.datasetVersionId`(390002) + `datasetVersionLabel`("v2") | **IMMUTABLE** |
| 哪个 Analysis | ✅ | `research_result.analysisId` | IMMUTABLE |
| 哪个 Analysis Version / Snapshot | ✅ | `research_analysis.configJson`（longtext，执行时落定） | IMMUTABLE |
| 哪个 Strategy | 🔴 | — | **NOT IMPLEMENTED** |
| 哪个 Strategy Version | 🔴 | — | **NOT IMPLEMENTED** |
| 使用了什么参数 | ⚠️ 部分 | `research_analysis.configJson` + 条件表 `research_analysis_condition`；但**辅助指标摘要（effect/pValue/tStat）未落库** ⇒ 无法重建历史摘要 | **PARTIAL**（DRIFT RISK 已被规避：增量**不生成结论**，`engine.ts:96-100`） |
| 执行时间 | ✅ | `research_run.startedAt/completedAt` + `executionLogJson[].startedAt/completedAt` | IMMUTABLE |

**关键问题：Strategy Version v1 → v2 后，历史 Research Result 是否仍严格指向 v1？**
- 若指 **Dataset**：✅ **是**（snapshot 冻结 datasetVersionId，无 `latest`）。
- 若指 **Strategy**：🔴 **不适用 —— 因为 Research 与 Strategy 之间根本没有引用关系**（不存在「指向 v1」这回事）。

**判定汇总**：Dataset / Analysis 侧 = `IMMUTABLE`；Strategy 侧 = `NOT IMPLEMENTED`；参数摘要 = `PARTIAL`。

---

## 10. 数据库 ER 关系（真实 TiDB，对应 §15）

> 全部由 `information_schema` 实查得出；**整个库 0 个外键**，全部为应用层软引用。

```
┌─────────────────────────── Dataset Registry（新） ───────────────────────────┐
│                                                                             │
│  dataset_definition (1)                                                     │
│    PK id ──UNI datasetCode──┐                                               │
│    datasetType / storageType / status                                       │
│    eventTableName / prefixTableName / postTableName / pathTableName         │
│    / outcomeTableName / featureTableName(全 NULL)                           │
│                              │ 软引用（无 FK）                                │
│  dataset_version (2)  ◄──────┘                                              │
│    PK id · datasetId(MUL) · version('v1'|'v2') · status(READY)              │
│    startDate / endDate / totalEvents / totalRows                            │
│    universeDefinitionJson / filterDefinitionJson                            │
│              ▲                                                              │
│              │ 软引用 datasetVersionId                                       │
│  dataset_build_job (4)  dataset_build_config (2, UNI datasetVersionId)      │
│                                                                             │
│  ds_first_limit_pullback_event    (25,108)   datasetVersionId(MUL)          │
│  ds_first_limit_pullback_prefix   (527,268)  datasetVersionId(MUL)          │
│  ds_first_limit_pullback_post     (487,692)  datasetVersionId(MUL)          │
│  ds_first_limit_pullback_path     (487,692)  datasetVersionId(MUL)          │
│  ds_first_limit_pullback_outcome  (75,324)   datasetVersionId(MUL)          │
└─────────────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ 应用层软引用：datasetVersionId (bigint)
                                   │ 快照另存 datasetVersionLabel
┌────────────────────────── Research（RESEARCH-001/002，单数） ────────────────┐
│                                                                             │
│  research_experiment (2)                                                    │
│    PK id · datasetVersionId(MUL) · researchType / status / configJson        │
│         │                                                                   │
│         ├──► research_hypothesis (0)   experimentId(MUL)                    │
│         ├──► research_run (8)          experimentId(MUL) · runNo             │
│         │      status / inputSnapshotJson / executionLogJson                │
│         │      🔴 无 datasetVersionId 列                                     │
│         │           │                                                       │
│         │           └──► research_analysis (19)                             │
│         │                  runId(MUL) · analysisType · target · configJson   │
│         │                       │                                            │
│         │                       ├──► research_analysis_condition (11)        │
│         │                       │      analysisId · groupNo · sortOrder       │
│         │                       │      fieldName / operator / valueJson       │
│         │                       ├──► research_analysis_metric (0)  （定义表） │
│         │                       └──► research_result (674)                   │
│         │                              analysisId · resultType · metricCode   │
│         │                              metricValue · sampleCount · resultJson │
│         ├──► research_conclusion (7)   experimentId · conclusionType          │
│         │      title / conclusion / evidenceJson / confidence                │
│         │      🔴 无 runId（归属靠 evidence 里的 analysisId 求交）             │
│         ├──► research_strategy_candidate (0)                                 │
│         │      experimentId · conclusionId · strategyDefinitionId(varchar64) │
│         │      entryRuleJson / filterRuleJson / exitRuleJson / riskRuleJson   │
│         │      🔴 软引用 strategies.strategyId，无 FK，无创建路径               │
│         └──► research_artifact (0)                                           │
│                                                                             │
│  research_analysis_template (0, UNI name) ◄─ research_analysis_template_item  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────── New Strategy（STRATEGY-002/003） —— 全部 0 行 ────────────────┐
│                                                                             │
│  strategies (0)                                                             │
│    PK id · UNI strategyId · name · latestVersion · status                    │
│    description · strategyType · currentVersionId(MUL)  ← 权威当前版本指针      │
│         │                                                                   │
│         ▼ strategyId (varchar, 软引用；无 FK)                                 │
│  strategy_versions (0)                                                      │
│    PK id · strategyId(MUL) · version · UNIQUE(strategyId, version)           │
│    🔴 strategyDocumentJson (longtext, NOT NULL)  ← 唯一 canonical SoT        │
│    versionRecordJson · fingerprint · datasetVersion(varchar96 NOT NULL)      │
│    universeId · codeVersion · parentVersionId(MUL) · status(Draft) · desc    │
│         │ strategyVersionId (int, 软引用；无 FK)                              │
│         ├──► strategy_parameters (0)        UNIQUE(strategyVersionId, code)  │
│         ├──► strategy_entry_rules (0)       UNIQUE(strategyVersionId, ruleId)│
│         ├──► strategy_exit_rules (0)        UNIQUE(strategyVersionId, ruleId)│
│         ├──► strategy_execution_rules (0)   UNIQUE(strategyVersionId)        │
│         └──► strategy_version_datasets (0)  UNIQUE(strategyVersionId,        │
│                                              datasetId, datasetVersion, role)│
│                 🔴 datasetVersion 只接受 rd-… ⇒ 无法引用 v1/v2               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────── Legacy Dataset（旧，STEP 6.x）—— 与新体系并存、互不引用 ───────────┐
│  research_datasets (7)   UNI datasetId · datasetVersion('rd-1.0.0-1-<sha16>') │
│                          rowsTableName ──► rd_rows_05809b1a6d97aa02 /        │
│                                            rd_rows_5dce9db1421bec38         │
│  research_runs (2)       runId(UNI) · datasetVersion(MUL) · datasetFingerprint│
│  research_experiments (0) strategyId / strategyVersion（自由文本）             │
│  ▲ 被 server/research/datasetAccess 与 Strategy 编辑器消费                    │
└─────────────────────────────────────────────────────────────────────────────┘

FK 总数：0
```

---

## 11. 前端功能关系（对应 §16）

### 11.1 路由清单（`client/src/App.tsx:45-83`）

| 路径 | 组件 | 归属 |
|---|---|---|
| `/datasets` `/datasets/:datasetId` `/datasets/:datasetId/versions` `/:versionId` | DatasetList / DatasetDetail / VersionList / VersionDetail | Dataset（新） |
| `/dataset-builder` | → 重定向 `/datasets` | Dataset（新） |
| `/research` `/research/:experimentId` | ResearchList / ResearchDetail | Research |
| `/strategy-editor` | StrategyEditor | Strategy |
| `/backtest` `/performance` `/parameter-search` `/walk-forward` `/regime-report` `/review-workbench` | 各页 | **Legacy** |
| `/data-health` `/historical-state` | — | 数据治理 |

### 11.2 三块 UI 的真实功能

**Dataset UI** ✅ 完整：建定义 `CreateDatasetDialog.tsx:99-120`；建版本+构建 `BuildVersionDialog.tsx:140-171`（筛选门禁 `:126-136`）；触发/取消/重试 `VersionBuildControls.tsx:30-32`；进度 3s 轮询 `VersionDetail.tsx:100-118`；五表预览 `VersionDetail.tsx:385-420`；删除 `DeleteDatasetDialog.tsx:50` / `DeleteDatasetVersionDialog.tsx:46`。
→ **可以作为 Research 数据源**：`CreateExperimentDialog.tsx:66,84` 用 `datasetRegistry.listDefinitions/getDefinition`，**仅允许选 READY 版本**（`:232-249`）。✅

**Research UI** ✅ 全部可达：选 Dataset Version `CreateExperimentDialog.tsx:190-252`；配置分析 `CreateAnalysisDialog.tsx:416-648`；执行 `RunEngineButton.tsx:76-97` / 补跑 `RunIncrementalButton.tsx:64-89`；看结果 `AnalysisResultsView.tsx:82-322` / 结论 `ConclusionPanel.tsx:228-317`；维护 `ExperimentActions.tsx:49-74,129-155` / `AnalysisConditionEditor.tsx:78-117`。
→ 禁用均属「条件禁用」（有原因 Tooltip），**非未接线**。`CandidatesPanel.tsx:44-47` 为预留空位。

**Strategy UI**（全在 `StrategyEditor.tsx`）

| 能力 | 是否有 UI | 是否有端点 | 说明 |
|---|---|---|---|
| 创建 Strategy | ✅（不存在即建）`:1140-1157` | ✅ `create` | UI 未直调 `create` |
| 创建 Version | ✅ `:1159-1175` / `:421-426` | ✅ `createVersion` | — |
| 编辑 Version | ✅ 可视化 + JSON 双模 `:282-386` | ✅ `save` | — |
| 查看 Version | ✅ 列表 `:1020-1075` / 加载 `:1093-1108` | ✅ `listVersions`/`loadVersion` | **端点有、UI 未接** |
| 复制 Version（clone） | ❌ 无独立 clone UI | ⚠️ 仅 `createVersion`（内部 clone） | **STRATEGY-003 的 `cloneVersion` 未暴露** |
| 查看 Parameters | ⚠️ 仅 JSON 高级模式 `:378-382` | — | 无专用参数面板（`parameterRole` / min/max/step 不可见） |
| 查看 Rules | ✅ `RuleEditor` `:345-375` | — | — |
| 绑定 Dataset | ✅ `StrategyBasicInfo.tsx:42,116-150` | ⚠️ 用 **`researchDataset.list`（旧）** | 🔴 绑定的是旧体系 |
| 触发闭环运行 | ✅ `:953-1013`（`researchRun.readiness` / `loopRun`） | ✅ | ⚠️ 执行的是**内置注册表策略**，**不是**编辑器里持久化的 StrategyDocument |

### 11.3 关键判断

- 前端 Strategy 消费的是 **`research.strategy.*` → `StrategyService`/`DbStrategyRepository` → `strategies`/`strategy_versions`（新模型）** ✅（`StrategyEditor.tsx:393,1021,1082-1093`；`researchRouter.ts:68`）。`strategyAdapter.ts` 仅是 wire↔VM 适配，不是 API。
- 🔴 **Research → Strategy 无自然路径**：全库 Grep 无 `strategy-editor` 跳转、无「把结论转成策略」的按钮。用户在 `/research` 得出结论后，**只能手动切到 `/strategy-editor` 从零重填**，且**无法把分析用的 Dataset 版本带过去**（见 §12 的体系错位）。
- 🔴 **Strategy 的闭环运行与实际编辑的 Strategy 脱节**：`loopRun` 执行内置注册表策略（`research/RunRouter.ts:187,328`），**不读 `strategy_versions`**。

---

## 12. 重复定义与架构冲突（对应 §14）

### 12.1 Strategy Definition —— 5 份并存

| 定义 | 位置 | 语义 | 冲突 |
|---|---|---|---|
| `StrategyDefinition`（新，富模型） | `research/strategySchema/definition.ts:534` | 完整交易规则（entry/exit/position/risk/execution/parameters/datasets） | **权威** |
| `StrategyDocument`（记录载体） | `research/strategySchema/types.ts:231` | canonical 文档（含可选 `definition` + v1 派生视图） | 载体，非第二套语义 |
| `StrategyContract`（研究层元数据） | `research/strategyContract.ts:17` | 元数据 + 参数 schema | **语义不同**（研究元数据） |
| `BacktestSpec`（回测输入） | `backtest/types.ts:448` | 回测输入规格 | **语义不同** |
| Legacy 执行契约 | `server/strategy/contract.ts:79` | StrategyContext / 纯函数 | **语义不同**（可执行策略） |

### 12.2 Parameter —— 4 份

| 定义 | 位置 | 有 `parameterRole`？ |
|---|---|---|
| `ParameterDefinition`（新） | `definition.ts:497` | ✅ FIXED/TUNABLE/DERIVED + min/max/step |
| `ResearchParameterDefinition` | `research/types.ts:25` | ❌ |
| `SweepParameterDefinition` | `parameterSpace.ts` | ❌（只有 min/max/step 空间） |
| Legacy `DeclaredRule.operand` | `types.ts:101` | ❌ |

### 12.3 Dataset Binding —— 5 份语义不一致

| 定义 | 位置 | 语义 |
|---|---|---|
| `StrategyDatasetBinding`（新） | `definition.ts:520` | datasetId + **rd- 版本** + role |
| `strategy_versions.datasetVersion`（列） | `drizzle/schema.ts` | v1 遗留单值（`rd-`） |
| `ResearchDatasetSpec` | `research/types.ts:49-62` | datasetId + datasetVersion + fingerprint（无 role） |
| `StrategyDocument.datasetVersion` | `types.ts:256` | 文档级单值（`rd-`） |
| `BacktestSpec.datasetVersion` | `backtest/types.ts:406,454` | run 级单值（`rd-`） |
| Dataset Registry `datasetVersionId` | `dataset_version.id` | **bigint 主键 + label `v1`/`v2`** |

🔴 **最严重的重复：Dataset 版本标识两套并存且互不承认**（`rd-…` vs `v1`/`v2`），且 Strategy 在旧的一侧。

### 12.4 两套 Dataset 系统

| | 新（`datasetRegistry`） | 旧（`researchDataset`） |
|---|---|---|
| 表 | `dataset_definition` / `dataset_version` / `dataset_build_job` / `ds_*` | `research_datasets` / `rd_rows_*` |
| 版本 | `v1` / `v2` | `rd-1.0.0-1-<sha16>` |
| 行数 | 1 / 2 / 4 / 5 表齐备 | 7 / 2 表 |
| 消费方 | Research Engine、Dataset 页面 | `research/datasetAccess`、**Strategy 编辑器与绑定校验** |

### 12.5 两套 Research 系统

| | 新（单数） | 旧（复数） |
|---|---|---|
| 表 | `research_experiment` / `_run` / `_analysis` / `_result` / `_conclusion` …（10 张） | `research_experiments` / `research_runs` / `research_datasets` |
| 键 | `id` bigint + `datasetVersionId` | `experimentId`/`runId` 字符串 + `strategyId` 驱动 |
| 行数 | 2 / 8 / 19 / 674 / 7 | 0 / 2 / 7 |
| 服务 | Dataset → Research → Conclusion | Strategy → Parameter Search → Backtest |

⚠️ 两套表名**仅差一个 `s`**，是既有高危歧义（`docs/research/RESEARCH-001-AUDIT.md §4` 为对照依据）。

---

## 13. 真实能力地图（对应 §17）

```
Dataset
  ├── Definition CRUD                          READY
  ├── Version（创建/列出/删除/状态）             READY
  ├── Build Job（进度/取消/重试/孤儿回收）        READY
  ├── Build 执行器                              READY
  ├── Physical Tables（5 层）                   READY
  ├── 查询/读取 API（keyset 分页 ×5）            READY
  ├── Preview                                  PARTIAL（无专用端点，前端拼装）
  ├── 版本生命周期（取消=回滚/重建=从零）          READY
  ├── feature 物理层                            MISSING（仅声明列名）
  ├── 市值 / 流通盘字段                          MISSING（v2 100% NULL）
  └── 行业字段                                  MISSING（v2 99.47% NULL）

Research
  ├── Analysis CRUD（含批量 + 模板）              READY
  ├── Variables（FEATURE 4 族）                  READY
  ├── Variables（OUTCOME 5 族）                  READY
  ├── Horizon                                   PARTIAL（多视界仅 EVENT_STUDY）
  ├── Descriptive Statistics（19 指标 + 多变量）   READY
  ├── Category / Group（QUANTILE / 维度）         READY
  ├── Filter / Condition（组号连续校验）           READY
  ├── 6 类分析执行器                             READY
  ├── Run / Status / Snapshot                   READY
  ├── Result 落库（674 行真实）                   READY
  ├── 增量补跑                                   READY
  ├── 后台 worker 消费 PENDING Run               MISSING
  ├── Run 孤儿回收                               MISSING
  ├── regime / industry / board 维度             MISSING / MISSING / 退化
  ├── IC / RankIC / 显著性                        MISSING
  ├── 策略研究（Strategy 作为研究输入）              MISSING
  ├── 结论 → 策略候选 交接                          MISSING

New Strategy
  ├── Definition（canonical SoT）                READY
  ├── Version（不可变 + 演进链）                   READY
  ├── Parameter（FIXED/TUNABLE/DERIVED + 边界）    READY
  ├── Entry / Exit / Position / Risk / Execution READY
  ├── Projection（5 张单向派生，零漂移）             READY
  ├── Fingerprint（两层）                        READY
  ├── Look-Ahead 静态校验（L1–L8）                READY
  ├── Clone（任意历史版本 + 幂等三态）              READY（**未暴露 tRPC**）
  ├── loadBundle / validateVersion / setStatus   READY（**未暴露 tRPC**）
  ├── Dataset Binding（结构）                     READY
  ├── Dataset Binding（⇄ Dataset Registry）        🔴 BROKEN（格式互斥 + 零引用完整性）
  ├── Strategy UI 绑定数据源                        🔴 指向 Legacy researchDataset
  └── Version Lifecycle 状态机守卫                  PARTIAL（只校验取值，无迁移守卫）

Legacy Strategy
  ├── server/strategy/（1 策略 + registry + adapter） ACTIVE
  ├── leaderCandidates / downsideRisk（5 策略）        ACTIVE
  ├── realisticBacktest / backtestCache / backtest/   ACTIVE
  ├── paramSearch / walkForward（含前端页）             ACTIVE
  ├── signalEngine / simulator（闭环装配）             ACTIVE
  └── experiment*.ts / runService / engineAdapter     COMPATIBILITY
```

---

## 14. 断点地图（对应 §18，按真实代码判定，未预设）

```
Dataset（新 Registry：v1 / v2 / datasetVersionId）
   │
   │  ✅ CONNECTED
   │  researchEngine/datasetReader.ts:97 → query.ts → ds_* 物理表
   ▼
Research（探索性研究闭环，真实可用）
   │
   │  🔴 断点 ②（能力断点）：Research 无法消费 Strategy Version
   │     · research_run / research_analysis / research_result 零 strategy 列
   │     · 「某 Strategy Version 的规则是否有效」= NOT_SUPPORTED
   │     · research_conclusion → research_strategy_candidate 无创建路径（0 行）
   │     · 无「结论 → 策略」入口
   X
   │
   │  🔴🔴 断点 ①（坐标断点 / 唯一根断点）：
   │     Strategy 与 Dataset Registry 的**版本标识体系不接头**
   │     · Strategy 绑定校验 DATASET_VERSION_FORMAT_RE = /^rd-…$/（rejects "v1"）
   │     · Dataset Registry 版本 = v1 / v2
   │     · 零引用完整性校验、零外键（全库 0 FK）
   │     · Strategy UI 绑定走 researchDataset.list（旧）
   ▼
New Strategy（模型完整，但无法合法绑定 Research 用过的 Dataset）
   │
   │  🔴 断点 ③（执行断点，下游，当前不应触碰）：
   │     StrategyDefinition → 可执行实例（Signal/Exit 求值语义）不存在
   X
   │
   ▼
Parameter Search（Legacy paramSearch 在线，但消费的是 Legacy 策略，不是新 SoT）
```

**为什么 ① 是根断点**：断点 ② 的修复产物（「把某条研究结论转成一个 Strategy Version」）**必然要写入 Dataset 绑定**；而绑定校验只接受 `rd-…`，研究侧用的是 `v1`/`v2` ⇒ ② 的任何实现在 ① 未修之前都只能**产出非法或虚假的绑定**（要么填一个不存在的 `rd-…` 字符串，要么绕过校验）。所以 ① 是 ② 的前置必要条件。

---

## 15. 风险

| # | 风险 | 级别 | 依据 |
|---|---|---|---|
| R1 | **Dataset 版本标识双轨**（`rd-…` vs `v1`/`v2`）→ 任何跨模块绑定都可能「校验通过但引用不存在的对象」 | 🔴 高 | `DATASET_VERSION_FORMAT_RE` vs `DATASET_VERSION_LABEL_PATTERN`；全库 0 FK |
| R2 | **Strategy Dataset 绑定零引用完整性**：可写入不存在的 datasetId/version 而不报错 | 🔴 高 | `definitionValidation.ts:759-765` 只校验格式，不查库 |
| R3 | `updateAnalysis` 改 `config` **不失效旧结果** ⇒ UI 展示旧口径数字（静默不实） | 🟠 中 | 无 invalidate 调用；仅 `setAnalysisConditions` 会失效（`maintenance.ts:428-453`） |
| R4 | **Research Run 无孤儿回收**：dev 热重启即锁死 Run（已真实发生 1 次，`run 330003` 于 2026-09-12 15:37 人工收敛） | 🟠 中 | `research_run.id=330003` FAILED/RUN_ORPHANED |
| R5 | 无后台 worker 消费 `PENDING` Run ⇒ 空 Run 永不自动出结果 | 🟡 低（已有产品语义） | `LAYER_CONVENTIONS.md:59` |
| R6 | **两套 Dataset + 两套 Research 表并存**（表名仅差一个 `s`）⇒ 误引风险 | 🟠 中 | `routers.ts:283` vs `:286` |
| R7 | Strategy 端点全 `publicProcedure`（Dataset/Research 写端点均 admin）⇒ 权限口径不一致 | 🟠 中 | `researchRouter.ts:84-154` |
| R8 | Look-Ahead 只覆盖**声明层**，无法证明运行时无旁路读取未来数据 | 🟡 低（已显式声明） | `STRATEGY-003-report.md §9.1` 诚实边界 |
| R9 | `research_run` 无 `datasetVersionId` 列 ⇒ Dataset 追溯需 4 跳 join，无独立第二道锁 | 🟡 低 | 实查列清单 |
| R10 | v2 数据广度受限（市值 100% NULL / 行业 99.47% NULL / 板块单值）⇒ 研究维度受限 | 🟠 中 | 实查 NULL 率 |
| R11 | `strategy_versions.status` 无 C-21.1 完整状态机**迁移守卫**（仅校验取值合法） | 🟡 低 | `STRATEGY-003-report.md §17` |
| R12 | `research_experiments.strategyId/strategyVersion` 仍是自由文本冗余列（F2 未收口） | 🟡 低 | 实查列 + 0 行 |

---

## 16. 候选下一步（只列候选，不开发，对应 §19）

| 候选 | 内容 | 解决 | 依赖 | 是否候选 |
|---|---|---|---|---|
| **C1** | **STRATEGY-004 — Strategy Dataset 绑定对齐 Dataset Registry（含引用完整性 + 版本标识打通 + 暴露 STRATEGY-003 已有能力）** | 断点 ① | 仅需已完成的 Dataset Registry（只读）+ STRATEGY-003 | ✅ **推荐** |
| C2 | RESEARCH-006 — 研究结论 → 策略候选/草稿 的交接层 | 断点 ② | **前置 C1**（否则产出非法绑定） | ✅ 次优先 |
| C3 | STRATEGY-005 — `StrategyDefinition` 可执行解析器（Signal/Exit 求值语义） | 断点 ③ | C1；且属 Backtest 前置 | ❌ 越界（进入 Backtest 方向） |
| C4 | DATASET-004 — 跨板块版本 + 市值/行业字段回填 | R10 | 需新数据源与回填 | ❌ 用户已明确 Dataset 不再开发 |
| C5 | RESEARCH-007 — 修 `updateAnalysis` 改 config 不失效旧结果 | R3 | 无 | ⏸️ 可独立小修，非链路断点 |
| C6 | RESEARCH-002D — Run 孤儿回收启动钩子 | R4 | 无 | ⏸️ 运维兜底，非链路断点 |
| C7 | 清理 Legacy Strategy（迁入新模型） | R6 | — | ❌ 明确禁止（不得恢复/重写 Legacy） |

---

## 17. 最终唯一推荐 STEP

### STEP STRATEGY-004 — Strategy ↔ Dataset 绑定对齐与引用完整性

**一句话**：让新 Strategy 的 Dataset 绑定与 Research 使用**同一套 Dataset 坐标**（Dataset Registry 的版本），并在写入时做真实存在性校验。

**范围（最小可验收切片）**

1. **版本标识对齐**：`StrategyDatasetBinding` 支持引用 Dataset Registry 的真实版本（以 `datasetVersionId`(bigint) 为权威引用，保留 `v1`/`v2` label 作显示/兼容），不再要求 `rd-…`。**不删除** `rd-…` 兼容分支（旧数据/旧测试不破坏）。
2. **引用完整性校验**：绑定写入前查 `dataset_version`，断言「存在 且 `status = READY`」；失败响亮抛错（新错误码）。**只校验、不自动补**。
3. **暴露 STRATEGY-003 已建但未暴露的能力到 tRPC**：`loadBundle` / `validateVersion` / `cloneVersion` / `setVersionStatus`（`service.ts:209/258/306/320/345`），并统一为 `adminProcedure`（与 Dataset/Research 写端点口径一致）。
4. **Strategy UI 的 Dataset 绑定改为 `datasetRegistry`**（`StrategyBasicInfo.tsx:42` 由 `researchDataset.list` 切到 `datasetRegistry.listDefinitions/getDefinition` + 版本列表），保持与 `CreateExperimentDialog.tsx:66,84` 同源。

**不碰**：Dataset Registry 代码与 `ds_*` 数据、Research 代码、`StrategyDefinition` 的 canonical SoT 与投影方向、Legacy Strategy、任何 Backtest / Parameter Search / OOS / WFO / Simulation。

**依赖（全部已完成）**：Dataset Registry（READY 的 v1/v2 与 `dataset_version` 表）、STRATEGY-002 持久化、STRATEGY-003 Domain Model + 5 张投影表。

**验收判据（可独立验证）**
1. 真实 TiDB：把一个 Strategy Version 绑定到 `390002`（v2），读回 binding 逐字段一致；
2. 绑定到不存在的 `datasetVersionId` → 响亮失败，且**不产生半成品版本**；
3. 绑定到非 READY 版本 → 失败；
4. `loadBundle` / `validateVersion` 经 tRPC 端到端可用；`cloneVersion` 幂等三态保持；
5. 旧 `rd-…` 绑定与既有 132+202 例策略测试**零回归**；
6. `npx tsc --noEmit` exit 0；全量 vitest 失败集合与既有基线（7 文件 / 15 例环境性失败）逐项一致。

**完成后的系统链路**

```
Dataset（Registry v1/v2）──✅──► Research（探索性研究，可用）
                                    │
                                    │  🔴 仍缺（= 下一 STEP 的候选 C2）
                                    ▼
                          New Strategy（可用 Dataset 坐标 ✅ 本 STEP 修好）
                                    │
                                    ▼
                          Parameter Search（后续）
```

---

## 18. 为什么现在做这个（§19 之「为什么」）

1. **它是唯一根断点**：断点 ②（Research→Strategy 交接）的任何实现在 ① 未修之前只会产出**非法或虚假**的 Dataset 绑定——修 ① 是修 ② 的必要条件。
2. **它同时消解 R1 / R2 / R6 三个高风险项**：Dataset 标识双轨、零引用完整性、Strategy UI 走旧体系。
3. **它完全不越界**：只动 Strategy 自己的绑定层 + 自己 router + 自己 UI；**不碰 Dataset / Research / Legacy**。
4. **它承接到手的能力**：STRATEGY-003 已经把结构（`datasets[]`、5 张投影、校验器、Repository）全部建好且 0 行空表，本 STEP 只是把「接线」接对，**不需要任何重新设计**。
5. **可独立验收**：真实 TiDB 上「绑定 → 读回 → 拒非法」三件事就能判定，不需要 Backtest。
6. **它不产生策略结论**：符合「只有 RESEARCH_READY=TRUE 才允许正式策略结论」的 7 态纪律 —— 本 STEP 只连接线，不出结论。

## 19. 为什么现在不做其他事情（§20 之「为什么不是其它候选」）

| 候选 | 为什么现在不做 |
|---|---|
| **C2 研究结论 → 策略交接** | 前置未满足：交接必然写入 Dataset 绑定，而绑定当前**无法表达 Research 用的 `v1`/`v2`** ⇒ 只能产出非法/虚假绑定。先把坐标打通。 |
| **C3 可执行解析器** | 属 Backtest 方向（`§20` 明令不进入 Backtest / Parameter Search / OOS / WFO）；且在没有合法 Dataset 绑定的前提下，解析出来的实例也取不到数。 |
| **C4 Dataset 广度（跨板块/市值/行业）** | 违反「不重新开发 Dataset」；且现有 v2 已足以支撑研究（`year` 3 年 / `market` 2 值可用），属**广度**而非**链路**问题。 |
| **C5 `updateAnalysis` 口径缺口** | 是真实缺陷，但**局部、可独立小修**，不改变链路拓扑；放进本 STEP 会稀释「只推荐一件事」的约束。 |
| **C6 Run 孤儿回收** | 已在 2026-09-12 15:37 人工收敛（run 330003 = FAILED/RUN_ORPHANED），当前无卡死实例；属运维兜底，不阻塞任何链路。 |
| **C7 清理 Legacy** | 明确禁止（不得恢复 Legacy 为主模型、不做大规模重构）；且 Legacy 仍承载 `/backtest` `/parameter-search` `/walk-forward` 的现有页面。 |

---

## 20. 本次审计未修改内容（对应 §24 第 13 条）

**明确确认：**

- ✅ **Dataset 未修改**（未改 `server/datasetRegistry/**`、未改 `shared/datasetRegistryContracts.ts`、未改 `ds_*` 与 Registry 三实体表结构、未改一条数据）
- ✅ **Research 未修改**（未改 `server/researchCore/**`、`server/researchEngine/**`、`researchEngineRouter.ts`、`researchRunRouter.ts`、`researchRouter.ts`、`research_*` 任何表）
- ✅ **New Strategy 未修改**（未改 `server/research/strategySchema/**`、`server/research/strategyPersistence/**`、未改 `strategies` / `strategy_versions` / 5 张投影表）
- ✅ **Legacy Strategy 未修改**（未改 `server/strategy/**`、`downsideRisk.ts`、`leaderCandidates.ts`、`paramSearchRouter.ts`、`walkForwardRouter.ts`）
- ✅ **未新增数据库表**；**未创建 migration**；**未修改 schema**；**未修改 API**；**未修改前端**
- ✅ **未实现** Parameter Search / Backtest / Evaluation / Robustness / OOS / Walk-Forward / 模拟交易 / 生产交易
- ✅ **未修复任何发现的问题**（含 R1–R12 全部保留原状）

**唯一写入物**：
1. 本文件 `AUDIT-DRS-001-EVIDENCE.md`（任务要求的交付物）
2. 探针脚本落在系统临时目录 `%TEMP%\audit-drs-001\`（**未写入仓库**；仓库根目录零新增文件）

---

## 21. 附：本审计使用的真实查询（可复现）

```sql
-- 表清单与行数
SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE();
SELECT COUNT(*) FROM dataset_version;      -- 2
SELECT COUNT(*) FROM research_run;         -- 8
SELECT COUNT(*) FROM strategies;           -- 0
-- 全库外键（结论：0）
SELECT table_name, constraint_name, referenced_table_name
  FROM information_schema.key_column_usage
 WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL;
-- v2 字段可用性
SELECT COUNT(*) n, SUM(marketCap IS NULL) capNull, SUM(floatMarketCap IS NULL) fcapNull,
       SUM(industryCode IS NULL) indNull, COUNT(DISTINCT boardType) boards
  FROM ds_first_limit_pullback_event WHERE datasetVersionId = 390002;
  -- n=23978, capNull=23978, fcapNull=23978, indNull=23858, boards=1
-- Run 快照（可追溯性）
SELECT id, datasetVersionId, datasetVersionLabel, snapshotAt
  FROM research_run;  -- 快照 JSON 内字段，8 行全部含 datasetVersionId
```

**关键的代码级反证（决定性证据）**：

```ts
// server/research/experimentLineage/validate.ts:51-58
export const DATASET_VERSION_FORMAT_RE = /^rd-\d+\.\d+\.\d+-\d+-[0-9a-f]{16}$/;

// server/research/experimentLineage/experimentLineage.test.ts:245（锁定该语义）
expect(isValidDatasetVersionFormat("v1")).toBe(false);

// shared/datasetRegistryContracts.ts:61（真实 Registry 的版本标签）
export const DATASET_VERSION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
// 真实库：dataset_version.version = "v1"(390001) / "v2"(390002)
```

> **AUDIT-DRS-001 到此结束。审计完成，不自行开启下一 STEP。**
