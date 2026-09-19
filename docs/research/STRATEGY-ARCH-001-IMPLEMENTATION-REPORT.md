# STRATEGY-ARCH-001 — Strategy Core 实施报告

> **任务**：把 `stock-limit-up-analyzer` 的 Strategy 模块收敛为一个独立、稳定、可版本化、可复现、
> 与具体 Backtest 类型解耦的 **Strategy Core**，使同一个 Strategy 可被 Event Study / Signal Backtest /
> Portfolio Backtest / Parameter Search / WFO / OOS / Paper 等不同执行模式复用。
> **执行日期**：2026-09-19 · **执行方式**：Phase A 映射 → Phase B 一次性改造 → Phase C 测试 → Phase D 报告（不中途请示）
> **最终判定**：🔴 **未达 COMPLETE**（具体阻塞点见 §10 与 §13）。架构机制 15/15 落地并有测试，
> 但「Core 成为唯一求值入口」与「旧模型不再作为第二套真相来源」只做到**语义权威 + 双向适配 + 指纹等值**层面。

---

## 1. Executive Summary

### 1.1 完成了什么

新增**唯一**的 Strategy 语义权威模块 `server/strategyCore/**`（**20 文件 / 6806 行**，纯模块：无 DB / 无 IO / 无 `Date.now` / 无 `Math.random`），
与 `tests/server/strategyCore/**`（**6 个测试文件 + 2 个夹具 / 112 用例**）：

| 规格要求 | 落地物 | 关键实现事实 |
|---|---|---|
| RuleGraph | `ruleGraph.ts` | `ALL / ANY / NOT / CONDITION / EVENT / WINDOW / SEQUENCE / TRIGGER`；8 个比较运算符**全部可执行**（legacy 只映射 5 个）；`WINDOW` **必须显式声明量化器**（`ALL_DAYS`/`ANY_DAY`，**不编默认值**） |
| Temporal / Path | `temporal.ts` | `T / T-1 / T+1 / T+N / WINDOW` 代数 + `evaluation-time` 语义；**PIT 唯一关卡** `createDayScopedBarAccess`：在 `rd` 上决策只允许读 `≤ rd` 的 bar，越界**记录违规**（不是静默 null） |
| Event / Condition / Trigger 分层 | `ruleGraph.ts` | 三者是一等公民节点；`TRIGGER` 用「窗口成立日」决定**哪一天**产出决策（4 种语义可辨） |
| Feature Registry | `featureRegistry.ts` | `{featureId, version, inputs, lookback, leakage, compute}`；新增特征**不改 Core 代码**；内置 `ma/ema/rsi/atr` + 事件相对 4 件 + `pctChange` |
| Parameter Schema / Resolver | `parameterResolver.ts` | `FIXED / TUNABLE / DERIVED`；**DERIVED 真正求值**（结构化表达式 + `derivedFrom` 文本解析器）；类型/范围/枚举/nullable 校验；**循环依赖检测**；`listSearchableParameters` 是「谁能被搜索」的唯一权威 |
| DataRequirements | `dataRequirements.ts` | `frequency / requiredFields / lookback / forwardHorizon / requiredFeatures / requiredDomains / eventRequirements` + **Compatibility Contract**（逐项如实，未声明项进 `notes` 而不是当通过） |
| ExecutionSemantics | `executionSemantics.ts` | `signalTiming / confirmationTiming / executionTiming / priceReference / stateTransition`；方向规则 **E1–E5**（含「成交不得早于信号」） |
| Capabilities | `capabilities.ts` | `eventObservation / signalGeneration / entryIntent / exitIntent / positionIntent`；**由规则图推导**并与声明**比对**（反「声明了却无效」） |
| StrategyRuntime | `runtime.ts` | `StrategyRuntime.evaluate(version, parameterSet, context)` 唯一入口；**不碰**撮合/滑点/手续费/现金/持仓/PnL |
| StrategyDecision | `decision.ts` | `events / conditions / signals / entryIntents / exitIntents / positionIntents / ruleTrace / explanation`；**不返回任何 Backtest 专用对象** |
| Leakage Guard | `leakageGuard.ts` | **三层**：静态审计 A1–A7 + 运行时访问关卡 + 产出前断言；覆盖 future OHLC / volume / feature / outcome / return |
| Fingerprint | `fingerprint.ts`, `canonical.ts` | canonical JSON（递归键排序）+ sha256；覆盖行为面、**排除 metadata**；已知盲区如实登记 |
| Run Snapshot | `runSnapshot.ts` | `strategyVersionId / parameterSet / resolvedParameterSet / engineVersion / codeVersion / executionSemanticsVersion / universe / datasetReference / seed / runtimeConfig` + `build / verify / replay` |
| StrategyVersion 不可变 | `version.ts` | 构造即深冻结；**`updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE`**（把「没有第二条改内容的路径」变成**可断言**的约束）；改内容只能 `applyDefinitionChange()` → 新版本 |
| legacy 适配 | `adapters/legacyDefinition.ts` | **双向**：legacy `StrategyDefinition` ⇄ Core；映射表**未登记即抛错**（不猜、不降级）；**Dataset 绑定被分离出 Definition** |

**零已跟踪文件改动**（`git status --porcelain` 只有 `??` 新文件，除 ROADMAP/memory 的例行更新）、**零迁移、零新依赖、零新端点、零前端改动**。

### 1.2 没有完成什么（如实登记，不藏）

