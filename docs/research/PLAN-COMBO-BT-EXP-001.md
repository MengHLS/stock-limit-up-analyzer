# PLAN-COMBO-BT-EXP-001 · 组合回测「原始策略」五因子独立测试方案

> 日期：2026-09-24（**23:50 重写**：研究口径由「综合评分敏感性 / 消融」改为「**每个因子单独测试**」，见裁定 5）
> 状态：**方案已定稿（决策锁定，代码未开工）**
> 依据：`docs/research/AUDIT-COMBO-BT-EXP-001.md`（同编号现状审计）
> ROADMAP 编号：**`9co`**
> 总路线（分期 / 判据 / 跨因子综合）见 `docs/research/PLAN-FACTOR-EXP-001.md`；本文件是它的 **F1–F5 逐因子规格**，不重复总路线。
> 一句话目标：**把原始策略的 5 个打分因子各自单独做一次分桶研究，用日期聚类 Bootstrap CI 判定每个因子的「有效区间」—— 而不是把它们合成一个综合评分。**

---

## 0. 用户裁定（2026-09-24，本方案的硬约束）

| # | 裁定 | 在**本次范围**内的实施含义 |
|---|---|---|
| 1 | **严格对齐服务端** | 含义**收窄**为「每个因子的**输入字段与分档边界**对齐服务端评分函数」（`leaderCandidates.ts:694-703`）。不再涉及撮合 / 仓位 / 费用口径 —— 本次不做策略回测 |
| 2 | **改名（保留 id 改展示名）** | 保留，但**降级为附带工作**（见 §6）。它对本次因子研究不再是前置条件 |
| 3 | **排除 ST、北交所、创业板、科创板** | ✅ 北交所 / 创业板 / 科创板**已天然满足**（实测 `combo-v1` 的 `boardType` **100% = `main`**，构建器 `boards:["main"]` 已排除）；🔴 **排除 ST 在实验内做不到** ⇒ 见 §0.2 D3，**待裁定** |
| 4 | **不建 `combo-v2`** | 保留 ⇒ 研究窗口锁死 `combo-v1` = **11 个月 / 220 个交易日**，所有结论不可外推 |
| 🆕 5 | **每个因子单独测试，不给综合评分** | **本方案的主轴**。方法 = 沿用 `first-board-pullback/*-study` 的**分桶 + 日期聚类 Bootstrap** 范式，逐因子独立成实验；**不做**权重敏感性、不做消融、不做因子合成 |

### 0.1 裁定 5 为什么必须换范式（不是改个参数）

服务端评分是**加权和**（`leaderCandidates.ts:694-703`）：

```
score = min(100, min(boards,6)*7 + min(sectorCount,6)*4 + timeScore + turnoverScore + marketCapScore)
        连板数(0~42)      题材家数(0~24)      封板(0/2/5/8/10)  成交额(1/2/4/6/8)   流通市值(4/5/10/12/16)
```

它**回答不了「哪个因子有效、有效区间在哪」**：

1. **加权和互相掩蔽** —— 「6 板 + 题材 1 家」与「1 板 + 题材 6 家」可能同分，但因子结构完全相反；看总分无法还原结构；
2. **`min(100, …)` 截断** —— 理论满分 > 100 ⇒ 高分区间里连板数的边际加分被吃掉；
3. **阈值卡在总分上** —— 准入是 `(题材≥3家 且 封板≤13:30) || score >= 52`（`:808-814`），排序键也是 `score`（`:815`）⇒ **改一个因子动的是「谁能进池」，不是「池内怎么排」**，观测到的差异无法归因到该因子。

⇒ 所以本次把 5 个因子**拆开单独测**：每个因子独立成实验、独立 Run、独立结果留档。

### 0.2 由裁定派生的三条硬结论

#### 🔴 D1 · 因子 ↔ 数据列映射（含一处**命名撞车**，取错列研究就废了）

实测 `ds_first_limit_pullback_event` 的列（2026-09-24 只读直查）：

| 服务端评分因子 | 服务端字段 / 档位 | **dataset 列** | ⚠️ |
|---|---|---|---|
| F1 连板数 `boards` | `calculateBoards()`（`:633-644`） | **无直接列** ⇒ 需派生 | 见 §4 F1 |
| F2 题材家数 `sectorCount` | 同日同主题计数（`:664-672`） | `sector` + `keywords`（横截面计数） | `sector` 自带 `*N` 后缀 |
| F3 封板时间 | `limitUpTime` | `limitUpTime` | 82.4% 填充 |
| F4 成交额 | `limit_up_records.turnover` | **`sourceTurnoverAmount`** | 🔴 **不是 `turnover` 列** |
| F5 流通市值 | `limit_up_records.circulationValue` | **`sourceCirculationValue`** | ✅ |

