# CHANGE-AUDIT — 最近变更记录

> **append-only**。新增条目**追加到文件末尾**，不修改历史条目。
> 作用：以后每次开发完成后**不重新全局审计**，只读本文件即可知道「上一次发生了什么」。
> 字段：`Date` / `Task` / `Changed Domains` / `Changed Files` / `Changed Contracts` / `Changed DB` / `Changed Execution Path` / `Potential Baseline Drift` / `Regression Result` / `Baseline Impact`。

**模板**（复制使用）

```markdown
## YYYY-MM-DD · <TASK-ID>

- **Task**：
- **Changed Domains**：
- **Changed Files**：
- **Changed Contracts**：
- **Changed DB**：
- **Changed Execution Path**：
- **Potential Baseline Drift**：
- **Regression Result**：
- **Baseline Impact**：       # 版本是否变化 / 更新了哪些基线文件
- **GLOBAL AUDIT REQUIRED**： # 触发的条目编号；无则写 NONE
```

---

## 2026-09-19 · SYSTEM-BASELINE-001（建立基线本身）

- **Task**：一次性全局架构审计 + 建立长期共享事实基线（`docs/architecture/**`）
- **Changed Domains**：**无**（本任务为只读审计 + 文档；未改任何 Domain 逻辑）
- **Changed Files**：
  - 新增 `docs/architecture/`：`SYSTEM-BASELINE.md` · `system-manifest.yaml` · `DOMAIN-MAP.md` · `DATA-FLOW.md` · `EXECUTION-FLOW.md` · `DATABASE-MAP.md` · `CONTRACT-MAP.md` · `DEPENDENCY-MAP.md` · `AGENT-GUIDE.md` · `CHANGE-AUDIT.md` · `SYSTEM-BASELINE-001-REPORT.md`
  - 新增只读探针：`docs/evidence/_probe_baseline_state.mts` · `_probe_baseline_tables.mts` · `_probe_baseline_ds_accounting.mts`（+ 对应 `.out.json` / `.out.txt`）
  - 登记 `docs/evidence/README.md`
- **Changed Contracts**：**无**（只登记，未修改）
- **Changed DB**：**无**（0 schema / 0 migration / 0 写入；探针全程 SELECT）
- **Changed Execution Path**：**无**
- **Potential Baseline Drift**：**无**（本任务就是建立基线）；但**发现并登记 11 条历史文档漂移**（H-1 ~ H-11）
- **Regression Result**：未跑测试（本任务零代码变更）；真实库实查 `errors=0`
- **Baseline Impact**：基线 **v1.0.0 建立**（全部 11 个基线文件首次生成）
- **GLOBAL AUDIT REQUIRED**：NONE（本任务即全局审计本身）

---

## 2026-09-19 · BACKTEST-002 收尾二（编号 `9br`）

- **Task**：B-04 口径收口 + R-02 `fixed-amount` 进 Schema + B-03 真实 Run 端到端 + R-04 zero-volume；判定 **BACKTEST-002 = COMPLETE**
- **Changed Domains**：`backtest` · `evaluation` · `strategy`（position sizing schema）
- **Changed Files**：`server/backtest/backtestResult.ts`（年化 244→252 + `maxDrawdownPct` 符号 + 算式形式 + `BACKTEST_ANNUALIZATION_BASIS`）· `server/research/closedLoop/adapters.ts`（`composeClosedLoopEvaluationRef` 取 canonical + `metricsSource`/`canonicalMetrics`/`annualizationBasis`）· `server/research/closedLoopWiring/executors.ts`（canonical 注入 + 年化基数不一致抛错）· `server/research/strategySchema/{types,validate,legacyViews}.ts` + `server/runWorkbenchAssembly/assemble.ts#mapDeclaredPositionSizing` · `server/researchRunRouter.ts`（解构 `artifacts` + 有界重试）· 新增测试 `canonicalMetricsParity.test.ts` / `positionSizingFixedAmountSchema.test.ts`
- **Changed Contracts**：`canonicalMetrics`（算式形式 + 符号 + 年化基数）· `ClosedLoopEvaluationRef`（新增 `canonicalMetrics` / `metricsSource` / `annualizationBasis`）· Strategy Schema（新增 `fixed-amount`）
- **Changed DB**：**无 schema 变更 / 无 migration**；唯一写库 = 1 条新 Run（`clrun-20260919075448567`）
- **Changed Execution Path**：`loopRun` 改解构 `{stageRunners, artifacts}` ⇒ 完整 `TradeSimulationRun` 可落库
- **Potential Baseline Drift**：**有 1 条** ⇒ 历史 6 条留档跑在 **v0 隐式政策**下、无 `backtest` 载荷（**刻意不回填**，已登记为 AD-08 / R-05）
- **Regression Result**：`tsc` 0 error；聚焦 20 文件 / 290 用例全绿；全量 vitest **8 失败文件 / 17 用例 = 基线集合逐项一致（零新增）**，用例 4304 → 4538；`vite build` 成功；`checkEolDrift` 0 漂移
- **Baseline Impact**：基线 §5 将 Backtest 标 READY；§14 登记 AD-05/06/07/09/10/11/17
- **GLOBAL AUDIT REQUIRED**：**第 7 条（核心 Contract 变化）**——触发过一次**局部**基线核对（本次 SYSTEM-BASELINE-001 已消解）

