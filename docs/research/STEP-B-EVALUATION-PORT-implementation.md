# STEP B（`9ax`）· 让评价 / 绩效 / 参数跑在策略文档上 —— **第 1 批：前置改造**

> **任务 ID**：`9ax`（`ROADMAP.md` §44.5 既有条目，**状态仍为 `⬜ 待做`，本文件不宣称完成**）
> **承接**：`docs/research/RESEARCH-PATTERN-LOOP-AUDIT-001.md` §3.2（P0-2）/ §3.3（P0-3）
> **本批完成时间**：2026-09-17
> **本批状态**：✅ 验收通过（`tsc` = 0 / 新单测 13-13 / 既有聚焦单测 28-28 无回归）
> **本批性质**：为落点①（策略回测评估端口）**清掉两个硬前置**，并如实记录审计结论

---

## 1. 为什么先做「前置改造」而不是直接写评估端口

落点① 的入参是 `{strategyId, strategyVersion, dateRange, parameterSet}` —— 即**同一份策略、不同参数组合**。
落地时撞到两堵墙，都必须先拆：

| 墙 | 现象 | 不拆的后果 |
|---|---|---|
| **① 装配层不支持参数覆写** | `StrategyRecipeRuntime.resolveParameters(schema)` **只取 `defaultValue`**，注释原文写着「本增量只打通链路，**参数覆写属后续增量**」 | 评估端口拿到 `parameterSet` 也**喂不进**回测 ⇒ 参数搜索仍然只能另接 legacy 回测（= P0-2 缺陷原样保留） |
| **② 装配层不支持注入数据集** | `resolveDataset()` 每次都重新解析（直读或**分钟级重建**） | 参数搜索要跑 N 组参数 ⇒ **N × 分钟级** 重建，实际不可用 |

⇒ 本批把这两堵墙拆掉，并把「未知维度静默忽略」这条 P0-2 子缺陷**根治**。

---

## 2. 审计先行：两处与报告不符（先查真码，不采信转述）

| 报告说法 | 实查结论 | 证据 |
|---|---|---|
| 「闭环 14 阶段**只有 6 个**有执行器，另有 **4 个** notWired」 | ✅ 6 个有执行器属实；但 **notWired 是 7 个** —— 除 `optimization` / `robustness` / `oos` / `overfitting` 外，还有 `paper` / `review` / `discipline` | `closedLoopWiring/requirements.ts:114/120/126/132/149/155/161` 七处 `notWired(...)` |
| 「那 7 个模块（`parameterSearch` / `rollingOptimization` / `robustness` / `stochasticRobustness` / `walkForwardRun` / `oosIsolation` / `overfittingDetection`）**代码早已写好，纯接线**」 | ❌ **它们早已接线** —— 7 个全部被 `paramSearchRouter.ts` / `walkForwardRouter.ts` **真实 import**（9 处 import）。真正的缺陷不是「没接线」，而是「**接的评估器是 legacy `getLeaderCandidateBacktest`**」 | `paramSearchRouter.ts:41-80`、`walkForwardRouter.ts:44-75` |

**副产物（也是 P0-2 的直接证据）**：`paramSearchRouter.ts:129-140` 的 `MAPPABLE_PARAMETER_DICTIONARY` 是**固定 8 字段白名单**，
`:206-207` 的 `switch` 落 `default: break` ⇒ **未收录的参数维度被静默忽略**。

---

## 3. 🔴 4 个 notWired 阶段的「不接线理由」= 落点① 的需求说明书

`requirements.ts` 给 `optimization` 阶段写的理由原文：

> 模块本身是「参数空间 + **注入式 evaluator**」的纯函数（`parameterSearch/run.ts:132 runParameterSearch`、`rollingOptimization/run.ts:148 runRollingOptimization`），
> 装配必须自带一个「**参数集 → 绩效标量**」的 evaluator——**那等于在本层再搭一条 dataset→signalEngine→simulator→evaluate 的子链**。
> 在候选/回测链尚未端到端验证前装配它，会产出一条**无法被独立复算**的 optimizationRef。

`robustness` / `oos` / `overfitting` 三条理由**同源**（都缺同一个 evaluator）。

⇒ **这四堵墙是同一堵**：它们缺的正是落点① 要提供的东西。**落点① 完成之日，就是这 4 个阶段可接线之时。**
⇒ 因此 `9ax` 的落点① 与落点③ **必须同批做**（本批只做完前置，两者都未开始）。

---

## 4. 本批交付（两个前置改造）

### 4.1 参数覆写成为一等公民 + 未知参数的响亮拒绝

`server/research/recipeRegistry.ts`：

- **接口**：`resolveParameters(schema, overrides?)`
- **实现**：
  1. 逐参数取值 —— `overrides` 里有就用覆写值，否则用 `defaultValue`；两者都没有 ⇒ 抛 `RECIPE_PARAMETER_NO_DEFAULT`（不编值）
  2. 🔴 `overrides` 里出现 schema **未声明**的参数 ⇒ 抛 **`RECIPE_PARAMETER_UNKNOWN`**（新错误码）
- **为什么第 2 条是本批最重要的改动**：它就是 P0-2 缺陷（「参数只认 8 个 legacy 字段、未收录维度被静默忽略」）的**对症修法** ——
  宁可拒绝，也绝不让调用方以为某个维度参与了寻优、实际却被丢掉。**静默忽略的产物看起来完全正常**，是本项目最难发现的一类错。
- **零回归**：无覆写时行为与既往**逐字一致**（全取 `defaultValue`）；`overrides` 是可选参数 ⇒ 唯一既有调用方 `assemble.ts` 不改也能编译。

`server/runWorkbenchAssembly/assemble.ts`：请求新增 `parameterOverrides?` 并透传；顺手**更正了一段过时注释**
（原文写「库里既有策略文档都还没有 recipe 字段」，实查 10 份里 **7 份已带 `recipe`**）。

