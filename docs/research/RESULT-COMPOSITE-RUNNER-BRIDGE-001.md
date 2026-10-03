# RESULT-COMPOSITE-RUNNER-BRIDGE-001

> 目标：补齐 `NEW_HIGH_3 Runner / hold=20` 所需的组合层 Research → Strategy 执行面，然后重新执行 HOLDOUT。
> **结论：§1–§2 已完成并验证（模块级 parity 精确通过）；§3–§5 仍未完成**，阻塞点是「实验侧数据集供给」。未创建 Run / Strategy Version / provenance，未修改正式 Strategy。

---

## 1. 新增模块 / 文件

| 文件 | 作用 | 状态 |
| --- | --- | --- |
| `server/research/compositeRunner/index.ts` | **唯一**组合执行实现：`buildCompositeEvents`（= 原 `buildEvents`）+ `buildCompositeSourceRun`（= 原 `buildSourceRun`）+ `buildFirstLimitPullback3FTop3SourceRun`（1.62.1 bucket-score T+5 臂）+ `buildCompositeExecutionDataset`（= 原 `extendDataset`）+ `rebuildCompositeRun`（= 原 `rebuildRun`）+ `runCompositeRunnerBacktest`（**唯一**入口 = 既有 `runTradeSimulation`）。纯函数 / 注入式数据访问，不读文件、不连 DB、不依赖 cwd | 新增，已验证 |
| `research-experiments/compositeRunnerBridge.ts` | 实验侧**唯一入口**（零实现 re-export，与既有 `@experiments/robustnessBridge` 同纪律） | 新增 |
| `shared/researchExperimentsContracts.ts` | `ExperimentDescriptor` 增加 `executionSurface: "SINGLE_EVENT" \| "COMPOSITE_PORTFOLIO"`（可选，缺省 = 既有行为逐字节不变） | 修改 |
| `scripts/runDynamic3FEntryMechanism001.mts` | 删除本地 `buildEvents` / `buildSourceRun` / 其私有 helper，改为委托共享模块（薄委托 + 结构适配，无数值处理） | 修改 |
| `scripts/_moduleParity.mts` | parity 验证 harness（只读） | 新增 |
| `scripts/_scriptSmoke.mts` | 选股委托 smoke（只读） | 新增 |

未新增第二套回测引擎；`runTradeSimulation` 仍是唯一执行内核。

## 2. 测试结果

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | **exit 0** |
| `vitest run tests/server/researchExperiments/manifest.test.ts contract.test.ts` | **32 passed / 2 files** |
| **模块级 parity vs PROMOTE-001**（`scripts/_moduleParity.mts`） | **PASS（精确）**：A = **15.7877% / 1619**（期望 15.7877 / 1619）；C = **129.6860% / 1453**（期望 129.6860 / 1453） |
| 选股委托 smoke（`scripts/_scriptSmoke.mts`） | selected = **5569**、tradingDays = 1875、accounting 与重构前逐字段一致 |

即：`server/research/compositeRunner` 在**完整 simulator / 资金循环语义**下逐字段复现了 PROMOTE-001，且脚本与（未来的）Experiment 走同一实现。

## 3. §3–§5 执行状态（未完成）

| 输出项 | 结果 |
| --- | --- |
| OBSERVATION Run ID | **未产生** |
| HOLDOUT Run ID | **未产生** |
| confirmatoryGate | **未计算**（无 Run） |
| parity（端到端，通过 Run） | 未评估（模块级 parity 已 PASS） |
| Strategy Version ID | **未创建** |
| provenance ID | **未创建** |
| 是否达到「可由用户决定是否提升正式 Strategy」的 Gate | **未达到** |

未创建 `composite-runner-newhigh3-hold20` 实验；未注册 manifest / client page；未跑任何持久化 Run；未调用 `createStrategyFromEvidenceRuns`。

## 4. 实际阻塞原因（唯一）

**实验侧无法获得与 PROMOTE-001 逐字段一致的执行数据集。**

模块级 parity 用的是「v5 官方行 + 选中事件 v7 rd17..80」这一**双数据集投影**（`buildCompositeExecutionDataset`）。而 Experiment 的取数面只有：

```
facts / events() / eventPages() / feature(prefixRd) / observation(postRd)
```

一次 Run 绑定**一个** dataset 版本（+ 可选 auxiliary），且只暴露「事件行 + 逐相对日行情」。因此实验**拿不到**：

1. v5（660001）的**完整 rows**（含 rd ≤ 16 与 prefix 行）——这是 `buildCompositeEvents` 的输入与 `runTradeSimulation` 的行情/MA 历史来源；
2. v5 的 `universeDefinition.days`（**交易日历 + 逐日成员**）与 `policySet`——`buildCompositeEvents` 的 `tradingDays` 直接取自它，而 `runTradeSimulation` 的 `tradingDates` 也由它派生；
3. v7 的 rd17..80 **仅对选中事件**的子集。

若改用「v7 单数据集」重建，日历、成员集合与 MA 历史都会与 v5 投影不同 ⇒ **无法保证 15.7877%/1619 与 129.6860%/1453 的逐字段 parity**；而按任务 §6，parity 不通过不得继续。因此我**没有**用近似数据集去跑一个「看起来 PASS」的 Run。

（已复核的非阻塞点：`750001` 上无任何 HOLDOUT Run，2025-01-01..2026-09-04 未被任何实验 Run 观察，污染守卫可满足。）

## 5. 最小修复项（唯一剩余工作）

**修复：为 `executionSurface: "COMPOSITE_PORTFOLIO"` 的实验注入平台侧数据集。**

在 `server/researchExperiments/`（server 侧，允许访问 Registry）新增一个 `compositeDatasetProvider` 端口，并在 `ExperimentRunner` 装配时注入：

1. 依据 Run 的 `datasetVersionId`（= `750001`）与其 protocol `evaluationWindow`，server 侧读取**基线数据集**（`660001`）官方行 + 选中事件的 v7 rd17..80，调用 `buildCompositeExecutionDataset` 得到与 PROMOTE-001 同形的 `ResearchDataset`；
2. 通过新的 `context.composite`（或 `context.dataset.compositeSurface`）把它交给实验，实验只调用 `compositeRunnerBridge` 的 `buildFirstLimitPullback3FTop3SourceRun` + `runCompositeRunnerBacktest`；
3. 实验 `run()` 计算 `confirmatoryGate`（真实计算，非手写），并在 full-range 复算 A/C 与 PROMOTE-001 做 parity；不通过即返回 FAIL。

之后按原计划：注册 `composite-runner-newhigh3-hold20`（experiment/result/README + manifest + client page + 测试）→ OBSERVATION Run → HOLDOUT Run → `createStrategyFromEvidenceRuns`（Candidate ID = `strategyVersionId`）。

**预估**：修复约 150–250 行 server 侧代码 + 1 个实验（约 250 行）+ 1 个前端页；不需要新增第二套引擎。

## 6. 状态

- 正式 Strategy `first-limit-pullback-3f-top3@1.62.1`：**未修改**；已有 Strategy Version：**未修改**。
- 参数搜索：**未执行**；`hold=40/60/74`：**未测试**。
- `research_experiment_run` / `strategy_versions` / `strategy_research_provenance`：**未新增行**。
- 未手写 Run、未手写 PASS、未直接 INSERT、未复制 simulator。
