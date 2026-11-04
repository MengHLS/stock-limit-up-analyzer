# PARAMETER-002 — Parameter Search 有效性 Gate 与 Robustness 前置验收 · 最终报告

> **任务号**：PARAMETER-002（ROADMAP 编号 **`9bt`**）
> **日期**：2026-09-19
> **判定**：**COMPLETE**
> **N-02**：**已定性 = 情况 D（参数未被执行链消费）**，**根因在策略文档，不在 Parameter Search**；PS 侧已加护栏 → 记 **FIXED（PS 侧）** + **VERIFIED（链路侧无缺陷）**
> **N-01**：**FIXED**　|　**N-05**：**保留并标记 `LEGACY / PREVIEW`（收敛状态已明确）**　|　**N-03**：**DEFERRED（不变）**
> **基线版本**：`v1.1.0` → **`v1.1.1`**（patch：实现细节 + 行为修正）
> **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 1. Executive Summary

### 1.1 一句话结论

> **Parameter Search execution chain verified. N-02 is not a defect of Parameter Search.**
>
> 参数**确实进入了**执行链（覆写 → `experimentConfig.parameters` → `CoreDecisionSource` → `StrategyRuntime` 全部到位），
> 但**被搜索的那份策略文档的规则图里没有任何 `PARAMETER_REFERENCE`**（阈值被写成字面量）
> ⇒ 决策引擎**结构性地读不到**这些参数 ⇒ 不同取值得到**逐字节相同的权益曲线**。
>
> **决定性反证（正对照）**：把同一条条件的右值从句面量改成**参数引用**后，
> 同一策略、同一数据集、同一窗口下 `max_volume_ratio = 0.05` → **0 笔成交**；
> `= 1.0` → **8 笔成交 / −10.36% / 最大回撤 10.54% / 胜率 50%**。
> ⇒ **执行链本身完全能把参数带到决策**；「参数不影响结果」是**这份文档的性质**。

### 1.2 三问结论（规格 §13 / §17）

| 问题 | 结论 | 依据 |
|---|---|---|
| **N-02** 不同参数组合结果完全相同且 `tradeCount=0` | **情况 D（参数未被执行链消费），但根因在策略文档**；PS 参数传递链**无缺陷** ⇒ PS 侧新增**死参数护栏**（**FIXED**） | §3 / §4 / §5 / §6 |
| **N-01** 搜索窗口无 fail-fast | **FIXED**（创建时前置校验，北京业务日口径，错误含两个窗口） | §7 |
| **N-05** 两套 Parameter Space 派生器 | **保留旧实现并标记 `LEGACY / PREVIEW`**（实查有真实消费者）；PS **唯一**使用 role-aware 派生器，并有静态源码守卫测试 | §8 |

### 1.3 是否满足进入 Robustness / OOS / Walk-Forward 的前置条件

**满足**（附一条操作前提）：

- ✅ Parameter Search 的**执行链正确性**已被正对照证明（参数能真正改变 fills / equity / canonical metrics）；
- ✅ PS 侧已能**拒绝无意义搜索**（死参数）与**越界窗口**（前置校验），不会再有「N 组相同结果 + 白付 N 次回测」；
- ✅ Resume / Cache / 落档 / 指标读数（PARAMETER-001）保持有效且无回归；
- ⚠️ **操作前提**：历史候选文档（`cand-3600xx`）的参数是**死参数** ⇒ 要对它们做 Robustness/OOS/WFA 之前，
  必须先用**参数引用**改写条件并生成**新版本**（版本不可变）。否则下游会拿到「参数维度无信号」的结果。

---

## 2. 读取范围（严格按规格 §1，未重扫仓库）

- `docs/architecture/SYSTEM-BASELINE.md` / `system-manifest.yaml` / `CHANGE-AUDIT.md`
- `docs/parameter-search/PARAMETER-001-REPORT.md`
- `server/research/parameterSearch/**`、`server/research/strategyEvaluation/**`、`server/backtest/**`、
  `server/strategyCore/**`、`server/paramSearchRouter.ts`
