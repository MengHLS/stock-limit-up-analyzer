# FE-PLAN-007 — 表格「排序 / 分页」语义分类登记（只分类，不改行为）

> 日期：**2026-10-07** · 状态：**DONE（分类登记）** · 作者：Frontend（按 `.agents/frontend` + `.agents/orchestrator` 规则产出）
> 上游：`.agent/task-state.yaml` 的 `TABLE_SEMANTICS_TRIAGE` 阶段（`FE-PLAN-006` 收尾后的下一项）
> 范围：**只读扫描 + 分类登记**。本文件**不提出**、**不执行**任何表格行为改动。

---

## 0. 一句话

> 全站 **29 个含表格的文件**里，**没有任何一处是「真正的服务端分页」**：所有「翻页/截断」都是 **服务端 `limit` 截断 + 客户端展示**；排序则一律是**客户端 `useMemo().sort()`**（有排序控件的表才排）。⇒ 这个语义**目前是全站一致的**，不需要收敛，只需要登记「哪些表将来可能踩到规模问题」。

---

## 1. 方法（可复核）

| 项 | 内容 |
|---|---|
| 范围 | `client/src/**/*.tsx` 中含 `<table>` 或 `<DataTable>` 的文件 |
| 判据 | `clientSort` = `.sort(` 且 `useMemo`；`serverLimit` = 查询输入含 `limit:`；`clientSlice` = `.slice(` |
| 局限 | **静态扫描**：只能判定「有没有」，**不能**判定「排序键 / 排序方向 / 越界行为」是否正确。⇒ 本表是**登记**，不是行为审计；将来改某表时需按 `AGENTS.md` 最小 Scope 复核该表 |
| 结果 | 29 个文件：**数据表 23 / 非数据表 6**（`ui/table.tsx`、`JsonBlock`、纯展示 Card/Dialog） |

---

## 2. 分类（数据表 23 个）

### A. 客户端排序 + 服务端 limit 截断（4）

| 文件 | 依据 |
|---|---|
| `client/src/components/robustness/SearchRobustnessPanel.tsx` | `.sort(` + `useMemo` + `limit:` + `.slice(` |
| `client/src/components/strategy/ThreeFactorTopNPanel.tsx` | 同上 |
| `client/src/pages/Backtest.tsx` | 同上（本仓表格最密集页面：27 个 `<table>`） |
| `client/src/components/parameterSearch/PersistedParameterSearchPanel.tsx` | 有 `sortBy` / `sortDirection` 控件 + `limit:` + `.slice(` |

### B. 仅服务端 limit 截断，无排序（5）

| 文件 | 依据 |
|---|---|
| `client/src/pages/BacktestCompare.tsx` | `limit:`（并在前端提示已被截断） |
| `client/src/pages/BacktestRuns.tsx` | `limit:` |
| `client/src/pages/OperationLogs.tsx` | `limit:` |
| `client/src/pages/ReviewWorkbench.tsx` | `limit: 50`（运行列表）+ 前端只取最近 N 笔 |
| `client/src/pages/PaperTrading.tsx` | `limit: 50`（运行列表） |

### C. 仅客户端切片 / 分页控件，无排序（5）

| 文件 | 依据 |
|---|---|
| `client/src/components/CandidateHistoryTable.tsx` | 分页控件形态（`pageSize`/页码类标识） |
| `client/src/components/datasetRegistry/DatasetPreviewTable.tsx` | 预览切片 |
| `client/src/components/strategy/PaperTradingTemplate.tsx` | `.slice(`（今日策略池 / 最近信号 / 历史窗口） |
| `client/src/components/strategy/StrategyAdvancedTools.tsx` | `.slice(` |
| `client/src/pages/Dashboard.tsx` | `limit:` + `.slice(` |

### D. 只排序，无分页（2）

| 文件 | 依据 |
|---|---|
| `client/src/pages/Market.tsx` | 板块/统计表按值排序 |
| `client/src/pages/RegimeReport.tsx` | `.sort(` + `useMemo` |

### E. 两者都无 —— 域内全量展示（7）

| 文件 | 规模判断（当前） |
|---|---|
| `client/src/pages/PerformanceDashboard.tsx` | 依赖已落库的 Run 数（小） |
| `client/src/pages/Upload.tsx` | 单次上传结果（小） |
| `client/src/components/datasetRegistry/DatasetListTable.tsx` | 数据集数量（小） |
| `client/src/components/datasetRegistry/VersionListTable.tsx` | 单数据集版本数（小） |
| `client/src/components/strategy/StrategyEvaluationTemplate.tsx` | 单版本评估留档（固定维度） |
| `client/src/components/StrategyEvaluationPanel.tsx` | 同上 |
| `client/src/components/strategy/StrategyVersionDetailDialog.tsx` | 单版本详情 |

---

## 3. 结论

1. **语义一致**：全站没有服务端分页契约，也没有排序下推服务端 ⇒ 不存在「同一份数据两套分页语义」的冲突。
2. **不需要立即收敛**：本轮的分类结论是「**维持现状**」；将来若引入服务端分页/排序，必须作为**契约变更**走 Architecture + Product，而不是靠在页面里加 state 解决。
3. **规模风险点（登记，未改）**：
   - `Backtest.tsx`（27 个 `<table>`）与 `SearchRobustnessPanel`：客户端排序 + 切片，条数增长后会有主线程压力；
   - E 组 4 张**「域内全量」**表（`DatasetListTable` / `VersionListTable` / `PerformanceDashboard` / `Upload`）目前规模小，**未加任何上限**——一旦数据量上来需要显式上限（并如实标注被截断）。
4. **不做的事**：本轮**不新增**分页组件、**不改**任何表的排序行为、**不引入**第二套表格封装。

---

## 4. Non-goals

- ❌ 不实现服务端分页 / 服务端排序（属契约变更，需 Architecture 出 Scope）
- ❌ 不统一表格组件（`DataTable` 与原生 `<table>` 并存是既有现状，收敛另议）
- ❌ 不给 E 组硬加上限（会改变现有可见数据范围 = 行为变化，非本阶段授权范围）

---

## 5. 验收

| # | 标准 | 结果 |
|---|---|---|
| AC-1 | 29 个含表格文件全部登记，无遗漏 | ✅ §2 |
| AC-2 | 每个文件给出「排序 / 分页」判定依据 | ✅ §2 每行依据列 |
| AC-3 | **零行为改动**（本阶段无 `.tsx` 变更） | ✅ 仅文档 |
| AC-4 | 规模风险点显式登记、不被静默忽略 | ✅ §3.3 |
