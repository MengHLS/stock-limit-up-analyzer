# 方案：策略模块扩展能力（研究分析 ⇄ 现有策略模块的整合）

> **状态**：方案（**未实施**，待批准）｜ 2026-09-19 19:40 GMT+8
> **编号**：**待分配**（建议 `9bu`；理由见 §11.3「编号台账漂移」）
> **本轮边界**：**未生成任何代码、未改动任何既有文件、未执行任何写库操作**；本文件是唯一新增物。
> **事实来源**：`docs/architecture/SYSTEM-BASELINE.md` v1.1.1 + 本轮对本机工作区代码的只读实查（HEAD `bb89eb8`，`git status --porcelain` 为空）。
> **追溯**：ROADMAP §39（`RESEARCH_READY=TRUE` 只解除「禁止正式策略结论」闸门）、§49（命名规范）、AGENT-GUIDE §3（14 条禁止行为）。

---

## 0. 结论摘要

**一句话**：本项目**已经有**「新增一种交易模式 = 加一个声明文件」的扩展骨架（`patternLibrary`）与三个同构的具名注册槽（策略特征 / 分析执行器 / 数据集插件），**缺的不是框架，而是四件收尾工作**：

| # | 收尾工作 | 直接对应本章 |
|---|---|---|
| **A** | **报告没有落地产物** —— 「得出自己的分析报告」今天**够不到**（表与仓储齐备，生产零写入、零生成器、零端点） | §3 G-1 |
| **B** | **分析类型是封闭集** —— AI 生成的「分析文件」无法单独落地（要改两处闭集代码） | §3 G-2 |
| **C** | **数据集插件手工注册** —— 「加入这个文件就能运行」不成立（无目录扫描、无 codegen） | §3 G-3 |
| **D** | **两条决策路径并存** —— 新模式还做不到「只写一份声明」（legacy-recipe 回落仍在） | §3 G-6 |

**本方案的形态**：不是新建框架，而是
> **一份「扩展契约」（接入文档）＋ 三层结构（声明层 / 执行层 / 数据层）＋ 九个具名扩展槽 ＋ 五次分期落地。**

**最关键的取舍（先说清楚）**：**AI 只负责生成「纯数据声明」，执行代码必须走人审的具名槽。** 理由不是保守，而是有先例：`patternLibrary` 的三条设计纪律里，第一条就是「声明是纯数据，不是代码……这样 AI/vibecoding 生成一个模式声明，产出的是可以逐字段 review 的数据，而不是一段需要人读懂逻辑的代码」。本方案沿用这条纪律，并把它的适用范围从「交易模式」扩到「分析 / 数据集 / 报告」。

---

## 1. 用户诉求拆解

原始描述（`todo:rHncjk`）拆成 **6 条可验收诉求**：

| # | 诉求 | 本方案的承接章节 |
|---|---|---|
| R1 | 结合现有代码，整合出「研究分析 ⇄ 现有策略模块」的整合能力 | §4 总览、§5 路径 R/E |
| R2 | 有新的交易模式时，用 **AI 工具 + 系统接入文档** 生成所需的分析数据与代码文件 | §6 接入文档、§7 生成物规范 |
| R3 | **加入这个文件**就能运行新的分析 | §8 D-2 具名槽、§9 P2 |
| R4 | 能**得出自己的分析报告** | §3 G-1、§9 P0 |
| R5 | 整合出**策略所需的数据** | §5 路径 E |
| R6 | 需要的数据集 / **次级数据**可以从原始数据中提取整理 | §5 路径 D |

**范围提醒（不可越线）**：本方案**不产出任何策略结论**。ROADMAP §39 规定 `RESEARCH_READY=TRUE` 只是解除了「禁止正式策略结论」的闸门；DOMAIN-MAP §14 另有硬约束：Parameter Search 域「不产出系统性结论」，前端与报告**不得**出现「最佳参数 / 最优策略 / 推荐参数」这类措辞。本方案涉及的所有报告与产物都必须遵守。

---

## 2. 现状实查：扩展骨架已存在（不要重新发明）

**这是本节最重要的事实**：用户设想的「声明文件 → 丢进去就能跑」，在本仓库**已经有一个成熟先例**，而且它的文件头注释写的就是这个目标。

### 2.1 已有骨架一览（逐条给坐标）

| 骨架 | 位置 | 现状：「加一种新的 X」的代价 |
|---|---|---|
| **交易模式声明库（Pattern SoT）** | `server/research/patternLibrary/**` | **加一个声明文件 + 一行**（`patterns/index.ts` 的 `ALL_TRADING_PATTERNS`）。声明同时投影出**四件产物**：研究模块规格 / 执行配方定义 / 候选草图 / 可搜参数空间 |
| **策略特征注册表** | `server/strategyCore/featureRegistry.ts#FeatureRegistry` | **纯数据驱动**：写一个 `FeatureDefinition`（含 `compute` 纯函数）+ `createFeatureRegistry([...])`。有测试明文断言「新增特征不需要改 Core 代码」 |
| **分析执行器注册表** | `server/researchEngine/analyses/registry.ts#AnalysisExecutorRegistry` | `register(executor)`。**但**类型闭集在别处（见 G-2） |
| **数据集插件注册表** | `server/datasetRegistry/plugins.ts#DatasetPluginRegistry` | `register(plugin)`；插件声明 = `datasetCode + physicalTables(role/label/DDL) + createIO + createBuilder`。**当前只注册 1 个**（`first_limit_pullback`） |
| **闭环阶段接线清单** | `server/research/closedLoopWiring/requirements.ts` | 14 阶段中 **wired 8 / notWired 6**；未接线必如实 `CL_RUNNER_NOT_INJECTED` |

### 2.2 `patternLibrary` 为什么是本方案的地基

它的对外契约（`server/research/patternLibrary/index.ts` 文件头）逐字如此：

```text
一句话用法：新增一种交易模式 = 在 patterns/ 下加一个声明文件 + 在 patterns/index.ts 加一行
⇒ 研究侧模块注册表与执行侧配方注册表同时多出这一种模式，无需改任何路由 / 页面 / 注册表代码。
```

四个投影面已经打通：

| 产物 | 投影函数 | 消费方 |
|---|---|---|
| 研究模块规格 | `projectResearchModule` | `createDefaultResearchModuleRegistry()` |
| 执行配方定义 | `projectRecipeDefinition` | `recipeRegistry` 全局注册表 |
| 候选草图（含 `recipe` 引用与参数空间） | `projectCandidateSketch` | 转正入口 `buildStrategyDefinition` |
| 可搜索参数空间 | `projectParameterSpace` | 闭环 `optimization` 阶段 |

它解决的**正是本次诉求的问题形态**——把「一种交易模式」原本散在四处（研究模块规格 / 执行配方 / 参数 schema / 候选草图）靠人工对齐的现状，收敛成**单一真源**。

