# RESEARCH-DATA-ARCH-001 — 研究数据集膨胀与重复计算审计

> 生成日期：**2026-10-07（Asia/Shanghai）**
> 任务性质：**只读审计**。未修改代码、Schema、Migration 或数据，未新增/删除 Dataset，未重跑任何研究实验。
> 审计对象：当前工作区（含大量未提交改动）中的 `first_limit_pullback` Dataset 构建链、Research Experiment 读取/派生链、公共底座与现有缓存。
> 关键审计快照：`2026-10-07 12:xx–13:00 CST`。审计期间正在运行的 `v9` 全量构建自行失败；本次没有启动、取消或重试它。
> 证据来源：当前代码 + TiDB 只读 `SELECT` + `dataset_build_job` / `research_experiment_run` 留档 + `.cache/datasets/**` 快照清单 + 对象存储 Manifest/Result/CSV artifact 元数据。

## 0. 结论先行

**根因不是某一个单点 SQL，而是数据层坐标粒度错误：**

当前 `datasetVersionId` 同时绑定以下四种本应独立演进的东西：

1. **事件宇宙**：主板 / ST / 上市龄 / 首板规则；
2. **行情窗口**：pre-window / post-window；
3. **派生特征/结果**：path、outcome；
4. **物理存储**：每条 event 的整套窗口逐行复制。

因此任何实验、版本或筛选口径变化，都会把相同 Event 和高度重叠的行情重新展开、重新落库。  
研究实验又在这些版本之上各自重复执行：

```text
events + prefix + post
  → deriveTwelveFactorSamples（每次都重算全部 12 因子）
  → 公共首页回撤底座（7 种 entry mode × 20 个 exitDay × 1000 bootstrap）
  → 56 个 foundation CSV artifact
  → 实验特有统计 / 结果
```

这正是 Dataset 膨胀和单次实验 10–30+ 分钟的主要结构原因。  
**“实验之间共享基础数据”当前在代码层没有实现；只实现了单次 Run 内的 `barCache` 和按版本本地 SQLite snapshot。**

---

## 1. 当前实际数据流

### 1.1 Source → Dataset

```text
stock_daily_prices / research_securities / status history / liquidity / industry / index
  → FirstLimitPullbackDatasetBuilder
    → Phase 1: 事件检测与筛选
    → Phase 2: 每个 Event 展开 prefix/post，并生成 path/outcome
  → ds_first_limit_pullback_{event, prefix, post, path, outcome}
```

关键代码位置：

- `server/datasetRegistry/plugins.ts#firstLimitPullbackPlugin`
- `server/datasetRegistry/builder.ts#FirstLimitPullbackDatasetBuilder.build`
- `server/datasetRegistry/path.ts#buildRawBars / buildDerivedRows / buildOutcomeRows`
- `server/datasetRegistry/db.ts#fetchBarsForSymbolsInRange / insertPrefixes / insertPosts / insertPaths / insertOutcomes`
- `server/datasetRegistry/registry.ts` / `runner.ts`：版本、作业、checkpoint、READY 账本

### 1.2 Dataset → Experiment

```text
datasetVersionId
  → ExperimentDatasetAccess（server/researchExperiments/datasetPort.ts）
    ├─ events()                     → 全量分页 Event
    ├─ feature(rd)                  → prefix 行
    └─ observation(rd)              → post 行
  → deriveTwelveFactorSamples()     → 全量 12 因子 + 入场/退出/净收益
  → 实验自身排序 / 分桶 / 统计
  → withFirstBoardPullbackFoundation()
    → 7 种 entry mode × exitDay 面板
    → 56 个 foundation CSV.gz
  → Run result.json / Manifest / 对象存储
```

关键代码位置：

- `server/researchExperiments/datasetPort.ts#createAccess`
- `research-experiments/first-board-pullback/twelve-factor-composite-study/derive.ts#deriveTwelveFactorSamples`
- `research-experiments/manifest.ts`：所有 `first-board-pullback/*` 默认套公共底座
- `research-experiments/shared/firstBoardPullback/wrapExperiment.ts`
- `research-experiments/shared/firstBoardPullback/foundation.ts`
- `research-experiments/shared/firstBoardPullback/artifacts.ts`
- `research-experiments/shared/singleFactor/universe.ts`
- `research-experiments/shared/compositeFactor/template.ts`

