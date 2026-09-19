# STRATEGY-AUDIT-001 — 全策略模块架构审计

> **性质**：全域、只读、架构级审计。
> **未修改任何代码 / 数据库 / migration / API / 前端 / Strategy domain / Backtest / Dataset / Research**。
> **审计日期**：2026-09-19
> **证据基线**：`drizzle/schema.ts` + `drizzle/*.sql`（41 个迁移）+ 生产 `server/**` 调用链 + 前端 `client/src/**` + **真实库只读探针** `docs/evidence/_probe_strategy_audit_state.mts`（零写入，输出 `docs/evidence/_probe_strategy_audit_state.out.json`）。
> **纪律声明**：本报告遵循「不以文件名推断功能、不把『存在代码』当『功能可用』、不把 mock 当能力、不把设计文档当实现」——每条重大结论都附 `文件路径:行号` / 表名 / 端点 / 调用链。

---

## 1. Executive Summary

### 1.1 一句话结论

> **当前 Strategy 域已经长出了「治理型策略文档 + 不可变版本 + Dataset Registry 坐标绑定 + 研究溯源断链修复」的完整骨架，但它的「执行契约、参数系统、数据集兼容性、运行快照」四层仍然是『单策略 × 单数据集』形态：全平台只有 1 个数据集定义（`first_limit_pullback`）、1 类策略族（首板回踩）、11 个版本里 0 个进入 Production、参数搜索这条主线上的「参数覆写」在最常用的运行入口上是死的。**
>
> 结论定性：**它不是「被首板回踩绑死的烂架构」，而是「一套可扩展的数据模型 + 一层尚未收口的执行契约」。**
> 数据模型层（`StrategyDefinition` / Rule / Parameter / DatasetBinding / Provenance）**具备承载多策略的形态**；真正限制扩展性的是**执行侧**：只有一个闭集事件词表 + 4 个回踩专用特征 + 一条把研究条件机械翻译成策略条件的单一路径。

### 1.2 真实库现状快照（只读实测，2026-09-19）

| 事实 | 实测值 | 证据 |
|---|---|---|
| `dataset_definition` 行数 | **1**（`first_limit_pullback`，type=EVENT，ACTIVE） | 探针 §5 |
| `dataset_version` 行数 | **2**（v1：1130 事件 / 60002 行；v2：23978 事件 / 1543082 行，均 READY） | 探针 §5 |
| `strategies` 行数 | **10**（9 个 `cand-*` 自动转正 + 1 个 `limit-up-baseline`） | 探针 §3 |
| `strategies.status` 分布 | **Draft × 10**（无 Validated/Paper/Approved/Production） | 探针 §3 |
| `strategy_versions` 行数 | **11**（Draft × 10 + Validated × 1） | 探针 §3 |
| `strategy_versions.codeVersion` | **全部 `1.0.0+gunknown`**（11/11）⇒ 执行器版本列存在但**不可用于复现** | 探针 §3 |
| `strategy_versions` 带 `definition` | 9/11（另 2 个是纯 v1 视图） | 探针 §3 |
| `strategy_research_provenance` | **9 行**（= 9 个已转正候选，一一对应） | 探针 §4 |
| `research_strategy_candidate` | **13**（CONVERTED 9 / DRAFT 3 / ARCHIVED 1）；来源 dataset/run **13/13 齐备** | 探针 §4 |
| `closed_loop_backtest_run` | **6 行，全部 `PARTIAL_BLOCKED`**；`datasetVersionId` 非空 6/6；`datasetSource` = registry 3 / rebuild 3 | 探针 §2 |
| 回测留档 `resultJson` 是否含 `parameterSet` / `codeVersion` / `lineage` / `engineVersion` | **0 / 0 / 0 / 0**（6 行全无） | 探针 §2 |
| `backtest_runs`（legacy） | **1 行** | 探针 §1 |
| `research_experiments` / `research_experiment_batches`（legacy 复数表） | **0 / 0 行** | 探针 §1 |

**三个直接读出的信号**：
1. **数据集维度已被实测钉死**：全平台只有一个数据集定义、一个事件类型（首板）。任何「换一种策略」在当前数据层**无数据可用**——这不是代码限制，是**数据供给限制**。
2. **策略从未进入生产**：11 个版本全部 Draft/Validated，`Production` 从未出现。所谓「策略上线」在当前系统中**不存在已验证路径**。
3. **回测留档不可复现参数**：6 次闭环留档的 `resultJson` 里**没有任何一行**携带 `parameterSet` / `codeVersion` / `lineage`。

### 1.3 与「通用量化策略引擎」的差距（四层）

| 层 | 当前状态 | 差距性质 |
|---|---|---|
| **Strategy 数据结构** | 有 canonical 富定义 + 5 张投影表 + 版本不可变闸门 | ✅ **基本够用**（需补 engineVersion 语义、规则嵌套逻辑） |
| **Rule 表达力** | 事件/条件/窗口/触发/出场/风控/执行齐备，但**只有一层 AND**、无路径依赖、无多阶段状态机 | ⚠️ **结构性缺口**（不是配置问题） |
| **Parameter 系统** | 元数据齐全（role/min/max/step/derivedFrom），但 **DERIVED 无求值器**、**运行期不读 role**、**三处表示有损派生** | 🔴 **结构性缺口 + 静默失效** |
| **Dataset / Backtest 契约** | 运行时能绑 `datasetVersionId`，但**无能力兼容性契约**、**运行快照缺参数/代码版本** | 🔴 **结构性缺口** |

---

## 2. Current Architecture Map

### 2.1 分层地图

```
Frontend
  ├── /strategies              → StrategyList.tsx:41        （唯一数据源 research.strategy.list；零写操作）
  ├── /strategies/:strategyId  → StrategyDetail.tsx:524     （9 区块：Overview/Versions/Rules/Parameters/Dataset/Exec/Run/Runs/Provenance）
  ├── /backtest                → Backtest.tsx:546           （legacy sentiment.* 组合回测）
  ├── /backtest-runs           → BacktestRuns.tsx:121       （新 researchRun.listBacktests ← closed_loop_backtest_run）
  ├── /parameter-search        → ParameterSearch.tsx        （paramSearch.*；结果**不落库**）
  ├── /walk-forward            → WalkForwardAnalysis.tsx    （walkForward.*；底层走 legacy 回测）
  ├── /datasets*               → pages/datasets/*           （Dataset Registry 定义/版本/构建）
  └── /research/candidates/:id → StrategyCandidateDetail.tsx（候选详情；→ 策略页**无静态链接**）
              ▲
              │  tRPC（无独立 strategyRouter，全部挂在 research.* 命名空间）
              ▼
API
  ├── appRouter                     → server/routers.ts:317  research / 319 datasetRegistry / 325 researchRun
  │                                       329 paramSearch / 330 walkForward / 332 review / 1337 sentiment(legacy)
  ├── research.strategy.*           → server/researchRouter.ts:105-233          （16 端点）
  ├── research.strategyCandidate.*  → server/research/strategyCandidate/router.ts:245-342（6 端点）
  ├── research.lifecycle.*          → server/researchRouter.ts:241-263          （**纯函数，不写库**）
  ├── researchRun.*                 → server/researchRunRouter.ts:274-651       （闭环运行 + 留档）
  └── sentiment.*（legacy 回测族）  → server/routers.ts:1346-1549
              ▼
Application / Domain
  ├── StrategyService               → server/research/strategyPersistence/service.ts
  ├── StrategyCandidateService      → server/research/strategyCandidate/service.ts:746 promote（唯一转正入口）
  ├── definitionBuild               → server/research/strategyCandidate/definitionBuild.ts:630 buildStrategyDefinition（**唯一转换器**）
  ├── strategySchema                → server/research/strategySchema/{types,definition,definitionValidation,validate,map,projection,legacyViews}.ts
  ├── patternLibrary                → server/research/patternLibrary/patterns/*.ts（声明唯一真源）+ project.ts / projectRecipe.ts
  ├── strategyEvaluation            → server/research/strategyEvaluation/{evaluate,backtestBridge,evaluator,parameterSpaceFromDocument}.ts（**唯一评估端口**）
  └── runWorkbenchAssembly          → server/runWorkbenchAssembly/{assemble,datasetFromRegistry}.ts
              ▼
Repository
  ├── strategyPersistence/db.ts     → strategies / strategy_versions / 5 投影表（**唯一 DB 入口**）
  ├── strategyCandidate/provenance.ts → strategy_research_provenance
  ├── researchCore/repository/db.ts → research_experiment / run / analysis / result / conclusion / candidate / finding / question / plan
  ├── datasetRegistry/db.ts         → dataset_definition / version / build_job / build_config*
  ├── closedLoopBacktestRun/repository.ts → closed_loop_backtest_run
  └── db.ts（巨型 legacy）           → backtest_runs / paper_trading_runs / 市场数据
              ▼
Database（MySQL/TiDB，**零 FK，全软引用**）
```

### 2.2 节点登记表（职责 / 状态 / 是否实际被调用 / 是否重复）

| 节点 | 核心职责 | 当前状态 | 实际被调用？ | 重复实现？ |
|---|---|---|---|---|
| `server/researchRouter.ts` | 策略本体 + 生命周期 + 指标 16 端点 | 在产 | ✅ 前端 StrategyList/StrategyDetail | ⚠️ `loadBundle` 与 `getVersionBundle` **同实现别名**（`:188` vs `:198`） |
| `server/researchRunRouter.ts` | 闭环运行 + 留档 | 在产 | ✅ StrategyDetail `loopRun` | ✅ 唯闭环入口（与 legacy 明确分家 `:287-288`） |
| `server/paramSearchRouter.ts` | 参数搜索 5 端点 | 在产 | ✅ ParameterSearch.tsx | 🔴 **双路径**：策略文档桥 vs legacy `getLeaderCandidateBacktest`（`:281-348` vs `:452`） |
| `server/walkForwardRouter.ts` | WFO / OOS / 过拟合 | 在产 | ✅ WalkForwardAnalysis.tsx | 🔴 评估器仍走 **legacy 回测**（`:237`） |
| `server/strategy/contract.ts` | 「策略=纯函数」执行契约（`Strategy.evaluate`） | **在产但只服务 1 个实现** | ✅ `leaderCandidateBaseline.ts` | 🔴 与 `strategySchema` 契约**互不引用**（两套策略模型） |
| `server/research/framework/contract.ts` | 研究层契约（Universe→Feature→Signal→Ranking→Selection→**PositionIntent**） | 在产 | ✅ `signalEngine` / `assemble` | 与上两者并存（第三套） |
| `server/research/patternLibrary/**` | 交易模式声明唯一真源（8 个声明，2 个有执行配方） | 在产（2026-09-17 迁移后） | ✅ `moduleRegistry` / `recipeRegistry` | ✅ 唯一 SoT |
| `server/research/strategyEvaluation/**` | **唯一评估端口** | 在产 | ✅ paramSearch / 闭环 optimization | ✅ 唯一 |
| `server/runWorkbenchAssembly/**` | 策略文档 + 数据集坐标 → 闭环入参 | 在产 | ✅ `loopRun(useRealData=true)` | ✅ 唯一 |
| `server/backtest/engine.ts`（`runBacktestEngine2`） | 研究级回测引擎 2.0 | 🔴 **生产不可达** | ❌ 仅 3 个测试文件 | 与其余 6 套回测并存 |
| `server/realisticBacktest.ts` | legacy T+1 模拟器 | 在产（研究段） | ✅ 唯一合法出口 `legacyTransactionSimulator.ts:65` | 与生产 Engine 非等价（有测试固化） |
| `server/research/simulator/engine.ts` | 闭环撮合模拟器 | 在产 | ✅ 闭环 backtest 阶段 | 自认不复用 `runBacktestEngine2`（`:19`） |
| `server/paperTrading.ts` | 前向纸面交易 | 在产 | ✅ scheduler + routers | 🔴 内联第 2 份分仓实现（`:723-734`） |
| `server/research/paperAccount/**` | 研究纸面账户 | 已实现但**未装配**（闭环 paper 阶段 `notWired`） | ❌ | 与 `paperTrading.ts` 两套 |
| `server/research/persistence/db.ts`（legacy 复数 3 表） | 旧 Research 持久化 | 🔴 **有类无实例** | ❌ 3 个 Repository 类全仓无 `new` 调用；表 0 行 | 已被单数 10 表取代 |

---

## 3. Database Audit

### 3.1 策略相关表全清单（含唯一/索引/软引用）

| 表 | 行号（`drizzle/schema.ts`） | 主键 | 业务身份 | 唯一约束 | 索引 |
|---|---|---|---|---|---|
| `strategies` | 485-511 | `id` int AI | `strategyId` varchar(64) UNIQUE | — | strategy_id / created / current_version |
| `strategy_versions` | 528-575 | `id` int AI | `(strategyId, version)` | `uq_strategy_versions_id_version`(570) | strategy / created / parent / status；**`datasetVersionId` 索引缺失** |
| `strategy_parameters` | 597-626 | `id` | `(versionId, code)` | UNIQUE | versionId / parameterRole |
| `strategy_entry_rules` | 635-660 | `id` | `(versionId, ruleId)` | UNIQUE | versionId |
| `strategy_exit_rules` | 665-689 | `id` | `(versionId, ruleId)` | UNIQUE | versionId |
| `strategy_execution_rules` | 697-718 | `id` | `versionId` | UNIQUE(versionId) | versionId |
| `strategy_version_datasets` | 726-756 | `id` | `(versionId, datasetId, datasetVersion, role)` | UNIQUE | versionId |
| `strategy_research_provenance` | 779-809 | `id` bigint AI | `strategyVersionId` UNIQUE | UNIQUE | — |
| `closed_loop_backtest_run` | 2031-2075 | `id` bigint AI | `runId` varchar(80) UNIQUE | `uq_closed_loop_backtest_run_run` | created / (strategyId, createdAt) |
| `backtest_runs`（legacy） | 284-298 | `id` int AI | `paramsHash` vc64 | — | hash / created |
| `paper_trading_runs` | 307-328 | `id` int AI | `label` | — | — |
| `research_strategy_candidate` | 1829-1925 | `id` bigint AI | — | — | experimentId / status |
| `dataset_definition` | 1164-1187 | `id` | `datasetCode` UNIQUE | UNIQUE | — |
| `dataset_version` | 1196-1217 | `id` | `(datasetId, version)` | UNIQUE | — |
| `research_experiment`（单数） | 1512-1533 | `id` | — | — | — |
| `research_run`（单数） | 1606-1640 | `id` | `(experimentId, runNo)` | UNIQUE | — |

### 3.2 迁移与 schema 一致性

- DDL 分布：`0026_strategy_persistence.sql`（初版 strategies/versions）、`0034_strategy_domain_model.sql`（+3/+4 列 + 5 张投影表）、`0035_strategy_dataset_binding_version_id.sql`（两表 `datasetVersionId`）、`0036_research_strategy_bridge.sql`（candidate +4 列 + provenance 新表）、`0037_closed_loop_backtest_run.sql`、`0031_research_core.sql`（单数 10 表）。
- 逐列核对结论：**schema.ts 与 SQL 一致**，仅 1 处漂移 —— 🔴 `idx_strategy_versions_dataset_version_id` 已在 `0035:47` 建立，但 `schema.ts:569-575` **未声明**该索引（schema 层看不见真实索引，属「声明落后于库」）。