### 4.2 装配层支持注入已构建数据集

- `DatasetSourceKind` 加第三值 **`"injected"`**（并同步 `shared/researchContracts.ts` 的 zod 闭集）
- `resolveDataset()` **最前面**加注入短路：给了 `researchDataset` 就跳过一切解析
- **为什么不复用 `rebuild` 标签**：参数搜索要在同一份数据上跑 N 组参数，复用事实若伪装成「本次刚重建」，审计时无法分辨 ——
  「这份数据是本次刚建的，还是被复用的」正是最不该含糊的地方。⇒ 单列 `injected`，`datasetSourceNote` 写明原因。

---

## 5. 本批验收

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0** |
| 新增 `tests/server/research/recipeRegistryParameters.test.ts` | **13 / 13** |
| 既有 `tests/server/research/conditionSignal/compile.test.ts`（STEP A 交付） | **28 / 28**（无回归） |
| 手术脚本回读断言 | 参数覆写 12/12 PASS；数据集注入 7/7 PASS |
| 行尾 | 四个改动文件**纯 LF**（逐文件实测 `crlf=0`） |

单测覆盖的**关键边界**（都容易被写错）：
覆写值 `0` 生效（不被真值判断吃掉）／nullable 参数覆写为 `null` 时**保留 `null`**（不退化成 `defaultValue`）／
覆写能解掉「schema 无 defaultValue」的死局／**含未知键时整体拒绝**（不静默丢弃未知键）／
空覆写对象 = 无覆写（不触发未知键检查）。

---

## 6. 剩余工作（下一批，按依赖顺序）

| # | 内容 | 依赖 |
|---|---|---|
| 1 | **落点①** 新增 `server/research/strategyEvaluation/` —— 评估端口本体：`assembleRunWorkbenchInputs`（带 `parameterOverrides` + 注入数据集）→ `createClosedLoopWiring({requested: ["data","research","strategy","backtest","evaluation"]})` → `runClosedLoop` → 从 `run.stages` 取 evaluation 标量 | 本批两个前置 ✅ 已就绪 |
| 2 | **落点③** 闭环 4 阶段接线：`requirements.ts` 把 `optimization` / `robustness` / `oos` / `overfitting` 从 `notWired` 改 `wired`，并在 `executors.ts#buildExecutor` 补 4 个 case，**以评估端口作为它们缺的那个「参数集 → 绩效标量」evaluator** | 依赖 1 |
| 3 | **落点②** 三个 router（`paramSearch` / `walkForward` / `marketRegime`）的评估标量改调评估端口 | 依赖 1 |
| 4 | **落点④** `parameterSearch` 候选经既有 `strategyCandidate` 桥回写（**promote 仍是唯一 `CONVERTED` 入口**） | 依赖 1 |
| 5 | 端到端判据：同一策略、同一参数集 ⇒ **闭环 evaluation 标量 == 参数搜索评估标量**；`executedStageCount` 由 **6 升到 10** | 依赖 1-3 |

**已确认的执行器现状（供下一批直接用）**：`closedLoopWiring/executors.ts` 的 `backtest` case（`:396-408`）已真调 `runTradeSimulation`，
`evaluation` case（`:409-474`）已真调三个 `evaluate*` 并 `composeClosedLoopEvaluationRef` —— **下一批应复用这两段，禁止重写**。

---

## 7. 本批边界

- **未新增任何 tRPC 端点**、**未改任何 router**、**未改 `client/**`**（零前端改动）
- 零迁移 / 零新表 / 零新依赖
- `server/**` 573 → **575**（STEP A 的 +2）→ 本批 **575 未变**（只改既有文件）
- 🔴 **`researchDataset` 注入目前无生产调用方**（它是为下一批的评估端口准备的），本批只经 `tsc` + 代码审查 + 断言验证；
  端到端验证随评估端口一起做 —— **不写成「已验证」**
- 🔴 `9ax` **整体未完成**，`ROADMAP.md` 的状态**保持 `⬜ 待做`**

---

## 8. 第 2 批：评估端口本体 + 🔴 端到端取证被**既有阻塞**拦住（如实登记）

### 8.1 交付

新增 `server/research/strategyEvaluation/`（`evaluate.ts` + `index.ts`）：

- `evaluateStrategyParameters(request): Promise<StrategyEvaluationResult>`
- 子链 = **`CLOSED_LOOP_STAGE_IDS` 的前 5 项**（`data` / `research` / `strategy` / `backtest` / `evaluation`），
  经 `createClosedLoopWiring` + `runClosedLoop` 走**真实阶段链**，**不手写** dataset→engine→simulator→evaluate
- 输出 `evaluation: ClosedLoopEvaluationRef` —— 与闭环 `evaluation` 阶段 **同一份**标量（同源取出，不另行计算）
- `experimentId` 由「策略身份 + 覆写键值（排序后）」**确定性派生** ⇒ 同输入同 id（可复现、可去重）
- `dataset` **原样返回** ⇒ 形成「第 1 次建、后续 N-1 次复用」的可用范式
  （补这条之前，注入口对调用方**不可用** —— 拿到不数据集就没法复用）
- 失败时错误消息带**全部非 `EXECUTED` 阶段**的 `reasonCode` + `detail`（这条可诊断性本次立了大功，见 8.2）

`tsc --noEmit` = **exit 0**。

### 8.2 🔴 端到端取证**未通过** —— 但失败方式是正确的

探针 `docs/evidence/_probe_step_b_evaluation_port.mts` 实测（真实库 / 真实文档 `cand-360001@1.0.0` #420001）：

```
data = BLOCKED(CL_DATASET_GATE_NOT_PASS:
         data 数据源产出 dataset gate = INCONCLUSIVE（非 PASS）；§45.2 数据链就绪认证未达成)
research / strategy / backtest / evaluation = BLOCKED(CL_UPSTREAM_BLOCKED)
```

