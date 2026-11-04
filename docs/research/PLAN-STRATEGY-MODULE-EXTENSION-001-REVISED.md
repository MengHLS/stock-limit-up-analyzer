# PLAN-STRATEGY-MODULE-EXTENSION-001-REVISED

> **修订版**：重审「Pattern 如何携带自己的研究能力」并重新规划分期。
> **取代对象**：`docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001.md` 的 **§分期（P0~P4）**。
> 001 的**事实部分**（四处基础设施的实查结论）仍然有效，本文件不重复整篇，只做**校正 + 重判**。

## 0. 本轮边界与纪律（先声明，后论证）

| 项 | 本轮 |
|---|---|
| 代码改动 | **零**（未改 `server/**`、`client/**`、`shared/**`、`scripts/**`） |
| DB / Migration | **零**（未写库、未新增 migration、未动 schema） |
| 第二套 SoT | **未新建**（本文件是描述，不是新的权威源；权威源仍是既有代码与 ROADMAP） |
| legacy 删除 | **未做** |
| 实施 P0~P4 | **未开始** |
| 产物 | 仅本文件一份（审计 + 规划报告） |

**证据纪律**：本文每条结论后标注 `[实查]`（读代码/读文档得到，附路径行号）或 `[推断]`（由实查组合而成的判断，标明依据）。**不产出任何策略结论、"最佳参数"或收益数字。**

**事实基线**：工作区 HEAD `bb89eb8`（与 001 同）；`RESEARCH_READY = TRUE`（gate 17/17，`docs/architecture/SYSTEM-BASELINE.md:135,349`）；`SYSTEM-BASELINE.md` = `v1.1.1`，最新增量为 PARAMETER-001(`9bs`) / PARAMETER-002(`9bt`)（同文件 :525、:555）。

---

## 1. Executive Summary

**一句话**：**本项目已经有一个「声明 → 多投影」的生产级范式，而且它已经跑在 Pattern 上；真正缺的不是框架，是三处收尾 —— 研究侧「语义目录」不可扩展、研究报告无落地产物、结论→候选没有研究派生桥。**

修订后的七条核心判断（与 001 的差异逐条标明）：

| # | 判断 | 相对 001 |
|---|---|---|
| 1 | **Pattern 已经是研究的「最小声明单元」且是单一真源**：研究模块规格、执行配方、候选草图、参数空间 **四投影全部从 `patterns/*.ts` 派生，并且已在生产路径接线**（研究模块注册表 / 配方注册表 / `createCandidate`） | 001 只说「骨架已存在」，**升级为「已接线」** |
| 2 | **Pattern 目前是纯数据，不带任何执行逻辑**（`TradingPatternSpec` 无函数字段；`patterns/**` 零运行时依赖）—— 这**不是缺陷**，是纪律。正确方向是「让声明覆盖更多语义」，**不是**「让 Pattern 带代码」 | 001 未明确表态；本文**明确否决「Pattern 自带执行代码」** |
| 3 | **真正阻塞「新模式专有研究」的是研究侧的变量/条件目录是闭集**：`variables.ts` 是 `Object.freeze` 常量 + **没有 register API**；模式专有语义（如「是否跌破首板开盘价」的新变体）**无法在声明层表达**，必须改 Core | 001 把缺口记为「分析类型闭集（12 声明 / 6 注册）」；本文**校正为：变量/条件目录闭集才是主缺口，分析类型闭集是次要缺口**（见 §2.B.6 论证） |
| 4 | **研究报告确实「够不到」**：`research_artifact` 表 + Repository + 类型齐备，但**生产代码零写入**（`server/**` 对 `artifacts.create` 零命中），前端也零引用 ⇒ 今天只有「前端即时渲染」 | 与 001 一致（本条实查**复核成立**） |
| 5 | **`Analysis → Result → Finding → Conclusion` 这一段是真实、完整、已落库的**（`research_finding` / `research_conclusion` 两表真的有写入者）—— 001 未强调这一点，导致「研究已走到哪一步」被低估 | **新增事实**，直接影响分期（Finding 层不需要新建） |
| 6 | **`Conclusion → Candidate` 是断的**：候选规则内容的三个来源（Pattern 投影 / 单条分析的 filterRule / Hypothesis 条件）**都不来自研究发现了什么**；findings 只作为 provenance 锚点（`sourceFindingIds`）。**没有任何代码把一次 run 的多条结果/发现合成候选**（grep `deriveCandidate* / candidateFromFindings / findingsToCandidate / synthesizeCandidate` 全空） | 001 未拆到这一层；本文**新增为独立缺口**，并给出「放 Strategy 之后」的排期建议 |
| 7 | **完整扩展不需要大量中间任务**：把它们压成 **Phase A（报告落地）/ B（语义槽）/ C（分析类型注册表化，可延后）/ D（结论→候选派生桥，应后置）** 四期，且**只推荐先做 A** | 001 的 P0~P4 被**重判**（合并 1 期、降级 1 期、后置 1 期、删掉「插件发现」整条） |

**唯一推荐的下一步：Phase A（研究报告产物落地）** —— 理由见 §13。

---

## 2. Current Architecture Audit

### 2.0 分层与真实链路（先给坐标，再进细节）

```
                    ┌──────────────────────── 数据层（已认证） ────────────────────────┐
原始表 index_daily / stock_daily_prices / limit_up_records / liquidity_daily
   │  datasetRegistry（插件 = 5 表 DDL + IO + Builder，手工注册 1 个 first_limit_pullback）
   ▼
dataset_definition(1164) → dataset_version(1196, READY)        ← 唯一权威坐标 = datasetVersionId
   │  runWorkbenchAssembly/datasetFromRegistry.ts（直读，单坐标；失败回落 researchDataset 从原始表重建）
   ▼
┌──────────────────── 研究层（真的在跑） ────────────────────────────────────────────┐
research_question → research_experiment → research_run → research_hypothesis → research_plan
   → research_analysis(configJson) + research_analysis_condition
   → 【engine.ts#run()】samples → 6 类 Analysis 执行 → research_result
   → 【findingEngine】research_finding   ← ✅ 落库
   → 【conclusion.ts】research_conclusion ← ✅ 落库（引用 findingIds）
   → ❌ research_artifact（表/仓储齐备，**生产零写入** ⇒ 没有落盘报告）
└────────────────────────────────────────────────────────────────────────────────────┘
   │  人工/半自动（无自动派生桥）
   ▼
research_strategy_candidate(1829)  ← 规则来自 Pattern 投影 / 单条分析 / Hypothesis；findings 仅 provenance
   │  promote（service.ts:746）
   ▼
strategies → strategy_versions（1.0.0 / Draft）→ strategy_parameters   +   strategy_research_provenance
   │  runWorkbenchAssembly/assemble.ts:696-761（strategy-core 优先，失败回落 legacy-recipe）
   ▼
闭环 14 阶段：data/research/strategy/backtest/evaluation/optimization/regime/finalize = ✅wired（8）
            robustness/oos/overfitting/paper/review/discipline = ⛔NOT WIRED（6）
            首阻塞在 robustness ⇒ CL_RUNNER_NOT_INJECTED，其后一律 CL_UPSTREAM_BLOCKED
```

**读法（关键结论）**：**研究侧「跑到结论」是真链路；「结论→候选」靠人；「报告落盘」是缺环。**

---

### 2.A patternLibrary —— Pattern 距离「研究最小业务单元」还有多远？

**判定：声明层已完成 85%，语义层 0%。**

