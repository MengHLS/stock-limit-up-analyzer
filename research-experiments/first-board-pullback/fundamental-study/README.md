# EXP-001 · 首板后回踩第一性研究

`pageKey` = `first-board-pullback/fundamental-study` · 计算口径版本 `1.0.0`

## 研究问题

一只股票**首次涨停（首板）之后**，T+1 ~ T+5 的价格路径长什么样？

- 多久出现一次**回踩**？
- 回踩**多深**？
- 有没有**跌破首板日开盘价**？如果跌破了，是第几天破的？
- 站在 T+1 ~ T+5 其中任意一天收盘时看，后面的 T+5 / T+10 / T+20 又是什么分布？

目标只有一句话：**让「这个现象到底存不存在、有多强、在哪些维度上存在」变成可复核的事实**，
而不是产出一个策略。

## 与「入场日基础统计」（`entry-day`）的分工

| | `entry-day` | 本实验（`fundamental-study`） |
| --- | --- | --- |
| 立场 | 站在**入场**视角：第 k 天买入持有到第 exit 天 | 站在**事件**视角：首板之后路径本身 |
| 基准锚 | 首板日**收盘** | 首板日**开盘价** + 首板日**收盘价**（双锚） |
| 核心量 | 入场位置 / 持有收益 / 最大不利偏移 | 回踩 / **破首板日开盘价**（路径条件）/ 回撤深度分桶 / 后续视界 |
| 会回答「哪天入场最好」吗 | 不回答（刻意） | 更不回答（刻意） |

## 口径（逐项可复核）

| 量 | 定义 | 数据来源 |
| --- | --- | --- |
| `firstLimitUpOpen` | 首板日（rd=0）开盘价 —— **最重要的基准** | `ds_first_limit_pullback_prefix` |
| `firstLimitUpClose` | 首板日（rd=0）收盘价 | `ds_first_limit_pullback_prefix` |
| `firstLimitUpPrice` | 首板日涨停价（`limitUpPrice` 列，逐事件事实） | `ds_first_limit_pullback_event` |
| 观察日路径 | rd = 1 ~ `maxObservationDay`（默认 1..5）逐日 OHLC | `ds_first_limit_pullback_post` |
| `lowReturnFromClose` | `low / firstLimitUpClose − 1`（小数比例，负 = 下跌） | 派生 |
| `closeReturnFromClose` | `close / firstLimitUpClose − 1` | 派生 |
| **回踩** `pullbackBelowClose` | 当日 `low < firstLimitUpClose` | 派生 |
| **破位** `breakBelowOpen` | 当日 `low < firstLimitUpOpen` | 派生 |
| **不破** `nonBreakOpen` | **路径条件**：从 T+1 到当日，**每一天**的 `low` 都 ≥ `firstLimitUpOpen` | 派生（累积） |
| 回撤深度（对收盘） | `drawdownFromClose = low / firstLimitUpClose − 1` | 派生 |
| 回撤深度（对开盘） | `drawdownFromOpen = low / firstLimitUpOpen − 1` | 派生 |
| 后续视界 | rd ∈ `futureHorizons`（默认 5/10/20）的区间 high / low / close 相对同锚的收益 | 派生 |
| MFE / MAE | 与**同锚**的 `futureHighReturn` / `futureLowReturn` 数学恒等 | 派生 |

**样本单位** = **1 个首板事件**（不是「股票一天」）。同一只股票在同一数据集里可以贡献多个事件。

### 两个刻意的约定（不是研究发现）

1. **「不破」是路径条件，不是终点条件**：T+1 没破、T+2 没破、T+3 跌破 ⇒ 截至 T+3
   `NON_BREAK_OPEN = false`，**不因为 T+5 涨回去而改回 true**。反之亦然 ——
   每一天的 `nonBreakOpen` 是**从那一天起向前看整条已走路径**的结论。
2. **`nonBreakOpenBeforeEntry` 在入场日 = T+1 时是空路径恒真**：
   T+1 开盘入场时，T+1 之前没有任何已实现的路径日 ⇒ 该字段必然为真，这是**定义结果**，
   已在结果 `selectionNotes` 与 LIMITATION 观察里显式登记，**不得**当作「T+1 入场最安全」的证据。

比率类字段**一律为小数比例**（`-0.032` 表示 −3.2%），**不与百分数混用**；
回撤深度**负数表示下跌**。

