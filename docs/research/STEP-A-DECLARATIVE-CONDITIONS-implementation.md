# STEP A（`9aw`）· 打通「条件 → 回测信号」— 实施报告

> **任务 ID**：`9aw`（`ROADMAP.md` §44.5 既有待做条目「STEP A · 打通「条件 → 回测信号」」）
> **承接**：`docs/research/RESEARCH-PATTERN-LOOP-AUDIT-001.md` §3.1（P0-1 缺陷）/ §7（STEP A 计划）/ §10（3 条待决策）
> **完成时间**：2026-09-17
> **状态**：✅ 已完成 —— 验收五层全绿（`tsc` = 0 / 新单测 28-28 / 全量 8 failed 零新增 / `vite build` 成功 / 只读探针 4 项取证通过）
> **改动面**：`server/**` 575（+2）/ `shared/**` 1 改 / `tests/**` 251（+1）/ `client/**` 209（**零改动**）；零迁移、零新表、零新依赖、零新端点

---

## 1. 一句话结果

**策略文档里的 `definition.entry.conditions` 第一次真正成为回测信号。**

此前：条件在信号链上**零消费者**，装配层静默回落默认配方 `leader-candidate-baseline`（`pctChange` 加权取前 5 名）
⇒ 用户研究出「守线 + 缩量」，转正后点「运行回测」，跑的却是**另一个模式**，而**产物看起来完全正常**。

现在：装配层按三条诚实路径解析配方，其中「无 recipe 但声明了条件」这条路**现场编译成执行门槛**；
编译不出来的条件**一律响亮抛错并逐条列出**（哪里错、第几条、为什么），**绝不回落默认配方**。

---

## 2. 前置取证（先查真库，不靠推断）

动手前跑了两支**只读**探针，其中一支持续推翻了审计报告的隐含假设。

### 2.1 存量文档的真实形态（`docs/evidence/_probe_strategy_doc_conditions.mts`）

`strategy_versions` 全表 10 份文档，逐份读出 `recipe` / `definition.entry.conditions` / `parameters`：

| 文档 id | strategyId | status | hasRecipe | 条件数 | 条件形态 |
|---|---|---|---|---|---|
| `390001` | `cand-270001` | Validated | **false** | **2** | `bar.low >= prefix.rd0.open`（FIELD_REFERENCE）/ `bar.volume < prefix.rd0.volume`（FIELD_REFERENCE） |
| `420001`~`420007` | `cand-360001/2/4/5/6/7/8` | Draft | true | 2 | `bar.low >= prefix.rd0.open` / `bar.volume <= "prefix.rd0.volume * 0.3\|0.5"`（**CONSTANT 字符串 = 死写法**） |
| `360001` / `360002` | `limit-up-baseline` | Draft | false | **0** | —（参数 `topN` / `minScore`） |

**三条关键结论**：

1. **唯一「无 recipe 但有条件」的文档 = `390001`（`cand-270001@1.0.0`）** ⇒ 本次行为变化面**恰好 1 份**，不是一大片。
2. 那 7 份 `cand-3600xx` 虽同为「守线 + 缩量」，但**带 `recipe`** 且第二条条件是**转正期遗留的字符串常量表达式**
   ⇒ 它们**不走新路径**，所以不会从「能跑」变成「一跑就报错」。**这正是路径顺序约束的来源**（见 §4.2）。
3. 两份 `limit-up-baseline` 是**零条件** ⇒ 进不了新路径，仍走显式兜底。

### 2.2 上一轮审计的一处口径修正

审计报告 §3.1 把缺陷机理概括为「候选从不声明 recipe ⇒ 静默回落」。
实查后更精确：**候选草稿转正时确实会写 recipe**（7 份 `cand-3600xx` 都写成了
`first-limit-pullback-hold-shrink`），**真正没有任何 recipe 的是 `cand-270001`**
（一个 `Validated` 版本）。而它的条件恰好**能**被等价改写覆盖 ⇒ 修完立刻产生真实效果。

---

## 3. STEP A-1：声明式条件 → 执行门槛 编译器（唯一实现）

新增 `server/research/conditionSignal/`（2 文件）：

- `compile.ts`（399 行）— 编译器本体
- `index.ts`（14 行）— barrel

### 3.1 三张**闭集**表（表外一律抛错，不猜、不降级）

