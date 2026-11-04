# RESULT-STRATEGY-IMPLEMENTATION-REENTRY-FIX-002

> 任务：`STRATEGY-IMPLEMENTATION-REENTRY-FIX-002`
> 状态：**`BLOCKED`**（架构裁定完成；代码与测试未落地）
> 日期：2026-10-05
> 前置：`RESULT-STRATEGY-IMPLEMENTATION-REENTRY-FIX-001.md`

---

## 1. Architecture Decision（已完成）

### 1.1 裁定：**方案 A — Execution Overlay**

依据（实查代码）：

| 需要的能力 | 现有可复用件 | 结论 |
|---|---|---|
| 按 `(stockCode, tradeDate)` 取日线 | `server/backtest/dbBarStore.ts#DbBarStore`（`stock_daily_prices`，未复权 raw） | 可复用 |
| 单标的按需读取（不再全表物化） | `DbBarStore.seriesFor(securityId)`；源码注释：**「只按需拉单标的完整序列」**，从不 `select().from(stockDailyPrices)` 全表 | 可复用 |
| 或按日切片 | `HistoricalBarStore.barsForDate(date)` | 可复用 |
| 面板行 schema / PIT 不变量 | `ResearchDatasetRow` + `bindResearchDataset`（用 retained 行做 template） | 可复用 |

⇒ 方案 A **可在不破坏现有架构的前提下实现** ⇒ 按要求**选 A**。

方案 B（事件窗延长 rd>80）**事实上不可行**：`postRange.max = 80`，rd>80 该事件在 `ds_*` 里**根本没有行**。

### 1.2 语义边界（本任务核心不变量）

```text
Signal Membership      = 当日哪些 security 满足决策条件（已收敛为「事件成立成员」，保留该优化）
Execution Holding Data = BUY 成交后，该面板身份 entryDate → exitDate 的真实日线（stock_daily_prices）
两者解耦：前者可极窄，后者必须覆盖完整持仓生命周期。
```

## 2. Root Cause（已证实）

```text
event = 603099.SH@2023-09-18；事件窗 rd 0..80 ⇒ 最后一行 ≈ 2024-01-17
仓位在 rd≈79 建仓 ⇒ TIME_EXIT 20 的退出日 rd>80 ⇒ 事件窗内无该 (tradeDate, securityId) 行
⇒ SELL 判 SUSPENDED，且引擎次日重新计划卖出（不静默顺延）⇒ 每日一条 SUSPENDED
```

1 年窗口实测：`{ "sell:REJECTED": 687, "buy:REJECTED": 1 }` —— SUSPENDED 全部在 SELL 侧。

## 3. Implementation（未落地）

### 3.1 计划改动（文件级）

```text
1) server/research/simulator/cursorEngine.ts
   - 新增 loadPositionExecutionOverlay(cursor, sourceRun, retainedRows)
   - buildCompactResearchDatasetFromRetainedRows 内按 (tradeDate, securityId) 去重合并
     （事件窗行优先，overlay 只补事件窗缺失的日期）
2) server/backtest/dbBarStore.ts（可选）
   - 新增 chunked reader：stockCode IN (…) AND tradeDate BETWEEN …
     （满足「DB-side filtering / chunk reads」，避免 ~2,492 次单标的往返）
```

### 3.2 必须守住的三条界

```text
① 只对 positionIntents 出现过的面板身份做 overlay（不是全部候选）
② 每个身份只保留 [首次 intent 日, +30 交易日]（TIME_EXIT 20 足够覆盖）
③ 逐身份读取后立即切片、丢弃全序列 ⇒ 常驻 = 2,492 × ~30 ≈ 7.5 万行量级
```

### 3.3 为什么不能「seriesFor 全给」

`seriesFor` 返回单标的全历史（最多 ~1,900 根）；2,492 个身份 × 1,900 ≈ 470 万行 ⇒ 会重新撞上 ~8.5 GB / OOM 老路。**必须按 ② 切片。**

## 4. Tests（未落地）

```text
tests/server/research/simulator/candidateExitDisabled.test.ts       (Test A: DISABLED + TIME_EXIT 20)
tests/server/research/simulator/executionOverlayRetention.test.ts   (Test B: entry→holding→exit 行可得)
tests/server/research/simulator/suspendedRegression603099.test.ts   (Test C: 603099 案例不再每日 SUSPENDED)
```

## 5. Performance（现状基线；overlay 落地后需复测）

| 指标 | 全量物化（旧） | 事件窗流式（当前实测） | overlay 目标 |
|---|---:|---:|---:|
| dataset assembly | > 30 min（未成功） | **11.5 s** | ≤ ~15 s |
| peak memory | ~8.5 GB | **~1.5 GB** | ≤ ~2 GB |
| execution lookup | n/a | 窗外 → SUSPENDED | 窗外由 overlay 命中 |

若 overlay 明显退化：**先报告，不得扩大全量物化**（任务 §9）。

## 6. Strategy Version

保持 `strong-trend-reentry-v1.0.1`（`candidateExitPolicy=DISABLED`）。本任务属**数据面实现修复**，
不改 Strategy Definition、不动语义版本；已登记的 `candidateExitPolicy` legacy/Core versioning 缺口保持原样。

## 7. Status

```text
Architecture Decision → DONE（选方案 A；可复用 DbBarStore + stock_daily_prices）
Root Cause            → DONE（SELL 侧事件窗耗尽 + 每日重试，已实证）
Implementation        → NOT DONE
Tests                 → NOT DONE
Performance           → 未复测（overlay 未落地）
Baseline 002          → NOT PRODUCED
```

**最终状态：`BLOCKED`**

### 剩余工作量（按顺序）

1. 在 `cursorEngine.ts` 落地 `loadPositionExecutionOverlay` + 合并去重（含 §3.2 三条界）；
2. 补 Test A / B / C；
3. `pnpm run check` + `checkEolDrift --strict` + 相关 vitest；
4. 复测装配耗时 / 峰值内存 / 执行查找；
5. 重跑 Baseline 002（`strong-trend-reentry-v1@1.0.1` / `datasetVersionId=780001`）。