### 3.3 软引用 / FK / 孤儿引用

- **FK 使用 = 0**：`drizzle/schema.ts` 全文无 `references(`；`drizzle/*.sql` 全文无 `FOREIGN KEY` / `REFERENCES`。全部为「快照值 + 零 FK」软引用（`schema.ts:2028` 明文声明）。
- **逻辑闭环检查**（策略 → 版本 → 候选 → 实验 → 数据集）：
  - `strategy_research_provenance` 是**唯一**把「策略版本 ← 候选/结论/实验/研究 Run/来源数据集」连起来的表，锚点 `strategyVersionId` UNIQUE（`schema.ts:805`）。
  - 🔴 反之**不成立**：`strategy_versions` 表**没有** `sourceCandidateId` / `sourceResearchRunId` 列（`schema.ts:528-575` 全列已核）。⇒ 从版本行**查不到来源**，必须联表。
  - `closed_loop_backtest_run.experimentId` 有列（`:2036`），但**实验本体与闭环留档零关联**（`schema.ts:2028` 明示零 FK；实测 `research_experiments` 0 行、`research_experiment` 7 行，二者是两代模型）。
- **未使用 / 写而不读的列**：
  - `research_datasets`（legacy）：`asOfPerTradeDate` / `asOf` / `rowsFingerprint` / `policySetFingerprint` / `versionSnapshotFingerprint` / `versionSnapshotJson` / `dataSnapshotJson` / `universeDefinitionJson` / `gateNotesJson` **写入后从不回读**（读路径 `researchDataset/persist.ts:142-152` 不取）。
  - `closed_loop_backtest_run`：`datasetVersion` / `datasetVersionId` / `datasetSource` / `recipeId` / `initialCapital` / `finalEquity` / `tradeCount` / `equityCurvePointCount` 写入（`closedLoopBacktestRun/repository.ts:95-107`）但 `SUMMARY_COLUMNS`（`:148-163`）不 SELECT ⇒ **读路径改用 `summaryJson`**，这 8 列在服务端**无读取方**。
- **有表无数据**（实测 0 行）：`research_experiments`、`research_experiment_batches`（legacy 复数），且其 3 个 Repository 类**全仓无实例化**。

---

## 4. Domain Model Audit

### 4.1 🔴 现状：四套「策略」模型并存，互不引用

| # | 模型 | 定义 | 用途 | 被谁用 |
|---|---|---|---|---|
| ① | **治理型 `StrategyDocument` / `StrategyDefinition`** | `strategySchema/types.ts:231-298`、`definition.ts:618-627` | 持久化、版本化、Dataset 绑定、转正落库 | `strategyPersistence` / `researchRouter` / 前端详情页 |
| ② | **执行配方型 `Strategy`（纯函数）** | `server/strategy/contract.ts:112-119` | `evaluate(context) → StrategyDecision` | **只有 1 个实现** `leaderCandidateBaseline.ts`（834 行） |
| ③ | **研究框架 `StrategyContract`** | `research/framework/contract.ts:38-51` | Universe→Feature→Signal→Ranking→Selection→PositionIntent | `signalEngine` / `assemble` |
| ④ | **交易模式声明 `TradingPatternSpec`** | `patternLibrary/types.ts` | 8 个模式的唯一声明真源，投影出候选草图 + 执行配方 | `moduleRegistry` / `recipeRegistry` |

**边界声明**：`docs/strategy/STRATEGY-003-difference-report.md:36` 明确「① 与 ② 并存且互不引用」；`strategySchema/types.ts:17` 声明 `StrategyContract` 与 `StrategyDocument` 的边界。
**判定**：①→②③④ 之间**没有统一接口**，是「声明层 / 执行层 / 研究层 / 模式层」四个各自演化的模型。这既是当前扩展性的真实瓶颈，也是**审计必须记录的架构事实**（不是「重复代码」——它们职责不同，缺的是**连接它们的契约**）。

### 4.2 `StrategyDocument`（v1 外层，`types.ts:231-298`）

| 键 | 行 | 类型 | 说明 |
|---|---|---|---|
| `recordKind` / `recordVersion` | 232/233 | 字面量 | `STRATEGY_DOCUMENT` / `1` |
| `strategyId` / `version` / `name` / `description?` | 236-239 | string | `version` 严格 semver（`:61`） |
| `universe` | 242 | `StrategyUniverse` | `universeId` 必填 |
| `entryRules` / `exitRules` / `riskRules` | 244-249 | `DeclaredRule[]` | **v1 兼容视图**（可空数组） |
| `positionSizing` | 247 | 判别联合 | — |
| `parameters` | 252 | `ResearchParameterSchema` | 🔴 **v1 有损视图**（见 §6.4） |
| `datasetVersion` | 256 | string | label / legacy `rd-…` |
| `datasetVersionId?` | 268 | number | **Dataset Registry 权威坐标** |
| `executionAssumptions` | 271 | {backtestConfig, costModel, executionModel} | — |
| **`definition?`** | 289 | `StrategyDefinition` | **Canonical 富定义** |
| **`recipe?`** | 292 | `StrategyRecipe` | **执行配方引用（顶层）** |
| `metadata?` | 295 | {author?, tags?} | ⚠️ 无 provenance / engineVersion |
| `fingerprint` | 297 | sha256 | 除自身外全字段摘要 |

### 4.3 `StrategyDefinition`（Canonical，`definition.ts:618-627`）

八段：`schemaVersion`（白名单仅 `"1.0"`）· `entry` · `exit` · `position` · `risk` · `execution` · `parameters` · `datasets`。

- `entry`（`:482-487`）= `event`（`:444-449`：`type` + `params`） + `observationWindow`（`:452-458`：start/end/unit） + `conditions[]`（`:461-472`） + `trigger`（`:475-479`）。
- `exit.rules[]`（`:490-505`）：`type` ∈ {TAKE_PROFIT, STOP_LOSS, TIME_EXIT, SIGNAL_EXIT, FORCED_EXIT}（`:111-117`）× `trigger` ∈ {ON_ENTRY, ON_OPEN, ON_CLOSE, INTRADAY}（`:121`）× `thresholdUnit` ∈ {RATIO, PERCENT, TRADING_DAY, PRICE}（`:125`）。
- `position`（`:513-527`）/ `risk`（`:533-550`）/ `execution`（`:553-563`，含 `signalTiming`/`executionTiming`/`priceType`/`quantityMethod`/`lotSize`/滑点/佣金）。
- `datasets[]`（`:589-610`）= `StrategyDatasetBinding`：`datasetId`(**字符串语义码**) / `datasetVersionId?`(number) / `datasetVersion`(label) / `role` / `note?`。

⚠️ **同名不同义**：绑定侧 `datasetId` 是**字符串语义码**（如 `ds_first_limit_pullback`），`dataset_version.datasetId` 是 **bigint 定义 id**（`schema.ts:1199`）。二者匹配逻辑见 `datasetBindingValidation.ts:129-132`。

### 4.4 `StrategyVersionRecord`（§17 九项追溯，`types.ts:331-361`）

`strategy` / `parameterSet` / `datasetVersion` / `universeId` / `backtestConfig` / `costModel` / `executionModel` / **`codeVersion`** / `createdAt` + `fingerprint`。

**判定：版本级追溯能力 READY，但没有 engineVersion。**
- ✅ 「今天改参数，历史 Backtest 能否还原原参数？」——**版本级可以**：`versionRecordJson` 完整落库（`schema.ts:537`），`parameterSet` 在内。
- 🔴 **但运行级不行**：`closed_loop_backtest_run` 不存 `parameterSet`（见 §8.3）。⇒ 用**非默认参数**跑过的那一次结果，无法证明用的是哪组参数。
- 🔴 **`codeVersion` 实测 11/11 = `1.0.0+gunknown`**（探针 §3）：列存在、写入生效，但 git 段为 `unknown` ⇒ **不构成复现依据**。全仓无 `engineVersion` / `gitCommit` / `executionVersion` 字段（grep 0 命中）。

### 4.5 版本不可变性 —— ✅ 强证据成立

| 判据 | 证据 |
|---|---|
| 契约层禁止 | `strategyPersistence/contract.ts:5-8,17-21`：「**绝不提供修改已存在版本内容的入口**」「唯一允许的 UPDATE 是 status」 |
| 实现层 conflict 闸门 | `strategyPersistence/db.ts:237-240,293-296`：同 `(strategyId,version)` 同 fingerprint → `idempotent-skip`；**不同 fingerprint → conflict 拒绝** |
| Service 层 | `strategyPersistence/service.ts:396-401`：conflict 时抛错并提示「请用 createVersion / cloneVersion」 |
| DB 层 | `uq_strategy_versions_id_version`（`schema.ts:570`） |
| API 层 | 全仓**无** `updateStrategyVersion` / `updateStrategy` / `updateDocument` 端点 |

⚠️ **但状态可变且无门槛**：`setVersionStatus`（`researchRouter.ts:229-233`）只校验「属于八态」（`service.ts:361-369`），**不查迁移表**。前端版本状态卡下拉列出全部八态且无守卫（`StrategyVersionPanel.tsx:327-359`）⇒ 可把 `Production` 直接改成 `Draft`（`Draft→Production` 跳级在**状态写入路径上不被拒绝**；只有纯函数 `research.lifecycle.transition` 会拒）。

### 4.6 投影层（5 张表）

`projection.ts:151-221` 由 canonical definition **单向派生** → `strategy_parameters` / `strategy_entry_rules` / `strategy_exit_rules` / `strategy_execution_rules` / `strategy_version_datasets`，与版本行**同事务**写入（`strategyPersistence/db.ts:280-282, 314-343`）。
实测：11 个版本 → `execution_rules` 9 行、`version_datasets` 9 行（缺的 2 个正是无 `definition` 的版本）⇒ **投影覆盖率与 definition 覆盖率一致**，无静默缺口。

---

## 5. Rule Model Audit

### 5.1 三层载体（语义与表达力各不相同）

| 层 | 载体 | 定义 | 是否执行 |
|---|---|---|---|
| **L1 研究侧** | `ResearchConditionSet`（`groups` + 组内 `AND/OR/NOT` + 组间 `AND/OR`） | `researchCore/types.ts:323-344`；求值 `researchEngine/conditionEvaluator.ts:98-133` | ✅ 研究分析可算 |
| **L2 策略声明侧** | `ConditionDefinition`（富）/ `DeclaredRule`（v1） | `strategySchema/definition.ts:461-472` / `types.ts:91-104` | ❌ v1 `DeclaredRule` **声明不实现**（`types.ts:84-89` 明文） |
| **L3 执行侧** | `FeatureGate`（`kind` + `featureId` + `bound`） | `research/framework/gatedSignal.ts:28-33`；语义 = **数组内全 AND**（`:36-40`） | ✅ signalEngine 真跑 |

### 5.2 最小单元与运算域

- 富定义最小单元 = `{ id?, field, operator, value, valueType, description?, enabled }`（`definition.ts:461-472`）。
- **运算符闭集**：
  - `STRATEGY_CONDITION_OPERATORS`（`definition.ts:90-100`）= `GREATER_THAN / GREATER_THAN_OR_EQUAL / LESS_THAN / LESS_THAN_OR_EQUAL / EQUAL / NOT_EQUAL / IN / NOT_IN`
  - `FeatureGate` kind 只有 **5 种**：`lte / lt / gte / gt / eq`（`gatedSignal.ts:28-33`）
  - 映射表只有 5 条（`conditionSignal/compile.ts:76-82`）⇒ 🔴 **`NOT_EQUAL` / `IN` / `NOT_IN` 声明合法但执行不可表达 → 编译期拒绝**（`:199-201`）
- **右值类型闭集**：`CONSTANT / FIELD_REFERENCE / PARAMETER_REFERENCE`（`definition.ts:103-108`）。
- **字段引用白名单**（`definition.ts:212-291`）：
  - 事件层 14 字段（`symbol, tradeDate, market, industryCode, boardType, previousClose, limitUpPrice, turnover, isFirstLimit, previousLimitDate, daysSincePreviousLimit, historicalLimitCount, marketCap, floatMarketCap`）——**不含 OHLCV**
  - bar 层 8 列（`open, high, low, close, volume, amount, tradeDate, relativeDay`）
  - 派生层 4 个（`volumeRatio, haircutFromEventLow, isBullish, momentumFromEventClose`）
  - 解析器唯一权威：`parseStrategyFieldReference`（`:314-340`），正则形态 `prefix.rd(-?\d+).f` / `post.rd(\d+).f` / `event.f` / `bar.f` / `(path|outcome).*`（`:302-306`）

### 5.3 逐类策略可表达性判定（规格 §4.1–§4.8）

| 类型 | 判定 | 证据 |
|---|---|---|
| **4.1 事件型**（首板/放量突破/某事件） | ✅ **可表达（闭集）** | `STRATEGY_EVENT_TYPES = [FIRST_LIMIT_UP, LIMIT_UP, BREAKOUT, PRICE_PATTERN, CUSTOM_EVENT]`（`definition.ts:67-74`）；事件 = 字符串枚举 + 自由 `params`（`:444-449`）。⚠️ 新增事件类型 = **改代码**（不是配置） |
| **4.2 条件型**（close>MA20 / vol>MA5vol*2 / drawdown≤5%） | ⚠️ **部分** | `close > MA20` ⇒ MA20 **不在字段白名单里**（只有 `bar.*` 原始列 + 4 个回踩派生 + `pctChange`）⇒ 需先在特征注册表新增 `ma20` 并映射（`recipeRegistryAtoms.ts` + `compile.ts:63-68`）。`drawdown ≤ 5%` ✅ 可直接用 `haircutFromEventLow` |
| **4.3 时间窗口型**（T+1~T+5） | ✅ **可表达（本项目唯一完整能力）** | `observationWindow`（`:452-458`）+ `resolveSignalTimeline`（`:409-437`）+ `prefix.rd{n}` / `post.rd{n}` 引用形态 |
| **4.4 路径型**（事件→未来5日不破位→第N日买） | 🔴 **不可表达** | `path.*` / `outcome.*` 被定义为「前视，仅打标签」（`:203-206`、`:306`），校验器**一律拒绝** `INVALID_FUTURE_REFERENCE`（`definitionValidation.ts:146-155`）。等价语义只在研究侧以「窗口布尔」存在（如 `pullback_holds_event_open_{k}d`），两侧被显式登记为**不同构**（`patterns/firstLimitPullbackHoldShrink.ts:11-21, 182-186`） |
| **4.5 指标型**（MA/EMA/RSI/ATR/MACD/量比/回撤/动量） | 🔴 **严重不足** | 全仓 **无** EMA/RSI/ATR/MACD/KDJ/BOLL（grep 0 命中）。已实现的**策略侧可消费**特征只有 5 个：`haircutFromEventLow` / `volumeRatio` / `isBullish` / `momentumFromEventClose`（`recipeFeatures/pullbackFeatures.ts:81-133`）+ `pctChange`（`recipeRegistryAtoms.ts:76`）。`server/features/basic.ts` 里的 `sma/return/avgVolume/volatility/amplitude/limitUpHit` **未被策略侧消费**（仅 Feature Registry 注册） |
| **4.6 多条件组合 A AND B AND C** | ✅ **可表达** | `entry.conditions[]` 语义即「数组内全 AND」（`compile.ts` 的 `FeatureGate[]` + `gatedSignal.ts:36-40`） |
| **4.6′ A AND (B OR C)** | 🔴 **不可表达** | `ConditionDefinition` **没有逻辑运算符字段**（`definition.ts:461-472`）。研究侧**支持**分组逻辑（`conditionEvaluator.ts:98-133`），但转正时**第一组之后的非 AND 一律拒绝**（`definitionBuild.ts:393-404`），组内第 2 条起非 AND 亦拒绝（`:410-421`）⇒ **拒绝而非降级**（这是 2026-09-17 修复后的正确行为，见 `RESEARCH-STRATEGY-GAP-AUDIT-001.md:127`） |
| **4.7 多阶段**（Event→Setup→Entry→Position→Exit） | 🔴 **不支持状态机** | 现为**声明分段**：`entry / exit / position / risk / execution / parameters / datasets`（`definition.ts:618-627`）。无 `setup` 阶段、无跨阶段流转对象 |
| **4.8 组合策略**（A + B + Risk Filter） | 🔴 **无组合器** | 全仓 grep `combineStrateg|composition|portfolioStrategy|复合策略|组合策略` **0 命中**。单策略信号只有一种 `signalKind`（`weighted` **或** `gated`，`recipeRegistry.ts:120-133`），不可混用；`risk` 只是声明段（`:533-550`），不是可拼接对象 |

