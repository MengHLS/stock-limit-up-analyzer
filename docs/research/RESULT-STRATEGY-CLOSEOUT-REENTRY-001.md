# RESULT-STRATEGY-CLOSEOUT-REENTRY-001

> 任务：STRATEGY-CLOSEOUT-REENTRY-001（正式关闭 Strong Trend Re-entry V1 研究线）
> 日期：2026-10-05
> **最终结论：`strong-trend-reentry-v1 = TERMINATED / NO_EDGE_FOUND`**

---

## 1. 关闭决定

| 项 | 值 |
|---|---|
| Strategy | `strong-trend-reentry-v1@1.0.1` |
| 最终状态 | **`RESEARCH_TERMINATED / NO_EDGE_FOUND`** |
| 触发 Gate | `RESULT-DISCOVERY-REENTRY-CANONICAL-001` → `NO_EDGE_FOUND` |
| 数据处置 | **不删除任何** Strategy / Research / Dataset / Backtest 数据；历史 Run 全部保留 |
| 后续阶段 | **不进入** Parameter Search / OOS / WFA / Robustness / Paper Trading |

## 2. Parity 与 Gate 台账（ROADMAP 同步登记）

| 层 | 结果 | 证据 |
|---|---|---|
| Event Parity | **PASS** | PARITY-002：canonical 3,910 vs Research 691（intersection 691 / research-only 0） |
| Reclaim Parity | **PASS** | canonical 2,542 / fillable 2,499 vs Strategy candidateSlots 2,492（Δ=50 / Δ=7） |
| Entry Parity | **PASS** | 304/304 命中；价格差中位 +15.0bps（≈ slippageBps 10 + 舍入）；日期差 0 |
| Exit Parity | **PASS** | TIME_EXIT 303 + OPEN_END 1；实际退出 vs 固定 T+20 Close 中位仅差 -0.10pt |
| Cost Parity | **PASS** | C→D 中位 -0.230%、均值 -0.419%（成本真实但非主因） |
| Return Bridge | **PASS** | A→D 配对合计中位 **-0.650%**（n=216） |
| **Canonical Discovery** | **`NO_EDGE_FOUND`** | T+20 中位 -13.22%（n=2,499）；8/8 年份为负；全部因子分桶为负 |
| Parameter Search / OOS / WFA / Paper | **不进入** | 基础信号为负期望，优化无意义 |

## 3. 研究证据链（保留 + 状态标记）

| 报告 | 状态 | 说明 |
|---|---|---|
| `RESULT-PATTERN-DISCOVERY-STRONG-TREND-001.md` | **`SUPERSEDED_BY_CANONICAL`** | 历史子样本（691）正向结果；样本继承导致 Selection Bias |
| `RESULT-PATTERN-REENTRY-STRONG-TREND-001.md` | `SUPERSEDED_BY_CANONICAL` | 同上（继承同一 691 子集） |
| `RESULT-PATTERN-REENTRY-RECOVERY-002.md` | `SUPERSEDED_BY_CANONICAL` | 同上 |
| `RESULT-PATTERN-REALTIME-REENTRY-003.md` | `SUPERSEDED_BY_CANONICAL` | 同上（547 条 = 691 子集内） |
| `RESULT-PRE-STRATEGY-REENTRY-001.md` | **`SUPERSEDED`** | 同上；其 `PASS_TO_STRATEGY_DEFINITION` 结论仅对 691 子集成立 |
| `RESULT-STRATEGY-DEFINITION-REENTRY-001.md` | `SUPERSEDED` | 定义流程本身有效（可作为模板），结论不再有效 |
| `RESULT-STRATEGY-IMPLEMENTATION-REENTRY-001.md` | `VALID` | 接入 Strategy Core 的实现记录 |
| `RESULT-BACKTEST-REENTRY-BASELINE-001.md` | `INVALIDATED` | HOLD_WHILE_SELECTED 抢跑 + 96% SUSPENDED |
| `RESULT-STRATEGY-IMPLEMENTATION-REENTRY-FIX-001/002/003.md` | `VALID` | 退出语义 + Execution Overlay 修复记录 |
| `RESULT-BACKTEST-REENTRY-BASELINE-002.md`（+ TRADE-DISTRIBUTION） | **`BASELINE_VALID`** | 执行正确、口径一致的 Baseline（-99.05%），保留 |
| `RESULT-RESEARCH-STRATEGY-PARITY-REENTRY-002.md` | `BLOCKED→SUPERSEDED` | 其发现被 PARITY-002 收口 |
| `RESULT-PARITY-ROOTCAUSE-REENTRY-001.md` | `ROOTCAUSE_PARTIAL→SUPERSEDED` | 由 PARITY-002 定论（DEDUP_FILTER） |
| `RESULT-PARITY-002-REENTRY-CANONICAL-EVENTSET.md` | **`PASS`** | canonical event set parity |
| `RESULT-PARITY-003-REENTRY-RETURN-BRIDGE.md` | **`PASS`** | 收益层面语义一致 |
| `RESULT-DISCOVERY-REENTRY-CANONICAL-001.md` | **最终 Gate** | `NO_EDGE_FOUND` |

