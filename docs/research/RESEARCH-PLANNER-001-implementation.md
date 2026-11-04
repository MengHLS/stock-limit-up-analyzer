# RESEARCH-PLANNER-001 — 自动研究编排层：实施与验收报告

> 任务书：`# Research 自动研究编排层改造 — 一次性完整开发任务`（§0–§33）
> 交付日期：2026-09-17
> 状态：**CODE_READY + VALIDATED**（两个验收问题在真实 Dataset 390002 上端到端跑通，**37 + 36** 项断言全通过；前端默认模式真机渲染 **27** 项断言 ALL PASS）
> 配套证据：`docs/evidence/_e2e_research_planner.out.txt`（§27）、`docs/evidence/_e2e_research_second_question.out.txt`（§28）、`docs/evidence/_probe_planner_dryrun.out.txt`（计划生成）、`docs/evidence/_probe_planner_dryrun.before-fix.txt`（缺陷修复前）、`docs/evidence/_probe_research_ask_page_render.out.txt`（§17/§27 真机渲染）

---

## 0. 一句话结论

Research 从「用户手工堆 Analysis 参数」变成了「用户提一个研究问题」：

```
用户：{ datasetVersionId, researchQuestion }        ← §5：真的只有这两项
  → 系统识别研究方法（7 个内置方法，可扩展注册）
  → 自动生成 Research Plan（28 条，P0/P1/P2 分级，可预览）
  → 复用 RESEARCH-002 原有 6 类分析执行器真实执行
  → Finding 引擎聚合 → 结论视图（含「针对你的问题」区块）
  → 用户决定是否 [创建 Candidate]（状态 DRAFT，绝不自动进 Strategy）
```

**没有推翻任何既有能力**：Analysis Engine、Dataset、Strategy Domain、Backtest、legacy 信号链全部原样；本轮只在其上加了「编排层」。

---

## 1. 交付物① — Research 架构说明

### 1.1 分层与数据流

```
┌─ 用户输入 ───────────────────────────────────────────────────────────────┐
│  { datasetVersionId, researchQuestion }            ← §5 / §20           │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─ Intent Detection ──────────────────────────────────────────────────────┐
│  server/researchEngine/planner/intent.ts                                │
│  · 分句（中英标点 + and/or/then/plus）→ 关键词加权打分                   │
│  · 专指关键词权重 3 / 泛化关键词权重 1                                   │
│  · 排序三级：加权分 → 专指词命中数 → 模块键字典序（可复现）              │
│  · 零命中 ⇒ FALLBACK_MODULE_KEY = EVENT_RETURN_RESEARCH（如实标注）      │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─ Research Module Registry（§3 可扩展）──────────────────────────────────┐
│  server/researchEngine/planner/moduleRegistry.ts                        │
│  register / require / has / get / list / listKeys                       │
│  7 个内置方法（**不是最终列表**，新增方法 = 加一个注册项）：             │
│    PULLBACK_EFFECTIVENESS      回踩有效性研究                           │
│    EVENT_RETURN_RESEARCH       事件后收益研究（兜底）                   │
│    ENTRY_TIMING_RESEARCH       入场时点研究                             │
│    HOLDING_PERIOD_RESEARCH     持仓周期研究                             │
│    BREAKOUT_SUCCESS_RESEARCH   突破成功率研究                           │
│    STOP_LOSS_RESEARCH          止损研究                                 │
│    MARKET_REGIME_STABILITY     市场环境稳定性研究                       │
│  每个方法声明：推荐分析类型 / 首选视界 / 求值日 / 条件配方 / 靶变量族   │
│  ⚠️ Module **不入库**：其字段是函数，落表只会得到「代码改了表没改」的僵尸表 │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─ Analysis Plan Generator（零 IO、零统计）──────────────────────────────┐
│  server/researchEngine/planner/analysisPlan.ts                          │
│  · 守卫条件（P0）→ 精修条件（P1）→ 对照组（P2）→ 分位/稳定性/分段/描述  │
│  · 精修配方排序：先按提问侧重排序（强调词权重 2 + 标签分词），**再**裁剪  │
│  · 能力闸门：变量在本 Dataset 不存在 ⇒ drop(CAPABILITY_MISSING)，不生成跑不动的配置 │
│  · §9 规模裁剪：P0 必需项永不丢弃，其余从队尾裁                          │
│  · 输出 emphasisAnalysisNames（「用户在问的那几条」，给结论页用）        │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─ 落库（§24：只有一个清晰的 Analysis 生命周期）──────────────────────────┐
│  research_question → research_plan → research_analysis(planId)          │
│  · **不建** research_plan_analysis / _definition / _config 关系表       │
│  · 计划项落库时就是一条 research_analysis，用 planId 一个列表达「计划↔分析」│
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─ Analysis Executor Registry（RESEARCH-002 **原样**）────────────────────┐
│  server/researchEngine/analyses/registry.ts                             │
│  DESCRIPTIVE / EVENT_STUDY / QUANTILE / CONDITIONAL / STABILITY /       │
│  SEGMENT_RELATION —— 共 6 类，**本轮一个都没新增**                      │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─ Finding Engine（RESEARCH-FINDING-001 **原样**）────────────────────────┐
│  Result → Finding（六维打分、fingerprint 幂等）                          │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─ 结论视图聚合 ──────────────────────────────────────────────────────────┐
│  server/researchEngine/planner/aggregate.ts                             │
│  ① 结论（视图层拼「研究问题 / 针对该问题 / 统计判定」三段）              │
│  ② 关键发现 = Top Findings（强度 → 样本量 → id）                        │
│  ③ 针对你的问题 = questionAlignedFindings（强调项，无则回落必需项）      │
│  ④ 数据有效性（§22：失败 / 未完成 / **零结果** 三维分开报）              │
│  ⑤ 建议（只能表示「是否值得进入下一阶段」）+ 强制免责声明                │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
        Candidate（DRAFT）→ **人工确认** → Strategy        ← §16 / §2
```