- 另按需只读：`server/runWorkbenchAssembly/assemble.ts`（装配层的参数落点）、`server/research/recipeRegistry.ts`、
  `server/research/patternLibrary/patterns/firstLimitPullbackHoldShrink.ts`、`server/research/strategyCandidate/definitionBuild.ts`

**未做**：全项目重新审计、性能剖析、Robustness / OOS / Walk-Forward 的任何实现。

---

## 3. N-02 定性

### 3.1 四种情况逐条检验

规格 §2 要求区分 A / B / C / D。以下每条都有**真实执行证据**（不是代码推测）。

| 情况 | 判定 | 证据 |
|---|---|---|
| **A** 测试窗口确实没有产生交易 | ❌ **不成立** | ① 同族策略在**历史留档**里确有成交（`closed_loop_backtest_run`：`cand-360001` 2025-01-02..2025-02-28 **90 笔**）；② 本次把窗口换到该区间后，**正对照**在同窗口产出 **8 笔成交** ⇒ 窗口**不是**贫瘠的 |
| **B** 参数没有真正进入 StrategyRuntime / Backtest | ❌ **不成立** | `assembleStrategySide(A/B)` 的 `experimentConfig.parameters` **随覆写变化**（`{"max_volume_ratio":0.05…}` vs `{"max_volume_ratio":1…}`）；且该 `parameterSet` 被传入 `createCoreDecisionSource({version, parameterSet, …})`（`assemble.ts`），实际决策引擎 = `strategy-core` |
| **C** 参数进入了执行链，但在当前策略/窗口下确实不影响交易 | ❌ **不成立**（措辞不合） | 「C」描述的是「阈值存在但不 binding」。实测是 **规则图里根本没有这个参数的引用**（`PARAMETER_REFERENCE = 0`）⇒ 不是「门槛没被触发」，而是「门槛不是参数」 |
| **D** Parameter Search 在构建输入时发生参数丢失 / 覆盖 / 错误映射 | ⚠️ **部分命中但责任方不同** | 参数在**PS 侧没有丢失**（逐跳证据见 §4）；丢失发生在**更上游**：候选草稿 → 策略文档时，阈值被**固化成了字面量**，声明的参数成为「死参数」 |

### 3.2 链路快照（真实对象，非推测）

```text
策略版本        cand-360001@1.0.0（documentFingerprint 见留档）
Core 可构造     ✅ ok（eventType=FIRST_LIMIT_UP, limitUpRatio=0.1）
parameterSchema ["max_drawdown", "max_volume_ratio", "require_bullish"]      ← 声明了 3 个
规则图 PARAMETER_REFERENCE = []                                              ← 引用了 0 个  🔴
规则图 FEATURE_REFERENCE   = []
实际决策引擎    strategy-core（Core 优先 ⇒ 配方 signalBuilder 被旁路）
A.experimentConfig.parameters = {"max_drawdown":0,   "max_volume_ratio":0.05, "require_bullish":0}
B.experimentConfig.parameters = {"max_drawdown":0.3, "max_volume_ratio":1,    "require_bullish":1}
```

### 3.3 A/B 真实执行（窗口 `2025-01-02..2025-02-28`，逐参数隔离）

| 参数 | A | B | 权益曲线点数 | 权益指纹 | tradeCount | 结论 |
|---|---|---|---|---|---|---|
| `max_volume_ratio` | 0.05 | 1.0 | 36 / 36 | `4c9f7a66cb21c94c` / **同** | 0 / 0 | **逐字节相同** |
| `max_drawdown` | 0.0 | 0.3 | 36 / 36 | `4c9f7a66cb21c94c` / **同** | 0 / 0 | **逐字节相同** |
| `require_bullish` | 0 | 1 | 36 / 36 | `4c9f7a66cb21c94c` / **同** | 0 / 0 | **逐字节相同** |

