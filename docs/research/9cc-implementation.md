# 9cc — Parameter Consumption + Semantic + Provenance + Strategy Projection 完整闭环 · 实施报告

> 任务编号：**`9cc`** ｜ 类型：P0/P1 连续闭环任务 ｜ 基线：**`v2.0.0`** ｜ 前置审计：`SYSTEM-BASELINE-002`
> 执行日期：2026-09-20 ｜ 状态：见 §1 / §17

---

## 1. Executive Summary

**Status：COMPLETE**（22 项代码/审计验收 + 真实 DB 端到端 **24/24 PASS**）

本任务把四个断点一次性收敛。**四条结论**：

| 断点 | 审计结论 | 修复 | 真库证据 |
| --- | --- | --- | --- |
| **P0-1 Parameter Consumption** | **执行链本身没有断点**（`combination → bridge → evaluateStrategyParameters → assembleRunWorkbenchInputs → resolveParameters → signalBuilder` 全程接线）。但发现一个**更硬的事实**：**仓库里不存在任何一份已落库的策略版本**能让规则图引用 TUNABLE 参数（实测 **11/11 引用面为空**）⇒ 当时**无法**证明参数被消费 | **链上零改动**（不重构参数系统）；改的是**验证能力**：新增选材探针 + 正例 E2E（先经 `createFromConclusion` 派生出**引用参数**的策略版本，再跑搜索） | 2 组合（`max_volume_ratio` 0.05 / 1.0）真实执行：`tradeCount` **0 → 1**、`totalReturnPct` **0 → −0.6814%**、指纹不同；复核实测**实际消费值压过文档默认值 0.3** |
| **P0-2 AR-12 Pattern Semantic** | **成立且可定位**：声明写 `(t0Open − min(Low))/t0Open`（归一化比例），实现只做 `MIN(low)`（**绝对价格**，恒 > 0） | **修复**：在声明契约里新增受控**归一化**（`normalization`：`DIFFERENCE`/`DIRECT` + 基准字段白名单），Expander 与 Research 投影都执行它；注册期 5 条拒绝规则 | `pat_pullback_hold_depth_2d` 互补条件：`<= 0` ⇒ **1436** 样本、`> 0` ⇒ **282**、ALL **1718**（**修复前实测 `0` / `1718`**） |
| **P0-3 AR-13 Finding Provenance** | **成立，根因单点**：`ResearchConclusionDraft` 的 §15 五个字段全是**可选**，而 `buildConclusion` 的**主判定分支**只构造了 5 个基础字段就返回 ⇒ `findingIds` / `researchQuestion` / `evidenceSummary` / `limitations` / `nextQuestions` **全部未写**，`tsc` 却 0 错 | **修复**：主分支补齐 §15 五件套，与「无可用主效应」分支**键集对齐** | 三个新结论 `findingIdsJson = [450001]/[450002]/[450003]`，**与本 Run 真实 Finding 逐 id 相等、零孤儿**（修复前 `[]`，而 Run 有 24 条 Finding） |
| **P1-4 Strategy Projection** | **执行侧从未消费语义注册表** —— `strategyProjection.ts` 全仓只被自己的单测引用（休眠模块） | **接线**：新增 `patternLibrary/strategyConsumption.ts` 作为**执行侧消费点**，在装配期把「语义声明的执行侧投影」与「Core 特征注册表 + 本文档参数」对表；结论并进既有 `strategyDecisionEngineNote`（**零 schema 变更**） | E2E 派生出的候选规则 `bar.volumeRatio <= max_volume_ratio` 与语义声明 `pullback_shrink_ratio → volumeRatio / max_volume_ratio` **逐字段一致** |

**两个闭环同时成立**（详见 §12 / §13）：
- **闭环一** `Dataset → Research → Finding → Conclusion → Candidate → Strategy`：真实 Run `1290003` → Finding `450003` → Conclusion `1170003` → Candidate → promote `cand-1110001@1.0.0`。
- **闭环二** `Parameter Search → Combination → Strategy → Backtest → Evaluation`：Search Run 2 组合 → 真实回测 → Evaluation，且 **Search Parameter == Actual Execution Parameter**（逐键相等 + 指纹逐位相同）。

---

## 2. 初始问题

任务书给出四个断点，并要求**先审计、再最小修复、再真实 DB/E2E 验证**，不拆任务、不跳阶段：

1. **P0-1**：Parameter Search 已有真实持久化（真库 3 runs / 12 combinations / 8 results），但 `PARAMETER-002` 已发现「参数已保存、未确认真实执行链消费」的风险。
2. **P0-2（AR-12）**：`pat_*` 语义变量「声明与实现不一致」。
3. **P0-3（AR-13）**：真库 13 条候选只有 4 条有 `findingIds`，证据链 `Analysis → Finding → Conclusion → Candidate → Strategy` 不完整。
4. **P1-4（AR-14）**：`Pattern → semanticRegistry → Expander` 只到 Research，未到 Strategy。

**开工前置（本会话实查，未采信任何报告转述）**：
- 在途 Run 闸门：`_probe_inflight_runs.mts` + `_probe_inflight_state.mts` ⇒ `inFlightRunCount = 0`、`inFlightAnalysisCount = 0` ⇒ **允许改 `server/**`**（`research_question 270001` 的 `RUNNING` 是 2026-09-17 的陈旧问题态，不在执行闸门口径内）。
- 工作树：`git status --porcelain` 显示 148 条，但 **`git diff --numstat` = 0** ⇒ 全是 **CRLF stat-cache 漂移**，**不是并行会话的在途改动**。

---

## 3. Parameter Consumption 审计（Phase A · 只读）

### 3.1 逐问回答