### 1.3 现有缓存 / 复用机制

| 机制 | 作用域 | 是否解决重复计算 |
|---|---|---|
| `datasetPort.ts` 的 `barCache` | **单次 Run 内**按 `prefix:rd` / `post:rd` 单飞 | 只防同 Run 重复读；跨 Run 无效 |
| `eventsPromise` | 单次 Run 内 | 只防同 Run 重复事件扫描 |
| `.cache/datasets/<versionId>/dataset.sqlite` | 单版本本地快照 | 复用原始 Dataset 读取；不共享 12F / foundation 计算 |
| `.cache/research-dataset-3f-top3-v5-660001.jsonl.gz` | 特定 3F Top3 研究投影 | 只服务组合执行桥，不是通用研究缓存 |
| Dataset 五表 version 隔离 | 单版本内 | 是物化/成本来源，不是复用 |
| Run result / Manifest | 单 Run | 结果独立保存，未对公共输入做内容寻址复用 |

**没有发现**：

- 跨 Run 的 events/prefix/post 内存或持久缓存；
- Feature Matrix 按 `(event set, feature version, coordinate)` 缓存；
- Foundation Panel 按 `(event set, entry/exit policy, cost)` 缓存；
- Outcome/TradePath 的共享物化；
- 以内容 digest 复用的对象存储 artifact。

---

## 2. 数据规模统计

### 2.1 Source 与当前物理表

| 对象 | 实测 |
|---|---:|
| `stock_daily_prices` | **8,979,919 行**，5,800 个 symbol，2019-01-02 至 2026-09-30 |
| 五张 `ds_first_limit_pullback_*` 当前物理行 | **25,522,227 行**（仅 v8、v9-smoke、失败的部分 v9） |
| 五张表当前 `DATA_LENGTH + INDEX_LENGTH` | **约 9.84 GB** |
| Dataset 物理行 / 全市场源行情行 | **2.84×** |
| Dataset 存储 / `stock_daily_prices` 约 1.98 GB | **约 5.0×** |

注：上表物理行只统计当前五表实际存在的版本；v5/v7 的 `dataset_version.totalRows` 是历史账本，不等于当前 TiDB 物理行。

### 2.2 关键版本实测

| Version | ID | 状态 | Event | pre/post | horizons | 当前物理行 |
|---|---:|---|---:|---:|---|---:|
| v5 | 660001 | READY | 73,003 | 20 / 20 | 5,10,15,20 | **0**；本地 snapshot 有 4,809,433 行 |
| v6 | 720001 | READY | 102,878 | 0 / 80 | 5,10,20 | 0 |
| v7 | 750001 | READY | 73,003 | 0 / 80 | 5,10,20 | **0**；本地 snapshot 有 11,832,649 行 |
| v8 | 780001 | READY | 73,003 | 0 / 80 | 5,10,20 | **11,832,649** |
| v9-smoke | 780002 | READY | 2,315 | 60 / 80 | 5,10,20 | 459,748 |
| v9 | 780003 | **FAILED** | 70,071 | 60 / 80 | 5,10,20 | **13,229,830 的部分行** |

v8 五表精确行数：

| 表 | 行数 |
|---|---:|
| event | 73,003 |
| prefix | 73,003 |
| post | 5,733,817 |
| path | 5,733,817 |
| outcome | 219,009 |
| **合计** | **11,832,649** |

v9 失败时已落库的部分行：

| 表 | 行数 |
|---|---:|
| event | 70,071 |
| prefix | 3,548,239 |
| post | 4,716,480 |
| path | 4,716,480 |
| outcome | 178,560 |
| **合计** | **13,229,830** |

---

## 3. 一个 Event 实际展开多少交易日、多少字段、多少行

### 3.1 表结构

| 层 | 每 Event 行数公式 | 物理列数 |
|---|---:|---:|
| event | `1` | **27** |
| prefix | `preWindowDays + 1`（rd ≤ 0，含 rd=0） | **14** |
| post | `postWindowDays`（rd ≥ 1） | **28** |
| path | `postWindowDays`（rd ≥ 1） | **15** |
| outcome | `outcomeHorizons.length` | **10** |
| **总行数** | `1 + (pre+1) + 2×post + horizons` | **94 个列定义** |

