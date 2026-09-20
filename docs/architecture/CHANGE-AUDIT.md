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

## 2026-09-19 · ROBUSTNESS-001

- **Task**：Parameter Search 结果稳健性分析完整实现（`9bu`）—— 在**冻结快照**上判断参数邻域的稳定性 / 敏感性 / 离散度，**零重跑回测、零重算指标**。
- **Changed Domains**：`Robustness`（新增第三个并列子模块 `searchRobustness`）；`Parameter Search`（源表补两列 + 只读消费面）；`Frontend`（新面板 + 深色/浅色矩阵）。
- **Changed Files**：
  - 新增域：`server/research/searchRobustness/{types,canonical,domainValues,neighborhood,matrix,gate,analysis,run,persistence,executor,index}.ts`；
  - 新增契约：`shared/searchRobustnessContracts.ts`；
  - 新增前端：`client/src/components/robustness/SearchRobustnessPanel.tsx`；
  - 新增迁移：`drizzle/0042_search_robustness.sql` + `scripts/applySearchRobustness.mjs`；
  - 改既有：`server/paramSearchRouter.ts`（+6 端点、零新 router）、`drizzle/schema.ts`（+3 表 +2 列）、`server/research/parameterSearch/{persistence,executor}.ts`（补两列的写入 / 读出 + `finiteOrNull` 导出复用）、`shared/parameterSearchContracts.ts`（视图补两个**可选**字段）、`client/src/pages/ParameterSearch.tsx`（挂载面板）、`client/src/lib/status.ts`（+5 个状态语义色）。
- **Changed Contracts**：新增 `C-91`（`shared/searchRobustnessContracts.ts`）；`C-90` 视图**向后兼容**新增两个可选字段（`referenceCheckApplied` / `unreferencedTunableCodes`）。
- **Changed DB**：新增三表 `search_robustness_run`(33) / `search_robustness_result`(28) / `search_robustness_parameter_analysis`(16)，**0 FK**；`parameter_search_run` **ADD COLUMN** 两列（`referenceCheckApplied` / `unreferencedTunableCodesJson`，均 NULLable ⇒ 历史行为 `NULL` = 未知）。
- **Changed Execution Path**：`paramSearch` router 新增 6 个端点；**既有执行链一行未改**（`searchRobustness` 结构性不 import 回测 / 评估端口，静态守卫测试钉住）。
- **Potential Baseline Drift**：无（`GLOBAL AUDIT REQUIRED: NONE`）。⚠️ 须知道：① 稳健性分析**依赖**源 Search Run 为 `COMPLETED` 且结果全为 `canonical`（否则响亮拒绝）；② 对历史 Run（`referenceCheckApplied = NULL`）结论会带 `ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED` 标记，含义是「不保证被分析的参数真的被策略消费」。
- **Regression Result**：
  - `npx tsc --noEmit`：**0 error**；
  - 新增单测：`tests/server/research/searchRobustness/searchRobustness.test.ts` **54/54**、`robustnessBoundary.test.ts`（静态守卫）**5/5**；
  - 全量 `vitest run`：失败文件集合 **8 → 8（零新增）**；
  - `npx vite build`：成功；
  - 真实 2×2 E2E：`_e2e_robustness_search.mts` → **42/42 PASS**；
  - §12 真实历史数据路径：`_probe_robustness_unverified_reference.mts` → **9/9 PASS**；
  - 前端可达性：`_probe_robustness_dom.mjs` → `pass=true`、0 page error、深链可自渲染（**无回归**）；
  - migration：`scripts/applySearchRobustness.mjs` 首跑 4 executed / 次跑 **0 executed / 4 skipped**（幂等）、零 DML、0 FK；
  - `node scripts/checkEolDrift.mjs`：**0 漂移**。
- **Baseline Impact**：`v1.1.1` → **`v1.2.0`**（**minor**：新增 Domain 子模块 + 3 张表 + 1 份契约 + 6 个端点，既有执行链与核心契约**零破坏**）。已更新：`SYSTEM-BASELINE.md`（版本行 + 增量节 + §5 Robustness 行）、`system-manifest.yaml`（`robustness` 域三处）、`DOMAIN-MAP.md` §7、`DATA-FLOW.md`、`EXECUTION-FLOW.md`、`DATABASE-MAP.md`、`CONTRACT-MAP.md`（C-91）、`DEPENDENCY-MAP.md`、本文件。
- **GLOBAL AUDIT REQUIRED**：**NONE**。

