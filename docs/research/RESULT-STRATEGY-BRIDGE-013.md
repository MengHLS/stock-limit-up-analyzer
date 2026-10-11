# RESULT-STRATEGY-BRIDGE-013 · `SUSPENDED` 修正（`end: 55 → 79`）（**Goal round 12**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · **零业务代码改动** · Dataset **`780004`** · HEAD **`f8b6810`** · Goal round **12/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **已应用 `BRIDGE-012` 的修正建议并【发起重跑】**                                                     │
│                                                                                                      │
│   `observationWindow: { start: 15, end: 55 → **79** }`                                                │
│   ⇒ `maxRd = endRd + 1 = **80**` = 数据集 `post.relativeDay` 上限                                     │
│   ⇒ 持仓（入场 rd16 + 持有 40 日 = 走到 rd56）+ 退出执行日（rd57）**全程有 execution bar**              │
│   ⇒ 预期 `SUSPENDED` 从 ~52% 降至可忽略                                                               │
│                                                                                                      │
│  🔴 **重跑结果本轮未回收**（后台进行中；单轮约 13–14 分钟）                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT

### 1.1 修正内容（harness 单点改动）

```ts
// 🔴 round 11 修正：end 55 → 79（maxRd = 80 = 数据集 post 上限）
//    原 end=55 ⇒ maxRd=56 ⇒ 持仓（入场 rd16 + 40 日）走到 rd56 恰在成员退休边界
//    ⇒ 无 execution bar ⇒ SUSPENDED 拒单 ~52%
observationWindow: { start: 15, end: 79, unit: "TRADING_DAY" },
```

### 1.2 依据（`BRIDGE-012` §1.4）

| # | 事实 | 来源 |
|---|---|---|
| 1 | cursor 成员在 `relativeDay >= maxRd` 后**退休** ⇒ 不再产出 bar | `datasetFromRegistry.ts` L1926 |
| 2 | `maxRd = endRd + 1` | 同 L1786-1788 |
| 3 | 原 `end = 55` ⇒ `maxRd = 56`；持仓入场 rd16 + 40 日 ⇒ 事件 rd 走到 **rd56**（**恰在边界**） | 实测 `holdingPeriod = 41` |
| 4 | 模拟器把「当日无 bar」判 `SUSPENDED`（拒单，不静默顺延） | `simulator/engine.ts` L733-747 |
| 5 | 数据集 `post.relativeDay` 上限 = **80** | 只读探针（多轮复核） |

⇒ **`end = 79` ⇒ `maxRd = 80`** ⇒ **恰好覆盖至数据集上限**，且**不超过**（避免越界）

### 1.3 未变更项（保持已验证的口径）

| 项 | 值 | 状态 |
|---|---|---|
| `decisionMemberPredicate` | `m.relativeDay === 15` | ✅ 决策仍在 rd15 |
| `positionSizing` | `{ FIXED_RATIO, fraction: 1/180, fixedAmount: null }` | ✅ `w = 1/180`（`BRIDGE-012` 实测确认） |
| `candidateExitPolicy` | `"DISABLED"` | ✅ `持满40个交易日`（`BRIDGE-012` 实测确认） |
| `exitPolicy` | `{ maxHoldingDays: 40 }` | ✅ |
| `cost` | 往返 20bps | ✅ |
| `maxPositions` | 180 | ✅ |

---

## 2. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ❌ **修正后的重跑结果未回收**（本轮后台进行中） |
| **N2** | 🔴 **`SUSPENDED` 是否真降至可忽略** —— §0 的预期**未验证** |
| **N3** | ❌ **两个 Variant 的正式 Backtest 未完成验收** |
| **N4** | ❌ **任何绩效结论**（仍未产出收益指标） |
| **N5** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |
| **N6** | ⚠️ **D1 口径差异**（`holdingPeriod = 41`，已实测确认）须在结果报告中显式标注 |

---

## 3. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入**（只读 TiDB）· ✅ **未产出正式 Run / 未创建 Candidate / Strategy Version** · ✅ **未跑 OOS / WFA** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 改动仅 `scripts/_scratch/`（gitignore）

---

## 4. 下一步（**Goal 保持 active**）

```text
1. 回收重跑结果，核对 SUSPENDED 是否降至可忽略（N2）
2. 产出两个 Variant 的正式 Backtest 结果（2019-01-03 ~ 2025-09-26 · 20bps · 标注 D1）
3. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**