`path` 与 `post` 不是两种独立事实：它们按 `(datasetVersionId, eventId, relativeDay)` 一一对应，`path` 是 post 的派生视图。  
`outcome` 又是 path/post 的窗口聚合。

### 3.2 典型版本

| Version | 每 Event 行数 | 观测均值 | 每 Event 标量字段出现次数（含 id/version/audit 列） |
|---|---:|---:|---:|
| v5 | 最多 66 | **65.88** | 最多 1,221 |
| v8 | 最多 165 | **162.08** | 最多 3,511 |
| v9-smoke | 最多 225 | **198.60**（左边界截断） | 最多 4,351 |
| v9 全量理论峰值 | **225** | 完成态应高于 v9-smoke | **4,351** |

计算口径：

```text
v5:  1 + 21 + 20 + 20 + 4 = 66
v8:  1 +  1 + 80 + 80 + 3 = 165
v9:  1 + 61 + 80 + 80 + 3 = 225
```

这里的“字段”包含每行的 `id`、`datasetVersionId`、`eventId`、`symbol`、`tradeDate`、`createdAt` 等重复控制列；不是实验实际读取的业务字段数。

---

## 4. 数据分层：哪些是什么

### 4.1 Raw / Base Data

- `stock_daily_prices`：全市场未复权日线，跨 Dataset 共享；
- `research_securities`、`research_security_status_history`、`industry_assignments`、`liquidity_daily`、`index_daily`；
- 它们的语义是“事实源”，原则上**只应保留一份**。

### 4.2 Event

- `ds_first_limit_pullback_event`；
- 一行 = 一个 `(symbol, tradeDate)` 事件；
- 包含身份、板块、涨停规则、首板事实、流动性富集、行业、来源事实等；
- 不包含逐日行情。

### 4.3 原始 Event 窗口

- `prefix`：rd ≤ 0，PIT 安全，含 event day；
- `post`：rd ≥ 1，含原始 OHLCV、前收、涨跌停价、停牌/可交易/执行事实；
- 这是 **事件级窗口复制**，不是独立事实源。同一 `(symbol, tradeDate)` K 线会被多个 Event 窗口重复覆盖。

代码里已经承认重叠：`server/runWorkbenchAssembly/datasetFromRegistry.ts` 对同一 `(securityId, tradeDate)` 做合并；本机 v2 投影元数据曾记录 **216,070 个重叠键**。

### 4.4 通用 Feature

**当前没有持久化通用 Feature Matrix。**

- 12 因子全部在每次 Run 的 `derive.ts` 中从 events/prefix/post 重新计算；
- `single-factor-v1` 即使只研究 1 个因子，也先执行 `deriveTwelveFactorSamples()`，计算全部 12 个因子；
- `compositeFactor` 模板同样复用它；
- 因此“12 因子实验之间共享”的对象目前只是**同一份函数**，不是同一份已计算数据。

### 4.5 通用 Outcome / Path

- `path`：相对 event close 的收益、回撤、量比、突破等逐日衍生；
- `outcome`：horizon 级 maxReturn / minReturn / maxDrawdown / breakout；
- 二者都是可重算数据；
- **当前实验侧 `ExperimentDatasetAccess` 只暴露 events / feature / observation，根本不暴露 path / outcome**；
- 在当前生产代码中，未发现 `loadOutcomes()/loadPaths()` 的有效实验消费者。当前 v8 的 path+outcome 合计 **5,952,826 行**，约占该版本总行数 **50.3%**。

### 4.6 其他派生数据

- `foundation` 面板：7 种入场方式 × 20 个退出日 × 分组/样本口径；
- `foundation` 曲线、anchor bootstrap；
- 每次 Run 的 `result.json`、`csv.gz`、`manifest.json`；
- `.cache/datasets/**/dataset.sqlite`：Dataset 本地快照；
- `.cache/research-dataset-3f-top3-v5-660001.jsonl.gz`：组合执行专用投影缓存。

---

## 5. 重复计算 / 重复存储点

### R-1 版本级：v7 与 v8 配置和规模完全相同，却完整构建两次

| 版本 | 配置 | Event | 总行数 | 成功构建耗时 |
|---|---|---:|---:|---:|
| v7 | main / excludeSt / pre0 / post80 / H3 | 73,003 | 11,832,649 | 2,193 s（36.6 min） |
| v8 | main / excludeSt / pre0 / post80 / H3 | 73,003 | 11,832,649 | 2,169 s（36.2 min） |