| 审计项 | 实查结论 | 证据 |
|---|---|---|
| Pattern 如何声明 | 单一接口 `TradingPatternSpec`：`patternId / label / purpose / whenToUse / sketch? / research / execution`。`research` 与 `execution` **必须显式写出、可为 `null`**（`null` 是"被声明的结论"，不是漏写） | `server/research/patternLibrary/types.ts:309-327` `[实查]` |
| 是否已有「单一声明 → 多投影」 | **是**，且是生产级：`projectResearchModule` / `buildPatternModuleSpecs` / `projectParameterDefinitions` / `projectParameterSpace` / `projectSketchParameterSpace` / `projectCandidateSketch` / `projectRecipeReference` / `projectRecipeDefinition` | `project.ts`、`projectRecipe.ts` `[实查]` |
| 是否禁止第二套 | **是**，写死在文件头纪律里：`project.ts:4`「本文件是『声明（纯数据）→ 可执行/可落库实例』的**唯一实现**」；`projectRecipe.ts:6`「所有模式共用这一份投影，**禁止在别处再写一套**」 | 同文件 `[实查]` |
| 是否已是 Strategy 上游 | **是（生产路径）**：`buildPatternModuleSpecs()`→研究模块注册表；`buildPatternRecipeDefinitions()`→配方注册表；`projectCandidateSketch()`→`createCandidate` | `researchEngine/planner/moduleRegistry.ts:32,565`；`research/recipeRegistry.ts:34,170`；`researchPlannerRouter.ts:25-28,540-541` `[实查]` |
| 已存在的扩展槽 | **加一种模式 = 新建 `patterns/xxx.ts` + `patterns/index.ts` 加一行**（8 个模式已注册）。**不需要**改 `moduleRegistry.ts`（其内容已外置到声明库） | `patterns/index.ts:38-47` `[实查]` |
| 「AI 生成模式声明」是否为目标态 | **是**，但只写在 `types.ts:25-28`：「**声明是纯数据，不是代码**… 这样『AI / vibecoding 生成一个模式声明』产出的是可以逐字段 review 的数据」 | `types.ts:25-28` `[实查]`（001 记的「文件头注释」在 `types.ts`，**不在** `index.ts`——已校正） |
| 能否承载 Pattern-specific Research | **部分**：`research` 段可声明模块元数据 + **条件配方清单**（guard / refinement / control / depthBand…）+ 分析类型偏好；**不能**声明新语义变量、不能声明分析逻辑 | `types.ts:222-256` `[实查]` |
| 注册期守卫 | 有：研究模块重复 key 拒绝；分析执行器重复拒绝；配方「声明的特征必须真实产出」；草图结构校验。**但 `ALL_TRADING_PATTERNS` 是普通只读数组**：`patternId` 唯一性**只在测试里断言**，运行期无守卫；**无 `Object.freeze`**；**无 zod/JSON-Schema 校验** | `moduleRegistry.ts:269-275`；`analyses/registry.ts:23-28`；`recipeRegistry.ts:185-230`；`project.ts:282-296`；`tests/.../patternLibrary.test.ts:177-183` `[实查]` |
| 投影使用度（重要） | **生产在用**：`projectResearchModule`/`buildPatternModuleSpecs`、`projectRecipeDefinition`/`buildPatternRecipeDefinitions`、`projectCandidateSketch`、`listTradingPatterns`、`requireTradingPattern`。**仅测试用**：`projectParameterSpace`、`projectSketchParameterSpace`。**全仓无消费方**：`projectParameterDefinitions`、`declaredParameterKeys`、`projectRecipeReference` | 全仓 import 追踪 `[实查]` |

**回答「还有多远」**：**Pattern 已经是研究的声明真源，但「研究能力」目前只能通过「引用 Core 已有的语义」来表达**（例如 `guardRecipes: [{guard, floor:"open"}]` 之所以能用，是因为 Core 里**已经有** `pullback_holds_event_open_{d}d` 这个字段）。一旦新模式需要**一个 Core 里没有的语义**，声明层就无能为力 ⇒ 这就是主缺口（§2.B.6）。

---

### 2.B analyses / registry —— 中央能力，还是需要 Pattern Extension 层？

| 审计项 | 实查结论 | 证据 |
|---|---|---|
| Analysis 类型如何注册 | `AnalysisExecutorRegistry.register(executor)`，重复即抛；`require()` 未注册抛 `UNKNOWN_ANALYSIS_TYPE`（**具名失败，不返回 undefined 让调用方猜**） | `researchEngine/analyses/registry.ts` 全文 `[实查]` |
| 声明 vs 已注册 | **声明 12**：`DESCRIPTIVE, DISTRIBUTION, QUANTILE, CORRELATION, IC, EVENT_STUDY, CONDITIONAL, PATH, REGIME, SIGNIFICANCE, STABILITY, SEGMENT_RELATION`；**已注册 6**：`DESCRIPTIVE, EVENT_STUDY, QUANTILE, CONDITIONAL, STABILITY, SEGMENT_RELATION` | `researchCore/types.ts:83-107`；`analyses/registry.ts:58-67` `[实查]` |
| 执行器接口 | `AnalysisExecutor { analysisType; requiredVariables(config, ctx); execute(ctx) }`；执行上下文含 `analysis / config / datasetVersionId / samples / horizons / conditionSet` | `researchEngine/types.ts:176-188,137-148` `[实查]` |
| Analysis 是 Core-owned 还是 Pattern-owned | **Core-owned**（6 个执行器都是通用统计：描述/事件研究/分位/条件/稳定/分段关系）。Pattern 只能**选用**，不能贡献 | 同目录 `[实查]` |
| Analysis 配置如何保存 | 表 `research_analysis` 的 **`configJson`** 列（另有 `moduleKey / priority / requiredFlag / planId`） | `drizzle/schema.ts:1648-1683`；写入 `batchCreate.ts:149`、`researchEngineRouter.ts:641` `[实查]` |
| Analysis Run 如何执行 | `engine.ts#run()`（:176）→ `resolveAnalyses`（:829）→ `executor.execute` → `results.createMany`（:891）→ 逐分析置 COMPLETED/FAILED（:875/894/908）。派发点 = `engine.ts:841 registry.require(...)` | `[实查]` |
| 同一种 Analysis 能否被不同 Pattern 复用 | **能，且这是当前常态**（8 个模式共享 6 类分析；模块 id 只影响「生成哪些分析对象」，不影响执行器） | `planner/analysisPlan.ts` `[实查]` |
| 是否支持 Pattern 专属 Analysis | **不支持**（见下条） | `[实查]` |
| **新增分析类型的真实成本** | 必须改 **Core 至少 2 处 + 生成侧 1 处**：① `researchCore/types.ts` 的闭集 `as const`；② `analysisConfig.ts` 的 `switch` —— **`default:` 无条件抛 `UNKNOWN_ANALYSIS_TYPE`（:163-171）**，不加 case 连配置解析都过不去；③ `analyses/registry.ts` 注册执行器（否则 `require` 抛错）；④ 另需 `analysisPlan.ts` 补生成逻辑（该文件**硬编码**了各类型的生成：:364/:379/:401/:439/:487/:518/:537/:583）与前端展示 | `[实查]` |

**校正 001 的一处判断（重要）**：

> 001 把「分析类型闭集」列为缺口 #2。**复核后：它存在，但它不是「新模式专有研究」的主阻塞点。**
> 理由 `[推断，依据如下实查]`：模式专有研究**绝大多数情况下是「用已有分析类型 + 该模式自己的条件字段」表达的**（例：首板回踩的 135 个 `CONDITIONAL` 分析，全部复用 `CONDITIONAL`）。真正卡住的是**条件字段从哪来** —— 即：
> 1. `variables.ts`（71318 B）的 `FEATURE_VARIABLES` 是模块级 `Object.freeze` 常量（17 个固定特征），**没有任何 register/注入 API**；结果变量由 `buildOutcomeVariables(...)` 按数据集真实 horizons **动态展开**（dataset 390002 实测 127 个），观察日变量 `buildObservationVariables(max)` 每 offset 18 个（`OBSERVATION_MAX_OFFSET = 20`）。**新增变量必须直接改 `variables.ts`** `[实查]`。
> 2. 分析条件字段受 **`assertConditionFieldsKnown`（`engine.ts:939`）** 白名单校验 ⇒ 目录里没有的字段**连条件都建不出来** `[实查]`。
> 3. 因此「Pattern 自带研究语义」的**真实瓶颈 = 研究侧语义目录闭集**；分析类型闭集是「想引入**全新统计口径**时才撞到的第二道墙」。
>
> **结论：把「分析类型注册表化」从 P1 降级为 Phase C（可延后）—— 因为 6 类已能覆盖「首板后回踩」这类模式的研究意图（见 §6 逐模块验证）。**

