# PARAMETER-001-PRE — Parameter Search 性能 Profile 与执行架构决定

> **本文档是本任务（PARAMETER-001-PRE）的唯一交付物**（规格 §11「只提交一个报告，不要拆报告」）。
>
> - 事实来源：本轮**当前代码** + **真实数据库** + **真实 Run**（不是旧实现、不是 fake dataset）。
> - 基线：`BACKTEST-002 = COMPLETE`（`docs/research/BACKTEST-002-IMPLEMENTATION-REPORT.md`）。
> - 本任务**未**创建 BACKTEST-003 / BACKTEST-004；**未**产生 migration；**未**执行 `db:push` /
>   `drizzle-kit generate`；**未**修改任何历史 Run。
> - 证据（探针 + 产物）全部登记在 `docs/evidence/README.md` 的 `param001pre` 条目。

---

## 1. Executive Summary

### 1.1 一句话结论

**593 s 的瓶颈不在数据集、不在 I/O、不在框架层，而在「闭环 `optimization` 阶段跑了 12 组参数样本」——
这 12 组占了整次运行的 92.8%；而每组之所以贵，是因为样本被送去求值的窗口是「数据集整窗 484 个决策日」
而不是「本次运行声明的窗口 57 个决策日」（**9.28×**）；再往下，88.4% 的样本耗时落在
`StrategyRuntime.evaluateWithDetail`（每个成员槽求值两次）。**

**本轮据此只实施 1 处优化**（定义指纹缓存，逐字节等价）：端到端 **657.8 s → 365.7 s（1.80×）**，
剔除同期恶化掉的跨境写库后**纯计算路径 2.07×**；**业务计数与 `resultJson` 一字未变、两个 digest 逐字节相同**。
再修掉窗口缺陷（DEFECT-1）后单次运行可降到 **≈ 73 s（合计 9.0×）**。

### 1.2 实测主榜（真实 Run，2026-09-19，含插桩）

| 项 | BEFORE | 占本次运行 | AFTER（P0 优化后） | 倍数 |
|---|---|---|---|---|
| 墙钟 | **657,796 ms** | 100% | **365,725 ms** | **1.80×** |
| **`optimization` 阶段（12 组参数样本）** | **610,652.5 ms** | **92.83%** | 286,000.8 ms | **2.14×** |
| └ 其中 `StrategyRuntime.evaluateWithDetail`（853,527 次调用 × 2） | 564,566.9 ms | 85.83% | 238,237.3 ms | **2.37×** |
| └ 其中逐决策摘要指纹（`sha256`，**必须保留**） | 17,096.2 ms | 2.60% | 21,594.3 ms | — |
| **主链**（data→research→strategy→backtest→evaluation，即用户「点运行」真正要的那条） | **6,395.1 ms** | **0.97%** | **3,405.5 ms** | 1.88× |
| 数据集装载（`dataset.resolve`） | 17,145.5 ms | 2.61% | 15,479.3 ms | — |
| 留档写库（`persistence.db_write`，跨境 TiDB） | 22,085.2 ms | 3.36% | **58,674.5 ms** | ⚠️ **环境恶化**（见下） |
| `loopRun` 自身（结果组装 / RunRecord / 序列化） | 1,472.0 ms | 0.22% | 2,108.5 ms | — |

> ⚠️ **AFTER 那次运行的留档写库从 22.1 s 涨到 58.7 s**：计数显示 `db.writes = 3`（BEFORE 是 2）
> —— 即跨境写首次失败、重试又失败、第 3 次才成功（`persistClosedLoopBacktestRun` 的有界重试救回了留档，
> 见 BACKTEST-002 §7.1）。这是**链路侧波动，与本次优化无关**。
> **剔除 DB 写库后的纯计算路径：`635,704 ms → 307,044 ms = 2.07×`** —— 与微观基准测得的 2.08× 完全吻合。
>
> **业务计数在两轮之间逐项相同**（`research.decision_days = 5,865`、`research.universe_member_slots = 853,527`、
> `backtest.trades = 327`、`research.signals_emitted = 1,016`、`run.resultJson_bytes = 43,903`），
> 唯一差异是 `db.reads 59→58` / `db.writes 2→3`（重试行为）。

### 1.3 已实施的优化（P0，1 处，逐字节等价）

| 优化 | Before | After | 改善 | 一致性 |
|---|---|---|---|---|
| `strategyCore/runtime.ts`：定义指纹**每次求值算 2 次** → **按定义对象缓存、每次求值取 1 次** | research 5,474.3 ms | **2,626.1 ms** | **2.08×** | `canonicalMetrics` / `equityDigest` / `tradeDigest` / `performance` / `riskAdjusted` / `tradeQuality` / 样本数 / `truncated` **全部逐项相等** |
| **同一优化的端到端效果**（完整真实 Run，同输入） | **657,796 ms** | **365,725 ms** | **1.80×** | 业务计数逐项相同、`resultJson` 43,903 B 一字不差、两个 digest 逐字节相同 |

> 端到端的 1.80× 被「跨境写库恶化（22.1 s → 58.7 s）」稀释；**剔除 DB 写库的计算路径 = 2.07×**。

### 1.4 明确结论（详见 §12）

| 问 | 答 |
|---|---|
| **A** 593 s 瓶颈 | 闭环 `optimization` 阶段的 12 组参数样本（92.83%），再往下是 `StrategyRuntime.evaluateWithDetail`（88.4% 的样本耗时）；**纯 CPU-bound**，不是 I/O / 网络 / 连接池 |
| **B** Dataset 是否「一次加载、多参数复用」 | **必须**。数据集装载 17.1 s，单组参数边际成本（复用数据集）2.5 s ⇒ 不重用就是「17.1 s × N」的纯浪费，且 1000 组会额外烧掉 4.75 小时 |
| **C** `StrategyRuntime.evaluate` 是否要优化 | **本轮已做掉最大的一块**（定义指纹 2.08×）。剩余最大候选是「同日二次求值」（占样本耗时 42.5%）与「参数解析/泄漏审计重复」，二者都**收益明确但需等价性论证**，留给 PARAMETER-001 |
| **D** Backtest Execution 是否要优化 | **不需要**。整个 `backtest` 阶段占 0.03%（主链 216.7 ms）／样本内 0.6%（3,761.5 ms ÷ 12） |
| **E** 是否该做 Batch Parameter Search | **该做，但收益来自「并行度」而非「批处理本身」**：链路纯 CPU 且无 IO ⇒ `worker_threads` 可近线性加速（本机 24 逻辑核） |
| **F** 100/500/1000 组在当前架构下是否可行 | 在「数据集一次装载 + 用户窗口」下：**100 组 ≈ 4.4 min、500 组 ≈ 22 min、1000 组 ≈ 43 min**（串行单进程）；**全部可行** |
| **G** PARAMETER-001 执行架构 | **B（Dataset Load Once + 多参数复用）为主体 + E/并行作为加速层**；明确划出 `Parameter-independent preparation` 与 `Parameter-dependent execution` 边界（§7） |
| **H** 是否可正式开工 | **可以**。`PARAMETER-001 = READY`（**不是 BLOCKED BY PERFORMANCE**）。但开工前必须先修 **DEFECT-1**（搜索窗口被错设成数据集整窗），否则「搜索 3 个月」实际是在搜 24 个月 |

---

## 2. 当前调用链（真实生产路径，已逐点核对代码）

```
client（/parameter-search 页 / 运行工作台）
  └── tRPC researchRun.loopRun                       server/researchRunRouter.ts:465
        ├── runWorkbenchStrategyService.loadVersion  → strategy_versions.strategyDocumentJson（真库）
        ├── assembleRunWorkbenchInputs               server/runWorkbenchAssembly/assemble.ts:935
        │     ├── resolveDataset                     assemble.ts:377
        │     │     ├── buildResearchDatasetFromRegistry  datasetFromRegistry.ts:934
        │     │     │     ├── registry.getVersionById / getDefinitionById     ← DB
        │     │     │     ├── readAllEvents（keyset 分页 5,000/页）             ← DB
        │     │     │     ├── reader.getPostRelativeDayRange                  ← DB
        │     │     │     ├── loadPrimaryIdentifiers（5,552 行）               ← DB
        │     │     │     ├── readEventBars（prefix rd=0 / post rd∈[1,end+1]；1,000/批 × 并发 16）← DB
        │     │     │     ├── buildWindowRows（投影 + 去重 + 排序）
        │     │     │     ├── buildUniverseDefinitionFromRows
        │     │     │     ├── computeDatasetVersion（canonicalStringify(112,920 行) + sha256）
        │     │     │     └── derivePolicySet
        │     │     └── primaryDatasetVersionIdOf → dataset_version.id = 390002（策略文档 PRIMARY 绑定）
        │     └── assembleStrategySide（**同步**；供参数评估器复用）assemble.ts:643
        │           ├── requireRecipe / resolveParameters
        │           ├── coreVersionFromDocument → createStrategyVersion（**定义指纹在此算一次**）
        │           ├── createDatasetEventResolver + createCoreDecisionSource
        │           └── experimentConfig / strategy13 / simulationConfig
        ├── createClosedLoopWiring                   closedLoopWiring/executors.ts:707
        └── runClosedLoop（14 阶段编排）              closedLoop/orchestrator
              ├── data        → projectDatasetSummary（零 IO）
              ├── research    → runCandidateEngine   signalEngine/engine.ts:124
              │                   ├── createDatasetSession（bind 校验 / 切片 / universe / dataSource）
              │                   └── 逐决策日 runResearchPipeline  framework/pipeline.ts:55
              │                         └── 逐成员 getBars → visibleBars → 特征 → signalBuilder
              │                               └── createCoreDecisionSource.signalBuilder  coreDecision.ts:170
              │                                     ├── StrategyRuntime.evaluateWithDetail（当日）  runtime.ts:174
              │                                     └── StrategyRuntime.evaluateWithDetail（截到昨天）← **同一判定算两遍**
              ├── strategy    → createStrategyDocument / createStrategyVersionRecord
              ├── backtest    → runTradeSimulation    simulator/engine.ts:248
              ├── evaluation  → canonicalMetrics + evaluatePerformance / RiskAdjusted / TradeQuality
              ├── optimization→ runParameterSearch（method=random, seed=17, budget=**12**）
              │                   └── createStrategyParameterEvaluator  strategyEvaluation/evaluator.ts:73
              │                         └── **每个样本**再走一遍 research → backtest → evaluation 子链
              ├── regime / robustness / oos / …（未注入 ⇒ 如实 BLOCKED）
              └── resultJson ← buildStrategyRunRecord + buildBacktestRunPayload
        └── persistClosedLoopBacktestRun → closed_loop_backtest_run（有界重试 ≤3 次）
```