🔴 **命名撞车（最危险的一处）**：同一张表里

- `turnover` = **换手率 %**（源 `liquidity.turnoverRate`，`builder.ts:279`；实测值 `22.4465` / `8.7136` / `7.6323`）
- `sourceTurnoverAmount` = **成交额（亿元）**（源 `limit_up_records.turnover`，`builder.ts:283`；实测值 `42.9` / `10.2` / `1.4`）

服务端评分的 `turnoverScore` 档位（`≥20 亿 → 8 分`）用的是**成交额** ⇒ 实验侧必须取 **`sourceTurnoverAmount`**。若误取 `turnover`（换手率），F4 整个研究**是另一个因子**，结论全废。这一条要写进代码注释。

✅ **好消息**：F2 的题材归一化与兜底是 `shared/` 里的**纯函数**，实验**可以合法 import**，且**已有先例**（现有实验 `combo-backtest/leader-candidate-baseline/experiment.ts:7` 已在 import `@shared/fieldAvailability`）：

- `normalizeSectorName()`（`shared/stockDataNormalization.ts:2`）—— 剥离 `*N` 计数后缀（`"海南*5"` → `"海南"`）
- `resolveThemeWithFallback({sector, keywords})`（`shared/fieldAvailability.ts:247`）—— 优先 `sector`，缺失回落 `keywords` 首个非「其他」token，全缺返回 `null`

#### 🔴 D2 · 「有效区间」的定义必须写死，否则会滑向「择优」

既有实验范式有一条明令（`research-experiments/template/README.md:85`）：

> **不在实验里宣称「最优 / 最佳 / 排名」—— 同一份数据上的描述性统计挑出来的「最优」是样本内选择，不是结论。**

所以「有效区间」**不能**定义成「中位数最高的那个桶」。本方案的定义（**三态 + 双阈值，预先登记**）：

| 判定 | 条件 |
|---|---|
| **有效·正向** | 该桶净收益的 95% **日期聚类** Moving Block Bootstrap CI **下界 > 0** |
| **有效·负向** | CI **上界 < 0** |
| **不确定** | CI 跨 0 |
| **样本不足** | 该桶可用样本 **< 100** ⇒ 强制判为「样本不足」，**不参与**任何有效性陈述（沿用 `turnover-study/result.ts:208` 的线） |

**有效区间 = 判定为「有效·正向」的桶的并集**。要求：

- 若并集**分段**（如 1~2 板有效、3 板无效、4 板又有效）⇒ **必须原样呈现分段**，禁止连成一段；
- 所有结论强制标注「`combo-v1` 窗口（2025-11-03..2026-09-23）内」，出现「长期有效」类措辞即判报告不合格（裁定 4）；
- 🔴 **必须做多重比较披露**：5 因子 × 最多 6 桶 × 3 视界 ≈ **90 个判定**，α=0.05 下**假阳性期望约 4.5 个** ⇒ 结果必须声明为**探索性**，并对「有效区间」候选给出 Bonferroni 校正后（α=0.05/90）是否仍成立。

#### 🔴 D3 · 排除 ST 在实验内**做不到**（裁定 3 的落空项，待裁定）

- `combo-v1` 的构建配置是 `excludeSt: false`（`dataset_build_config.excludeSt`），实测**未排除 ST**；
- 🔴 **dataset 事件表 27 个列里没有任何 ST 信号**（无 `stockName`、无 `isSt`、无状态列）⇒ 实验只读 dataset ⇒ **实验侧无从判定 ST**；
- ST 状态本身是**有**的：`research_security_status_history` 里 `statusType = 'ST'` 共 **841** 行 —— 但那是**服务端表**，实验读不到；
- 「ST 名称前缀」这条路也断了：`limit_up_records.stockName` 在窗口内 `LIKE 'ST%'` 仅 **1** 行、`LIKE '*ST%'` **0** 行（A 股 ST 股名形如 `ST中珠` / `*ST榕泰`，此处几乎为空 ⇒ 该字段不可靠）。

**三个选项，需裁定**：

| 选项 | 做法 | 代价 |
|---|---|---|
| **A（推荐，默认）** | **接受不排除 ST**，在 README + 结果载荷里显式登记为 `LIMITATION`，并给出 ST 事件占比估算 | 零成本；结论带一个已知污染项 |
| B | 改 `datasetRegistry` builder 加 `isSt` 列 + 重建 `combo-v1` | 改 `server/**` + 重跑构建（重活），且与裁定 4「不动数据集」的精神冲突 |
| C | 在实验侧用 `symbol` 反查 ST | ❌ **不可行**：实验不可查 DB |

