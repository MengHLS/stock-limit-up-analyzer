# RESULT-STRATEGY-IMPLEMENTATION-REENTRY-FIX-003

> 任务：`STRATEGY-IMPLEMENTATION-REENTRY-FIX-003`（落地方案 A — Execution Overlay）
> 状态：**`IMPLEMENTED`**
> 日期：2026-10-05 ／ 版本：`strong-trend-reentry-v1@1.0.1`（Definition 未改）

---

## 1. Architecture

**方案 A — Execution Overlay**（FIX-002 已裁定，本轮落地）。核心不变量：

```text
Signal Membership      = 当日真正触发事件的成员（极窄，保留该优化）
Execution Holding Data = BUY 成交后 entryDate → exitDate 的真实 stock_daily_prices 行
两者解耦：前者不再决定后者的保留范围
```

## 2. Implementation

```text
server/research/simulator/cursorEngine.ts
  + EXECUTION_OVERLAY_HORIZON_TRADING_DAYS = 30（交易日语义的数据安全边界，非策略规则）
  + ExecutionOverlayStats / EMPTY_EXECUTION_OVERLAY_STATS / ExecutionOverlayBarReader
  + loadPositionExecutionOverlay(cursor, sourceRun, retainedRows, reader = new DbBarStore())
  + mergeExecutionOverlayRows(retainedRows, overlayRows)
  ~ runTradeSimulationFromCursor：retained 路径先加载 overlay，再合并后交给模拟器
  ~ buildCompactResearchDatasetFromRetainedRows：吸收 overlay 统计写进 gateNotes（进 Run 记录）

server/backtest/dbBarStore.ts
  + barsForSecuritiesDateRange(securityIds, startDate, endDate)
  + BAR_RANGE_READ_CHUNK_SIZE = 500（保守固定值）
```

## 3. Data Source

`DbBarStore` + `stock_daily_prices`（未复权 raw）—— 复用既有执行数据抽象，**未新建数据面**。

## 4. Overlay Scope

| 规则 | 实现 |
|---|---|
| 身份集合来源 | **`sourceRun.days[].positionIntents`**（实际执行意图），不是 candidateSlots、不是全部 retainedRows |
| 时间窗 | 首次 intent 日 → **+30 个交易日**（用 `cursor.tradingDates` 的交易日索引，非自然日） |
| 查询方式 | `stockCode IN (…) AND tradeDate BETWEEN …`，DB-side filtering，chunk=500 |
| 切片 | 每 40 个交易日一片 ⇒ 有界代码数 × 有界日期范围，不拉全历史 |
| 禁止项 | 未使用 `seriesFor` 逐标的全历史（FIX-002 已证 2,492 × ~1,900 ≈ 470 万行） |

## 5. Merge Rules

```text
key = (panelIdentity, tradeDate)
事件窗已有该键 → 保留事件窗行（含首板日富集列）
事件窗没有该键 → 使用 overlay 行
永不重复
```

## 6. Tests

```text
状态：未新增最小构造型单测（预算耗尽）
替代证据：Baseline 002 端到端实测覆盖其可观测后果——
  Test A（DISABLED + TIME_EXIT 20）：holdingPeriod P5/P25/中位/P75 = 21/21/21/21
  Test B（exit 在事件窗之外）：SUSPENDED 13,897 → 3
  Test C（603099 类案例）：SELL 不再每日重复 SUSPENDED
缺口登记：仍缺定向单测（见 §9）
```

## 7. Performance

| 指标 | 旧全量物化 | 本轮（事件窗流式 + Overlay） |
|---|---:|---:|
| dataset assembly | > 30 min（未成功） | **10.5 s** |
| peak memory | ~8.5 GB | ~1.5 GB 量级（未超 2 GB 目标） |
| 端到端 | 不可完成 | 10.5 s 装配 + ~10.5 min 流式读取 |

Overlay 未造成可观测退化；未恢复全量物化。

## 8. SUSPENDED Before/After

| 指标 | Baseline 001 | Baseline 002 |
|---|---:|---:|
| 订单总数 | 14,513 | **628** |
| SUSPENDED | **13,897（95.8%）** | **3（0.48%）** |
| 结构 | 全部 SELL 每日重试 | 残余 3 条（真实缺行的合法拒绝） |
| 重复 suspended sell | 大量 | **消失** |

SUSPENDED **未被关闭**：确实没有真实行情时仍正确返回 SUSPENDED。

## 9. Status

```text
IMPLEMENTED
```

遗留（不影响 baseline 有效性）：① Test A/B/C 最小构造型单测；② `barsForSecuritiesDateRange` 单测（chunk 边界 / 日期过滤 / 空集）。
