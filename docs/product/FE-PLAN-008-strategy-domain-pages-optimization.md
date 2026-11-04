# FE-PLAN-008 — ④「策略」域页面优化方案（PROPOSED · 只出计划，不改代码）

> 日期：**2026-10-07** · 状态：**DECIDED + 部分 IMPLEMENTED**（NH-1 **B** · NH-2 **A** · NH-3 **暂不立项**；S1 / NH-2A / NH-1B 已落地并验证，S2 待做）· 作者：Product + Frontend（按 `.agents/product` §8 + `.agents/frontend` §8 + `.agents/orchestrator` §4.2/§7 产出）
> 范围：侧栏 **④ 策略** 组的入口页 + 策略详情的 6 个 Tab
> 证据来源：**真实渲染截图**（2026-10-07 无头 Edge，本机 dev server）+ **源码实查**（下附 `文件:符号`）
> 上游：`FE-PLAN-005`（专项页收敛）· `FE-PLAN-006`（诚实三态）

---

## 0. 一句话

> 把「策略」域从 **6 个各自为政的页面**，收成 **一条可深链的坐标链**：同一个 `strategyId + version` 在 列表 → 详情 6 Tab → 参数搜索 → 绩效 → 回测历史 → 回测对比 之间**可跳、可返回、可读**。

---

## 1. 现状盘点（实测，不是假设）

| 入口 | 路由 | URL 坐标 | 页面职责 | 实测结论 |
|---|---|---|---|---|
| 策略（列表） | `/strategies` | — | 列出策略与版本 | h1 存在；行内跳详情 |
| 策略详情 | `/strategies/:strategyId` | `?version=` ✅ · `?tab=` ✅（本次新增） | 6 Tab：策略定义 / 运行回测 / 最终评估 / 模拟盘 / 版本与状态 / 验证状态 | 6 个 Tab 均可达；`?tab=` 白名单深链已回归锁定 |
| 版本演化 | `/strategies/:strategyId/compare` | `?strategyId=` ✅ | 多版本留档对比 | 已处理主查询错误（`catalogQuery.error`） |
| 参数搜索 | `/parameter-search` | `?searchRunId=` ✅ · `strategyId`/`version` ✅ | 参数搜索 Run | 坐标最完整的一个 |
| 绩效仪表盘 | `/performance` | **无任何 URL 坐标** ❌ | `researchRun.readiness` + `sentiment.getLeaderCandidateBacktest` | **技术预览骨架**：与「某个策略版本」无绑定 |
| 回测历史 | `/backtest-runs` | `?strategyId=` ✅（无 version） | 闭环回测留档列表 | 缺 version 维度 |
| 回测对比 | `/backtest-compare` | `?strategyId=` ✅（无 version） | 多版本累计收益 + 交易明细 | 缺 version 维度 |
| 组合回测 | `/backtest` | — | 组合回测工作台 | 🔒 **保持不变**（用户此前明确要求） |

---

## 2. 问题清单（按证据强度排序）

### P0-1 · 模拟盘留档把 `securityId` 当「股票」列印（**截图可见**）

| 项 | 内容 |
|---|---|
| 证据 | 真实渲染：`今日策略池` 的「股票」列显示 `sec_63f8df6e-06a2-46b0-b4de-02936b4ce675:event:002279.SZ@2026-08-28` |
| 位置 | `client/src/components/strategy/PaperTradingTemplate.tsx`（今日策略池 `s.stock` / 近期信号 `s.stock` / 当前持仓 `p.stock`，共 3 张表） |
| 为什么是缺陷 | 仓库**已经有**这个问题的专用解法与明确纪律：`client/src/hooks/useSecurityLabels.ts` 头注释原文 ——「闭环回测结果里 `trades[].securityId` 是 Research canonical identity `sec_<uuid>`，直接印在表格里用户看不懂。**前端不做任何身份翻译**」；该 hook 目前只有 1 个消费者（`ClosedLoopRunResultPanel.tsx`），模拟盘留档**没接**。 |
| 建议修法 | 复用 `useSecurityLabels()`（+ `SecurityLabelChunks`）渲染「名称 / 代码」，未加载或查询失败时**回退原始 id**（hook 已保证不抛错、不阻断整块结果） |
| 影响面 | 低：只改展示；复用既有只读端点 `researchRun.securityLabels`；**无契约变更** |

### P0-2 · 策略域「坐标不贯通」