#### 🔴 D4 · 因子列的缺失是**系统性偏斜**，不是随机缺失

`combo-v1` 里 F2~F5 依赖的列（`sector` / `limitUpTime` / `sourceTurnoverAmount` / `sourceCirculationValue`）**填充率都只有 ~82.4%**，且四个字段**同批缺失**（`sector` 与 `limitUpTime` 计数完全相等 = 13,373 ⇒ 同一采集来源、同一批缺口）。按月看是**单调改善**的：

```
2025-11  缺 312/1389 (22.5%)     2026-03  缺 281/1380 (20.4%)     2026-07  缺 251/1701 (14.8%)
2025-12  缺 275/1476 (18.6%)     2026-04  缺 291/1494 (19.5%)     2026-08  缺  59/1446 ( 4.1%)
2026-01  缺 296/1664 (17.8%)     2026-05  缺 468/1677 (27.9%)     2026-09  缺  12/ 961 ( 1.2%)
2026-02  缺 205/ 960 (21.4%)     2026-06  缺 398/2073 (19.2%)
```

⇒ **缺的是早期样本**（采集逐步补齐）⇒ F2~F5 的可用样本**在时间上偏向近期**。后果：

- 分桶样本**不代表全窗口**，任何因子结论都叠加了一层「时间选择偏差」；
- Bootstrap 按**交易日**聚类刚好能部分缓解（同期缺口在同一 cluster 内），但**不能消除**；
- 必须做的事：① `sampleSummary` 里逐月披露可用/缺失；② observations 里出一条 `LIMITATION`；③ 报告里把「缺失期 vs 完整期」的桶收益做一次**对照切片**（见 §5 Phase D）。

---

## 1. 目标 / 非目标

### 目标

1. 对原始策略的 **5 个打分因子**（连板数 / 题材家数 / 封板时间 / 成交额 / 流通市值）**各建一个独立实验**，每个因子**单独跑一条完整研究**（分桶 + 收益 + CI），互不合成。
2. 输出每个因子的 **分桶收益矩阵 + 日期聚类 Bootstrap CI95**，据此判定**该因子的有效区间**（D2 定义）。
3. 产出跨因子对比与研究报告，**全部结论带窗口限定**（裁定 4）。

### 非目标（明确不做）

- ❌ **不做综合评分**：不做权重敏感性、不做因子消融、不做因子合成、不做「最优权重」。
- ❌ **不做策略回测**：本次不涉及选股 / 仓位 / 退出 / 费用 / 滑点 —— 那是旧方案的 Phase 0/1 内容（见 §8 废止清单）。单因子研究测的是**因子的信息含量**，不是「因子的策略贡献」。
- ❌ **不建 / 不改数据集**（裁定 4）：不动 `combo-v1`，不建 `combo-v2`，不用 `v5` 冒充（`v5` 是 `firstBoard` 事件 ⇒ 连板数恒为 1，见 D3 旧论证）。
- ❌ **不动 `/backtest` 页面**（1145 行），不迁其余 4 个策略，不碰生产 Strategy Engine。
- ❌ **不在实验里宣称「最优区间 / 最佳参数 / 排名」**（D2）。
- ❌ 不新建表、不加 migration、不装新依赖。

---

## 2. 数据地基（2026-09-24 只读直查实测，非推断）

### 2.1 `combo-v1` 事实

```
dataset_version id 690001 | version combo-v1 | status READY
事件   16,221  | 交易日 220  | 窗口 2025-11-03 .. 2026-09-23
板块   boardType 100% = main（SZ 8,297 / SH 7,924）
事件定义 limitUp（全部收盘涨停，含连板）| excludeSt = false
isFirstLimit=1 12,484 (77.0%)  ⇒ 连板事件 3,737 (23.0%)
```

✅ **裁定 3 的「排除北交所 / 创业板 / 科创板」已由构建器天然满足**（`boards:["main"]`，实测 100% main）⇒ 本次**无需额外过滤**。
✅ **`limitUp` 事件定义** ⇒ 事件表本身**就是这批主板股票的「涨停日历」**，F1 连板数可据此派生（见 §4 F1）。

### 2.2 列填充率（决定每个因子的可用样本）

| 列 | 填充 | 占比 | 用途 |
|---|---|---|---|
| `historicalLimitCount` | 16,221 | 100% | （未用，但全量可用） |
| `turnover`（**换手率 %**） | 15,473 | 95.4% | ⚠️ **不是** F4 的列 |
| `isFirstLimit` | 16,221 | 100% | 交叉校验 |
| `limitUpTime` | 13,373 | **82.4%** | F3 |
| `sector` | 13,373 | **82.4%** | F2 |
| `sourceTurnoverAmount`（成交额 亿） | 13,368 | **82.4%** | F4 |
| `sourceCirculationValue`（流通市值 亿） | 13,366 | **82.4%** | F5 |
| `marketCap` / `floatMarketCap` | **0** | **0%** | ❌ **完全不可用**（不是 F5 的列） |