### 1.2 三条纪律（贯穿全层）

| 纪律 | 落地方式 |
| --- | --- |
| 不让 LLM 写统计 SQL（§2.2） | Planner 全链路**零 SQL 自由文本**：模块关键词是数据、条件配方是函数、分析计划是纯函数；执行只有 `AnalysisExecutorRegistry` 一条路 |
| 不篡改统计结果（§21） | 结论正文的「研究问题 / 针对该问题」段是**确定性模板拼装**（`composeQuestionAnchor`），只搬运 `research_finding` 里已落库的数字；库内结论原文不被修改，仅视图层加前缀 |
| 概念不重复（§24 / §25） | 无 `research_experiment_analysis` / `research_plan_analysis` / `analysis_definition` / `analysis_config`；无任何 `*V2` / `*V3` 域名（已 grep 断言为空） |

---

## 2. 交付物② — 数据库变更报告

本轮共 **2 个纯增量 migration**，均已 apply 且幂等验证通过。

### 2.1 `drizzle/0039_research_planner.sql`

| 对象 | 变更 | 说明 |
| --- | --- | --- |
| `research_analysis` | **+5 列 +1 索引** | `planId` / `moduleKey` / `priority` / `purpose` / `requiredFlag`，全部 NULL-able ⇒ 人工创建的分析（专家模式）保持 NULL，**零回填** |
| `research_question` | **新表**（13 列 + 4 索引） | 研究问题：`questionText` **原样保留**（禁归一化）、`researchType`、`intentJson`（判定证据）、`status`、`experimentId` / `runId` 软引用 |
| `research_plan` | **新表**（17 列 + 4 索引） | 研究计划：`itemsJson`、`notesJson`（含 §7 `spec` / `emphasisAnalysisNames` / `conditionReadback` / `dropped` / `selectionRationale`）、`moduleKeysJson`、`capApplied`、`plannedCount` |

### 2.2 `drizzle/0040_candidate_plan_provenance.sql`

| 对象 | 变更 | 说明 |
| --- | --- | --- |
| `research_strategy_candidate` | **+1 列 +1 索引** | `sourceResearchPlanId`（软引用 `research_plan.id`），补齐 §16 六项 provenance 的第 3 项 |

§16 六项 provenance 与本表的落点：

```
researchId      → experimentId（既有）
researchRunId   → sourceResearchRunId（既有）
researchPlanId  → sourceResearchPlanId（**本轮新增**）
datasetVersionId→ sourceDatasetVersionId（既有）
findingIds      → sourceFindingIds（既有）
conclusionId    → conclusionId（既有）
```

**为什么不塞进 `sourceTraceJson`**：该表已确立「JSON 存证据快照、列存可检索谱系锚点」的分工；计划 id 需要被反查（「这份计划产出了哪些候选」），属锚点而非快照。
**为什么可空且不 backfill**：本列生效前的候选走人工路径，没有计划来源 —— 如实置 NULL，不伪造一个「看起来像」的计划 id。

### 2.3 硬约束遵守情况

- 全库 **零 FK**（soft reference + 应用层校验）—— 两个 migration 均不加 FK；实测全库 FK count **= 0**
- Dataset 坐标唯一 = `datasetVersionId = dataset_version.id`，未引入第二套
- 新增列全部可空 / 新表从 0 行开始 ⇒ 既有 12 实验 / 15 Run / 300+ 分析零影响
- **未**使用 `npm run db:push` / `drizzle-kit generate` / 手改 `_journal.json`；apply 脚本按 `-- @guard:` 先查 `information_schema` 再执行，重复运行无副作用

---

## 3. 交付物③ — 后端实施报告

### 3.1 新增文件

