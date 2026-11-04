# RESULT-RUNNER-HOLDING-NEWHIGH3-T80-001

> 目标：把 `RESULT-RUNNER-HOLDING-BRIDGE-001` / `-CONSISTENCY` 中唯一入选的 `NEW_HIGH_3_T74` 单变量桥，升级为**正式 Runner Holding Strategy 验证**。
> 只验证一条规则：T+10 收盘 `newHigh3 == TRUE` → 跳过原时间退出 → 持有期限延长到 T+80。选股 / 3F Top3 / T+6 开盘入场 / 仓位 / 止损 / 其他原退出规则全部不变。

---

## 0. 固定口径与语义边界

- 基线策略：`first-limit-pullback-3f-top3@1.62.1`（选股、3F Top3、信号、T+6 开盘入场、仓位、止损、趋势退出、strongHold 全部原样）。
- 数据集：真实 T+80 v7 `datasetVersionId=750001`；执行投影 = v5 官方行 + 选中事件 v7 `rd17..80`（与 Bridge 完全一致）。
- Runner 规则（`PIT_RUNNER_HOLDING_BRIDGE`）：`state=NEW_HIGH_3`、`decisionHoldingDays=5`（= T+10 收盘，只评估一次）、`extendToHoldingDays=74`。
- **命名语义**：`T74` = `extendToHoldingDays=74`，不是 T+74 决策日；T+6 入场时 hold=74 对应 T+79 收盘信号 → T+80 开盘成交。Runner 决策点始终是 hold=5 = T+10 收盘。
- 严格 PIT：T+10 决策只读 ≤ T+10 的行情；T+20 / T+80 只作为后续表现或退出执行数据。
- 只验证 `newHigh3`：不组合其他状态、不调定义、不搜索阈值、不新增止盈/止损/趋势退出、不创建 Candidate、不改 25% 单票上限。

### 0.1 唯一性证明（退出策略逐字段快照）

执行脚本把 B 与 C 的 `exitPolicy` 逐字段写入 evidence。C 相对 B 的 **唯一** 差异是新增 `runnerBridge`：

| exitPolicy 字段 | B（Bridge Baseline） | C（Runner） |
| --- | --- | --- |
| stopLossRatio / takeProfitRatio / maxHoldingDays | [null,null,5] | [null,null,5] |
| advancedStopPolicy | {"anchor":{"kind":"FIXED_PERCENT","stopRatio":0.06},"confirmation":"INTRADAY","escalation":{"kind":"PEAK_DRAWDOWN","activationRatio":0.03,"drawdownRatio":0.08}} | {"anchor":{"kind":"FIXED_PERCENT","stopRatio":0.06},"confirmation":"INTRADAY","escalation":{"kind":"PEAK_DRAWDOWN","activationRatio":0.03,"drawdownRatio":0.08}} |
| advancedTrailingPolicy | {"kind":"MA_CROSS","fastWindow":5,"slowWindow":10,"activationRatio":0} | {"kind":"MA_CROSS","fastWindow":5,"slowWindow":10,"activationRatio":0} |
| strongHold | {"atHoldingDays":5,"minReturnRatio":0.03,"requireAboveMa5":true,"requireAboveMa10":true,"extendToHoldingDays":10,"afterExtendedHold":"TIME_EXIT"} | {"atHoldingDays":5,"minReturnRatio":0.03,"requireAboveMa5":true,"requireAboveMa10":true,"extendToHoldingDays":10,"afterExtendedHold":"TIME_EXIT"} |
| recoveryPath | null | null |
| runnerBridge | null | {"kind":"PIT_RUNNER_HOLDING_BRIDGE","state":"NEW_HIGH_3","decisionHoldingDays":5,"extendToHoldingDays":74} |

即：原策略的时间上限（`maxHoldingDays=5`，第 5 持有日 = T+10 收盘触发）、6% 固定止损 + 峰值回撤升级、MA5/MA10 趋势止盈、strongHold(5→10) 全部保持不变；Runner 只是**取消这批最强交易的时间上限**，让原有止损/趋势规则继续决定何时离场。

