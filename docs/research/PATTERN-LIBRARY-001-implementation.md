# PATTERN-LIBRARY-001 实施报告 —— 交易模式声明库（单一真源）

> 交付日期：2026-09-17 ｜ 对应 `ROADMAP.md` §44.5 条目 **`9ay`** ｜ 前置：`9aw`（条件 → 回测信号）、`9ax` 第 1/2 批（评估端口）

---

## 1. 目标（用户原始诉求）

> 「每种模式可以通过 AI 或者 vibecoding 之类的建立新的研究分析代码；然后可以通过配置或者分析生成的策略来转成正式策略，
> 从而解决现在分析研究模块过于复杂、导致的无法从分析中人工得出结论的问题。」

翻译成可验收的形态：

**新增一种交易模式 = 新增一个声明文件**，研究侧的分析代码、执行侧的配方、参数搜索空间、
候选草图默认值**全部由它派生** ⇒ 「分析得出的东西」与「策略能执行的东西」天生是同一个东西，
不存在翻译环节。

---

## 2. 迁移前的问题（`RESEARCH-STRATEGY-GAP-AUDIT-001.md` 四条 P0，已实证）

「一种交易模式」被拆散在**四个互不相识的地方**，靠人工对齐，无一致性约束：

| # | 症状 | 实证坐标 |
|---|---|---|
| P0-1 | 研究侧能表达 `OR` / `NOT`（`conditionEvaluator.ts:112-113` 真的会算），执行侧存不下 ⇒ 被静默压成 AND | `grep -c logicalOperator definitionBuild.ts` = **0** |
| P0-2 | 研究变量名 → 策略字段引用**没有翻译层** ⇒ 转正必然失败，除非人肉重写 | `pullback_holds_event` 在策略侧目录命中 **0** |
| P0-3 | 同一概念两侧算法不同构（窗口布尔 vs 单日连续量）却无人对账 | `pullback_holds_event_open_2d == 1` vs `haircutFromEventLow <= 0` |
| P0-4 | `filterRule` 为空 ⇒ conditions=[] ⇒ 转正成功 ⇒ 回测跑默认配方 | `assemble.ts:485-488` |

轮次说明：**P0-1 / P0-2 / P0-3 的运行时行为已在上一轮以「响亮拒绝 + 说清事实」止血**
（见 `RESEARCH-STRATEGY-GAP-AUDIT-001.md` §7）。本轮交付的是它们的**结构性解**：
让两侧从同一份声明派生，从而不存在「需要翻译」这件事。

---

## 3. 交付清单

### 3.1 新增（14 个文件）

| 文件 | 行数级 | 职责 |
|---|---|---|
| `server/research/patternLibrary/types.ts` | 316 | `TradingPatternSpec` 及各投影类型（**零运行时依赖**，全 `import type`） |
| `server/research/patternLibrary/patterns/firstLimitPullbackHoldShrink.ts` | 185 | **双栖样板**：研究侧 + 执行侧同源 |
| `server/research/patternLibrary/patterns/{eventReturn,entryTiming,holdingPeriod,breakoutSuccess,stopLoss,marketRegimeStability}Research.ts` | — | 6 个纯研究模式（`execution: null`） |
| `server/research/patternLibrary/patterns/leaderCandidateBaseline.ts` | — | 1 个纯执行模式（`research: null`） |
| `server/research/patternLibrary/patterns/index.ts` | — | 声明清单（新增模式在此加一行） |
| `server/research/patternLibrary/project.ts` | 336 | 研究侧投影 / 参数投影 / 候选草图投影（**唯一实现**） |
| `server/research/patternLibrary/projectRecipe.ts` | 236 | 执行侧配方定义投影（**唯一实现**） |
| `server/research/patternLibrary/index.ts` | — | barrel + 反查（`requireTradingPattern` / `listPromotablePatternIds`） |
| `server/research/recipeRegistryAtoms.ts` | 200 | 执行侧**运行时原子**（特征 id / 计算包装 / 参数读取），从 `recipeRegistry.ts` 机械搬出 |
| `tests/server/research/patternLibrary/patternLibrary.test.ts` | 350 | 35 个用例 |
| `docs/evidence/_probe_pattern_migration_snapshot.mts` | 200 | 迁移行为快照探针（只读） |
| `docs/evidence/_probe_pattern_migration_snapshot.{before,after}.json` | 50972 × 2 | **逐字节相等**的迁移前后快照 |

### 3.2 修改（6 个文件）

