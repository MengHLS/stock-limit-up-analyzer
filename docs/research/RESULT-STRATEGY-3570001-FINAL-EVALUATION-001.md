# RESULT-STRATEGY-3570001-FINAL-EVALUATION-001

> 目标：对 `Strategy Version 3570001` 做最终策略评估，结果**持久化并接入前端页面**。
> **结论：完成。** 评估留档两条（基线 + 提升版）、服务端只读端点、独立前端页（`/strategy-final-evaluation`）全部就位。
> 未重跑搜索、未改 `3570001` / `1.62.1` / Runner 参数、未新增 simulator。

---

## 1. 评估坐标（同一数据 / 同一窗口 / 同一 simulator / 同一成本）

| 项 | 值 |
| --- | --- |
| Strategy | `first-limit-pullback-3f-top3-runner-hold20@1.0.0`（= Strategy Version **3570001**） |
| 对照 | `first-limit-pullback-3f-top3@1.62.1` |
| Runner | `NEW_HIGH_3` / `decisionHoldingDays=5` / `extendToHoldingDays=20` |
| Dataset | `v7`（`datasetVersionId=750001`） |
| 窗口 | `2019-01-01 ~ 2026-09-04`；OOS 段 `2025-01-01 ~ 2026-09-04` |
| simulator | `server/research/simulator/engine.ts#runTradeSimulation`（唯一内核，未新增） |
| protocol fingerprint | `protocol-sha256:481f98d5fc71be7de6237ad5844a95af162956def716b79e184de90aacee444b` |
| maxPositions | `5` |

## 2. 持久化

| 项 | 值 |
| --- | --- |
| Evaluation Run（基线 1.62.1） | 留档行 id **`5970001`**（`runId=eval-3570001-baseline-1621`） |
| Evaluation Run（提升版 3570001） | 留档行 id **`5970002`**（`runId=eval-3570001-promoted-hold20`） |
| 存储 | 既有 `closed_loop_backtest_run`（`experimentId=STRATEGY-3570001-FINAL-EVALUATION-001`） |
| 完整指标 | `result.evaluationDetail`（baseline / promoted / delta / yearly / drawdownCurve / runner / concentration / costSensitivity） |
| 列表列 | 已同步填充 `finalEquity` / `tradeCount` / `totalReturnPct` / `maxDrawdownPct` / `cagrPct` / `datasetVersionId` / `recipeId` |

## 3. 核心指标（Full）

| 指标 | 1.62.1 | 3570001 | Delta |
| --- | ---: | ---: | ---: |
| 总收益 | 15.7877% | **129.6860%** | +113.8984pp |
| CAGR | 1.9285% | **11.4444%** | +9.5159pp |
| MaxDD | 54.8080% | **45.0611%** | −9.7469pp |
| Profit Factor | 1.1366 | **1.1853** | +0.0486 |
| 胜率 | — | 38.6050% | — |
| 交易数 | 1,619 | 1,453 | −166 |
| 平均 / 中位持仓日 | — | 6.3025 / 5 | — |
| Turnover | 56,124,710 | 73,402,634 | +17,277,924 |
| Trading Cost | 71,675.6 | 89,761.5 | +18,085.9 |

OOS 段（`2025-01-01~2026-09-04`，**同一 full-run 权益曲线切片**，口径与 HORIZON-001 的 window-curve 一致）：1.62.1 **43.4579%** → 3570001 **77.4565%**（+33.9986pp）。

## 4. 分年度（收益 / MaxDD / 交易数）

| 年度 | 1.62.1 | 3570001 | Δ收益 | 1.62.1 DD | 3570001 DD | 1.62.1 笔 | 3570001 笔 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2019 | −6.40% | −1.66% | +4.74pp | 31.82% | 34.81% | 214 | 194 |
| 2020 | −14.01% | −2.41% | +11.60pp | 23.85% | 22.13% | 206 | 183 |
| 2021 | +25.96% | +61.16% | +35.20pp | 13.51% | 12.08% | 208 | 175 |
| 2022 | −9.24% | −5.49% | +3.76pp | 28.77% | 32.03% | 217 | 202 |
| 2023 | −9.56% | −15.63% | −6.07pp | 16.88% | 23.34% | 210 | 193 |
| 2024 | −8.37% | −1.40% | +6.97pp | 31.10% | 28.66% | 217 | 196 |
| 2025 | +32.84% | +72.86% | +40.01pp | 15.91% | 12.38% | 203 | 174 |
| 2026 | +8.53% | +2.61% | −5.93pp | 16.35% | 16.05% | 144 | 136 |

**年度失效区间（事实陈述，非评价）**：3570001 在 2023（−15.63%）与 2026（+2.61%）低于 1.62.1；其余 6 年高于。两个策略在 2019/2020/2022/2023/2024 均为负收益年，2021/2025 为主要正收益年。

