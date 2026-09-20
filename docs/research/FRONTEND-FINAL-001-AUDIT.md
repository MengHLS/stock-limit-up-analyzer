# FRONTEND-FINAL-001 — 前端现状审计报告（阶段一）

- **审计对象**：`stock-limit-up-analyzer` 前端（`client/**`）对照后端 `server/**` 实际能力
- **审计时间**：2026-09-20 12:2x–12:4x（CST）
- **审计性质**：**纯只读**。零文件修改、零 DML、零 migration、零 install
- **基线**：工作树当前状态（HEAD + 另一会话在途的 `9cc` 改动，见 §1.2）
- **规格来源**：用户提供的《FRONTEND-FINAL-001 — 量化研究平台前端完整闭环升级》§一
- **证据源**：① 5 轴并行代码取证（每条结论带 `文件:行号`）；② 真库只读探针
  `docs/evidence/_probe_frontend_final_001_state.mts` → `_probe_frontend_final_001_state.out.json`
  （2026-09-20T04:30Z，0 错误 / 1 条已知失败查询，见 §7）

> 本报告只回答规格 §一（现状盘点 + Capability Matrix）与「是否具备进入实现阶段的条件」。
> **未实现任何代码改动**；§9 给出实现阶段的 P0/P1 顺序与边界。

---

## 1. Executive Summary

### 1.1 一句话定性

**前端不是「缺页面」，而是「缺主线」**：16 个模块里 13 个已经有真页面、真接口、四态俱全，
真正的问题集中在三处——**验证域（OOS / Walk-Forward）没有属于自己的可达入口且被挂在了语义错位的导航下**、
**参数链最关键的一环「实际消费参数」前后端都不存在**、以及**验证域真库零留档导致这些面板从未显示过真实数据**。

### 1.2 基线与工作树事实（先决条件）

| 事实 | 实测值 | 出处 |
|---|---|---|
| 工作树已跟踪文件被修改 | **14 个**（`server/researchEngine/conclusion.ts`、`server/runWorkbenchAssembly/assemble.ts`、`shared/patternSemantics.ts` 等） | `git status --porcelain`，本次审计开始时 |
| 这些改动的归属 | **另一会话在途的 `9cc` 工作**，非本次审计产生 | 同上 |
| 本次审计对仓库的写入 | **仅 2 个新文件**（本报告 + 探针），**零已跟踪文件修改** | `git status --porcelain`，见 §8 |
| 前端页面文件 | 31 个 `*.tsx`（3 个在子目录：`datasets/` 4、`research/` 5） | `find client/src/pages -name "*.tsx"` |
| 路由条目 | 33 条（含 2 条遗留 Redirect、1 条 404、1 条通配） | `client/src/App.tsx:74-126` |
| 侧栏导航 | 5 个分组 / 22 个条目 | `client/src/components/AppShell.tsx:63-116` |
| 前端调用的 tRPC 命名空间 | **19 个** | `grep -rhoE` 全量统计 |
| `components/` 休眠组件 | **0 个**（`research/` 42 文件、`strategy/` 12 文件、`oos|walkForward|robustness|parameterSearch` 各 1 文件，全部有非 barrel 消费者） | 逐文件 grep import |

### 1.3 真库现状（决定「哪些页面现在能看到东西」）

| 表 | 行数 | 判读 |
|---|---:|---|
| `research_experiment` | 7 | 有数据 |
| `research_run` | 17 | 有数据 |
| `research_analysis` | 351 | 有数据 |
| `research_finding` | 68（DISCOVERED 67 / REJECTED 1） | 有数据 |
| `research_conclusion` | 15 | 有数据（但 §15 五件套几乎全空，见 §5.2） |
| `research_artifact` | 38 | 有数据 |
| `research_strategy_candidate` | 13（CONVERTED 9 / DRAFT 3 / ARCHIVED 1） | 有数据 |
| `strategy_versions` | 11（Draft 10 / Validated 1；`datasetVersionId` 空 **0**） | 有数据 |
| `strategy_parameters` | 24，`distinct parameterRole` = **仅 TUNABLE** | 有声明 |
| `parameter_search_run` | 3（COMPLETED 1 / FAILED 1 / CANCELLED 1） | 有数据 |
| `parameter_search_combination` | 12（SUCCEEDED 4 / PENDING 4 / FAILED 4） | 有数据 |
| `parameter_search_result` | 8（SUCCEEDED·canonical 4 / FAILED·evaluators 4） | 有数据 |
| **`oos_validation_run`** | **0** | 🔴 **从未有留档** |
| **`oos_validation_result`** | **0** | 🔴 同上 |
| **`walk_forward_run`** | **0** | 🔴 同上 |
| **`walk_forward_fold`** | **0** | 🔴 同上 |
| **`search_robustness_run` / `_result` / `_parameter_analysis`** | **0 / 0 / 0** | 🔴 同上 |
| `dataset_definition` / `dataset_version` / `dataset_build_job` | 1 / 2 / 4 | 有数据 |
| `closed_loop_backtest_run` / `backtest_runs` | 8 / 1 | 有数据 |

**关键推论**：`/parameter-search` 页内嵌的 **稳健性 / OOS / Walk-Forward 三块面板当前必然全部显示空态**——
不是它们没实现，而是这三张运行表**从来没有过一条记录**（§1.3 五个 0）。
规格 §十三 要求「OOS 可查看 / Walk-Forward 可查看」，以当前库状态**无法用真实数据验收**。

---

## 2. 前端架构与业务主线（Architecture Map）

### 2.1 分层现状（按实际代码）