| 项 | 内容 |
|---|---|
| 证据 | 源码实查：`PerformanceDashboard.tsx` 无 `useSearch`/`useParams`、无 `strategyId`/`version` 参数；`BacktestRuns.tsx` / `BacktestCompare.tsx` 仅识别 `strategyId`，无 version 维度 |
| 用户代价 | 「我在看这个策略版本的绩效/留档」这件事**无法分享、无法刷新保持**；从详情页跳到绩效后**丢了坐标**，只能靠人记 |
| 建议修法（分层） | ① 低成本：`BacktestRuns` / `BacktestCompare` 的 `?strategyId=` **补齐 `&version=`** 的显式承接（已支持则只补文档与入口）；② 中成本：策略详情各 Tab 与列表页补「带坐标的出口链接」；③ **绩效仪表盘参数化**属产品取舍（见 NEEDS_HUMAN-1） |
| 影响面 | ① 低（URL 读写，不改契约）；③ 高（页面定位本身要裁定） |

### P1-1 · 版本状态徽章语义易被误读

| 项 | 内容 |
|---|---|
| 证据 | 真实渲染：策略详情头部同时出现大标题与 `Draft` 徽章（`client/src/components/strategy/StrategyHeader.tsx` 的 `StatusBadge status={versionStatus}`），版本下拉显示 `1.0.0 · Draft`；而该版本**已有最终评估与模拟盘留档**（129.69% / 1453 笔） |
| 风险点 | ① `Draft` 是**生命周期状态**，读者容易误读成「还没保存的草稿」；② `client/src/adapters/strategyListAdapter.ts` 在**拿不到 status 时 fallback 成 `"Draft"`** ⇒ 可能显示**看起来像真实状态的假状态** |
| 建议修法 | ① 徽章加 `title`/tooltip 说明「生命周期状态，与是否留档无关」；② 列表/adapter 的缺省值改为**显式未知**（如 `—` / `UNKNOWN` 且配色中性），不冒充 `Draft` |
| 影响面 | 低（展示 + 缺省值）；**不动**生命周期八态语义（属 Strategy 域） |

### P1-2 · 详情页各 Tab 的「产出 → 下一步」出口不明确（**待实测**）

| 项 | 内容 |
|---|---|
| 假设 | 「运行回测」Tab 跑完后，用户要去找留档只能自己想到「回测历史 / 回测对比 / 最终评估」 |
| 待做 | **先实测**（真实渲染点一遍运行回测 → 看有没有出口），证据成立才立项；不成立则撤销该条 |
| 影响面 | 低（加显式出口链接） |

### P2-1 · 绩效仪表盘与「最终评估」的职责重叠

| 项 | 内容 |
|---|---|
| 事实 | `/performance` 自述为**技术预览**（「指标口径可参考，但不得据此下正式策略结论」），数据源是 `sentiment.getLeaderCandidateBacktest`（生产回测），**与策略版本坐标无关**；而策略详情「最终评估」Tab 才是**按版本留档**的正式口径 |
| 风险 | 两个页面都在讲「绩效」，一个无坐标（预览）、一个有坐标（留档）⇒ 读者难以判断该信哪个 |
| 建议 | 属**产品裁定**：A 页面顶部加醒目的「技术预览 · 与策略版本无关」隔离条（对齐 R7 既有做法）；B 收敛进策略详情；C 参数化到版本坐标（成本最高）。见 NEEDS_HUMAN-1 |

---

## 3. 目标形态（IA 草图）

```text
④ 策略
  策略列表 /strategies
    └─ 详情 /strategies/:id?version=&tab=            ← 坐标唯一入口（6 Tab）
         ├─ 策略定义      （编辑 → 另存为新版本）
         ├─ 运行回测      （跑 → 留档）──┐
         ├─ 最终评估      ← 版本留档（正式口径）
         ├─ 模拟盘        ← 版本留档（P0-1 修 3 张表的证券展示）
         ├─ 版本与状态    ← 多版本 / 指纹 / 溯源
         └─ 验证状态      ← 三块验证跑没跑过
              ↓ 带坐标的出口
  参数搜索 /parameter-search?strategyId=&version=
  回测历史 /backtest-runs?strategyId=&version=     （P0-2 ①）
  回测对比 /backtest-compare?strategyId=&version=  （P0-2 ①）
  绩效仪表盘 /performance                          （P2-1 待裁定）
```

---

## 4. Product 规格（§8 十项）

