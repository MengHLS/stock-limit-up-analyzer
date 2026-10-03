# RESULT-STRATEGY-BRIDGE-RUNNER-FINAL-001

> 目标：修复 Research → Strategy Bridge，使已通过 HOLDOUT 的 `NEW_HIGH_3 hold=20` 被正确转换为**完整** Strategy Version。
> **结论：完成。** Strategy Version `3570001` + provenance `660001` 已创建，Definition 语义完整等于
> `first-limit-pullback-3f-top3@1.62.1 + runnerBridge{NEW_HIGH_3, 5, 20}`。
> 未重跑 Run、未改 1.62.1、未改 simulator / Dataset Provider / 实验契约、未手写 Strategy Version。

---

## 1. 修改文件

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `server/research/strategyCandidate/definitionBuild.ts` | 新增 `exitRule.policy` 分支：用既有 `exitPolicyDefinitionErrors()` 校验后，产出 `{ id: "exit-unified-policy", type: "STOP_LOSS", trigger: "ON_CLOSE", policy, priority: 0, enabled: true }`；声明 policy 后不再重复展开 `stopLoss`/`takeProfit`/`holdingDays`（三者既有语义保持兼容） | 修复前 `definitionBuild` 零引用 `exitPolicy`/`runnerBridge`，草稿的退出政策会被丢，产出的 Strategy Version 不含 Runner |
| `server/runWorkbenchAssembly/exitPolicy.ts` | 统一 policy → `SimulationConfig.exitPolicy` 的映射中**原样透传** `runnerBridge`（仅当草稿显式声明该键时才写出，缺省时返回对象形状与既有行为逐字段一致） | 修复前运行期映射会静默丢掉 `rule.policy.runnerBridge`，即使定义里有也跑不到 |

均**复用**既有 `ExitPolicyDefinition` / `exitPolicyCommon.ts` 的校验与类型，**未新增第二套 Runner schema**。

## 2. 测试结果

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | **exit 0** |
| `tests/server/research/strategyCandidate` + `tests/server/runWorkbenchAssembly` + `tests/server/researchExperiments` | **629 passed / 3 failed** |
| 上述 3 个失败 | **既有失败，与本次改动无关**：全部在 `threeFactorTopNStrategyDocument.test.ts`，差异是 `+ "recoveryPath": null`（工作区此前未提交的 recoveryPath 改动；`git show HEAD:server/runWorkbenchAssembly/exitPolicy.ts` 中 `recoveryPath` 出现 **0** 次） |
| 定向（本次两处改动） | `definitionBuild.test.ts` 41 passed、`runWorkbenchAssembly/exitPolicy.test.ts` 与 `exitPolicyDefinition.test.ts` 全绿 |

## 3. Strategy Draft 构造（非空壳）

- `projectCandidateSketch(FIRST_LIMIT_PULLBACK_3F_TOPN3)` 取正式策略原有 `entryRule` / `parameterSpace` / `riskRule` / 3F Top3 语义；
- `buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", …)` 取 canonical `exitPolicy`（SL-18.1）；
- 仅补入 `runnerBridge = { kind: "PIT_RUNNER_HOLDING_BRIDGE", state: "NEW_HIGH_3", decisionHoldingDays: 5, extendToHoldingDays: 20 }`。

Sketch recipe 实测：`recipeId = "first-limit-pullback-3f-top3"`、`event = FIRST_LIMIT_UP`、`timing = NEXT_OPEN`、`observationWindow = [5,15] TRADING_DAY`。

## 4. 创建前强校验（全部 PASS 才落库）

| 检查 | 结果 |
| --- | --- |
| recipe = `first-limit-pullback-3f-top3` | PASS |
| `entry.event.type = FIRST_LIMIT_UP` | PASS |
| `entry.observationWindow = [5,15] TRADING_DAY` | PASS |
| T+6 开盘（`signalTiming=T_CLOSE` / `executionTiming=T_PLUS_1_OPEN` / `priceType=OPEN`） | PASS |
| `position.maxPositions = 5` | PASS |
| `runnerBridge.state = NEW_HIGH_3` | PASS |
| `runnerBridge.decisionHoldingDays = 5` | PASS |
| `runnerBridge.extendToHoldingDays = 20` | PASS |
| stopLoss（6% 固定 + 3%/8% 峰值回撤升级） | PASS |
| MA5-MA10 趋势退出（`MA_CROSS` 5×10，activationRatio 0） | PASS |
| strongHold（5→10，3%，需在 MA5/MA10 之上） | PASS |
| timeExit `holdingDays = 5` | PASS |

任一项缺失即 `process.exit(1)` 不落库；本次全部通过后才调用 Bridge。