```
client/src/
├─ App.tsx                   33 条 Route（wouter），AppShell 包壳
├─ components/
│   ├─ AppShell.tsx          侧栏 5 组 22 项；onClick → setLocation（不用 Link）
│   ├─ common/               7 个通用原语（全被使用）: StatusBadge/MetricCard/EmptyState/
│   │                        ErrorState/TechnicalDetails/SectionCard/DataTable（+ SegmentForm 未进 barrel）
│   ├─ ui/                   shadcn 原子（含 breadcrumb.tsx — 0 使用）
│   ├─ datasetRegistry/      数据集注册表 UI
│   ├─ research/             研究线 UI（42 文件，全部有消费者）
│   ├─ strategy/             策略线 UI（12 文件，全部有消费者）
│   ├─ parameterSearch/      PersistedParameterSearchPanel（持久化搜索）
│   ├─ robustness/           SearchRobustnessPanel
│   ├─ oos/                  OosValidationPanel
│   └─ walkForward/          WalkForwardPanel
├─ adapters/                 7 个纯函数适配层（wire → ViewModel），零 tRPC、零 mock
└─ pages/                    31 页
```

### 2.2 规格主线的实际落点（逐环 × 前端宿主 × 真库数据）

| 主线环节 | 前端宿主（实际落点） | 真库数据 | 状态 |
|---|---|---|---|
| Dataset | `/datasets` → `/datasets/:id` → `.../versions/:versionId` | 1 / 2 / 4 | ✅ 通 |
| Research（提问式） | `/research/ask`（六步向导） | 3 plan / 3 question | ✅ 通 |
| Research（实验式） | `/research` → `/research/:experimentId` | 7 experiment / 17 run | ✅ 通 |
| Analysis | `ResearchDetail` 分析区 + `AnalysisResultsView` | 351 | ✅ 通 |
| Finding | `FindingsPanel`（**仅挂在实验详情页**） | 68 | ⚠️ 通但无独立页面 |
| Conclusion | `ConclusionPanel`（**仅挂在实验详情页**） | 15 | ⚠️ 通但无独立页面 |
| Candidate | `CandidatesPanel` + `/research/candidates/:candidateId` | 13 | ✅ 通 |
| Strategy | `/strategies` → `/strategies/:strategyId?version=` | 11 version | ✅ 通 |
| Parameter Search | `/parameter-search` 第 1 块 `PersistedParameterSearchPanel` | 3 run / 12 combo | ✅ 通 |
| Backtest / Evaluation | `StrategyDetail` 运行页签 + `/backtest-runs` + `/performance` | 8 / 1 | ✅ 通 |
| **OOS** | **`/parameter-search` 第 3 块** `OosValidationPanel`（**无独立路由**） | **0** | 🔴 见 P0-1/P0-3 |
| **Walk-Forward** | **两套并行实现**：`/walk-forward`（`walkForward.*` 内存态预览）+ `/parameter-search` 第 4 块 `WalkForwardPanel`（`paramSearch.*` 持久化） | **0** | 🔴 见 P0-1/P0-3 |
| Simulation | `/paper-trading`（`sentiment.*PaperTradingRun`） | — | ✅ 存在（本任务范围外） |

### 2.3 与规格参考架构的差异（显式登记）

规格 §二 给的是**单列线性主线**。实际代码是**两条并行口径**，这是本次审计最重要的结构发现：

| 能力 | 口径 A（技术预览，内存态） | 口径 B（持久化，落库） |
|---|---|---|
| 参数搜索 | `/parameter-search` 第 5 块（`paramSearch.run/rolling`，**不落库**） | 第 1 块 `paramSearch.createSearch/startSearch`（落 `parameter_search_*` 三表） |
| 稳健性 | — | 第 2 块 `paramSearch.createRobustnessRun`（落 `search_robustness_*` 三表） |
| OOS | — | 第 3 块 `paramSearch.createOosRun`（落 `oos_validation_*` 两表） |
| Walk-Forward | **`/walk-forward` 页**：`walkForward.describe/run/oos/overfit`（`server/walkForwardRouter.ts:403/453/600/619`，**不落库**，返回 `windows` 而非 fold） | 第 4 块 `paramSearch.createWalkForwardRun`（`server/paramSearchRouter.ts:1729`，落 `walk_forward_run/fold`，返回 `folds[]`） |

🔴 **两套实现互不引用**：`grep WalkForwardPanel client/src/pages/WalkForwardAnalysis.tsx` = **0 命中**；
`grep fold client/src/pages/WalkForwardAnalysis.tsx` = 8 处，**全部只是同一个 `FoldStrip` 横条组件与计数文案**
（`:397/612/618`），**没有** fold 列表 / fold 详情 / fold 级参数搜索 / fold 级 OOS / fold-by-fold 指标表。
真正的 fold 级 UI 在 `client/src/components/walkForward/WalkForwardPanel.tsx`
（fold 列表 `:690-707`、fold 矩阵 `:712-789`、单 fold 详情 `:792-922`、IS/OOS 六项对照 `:848-904`、聚合 `:925-1035`）。

---

## 3. Frontend Capability Matrix

状态图例：`READY`（页面+路由+真接口+四态+关键字段）/ `PARTIAL`（能看但有明确缺口）/ `MISSING` / `RISK`（存在但会产生误导）。

