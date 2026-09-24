# 首板回测实验策展（`research-experiments/first-board-pullback/**`）

> 策展日期：2026-09-24
>
> 范围：22 个已注册的首板回撤核心实验（对照物 = `combo-backtest/leader-candidate-baseline`）。
>
> **事实来源（全部实测，不推断）**
>
> | # | 来源 | 用途 |
> |---|---|---|
> | ① | TiDB `research_experiment_run` 全表直查（86 条 Run / 23 个 experimentId） | 谁真跑过、跑了几次、样本账、失败原因、协议阶段 |
> | ② | 22 份 `README.md` 逐份通读 | 各实验自述口径与「刻意不做什么」 |
> | ③ | `FIRST-BOARD-PULLBACK-COVERAGE-AUDIT.md`（2026-09-22） | 口径问题与既有结论（本文件**引用它、不复述为自研**） |
> | ④ | `FIRST-BOARD-PULLBACK-FOUNDATION-V1.md` + 共享底座源码逐点核对 | 公共底座的真实能力边界 |
> | ⑤ | dataset_version 全表（8 个版本） | 各 Run 实际绑定的数据切片 |
>
> **本文件只做策展（分析 + 分层 + 提炼），零源码改动。**

---

## 1. 一句话结论

体系是**健康**的：22 个实验全部至少跑通过一次，共 **86 条 Run（75 COMPLETED / 11 FAILED / 0 在途）**，失败几乎全是「服务重启后人工收敛」这类运维原因，只有 1 条是真 schema 缺陷且已修。

但**「有用的」只有 7 个**（A 档）。真正的浪费不在实验数量，而在下面这条：

> 🔴 **3 个实验的 v5 结果只覆盖 27% 的数据**，且其中 1 个取的是**最早那一段**（时间截断）。
> 只要把它们的数字与其余 19 个并列，就是在拿两个不同样本集的数字互相比较。

---

## 2. 全量台账（22 个实验）

> 「v5 样本」= 该实验**最新一条 `v5` COMPLETED Run** 的 `candidateCount → eligibleCount`（直查 `summaryJson`）。
> `v5` = `datasetVersionId 660001` / 2018-12-31~2026-09-03 / 73,003 事件 / 首板事件 / 已排除 ST。

