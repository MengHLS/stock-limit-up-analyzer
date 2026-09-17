# 提问研究与研究实验模块 · 全面审计 + 解决方案

> 审计对象：`stock-limit-up-analyzer` 的「提问研究（`/research/ask`）/ 研究实验 / 候选转正 / 闭环回测 / 策略评价」全链。
> 审计方式：**只读**读真实代码 + 只读 DB 探针，零文件修改、零迁移、零端点。
> 审计日期：2026-09-17。审计基线：`server/**` = 571 文件（与 §44.5 `9at`/`9au` 记录一致，说明本轮零改动）。
> 目标（用户原话）：「我说一种交易模式 → 小幅度增量新建实验 → 分析出结果 → 我审核发现 → 生成策略 → 回测；后续策略评价、绩效、参数都共通可复用；实验研究模块要真实可用、简便快捷。」

---

## 0. 结论速览

**好消息：主干已经真实打通。** 「提问 → 自动建实验/计划/假设 → 物化分析 → 跑引擎 → Finding → 结论 → 候选」这七段**全部有真实实现且有真实落库证据**（`experiment 480003 / plan 90003 / run 750003 / candidate 570003`，28 条分析 528 行结果，`~3.1s/条`）。这部分**不要重造**。

**坏消息：这条主干通到一个死胡同。** 三个结构性断裂，任何一个都足以让「研究发现 → 变成可回测的策略」这件事**在语义上不成立**：

| # | 断裂 | 一句话后果 | 严重度 |
|---|---|---|---|
| **P0-1** | **研究条件进不了回测信号** | 转正出的策略，文档里的 `entry.conditions` 是**装饰性的**，回测实际执行的信号来自 `recipeId`；候选从不声明 recipe ⇒ 回落到**默认配方** `leader-candidate-baseline`（涨幅加权 topN5）。**你回测的不是你研究出来的那个模式。** | 🔴🔴🔴 |
| **P0-2** | **参数/评价跑在另一套回测上** | `参数搜索 / 滚动优化 / Walk-Forward / OOS / 过拟合 / 鲁棒性` 全部只调 legacy `getLeaderCandidateBacktest`（`realisticBacktest`，只认 8 个旧字段），**从不读策略文档**；`strategyId` 仅当一个标签。⇒「评价/绩效/参数共通复用」**当前不成立**。 | 🔴🔴🔴 |
| **P0-3** | **闭环 14 阶段只有 6 个执行器** | `optimization / robustness / oos / overfitting / paper / review / discipline` 恒 `BLOCKED`。⇒ 上一条即便想统一到闭环口径，闭环本身也跑不到那些阶段。 | 🔴🔴 |

**可复用的资产比想象中多。** 真正已经共通的评价实现有 4 个：`performanceMetrics` / `riskAdjustedMetrics` / `tradeQualityMetrics`（闭环 evaluation 阶段 + `research.metrics.evaluate` 双入口）+ `marketRegime`（闭环 regime 阶段 + 独立 router）。另有 **12 个评价模块写好了但只挂在「技术预览」router 上**（`paramSearch` / `walkForward` / `marketRegime` / `review`），**2 个完全孤立无调用方**（`factorAblation` / `signalToPnl`）。**这是巨大的存量资产，问题是接线，不是能力。**

**根因一句话**：项目里存在**两套「交易模式」的表达**，彼此不相识 —— 研究侧 `ResearchModuleSpec`（模块/配方/变量/视界），执行侧 `StrategyRecipe`（`recipeId → buildSignalBuilder`）。中间唯一的通道 `filterRule → entry.conditions` 是**只写不读**的。

**解决方案一句话**：新增**「交易模式单一声明（Pattern SoT）」**，一个声明文件同时投影出「研究侧模块」与「执行侧配方」，让两侧**同源构造、由构造保证一致**；配套把参数寻优从 legacy 回测切到闭环口径、把闭环 4 个 notWired 阶段接上现成执行器。分 4 个 STEP 落地，新增一种交易模式的成本降到 **1 个声明文件**。

---

## 1. 现状打分：从「说一种模式」到「看绩效」共 11 环

