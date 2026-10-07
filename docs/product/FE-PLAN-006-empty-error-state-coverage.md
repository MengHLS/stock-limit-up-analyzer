# FE-PLAN-006 — 空态 / 错误态覆盖（前端诚实三态）

> 日期：**2026-10-07** · 状态：**DONE（扫描 + 2 处修复 + 真实渲染验证；剩余 4 页登记为 backlog）** · 作者：Frontend（按 `.agents/frontend` + `.agents/orchestrator` 规则产出）
> 上游：`.agent/task-state.yaml` 的 `EMPTY_ERROR_STATES` 阶段（Goal `FRONTEND-IA-001`）· `FE-PLAN-005` 收尾后的下一项「前端可自主项」
> 范围：**只读扫描 + 最小加法修复**（新增 error 分支）；不改契约 / 不改 DB / 不改执行链。

---

## 0. 一句话

> **全站 32 个带取数页面没有「完全没有错误面」的页面了**；其中 1 个页面（ReviewWorkbench）此前**读失败会显示成空态**，另有 1 个页面（PaperTrading）的运行列表同样会把失败显示成「暂无运行」——两处已修，并用「拦截请求 → 真实渲染」证明失败不再被伪装成空数据。

---

## 1. 为什么这是一条纪律，不是一个样式问题

本项目的既有纪律是「**诚实空态**」（见 `FE-9` / `SCOPE-002` / C-99 的表述：查不到 ⇒ 空态，**不伪造**）。它的反面是：

```text
RPC 失败  →  isError=true, data=undefined  →  若页面只判断 data 为空
          →  渲染「暂无数据」
          ⇒ 用户把「系统故障」读成「确实没有数据」
```

研究平台里这类误读代价很高：它会让研究者得出「这个策略没有交易 / 没有留档」的**错误事实判断**。

---

## 2. 扫描方法（可复核）

| 项 | 内容 |
|---|---|
| 范围 | `client/src/pages/**/*.tsx` 中所有出现 `useQuery(` 的页面 |
| 判据 | loading = `isLoading/isFetching/isPending/加载中/加载…/Skeleton`；error = `isError/\.error/加载失败/读取失败/ErrorState`；empty = `length === 0/暂无/还没有/尚无/空态/EmptyState/无数据` |
| 结果 | **扫描 32 个页面；三态齐全 32 / 缺口 0**（修复后） |
| 结构锁 | `tests/client/src/pages/pageFlowContracts.test.ts` §46（全站扫描）+ §47（ReviewWorkbench 定点）+ §48（PaperTrading 定点） |

> ⚠️ §46 的 error 判据会命中 `toast.error`（动作失败），因此它只保证「页面声明了错误面」。**主查询级别的 error≠empty** 由 §47/§48 的定点锁保证，其余页面见 §5 backlog。

---

## 3. 本轮修复（2 处，均为加法）

### 3.1 `client/src/pages/ReviewWorkbench.tsx`

| 项 | 内容 |
|---|---|
| 病灶 | `listQuery` / `detailQuery` **没有任何 error 分支** ⇒ 读取失败直接落到「暂无前向纸面运行」 |
| 修法 | 列表分支改为 `loading → error → empty`；详情补 `detailQuery.isError` 分支；统一走共享 `ErrorState`（不再造一份错误样式） |
| 文案纪律 | 明写「读取失败时不渲染任何替代数据，也不把它当成空态」 |

### 3.2 `client/src/pages/PaperTrading.tsx`

| 项 | 内容 |
|---|---|
| 病灶 | `listQuery` / `detailQuery` 只处理 `isLoading`，失败会显示「暂无前向运行」 |
| 修法 | 列表分支改为 `loading → error → empty`；详情补 error 分支 |
| 文案纪律 | 「读取失败不代表「暂无运行」，此处不显示空态」 |

---

## 4. 验证（真实渲染，不是「接线完成」）

用 CDP `Fetch` 域把 `sentiment.listPaperTradingRuns` 请求**打成失败**，再看真实 DOM：

| 页面 | 错误态出现 | 空态是否被误显示 | 结论 |
|---|---|---|---|
| `/review-workbench` | ✅「前向纸面运行列表读取失败」+ `RPC_ERROR` | ❌ 未出现「暂无前向纸面运行」 | **PASS** |
| `/paper-trading` | ✅「运行列表读取失败：Failed to fetch」 | ❌ 未出现「暂无前向运行」 | **PASS** |

对照（不拦截）：`/review-workbench` 正常渲染 4 条前向运行（`#90002 / #90001 / #30001 / #1`），未出现错误态 ⇒ 错误分支不会误触发。

```text
tsc --noEmit                                        → 0 错
vitest run tests/client/src/pages/pageFlowContracts.test.ts → 47/47（含 §46/§47/§48）
真实渲染（无头 Edge + CDP Fetch 拦截）              → 2/2 页面「失败不再伪装成空态」
```

---

## 5. Backlog（本轮**未**修，已登记，不静默丢弃）

下列 4 个页面使用**解构式**取数（`const { data, isLoading } = useQuery(...)`），主查询未捕获 `error`；页面里虽有 `toast.error`（动作失败）但不覆盖读取失败。修法需要先判定「哪些是主查询」并设计聚合错误条，属一次小型设计决定，故留作下一轮：

| 页面 | 主查询（解构） | 现状 |
|---|---|---|
| `client/src/pages/Market.tsx` | `limitUp.getDailyStats` · `limitUp.getSectorDistribution` · `market.getLimitUpWithMarketData` | 失败 ⇒ 板块/统计静默为空 |
| `client/src/pages/LimitUpReview.tsx` | `limitUp.getDailyStats` · `limitUp.getByDate` · `limitUp.search` | 失败 ⇒ 当日复盘静默为空 |
| `client/src/pages/SentimentAlerts.tsx` | `sentiment.getAlerts` · `sentiment.getUnreadCount` | 失败 ⇒ 预警列表静默为空 |
| `client/src/pages/Backtest.tsx` | `historyQuery` · `costSensitivityQuery` · `listQuery` · `detailQuery` | 失败 ⇒ 留档列表静默为空 |

另：`StrategyVersionCompare` / `BacktestCompare` 已用 `<query>.error ? ...` 处理主查询失败（属仓库既有写法，无需改动）。

---

## 6. Non-goals

- ❌ 不统一全站错误样式（共享 `ErrorState` 已存在，本轮只在缺失处接入）
- ❌ 不为「不可能为空」的查询硬造空态
- ❌ 不改任何 tRPC 端点、不改重试策略、不改 DB
- ❌ 不动组合回测 `/backtest` 的内容与位置（仅登记其读取失败缺口）

---

## 7. 验收标准

| # | 标准 | 结果 |
|---|---|---|
| AC-1 | `client/src/pages/**` 中带取数页面 32/32 至少声明三态 | ✅（§46） |
| AC-2 | ReviewWorkbench 列表失败**不再**显示空态文案 | ✅ 真实渲染 |
| AC-3 | PaperTrading 列表失败**不再**显示空态文案 | ✅ 真实渲染 |
| AC-4 | 正常路径不受影响（有数据时照常渲染） | ✅ 对照渲染 4 条运行 |
| AC-5 | `tsc --noEmit` 0 错 + 受影响测试零新增失败 | ✅ |
| AC-6 | 未修项全部登记（含文件与主查询名） | ✅ §5 |
