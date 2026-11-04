# RESEARCH-006.4.1-A 实施报告 — Frontend Architecture Audit + Conclusion → Candidate + Candidate List/Detail

> 状态：**Phase A 完成，Phase B（Promote UI）未开始**（按 §19 的要求在 Phase A 稳定后停止）。
> 唯一架构基准：`docs/research/RESEARCH-006.0-architecture.md`；前序：`RESEARCH-006.1/006.2/006.3-implementation.md`。
> 时间：2026-09-12（GMT+8）。本轮改动**只落在 `client/**`**（外加 1 个验收脚本），**未改任何 `server/**` 文件**。

---

## 0. 结论摘要（先看这一段）

| 项 | 结果 |
|---|---|
| Phase A 范围 | 审计 + 结论 → 候选（登记）+ 候选列表 / 详情（含草图编辑、状态流转） |
| 前端闭环可操作性 | ✅ 可用（四个入口全部走**既有** tRPC 端点，零新增 API） |
| 新增 API | **0**（`research.strategyCandidate.{get,createFromConclusion,update,transition}` + `researchEngine.listCandidates` 全部既存） |
| 新增依赖 / migration | **0** |
| 触碰 Dataset Registry | **否**（`client/src/pages/datasets`、`client/src/components/datasetRegistry`、`server/datasetRegistry` 的 `git status` 均为空） |
| 触碰 StrategyDefinition Schema | **否** |
| 前端是否直连 DB / 复制业务规则 | **否**（跨端只用 `import type`；本地展示集合由「对表测试」锁定） |
| 测试 | 纯函数 **46** 例 + UI↔API 契约 **7** 例 + 真实 TiDB **41** 项 全过 |
| `npx tsc --noEmit` | ✅ exit 0 |
| 全量测试 | ✅ 与既有基线逐项一致（零新增失败，见 §8） |
| 前端构建 | ✅ `npx vite build` 通过（见 §8） |
| Phase B | ⛔ **未做**（Promote Dialog / Promote Result / Strategy Provenance / Version 导航） |

---

## 1. §1 Frontend Architecture Audit

### 1.1 现有页面（改动前实查）

| 页面 | 路由 | 文件 |
|---|---|---|
| 研究实验列表 | `/research` | `client/src/pages/research/ResearchList.tsx`(164) |
| 研究工作台（实验 → Run → 分析 → 结果 → 结论 → 变量目录，5 个 Tab） | `/research/:experimentId` | `client/src/pages/research/ResearchDetail.tsx`(555) |
| 数据集列表 / 详情 / 版本列表 / 版本详情 | `/datasets…` | `client/src/pages/datasets/*` |
| 策略工作台（StrategyEditor，含 RuleEditor / PositionSizingEditor / RunConfigPanel …） | `/strategy-editor` | `client/src/pages/StrategyEditor.tsx`(1277) |

**结论展示的位置**：没有独立的「结论页」，结论是 `ResearchDetail` 里 `ConclusionPanel` 的 Tab；`ConclusionPanel`(317) 内部把每条结论渲染成 `ConclusionCard`。

### 1.2 现有 API（与本 STEP 相关）

| 端点 | 权限 | 用途 |
|---|---|---|
| `researchEngine.listConclusions` / `getConclusionPolicy` | public | 结论 Tab 数据源 |
| `researchEngine.listCandidates`（实验维度，`getCandidatesByExperiment`） | public | **候选列表的既有数据源**（同一个 `research_strategy_candidate` 表） |
| `research.strategyCandidate.get` | public | 候选详情（含 experiment / conclusion / dataset 摘要 + `sourceMissing`） |
| `research.strategyCandidate.createFromConclusion` | admin | 结论 → 候选（登记） |
| `research.strategyCandidate.update` | admin | 草图白名单编辑 |
| `research.strategyCandidate.transition` | admin | 状态机迁移 |
| `research.strategyCandidate.promote` | admin | 转正（**Phase B 才接前端**） |

⇒ **本 STEP 需要新增 API 数 = 0**。候选列表用既有实验维度只读端点，未为了「全局候选列表」新造第二套列表接口。

### 1.3 可复用组件（实查）