| # | 环节 | 状态 | 真实实现（证据） |
|---|---|---|---|
| 1 | 说一句交易模式（自然语言） | ✅ **可用** | `researchEngine/planner/intent.ts#detectResearchIntent:105`，两档加权（专指 3 / 泛化 1）+ 三级排序；7 个内置模块 `moduleRegistry.ts:809` |
| 2 | 自动建实验 + 计划 + 假设 | ✅ **可用** | `questionPlanning.ts#planResearchQuestion:153`（Experiment/Run/**Hypothesis（§15 必需）**/Question/Plan 五写） |
| 3 | 计划 → 具体分析（物化） | ✅ **可用** | `questionPlanning.ts#materializePlan:637` + `researchEngine/batchCreate.ts`；规模上限 20~50、默认 30，超限按优先级裁剪并**如实列出被裁项** |
| 4 | 跑引擎出结果 | ✅ **可用** | `researchEngine/engine.ts#run:176`（10 步）；6 类执行器 `analyses/registry.ts:58` |
| 5 | 结果 → Finding（发现） | ✅ **可用** | `researchEngine/finding/findingEngine.ts:70`（只消费 `research_result`，绝不重扫 Dataset） |
| 6 | Finding → 结论（锚定用户提问） | ✅ **可用** | `researchEngine/conclusion.ts:269`（R1~R5 短路）+ `planner/aggregate.ts#composeQuestionAnchor:348` |
| 7 | 结论 → 候选（带溯源） | ⚠️ **半可用** | `researchPlannerRouter.ts#createCandidate:458` 只写 `filterRule`（由某条 CONDITIONAL 条件行导出）；`entryRule` 仅当调用方传；前端只传 `{questionId,name,description}`（`ResearchAsk.tsx:245`） |
| 8 | 候选 → 策略（promote） | ⚠️ **半可用** | `strategyCandidate/service.ts#promote:746`（12 步，幂等闸门齐全）；但**必填 10 项草图**必须人工在 40+ 输入框里填（`CandidateSketchFields.tsx`），与研究结果**无自动衔接** |
| 9 | 策略 → 回测（真读文档+真数据集） | ⚠️ **半可用** | `researchRunRouter.ts#loopRun:471-508` 真读策略文档 + 真实装配数据集；但**信号来自 `recipeId`，文档条件不参与**（见 §3.1） |
| 10 | 绩效评价 | ⚠️ **半可用** | 闭环 evaluation 三件套真实执行（`requirements.ts:109-111`）；但只出标量，标量口径与 §10 的参数侧**不同源** |
| 11 | 参数寻优 / 稳健性 / WFO | ❌ **不成立** | 只认 legacy 回测与 8 个旧字段（`paramSearchRouter.ts:129-140, 247`） |

**「我审核发现 → 生成策略」这一步的实际体验**：研究结论页点「创建 Candidate」→ 得到一条 `DRAFT` 候选（只有筛选条件）→ 进 `/research/candidates/:id` → **手工填 10 项必填 + 若干可选**（timing / observationWindow / trigger / quantityMethod / lotSize / sizingMethod / maxPositions / initialCapital / 六项费率）→ 转 `ACCEPTED` → promote → 策略。**这 10 项与研究结果没有自动衔接**，正是「实验研究模块不够简便」的直接来源。

---

## 2. 已有能力清单（**不要重造**）

| 能力 | 唯一实现 | 说明 |
|---|---|---|
| 意图识别 | `planner/intent.ts` | 纯规则确定性，无 LLM，可复现 |
| 研究方法注册表 | `planner/moduleRegistry.ts`（7 个内置，**支持扩展注册**） | `ResearchModuleRegistry.register()`；与 `AnalysisExecutorRegistry` 同构纪律 |
| 分析计划生成 | `planner/analysisPlan.ts#generateAnalysisPlan:280` | 能力闸门 + 视界交集 + 优先级裁剪 |
| 分析执行器 | `researchEngine/analyses/`（6 类） | DESCRIPTIVE / EVENT_STUDY / QUANTILE / CONDITIONAL / STABILITY / SEGMENT_RELATION |
| 变量目录（角色隔离） | `researchEngine/variables.ts` | FEATURE（PIT 安全）/ OBSERVATION（T+k）/ OUTCOME（标签）；角色反用抛 `VARIABLE_ROLE_VIOLATION` |
| 列投影自动派生 | `researchEngine/columnProjection.ts#deriveColumnProjection:288` | 新变量**不必手写列依赖**（访问代理自动跟踪） |
| 条件配方（研究侧） | `planner/moduleRegistry.ts#ResearchConditionRecipe:117` | 守卫 / 精修 / 对照 三类 |
| 候选来源排序 | `planner/aggregate.ts#rankCandidateSourceAnalyses:301` | **唯一实现**（硬门槛 `conditionCount>0` + 五级排序）；前端/E2E/Workbuddy 共用 |
| 草图 → 策略定义转换 | `strategyCandidate/definitionBuild.ts#buildStrategyDefinition:559` | 唯一转换器；8 键扩展槽闭集 |
| 策略定义校验（防前视） | `strategySchema/definitionValidation.ts#validateCanonicalStrategyDefinition:289` | L1~L5 字段时间域 + L6~L8 时序自洽 + 结构校验 |
| 执行配方注册表 | `research/recipeRegistry.ts`（2 个） | `weighted`（线性加权择优）/ `gated`（门槛过滤）；注册期强校验特征真被产出 |
| 闭环回测装配 | `runWorkbenchAssembly/assemble.ts:419` | 直读数据集优先、回落重建、**回落原因如实写进 `datasetSourceNote`** |
| 逐日撮合 | `research/simulator/engine.ts#runTradeSimulation:248` | `equityCurve / trades / executionStats.byReason / skippedCounts / costs` |
| 绩效三件套 | `performanceMetrics` / `riskAdjustedMetrics` / `tradeQualityMetrics` | **已被闭环与独立端点共同使用**（唯一真正的「共通」证据） |
| 回测留档 | `closed_loop_backtest_run`（23 列）+ `closedLoopBacktestRun/repository.ts` | `runId` UNIQUE 幂等；列表禁读 `resultJson`（结构性保证） |

