# RESULT-STRATEGY-BRIDGE-017 · 组合级结果产出（**Goal round 16**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · **零业务代码改动** · Dataset **`780004`** · HEAD **`f8b6810`** · Goal round **16/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **已把 harness 输出扩展到【组合级】**（`BRIDGE-016` N3 的解法）：                                     │
│     · `RUN_KEYS`（`TradeSimulationRun` 的顶层字段清单）                                                 │
│     · `equityCurve` 长度 / 首末点 / 字段名                                                             │
│     · **按年收益（B 口径：`eq[last of y] / eq[last of y−1] − 1`）**                                    │
│     · **总收益 + MDD**（基于 `equityCurve`）                                                           │
│                                                                                                      │
│  🔴 **本轮未回收结果**（后台进行中；两个 Variant 合计约 22 分钟）                                          │
│                                                                                                      │
│  📌 前置已全部就绪：`SUSPENDED` 判定为非问题（2.64%/2.69%）· 三项口径修正全部实测通过                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT

### 1.1 为什么必须做组合级

`BRIDGE-016` 确立：**`retAvg = 1.97% / 1.62%` 是【单笔算术平均】，不是组合收益**。

研究口径的资本模型（`FACTOR-TIMESCALE-FINAL-001` 冻结）：
```
MAX_CONC = ceil(1.5 × TOPN × F) = 180     w = 1/MAX_CONC = 1/180（恒定，永不重算）
每日先出后进 · 满仓则跳过 · 已持有则跳过 · 不可成交则跳过 · 退出顺延至 rd80
```
⇒ **组合收益必须由 `equityCurve` 复利读出**，不能用单笔平均 × 笔数

### 1.2 harness 改动（组合级输出）

```ts
const keys = Object.keys(s).filter(k => !["trades","positions","audit"].includes(k));
console.log("  RUN_KEYS  : " + keys.join(","));
const eq = s.equityCurve ?? [];
console.log("  equityCurve len=" + eq.length + " calendarDays=" + days.length);
// 按年（B 口径：eq[last of y] / eq[last of y−1] − 1）
const byYear = new Map();  for (const p of eq) byYear.set(String(p.date).slice(0,4), p);
for (let i = 0; i < yrs.length; i++) {
  const cur  = byYear.get(yrs[i]).equity;
  const prev = i === 0 ? 1_000_000 : byYear.get(yrs[i-1]).equity;
  out.push(yrs[i] + ":" + ((cur/prev - 1)*100).toFixed(2) + "%");
}
// 总收益 + MDD
TOTAL = (last.equity / 1_000_000 - 1) * 100 ;  MDD = min over curve of (v / runningPeak − 1)
```

🔴 **口径纪律**：年度收益一律用 **(B) 严格口径** `eq[last of y] / eq[last of y−1] − 1`（**不是** (A) harness 的 `eq[last of y]/eq[first of y] − 1`，后者遗漏首日 P&L、有 +0.34%~+1.40% 的水平偏差）

### 1.3 已就绪的前置（本轮不变）

| 项 | 值 | 状态 |
|---|---|---|
| 数据路径 | event-window cursor · `{start:15, end:79}` · `maxRelativeDay = 80` | ✅ |
| 决策日 | `decisionMemberPredicate: relativeDay === 15` | ✅ |
| 仓位 | `positionSizing: FIXED_RATIO × 1/180` | ✅ 实测 |
| 候选退出 | `candidateExitPolicy: "DISABLED"` | ✅ 实测（97.4% `持有满40个交易日`） |
| 成本 | 往返 **20.000000** bps | ✅ 实测（`BRIDGE-002`） |
| 超出 | `SUSPENDED` 真实影响 **2.64% / 2.69%**（数据集末端） | ✅ 判定为非问题 |
| 两 Variant | `maxAmp5` trades 4,766 · `avgAmp5` 4,793 | ✅ |

---

## 2. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | 🔴 **组合级结果（资金曲线 / 年度收益 / MDD / 总收益）** —— **本轮未回收** |
| **N2** | ⚠️ **`holdMin = 0` 的成因**（未查） |
| **N3** | ⚠️ 板价判定逐事件一致性（`BRIDGE-004` D2）· 与 harness 的逐笔等价性 |
| **N4** | ❌ OOS / WFA / 冲击成本 |
| **N5** | ⚠️ **D1 口径差异**（`holdAvg = 39.95` 实测确认 40 日持有 + 次日开盘成交）须在结果中显式标注 |
| **N6** | ⚠️ 末端 **2.64% / 2.69%** 未平仓持仓的处置口径（研究有 rd80 兜底）须在结果中显式标注 |

---

## 3. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入**（只读 TiDB）· ✅ **未产出正式 Run / 未创建 Candidate / Strategy Version** · ✅ **未跑 OOS / WFA** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 改动仅 `scripts/_scratch/`（gitignore）

---

## 4. 下一步（**Goal 保持 active**）

```text
1. 回收组合级结果（N1）并按 (B) 口径核对年度收益
2. 据两 Variant 的组合级结果，决定是否进入 OOS / WFA
   · 须显式标注 D1（出场时点）与末端未平仓处置
```

**本轮在此停止，Goal 继续。**