⇒ **本方案的定位因此是：把 `patternLibrary` 这条已存在的「声明 → 投影」主干，向「分析」「数据集」「报告」三个方向延伸，并补上四件收尾。**

### 2.3 三个「语义权威」与两条双轨（引用基线，避免第二套 SoT）

| 语义 | 唯一权威 | 本方案的纪律 |
|---|---|---|
| 策略 | `server/strategyCore/**` | 新模式的定义**必须**能被 `coreVersionFromDocument` 转成 `StrategyVersion`；否则退回 legacy 必须带 reason code |
| 执行 / 成本 / 持仓 | `server/backtest/**` | **禁新建 `backtestCore`** |
| 指标 | `server/backtest/backtestResult.ts#canonicalMetrics()` | **唯一**；Evaluation 已有 canonical 时**禁**重算重叠指标 |

**两条双轨（本方案必须尊重，不得压平）**：

1. **学习/推理双轨**：`strategyCore`（语义权威）⇄ legacy `StrategyDefinition`（存储编码），靠 `adapters/legacyDefinition.ts` **双向**翻译（指纹逐字节相等，有测试）。**Core 是超集，legacy 有不可表达面**（`ALL_DAYS`、无条件策略、右值为特征引用等）。
2. **声明/执行双轨**：`patternLibrary` 的 `research` 侧与 `execution` 侧是**两套独立口径**，声明里必须**分别**写出；某一侧不存在时**必须标 `null`**（纯研究模式 / 纯执行模式），**禁伪造**。

---

## 3. 缺口清单（实查，逐条给坐标）

> 全部为**只读实查**结论。判据写法遵循 AGENT-GUIDE §7 陷阱 15/16：定位用「路径 + 符号名」，不依赖行号。

### G-1 🔴 报告没有落地产物（**直接阻断 R4**）

| 项 | 事实 |
|---|---|
| 表与契约 | `research_artifact`（`drizzle/schema.ts` 声明，`ResearchArtifact` + `ResearchArtifactRepository` 在 `server/researchCore/repository/contract.ts`，DB / InMemory 两实现齐备） |
| 类型白名单 | `RESEARCH_ARTIFACT_TYPES` **已含 `"REPORT"`**（`server/researchCore/types.ts`）；存储形态含 `FILE / S3 / URL / INLINE` |
| **生产写入** | 🔴 **零**。全仓 `server/**` 搜 `artifacts.create` **0 命中**；唯一的引用是 `researchEngine/maintenance.ts` 的**级联删除** |
| 生成器 | 🔴 **不存在**。全仓搜 `generateReport` / `buildReport` / `renderReport` / `reportHtml` / `toMarkdown` / `renderMarkdown` 只命中 `ROADMAP.md` |
| 端点 | 🔴 无 report 端点（`server/researchEngineRouter.ts` 只有 `listConclusions` / `getAnalysisResults` / `getRun` / `getConclusionPolicy`） |
| 今天报告是什么 | **纯前端渲染**：`client/src/pages/research/ResearchDetail.tsx` + `ConclusionPanel.tsx` + `AnalysisResultsView.tsx`，数据源是 `research_conclusion`（`evidenceJson` 固定键集）+ `research_result` |

⇒ **「得出自己的分析报告」诉求今天够不到**：没有文件、没有端点、没有落库记录，只有「页面上能看」。工作区刷新一次、换个 Run，就再也取不回来。

### G-2 🔴 分析类型是封闭集（**阻断 R3**）

| 项 | 事实 |
|---|---|
| 声明 12 种 | `server/researchCore/types.ts#RESEARCH_ANALYSIS_TYPES`：`DESCRIPTIVE / DISTRIBUTION / QUANTILE / CORRELATION / IC / EVENT_STUDY / CONDITIONAL / PATH / REGIME / SIGNIFICANCE / STABILITY / SEGMENT_RELATION` |
| 实际实现 6 种 | `createDefaultAnalysisExecutorRegistry()` 只 `register` 了 `descriptive / eventStudy / quantile / conditional / stability / segmentRelation` |
| 未实现 6 种 | `analysisConfig.ts` 的 `default:` 分支**硬编码** `UNKNOWN_ANALYSIS_TYPE`（注释自认「其余类型未在 MVP 实现」） |

⇒ **执行器注册表是开放的，但类型白名单与配置分发是封闭的**：新增一种分析类型，必须同时改 `researchCore/types.ts`（闭集）+ `analysisConfig.ts`（`switch`）**两处 Core 代码**，然后才轮到注册执行器。**AI 生成一个「分析文件」丢进来就能跑」目前不成立。**

⚠️ 附带发现：未实现的 6 种里 **`PATH` 恰是「按 T+k 逐日看路径」的分析类型**，而 `PLAN-research-to-strategy-condition.md` 已论证观察日条件（`bar.*` 在同一观察日的逐日求值）正是策略条件的正确表达 ⇒ **`PATH` 与 G-2 应一起做**（见 §9 P1）。

### G-3 🔴 数据集插件手工注册（**阻断 R3 / R6**）

`server/datasetRegistry/plugins.ts`：

```ts
export function createDefaultPluginRegistry(): DatasetPluginRegistry {
  const registry = new DatasetPluginRegistry();
  registry.register(firstLimitPullbackPlugin);   // ← 就这一行，手工
  return registry;
}
```

- **无目录扫描、无 `import.meta.glob`、无 codegen**（全仓动态 import 只有 2 处，都与数据集无关，是日历的延迟加载）。
- 角色枚举 `DATASET_ROLES = ["event","prefix","post","path","outcome","feature"]` **有 6 个**，内置插件只声明 **5 个** ⇒ **`feature` 角色表已预留、零实现**。
- 未注册 code 的失败是**响亮的**：`BUILDER_NOT_REGISTERED`（`registry.ts#requirePlugin` / `runner.ts` 运行期防御），**不静默回落**。这一点是本方案要**保持**的好性质。

### G-4 🔴 派生 bar 字段桥需要 6 处同步（**隐性阻断 R5**）

`DERIVED_BAR_FIELD_TO_FEATURE_ID`（`server/strategyCore/featureRegistry.ts`）是**唯一权威**，当前 4 个键：`volumeRatio / haircutFromEventLow / isBullish / momentumFromEventClose`。

改它必须同步：

| # | 位置 | 不改的后果 |
|---|---|---|
| 1 | `server/strategyCore/featureRegistry.ts`（映射表**且** `makePullbackFeatures()` 里的实现） | 只改映射 ⇒ `FEATURE_NOT_REGISTERED`；只改实现 ⇒ `bar.<新字段>` 判 UNKNOWN |
| 2 | `server/research/strategySchema/definition.ts#STRATEGY_DERIVED_BAR_FIELDS` | legacy 侧白名单不接受 |
| 3 | `server/strategyCore/definition.ts#validateCoreDefinition`（硬编码的**跳过表**） | 新派生字段被当成「未声明的原始列」⇒ `DATA_REQUIREMENTS_UNSATISFIED` |
| 4 | `server/research/recipeRegistryAtoms.ts#PULLBACK_FEATURE_IDS` | legacy 执行侧漂移 |
| 5 | `server/research/conditionSignal/compile.ts`（`bar.* → PULLBACK_FEATURE_IDS` 第二份映射） | 第二套口径 |
| 6 | `client/src/components/research/candidateSketchVocabulary.ts`（被测试逐字锁死） | 前端词表漂移 |