| 文件 | 职责 |
| --- | --- |
| `server/researchEngine/planner/moduleRegistry.ts` | Research Module 注册表 + 7 个内置方法 + 条件配方（守卫 / 深度分档 / 缩量 / 放量 / 阳线 / 站上收盘 / 观察日） |
| `server/researchEngine/planner/intent.ts` | 意图识别（加权打分 + 判定证据） |
| `server/researchEngine/planner/analysisPlan.ts` | 计划生成（零 IO、零统计）+ 配方排序 + 能力闸门 + §9 裁剪 + `emphasisAnalysisNames` |
| `server/researchEngine/planner/questionPlanning.ts` | 编排：`planResearchQuestion` / `materializePlan`（幂等）/ `buildPreview`（§18/§22）/ `buildPlanSpec`（§7） |
| `server/researchEngine/planner/aggregate.ts` | 结论视图：Top Findings / 去重 / 冲突 / 提问锚点 / 建议 / §22 |
| `server/researchEngine/planner/errors.ts` | 编排期错误码（稳定闭集，与执行期码分离） |
| `server/researchPlannerRouter.ts` | 10 个端点 + `loadPlanDataFacts`（导出供探针复用） |

### 3.2 修改的既有文件

| 文件 | 改动 |
| --- | --- |
| `server/researchEngine/variables.ts` | `PULLBACK_STATS` 新增 `holds_event_open`（OBSERVATION 族，`availableFromOffset = k` ⇒ PIT 安全可当条件） |
| `server/researchEngine/types.ts` | `ResearchBatchAnalysisItem` + `planId/moduleKey/priority/purpose/requiredFlag` |
| `server/researchEngine/batchCreate.ts` | 5 个溯源字段透传 |
| `server/researchEngineRouter.ts` | `pullbackStats` 下拉补两项 |
| `server/researchCore/types.ts` | `ResearchPlanSpec` / `PlanVariableRole` / `PlanVariableUse`；`ResearchPlanNotes` + `spec` + `emphasisAnalysisNames`；Candidate + `sourceResearchPlanId` |
| `server/researchCore/candidates.ts` | 不可变字段集 + `sourceResearchPlanId` |
| `server/researchCore/repository/{contract,db,inMemory}.ts` | `ResearchAnalysisListFilter` + `planId`；`mapCandidate` / `candidates.create` 处理新列 |
| `server/routers.ts` | 挂载 `researchPlanner` |
| `shared/researchContracts.ts` | 问题长度 / 计划规模上限的**单点定义**（前端与后端同源） |

### 3.3 端点（§19 / §20）

| 端点 | 类型 | 作用 |
| --- | --- | --- |
| `createQuestion` | mutation | §19 —— 提出问题：意图识别 + 计划生成 + 落库（**不执行**） |
| `getPlan` | query | 计划明细 + 预览（预览**每次重算、不落库**，避免第二份可漂移状态） |
| `getQuestion` | query | 问题 + 最新计划 |
| `listQuestions` | query | 列表（按 dataset / status / experiment 过滤） |
| `runResearch` | mutation | 物化 + 同步执行 + 结论视图 |
| `runResearchDetached` | mutation | §23 —— 立即返回 `{runId, started, alreadyRunning}`；进度靠既有逐条 `status` 落库 |
| `getOutcome` | query | §12–§15 结论视图 |
| `runFromQuestion` | mutation | §20 —— **Workbuddy 单次调用入口** |
| `createCandidate` | mutation | §16 —— 导出候选（含六项 provenance，状态恒 DRAFT） |
| `listModules` | query | 研究方法目录（§3 可扩展性的可观测入口） |

### 3.4 实测缺陷修复（全部由 E2E / 探针暴露，非推演）

