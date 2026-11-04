# RESULT-BACKTEST-REENTRY-BASELINE-002

> 任务：`STRATEGY-IMPLEMENTATION-REENTRY-FIX-003`（Baseline 002）
> 状态：**`BASELINE_VALID`**
> 日期：2026-10-05

**`BASELINE_VALID` 的含义**（按任务 §20/§23）：执行链、退出语义、数据完整性均已正确，结果**可以被研究**。
**不代表**策略盈利，**不代表** Robustness / OOS / WFA 通过。

---

## 1. Run ID

```text
runId         = clrun-reentry-baseline-002
experimentId  = EXP-20261005-B2A1C3D4
strategy      = strong-trend-reentry-v1@1.0.1（document fingerprint 5d5d3cbefe797e3d57f9b0c08899805c713d90f9e189cefc26232f8db0817a3b）
dataset       = datasetVersionId=780001（first_limit_pullback v8，READY）
window        = 2019-01-01 → 2026-09-04
stages        = data / research / strategy / backtest / evaluation = EXECUTED；其余 9 阶段 BLOCKED（未装配）
```

固定口径（未优化任何参数）：`Entry = RECLAIM+1 Open`、`Exit = TIME_EXIT 20 TRADING_DAY @ close`、
`candidateExitPolicy = DISABLED`、`Position = EQUAL_WEIGHT`、`Cost = 声明的 V1 cost model`。

## 2. Signals / Executions / Fills / Suspended

| 量 | 值 |
|---|---:|
| candidateSlots | 2,492 |
| signals（= orders） | 628 |
| fills | 607 |
| partialFills | 5 |
| rejectedOrders | 21 |

拒单分解：

| 原因 | 数量 |
|---|---:|
| SUSPENDED | **3** |
| LIMIT_UP | 11 |
| INSUFFICIENT_CASH | 3 |
| LIMIT_DOWN | 2 |
| NO_LIQUIDITY | 1 |
| OTHER | 1 |

skipped：`BUDGET_BELOW_MIN_LOT 2,174` / `NO_NEXT_TRADING_DAY 1`。

**SUSPENDED 率：3 / 628 = 0.48%**（Baseline 001：13,897 / 14,513 = **95.8%**）。

## 3. Holding Period / Exit Reasons

| 分位 | 值（交易日） |
|---|---:|
| P5 | 21 |
| P25 | 21 |
| **中位数** | **21** |
| P75 | 21 |
| 均值 | 21.013 |

⇒ `candidateExitPolicy=DISABLED` + `TIME_EXIT 20` **已生效**：退出由时间规则驱动，**不再**由候选消失抢跑
（Baseline 001 中位数 3 日）。实测 21 = 建仓日 + 20 个交易日（含端点计数）。

- TIME_EXIT 退出：303 / 303 已平仓交易（唯一未平 1 笔为期末未到期 `openAtEnd`）
- candidate-deselection 提前退出：**0**

## 4. Trades / Return / Drawdown / Win Rate / Cost / Exposure

| 指标 | 值 |
|---|---:|
| trades | 304（已平 303 / 期末 1） |
| 期末权益 | 951.32 |
| 总收益 | **-99.05%** |
| 最大回撤 | **-99.31%** |
| 胜率 | 29.37% |
| 盈亏比（profit factor） | 0.600 |
| 平均仓位 | 0.656 |
| 最大并发持仓 | 15 |
| 权益点 | 1,880 |
| 单笔收益 P5 / P25 / 中位 / P75 / 均值 | -37.09% / -22.47% / -10.63% / +3.56% / -7.06% |
| 成本 | 声明 costModel 已计入（commission / stampDuty / transferFee / slippage BPS） |

> 结果**很差**。按任务 §14「不能为了让策略表现更好而改策略」⇒ **原样保留**，不做任何调整。

## 5. Comparison with Baseline 001

| 维度 | Baseline 001（不可采信） | Baseline 002 |
|---|---:|---:|
| strategy | v1.0.0（candidateExitPolicy 缺省 → HOLD_WHILE_SELECTED） | **v1.0.1（DISABLED）** |
| orders | 14,513 | **628** |
| fills | 602 | 607 |
| SUSPENDED | **13,897（95.8%）** | **3（0.48%）** |
| trades | 306（平 296） | 304（平 303） |
| holdingPeriod 中位数 | **3** | **21** |
| return | -59.94% | **-99.05%** |
| max drawdown | -66.70% | **-99.31%** |
| win rate | 36.49% | 29.37% |
| avg exposure | 0.904 | 0.656 |

⇒ 001 的「较小回撤」是**假象**：它靠 96% 的卖出失败把仓位锁死、期末估值掩盖；修复后真实持有 20 日，
亏损如实显现。这正是「必须先修执行正确性、再看收益」的原因。

## 6. Comparison with PRE-STRATEGY（RESULT-PRE-STRATEGY-REENTRY-001）