**逐点核对结论（不是看文件名得出的）**：

1. `optimization` 的评估器 `createStrategyParameterEvaluator` **同步**执行，且**复用调用方持有的同一份 `ResearchDataset`**
   （`artifacts.dataset = input.dataset`，`executors.ts:114`）⇒ **数据集本身已经只装载一次**，
   「重复装载数据集」这个假设**不成立**（R-06 §6.1 的答案：否）。
2. 但评估器的 `dateRange` 取自 `dataset.dataSnapshot.request.{startDate,endDate}`（`executors.ts:649-652`），
   而直读桥把该快照的窗口设成**数据集版本自身的窗口**（`datasetFromRegistry.ts:1046-1053`）⇒
   **每个样本的求值窗口 = 数据集整窗**，与用户请求窗口无关。这是本次最重要的发现（§7 DEFECT-1）。
3. `coreDecision.ts` 对每个（证券 × 决策日）调用 `evaluateWithDetail` **两次**（当日 + 截到昨天），
   用于判定「首个成立日」（`coreDecision.ts:236-268`）。
4. `runtime.ts` 在**每次** `evaluateWithDetail` 里对**整份定义**算 **2 次** `computeDefinitionFingerprint`
   （`runtime.ts:437` 的 explanation + `runtime.ts:456` 的 decision）—— 全链路第一热点（§6）。

---

## 3. Profile 方法

### 3.1 两路证据（缺一不可）

| 路 | 机制 | 回答什么 |
|---|---|---|
| **阶段级剖析** | `server/observability/perfProfile.ts`（本轮新增；`PARAM_PROFILE=1` 才启用，默认**零影响**） | 「哪些阶段各花多少、被调多少次」——**墙钟**归属 |
| **V8 CPU 采样** | `node:inspector` 的 `Profiler.start`（1 ms 采样，进程内，`_probe_param001_pre_profile.mts`） | 「CPU 到哪去了 / 有没有在等 I/O」——**CPU** 归属 + 函数级 self time |
| **DB 往返计数** | `server/observability/dbHook.ts`（包住底层 mysql2 pool 的 `query`/`execute`） | 「有没有 N+1 / 跨境查询占多少」 |

### 3.2 剖析器的硬纪律（对齐规格 §4）

| 要求 | 落实 |
|---|---|
| 默认不影响生产 | `enabled` 在模块加载时读一次 `PARAM_PROFILE`；关闭时 `perfRun` 只有一次布尔判断，`perfCount` 布尔短路 |
| 不改变业务结果 | 只旁路计时/计数；DB 挂钩不改 SQL / 参数 / 返回（回调式与 Promise 式都原样透传） |
| 不改 DB Schema | 产物只进内存 + 落 JSON 文件；不进 `resultJson`、不建表 |
| 不把明细写库 | 同上 |
| 区分 CPU / DB / I/O / 转换 / 框架 | 阶段树给 CPU+框架，`db.*` 计数/刻度给 DB，CPU 采样给「CPU vs 等待」 |
| monotonic timer | 一律 `process.hrtime.bigint()` |
| 支持 nested stage | 帧栈 + 按标签路径聚合；`selfMs` = 自身墙钟 − 帧内子帧 |
| machine-readable + 人类可读 | `_probe_param001_pre_profile.json`（树 + 展平表 + 计数 + 刻度）与 stdout summary |

### 3.3 真实数据条件（与 BACKTEST-002 完全一致）

```
Strategy        : cand-360004@1.0.0（strategy_versions，实测存在）
Dataset         : dataset_version.id = 390002（status = READY，窗口 2024-09-01 ~ 2026-09-01）
运行窗口        : 2025-01-02 ~ 2025-03-31
initialCapital  : 100,000
executionModel  : NEXT_OPEN
执行政策        : production execution policy v1（BACKTEST_EXECUTION_POLICY_VERSION = 1）
数据集实况      : 23,978 事件 / 112,920 行 / 2,967 证券 / 487 个 universe 日 / post rd∈[1,20]
```

### 3.4 复现命令

```bash
# 权威 Profile（真实 Run，~11 min，会留 1 条新 Run）
node node_modules/tsx/dist/cli.mjs docs/evidence/_probe_param001_pre_profile.mts

# 阶段级微观基准（真实数据、零写库、~90 s；含单组参数边际成本 A/B）
PP_MARGINAL=1 PP_TAG=before node node_modules/tsx/dist/cli.mjs docs/evidence/_probe_param001_stage_bench.mts

# CPU 采样解析
python cpuprofile_report.py docs/evidence/_probe_param001_pre_profile.before.cpuprofile.json 55
```

---

## 4. 真实 Profile 数据（BEFORE）

**一次真实 Run**（BEFORE）：`experimentId = EXP-20260919-PARAM001PRE`、`runId = clrun-20260919083211921`、
`stages = 14`、`EXECUTED = data / research / strategy / backtest / evaluation / optimization`（6 个）、
`canonicalMetrics = { totalReturnPct: 4.0838490913999825, tradeCount: 3, winRatePct: 100 }`、
`equityDigest = d208a2d043cbb1f7…`、`tradeDigest = b1153182722d2e77…`。

**第二轮真实 Run**（AFTER，同一探针、同输入）：`runId = clrun-20260919090515703`，
`stages` / `EXECUTED` 集合 / `canonicalMetrics` / 两个 digest **与 BEFORE 完全相同**，墙钟 **365,725 ms**。

> 🔴 与 BACKTEST-002 留档的 `d208a2d0…` / `b1153182…` **逐字节相同** ⇒ 跨进程、跨会话、跨优化的确定性成立；
> 本次运行只多了一个插桩层，**没有改变任何数值**。

| 项 | BEFORE 实测 | AFTER 实测 |
|---|---|---|
| 墙钟 | **657,796 ms** | **365,725 ms** |
| 采样 CPU 总量 | 657,895 ms（≈ 100% 墙钟 ⇒ **进程全程 CPU-bound**） | （未采 CPU 档） |
| `(idle)` | 5.18%（34.1 s）⇒ 几乎没有等待 | — |
| `(garbage collector)` | 6.20%（40.8 s） | — |
| DB 往返 | **61** 次（59 读 + 2 写）—— **无 N+1** | **61** 次（58 读 + 3 写） |
| DB 读墙钟（各查询**并发求和**，非墙钟） | 101,430 ms | 93,406 ms |
| DB 总墙钟（读并发求和 + 写） | 122,974 ms | 151,173 ms |
| 数据集装载（墙钟） | 17,145.5 ms | 15,479.3 ms |
| 留档写库（墙钟，含失败重试 + 退避） | 22,085.2 ms | 58,674.5 ms（链路波动） |
| `resultJson` 体积 | 43,903 B | **43,903 B**（一字不差） |

### 4.1 为什么「同一次运行有两套墙钟」

`657,796 ms`（`Date.now()` 前后差）与 `657,789.3 ms`（`hrtime` 剖析）相差 7 ms；
而阶段之和 `657,750.3 ms` 与总墙钟的 39 ms 差额是「`loopRun` 装配 14 阶段结果对象 + 组 RunRecord」等未单独成节点的碎块。
**本报告一律使用 hrtime 值**。

---

## 5. 各阶段耗时

### 5.1 顶层四块（墙钟，降序）

| 组份 | wall (ms) | 占比 | 说明 |
|---|---|---|---|
| **`optimization` 阶段**（12 组参数样本） | **610,652.5** | **92.83%** | 每样本一次完整 `research→backtest→evaluation` 子链 |
| 留档写库 | 22,085.2 | 3.36% | 跨境 TiDB 单条 insert（含首失败 + 重试成功） |
| 数据集装载 | 17,145.5 | 2.61% | 见 §5.3 |
| **主链**（data+research+strategy+backtest+evaluation） | **6,395.1** | **0.97%** | **用户真正要跑的东西只占 1%** |
| `loopRun` 自身 | 1,472.0 | 0.22% | 14 阶段结果映射、RunRecord、payload |

### 5.2 阶段树（按规格 §4 的命名对齐）