---

## 2026-09-19 · OOS-001

- **Task**：Out-of-Sample Validation 完整实现（`9bv`）—— 把某次参数搜索冻结下来的候选参数，放到**它没参与过的数据窗口**上**真实重跑回测并重算 canonical 指标**，给出样本内外对照。核心原则：**IS / Search 用于发现参数；OOS 只用于验证，不能再次调参**。
- **Changed Domains**：`OOS`（新增 `oosValidation` 模块 —— 全仓**第一条「消费搜索结果且必须重跑回测」**的执行边）；`Frontend`（`/parameter-search` 新增 OOS 面板）。
- **Changed Files**：
  - 新增域：`server/research/oosValidation/{types,window,freeze,gate,comparison,run,definitionFingerprint,persistence,executor,index}.ts`（10 文件）；
  - 新增契约：`shared/oosValidationContracts.ts`；
  - 新增前端：`client/src/components/oos/OosValidationPanel.tsx`；
  - 新增迁移：`drizzle/0043_oos_validation.sql` + `scripts/applyOosValidation.mjs`；
  - 改既有：`server/paramSearchRouter.ts`（+6 端点、零新 router）、`drizzle/schema.ts`（+2 表）、`client/src/pages/ParameterSearch.tsx`（挂载面板）。
  - 🔴 **未改**：`server/research/parameterSearch/**` 的读写语义、`searchRobustness/**`（一行未动）、任何历史 Backtest / Search 数据行。
- **Changed Contracts**：新增 `C-92`（`shared/oosValidationContracts.ts`）。`C-90` / `C-91` 本轮**零改动**。
- **Changed DB**：新增两表 `oos_validation_run`(32 列) / `oos_validation_result`(41 列)，**0 FK、0 DML、0 ALTER、0 DROP**；既有 20 张邻接表列签名逐表一致。
- **Changed Execution Path**：`paramSearch` router 新增 6 个端点（`createOosRun` / `listOosRuns` / `getOosRun` / `startOosRun` / `cancelOosRun` / `getOosResult`）；**新增一条并行执行链 E-91**；既有主链与 E-90 **零改动**。
- **Potential Baseline Drift**：无（`GLOBAL AUDIT REQUIRED: NONE`）。⚠️ 须知道：① OOS Run **只认**「源 Search Run + `parameterHash`」，冻结信息不足时**显式失败**，**不允许**回读**当前**策略版本补全；② `COMPLETED` 后**不允许再次执行**（重复 `start` 幂等返回，`executed=false`）；③ 「真在不同数据上重跑」的**主判据是撮合指纹差异**，不是指标差异（零成交时两侧指标天然相等）；④ `averageWin` / `averageLoss` **两侧都拿不到** ⇒ 如实登记为 Known Risk，**不补值**。
- **Regression Result**：
  - `npx tsc --noEmit`：**0 error**（含 router 接线 / 重命名 / 前端面板 / DOM 锚点四轮改动后各复验一次）；
  - 新增单测：`tests/server/research/oosValidation/oosValidation.test.ts` **51/51**、`oosValidationBoundary.test.ts`（静态守卫：写点白名单 / 源只读白名单 / **必含清单** / 措辞守卫 / **命名不遮蔽**）**14/14**，合计 **65/65**；
  - 全量 `vitest run`：**失败文件集合 8 → 8（零新增）**，失败用例 **17 → 17（零新增）**；`oosValidation` 零命中；
  - `npx vite build`：成功（3041 modules，17.81 s）；
  - 真实 E2E（真实 tRPC + 真实 TiDB + 真实回测）：阶段一 `_e2e_oos_validation.search.out.txt` **2/2 PASS**（搜索真实耗时 42 s），阶段二 `.oos.out.txt` **12/12 PASS**，跨进程二次重跑 `.rerun.out.txt` **12/12 PASS**；源三表 digest 三次采样（创建前 / 创建后 / 执行后）**逐字节相同**；
  - 前端可达性：`_probe_oos_dom.mjs` → **`pass=true`、0 page error**、深链 `?oosRunId=` 无需点击即自渲染；创建区 `<input>` **恰为 4 个**（规格 §5 的 DOM 级证据）；
  - migration：`scripts/applyOosValidation.mjs` 首跑 **2 executed** / 次跑 **0 executed / 2 skipped**（幂等）、零 DML、`fk=0`、`altered=[]`；
  - `node scripts/checkEolDrift.mjs`：**0 漂移**。
