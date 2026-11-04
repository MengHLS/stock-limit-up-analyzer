# PRODUCT-DECISIONS-001 — 研究流程四缺口决策记录

> 日期：**2026-10-03** · 状态：**DECIDED（4/4 已确认；PD-02 已执行）** · 作者：Product Agent
> 上游：`docs/product/FLOW-001-page-workflow.md` 的 §6 四缺口（页面流程梳理的观察项）
> 输入事实：实查代码（`client/src/**` · `server/routers.ts` · `server/research/**` · `drizzle/schema.ts`），非历史文档
> 范围：**仅产品决策**。不含实现方案、不改代码、不改契约、不改 DB。
> 关联不变量：`AGENTS.md` §2（`datasetVersionId` / PIT / `decisionOffsetDays` / StrategyVersion / provenance / `canonicalMetrics`）

---

## 0. 决策总览

| # | 缺口 | 决策 | 需要动什么 | 归属 |
|---|---|---|---|---|
| **PD-01** | ②→③ 无「研究问题」承载物 | 🟡 **不建独立功能**（改预填跳转） | 纯前端 | Frontend |
| **PD-02** | Finding / Conclusion 无正式页面 | 🔴 **明确不暴露（DECLINE）** | 修订 `.agents/frontend/SKILL.md` 措辞 | Product |
| **PD-03** | Candidate 有详情、无列表 | 🟢 **建**（只读列表 + 转正入口） | 新增只读端点 `strategyCandidate.list` | Architecture → Frontend |
| **PD-04** | ⑤ 验证页输入来源不可见 | 🟢 **建**（选择器 + 来源卡片 + 重跑标识） | 纯前端 | Frontend |
| **PD-05** | 首页 `/` 不是研究流程入口 | 🟢 **建**（六阶段入口带，**加法**，不动行情总览） | 纯前端 | Frontend |

---

> **下游产物**：`SPEC-001-PD04-validation-input-source.md` · `SPEC-002-PD01-observation-to-experiment.md` · `SPEC-003-PD03-candidate-list.md`
> **实现方案 / Scope**：`FE-PLAN-001-PD04-validation-input-source.md` · `FE-PLAN-002-PD01-observation-entry.md` · `docs/architecture/SCOPE-001-candidate-list-endpoint.md`

---

## PD-01 · 研究问题承载物 —— **不建独立功能**

| 项 | 内容 |
|---|---|
| **Decision** | **不建**独立的「研究问题」实体/页面。明确 **「实验（Experiment）即假设的载体」**；只在②观察页增加一条**最小跳转**：从当前观察上下文带 `datasetVersionId` + 观察坐标预填到实验详情。 |
| **Reason** | ① 独立实验体系的既定前提是「一个实验 = 一个 `ExperimentDefinition`」，新增「研究问题」实体需要新表 + 新契约，违反「新增实验不改 Research Core / tRPC / DB」的既有纪律；② 真正缺的不是「记录问题的表」，而是**从观察跳到实验的通道**——现在用户要自己记住看的是哪一版数据、哪个事件。 |
| **Current Status** | 观察页（`/limit-up` `/market` `/sentiment-analysis` `/leader-candidates`）**不显示**当前 `datasetVersionId`；实验详情**已支持** Dataset 版本选择器（坐标进 URL）+ 参数表单 ⇒ 预填条件已具备。 |
| **Affected** | `client/src/pages/{LimitUpReview,Market,SentimentAnalysis,LeaderCandidates}.tsx` · 实验详情路由参数 |
| **Non-goals** | ❌ 不建问题管理 / 评论 / 协作 / 优先级排序 ❌ 不新建表 ❌ 不改 `researchExperiments.*` 契约 |
| **⚠️ 前提修正（2026-10-03）** | 原表述「带 `datasetVersionId` 预填到实验详情」**在代码上不可实现**：5 个观察页（`/` `/limit-up` `/market` `/sentiment-analysis` `/leader-candidates`）**全部 dataset-unaware**——它们读 legacy 表（`limit_up_records` 等），不存在可携带的数据集坐标。改为**跳转入口**（不携带坐标），并要求文案写明「实验需自行选择 Dataset 版本」。见 `SPEC-002` §1。 |
| **Risk / 触发重评** | 若实验数 **> 50** 或同一模式族 **> 15**，按名检索失效 ⇒ 重新评估是否需要一个「问题/假设」索引层。 |