| 规格要求的组 | 本轮埋点标签 | wall (ms) | self (ms) | calls |
|---|---|---|---|---|
| **PROFILE_TOTAL** | `run.loopRun_total` | 657,789.3 | 1,472.0 | 1 |
| PROFILE_DATASET | `dataset.resolve` | 17,145.5 | 2.8 | 1 |
| · dataset_query | `dataset.events_page` + `dataset.post_range` | 7,935.1 | — | 1 / 1 |
| · db_read | `dataset.bar_read`（prefix + post）+ `dataset.identity_bridge.read_identifiers` | 5,573.2 | — | 1 / 1 |
| · hydration / row_mapping | `dataset.projection`（含去重 + 合并 + 排序） | 427.0 | 427.0 | 1 |
| · index / build | `dataset.universe_build` + `dataset.data_snapshot` | 152.7 | — | 1 / 1 |
| · feature/path preparation | （无——本桥不预计算特征路径） | 0 | 0 | — |
| · 版本指纹（额外发现的大块） | `dataset.version_fingerprint` | 2,587.0 | 2,587.0 | 1 |
| · 其余 | `version_and_definition` / `definition_read` / `policy_set` | 424.2 | — | 1 / 1 / 1 |
| **PROFILE_RESEARCH** | `stage.research` × 13 | 612,706.8 | 2,587.9 | 13 |
| · context_build | `research.context_build`（`assembleStrategySide`） | 15.9 | 15.9 | 1 |
| · candidate preparation | `research.candidate_preparation` | 12.8 | 12.8 | 1 |
| · boundary preparation | `research.session_bind` / `_slice` / `_universe` / `_data_source` | 1,079.7 | — | 13 / 13 / 13 / 13 |
| · 决策日循环 | `research.decision_day_loop` | 608,763.6 | 325.7 | 13 |
| · 逐日 pipeline | `research.pipeline_per_day` | 608,447.4 | 21,051.4 | 5,865 |
| **PROFILE_STRATEGY** | `strategy.evaluate` + `_prev_day` + `_fingerprint` | 582,547.6 | 582,547.6 | — |
| · `StrategyRuntime.evaluate` | `strategy.evaluate` | 287,820.8 | 287,820.8 | 853,527 |
| · trigger evaluation（首个成立日判定） | `strategy.evaluate_prev_day` | 282,304.5 | 282,304.5 | 853,527 |
| · 决策摘要指纹 | `strategy.decision_fingerprint` | 17,270.7 | 17,270.7 | 853,527 |
| **PROFILE_BACKTEST** | `stage.backtest` × 13 | 3,978.2 | — | 13 |
| · decision_day_loop | `backtest.decision_day_loop` | 1,188.7 | 1,165.5 | 13 |
| · plan | `backtest.plan` | 23.2 | 23.2 | 5,865 |
| · 入参体检 / 绑定 | `backtest.row_precheck` / `dataset_bind` / `fingerprint` | 1,686.2 | — | 13 / 13 / 13 |
| · execution / position / equity | **未单独埋点**（见下方说明） | — | — | — |
| **PROFILE_METRICS** | `metrics.build_backtest_result`（canonicalMetrics + 载荷组装） | 0.3 | 0.3 | 1 |
| **PROFILE_EVALUATION** | `stage.evaluation` × 13（3 个评估器） | 75.4 | 75.4 | 13 |
| **PROFILE_PERSISTENCE** | | | | |
| · result serialization | `persistence.payload_serialization`（`buildBacktestRunPayload`） | 0.4 | 0.4 | 1 |
| · DB insert/update | `persistence.db_write` | 22,085.2 | 22,085.2 | 1 |

> **`execution` / `position` / `equity` 为什么不单独埋点（如实交代，不是漏做）**：
> 整个 `backtest` 阶段占本次运行 **0.03%**（主链 216.7 ms；样本内合计 3,761.5 ms = 0.57%）。
> 在该量级下再加三层微秒级埋点，测量开销会超过被测量本身，且对「参数搜索可行性」这个决策
> **零影响**。故本轮**有意**只埋到 `decision_day_loop` / `plan` 一级，并把这条边界写进报告，
> 而不是编一组数字填表。

### 5.3 数据集装载内部分解（17,145.5 ms）

| 子步骤 | wall (ms) | 占装载 | 机制 |
|---|---|---|---|
| `dataset.events_page` | 7,713.5 | 45.0% | keyset 分页读全部 23,978 事件（5,000/页 ⇒ **5 页**，串行） |
| `dataset.bar_read`（prefix ∥ post） | 4,317.5 | 25.2% | 48 批 × 并发 16 ⇒ **3 波**；前缀 23,978 行 / post 95,852 行 |
| `dataset.version_fingerprint` | 2,587.0 | 15.1% | `canonicalStringify(112,920 行)` + sha256（约 70 MB 中间串） |
| `dataset.identity_bridge.read_identifiers` | 1,255.7 | 7.3% | 读 `research_security_identifier_history` 全量 5,552 行 |
| `dataset.projection` | 427.0 | 2.5% | 逐事件展开 rd 窗口 → 去重合并 → 排序 |
| `dataset.post_range` | 221.6 | 1.3% | 取 post 的 rd 范围 |
| `dataset.version_and_definition` / `definition_read` | 423.7 | 2.5% | 版本 + 定义元数据 |
| `dataset.universe_build` / `data_snapshot` / `identity_bridge.resolve` / `policy_set` | 196.6 | 1.1% | 纯计算 |

**结论**：装载的 **70% 是 DB 往返**（events_page + bar_read + identifiers = 13,286.7 ms），
30% 是本地计算（指纹 2,587 ms 最大）。**装载本身不是瓶颈**（2.61%），但它**完全可以只做一次**，
这正是 §7 的复用边界第一条。

### 5.4 端到端 BEFORE / AFTER 逐节点对照（同输入、同插桩、同日）

| 节点 | BEFORE (ms) | AFTER (ms) | 倍数 |
|---|---|---|---|
| `run.loopRun_total` | **657,789.3** | **365,718.5** | **1.80×** |
| `run.stage_orchestration` | 617,057.2 | 289,410.9 | 2.13× |
| `@/stage.optimization` | 610,656.1 | **286,003.9** | **2.14×** |
| `@/stage.optimization/optimization.evaluate_sample` ×12 | 610,652.5 | 286,000.8 | 2.14× |
| └ `…/stage.research` ×12 | 606,556.6 | 281,546.2 | 2.15× |
| 　└ `…/research.decision_day_loop` ×12 | 602,768.0 | 277,584.5 | 2.17× |
| 　　└ `…/research.pipeline_per_day` ×5,808 | 602,456.3 | 277,268.4 | 2.17× |
| 　　　├ `strategy.evaluate` ×845,796 | 285,011.7 | **122,387.0** | **2.33×** |
| 　　　├ `strategy.evaluate_prev_day` ×845,796 | 279,555.2 | **115,850.3** | **2.41×** |
| 　　　└ `strategy.decision_fingerprint` ×845,796 | 17,096.2 | 21,594.3 | —（波动；此项**不可去**） |
| └ `…/stage.backtest` ×12 | 3,761.5 | 4,073.8 | —（噪声） |
| `@/stage.research`（主链，1 次） | 6,150.2 | **3,190.4** | **1.93×** |
| └ `strategy.evaluate`（主链，×7,731） | 2,809.1 | 1,303.1 | 2.16× |
| └ `strategy.evaluate_prev_day`（主链，×7,731） | 2,749.3 | 1,234.1 | 2.23× |
| `persistence.db_write` | 22,085.2 | **58,674.5** | ⚠️ 链路波动（`db.writes` 2→3） |
| `dataset.resolve` | 17,145.5 | 15,479.3 | —（装载受链路抖动，同一量级） |
| └ `dataset.events_page` | 7,713.5 | 5,055.6 | — |
| └ `dataset.bar_read` | 4,317.5 | 4,435.6 | — |
| └ `dataset.version_fingerprint` | 2,587.0 | 2,678.2 | — |
| └ `dataset.identity_bridge.read_identifiers` | 1,255.7 | 1,914.9 | — |

**业务计数在两轮间逐项相同**：`research.decision_days 5,865` / `research.universe_member_slots 853,527` /
`strategy.evaluate_calls 853,527` / `backtest.trades 327` / `research.signals_emitted 1,016` /
`dataset.rows_deduped 112,920` / `run.resultJson_bytes 43,903` —— **一个都没变**。

---

## 6. Top Bottlenecks（含函数级证据）

### 6.1 函数级 CPU self time（V8 1 ms 采样，535,406 个样本）

| self% | self (ms) | 函数 @ 文件 | 归属 |
|---|---|---|---|
| **28.75%** | **189,167** | `encode` @ `server/strategyCore/canonical.ts` | **canonical JSON 编码** |
| **14.69%** | **96,673** | `(anonymous)` @ `server/strategyCore/canonical.ts` | 同上（`encode` 内的闭包） |
| 8.23% | 54,115 | `set filename` @ native | 引擎侧（与 hash/frame 相关） |
| 6.20% | 40,815 | `(garbage collector)` | 由大量临时字符串/对象触发 |
| 5.18% | 34,069 | `(idle)` | 等待（几乎为零） |
| 4.65% | 30,582 | `__name` @ `strategyCore/temporal.ts` | tsx/esbuild 的 `keepNames` 助手（每次构造闭包都要跑） |
| 4.00% | 26,346 | `createDayScopedBarAccess` @ `temporal.ts` | 逐（成员 × 日）建访问关卡 |
| 3.65% | 23,993 | `__name` @ `strategyCore/runtime.ts` | 同上 |
| 2.71% | 17,827 | `update` @ `node:internal/crypto/hash` | sha256 |
| 2.53% | 16,671 | `(anonymous)` @ `strategyCore/decision.ts` | 决策对象深冻结/组装 |
| 1.68% | 11,080 | `runResearchPipeline` @ `research/framework/pipeline.ts` | 框架层 |
| 1.14% | 7,487 | `compareCondition` @ `ruleGraph.ts` | 规则求值 |
| 0.96% | 6,326 | `evaluateNode` @ `ruleGraph.ts` | 规则求值 |
| 0.78% | 5,134 | `canonicalJson` @ `canonical.ts` | 同上 |
| 0.76% | 5,012 | `parseStrategyFieldReference` @ `research/strategySchema/definition.ts` | 字段引用解析 |
| 0.70% | 4,585 | `parseCoreFieldReference` @ `strategyCore/fieldReference.ts` | 字段引用解析 |
| ≤0.5% | 各 <3,500 | `resolveParameters` / `detectParameterCycles` / `auditDefinitionLeakage` / `visibleBars` / `getBars` / `bindResearchDataset` / … | 都是小头 |

### 6.2 按文件聚合（self%）

| self% | self (ms) | 文件 |
|---|---|---|
| **44.30%** | **291,422** | **`server/strategyCore/canonical.ts`** |
| 22.72% | 149,468 | `(native)`（含 GC / hash / 引擎内建） |
| 8.70% | 57,266 | `server/strategyCore/temporal.ts` |
| 4.94% | 32,494 | `server/strategyCore/runtime.ts` |
| 3.03% | 19,939 | `server/strategyCore/ruleGraph.ts` |
| 2.99% | 19,644 | `node:internal/crypto/hash` |
| 2.85% | 18,719 | `server/strategyCore/decision.ts` |
| 1.90% | 12,520 | `server/strategyCore/parameterResolver.ts` |
| 1.68% | 11,080 | `server/research/framework/pipeline.ts` |
| 0.87% | 5,745 | `server/strategyCore/production/coreDecision.ts` |
| 0.78% | 5,109 | `server/strategyCore/leakageGuard.ts` |
| 0.76% | 5,012 | `server/research/strategySchema/definition.ts` |
| 其余 | <5,000 | … |