> 补充证据：三组的 `backtestFingerprint` **互不相同**（`b78b564d…` / `911c1d8b…` / `e456b28e…`），
> 因为指纹包含参数集 ⇒ **参数进了「身份」，没进「决策」**。这正是「声明面 ≠ 消费面」的精确刻画。

### 3.4 根因

1. **候选草稿本身是自洽意图的**：`research_strategy_candidate.parameterSpaceJson` 里逐参数写明了语义
   ——「`max_volume_ratio`：缩量阈值：决策日量能比 ≤ 该值才成立（0.3 = 相对首板日缩到 30% 以内）」；
   `entryRuleJson.extra.recipe.recipeId = first-limit-pullback-hold-shrink`，而该**注册配方**的门槛**确实按参数名绑定**：
   ```ts
   // server/research/patternLibrary/patterns/firstLimitPullbackHoldShrink.ts
   { kind: "lte", feature: "haircut",     bound: { kind: "parameter", parameter: "maxDrawdown"   }, label: "守线" },
   { kind: "lte", feature: "volumeRatio", bound: { kind: "parameter", parameter: "maxVolumeRatio" }, label: "缩量" },
   { … enabledWhen: { parameter: "requireBullish", operator: "gte", value: 1 } }
   ```
2. **但转成策略文档时阈值被固化成了字面量**：
   ```text
   definition.entry.conditions =
     [ { field: "bar.low",    operator: "GREATER_THAN_OR_EQUAL", value: "prefix.rd0.open",           valueType: "FIELD_REFERENCE" },
       { field: "bar.volume", operator: "LESS_THAN_OR_EQUAL",    value: "prefix.rd0.volume * 0.3",    valueType: "CONSTANT" } ]
   ```
   ⇒ Core 规则图里没有 `PARAMETER_REFERENCE`，`parameterSchema` 里的 3 个参数**没有任何消费者**。
3. **该生成路径的缺陷已于 2026-09-16 修复**（`BRIDGE-CONDITION-EXPRESSION-001`）：现在的
   `definitionBuild.ts#resolveConditionValueType` 会
   (a) 命中参数 code ⇒ 产出 **`PARAMETER_REFERENCE`**；
   (b) 遇到「算术表达式文本」⇒ **响亮拒绝**（不再静默降级为字符串常量）。
   ⇒ **未来**的转正不会再产生这类文档；**历史文档不可变**（`updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE`）。

---

## 4. 参数传递链逐跳核对（规格 §6）

| # | 跳 | 真实文件 | 真实函数／字段 | 参数是否保留 |
|---|---|---|---|---|
| 1 | PS 组合 → 覆写 | `server/research/parameterSearch/executor.ts` | 组合 `parameters` → `bridge.evaluate(parameters)` | ✅ 保留 |
| 2 | 覆写 → 评估端口 | `server/research/strategyEvaluation/backtestBridge.ts` | `evaluateStrategyParameters({ parameterOverrides })` | ✅ 保留 |
| 3 | 评估端口 → 装配 | `server/runWorkbenchAssembly/assemble.ts:672` | `recipeRuntime.resolveParameters(document.parameters, request.parameterOverrides)` ⇒ **`parameterSet`** | ✅ 保留（未知键**响亮拒绝** `RECIPE_PARAMETER_UNKNOWN` / `RECIPE_PARAMETER_NO_DEFAULT`） |
| 4 | 装配 → 决策源 | `assemble.ts:735-742` | `createCoreDecisionSource({ version, **parameterSet**, rankFeatureId, point, … })` | ✅ 保留 |
| 5 | 装配 → 运行配置 | `assemble.ts:784-793` | `experimentConfig.parameters = parameterSet` | ✅ 保留（实测 A/B 不同） |
| 6 | 决策源 → 运行时 | `server/strategyCore/production/coreDecision.ts` → `StrategyRuntime.evaluate(version, parameterSet, context)` | `parameterSet` | ✅ 传入 |
| 7 | **运行时 → 决策** | `server/strategyCore/ruleGraph.ts` 的规则图 + `parameterResolver` | 规则图的 `PARAMETER_REFERENCE` 节点 | 🔴 **本份文档为 0 个 ⇒ 参数未被消费** |
| 8 | 决策 → 撮合 → 权益 | `server/backtest/**`（`simulator/engine.ts` 等） | fills / equity | ✅ 无异常（正对照证明参数变化能改变 fills） |
| 9 | 权益 → canonical metrics | `server/backtest/backtestResult.ts#canonicalMetrics` | 六项标量 | ✅ 与 §3.3 一致 |
| 10 | metrics → PS 结果 | `server/research/parameterSearch/searchResult.ts#projectCanonicalMetrics` | 只读投影 | ✅ 保留 |