- **Baseline Impact**：`v1.2.0` → **`v1.3.0`**（**minor**：新增 Domain 子模块 + 2 张表 + 1 份契约 + 6 个端点 + 1 个前端面板，既有执行链与核心契约**零破坏**）。已更新：`SYSTEM-BASELINE.md`（版本行 + 增量节 + §5 OOS 行）、`system-manifest.yaml`（`oos` 域）、`DOMAIN-MAP.md` §15、`DATA-FLOW.md`、`EXECUTION-FLOW.md`（新增 E-91）、`DATABASE-MAP.md`（D-92）、`CONTRACT-MAP.md`（C-92）、`DEPENDENCY-MAP.md`、本文件。
- **GLOBAL AUDIT REQUIRED**：**NONE**。

---

## 2026-09-19 · WALK-FORWARD-001

- **Task**：Walk-Forward 验证完整闭环（用户规格 24 节；编号 `9bw`）—— 滚动窗口编排 + Fold 隔离 + 结果汇总 + 可追溯。
- **Changed Domains**：新增 `walkForward` 域（`server/research/walkForward/**`，11 文件）。既有域**零逻辑改动**（唯一边界接触点 = `paramSearchRouter` 新增 6 端点 + 实现注入钩子）。
- **Changed Files**：
  - 新增 `server/research/walkForward/{types,windowSchedule,lifecycle,leakage,freeze,selection,aggregate,run,persistence,executor,index}.ts`
  - 新增 `shared/walkForwardContracts.ts` · `drizzle/0044_walk_forward.sql` · `scripts/applyWalkForward.mjs`
  - 新增 `client/src/components/walkForward/WalkForwardPanel.tsx`
  - 改 `server/paramSearchRouter.ts`（+6 端点 + 钩子实现）· `drizzle/schema.ts`（+2 表）· `client/src/pages/ParameterSearch.tsx`（挂载）
  - 新增测试 `tests/server/research/walkForward/{walkForward,walkForwardBoundary}.test.ts`（84 例）
  - 新增证据 `docs/evidence/_e2e_walk_forward.mts` + `_probe_wf001_recon.mts` + `_probe_walk_forward_dom.mjs`
- **Changed Contracts**：新增 `C-93`（`shared/walkForwardContracts.ts`）。`C-90` / `C-91` / `C-92` 本轮**零改动**。🔴 **删除**了创建入参里「被接受但从未生效」的 `parameterSearchSpace`（新增「无死旋钮」守卫防再犯）。
- **Changed DB**：新增 `D-93` 两表（`walk_forward_run` 33 列 / `walk_forward_fold` 36 列，**0 FK / 0 DML / 0 ALTER**，手工幂等 SQL `0044` + apply 脚本三模式）。**未** `db:push`、**未** `drizzle-kit generate`、**未**改任何历史数据。
- **Changed Execution Path**：`paramSearch` router 新增 6 个端点（`createWalkForwardRun` / `listWalkForwardRuns` / `getWalkForwardRun` / `getWalkForwardFold` / `startWalkForwardRun` / `cancelWalkForwardRun`）；**新增一条并行执行链 E-92**（每折各造一条 E-90 + 一条 E-91）；既有主链 / E-90 / E-91 **零改动**。
- **Potential Baseline Drift**：**无**。三条并列执行边的守卫方向已在本轮显式对齐（黑名单 / 必含清单 / 黑名单+注入），并把「命名不遮蔽」纪律写入 `DEPENDENCY-MAP.md`。
- **Regression Result**：`tsc --noEmit` = **exit 0**；新增单测 **84/84**；全量 `vitest run` = **8 failed files / 17 failed tests = 既有基线，零新增**（283 文件 / 4805 用例，失败文件集合逐项一致）；`npm run build` = **exit 0**；`checkEolDrift` = **0 漂移**；真实 TiDB E2E `create` **7/7** + `run` **10/10** + 跨进程 `rerun` **11/11** + `clean` 归零；DOM 探针 **`pass=true`** / 0 page error。
- **Baseline Impact**：`v1.3.0` → **`v1.4.0`**（**minor**：新增 Domain 子模块 + 2 张表 + 1 份契约 + 6 个端点 + 1 个前端面板，既有执行链与核心契约**零破坏**）。已更新：`SYSTEM-BASELINE.md`（版本行 + 域行 + 增量节）、`system-manifest.yaml`（`walkForwardValidation` 域）、`DOMAIN-MAP.md` §16、`CONTRACT-MAP.md`（C-93）、`DATABASE-MAP.md`（D-93）、`EXECUTION-FLOW.md`（E-92）、`DEPENDENCY-MAP.md`（D-91）、`DATA-FLOW.md`、本文件。
- **GLOBAL AUDIT REQUIRED**：**NONE**。