### 6.3 第一瓶颈的因果链（为什么 `canonical.ts` 能占 44%）

```
每个成员槽（853,527 个）：
  coreDecision.signalBuilder
    ├── StrategyRuntime.evaluateWithDetail（当日）           ← 1 次
    │     ├── computeDefinitionFingerprint(definition)      ← canonicalJson(整份定义) + sha256  ★
    │     └── ...（另有 1 次，见下）
    └── StrategyRuntime.evaluateWithDetail（截到昨天）        ← 1 次
          └── computeDefinitionFingerprint(definition)      ← 又来 2 次 ★
```
`runtime.ts` 原先在**每次**求值里调 `computeDefinitionFingerprint` **两次**（explanation 一次、decision 一次），
而 `runtime.ts:180` 写着 `const definition = version.definition` —— 一个**在整个运行里恒定不变**的不可变对象。

**次数账**：853,527 个成员槽 × 2 次求值 × 2 次指纹 = **3,414,108 次「整份定义 canonical 序列化 + sha256」**。
CPU 采样独立地指向同一个结论：`canonical.ts` 291.4 s ÷ 3,414,108 ≈ **85 µs/次**，量级自洽。

> ⚠️ 诚实边界：`__name`（11.4%）、`set filename`（8.23%）是 **tsx/esbuild 变换产物**带来的开销，
> 真实生产打包（`npm start`，esbuild bundle + `keepNames`）下**同类助手仍会存在**，
> 但其占比会随代码组织变化 ⇒ 本报告只把「文件级归因」当作方向性证据，
> **结论全部建立在阶段级插桩与计数之上**（那部分与打包方式无关）。

---

## 7. R-06 根因判断（逐条回答规格 §6 的 15 问）

### 7.1 结论

| # | 假设 | 实测答案 | 依据 |
|---|---|---|---|
| 1 | 整个 Dataset 在 Run 开始阶段被完整加载？ | **是**（一次性 112,920 行），且**只装一次** | `dataset.resolve` 只出现 1 次；`dataset.rows_deduped = 112,920` |
| 2 | 每个决策日重复查询 Dataset？ | **否** | DB 往返总数 **61**（59 读 + 2 写）；数据集装载后**零 DB 读** |
| 3 | 重复 hydration？ | **是，但不在数据层**：13 次 `createDatasetSession`（主链 1 + 样本 12）各自重建 `barsBySecurity` | `research.session_data_source` 13 次共 361.4 ms；`research.session_bind` 13 次共 705.2 ms |
| 4 | 重复构建 feature / path / index？ | **否**（桥不预建特征路径）；但**特征值在每个样本里重算**（参数相关，见 §8.3） | 无 `feature/path preparation` 埋点命中 |
| 5 | 存在 N+1 DB 查询？ | **否** | 61 次往返 / 一次完整运行 |
| 6 | 大量 JSON parse/stringify？ | **是，且是第一热点** —— 341 万次 canonical JSON + sha256（§6.3） | `canonical.ts` = 44.30% CPU |
| 7 | 跨进程 / 网络调用？ | 有跨**境**（TiDB us-east-1），但**占比小** | DB 相关墙钟 ≈ 39 s（装载 17.1 + 写 22.1）= 5.97% |
| 8 | 同步阻塞？ | **是，且这是主因** —— 整条链在 Node 主线程同步跑 | 采样 CPU ≈ 墙钟；`(idle)` 仅 5.18% |
| 9 | TiDB 查询本身很慢？ | 单次查询 **1.7 s 均值**（59 读 / 101.4 s 求和），符合跨境 RTT 208 ms + 大数据量；**不是瓶颈** | §5.3 |
| 10 | 连接池等待？ | **否** | 并发 16 的批读在 `bar_read`（4.3 s 墙钟）内完成，无排队证据 |
| 11 | 代理 / 网络延迟？ | **否**（见 9/10） | DB 总账 5.97% |
| 12 | cache miss？ | **是（本轮已修）**：定义指纹**没有任何缓存**，同一不可变对象被算 341 万次 | §6.3 + §9 |
| 13 | 不必要的完整 Dataset materialization？ | **否** —— 112,920 行装载 **17.1 s / 2.61%**，且是后续所有计算的必要输入 | `dataset.resolve` |
| 14 | 每次 `evaluate` 重复准备相同上下文？ | **是**：① 定义指纹（已修）② 参数解析（`resolveParameters` 每次重跑）③ 静态泄漏审计（`auditDefinitionLeakage` 每次重跑）④ 同日二次求值 | §6.1 函数表；②③ 共约 4% CPU |
| 15 | evaluation 实际占用很大？ | **否** —— `stage.evaluation` 60.7 ms（12 样本合计）+ 8.0 ms（主链）= **0.01%** | §5.2 |

### 7.2 <a id="defect-1"></a>「为什么 3 个月 593 s ≈ 1 个月 616 s」——**根因，并登记为 DEFECT-1**

**因为 92.83% 的耗时不在请求窗口里。**

```
用户请求窗口 2025-01-02~2025-03-31（57 决策日）
   ├── 主链：真的是这 57 个决策日            →  6,395 ms   （0.97%）
   └── optimization 阶段 12 组样本
         每组窗口 = dataset.dataSnapshot.request = 数据集版本窗口 2024-09-01~2026-09-01
                                                       ↓
                                              484 个决策日（9.28×）
         12 组 × 47~51 s ≈ 610,653 ms        （92.83%）
```
把请求窗口从 3 个月改成 1 个月，**只影响那 0.97%**；剩下 92.83% 的窗口来自数据集版本自身，**恒定不变**。
这就是「窗口缩短后几乎没有改善」的**结构性原因**（不是环境噪声）。

#### DEFECT-1（🟠 中，未修，已量化）

> **闭环 `optimization` 阶段的参数样本，其求值窗口取自 `dataset.dataSnapshot.request.{startDate,endDate}`
> —— 也就是「数据集版本自身的窗口（2024-09-01~2026-09-01，484 个决策日）」，而不是「本次运行声明的窗口
> （2025-01-02~2025-03-31，57 个决策日）」。**

- **代码位置**：`server/research/closedLoopWiring/executors.ts:646-656`（`evaluatorInput.dateRange`）
  ← 值来自 `server/runWorkbenchAssembly/datasetFromRegistry.ts:1046-1053`（直读桥把
  `dataSnapshot.request` 设为版本窗口）。
- **影响**：① 每组贵 **9.28×**（实测 46,739 ms vs 5,039 ms / 组）；
  ② 更严重的是——**搜索结论属于另一个时间段**，用户以为在搜 3 个月，实际在搜 24 个月。
- **量化**：真实 Run 的 optimization 阶段 610.7 s；改用运行窗口后同 12 组应为
  `12 × 2,500 ms = 30 s`（AFTER 值）⇒ 单点可省 **~256 s**。
- **本轮为什么不修**：修它会改变 `optimizationRef` 的内容（`region` / `candidates` / `consistency.note`），
  违反规格 §10「任何性能优化必须证明 Before Result == After Result」。
  它是**缺陷修复**，必须与「搜索窗口语义」一起在 PARAMETER-001 明确后落地（见 §14.1 第 0 步）。

### 7.3 「为什么从 14.3 s 变成 593 s（≈41×）」——**根因**

| 时点 | 同策略 / 同数据集 / 同窗口实测 | `optimization` 阶段状态 | 依据 |
|---|---|---|---|
| 2026-09-14 | **14.3 s** | **未接线**（`CL_RUNNER_NOT_INJECTED`） | 当日全部 4 条留档 Run 实测 `optimization(CL_RUNNER_NOT_INJECTED)`；14.3 s 出自 `_probe_dataset_window_run_e2e.mts`（同策略 `cand-360004@1.0.0`、同 `dataset_version.id=390002`、同 112,920 行、同窗口），见 `docs/evidence/README.md` |
| 2026-09-19（本轮） | **657.8 s（插桩）／593.3 s（无插桩）** | **EXECUTED**，12 组样本 | `stages[].state` 实测；`optimization.samples = 12` |

**⇒ 41× 的差额 = 「`optimization` 阶段被接线」这一件事。** `optimization` 阶段一旦执行，
就在同一条链上追加 **12 次**完整 `research→backtest→evaluation`；而每次的窗口又是数据集整窗（9.28×）
⇒ 相对主链的放大倍数 = `12 × (样本窗口/请求窗口) ÷ 1` ≈ 12 × 8.49 ≈ **102×**，与实测的
`610,652.5 / 6,395.1 ≈ 95.5×` 同量级。

> ⚠️ **必须如实标注的一条未闭合证据链**：14.3 s 那次运行留下了 **1 条留档行**，
> 但当前 `closed_loop_backtest_run` 里**找不到**对应行（现有 6 条中无 `cand-360004` @ 2026-09-14），
> 因此**无法**逐字节复核它的 `stages`。上述判断的立足点是**同期（2026-09-14）其它 Run 的 `optimization`
> 状态经实测为未接线**，属**强旁证**而非直接铁证。另需注意：14.3 s 那次是 **35 笔成交**，
> 本轮是 **3 笔**，中间还有 STRATEGY-ARCH-002（Core 逐决策日求值）与 BACKTEST-001（涨跌停拦截）
> 两次**行为变更**，所以「41×」里**混有行为差异**，不能全部归因于 optimization 接线。

### 7.4 环境因素排除

BACKTEST-002 收尾时怀疑「当天 `tushare*` 用例整片超时 ⇒ 环境（网络 / DB 链路）异常」。
本轮证据**否定**了这一嫌疑对本次运行的适用性：