⇒ **4 与 5 是「第二套映射」的既成事实**（AGENT-GUIDE §3 禁止 #14 的对象）。本方案**不新建**第二套，但要给出**收敛路径**（§9 P4）。

### G-5 ⚠️ 事件类型是闭集 + 生产判定口径只有一种

- `CORE_EVENT_TYPES` 是闭集（`server/strategyCore/types.ts`）；超出即 `RULE_GRAPH_INVALID` ⇒ 新事件只能走 **`CUSTOM_EVENT` + `params`**。
- 生产侧 `production/eventSource.ts#createDatasetEventResolver` 的判定口径**是按 `limitUpRatio` 判涨停**（锚定 bar = rd 0，`close >= preClose*(1+ratio)`），缺 OHLC ⇒ `"UNDECIDABLE"`（计数、返回 false）。
- 声明形状：`DatasetEventSourceDeclaration { eventAnchored, eventTypes[], limitUpRatio, declaredBy }`；`eventAnchored: false` **直接拒绝构造**（不静默不判定）。
- 🔴 **N-07**（ARCH-002 登记）：`eventAnchored: true` 目前是**装配层给的约定**（「绑定了 `datasetVersionId` 即视为事件窗」），**未从 `dataset_definition` 机器读取**。

⇒ 新交易模式若需要新的**事件语义**（不是涨停），必须提供新的 resolver —— **这是代码，不是数据**（进 §4 的具名槽）。

### G-6 🔴 两条决策路径并存（**阻断「只写一份声明」**）

`server/runWorkbenchAssembly/assemble.ts#assembleStrategySide` 的选择逻辑：

| 顺序 | 条件 | 结果 |
|---|---|---|
| 1 | `coreVersionFromDocument({document, createdAt})` 成功 | `strategyDecisionEngine = "strategy-core"` |
| 2 | 失败（如文档缺 `definition` 段） | 回落 `strategyDecisionEngine = "legacy-recipe"` + **`strategyDecisionEngineNote`（reason code，如 `NO_LEGACY_DEFINITION`）** |

回落本身**是诚实的**（带 reason code 出网），但它意味着：一份新模式文档**仍可能以两种截然不同的语义被求值**。ARCH-002 §7 已实测出差异（legacy 出 `[2,3]`，Core 出 `[2]`；首个有效日一致；根因是 legacy 执行侧没实现自己文档声明的 trigger）。

⇒ 新模式的验收必须包含**「决策引擎 = strategy-core」的断言**，否则「我加了一个新模式」与「我加的新模式被 legacy 静默接管」在页面上看不出来。

### G-7 ⚠️ 可复现性缺口（ARCH-002 已登记，本方案不修但必须尊重）

| # | 内容 |
|---|---|
| **N-05** | `StrategyRunSnapshot.runtimeConfig` 是**运行级**，而评估是**逐决策日**的 ⇒ 逐决策坐标只记在 `strategyDecision.samples[]`（有界 24 条）；运行级配置**不能单独复现全量** |
| **N-06** | `datasetHorizonRelativeDay` 逐决策日**不可知** ⇒ 兼容性报告不做视界校验 |
| **N-07** | 事件源声明未从 `dataset_definition` 机器读取（见 G-5） |
| **N-08** | 「首板性」（rd-1 非涨停）**不在事件窗内可验证** ⇒ 委托给数据集定义 |
| **N-03** | 阈值型出场（`TAKE_PROFIT / STOP_LOSS / TIME_EXIT`）仍以 `exitRules` **声明**保留，**未进 `exitRuleGraph`**（`unmappedExitRuleIds` 已如实落库） |
| **N-04** | `ALL_DAYS` 在 legacy 侧不可表达 ⇒ 适配器一律译 `ANY_DAY` 并写 note |

### G-8 ⚠️ 三套特征系统并存

| # | 系统 | 消费者 |
|---|---|---|
| 1 | `server/features/**`（`FeatureFactory` + `FeatureSnapshot`） | `server/strategy/**`（`runStrategyEngineBacktest`） |
| 2 | `server/research/recipeFeatures/**` + `recipeRegistryAtoms.ts#PULLBACK_FEATURE_IDS` | `research/signalEngine`、`conditionSignal`（legacy 执行侧） |
| 3 | `server/strategyCore/featureRegistry.ts`（Core） | Core 自洽 |

三者**互不 import**；唯一接缝是 `SignalBuilder` 槽位（`production/coreDecision.ts` 实现 `framework/signal.ts` 的 `SignalBuilder`，在 `assemble.ts` 被塞进 `Strategy13.signalBuilder`）。

⇒ 新模式若要**双路都能跑**，需要登记两遍。本方案的主张：**新模式只登记 Core 一遍**，legacy 视为过渡期（§9 P3）。

### G-9 ⚠️ 参数「声明在 schema 里」≠「可搜」

判据**唯一** = `strategyCore/ruleGraph.ts#collectRuleParameterReferences`（入口规则图 + 出场规则图）。实测 `cand-360001@1.0.0` 声明 3 个 `TUNABLE` 而规则图 `PARAMETER_REFERENCE = 0` ⇒ 3 组极端取值产出**逐字节相同**的权益曲线。

`createSearch`（实际符号：`createParameterSearchRun`）会因死参数**响亮拒绝**：`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`；给死参数赋会变化的搜索域另拒：`PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER`。

🔴 **顺序纪律：派生 → 覆盖 → 死参数剥离 → 校验。** 显式搜索域覆盖**能**把死参数重新塞回搜索空间（实测踩到）。

⇒ 本方案的**生成物校验器必须内建这条判据**（否则 AI 会生成一堆「看起来有参数、其实搜不动」的模式）。

### G-10 ⚠️ 版本与迁移纪律（不是缺口，是必须遵守的边界）

- 🔴 `updateVersionDefinition()` **恒抛 `VERSION_IMMUTABLE`**；改内容只能走 `applyDefinitionChange()` → **新版本**。
- 🔴 **Definition 内不得出现 Dataset / 引擎坐标**（`DATASET_BINDING_IN_DEFINITION_FORBIDDEN`）；`datasetVersionId` 只允许在 `StrategyRunSnapshot.datasetReference`。
- 🔴 **零迁移优先**：`prefix` / `post` / `path` / `outcome` 物理表的权威结构在 `plugins.ts`（**声明式 DDL**），**不在** drizzle 链；`0030` 注释自认「migration 不应复制一套 DDL 而产生第二权威来源」。新表只能走 `scripts/apply*.mjs` + 插件声明式 DDL。drizzle 发布链路自 `0024` 停摆（journal 止 `0023`）⇒ `db:push` **不可用**。
- 🔴 **`resultJson` 新增段必须可选**（zod `optional`），否则历史留档读取会炸（C-13）。
- 🔴 探针读 `closed_loop_backtest_run.resultJson` 拿到的是**字符串**，必须 `JSON.parse` 兜住。