**结论**：丢失**不在** 1–6、8–10 任何一跳；第 7 跳不是「丢失」，而是**输入文档本身没有把参数接到规则图上**。

---

## 5. 正对照（决定性证据，规格 §5）

**做法**：以 `cand-360001@1.0.0` 的 canonical `definition` 为模板，**只改一条条件**：

```text
cond-2:  value "prefix.rd0.volume * 0.3" (CONSTANT)
      →  field "bar.volumeRatio" / operator LESS_THAN_OR_EQUAL / value "max_volume_ratio" (PARAMETER_REFERENCE)
```

（左值必须**同量纲**：`max_volume_ratio` 是比值，故左值取派生字段 `bar.volumeRatio` —— 与配方门槛 `volumeRatio <= maxVolumeRatio` 同义。）

**结果**（真实执行，同一策略 / 数据集 / 窗口 `2025-01-02..2025-02-28`）：

| 组合 | tradeCount | totalReturnPct | maxDrawdownPct | winRatePct | profitFactor | 权益指纹 |
|---|---|---|---|---|---|---|
| `max_volume_ratio = 0.05` | **0** | 0 | 0 | — | — | `3101836e1b1b20a0` |
| `max_volume_ratio = 1.0` | **8** | **−10.3587** | **10.5381** | **50** | **0.1719** | `09bf8b5a97cd44cc` |

⇒ **不同参数值 ⇒ 不同 fills ⇒ 不同 equity ⇒ 不同 canonical metrics**。
**执行链本身正确**；缺陷在「文档没有把参数接到规则图上」。

---

## 6. 修复（规格 §8）

### 6.1 Root Cause

> **「参数声明在策略 schema 里」≠「决策引擎会读它」。**
> `cand-360001@1.0.0` 声明 3 个 `TUNABLE` 参数，而 Core 规则图的 `PARAMETER_REFERENCE` 为 **0** ⇒
> 搜索这 3 维**不可能改变任何执行结果**，只会产出 N 组逐字节相同的行 + 为每组白付一次回测。

缺陷**分两层**，本任务只修**属于 Parameter Search 的那一层**：

| 层 | 状态 |
|---|---|
| **策略文档生成层**（候选 → 文档） | 已在 **2026-09-16**（`BRIDGE-CONDITION-EXPRESSION-001`）修好：支持 `PARAMETER_REFERENCE`、算术表达式**响亮拒绝**、不再静默降级。历史文档**不可变** ⇒ 不可回溯修复 |
| **Parameter Search 层**（本任务） | 原实现会**静默地**为一个「没有消费者」的参数建搜索空间 ⇒ **修复：拒绝把死参数当可搜索维度** |

### 6.2 Fix（新增护栏，不改 PS 架构 / 不改 API 形状 / 不改执行链）