| # | 症状 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | 两个验收问题都被识别成 `EVENT_RETURN_RESEARCH`，计划里 **0 条守护条件分析** | 等权关键词打分把泛化的「收益」与专指的「回踩」算成平手，字典序回落到泛化方法；且「不破」匹配不到「不跌破」 | `primaryKeywords`（权重 3）+ `GENERIC_KEYWORD_WEIGHT = 1` + 三级排序；两问均正确命中 `PULLBACK_EFFECTIVENESS`，计划 8 → 28 条 |
| 2 | 整轮 Run 在执行期抛 `SEGMENT_RELATION 的窗 A "max_drawdown_2d" 不存在` ⇒ 全部失败 | `pickSegmentWindows` 只校验窗 B（path），未校验窗 A（`from=0` + `max_drawdown` ⇒ 变量只存在于 outcome 视界） | 增 `outcomeHorizons` 参数 + 区间覆盖校验；新增 `segmentRelationCapabilityDetail` 生成期闸门；窗口变为 `T+1..T+5 最大回撤 → T+6..T+10 收益` |
| 3 | §15 的免责声明**定义了但从未被调用** | `withDisclaimer` / `RESEARCH_OUTCOME_DISCLAIMER` 没有调用方 | `pickConclusion` 拼后缀 + `recommendation.disclaimer` 唯一注入 + `buildRecommendation` 返回 `Omit<..., "disclaimer">`（让漏加**不可能**） |
| 4 | §22 误导性真话：`market_cap 分位` 跑完零结果，却被报成「数据有效性检查 ✓ Passed：28 条分析全部执行完成」 | 报告只统计「失败 / 未完成」，没统计「执行完成但零结果」 | 新增 `emptyResultCount` / `emptyResultAnalyses`；`passed` = 三条件；有零结果时建议固定 `NEEDS_MORE_RESEARCH`；预览页加「已登记 ≠ 有值」声明 |
| 5 | §28 问题问「深一点好还是浅一点好」，计划里**只有「浅」一档** | `rankRecipesByQuestion` 只按 recipe.label 分词匹配（深度分档标签「回踩深度落在 <0.95]」在问题里不出现 ⇒ 得分 0）；且 `slice(0, 6)` 在排序**之前**执行，而深度分档注册在第 6/7/8 位 ⇒ `normal` / `deep` 永远进不了计划 | ① 配方显式声明 `emphasisKeywords`（权重 2）；② 改为**先排序、再裁剪**（`MAX_REFINEMENT_RECIPES`）。修复前后对照见 `_probe_planner_dryrun.before-fix.txt`；修复后两档均入选（各 2 条） |
| 6 | 结论正文写着「假设：**(未登记假设陈述)**」，且两轮不同问题的结论数字**几乎逐字相同** | 引擎从「实验的第一条 hypothesis」推导 `researchQuestion`，而 Planner **从未注册 hypothesis** ⇒ 占位符 + `researchQuestion = null` + §16 的 `sourceHypothesisId` 永远为空 | Planner 在创建 Run 后注册 hypothesis（`statement` = **用户原话**，不改写） |
| 7 | 用户问的问题在结论页**读不到答案** | 「关键量」由固定的分析类型优先级（`QUANTILE → CONDITIONAL → …`）选出，与提问无关；而 Top Findings 按强度（1.0 处**饱和**）→ 样本量排序，深档 n=1602 被 n=8856 挤到第 6 名之后 | ① 计划侧记录 `emphasisAnalysisNames`；② `buildResearchOutcome` 产出 `questionAlignedFindings`（无强调项时**如实回落**必需项并标注 `REQUIRED_FALLBACK`）；③ 结论正文视图层拼「【研究问题】/【针对该问题】/【统计判定】」三段 |

---

## 4. 交付物④ — 前端实施报告

### 4.1 文件

| 文件 | 说明 |
| --- | --- |
| `client/src/pages/research/ResearchAsk.tsx`（新） | 四态步骤机 **ASK → PREVIEW → RUNNING → OUTCOME** |
| `client/src/components/research/researchAskForm.ts`（新） | 纯逻辑（可单测）：表单默认值 / 校验 / 入参装配 / 示例 / 格式化 / 进度汇总 / 九列证据行 / 风险提示 |
| `client/src/pages/research/index.ts` | 导出 `ResearchAsk` |
| `client/src/App.tsx` | 路由 `/research/ask`（**必须排在 `/research/:experimentId` 之前**） |
| `client/src/components/AppShell.tsx` | 侧栏「研究数据」组最前加「提问研究」（`Sparkles`） |
| `client/src/pages/research/ResearchList.tsx` | 「提问式研究」入口按钮；列表描述区分「专家模式」 |
| `client/src/theme/darkCompatibility.css` | 重跑生成器（310 组合 → 230 规则） |

### 4.2 §17 —— 默认模式 vs 高级模式

**默认模式**（`/research/ask`）首屏只有：

```
[Dataset 下拉] [版本下拉] [研究问题 textarea] [可点示例] [开始研究]
```

连「分析类型 / 特征 / 目标 / 视界 / 分段 / 分组」这些词都**不出现在页面上**（已在真机渲染验收里做成禁用词表断言）。

**高级模式**：原有页面与能力**一个都没删** —— `/research` 列表、`/research/:experimentId` 详情、策略页规则编辑七段表单、`/leader-candidates` 等全部保留，只加了入口与说明。

**§18 计划预览**：正式执行前可看研究方法 / 预计分析数 / 预计数据量 / §22 有效性 / §7 口径展开 / 三档分析清单（含被裁项）/ **已识别到你问的重点**（`emphasisAnalysisNames`）。
预览期把「系统有没有听清我在问什么」摊开 —— 用户可以在**花 4 分钟跑之前**确认，而不是跑完才发现。

### 4.3 §12–§14 结论页结构