## 5. Runner 贡献

| 指标 | 值 |
| --- | ---: |
| Runner 触发次数 | **159** |
| 触发覆盖率（vs 1453 笔） | 10.94% |
| Runner 直接 PnL 增量 | **237,957.4** |
| 平均 / 中位额外收益 | 1,496.59 / 68.02 |
| 额外持仓天数合计 / 均值 / 中位 | 888 / 5.58 / 5 |
| Top10% 额外 PnL 占比 | **81.26%** |
| 资金循环残差（权益差 − 直接增量） | −124,059.0 |

退出原因分布：`STOP_LOSS 45` / `TREND_EXIT 97` / `RUNNER_BRIDGE_TIME_EXIT 17`。

## 6. 收益集中度

| 指标 | 1.62.1 | 3570001 |
| --- | ---: | ---: |
| Top 5% 交易贡献 | — | **364.38%** |
| Top 10% 交易贡献 | 见 persisted payload | **483.21%** |
| 最大单笔盈利 | — | 39,839.74 |
| 最大单笔亏损 | — | −5,001.60 |
| 最长连续亏损笔数 | — | 14 |
| 最长回撤持续（自然日） | — | 1,240 |

（Top 10% 贡献 > 100% 表示：剔除前 10% 后其余交易合计为负 —— 与 HORIZON-001 / PROMOTE-001 的右尾结论同向。）

## 7. 成本敏感性

| 成本口径 | 1.62.1 收益 | 3570001 收益 | 1.62.1 MaxDD | 3570001 MaxDD |
| --- | ---: | ---: | ---: | ---: |
| 标准成本 | 15.7877% | **129.6860%** | 54.8080% | 45.0611% |
| 成本 ×2 | −34.4958% | **+23.4905%** | 68.70%（历史口径） | 55.5413% |

仅作敏感性展示；未做任何成本参数搜索。

## 8. 前端

| 项 | 值 |
| --- | --- |
| 页面路径 | **`/strategy-final-evaluation`** |
| 页面文件 | `client/src/pages/StrategyFinalEvaluation.tsx` |
| 导航 | AppShell「策略」组 → 「最终评估 3570001」 |
| 数据来源 | `trpc.researchRun.getFinalEvaluation` → `closed_loop_backtest_run.result.evaluationDetail`（**无硬编码数字**） |

页面实际展示：策略概览（3570001 / NEW_HIGH_3·hold=20 / Dataset / Evaluation Window / Run Status / protocol）、核心指标卡（Total Return、CAGR、MaxDD、PF、Trades、Turnover、Cost、Win Rate、Avg/Median Holding）、`Metric | 1.62.1 | 3570001 | Delta` 对照表、年度收益柱状图（双系列）、回撤曲线折线图（双系列，1863 点）、Runner 专区（Trigger Count / Coverage / Direct PnL Increment / Extra Holding Days / Mean·Median Extra PnL / Top10% Share / 退出原因分布表）、收益集中度（Top5%/Top10%/最大盈亏/连亏/回撤持续）、成本敏感性表（标准 vs ×2）。

## 9. 验证

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | **exit 0** |
| `npm run build`（vite + esbuild） | **成功**（新页面正常打包） |
| `vitest tests/server/closedLoopBacktestRun`（含新增 `finalEvaluationSelection.test.ts` 5 例） | 全绿 |
| `vitest tests/server/researchRunRouter.test.ts` | 全绿 |
| `vitest tests/client` | 全绿（含修复后的 `researchExperimentModeGrouping` 15 例） |
| 汇总（researchRun + closedLoopBacktestRun + client + researchExperiments） | **855 passed / 3 failed** |
| 3 个失败 | **既有失败**：`threeFactorTopNStrategyDocument.test.ts` 的 `+ "recoveryPath": null` 差异（工作区此前未提交改动；`git show HEAD:server/runWorkbenchAssembly/exitPolicy.ts` 中 recoveryPath 出现 0 次），与本次无关 |
| Evaluation Run 真实持久化 | **是**（5970001 / 5970002） |
| 前端真实读取该 Run | **是**（`getFinalEvaluation` 实测返回 baseline/promoted + evaluationDetail） |

## 10. Gate

| Gate 项 | 判定 |
| --- | --- |
| Full / OOS / 年度 / 回撤 / Runner / 集中度 / 成本敏感性均已计算 | **PASS** |
| 与 1.62.1 同数据 / 同窗口 / 同 simulator / 同成本对照 | **PASS** |
| 结果持久化（非仅日志） | **PASS** |
| 前端可读取持久化结果并展示（无硬编码） | **PASS** |
| 未修改 3570001 / 1.62.1 / Runner 参数 / simulator | **PASS** |

**是否达到「进入模拟盘前评估 Gate」：达到**（在"评估已完成且可复核"的意义上）。按任务要求**停在最终评估结果，不自动进入模拟盘**。