### 2.3 可交易性（`post` 表，决定收益样本上限）

| rd | 行数 | `barPresent` | `canBuyAtOpen` | 停牌 |
|---|---|---|---|---|
| 1 | 16,177 | 16,105 | **14,468** | 67 |
| 5 | 15,909 | 15,752 | 15,427 | 140 |
| 20（外推） | ~15.6k | ~15.5k | ~15.3k | ~110 |

⇒ **T+1 开盘可买 ≈ 14,468（89.2%）** ⇒ 收益样本上限约 1.45 万条/视界，**超过每桶 100 的样本门槛**（D2）在整体上没问题，但**分桶后**某些桶（如 6 板以上、成交额 <2 亿）可能触线 ⇒ 这正是「样本不足」判定的用武之地。

### 2.4 `limit_up_records.boardCount` **不可作连板数真源**（再次实证）

窗口内 15,491 行，取值分布：`"1"` → 10,731；`"2"` → **1**；`"3"` → **0**；`"4"` → **0**；其余 1,353（多为两位数字符串）。

⇒ 分布明显不合理（2/3/4 板几乎为零却有一大簇「≥5」）⇒ 与项目既有结论一致（`limit_up_records.boardCount` 基本不可用）⇒ **F1 必须自己派生**。

---

## 3. 方法：单因子分桶研究（沿用既有范式）

### 3.1 范式来源（逐项对照，不新发明）

参照 `research-experiments/first-board-pullback/turnover-study/`（`README.md` + `experiment.ts` + `result.ts`，一个因子一个实验、分桶 + Bootstrap 的完整先例）：

| 要素 | 既有范式做法 | 本方案 |
|---|---|---|
| 实验粒度 | **一个因子一个实验**（`turnover-study` / `first-board-body-study` / …，共 23 个实验） | ✅ 同（5 个因子 → 5 个实验） |
| 分桶 | 硬边界常量数组 + `bucketOf()`（`result.ts:9-26, 146-153`） | ✅ 同，但**桶边界取服务端档位**（见 3.4） |
| 不确定性 | `movingBlockBootstrapMean`（`research-experiments/shared/dateClusterBootstrap.ts`），**按交易日聚类**、连续日期块重采样、固定种子（`turnover-study/result.ts:183-191`） | ✅ **直接复用**，不另写 |
| 参数 | `descriptor.parameters` 声明（视界 / 成本 / Bootstrap 次数与 block） | ✅ 同 |
| 输出 | `sampleSummary` + `statistics` + `tables` + `charts` + `customPayload`（含 `informationBoundary` / `observations` / `hypotheses`） | ✅ 同 |
| 合规 | `eventScanPolicy`、`unscannedEventCount`、`COMPUTATION_VERSION`、`eligible + excluded === candidate` | ✅ 同（见 §7） |
| 纪律 | **不输出最优区间 / 策略 / 排序**（`turnover-study/result.ts:306`、`template/README.md:85`） | ✅ 同，且把「有效区间」提为 **D2 的三态统计判定**（不是择优） |

### 3.2 通用流程（每个因子实验都走这 6 步）

1. **取数**：`context.dataset.events()` 读全量事件（`FULL_DATASET` + 流式分页），按 `tradeDate` → `eventId` 排序；
2. **派生**：算出该实验需要的因子值（F1 派生连板数、F2 横截面算题材家数、F3~F5 直接取列）；
3. **装配收益样本**：读 `feature(0)` 取事件日 bar，读 `observation(1..h)` 取 T+1 开盘与 T+h 收盘；**可执行性判定**（`barPresent` / `canBuyAtOpen` / `canSellAtClose` / `suspensionStatus !== "SUSPENDED"`）；样本 = `{eventId, eventDate, factorValue, horizon, grossReturn}`（**复刻 `turnover-study/experiment.ts:176-228`**）；
4. **缺失归因**：`excludedByReason` 逐项计数（缺该因子列 / T+1 不可买 / 退出日不可卖 / 超扫描上限）；
5. **分桶 + 统计**：按 3.4 的桶分组，每桶算 `sampleCount / availableCount / mean·median 毛净收益 / 净胜率 / Bootstrap CI95`；
6. **组装结果**：表格（分桶 × 视界）+ 柱状图（每桶中位净收益，**带 CI 误差条**）+ `observations`（DESCRIPTIVE / COMPARATIVE / POTENTIAL_SIGNAL / LIMITATION）+ `hypotheses`。