| 文件 | 改动 | 规模变化 |
|---|---|---|
| `server/researchEngine/planner/moduleRegistry.ts` | 删除 7 个手写模块工厂 + `DEPTH_BANDS`（**280 行**），`createDefaultResearchModuleRegistry()` 改为遍历声明库注册；顶层默认注册表改**惰性单例** | 26376 → 27066 B |
| `server/research/recipeRegistry.ts` | 运行时原子下移（**154 行**）并 re-export 保持导出面；2 条手写配方（**39 行**）改为投影；注册表改**惰性单例** | 27707 → 20422 B |
| `server/research/strategyCandidate/definitionBuild.ts` | `buildParameters` 读草稿声明的 `parameterRole`（缺省仍 TUNABLE）；范围完整性校验收窄到 TUNABLE | 53541 → 54821 B |
| `server/researchEngine/planner/intent.ts` | 换用 `defaultResearchModuleRegistry()` | — |
| `server/researchEngine/planner/questionPlanning.ts` | 同上 | — |
| `server/researchPlannerRouter.ts` | 同上 | — |

**零**：新端点 / 迁移 / 新依赖 / `client/**` 改动（对比上一轮 `paramSearch` 改动，本轮**完全没碰前端**）。

---

## 4. 关键设计决策（每条都对应一个真实的失败模式）

### 4.1 声明是**纯数据**，投影只有一份

`types.ts` 与 `patterns/**` **只允许 `import type`**，零运行时依赖。

理由：用户要的是「AI / vibecoding 生成一个新的研究分析代码」。如果声明本身是可执行代码，
生成出来的东西就无法逐字段 review、无法 diff、无法在生成前校验。投影集中在 `project.ts`
与 `projectRecipe.ts` ⇒ 「同一份声明产出不同配方」在结构上不可能。

### 4.2 缺哪一侧就如实标 `null`，**禁伪造**

`TradingPatternSpec.research` / `.execution` 均可为 `null`，且语义是「**这一侧不存在**」。

为什么不用「缺省字段」：缺省与「作者忘了写」在 review 时含义完全不同。
实查：8 个模式中 **6 个纯研究 + 1 个双栖 + 1 个纯执行**。

### 4.3 `role` 必填，并**让它真正生效**（P1-1 对症）

`PatternParameterDeclaration.role: "tunable" | "fixed"` 是必填字段。

🔴 关键：迁移前 `definitionBuild.ts#buildParameters` 把 `parameterRole` **恒置为 `TUNABLE`**
⇒ 「声明为固定的参数只要带了 min/max/step 就会被搜索」，而结果看起来完全正常。
本轮让 `parameterRole` 从草稿透传（**缺省仍是 TUNABLE ⇒ 既有草稿零回归**），
并同步把范围完整性校验收窄到 TUNABLE（要求 FIXED 参数给出 min/max 本身就是错的）。

### 4.4 门槛的**条件性启用**必须保留（`enabledWhen`）

迁移前 `buildPullbackGates` 里「红盘」门槛是 `if (requireBullish >= 1) gates.push(...)`
——**门槛列表本身依赖运行期参数**。声明层若用静态数组，就会把
「require_bullish = 0 时不检查红盘」压成「恒检查」，直接改变信号集合。

⇒ 还原成数据 `enabledWhen`，投影时先判再入列。单测用「非阳线样本」在两种取值下**分别断言**。

### 4.5 `filterRule` **刻意不投影**

策略侧「条件表达式」文法与执行侧「特征门槛」是两套表达，`conditionSignal/compile.ts` 的
等价改写表已证明二者需要**逐条数学证明**才能互译。而**不需要**它：只要文档带 `recipe`，
装配层就走注册表配方的 `buildGates`，条件照样进信号（`9aw` 已交付并取证）。

⇒ 生成一份「看起来对」的 `filterRule`，是引入语义错误的最短路径。故不做。
单测有一条专门断言「草图不含 `filterRule`」。

### 4.6 特征 id 只有一份映射

声明里写语义键（`"haircut"`），真实 `featureId` 一律经
`PATTERN_FEATURE_ID_BY_KEY` 从 `recipeRegistryAtoms.ts` 的常量取，**不写字面量**
⇒ 改名时自动跟随；缺键则抛错（不猜、不落空字符串）。

### 4.7 参数按声明顺序**先全部取出**

`buildGates` 闭包在构造门槛之前，先遍历 `execution.parameters` 逐个 `requireNumericParameter`
——与迁移前 `buildPullbackGates` **同序**。改成惰性取值的话，空参数集下的错误消息会从
「`max_volume_ratio` 非法」变成「`max_drawdown` 非法」：同一份输入给出不同诊断。

### 4.8 循环 import 的两个手法（本轮**真实踩到**）