---

## 3. P0 结构性缺陷（逐条带证据链）

### 3.1 🔴🔴🔴 P0-1：研究条件进不了回测信号（架构性）

**证据链（全部可复核）**

1. 回测信号的唯一来源是配方：
   - `runWorkbenchAssembly/assemble.ts:445` `requireRecipe(document, request.recipeId)`
   - `assemble.ts:467` `signalBuilder: recipeRuntime.buildSignalBuilder(parameterSet)`
2. `entry.conditions` **在全仓信号链上零消费者**：
   ```bash
   grep -rn "entry\.conditions" server/research/signalEngine/ server/research/recipeRegistry.ts
   # → 0 命中
   ```
3. 文档没有 recipe 时**静默回落默认配方**：
   - `assemble.ts:385-403 requireRecipe`：`document.recipe` 缺失 → 调用方显式 → 否则 `resolveStrategyRecipeById(DEFAULT_STRATEGY_RECIPE_ID)`
   - `recipeRegistry.ts:509` `DEFAULT_STRATEGY_RECIPE_ID = "leader-candidate-baseline"` = **`weighted`，`pctChange` + `topN:5`**
4. 研究产出的候选从不声明 recipe：
   - `researchPlannerRouter.ts:510-539` 只写 `filterRule`（+ 调用方显式传的 entryRule/exitRule/riskRule）
   - `ResearchAsk.tsx:245` 只传 `{questionId, name, description}`
5. 即便有人手动填 `extra.recipe`，**构造门槛也不匹配**：
   - `definitionBuild.ts:926-992 buildStrategyRecipe` 要求完整 `StrategyRecipe` 形状（`featureVersions[]` / `rankingConfig` / `selectionConfig` / `requiredData[]` / `point` / `signalFrequency`），研究侧**从不产出**这些字段 ⇒ 必然 `undefined`。

**后果（用用户的语言）**：你研究出「首板后回踩 ≤3% 且缩量不破首板开盘价」，转正成策略，点「运行回测」——回测跑的是**「涨幅加权取前 5 名」**。结果会出来、曲线也好看、指标也算得出来，**但它不是你的模式**。这属于「产物看起来完全正常」的静默错误，比崩溃更危险。

**判据**：同一份数据集下，`loopRun` 的 `signals` 必须与「独立复算策略文档 `entry.conditions`」逐日一致。现状是**恒不一致**。

### 3.2 🔴🔴🔴 P0-2：参数/寻优/评价跑在另一套回测上

**证据**

| 端点 | 评估标量来源 | 是否读策略文档 |
|---|---|---|
| `paramSearch.run` / `rolling` / `robustness` / `stochastic` | `getLeaderCandidateBacktest`（`paramSearchRouter.ts:247 / 335 / 636`） | ❌ |
| `walkForward.run` / `oos` / `overfit` | `getLeaderCandidateBacktest`（`walkForwardRouter.ts:237`） | ❌ |
| `marketRegime.run` | `getLeaderCandidateBacktest`（`marketRegimeRouter.ts:155`） | ❌ |
| `PerformanceDashboard` | `sentiment.getLeaderCandidateBacktest`（`PerformanceDashboard.tsx:282-293`） | ❌ |

- `strategyId` / `strategyVersion` **只是记录标签**：`parameterSearch/types.ts:308-310` 原文「本次搜索针对的研究策略身份（**上下文，仅记录不做身份注册**）」；router 里唯一去向是 `input.strategyId ?? DEFAULT_STRATEGY_ID`（`paramSearchRouter.ts:536/588/621/667`）。
- 参数 → 回测字段映射**只认 8 个 legacy 维度**：`MAPPABLE_PARAMETER_DICTIONARY`（`paramSearchRouter.ts:129-140`）；未收录维度**被静默忽略**。
- 回测区间固定「最近约 2 年」`previewRange()`（`paramSearchRouter.ts:99-105`），组合上限 64。