---

## 4. 方案总览：一个契约 + 三层 + 九个槽

### 4.1 结构图

```text
                    ┌──────────────────────────────────────────┐
     自然语言描述 ──▶│  接入文档（Extension Contract）           │
     （交易模式）     │  ① 人读规范 EXTENSION-CONTRACT.md         │
                    │  ② 机器读 schema extension-manifest.json │
                    │  ③ 骨架模板 templates/**                  │
                    └───────────────────┬──────────────────────┘
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │ Layer A · 声明层（纯数据，AI 可直接生成） │
                    │  TradingPatternSpec + extension 段        │
                    │  禁：运行时依赖、函数、副作用             │
                    └───────────────────┬──────────────────────┘
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │ Layer B · 执行层（人审的具名槽，9 个）    │
                    │  S1 特征  S2 条件/规则  S3 事件  S4 出场  │
                    │  S5 分析执行器  S6 变量  S7 报告渲染      │
                    │  S8 数据集插件  S9 次级数据派生           │
                    └───────────────────┬──────────────────────┘
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │ Layer C · 数据层（声明驱动构建）          │
                    │  dataset_definition / dataset_version     │
                    │  ds_* 6 角色表（feature 角色待启用）      │
                    │  血缘：prefix/post（事实）→ path（衍生）  │
                    │        → outcome（聚合）→ feature（特征） │
                    └──────────────────────────────────────────┘
```

### 4.2 九个具名扩展槽（**这是 AI 生成物的落点清单**）

| 槽 | 语义 | 现状 | 归属层 | 本期是否必须 |
|---|---|---|---|---|
| **S1** | **特征** `FeatureDefinition` | ✅ 已开放（数据驱动） | B | 按需 |
| **S2** | **条件 / 规则图** `RuleGraph` 节点 | ✅ 已开放（纯数据） | A | 按需 |
| **S3** | **事件判定** `EventOccurrenceResolver` | ⚠️ 生产只有「按涨停比例」一种 | B | 新事件必须 |
| **S4** | **出场** `DeclaredExitRule` / `exitRuleGraph` | ⚠️ 阈值型仍只声明（N-03） | A/B | 按需 |
| **S5** | **分析执行器** `AnalysisExecutor` | ⚠️ 注册表开放、类型闭集（G-2） | B | 新分析必须 |
| **S6** | **研究变量** `ResearchVariableDefinition` | ✅ 三角色已分离（FEATURE / OUTCOME / OBSERVATION） | B | 按需 |
| **S7** | **报告渲染** | 🔴 **不存在**（G-1） | B | **P0 必做** |
| **S8** | **数据集插件** `DatasetPlugin` | ✅ 插件化、手工注册（G-3） | B/C | 新数据集必须 |
| **S9** | **次级数据派生** | ✅ 有范例（`path.ts` 三层血缘 + `backfill*.mjs`） | C | 按需 |

**槽的纪律（三条）**：

1. **槽位清单封闭**：新增槽 = 改 Core 代码 = 必须走一次正式的架构任务（`GLOBAL AUDIT REQUIRED` 第 7 条「核心 Contract 变化」）。
2. **缺槽即响亮拒绝**：未注入的槽**不得**静默降级成默认行为。范例（要保持的既有做法）：`coreDecision` 的 `CORE_DEFINITION_INVALID`（未注入事件判定器 ⇒ **抛错**，注释明写「拒绝静默返回 false —— 那会把『没接事件源』伪装成『当日无事件』」）、闭环的 `CL_RUNNER_NOT_INJECTED`。
3. **一个槽一份实现**：**禁**在同一语义上出现第二套（`backtestCore` / `strategy_rules` 表 / 第二份 `canonicalMetrics` / 第二份派生字段映射）。

---

## 5. 三条产品化路径（逐条承接 R1~R6）

### 5.1 路径 R —— 研究分析扩展（承接 R1 / R4）

**目标**：让「新分析 + 新变量 + 自己的报告」可以**声明驱动**地落地。

| 步骤 | 输入（声明） | 系统动作 | 产物 | 落库 |
|---|---|---|---|---|
| R-1 | `ResearchVariableDefinition`（三角色之一 + `availableFromOffset`） | 装配层按需求最小化取数（`sampleSet.ts`） | 变量可被条件引用 | 无（派生） |
| R-2 | `AnalysisExecutor`（`requiredVariables` + `execute`） | `AnalysisExecutorRegistry.register`；**类型必须先进 `RESEARCH_ANALYSIS_TYPES`**（G-2 修复后由注册表自证） | `ResearchResult[]` + `AnalysisSummary` | `research_result` |
| R-3 | `ConclusionPolicy`（**可选**，默认 `DEFAULT_CONCLUSION_POLICY`） | `buildConclusion` **自动**产出结论草稿（**无需新代码**） | `ResearchConclusionDraft` | `research_conclusion` |
| R-4 | **报告模板（新增槽 S7）** | 渲染器把 `conclusion + evidenceJson + results` 渲染成**稳定产物** | 🔴 **`research_artifact`(`REPORT`)** | `research_artifact` |

**🔴 R-4 是本方案第一优先**，因为它同时解决两个问题：① R4 诉求；② 让「AI 生成的报告」有一个**可比对、可回归**的载体（否则每次只能靠人眼看页面）。

**R-4 的设计约束（防敷衍）**：

1. **产物必须自包含**：报告内嵌 `datasetVersionId` / 策略 `definitionFingerprint` / 参数集 / `engineVersion` / `codeVersion`（沿用 ARCH-002 的留档坐标），**不靠回查页面状态**；
2. **同一份数据源**：报告渲染的输入必须是 `research_conclusion` + `research_result`（**不是**新造一份统计），前端页面与文件产物**同一份 SoT**；
3. **措辞禁令**：报告**不得**出现「最佳参数 / 最优策略 / 推荐参数」（DOMAIN-MAP §14）；必须带免责声明（与前端既有「免责声明不得删」同一纪律）；
4. **格式建议 `INLINE` 优先**（先 Markdown 字符串进 `research_artifact`），`FILE` 需要决定落盘位置与清理策略 ⇒ 留到 P2 再议。

### 5.2 路径 E —— 策略执行扩展（承接 R1 / R5）

**目标**：新模式 = **一份声明**（`TradingPatternSpec`）+ 可选的执行槽，且**必须**能转成 Core 版本。