---

## 2026-09-19 · STRATEGY-ARCH-002（编号 `9bn`）

- **Task**：Strategy Core 生产接线 + 运行留档
- **Changed Domains**：`strategy` · `backtest` · `research`（共享契约）
- **Changed Files**：新增 `server/strategyCore/production/**`（`barWindow` / `eventSource` / `coreDecision` / `versionFromDocument` / `runRecord` / `index`）· `server/runWorkbenchAssembly/assemble.ts`（注入 `strategy13.signalBuilder`）· `shared/researchContracts.ts`（`strategyRunRecordSchema` + `assembly.strategyDecisionEngine`）· 新增 `tests/server/strategyCore/production/**`
- **Changed Contracts**：`SignalBuilderInput`（新增可选 `bars?` / `point?`）· `StrategyRecipeRuntime`（新增 `rankFeatureId`）· 新增 `strategyRunRecordSchema`
- **Changed DB**：**零 schema 变更 / 零 migration**（留档落 `resultJson.strategyRun`）
- **Changed Execution Path**：生产策略判断从 legacy 切到 Core ⇒ **历史回测数字不可直接对比**（legacy 门槛配方逐日出信号 vs Core 首个成立日出信号）
- **Potential Baseline Drift**：**有 1 条** ⇒ 生产已切 Core，但 legacy 门槛语义与 Core trigger 语义**未抹平**（已登记）
- **Regression Result**：`tsc` 0 error；`tests/server/strategyCore` 10 文件 / 158 用例全绿；全量 vitest 8 失败文件 / 17 用例（零新增）；`vite build` 成功
- **Baseline Impact**：§2.2 将 `strategyCore` 标为语义权威并已接生产（AD-04）
- **GLOBAL AUDIT REQUIRED**：**第 8 条（`StrategyRuntime` 改变职责）边界**——从「已建成未通电」变为「已接生产」

---

## 2026-09-19 · STRATEGY-ARCH-001（`9bi`）

- **Task**：Strategy Core 一次性实施（Phase A→D）
- **Changed Domains**：`strategy`
- **Changed Files**：新增 `server/strategyCore/**`（20 文件 / 6806 行，纯域层）· 新增 `tests/server/strategyCore/**`（6 文件 / 112 用例）· `docs/research/STRATEGY-ARCH-001-IMPLEMENTATION-{MAP,REPORT}.md`
- **Changed Contracts**：新增 Core 域契约（`StrategyCoreDefinition` / `StrategyDecision` / `StrategyRunSnapshot`）· 新增 `VERSION_IMMUTABLE` / `DATASET_BINDING_IN_DEFINITION_FORBIDDEN` / `LEGACY_MAPPING_UNSUPPORTED`
- **Changed DB**：**零迁移**（刻意不改 schema）
- **Changed Execution Path**：**未接生产**（N-02 登记）
- **Potential Baseline Drift**：无
- **Regression Result**：`tsc` 0 error；聚焦 6 文件 / 112 用例全绿；全量 vitest 8 失败文件 / 17 用例（零新增）；`vite build` 成功
- **Baseline Impact**：§2.2 三个语义权威之一
- **GLOBAL AUDIT REQUIRED**：NONE（新增域内子系统，未改 Domain 边界）

---

## 2026-09-19 · STRATEGY-AUDIT-001（只读审计）