## 2026-09-20 · SYSTEM-BASELINE-002（round-2 全量审计，基线升 `v2.0.0`）

- **Task**：用户要求「再对全系统进行审计」。按 `v1.x` 协议先做 **Baseline Drift 检测**，判定**触发 `GLOBAL AUDIT REQUIRED`**（#4 核心数据流变化 / #7 核心 Contract 变化 / #1 Domain 新增）⇒ 执行 round-2 全量审计
- **Changed Domains**：**无代码改动**（本任务只读 + 文档）；被审计的域：Dataset · Research · Strategy · Parameter Search · Robustness · OOS · Walk-Forward · Backtest · 基础设施
- **Changed Files**：`docs/architecture/**` 11 份（版本统一 v2.0.0 + 新增 round-2 章节 + 纠错）；新增 `docs/evidence/_probe_baseline_v2_state.mts` + `.out.json` + `.out.txt`（已登记 `docs/evidence/README.md`）；新增 `docs/architecture/SYSTEM-BASELINE-002-REPORT.md`
- **Changed Contracts**：**无**（只登记 `shared/patternSemantics.ts` 与 `decisionOffsetDays` 等已存在契约）
- **Changed DB**：**无**（探针全程 SELECT；0 DDL / 0 DML）
- **Changed Execution Path**：**无**
- **Potential Baseline Drift**：**3 条新发现并已修正**
  - `BD-05` 基线**版本分叉**：同一次变更只升了 `SYSTEM-BASELINE.md`（v1.4.0），另 9 份仍 v1.0.0
  - `BD-06` 规模数字未同步：`63 表 / 60 声明 / 41 migration` ⇒ 实查 `73 / 70 / 45`
  - `BD-07` `docs/testing/README.md` 自述「288 文件」但命令表硬编码「277」⇒ **未修**（生成物禁手改，需改 `scripts/genTestDocs.mts:338`）
- **Regression Result**：未跑测试（本任务零代码变更；引用的是各阶段已跑读数：`tsc` 0 错 / `vitest` 7 文件 16 用例 = 零新增 / 哨兵 0 漂移）；探针 `errors=0`
- **Baseline Impact**：`v1.4.0` → **`v2.0.0`（major）**，依据 §15「核心数据流 / 核心 Contract / Domain 新增」三类同时命中；11 份文件版本号统一
- **GLOBAL AUDIT REQUIRED**：**#1 + #4 + #7**（本任务即为响应）

---

## 2026-09-20 · 9cc（Parameter Consumption + Semantic + Provenance + Strategy Projection 四断点闭环）

