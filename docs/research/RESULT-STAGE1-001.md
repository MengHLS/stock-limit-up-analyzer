# RESULT-STAGE1-001 · 独立熊市样本数据集 v11 构建完成 + Stage 1 执行设计（Goal round 1）

> Goal：`STRATEGY-VALIDATION-CAPITALIZATION` · **Stage 1 — Independent Bear-Market OOS**（解决 N1）
> 🔴 **零业务代码改动** · 🔴 **唯一写操作 = 新建数据集（用户已授权 A）** · 冻结对象 = Strategy Version **3600006** · HEAD **`f8b6810`**

---

## 0. 结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **Stage 1 专用数据集已构建完成并核验通过**                                                            │
│     · `dataset_version.id` = **780005** · `version` = `v11-bear2026-pre10-post80` · `status` = **READY** │
│     · 事件区间 **2026-01-05 ~ 2026-09-04** · 事件 **8,572** · 总行 **1,303,740**                        │
│     · `post.relativeDay` = **1 ~ 80**（窗口完整）· post 日期 **2026-01-06 ~ 2026-10-09**                 │
│     · **build config 与 780004 逐项一致**：`excludeSt=1` · `excludeListedWithinDays=365` ·                │
│       `preWindowDays=10` · `postWindowDays=80` · `outcomeHorizons=[5,10,20]` · `batchSize=1000`          │
│                                                                                                      │
│  🔴 **独立性**：事件区间起点（2026-01-05）**晚于 780004 的 post 窗终点（2026-01-28）所覆盖的决策范围** ⇒     │
│     以 **`dateRange.startDate = 2026-01-29`** 严格切分 ⇒ 独立段持仓完全不在 780004 覆盖内                  │
│     ⚠️ **但因子发现的 dataset 边界无法确证**（用户答「不确定」）⇒ 按显式假定推进并登记                       │
│                                                                                                      │
│  ⇒ **下一步：在 `2026-01-29 ~ 2026-10-09` 上运行 Stage 1（门槛已先于结果写定，见 §4）**                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 授权与前提

| 项 | 内容 |
|---|---|
| **用户裁定（本轮）** | ✅ **A：授权新建 + 构建专用 dataset version**（config 复制 780004，事件 2026-01-01~2026-09-04） |
| **独立性边界** | ⚠️ 用户答「**不确定 / 无法确认**」⇒ 本 Goal 以显式假定推进：**Discovery 使用 ≤ 780004 事件区间（止于 2025-09-26）**；**该假定未获独立证据支持，已在所有结论中登记** |
| **路径 A 不可行的依据** | `stock_daily_prices` 最早 = **2019-01-02** · `index_daily` 最早 = **2019-01-02** ⇒ **无 2019 年前行情**（见 `RESULT-STAGE1-FEASIBILITY-001.md`） |
| **路径 B 的独立性依据** | 独立段起点 **2026-01-29** 严格晚于 780004 的 post 窗终点 **2026-01-28** |

---

## 2. FACT · v11 构建实测

### 2.1 实体

| 实体 | 值 |
|---|---|
| `dataset_version.id` | **780005** |
| `dataset_version.version` | `v11-bear2026-pre10-post80` |
| `dataset_version.status` | **READY** ✅ |
| `dataset_version.startDate / endDate` | **2026-01-01 / 2026-09-04** |
| `dataset_version.totalEvents / totalRows` | **8,572 / 1,303,740** |
| `dataset_build_job.jobId` | `ds001-v11-bear2026-pre10-post80-1791558308755-c5bc70f6` |
| `dataset_build_job.status` | **COMPLETED**（chunks **8,572 / 8,736** · `processedRows` **1,295,168**） |
| `datasetId` | **120001**（`first_limit_pullback`，同族） |

### 2.2 build config 逐项对照（**口径一致性 = Stage 1 有效性的前提**）

| 项 | **780004（冻结基准）** | **780005（v11）** | 一致 |
|---|---:|---:|:---:|
| `excludeSt` | 1 | 1 | ✅ |
| **`excludeListedWithinDays`** | **365** | **365** | ✅ |
| **`preWindowDays`** | **10** | **10** | ✅ |
| `postWindowDays` | 80 | 80 | ✅ |
| `outcomeHorizons` | `[5,10,20]` | `[5,10,20]` | ✅ |
| `batchSize` | 1000 | 1000 | ✅ |
| `configVersion` | 1 | 1 | ✅ |
| `universeDefinitionJson` | `all-a-shares` / `stock_daily_prices` / `boards:["main"]` | 同（同一构建脚本的 `filter`） | ✅ |
| `filterDefinitionJson` | `builder:"first_limit_pullback"` · `events:[{rd:0,kind:"firstBoard"}]` | 同 | ✅ |

📌 **对照 `750001`(v7) / `780001`(v8)**：`excludeListedWithinDays = null` · `preWindowDays = 0` · 事件 73,003 ⇒ 🔴 **口径不同，已排除使用** ✓

### 2.3 数据实际范围

| 项 | 值 |
|---|---|
| `ds_first_limit_pullback_event`（780005） | **8,572** 行 · 事件日期 **2026-01-05 ~ 2026-09-04** |
| `ds_first_limit_pullback_post`（780005） | `relativeDay` **1 ~ 80** · 日期 **2026-01-06 ~ 2026-10-09** |
| 构建通路 | **生产通路**（`DatasetRegistryService` + `DefaultDatasetBuildRunner` + `DbDatasetPhysicalStore`，原生 chunk/checkpoint/resume） |

### 2.4 写入性质（**如实登记**）