| 表 | 作用 | 内容 |
|---|---|---|
| 表 1 `DERIVED_FEATURE_BY_FIELD` | 派生字段 → 执行侧特征 id | `bar.haircutFromEventLow` / `bar.volumeRatio` / `bar.isBullish` / `bar.momentumFromEventClose` 四个**恒等映射** |
| 表 2 `GATE_KIND_BY_OPERATOR` | 运算符 → 门槛种类 | `>`→`gt`、`>=`→`gte`、`<`→`lt`、`<=`→`lte`、`=`→`eq`（`NOT_EQUAL`/`IN`/`NOT_IN` **无对应物 ⇒ 抛错**） |
| 表 3 `EQUIVALENT_REWRITES` | 原始行情写法的**可证明等价改写** | 8 条，见下 |

### 3.2 表 3 的等价改写（**方向会翻转**，本轮修掉的真实缺陷）

记号：`o0`/`v0`/`c0` = 首板日（`eventBaselineOf(bars)`）的开盘价 / 成交量 / 收盘价；
`low`/`volume`/`close` = 决策日同名字段。已注册配方的特征口径**逐字核实**于
`recipeFeatures/pullbackFeatures.ts`：`haircut=(o0−low)/o0`、`volumeRatio=volume/v0`、`momentum=close/c0−1`。

| 源写法 | 源运算符 | 数学等价 | 目标门槛 |
|---|---|---|---|
| `bar.low >= prefix.rd0.open` | `gte` | `haircut <= 0` | **`lte 0`** |
| `bar.low > prefix.rd0.open` | `gt` | `haircut < 0` | `lt 0` |
| `bar.volume <= prefix.rd0.volume` | `lte` | `volumeRatio <= 1` | `lte 1` |
| `bar.volume < prefix.rd0.volume` | `lt` | `volumeRatio < 1` | `lt 1` |
| `bar.volume >= prefix.rd0.volume` | `gte` | `volumeRatio >= 1` | `gte 1` |
| `bar.volume > prefix.rd0.volume` | `gt` | `volumeRatio > 1` | `gt 1` |
| `bar.close >= prefix.rd0.close` | `gte` | `momentum >= 0` | `gte 0` |
| `bar.close <= prefix.rd0.close` | `lte` | `momentum <= 0` | `lte 0` |

> 🔴 **实现教训（已写进代码注释与单测）**：初版把「源运算符」直接当成「目标门槛种类」用，
> 于是 `bar.low >= prefix.rd0.open` 译成 `haircut >= 0` —— **语义恰好相反**
> （那是「跌破首板开盘价」而不是「守线」）。
> 数据结构因此改为**源运算符 → 目标门槛**的显式映射（`targetBySourceKind`），
> 表里没有登记的方向 = 无等价改写 ⇒ 抛错。单测用「恰好守平通过 / 略微跌破剔除」把两个方向钉死。

### 3.3 右值三种（`PARAMETER_REFERENCE` 是「阈值来自参数」的正解）

- `CONSTANT`：必须是**有限数字**。字符串常量（如存量的 `"prefix.rd0.volume * 0.3"`）**拒绝**。
- `PARAMETER_REFERENCE`：右值必须是**该文档 `parameters` 里已声明**的 code；门槛在 `buildGates(parameters)` 时
  用 `requireNumericParameter` 取值（缺值 / 非有限 ⇒ **响亮抛错，不静默取默认**）。
  ⇒ 这是审计报告 gap #5「无法表达『阈值来自参数』」的正解。
- `FIELD_REFERENCE`：**只在表 3 的等价改写路径**允许（右值须逐字等于表的键的一部分）。

### 3.4 合成配方的身份

- `recipeId = "strategy-declared-conditions"`（自解释；**不注册进** `REGISTERED_RECIPES`）
- 关卡构造**复用** `recipeRegistry.makeStrategyRecipeRuntime`（本轮从注册表 `.map()` 里抽出具名函数）
  ⇒ 注册期校验（排序特征 / 门槛引用面必须真实产出）与运行时行为**逐字一致**，不产生第二套口径
- 特征提供器**复用** `buildPullbackFeatureProviders`（原 `buildPullbackFeatures`，本轮导出）
- `signalDescription` **只写门槛形状、不写参数取值**（避免「先建构造器再解析参数」的口径漂移）

---

## 4. STEP A-2：装配层三路径