| # | 实验 | 测的维度 | 入场 / 决策 | 主退出 | v5 样本 | Run ✓/✗ | 档 |
|---:|---|---|---|---|---:|---:|:--:|
| 1 | `entry-day` | 入场日 / 入场位置 / 最大不利偏移 | T+1..T+5 固定开盘 | T+5 收盘 | 20,000 事件 ×5 = 100,000 机会 ⚠️ | 6 / 0 | **C** |
| 2 | `fundamental-study` | 回踩 / 破位 / 回撤深度 / 决策时点 / 未来视界 | 事件视角（无策略入场） | T+5/10/20 | 19,880 ⚠️ | 10 / 1 | **D** |
| 3 | `first-board-body-study` | 首板实体高度 6 桶 + 一字板 + 开盘缺口 | T+1 开盘 | T+5/10/20 | 73,003（全量） | 2 / 0 | B |
| 4 | `body-filtered-exit-curve-study` | 实体分桶 + 实际持有曲线 | T+1..T+6 可配（默认 T+6） | 共同样本持有曲线 | 54,620 | 3 / 2 | B |
| 5 | `entry-aligned-exit-horizon-study` | 严格涨停 + 排除一字板 + 排除 T+1..T+5 触涨跌停 | T+6 开盘 | 持有日 1..15 共同样本 | 35,015 | 5 / 4 | **A** |
| 6 | `hold-streak-amplitude-t10-study` | 守线 streak 0..5 × 平均/最大振幅 | T+6 开盘 | T+10 | 72,599 | 3 / 1 | B |
| 7 | `stability-validation` | 3 维 × 16 变体稳定性矩阵 | T+1..T+5 决策 | T+5/10/20 | 72,377 | 4 / 1 | **A** |
| 8 | `decision-forward-study` | 决策时点后严格窗口 `rd ∈ [k+1, h]` | T+1..T+5 决策 | T+10/20 | 72,601 | 4 / 1 | **A** |
| 9 | `dynamic-entry-path-distribution-study` | 动态入场后逐日路径 / MFE·MAE / 首达阈值日 | 首次回撤次日开盘 | 动态退出，最迟 T+10 | 72,375 | 3 / 0 | B |
| 10 | `dynamic-state-factor-expansion-study` | 同日分位（换手/振幅/实体/成交额）+ 历史涨停次数 + T+1 缺口/量比 | 首次回撤次日开盘 | 动态退出，最迟 T+10 | 72,368 | 3 / 0 | **A** |
| 11 | `conditional-pullback-state-exit-study` | 条件入场 3 对照（固定 vs 动态退出） | 首次回撤次日开盘 | 价格破位，最迟 T+10 | 72,599 | 2 / 0 | B |
| 12 | `hold-open-price-pullback` | 回撤但守住首板开盘价 | 首次回撤次日开盘 | T+10/15/20 | 69,935 | 3 / 0 | B |
| 13 | `limit-up-close-hold-study` | 收盘 vs 涨停价 3 组（守住/略破/深破） | T+6 开盘 | T+10/15/20 | 69,933 | 2 / 0 | B |
| 14 | `limit-up-price-hold-streak-study` | 守线 streak（收盘口径 / 盘中口径） | T+6 开盘 | T+10/20 | 72,599 | 3 / 0 | **C** |
| 15 | `oversold-gap-reversal-validation` | 冻结联合条件：间隔 >20 日 ∧ T-10 跌 < -10% | T+1 开盘 | T+10 主判定 | 71,377 | 3 / 0 | **A** |
| 16 | `pre-event-context-study` | 前次涨停间隔 × 前期涨幅（T-5/10/20） | T+1 开盘 | T+5/10/20 | 70,742 | 2 / 0 | **A** |
| 17 | `post-event-amplitude-study` | 是否触涨跌停 + 平均振幅 5 桶 | T+6 开盘 | T+10/15/20 | 72,601 | 2 / 0 | **C** |
| 18 | `turnover-study` | 首板换手率 6 桶 + 流通市值可用性 | T+1 开盘 | T+5/10/20 | 67,539 | 2 / 0 | **A** |
| 19 | `threshold-race-policy-study` | ±2% / ±5% 止盈·止损·对称退出（同事件配对） | 首次回撤次日开盘 | 阈值确认后下一可卖开盘 | 72,375 | 3 / 0 | B |
| 20 | `volume-relationship-dynamic-entry-study` | 12 个量比（PRE / ENTRY / POST）分 5 桶 | 首次回撤次日开盘 | 动态价格退出，最迟 T+10 | 72,599 | 2 / 0 | B |
| 21 | `volume-recovery-filtered-validation` | 实体/换手过滤 + 量能恢复退出（3 对照） | 首次回撤次日开盘 | 价格或量能，最迟 T+10 | 49,802 | 3 / 0 | B |
| 22 | `body-ma-support-screen-study` | 实体 + 6 组**重叠**支撑（实体顶/1半/底、MA5/10/20） | T+6 开盘 | 持有日 1..15 | 4,981 ⚠️（自设上限） | 1 / 1 | **D** |

**分层小计**：A = 7 · B = 10 · C = 3 · D = 2。

---

## 3. 分层结果

### 3.1 A 档 · 核心可用（7 个，继续作为主证据源）

判据 = 「有**别的实验没有的东西**」：更严的口径、更高阶的方法、或唯一的维度。