### 3.3 成本口径

统一从毛收益扣**往返成本 `roundTripCostBps`**（默认 20bps，`turnover-study` 同款参数）。⚠️ **声明**：这是**敏感性成本**，不是服务端分层滑点（服务端按成交额 +0/5/10/20bps 单边）—— 本次不做策略回测，故不引入分层滑点；但**必须在 `informationBoundary.notes` 里写清**，避免读者与 `/backtest` 数字对账。

### 3.4 桶边界 = **服务端评分档位**（本方案的关键设计）

不自己造桶，**直接采用服务端评分函数的档位边界** —— 这样研究结论能**直接检验服务端档位是否合理**：

| 因子 | 服务端档位（`leaderCandidates.ts:694-702` + `:515-523`） | 分桶 |
|---|---|---|
| F1 连板数 | `min(boards,6)*7` | `1 / 2 / 3 / 4 / 5 / 6+` |
| F2 题材家数 | `min(sectorCount,6)*4` | `1 / 2 / 3 / 4 / 5 / 6+` |
| F3 封板时间 | `≤10:00→10 / ≤11:30→8 / ≤13:30→5 / ≤14:30→2 / >14:30→0`（缺失→2） | `≤10:00 / ≤11:30 / ≤13:30 / ≤14:30 / >14:30 / 缺失` |
| F4 成交额 | `≥20→8 / ≥10→6 / ≥5→4 / ≥2→2 / <2→1`（亿） | `≥20 / 10~20 / 5~10 / 2~5 / <2` |
| F5 流通市值 | `<20→4 / <80→12 / ≤200→16 / ≤500→10 / >500→5`（亿，**倒 U 型**） | `<20 / 20~80 / 80~200 / 200~500 / >500 / 缺失` |

🔴 **F5 是倒 U 型**（中段 80~200 亿给最高 16 分）⇒ 分桶研究可直接检验「中间最好」这个假设是否成立。**若按「单调递增 / 递减」去读 F5 会读反** —— 必须原样按倒 U 呈现。

---

## 4. 五个因子的规格（逐个说明「怎么做 + 已知坑」）

### F1 · 连板数 `boards`

- **做法**：事件表（`limitUp` 全量）即「主板涨停日历」⇒ 按 `symbol` 取涨停日集合，交易日全集取事件表 `tradeDate` 去重（实测 **220 天**），**按降序索引向前回溯连续涨停日**，得 `boards`。
- **对齐依据**：服务端 `calculateBoards`（`leaderCandidates.ts:633-644`）用的正是**降序**交易日索引（`:608` 注释：「全量降序交易日里，自 `targetDate` 起向后的那一段恰好就是『截至目标日』的交易日集合」）⇒ `targetIndex + 1` = **更早的交易日** ⇒ **回溯历史、PIT 安全** ✅
- ⚠️ **已知坑**：服务端用**真交易日历**（`sharedIndex.tradingDates`），实验只能用**事件日期集合**（某交易日若全市场零涨停则该日缺失）。本窗口实测 220 个交易日、A 股同期约 216~220 个 ⇒ **实践中无缺口**，但须在 README 登记该差异（延续 AUDIT §3.2）。
- ⚠️ **禁用** `limit_up_records.boardCount`（§2.4 实测不可用）。
- 🔴 **严格来说 F1 的收益口径有「因子值可能含未来信息」的风险吗？** 不：`boards` 只用**当日及以前**的涨停日 ⇒ PIT 安全。但要**显式声明** `informationBoundary.decisionTimeInformation` 含「信号日及以前的连续涨停日数」。

### F2 · 题材家数 `sectorCount`

- **做法**（复刻 `leaderCandidates.ts:664-672`）：
  1. 每行 `resolveThemeWithFallback({ sector, keywords })` → `theme`（`null` ⇒ **不并入任何题材桶**，`:666`）；
  2. 按 `tradeDate` 分组，同组内按 `theme` 计数 = 每个事件当日的**同题材涨停家数**；
  3. 题材缺失/无法解析的行 → 用「**同日已解析题材家数的中位数**」中性兜底（`:672` `neutralSectorCount`），且**不参与风险扣分**（本次不做风险扣分）。
- ✅ `normalizeSectorName` / `resolveThemeWithFallback` 都在 **`shared/`** 且**已有 import 先例**（D1）⇒ 口径可与服务端逐条对齐。
- 🔴 **必须声明的口径选择**：服务端用 **`limit_up_records` 全量**（含创业板 / 科创板 / 北交所 / ST）算同日同题材家数；而实验读的是已按 `boards:["main"]` 过滤的事件表 ⇒ 实验算出的家数**系统性小于服务端**。
  - 本方案采用「**主板内同题材家数**」，理由是**它更符合裁定 3**（研究样本 = 沪深主板）；
  - 但必须显式标注「**不等于服务端的全市场口径**」，并把「分母口径（主板内 vs 全市场）」列为一个**研究议题**（可做一次对照 Run 量化差异）。
