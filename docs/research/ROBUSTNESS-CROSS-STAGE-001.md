# ROBUSTNESS-CROSS-STAGE-001 — 现有 Robustness 跨阶段通用性审计（最终报告）

> **状态**：`ROBUSTNESS-CROSS-STAGE-001 = AUDIT_COMPLETE`
> **编号**：`9ck` ｜ **日期**：`2026-09-21` ｜ **性质**：**纯只读审计**（零代码改动 / 零 migration / 零写库 / 零新依赖）
> **机器可核的只读边界**：审计本身**未改动任何生产代码 / 契约 / DB** ——
> `git status --porcelain -- server/ shared/ client/ tests/ drizzle/ scripts/` 的结果与审计开始前**逐行相同**
> （全部是 `9cj` 遗留的 `M`，逐条可核）。
> ⚠️ **如实区分**：按规格 §11 的台账登记要求，本轮**修改了 4 个已跟踪的台账 / 索引文档**
> （`ROADMAP.md`、`ROADMAP-CHANGELOG.md`、`docs/architecture/CHANGE-AUDIT.md`、`docs/evidence/README.md`）——
> 这**不是**「零改动」，但**全部落在文档面**，不触及任何代码。新增文件：本报告（`docs/research/`）
> ＋ 1 个只读探针 ＋ 1 份闸门输出（`docs/evidence/` 已被 `.gitignore:152` 忽略，故不出现在 `git status` 中）。
> **结论**：**B — 核心可复用，需要轻量适配。** 依据见 §10。

---

## 1. 审计范围

### 1.1 复用的历史报告（不重新从零分析）

| 报告 | 复用的内容 |
|---|---|
| `docs/robustness/ROBUSTNESS-001-REPORT.md`（466 行 / `9bu`） | **本次最关键的前置**：§1.2 的「三模块并列对照表」、§2 复用清单、§3 领域模型、§4 输入契约、§5 三表 + 两列、§9 执行流、§12 Known Risks、§13 Deferred |
| `ROADMAP.md` §44.5（`9bu` / `9bt` / `9ax` 条目） | ROBUSTNESS-001 与 PARAMETER-002 的口径；`9ax` 里「闭环 4 个 notWired 阶段」的既有登记 |
| `ROADMAP.md` §48.2 P2 表（第 2520 行） | `C-18.2` 与 `C-18.1` 的任务边界（「§20 Robustness 剩余」） |
| `docs/research/EXPERIMENT-CODE-SPEC.md` §M | 研究实验体系对 Robustness 的**既有边界声明**（见 §8.2，本轮发现其口径存在歧义） |

### 1.2 复用的代码路径

| 路径 | 行数 | 角色 |
|---|---|---|
| `server/research/robustness/**`（8 文件） | **2,024** | C-18.1 四轴扰动**重估**（注入式 evaluator） |
| `server/research/stochasticRobustness/**`（12 文件） | **2,452** | C-18.2 随机化**重估**（MC / Bootstrap / 成交顺序） |
| `server/research/searchRobustness/**`（11 文件） | **3,627** | ROBUSTNESS-001 冻结 Search 结果上的**零重跑**邻域稳定性分析 |
| `shared/searchRobustnessContracts.ts` | — | 三模块中**唯一**有 zod 契约的（C-18.1 / C-18.2 无 shared 契约） |
| `client/src/components/robustness/SearchRobustnessPanel.tsx`<br>`client/src/pages/validation/RobustnessValidationPage.tsx` | — | 前端；**只服务 `searchRobustness`**（C-18.1/C-18.2 无专用前端） |
| `drizzle/0042_search_robustness.sql` + `scripts/applySearchRobustness.mjs` | — | 三模块中**唯一**的 migration |

### 1.3 本次实际复核的文件（亲读，非子代理转述）

`server/research/robustness/{types,index,evaluate}.ts`（全读）、`docs/robustness/ROBUSTNESS-001-REPORT.md`（全读）、
`server/research/vocabulary.ts:724-806`、`docs/research/EXPERIMENT-CODE-SPEC.md:548-571`、
`ROADMAP.md`（§44 头 / §44.5 / §48.2 P2 表 / 编号台账）、`docs/architecture/CHANGE-AUDIT.md:440-488`、
`docs/evidence/_probe_9cj_preflight.mts`（模板）、`drizzle/schema.ts:1728-1860`（`search_robustness_*`）。

### 1.4 本次新建的只读探针

`docs/evidence/_probe_robustness_cross_stage_state.mts` → `.out.json`（**每条 SQL 均为 SELECT**）。
带 `shapeSelfCheck.unwrapped = true` 的形状自检 —— 本轮实测 `select 1 as a,'x' as b` 解包正确，
排除项目历史上「`db.execute()` 返回 `[rows, fields]` 被当 rows 用 ⇒ 全表读成 0 行」的假结论模式。

### 1.5 明确未做的事

未创建 EXP-002；未实现 EXP-002；未修改任何 Robustness 模块；未新建 Robustness Core；
未迁移数据库；未新增 migration；未改 Dataset / Strategy / Parameter Search / Backtest / OOS / WFA；
未为了「通用化」提前重构；未合并 Research Experiment 与 Strategy Robustness；未删除任何实现。

---

## 2. 当前 Robustness 架构（**三个并列模块，不是一套**）

```text
                     server/research/{ robustness | stochasticRobustness | searchRobustness }/
                                                   │
        ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
        │                                          │                                          │
   C-18.1 robustness/                       C-18.2 stochasticRobustness/            ROBUSTNESS-001 searchRobustness/
   四轴确定性扰动                            随机化重估                               冻结结果邻域分析
        │                                          │                                          │
   扰动器产出 PerturbationItem[]             注入收益序列 + seed                       只读 parameter_search_*
   （索引 0 = 基准）                         （dailyReturns / tradeReturns）           （三表，Validity Gate 六码）
        │                                          │                                          │
   ✦ 注入式 evaluator ✦                      ✦ 注入式 StochasticSampleEvaluator ✦     ✗ 无 evaluator（结构性拿不到）
        │                                          │                                          │
   drift 判定（相对基准）                    分布 / CI / 尾部概率 / 基准位置            邻域稳定性 / 敏感性 / 离散度 / 二维矩阵
        │                                          │                                          │
   RobustnessRun（**内存态，不落库**）        StochasticRobustnessRun（**内存态，不落库**）  search_robustness_* 三表（**落库**）
        │                                          │                                          │
   前端：仅 ParameterSearch 技术预览          前端：无专用组件                         前端：SearchRobustnessPanel + /validation/robustness
```