| 实验 | 它的独有之处（为什么留） |
|---|---|
| `entry-aligned-exit-horizon-study` | **口径最严**的一支：严格收盘涨停 + 排除一字板 + 排除 T+1..T+5 触涨跌停 + `commonSample` + 按实际持有日对齐。要谈「首板后到底有没有可持续收益」，这是**唯一**该引用的数字。代价是样本被削到 35,015（故意）。 |
| `stability-validation` | 体系里**唯一**做「容差判定」的实验（`evaluateTolerance`，方向 `both`），也是唯一有**自检行**（与基准同配置的变体，逐指标 `delta` 必须恰为 0）的。它回答的不是「有没有收益」而是「换个条件结论会不会翻」，**这是判断稳健性的唯一现成手段**。 |
| `decision-forward-study` | 修掉了 EXP-001 的**窗口重叠**缺陷（收益锚从首板日收盘改成决策日收盘，窗口锁死 `rd ∈ [k+1, h]`）。也是全仓**仅 2 个**跑过 Confirmatory 协议（OBSERVATION → HOLDOUT）的实验之一。 |
| `oversold-gap-reversal-validation` | **唯一**走完「冻结假设 → Observation Gate → Holdout Gate」全流程的实验，也是唯一给出 `HOLDOUT = FAIL` 的。⚠️ 它的价值**主要是方法学样板**（协议怎么写、指纹怎么绑、门控怎么设），不是结论。 |
| `pre-event-context-study` | **唯一**做「事件前上下文」的实验（前次涨停间隔 / 前期涨幅 / 两者联合矩阵）。⚠️ 这一族在组合回测侧**物理上缺列**（见 `combo-v1` 的 `preWindowDays: 0`），所以它同时是**不可替代**的。 |
| `turnover-study` | 换手率 6 桶 + **流通市值可用性**的显式判定（`floatMarketCap` 全空 ⇒ 标 `INSUFFICIENT_DATA`，且拒绝用现价×股本伪造 PIT 市值）。这是组合侧 F5（流通市值因子）的**直接先例**，也是「字段不可用要响亮登记、不要硬凑」的样板。 |
| `dynamic-state-factor-expansion-study` | **最接近「单因子独立测试」范式的一支**：同日横截面分位（换手率 / 振幅 / 实体 / 成交额）+ 历史涨停次数 + T+1 缺口 + T+1 量比，全部在**固定状态机**下测。⇒ 组合侧 5 个因子实验应直接以它为模板。 |

### 3.2 B 档 · 结论已定（10 个：保留作反证与背景，**不再新增 Run**）

这 10 个的结论已经稳定收敛，再跑只是重复消耗算力与额度。

| 实验 | 已获得的结论（引用自 2026-09-22 覆盖度审计 §4，v5 重跑与之不矛盾） |
|---|---|
| `first-board-body-study` | 实体高度分桶 → 过滤是**风险控制**，不是 alpha 来源。 |
| `body-filtered-exit-curve-study` | 实体 `1%~2%` 的弱正信号**只在 v4 出现**、v3 未复现 ⇒ 不可采信（这是「两切片不一致就丢弃」的正确示范）。 |
| `hold-streak-amplitude-t10-study` | ⭐ **高振幅是最明确的风险来源**：`streak=5` 且平均振幅 `>=8%` 在 v3 平均净收益约 `-0.89%`，Bootstrap 区间整体低于 0。低振幅能改善均值与回撤，但**中位仍多为负**。 |
| `dynamic-entry-path-distribution-study` | 动态入场后的路径分布已刻画；MFE/MAE 与首达阈值日已出数。 |
| `conditional-pullback-state-exit-study` | 动态价格退出相对「条件买入 + 固定 T+10」**没有增量**。 |
| `hold-open-price-pullback` | 单纯「不破首板开盘价」**没有稳定正收益**。 |
| `limit-up-close-hold-study` | 连续守住涨停价的收益**没有稳定正向证据**。 |
| `threshold-race-policy-study` | `±2%` 早期止损**无效**；止盈规则最多只有**弱**候选迹象。 |
| `volume-relationship-dynamic-entry-study` | 12 个量比的定义与 5 档分桶已冻结（词表可直接复用，见 §4.1）。 |
| `volume-recovery-filtered-validation` | 量能未恢复退出相对纯价格退出**没有增量**。 |

