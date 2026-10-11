# RESULT-STRATEGY-BRIDGE-005 · D1 裁定 + 正式 Backtest 数据路径勘定（**Goal round 4**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · **零业务代码改动** · Dataset **`780004`** · HEAD **`f8b6810`** · Goal round **4/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **D1 裁定完成**：`TIME_EXIT` 的成交时点由平台【定义为次日开盘】，**非可配置项**                        │
│     ⇒ **Variant 的出场口径必须改注为「rd55 close 触发 → rd56 open 成交」**                              │
│     ⇒ 🔴 **与研究的「rd55 close 出场」存在【1 个交易日】的确定差异**（不可消除）                            │
│                                                                                                      │
│  ✅ **正式 Backtest 数据路径勘定完成**                                                                  │
│     · 🔴 **直读桥不可行**：`REGISTRY_BRIDGE_MAX_ROWS = 1,600,000` < 780004 的 **10,320,499** 行        │
│     · ✅ **必须走 cursor 路径**：`createEventWindowDatasetCursor` ⇒ `runTradeSimulationFromCursor`      │
│     · ✅ **cursor 能精确表达本 Variant**：`observationWindow {15,15}` + `eventWindowVisibleBars(rd)`    │
│       ⇒ **rd15 决策 + rd0~15 可见**（与冻结因子窗口 rd11~15 自洽）                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. ✅ D1 裁定（`TIME_EXIT trigger:"ON_CLOSE"` 能否同日 close 成交？）

### 1.1 平台**自身文档**给出定义性答案

`server/research/simulator/types.ts` **L250**（`SimulationConfig.exitPolicy` 的字段说明，**原文**）：

```
* - TIME_EXIT：持有满 N 个交易日后的收盘触发，下一交易日开盘卖出。
```

> ## 🔴 **⇒ `TIME_EXIT` 的成交时点 = 【下一交易日开盘】—— 这是平台【定义】，不是可配置项**

### 1.2 本轮实测亦已独立确认（`BRIDGE-004` 场景 1）

| 观察 | 值 |
|---|---|
| 持仓满 2 日于 **06-03 收盘**触发 | 卖单 `tradeDate = 06-03` |
| 首次执行日 **06-04 跌停** | `status = REJECTED` / `rr = LIMIT_DOWN` |
| 次日重新发单 | 卖单 `tradeDate = 06-04` → `status = FILLED` |
| `Trade.exitTime` | **06-05**（= **成交日的次日**，因成交价取自该日开盘） |

⇒ **两条独立证据一致**：**触发在 close · 成交在 next open** ✓

### 1.3 🔴 对 Variant 的口径后果（**必须登记**）

| 项 | 研究口径 | 平台 `TIME_EXIT` | 差异 |
|---|---|---|---|
| 触发 | rd55 close | rd55 close | ✅ 一致 |
| **成交** | **rd55 close** | **rd56 `open`** | 🔴 **1 个交易日** |
| 持有长度 | rd16→rd55（40 日） | rd16→rd56（41 日） | 🔴 +1 日 |

**可配置性结论**：`exitPolicy` 的 `maxHoldingDays` / `timeExit.holdingDays` **只有这一个语义**；定义里的 `trigger: "ON_CLOSE"` 指的是**触发时点**（与 `INTRADAY` 相对），**不是成交时点** ⇒ 🔴 **无法通过参数改为同日 close 成交**

> ## 🛑 **⇒ 处置（本报告建议，下一轮执行）**：
> ## **(a)** **接受平台口径**（rd56 open 成交），在 Variant 与正式 Backtest 报告中**显式标注该 1 日差异**，**不得声称与研究的 F40 逐位等价**；
> ## **(b)** 该差异**完全可量化**（`close(rd55)` vs `open(rd56)` 的 1 日缺口），可在结果分析中单独分解。

---

## 2. ✅ 正式 Backtest 数据路径勘定

### 2.1 🔴 直读桥**不可行**（硬上限）