**三个模块之间没有共享基类**（各自定义 `*Request` / `*Run` / evaluator）。
唯一的交叉是 **C-18.2 借用 C-18.1 的阈值类型与函数**：
`stochasticRobustness/types.ts:49`（`type ... from "../robustness/types"`）、`stochasticRobustness/run.ts:21`（`../robustness/drift`）。
`searchRobustness` 与另两者**互相 import 0 命中**（仅注释字串）。

> ⚠️ **本题（跨阶段复用）只与 C-18.1 / C-18.2 有关**。`searchRobustness` 的语义是「**不重算**，只在冻结快照上做邻域统计」，
> 与「Baseline → 改变条件 → **重新计算** → 比较」在**执行语义上相反**（其 `robustnessBoundary.test.ts:72-82` 用 import 黑名单
> `RERUN_MODULES = ["research/backtest","backtest/types","strategyEvaluation","closedLoop","realisticBacktest","strategyCore",`
> `"runWorkbenchAssembly","researchEngine","leaderCandidates"]` **把它钉死**）。⇒ **它对研究阶段不可复用，本报告不再把它当作候选。**

---

## 3. Q1 —— 当前系统已有 Robustness 到底是什么

以 **C-18.1 `robustness/**`** 为主（它是唯一承载「重算 + 比较」方法的模块）：

| 问题 | 答案 | 证据 |
|---|---|---|
| **代码入口** | `runRobustnessStress(request)` | `server/research/robustness/evaluate.ts:141` |
| **核心执行链** | 校验请求 → 逐扰动配置复核 → **逐扰动注入式评估** → `assessRobustnessSensitivity` → 组装 `RobustnessRun` + 指纹 | `evaluate.ts:141-258` |
| **输入** | `RobustnessRequest = { strategyId, strategyVersion, perturbations[], thresholds?, evaluator, robustnessRunId, createdAt }` | `types.ts:297-310` |
| **输出** | `RobustnessRun = { recordKind, recordVersion, robustnessRunId, strategyId, strategyVersion, axis, thresholds, samples[], conclusion, createdAt, fingerprint }` | `types.ts:264-282` |
| **当前验证对象** | **一条已评估的策略结果**（身份 = `strategyId@strategyVersion`） | `types.ts:255` 注释原文「身份：robustnessRunId / strategyId@strategyVersion / axis」 |
| **当前支持的变化维度** | **封闭 4 轴**：`"cost" \| "slippage" \| "parameter" \| "execution"` | `types.ts:66` |
| **Baseline / Variant** | 基准 = `perturbations[0]` 且 `isBaseline=true`，**恰 1 条**；其余为变体；**一次 Run 强制单轴** | `evaluate.ts:163-165`、`:180-188`、`:174-178`（`RB18_AXIS_MIXED`）；`drift.ts:305-318` 二次断言 |
| **如何比较** | `drift` = 变体 − 基准；`|ΔtotalReturnPct| > returnDriftThresholdPct` ∨ `ΔmaxDrawdownPct > drawdownWorseningThresholdPct` ⇒ `sensitive`；逐样本 `verdict ∈ {baseline, stable, sensitive, failed}`；轴级 `verdict ∈ {sensitive, stable, insufficient, no-variants, no-conclusion}` | `types.ts:173-244`；`drift.ts:156-329` |
| **当前如何保存** | 🔴 **不保存** —— 只组装内存对象返回；**无 DB 写入** | `evaluate.ts:244-257` 仅 `computeRobustnessRunFingerprint`；探针实测全库无 `robustness_run` 表（§13） |
| **当前前端如何展示** | **无专用页面**；仅 `ParameterSearch.tsx:236`（技术预览页）直调 `paramSearch.robustness` | 子代理实测；`RobustnessValidationPage.tsx:16-31` 只渲染 `SearchRobustnessPanel`（属 `searchRobustness`） |

**C-18.2 `stochasticRobustness/**`**（并列，非替代）：入口 `runStochasticRobustness`；输入 = **调用方注入的收益序列**
（`dailyReturns?` / `tradeReturns?` / `baseline?` / `evaluator?`，`types.ts:415-427`）+ `seed` + `method`；
输出 `StochasticRobustnessRun`（分布 / CI / 尾部概率 / 基准位置，`types.ts:350-383`）；**封闭三法**
`"monteCarlo" | "bootstrap" | "orderRandomization"`（`types.ts:73-84`）；同样**零持久化**、无专用前端。

---

## 4. 分层表（规格 §3）

以 **C-18.1 `robustness/**`** 为「当前实现」（唯一承载重算方法的模块）：

| 层级 | 当前实现 | 是否策略专用 | 是否具有跨阶段复用可能 |
|---|---|---|---|
| **Baseline** | `perturbations[0].isBaseline === true`，恰 1 条，否则 `RB18_BASELINE_NOT_FIRST` / `RB18_BASELINE_COUNT_INVALID`（`evaluate.ts:163-188`） | ❌ **通用** | ✅ **可以直接复用**（纯位置约定 + 计数校验，零策略语义） |
| **Variant** | `PerturbationItem` 判别联合（`code` / `label` / `isBaseline` / `axis` / `config`）（`types.ts:123-142`） | ⚠️ **形状通用、`axis` 封闭** | ✅ 形状可复用；⚠️ 新增轴要改 7 处（见 §11.1） |
| **Dimension** | `RobustnessAxis` 封闭 4 字面量 = `cost`/`slippage`/`parameter`/`execution`（`types.ts:66`）；**一 Run 一轴** | 🔴 **策略专用**（全部是策略执行轴） | ⚠️ **需适配**（研究侧要的是「条件 / 窗口 / 样本」轴） |
| **Execution** | **注入式** `RobustnessEvaluator = (item) => {status, metrics} \| {status, error}`（`types.ts:104`）；纯函数、无 IO / 无 `Date.now` / 无 `Math.random` | ❌ **通用**（这是最关键的可复用接缝） | ✅ **可以直接复用** |
| **Metrics** | `RobustnessMetricsView` **恰 3 个交易标量**：`totalReturnPct` / `maxDrawdownPct` / `tradeCount`（`types.ts:85-92`）；`validateRobustnessMetrics`（`drift.ts:49-70`）**不容纳额外维度** | 🔴 **策略专用** | ⚠️ **需适配**（研究指标是 `meanCloseReturn` / `medianCloseReturn` / `breakoutVsCloseRate` …） |
| **Comparison** | `computeRobustnessDrift` → `returnDriftPct` / `drawdownChangePct` / `drawdownWorseningPct` / `flags`（`drift.ts:156-224`）；阈值仅 `returnDriftThresholdPct`（缺省 5）/ `drawdownWorseningThresholdPct`（缺省 3）（`types.ts:149-166`）；flag 仅 `RETURN_DRIFT` / `DRAWDOWN_WORSENING`（`types.ts:173`） | 🔴 **策略专用**（收益 / 回撤语义） | ⚠️ **需适配**（研究的比较是「同一统计量跨条件/跨窗口的差」） |
| **Result** | `RobustnessRun` + `conclusion`（`samples` / `sensitiveEntries` / 逐轴计数）（`types.ts:227-282`）；`recordKind = "ROBUSTNESS_RUN"` | ⚠️ **形状通用、身份策略专用** | ⚠️ `strategyId`/`strategyVersion` **必填非空**（`types.ts:268-269`、`298-299`；`evaluate.ts:148`）⇒ 需泛化为「被验证对象身份」 |
| **Artifact** | **无** —— 零落库、零对象存储、零 migration；仅内存返回 + `fingerprint`（canonical SHA-256，`serialize.ts:68`） | — | ✅ **无历史包袱**（可挂到既有 `research_experiment_run` + MinIO，不必给它补表） |