| 维度 | PRE-STRATEGY（研究） | Baseline 002 | 差异来源 |
|---|---|---|---|
| 入场 | RECLAIM+1 Open | RECLAIM+1 Open | 口径一致 |
| 出场 | 固定 T+20 观测 | TIME_EXIT 20 @ close | 一致（观测 vs 实现） |
| 信号 | 547 | 2,492 候选名额 → 628 实际下单 | 事件级身份 + Portfolio 逐面板单仓 + `BUDGET_BELOW_MIN_LOT` 2,174 剔除 |
| 成交 | 513 SIGNAL_FILLED | 607 fills | 成交过滤（LIMIT_UP 11 / SUSPENDED 3）+ 重复事件 |
| 研究 T+20 中位数 | +18.5%（且样本仅 461/547 可算） | 单笔收益中位数 **-10.63%** | **见下** |
| 成本 | 未计 | 已计 | 成本/滑点 |
| 样本截尾 | `reclaim_rd ≥ 60` 的 84 条无 T+20 | 事件窗 rd≤80 + Overlay 补足退出日 | 已解耦 |

**研究 T+20 中位数 +18.5% 与回测中位 -10.63% 的巨大差异，主因不是「策略变差」，而是口径不同**：

1. **组合层面 vs 单笔层面**：研究是「信号 T+20 收益中位数」；回测是**等权现金预算**下的组合，
   受 `BUDGET_BELOW_MIN_LOT`（2,174）剔除、并发 15 上限、部分成交影响；
2. **重复事件与单仓约束**：同一证券多个事件在回测里被单仓约束串行化，研究侧 event-level 独立计数；
3. **成本/滑点**：回测计入，研究未计；
4. **研究侧幸存者口径**：研究的 T+20 只覆盖 461/547（`reclaim_rd ≥ 60` 被截尾），
   而截尾那批恰是**后期强势**样本 —— 系统性偏高。

⇒ 该差异**需要独立的对照研究**（不在本轮范围）。本轮只确认：执行链与数据完整性已正确，数字可采信。

## 7. Position Lifecycle 完整性

```text
Entry    : RECLAIM+1 Open（真实成交 607 笔）
Holding  : 21 个交易日（P5=P25=中位=P75=21）
Exit     : TIME_EXIT 20 @ close（303 笔全部按时间退出）
Actual Holding Days = 21（均值 21.013）
Exit Reason = TIME_EXIT（303/303）
```

Entry / Holding / Exit 全程行情**均可由执行运行时取得**（事件窗 + Execution Overlay）。

## 8. Final Status

```text
BASELINE_VALID
```

含义重申：**执行链、退出语义、数据完整性已正确，结果可进入研究**；
不表示策略盈利，不表示 Robustness / OOS / WFA 通过。

遗留（不阻塞 baseline）：Test A/B/C 与 `barsForSecuritiesDateRange` 的定向单测（见 FIX-003 §9）。

---

## 附：REENTRY-BASELINE-002-FINALIZE 收尾状态

### 已补的回归测试（本轮）

```text
tests/server/research/simulator/executionOverlayRetention.test.ts  —— 4 例，全绿
  · Test B：exit 落在事件窗之外时，overlay 仍提供 entry → exit 的行情（含 +30 交易日边界）
  · 合并规则：事件窗行优先、overlay 只补缺失键、键唯一（duplicate key 合并且不丢失）
  · Test C 实质：真实日线缺失时 overlay **不造行** ⇒ SUSPENDED 语义保持正确（未全局关闭）
  · Scope：没有 positionIntent 时不做任何 overlay（身份集合只来自实际执行意图）
```

### 未完成的收尾项（如实登记）

| 项 | 状态 | 说明 |
|---|---|---|
| `candidateExitDisabled.test.ts` | 未补 | 需 plan/simulator 级 fixture；本轮预算耗尽 |
| `suspendedRegression603099.test.ts` | 未补 | 其**实质断言**已由上面的 Test C 用例 + Baseline 002 的 SUSPENDED 3/628 覆盖；缺独立文件 |
| `barsForSecuritiesDateRange` 单测 | 未补 | 仓库既有约定：DB 读写路径属 **ENVIRONMENTAL**（`tests/server/backtest/dbBarStore.test.ts` 头部明写「DB 读写路径属 ENVIRONMENTAL（需真实库），无库环境下跳过」）⇒ chunk 边界 / 日期过滤需真实库环境，未落地 |
| Trade Distribution（T+5/T+10/T+20、MAE/MFE、亏损尾部） | 未产出 | 需 trade 级 dump（当前 run 资产只留了计数与分位）⇒ 需补 `trades[]` 导出并重跑一次 |

### 真实性检查（§6）结论

```text
SUSPENDED SELL   = 3 / 628 = 0.48% （旧 13,897 = 95.8%）  ✅ 正常水平
holdingPeriod    = P5/P25/中位/P75 = 21/21/21/21           ✅ ≈ 20 交易日
TIME_EXIT        = 303 / 303 已平仓交易，Early Exit = 0    ✅ 主要退出原因
```

⇒ 满足 `BASELINE_VALID` 的三条真实性条件。

### Baseline 002 的定位（必须明确）

```text
Baseline 002 = 执行正确的第一版策略基准
不是 = 已验证有效 / 可实盘 / OOS 成功 / WFA 成功 / Robust
```