### 3.3 C 档 · 重叠 / 降级（3 个）

| 实验 | 处置 | 理由 |
|---|---|---|
| `entry-day` | **降级为「体系示例」**，不再作为证据源 | ① 跨入场日比较把「固定事件日退出」与「固定持有期」混在一起（覆盖度审计 §5.2 已判为会制造伪差异），该口径已被 `entry-aligned-exit-horizon-study` 的按 `holdingDay` 对齐取代；② 未声明 `FULL_DATASET`（见 §4 的 D-3）；③ 其 README 自述「结果不落库」**已过期**（DB 实有 6 条 Run）。 |
| `limit-up-price-hold-streak-study` | **归并到 `hold-streak-amplitude-t10-study`** | 同一维度（守涨停价 streak 0..5）在三个实验里各写了一遍；保留含振幅交互、口径最全的那个。 |
| `post-event-amplitude-study` | **归并到 `hold-streak-amplitude-t10-study`** | 振幅维度重复；两者对 `T+1..T+5` 平均振幅的分桶只是粗细之差（`<2/2-4/4-6/6-8/≥8` vs `<4/4-6/6-8/≥8`）。 |

> ⚠️ 「归并」= **文档层标注口径归属**，**不删目录、不改代码**（删目录会让历史 Run 的 `experimentId` 失去解释，且违反本体系「实验目录是历史 Run 的解释」这一隐含约定）。

### 3.4 D 档 · 样本口径缺陷（2 个，必须修）

见下一节。

---

## 4. 三个样本口径缺陷（逐条附实测证据）

> 共同背景：`v5` 声明 **73,003** 个事件。任何 `candidateCount < 73,003` 的 Run，都**不是**全量 v5 证据。

### D-1 `fundamental-study` — 代码已修，**v5 Run 未重跑**（只需重跑）

| 项 | 事实 |
|---|---|
| 现象 | v5 Run `RUN-20260922-C6D44711`：`candidateCount = 73,003`，`eligibleCount = 19,880`，`MAX_EVENTS_LIMIT = 53,003` |
| 根因 | 该 Run 传参 `maxEvents = 20000`（`parametersJson` 实测） |
| 当前代码 | ✅ **已修**：`defaultValue = FULL_DATASET_EVENT_SCAN_LIMIT`（`experiment.ts:133`），且已声明 `eventScanPolicy: "FULL_DATASET"`（`:148`） |
| 结论 | **不需要改代码，只需要在 v5 上重跑一次**。⚠️ 它的**结论**（回踩 / 破位 / 深度分桶）主要建立在 v2（23,978 事件、`maxEvents=400000` ⇒ 全量）之上 ⇒ **结论不被推翻**；不成立的是「拿它的 v5 数字与其它实验并列比较」。 |

### D-2 `body-ma-support-screen-study` — **自设 20,000 上限，且取的是最早一段**（时间截断）

| 项 | 事实 |
|---|---|
| 现象 | v5 Run `RUN-20260923-6D81653C`：`candidateCount = 20,000`，`eligibleCount = 4,981` |
| 根因 1 | 硬上限：`DEFAULT_MAX_EVENTS = 20_000` 且 `bounds.max` 也是它（`result.ts:12`、`experiment.ts:107`）⇒ **参数改不动**，只能改代码 |
| 根因 2 🔴 | `experiment.ts:170-178`：先按 `tradeDate` **升序**排序，再 `.slice(0, maxEvents)` ⇒ 取到的是 **2018-12 起最早的那 20,000 个事件**，即 v5 窗口**最前面 ~27%** |
| 为什么要紧 | 这不是随机子集，是**时间截断**子集。它同时是 22 个实验里**唯一没有跨切片复核**的（v5-only，1 成功 / 1 失败）⇒ 它的 4,981 个可用样本支撑不了任何跨市场阶段的结论 |
| 附带证据 | 失败的那条 Run 的错误码是 `EXPERIMENT_RUN_RECONCILED`，备注「full v5 scan superseded by deterministic 20k capped screen run」⇒ 20k 上限是**主动选择**，不是意外 |