- `components/common`：`StatusBadge` / `StatusDot` / `EmptyState` / `ErrorState`（`DiagnosticError` 四段结构）/ `SectionCard` / `MetricCard` / `TechnicalDetails` / `DataTable`；
- `components/ui`：shadcn 全套（`dialog` / `alert-dialog` / `select` / `input` / `textarea` / `label` / `table` / `tabs` / `badge` / `skeleton` …）；
- `lib/status.ts`：**全站唯一**「状态 → 语义色」映射（页面禁自建颜色）；
- `adapters/researchEngineAdapter.ts`：`formatDateTime` / `formatCount` / `rpcErrorToDiagnostic` 等纯函数；
- 既有表单纪律样板：`datasetRegistry/datasetFilterForm.ts`、`research/createExperimentForm.ts`（组件不写字面量规则，规则下沉到可单测纯函数）。

### 1.4 缺失页面 / 能力（改动前）

| 缺失项 | 说明 |
|---|---|
| 结论 → 候选入口 | `ConclusionPanel` 只有「导出结论 JSON」，没有任何登记候选的入口；结论 Tab 与候选 Tab 之间**断裂** |
| 候选详情页 | 不存在任何候选详情视图（只有列表行） |
| 候选编辑 / 状态流转 | 不存在 UI |
| 候选空态文案 | `CandidatesPanel` 的空态写的是「RESEARCH-002 引擎不做自动策略生成，这里是**预留写入位**」—— 006.2 之后这句话已**过时**（登记入口已存在），会把用户引向「等自动生成」而不是「去结论页手动登记」 |

### 1.5 需要新增页面（Phase A 实际新增）

| 新增 | 路径 | 说明 |
|---|---|---|
| 候选详情页 | `/research/candidates/:candidateId` | 基础信息 + 研究来源 + 研究草图 + 编辑 + 状态流转 |
| 登记弹窗（非页面） | — | 挂在每条结论卡片上的 `CreateCandidateDialog` |

> 候选**列表**没有新造页面：它继续是 `ResearchDetail` 的「策略候选」Tab（`CandidatesPanel`），只做了增强（跳详情 + 修空态 + 列语义纠正）。

### 1.6 需要新增 API

**0 个。** 若 Phase B 需要「转正后跳转到指定 Strategy Version」，也优先复用既有 `research.strategy.loadVersion` / `loadBundle`，不新增端点。

---

## 2. 变更清单

### 2.1 新增（11 个文件，2,681 行 = 10 个 `client/src` 前端源/测试文件共 2,167 行 + 1 个验收脚本 `scripts/verifyConclusionToCandidateFlow.mts` 514 行）

| 文件 | 行 | 定位 |
|---|---|---|
| `client/src/adapters/strategyCandidateAdapter.ts` | 404 | 候选 ViewModel 适配层（纯函数）+ 错误诊断 |
| `client/src/adapters/strategyCandidateAdapter.test.ts` | 255 | 22 例 |
| `client/src/components/research/candidateForm.ts` | 280 | 登记 / 草图编辑 / 流转目标 纯函数 |
| `client/src/components/research/candidateForm.test.ts` | 264 | 25 例（含 5 组**对表防漂移**断言） |
| `client/src/components/research/strategyCandidateUiContract.test.ts` | 140 | 7 例（扫源码 ↔ 真实 `appRouter`） |
| `client/src/components/research/CreateCandidateDialog.tsx` | 189 | 结论 → 候选登记弹窗 |
| `client/src/components/research/EditCandidateDialog.tsx` | 154 | 草图白名单编辑（JSON 编辑框） |
| `client/src/components/research/CandidateLifecycleActions.tsx` | 141 | 状态流转 |
| `client/src/components/research/CandidateSketchCard.tsx` | 51 | 草图只读展示 |
| `client/src/pages/research/StrategyCandidateDetail.tsx` | 289 | 候选详情页 |
| `scripts/verifyConclusionToCandidateFlow.mts` | 514 | 真实 TiDB 全链验收（自建自清） |

### 2.2 修改（6 个文件，75 insertions / 20 deletions）

| 文件 | Δ | 改动 |
|---|---|---|
| `client/src/App.tsx` | +4/-1 | 新增候选详情路由（**放在 `/research/:experimentId` 之前**，避免同前缀误匹配） |
| `client/src/components/research/CandidatesPanel.tsx` | +44/-18 | 行内跳详情、状态中文标签、「策略定义」列纠正为「转正策略」、空态改为指向真实入口 |
| `client/src/components/research/ConclusionPanel.tsx` | +9 | 每条结论卡片挂「创建策略候选」 |
| `client/src/components/research/index.ts` | +7 | barrel 导出 |
| `client/src/lib/status.ts` | +7 | 补 `REVIEW`/`ACCEPTED`/`CONVERTED` 的语义色（其余三态已收录） |
| `client/src/pages/research/index.ts` | +4/-1 | barrel 导出 |