`moduleRegistry.ts` ↔ `patternLibrary/project.ts` 互相 import，且两边都有
「模块顶层立即调用对方」的诱惑：

1. **原子下移**：`recipeRegistryAtoms.ts` 承载「两边都要用」的运行时原子
   ⇒ `recipeRegistry` 与 `patternLibrary` 都指向它，单向、无循环。
2. **惰性单例**：`defaultResearchModuleRegistry()` / `registeredRecipes()`。
   🔴 这不是洁癖 —— 初版是顶层常量，`tsc --noEmit = 0` 但 vitest 报
   `TypeError: buildPatternModuleSpecs is not a function`（另一个模块还在求值中）。
   **类型检查看不出求值顺序问题**，这类缺陷只有真跑才暴露。

### 4.9 `leader-candidate-baseline` 的 `parameters: []` 是**故意的**

实查：库里两份 `limit-up-baseline` 文档声明了 `topN` / `minScore`，但配方**一个都不读**
（`selectionConfig` 里 `topN: 5` 是硬编码常量）⇒ 那两个参数是「声明了却对计算毫无影响」的
**静默无效参数**。本库的纪律是「声明即生效」：既然配方不读，就不为任何参数背书。
若将来要让 `topN` 真可搜，正确顺序是**先让投影把它接进 `selectionConfig`，再加声明**。

---

## 5. 验收证据

| 层 | 命令 | 结果 |
|---|---|---|
| 类型 | `tsc --noEmit` | **exit 0** |
| 新增单测 | `vitest run tests/server/research/patternLibrary/patternLibrary.test.ts` | **35 / 35** |
| **迁移等价** | 迁移前后跑同一探针并比对 | **逐字节相等**：50973 B = 50973 B（归档版 50972 = 50972） |
| 全量 | `vitest run` | 见 §5.1 |
| 前端构建 | `vite build` | **成功（27.80 s）** |
| 行尾 | `node scripts/checkEolDrift.mjs` | 见 §5.2 |

### 5.1 迁移等价快照的采了什么

`_probe_pattern_migration_snapshot.mts` 对**迁移前**的 7 个模块 + 2 个配方采样：

- **模块**：除函数外的全部字段；每条条件配方在 **3 组 ctx** 上的 `build(ctx)` 返回值
  （第三组 `observationMaxOffset = 0` 专门触发「本数据集不支持 ⇒ null」分支）。
- **配方**：可序列化面 + featureIds + featureVersions + `buildSignalBuilder(参数)` 在
  **3 组参数 × 4 组特征**上的信号（覆盖「门槛全过 / 守线失败 / 缩量失败且非阳线 / 特征全缺失」）；
  以及 `resolveParameters` 的 4 条路径（默认 / 合法覆写 / 未知键应抛 / 缺 defaultValue 应抛）。

⇒ 断言的不是「函数签名没变」，而是**同一份输入给出同一份输出**。

---

## 6. 边界（如实）

1. **未接线**：`projectCandidateSketch()` 已就位，但 `researchPlannerRouter#createCandidate`
   **尚未调用它**。⇒ 「在页面上建候选时自动填全草图」这一步还没做（一行调用的事，
   但属于**使用侧接线**，本轮按「最小改动」未含）。
2. **未跑真实库端到端**：本轮验收全部基于单测与只读快照探针（都不写库）。
3. **未改前端**：`client/**` 零改动。
4. **未回填既有数据**：库里 `limit-up-baseline` 文档的 `topN` / `minScore`
   属既有「声明了却无效」的数据问题，**不回填、不改写**，仅登记。
5. **`research`/`execution` 两侧语义强度差异未抹平**：「守线」在研究侧是「窗口全程未破位」、
   执行侧是「决策日当日未破位」。这是数据可得性差异，已写进 `FIRST_LIMIT_PULLBACK_HOLD_SHRINK_NOTES`
   并在候选草图的 `notes` 里带出 —— **不伪装成等价**。
6. **P1 / P2 其余条目未动**（`RESEARCH-STRATEGY-GAP-AUDIT-001.md` §8）：除 §4.3 的 P1-1 外，
   `executionConstraints` / `exit.rules` 有结构无执行语义、`columnProjection.ts` 四处 `catch {}`、
   `aggregate.ts` 恒置 errorCode=null 等**均未修**。

---

## 7. 新增一种模式的操作手册（本库的存在意义）

