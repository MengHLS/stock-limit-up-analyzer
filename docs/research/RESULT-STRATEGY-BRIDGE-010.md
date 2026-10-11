# RESULT-STRATEGY-BRIDGE-010 · 候选退出修正成功 + 两项口径不符暴露（**Goal round 9**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入**（只读 TiDB）· **零业务代码改动** · Dataset **`780004`** · HEAD **`f8b6810`** · Goal round **9/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **问题① 修正成功**：`simConfig.candidateExitPolicy = "DISABLED"`                                    │
│     ⇒ 交易 `holdingPeriod: 41` · `reason: "持有满40个交易日"` ⇒ **对齐研究固定 40 日持有** ✓              │
│                                                                                                      │
│  🔴 **但暴露两项【仓位/可执行性口径不符】（阻断验收）**：                                                  │
│     ① **仓位口径**：平台 `EQUAL_WEIGHT` 按【当日候选数(3)】均分 ⇒ `w ≈ 1/3`；研究口径 = **`w = 1/180`**     │
│        证据：首笔 `000056.SZ` qty **70,100** × 4.7731 ≈ **334,400 元** ≈ 1M/3（而非 1M/180 = 5,555）        │
│     ② **`SUSPENDED` 拒单 2,524 / 4,659 = 54%**（`totalFills` 仅 2,130）                                  │
│        疑似：cursor 在成员 `relativeDay >= maxRd(56)` 后【退休】⇒ 持仓无 execution bar ⇒ 被判停牌         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT

### 1.1 ✅ 候选退出修正（解法 + 证据）

**解法**（`server/research/simulator/engine.ts` L259/L491 · `plan.ts` L6-7）：
```ts
candidateExitPolicy: config.candidateExitPolicy ?? "HOLD_WHILE_SELECTED"   // 缺省 = 掉出候选即平仓
// 显式 "DISABLED" ⇒ 候选集合【不参与卖出】
```
**先例**：`firstLimitPullback3FTopN.ts` L62 · `threeFactorTopNStrategy.ts` L653/L708 均用 `"DISABLED"` ✓

**实测（修正前 vs 修正后）**

| 项 | 修正前 | **修正后** |
|---|---|---|
| `reason` | `候选退出` | ✅ **`持有满40个交易日`** |
| `holdingPeriod` | **3** | ✅ **41** |
| 交易样本 | −0.609% / −0.191% / −3.125% | **+21.57% / +16.10% / +15.16% / +38.75%**（2019-01~03 段） |

### 1.2 🔴 仓位口径不符（**首次实测确认**）

| 项 | 研究口径 | 平台实测 |
|---|---|---|
| 单笔权重 | **`w = 1/MAX_CONC = 1/180`**（恒定） | 🔴 **`≈ 1/3`**（按当日候选数均分） |
| 证据 | — | 首笔 `000056.SZ` qty **70,100** × `entryPrice 4.7731` ≈ **334,400 元** ≈ `1,000,000 / 3` |

⇒ 🔴 **`maxPositions: 180` 未产生 `1/180` 的单笔预算**；平台 `EQUAL_WEIGHT_CASH_BUDGET` 的分母 = **当日候选/desired 数量**（Top3 ⇒ 3）⇒ **`w ≈ 1/3`**
⇒ **这正是 `BRIDGE-004/005` 登记的 N5（`EQUAL_WEIGHT`+180 是否逐笔等于 `w=1/180`）—— 现答案：❌ 不等**

### 1.3 🔴 `SUSPENDED` 拒单 54%

```
totalSignals 4,659 · totalOrders 4,659 · totalFills 2,130 · rejectedOrders 2,529
byReason: { SUSPENDED: 2,524, NO_LIQUIDITY: 3, INSUFFICIENT_CASH: 2 }
```

**疑似根因**：cursor 在成员 `relativeDay >= maxRd (=56)` 后 **retire**（`datasetFromRegistry.ts` L1926 `if (relativeDay >= maxRd) finished.push(...)`）⇒ 该证券**不再产出 execution bar** ⇒ 模拟器按「无 bar = 停牌」判 `SUSPENDED` ⇒ **持仓无法卖出**
⚠️ **该根因【未逐条取证】**（本轮未展开）

---

## 2. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ❌ **两个 Variant 的正式 Backtest 未完成验收** —— `maxAmp5` 已跑但**仓位口径不符**；`avgAmp5` 本轮仍在运行 |
| **N2** | 🔴 **仓位口径的修正方式**（如何让平台表达 `w = 1/180` 恒定权重）—— **下一轮勘定** |
| **N3** | 🔴 **`SUSPENDED 54%` 的根因**（cursor 退休 vs 真实停牌）—— **未取证** |
| **N4** | ⚠️ 板价判定逐事件一致性（D2） |
| **N5** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |
| **N6** | ⚠️ **D1 口径差异**（`TIME_EXIT` 成交于 rd56 `open`）须显式标注 |

---

## 3. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入**（只读 TiDB）· ✅ **未产出正式 Run / 未创建 Candidate / Strategy Version** · ✅ **未跑 OOS / WFA** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 改动仅 `scripts/_scratch/`（gitignore）

---

## 4. 下一步（**Goal 保持 active**）

```text
1. 勘定仓位口径修正（让平台表达 w = 1/180 恒定权重）
2. 勘定 SUSPENDED 54% 的根因（cursor 退休边界 vs 真实停牌）
3. 两个 Variant 跑正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps · 标注 D1）
4. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**