## 5. Strategy Bridge

只使用已完成的 HOLDOUT：

- 证据 Run：**`RUN-20261002-BD1D7332`**（HOLDOUT / `COMPLETED` / gate `PASS` / `protocol-sha256:481f98d5…` / datasetVersionId 750001 / 窗口 `2025-01-01~2026-09-04`）
- 证据引用三条：`STABILITY_VERDICT → customPayload.parity.pass`、`RESULT_SUMMARY → customPayload.metrics.holdoutCReturnPct`、`SAMPLE_ACCOUNTING → sampleSummary.eligibleCount`
- 未重新运行 OBSERVATION / HOLDOUT。

| 输出 | 值 |
| --- | --- |
| **Strategy Version ID** | **`3570001`** |
| strategyId / version | `first-limit-pullback-3f-top3-runner-hold20` / `1.0.0` |
| definition fingerprint | `58e16bbd827349e802a2789a469fa9c195d4a23e2b2cbae3f643231a5b1b2199` |
| datasetVersion | `v7`（`datasetVersionId=750001`） |
| **provenance ID** | **`660001`** |
| `sourceKind` | **`INDEPENDENT_EXPERIMENT`** |
| experimentRef | `first-board-pullback/composite-runner-newhigh3-hold20` |
| experimentResultDigest | `exp-sha256:2485133be32e7b15` |
| 证据快照 | 含 `RUN-20261002-BD1D7332`、协议指纹 `481f98d5…`、`PASS` |

选择**新的 strategyId**（而非挂在 `first-limit-pullback-3f-top3` 下）是刻意的：Bridge 的首版本恒为 `1.0.0`，而 `first-limit-pullback-3f-top3` 下已存在 `1.62.1` 等既有版本；新建 `1.0.0` 会造成「同一 strategyId 下出现更低版本」的歧义。源策略身份由 Definition 的 `recipe.recipeId = first-limit-pullback-3f-top3` 与 provenance 完整保留，且**未触碰任何既有版本**。

## 6. 创建后只读复核（§5）

读取 `strategy_versions.id = 3570001` 的 `strategyDocumentJson`：

| 字段 | 实测值 |
| --- | --- |
| `entry.event.type` | `FIRST_LIMIT_UP` |
| `entry.observationWindow` | `{ start: 5, end: 15, unit: "TRADING_DAY" }` |
| `execution.signalTiming / executionTiming / priceType` | `T_CLOSE` / `T_PLUS_1_OPEN` / `OPEN`（= T+6 开盘） |
| `position.maxPositions / positionRatio` | `5` / `0.2` |
| `exit.rules[0].policy.stop` | `FIXED_PERCENT 0.06` + `INTRADAY` + `PEAK_DRAWDOWN 0.03/0.08` |
| `exit.rules[0].policy.takeProfit` | `MA_CROSS fast=5 slow=10 activationRatio=0` |
| `exit.rules[0].policy.timeExit` | `FIXED_HOLDING_DAYS holdingDays=5` |
| `exit.rules[0].policy.strongHold` | `atHoldingDays=5 minReturn=0.03 extendToHoldingDays=10 afterExtendedHold=TIME_EXIT` + 需在 MA5/MA10 之上 |
| **`exit.rules[0].policy.runnerBridge`** | **`{ kind: "PIT_RUNNER_HOLDING_BRIDGE", state: "NEW_HIGH_3", decisionHoldingDays: 5, extendToHoldingDays: 20 }`** |

provenance 行（id `660001`）：`sourceKind=INDEPENDENT_EXPERIMENT`、`sourceDatasetVersionId=750001`、三个 legacy 锚全为 `null`（未伪造）、证据快照含 HOLDOUT Run 与协议指纹。

## 7. 最终判定

| Gate 项 | 判定 |
| --- | --- |
| 3F Top3 选股语义存在 | **PASS** |
| Runner `NEW_HIGH_3 / 5 / 20` 存在 | **PASS** |
| stopLoss / MA5-MA10 趋势 / strongHold / T+6 开盘 / 仓位 未丢失 | **PASS** |
| HOLDOUT Run 引用正确（`RUN-20261002-BD1D7332`） | **PASS** |
| Strategy Version + provenance 落库 | **PASS**（`3570001` / `660001`） |
| 未修改既有 Strategy Version / 1.62.1 | **PASS** |

**是否达到「正式 Strategy 提升前最终 Gate」：达到。** 证据侧（HOLDOUT PASS + parity 精确 + 隔离 CLEAN）与产物侧（完整 Definition + `INDEPENDENT_EXPERIMENT` 溯源）均已就绪，是否提升正式 Strategy 由人决定。