| 项 | 内容 |
|---|---|
| **Feature / Task** | ④「策略」域页面优化（可读性 + 坐标贯通 + 状态语义） |
| **Problem** | 策略域内「同一版本」的上下文在页面之间会丢：留档表格不可读（securityId）、绩效/留档页缺坐标、生命周期状态直出不解释 |
| **User Goal** | 我能**始终知道自己在看哪个策略版本**，并且**看得懂表格里的人话**（名称/代码），不需要自己记 ID |
| **User Story** | 作为策略研究者，我在策略详情跑完回测后，能直接跳到带着同一坐标的留档/对比/评估，并且贴给别人时链接打开就是同一版本 |
| **Workflow** | 列表 → 详情（选版本）→ 跑/看 6 Tab → 带坐标跳到参数搜索/回测历史/回测对比；失败路径：留档缺失 ⇒ 空态；读取失败 ⇒ 错误态（`FE-PLAN-006` 已锁） |
| **Inputs** | `strategyId`、`version`（URL 坐标）；模拟盘留档载荷里的 `securityId` 列表 |
| **Outputs** | 带坐标的可分享 URL；「名称 + 代码」可读的留档表格；语义正确的状态徽章 |
| **Business Rules（引用权威）** | 留档坐标 = `(strategyId, strategyVersion)`（CONTRACT-MAP C-99）；证券身份翻译**只走服务端** `researchRun.securityLabels`（`useSecurityLabels` 头注释）；生命周期八态语义归 Strategy 域，前端只展示 |
| **Dependencies** | P0-1 依赖既有只读端点 `researchRun.securityLabels`；P0-2 ③ 依赖产品对「绩效仪表盘」的定位裁定 |
| **Acceptance Criteria** | 见 §7（逐条可测） |
| **Non-goals** | 见 §6 |
| **Risks** | ① P0-1 若改为「必须显示名称」会放大 `securityLabels` 失败的影响 ⇒ 因此**必须**保留「失败回退原始 id」；② P0-2 若顺手把绩效仪表盘参数化，可能造出**第二套绩效口径**（违反「禁止第二套 SoT」）⇒ 必须先裁定 |

---

## 5. Frontend 方案（§8 十项）

| 项 | 内容 |
|---|---|
| **Information Architecture** | 见 §3；原则：**一个坐标贯穿**，页面之间用链接而不是让用户记 ID |
| **User Flow** | 详情 6 Tab → 各 Tab 底部/头部提供「带同一坐标的下一步」出口；错误/空态沿用 `FE-PLAN-006` 的诚实三态 |
| **Component Plan** | **复用**：`useSecurityLabels()` + `SecurityLabelChunks`（P0-1）、`StatusBadge`（P1-1）、`ErrorState`/`EmptyState`；**新增**：详情页内一个「带坐标的下一步」链接组（小组件）；**不新增**表格封装、不新增第二套指标组件 |
| **State Handling** | 坐标一律**由 URL 派生**（延续 `FE-PLAN-005` 的 `?tab=` 做法），不引入新的全局状态；证券标签走 hook 既有会话级缓存（`staleTime` 5 分钟，失败回退） |
| **Data Presentation** | 证券展示 = 服务端标签（名称 + 代码），失败回退原始 id **并保持列宽稳定**；指标口径不动（`canonicalMetrics` / 留档原样） |
| **API / Contract Impact** | P0-1 = **NONE**（复用既有端点）；P0-2 ① = NONE（只读写 URL）；P0-2 ③ / P2-1 = **可能需要契约或产品裁定** ⇒ 不在本轮自动执行 |
| **Accessibility / Consistency Notes** | 沿用 `data-tab` / `aria-label` / `focus-visible` 既有约定；P0-1 的表格列宽不可因标签升降级跳动 |
| **Test Plan** | ① 结构锁：`pageFlowContracts` 增定点锁（模拟盘 3 表引用 `useSecurityLabels`、失败回退存在）；② 真实渲染：无头 Edge 打开模拟盘 Tab 断言出现「代码 + 名称」、并模拟 `securityLabels` 失败断言回退原始 id 且不崩；③ 坐标锁：解析各页 URL 参数一致性 |
| **Reported Dependencies** | NEEDS_HUMAN-1（绩效仪表盘定位）与 NEEDS_HUMAN-2（`Draft` 缺省值是否改）需先裁定 |

---

## 6. Non-goals

- ❌ 不动组合回测 `/backtest`（内容 / 命名 / 位置均不动）
- ❌ 不改任何策略语义（生命周期八态 / RuleGraph / 参数角色 / 版本指纹）
- ❌ 不改任何端点契约或 DB（P0-1 用既有只读端点，P0-2 ① 只动 URL）
- ❌ 不为「绩效」新建第二套口径组件（禁止第二套 SoT）
- ❌ 不做全站表格收敛（见 `FE-PLAN-007`：服务端分页属契约变更）

---

## 7. 验收标准（逐条可测）

| # | 对应项 | 标准 |
|---|---|---|
| AC-1 | P0-1 | 模拟盘「今日策略池 / 近期信号 / 当前持仓」三张表的证券列显示**代码 + 名称**（有标签时），不再出现整串 `sec_<uuid>` |
| AC-2 | P0-1 | 模拟 `researchRun.securityLabels` 失败 ⇒ 三张表**回退显示原始 id**、无报错、无整块崩溃 |
| AC-3 | P0-2 ① | 从策略详情任一 Tab 跳出的「回测历史 / 回测对比」链接**自带 `strategyId` + `version`**，落地页解析该坐标为当前选中版本 |
| AC-4 | P1-1 | 版本状态徽章有可读解释（tooltip/title 或相邻图例）；缺省 status 不再冒充 `Draft` |
| AC-5 | 全部 | `pnpm run check` 0 错 · 受影响测试零新增失败 · `checkEolDrift --strict` = 0 · 真实渲染证据齐 |