---

### 2.C datasetRegistry / plugins —— 是不是瓶颈？（结论：不是，别为插件化而插件化）

| 审计项 | 实查结论 | 证据 |
|---|---|---|
| 插件如何注册 | `createDefaultPluginRegistry()` 里**一行** `registry.register(firstLimitPullbackPlugin)`；**只有 1 个插件**（测试钉死 `["first_limit_pullback"]`） | `datasetRegistry/plugins.ts:242-249`；`tests/server/datasetRegistry/plugins.test.ts:87` `[实查]` |
| 插件声明什么 | 只有 5 件事：`datasetCode / displayName / description / physicalTables(role+label+createSql) / createIO() / createBuilder()`。**不声明** dataset↔pattern 关系、不声明构建窗口与筛选口径（那些在 `dataset_build_config`） | `plugins.ts:30-58` `[实查]` |
| 是否有自动发现条件 | **完全没有**：全仓无 glob / 动态 `import()` / codegen（唯一的 `import("./types")` 是 TS 类型查询）。未注册 code 在构建时抛 `BUILDER_NOT_REGISTERED` | `registry.ts:428-438`；`lifecycle.ts:32-67`（17 个错误码） `[实查]` |
| Dataset 角色 | `DatasetRole = event / prefix / post / path / outcome / feature`（6 个）；命名 `ds_{dataset_code}_{role}`。内置插件只声明 5 个 —— **`feature` 是 schema 层预留、实现层为空**（`createDefinition` 对它取 `null`） | `naming.ts:39-40,86-88`；`registry.ts:478,94` `[实查]` |
| **Dataset ↔ Pattern** | **零关联**：`TradingPatternSpec` 里没有 `datasetCode/datasetVersionId`（grep `dataset` 于 `patternLibrary/**` 零命中）；`researchDataset/**` 与 `datasetRegistry/**` 对 `pattern` 零引用。真正的绑定在**策略文档层**（`strategy_versions.datasetVersionId`、`strategy_version_datasets`） | `[实查]` |
| 一次运行读几个数据集 | **只能一个**：直读桥入参只有单个 `readonly datasetVersionId`；回落路径 `ResearchDatasetRequest` **不带任何数据集坐标**（从原始表建一份宽面板）。若模式想「流动性表 + 自己的事件表」联合，今天**无法在一次运行内表达** | `runWorkbenchAssembly/datasetFromRegistry.ts:851-853,938`；`runWorkbenchAssembly/assemble.ts:379,400` `[实查]` |
| 是不是真实瓶颈 | **不是主瓶颈**：新增 Pattern **完全不需要碰 `datasetRegistry`**（数据集是逐运行用户指定的单一坐标，且 `datasetCode` 硬校验只认 `first_limit_pullback`） | `datasetFromRegistry.ts:978` `[实查]` |

**对 001 的处置**：**删除「P2 插件发现 + `extension:verify`」中的「插件发现」半条**。理由 `[推断]`：① Pattern 与 Dataset 无耦合 ⇒ 插件发现不会提升 Pattern 扩展效率；② 真实约束是「单数据集坐标」，而它不是插件化能解决的；③ 若将来确需跨 datasetCode 取数，应先论证用例存在（当前代码**没有**该能力，也**没有**该用例）。

---

### 2.D Research → Strategy —— 真实链路与断点

**逐段实测（这是本次审计最重要的产出）：**

| 段 | 状态 | 证据（实查） |
|---|---|---|
| `Analysis → Result` | ✅ 真实 | `engine.ts:891 results.createMany` |
| `Result → Finding` | ✅ **真实且落库** | `finding/findingEngine.ts:211 repos.findings.create`；表 `research_finding`（`drizzle/schema.ts:2109`）；主类型 `ResearchFinding`（`researchCore/types.ts:762-804`，含 effect/sample/horizon/stability/monotonicity/interaction + 五维强度 + UNIQUE `fingerprint` 幂等）；7 种 finding 类型 / 3 档强度 |
| `Finding → Conclusion` | ✅ 真实且消费 findings | `conclusion.ts:103`（`findings?: ConclusionFindingInput[]`）、`:269 buildConclusion`、`:135-196 buildEvidence`；落库 `engine.ts:338-352` → 表 `research_conclusion`（`schema.ts:1780`，`findingIdsJson`） |
| `Conclusion → Artifact` | ❌ **缺失** | `research_artifact`（`schema.ts:1931-1951`，`artifactType=REPORT\|DATA\|CHART\|STATISTICS\|EXPORT\|OTHER`）**生产零写入**：`artifacts.create` 仅出现在 `scripts/verifyResearchCore.mts:345,358` 与 `tests/.../inMemory.test.ts`；`server/**` 唯一引用是 `maintenance.ts:343-345` 的 `list/delete`（级联删）；`client/**` 对 artifact **零引用** |
| `Conclusion → Candidate` | ⚠️ **半自动（无研究派生桥）** | `service.ts:547-659 createFromConclusion`：只做「结论存在 + experiment 存在 + 来源 dataset 恒取 `experiment.datasetVersionId` + `assertConclusionEligible` 资格 + 同名软拒绝 + 证据快照」，规则内容**只来自 `input.overrides`**（缺省即空）；`researchPlannerRouter.ts:541` 的规则来自 **Pattern 投影**（且 `filterRule = {groups:[]}`）；`researchPlannerRouter.ts:590-594` 可来自**单条**分析的 filterRule；`researchEngineRouter.ts:965 createCandidateFromHypothesis` 直接抄 hypothesis 条件。**三条来源都不消费 findings 内容**；findings 只进 `sourceFindingIds` 与 `sourceTraceJson`（provenance 回显） |
| `Candidate → StrategyVersion` | ✅ 真实 | `service.ts:746 promote`：`buildStrategyDefinition` → `validateBuiltStrategyDefinition` → `buildExecutionAssumptions` → `buildStrategyRecipe` → `strategies.createStrategyVersion` → 写 `strategy_research_provenance` → 候选回写 `CONVERTED`。版本恒 `1.0.0`（`definitionBuild.ts:1066`）、初始 `Draft`（**promote 不上生产**） |
| 候选生命周期 | ✅ 六态机 + 守卫 | `researchCore/candidates.ts:169-176`：`DRAFT→REVIEW/ARCHIVED`、`REVIEW→ACCEPTED/REJECTED/DRAFT/ARCHIVED`、`ACCEPTED→CONVERTED/ARCHIVED`…；`CONVERTED` **只能**由 `promote` 到达（`candidateTypes.ts:81` `CONVERSION_REQUIRES_PROMOTE`）；`assertCandidateConversionCoherence`（`candidates.ts:195`） |
| 决策引擎选择 | ⚠️ 双路径并存 | `runWorkbenchAssembly/assemble.ts:696-761`：默认 `"legacy-recipe"`；`coreVersionFromDocument` 成功**且** `createCoreDecisionSource` 不抛错 → `"strategy-core"`；回落原因码来自 `strategyCore/production/versionFromDocument.ts:44`（`NO_LEGACY_DEFINITION` / `CORE_VERSION_BUILD_FAILED`），拼进人读文本 `strategyDecisionEngineNote` |
| 闭环 14 阶段 | ⚠️ 8/14 | wired：data/research/strategy/backtest/evaluation/optimization/regime/finalize；NOT WIRED：robustness/oos/overfitting/paper/review/discipline（`closedLoop/spec.ts:67-166`、`requirements.ts`）。**首阻塞在 `robustness`（idx6）⇒ `CL_RUNNER_NOT_INJECTED`，其后全部 `CL_UPSTREAM_BLOCKED`**（`orchestrator.ts:338-350`）⇒ 真正能跑的是子链 `data→research→strategy→backtest→evaluation`（`strategyEvaluation/evaluate.ts:61-67`） |