```
1. 在 server/research/patternLibrary/patterns/ 下新建 myPattern.ts
2. 导出一个 TradingPatternSpec：
     patternId / label / purpose / whenToUse
     research:  { moduleKey, moduleLabel, …, guardRecipes / refinementRecipes / controlRecipes }
     execution: { recipeId, signalKind, features, gates, rankFeature, parameters, … }
     sketch:    { event, timing, observationWindow }        ← 要能转正就必须有
3. 在 patterns/index.ts 的 ALL_TRADING_PATTERNS 里加一行
4. npx vitest run tests/server/research/patternLibrary/patternLibrary.test.ts
```

第 4 步会检查：id 唯一 / 门槛引用的特征是否在产出面内 / 门槛引用的参数是否已声明 /
`sketch.event` 与 `timing` 是否真在策略侧词表内 / 参数名唯一且 `declaration.name` 一致。

完成后：研究侧注册表与执行侧注册表**同时**多出这一种模式。
**不需要**改 `moduleRegistry.ts`、`recipeRegistry.ts`、任何 router、任何前端页面。

---

## 8. 下一步（供路线决策，本轮不自动开始）

| 优先级 | 事项 | 落点 |
|---|---|---|
| 高 | 把 `projectCandidateSketch` 接进 `createCandidate`，让「研究 → 候选」自动带全草图 | `server/researchPlannerRouter.ts` |
| 高 | 真机全链验证：分析 → 候选 → 转正（带 `recipe`）→ 回测，确认条件进信号 | 真实库 e2e |
| 中 | `9ax` 剩余：`walkForward` 改调评估端口；`robustness` / `oos` / `overfitting` 接线 | 见 `9ax` 条目 |
| 低 | P1 其余条目（参数角色已解，剩执行语义 / 吞错 / 投影表无人查询） | 缺口报告 §8 |


---

## 9. 真实库全链验收（2026-09-17 22:26 GMT+8）

**目的**：`9ay` 的完成判据里有一条「候选能带 `recipeId`」+「回测信号与该模式一致」，
单测证明不了（它证明的是**进程内**行为，证明不了「经 tRPC + Drizzle 落库往返后还成立」）。
⇒ 走与前端**完全相同**的 tRPC 链路，在真实库上跑一遍。

**脚本**：`docs/evidence/_e2e_pattern_promote_backtest.mts`（自建自清 + 逐表行数守恒）
**结果**：**25 / 25 通过**（输出归档于 `docs/evidence/_e2e_pattern_promote_backtest.out.txt`）

### 9.1 取证链（每一步都是真实库往返，非内存断言）

| 环节 | 关键读数 |
|---|---|
| §2 建候选（带 `patternId`） | 落库 `entryRule.extra.recipe.recipeId = first-limit-pullback-hold-shrink`、`featureVersions` 4 条、`observationWindow = {2,2,TRADING_DAY}`；`parameterSpace` 三参数且 `parameterRole = TUNABLE`；`sourceTraceJson.patternId` 回显 |
| §2 provenance | 记录「为何不写研究侧 `filterRule`」+ 门槛摘要 `["守线：haircut lte maxDrawdown","缩量：volumeRatio lte maxVolumeRatio","红盘：isBullish gte 1"]` |
| §3 状态推进 | `DRAFT → REVIEW → ACCEPTED`（状态机唯一合法路径） |
| §4 转正 | `cand-900002`；文档 **`document.recipe`** 存在且 recipeId 正确；`definition.entry.conditions = 0`；`parameters` 三参数带 `defaultValue` |
| §5 装配层 | `resolveStrategyRecipe(document.recipe).recipeId = first-limit-pullback-hold-shrink`（**不是兜底**）；特征产出面与文档 `featureVersions` 逐项一致 |
| §5 真实回测 | 请求的 5 阶段全部 `EXECUTED`（其余 9 阶段如实 `SKIPPED`）；**`totalReturnPct = 4.9272%`**、`cagrPct = 653.88%`、`maxDrawdownPct = 0`、权益曲线 7 点 |
| §6 自建自清 | 策略侧 8 表 + 候选表**行数逐表守恒**，清理零错误 |

⇒ **「条件真的进信号」的证据是两条叠加**：① 装配层解析出的是**本模式的配方**（其 `buildGates` 就是守线/缩量/红盘三条门槛），不是 `DEFAULT_STRATEGY_RECIPE_ID`；② 该文档在同一数据集上跑出了**真实绩效标量**（说明门槛参与了筛选，不是空跑）。修好基线 `strategies = 9`。

### 9.2 🔴 真机暴露的两个**真实缺陷**（单测与 `tsc` 都看不见）

