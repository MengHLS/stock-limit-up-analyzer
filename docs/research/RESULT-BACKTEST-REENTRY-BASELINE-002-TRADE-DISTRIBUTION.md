# RESULT-BACKTEST-REENTRY-BASELINE-002-TRADE-DISTRIBUTION

> 任务：`BASELINE-002-TRADE-DISTRIBUTION-001`
> 状态：**`BASELINE_REPORT_COMPLETE`**
> 日期：2026-10-05
> 策略：`strong-trend-reentry-v1@1.0.1` ／ 数据集：`datasetVersionId=780001`
> 说明：Baseline 002 已经是**有效执行基准**；本轮只补齐**交易级可解释性**，未改动任何策略语义。

---

## 1. trades[] 导出

原 run 资产只有计数与分位 ⇒ 按 §10 最小范围扩展导出并复跑一次（同一 runId / experimentId，策略语义未变）：

```text
资产：scripts/_scratch/_reentry_baseline_002_trades.json
导出脚本：scripts/_scratch/_export_baseline_002_trades.mts
字段：securityId, code, entryDate, entryPrice, quantity, exitDate, exitPrice,
      holdingDays, exitReason, openAtEnd, grossReturn, netReturn,
      grossPnL, netPnL, fees, slippage,
      t5/t10/t20, mae5/mae10/mae20, mfe5/mfe10/mfe20, barsAfterEntry
```

（平台 `Trade` 本身已含 `entryTime/entryPrice/exitTime/exitPrice/quantity/grossPnL/netPnl/fees/slippageAmount/returnPct/holdingPeriod/reason` ⇒ 直接复用，未新增重复结构；`signalDate` 由研究层 `positionIntents` 与 entry 的 T+1 关系给出，见 §2。）

## 2. Holding Day 口径（不是 off-by-one bug）

实测（`exitReasonCounts` + `holdingDays`）：

```text
exitReasons = { "持有满20个交易日": 303, "回测结束仍持仓": 1 }
holdingDays = n=303, P5/P25/中位/P75/P95 = 21, min 21, max 23
```

口径结论（**不修改语义，只解释**）：

```text
平台 holdingPeriod = 从 entry 起**含 entry 当日**的交易日计数（inclusive）
Entry Date = Day 1 … Day 20 … Exit Date = Day 21
⇒「持有满 20 个交易日」= entry 之后再过 20 个交易日 ⇒ 含头计数 = 21
```

即：**不是**「entry 后的交易日数」（那个口径会显示 20），而是**含 entry 日的交易日数**（显示 21）。
两者描述的是同一件事：`TIME_EXIT 20 TRADING_DAY` 在 entry 后第 20 个交易日收盘退出。退出原因文案
「持有满20个交易日」与计数 21 自洽 ⇒ **无 off-by-one bug**，保持现有语义不动。

## 3. Trade Distribution

### 3.1 收益（n=304 / 净收益 n=303）

| 分位 | grossReturn | netReturn |
|---|---:|---:|
| P5 | -36.21% | **-37.09%** |
| P25 | -22.10% | -22.47% |
| Median | -10.05% | **-10.63%** |
| P75 | +3.71% | +3.56% |
| P95 | +39.21% | +40.07% |
| Mean | -6.63% | -7.06% |
| Min | **-64.80%** | -65.69% |
| Max | +89.77% | +89.64% |

### 3.2 MAE / MFE（**相对 `entryPrice`**，窗口 = entry 日**之后**的第 1..N 个交易日）

| 分位 | MAE5 | MAE10 | MAE20 | MFE5 | MFE10 | MFE20 |
|---|---:|---:|---:|---:|---:|---:|
| P5 | -26.5% | -32.9% | **-39.18%** | -6.4% | -5.1% | -5.1% |
| P25 | -14.0% | -23.7% | -28.35% | +1.6% | +3.0% | +6.4% |
| Median | -6.9% | -14.87% | -19.87% | +8.97% | +11.28% | +13.80% |
| P75 | -3.2% | -8.4% | -12.37% | +17.0% | +21.5% | +26.2% |
| P95 | +0.4% | +3.0% | +0.6% | +32.0% | +49.7% | +64.2% |
| Mean | -9.8% | -15.61% | -20.15% | +10.5% | +14.8% | +19.4% |
| Worst | — | — | **-66.58%** | — | — | — |
| Max | — | — | — | — | — | **+157.37%** |

口径声明：MAE/MFE **一律相对 `entryPrice` 成交价**，不使用 entry-day reference（开盘/收盘）混算。

### 3.3 盈亏结构

| 项 | 值 |
|---|---:|
| 盈利交易 | 89 |
| 亏损交易 | 214 |
| 0 收益交易 | 1 |
| 盈利比例 | 29.28% |
| 总费用（commission+stampDuty+transferFee） | 4,485.45 |
| 总滑点 | 1,136.61 |
| 最大单笔盈利 | +89.64%（净） |
| 最大单笔亏损 | -65.69%（净） |

### 3.4 Tail

