# 首板股票池流式闭环接线冒烟结果

> 本文件记录流式接线证据，以及 2019–2024 主策略独立长窗口的首轮结果。

## 实现切片

- `ResearchDatasetCursor` 统一了内存数据集与池化逐日数据访问；池化实现支持 retained rows（主路径）与 `restart()`（兼容回退）。
- `ClosedLoopWiringInputs` 新增 `researchDatasetCursor`；`data` 阶段优先保存 cursor，不物化完整池化面板。
- `createStreamingClosedLoopWiring` 在进入同步编排器前完成真实 cursor research / backtest，并仍以现有 14 阶段状态机、指纹和展示契约输出。
- research 阶段把 cursor 审计写入 `researchSummary.notes`：bars 读取量、入池成员、退休成员、低分移池、峰值活跃成员。
- research 阶段按实际买入选中的面板身份保留逐日行，backtest 直接复用这批真实行，不再重放/二次读取游标；这避免了长窗口运行中两次读取状态漂移，并可保留退出尾窗。
- 回测窗口按 `poolAge + exitTailTradingDays` 扩展，保证最后决策日之后的执行/退出尾窗仍可消费。

## 2025-03-01 ~ 2025-03-14 冒烟

- 策略：`smoke-pool-rolling-3f-top3@0.0.5`
- 数据集：`first_limit_pullback` v6（datasetVersionId=720001）
- 池龄：5 个交易日
- 闭环：`ALL_EXECUTED`（5 个核心阶段执行，0 阻塞）
- 数据集来源：`registry`，未回落重建
- datasetVersion：`rd-1.0.0-1-f7002c95388d814c`
- 累计收益：`+5.4669806591%`
- 最大回撤：`2.6935007353%`
- 成交：11 笔，胜率 `81.8182%`，profit factor `16.1264`
- 留档：`persisted=true`，`archiveId=3060001`

## 长窗口状态差异回归冒烟

- 策略：`smoke-pool-rolling-3f-top3@0.0.7`
- 窗口：2020-11-01 ~ 2021-01-31
- 数据集：v6 / datasetVersionId=720001
- 池龄：60 个交易日
- 闭环：`ALL_EXECUTED`
- 结果：累计 `-3.2098536064%`，最大回撤 `16.6475124682%`，47 笔成交，留档 `archiveId=3090001`
- 该窗口覆盖并修复了“research 读到行、backtest restart 后读不到行”的数据源漂移：backtest 现在复用 research 期间按候选身份 retained rows，不再重放游标。

## 2019-01-01 ~ 2024-12-31 rolling-pool 主策略长窗口

- 策略：`study-first-limit-pool-rolling-3f-rolling-pool@1.0.0`
- 数据集：v6 / datasetVersionId=720001
- 池龄：60 个交易日；最低分：0.55
- 闭环：`ALL_EXECUTED`
- datasetVersion：`rd-1.0.0-1-e55d21d00f827786`
- 累计收益：`-55.1805870878%`
- 年化：`-12.8125692266%`
- 最大回撤：`67.9220478166%`
- 成交：996 笔，胜率 `42.1529%`，profit factor `0.8857`
- 留档：`archiveId=3120001`

该结果远低于 `v1.62.1` 基线，且最大回撤远超转正门槛；因此**不得推进 Candidate/Production，也不得执行 2025–2026 留出验证**。下一步只做归因/参数稳健性澄清，不能把该长窗口当作可通过的正式结论。

同窗口 baseline 全量重跑已尝试，但在装配阶段遇到数据库 `ECONNRESET`（`index_daily` 查询）中断；需在网络/连接稳定后重试，或改用已有同口径 baseline 证据，不能把中断当结果。

短窗只证明“池化流式直读 + cursor research + cursor backtest + 现有展示/留档链”已真实打通；正式结论以冻结后的独立实验为准。