- DB 总账（装载 + 写库）= **39.2 s = 5.97%**；
- CPU 采样总量 ≈ 墙钟（`(idle)` 5.18%）⇒ **没有在等链路**；
- 数据集装载 17.1 s，与 `_probe_bridge_window_cost.mts` 历史实测的 **16.5 s** 完全一致 ⇒ 链路状态正常。

---

## 8. Dataset 可复用性分析

### 8.1 ✅ 可复用（Parameter-independent）

| 对象 | 复用理由 | 现状 |
|---|---|---|
| `ResearchDataset`（`rows` 112,920 / `universeDefinition` 487 天 / `policySet` / `dataSnapshot`） | 只由（数据集版本 × 窗口投影）决定，与参数无关 | **已支持**：`assemble.ts#resolveDataset` 的 `researchDataset` 注入路径（`datasetSource = "injected"`） |
| `datasetVersion`（内容指纹） | 内容寻址，同内容同版本 | 同上一份对象 |
| Dataset Registry 直读（事件 + 行情 + 身份桥接） | 与参数无关 | 装载一次 **17.1 s** |
| `strategy_versions.strategyDocumentJson` 与 `StrategyVersion`（含**定义指纹**） | 参数**不属于**定义指纹面（`FINGERPRINT_SCOPES` 明列）；参数只改 `parameterSet` | 本轮 P0 已把定义指纹做成按定义对象缓存 |
| 交易日序列 / universe 逐日成员 / 决策日序列 | 由 dataset + 窗口决定 | 现状：每样本重建（`session_slice` / `session_universe`） |
| `barsBySecurity` 索引（`createDatasetDataSource`） | 同上 | 现状：每样本重建（`session_data_source`，13 次共 361 ms） |
| `bindResearchDataset` 的全量不变量校验 | 同上 | 现状：每样本重跑（`session_bind` 645 ms + `backtest.dataset_bind` 718 ms） |
| 静态泄漏审计 `auditDefinitionLeakage` | 纯函数 of（定义, 注册表） | 现状：**每次求值都重跑** |
| 参数解析 `resolveParameters`（当 parameterSet 未预解析时） | 纯函数 of（schema, values） | 现状：**每次求值都重跑** |
| `canonicalMetrics` / 评估器 / 载荷（按"每组结果"算） | 输入是每组自己的曲线 | 无需复用 |

### 8.2 🔴 参数相关（Parameter-dependent，必须每组重算）

- `strategy parameters` / 触发阈值 / 入场阈值 / 退出参数 / `position sizing` / 止损 / 止盈 / 持有期
  → 全部经 `recipeRuntime.resolveParameters(document.parameters, parameterOverrides)` 进入 `parameterSet`；
- 由参数参与的门槛判定（`Expr.param(...)`）与由此产生的信号 / 排序 / 选择；
- 由信号驱动的订单、成交、持仓、权益曲线；
- 由曲线算出的 `canonicalMetrics` 与三个评估器的标量。

### 8.3 ⚠️ 「看起来可复用、其实不能」的一项（必须显式登记）

**特征值（`featureValueAt`）不能跨参数复用。** `runtime.ts:247-253` 把
`parameters: resolved.values` 传给 `featureDefinition.compute(...)` ⇒
**特征值可能依赖参数**。当前配方（`pullbackFeatures`）的实现恰好不读参数，但那是**实现的巧合**，
不是契约。想预计算特征就必须先有「特征声明的参数依赖集」（例如
`FeatureRequirement.parameterDependencies`）——那属于 Core 契约变更，**本轮不做**（规格 §2 禁止顺手扩面）。
⇒ **PARAMETER-001 若要用特征预计算加速，必须先补这条声明**；否则只能按本报告的边界走。

---

## 9. Parameter-independent / Parameter-dependent 边界 + Execution Context

### 9.1 边界（两个阶段）

```
┌──────────────────────── Parameter-independent preparation（每次搜索只做一次）────────────────────────┐
│  P0  Dataset Registry 直读 → rows(112,920) / universeDefinition(487 天) / policySet / dataSnapshot  │
│  P1  computeDatasetVersion → datasetVersion（内容指纹）                                              │
│  P2  bindResearchDataset 全量校验 + createDatasetDataSource(barsBySecurity) + sliceRowsByDateRange   │
│  P3  universe 逐日成员 + 决策日序列（窗口内）                                                         │
│  P4  strategyDocument → StrategyVersion（含定义指纹）+ 静态泄漏审计报告                                │
│  ── 产出：Immutable Shared Research Context ──                                                       │
└───────────────────────────────┬───────────────────────────────────────────────────────────────────┘
                                │  （只读共享；禁止任何一组参数修改它）
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   ┌─────────┐             ┌─────────┐             ┌─────────┐
   │ Set #1  │             │ Set #2  │   ......    │ Set #N  │   Parameter-dependent execution
   └────┬────┘             └────┬────┘             └────┬────┘
        │  resolveParameters(overrides) → 逐决策日 StrategyRuntime.evaluate
        │  → signals → ranking → selection → 订单/成交/持仓 → equityCurve
        │  → canonicalMetrics（+ 三个评估器标量）
        ▼
   每组结果（可比较标量 + 指纹）
```

### 9.2 `Parameter Search Execution Context`（建议的显式契约）

```ts
/** 参数无关的共享上下文：**不可变**，N 组参数共享同一实例。 */
interface ParameterSearchExecutionContext {
  readonly dataset: ResearchDataset;              // P0
  readonly datasetVersion: string;                // P1
  readonly session: DatasetSession;               // P2/P3（bind + bars 索引 + 切片 + 决策日）
  readonly strategyVersion: StrategyVersion;      // P4（定义 + 定义指纹 + 泄漏审计报告）
  readonly document: StrategyDocument;
  readonly simulationConfigBase: SimulationConfig;// 除参数外的执行假设（政策 v1）
  readonly costModel: CostModel;
  readonly executionModel: ExecutionModelId;
  readonly dateRange: { startDate: string; endDate: string };  // ← 必须是**运行声明的窗口**（见 DEFECT-1）
  readonly runMetadata: { codeVersion: string; createdAt: string };
}

/** 单组参数的执行结果（与现有 SearchRun 的 evaluatedSamples 一项一一对应）。 */
interface ParameterSetOutcome {
  readonly status: "succeeded" | "failed";
  readonly totalReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly tradeCount: number | null;
  readonly error: string | null;
}
```

**执行契约（3 条硬约束）**：

1. `prepare(...) → ParameterSearchExecutionContext` **只调用一次**；
2. `evaluateOne(context, parameterSet) → ParameterSetOutcome` **可被并行调用 N 次**，
   且**不得**写 context、不得跨组共享可变状态（当前 `evaluateOneParameterSet` 已满足：它每次
   新建 `artifacts` 与 `stageRunners`，见 `evaluator.ts:112-118`）；
3. **结果顺序**：`runParameterSearch` 的 `evaluatedSamples` 是**按采样顺序** push 的
   （`parameterSearch/run.ts:160`）⇒ 并行执行**必须**按样本序号回填，
   否则 `computeParameterSearchRunFingerprint` 会变 ⇒ 「同 seed 同 budget 同结果」的确定性会被破坏。

---

## 10. 100 / 500 / 1000 参数的理论成本

### 10.1 单组参数的**真实边际成本**（实测，不是估算）

| 窗口 | 决策日 | 成员槽 | research | backtest | evaluation | **合计/组** |
|---|---|---|---|---|---|---|
| **用户请求窗口**（2025-01-02~03-31） | 57 | 7,731 | 4,900 ms | 137 ms | 0.2 ms | **5,039 ms** |
| **数据集整窗**（2024-09-01~2026-09-01） | 484 | 70,483 | 46,430 ms | 307 ms | 1.2 ms | **46,739 ms** |

> **9.28×**。这正是闭环 `optimization` 阶段实际付的价（见 §7 DEFECT-1）。
> 数据集装载 **17,145 ms** 是一次性成本（复用路径下不进边际）。

### 10.2 理论成本表（BEFORE，串行单进程）

| 组数 | ① 当前闭环架构（数据集整窗 + 每组一套子链） | ② 仅复用数据集 + 用户窗口 | ③ 复用 + 8 worker 并行（投影） |
|---|---|---|---|
| 1 | 0.4 min | 0.4 min | 0.4 min |
| 10 | 4.0 min | 1.1 min | 0.4 min |
| 100 | **36.3 min** | **8.7 min** | **1.3 min** |
| 500 | **3.0 h** | **42 min** | **5.5 min** |
| 1000 | **6.0 h** | **1.4 h** | **10.7 min** |

（① = `N × 46.7 s`；② = `17.1 s + N × 5.04 s`；③ = `17.1 s + ceil(N/8) × 5.04 s`，并已扣除
本机 CPU 24 逻辑核的余量判断，取保守的 8 并行。含数据集装载一次。）

### 10.3 P0 优化后的成本表（AFTER，实测）

| 项 | BEFORE | AFTER | 倍数 |
|---|---|---|---|
| research（主链 57 日 / 7,731 槽） | 5,474.3 ms | **2,626.1 ms** | **2.08×** |
| 边际/组（用户窗口） | 5,039 ms | **2,500 ms** | **2.02×** |
| 边际/组（数据集整窗） | 46,739 ms | **21,748 ms** | **2.15×** |

| 组数 | ① 当前闭环架构（整窗，串行） | ② 复用 + 用户窗口（串行） | ③ 复用 + 用户窗口 + 8 worker |
|---|---|---|---|
| 1 | 0.4 min | 0.3 min | 0.3 min |
| 10 | 3.6 min | 0.6 min | 0.4 min |
| 100 | 36.2 min | **4.4 min** | **0.7 min** |
| 500 | 3.0 h | **21 min** | **2.8 min** |
| 1000 | 6.0 h | **42 min** | **5.4 min** |

**⇒ 规格 §12.F 的答案：100 / 500 / 1000 组在「复用数据集 + 用户窗口」下全部可行**
（1000 组串行约 42 min；若再加 8 worker 并行约 5.4 min）。