**两次取证撞同一堵墙**（换过两类数据集）：

| 数据集 | 来源 | 规模 | gate |
|---|---|---|---|
| 探针自建（`datasetSourcePolicy: rebuild`，5 交易日 / 30 只） | 重建 | 150 行 | `INCONCLUSIVE` |
| `dataset_version#390002`（`first_limit_pullback` v2，**已落库 `READY`**） | registry 直读 | 23,978 事件 / 1,543,082 行 | `INCONCLUSIVE` |

**判定链**：`orchestrator.ts:539-545` —— **`data` 阶段执行后**检查它产出的 `datasetSummary.gate`；
非 `PASS` ⇒ `CL_DATASET_GATE_NOT_PASS`，并阻塞其后全部阶段。

**`gate` 的来源**：`server/historicalState/audit/runAudit.ts`（§45.2 数据链就绪认证），
值域 `PASS | FAIL | INCONCLUSIVE`，其中 `INCONCLUSIVE` = 「无 FAIL，但存在样本级错误 / 数据未就绪，不足以认证」。

### 8.3 这对 `9ax` 意味着什么

- 🔴 **`9ax` 条目登记的判据「闭环 `executedStageCount` 由 6 升到 10」，其前提在当前数据状态下不成立** ——
  实测 `data` 阶段即被阻塞，`executedStageCount` 会是 **0** 而非 6。**条目登记时显然未实测**（它是待做条目，描述基于推断）。
- ⇒ **落点③（闭环 4 阶段接线）本轮无法验证**（接上后同样被 gate 拦住）；**落点②（三 router 改调）亦然**。
- ✅ **评估端口在门禁下「如实失败」，而非静默造假** —— 它没有返回半截标量，
  这恰好**验证了模块头的纪律 3（禁伪造）**。**这个失败是有价值的信号，不是实现缺陷。**

### 8.4 结论与建议

- 评估端口（落点① 本体）**已交付、`tsc` 干净**，但它所依赖的「闭环前 5 阶段」要求 **`dataset.gate = PASS`**。
- 🔴 **本轮新发现的既有阻塞**：当前**所有**数据集 gate 均为 `INCONCLUSIVE` ⇒ **闭环回测链整体不可达**。
  这属「数据链就绪认证」（§45.2 / `historicalState/audit`），**不是 `9ax` 的范围**，
  且**非本轮引入**（本轮未触碰 `historicalState/**`，也未改任何 gate 判定）。
- **建议**：先单独排查「为何 gate 从历史记录的 17/17 全 `PASS` 变成 `INCONCLUSIVE`」，
  再回来做落点②③④ —— 否则它们的验收同样无法完成。
- **本轮不做**（按「不要新添东西」的约束，**不擅自扩大范围**；该阻塞已如实登记，未新建任务条目）。
---

## 9. 🔴 更正 §8.2–8.4：那不是「既有阻塞」，是**探针漏传一个参数**

### 9.1 定性过程（先查判据，再动判据）

§8.2 把 `data=BLOCKED(CL_DATASET_GATE_NOT_PASS)` 判成「既有阻塞」，并据此写下 §8.3「`9ax` 判据前提不成立」
与 §8.4「闭环回测链整体不可达」。**这两个结论都是错的。**
按探针纪律「FAIL 时第一动作是**定性**，不是改探针让它过」，本轮回到源码逐行核对：

1. `orchestrator.ts:539-545` —— `data` 阶段**执行后**检查它产出的 `datasetSummary.gate`；
2. 该 `gate` 来自 `runPitAudit`（`server/historicalState/audit/runAudit.ts`）；
3. **`runAudit.ts:145-149` 的判据**：
   ```ts
   const gate = hasFail ? "FAIL"
     : sampleErrors.length === 0 && samplesQueried > 0 && dataReady ? "PASS"
     : "INCONCLUSIVE";
   ```
4. **`runAudit.ts:74`**：`const dataReady = options.dataReady ?? false;` ← **缺省 `false`**

⇒ **`PASS` 的四个条件之一是「调用方声明 `dataReady`」；不声明就永远拿不到 `PASS`。**
而 `buildResearchDataset` 的 `dataReady` 由 `assemble.ts` 从 `request.dataReady` 透传，**探针没传**
⇒ `gate = INCONCLUSIVE` ⇒ `data` 阶段阻塞。

**结论：这不是数据域问题、不是闭环缺陷、也不是「数据链就绪认证未达成」，
而是「调用方必须显式声明『本数据集已通过就绪认证』」这一契约。**

### 9.2 修正后重跑：**五项取证全部通过**

探针补 `dataReady: true` 后重跑（真实库 / `cand-360001@1.0.0` / `dataset_version#390002`）：

| # | 取证项 | 结果 |
|---|---|---|
| 1 | 五阶段是否真跑 | ✅ `data`/`research`/`strategy`/`backtest`/`evaluation` **全部 `EXECUTED`**（其余 9 阶段 `SKIPPED` = 未请求） |
| 2 | `datasetSource` 如实 | ✅ 首次 `registry` |
| 3 | **注入复用无损** | ✅ `injected`；`backtestFingerprintSame` / `performanceSame` / `riskAdjustedSame` / `tradeQualitySame` **全为 `true`**（标量逐位不变） |
| 4 | **参数覆写改变标量**（P0-2 核心判据） | ✅ 见下表 |
| 5 | 未知参数必须拒绝 | ✅ `RECIPE_PARAMETER_UNKNOWN` |

**取证 4 对照**（同一份策略文档、同一份数据集，**只改覆写**）：

| | 默认参数 | 覆写参数 |
|---|---|---|
| `parameterSet`（**结果如实回显**） | `max_drawdown=0.02, max_volume_ratio=0.3, require_bullish=0` | `max_drawdown=0.05, max_volume_ratio=0.75, require_bullish=1` |
| `totalReturnPct` | **−3.49%** | **+2.27%** |
| `cagrPct` | −77.49% | +156.58% |
| `maxDrawdownPct` | 5.25% | 0.046% |
| `backtestFingerprint` | `452e…` | `4766…`（变了） |