**补充：另两个模块的同层判定**

| 层级 | `stochasticRobustness`（C-18.2） | `searchRobustness`（ROBUSTNESS-001） |
|---|---|---|
| Baseline | ✅ 通用（`baseline?` 可注入，`run.ts:213-228`） | ❌ 无此概念（比较对象是「邻域邻居」而非「基准」） |
| Variant | ⚠️ 方法封闭三枚举（`types.ts:73`） | ⚠️ 邻域由**冻结搜索域**决定（`domainValues.ts`） |
| Dimension | 🔴 随机化方法（非业务维度） | 🔴 搜索参数轴（策略专用） |
| Execution | ✅ 注入式 `StochasticSampleEvaluator`（`types.ts:172`），零 drizzle import | 🔴 **结构性禁止重跑**（黑名单钉死） |
| Metrics | 🔴 Sharpe / 收益 / 回撤（交易语义，`types.ts:203-234`） | 🔴 六指标 `totalReturnPct`/`annualizedReturnPct`/`maxDrawdownPct`/`tradeCount`/`winRatePct`/`profitFactor`（`types.ts:143-150`） |
| Comparison | 🔴 分布 / CI / 尾部概率（相对 `baseline`） | ⚠️ 双容差稳定性（`|Δ| ≤ tol` ⇒ `withinTolerance`） |
| Result | ⚠️ 同 C-18.1（`types.ts:354-355` 策略身份必填） | ⚠️ 策略身份 + `sourceSearchRunId`（`types.ts:416-417`） |
| Artifact | ❌ 零持久化 | ✅ 三表 + 6 端点 + 前端 |

---

## 5. Q2 —— 核心语义判断

> **`robustness/**`（C-18.1）的核心语义确实是：
> `Baseline → 改变合理条件 → 重新计算 → 比较结果 → 判断稳定性`。**
>
> 依据（三条，均为代码事实）：
> 1. **有真基准**：`perturbations[0]` 恒为基准实体（`×1` / 原配置），不是「上一轮结果」（`types.ts:129-130`、`evaluate.ts:163-165`）；
> 2. **有真重算**：逐条调用**注入的** `evaluator(item)`，基准也重算（索引 0 走同一条路径）⇒ 不是「拿旧结果做算术」（`evaluate.ts:199-239`）；
> 3. **有真比较 + 稳定性判定**：`drift` 相对基准 + 阈值 ⇒ 逐样本 `verdict` + 轴级 `verdict`（`drift.ts:156-329`）。

⇒ 记录为：

```text
Robustness 的核心方法具有跨阶段通用性。
```

🔴 **不得因为当前调用方是 Strategy 就认定它只能用于 Strategy** —— 这一点有**独立的反证**：
`runRobustnessStress` 的 `evaluator` 是**参数**而不是内部实现（`types.ts:104`、`evaluate.ts:154-156` 只校验 `typeof === "function"`），
它**不知道也不需要知道**「重算」意味着回测还是重跑研究实验。**「被验证对象」是通过接缝注入的，不是写死在核心里。**

---

## 6. Q5/规格 §5 —— 策略专用硬编码分类

搜索 `strategyId` / `strategyVersion` / `parameterSearch` / `backtestRun` / `portfolio` / `trade` / `equity` / `position` 的实测命中：

| 词 | `robustness/` | `searchRobustness/` | `stochasticRobustness/` |
|---|---:|---:|---:|
| `strategyId` | 6 | 7 | 6 |
| `strategyVersion` | 6 | 8 | 6 |
| `parameterSearch` | 3 | **45** | 2 |
| `backtestRun` / `portfolio` / `tradeSimulation` / `leaderCandidate` | **0 / 0 / 0 / 0** | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `trade` | 14 | 38 | **121** |
| `equity` | 1 | 0 | 9 |
| `position` | 6 | 0 | 0 |

### A. 真正属于 Robustness 通用机制（可直接跨阶段复用）

| 机制 | 位置 |
|---|---|
| baseline-first 约定 + 「恰 1 条基准」校验 | `evaluate.ts:163-188` |
| **注入式 evaluator 接缝**（唯一的「重算」抽象点） | `types.ts:104`；`evaluate.ts:154-156`、`:199-239` |
| 变体清单的存在性 / 同轴校验 + 退化输入**结构化抛错** | `evaluate.ts:159-197`（`RB18_REQUEST_*` / `RB18_AXIS_MIXED`） |
| **基准失败 ⇒ 拒绝出结论**（`RB18_BASELINE_FAILED`，「漂移无锚点」不产出无意义结论） | `evaluate.ts:13-14`、`:241-242`；`drift.ts:17`、`:329` |
| 失败样本**转记而非吞掉**（evaluator 抛错 / 返回 failed / 产物非法 ⇒ 都记成 `failed` 样本） | `evaluate.ts:199-239` |
| 逐样本 verdict + 轴级结论聚合（含 `insufficient` / `no-variants` 的**如实**表达） | `types.ts:188-244`；`drift.ts:329` |
| canonical 序列化 + sha256 指纹 + round-trip 复核 | `serialize.ts:68`、`:140`、`:305` |
| 确定性（注入 `createdAt`/`runId`，禁 `Date.now`/`Math.random`） | `evaluate.ts:19-20`（文件头纪律）；全目录**零 IO** |

### B. 当前策略阶段业务适配

| 适配 | 位置 |
|---|---|
| 4 轴词表全部是策略执行语义（成本 / 滑点 / 策略参数 / 执行约束） | `types.ts:66`、`:69-74` |
| 变体配置类型 = `CostModelDeclaration` / `ResearchParameterSet` / `ExecutionConstraintDeclaration` | `types.ts:39-42`、`:138-142` |
| 逐轴配置校验（`assertValidCostModelDeclaration` / `assertValidExecutionConstraintDeclaration`） | `evaluate.ts:104-120` |
| 指标视图 = 交易三标量；比较阈值 = 收益 / 回撤 | `types.ts:85-92`、`:149-160` |
| 身份字段 = `strategyId@strategyVersion` | `types.ts:268-269`、`:298-299` |
| 前端接入点 = `ParameterSearch.tsx:236`（技术预览页） | — |