### 10.4 一次闭环 Run 在修掉 DEFECT-1 后的预期（算术投影，非实测）

```
                        分组项            BEFORE 实测    AFTER 实测    修 DEFECT-1 后（投影）
数据集装载                 17,145 ms      15,479 ms     15,479 ms
主链（含 eval）             6,395 ms       3,406 ms      3,406 ms
optimization（12 组）     610,653 ms     286,001 ms     30,000 ms   ← 12 × 2,500 ms（AFTER 边际成本）
留档写库                   22,085 ms      58,675 ms     22,085 ms   ← 按 BEFORE 的链路状态
loopRun 自身                1,472 ms       2,109 ms      2,109 ms
────────────────────────────────────────────────────────────────────
合计                      657,750 ms     365,671 ms     ≈ 73,079 ms
```
**⇒ HEAD 门到门 657.8 s → 365.7 s（已实现 1.80×）→ 修 DEFECT-1 后 ≈ 73 s（合计 9.0×）。**

---

## 11. 已实施的优化（只实施必要且最小）

### 11.1 优化清单

| # | 级别 | 位置 | 改动 | 依据（实测） |
|---|---|---|---|---|
| **P0-1** | P0 | `server/strategyCore/runtime.ts`（+ `canonical.ts` 无改动） | 定义指纹：**按 `definition` 对象身份 `WeakMap` 缓存**，且每次求值**只取一次**（原为两次） | `canonical.ts` 占 **44.30%** CPU；341 万次「整份定义 canonical 序列化 + sha256」 |

**改动规模**：`runtime.ts` 新增 1 个 `WeakMap` + 1 个取值函数（约 35 行注释 + 8 行代码，含原理与等价性论证），
两处调用点改为引用同一个局部值。**未改任何契约、未改任何产物、未动 DB / Schema / 执行政策 / Canonical Metrics。**

### 11.2 为什么它是「逐字节等价」而不是「近似」

1. `computeDefinitionFingerprint(definition) = sha256(canonicalJson(fingerprintPayload(definition)))` ——
   **纯函数**：除 `definition` 外不读任何东西（`canonical.ts` 头注释明列无 IO / 无 `Date.now` / 无随机）；
2. `StrategyCoreDefinition` **不可变**（`deepFreezeCoreDefinition`；`StrategyVersion` 内容永不可变，
   改内容只能产出**新版本** —— 这正是 ARCH-001 用 `updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE` 钉住的约束）；
3. ⇒「同一对象 ⇒ 同一字符串」是**函数性质**。缓存只省掉重复求值，返回值与原实现**同值同字节**。
4. 用 `WeakMap`（而非带 TTL 的 Map）：键是对象身份 ⇒ 不阻止 GC、不跨定义串味、无失效逻辑；
   一次进程内条目数 = 本次运行涉及的定义份数（主链 1 + 每个搜索样本 1）。

### 11.3 明确**不实施**的优化（只记录，理由充分）

| 候选 | 预估收益 | 为什么不实施 |
|---|---|---|
| 同日二次求值去重（`strategy.evaluate_prev_day` 用当日的 `satisfiedToday` 结果代替） | **42.5% 的样本耗时** | 需证明「`resolveQuiet` 与 `resolve` 对判定结果等价」+「`datasetCapability.minBarCount` 两侧同值」。这两条当前**成立但不显然**，属 Core 语义面改动 ⇒ 按规格 §10（Before==After）与「不修改 Core 语义」留给 PARAMETER-001，并附等价性论证提纲 |
| `resolveParameters` 每次求值重跑 | ~3% | 需设计缓存键（schema × values），收益中等、键设计有风险 ⇒ 记录 |
| `auditDefinitionLeakage` 每次求值重跑 | ~1.2% | 同上（需确认报告对象不被消费方改动） |
| `computeDatasetVersion` 换 `computeDatasetVersionStreaming` | ~2.5 s（装载的 15%） | 仅占整次运行 **0.39%**；且属「微优化」⇒ 记录 |
| `bindResearchDataset` / `createDatasetDataSource` 跨样本复用 | ~1.1 s/13 次 ≈ 0.17% | 同上；且真正需要它的是 PARAMETER-001 的**复用层**（那里一次就够，无需改现有代码） |
| `__name` / `createDayScopedBarAccess` 重建（temporal.ts 12.7%） | 待定 | 需要重排闭包结构（Core 内部重构），且归因受 tsx 变换影响 ⇒ 只记录 |
| 修 DEFECT-1（搜索窗口 = 数据集整窗） | **9.28×** | **它是缺陷修复而非性能优化**：会把 `optimizationRef` 的语义与内容一起改掉，违反规格 §10「性能优化必须 Before==After」⇒ 本轮**只登记、不实施**，交 PARAMETER-001 明确定义窗口语义后一并落地 |

---

## 12. 优化前后结果一致性

### 12.1 判据（规格 §10 要求的全部字段）

同一输入（`cand-360004@1.0.0` / `dataset_version.id=390002` / `2025-01-02~2025-03-31` /
`initialCapital=100,000` / `executionModel=NEXT_OPEN` / policy v1）在**同一台机器、同一天**跑两次：

| 判据 | BEFORE | AFTER | 相等？ |
|---|---|---|---|
| `canonicalMetrics`（全字段逐项） | 见下 | 见下 | ✅ **完全相等** |
| · `totalReturnPct` | 4.0838490913999825 | 4.0838490913999825 | ✅ |
| · `tradeCount` | 3 | 3 | ✅ |
| · `winRatePct` | 100 | 100 | ✅ |
| · `annualizedReturnPct` / `maxDrawdownPct` | 同 | 同 | ✅ |
| `equityDigest` | `d208a2d043cbb1f7…` | `d208a2d043cbb1f7…` | ✅（**逐字节**） |
| `tradeDigest` | `b1153182722d2e77…` | `b1153182722d2e77…` | ✅（**逐字节**） |
| `equitySamples` / `tradeSamples` 条数 | 57 / 3 | 57 / 3 | ✅ |
| `truncated` | `{equity:false, trades:false}` | 同 | ✅ |
| `performance`（评估器全字段） | — | — | ✅ |
| `riskAdjusted`（Sharpe / Sortino / Calmar …） | — | — | ✅ |
| `tradeQuality`（评估器全字段） | — | — | ✅ |
| 主链决策日 / 成员槽 | 57 / 7,731 | 57 / 7,731 | ✅ |
| 边际组（用户窗口）成交数 / 收益率 | 3 / 4.0838490913999825 | 3 / 4.0838490913999825 | ✅ |
| 边际组（数据集整窗）成交数 / 收益率 | 27 / −45.002630859300005 | 27 / −45.002630859300005 | ✅ |
| `equityDigest`（边际组 · 整窗） | — | — | ✅ |
| `tradeDigest`（边际组 · 整窗） | — | — | ✅ |

**端到端追加判据（两次独立进程的完整真实 Run）：**

| 判据 | BEFORE | AFTER | 相等？ |
|---|---|---|---|
| `stages[].state`（14 阶段） | EXECUTED 6 / BLOCKED 8 | 同 | ✅ |
| `runnerInjected` | `data/research/strategy/backtest/evaluation/optimization/regime` | 同 | ✅ |
| `research.decision_days` | 5,865 | 5,865 | ✅ |
| `research.universe_member_slots` / `strategy.evaluate_calls` | 853,527 / 853,527 | 853,527 / 853,527 | ✅ |
| `research.signals_emitted` | 1,016 | 1,016 | ✅ |
| `backtest.trades` / `backtest.equity_points` | 327 / 5,865 | 327 / 5,865 | ✅ |
| `dataset` 计数（events / rows_raw / rows_deduped / bars_prefix / bars_post） | 23,978 / 119,830 / 112,920 / 23,978 / 95,852 | 同 | ✅ |
| `optimization.samples` | 12 | 12 | ✅ |
| `run.resultJson_bytes` | **43,903** | **43,903** | ✅ |
| 主链 `equityDigest` / `tradeDigest` | `d208a2d0…` / `b1153182…` | `d208a2d0…` / `b1153182…` | ✅ **逐字节** |
| 唯一差异 | — | `db.reads 59→58`、`db.writes 2→3` | 环境重试行为，非业务结果 |

> 一致性判据**不是**「跑一遍没报错」，而是：**两条不同窗口的曲线 × 两个独立进程 × 优化前后**
> 共 4 组比对，`canonicalMetrics` / 两个 digest / 三个评估器输出全部**逐项或逐字节相等**。
> 其中「整窗组 27 笔成交、−45.00%」这条尤其重要：它是一条**有亏损**的曲线，
> 覆盖了 `averageLossPct` / `profitFactor` 的分支（防止「只有盈利笔」的退化路径掩盖差异）。

### 12.2 确定性（跨进程）

- 本轮 4 个独立进程（BEFORE/AFTER × 主链/边际）产出的 `equityDigest` / `tradeDigest` 与
  **BACKTEST-002 落库值**（`d208a2d0…` / `b1153182…`）**逐字节相同**；
- ⇒ 「同输入 ⇒ 同 Result」在优化前后、跨进程、跨会话三条维度上都成立。

### 12.3 回归测试

| 命令 | 结果 |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | **0 error** |
| `node node_modules/vitest/vitest.mjs run tests/server/strategyCore` | **11 文件 / 163 用例 / 0 failed**（优化前 10 文件 / 158 用例 ⇒ 新增 1 文件 / 5 用例） |
| `node node_modules/vitest/vitest.mjs run`（**全量**） | **8 失败文件 / 17 失败用例 / 4,543 用例 / 275 文件** ⇒ 与 BACKTEST-002 基线（8 失败文件 / 17 用例；用例 4,538 / 文件 274）**逐项一致**（`newFail = NONE`；用例 +5 = 本轮新增） |
| 新增回归文件 | `tests/server/strategyCore/definitionFingerprintCache.test.ts`（5 例：① 重复求值指纹稳定 ② explanation 的 12 位前缀零漂移 ③ 内容相同对象不同 ⇒ 指纹相同 ④ 行为面不同 ⇒ 指纹必须不同（缓存不得串味）⑤ 同定义不同参数 ⇒ 定义指纹相同但行为可变） |
| 既有等价性断言 | `tests/server/strategyCore/runtimeAndAdapter.test.ts:70` 本就断言 `decision.definitionFingerprint === computeDefinitionFingerprint(version.definition)` ⇒ **Before/After 的等价性由既有测试直接钉住** |
| `optimizationStage.test.ts` | ✅ 通过（`optimization` 阶段的插桩未改变其交接产物） |
| `node scripts/checkEolDrift.mjs` | **0 漂移**（已跟踪 0 / 未跟踪新文件 CRLF 0） |

