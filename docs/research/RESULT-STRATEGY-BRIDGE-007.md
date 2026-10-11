# RESULT-STRATEGY-BRIDGE-007 · N2 解除：cursor 解法**逐行验证**（**Goal round 6**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · **零业务代码改动** · HEAD **`f8b6810`** · Goal round **6/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **N2 解除**（`BRIDGE-006` §3.2 的解法经【逐行代码验证】成立）                                          │
│                                                                                                      │
│  ① `startRd = max(0, window.start)` · `endRd = window.end` · **`maxRd = endRd + 1`**  (L1786-1788)   │
│     ⇒ `{start:15, end:55}` ⇒ 覆盖 **rd0 ~ rd56** ⇒ ✅ **F40 的 rd55 出场可撮合**                        │
│                                                                                                      │
│  ② `decisionMemberPredicate` **只**影响三处（L1905-1925）：                                            │
│     · `members`（决策集）· `visibleBars`（决策可见 bar）· `suppressedNonTriggerMembers`（计数）          │
│     🔴 **`rows` 与 `executionBars` 【无条件产出】**（L1898-1904，在谓词判断【之前】）                     │
│     ⇒ ✅ **面板身份 / rd 口径 / 撮合可行性【均不受谓词影响】**                                            │
│                                                                                                      │
│  📌 **⇒ 正式 Backtest 的【唯一剩余项】= 实际执行那一次运行**                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT · 逐行证据

### 1.1 rd 边界推导（`datasetFromRegistry.ts` L1786-1788）

```ts
const startRd = Math.max(0, options.observationWindow.start);
const endRd   = options.observationWindow.end;
const maxRd   = endRd + 1;
```

| 配置 | `startRd` | `endRd` | `maxRd` | 面板/撮合覆盖 | 决策成员资格 |
|---|---:|---:|---:|---|---|
| 原 `{15,15}` | 15 | 15 | **16** | 🔴 **rd0~rd16** ⇒ **rd55 缺席** | rd15 |
| **解法 `{15,55}`** | 15 | **55** | **56** | ✅ **rd0~rd56** ⇒ **rd55 可撮合** | 由谓词收敛 |

### 1.2 谓词的**精确作用域**（`datasetFromRegistry.ts` L1894-1927，原文骨架）

```ts
for (const member of active.values()) {
  const bar = member.barsByDate.get(tradeDate);
  if (bar === undefined) continue;
  const relativeDay = bar.relativeDay;
  const row = eventWindowRowOf(member, bar, tradeDate);
  rows.push(row);                              // 🔴 无条件产出（谓词判断【之前】）
  recordRetainedRow(row);                      // 🔴 无条件留存
  executionBars.set(                           // 🔴 无条件产出（谓词判断【之前】）
    member.panelSecurityId,
    toCanonicalBar(bar, eventWindowPreClose(member, relativeDay)),
  );
  if (relativeDay >= startRd && relativeDay <= endRd) {
    const visible = eventWindowVisibleBars(member, relativeDay);
    const isDecisionMember =
      options.decisionMemberPredicate === undefined
        ? true
        : options.decisionMemberPredicate({ eventId, symbol, panelSecurityId,
            canonicalSecurityId, tradeDate, relativeDay, bars: visible });
    if (isDecisionMember) {
      members.add(member.panelSecurityId);         // ← 只影响决策集
      visibleBars.set(member.panelSecurityId, visible);
    } else {
      suppressedNonTriggerMembers += 1;            // ← 只计数
    }
  }
  if (relativeDay >= maxRd) finished.push(member.panelSecurityId);   // ← 生命周期由 maxRd 决定
}
```

> ## ✅ **⇒ 谓词【不触碰】`rows` / `executionBars` / 面板身份 / rd 口径** —— 与 L1714-1715 的注释声明**逐字一致**

### 1.3 解法清单（**经逐行验证**）