改 `server/runWorkbenchAssembly/assemble.ts#requireRecipe`（另有 `shared/researchContracts.ts` 契约同步）。

### 4.1 三条诚实路径（优先级自上而下）

```
1. 文档带 recipe                        ⇒ 按注册表解析            recipeSource = "strategy-document"
2. 文档无 recipe 但声明了条件            ⇒ 现场编译成门槛           recipeSource = "strategy-declarative-conditions"  ← 新增
3. 两者都没有（无调用方指定）          ⇒ 显式兜底（默认常量）     recipeSource = "default-fallback"   ← BD-21 新增
3'. 两者都没有（有调用方指定 recipeId）  ⇒ 显式兜底（调用方指定）   recipeSource = "explicit-request"
```

`RecipeResolutionSource` 加第三值 `"strategy-declarative-conditions"`，
并同步 `shared/researchContracts.ts` 的 zod 闭集（否则 tRPC `.output()` 校验会拒掉新值）。

### 4.2 🔴 顺序约束（零回归，代码注释里标了「勿调换」）

**路径 1 必须先于路径 2。** 依据 §2.1 的实查：7 份 `cand-3600xx` 文档 `hasRecipe=true`
且其 conditions 里是**死写法的字符串常量**；若把条件编译提前到 recipe 之前，
这 7 份会从「能跑」变成「一跑就报错」—— 那是**把修缺陷变成了引入回归**。

### 4.3 「有没有条件」与「有没有**启用**的条件」的分工

装配层只判 `conditions.length > 0`（**有没有条件**）；
「有没有**启用**的条件」由编译器唯一裁定（`CONDITION_EMPTY`）。⇒ **只有一份口径**。

---

## 5. 交付物清单

| 文件 | 变化 | 说明 |
|---|---|---|
| `server/research/conditionSignal/compile.ts` | **新增**（399 行 / 18139 B） | 编译器唯一实现 |
| `server/research/conditionSignal/index.ts` | **新增**（14 行） | barrel |
| `server/research/recipeRegistry.ts` | 24794 → **26198 B**（509 → 541 行） | 抽出 `makeStrategyRecipeRuntime`；导出 `buildGatedRecipeRuntime` / `GatedRecipeDefinition` / `buildPullbackFeatureProviders` / `requireNumericParameter` |
| `server/runWorkbenchAssembly/assemble.ts` | 29491 → **31433 B**（575 → 614 行） | `requireRecipe` 三路径 + import + 类型 + 注释 |
| `shared/researchContracts.ts` | 45633 → **45889 B** | `assembly.recipeSource` zod 闭集加第三值 |
| `tests/server/research/conditionSignal/compile.test.ts` | **新增**（507 行 / 28 用例） | 行为断言（走 `SignalBuilder` 公开语义，不依赖内部表示） |
| `docs/evidence/_probe_step_a_declarative_recipe.mts` | **新增**（253 行，只读） | 验收取证探针 |

**行尾**：以上全部 **纯 LF**（逐文件实测 `crlf=0`）。`server/**` = 575（+2）、`tests/**` = 251（+1）、`client/**` = 209（零改动）。

---

## 6. 验收证据

### 6.1 五层验收

| 层 | 判据 | 结果 |
|---|---|---|
| 类型 | `tsc --noEmit` | **exit 0** |
| 聚焦单测 | `tests/server/research/conditionSignal/compile.test.ts` | **28 / 28** |
| 全量 | `vitest run`（251 files / 4172 tests） | **8 failed files / 17 failed tests** —— 与上一轮基线**逐项一致，本轮零新增** |
| 构建 | `vite build` | **成功**（15.16s / 2.75 MB JS） |
| 运行时取证 | `_probe_step_a_declarative_recipe.mts`（只读） | **4 项全通过**，见下 |