### C. 两者耦合，需要未来解耦（**记录具体文件与原因，本轮不改**）

| # | 耦合点 | 文件:行号 | 原因 |
|---|---|---|---|
| **C-1** | **「扰动配置 → 绩效」的映射逻辑落在 router 而不是适配层** | `server/paramSearchRouter.ts:596-606`（`perturbationToBacktestOptions`，**按轴 switch**）、`:609-634`、`:638-655`（`precomputePerturbationOutcomes`，调 `getLeaderCandidateBacktest`） | 注入的 evaluator 闭包本身只做 Map 查表（`paramSearchRouter.ts:1142-1143`），真实映射散在同文件 3 个函数里 ⇒ **新增轴必须同步改 router**；「新增轴要改几处」的答案里有一半在策略侧 |
| **C-2** | **`overfittingDetection` 复制了第二套漂移判定** | `server/research/overfittingDetection/parameterSensitivity.ts:143`（`bridgeEvaluator`）、`:159`（`computeDrift`）、`:173`（`applyDriftThresholds`） | 它**复用**了 C-18.1 的扰动生成器（`:352` 调 `generateParameterPerturbationVariants`）与阈值常量，但**没有复用** `computeRobustnessDrift` / `assessRobustnessSensitivity` ⇒ **同一套漂移语义在仓内有两份实现**。这是「先解耦再复用」的最强动机，也是既有的**重复实现先例** |
| **C-3** | **单轴约束与「多维网格」不兼容** | `evaluate.ts:174-178`、`drift.ts:305-318`（`RB18_AXIS_MIXED`） | 研究侧的多维矩阵（如 5 时点 × 3 组 × 3 视界）天然是**一个网格**；现有约束要求「一次一轴」⇒ 要么上层跑 N 次，要么放宽 |
| **C-4** | **`RobustnessAxisConfigMap` 与 `PerturbationItem` 判别联合是「轴 ⟺ 配置类型」硬绑定** | `types.ts:69-74`、`:138-142` | 加一个「不透明配置」的通用轴会破坏现有判别收窄（TS 无法再用 `item.config` 的类型推断）⇒ 需要一个**泛型 / 不透明 JSON 轴**，而不是往联合里塞 |

> **纪律**：以上 4 条**只是登记**。规格 §8「不为了『通用化』提前重构」与 §12「先审计事实，再决定架构」⇒ **本轮不执行任何解耦**。

---

## 7. 关键证据 —— 核心比较机制**从未**跨域复用

这是本次审计最有价值的一条事实，也是「结论 B 而非 A」的核心依据。

**全仓非测试文件对 `../robustness` 的 import 只有 4 处**，分别是：

| 文件:行号 | 引入了什么 | 是否复用了「比较 / 判定」核心 |
|---|---|---|
| `server/research/overfittingDetection/parameterSensitivity.ts:31-38` | `generateParameterPerturbationVariants`（**生成器实现**）+ `type PerturbationItem` / `RobustnessEvaluator` / `RobustnessMetricsView` + 两个缺省阈值常量 | ❌ **否**（自己写了 `computeDrift:159` / `applyDriftThresholds:173`） |
| `server/research/overfittingDetection/types.ts:53-56` | 仅两个 `DEFAULT_*` 阈值常量 | ❌ 否 |
| `server/research/factorAblation/adapt.ts:36-39` | 仅两个 `DEFAULT_*` 阈值常量（`toAblationRobustnessView:49` 自造投影） | ❌ 否 |
| `server/walkForwardRouter.ts:71-75` | `generateParameterPerturbationVariants` + 两常量（注入给 **C-20.1** `runOverfittingDetection`，**不经** `runRobustnessStress`） | ❌ 否 |

**独立复核（本轮亲验）**：三个核心符号在 `robustness/**` 之外**全仓 grep 0 命中**——

| 符号 | 定义 | `robustness/**` 外的命中 |
|---|---|---|
| `assessRobustnessSensitivity` | `drift.ts:329` | **0**（仅 `evaluate.ts` 自用 + 自身单测） |
| `computeRobustnessRunFingerprint` | `serialize.ts:68` | **0**（仅 `evaluate.ts:256` + `serialize.ts:305` 自用 + 单测） |
| `computeRobustnessDrift` | `drift.ts:156` | **0**（仅 `drift.ts:224` 自用 + 单测） |

⇒ **结论：跨域被复用的只有「变体生成」这一半和「阈值常量」，而「比较 → 判定 → 结论 → 指纹」这一半从未离开过自己的目录。**
已有复用先例**只证明了生成器可用**，**没有证明判定机制可用** —— 后者恰恰是 EXP-002 真正需要的那一半。
（同时它也是一条**架构信号**：真正的复用发生在有人**愿意绕开核心**的时候。）

---

## 8. 研究侧现状 —— 零 Robustness 能力，且有两个必须澄清的发现

### 8.1 研究实验体系当前**没有任何** Robustness 概念（实测 grep）

| 目标 | `robust` / `variant` / `baseline` / `sensitivity` / `stability` 命中 |
|---|---|
| `shared/researchExperimentsContracts.ts` | **0** |
| `research-experiments/`（作者面） | **0**（仅 `page.tsx` 的 `Badge variant=` UI 属性） |
| `server/researchExperiments/**`（runtime） | **3 处，全非能力**（`persistence/runId.ts:5` 注释；`strategyBridge.ts:72,196` 复用 `searchRobustness/canonical` 的 canonicalizer） |
| `docs/research/EXPERIMENT-CODE-SPEC.md` | **1 命中**（见 §8.2） |

### 8.2 🔴 发现 P1-1：规范里「不碰 Robustness」的**口径歧义**（会被误读成「不许做研究侧鲁棒性」）

`docs/research/EXPERIMENT-CODE-SPEC.md:559`（§M 禁止事项表）原文：

> | 改 Strategy Core / 重做 Parameter Search / Backtest / OOS / Walk-Forward / **Robustness** | 本体系不碰这些能力 |

**准确口径应为**：禁止的是「**重做 / 修改**这些能力」（动作是 `改` / `重做`），
**不是**禁止研究侧**消费**鲁棒性方法。若不澄清，EXP-002 的作者按此表操作时会得到一个**过度禁止**的结论
（「本体系不碰 Robustness」⇒ 连调用都不该）。**建议**：把该行改为「**改 / 重做** `Strategy Core` / `Parameter Search` / `Backtest` / `OOS` / `Walk-Forward` / `Robustness` **模块本身**」，
并补一句「研究侧**可以**消费其方法（见 `ROBUSTNESS-CROSS-STAGE-001`）」。**本轮不改**（只读审计）。

