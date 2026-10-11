# RESULT-STRATEGY-BRIDGE-006 · cursor 装配三项前置勘定（**Goal round 5**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · **零业务代码改动** · HEAD **`f8b6810`** · Goal round **5/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ 前置 ① 请求契约：`{ datasetVersionId, name, observationWindow, dataReady, decisionMemberPredicate? }` │
│  ✅ 前置 ② 轻量 dataset：`buildEventWindowDatasetCursorFromRegistry` **同时返回 cursor 与**              │
│     `dataset: ResearchDataset`（文件头原文：「兼容装配摘要 / 策略定义的轻量数据集」）                      │
│     ⇒ **恰好喂给 `runCandidateEngine({ dataset, ... })`** ✓                                            │
│  🔴 前置 ③【真缺口】事件窗面板只投影 **rd=0 + rd ∈ [1, end+1]**；`exitTailTradingDays`                  │
│     **只属 `firstLimitPool`（池化）路径**（默认 **20** 日）⇒ **事件窗 cursor 不覆盖 F40 的 rd55**          │
│                                                                                                      │
│  ✅ **并提出【可行解法】（待验证）**：                                                                    │
│     `observationWindow = { start: 15, end: 55 }`（投影 rd0~rd56 ⇒ **rd55 可撮合**）                     │
│   + `decisionMemberPredicate = (m) => m.relativeDay === 15`（决策成员收敛 rd15 ⇒ **策略语义不变**）      │
│     —— 依据：`EventWindowCandidateMember` **暴露 `relativeDay: number`**（L1692）✓                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. ✅ 前置 ① · 请求契约（`BuildDatasetFromRegistryRequest`，L855-891）

| 字段 | 值（本 Variant） |
|---|---|
| `datasetVersionId` | **`780004`** |
| `name` | `event-state-long-maxamp5-top3` / `…-avgamp5-top3` |
| **`observationWindow`** | 🔴 **决定两件事**：**投影哪些行情**（`rd=0 + rd ∈ [1, end+1]`）· **哪些交易日具备「决策日资格」**（`rd ∈ [start, end]`） |
| `poolPolicy` | `null`（非池化） |
| `dateRange` | 仅池化路径用 ⇒ 不传 |
| `dataReady` | **`true`** |
| `decisionMemberPredicate?` | 🔴 **本 Variant 的关键解法入口**（见 §3） |

🔴 **未声明 `observationWindow` ⇒ 桥拒绝直读**（`REGISTRY_OBSERVATION_WINDOW_UNDECLARED`：「窗口是策略语义，桥无权代猜」）✓

---

## 2. ✅ 前置 ② · 轻量 dataset（**关键突破**）

`BuildEventWindowCursorFromRegistryResult`（L2043-2059）：

```ts
{
  cursor: EventWindowDatasetCursor;        // ← 流式逐日投影（真实行情按需读取）
  version: DatasetVersion;
  definition: DatasetDefinition;
  dataset: ResearchDataset;                // 🔴 文件头原文：「兼容装配摘要 / 策略定义的轻量数据集」
  securityIdByCode: ReadonlyMap<string, readonly string[]>;
  stats: { eventCount, tradingDayCount, datasetVersion, observationWindow, maxRelativeDay, contentSource };
}
```

> ## ✅ **⇒ 该函数一次调用同时产出 `cursor`（给 simulator）与轻量 `dataset`（给 `runCandidateEngine`）**
> ## **⇒ 前置 ②【已解决】：无需另找 `runCandidateEngine` 的 cursor 版**

**装配链（明确）**

```
buildEventWindowDatasetCursorFromRegistry({ datasetVersionId: 780004, observationWindow, dataReady: true })
        ├─ dataset  →  runCandidateEngine({ dataset, config, strategy, strategy13 })  →  CandidateEvaluationRun
        └─ cursor   →  runTradeSimulationFromCursor({ cursor, sourceRun, simConfig }) →  TradeSimulationRun
```

---

