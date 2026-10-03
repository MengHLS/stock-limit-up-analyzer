# FE-PLAN-001 — 验证域输入来源显式化（PD-04 组件级实现方案）

> 日期 2026-10-03 · 作者 **Frontend Agent** · 上游 `SPEC-001-PD04-validation-input-source.md`
> 状态 **READY for Implementation**（本文件只给方案，**不改代码**）· 目标验收 = SPEC-001 §7 的 AC-1~AC-7

---

## 0. 关键设计决策（先定，避免实现期反复）

| 决策 | 内容 | 理由 |
|---|---|---|
| **D1** | 「源搜索 Run」由 **`paramSearch.listSearches`** 驱动，改为**下拉选择器** | 端点已存在，零后端改动 |
| **D2** | OOS 的 `parameterHash` 由 **`paramSearch.getSearchResults(runId)`** 驱动，改为**级联选择器** | 该端点已返回组合的 `parameterHash`；用户不该手抄哈希 |
| **D3** | 只把**已完成（COMPLETED）** 的搜索 Run 放进选项 | 契约要求源须 COMPLETED；提前置灰优于提交后报错 |
| **D4** | 新增**共享展示组件** `ValidationSourcePicker`，三页复用 | 避免三处重复实现；WFA 用不同 props 形态 |
| **D5** | 「是否重跑」用**统一徽章** `RerunBadge`，文案与颜色固定 | SPEC-001 规则 4 / 5：视觉不得暗示未验证结果更好 |

## 1. 变更清单

### 1.1 新增共享组件（2 个）

| 文件 | 责任 | 关键 props |
|---|---|---|
| `client/src/components/validation/ValidationSourcePicker.tsx` | 源搜索 Run 选择器 + 来源卡片 + 空态 | `value` / `onChange` / `listQuery` / `emptyActionHref` |
| `client/src/components/validation/RerunBadge.tsx` | 「零重跑 / 真重跑 / 每 Fold 真重跑」徽章 | `kind: "NO_RERUN" \| "RERUN" \| "PER_FOLD_RERUN"` |

**`ValidationSourcePicker` 内部结构**

```text
① 来源选择器（Select）
     options = listSearches({ limit: 50 })
                .filter(r => r.status === "COMPLETED")
                .map(r => ({ value: r.searchRunId, label: `${r.searchRunId} · ${r.strategyId ?? "—"}` }))
② 来源卡片（选中后显示）
     Run ID · 状态 · datasetVersionId · 参数集摘要 · 冻结/创建时间
③ 空态（无可用 Run 时替换①②）
     文案：「请先到『参数搜索』跑一次搜索（需状态为 COMPLETED）」
     + 主按钮「前往参数搜索」→ /parameter-search
④ 加载 / 错误态（复用 common/ErrorState）
```

### 1.2 改造既有面板（3 个文件）

| 文件 | 现状 | 改动 |
|---|---|---|
| `client/src/components/robustness/SearchRobustnessPanel.tsx` | `sourceSearchRunId` 为 **text Input**（`:263-269`），标题已写「① 选一个已完成的 Parameter Search Run」 | 把 `:261-269` 的 `<Input>` 换成 `<ValidationSourcePicker>`；`createButton.disabled` 条件改为「未选源」（保持既有 `sourceSearchRunId.trim()===""` 语义即可）；表单区顶部加 `<RerunBadge kind="NO_RERUN" />` |
| `client/src/components/oos/OosValidationPanel.tsx` | `form.sourceSearchRunId` + `form.parameterHash` 均为 **text Input**；`formReady` 在 `:216-220` | `sourceSearchRunId` → `<ValidationSourcePicker>`；`parameterHash` → **级联 Select**（`getSearchResults(selectedRunId)` 的 `combinations[].parameterHash`）；`formReady` 改为「三项皆非空」；顶部加 `<RerunBadge kind="RERUN" />` |
| `client/src/components/walkForward/WalkForwardPanel.tsx` | `strategyId` / `strategyVersion` / `datasetVersionId` 手填（`:160-173`） | 三个字段改**选择式**（策略 → 版本 → Dataset 版本）；选中后显示 `datasetVersionId`；顶部加 `<RerunBadge kind="PER_FOLD_RERUN" />` |

### 1.3 不需要改的（明确）

- ❌ `server/**`（端点/契约一律不动）
- ❌ 三个验证页 `client/src/pages/validation/*.tsx`（它们是壳，只传 props）
- ❌ 深链行为（`:runId` 路由段、`buildPanelLocation`）
- ❌ 既有 `ConfirmDialog` 的二次确认流程

## 2. 复用清单（避免重复组件）

| 复用 | 用途 |
|---|---|
| `components/common/SectionCard` | 面板外壳（已有） |
| `components/common/StatusBadge` | Run 状态显示 |
| `components/common/EmptyState` | 空态 |
| `components/common/ErrorState` | 查询失败 |
| `components/common/MetricCard` | 来源卡片字段（可选） |
| `components/ui/{select,button,input}` | 基础控件 |

## 3. 测试计划

| 层 | 内容 |
|---|---|
| 单测（新增） | `ValidationSourcePicker`：只列出 COMPLETED；无可用 Run → 空态 + 创建禁用 |
| 单测（新增） | `RerunBadge`：三种 kind 的文案正确 |
| 面板测试 | 若既有面板已有测试则扩展；否则以 AC 逐条手工/无头验证为准 |
| 类型 | `pnpm run check` 0 错 |
| 行尾 | `checkEolDrift --strict` = 0 |
| 渲染验证 | 三页各截一次真实渲染（无头量 DOM），确认无「手填 Run ID」输入框残留（AC-1） |

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| `listSearches` 默认 limit=50，旧 Run 找不到 | 选择器加**按 Run ID 搜索**输入（fuzzy 过滤本地列表）+「查看更多」提高 limit |
| 选到与目标策略不匹配的 Run | 来源卡片显示 `strategyId` / `datasetVersionId`，让用户可判断 |
| OOS 级联在源变更后残留旧 `parameterHash` | 源变更时**清空** `parameterHash` 选择 |
| 空态文案写成「无数据」 | 规则：必须含「请先跑一次参数搜索」+ 跳转按钮（AC-3） |
| 三处复制 → 后续漂移 | 强制走共享组件（D4），禁止在面板内各写一份 |

## 5. 交付顺序（建议）

```text
1. 新增 RerunBadge + ValidationSourcePicker（含单测）
2. 接 robustness 面板（最小改动，验证组件契约）
3. 接 oos 面板（含级联选择器）
4. 接 walkForward 面板（策略/版本/Dataset 选择式）
5. 三页渲染验证 + pnpm run check + EOL
6. Verification（Before/After：三个面板的创建 payload 形状不变）
```

**⚠️ Verification 判据**：创建请求的 **payload 字段与取值语义必须与改动前一致**（`sourceSearchRunId` / `parameterHash` / `oosWindow{startDate,endDate}` / WFA 的 `strategyId,strategyVersion,datasetVersionId,windowConfig`）—— 本次只改**输入方式**，不改**提交内容**。