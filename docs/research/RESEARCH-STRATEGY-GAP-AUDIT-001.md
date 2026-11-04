# 研究分析 × 策略：缺口清单（只读审计）

> **范围**：本次只审「研究分析」与「策略」两块代码，**不涉及**回测/走查/稳健性/OOS/过拟合/收口。
> **性质**：只读审计，**未修改任何代码**。所有结论均给出**文件:行号**与**实测证据**（含 grep 命中数），不采信既有报告的转述。
> **日期**：2026-09-17（工作区实查）

---

## 0. 一句话结论

> **研究侧与策略侧是两套独立词汇表，中间既没有翻译层、也没有一致性约束。**
> 研究侧能表达的（`OR` / `NOT`、窗口布尔、多假设），策略侧**存不下或看不懂**；
> 策略侧需要的（字段引用、执行约束、参数角色），研究侧**不产出**。
> ⇒ 「分析 → 转策略」这一步**必然卡在人工翻译**上 —— 这正是「无法从分析中得出结论」的技术根因。

---

## 1. 链路实况（逐段核对）

| 段 | 入口（文件:行） | 产出物 | 真实下游消费者 |
|---|---|---|---|
| 提问 | `researchEngine/planner/questionPlanning.ts:153` | `ResearchQuestion` | `researchPlannerRouter.ts:269` → `client/.../ResearchAsk.tsx:146` |
| 计划 | `analysisPlan.ts:280` / `buildPlanSpec:423` | `ResearchPlan` + spec | `materializePlan:637`、`previewOfPlan` router:178 |
| 分析 | `materializePlan:637` → `createAnalysesBatch` | `ResearchAnalysis` | `engine.run` router:224 |
| 结果 | `executeAnalyses` → `repos.results.create` | `ResearchResult` | findingEngine；`aggregate.ts:484`（**仅计数**） |
| Finding | `engine.ts:325` `detectFindingsPhase` | `ResearchFinding` | `buildConclusion` engine.ts:330、`aggregate.ts:525` |
| 结论 | `conclusion.ts:269` → `engine.ts:338` | `ResearchConclusion` | `aggregate.ts:859` `pickConclusion` |
| 候选 | `researchPlannerRouter.ts:458` `createCandidate` | `ResearchStrategyCandidate` | `strategyCandidate/service.promote` |
| 转正 | `strategyCandidate/router.ts:307` → `service.ts:746` | `StrategyDocument` + `strategy_versions` | `researchRunRouter.ts:497`、`paramSearchRouter.ts` |

**主干七段 + 转正均有真实消费者** ⇒ 链路**不缺环**。缺口集中在**语义层**（见 §2）。

---

## 2. 🔴 P0（语义篡改 / 阻断主线）

### P0-1 `OR` / `NOT` 被**静默压成 AND**

**证据链（逐环实测）**

| 环 | 坐标 | 实情 |
|---|---|---|
| 研究侧**完整支持** | `researchCore/types.ts:329`（`logicalOperator`）、`:515`（`groupLogicalOperator`）、`:503` 注释「组内用 `logicalOperator` 连接，组间用 `groupLogicalOperator` 连接」 | ✅ 有 |
| 研究侧**真的会算** | `researchEngine/conditionEvaluator.ts:112-113`（`OR → acc \|\| raw`；`NOT → acc && !raw`）、`:130`（组间 `OR ? acc \|\| raw : acc && raw`）、`researchCore/conditions.ts:241-244`（渲染 `NOT …` / `OR` 连接符） | ✅ 有 |
| 候选写入 | `researchPlannerRouter.ts:507` `filterRule = { groups: groupConditions(source.rows) }` —— `groupConditions` 构造的对象**含** `logicalOperator`（`conditions.ts:193/216`） | ✅ 写进去了 |
| **转正读取** | `grep -c logicalOperator server/research/strategyCandidate/definitionBuild.ts` ⇒ **0** | 🔴 **完全不读** |
| **类型层无处存** | `strategySchema/definition.ts:461-472` `ConditionDefinition` 字段仅 `id / field / operator / value / valueType / description / enabled` —— **没有逻辑运算符字段** | 🔴 无处可存 |
| 回测侧只能 AND | `conditionSignal/compile.ts` 的 `FeatureGate[]` 是 AND 语义 | — |