### D-3 `entry-day` — 双重上限 + 未声明全量 + 定位已被取代

| 项 | 事实 |
|---|---|
| 现象 | v5 Run `RUN-20260922-C1DE8435`：`candidateCount = 100,000`（= 20,000 事件 × 5 个入场日），`prefixRowCount = 20,000` |
| 根因 1 | `maxEvents` 缺省 `2000`、`bounds.max = PLATFORM_EVENT_SCAN_LIMIT`（= 20,000）（`experiment.ts:84-85`） |
| 根因 2 | 该文件**没有** `eventScanPolicy`（全仓 21 个核心实验里只有它没声明）⇒ 走平台默认阀 20,000 |
| 结论 | 它**当前就是个示例实验**，建议：① 定位降级（C 档）；② 若要它继续出数，必须同时改 `eventScanPolicy` + 抬 `bounds.max`；③ README 的「结果不落库」段需要改写。 |

### 4.1 附：文档滞后清单（不影响计算，但会误导读者）

| 位置 | 过期表述 | 实际 |
|---|---|---|
| `entry-day/README.md`（末节） | 「结果**不落库**……刷新后需要重跑」 | `research_experiment_run` 实有 6 条该实验的 Run（RESEARCH-EXPERIMENT-004 起结果已持久化） |
| `entry-day/README.md`（口径表） | 默认 `maxEvents=2000` | v5 Run 实际用 20,000 |
| `FIRST-BOARD-PULLBACK-COVERAGE-AUDIT.md` 头部 | 「已经注册的 **21** 个独立实验」 | 现为 **22** 个（新增 `body-ma-support-screen-study`，2026-09-22 20:57 首跑） |

---

## 5. 可复用资产（「整理出有用的」的实质）

### 5.1 ⭐ 12 组已冻结的分桶定义（**本次策展最有价值的产出**）

这些桶是 22 个实验反复使用、跨切片检验过的**现成词表**。组合回测侧的因子实验**不应另造桶**——直接复用能省掉一轮「桶边界怎么定」的争论，也让两侧结论可比。

| 因子 | 桶边界 | 来源实验 |
|---|---|---|
| 首板实体高度 | `≤0.1%` / `0.1~2%` / `2~4%` / `4~6%` / `6~8%` / `≥8%` | `first-board-body-study` |
| 首板换手率 | `<1%` / `1~2%` / `2~3%` / `3~5%` / `5~10%` / `≥10%` | `turnover-study` |
| 同日横截面分位 | `0~20` / `20~40` / `40~60` / `60~80` / `80~100` 分位 | `dynamic-state-factor-expansion-study` |
| `T+1..T+5` 平均振幅 | `<2%` / `2~4%` / `4~6%` / `6~8%` / `≥8%`（粗桶 `<4/4~6/6~8/≥8`） | `post-event-amplitude-study` |
| `T+1..T+5` 最大振幅 | `<8%` / `≥8%` | `hold-streak-amplitude-t10-study` |
| 守涨停价 streak | `0..5`（收盘口径 / 盘中口径**分开**） | `limit-up-price-hold-streak-study` |
| 量比（÷T 日成交量） | `<50%` / `50~80%` / `80~120%` / `120~200%` / `≥200%` | `volume-relationship-dynamic-entry-study` |
| 前次涨停间隔 | `1~3` / `4~5` / `6~10` / `11~20` / `>20` / `UNKNOWN` 交易日 | `pre-event-context-study` |
| 前期涨幅（T-5/10/20） | `<-10%` / `-10~-5%` / `-5~0%` / `0~+5%` / `+5~+10%` / `+10~+20%` / `>+20%` | `pre-event-context-study` |
| 回撤深度（对首板收盘） | `0~-2%` / `-2~-5%` / `-5~-8%` / `-8~-10%` / `< -10%` | `fundamental-study` |
| `T+1` 开盘缺口 | `<-5%` / `-5~0%` / `0~+5%` / `+5~+10%` / `≥+10%` | `dynamic-state-factor-expansion-study` |
| 历史涨停次数 | `0` / `1` / `2` / `3~5` / `6~10` / `>10` | `dynamic-state-factor-expansion-study` |