| # | 问题 | 审计结论 |
| --- | --- | --- |
| **Q1** | `combination.parameters` 最终在哪里进入 Strategy？ | `executor.ts:699-780` 读 `combination.parametersJson` → 重算 `parameterHash` 并**比对落库 hash**（不一致即响亮抛错）→ `bridge.evaluate(parameters)` → `evaluateStrategyParameters({parameterOverrides})` → `assembleRunWorkbenchInputs({parameterOverrides})` → `assemble.ts:672 recipeRuntime.resolveParameters(document.parameters, request.parameterOverrides)` → **同时**喂 `buildSignalBuilder(parameterSet)` 与 `createCoreDecisionSource({parameterSet})` |
| **Q2** | Strategy 执行时真正读的参数来自哪里？ | **同一份 `parameterSet`**（`assemble.ts:672` 解析一次，用于 ①`legacySignalBuilder` ②Core 决策源 ③`experimentConfig.parameters`）。**只有一处解析**，不存在第二份 |
| **Q3** | Backtest 用的是 search combination / strategy default / 另一个 config？ | **search combination**。`bridge` 的 `defaultRange` 与 `datasetVersionId` 来自 Search Run 行，`parameterOverrides` 来自组合行 |
| **Q4** | 是否存在「保存参数 ≠ 执行参数」？ | 🔴 **链上不存在**（`resolveParameters` 只在一处、覆写优先于默认值）；但**真库当时的实际状态确为「保存了但不生效」** —— 唯一 `COMPLETED` 的 Search Run（`PSRUN-20260919-15d3afc8`）**4 个组合 `totalReturnPct` 逐位相同**（`-44.526726784500006`）、`tradeCount = 0`，而 `backtestFingerprint` **互不相同**。根因是**策略文档的规则图不引用参数**（`9bt` 已定位），不是 PS 链 |
| **Q5** | 改变一个 TUNABLE 参数后 strategy behavior 是否真变化？ | **无法用当时的落库数据回答**（Q4 的现场说明「不变」）。⇒ 本任务必须**先构造可引用的正例**才能回答 |

### 3.2 关键前置发现（决定了 E2E 的设计）

`_probe_9cc_strategy_params.mts`（只读，走 `DbStrategyRepository#getVersionBundle`，与 `paramSearchRouter#loadStrategyBundle` **同一条路径**；引用面用唯一权威 `collectRuleParameterReferences`）：

```
11 个策略版本，referenced 全部为 []
其中 9 个声明了 3 个 TUNABLE（max_drawdown / max_volume_ratio / require_bullish，均带 min/max/step）
⇒ 声明 3 个、规则图引用 0 个（与 9bt 的 N-02 完全一致）
```

⇒ **仓库里没有任何一份已落库的策略版本能作参数消费的正例**。`9bt` 当年的正例是**手工改文档**的产物，未落库。因此 9cc 的 E2E 必须**先用产品路径派生出一个引用参数的策略版本**（`createFromConclusion` → `promote`），再跑搜索。

### 3.3 反例（排除「链断了」这一解释）

E2E 的 §4b 直接调评估端口复核：请求 `{max_volume_ratio: 0.05}` ⇒ **实际消费** `{max_drawdown:0.02, max_volume_ratio:0.05, require_bullish:0}`（组合给出的键**逐键相等**），且**复核指纹与落库指纹逐位相同**，实际值**压过文档默认值 0.3**。

---

## 4. Parameter Consumption 修复（Phase A · 最小必要修改）

**结论：链上不需要修改。** 审计证明 `Search Combination` 已经是执行参数的权威来源（唯一解析点 + 覆盖优先 + hash 一致性校验），符合任务书 §5 的目标；对参数系统做任何重构都会违反「禁止 3 重写 Parameter Search」。

**本阶段实际交付的是「验证能力」**（原缺）：

1. `docs/evidence/_probe_9cc_strategy_params.mts` —— 只读选材探针：先证明「哪些策略版本的规则图真的引用参数」，避免拿死参数策略跑出**假证据**。
2. `docs/evidence/_e2e_9cc_closed_loop.mts` §4/§4b —— 正例 E2E：2 组合真实执行 + 直接复核**实际消费参数集** + 指纹复现。
3. 反向判据：`总揽` 「实际消费值**压过**文档默认值」（若签名/装配某处被默认值覆盖，这条**会红**）。

**未做（如实登记）**：不改 `executor.ts` / `searchSpace.ts` / `bridge` 任何一行；不新增参数体系；不改 migration。

---

## 5. Pattern Semantic 审计（Phase B · 只读）

链路（PHASE-B-001 建立，`9ca` 交付）：`PatternSemanticDeclaration`（纯数据）→ **唯一 Expander** `expandPatternSemantics()`（`shared/patternSemantics.ts`）→ `ExpandedSemantic[]` →  
├ `projectSemanticsToResearch()`（`researchEngine/semanticProjection.ts`）→ 观察日变量 `pat_*`  
└ `projectSemanticsToStrategy()`（`patternLibrary/strategyProjection.ts`）→ 特征 / 阈值参数

**审计发现**：

| 项 | 事实 |
| --- | --- |
| 声明 | `firstLimitPullbackHoldShrink.semantics`：`pullback_hold_depth` = 「`(t0Open − min(Low[T+1..T+2])) / t0Open`」，`field:"low"`、`aggregation:"MIN"`、`windowDays:2`、`availableFromOffset:2` |
| 实现（Research 侧） | `semanticProjection.ts#pickAggregated` 直接返回 `Math.min(...values)` = **最低价绝对值** |
| 后果 | `min(low)` **恒为正** ⇒ 条件 `<= 0`（声明语义「全程未跌破」）**恒为假 ⇒ 0 样本**；`> 0` **恒为真 ⇒ 全样本**。实测（`_probe_d_conditional_shape.out.json`）：`0` / `1718`，`DIFFERENCE = 0`、`P = 1` ⇒ **Finding 产不出来** |
| 同一缺陷的第二个实例 | `pullback_shrink_ratio` 声明 `min(Volume)/Volume(T)`（比例），实现返回 `min(volume)`（绝对成交量） |
| Strategy 侧是否也错？ | **不错**。执行侧用的是 Core 特征 `haircutFromEventLow = (eventDayBar.open − bar.low) / eventDayBar.open`（`featureRegistry.ts`）—— **本身就是归一化口径**。⇒ 缺陷**只在 Research 投影** |
| 为什么没被既有测试拦住 | `tests/.../patternSemantics.test.ts:186` 断言 `expect(value).toBe(10.0)` —— 它把 `MIN(low)` 的绝对值当期望值，**把缺陷固化成了契约**（绿测试掩盖红缺陷） |