**影响**：用户在研究侧写「A **或** B」，转正后变成「A **且** B」⇒ 条件变严、回测样本骤减、**不报错、不留痕** —— 属**语义篡改**，且用户无从察觉。

**修法（二选一，需决策）**
- (a) 给 `ConditionDefinition` 加逻辑位 ⇒ 需同时改 `compile.ts` 的门槛合成与闭环 gates 语义（**范围大**）
- (b) promote 时**响亮拒绝** `OR` / `NOT`，错误消息指明「策略侧暂不支持组内 OR/NOT，请改写为单组 AND」⇒ **禁静默压成 AND**

### P0-2 研究侧变量名 → 策略侧字段引用：**没有翻译层，必然人工重写**

- 实测：`pullback_holds_event` 在**策略侧目录命中 0**（`strategyCandidate/*` / `conditionSignal/*` / `runWorkbenchAssembly/*` 全 0），只在研究侧 `planner/analysisPlan.ts`、`planner/moduleRegistry.ts` 出现。
- 候选写入用的是**研究侧条件名**（`researchPlannerRouter.ts:507` 把条件原样抄进 `filterRule`）。
- 转正只接受 `parseStrategyFieldReference` 能识别的**策略文法**（`definitionBuild.ts` 内 **5 处**调用），否则 `STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID`（`candidateTypes.ts:137`）。
- 全库**不存在**「研究变量名 → 策略字段引用」的翻译表。

⇒ **同一份数据：写入用研究名、读取要策略名** ⇒ 转正**必然失败**，除非人工在候选草稿里逐条重写成 `bar.*` / `prefix.rd*.*`。
⇒ `client/src/components/research/candidateSketchVocabulary.ts` 的预置下拉正是这张**人肉对照表**。
⇒ ⚠️ 该失败路径**无测试覆盖**（`definitionBuild.test.ts` 只用 `bar.low` / `bar.volume` / `market_strength`，无研究变量名用例）。

### P0-3 同一概念两侧**算法不同构**（不只是改名问题）

| 概念 | 研究侧 | 策略侧 |
|---|---|---|
| 「未破首板日开盘价」 | `pullback_holds_event_open_2d == 1` —— **窗口布尔**（T+1..T+k 全程不破） | `bar.haircutFromEventLow <= 0` —— **单日连续量** |

⇒ 即使人工翻译，**语义也不同构**（窗口 vs 单日）。`compile.ts` 的等价改写表只覆盖策略侧自有词汇，不覆盖研究侧窗口语义。

---

## 3. P1（结论不可信 / 声明与执行脱离）

| # | 缺口 | 坐标与证据 | 影响 |
|---|---|---|---|
| P1-1 | `parameterRole`（FIXED / TUNABLE）**有声明无消费者** | `definition.ts:571` 定义；生产读取仅 `definitionValidation.ts:344`（白名单）+ `projection.ts:159`（抄写）；**搜索与执行都不读** | 🔴 **FIXED 参数只要带 `min`/`max`/`step` 就会被搜索** —— 与「不可调」的声明冲突（`parameterSpaceFromDocument.ts` 只看 min/max/step） |
| P1-2 | `executionConstraints`（一字板不成交 / 停牌顺延）填了但**回测不读** | `definition.ts:561`；写 `definitionBuild.ts:631-640/834`；`assemble.ts` / `evaluate.ts` **零命中** | 声明了执行假设但不生效 |
| P1-3 | `exit.rules` / `risk` / `position` / `execution.signalTiming` 等**有结构无执行语义** | 回测只吃 recipe/signal；`executors.ts:489/491` 仅**计数** | 页面上有、回测里没有 |
| P1-4 | **5 张投影表无人查询** | 写 `strategyPersistence/db.ts:322-340`；读仅 `db.ts:382-394`（`getVersionBundle` 自检） | `contract.ts:14` 宣称「按参数 / 规则 / 角色查询」是**空承诺** |
| P1-5 | 研究侧变量解析失败**被吞** | `researchEngine/columnProjection.ts:310-338` **四处 `catch {}`** | 变量解析抛错 ⇒ 列不进投影 ⇒ **变量静默全 null**（注释只承认 observation 有此隐患，实测 feature/outcome/dimension 同样被吞） |
| P1-6 | 失败分析**无原因** | `aggregate.ts:513-516` 把 `errorCode` / `errorMessage` **恒置 null** | 结论页只能显示「失败」，不能显示为什么 |
| P1-7 | **promote 不是 `CONVERTED` 的唯一强制入口**（仓储层未拦） | `db.ts:1214` `input.status ?? "DRAFT"`；`db.ts:1299-1305` 允许 `ACCEPTED→CONVERTED`；仅 `candidates.ts:195-208` 要求 CONVERTED 带 `strategyDefinitionId` | 有仓储句柄者可造出「已转正」候选而无 provenance、无版本行 |
| P1-8 | 参数**两套表示**，执行/寻优只用有损的那套 | 权威 `definition.parameters`（`definition.ts:566-586`，含 role）vs 派生 `StrategyDocument.parameters`（`types.ts:252`）；`assemble.ts:556` / `compile.ts:333` / `parameterSpaceFromDocument.ts` 只用后者 | `legacyViews.ts:157` 自认有损 ⇒ 见 P1-1 |
| P1-9 | **不可变清单与测试断言已分叉** | 实现 `researchCore/candidates.ts:129-140` **7 项**；测试 `tests/server/researchCore/candidates.updateBoundary.test.ts:25-34` **6 项**且用 `toEqual` | 断言与实现不一致（是否为红灯待跑测试确认） |

