# RESULT-STRATEGY-BRIDGE-011 · 仓位口径修正（`FIXED_RATIO` × 1/180）（**Goal round 10**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · **零业务代码改动** · Dataset **`780004`** · HEAD **`f8b6810`** · Goal round **10/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **仓位口径修正方案已确立并落地**（承接 `BRIDGE-010` 的口径不符 ①）                                     │
│                                                                                                      │
│  解法依据 —— `server/research/simulator/plan.ts` **L167-168**：                                        │
│     「`FIXED_FRACTION` / `FIXED_RATIO` ⇒ `min(allocatable, initialCapital × fraction)`                │
│       （基数 = **初始资金**，与 `PositionDefinition.positionRatio` 既有定义一致）」                       │
│                                                                                                      │
│  字段 —— `SimulationConfig.positionSizing`（`types.ts` **L228-242**）：                                │
│     { sizingMethod: "FIXED_RATIO", fraction: 1/180, fixedAmount: null }                               │
│                                                                                                      │
│  ⇒ **每仓 = 初始资金 × 1/180** = 研究口径的 **`w = 1/MAX_CONC`（恒定）** ✓                              │
│  （对比：`EQUAL_WEIGHT` 按当日候选数均分 ⇒ `w ≈ 1/3`，**不符**）                                         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT

### 1.1 解法（平台自身文档给出细则）

`plan.ts` L134-168（原文要点）：

```
* 基数口径取自项目既有定义：`strategySchema/definition.ts` 的 `PositionDefinition.positionRatio`
* 中 `FIXED_RATIO` 表示「每仓占初始资金比例」⇒ 这里沿用同一口径。
*   - `EQUAL_WEIGHT` / `RANK_WEIGHTED` / 未声明 ⇒ 原样（= 既有行为）；
*   - `FIXED_FRACTION` / `FIXED_RATIO` ⇒ `min(allocatable, initialCapital × fraction)`
*     （基数 = **初始资金**，与 `PositionDefinition.positionRatio` 既有定义一致）；
```

⇒ **`sizingMethod: "FIXED_RATIO"` + `fraction: 1/180`** ⇒ **每仓恒为 `初始资金 / 180`** ⇒ **精确对齐研究口径**

### 1.2 已落地到 harness

`scripts/_scratch/variantBacktest.ts` 的 `simConfig` 现为：

```ts
{
  dateRange, initialCapital: 1_000_000, cost: COST,
  maxPositions: 180,
  positionSizing: { sizingMethod: "FIXED_RATIO", fraction: 1 / 180, fixedAmount: null },  // 🔴 本轮新增
  candidateExitPolicy: "DISABLED",                                                          // round 9
  exitPolicy: { stopLossRatio: null, takeProfitRatio: null, maxHoldingDays: 40 },
}
```

---

## 2. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ❌ **两个 Variant 的正式 Backtest 未完成验收** —— 本轮已发起重跑（`FIXED_RATIO` 1/180），**结果未回收** |
| **N2** | 🔴 **`SUSPENDED` 拒单 54% 的根因**（`BRIDGE-010` 问题②：疑似 cursor 成员退休致持仓无 execution bar）—— **仍未取证** |
| **N3** | ⚠️ 板价判定逐事件一致性（D2） |
| **N4** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |
| **N5** | ⚠️ **D1 口径差异**（`TIME_EXIT` 成交于 rd56 `open`）须显式标注 |

---

## 3. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入**（只读 TiDB）· ✅ **未产出正式 Run / 未创建 Candidate / Strategy Version** · ✅ **未跑 OOS / WFA** · ✅ **未做权重/仓位/TopN/参数搜索**（`fraction = 1/180` 是**研究口径的复现**，非搜索）· ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 改动仅 `scripts/_scratch/`（gitignore）

---

## 4. 下一步（**Goal 保持 active**）

```text
1. 回收本轮重跑结果（FIXED_RATIO 1/180）并核对 w = 1/180
2. 勘定 SUSPENDED 54% 的根因（N2）
3. 两个 Variant 完成正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps · 标注 D1）
4. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**