- ⚠️ 桶边界 `min(n,6)` ⇒ **6 家与 20 家同桶**（服务端封顶）⇒ 该桶内部异质性最大，需在 observations 里提示。

### F3 · 封板时间 `limitUpTime`

- **做法**：直接取列，按 `HH:MM:SS` 转分钟；**5 档 + 缺失档**（缺失档保留，因为服务端给缺失 2 分，是不可忽略的一档）。
- ⚠️ 缺失档 2,848 条（17.6%）且**集中在早期**（D4）⇒ 缺失档的收益必须单独解释为「采集缺口」而非「因子的某个取值」。

### F4 · 成交额

- 🔴 **取 `sourceTurnoverAmount`（亿元），禁用 `turnover` 列（那是换手率）** —— D1 命名撞车。
- 桶边界 = 服务端档位 `≥20 / 10~20 / 5~10 / 2~5 / <2`（亿）。
- ⚠️ 单位对齐：服务端比较用的是「亿元」数值（`turnover >= 20`），dataset 列同为亿元（实测 `42.9` / `1.4`）⇒ 无需换算。

### F5 · 流通市值

- 取 **`sourceCirculationValue`（亿元）**，禁用 `marketCap` / `floatMarketCap`（**0% 填充**，§2.2）。
- 桶边界 = 服务端倒 U 型档位 `<20 / 20~80 / 80~200 / 200~500 / >500`（亿）+ 缺失档。
- ⚠️ **倒 U 型**：报告里必须按「不是单调关系」来呈现；若某档 CI 明显偏离，那是**对服务端档位设计的直接检验**。

---

## 5. 分期

```
Phase A（基座，前置）──► Phase B（F3/F4/F5 直接取列，快）──► Phase C（F1/F2 需派生）──► Phase D（跨因子对比 + 报告）
```

### Phase A · 共享基座 + 合规骨架（前置，不可跳过）

| 步骤 | 做什么 | 落点 |
|---|---|---|
| A.1 | 抽 `research-experiments/shared/comboFactor/` 公共基座：事件读取+派生（`dataset.ts`）、桶定义（`buckets.ts`）、收益样本装配（`forwardReturn.ts`）、结果组装（`assemble.ts`）、类型（`types.ts`）、`index.ts` | `research-experiments/shared/comboFactor/**` |
| A.2 | 复用（**不重写**）`research-experiments/shared/dateClusterBootstrap.ts#movingBlockBootstrapMean` | 同上 |
| A.3 | 定 `combo-v1` 的 `datasetRequirement`：`datasetCode` + `requiredColumns`（**每个列名都必须真实存在**，否则运行时 `EXPERIMENT_METADATA_INVALID`）+ `eventScanPolicy: "FULL_DATASET"` + `usesForwardData: true` + `forwardDataPurpose` | 各 `experiment.ts` |
| A.4 | 缺失归因与逐月披露（D4） | `result.ts` |
| A.5 | 单测：桶边界、`boards` 派生、`sectorCount` 横截面、缺失归因账平（`eligible + excluded === candidate`） | `tests/server/researchExperiments/**` |

**判据**：`tsc --noEmit --incremental false` 错误集合不变（基线 0 错）；`pnpm run test:changed` 通过的**文件集合** ⊇ 基线（基线 = 8 失败文件 / 17 例，只登记不修）。

### Phase B · F3 / F4 / F5（三个「直接有列」的因子，先跑出结果）

- 三个实验目录：`combo-backtest/factor-limit-up-time-study` / `factor-turnover-amount-study` / `factor-circulation-value-study`
- 每目录四件套（`experiment.ts` / `result.ts` / `page.tsx` / `README.md`）+ `manifest.ts` 注册 + `client/src/researchExperiments/pages.ts` 注册
- **先跑 F4 与 F5**：F4 能顺手验证 D1 的命名撞车是否取对（成交额桶样本应远多于/异于换手率分桶）；F5 的倒 U 型是最可能出反直觉结论的一个

### Phase C · F1 / F2（需要派生的两个因子）

- 目录：`combo-backtest/factor-boards-study` / `factor-sector-count-study`
- 额外工作：F1 连板数派生（含交易日集合构造）、F2 横截面家数（含中性兜底）+ 「主板内 vs 全市场」口径对照
- ⚠️ F2 若两口径结论异号 ⇒ 报告按口径**分别陈述，不得合并**

### Phase D · 跨因子对比 + 研究报告