| # | 未完成项 | 为什么 | 影响 |
|---|---|---|---|
| N1 | **Core 未接入生产 tRPC 链路** | `researchRunRouter.loopRun` 的 `useRealData` 分支仍走 `assembleRunWorkbenchInputs` → `recipeRegistry` → `signalEngine`；评估端口同理 | 「Core 是唯一求值入口」尚未成立 ⇒ 本轮的「唯一真相来源」只到**语义 + 指纹**层面 |
| N2 | **阈值型出场规则未进 `exitRuleGraph`** | `TAKE_PROFIT / STOP_LOSS / TIME_EXIT` 需要「入场价 / 入场日」这类**运行态**引用，而 Runtime 的字段目录只覆盖数据集字段与特征（不引入 `state.*` 根，避免与「策略不碰持仓」的边界打架） | 这类规则**如实保留为声明**（`exitRules`）；只有带 `condition` 的 `SIGNAL_EXIT` 会产出 `exitIntent` |
| N3 | **三处与规格 §3 示意图的显式偏离** | 为使 §13 的 `StrategyDecision` 可落地 | Definition 多出 `exitRuleGraph` / `exitRules` / `positionSpec` / `riskSpec` 四格（已在 `definition.ts` 文件头逐条登记理由） |
| N4 | **legacy 复数的第 4 套契约（`research/framework/contract.ts`）未收敛** | 属 Research 域（规格 §21 明令本轮不重构 Research） | Core 与它并存；接入时需一个薄适配 |
| N5 | **`ALL_DAYS` 语义在 legacy 里不可表达** | legacy 的观察窗口恒为「逐日 + trigger 选日」 | 适配器**一律译 `ANY_DAY`** 并写入 `notes`；需要 `ALL_DAYS` 必须显式构造 Core 定义（已测） |

### 1.3 是否达到架构目标？

**部分达到。** 判据：
- ✅ **「Strategy 不绑定 Dataset」成立**：Definition 内零绑定坐标（`findDatasetBindingLeaks === []` 有测试），坐标只允许出现在 `StrategyRunSnapshot.datasetReference`。
- ✅ **「Strategy 不绑定某一种 Backtest」成立**：`StrategyDecision` 是能力中立模型，测试已分别按 Event Study / Signal Backtest / Portfolio Backtest 三种消费姿势取用同一份决策。
- ✅ **「StrategyVersion 不可变」成立**：进程内 + API 层双重约束，且**有可断言的拒绝路径**。
- ⚠️ **「Core 支持所有未来执行模式」只做到「可表达 + 可复用」**，未做到「已接入」。因此最终问题（§13）的回答是**有条件肯定**。

---

## 2. Implementation Mapping（旧模型 → 新模型）

完整底稿见 `docs/research/STRATEGY-ARCH-001-IMPLEMENTATION-MAP.md`（Phase A 产物，含 15 节映射表）。精简对照：

| 旧 | 旧坐标 | 新 | 迁移方式 |
|---|---|---|---|
| `StrategyDocument.definition`（`strategySchema/definition.ts:618`） | 已落库 11 个版本的**编码** | `StrategyCoreDefinition`（`strategyCore/definition.ts`） | **语义权威已转移到 Core**；legacy 定义 = 存储编码 + 兼容视图。Adapter 双向，`legacy→Core→legacy→Core` **指纹逐字节相等**（有测试） |
| `entry.conditions[]`（扁平、无逻辑位、无算术右值） | `definition.ts:461-472` | `RuleGraph`（`ruleGraph.ts`） | 每条 condition → `CONDITION` 节点；条件数组 → `ALL`；窗口+trigger → `SEQUENCE[EVENT, WINDOW, TRIGGER]` |
| `FeatureGate`（执行侧，仅 5 种 kind） | `framework/gatedSignal.ts:28-33` | 并入 `CONDITION` 的求值语义 | Core 不再需要单独的 Gate 类型（8 个运算符直接求值） |
| `FeatureProvider`（散落常量 id） | `recipeRegistryAtoms.ts:107-158` | `FeatureDefinition` + `FeatureRegistry` | 4 个回踩特征 + `pctChange` 已迁入内置注册表，**基准改为显式 `eventDayBar`**（修掉 legacy「假定 `bars[0]` 是首板日」的已知限制） |
| `parameterRole`（无消费者 / DERIVED 无求值） | `definition.ts:163, 584` | `ParameterRole` + `ParameterResolver` | `DERIVED` 结构化表达式（并保留 `derivedFrom` 文本解析器供 legacy 迁移）；循环依赖检测 |
| `ResearchStrategyDefinition.requiredData`（legacy 研究契约） | `research/types.ts:72` | `DataRequirements` + `CompatibilityReport` | 从「只报文本」升级为「逐项兼容性判定 + 未验证项显式登记」 |
| `ExecutionDefinition`（4 个字段） | `definition.ts:553-563` | `ExecutionSemantics`（5 面 + 状态迁移表） | 补 `confirmationTiming` 与 `stateTransition`；E1–E5 方向规则 |
| 无 | — | `Capabilities` | **新增**；由结构推导 + 与声明比对 |
| 无 | — | `StrategyRuntime` / `StrategyDecision` | **新增**（当前生产是「参数解析 + 装配 + signalEngine」三段拼接） |
| `LeakageGuard`（存在但恒通过） | `framework/leakage.ts:66-76` | `leakageGuard.ts`（三层） | 修掉根因：availability 从**绝对远古日期**改为**相对当前 bar 的声明**，守卫因此**真的会拦** |
| `closed_loop_backtest_run`（实测缺 5 项坐标） | `drizzle/schema.ts:2031-2075` | `StrategyRunSnapshot` | **新增域对象**；本轮**不落库**（见 §4） |

---

## 3. Architecture Changes

### 3.1 Strategy / StrategyVersion（规格 §4）

```
StrategyIdentity { strategyId, name, description? }        ← 身份（长期存在）
StrategyVersion  { strategyId, version, status, definition,
                   fingerprint, metadata, parentVersionId, createdAt }   ← 不可变版本
```