### 5.4 规则的机器可解释 / 可执行 / 可验证性

对规格 §5 给出的例子（`T日首板 → T+1~T+5 不跌破开盘价 → T+N 买入`）：

```text
Event:      FIRST_LIMIT_UP                    ✅ 可表达（闭集）
Reference:  T（event 日）                      ✅ rd=0
Window:     T+1 ~ T+5                          ✅ observationWindow{start:1,end:5,unit:TRADING_DAY}
Condition:  LOW >= T.open                      ✅ bar.low >= prefix.rd0.open
                                                  （EQUIVALENT_REWRITES 显式登记该改写，compile.ts:124-161）
Entry:      T+N                                ✅ trigger + executionTiming
Exit:       ...                                ✅ exit.rules 5 类 + 4 门槛单位
```

⇒ **「首板后回踩」这个例子在声明层是完整可表达的**。但它之所以能表达，靠的是**为该模式专门预置的特征与常量改写表**——这正是 §5.3「4.4/4.5 不可表达」的另一面：**当前表达力来自预置枚举，不是来自通用组合能力。**

**L1–L8 静态 Look-Ahead 校验**（`definitionValidation.ts:10-32`）：L1 `UNKNOWN_FIELD_TIME_DOMAIN`（默认拒绝）· L2 `UNKNOWN_FIELD_REFERENCE` · L3 `INVALID_FUTURE_REFERENCE`（path/outcome）· L4 `INVALID_FUTURE_REFERENCE`（`post.rd{n}` 越界）· L5 `SIGNAL_TIMELINE_UNRESOLVABLE` · L6 `SIGNAL_EXECUTION_TIMING_CONFLICT` · L7 `TRIGGER_EXECUTION_INCONSISTENT` · L8 `PRICE_TYPE_TIMING_MISMATCH`。
文件自述诚实边界（`:31-32`）：**「只能证明『Definition 声明的引用不越界』，不能证明运行时执行器没有旁路读取未来数据」** —— 本审计确认该边界**真实存在**（见 §11.2）。

---

## 6. Parameter Model Audit

### 6.1 参数元数据（`ParameterDefinition`，`definition.ts:566-586`）

`code`（版本内唯一，正则 `[A-Za-z_][A-Za-z0-9_]*`）· `name` · `dataType` · **`parameterRole`** · `defaultValue?` · `nullable?` · `min?` · `max?` · `step?` · `allowedValues?` · `unit?` · `description?` · `required` · **`derivedFrom?`**

对照规格 §6.4 清单：`parameterId`（有 `code`）· `name` ✅ · `type` ✅ · `value`（在 `parameterSet`）· `defaultValue` ✅ · `min/max/step` ✅ · `unit` ✅ · `category` ❌ · `source` ❌ · `mutable`（由 role 表达）· `searchable`（由 role 表达）· `derivedFrom` ✅（**但无语义**，见 6.3）。

### 6.2 `parameterRole` 的真实消费方（逐处实测）

`STRATEGY_PARAMETER_ROLES = ["FIXED","TUNABLE","DERIVED"]`（`definition.ts:163-164`）。

| 消费方 | 位置 | 行为 |
|---|---|---|
| 声明 | `definition.ts:571` | — |
| 校验 | `definitionValidation.ts:344-376` | TUNABLE 必须齐 min/max（数值）或非空 allowedValues；DERIVED 必须有 `derivedFrom` |
| 转正构建 | `definitionBuild.ts:497-537` | 读草稿 role，**缺省 TUNABLE** |
| 转正写入 | `definitionBuild.ts:588` | 写入 |
| 模式声明投影 | `patternLibrary/project.ts:174` | `role:"tunable"→"TUNABLE"`，否则 `"FIXED"` |
| 模式声明→搜索空间 | `project.ts:198-211` | **按 `role !== "tunable"` 跳过** |
| v1 兼容视图 | `legacyViews.ts:157, 228-241` | 🔴 **有损丢弃**（v1 无对应位） |
| 投影落库 | `projection.ts:159` → `strategy_parameters.parameterRole` | 存为可筛键 |
| 反序列化 | `strategyPersistence/db.ts:404` | 读回 |

🔴 **关键缺口**：运行期搜索空间派生器 `deriveParameterSpaceFromDocument`（`strategyEvaluation/parameterSpaceFromDocument.ts:54-101`）**完全不读 `parameterRole`** —— 它只判 `type==="number"` + `min/max/step` 齐备。⇒ 一个带 min/max/step 的 `FIXED` 参数**仍会进入运行期搜索空间**（声明层会跳过，但那是另一条设计期路径）。

### 6.3 DERIVED 参数 —— 🔴 类型存在、校验存在、**求值器不存在**

- 词表含 `DERIVED`（`:163`）；字段 `derivedFrom?`（`:585`）；校验要求非空（`definitionValidation.ts:369-377`）。
- 但 `derivedFrom` 只是**人类可读字符串**（注释 `:584` 原文：「推导表达式（人类可读，如 maxPositions * positionRatio）」）。
- **全仓无任何代码读取 `derivedFrom` 做计算**（grep 仅命中定义、校验、docs）。
- 转正路径也不产 DERIVED（`definitionBuild.ts:497-500` 只产 TUNABLE/FIXED；`project.ts:174` 同）。
- ⇒ 规格 §6.3 的例子 `stopPrice = referencePrice * (1 - drawdown)` **在当前系统里不可能被计算**，只能作为文本声明存在。

### 6.4 🔴 参数的「三处表示 + 有损派生 + 执行断链」

| 表示 | 结构 | 存放 | 谁读 |
|---|---|---|---|
| **① 富定义** | `definition.parameters[]`（code/dataType/role/derivedFrom/unit…） | `strategyDocumentJson` + `strategy_parameters` 表 | 校验器 / 投影 | 
| **② v1 视图** | `document.parameters.parameters[]`（name/type/required/defaultValue/min/max/step/allowedValues/description） | 同 `strategyDocumentJson` | **执行层** + **搜索空间派生** |
| **③ 搜索空间** | `SweepNumberParameter`（type/name/min/max/step） | 不落库（运行期内存） | paramSearch |

- ①→② 是**有损派生**（`legacyViews.ts:157` 自认）：丢 `code` / `parameterRole` / `unit` / `derivedFrom` / `nullable`。
- **执行层用的是 ②，不是 ①**：`runWorkbenchAssembly/assemble.ts:556` → `recipeRuntime.resolveParameters(document.parameters, request.parameterOverrides)`。
- **参数顶替规则**（`recipeRegistry.ts:246-274`）：override 优先 → schema `defaultValue` → 二者皆无抛 `RECIPE_PARAMETER_NO_DEFAULT`；未知覆写键抛 `RECIPE_PARAMETER_UNKNOWN`（响亮拒绝，不静默忽略 ✅）。
- 🔴 **最常用运行入口上参数覆写是死的**：
  - `loopRun` 接受 `parameterSet` 入参（`shared/researchContracts.ts:806`），但只用了一次 —— 灌进 `metadata.parameterSet`（`researchRunRouter.ts:564`），**既不传给装配层、也不落库**。
  - `assembleRunWorkbenchInputs` 调用点（`researchRunRouter.ts:497-520`）**未传 `parameterOverrides`**。
  - 前端 `RunConfigPanel` 也不提交 `parameterSet`（grep：client 侧 `parameterSet` 只出现在 `ParameterSearch.tsx` **展示**搜索结果）。
  - ⇒ 合同上「声明了」、实现上「无消费者」——正是 §14 记录的「**declared but inert**」缺陷族。**参数覆写唯一的活路**是评估端口：`strategyEvaluation/backtestBridge.ts:100` 与 `evaluator.ts:107`。
- **参数类型支持度**：`STRATEGY_PARAMETER_DATA_TYPES = ["number","string","boolean"]`（`definition.ts:167`）；搜索空间另有 `number | integer | boolean | enum`（`research/parameterSpace.ts:23-60`）。❌ 不支持 `date` / `duration` / `percentage` / `price` / `expression`（百分比靠 number + `unit` 字符串表达）。
- **定义/运行值分离**：✅ 分离 —— 定义在文档（+投影表），运行值在 `StrategyVersionRecord.parameterSet`（`types.ts:343` → `versionRecordJson`，`schema.ts:537`）。

---

## 7. Parameter Search 兼容性审计（规格 §7）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 搜索空间派生器 | ✅ 唯一实现 | `strategyEvaluation/parameterSpaceFromDocument.ts:54-108`（读 `document.parameters`，非 `definition.parameters`） |
| 参数定义 / 运行值分离 | ✅ | 见 §6.4 |
| 参数空间 / 单次运行参数分离 | ✅ | 空间在 `ParameterSpace`；单次在 `ParameterSearchEvaluatedSample.parameterSet`（`parameterSearch/types.ts:240-249`） |
| 搜索算法 | ⚠️ **仅 grid / random** | `ParameterSearchMethod = "grid" \| "random"`（`parameterSearch/types.ts:47`）；random 用 Mulberry32 无放回、确定性（`sampler.ts:75-99`） |
| 预算上限 | ✅ | random 默认 budget 100（`types.ts:50`）；grid 组合上限 10 000（`combinationGenerator.ts:21`，超限抛 `MAX_COMBINATIONS_EXCEEDED`）；router 上限 预览 64 / 策略评估 16（`paramSearchRouter.ts:98,107`） |
| **搜索结果能否引用具体 Strategy Version** | ✅ 能 | `ParameterSearchRun.strategyId` + `strategyVersion`（`parameterSearch/types.ts:269-270`，写入 `run.ts:225-226`） |
| **搜索结果能否引用 Dataset Version** | 🔴 **不能（无字段）** | `ParameterSearchRun` / `ParameterSearchCandidateStrategy` **均无** `datasetVersion` / `datasetVersionId`。dataset 信息只在评估返回值里（`strategyEvaluation/evaluate.ts:119`），**不回写搜索记录** |
| **搜索记录是否落库** | 🔴 **完全不落库** | `paramSearchRouter.ts` 全文**零 `insert(`/`update(`/仓储调用**（grep 实测 0 命中）；`paramSearch.run` 只 `return` 对象（`:701-718`）；`drizzle/schema.ts` 无任何搜索结果表 |
| 某一次参数组合能否复现 | ⚠️ **部分** | `evaluate.ts:284-300` 由「策略身份 + 覆写键值」确定性派生 `experimentId`，可作稳定引用；但**该 id 不落参数搜索表**，且 `closed_loop_backtest_run` 不存 `parameterSet` ⇒ 只能靠「重新用同一组参数再算一遍」 |

**判定**：`Strategy → Parameter Space → N 个 Backtest → Evaluation` 这条链在**运行时是通的**（`paramSearchRouter` 走 `createStrategyBacktestBridge`，见 `paramSearchRouter.ts:34,356,264`），但**「N 个 Run 的账本」不存在**——搜索完即失。

---

## 8. Dataset Binding Audit（规格 §8 / §9 / §10）

### 8.1 存在两套「数据集」坐标，且**互不接头**

| 体系 | 表 / 产物 | 权威坐标 | 生成函数 |
|---|---|---|---|
| **A. Dataset Registry（注册）** | `dataset_definition` / `dataset_version` / `dataset_build_job` / `dataset_build_config` / 物理 `ds_*` 五表 | **`datasetVersionId: number`**（= `dataset_version.id`）+ label（`v1`/`v2`） | `datasetRegistry/lifecycle.ts` |
| **B. Research Dataset（重建/内容寻址）** | `research_datasets` + 动态行表 `rd_rows_<buildKey>` | `datasetId: string`（`DS-rd-…`）+ `datasetVersion: string`（`rd-<BUILDER>-<ROW_SCHEMA>-<sha16>`） | `computeDatasetVersion`（`researchDataset/version.ts:51`）、`computeBuildKey`（`buildKey.ts:24`） |

- `0035_strategy_dataset_binding_version_id.sql:1-21` **明文写了这件事**：「Strategy 侧长期沿用旧 researchDataset 的 `rd-…` 字符串；Registry 的真实坐标是 `dataset_version.id`；**两套坐标不接头**」。
- 绑定校验兼容二者：`datasetBindingValidation.ts:171-174`（`datasetVersionId === undefined` ⇒ legacy 分支不做 DB 校验）。

### 8.2 运行时到底绑定什么 —— ✅ **绑定的是不可变版本（`datasetVersionId`），不是「重建」**

调用链（逐层字段名与类型）：

| 层 | 位置 | 字段 | 类型 |
|---|---|---|---|
| shared 契约 | `shared/researchContracts.ts:802` | `datasetVersion` | string（**仅 metadata 回显**） |
| router 解析 | `researchRunRouter.ts:112-122` `primaryDatasetVersionIdOf` | `document.definition?.datasets[PRIMARY].datasetVersionId` → 退 `document.datasetVersionId` | **number** |
| router → 装配 | `researchRunRouter.ts:507-509` | `datasetVersionId` | number |
| 装配请求 | `runWorkbenchAssembly/assemble.ts:94` | `datasetVersionId?: number` | number |
| 直读桥 | `datasetFromRegistry.ts:847-849` | `BuildDatasetFromRegistryRequest.datasetVersionId` | number（注释：「唯一坐标」） |
| repository | `datasetFromRegistry.ts:949,963` | `registry.getVersionById(datasetVersionId)` | `DatasetVersion.id` |

**默认路径 = 直读已落库版本**（`assemble.ts:322-364`）：`prefer-registry`（`:304`）+ `boundId !== undefined` ⇒ `buildResearchDatasetFromRegistry`（`:324-329`）；直读成功且 `executionBarsAvailable === true` ⇒ `return { source:"registry" }`（`:331`），**不重建**。

**回落条件**（`resolveDataset`，`assemble.ts:284-382`）：`datasetVersionId` 缺省 / 直读抛 `RegistryDatasetBridgeError` / `executionBarsAvailable === false`。触发错误码全清单在 `datasetFromRegistry.ts:954-1042`（12 个）。**非该类型的错误一律上抛不回落**（`assemble.ts:351-352`；`UniverseConstraintError` 刻意独立冒泡 —— 这是 `DATASET-SCOPE-INHERIT-001` 的修复成果）。