| 步骤 | 输入 | 系统动作 | 验收 |
|---|---|---|---|
| E-1 | `patterns/<patternId>.ts`（纯数据） | 四投影（§2.2 表） | `patternLibrary.test.ts` 全绿（id 唯一 / 门槛引用特征在产出面内 / 门槛引用参数已声明 / `sketch.event`+`timing` 在策略侧词表内 / 参数名唯一且 `declaration.name` 一致） |
| E-2 | `execution` 段（`signalKind / recipeId / features / gates / rankFeature / parameters[]`，`parameters[].role` **必填**） | `buildPatternRecipeDefinitions` → `recipeRegistry` 注册（注册期校验 `RECIPE_FEATURE_NOT_PRODUCED`） | 配方可解析 |
| E-3 | 需要**新特征** ⇒ 槽 **S1** | `FeatureDefinition` 注册（注册期守卫：`usesForwardData=true` / `dataThroughRelativeDay>0` **无法注册**，`LEAKAGE_LOOK_AHEAD`） | `registry.resolve({featureId, version})` 成功；版本不一致 ⇒ `FEATURE_VERSION_MISMATCH` |
| E-4 | 需要**新派生 bar 字段** ⇒ 🟡 **必须走正式任务**（G-4 的 6 处） | 6 处同步 | 新增的桥接键可用；**且**不得引入第二套映射 |
| E-5 | 需要**新事件语义** ⇒ 槽 **S3** | 新 `EventOccurrenceResolver` + 声明 `DatasetEventSourceDeclaration` | 未注入即抛错（**不得静默 false**）；`eventAnchored:false` 拒绝构造 |
| E-6 | 需要**可搜参数** | 规则图里写成 `{ kind: "PARAMETER_REFERENCE", code }` | `collectRuleParameterReferences ≠ 0`（G-9 唯一判据） |
| E-7 | 策略文档（`StrategyDocument`） | `coreVersionFromDocument` → `StrategyVersion` | 🔴 **断言 `strategyDecisionEngine === "strategy-core"`**（G-6） |
| E-8 | 运行 | `assembleRunWorkbenchInputs` → 闭环 → `closed_loop_backtest_run.resultJson.strategyRun` | 落库坐标齐（`strategyRunSnapshot` / `strategyDecision` / `executionMetadata`），零 schema 变更 |

**🔴 参数引用纪律（PARAMETER-002 教训，必须写进接入文档）**：

> 参数要在**规则图里真被引用**才算「可搜」。左值必须**同量纲**：比值型参数配 `bar.volumeRatio`；写成 `bar.volume` 会**恒为假**（首版探针就这么错过）。

**E-4 的说明（为什么标 🟡 而不是 ✅）**：新派生字段今天要改 6 个文件，其中 2 处是**既成的第二套映射**。本方案**不新增**第二套，但要求：任何新模式若只需要「已有 4 个派生字段 + 现有特征」的组合，就**不要**动桥接表 —— 优先用 `Expr.feature(...)` + `featureRequirements` 表达。

### 5.3 路径 D —— 数据扩展（承接 R6）

**目标**：需要的数据集 / 次级数据可从原始数据提取整理，且**声明驱动**。

**已存在的三层血缘（这是本仓库最结构化的「原始 → 次级」实现，必须复用）**：

```text
真实原始数据（stock_daily_prices / liquidity_daily / index_daily / research_* ）
        │
        ▼  DatasetPlugin.createBuilder  （按 datasetCode 解析插件）
┌───────────────────────────────────────────────────────┐
│ L-事实   ds_<code>_event   事件身份（rd=0）            │
│          ds_<code>_prefix  前置行情（rd ≤ 0，纯 OHLCV）│
│          ds_<code>_post    后置行情（rd ≥ 1，纯 OHLCV）│
├───────────────────────────────────────────────────────┤
│ L-衍生   ds_<code>_path    相对事件价衍生量（可 100% 重算）│
│ L-聚合   ds_<code>_outcome 未来视界结果（可由 path 重算）│
│ L-特征   ds_<code>_feature 🔴 角色已预留、零实现        │
└───────────────────────────────────────────────────────┘
        │
        ▼  runWorkbenchAssembly 优先直读；不可撮合则回落重建
   研究运行（ResearchDatasetRow[]）
```

| 步骤 | 输入 | 系统动作 | 约束 |
|---|---|---|---|
| D-1 | `DatasetPlugin`（`datasetCode / displayName / description / physicalTables[] / createIO / createBuilder`） | `createDefaultPluginRegistry().register(...)` | 表名**强制** `ds_{datasetCode}_{role}`（`buildDatasetTableName`），并由 `assertSafeTableName` 白名单校验（防 DROP/DELETE 注入） |
| D-2 | `physicalTables[].createSql(tableName)` | `createDefinition` 时**先建表后落库**；或 `scripts/apply*.mjs` | **零迁移**：权威在插件，**不进 drizzle 链**（`0030` 注释已定调） |
| D-3 | 构建配置（版本级固化） | `resolveBuildConfigForVersion` → `runner.execute` | 筛选非法 ⇒ `INVALID_BUILD_FILTER`；重建 = **从零**（`purgeVersionRows`）；`totalRows` 口径 = 五表行数之和 |
| D-4 | 次级数据 | 纯函数（参照 `path.ts` 的三层注释纪律） | 必须写明「可由上层 100% 重算」，否则就是第二真源 |
| D-5 | 从原始数据补数（**当 DS 缺源时**） | `scripts/backfill*.{mjs,ts,mts}`（范例：`backfillLimitUpRecords.mjs` 从 `stock_daily_prices` + `research_security_status_history` 派生 `limit_up_records`） | 幂等 upsert + 断点；🔴 `index_daily` 是**交易日历唯一来源**，停更会**静默 no-op 却报成功** ⇒ 补数须 `--force` |

**版本隔离的唯一坐标**：`datasetVersionId`（**不是** label）。所有 `ds_*` 行都带 `datasetVersionId` 列，唯一键都是 `(datasetVersionId, eventId[, relativeDay|horizon])` ⇒ **版本隔离靠它而非建新表**。

---

## 6. 「接入文档」规范（AI 生成任务的输入面，承接 R2）

用户说的「系统的接入文档」目前**并不存在**（实查确认：`docs/**` 无 `EXTEND*` / `DEVELOPER*` / `PLUGIN*` / `SDK*` 命名的引导文件；最接近的是 `docs/research/PATTERN-LIBRARY-001-implementation.md` §7 的**四步操作手册**，以及 `docs/architecture/AGENT-GUIDE.md` 的**Agent 纪律**）。

⇒ **本方案的一项交付就是把它建起来**，形态为**三件套**：

### 6.1 三件套