- **Task**：用户一次性指令（编号 `9cc`）要求收敛四个断点并做真实 DB/E2E。**先审计、再最小修复、再验证**，不拆任务、不跳阶段（任务书 §3）。
- **Changed Domains**：**无新增 Domain**。改动的域：`Research`（Pattern 语义投影 + 结论写入）、`Strategy`（语义声明的**执行侧消费点**，只读对表）、`runWorkbenchAssembly`（装配期多一次校验 + note）。`Parameter Search` / `Backtest` / `Dataset` **零代码改动**（Phase A 审计结论 = 链上无断点）。
- **Changed Files**：生产 6 个 —— `shared/patternSemantics.ts`（+归一化声明/校验/透传）、`server/researchEngine/semanticProjection.ts`（+归一化计算 + `needsEventBar`）、`server/research/patternLibrary/patterns/firstLimitPullbackHoldShrink.ts`（两条语义补 `normalization`）、`server/researchEngine/conclusion.ts`（主分支补齐 §15 五件套）、`server/research/patternLibrary/strategyConsumption.ts`（**新增**，执行侧消费点）、`server/runWorkbenchAssembly/assemble.ts`（+2 import + 装配期调用，结论并进既有 note）。测试 4 个（新增 2 / 改 2）。证据 3 个新探针 + 1 个旧探针按修复翻转哨兵。
- **Changed Contracts**：**1 处，且为纯增量** —— `shared/patternSemantics.ts` 新增 `SemanticNormalization`、`SEMANTIC_BASELINE_FIELDS`、`SemanticIssue` 新码 `INVALID_NORMALIZATION`，并给 `PatternSemanticDeclaration` / `ExpandedSemantic` 加**可选**字段 `normalization`。**既有消费者零破坏**（可选字段；`tsc --noEmit` = 0 错；全量测试零新增失败）。`ResearchConclusionDraft` 的**类型未改**（§15 五件套本就已声明，本任务只是把主分支漏写的地方补上）。其余契约零改动。
- **Changed DB**：**零**（0 DDL / 0 DML / 0 migration / 0 新表 / 0 新列）。E2E 自建行已按 id 精确清理（`purgedAfter={experiments:1, strategies:1}`、`finalExperimentCount=7`）。历史数据一律未改（`SELECT-first`）。
- **Changed Execution Path**：装配期新增一次**只读校验**（`verifyStrategyConsumption`：把语义声明的执行侧投影与 Core 特征注册表 + 本文档参数对表）⇒ 结论写进既有 `strategyDecisionEngineNote`（**非致命**、零 schema 变更）。**不改任何决策/撮合计算**，不新增特征值来源。参数消费链本身零改动。
- **Potential Baseline Drift**：
  - `BD-08`（**本任务新增，需裁定**）：本任务改动了 `shared/patternSemantics.ts` —— 该文件正是 v2.0.0 认定「核心 Contract 变化」（`GLOBAL AUDIT REQUIRED` #7）的受理对象之一。**本任务的判断**：改动是**纯增量可选字段 + 新增错误码**，无破坏性、无数据流新字段贯穿（不命中 #4，无新 Domain 不命中 #1，DB 零变化）⇒ **按任务书 §21 只做增量记录，未升基线、未追加 `SYSTEM-BASELINE.md` 增量章节**。若基线的判定口径认为「任何核心契约文件被改即需全量重审」，请在下一条指令中指定，本任务未擅自扩大范围。
  - `BD-09`（**本任务新增**）：AR-12 改变了 `pat_*` 变量的**取值语义**（同名变量：旧 Run = 最低价绝对值、新 Run = 归一化回撤比例）⇒ 已落库的旧统计与修复后的新统计**不可跨期直接比较**。历史行保留（修复不改变历史留档），风险登记在报告 §16 R3。
- **Regression Result**：`tsc --noEmit` = **exit 0**；全量 `npx vitest run` = **7 failed files / 16 failed tests —— 失败文件集合与既有基线逐个相同 ⇒ 零新增**（283 passed / 290）；`node scripts/checkEolDrift.mjs --strict` = **0 漂移**；真实 DB E2E = **24/24 PASS**（`pass=true`、`fatal=null`）。
- **Baseline Impact**：**保持 `v2.0.0`**。依据：无新 Domain、DB 零变化、无破坏性契约变更、无核心数据流新字段 ⇒ **不触发 `GLOBAL AUDIT REQUIRED`**。按任务书 §21「否则只做增量记录」处理。
- **GLOBAL AUDIT REQUIRED**：**NONE**（判定见 `BD-08`，留待人工裁定）。