- **唯一事实来源判定**：`StrategyCoreDefinition` 是**语义**权威；legacy `StrategyDocument/StrategyDefinition` 降级为**存储编码 + 兼容视图**。
  判据不是注释，而是可执行事实：`toLegacyStrategyDefinition(fromLegacyStrategyDefinition(x).definition)` 再适配一次，**指纹逐字节相等**（测试 `双向适配：… 指纹保持一致`）。
- **不可变的可断言表达**：`updateVersionDefinition()` **永远抛** `VERSION_IMMUTABLE`；`applyDefinitionChange()` 指纹相同 ⇒ `kind:"unchanged"`（幂等），不同 ⇒ semver bump 出**新版本**（`parentVersionId` 指向旧版、status 回 `DRAFT`）。旧版本对象逐字节不变（有测试）。
- semver 解析/bump **复用**既有 `research/strategySchema/version.ts`（不写第二套）。

### 3.2 Definition

`StrategyCoreDefinition = { schemaVersion, ruleGraph, exitRuleGraph, exitRules, positionSpec, riskSpec, featureRequirements, parameterSchema, dataRequirements, executionSemantics, capabilities }`
—— 构造走 `createCoreDefinition()`：**规范化 → 校验 → 深冻结**；无「宽容模式」。

### 3.3 RuleGraph

- 节点闭集 8 种；`WINDOW` 的 `quantifier` **必填**（缺失即校验失败，**不编默认值**）。
- **PIT 与窗口的关系（本轮最关键的一个语义决定）**：`WINDOW` **只考虑当前决策日及之前**的窗口日，未到的窗口日进 `windowValidDays` 之外的 `futureSkipped` 并在 trace 里如实打印。
  ⇒ `evaluate` 是**逐决策日**调用的；`FIRST_VALID_DAY` 在「条件第一次成立的那天」发信号。这既让 `ALL_DAYS`（整段窗口每日守住）有意义，也让「`evaluate(T)` 不读 T+1」成为**结构性事实**而非约定。
- `SEQUENCE` 用贪心最早匹配求各步「发生日」，要求**非降** ⇒ `A → B → C` 可表达。
- **反硬编码**：本模块不认识任何具体策略名（无 `firstLimitPullback` / `dragonLeader` / `breakout` 分支）。

### 3.4 Feature

- `leakage` 声明改为**相对当前 bar**：`{ usesForwardData, dataThroughRelativeDay, availableAtPoint }`。
  - `usesForwardData === true` 或 `dataThroughRelativeDay > 0` ⇒ **注册表直接拒绝** ⇒ 未来结果类变量**无法**被注册为策略特征。
  - `availableAtPoint === "close"` 的特征在 `open` 时点的决策中会被守卫拒绝。
- `lookback` 声明：不足 ⇒ `compute` 返回 `null` + 记入 `insufficiencies`（**不臆造**）。
- 事件相对特征用**显式 `eventDayBar`**（修掉 legacy「`bars[0]` 假定为首板日」的限制，有正/负两支测试）。

### 3.5 Parameter

- `resolveParameters(schema, set)` 是唯一入口，返回**带 `resolved:true` 标记**的 `ResolvedParameterSet`（类型上让「未解析原始配置」无法混入 Runtime）。
- 拒绝项（各有稳定 code）：未知键 / 缺默认值 / 类型不符 / 越界 / 枚举外 / 不允许 null / TUNABLE 缺边界 / DERIVED 缺表达式 / **DERIVED 被覆写** / **循环依赖** / 派生结果非有限。
- 表达式：结构化 `ValueExpression`（`CONSTANT / FIELD_REFERENCE / FEATURE_REFERENCE / PARAMETER_REFERENCE / BINARY(+ - * /) / NEGATE / ARRAY`）+ 文本解析器（`a * (1 - b)` 这类 legacy `derivedFrom` 可机械翻译；函数调用/属性访问**一律抛错**，不猜）。除零**抛错**而不是返回 `Infinity`。

### 3.6 Runtime / Decision

```
StrategyVersion + ParameterSet/ResolvedParameterSet + RuntimeContext
        ↓ StrategyRuntime.evaluate
StrategyDecision
```

- `RuntimeContext` = `{ timestamp, instrument, visibleData, currentRelativeDay?, eventFields?, featureOverrides?, state, datasetCapability?, resolveEvent? }`。
- **四道关卡**（任一不过即抛，绝不降级）：① Definition 无 Dataset 绑定 ② 静态泄漏审计 ③ 数据兼容性 ④ 产出前 PIT 违规断言。
- 事件判定由**运行方注入**（`context.resolveEvent` 或 `setEventOccurrenceResolver`）。**未注入 ⇒ 抛错**，拒绝把「没接事件源」伪装成「当日无事件」（有测试）。
- 明确不碰：order matching / slippage / fee / cash / portfolio / PnL / broker。

### 3.7 Fingerprint / Snapshot

- 指纹覆盖 `schemaVersion / ruleGraph / exitRuleGraph / exitRules / positionSpec / riskSpec / featureRequirements / parameterSchema / dataRequirements / executionSemantics / capabilities`；**排除 metadata**（改名字不产生新行为指纹）。
- 盲区如实登记（`FINGERPRINT_BLIND_SPOTS`）：特征 compute 实现、引擎实现、数据集内容、参数取值、metadata。
- `snapshotFingerprint` **不含** `runId` / `createdAt`（它们是「这一次」的标识，不是配置，有测试），**含** `seed` 与 `engineVersion`（复现必须区分）。
- `verifyStrategyRunSnapshot` 给 6 项独立检查（V1 结构版本 / V2 身份 / V3 定义指纹 / V4 参数可解析 / V5 解析结果一致 / V6 引擎与代码版本），逐项可定位。
- 构建期**拒绝空 `engineVersion` / `codeVersion`**（不接受 legacy 那种 `1.0.0+gunknown` 占位）。