| 项 | 值 |
|---|---|
| `server/runWorkbenchAssembly/datasetFromRegistry.ts` L181 | **`REGISTRY_BRIDGE_MAX_ROWS = 1_600_000`** |
| Dataset **780004** 实际行数 | **10,320,499**（`event 58,983` + `prefix 647,287` + `post 4,718,640` + `path 4,718,640` + `outcome 176,949`） |
| 判定 | 🔴 **10.32M > 1.60M ⇒ `buildResearchDatasetFromRegistry` 路径【不可用】** |

### 2.2 ✅ cursor 路径（**唯一可行**）

```
server/runWorkbenchAssembly/datasetFromRegistry.ts
  ├─ buildEventWindowDatasetCursorFromRegistry   (L2067, async)   ← 从 registry 流式构造游标
  ├─ createEventWindowDatasetCursor              (L1783)          ← 纯函数游标
  └─ estimateEventWindowPanelRowsUpperBound      (L2026)          ← 事前行数估计
                ↓
  server/research/simulator/cursorEngine.ts#runTradeSimulationFromCursor({ cursor, sourceRun, simConfig })
```

### 2.3 ✅ cursor 能**精确表达本 Variant**（关键核对）

`EventWindowCursorOptions`（L1698-1718）：

| 字段 | 与本 Variant 的关系 |
|---|---|
| `observationWindow: ObservationWindowSpec` | 🔴 **= 前端策略文档的 `observationWindow`** ⇒ 本 Variant 为 **`{start:15, end:15}`** ⇒ **决策成员只出现在 rd15** ✓ |
| `decisionMemberPredicate?` | 缺省口径「rd ∈ [start, end] 即决策成员」⇒ **{15,15} ⇒ 仅 rd15** ✓ |
| `events` / `identityByEventId` / `tradingDates` | 装配层备妥 |

`eventWindowVisibleBars(member, relativeDay)`（L1750-1760）：

```ts
for (const [day, raw] of [...member.barsByRelativeDay.entries()].sort((a,b)=>a[0]-b[0])) {
  if (day > relativeDay) break;          // 🔴 只暴露 rd ≤ 决策日
  out.push(toCanonicalBar(raw, eventWindowPreClose(member, day)));
}
```

> ## ✅ **⇒ 决策日 rd15 时，可见 bar 恰为 rd0..15** ⇒ **与冻结因子窗口 rd11~15 自洽**，且 **PIT 合法**（无 rd16+）
> ## ✅ 且 `eventWindowPreClose(member, rd) = barsByRelativeDay.get(rd-1).close`（rd≥1）· rd0 用 `event.previousClose` ⇒ **与 `BRIDGE-001` §1.2 的链式前收口径一致**

### 2.4 ⚠️ 剩余装配前置（下一轮）

| # | 前置 | 状态 |
|---|---|---|
| 1 | `buildEventWindowDatasetCursorFromRegistry` 的完整入参（真实交易日序列含 warmup / 退出尾窗 · 身份桥接） | 待勘 |
| 2 | `runCandidateEngine` 是否有 **cursor 版**（现有签名取 `dataset: ResearchDataset`） | 待勘 |
| 3 | 退出尾窗：F40 需 **rd55**，cursor 的 `exitTail` / `poolAge` 扩展 | 待勘 |

---

## 3. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ❌ 两 Variant 的**任何绩效**（**仍未跑正式 Backtest**） |
| **N2** | ⚠️ cursor 路径的**完整装配可行性**（§2.4 三项前置待勘） |
| **N3** | ⚠️ `runCandidateEngine` 的 cursor 版是否存在（若无 ⇒ 需先物化或另寻入口） |
| **N4** | ⚠️ 数据集 `canSellAtClose` ↔ 引擎板价判定的**逐事件一致性**（`BRIDGE-004` D2） |
| **N5** | ⚠️ `EQUAL_WEIGHT` + `maxPositions=180` 是否逐笔等于研究 `w = 1/180` |
| **N6** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |

---

## 4. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入** · ✅ **未跑正式 Backtest / OOS / WFA** · ✅ **未创建 Candidate / Strategy Version** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ **本轮无新增文件**（仅只读检索）

---

## 5. 下一步（**Goal 保持 active**）

```text
1. 勘定 cursor 装配的剩余三项前置（BRIDGE-005 §2.4）
2. 两 Variant 跑正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps）
   · D1 口径差异（rd56 open 成交）须显式标注
3. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**