---

## PD-02 · Finding / Conclusion —— **明确不暴露（DECLINE）**

| 项 | 内容 |
|---|---|
| **Decision** | **明确不暴露**这两个概念。不恢复页面，不恢复数据模型。保留的唯一追溯物是 **provenance**（`strategy_research_provenance` + 证据指纹），继续由策略详情的溯源面板承载。 |
| **Reason** | 这不是「页面缺失」，而是**这套数据模型已被有意废弃**：`RESEARCH-EXPERIMENT-003` 已把旧 Research 链整体退役（旧单数 10 表 DROP / RENAME 为 `archive_research_*`，代码侧零引用）。补齐页面 = 把已退役的语义重新拉回生产链。独立实验体系的原则是「结果 = 通用信封 + **实验自定义 payload**」，本就不套用平台的 Finding/Conclusion。 |
| **Current Status** | `research_finding` / `research_conclusion` 等表已在迁移 `0046` 归档；`server/researchCore|researchEngine|researchPlanner` 已删除；UI 上无任何入口。 |
| **Affected** | `.agents/frontend/SKILL.md` §3「Result 五概念」措辞（**必须同步修订**，否则 Skill 与产品现实冲突） |
| **Non-goals** | ❌ 不恢复 `research_finding` / `research_conclusion` 表 ❌ 不重建 Finding/Conclusion 页面 ❌ 不做「兼容旧链路的可选适配层」 |
| **✅ 已执行（2026-10-03，用户确认后）** | `.agents/frontend/SKILL.md` §3 的 Result 概念已改为「**Raw Result / 实验结论（自定义 payload）/ Candidate / Strategy / Provenance**」，并显式写明 Finding / Conclusion **不属于本平台概念**（附本记录作为决策依据）。 |
| **余波修正（2026-10-03，用户确认后）** | 消除同一矛盾在别处的残留：`.agents/research/SKILL.md`（frontmatter `description` + §1 链路 + §4 provenance + §8 输出模板）与 `AGENTS.md` §7 Skill 表 research 行，均已改为「Run → **实验结论（自定义 payload）** → Candidate → Strategy」并注明 Finding / Conclusion 已退役。 |
| **Risk** | 若未来出现「需要平台级统一结论词表」的需求（例如跨实验元分析），本决策需要重评——触发条件：出现 ≥2 个需要横向汇总结论的用例。 |

---

## PD-03 · Candidate 列表 —— **建**（只读列表 + 转正入口）

| 项 | 内容 |
|---|---|
| **Decision** | **建**。在③研究阶段出口提供**跨实验的候选只读列表**，支持跳转详情与复用既有转正动作。 |
| **Reason** | ① Candidate 是 ③→④ 的交接物，没有列表用户无法回答「我发现了哪些候选」；② 成本可控——`research_strategy_candidate` 表**仍在**（003 明确保留为过渡实体），且仓储层**已有** `ResearchStrategyCandidateRepository.list(filter)`（`server/research/candidateRepository.ts:90`）；③ 详情页 `StrategyCandidateDetail` 与 `PromoteCandidateDialog` 已存在可复用。 |
| **Current Status** | 仓储能力 ✅ 存在 · tRPC 暴露 ❌ **缺失**（`strategyCandidate` router 仅有 `get / update / transition / promote / getVersionProvenance`）· 前端详情页 ✅ 存在 · 列表页 ❌ 不存在 |
| **Affected** | ① `server/research/strategyCandidate/router.ts`（新增只读 `list`）② 可能的 list item 契约 ③ 新增列表页 + 路由 + 侧栏「③ 研究」入口 |
| **Scope 约束** | 只读列表 + 跳详情 + 复用既有转正；**筛选维度**只允许已有的 `status` / `sourceDatasetVersionId`。 |
| **Non-goals** | ❌ 批量操作 ❌ 跨实验对比 ❌ 新表 ❌ 修改候选写入语义 ❌ 使用 `experimentId` / `conclusionId` 等**遗留列**做筛选（属旧链残留） |
| **归属与前置** | 新增端点 = 契约变更 ⇒ **必须先由 Architecture Agent 出 Scope**（含 `shared/**` 契约同步），再由 Frontend 实现。 |
| **Risk** | 若候选总量极少（**< 10**），列表页收益低 ⇒ 重评。 |