---

## 4. Database Changes

| 类别 | 结果 |
|---|---|
| **新增表 / 列** | **0** |
| **修改表 / 列** | **0** |
| **迁移文件** | **0**（`drizzle/**` 一行未改） |
| **未修改** | `drizzle/schema.ts`、`drizzle/*.sql`（41 个）、`drizzle/meta/*` —— 全部未触碰 |
| **数据** | 既有 11 行 `strategy_versions` / 10 行 `strategies` / 6 行 `closed_loop_backtest_run` 一行未改 |

**为什么不需要数据库变更（这是刻意的，不是遗漏）**：

1. **Core 是纯域层**：`server/strategyCore/**` 不 import 任何 repository / drizzle / router（已用 grep 验证），因此没有「必须落库」的耦合。
2. **现有 schema 已能承载**：`strategy_versions.strategyDocumentJson` 装 legacy 定义（Core 由它机械翻译），`versionRecordJson` 装 §17 九项，`closed_loop_backtest_run.resultJson` 是 `longtext` 可承载快照；**新增表只会制造第二套 Source of Truth**——正是规格 §18「优先扩展现有」与本项目「禁止发明第二套」两条纪律同时反对的做法。
3. **本轮使命是「语义收敛」而非「存储改造」**：把 Core 写进 `strategyDocumentJson` 需要同时改 `map.ts` / `projection.ts` / `validate.ts` / `legacyViews.ts` / `definitionValidation.ts` 与 11 行历史数据，属**高风险不可逆**动作，且规格 §18 明令「禁止直接破坏现有数据 / 禁止重新创建已有核心表」。

⇒ 因此 `StrategyRunSnapshot` 目前是**域对象 + 完整测试**，**未接持久化**（列在 §10 的 N-01）。

---

## 5. API Changes

| 类别 | 结果 |
|---|---|
| **新增端点** | **0** |
| **修改端点签名 / 出入参** | **0** |
| **废弃端点** | **0** |
| **兼容性** | ✅ **完全兼容**：`shared/researchContracts.ts` 与 `server/routers.ts`（及全部 router）一行未改 ⇒ 前端与任何既有客户端**零影响** |

新增的表面只有 `server/strategyCore/index.ts` 这一个**模块出口**（供后续 STEP 接入时 import），**不是** tRPC 端点。
规格 §20/§21 把 Param Search / WFO / OOS / Paper 列为「不做」，且本项目纪律要求「新增 API 越少越好（通常 0~1）」⇒ 本轮取 **0**。

---

## 6. Frontend Impact

| 项 | 结果 |
|---|---|
| 前端文件改动 | **0**（`client/**` 一行未改） |
| 哪些页面继续可用 | **全部**：`/strategies`、`/strategies/:strategyId`、`/backtest`、`/backtest-runs`、`/parameter-search`、`/walk-forward`、`/datasets*`、`/research*` —— 因为**没有任何契约变更** |
| 哪些接口发生变化 | **无** |
| 是否存在待后续 UI 工作 | ✅ **存在（属下一 STEP）**：`StrategyDecision` 目前**没有任何界面**可看。若要让用户看到「Core 怎么判的」，需要 (a) 一个只读端点把 decision 暴露出来，(b) 详情页加一个「规则求值轨迹」区块。本轮按 §20/§21 边界**不做**。 |

> 说明：本任务的 §2.4 要求「保证 Core 改造后不会留下明显失效接口」。在「零契约变更」的方案下这一条**自动满足**，且比「改接口再补前端」更安全。

---

## 7. Backtest Compatibility

| 消费方 | 当前如何接入 | 本轮做了什么 | 状态 |
|---|---|---|---|
| **Event Study** | 消费 `StrategyDecision.events` + `ruleTrace`（事件是否发生 + 事件后观察） | Core 提供 `capabilities.eventObservation`（有 `EVENT` 节点即具备）+ `events[]`；适配器给 `dataRequirements.forwardHorizon` | ✅ **可消费（已测）**；⚠️ 生产路径仍走 `researchEngine/analyses/eventStudy.ts` |
| **Signal Backtest** | 消费 `signals / entryIntents / exitIntents` | Core 提供 `signals[]`（含 `signalDay`）+ `entryIntents[].resultingState`（经状态迁移表推出）；`TRIGGER` 4 种选日语义可辨 | ✅ **可消费（已测）**；⚠️ 生产路径仍走 `signalEngine` + `simulator` |
| **Portfolio Backtest** | 消费 `positionIntents` + `entryIntents` | Core 提供 `positionIntents[]`（`sizingMethod / maxPositions / positionRatio / fixedAmount / parameter`） | ✅ **接口未被破坏（零改动）**；⚠️ 生产路径仍走 `engine/engine.ts` + `positionBudget.ts` |
| Parameter Search | 不需要改 Strategy（规格原则 5） | Parameter Search 读 `parameterSchema` 中 `role === "TUNABLE"` 的项 —— `listSearchableParameters()` 是唯一权威 | ⚠️ 未接线 |
| WFO / OOS / Paper / Live | — | 按 §20/§26 原则 7 **不做** | ⛔ 本轮不做 |

**共同点**：三个消费者都能从**同一份** `StrategyDecision` 里取到自己需要的片段，这就是「解耦」的实证；但**生产链路尚未切换**（N1）。

---

## 8. Legacy Handling

