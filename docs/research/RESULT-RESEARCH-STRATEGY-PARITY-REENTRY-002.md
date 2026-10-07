# RESULT-RESEARCH-STRATEGY-PARITY-REENTRY-002

> 任务：`RESEARCH-STRATEGY-PARITY-REENTRY-002`（Research → Strategy Runtime Parity Audit）
> 策略：`strong-trend-reentry-v1@1.0.1` ／ 数据集：`datasetVersionId=780001`
> 日期：2026-10-05
> **最终状态：`PARITY_BLOCKED`**（已定位差异发生在哪一层；逐笔桥未完成）

---

## Executive Summary

**+18% 与 -10% 的差异起点不在 Entry / Exit / Cost，而在「两边衡量的事件集合不是同一个」。**

```text
DB（780001 全部 73,003 个主板非 ST 首板事件）
  → 满足 S（MAX(post.high) >= 2 * prefix.rd0.close）的事件 = 3,910
Research 资产（_pattern_realtime_reentry_003.json.full）
  → S-reaching = 691（仅为 DB 的 17.7%）
  → 其中 RECLAIM 成立 = 547
Strategy（事件窗流式游标 + CUSTOM_EVENT 判定器）
  → candidateSlots = 2,492（与 3,910 同量级；与 691 完全不同量级）
```

⇒ Research 侧只覆盖 S 事件的一个子集；`547 vs 2,492` 与 `+18.5% vs -10.63%` **是样本不同，不是策略更差**。
按任务 §4，在事件集合对齐前做 Entry/Exit/Cost 归因会把「集合差异」误判成「定义/执行不一致」，
故停在 `SIGNAL_MISMATCH`。

## Signal Bridge

| 层 | 数量 | 唯一事件身份 | 备注 |
|---|---:|---:|---|
| DB 全部首板事件 | 73,003 | 73,003 | boardType 全为 main |
| DB 达到 S | **3,910** | 3,910 | MAX(post.high) >= 2*prefix.close |
| Research S-reaching | **691** | 691 | 资产 full[] |
| Research RECLAIM | **547** | 547 | 唯一股票 270 |
| Strategy candidateSlots | **2,492** | — | totalSelectedSlots |
| Strategy orders / fills | 628 / 607 | — | Baseline 002 |
| Strategy trades | 304（平 303） | — | 事件级面板身份 |

**断点：691 → 3,910（Research 侧缺 3,219 个 S 事件）。**

### 已排除的假设

| 假设 | 结论 | 证据 |
|---|---|---|
| 板块/ST 口径不同 | 排除 | universeDefinitionJson = all-a-shares / boards:["main"] / excludeSt:true；73,003 事件全 main |
| Strategy 重复计数 | 排除 | 1 年窗口 candidateSlots=376 = 独立身份 376 = intents 376 |
| Strategy 计入非 S 事件 | 排除 | 触发成员由 judgeStrongTrendReentryEvent（与 Core 同源）判定，仅 RECLAIM 当日为真 |

### 尚未定位（下一步）

Research 侧 691 的过滤来源：(a) 研究脚本 SQL 预筛；(b) 是否要求 barPresent=1（我的 SQL 未加该条件 ⇒ 3,910 可能被不可交易行抬高）；(c) 日期/outcome/path 等附加条件。

## Event Parity（S / Pullback / RECLAIM）

**未执行**（前置：两边事件集合相同；当前 691 != 3,910）。规则层代码级对照：

| 步骤 | Research（_analyze_realtime_reentry_003.mjs） | Strategy（strongTrendReentryEventSource.ts） |
|---|---|---|
| S | find(barPresent && high>0 && high >= 2*ec) | find(rd>0 && high >= 2*eventClose) |
| Pullback | find(rd>S.rd && low!==null && low<sClose) | find(rd>S.rd && low<strongClose) |
| RECLAIM | find(rd>below.rd && close!==null && close>=sClose) | find(rd>pullback.rd && close>=strongClose) |

差异点：Research 要求 barPresent，Strategy 不要求。

## Entry / Exit / Return Bridge

**未执行**（依赖 Event Parity）。已有单边事实：Entry 全部为 RECLAIM+1 Open（执行政策 NEXT_OPEN）；
Exit = TIME_EXIT 303 + OPEN_END 1，holdingDays 含头计数 21 ⇔ entry 后第 20 个交易日收盘；
Cost = 费用 4,485.45 + 滑点 1,136.61，净比毛均值低 0.43pp ⇒ **成本不是 -18pt 级差异来源**。

## Candidate Slot Root Cause（2,492）

```text
2,492 = DB 3,910 个 S 事件中完成 S->Pullback->RECLAIM 链的 64%
547   = Research 691 个 S 事件中完成同链的 79%
```

⇒ **两边转化率量级相当（64% vs 79%），差的是分母（3,910 vs 691）。**
`candidateSlots=2492` **不是** volumeRatio rank 载体 / topPercentile / direction / decisionMemberPredicate
造成的扩张（这些都不改变成员集合，已由排除表证明）。

## Worst / Random Trades、Portfolio

**未执行**（依赖前序）。

## Root Cause

```text
SIGNAL_MISMATCH   ← 主因（事件集合层面：Research 691 ⊂ DB 3,910）
UNKNOWN           ← 子因（691 的过滤来源尚未定位）
```

不成立（本轮无任何证据）：ENTRY_MISMATCH / EXIT_MISMATCH / DATE_OFFSET_MISMATCH /
PRICE_FIELD_MISMATCH / PORTFOLIO_MISMATCH / COST_ONLY。

## Final Status

```text
PARITY_BLOCKED
```

### 下一步（只读/脚本，不改策略）

1. 给 S 计数加 `barPresent = 1`（与 suspensionStatus 口径）复核 3,910；
2. 回到研究脚本定位 691 的真实过滤条件；
3. 用同一事件集合重建两边样本；
4. 再跑 §3–§8：MATCHED / RESEARCH_ONLY / STRATEGY_ONLY -> Entry/Exit Parity -> Return Bridge A->B->C->D，逐层定量；
5. 仅在能把主要差异定量归因后才允许 `PARITY_PASS`。

### 本轮未修改任何内容

未改 Strategy Definition / Entry / S / RECLAIM / Exit / Position / Cost / Dataset / Research 定义；
只新增只读脚本 `scripts/_scratch/_parity_facts.mjs`、`scripts/_scratch/_parity_scount.mjs`。