两版耗时合计约 **72.7 分钟**，产出规模完全相同。  
这不是“多实验”，而是同一物理数据重建两次。v7 的 TiDB 物理表现在为 0，仅本地 snapshot 保留。

### R-2 版本级：v9 与 v8 的事件/后窗高度重合，仍整体重建

- v8：main / non-ST / pre0 / post80；
- v9：在 v8 基础上加“上市龄 ≥365 天”并增加 pre60；
- v9 仍重新生成整套 event / prefix / post / path / outcome，而不是复用 v8 的事件子集、post80 和部分派生；
- v9 失败前已落库 **13.23m 行**，已经超过 v8 的 11.83m，且 prefix 批量插入最终失败。

### R-3 同一个 Event 的 post 与 path 双写

- v8：post 5,733,817；path 5,733,817；
- 同一事件、同一 relativeDay 一一对应；
- path 可由 post + event reference 100% 重算；
- 当前实验又不读 path，因此这部分是纯回写与存储膨胀。

### R-4 12F / 单因子 / 组合因子重复读取和重算

典型 12F Run 实测：

- candidate / Event：**73,003**
- prefix 读取：**218,691 行**（rd=0、-10、-1）
- post 读取：**1,458,498 行**（rd=1..20）
- 单 Run 读取合计：**1,750,192 行**

`twelve-factor-composite-study` 与 `twelve-factor-topn-ranking-study` 两次运行都读取同一 `datasetVersionId=660001`，样本账逐项相同：

| Experiment | duration | candidate | eligible | prefix read | post read |
|---|---:|---:|---:|---:|---:|
| 12F composite | 634,462 ms | 73,003 | 70,236 | 218,691 | 1,458,498 |
| 12F TopN | 685,042 ms | 73,003 | 70,236 | 218,691 | 1,458,498 |

`single-factor-v1` 的 23 个 COMPLETED Run 也全部是相同基础读取。  
25 个 COMPLETED Run 合计重复读取：

```text
25 × 1,750,192 = 43,754,800 行
```

其中 24 次在理想情况下可从 1 份公共底座复用。

### R-5 公共 Foundation 每个 Run 重算、重压缩、重存

`withFirstBoardPullbackFoundation()` 对每个非组合执行面的 `first-board-pullback/*` 实验注入相同基础计算：

- 7 种 entry mode；
- exitDay 1..20；
- FULL / COMMON 两套样本口径；
- 1000 次日期聚类 bootstrap；
- 56 个 `*.csv.gz` panel artifact。

理论上界：

```text
每 Event 最多 105 条固定 entry panel + 19 条动态 entry panel = 124 行
73,003 Event × 124 ≈ 9,052,372 行 / Run
```

对象存储实测（两个 12F Run 的 Manifest）：

| Run | foundation artifact | 大小 |
|---|---:|---:|
| 12F composite | **56 个** | **245,940,940 B** |
| 12F TopN | **56 个** | **245,940,940 B** |

这两组 artifact 的文件名、数量和大小完全相同；输入 Event 集会相同、底座实现相同时，它们是同一批可内容寻址复用的数据。  
仅 23 个 single-factor COMPLETED Run + 2 个 12F Run：

- 重复 foundation artifact：**1,400 个**
- gzip 字节：**约 6.15 GB**
- 多出的 panel 行处理量：约 **2.17 亿行**（按每个 run 9.05m 行、复用 24 次估算）

### R-6 缓存仍是“版本快照”，不是“研究底座缓存”

本地存在：

| Dataset | Snapshot | 大小 | Counts |
|---|---|---:|---:|
| v5 / 660001 | `.cache/datasets/660001/dataset.sqlite` | 1.096 GB | 4,809,433 |
| v7 / 750001 | `.cache/datasets/750001/dataset.sqlite` | 2.898 GB | 11,832,649 |

这能避免 TiDB 重复读取，但：

- 只在当前机器有效；
- 不缓存 12 因子结果；
- 不缓存 foundation panel；
- 不缓存实验结论；
- v5/v7 的 TiDB 物理行已为 0，而 metadata 仍保留历史 totalRows，形成账本与物理存储漂移。