---

## 3. §3 Conclusion → Candidate（登记）

**入口**：`ConclusionPanel` 的每张结论卡片右上角「创建策略候选」。

**只提交最小入参**：`{ conclusionId, name? }`。`buildCreateCandidateInput()`（有单测）**只在用户确实改过**候选名 / 描述时才带上对应键：

```
未改动        → { conclusionId }                       ← 默认值由后端负责（name=结论标题, description=结论正文）
改了候选名    → { conclusionId, name }
改了描述      → { conclusionId, description }
```

单测 `1-d` 显式断言入参键集合**永远不含** `experimentId` / `status` / `sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` / `strategyDefinitionId` —— 这六个字段一律由后端登记（§3 的硬要求）。

**资格提示**：结论状态不在 `DRAFT / FINAL` 时按钮禁用，并显示原因（「已被取代的结论不得进入策略链路」）。前端集合由 `0-b` 与后端 `CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES` **逐字对表**；后端仍会独立校验一次。

**创建后跳转**：`navigate('/research/candidates/:id')` —— 直接落到候选详情，用户可以接着补草图、走状态流转。

**失败展示**：`candidateErrorDiagnostic(e, "CREATE_FROM_CONCLUSION")` 按 **tRPC 语义 code** 给出针对性文案（同名冲突 / Dataset 未就绪 / 找不到对象 / 权限不足 / 入参不合法），并**始终附上后端原文**（`服务端说明：…`）。

---

## 4. §4 Candidate 列表 / 详情

### 4.1 列表（复用既有端点，实验维度）

`CandidatesPanel` 增强后展示：ID / 名称（→ 详情链接）/ 状态（中文）/ **转正策略**（`strategyDefinitionId`，未转正显示「未转正」）/ 来源结论 / 描述 / 创建时间。

**两处诚实性修正**（都是「把过时/会误导的文案改对」，不是装饰）：
1. 「策略定义」列改名为「转正策略」—— 候选**草图**不是 StrategyDefinition，`strategyDefinitionId` 只有转正后才有值；
2. 空态从「引擎不产出候选，这里是预留写入位」改为「候选不会自动产生：请到『结论』标签页对目标结论点『创建策略候选』」。

### 4.2 详情（`/research/candidates/:candidateId`）

数据源唯一：`research.strategyCandidate.get`（public，无需管理员）。三段结构：

| 段 | 内容 |
|---|---|
| 基础信息 | Candidate ID / name / description / status（中文徽标）/ createdAt / updatedAt / 转正产物 |
| 研究来源 | 来源结论（#id + 标题 + 状态 + 主观置信度）/ 来源实验（→ 实验页链接）/ Research Run（**提不出时明说「提不出，不伪造」**）/ 研究来源 Dataset（坐标 `#id` + label + datasetCode + READY 徽标）/ **「数据集用途」说明：这是研究来源坐标，执行绑定在转正时确定** |
| 研究草图 | 五个字段只读展示（`entryRule` / `filterRule` / `exitRule` / `riskRule` / `parameterSpace`），未填写显示「未填写」 |

- 来源缺失（`sourceMissing`）→ 显示「已不存在」+ 一句说明「这是快照而非外键，上游删除不会让候选丢失数据」；
- 页面文案明确标注「草图 ≠ StrategyDefinition」；
- 术语隔离：页面标题与文件名都带 `Strategy` 前缀（`StrategyCandidateDetail`），避免与涨停链路的「龙头候选」（`LeaderCandidates` / `CandidateHistoryTable`）混淆。

---

## 5. §5 Candidate 编辑（闭集白名单）

`EditCandidateDialog` 只渲染 7 个字段：`name` / `description` + 5 个草图。表单里**不存在** `status` / `strategyDefinitionId` / `conclusionId` / `experimentId` / `sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` 的输入项。