```
结论（三段：研究问题 / 针对该问题 / 统计判定）
  ↓
针对你的问题（N 条）        ← §28 修复点：提问的直接证据不再只在折叠区
  ↓
关键发现（Top N）
  ↓
关键证据（九列：发现了什么 / 什么条件 / 什么目标 / 哪个视界 / 样本量 / 与基准差异 / 效果大小 / 稳定性 / 是否冲突）
  ↓
风险提示 + 数据有效性（含零结果点名）
  ↓
下一步（含免责声明原样渲染 + [创建 Candidate]）
  ↓
▸ 研究计划与原始分析（复核用）   ← Raw Results 可到达，但**不在首屏**
```

### 4.4 真机渲染验收

`docs/evidence/_probe_research_ask_page_render.mjs`：无头 Edge + CDP，零依赖、只读。**检查项 27 / 失败 0（ALL PASS）** ✅
证据：`docs/evidence/_probe_research_ask_page_render.out.txt`

判据分两层 —— 这是本轮**修正过**的设计，第一版判据自身有缺陷（见下）：

| 层 | 判据 | 结果 |
| --- | --- | --- |
| 主（硬） | **控件扫描**：`input / textarea / select / [role=combobox]`（排除 Radix Select 为表单兼容渲染的 `aria-hidden` bubble `<select>`）的 label / placeholder / aria-label 里**不得出现**禁用词，且**控件总数 ≤ 4** | 4 个控件：`#ask-dataset` / `#ask-version` / `#ask-question` / `#ask-cap`；禁用词命中 **0** |
| 兜底（软） | **可见文本扫描**，排除「说明句」= 含「不要 / 无需 / 不需要 / 不用 / 由系统 / 系统根据 / 自动」且**不含**任何祈使式输入指令（请输入 / 请填写 / 请选择 / …） | 禁用词命中 **0**；被排除说明句 6 条（逐条打印进证据） |

禁用词表：`特征变量 / 目标变量 / 结果变量 / 视界 / 分组维度 / 稳定性维度 / 分段窗口 / 分析类型 / 条件组 / 最小样本数 / 分位组数`。

其余断言：页头 / 步骤条 / 两个下拉 / textarea / [开始研究] / 高级入口 / **示例 3 条且逐条标志性文本命中** / 侧栏高亮（「提问研究」active + 图标着色、「研究实验」不 active）/ 点示例填入 / 清空后提交被拦住（列出 3 条原因）**且不进入预览**。

🔴 **判据修正记录（第一版跑出 3 FAIL，经源码逐处核对 ⇒ 全部是判据缺陷，产品行为正确）**：

| # | 第一版判据 | 为什么错 | 改成 |
| --- | --- | --- | --- |
| 1 | 扫 `document.body.innerText` 全量文本找禁用词 | 命中的「目标变量 / 视界 / 分组维度」**全部来自说明性文案**：`ResearchAsk.tsx:361`「**不要**填写特征名、目标变量、视界、分组维度…」、`:260`「…视界…**全部由系统设计**」、示例 #3 hint「自动铺开多**视界**…」。这些话恰恰在**告诉用户不用填、系统会决定**——是产品卖点本身 | 拆成「控件扫描（硬）+ 排除说明句的文本扫描（软）」，排除集加 IMPERATIVE 反制层，且被排除句逐条打印 |
| 2 | 按 `→ 会识别成` 计数示例 | `researchAskForm.ts:132-145` 三条 hint 里**只有第 1、3 条**用该前缀，第 2 条是「→ 同上，并会把…」⇒ 恒得 2 | 改按**区块结构**取数（含「点一句示例」的 `<p>` 的父容器下全部 `button`），并用三条标志性文本（`不跌破首板开盘价` / `回踩深度` / `持有期`）分别断言 |
| 3 | `reachedPreview = txt.includes('② 研究计划预览')` | 步骤条由 `ResearchAsk.tsx:270-274` 遍历 `RESEARCH_ASK_STEP_LABELS`（`researchAskForm.ts:55-60`）**恒渲染全部四个标签** ⇒ 判据恒为 true，永远测不出「有没有进预览」 | 改用**预览卡片独有内容**「预计分析数」（`ResearchAsk.tsx:533`）判定；「是否仍在第一步」改用 ASK 卡独有控件 `#ask-question` |

同批纠正一个错误认知：第一版注释假设「PREVIEW / OUTCOME 卡片在 ASK 步仍挂载」。实测四张卡片**全部**是 `{step === "XX" && (...)}` 条件渲染（`ResearchAsk.tsx:279 / 426 / 439 / 477`）⇒ ASK 步 DOM 里根本没有这些卡片，禁用词不可能从它们漏进来。

---

## 5. 交付物⑤ — Workbuddy 调用说明

### 5.1 单次调用（§20，推荐）

入参**只有两项**：

```ts
await trpc.researchPlanner.runFromQuestion.mutate({
  datasetVersionId: 390002,
  researchQuestion: "首板之后回踩，只要不跌破首板开盘价，后面的收益是不是更好？",
});
```

返回：