## 1. 三层对照（A / B / C）

| 层 | 身份 | 角色 | 总收益 | CAGR | MaxDD | PF | 交易数 | 胜率 | cost×2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **A** | first-limit-pullback-3f-top3@1.62.1 | 正式策略性能基线（v5 T+20 执行，T80 仅标签） | 57.73% | 6.12% | 47.96% | 1.1366 | 1359 | 39.96% | -20.57% |
| **B** | study-runner-holding-bridge-001@1.0.0 | T80 Bridge 执行基线（本次实跑，与 Bridge 一致） | 15.79% | 1.93% | 54.81% | 1.0660 | 1619 | 38.97% | -34.50% |
| **C** | study-runner-holding-bridge-newhigh3-t74@1.0.0 | NEW_HIGH_3_T74 Runner（本进程实跑，仅加 Runner） | 151.10% | 12.75% | 43.30% | 1.2073 | 1434 | 38.56% | 55.95% |

- **A 不参与 B↔C 增量计算**。A 的 +57.73% / 1359 笔是正式 1.62.1 的 T+20 执行口径；B/C 是 T80 可执行投影口径。只有 B↔C 是同一 dataset / 同一 sourceRun / 同一 execution projection 的直接可比对。
- B 实跑值 15.79% / 1619 笔与该 dataset 版本下的 Bridge 基线一致（datasetVersion=rd-1.0.0-1-3e494f190d453fd5，sourceRun=1f0bcbebf886897d…）。

## 2. B vs C 关键指标

| 指标 | B Bridge Baseline | C NEW_HIGH_3_T74 | Δ |
| --- | ---: | ---: | ---: |
| 总收益 | 15.79% | 151.10% | +135.31% |
| CAGR | 1.93% | 12.75% | +10.82% |
| MaxDD | 54.81% | 43.30% | -11.51% |
| Profit Factor | 1.0660 | 1.2073 | +0.1413 |
| 胜率 | 38.97% | 38.56% | -0.41% |
| 平均持仓日 | 5.643 | 6.386 | +0.7432 |
| cost×2 总收益 | -34.50% | 55.95% | +90.44% |
| cost×2 MaxDD | 68.70% | 52.89% | -15.81% |
| 交易数 | 1619 | 1434 | -185 |
| 期末未平仓 | 5 | 5 | 0 |
| 平均 MFE（entry→数据末，股票路径） | 27.29% | 27.02% | -0.28% |
| 平均 MAE（entry→数据末，股票路径） | -16.78% | -16.96% | -0.18% |
| 平均 MFE（entry→实际退出，持仓窗） | 7.13% | 8.02% | +0.90% |
| 平均 MAE（entry→实际退出，持仓窗） | -4.51% | -4.56% | -0.05% |
| +20%（股票路径） | 44.10% | 44.28% | +0.18% |
| +30%（股票路径） | 28.47% | 28.80% | +0.33% |
| +50%（股票路径） | 13.59% | 13.53% | -0.06% |
| +80%（股票路径） | 6.24% | 5.44% | -0.80% |
| +20%（持仓窗内实际达到） | 8.09% | 9.55% | +1.46% |
| +30%（持仓窗内实际达到） | 3.64% | 4.67% | +1.03% |
| +50%（持仓窗内实际达到） | 0.74% | 1.53% | +0.79% |
| +80%（持仓窗内实际达到） | 0.12% | 0.42% | +0.29% |
| 单笔平均净收益 | 0.18% | 0.49% | +0.31% |
| 单笔中位净收益 | -1.21% | -1.32% | -0.11% |

## 3. Runner 执行事实