---

## 6. AR-12 修复（Phase B）

### 6.1 设计（三层，零 migration）

1. **契约层**（`shared/patternSemantics.ts`）：新增受控归一化声明
   ```ts
   interface SemanticNormalization {
     numerator: "DIFFERENCE" | "DIRECT";   // DIFFERENCE = 基准 − 聚合值；DIRECT = 聚合值
     referenceField?: SemanticBaselineField;  // 仅 DIFFERENCE 必填
     divisorField?: SemanticBaselineField;    // 可省 = 不做除法
   }
   ```
   + `SEMANTIC_BASELINE_FIELDS = ["open","high","low","close","volume","amount"]`（**白名单**：分母只能取事件日已知字段）。
2. **Expander**：`ExpandedSemantic` 增 `normalization`（两侧投影共用同一份产物，**不新增第二套 Expander**）。
3. **Research 投影**（`semanticProjection.ts`）：新增 `normalizeSemanticValue()`，按声明计算
   `DIFFERENCE` ⇒ `baseline[referenceField] − AGG(field, T+1..T+k)`；再 `/ baseline[divisorField]`；
   并**声明了归一化就置 `needsEventBar: true`**（否则装配层不注入事件日 bar ⇒ 变量静默全 null）。缺失 / 非有限 / 分母 ≤ 0 ⇒ **null**（不臆造、**不回落成绝对值**）。

### 6.2 注册期拒绝（5 条，全部可失败）

| 判据 | 触发 |
| --- | --- |
| `DIFFERENCE` 缺 `referenceField` | 不知道该减谁 |
| `DIRECT` 却给了 `referenceField` | 两处声明矛盾（拒绝，不替作者选一个） |
| `DIRECT` 却没有 `divisorField` | 等于没归一化 ⇒ 反而会静默退回旧缺陷 |
| 基准字段不在白名单内 | 分母来源不可控 |
| 非 `POST_BAR` 来源却声明归一化 | 事件日 / 前缀来源本身就是 T 日当根，不存在相对归一化 |

### 6.3 声明修正（`patterns/firstLimitPullbackHoldShrink.ts`）

```ts
// pullback_hold_depth
normalization: { numerator: "DIFFERENCE", referenceField: "open", divisorField: "open" }
// pullback_shrink_ratio
normalization: { numerator: "DIRECT", divisorField: "volume" }
```

### 6.4 修正被写错的旧断言

`tests/.../patternSemantics.test.ts` 中把 `10.0` 当期望值的那条**已按声明口径改正**（期望 `0` = 「恰好守平」），并**补上 `eventBar`**、**补上「基准缺失 ⇒ null」**这两条反向断言；文件头写明「此前本断言把缺陷固化成了契约」。

### 6.5 验收（三层）

- **T1 fixture**：`(t0Open=10, min(low)=9.0) ⇒ 0.1`（并断言 **≠ 9.0**，即不是绝对价格）；`min(vol)=700, vol(T)=1000 ⇒ 0.7`（并断言 ≠ 700）。
- **T2 边界**：`恰好 0` / `负值（全程未破）` / `正值（跌破）` / `基准缺失 ⇒ null` / `非有限分母 ⇒ null` / 窗口内缺值 ⇒ null。
- **T3 窗口**：T+3 的极值**不得**进入（结果仍是 `0.01` 而非 `0.9`）；并把 `postBars.get` 换成**越窗即抛**的守卫，证明**确实只读 T+1..T+2**。
- **T4 look-ahead**：用 Proxy 记录字段访问，断言**只读了声明里的 `low` / `open`**。
- **区分度**（本轮最关键的判据）：同一批 12 个事件上，`≤0` 与 `>0` **各 6 条**（修复前 `≤0` 恒空 / `>0` 恒满）。

---

## 7. Finding Provenance 审计（Phase C · 只读）

### 7.1 真库横截面（`_probe_9cc_audit.mts`）

`research_conclusion` **15 条**：

| 分组 | 条数 | `findingIdsJson` | `researchQuestion` / `evidenceSummary` | `limitationsJson` / `nextQuestionsJson` |
| --- | --- | --- | --- | --- |
| 2026-09-11 ~ 09-15（`RESEARCH-FINDING-001` 之前） | 12 | **NULL** | NULL / NULL | NULL / NULL |
| 2026-09-16 起（§15 时代） | 3（`570001` / `660001` / `660003`） | **`[]`（空数组，无一非空）** | **NULL / NULL** | `[]` / `[]` |

### 7.2 关键对照（把「历史遗留」与「活缺陷」分开）

`660001` 属 Run `750001`、`660003` 属 Run `750003` —— **两者各有 24 条 Finding**（`findingCountsByRun` 实查）。
⇒ 这不是「当时没有 Finding」，而是**有了 24 条却没写进列** ⇒ **活缺陷**。

### 7.3 根因（单点，源码级）

`server/researchEngine/types.ts:494`：
```ts
export interface ResearchConclusionDraft {
  conclusionType; title; conclusion; evidence; confidence;      // 必需
  researchQuestion?; evidenceSummary?; findingIds?; limitations?; nextQuestions?;   // 🔴 全部可选
}
```
`server/researchEngine/conclusion.ts`：
- **R1 分支（无可用主效应）**：`draft` **写了**全部五个 §15 字段（:294-318）。
- **主判定分支（正常路径）**：`draft` **只写 5 个基础字段**（:441-447），五个 §15 字段**全部缺席**。