- **Task**：Strategy 模块全域只读架构审计（37 节规格）
- **Changed Domains**：**无**（只读）
- **Changed Files**：新增 `docs/research/STRATEGY-AUDIT-001.md`（1166 行）· `docs/evidence/_probe_strategy_audit_state.mts` + `.out.json`
- **Changed Contracts / DB / Execution Path**：**无**
- **Potential Baseline Drift**：无
- **Regression Result**：未跑测试（只读审计）；探针 28 查询全成功 `errors=[]`
- **Baseline Impact**：其结论已被本基线吸收（`DOMAIN-MAP.md` §3、`CONTRACT-MAP.md`、R-04/R-05 等）
- **GLOBAL AUDIT REQUIRED**：NONE

---

## 2026-09-19 · BACKTEST-002 收尾轮（`9bq`）

- **Task**：B-03 持久化 + canonical Metrics（判定仍 NOT COMPLETE 5/6）
- **Changed Domains**：`backtest` · `evaluation`
- **Changed Files**：`server/backtest/backtestResult.ts`（`canonicalMetrics` / `CANONICAL_METRIC_KEYS` / `diffCanonicalMetrics` / `buildBacktestRunPayload`）· `server/researchRunRouter.ts`（解构 `artifacts`）· `shared/researchContracts.ts`（`backtestRunPayloadSchema`）
- **Changed Contracts**：新增 `backtestRunPayloadSchema`（`backtest` 段**可选**）
- **Changed DB**：**零 schema 变更**；本轮零写库
- **Changed Execution Path**：`resultJson.backtest` 段进入留档
- **Potential Baseline Drift**：有 ⇒ 年化基数 canonical **244** vs 其余 **252**（下一轮 `9br` 已修）
- **Regression Result**：`tsc` 0 error；`tests/server/backtest` 7 文件 / 84 用例全绿；全量 vitest 8/17（零新增）
- **Baseline Impact**：`CONTRACT-MAP.md` C-13
- **GLOBAL AUDIT REQUIRED**：第 7 条（核心 Contract 变化），已消解

---

## 2026-09-19 · BACKTEST-002（`9bp`）

- **Task**：执行正确性与结果持久化（判定 NOT COMPLETE）
- **Changed Domains**：`backtest` · `research/simulator`
- **Changed Files**：`server/research/simulator/plan.ts#applyPositionSizing`（B-02 仓位口径真正生效）· `server/backtest/context.ts`（`BACKTEST_EXECUTION_POLICY_VERSION = 1` + `zeroVolumePolicy`）· `server/research/simulator/engine.ts`（T+1 循环统一把关零成交量）· `server/runWorkbenchAssembly/assemble.ts`（映射 `document.positionSizing`）
- **Changed Contracts**：`ExecutionPolicy`（新增 `zeroVolumePolicy`）；**行为变更**：默认拦涨停买 / 拦跌停卖
- **Changed DB**：**零 schema 变更 / 零 migration**
- **Changed Execution Path**：`planDecisionDay` 预算参与 `applyPositionSizing`
- **Potential Baseline Drift**：有 ⇒ **历史回测数字不可直接对比**（默认政策翻转）
- **Regression Result**：`tsc` 0 error；`tests/server/backtest` 6 文件 / 74 用例全绿；全量 vitest 8/17（零新增）
- **Baseline Impact**：`EXECUTION-FLOW.md` §4 第 2/8 条
- **GLOBAL AUDIT REQUIRED**：第 9 条（Backtest Execution Architecture 改变）——**本任务曾触发，已由本次全局审计消解**

---

## 2026-09-19 · BACKTEST-001（`9bo`，判定 NOT COMPLETE）

- **Task**：Backtest Core 补齐与生产接线
- **Changed Domains**：`backtest`
- **Changed Files**：新增 `server/backtest/context.ts`（`BacktestContext` / `ExecutionPolicy` / `OrderIntent`）· 新增 `server/backtest/backtestResult.ts`· `server/backtest/index.ts` 改显式点名导出 · `server/runWorkbenchAssembly/assemble.ts`（显式传政策 + `checkExecutionSemantics`）· 新增 `tests/server/backtest/backtestCore.test.ts`
- **Changed Contracts**：新增 `BacktestRunResult`（与 legacy `BacktestResult` 同域不同形）
- **Changed DB**：**零变更**
- **Changed Execution Path**：装配层开始显式传执行政策；不在支持集的执行语义**响亮抛错**
- **Potential Baseline Drift**：有 ⇒ B-02 仓位只登记不执行（下一轮 `9bp` 已修）
- **Regression Result**：`tsc` 0 error；`tests/server/backtest` 5 文件 / 59 用例全绿；全量 vitest 8/17（零新增）
- **Baseline Impact**：`EXECUTION-FLOW.md` §4
- **GLOBAL AUDIT REQUIRED**：第 5/9 条触发，已消解