| # | 模块 | 页面 | 路由 | 列表 | 详情 | 创建/运行入口 | 真调后端 | 四态 | 关键业务字段 | 上游→下游跳转 | 状态 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Dashboard / 首页 | `Dashboard.tsx` 1077 行 | `/` | — | ✓ | ✗ | ✓ 6 处 | ✓ | 行情/情绪/梯队 | →`/limit-up` 1 | READY | `App.tsx:77`；`AppShell.tsx:161-177` |
| 2 | Dataset | `datasets/` 4 页 | 4 条 | ✓ | ✓ | ✓ 建 dataset/version/job | ✓ `datasetRegistry.*` 36 处 | ✓ | id/code/status/rows/job | ✓ id 可点击 | READY | `DatasetList.tsx:27`；`DatasetListTable.tsx:93`；`VersionListTable.tsx:70` |
| 3 | Research（实验） | `ResearchList/ResearchDetail` | `/research`,`/:id` | ✓ | ✓ | ✓ 建实验/Run/分析 | ✓ `researchEngine.*` 32 处 | ✓ | name/type/status/datasetVersionId/sampleCount | ✓ | READY | `ResearchList.tsx:52`；`ResearchDetail.tsx:78/195` |
| 4 | Research（提问式） | `ResearchAsk.tsx` 1509 行 | `/research/ask` | — | ✓ 六步向导 | ✓ 建问题/执行/建候选 | ✓ `researchPlanner.*` 5 处 | ✓ | questionText/conclusionType/limitations/dataValidity | ✓ →候选 | READY | `ResearchAsk.tsx:191-209/1357-1375` |
| 5 | Research Analysis | `AnalysisResultsView` + 建/批量弹窗 | `/research/:id` 内 | ✓ | ✓ | ✓ | ✓ | ✓ | analysisType/target/status/results | ⚠️ Analysis→Finding 无跳转 | PARTIAL | `FindingsPanel.tsx:236`（`primaryAnalysisId` 是纯文本） |
| 6 | **Finding** | `FindingsPanel` | **无独立路由** | ✓ 实验内 | ✓ | ✓ 复核流转 | ✓ `listFindings`/`reviewFinding` | ✓ | title/type/status/strength/effect/buckets/limitations | ⚠️ Finding→Analysis 无跳转 | **PARTIAL** | `FindingsPanel.tsx:265/82`；无 `/findings` |
| 7 | **Conclusion** | `ConclusionPanel` | **无独立路由** | ✓ 实验内 | ✓ | ✓ 建候选 | ✓ `listConclusions`/`getConclusionPolicy` | ✓ | title/type/confidence/policy/primaryAnalysis/ruleTrace | 🔴 五件套零渲染 | **PARTIAL** | `ConclusionPanel.tsx:238`；§5.2 |
| 8 | Candidate | `CandidatesPanel` + `StrategyCandidateDetail` | `/research/candidates/:id` | ✓ 实验内 | ✓ | ✓ 状态流转/promote | ✓ `strategyCandidate.*` | ✓ | status/conclusion/dataset/derivation | ✓ →策略 | PARTIAL（gate 见 P1-3） | `CandidatesPanel.tsx:32`；`StrategyCandidateDetail.tsx:226` |
| 9 | Strategy | `StrategyList` | `/strategies` | ✓ | — | ✓ `/strategies/new` | ✓ `research.strategy.list` | ✓ | name/status/latestVersion/updatedAt | ✓ | READY | `StrategyList.tsx:41`；`StrategyDetail.tsx:525`（`isNew` 特判） |
| 10 | Strategy Version | `StrategyDetail` 三页签 | `/strategies/:id?version=` | ✓ `listVersions` | ✓ | ✓ save/createVersion/setVersionStatus | ✓ 10 处 | ✓ | 规则/参数/仓位/成本/数据集 | ✓ 版本切换 | PARTIAL（缺 OOS/WF 区块、缺 referenced） | `StrategyDetail.tsx:589/679-685` |
| 11 | Parameter Search | `ParameterSearch` + 4 内嵌面板 | `/parameter-search`（**无 `/:runId`**） | ✓ | ✓ 组件内 state | ✓ create/start/cancel/retry | ✓ `paramSearch.*` 47 处 | ✓ | run/combination/params/fingerprint/metrics | ⚠️ 详情不 URL 化 | **PARTIAL**（缺 actual 参数） | `PersistedParameterSearchPanel.tsx:187-209/748-769` |
| 12 | Backtest / Evaluation | `StrategyDetail` 运行页签 / `BacktestRuns` / `PerformanceDashboard` | 3 条 | ✓ | ✓ | ✓ loopRun | ✓ `researchRun.*`/`research.metrics.*` | ✓ | metrics/equity/trades/parameterSet | ✓ | READY | `BacktestRuns.tsx:121-122`；`PerformanceDashboard.tsx:292` |
| 13 | **OOS** | `OosValidationPanel`（页内块） | **无** | ✓ | ✓ | ✓ create/start/cancel | ✓ `paramSearch.*OosRun` 5 端点 | ✓ | IS×OOS 六指标对照 | ⚠️ 宿主 URL 不变 | **PARTIAL** | `OosValidationPanel.tsx:141-149`；`App.tsx` 无 `/oos` |
| 14 | **Walk-Forward** | `WalkForwardPanel`（页内块）+ `WalkForwardAnalysis`（独立页） | `/walk-forward` 指向**另一套** | ✓ | ✓ | ✓ | ✓ 两套并存 | ✓ | fold 矩阵/IS-OOS/聚合 | 🔴 两套互不引用 | **RISK** | §2.3；§5.1 |
| 15 | Simulation | `PaperTrading` | `/paper-trading` | ✓ | ✓ | ✓ | ✓ `sentiment.*PaperTradingRun` | ✓ | orders/equity/summary | — | READY（范围外） | `App.tsx:88` |
| 16 | Jobs / Errors | `VersionDetail`（按 datasetVersion 维度）+ `DataHealth` + `OperationLogs` | 3 条 | ✓ | ✓ | ✓ cancel/retry job | ✓ `datasetRegistry.listJobs/getJob` | ✓ | job status/stats | ⚠️ 无全局 Jobs 面板 | PARTIAL | `VersionDetail.tsx:100-127` |