---

## 4. P2（整洁 / 体验）

| # | 缺口 | 坐标 |
|---|---|---|
| P2-1 | `listModules` **零产品消费者**（前端全目录 `researchPlanner.` 只命中 4 个过程，不含它） | `researchPlannerRouter.ts:561` |
| P2-2 | `runFromQuestion` 无产品调用者（宣称是 WorkBuddy 入口，外部 HTTP 调用**未确认**） | `researchPlannerRouter.ts:410` |
| P2-3 | `candidate.sourceFindingIds` / `sourceHypothesisId` 写了**没人读** | 写 `researchPlannerRouter.ts:523` / `researchEngineRouter.ts:998` |
| P2-4 | 派生字段**三份手抄**、无生成/对表机制（仅测试对表） | `definition.ts:274-279`、`compile.ts:63-68`、`candidateSketchVocabulary.ts:337-342` |
| P2-5 | 多假设时实验内**第 2 条起永不被消费** | `engine.ts:328-329` `hypotheses.listByExperiment(...)[0]`（按 id 升序） |
| P2-6 | `derivedFrom` 表达式**永不被求值** | `definition.ts:585`；仅 2 处引用（定义 + 校验） |

---

## 5. 建议处理顺序（按「是否解用户原始痛点」排序）

| 顺序 | 事项 | 理由 |
|---|---|---|
| **1** | **P0-2 + P0-3：建立「研究变量 → 策略字段」的翻译/同源构造** | 这是「分析 → 转策略」的**唯一卡点**；不解决，转正永远靠人工填表。`9ay`（patternLibrary 同源投影）正是此解 |
| **2** | **P0-1：OR/NOT 二选一（加逻辑位 / 响亮拒绝）** | 语义篡改且不留痕，优先级最高的「正确性」缺口。⚠️ 若选「加逻辑位」，它同时是 P0-2 的前置（pattern 声明要能表达 OR） |
| **3** | **P1-1 + P1-8：参数角色贯通**（FIXED 不得被搜索） | 与「参数寻优」直接冲突，会让用户以为不可调参数被搜了 |
| **4** | P1-5 + P1-6：**把吞掉的错误吐出来** | 低成本、直接提升「能不能从分析里得出结论」 |
| **5** | P1-7 + P1-9：把仓储层不变量与测试断言对齐 | 防「伪转正」与红灯 |
| **6** | P1-2 ~ P1-4：**声明与执行对齐**（要么接线、要么如实标「未接线」） | 避免「页面上有、回测里没有」的错觉 |
| — | P2 全部 | 可延后 |

---

## 6. 本次审计的边界与未确认项

- 只读审计，**未运行测试、未查真实库**；除下述外，结论均来自源码实查。
- **未确认**：① `candidates.updateBoundary.test.ts` 与实现的分叉是否已成红灯（只读未跑）；② 真实库中是否存在「含 OR/NOT 的条件」已被转正的历史版本；③ `runFromQuestion` 是否被外部 WorkBuddy 经 HTTP 调用；④ `bar.low >= prefix.rd0.low`（策略侧无 low 派生字段时的顶替写法）在转正链上是否被更宽松路径接受。
- 本文**不提出实现方案**（按要求：先出清单）。若要动手，建议先对 P0-1 的 (a)/(b) 做决策，再决定 P0-2 的落点形态。
---