---

## 8. Pipeline（Orchestrator §7）与阶段门槛

```text
PRODUCT        → 本文件（含 NEEDS_HUMAN 裁定点）
FRONTEND       → P0-1（可自主）· P0-2 ①（可自主）· P1-1（含 1 个裁定点）
ARCHITECTURE   → 仅当进入 P0-2 ③ / P2-1（涉及页面定位或契约）时必读
VERIFICATION   → 结构锁 + 真实渲染（含失败回退路径）
FINAL          → CHANGE-AUDIT / INDEX / task-state
DATABASE       → N/A（只读端点复用，0 DDL / 0 DML）
```

**READY 判定**：P0-1 / P0-2 ① / P1-2（先实测）满足 → 可立即进入 FRONTEND；P1-1 的缺省值部分与 P2-1 需先取裁定。

---

## 9. NEEDS_HUMAN（请裁定后再进入对应阶段）

| # | 待裁定 | 选项与代价 |
| ~~NH-1~~ | ✅ **已裁定 = B（收敛进策略详情）** | 2026-10-07 用户裁定；落地方式见 §11-S1 记录：绩效**入口**收敛，`/performance` 保留可达但退出侧栏 + 顶部归属声明（同 `/walk-forward` 旧预览先例） |
|---|---|---|
| NH-1 | `/performance` 的定位 | **A** 维持技术预览 + 加隔离条（成本低，与 R7 做法一致）· **B** 收敛进策略详情（入口少一个，但删页需谨慎）· **C** 参数化到 `strategyId+version`（最贵，且要防第二套绩效口径） |
| ~~NH-2~~ | ✅ **已裁定 = A（改为显式未知）** | 2026-10-07 用户裁定；已落地：`asStr(raw.status, "UNKNOWN")`（受控词表既有值，neutral 色） |
| ~~NH-3~~ | ✅ **暂不立项**（2026-10-07 用户裁定）；本方案对该条不再推进 | — |

---

## 10. 建议顺序（每步都能单独验收）

| 步 | 内容 | 依赖 | 预估 |
|---|---|---|---|
| S1 | P0-1 证券可读化（3 张表 + 失败回退 + 结构锁 + 真实渲染） | 无 | 0.5d |
| S2 | P0-2 ① 出口链接带坐标（详情 → 回测历史/回测对比） | 无 | 0.5d |
| S3 | P1-2 实测「运行回测」Tab 有无产出出口 → 决定立项 | 无 | 0.2d |
| S4 | P1-1 徽章解释（NH-2 裁定后一并做缺省值） | NH-2 | 0.3d |
| S5 | P2-1 绩效仪表盘定位落地 | NH-1 | 待裁定 |

---

## 11. 执行记录（2026-10-07）

**S1 · P0-1 证券可读化（DONE）**

- 抽公共组件 `client/src/components/strategy/SecurityCell.tsx`（四种如实状态：有名称+代码 / 有代码无名称 / 字典未到回退原始 id / identity 不在历史回退原始 id）。
- `ClosedLoopRunResultPanel` 删除本地实现改为 import（**消除重复**，非新增第二套）。
- `PaperTradingTemplate` 4 张表（今日策略池 / 近期信号 / 当前持仓 / 历史交易）全部改走 `SecurityCell`，并在模板内渲染 `<SecurityLabelChunks>` 发起只读标签查询。
- **真实渲染证据**：模拟盘 Tab 现显示「久其软件 / 002279.SZ」「柳钢股份 / 601003.SH」「天融信 / 002212.SZ」；页面全文 `sec_<uuid>` 命中 **0**（改前同位置显示 `sec_63f8df6e-…:event:002279.SZ@2026-08-28`）。

**NH-2 A（DONE）**：`adapters/strategyListAdapter.ts` 缺省 `status` 由 `"Draft"` → `"UNKNOWN"`；`StatusBadge` 新增 `title` prop，`StrategyHeader` 生命周期徽章补「与是否存在留档无关」的解释。

**NH-1 B（DONE）**：侧栏 ④ 策略 6→5（删「绩效仪表盘」）；`/performance` 保留可达并加顶部归属声明 + 指向「策略 → 该版本 → 最终评估」。

**S2（未做）**：详情 Tab 的「带坐标出口链接」尚未落地，留作下一轮。

**验证**：`tsc --noEmit` 0 错；`pageFlowContracts` **50/50**（新增 §49–§51）；真实渲染 2 项全中。
