# RESULT-PARITY-ROOTCAUSE-REENTRY-001

> 任务：`PARITY-ROOTCAUSE-REENTRY-001`（只读定位 3,910 vs 691）
> 数据集：`datasetVersionId=780001`（v8）
> 日期：2026-10-05
> **最终状态：`ROOTCAUSE_PARTIAL`**（机制已用代码证据锁定；逐层去掉多少的精确拆分未跑完）

---

## A. DB Funnel（已实测部分）

| 层 | events | stocks | 说明 |
|---|---:|---:|---|
| ALL 主板非 ST 首板事件 | **73,003** | — | 全部 `boardType=main`；`universeDefinitionJson = {universe:"all-a-shares", boards:["main"], excludeSt:true}` |
| S（`MAX(post.high) >= 2*prefix.rd0.close`，**未加 barPresent**） | **3,910** | — | 实测 156s |
| S + `barPresent=1 AND close IS NOT NULL` | 运行中 | — | 见 §E 说明 |
| S + path / complete window | 未测 | — | — |

## B. Research Funnel（逐层追到源头）

```text
_pattern_realtime_reentry_003.mjs
  const all = JSON.parse("_pattern_reentry_recovery_002.json").full      ← 691，不是查库得来
        ↓
_pattern_reentry_recovery_002.json (metadata.source = PATTERN-REENTRY-RECOVERY-002)
  const full = JSON.parse("_pattern_reentry_strong_trend.json").full
        ↓
_pattern_reentry_strong_trend.json (metadata.source = PATTERN-DISCOVERY-STRONG-TREND-001, fullEvents=691)
  const full = JSON.parse("_pattern_discovery_full_history.json")
  const recent = JSON.parse("_pattern_discovery_strong_trend.json")
  const allEvents = union(full.observations, recent.observations)        ← 691 在这里被定格
```

**关键证据（原样摘录 `scripts/_scratch/_analyze_pattern_reentry.mjs`）**：

```js
const full=JSON.parse(readFileSync(new URL("./_pattern_discovery_full_history.json",...)));
const recent=JSON.parse(readFileSync(new URL("./_pattern_discovery_strong_trend.json",...)));
const eventMap=new Map();
for(const o of [...full.observations,...recent.observations]){ ... }
const allEvents=[...eventMap.values()];
```

⇒ Research 的 691 **不是「全库 S 扫描」的结果**，而是 **DISCOVERY 阶段（PATTERN-DISCOVERY-STRONG-TREND-001）
两份 `observations` 产物的并集**。3,910 → 691 的压缩发生在 **DISCOVERY 阶段的样本构造**，
不在本轮的 S 判定层。

同一文件里的 post 查询（**第二个过滤点**）：

```sql
SELECT ... FROM ds_first_limit_pullback_post
WHERE datasetVersionId=780001 AND eventId IN (...) AND barPresent=1 AND close IS NOT NULL
```

⇒ Research 在算 S/Pullback/RECLAIM 时**要求 `barPresent=1`**；而 §A 的 3,910 **没有**该条件。

## C. Date Range

| | earliest | latest |
|---|---|---|
| DB S（3,910） | 未测（查询未完成） | 未测 |
| Research S（691） | **2019-01-02** | **2026-07-21** |

Research 覆盖**全历史**（不是窄日期窗口）⇒ **DATE_RANGE_FILTER 不成立**。

## D. Event Set Difference

| 量 | 值 |
|---|---:|
| Research_S（eventId 可直接映射 DB） | **691** |
| DB_S（未加 barPresent） | **3,910** |
| intersection / DB-only / Research-only | 差集查询未跑完（见 §E） |

映射键无风险：Research 的 `eventId` 就是 DB 的 `eventId`（形如 `000016.SZ@2024-07-29`），
不需要用 `股票+日期` 近似匹配。

## E. Root Cause

```text
主因：DEDUP_FILTER（样本继承 / 样本构造）
      Research 事件集 = DISCOVERY 阶段 observations 的并集，而非全库首板事件
次因：BAR_PRESENT_FILTER
      Research 算 S 时要求 barPresent=1；§A 的 3,910 未加该条件，属未过滤上界
```

排除：`DATE_RANGE_FILTER`（Research 覆盖 2019-01-02..2026-07-21 全历史）、
`SUSPENSION_FILTER`（Research 未按 suspensionStatus 过滤）、
`OUTCOME_AVAILABILITY_FILTER`（未见「先判未来 outcome 再保留 S」的构造；691 中 69 条为 CENSORED，说明未按 outcome 过滤）、
`WINDOW_COMPLETENESS_FILTER`（同上，未要求完整窗口）。

**未完成的部分**：3,910 → 691 的**逐层去掉多少**尚未跑完——需要
①加 `barPresent=1` 的 S 计数；②读 DISCOVERY 阶段的 `_pattern_discovery_full_history.json` /
`_pattern_discovery_strong_trend.json` 的 `observations` 产生条件（那个脚本才是真正的第一道样本闸门）。
这两条查询/静态检查已写好（`scripts/_scratch/_parity_funnel.mjs`），但对 5.7M 行的聚合在跨境链路上超时，
本轮预算内未取回结果。

## F. Final Status

```text
ROOTCAUSE_PARTIAL
```

### 结论（可直接用于 PARITY-002 的下一步）

> `Research 547` 与 `Strategy 2,492` 的差异**不产生于 Entry/Exit/Cost，也不产生于事件规则本身**，
> 而**产生于 Research 侧样本是从 DISCOVERY 阶段继承下来的一份子集**（并集 691），
> 且该子集上还叠加了 `barPresent=1` 的口径。
> ⇒ 在做逐笔 Return Bridge 之前，必须先把两边样本**统一到同一个事件集合**。

### 本轮未修改任何内容

只读 SQL（SELECT）+ JSON 读取 + 静态脚本检查。未 INSERT/UPDATE/DELETE/DDL，未改 Strategy / Research 定义 /
Dataset，未重新生成 v8，未重跑 Backtest。
