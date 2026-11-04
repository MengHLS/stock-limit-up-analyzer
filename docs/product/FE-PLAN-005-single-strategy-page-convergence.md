# FE-PLAN-005 — 单策略专项页收敛（3570001 → 通用策略详情 Tab）

> 日期：**2026-10-07** · 状态：**IMPLEMENTED（规划产出 + 已执行；证据见 §8/§9）** · 作者：Product + Frontend（按 `.agents/product` / `.agents/frontend` / `.agents/orchestrator` 规则产出）
> 上游：`docs/product/FLOW-001-page-workflow.md` §5/§6 的**唯一 P3 遗留**（专项页收敛）· `.agent/task-state.yaml`（Goal `FRONTEND-IA-001`，此前登记「3570001 收敛需产品决策」）
> 下游：`docs/architecture/CHANGE-AUDIT.md`（2026-10-07 · `FLOW-001-P3-3570001-CONVERGENCE-001`）· `docs/architecture/CONTRACT-MAP.md` C-99
> 范围：**纯前端信息架构 / 路由 / 深链**；**0 契约变化 / 0 DB 变化 / 0 执行链变化**。

---

## 0. 一句话

> **侧栏不再出现任何绑定单一策略的选项**；3570001 的「最终评估 / 模拟盘」改由**任意策略版本通用**的策略详情 Tab 承载，两条旧路径保留为**静态改写**（不 404、不渲染第三套视图）。

---

## 1. Goal（Orchestrator SKILL §4.2 七要素）

| 要素 | 内容 |
|---|---|
| **objective** | 收敛 `/strategy-final-evaluation` · `/paper-trading-3570001` 两个单策略专项页，使其能力并入通用入口 |
| **Definition of Done** | ① 侧栏无 3570001 / 无「（专项）」项；② 两条旧路径 → 策略详情对应 Tab 的静态改写；③ 策略详情支持 `?tab=` 深链（白名单 + 切换写回 URL）；④ `pnpm run check` 0 错；⑤ 受影响测试零新增失败；⑥ `checkEolDrift --strict` = 0；⑦ 变更审计与基线文档按影响更新 |
| **verification** | 源码结构锁（`pageFlowContracts` §42–§45）+ 静态类型 + 真实渲染（无头 Edge + CDP：改写落地 + Tab 激活 + 真实鼠标切换写回） |
| **constraints** | 不改 `server/strategyCore/**`；不改 `researchRun.*` 端点形状；不动 `sentiment.*` 端点桶；不动组合回测 `/backtest`；不碰 DB |
| **Scope** | 侧栏 IA · 路由改写 · 策略详情 Tab 深链 · 留档展示入口唯一化 · 对应文档 |
| **Non-goals** | 见 §4 Non-goals |
| **停止条件** | 需要改端点契约 / 需要改策略语义 / 需要动 DB ⇒ 停并 `NEEDS_HUMAN` |

---

## 2. Pipeline（Orchestrator SKILL §7）

```text
PRODUCT        → 定义「用户怎么在 ⑥ 前向与复盘阶段看到 3570001 的留档」
FRONTEND       → 侧栏归位 + 路由改写 + Tab 深链 + 留档入口唯一化
ARCHITECTURE   → 只分析：受影响的入口 / 消费者 / 契约面（不改码）
VERIFICATION   → 结构锁 + 类型 + 打包 + 真实渲染
FINAL          → 报告 + 基线文档收口
```

**裁剪说明（§7.2）**：

| 阶段 | 处置 | 理由 |
|---|---|---|
| `RESEARCH` / `STRATEGY` | **跳过** | 零策略语义 / 零研究口径变化：只改「同一份留档在哪看」 |
| `BACKEND` | **跳过** | 通用端点 `researchRun.getStrategyVersionEvaluation` / `getStrategyVersionPaperTrading` 自 SCOPE-002 S7 已存在且被复用，无需新增 |
| `INTEGRATION` | **合并进 FRONTEND** | 唯一的跨层点 = 前端消费既有端点：无新增契约、无新接线 |
| `REFACTORING` | **合并进 FRONTEND** | 收敛本身就是「删除重复入口」的结构动作，规模不足以单开阶段 |
| `DATABASE`（横切 Gate） | **N/A** | 0 DDL / 0 DML / 0 migration |

---

## 3. PRODUCT 规格（Product SKILL §4/§8 十项）

### 3.1 Feature / Task
单策略专项页收敛：把 3570001 的「最终评估 / 模拟盘」从**单列侧栏项**改为**通用策略详情 Tab** 的一个坐标。

### 3.2 Problem
侧栏长期存在两个只在特定策略上成立的入口（`/strategy-final-evaluation` · `/paper-trading-3570001`），与实际能力不符：