| 议题 | 内容 |
|---|---|
| S1 | **五因子有效区间汇总表**：每个因子的「有效·正向」桶并集 + CI，**分段原样呈现**（D2） |
| S2 | **档位设计检验**：服务端给的档位分数（42/24/10/8/16…）与实测桶收益序是否同向；**反向的档位**单独列出（这是对评分函数最有价值的反馈） |
| S3 | **因子间重叠度**：各因子的「有效区间」是否指向同一批事件（同一事件被几个因子同时选中）⇒ 不做这步，单因子结论会互相污染 |
| S4 | **缺失期对照**：把「缺失月（2025-11~2026-05）」与「完整月（2026-08~09）」的桶收益做一次切片对照，量化 D4 的时间偏斜影响（描述性，不得称稳健） |
| S5 | **多重比较披露**：90 个判定的 Bonferroni 校正后是否仍成立（D2） |
| S6 | 报告落盘 `docs/research/`，**强制窗口限定**（裁定 4） |

---

## 6. 交付物清单

### 新增（Phase A~C）

```
research-experiments/shared/comboFactor/{index,dataset,buckets,forwardReturn,assemble,types}.ts
research-experiments/combo-backtest/factor-boards-study/{experiment,result,page,README}.ts(x|md)
research-experiments/combo-backtest/factor-sector-count-study/{...}
research-experiments/combo-backtest/factor-limit-up-time-study/{...}
research-experiments/combo-backtest/factor-turnover-amount-study/{...}
research-experiments/combo-backtest/factor-circulation-value-study/{...}
tests/server/researchExperiments/comboFactor*.test.ts
```

### 修改（3 处注册 + 改名）

| 文件 | 改动 |
|---|---|
| `research-experiments/manifest.ts` | 追加 5 行 import + 5 个数组项（⚠️ `:80-84` 只给 `first-board-pullback/` 前缀套底座，本组**不套**） |
| `client/src/researchExperiments/pages.ts` | 登记 5 个 `pageKey` |
| `research-experiments/combo-backtest/leader-candidate-baseline/` | **裁定 2 改名**（附带）：`experiment.ts:262` `name` → 「原始策略（legacy 语义）镜像」、`:307` `pageTitle` → 「原始策略镜像（legacy）」、README 首行写清「镜像的是 `/backtest` 的 `baseline`，**不是**生产 `leader-candidate-baseline`」。**`descriptor.id` / 目录名 / `manifest.ts` / `pages.ts` key 一律不动**。⚠️ 先核 `name` 是否进 `experimentCodeDigest`；若影响既有 Run 指纹 ⇒ 只改 `pageTitle` + README |

### Phase D

```
docs/research/RESEARCH-COMBO-BT-FACTOR-REPORT-001.md   （五因子有效区间汇总 + S1~S5）
```

---

## 7. 判据（可执行）