**统计**：READY **7** / PARTIAL **8** / RISK **1** / MISSING **0**。

### 3.1 规格 §一「特别检查最近完成的能力是否已前端可见」逐条回答

| 检查项 | 前端是否可见 | 证据 |
|---|---|---|
| 参数实际消费结果（actual consumed） | 🔴 **不可见** | `grep actualParameters\|actualConsumed client/src` = **0 命中**；后端 `getSearchResults` 返回体也无该字段（`shared/parameterSearchContracts.ts:187-216`） |
| Parameter Search combination | ✅ | `PersistedParameterSearchPanel.tsx:748-769` |
| combination params | ✅（但只是 `JSON.stringify`） | `PersistedParameterSearchPanel.tsx:764` |
| actual execution params | 🔴 不可见 | 同上 |
| parameter effect | 🔴 **不可见** | `grep parameterEffect client/src` = **0 命中** |
| execution fingerprint | ✅ | `backtestFingerprint` `:936`；`parameterSpaceFingerprint` `:710`；`evaluationConfigFingerprint` `:709`；fold `executionFingerprint`（后端返回，UI 未渲染） |
| strategy parameter provenance | ✅ 部分 | `StrategyResearchProvenancePanel`（`StrategyDetail.tsx:845`），来源 `strategyCandidate.getVersionProvenance` |
| research finding provenance | ✅ 部分 | `RuleDerivationCard.tsx:191-210/267-271`（来源候选推导） |
| semantic normalization | 🔴 不可见 | `grep semanticNormalization\|normalization client/src` = **0 命中** |
| Strategy Projection | 🔴 不可见 | `grep strategyProjection\|patternSemantics client/src` = **0 命中**（AR-14 结论只并进后端 `strategyDecisionEngineNote`） |
| OOS result | ✅ 面板存在 | `OosValidationPanel.tsx:508-518`（IS/OOS 六项对照） |
| OOS provenance | ✅ | `:228/262/313`（冻结快照坐标） |
| Walk-Forward fold | ✅ 在**另一个文件** | `WalkForwardPanel.tsx:690-789`（`/walk-forward` 页没有） |
| fold-level parameter search | ✅ | `WalkForwardPanel.tsx:840`（fold 指纹）/ `:848-904` |
| fold-level OOS | ✅ | 同上 |
| aggregate OOS / WF result | ✅ | `WalkForwardPanel.tsx:925-1035`（`isStats`/`oosStats`） |

---

## 4. Critical Problems

P0 定义：**阻断用户目标成立**（不是「代码丑」）。

### 🔴 P0-1 验证域无专属可达入口，且导航入口指向「另一套不落库的实现」

- **事实**：`client/src/App.tsx` 33 条 Route 中**没有 `/oos`**；OOS-001 的完整 UI 只作为 `/parameter-search` 的
  第 3 块存在（`ParameterSearch.tsx:335`）。侧栏「WFO/OOS 分析」指向 `/walk-forward`
  （`AppShell.tsx:103`），而该页走 `trpc.walkForward.*`（`WalkForwardAnalysis.tsx:146-153`），
  对应 `server/walkForwardRouter.ts:403/453/600/619` —— **内存态技术预览，不落库**，
  与 `paramSearch.*WalkForwardRun`（`server/paramSearchRouter.ts:1729-1862`，**落 `walk_forward_run/fold`**）
  是两套实现且**互不引用**（`WalkForwardAnalysis.tsx` grep `WalkForwardPanel` = 0 命中）。
- **影响**：用户按侧栏「WFO/OOS 分析」点进去，得到的是**不落库的预览口径**；
  WALK-FORWARD-001 的持久化成果（fold 矩阵 / fold 级参数 / 聚合）**只能靠滚到「参数搜索」页第 4 块**才看得到。
  阻断规格 §二主线最后两环在前端成立。
- **证据**：`App.tsx:74-126`；`AppShell.tsx:103`；`WalkForwardAnalysis.tsx:51-52/146-153/397/612`；
  `components/walkForward/WalkForwardPanel.tsx:184-192`；`server/walkForwardRouter.ts:453`；`server/paramSearchRouter.ts:1729`。

### 🔴 P0-2 「实际消费参数（Actual Consumed Parameters）」前后端双缺

- **事实**：
  - 前端：`grep actualParameters | actualConsumed client/src` = **0 命中**；
  - 后端 `paramSearch.getSearchResults`（`server/paramSearchRouter.ts:1371`）返回项为
    `combinationIndex, parameterHash, parameters, status, error, backtestFingerprint, backtestRunId,
    evaluationId, evaluationRunId, evaluation, metrics, metricsSource, annualizationBasis,
    evaluationConfigFingerprint, createdAt`（`shared/parameterSearchContracts.ts:187-216`）——
    **只有「计划参数」与「结果」，没有「实际被执行的参数集」**；
  - `resolvedParameterSet` 只在 OOS run / WF fold / `researchRun.loopRun` 的返回体里出现
    （`shared/walkForwardContracts.ts:226-271`；`server/researchRunRouter.ts:716`），
    **参数搜索的 combination 层完全没有**。
- **影响**：规格 §五 的核心诉求「让用户能够直接验证：我搜索的参数，是否真的改变了策略执行」
  **在参数搜索页无法成立**（只能看指纹不同）。规格 §十三 验收项「Actual Consumed Parameters 可见」直接不满足。
