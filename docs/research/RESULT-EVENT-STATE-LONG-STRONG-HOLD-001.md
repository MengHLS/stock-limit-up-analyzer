# RESULT-EVENT-STATE-LONG-STRONG-HOLD-001 · 「强势继续持有」实验臂结果

> 预注册（事前固定、未修改）：[`PREREG-EVENT-STATE-LONG-STRONG-HOLD-001.md`](PREREG-EVENT-STATE-LONG-STRONG-HOLD-001.md)（§1–§10）
> 执行记录与全部细节：同文件 §11（含两次自身缺陷修复、仓位口径改判、尾窗夹取）
> 数据集：`780004` 全区间 `2019-01-03 ~ 2026-01-28` · 初始资本 1,000,000 · 指标出口 `canonicalMetrics`（252 日、rf=0）

## 1. 结论（一句话）

**「强势继续持有」（第 40 个持有日收益 ≥3% 且收盘 >MA5、MA10 ⇒ 延长到第 60 日）在本策略上
没有正增量：纯增量 `B″−C″ = −1.89pp`，且回撤反而更深 2.50pp、Sharpe/Sortino/Calmar 全部更差。**
按预注册判据（要求 `B−C > 0` **且** 年度符号多数一致）**不通过**。

## 2. 三臂结果（`EQUITY_RATIO`：每笔 = 当日总权益 × 1/180）

| 臂 | 版本 | 留档 | 总收益 | MDD | CAGR | Sharpe / Sortino / Calmar | 成交 | 平均持有 | 峰值占用 |
|---|---|---|---|---|---|---|---|---|---|
| **A″ 控制** | `7.0.0` | `6210017` | **+77.146%** | 22.904 | 8.378 | 0.6670 / 0.9026 / 0.3658 | 4845 | 41.01 | 123 |
| **C″ 止损** | `8.0.0` | `6210018` | **+28.243%** | 13.819 | 3.562 | 0.4961 / 0.6833 / 0.2578 | 4834 | 23.40 | 113 |
| **B″ 强势续持** | `9.0.0` | `6210019` | **+26.353%** | 16.321 | 3.338 | 0.4158 / 0.5648 / 0.2045 | 4833 | 25.70 | **133** |

## 3. 两个对照（**必须分开解读**）

**① 强势续持纯增量（B″ − C″，本实验主问题）**

| 指标 | Δ |
|---|---:|
| `totalReturnPct` | **−1.890pp** |
| `maxDrawdownPct` | **+2.502pp（更深）** |
| `cagrPct` | −0.224pp |
| Sharpe / Sortino / Calmar | **−0.080 / −0.119 / −0.053** |
| 成交笔数 | −2 |

逐年（C″ → B″）：2019 +6.14→**+2.79** · 2020 +1.90→**+3.99** · 2021 +7.71→**+6.81** ·
2022 −2.36→**−3.93** · 2023 −3.14→**−3.84** · 2024 +7.43→**+8.75** · 2025 +8.34→**+10.18** · 2026 0→**−0.01**
⇒ **4 年更差 / 3 年更好 / 1 年持平，无一致符号**。

**② 止损效应（C″ − A″，附）**：`totalReturnPct` **−48.903pp** · MDD 更浅 9.085pp ·
CAGR −4.816pp · Sharpe/Sortino/Calmar **−0.171 / −0.219 / −0.108** · 成交 −11。
63.7%（3080/4834）持仓被 6% 止损打出、平均持有 41.0 → 23.4 天 ⇒ **止损在此策略上净负**
（方向与既有 3F `stopwide` 实验一致）。

## 4. 延长持仓的资金占用代价（预注册要求披露）

- **524 笔**（10.8%）真的走了延长（出场原因 `强势续持后持有满60个交易日`），另 1 笔期末仍持仓；
  平均持有 23.40 → **25.70 天**；**峰值占用 113 → 133（+20 个仓位）**。
- 🔴 **代价的直接证据在成交层**：`rejectedOrders` **122 → 295（+173）**，其中
  **`SUSPENDED` 由 0 → 163**、`NO_LIQUIDITY` 1 → 6、`LIMIT_DOWN` 107 → 112；`totalSignals` 9790 → 9960。
  即**延长持仓让更多卖出撞上停牌/跌停而顺延**，资金被占住更久 —— 这正是回撤加深 2.50pp 的机制，
  **不是**仓位槽耗尽（峰值 133 < `maxPositions 180`）。
- **归因边界（如实声明）**：平台**不标注「被延长交易挤掉的候选」** ⇒
  「延长交易 vs 被替代交易的逐笔净额」**无法单独归因**；上面给的是可观测的占用与拒绝代价。

## 5. 结论的适用边界

1. 该结论**只在「6% 止损已开启」的坐标下成立** —— `exitPolicy` 强制要求 `stop`，
   平台**无法表达「无止损 + 强势续持」**（见 PREREG §2），所以强势续持必然与止损同存。
2. 阈值/延长期**借用** 3F 校准（另一个策略上校准：收益 ≥3% 且 >MA5/MA10），
   **未**在本策略数据上调参 ⇒ **不推广到其他阈值或延长期**。
3. 数据集 `780004` 的 post 上限（rd=80）使派生尾窗被**显式夹取**（80 → 64），
   已记录于装配摘要 `eventWindowExitTailTradingDaysClampedFrom`。
4. **工程核验 ≠ 投资结论**：本实验只回答「该退出政策改动是否有增量」，
   **不**构成对该策略可交易性的任何背书；不转 Paper / Approved / Production。

## 6. 复现

```
# 臂文档构建与执行前校验（默认 dry-run）
node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongStrongHoldArms.mts
# 三臂正式运行（780004 全区间；A″/C″/B″）
node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongFormalRun.mts --dataset 780004 --version 7.0.0
node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongFormalRun.mts --dataset 780004 --version 8.0.0
node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongFormalRun.mts --dataset 780004 --version 9.0.0
# 三臂对照（canonical 指标 + B−C / C−A + 资金占用）
node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongArmCompare.mts
```

**留档坐标**：`strategy_versions` `7.0.0`/`8.0.0`/`9.0.0`（均 `Draft`，谱系 `2.0.0 → 7.0.0 → 8.0.0 → 9.0.0`）；
`closed_loop_backtest_run` `6210017`/`6210018`/`6210019`。**`2.0.0` 与既有 Run 均未修改。**