⇒ **参数真的进了回测**，「参数搜索跑在策略文档上」这一条**成立** ✅

### 9.3 顺带发现的第二件事：覆写值必须合法

首次覆写用 `defaultValue * 10`，被**参数校验**当场拒绝：

```
CL_STAGE_EXECUTION_ERROR: 阶段 strategy 失败：研究实验校验失败：
  [VALUE_ABOVE_MAX] parameterSet.max_volume_ratio: 参数 max_volume_ratio = 3 大于 max 1
```

⇒ 参数 schema 的 `[min, max]` 被**真正尊重**（不是摆设）。这是**正确行为**，
但参数搜索构造搜索空间时**必须按 `schema` 的边界夹取**，否则整批候选会被校验拒绝。

### 9.4 对 `9ax` 的更正结论

- ❌ **撤销 §8.3「`9ax` 判据的前提不成立」** —— `executedStageCount` 的前提**成立**，闭环链**是通的**。
- ❌ **撤销 §8.4「新发现的既有阻塞」** —— 不存在该阻塞；`historicalState/audit` 与 gate 判定**均无问题**。
- ✅ **落点①（评估端口）已完成，端到端五项取证全绿。**
- 🔴 **教训（已写进探针文件头注释与 `PROJECT_RULES.md`）**：
  `runPitAudit` / `buildResearchDataset` 的 `dataReady` **缺省 `false`** ⇒
  任何**新写**的、走闭环 `data` 阶段的调用方**必须显式声明 `dataReady: true`**，
  否则会看到 `CL_DATASET_GATE_NOT_PASS`，并**极容易误判成「数据链就绪认证未达成」**（本次即如此）。
- **本更正的证据**：探针输出 `docs/evidence/_probe_step_b_evaluation_port.out.json`
  （同目录另有首次失败版本可对照，见报告 §8.2 引用的那份输出）。
---

## 10. 落点③ 的解锁点：抽出**同步**的 `assembleStrategySide`（行为等价的重构）

### 10.1 为什么落点③ 会卡住：闭环执行器与 evaluator **都是同步的**

接线 `optimization` / `robustness` 前先读契约，发现一个**真实的架构冲突**：

| 位置 | 契约 | 同步性 |
|---|---|---|
| `closedLoop/types.ts:665-668` | `ClosedLoopStageExecutor<S> = (ctx, input) => ClosedLoopStageOutputById[S]` | **同步** —— `orchestrator.ts:322` 是 `const out = executor(ctx, input)`，**无 `await`** |
| `parameterSearch/types.ts:74-75` | `ParameterSearchEvaluator = (parameterSet) => ParameterSearchSampleOutcome` | **同步**（注释原文：「搜索器保持纯函数，不执行 IO / 回测」） |
| `robustness/types.ts:305` | `RobustnessEvaluator` | **同步** |
| `strategyEvaluation`（本 STEP 上一批交付） | `evaluateStrategyParameters(...) => Promise<...>` | 🔴 **async** |

⇒ **评估端口无法直接作为闭环内的 evaluator。**

**根因**：`assembleRunWorkbenchInputs` 之所以是 `async`，**只因为** `resolveDataset`（可能是分钟级重建）。
策略侧装配（成本模型 / 执行模型 / 配方 / 参数 / `strategy13` / `simulationConfig`）**全是同步的**。

⇒ 这也正是 `requirements.ts` 那句「装配必须自带一个 evaluator —— **那等于在本层再搭一条子链**」的
**技术根因**：它缺的不是「一条子链」，而是「**同步可得的策略侧装配**」。

### 10.2 交付：`assemble.ts` 新增同步的 `assembleStrategySide`

```ts
export function assembleStrategySide(
  request: AssembleRunWorkbenchInputsRequest,
  datasetVersion: string,          // 与数据集只差这一个字段
): AssembledStrategySide
```

- 搬移是**纯机械**的：整块代码零逻辑改动，**唯一**一处 `dataset.datasetVersion` → 形参 `datasetVersion`
- `assembleRunWorkbenchInputs` **改为调它**（唯一实现，**禁复制第二份**）
- 新导出接口 `AssembledStrategySide`：`recipeRuntime` / `recipeSource` / `parameterSet` / `costModel` /
  `executionModel` / `strategyContract` / `strategy13` / `experimentConfig` / `simulationConfig` /
  `strategyDocumentInput` / `strategyVersionRecordInput` / `lifecycle`
- **零新 import**（所需类型本文件已有）

### 10.3 行为等价验证（最硬的判据：指纹逐位相同）

抽取是重构，**必须证行为零变化**。用同一支探针跑抽取前后对照
（真实库 / `cand-360001@1.0.0` / `dataset_version#390002`）：

| 探针读数 | 抽取前 | 抽取后 |
|---|---|---|
| `firstRun.backtestFingerprint` | `452e…` 系 | **完全相同** ✅ |
| `firstRun.performance.totalReturnPct` | −3.4885310636999955 | **−3.4885310636999955** ✅ |
| `overrideRun.backtestFingerprint` | `1aaa3863…` | **`1aaa3863…`** ✅ |
| `overrideRun.performance.totalReturnPct` | +2.2688102033999957 | **同** ✅ |
| 五阶段状态 | 全 `EXECUTED` | 全 `EXECUTED` ✅ |
| 注入复用四项 `*Same` | 全 `true` | 全 `true` ✅ |
| 负例 | `RECIPE_PARAMETER_UNKNOWN` | 同 ✅ |

⇒ **行为等价** —— 指纹是产物内容摘要，**逐位相同**即证「同样的输入得到同样的产物」。
`tsc --noEmit` = **exit 0**。

### 10.4 本轮未做（下一批第一步）