```ts
{
  researchId,        // = experimentId
  researchPlanId,
  researchRunId,
  questionId,
  analysisCount,
  findings,          // Top Findings（默认 8 条）
  findingsTotal,
  conclusion,        // 含 conclusionType / conclusion 正文（已拼研究问题与免责声明）
  recommendation,    // { stage, text, reasons, disclaimer }
  dataValidity,      // { passed, failedCount, pendingCount, emptyResultCount, notes, ... }
  preview,           // 计划预览（含 emphasisAnalysisNames）
  intent,            // 意图判定证据
  outcome,           // 完整结论视图（含 questionAlignedFindings / questionAlignment）
}
```

⚠️ **这是同步长请求**：28 条分析在跨境 TiDB 上实测 **≈ 150–250 秒**（均摊 ≈ 3.1s/条，RTT ≈ 208ms）。调用方若怕超时，改用两段式。

### 5.2 两段式（§23，怕超时时用）

```ts
const { plan, question } = await trpc.researchPlanner.createQuestion.mutate({
  datasetVersionId: 390002,
  researchQuestion: "...",
});                                  // 快：只做意图识别 + 计划生成 + 落库
await trpc.researchPlanner.runResearchDetached.mutate({ planId: plan.id });
// 轮询进度（无需新端点：引擎逐条更新 research_analysis.status）
const view = await trpc.researchPlanner.getOutcome.query({ questionId: question.id });
```

`runResearchDetached` 的边界**如实声明**：进程内注册表 ⇒ 进程重启会丢失（不做重试），只保证「同一计划不会重复跑」。

### 5.3 错误码（稳定闭集）

`QUESTION_TOO_SHORT` / `QUESTION_TOO_LONG` / `QUESTION_NOT_FOUND` / `PLAN_NOT_FOUND` / `PLAN_RUN_MISSING` / `PLAN_EMPTY` / `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` / `EXPERIMENT_WRITE_FAILED` / `RUN_WRITE_FAILED` / `QUESTION_WRITE_FAILED` / `HYPOTHESIS_WRITE_FAILED` / `PLAN_WRITE_FAILED` / `INTERNAL`

调用方**按码分流，不解析 message 文案**。

---

## 6. 交付物⑥ — E2E 验证报告（真实执行）

全部走**真实 tRPC**（`appRouter.createCaller`）→ **真实 TiDB**，零 mock。Dataset = **390002**（`first_limit_pullback` v2，READY，23,978 事件，outcome 视界 5/10/20，path 相对日 1..20）。

### 6.1 §27 首板回踩 E2E —— `_e2e_research_planner.mts`

**检查项 37 / 失败 0** ✅

> 最终实体：`experimentId=480001` / `researchRunId=750001` / `planId=90001` / Candidate `#570001`

| 项 | 实测值 |
| --- | --- |
| 输入 | `{datasetVersionId: 390002, researchQuestion: "首板之后回踩，只要不跌破首板开盘价，后面的收益是不是更好？"}` |
| 意图 | `PULLBACK_EFFECTIVENESS`（加权分 6，专指词命中 2：回踩 / 跌破）；`fallbackApplied = false` |
| 计划 | **28 条**（P0 4 / P1 21 / P2 3），无裁剪、无丢弃 |
| 分析类型 | EVENT_STUDY 4 / CONDITIONAL 17 / QUANTILE 3 / STABILITY 2 / SEGMENT_RELATION 1 / DESCRIPTIVE 1 |
| 执行 | 完成 **28 / 28**，结果行合计 **528**，失败 0，未完成 0 |
| 零结果 | **1 条**（`market_cap 分位 → T+5 收益`）⇒ `dataValidity.passed = false`，如实点名 |
| Finding | 共 **23** 条 → 去重合并 1 条 → 默认展示 **8** 条 |
| 结论 | `SUPPORTED`；`researchQuestion` = 问题原文；正文含【研究问题】/【统计判定】，**无占位符** |
| 建议 | `NEEDS_MORE_RESEARCH`（因存在 1 条零结果 ⇒ 证据不完整，**绝不在证据残缺时给 WORTH_NEXT_STAGE**） |
| 提问锚点 | `REQUIRED_FALLBACK`（问题未点明精修维度），锁定 4 条必需项，4 条 Finding |
| Candidate | #570001，状态 `DRAFT`，六项 provenance `complete: true`，条件与源分析**逐字一致** |
| 与既有手工基线对照 | 与手工 Run 570001 **0 条条件重合** ⇒ 自动规划是「**补充**」而非「复现」；重合项为 0 时断言如实记为未验证，不假装等价 |

### 6.2 §28 回踩深度 E2E —— `_e2e_research_second_question.mts`

**检查项 36 / 失败 0** ✅（走 §20 单次调用入口 `runFromQuestion`）

> 最终实体：`researchId(experimentId)=480003` / `researchPlanId=90003` / `researchRunId=750003` / `questionId=90003` / Candidate `#570003`
> （`runFromQuestion` 单次调用的一次完整跑，总耗时约 3 分钟）