**后果**：promote 出来的策略文档里 `entry.conditions` / `trigger` / `exit.rules` / `recipe` **完全不参与搜索评估**。⇒「策略评价、绩效、参数共通复用」**当前是两套互不相通的体系**。

### 3.3 🔴🔴 P0-3：闭环 14 阶段只有 6 个有执行器

- 阶段常量：`research/closedLoop/types.ts:34-49`（14 个）。
- 装配声明权威表：`closedLoopWiring/requirements.ts:65-177`。
- 已 wired 6 个：`data / research / strategy / backtest / evaluation / regime`（`closedLoopWiring/executors.ts:288-495`）。
- **notWired 7 个**：`optimization / robustness / oos / overfitting / paper / review / discipline`。

**关键观察**：notWired 里有 **4 个的实现代码已经写好且能跑**，只是没接线：

| 阶段 | 现成实现 | 现状挂在哪 |
|---|---|---|
| optimization | `parameterSearch/run.ts:132` + `rollingOptimization/run.ts:148` | `paramSearchRouter.ts:534/587` |
| robustness | `robustness/evaluate.ts:141` + `stochasticRobustness/run.ts:258` | `paramSearchRouter.ts:620/666` |
| oos | `walkForwardRun/run.ts:287` + `oosIsolation/run.ts:125` | `walkForwardRouter.ts:561/605` |
| overfitting | `overfittingDetection/run.ts:69` | `walkForwardRouter.ts:698` |

⇒ 这 4 个是**纯接线工作**，不是从零开发。剩下 3 个（paper/review/discipline）需要人工标注数据注入，**暂不该做**。

---

## 4. P1 缺陷与地雷（会咬人、但不阻断主干）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P1-1 | **`OR` / `NOT` 在转正时被静默压成 AND** | `definitionBuild.ts:364-421#buildConditions` 把所有分组**扁平化** push 进一个数组；`ConditionDefinition`（`strategySchema/definition.ts:408-419`）**没有逻辑运算符字段** ⇒ `entry.conditions` 实际全是 AND。草稿写「或」不报错、不留痕，策略却变成另一个意思 | 用户用自然语言说「**或**」时，生成的策略语义被改；与「说一种模式」的保真度直接冲突 |
| P1-2 | **研究 Run 侧仍无孤儿回收**（§44.5 `9h` 未做） | 本机只读探针实测：`research_run` = COMPLETED 15 / FAILED 1 / **PENDING 1**；`research_analysis` = COMPLETED 322 / **PENDING 2**；残骸 `630001@630002`（09-16 15:59）与 `270008@330003`（09-11 14:41） | ① 死 Run 锁死实验（`run()` 只收 `PENDING/FAILED/CANCELLED`）；② **直接堵住「改 `server/**` 的热重启窗口」** —— 按纪律必须零在途才能落第一笔编辑 |
| P1-3 | **冷算 20 分钟仍会白屏阻塞**（§44.5 `9aq`） | 空载实测 `getLeaderCandidateBacktest` = **1201.67s** | 「简便快捷」的直接反面；`/leader-candidates` 与整条 legacy 评价链都吃这个代价 |
| P1-4 | **2 个评价模块完全孤立** | `factorAblation/run.ts:39#runAblationAssessment`、`signalToPnl/engine.ts:280#runSignalToPnlLoop`：全库无生产调用方 | 已写好的能力浪费；消融分析本来是「发现证据」的强工具 |
| P1-5 | **`riskRule.regimeGate` 无 schema 出口** | `definitionBuild.ts:701-707` | 市场环境闸门无法落入 `StrategyDefinition.risk`（该结构无「条件组」字段） ⇒ 模式里带「大盘环境」条件时无法表达 |
| P1-6 | **两套 WFO 实现并存** | `research/walkForwardService.ts:201`（生产、异步、日历天）vs `research/walkForwardRun/`（研究链、纯函数、交易日锚定）；前者只经 barrel 导出、无 router 调用 | 排查时极易误判「WFO 已接线」 |
| P1-7 | **`reviewRouter` 头部注释与事实不符** | 注释称「本 router 尚未合并进 appRouter」，实际 `routers.ts:307` 已挂载 | 误判能力边界 |
| P1-8 | **前端 `/paper-trading` 与 `paperAccount` 是两套东西** | `PaperTrading.tsx:44-81` 走 legacy `sentiment.*`；`review.paper.run` 是另一套 | 名称相同、语义不同 |

---

## 5. 「新增一种交易模式」的真实成本（现状）

### 5.1 只做研究（能提问、能出结论）：**1~3 个文件**