| # | 症状 | 根因 | 处置 |
|---|---|---|---|
| **D1** | `promote` 抛 `PROMOTE_SKETCH_INCOMPLETE: entryRule.extra.trigger — 必填` | `PatternSketchProjection` 只投影了 `event`/`timing`/`observationWindow`/`recipe`，**漏了策略侧必填槽** | sketch 段加 `trigger`（必填）+ 新增 `executionAssumptions.ts` 承载文档级默认（`eventParams`/`execution`/`position`/`risk`/`document`） |
| **D2** | `promote` 抛 `PROMOTE_SKETCH_INVALID: filterRule...fieldName 实际 "pullback_holds_event_open_2d"` | `filterRule` 由**研究侧分析条件**导出，其 `fieldName` 是研究侧变量名 ⇒ 与策略字段引用**不同域**（P0-2 的原始症状） | **正解不是翻译它**：`patternId` 路径下写**空组**（`{groups:[]}`），筛选语义由配方的 `buildGates` 承载，并在 provenance 里写明理由与门槛摘要 |

**D1 的连带修复**：`entryRule` 的合并从「显式入参整体替换」改为 **`extra` 逐键浅合并**（声明为底、调用方覆盖）——
否则调用方只想补一个执行键，就会把声明投影出的 `recipe` 一起丢掉，转正后又落兜底配方。

### 9.3 🔴 三个「判据 / 坐标写错」的自我纠正（产品无错）

| # | 我的错误 | 真相 | 教训 |
|---|---|---|---|
| **M1** | 断言「文档 `definition.entry.recipe` 存在」 | `recipe` 在 **`document.recipe`**（顶层）；`EntryDefinition` 只有 `observationWindow` + `conditions`；`assemble.ts:461` 读的正是 `document.recipe` | 断言位置必须**回源码核对**，不能按「层级看起来该在那」推断 |
| **M2** | 断言「闭环 14 阶段全部 EXECUTED」 | 本端口只请求前 5 阶段子链，其余 9 阶段由编排器如实标 `SKIPPED` ⇒「全 EXECUTED」**既不可能也不该要求** | 判据错会被读成产品错；**FAIL 时第一动作是定性** |
| **M3** | 清理 SQL `DELETE FROM strategies WHERE id = ?` 传 `'cand-870001'` | `strategies` 有**两个身份列**：`id`（INT 自增）+ `strategyId`（varchar 稳定身份）⇒ MySQL 报 `Truncated incorrect INTEGER value` ⇒ **策略行没删掉** | 判据写错比不写更危险 —— 它让「守恒通过」看起来像真的 |

⚠️ M3 导致的残留（孤儿策略 `cand-870001`）已用一次性脚本精确清除，`strategies` 已回到 **9** 行。
**未**在主探针里加「自动扫无候选行的 `cand-*` 策略」：本项目纪律是**策略独立于候选**
（删候选后策略仍可加载）⇒ 自动扫会误伤有意保留的行。

### 9.4 验收汇总（本轮最终）

| 层 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `patternLibrary.test.ts` | **41 / 41** |
| **真实库全链 e2e** | **25 / 25 通过** |
| 全量 `vitest run` | **8 failed / 17 failed tests**，失败文件集合与基线**逐项一致 ⇒ 零新增**（用例 4204 → **4245**） |
| 行尾哨兵 | 0 漂移；新增文件全纯 LF |

### 9.5 边界（更新）

- ✅ 「候选能带 recipeId」**已在真实库取证**（不再只是单测）
- ⚠️ 回测窗口取「数据集末端 −10 天 ~ 末端」（短窗，7 个权益点）—— 这是**取证窗**，不是策略评价窗；
  真实评价需按策略声明的观察窗取更长区间（`evaluation` 端口支持）
- ⚠️ `paper` / `review` / `discipline` 三阶段仍需人工标注数据，未做
- ⚠️ 本轮**未**新增 `filterRule` 的「策略侧条件表达式」自动生成（`{groups:[]}` 是刻意的）——
  若要它，需先写「门槛 → 条件表达式」的反向等价表并逐条证明（`conditionSignal/compile.ts` 已有正向表）；
  当前设计下**不需要**它：条件由 `recipe.buildGates` 承载


---

## 10. 前端接线：让页面能选「交易模式」并看见门槛（2026-09-17 22:42）

### 10.1 为什么要接

第 9 节的全链取证是**后端**能力；而 `client/src` 对 `patternId` / `patternLibrary` /
`patternGateSummary` / `filterRuleOmittedReason` 的 grep 命中数**全是 0** —— 页面上够不到它。
更要紧的是：**页面建候选不传 `patternId`** ⇒ 走的仍是旧路径 ⇒ **转正仍会因 `filterRule` 是研究侧命名而失败**
（P0-2 的原始症状在页面路径上仍然存在）。

