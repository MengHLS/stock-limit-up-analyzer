# RESULT-COMPOSITE-RUNNER-HOLDOUT-001

> 目标：为 `NEW_HIGH_3 Runner / hold=20` 补齐正式 Research → Strategy Bridge 所需的**组合层 HOLDOUT 证据**，并完成 Candidate 创建。
> 固定坐标：`datasetVersionId=750001`、`first-limit-pullback-3f-top3@1.62.1`、`NEW_HIGH_3`、`decisionHoldingDays=5`、`extendToHoldingDays=20`、`maxPositions=5`、完整 simulator / 资金循环语义。
> **结论：BLOCKED。未创建 HOLDOUT Run，未创建 Candidate，未修改正式 Strategy。** 下面是阻塞原因与最小修复项。

---

## 0. 按要求给出的失败面结论

| 输出项 | 结果 |
| --- | --- |
| HOLDOUT Run ID | **未产生**（原因见 §2） |
| confirmatoryGate 结果 | **未计算**（无 Run） |
| dataset / protocol / strategy 坐标 | dataset `750001`（已冻结）；protocol **未生成**；strategy `first-limit-pullback-3f-top3@1.62.1`（不变） |
| Candidate ID | **未创建**（原因见 §3） |
| 与 PROMOTE-001 的 parity | 未评估（无 Run 可评估） |
| 是否达到「可由用户决定是否提升正式 Strategy」的 Gate | **未达到** |
| 未绕过项 | 未手写 Run 行、未直接 INSERT Candidate、未手写 PASS gate、未改正式 Strategy、未做参数搜索 |

我**没有**用「伪造一个 PASS 的 Run」或「直接 INSERT 候选」来把这条链走通——按任务 §5 明确禁止。

---

## 1. 关键前提：HORIZON/FORWARD/PROMOTE 的执行链在哪里

组合层 Runner 的完整执行语义由三段组成，**全部位于 `scripts/`**，不在 `server/**`：

| 段 | 实现位置 | 是否有 server 侧可复用出口 |
| --- | --- | --- |
| 1.62.1 选股（`buildEvents` / `buildSourceRun`，bucket_t5 + 3F Top3 排序） | `scripts/runDynamic3FEntryMechanism001.mts` | 无（`rg` 在 `server/**` 内查不到 `buildSourceRun` / `buildEvents`） |
| v5+v7 执行投影装配（`extendDataset` / `rebuildRun`） | `scripts/runRunnerHoldingNewHigh3*.mts` | 无 |
| 组合回测（`runTradeSimulation`，含资金循环 / maxPositions=5 / 止损 / MA_CROSS / strongHold / T+1 冻结） | `server/research/simulator/engine.ts` | 纯函数，可直接调用 |

`runTradeSimulation` 本身是纯函数、可复用；缺的是**喂给它的 `ResearchDataset` + `CandidateEvaluationRun`（sourceRun）**，而这两者的构造器只在脚本里。

---

## 2. Blocker A —— 独立实验框架没有「组合层执行面」

独立实验体系（`research-experiments/**` + `server/researchExperiments/**`）是当前唯一被 Bridge 认可的 HOLDOUT Run 来源。它对本任务是**结构性不匹配**的：

1. **实验拿不到组合执行所需的输入。** 实验只能通过 `ExperimentDatasetAccess` 取数：
   `facts / events() / eventPages() / feature(rd) / observation(rd)`
   （`shared/researchExperimentsContracts.ts:778`）。它能拿到事件行与逐相对日行情，但**没有** `ResearchDataset` / `universeDefinition` / `policySet` / sourceRun 的装配面。

2. **实验被明确禁止直连 DB 或 import `server/**` 运行时。**
   `docs/research/EXPERIMENT-CODE-SPEC.md:651`：不要自己连 DB、写表 —— 实验代码**拿不到 DB**（`run()` 里连 `server/**` 都 import 不到）。
   `:561` 亦列为禁止项：绕过 Dataset 契约直连数据库（`getDb()` / `ds_*` 直查）。

3. **不允许在实验里另写一套引擎。** 同规格 `:560`：不得在 `research-experiments/**` 里另写一套同名引擎。
   而要在实验内复现 `first-limit-pullback-3f-top3@1.62.1` + `runnerBridge` 的组合语义，必须重写选股 + 资金循环 + 全部退出规则——正是被禁止的「第二套引擎」，且与 PROMOTE-001 的逐笔结果存在分叉风险。