### 8.3 Dataset Version Snapshot 完整性（规格 §9）

| 应保存项 | 现状 | 证据 |
|---|---|---|
| `datasetVersionId` | ✅ 有列 | `closed_loop_backtest_run.datasetVersionId`（`schema.ts:2046`）；实测 6/6 非空 |
| `datasetVersion`（label） | ✅ 有列 | `schema.ts:2044` |
| dataset build id / `datasetSource` | ✅ `datasetSource` 有列（registry/rebuild/injected） | `schema.ts:2048`；实测 registry 3 / rebuild 3 |
| dataset schema version | ⚠️ 隐含在 `rd-<BUILDER_VERSION>-<ROW_SCHEMA_VERSION>` 指纹里，**无独立列** | `researchDataset/version.ts:42-58` |
| dataset source | ✅ | 同上 |
| dataset createdAt | ❌ 未保存（留档只有 `closed_loop_backtest_run.createdAt`） | `schema.ts:2070` |
| 失败原因（回落说明） | ⚠️ `datasetSourceNote` 只进 `summaryJson` / `resultJson.assembly`，**无独立列** | `closedLoopBacktestRun/summary.ts:30,96` |
| 数据集护栏（`maxTradingDays` / `maxSecuritiesPerDay` / `dataReady`） | 🔴 **未落库**（仅装配入参） | `assemble.ts:107-113` |
| 观察窗口 `definition.entry.observationWindow` | 🔴 未进回测记录（只在策略文档内） | `researchRunRouter.ts:318-320` |

**「数据集后续重建，历史 Backtest 能否准确复现？」**
- ✅ **直读路径命中的那 3 次可以**：因为 `datasetVersionId` 指向的是**不可变的 `dataset_version` 行**（版本行不会因重建而改），且 `ds_*` 物理表按版本隔离。
- 🔴 **回落重建的那 3 次不行**：`datasetVersionId = null`（`assemble.ts:716`），只有内容指纹 `rd-…` 字符串；而重建**不传** event spec / `preWindowDays` / `postWindowDays` / `tDayCondition` / `pullback` 原口径（`assemble.ts:413-437` 只继承 `boards` + `excludeSt`）⇒ 同一 `rd-…` 指纹在当前代码下**可能算不出来**，且重建面板与绑定数据集的**事件/窗口口径本就不同**。

### 8.4 Strategy / Dataset Compatibility Contract —— 🔴 **不存在（架构缺口）**

| 应存在项 | 现状 |
|---|---|
| `requiredFeatures` | ❌ **不在 `StrategyDefinition` 上**。仅存在于 **legacy** 研究契约（`research/strategyContract.ts:24`、`research/types.ts:72`、`experimentValidation.ts:239-243,370`）与前端展示目录（`researchRunRouter.ts:147`） |
| `requiredEvents` | ❌ 0 命中 |
| `requiredFields` | ❌ 0 命中 |
| `requiredFrequency` | ❌ 0 命中 |
| `requiredHorizon` | ❌ 0 命中 |
| `requiredDatasetType` | ❌ 0 命中（`StrategyDatasetBinding` 只有 `datasetId/datasetVersionId/datasetVersion/role/note`，`definition.ts:589-610`） |

**当前实际执行的「兼容性检查」只有「绑定存在性 / 就绪性」**：`datasetBindingValidation.ts:163-228` 校验 ① 版本存在 ② `status === "READY"` ③ label 与 `document.datasetVersion` 一致 ④ `datasetId` 码匹配。**没有任何「这份数据集是否具备该策略所需的字段/事件/频率/视界」的检查。**
⇒ 后果（实测支撑）：策略声明 `observationWindow` 但数据集 `postWindowDays` 不足时，只有在**直读桥运行时**才作为 `POST_WINDOW_TOO_SHORT` 抛错（`datasetFromRegistry.ts` 错误码表），**没有前置的静态兼容性判定**，且**回落重建路径绕过了这项检查**。

---

## 9. Backtest Integration Audit（规格 §11）

### 9.1 回测实现清点：**7 套并存**

| # | 实现 | 入口 | 调用方 | 状态 |
|---|---|---|---|---|
| 1 | **Strategy Engine 生产核心** | `engine/engine.ts:221 runBacktestWithRisk` | `strategy/strategyBacktest.ts:263` ← `leaderCandidateStrategyBacktest.ts:316` ← `db.ts:2474` ← `routers.ts:1346` ← `LeaderCandidates/PerformanceDashboard/RegimeReport/ParameterSearch` | ✅ 在产 |
| 2 | **legacy T+1 模拟器** | `realisticBacktest.ts:246 simulateRealisticTPlus1ToTPlus2` | 唯一合法出口 `research/legacyTransactionSimulator.ts:37,65` ← `downsideRisk` / `overfittingGuard` / `leaderCandidates` | ✅ 在产（研究段）；**与 ① 非等价**（`tests/.../engineNonEquivalence.test.ts` 固化） |
| 3 | **闭环撮合模拟器** | `research/simulator/engine.ts:248 runTradeSimulation` | 闭环 `closedLoopWiring/executors.ts:508` + 评估端口 | ✅ 在产 |
| 4 | **Backtest Engine 2.0** | `backtest/engine.ts:56 runBacktestEngine2` | 🔴 **仅 3 个测试文件** | ❌ **生产不可达** |
| 5 | 研究 legacy 适配器 | `research/engineAdapter.ts:61` | Research run 路径 | ⚠️ 半在产 |
| 6 | 前向纸面引擎 | `paperTrading.ts:577 advancePaperTradingDay` | scheduler + routers | ✅ 在产 |
| 7 | SignalToPnl paper 引擎 | `research/signalToPnl/engine.ts:280` | 🔴 未装配（`requirements.ts:157-162 notWired`） | ❌ |

**核实「`/backtest` 页两套语义」—— 成立**：`/backtest` 的数据全部来自 `sentiment.getLeaderCandidateResearch`（`Backtest.tsx:546` → `routers.ts:1378` → `db.ts:2523` → `leaderCandidateStrategyBacktest.ts:335`）。该报表顶层 `realisticSimulation` 由**生产 Engine** 产出（override 注入 `:322,341`），研究段（downsideRisk / portfolioSnapshot / overfitting）由 **legacy 模拟器** 产出 ⇒ **同一页面混用两套引擎，且二者已证明非等价**。
**核实「每笔固定 100 股」—— 成立**：`LEADER_CANDIDATE_PRODUCTION_REQUESTED_QUANTITY = 100`（`leaderCandidateStrategyBacktest.ts:59` → `:215`），兜底默认 100（`strategyBacktest.ts:229`、`strategy/adapter.ts:75`）。该值是**名义请求量**，最终由 `PositionSizer → RiskManager` 裁决（`engine/engine.ts:112-129`）。闭环模拟器 ③ 的股数来自 `PositionIntent.quantity`，**不固定 100** ⇒ 两套口径不可互换。

### 9.2 回测运行记录是否是「不可变实验快照」—— 逐项判定

理想清单 vs `closed_loop_backtest_run`（实际列：`schema.ts:2031-2075`；写入：`closedLoopBacktestRun/repository.ts:88-110`）：

| 应回答的问题 | 有 / 无 | 证据 |
|---|---|---|
| 运行了什么策略 | ✅ `strategyId` + `strategyVersion` | `schema.ts:2038-2039`（⚠️ 无 `strategyVersionId` 列） |
| 哪个 Strategy Version | ⚠️ **只有字符串坐标**，无版本行 id | 同上 |
| 哪个 Dataset Version | ✅ `datasetVersionId`（直读命中时非空）+ `datasetVersion` + `datasetSource` | `schema.ts:2044-2048` |
| 什么参数 | 🔴 **无**（`resultJson` 实测 6/6 不含 `parameterSet`） | 探针 §2 |
| 什么代码版本 | 🔴 **无**（`resultJson` 6/6 不含 `codeVersion`；loopRun 自身缺省 `"unknown"`，`researchRunRouter.ts:503`） | 探针 §2 |
| 什么回测模式 | ⚠️ 隐含（`resultJson.assembly.recipeSource` / `simulation.executionModel`），无显式模式字段 | `shared/researchContracts.ts:929-949` |
| 什么时间范围 | ✅ `startDate` / `endDate` | `schema.ts:2041-2042` |
| 什么 Universe | 🔴 **无**（无列、`resultJson` 无 universe 明细；只有 `datasetSecurityCount` 计数） | `schema.ts:2031-2075`；`researchContracts.ts:910` |
| 什么成本模型 | ✅ `resultJson.assembly.simulation.costModel`（六字段）| `researchContracts.ts:941-948`；**无基准、无再平衡** |
| 什么风险模型 | ⚠️ 只有 `maxPositions` | `researchContracts.ts:938` |
| 什么时候运行 | ⚠️ 只有 `createdAt`（**无 `startedAt` / `completedAt`**） | `schema.ts:2070` |
| 结果是什么 | ✅ `resultJson`（完整轨迹）+ `summaryJson` + 4 个摘要列 | `schema.ts:2059-2069` |
| `engineVersion` | 🔴 **全仓 0 命中**（schema 与 server 均无） | grep |

**留档链路**：`researchRunRouter.loopRun`（`:419-651`）→ `persistClosedLoopBacktestRun`（`:245-269`，**best-effort 不阻断**）→ `saveClosedLoopBacktestRun`（`repository.ts:79-146`）→ `insert(closedLoopBacktestRun)`（`:112-139`）。
🔴 **关键断点**：`loopRun` 的 `metadata`（含 `parameterSet` / `codeVersion` / `universeVersion`，`:554-565`）**不进 `ClosedLoopRunResult`**（`:579-637` 手工投影，字段集见 `researchContracts.ts:878-953`，显式声明「不含 lineage」）⇒ **`persistClosedLoopBacktestRun` 拿不到这些字段**，于是永远不落库。实测 6 行全零命中，闭环闭合。

### 9.3 复现性（Replay Gap 清单）

**可复用的坐标**（3 个月前那次重跑，以下足以定位）：`strategyId@strategyVersion` + `strategy_versions.strategyDocumentJson`（文档快照）+ `datasetVersionId` + `startDate/endDate` + `recipeId` + `resultJson.assembly.simulation`（成本/执行模型）。

**缺失的坐标（Replay Gap）**：

| # | 缺什么 | 为什么重要 | 证据 |
|---|---|---|---|
| G1 | **运行级 `parameterSet`** | 默认参数可复现（回文档取 defaultValue），**非默认参数的运行不可复现** | `researchRunRouter.ts:564` 只进 metadata |
| G2 | **有效 `codeVersion`** | 列存在但值 = `1.0.0+gunknown`（11/11）；执行逻辑变更无从追溯 | 探针 §3 |
| G3 | **`engineVersion`** | 7 套回测引擎并存，留档不指明用了哪套 | grep 0 命中 |
| G4 | **`seed`** | 配方有 `randomSeed`（`recipeRegistry.ts:243`）、engine2 有 `seed`（`backtest/types.ts:435-436`），但闭环 `resultJson` 无 | — |
| G5 | **数据集护栏与观察窗口** | 不知道当时是「全量跑」还是「200 只 × 10 日试跑」 | `assemble.ts:107-113` |
| G6 | **Universe 明细** | 只有计数，无成员快照 | `schema.ts:2031-2075` |
| G7 | **缓存键不含数据版本** | `getLeaderCandidateResearch` 用 `research:${stableHash(options)}`（`db.ts:2524`）**不含 `dataStamp`** ⇒ 数据更新后仍可能命中旧缓存 | 对比 `db.ts:2476` 的 `getLeaderCandidateBacktest` 有 `dataStamp` |
| G8 | **legacy `backtest_runs` 无任何 strategy/dataset 列** | `schema.ts:284-298` 只有 `paramsHash/paramsJson/summaryJson/resultJson` | — |

---

## 10. Execution Mode Audit（规格 §12 / §13）

### 10.1 八种模式支持度

| 模式 | 判定 | 证据 |
|---|---|---|
| **A. Event Study** | ✅ 有（作为**分析类型**，非独立引擎） | `researchEngine/analyses/eventStudy.ts:65`；注册 `analyses/registry.ts:61`；类型枚举 `researchCore/types.ts:28,89` |
| **B. Signal Backtest** | ✅ 有 | 闭环：signalEngine 产 `PositionIntent` → `runTradeSimulation` 撮合（`closedLoopWiring/executors.ts:406-512`） |
| **C. Portfolio Backtest** | ⚠️ **有（三套口径互不通用）** | 生产 Engine（`engine/engine.ts:98-140` + `positionBudget.ts:47`）；legacy 组合（`realisticBacktest.ts:19-53`）；闭环模拟器（`research/simulator/engine.ts:188-209`） |
| **D. Parameter Sweep** | ⚠️ 有（**两套并存 + 结果不落库**） | `paramSearchRouter.ts`（策略桥 **或** legacy 回落 `:281-348`） + 闭环 optimization 阶段（`requirements.ts:118-127`） |
| **E. Walk Forward** | ⚠️ 有（**独立实现，底层走 legacy 回测**） | `walkForwardRouter.ts:52-60`；评估器 `:237` 调 legacy；闭环 `oos` 阶段 **notWired**（`requirements.ts:134-139`） |
| **F. Out-of-Sample** | ⚠️ 有（独立实现，未接入闭环） | `research/oosIsolation/run.ts:125`；由 `walkForwardRouter.ts:61` 调用；`overfitting` guard 亦 notWired（`requirements.ts:140-145`） |
| **G. Paper Trading** | ⚠️ **两套并存** | ① 生产前向：`paperTrading.ts` + `paperTradingScheduler.ts` + `paper_trading_runs`（实测 4 行）；② 研究：`research/paperAccount/run.ts:127`，闭环 `paper` 阶段 **notWired** |
| **H. Live Trading** | 🔴 **无实现** | 全仓无券商接口；`实盘` 仅出现在注释与「贴近实盘」文档 |

### 10.2 当前 Strategy Domain 会不会限制这些模式？

**不会限制 A/B/D/E/F/G 的「存在」，但限制「共用一套口径」**：
- **闭环 14 阶段装配现状**（`closedLoopWiring/requirements.ts:65-185`）：
  - ✅ **wired**：`data` / `research` / `strategy` / `backtest` / `evaluation` / `optimization` / `regime` / `finalize`
  - ❌ **notWired**：`robustness` / `oos` / `overfitting` / `paper` / `review` / `discipline`
- **三条执行契约并存**：① Engine（`runBacktestWithRisk`，signal intent 走 Risk 裁决）；② simulator（`runTradeSimulation`，逐日撮合，要求 `sourceRun.point === "close"`，`simulator/engine.ts:271-288`）；③ legacy（`simulateRealisticTPlus1ToTPlus2`）。**三者不可互换**。
- **实测佐证**：6 次闭环留档 **全部 `PARTIAL_BLOCKED`**（探针 §2）⇒ **闭环从未完整跑到底过一次**。

### 10.3 Strategy Execution Contract（规格 §13）