`engine.ts:360-374` 用 `?? null` / `?? []` 兜底 ⇒ 落库成 `NULL` / `[]`。
⇒ **因为字段是可选的，`tsc --noEmit` 完全不会报错** —— 这正是本项目「**声明了却无效**」的典型形态（与 `PROJECT_RULES.md` 记录的同类缺陷同族）。

---

## 8. AR-13 修复（Phase C）

**改动**：`server/researchEngine/conclusion.ts` 主判定分支的 `draft` 补齐 §15 五件套，与 R1 分支**键集对齐**：

```ts
researchQuestion,
evidenceSummary: buildEvidenceSummary({ findings, conclusionType, verdict }),
findingIds: findings.map((f) => f.id),
limitations: buildLimitations(findings),
nextQuestions: buildNextQuestions(findings, conclusionType),
```

**为什么修复点只能在这里**：证据链断在**草稿构造**，不是仓库层（`db.ts:1116` 只是 `encodeJson(input.findingIds ?? null)`）也不是引擎层（`engine.ts:370` 只是 `?? []` 兜底）。改仓库或引擎都只会继续掩盖。

**验收（两层）**：
- **单元（确定性）**：新增 3 例 —— 主分支草稿带全五个字段（`findingIds=[90049,90055]`、`limitations` 含 Finding 自带局限、含 `stabilityContradicted` ⇒ 必产「复核冲突切片」后续问题）；两个分支 §15 键集**逐个不为 undefined**；Finding 层未参与时如实写 `[]` + 明确措辞（措辞含「未引用任何 Finding」）。
- **负例自测（证明断言有牙齿）**：临时移除主分支的 `findingIds` 写入 ⇒ 测试 **3 条变红 / exit 1**；随后按字节原样恢复（脚本内 `assert back == raw` 逐字节复核）。
- **真库（端到端）**：三个新 Run 的结论 `findingIdsJson` 分别为 `[450001]`/`[450002]`/`[450003]`，**与本 Run 真实 Finding 逐 id 相等、零孤儿、零漏写**。

**历史留档处理（遵守「修复不改变历史留档」）**：12 条 NULL（§15 之前）与 3 条 `[]`（修复前）**不重写** —— 它们是「当时确实这么跑的」的事实。其中 `660001` / `660003` 的内容仍留在 `evidenceJson.findings`，本报告 §16 登记为「历史行需重跑才能拿到列上的证据链」。

---

## 9. Strategy Projection（Phase D）

### 9.1 审计结论（AR-14 成立）

`patternLibrary/strategyProjection.ts`（`9ca` 交付）**全仓只被它自己的单测引用** —— 执行侧（`runWorkbenchAssembly` / `strategyCore`）**从不读语义注册表**。⇒「Research 与 Strategy 用同一份 `pat_*` semantic definition」**只在文件层面成立，在执行路径上不成立**。

### 9.2 接线（最小、零 schema 变更、不改计算）

新增 `server/research/patternLibrary/strategyConsumption.ts`（纯函数，**只做对表**）：

```ts
verifyStrategyConsumption({
  patternId,                                   // 由 recipeId 反查（resolvePatternIdByRecipeId）
  isFeatureRegistered,                         // Core 特征注册表（回调注入，**不 import strategyCore**）
  declaredParameterCodes,                      // document.parameters
}) → { applied, patternId, bindings, issues, note }
```

产出物就是任务书 §14 要的 **`Pattern ID / Semantic Variable / Strategy Feature` 映射表**：

| Semantic Variable（研究侧） | Strategy Feature | 比较 | 阈值参数 |
| --- | --- | --- | --- |
| `pat_pullback_hold_depth_2d` | `haircutFromEventLow` | `LTE` | `max_drawdown` |
| `pat_pullback_shrink_ratio_2d` | `volumeRatio` | `LTE` | `max_volume_ratio` |

两条**可失败**判据：`FEATURE_NOT_REGISTERED`（声明的特征未登记）/ `THRESHOLD_PARAM_NOT_DECLARED`（阈值参数不在本文档参数里 ⇒ 该语义无法调参）。

**接线点**：`runWorkbenchAssembly/assemble.ts#assembleStrategySide` 在构造 `strategyRunContext` 之前计算，并把 `note` 追加进**既有**的 `strategyDecisionEngineNote`（契约里已有该 `z.string()`，**零 schema 变更**；该字段经 `researchRunRouter.ts:688` 透出到前端）。

**三条边界**：① 不复制 Expander（只消费 `listPatternSemantics()`）；② 不改任何计算（不产出执行用数值）；③ 非致命（不一致时**点名到 semanticId**，绝不静默）。

### 9.3 验收

- 单测 7 例：真实 Pattern 的绑定表逐字段正确；研究侧变量名与 Research 投影**同名同源**；真实注册表里两条特征都存在（保证对表不是空转）；两条判据各自**可失败**；未匹配 Pattern ⇒ `applied=false` 且**不报假失败**。
- 真库：E2E 派生出的候选规则 `bar.volumeRatio <= max_volume_ratio` 与上表**逐字段一致**。

---