| 口径 | 值 |
| --- | ---: |
| Runner 触发笔数（实际改变了 exitTime 的持仓） | 161 |
| Runner 覆盖率（相对 C 全样本 1434 笔） | 11.23% |
| Runner 覆盖率（相对 B 全样本 1619 笔） | 9.94% |
| 延长持仓天数合计 | 960 天（均值 5.96 天/笔） |
| Runner 直连额外 PnL（161 笔逐笔净额差） | 250337 |
| 其中改善 / 恶化笔数 | 89 / 72 |
| 逐笔额外 PnL 均值 / 中位数 | 1554.89 / 105.79 |
| 整体权益差（C − B） | 135308（B 115788 → C 251096） |
| 资金循环/建仓差异残差 | -115029（= 总权益差 − 直连增量，来自 C 少开的 185 笔） |

### 3.1 Runner 的最终退出原因分布

| 退出类别 | Runner 命中持仓（C） | 同一批持仓在 B 的退出 |
| --- | ---: | ---: |
| 原止损 STOP_LOSS | 51 | 0 |
| 原趋势止盈 TREND_EXIT | 110 | 0 |
| 原时间退出 TIME_EXIT | 0 | 89 |
| strongHold 延长后时间退出 | 0 | 72 |
| **Runner 自己走到 T+80 时间退出** | 0 | — |

**关键事实**：161 笔 Runner 命中里，**没有一笔**走到 T+80 的 Runner 时间退出（RUNNER_BRIDGE_TIME_EXIT = 0）。它们全部在原止损（51 笔）或原 MA5/MA10 趋势止盈（110 笔）离场。

### 3.2 全样本退出结构变化

| 退出类别 | B | C | Δ |
| --- | ---: | ---: | ---: |
| STOP_LOSS | 569 | 579 | +10 |
| TREND_EXIT | 555 | 609 | +54 |
| TIME_EXIT（普通） | 358 | 203 | -155 |
| STRONG_HOLD_EXIT | 132 | 38 | -94 |
| OPEN_AT_END | 5 | 5 | 0 |

- 原时间出口合计（TIME_EXIT + STRONG_HOLD_EXIT）：**B 490 → C 241，减少 249 笔**。其中 161 笔正是 Runner 命中持仓不再走时间退出，其余来自 C 少开的 185 笔。
- 消失的时间退出被原止损 / 趋势止盈吸收：TREND_EXIT +54，STOP_LOSS +10。

## 4. Full / IS / OOS

IS = 2019–01–01 ~ 2024–12–31；OOS = 2025–01–01 ~ 2026–09–04。策略口径 = 逐年收益复利（与既有 T80 / Bridge 报告一致）；括号内为同一窗口的权益曲线口径。

| 窗口 | 版本 | 总收益 | MaxDD | PF | 交易数 | 胜率 | cost×2 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Full | B | 15.79% | 54.81% | 1.0660 | 1619 | 38.97% | -34.50% |
| Full | C | 151.10% | 43.30% | 1.2073 | 1434 | 38.56% | 55.95% |
| IS | B | -23.75%（-19.75%） | 54.81% | 1.0002 | 1272 | 37.97% | n/a |
| IS | C | 24.43%（30.20%） | 43.30% | 1.0868 | 1130 | 37.88% | n/a |
| OOS | B | 44.18%（43.46%） | 16.35% | 1.2956 | 347 | 42.07% | n/a |
| OOS | C | 89.39%（89.48%） | 13.81% | 1.4611 | 304 | 40.46% | n/a |

| 窗口 | Runner 触发 | 覆盖 | 直连额外 PnL | 额外持仓日 | 改善/恶化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full | 161 | 11.23% | 250337 | 960 | 89/72 |
| IS | 119 | 10.53% | 99333 | 678 | 60/59 |
| OOS | 42 | 13.82% | 151004 | 282 | 29/13 |

## 5. 2019–2026 年度结果