- **旁证（说明为什么这不是纯前端问题）**：真库实测 —— 唯一 COMPLETED 的搜索 run
  `PSRUN-20260919-15d3afc8` 有 **4 个 combination、4 个不同 `parameterHash`，但 `distinct metrics = 1`**
  （`totalReturnPct/maxDrawdownPct/tradeCount` 逐位相同），探针 `parameter_search_result_distinct_metrics`。
  即：**当前库里这条记录本身就是「参数不同、指标相同」的假证据**，前端就算展示了 actual 参数也看不到差异。
- **证据**：`client/src` 全量 grep；`server/paramSearchRouter.ts:1371`；`shared/parameterSearchContracts.ts:187-216`；
  `docs/evidence/_probe_frontend_final_001_state.out.json#deep.parameter_search_result_distinct_metrics`。

### 🔴 P0-3 验证域真库零留档 ⇒ §十三「OOS 可查看 / Walk-Forward 可查看」无法用真实数据验收

- **事实**（探针 `validation_runs_any` + `tables`，2026-09-20T04:30Z）：
  `oos_validation_run` = **0**、`oos_validation_result` = **0**、`walk_forward_run` = **0**、
  `walk_forward_fold` = **0**、`search_robustness_run` = **0**。
- **影响**：`OosValidationPanel` / `WalkForwardPanel` / `SearchRobustnessPanel` 三块 UI
  **从不曾渲染过任何真实数据**；它们的「列表 / 详情 / 空态」路径被实现过，但**从未被真实数据走通过一次**。
  这与「页面能打开」是两件事：按规格要求，实现阶段必须**现场跑出 ≥1 个 OOS run 与 ≥1 个 WF run**
  （每个 run 都会真实重跑回测）才能验收，不能只看空态截图。
- **证据**：`_probe_frontend_final_001_state.out.json#deep.validation_runs_any`；
  `#tables.oos_validation_run / walk_forward_run / search_robustness_run`。

### 🟠 P1-1 `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER` 无前端业务提示

- **事实**：`grep PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER client/src` = **0 命中**；
  该码只存在于 `server/research/parameterSearch/executor.ts:164/335` 与文档。
  页面只能显示后端 `errorCode/errorMessage` 原文（`PersistedParameterSearchPanel.tsx:741-743`）。
  规格 §四 明确要求「不能只是后端返回一个错误码」。
- **附带库事实**：`strategy_parameters` 24 行的 `parameterRole` **只有 TUNABLE 一个取值**
  （探针 `sp_distinct`），3 个 `parameter_search_run` 的 `referenceCheckApplied` 与
  `unreferencedTunableCodesJson` **全为 NULL**（探针 `parameter_search_run_state`）
  ⇒ 引用面检查的结果**既没落库也没前端展示**。
- **证据**：全量 grep；`server/research/parameterSearch/executor.ts:164/335`；探针 `sp_distinct` / `parameter_search_run_state`。

### 🟠 P1-2 Conclusion §15 五件套：后端 15/15 全空 + 前端零渲染（双层缺失）

- **库事实**（探针 `conclusion_section15_coverage`，15 条结论）：
  `findingIdsJson` → NULL 12 / `[]` 3 / **有值 0**；`researchQuestion` → NULL **15**；
  `evidenceSummary` → NULL **15**；`limitationsJson` → NULL 12；`nextQuestionsJson` → NULL 12；
  `evidenceJson` → 有值 15。
- **前端事实**：`grep findingIds client/src` 命中 2 文件，均在 `RuleDerivationCard.tsx`（候选推导），
  **`ConclusionPanel` 完全不渲染**；`evidenceSummary` / `nextQuestions` = **0 命中**；
  `researchQuestion` 2 文件但均非结论渲染（`ResearchAsk.tsx:319` 是注释）；
  adapter `researchEngineAdapter.ts#conclusionToVm`（`:1143-1250`）**未映射 limitations**，
  `limitations` 只在 finding VM（`:1420`）与 `ResearchAsk.tsx:959-967` 出现。
  历史兜底读取 `evidenceJson.findings` = **不存在**（全仓 grep 无）。
- **规格 §三-D 的历史 fallback 可行性实测**：`evidenceJson like '%finding%'`
  且 `findingIdsJson` 为空/`[]` 的结论 = **3 条**（探针 `conclusion_evidenceJson_hasFindings`）
  ⇒ 只读 fallback 有真实适用对象，但不是全部 15 条。
- **证据**：`ConclusionPanel.tsx:238`；`researchEngineAdapter.ts:1143-1250`；`FindingsPanel.tsx:211`；探针两个 key。

### 🟠 P1-3 Candidate promote 的 gate 失败原因展示不完整（含一处不可达说明）

- **事实**：`PromoteCandidateDialog` 仅在 `candidate.status === "ACCEPTED"` 时挂载
  （`StrategyCandidateDetail.tsx:186-209`）；按钮 `disabled={!promotable}`，原因写在 **`title` 提示**
  （`PromoteCandidateDialog.tsx:172-177`）；弹窗内联的 amber 说明块在 **`:220-224`**，
  但它在**按钮 disabled 时不可达**（disabled 不触发 `onClick` ⇒ 弹窗不会打开）
  ⇒ 用户只能靠悬停 tooltip 得知原因。真正的具体解释只在**后端拒绝之后**由 `PromoteFailureView` 展示
  （`:465-494`，`:476-483` 展示 writeback 三项）。promote 返回体本身**无结构化 gate 字段**
  （`server/research/strategyCandidate/service.ts:1213-1228`），拒绝时是字符串 message 加领域码前缀。
- **规格 §三-E 要求**：「必须明确告诉用户原因，不只是按钮 disabled，显示具体 gate failure」。
- **证据**：`StrategyCandidateDetail.tsx:186-209`；`PromoteCandidateDialog.tsx:172-177/220-224/465-494`。

### 🟠 P1-4 Provenance 导航基本单向：链路上多段缺跳转