| 项 | 实测值 |
| --- | --- |
| 输入 | `{datasetVersionId: 390002, researchQuestion: "首板后回踩深度是否影响后续收益？回踩得深一点是不是更值得买入，还是回踩浅一点更好？"}` |
| 意图 | `PULLBACK_EFFECTIVENESS`（同一 Dataset、不同问题 ⇒ 侧重不同但方法同族） |
| 计划 | **28 条**（P0 4 / P1 21 / P2 3），**深档 2 条 / 浅档 2 条** |
| 精修配方排序 | `depth_deep` → `depth_shallow` → `shrink_50` → `shrink_30` → `last_expansion` → `last_bullish`（修复前：深度分档只有 `shallow` 挤进前 6） |
| 执行 | 完成 **28 / 28**，结果行合计 **528** |
| 提问锚点 | `EMPHASIS` ✅（锁定 4 条深度分档分析，4 条 Finding 全部进「针对你的问题」） |
| Finding | 共 23 条 → 默认展示 8 条；**「针对你的问题」4 条，全部是深度分档** |
| 结论 | `SUPPORTED`；`researchQuestion` = 问题原文（非空）；正文含【研究问题】/【针对该问题】/【统计判定】 |
| Candidate | #570003，`DRAFT`，provenance 齐备 |

### 6.3 这一轮的**研究答案**（深 vs 浅）

| 分档 | 条件组 T+5 均值 | 全样本基准 | 超额 | 样本量 |
| --- | --- | --- | --- | --- |
| **深档** `close_ratio ≤ 0.95` 且未破首板开盘价（T+2） | **−6.97%** | +1.52% | **−8.49pp** | 1,602 |
| 深档（T+3） | −6.91% | +1.52% | −8.43pp | 1,638 |
| **浅档** `close_ratio ∈ [0.98, 1]` 且未破首板开盘价（T+2） | **−1.42%** | +1.52% | **−2.94pp** | 2,841 |
| 浅档（T+3） | −1.08% | +1.52% | −2.60pp | — |

**结论**：在本 Dataset 上，回踩越深、后续 T+5 越差；深档显著劣于浅档（差异约 5.5 个百分点）。
这与既有手工基线（`RESEARCH-FINDING-001` B9 的「越深越差 −2.6% / −5.1% / −8.8%」）**方向一致** —— 两条独立路径互相印证。

⚠️ 这是**统计关系**，不是交易结论：样本内关系可能样本外失效，交易成本 / 流动性 / 涨跌停无法成交等约束尚未纳入。

---

## 7. 交付物⑦ — 复用验证（§31 Phase I）

| 判据 | 实测 |
| --- | --- |
| 执行器数量 | **6 类**，与 RESEARCH-002 原样**逐字一致**（`createDefaultAnalysisExecutorRegistry().listTypes()` 断言） |
| 计划用到的类型 | 全部在已注册集合内 ⇒ 无 `UNKNOWN_ANALYSIS_TYPE` |
| 两问共用执行器 | §27 与 §28 的计划**共用** EVENT_STUDY / CONDITIONAL / QUANTILE / STABILITY / SEGMENT_RELATION |
| 工具层复用 | Finding 引擎、结论引擎、Candidate 导出、`groupConditions` 条件分组全部**原样调用**，未复制任何统计实现 |
| 数据库复用 | 零新表用于「执行」；新增 2 表仅承载「问题 / 计划」这两个新概念 |
| 两问的差异在哪 | **只在「精修配方的选择与排序」** —— 同一套骨架，提问侧重决定精修维度。这正是「自动研究」应有的样子 |

复用的反证：`_e2e_research_second_question.mts` 段 [4] 逐条打印执行器清单并在两轮之间对照；段 [3] 打印精修配方排序，证明差异来自排序而非新代码路径。

---

## 8. 交付物⑧ — 最终问题清单

> 只列**真正阻塞 Strategy / Backtest** 的。以下 **P0 阻塞项：无**。

### 8.1 会阻塞后续阶段，但不在本轮范围（已登记、需单独排期）

| 项 | 影响 | 为什么不夹带 |
| --- | --- | --- |
| **条件右值无算术**（`9ar` 已修写路径，但既有 8 条已转正策略的声明仍是字符串常量） | Parameter Search 会在「声明条件」与「执行门槛」不一致的前提下搜索 | 该表禁 UPDATE ⇒ 正解是按新写法重新转正；属规格级改动 |
| **回测冷算 20 分钟阻塞页面**（`9aq`） | `/leader-candidates` 数据一变就白屏等 20 分钟 | 需 stale-while-revalidate，属体验补口 |
| **连接池 `maxIdle === connectionLimit` ⇒ `idleTimeout` 是死配置** | 20 分钟冷算中途可能 `read ECONNRESET` | 属基础设施配置，需单独验证 |

