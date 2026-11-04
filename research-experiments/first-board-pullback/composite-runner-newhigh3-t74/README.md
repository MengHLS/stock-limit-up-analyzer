# composite-runner-newhigh3-t74

**目的**：在**完整组合回测**（资金循环 / `maxPositions=5` / 原止损 / MA5-MA10 趋势退出 / strongHold / T+1 冻结）
语义下，验证 `first-limit-pullback-3f-top3@1.62.1` + `runnerBridge{NEW_HIGH_3, decisionHoldingDays=5, extendToHoldingDays=74}`。

## 固定坐标

| 项 | 值 |
| --- | --- |
| 执行 dataset | `datasetVersionId=780001`（v8） |
| 基线 dataset | `datasetVersionId=660001`（v5，平台 provider 装配） |
| Strategy | `first-limit-pullback-3f-top3@1.62.1` |
| Runner | `NEW_HIGH_3` / `decisionHoldingDays=5` / `extendToHoldingDays=74` |
| maxPositions | `5` |
| executionSurface | `COMPOSITE_PORTFOLIO` |

## 已知边界

- 数据由平台 provider（`server/researchExperiments/compositeDatasetProvider.ts`）装配：
  基线 3f-top3 投影（与 T80-001 / HORIZON-001 同一工件）+ 选中事件的 v8 `rd17..80`。
- 实验**不读 DB、不实现 simulator**，只编排 `@experiments/compositeRunnerBridge` 暴露的唯一实现。
- full-range 结果必须与 T80-001 冻结值一致（A 15.7877%/1619、C 151.0958%/1434、trigger 161）；
  不一致时 HOLDOUT `confirmatoryGate` = FAIL。
- 本实验**不做**参数搜索、不测其它持有上限。
 
## 当前状态（2026-10-04）

- 初次以历史坐标 `750001` 执行 OBSERVATION `RUN-20261004-696F023C` 时发现：该版本元数据为 READY，但当前库物理 `ds_*` 五表为空，provider 无法取到扩展行。
- 改用当前物理重建坐标 `780001`（v8，同 73003 事件 / 同日期范围）后，OBSERVATION `RUN-20261004-B067637E` gate=`OBSERVATION_READY`，A/C/trigger 与 T80-001 冻结值逐项一致。
- HOLDOUT `RUN-20261004-BF08CD36` gate=`PASS`：Holdout A=`47.2184520225%` / C=`105.8425817162%`，MaxDD A=`17.2639379831%` / C=`14.0585934014%`。
- 已通过 `createStrategyFromEvidenceRuns` 创建 StrategyVersion `3600004`（`first-limit-pullback-3f-top3-runner-t74@1.0.0`）与 provenance `690001`。
- 未修改 Strategy Version `3570001`。