| 年度 | B 收益 | C 收益 | Δ | B MaxDD | C MaxDD | B PF | C PF | B 交易 | C 交易 | Runner 触发 | 额外 PnL | 额外持仓日 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2019 | -6.40% | -1.64% | +4.76% | 31.82% | 34.72% | 0.9972 | 1.0353 | 214 | 193 | 22 | 10636 | 117 |
| 2020 | -14.01% | -5.25% | +8.76% | 23.85% | 22.12% | 0.8882 | 0.9762 | 206 | 183 | 19 | 8763 | 117 |
| 2021 | 25.96% | 57.75% | +31.79% | 13.51% | 12.22% | 1.3213 | 1.7784 | 208 | 175 | 22 | 1881 | 112 |
| 2022 | -9.24% | 1.13% | +10.38% | 28.77% | 31.54% | 0.9340 | 1.0317 | 217 | 192 | 19 | 43375 | 123 |
| 2023 | -9.56% | -15.62% | -6.06% | 16.88% | 23.31% | 0.9445 | 0.8427 | 210 | 191 | 18 | 11775 | 116 |
| 2024 | -8.37% | -0.82% | +7.55% | 31.10% | 28.34% | 0.9359 | 1.0474 | 217 | 196 | 19 | 22902 | 93 |
| 2025 | 32.84% | 79.92% | +47.08% | 15.91% | 11.73% | 1.4025 | 1.8734 | 203 | 169 | 27 | 100782 | 205 |
| 2026 | 8.53% | 5.26% | -3.27% | 16.35% | 13.81% | 1.1770 | 1.1210 | 144 | 135 | 15 | 50223 | 77 |

- 年度优于 Bridge Baseline：**6/8**（2019、2020、2021、2022、2024、2025）；差于基线：2/8（2023、2026）。
- 重点年份：2020 -14.01% → -5.25%；2023 -9.56% → -15.62%（唯一显著变差年份）；2025 32.84% → 79.92%；2026 8.53% → 5.26%。

## 6. 特别检查：右尾 MFE 是否变成实际策略收益

### 6.1 是——确实发生了右尾捕获，而不是纯选股差异

- 股票路径口径的 +20/+30/+50/+80 达成率几乎不变（C 的 +20 44.28% vs B 44.10%）：**候选池本身没有变**，变的只是持有期。
- 持仓窗内实际达到 +20% 的比例由 8.09% 提升到 9.55%，+30% 由 3.64% 提升到 4.67%，+50% 由 0.74% 提升到 1.53%——多出来的右尾是在 **Runner 延长的持仓窗内真实到达**的。
- 持仓窗 MFE 由 7.13% 升到 8.02%，而持仓窗 MAE 只从 -4.51% 变到 -4.56%：上行变多、下行几乎不变。
- 单笔平均净收益 0.18% → 0.49%，PF 1.0660 → 1.2073。
- 161 笔 Runner 的逐笔额外 PnL 中位数为 105.79、均值为 1554.89，**均值远大于中位数**：增量来自右尾的少数大赢家，不是均匀抬升。

### 6.2 代价——确实增加了持仓时间，但不是靠放大 MAE/MaxDD 换来的

- 持仓时间：平均持仓日 5.643 → 6.386；Runner 命中持仓平均多拿 5.96 天。
- 资金占用：C 的交易数 1619 → 1434（少 185 笔），是"资金被延长持有占用、错过部分后续建仓"的直接体现；残差 -115029 就是这部分再投资差异。
- 风险并未恶化：MaxDD 54.81% → 43.30%；cost×2 MaxDD 68.70% → 52.89%；全样本 MAE 仅从 -16.78% 微升到 -16.96%（股票路径口径）。

### 6.3 但是——离场仍然完全由原有规则决定

- 161 笔 Runner 里 **0 笔**走到 Runner 的 T+80 时间退出；全部由原止损（51 笔）或原 MA5/MA10 趋势止盈（110 笔）结束。
- 所以这条规则的经济含义是：**不是新增一个 Exit，而是取消最强 cohort 的 T+10 时间上限**，把它们交给原止损/趋势规则自己决定何时走。`newHigh3` 起到的是『给不给更多时间』的选择器作用，而不是卖出信号。

## 7. 判定