4. **现有唯一「组合形状」实验证明的是另一套东西。**
   `research-experiments/combo-backtest/leader-candidate-baseline/experiment.ts` 确实在实验内手写了一个组合回测（`let cash = INITIAL_CAPITAL` 起自建持仓与退出），但它是 **combo-v1 的另一套策略**，与 `first-limit-pullback-3f-top3@1.62.1` 的选股 / 退出 / 成本 / 槽位口径不同，**无法复现 PROMOTE-001 的 15.79% / 129.69%**，不能作为本任务的等价证据。

**净结论：不存在任何已注册实验类型能产出一个「语义等于 PROMOTE-001 组合回测」的 HOLDOUT Run。** 这是 Blocker A。缺的不是 Bridge 的契约，而是**实验侧的组合执行能力**。

---

## 3. Blocker B —— Bridge 产出的是 Strategy Version，不是 `research_strategy_candidate`

任务 §4 要求「使用现有 Bridge 创建 `research_strategy_candidate`」。实查：

| 事实 | 证据 |
| --- | --- |
| `createStrategyFromEvidenceRuns` 只调 `strategies.createStrategyVersion` + 写 `strategy_research_provenance` | `server/researchExperiments/strategyBridge.ts:514`、`:852`、`:877` |
| 返回体是 `{ strategyId, strategyVersion, strategyVersionId, provenanceId, sourceKind: "INDEPENDENT_EXPERIMENT" }` | `strategyBridge.ts:248` |
| `candidateRepository` **没有 create/insert**，只有 select / update / delete | `server/research/candidateRepository.ts` |
| `research_conclusion` / `research_experiment` 物理表已归档，旧 `Conclusion → Candidate` 不可用 | 真库 `SHOW TABLES LIKE 'research_%'` 只剩 `research_experiment_run` / `research_strategy_candidate` / `research_datasets` / `research_securit*` |

**净结论：独立实验桥的目标产物是「Strategy Version + `INDEPENDENT_EXPERIMENT` 溯源」，不是 legacy `research_strategy_candidate` 行。** 本任务要求的「Candidate ID」在当前架构下应读作**被创建 Strategy Version 的 id**；若要一条 `research_strategy_candidate` 行，需要的是**恢复/新增一条独立实验 → candidate 的写入路径**，而不是既有 Bridge 能提供的。

---

## 4. Blocker C —— 新增实验不是「只在 server 侧」的小改

即使 A 的缺口被补上，新增一个实验类型的注册面也跨端：

| 需要改 | 原因 | 证据 |
| --- | --- | --- |
| `research-experiments/manifest.ts`（1 import + 1 数组项） | 服务端唯一发现点 | `EXPERIMENT-CODE-SPEC.md:462` |
| `client/src/researchExperiments/pages.ts` + 新 `page.tsx` | **强制**：每个实验的 `pageKey` 必须能解析到组件 | `tests/server/researchExperiments/manifest.test.ts`（每个已注册实验的 pageKey 都能找到页面组件） |
| 新实验目录（`experiment.ts` / `result.ts` / `README.md`） | 契约 | `EXPERIMENT-CODE-SPEC.md:66` |

即：这不是「最小扩展 Bridge 契约」一个文件的改动。

---

## 5. 仍然成立的事实（已复核，可直接复用）

- 已冻结的研究坐标与结论（PROMOTE-001）：`750001` + `first-limit-pullback-3f-top3@1.62.1` + `runnerBridge{NEW_HIGH_3, 5, 20}`；canonical v5 基线 parity **PASS**（57.7330390741% / 1,359 笔）；v7 执行投影 A 15.79%/1619 → C 129.69%/1453，触发 159。
- **HOLDOUT 窗口本身是干净的**：`750001` 上不存在任何 HOLDOUT Run；2025-01-01..2026-09-04 未被任何**实验 Run** 观察过（HORIZON/FORWARD/PROMOTE 是脚本级运行，不是 `research_experiment_run` 行），因此污染守卫可满足。**这部分不是阻塞点。**
- 真库 HOLDOUT Run 现状（对照预期）：