全量 8 个失败文件全部是既有基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` /
`marketData` / `tushare.secret` / `tushareTradingCalendar` 等需真库或外部凭证的集成测试）
+ `candidates.updateBoundary.test.ts`（`9at` 遗留的过期断言：`RESEARCH_CANDIDATE_IMMUTABLE_FIELDS` 已含
`sourceResearchPlanId` 共 7 项，测试仍期望 6 项）。
**改动面内的三个测试文件（`conditionSignal/compile` / `runWorkbenchAssembly/windowProjection` /
`runWorkbenchAssembly/universeConstraint`）全部 ✓。**

### 6.2 运行时取证（`_probe_step_a_declarative_recipe.mts`，输出落盘）

1. **影响面**：全库「无 recipe 但有条件」的文档 = **恰好 1 份**（`390001` / `cand-270001@1.0.0`，2 条条件）。
2. **编译语义（方向对）**：
   ```
   signalDescription = 由策略文档的声明式条件现场合成（共 2 条门槛）：haircutFromEventLow lte 0 且 volumeRatio lt 1
   probes = { 守线且缩量: true, 跌破开盘价: false, 放量: false }
   ```
   ⇒ `bar.low >= prefix.rd0.open` 编译成 **`haircut lte 0`**（不是 `gte 0`）；三支行为探针全部符合预期。
3. **装配层真的走了新路径**：
   ```
   recipeId = "strategy-declared-conditions"
   recipeSource = "strategy-declarative-conditions"
   recipeFeatureIds = [haircutFromEventLow, isBullish, momentumFromEventClose, volumeRatio]
   signalDescription = （与直编结果逐字一致）
   datasetSource = "rebuild" / datasetRowCount = 150 / datasetSecurityCount = 30
   ```
4. **负例（失败路径也证零新增）**：往文档里注入一条不可映射条件（`event.limitUpPrice GREATER_THAN 9999`）⇒
   ```
   threw = true, errorCode = "CONDITION_NOT_MAPPABLE"
   errorMessage = 装配层：策略 cand-270001@1.0.0 的条件无法全部编译成执行门槛。
                  无法映射的条件共 1 条（拒绝静默回落默认配方）：
                    1. 第 3 条条件 `event.limitUpPrice` GREATER_THAN —— 字段 event.limitUpPrice 既不是…
   ```
   ⇒ **响亮抛错、逐条定位到「第 3 条条件」、绝不回落默认配方**。

> 附：取证过程中发现错误消息里 `装配层：` 前缀重复出现两次（上层 message 与 `describeUnmappable` 各带一次），
> 已修掉并加了一条单测断言（`message.match(/装配层/g).length === 1`）防止漂回。

---

## 7. 边界与未做（如实）

- **未做端到端 `loopRun`**：`loopRun` 是同步长请求且会写 `closed_loop_backtest_run` 等表；
  本轮以「装配层真实路径 + 编译语义 + 负例」三层取证替代。**判据「同一数据集下 `loopRun` signals 与独立复算文档条件逐日一致」
  尚未以整链跑通形式验证**，属下一步。当前已有的替代证据是：装配层 `strategy13.signalBuilder` 的词条描述与
  「直编同一份文档」的结果**逐字一致**（§6.2 第 2、3 项）。
- **未回填存量数据**：`390001` 的运行时行为**会改变**（此前跑默认配方，现在跑文档声明的「守线 + 缩量」）。
  这是**期望的修正**，但没有改动任何库内数据；如需对照，请重跑该策略版本。
- **`AUDIT-DRS-001-EVIDENCE.md` / `candidates.updateBoundary` 过期断言**：不在本 STEP 范围，未动。
- **`client/**` 零改动**：前端「配方来源」展示仍只有两值文案（`shared` 契约已加第三值，但前端未消费 `recipeSource`）。
  当前不会显示错，只是新值在前端暂无专门文案 —— 归入后续体验收口（`9az`）。
- **未新端点**：探针直接 import 装配层，不经过 tRPC。

---

## 8. 后续（`ROADMAP.md` §44.5 的相邻条目）

| 编号 | 内容 | 与 STEP A 的关系 |
|---|---|---|
| `9ax` | STEP B · 让评价 / 绩效 / 参数真正共通复用 | 一并解 P0-2（`paramSearch`/`walkForward`/`marketRegime` 只调 legacy 回测） |
| `9ay` | STEP C · 交易模式单一声明库 `Pattern SoT` | **用户最终目标的落点**：新增一种模式 = 只加 1 个声明文件 |
| `9az` | STEP D · 正确性与体验收口 | 含 `OR`/`NOT` 静默压 AND、模式库页面、冷算阻塞、孤立模块接线 |

> 本轮把「**声明 → 执行**」这一段接通；要让「AI/vibecoding 加一种模式」成为可能，
> 还差 `9ay` 的**单一声明库**（一个模式一份声明，同时投影出研究侧与执行侧）。
