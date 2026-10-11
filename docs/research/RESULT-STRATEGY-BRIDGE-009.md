# RESULT-STRATEGY-BRIDGE-009 · 正式 Backtest **首次跑出结果** + 两项关键发现（**Goal round 8**）

> 🔴 **NON-PLATFORM-FORMAL-RUN**（真实 cursor + 真实引擎，但**尚未验收为正式 Run**）· **零数据库写入** · **零业务代码改动**
> Dataset **`780004`** · HEAD **`f8b6810`** · Goal round **8/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **`maxAmp5` Variant 的正式 Backtest【首次跑出结果】**                                                │
│                                                                                                      │
│   event-state-long-maxAmp5-top3 · 候选引擎 343.4s · 决策日 **1,636**                                  │
│   run: { trades: 4741, stats: { totalSignals: 9590, totalOrders: 9590, totalFills: 9476,             │
│          rejectedOrders: 114, partialFills: 0,                                                        │
│          byReason: { SUSPENDED: 99, NO_LIQUIDITY: 7, INSUFFICIENT_CASH: 5, OTHER: 3 } } }             │
│                                                                                                      │
│  🔴 **但发现两项关键问题（阻断验收）**：                                                                  │
│                                                                                                      │
│  ① **持仓期仅 3 天，而非 40 天** —— `holdingPeriod: 3` 且 `reason: "候选退出"`                              │
│     ⇒ 平台 simulator 在【掉出 Top3 候选】时自动平仓（`HOLD_WHILE_SELECTED` 语义）                          │
│     ⇒ 🔴 与研究口径「**固定持有 40 日，不因掉出候选而退出**」【不符】                                        │
│                                                                                                      │
│  ② **cursor 只能顺序读一次** —— `事件窗流式游标只支持顺序读取：请求 2019-01-03 早于已消费的 2025-09-26`      │
│     ⇒ 每个 Variant 必须**重新构造 cursor**（不能复用）                                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT

### 1.1 ✅ 装配链**首次完整跑通**（平台自身接线）

参照 `server/research/closedLoopWiring/executors.ts` L846/L849/L912（**平台自身的端到端接线**）：

```ts
if (cursor.restart !== undefined) await cursor.restart();                    // L846
candidateRun = await runCandidateEngineFromCursor({ cursor, config, strategy, strategy13 });  // L849
const tradeSimulationRun = await runTradeSimulationFromCursor({ cursor, sourceRun: candidateRun, simConfig });  // L912
```

| 阶段 | 实测 |
|---|---|
| **cursor 构造** | **5.9 s** · `eventCount 58,983` · `tradingDayCount 1,750` · **`maxRelativeDay 56`** · **TiDB 直读** |
| **候选引擎** | **343.4 s** · **决策日 1,636** |
| **交易模拟** | **4,741 笔** · 信号 9,590 · 成交 9,476 · 拒单 114（`SUSPENDED 99` / `NO_LIQUIDITY 7` / `INSUFFICIENT_CASH 5` / `OTHER 3`） |

### 1.2 🔴 问题 ①：持仓期 = 3 天（**非 40 天**）

交易样本（`maxAmp5` Variant，前 3 笔）：

| securityId（截断） | entryTime | exitTime | **holdingPeriod** | **reason** | returnPct |
|---|---|---|---:|---|---:|
| `…000056.SZ@2019-01-02` | 2019-01-24 | 2019-01-28 | **3** | **候选退出** | −0.609% |
| `…600605.SH@2019-01-02` | 2019-01-24 | 2019-01-28 | **3** | **候选退出** | −0.191% |
| `…000561.SZ@2019-01-03` | 2019-01-25 | 2019-01-29 | **3** | **候选退出** | −3.125% |

| 观察 | 说明 |
|---|---|
| **全部 `reason = "候选退出"`** | 掉出 Top3 即平仓 |
| `holdingPeriod = 3` | 远小于 40 |
| 与研究的差异 | 🔴 **研究口径 = `TIME_EXIT 40`，固定持有 40 交易日，不因掉出候选而退出** |

🔴 **根因**：平台存在 **`STRATEGY_CANDIDATE_EXIT_POLICIES`**（`strategySchema/definition.ts` L140 起，含 **`HOLD_WHILE_SELECTED`**）⇒ **缺省语义 = 掉出候选即退出** ⇒ 必须**显式声明「不因候选变化退出」**（或对应的固定持有语义）方能对齐研究口径。

### 1.3 🔴 问题 ②：cursor **只能顺序读一次**

```
FATAL: Error: 事件窗流式游标只支持顺序读取：请求 2019-01-03 早于已消费的 2025-09-26。
    at Object.getDaySlice (datasetFromRegistry.js:1325)
    at runCandidateEngineFromCursor (signalEngine/cursorEngine.js:62)
```

⇒ 第二个 Variant（`avgAmp5`）复用同一 cursor 时失败 ⇒ **每个 Variant 必须重新 `buildEventWindowDatasetCursorFromRegistry`**（构造仅 5.9 s，代价可接受）

---

## 2. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ❌ **两个 Variant 的正式 Backtest 尚未完成** —— `avgAmp5` 未跑；`maxAmp5` 因问题① **口径不符，结果不可用于验收** |
| **N2** | 🔴 **候选退出策略的正确配置**（如何声明「不因掉出候选而退出」以对齐研究的固定 40 日持有）—— **下一轮勘定** |
| **N3** | ⚠️ 端到端总耗时（cursor 5.9s + 候选引擎 343.4s + 模拟，单 Variant ≈ 6–7 分钟） |
| **N4** | ⚠️ 板价判定逐事件一致性（D2）· `EQUAL_WEIGHT`+180 逐笔等价 |
| **N5** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |
| **N6** | ⚠️ **D1 口径差异**（`TIME_EXIT` 成交于 rd56 `open`）须显式标注 |

---

## 3. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入**（只读 TiDB）· ✅ **未产出正式 Run / 未创建 Candidate / Strategy Version** · ✅ **未跑 OOS / WFA** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 新增文件仅 `scripts/_scratch/`（gitignore）

---

## 4. 下一步（**Goal 保持 active**）

```text
1. 勘定并修正【候选退出策略】（问题①）—— 对齐研究的「固定持有 40 日」
2. 每个 Variant 独立构造 cursor（问题②）
3. 两个 Variant 跑正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps）
   · D1 口径差异（rd56 open 成交）须显式标注
4. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**