## 参数（研究范围，不是优化参数）

| code | 类型 | 默认 | 边界 | 含义 |
| --- | --- | --- | --- | --- |
| `maxObservationDay` | INT | `5` | [1, 5] | 观察窗口末端的相对交易日 |
| `futureHorizons` | INT_LIST | `[5,10,20]` | 元素 ∈ [1, 20] | 后续视界（相对日） |
| `drawdownBucketEdgesBps` | INT_LIST | `[0,-200,-500,-800,-1000]` | 元素 ∈ [-10000, 0] | 回撤深度分桶边界（**基点**，负数 = 下跌） |
| `maxEvents` | INT | `20000` | [100, 20000] | 事件扫描/计算上限（平台安全阀） |

> 这些参数描述的是**研究的范围**（看多远、看多深、分几档），不是待优化的超参数。
> 改它们不会让「最佳参数」浮现，只会改变观察的分辨率。
> `maxObservationDay` 上界被钉在平台声明的决策偏移日（5）——观察窗口一旦超过它，
> 就不再是「首板后 T+1~T+5 的短窗口研究」了。

## Dataset 声明

- `datasetCode = first_limit_pullback`
- `prefixRelativeDays = [0]`；`postRelativeDays = [1..20]`（平台声明面；实际使用面由参数收窄）
- `requiredColumns`：
  - events `[isFirstLimit, boardType, limitUpPrice, previousClose]`
  - feature `[open, high, low, close]`
  - observation `[open, high, low, close]`
- `usesForwardData = true`（**必须**：研究的正是事件日之后的路径），
  `decisionOffsetDays = 5`

### 信息边界（PIT）

| 类别 | 内容 |
| --- | --- |
| **决策时信息**（首板日收盘即可知） | 首板日 OHLC、涨停价、前收盘、`isFirstLimit` / `boardType` 等事件事实 |
| **事后研究结论**（决策时**不可知**） | T+1~T+5 路径、回踩/破位统计、回撤深度分桶、后续视界分布、突破时间 |

本实验**只**做描述性研究：用事后路径去**检验**现象是否存在，
**不**把任何事后统计回写成入场条件。任何「因为 T+3 平均收益高所以应该在 T+3 买」
都是本实验明确拒绝的推理。

## 数据质量与样本账（强制平账）

Summary 保留 `candidateCount` / `includedCount` / `excludedCount` / `excludedByReason`，
满足 `included + excluded = candidate`，且 `Σ excludedByReason = excluded`。
剔除原因是一个**闭集**（`EXCLUSION_REASON_LABELS`）：

| code | 含义 |
| --- | --- |
| `MAX_EVENTS_LIMIT` | 超出 `maxEvents` 上限，被截断（**不静默丢弃**） |
| `MISSING_EVENT_DAY_BAR` | 首板日（rd=0）没有行情行 |
| `INVALID_EVENT_DAY_OPEN` | 首板日开盘价缺失 / 非正 / 非有限 |
| `INVALID_EVENT_DAY_CLOSE` | 首板日收盘价缺失 / 非正 / 非有限 |
| `INVALID_EVENT_DAY_OHLC` | 首板日 OHLC 内部矛盾（high/low 倒挂等） |
| `MISSING_LIMIT_UP_PRICE` | 事件事实里没有涨停价 |
| `MISSING_OBSERVATION_BAR` | 观察窗口内**缺任何一天** ⇒ 整条路径判不可用（**禁跳洞取数**） |
| `INVALID_OBSERVATION_OHLC` | 观察窗口内某日 OHLC 非法 |

> **禁跳洞取数**：`contiguousWindow()` 要求窗口内每一天都存在。缺一天 ⇒ 整事件剔除，
> 而不是「有什么用什么」——后者会让样本量随数据完整度漂移，且让路径类指标失去可比性。

### 🔴 守恒式覆盖不到的「账目缺口」

平台强制的两条守恒式（`eligible + excluded = candidate`、`Σ excludedByReason = excluded`）
只覆盖**已经进入候选的事件**。而事件扫描前还有一道**平台安全阀**
（`PLATFORM_EVENT_SCAN_LIMIT`）：触顶后本轮只能拿到确定性排序后的前 20000 个事件，
**其余事件既不在候选、也不在剔除清单里** —— 守恒式对它们恒真，起不到任何保护作用。

