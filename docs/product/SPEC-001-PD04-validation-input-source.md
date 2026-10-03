# SPEC-001 — 验证域「输入来源显式化」（PD-04）

> 日期 2026-10-03 · 状态 **READY for Frontend** · 上游 `PRODUCT-DECISIONS-001.md` PD-04
> 归属：Frontend Agent（**零后端契约变更**）· 验收判据见 §7

---

## 1. Problem

验证域三个面板（稳健性 / 样本外 OOS / Walk-Forward）创建 Run 时，来源坐标靠**手填字符串**：

| 面板 | 创建时必须提供（实测前端 payload） |
|---|---|
| 稳健性 `SearchRobustnessPanel` | `sourceSearchRunId`（+ 可选容忍度，留空取后端默认） |
| 样本外 OOS `OosValidationPanel` | `sourceSearchRunId` + `parameterHash` + `oosWindow{startDate,endDate}` |
| Walk-Forward `WalkForwardPanel` | `strategyId` + `strategyVersion` + `datasetVersionId` + `windowConfig`（**不依赖搜索 Run**） |

用户必须离开验证页、去参数搜索页抄一个 `PSRUN-…` 字符串回来，且**无法确认该 Run 对应的 `datasetVersionId` / 参数集 / 冻结时间**。这与平台「可信、可复现」的核心价值直接冲突。

## 2. User Goal

在验证页内一次完成「**选来源 → 看清来源 → 创建 → 执行**」，不需要去别处抄 ID，也不会选错来源。

## 3. User Flow

```text
进入 /validation/robustness 或 /validation/oos
   ↓
① 来源选择器（下拉，列出已完成（COMPLETED）的参数搜索 Run）
   ↓
② 选中后显示「来源卡片」：Run ID · datasetVersionId · 参数集摘要 · 冻结时间 · 状态
   ↓
③ 填写该验证特有的输入（OOS：窗口日期；稳健性：容忍度，可留空）
   ↓
④ 创建 → 执行（真重跑需二次确认；复用既有 common/ConfirmDialog）
   ↓
⑤ Run 详情按既有行为渲染

若没有任何可用搜索 Run：
   空态「请先到 ④ 策略 → 参数搜索 跑一次搜索」+ 跳转按钮（创建按钮禁用）
```

WFA 面板的 flow 不同（不依赖搜索 Run）：**策略 + 版本 + Dataset 版本**同样改为**选择式**，并显示所选版本的 `datasetVersionId`。

## 4. Inputs

- 来源：`paramSearch.listSearches`（**已存在**）返回的参数搜索 Run 列表
- 参数摘要：`paramSearch.getSearchResults`（**已存在**）或列表自带字段
- OOS：`oosStartDate` / `oosEndDate`（用户填）
- 稳健性：`returnTolerancePct` / `drawdownTolerancePct` / `neighborDistance`（**可留空**，留空不提交，由后端补默认并持久化）
- WFA：`strategyId` / `strategyVersion` / `datasetVersionId` / `windowConfig`

## 5. Outputs

- 创建的验证 Run（**已落库**，行为不变）
- **来源卡片**（新增展示物）：让用户在任何时刻都能回答「这个验证跑的是哪个搜索快照」

## 6. Business Rules

| # | 规则 |
|---|---|
| 1 | 来源必须来自 `listSearches` 列表；**未选择时「创建」按钮禁用** |
| 2 | 只展示**已完成（COMPLETED）**的搜索 Run 作为可选来源；非完成态不进入选项（或置灰并说明原因） |
| 3 | 页面**只读渲染**，不重算任何指标（前端不是 Quant Engine） |
| 4 | 三页的**语义差异必须视觉可见**：稳健性 = **零重跑** · OOS = **真重跑** · WFA = **每 Fold 真重跑** |
| 5 | 🔴 **禁止**用视觉设计暗示未验证结果更好（例：给未做 OOS 的结果加「优秀」徽章） |
| 6 | **不得**修改 `paramSearch.*` 契约、不得新增端点 |

## 7. Acceptance Criteria（逐条可测）

| # | 判据 |
|---|---|
| AC-1 | 稳健性页与 OOS 页**不再存在**要求用户手输 `sourceSearchRunId` 的文本框 |
| AC-2 | 选中来源后，页面显示该 Run 的 `datasetVersionId`、参数集摘要与冻结时间 |
| AC-3 | 无可用搜索 Run 时显示空态文案 + 跳转「参数搜索」按钮，且创建按钮禁用 |
| AC-4 | 三个验证页各自显示「是否重跑回测」标识（零重跑 / 真重跑 / 每 Fold 真重跑） |
| AC-5 | 未选择来源时创建按钮禁用；选择后可创建，创建成功进入既有 Run 详情流程 |
| AC-6 | WFA 页的策略 / 版本 / Dataset 版本为**选择式**，且显示所选 Dataset 版本的 `datasetVersionId` |
| AC-7 | 上述改动 `pnpm run check` 0 错；相关测试不新增失败 |

## 8. Non-goals

- ❌ 不改 `paramSearch.*` 契约 / 不新增端点 / 不改 DB
- ❌ 不做跨 Run 对比
- ❌ 不做「搜索 → 冻结 → 稳健性 → OOS」一键自动编排（属编排层，风险高）
- ❌ 不改任何验证算法、不重算指标

## 9. Risks

| 风险 | 处置 |
|---|---|
| 空态文案写成「无数据」而不写「先去参数搜索」 ⇒ 缺口只是换个地方 | AC-3 明确要求跳转按钮与指引文案 |
| 用户可能选到与目标策略不匹配的搜索 Run | 来源卡片必须显示 Run 的策略 / Dataset 坐标，让用户可判断 |
| `listSearches` 默认分页导致旧 Run 找不到 | 选择器需支持按 Run ID 搜索，或显式提供「查看更多 / 提高 limit」 |

## 10. Dependencies

- 复用：`paramSearch.listSearches` / `getSearchResults`（均已存在）
- 复用组件：`components/common/{ConfirmDialog,StatusBadge,EmptyState,SectionCard}`
- 既有深链行为保持不变（`:runId` 路由段）