**落点③ 的接线主体**，按依赖序：

1. 在 `strategyEvaluation` 增 `createStrategyParameterEvaluator(...)`：**同步**闭包 —— 对每个 `parameterSet`
   调 `assembleStrategySide`，并用**预置 `artifacts.dataset`** 走
   `createClosedLoopStageRunners({requested: ["research","backtest","evaluation"]})` + `runClosedLoop`
   （**复用既有执行器，不手写子链**）
2. `requirements.ts` 把 `optimization`（`runParameterSearch`）与 `robustness`（`runRobustnessStress`）改 `wired`，
   并在 `executors.ts#buildExecutor` 补 2 个 case
3. `oos` / `overfitting` **留下一轮** —— 它们的 `requirements.ts` 理由明说「依赖链更长」「必须先定 IS/OOS 切分契约」，
   不适合与本批同做

### 10.5 边界与过程中的自纠

- 零新端点 / 零 router 改动 / 零 `client/**` / 零迁移 / 零新依赖；`assemble.ts` 32467 → **37063 B**（纯 LF）
- 🔴 **自纠 1**：首版脚本把新函数插在了 `assembleRunWorkbenchInputs` 的**函数体内部**
  ⇒ `tsc` 立刻报 `TS1184: Modifiers cannot appear here`（`export` 出现在非法上下文）
  ⇒ 已把整块移到模块顶层，并补两处遗漏的 `document.*` 引用（摘要里的 `strategyId` / `strategyVersion`）。
  **教训：插入新函数前必须断言「插入点在模块顶层」**，不能只按文本锚点定位。
- 🔴 **自纠 2**：我的一条断言用**裸子串**判「旧引用已消失」，而 `strategyContract` 里有同名字段
  （缩进不同、位置完全正确）⇒ 断言**假失败**。`tsc` 才是判据。
  （这已是本会话第 3 次踩「裸子串断言」的坑，`PROJECT_RULES.md` 有记。）
---

## 11. 落点③ 接线件：**同步**的「参数集 → 绩效标量」评估器

### 11.1 交付

- 新增 `server/research/strategyEvaluation/evaluator.ts`（8730 B）：
  `createStrategyParameterEvaluator({dataset, document, dateRange, createdAt, codeVersion, runIdPrefix})`
  ⇒ 返回 **`ParameterSearchEvaluator`**（同步闭包）
- `evaluate.ts` 的 `deriveExperimentId` 改为**导出**（供评估器复用，避免第二份 id 派生）
- `assemble.ts` 再抽 **`buildClosedLoopWiringInputs(dataset, side)`**（主入口与评估器共用，
  **避免在评估器里拼第二套 wiring inputs**）；`assemble.ts` 37573 → **37573 B**

### 11.2 一次真实的设计错误（已修，教训写进代码注释）

初版子链定为 `research → backtest → evaluation`（想跳过 `data`：数据集已由调用方持有）。
**实测失败**：`research = BLOCKED(CL_UPSTREAM_BLOCKED…)`。

**真因**：`research` 阶段的 `consumesKind === "datasetSummary"` —— 它消费的是**上游交接产物**
（`data` 阶段 EXECUTED 时产出的 `ClosedLoopDatasetSummary`），**不是** `artifacts.dataset`。
只预置 `artifacts.dataset` 而跳过 `data` ⇒ `inputResolved = false` ⇒ 门禁 2 直接拒；
而**报出来的错误是 `CL_UPSTREAM_BLOCKED`，看不出真因**。

⇒ 修法：子链改为与 async 版**完全相同**的 5 阶段 —— `data` 会因 `artifacts.dataset` 已预置而
**直接** EXECUTED（`requireDataset` 优先取它，**零 IO**），交接产物自然生成。
⇒ 顺带给失败消息加了「**全部非 EXECUTED 阶段的诊断摘要**」（本次就是靠它定位的）。

> 🔴 通用教训：**`artifacts.*`（旁路重对象）与「阶段交接产物」是两回事**。
> 预置 artifacts 只能让阶段「能执行」，**不能替代**上游阶段产出的 handoff。

### 11.3 验收（只读探针 `docs/evidence/_probe_step_b_sync_evaluator.mts`，输出已落盘）

| 取证项 | 结果 |
|---|---|
| 返回值**不是 Promise** | ✅ `isPromise = false` |
| 与 async 版**同参数 ⇒ 同标量** | ✅ 两边 `totalReturnPct` 均 **−3.4885310636999955**（`matchesAsyncBaseline = true`）⇒ **同源，非第二套口径** |
| 换覆写 ⇒ 标量**真的不同** | ✅ `+2.2688102033999957`（`differsFromBaseline = true`） |
| 未知覆写键 ⇒ **结构化失败**（不抛错、不静默） | ✅ `threw = false` / `status = "failed"` / 消息含 `RECIPE_PARAMETER_UNKNOWN` |

`tsc --noEmit` = **exit 0**。

### 11.4 下一批（最后一步：接线）

`requirements.ts` 把 `optimization` 从 `notWired` 改 `wired` + `executors.ts#buildExecutor` 补 1 个 case：

1. 从 `artifacts.dataset` / `artifacts.strategyDocument` + `inputs` 取上下文；
2. 从策略文档 `parameters` 派生 `ParameterSpace` —— **只取同时声明了 `min` 与 `max` 的数值参数**；
   一个都没有 ⇒ **响亮抛错**（不猜边界，否则整批候选会被 `[VALUE_ABOVE_MAX]` 拒）；
3. `runParameterSearch({method:"grid", strategyId, strategyVersion, parameterSpace, evaluator: createStrategyParameterEvaluator(...), searchRunId, createdAt, maxCombinations})`
4. 投影成 `ClosedLoopOptimizationRef`（`method` / `candidateParameterKeys` / `evaluatedCandidateCount` / `consistency`）