- 能力本身**已经是通用的** —— 策略详情「最终评估 / 模拟盘」Tab 按 `(strategyId, version)` 查询，任何版本都能看；
- 但侧栏仍把 3570001 单列成「（专项）」，等于用导航暗示「这是唯一可看留档的策略」，与实现矛盾；
- 同一份留档出现**三处入口**（侧栏专项项 / 专项页 / 策略详情 Tab），读者无法判断哪一处是权威视图。

### 3.3 User Goal
在 ⑥ 前向与复盘 / ④ 策略 阶段，用户要能**从策略本身出发**看到它的最终评估与模拟盘留档，而不是先记住某个策略编号。

### 3.4 User Story
> 作为策略研究者，我打开任意策略版本，就能在同一个页面的 Tab 里看到它的最终评估与模拟盘留档；旧书签仍然能打开。

### 3.5 Workflow（含失败路径）

```text
入口 A（通用）：侧栏 ④ 策略 → 策略列表 → 某策略 → 选版本 → 「最终评估」/「模拟盘」Tab
入口 B（旧链接）：/strategy-final-evaluation   → 静态改写 → 策略详情 ?version=1.0.0&tab=evaluation
                  /paper-trading-3570001     → 静态改写 → 策略详情 ?version=1.0.0&tab=paper
入口 C（⑥ 阶段）：侧栏 ⑥ 前向纸面交易（本页只负责新建 / 推进）→ 文案指向「策略 → 版本 → 模拟盘」

失败路径：
  · 该版本没有留档        → Tab 内空态（明说「该版本还没有…留档」，不用别的版本数据填充）
  · 端点读取失败          → Tab 内错误态（错误信息 + 不伪造数据）
  · URL 带了非法 tab 值   → 退回 definition（不报错、不猜测）
```

### 3.6 Functional Requirements

| # | 需求 |
|---|---|
| FR-1 | 侧栏不得出现任何单策略坐标 / 「（专项）」项 |
| FR-2 | 两条旧路径必须可达（静态改写，不 404），且改写到**同一个**策略版本坐标 |
| FR-3 | 策略详情必须支持 `?tab=` 深链，取值白名单 = 现有 6 个 Tab |
| FR-4 | Tab 切换必须写回 URL（`replace`），且**不改动** `?version=` |
| FR-5 | 全站留档展示入口必须**唯一**（删除两个专项页文件，不保留第三套视图） |
| FR-6 | 通用 Tab 不得硬编码策略坐标；3570001 的 runner 信号列必须由**留档自身声明**决定是否展示 |

### 3.7 Data / Domain Requirements

| 项 | 内容 |
|---|---|
| 数据来源 | `researchRun.getStrategyVersionEvaluation` · `researchRun.getStrategyVersionPaperTrading`（**既有通用端点**） |
| 坐标 | `(strategyId = first-limit-pullback-3f-top3-runner-hold20, strategyVersion = 1.0.0)`（= 3570001） |
| `datasetVersionId` | **不在前端出现**：留档载荷自带，前端只原样展示，不重算、不推断 |
| 口径 | 指标一律来自留档载荷（服务端 `canonicalMetrics` 口径产物），前端**零重算** |

### 3.8 Business Rules（引用权威，不自造）

- 留档以 `(strategyId, strategyVersion)` 为**唯一坐标**（`docs/architecture/CONTRACT-MAP.md` C-99）；
- 查不到 ⇒ `null` ⇒ 空态，**不伪造**（同 C-99）；
- 「专项端点 → 薄封装」的收敛口径不变：`getFinalEvaluation` / `getPaperTrading3570001` 保留，形状逐字段不变。

### 3.9 Dependencies

| 依赖 | 状态 |
|---|---|
| `researchRun.getStrategyVersion*` 通用端点 | ✅ 已存在（SCOPE-002 S7） |
| 策略详情 Tab（`StrategyVersionArtifactsTabs.tsx`） | ✅ 已存在 |
| `PaperTradingTemplate` 的 `signalColumns` 注入点 | ✅ 已存在 |
| 其它 Agent 前置 | **无** |

### 3.10 Non-goals（本次明确不做）

- ❌ 不退役 `getFinalEvaluation` / `getPaperTrading3570001`（契约保留，现无前端消费者）
- ❌ 不拆 `sentiment.*` 端点桶（跨域，需 Architecture 出 Scope + 用户授权）
- ❌ 不动组合回测 `/backtest`（内容 / 命名 / 位置均不动）
- ❌ 不改 `paperTrading3fTop3Runner/**` 的推进逻辑与调度
- ❌ 不把「未装配 / 未验证」阶段改成静默 success

### 3.11 Risks（含语义冲突）