### 10.2 改动（1 个只读端点 + 1 个前端文件）

| 位置 | 改动 |
|---|---|
| `server/researchPlannerRouter.ts` | 新增只读 query **`listPatterns`**（照既有 `listModules` 的 `publicProcedure` 范式）。**为什么必须由服务端暴露**：模式声明是服务端代码常量，前端拿不到；让前端复制一份清单 = **第二套列表**，必然漂移 |
| `client/src/pages/research/ResearchAsk.tsx` | ① `patternId` / `patternGateSummary` 两个 state ② `listPatterns` query，**只列 `promotable` 的** ③ 建候选时传 `patternId`（**空串不传 ⇒ 零回归**）④ 成功后从 `candidate.sourceTraceJson.patternGateSummary` 读回门槛 ⑤ `resetAll` 一并清空 ⑥ `OutcomeView` 加 4 个 props ⑦「交易模式（可选）」下拉 + 选定后显示执行门槛与「筛选语义由门槛承载」的说明 ⑧ 候选区展示本次执行门槛 ⑨ `readPatternGateSummary`（窄化 `unknown`，读不到返回空数组、**不抛错** —— 它是展示信息）⑩ 选了模式时，候选来源区的「未导出 ⇒ 等于全市场」警告改为中性说明（否则**误导**：门槛就是本次的真实筛选条件） |

### 10.3 live 端点取证（零副作用 GET）

```
GET http://localhost:4001/api/trpc/researchPlanner.listPatterns   →  HTTP 200
模式数 = 8
  event-return-research              promotable=false  gates=(无)
  first-limit-pullback-hold-shrink   promotable=true   gates=守线：haircut lte maxDrawdown / 缩量：volumeRatio lte maxVolumeRatio / 红盘：isBullish gte 1
  entry-timing-research              promotable=false
  holding-period-research            promotable=false
  breakout-success-research          promotable=false
  stop-loss-research                 promotable=false
  market-regime-stability            promotable=false
  leader-candidate-basebine          promotable=false
```

⇒ 下拉里会出现 **1 个可选模式**（「首板回踩 · 守线 + 缩量」），且它的门槛如实回显。
**8 个模式里只有 1 个可转正**（其余 6 个纯研究 + 1 个纯执行）—— 下拉只列可转正的，这是刻意的：
避免用户选完却转不了正。

### 10.4 验收

| 层 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `vite build` | 成功（26.49 s） |
| 全量 `vitest run` | **8 failed / 17**，失败文件集合与基线**逐项一致 ⇒ 零新增**（用例 4245 不变 —— 本轮只接线、未加测试） |
| live 端点 | **HTTP 200**，8 个模式（见 §10.3） |
| 行尾哨兵 | 0 漂移 |

### 10.5 怎么用（页面路径）

1. `npm run dev`
   ⚠️ **端口只认启动日志**：本轮实测 **4000 被占用 ⇒ 实际是 4001**（`Server running on http://localhost:4001/`）
2. 打开研究页 → 提问 → 跑完 ⇒ 进入 OUTCOME 步骤
3. 「创建候选」按钮上方出现 **「交易模式（可选）」** 下拉；选「首板回踩 · 守线 + 缩量」
   ⇒ 下拉下方显示三条执行门槛（守线 / 缩量 / 红盘）
4. 点创建候选 ⇒ 候选区显示「候选 #N 的执行门槛：守线…；缩量…；红盘…」
5. 转正 ⇒ 出文档带 `recipe` ⇒ 回测跑的是**这个模式**（而不是「按涨跌幅取前 5 名」）

### 10.6 边界（如实）

- ⚠️ **环境限制**：本机 `curl` 走 HTTP **代理**（`--noproxy '*'` 亦不可靠，返回空或 502）⇒ live 探测最终用
  **Node 内置 `fetch` + `localhost`** 完成；且 `127.0.0.1:4001` 另有进程占用 ⇒ **只认 `localhost`**。
  这条已写进 `PROJECT_RULES.md` 的探针纪律（下一步登记）。
- ⚠️ 我起的 dev server 是**会话级后台进程**，会话结束可能被回收 ⇒ 请自行 `npm run dev`。
- ⚠️ 只接了「研究页建候选」这**一条**路径；候选详情页 / 策略页 / `ParamSearch` 页面未动。
- ⚠️ `filterRule` 的「策略侧条件表达式」仍未自动生成（`{groups:[]}` 是刻意的）——
  当前设计下不需要：筛选语义由 `recipe.buildGates` 承载。

## 11. 可达性补丁：让历史 Run 能真正打开「结论 / 创建候选」页（2026-09-17 22:55）