### R-7 执行历史中还有 16 条长期 RUNNING

`first-board-pullback/single-factor-v1` 实测有：

- 23 条 COMPLETED；
- **16 条自 2026-09-25 起一直 RUNNING、durationMs 为 NULL**。

它们不代表当前正在计算，但会污染运行统计、并发/陈旧任务语义。本次按要求只读，没有 reconcile。

---

## 6. 主要耗时点

### 6.1 Dataset 构建耗时

| Dataset | 结果 | Event | 最终/已处理行 | 构建耗时 |
|---|---|---:|---:|---:|
| v5 | COMPLETED | 73,003 | 4,809,433 / 5,148,183 processed | 1,749 s（29.2 min） |
| v6 | COMPLETED | 102,878 | 16,712,486 / 16,609,608 processed | 5,280 s（88.0 min） |
| v7 | COMPLETED | 73,003 | 11,832,649 / 11,759,646 processed | 2,193 s（36.6 min） |
| v8 | COMPLETED | 73,003 | 11,832,649 / 11,759,646 processed | 2,169 s（36.2 min） |
| v9 | **FAILED** | 70,071 | 13,229,830 已落库 | **32,151 s（8 h 55 min）后失败** |

v9 在 `windows` 阶段完成 58,256 / 71,934 chunks 后，在 `ds_first_limit_pullback_prefix` 批量插入时失败。  
`dataset_build_job.errorMessage` 为 16,000 字符，几乎全是超长 INSERT SQL 文本，根因（底层网络/参数/约束/事务错误）不可见；这是一个独立的可观测性缺口。

### 6.2 Experiment 计算耗时

| 范围 | Run 数 | 平均 | 最大 | 合计 |
|---|---:|---:|---:|---:|
| 12F composite | 1 | 10.6 min | 10.6 min | 10.6 min |
| 12F TopN | 1 | 11.4 min | 11.4 min | 11.4 min |
| single-factor-v1 COMPLETED | 23 | **16.7 min** | **33.9 min** | **6.42 h** |
| 上述 25 个 Run | 25 | 16.3 min | 33.9 min | **6.78 h** |

这些数字来自 `research_experiment_run.durationMs`，包含读取、派生、公共底座、统计和 artifact 上传。  
当前留档**没有阶段级计时**，因此不能从现有数据可信声称“读取占 X%、CPU 占 Y%”。但从结构成本可以确定：

- 每 Run 至少 740 次 post 批量查询（1.458m 行 / 每 2,000 Event 一块 × 20 个相对日）；
- 每 Run 还要生成约 9m foundation panel 行、1000 次 bootstrap、56 次同步 gzip；
- 55 个 non-empty 文件加上 result/manifest/log 的存储上传。

这也是单因子实验需要 10–30 分钟、远超纯统计计算的原因。

---

## 7. 当前架构问题

### P-1 坐标耦合

`datasetVersionId` 同时代表事件宇宙、行情窗口、特征/结果物化和物理副本。任何维度变化都会重建全部。

### P-2 版本隔离过度物化

“版本隔离”被实现为“每个版本复制整套逐日窗口”。缺少 base-bar、event-set、feature-set、outcome-set 的独立版本坐标。

### P-3 Post 与 Path 的重复

post 保存原始 OHLCV，path 再次保存派生列；当前实验不读取 path/outcome。约一半版本行数没有当前消费者。

### P-4 实验底座不是共享数据

`deriveTwelveFactorSamples` 与 foundation 是共享代码，不是共享结果。25 个 Run 重复读取同一批输入，重复算相同的 12 因子与 panel。

### P-5 Artifact 按 Run 存储，不做内容寻址

两个输入相同的 Run 会各自上传 56 个 245.9 MB 的 foundation artifact。Manifest 没有共享 blob 引用。

### P-6 缓存是局部的

SQLite snapshot 和 JSONL 投影都在本机 `.cache`，没有跨机器/跨执行器的统一缓存层；v5/v7 TiDB 行为 0 而快照存在，导致“源数据可用性”依赖本地磁盘。

### P-7 历史账本与现存量不一致

`dataset_version.totalRows` 是历史账本，当前 v5/v7 物理行为 0；页面/审计若把它当现存量会误判。

### P-8 错误可观测性不足