> 纪律（覆盖度审计 §6 E4 已提）：**新增实验不得私自复制一份不同阈值**。

### 5.2 代码资产与真实可用边界

| 文件 | 作用 | 组合回测侧可用性 |
|---|---|---|
| `shared/dateClusterBootstrap.ts` | 日期聚类 Moving Block Bootstrap（`mulberry32` 固定种子、同一交易日不拆开） | ✅ **直接复用**（唯一实现，别重写） |
| `shared/firstBoardPullback/curves.ts` | 曲线累加器：均值 / 去最高 5% / 中位 / 胜率 / P5·P25·P75·P95 / MFE·MAE / 峰值·谷值日 / 首达 ±2%·±5% 日 + 锚点 Bootstrap | ✅ **直接复用**（因子桶只需经 `groupByEvent` 注入） |
| `shared/firstBoardPullback/panel.ts` | `entryDay × exitDay` 面板 + 「理想退出 vs 可成交退出」分离 + 右删失 | ✅ 复用（需换入场模式枚举） |
| `shared/firstBoardPullback/artifacts.ts` | 分片 gzip CSV artifact 写出 | ✅ **直接复用** |
| `shared/firstBoardPullback/foundation.ts` | 编排 + `lineage` 表 + 样本账三张表 | ⚠️ 复用编排骨架；🔴 `assertCoreDatasetV5`（`:32-42`）**写死 `v5`**，必须换 |
| `shared/firstBoardPullback/cost.ts` | 成本拆分（佣金 2.5 / 滑点 2.5 / 冲击 2.5 / 印花税 5 bps，往返 = 20bps） | ⚠️ 只可复用手法（买卖价分别调整）；🔴 **数值不可继承**：组合侧基调是「严格对齐服务端」（分层滑点、且服务端**没有**最低佣金），而首板侧是**固定 20bps 往返** |
| `shared/firstBoardPullback/dataset.ts` | 事件池判定 | 🔴 **不可直接用于组合侧**：硬编码 `isFirstLimit !== true → NOT_FIRST_LIMIT`（`:104`）、`boardType === "main" && market ∈ {SH,SZ}`（`:107`）—— 组合侧是 `limitUp` 事件且**必须容纳连板** |
| `shared/firstBoardPullback/wrapExperiment.ts` | 统一包装：追加公共面板 / 曲线 / Bootstrap / lineage | ⚠️ 可作**模板**；但 `augmentFirstBoardRequirement` 写死了首板列与 `v5` 标签 |
| `robustnessBridge.ts` | 唯一允许从实验面 reach `server/**` 的零实现引桥 | ✅ **直接复用**（要做稳定性 / 参数鲁棒性时） |

### 5.3 方法学资产（比代码更值钱）

1. **两段式确认协议**：`OBSERVATION → HOLDOUT` + `protocolFingerprint` 绑定 + 样本门槛门控。完整样板 = `oversold-gap-reversal-validation`；第二个 = `decision-forward-study`。
2. **容差判定 + 自检行**：`evaluateTolerance`（方向一律 `both`）+ 「与基准同配置的变体逐指标 delta 必须恰为 0」。⇒ 组合侧任何「换条件后结论会不会翻」的问题都应走这套。
3. **「账平 ≠ 全量」**：`eligible + excluded === candidate` 这两条守恒式**对未被扫描的事件恒真、毫无保护**；全量声明 + `unscannedEventCount === 0` 才是完整判据。本策展发现的 D-1~D-3 正是这条纪律的直接产物。
4. **各 README 的「刻意不做什么」清单**：这是一套现成的**禁止条款库**（不排序、不评级、不给最优阈值、不选最佳退出日、不把样本内称 OOS、不用现价造 PIT 市值……）⇒ 组合侧因子实验的边界可直接照抄。