### 8.3 🔴 发现 P1-2：「研究发现稳定性」在活模块里是一个**只声明、无生产者**的类型

```text
server/research/vocabulary.ts:733   export interface ResearchFindingStability { dimensionKey; slices[]; stable; contradicted; consistentRatio }
server/research/vocabulary.ts:799   stability?: ResearchFindingStability | null;   // ResearchFinding 的可选字段
```

全仓 `ResearchFindingStability` **只有这 2 处命中**（声明 + 作为字段），**没有任何生产者**（无赋值、无构造、无回填）。
其文档注释写明设计意图：**「时间稳定性（§11）。第一版至少完成时间维度（年）」** ——
即「把一个 Finding 的效应**按年切片**、看各切片是否同号、标记 `stable` / `contradicted` / `consistentRatio`」。
**这正是 EXP-002 要做的事，只是切片维度换成「样本条件 / 观察窗口」。**

⚠️ **必须同时说清它的真实处境**（否则会高估这条发现）：
`vocabulary.ts` **是活模块**（`ResearchStrategyCandidate` 被 **9 个生产文件** import：
`research/{candidateRepository:51, candidateRules:12, conditionSet:22, patternLibrary/moduleRegistry:42, patternLibrary/types:47,`
`strategyCandidate/{candidateTypes:17, definitionBuild:34, service:29}}`、`researchExperiments/strategyBridge.ts:62`），
但承载它的 `ResearchFinding` 属**旧 Research 体系**（`server/researchCore/**` 与 `server/researchEngine/**` 已于 `9cg` 整体删除）。
⇒ 该字段是**双层孤儿**：**既无生产者，其宿主接口也已退役**。**不得**据此认为「研究侧已有稳定性能力」。

### 8.4 EXP-001 自身**不是**「改条件 → 重算 → 比较」的雏形

实测：`experiment.ts:421-424` 自述派生量**「一次算好，所有表共用」**；
`result.ts:2479-2509` 的 `decisionConditionMatrix` 自述**「与表同一份行数据投影（不重算）」**；
`nonBreakVsBreak` / `byDecisionDay` / `horizonDataQuality` 都是**同一次 Run 内的横向分组维度**。

⇒ 它们是**样本内的横向描述统计**，**缺少**「改变条件后**重新计算**」与「**基线 vs 变体**稳定性比较」两个动作。
**本仓唯一既有的「改条件 → 重算 → 比较」先例**是 `server/research/oosValidation/comparison.ts:68`（IS/OOS 重跑对照）
与 `server/research/factorAblation/**`（成分消融，**但未接线**：`DOMAIN-MAP.md:174` / `SYSTEM-BASELINE.md:269` 标注「仅测试可达」，`RESEARCH-PATTERN-LOOP-AUDIT-001.md:143` 记「全库无生产调用方」）。
二者**都不在实验框架内**。

---

## 9. 规格 §7 —— 现有 Robustness 具备「研究发现稳定性」所需的能力吗

| 需求（规格 §7） | C-18.1 现状 | 判定 |
|---|---|---|
| Baseline vs Variant | 位置约定 + 计数校验（`evaluate.ts:163-188`） | ✅ **有** |
| 多维条件变化 | 🔴 **一 Run 一轴**（`RB18_AXIS_MIXED`）；轴词表封闭 4 个策略执行轴 | ⚠️ **部分**（机制上「变体集」可任意长，但轴维度被限制） |
| 重新执行 | ✅ 注入式 evaluator；基准也重算；零 IO（`types.ts:104`、`evaluate.ts:199-239`） | ✅ **有** |
| 结果比较 | ✅ 相对基准的差值 + 阈值 ⇒ 逐样本 / 轴级 verdict（`drift.ts:156-329`） | ⚠️ **有机制**，但**语义绑定收益 / 回撤** |
| 样本量 | ⚠️ 有 `tradeCount`，但它**只用于「活动不足」判定**，不做样本账（`searchRobustness` 才有 `sampleCount` / `validNeighborCount`） | ⚠️ **弱**（研究侧必需「样本账必须平」的纪律） |
| 结果聚合 | ✅ `conclusion` 逐轴计数 + `sensitiveEntries`（`types.ts:227-244`） | ✅ **有** |
| Artifact | 🔴 **零落库 / 零对象存储 / 零 migration**（`evaluate.ts:244-257`） | ❌ **无**（但研究实验体系**已有** `research_experiment_run` + MinIO ⇒ 可挂载） |

**能否表达 `dimension → variants → run → compare`？**
**能 —— 但只能沿现有 4 个策略轴。** 研究侧需要的 `T+1…T+5` / 不同观察窗口 / 不同时间区间 / 不同样本条件
**不是这 4 个轴中的任何一个**，而现有联合类型**不允许**直接塞入（`types.ts:66` 是封闭字面量联合）。

⇒ **「能表达这个形状」成立，「能表达这个内容」不成立** —— 这正是 **B** 的判定依据。

---

## 10. 规格 §4/§6 —— 代码复用判断：**结论 B**

```text
B — 核心可复用，但需要轻量适配
```

**为什么不是 A（可以直接复用，EXP-002 只当作调用对象）**：
A 的成立条件是「已提供足够通用的 Baseline / Variant / Dimension / Execution / Comparison / Result」。实测**五缺四**：
`Dimension` 封闭为 4 个策略执行轴（`types.ts:66`）、`Metrics` 恰 3 个交易标量（`types.ts:85-92`）、
`Comparison` 阈值是收益 / 回撤（`types.ts:149-160`）、`Result` 身份字段是 `strategyId@strategyVersion`（`types.ts:268-269`）、
且**强制单轴**（`evaluate.ts:174-178`）与**零持久化**（`evaluate.ts:244-257`）。
⇒ **EXP-002 不可能「什么都不改就直接把它当调用对象」。**

**为什么不是 C（实际上是 Strategy 专用，必须另写一套）**：
C 的成立条件是「核心执行机制**无法脱离** Strategy / Backtest / Parameter Search 独立工作」。实测**否**：
1. `runRobustnessStress` **零 IO、零 drizzle import、零 `Date.now` / `Math.random`**，
   `evaluator` 是**参数**而非内部实现（`types.ts:104`、`evaluate.ts:154-156`）⇒ **它不知道回测的存在**；
2. `searchRobustness/robustnessBoundary.test.ts:72-82` 用 import 黑名单证明「零重跑」是**结构事实** ——
   这反过来证明**黑名单能被写出来**，是因为 `robustness/**` 自己**不 import** 那些模块；
3. **C-18.2 已在借用 C-18.1 的阈值与漂移类型**（`stochasticRobustness/types.ts:49`、`run.ts:21`）——
   这是「机制可被非策略搜索域消费」的**仓内先例**；
