# PHASE-B-001 — Pattern Semantic Slot（Pattern 受控语义声明槽）· 实施报告

| 项 | 值 |
| --- | --- |
| 任务 | `PHASE-B-001 — Pattern Semantic Slot`（事项 `riwPtR`，`STRATEGY-EXTENSION-001` 第 3 阶段） |
| ROADMAP 编号 | **`9ca`**（原拟 `9bz`，因 A 补登 `9by`、R1 取 `9bz` 而顺移） |
| 前置 | `PHASE-A-001`（`9by`）· `PHASE-R1-001`（`9bz`）—— 均已 COMPLETE |
| 实施时间 | 2026-09-20 |
| 结论 | **实现完成、`tsc` 0 错、新增 26 例测试全过**；两项收尾未做（**全量回归**与**真实 DB 的 Research Run E2E**），见 §7 |

---

## 1. 目标与解法

**问题**：Research Semantic Directory（`FEATURE_VARIABLES` / `assertConditionFieldsKnown`）是封闭的。
Pattern 即使能在 `patterns/*.ts` 声明，也**无法表达一个 Core 尚未知道的新语义** ⇒ 想加一个新语义，
必须分别改 Research Engine、变量白名单、Analysis Engine、Strategy Engine、Candidate Builder 五处。

**解法**（B.2 的目标架构，已落地）：

```text
Pattern Semantic Declaration（纯数据）
        ↓  expandPatternSemantics()（唯一 Expander，shared/patternSemantics.ts）
    ExpandedSemantic[]（规范化 + 可用性 + 两侧投影元数据）
      ↙                                   ↘
Research 投影                          Strategy 投影
projectSemanticsToResearch()           projectSemanticsToStrategy()
（→ 观察日变量定义 → 目录 → 条件）      （→ 特征 + 阈值参数 + 可用性）
```

**唯一的门禁实例**：`server/research/patternLibrary/semanticRegistry.ts` ——
「收集 → 校验 → 展开 → 冻结」只发生一次，两侧只读同一份产物 ⇒ 物理上不可能双写 Semantic SoT。

## 2. 交付文件

| 文件 | 角色 |
| --- | --- |
| `shared/patternSemantics.ts`（新） | **语义词汇 + operator 白名单 + 声明类型 + 校验器 + 唯一 Expander**。零依赖纯函数，放 `shared/` 让研究侧与策略侧引用同一份词汇 |
| `server/research/patternLibrary/semanticRegistry.ts`（新） | 唯一 SoT 注册表：`patternId+version` 唯一、`semanticId` 全局唯一、产物深冻结、任何问题在**注册期**响亮抛 `PatternSemanticsError` |
| `server/researchEngine/semanticProjection.ts`（新） | Research 投影：声明 → `ObservationVariableDefinition`（含自己的 `resolve`），并做**两道可用性闸门** |
| `server/research/patternLibrary/strategyProjection.ts`（新） | Strategy 投影：声明 → 特征 + 比较方向 + 阈值参数名；**可用性由声明推导**（不再恒用 1990-01-01） |
| `server/research/patternLibrary/types.ts` | `TradingPatternSpec` 增可选 `semantics?: PatternSemanticsSection \| null` |
| `server/research/patternLibrary/patterns/firstLimitPullbackHoldShrink.ts` | 首板回踩模式新增 `semantics`（2 条声明，纯数据） |
| `server/researchEngine/variables.ts` | 目录新增**语义注入点**（`patternObservations`）：`hasObservation` / `observationOffsetOf` / `listObservations` / `resolveObservation` 四处 |
| `server/researchEngine/engine.ts` | `buildCatalog` 把投影结果注入目录（唯一人口） |
| `tests/server/research/patternLibrary/patternSemantics.test.ts`（新） | **26 例**验收测试（含两条可失败对照） |

**零 migration / 零新表 / 零新列 / 零新依赖。**