因此本实验**额外**输出 `customPayload.candidates.unscannedEventCount`
（= `datasetEventCount − candidateCount`），并在**三处**显式登记：页面首屏告警条、
`sampleSummary.notes`、一条 `LIMITATION` 观察。值为 `null` 表示数据集未声明事件总数
⇒ 缺口**不可知**，**不等于**缺口为 0。

**两个上限不要混淆**（EXP-001 真机 Run 实测踩过：本 README 曾把两者写成一个）：

| 上限 | 位置 | 作用对象 | 超出后的表现 |
| --- | --- | --- | --- |
| 平台事件扫描安全阀 `PLATFORM_EVENT_SCAN_LIMIT`（20000） | 平台 `datasetPort` | **扫描到的事件行** | 事件**根本没进候选** ⇒ 只能靠 `candidates.unscannedEventCount` 记录 |
| 实验参数 `maxEvents`（默认 20000） | 本实验 `run()` | **去重后的候选事件** | 逐条登记 `MAX_EVENTS_LIMIT`，进 `excludedByReason` |

## 已知偏差（不藏）

1. **数据可得性选择偏差**：样本资格要求观察窗口内行情齐全。临近数据集末端的事件
   会因行情不全被剔除 —— 这是**数据可得性**条件，不是价格条件，已逐项计入剔除原因。
2. **事件扫描安全阀截断**：平台单 Run 最多扫描 20000 个事件（数据集 v2 声明 23978 个）。
   未被扫描的 3978 个事件既不在候选、也不在剔除，由 `candidates.unscannedEventCount`
   单列登记（见上节）。事件按 `tradeDate` / `eventId` 确定性排序后截取，
   因此**同一版本 + 同一参数的结果可复现**。
3. **未做行业 / 市值 / 板块中性化**：`boardType` 在 v1/v2 上全为 `main`，
   因此本实验没有按板块分层的切片（有分层才是伪信息）。
4. **后续视界受数据集物理视界限制**：post 物理视界为 rd ∈ [1,20]，
   因此 T+20 之后的「后续表现」本实验**不产出**（而不是用更短窗口冒充）。
5. **突破研究的分母是「已走到该视界且行情齐全」的事件**：视界越远，可比样本越少，
   跨视界的 `breakoutRate` 不可直接互相比较。

## 本实验刻意**不**做什么

- 不排序、不评级、**不给「最佳观察日」/「最佳入场日」/「最优回撤区间」**；
- 不产出策略、不做参数搜索（不是 Parameter Search）；
- 不把任何一项统计写成可执行交易规则 —— 只输出**待验证假设** H1/H2/H3；
- 不在结果里写「所以 T+3 最好」「策略应该买入」「这个参数最优」这类话。

## 产物（Artifact）

跑完自动落对象存储（MinIO）+ Run 元数据落 TiDB，**关掉页面再打开仍能查看历史 Run**。

本实验显式声明 7 个（`name` **不含角色段**，角色段由 `role` 拼）：

| 声明 `name` | `role` | 最终 Object Key（Run 前缀 = `…/runs/{runId}/`） |
| --- | --- | --- |
| `daily_path_by_relative_day.csv` | `table` | `tables/daily_path_by_relative_day.csv` |
| `non_break_vs_break.csv` | `table` | `tables/non_break_vs_break.csv` |
| `drawdown_buckets.csv` | `table` | `tables/drawdown_buckets.csv` |
| `entry_day_comparison.csv` | `table` | `tables/entry_day_comparison.csv` |
| `future_horizon_comparison.csv` | `table` | `tables/future_horizon_comparison.csv` |
| `daily-path.svg` | `chart` | `charts/daily-path.svg` |
| `drawdown-buckets.svg` | `chart` | `charts/drawdown-buckets.svg` |

> 另由平台自动写入 `result.json`（结果信封）、`logs/run.log`（实验日志）、`manifest.json`（产物索引）。

大表**只走** `context.artifact()`，不塞 `customPayload` / `tables` —— 后者是给页面直接渲染的小数据。

## 怎么跑

1. 打开左侧栏「研究 → **独立实验**」（`/research-experiments`）；
2. 点开「首板后回踩第一性研究」；
3. 选择 Dataset 版本（`first_limit_pullback` 的 READY 版本，建议 `v2`）；
4. 点「运行」。

Dataset 坐标存在 URL（`?datasetVersionId=…`）里；Run 历史在页面下方可直接回看。