| # | 文件 | 改动 | 是否硬编码瓶颈 |
|---|---|---|---|
| 1 | `planner/moduleRegistry.ts` | 新增一个 `ResearchModuleSpec` 工厂 + `register()`（照 `pullbackModule():551` 的 24 个字段） | 配方**注册顺序参与同分排序**（`analysisPlan.ts:847`） |
| 2 | `researchEngine/variables.ts` | **仅当需要新变量**：FEATURE `:213` / 观察日 `OBS_DAY_FIELDS:444` 或 `PULLBACK_STATS:457` / 结果族 `:769/:781/:850`；观察日必须如实声明 `availableFromOffset:159` | ✅ 变量名是全系统字面量契约；若来自新物理列还要动 `datasetRegistry/query.ts` + `schema.ts`（迁移） |
| 3 | `planner/analysisPlan.ts#describeConditionField:140` | **仅当新字段需要人读回执**：每个变量族一条正则 + 中文口径，未登记即降级为「（未登记人读口径的字段）」 | ✅ 硬表 |

**结论：研究侧确实是数据驱动可扩展的**（`intent.ts` / Router / 前端都不用改）。**但**：分析骨架（`generateAnalysisPlan:280-648`）按 `analysisType` 写死 push 顺序 —— 新模式只能用「基线 + 守卫/精修/对照 + 分位 + 分段 + 稳定性」这套固定拼装，**不能自定义组合模板**。

### 5.2 让这个模式**真的能回测**：还要 3~4 个文件（且全靠人工对齐）

| # | 文件 | 改动 |
|---|---|---|
| 4 | `research/recipeRegistry.ts` | 手写一个 `gated` 配方（`buildGates` + `rankFeatureId` + `resolveParameters`），照 `first-limit-pullback-hold-shrink:306` |
| 5 | `research/recipeFeatures/*` | 若策略侧特征口径与研究侧变量不同 → 手工写一遍并**逐字对齐**（两处**不共享代码**，只靠文件头注释里的对齐表） |
| 6 | `strategyCandidate/definitionBuild.ts` | 若草图要携带新键 → 改 `CANDIDATE_SKETCH_EXTENSION_KEYS:73-93` 闭集（**改代码**，非数据驱动） |
| 7 | 候选草稿 | 人工填 `entryRule.extra.recipe`（完整 `StrategyRecipe` 形状）+ 10 项必填 |

**⇒ 现状「加一种模式」的实际成本 = 4~7 个文件 + 两处人工口径对齐 + 一次人工填表。这与「小幅度增加」的目标有明显差距，且**没有任何机制保证第 1 步与第 4 步描述的是同一个模式**。

---

## 6. 解决方案：交易模式单一声明（Pattern SoT）+ 双投影

### 6.1 核心思路

把「一种交易模式」提升为**一个声明对象**，放在 `server/research/patternLibrary/`（一个模式一个文件），它同时投影出两侧：

```
                    ┌───────────────────────────────┐
                    │  TradingPatternSpec（唯一 SoT）│
                    │  key / label / keywords        │
                    │  研究投影 + 执行投影            │
                    └───────────┬───────────────────┘
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
   ┌────────────────────────┐          ┌────────────────────────┐
   │ 研究侧（已有，自动生成）│          │ 执行侧（新增，自动生成）│
   │ ResearchModuleSpec     │          │ StrategyRecipe + gates │
   │  → 意图识别 / 分析计划  │          │  → signalBuilder       │
   └───────────┬────────────┘          └───────────┬────────────┘
               ▼                                   ▼
        ResearchAnalysis ──► Finding ──► Conclusion ──► Candidate
                                                        │
                                     ★ 候选自动带 recipeId + 草图默认值
                                                        ▼
                                                  promote → Strategy
                                                        ▼
                                              loopRun（真读文档 + 真数据集）
                                                        ▼
                              绩效三件套（已共通）/ 参数寻优（本方案改为同源）
```

**一致性由「同源构造」保证**：研究与回测读的是**同一份声明**，不再靠人工对齐两个文件。

### 6.2 声明骨架（示意，非最终代码）