---

## 附 · 本基线消解的「未登记的架构级变更」

以下变更在 2026-09-19 之前已发生但**未经过全局审计**，本次一次性登记：

| 变更 | 影响 | 登记位置 |
|---|---|---|
| Dataset Registry 体系（A）建立，B 体系降级 | Dataset 域权威迁移 | `DOMAIN-MAP.md` §1、`DATA-FLOW.md` §2.2 |
| researchCore 单数 10 表建立 | Research 域数据模型替换 | `DOMAIN-MAP.md` §2、`DATABASE-MAP.md` §3.2 |
| Strategy Domain Model（5 投影表）建立 | Strategy 域存储层 | `DATABASE-MAP.md` §3.4 |
| Closed Loop 14 阶段编排建立（实装 8） | 执行链主入口 | `EXECUTION-FLOW.md` §1 |
| drizzle 发布链路自 0024 停摆 | migration 机制变更 | `DATABASE-MAP.md` §2 |
| 全库去外键（软引用） | DB 约束策略 | `DATABASE-MAP.md` §5 |
## 2026-09-19 · SYSTEM-BASELINE-001（收尾：并发环境下的 4 条 BASELINE_DRIFT）

> 本条**不是新任务**，是本任务在收尾自检时发现的漂移登记（`SYSTEM-BASELINE.md` §12.5 的 BD-01 ~ BD-04）。
> 记录动机：审计期间**工作区被并发会话改动**，而基线文档天然假设「代码是静止的」——这个假设本次不成立。

- **Task**：SYSTEM-BASELINE-001 收尾自检（`git status` + 行号复核 + 增量 DB 复核）
- **Changed Domains**：**无**（只读复核）
- **Changed Files**：新增 `docs/evidence/_probe_baseline_delta.mts` + `.out.json` + `.out.txt`；补丁更新 `docs/architecture/{SYSTEM-BASELINE,DATABASE-MAP,CONTRACT-MAP,DOMAIN-MAP,EXECUTION-FLOW,system-manifest.yaml,SYSTEM-BASELINE-001-REPORT,AGENT-GUIDE}.md|yaml`
- **Changed Contracts / DB / Execution Path**：**无**
- **Regression Result**：未跑测试（本任务零代码变更）；增量探针 `errors=0`

### BD-01 · 审计对象 = 工作区，不是 HEAD

| 项 | 值 |
|---|---|
| `drift` | 基线隐含假设「审计的是仓库当前版本」 |
| `actual` | **工作区有 11 个未提交的 `server/**` 改动**（`git diff --stat`：+254 / −79）—— `db.ts` · `research/closedLoopWiring/executors.ts` · `research/datasetAccess/session.ts` · `research/signalEngine/engine.ts` · `research/simulator/engine.ts` · `research/strategyEvaluation/evaluator.ts` · `researchRunRouter.ts` · `runWorkbenchAssembly/assemble.ts` · `runWorkbenchAssembly/datasetFromRegistry.ts` · `strategyCore/production/coreDecision.ts` · `strategyCore/runtime.ts` |
| `detectedBy` | SYSTEM-BASELINE-001（`git status --porcelain`） |
| `correctedAt` | 2026-09-19 |
| `reason` | 前序（STRATEGY-ARCH-002 / BACKTEST-002）与**并发**（PARAMETER-001-PRE）工作均未提交 |
| 处置 | 在 `SYSTEM-BASELINE.md` 头部显式声明「描述的是工作区快照」；`AGENT-GUIDE.md` 新增「开工前先 `git status --porcelain`」 |

### BD-02 · 行号在审计期间已漂移