| 应存在 | 现状 |
|---|---|
| `StrategyEngine` / `StrategyExecutor` / `StrategyEvaluator` / `SignalGenerator` | ✅ 有（`strategy/registry.ts`、`research/signalEngine/engine.ts`、`strategyEvaluation/evaluator.ts`），但**分属三套契约** |
| `StrategyInput` | ⚠️ 三份不同：`StrategyContext`（`strategy/contract.ts:79-95`）· `FeatureComputeInput`（`framework/contract.ts:85-89`）· 装配入参（`assemble.ts`） |
| `StrategyContext` | ✅ 有（`strategy/contract.ts:79-95`，含 `signalTime` + `data` + 只读 portfolio + `features?`） |
| `StrategyOutput` | ⚠️ 三份不同：`StrategyDecision`（signals+version+insufficientData）· `PositionIntent`（研究层）· 闭环 `Signal`/`Order`/`Fill` |
| 统一 IO 契约（Dataset/Universe/Parameters/Time/Context → Signal/Entry/Exit/PositionIntent/Explanation） | 🔴 **不存在单一权威** |

---

## 11. Leakage / Reproducibility Audit

### 11.1 ✅ 实际存在的未来函数守卫

| 守卫 | 位置 | 作用 |
|---|---|---|
| `visibleBars` asOf 过滤 | `data/series.ts:30-36` | `timestamp <= decisionDate` 才可见；`open` 时点当日 bar 不可见 |
| FeaturePipeline asOf | `features/pipeline.ts:43-46` | 先 `visibleBars` 再算特征 |
| 行级 PIT 不变量 `asOf === tradeDate` | `research/datasetAccess/invariants.ts:11-22`（调用点 `handle.ts:186-193,224-231`、`bars.ts:39`、`marketRegime/facts.ts:204-236`、`dates.ts:123`） | 绑定期 / 访问期 FAIL FAST |
| `LeakageGuard.assertNoLookAhead` | `research/framework/leakage.ts:66-76` | 特征可用性时点 ≤ 决策时点 |
| 涨跌停 / T+1 撮合防护 | `engine/execution.ts`、`research/simulator/engine.ts:229-235` | 涨停买不进 / 跌停卖不出 / T+1 |
| 滑点参考额用**信号日**成交额 | `engine/engine.ts:86-88`、`simulator/engine.ts:225-226` | 防用成交时点未知信息 |
| 数据集 T 日条件 PIT | `researchDataset/tDayFilter.ts:1-13,52-68` | 首板/连板判定不触未来 |
| 直读桥逐日 asOf + 决策日资格 | `datasetFromRegistry.ts:331-398`、`:553-592` | `memberKeys` 仅 `rd ∈ [window.start, window.end]`；`rd=0` 不进决策日 |
| 研究变量角色隔离 | `researchEngine/variables.ts:7-26,108-150` | FEATURE ≤T / OBSERVATION T+k / OUTCOME >T 三类**类型级分离** |
| 声明层静态 L1–L8 | `definitionValidation.ts` | 见 §5.4（**只保证声明不越界**） |

### 11.2 🔴 未守住的环节（逐条实测）

| # | 缺口 | 证据 | 风险 |
|---|---|---|---|
| **L1** | **特征计算无运行时断言** | `recipeFeatures/pullbackFeatures.ts:45-69`：`eventBaselineOf` 直接取 `bars[0]` 当首板日基准、`decisionBarOf` 取序列末根；文件自述「若窗口左边界未预热，特征会偏 —— **这是已知限制**」（`:28-31`），**无断言校验 `bars[0]` 确为首板日** | 🔴 静默算错特征（不报错、产物看起来正常） |
| **L2** | **`LeakageGuard` 对配方特征是「恒通过的守卫」**（**不是 bug，是有意设计，但因此不提供额外防护**） | `recipeRegistryAtoms.ts:47-60` 的 `samePointAvailability` 把 `requiredDataThrough` / `availableAt` **恒置为固定常量 `EPOCH_FLOOR_DATE = "1990-01-01"`**（同文件 `:40-46` 给出的理由：逐日 PIT 数据集保证每行 `asOf === tradeDate`，故「同点可见」恒成立）。`LeakageGuard` 只把该静态声明与最早决策时点比较（`signalEngine/engine.ts:177-180`、`framework/pipeline.ts:109`）⇒ **恒通过** | ⚠️ **真正的 PIT 保障来自数据层**（`datasetAccess/invariants.ts` + 直读桥 `asOf = tradeDate`）；**策略条件层没有独立的未来函数防护** —— 一旦条件引用了观察日/结果变量，这道守卫**不会拦** |
| **L3** | **拒绝「引用未来变量」的检查不存在于策略条件链** | `signalEngine/validate.ts#validateStrategy13`（全文 223 行已核）只校验：`point ∈ {open,close}` · features 非空且 `featureId` 唯一 · `signalBuilder` 是函数 · 排序/选择配置形状 ⇒ **不拒绝「引用 observation / outcome 变量」的特征**。`conditionSignal/compile.ts` 全文 **无 `leakage` / `Leakage` 引用**（grep 0 命中），只做字段→特征 id 恒等映射与常量形态校验（`:60-67,184-200,228-251`） | 🔴 策略条件可绕开 PIT 守卫。生产调用点全清单仅 2 处：`framework/pipeline.ts:109`（逐日）、`signalEngine/engine.ts:179`（窗口预检）—— 均在「声明已恒定安全」的前提下运行 |
| **L4** | **回落重建路径无「决策日资格」概念** | 直读桥按 `memberKeys` 限制资格（`datasetFromRegistry.ts:589-591,1141-1172`）；重建 `buildResearchDataset` 无此概念（`builder.ts:208-217`；`assemble.ts:423-429` 只继承 boards/excludeSt）⇒ **signalEngine 对全体成员逐日决策**（`signalEngine/engine.ts:141-207`），与绑定数据集口径不一致 | 🔴 两条路径语义不同（「静默扩大决策范围」） |
| **L5** | **策略文档校验不覆盖未来函数** | `strategySchema/validate.ts:9-13,72-106,305-312,546` 校验绑定形态 / universe 派生一致性 / 规则白名单 / 成本模型，**无 lookahead 拒绝逻辑**（该逻辑只在 `definitionValidation.ts` 的 L1–L8，且只针对 definition 字段引用） | ⚠️ 两套校验覆盖面不同 |
| **L6** | **`codeVersion` 缺省 `"unknown"` 静默** | `researchRunRouter.ts:99,503` | ⚠️ 复现性降级且无提示 |

### 11.3 Replay 判定（规格 §27）

`Strategy Version + Parameter Snapshot + Dataset Version + Backtest Config + Engine Version` 五要素：

| 要素 | 可得性 |
|---|---|
| Strategy Version | ✅ 文档快照 + fingerprint |
| Parameter Snapshot | ⚠️ 版本级可得；**运行级不可得**（G1） |
| Dataset Version | ⚠️ 直读命中可得；**重建路径不可得**（`datasetVersionId = null`） |
| Backtest Config | ⚠️ 部分（资金/成本/执行模型有；基准/再平衡/Universe 无） |
| Engine Version | 🔴 不可得（G2/G3） |

⇒ **标记为 Replay Gap：五要素中「运行级参数」「有效代码版本」「引擎版本」三项缺失；「数据集版本」在重建路径上缺失。历史结果目前只能「近似重跑」，不能「精确复现」。**

---

## 12. API Audit（规格 §22）

### 12.1 端点全景

**策略本体（`research.strategy.*`，16 个，`server/researchRouter.ts:105-233`）**

| 端点 | 行 | 类型 | 鉴权 | 说明 |
|---|---|---|---|---|
| `validate` | 105 | mutation | public | 纯函数校验 |
| `bump` | 110 | mutation | public | 版本号递增推演 |
| `compare` | 120 | mutation | public | 文档 diff |
| `create` | 134 | mutation | **admin** | 落库 |
| `save` | 139 | mutation | **admin** | 与 create 同路径；⚠️ 同版本改内容 → conflict |
| `load` | 144 | query | public | 最新版本 |
| `list` | 149 | query | public | 实体列表 |
| `delete` | 152 | mutation | **admin** | 级联删版本 |
| `createVersion` | 157 | mutation | **admin** | — |
| `loadVersion` | 168 | query | public | — |
| `listVersions` | 173 | query | public | 含 `datasetVersionId` |
| `loadBundle` | 186 | query | public | **与 getVersionBundle 同实现** |
| `getVersionBundle` | 196 | query | public | 同上（别名） |
| `validateVersion` | 204 | query | public | 读库校验 + 投影漂移 |
| `cloneVersion` | 212 | mutation | **admin** | 可直指任意八态 |
| `setVersionStatus` | 229 | mutation | **admin** | **无迁移表门槛** |

**候选（`research.strategyCandidate.*`，6 个）**：`get`(245) · `createFromConclusion`(256, admin) · `update`(272, admin) · `transition`(287, admin) · **`promote`**(307, admin) · `getVersionProvenance`(331)

**运行 / 回测**：`researchRun.loopRun`(419, public mutation) · `listBacktests`(290) · `getBacktest`(306) · `readiness`(357) · `chainHealth`(345) · `securityLabels`(325)；legacy `sentiment.getLeaderCandidateBacktest`(1346) / `getLeaderCandidateResearch`(1378) / `saveBacktestRun`(1385) / `listBacktestRuns`(1402) / `getBacktestRun`(1413) / 纸面 5 个(1454-1549)

**参数搜索 / WFO**：`paramSearch.describe`(612) · `run`(653) · `rolling`(725) · `robustness`(781) · `stochastic`(809)；`walkForward.describe`(403) · `run`(453) · `oos`(600) · `overfit`(619)

### 12.2 规格 §22 清单逐条判定

| 能力 | 判定 | 依据 |
|---|---|---|
| Create Strategy | ✅ 已有 | `research.strategy.create`（admin, `researchRouter.ts:134`） |
| Get Strategy | ✅ 已有 | `load`(144) |
| List Strategy | ✅ 已有 | `list`(149) |
| Create Version | ✅ 已有 | `createVersion`(157) |
| Get Version | ⚠️ **已有但重复** | `loadVersion` / `loadBundle` / `getVersionBundle`（后两者同实现，`researchRouter.ts:188` vs `:198`） |
| Update Draft | 🔴 **语义缺失** | 无独立端点。`save` 对同版本不同内容**抛 conflict**（`strategyPersistence/service.ts:396-401`）⇒ 不能改已落库内容。草稿编辑只在**候选层**（`strategyCandidate.update`） |
| Delete Strategy | ✅ 已有 | `delete`(152) |
| Validate | ✅ 已有（两粒度） | `validate`(105) + `validateVersion`(204) |
| **Publish** | 🔴 **缺失** | 全仓无 publish 端点。数据集侧有 `archiveDefinition`，策略侧无 |
| Clone | ✅ 已有 | `cloneVersion`(212) |
| **Archive** | 🔴 **缺失** | 无策略 archive 端点（仅候选有 `ARCHIVED` 状态） |
| Run | ✅ 已有（三层） | `researchRun.loopRun` / `researchEngine.runEngine` / `researchPlanner.runResearch` |
| Backtest | ⚠️ **两套并存** | 闭环 `loopRun` + legacy `sentiment.*` |
| Get Run | ⚠️ **三套并存** | `researchEngine.getRun`(540) / `researchRun.getBacktest`(306) / `sentiment.getBacktestRun`(1413) |
| List Runs | ⚠️ **三套并存** | 同上（分别面向 `research_run` / `closed_loop_backtest_run` / `backtest_runs` 三张表） |

**读写计数**：策略本体 读 7（其中 2 个同实现）/ 写 6（全 admin）+ 纯函数 mutation 3（public）。
**孤儿端点**：
1. 🔴 `research.lifecycle.transition`（`researchRouter.ts:250-263`）是 public mutation 但**纯函数不落库** ⇒ 有校验能力、无持久化语义。
2. 🔴 `loadBundle` / `getVersionBundle` 一读两名。
3. ⚠️ `research.strategy.save` 与 `create` 共享落库路径，`save` 无独立读配对。

**「能否改已发布版本？」** —— **内容不能，状态能**：
- 内容：DB conflict 闸门（`strategyPersistence/db.ts:237-240,293-296`）+ service 抛错（`:396-401`）+ 全仓无 update 端点 ⇒ ✅ **不可改**。
- 状态：`setVersionStatus` 只校验枚举（`service.ts:361-369`）⇒ 🔴 **可把 Production 任意改成八态中任一**，且**不吃 §23 迁移表**（迁移表只在纯函数 `research/lifecycle/transition.ts` 里）。

---

## 13. Frontend Audit（规格 §23）

### 13.1 路由全景（`client/src/App.tsx:74-124`）

策略相关：`/strategies`(103) · `/strategies/:strategyId`(104) · `/strategy-editor`(**重定向**,105) · `/backtest`(85) · `/backtest-runs`(87) · `/parameter-search`(107) · `/walk-forward`(108) · `/performance`(106) · `/regime-report`(109) · `/review-workbench`(110) · `/paper-trading`(88) · `/datasets*`(98-101) · `/research*`(115-120)。

### 13.2 详情页区块覆盖（规格 §23 的九区块）

| 区块 | 覆盖 | 证据 |
|---|---|---|
| Overview | ✅ 独立 UI（可编辑） | `StrategyBasicInfo.tsx:123-150,290-299` |
| Versions | ✅ 独立 UI（只读表 + 切换） | `StrategyHeader.tsx:159-181`、`StrategyVersionPanel.tsx:138-221` |
| Rules | ✅ 独立 UI（可编辑） | `DefinitionFields.tsx`（`StrategyDetail.tsx:317`）；无 definition 时降级 `RuleEditor`（`:287-314`） |
| Parameters | ✅ 独立 UI（可编辑） | `DefinitionFields.tsx` 第 ⑦ 段 `:1205-1252` |
| Dataset | ✅ 独立 UI（两级选择，**提交 `datasetVersionId`**） | `StrategyBasicInfo.tsx:102-114,152-274` |
| Execution Config | ✅ 独立 UI | `DefinitionFields.tsx:1160-1205` + `RunConfigPanel.tsx:270-372` |
| Backtest | ✅ 独立 UI（可执行） | `RunTab`（`StrategyDetail.tsx:348-511`） |
| **Runs** | ⚠️ **部分** | 只恢复「最近一次」（`:370-386`），全量列表**跳 `/backtest-runs`**（`:468-470`） |
| Provenance | ✅ 只读展示 | `StrategyResearchProvenancePanel.tsx`（挂载 `StrategyDetail.tsx:845`） |

**「前端是不是围绕某一个策略做的临时页面？」** —— **不是**。`StrategyList` 只调 `research.strategy.list`（`:41`），详情页按 `:strategyId` 参数化，规则/参数编辑器是**由 `definition` 结构驱动的通用表单**（`DefinitionFields`），数据集绑定是两级通用选择器。**它是围绕领域模型做的通用页面**（这一点是 READY 的）。

### 13.3 🔴 已发布版本可在 UI 中打开编辑（无客户端门槛）

- 版本下拉可选中任意版本（含 `Production`）并加载进编辑器（`StrategyHeader.tsx:159-181` → `StrategyDetail.tsx:679-685,577-584,602-624`）。
- 页头「保存 / 另存为新版本」按钮**不按版本状态禁用**（`StrategyHeader.tsx:110-123`，`busy` 只看 `validating/saving/creatingVersion`）。
- 「保存」对已发布版本改动 → 命中服务端不可变闸门并报错（`service.ts:396-401`）⇒ **不造成数据损坏，但体验上是「点了才报错」**。
- 版本状态卡可把任意版本改成**任意八态**，无守卫（`StrategyVersionPanel.tsx:327-359`，选项含 `Approved/Production/Retired`，`lib/status.ts:190-192`）。
- 全仓前端**无**基于 `status === "Production"` 的只读/禁用判定（grep `Production` 仅命中颜色与文案 `lib/status.ts:102-104`）。