4. `overfittingDetection` / `factorAblation` / `walkForwardRouter` 已在消费它的**生成器**。

⇒ **核心方法可以脱离 Strategy 独立工作**（只是当前词表是策略的）⇒ **不是 C**。

**结论落点**：

```text
Robustness Core 可以跨阶段复用；
Research / Strategy 只提供各自的「被验证对象 + 变体生成器 + 指标视图 + 容差口径」。
```

⚠️ 但必须如实补一句：**现有 `robustness/**` 不是那个已经抽好的 Core，而是「形状对了、词表是策略的」Core。**
把它变成可跨阶段共享，**需要最小适配（§11），而不是再写一套**。

---

## 11. 规格 §5 —— 最小适配点（**仅列出，本轮不执行**）

> 纪律依据：规格 §8「不为了『通用化』提前重构」、§12「先审计事实，再决定架构」。
> 下列改动**不在本审计范围内**，仅供 EXP-002 立项时按需取用。

| # | 适配点 | 现状（文件:行号） | 最小改动方向 |
|---|---|---|---|
| **1** | **轴词表封闭** | `types.ts:66`（4 字面量）、`:69-74`（配置映射）、`:138-142`（判别联合） | 新增**一个不透明通用轴**（config = 可 JSON 序列化的不透明对象），或把轴类型参数化。**代价**：`evaluate.ts:104-120` 的 switch、`serialize.ts` 的指纹范围需同步；TS 判别收窄会变弱（见 C-4） |
| **2** | **变体配置按轴硬校验** | `evaluate.ts:104-120`（`cost`/`slippage` → `assertValidCostModelDeclaration`；`execution` → `assertValidExecutionConstraintDeclaration`） | 通用轴走既有 `assertSerializableParameterSet`（`evaluate.ts:64-94`）——**这条路径已经存在**，无需新写校验器 |
| **3** | **指标视图恰 3 标量** | `types.ts:85-92`；`drift.ts:49-70`（`validateRobustnessMetrics` 不容纳额外字段） | 引入「指标视图可扩展」（如按名取值的有限数字映射），或让研究侧把自己的统计量映射到既有 3 槽（**不推荐**：语义会撒谎） |
| **4** | **比较阈值绑定收益 / 回撤** | `types.ts:149-166`、`:173`（flag 仅 2 个）；`drift.ts:156-224` | 「按指标名声明容差」；flag 改为可扩展标签 |
| **5** | **强制单轴 + 身份字段** | `evaluate.ts:174-178`、`drift.ts:305-318`（`RB18_AXIS_MIXED`）；`types.ts:268-269`/`298-299`、`evaluate.ts:148` | 放宽为「多维变体集」或明确「上层跑 N 个单轴 Run」；把 `strategyId`/`strategyVersion` 泛化为「被验证对象身份」（如 `subjectId` / `subjectVersion`，保留向后兼容别名） |
| **6** | **零持久化** | `evaluate.ts:244-257`（只组装内存对象） | 🔴 **不需要给它补表** —— 研究实验体系已有 `research_experiment_run` + MinIO 产物端口（`9ch` 交付）⇒ **把 Run 结果挂到既有落库面**，避免制造第二套持久化 |

**预估改动面**：`server/research/robustness/{types,evaluate,serialize,drift}.ts` 4 个文件 + `overfittingDetection`（因 C-2 的第二套漂移实现将可回收）。
**不新建模块、不新建表、不改 migration。** 具体范围须在 EXP-002 立项时重新裁定（本节**不是**施工图）。

---

## 12. 规格 §9 —— 测试检查

| 模块 | 测试文件 | 覆盖 |
|---|---|---|
| C-18.1 | `tests/server/research/robustness/robustness.test.ts` | `runRobustnessStress` evaluator 调用契约（`:402`）、确定性（`:650`）、`assessRobustnessSensitivity` 直调（`:796`）、`computeRobustnessDrift`（`:485`、`:546`、`:553`）、指纹（`:596`）、四轴生成器 —— **核心链路有覆盖** |
| C-18.2 | `tests/server/research/stochasticRobustness/stochasticRobustness.test.ts` | 存在，未逐例展开 |
| ROBUSTNESS-001 | `tests/server/research/searchRobustness/{searchRobustness,robustnessBoundary}.test.ts` | 54 + 5 例（历史报告 §11 已记） |

**结论**：**核心链路（基准 / 变体 / 注入式评估 / 漂移 / 结论 / 指纹）已有测试覆盖**，
可支撑「机制是可复用资产」的判断。**本轮未新增测试、未跑完整回归**（规格 §9 明确不要求）。
⚠️ **未验证项（如实登记）**：C-18.1 / C-18.2 的**行为**在真实数据上的表现**未被本轮复核**
（项目记录里它们标注为「仅测试可达 / 技术预览」，`factorAblation` 明确记「全库无生产调用方」）⇒
「可复用」是**结构性**判断（基于纯函数 + 注入接缝），**不是**「已在生产验证过」的判断。

### 12.1 ⚠️ 本轮对账闸门自身写错的 4 条判据（必须登记「为什么错」）

本报告的所有 `文件:行号` 与数字由一次性闸门 `_scratch/check_robustness_cross_stage_audit.py` **从真实文件与探针 JSON 现读**校验
（**75 / 75 PASS**，退出码 0；且**闸门自身可证伪**：把探针里 `search_robustness_run` 计数改为 99 后判据必然变红，已实测）。
**共 4 条 FAIL，全部是判据 / 修法自身写错，非报告写错** —— 其中 2 条在首跑暴露，2 条在修法回合中暴露：

| # | 写错在哪 | 为什么错 | 修法 |
|---|---|---|---|
| 1 | 断言 `robustnessBoundary.test.ts:**74**` 含 `strategyEvaluation` | 报告给的是**区间** `:72-82`，我却在判据里把**区间内的具体行号写死**。实测第 74 行是 `"backtest/types",` ⇒ **行号位移即恒假** | 新增 `has_range()`，判据改为「区间内出现即通过」（3 条：`RERUN_MODULES` / `strategyEvaluation` / `researchEngine`） |
| 2 | 断言 `vocabulary.ts` 被 ≥8 个生产文件 import，正则写 `from "(\.\./)+vocabulary"` | 正则**只认多级相对路径**，漏掉单点的 `from "./vocabulary"`（`candidateRepository.ts:51` / `candidateRules.ts:12` / `conditionSet.ts:22`）与带目录的 `from "../research/vocabulary"`（`researchExperiments/strategyBridge.ts:62`）⇒ 数出 **5**（真值 **9**）⇒ **假 FAIL** | 正则改为 `from "[^"]*vocabulary"`（不限定相对路径层级） |
| 3 | **修法自身写错**：在同一个循环里，先做「通用计数替换」（`59 → 75`），再做「整行替换」（CHANGE-AUDIT 的 Regression 行） | 通用替换**先把整行锚点里的旧数字改掉了** ⇒ 锚点失配 ⇒ `assert count == 1` 触发 | 调整顺序：**整行替换先行**，通用计数替换后做。⚠️ 这一条**是 assert 抓住的** —— 若当初写的是「无条件 replace」而不是「assert count == 1」，这里会**静默漏改一行** |
| 4 | 🔴 **横切一致性判据的 needle 写得太松**：用 `f"{N} / {N}"`（不带 `PASS`）去断言每个文档都含该串 | `ROADMAP-CHANGELOG.md` 里有一行**与本题完全无关**的历史数字（`质量复合 37.56% / 75 / 75 / 668.84%`，且该行本身还是乱码）恰好含 `75 / 75` ⇒ **判据被假 PASS**。这正是「断言匹配到了错误的东西」—— 比假 FAIL 更危险 | needle 收紧为 `f"{N} / {N} PASS"`；并把各文档的表述**统一为一个 canonical 形式**（`75 / 75 PASS`），消除「同一事实多种写法」的分叉面 |

