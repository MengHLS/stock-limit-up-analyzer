# composite-runner-newhigh3-t74-trend（P0 · 3F 排序 × 趋势评分融合）

**目的**：在**完整组合回测**（资金循环 / `maxPositions=5` / 原止损 / MA5-MA10 趋势退出 / strongHold / T+1 冻结）
与 **T74 Runner**（`NEW_HIGH_3` / `decisionHoldingDays=5` / `extendToHoldingDays=74`）语义下，
验证「把趋势评分按权重融合进候选排序值」能否继续提高当前最高收益策略的收益。

## P0 的边界（只动一个东西）

| 动 | 不动 |
| --- | --- |
| 候选**排序值**：`(1-w)·3F + w·trendScore` | TopN=3、maxPositions=5、分层仓位（EQUITY_RATIO） |
| — | SL-18.1 统一退出链 / `candidateExitPolicy=DISABLED` |
| — | Runner 政策（`NEW_HIGH_3` / 5 / 74） |
| — | 数据集坐标（见下）、成本模型、T+1 冻结、整手、涨跌停 |

## 固定坐标

| 项 | 值 |
| --- | --- |
| 扩展 dataset | `datasetVersionId=780001`（v8 物理重建） |
| 基线 dataset | `datasetVersionId=660001`（v5，平台 provider 装配） |
| 控制臂策略 | `first-limit-pullback-3f-top3` + 组合 Runner T74（= 留档 `3600005@2.0.0` 的执行语义） |
| 控制臂 parity 目标 | A 15.7877% / 1619 笔；C 151.0958% / 1434 笔；Runner 触发 161 笔 |
| executionSurface | `COMPOSITE_PORTFOLIO` |

## 四条臂

| 臂 | 排序值 | trendWeight |
| --- | --- | --- |
| `control` | 纯 3F（`rankFusion = null`，走既有路径） | — |
| `trend-w20` | `0.8·3F + 0.2·trendScore` | 0.2 |
| `trend-w30` | `0.7·3F + 0.3·trendScore` | 0.3 |
| `trend-w50` | `0.5·3F + 0.5·trendScore` | 0.5 |

控制臂刻意用 `rankFusion = null` 而**不是** `w = 0`：`w = 0` 在数学上等于纯 3F，但**仍要求
`trendScore` 可算**（不可算的候选会被排除）⇒ 候选池可能变小，就不是「逐字段复现」了。

## 趋势评分 V1（`server/research/recipeFeatures/trendScoreFeatures.ts`）

```text
structureScore = (决策日收盘 > 事件窗收盘均值) 且 (最近 3 根收盘均值 > 最早 3 根收盘均值) ? 1 : 0
momentumScore  = momentumFromEventClose < 0        -> 0
                 0 <= momentum < 3%                -> 0.5
                 momentum >= 3%                    -> 1
pullbackScore  = pullbackFromEventPeakClose <= 3%  -> 1
                 3% < pullback <= 8%               -> 0.5
                 pullback > 8%                     -> 0
trendScore     = (structureScore + momentumScore + pullbackScore) / 3
```

🔴 **一处与方案 V1 的如实偏差**：方案原文的结构分是 `trendHoldsMa5Ma10`（收盘 > MA10 且 MA5 > MA10），
但**当前数据集坐标下 MA10 不可算** —— 实测 `750001` / `780001` 的 `prefix` 表**只有 `relativeDay = 0`**
（每个事件 1 行；`post` 为 `1..80`），即**没有任何 rd < 0 的预热行**，
决策日（T+5）可见历史只有事件窗内 6 根 ⇒ `computeTrendHoldsMa5Ma10` 在这个坐标上恒返回 `null`。
P0 因此改用**事件窗内均线结构**（同义：价在均线上 + 均线抬升）。

**边界全部是候选边界**：结构/动量/回踩的阈值必须在**训练段**冻结后才允许上 HOLDOUT，
不得在完整样本上调参；调整任一阈值 = 换了一个趋势评分定义 ⇒ 必须新开臂 / 新版本。

## PIT

- 趋势评分只读**事件日 rd0 → 决策日 rd5** 的 bar（`compositeRunner#decisionWindowBarsOf`）；
  rd 6..16 的行是既有研究面板的机械产物，**不参与**趋势评分。
- `trendScore` 不可算 ⇒ 该候选**被排除**（不插补、不填 0），并如实计入 `fusionDroppedCandidates`。

## 扩展行（rd17..80）的公平性