| # | 文件 | 读者 | 内容 |
|---|---|---|---|
| ① | `docs/extension/EXTENSION-CONTRACT.md` | 人 + AI | 规则与禁令：九个槽的**能/不能**、三层纪律、PIT 三重门、错误码语义、禁止行为（引用 AGENT-GUIDE §3 的 14 条） |
| ② | `docs/extension/extension-manifest.schema.json` | **机器** | 声明字段的 JSON Schema（类型、必填、枚举、`additionalProperties: false`），AI 生成的声明**必须先过它** |
| ③ | `docs/extension/templates/**` | AI（复制） | 骨架：`pattern.spec.ts.tpl` / `feature.ts.tpl` / `analysisExecutor.ts.tpl` / `datasetPlugin.ts.tpl` / `reportTemplate.md.tpl` / `manifest.json.tpl` |

### 6.2 AI 工具的任务契约（输入 → 输出）

**输入**（三样，缺一不可）：

1. 自然语言的**交易模式描述**（用户的话）；
2. **接入文档三件套**（上面的 ①②③）；
3. **只读探测结果**：允许读取现有 `patterns/*.ts`、`featureRegistry` 的 `list()`、`DATASET_ROLES`、`PULLBACK_FEATURE_IDS`、`RESEARCH_ANALYSIS_TYPES` —— 但**禁止**推测未声明的标识符。

**输出**（一个 PR 级变更集，**目录布局固定**）：

```text
server/research/patternLibrary/patterns/<patternId>.ts      ← 必须（纯数据声明）
server/research/extensions/<patternId>/
    manifest.json            ← 必须（机器可校验的清单）
    features.ts              ← 可选（槽 S1）
    eventResolver.ts         ← 可选（槽 S3）
    analysisExecutor.ts      ← 可选（槽 S5）
    datasetPlugin.ts         ← 可选（槽 S8）
    reportTemplate.md        ← 可选（槽 S7）
    index.ts                 ← 必须（export const EXTENSION: StrategyExtension）
server/research/extensions/index.ts                          ← 必须（+1 行注册）
tests/server/research/extensions/<patternId>.test.ts         ← 必须
```

**🔴 硬性禁止（写进接入文档，AI 与人都适用）**：

| # | 禁止 | 依据 |
|---|---|---|
| 1 | 生成「看起来像声明、实际含函数与副作用」的文件 | `patternLibrary` 纪律 1（声明层只允许 `import type`） |
| 2 | 为了让测试过而改核心文件（`types.ts` 闭集、`analysisConfig.ts` 的 `switch`、`canonicalMetrics`） | AGENT-GUIDE §3 #8 |
| 3 | 新建第二套 SoT（`backtestCore` / `strategy_rules` 表 / 第二份派生字段映射 / 第二份 canonical） | AGENT-GUIDE §3 #14 |
| 4 | 手写 `_journal.json` / 跑 `db:push` / `drizzle-kit generate` | AGENT-GUIDE §3 #10 |
| 5 | 把未装配阶段改成静默 success | `CL_RUNNER_NOT_INJECTED` 纪律 |
| 6 | 产出「最佳参数 / 最优策略 / 推荐参数」措辞或删免责声明 | DOMAIN-MAP §14 |
| 7 | 在用户使用页面时改 `server/**`（热重启会**杀死在途 Run**） | AGENT-GUIDE §7 陷阱 1 |

### 6.3 「自证」机制（防 AI 生成物空转）

生成物必须能**自己证明自己接上了**，否则「接线完成 ≠ 用户够得到」这条本项目反复踩到的坑会重现。因此要求一个**单一校验入口**：

```text
node scripts/verifyExtension.mts --pattern <patternId>     # 或者并入既有 vitest
```

校验项（**全部机器可判**）：

1. `manifest.json` 过 ② 的 JSON Schema，且 `additionalProperties: false`；
2. `patternId` 在 `ALL_TRADING_PATTERNS` 中**唯一**；
3. 声明引用的每个 `featureId` **都能 `registry.resolve`**（否则 `FEATURE_NOT_REGISTERED`）；
4. 声明引用的每个参数 code **都已声明**，且 `role` 存在（`fixed` 不进搜索空间）；
5. 门檻引用的变量 **在策略侧词表内**（禁发明新词）；
6. **参数真引用**：`collectRuleParameterReferences(ruleGraph) + (exitRuleGraph)` **≠ 0**（G-9）；
7. **派生字段桥接一致**：所有 `bar.<field>` 都能经 `fieldReferenceFeatureId` 解出，且**没有**第二套映射表被新增；
8. **PIT**：`StrategyRuntime.auditLeakage(version)` 全绿（A1~A7）；新增变量的 `usesForwardData === false` 且 `dataThroughRelativeDay ≤ 0`；
9. **决策引擎断言**：`strategyDecisionEngine === "strategy-core"`（G-6）；
10. **零迁移**：变更集里不得出现 `drizzle/_journal.json` / `db:push` / 新 drizzle migration；
11. `tsc --noEmit` **0 error**；`vitest` 失败**文件集合** = 基线（8 文件 / 17 用例，先剥 ANSI 颜色码）。

---

## 7. 生成物（Extension Bundle）规范

### 7.1 `manifest.json` 骨架（机器可校验）

```jsonc
{
  "manifestVersion": 1,
  "patternId": "my_new_pattern",          // ^[a-z][a-z0-9-]{2,63}$
  "label": "人类可读名",
  "purpose": "一句话：这种模式在赌什么",
  "whenToUse": "什么行情下值得看",
  "extends": {                             // 九槽，只列真正用到的
    "S1_features":  [{ "featureId": "...", "version": "1.0.0" }],
    "S3_events":    [{ "eventType": "CUSTOM_EVENT", "params": { "..." : "..." } }],
    "S5_analyses":  ["PATH"],
    "S7_report":    { "template": "reportTemplate.md" },
    "S8_dataset":   { "datasetCode": "...", "roles": ["event","prefix","post","path","outcome"] },
    "S9_derived":   [{ "role": "path", "recomputable": true, "note": "可由 prefix+post 100% 重算" }]
  },
  "declaredAbsences": ["S8_dataset"],      // 如实声明「这一侧没有」，禁伪造
  "searchableParameters": ["max_volume_ratio"],   // 必须与规则图真引用一致
  "codeVersion": "<git short sha>",        // 禁 "unknown" 占位
  "createdAt": "<ISO8601>"
}
```

🔴 `declaredAbsences` 是**呼应 `patternLibrary` 纪律 2**（缺哪一侧就如实标 `null`）：AI 最容易犯的错就是「补一个看起来差不多的默认值」，这个字段让**缺席变成一等公民**。

### 7.2 生成物与既有产物的关系