```text
T+20 P5 = -35.14%      T+20 Worst = -66.58%
MAE20 P5 = -39.18%     MAE20 Worst = -66.58%
```

### 3.5 T+5 / T+10 / T+20（相对 entryPrice）

| 分位 | T+5 | T+10 | T+20 |
|---|---:|---:|---:|
| P5 | -23.38% | -29.46% | -35.14% |
| Median | -3.87% | -6.23% | -9.94% |
| P95 | +22.67% | +39.51% | +41.20% |
| Mean | -2.95% | -3.62% | -5.97% |

## 4. Exit Reason

| 退出原因 | 数量 |
|---|---:|
| **持有满20个交易日（TIME_EXIT）** | **303** |
| 回测结束仍持仓（OPEN_END） | 1 |
| STOP / TAKE_PROFIT / TREND / STRONG_HOLD | **0** |

⇒ V1 的退出**全部**来自 TIME_EXIT（唯一例外是期末未到期的那 1 笔），符合预期。

## 5. 研究 vs 回测逐项归因

| 维度 | RESULT-PRE-STRATEGY-REENTRY-001 | Baseline 002 |
|---|---|---|
| SIGNAL | 547 | candidateSlots 2,492 → 实际 orders 628 |
| EXECUTABLE | 545 | — |
| FILLED | 513 | **607** |
| rejected | 34 | **21** |
| SUSPENDED | 2（不可执行） | **3（0.48%）** |

- **Entry**：研究用 `RECLAIM+1 Open` 理论价；回测用实际 Filled 价（含滑点）。607 vs 513 的差异主要来自
  **事件级身份**（2,492 个触发成员）+ 同一证券多事件的独立成交，而研究侧是 547 个事件信号。
- **Exit**：研究是「T\* 锚点 + 固定 T+20 观测」；回测是「entry 后第 20 个交易日收盘 TIME_EXIT」。
  两者都锚在 20 个交易日，**不要求逐笔相等**（entry 锚点一个是 T\*、一个是 RECLAIM+1 Open）；
  §2 已证明 `holdingPeriod=21` 是**含头计数**，不构成 +1 偏差。
- **Duplicate Signal**：研究侧给出 event-level / stock-dedup(260) / non-overlap(280) 三套；
  回测是 Portfolio 逐面板身份单仓 + 未平仓期间忽略新信号。本轮 `sameSecuritySuppressed = 0`
  （面板身份是事件级 `sec::event:<id>`，同股不同事件不互相抑制）⇒ 该维度在 V1 下**不构成差异来源**，
  但也意味着回测**未实现**研究侧的 stock-dedup 口径。
- **Costs**：研究无成本/无滑点；回测计入 commission + stampDuty + transferFee + slippage。
  实测总计 **费用 4,485.45 + 滑点 1,136.61**；净收益均值比毛收益低 **0.43pp**（-7.06% vs -6.63%）。
- **Execution**：研究用自建 OHLC 规则给 `SIGNAL_FILLED`；回测用平台执行政策
  （开盘涨停 LIMIT_UP 11、停牌/缺行 SUSPENDED 3、跌停 LIMIT_DOWN 2、NO_LIQUIDITY 1、OTHER 1、现金不足 3）。

## 6. 组合级结果（canonical：Baseline 002 Run Record）

| 项 | 值 |
|---|---:|
| Initial Capital | 100,000 |
| Final Equity | **951.32** |
| Gross Return / Net Return | -99.05%（净；毛收益未单独出具 canonical 口径） |
| Max Drawdown | **-99.31%** |
| Trade Count | 304（已平 303 / 期末 1） |
| Exposure（平均仓位） | 0.656 |
| Average Position（平均并发） | —（平台未定义该 canonical 指标） |
| Max Concurrent Positions | 15 |

## 7. 最终状态

```text
BASELINE_REPORT_COMPLETE
```

Baseline 002 = **执行正确的第一版策略基准**；**不是**已验证有效 / 可实盘 / OOS 成功 / WFA 成功 / Robust。
本轮未做任何优化（无参数搜索 / 无 Exit 优化 / 无止损止盈 / 无 TopN / 无过滤 / 无 OOS / 无 WFA / 无 Robustness）。

### 遗留（如实登记）

| 项 | 状态 |
|---|---|
| §8 `tests/server/research/simulator/candidateExitDisabled.test.ts` | 未落地（预算耗尽） |
| §8 `tests/server/research/simulator/suspendedRegression603099.test.ts` | 未落地（其**实质断言**已由 `executionOverlayRetention.test.ts` 的 Test C 用例 + 本轮 SUSPENDED 3/628 覆盖，但缺独立文件） |
| §9 `barsForSecuritiesDateRange` 的 DB 路径测试 | **environmental validation gap**：按仓库既有约定（`tests/server/backtest/dbBarStore.test.ts` 头部「DB 读写路径属 ENVIRONMENTAL，需真实库」）不伪造 mock；实现逻辑已按 §9 逐项人工核对（chunk = 500 循环 / `gte+lte` 日期范围 / `inArray` security filter / 空集合提前 return） |
| `Average Position` | 平台未定义该 canonical 指标，未自造 |