### 11.1 问题（上一节的接线实际够不到）

§10 接完线后用户反馈「找不到具体位置」。查证结果是**产品侧真有缺陷**，不是操作问题：

| 坐标 | 事实 |
|---|---|
| `ResearchAsk.tsx:96` | `const [step, setStep] = useState<ResearchAskStep>("ASK")` —— **内存态** |
| `ResearchAsk.tsx:101` | `questionId` 同为内存态，初始 `null` |
| `ResearchAsk.tsx:166-173` | `getOutcome.useQuery({ questionId: questionId ?? 0 }, { enabled: questionId !== null })` |
| `ResearchAsk.tsx:177-180` | `if (step !== "RUNNING" \|\| outcome === null) return; if (isRunReportable(outcome)) setStep("OUTCOME");` |

⇒ **刷新页面即回 `ASK`**，`questionId` 归 `null` ⇒ `getOutcome` 被 `enabled: false` 关掉
⇒ `OUTCOME` 步骤**永远不再出现** —— 而「交易模式」下拉只存在于那个步骤
（`ResearchAsk.tsx:1162` 把下拉包在 `candidateEligibleAnalyses.length > 0` 的分支里）。

**库里其实有现成数据**：`runId 750003` / `750001` 各有 28 条分析、**20 条带条件**，
完全满足前置条件，但前端**没有任何入口能回到它们的结论页**。

后端口径**无需改动** —— `researchPlannerRouter.ts:380-391` 的 `getOutcome` 本就
同时接受 `questionId` 与 `runId`（`refine` 只要求至少给一个），是前端只用了 `questionId`。

### 11.2 改动（仅 `client/**`，两文件）

| 文件 | 改动 |
|---|---|
| `ResearchAsk.tsx` | ① `import { Link, useLocation, useSearch }` ② 模块级 `readDeepLink(search)` ③ `step` / `questionId` / 新增 `entryRunId` 从 URL 初始化（有则 `step = "RUNNING"`）④ `outcomeQuery` 入参收 `runId` ⑤ `resetAll` 清深链 ⑥ RUNNING 卡片加「正在读取 Run #N 的结论」提示 |
| `ResearchDetail.tsx` | Run 面板 `right` 里加 `<Link href={/research/ask?runId=${selectedRun.id}}>` 的「看结论 / 创建候选」按钮 |

新增探针 `docs/evidence/_probe_visible_pattern_entry.mts`（只读）回答「**哪个 Run 能看到下拉**」：
判据 = `aggregate.ts:301-305` 的 `conditionCount > 0`。

### 11.3 取证（DOM 级，无头 Chrome + CDP）

`docs/evidence/_probe_pattern_entry_dom.out.json` —— 两例、**零 `pageError` / 零 `consoleError`**：

| URL | 判据 | 读数 |
|---|---|---|
| `/research/ask?runId=750003` | `#research-pattern-select` 存在 | ✅ `labelText = "交易模式（可选）"`；`optionCount = 2` = `不指定` + `首板回踩 · 守线 + 缩量`（11 轮 ≈ 22s） |
| `/research/480003` | `a[href*="/research/ask?runId="]` 存在 | ✅ `href = /research/ask?runId=750003`（3 轮 ≈ 6s） |

4000 与 4001 两个端口**都实测通过**（用户可能在用 4000）。

### 11.4 验收

`tsc --noEmit` = **exit 0**；全量 `vitest run` = **8 failed / 17，失败文件集合与基线逐项一致 ⇒ 零新增**；
行尾哨兵 0 漂移；改动面 `ResearchAsk.tsx` **+166/-9**、`ResearchDetail.tsx` **+12/-0**，
`git diff --numstat` 与 `--ignore-cr-at-eol` **完全一致**。

### 11.5 边界（如实）

- 只补了**入口可达性**；未改任何服务端逻辑、未改 pattern 投影、未新增端点
- 深链只读：不改任何库内数据
- `step` 仍是内存态（未改成 URL 驱动全部步骤）—— 只把「回看历史 Run」这一条路打通

## 12. 「创建候选点了没反应」—— 两个真因（2026-09-17 23:10）

### 12.1 用户反馈与定位过程

> 「这个页面只有一个创建 candidate 的按钮，点了之后没反应」

按 §16 的纪律「按真实导航路径量 DOM」，用无头 Chrome + CDP **真的点了那个按钮**
（`cdp_click_v2.mjs`，输出归档 `docs/evidence/_probe_create_candidate_click.out.json`）。
探针第一版**自己也错了两处**（见 §12.4），修正后才拿到结论。