**回答 Q1（当前是否已具备 `Pattern → Research → Strategy` 的基础）**：
**具备「两段 + 一断点」** —— `Pattern → Research(→Conclusion)` ✅（真实、落库、可复用）；`Candidate → Strategy` ✅（promote 真实、Draft 为止）；**中间 `Conclusion → Candidate` 无自动派生**。所以答案是：**基础具备，主链缺「研究证据 → 候选」这一环，且缺「报告落盘」这个对外产物。**

---

## 3. Existing Capability Reuse

用户要求的盘点表（**只列与研究扩展有关的**；"是否需要修改"指**为支撑 Pattern Research Extension**）：

| 能力 | 当前状态 | 已有实现 | 可复用 | 需要修改 |
|---|---|---|---|---|
| Pattern Library | 8 个模式；声明 → 四投影，生产接线 | ✅ | ✅ 直接复用 | **需扩展**（加"语义声明"段，不改既有字段） |
| Research Module Registry | 内容已外置到声明库（`buildPatternModuleSpecs`） | ✅ | ✅ | 否 |
| Research Engine（run 编排） | `engine.ts#run()` 10 阶段；含回收/增量 | ✅ | ✅ | 否（除非动 `variables.ts`，见 B） |
| Analysis 执行器 | 6/12 注册；接口稳定 | ✅ | ✅ | **仅 Phase C**（注册表化） |
| Analysis 配置与条件 | `research_analysis.configJson` + `research_analysis_condition` | ✅ | ✅ | 否 |
| **变量目录** | `FEATURE_VARIABLES` 冻结闭集 17 + 动态结果变量 + 观察日变量 | ✅ | ⚠️ 只能原样用 | **🔴 需要改**（无 register API ⇒ 语义槽的落点） |
| Result | `research_result` | ✅ | ✅ | 否 |
| **Finding** | 引擎 + 表 + 五维评分 + 指纹幂等 | ✅ | ✅ | 否（**001 未强调，实测已完整**） |
| Conclusion | 构建 + 资格闸门 + 落库 | ✅ | ✅ | 否 |
| **Artifact / 报告** | 表 + 仓储 + 类型齐备，**生产零写入** | ⚠️ 半 | ✅ 表结构可直接用 | **🔴 需要新增生产侧写入 + 呈现**（Phase A） |
| Strategy Candidate | 六态机 + promote + 溯源 | ✅ | ✅ | **仅 Phase D**（证据聚合器） |
| Strategy / Version | 版本不可变、Draft→Production 八态 | ✅ | ✅ | 否 |
| Strategy Core | `StrategyRuntime.evaluate` 唯一入口；生产接线 | ✅ | ✅ | 否 |
| Parameter Search | `runParameterSearch`；搜索空间来自策略文档投影 | ✅ | ✅ | 否 |
| Backtest | Core 补齐中（BACKTEST-002 = COMPLETE） | ⚠️ | ✅ | 否 |
| Closed Loop | 8/14 wired；子链 5 阶段可用 | ⚠️ | ✅ | 否 |
| Dataset Registry / Plugin | 1 插件、手工注册、无发现 | ✅ | ✅ | **不需要**（已删出关键路径） |
| Research Dataset | 单坐标直读 + 从原始表重建 | ✅ | ✅ | 否 |
| 前端研究链路 | 实验/分析/发现/结论/候选页齐；**无 artifact/报告页** | ⚠️ | ✅ | **Phase A 补报告入口** |

**避免重复建设（硬约束）**：**不新建** 第二套 Pattern / Analysis / Artifact / Candidate / Strategy；**不新建表**；**不引入第二套 SoT**。下表是「谁拥有什么」的边界线：

| 概念 | 唯一 SoT | 允许的扩展方式 |
|---|---|---|
| Pattern 声明 | `server/research/patternLibrary/**` | 新增 `patterns/*.ts` + 一行注册 |
| 研究模块元数据 | 由 Pattern 投影（`project.ts`） | 声明字段 |
| 研究语义（变量/条件字段） | `researchEngine/variables.ts`（现状） | **Phase B：改为「声明 + 唯一展开器」** |
| 分析执行 | `researchEngine/analyses/**` | Phase C：注册表化 |
| 发现 / 结论 | `researchCore` 类型 + `research_finding` / `research_conclusion` | 不改 |
| 报告产物 | `research_artifact`（表已存在） | Phase A：补写入器（**不新建表**） |
| 候选 / 策略 | `research_strategy_candidate` / `strategies` + `strategy_versions` | Phase D：补派生桥 |

---

## 4. Pattern Research Extension Target Architecture

### 4.1 目标形态（三层；**示意，不照此改目录**）

```text
patternLibrary/
├── types.ts                      ← 声明类型（已有）
├── project.ts / projectRecipe.ts ← 「声明 → 可执行」唯一投影器（已有）
├── semantics/                    ← 🆕 语义声明（纯数据）：模式专有研究语义
│   └── （先内置，不建目录；见 Phase B 的「最小落点」）
└── patterns/
    ├── firstLimitPullbackHoldShrink.ts   ← 声明：研究意图 + 语义 + 执行门槛（已有，Phase B 增补）
    └── ...
```

**关键取舍（对 §2.A 结论的直接回应）**：**Pattern 不携带执行代码**。扩展能力的形态是：

```
Pattern 声明（纯数据，AI 可生成）
   ├── 研究意图（moduleKey / 分析类型偏好 / 目标 / 视界 / 分组 / 稳定维度）   ← 已有
   ├── 条件配方（guard / refinement / control）                              ← 已有
   ├── 语义声明（新增：受控算子白名单组成的表达式，如「跌破事件日开盘价」）      ← Phase B
   └── 执行投影（门槛 / rankFeature / topN / tunable 参数）                   ← 已有
        ↓ 由唯一的投影器
   研究侧：变量目录条目 + 条件字段白名单      ← 今天做不到（闭集）
   策略侧：featureRegistry 特征 + 派生字段桥  ← 今天要手写
```

### 4.2 与既有范式对齐（为什么这是"顺着项目走"而不是"另起一套"）

项目里**已经成功**的范式是「**一份声明 → 多个投影，投影器唯一，禁止第二套**」（`patternLibrary`）。Phase B 只是把这个范式**再推一格**：把「研究语义」也变成声明，让**研究侧变量目录**与**策略侧特征表**都成为同一份声明的**投影**。

> 收益（`[推断]`，依据 §2.B.6 与 §2.A 的实查）：今天同一个模式语义要在**两套目录**里各写一次 ——
> 研究侧 `variables.ts`（`PULLBACK_STATS`：`pullback_*` 条件字段，按 offset 自动展开）与
> 策略侧 `featureRegistry.ts`（`makePullbackFeatures()`，:380-412/:435）+
> 派生字段桥 `DERIVED_BAR_FIELD_TO_FEATURE_ID`（**唯一权威，仅 4 条**：`:416-421`，消费于 `fieldReference.ts:86`，未登记即拒绝）。
> 一旦"改一处忘另一处"，就会出现「**研究能算、策略判不了**」或反过来的静默漂移。Phase B 把这三处收敛为「一份声明 + 两个投影」。