## 7. ✅ P0 修复记录（2026-09-17 · 最小改动）

> **范围纪律**：用户要求「P0 一次性做完、最小改动、不扩大范围、不细分」。
> ⇒ 只改 **1 个生产文件 + 1 个测试文件**，P1 / P2 **一条未动**。

| P0 | 处置 | 落点 |
|---|---|---|
| **P0-1** OR/NOT 静默压成 AND | ✅ **响亮拒绝**（不引入逻辑位） | `strategyCandidate/definitionBuild.ts#buildConditions`：新增两处逻辑位检查 |
| **P0-2** 研究侧变量名无翻译 | ✅ 错误消息**识别研究侧变量名**并说清该写成什么 | 同上，`parseStrategyFieldReference` 的 `unknown` 分支 |
| **P0-3** 两侧语义不同构 | ✅ **不做机械翻译**，在消息里点名 | 同上（消息里写明「窗口布尔 ≠ 单日连续量」） |
| **P0-4** 兜底默认配方 | ✅ **核对确认无需改** | `assemble.ts:229` 已有 `RecipeResolutionSource`；`:481` 路径 3 注释「两条诚实兜底，事实都进 `assembly.recipeSource`」 |

### 7.1 P0-1 的确切行为（与引擎口径对齐）

| 情形 | 处置 | 依据 |
|---|---|---|
| 组内**第 2 条起** `logicalOperator` 为 `OR` / `NOT` | 🔴 **拒绝**（`PROMOTE_SKETCH_INVALID`） | 原先不读该字段 ⇒ `A OR B` 被静默压成 `A AND B`，条件变严、样本骤减、**不报错不留痕** |
| **组间**（第 2 组起）`groupLogicalOperator` 为 `OR` | 🔴 **拒绝** | 同上 |
| 组内**首条** `logicalOperator` 为 `OR` | ✅ **允许**（放行） | 与引擎口径一致：`conditionEvaluator.ts:8` 明写「组内首条条件的 `logicalOperator` 忽略」（无前序） |
| 首个组的 `groupLogicalOperator` | ✅ 忽略（不校验） | `ResearchConditionGroup` 注释：「首个组无前序，值被忽略但保留以维持列非空」 |

### 7.2 为什么不加逻辑位（记录决策，避免以后反复）

给 `ConditionDefinition` 加逻辑位需要连带改：`compile.ts` 的门槛合成（`FeatureGate[]` 是 AND 语义）、闭环 `gates`、
`conditionSignal` 的等价改写表 —— 属**扩大范围**。本轮按「最小改动让它跑起来」选择**拒绝**：
用户在研究侧写 OR 时**立刻拿到明确错误**（而不是回测出一个悄悄变严的结果），
想用 OR 就必须先在设计上解决它（对应 `9ay` 的模式声明库能让 OR 有处安放）。

### 7.3 验收

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `definitionBuild.test.ts` | **41 / 41**（37 既有 **零回归** + 4 新增） |
| 全量 `vitest run` | **8 failed / 17 failed tests**，失败文件集合与**基线逐项一致 ⇒ 零新增**（用例数 4200 → 4204） |
| 新增用例 | ① 组内第 2 条 `OR` ⇒ 拒 ② 组间 `OR` ⇒ 拒 ③ **首条 `OR` ⇒ 允许**（防误拒） ④ 研究侧变量名 ⇒ 消息含「研究侧变量名」 |
| 改动面 | `server/**` 1 文件（50179 → **53541 B**）；`tests/**` 1 文件（28102 → **30655 B**）；均纯 LF |

### 7.4 边界

- **P1（9 条）/ P2（6 条）一条未动** —— 按用户「只做 P0」的要求。
- P0-2 / P0-3 的**自动解决**（真正的翻译层 / 同源构造）**未做**：两侧语义常常不同构，
  机械翻译会**静默引入语义错误**，所以本轮只做「响亮拒绝 + 说清事实」，把决策交回给人。
  彻底的解是 `9ay`（一个 `TradingPatternSpec` 同时投影出研究侧与执行侧）。
- 未跑真实库端到端（转正链路需要真实候选数据）；本轮用**单测**锁死行为。
