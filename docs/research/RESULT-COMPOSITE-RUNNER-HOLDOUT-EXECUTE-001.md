# RESULT-COMPOSITE-RUNNER-HOLDOUT-EXECUTE-001

> 目标：完成剩余闭环 —— OBSERVATION → HOLDOUT → parity → Strategy Version。
> **结果：OBSERVATION ✅ / HOLDOUT ✅（gate PASS、隔离 CLEAN、parity 精确）/ Strategy Bridge ❌ 阻塞。**
> 未修改正式 Strategy、未做参数搜索、未手写 Run / PASS、未直接 INSERT、未伪造任何结果。

---

## 1. OBSERVATION Run

| 项 | 值 |
| --- | --- |
| Run ID | **`RUN-20261002-258E7B8B`** |
| experiment | `first-board-pullback/composite-runner-newhigh3-hold20` |
| datasetVersionId | `750001` |
| researchPhase | `OBSERVATION` |
| evaluationWindow | `2019-01-01 ~ 2024-12-31` |
| status | `COMPLETED` |
| confirmatoryGate | `OBSERVATION_READY`（full-range parity 通过） |

## 2. HOLDOUT Run

| 项 | 值 |
| --- | --- |
| Run ID | **`RUN-20261002-BD1D7332`** |
| parentRunId | `RUN-20261002-258E7B8B` |
| datasetVersionId | `750001` |
| researchPhase | `HOLDOUT` |
| evaluationWindow | `2025-01-01 ~ 2026-09-04` |
| status | `COMPLETED` |
| protocolFingerprint | `protocol-sha256:481f98d5fc71be7de6237ad5844a95af162956def716b79e184de90aacee444b` |
| dataIsolation | **`CLEAN`**（无同实验 / 同 Dataset 的历史 Run 覆盖该 Holdout 窗口） |
| artifacts | 3（含 result.json / manifest.json / logs） |

## 3. confirmatoryGate（实验真实计算，非手写）

**`status = PASS`**

| check | 实测 | 阈值 | 判定 |
| --- | ---: | ---: | --- |
| `promote_parity_a` | 15.787690712129931% | 15.7876907121% | PASS |
| `promote_parity_c` | 129.68604118474002% | 129.6860411847% | PASS |
| `runner_trigger` | 159 | 159 | PASS |
| `holdout_return`（C vs A） | 99.03653223581995% | 47.218452022540006% | PASS |

## 4. HOLDOUT 实际结果

| 口径 | A（无 Runner） | C（NEW_HIGH_3 hold=20） |
| --- | ---: | ---: |
| Full 总收益 | 15.7877% / 1,619 笔 | **129.6860% / 1,453 笔** |
| Full MaxDD | 54.8080% | 45.0611% |
| Holdout 总收益（2025-01-01~2026-09-04） | 47.2185% | **99.0365%** |
| Holdout MaxDD | 17.2639% | **16.3391%** |
| Runner 触发 | — | **159** |

Full-range 与 `PROMOTE-001` 逐字段一致（A 15.7877%/1619、C 129.6860%/1453、trigger 159）；Holdout 段 C 收益显著高于 A 且回撤更低。

## 5. 与 PROMOTE-001 的 parity

**PASS（精确，非容差放宽）** —— 见 §3 前三项 check：A / C / trigger 三项实测值与阈值在 `1e-6` 内相等。

## 6. Strategy Bridge —— 阻塞

| 项 | 结果 |
| --- | --- |
| Strategy Version ID | **未创建** |
| provenance ID | **未创建** |
| `sourceKind=INDEPENDENT_EXPERIMENT` | 未产生 |

**阻塞原因（唯一）**：现有 Bridge 的草稿 → 定义转换器 `server/research/strategyCandidate/definitionBuild.ts` **无法表达 Runner**。