| 生成物 | 投影/注册到 | 是否新增第二套 |
|---|---|---|
| `patterns/<patternId>.ts` | `ALL_TRADING_PATTERNS` | ❌ 否（既有唯一真源） |
| `extensions/<patternId>/features.ts` | `createFeatureRegistry()` / `getDefaultFeatureRegistry()` | ❌ 否（Core 唯一特征面） |
| `extensions/<patternId>/analysisExecutor.ts` | `createDefaultAnalysisExecutorRegistry()` | ❌ 否 |
| `extensions/<patternId>/datasetPlugin.ts` | `createDefaultPluginRegistry()` | ❌ 否 |
| `extensions/<patternId>/index.ts` | `extensions/index.ts` 一行 | ❌ 否 |
| 报告产物 | `research_artifact`（`REPORT` / `INLINE`） | ❌ 否（表已存在） |

---

## 8. 关键设计决策（每条对应一个真实失败模式）

| # | 决策 | 对应的真实失败模式（实查证据） |
|---|---|---|
| **D-1** | **能声明的不写代码**：声明层只允许 `import type`、零运行时依赖 | `patternLibrary` 文档已论证：四处靠人工对齐、无人对账 ⇒ P0-1/P0-2/P0-3 三条实查缺口 |
| **D-2** | **具名槽 + 缺槽响亮拒绝**；禁止静默回落默认 | `CORE_DEFINITION_INVALID`（未注入事件判定器 ⇒ 抛错）；`CL_RUNNER_NOT_INJECTED`；`requireTradingPattern` 的注释明写「静默回落默认正是本项目反复踩到的缺陷形态」 |
| **D-3** | **单一真源**：禁 `backtestCore` / `strategy_rules` 表 / 第二份 `canonicalMetrics` / 第二份派生字段映射 | AGENT-GUIDE §3 #14；`0030` 注释「migration 不应复制一套 DDL 而产生第二权威来源」 |
| **D-4** | **PIT 三重门**：`availableFromOffset`（观察日变量）+ 三角色 `Sources` **类型级互斥** + `LeakageGuard` | `variables.ts` 的三 Source 类型互不包含（编译期防线）+ 运行期 `VARIABLE_ROLE_VIOLATION`；`FeatureLeakageDeclaration` 的注册期守卫（`usesForwardData=true` **无法注册**） |
| **D-5** | **版本不可变**：改内容 = 新版本 | `updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE`（有测试断言）；只能 `applyDefinitionChange()` |
| **D-6** | **事件语义由运行方注入**，且**新事件必须有声明来源** | `runtime.ts` 注释「拒绝静默返回 false —— 那会把『没接事件源』伪装成『当日无事件』」；并补 **N-07**（从 `dataset_definition` 机器读取 `eventAnchored`） |
| **D-7** | **可搜参数 = 规则图真引用** | PARAMETER-002 实测：声明 3 个 TUNABLE 而 `PARAMETER_REFERENCE = 0` ⇒ 权益曲线逐字节相同 |
| **D-8** | **零迁移优先**：新数据集走 `apply*.mjs` + 插件声明式 DDL | drizzle 链路自 `0024` 停摆；`db:push` 不可用（DATABASE-MAP D-1） |
| **D-9** | **报告必须是产物**，且与前端同源 | G-1：`research_artifact(REPORT)` 生产零写入 ⇒ 报告取不回来 |
| **D-10** | **落地纪律**：改文件用 Python bytes + `os.replace` + 回读；同一文件多处编辑**串行**；行尾以 **HEAD blob** 为准（改前改后跑 `scripts/checkEolDrift.mjs`） | 本机实测：并行两个 `Edit` ⇒ 后写覆盖先写、前者静默丢失；`git hash-object` 与 HEAD blob 不一致时 `git diff-files` 为空 ⇒ 漂移看不见 |

---

## 9. 分期落地（每期独立可交付，附验收判据）

> 原则：**一次只交付一段**，每段独立可验证；**全部避开用户使用页面的时段**（改 `server/**` 会热重启并杀死在途 Run）。

### P0 —— 报告产物落地（G-1，承接 R4）**｜最小可用闭环，风险最低**

**做什么**：新增槽 S7（报告渲染），把 `research_conclusion` + `research_result` 渲染成 `research_artifact(REPORT, INLINE)`；新增一个**只读**端点供前端取；前端页面与文件产物**同源**。

**为什么先做**：① 纯新增，**不动主链**、零 schema 变更（表已存在）；② 让后续所有扩展都有**可比对、可回归**的载体；③ 顺带把 **N-07**（从 `dataset_definition` 读取 `eventAnchored`）一起机器化。

**验收**：真实库跑一次研究 → `research_artifact` 出现 1 行 `REPORT` → 内容含 `datasetVersionId` / 结论 / 免责声明 → 刷新后仍可取回；`tsc` 0 error；`vitest` 失败文件集合 = 基线。

### P1 —— 分析类型注册表化（G-2，承接 R3）**｜含 `PATH`**

**做什么**：把 12 种声明类型**全部**走 `AnalysisExecutorRegistry`；删除 `analysisConfig.ts` 的硬编码 `switch`（改为「查注册表，未注册即 `UNKNOWN_ANALYSIS_TYPE`」）；**实现 `PATH`**（它正是「按 T+k 逐日看路径」，与 `PLAN-research-to-strategy-condition.md` 的观察日条件同源）。

**验收**：`RESEARCH_ANALYSIS_TYPES` 与「已注册执行器」**可断言等价**（新增一个对表测试，防再次分叉）；`PATH` 跑通一次「观察日 vs 全样本」；仍是 12 − 未实现数 的诚实计数（**不得**为了让计数好看而把未实现的类型从枚举里删掉）。

### P2 —— 数据集插件发现机制（G-3，承接 R3/R6）

**做什么**：`createDefaultPluginRegistry()` 从「手工一行」升级为「从 `extensions/index.ts` 的注册清单装配」；新增 `verifyExtension` 校验器（§6.3 的 11 条）；启用 **`feature` 角色**（第 6 张表）。

**为什么不是目录扫描**：全仓**无** `import.meta.glob` / 动态 import 先例，且 `patternLibrary` 采用的也是**显式清单**（`patterns/index.ts` 一行）。保持同构、可 diff、可 code review，比「魔法自动发现」更符合本项目「可复现性 > 架构完整性」的优先级。

**验收**：新数据集 = 插件文件 + `extensions/index.ts` 一行；`BUILDER_NOT_REGISTERED` 仍对未注册 code 响亮失败。

### P3 —— 决策路径收敛（G-6）

**做什么**：把 legacy 回落收敛为**显式登记的例外清单**（带 reason code，`strategyDecisionEngineNote` 已有机制），并规定：**新模式的 `strategyDecisionEngine` 必须为 `strategy-core`**，否则运行**拒绝开始**（而不是回落后照跑）。

**⚠️ 边界（不许顺手做）**：**不删** legacy 路径（它有存量文档在用）、**不改** `closed_loop_backtest_run` 历史行、**不抹平** Core 与 legacy 的语义差异（ARCH-002 §7 已如实登记「历史回测数字不可直接对比」）。

### P4 —— 派生字段桥单一化（G-4 / G-8）

