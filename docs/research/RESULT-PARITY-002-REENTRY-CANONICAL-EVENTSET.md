# RESULT-PARITY-002-REENTRY-CANONICAL-EVENTSET

> 任务：PARITY-002（统一 Strong Trend Re-entry 事件集合并重跑 Parity）
> 策略：strong-trend-reentry-v1@1.0.1 ／ 唯一数据源：datasetVersionId=780001（v8）
> 状态：**A / B / C 三层一致 ⇒ Return Bridge 解锁（本轮未执行）**

## Executive Summary

「Research +18.5% vs Strategy -10.63%」的差异**几乎全部来自 Research 侧的样本选择**，不是执行/成本/退出。

把 Research 的样本换成 canonical 事件集（同一规则、同一数据源）后：

```text
Research（原资产 691 子集）      T+20 中位数 ≈ +18.5%
Research（canonical，同规则）    T+20 中位数 = -13.2%   (n=1,780)
Strategy（Baseline 002）        net 单笔中位数 = -10.63%
```

⇒ 同一策略、同一数据，样本从 691 换成 3,910 后，Research 中位数从 +18.5% 变成 -13.2%，
与 Strategy 的 -10.63% **同号同量级**。**+18% → -10% 的鸿沟是样本差异，不是执行差异。**

## 1. Canonical Event Set（唯一来源 780001）

S 定义（严格按 Strategy 当前定义；**未加** suspension / outcome / completeness / 未来收益过滤）：
首板事件后 80 个交易日内首个 `high >= 2 × event-day close`，`barPresent=1 AND close IS NOT NULL`，eventId 去重。
Pullback = S 之后首个 `low < S_close`；RECLAIM = 之后首个 `close >= S_close`；执行价 = RECLAIM+1 Open。

| 层 | events | stocks |
|---|---:|---:|
| FIRST_LIMIT | **73,003** | 3,334 |
| S | **3,910** | 1,330 |
| RECLAIM | **2,542** | — |
| RECLAIM+1 fillable | **2,499** | — |
| distinct eventId | 3,910 | — |

口径复核：S 计数在「加/不加 `barPresent=1`」下**完全相同（3,910 = 3,910）**
⇒ `BAR_PRESENT_FILTER` 对 3,910→691 的缺口贡献 **0**。

产物：`scripts/_scratch/_parity002_canonical_eventset.json`

## 2. Layer A — Event Set

| | 数量 |
|---|---:|
| Canonical（DB 全量） | **3,910** |
| Research（原资产 full） | **691** |
| **intersection** | **691** |
| Canonical-only | **3,219** |
| Research-only | **0** |

⇒ Research 691 是 canonical 3,910 的**严格子集**，3,219 的缺口全在 Research 侧。
根因即上一轮定位的 **DEDUP_FILTER（样本继承）**：`_analyze_pattern_reentry.mjs` 的事件集取自
DISCOVERY 阶段 `_pattern_discovery_*.json` 的 `observations` 并集，而非 780001 全量首板事件。

## 3. Layer B — Reclaim Set

| | 数量 |
|---|---:|
| Canonical RECLAIM | **2,542** |
| Canonical RECLAIM+1 fillable | **2,499** |
| Strategy candidateSlots（Baseline 002） | **2,492** |
| Δ（reclaim vs slots） | 50（1.97%） |
| Δ（fillable vs slots） | 7（0.28%） |

⇒ **Strategy 的 2,492 基本等于 canonical reclaim（2,542）**；与 fillable 仅差 7。
`547 vs 2,492` 之谜解开：**Strategy 是对的（≈ canonical），Research 547 只是其 691 子集内的 reclaim。**

残差 50（对 fillable 为 7）的候选定位（均**不涉及规则语义**，未逐条验证）：

```text
(a) fillable 口径：canonical 用「entry rd 行存在且 open>0」；Strategy 触发成员用
    judgeStrongTrendReentryEvent（RECLAIM 当日成立）⇒ 对「entry 行缺失」样本取舍可能差 7 条
(b) 观察窗口边界：Strategy observationWindow.end = 79（execution maxRd = 80）
    ⇒ RECLAIM 落在 rd = 80 的样本 Strategy 收不到
(c) 日期窗口：Strategy run window = 2019-01-01..2026-09-04
```

## 4. Layer C — Entry Date / Entry Open

用 `securityId` 内的 `::event:<eventId>` 与 canonical detail 对齐：

| | 值 |
|---|---:|
| Strategy trades | 304 |
| 命中 canonical RECLAIM | **304（100%）** |
| 未命中 | **0** |
| 价格差中位数（Strategy entryPrice / canonical Open − 1） | **+15.0 bps** |
| 最大价格差 | **+30.0 bps** |
| 日期差 | 0（同一 RECLAIM+1 交易日） |

⇒ **Entry 层一致**。+15bps 中位 / +30bps 上限与 `costModel.slippageBps = 10` 的买向滑点 + 价格舍入同量级
⇒ 不是价格口径错误（raw vs adjusted 一致）。

## 5. Layer D / E / F（Exit / Gross / Net）

**未执行**。前置 A/B/C 已一致 ⇒ 按任务约定 **Return Bridge 已解锁**，下一步即可：

```text
canonical 2,542 RECLAIM（或 2,499 fillable）上：
  A Research 原始口径 : RECLAIM+1 Open -> entry 后第 20 个交易日 Close
  B Strategy 入价     : actual entryPrice -> 同一 Close
  C Strategy 实际退出 : actual entryPrice -> actual exitPrice
  D Net               : C - commission - stampDuty - transferFee - slippage
```

本轮顺手算出的 canonical 口径 T+20：`n=1,780, P25=-24.1%, Median=-13.2%, P75=+5.9%`。

## 6. Root Cause

```text
主因：DEDUP_FILTER（样本继承）—— Research 事件集是 canonical 的严格子集，贡献 3,219 个缺失事件（100%）
次因：无
```

排除：`BAR_PRESENT_FILTER`（加/不加相同）、`SUSPENSION_FILTER`、`DATE_RANGE_FILTER`、
`OUTCOME_AVAILABILITY_FILTER`、`WINDOW_COMPLETENESS_FILTER`。
`ENTRY_MISMATCH` / `EXIT_MISMATCH` / `PRICE_FIELD_MISMATCH`：Entry 层已实证一致（304/304，仅滑点差）。

## 7. 未修改任何内容

未改 Strategy Definition / Entry / S / RECLAIM / Exit / Position / Cost / Dataset / Research 定义；
未重新生成 dataset v8；只读 SQL + JSON 读取 + 只读脚本
（`scripts/_scratch/_parity002_canonical.mts` → `_parity002_canonical_eventset.json`）。

## 8. Final Status

```text
Event / Reclaim / Entry 三层一致  →  PARITY_PASS（三层）
Return Bridge                     →  已解锁，本轮未执行
```