1. **路径型 Runner 是否在正式执行链稳定执行？——是。** 规则经由 `PIT_RUNNER_HOLDING_BRIDGE` 进入正式 simulator；C 的 `exitPolicy` 相对 B 只有 `runnerBridge` 一个新增字段（见 §0.1），T+10 决策只用 ≤T+10 数据，结果可确定性复现（两次独立运行逐字段相同）。
2. **B → C 的客观结果：** Full 15.79% → 151.10%；CAGR 1.93% → 12.75%；MaxDD 54.81% → 43.30%；PF 1.0660 → 1.2073；cost×2 -34.50% → 55.95%。Full / IS / OOS 三层同向为正，OOS 贡献最大（OOS 直连额外 PnL 151004 / Full 250337）。
3. **稳定性边界：** 6/8 年优于 Bridge Baseline；2023 是唯一显著变差年份（-9.56% → -15.62%），2026 小幅变差（8.53% → 5.26%）。IS 的改善幅度明显小于 OOS，增量高度依赖少数右尾事件（逐笔额外 PnL 中位数仅 105.79）。
4. **是否值得进入下一阶段 OOS / WFA 正式验证？——值得**，但必须带着两个已知边界：(a) 收益来源是右尾少数事件，必须用严格 rolling WFA / 分年份稳定性继续压测；(b) Runner 让资金占用上升、建仓数下降，必须在正式链上同时评估容量与资金效率，而不是只看总收益。
5. **不创建 Candidate、不修改正式 1.62.1**；本轮只完成研究版本 `study-runner-holding-bridge-newhigh3-t74@1.0.0` 的正式验证。

## 8. 证据链与版本留档

| 产物 | 路径 |
| --- | --- |
| 最终报告 | docs/research/RESULT-RUNNER-HOLDING-NEWHIGH3-T80-001.md |
| 原始 evidence | docs/evidence/_analysis_runner_holding_newhigh3_t80_001.json |
| 汇总 evidence | docs/evidence/_analysis_runner_holding_newhigh3_t80_001_summary.json |
| 版本 / execution fingerprint 留档 | docs/evidence/_analysis_runner_holding_newhigh3_t80_001_version.json |
| 执行脚本 | scripts/runRunnerHoldingNewHigh3T80_001.mts |
| 报告脚本 | scripts/reportRunnerHoldingNewHigh3T80_001.mts |
| Bridge 证据 | docs/evidence/_analysis_runner_holding_bridge_001.json |
| 口径统一报告 | docs/research/RESULT-RUNNER-HOLDING-BRIDGE-001-CONSISTENCY.md |
| 正式基线 A | docs/evidence/_analysis_3f_top3_v1621_t80_validation_20261002_summary.json |

### 执行指纹

| 项 | 值 |
| --- | --- |
| researchStrategyId | study-runner-holding-bridge-newhigh3-t74 |
| researchStrategyVersion | 1.0.0 |
| sourceStrategy | first-limit-pullback-3f-top3@1.62.1 |
| datasetVersionId | 750001 |
| executionDatasetVersion | rd-1.0.0-1-3e494f190d453fd5 |
| sourceRunFingerprint | 1f0bcbebf886897d4691772eb6b8fef098bd400f2942868e7293627b5e0f26ba |
| baselineRunFingerprint | 3cc7d0dc0ef035771d61ecec52ca66964b5181fee2a4ac8cfbbe24edfd601267 |
| baselineCost2xRunFingerprint | 76404cbc740ab9f45183ce48ddf87938fc1504d4980bcd8f4f9072233c780183 |
| runnerRunFingerprint | f885463b3c2295208438c54ea58538d49e28dceac511ad79998b7836b650ac45 |
| runnerCost2xRunFingerprint | ac87b3e170ab791a4a73f101de6b224f79f9b6a8bde6c54026404400a00271d5 |
| codeVersion | runner-holding-newhigh3-t80-001 |
| gitCommit | b41190bb9032c16c81148b3d23a62e8b66bea25f (dirty) |
| candidateCreated | false |