| 项 | 值 |
|---|---|
| `drift` | `runtime.ts` 行号（`:495` `:499` `:505-512` `:521-546`，以及 `:184-185` `:316-317` `:337-341`） |
| `actual` | 并发会话于 **16:56** 改动该文件（+48/−2）⇒ 现 **595 行**：`definitionFingerprintCache` :171 · `evaluateWithDetail` :211 · 关卡① :221-222 · 关卡④ :274/:378 · `eventOccurred` :353-354 · `setEventOccurrenceResolver` :541 · `evaluateEventOccurrence` :545 · 抛错 :554 · `StrategyRuntime` :567 · `evaluate` :575 |
| `detectedBy` | SYSTEM-BASELINE-001（符号名 grep 复核） |
| `correctedAt` | 2026-09-19 |
| `reason` | 高频编辑 ⇒ 行号是 `auditedAt` 快照 |
| 处置 | `EXECUTION-FLOW.md` / `CONTRACT-MAP.md` / `DOMAIN-MAP.md` 的 `runtime.ts` 引用**全部改回符号名**；`AGENT-GUIDE.md` 新增陷阱 15/16 |

### BD-03 · R-06 从「主因未定位」变为「已定位 + 已修 + 已量化」

| 项 | 值 |
|---|---|
| `drift` | 基线初稿写「R-06 主因未定位（Core 求值仅占 8.7%）」 |
| `actual` | 并发 **PARAMETER-001-PRE** 已完成阶段级 profile 并修复：① `strategyCore/canonical.ts` 占 **44.3% CPU self time**（291.4 s / 657.9 s），根因 = `computeDefinitionFingerprint` **每次求值调 2 次**（≈341 万次 canonical 序列化 + sha256）；② 修法 = `runtime.ts#definitionFingerprintCache`（`WeakMap`，纯函数 + 不可变对象 ⇒ 逐字节等价）；③ 量化：零写库阶段基准**主窗合计 74,034 → 44,579 ms（−40%）**、**research 5,474 → 2,626 ms（−52%）**、`research.decision_day_loop` **56,289 → 25,803 ms（−54%）**，`equityDigest`/`tradeDigest` **逐字节不变**；④ **剩余瓶颈 = `db.read_ms` 95~96 s（58 次往返，未改善）** |
| `detectedBy` | 并发会话产出 `docs/evidence/_probe_param001_pre_profile.*` 与 `_probe_param001_stage_bench.{before,after}.*` |
| `correctedAt` | 2026-09-19 |
| `reason` | 审计与并发开发同时进行 ⇒ 基线的性能结论**已过期** |
| 处置 | `SYSTEM-BASELINE.md`（AR-2 / §5.2 / §13）· `system-manifest.yaml`（`parameterSearch.knownRisks` / `openFindings.AR-2` / `nextStage`）· `DOMAIN-MAP.md` §4 · `EXECUTION-FLOW.md` E-5 · 报告 §1/§2/§8/§18 全部更新为「已定位+已修，剩余 DB 读取」 |
| ⚠️ 边界 | **本任务不继续开发 PARAMETER-001**（规格 §28）；此处**只登记**并发会话的既有产出 |

### BD-04 · 闭环留档行数 7 → 8

| 项 | 值 |
|---|---|
| `drift` | 主采样（08:40Z）读到 `closed_loop_backtest_run` = **7** 行 |
| `actual` | 增量复核（08:58Z）= **8** 行；新增行 = `clrun-20260919083211921` / `EXP-20260919-PARAM001PRE` / `cand-360004` / `PARTIAL_BLOCKED` / `createdAt 2026-09-19 08:43:11`。带 BACKTEST-002 载荷（`policyVer=1` + `strategyRun`）由 **1/7 → 2/8** |
| `detectedBy` | `docs/evidence/_probe_baseline_delta.mts` |
| `correctedAt` | 2026-09-19T08:58Z |
| `reason` | 主采样时该 Run **正在在途**（08:32 起，约 657 s），结束后才落库 ⇒ 采样值必须**带时间戳** |
| 处置 | `SYSTEM-BASELINE.md` §7 / `DATABASE-MAP.md` §3.5 §7 D-6 / 报告 §5 全部改为**双时间戳**（`7 @08:40Z → 8 @08:58Z`） |

### 🔴 本任务从并发环境学到的两条纪律（已写入 `AGENT-GUIDE.md`）

1. **基线描述的是「工作区快照」，必须在文档里写清楚** —— 否则读者会以为它等于 HEAD。
2. **行号只是定位辅助** —— 本项目 `server/**` 高频编辑（还可能有并发会话）⇒ 定位一律用「**路径 + 符号名**」；行号对不上**不算 drift**。
3. **所有采样值必须带时间戳** —— 会随在途任务变化的量（Run 行数、指标）尤其如此。