---

## PD-04 · ⑤ 验证页输入来源 —— **建**（选择器 + 来源卡片 + 重跑标识）

| 项 | 内容 |
|---|---|
| **Decision** | **建**。把验证三面板的输入从「手填 ID」改为「**从列表选择**」，并在页面显式展示**输入来源**与**是否重跑回测**。**不改后端契约。** |
| **Reason** | 实查：稳健性需 `sourceSearchRunId`；OOS 需 `sourceSearchRunId` + `parameterHash` + `oosWindow`；Walk-Forward 需 `strategyId` + `strategyVersion`（**不依赖搜索 Run**）。现状是手填字符串 ⇒ 用户必须去别处抄 ID，且**无法确认该 Run 的 `datasetVersionId` / 参数集**，与「可复现」的核心价值直接冲突。数据源已存在（`paramSearch.listSearches` / `getSearchResults`）⇒ 可纯前端实现。 |
| **Current Status** | 三个面板各自手填 · 侧栏把「参数搜索」与「验证」分在不同组 · 三页的「是否重跑」差异仅存在于代码注释与正文文案 |
| **Affected** | `client/src/components/{robustness,oos,walkForward}/*Panel.tsx` · 三个验证页文案 |
| **新增强制展示项** | ① 选中的搜索 Run ID + 其 `datasetVersionId` + 冻结参数集摘要 + 冻结时间 ② 醒目标识：稳健性 =**零重跑** / OOS =**真重跑** / WFA =**每 Fold 真重跑** ③ 不可用时的**空态指引**（「请先到 ④ 策略 → 参数搜索 跑一次搜索」并给跳转） |
| **Non-goals** | ❌ 不改 `paramSearch.*` 契约 ❌ 不做跨 Run 对比 ❌ 不做「搜索→冻结→稳健性→OOS」一键自动编排（属编排层，风险高） |
| **Risk** | 无行为风险（只读展示 + 选择）。唯一风险是空态文案若写成「无数据」而不写「先去参数搜索」，缺口只是换了个地方。 |

---

## PD-05 · 首页六阶段入口带 —— **建**（加法式，不改行情总览）

| 项 | 内容 |
|---|---|
| **Decision** | 在首页 `/` 头部与行情区块之间加一条「研究闭环六阶段」入口带（① 数据 → ② 观察 → ③ 研究 → ④ 策略 → ⑤ 验证 → ⑥ 前向与复盘），每步跳该阶段首个入口页；**保留下方现有行情总览全部区块**。 |
| **Reason** | ① 侧栏已按六阶段重排（`FRONTEND-IA-001`），但平台「前门」仍只讲行情，用户看不出这是一条研究流水线；② 加法式改动风险最低——不删任何区块、不改任何取数；③ 六阶段与侧栏**逐条对齐**后可用结构测试钉死（顺序 + 首个入口页），不会各自漂移。 |
| **Current Status** | ✅ 已实现（`client/src/components/research/ResearchFlowNav.tsx`；首页以 `current="OBSERVE"` 高亮当前阶段） |
| **Affected** | `client/src/pages/Dashboard.tsx`（+1 组件）· `client/src/components/research/index.ts`（barrel） |
| **Non-goals** | ❌ 不删/改行情总览任何区块 ❌ 不改路由与端点 ❌ 不做「按用户历史推断当前阶段」（首页恒为 ② 观察） |
| **结构锁** | `tests/client/src/pages/pageFlowContracts.test.ts` §20（与侧栏逐条一致）· §21（首页渲染 + 组件为纯导航：无 `trpc` / `useQuery`） |

---

## 附：本次决策不覆盖的事项

- ❌ **组合回测 `/backtest` 保持原样**（用户明确要求），不在本记录范围内
- ❌ `sentiment.*` 端点桶拆分 —— 属跨域改动，交 Architecture Agent 独立出 Scope
- ❌ 侧栏重组本身 —— 属 Frontend 实现方案，本记录只提供阶段归属（见 `FLOW-001` §4）
- ❌ 单策略专项页（`/strategy-final-evaluation` · `/paper-trading-3570001`）的收敛时机