| 风险 | 评估 |
|---|---|
| 旧书签失效 | 已消除：两条旧路径为静态改写（实测不 404） |
| 留档「三处入口」导致读者误判权威视图 | 已消除：入口唯一化（专项页文件删除） |
| 通用 Tab 丢失策略专属信息 | 部分保留：`NEW_HIGH_3` 信号列按留档声明的 runner 状态条件展示；「3F Top3 排名」列未移植（行序已隐含排名） |
| 语义冲突 | **无**：本任务不触碰 Dataset / PIT / StrategyVersion / canonicalMetrics / Paper Trading 状态语义 |

---

## 4. FRONTEND 方案（Frontend SKILL §8 十项）

### 4.1 Information Architecture（页面 / 区块 / 层级）

```text
侧栏（27 项，无策略坐标）
  ④ 策略        策略 · 参数搜索 · 绩效仪表盘 · 回测历史 · 回测对比 · 组合回测                (6)
  ⑥ 前向与复盘   前向纸面交易 · 复盘工作台                                                  (2)

策略详情 /strategies/:strategyId（6 Tab，坐标 = strategyId + ?version=）
  策略定义 · 运行回测 · 最终评估 · 模拟盘 · 版本与状态 · 验证状态
  ├ 最终评估 → StrategyFinalEvaluationTab（通用）
  └ 模拟盘   → StrategyPaperTradingTab（通用）
```

### 4.2 User Flow

见 §3.5（含空态 / 错误态 / 非法参数态）。**无权限态**：两个查询均为 `publicProcedure`，不因登录态变化。

### 4.3 Component Plan

| 组件 | 处置 | 为什么 |
|---|---|---|
| `StrategyVersionArtifactsTabs.tsx` | **复用并升为唯一入口** | 已按坐标通用化（SCOPE-002 S7），无需重写 |
| `StrategyEvaluationTemplate` / `PaperTradingTemplate` | 复用 | 展示层不重写图表 |
| `AppShell.navGroups` | 删 2 项 | 侧栏不得出现单策略坐标 |
| `App.tsx` 两条 Route | 改 `<Redirect>` | 沿用既有 `/strategy-editor` · `/dataset-builder` 的静态改写惯例 |
| `pages/StrategyFinalEvaluation.tsx` · `pages/PaperTrading3570001.tsx` | **删除** | 「确认无用的重复视图」→ 不留第三套渲染路径 |
| `StrategyDetail` Tabs | 非受控 → **受控** + `?tab=` | 深链是收敛成立的前提（否则改写无处落点） |

### 4.4 State Handling

- 数据获取：两个 Tab 各自 `useQuery`（`refetchOnWindowFocus: false`），**不新增缓存层**；
- 局部状态：`activeTab` 由 **URL 派生**（`?tab=`）而非独立 state ⇒ 刷新 / 分享 / 后退都自洽；
- 切换写回：`setLocation(..., { replace: true })`，保留 `?version=`；
- 非法值：`isStrategyDetailTab()` 白名单守卫 ⇒ 退回 `definition`。

### 4.5 Data Presentation（口径来源 + 是否已验证）

| 项 | 来源 | 已验证 |
|---|---|---|
| 最终评估指标 | 留档 `evaluationDetail`（服务端 `canonicalMetrics` 产物） | ✅ 真实渲染（Tab 激活、无错误态） |
| 模拟盘账户 / Forward | 留档 `paperTradingState` / `paperTradingForwardState` | ✅ 真实渲染 |
| 空态 / 错误态 | `EmptyState` / `ErrorState`，明说「不伪造」 | ✅ 源码 + 渲染 |
| `NEW_HIGH_3` 信号列 | 留档自带 `runner.state` / 信号 `newHigh3` | ⚠️ 条件列（按留档声明展示） |

### 4.6 API / Contract Impact

**NONE**（未新增 / 未修改任何 tRPC 过程与 schema；仅前端消费既有通用端点）。

### 4.7 Accessibility / Consistency Notes

- Tab 触发器沿用 `data-tab` DOM 锚点约定（`pageFlowContracts` §26/§27）；
- 侧栏项 `SidebarMenuButton` 自带 `tooltip` 与 `focus-visible` 环（§41 锁）；
- 深链改写不产生浏览器历史垃圾（`replace`）。

### 4.8 Test Plan（渲染验证方式）

| 层 | 方式 |
|---|---|
| 结构锁 | `tests/client/src/pages/pageFlowContracts.test.ts` §15/§16 + 新增 §42–§45 |
| 类型 | `tsc --noEmit` |
| 打包 | `vite build` |
| 真实渲染 | 无头 Edge + CDP：① 两条旧路径改写落地；② 对应 Tab `data-state=active`；③ **真实鼠标事件**切换 Tab 并写回 URL；④ 侧栏项清单无 3570001 |

### 4.9 Reported Dependencies

**无**（不需要其它 Agent 前置处理）。

