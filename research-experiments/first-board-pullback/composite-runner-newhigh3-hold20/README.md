# composite-runner-newhigh3-hold20

**目的**：在**完整组合回测**（资金循环 / `maxPositions=5` / 原止损 / MA5-MA10 趋势退出 / strongHold / T+1 冻结）
语义下，验证 `first-limit-pullback-3f-top3@1.62.1` + `runnerBridge{NEW_HIGH_3, decisionHoldingDays=5, extendToHoldingDays=20}`。

## 固定坐标

| 项 | 值 |
| --- | --- |
| 执行 dataset | `datasetVersionId=750001`（v7） |
| 基线 dataset | `datasetVersionId=660001`（v5，平台 provider 装配） |
| Strategy | `first-limit-pullback-3f-top3@1.62.1` |
| Runner | `NEW_HIGH_3` / `decisionHoldingDays=5` / `extendToHoldingDays=20` |
| maxPositions | `5` |
| executionSurface | `COMPOSITE_PORTFOLIO` |

## 已知边界

- 数据由平台 provider（`server/researchExperiments/compositeDatasetProvider.ts`）装配：
  基线 3f-top3 投影（与 PROMOTE-001 / HORIZON-001 同一工件）+ 选中事件的 v7 `rd17..80`。
- 实验**不读 DB、不实现 simulator**，只编排 `@experiments/compositeRunnerBridge` 暴露的唯一实现。
- full-range 结果必须与 PROMOTE-001 parity 一致（A 15.7877%/1619、C 129.6860%/1453、trigger 159）；
  不一致时 HOLDOUT `confirmatoryGate` = FAIL。
- 本实验**不做**参数搜索、不测 hold=40/60/74。