1. **死参数筛查**（`searchSpace.ts` + `executor.ts` + `paramSearchRouter.ts`）
   - 判据来源 = **唯一权威收集器** `strategyCore/ruleGraph.ts#collectRuleParameterReferences`（入口规则图 + 出场规则图 + 声明式出场规则的 `parameterCode`）；
   - 未被引用的 `TUNABLE` 参数**排除出搜索空间**，并写明 `exclusionReason`（"策略规则图未引用该参数…"）；
   - 若排除后**无任何**可搜索参数 ⇒ **响亮拒绝**：
     `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`（附「用参数引用改写文档」的可执行修法）；
   - 决策引擎不可构造（存量 v1 文档）⇒ 如实标 `referenceCheckApplied = false` 并写入 run notes（**不假装查过**）。
2. **顺序纪律：`派生 → 覆盖 → 死参数剥离 → 校验`**
   - 实测踩到：显式搜索域覆盖**能**把死参数重新塞回搜索空间（三个死参数被覆盖后 `searchable` 又变 3 个）
     ⇒ 剥离必须在**覆盖之后**（`excludeUnreferencedDomains`）；
   - 给死参数赋**会变化**的搜索域（ENUM / RANGE）⇒ 响亮拒绝 `PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER`；
     赋 `FIXED`（单值）允许（只声明常量，不冒充搜索维度）但会被剥离。
3. **校验语义修正**：`TUNABLE 缺搜索域` 只在**无 `exclusionReason`** 时报错 ——
   首版把「刻意排除」也报成配置缺失，**掩盖了真正的死参数原因**（错误信息只说「缺少搜索域」，用户会去补搜索域而不是修文档）。

### 6.3 Regression Test（规格 §8 要求的「different parameter values → different runtime input / decision」）

| 测试 | 覆盖 |
|---|---|
| `tests/server/research/parameterSearch/parameterSearchEffectiveness.test.ts`（**16 用例**） | 死参数筛查（缺省不筛查 / 提供则排除 / 全空集合 = 实测形态 / 刻意排除不报 `TUNABLE_WITHOUT_DOMAIN` / 真配置缺失仍报错）；`excludeUnreferencedDomains` 行为；**覆盖顺序守卫**；窗口前置校验 4 例（合法 / 倒挂 / 起早 / 止晚，均断言信息含两个窗口）；**派生器单一静态守卫**（PS 不得 import 旧派生器 + 旧派生器必须带 `LEGACY / PREVIEW` 且点名消费者） |
| `docs/evidence/_probe_param002_parameter_sensitivity.mts`（Part 3） | **真机级**回归：同一文档改为参数引用后，A/B 的执行结果**必须出现差异**（实测 0 笔 vs 8 笔） |

### 6.4 Real E2E Evidence（规格 §8 末句）

`docs/evidence/_e2e_param002_parameter_effect.mts` — **真实 tRPC，13 项断言 0 失败**：

| 段 | 断言 | 结果 |
|---|---|---|
| ① N-02 负例：对「死参数」策略创建搜索 | 被拒 + 领域码 `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER` | ✅ |
| ② 自建「参数引用」策略版本（仅测试用，结尾自清） | `saveVersion` outcome = `inserted` | ✅ |
| ③ N-01 负例：`2020-01-01..2025-02-28` 越界 | 被拒 + 领域码 `PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE` + 信息含 `requested window = 2020-01-01..2025-02-28` 与 `dataset window = 2024-09-01..2026-09-01` | ✅ |
| ④ 正例：2 组合真实执行 | 死参数 `["max_drawdown","require_bullish"]` 被排除、`searchable=["max_volume_ratio"]`、组合数 = 2、**执行 21 s、2 成功 0 失败** | ✅ |
| ⑤ **结果差异** | `max_volume_ratio=0.05` → `totalReturnPct=0 / tradeCount=0`；`=1.0` → **`totalReturnPct=−10.3587 / tradeCount=8`**，两条结果去重后 = 2 | ✅ |
| ⑥ Resume | 二次 `start` ⇒ `evaluated=0 / skipped=2`，结果行仍为 2（无重复） | ✅ |
| ⑦ 自建自清 | 策略级联删除 + 三表按 `searchRunId` 删 ⇒ 残留全 0 | ✅ |