### 4.3 扩展槽（收敛：001 的 9 个具名槽 → 4 类槽）

| 槽类 | 内容 | 现状 | 归属期 |
|---|---|---|---|
| **S-A 声明槽** | 研究意图、条件配方、执行投影 | ✅ 已有 | — |
| **S-B 语义槽** | 受控算子组成的语义表达式 → 研究侧字段 + 策略侧特征（双投影） | 🔴 缺 | **Phase B** |
| **S-C 执行槽** | 分析执行器（通用统计） | ✅ 6/12 | Phase C（仅当需要新统计口径） |
| **S-D 呈现槽** | 报告产物（artifact 写入）+ 前端入口 | 🔴 缺 | **Phase A** |

**不做的事（明确列为"不需要"）**：① Pattern 插件化/自动发现；② 让 AI 生成可执行代码；③ 新建第二套 Analysis/Artifact/Candidate；④ 为架构完整性引入新的中间层。

---

## 5. Pattern / Analysis / Dataset / Strategy Relationship（Q4 的架构图）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  声明层（纯数据，AI 可产、人可逐字段 review）                                  │
│                                                                              │
│   Pattern 声明 ──────────┐                                                    │
│   (TradingPatternSpec)   │  project.ts / projectRecipe.ts（唯一投影器）        │
│                          ▼                                                    │
│   ┌──────────────┬───────────────┬────────────────┬─────────────────────┐     │
│   │ 研究模块规格  │ 研究语义声明   │ 执行配方/门槛   │ 候选草图/参数空间     │     │
│   │ (→ 中央 Registry)│ (→ 变量目录) │ (→ 策略特征)   │ (→ Candidate)        │     │
│   └──────┬───────┴───────┬───────┴───────┬────────┴──────────┬──────────┘     │
└──────────┼───────────────┼───────────────┼───────────────────┼────────────────┘
           ▼               ▼               ▼                   ▼
┌─────────────────────────────────────────────┐   ┌────────────────────────────┐
│ 研究基础设施（中央，通用，Pattern 只"用"不改） │   │ 策略基础设施（中央）         │
│                                              │   │                            │
│ moduleRegistry（内容来自声明）                │   │ featureRegistry + 派生字段桥│
│ analyses/registry（6 类通用统计）             │   │ StrategyRuntime.evaluate    │
│ variables.ts（🔴 闭集 ⇒ Phase B 改注册表）    │   │ strategy_versions（不可变） │
│ conditionEvaluator / engine / planner        │   │ strategy_parameters（参数） │
│   ↓                                          │   │   ↑                        │
│ research_run → result → finding → conclusion │   │   │                        │
│   ↓                                          │   │   │                        │
│ [Phase A] research_artifact(REPORT) ─────────┼───┼───┘（报告引用 run/结论）    │
└──────────────┬───────────────────────────────┘   └────────────────────────────┘
               ▼
      [Phase D] 研究证据聚合器（多实验/多发现 → 候选规则）
               ▼
      research_strategy_candidate → promote → strategy_versions(1.0.0 Draft)

┌──────────────────────────────────────────────────────────────────────────────┐
│ 数据层：Dataset Registry（插件 = 5 表 DDL+IO+Builder，手工注册 1 个）          │
│   dataset_version(READY) ── 单坐标 datasetVersionId ──▶ 研究运行读入            │
│   ⚠️ Pattern 与 Dataset **无耦合**；一次运行**只能读一个**数据集                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

**三条边界线（答 Q4）**：

1. **Pattern Library 是"声明源"**，不拥有执行逻辑，也不拥有数据；它只向三方**投影**：研究模块（进中央 Registry）、执行配方（进中央 Recipe Registry）、候选草图（进 Candidate）。
2. **Analysis Registry 与（Phase B 后的）变量目录都是"中央通用能力"**，Pattern **只选用、不改**；两者**都不应**变成 per-pattern 代码仓库。
3. **Dataset Plugin 与 Pattern 无关**（零引用），**保持现状**；它服务的是「原始数据 → 结构化数据集」这一层，不是「模式研究」这一层。

---

## 6. 首板后回踩 Example（Q5 的工作样例，**不实施**）

Pattern：`first-limit-pullback-hold-shrink`（`patterns/firstLimitPullbackHoldShrink.ts`，8003 B，8 个模式中最大）。
已声明要点 `[实查]`：`sketch`（`event=FIRST_LIMIT_UP` / `timing=NEXT_OPEN` / `trigger=FIRST_VALID_DAY` / 观察窗 `[2,2]` 交易日）；`research.moduleKey="PULLBACK_EFFECTIVENESS"`，`primaryAnalysisType="CONDITIONAL"`，推荐 6 类；`targetKinds=[future_return,max_drawdown,min_return]`，`preferredHorizons=[5,10,20]`，`entryEvaluations=[2,3,5]`；`guardRecipes`（floor `open`/`low`）+ 2 个 `guardControl` + **5 类 `refinementRecipes`**（缩量 0.5/0.3、放量、末根阳线、站上事件日收盘、**深度三档 shallow/normal/deep**）；`quantileFeatures` 4 个、`groupingDimensions=[year,board]`、`stabilityDimension=year`；`execution`：`signalKind="gated"`、门槛 = 守线 ∧ 缩量（∧ 可选红盘）、`rankFeature="momentum"`、`topN=5`、3 个 `tunable` 参数。

**6 个研究模块的逐条"今天能跑到哪一步"**（这是本方案最硬的证据段）：

| # | 研究模块 | 输入 | 执行 | 输出 | 沉淀 | 最终（Candidate→Strategy） | 今天能跑？ |
|---|---|---|---|---|---|---|---|
| 1 | **回踩深度分析** | 数据集 + `pullback_*` 条件字段（按 offset 自动展开的 `PULLBACK_STATS`）+ `future_return_{d}d` | `CONDITIONAL`（已注册） | `research_result` | finding → conclusion | 现状：靠 to候选 override 或 Pattern 投影 | ✅ **可跑**（`depthBand` 三档已声明；⚠️ 口径注意：9w 已实查更正「深度5档」实为**相对首板收盘涨跌幅 5 分位**，T+2 切点 −4.51%/−1.05%/+2.26%/+7.67%，**同列不可跨天比较**） |
| 2 | **T+1~T+5 路径分析** | 同上 + 多视界 | × | `research_result`（多视界） | 同上 | 同上 | ⚠️ **近似可跑**：`EVENT_STUDY` 已注册，可用多视界覆盖；**但 `PATH` 分析类型「声明未注册」** ⇒ 若要求"逐日完整路径表"，今天只能近似 |
| 3 | **最佳观察日分析** | `entryEvaluations=[2,3,5]` + 观察日变量（每 offset 18 个 `obs_*`） | `CONDITIONAL` × offset | `research_result` | 同上 | 同上 | ✅ **可跑**（9y 已实测跑过 135 个 `CONDITIONAL`） |
| 4 | **买入日分析** | 同上 | 同上 | 同上 | 同上 | 同上 | ✅ 可跑，⚠️ **但必须按决策日滚动重算入池** —— 9w(c) 预警：`researchDataset/pullback.ts#screenSingleTarget` 的 `broken` 用**整段 T+1..T+5 的 `low`** 决定入池，若以 T+2 为决策点即**样本选择层 look-ahead**（幸存者偏差）。**这是本方案最高优先级的正确性风险**（见 §11-R1） |
| 5 | **突破概率分析** | 需要"突破"的语义（如 `close > event.open × (1+x)`） | `QUANTILE` / `CONDITIONAL` | `research_result` | 同上 | 同上 | ⚠️ **若"突破"是现有字段可表达 ⇒ 可跑**（另有 `breakout-success-research` 模式，`primary=QUANTILE`）；**若需新的模式专有语义 ⇒ 🔴 卡住**（`variables.ts` 无注册 API） |
| 6 | **失败路径分析** | `targetKinds` 含 `max_drawdown` / `min_return` | `CONDITIONAL` / `DESCRIPTIVE` | `research_result` | 同上 | 同上 | ✅ 可跑；⚠️ 9s 已登记：极值口径下「取值 > 0 的占比」**不构成胜率**，须按目标变量口径改写措辞（数字不动） |