```ts
// server/research/patternLibrary/types.ts
export interface TradingPatternSpec {
  readonly key: string;                       // 稳定键，进 moduleKey / recipeId
  readonly label: string;
  readonly purpose: string;
  readonly whenToUse: readonly string[];
  readonly keywords: { primary: readonly string[]; generic: readonly string[] };

  /** ① 研究投影：自动构造 ResearchModuleSpec */
  readonly research: {
    researchType: ResearchType;
    requiredCapabilities: readonly ResearchModuleCapability[];
    primaryAnalysisType: ResearchAnalysisType;
    recommendedAnalysisTypes: readonly ResearchAnalysisType[];
    targetKinds: readonly ResearchTargetKind[];
    preferredHorizons: readonly number[];
    entryEvaluations: readonly number[];
    guardConditions: readonly ConditionSpec[];      // ★ 声明式，不再是工厂函数
    refinementConditions?: readonly ConditionSpec[];
    controlOf?: readonly string[];
    quantileFeatures: readonly string[];
    groupingDimensions: readonly string[];
    stabilityDimension: string;
    conclusionTypes: readonly ResearchConclusionType[];
  };

  /** ② 执行投影：自动构造 StrategyRecipe（gates 由 gateSpecs 生成） */
  readonly execution: {
    readonly signalKind: "gated" | "weighted";
    readonly gateSpecs: readonly GateSpec[];        // featureId + 比较符 + 阈值（常量或参数名）
    readonly rankFeatureId?: string;
    readonly defaultWeights?: Readonly<Record<string, number>>;
    readonly parameters: readonly ParameterSpec[];  // 可寻优参数（min/max/default）
    readonly point: "open" | "close";
    readonly signalFrequency: "daily" | "weekly" | "intraday";
    readonly requiredData: readonly string[];       // 如 ["OHLCV"]
    readonly selector: { kind: "topN"; n: number } | { kind: "topPercentile"; pct: number };
  };

  /** ③ 候选草图默认值：让「创建候选」一次性填满 10 项必填 */
  readonly sketchDefaults: {
    timing: "NEXT_OPEN" | "NEXT_CLOSE" | "SAME_CLOSE";
    trigger: string;
    observationWindow: { start: number; end: number; unit: "TRADING_DAY" | "CALENDAR_DAY" };
    execution: { quantityMethod: string; lotSize: number };
    position: { sizingMethod: string; maxPositions: number };
    feePreset: readonly string[];
  };
}
```

**关键纪律（必须写进实现，否则又变成两套）**：
- 声明里的 `guardConditions[].fieldName` 必须**逐字等于** `variables.ts` 的变量名（研究侧）**且**能翻译成 `Strategy` 字段引用（执行侧）—— 两侧不一致的项**必须在注册期响亮报错**（照 `recipeRegistry.ts:327-411` 的注册期强校验风格），**禁运行期静默降级**。
- 新增模式**不再编辑** `moduleRegistry.ts` / `recipeRegistry.ts` 的注册区；两侧注册表改为**从 pattern library 装配**。
- 现有 7 个模块 + 2 个配方**原样迁为首批 pattern**（`PULLBACK_EFFECTIVENESS` 对应 `first-limit-pullback-hold-shrink`，`EVENT_RETURN_RESEARCH` 对应 `leader-candidate-baseline`），**迁移期两侧并存 + 一致性测试锁定**，避免一次性替换的风险。

---

## 7. 落地计划：4 个 STEP

> ⚠️ **全部会改 `server/**`** ⇒ 必须满足「无在途 Run」并单独排期（`tsx watch` 热重启会杀死在途 Run，且**当前已有 2 个 PENDING 残骸**）。建议 **STEP 0 先行**清障。

### STEP 0（前置 · 零风险 · 先做）· 清障 + 可观测

| 项 | 内容 | 判据 |
|---|---|---|
| 0-1 | 收敛 `research_run` 的 PENDING 残骸（`630002` / `330003`）：写 `errorCode=RUN_ORPHANED` + `errorMessage`（写明被进程重启中断）+ `completedAt`，Experiment 一并 FAILED | 探针 `inFlightRunCount === 0` |
| 0-2 | 补研究 Run 侧孤儿回收钩子（**与 dataset 侧同构**，§44.5 `9h`） | boot 回收幂等、不误杀非 RUNNING、回收后可重跑 |
| 0-3 | 研究链端到端「体检」端点（只读）：一次回答「这个实验的计划/分析/结果/发现/结论/候选各多少、哪一环空」 | 零副作用；对 `480003` 返回与实查一致的数 |

**为什么先做 0**：不解决 0-1，**任何 `server/**` 改动都会踩在 2 个死 Run 上**；不解决 0-2，这个问题每次开发都会复发一次。

### STEP A（P0 · 打通「条件 → 回测信号」）

| 项 | 内容 | 落点 |
|---|---|---|
| A-1 | 新增**声明式条件编译**纯函数：`ConditionDefinition[] → FeatureGate[]`。复用既有 `recipeFeatures/*`（`computeVolumeRatio` / `computeIsBullish` / `computeHaircutFromEventLow` / `computeCloseReturnFromEventClose`）与 `STRATEGY_DERIVED_BAR_FIELDS`，**禁第二套口径** | 新目录 `server/research/conditionSignal/`（唯一实现） |
| A-2 | `assemble.ts#requireRecipe` 之前先试「从声明式条件合成配方」：成功 → `recipeSource = "strategy-declarative-conditions"`（如实写进 `assembly`）；**存在无法映射的条件 ⇒ 响亮列出每一处并抛错**，不静默回落 | `runWorkbenchAssembly/assemble.ts:445` 附近 |
| A-3 | `createCandidate` 一次性填全草图：`filterRule`（现状）+ `entryRule` 的 10 项必填 + `exitRule`/`riskRule`/`parameterSpace`（来自 §6.2 的 `sketchDefaults`） | `researchPlannerRouter.ts:458` |
| A-4 | promote 侧**不补默认值**（守住既有裁定），但把「草图缺口」在创建时就消灭 ⇒ 用户只需审核 | 不改 `definitionBuild.ts` |

