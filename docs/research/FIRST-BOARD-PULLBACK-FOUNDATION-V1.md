# 首板回撤公共研究底座 V1

> 适用范围：`research-experiments/first-board-pullback/**`
>
> 冻结协议：[`FIRST-BOARD-PULLBACK-EXIT-PROTOCOL-V1.md`](FIRST-BOARD-PULLBACK-EXIT-PROTOCOL-V1.md)

## 1. 目标

把所有首板回撤核心实验统一到同一套数据与收益口径：

- Dataset `first_limit_pullback` 的 `v5`；
- 严格涨停和统一可交易字段；
- `fullSample` 与 `commonSample` 分离；
- `entryDay × exitDay` 长表面板；
- 按实际入场日起算的 `holdingDay=1..20` 曲线；
- 理想收盘退出与实际可执行退出分离；
- 成本拆分、日期聚类 Bootstrap、MFE/MAE 和首达阈值时间；
- 每个结果绑定 Dataset version、Experiment version 和 code digest。

本底座不新增因子、不调阈值、不选择最佳退出日，也不把 v5 称为 OOS。

## 2. 代码位置

共享模块位于：

```text
research-experiments/shared/firstBoardPullback/
├── types.ts
├── cost.ts
├── dataset.ts
├── panel.ts
├── curves.ts
├── artifacts.ts
├── foundation.ts
├── wrapExperiment.ts
└── index.ts
```

`research-experiments/manifest.ts` 在注册所有首板回撤实验时统一调用
`withFirstBoardPullbackFoundation()`。

因此生产环境中的核心实验：

- 描述符要求 `requiredDatasetVersionLabel = "v5"`；
- 自动补充读取 20 个 post 相对日和公共执行字段；
- 保留实验原有结果；
- 额外输出公共底座表、Bootstrap、lineage 和面板 artifact。

## 3. Dataset v5 绑定

核心实验只接受：

```text
datasetCode = first_limit_pullback
datasetVersionLabel = v5
```

若选择 v3 / v4 或 smoke 版本，Runner 在读取数据前失败，不产生结果。

结果中的 `foundation_v5_lineage` 同时记录：

- `dataset_version_id`
- `dataset_version_label`
- `experiment_id`
- `experiment_version`
- `code_digest`
- `research_phase`
- `protocol_fingerprint`

v5 是已读数据复核。它不是 OOS，不能作为未来未读数据的替代。

## 4. 事件池

公共底座按以下步骤建立事件池：

1. `isFirstLimit = true`；
2. `boardType = main`；
3. `market ∈ {SH, SZ}`；
4. 首板日 OHLC 合法；
5. `close` 与 `limitUpPrice` 的绝对误差不超过 `1e-9`；
6. 一字板标记为 `open = high = low = close = limitUpPrice`；
7. 一字板不静默合并进主解释，公共面板保留其事实标记。

ST 排除由 Dataset v5 构建阶段完成；底座不根据股票名称二次猜测。

## 5. `commonSample`

对每个 `entryMode`，一个事件进入 `commonSample` 必须满足：

- `T+1..T+20` bar 存在；
- 每个 bar 未停牌且 OHLC 结构合法；
- `canBuyAtOpen` / `canSellAtClose` 字段完整；
- 实际入场日 `canBuyAtOpen = true`；
- 最远目标持有日可以在 `T+20` 之前找到实际可卖退出。

同一 `entryMode` 下，所有 `holdingDay` 的 `COMMON` 曲线使用同一个事件集合。

`FULL` 和 `COMMON` 曲线分开输出；不得用不同事件集合直接比较不同持有日。

## 6. 收益面板

面板按 `entryMode × year` 分片写入 gzip CSV artifact：

```text
foundation/panel-<entryMode>-<year>.csv.gz
```

长表字段：

```text
event_id,event_date,year,symbol,
entry_mode,entry_day,exit_day,holding_day,
gross_return,net_return,
ideal_gross_return,ideal_net_return,
can_buy,can_sell,exit_reason,execution_delay_days,
right_censored,common_sample_flag,
missing_bar,suspended,
mfe,mae,peak_holding_day,trough_holding_day,
first_plus_2_holding_day,first_minus_2_holding_day,
first_plus_5_holding_day,first_minus_5_holding_day,
path_class_v1
```

入场方式：

- `FIXED_T1_OPEN`
- `FIXED_T2_OPEN`
- `FIXED_T3_OPEN`
- `FIXED_T4_OPEN`
- `FIXED_T5_OPEN`
- `FIXED_T6_OPEN`
- `DYNAMIC_PULLBACK_V1`

固定事件日退出只保留为兼容坐标；跨入场日比较使用 `holding_day`。

## 7. 理想与实际退出

理想退出：

- 直接使用目标 `exitDay` 的收盘价，只用于显示不可成交条件下的理论收益。

实际可执行退出：

1. 目标日 `canSellAtClose = true`，使用目标收盘价；
2. 否则向后寻找第一个可卖开盘；
3. 若开盘不可卖但当日收盘可卖，使用该收盘；
4. 直到 `T+20` 仍不可卖，则该行 `right_censored = true`，收益为空。

禁止把理想收盘价直接当成真实成交收益。

## 8. 成本

默认成本拆分：

| 项目 | bps |
|---|---:|
| 单边佣金 | 2.5 |
| 单边滑点 | 2.5 |
| 单边冲击成本 | 2.5 |
| 卖出印花税 | 5 |

买入价与卖出价分别调整，默认总往返成本与协议 `20bps` 一致。

## 9. 曲线与统计

公共曲线输出：

- 均值；
- 去最高 5% 后均值；
- 中位数；
- 胜率；
- P5/P25/P75/P95；
- 理想净收益；
- 执行损失；
- MFE、MAE、峰值日、谷值日；
- 首次到达 `+2%/-2%/+5%/-5%` 的持有日；
- 日期聚类 Moving Block Bootstrap；
- 样本数与事件交易日数。

Bootstrap 只在固定锚点持有日输出，避免把曲线网格误读为参数搜索。

## 10. 不得做的事

- 不得把 v3 / v4 / v5 称为 OOS。
- 不得从 `T+1..T+20` 选择收益最高的退出日。
- 不得把理想收盘退出当作可成交退出。
- 不得在未声明 `fullSample` / `commonSample` 的情况下横向比较视界。
- 不得把 v5 的样本内结果作为策略通过条件。

## 11. 验收

公共底座单测覆盖：

- 非 v5 版本拒绝；
- `holdingDay` 按实际入场日对齐；
- 目标日不可卖时进入下一可卖开盘；
- `commonSample` 在各持有日保持一致；
- 成本拆分扣除；
- `T+20` 缺失时 fullSample 存在但 commonSample 剔除。

正式路径仍需在 v5 READY 后重跑核心实验，并保存 Run 坐标和 artifact manifest。

## 12. v5 复核结果

全历史 v5：

- `datasetVersionId = 660001`
- `version = v5`
- `status = READY`
- `totalEvents = 73003`
- `totalRows = 4809433`

公共底座上线后，21 个核心实验均已至少完成一条
`datasetVersionId = 660001` 的 `COMPLETED` Run。

逐 Run 自动核对通过：

- 每条结果都含 `foundation_v5_lineage`；
- 每条结果都含 `foundation_sample_accounting`；
- 每条结果都含 `foundation_entry_aligned_curve`；
- 每条结果都落有分片 `foundation/panel-*.csv.gz` artifact；
- Run 元数据与 lineage 均绑定 v5、experiment version 和 code digest。

v5 仍然是已读数据复核，不构成 OOS。
