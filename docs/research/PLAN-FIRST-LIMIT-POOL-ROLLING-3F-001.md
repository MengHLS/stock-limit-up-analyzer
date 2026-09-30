# 首板股票池滚动 3F Top3 — 实施与独立研究规格

## 目标

以 `first-limit-pullback-3f-top3@1.62.1` 为最高收益基线，建立独立策略
`first-limit-pool-rolling-3f-top3@1.0.0`：首板事件 T 入池，T+1 起逐日滚动评分，
低分移池，评分只影响未来买入，退出仍沿用 v1.62.1 统一退出政策。

## 默认参数

| 项 | 默认值 |
|---|---:|
| TopN | 3 |
| 最大持仓 | 5 |
| 单日最多买入 | 2 |
| 池龄 | 60 个交易日 |
| 最低分/移池线 | 0.55 |
| 滚动最大振幅 | <14% |
| 连续不可评分失效 | 3 个交易日 |
| 仓位分档 | 0~0.55 5% / 0.55~0.7167 20% / ≥0.7167 25% |
| 退出尾部数据 | 20 个交易日 |

## 评分与校准

- T+N（N=1..5）使用 T+1..T+N；T+5 后窗口固定。
- maxAmplitude / meanAmplitude 为 LOW 方向，t1VolumeRatio 为 HIGH 方向，等权。
- N=1..5 的桶边界基于 2019–2024 样本分别重估，证据见
  `docs/evidence/_calibration_rolling_3f_2019_2024.json`。
- 每次边界估计使用 type-7 线性分位：maxAmplitude 取 80% 分位；
  meanAmplitude 与 t1VolumeRatio 取 20/40/60/80% 分位。
- 校准边界冻结进版本；2025-01-01..2026-09-04 只用于最终留出验证。

## 数据

正式实验要求 `first_limit_pullback` 新版本使用 `postWindowDays=80`：
- rd=0..59：池成员决策日；
- rd=60：最后一日决策的次日执行；
- rd=61..80：池退场后的退出尾部。

事件 universe 由池策略的 `boardScope` 声明控制；正式策略固定为 `["main"]`，数据直读桥在
身份解析前过滤板块，保证与 v5 研究口径一致。

构建入口：`scripts/buildFirstLimitPoolV6Dataset.mts`。

## 研究臂

入口：`scripts/runFirstLimitPoolRollingStudy.mts`

1. `baseline`：v1.62.1。
2. `no-pullback-event`：无回踩门槛的事件窗 T+5。
3. `calibrated-event`：T+5 使用 N=5 重估边界的事件窗。
4. `fixed-pool`：池化但所有 N 共用冻结桶。
5. `rolling-pool`：池化 + 逐 N 校准（主策略）。

## 转正门槛

- 留出段总收益优于 v1.62.1；
- 最大回撤恶化不超过 5 个百分点；
- Calmar 不下降；
- 邻域参数不翻负，至少 4/6 年份为正；
- 2 倍成本压力下不亏。

通过后最高推进到 `Candidate`，不自动进入生产。

## 当前实施状态

- 滚动 3F、逐 N 校准、固定桶对照和 N=5 校准事件窗 recipe 已实现。
- 模式族服务端注册、tRPC 配置接口和前端“模式族配置”区已实现。
- 池化流式日游标、执行日和 20 日退出尾部语义已实现并有单测。
- `first_limit_pullback` 的 80 日后窗 `v6` 已完成并 READY（`datasetVersionId=720001`，102,878 事件）。
- 池化策略显式声明 `boardScope=["main"]`，在身份解析前过滤事件，严格对齐 v5 的正式研究 universe。
- 正式主策略、v5 短窗主冒烟及 fixed-pool / calibrated-event 对照冒烟均由现有闭环回测链完成并留档。
- v6 的池龄 5 短窗复跑与 v5 结果逐项一致，证明新数据版本、执行日和板块过滤链路已接通。
- v6 的正式池龄 60 短窗也已跑通并自动留档；该结果只用于链路验证，不替代 2025–2026 冻结留出实验。
- baseline、no-pullback-event、calibrated-event、fixed-pool、rolling-pool 五条研究臂均已至少完成一次真实短窗执行。
- 池化流式闭环接线已完成：`data` 阶段优先保存 `ResearchDatasetCursor`，research/backtest 不再要求一次性物化完整池化面板；短窗 v6 冒烟见 `RESULT-FIRST-LIMIT-POOL-STREAMING-001.md`。
- 2019–2024 rolling-pool 长窗口已完成：`ALL_EXECUTED`，累计 `-55.1805870878%`，最大回撤 `67.9220478166%`，996 笔成交（`archiveId=3120001`）。该结果未通过最低收益/回撤门槛，**不得执行 2025–2026 留出验证，也不得推进 Candidate/Production**；当前只保留归因与稳健性澄清工作。