## 3. 逐条 Gate（B.13）

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Pattern 仍然纯数据 | ✅ | `shared/patternSemantics.ts` 全为类型 + 纯函数 + 常量；声明对象无函数 / 回调 / SQL |
| Semantic Declaration 建立 | ✅ | `PatternSemanticDeclaration`（含 `intent` 与 `strategyProjection`，均为纯数据） |
| Operator whitelist 建立 | ✅ | `SEMANTIC_OPERATORS` 16 项（EQ…PERCENT_CHANGE）；`isAggregatingOperator` 区分单点/聚合 |
| 唯一 Semantic Expander 建立 | ✅ | `expandPatternSemantics()` 是唯一展开入口；两侧投影只吃它的产物 |
| Research Projection 完成 | ✅ | `projectSemanticsToResearch()` + 目录注入；测试断言注入后**未声明的名字仍被拒** |
| Strategy Projection 完成 | ✅ | `projectSemanticsToStrategy()`；测试断言 `haircutFromEventLow` / `volumeRatio` 与阈值参数名 |
| Derived field bridge 完成 | ✅ | 同一声明同时产出研究变量名与策略 `featureId` / `thresholdParam`；一致性测试逐项对齐 |
| PIT 正向测试通过 | ✅ | `decisionOffset=2` 时 `pat_*_2d` 正常产出并可求值（`resolve` 取窗口 min） |
| PIT 负向测试通过 | ✅ | `decisionOffset=1` ⇒ 两侧均 `AFTER_DECISION_DAY`；`assertProjectionWithinDecisionDay` 在 `null` 时也抛（缺声明不放行） |
| Pattern immutability 测试通过 | ✅ | 深冻结断言 + mutate 抛错 + 值不变；重复注册 ⇒ `SEMANTIC_REDEFINITION`；跨 Pattern 抢 id ⇒ `SEMANTIC_ID_COLLISION` |
| Strategy Core execution 验证 | ✅（**核实，非新增**） | 见 §5：回落**不是静默的** |
| 首板回踩真实 E2E | ⚠️ **机制级通过，真实 DB Run 未做** | 见 §7 |
| 无双写 Semantic SoT | ✅ | 注册表唯一入口；`buildPatternSemanticEntries` 是唯一的「声明 → 展开」实现 |
| 无新的测试失败 | ⏳ 全量回归正在跑 | 见 §7 |
| `tsc` / build 通过 | ✅ | `tsc --noEmit` = **0 错 / exit 0** |
| EOL drift = 0 | ⏳ 待跑 | 见 §7 |
| 最终报告完成 | ✅ | 本文件 |
| ROADMAP 更新 | ✅ | `9ca` 条目 + 台账行 + 铁律行 + CHANGELOG |

## 4. 负向拒绝清单（B.12）

| 场景 | 判据 | 结果 |
| --- | --- | --- |
| 未知 field / 未知 source | `UNKNOWN_SOURCE` | ✅ 拒绝 |
| 未知 operator | `UNKNOWN_OPERATOR` | ✅ 拒绝（白名单外一律不行） |
| 聚合算子缺窗口 / 单点却给窗口 | `WINDOW_REQUIRED_MISSING` / `WINDOW_NOT_ALLOWED` | ✅ 拒绝 |
| 未来 availability | `AVAILABILITY_MISMATCHES_WINDOW` / `INVALID_AVAILABILITY` | ✅ 拒绝（`POST_BAR` 的 `availableFromOffset` 必须 == `windowDays`） |
| 返回来源当条件 | `OUTCOME_SOURCE_AS_CONDITION` | ✅ 拒绝（两侧都拒） |
| 非法 mutation | 深冻结 ⇒ `TypeError` | ✅ 拒绝 |
| 重复注册 / 抢 id | `SEMANTIC_REDEFINITION` / `SEMANTIC_ID_COLLISION` | ✅ 拒绝 |
| 语义当条件但无执行侧投影 | `MISSING_STRATEGY_PROJECTION` | ✅ 拒绝（不臆造执行口径） |

## 5. 🔴 更正上一轮（R1 期间）的一处判断：回落**不是静默的**

R1 审计时我根据「默认值 + 赋值」结构判断 `legacy-recipe` 存在**静默**回落路径。本轮**逐行复核后更正**：

- `server/runWorkbenchAssembly/assemble.ts:273` 的字段注释即写明「回落既有配方判定器，**原因写在
  `strategyDecisionEngineNote`，绝不静默**」；
- 两条回落分支（`:707` Core 定义不可构造 / `:747` Core 决策源构造失败）都写入**带原因的**
  `strategyDecisionEngineNote`（含 `recipeRuntime.recipeId`）；
- 该字段随装配结果返回（`:768-770`、`:974`）并被 `server/researchRunRouter.ts:687-688` **透出**。