| 对象 | 处置 | 依据 |
|---|---|---|
| `server/research/strategySchema/**`（治理型定义） | **保留**（存储编码 + 兼容视图），由 Adapter 双向翻译 | 11 行历史数据依赖它；§18 禁破坏既有数据 |
| `server/strategy/**`（执行配方型 `Strategy` 纯函数契约） | **保留不动** | 仍在产（`leaderCandidateBaseline`）；且属「执行层」非「语义层」 |
| `server/research/framework/contract.ts`（研究层契约） | **保留不动** | §21 本轮不重构 Research |
| `server/research/patternLibrary/**`（模式声明唯一真源） | **保留不动** | 2026-09-17 刚收敛为单一声明库，不回退 |
| `signalEngine` / `conditionSignal/compile.ts` / `recipeRegistry` | **保留不动** | §20「不重写 Signal Backtest」；它们是**下一 STEP 的替换目标** |
| `realisticBacktest.ts`（legacy T+1 模拟器） | **保留不动** | 唯一合法出口 + 有「非等价」契约测试 |
| `server/backtest/engine.ts#runBacktestEngine2`（生产不可达） | **保留不动**（仅登记） | §20 不做重写；删除会影响 3 个测试 |
| `paperTrading.ts:723-734`（第二份分仓实现） | **保留不动**（仅登记） | ⚠️ 改分仓口径会**重算全部历史数值** ⇒ 必须先经用户授权 |
| `research/persistence/db.ts`（legacy 复数 3 表，0 行 / 有类无实例） | **保留不动**（仅登记） | 清理属独立任务 |
| 新增「第二套」 | **未新增任何平行实现**；Core 是**新增的唯一语义层**，且通过 Adapter 与既有面连接 | 反「原则 9」 |

**Adapter 的纪律**（写进文件头并测试）：
1. 映射表必须登记**方向**（`GREATER_THAN → GT` 是同向；本轮**不做任何算术改写**，因为本仓库曾在「条件 → 特征门槛」改写里把 `bar.low >= prefix.rd0.open` 译成 `haircut >= 0`，方向恰好相反）；
2. 表外取值**一律抛 `LEGACY_MAPPING_UNSUPPORTED`**（不禁用、不降级、不静默丢弃）；
3. **Dataset 绑定被分离返回**，由调用方放进 RunSnapshot。

---

## 9. Tests

### 9.1 命令与结果

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ **0 error**（输出 0 行） |
| `npx vitest run tests/server/strategyCore --reporter=basic` | ✅ **6 文件 / 112 用例 全绿**，0 failed，0 skipped |
| `npx vitest run --reporter=basic`（全量） | ✅ **零新增失败**（见下表） |
| `npx vite build` | ✅ **成功**（15.19s） |
| `node scripts/checkEolDrift.mjs` | ✅ 已跟踪疑似漂移 **0** / 未跟踪 CRLF **0** |

**全量对拍（判据 = 失败**文件集合**，不是例数）**：

| | 失败文件 | 失败用例 | 总用例 |
|---|---|---|---|
| 基线（改造前实测） | 8 | 17 | 4304 |
| 改造后 | 8 | 17 | 4416 |
| 差值 | **0（集合逐项相同）** | **0** | +112（全部为本轮新增） |

失败集合 = `dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar` / `researchCore/candidates.updateBoundary` —— 与基线**逐项一致**。

### 9.2 测试文件与覆盖面（对应规格 §23）

| 文件 | 用例 | 覆盖 §23 项 |
|---|---|---|
| `ruleGraphAndTemporal.test.ts` | 23 | §23.1 RuleGraph（ALL/ANY/NOT/CONDITION/EVENT/WINDOW/SEQUENCE/TRIGGER + `A AND (B OR C)` + `A AND NOT(B)` + `A→B→C` + 静态校验）+ §23.2 Temporal（T/T+1/T+N/WINDOW/SEQUENCE + PIT 可见性 + 越界记违规） |
| `parameter.test.ts` | 18 | §23.3 FIXED/TUNABLE/DERIVED · default · validation · dependency · **cycle detection** · resolution · 文本表达式解析 · 除零 · 不可解析 |
| `feature.test.ts` | 13 | §23.4 Registry · lookup · version · lookback · availability（含「未来结果类禁止注册」）· 事件日基准显式化 · 可扩展性 |
| `leakage.test.ts` | 15 | §23.5 静态 A1–A7 + **运行时 `evaluate(T)` 不得读 T+1 / T+2 / future outcome** + 三支负例 + 「未注入判定器 ≠ 无事件」 |
| `runtimeAndAdapter.test.ts` | 18 | §23.6 Version+ParameterSet+Context→Decision 全跑通 + 参数覆写真的改变结果 + 数据兼容性拒绝 + 确定性 + 深冻结 + §22/§19 legacy 双向适配 |
| `versionFingerprintSnapshot.test.ts` | 25 | §23.7 不可变（含「恒抛」API + 新版本语义）+ §23.8 Fingerprint + §23.9 Snapshot / Replay |

### 9.3 关键测试（挑 12 条最能说明问题的）