---

## 2026-09-21 · 9ci（EXP-001 · 首板后回踩第一性研究）

- **Task**：用户投递 EXP-001 规格（34 节）+「按这个执行」。这是**独立研究实验基础设施（`9ch` / RESEARCH-EXPERIMENT-004）的第一次真实投产** —— 不改框架，用真实研究问题把「声明式实验定义 → 真库取数 → 结果落 TiDB + 产物落 MinIO → 关页面重开仍可回看」整条链走通。
- **Changed Domains**：**无新增 / 无删除 Domain**。改动落在 `Independent Experiment`（既有体系）之内，新增 1 个 ExperimentDefinition；`Research Core`（已于 `9cg` 整体删除）/ `Strategy Core` / `tRPC 路由` / `DB schema` **零改动**。
- **Changed Files**：生产 3 类 ——
  ⑴ **新增实验**：`research-experiments/first-board-pullback/fundamental-study/`（`result.ts` 结果组装 / 表 / 图 / 观察 / 产物声明、`experiment.ts` 取数与逐事件评估、`page.tsx` 前端页、`README.md` 口径说明）；
  ⑵ **注册点 2 处**：`research-experiments/manifest.ts`、`client/src/researchExperiments/pages.ts`（键 = `descriptor.pageKey`）；
  ⑶ **作者面契约同步 4 处**（本轮缺陷 ④⑤ 的修法）：`docs/research/EXPERIMENT-CODE-SPEC.md`（§P.3 示例 / §P.5 字段表 / 检查清单）、`research-experiments/template/experiment.ts`（演示 `artifact()` 调用的 `name`）、`research-experiments/template/README.md`、`research-experiments/README.md`。
  测试 1 个新增（`tests/server/researchExperiments/exp001FundamentalStudy.test.ts`，62 例）；证据 **3 个新探针**（`docs/evidence/_e2e_9ci_exp001.mts`、`docs/evidence/_probe_9ci_exp001_numbers.mts`、`docs/evidence/_probe_9ci_exp001_frontend.mjs`）+ 报告 `docs/research/EXP-001-final.md` + `docs/evidence/README.md` 新增 `9ci` 索引节。
- **Changed Contracts**：**核心契约零改动**（`shared/**` 未动、无 `GLOBAL AUDIT REQUIRED` #7 对象被改）。新增的 `fundamentalStudyCustomPayloadSchema` 是**实验内局部** zod schema（随实验目录走，不进 `shared/**`、不被其它 Domain 消费）。**唯一「契约级」改动是作者面文档/模板的产物命名口径**（`docs/research/EXPERIMENT-CODE-SPEC.md` + `research-experiments/template/**`）：产物 `name` **不得自带角色段**（`tables/` / `charts/` 由 `role` 拼）。这是**修正既有规范的自相矛盾**（§P.3 示例与 §P.5 映射表当时互相打架），不是引入新语义。
- **Changed DB**：**零**（0 DDL / 0 DML / 0 migration / 0 新表 / 0 新列）。真实 Run 由既有 `research_experiment_run` 表承载；`EXP001_KEEP=1` 保留了 `RUN-20260920-2A91D7C2` 一行 + 10 个 MinIO 对象供页面查看，属**本轮新增业务数据**（非结构变更），已在报告中登记。
- **Changed Execution Path**：**无主链改动**。新增的是一条**独立的实验执行路径**（既有 Runner / datasetPort / artifactStorage 端口原样复用）。**不改** `Dataset → Research → Strategy → Backtest` 任何一段既有语义。附带两处行为增强（都在实验/探针内部）：`candidates.unscannedEventCount` 出数；E2E 新增「无在途 Run」前置闸。
- **Potential Baseline Drift**：
  - `BD-10`（**本任务新增，需裁定**）：`docs/architecture/CHANGE-AUDIT.md` **自 `9cc` 起未再登记**，`9cd`～`9ch` 全部缺失；其中 `9cg` 删除了 `server/researchCore/**` 与 `server/researchEngine/**`（**Domain 删除** ⇒ 命中 `GLOBAL AUDIT REQUIRED` #2）与 12 张表 RENAME，而 `SYSTEM-BASELINE.md` 仍是 `v2.0.0`。按 `AGENT-GUIDE.md` §6「发现 Drift ⇒ 停下、记录、修 Baseline 文档、写 CHANGE-AUDIT、恢复任务」，**本任务只完成「记录」这一步** —— 修基线（含 `9cd`～`9ch` 的补记与 `9cg` 的全量审计）属**独立任务**，在本任务规格 §33「禁止范围扩张」下**不擅自执行**。建议下一条指令显式指定。
  - `BD-11`（**本任务新增**）：`EXPERIMENT-CODE-SPEC.md` §P.3 的代码示例与 §P.5 的映射表**曾自相矛盾**（`name` 是否含角色段），照抄示例会落成 `tables/tables/x.csv`。已修正并加**可证伪**的结构性闸门（全仓静态扫描，实测可红）。**登记理由**：这类「文档内部矛盾」不会被任何代码测试发现，只能靠真机 E2E。
  - `BD-12`（**本任务新增**）：`docs/evidence/README.md`（根目录证据簇索引）**自 `9ce` 起未再登记** —— `9cg`、`9ch` 两轮的证据文件缺失。本任务只补登了**自己那一轮**（`9ci` 节），并在该节以「⚠️ 本索引的缺口」显式标注了两轮欠账，**未擅自代补**（同 `BD-10` 的处理原则：记录优先于代改）。