`buildUpdateCandidatePatch(original, form)` 的三条硬约束（各有单测）：
1. **只提交改动过的字段**（未改动不发送）；**空补丁直接拒绝**（文案：「没有任何字段被修改（后端会拒绝空补丁）」）；
2. 只可能产出白名单键 —— 由 `0-a` 对表断言与后端 `CANDIDATE_EDITABLE_FIELDS` **集合相等**；
3. 草图 JSON 语法错误**当场拦下并定位到字段**（`2-f`：`风控规则 riskRule 不是合法 JSON：…`），空文本 = **显式清空**（提交 `null`，不是「未提供」）。

真实库已证明：越界字段（`status`）与空补丁请求在**传输层**被拒（`BAD_REQUEST`），且**零副作用**（`description` / `status` 均未被改动）。

---

## 6. §6 Candidate 状态流转

- 可选项 = `transitionTargetsFor(status)`：`DRAFT→[REVIEW,ARCHIVED]`、`REVIEW→[ACCEPTED,REJECTED,ARCHIVED]`、`ACCEPTED→[ARCHIVED]`、`REJECTED→[ARCHIVED]`、`CONVERTED→[ARCHIVED]`、`ARCHIVED→[]`；
- **`CONVERTED` 结构上不可能出现**：它不在后端 API 开放目标里 ⇒ 前端不提供；单测 `0-c` 对**六个状态逐状态严格相等**断言「前端集合 ≡ `CANDIDATE_TRANSITION_TARGETS` ∩ 状态机允许迁移」，并单独断言 `not.toContain("CONVERTED")`；
- 单测 `0-e` 还锁住了「**状态机允许但 API 未开放**」的那条缝：`REVIEW → DRAFT`（退回）在 `CANDIDATE_TRANSITIONS` 里是合法的，但不在 API 开放目标里 ⇒ 前端**不得**提供（006.2 已登记的未开放项，未擅自放开）；
- 界面明确写出「『已转正（CONVERTED）』不由状态流转产生」，并说明它只能由转正入口写入；
- 若后端返回 `STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE`（专属码），前端只**如实转述**后端原文，绝不自己模拟一次转换 —— 真实库已证明该拒绝确实发生，且状态不变。

---

## 7. §16 测试矩阵

| 层 | 文件 | 例数 | 覆盖 |
|---|---|---|---|
| 适配层纯函数 | `strategyCandidateAdapter.test.ts` | 22 | 草图文本化（未填写 vs 空串）、六态中文标签、详情 VM 三段映射、来源缺失说明、列表行 VM、错误诊断 7 组（含「不臆造领域码」与「不编造不存在的规则」） |
| 表单/流转纯函数 | `candidateForm.test.ts` | 25 | **5 组对表防漂移**（可编辑字段 / 可登记结论状态 / 流转目标 / 未收录状态 / 未开放回退）+ 登记入参最小化 6 例 + 草图补丁 8 例 + JSON 解析 3 例 + 转正入口判定 3 例 |
| UI ↔ API 静态契约 | `strategyCandidateUiContract.test.ts` | 7 | 扫真实源码 `trpc.research.strategyCandidate.*` → 断言端点存在 / 调用点白名单 / 候选端点恰 5 个 / 无第二个转换入口 / Phase A 不调 promote / 候选 UI 不直写 Strategy / 禁止词汇 |
| 真实 TiDB 全链 | `scripts/verifyConclusionToCandidateFlow.mts` | 41 项 | 见 §8.2 |

**对表测试是本 STEP 最关键的测试设计**：客户端**不能** import 服务端运行时值（仓库约定跨端只允许 `import type`），所以前端必须本地维护「展示用集合」；唯一能防止口径悄悄漂移的手段，就是让测试**运行时** import 后端真常量并断言相等。

---

## 8. 验收证据