`robustness` 同法（`runRobustnessStress` + 扰动清单）；`oos` / `overfitting` 留后（其理由要求先定 IS/OOS 切分契约）。

### 11.5 边界

零新端点 / 零 router 改动 / 零 `client/**` / 零迁移 / 零新依赖；
`server/**` 577 → **578**（+`evaluator.ts`）；改动文件**纯 LF**。
本批 2 次脚本自纠（都在写盘前 ABORT，文件未被破坏）：块锚点文本不符、`EV_LINE_FIXES` 与前置步骤重复。
## 12. 落点③ 第 1 步：`optimization` 阶段**总成**（评估端口第一次成为闭环的一环）

> 本轮把 `requirements.ts` 里 `optimization` 的 `notWired` 换成 `wired`，并补上它的执行器与
> 搜索空间派生件。**这是「闭环 14 阶段」第一次把「参数寻优」纳入同一条链**。

### 12.1 动手前先查真库：搜索空间到底能不能派生

`parameterSearch` 的 `SweepNumberParameter` 要求 `min` / `max` / `step(>0)` 全部有限，
而 `ResearchParameterDefinition.step` 是**可选**字段 —— 若真实文档普遍没有 `step`，
这条接线在真库上就是「一跑就抛错」。⇒ 先实查（`_probe_optimization_parameter_space.mts`，10 份文档）：

| 文档 | 可搜索参数 | 说明 |
|---|---|---|
| 7 份 `cand-3600xx` | **3 / 3 全可搜索** | `max_drawdown [0,0.3] step 0.01`、`max_volume_ratio [0.05,1] step 0.05`、`require_bullish [0,1] step 1` |
| 2 份 `limit-up-baseline` | **0 / 2** | `topN` 缺 `step`；`minScore` 缺 `min` / `max` / `step` |
| `cand-270001` | 0（未声明参数） | — |

⇒ **7/10 文档可派生完整搜索空间**，接线在真库上可用；另 3 份如实拒绝（见 12.2 末）。

### 12.2 交付（全部为纯追加 / 等位替换）

| 文件 | 改动 |
|---|---|
| `server/research/strategyEvaluation/parameterSpaceFromDocument.ts` | **新增**：`deriveParameterSpaceFromDocument(document)` —— 搜索空间**只由文档 `parameters` 派生**；不可搜索的参数**逐条记入 `excluded`（含缺什么）** |
| `server/research/closedLoopWiring/executors.ts` | 新增 `case "optimization"` + 导出 `projectOptimizationRef`；头部注释的装配清单补 `optimization`（如实） |
| `server/research/closedLoopWiring/requirements.ts` | `notWired("optimization", …)` → `wired("optimization", "parameterSearch", [viaArtifact(["dataset", "strategyDocument"])], …)` |
| `tests/server/research/closedLoopWiring/closedLoopWiring.test.ts` | 「已装配清单」断言加入 `optimization`；「未装配阶段」用例标的换成 `robustness`（它仍 notWired） |

**禁猜界**（与 `definitionBuild.ts:454` 的「Promote 不会替你给搜索空间定界」同口径）：
`min` / `max` / `step` 是搜索空间的**定义**，不是可补的默认值。猜 `step = 1` 会把 `[0, 0.3]`
的连续阈值变成 31 个搜索点 —— 那是拿「我们的臆测」替换「研究者声明的意图」。

**「不静默」在本阶段的落地**：不可搜索的参数**逐条进 `consistency.note`**
（形如 `未进搜索空间的参数：topN（数值参数缺 step…）`），而不是默默丢掉 ——
后者正是 P0-2 的病（调用方以为某维度参与了寻优、实际被丢掉，而产物看起来完全正常）。
若**一个可搜索参数都没有** ⇒ 抛 `CL_OPTIMIZATION_PARAMETER_SPACE_EMPTY`（**不返回半截产物**）。

### 12.3 🔴 偏离规划的一处：`method` 用 `random` 而非 `grid`

上一批的规划写的是 `runParameterSearch({ method: "grid", … })`。实查后发现**不可行**：

`cand-3600xx` 三参数的全网格 = 31 × 20 × 2 = **1240 组**；而闭环执行器是**同步**的
（`ClosedLoopStageExecutor` 无 `await`），每次评估都是一次完整 `research → backtest → evaluation` 回测。
按实测每次数秒计，1240 组是**小时级同步阻塞** —— 会拖垮整个 Node 事件循环（tRPC 全挂）。

⇒ 改为**固定种子的 `random` 采样**（`seed = 17`、`budget = 12`，模块级常量并注明理由）：
确定性可复现、预算可控。需要全网格时由调用方**离线另跑**，不在同步阶段里做。
`consistency.note` 会写清「random 采样 12 / 全网格 1240 组」—— 让「本次没跑全网格」这件事**可见**。

### 12.4 验收

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0** |
| 新增 `tests/server/research/strategyEvaluation/optimizationStage.test.ts` | **15 / 15** |
| 装配层 `closedLoopWiring.test.ts`（既有，已如实更新） | **31 / 31** |
| 只读探针 `_probe_step_b_optimization_stage.mts` | **6 阶段全 `EXECUTED`**（`executedStageCount = 6 / 6`） |

探针标的 = 真实文档 `cand-360001@1.0.0` + 已落库 READY 数据集 `dataset_version#390002`（窗口 2026-08-22 → 09-01）：

```
registeredStages = [data, research, strategy, backtest, evaluation, optimization]  ← 6/6 注册成功
stages           = 全 EXECUTED（其余 8 阶段 SKIPPED —— 本次未请求）
optimizationRef  = { kind: "optimizationRef", handoffVersion: 1, synthetic: false,
                     method: "random", evaluatedCandidateCount: 12,
                     source: { module: "parameterSearch", moduleRunKind: "PARAMETER_SEARCH_RUN",
                               runId: "OPT-PROBE-OPT::cand-360001", fingerprint: "a1d56229…" },
                     consistency: { status: "degraded",
                       note: "random 采样 12 / 全网格 1240 组（固定种子，确定性）；稳定区 verdict=degraded-bad-point-rate、
                              合格 1 组、坏点率 91.67%、产出候选 0 个（搜索键：max_drawdown / max_volume_ratio / require_bullish）；
                              全部声明参数均进搜索空间" } }
```