- 该文件把 `candidate.exitRule` 只映射为 `stopLoss` / `takeProfit` / `holdingDays` 三条通用 `ExitRuleDefinition`（`definitionBuild.ts:718-766`），并且 `assertUnusedExtra(exitRule.extra)` **非空即失败**（`:248`、`:722`）；
- 全文件 **零引用** `exitPolicy` / `runnerBridge`；而 `ExitRuleDefinition` 明明留了 `policy?: ExitPolicyDefinition`（`strategySchema/definition.ts:607`）—— 正是 `runnerBridge` 该落的位置，只是没有生产者；
- 因此 `createStrategyFromEvidenceRuns` 产出的 Strategy Version **不会携带 `first-limit-pullback-3f-top3@1.62.1` 的 3F Top3 选股语义，也不会携带 `runnerBridge{NEW_HIGH_3, 5, 20}`**。

在这种情况下创建 Strategy Version 会得到一个**看起来像转正产物、实际不含已验证 Runner** 的空壳 —— 按任务「不伪造后续结果」，我**没有创建**它。

### 最小修复项（不改组合执行模块 / Provider / Experiment 契约）

1. `server/research/strategyCandidate/definitionBuild.ts`：允许草稿声明退出政策，并把它映射进 `ExitRuleDefinition.policy`（例：接受 `exitRule.policy` 作为 `ExitPolicyDefinition` 透传；`runnerBridge` 已在 `exitPolicyCommon.ts` 有 schema 与校验）。
2. 构造 draft 时用既有 `projectCandidateSketch(FIRST_LIMIT_PULLBACK_3F_TOPN3)`（`server/research/patternLibrary/project.ts:262`）取 3F Top3 的 `entryRule`/`parameterSpace`/`riskRule`，再用上面的 `policy` 覆盖退出段 —— 这样产出的 Strategy Version 才真正等于已验证的策略。
3. 之后调用 `experimentStrategy.createFromEvidenceRuns`（证据 = §2 的 HOLDOUT Run，`strategyVersionId` 即候选产物）。

**预估**：`definitionBuild.ts` 约 10–20 行 + draft 组装约 30 行；不需要改动组合执行模块 / Provider / Experiment 契约 / 正式 Strategy。

## 7. 本轮附带的最小修正（为让 Run 能真实执行，非架构改动）

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `research-experiments/shared/firstBoardPullback/wrapExperiment.ts` | ① 显式声明 `requiredDatasetVersionLabel` 时不再被底座强制覆盖为 `v5`；② `executionSurface=COMPOSITE_PORTFOLIO` 的实验不注入事件级首板回撤底座 | 否则平台数据集标签被强制为 `v5`、且 `foundation.ts` 运行时硬断言 `v5`，与固定坐标 `750001/v7` 冲突，Run 直接 FAILED（见下） |

第一次 OBSERVATION 尝试 `RUN-20261002-C691F81F` 因 `EXPERIMENT_RUN_FAILED: 公共首板回撤底座要求 Dataset version=v5，当前是 v7` 失败；上述最小修正后重跑成功。**既有 SINGLE_EVENT 实验行为逐字节不变。**

## 8. Gate 结论

| Gate 项 | 判定 |
| --- | --- |
| OBSERVATION 持久化 + OBSERVATION_READY | **PASS** |
| HOLDOUT 持久化 + `confirmatoryGate=PASS` | **PASS** |
| protocol / dataset / execution fingerprint | **PASS**（protocol-sha256:481f98d5…、750001、3 artifacts） |
| 未污染 Holdout 窗口 | **PASS**（`CLEAN`） |
| PROMOTE-001 parity | **PASS（精确）** |
| Strategy Version / provenance | **未创建（阻塞）** |

**是否达到正式 Strategy 提升前 Gate：未达到** —— 证据侧已全部就绪（HOLDOUT PASS + parity 精确 + 隔离 CLEAN），只差 §6 的 Bridge 语义缺口：产出的 Strategy Version 目前无法携带 Runner。修复后即可完成最后一步，无需再跑 Run。