**四段生命周期（Q5 完整形态）—— 每段今天的真实状态**：

```
Definition      ✅ TradingPatternSpec（8 个已注册；缺运行期唯一性守卫）
    ↓
Extension       ⚠️ 声明槽齐全（研究意图/配方/门槛）；🔴 语义槽缺（不能声明 Core 里没有的语义）
    ↓
Run             ✅ engine.ts#run()（question→experiment→run→plan→analysis→result）
    ↓
Result          ✅ research_result（按条件组 × 目标 × 视界）
    ↓
Artifact        ❌ 落盘报告不存在（表在、写入器缺）      ← Phase A
    ↓
Finding         ✅ research_finding（7 类 + 五维强度 + 指纹幂等）
    ↓
Conclusion      ✅ research_conclusion（引用 findingIds；资格闸门）
    ↓
Candidate       ⚠️ 只能靠「人工 override / 单条分析 filterRule / Pattern 投影」；findings 仅 provenance  ← Phase D
    ↓
Strategy        ✅ promote → strategy_versions 1.0.0（Draft）
```

**样例结论（回答「当前系统能否让一个 Pattern 的多个研究实验共同形成一个候选」）**：
**结论层可以（一次 run 的多个分析共同产出一个 conclusion，且 conclusion 引用多个 findings）；候选层不行（候选规则不消费 findings）。** 缺口定位 = `<Candidate>` 与 `<Conclusion>` 之间 `[实查]`。

---

## 7. AI Boundary（Q6）

**原则（沿袭 `types.ts:25-28` 的既有纪律，不新立）**：**AI 只产出「可逐字段 review 的数据」，绝不产出「需要人读懂逻辑的代码」。**

| 环节 | AI 可产出 | 必须人工审核 | 机器可判校验 |
|---|---|---|---|
| Pattern 身份/意图 | `label / purpose / whenToUse` | ✅ 文案与口径 | 必填非空；`patternId` 唯一 |
| 研究意图 | `moduleKey / 分析类型偏好 / 目标 / 视界 / 分组 / 稳定维度 / minSampleCount` | ✅ 业务含义 | 引用的分析类型**必须已注册**；`targetKinds` 必须在真实目标词表内 |
| 条件配方 | `guard / refinement / control` 声明 | ✅ 语义正确性 | 门槛引用的特征**必须真实产出**（`RECIPE_FEATURE_NOT_PRODUCED`）；门槛引用的参数**必须已声明**（`projectRecipe.ts:138-159`） |
| **语义声明（Phase B 新增）** | 由**受控算子白名单**组成的表达式（如 `min(open, low)` 类比较） | ✅ 算子白名单本身**只能人工扩**（AI 不得新增算子） | 算子 ∈ 白名单；字段 ∈ 目录；PIT：`assertObservationConditionsPitSafe` 全绿 |
| 执行投影 | `signalKind / 门槛 / rankFeature / topN / tunable` | ✅ | 决策引擎必须为 `strategy-core`（禁静默回落 `legacy-recipe`） |
| 研究结论 | **不产出**（结论由 `conclusion.ts` 从 findings 构建，AI 不介入数字） | — | 结论资格闸门（`assertConclusionEligible`） |
| 候选规则 | **Phase D 内仍需人审** | ✅ | 证据必须可追溯（`sourceFindingIds` / `evidence`） |
| 代码 | **一律不产**（执行器、算子、投影器都是人手写的具名槽） | ✅ | `tsc --noEmit` = 0；测试基线不新增失败 |

**一句话**：**AI 生成"研究意图/声明"，系统以具名槽提供"经过验证的执行"；两者之间的桥 = 机器可判校验 + 人工签字。**

---

## 8. Research Artifact Role（Q5 的 Artifact 段深挖）

**为什么 artifact 是必须的，而不是"前端渲染就够了"** `[推断，依据 §2.D 实查]`：

1. **它是"研究可交付"的唯一形式**：用户的原始诉求是「**得出自己的分析报告**」——今天 `research_result` / `research_finding` / `research_conclusion` 都有库表，**但没有任何一个"报告"形态的产物可以被指给第三方看**（没有文件、没有 URI、没有指纹）。
2. **它是可回归的验收载体**：没有落盘产物，任何扩展（Phase B/C/D）的验收都只能靠测试断言；有 artifact 后可做「同数据 + 同声明 ⇒ 同 checksum」的端到端回归。
3. **它是溯源链的终点**：`research_artifact` 已有 `experimentId` / `runId`（至少一个，仓储强制）+ `checksum` + `metadataJson`，天然能承载「这份报告是哪个 run、哪个实验、哪份数据集、哪版声明」的完整溯源，**不需要新表**。
4. **`storageType` 已预留 `INLINE`** —— 首期可直接把 markdown 内联/落文件，避免引入对象存储。

**形态建议（Phase A 详细）**：一次 run 产出 **1 个 REPORT artifact**，内容为「数据坐标 + 分析清单 + 结果表 + 发现（含强度/局限）+ 结论（含 policy/disclaimer）+ 未决问题」；
配套 `metadataJson` 记录：`datasetVersionId`、`runId`、`experimentId`、`analysisIds`、`findingIds`、`conclusionId`、`patternId`（若有）、生成器版本；
**checksum** 覆盖正文（幂等：同 run 重跑 ⇒ 同 checksum ⇒ 不重复写）。

**边界**：只写 `artifactType = REPORT`（必要时 `DATA` 存明细 CSV 引用）；**不改** `research_artifact` 表结构（**零迁移**）；不新增第二套报告体系；报告中**必须保留**既有免责声明与 policy 字段。

---

## 9. Revised Phase Plan（Q7：重排 P0~P4）

### 9.1 对 001 分期的重判

| 001 原期 | 内容 | 重判 | 理由（依据实查） |
|---|---|---|---|
| P0 | 报告产物落地 | ✅ **保留并升级为 Phase A**（唯一推荐下一步） | 唯一「用户明确诉求今天够不到」+ 纯新增 + 零迁移 + 可独立回滚 |
| P1 | 分析类型注册表化 + 实现 `PATH` | ⚠️ **降级 → Phase C（可延后）** | 6 类已覆盖首板回踩 6 个研究模块中的 5 个（§6）；`PATH` 可用多视界 `EVENT_STUDY` 近似；新增类型要动 Core 2 处 ⇒ 不值当先做 |
| P2 | 插件发现 + `extension:verify` | ✂️ **删除「插件发现」半条 → 保留 `verifyExtension` 校验，并入 Phase B** | Pattern 与 Dataset 零耦合（§2.C）；真实约束是"单数据集坐标"，不是插件发现 |
| P3 | 决策路径收敛 | ⚠️ **合并进 Phase B 的验收门（不作为独立期）** | 只要 Phase B 要求「新模式必须断言 `strategyDecisionEngine === "strategy-core"`」，收敛就被"逼"出来了；不必单开一期 |
| P4 | 派生字段桥 6 处收敛 | ✅ **并入 Phase B 的正题（即语义槽的收益本身）** | 桥本体很小（4 条白名单，`:416-421`），真正的成本是**两套目录双写** —— 这正是 Phase B 要解决的 |
| — | **新增**：Pattern 语义层 | 🆕 **Phase B**（架构正题） | §2.B.6 定位的主缺口 |
| — | **新增**：结论→候选派生桥 | 🆕 **Phase D（后置到 Strategy 阶段之后）** | promote 只到 Draft；当前主线阻塞在参数搜索性能（`9br` R-06）与闭环 data 阶段注入（`9br` 项 19）⇒ "研究自动驱动候选"不是当前主线 |

