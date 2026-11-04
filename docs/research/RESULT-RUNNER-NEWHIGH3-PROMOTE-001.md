# RESULT-RUNNER-NEWHIGH3-PROMOTE-001

> 目标：把已完成 Forward Validation 的 `NEW_HIGH_3 Runner / hold=20` 转入正式 Strategy 验证。
> 本任务可创建 Candidate，但**不修改任何现有正式 Strategy 版本**；先完成 canonical backtest 验证。
> 研究验证与策略提升证据；不重新搜索参数（不再测试 hold=40/60/74）。

---

## 0. 冻结结论（ACCEPTED）

| 项 | 冻结值 |
| --- | --- |
| Runner state | `NEW_HIGH_3` |
| decisionHoldingDays | `5`（T+10 收盘，仅评估一次） |
| extendToHoldingDays | `20` |
| 不变 | stopLoss / MA5-MA10 trend exit / strongHold / Top3 / T+6 Open / 仓位 |
| 不再测试 | hold=40 / 60 / 74 |
| 参数搜索 | 无 |
| 研究证据 | `RESULT-RUNNER-NEWHIGH3-HORIZON-001` + `RESULT-RUNNER-NEWHIGH3-FORWARD-001` |
| 状态 | **ACCEPTED**（研究结论登记，候选创建待接线） |

> 登记说明：旧 Research 的 `research_conclusion` / `research_experiment` 物理表已归档（现库仅存 `research_experiment_run` / `research_strategy_candidate` 等），
> 因此 `Conclusion → Candidate` 旧路径无法落库。新的 `Research Experiments → Strategy` 桥（`INDEPENDENT_EXPERIMENT`）要求**已持久化的 HOLDOUT Run + PASS 确认门**，
> 而 Runner 属于**组合层路径依赖**研究（依赖资金循环 / 完整 simulator），当前实验框架未覆盖该执行面。详见 §6。

---

## 1. Step 4 — 正式基线 parity（必须先通过）

| 门 | 要求 | 正式留档 | 本次实跑 | 结果 |
| --- | ---: | ---: | ---: | --- |
| Strategy 1.62.1 基线 | +57.73% / 1,359 笔 | +57.7330390741% / 1,359 笔 | +57.7330% / 1359 笔 | **PASS** |

- canonical dataset / execution projection：`rd-1.0.0-1-bd57f47cfcecf245`（v5 官方行 rd0..16）。
- 复现精确值 **57.7330390741%**，与留档 `57.7330390741` 一致（1e-6 容差）。
- v7 执行投影下 A/C 又复现了 HORIZON-001 的 FULL 结果（parity PASS），确保后续比较落在已验证坐标上。

**执行坐标说明（重要）**：`hold=20` 需要 T+17…T+20 行情。正式 canonical v5 只有 rd0..16，
因此正式提升版本必须把执行绑定迁到 v7 (`750001`)，执行投影 = v5 官方行 + 选中事件 v7 `rd17..80`。
在 v5 上启用 Runner 只会得到 5 笔 `OPEN_AT_END` 截断（-42.23pp / 5 笔），不是 hold=20 语义。

---

## 2. 运行坐标上的 A / C 比较（v7 执行投影）

A = 无 Runner；C = `NEW_HIGH_3` hold=20。两者唯一差异 = `exitPolicy.runnerBridge`。

| 版本 | 总收益 | CAGR | MaxDD | PF | 交易数 | 平均持仓日 | 中位持仓日 | cost | turnover | 期末未平仓 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **A（无 Runner）** | 15.79% | 1.93% | 54.81% | 1.0660 | 1619 | 5.64 | 5.5 | 71,676 | 56,124,710 | 5 |
| **C（hold=20）** | 129.69% | 11.45% | 45.06% | 1.1853 | 1453 | 6.30 | 5.0 | 89,761 | 73,402,634 | 5 |

| 增量 | 收益 | CAGR | MaxDD | PF | 交易数 | 平均持仓日 | turnover | cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **C − A** | +113.90pp | +9.52pp | -9.75pp | +0.1193 | -166 | +0.66 | 17,277,924 | 18,086 |

---

## 3. Runner 触发、直接增量与资金循环残差

| 指标 | 值 |
| --- | ---: |
| Runner 触发笔数 | 159 |
| 覆盖率（vs C 全样本 1453 笔） | 10.94% |
| 延长持仓日合计 | 888 |
| 平均额外持仓日/笔 | 5.58 |
| 直接 Runner PnL（逐笔净额差合计） | 237,957 |
| 总权益差（C − A） | 113,898 |
| 资金循环残差（= 权益差 − 直接增量） | -124,059 |
| 少开交易数 | 166 |
| 单笔额外 PnL mean / median | 1,497 / 68 |
| Top10% 额外 PnL 贡献 | 193,372（占 81.3%） |
| 改善 / 恶化笔数 | 86 / 73 |

Runner 命中持仓的最终退出原因：

| 退出类别 | 笔数 |
| --- | ---: |
| STOP_LOSS | 45 |
| RUNNER_BRIDGE_TIME_EXIT | 17 |
| TREND_EXIT | 97 |

---

## 4. 与正式基线（1,359 / +57.73%）的实际净增量

正式基线是 v5/T+20 执行口径；被提升版本必须迁到 v7 才能表达 hold=20。因此「实际净增量」包含两个来源，必须拆开：

| 分解 | 数值 |
| --- | ---: |
| 正式基线（v5，1.62.1） | 57.73% / 1359 笔 |
| 执行投影迁移（v5 → v7，无 Runner） | -41.95pp |
| Runner 延长（v7 A → C，hold=20） | +113.90pp |
| **实际净增量（正式基线 → 提升版本）** | **+71.95pp** |
| 交易数变化 | +94（1359 → 1453） |