- **已通**：Conclusion→Candidate（`ConclusionPanel.tsx:73-79` → `CreateCandidateDialog.tsx:63/91`）；
  Candidate→Strategy（`PromoteCandidateDialog.tsx:394` → `/strategies/:id?version=`，`strategyCandidateAdapter.ts:473-475`）；
  Strategy→研究溯源（`StrategyDetail.tsx:845`）；实验→报告（`ResearchDetail.tsx:514-518`）。
- **缺**：Analysis→Finding（`FindingsPanel.tsx:236` 的 `primaryAnalysisId` 是纯文本）；
  Conclusion→Finding（未渲染 `findingIds`，见 P1-2）；Finding→Analysis/Result
  （`:236-237` 的 `primaryAnalysisId`/`sourceResultIds` 均非链接）；
  Analysis→Conclusion（`AnalysisResultsView.tsx:500` 只是文字指引）。
- **规格 §九** 要求形成 `Analysis → Finding → Conclusion → Candidate → Strategy Version →
  Parameter Search Run → Backtest Run → OOS Run → Walk-Forward Run` 的完整可点击溯源。

### 🟠 P1-5 无跨实验的 Finding / Conclusion / Candidate 列表页

- **事实**：`/findings`、`/conclusions`、`/candidates` 路由均不存在；三者只能从
  `/research/:experimentId` 详情页内看到。真库分别有 68 / 15 / 13 条。
  规格 §十 建议的研究分组里含这三项。
- **证据**：`App.tsx:74-126`；`CandidatesPanel.tsx:32`；`FindingsPanel.tsx:265`；`ConclusionPanel.tsx:238`。

### 🟠 P1-6 `/parameter-search` 无 URL 化详情；OOS/WF 深链宿主不换页

- **事实**：`App.tsx:107` 只有 `/parameter-search`，组合详情靠组件内 `selectedRunId` state
  （`PersistedParameterSearchPanel.tsx:177/191-193`）；OOS/WF 面板支持
  `?oosRunId=`（`OosValidationPanel.tsx:123/155`）、`?walkForwardRunId=&foldIndex=`
  （`WalkForwardPanel.tsx:148/151/202-204`）—— 刷新可恢复，但宿主页标题/侧栏高亮始终是「参数搜索」。
- **证据**：同上。

### 🟠 P1-7 侧栏 IA 未表达业务流程（11 项挤在「研究数据」一组）

- **事实**：`AppShell.tsx:91-107` 的「研究数据」组同时装 数据域健康 / 历史状态查询 / 数据集构建 /
  提问研究 / 研究实验 / 策略 / 绩效仪表盘 / 参数搜索 / WFO-OOS 分析 / Regime-报告 / 复盘工作台。
  没有 Research / Strategy / Validation / Trading 的层级表达；策略版本、回测、评估、Finding、
  Conclusion、Candidate 均无侧栏入口。
- **规格 §十** 要求用户进入系统后能理解「研究 → 策略 → 验证 → 交易」的路径。

### 🟠 P1-8 `/walk-forward` 在 `describe` 失败时用**写死的参数空间**提交真实运行

- **事实**：`WalkForwardAnalysis.tsx:64-69` `FALLBACK_PARAMETER_SPACE`（写死
  `maxHoldingDays 3..5`、`stopLossPercent 5..8`）、`:71-79` `FALLBACK_SPLIT_CONFIG`
  （`trainWindow:20 / testWindow:5 / step:5 / maxWindows:6`）、`:155-156` 写死日期
  `2024-01-01 / 2024-12-31`，兜底生效点 `:164-165`。前端用它们**直接调用 `walkForward.run`**。
- **判读**：这是规格 §十一-7「不使用前端 mock 数据冒充真实业务数据」的**边界情形**：
  参数不是展示用假数据，而是**真实提交给引擎的入参**。需要明确产品口径：
  要么禁止兜底（describe 失败即不可运行），要么在 UI 上显著标注「使用了前端默认窗口」。
- **证据**：`WalkForwardAnalysis.tsx:64-79/155-165`。

### 🟡 P2（不阻断闭环，但违反规格 §九 的统一性要求）

| 编号 | 问题 | 证据 |
|---|---|---|
| P2-1 | 无面包屑。`components/ui/breadcrumb.tsx` 原子存在但**全仓 0 使用**；「面包屑」grep = 0 | `ui/breadcrumb.tsx:102-108` |
| P2-2 | `common/` 无统一确认对话框；唯一封装是 `research/ConfirmDeleteButton.tsx`（1 个使用点） | `ConfirmDeleteButton.tsx:14-22/70-97` |
| P2-3 | `TechnicalDetails` 不是 JSON/technical drawer，只是 `Collapsible` 折叠壳，7 处使用且内容均为「契约字段字典」说明 | `common/TechnicalDetails.tsx:17-51` |
| P2-4 | 3 条真孤岛路由：`/dataset-builder`、`/strategy-editor`（均为遗留 Redirect）、`/404` | `App.tsx:94-96/105/123` |
| P2-5 | `runResultAdapter.parseRunResult` 无任何 UI 消费者（仅类型被引用） | `adapters/runResultAdapter.ts:53/78`；仅 `closedLoopRunAdapter.ts:17` |
| P2-6 | `VersionDetail` 页内 Dataset ID / Version ID 为纯文本，不可点击（其他页均可点击） | `VersionDetail.tsx:262-263` |
| P2-7 | `TechnicalDetails` 之外的 JSON 一锅端仅 1 处：combination 参数 `JSON.stringify` | `PersistedParameterSearchPanel.tsx:764` |
| P2-8 | 后端有端点、前端零调用：`research.strategy.loadBundle` / `getVersionBundle` / `validateVersion` / `cloneVersion` / `create` / `delete`；`researchEngine.getFinding` / `updateHypothesis` / `deleteHypothesis` / `testHypothesis` / `createCandidateFromHypothesis` / `updateAnalysis` / `listRuns`；`researchRun.catalog.list` / `chainHealth`；`paramSearch.getOosResult` / `getWalkForwardFold` | 全量 grep 逐条 0 命中 |