**判据**：① 同一数据集下 `loopRun` 的 signals 与「独立复算文档条件」逐日一致（用既有 `visibleBars` 复算，**不用第二套实现**）；② `recipeSource` 如实回显；③ 造一个含不可映射条件的策略 ⇒ **必须抛错**（失败路径也要证「零新增」）。

### STEP B（P0 · 让评价 / 绩效 / 参数真正共通复用）

| 项 | 内容 | 落点 |
|---|---|---|
| B-1 | 新增**策略回测评估端口**（唯一实现）：入参 `{strategyId, strategyVersion, dateRange, parameterSet}` → 走 `assembleRunWorkbenchInputs` + `runTradeSimulation` → 出标准绩效标量（复用 `performanceMetrics` / `riskAdjustedMetrics` / `tradeQualityMetrics`，**不新写指标**） | 新 `server/research/strategyEvaluation/` |
| B-2 | `paramSearchRouter` / `walkForwardRouter` / `marketRegimeRouter` 的评估标量改调 B-1（legacy `getLeaderCandidateBacktest` 保留但不再默认）；参数空间改为**从策略文档 `document.parameters` 派生** | 三个 router |
| B-3 | 把闭环 4 个 notWired 阶段接上现成执行器：`optimization` / `robustness` / `oos` / `overfitting`（`closedLoopWiring/executors.ts` 6 → 10） | `executors.ts:288-495` |
| B-4 | `parameterSearch` 产出的「候选策略」增加**回写通道**（经现有 `strategyCandidate` 桥，**不建第二写口**） | `parameterSearch/index.ts` 自述「止于候选、不推广生产」需改写 |

**判据**：同一策略、同一参数集，**闭环 evaluation 标量 == 参数搜索评估标量**（同指纹可互校）；闭环 `executedStageCount` 由 6 升到 10。

### STEP C（P1 · 模式声明库：新增模式 = 1 文件）

| 项 | 内容 |
|---|---|
| C-1 | 落地 §6.2 的 `TradingPatternSpec` + `patternLibrary/` 装配器 |
| C-2 | 现有 7 模块 + 2 配方迁为**首批 pattern**，两侧注册表从 pattern 装配；迁移期**并存 + 一致性测试锁定**（同一 pattern 在两个注册表里 key/条件/gates 逐字一致） |
| C-3 | `createCandidate` 的草图默认值改从 pattern 取（与 STEP A-3 合并） |
| C-4 | 注册期强校验：研究侧变量名 ↔ 执行侧字段引用**必须可互译**，不一致即**拒绝注册** |

**判据**：新增一种模式 = 只新增 1 个声明文件 + 0 处修改既有注册区；`intent` 能识别、计划能生成、候选能带 recipeId、回测信号与该模式一致。

### STEP D（P1/P2 · 正确性与体验收口）

| 项 | 内容 | 判据 |
|---|---|---|
| D-1 | `OR`/`NOT`：**二选一** —— 给 `ConditionDefinition` 加逻辑位，或 promote 时**响亮拒绝** `OR`（**禁静默压成 AND**） | 草稿写「或」要么如实生效、要么当次失败并点名 |
| D-2 | 「模式库」页面：展示系统会哪些模式、每个模式能表达什么、不能表达什么（`listModules` 已有端点 ⇒ **纯前端**） | 无禁用词命中、控件数达标（按 §项目规则 的探针判据） |
| D-3 | 冷算阻塞（`9aq`）：stale-while-revalidate —— 数据戳不匹配时**立即返回上一版 + 显式 stale 横幅**，后台重算 | 页面永不白屏等；横幅禁静默 |
| D-4 | 孤立模块接线：`factorAblation` 接入闭环 overfitting 阶段；`signalToPnl` 明确归属或如实标「未接线」 | `grep` 有真实调用方 |

---

## 8. 操作方式：两种用户路径

### 今天（STEP A/C 之前）

「说一种模式 → 看结论」这一段**已经好用**：
1. 打开 `/research/ask`，选数据集版本（如 `390002`）+ 写一句问题（示例：「首板后回踩深度是否影响后续收益？」）
2. 看「研究计划预览」→ 点「执行这份计划」→ 等（28 条约 95s）
3. 结论页读【研究问题】/【针对该问题】/【统计判定】三段
4. 点「创建 Candidate」拿到 `DRAFT` 候选
5. ⚠️ **此后的路仍要手工**：进候选详情页填 10 项必填 → `ACCEPTED` → promote → 回测（**且回测跑的是默认配方，不是你的模式**）