## 4. 失败原因（案例总结）

1. **Discovery 样本继承导致严重 Selection Bias（主因）**
   `_analyze_pattern_reentry.mjs` 的事件集取自 `_pattern_discovery_full_history.json` /
   `_pattern_discovery_strong_trend.json` 的 `observations` 并集（691），而**不是** 780001 的全量
   3,910 个 S 事件。后续 Recovery-002 / Realtime-003 / Pre-Strategy 全部**沿用该 691 子集**，
   造成整条研究链路上的正向结论建立在 17.7% 的子样本上。
   Canonical 复核：Research 691 ⊂ canonical 3,910（intersection = 691，research-only = **0**）。

2. **canonical 全量样本不存在正向 Edge**
   2,499 笔 fillable：T+20 中位 **-13.22%**、胜率 30.2%、MAE20 中位 -18.73%；
   8/8 年份为负；8 个因子 × 全部分桶 T+20 中位数无一为正；无 TopN 优势；
   两组反直觉结果：**Reclaim 当天涨停反而是最差桶（-15.90%）**、**放量不构成优势**。

3. **Entry / Exit / Cost 均已排除为主要原因**
   A→B（入价）中位 -0.126%；B→C（退出）中位 -0.096%；C→D（成本）中位 -0.230%；
   三段合计 A→D 中位 **-0.650%**。⇒ 负收益来自**信号本身的负期望**，不是执行。

4. **参数优化无意义**
   基础信号在 canonical 全量上为**负期望**，任何阈值/持有期/过滤优化都只是在负期望上做
   样本内挑选 ⇒ 本线不进入 Parameter Search / OOS / WFA。

## 5. 保留物（可复用）

- **可复用**：canonical event set 构建脚本 `scripts/_scratch/_parity002_canonical.mts`
  + 产物 `_parity002_canonical_eventset.json`（3,910 / 2,542 / 2,499）；
- **可复用**：执行面修复（`candidateExitPolicy=DISABLED` 语义、Execution Overlay
  `loadPositionExecutionOverlay` + `DbBarStore.barsForSecuritiesDateRange`）；
- **保留**：Baseline 002 的 Run 资产与逐笔明细（`_reentry_baseline_002_trades.json`）；
- **不删除**：所有历史报告与实验，仅追加状态标记。

## 6. 本轮未做 / 未改

未修改任何策略逻辑（Strategy Definition / Entry / S / RECLAIM / Exit / Position / Cost 全部未动）；
未删除任何历史实验/报告/Run；未做无关重构；无 Parameter Search / OOS / WFA / Robustness。

## 7. 最终结论

```text
strong-trend-reentry-v1 = TERMINATED / NO_EDGE_FOUND
```