---

## 7. N-01 — 搜索窗口 Fail-Fast（FIXED）

| 项 | 实现 |
|---|---|
| 读窗口 | `persistence.ts#readDatasetVersionWindow(datasetVersionId)` —— **只读**，**不修改 Dataset**；`dataset_version.startDate/endDate` 是 **UTC 时间戳** ⇒ 按**北京业务日**（`+8h`）取 `YYYY-MM-DD` |
| 校验 | `executor.ts#assertSearchWindowWithinDataset`（**纯函数**）：`searchStart <= searchEnd` ∧ `searchStart >= datasetStart` ∧ `searchEnd <= datasetEnd` |
| 时机 | `createSearch` 在**派生 / 建组合 / 落库之前** |
| 拒绝 | `PARAMETER_SEARCH_WINDOW_INVALID`（倒挂） / **`PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE`**（越界） |
| 错误信息 | **必须同时含 `requested window` 与 `dataset window`**（否则用户只知道「失败」，不知道该把窗口收窄到哪里） |
| 单测 | 4 例（合法含两端 / 倒挂 / 起早 / 止晚，后两例断言两个窗口都在信息里） |
| 真机负例 | `_e2e_param002_parameter_effect.mts` 段 ③（真实 tRPC） |

**为什么值得修**：N-02 排查中实测「创建成功 → 4 个组合全部因窗口越界失败 → **62 s 白跑**」。

---

## 8. N-05 — 两套 Parameter Space 派生器的收敛状态

规格 §10 要求先判断「旧实现是否仍有真实消费者」。**实查结论：有**，因此按第一支处置（**保留 + 标记**）。

| 派生器 | 状态 | 消费者（实查） |
|---|---|---|
| `server/research/strategyEvaluation/parameterSpaceFromDocument.ts` | **`LEGACY / PREVIEW`**（文件头已标记 + 点名消费者 + 声明「PS 禁止回退到它」） | ① `server/paramSearchRouter.ts`（`describe` / `run` 的 effectiveSpace = **技术预览**端点）；② `server/research/closedLoopWiring/executors.ts`（**闭环 optimization 阶段**，14 阶段主链之一） |
| `server/research/parameterSearch/searchSpace.ts#deriveParameterSearchSpaceFromProjection` | **PARAMETER-001/002 唯一使用** | 仅 `parameterSearch/executor.ts` |

**为什么不能立刻收敛成一条**：闭环 `optimization` 阶段只持有 `document`，**拿不到** `strategy_parameters` 投影行（含 `parameterRole`）；而 role-aware 派生器要求投影。切换属于**主链改动**，按规格「不要为了代码整洁进行无意义重构」⇒ **登记为遗留**，并保留旧实现的既有语义（`tst` 覆盖其单测仍全绿）。

**已落地的收敛保证**（可执行事实，不是注释）：

- **静态源码守卫测试**：`server/research/parameterSearch/**` 一旦 import 旧派生器 ⇒ **测试立刻变红**；
- 断言 `executor.ts` 确实使用 role-aware 派生器（防「谁都没用」）；
- 断言旧派生器**带 `LEGACY / PREVIEW` 标记且点名两个消费者**（防被当死代码删除）。

> 目标「生产路径只有一个 Parameter Search Space 派生器」在 **PARAMETER SEARCH 域内已达成**；
> 全局唯一化需要改闭环 optimization 阶段（遗留）。

---

## 9. N-03 与性能（按规格保持不动）