| # | 判据 | 命令 / 依据 |
|---|---|---|
| 1 | 类型零错 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` ⇒ **错误集合不变**（基线 0 错） |
| 2 | 测试不劣化 | `pnpm run test:changed` ⇒ 通过**文件集合** ⊇ 基线；失败集合 ⊆ 基线 8 文件 / 17 例（先剥 ANSI 色码再比） |
| 3 | 行尾零漂移 | `node scripts/checkEolDrift.mjs` ⇒ **0 漂移** |
| 4 | 样本账平 | 每个实验 `eligible + excluded === candidate`；`Σ excludedByReason === excluded` |
| 5 | 全量声明 | 声明 `FULL_DATASET` 就必须在**首屏**出 `unscannedEventCount`（`0` = 全量成立，`null` = 总数未知） |
| 6 | 前视合规 | 读 `rd ≥ 1` 必须 `usesForwardData: true` + `forwardDataPurpose`；另须有**显式**「因子值只用信号日及以前信息」的声明（F1/F2 尤其重要） |
| 7 | 页可达 | 5 个 `pageKey` 各能被**正常导航**打开并渲染出表格/图（不能只看 API 通） |
| 8 | 结果可追溯 | 每个 Run 落 `result.json` + `logs/run.log`；结论必须能在结果里逐项对上 |
| 9 | 措辞合规 | 实验与报告里**零**「最优区间 / 最佳参数 / 排名」；所有结论带 `combo-v1` 窗口限定 |

---

## 8. 与本编号**前一版方案**的关系（废止清单）

本方案**取代** 2026-09-24 早些时候的同编号版本（那版是「策略镜像 + 综合评分敏感性」）：

| 旧方案内容 | 现状 | 原因 |
|---|---|---|
| Phase 0「修 8 处口径 + 逐笔对拍」（AUDIT §3） | ❌ **移出本次范围，降级为非阻塞** | 单因子分桶研究**不涉及策略语义**（无选股 / 仓位 / 撮合）⇒ 不需要策略等价性对拍 |
| Phase 1「参数化」（`parameters: []` → 阈值/退出/分仓可调） | ❌ 移出 | 本次不做策略回测 |
| Phase 2「建 `combo-v2`」 | ❌ 已由裁定 4 取消 | 用户更正 |
| Phase 3 R2「准入阈值敏感性」/ R4「退出政策对比」/ R5「分仓方式」 | ❌ 移出 | 都是**策略层**议题；本次是**因子层** |
| Phase 3 R3「单因子消融」 | 🔄 **被本方案取代** | 消融仍属综合评分框架；本方案是**因子独立成实验**（裁定 5） |
| Phase 3 R6「随机基准对照」 | ⏸️ 保留为**可选后续**（本方案不排期） | 它回答「排序有没有 alpha」，与「单因子有效区间」不是同一问题 |
| 现有实验 `leader-candidate-baseline` | ✅ **保留不动**（仅按裁定 2 改名） | 它是既成资产；与本次 5 个因子实验**并列共存**，不作对照基准（它不是因子） |

⚠️ **AUDIT §3 的 8 处口径差异仍然真实存在**，只是**对本次范围不构成阻塞**；将来若重启「策略回测」研究，那份清单仍是必读。

---

## 9. 风险与已知边界

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 🔴 **裁定 4 ⇒ 单窗口 11 个月，结论不可外推** | 确定 | 高 | 全部结论带窗口限定；报告拒绝外推措辞；不做「长期有效」陈述 |
| 🔴 **排除 ST 做不到（D3）** | 确定 | 中 | 选项 A 登记 `LIMITATION` + 估算 ST 占比；或裁定 B 改构建器（成本高） |
| 🔴 **因子列系统性缺失偏斜（D4）** | 确定 | 高 | 逐月披露 + S4 缺失期对照切片 + observations 出 `LIMITATION` |
| 🔴 **取错列（`turnover` vs `sourceTurnoverAmount`）** | 中 | **致命** | 代码注释写死 + A.5 单测断言「成交额平均值量级 ≈ 亿元」 |
| ⚠️ 分桶后样本不足（`< 100`） | 中 | 中 | D2 强制「样本不足」，不硬做统计 |
| ⚠️ 多重比较假阳性（≈90 个判定） | 高 | 中 | S5 Bonferroni 披露 + 声明「探索性」 |
| ⚠️ F2 家数分母口径（主板内 vs 全市场） | 确定 | 中 | 显式声明 + 口径对照议题；异号则分别陈述 |
| ⚠️ 2026-09 只有 961 条、且为窗口末端 | 确定 | 低 | 不做「最近期外推」 |

---

## 10. 待裁定（仅 1 项，其余已锁）

| # | 问题 | 选项 | 建议 |
|---|---|---|---|
| 1 | **ST 怎么办（D3）？** | A 接受不排除 + 登记 `LIMITATION`（零成本） / B 改 `datasetRegistry` 加 `isSt` 列并重建数据集（改 `server/**` + 重活） / C 实验侧反查（**不可行**） | **A** —— 11 个月窗口下 ST 占比有限，先把研究跑起来；若 S1 出现临界结论再评估 B |

---

## 附：本次方案的事实来源（全部实测，非推断）

- **源码逐行**：`leaderCandidates.ts:596-660`（`buildLeaderCandidatesForDate` / `calculateBoards` / 降序交易日索引）、`:664-703`（题材聚合 + 评分公式）、`:807-823`（准入与排序）、`:515-523`（流通市值档位）、`builder.ts:252-292`（事件行装配）、`shared/stockDataNormalization.ts:2`、`shared/fieldAvailability.ts:247-262`。
- **范式对照**：`research-experiments/first-board-pullback/turnover-study/{README.md,experiment.ts,result.ts}`、`research-experiments/template/README.md`、`research-experiments/shared/dateClusterBootstrap.ts`。
- **数据库只读直查**（2026-09-24，无任何写入）：
  - `C:\work\sourcecode\_scratch\probe_combo_event_cols.mjs` → `probe_combo_event_cols.out.txt`（表清单 + 列结构 + 样本行）
  - `probe_combo_factor_cols.mjs` → `probe_combo_factor_cols.out.txt`（填充率 / 板块分布 / 单日横截面 / post 表 / ST 表结构）
  - `probe_st_boardcount.mjs` → `probe_st_boardcount.out.txt`（ST 取值 / `boardCount` 分布 / 量纲抽样 / 缺失按月）
  - ⚠️ 三个脚本均在**仓外临时目录**，不属于交付物。