- `evaluatedCandidateCount = 12` **恰等于**注入的 `budget` ⇒ 采样确实按注入值发生
- `optimizationRef` 能 `EXECUTED` 本身就说明它通过了 `guards.ts:117` 的四键 + 取值闭集校验
- `consistency.status = "degraded"` 来自真实判定（`verdict = degraded-bad-point-rate`、坏点率 91.7%），**不是**我的映射臆测

**负例**（`limit-up-baseline@1.0.0`：声明了 2 个参数但都不可搜索）：

```
runThrew = true      producedNoRun = true      errorCodeMatched = true
ClosedLoopError: 阶段 optimization 失败：[CL_OPTIMIZATION_PARAMETER_SPACE_EMPTY] 装配层：optimization 阶段
  无可搜索参数 —— 文档 limit-up-baseline@1.0.0 声明了 2 个参数（topN / minScore），但没有一个同时具备
  min / max / step。逐条原因：topN → 数值参数缺 step（必须 > 0 且有限）——搜索空间的范围必须由文档声明，
  不替你猜；minScore → 数值参数缺 min / max / step（必须 > 0 且有限）—— …
```

### 12.5 过程中的三次自纠（都写进了代码注释）

1. **探针自编 `experimentId` 被编排器当场拒绝**（`EXP-YYYYMMDD-XXXXXXXX` 形态，§28 身份）——
   这是**正确行为**。改用唯一实现 `strategyEvaluation#deriveExperimentId`，不自造 id。
2. 🔴 **业务错误码跨编排器后被归并掉**：`orchestrator.ts:523-526` 只把 `ClosedLoopError`
   的 `code` 原样保留，**其余异常一律归并成 `CL_STAGE_EXECUTION_ERROR`**。而
   `ClosedLoopWiringError("CL_OPTIMIZATION_PARAMETER_SPACE_EMPTY", …)` 不属于前者
   ⇒ 第一次实测 `errorCodeMatched = false`（码丢了）。
   处置（最小改动、**不改编排器**）：**把码写进 message**，并在代码里注明理由 ——
   这正是「码须写进 message 才跨层可定位」的既有教训。改后实测 `errorCodeMatched = true`。
3. **发现一处与本次改动无关、但被我差点固化的行尾漂移**（见 12.6）。

### 12.6 附带发现：一处**先前就存在**的行尾漂移

`tests/server/research/closedLoopWiring/closedLoopWiring.test.ts` 在我动手**之前**就已处于
「工作区纯 CRLF / HEAD blob 纯 LF」的漂移态（实测 HEAD `crlf=0 lf=497`，工作区 `crlf=497 lf=497`）。
证据：`git diff --numstat` 报 `+500/-497`，而 `--ignore-cr-at-eol` 报 `+8/-5`。

🔴 **同一个文件的 CRLF 状态两次骗过我**：我先按「实测行尾」用 CRLF 写它（实测确实 497/497 全 CRLF），
直到跑哨兵才暴露这是**漂移**而不是该文件的真实风格 —— 若不复核，我就把漂移态固化成了新基准。

⇒ 已用 `scripts/checkEolDrift.mjs --fix` 归一化。该 `--fix` 是**内容保留**的行尾归一化
（`raw.replace(/\r\n/g, "\n")`），**不是**用 HEAD blob 覆盖 —— 已读源码确认后才执行。
归一化后 `numstat` 与 `ignore-cr-at-eol` 恢复一致（`8/5`），哨兵报 `剩余疑似漂移 0`。

> **教训（已写进 `PROJECT_RULES.md`）**：「实测行尾」只回答问题「我读到的行尾是什么」，
> **不回答「这个行尾是不是对的」**。改 `.ts` / `.test.ts` **之前**先跑一次哨兵，
> 比改完再跑更安全。

### 12.7 边界（如实）

- `9ax` **仍未完成**：`ROADMAP.md` 里它保持 `⬜ 待做`（有断言防误改）。本批只完成**落点③ 的第 1 个阶段**
- `robustness` / `oos` / `overfitting` **仍未接线**（`oos` / `overfitting` 的不接线理由明说
  「必须先定 IS/OOS 切分契约」，不属于本批）
- 零新端点 / 零 router 改动 / **零 `client/**` 改动** / 零迁移 / 零新依赖；`server/**` = 579
- 🔴 **`optimization` 阶段尚未被任何生产调用方纳入 `requested`**：本批只证明「它作为闭环的一环能真跑」，
  **落点②（三个 router 改调评估端口）才是让它进入日常路径的那一步** —— 未做
## 13. 落点② 第 1 里程碑：**参数搜索**改走策略评估端口

> 这是 P0-2 第一次被**真正消除**：`paramSearchRouter` 原本的绩效标量来自 legacy 生产回测，
> 与策略文档无关；现在它可以走**真实闭环**，参数空间也从文档派生。

### 13.1 先审计，推翻报告一处

审计报告称落点② 涉及三个 router（`paramSearch` / `walkForward` / `marketRegime`）。实查后：

| router | 是否参数评估 | 依据 |
|---|---|---|
| `paramSearchRouter` | ✅ 是 | `MAPPABLE_PARAMETER_DICTIONARY`（8 维）+ `parameterSetToBacktestOptions` 的 `switch` + `default: break` |
| `walkForwardRouter` | ✅ 是 | 同构（`runBacktestForSet` → `getLeaderCandidateBacktest`） |
| `marketRegimeRouter` | ❌ **不是** | **无** `MAPPABLE_PARAMETER_DICTIONARY`；`runInputSchema` 只含日期 / 指数 / 归因开关 ⇒ 它是 regime 引擎的暴露层 |