v9 失败只留下截断的超长 SQL，缺少结构化 error code、cause chain、last chunk、查询参数摘要和 checkpoint 可恢复原因。

---

## 8. 推荐目标架构（不实施）

### 8.1 分层

```text
┌─────────────────────────────────────────────────────────────┐
│ A. MarketBase                                              │
│    securityId + tradeDate + OHLCV/PIT/execution facts       │
│    全市场、单份、只追加/版本化                               │
└───────────────────────┬─────────────────────────────────────┘
                        │ join/filter
┌───────────────────────▼─────────────────────────────────────┐
│ B. EventUniverse                                           │
│    eventId + eventType + filterPolicyVersion               │
│    只存事件身份和筛选 provenance，不复制行情                 │
└───────────────────────┬─────────────────────────────────────┘
                        │ feature/outcome definitions
        ┌───────────────┴────────────────┐
        ▼                                ▼
┌──────────────────────┐      ┌───────────────────────────────┐
│ C. FeatureSet        │      │ D. OutcomeSet                 │
│ (universe, code,     │      │ (universe, entry/exit/cost,   │
│  asOf, relativeDay)  │      │  horizon)                     │
│ 12 因子矩阵等        │      │ 收益/路径/回撤标签             │
└──────────┬───────────┘      └──────────────┬────────────────┘
           └───────────────┬─────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ E. ExperimentRun                                           │
│ 只保存 hypothesis/parameters/selection/statistics/artifacts │
│ 引用 A/B/C/D 的 content digest，不复制基础行情               │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 推荐键

- Base：`(dataVersion, securityId, tradeDate)`
- Event：`(eventUniverseId, eventId)`
- Feature：`(eventUniverseId, featureCode, featureVersion, asOfRelativeDay)`
- Outcome：`(eventUniverseId, entryPolicy, exitPolicy, costModelVersion, horizon)`
- Foundation panel：`(eventUniverseId, foundationVersion, entryModeSet, costModelVersion, eventIdsDigest)`
- ExperimentResult：`(experimentId, experimentVersion, inputDigest, parametersHash)`

### 8.3 物化建议

| 数据 | 建议 |
|---|---|
| OHLCV/PIT 基础事实 | **保留一份** |
| Event 身份/筛选 | **保留一份/每个 event universe** |
| Event 窗口 prefix/post | 改为对 base bars 的视图/按需查询；需要快照时复用一个共享 bar block |
| 12 因子 | **一次计算、多实验复用**；按 feature version 持久化 |
| 通用收益/路径 | **一次计算、多实验复用**；可按 outcome key 缓存 |
| foundation panel | 内容寻址缓存；Manifest 引用共享对象，不按 Run 复制 |
| 实验特有统计/结论 | **继续每个 Experiment Run 独立保存** |
| path/outcome 当前未消费表 | 停止继续膨胀；迁移到按需/缓存层 |
| SQLite snapshot | 作为可验证的本地缓存保留，但必须可跨机重建或对象化 |

### 8.4 对“相同 Event 一次准备”的回答

可以，但需要把“事件筛选版本”和“行情窗口版本”拆开：

```text
一次 Event Universe
  → 多个 FeatureSet
  → 多个 OutcomeSet
  → 多个 ExperimentRun