### STEP A+C 之后

1~4 步不变；**第 5 步变成**：候选自动带齐草图 + `recipeId` → 用户只做审核 → promote → 回测 → **回测执行的正是这个模式** → 绩效三件套 + 参数寻优同源。

**而「新增一种模式」由 WorkBuddy 这样操作**：只新增 1 个 `TradingPatternSpec` 声明文件（写清关键词、研究条件、执行 gates、参数空间、草图默认值），注册期校验通过即自动获得「提问可识别 → 计划可生成 → 候选可带 recipe → 回测同源」的全链能力。

---

## 9. 风险与纪律（实现时必须守住）

| 风险 | 处置 |
|---|---|
| 🔴 **改 `server/**` 热重启杀死在途 Run** | 先跑 `docs/evidence/_probe_inflight_state.mts` 确认零在途；**现状不满足**（1 个 PENDING Run） ⇒ **STEP 0 必须先做** |
| 🔴 **制造第二套口径** | A-1 必须复用 `recipeFeatures/*` 与 `STRATEGY_DERIVED_BAR_FIELDS`；B-1 必须复用绩效三件套；候选来源排序继续用 `aggregate.ts:301`；**禁第二套抠码 / 第二套 ID / 第二个转换入口** |
| 🔴 **静默降级** | A-2 的不可映射条件**必须抛错**并列出每一处；C-4 的不一致**必须拒绝注册**；`recipeSource` / `datasetSourceNote` 照旧如实回显 |
| 🔴 **迁移期双写风险** | STEP C 两侧注册表**并存 + 一致性测试**，不做一次性替换 |
| **零迁移优先** | 本方案 A/B/D **零 migration**；若 A-1 需要新派生字段则复用既有 `STRATEGY_DERIVED_BAR_FIELDS` 扩展点，仍不动 `schema.ts` |
| **不改已落库内容** | 既有 8 条已转正策略的声明**不回填**（`strategy_versions` 内容禁 UPDATE）；按新写法**重新转正** |
| **`RESEARCH_READY` 不变** | 本方案不因「结果可看」或「链路打通」而改变该标志 |

---

## 10. 未做清单 / 待用户决策

**本轮未做（只读审计）**：
- 未修改任何文件（`server/**` / `client/**` / `schema.ts` / 总控全部零改动）。
- **未写 `ROADMAP.md` §44.5**（建议编号：`9av`=STEP 0、`9aw`=STEP A、`9ax`=STEP B、`9ay`=STEP C、`9az`=STEP D；**取号前须实查扫描取全集**，禁「末条 +1」）。
- 未跑任何会写库的探针；未清理 PENDING 残骸（属 STEP 0-1，需授权）。

**待决策（3 条）**：
1. **STEP 0 的残骸收敛要不要现在做？**（会写 `research_run` / `research_experiment` 状态；建议先只做 0-1 的收敛 + 0-2 的钩子）
2. **STEP A 的 A-2 落地策略**：无法映射的条件应「抛错」还是「回落默认配方 + 如实声明」？（我建议**抛错** —— 静默回落正是 P0-1 的成因）
3. **STEP B 的参数空间来源**：从策略文档 `document.parameters` 派生（我建议），还是保留一个独立的参数空间声明？

---

## 附：本次审计的关键证据索引

```bash
# P0-1 条件不参与信号（应为 0 命中）
grep -rn "entry\.conditions" server/research/signalEngine/ server/research/recipeRegistry.ts

# P0-1 静默回落默认配方
sed -n '385,403p' server/runWorkbenchAssembly/assemble.ts
grep -n "DEFAULT_STRATEGY_RECIPE_ID" server/research/recipeRegistry.ts   # :509

# P0-1 候选不带 recipe
sed -n '510,539p' server/researchPlannerRouter.ts
grep -n "extra.recipe" server/research/strategyCandidate/definitionBuild.ts  # :926-992

# P0-2 参数搜索跑 legacy 回测
grep -n "getLeaderCandidateBacktest\|strategyId" server/paramSearchRouter.ts
grep -n "getLeaderCandidateBacktest" server/walkForwardRouter.ts

# P0-3 闭环执行器覆盖
grep -n "notWired" server/research/closedLoopWiring/requirements.ts

# P1-1 OR 静默压 AND
sed -n '364,421p' server/research/strategyCandidate/definitionBuild.ts

# 在途状态（动手前必跑）
node --import tsx docs/evidence/_probe_inflight_state.mts
```