- **Regression Result**：`tsc --noEmit` = **exit 0（0 error）**；`pnpm run build` = **exit 0**；`pnpm run test:changed` = **2 文件 / 71 例全绿 ⇒ 零新增失败文件**；定向 `npx vitest run tests/server/researchExperiments` = **11 文件 / 203 例全绿**；`legacyFreeProductionChain` Gate = **7 例 PASS**；`node scripts/checkEolDrift.mjs` = 漂移 **0 / 0**；EXP-001 单测 **62 例全绿**；真实 E2E（真库 + 真 Dataset + 真 MinIO）**20 步全 PASS**；**前端可达性探针（无头 Edge + CDP 量 DOM，走完整真实用户路径并真点一次「运行」）= 42 PASS / 0 FAIL**（新 Run `RUN-20260920-902A6515`）。
- **Evidence-Hygiene Note（非产品缺陷，但必须登记）**：前端探针**第一版跑出 15 条 FAIL，全部是判据自身写错**，不是产品缺陷 —— ⑴ 误以为「保留的 Run 会自动渲染在实验详情页」（实际结果区条件是 `outcome !== null`，只来自本次会话的 `runMutation` ⇒ 验证自定义结果页**必须真点运行**）；⑵ 侧栏导航项实为 `SidebarMenuButton` + `onClick`，**不是 `<a href>`** ⇒ `a[href=…]` 永远查不到；⑶ 观察类别在 DOM 里渲染为**中文标签**，枚举码从不进 DOM；⑷ 「免责声明不得删」**适用范围已收窄为研究侧强制件**，独立实验页从未要求挂免责声明。四条已改写为真判据并登记在报告 §19.4 与 `docs/evidence/README.md` 的 `9ci` 节。**登记理由**：一条恒假的判据挂在「已验证」清单里等于在回归闸上挖洞（永远红被当噪声 / 被刷成永远绿而什么都没证明），与产品缺陷同等级别。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：无新增 / 删除 Domain；DB 零变化；`shared/**` 核心契约零改动；无主链执行路径变化；新增的只是一个**注册在既有注册表里的 ExperimentDefinition**（Experiment 体系的 entry point —— `/research-experiments` 路由与 `manifest.ts` 注册表 —— 在 004 时已存在）⇒ 归入「只有实现细节变化」，按 §5 只更新 `CHANGE-AUDIT.md`。若判定口径认为「每新增一个 ExperimentDefinition 即算新增 entry point ⇒ 需 minor」，请在下一条指令中指定。
- **GLOBAL AUDIT REQUIRED**：**NONE**（本任务的改动面）。⚠️ 但 `BD-10` 指出 **`9cg` 的 Domain 删除从未触发过全量审计** —— 那是**历史欠账**，不因本任务而消失。

---