### 8.1 静态与单元

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | ✅ exit 0（日志 `docs/evidence/_r00641_tsc.log`） |
| 纯函数 + 契约 | `npx vitest run client/src/adapters/strategyCandidateAdapter.test.ts client/src/components/research/candidateForm.test.ts client/src/components/research/strategyCandidateUiContract.test.ts` | ✅ 54 / 54 |
| 前端构建 | `npx vite build` | ✅ **RC=0**，3,011 模块 / 24.86 s（日志 `docs/evidence/_r00641_build.log`） |
| 全量测试 | `npx vitest run` | ✅ **227 文件 / 3,678 例，15 失败 / 7 文件** —— 与既有环境依赖基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`，全部真实 DB 直连 / 外部 API / 5s 超时）**逐项一致 ⇒ 零新增失败**（日志 `docs/evidence/_r00641_fulltest.log`） |

### 8.2 真实 TiDB（`npx tsx scripts/verifyConclusionToCandidateFlow.mts` → **PASS 41/41**）

走的是**与组件完全相同的 tRPC procedure 与入参形状**（`appRouter.createCaller`），不是 Service 直调：

1. **只读选取**既有 Conclusion #…（DRAFT）· Experiment #240002 · Dataset 版本（READY）—— 脚本**不造**研究上游数据；
2. 候选端点恰好 5 个；`get` / `createFromConclusion` / `update` / `transition` / `promote` 均在列；无第二个转换入口；
3. `createFromConclusion`：初始 `DRAFT`、`conclusionId`/`experimentId` 由后端登记、`sourceDatasetVersionId` 从 experiment 复制、`sourceTraceJson` 非空、草图五项为空；
4. `get`：experiment / conclusion / dataset 摘要全部可解析，`label` 来自 Registry，`sourceMissing` 为空；
5. **重复登记 → `CONFLICT`**，且**零新增行**；把「HTTP 传输形态」（`{message, data:{code}}`）喂给前端映射函数 → 产出「换一个候选名 + 服务端说明」的用户文案；
6. `update`：`entryRule` / `riskRule` 落库（裸 SQL 复核 JSON），未提交的 `filterRule` 仍为 `NULL`，`status`/`name` 未被改动；
7. `update` 越界（`status`）与空补丁 → `BAD_REQUEST`，且**零副作用**（裸 SQL 复核）；
8. `listCandidates`（列表页数据源）能看到新候选；
9. `transition`：`DRAFT → REVIEW → ACCEPTED` 落库；非法迁移（`ACCEPTED → REJECTED`）`CONFLICT` 被拒；
10. **`transition → CONVERTED` 被拒**（tRPC `CONFLICT`，拒绝理由明确指向 `promote()`），且**状态不变、未挂 `strategyDefinitionId`**；
11. 同一结论下**不同名**第二份候选可建（同名才拒），`DRAFT → ARCHIVED` 生效；
12. **零 Strategy 写入**：`strategies` / `strategy_versions` / 4 张投影 / `strategy_research_provenance` 全部 `0 → 0`；
13. 自建自清（只按 id 删本脚本创建的候选），无残留；
14. **行数守恒**：本流程可能触及的 13 张表逐表相等。

---

## 9. §18 完成条件自查（Phase A 部分）

| # | 条件 | Phase A 状态 |
|---|---|---|
| 1 | Research → Candidate → Strategy 前端闭环可操作 | ⏳ **部分**：Research → Candidate 全通；Candidate → Strategy 属 Phase B |
| 2 | Candidate CRUD/transition 使用现有 API | ✅ |
| 3 | Promote 使用唯一 `research.strategyCandidate.promote` | ⏳ Phase B（前端当前**不调用**，有契约测试锁定） |
| 4 | 前端不存在第二套 Candidate → Strategy 转换 | ✅ 契约测试 4/6/7：无候选侧 strategy 写端点、无 `strategy.create/save`、无第二套定义列 |
| 5 | StrategyDefinition 不由前端直接构造 | ✅ 前端只提交草图值（对象），且 promote 入参 schema 本身就拒绝 definition |
| 6 | Dataset 坐标全部使用 `dataset_version.id` | ✅ 展示层只读 `datasetVersionId`，label 仅显示 |
| 7 | Research Dataset 与 Execution Dataset 显式区分 | ✅ 详情页「数据集用途」段明说两者可不同、执行绑定在转正时确定 |
| 8 | divergence 规则完整 | ⏳ Phase B（前端目前不提交 divergence；后端规则未改动） |
| 9 | provenance 只读 | ⏳ Phase B |
| 10 | Strategy 不依赖 Research 才能打开 | ⏳ Phase B（Strategy 页面未改） |
| 11 | tsc 通过 | ✅ |
| 12 | 新增前端测试通过 | ✅ 54 + 41 |
| 13 | 真实 TiDB 全链通过 | ✅ Phase A 段通过（promote 段属 Phase B） |
| 14 | 第二次 Promote 零新增 Strategy Version | ⏳ Phase B（Phase A 不触发 promote） |
| 15 | 全量测试无新增失败 | ✅ |
| 16 | `git diff` 确认未改 Dataset Registry | ✅ 空 |
| 17 | `git diff` 确认未引入 `researchDataset` / `rd-*` | ✅ 空 |
| 18 | 全局搜索确认无第二个转换入口 | ✅ 前端契约测试 + 006.3 服务端 §46 搜索 |

---

## 10. 本轮实测发现（值得记录，影响 Phase B）

### 10.1 🔴 领域错误码**不跨 tRPC 边界**

实测（真实 caller，见验收输出第 9 段）：`transition → CONVERTED` 抛出的领域码 `STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE` 在**调用方不可见** —— `strategyCandidate/router.ts#toTrpcError` 只透传 `message`，**没有传 `cause`**；HTTP 客户端同样拿不到（tRPC 不序列化 cause）。调用方能看到的只有 tRPC 语义 code（此处 `CONFLICT`）+ 中文 message。