- **Baseline Impact**：`v1.0.0` **不变**（无 Domain 边界/主链/核心契约变化；属「实现细节 + 状态跃迁」级别，但为可读性选择**不升版本**而登记为同一版本的收尾漂移）
- **GLOBAL AUDIT REQUIRED**：**第 11 条（Baseline 与代码出现重大冲突）**——已按 Drift 机制就地修正，**无需重跑全局审计**

---

## 2026-09-19 · PARAMETER-001（Parameter Search 完整实现）（编号 `9bs`）

- **Task**：按用户规格实现 Parameter Search 完整闭环
  （Strategy Version → Parameter Space → Parameter Combinations → Backtest → Evaluation → Search Results），
  **不处理性能优化**（归外部 Agent）、**不做全项目重新审计**、**不实现** RANDOM_SEARCH / BAYESIAN / TPE。
- **Changed Domains**：Parameter Search（`PREPARATION_PARTIAL` → **READY**）。
  未改其它域；`strategyEvaluation` 只**加字段**（`StrategyBacktestSample` 增 `evaluation` / `experimentId` / `evaluationRunId` / `backtestFingerprint`，既有消费者只读 `outcome` / `equityCurve` ⇒ 兼容）。
- **Changed Files**（本会话产出；`server/**` 与 `client/**` 各 1 处既有文件被增量修改）：
  - 新增域层：`server/research/parameterSearch/{searchSpace,parameterHash,combination,searchRun,searchResult,persistence,executor,coordinates}.ts`
  - 新增契约：`shared/parameterSearchContracts.ts`
  - 新增迁移：`drizzle/0041_parameter_search.sql` + `scripts/applyParameterSearch.mjs`
  - 新增前端：`client/src/components/parameterSearch/PersistedParameterSearchPanel.tsx`
  - 新增测试：`tests/server/research/parameterSearch/parameterSearchRun.test.ts`（38 用例）
  - 新增探针：`docs/evidence/_e2e_parameter_search.mts`、`_probe_parameter_search_dom.mjs`、`_probe_param001_strategy_inventory.mts`、`_probe_param001_list.mts`、`_probe_param001_cdp_health.mjs`
  - 修改：`server/paramSearchRouter.ts`（同域扩 7 端点）、`server/research/parameterSearch/index.ts`（barrel 注释说明为何不 re-export 执行层）、
    `server/research/strategyEvaluation/backtestBridge.ts`（暴露评估引用）、`drizzle/schema.ts`（3 表声明）、
    `client/src/pages/ParameterSearch.tsx`（挂载新面板）、`ROADMAP.md` / `ROADMAP-CHANGELOG.md` / `docs/architecture/*` / `.workbuddy/memory/*`
- **Changed Contracts**：**新增** `shared/parameterSearchContracts.ts`（C-NEW：参数空间快照 / 组合视图 / 结果视图 / Run 视图 / 7 端点入参；
  `recordVersion = 1`；**新增字段一律可选**）。`ClosedLoopEvaluationRef` **未改**（只被消费）。
- **Changed DB**：
  - 新增 `parameter_search_run`（26 列 / 4 索引，含 `uq_parameter_search_run_id`）
  - 新增 `parameter_search_combination`（10 列 / 3 索引，`uq_..._combination_hash (searchRunId, parameterHash)`）
  - 新增 `parameter_search_result`（23 列 / 3 索引，`uq_..._result_hash (searchRunId, parameterHash)`）
  - **0 FK**（全库软引用原则）；**无回填、无数据迁移**；既有表 apply 前后列签名与行数**逐表一致**（脚本断言）
  - ⚠️ 已登记：`drizzle/meta/_journal.json` 仍止于 0023 ⇒ 迁移只用手写 SQL + `scripts/applyParameterSearch.mjs`（幂等：第二次 0 executed / 3 skipped）
- **Changed Execution Path**：**新增一条**（不改既有主链）——
  `paramSearch.createSearch`（派生空间 + 生成组合 + 落 Run/组合）
  → `paramSearch.startSearch` → `executor#executeParameterSearchRun`
  → `strategyEvaluation/backtestBridge#createStrategyBacktestBridge`（**带区间数据集缓存**）
  → `evaluateStrategyParameters`（既有真实闭环 data→research→strategy→backtest→evaluation）
  → `searchResult#projectCanonicalMetrics`（**只读数、不重算**）→ 落 `parameter_search_result`。
  **未触碰**闭环主链（`researchRun.loopRun`）、未自建回测 / 策略运行时 / 指标。