基线失败集合（未变，均与本任务无关）：`dataHealth` / `image.uploadAndRecognize` / `limitUp` /
`limitUp.watch` / `marketData` / `researchCore/candidates.updateBoundary` / `tushare.secret` /
`tushareTradingCalendar`。

---

## 13. 推荐的 Parameter Search Execution Architecture（规格 §13：A~E 选型）

### 13.1 选型判定

| 方案 | 判定 | 理由（实测依据） |
|---|---|---|
| **A. 单次 Run 重复执行** | ❌ **不可用** | = 现在的闭环 `optimization`：每组付「数据集整窗 × 完整子链」= 46.7 s/组（BEFORE）⇒ 1000 组 6 小时 |
| **B. Dataset Load Once + 多参数复用** | ✅ **必选，作为主体** | 数据集装载 17.1 s 与参数无关；复用后边际成本 5.04 s（BEFORE）/ **2.50 s（AFTER）** |
| **C. Batch Parameter Execution** | ⚠️ **收益来自并行度，不来自"批"本身** | 链路**纯 CPU、零 IO**（DB 只用于装载/写档）⇒ 真正的加速是 `worker_threads` 并行；只是把 N 组塞进一个循环并不会更快 |
| **D. 预计算 Dataset Feature / Path** | ⛔ **当前不可做** | 特征值可依赖参数（`runtime.ts` 把 `resolved.values` 传给 `featureDefinition.compute`）⇒ 预计算会**静默改变结果**；除非先补「特征 → 参数依赖」声明（Core 契约变更，本轮禁做） |
| **E. 其他** | ⚠️ 补两条 | ① **修 DEFECT-1**（窗口语义）—— 单点的 9.28×；② **固化「一次 prepare + N 次 evaluate」为显式契约**（§9.2），让并行与串行共用同一份记录生成路径 |

### 13.2 推荐架构（最终形态）

```
                     ┌──────────────────────────────────────────────┐
                     │  主进程（负责任务编排、进度、留档、取消）      │
                     │  prepareOnce() → Immutable Shared Context     │
                     └───────┬──────────────────────────┬───────────┘
                             │ 共享（结构化克隆一次/worker 或 worker 自建）
      ┌──────────────────────┼──────────────────────┬──────────────────┐
      ▼                      ▼                      ▼                  ▼
  worker #1              worker #2              worker #3     ...  worker #W
  evaluate(context, s₁)  evaluate(context, s₂)  …                       （sᵢ 为参数集）
      │                      │                      │
      └──────────────────────┴──────────────────────┘
                             │  按**样本序号**回填结果（保持 evaluatedSamples 顺序）
                             ▼
              runParameterSearch 的 SearchRun 记录（指纹确定性不变）
                             ▼
              candidate strategies / region verdict / 留档
```

**关键设计点（每条都有实测/代码依据）**：

1. **窗口语义必须显式**：`dateRange` 来自**运行声明的窗口**，不是 `dataset.dataSnapshot.request`（DEFECT-1）；
2. **`evaluatedSamples` 顺序不可变**：`parameterSearch/run.ts:160` 按采样序 push ⇒ 并行结果按序回填，
   否则 `computeParameterSearchRunFingerprint` 变化，「同 seed/budget ⇒ 同记录」被破坏；
3. **worker 数 ≤ min(物理核数, 可用内存 / 单份上下文内存)**：本机 **24 逻辑核 / 12 物理核 / 34.3 GB（空闲 8.2 GB）**；
   保守取 8；
4. **并行度不影响结果**：单组评估是纯函数（`evaluateOneParameterSet` 每次新建 `artifacts` + `stageRunners`，
   不共享可变状态）⇒ 并行与串行结果逐项相同（可用 §12 的判据复核）；
5. **不新增第二套回测链**：worker 内仍走 `createClosedLoopStageRunners` + `research/backtest/evaluation`
   三支既有执行器（`evaluator.ts` 已是这个形状）——只改**调度层**，不改**计算层**。

### 13.3 本轮已具备 vs 需新增

| 能力 | 状态 |
|---|---|
| 数据集复用（`researchDataset` 注入 + `datasetSource="injected"` 诚实标注） | ✅ **已具备** |
| 同步「参数集 → 标量」评估器（`createStrategyParameterEvaluator`） | ✅ **已具备** |
| 纯函数搜索器 + 确定性采样（`runParameterSearch`, seed, budget） | ✅ **已具备** |
| 稳定区判定 / 候选产出 / SearchRun 指纹 | ✅ **已具备** |
| 定义指纹缓存（本轮 P0） | ✅ **本轮新增** |
| 显式 `ParameterSearchExecutionContext`（P2/P3 的 bind/切片/universe/bars 索引也复用） | ❌ 需新增（收益 ~4% ⇒ 可延后） |
| worker 并行调度层 | ❌ 需新增（收益 = 并行度，本机最多约 8×） |
| **搜索窗口语义修正（DEFECT-1）** | ❌ **必须先修** |

---

## 14. PARAMETER-001 实施建议

### 14.1 顺序（建议）

| 步 | 内容 | 验收 |
|---|---|---|
| **0** | **修 DEFECT-1**：把 `closedLoopWiring/executors.ts` 的 `optimization` 评估器窗口从 `dataset.dataSnapshot.request.*` 改为**运行声明的窗口**（`inputs.experimentConfig.dateRange` / `simulationConfig.dateRange`，二者在装配层同源）；并把「搜索窗口 = ?」写进 `optimizationRef.consistency.note` | 一次真实 Run：`optimization` 阶段 ±30 s；`optimizationRef.consistency.note` 明确写出窗口；`stages[].state` 不变 |
| **1** | 新增 `ParameterSearchExecutionContext`（§9.2），把 P2/P3（bind / 切片 / universe / bars 索引）提成一次 `prepare()` | 并行/串行结果与 §12 判据逐项相等 |
| **2** | 新增 worker 并行调度层（复用 `evaluator.ts` 的执行器形状，**不新写子链**） | 8 worker 下 100 组 ≤ 1.5 min；`evaluatedSamples` 顺序与串行逐字节相同 |
| **3** | 补「特征 → 参数依赖」声明（仅当确实需要特征预计算时；否则不做） | 若做：必须给出「有依赖的特征不被预计算」的机器可查判据 |
| **4** | 参数搜索留档（搜索 Run 落库）—— 注意 `paramSearchRouter.ts` 全文**零写库调用**，现有 UI 走的是 legacy 表查表口径（`技术预览·非 RESEARCH_READY 口径`） | 明确「搜索 Run 是否入库」并只选一条口径 |

### 14.2 需要显式登记的窗口契约（DEFECT-1 的具体形态）

| 位置 | 当前 | 应然 |
|---|---|---|
| `closedLoopWiring/executors.ts`（optimization 评估器） | `dateRange: { startDate: dataset.dataSnapshot.request.startDate, endDate: ...endDate }` = **数据集版本窗口** | **本次运行的声明窗口** |
| `StrategyParameterEvaluatorInput.dateRange` 语义注释 | 「dateRange＝?」未声明 | 明确写「= 本次搜索的决策窗口；搜索不得扩大/缩小运行声明范围」 |
| 真实影响 | 请求 57 日 ⇒ 实际搜 484 日（**9.28×**，且「搜索结论属于另一个时间段」） | 搜索结论与运行窗口一致 |

> 🔴 这条**同时是性能问题与正确性问题**。本轮**未实施**，因为它会改变 `optimizationRef` 的内容
> （候选 / 稳定区 verdict 都可能变），而规格 §10 要求「性能优化必须 Before==After」。
> 把它交给 PARAMETER-001 与「窗口语义」一并落地，是唯一能同时满足两条纪律的做法。

---

## 15. 明确不应该做的事

1. **不要**把它拆成 BACKTEST-003 / BACKTEST-004（规格明令）。
2. **不要**用「缩小请求窗口」当加速手段 —— 实测：请求窗口只影响 0.97% 的运行。
3. **不要**去优化 Dataset 装载（2.61%）或 Backtest 撮合（0.03%）—— 那是把力气花在后三位小数上。
4. **不要**动 Canonical Metrics / Execution Policy / Strategy Schema / Dataset Schema（规格 §2 明令）。
5. **不要**引入 migration / `db:push` / `drizzle-kit generate`（本轮零变更，继续保持）。
6. **不要**为了做「特征预计算」直接跳过参数解析 —— 在缺「特征 → 参数依赖」声明时，那是**静默改结果**。
7. **不要**在并行调度里重排 `evaluatedSamples` —— 会破坏 SearchRun 指纹的确定性。
8. **不要**在没有等价性论证的情况下合并「当日 / 截到昨天」两次求值 —— 它占 42.5%，但也最容易静默错。
9. **不要**把闭环 `optimization` 的 `budget=12 / seed=17` 当成「参数搜索能力」——
   它只是「闭环内不阻塞事件循环」的固定预算（`executors.ts:238-239` 已写明理由）。
10. **不要**让 PARAMETER-001 直接复用 `client/src/pages/ParameterSearch.tsx` 的现有链路 ——
    它连的是 legacy 表查表口径（页面自己标了「技术预览·非 RESEARCH_READY 口径」）。

---

## 16. Remaining Risks