| Run | experimentId | datasetVersionId | gate |
| --- | --- | ---: | --- |
| `RUN-20260925-76FA1DCC` | composite-factor-3f-amplitude-volume-oos-study | 660001 | INSUFFICIENT |
| `RUN-20260925-E4BA89C4` | composite-factor-12f-equal-weight-oos-study | 660001 | INSUFFICIENT |
| `RUN-20260925-509DEF49` | composite-factor-4f-equal-weight-oos-study | 660001 | INSUFFICIENT |
| `RUN-20260922-816ED25F` | oversold-gap-reversal-validation | 570001 | FAIL |
| `RUN-20260921-54D654BB` | decision-forward-study | 390002 | PASS（坐标非 750001） |

---

## 6. 最小修复项（按依赖顺序，供开工）

### 修复 1（必需，解锁 Blocker A）—— 把组合执行能力下沉为 server 侧可复用模块

新增 `server/research/compositeRunner/`（或等价命名），把脚本里三段逻辑抽成**纯函数 + 注入式读回**，供 `server/researchExperiments` 与脚本共用：

1. `buildFirstLimitPullback3FTop3SourceRun(dataset)` —— 迁移 `scripts/runDynamic3FEntryMechanism001.mts` 的 `buildEvents` / `buildSourceRun`（bucket_t5 + 3F Top3）。
2. `buildCompositeExecutionDataset(rows, name)` —— 迁移 `extendDataset` / `rebuildRun`。
3. `runCompositeRunnerBacktest({ dataset, sourceRun, runnerBridge })` —— 唯一入口，内部调**既有** `runTradeSimulation`（不新建引擎）。

同时给 `ExperimentDescriptor` 增加一个显式的组合执行声明（例如 `executionSurface: "COMPOSITE_PORTFOLIO"`），使实验可以合法调用第 3 项，而**不必**亲自 import `server/**` 或直连 DB。

### 修复 2（必需，解锁 Blocker C）—— 注册 `composite-runner/newhigh3-hold20`

- `research-experiments/first-board-pullback/composite-runner-newhigh3-hold20/{experiment,result,page}.tsx` + `README.md`；
- `research-experiments/manifest.ts` 加 1 import + 1 数组项；
- `client/src/researchExperiments/pages.ts` 加 1 行页面注册（否则 `manifest.test.ts` 红）。

候选实现可**直接复用** `scripts/runRunnerNewHigh3Promote001.mts` 的装配与度量（该脚本已是验证过的口径）。

### 修复 3（必需，解锁 Blocker B）—— 明确 Candidate 语义

二选一，需先裁定：

- **(3a) 接受 Strategy Version 即「Candidate」**：用 `experimentStrategy.createFromEvidenceRuns` 产出 Strategy Version + `INDEPENDENT_EXPERIMENT` 溯源，报告其 `strategyVersionId`。零新增代码，但 `research_strategy_candidate` 无行。
- **(3b) 恢复独立实验 → candidate 写入路径**：在 `server/research/strategyCandidate/` 增一条 `createFromIndependentExperiment(runId, sketch)`，产出 `research_strategy_candidate` 行且 `sourceKind=INDEPENDENT_EXPERIMENT`。这是新增写入面，需要 review（注意 `manifest.test.ts` 禁止在新体系源码里出现 `candidateId` 字段声明）。

### 修复 4（执行，仅在 1–3 之后）—— 正式跑 Run

1. OBSERVATION Run（如 2019-01-01..2024-12-31）→ 得 `parentRunId`；
2. HOLDOUT Run（2025-01-01..2026-09-04，`parentRunId` 指第 1 步，`confirmatoryGate` 由实验**真实计算**）；
3. 跑完须与 PROMOTE-001 的 v7 A/C（15.79% / 129.69%，触发 159）做 parity，误差超容差即视为失败并停止；
4. 通过后用 Bridge 落 Strategy Version（或 3b 的 candidate 行）。

### 估算

修复 1 + 2 是本任务的主要工作量（约 400–600 行新代码 + 1 个前端页 + 单测）；修复 3 是**语义裁定**，不是纯编码。**在未做修复 1 之前，任何「HOLDOUT Run」都只能是伪造或另写引擎的结果 —— 两者都被任务 §5 排除。**

---

## 7. 状态

- 正式 Strategy `first-limit-pullback-3f-top3@1.62.1`：**未修改**。
- 参数搜索：**未执行**；`hold=40/60/74`：**未测试**。
- `research_experiment_run`：**未新增行**。
- `research_strategy_candidate` / `strategy_versions`：**未新增行**。
- 结论：本任务在**未做 §6 修复 1–3**之前无法诚实完成；阻塞点是架构缺口，不是数据或坐标问题。