### 8.2 不阻塞，但消费方**必须知道**的口径（已在本报告与代码注释中钉死）

1. **`research_result` 的分组行与基准行同名同类型**：`resultType` 同为 `GROUPED`、`metricCode` 相同、`dimensionJson` 同为 null，**仅靠行序区分**（前 5 行 = 全样本基准，后 5 行 = 条件组）。这是既有 RESEARCH-002 口径，本轮未改。
   ⇒ **消费方必须走 Finding 层**（`effect.groupReturn` / `benchmarkReturn` / `buckets`），**不要**按 `metricCode` 抓第一行。本轮实测踩过这个坑：四条分析的读数曾看起来「全都一样」，那是读数方式错了。
2. **`market_cap` 在 Dataset 390002 上 100% 为 NULL**（0 / 25,108）⇒ 「market_cap 分位」必然零结果。这**不是**代码缺陷，而 §22 已能如实点名。
3. **引擎的「关键量」仍由固定分析类型优先级选出**（`QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY → SEGMENT_RELATION`），**与提问无关**。本轮用视图层「针对你的问题」段补齐了「用户问的那件事」；若要彻底改为「问题驱动的主效应选择」，需扩 `ConclusionBuildInput` 让 Planner 指定主分析 —— 本轮**未做**，因为它会改变手工 Run 的结论语义。
4. **执行前数据有效性检查是名字级的**：只能确认「变量已登记」，**不能**确认「变量有值」。预览页与结论页都已明说。
5. **零结果分析既不算「已验证」也不算「已排除」** —— 它没有进入任何 Finding 的证据。
6. **Research → Candidate 永不自动流转**：候选状态恒为 `DRAFT`，必须人工确认（§2 / §30）。
7. `runResearchDetached` 的进程内注册表**不做持久化、不做重试**（如实声明，不假装是队列）。

---

## 9. 改动清单（可复核）

**新增（本报告主体）**

```
drizzle/0039_research_planner.sql
drizzle/0040_candidate_plan_provenance.sql
scripts/apply0039_research_planner.mjs（幂等 apply）
scripts/apply0040_candidate_plan_provenance.mjs（幂等 apply）
server/researchEngine/planner/{moduleRegistry,intent,analysisPlan,questionPlanning,aggregate,errors}.ts
server/researchPlannerRouter.ts
client/src/pages/research/ResearchAsk.tsx
client/src/components/research/researchAskForm.ts
docs/evidence/_e2e_research_planner.mts
docs/evidence/_e2e_research_second_question.mts
docs/evidence/_probe_planner_dryrun.mts
docs/evidence/_probe_research_ask_page_render.mjs
docs/evidence/_cleanup_research_planner_trials.mts
docs/evidence/_probe_{analysis_metrics,run_findings,result_schema,plan_tables,prior_analyses,market_cap_feature}.mts
```

> ⚠️ **一次性过程脚本已按仓库纪律移出仓内**（`PROJECT_RULES.md`「过程脚本纪律」：`docs/evidence/` 只准放真探针 `.mts`/`.mjs` 与运行结果，`.py` 过程脚本不准进）—— 本轮用过的 3 个改字脚本（`_patch_roadmap_9at.py` / `_patch_changelog_9at.py` / `_patch_project_rules_9at.py`）+ 1 个前端接线脚本（`_wire_research_ask.py`）**已移至仓外** `C:\work\sourcecode\_scratch\research-planner-001\`（一并带走的还有此前遗留的 4 个 market-data 相关 `.py`）。当前 `docs/evidence/*.py` 计数 = **0**。

**修改**：见 §3.2 与 §4.1。

**验收命令**

```bash
npx tsc --noEmit                                       # exit 0
npx tsx docs/evidence/_probe_planner_dryrun.mts        # 计划生成（含排序对照）
npx tsx docs/evidence/_e2e_research_planner.mts        # §27：37 / 0
npx tsx docs/evidence/_e2e_research_second_question.mts# §28：36 / 0
node docs/evidence/_probe_research_ask_page_render.mjs  # 默认模式禁用词表（需 dev server 3000）
```

---

## 10. 边界声明

- **本轮没有**：新增执行器 / 新增统计实现 / 复制 Dataset 或 Registry / 重写 Strategy Domain / 重写 Backtest / 删既有高级能力 / 建任何 `*V2` / 自动 Research→Strategy / 无限增加 Analysis（§9 上限内）。
- **§33**：本轮之后**不再扩展 Research 功能**。
- **未验证**：真机浏览器渲染验收脚本已就绪但**本轮未实跑**（依赖 dev server；请在无在途 Run 时执行）。
- **数据卫生**：探针产生的试跑数据（`[自动研究]%` 实验 / Run）可用 `docs/evidence/_cleanup_research_planner_trials.mts --apply` 清理，默认 dry-run；**不删已转正候选**。