- **N-03（`parameter_search_result.backtestRunId` 恒 NULL）**：**保持 DEFERRED**。当前可追溯坐标已足够：
  `搜索 Run（strategyId@strategyVersion + datasetVersionId + window + executionPolicyVersion + evaluationConfigFingerprint）`
  `+ 每组合 parameterHash + backtestFingerprint + evaluationId + evaluationRunId`。
  **本任务未对 Evaluation 主链做任何改动**（未制造 `backtestRunId`）。
- **性能**：**零改动**。未触碰 Backtest / Dataset / DB / StrategyRuntime 优化、未做并发、未改缓存架构。
  测试因性能耗时的部分（本任务共约 12 次真实回测，单次 12–21 s）**如实记录、继续执行、不改性能代码**。

---

## 10. 验收（规格 §13 逐项）

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| 1 | N-02 已确定属于 `VERIFIED_NOT_A_DEFECT` 或 `FIXED` | ✅ | **双侧**：PS 链 **VERIFIED_NOT_A_DEFECT**（§4 逐跳 + §5 正对照）；「死参数」这一**可修部分** **FIXED**（§6.2 护栏） |
| 2 | 参数实际进入 StrategyRuntime / Backtest 的证据 | ✅ | §3.2（`experimentConfig.parameters` A/B 不同 + 引擎 `strategy-core`）+ §5（参数变化 ⇒ 8 笔成交） |
| 3 | 至少一个参数敏感性真实实验 | ✅ | §5 正对照（0 笔 vs 8 笔，同策略/数据集/窗口） |
| 4 | N-01 fail-fast 完成 | ✅ | §7（纯函数 + 单测 4 例 + 真机负例 + 错误含两个窗口） |
| 5 | N-05 已明确收敛状态 | ✅ | §8（保留 + `LEGACY / PREVIEW` + 静态守卫测试） |
| 6 | N-03 保持 DEFERRED | ✅ | §9 |
| 7 | 无性能代码修改 | ✅ | §9（本会话未改任何性能相关文件） |
| 8 | 无历史 Run 修改 | ✅ | 只**新增**自建行并自清；`closed_loop_backtest_run` 只读 |
| 9 | 无历史 Evaluation 修改 | ✅ | 同上（evaluation 只在内存态产生，未写任何 Evaluation 留档） |
| 10 | 无 Dataset 修改 | ✅ | 只读 `dataset_version.startDate/endDate`；零迁移、零建表、零列改动 |
| 11 | 无新的 Backtest Domain | ✅ | 未新建 `backtest*` 任何目录；`server/backtest/**` 一行未改 |
| 12 | `tsc` 通过 | ✅ | `tsc --noEmit` **0 error** |
| 13 | Parameter Search 相关测试通过 | ✅ | 三文件 **84/84**（30 + 38 + 16）；**全量 vitest 失败文件集合 8→8 零新增**（17 用例；总数 4597） |
| 14 | 真实 E2E 通过 | ✅ | `_e2e_param002_parameter_effect.mts` **13/13 PASS**（含自建自清残留 0） |

**附带**：`node scripts/checkEolDrift.mjs` ⇒ **0 漂移**；前端可达性 `_probe_parameter_search_dom.mjs` ⇒ **pass=true**、0 page error（**无回归**）。

---

## 11. 行为变更与遗留

### 11.1 行为变更（🔴 新预期行为，**不是回归**）

| 端点 | 变更 |
|---|---|
| `paramSearch.createSearch` | 死参数策略 **会被拒绝**；窗口越界 **会被拒绝** |
| `createSearch` 的搜索空间覆盖 | 给死参数赋变化型搜索域 **会被拒绝**；赋 `FIXED` 允许但被剥离 |

⚠️ **后果**：对历史候选（`cand-3600xx`，参数全为死参数）创建搜索**会失败**；
`docs/evidence/_e2e_parameter_search.mts`（PARAMETER-001 的 E2E）**其 create 段现在会失败** ⇒
已在文件头加「已被本任务取代」说明并指向新 E2E。**这是护栏生效，不是链路坏了。**