🔴 **4 条的同一病因**：**把「我当时看到的那一行 / 那几种写法 / 那个子串」当成「契约本身」** ——
第 1 条把区间当点，第 2 条把「恰好在 grep 里看到的那几种写法」当成全部写法，
第 3 条假设「替换顺序无关」，第 4 条假设「子串 `N / N` 只可能出现在我要断言的地方」。
这与项目历史记录的病灶一致（`9cj` 的 9 条判据作废里有 5 条是「把实现里的一个口径当成世界的唯一口径」）。
**危害不低于产品缺陷**：一条恒假的判据挂在「已验证」清单里，等于在回归闸上挖了个洞；
而第 4 条更糟 —— 它是**假 PASS**，让人以为已经核过。

### 12.2 🔴 一条「关于自身副作用」的断言，被自己的后续动作推翻（本轮第 5 次自纠）

报告与台账在写作时断言「`git status --porcelain` **零已跟踪文件被修改**」。
该断言在**写作时刻为真**，但紧随其后的**台账登记**（规格 §11 明确要求）修改了 4 个已跟踪的**文档**文件
⇒ 该断言**事后不再成立**。

这不是「数字算错」，而是**一个关于自身副作用的断言被自己的后续动作推翻**。
修法**不是删掉这句话**，而是换成**事后仍成立、且更精确**的判据：
「审计本身未改任何**生产代码 / 契约 / DB**」—— 对 `server/ shared/ client/ tests/ drizzle/ scripts/`
逐条比对 `git status --porcelain`，并**显式列出**台账面被修改的 4 个文档文件。
🔴 闸门已为这一点加了 5 条判据（报告本身 + 4 个文档**不得再出现**那句被推翻的旧断言），
即「**修好之后还要防止它被写回去**」。

---

## 13. 真库实测（`docs/evidence/_probe_robustness_cross_stage_state.mts`）

**运行时刻**：`2026-09-21T04:00Z`（≡ 北京时间 12:00）。⚠️ 本仓常有并行会话写入，下图为**该时刻快照**，非全库绝对状态。

| 实测项 | 结果 |
|---|---|
| 形状自检（`normalizeRows` 口径） | `unwrapped = true`（`select 1 as a,'x' as b` → `[{a:1,b:"x"}]`）⇒ 排除「全读成 0」的假结论模式 |
| 全库 `%robust%` 表 | **恰 3 张**：`search_robustness_run` / `_result` / `_parameter_analysis` |
| 行数 | `run` = **0** ｜ `result` = **6** ｜ `parameter_analysis` = **3** |
| C-18.1 期望表（`robustness_run` / `robustness_sample`） | **均不存在** ⇒ **零持久化 = 真库实测事实**（不只是「代码看起来没写」） |
| C-18.2 期望表（`stochastic_robustness_run`） | **不存在** ⇒ 同上 |
| `search_robustness_run` 状态分布 | **空**（0 行） |
| `parameter_search_run` 新增两列 | `referenceCheckApplied`（`tinyint(1) NULL`）、`unreferencedTunableCodesJson`（`longtext NULL`）**均存在** |
| `parameter_search_run` 参数引用状态 | 共 **5** 个 Run：`referenceCheckApplied IS NULL` = **3**、`= 1` = **2** ⇒ **3/5 历史 Run 处于「参数引用未验证」**（与 ROBUSTNESS-001 §12 的继承口径一致） |
| 查询错误 | `errors = []`（0 条） |

### 13.1 🔴 附带发现 P2-1：`search_robustness_*` 子表存在**孤儿行**（父表 0 行）

```
orphanResultGroups:
  SROB-20260920-aa5decfc   2 行   2026-09-20 10:47:30
  SROB-20260920-70c8cdcf   2 行   2026-09-20 10:51:32
  SROB-20260920-3281b6de   2 行   2026-09-20 10:55:07
orphanResultRowCount              = 6
orphanParameterAnalysisRowCount   = 3
```

**事实**：`search_robustness_result` 6 行 + `search_robustness_parameter_analysis` 3 行的 `robustnessRunId`
在父表 `search_robustness_run` 里**找不到对应行** ⇒ 父表 0 行、子表 9 行。

**为什么看不出来**：三张表是 **0 FK** 设计（ROBUSTNESS-001 报告 §5 明写「三张新表 0 个；全库 FK 总数 = 0」）
⇒ 删父行**不会级联**，DDL 层面完全看不出这类残留。

**根因（**未完全验证**，但证据指向明确）**：`ROBUSTNESS-001-REPORT.md` §10.3 记载其 E2E「**自建自清**：
探针专属策略 / Search Run / **3 个 Robustness Run 全部归零**（`check` 断言通过）」——
**孤儿组数恰为 3，与「3 个 Robustness Run」数量吻合**，时间戳（2026-09-20 10:47~10:55）也落在 `9bu` 的 E2E 窗口内。
⇒ **高度指向：`9bu` 的清理只删了父表行，子表 9 行残留至今。** ⚠️ 但「清理脚本只删父行」这一步**未直接读代码验证**，故登记为**推断**而非结论。

**影响**：**低**（不影响任何读写路径；`search_robustness_result` 的 UNIQUE 是 `(robustnessRunId, parameterHash)`，同一 runId 重跑会被 upsert 覆盖）。
**本轮未清理**（只读审计，且清理属写操作 ⇒ 需显式指令）。
**建议**：把「0 FK 下的清理完整性」写进 Robustness 域的检查清单（父删子删，或加一条孤儿断言）。

---

## 14. 问题清单（P0 / P1 / P2）