1. `WINDOW：只看当前决策日及之前的窗口日` —— trace 里 `windowValidDays=[1,2]`、`detail` 含 `[3,4,5]`、`satisfied=false` ⇒ PIT 是**结构性的**。
2. `在 T+1 决策却引用 post.rd2 ⇒ 抛 LEAKAGE_LOOK_AHEAD` —— 证明 `evaluate(T)` **读不到 T+1**（legacy 的守卫在这一条上恒通过）。
3. `同一图在 T+3 决策时可正常读到 post.rd2` —— 证明不是「一律禁止未来引用」，而是**逐决策日判定**。
4. `参数覆写真的改变结果` —— 阈值 0.5 有信号 / 0.2 无信号 ⇒ 反「声明了却无效」。
5. `DERIVED 随被依赖参数变化` + `DERIVED 多级依赖按拓扑序解析` ⇒ DERIVED **真的求值**（legacy 只有文本声明）。
6. `循环依赖：detectParameterCycles 直接给出环` —— `["a","b","a"]`。
7. `双向适配：legacy → Core → legacy → Core 指纹保持一致` ⇒ **同义子集可逆**，是「Core 是语义权威」的硬证据。
8. `Dataset 绑定被分离出 Definition；Definition 内零绑定泄漏` —— 连 `390002` 这个数字都不出现在序列化结果里。
9. `已发布版本改 Definition ⇒ 永远抛 VERSION_IMMUTABLE` + `改内容只能走 applyDefinitionChange ⇒ 新版本；旧版对象逐字节未变`。
10. `same definition → same fingerprint` / `different behavior → different fingerprint`（改参数默认值、改量化器、加出场图三种行为变化都能改变指纹）。
11. `Replay 等价性：参数原样回填 ⇒ 快照指纹相等`（`runId`/`createdAt` 不同也不影响）。
12. `首板回踩语义（FIRST_LIMIT_UP → T+1~T+5 → LOW >= T0_OPEN → ENTRY）由 RuleGraph 表达并真实执行` —— 规格 §22 的验证样例。

### 9.4 测试过程中抓出并修掉的 4 个 **Core 自身缺陷**

> 全部遵守纪律：**先回源码定性「产品错还是判据错」，再改产品代码**（禁为了让测试变绿而放宽断言）。

| # | 缺陷 | 是怎么暴露的 | 修法 |
|---|---|---|---|
| B1 | 特征注册的**聚合抛错码张冠李戴**：把 `lookback` 非法 / `usesForwardData` / `dataThroughRelativeDay>0` 全部报成 `FEATURE_NOT_REGISTERED` | 测试期望 `FEATURE_LOOKBACK_INSUFFICIENT` / `LEAKAGE_LOOK_AHEAD` 却拿到 `FEATURE_NOT_REGISTERED` | 用**第一条 issue 自己的 code**（在白名单内时），并把 `firstIssue` / `issueCount` 带进 detail |
| B2 | **`bar.<派生字段>` 的 availability 未被审计**：泄漏扫描只收集 `FEATURE_REFERENCE`，而本次定义用的是 `bar.volumeRatio` ⇒ 「声明 close 可得却在 open 时用」可绕过守卫 | 测试断言「`signalTiming=T_OPEN` 应报 A7」却拿不到任何 finding | `collectReferenceSites` 对字段引用**额外**经桥接表产出 feature 站点 |
| B3 | **无 WINDOW 时静态 A4 界被编造为 0** ⇒ 把「纯条件 + `post.rd{n}`」的**合法**定义误杀 | 「T+3 决策可读 post.rd2」用例被静态审计拦下，报「最早可产生信号的相对日为 T+0」 | 无 WINDOW ⇒ 静态层**证不出就不设界**（`+∞`），交给运行时关卡逐次判定；并补一条「不误杀」的正向用例 |
| B4 | **`collectRuleFeatureReferences` 漏掉派生字段桥接** ⇒ `featureRequirements` 可为空声明，运行时却抛 `FEATURE_NOT_REGISTERED` | 适配器路径上「声明面 = 空 / 使用面 = volumeRatio」本会静默通过校验 | 收集器**纳入桥接**（`bar.volumeRatio → volumeRatio`）⇒ 声明面与使用面强制对齐，且该校验变成有效判据 |

**另有 2 处是测试判据自身的错**（按纪律改判据并记录）：① `WINDOW` 用例里用了夹具默认 `low=10.2` 去比阈值 `10.3`（判据写错，不是产品错）；② 快照回填用例把 `resolvedParameterSet` 当 `parameterSet` 回填 —— 预期就是抛错，改为**断言抛 `PARAMETER_DERIVED_OVERRIDE_FORBIDDEN`**（反而成了一条有效纪律测试）。

---

## 10. Remaining Issues

| # | 问题 | 严重度 | 说明 |
|---|---|---|---|
| N-01 | **`StrategyRunSnapshot` 未接持久化** | 中 | 域对象与测试齐备，但没有写进 `closed_loop_backtest_run.resultJson`（属契约变更 + 生产链路接线，见 N1） |
| N-02 | **Core 未接入生产链路**（N1） | **高** | `loopRun` / 评估端口 / `signalEngine` 仍是 legacy。⇒ 生产环境的行为**仍是旧语义**，Core 目前是「已建成但未通电」 |
| N-03 | 阈值型出场规则未进 `exitRuleGraph`（N2） | 中 | 需要为 Runtime 增加「入场价 / 入场日」这类运行态引用（会触碰「策略不碰持仓」的边界，需先定设计） |
| N-04 | `ALL_DAYS` 在 legacy 侧不可表达 | 中 | 适配器只译 `ANY_DAY`；「整段窗口每日守住」的策略只能在 Core 侧手工构造 |
| N-05 | 第 4 套策略契约（`research/framework/contract.ts`）未收敛（N4） | 低 | 属 Research 域 |
| N-06 | `eventOccurrenceResolver` 有一个**模块级可变单例**（`setEventOccurrenceResolver`） | 低 | 已提供 `context.resolveEvent` 作为按次入参优先；单例仅为兼容便利。多租户/并发下应只用 context |
| N-07 | `FINGERPRINT_BLIND_SPOTS` 中的「特征实现」不在指纹内 | 低 | 靠「改实现必须 bump 特征 version」纪律约束（已在注册表注释与报告登记） |
| N-08 | 未做前端可视化 | 低 | 属下一 STEP |

---

## 11. Explicitly Deferred（规格 §20 / §21 / §26 原则 7）