```

同一 Event universe 下，不同实验只应重新执行排序、过滤、组合和统计。  
相近窗口只应准备一次：窗口是 Base 查询参数或 Feature/Outcome 缓存键，不应成为新的物理 Dataset 版本。

---

## 9. 改造收益

以下为结构性收益上界，不承诺精确节省比例：

1. **Event 只准备一次**：12F / 单因子 / 组合实验共享一个事件流，避免 25× Event 扫描。
2. **12 因子只计算一次**：23 个已完成单因子 Run 中，24 次完整 12 因子重算可复用同一 FeatureSet。
3. **公共 foundation 只算一次**：从 25×56 = 1,400 个 artifact 降到 1×56 个共享对象加 25 个引用。
4. **避免 post/path 双写**：v8 可少保留约 5.73m 行；当前五表中 path+outcome 约 4GB，且无活跃实验消费者。
5. **新版本只构建 delta**：v9 可复用 v8 的 event 子集与 post80，只增量增加 prefix60 和筛选 provenance。
6. **缓存命中后实验时间主要剩统计**：预期从 10–30 分钟级降到秒/分钟级，实际取决于 feature/outcome 物化粒度。
7. **实验可复现性提高**：每个 Run 只需保存 input digest 引用，而不是复制整份 input payload。

---

## 10. 潜在风险 / 不能省掉的防线

1. **PIT 不能因缓存而变松**：FeatureSet 的 `asOfRelativeDay` 与 `decisionOffsetDays` 必须进入缓存键。
2. **Event universe 不能混用**：v5 与 v9 的上市龄筛选不同，不能因为行情相同就自动互换。
3. **base data revision 要可追踪**：OHLCV/PIT/证券主数据一旦修正，digest 必须变化并使下游缓存失效。
4. **代码 digest 必须进入缓存键**：12 因子、foundation、收益口径的任何代码变化都要产生新一代缓存。
5. **缓存不能覆盖历史结果**：实验 Run 仍保存冻结结果和 provenance，不能只存一个可变共享指针。
6. **共享 artifact 需要权限与生命周期**：内容寻址 blob 可复用，但删除、GC、跨 Run 引用完整性必须显式定义。
7. **v5→v8 不能无条件等价**：需先做逐事件、逐相对日、逐字段 digest 对拍；pre-window 语义不同，尤其 12F 需要 rd=-10/-1。
8. **零值/缺失不能折叠**：`null`、停牌、不可成交、右侧截断必须继续在共享层保留原语义。
9. **缓存失效不能静默回退**：同一 Run 内必须固定一个 snapshot/dataVersion，避免中途从缓存切到 DB。
10. **错误可观测性必须先修**：像 v9 一样 8h55m 后仅留下截断 SQL，会阻碍任何缓存/增量建设。

---

## 11. 最小改造方案（只给方案，不实施）

### M0. 先冻结基线和证据

- 记录 `datasetVersionId`、五表 count、snapshot digest、事件集合 digest、12 因子 digest、foundation artifact digest；
- 对 v5/v8/v9-smoke 做逐相对日 parity；
- 不改变现有实验结果。

### M1. 加入 Run 级输入缓存

- 持久化 `(datasetVersionId, requirementDigest)` 对应的 `events + prefix/post` 解析结果；
- 跨 Run 复用已在内存解析的 Event、Bar 和日期索引；
- 保留 `barCache` 作为单 Run 快路径；
- 先解决“相同 12F / 单因子实验重复读同一批数据”。

### M2. 抽出 FeatureSet

- 把 `deriveTwelveFactorSamples()` 拆成：
  - 公共 universe / trade path；
  - 12 个因子计算；
  - 目标因子提取。
- 以 `(universeDigest, featureCode/version, asOf, relativeDays)` 物化；
- 单因子实验只读取目标因子列，不再重算其余 11 个。

### M3. 抽出 FoundationPanel

- 以 `(eventIdsDigest, foundationCodeVersion, cost, entryModeSet)` 缓存；
- 一个 Run 不重复生成 56 个 panel；
- 实验通过引用读取共享 panel，继续独立写自己的结果。

### M4. 停止 path/outcome 的盲目扩张

- 先确认当前无消费者；
- 将 path/outcome 改为从 post 按需派生；
- 若未来需要持久化，只保存最小 outcome key，不复制整套 post 语义。

### M5. 拆分 Dataset 坐标

- 新版本只描述：
  - `BaseDataVersion`
  - `EventUniverseVersion`
  - `FeatureSetVersion`
  - `OutcomeSetVersion`
- `datasetVersionId` 最终成为这些坐标的引用组合，而不是单表全量副本。

### M6. 内容寻址 artifact

- foundation panel、逐笔 CSV、曲线等按内容 digest 存一次；
- Manifest 记录 `digest + logical name`；
- 每个 Run 的 result.json / conclusion / parameters 仍独立保存。

### 建议优先级

```text
P0: v9 失败可观测性 + Run 级 events/bar 输入缓存
P1: FeatureSet 提取与单因子复用
P2: FoundationPanel 共享
P3: path/outcome 去物化或按需化
P4: 拆分 Base / EventUniverse / FeatureSet / OutcomeSet 坐标
```

---

## 12. 对必须回答问题的直接答复

### 12.1 一个 Event 当前实际展开多少交易日、多少字段、多少行？

- v5：最多 66 行 / Event，实测均值 65.88 行；最多 1,221 个标量字段出现次数。
- v8：最多 165 行 / Event，实测均值 162.08 行；最多 3,511 个。
- v9：理论峰值 225 行 / Event，4,351 个；v9-smoke 因左侧边界截断均值 198.60 行。

### 12.2 各类数据是什么？

- Raw/Base：`stock_daily_prices`、证券身份、PIT 状态、流动性、行业、指数。
- Event：`ds_first_limit_pullback_event`。
- 原始窗口：`prefix`、`post`。
- 通用 Feature：当前**没有持久化**；12 因子每次重算。
- 通用 Outcome/Path：`path`、`outcome`，可重算，当前实验链基本不读。
- 其他派生：foundation panel、bootstrap、Run result、Manifest、snapshot、专用 JSONL 投影。

### 12.3 哪些内容在不同 Experiment 间重复？

- Event / prefix / post 读取；
- 全部 12 因子派生；
- 7 种 entry mode × 20 exit day 的 foundation panel；
- 1000 次 bootstrap；
- 同步 gzip 与 artifact 上传；
- 同一相对日的 SQL 批查询和内存 Map 构造。

### 12.4 Dataset 构建耗时与 Experiment 计算耗时分别占多少？

- Dataset 完整构建实测：v5 29.2 min，v7 36.6 min，v8 36.2 min，v6 88.0 min；v9 在 8h55m 后失败。
- Experiment 实测：12F 10.6–11.4 min；single-factor 平均 16.7 min，最大 33.9 min；23 个 single-factor COMPLETED 合计 6.42 h。
- 当前日志没有 experiment 内部阶段计时，因此无法可信拆出“读取 vs CPU vs 压缩上传”的精确百分比；但重复读取、重复派生、重复 foundation 是明确的结构性成本。

### 12.5 哪些计算适合一次计算、多实验复用？

- Event universe / 首板筛选；
- Event 窗口 bars 读取与规范化；
- 12 因子 Feature Matrix；
- 入场/退出/成本后的通用收益路径；
- 常见 horizon 的 outcome；
- foundation panel 与其 bootstrap；
- 任意跨实验共享的逐日收益曲线。

### 12.6 哪些应持久化，哪些应缓存/按需？

- 持久化：Base bars、Event identity/filter provenance、通用 FeatureSet、通用 OutcomeSet、实验 Run 结果。
- 共享缓存：事件窗 projection、foundation panel、bootstrap、逐日曲线。
- 按需计算：单实验特有排序、分桶、统计、组合权重、随机模拟。
- 停止/延后物化：当前无消费者的 path/outcome 全量副本；每个 Run 私有的 foundation artifact。

### 12.7 是否可以做到？

可以：

- 同一批 Event 只准备一次；
- 相近窗口只准备一次；
- 多个实验共享基础数据和 Feature/Outcome；
- 实验结果继续独立保存；
- 不再为每个实验复制完整 100+ 天行情。

前提是把“Event 坐标 / 行情坐标 / Feature 坐标 / Outcome 坐标 / Experiment Run 坐标”拆开，并给每个共享层加 content digest + PIT 边界 + 失效规则。

---

## 13. 主要证据索引

- Dataset 五表与插件：`server/datasetRegistry/plugins.ts`、`builder.ts`、`path.ts`
- 构建耗时/状态：`dataset_build_job.id=900003`、`dataset_build_job.id=870001/900001`
- Experiment 读取缓存：`server/researchExperiments/datasetPort.ts#barCache`
- 12 因子共享代码：`twelve-factor-composite-study/derive.ts`
- 单因子复用 12F 池：`shared/singleFactor/universe.ts`
- 公共底座注入：`research-experiments/manifest.ts`、`shared/firstBoardPullback/wrapExperiment.ts`
- Foundation 计算与 artifact：`shared/firstBoardPullback/foundation.ts`、`panel.ts`、`curves.ts`、`artifacts.ts`
- 快照：`.cache/datasets/660001/manifest.json`、`.cache/datasets/750001/manifest.json`
- 代表性 Run：`RUN-20260924-EA21BB87`、`RUN-20260924-C5D8AC1A`
- 失败构建日志：`scripts/_scratch/_v9_full_build.log`