### 12.2 真因 A：深链模式下**静默 return**（本轮上个补丁引入的）

```ts
// 修复前（ResearchAsk.tsx:276-277）
function handleCreateCandidate() {
  if (questionId === null || outcome === null) return;   // 🔴 无任何提示
```

`§11` 加的深链走 `?runId=` ⇒ **`questionId` 恒为 `null`** ⇒ 点击后**直接返回、零反馈**
⇒ 用户看到的正是「点了之后没反应」。

**服务端本来两者皆收**：`researchPlannerRouter.ts:463-497` 的 `createCandidate`
内部是 `buildResearchOutcome(repos, { questionId? | runId? })`（`refine` 只要求至少一个）。

修复：身份**择一**（`questionId ?? runId`），并把静默 return 换成 `toast.error` 显式提示。

### 12.3 真因 B：请求要 **13.2 秒**，而按钮 pending 时**文案不变**（原有 UX 缺陷）

修复 A 之后重测，拿到完整成功路径：

```
requests  = [{ url: ".../researchPlanner.createCandidate?batch=1", method: POST }]
postData  = {"0":{"json":{"runId":750003,"name":"首板后回踩深度…","patternId":"first-limit-pullback-hold-shrink"}}}
responses = [{ status: 200 }]
succeededAtMs = 13200            ← 真实耗时 13.2 秒
toast     = 已创建候选草稿 #930003 …（2 条，系统自动选择）… 状态为 DRAFT
```

13 秒的来源：`createCandidate` 在服务端要跑一次完整的 `buildResearchOutcome` 聚合
（该 Run 28 条分析）。而按钮旧写法只有 `disabled={creatingCandidate}` + 一个不起眼的小 spinner、
**文案始终是「创建 Candidate」** ⇒ **即便修好 A，用户仍会以为按钮坏了**。

修复：pending 时换文案 + spinner：

```
正在创建候选…（需重建本次结论，约 10~30 秒）
```

### 12.4 附带修的 C：`<a><button>` 非法嵌套

`ResearchDetail.tsx` 的入口按钮原写 `<Link href={...}><Button/></Link>`
⇒ 渲染成 `<a><button>`（HTML 非法嵌套）。项目既有范式是
`<Button asChild><Link href={...}>…</Link></Button>`（`ResearchList.tsx:87-91`）。已改。

### 12.5 落库内容核对（用真实库复核，证明链路写对了）

删除前读 `research_strategy_candidate#930003`（+`930001`/`930002`）：

| 字段 | 值 |
|---|---|
| `entryRuleJson.extra.recipe.recipeId` | `first-limit-pullback-hold-shrink` ✅ |
| `entryRuleJson.extra.observationWindow` | `{start:2, end:2, unit:"TRADING_DAY"}` ✅ |
| `entryRuleJson.extra.trigger` | `FIRST_VALID_DAY` ✅ |
| `filterRuleJson` | `{"groups": []}`（刻意，见 §9）✅ |
| `sourceTraceJson.patternId` / `patternGateSummary` | `first-limit-pullback-hold-shrink` / 3 条门槛 ✅ |
| `parameterSpaceJson` | 三参数全 `TUNABLE`、min/max/step 齐备 ✅ |

⚠️ 三行均为**本次探针点击产生**的 DRAFT，已按 id 精确删除（14 → 11 条，备份
`_scratch/step0/backup/candidates_deleted_930001_930003.json`）。删除安全性依据：
`information_schema` 实测**无任何表**含 `candidateId` 列 ⇒ 不留孤儿。

### 12.6 验收

`tsc --noEmit` = **exit 0**；全量 `vitest run` = **8 failed / 17，失败文件集合与基线逐项一致 ⇒ 零新增**；
`vite build` 成功（15.32s）；行尾哨兵 0 漂移；改动面 `ResearchAsk.tsx` **+208/-13**、`ResearchDetail.tsx` **+12/-0**，
`git diff --numstat` 与 `--ignore-cr-at-eol` 完全一致。

### 12.7 探针自身踩的两处（已写进 skill §16）

| 坑 | 后果 |
|---|---|
| 只监听 `Network.responseReceived` | 「请求已发出、响应未回」时判成「完全没反应」⇒ 必须同时听 `requestWillBeSent` |
| 点击后 `sleep(9000)` 才取一次 toast | sonner 默认 **4 秒**消失 ⇒ 必然取空 ⇒ 必须**高频轮询**（400ms 一次） |
| 模板字符串里写正则 `\s` | 反斜杠被吃掉 ⇒ 匹配恒失败（探针报 `matchCount = 0` 而按钮明明在） |