融合臂可能选中与纯 3F 臂**不同**的事件。实验 descriptor 的
`compositeExecution.extensionSelectionArms` 声明了四条臂，平台 provider 按**并集**装载
rd17..80 —— 否则融合臂会在 rd16 被数据边界截断，与 Runner 语义不可比。

## 成本（如实说明）

- 控制臂跑 A（无 Runner）+ C（挂 Runner）：A 承担 parity 参照并给出 Runner 触发笔数。
- 融合臂**只跑 C**：P0 的问题是「融合能不能提高**最高收益那支**」。
- 有独立后置窗口（OBSERVATION / HOLDOUT 协议）时，每臂再各跑 1 次 C。

## 已知边界

- 本实验**不做**参数搜索、不测其它持有上限、不测其它趋势评分定义。
- 结果不自动进 Candidate / Production；赢家需另走新 HOLDOUT 协议 + `createStrategyFromEvidenceRuns`。
- 控制臂 parity FAIL 时**不要**读融合臂的 Δ（说明数据/代码坐标已与留档不一致）。
- **首跑耗时**：平台 provider 按**臂并集**装载 rd17..80，并集越大、装载与投影越慢；四条臂比单臂慢是**预期行为**（不是卡死）。本次实现未在真实库跑完整 Run（只做了注入式单测），因此首个 EXPLORATORY Run 的实际墙钟时间以平台日志为准。
## 当前状态（2026-10-04 · EXPLORATORY 真实 Run）

真实 Run：`RUN-20261004-1CA33DAD`（datasetVersionId `780001`，COMPLETED，约 215 s；selectedEvents(union)=`10320`，executionRows=`1888970`；EXPLORATORY ⇒ 无 confirmatoryGate）。

| 臂 | C 收益 % | C 最大回撤 % | C 成交 | Δ vs 控制 (pp) |
| --- | --- | --- | --- | --- |
| 控制臂 · 纯 3F（T74） | **151.0958** | 43.303 | 1434 | 0 |
| 融合 20% 趋势 | **−59.2856** | 70.436 | 1517 | −210.38 |
| 融合 30% 趋势 | **−85.6001** | 88.787 | 1562 | −236.70 |
| 融合 50% 趋势 | **−95.2546** | 96.032 | 1610 | −246.35 |

🔴 **控制臂 parity PASS**（A `15.787690712129931%` / 1619 笔、C `151.0958341843399%` / 1434 笔、Runner 触发 161 笔，与 T74 留档逐项一致）⇒ 上面的 Δ **不是坐标漂移造成的**。

### 结论：P0 的 V1 趋势评分（作为排序项）被否

诊断探针（`_probe_p0_trend_diagnosis.mts`，只读基线投影 + 纯计算）给出三条证据：

1. **trendScore 太粗**：43,550 个候选只落在 7 个离散值上，其中 `0` 占 34.39%、`1/6` 占 31.16% ⇒ 约 66% 的候选只共享两个取值，融合后 TopN 边界大量交给 `securityId` 破平（≈任意）。
2. **换手剧烈**：w=0.2 就有 **74.2% 的交易日**换掉了选中集合（1962/5569 个槽位），w=0.5 达 **94.8%**（4131/5569）。
3. **方向相反**：融合把选中标的的平均 trendScore 从 `0.2477` 抬到 `0.4810 / 0.6442 / 0.7703`，同时把平均 3F 从 `0.6647` 压到 `0.6371 / 0.5836 / 0.5123`，收益随之单调恶化（151% → −59% → −86% → −95%），回撤同步恶化（43% → 70% → 89% → 96%）。

⇒ 在本策略语义下（T+5 决策、T+6 开盘买入、3F = 低振幅 + 低量比 + 回踩，再挂 T74 长持有），**「趋势越强越优先」是反向信号**：它系统性地挤掉了 3F 想要的「安静回踩」标的。

### 下一步（不在本实验内自动执行）

- **不要**用这版 trendScore 建策略版本；也不要重调 w 期待翻盘（剂量-反应是单调的）。
- 若仍要试趋势，建议换**用法**而不是换权重：① 作**门槛/过滤**（保持纯 3F 排序，只剔除趋势分极低者）——**已于 2026-10-04 实测并被否，见 `composite-runner-newhigh3-t74-trend-gate/README.md`（−172 / −225 / −226 pp）**；② 换**连续化**趋势度量（原始动量 / 回撤连续值或横截面分位），消除同值破平；③ 用**排名融合**（3F 分位 vs 趋势分位）替代分值融合；④ 或把趋势放到**退出**侧（该策略已有 MA5/MA10 与 strongHold）。
- 任何一个新方案都应新开实验 / 新臂，不要在 `RUN-20261004-1CA33DAD` 上回改。