### 13.4 mock / 硬编码 / 陈旧注释

| # | 位置 | 内容 | 是否渲染给用户 |
|---|---|---|---|
| 1 | `StrategyDetail.tsx:104-195 TEMPLATE_DOCUMENT` | 硬编码完整文档模板（`strategyId:"limit-up-baseline"`、`fingerprint:"c8f0…"`） | ⚠️ **会瞬时渲染**：`:537 initialDocument()` 对**已存在的策略**也返回该模板；`StrategyHeader` 在骨架判断（`:793 docPending`）**之前**渲染 ⇒ 加载完成前页头会闪现模板的 name/strategyId |
| 2 | `StrategyAdvancedTools.tsx:71-95 EXAMPLE_LIFECYCLE_RECORD` | 示例生命周期壳（含写死 hash/fingerprint） | ⚠️ 会渲染（`:187` 作 textarea 初值，`:327` 「载入示例壳」，`:409-414` 可直接「应用这次迁移」），默认折叠 |
| 3 | `RunConfigPanel.tsx:74-77 DEFAULT_RUN_WINDOW` | 硬编码 `2025-01-02 ~ 2025-03-31` | ✅ 会渲染（回测窗口初值） |
| 4 | `RunConfigPanel.tsx:304` | 硬编码数据集窗口文案 `2024-09-01 ~ 2026-09-01 内` | ✅ 会渲染（提示文本，**与真实数据集窗口 2024-09-01~2026-09-01 巧合一致，但属硬编码**） |
| 5 | `WalkForwardAnalysis.tsx:64-79 FALLBACK_*` | 与后端重复的默认参数空间/切分配置 | ✅ 会渲染（describe 未返回时兜底） |
| 6 | `ParameterSearch.tsx:61-62`、`WalkForwardAnalysis.tsx:51-52` | 注释称「端点尚未合并进 appRouter」 | ❌ **陈旧注释**（实际已挂 `routers.ts:329-330`） |
| 7 | `client/src/adapters/strategyAdapter.ts:11,114` | 「fingerprint 为前端占位展示」 | ⚠️ 影响展示（前端 fingerprint 为占位值） |

**grep `mock/MOCK/假数据` 在 `client/src` 下无真实 mock 数据对象**（仅占位注释与诚实空态文案）。

### 13.5 「候选 → 策略」可达性 —— 🔴 真实缺口

- 全仓 `/strategies/` 字面量出现处：`App.tsx:71,104`、`BacktestRuns.tsx:80`、`StrategyList.tsx:101`、`StrategyDetail.tsx:673,734`、`adapters/strategyCandidateAdapter.ts:467`。
- **`client/src/pages/research/**` 下 0 处**静态链接。候选详情页把转正产物显示为**纯文本**：`StrategyCandidateDetail.tsx:87-94`（`<span className="font-mono">{vm.strategyDefinitionId}</span>`）。
- 唯一入口是**转正成功对话框**里的 `navigate(result.path)`（`PromoteCandidateDialog.tsx:394-396`，path 由 `strategyCandidateAdapter.ts:466-467,504` 生成）⇒ **刷新即失联**。
- 反向亦断：策略页只挂只读溯源面板，**不链接候选页**（`StrategyDetail.tsx:845`）。

### 13.6 数据集选择传参（规格相关的关键事实）

| 页面 | 选择器 | 提交字段 |
|---|---|---|
| 策略详情·基础信息 | 定义 + 版本两级 | **`datasetVersionId`**（`StrategyBasicInfo.tsx:107`） |
| 候选转正弹窗 | 定义 + 版本（OVERRIDE） | **`datasetVersionId`**（`PromoteCandidateDialog.tsx:279-283,324-326`） |
| 研究新建实验 | 表单键名 `datasetId`（= **定义 id**）+ 版本 | 提交 **`datasetVersionId`**（`createExperimentForm.ts:181`） |
| 提问研究 | 同上 | 提交 **`datasetVersionId`**（`researchAskForm.ts:107-134`） |
| 参数搜索 / WFO / 回测历史 / 绩效 | 🔴 **无数据集选择器** | — |

⇒ **用户能选到具体数据集版本（READY）**；但**参数搜索与 WFO 完全无法指定数据集版本**（这也是它们底层仍走 legacy 回测的直接后果）。

---

## 14. Legacy / Duplicate Audit（规格 §29）

### 14.1 关键词逐条归属判定

| 关键词 | 命中 | 判定 |
|---|---|---|
| `TODO` / `FIXME` / `HACK` | `server/**` **0 命中** | ✅ 无 TODO 型死代码 |
| `deprecated` | 1 处（`db.ts:914`，标注危险的全表拉取函数） | 正在使用（未删除，已标注） |
| `legacy` | ~90 处，**全部是活代码的命名/边界声明** | 见下表分项 |
| `mock` / `fake` / `stub` | 6 处，全在测试替身/端口注入注释 | ✅ 正在使用 |
| `placeholder` / `占位` / `未实现` | ~70 处，绝大多数是**显式诚实占位** | 正在使用 |
| `unused` / 已废弃 | 3 处注释级 | 无死代码实体 |
| `old strategy` / `old backtest` | 生产源码 0 命中（仅 docs） | — |

`legacy` 分项：
- **在用边界（有意）**：`leaderCandidates.ts:990-1023`、`leaderCandidateStrategyBacktest.ts:310-311`、`routers.ts:1349,1376`、`db.ts:2470-2520`、唯一合法出口 `research/legacyTransactionSimulator.ts:4,65`、绑定兼容分支 `strategySchema/validate.ts:72-106` / `definitionValidation.ts:768-796` / `datasetBindingValidation.ts:15`、paramSearch legacy 回落 `paramSearchRouter.ts:281-348`。

### 14.2 重复实现清单

| # | 重复内容 | 权威实现 | 第二份 | 判定 |
|---|---|---|---|---|
| **D1** | **分仓分配** | `positionBudget.ts:47-62 allocatePlannedBudgets` | `paperTrading.ts:723-734`（内联 `budgetByCode` 循环，三分支公式**逐字相同**，但**漏了 `positionScale`**） | 🔴 **确定重复，未收敛**（`paperTrading.ts` 未 import `positionBudget`） |
| **D2** | **回测入口 / 历史留档** | 闭环 `researchRun.*` → `closed_loop_backtest_run` | legacy `sentiment.*` → `backtest_runs` | ⚠️ **两套都在用**（导航同时暴露 `/backtest` 与 `/backtest-runs`） |
| **D3** | **回测引擎** | — | 7 套（§9.1），其中 #4 `runBacktestEngine2` **生产不可达** | 🔴 其中 1 套确定无用 |
| **D4** | **参数空间派生** | `parameterSpaceFromDocument.ts:54` | `definitionBuild.ts:479-599`（草稿→参数）+ `patternLibrary/project.ts:198-211`（模式声明→空间，自认同源异输入）+ `paramSearchRouter.ts:144 MAPPABLE_PARAMETER_DICTIONARY`（legacy 8 字段白名单，未收录静默忽略） | ⚠️ 前三个是不同输入源的有意分层（`project.ts:190-196` 自述）；**第四个是 legacy 且会静默忽略** |
| **D5** | **策略列表/详情接口** | `research.strategy.*` 唯一 | `loadBundle` / `getVersionBundle` 同实现别名 | ⚠️ 重复端点名 |
| **D6** | **策略模型** | — | 4 套并存（§4.1） | ⚠️ 职责不同，缺连接契约（非纯重复） |
| **D7** | **策略定义校验** | 后端 `definitionValidation.ts` + `validate.ts` | 前端预检 `client/src/components/strategy/definitionDraft.ts:1043` | ✅ 可接受（后端唯一权威，前端仅拦截） |
| **D8** | **纸面交易** | `paperTrading.ts`（在产） | `research/paperAccount/**`（未装配） | ⚠️ 两套 |
| **D9** | **legacy 复数 3 表持久化** | 单数 10 表 | `research/persistence/db.ts` 3 个 Repository 类**全仓无实例化**；表 0 行 | 🔴 **确定无用（有类无实例）** |
| **D10** | **验证脚本叠加** | — | `scripts/` 下 5 个桥验收脚本各覆盖不同阶段（头注释已声明） | ✅ 可接受 |

### 14.3 存在但从未被生产引用的文件

| 文件 | 生产引用 | 判定 |
|---|---|---|
| `server/backtest/engine.ts`（`runBacktestEngine2`） | **0**（仅 3 个测试 + barrel 再导出 + 1 处注释） | 🔴 **生产不可达** |
| `server/research/strategySchema/goldenSample.ts` | 0（未进 `index.ts` 导出） | ✅ 测试 fixture（有意） |
| `server/researchEngine/testFixtures.ts` | 0（8 个测试文件用） | ✅ 测试 fixture |
| `server/research/strategyCandidate/provenanceContract.ts` | 0（测试 + 脚本用） | ✅ 契约测试台 |
| `server/research/paperAccount/**`、`research/signalToPnl/**`、`research/stochasticRobustness/**`（部分算法） | 未装配 / 未实现 | ⚠️ 已登记为已知缺口 |

---

## 15. Scenario Simulation（规格 §30）

### Scenario A —— 当前首板回踩策略

```text
首板事件 → T+1~T+5回踩 → 不破T日开盘 → T+N买入 → Exit → Backtest
```

| 步骤 | 能否表达 | 证据 / 断点 |
|---|---|---|
| 首板事件 | ✅ | `STRATEGY_EVENT_TYPES` 含 `FIRST_LIMIT_UP`（`definition.ts:67-74`） |
| T+1~T+5 窗口 | ✅ | `observationWindow{start:1,end:5,unit:TRADING_DAY}`（`:452-458`） |
| 不破 T 日开盘 | ✅ | `bar.low >= prefix.rd0.open`（`EQUIVALENT_REWRITES` 显式登记，`compile.ts:124-161`） |
| T+N 买入 | ✅ | `trigger`（`FIRST_VALID_DAY/...`）+ `executionTiming`；L6/L7 保证不早于信号 |
| Exit | ✅ | `exit.rules` 5 类 × 4 门槛单位（`definition.ts:111-125`） |
| Backtest | ⚠️ **能跑，但口径有三处断点** | ① 若走回落重建 ⇒ **无决策日资格过滤**（§11.2 L4）；② 留档**不存参数与代码版本**（§9.2）；③ 6 次实测**全部 PARTIAL_BLOCKED** |
| 参数覆写 | 🔴 **`loopRun` 路径上无效** | §6.4 |

**结论：Scenario A 的声明层完整可表达；执行层能跑但不可复现；且从未跑完整过（实测 6/6 PARTIAL_BLOCKED）。**

### Scenario B —— 完全不同的策略

```text
MA20 上穿 MA60 + 成交量 > MA5 Volume × 2 + 未来10日止盈/止损
```

| 需求 | 能否直接建立 | 断点 |
|---|---|---|
| `MA20` / `MA60` 字段 | 🔴 **不能** | 不在 `STRATEGY_BAR_FIELDS` / `DERIVED_BAR_FIELDS`（`definition.ts:230-279`）；需**新增特征 id + 实现 + 注册 + `compile.ts` 映射**（4 处代码改动） |
| 「上穿」（跨 bar 事件） | 🔴 **不能** | 规则模型是**单 bar 快照谓词**（`FeatureGate{featureId,bound}`），无跨 bar 派生/状态 |
| `成交量 > MA5Volume × 2` | 🔴 **不能** | 右值类型只支持 `CONSTANT/FIELD_REFERENCE/PARAMETER_REFERENCE`（`:103-108`），**不支持表达式**；且 MA5Volume 不存在 |
| 未来 10 日止盈/止损 | ⚠️ **部分** | `TAKE_PROFIT`/`STOP_LOSS` 类型存在（`:111-117`），但 `thresholdUnit=TRADING_DAY` 的 TIME_EXIT 可表达「10 日」；**止盈/止损阈值若需路径依赖则不行** |
| 需要改什么 | **数据库：不需要**；**前端：不需要**（`DefinitionFields` 结构驱动）；**Strategy Domain：需要**（新增特征 + 注册 + 映射）；**Backtest Engine：不需要** | — |

**结论：Scenario B 不能「直接建立」。** 卡点**不在数据库、不在前端**，而在 **② 执行层特征/算子闭集** 与 **③ 右值不支持表达式**。

### Scenario C —— 参数搜索

```text
entryDay = 1..5 × pullbackDays = 2..5 × maxDrawdown = 2%..8%
→ Strategy → Parameter Space → N × Backtest → Evaluation
```

| 环节 | 判定 | 证据 |
|---|---|---|
| 空间派生 | ⚠️ 能，但**必须写在 v1 `document.parameters` 且带 min/max/step** | `parameterSpaceFromDocument.ts:54-101` |
| 组合生成 | ✅ grid ≤10 000 / random budget 100 | `combinationGenerator.ts:21`、`types.ts:50` |
| 批量 Backtest | ✅ 走 `createStrategyBacktestBridge`（`paramSearchRouter.ts:34,356`） | 单组 ≈3 分钟（项目既有实测） |
| Evaluation | ✅ 唯一评估端口 | `strategyEvaluation/evaluate.ts` |
| **承载上限** | 🔴 router 上限 **16 组**（策略评估路径 `:107`） | — |
| **结果账本** | 🔴 **不落库**（§7） | — |
| **引用 datasetVersion** | 🔴 **无字段** | — |

**结论：架构能承载，但（a）规模被 `STRATEGY_EVALUATION_MAX_COMBINATIONS = 16` 卡住；（b）搜索结果不落库 ⇒ 「扫过的 100 组里哪组最好」在事后无法查证；（c）搜索记录不记数据集版本 ⇒ 换数据集后无法比较。**

---

## 16. Capability Matrix（规格 §31）