- **Potential Baseline Drift**：
  1. `SYSTEM-BASELINE.md` 原记「Parameter Search = PREPARATION / PARTIAL，R-01 搜索结果不落库」⇒ 本轮**已收口**（应改）。
  2. 原记「R-05 `parameterRole` 门槛未生效」⇒ **已修复**（搜索域派生改读投影 `parameterRole`）。
  3. 原记「`DERIVED` 派生器 `parameterSpaceFromDocument.ts` 不读 role」⇒ **未改**（既有文件保留原语义；新链路走新派生器）⇒ 文档需写清**存在两条派生器**：legacy 视图用旧的（无 role），PARAMETER-001 用新的（带 role）。
  4. `adminProcedure` 在本仓**零使用**（实测全仓 0 命中）⇒ 新增写端点沿用既有 `publicProcedure` 惯例；文档未规定该点，未产生漂移。
- **Regression Result**：
  - `tsc --noEmit`：**0 error**
  - 新增单测：`tests/server/research/parameterSearch/parameterSearchRun.test.ts` **38/38 通过**
  - 全量 vitest：**8 失败文件 / 17 用例**（与既有基线**逐文件一致**，**零新增**）；用例总数 4538 → **4581**
  - `vite build`：成功（3039 modules，17.55 s）
  - `node scripts/checkEolDrift.mjs`：**0 漂移**（已跟踪 0 / 未跟踪 CRLF 0）
  - 真库迁移：`applyParameterSearch.mjs` `pass=true`（第二次 0 executed / 3 skipped）
  - 真实全链：`docs/evidence/_e2e_parameter_search.mts` → **37 项 / 0 失败**（4 组合 39 s、4-4 成功、`metricsSource=canonical`、二次 start `evaluated=0 / skipped=4`）
  - 前端可达性：`_probe_parameter_search_dom.mjs` → `pass=true`、0 page error（详情 / 结果区经真实点击可达）
- **Baseline Impact**：`v1.0.0` → **`v1.1.0`（minor）** —— 依据 §15「Domain 状态跃迁 + 新增 entry point / contract」。
  已更新：`system-manifest.yaml`（parameterSearch 域块 + nextStage）、`SYSTEM-BASELINE.md`（§3 / §5.2 / §6 / §9 / §13）、
  `DOMAIN-MAP.md`、`DATA-FLOW.md`、`EXECUTION-FLOW.md`、`DATABASE-MAP.md`、`CONTRACT-MAP.md`、`DEPENDENCY-MAP.md`、本文件。
- **GLOBAL AUDIT REQUIRED**：**NONE** —— 未新增 / 删除 Domain，未改 Domain 边界（Parameter Search 是既有域），
  未改主链（只在同域内新增一条**并行**执行链），未做 DB 核心 Schema 大规模变更（**新增 3 张留档表，零既有列改动**），
  未改 `StrategyRuntime` 职责。

---

## 2026-09-19 · PARAMETER-002（Parameter Search 有效性 Gate 与 Robustness 前置验收）（编号 `9bt`）

- **Task**：进入 Robustness / OOS / Walk-Forward **之前**，核查 Parameter Search 的**有效性**，
  重点定性 PARAMETER-001 报告的 N-02（不同参数组合结果完全相同且 `tradeCount=0`），顺带解决 N-01（窗口无 fail-fast）与确认 N-05（两套派生器）。
  **不做**性能优化、**不做**全局重扫、**不实现** Robustness/OOS/WFA/Simulation/Production。
- **Changed Domains**：Parameter Search（同一域内的**行为修正 + 新增校验**）。未改其它域。
  `strategyEvaluation/parameterSpaceFromDocument.ts` **只加文件头状态标记**（`LEGACY / PREVIEW` + 消费者清单），**零逻辑改动**。