| 领域 | 本轮状态 | 依据 |
|---|---|---|
| **Dataset** | ❌ 未改（零 schema / 零迁移） | §18；Core 只声明 `DataRequirements`，选数据集是运行方的事 |
| **Research** | ❌ 未重构 | §21 明文 |
| **Parameter Search** | ❌ 未接 Core；只提供 `listSearchableParameters()` 作为「谁能被搜索」的唯一权威 | §20 不做 |
| **WFO** | ❌ 不做 | §20 |
| **OOS** | ❌ 不做 | §20 |
| **Portfolio Engine** | ❌ 不重写（接口未破坏） | §20 |
| **Execution Engine** | ❌ 不重写 | §20 |
| **Signal Backtest / Event Study** | ❌ 不重写（仅保证可被 Core 消费） | §20 |
| **Paper Trading** | ❌ 不做 | §20 |
| **Live Trading** | ❌ 不做 | §20 |
| **Evaluation 端口** | ❌ 不改（仍走 legacy `assemble`） | §20 不做 + N1 的接产属下一 STEP |
| **数据库写入路径** | ❌ 未改一行 | §18 + 避免第二套 SoT |
| **前端** | ❌ 未改一行 | §2.4 在零契约变更下自动满足 |
| **分仓口径 / `paperTrading.ts` 重复实现** | ❌ 不动 | 改口径会重算历史数值 ⇒ 需用户授权 |

---