⇒ 落点② 的真实范围是**两个** router。

### 13.2 改造落点：只换「每个参数集怎么算」

两个 router 的评估内核都收敛在**一处**调用：`getLeaderCandidateBacktest(options)`。因此不需要重构 router 结构，
只需要给这一处加一条**策略评估分支**，并把替换逻辑抽成共用件。

### 13.3 交付

| 文件 | 改动 |
|---|---|
| `strategyEvaluation/backtestBridge.ts` | **新增**：`createStrategyBacktestBridge` —— 「参数集 × 区间 → 绩效标量 + 权益曲线」的**唯一实现**。内部调 `evaluateStrategyParameters`（**不手写子链**）；**按区间缓存数据集**（同区间 N 个参数集共用一份，走 `injected`；区间变化时回落 `datasetVersionId` 直读）；失败**结构化返回**（`{status:"failed", error}`），绝不编造标量；`dataReady: true` 显式传 |
| `strategyEvaluation/evaluate.ts` | 结果新增 **`equityCurve`** —— 取自同链 `artifacts.tradeSimulationRun`。走查要把逐窗权益曲线拼接成样本外曲线；不给的话调用方只能自己再跑一遍回测（那正是第二套子链） |
| `paramSearchRouter.ts` | `precomputeParameterSetOutcomes(sets, range, bridge?)` 加桥分支；新增 `resolveStrategyEvaluation`（**四条件缺一即在 `evaluationNote` 写明原因**）；`describe.strategyEvaluation` 声明所需入参；**上限按路径分档** |
| `client/src/pages/ParameterSearch.tsx` | 补 4 个输入（策略 ID / 版本 / 决策起止）+ 结果区**显示 `evaluationSource`**（该文件 HEAD 与工作区原本**字节一致且纯 LF**，改动保持 LF） |

### 🔴 13.4 两个「不静默」的设计点

1. **参数空间在策略路径下改为从文档派生**：入参那个是 legacy 8 维度（`maxHoldingDays` / `stopLossPercent` / …），
   对策略文档**不存在** ⇒ 覆写会因 `RECIPE_PARAMETER_UNKNOWN` 被拒。文档派生为空时**如实回落 legacy 并说明**。
2. **上限判据改为「实际计划评估数」**：`random` 只采样 `min(budget, 全组合)` 组，
   按全组合数判会把「1240 组空间 × budget=2」这种完全正当的请求误拦。分档：策略 16 / 预览 64。

### 13.5 验收

`tsc --noEmit` = **exit 0**；全量 `vitest run`（253 files / 4200 tests）= **8 failed / 17 failed tests**，
失败文件集合与基线**逐项一致 ⇒ 零新增**；行尾哨兵 0 漂移。

只读探针 `_probe_step_b_param_search_strategy.mts`（真实文档 `cand-360001@1.0.0` + 窗口 2026-08-22 → 09-01，`random` + `budget=2`）：

```
evaluationSource        = "strategy-document"          ← 评估确实改走策略评估端口
effectiveParameterNames = [max_drawdown, max_volume_ratio, require_bullish]
                         ← 参数空间确实来自文档派生（不是入参那个 legacy 空间）
sampleCount             = 2                            ← = 注入 budget
combinationCount        = 1240                         ← 文档派生的全组合 ⇒ random 未被上限误拦
regionVerdict           = "no-qualified-samples"
evaluationNote          = "策略评估端口（真实闭环 data→research→strategy→backtest→evaluation）
                           —— 参数空间由文档派生（…）；全部声明参数均进搜索空间。"
```

### 🔴 13.6 本轮暴露的两条真实约束（如实登记）

1. **单组策略评估约 3 分钟**：探针 2 组共 **359245 ms**。⇒ 「策略评估每组都是一次完整闭环回测」是
   **分钟级**而非秒级 ⇒ 真实数据上网格搜索不可行，必须 `random` + 小 `budget`。
   （这也回过头解释了为什么闭环 `optimization` 阶段用 `random`/`budget=12` 而非 grid。）
2. **长跑后 DB 查询会瞬时失败**：探针用例 2 报 `Failed query: select ... from strategy_versions`，
   导致它**回落 legacy** ⇒ 「grid 超限抛错」这一条**未被取证**。
   但单独跑 `docs/evidence/_probe_strategy_repo_get_version.mts` **成功**（`found: true`、3 参数、`datasetVersionId: 390002`），
   判据代码亦已读确认 ⇒ 判为**环境 / 连接池**问题，**不是代码缺陷**。⚠️ 教训：探针请把「读文档」单独验一次，
   别把瞬时故障当成实现缺陷。

### 13.7 未做（下一里程碑）

- **`walkForwardRouter` 同构改造**：模式已验证，但**不是纯复制** ——
  ① 它有 `hasMappable` 拦检查（参数空间必须含 legacy 可映射维度），策略路径下需按路径跳过；
  ② 有 **3 处** 调用点（train / test / test 权益曲线）；
  ③ 🔴 其 `precomputeOutcomes` 用 `Promise.all` **并发** ⇒ 会**击穿**桥的「按区间数据集缓存」（多个参数集同时 miss 会并发构建数据集）⇒ 须先改并发策略。
- `robustness` / `oos` / `overfitting` 闭环阶段接线（`oos` / `overfitting` 仓库**缺 IS/OOS 切分契约**，须先补输入契约）。
- `paramSearchRouter.rolling` / `.robustness` 两个过程（形态不同：逐窗 / 扰动条目，不是「参数集 → 标量」）。

### 13.8 边界

零新端点（复用既有 router）/ 零迁移 / 零新依赖；`server/**` 579 → **580**；`client/**` **首次改动 1 文件**（纯 LF）。
`9ax` 状态仍为 `⬜ 待做`（有断言防误改）。