### 5.4 证据资产（**已知结论，不要重跑**）

- **明确负向**：不破首板开盘价无稳定正收益 · 连续守涨停价无稳定正收益 · 动态价格退出 vs 固定 T+10 无增量 · 量能退出无增量 · `±2%` 早期止损无效 · 超跌长间隔假设 Holdout `FAIL` · 实体 `1~2%` 的弱正信号仅单切片出现 ⇒ **不可采信**。
- **明确风险向**：高换手 / 高振幅 / 高实体 / 高成交额的**同日高分位**组表现差 · 历史涨停次数越多越差 · 深度低开与 `T+1` 缩量差 · ⭐ **高振幅是最明确的风险源**。
- **结构性**：过滤能改善均值与回撤，但**中位仍多为负** ⇒ 单独过滤**不足以**形成正收益策略。
- **口径层**：`v2/v3/v4/v5` **全部是已读数据**，`v3/v4` 只能叫「时间切片复核」，**不是 OOS**。23 个实验里 `researchPhase` 全部为 `EXPLORATORY`，只有 2 个实验跑过 Confirmatory 协议。

---

## 6. 不可复用的部分（诚实边界）

1. `loadNormalizedFoundationEvents` 的事件池判定（见 §5.2）——写死了首板语义。
2. **`combo-v1` 的 `preWindowDays: 0`**（dataset_version 690001 的 `filterDefinitionJson` 实测）⇒ 组合侧数据集**没有事件前窗口**，§5.1 里的「前次涨停间隔 / 前期涨幅」这一族**物理上缺列**（只能另想办法派生或放弃）。
3. 首板侧成本口径（固定 20bps 往返）≠ 组合侧（严格对齐服务端）。
4. 首板事件（`isFirstLimit`）≠ 组合侧事件（`limitUp`，含连板）⇒ **分组维度不同**，`boards` 这个最重要的因子在首板侧**不存在**。
5. 首板侧的 `boardType` 实测 100% = `main` ⇒ **不存在板块分层**（这既是好事，也意味着首板侧从未验证过跨板块口径）。

---

## 7. 与组合回测因子实验的接口（结论）

| 直接搬 | 必须重写 | 不许碰 |
|---|---|---|
| 12 组分桶定义（§5.1）· `dateClusterBootstrap` · `curves` / `panel` / `artifacts` · 容差判定与自检行 · 禁止条款库 · 两段式协议骨架 | 事件池判定（`limitUp` + 连板派生）· 版本闸门（`combo-v1`，不能写死 `v5`）· 成本配置（服务端分层滑点、无最低佣金）· 入场模式枚举 | `/backtest` 页面 · `server/**` 的评分与撮合真源 · 生产 Strategy Engine · 表结构（零新表 / 零 migration） |

**下一步的完整方案见** `PLAN-FACTOR-EXP-001.md`（本策展是它的输入）。

---

## 附：本文件的证据来源

- TiDB 直查：`research_experiment_run`（86 条）、`dataset_version`（8 条）；只读，未写入任何行。
- 逐份通读：22 份实验 `README.md`、`research-experiments/README.md`、`docs/research/FIRST-BOARD-PULLBACK-FOUNDATION-V1.md`、`docs/research/FIRST-BOARD-PULLBACK-COVERAGE-AUDIT.md`。
- 代码逐点核对（非推断）：`entry-day/experiment.ts:84-85,89-106`、`fundamental-study/experiment.ts:133,148`、`body-ma-support-screen-study/experiment.ts:107,170-178` 与 `result.ts:12`、`shared/firstBoardPullback/*.ts` 全部、`shared/dateClusterBootstrap.ts`、`manifest.ts`、`client/src/researchExperiments/pages.ts`。
- 编制日期 2026-09-24；本文件**零源码改动**。