### 9.2 四期（粒度 = 一期一个完整能力/闭环）

#### **Phase A｜研究报告产物落地（最小闭环）**

- **范围**：新增 report 生成器（读 run/analysis/result/finding/conclusion → 正文 + metadata）→ 写 `research_artifact(REPORT)`；新增**只读**端点（按 run/experiment 取报告）；前端在既有 `ResearchDetail` 内增「查看/下载报告」入口。
- **边界**：**零迁移、零 schema 变更、零新表、零新依赖**；仅新增文件 + 既有文件的最小接线；不动研究引擎语义。
- **为什么先做**：① 用户诉求本项今天够不到；② 它是 Phase B/C/D 的**验收载体**；③ 风险最低、可单独回滚。
- **不做什么**：不做 PDF/图表渲染（首期 markdown/HTML 即可）；不做 artifact 上传/对象存储；不做"报告模板市场"。
- **验收**：一次真实 run 后 `research_artifact` 有 1 行 REPORT；同 run 重跑 checksum 相同且**不重复写**；前端可经**正常导航**打开（CDP 量 DOM，禁只测端点）；`tsc` = 0；测试基线不新增失败。

#### **Phase B｜Pattern 语义槽（让新模式不必改 Core 两套目录）**

- **范围**：新增**纯数据**的语义声明（受控算子白名单，例：`min/max/last/close/open/ratio/hold/compare`）+ Core 里**唯一的展开器**，把语义声明**同时投影**为：① 研究侧变量/条件字段、② 策略侧特征 + 派生字段桥条目；配套 `verifyExtension`（机器可判清单，见 §12）。
- **边界**：**必须动 `server/**`** ⇒ 须排在**无在途 Run** 时段（热重启会杀 Run）；仍需 **零迁移**（不建表）。
- **风险**：最高（触及 Core 的变量目录与 PIT 校验）。**必须先做 PIT 反例测试**（`assertObservationConditionsPitSafe` / `assertGroupPitSafe`）。
- **验收**：新增一个**测试用 pattern 声明**（不进生产注册表）即可获得研究侧条件字段 + 策略侧特征；「同一语义只声明一次」；研究侧与策略侧**由同一份声明产出**（对拍测试）；未登记字段一律拒绝；决策引擎必须 `strategy-core`。

#### **Phase C｜分析类型注册表化（可延后）**

- **范围**：`RESEARCH_ANALYSIS_TYPES` 闭集 → 注册表（保留静态声明以维持类型安全）；`analysisConfig.ts` 的 `switch/default` → 表驱动；`analysisPlan.ts` 的硬编码生成 → 按类型注册生成器。**先只做"消硬编码"，不急着实现 `PATH`。**
- **为什么延后**：§6 逐模块验证显示 6 类已够用；先做会引入 Core 大改而收益不可见。
- **触发条件（何时才该做）**：出现一个**不能被现有 6 类表达的**研究意图，且它在**两个以上**模式中重复出现。

#### **Phase D｜研究证据 → 候选派生桥（后置到 Strategy 阶段之后）**

- **范围**：新增**规则式证据聚合器**（多分析/多发现 → 候选 entry/filter 规则），产出物**仍须人审**（保持六态机的 `DRAFT→REVIEW→ACCEPTED`）。
- **硬约束**：**禁止**任何"从数据里拟合阈值"的黑箱；聚合规则必须是可读、可回归、可解释的确定性规则；`sourceFindingIds` / `evidence` 必须完整。
- **为什么后置**：当前主线阻塞不在这一环（见 §9.1）。

---

## 10. Dependency Graph

```
                    ┌───────────────────────────────┐
                    │  Phase A  报告产物落地          │  ← 唯一推荐先做
                    │  （纯新增；零迁移）             │
                    └──────────────┬────────────────┘
                                   │ 提供「落盘产物」作为后续验收载体（软依赖）
                                   ▼
                    ┌───────────────────────────────┐
                    │  Phase B  Pattern 语义槽        │  ← 架构正题（动 server Core）
                    │  语义声明 → 研究变量 + 策略特征  │
                    └──────────────┬────────────────┘
                          ┌────────┴────────┐
                          ▼                 ▼
        ┌──────────────────────────┐  ┌────────────────────────────┐
        │ Phase C 分析类型注册表化  │  │ （B 顺带解决 P3 决策路径收敛）│
        │ 触发式，可延后            │  │ （B 顺带解决 P4 派生字段桥）  │
        └──────────────────────────┘  └────────────────────────────┘

        ┌───────────────────────────────────────────────────────────┐
        │ Phase D 研究证据→候选派生桥                                 │
        │ 依赖：A（报告/证据可读）；与 B/C 无强依赖；建议排在          │
        │ 参数搜索性能(R-06) 与闭环 data 注入 之后                    │
        └───────────────────────────────────────────────────────────┘

        外部前置（不属于本方案，但会挡住一切）：
        · 无在途 Run 的时段（Phase B 要动 server/**）
        · 参数搜索单 Run 593~627s（9br R-06）—— 直接决定研究吞吐
```

---

## 11. Risks

| # | 风险 | 触发 | 影响 | 缓解 | 阻断？ |
|---|---|---|---|---|---|
| **R1** | 🔴 **样本选择层 look-ahead** | 以 T+d（d<5）为决策点做研究，而入池判定用整段 T+1..T+5 的 `low`（`researchDataset/pullback.ts#screenSingleTarget`） | 人为抬高 T+2 胜率 ⇒ **研究结论不可信**（会污染候选 → 策略） | 先按决策日滚动重算入池（`min(low[T+1..T+d]) >= open(T)`），再谈任何"最佳观察日/买入日"结论；9w(c) 已登记、9y 列为 BLOCKED | ✅ **是**（涉及结论正确性） |
| **R2** | 热重启杀在途 Run | Phase B 改 `server/**` | 研究 Run 永久 `RUNNING` | 动手前跑在途闸门（`_probe_inflight_runs.mts`）；排到无在途 Run 时段 | ✅ 是（工程纪律） |
| **R3** | 两套目录双写漂移 | 语义只在研究侧或只在策略侧登记 | 「研究能算、策略判不了」的静默不一致 | Phase B 的"一份声明 → 两个投影" + 对拍测试 | 否（B 解决） |
| **R4** | 报告口径被误读 | 极值目标（`max_return`/`min_return`）产出"胜率"、分位桶跨天比较 | 展示层误导（9s / 9w 已各有一次先例） | 报告用"按目标变量口径改写标签"的纯措辞函数；桶区间标注左开右闭 + 不可跨天比较 | 否 |
| **R5** | artifact 膨胀 / 重复写 | 无幂等键 | 库/磁盘膨胀，同一 run 多份报告 | checksum + runId 幂等；首期只留 REPORT | 否 |
| **R6** | 研究吞吐不足 | 单 Run 593~627 s（`9br` R-06，主因未定位） | Phase B 的"跑起来验证"批次成本高 | 先按 `9br` 结论做 profile；把 Phase B 的验收压到小数据集 | 否 |
| **R7** | 决策引擎静默回落 | `legacy-recipe` 与 `strategy-core` 双路径并存 | 新模式"以为在跑 Core，实际跑 legacy" | `verifyExtension` 断言 `strategyDecisionEngine === "strategy-core"`；回落实时响亮提示 | 否 |
| **R8** | 越界实施（本轮禁令） | 顺手改了很多 | 触碰在途 Run / 制造第二套 SoT | 本文件 §0 边界 + 每期"不做什么"清单 | — |