**做什么**：把 6 处映射收敛成 **1 处 SoT + 生成/校验**；`server/research/conditionSignal/compile.ts` 的第二份映射与 `client/**` 词表改为**从 SoT 派生或对表测试**。

**⚠️ 风险最高**：它改了既有生产口径。**必须**：① 先有对表测试（证明收敛前后**逐字节等价**）；② 走 `GLOBAL AUDIT REQUIRED` #7（核心 Contract 变化）；③ 单独一个任务号。

---

## 10. 验收判据（汇总，可机器执行）

```text
[类型]     npx tsc --noEmit                                  ⇒ 0 error
[回归]     npx vitest run                                    ⇒ 失败【文件集合】= 基线 8 文件 / 17 用例
                                                               （判据 = 集合，先剥 ANSI 颜色码；新增失败 = 0）
[构建]     npx vite build                                    ⇒ 成功
[扩展]     node scripts/verifyExtension.mts --pattern <id>    ⇒ §6.3 的 11 条全绿
[端到端]   真实库：数据集构建 → 研究分析 → 结论 → 候选 → 转正(带 recipe)
           → 运行 → resultJson.strategyRun 齐 → research_artifact(REPORT) 可读回
[可达性]   按【正常导航】量 DOM（不是"接线完成"）：新模式的入口有 URL 深链、
           长请求按钮 pending 换文案、静默 return 换响亮 toast
[数据安全] 只读核验：strategies / strategy_versions / closed_loop_backtest_run
           / dataset_version 行数守恒；resultJson 新增段全部可选
```

**汇报格式**：按 `docs/architecture/AGENT-GUIDE.md` §4 的 12 项（Task / Baseline Version / Relevant Domains / Pre-existing Facts / Changes / Contract Impact / DB Impact / Execution Impact / Tests / Baseline Update / Remaining Risks / Next Step）。

---

## 11. 风险、边界与遗留（诚实登记）

### 11.1 风险

| # | 风险 | 说明与缓解 |
|---|---|---|
| **RK-1** | **AI 生成的代码无法自动判对错** | 本方案的直接对策：**把「可生成面」限制在纯数据声明 + 具名槽**；执行代码一律人审 + 对表测试。**不接受**「让 AI 直接改 Core 闭集」 |
| **RK-2** | 新模式双路（Core + legacy）跑出不同结果 | P3 收敛 + 强制断言 `strategy-core`；**不**抹平差异（N-04 仍在） |
| **RK-3** | 观察日变量带来**事后筛选**风险 | `availableFromOffset` 校验是**唯一防线**，必须在 P1 与 `PATH` **一起**落地 |
| **RK-4** | P4 改既有生产口径 | 见 P4 的三条前置；风险最高，单独任务号 |
| **RK-5** | 报告被当成「策略结论」传播 | DOMAIN-MAP §14 措辞禁令 + 免责声明不得删；报告头部必须打印 `RESEARCH_READY` 与采样时间 |
| **RK-6** | 并发会话推进 ROADMAP 编号台账 | 取号前先对远端（`ls-remote`）；**禁「末条 +1」** |

### 11.2 本方案明确**不做**的事

- ❌ 不生成任何代码、不改任何既有文件、不跑写库脚本、不动迁移；
- ❌ 不新建表（P0 零 schema 变更）；
- ❌ 不新建第二套 SoT；不删 legacy 路径；
- ❌ 不动 N-03 / N-04 / N-05 / N-06 / N-08（各自已有登记，与本方案正交）；
- ❌ 不产出任何策略结论或「最佳参数」类措辞。

### 11.3 🔴 编号台账漂移（**需要用户/维护者裁决**）

| 项 | 事实 |
|---|---|
| ROADMAP 文件头 + §44.5 台账行 | 均写「编号已用至 `9br` ⇒ 下一个未占用 = `9bs`」 |
| 实际已使用 | `9bs` = PARAMETER-001（`docs/parameter-search/PARAMETER-001-REPORT.md`、`SYSTEM-BASELINE.md` v1.1.0 增量、`CHANGE-AUDIT.md`）；`9bt` = PARAMETER-002（同上 v1.1.1） |
| ⇒ 结论 | **台账滞后于变更记录**；按「下一个未占用」规则，**下一个应为 `9bu`** |
| 建议 | 把 ROADMAP 两处台账行（文件头铁律行 + §44.5 台账行）同步为「已用至 `9bt`，下一个 `9bu`」，并登记进 `CHANGE-AUDIT.md`（**改文档不改代码**，符合 §20 的 Drift 处置） |

本文件**未擅自改 ROADMAP**（用户明确要求本轮不改动相关文件），故本文的编号标为**待分配**。

### 11.4 与既有文档的关系

| 文档 | 关系 |
|---|---|
| `docs/research/PATTERN-LIBRARY-001-implementation.md` §7 | 本方案 §5.2 E-1 的**上游**（四步操作手册）；本方案把它从「模式」扩到「模式 + 分析 + 数据 + 报告」 |
| `docs/research/PLAN-research-to-strategy-condition.md` | 本方案 §9 P1 的**上游**：它论证了「观察日变量」是阻断项，并明确「`availableFromOffset` 必须在 P1 落地，不能留到 P2」 |
| `docs/research/RESEARCH-PATTERN-LOOP-AUDIT-001.md` §5/§6 | 「新增一种交易模式的真实成本」与「Pattern SoT + 双投影」的原始依据 |
| `docs/architecture/SYSTEM-BASELINE.md`（v1.1.1）+ `AGENT-GUIDE.md` | 权威入口与纪律来源；本方案的每个「禁」都指向其中的具体条目 |
| `docs/research/STRATEGY-ARCH-002-IMPLEMENTATION-REPORT.md` §9 | N-01 ~ N-08 的登记处；本方案 P0 顺带解 **N-07** |

---

## 12. 追溯

| 项 | 值 |
|---|---|
| 触发 | `todo:rHncjk`「分析与新的策略模块兼容方案分析」（priority `urgent`，assignees Rexze / Steffen） |
| 本轮工作区 | `D:\stock-limit-up-analyzer`，HEAD `bb89eb8`，`git status --porcelain` **空**；远端 `origin/main` 同 SHA（`git ls-remote` 已对） |
| 基线版本 | `SYSTEM-BASELINE.md` **v1.1.1**（2026-09-19）；`system-manifest.yaml` 仍写 `v1.0.0`（既有不一致，非本轮引入） |
| 本轮新增 | **仅本文件**（`docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001.md`） |
| 本轮未做 | 未改代码 / 配置 / 迁移 / DB；未跑写库脚本；未新增探针 |
| 下一步（待用户裁决） | ① 批准哪几期；② 本文编号（建议 `9bu`）；③ 是否登记进 ROADMAP §44.5 + `ROADMAP-CHANGELOG.md`；④ 是否上传协作项目资产 |