## 3. 🔴 前置 ③ · 真缺口：**事件窗面板不覆盖 F40 出场日**

### 3.1 缺口事实

| # | 事实 | 来源 |
|---|---|---|
| 1 | 投影范围 = **`rd=0 + rd ∈ [1, end+1]`** | `BuildDatasetFromRegistryRequest.observationWindow` 注释（L863） |
| 2 | 本 Variant 的 `observationWindow = {15,15}` ⇒ 仅投影 **rd0~rd16** | `RESULT-STRATEGY-BRIDGE-001` §2.1 |
| 3 | **F40 出场需 `rd55`** | 同上（`TIME_EXIT 40`） |
| 4 | 🔴 **`exitTailTradingDays` 只属 `firstLimitPool`**（`definition.ts` L606）⇒ **`FIRST_LIMIT_POOL` 触发路径专用**；默认 **`FIRST_LIMIT_POOL_DEFAULT_EXIT_TAIL_TRADING_DAYS = 20`**（`firstLimitPoolDailyScore.ts` L47） | `cursorEngine.ts` L394「cursor end 已按 poolAge + exitTail 扩展」**仅对池化路径成立** |

> ## 🔴 **⇒ 直接以 `{15,15}` 走事件窗 cursor：面板止于 rd16 ⇒ `rd55` 无可撮合 bar ⇒ 无法执行 F40 出场**

### 3.2 ✅ 提出的解法（**待验证**）

```ts
observationWindow: { start: 15, end: 55, unit: "TRADING_DAY" }   // 投影 rd0 ~ rd56 ⇒ rd55 可撮合
decisionMemberPredicate: (m) => m.relativeDay === 15             // 决策成员收敛到 rd15 ⇒ 策略语义不变
```

**依据**：`EventWindowCandidateMember`（L1686-1695）**暴露 `relativeDay: number`**（L1692）✓

| 效果 | 说明 |
|---|---|
| **投影** | `rd0 ~ rd56` ⇒ **F40 的 rd55 出场可撮合** ✓ |
| **决策成员** | 谓词收敛为 `relativeDay === 15` ⇒ **候选产生位置仍只在 rd15** ✓ |
| **因子可见性** | `eventWindowVisibleBars(member, 15)` ⇒ **rd0~15**（`BRIDGE-005` §2.3）⇒ **冻结窗口 rd11~15 自洽** ✓ |
| **策略文档** | `definition.entry.observationWindow` **仍为 `{15,15}`**（桥请求的窗口是**独立参数**）✓ |

⚠️ **待验证**：`decisionMemberPredicate` 是否**只影响「谁进决策集」而不影响 rows / executionBars / 面板身份**（L1714-1715 的注释如此声明，**但本轮未实测**）

---

## 4. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ❌ 两 Variant 的**任何绩效**（**仍未跑正式 Backtest**） |
| **N2** | 🔴 **§3.2 解法是否成立**（加宽 `end` + 谓词收敛 → 是否真正保持策略语义且让 rd55 可撮合）—— **本轮未实测** |
| **N3** | ⚠️ 事件窗 cursor 路径的**完整装配可行性**（身份桥接 / 交易日序列 / 快照 vs TiDB 直读） |
| **N4** | ⚠️ 数据集 `canSellAtClose` ↔ 引擎板价判定的逐事件一致性（`BRIDGE-004` D2） |
| **N5** | ⚠️ `EQUAL_WEIGHT` + `maxPositions=180` 是否逐笔等于 `w = 1/180` |
| **N6** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |

---

## 5. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入** · ✅ **未跑正式 Backtest / OOS / WFA** · ✅ **未创建 Candidate / Strategy Version** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ **本轮无新增文件**

---

## 6. 下一步（**Goal 保持 active**）

```text
1. 实测 §3.2 解法（加宽 observationWindow.end=55 + decisionMemberPredicate(relativeDay===15)）
2. 两 Variant 跑正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps）
   · D1 口径差异（rd56 open 成交）须显式标注
3. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**