🔴 **仅新增行**：
- `dataset_version` **+1 行**（id=780005）
- `dataset_build_config` **+1 行**
- `dataset_build_job` **+1 行**
- `ds_first_limit_pullback_event / prefix / post / path / outcome` **新增行**（780005 专属，`datasetVersionId=780005`）

✅ **未修改、未删除任何既有行** · ✅ **未触碰 780004 / 750001 / 780001 及任何既有 dataset version** · ✅ **未修改 Strategy Version 3600006** · ✅ **未执行 DDL / 未改 Schema / 未改 migration**

---

## 3. Stage 1 独立性切分

| 项 | 值 | 说明 |
|---|---|---|
| 780004 post 窗终点 | **2026-01-28** | `rd80` 最晚落点 |
| v11 最早事件 | 2026-01-05 | 其 rd15 决策日 ≈ **2026-01-26** |
| 🔴 **独立段起点** | **`2026-01-29`** | **严格晚于 780004 的 post 窗终点** ⇒ 该日起的所有决策与持仓**不在 780004 覆盖内** |
| 独立段终点 | **`2026-10-09`** | v11 的 post 窗末端（源数据末端） |
| 独立段长度 | ≈ **176 个交易日**（2026-01-29 ~ 2026-10-09） | — |

⚠️ **已知边界效应**：v11 最晚事件 2026-09-04 ⇒ 其决策日 ≈ 2026-09-25 ⇒ 持仓 40 日会**超出 post 窗末端（2026-10-09）** ⇒ **末端未平仓头寸为 mark-to-market 边界值** ⇒ **须在结果中登记**（与 `RESULT-OOS-WFA-002` 的 `dateRange` 截断问题同类）

---

## 4. 🔴 判定门槛（**先于结果写定**）

### 4.1 冻结配置（**不得改动**）

| 项 | 值 |
|---|---|
| Strategy Version | **3600006**（`event-state-long-maxamp5-top3@1.0.0`） |
| TopN | **3** |
| 持有期 | **40 交易日** |
| 仓位 | **`FIXED_RATIO × 1/180`** · `maxPositions 180` |
| 成本 | **往返 20 bps**（`commission 2.5` + `slippage 7.5`，每边） |
| `candidateExitPolicy` | **`DISABLED`** |
| 观察窗 | **`{start:15, end:79}`**（⇒ `maxRd=80`） |
| 决策日 | **`rd15`** |
| 方向 | `rankingConfig.higherIsBetter = false`（dir = −1） |
| 数据集 | **780005**（v11）· 口径与 780004 一致 |

### 4.2 预声明门槛

| # | 门槛 | 判据 |
|---|---|---|
| **S1-P1** | **绝对收益为正** | 独立段 TOTAL > 0 |
| **S1-P2** | **熊市防御成立** | 独立段 **MDD 浅于基准**（`\|MDD_strategy\| < \|MDD_benchmark\|`） |
| **S1-P3** | **下跌月跑赢** | 基准下跌月（2026-03 · 2026-07）中，**至少 1 个**策略跑赢基准 |
| **S1-P4** | **风险调整不劣化** | 独立段 **Calmar ≥ 0**（CAGR 为正时）或 **MDD ≤ 基准 MDD 的一半** |

**判定规则**：
- **PASS** = S1-P1 ✅ **且** S1-P2 ✅ **且** S1-P3 ✅
- **FAIL** = 任一不满足 ⇒ **降级为 `RESEARCH_CANDIDATE`**，🔴 **不允许借机重新优化**（Goal 明令）

### 4.3 输出项（Goal 要求）

收益 · MDD · Sharpe · Sortino · Benchmark 对比 · **Bear-Market 防御表现**（下跌月相对表现）· Beta · 正年份

---

## 5. NOT PROVEN / 登记

| # | 项 |
|---|---|
| **N-a** | 🔴 **因子发现的 dataset 边界无法确证**（用户答「不确定」）⇒ 独立性基于**显式假定**（Discovery ≤ 780004 事件区间），**未获独立证据支持** |
| **N-b** | 独立段仅 **~176 交易日 / ~8.5 个月** ⇒ **样本量小**，统计功效有限 |
| **N-c** | 独立段内**基准下跌月仅 2 个**（2026-03 · 2026-07）⇒ 熊市样本点少 |
| **N-d** | 末端持仓超出 post 窗 ⇒ **mark-to-market 边界值** |
| **N-e** | 独立段**未含 2019 年前的历史熊市**（源数据不足）⇒ 无法覆盖 2015/2018 等极端熊市 |

---

## 6. 合规声明

✅ **零业务代码改动** · 🔴 **唯一写操作 = 新建 dataset version 780005**（**用户已明确授权 A**；**仅新增行，不改不删既有行**）· ✅ **未修改 Strategy Version 3600006** · ✅ **未重新选因子 / 未优化参数** · ✅ **未触碰既有 dataset version（780004/750001/780001）** · ✅ **未执行 DDL / 未改 Schema / 未改 migration** · ✅ 临时文件仅落 `scripts/_scratch/` 与 `%TEMP%`

---

## 7. 下一步（**Goal 保持 active**）

```text
在 dataset 780005 上、以 dateRange = 2026-01-29 ~ 2026-10-09 运行 Stage 1：
  · 冻结全部策略口径（§4.1）
  · 输出 §4.3 全部指标 + §4.2 门槛判定
  · 形成 RESULT-STAGE1-002.md（Stage 1 结论）
  · PASS ⇒ 进入 Stage 2；FAIL ⇒ 降级 RESEARCH_CANDIDATE，不重新优化
🔴 基准不可移动：Strategy Version 3600006
```