| 级别 | # | 问题 | 证据 | 本轮处置 |
|---|---|---|---|---|
| **P0** | — | **无。** 没有任何阻断「EXP-002 该怎么做」这一目标成立的问题 | — | — |
| **P1** | P1-1 | 规范口径歧义：`EXPERIMENT-CODE-SPEC.md:559`「本体系不碰 … Robustness」会被误读为**禁止研究侧消费**鲁棒性方法（实际禁的是**改 / 重做模块本身**） | §8.2 | **只登记**（只读审计） |
| **P1** | P1-2 | `ResearchFindingStability`（`vocabulary.ts:733`）在**活模块**里只声明、**无生产者**，且宿主接口 `ResearchFinding` 属已退役旧 Research ⇒ **双层孤儿**；若不登记，EXP-002 会被误认为「已有能力、直接接上」 | §8.3 | **只登记** |
| **P1** | P1-3 | **核心比较机制从未跨域复用**（`assessRobustnessSensitivity` / `computeRobustnessDrift` / `computeRobustnessRunFingerprint` 在 `robustness/**` 外 **0 命中**），且 `overfittingDetection` **复制了第二套漂移判定** ⇒ 同一语义仓内两份实现 | §7、§6.C-2 | **只登记**（解耦属未来任务） |
| **P1** | P1-4 | 「扰动配置 → 绩效」映射逻辑落在 **router**（`paramSearchRouter.ts:596-606` / `:609-634` / `:638-655`）而非适配层 ⇒ 核心的「轴词表」与策略侧 switch **必须同步改**，是一处**跨文件隐式耦合** | §6.C-1 | **只登记** |
| **P2** | P2-1 | `search_robustness_*` 子表 9 行孤儿（父表 0 行），0 FK 无级联 ⇒ 只能靠专门查询发现 | §13.1 | **只登记**（写操作需显式指令） |
| **P2** | P2-2 | 三模块并行导致的**概念负载**：「Robustness」在本仓指三种**语义互不相同**的东西（四轴扰动重估 / 随机化重估 / 冻结结果邻域分析）⇒ 沟通时若不指明模块名极易误解 | §2 | **只登记** |

---

## 15. 规格 §7 —— 最终建议（**只给下一步，不提前执行**）

1. **EXP-002 的架构前提已明确**：走 **B 路线** —— **复用 Robustness 方法，不新写一套**。
   但**不得**把现有 `robustness/**` 当作「现成 Core」直接调用（它会拒收研究侧的变体与指标）。
2. **立项时先做的一件事**：把 §11 的 6 个适配点**收敛成一份施工清单**，并**重新裁定取舍** ——
   特别是适配点 **5（单轴 vs 多维网格）** 与 **3（指标视图）**，它们决定 EXP-002 是「跑 N 个单轴 Run」还是「一个 Run 出一个矩阵」。
   ⚠️ 这两种形态的**统计口径不同**（前者每个 Run 有独立基准，后者共享基准）⇒ **必须先定，再写代码**。
3. **优先处理 §11 适配点 6 的反向结论**：**不要给 C-18.1 补持久化表** ——
   研究侧的 Run 落库面（`research_experiment_run` + MinIO）已经存在且已投产（`9ch`/`9ci`/`9cj`），
   再给 C-18.1 补一套表会造出**第二套 Robustness 持久化**。
4. **建议把 P1-3 / P1-4 登记为一条独立技术债任务**（不属本轮）：把 `overfittingDetection` 的第二套漂移判定**回收**到 `robustness/**`，
   并把 router 里的按轴 switch 上移到适配层。**这是「让 B 真正变成 A」的唯一路径** ——
   但**必须等第 2 条定稿后**再做，否则会为错误的抽象层白做一次。
5. **建议顺手修 P1-1 的文档口径**（一行文案），避免 EXP-002 作者被规范误导。**属独立小项。**
6. **不要**在本轮或下一步顺手「为了通用化」重构 `robustness/**`（规格 §8 / §12）。

---

## 16. 规格 §11 —— ROADMAP 登记

- **判定**：检索 §44.5「未完成队列」**不存在**与本审计对应的任务（robustness 相关条目 `9bu` / `9bt` 均为 ✅ 已完成；
  `9ax` ⬜ 待做的「闭环 `robustness` 阶段接线」是**另一件事**：把既有执行器接到闭环编排，**不是**跨阶段复用审计）。
  ⇒ 按规格 §11「如果没有对应任务，才登记一个最小审计记录」，**登记一条最小审计记录，不新建重复任务**。
- **编号**：按 §44.5 台账「下一个未占用」取 **`9ck`**（台账现状：已用至 `9cj`；**禁「末条 +1」**）。
- **状态**：`ROBUSTNESS-CROSS-STAGE-001 = AUDIT_COMPLETE`。
- 🔴 **`EXP-002` 未被标记为开始**（规格 §11 末句、§18 停止边界）。

---

## 17. 未做与边界（如实登记）

| # | 未做 | 原因 |
|---|---|---|
| 1 | 未创建 / 未实现 EXP-002 | 规格 §8 明禁 |
| 2 | 未修改 `robustness/**` / `stochasticRobustness/**` / `searchRobustness/**` 任何一行 | 规格 §8；纯只读 |
| 3 | 未建表 / 未 migration / 未新增写口 | 规格 §8 |
| 4 | **未在本轮执行 §11 的任何适配点** | 规格 §8「不为了通用化提前重构」、§12「先审计事实，再决定架构」 |
| 5 | **未验证 C-18.1 / C-18.2 在真实数据上的行为**（它们是「仅测试可达 / 技术预览」，`factorAblation` 记「全库无生产调用方」） | 规格 §9 不要求跑完整回归；「可复用」是**结构性**判断 |
| 6 | **未直接读代码验证 P2-1 的清理脚本**（根因靠「孤儿组数 3 ↔ 报告记『3 个 Robustness Run』」的数量吻合推断） | 已在 §13.1 显式标注为**推断**而非结论 |
| 7 | 未清理 P2-1 的孤儿行 | 写操作，需显式指令 |
| 8 | 未复核 `stochasticRobustness` 与 `searchRobustness` 的单测逐例 | 与本审计的裁决无关（裁决只需结构性事实） |

---

### 附：本审计交付物

| 类别 | 文件 |
|---|---|
| 报告（新增） | `docs/research/ROBUSTNESS-CROSS-STAGE-001.md`（本文件） |
| 只读探针（新增） | `docs/evidence/_probe_robustness_cross_stage_state.mts` + `.out.json` |
| 只读机器证据 | **生产代码 / 契约 / DB 零改动**：`git status --porcelain -- server/ shared/ client/ tests/ drizzle/ scripts/` 与审计开始前**逐行相同**；`node scripts/checkEolDrift.mjs`（**0 / 0**）。⚠️ 台账面按规格 §11 修改了 4 个**文档**文件（见 §1） |