| 能力 | 当前状态 | 证据 | 风险 | 是否需要重构 |
|---|---|---|---|---|
| Strategy Identity | **READY** | `strategies` 双身份（`schema.ts:486,488`）+ 11 行实数据 | 低 | 否 |
| Strategy Version | **READY** | `uq_strategy_versions_id_version` + conflict 闸门（`db.ts:237-240`）+ §17 九项 | 中（状态无门槛） | 否（补状态门槛） |
| Rule Model | **PARTIAL** | 事件/条件/窗口/触发/出场齐备；**无嵌套逻辑、无路径依赖、无多阶段、无组合器、无 EMA/RSI/MACD** | **高** | **是**（执行层闭集） |
| Parameter Model | **PARTIAL** | 元数据齐全（`definition.ts:566-586`）；**DERIVED 无求值、运行期不读 role** | **高** | **是** |
| Parameter Search | **PARTIAL** | 能跑（`paramSearchRouter`）；**结果不落库、无 datasetVersion、上限 16** | **高** | **是** |
| Dataset Binding | **PARTIAL** | 运行时绑 `datasetVersionId`（`researchRunRouter.ts:112-122`）；**重建路径丢坐标** | 中 | 部分 |
| Dataset Version | **PARTIAL** | 不可变版本行 + label；**两套坐标不接头**（`0035:1-21` 自述） | 中 | 部分（收敛坐标） |
| Compatibility | **MISSING** | 无 `requiredFeatures/Events/Fields/Frequency/Horizon/DatasetType`（grep 0） | **高** | **是** |
| Event Study | **READY** | `analyses/eventStudy.ts:65` | 低 | 否 |
| Signal Backtest | **READY** | `closedLoopWiring/executors.ts:406-512` | 低 | 否 |
| Portfolio Backtest | **PARTIAL** | 三套口径互不通用（§10.1 C） | 中 | 是（收敛） |
| Walk Forward | **PARTIAL** | `walkForwardRouter.ts`；底层走 legacy；闭环 notWired | 中 | 是 |
| OOS | **PARTIAL** | `oosIsolation/run.ts:125`；闭环 notWired | 中 | 是 |
| Paper Trading | **PARTIAL** | 生产在产（实测 4 行）；研究侧未装配 | 中 | 是（收敛） |
| Live Trading | **MISSING** | 全仓无券商接口 | —（未来） | 否（不在当前范围） |
| Research Promotion | **READY** | `promote` 唯一入口 + 幂等闸门 + 20+ 错误码 + 实测 9 次成功 | 中 | 否 |
| Provenance | **READY** | 13/13 候选有来源 dataset+run；9 条 provenance 行 | 低 | 否 |
| Replay | **RISK** | G1–G8（§9.3）：参数/代码版本/引擎版本/Universe/seed 全缺 | **高** | **是** |
| Leakage Protection | **RISK** | 数据层 PIT 守卫真实有效（`datasetAccess/invariants.ts`、直读桥 asOf）；**策略条件层无独立守卫** —— L2 的 `LeakageGuard` 因声明恒为 `EPOCH_FLOOR_DATE` 而恒通过，`validateStrategy13` 不拒绝 future 变量（§11.2 L1–L6） | **高** | **是** |
| Frontend | **PARTIAL** | 通用页面（非临时页）+ 9 区块覆盖；**Runs 无内嵌列表、已发布版本可编辑、候选→策略 0 链接** | 中 | 部分 |
| API | **PARTIAL** | 16+6+6 端点齐备；**缺 Publish/Archive/Update Draft**；1 组同实现别名；3 套 list/get run | 中 | 部分 |

**统计**：READY 6 / PARTIAL 12 / MISSING 2 / RISK 2（共 22 项）。

---

## 17. Critical Problems（按严重度）

### P0 — 阻断「通用策略引擎」成立

| # | 问题 | 影响 | 证据 |
|---|---|---|---|
| **P0-1** | **执行层特征是闭集**：所有策略信号最终只能由 4 个回踩派生特征 + `pctChange` 构成（`recipeRegistryAtoms.ts:107-116`），且 `compile.ts:63-68` 是**恒等映射** | 任何新策略（MA/突破/多因子）**必须改 4 处代码**，无法靠配置扩展 | §5.3 4.5、§15 Scenario B |
| **P0-2** | **无 Dataset Compatibility Contract** | 策略与数据集的匹配只能在**运行时靠抛错发现**，且回落重建路径绕过检查 | §8.4 |
| **P0-3** | **参数覆写在主运行入口上失效**：`loopRun.parameterSet` 只进 metadata，不落库不生效 | 「同一策略跑不同参数」在研究页面外**不可达**；合同字段是死的 | §6.4 |
| **P0-4** | **运行级复现快照缺失**：`parameterSet` / `codeVersion` / `engineVersion` / `seed` / `Universe` 全不落库（实测 6/6 零命中） | **历史回测无法精确复现**；「策略上线」无审计依据 | §9.2-9.3 |
| **P0-5** | **策略条件层无未来函数防护**：配方特征可用性声明恒为 `EPOCH_FLOOR_DATE`（`recipeRegistryAtoms.ts:47-60`，**有意设计**）⇒ `LeakageGuard` 恒通过；`validateStrategy13` 不拒绝引用 observation/outcome 的特征；`conditionSignal/compile.ts` 不调用任何泄漏守卫 | **「有守卫」的印象与「守卫不拦任何东西」的事实错位**。当前安全性**完全依赖数据层的逐行 PIT 不变量**（`datasetAccess/invariants.ts`）；策略声明层一旦越界不会被拦下 | §11.2 L2/L3 |
| **P0-6** | **`path.*` / `outcome.*` 无法表达 ⇒ 路径型策略（含「未来 N 日不破位」）不可表达**；研究侧用「窗口布尔」近似，两侧被显式登记为**不同构** | 现有核心策略的语义在两侧**本就不等价** | §5.3 4.4 |

### P1 — 结论可信度 / 声明与执行脱离

| # | 问题 | 证据 |
|---|---|---|
| P1-1 | DERIVED 参数**无求值器**（`derivedFrom` 仅人类可读） | §6.3 |
| P1-2 | 运行期搜索空间**不读 `parameterRole`** ⇒ FIXED 参数照样被搜索 | §6.2 |
| P1-3 | 参数**三处表示 + 有损派生**（`definition.parameters` → `document.parameters` → `ParameterSpace`）；执行层用有损的 v1 视图 | §6.4 |
| P1-4 | 参数搜索结果**不落库**、不记 datasetVersion、上限 16 | §7 |
| P1-5 | 回落重建路径**无「决策日资格」过滤**（直读有、重建无）⇒ 静默扩大决策范围 | §11.2 L4 |
| P1-6 | 特征计算**无运行时断言**（`bars[0]` 假定为首板日） | §11.2 L1 |
| P1-7 | `setVersionStatus` **无迁移表门槛**（`Draft→Production` 跳级不被拒） | §4.5 / §12.2 |
| P1-8 | `codeVersion` 实测全为 `1.0.0+gunknown` | §4.4 |
| P1-9 | 闭环 6 次实测**全部 PARTIAL_BLOCKED**（含 6 个 notWired 阶段） | §10.2 |
| P1-10 | 缓存键不含数据版本（`db.ts:2524`） | §9.3 G7 |

### P2 — 整洁 / 体验

| # | 问题 | 证据 |
|---|---|---|
| P2-1 | 分仓实现重复未收敛（`paperTrading.ts:723-734`） | §14.2 D1 |
| P2-2 | `runBacktestEngine2` 生产不可达 | §14.3 |
| P2-3 | legacy 复数 3 表「有类无实例」 | §14.2 D9 |
| P2-4 | `loadBundle` / `getVersionBundle` 同实现别名 | §12.1 |
| P2-5 | 候选→策略 **0 静态链接**（刷新即失联） | §13.5 |
| P2-6 | 已发布版本在 UI 中可打开编辑（无客户端门槛） | §13.3 |
| P2-7 | 硬编码模板/日期窗/示例壳 | §13.4 |
| P2-8 | 陈旧注释（ParameterSearch/WalkForward/reviewRouter 称「未挂载」） | §13.4 #6 |
| P2-9 | `closed_loop_backtest_run` 8 列写而不读 | §3.3 |

---

## 18. Architecture Risks（耦合分级，规格 §28）

### 🔴 Critical Coupling

| # | 耦合 | 为什么 Critical |
|---|---|---|
| C1 | **Strategy ↔ 首板回踩专用特征** | 执行层唯一可用的语义词汇就是这套特征（`pullbackFeatures.ts` + `recipeRegistryAtoms.ts:148-157`）。**这是当前「被具体策略绑死」的唯一真实落点**——不是字段名，而是**特征词表** |
| C2 | **Strategy ↔ 单一事件类型** | 全平台唯一数据集定义 `first_limit_pullback`、type=EVENT（探针 §5）⇒ 策略词表里 `FIRST_LIMIT_UP` 之外的类型**无数据可跑** |
| C3 | **Strategy ↔ Run 工作台装配层** | 参数覆写、数据集坐标、配方选择的唯一生效路径都在 `assembleRunWorkbenchInputs`；`loopRun` 若不走这个函数，参数就是死的 |

### 🟠 High Coupling

| # | 耦合 | 依据 |
|---|---|---|
| H1 | Strategy ↔ Research（转正转换器） | `definitionBuild.ts` 是唯一跨界点，且**研究侧变量名与策略侧字段引用没有翻译层**（`:432-450`，`RESEARCH-STRATEGY-GAP-AUDIT-001.md:56` P0-2） |
| H2 | Strategy ↔ 4 套策略模型 | ①治理 / ②执行 / ③研究 / ④模式声明 之间**无统一接口**（§4.1） |
| H3 | Backtest ↔ legacy 龙头候选链 | `walkForwardRouter:237`、`paramSearchRouter:281-348`、`/backtest` 页**三者底层都是 legacy** |
| H4 | Paper ↔ 分仓实现 | 第二份内联实现未收敛（D1） |

### 🟡 Medium Coupling

| # | 耦合 |
|---|---|
| M1 | Strategy ↔ Dataset 两套坐标（`rd-…` 与 `datasetVersionId`）不接头（`0035:1-21`） |
| M2 | 参数三处表示有损派生 |
| M3 | `closed_loop_backtest_run` ↔ legacy `backtest_runs` 两套历史并存 |
| M4 | 前端 ↔ 后端契约（`candidateSketchForm.ts` 白名单 vs 服务端读键，历史上已出过 §18 类缺陷） |

### 🟢 Low Coupling

| # | 耦合 |
|---|---|
| L1 | `patternLibrary` 声明 → 候选草图 / 配方的投影（已收敛为唯一 SoT） |
| L2 | `strategy_research_provenance` 独立切面表（display-only，不参与执行与校验 ✅ 设计良好） |
| L3 | `strategyEvaluation` 唯一评估端口（已收敛 ✅） |
| L4 | `datasetFromRegistry` 直读桥（唯一实现 ✅） |

---

## 19. Required Refactoring（规格 §19）

> **只给方向与边界，不建表、不改代码**（遵守规格 §34）。

### R1 — 执行契约层：把「特征词表」从闭集变成注册表驱动（解 C1 / P0-1）

- 现状：`compile.ts:63-68` 恒等映射 + `recipeRegistryAtoms.ts:107-116` 固定 5 个特征。
- 方向：**特征 = 第一步**（已完成的 `patternLibrary` 迁移（PATTERN-LIBRARY-001）证明这条路可行）；下一步是把「特征 id → 执行实现」也变成注册表，让新增特征只改 1 个声明文件。
- **可复用**：`recipeRegistryAtoms.ts` 的惰性单例模式、`patternLibrary/patterns/*.ts` 的「1 文件 + 1 行 index」范式。

### R2 — Rule 模型：补两条表达能力（解 P0-6 / §5.3）

- ① **右值表达式**（`volume > MA5Volume × 2` 这类）—— 当前 `valueType` 三值闭集不支持。
- ② **跨 bar 谓词**（「上穿」这类需要前一根 bar 的形态）。
- ⚠️ **禁止**用「把 OR 压成 AND」这类降级（`RESEARCH-STRATEGY-GAP-AUDIT-001.md:139-147` 已记录该决策）。OR/NOT 的方向应是**在策略侧新增逻辑位**，而不是在研究侧弱化。

### R3 — Parameter 系统：三处表示收敛为一处可信源（解 P1-1/2/3）

- ① `derivedFrom` 要么实现求值、要么**不要声明**（当前是「声明了却无效」的典型）。
- ② `deriveParameterSpaceFromDocument` 必须读 `parameterRole`（或明确改为只读 `definition.parameters`）。
- ③ 执行层 `resolveParameters(document.parameters, …)` 应改读 canonical 参数面，消除有损派生。

### R4 — 运行快照：把 metadata 变成结果契约的一部分（解 P0-4 / P1-8）

- `ClosedLoopRunMetadata`（`closedLoop/types.ts:556`）**已经算出了** `parameterSet` / `codeVersion` / `universeVersion`，只是没进 `ClosedLoopRunResult`（`researchRunRouter.ts:579-637`）。
- 最小改动方向 = 让 `persistClosedLoopBacktestRun` 拿到 metadata（不必新增表，现有 `resultJson` 就能承载）。
- **`engineVersion` 需要新增语义**：7 套引擎并存，必须能指明用了哪套。

### R5 — 参数搜索落库（解 P1-4 / §7）

- `ParameterSearchRun`（`parameterSearch/types.ts:265-299`）**已经是自足的可序列化对象**（含 `parameterSpace` 快照 + fingerprint + 每样本 `parameterSet`）。缺的只是持久化与 `datasetVersionId` 字段。

### R6 — Dataset Compatibility Contract（解 P0-2 / §8.4）

- 需要在 `StrategyDefinition` 上补「我要求数据集具备什么」的声明面，并在**装配前**做静态判定。
- **可复用**：legacy 研究契约已有 `requiredData` / `requiredFeatures`（`research/types.ts:72`、`strategyContract.ts:24`）的形态；`experimentValidation.ts:239-243,370-374` 已有校验器。
- ⚠️ 补声明时**必须当场找到消费者**（否则又是一个「声明了却无效」，见 §14 的教训）。

### R7 — Leakage 守卫落到实处（解 P0-5 / §11.2）

- ① 配方特征的 `availability` 不能是 `EPOCH_FLOOR_DATE`，必须由**真实数据窗口**给出。
- ② `conditionSignal/compile.ts` 应调用 `LeakageGuard`。
- ③ 重建路径必须补「决策日资格」等价物（或明确声明该路径不设资格并向用户显示）。

### R8 — 收敛重复（解 P2-1/2/3/4）

- 分仓：`paperTrading.ts:723-734` → 复用 `positionBudget.ts`（⚠️ 注意 D1 已漏 `positionScale`，收敛时必须确认口径）。
- `runBacktestEngine2`：要么接入生产、要么明确登记为保留给未来的研究引擎（当前状态是「不可达但不删」）。
- legacy 复数 3 表 Repository：已无实例，可登记为「保留表结构、移除未用类」。

---

## 20. Recommended Target Architecture（规格 §20 / §35）

> **这是边界建议，不是最终设计。** 真正的边界必须根据 R1–R8 的实施结果迭代确定。

### 20.1 真实合理的重构边界（基于实际代码，不照搬规格 §35 的图）