| # | 级别 | 风险 | 现状 / 建议 |
|---|---|---|---|
| **RISK-1** | 🔴 高 | **DEFECT-1 未修**：搜索窗口 = 数据集整窗（484 日）≠ 运行窗口（57 日） ⇒ 搜索结论属于**另一个时间段**，且贵 **9.28×** | 已量化、已定位到行；**PARAMETER-001 第 0 步必修** |
| **RISK-2** | 🟠 中 | 同日二次求值占样本耗时 **42.5%**，去重需 Core 语义等价性论证（`resolveQuiet ≡ resolve`、`minBarCount` 同值） | 本轮只记录。PARAMETER-001 若要做，必须先写等价性证明 + digest 复核 |
| **RISK-3** | 🟠 中 | **单线程事件循环**：一次搜索同步阻塞 Node 主线程（现在的闭环 `optimization` 就是这么干的，11 分钟里 tRPC 全挂） | 推荐架构用 worker；在 worker 落地前，长搜索**不得**走同步阶段执行器 |
| **RISK-4** | 🟡 低 | 本报告的性能数字含**插桩开销 + 1 ms CPU 采样**（657.8 s vs 无插桩 593.3 s，约 +11%） | 所有 Before/After **同条件对比**，结论不受影响；跨报告引用时请注明条件 |
| **RISK-5** | 🟡 低 | tsx/esbuild 的 `__name` 助手占 11.4% CPU（开发/测试态）；生产 bundle 占比不同 | 报告结论只建立在阶段级插桩与计数上；文件级归因仅作方向 |
| **RISK-6** | 🟡 低 | 14.3 s 基线那次运行的留档行已不在库中 ⇒ 「41× = optimization 接线」是**强旁证**（同期 Run 状态）而非逐字节铁证 | 已在 §7.3 显式标注；如需铁证，可在 git 历史里定位 `optimization` 接线的那次提交并重跑同窗口对照 |
| **RISK-7** | 🟡 低 | `paramSearchRouter.ts` 全文零写库调用、`ParameterSearch.tsx` 走 legacy 查表口径 ⇒ 「参数搜索」当前有**两套并行语义** | PARAMETER-001 必须先选定唯一口径（建议：以闭环 `strategyEvaluation` 一路为准） |
| **RISK-8** | 🟢 信息 | 搜索运行整体状态恒为 `PARTIAL_BLOCKED`（`robustness` 等未注入） | 按 `overall.status` 过滤会漏掉全部搜索 —— 用 `stages[].state` 判 |

---

## 17. Final Readiness

| 项 | 判定 |
|---|---|
| 真实 Run 有完整阶段 Profile | ✅ `_probe_param001_pre_profile.{json,out.txt}`（4 块 + 50 个节点 + 计数 + DB 往返） |
| R-06 有 measured evidence | ✅ §7（15 问逐条实测 + CPU 采样 + 计数） |
| 已确认 Dataset Load 是否为主要瓶颈 | ✅ **否**：17.1 s / **2.61%** |
| 已确认是否存在重复 Dataset preparation | ✅ **是**（13 次 session 级准备，共 1.07 s ≈ 0.16%）—— 但不是主因 |
| 已确认 `StrategyRuntime` 实际占比 | ✅ **85.83%**（564.6 s / 657.8 s），且 92.8% 的运行在 `optimization` 阶段内部 |
| 已确认 Backtest execution 实际占比 | ✅ **0.03%**（主链 216.7 ms）/ 样本内 0.6% |
| 已确认 Evaluation 实际占比 | ✅ **0.01%**（60.7 ms + 8.0 ms） |
| 已计算 100/500/1000 参数成本 | ✅ §10（BEFORE / AFTER 双表 + 三种架构） |
| 已设计 Parameter Search 复用边界 | ✅ §8 / §9（含「特征不能预计算」的诚实边界） |
| 如实施优化，Before/After 结果完全一致 | ✅ §12（16 项判据逐项/逐字节相等 + 新回归测试 5 例） |
| 没有 migration | ✅ 零 |
| 没有 `db:push` | ✅ 零 |
| 没有 `drizzle-kit generate` | ✅ 零 |
| 没有修改历史 Run | ✅ 历史 6 条一字未动；本轮新增 2 条**新** Run（`EXP-20260919-PARAM001PRE`） |
| 没有拆 BACKTEST-003 / BACKTEST-004 | ✅ 未拆 |
| 只产生一个最终 Profile 报告 | ✅ 本文档 |

### 最终判定

> # **PARAMETER-001 = READY**（**不是** `BLOCKED BY PERFORMANCE`）

**依据**：100 / 500 / 1000 组参数在「数据集一次装载 + 用户窗口 + 已实施的 P0」下分别是
**4.4 min / 21 min / 42 min**（串行，实测边际成本外推）；若加 8 worker 并行降至
**0.7 min / 2.8 min / 5.4 min**。**性能已经不构成阻塞。**

**开工前置（唯一一条）**：先修 **DEFECT-1**（闭环 `optimization` 的搜索窗口被错设为数据集整窗）。
不修它，PARAMETER-001 会把「用户要求的 3 个月」当成「24 个月」来搜 —— 那是**结论错误**，
而不仅仅是**慢 9.28×**。

**做完 PARAMETER-001 之前不要再自行开发**（规格收尾条款）。

---

## 附录 A — 本轮改动文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `server/observability/perfProfile.ts` | **新增** | 轻量性能剖析器（默认关闭；嵌套阶段、monotonic、machine-readable + 人类可读） |
| `server/observability/dbHook.ts` | **新增** | DB 往返计数挂钩（仅 `PARAM_PROFILE=1` 时安装） |
| `server/observability/index.ts` | **新增** | 出口 |
| `server/strategyCore/runtime.ts` | **修改（P0 优化）** | 定义指纹按定义对象缓存 + 每次求值只取一次 |
| `server/db.ts` | 修改（3 行） | 剖析开启时安装 DB 挂钩 |
| `server/researchRunRouter.ts` | 修改（插桩） | `run.loopRun_total` / `run.stage_orchestration` / `metrics.*` / `persistence.*` |
| `server/runWorkbenchAssembly/assemble.ts` | 修改（插桩） | `dataset.resolve` / `research.context_build` / `research.candidate_preparation` |
| `server/runWorkbenchAssembly/datasetFromRegistry.ts` | 修改（插桩） | 装载的 11 个子阶段 |
| `server/research/closedLoopWiring/executors.ts` | 修改（插桩） | `stage.<id>` 包裹层 |
| `server/research/signalEngine/engine.ts` | 修改（插桩） | `research.decision_day_loop` / `pipeline_per_day` |
| `server/research/datasetAccess/session.ts` | 修改（插桩） | `research.session_*` |
| `server/research/simulator/engine.ts` | 修改（插桩） | `backtest.*` |
| `server/research/strategyEvaluation/evaluator.ts` | 修改（插桩） | `optimization.evaluate_sample` |
| `server/strategyCore/production/coreDecision.ts` | 修改（插桩） | `strategy.evaluate` / `_prev_day` / `_decision_fingerprint` |
| `tests/server/strategyCore/definitionFingerprintCache.test.ts` | **新增** | P0 回归（5 例） |
| `docs/evidence/_probe_param001_pre_profile.mts` | **新增** | 权威 Profile 探针（真实 Run + V8 CPU 采样） |
| `docs/evidence/_probe_param001_stage_bench.mts` | **新增** | 阶段级微观基准 + 边际成本 A/B（零写库） |
| `docs/evidence/_probe_param001_recon.mts` | **新增** | 只读侦察（Run 阶段状态 / dataset_version / 在途 Run） |
| `docs/parameter/PARAMETER-001-PRE-PROFILE.md` | **新增** | 本报告（唯一交付物） |

**未改动**：`Canonical Metrics`（`backtest/backtestResult.ts`）、`Execution Policy`（`backtest/context.ts`）、
`Strategy Schema`、`Dataset Schema`、任何 migration / drizzle 文件、任何历史 Run。

## 附录 B — 证据文件

| 文件 | 内容 |
|---|---|
| `docs/evidence/_probe_param001_pre_profile.before.out.txt` | BEFORE：真实 Run 的完整可读输出（含 14 阶段状态、`optimization` 重试、阶段表、计数） |
| `docs/evidence/_probe_param001_pre_profile.before.json` | BEFORE：阶段树 + 展平表 + 计数 + 刻度（machine-readable） |
| `docs/evidence/_probe_param001_pre_profile.before.cpuprofile.json` | BEFORE：V8 CPU 采样原始档（5.7 MB，`canonical.ts` = 44.30% 的出处） |
| `docs/evidence/_probe_param001_pre_profile.after.out.txt` | AFTER（P0 优化后）：同输入、同探针、同插桩的完整输出 |
| `docs/evidence/_probe_param001_pre_profile.json` | AFTER：阶段树（`_probe_param001_pre_profile.json` 是探针的当前输出路径 ⇒ 即 AFTER 产物） |
| `docs/evidence/_probe_param001_pre_profile.cpuprofile.json` | AFTER：V8 CPU 采样原始档 |
| `docs/evidence/_probe_param001_stage_bench.before.json` / `.before.out.txt` | 边际成本 A/B（BEFORE）：两条曲线（用户窗口 / 数据集整窗）的逐项耗时与 digest |
| `docs/evidence/_probe_param001_stage_bench.after.json` / `.after.out.txt` | 同上（AFTER）：**用于 Before/After 一致性判据** |
| `docs/evidence/_probe_param001_recon.out.txt` | 只读侦察：7 条留档 Run 的逐条阶段状态（含「2026-09-14 全部 `optimization = CL_RUNNER_NOT_INJECTED`」这条关键旁证） / `dataset_version` / 策略版本 / 在途 `RUNNING` Run = **0** |
| `docs/evidence/_probe_param001_recon.mts` | 侦察探针本体（只读） |

> **本轮新增 2 条留档 Run**（均为**新行**，历史 6 条一字未动）：
> `clrun-20260919083211921`（BEFORE）与 `clrun-20260919090515703`（AFTER），
> 同属 `experimentId = EXP-20260919-PARAM001PRE`。