### 11.2 遗留（如实登记）

1. **闭环 `optimization` 阶段仍用旧派生器**（`parameterSpaceFromDocument.ts`）——
   它只持有 `document`，切换需把 `parameterRole` 投影行引到该阶段（**主链改动**），不在本任务范围。
2. **历史策略文档不可变** ⇒ 现有 10 份候选文档的 TUNABLE 参数仍是死参数。
   要用参数搜索必须先以**参数引用**改写 `definition.entry.conditions` / `exit.rules` 并生成**新版本**。
3. **N-03**（`backtestRunId` 恒 NULL）保持 **DEFERRED**。
4. **前端未加「死参数」提示**：当前 create 失败信息已包含领域码与可执行修法（面板原样展示），
   但未在参数空间编辑器里**前置**标注「该参数未被规则图引用」。属体验优化，登记为后续。
5. `bar.volumeRatio` 这类**派生字段**与 `max_volume_ratio` 这类**比值参数**必须**同量纲**配对；
   写成 `bar.volume <= max_volume_ratio` 会**恒为假**（本次探针踩过）。文档作者需注意。

---

## 12. 架构基线变更

**版本动作**：`v1.1.0` → **`v1.1.1`（patch）** —— 依据：**实现细节 + 行为修正**，无 Domain 边界 / 主链 / 核心契约变化。
**未**触发任何 `GLOBAL AUDIT REQUIRED` 条目。

| 文件 | 变更 |
|---|---|
| `CHANGE-AUDIT.md` | **append** 2026-09-19 · PARAMETER-002（10 字段 + `GLOBAL AUDIT REQUIRED: NONE`，含行为变更登记） |
| `SYSTEM-BASELINE.md` | 版本 → `v1.1.1`；追加「PARAMETER-002 增量」节（行为变更 / N-01 & N-02 & N-05 状态更新 / 5 条新硬事实） |
| `system-manifest.yaml` | `parameterSearch.knownRisks` 由 6 条刷新为 9 条（N-02 定性、N-01 修复、N-05 收敛状态、死参数遗留）；`nextStage.blocking` 更新 |
| `ROADMAP.md` | §44 覆盖式（只保留最近 1 条，实测命中数 = 1）；§44.5 插入 `9bt` 完成条目；**编号台账两处同步**（文件头铁律行 + 台账行，`9bs` → `9bt`，下一个未占用 = `9bu`） |
| `ROADMAP-CHANGELOG.md` | **append** §47 记录（append-only） |
| `docs/evidence/README.md` | 登记本批 5 个探针 + 3 条真踩的坑 |
| `.workbuddy/memory/2026-09-19.md` | append 本任务一节 |
| `.workbuddy/memory/MEMORY.md` | 新增「Parameter Search 有效性（PARAMETER-002 实查）」硬禁令节 |
| **其余架构文档** | **未改**（无实际架构变化 —— 按规格 §16「只有实际架构发生变化时才修改其他 Architecture 文档」） |

---

## 13. 下一步

**按规格 §17：本任务完成后停止，不开始 Robustness。**

上游可据本报告决定进入 `ROBUSTNESS-001` / `OOS-001` / `WALK-FORWARD-001`；
前置条件见 §1.3（**满足**，附「历史候选文档需先改写为参数引用」这一操作前提）。
`system-manifest.yaml#nextStage.id` 保持 `ROBUSTNESS-PARAMETER-CONSUMPTION`（`status: PLANNED`）。

```text
PARAMETER-002 = COMPLETE
N-02 = 情况 D（参数未被执行链消费）→ 根因在策略文档；PS 链 VERIFIED_NOT_A_DEFECT，PS 侧护栏 FIXED
N-01 = FIXED
N-05 = 保留并标记 LEGACY / PREVIEW（收敛状态已明确）
N-03 = DEFERRED（不变）
```