> 读法：单独引用「+113.90pp」会把执行投影迁移（v5 的 1,359 笔在 T+20 边界下的不同资金循环）也算进去；
> 单独引用「−41.95pp」也不对。唯一诚实的正式净增量口径是二者相抵后的 **+71.95pp**，且其中 hold=20 的贡献是 +113.90pp。

---

## 5. 与 HORIZON-001 / FORWARD-001 的一致性

| 指标 | HORIZON-001 | 本次实跑 |
| --- | ---: | ---: |
| A 总收益 / 交易数 | 15.79% / 1619 | 15.79% / 1619 |
| C 总收益 / 交易数 | 129.69% / 1453 | 129.69% / 1453 |
| Runner 触发 | 159 | 159 |
| parity | — | **PASS** |

FORWARD-001 已确认：OOS 2025–2026 上 C 相对 A `+51.82pp`、MaxDD 与 PF 同步改善，且 2025/2026 两个年度同向为正；D=40 相对 C=20 无稳定独立增量。本次 canonical 验证与之一致。

---

## 6. Candidate 创建状态（Research → Strategy Bridge）

**本次未创建 Candidate —— 现有桥的入口条件在本仓库当前状态下不满足，且我拒绝绕过。**

| 路径 | 状态 |原因 |
| --- | --- | --- |
| 旧 `Conclusion → Candidate`（`createFromConclusion`） | 不可用 | `research_conclusion` / `research_experiment` 物理表已归档；候选行的 `experimentId` / `conclusionId` 无真实来源行 |
| 独立实验桥（`createStrategyFromEvidenceRuns`） | 不满足入口 | 要求**已持久化的 HOLDOUT Run**（`researchPhase=HOLDOUT` + `confirmatoryGate.status=PASS` + 未污染窗口 + 协议指纹一致）；Runner 研究为脚本级、无此 Run |
| 脚本级 Runner 规则与实验框架 | 语义不匹配 | `hold=20` 增量是**组合层路径依赖**量（依赖 maxPositions=5 的资金循环与完整 simulator）；独立实验框架只提供逐事件 dataset access，没有该执行面，强行重建会得到与已验证结果不同的数字 |

现库实证（HOLDOUT Run 的实际确认门）：

| Run | experimentId | datasetVersionId | confirmatoryGate |
| --- | --- | ---: | --- |
| `RUN-20260925-76FA1DCC` | composite-factor-3f-amplitude-volume-oos-study | 660001 | **INSUFFICIENT** |
| `RUN-20260925-E4BA89C4` | composite-factor-12f-equal-weight-oos-study | 660001 | **INSUFFICIENT** |
| `RUN-20260925-509DEF49` | composite-factor-4f-equal-weight-oos-study | 660001 | **INSUFFICIENT** |
| `RUN-20260922-816ED25F` | oversold-gap-reversal-validation | 570001 | **FAIL** |
| `RUN-20260921-54D654BB` | decision-forward-study | 390002 | PASS |

- 唯一 `PASS` 的 HOLDOUT Run（`RUN-20260921-54D654BB`）在 `390002`，**与 Runner 的 `750001` 不同坐标**，按桥的 Dataset 一致性规则不可用；
- `750001` 上**没有任何 HOLDOUT Run**；660001 的三个 HOLDOUT Run 仍是 `INSUFFICIENT`。⇒ 桥的入口条件在本仓库当前状态下**客观上不满足**。

已产出的、可直接用于后续接线的材料：

- 本报告给出的冻结结论与 canonical 证据；
- 目标策略坐标：`first-limit-pullback-3f-top3@1.62.1` + `runnerBridge{state:NEW_HIGH_3, decisionHoldingDays:5, extendToHoldingDays:20}`；
- 推荐执行绑定：`datasetVersionId=750001`（v7）；这是唯一能表达 hold=20 的真实数据集坐标。

---

## 7. 结论：是否满足正式 Strategy 验证 Gate

| Gate 项 | 判定 |
| --- | --- |
| 正式基线 parity（1.62.1 / canonical v5 / +57.73% / 1,359） | **PASS** |
| v7 执行投影 A/C 与 HORIZON-001 一致 | **PASS** |
| 规则冻结（state/decision/hold=20/其余不变、无参数搜索） | **PASS** |
| 与正式基线实际净增量 | **+71.95pp**（其中 hold=20 贡献 +113.90pp） |
| 风险增量 | MaxDD -9.75pp、PF +0.1193 |
| 右尾属性已披露 | **是**（Top10% 占比 81.3%，2026 中位为负） |
| Candidate 创建 | **未完成**（桥入口条件不满足，见 §6） |

**总体：canonical backtest 验证 通过；正式 Strategy 提升所需的研究证据与基线 parity 均已就位。**

但必须明确两点：

1. **验证通过不等于可以直接替换正式版本**。正式提升会同时改变执行绑定（v5 → v7），这一步带来的资金循环变化是-41.95pp，必须与 hold=20 的 +113.90pp 分开评审，不能把它当作纯 Runner 收益。
2. **Candidate 尚未创建**。按现有桥的诚实入口，需要先补一个覆盖该组合层路径的持久化 HOLDOUT 实验（或在 Research→Strategy 桥中正式扩展组合层实验面），而不是用脚本结果手写一个 Run 行。本任务不修改现有正式 Strategy 版本。

> 本任务为研究验证 + 提升准备：未创建 Candidate、未修改正式 Strategy。