---

## 12. Verification / Acceptance Gates

**通用门（每期都必须过，沿用项目既有判据）**：

| 门 | 判据 |
|---|---|
| G-1 类型 | `tsc --noEmit` = exit 0 |
| G-2 测试基线 | 全量 `vitest` 失败**文件集合** = 基线 **8 文件 / 17 用例**（先剥 ANSI 色码），**零新增** |
| G-3 行尾 | `node scripts/checkEolDrift.mjs` = **0 漂移** |
| G-4 前端可达 | 按**正常导航**量 DOM（无头 Chrome/Edge + CDP），禁"只测端点"；长请求按钮 pending **必须换文案** |
| G-5 纪律 | 零迁移 / 零新表 / 零新依赖 / 零 `prettier --write`；动 `server/**` 前后跑在途 Run 闸门 |
| G-6 结论纪律 | 产出物中**不得**出现策略结论 / 最佳参数 / 收益承诺；免责声明与 policy 不得删 |

**Phase A 专属门**：
A-1 真实 run 后 `research_artifact` 新增**恰 1 行** REPORT（`artifactType=REPORT`，至少含 `runId` 或 `experimentId`）；A-2 同 run 重跑 ⇒ **checksum 相同且行数不增**（幂等）；A-3 报告正文含 `datasetVersionId / analysisIds / findingIds / conclusionId` 全链溯源；A-4 前端入口经**正常导航**可达且能打开。

**Phase B 专属门（`verifyExtension` 机器可判清单，8 条）**：
B-1 语义表达式算子 ∈ 白名单；B-2 引用的字段 ∈ 目录（未登记即拒）；B-3 PIT：`assertObservationConditionsPitSafe` / `assertGroupPitSafe` 全绿（含反例测试）；B-4 **同一语义只声明一次**，研究侧与策略侧由同一份声明投影（对拍：两侧字段集合一致）；B-5 门槛引用的参数在规则图中**真被引用**（`PARAMETER_REFERENCE`），且 `RECIPE_FEATURE_NOT_PRODUCED` / `RECIPE_PARAMETER_UNKNOWN` 不触发；B-6 决策引擎 = `strategy-core`；B-7 零迁移（`drizzle/` 无新增）；B-8 `patternId` 运行期唯一性 + 声明不可变（`Object.freeze` 或等价）。

**Phase C 专属门**：C-1 删掉 `analysisConfig.ts` 的 `default: throw` 后，未注册类型仍**具名失败**（错误码不变）；C-2 12 个声明类型的"声明↔注册"差集可见（`listTypes()` 可查）；C-3 既有 6 类行为**逐字节不变**（同输入同输出回归）。

**Phase D 专属门**：D-1 聚合规则确定性（同输入同输出，可重放）；D-2 每个候选规则可回溯到 `findingIds` / `evidence`；D-3 禁黑箱拟合（无阈值搜索）；D-4 候选必须经六态机（不得直接 `ACCEPTED`）。

---

## 13. Recommended Next Phase（Q8）

### 唯一推荐：**Phase A｜研究报告产物落地**

**为什么只选它（四条，全部有实查支撑）**：

1. **它是用户原始诉求里唯一"今天够不到"的一项**：`research_artifact` 表 + 仓储 + 类型齐备，**生产零写入**、前端零引用 ⇒「得出自己的分析报告」在今天的系统里**没有产物**。`[实查]`
2. **它是后续所有扩展的验收载体**：Phase B/C/D 的成效最终要被"人看见"，而今天能被人看见的只有前端即时渲染 —— 没有落盘产物就没有可回归的对照物。`[推断]`
3. **它是四期里唯一"纯新增 + 零迁移 + 零 Core 语义改动"** 的：不碰 `variables.ts`、不碰 `analysisConfig.ts`、不碰任何 schema ⇒ **风险最低，可独立回滚**。`[实查]`
4. **它不预设架构结论**：报告只需要"读既有四张表 + 写既有 artifact 表"，即便 Phase B 的设计后续调整，Phase A 的产物也不会作废。`[推断]`

**不选 Phase B 作为第一步的原因**（写明白，避免误解）：Phase B 是**架构正题**（语义槽），但它**必须动 `server/**` Core**（`variables.ts` 收权 + PIT 校验），且当前**研究吞吐受单 Run 593~627 s 限制**（`9br` R-06），在报告产物还不存在时就开始改 Core，等于"在没有验收手段的情况下改最危险的部分"。**建议：A 落地后立刻排 B**（B 仍是本方案的架构正题，只是不该排在第一步）。

**Phase A 的实施步骤（5 步，供下一轮执行）**：
1. 先跑在途 Run 闸门 + 记录基线（`tsc` / `vitest` 失败集合 / `checkEolDrift`）；
2. 新增报告生成器（纯函数：run + analyses + results + findings + conclusion → 正文 + metadata），放 `server/research/**` 下语义化目录（遵守 ROADMAP §49.1：**禁数字后缀**）；
3. 接线写入 `research_artifact(REPORT)`（`artifactType=REPORT`、`storageType=INLINE|FILE`、`checksum` 幂等）；
4. 新增**只读**端点 + 前端在既有 `ResearchDetail` 增入口（先做可达性，再谈样式）；
5. 验收：§12 的 G-1~G-6 + A-1~A-4，并用**真实 run**（非 mock）取证。

**需要你裁决的事项（本轮未擅自处理）**：
1. **是否批准 Phase A 单独立项实施**（还是先只批准"设计细化"）；
2. **本文件编号**：⚠️ 顺带复核 —— ROADMAP **编号台账滞后**仍在（`ROADMAP.md:4` 文件头与 §44.5 两处仍写「已用至 `9br`、下一个 `9bs`」，而 `9bs`(PARAMETER-001) / `9bt`(PARAMETER-002) **已在用**，见 `SYSTEM-BASELINE.md:525,555`）⇒ 按「下一个未占用」应为 **`9bu`**；
3. **是否登记进 ROADMAP §44.5 / `ROADMAP-CHANGELOG.md`**（属改文档，本轮未做）；
4. **是否上传协作项目资产**（上传是变更操作，须你确认后我才做）；
5. **R1（样本选择层 look-ahead）的处置顺序**：建议排在 Phase B 之前（它决定研究结论是否可信）。

---

## 附：本文件与 001 的关系（一页对照）

| 维度 | 001 | 001-REVISED（本文） |
|---|---|---|
| 立意 | 「让研究可以加更多分析类型并出报告」 | 「**Pattern 是研究最小业务单元**：模式自己携带研究语义，靠统一研究基础设施形成证据，最终沉淀为 Strategy」 |
| Pattern 是否带代码 | 未表态 | **明确否决**；声明是纯数据，执行走具名槽 |
| 主缺口 | 报告 / 分析类型闭集 / 插件手工注册 / 决策双路径（并列 4 条） | **语义目录闭集（主）/ 报告缺失 / 结论→候选断桥**；插件发现**删除**；分析类型闭集**降级** |
| Finding 层 | 未涉及 | **实测已完整**（引擎 + 表 + 评分 + 幂等），无需新建 |
| 分期 | P0~P4（5 期） | **Phase A~D（4 期）**，其中 C 触发式、D 后置；P3/P4 并入 B |
| 下一步 | 建议 P0 | **只推荐 Phase A**，且 B 紧随其后 |
| 事实校正 | — | ① "AI/vibecoding" 注释在 `types.ts:25-28`（非 `index.ts`）；② Pattern↔Dataset **零耦合**；③ `projectParameterSpace` 等 3 个投影**无生产消费方**；④ 一次运行**只能读一个**数据集 |