- **Changed Files**：
  - 修改：`server/research/parameterSearch/searchSpace.ts`（死参数筛查 + `excludeUnreferencedDomains` + 校验语义修正）、
    `server/research/parameterSearch/executor.ts`（`assertSearchWindowWithinDataset` + 覆盖守护 + 死参数剥离顺序 + 新领域码）、
    `server/research/parameterSearch/persistence.ts`（只读 `readDatasetVersionWindow`，**北京业务日**）、
    `server/paramSearchRouter.ts`（`referencedParameterCodesOf` + 前置窗口校验接线）、
    `shared/parameterSearchContracts.ts`（创建回执新增 **可选** 字段 `referenceCheckApplied` / `unreferencedTunableCodes`）、
    `server/research/strategyEvaluation/parameterSpaceFromDocument.ts`（**仅注释**）、
    `ROADMAP.md` / `ROADMAP-CHANGELOG.md` / `docs/architecture/*` / `docs/evidence/README.md` / `.workbuddy/memory/*`
  - 新增测试：`tests/server/research/parameterSearch/parameterSearchEffectiveness.test.ts`（16 用例）
  - 新增探针：`docs/evidence/_probe_param002_{recon,recipe,candidate,parameter_sensitivity}.mts`、
    `docs/evidence/_e2e_param002_parameter_effect.mts`（+ 各自 `.out.json` / `.out.txt`）
- **Changed Contracts**：`shared/parameterSearchContracts.ts` 的 `parameterSearchCreateResultSchema` **新增两个可选字段**
  （`referenceCheckApplied` / `unreferencedTunableCodes`）。**可选 ⇒ 历史消费方不受影响**；`recordVersion` 未变（不构成语义破坏）。
- **Changed DB**：**无**（零迁移、零建表、零列改动）。`parameter_search_*` 三表结构不变；本任务只读 `dataset_version.startDate/endDate`（**只读，不修改 Dataset**）。
- **Changed Execution Path**：**主链未改**。PS 创建路径新增两道**前置拒绝**：
  ① 死参数（规则图未引用）⇒ `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`；
  ② 窗口越界 ⇒ `PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE`。
  执行链（`createStrategyBacktestBridge` → `evaluateStrategyParameters` → canonical metrics）**一行未改**。
- **Potential Baseline Drift**：
  1. `SYSTEM-BASELINE.md` / `system-manifest.yaml` 在 PARAMETER-001 里记的「遗留：createSearch 无前置窗口校验」⇒ **已消除**（应改）。
  2. 同处记的「遗留：4 组合指标逐位相同且 tradeCount=0」⇒ **已定性**（情况 D：文档规则图不引用参数；PS 链无缺陷），并已加护栏（应改）。
  3. PARAMETER-001 报告 §11 N-02 的「是否为执行链问题不属本任务范围」⇒ 本任务已完结该问题（应改）。
  4. 🔴 **行为变更（新预期行为）**：对「参数全为死参数」的历史候选创建搜索**会被拒绝** ⇒
     `docs/evidence/_e2e_parameter_search.mts`（PARAMETER-001 的 E2E）**其 create 段现在会失败**，
     已在文件头加「已被本任务取代」的说明 + 指向新 E2E。**这不是回归**，是护栏生效。
- **Regression Result**：
  - `tsc --noEmit`：**0 error**
  - 新增单测：`parameterSearchEffectiveness.test.ts` **16/16 通过**
  - Parameter Search 三文件：**84/84 通过**（30 + 38 + 16）
  - 全量 vitest：**8 失败文件 / 17 用例**（与既有基线**逐文件一致，零新增**）；用例 4581 → **4597**
  - 真实 tRPC E2E：`_e2e_param002_parameter_effect.mts` → **13/13 PASS**（负例 A/B + 正例 2 组合 + Resume + 自建自清残留 0）
  - 前端可达性：`_probe_parameter_search_dom.mjs` → `pass=true`、0 page error（**无回归**）
  - `node scripts/checkEolDrift.mjs`：**0 漂移**
- **Baseline Impact**：`v1.1.0` → **`v1.1.1`**（patch：**实现细节 + 行为修正**，无 Domain 边界 / 主链 / 核心契约变化）。
  已更新：`SYSTEM-BASELINE.md`（增量节 + N-01/N-02 状态）、`system-manifest.yaml`（`parameterSearch.knownRisks`）、本文件。
  **其余架构文档未改**（无实际架构变化 —— 按规格 §16「只有实际架构发生变化时才修改其他 Architecture 文档」）。
- **GLOBAL AUDIT REQUIRED**：**NONE**。

---