```ts
observationWindow: { start: 15, end: 55, unit: "TRADING_DAY" }   // startRd=15 · endRd=55 · maxRd=56
decisionMemberPredicate: (m) => m.relativeDay === 15             // 决策成员收敛 rd15
```

| 效果 | 状态 |
|---|:---:|
| 面板/撮合覆盖 **rd0~rd56** ⇒ **F40 的 rd55 出场可撮合** | ✅ 验证 |
| **决策成员仍只在 rd15** | ✅ 验证 |
| **`rows` / `executionBars` 不受影响**（面板身份 / rd 口径不变） | ✅ 验证 |
| 因子可见性 `eventWindowVisibleBars(member, 15)` = **rd0~15**（与冻结窗口 rd11~15 自洽） | ✅ 验证 |
| 策略文档的 `definition.entry.observationWindow` 仍为 `{15,15}`（桥请求窗口是独立参数） | ✅ 验证 |
| 成员生命周期至 `maxRd = 56`（覆盖 rd55） | ✅ 验证 |

---

## 2. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ❌ **两个 Variant 的正式 Backtest 尚未执行** ⇒ **无任何绩效数据** |
| **N3** | ⚠️ 事件窗 cursor 路径的**端到端装配**（身份桥接 · 真实交易日序列 · 快照 vs TiDB 直读的实际可用性）—— **代码层面已勘定，未实跑** |
| **N4** | ⚠️ 数据集 `canSellAtClose` ↔ 引擎板价判定的逐事件一致性（`BRIDGE-004` D2） |
| **N5** | ⚠️ `EQUAL_WEIGHT` + `maxPositions=180` 是否逐笔等于研究 `w = 1/180` |
| **N6** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |
| **N7** | ⚠️ **D1 口径差异**（`TIME_EXIT` 成交于 rd56 `open`，非 rd55 close）须在回测报告中显式标注 |

---

## 3. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入** · ✅ **未跑正式 Backtest / OOS / WFA** · ✅ **未创建 Candidate / Strategy Version** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ **本轮无新增文件**

---

## 4. 现状与下一步（**Goal 保持 active**）

### 4.1 目标完成度

| 目标项 | 状态 |
|---|:---:|
| 创建两个 Draft Strategy Variant | ✅ **定义就绪**（`BRIDGE-002`；**尚未落库**） |
| **R1**（`validateCanonicalStrategyDefinition` 实跑） | ✅ **解除**（2/2 Variant，0 issues） |
| **R2**（平台 20bps ≡ 研究口径） | ✅ **解除**（实算往返 **20.000000** bps，12/12 断言） |
| **R3**（rd55 → 顺延 → rd80 fallback 小范围核对） | ✅ **解除**（`BRIDGE-004` 平台真实 simulator 实测） |
| **两个 Variant 跑正式 Backtest** | ⬜ **未执行** —— **唯一剩余项** |
| 据结果决定是否进入 OOS/WFA | ⬜ 依赖上一项 |

### 4.2 唯一剩余项的前置（**均已勘定**）

| 前置 | 状态 |
|---|:---:|
| 回测引擎 = `runTradeSimulationFromCursor`（`research/simulator`） | ✅ |
| 数据路径 = event-window cursor（直读桥因 1.6M 行上限不可用） | ✅ |
| 请求契约 = `{datasetVersionId: 780004, observationWindow, dataReady: true, decisionMemberPredicate}` | ✅ |
| 轻量 `dataset` 与 `cursor` 同源产出（喂 `runCandidateEngine` / simulator） | ✅ |
| **F40 出场日可撮合**（`{15,55}` + 谓词收敛 rd15） | ✅ **本轮逐行验证** |
| 成本口径（往返 20bps） | ✅ |
| 出场时点口径差异（D1：rd56 open） | ⚠️ **须在报告中显式标注** |

```text
下一步 = 实际执行两个 Variant 的正式 Backtest
         （2019-01-03 ~ 2025-09-26 · 20bps · 标注 D1 口径差异）
```

**本轮在此停止，Goal 继续。**