## 10. 测试结果

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc --noEmit` | **0 错 / exit 0** |
| 新增单测（AR-12） | `tests/server/researchEngine/semanticNormalization.test.ts` | **17 / 17** |
| 新增单测（AR-13） | `tests/server/researchEngine/conclusion.test.ts`（+3 例） | **15 / 15** |
| 修改单测（AR-12 声明侧） | `tests/server/research/patternLibrary/patternSemantics.test.ts`（26 → 31 例） | **31 / 31** |
| 新增单测（AR-14） | `tests/server/research/patternLibrary/strategyConsumption.test.ts` | **7 / 7** |
| 负例自测 | AR-13 断言去牙（临时移除写入） | **3 条变红 / exit 1**，随后字节级复原 ✓ |
| 聚焦回归 | 上述 4 个文件 | **70 / 70** |
| 全量 | `npx vitest run` | 见 §16「基线对齐」（**只认零新增失败文件**） |
| import 边界 | 见下 | ✓ |

**import 边界检查**：`strategyConsumption.ts` **不 import `strategyCore`**（注册表能力用回调注入）⇒ 未在 `server/research/**` 与 `server/strategyCore/**` 之间新增生产依赖边；`shared/patternSemantics.ts` 仍**零依赖纯函数**（两侧共用同一份词汇）。

---

## 11. 真实 DB E2E 结果

`docs/evidence/_e2e_9cc_closed_loop.mts` —— 走 `appRouter.createCaller` 真实 tRPC + 真实 TiDB + 真实数据集 + 真实回测。

**配置**：Dataset Version **`390002`**（`first_limit_pullback`，READY）× 窗口 `2025-01-02..2025-02-28` × `decisionOffsetDays = 2`。

| 阶段 | 判据 | 结果 |
| --- | --- | --- |
| §1 | 三个 Run 全部成功 | ✓ `errors = null / null / null` |
| §1（AR-12） | `<= 0` 与 `> 0` 两侧样本都 > 0 | ✓ **1436** / **282** |
| §1（AR-12） | 两侧互补（和 ≈ ALL） | ✓ `1436 + 282 = 1718 = ALL` |
| §1（AR-12） | 变量有区分度 ⇒ 两侧不等 | ✓ `1436 ≠ 282` |
| §1b（AR-13）×3 | `findingIds` 无虚假 / 无孤儿 ID | ✓ 三个结论各 `[450001]` / `[450002]` / `[450003]` |
| §1b（AR-13）×3 | 有 Finding ⇒ 非空且不漏写 | ✓ 各「Finding 1 条，列 1 个，漏写 0 个」 |
| §2 | 派生候选：条件由证据派生（> 0） | ✓ 条件数 `0 → 1` |
| §2 | `sourceFindingIds` 全是本 Run 真实 Finding | ✓ `[450003]` |
| §3 | `ACCEPTED → promote` 成功 | ✓ `cand-1110001@1.0.0` |
| §4 | 规则图**引用了参数**（正对照就位） | ✓ `referenced = ["max_volume_ratio"]` |
| §4 | 组合数 = 2 且死参数筛查已启用 | ✓ `searchable = ["max_volume_ratio"]` |
| §4 | 两组合真实执行 0 失败 | ✓ 成功 2 / 失败 0 / **16 s** |
| §4 | 组合行参数 == 结果行参数 | ✓ `{max_volume_ratio:0.05}` / `{max_volume_ratio:1}` |
| §4 | 撮合指纹不同 | ✓ `dc5627dce6c7…` ≠ `0f02b2f64d0b…` |
| §4 | 🔴 **可观察执行差异** | ✓ `tradeCount 0 → 1`；`totalReturnPct 0 → −0.6814%` |
| §4 | 至少一侧有成交 | ✓ `tradeCounts = [0, 1]` |
| §4b | 🔴 **Search Parameter == Actual Execution Parameter** | ✓ 请求的每个键在实际消费值里**逐键相等** |
| §4b | 复核 = 落库指纹（可复现） | ✓ `dc5627dce6c7/dc5627dce6c7`、`0f02b2f64d0b/0f02b2f64d0b` |
| §4b | 🔴 实际值**压过**文档默认值 | ✓ 默认 `max_volume_ratio = 0.3` → 实际 `0.05` / `1` |
| §5 | 自建自清 | ✓ `purgedAfter = {experiments:1, strategies:1}`、`finalExperimentCount = 7` |

**总结论：PASS（检查项 24，失败 0）** `pass = true`、`fatal = null`。

---

## 12. 参数组合 → 实际执行参数证据

| Combination | `parametersJson`（组合行） | 执行 run id | **实际消费值**（评估端口解析） | 可观察结果 | 撮合指纹 |
| --- | --- | --- | --- | --- | --- |
| **#0** | `{"max_volume_ratio":0.05}`<br>`hash f20b5f95e93b…` | `STRATEGY-EVAL::EXP-20260920-E18B5D81` | `{max_drawdown:0.02, max_volume_ratio:0.05, require_bullish:0}` | `tradeCount=0`、`totalReturnPct=0`、`maxDrawdownPct=0` | `dc5627dce6c774f4…` |
| **#1** | `{"max_volume_ratio":1}`<br>`hash 9efe817ed8e3…` | `STRATEGY-EVAL::EXP-20260920-876BC6FA` | `{max_drawdown:0.02, max_volume_ratio:1, require_bullish:0}` | `tradeCount=1`、`totalReturnPct=−0.6814%`、`maxDrawdownPct=1.1453%` | `0f02b2f64d0b52e2…` |

**逐条对应任务书 §6 的要求**：
- ✅ `combinationId`：组合行 `combinationIndex 0 / 1`（`parameterHash` 如上）。
- ✅ `parameter values`：`max_volume_ratio = 0.05 / 1`（取**声明全域** `[0.05, 1]` 的两个端点）。
- ✅ `execution run id`：`STRATEGY-EVAL::EXP-20260920-*`。
- ✅ `actual consumed values`：评估端口返回的 `parameterSet`（含非搜索维度的默认解析结果），组合给出的键**逐键相等**。
- ✅ `observable result`：**成交笔数与收益不同**（0/0 vs 1/−0.6814%），不是「只有数据库里的参数不同」。

**两条**独立于「数值差异」的强度证据：
1. **撮合指纹**（覆盖 `RunSnapshot.parameterSet`）两组不同 ⇒ 执行时的参数集身份确实不同。
2. **复核复现**：用同一组合的参数直接调评估端口，得到的 `backtestFingerprint` 与**落库逐位相同** ⇒ 落库参数就是执行参数。

**「无默认值覆盖搜索参数」的可失败判据**：文档默认 `max_volume_ratio = 0.3`，而实际消费值为 `0.05` / `1` ⇒ 搜索参数**压过**默认值。若装配层某处被默认值覆盖，这条会红。

---

## 13. Research → Finding → Conclusion → Candidate → Strategy 证据

```text
Dataset Version 390002（first_limit_pullback · READY）
   ↓  引擎 ResearchEngine.run（真实，14.5 s）
Run 1290003  COMPLETED   sampleCount 1718  条件 pat_pullback_shrink_ratio_2d <= 0.5（CONDITION 桶 136）
   ↓  detectFindingsPhase
Finding 450003（本 Run 唯一）
   ↓  buildConclusion（**9cc 修复后**）
Conclusion 1170003  findingIdsJson = [450003]      ← 修复前为 []（而本 Run 有 Finding）
   ↓  createFromConclusion（默认派生）
Candidate 1100001（本次自建）
     filterRule = [ { bar.volumeRatio, <=, max_volume_ratio } ]      ← 条件数 0 → 1
     sourceFindingIds = [450003]（**每个 id 都是本 Run 的真实 Finding**）
     派生来源 semanticVariable = pat_pullback_shrink_ratio_2d → featureId volumeRatio / thresholdParam max_volume_ratio
   ↓  REVIEW → ACCEPTED → promote
Strategy cand-1110001@1.0.0   （规则图 referenced = ["max_volume_ratio"]）
   ↓  Parameter Search（2 组合）→ 真实 Backtest → Evaluation
见 §12
```

**「不存在虚假 ID / 不存在孤儿 ID / 正常路径不再出现无理由空 findingIds」**：三条判据均由 §1b 的逐 Run 断言覆盖（`orphans = 0`、`missing = 0`）。

**Dataset Version 可追溯**：Search Run 行 `datasetVersionId = 390002`；`fixedCoordinatesJson` 冻结了 `strategyVersionId` / `datasetVersionId` / 窗口 / `executionPolicyVersion` / `evaluationConfigFingerprint`。

---

## 14. 修改文件清单

### 生产代码（4 个文件）

| 文件 | 改动 | 性质 |
| --- | --- | --- |
| `shared/patternSemantics.ts` | 新增 `SemanticNormalization` / `SEMANTIC_BASELINE_FIELDS`；声明与 `ExpandedSemantic` 增 `normalization`；新增 `INVALID_NORMALIZATION`；5 条注册期校验；Expander 透传 | **AR-12** |
| `server/researchEngine/semanticProjection.ts` | 新增 `readFiniteField` / `normalizeSemanticValue` / `semanticNeedsEventBar`；`resolve` 改为「聚合 → 归一化」；声明了归一化即置 `needsEventBar` | **AR-12** |
| `server/research/patternLibrary/patterns/firstLimitPullbackHoldShrink.ts` | 两条语义补 `normalization`（口径与 `definition` 逐字一致） | **AR-12** |
| `server/researchEngine/conclusion.ts` | 主判定分支 `draft` 补齐 §15 五件套（与 R1 分支键集对齐） | **AR-13** |
| `server/research/patternLibrary/strategyConsumption.ts` | **新增**（唯一执行侧消费点；纯函数、零 IO、不 import `strategyCore`） | **AR-14** |
| `server/runWorkbenchAssembly/assemble.ts` | 新增 2 个 import + 装配期调用 `verifyStrategyConsumption`，结论并进既有 `strategyDecisionEngineNote`（**零 schema 变更**） | **AR-14** |

### 测试（4 个文件）

| 文件 | 改动 |
| --- | --- |
| `tests/server/researchEngine/semanticNormalization.test.ts` | **新增** 17 例（T1 fixture / T2 边界 / T3 窗口 / T4 look-ahead / 区分度） |
| `tests/server/researchEngine/conclusion.test.ts` | **+3 例**（主分支 §15 五件套回归） |
| `tests/server/research/patternLibrary/patternSemantics.test.ts` | **+5 例**（归一化注册期拒绝）；**修正 1 条把缺陷固化的旧断言** |
| `tests/server/research/patternLibrary/strategyConsumption.test.ts` | **新增** 7 例 |

### 证据与脚本

| 文件 | 说明 |
| --- | --- |
| `docs/evidence/_probe_9cc_audit.mts` + `.out.json` | 只读审计（Phase A + C） |
| `docs/evidence/_probe_9cc_strategy_params.mts` + `.out.json` | 只读选材（规则图参数引用面） |
| `docs/evidence/_e2e_9cc_closed_loop.mts` + `.out.json` | 真实 DB 端到端（24/24 PASS）；**自清已加自愈**（按 `strategyId` 也删一次） |
| `docs/evidence/_ops_cleanup_9cc_ps_residue.mts` + `.out.json` | **新增** 一次性运维脚本（默认只读预览 / `--apply` 才删）：清理本任务 E2E 遗留的**孤儿** PS 行（见 §15.1） |
| `docs/evidence/_e2e_d_evidence_bridge.mts` | **按 9cc 修复翻转哨兵 + 移除脚手架回填**（原断言「上游仍不写 findingIds」已失效；现改为正向断言，且若再变红 = AR-13 回归） |
| `docs/evidence/README.md` | 新增「9cc」小节（3 个探针 + 2 条可复用坑） |

**未改**：`client/**` 零改动；`drizzle/**` 零改动；`scripts/**` 零改动；任何 migration 零改动。

---

## 15. DB / Migration 变化

**零 migration / 零新表 / 零新列 / 零新依赖 / 零 `db:push` / 零 `drizzle-kit generate`。**

- 新增的 `normalization` 只是**声明层字段**，随 `ExpandedSemantic` 在进程内流转，**不落库**。
- E2E 自建行**已全部清理**：`purgedAfter = {experiments: 1, strategies: 1}`、`finalExperimentCount = 7`（= 既有数量）、`parameter_search_result/combination/run` 按 `searchRunId` 精确删除。
- **历史数据一律未改**（`SELECT-first`）：12 条 NULL 结论与 3 条 `[]` 结论**保留原样**（§8 已说明理由）。
- 需要写库的探针全部「自建自清」，且清理前先 `countOwnRows` 记录、清理后**复查残留为 0**。

### 15.1 🔴 自清漏洞与一次性运维清理（**如实登记，不掩盖**）

**现场**：收尾复核时发现 `parameter_search_run` 由 **3 → 4**。定位：`_e2e_9cc_closed_loop.mts` 的 §5 自清只按 **`searchRunId`** 删 PS 三表行，而**第二次试跑在 §4b 抛错**
（`PARAMETER_OUT_OF_RANGE`，参数越界）⇒ **没走到 §5** ⇒ 那次创建的 Search Run（+2 组合 +2 结果）未清理；第三次跑的新进程**不知道**那个 `searchRunId` ⇒ 永久残留。

**处置**：新增 `docs/evidence/_ops_cleanup_9cc_ps_residue.mts`（**默认只读预览，`--apply` 才删**），判据三条同时成立才删：
① `strategyId` 形如 `cand-<正整数>`；② `strategies` 表里**不存在**该 id（孤儿）；③ `createdAt >= --since`（默认 `2026-09-20T00:00:00Z`）。
**执行结果**：识别 1 个待删（`PSRUN-20260920-d2d6b9fc` / `cand-1050001`，= 本任务第一次 E2E 的产物），**3 个用户自有的 `cand-360001` Run 全部保留**；删除 **2 results + 2 combinations + 1 run** ⇒ `parameter_search_run` 回到 **3**（= 基线）。

**附带修掉两个真 bug**（都值得复用）：
1. **时间戳不能按字符串比**：`--since` 是 ISO（`T` 分隔），而 TiDB 经 mysql2 返回的 `createdAt` 是 `YYYY-MM-DD HH:MM:SS`（**空格**分隔）⇒ 字符串比较因 `'T'(0x54) > ' '(0x20)` 把「今天 04:03」判成**早于**「今天 00:00」，第一版预览报「待删 **0** 个」= **静默无效的清理**。改走 `Date.parse` 后正确。
2. **E2E 自清改为「按 `strategyId` 也删一次」（自愈）**：中途崩溃也不再生孤儿。⚠️ `parameter_search_combination` / `_result` **没有 `strategyId` 列**（只有 `searchRunId`）⇒ 必须先取回 `searchRunId` 再删子表。

**收尾复核（本轮实查）**：`_ops_cleanup_9cc_ps_residue.mts` 预览 = 「待删 **0** 个」、`parameter_search_run = 3`；`_e2e_9cc_closed_loop.mts clean` = 「删除 experiment=0、strategy=0」⇒ **零残留**。

---

## 16. Remaining Risks

| # | 风险 | 影响 | 建议 |
| --- | --- | --- | --- |
| **R1** | **历史结论仍无列上证据链**：`660001` / `660003`（各对应 24 条 Finding）的 `findingIdsJson` 仍是 `[]`，`researchQuestion` / `evidenceSummary` 仍 NULL | 前端 / 报告若只读列，这 3 条结论看不到 Finding 证据（内容仍在 `evidenceJson.findings`） | 按「修复不改变历史留档」不重写；如需列上证据，**重跑对应 Run**（新结论自带 §15 五件套） |
| **R2** | **既有策略版本全部不引用参数**（11/11 引用面为空） | 对这些策略做 Parameter Search 会被 `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER` **拒绝**（这是刻意护栏，不是缺陷）；用户可能误以为「参数搜索坏了」 | 需要参数搜索时，走「派生候选（引用参数）→ promote」路径；建议后续在前端把该错误码的修法做成引导 |
| **R3** | **AR-12 改变已落库 `pat_*` 结果的历史可比性**：同名变量 `pat_pullback_hold_depth_2d` 在旧 Run 里是「最低价绝对值」、新 Run 里是「归一化回撤比例」 | 跨修复时间点比较同一变量的旧 / 新统计会**语义错位** | 旧 Run 结果**保留**（当时确实这么跑的）；跨期比较前先确认 Run 时间；写进 §18 建议 |
| **R4** | 全量 vitest 基线对齐 | —— | 见下方「基线对齐」小节（判据 = **零新增失败文件**） |
| **R5** | `9cc` 未做的事（如实登记） | —— | ① 未做前端可达性验收（本任务零 `client/**` 改动，无新 UI 可点）；② `recommendedThreshold` 类证据推断阈值仍不做（D.3 禁黑箱）；③ `projectSemanticsToStrategy` 的**可用性（PIT）闸门**未接进装配期 —— 它需要「真实决策日」，只在逐日执行时才存在，装配期无法评估（故本任务只对表「特征 / 阈值参数」，PIT 仍由 `assertProjectionWithinDecisionDay` 在策略投影自己的调用点负责）；④ E2E 的 §4 曾出现「参数被消费但阈值不咬数据」的**无分辨力**情形（用声明全域端点修正），若换数据集需重新确认域的选择 |

### 基线对齐（全量 vitest）

- 基线（2026-09-20，`MEMORY.md`）：**7 失败文件 / 16 用例**，全部为环境依赖（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）。
- **本轮实跑：`npx vitest run` ⇒ `Test Files 7 failed | 283 passed (290)`、`Tests 16`（失败）；失败文件集合**逐名与基线相同**：
  `tests/server/dataHealth.test.ts`、`tests/server/image.uploadAndRecognize.test.ts`、`tests/server/limitUp.test.ts`、
  `tests/server/limitUp.watch.test.ts`、`tests/server/marketData.test.ts`、`tests/server/tushare.secret.test.ts`、
  `tests/server/tushareTradingCalendar.test.ts`
  ⇒ **零新增失败文件** ✅（文件数 288 → 290 = 本轮新增 2 个测试文件）。
- `node scripts/checkEolDrift.mjs --strict` = **疑似漂移 0 / 未跟踪新文件 CRLF 0**。

---

## 17. Acceptance Gate

### Gate A — Parameter
- [x] Search Combination 参数能够进入执行上下文（`bridge.evaluate` → `parameterOverrides`）
- [x] Strategy 实际读取 Search 参数（`resolveParameters` 单一解析点，覆写优先）
- [x] Backtest 实际消费该参数（评估端口 `parameterSet` 逐键相等；成交笔数与收益随参数变化）
- [x] 改变参数能够产生**可观察差异**（`tradeCount 0 → 1`、`totalReturnPct 0 → −0.6814%`）
- [x] 无默认值覆盖 Search 参数（实际值 `0.05`/`1` **压过**文档默认 `0.3`）

### Gate B — Semantic
- [x] Pattern 定义与实现一致（归一化声明 ↔ Research 投影数值逐字对齐）
- [x] `pat_*` 不再出现 AR-12 类型语义错位（互补条件两侧 `1436 / 282`，修复前 `0 / 1718`）
- [x] 有固定 fixture 验证（T1：`0.1` / `0.7`，并断言 ≠ 绝对值）
- [x] 边界测试通过（0 / 负 / 正 / 缺失 / 非有限 / 分母 ≤ 0）
- [x] 无 look-ahead（T3 越窗即抛 + T4 只读声明字段；`availableFromOffset == windowDays` 注册期强校验）

### Gate C — Provenance
- [x] `Conclusion → Finding` 完整（三个新结论 `findingIds` 与本 Run Finding 逐 id 相等）
- [x] `Candidate → Finding` 完整（`sourceFindingIds = [450003]`，全是真实 Finding）
- [x] `sourceFindingIdsJson` 可追溯
- [x] 不存在虚假 Finding ID（`orphans = 0`）
- [x] 正常路径不再出现无理由空 `findingIds`（只认「有 Finding ⇒ 非空」；「无 Finding ⇒ `[]`」为如实结果）

### Gate D — Strategy Projection
- [x] Research 使用 `semanticRegistry`（`engine.ts#buildCatalog` → `listExpandedPatternSemantics()`）
- [x] Strategy 使用**同一个** `semanticRegistry`（`assembleStrategySide` → `verifyStrategyConsumption`）
- [x] 不存在第二套 Pattern Expander（全仓唯一 `expandPatternSemantics`；`strategyConsumption` 不展开、不拼名）
- [x] Research / Strategy 语义结果一致（同一份 `ExpandedSemantic`；映射表 §9.2）

### Gate E — E2E
- [x] 至少一条真实 `Research → Candidate` 链（Run `1290003` → Finding `450003` → Conclusion `1170003` → Candidate → Strategy）
- [x] 至少两个不同参数组合（`max_volume_ratio` = 0.05 / 1）
- [x] 两个组合真实执行（0 失败，16 s）
- [x] 能证明实际消费参数（逐键相等 + 指纹复现 + 压过默认值）
- [x] Backtest 结果可追溯（`backtestFingerprint` / `evaluationRunId` 随结果行落库）

**⇒ 任务标记 COMPLETE。**

---

## 18. 下一阶段建议

1. **（建议 P1）历史结论证据链的按需重放**：为 `660001` / `660003` 这类「列上为空、`evidenceJson` 有内容」的历史结论提供**只读回填视图**（不写库，前端读 `evidenceJson.findings` 作为兜底并在 UI 标注「历史行」），而不是重写历史行。
2. **（建议 P1）参数搜索的错误码引导**：`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER` 是刻意护栏，但用户看到「搜不了」会误判为故障 ⇒ 在前端把「怎么修（改用参数引用 / 走派生候选）」做成可达引导。
3. **（建议 P2）语义变量口径变更的留档**：AR-12 让同名 `pat_*` 变量跨修复时间点**语义不同** ⇒ 建议在 Run 的 `inputSnapshot` / 报告里带上**语义版本指纹**（`semanticRegistry` 已有 `fingerprint` 字段），使「这条统计按哪版语义算的」可复核。
4. **（建议 P2）PIT 闸门接进装配期**：`assertProjectionWithinDecisionDay` 目前只在策略投影自己的调用点；若将来装配期能拿到真实决策日（数据集已声明 `decisionOffsetDays`），可把它也纳进 `verifyStrategyConsumption`，形成「特征存在性 + 参数存在性 + 可用性」三条并行的装配期闸门。
5. **（建议 P2）`normalization` 的表达力边界**：当前只支持「一次聚合 + 一次差 + 一次除」。若出现「两窗口相除」「窗口内极值相对窗口首根」这类口径，**不要**在 `definition` 里写比例却在实现里近似 —— 应按本任务同一纪律**扩展声明并同步两侧投影**；否则会重演 AR-12。

---

## 附录 A · 本轮实查的关键数字

| 项 | 值 | 来源 |
| --- | --- | --- |
| 在途 Run | `inFlightRunCount = 0`、`inFlightAnalysisCount = 0` | `_probe_inflight_state.mts` |
| 工作树 | `git status --porcelain` 148 条 vs `git diff --numstat` **0** ⇒ 纯 CRLF 漂移 | 本会话实查 |
| `research_conclusion` | 15 条；`findingIdsJson` 12 NULL / 3 `[]` / **0 非空** | `_probe_9cc_audit.out.json` |
| `research_strategy_candidate` | 13 条；`sourceFindingIdsJson` 非空 4 条 | 同上 |
| `parameter_search_*` | 3 / 12 / 8 行；唯一 `COMPLETED` Run 的 4 组合 `totalReturnPct` 全同、`tradeCount=0` | 同上 |
| `pat_pullback_hold_depth_2d` 修复前 | `<= 0` ⇒ **0** 样本；`> 0` ⇒ **1718** 样本；`DIFFERENCE = 0`、`P = 1` | `_probe_d_conditional_shape.out.json` |
| 同上（修复后） | `<= 0` ⇒ **1436**；`> 0` ⇒ **282**；ALL **1718** | `_e2e_9cc_closed_loop.out.json` |
| 策略版本参数引用面 | **11 / 11 为空** | `_probe_9cc_strategy_params.out.json` |
| E2E | **24 / 24 PASS**，`pass = true`，`fatal = null` | `_e2e_9cc_closed_loop.out.json` |