⇒ B.10 的要求（「若发现 fallback：必须修复或明确阻断，不得静默接受」）**当前实现已满足**，
本阶段**不需要改**该处代码；本轮交付的是**核实结论**（附行号），并纠正先前的错误判断。

## 6. 🔴 `samePointAvailability` 的真实性质（B.8 点名的风险）

**实测**：`samePointAvailability(point)` 的 `availableAt.date` 与 `requiredDataThrough.date` **恒为
`1990-01-01`**（`server/research/recipeRegistryAtoms.ts:47-60`），而框架比较器 `compareDecisionTime`
**先比日期** ⇒ 对任何真实决策日都 `≤ 0` ⇒ `LeakageGuard` 对这些特征**永不报警**。

**定性**：这不是「漏洞」，而是**声明式设计的必然结果** —— 该可用性表达的是「该特征只读决策日当根
K 线，日期维度不设约束」，而逐行 PIT 由数据集（每行 `asOf === tradeDate`）与
`decisionBarOf(bars)`（只喂到决策根）保证。**测试用两条对照把这件事钉死**：

1. 用框架自己的 `compareDecisionTime` 断言：`1990-01-01` 对 `2026-09-18` / `2019-01-02` / `1990-01-01`
   全部 `≤ 0` ⇒ **守卫空转是可复现的事实**；
2. 而本阶段新增的 `availabilityFromDeclaredOffset(point, decisionDate, offset)` 用**真实决策日**，
   `compareDecisionTime` 在「声称晚于决策日才可知」时**返回 > 0** ⇒ 同一守卫**能**报警。

⇒ 结论：**旧的恒等下界不是缺陷但也不是约束**；本阶段把 Pattern 语义投影的可用性换成**真实决策日**，
并在**投影期**加了「`availableFromOffset ≤ 决策日偏移`」这条**可失败**的闸门（`AFTER_DECISION_DAY`）。
`samePointAvailability` 保留给「确实只读决策日当根」的既有特征，**未删除**（避免影响既有配方）。

## 7. 未完成（必须在合并前补，属**验证/登记**而非实现）

1. ✅ **全量 `vitest run`** = **7 失败文件 / 16 用例（286 文件 → 7 failed / 279 passed；4847 / 4863）** —— 失败集合与基线**逐个相同**（全为环境依赖）⇒ **零新增失败**；R1 的 `observationDecisionDay.test.ts` **12/12 继续全过**。
2. ✅ **`checkEolDrift.mjs --strict`** = **0 漂移 / exit 0**。
3. ✅ **真实 DB 的 Research Run E2E 已补跑通过**（给 R1 的六路探针加了一路）：实验 B（`experiment.config.decisionOffsetDays=2`）+ 条件 `pat_pullback_hold_depth_2d >= 0` ⇒ **COMPLETED**（run 1020006）。⇒ 「Pattern 语义声明 → 研究变量 → 真实 Run」这段端到端成立。以下为补跑前的记录：本轮做到「机制级 E2E」（真实注册表 → 两侧投影 → 逐项一致性
   + PIT 正负向，全部有测试），但**尚未**在真实数据集上跑一个「条件引用 `pat_pullback_hold_depth_2d`
   的 CONDITIONAL Run」。这与 R1 的 E2E 同构（R1 已建立可直接复用的驱动脚本），是合并前的硬 Gate。
4. ⬜ `pnpm run docs:tests` 重跑（新增测试后必须）。
5. ⬜ B.12 的 E2E 链路里 `→ Candidate` 一段属 **Phase D（`9cb`）**，本阶段不实现（D.2 的目标链路含
   Candidate Rule Derivation，与 B 的清单不重叠）。

## 8. 证据

| 文件 | 内容 |
| --- | --- |
| `_scratch/tsc_b*.txt` | 逐轮 `tsc` 读数（最终 0 错） |
| `_scratch/b_tests2.txt` | `patternSemantics.test.ts` **26/26 通过** |
| `_scratch/vitest_b_full.out.txt` | 全量回归读数（待回填） |
| 注册表实跑 | `listPatternSemantics()` ⇒ 1 条目 / `first-limit-pullback-hold-shrink@1.0.0` / fingerprint `356cfe56d447…`；展开 `pat_pullback_hold_depth_2d`、`pat_pullback_shrink_ratio_2d`（均 `OBSERVATION`，offset 2） |
| `.workbuddy/memory/2026-09-20.md` | 逐轮记录 |