```text
┌──────────────────────────────────────────────────────────────┐
│ Research（研究）                                              │
│   research_question / plan / analysis / result / conclusion   │
│   ⚠️ 已成立，且与 Strategy 明确分离（candidates.ts:1-9）        │
│   ⚠️ 缺口：questionId / analysis configuration 不进候选表       │
└───────────────┬──────────────────────────────────────────────┘
                │  promote（唯一入口，20+ 错误码，幂等闸门）✅ 已健全
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Strategy（策略）—— 声明层                                     │
│   StrategyDocument（v1 兼容视图）+ StrategyDefinition（canonical）
│   ├── entry(event/window/conditions/trigger)                  │
│   ├── exit / position / risk / execution                      │
│   ├── parameters（role: FIXED/TUNABLE/DERIVED）⚠️ DERIVED 无求值 │
│   └── datasets[PRIMARY → datasetVersionId]  ✅ 已绑版本坐标     │
│   🔴 缺：requiredFeatures / requiredEvents / requiredFields    │
│         requiredFrequency / requiredHorizon / requiredDatasetType│
└───────────────┬──────────────────────────────────────────────┘
                │  ⚠️ 当前没有统一的 Execution Contract（4 套模型并存）
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Execution Contract（执行契约）—— 🔴 最需要重构的一层           │
│   现状：Strategy(纯函数) / StrategyContract(研究) /            │
│         FeatureGate(执行) / SignalEngine + simulator(闭环)      │
│   目标方向：                                                 │
│     Input  = { Dataset Version, Universe, Parameters, Time,    │
│                Context, Features(注册表) }                     │
│     Output = { Signal, Entry, Exit, PositionIntent, Explanation }│
│   ⚠️ 这是承载「多策略」的唯一卡点：特征必须注册表化             │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Dataset（数据集）                                            │
│   ✅ 已成立：dataset_definition / dataset_version（不可变版本） │
│   ✅ 已成立：直读桥 datasetFromRegistry（唯一实现，PIT 安全）  │
│   ⚠️ 待收敛：legacy research_datasets（rd-… 内容寻址）与       │
│              Registry 坐标两套不接头（0035:1-21 自述）         │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Backtest（回测）                                             │
│   ⚠️ 7 套引擎并存，其中 1 套不可达、2 套非等价                 │
│   留档表两套：closed_loop_backtest_run（新）/ backtest_runs（旧）│
│   🔴 快照缺：parameterSet / codeVersion / engineVersion /      │
│              seed / Universe / startedAt / completedAt        │
└──────────────────────────────────────────────────────────────┘
```

### 20.2 边界图的三个关键差异（vs 规格 §35 的建议图）

1. **Research 与 Strategy 的边界已经是对的**（显式转换器 + 分离模型 + 独立 provenance 切面），**不需要重画**。真正需要补的是**候选表里的 `questionId` / `analysis configuration`**（当前不从这两处落库）。
2. **「Execution Contract」这一格在现实里是 4 层而不是 1 层** —— 建议图中它是一层，实际是「声明层 / 执行层 / 研究层 / 模式层」四套。**这一格的收敛是整份审计里最贵、也最必要的工作**。
3. **Dataset 与 Backtest 之间的箭头方向需要修正**：现实中不是「Backtest 拉 Dataset」，而是**「装配层按策略文档声明的 `datasetVersionId` 直读 Dataset，失败则回落重建」**——回落的**坐标继承**是这里最危险的耦合点（§8.3）。

---

## 21. Migration / Implementation Impact（规格 §21）

### 21.1 影响面矩阵（按 R1–R8）

| 改造 | 数据库 | Strategy Domain | 前端 | Backtest Engine | 迁移 | 风险 |
|---|---|---|---|---|---|---|
| R1 特征注册表化 | ❌ 不需要 | ⚠️ 需要（特征声明面） | ❌ 不需要 | ⚠️ 需要（映射表） | 无 | 中（PATTERN-LIBRARY-001 已铺路） |
| R2 Rule 表达力 | ❌ | 🔴 需要（`valueType` / 逻辑位） | ⚠️ 需要（表单） | ⚠️ 需要（编译器） | 无 | **高**（触碰校验器 L1–L8） |
| R3 参数收敛 | ❌ | 🔴 需要 | ⚠️ 需要（三处契约同步，见 P2 教训） | ❌ | 无 | **高**（`legacyViews` 有损派生是双向的） |
| R4 运行快照 | ❌（`resultJson` 已能承载） | ❌ | ⚠️（展示） | ❌ | 无 | 低 |
| R5 参数搜索落库 | 🔴 **需新表** | ❌ | ⚠️（历史查询 UI） | ❌ | **需手写 SQL + 幂等 apply + `information_schema` 断言**（项目纪律） | 中 |
| R6 兼容性契约 | ❌ | 🔴 需要（新增声明面） | ⚠️（提示） | ❌ | 无 | 中（**必须当场找到消费者**） |
| R7 Leakage 落实 | ❌ | ⚠️ | ❌ | ⚠️ | 无 | 中（可能影响既有特征数值） |
| R8 收敛重复 | ❌ | ⚠️ | ❌ | ✅（删/接 `runBacktestEngine2`） | 无 | 低-中（分仓口径变更会重算历史数值 ⇒ **必须先经用户授权**） |

### 21.2 必须遵守的项目纪律（本项目既有铁律，改造时同样适用）

1. 🔴 **迁移 = 手写 SQL + 幂等 apply + `information_schema` 断言**；禁 `db:push`、禁 `drizzle-kit generate`、禁手写 `_journal.json`。
2. 🔴 **零 FK 纪律不变**：新增引用一律「快照值 + 软引用」。
3. 🔴 **改 `server/**` 会热重启并杀死在途 Run** ⇒ 动手前必须确认 `research_runs.status` 无 `RUNNING`。
4. 🔴 **改服务端契约必须同查前端三处**：白名单 / 可编辑表单 / 只读视图（`candidateSketchForm.ts` 教训）。
5. 🔴 **新增声明字段必须当场写一条「改它就变」的单测**；断言不了就**不要声明它**（P0-3 / P1-2 的共同成因）。
6. 🔴 **改分仓口径会重算所有历史数值 ⇒ 必先经用户授权**。

### 21.3 建议的实施顺序（按「是否解用户原始痛点 × 代价」）

| 顺序 | 内容 | 理由 |
|---|---|---|
| **1** | **R4 运行快照**（让 metadata 进结果） | 代价最低、立刻解 P0-4；不动 schema |
| **2** | **R3-③ 参数覆写接线**（`loopRun` 传 `parameterOverrides`） | 一行级改动，解 P0-3 |
| **3** | **R7 Leakage 落实** | 解 P0-5；不改 schema |
| **4** | **R6 兼容性契约** | 解 P0-2；需小心「声明即生效」 |
| **5** | **R5 参数搜索落库** | 解 P1-4；唯一需要新表的一项 |
| **6** | **R1 特征注册表化** | 解 P0-1；工作量最大但收益最广 |
| **7** | **R2 Rule 表达力** | 解 P0-6；风险最高，需先出设计 |
| **8** | **R3-①② / R8** | 收敛类，可在前面几项落地后做 |

---

## 22. Final Conclusion

### Q1 当前 Strategy Domain 是否足以作为整个量化平台的长期策略基础？

**部分是。**
- ✅ **可以作基础的**：身份/版本/不可变闸门（§4.5）、canonical 富定义 + 5 张投影（§4.6）、Dataset Registry 坐标绑定（§8.2）、研究溯源（§10）、唯一评估端口与唯一直读桥（§2.1）。
- 🔴 **不足的部分**：**执行契约层**（4 套模型并存、特征是闭集）、**兼容性契约**（不存在）、**运行快照**（不可复现）。
- 结论：**数据模型层可作为长期基础；执行层必须重构后才可以。**

### Q2 当前 Strategy 是否被「首板后回踩」绑死？

**没有在「表 / 接口 / 字段」层绑死（这点值得肯定），但在「特征词表 + 数据集供给」两层确实绑死了。**
- ✅ `StrategyDefinition` 无任何首板专用字段；前端是结构驱动的通用表单；新增策略不需要改数据库。
- 🔴 实证：执行侧可消费特征**只有 4 个回踩派生 + `pctChange`**（`recipeRegistryAtoms.ts:107-116`）；全平台数据集定义**只有 1 个**、事件类型只 `FIRST_LIMIT_UP` 一类有数据（探针 §5）。
- ⇒ 「绑死」的机理不是**字段**，而是**语义词汇与数据供给**。

### Q3 Strategy Version 是否真正具备不可变、可复现能力？

- **不可变：是（强证据）**——DB conflict 闸门 + 契约明文 + 无 update 端点（§4.5）。
- **可复现：部分**——版本级 `versionRecordJson` 完整（含 `parameterSet` / `codeVersion` / `backtestConfig` / `costModel`）；但 `codeVersion` 实测全为 `1.0.0+gunknown`，且**运行级参数覆写不落库** ⇒ **「版本可复现」成立，「某一次运行可复现」不成立**。

### Q4 Strategy Parameter 是否足够支持参数搜索？

**运行时「能扫」，工程上「不够」。** 元数据齐备（§6.1）但：DERIVED 无求值（§6.3）· 运行期不读 role（§6.2）· 三处表示有损派生（§6.4）· 搜索结果不落库（§7）· 上限 16 组 · 主运行入口覆写失效（P0-3）。

### Q5 Dataset Version 是否真正进入 Strategy / Backtest 的运行坐标？

**进入了**（这是本轮最重要的正面结论）：运行时唯一权威坐标 = `datasetVersionId`（`researchRunRouter.ts:112-122` → `datasetFromRegistry.ts:847-849`），实测 6/6 回测留档非空，前端三处选择器都提交 `datasetVersionId`。
🔴 **但有两个缺口**：① 回落重建路径 `datasetVersionId = null` 且不继承原口径；② 参数搜索 / WFO 完全没有数据集坐标。

### Q6 一次 Backtest 是否能够完整复现？

**不能。** 五要素缺三（运行级参数、有效代码版本、引擎版本），数据集版本在重建路径上也缺。见 §9.3 的 G1–G8。

### Q7 Event Study、Signal Backtest、Portfolio Backtest 是否能够共存？

**能共存，但不能共用一套口径。** 三者分属研究引擎 / 闭环 signalEngine / 三套组合实现；闭环 14 阶段中 6 个 `notWired`，6 次实测留档**全部 PARTIAL_BLOCKED**（§10.2）。

### Q8 Research → Strategy → Backtest 是否是真正的数据闭环？

**是「转正」闭环（READY），不是「回测」闭环（PARTIAL）。**
- ✅ 闭环成立且质量高：`createFromConclusion` → `promote`（唯一入口 + 幂等闸门 + 20+ 错误码）→ `strategies` + `strategy_versions` + 5 投影 + `strategy_research_provenance`；实测 9 次成功、13/13 候选带来源 dataset+run、9 条 provenance 一一对应。
- 🔴 断点：① `questionId` **无独立列**（只在 4/13 候选的 `sourceTraceJson` 里）；② `analysis configuration` **完全不进候选表**；③ 候选 → 策略页 **0 静态链接**（刷新即失联）。

### Q9 未来增加新策略时，需要改什么？

**分层回答（这是最实用的一条结论）：**

| 层 | 是否需要改 |
|---|---|
| **数据库** | ❌ **不需要**（已有 canonical 定义 + 5 投影 + 版本表承载） |
| **前端** | ❌ **不需要**（`DefinitionFields` 是结构驱动的通用表单） |
| **Strategy Domain** | ⚠️ **取决于词汇**：若只用现有事件/字段/算子 ⇒ **只需新增声明文件**（`patternLibrary/patterns/*.ts` + `index.ts` 1 行，PATTERN-LIBRARY-001 已铺路）；若需要新特征/新算子 ⇒ **必须改代码**（特征注册 + `compile.ts` 映射 + 可能 `STRATEGY_EVENT_TYPES` / `STRATEGY_DERIVED_BAR_FIELDS` 白名单） |
| **Backtest Engine** | ❌ **不需要**（除非新策略需要新的撮合语义） |
| **Dataset** | 🔴 **通常需要**：新策略若需不同事件/窗口，**必须新建数据集定义与版本**，且当前**无兼容性契约**来判定它够不够 |

⇒ 现状：**「同词汇新策略 = 纯声明；新词汇策略 = 改代码」**。这正是 §19 R1 要解的问题。

### Q10 当前最应该重构的是什么？

**按优先级，只做三件：**

1. 🔴 **执行契约层（R1 + R4 + R3-③）** —— 把「特征词表」注册表化、把运行 metadata 落进结果、把参数覆写接上装配层。三件加起来解掉 P0-1 / P0-3 / P0-4 三个 P0，且**零 schema 变更**。
2. 🔴 **Leakage 守卫落到实处（R7）** —— P0-5 是「假象型缺陷」，比缺失更危险：它让人以为有防护。
3. 🟠 **Dataset Compatibility Contract（R6）** —— 这是「通用策略引擎」的准入条件；没有它，新策略只能在运行时爆炸。

**明确不建议先做的**：新建 `strategy_rules` / `strategy_parameters` / `strategy_runs` / `backtest_configs` 表 —— **当前 schema 已经能承载这些概念**（5 张投影表 + `versionRecordJson` + `resultJson`），新表只会制造第二套 Source of Truth。

---

## 附录 A — 证据索引

| 类型 | 位置 |
|---|---|
| 只读库状态探针 | `docs/evidence/_probe_strategy_audit_state.mts` |
| 探针运行结果（JSON） | `docs/evidence/_probe_strategy_audit_state.out.json` |
| Schema | `drizzle/schema.ts`（策略域 485-809 / 闭环 2031-2075 / Dataset Registry 1164-1326 / Research 单数 1512-2289） |
| 迁移 | `drizzle/0026_*`、`0031_*`、`0034_*`、`0035_*`、`0036_*`、`0037_*` |
| 领域模型 | `server/research/strategySchema/{types,definition,definitionValidation,validate,map,projection,legacyViews}.ts` |
| 转正转换器 | `server/research/strategyCandidate/definitionBuild.ts` |
| 转正服务 | `server/research/strategyCandidate/service.ts:746` |
| 持久化 | `server/research/strategyPersistence/{db,service,contract,datasetBindingValidation}.ts` |
| 运行时装配 | `server/runWorkbenchAssembly/{assemble,datasetFromRegistry}.ts` |
| 评估端口 | `server/research/strategyEvaluation/{evaluate,evaluator,backtestBridge,parameterSpaceFromDocument}.ts` |
| 闭环装配 | `server/research/closedLoopWiring/{requirements,executors}.ts` |
| 前端 | `client/src/{App.tsx, pages/StrategyList.tsx, pages/StrategyDetail.tsx, components/strategy/*, components/research/*}` |
| 既有相关审计（对照） | `docs/research/RESEARCH-STRATEGY-GAP-AUDIT-001.md`、`docs/strategy/STRATEGY-003-difference-report.md`、`docs/strategy/STRATEGY-004-report.md` |

## 附录 B — 本次审计的边界与未确认项

1. **未执行**：未修改任何代码 / 库 / migration / API / 前端；未跑测试；未启动 dev server。
2. **未在真机验证**：前端「已发布版本可编辑」为**源码级判定**（`StrategyHeader.tsx:110-123` 无 status 判断），**未经无头浏览器实测**。
3. **未逐条核对全部 41 个迁移 vs schema**：只核对了策略/闭环/Dataset/Research 相关的 6 个迁移文件（结论：一致，除 1 处索引声明落后）。
4. **实库行数为 2026-09-19 单次快照**：本仓库**常有并行会话写入**，行数会变；本报告的所有「实测」数字均注明取自探针文件。
5. **`PARTIAL_BLOCKED` 6/6 的具体阻塞原因未逐条展开**：探针未取 `firstBlockedReasonCode` 分布（属可补充项，不影响本文结论）。
6. **规格 §12 Mode H（Live Trading）** 超出当前系统范围，本文只登记「无实现」。

---

## 附录 C — 一句话交付摘要

> **Strategy 域的数据模型已经具备承载多策略的形态（身份/版本/不可变/投影/数据集坐标/溯源六项 READY），真正把它锁在「单策略」上的是执行层的特征闭集、缺失的兼容性契约，与不可复现的运行快照。重构应集中在执行契约层，而不是数据模型层 —— 尤其不要新建策略规则/参数/运行表，那会制造第二套 SoT。**
