# RESULT-RUNNER-HOLDING-BRIDGE-001-CONSISTENCY

> 目标：统一 `RESULT-3F-TOPN-3-V1_62_1-T80-001` 与 `RESULT-RUNNER-HOLDING-BRIDGE-001` 的 Baseline 口径，避免后续 Runner Holding Strategy 使用错误对照。本轮不新增研究实验、不优化参数、不组合状态、不创建 Candidate。

## 1. 结论先行

- **正式策略性能基线**：`first-limit-pullback-3f-top3@1.62.1`，**1,359 笔 / +57.73%**。这是 v5 官方 T+20 执行口径；T+80 只用于事后路径标签，不参与原策略成交撮合。
- **Bridge 研究执行基线**：`study-runner-holding-bridge-001@1.0.0`，**1,619 笔 / +15.79%**。它使用 v5 官方行 + v7 `rd17..80` 的执行投影，使原策略中因只有 rd0..16 而无法继续撮合的延迟卖单获得后续行情。
- 两者不是同一执行数据集，`1,619 / 15.79%` **不是**正式 1.62.1 的替代性能基线，而是 T+80 持有研究的对照基线。
- 本轮没有发现选股、3F Top3、止损或退出逻辑实现错误；差异来自执行投影和资金循环路径不同。

## 2. 差异对照

| 维度 | 正式 1.62.1 T80 留档 | Bridge 研究基线 | 是否同一口径 |
| --- | --- | --- | --- |
| sourceRun 选股 | 5,569 个 Top3 信号槽 | 5,569 个 Top3 信号槽，同一选择代码 | 信号层同 |
| strategyVersion | 1.62.1 canonical | sourceStrategy 1.62.1；研究身份 1.0.0 | 退出语义同 |
| datasetVersion | `rd-1.0.0-1-bd57f47cfcecf245` | `rd-1.0.0-1-3e494f190d453fd5` | 否 |
| 执行投影 | v5 `rd0..16` | v5 官方行 + 选中事件 v7 `rd17..80` | 否 |
| T80 标签 | v7 `rd21..80` 仅用于路径标签 | v7 `rd17..80` 既用于路径，也允许成交 | 否 |
| 交易纳入 | 1,359 笔 | 1,619 笔 | 否 |
| 期末未平仓 | 官方 v5 运行有 5 笔期末持仓 | 扩展执行行可让部分延迟卖单在 rd16 后继续撮合 | 否 |
| 退出逻辑 | 原 1.62.1 止损/趋势/strongHold/时间退出 | Baseline 不启用 Bridge，退出逻辑相同 | 是 |
| 研究含义 | 正式性能基线 | T80 可执行研究基线 | 不可混用 |

## 3. `1,619` 为什么会增加

T+80 执行投影把选中事件在 `rd17..80` 的真实行情加入了执行面板。原策略中部分本应延迟、但前 16 个相对日无法继续撮合的卖单因此能够继续成交；资金被释放后可继续参与后续信号，交易生命周期和资金循环路径随之改变，所以由 1,359 笔变为 1,619 笔。

这不是把 T+20 标签硬扩成 T+80，也不是新增过滤或参数，而是“T80 可执行投影”与原“T+20 执行投影”的数据边界差异。

## 4. `T14 / T74` 的真实语义

- `T14` 是 `extendToHoldingDays=14`，不是 T+14。
- 正常 T+6 开盘入场时，`T14` 表示 T+19 收盘产生时间退出信号、T+20 开盘成交。
- `T74` 表示 T+79 收盘产生时间退出信号、T+80 开盘成交。
- Bridge 决策点仍是第 5 个持有日，即正常 T+10 收盘。

## 5. 是否需要重跑 Bridge

**不需要重跑 Bridge 矩阵本身。** 现有 12×2 矩阵已经使用 1,619 / 15.79% 作为 T80 研究执行基线，内部对比一致。需要修正的是命名和引用：

1. 报告正式 1.62.1 性能时使用 1,359 / 57.73%。
2. 报告 Bridge 增量时必须相对 1,619 / 15.79%。
3. 不得把 Bridge 的 +151.10% 等结果直接表述为相对正式 1.62.1 的 1,359 基线的增量。

## 6. 版本留档

- 正式性能基线：`first-limit-pullback-3f-top3@1.62.1`
- Bridge 研究基线：`study-runner-holding-bridge-001@1.0.0`
- 建议下一阶段版本：`study-runner-holding-bridge-newhigh3-t74@1.0.0`
- 上述版本身份、datasetVersion、sourceRun fingerprint、policy 清单和 Baseline 角色已留档到：
  `docs/evidence/_analysis_runner_holding_bridge_001_consistency.json`

## 7. 下一步

可以进入 `NEW_HIGH_3_T74` 的正式 Runner Holding Strategy 验证，但必须：

- 以 1,619 / 15.79% 作为执行层基线；
- 同时把 1,359 / 57.73% 明确标为正式 1.62.1 性能基线，不参与 Bridge 增量计算；
- 新建并留档 `study-runner-holding-bridge-newhigh3-t74@1.0.0`；
- 不创建 Candidate，直到正式 Runner Holding Strategy 验证完成。