---

## 5. 专项深挖

### 5.1 参数搜索页的「Declared → Actual → Result」实况

规格 §五 建议做成三段式。实际是：

```
① 搜索定义 / 参数空间      ✅ createSearch 表单 + summary{searchable,fixed,derived,excluded}
                          + parameterSpaceFingerprint + fixedCoordinates        [PersistedParameterSearchPanel.tsx:206]
② 组合计划（Declared）      ✅ detail.combinations[]{combinationIndex, parameterHash,
                          parameters(JSON.stringify), status, attemptCount}      [:748-769, :764]
③ 实际消费参数（Actual）    🔴 不存在（前端 0 命中；后端返回体无该字段）           [P0-2]
④ 执行结果（Result）        ✅ results[]{status, error, backtestFingerprint,
                          metrics{...}, metricsSource}                          [:936]
```

**API 接入实况（`/parameter-search` 相关 47 处调用）**：
`listSearches` / `getSearch` / `getSearchResults` / `createSearch` / `startSearch` / `cancelSearch` /
`retrySearchCombination`（搜索）；`listRobustnessRuns` / `getRobustnessRun` / `getRobustnessResults` /
`createRobustnessRun` / `startRobustnessRun`（稳健性）；`listOosRuns` / `getOosRun` / `createOosRun` /
`startOosRun` / `cancelOosRun`（OOS）；`listWalkForwardRuns` / `getWalkForwardRun` /
`createWalkForwardRun` / `startWalkForwardRun` / `cancelWalkForwardRun`（WF）——
**全部指向真实端点**，无 mock。

### 5.2 结论五件套的完整证据链

| 字段 | DB 列 | 15 条结论中有值 | 前端渲染 |
|---|---|---:|---|
| `findingIds` | `findingIdsJson` | **0**（12 NULL + 3 `[]`） | ❌ |
| `researchQuestion` | `researchQuestion` | **0**（全 NULL） | ❌ |
| `evidenceSummary` | `evidenceSummary` | **0**（全 NULL） | ❌ |
| `limitations` | `limitationsJson` | 3 | 仅 `ResearchAsk.tsx:959-967`（结论面板不渲染） |
| `nextQuestions` | `nextQuestionsJson` | 3 | ❌ |

⇒ 这不是单纯「前端没接」：**除 limitations/nextQuestions 的 3 条外，列上根本没有值**。
AR-13 的修复只影响**修复之后新写入**的结论；当前 15 条全为历史留档。
规格 §三-D 要求的「历史证据只读 fallback」适用对象 = **3 条**（`evidenceJson` 含 finding 且 findingIds 空）。

### 5.3 无 mock 假数据的核验结论

- `components/**` + `adapters/**` 全量检索「mock / MOCK / 假数据 / 样例」→ **未发现伪造业务读数**。
- 存在的是**明示的默认值/骨架**：`StrategyDetail.tsx:104-195` `TEMPLATE_DOCUMENT`（新建骨架，含写死
  fingerprint/datasetVersion）、`Backtest.tsx:73-79` `OPEN_EXPECTATION_DEFAULT_CONFIG`（页面自述「经验初值占位」）、
  `ReviewWorkbench.tsx:166/184`（自述「技术预览手工注入」）、`WalkForwardAnalysis.tsx:64-79`（见 P1-8）。
- **结论**：无「用假数据冒充真实业务数据」的实现；P1-8 是唯一需要产品口径澄清的边界项。

---

## 6. 耦合分级

| 级别 | 耦合事实 | 绑死机理 |
|---|---|---|
| **Critical** | `/walk-forward` 页 ↔ `walkForwardRouter.ts`（内存态预览） | 页面 100% 依赖 4 个不落库端点；持久化 WF 在另一个 router，两者**无共享契约**，前端不可能只改页面就切过去 |
| **Critical** | 参数搜索「actual 参数」↔ 契约层缺失 | 不是 UI 问题：`parameterSearchResultViewSchema` 无该字段，`resolvedParameterSet` 只在 OOS/WF/loopRun 契约里 |
| **High** | `ConclusionPanel` ↔ `conclusionToVm`（`researchEngineAdapter.ts:1143-1250`） | 结论字段渲染受 VM 映射表控制；不改映射表就加不出五件套，而映射表是 108 行的集中式映射 |
| **High** | 侧栏 ↔ `AppShell.tsx:63-116` 静态 `navGroups` | 分组/条目为硬编码数组，改 IA 必须改这个文件（前端改动，无后端耦合） |
| **Medium** | OOS/WF 面板 ↔ `/parameter-search` 宿主页 | 4 个面板靠 `ParameterSearch.tsx:52-55/327-341` 顺序内嵌；拆成独立路由需新增 `<Route>` + 页面壳（无后端耦合） |
| **Medium** | `StrategyDetail` ↔ `research.strategy.load/loadVersion` | 参数编辑基于原始 document；`loadBundle` 的 `projections.parameters`（含 `minValue/maxValue/stepValue/parameterRole`）**已存在但未被调用**，加「声明表 + 边界/step」只需切数据源，无需后端改动 |
| **Low** | 状态色 ↔ `lib/status.ts` 单一映射表 | 8/8 目标状态已命中（DRAFT/READY/RUNNING/COMPLETED/FAILED/BLOCKED/ACCEPTED/REJECTED），零改动需要 |