## 12. Final Architecture Diagram（实际代码）

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ client/src/**（本轮未改一行）                                                 │
│   /strategies  /strategies/:id  /backtest  /backtest-runs  /parameter-search   │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │ tRPC（本轮 0 新增 / 0 修改 / 0 废弃）
┌───────────────────────────────▼───────────────────────────────────────────────┐
│ server/routers.ts · researchRouter · researchRunRouter · researchEngineRouter  │
│ paramSearchRouter · walkForwardRouter · datasetRegistry（全部未改）            │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
        ┌───────────────────────┴────────────────────────┐
        │                                                │
┌───────▼────────────────────────────┐   ┌───────────────▼──────────────────────┐
│ 生产链路（仍是 legacy；N-02）       │   │ ✨ NEW  Strategy Core（语义权威）     │
│  runWorkbenchAssembly/assemble.ts   │   │  server/strategyCore/**               │
│   → recipeRegistry.resolveParameters│   │                                        │
│   → conditionSignal/compile.ts      │   │  types ─ temporal ─ expression        │
│   → signalEngine/engine.ts          │◀──│    └─ ruleGraph ─ featureRegistry     │
│   → research/simulator/engine.ts    │   │    └─ parameterResolver               │
│   → leaderCandidateStrategyBacktest │   │    └─ dataRequirements(+兼容性契约)   │
│ researchEngine/analyses/eventStudy  │   │    └─ executionSemantics              │
│ engine/engine.ts + positionBudget   │   │    └─ capabilities                    │
└────────────────────────────────────┘   │    └─ definition ─ fieldReference     │
                                          │    └─ leakageGuard ─ decision         │
                                          │    └─ fingerprint ─ version(不可变)   │
                                          │    └─ runSnapshot ─ runtime           │
                                          │    └─ adapters/legacyDefinition ⇄     │
                                          └───────────────┬──────────────────────┘
                                                          │ 双向 Adapter
                                          ┌───────────────▼──────────────────────┐
                                          │ 现有编码层（未改）                     │
                                          │ research/strategySchema/**            │
                                          │  strategyDocumentJson（11 行历史数据） │
                                          └──────────────────────────────────────┘

数据流（Core 内部）
  StrategyVersion + ParameterSet/ResolvedParameterSet + RuntimeContext
      ↓ ①Definition 无绑定守卫 ②静态泄漏审计 A1–A7 ③数据兼容性 ④产出前 PIT 断言
  RuleGraph 求值（WINDOW 只看 ≤ 当前决策日）
      ↓
  StrategyDecision { events · conditions · signals · entryIntents · exitIntents
                     · positionIntents · ruleTrace · explanation }
      ↓
  StrategyRunSnapshot { parameterSet · engineVersion · codeVersion · seed
                        · universe · datasetReference · runtimeConfig }
      ↓
  （下一 STEP）生产链路接入 + 快照落库
```

---

## 13. 完成标准逐条自评（规格 §25）

### Architecture

| 项 | 结论 | 证据 |
|---|---|---|
| Strategy identity 唯一 | ✅ | `StrategyIdentity` + `createStrategyVersion` 单一入口 |
| StrategyVersion 唯一 | ✅ | 同上；semver 校验 + 深冻结 |
| Definition 唯一 | ✅ | `StrategyCoreDefinition`（`createCoreDefinition` 唯一构造入口，规范化→校验→冻结） |
| RuleGraph | ✅ | 8 节点 + 求值 + 校验；`A AND (B OR C)` / `A AND NOT(B)` / `A→B→C` 有测 |
| Temporal semantics | ✅ | 相对日代数 + `evaluation-time` + PIT 访问关卡 |
| Feature Registry | ✅ | 注册/查找/版本/`lookback`/`availability`；新增特征不改 Core |
| Parameter Resolver | ✅ | FIXED/TUNABLE/DERIVED + **DERIVED 真求值** + 循环依赖 |
| DataRequirements | ✅ | 7 个面 + CompatibilityReport |
| ExecutionSemantics | ✅ | 5 面 + 状态迁移 + E1–E5 |
| Capabilities | ✅ | 推导 + 与声明比对 |
| StrategyRuntime | ✅ | `evaluate(version, parameterSet, context)` |
| StrategyDecision | ✅ | 6 类产出 + trace + explanation |
| Leakage Guard | ✅ | 三层；`evaluate(T)` 不读 T+1/T+2/future outcome 有测 |
| Fingerprint | ✅ | canonical JSON + sha256；覆盖行为面 |
| Run Snapshot | ✅（机制） | 15 项字段 + build/verify/replay；⚠️ 未持久化（N-01） |

### Compatibility

| 项 | 结论 | 说明 |
|---|---|---|
| Event Study 可消费 | ✅ | `capabilities.eventObservation` + `decision.events`；已测 |
| Signal Backtest 可消费 | ✅ | `signals` / `entryIntents`（含状态迁移）；已测 |
| Portfolio Backtest 接口不被破坏 | ✅ | 既有文件**零改动**、零契约变更 |
| **旧代码不存在第二套 Strategy 真相来源** | ⚠️ **部分** | Core 已是**语义**权威（双向适配指纹等值），但**生产求值仍是 legacy** ⇒ 本条**未完全满足** |

### Quality

| 项 | 结论 |
|---|---|
| TypeScript / build 通过 | ✅ `tsc --noEmit` = 0；`vite build` 成功 |
| 单元测试通过 | ✅ 112/112；全量**零新增失败** |
| Runtime 测试通过 | ✅ 8 用例 |
| Leakage 测试通过 | ✅ 15 用例 |
| Parameter 测试通过 | ✅ 18 用例 |
| RuleGraph 测试通过 | ✅ 23 用例 |
| Snapshot 测试通过 | ✅ 25 用例（含 Replay 等价性） |

### 最终结论

> 🔴 **不宣布 COMPLETE。**
> **架构机制 15/15 全部落地、全部有测试、全部零回归**（这一步是扎实的）；
> 但完成标准里有一条（**「旧代码不存在第二套 Strategy 真相来源」**）只做到 **⚠️ 部分**，
> 因此按规格 §27 的要求，**必须具体说明剩余阻塞点**而不是标记完成。

### 对最终问题的回答（规格 §27）

> **现在的 Strategy Core 是否已经可以在不修改 Strategy 核心架构的情况下，同时支持
> Event Study、Signal Backtest、Portfolio Backtest、Parameter Search、WFO/OOS 等未来执行模式？**

**是「可以」，但有一个前提和一个缺口。**

- ✅ **可以的部分（本轮已用测试证明）**：五种执行模式需要的**全部语义**都已能由 Core 表达，且由**同一份 `StrategyDecision`** 供给 ——
  事件观察（`events`）、信号（`signals`）、入场/出场（`entryIntents`/`exitIntents`）、仓位（`positionIntents`）、
  可搜索参数（`listSearchableParameters`）、运行坐标（`StrategyRunSnapshot`）。接入任何一种新执行模式**不需要改 Core**：
  只需写一个消费者 + 注入一个事件判定器。这是「不修改核心架构即可扩展」的正面证据。
- ⚠️ **前提**：要享受这一点，消费方必须**走 `StrategyRuntime.evaluate`**。目前生产链路还没走（N-02）。
- 🔴 **具体阻塞点（3 条，按优先级）**：
  1. **接产（N-02，必修）**：把 `loopRun` 的 `useRealData` 分支、`strategyEvaluation` 评估端口、`conditionSignal/compile.ts` 切到 Core；
     验收判据 = **Core 成为唯一求值入口**（legacy `signalEngine` 退化为兼容适配）。缺这一步，Producer 侧的行为仍是旧语义。
  2. **快照落库（N-01）**：`StrategyRunSnapshot` 要写进 `closed_loop_backtest_run.resultJson`（或新增列），否则「复现」在**留档层面**仍缺参数/引擎/代码版本。
  3. **阈值型出场的运行态引用（N-03）**：`TAKE_PROFIT` / `STOP_LOSS` / `TIME_EXIT` 需要「入场价 / 入场日」。
     这不是「Core 能力不足」，而是**边界问题**（是否需要给 Runtime 一个受控的 `state.*` 只读引用），需要先定设计再实现；
     在此之前，这些规则以**声明**形式保留，不会被伪装成「已能执行」。

---

## 附录 A — 本轮产物清单

| 类型 | 路径 | 规模 |
|---|---|---|
| 生产代码（新增） | `server/strategyCore/**` | 20 文件 / 6806 行 |
| 测试（新增） | `tests/server/strategyCore/**` | 6 测试文件 + 2 夹具 / 2052 行 / 112 用例 |
| Phase A 映射底稿 | `docs/research/STRATEGY-ARCH-001-IMPLEMENTATION-MAP.md` | 15 节 |
| 本报告 | `docs/research/STRATEGY-ARCH-001-IMPLEMENTATION-REPORT.md` | 13 节 |
| 既有文件改动 | `ROADMAP.md`（§44 覆盖 + §44.5 新增 `9bi` + 台账两处同步）、`ROADMAP-CHANGELOG.md`（§47 append）、`.workbuddy/memory/**` | 例行台账 |

## 附录 B — 本次交付的边界（诚实声明）

1. **未运行真实库脚本**（除一次只读在途探针用于开工前的安全判定）；**未写任何数据库**。
2. **未做真机（无头浏览器）验收** —— 因为本轮零前端改动、零契约变更，没有可验收的界面变化。
3. **规格 §0 引用的 `STRATEGY-ARCH-001 — Strategy Core Architecture Design` 设计方案在仓内不存在**（`find` 实测只命中本任务的两个产物）；实施以**规格正文 §3–§17 的目标架构**为准。
4. **`server/**` 既有文件一行未改** ⇒ 无热重启风险；开工前已确认 `research_runs` **零 `RUNNING`**（1 个 `PENDING` 为合法草稿，非在途）。
5. 本报告的「实测」结论均来自本会话实际执行；未执行的一律标注为「未做 / 未验证」。