**影响 Phase B**：§11 要求前端对 `PROMOTE_SKETCH_INCOMPLETE` / `PROMOTE_SKETCH_INVALID` / `PROMOTE_WRITEBACK_FAILED` … 给出**各不相同**的提示。现状映射成 tRPC code 后：
`CANDIDATE_NOT_ACCEPTED` / `PROMOTE_SOURCE_INCOMPLETE` / `PROMOTE_SKETCH_INCOMPLETE` / `PROMOTE_DEFINITION_INVALID` / `DATASET_VERSION_NOT_READY` **全部塌缩为 `PRECONDITION_FAILED`**，仅靠 tRPC code **无法区分**。

**建议（Phase B 第一步做，属 2 行改动）**：在 `toTrpcError` 里把领域码带进 message，例如
`message: \`[${e.code}] ${e.message}\`` —— 这**正好对上**仓库既有约定：`client/src/adapters/researchEngineAdapter.ts#rpcErrorToDiagnostic` 的第一件事就是 `/[([A-Z_]{3,})]/` 从 message 里抠错误码（说明「message 带码」本来就是本仓库的设计意图）。本 STEP **不动**它，避免在 Phase A 顺手改 006.3 的传输契约。

### 10.2 ⚠️ 并行会话写入

验收过程中 `research_analysis` 出现 `156 → 181 → 190` 的增长（本工作区另一条研究链路在批量建分析）。本脚本**从不写** `research_run` / `research_analysis` / `research_result`，因此把这三张表从「强制守恒」降级为「如实记录差值」，并在日志里显式登记。**其余 13 张表仍为强制守恒**，且自建行全部按 id 清除。

### 10.3 工具陷阱（复现要点）

- 同一文件**同批次多个 Edit 会静默丢改动**（本轮真实踩到 3 次，`tsc` 才发现）⇒ 严格「一文件一 Edit / 一消息」；
- `scripts/**` 不在 `tsconfig` include ⇒ `.mts` 验收脚本的类型错只在运行时暴露，**必须实跑**；
- `TRPCError` 不带 `cause` ⇒ 断言领域码必须换判据（见 10.1）。

---

## 11. Phase A 未做 / 明确留给 Phase B

| 项 | 原因 |
|---|---|
| Promote Dialog（§8/§9：执行 Dataset 默认继承 + divergence reason） | §19 明确 Phase B |
| Promote Result（§10：含 `idempotent` 的显式区分） | 同上 |
| Promote 错误码 → 14 条专属文案（§11） | 同上（且依赖 §10.1 的传输层改动决策） |
| Promote 后跳转 + Strategy Version 定位（§12） | 同上 |
| Strategy Version 页面的 Provenance 只读区（§13） | 同上 |
| Strategy 独立性验证（§14） | 同上 |
| `cloneVersion` / `origin = INHERITED` / Backtest / ParamSearch / OOS / WFO | **本 STEP 全程禁止** |

---

## 12. 复现命令

```bash
export PATH=/c/Users/A/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Windows/System32:$PATH
npx tsc --noEmit
npx vitest run client/src/adapters/strategyCandidateAdapter.test.ts \
               client/src/components/research/candidateForm.test.ts \
               client/src/components/research/strategyCandidateUiContract.test.ts
npx vite build
npx tsx scripts/verifyConclusionToCandidateFlow.mts     # 真实 TiDB，自建自清
npx vitest run                                          # 全量回归
```