---

## 5. ARCHITECTURE 影响（只分析，不改码）

| 面 | 影响 |
|---|---|
| 入口（sidebar） | 移除 2 项；其余 25 项归位不变 |
| 路由表 | 2 条路径从「渲染页面」→「静态改写」，URL 契约对用户保持可用 |
| 消费者 | `StrategyVersionArtifactsTabs.tsx` 成为**唯一**留档展示消费者 |
| 端点 | 零变化（`getFinalEvaluation` / `getPaperTrading3570001` 保留为薄封装） |
| 依赖方向 | 未新增/反转任何边（`client/**` 仍只 `import type` 自 `server/**`） |
| legacy | 两个专项页文件删除 ⇒ **净减少** 一份重复视图 |

---

## 6. 阶段状态对照（`.agent/task-state.yaml`）

| 阶段 | 状态 | 证据 |
|---|---|---|
| `PRODUCT` | **COMPLETE** | 本文件 §3（Product §8 十项齐全） |
| `FRONTEND` | **COMPLETE** | §4 + 6 个前端文件改动 |
| `ARCHITECTURE` | **COMPLETE** | §5（仅分析） |
| `VERIFICATION` | **COMPLETE** | §8 / §9 证据 |
| `FINAL` | **COMPLETE** | `CHANGE-AUDIT` + `CONTRACT-MAP` + `FLOW-001` 已更新 |

---

## 7. Acceptance Criteria（逐条可测）

| # | 验收标准 | 判定方式 | 结果 |
|---|---|---|---|
| AC-1 | 侧栏不出现 `3570001` / `（专项）` / 两条专项路径 | 源码扫描 + 真实 DOM 清单 | ✅ 27 项、命中 0 |
| AC-2 | `/strategy-final-evaluation` 改写为 `...?version=1.0.0&tab=evaluation` | 真实浏览器 URL | ✅ |
| AC-3 | `/paper-trading-3570001` 改写为 `...?version=1.0.0&tab=paper` | 真实浏览器 URL | ✅ |
| AC-4 | 改写后对应 Tab `data-state=active` | 真实 DOM | ✅ 两个都命中 |
| AC-5 | 非法 `?tab=` 不崩、退回 `definition` | 白名单守卫 + 结构锁 §44 | ✅ |
| AC-6 | 切换 Tab 写回 URL 且保留 `?version=` | 真实鼠标事件 + URL | ✅ |
| AC-7 | 留档展示入口唯一（专项页文件不存在） | `existsSync` 断言 + 文件删除 | ✅ |
| AC-8 | 通用 Tab 不硬编码策略坐标 | 结构锁 §45 | ✅ |

---

## 8. Verification 记录

```text
tsc --noEmit                                  → 0 错
vitest run tests/client/src/pages/pageFlowContracts.test.ts          → 44/44
vitest run tests/server/closedLoopBacktestRun/strategyVersionArtifacts.test.ts → 7/7
vite build                                    → 成功（3115 modules）
node scripts/checkEolDrift.mjs --strict       → 0（已跟踪漂移 0 / 未跟踪 CRLF 0）
真实渲染（无头 Edge + CDP，桌面视口）          → 改写 2/2 · Tab active 2/2 · 真实鼠标切换写回 1/1 · 侧栏清单 27 项
```

**行为判定**：`Expected`（等价能力 + 入口归位），**无 `Unexpected` / `Unknown`**。

---

## 9. Risks / Needs Human

| 项 | 说明 |
|---|---|
| `NEEDS_HUMAN` | **无**（未触碰业务语义 / 契约 / DB；收敛时机由用户在本轮明确给出） |
| 观察项 1 | 侧栏 27 项里 `/stock-selection` 来自**并发会话未提交改动**，已一并纳入 `pageFlowContracts` §15 集合；若那条改动被回滚，需同步回退该断言 |
| 观察项 2 | `.agent/task-state.yaml` 原把「3570001 收敛」列为待决策项，本任务完成后已同步为 `SPECIAL_PAGE_CONVERGENCE: COMPLETE` |
| 观察项 3 | 原专项页的「3F Top3 排名」列未移植（行序已隐含排名）；如需恢复应在 `StrategyVersionArtifactsTabs` 内以**数据驱动**方式实现 |

---

## 10. Implementation Handoff（按顺序）

```text
1. PRODUCT      → 本文件 §3（已完成）
2. FRONTEND     → AppShell 删项 · App.tsx 改写 · StrategyDetail ?tab= · 删两个专项页（已完成）
3. ARCHITECTURE → 只分析影响面（§5，已完成）
4. VERIFICATION → §8 全部通过（已完成）
5. FINAL        → CHANGE-AUDIT / CONTRACT-MAP / FLOW-001 / INDEX / task-state 收口
```
