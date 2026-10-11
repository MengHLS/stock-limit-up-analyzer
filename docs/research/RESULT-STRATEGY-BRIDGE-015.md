# RESULT-STRATEGY-BRIDGE-015 · `SUSPENDED` 真实严重性度量（聚合口径）（**Goal round 14**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · **零业务代码改动** · Dataset **`780004`** · HEAD **`f8b6810`** · Goal round **14/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **已把输出改为【聚合口径】**（`BRIDGE-014` N2 的解法）：                                              │
│     · `stuck` = `exitTime === null` ∨ `exitTime === END` ∨ `reason` 含「回测结束」的持仓数                 │
│     · `byReason` / `byEntryYr` / `byExitYr` / `stuckYr`                                               │
│     · `holdAvg/Min/Max` · `winRate` · `retAvg`                                                        │
│                                                                                                      │
│  🔴 **本轮未回收结果**（后台进行中；cursor 13.9s 已完成，候选引擎约 8 分钟/Variant）                       │
│                                                                                                      │
│  📌 **本轮同时【再次确认】`end=79` 已生效**：`maxRelativeDay = 80` · `tradingDayCount = 1798`           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT

### 1.1 度量口径的设计（为什么必须改）

`BRIDGE-014` §1.3 确立：**`SUSPENDED` 是重试放大的计数**（退出条件 `holdingDays >= 40` 每日恒真 ⇒ 每日重发）⇒ **不能读作失败率**。

⇒ **正确指标 = 受影响的不同持仓数**（`stuck`）+ **其入场年份分布**（验证 `BRIDGE-014` §1.4 候选 A「数据集末端效应」）

### 1.2 harness 改动（聚合输出）

```ts
const tr = (s.trades ?? []) as readonly Record<string, unknown>[];
const byReason = {}, byEntryYear = {}, byExitYear = {}, stuckByEntryYear = {};
let openAtEnd = 0, stuck = 0;
for (const t of tr) {
  const r = String(t.reason ?? "?");
  byReason[r] = (byReason[r] ?? 0) + 1;
  const ey = String(t.entryTime ?? "?").slice(0, 4);
  byEntryYear[ey] = (byEntryYear[ey] ?? 0) + 1;
  const xy = t.exitTime === null ? "NULL" : String(t.exitTime).slice(0, 4);
  byExitYear[xy] = (byExitYear[xy] ?? 0) + 1;
  if (t.openAtEnd === true) openAtEnd += 1;
  if (t.exitTime === null || String(t.exitTime) === lastDate || r.includes("回测结束")) {
    stuck += 1; stuckByEntryYear[ey] = (stuckByEntryYear[ey] ?? 0) + 1;
  }
}
// + holdAvg/Min/Max · winRate · retAvg
```

### 1.3 本轮已回收的部分

```
[env] 已注入 10 个变量（DATABASE_URL 存在=true）
=== Variant 正式 Backtest · cursor 路径 ===
  datasetVersionId = 780004 · 区间 2019-01-03 ~ 2025-09-26
  [cursor] 构造完成 13.9s
  stats: { eventCount: 58983, tradingDayCount: 1798,
           datasetVersion: "rd-1.0.0-1-22ec1ba1cc7bca39",
           observationWindow: { start: 15, end: 79, unit: "TRADING_DAY" },
           maxRelativeDay: 80, contentSource: "TiDB 直读" }
  轻量 dataset: rows=0 · gate=PASS · version=rd-1.0.0-1-22ec1ba1cc7bca39
```

✅ **`maxRelativeDay = 80` · `tradingDayCount = 1798`** ⇒ **`BRIDGE-013` 的 `end: 55 → 79` 修正稳定生效**

---

## 2. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | 🔴 **`stuck`（受影响持仓数）的实际值** —— **本轮未回收** |
| **N2** | 🔴 **`SUSPENDED` 根因**（`BRIDGE-014` §1.4 候选 A「数据集末端效应」/ B 真实停牌 / D 身份映射）—— **均未取证** |
| **N3** | ❌ **两个 Variant 的正式 Backtest 未完成验收** |
| **N4** | ❌ **任何绩效结论**（`winRate` / `retAvg` 虽将产出，但 **`w = 1/180` 下的组合级收益尚未计算**） |
| **N5** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |
| **N6** | ⚠️ **D1 口径差异**（`holdingPeriod = 41`，已实测确认）须在结果报告中显式标注 |

---

## 3. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入**（只读 TiDB）· ✅ **未产出正式 Run / 未创建 Candidate / Strategy Version** · ✅ **未跑 OOS / WFA** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 改动仅 `scripts/_scratch/`（gitignore）

---

## 4. 下一步（**Goal 保持 active**）

```text
1. 回收聚合结果：读出 stuck / byEntryYr / stuckYr ⇒ 判定 SUSPENDED 的真实严重性
2. 依 stuckYr 分布取证根因（若集中于 2025 ⇒ 末端效应坐实）
3. 两个 Variant 完成正式 Backtest 并产出组合级结果（标注 D1）
4. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**