---

## 7. 本次审计的「未验证」登记（显式，不含糊归因）

| 项 | 状态 | 原因 |
|---|---|---|
| 无头浏览器 DOM 实测（页面能否真正渲染、点击是否可达） | **未验证** | 本次为只读静态 + 库取证审计，未启动 dev server、未跑浏览器探针 |
| `pnpm run test:changed` / `tsc --noEmit` / build | **未执行** | 同上；且工作树含另一会话在途改动，此时跑测试结果不可归因 |
| `strategy_parameters` 按角色的聚合查询 | **查询失败**（探针 `errors` 1 条） | TiDB 对 `group by parameterRole` + 聚合报错；已用 `select distinct parameterRole` 取得等价结论（仅 TUNABLE） |
| 「11/11 策略版本规则图引用面为空」 | **本次未复现** | 需解析 `strategy_entry_rules/exit_rules/execution_rules` JSON；本次只取得「参数角色仅 TUNABLE」与「引用检查列全 NULL」。转述时须注明依据是既有项目记录，非本次实测 |
| OOS / WF 面板的真实渲染效果 | **不可能验证** | 库中 0 留档（P0-3） |

---

## 8. 只读纪律的机器可核证据

```
$ git status --porcelain        # 本次审计结束后
# —— 已跟踪文件被修改：14 个，全部为审计开始前既存的 9cc 在途改动（逐条比对审计开始时的快照一致）
# —— 本次审计新增：仅 2 个未跟踪文件
?? docs/research/FRONTEND-FINAL-001-AUDIT.md
?? docs/evidence/_probe_frontend_final_001_state.mts
?? docs/evidence/_probe_frontend_final_001_state.out.json
```

- 探针全程 **SELECT**，零 DML；不启动 dev server；只 import `getDb` + `drizzle-orm` 的 `sql`。
- 未执行 `install` / `db:push` / `drizzle-kit generate` / `prettier --write`。

---

## 9. 审计结论与实现阶段建议

### 9.1 是否具备进入实现阶段的条件

**是。** 前端具备实现闭环的**全部地基**：

- 16 个模块中 **0 个 MISSING**，READY 7 / PARTIAL 8 / RISK 1；
- `components/**` + `adapters/**` **零休眠组件、零伪造数据**；
- 后端对研究 / 策略 / 参数搜索 / 稳健性 / OOS / WF **全部有持久化端点，`paramSearch` 一个 router 就覆盖 4 个域**；
- 旧 Dataset API（`researchDataset.*`）前端**已零调用**（仅注释残留），无「两套数据模型」风险；
- 因此 **P0-1 / P0-2 / P1-1…P1-8 的主体可在 `client/**` 内解决**，符合规格 §十一 的禁止事项。

### 9.2 实现阶段的边界（哪些必须动后端、哪些不能动）

| 分组 | 内容 | 可行性 |
|---|---|---|
| **纯前端可做** | P0-1 验证域入口与 IA；P1-4 provenance 跳转；P1-5 三个列表页；P1-6 URL 化；P1-7 侧栏；P1-2 前端渲染（配合 fallback）；P2 全部 | 只改 `client/**`，走 HMR |
| **需最小后端改动** | **P0-2**：`parameterSearchResultViewSchema` 增 `resolvedParameterSet`（数据已在
  `parameter_search_result.reproductionJson`/`resultJson` 侧，需实查落库位置） | 改 `shared/parameterSearchContracts.ts` + `server/paramSearchRouter.ts` 投影；**不得改 `9cc` 的参数消费链本身** |
| **需产品口径确认** | **P1-8** `/walk-forward` 兜底参数空间；**P1-1** 领域码的前端文案 | 无代码风险，需明确口径 |
| **禁止触碰** | `resolveParameters` / `bridge.evaluate` / `evaluateStrategyParameters` 执行链；OOS/WF 计算逻辑；
  `server/research/**` 领域实现；历史 provenance 数据 | 规格 §十一 1/2/3/9 |

### 9.3 实现阶段的验收前置（不可省）

由于 P0-3，**实现完成后必须现场产出真实留档**：

1. ≥1 个 `oos_validation_run` + `oos_validation_result`（真重跑）；
2. ≥1 个 `walk_forward_run` + `walk_forward_fold`（每 fold 独立搜索 + 独立 OOS）；
3. 参数搜索页必须展示 ≥1 个 combination 的「计划参数 ≠ 实际消费参数」差异，或**显式说明该 run 无差异**；
   —— 注意当前库唯一 COMPLETED run 是「4 指纹 / 1 指标」的假证据，
   做该验收须先按项目既有纪律跑**选材探针**（`_probe_9cc_strategy_params.mts`），
   且参数域取声明的**全域端点**，否则得不到有分辨力的结果。

### 9.4 本报告的 P0/P1 计数

| 级别 | 数量 | 编号 |
|---|---:|---|
| **P0** | **3** | P0-1 验证域入口/IA；P0-2 actual 参数双缺；P0-3 验证域零留档 |
| **P1** | **8** | P1-1 领域码文案；P1-2 结论五件套；P1-3 promote gate；P1-4 provenance 断链；P1-5 无列表页；P1-6 无 URL 详情；P1-7 侧栏 IA；P1-8 WF 兜底参数 |
| P2 | 8 | P2-1…P2-8（统一 UI/UX 类，均不阻断闭环） |

> 说明：本阶段（审计）**未提交任何实现代码**，因此按规格 §十四，**暂不登记 ROADMAP**。
> ROADMAP 登记（Task ID / 基线 / 修改范围 / 新增页面 / 新增 API / 测试结果 / 已知问题）
> 应在实现阶段结束时一次写入。
