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

---

## 2026-09-21 · 9cj（EXP-001 收口修正 · 全量样本 + 数据质量 + 决策时点条件矩阵）

- **Task**：用户投递 18 节规格「EXP-001 收口修正」+「按这个执行」。目标是把 EXP-001 从「研究链跑通 + 首次结果」提升为**可作为 Strategy 前置研究基准的正式版本**（**不是**新建 EXP-002）。三个必解问题：⑴ 数据集声明 23978 个事件而本轮只扫描 20000；⑵ `invalidOhlcBarCount` 与 `excludedCount` 口径不明、未来视界是否被异常 Bar 污染未证；⑶ 缺少 T+1…T+5 **各决策时点**下「不破条件 → 后续表现」的完整矩阵。规格 §1 明确**禁止重建框架**（优先复用 Independent Experiment Framework / Run Persistence / MinIO / Strategy Core / Parameter Search / OOS / Walk-Forward），§2 明确**优先分页而不是提高内存上限**。
- **Changed Domains**：**无新增 / 无删除 Domain**。改动落在既有的 `Independent Experiment` 体系内 —— 但它**不是**「只加了 1 个实验」，而是给平台加了一条**通用的数据访问能力**（扫描策略 + 分页迭代器 + 批量分块）：见 `Changed Contracts`。
- **Changed Files**：生产 6 类 ——
  ⑴ **平台（`server/researchExperiments/**`）**：`datasetPort.ts`（`iterateEventPages()` 生成器 + `loadEvents()` 改 `for await` + 分块 `loadBars` + 两个新上限常量 + 策略开关）、`index.ts`（导出面）、`runner.ts`（把 `eventScanPolicy` 注入 `deps`）、`shared/researchExperimentsContracts.ts`（`eventScanPolicy` 声明位 + `datasetFacts` 新字段）；
  ⑵ **实验**：`research-experiments/first-board-pullback/fundamental-study/experiment.ts`（改 `dataset.eventPages()` 流式消费 + 三项新数据质量指标 + 逐视界账目 + 决策矩阵计算）、`result.ts`（新字段 schema + 新表 + 新图 + `toEnvelopeTable` 显示位收敛）、`page.tsx`（双侧覆盖徽条 + 决策矩阵卡片 + 两口径 OHLC 块 + 逐视界样本账表）；
  ⑶ **作者面契约 4 处**（缺陷 ⑹ 的修法）：`docs/research/EXPERIMENT-CODE-SPEC.md`（§E.5 改写 / **新增 §E.6 全量扫描** / §H.4 补缺口纪律）、`research-experiments/template/experiment.ts`、`research-experiments/template/README.md`、`research-experiments/README.md`（三条 → 四条硬约束）；
  ⑷ **前端 1 处**：`client/src/pages/researchExperiments/ExperimentDetail.tsx`（pending 文案，缺陷 ⑻）；
  测试 1 个改动（`tests/server/researchExperiments/exp001FundamentalStudy.test.ts`，62 → **76 例**）；
  证据：**3 个新探针**（`docs/evidence/_probe_9cj_preflight.mts` / `_probe_9cj_run_readback.mts` / `_probe_9cj_tables.mts` + 各自 `.out.json`）、`docs/evidence/_e2e_9ci_exp001.mts` 扩到 **25 步**、`_probe_9ci_exp001_frontend.mjs` 扩到 **46 判据**并按最终态**重跑**。
- **Changed Contracts**：🔴 **有契约级改动（本任务与 `9ci` 的最大区别）** —— `shared/researchExperimentsContracts.ts` 新增 `eventScanPolicy: "PLATFORM_LIMIT" | "FULL_DATASET"`（实验**声明位**）与 `datasetFacts` 的新事实字段；平台侧新增 4 个公开常量（`EXPERIMENT_EVENT_SCAN_LIMIT = 20000` / `EXPERIMENT_EVENT_SCAN_HARD_LIMIT = 400000` / `EXPERIMENT_EVENT_PAGE_SIZE = 2000` / `EXPERIMENT_BAR_BATCH_SIZE = 2000`）与 `ExperimentDatasetAccess.eventPages()`（`AsyncIterable`）。**兼容性依据**：默认值仍是 `PLATFORM_LIMIT` + `20000` ⇒ 未声明的实验**行为完全不变**；`eventPages()` 是**新增**方法，不替换 `events()`。**未改** Research Core / Strategy Core / tRPC 路由 / 任何 ExperimentDefinition 的既有契约。
- **Changed DB**：**零**（0 DDL / 0 DML / 0 migration / 0 新表 / 0 新列）。两轮真实 Run（`RUN-20260921-9D216C34` / `RUN-20260921-8557F38A`）由既有 `research_experiment_run` 表承载；`EXP001_KEEP=1` 保留二者 + 各自 12 个 MinIO 对象供页面查看，属**新增业务数据**（非结构变更），已在报告 §19.2 登记。
- **Changed Execution Path**：**无主链改动**。新增的是**实验侧的取数路径**：`events()`（一次扫完）之外多了一条 `eventPages()`（流式分页）。⚠️ **但 `9cj` 暴露了一个执行路径上的既有事实**：`loadBars` / `feature(0)` / `observation(n)` 走 `access.events()` 会**再做一次完整分页**（`eventsPromise ??=` 只保证「只做一次」，**不等于「不做」**）⇒ 平台累计 `eventPageCount = 24` = 实验侧 `12` × 2。这不是新引入的缺陷，而是**全量扫描放大后第一次被看见**（`9ci` 时 20000 行只需 1 轮，累计 3 vs 3 看不出倍数关系）。**未改** `Dataset → Research → Strategy → Backtest` 任何一段既有语义。
- **Potential Baseline Drift**：
  - `BD-10`（**`9ci` 登记，仍未裁定**）：`docs/architecture/CHANGE-AUDIT.md` 自 `9cc` 起未再登记（`9cd`～`9ch` 缺失）；其中 `9cg` 删除了 `server/researchCore/**` 与 `server/researchEngine/**`（**Domain 删除** ⇒ 命中 `GLOBAL AUDIT REQUIRED` #2）与 12 张表 RENAME。本任务**未代补**（记录优先于代改）。
  - `BD-12`（**`9ci` 登记，仍未裁定**）：`docs/evidence/README.md` 自 `9ce` 起未再登记（`9cg` / `9ch` 缺失）。本任务只补登**自己那一轮**（`9cj` 节）并显式标注欠账，**未擅自代补**。
  - `BD-13`（**本任务新增，需裁定**）：🔴 **「新增平台能力」与「作者面契约」的同步已两次失手**（`9ci` 缺陷 ⑤：产物命名；`9cj` 缺陷 ⑹：扫描策略 / 分页 / 分块 / 两口径数据质量）—— 两次都是「规范与模板 grep 命中 **0**」⇒ **能力对增量使用等于不存在**，而**任何代码测试都抓不到**（模板不会被真机跑）。目前的对策是「全仓静态扫描闸门」（只覆盖产物命名一类）。**建议裁定**：为「平台新增公开能力」建立一条**强制的同步检查清单**（能力 → 规范 §段 → 模板演示 → 外部接入文档），否则第三次失手只是时间问题。
  - `BD-14`（**本任务新增，需裁定**）：🔴 **进舍规则是隐性口径**。`.xx5` 这类**恰好落在中点**的值，Python `f"{x:.2f}"` 走 **half-even**、JS `toFixed` 走 **half-away-from-zero** ⇒ 本轮对账时有 2 个值（`DD_1000BP` 的 T+20 平均、`T+1` 的 next10 中位）出现「到底谁写错了」的假冲突。已在对账脚本里**显式指定进舍规则**（`Decimal + ROUND_HALF_UP`）。**建议裁定**：报告 / 文档里的数值呈现是否统一为「JS `toFixed` 语义」并写进规范，避免同类假冲突在后续轮次重复消耗排查时间。
- **Regression Result**：`tsc --noEmit` = **exit 0（0 error）**；`pnpm run build` = **exit 0**（vite 17.44s → esbuild `dist/index.js` 3.0 MB）；`pnpm run test:changed` = **零新增失败文件**（失败项全部落在已知的**环境依赖**基线内）；定向 `npx vitest run tests/server/researchExperiments` = **11 文件 / 217 例全绿**；`node scripts/checkEolDrift.mjs` = 已跟踪文件漂移 **0** / 未跟踪新文件 CRLF **0**；真实 E2E **25 步全 PASS**；前端探针 **46 PASS / 0 FAIL**；报告数字对账 **359 项缺失 0 项**（且闸门自身可证伪）。
- **Evidence-Hygiene Note（非产品缺陷，但必须登记）**：🔴 **本轮共登记 7 条「判据自身写错」**（前端 5 + E2E 1 + 单测 2），全部是**恒假判据**。前端 `D4/D5/D6` 最典型：旧判据只断言「样本账有缺口」告警条**存在**，而全量落地后 `unscannedEventCount === 0` ⇒ 页面按设计**不再渲染**那条黄色告警条 ⇒ **恒假 FAIL**。**只留单侧判据等于在回归闸上挖洞** —— 它要么永远红（被当噪声忽略），要么被刷成永远绿（什么都没证明）。已改为**双侧互补 + 互斥反例**。另：E2E `6c` 曾把 `missing` / `invalid` 当**互斥划分**（实测 T+20 `22777 + 747 + 189 = 23713 ≠ 23712`），而**实现注释里本来就写着两者可重叠** ⇒ 正确不变式是**上限 + 覆盖**。**纪律**：发现此类错误时**必须同时登记「判据为什么错」**，而不是只把颜色刷绿。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：无新增 / 删除 Domain；DB 零变化；无主链执行路径变化；`shared/**` 的改动是**向后兼容的新增可选声明位**（默认值保证未声明者行为不变）。⚠️ 但 `BD-13` 指出「平台新增公开能力」这一类改动的**同步缺口**已两次失手，属于**流程级**欠账。
- **GLOBAL AUDIT REQUIRED**：**NONE**（本任务的改动面：无 Domain 增删、无 DB 结构变更、无主链语义变更、核心契约向后兼容）。⚠️ `BD-10`（`9cg` 的 Domain 删除从未触发全量审计）仍是**历史欠账**，不因本任务而消失。

## 2026-09-21 · 9ck（ROBUSTNESS-CROSS-STAGE-001 · 现有 Robustness 跨阶段通用性审计）

- **Task**：用户投递 12 节规格「ROBUSTNESS-CROSS-STAGE-001 — 现有 Robustness 跨阶段通用性审计」+「按这个执行」。目标：审计现有 Robustness 是否在「研究阶段」与「策略阶段」具有**相同的方法论语义**，判断 EXP-002 应**直接复用**还是**另写一套**。规格 §8 明确**只审计**：不创建 EXP-002、不改现有 Robustness、不建新 Core、不迁移数据库、不新增 migration、不为「通用化」提前重构、不合并 Research Experiment 与 Strategy Robustness、不删除实现。
- **Changed Domains**：**无**（纯只读审计，零代码改动）。审计识别出「Robustness」在本仓实为**三个并列模块**（C-18.1 `robustness/**` / C-18.2 `stochasticRobustness/**` / ROBUSTNESS-001 `searchRobustness/**`），**无共享基类**。
- **Changed Files**：**零个生产文件被修改** —— `git status --porcelain -- server/ shared/ client/ tests/ drizzle/ scripts/` 的结果与审计开始前**逐行相同**（全部为 `9cj` 遗留的 `M`）；审计本身**未改任何代码 / 契约 / DB**。⚠️ 按规格 §11 的台账登记要求，本轮**修改了 4 个已跟踪的台账 / 索引文档**：`ROADMAP.md`、`ROADMAP-CHANGELOG.md`、`docs/architecture/CHANGE-AUDIT.md`、`docs/evidence/README.md`（**全部落在文档面**）。新增（未被 git 跟踪 —— `docs/evidence/` 已被 `.gitignore:152` 忽略）：报告 `docs/research/ROBUSTNESS-CROSS-STAGE-001.md`（535 行）＋只读探针 `docs/evidence/_probe_robustness_cross_stage_state.{mts,out.json}`＋闸门输出 `docs/evidence/_gate_robustness_cross_stage_audit.out.txt`。
- **Changed Contracts**：**零**。
- **Changed DB**：**零 DDL / 零 DML / 零 migration / 零新表 / 零新列**。只读探针的**每条 SQL 均为 SELECT**。
- **Changed Execution Path**：**零**。
- **Potential Baseline Drift**：
  - `BD-15`（**本任务新增，需裁定**）：🔴 **规范口径歧义** —— `docs/research/EXPERIMENT-CODE-SPEC.md:559`（§M 禁止事项）原文「改 Strategy Core / 重做 Parameter Search / Backtest / OOS / Walk-Forward / **Robustness** ｜ 本体系不碰这些能力」。该行**禁的是「改 / 重做模块本身」**，但字面「本体系不碰这些能力」会被 EXP-002 作者误读为**连消费都不许** ⇒ 属**过度禁止**。**建议**：改为「**改 / 重做** … **模块本身**」并补一句「研究侧**可以**消费其方法（见 `ROBUSTNESS-CROSS-STAGE-001`）」。**本轮不改**（只读审计）。
  - `BD-16`（**本任务新增，需裁定**）：🔴 **「Robustness」一词在本仓有三个互不相同的所指**（四轴扰动重估 / 随机化重估 / 冻结结果邻域分析），且其中一组**语义相反**（`searchRobustness` **零重跑** vs 另两者**重跑**）⇒ 沟通与文档中**不指明模块名极易误解**。**建议**：在 `SYSTEM-BASELINE.md` 的 Robustness 节固定一张「三模块语义对照表」（`docs/robustness/ROBUSTNESS-001-REPORT.md` §1.2 已有雏形），并要求后续文档提及 Robustness 时**必须带模块路径**。
  - `BD-17`（**本任务新增，需裁定**）：🔴 **同一套漂移语义在仓内有两份实现** —— `server/research/overfittingDetection/parameterSensitivity.ts:159`（`computeDrift`）与 `:173`（`applyDriftThresholds`）**自己写了一套**，未复用 `server/research/robustness/drift.ts:156` 的 `computeRobustnessDrift` / `:329` 的 `assessRobustnessSensitivity`（后两者在 `robustness/**` 之外**生产代码全仓 0 命中**）⇒ 「核心比较机制**从未**被跨域复用」。**建议裁定**：登记为**独立技术债**（回收重复实现 + 把 `server/paramSearchRouter.ts:596-606` / `:609-634` / `:638-655` 的按轴 switch 上移到适配层），**但须等 EXP-002 的抽象层定稿后再做**，否则会为错误的抽象层白做一次。
  - `BD-10`（`9ci` 登记，仍未裁定）：`CHANGE-AUDIT.md` 的 `9cd`～`9ch` 五条缺失（`9cc` 之后未登记；`9ci` / `9cj` 已由后续轮次补记）。本任务**未代补**（记录优先于代改）。
  - `BD-14`（`9cj` 登记，需裁定）：进舍规则（`.xx5` 中点值 half-even vs half-away）是隐性口径 —— 与本任务无关，保持登记。
- **Regression Result**：**本轮不适用「回归」**（零代码改动）。为满足「只读可核」纪律实跑：`node scripts/checkEolDrift.mjs` = **0 / 0**；**生产代码 / 契约 / DB 零改动**（`git status --porcelain -- server/ shared/ client/ tests/ drizzle/ scripts/` 与审计开始前**逐行相同**）；报告 **535 行 / 纯 LF**（`crlf = 0`）；对账闸门 **75 / 75 PASS**（退出码 0，**自身可证伪**：篡改探针计数必变红）。
- **Evidence-Hygiene Note（非产品缺陷，但必须登记）**：🔴 **闸门首跑 2 条 FAIL，全部是判据自身写错** —— ① 报告给的是**区间** `tests/server/research/searchRobustness/robustnessBoundary.test.ts:72-82`，判据却把区间内行号 **74** 写死（实测第 74 行是 `"backtest/types",`）⇒ **行号位移即恒假**；② grep 正则写 `from "(\.\./)+vocabulary"` **只认多级相对路径**，漏掉 `from "./vocabulary"`（`candidateRepository.ts:51` / `candidateRules.ts:12` / `conditionSet.ts:22`）与 `from "../research/vocabulary"`（`researchExperiments/strategyBridge.ts:62`）⇒ 数出 **5**（真值 **9**）⇒ **假 FAIL**。**同一病因：把「我当时看到的那一行 / 那几种写法」当成契约本身**（第 1 条把区间当点、第 2 条把「恰好在 grep 里看到的写法」当全部写法），与 `9cj` 的 9 条作废判据同属一类。已改为「区间断言 `has_range()`」与「不限定路径层级的正则」，并把两条错误连同「为什么错」登记进报告 **§12.1**。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：零 Domain 增删、零 DB 变更、零契约变更、零执行路径变更；**唯一产物是一份审计报告 + 一个只读探针 + 一份闸门输出** ⇒ 归入「只有文档 / 证据变化」，按 `AGENT-GUIDE.md` §5 只更新 `CHANGE-AUDIT.md`。
- **GLOBAL AUDIT REQUIRED**：**NONE**（本任务零改动面）。⚠️ `BD-10`（`9cg` 的 Domain 删除从未触发全量审计）仍是**历史欠账**，不因本任务而消失。

## 2026-09-21 · 9cl（EXP-002 · Research Robustness / Stability Validation 完整闭环）

- **Task**：用户投递 26 节规格「EXP-002 — Research Robustness / Stability Validation 完整闭环」+「按这个实行」。这是上一轮审计（`9ck` / `ROBUSTNESS-CROSS-STAGE-001`，结论 **B = 核心可复用、需要轻量适配**）的**落地轮**：把 EXP-001 的研究条件铺成条件矩阵，用**现有 Robustness 的核心方法**（而不是新写一套）对**同一个 Baseline** 逐变体**真重算**，按**声明容差**判定 `稳定 / 敏感 / 指标不足 / 执行失败`，并让整条链在一个真实 Dataset 上闭合（规格 §26）。规格 §1.1 禁复制 `ResearchRobustnessEngine` / `…Evaluator` / `…Drift`；§1.2 禁第二套持久化；§1.3 禁改 Dataset / Strategy / Parameter Search / Backtest / OOS / WFA 业务语义；§17 列出禁止实现方式；§25 给出**停止条件**（若泛化需大规模重构或影响既有语义 ⇒ 立即停止扩范围）。
- **Changed Domains**：**无新增 / 无删除 Domain**。改动落在两处**既有**体系内 —— ⒜ `Strategy Robustness`（C-18.1，`server/research/robustness/**`）被**泛化**（不是被复制、不是被替换）；⒝ `Independent Experiment`（既有体系）新增 1 个 ExperimentDefinition 与 1 个**引桥模块**。`Research Core`（`9cg` 已整体删除）/ `Strategy Core` / `tRPC 路由` / `DB schema` **零改动**。⚠️ 与 `9ck` 的对照：那一轮识别出本仓「Robustness」实为**三个并列模块**（C-18.1 / C-18.2 / ROBUSTNESS-001，无共享基类），本轮**只泛化 C-18.1**，`stochasticRobustness/**`（C-18.2）与 `searchRobustness/**`（ROBUSTNESS-001）**零改动、零新增引用**。
- **Changed Files**：生产 4 类 ——
  ⑴ **泛化层（本轮真正的交付物，3 个新文件 / 1540 行）**：`server/research/robustness/dimension.ts`（502 行 / 不透明维度 + 泛化指标**两态**快照 + 样本账）、`comparison.ts`（333 行 / `evaluateTolerance` + `summarizeUnitVerdict` + `resolveComparisonSpecs` + `COMPARISON_DIRECTIONS`）、`multiDimension.ts`（705 行 / `runMultiDimensionRobustness` + 序列化 + 确定性指纹；新常量 `MULTI_DIMENSION_RUN_ID_PREFIX = "RBM"` / `MULTI_DIMENSION_RUN_RECORD_KIND` / `MULTI_DIMENSION_RUN_RECORD_VERSION = 1` / `MULTI_DIMENSION_ACCOUNTING_FORMULA`）；
  ⑵ **既有文件泛化（7 个 `M`）**：`server/research/robustness/{drift,evaluate,index,serialize}.ts` —— **旧调用方形状不变、旧单测全绿**（这是「复用」的代价与证据）；
  ⑶ **实验与引桥**：`research-experiments/robustnessBridge.ts`（**92 行 / 零实现 / 零状态 / 零 IO**，分纯类型段与运行时值段）+ `research-experiments/first-board-pullback/stability-validation/`（`experiment.ts` 1219 行 / `result.ts` 1468 行 / `page.tsx` 736 行 / `README.md` 117 行）+ **注册点 2 处**（`research-experiments/manifest.ts`、`client/src/researchExperiments/pages.ts`，键 = `descriptor.pageKey`）；
  ⑷ **平台 1 处真缺陷修复**：`server/researchExperiments/persistence/runManifest.ts#inferArtifactDescriptor`（`.json + role:"artifact"` 被错分进 `tables` 段 ⇒ 改角色优先级）+ `client/src/pages/researchExperiments/ExperimentDetail.tsx`（pending 文案）。
  测试 2 个新增（`tests/server/research/robustness/multiDimension.test.ts` **48 例**、`tests/server/researchExperiments/exp002StabilityValidation.test.ts` **50 例**）+ 1 个改动（`runPersistence.test.ts` +2 例 ⇒ 33 例）；
  证据：**3 个新探针**（`docs/evidence/_e2e_9cl_exp002_stability_validation.mts` 921 行 29 步 / `docs/evidence/_probe_9cl_exp002_frontend.mjs` 918 行 56 判据 / `docs/evidence/_ops_cleanup_9cl_superseded_runs.mts` 白名单清理）+ 各自 `.out.json`（含 `.first` / `.prefix` / `.extendonly` / `.r4` 四份**中间态留档**）+ 报告 `docs/research/EXP-002-REPORT.md`（774 行 / 19 项）+ 四处台账。
- **Changed Contracts**：🔴 **有契约级改动，但全部落在 `server/research/robustness/**` 的公开形状与服务侧，且**向后兼容**`** —— ⒜ `Dimension` 由「4 个策略执行轴的封闭枚举」泛化为**不透明泛型表达**（**保留四轴常量与类型**，旧调用方形状不变）；⒝ 指标由「恰 3 个交易标量」改为 `Record<string, number>`（**词表由调用方声明**、核心零白名单）；⒞ `RobustnessMetricSnapshot = { metrics, unavailable }`（**「不可用」升为独立一等状态**，两边必须**恰好覆盖**声明词表）；⒟ `RobustnessSubject`（`subjectKind` / `subjectId` / `subjectVersion` / `subjectRunId`，唯一映射点 = `subjectFromStrategy` / `subjectFromExperiment`，**旧结构零改动**）。**未改** Research Core / Strategy Core / tRPC 路由 / DB schema / 任何既有 ExperimentDefinition 的契约。⚠️ **`shared/**` 本轮零改动**（EXP-002 的信封继续走 Independent Experiment 的**动态信封**，不建全局固定 schema）—— 这与 `9cj`（改了 `shared/researchExperimentsContracts.ts`）形成对照。**唯一「契约级」改动是作者面文档**：`docs/research/EXPERIMENT-CODE-SPEC.md` 新增 **§P.6.1「🔴 Manifest 的索引分组只由 `role` 决定，不看扩展名」**，并**一并澄清** `9ck` 登记的 `BD-15`（原文「本体系不碰 Robustness」的**过度禁止** —— 禁的是「改 / 重做**模块本身**」，研究侧**可以消费其方法**）。
- **Changed DB**：**零 DDL / 零 DML / 零 migration / 零新表 / 零新列**（`drizzle/**` 零改动；migration 已用至 `0047`，**未增** `0048`）。本轮不做任何**清理**：`9ck` 实测的 9 行孤儿数据（`search_robustness_result` 6 + `search_robustness_parameter_analysis` 3，父表 0 行、0 FK 无级联）**只登记、不清理**（规格 §20）。真实 Run `RUN-20260921-46934548` 由既有 `research_experiment_run` 表承载；**刻意保留 2 条** Run（`RUN-20260921-A95F5B48` 后端 E2E 首跑、`RUN-20260921-C95B1D47` 前端探针）供人工查看；中间态 3 条（`CB9F8DE7` / `8E4115EC` / `356542B0`）已用**白名单式脚本**删除（`deletedRows = [1,1,1]`、`deletedObjects = 24`、`leftoverObjectsInDeletedPrefixes = 0`；白名单外出现即 `exit 2`）。以上均属**新增 / 清理业务数据**（非结构变更），已在报告 §18.4 登记。
- **Changed Execution Path**：**无主链改动**（`Dataset → Research → Strategy → Backtest` 一段未动；Strategy / Parameter Search / Backtest / OOS / WFA 的**改动为 0**，符合 §1.3 与 §25）。新增的是一条**跨阶段消费路径**：`实验侧真重算 → 核心比较/聚合（零 IO、零重算） → 结果信封 → MinIO`。⚠️ **一处既有事实被本轮放大**：平台累计 `datasetFacts.eventPageCount = 24` = 实验侧 `12` × 2（`loadBars` / `feature(0)` / `observation(n)` 走 `access.events()` 会**再做一次完整分页**）。这不是新引入的缺陷（与 EXP-001 报告里同名的两个字段同源），但**两个口径必须分清、不得混用**。
- **Potential Baseline Drift**：
  - `BD-18`（**本任务新增，需裁定**）：🔴 **「泛化层新增能力」尚未进入作者面契约的强清单** —— 这是 `9ci` 登记的 `BD-13`（平台新增公开能力 → 规范 / 模板同步缺口，**已两次失手**）的**第三次变体**：本轮改了 `robustness/**` 的公开形状（维度不透明化 / 指标 `Record<string,number>` / `unavailable` 两态 / `RobustnessSubject`），但**规范里没有一节告诉作者「怎么用」**，目前只有 `research-experiments/first-board-pullback/stability-validation/README.md` 一份**实验级**说明。**建议裁定**：是否在 `EXPERIMENT-CODE-SPEC.md` 增一节「消费跨阶段 Robustness 的唯一入口与四条纪律」。
  - `BD-19`（**本任务新增，需裁定**）：⚠️ **`dimension.ts` 文件头曾有一句当时为假的自我声明**（「有静态守卫测试钉住」，而当时并不存在这样的测试）。本轮已改为指向真闸门（`公共机制 · 12`）并写明「先剔除注释再判」+「额外证明剔除有作用」。**登记理由**：本仓「**说明书比事实宽**」已反复出现（`9cj` 9 条作废判据 / `9ck` 措辞精度 / 本轮 1 条）—— **它不会被任何测试发现**，只能靠人工核对。**建议裁定**：要求「有测试钉住」类声明**必须同时给出测试文件与用例名**。
  - `BD-20`（**本任务新增，需裁定**）：`9ck` 登记的 `BD-12`（`docs/evidence/README.md` 缺 `9cg` / `9ch` 两轮索引节）**仍未清** —— 本轮只补登**自己这一轮**（`9cl` 节）并再次显式标注欠账，**未擅自代补**（记录优先于代改，与 `BD-10` 同原则）。
  - `BD-17`（**`9ck` 登记，本轮**不执行**）**：同一套漂移语义在仓内有两份实现（`overfittingDetection/parameterSensitivity.ts:159` / `:173`），且参数按轴 switch 散在 `paramSearchRouter.ts`。`9ck` 建议「**等 EXP-002 的抽象层定稿后再做**」—— 本届**抽象层现已定稿**（`comparison.ts#evaluateTolerance` 已被一次真实的跨阶段消费验证过），因此**回收时应当以本轮抽象层为准**；但回收本身需要改 `overfittingDetection/**` 与 `paramSearchRouter.ts` ⇒ **超出 §25 边界**，本轮**不执行**、仅登记。
  - `BD-15`（**`9ck` 登记）**：**本轮已实质处理** —— `EXPERIMENT-CODE-SPEC.md:559` 的过度禁止已澄清（见 `Changed Contracts`）。
  - `BD-10` / `BD-12` / `BD-14` / `BD-16`（`9ci` / `9cj` / `9ck` 登记，仍未裁定）：保持登记状态，本轮**未代补**。
  - ⚠️ **文档自洽性修正（非新技术债）**：`stability-validation/README.md` 两处数字与实际不符已修正 —— 泛化层单测「11 项」→ **12 项**（本轮新增了结构级闸门）、产物「4 个产物文件」→ **5 个**（3 CSV + 1 SVG + `robustness-run.json`）。**登记理由**：与 `BD-19` 同源（说明书写得比事实宽 / 窄），且这类错误**不会被任何测试发现**。
- **Regression Result**：`tsc --noEmit` = **exit 0（0 error）**；`pnpm run test:changed` = **2 failed / 24 passed（26 文件）**、`5 failed / 577 passed（582 例）` ⇒ **零新增失败文件**（失败项 = `tests/server/limitUp.watch.test.ts` 4 例 + `tests/server/limitUp.test.ts` 1 例，经 `docs/audit/reports/2026-09-09_AUDIT-002_FULL_SYSTEM_CODE_AUDIT_REPORT.md:63-64` 逐字核对，与基线**是同一批环境依赖失败**）；定向 `vitest` **6 文件 / 223 例全绿 / exit 0**（`multiDimension` 48 + `exp002StabilityValidation` 50 + `exp001FundamentalStudy` 76 + `runPersistence` 33 + `manifest.test` 9 + `legacyFreeProductionChain` 7，含旧 Research 依赖 Gate 7 例 PASS）；`node scripts/checkEolDrift.mjs` = 已跟踪漂移 **0** / 未跟踪新文件 CRLF **0**；**真实 E2E（真库 + 真 Dataset `390002` + 真 MinIO）29 步全 PASS**（Run `RUN-20260921-46934548`，`COMPLETED`/`SUCCEEDED`、`durationMs = 128475`）；**前端可达性探针（无头 Edge + CDP 量 DOM，走完整真实用户路径并真点一次「运行」）56 PASS / 0 FAIL**（新 Run `RUN-20260921-C95B1D47`）。🔴 **判据是「零新增失败文件」而不是「全绿」** —— 把「全绿」当判据会让已知环境失败长期掩盖真回归。
- **Evidence-Hygiene Note（非产品缺陷，但必须登记）**：🔴 **本轮登记「判据自身写错」11 条**（真机 E2E 首跑 7 条 —— 22 PASS / 7 FAIL；前端探针 2 条；闸门 / 文档 2 条），**0 条是产品缺陷**。E2E 七条：⒜ 按 `kind` / `id` / `version` 读核心记录身份（真实字段名是 `subjectKind` / `subjectId` / `subjectVersion` / `subjectRunId`）；⒝ 在实验 `customPayload` 里找 `eventScanPolicy`（它是**平台** `datasetFacts` 的字段）；⒞ 把 `unavailable` 下发的**标签**当**错误码**比对；⒟ 期望 `HORIZON_T5` 有 3 个比例指标值（它按定义不可用）；⒠ 把信封 `eligible` 与核心 `eligible` 当同一个；⒡ 按前缀猜 `RBM-…`（真实值是确定性派生的）；⒢ 期望清理后 `listRuns` 为空（实际有**刻意保留**的 2 条 Run）。前端两条：全局 `querySelectorAll('.recharts-surface')` 数到 **4** 个 —— 其中 **3 个是图例图标**（recharts 的图例图标也是 `Surface`，`es6/component/DefaultLegendContent.js:143`）；改用类名 `.recharts-legend-icon` 又得 **0** —— **recharts 不给图例 `Surface` 任何 `className`**⇒ 正解 = `closest('.recharts-legend-item') === null`。**共同病因**：「把**我当时看到的那一行 / 那一种写法**当成契约本身」，与 `9cj` 的 9 条、`9ck` 的 2 条**同源**。全部按项目纪律**登记「为什么错」**而非只把颜色刷绿 —— 一条恒假的判据挂在「已验证」清单里，等于在回归闸上挖洞（永远红被当噪声 / 被刷成永远绿而什么都没证明），**与产品缺陷同等级别**。🔴 其中**最有价值的一条**是「**负向结论也需要证据**」：`sensitive = 0` 有两种可能 ——「真的都不敏感」或「比较机制根本没跑」⇒ 必须用**非 0 的 39 行 delta**（`39 / 48`）把第二种可能性排除掉，否则「0 敏感」这个结论**无法与「全 0 空转」区分**。另：本轮实测到一条**「修法本身也可以是错的」**的样本 —— 容差线缺陷的第一次修法（`ifOverflow="extendDomain"`）让线**存在**了但 `y1 = -32.75`（画到绘图区外），深挖后确认 `extendDomain` **在本仓是空操作**（`DetectReferenceElementsDomain.js:23` 读 `el.props['yAxisId']`，而 React 元素不含 `defaultProps`）。**中间态证据全部留档**（`.prefix` / `.extendonly` / `.r4` 三份 `.out.json`），所以「错在哪里」可被第三方复核。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：无新增 / 删除 Domain；DB 零结构变化、零 migration；`shared/**` **本轮零改动**；无主链执行路径变化（Strategy / Parameter Search / Backtest / OOS / WFA 改动为 0）；`server/research/robustness/**` 的契约改动**向后兼容**（旧调用方形状不变、旧单测全绿）；新增的只是一个**注册在既有注册表里的 ExperimentDefinition** + 一个引桥模块 ⇒ 归入「只有实现细节变化」，按 `AGENT-GUIDE.md` §5 只更新 `CHANGE-AUDIT.md`。⚠️ 但 `BD-18` 指出「泛化层新增能力」的**作者面同步缺口**（`BD-13` 的第三次变体）属**流程级**欠账。
- **GLOBAL AUDIT REQUIRED**：**NONE**（本任务的改动面：无 Domain 增删、无 DB 结构变更、无主链语义变更、核心契约向后兼容）。⚠️ `BD-10`（`9cg` 的 Domain 删除从未触发全量审计）仍是**历史欠账**，不因本任务而消失。

## 2026-09-21 · 9cm（STRATEGY-RESEARCH-BRIDGE-001 · Independent Experiment → Strategy 正式桥接 + 首板回踩 Strategy 首条真实闭环）

- **Task**：用户投递 25 节规格「STRATEGY-RESEARCH-BRIDGE-001 — Independent Experiment → Strategy 正式桥接 + 首板回踩 Strategy 首条真实闭环」+「按这个执行下一步」。目标链路 = `Dataset Version 390002` →（`EXP-001` / `EXP-002` 真实 Run）→ Research Evidence → `first-board-pullback Strategy Version 1.0.0` → Parameter Search / Backtest，并要求「能回答『这个 Strategy 为什么这样定义』并沿 provenance 追到 Dataset Version」（§1）。§0 明令：不恢复旧 `Research → Analysis → Finding → Conclusion → Candidate → Strategy` 链、不建第二套 Research 系统、不新增独立 Strategy Core、优先复用；**不为了完成任务而强行自动推导交易规则**；全过程只保留**一个**最终报告。§24 列出明确不做项（EXP-003 / 新 Research Experiment / 新 Robustness Engine / 新 Parameter Search 算法 / 新 Backtest Engine / 新 OOS / Walk-Forward / Paper Trading / Production）。
- **Changed Domains**：**无新增 / 无删除 Domain**。改动全部落在**既有**体系内 —— ⒜ `Independent Experiment`（既有）：桥**扩展**（`createStrategyFromEvidenceRuns`）+ 新增 1 个草稿模块 + 1 个读运行模块 + 1 个 tRPC 路由；⒝ `Strategy`（既有三层：legacy 生产持久化 `server/research/strategySchema/**`、Strategy Core `server/strategyCore/**`、溯源 `strategy_research_provenance`）：**零结构改动**，只新增 1 条真实版本行 + 1 条溯源行；⒞ `Strategy Recipe / Condition Signal`（既有）：修 1 条**结构性缺陷**；⒟ `client/**`（既有）：新增 1 个证据区块组件 + 1 个适配函数。**`Research Core`（`9cg` 已整体删除）/ `tRPC 既有路由签名` / `DB schema` 结构 / `shared/**` 契约 零改动**。
- **Changed Files**：生产 10 个 —— 新增 6（`server/research/strategyCandidate/researchEvidence.ts` 约 470 行 / `server/researchExperiments/evidenceRunReader.ts` 115 行 / `server/researchExperiments/firstBoardPullbackStrategyDraft.ts` 约 470 行 / `server/researchExperiments/strategyBridgeRouter.ts` 245 行 / `client/src/components/research/StrategyResearchProvenancePanel.tsx` 约 205 行 / 适配函数在既有 `client/src/adapters/strategyCandidateAdapter.ts` 内）；扩展现有 1（`server/researchExperiments/strategyBridge.ts` 约 880 行）；**修缺陷 3**（`server/research/recipeRegistry.ts`：`gated` 定义新增可选 `gateProbeParameterCodes?` + `buildGatesProbe` 补探测 code；`server/research/conditionSignal/compile.ts`：`compileConditionRecipe` 收集并下传门槛实际引用的参数 code；`server/research/strategyCandidate/provenance.ts`：3 个**读**方法包 `withReadRetry`）。测试 4 新增 / 1 改动（`researchEvidence.test.ts` 23 / `firstBoardPullbackStrategy.test.ts` 14 / `strategyBridgeEvidence.test.ts` 12 / `provenanceReadRetry.test.ts` 6 新增；`compile.test.ts` +4 ⇒ 32）；证据 5 组（E2E `.mts` + `.out.json`/`.out.txt`、`_probe_srb001_doc_params.mts`、`_probe_srb001_strategy_detail_frontend.mjs`、`_probe_srb001_git_and_eol_state.py`、两个前置只读探针）+ 报告 `docs/strategy/STRATEGY-RESEARCH-BRIDGE-001-REPORT.md` + 四处台账。
- **Changed Contracts**：🔴 **有契约级改动，全部落在既有体系内部且全部向后兼容** —— ⒜ **Research Evidence 契约**（新）：`ResearchEvidence = { experimentCode, experimentVersion, runId, datasetVersionId, datasetVersionLabel?, evidenceKind, reference, description? }` + 服务端读回补齐的 `resultDigest/runStatus/startedAt/durationMs`；`RESEARCH_EVIDENCE_KINDS = ["RESULT_SUMMARY","STABILITY_VERDICT","SAMPLE_ACCOUNTING"]`（闭集）；快照键 `RESEARCH_EVIDENCE_SNAPSHOT_KEY = "researchEvidences"` / `RESEARCH_EVIDENCE_FINGERPRINT_KEY = "researchEvidenceFingerprint"`；错误码 `EXPERIMENT_STRATEGY_EVIDENCE_REFERENCE_UNRESOLVED` / `EXPERIMENT_STRATEGY_EVIDENCE_PROVENANCE_CONFLICT`。⒝ **策略版本可追溯身份**（既有语义的**扩展而非修改**）：`strategy_versions.fingerprint` **保持** = **策略文档**指纹（`819c1c50903498e7…`，**语义不变**），证据指纹**独立**存放于溯源行（`evi-sha256:f0959a03f21bd16a`）——**用户裁定「证据独立指纹」**，理由是方案 A（把证据指纹混进 `strategy_versions.fingerprint`）会破坏既有「文档未改 ⇒ 指纹不变」语义，而本仓多处消费方依赖该语义。⒞ **配方运行时契约**（向后兼容）：`gated` 支新增**可选**字段 `gateProbeParameterCodes?: readonly string[]`（不给 ⇒ `[]`，既有注册方零改动）。**`shared/**` 本轮零改动**（证据快照走既有 JSON 列，不建全局 schema）。
- **Changed DB**：**零 DDL / 零 DML 结构变更 / 零 migration / 零新表 / 零新列**（`drizzle/**` 零改动；migration 已用至 `0047`，**未增** `0048`）。**业务数据新增（非结构变更）**：`strategies` 1 行（`id 1110001` / `first-board-pullback` / `latestVersion 1.0.0` / `Draft`）、`strategy_versions` 1 行（`id 1110001` / `datasetVersionId 390002` / `datasetVersion v2`）、`strategy_research_provenance` 1 行（`id 630001` / `sourceKind INDEPENDENT_EXPERIMENT` / `experimentRef first-board-pullback/fundamental-study` / `experimentVersion 1.1.0` / `experimentResultDigest exp-sha256:63e77251a95bd41d` / `sourceDatasetVersionId 390002` / `sourceCandidateId` 与 `sourceConclusionId` **均为 NULL**（旧链列留空，未恢复旧链））。另：`parameter_search_run` / `_combination` / `_result` 各 1 / 44 / 0 行由验证探针**自清**（0 残留）。`9ck` 登记的 9 行孤儿数据**只登记、不清理**。
- **Changed Execution Path**：**主链新增一段「研究 → 策略」的正式桥**（`Dataset → Research Run → Research Evidence → StrategyVersion → {Parameter Search, Backtest}`），**但既有主链（Dataset → Strategy → Backtest）的既有环节零改动**（Strategy Core / Parameter Search / Backtest / OOS / WFA 既有语义改动为 0）。§15 关注的 legacy path（`loopRun useRealData → recipeRegistry → signalEngine`）**未被触发**：装配实测 `strategyDecisionEngine = "strategy-core"`、`recipeSource = strategy-declarative-conditions` ⇒ 按规格「**只有真正阻塞时才修**」**未修**。
- **Potential Baseline Drift**：
  - `BD-21`（**本任务新增，需裁定**）：`requireRecipe` 有三条路径（`document.recipe` → `compileConditionRecipe` → `DEFAULT_STRATEGY_RECIPE_ID`），**第三条是「文档既没声明 recipe、条件也编译不出时静默回落某个默认配方」**。本策略走第二条（未触发回落），但该路径**存在且静默** —— 若某策略把条件全部 `enabled: false`，它会**安静地换一份规则去回测**。**建议裁定**：是否要求「回落时必须留痕（日志 + 溯源字段）」。
  - `BD-22`（**本任务新增 → 已于 2026-09-21 同日关闭**）：🔴 **本仓 git 元数据受损**（非本任务引入）：`.git/refs` 与 `.git/packed-refs` **不存在** ⇒ `is_git_directory()` 失败 ⇒ 项目根目录任何 `git` 命令报 `fatal: not a git repository`；项目惯用的两道闸（`git status --porcelain` 前置、`node scripts/checkEolDrift.mjs` 行尾哨兵）**当时不可运行**。受损面实测：对象库剩 5792 对象 / 235 commit，存活最新 commit = `07fcbf494032`（2026-09-19 22:56），reflog 尖端 `a871b033…`（09-21 02:21/02:23 push）与 `ORIG_HEAD`（09-20 23:24）**不可解析**；`index` 1830 个唯一 blob 中 **241 个缺失**。👍 **但这 241 个路径在工作区全部还在** ⇒ **丢的是 git 元数据对象，工作区文件零丢失**。✅ **用户裁定「先备份，再最小修复」⇒ 已修复**：整份备份 `.git`（36 文件 / 13 973 963 B）→ **纯新增** `.git/refs`、`.git/refs/heads`、`.git/refs/tags` ⇒ git 立即重新识别仓库 → `git fetch origin`（**只写对象库 + `refs/remotes/origin/*`**；对象 5788 → **12088**；`origin/main` = `a871b033…` 拉回）→ 恢复 `refs/heads/main` = `a871b033…` → `rm .git/index && git read-tree HEAD` 重建索引。**结果**：`git fsck` **rc=0 零输出**、`git multi-pack-index verify` **rc=0**、`show-ref` 双 ref 齐备、`HEAD` = 「第一次自动研究」(2026-09-21 02:21:56)。🚫 全程**未**用 `reset --hard` / `checkout -f` / `clean`。🔴 **修复中还发现第二层损坏（为此条目实际价值所在）**：陈旧 `multi-pack-index`（09-19 22:56）与 09-20 20:50 被改写的 pack **不匹配** ⇒ `fsck` **rc=32** 报 `failed to load pack in position 0` + 26 条 `failed to load pack entry`，而 `verify-pack` 认为旧 pack **自身完整**；切分后定性 = 这 26 个 oid **既不在旧 idx 也不在新 idx**（真缺失、且**不被任何 ref 引用**），`core.multiPackIndex=false` 下 `fsck --connectivity-only` **rc=0 零输出** ⇒ **唯一缺陷就是那份陈旧 midx**，已备份后删除 + `git multi-pack-index write` 重建。
  - `BD-23`（**本任务新增 → 已于 2026-09-21 同日关闭**）：`git ls-files --eol` 实测 **329** 个文件为 `i/lf w/crlf`（`.ts` 209 / `.tsx` 70 / `.json` 18 / `.md` 10 / `.sql` 10 / `.mts` 5 / `.mjs` 2 / `.py` 1 / `.patch` 1 / `.yaml` 1 / 无扩展名 2），mtime 集中在 **2026-08-30（144）** 与 **2026-09-13（164）** ⇒ **长期状态，非本任务引入**。⚠️ 且因索引条目**携带畸形 stat**（记录 size = CRLF 尺寸、blob 为 LF 尺寸）而被 stat 缓存**长期遮蔽**，对 `git status` 呈现为「未修改」—— 属**潜伏地雷**（任何使 stat 失效的操作都会一次性炸出 329 个整文件 diff）。✅ **用户裁定「git 修好后一并转回纯 LF」⇒ 已归一化**：先 zip 备份（877 167 B）→ 逐文件校验「纯 CRLF」（`crlf 计数 == lf 计数` 且无孤立 CR）→ 原子替换 + 回读 → 复查 `i/lf w/crlf` **归零**（`i/lf w/lf` 1478 → **1807**），合计减少 **80 177** 字节。🔴 **零内容漂移硬证据**：`git diff --stat HEAD` 归一化前后**逐字相同** = `38 files changed, 3950 insertions(+), 433 deletions(-)（⚠️ 该 `38 / +3950 / −433` 是**归一化完成瞬间**的读数 —— 与归一化**之前**逐字相同，**这才是判据：EOL 归一化没有改变既有改动集**。此后本轮又追加了 `scripts/checkEolDrift.mjs` 注释修正与四处台账登记，而这些**都是被跟踪文件** ⇒ `diff --stat HEAD` 会自然变大；**当前快照一律以 `docs/evidence/_probe_srb001_git_repair_and_eol.out.json` 的 `D_diffStatHead_lastLine` 为准**。）`；`git status` 前后同为 **58**（38 ` M` + 20 `??`）；**0 个 `D` 条目** ⇒ 工作区零丢失。范围外**有意 CRLF 的 5 个** `i/crlf w/crlf` 不动：`.gitignore` / `client/src/App.tsx` / `client/src/components/AppShell.tsx` / `docs/evidence/_after_tsc_phaseA.out.txt` / `tests/server/marketSync.test.ts`。⚠️ 顺带修正 `scripts/checkEolDrift.mjs` 里**已失效的背景注释**（旧称「仅 3 个有意 CRLF」且列出已 untrack 的 `.workbuddy/memory/PROJECT_RULES.md`）并补一条「stat 判据 vs 内容判据」运维注记。
  - `BD-12`（`9ck` 登记）：`docs/evidence/README.md` 缺 `9cg` / `9ch` 两轮索引节，**仍未清** —— 本任务只补登**自己这一轮**（`9cm` 节）并再次显式标注欠账，**未擅自代补**（记录优先于代改）。
  - `BD-10` / `BD-14` / `BD-16` / `BD-18` / `BD-19` / `BD-20`：保持登记状态，本任务**未代补**。
- **Regression Result**：`tsc --noEmit` = **exit 0（0 error）**；定向 `vitest` = **28 文件 / 651 例全绿 / exit 0**（含 `researchEvidence` 23 + `firstBoardPullbackStrategy` 14 + `strategyBridgeEvidence` 12 + `compile` 32 + `provenanceReadRetry` 6 + `legacyFreeProductionChain` 7 + `runRepositoryRetry` 7 等）；🔴 **判据是「零新增失败文件」而不是「全绿」**（`9cl` 已登记的纪律）；**真机 E2E 43 步全 PASS**（真实 Dataset `390002` + 3 个真实 Run + 真实 tRPC 端点 + 真实装配）；**前端可达性探针 36 PASS / 0 FAIL × 2**（走完整真实用户路径：列表 → **点卡片** → **真实鼠标点「版本与状态」** → 等证据区块本体）；⛔ `node scripts/checkEolDrift.mjs` **不可运行**（`BD-22`），**替代判据**：① 基线 blob 双 diff **0 漂移**（457 文件参与）；② 本轮 **15 个**改动文件**逐个原始字节** = **15/15 纯 LF**；③ 全仓 `git ls-files --eol`：`i/lf w/lf` 1243 / `i/lf w/crlf` **329**（长期，非本轮）/ `i/crlf w/crlf` 2（约定项）。🔴 **替代判据比原脚本更严**（原脚本是启发式「改动量 ≥20 行且占比过半」，小文件可能漏判）。
- **Evidence-Hygiene Note（非产品缺陷，但必须登记）**：🔴 **本任务登记「判据自身写错 / 工具自身出错」6 条** —— **前端探针 5 条**（首跑 **25 条假 FAIL**，0 条是产品缺陷）：⒜ 按「打开」文字找入口（实际是**整块 `<button>`** 卡片）；⒝ 以为面板在默认标签（实际住在**「版本与状态」**标签内）；⒞ 🔴 **Radix Tabs 对 JS `.click()` 返回成功但内容不切换** ⇒ **假 PASS 来源**，必须用 CDP `Input.dispatchMouseEvent` 发**真实鼠标事件**；⒟ 点标签时机太早（页面还在「加载版本…」）；⒟ 等待条件只等**同步 prop**（卡片标题）⇒ 改为等**证据区块本体**。🔴 **最危险的一条是行尾粗判据**：初版按「已跟踪文件应为 LF」判，报出 **333** 个「不应为 CRLF」，其中含自 **2026-08-30** 起就在磁盘上是 CRLF 的文件（mtime 实证）—— 若不复核，会得出「**本轮引入 329 处漂移**」的**假结论**；修正为「**基线 blob ↔ 工作区**」比对后才成立。另 3 条工具/脚本问题：新增测试文件首次运行 **0 test**（相对路径少一级：`tests/server/research/strategyCandidate/` 比 004 的目录深一级，应 `../../../../`）⇒ 已修 6/6 绿；E2E 首次查 `dataset_version` 报 `Unknown column 'versionlabel'`（真列名是 `version`）⇒ 改 `version AS versionLabel`；E2E 未捕获异常只吐裸堆栈 ⇒ 补 `process.on` 兜底落盘。🔴 两条**最有价值的**登记：「**Radix 假 PASS**」（点了但没切，判据看起来绿了什么都没验证）与「**行尾粗判据差点把长期状态记成本轮漂移**」—— 两者都属「**判据自身写错 = 与产品缺陷同级**」。**共同病因**：「把**我当时看到的那一行 / 那一种写法**当成契约本身」，与 `9ci` 15 条 / `9cj` 9 条 / `9ck` 2 条 / `9cl` 11 条**同源**。另：两条缺陷的回归**都做了注入式可证伪验证**（缺陷 #1 改 `probe[name]=0` → `void name` ⇒ **3 条变红**；缺陷 #2 摘掉一个读方法的 `withReadRetry` ⇒ **恰好 2 条变红**、另两条仍绿）⇒ **判据本身可证伪**，不是「改完就变绿」。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：无新增 / 删除 Domain；DB 零结构变化、零 migration；`shared/**` **本轮零改动**；既有主链语义零改动（Strategy Core / Parameter Search / Backtest / OOS / WFA 改动为 0）；新增的只是一个**注册在既有注册表里的 ExperimentDefinition 消费者**（桥扩展）+ 一条真实策略版本行 + 一条溯源行 + 一个前端区块 ⇒ 归入「只有实现细节变化」，按 `AGENT-GUIDE.md` §5 只更新 `CHANGE-AUDIT.md`。⚠️ 但 `BD-22` 指出 **项目惯用的两道 git 闸当前不可运行**，属**环境级**欠账（非本任务引入）。
- **GLOBAL AUDIT REQUIRED**：**NONE**（本任务的改动面：无 Domain 增删、无 DB 结构变更、无既有主链语义变更、契约改动全部向后兼容）。⚠️ `BD-10`（`9cg` 的 Domain 删除从未触发全量审计）仍是**历史欠账**，不因本任务而消失。

## 2026-09-21 · `9cm` 收尾（git 元数据修复 + 329 文件 EOL 归一化）

- **Task**：`9cm`（STRATEGY-RESEARCH-BRIDGE-001）交付后**同日**，用户裁定「先备份，再最小修复」+「git 修好后一并转回纯 LF」⇒ 修复本仓 git 元数据、并把 329 个长期 CRLF 文件归一化为 LF。**非新编号**（属 `9cm` 收尾）。
- **Changed Domains**：`ENV`（`.git/**` 元数据修复 —— **不在仓库工作区文件集合内**）/ `docs`（`docs/evidence/README.md`）/ `scripts`（`scripts/checkEolDrift.mjs`，**仅注释**）；`server` / `client` / `shared` —— **零语义改动**。
- **Changed Files**：`.git/refs{,/heads,/tags}`（**纯新增空目录**）、`.git/index`（重建）、`.git/objects/pack/**`（fetch 新增 1 pack + midx 重建）、`scripts/checkEolDrift.mjs`（注释）、`docs/evidence/README.md`、`docs/evidence/_probe_srb001_git_repair_and_eol.py`（新增）+ `.out.json`（新增）、`ROADMAP.md`、`ROADMAP-CHANGELOG.md`、`.workbuddy/memory/{MEMORY.md,2026-09-21.md}`（本地、已 untrack）。
- **Changed Contracts**：**无**。零 `shared/**` 改动、零 API 改动、零类型契约改动。
- **Changed DB**：**无**。零 migration（仍至 `0047`）。
- **Changed Execution Path**：**无**。未触碰 `server/**` 生产逻辑，故**不触发热重启纪律**。
- **Potential Baseline Drift**：
  - `BD-22`（git 元数据受损）**已关闭**；`BD-23`（329 个 CRLF 长期状态）**已关闭**。
  - `BD-24`（**本次新增，需裁定**）：⚠️ **索引可能携带畸形 stat**（记录 size = 旧 CRLF 尺寸，而 blob 为 LF 尺寸）⇒ 会同时**遮蔽**真实漂移（对 `git status` 呈现为「未修改」）并**伪造**修改（归一化后一次报 329 个 ` M`）。**`git reset --mixed HEAD` 无效**（按 oid 复用畸形 stat）。判据分叉时以 `git hash-object` / `git diff --numstat` 为准；修法 = `cp .git/index <备份> && rm .git/index && git read-tree HEAD`。**建议裁定**：是否把该修法写入 `AGENT-GUIDE.md` 的「基础设施坑」。
  - `BD-12`（`docs/evidence/README.md` 缺 `9cg` / `9ch` 两轮索引节）**仍未清** —— 本次只补登 `9cm` 收尾自己的证据，**未擅自代补**（记录优先于代改）。
  - `BD-21` / `BD-10` / `BD-14` / `BD-16` / `BD-18` / `BD-19` / `BD-20`：保持登记状态，本次**未代补**。
- **Regression Result**：**不适用传统回归**（零生产代码改动）⇒ 以**仓库自洽性**为准：`git fsck`（full）**rc=0 且零输出**；`git multi-pack-index verify` **rc=0**；`git diff --stat HEAD` = `38 files changed, 3950 insertions(+), 433 deletions(-)（⚠️ 该 `38 / +3950 / −433` 是**归一化完成瞬间**的读数 —— 与归一化**之前**逐字相同，**这才是判据：EOL 归一化没有改变既有改动集**。此后本轮又追加了 `scripts/checkEolDrift.mjs` 注释修正与四处台账登记，而这些**都是被跟踪文件** ⇒ `diff --stat HEAD` 会自然变大；**当前快照一律以 `docs/evidence/_probe_srb001_git_repair_and_eol.out.json` 的 `D_diffStatHead_lastLine` 为准**。）`（**与归一化前逐字相同**）；`git status --porcelain -uall` = **58**（38 ` M` + 20 `??`，**0 个 `D`**）；`git ls-files --eol` = `i/lf w/lf` **1807** / `i/crlf w/crlf` **5**（有意）/ `i/none` 15 / `i/-text` 10 / `i/mixed` 2，**`i/lf w/crlf` = 0**；`node scripts/checkEolDrift.mjs` **rc=0（0 漂移 / 0 新 CRLF）**—— 该闸**由不可运行恢复为可运行**。
- **Evidence-Hygiene Note**：🔴 本次踩到并登记「**stat 判据 vs 内容判据分叉**」—— 归一化后 `git status` 假报 **387**（+329）而 `git diff --numstat` 仍 **38**，一度可能被误判为「归一化引入 329 处改动」。**定案手段**：三方哈希（`git hash-object` = `git rev-parse :path` = `git rev-parse HEAD:path`）+ `git diff --quiet`（rc=0）+ `git ls-files --debug`（畸形 `size: 345`）。⚠️ 另修正 `scripts/checkEolDrift.mjs` 的**失效背景注释**（「仅 3 个有意 CRLF」→ 实测 **5** 个），其**判据逻辑未变**（只用内容口径的 `git diff --numstat`）。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：零 Domain 增删、零契约改动、零 DB 改动、零生产执行路径改动；仓库工作区**文件内容零变化**（`git diff --stat HEAD` 前后逐字相同）。⛔ 唯一环境级变化 = `.git/**` 元数据由「受损」恢复为「健康」，以及工作区行尾由「329 处 CRLF」恢复为「纯 LF」—— 两者均属**环境 / 卫生**而非**产品基线**。
- **GLOBAL AUDIT REQUIRED**：**NONE**。
⚠️ **「改 `server/**`」纪律的合规复核（本轮补做，如实登记，含流程瑕疵）**：EOL 归一化的 329 个文件里含 **20 个 `server/**`**（`server/_core/*` 16 个 + `server/recognition.ts` / `stockPriceSync.ts` / `storage.ts` / `tushare.ts`）、**5 个 `shared/**`**、**167 个 `tests/**`**、**85 个 `client/**`**、24 个 `drizzle/**` ⇒ 落在「三门」第一条的触发范围内。复核结论：
① 🔴 **逐字节等同于 HEAD（零语义变化）**：`git diff --stat HEAD -- server/_core server/recognition.ts server/stockPriceSync.ts server/storage.ts server/tushare.ts` **输出为空**；5 个 `shared/**` 同为空；`tests/**` 只剩 **3 个** 9cm 自有改动文件（`compile.test.ts` / `exp001FundamentalStudy.test.ts` / `runPersistence.test.ts`）⇒ 其余 164 个归一化测试文件同样零 diff。且这 20 个 `server/**` 文件**均不出现在** `git status` 的 ` M` 列表里（列表里全是 9cm 自有改动）。
② ✅ **在途 Run 检查**：`docs/evidence/_probe_inflight_runs.mts` 全表扫描 ⇒ `RUNNING = 0`；唯一命中 `archive_research_question:270001`，时间戳停在 **2026-09-17T06:50:58**（已登记的历史僵死行，且属**已退役**的 `archive_*` 表）⇒ **0 个真实在途 Run**，归一化未打断任何真实进度。
③ ✅ **未主动杀 / 重启 dev server**：`pnpm run dev`（PID 10556）与 `tsx watch server/_core/index.ts`（PID 600）**存活**；因内容逐字节未变，watcher 的自动 reload（若被 mtime 触发）在语义上是 **no-op**，而纪律明确要求「常驻服务别杀」。
⚠️ **流程瑕疵（诚实登记）**：`tsx watch` 是**按 mtime** 触发 reload 的 ⇒ **即使内容未变，批量重写已跟踪源文件也会让 dev server 重载**。正确顺序是**动手前**先跑在途 Run 检查（本轮做在**事后**，属流程瑕疵；结论仍是安全的，因为 `RUNNING` 真实值为 0）。⇒ 已升级为纪律：**任何批量重写已跟踪源文件（哪怕只改行尾）前，先跑 `_probe_inflight_runs.mts`**。
## 2026-09-21 · `9cm` 收尾②（`BD-21` 闭环 + Parameter Search 首次实际研究运行）

- **Task**：`9cm`（STRATEGY-RESEARCH-BRIDGE-001）交付后的**唯一**收尾项 `BD-21`（用户规格 §一），按 §二「只修真正阻塞 Parameter Search 实际运行的问题」、§十二「不要为了理论上的完整性阻止实际研究继续向前」执行，完成后**直接进入** Parameter Search 实际运行。**非新编号**（属 `9cm` 收尾；编号仍 `9cm` ⇒ 下一个未占用仍为 `9cn`）。⛔ 未新建 `STRATEGY-BRIDGE-CLOSEOUT-001` / `PARAMETER-AUDIT-xxx` / `ROBUSTNESS-AUDIT-xxx` / `OOS-AUDIT-xxx` / `WFA-AUDIT-xxx`。
- **Changed Domains**：**无新增 / 无删除 Domain**。改动全部落在**既有**体系内 —— `Strategy`（既有）：装配层的**来源枚举**多一个诚实值 + 回落点留痕；`Shared Contracts`（既有）：zod 闭集同步；`Client`（既有）：闭环结果面板多一条中文提示；`docs` / `tests`（既有）。**未触碰** Strategy Core / Parameter Search / Backtest / Robustness / OOS / WFA 任何模块。
- **Changed Files**：生产 **4** —— `server/runWorkbenchAssembly/assemble.ts`（52948 → 55257 B，4 处：类型第 4 值 + 详细注释、路径 3 默认常量分支改为 `default-fallback` + `console.warn`、`LoopRunAssemblySummary.recipeSource` 注释改「**四条**诚实路径」、函数头三路径清单拆为 `3.` / `3'.`）；`shared/researchContracts.ts`（54124 → 54564 B，1 处：`recipeSource` 的 zod 闭集加 `"default-fallback"` + 「与本闭集必须逐字一致」注释）；`server/research/recipeRegistry.ts`（22793 → 23037 B，1 处：`DEFAULT_STRATEGY_RECIPE_ID` 上方注释改为 `assembly.recipeSource = "default-fallback"`）；`client/src/components/strategy/ClosedLoopRunResultPanel.tsx`（38485 → 39076 B，1 处：兜底显示琥珀色中文提示）。**文档 5** —— `docs/research/STEP-A-DECLARATIVE-CONDITIONS-implementation.md`（三路径表拆为 `3.` + `3'.`）、`docs/strategy/STRATEGY-RESEARCH-BRIDGE-001-REPORT.md`（追加 §26：61183 → 75036 B）、`ROADMAP.md`、`ROADMAP-CHANGELOG.md`、`docs/evidence/README.md`。**测试 1 新增** —— `tests/server/runWorkbenchAssembly/recipeFallback.test.ts`。**证据 3 组新增** —— `docs/evidence/_probe_bd21_recipe_fallback_real_db.mts` → `.out.json` / `.out.txt`；`docs/evidence/_probe_ps001_first_round.mts` → `.out.json` / `.out.txt`；同脚本 `PS001_SCALE=expand` → `_probe_ps001_expanded.out.json` / `.out.txt`。**一次性脚本（不进仓库）** —— `C:/work/sourcecode/_scratch/{bd21_patch.py,bd21_falsify.py,srb001_closeout_report.py}`。
- **Changed Contracts**：🔴 **有 1 处契约级改动，向后兼容** —— `closedLoopRunResultSchema.shape.assembly.shape.recipeSource` 的 zod 闭集由 3 值扩为 **4 值**（新增 `"default-fallback"`），与 `assemble.ts#RecipeResolutionSource` **逐字一致**。**方向 = 收窄而非放宽语义**：原先「兜底」与「显式指定」共用一个值，现在**不可再混同** ⇒ 消费方若按 3 值穷举会**编译期/运行期发现**（而非静默吃错值）。**⚠️ 不同步的后果已实测**：只改 `assemble.ts` 不改 zod 闭集 ⇒ tRPC `.output()` 对兜底 Run **拒值**。
- **Changed DB**：**零 DDL / 零结构变更 / 零 migration / 零新表 / 零新列**（`drizzle/**` 零改动；migration 仍至 `0047`，**未增** `0048`）。**业务数据新增（非结构变更）**：本轮 Parameter Search **真实运行**在既有 3 张表落库 —— 两个被引用的 Search Run 各自落 `parameter_search_run` **1** 行 / `parameter_search_combination` **4** + **9** 行 / `parameter_search_result` **4** + **9** 行（探针已**独立核对** `parameter_search_result` 行数 == 组合数：9 / 4）；⚠️ 诚实说明：本轮 smoke 轮的 4 个组合**全部命中缓存**、复用自同日的两个更早探索 Run（`PSRUN-20260921-1d827dcc` / `PSRUN-20260921-57664c41`），故 **DB 中本日 `parameter_search_*` 的总行数多于上述 13 行**；本轮**未**清库（默认保留 Search Run —— 它是**真实研究产物**，用户要能在页面上看到结果）。
- **Changed Execution Path**：**主链语义零改动**，只**新增一段诚实标注**：`requireRecipe` 的兜底分支此前借 `explicit-request` 之名，现在独立为 `default-fallback` 并在该**唯一判定点**打一行 warn。⇒ 运行结果**逐字节不变**（同一份默认配方、同一套参数），**改变的是「能不能看出发生过兜底」**，不是「跑什么」。
- **Potential Baseline Drift**：
  - `BD-21`（`9cm` 登记 → **本轮关闭**）：`requireRecipe` 静默回落默认配方 → **已修**（第 4 来源值 + 留痕 + zod 闭集 + 前端提示 + 单测 + 注入式可证伪 + 真库体检 5/5）。
  - `BD-12`（`9ck` 登记）：`docs/evidence/README.md` 缺 `9cg` / `9ch` 两轮索引节，**仍未清** —— 本轮只补登**自己这一轮**（`9cm` 收尾②节），**未擅自代补**（记录优先于代改）。
  - `BD-10` / `BD-14` / `BD-16` / `BD-18` / `BD-19` / `BD-20`：保持登记状态，本轮**未代补**。
  - **新登记（非阻塞，本轮只记录）**：数值型 `ENUM` 搜索域**不被支持** —— `{mode:"ENUM", values:[…]}` 被 `PARAMETER_SEARCH_DOMAIN_UNCOMPILABLE` **响亮拒绝**并提示改用 `INTEGER_RANGE` / `DECIMAL_RANGE`。**这是正确行为（响亮失败而非静默降级），非缺陷**；影响 = **非等步长**的候选值集合无法直接表达（只能靠等步长区间近似）。
  - **新登记（文档漂移，已就地修正）**：`docs/evidence/_probe_ps001_first_round.mts` 文件头 docstring 的 `expand` 网格写成 `{0, 0.02, 0.05} × {0.5, 1, 2}`，而实际常量是 `{0, 0.05, 0.1} × {0.5, 1, 1.5}` ⇒ 若照文档复跑会**得到与已落盘证据不同的网格**。已按实测改写 docstring（**改行为必须同时改契约**）；`.out.json` 证据**未改**（它记录的是真实跑过的东西）。
- **Regression Result**：`pnpm exec tsc --noEmit` = **exit 0（0 error）**；定向 `vitest run tests/server/runWorkBenchAssembly tests/server/closedLoopBacktestRun/summary.test.ts tests/server/research/conditionSignal/compile.test.ts tests/server/research/strategyPersistence tests/client/src/adapters/strategyAdapter.test.ts` = **9 文件 / 167 例全绿 / exit 0**；`pnpm run test:changed` = **2 失败文件 / 5 例**，**全部落在基线 7 文件之内**（`tests/server/limitUp.test.ts` 1 + `tests/server/limitUp.watch.test.ts` 4，环境依赖）⇒ **零新增失败文件**（判据是「零新增失败文件」，不是「全绿」）；🔴 **注入式可证伪**：把兜底改回 `explicit-request` ⇒ **恰好 2 条变红（A / C）**，B / D 仍绿，随后按原始字节还原；真库只读体检 **5 / 5 PASS**；Parameter Search 两轮 **11 / 11 PASS × 2**。
- **Evidence-Hygiene Note**：🔴 本轮登记「**判据自身写错**」**3 条** —— **全部是我自己的探针判据，0 条是产品缺陷**：⒜ 步骤 0 的断言写成「`datasetVersionId === 390002` **或** 为 `undefined` / `null`」，后半**恒真** ⇒ 把「坐标能否从文档派生」整个跳过，而 `createSearch` 又**显式传了**该值 ⇒ **派生路径从未被走过**（已拆成 `0a` 版本身份 + `0b` `resolvePrimaryDatasetVersionId(document) === 390002`）；⒝ `describeSensitivity` 的**桶内聚合**会把**其他参数**的差异挂到本参数名下（读者必然误读）⇒ 改为**边际效应（配对比较）**，并加 `evidenceForInsensitive.notVacuous`；⒞ `evaluatedCount + reusedFromCacheCount === 组合数` 把两者当**互斥**，真实语义是 **`reused ⊆ evaluated`**（缓存复用**也是一次评估**）⇒ expand 轮被**误判 FAIL**（已改为 `completed + failed === 组合数 && evaluated === 组合数 && reused <= evaluated`）。三条**均已在探针内标注「为什么错」并修正**，不是只把颜色刷绿。⚠️ 另修正 **1 条文档漂移**（见上「新登记」）。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：无 Domain 增删；DB 零结构变化、零 migration；`shared/**` **仅 1 处向后兼容的枚举扩值**（不改任何既有取值语义，只把两个原本混同的含义**拆开**）；既有主链语义零改动（Strategy Core / Parameter Search / Backtest / OOS / WFA 改动为 0）；新增的只是一个**诚实来源值** + 一行 warn + 一条前端提示 + 一份收尾报告 §26 ⇒ 归入「只有实现细节变化」，按 `AGENT-GUIDE.md` §5 只更新 `CHANGE-AUDIT.md` / `ROADMAP*.md` / 记忆，**不触发**基线升版与全量再审计。
- **GLOBAL AUDIT REQUIRED**：**NONE**。⚠️ 两处**诚实提醒**：① `BD-10`（`9cg` 的 Domain 删除从未触发全量审计）仍是**历史欠账**，不因本轮而消失；② `docs/evidence/README.md` 与本文件各自承载的 `9cm` 收尾章节**末尾共用同一段「合规复核」文本**（历史写法，本轮**未改动**；若日后整理，两处应合并为一处 + 一处指针）。
- **Evidence-Hygiene Note（台账写入工具，本轮追加）**：本轮台账落盘脚本 `_scratch/srb001_closeout_ledger.py` 自踩 **4 条判据/工具缺陷**（**全部是文档工具，0 条产品缺陷**），已各自修正并登记「**为什么错**」：⒜ 分段器拿 `@@@NAME@@@` 当占位符 ⇒ 「归档旧 §44」的占位符被**当成分隔名吃掉**（`body.count(...)==0` 当场假红）⇒ 改用不冲突占位符；⒝ CHANGELOG 的「上轮实查」计数**写死 55**，而新节的归档小标题**自己就含这四个字** ⇒ 当场假红（实测 56）⇒ 改为**派生式增量断言**（`== before + 2`）；⒞ `PROJECT_RULES.md` **本体是 CRLF（1186 处）**，按 LF 追加 ⇒ **混合行尾**，被「全文不得含 CRLF」断言拦下 ⇒ 改为**按原文件 EOL 追加** + 「整份内容逐字等于预期」的最强校验；⒟ 「逐字留档」的体量断言拿**字符数**比**字节阈值**（`len(v2) > 15000`）⇒ 假红 ⇒ 改为 `len(v2.encode())`。⇒ 两条纪律已写入 `MEMORY.md`：**「改/追加已有文件前先看它的 EOL」**、**「判据要派生、别写死数字」**；并新增 `MEMORY.md` 超限处理范式 = **「原文下移」**（本次 #4，含原文 A/B/C 三段逐字留档）。

## 2026-09-21 · `9cn` · `BD-24`（长算后留档写库撞死连接 ⇒「回测历史」恒缺一条）

- **Task**：用户报障「刚才我跑了一下first-board-pullback，在回测历史中没有看到」⇒ 定位 + 最小修复 + **修前 / 修后各真跑一次**对照验证。编号 `9cn`（`BD-24`）。
- **Changed Domains**：**无新增 / 无删除**。改动全部落在既有体系内 —— `Persistence`（既有：连接池阈值 + 留档写路径重试）、`tests` / `docs` / 记忆（既有）。**未触碰** Strategy Core / Parameter Search / Backtest / Robustness / OOS / WFA / Client。
- **Changed Files**：生产 **2** —— `server/db.ts`（`resolveIdleTimeoutMs` 默认 600_000 → 180_000 + 新增导出常量 `MEASURED_DB_IDLE_WINDOW_LOWER_BOUND_MS` + `resolveKeepAliveInitialDelayMs` 语义注释改为「默认 0 是刻意的，别改成有限值」+ **写明 `idleTimeout` 的能力边界**）、`server/researchRunRouter.ts`（留档重试 3 → 6、仅瞬时错误重试、`persistClosedLoopBacktestRun` 导出 + 依赖注入、注释里登记被证伪的错误修法与「重试是承重项」的实测结论）。测试 **2 新增** —— `tests/server/dbPoolConfig.test.ts`、`tests/server/closedLoopBacktestRun/persistRetry.test.ts`。证据 **4 组** —— `_probe_db_keepalive_ab.mts`（A/B）→ `.out.json/.out.txt/.stdout.txt`；`_probe_fbp_looprun_repro2.prefix-BD24.out.{json,txt}`（修前）；`_probe_fbp_looprun_repro2.keepalive-trial.out.txt`（保活试跑崩溃）；`_probe_fbp_looprun_repro2.out.{json,txt}`（修后）。文档 **4** —— `docs/evidence/README.md` / 本文件 / `ROADMAP.md` / `ROADMAP-CHANGELOG.md`；记忆 **2** —— `.workbuddy/memory/MEMORY.md`（超限 ⇒ 原文下移 #5）、当日日报。**一次性脚本** —— `C:/work/sourcecode/_scratch/bd24_ledger.py`。
- **Changed Contracts**：**无**（`shared/**` 零改动、tRPC 端点签名与 zod 闭集零改动）。⚠️ 唯一对外可观察的语义变化 = `resolveIdleTimeoutMs()` 的**默认值**（600s → 180s）⇒ 交互式页面空闲超 3 分钟后下一次查询多一次跨境握手（1.3~3.0s），**这是刻意的取舍**（宁多等一次握手，不接受长算后静默丢一条留档）。
- **Changed DB**：**零 DDL / 零迁移 / 零新表**（migration 仍至 `0047`）。业务数据：本轮两次真跑中，修前失败 ⇒ 0 行；修后成功 ⇒ **+1 行**（`runId = clrun-20260921121418150`，属**真实研究产物**，**未清理**；该表由 8 行 → 9 行）。
- **Changed Execution Path**：主链语义零改动。变化只在「失败面」：⒜ 空闲连接在**被链路掐断之前**被池回收（**但只覆盖「一直待在自由队列里」的那一类**，见下）；⒝ 留档失败时重试预算由 3 提到 6，且**非瞬时错误不再重试**（更快失败、更快死信）。回测结果本身逐字节不变（修前 / 修后同输入同 `runId` 形态、同 14 阶段状态）。
- **Potential Baseline Drift**：
  - **新登记 `BD-24`（本轮已修，但有残余）**：长算（> 对端空闲窗口）后写库撞死连接 ⇒ best-effort 留档静默丢条。**残余 = 能力边界**：mysql2 的回收器只处理自由队列、且只看 `release()` 时刷新的 `lastActiveTime` ⇒ 「借出跨越掐断窗口、之后才还回池」的连接**永远不会被它回收**；实测修后写库边界**仍有 1 条**死连接（第 1 次尝试白等 19.28 s）⇒ 承重项是重试预算，见下条。
  - **新登记（未修，非阻塞）· 结构级**：长算期间**不该跨窗持有连接**（或改为「写库前才借连接」）—— 这才是把陈旧连接清零的办法。本轮**未做**（会动到数据加载编排，属独立任务）。
  - **新登记（未修，非阻塞）· 前端可见性**：留档失败**只进服务端日志**，用户侧完全不可见（`/backtest-runs` 少一条、页面无任何提示）。本轮**未**动 `shared/**` / `client/**`，登记为后续项。
  - **新登记（环境级，未修）· 已证伪的路**：`enableKeepAlive: true` + `keepAliveInitialDelay: 0` 的组合让保活**形同未开**；而把它改成有限值会引入 `EPIPE` 二次 `emit('error')` ⇒ **进程退出**（mysql2 只用 `once('error')`）⇒ 维持现状 + 就地写红线，并把 `DB_KEEPALIVE_INITIAL_DELAY_MS=30000` 保留为**可复现的实验开关**。
  - **新登记（待验证假设，🔴 不得当结论）**：若保活设有限值 **且** 用 `pool.on('connection')` 给每条连接补一个 `error` 兜底（防 `once('error')` 的 unhandled ⇒ 不崩进程），则可把半开失败的 **19.28 s/次** 降到 **~0ms/次**，重试循环随之变快。**本轮未做 A/B ⇒ 只是待验证假设**（写进 `db.ts` 注释会误导后人，故只登记在这里与 `ROADMAP`）。
  - `BD-12` / `BD-10` / `BD-14` / `BD-16` / `BD-18` / `BD-19` / `BD-20`：保持登记状态，本轮**未代补**。
- **Regression Result**：`tsc --noEmit` = **exit 0（0 error）**；定向 `vitest run tests/server/dbPoolConfig.test.ts tests/server/closedLoopBacktestRun/` = **4 文件 / 23 例全绿 / exit 0**；`node scripts/checkEolDrift.mjs` = **0 漂移**。🔴 **可证伪性**：把 `resolveIdleTimeoutMs()` 默认改回 `600_000` ⇒ `dbPoolConfig.test.ts` **立刻变红**（判据 = 默认值必须严格小于实测窗口下界 240s）；`persistRetry.test.ts` 的 C1 用例在「重试次数改回 3」时变红（真实失败序列 = 3 连 `ECONNRESET` 后第 4 次成功）。**修前 / 修后各真跑一次**（同一探针、同一入参）：`fbpRows` **0 → 1**；时长 **588881 ms → 571761 ms**。⚠️ **未跑全量 `vitest`**（日常禁跑全量；本轮判据是**零新增失败文件**，改动面只涉及 2 个生产文件且都不在既有失败文件名单内）。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：无 Domain 增删；零 migration；`shared/**` 与 `client/**` 零改动；主链语义零改动（只改「空闲连接何时被回收」与「失败时重试几次」这两个**运维/韧性参数**）⇒ 归入「只有实现细节变化」，按 `AGENT-GUIDE.md §5` 只更新本文件 / `ROADMAP*.md` / 记忆。
- **GLOBAL AUDIT REQUIRED**：**NONE**。
- **Evidence-Hygiene Note**：🔴 本轮登记「**我自己的判据 / 脚本 / 注释写错**」**5 条（0 条产品缺陷）**：⒜ `persistRetry.test.ts` 的 C1 首次断言写「`warn` 只被调用 **1** 次」，而生产实现会为**每次失败**各打一条重试告警 + 一条成功告警 ⇒ 实测 **4** 次（**判据写死了一个错误的前提**，已改为断言 4 次并说明构成）；⒝ 自建的 A/B 探针把「同组各观察点」写成**串行等待**，导致 B 组的观察点被推迟到 t≈501~506s（比设计值多空转 ~21s）⇒ 结论仍成立（更长空闲只会更失败），但**观察点与设计不符**，已在探针注释与文档中如实标注；⒞ 编辑 `server/db.ts` 的同一段注释时**漏删旧函数体** ⇒ 出现**同名函数定义两次**（`tsc` 会挂）—— 由随后的类型闸当场拦下并修正 ⇒ 再次印证纪律「**同一文件多处编辑必须串行、改完必须回读复核**」；⒟ 🔴 **注释里的因果写反了**：先写成「`idleTimeout` 是防线、重试是兜底」，而修后真跑证明**恰好相反**（`idleTimeout` 清不到 0，第 1 次尝试仍失败）⇒ 已按实测把 `db.ts` / `researchRunRouter.ts` 的注释、以及 `ROADMAP` / `ROADMAP-CHANGELOG` / 本文件 / evidence README 的叙述**全部改写**，并把「能力边界」连同源码行号一并写进注释。；⒠ 🔴 **台账落盘脚本把 §44 的条目按「单行」替换了，而那条目实际是 19 行的多行 blockquote**（1 行摘要 + ①~⑥ 明细）⇒ §44 出现「`9cn` 抬头 + `9cm` 六段明细」的**杂交条目**，且旧明细**既没被归档也没被覆盖**。已从 `git show HEAD:ROADMAP.md` 取回**完整 19 行块**修好（一次性脚本 `_scratch/bd24_fix_s44.py`，带 6 条不变量断言：块长 19 / 首末行内容 / 孤儿标记为 0 / 另三处台账仍在位 / 修完必更短），并把该坑写进 skill `stock-limit-up-silent-persist-drop §9`。⚠️ 附带一条**假通过**教训：第一版孤儿检查拿 `第一轮 smoke` 当判据，而它在 ROADMAP 里**另有 3 处合法出现** ⇒ 断言必须用**唯一**标记。另记：`docs/evidence/` 在 `.gitignore` 里（`README.md` 等 281 个文件是**已跟踪**的历史文件）⇒ 本轮新增的 `_probe_*.mts` 与 `.out.*` 属**未跟踪**，若要进 git 需 `git add -f`（本轮**未**提交）。


## 2026-09-21 · 文档清理（分支 `cleanup/docs`，无任务编号：纯文档整理）

- **Task**：用户指令「清理项目 md 文档 + 建 `docs/INDEX.md` 作为唯一入口」，判据 = 权威保留 / 同口径重跑合并 / 重复留一份 / 过期归档 / 孤儿删除 / 生成物归 `docs/generated/`。**未触碰任何产品代码**。
- **Changed Domains**：`docs`（文档坐标与索引）。**无** Domain 增删；`server/**` / `client/**` / `shared/**` / `drizzle/**` / `tests/**` **零改动**（断言：`git status` 越界集为空）。
- **Changed Files**：**移动 20**（`git mv`，全部 R100 —— 暂存 blob 与原 blob 为同一 git 对象 ⇒ **内容零改写**）：15 份 `docs/` 根 + `docs/audit/reports/` 1 + `docs/research/` 2 + `docs/researchDataset/` 1 + `docs/step-dataset-002/` 1。**新增 3**：`docs/INDEX.md`、`docs/archive/README.md`、`docs/quantRoadmap/README.md`。**删除 0**。`docs/step-dataset-002/` 目录清空后 rmdir。
- **Changed Contracts**：**无**。
- **Changed DB**：**零**（未连库、未写库、无 DDL、migration 仍至 `0047`）。
- **Changed Execution Path**：**无**。本轮不改变任何运行时行为（仅 md 文件位移）。
- **裁量记录（可复核）**：
  - 「孤儿 ⇒ 删除」**未执行**：256 份在范围内 md 经「规范化后字节级比对 + 包含关系 + 标题集 Jaccard」三重扫描**无一对重复**；3 份全库零引用项（`2026-09-06_AUDIT-001` / `DATASET_V2_IMPLEMENTATION_PLAN` / `DATASET-002-AUDIT-FINAL`）属**证据类** ⇒ 按 `AUDIT-004` 确立的「零删除 / 移出而非删」惯例**归档**。
  - 「同口径重跑合并」**未执行**（2 处均判定收益为负）：① `docs/quantRoadmap/evidence/**/acceptance.md` 是**11 个不同任务**而非重跑，且其目录布局是 `RESEARCH_GATE_SPECIFICATION.md` §证据目录约定 的**强制约定**（改为**新增** `quantRoadmap/README.md` 索引，不删原件）；② `docs/legacy/phase-reports/` 的 PHASE1 STEP2~5 轮次链**已在归档区**且被 append-only 记录逐条提及。
  - 「`docs/generated/`」**未创建**：全仓 md 中唯一符合「生成物」定义的是 `docs/evidence/_report_body_630001.md`（Run #1 报告投影），已被 `PHASE-A-REPORT-ARTIFACT-001.md` 当证据引用且**仅一版** ⇒ 就地保留，不建空目录。
  - **一条计划项执行期回滚**：`docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001.md` 已 `git mv` 后复核发现 `server/researchExperiments/registry.ts:7` 的源码注释把它当「无目录扫描 / 无 codegen」现行约定的**出处**引用 ⇒ 立即 `git mv` 还原（**不改 `server/**`**，避免热重启杀在途 Run；先例 = 根目录 `calibrate_open_expectation.ts`）。
- **Potential Baseline Drift**：
  - **新登记（未决）· 归档区双坐标**：`docs/legacy/`（2026-09-13/17 两次归位，70 份）与 `docs/archive/`（本轮，20 份）**语义相同**。未合并的理由（append-only 记录会被逐条打断 + 两份 legacy 索引需同步重写 + 导航收益为零）已写入 `docs/archive/README.md` §4。若要统一，建议单独排期。
  - **新登记（未决）· 引用残留**：`docs/legacy/**` 与 `docs/researchDataset/DATASET_CURRENT_STATE_AUDIT.md`（历史文本）、`docs/audit/reports/2026-09-17_AUDIT-004_*.md`（时点快照）、`docs/evidence/README.md`（自动元数据）仍按旧路径提及已归档文档；`ROADMAP-CHANGELOG.md` 与 `.workbuddy/memory/**` 属 append-only ⇒ **均刻意不改写**，已逐条登记在 `docs/archive/README.md` §5.1。**当前有效路径一律以 `docs/INDEX.md` 为准。**
  - 既有 `BD-24` / `BD-12` / `BD-10` / `BD-14` / `BD-16` / `BD-18` / `BD-19` / `BD-20` 保持登记状态，本轮未代补。
- **Regression Result**：`tsc --noEmit` = **exit 0（输出仅 1 条 pnpm 字段警告，0 条 TS 错误）**；未跑 vitest（本轮零源码改动，且删/移的全是非编译 md）。自建验收脚本 5 组断言全过（链接可达 107+24 条 / R100 = 20 / 改动集合守恒 / 29 项保留存在 / `docs/*.md` = 6）。
- **Baseline Impact**：**保持 `v2.0.0`，未升版本**。依据：零 Domain 增删、零 migration、零 `shared/**` 与 `client/**` 改动、零运行时语义变化（纯文档坐标整理）。
- **GLOBAL AUDIT REQUIRED**：**NONE**。
- **Evidence-Hygiene Note**：🔴 记录本轮**判据自身写错 2 条（0 条产品缺陷）**：⒜ 引用扫描第 1 版把「stem 命中」当引用，导致 `acceptance.md` 这类**通用 basename** 因为文中出现 `acceptance` 一词而让 11 个文件全部「被引用」⇒ 改为**标识符正则 + 路径/文件名/词干三级键**后重扫；⒝ 首版把 `git status --porcelain -M` 的输出当含相似度的 `R100` 文本（porcelain v1 **不含**分值）⇒ 断言恒假报 FAIL，改用 `git diff --cached --raw` 的 **blob sha 相等**判「零改写」，比看分值更强。

## 2026-09-21 · Independent Experiment 硬化（异步执行 / 代码指纹 / PIT 冻结 / 资源配额）

- **Task**：现有独立实验体系的可靠性补强。目标不是新增研究问题，而是把 Run 执行、身份、样本冻结与资源边界补到可持续运行。
- **Changed Domains**：`Independent Experiment`（既有）内的 Runner / Dataset Port / Run Repository / Artifact Publisher / tRPC / 前端运行页；`DB migration`（新增 `0048`）；`tests`（新增 hardening 与 artifact limit 测试）。
- **Changed Files**：`shared/researchExperimentsContracts.ts`（代码指纹、配额常量、`freezeSelection`、错误码与结果字段）；`server/researchExperiments/codeDigest.ts`（新增）；`server/researchExperiments/persistence/runQueue.ts`（新增）；`datasetPort.ts` / `runner.ts` / `runRepository.ts` / `runService.ts` / `artifactPublisher.ts` / `runManifest.ts` / `router.ts`；`client/src/pages/researchExperiments/ExperimentDetail.tsx` / `RunDetail.tsx`；`drizzle/schema.ts` + `drizzle/0048_experiment_run_code_digest.sql`；`tests/server/researchExperiments/**`。
- **Changed Contracts**：新增 `experimentCodeDigest`；新增 `EXPERIMENT_RESULT_JSON_MAX_BYTES` / 表格与 Artifact 配额常量；新增 `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED` / `EXPERIMENT_SELECTION_NOT_FROZEN`；`ExperimentRunContext.freezeSelection(eventIds)` 成为读取 `observation()` 前的 PIT 前置。旧 Run / 旧 Manifest 的代码指纹字段可空，保持历史可读。
- **Changed DB**：新增 migration `0048`，为 `research_experiment_run` 增加可空列 `experimentCodeDigest varchar(96)`。只读 dry-run 实测 `pass=true / executed=0 / skippedExisting=1`，该列已由并行工作应用到真实库；本轮未重复执行 DDL。
- **Changed Execution Path**：新增 `researchExperiments.startRun`：创建 PENDING Run 后立即返回，实际执行进入进程内有界并发队列；原同步 `run` 保留给测试与维护。后端生命周期异常时，后台包装器会尝试把 PENDING/RUNNING 收敛为 FAILED。`observation()` 现在要求先调用 `freezeSelection()`；冻结空集时允许“无观测数据”的空结果路径，但不会读取未来行情。
- **Potential Baseline Drift**：
  - 当前队列是**单进程队列**，进程退出会丢失待执行任务，多实例部署不成立；长期 Run 仍依赖 `reconcileRun` 或后续持久化任务系统。
  - `experimentCodeDigest` 覆盖 descriptor、`run()` 源码与 `resultSchema.toString()`，但不覆盖被引用的外部 helper 或依赖包；后者仍需版本治理或构建产物指纹。
  - `freezeSelection` 目前只冻结事件 ID 集合，实验仍可能在冻结后使用 observation 计算排除项；完整“样本选择阶段不得读取未来数据”的语义需要后续双阶段执行器。
  - Run 历史仍是固定上限查询，尚无 cursor 分页；跨 Run 比较和证据目录仍未实现。
- **Regression Result**：`pnpm run check` = **exit 0**；`pnpm run build` = **exit 0**；`pnpm exec vitest run tests/server/researchExperiments` = **16 文件 / 310 例全绿 / exit 0**；`pnpm run test:changed` = **4 个失败文件 / 11 例**，全部是文档登记的环境依赖基线（`marketData` / `limitUp` / `limitUp.watch` / `dataHealth`），**零新增失败文件**。
- **Baseline Impact**：新增 tRPC 端点、shared 可选字段、DB 可空列和运行策略，均为**加法式**；既有实验结果读取兼容。DB 列已确认存在；正式验收仍需做一次真实异步 Run + MinIO 产物 E2E。
- **GLOBAL AUDIT REQUIRED**：**NONE**（无 Domain 删除、无既有计算口径改写；未执行 DB migration）。
- **Evidence-Hygiene Note**：修正了一处测试判据错误：上传第二个对象失败时，实际只应清理第一个已成功写入的 `result.json`，不能把失败的 key 也计入清理数量；已按真实写入顺序收紧断言。

## 2026-09-21 · 策略退出一致性 / 板块规则 / 回测留档可见性 / Run 分页

- **Task**：`ST-01`、`ST-02`（K4 部分）、`ST-03`、`EX-09`。
- **Changed Domains**：`Strategy execution`、`Backtest simulator`、`Research run persistence`、`Independent experiment history UI`。
- **Changed Files**：`server/runWorkbenchAssembly/exitPolicy.ts`（新增）；`server/runWorkbenchAssembly/{assemble,errors}.ts`；`server/research/simulator/{types,validate,plan,engine}.ts`；`server/backtest/{types,portfolio}.ts`；`server/research/closedLoopWiring/executors.ts`；`server/researchRunRouter.ts`；`shared/researchContracts.ts`；`server/researchExperiments/{router,persistence/runRepository}.ts`；`client/src/adapters/closedLoopRunAdapter.ts`、`client/src/components/strategy/ClosedLoopRunResultPanel.tsx`、`client/src/pages/researchExperiments/ExperimentDetail.tsx`。
- **Changed Contracts**：`ClosedLoopRunResult.persistence` 新增可选持久化事实；`getExperiment` 支持 `runOffset`，`listRuns` 支持 `offset`；`SimulationConfig.exitPolicy` 进入模拟配置与快照。
- **Changed DB**：**零 DDL**；migration 仍至 `0048`。复用既有 `closed_loop_backtest_run` 的 JSON 载荷承载 `persistence`。
- **Changed Execution Path**：`STOP_LOSS` / `TAKE_PROFIT` 由 `INTRADAY` 的 bar high/low 触发，卖出全部可卖份额；`TIME_EXIT` 在收盘触发、下一交易日开盘卖出；`Trade.reason` 记录四种退出原因。闭环回测按 Dataset 行把代码前缀 / 交易所映射为 board 后注入模拟器。留档函数返回 `{persisted,errorCode,errorMessage}`，失败不再静默。
- **Potential Baseline Drift**：`K2` 公司行为复权仍未进入模拟器；单笔成本在盘中退出中按现有执行模型和成本口径计算；旧 Run 结果没有 `persistence` 字段，前端按“未知”处理。Run 历史目前是 offset 分页，不是强一致 keyset cursor。
- **Regression Result**：`pnpm run check` exit 0；`pnpm run build` exit 0；定向测试 `426 passed`；真实 DB + MinIO 异步实验 `RUN-20260921-A0E433D0` 在 `34027ms` 后 `COMPLETED`，Result / Manifest / 2 个产物可读；`test:changed` 中与本次相关测试均通过，剩余失败为既有环境依赖基线。
- **Baseline Impact**：新增可选字段与执行政策，旧结果可读；已产生新的真实交易语义，后续参数搜索必须重新运行，不能沿用旧回测结论。
- **GLOBAL AUDIT REQUIRED**：**NONE**（无表删除、无历史数据改写；复权缺口显式保留）。
- **Evidence-Hygiene Note**：时间退出初版会在“只有强制退出、没有候选意图”的日期误把其它持仓当候选退出；已增加 `forcedOnly` 分支与纯函数测试钉死。

## 2026-09-21 · `first-board-pullback/decision-forward-study` 独立实验建立

- **Task**：新增决策时点后续收益实验，验证 EXP-001 的路径分组在 T+k 决策之后是否仍有可观察差异。
- **Changed Domains**：`Independent Experiment`（新增实验定义、结果组装与页面）；`client` 页面注册；`tests`；`docs`。
- **Changed Files**：新增 `research-experiments/first-board-pullback/decision-forward-study/{experiment,result,page}.ts(x)` 与 `README.md`；更新 `research-experiments/manifest.ts`、`research-experiments/README.md`、`client/src/researchExperiments/pages.ts`；新增 `tests/server/researchExperiments/decisionForwardStudy.test.ts`。
- **Changed Contracts**：**无平台契约改动**。新实验复用既有 `ExperimentDefinition`、`freezeSelection`、Dataset Port、Result Envelope、Artifact 与页面接口。
- **Changed DB**：**零 DDL / 零 DML**。仅新增代码定义，尚未产生真实 Run。
- **Changed Execution Path**：新实验严格按 `T+k 收盘 -> T+h 收盘` 计算收益，窗口为 `rd ∈ [k+1, h]`；核心样本只要求决策路径 `rd=1..max(k)` 齐备，远期视界不足按格子独立计入 `availableCount`。默认输出不破 / 破位、回撤深度分桶、20bps 成本后净收益、均值近似 95% CI、分年度结果；不输出最优日、最优视界、策略或候选。
- **Potential Baseline Drift**：收益仍是收盘到收盘；使用统一 20bps 成本敏感性参数，不是完整执行模型；未处理公司行为、涨跌停不可成交、停牌、整手和冲击成本；Dataset 仅覆盖沪深主板；均值 CI 未控制多重比较与重叠观测。
- **Regression Result**：`pnpm run check` exit 0；`pnpm run build` exit 0；`tests/server/researchExperiments` **17 文件 / 315 例全绿**。
- **Baseline Impact**：纯新增实验，未改既有实验和核心计算；正式使用前需运行一次真实 Dataset `390002` Run。
- **GLOBAL AUDIT REQUIRED**：**NONE**。

## 2026-09-21 · `RESEARCH-PROTOCOL-PROVIDER-GATE-001`（Research Protocol / Dataset Provider / Confirmatory Gate）

- **Task**：补齐确认性研究的三项架构能力：探索 / 观察 / Holdout 阶段锁、脱离单一 `first_limit_pullback` 的 Dataset Provider、以及正式策略只接受 Holdout 通过证据的准入 Gate。
- **Changed Domains**：`Independent Experiment`（Runner / Dataset Port / Run 持久化 / tRPC / 实验详情与 Run 详情）；`Strategy Bridge`（证据准入）；`Shared Contracts`；`DB migration`（新增 `0049`）；`tests` / `docs`。
- **Changed Files**：新增 `server/researchExperiments/protocol.ts`、`server/researchExperiments/datasetProvider.ts`、`drizzle/0049_research_protocol_gate.sql`、`tests/server/researchExperiments/protocolGate.test.ts`、`tests/server/researchExperiments/datasetProvider.test.ts`；修改 `shared/researchExperimentsContracts.ts`、`server/researchExperiments/{datasetPort,defaults,registry,runner,evidenceRunReader,strategyBridge}.ts`、`server/researchExperiments/persistence/{runRepository,runService}.ts`、`server/research/strategyCandidate/researchEvidence.ts`、`client/src/pages/researchExperiments/{ExperimentDetail,RunDetail}.tsx`、`drizzle/schema.ts`、`research-experiments/first-board-pullback/decision-forward-study/**` 与对应测试 / 文档。
- **Changed Contracts**：新增 `EXPLORATORY / OBSERVATION / HOLDOUT`、协议输入与平台计算的 `protocolFingerprint`、Observation / Holdout 窗口、`parentRunId`、Confirmatory Gate、`datasetBindings` 与 auxiliary Dataset 声明；`runExperiment` 新增 `auxiliaryDatasetVersionIds` 和 `protocol`，`getExperiment` / `listRuns` 增加 offset 分页。旧 Run / Manifest 的协议字段保持可空，历史数据按 Exploratory 读取。
- **Changed DB**：新增 migration `0049`，为 `research_experiment_run` 增加 `researchPhase`、`protocolId`、`protocolVersion`、`protocolFingerprint`、`parentRunId`、`evaluationStartDate`、`evaluationEndDate`、`datasetBindingsJson`、`confirmatoryGateJson` 9 列，并新增协议 / 父 Run 2 个索引。真实库首次执行为 `11 executed / pass=true`，幂等复跑为 `11 skipped / pass=true`。
- **Changed Execution Path**：`OBSERVATION` 只接受 `OBSERVATION_READY` 或 `INSUFFICIENT`（`PASS` / `FAIL` 均拒绝）；`HOLDOUT` 必须引用同实验、已 `COMPLETED`、Gate 为 `OBSERVATION_READY` 的 Observation Run，并冻结协议指纹、主 / 辅助 Dataset 绑定、代码指纹与参数。同一协议指纹只允许进入一次 Holdout，进入后不得补 Observation。Dataset 事件读取按评估窗口真实过滤；策略桥只接受 `HOLDOUT + PASS + 同协议指纹` 的证据，Exploratory、非 PASS、协议不一致均响亮拒绝。
- **Potential Baseline Drift**：
  - Dataset Provider 扩展点已经打开，但生产装配当前只注册 `first_limit_pullback`；指数、行业、Market Regime 等第二数据源仍需逐项实现 Provider 与不可变版本后才能进入同一协议。
  - 多 Dataset 结果已记录 primary + auxiliary binding，但现有实验尚未声明第二数据源，因此还没有真实的跨 Dataset 研究 Run。
  - 阶段锁依赖平台计算的协议指纹与 Run 表事实；它约束的是“同一 Dataset、同一代码、同一参数、同一窗口”的一次性 Holdout，不替代未来数据、按日期聚类 Bootstrap、真实执行模型等统计与交易口径验证。
  - Holdout 的“一次”锁是应用层前置校验加数据库索引，不是数据库唯一约束；并发创建同一指纹的 Holdout 仍需依靠当前单进程写路径，多实例部署前应补事务级唯一性。
- **Regression Result**：`pnpm run check` exit 0；`pnpm run build` exit 0；`pnpm exec vitest run tests/server/researchExperiments` **19 文件 / 325 例全绿**；migration 真实库幂等复跑通过；`test:changed` 仅命中登记的 4 个环境依赖基线失败文件，零新增失败文件；文档测试、`git diff --check` 与 EOL 漂移检查通过。
- **Baseline Impact**：加法式契约、可空数据库列与新增准入规则；既有 Exploratory Run 和历史结果继续可读。正式策略的准入语义收紧为 `HOLDOUT + PASS + 同协议指纹`，不再允许探索或观察证据直接转策略。
- **GLOBAL AUDIT REQUIRED**：**NONE**（无 Domain 删除、无历史结果口径改写、无 destructive migration）。

## 2026-09-22 · `RESEARCH-PROTOCOL-HOLDOUT-ISOLATION-001`（确认性 Holdout 数据隔离 + 真实独立实验运行）

- **Task**：执行上一阶段约定的「首板后回踩决策时点后续收益」确认性实验，并验证新 Protocol / Gate 是否能安全支撑 Observation → Holdout。真实运行暴露出“窗口已被探索 Run 看过”这一关键缺口，本轮完成隔离门禁修复。
- **Changed Domains**：`Independent Experiment`（协议启动与 Run 读回）；`Strategy Bridge`（Holdout 数据隔离准入）；`Persistence`（DATE 字段读回）；`Shared Contracts`；`tests` / `evidence` / `docs`。
- **Changed Files**：`server/researchExperiments/protocol.ts`（Holdout 污染检测纯函数）；`server/researchExperiments/persistence/runService.ts`（启动前污染闸 + Run 详情隔离审计）；`server/researchExperiments/evidenceRunReader.ts`（同实验窗口元数据读口）；`server/researchExperiments/strategyBridge.ts`（建策略前二次隔离审计）；`server/researchExperiments/persistence/runRepository.ts`（DATE → `YYYY-MM-DD` 读回修复）；`client/src/pages/researchExperiments/RunDetail.tsx`（污染警告）；`shared/researchExperimentsContracts.ts`（新增错误码与详情审计字段）；`tests/server/researchExperiments/{protocolGate,strategyBridgeEvidence,runPersistence}.test.ts`；`docs/evidence/_run_protocol_confirmation.mts`、`docs/evidence/_probe_holdout_contamination.mts` 及输出；`EXPERIMENT-CODE-SPEC.md` / `ROADMAP.md` / `docs/evidence/README.md`。
- **Changed Contracts**：新增 `EXPERIMENT_PROTOCOL_HOLDOUT_CONTAMINATED` 与 `EXPERIMENT_STRATEGY_EVIDENCE_HOLDOUT_CONTAMINATED`。明文规则 = 同实验、同 Dataset 的历史 `EXPLORATORY` / `OBSERVATION` Run 只要与目标 Holdout 窗口重叠，Holdout 不得启动；历史 Run 未声明窗口时按 Dataset 全窗处理。Strategy Bridge 对已存在的污染证据同样拒绝。
- **Changed DB**：**零 DDL / 零 migration**。新增两条真实研究 Run：`RUN-20260921-8AF91CE9`（Observation，COMPLETED，`OBSERVATION_READY`，样本 15,297，H1 预检 0/10）与 `RUN-20260921-54D654BB`（Holdout，COMPLETED，机械化 Gate=`PASS`，样本 8,415，H1 8/10，父 Run 为上一条）。
- **Changed Execution Path**：Holdout 启动时先读取该实验全部历史 Run，并按实际评估窗口做重叠审计；发现污染后在创建 Run 之前抛领域错误。Run 读回将 mysql2 的 `DATE` 对象按本地日历字段归一为 `YYYY-MM-DD`，避免 `Thu Jan…` 进入前端契约。Run 详情返回 `dataIsolation`，污染 Holdout 在页面显示红色阻断警告。Strategy Bridge 在建策略前再次读取同实验窗口并拒绝污染 Holdout。
- **Potential Baseline Drift**：
  - 本次既有 Holdout `RUN-20260921-54D654BB` 的机械化 Gate 虽为 `PASS`，但 `_probe_holdout_contamination.mts` 证明其 2026 窗口已被 `RUN-20260921-A87E7438`（Exploratory、全 Dataset 窗口）看过 ⇒ **不是干净 OOS，不得据此创建正式策略**。新门禁已能阻止当前代码继续使用它。
  - 当前实验仍只有收盘到收盘收益与统一成本，未实现按日期聚类 Bootstrap、外部指数 / 行业中性化、涨跌停 / 停牌 / 滑点等完整执行模型；这些仍是下一步研究能力缺口。
  - 2024-09~2025-12 Observation 为 0/10、2026 Holdout 为 8/10，方向跨期反转，本身就是“机制不稳定”的负面证据；不得通过换决策日 / 换视界再次寻找有利格子。
  - 生产 Dataset Provider 仍只注册 `first_limit_pullback`；外部基准与 Regime 数据尚未接入。
- **Regression Result**：`pnpm run check` exit 0；`pnpm run build` exit 0；`pnpm exec vitest run tests/server/researchExperiments` **19 文件 / 327 例全绿**；真实 DB 复跑 Holdout 被新门禁拒绝（返回污染 Run `RUN-20260921-A87E7438`）；真实 Run 读回窗口为 `2024-09-01..2025-12-31`；详情读回 `dataIsolation.status=CONTAMINATED`；污染探针确认 `contaminated=true`。
- **Baseline Impact**：确认性研究准入进一步收紧；不删除任何历史 Run，也不改写历史 Gate。历史机械 PASS 会被 Strategy Bridge 重新审计，因此不能绕过新规则。
- **GLOBAL AUDIT REQUIRED**：**NONE**（无 Domain 删除、无表结构变更、无历史数据改写）。

## 2026-09-22 · `LIMIT-EXECUTION-FACTS-001`（主板执行事实层 + 2019–2024H1 确认性 Dataset v3）

- **Task**：按已冻结方案补齐 `prevClose / limitUpPrice / limitDownPrice / suspension / tradability`，只用沪深主板构建确认性 Dataset `v3-confirmatory`，为 `2019–2021 Observation + 2022–2024H1 Holdout` 提供执行事实层。
- **Changed Domains**：`Dataset Registry`（physical schema / builder / DB IO / query mapping）；`Limit rules`（日期感知规则）；`DB migration`（新增 `0050`）；`tests` / `evidence` / `docs`。
- **Changed Files**：`drizzle/schema.ts`、`drizzle/0050_limit_execution_facts.sql`、`server/data/boardRules.ts`、`server/datasetRegistry/{types,path,builder,detection,db,query,plugins,executionFacts,testHelpers}.ts`、`scripts/runDataset001Build.mts`、`tests/server/datasetRegistry/{builder,plugins,executionFacts}.test.ts`、`docs/evidence/_probe_v3_execution_facts.mts` 及输出、`ROADMAP.md` / `docs/evidence/README.md`。
- **Changed Contracts**：`FirstLimitPullbackEvent` 增加跌停价与规则快照；原始窗口增加 `preClose`；`post` 窗口增加 `limitUpPrice / limitDownPrice / limitRuleUp / limitRuleDown / limitRuleVersion / barPresent / suspensionStatus / suspensionSource / openAtLimitUp / closeAtLimitDown / oneWordLimitUp / oneWordLimitDown / canBuyAtOpen / canSellAtClose`。旧版本字段为 NULL，保持可读。
- **Changed DB**：migration `0050` 为 event 增 4 列、prefix 增 1 列、post 增 15 列；真实库首次 `20 executed / pass=true`，幂等 `--check` 为 `20 skipped / pass=true`。新版本 `dataset_version.id = 540002 / v3-confirmatory / READY`，窗口 `2019-01-01..2024-08-31`，筛选 `main + excludeSt`、T-20..T+20、horizons `[5,10,20]`。
- **Changed Execution Path**：首板判定和 post 执行事实都使用日期感知涨跌停规则；创业板在 `2020-08-24` 前后分别为 10% / 20%。`preClose` 直接使用交易所前收；涨跌停价按分价四舍五入；PIT `SUSPENSION / TRADING / ST` 状态驱动停牌与 ST 比例；缺 bar / 停牌 / 规则未知时 `canBuyAtOpen` / `canSellAtClose` 一律保守为 false，一字板显式记录。
- **Potential Baseline Drift**：
  - 本批只完成沪深主板执行事实；指数 / 行业 / Regime 辅助 Dataset 仍未接入。
  - `canBuyAtOpen` / `canSellAtClose` 是日线级保守可交易性模型，不能替代逐笔委托簿；一字板、停牌和缺 bar 的处理是明确保守口径。
  - 3,585 个 post 行缺前收 / 执行字段，原因是源行情缺 bar；这些行 `barPresent=false`、不可交易，没有被静默填 0。
  - v3 使用已看过数据区间之外的 2019–2024H1；它解决当前确认实验的数据窗口问题，不等于对未来 Prospective OOS 的替代。
- **Regression Result**：`pnpm run check` exit 0；`pnpm exec vitest run tests/server/datasetRegistry` **13 文件 / 205 例全绿**；真实构建完成：49,154 events / 1,026,583 prefix / 983,080 post / 983,080 path / 147,462 outcome，job `COMPLETED`；真库验收 `mainEvents=49154`、`observationEvents=26383`、`holdoutEvents=22771`、`preCloseNotNull=979495`、`suspended=2717`、`oneWordUp=6807`、`oneWordDown=2259`、`canBuy=967332`、`canSell=959733`。
- **Baseline Impact**：新增 schema 列与 Dataset Version，旧版本不受影响；执行事实层成为后续确认性实验的稳定输入。
- **GLOBAL AUDIT REQUIRED**：**NONE**（无 Domain 删除、无历史行改写；旧版本新列保持 NULL）。

## 2026-09-22 · `HOLD-OPEN-PRICE-PULLBACK-001`（首板后回撤但不破开盘价交易研究）

- **Task**：新增独立实验 `first-board-pullback/hold-open-price-pullback`，研究「首板后在 T+1..T+5 等待首次相对首板收盘 1% 回撤；只要等待路径未跌破首板开盘价，就在次日开盘入场，并在 T+10 / T+15 / T+20 固定退出」的交易周期。
- **Changed Domains**：`Independent Experiment`（新实验定义 / 结果页）；`client` 页面注册；`tests` / `evidence` / `docs`。
- **Changed Files**：新增 `research-experiments/first-board-pullback/hold-open-price-pullback/{experiment,result,page}.ts(x)` 与 README；更新 `research-experiments/manifest.ts`、`client/src/researchExperiments/pages.ts`；新增 `tests/server/researchExperiments/holdOpenPricePullback.test.ts`、`docs/evidence/_run_hold_open_price_pullback.mts` 与输出、`docs/evidence/_probe_v3_execution_facts.mts` 与输出。
- **Changed Contracts**：**无平台契约改动**。实验复用既有 `ExperimentDefinition`、Dataset Port、Result Envelope、Artifact 与持久化；使用 v3 `post` 执行事实列。
- **Changed DB**：**零 DDL / 零 migration**。真实研究 Run：`RUN-20260921-35357C36`，`Dataset 540002`，`EXPLORATORY`，`COMPLETED / SUCCEEDED`，耗时 `234032ms`。
- **Changed Execution Path**：事件候选 49,154；eligible 48,897。入场前破位 5,221；等待窗口未触发回撤 9,039；触发 34,637；触发后次日不可买 143；交易样本 101,751（事件 × 退出日）。收益严格从次一交易日开盘到退出日收盘，毛收益扣 20bps 往返成本；同时登记入场后是否再次跌破首板开盘价，不把它伪造成已实现止损。
- **Potential Baseline Drift**：
  - 默认 100bps 回撤相对首板收盘价定义，同时要求路径不低于首板开盘价；这是研究参数，不是最优阈值。
  - 未实现破位后的下一可卖点、滑点、冲击成本、整手与部分成交；入场后破位只作事实统计。
  - 首次真实结果显示三种退出视界的中位净收益均为负，但交易模式的均值 / 中位数 / 胜率均优于「全部样本 T+1 开盘买入」基准；尚未做按日期聚类 Bootstrap 或真正的 Holdout 确认。
  - v3 只覆盖沪深主板；指数 / 行业 / Regime 辅助 Provider 仍未接入。
- **Regression Result**：`pnpm run check` exit 0；`tests/server/researchExperiments` **20 文件 / 330 例全绿**；与 Dataset Registry 合并定向测试为 **33 文件 / 535 例全绿**；真实 Run 产物含 `result.json`、`manifest.json`、`logs/run.log` 共 3 个对象；`test:changed` 仍只命中登记的 4 个环境依赖失败文件。
- **Baseline Impact**：纯新增实验定义与页面，不影响既有实验 / Strategy / Backtest；真实 Run 已落库且可页面读取。
- **GLOBAL AUDIT REQUIRED**：**NONE**。

## 2026-09-22 · `HOLD-OPEN-PRICE-PULLBACK-002`（一字板首板排除复跑）

- **Task**：在 `hold-open-price-pullback` 中新增 `excludeOneWordLimitUp`，首板日满足 `O=H=L=C=limitUpPrice` 即识别为一字板；默认开启并从 eligible 中剔除。实验版本升至 `1.1.0`，旧 `1.0.0` Run 保留。
- **Changed Files**：`research-experiments/first-board-pullback/hold-open-price-pullback/{experiment,result,page}.tsx|ts`、README、`tests/server/researchExperiments/holdOpenPricePullback.test.ts`、`docs/evidence/_run_hold_open_price_pullback.mts` 与输出。
- **Changed Contracts**：实验自有 payload 增加 `excludeOneWordLimitUp`、`eventOneWordLimitUpCount`、`excludedOneWordLimitUpCount` 与排除原因 `EXCLUDED_ONE_WORD_LIMIT_UP`；平台契约零改动。
- **Changed DB**：零 DDL。真实复跑 `RUN-20260922-2090E5A6`，Dataset `540002`，`COMPLETED / SUCCEEDED`，耗时 `777706ms`。
- **Changed Execution Path**：候选 49,154；识别一字板 **1,621** 并全部排除；eligible **47,276**；入场前破位 **4,214**；未触发 **8,425**；触发 **34,637**；触发后不可买 **143**；交易样本 **101,751**。
- **Potential Baseline Drift**：一字板排除对该交易模式结果**无增量影响** —— 触发数、交易样本与 T+10/T+15/T+20 全部收益指标与 `1.0.0` 逐位相同；减少的 1,621 个 event 全部来自入场前破位 / 未触发，而非可交易样本。
- **Regression Result**：新增第 3 个单测覆盖一字板排除账目；`pnpm run check` 0；定向实验测试全绿；真实 Run 结果 / Manifest / 日志可读。
- **Baseline Impact**：纯实验级版本升级与参数增加；无平台契约、DB 或历史结果改写。
- **GLOBAL AUDIT REQUIRED**：**NONE**。

## 2026-09-22 · `FIRST-BOARD-CONTEXT-BOOTSTRAP-001`（首板前后上下文 + 换手率 + 日期聚类 Bootstrap）

- **Task**：新增三项独立研究：① `pre-event-context-study`：首板前距上次涨停间隔与 T-5/T-10/T-20 前期涨幅；② `post-event-amplitude-study`：T+1..T+5 无涨跌停与平均振幅；③ `turnover-study`：首板日换手率、流通市值可用性与未来收益，并使用按交易日聚类的 Moving Block Bootstrap。
- **Changed Files**：`research-experiments/shared/dateClusterBootstrap.ts`；三个新实验目录 `research-experiments/first-board-pullback/{pre-event-context-study,post-event-amplitude-study,turnover-study}/**`；`research-experiments/manifest.ts`；`client/src/researchExperiments/pages.ts`；三个新测试文件与对应 evidence runner / output。
- **Changed Contracts**：平台契约零改动；实验自有 payload 增加上下文维度、Bootstrap 参数 / CI、`floatMarketCapStatus` 与 `INSUFFICIENT_DATA` 披露。
- **Changed DB**：零 DDL。真实 Run：
  - `RUN-20260922-71838486`：首板前上下文，eligible 47,120，Run 18.8 分钟；
  - `RUN-20260922-3F4B3C39`：无涨跌停 / 振幅，eligible 48,897，Run 8.1 分钟；
  - `RUN-20260922-4A0DAF7B`：换手率 / Bootstrap，eligible 45,726，Run 7.6 分钟。
- **Changed Execution Path**：Bootstrap 使用 `1000` 次 Moving Block，block=`20` 个交易日，固定 seed；同交易日事件整体重采样，避免把横截面相关事件当独立样本。流通市值当前 `0/49,154`，返回 `INSUFFICIENT_DATA`；换手率 `49,150/49,154` 可用。
- **Potential Baseline Drift**：
  - 三项实验都使用完整 `2019–2024H1` Dataset，因此 2022–2024H1 对这些研究族已被探索，不能再作为干净独立 Holdout。
  - 流通市值底层 `liquidity_daily.circulationMarketCap` 为 `0/9,015,158`，必须先补 `daily_basic.circ_mv` 数据并重建 Dataset，才能检验市值关系。
  - Bootstrap CI 已解决日期聚类相关性，但不解决参数选择偏差；仍需未来 Prospective Holdout。
  - 主要观察：高换手率（≥10%）和首板前大幅上涨组明显较差；无涨跌停 / 中等振幅相对更好；首板前超跌组相对更强。
- **Regression Result**：`pnpm run check` exit 0；新增三个实验单测全绿；每个真实 Run 均产出 result / manifest / run.log；Bootstrap 结果含 clustering metadata。
- **Baseline Impact**：三项纯新增实验与共享 Bootstrap 工具；无历史 Run / DB 结构改写。
- **GLOBAL AUDIT REQUIRED**：**NONE**。
---

## 2026-10-03 · `CODE-AGENT-INFRA-001`（建立项目级 Coding Agent 工作体系）

- **Task**：建立项目级 Agent/Skill 基础设施 + 当前架构地图。**不做任何业务代码重构。**
- **Changed Domains**：**无**（纯规则 / 文档；未改任何 Domain 逻辑）
- **Changed Files**：
  - 新增 `AGENTS.md`（项目级总规则：不变量 / 修改原则 / 数据库规则 / 权限 / 工程铁律 / DoD）
  - 新增 `.agents/{architecture,refactoring,verification,database,strategy,research}/SKILL.md`（6 个专业 Skill）
  - 新增 `docs/architecture/ARCHITECTURE.md`（当前实际架构，2026-10-03 实查）
  - 新增 `docs/architecture/MODULE-MAP.md`（模块地图：Module/Purpose/Main Entry/Dependencies/Consumers/Tests/Status）
  - 新增 `docs/architecture/LEGACY-MAP.md`（legacy 路径地图：L-01~L-16 + 重点检查项核实）
  - 更新 `docs/INDEX.md`（登记上述文件；**保留原有 CRLF 行尾**）
- **Changed Contracts**：**无**（未改任何 `shared/**` 契约）
- **Changed DB**：**无**（0 schema / 0 migration / 0 DML；未连库）
- **Changed Execution Path**：**无**
- **Potential Baseline Drift**：**发现并登记 7 条**（`ARCHITECTURE.md` §11）——
  - `BD-11`：`server/researchCore/**` / `researchEngine/**` / `researchPlanner/**` **已删除**（baseline 仍指其为权威入口）
  - `BD-12`：旧 Research 表已 DROP / RENAME 为 `archive_research_*`（migration `0046`）⇒ 「两套 Research 数据模型并存」**已解决**
  - `BD-13`：`drizzle/schema.ts` 2947 行 / 70 表 → 2224 行 / ≈55 表；migration 45 → 56
  - `BD-14`：闭环 `requirements.ts` 声明 8 阶段 `wired:true`，但 `executors.ts` 仅实装 5 阶段（optimization/regime/finalize 无 runner，**待核**）
  - `BD-16` / `BD-17`：`tests/server/research/strategyCandidate/importBoundary.test.ts` **已不存在**（`DOMAIN-MAP.md` §2 / `DEPENDENCY-MAP.md` D-92 引用失效）；活着的边界守卫是 `legacyFreeProductionChain.test.ts` + 三个 `*Boundary.test.ts`
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0（0 错）**
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**（已跟踪漂移 0 / 未跟踪 CRLF 0）
  - `pnpm exec vitest run tests/server/research/{legacyFreeProductionChain,closedLoopWiring/closedLoopWiring}.test.ts` ⇒ **40/40 通过**
  - `pnpm exec vitest run tests/server/research/{oosValidation/oosValidationBoundary,searchRobustness/robustnessBoundary,walkForward/walkForwardBoundary}.test.ts` ⇒ **55/55 通过**
  - 工作区存在**其它会话的未提交业务改动**（`server/paperTrading3fTop3Runner/**` 等）⇒ 本任务**未触碰**；判定「业务代码变化 = 0」以「本任务写入的文件集合」为准
- **Baseline Impact**：新增当前读数地图 3 份 + 总规则 1 份 + Skill 6 份。**未改写** `SYSTEM-BASELINE.md` / `DOMAIN-MAP.md` 等旧基线（drift 只登记，不就地修改，按 `AGENT-GUIDE.md` §6 处置）。建议后续以独立任务 `CODE-AGENT-INFRA-002` 统一修正旧地图。
- **GLOBAL AUDIT REQUIRED**：**NONE**（本任务不改 Domain 边界 / 主链 / 核心契约 / DB schema；仅新增规则与当前读数）
---

## 2026-10-03 · `REFACTOR-001`（退役 STEP 6.x 零引用死代码）

- **Task**：删除已确认**零运行时引用**的 STEP 6.x legacy 死代码（Architecture → Refactoring → Verification 三 Skill 流水线的首次真实验证）。
- **Changed Domains**：**无**（不变量零变化；未改 Domain 边界 / 主链 / 契约 / 指标）
- **Changed Files**：
  - 删除 `server/research/experiment.ts`（169 行）· `server/research/status.ts`（53）· `server/research/engineAdapter.ts`（95）· `server/engine/adapter.ts`（58）—— 合计 **375 行**
  - 清理 6 处 stale comment：`server/runWorkbenchAssembly/executionModel.ts` · `server/research/strategySchema/types.ts` · `server/research/strategySchema/map.ts` · `server/research/types.ts` · `server/research/lifecycle/transition.ts` · `shared/researchContracts.ts`
- **Changed Contracts**：**无**（`shared/researchContracts.ts` 仅改一行注释文字）
- **Changed DB**：**无**（0 DDL / 0 DML / 0 migration；未连库）
- **Changed Execution Path**：**无**（改动行 14 处**全部为注释**，可执行代码零变化；删除对象 0 importer）
- **Potential Baseline Drift**：删除使 5 份架构地图中的 L-08/L-09/L-10 条目变为「已退役」—— 已由同日的 `CODE-AGENT-INFRA-002` 同步修正
- **Regression Result**：
  - Architecture 前置：自建 import 图扫描 **1666 文件** → 4 目标 **0 importer**；22 个导出符号逐一核对无外部引用
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/server/research/legacyFreeProductionChain.test.ts` ⇒ **7/7**
  - 定向回归（`runWorkbenchAssembly` + `strategySchema` + `strategyPersistence` + `lifecycle` + `researchContracts` + `statusVocabulary`）⇒ **19 文件 / 335 用例全绿**
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
  - 提交：`55f7838`
- **Baseline Impact**：**L-08 / L-09 / L-10 退役**（`SYSTEM-BASELINE.md` §11 · `LEGACY-MAP.md` L-09/L-10 · `EXECUTION-FLOW.md` §6 · `DEPENDENCY-MAP.md` §5/§6 · `system-manifest.yaml`）
- **GLOBAL AUDIT REQUIRED**：**NONE**（纯死代码删除 + 注释清理，未触碰 Domain 边界 / 主链 / 核心契约 / DB schema）

## 2026-10-03 · `CODE-AGENT-INFRA-002`（架构地图 drift 同步）

- **Task**：把因旧 Research 链退役与 `REFACTOR-001` 而失效的架构地图条目同步为当前事实（含 `BD-16` / `BD-17` 的失效测试引用修正）。
- **Changed Domains**：**无**（纯文档）
- **Changed Files**：`docs/architecture/{LEGACY-MAP,EXECUTION-FLOW,DEPENDENCY-MAP,SYSTEM-BASELINE,system-manifest.yaml,DOMAIN-MAP,CONTRACT-MAP,ARCHITECTURE,CHANGE-AUDIT}.md|yaml` + `AGENTS.md` / `.agents/refactoring/SKILL.md`（边界守卫命名由已删除的 `importBoundary.test.ts` 改指 `legacyFreeProductionChain.test.ts`）
- **Changed Contracts**：**无**
- **Changed DB**：**无**
- **Changed Execution Path**：**无**
- **Potential Baseline Drift**：修正 `BD-16` / `BD-17` —— `tests/server/research/strategyCandidate/importBoundary.test.ts` **已不存在**（全仓 `*importBoundary*` 零命中），其守护对象 `researchCore` / `researchEngine` / `server/research` 主 barrel 亦已删除。已把 `DOMAIN-MAP.md`（§2/§风险）· `CONTRACT-MAP.md`（§边界守护/§检查清单）· `DEPENDENCY-MAP.md`（§2 禁止项 4/6 · §5 AR-6 · §6 死代码计数 · D-92）· `system-manifest.yaml`（`research.boundaryGuard` / `legacyPaths` / `roundTwo.newCrossDomainEdgesUnGuarded`）· `SYSTEM-BASELINE.md`（L-8/L-9 · AR-9）的引用**改指当前活守卫**：`tests/server/research/legacyFreeProductionChain.test.ts`（AST import 图可达性 Gate，7 用例）+ `oosValidationBoundary` / `robustnessBoundary` / `walkForwardBoundary`（55 用例）。
- **Regression Result**：纯文档；`node scripts/checkEolDrift.mjs --strict` ⇒ **0**
- **Baseline Impact**：架构地图与 `system-manifest.yaml` 的 legacy / 死代码 / 边界守卫条目与当前代码重新对齐；**未改写历史报告**（`SYSTEM-BASELINE-001-REPORT.md` / `SYSTEM-BASELINE-002-REPORT.md` / `docs/legacy/**` 按「时点快照」保留）
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `A11Y-DIALOG-FOCUS-002`（对话框焦点还原从单组件上移到共享包装层）

- **Task**：`A11Y-DIALOG-FOCUS-001` 只修了 `ConfirmDialog`。随后静态扫描发现**同类受控且无 Trigger 的对话框共 9 个**，若继续逐调用点修补会重复实现且必然遗漏 ⇒ 把修复上移到 Radix 包装层，一次覆盖全部对话框。
- **Changed Domains**：**无**（纯前端无障碍修复）
- **Changed Files**：`client/src/lib/dialogFocusRestore.ts`（新共享 hook）· `client/src/components/ui/{dialog,alert-dialog}.tsx`（Content 统一接入）· `client/src/components/common/ConfirmDialog.tsx`（移除本地重复实现）· `tests/client/src/pages/pageFlowContracts.test.ts`（§36–§38）
- **Changed Contracts / DB / Execution Path**：**无**
- **根因与实现**：Radix 默认焦点还原依赖 `DialogTrigger` 写入的 `triggerRef`；本仓大量对话框是受控用法且无 Trigger。共享 hook 在 `onOpenAutoFocus` 捕获触发元素，在 `onCloseAutoFocus` 中 `preventDefault()` + `focus()`，并用 `document.contains()` 守卫；包装层同时透传调用方自己的 handler，避免覆盖扩展点。
- **验证**：
  - `ConfirmDialog` 焦点探针 **4/4 PASS**（打开 / Escape 关闭 / 焦点回触发按钮 / 未误删）
  - 曾同类缺陷的 `EditCandidateDialog` 探针 **4/4 PASS**（焦点回到「编辑草图」按钮）
  - 确认框回归探针 **5/5 PASS**
  - `pageFlowContracts.test.ts` ⇒ **37/37**；`pnpm run check` ⇒ **0 错**；`checkEolDrift --strict` ⇒ **0**
  - 仓外对话框扫描：**15/15** 命中包装层兜底标记
- **断言调整（如实记录）**：原 §35 只断言 `ConfirmDialog` 内存在局部修复；实现上移后该断言会反向阻止去重，已由 §36/§37/§38 取代。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `A11Y-FOCUS-VISIBLE-003`（键盘焦点必须有可见指示）

- **Task**：在对话框焦点还原收口后，继续审计 `:focus-visible` 可见性，查找「可聚焦但聚焦后画面无变化」的控件。
- **Changed Domains**：**无**（纯前端无障碍样式）
- **Changed Files**：`client/src/components/ui/tabs.tsx` · `client/src/pages/StrategyVersionCompare.tsx` · `client/src/components/AppShell.tsx` · `tests/client/src/pages/pageFlowContracts.test.ts`（§39–§41）
- **Changed Contracts / DB / Execution Path**：**无**
- **发现**：
  1. `StrategyVersionCompare` 的版本搜索 `<input>`：真实 Tab 到它时 `:focus-visible=true`，但 `outline/box-shadow/border` 与未聚焦基线完全一致 ⇒ 键盘用户看不到焦点位置。
  2. `/data-health` 与 `/market` 的 Radix `TabsList` 自身可聚焦，但共同组件没有焦点环 ⇒ 同属焦点不可见。
  3. 侧栏账户菜单触发器只剩 `focus:outline-none`、没有替代 ring；因登录态下才渲染，用静态结构守卫 + 强制伪类 DOM 验证钉住。
- **修复**：① `TabsList` 共用样式增加 `focus-visible:ring-2 + ring-ring`；② 版本搜索的边框容器增加 `focus-within:border-ring + focus-within:ring-2`，同时保持输入框自身简洁；③ 账户触发器改为 `focus-visible:ring-2 + ring-sidebar-ring`。
- **验证**：
  - 真实 DOM 探针 **3/3 PASS**：版本搜索用真实 Tab（`focusVisible=true`，父容器 `box-shadow`/`border-color` 变化）✅；`TabsList` 强制 `:focus-visible` 后出现 2px ring ✅；账户触发器强制 `:focus-visible` 后出现 2px ring ✅
  - `pageFlowContracts.test.ts` ⇒ **40/40**（新增 §39/§40/§41）
  - `pnpm run check` ⇒ **0 错**；`checkEolDrift --strict` ⇒ **0**
  - 探针：仓外 `_scratch/probe_focus_visible_fix.mjs`；全站强制伪类扫描 `_scratch/probe_focus_visible_scan.mjs`
- **边界**：`TabsList` 与账户按钮的 DOM 验证使用 CDP `CSS.forcePseudoState`，搜索框使用真实 Tab；强制伪类结果不等于真实键盘遍历，但用于判定 CSS 是否有可见指示足够，且已用真实 Tab 对其中一条路径交叉验证。
- **GLOBAL AUDIT REQUIRED**：**NONE**

## 2026-10-03 · `CODE-AGENT-ORCHESTRATOR-001`（Orchestrator / Project Manager Agent）

- **Task**：新增跨阶段 Orchestrator Skill，读取 ROADMAP 与当前任务状态，判断 READY 阶段，按需路由 Product / Frontend / Architecture / Strategy / Research / Database / Refactoring / Verification，并统一状态机、停止条件、SAFE_PIPELINE 与 ROADMAP 同步规则。
- **Changed Domains**：**无**（仅 Agent 工作流与规则文档；未改变 Dataset / Research / Strategy / Backtest / Paper Trading / Production 语义）
- **Changed Files**：新增 `.agents/orchestrator/SKILL.md`；更新 `AGENTS.md`（Skill 注册、职责边界、完整目标默认流水线）、`docs/architecture/AGENT-GUIDE.md`（9 个 Skill 的职责与编排链）、`ROADMAP-CHANGELOG.md`（§47 append-only 记录）。
- **Changed Contracts**：**无**
- **Changed DB**：**无**（0 DDL / 0 DML / 0 migration；未连库）
- **Changed Execution Path**：**无**（未修改 `server/**` / `client/**` 运行代码）
- **Potential Baseline Drift**：**无领域漂移**。本次只把 Agent 规则层的 Skill 数量从 8 更新为 9，并明确 Orchestrator 默认 `SAFE_PIPELINE`；未修改 §44 状态区或 §44.5 未完成队列。
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 error**
  - `pnpm run test:changed`：因既有未提交 `package.json` 命中全局触发，回退全量 **327 文件** ⇒ **319 passed / 8 failed files；4569 passed / 19 failed tests**。失败由既有工作区状态造成：7 个已知环境 / 离线文件（16 例）+ 既有未提交 `recoveryPath` 变更导致 `tests/server/researchExperiments/threeFactorTopNStrategyDocument.test.ts` 3 例不匹配；本次仅新增/修改 Markdown，未触及任何测试或运行代码。
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0 漂移 / 0 未跟踪 CRLF**
- **Baseline Impact**：Agent 规则层新增跨阶段编排能力；专业 Skill 的业务权威边界不变。`ROADMAP.md` §44 / §44.5 保持不变（本任务不改变当前业务状态与未完成队列），历史更新按 §47 写入 `ROADMAP-CHANGELOG.md`。
- **GLOBAL AUDIT REQUIRED**：**NONE**

## 2026-10-03 · `CODE-AGENT-GOAL-ORCHESTRATOR-002`（Orchestrator → Goal 驱动编排协议）

- **Task**：把已有 Orchestrator Skill 从「阶段路由」升级为 **Codex Goal 驱动**的持续推进工作流：Codex Goal → Orchestration Protocol → 当前任务状态 → 选择下一阶段 → 按对应 Skill 规则执行 → 测试 / 验证 → 更新状态 → 继续，直到 `COMPLETE` / `BLOCKED` / `NEEDS_HUMAN`。
- **Changed Domains**：**无**（仅 Agent 工作流与规则文档；未改变 Dataset / Research / Strategy / Backtest / Paper Trading / Production 语义）
- **Changed Files**：
  - 重写 `.agents/orchestrator/SKILL.md`：10 阶段标准 Pipeline（`PRODUCT` / `RESEARCH` / `STRATEGY` / `ARCHITECTURE` / `FRONTEND` / `BACKEND` / `INTEGRATION` / `REFACTORING` / `VERIFICATION` / `FINAL`，`DATABASE` 为横切只读 Gate）；阶段状态词汇 `BACKLOG` → `PENDING`；明确「Orchestrator 不把 Skill 当工具函数调用（无 `call_skill()` / `invoke_skill()` / `run_skill()`），Skill 是规则、Codex 是执行主体」；新增 Goal 启动协议（`/goal`）、自动继续与停止条件、检查点、Verification / Database / Strategy / Research Gate、Git 安全、`GOAL FINAL` 报告模板。
  - 新增 `.agent/task-state.yaml`：当前 Goal 的过程状态（只描述当前 Goal；不保存长期业务知识 / 模型内部推理；不替代 `AGENTS.md` / `ROADMAP.md`；不参与业务逻辑）。
  - 更新 `AGENTS.md`（§7 Orchestrator 条目改为 Goal 驱动，新增 `/goal` + `.agent/task-state.yaml` + 10 阶段说明）、`docs/architecture/AGENT-GUIDE.md`（§1-A 新增「Goal 驱动编排」与「不把 Skill 当工具函数调用」约束）、`ROADMAP-CHANGELOG.md`（§47 append-only）。
- **Changed Contracts**：**无**
- **Changed DB**：**无**（0 DDL / 0 DML / 0 migration；未连库）
- **Changed Execution Path**：**无**（未修改 `server/**` / `client/**` 运行代码）
- **Potential Baseline Drift**：**无领域漂移**。仅 Agent 规则层：Orchestrator 由「阶段路由」升级为「Goal 驱动协议」；阶段状态词汇 `BACKLOG` 规范化为 `PENDING`（纯 Agent 规则，未影响任何业务状态机 / 契约 / DB）。
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 error**
  - `pnpm run test:changed`：因既有未提交 `package.json` 命中全局触发，回退全量 **327 文件** ⇒ **319 passed / 8 failed files；4569 passed / 19 failed tests**。失败集与 `CODE-AGENT-ORCHESTRATOR-001` 基线**完全一致**：7 个已知环境 / 离线文件（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）+ 既有未提交 `recoveryPath` 变更导致 `threeFactorTopNStrategyDocument.test.ts` 3 例不匹配。**零新增失败文件**。
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0 漂移 / 0 未跟踪 CRLF**
  - 虚拟任务编排模拟（低风险工具模块重构）⇒ 正确生成 `ARCHITECTURE → REFACTORING → VERIFICATION → FINAL`，未修改任何模块
- **Baseline Impact**：Agent 规则层升级为 Goal 驱动编排；专业 Skill 业务权威边界不变。`ROADMAP.md` §44 / §44.5 保持不变（本任务不改变当前业务状态与未完成队列），历史更新按 §47 写入 `ROADMAP-CHANGELOG.md`。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `PAGE-FLOW-001`（页面流程三缺口落地：PD-01 / PD-04 / PD-03）

- **Task**：把 `docs/product/PRODUCT-DECISIONS-001.md` 的 3 个产品决策落成代码：观察→研究入口（PD-01）、验证域输入来源显式化（PD-04）、候选列表只读端点 + 列表页（PD-03）。
- **Changed Domains**：**Research（候选只读）** + **Frontend**；Dataset / Strategy / Backtest 语义**零改动**
- **Changed Files**：
  - 新增 `client/src/components/research/ResearchEntryLink.tsx` · `client/src/components/validation/{RerunBadge,ValidationSourcePicker}.tsx` · `client/src/pages/candidates/CandidateList.tsx`
  - 新增 `tests/server/research/strategyCandidate/candidateList.test.ts`
  - 修改 `server/research/strategyCandidate/{service.ts,router.ts}`（新增只读 `list`）
  - 修改 `client/src/components/{robustness/SearchRobustnessPanel,oos/OosValidationPanel,walkForward/WalkForwardPanel}.tsx`、`client/src/components/research/index.ts`、`client/src/pages/candidates/index.ts`
  - 修改 `client/src/pages/{Dashboard,Market,SentimentAnalysis,LeaderCandidates,LimitUpReview}.tsx`（观察页入口）
  - 修改 `client/src/App.tsx` / `client/src/components/AppShell.tsx`（候选路由 + 侧栏，**mixed EOL 精确插入**）
  - 文档：`docs/product/**`（8 份）· `docs/architecture/SCOPE-001-candidate-list-endpoint.md` · 本文件 · `CONTRACT-MAP.md`（+C-97）
- **Changed Contracts**：➕ `C-97` 候选列表只读契约（`strategyCandidate.list`，input/output schema）—— **新增只读端点，无 breaking**
- **Changed DB**：**无**（0 DDL / 0 DML / 0 migration；未连库）
- **Changed Execution Path**：**无**（PD-01/PD-04 为展示与输入方式；PD-03 为只读查询）
- **Potential Baseline Drift**：无。PD-01 的原始前提（从观察页携带 `datasetVersionId`）被实查推翻 —— 5 个观察页**全部 dataset-unaware**（读 legacy 表），已按 `SPEC-002` 修正为「跳转入口、不携带坐标」并在 `PRODUCT-DECISIONS-001.md` 登记前提修正。
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/server/research/legacyFreeProductionChain.test.ts` ⇒ **7/7**（边界 Gate 不回归）
  - `pnpm exec vitest run tests/server/research/strategyCandidate tests/client/src/adapters/strategyCandidateAdapter.test.ts` ⇒ **5 文件 / 126 用例全绿**（含新增 5 用例）
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**（`App.tsx` / `AppShell.tsx` 的 mixed 行尾保持）
- **Baseline Impact**：新增 contract `C-97`；`AGENTS.md` / `AGENT-GUIDE.md` 由并发会话的 `CODE-AGENT-ORCHESTRATOR-001/002` 同步，本任务未改写其内容。
- **GLOBAL AUDIT REQUIRED**：**NONE**（无 Domain 边界变化、无主链变化、无 DB schema 变化）

---

## 2026-10-03 · `FRONTEND-IA-001`（侧栏信息架构按研究闭环阶段重组）

- **Task**：把侧栏从「按功能来源分组」（复盘分析 / 研究 / 策略 / 验证 / 交易 / 系统）改为**按用户所处的研究闭环阶段分组**（① 数据 → ② 观察 → ③ 研究 → ④ 策略 → ⑤ 验证 → ⑥ 前向与复盘）。依据 `docs/product/FLOW-001-page-workflow.md` §4/§5。
- **Changed Domains**：**无**（纯前端导航归位；路由、页面、端点、契约全部未动）
- **Changed Files**：`client/src/components/AppShell.tsx`（navGroups 重排）· `client/src/pages/validation/ValidationIndexPage.tsx`（补旧预览入口）· `tests/client/src/pages/pageFlowContracts.test.ts`（+5 结构锁）· `docs/product/FLOW-001-page-workflow.md`（状态与两处自相矛盾修正）
- **Changed Contracts**：**无**（未新增/修改任何 tRPC 契约）
- **Changed DB**：**无**
- **Changed Execution Path**：**无**
- **Potential Baseline Drift**：修正 FLOW-001 自身两处矛盾 —— ① 草案把「组合回测」放进 ⚙ 工具箱，与 §5「🔒 不挪位置」冲突 ⇒ 以 §5 为准，实际**留在 ④ 策略**；② §5 的「观察类页面补显 `datasetVersionId`」与 `SPEC-002`/PD-01 的实测结论（观察页 dataset-unaware）冲突 ⇒ **撤销该行**。
- **Regression Result**：
  - 导航项数 **27 → 28**（原 27 项**一项不丢** + PD-03 新增 `/candidates`），与 HEAD 版本逐项集合比对无缺失
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/client/src/pages/pageFlowContracts.test.ts` ⇒ **18/18**（含新增 §14–§18：分组顺序 / 28 项集合 / 归位 / 组合回测不动 / 旧预览入口）
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
- **Baseline Impact**：导航 IA 与 FLOW-001 重新对齐；`ROADMAP.md` §44/§44.5 未改（未改变业务状态与未完成队列）。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `FRONTEND-LINK-001`（清除旧 Research 死链与误导文案 + 断链守卫）

- **Task**：以「站内可达性审计」为判据清扫前端遗留缺陷：① 候选详情页 3 处指向**已移除**的 `/research[/:id]` 路由（死链）；② 「来源实验 / 来源结论」把**结构性退役**显示成「已不存在」（误导）；③ adapter 中指向**不存在的「结论页」**等过时提示。
- **Changed Domains**：**无**（纯前端展示与文案；路由 / 端点 / 契约 / DB 全部未动）
- **Changed Files**：`client/src/pages/candidates/StrategyCandidateDetail.tsx` · `client/src/adapters/strategyCandidateAdapter.ts` · `tests/client/src/pages/pageFlowContracts.test.ts`（+断链守卫）· `tests/client/src/adapters/strategyCandidateAdapter.test.ts`（3-e 断言加强）
- **Changed Contracts**：**无**（tRPC 契约零改动）
- **Changed DB**：**无**
- **Changed Execution Path**：**无**
- **Potential Baseline Drift**：`StrategyCandidateDetail` 的文件头注释仍写旧路径 `/research/candidates/:candidateId`，实际为 `/candidates/:candidateId` ⇒ 已修正。
- **Regression Result**：
  - 断链守卫**已验证覆盖面**：对修复前的 4 种写法（模板串 `/research/${id}`、`"/research"`、`/findings/1` 等）均命中；修复后 0 命中
  - 站内可达性审计：**无孤儿路由**（44 条路由全部有入口；仅 `/dataset-builder` `/strategy-editor` 为纯重定向，无站内入口属设计意图）
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/client/src/pages/pageFlowContracts.test.ts tests/client/src/adapters/strategyCandidateAdapter.test.ts` ⇒ **2 文件 / 70 用例全绿**
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
- **Baseline Impact**：仅 `CHANGE-AUDIT` + 本 Goal 的 `task-state.yaml`。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `HOME-ENTRY-001`（首页研究闭环六阶段入口带）

- **Task**：把首页 `/` 从「只有行情总览」补成「研究流程入口 + 今日观察」双区 —— **加法式**：新增六阶段入口带，下方行情总览**一个区块未删**。决策见 `PRODUCT-DECISIONS-001.md` PD-05。
- **Changed Domains**：**无**（纯前端导航组件）
- **Changed Files**：`client/src/components/research/ResearchFlowNav.tsx`（新增）· `client/src/components/research/index.ts`（barrel）· `client/src/pages/Dashboard.tsx`（+1 行渲染）· `tests/client/src/pages/pageFlowContracts.test.ts`（+§20/§21）· `docs/product/{FLOW-001,PRODUCT-DECISIONS-001}.md`
- **Changed Contracts**：**无**
- **Changed DB**：**无**
- **Changed Execution Path**：**无**（入口带为纯导航：不取数、不计算，§21 断言组件内无 `trpc` / `useQuery`）
- **Potential Baseline Drift**：无
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/client/src/pages/pageFlowContracts.test.ts tests/client/src/adapters/strategyCandidateAdapter.test.ts` ⇒ **2 文件 / 72 用例全绿**（含 §20 与侧栏逐条一致、§21 纯导航）
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
- **Baseline Impact**：`CHANGE-AUDIT` + `.agent/task-state.yaml`；`ROADMAP.md` 未改。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `FRONTEND-DOM-VERIFY-001`（真实 DOM 渲染验证：本目标全部前端改动的端到端确认）

- **Task**：按本仓铁律「**接线完成 ≠ 用户够得到** ⇒ 交付前必须无头量 DOM」，对 `FRONTEND-IA-001` / `HOME-ENTRY-001` / `FRONTEND-LINK-001` / PD-01·PD-03·PD-04 的全部前端改动做**真实浏览器渲染验证**（此前只有 `tsc` + 静态结构测试，**没有渲染级证据**）。
- **方法**：无头 Edge + CDP（Node 内置 WebSocket 直连，零依赖）—— 与仓库既有 `docs/evidence/_probe_*.mjs` 同范式；探针与产物按 `AGENTS.md` §6-8 落在**仓外** `C:\work\sourcecode\_scratch\probe_frontend_ia_001.mjs`（`docs/evidence/` 已被 gitignore）。
- **前置（实测）**：dev server 已在 `http://localhost:4000` 运行（node PID 10532 监听 4000）；先用 `/src/**.tsx` 直取确认 **Vite 服务的是工作区最新代码**。
- **Changed Files**：**无仓库文件**（本轮为只读验证；仅落 CHANGE-AUDIT 与本 Goal 的 task-state）
- **Changed Contracts / DB / Execution Path**：**无**
- **验证结果（18/18 PASS）**：
  | 段 | 判据 | 结果 |
  |---|---|---|
  | A1–A4 首页 | 六阶段入口带渲染 · 6 阶段顺序 · 当前高亮 `OBSERVE` · **行情总览 4 个区块仍在**（大盘日线/连板梯队/题材热力/最高连板） | ✅ |
  | B1–B3 侧栏 | 6 个分组按阶段顺序（真实 DOM 文本） · 含「候选」 · **组合回测仍在**（未挪位置） | ✅ |
  | C1–C2 候选列表 | `/candidates` 真实渲染（**读到 13 条候选**）· 两个筛选控件在 · **无写操作入口**（只读） | ✅ |
  | D1–D2 验证总览 | `/walk-forward` 旧预览入口在 · 三块验证卡片齐全 | ✅ |
  | F1–F6 验证域 | 稳健性=`NO_RERUN`+源为 `<select>` · OOS=`RERUN`+源与 `parameterHash` 均为 `<select>` · WFA=`PER_FOLD_RERUN`+策略/版本为 `<select>` 且 Dataset 版本为**派生展示** | ✅ |
  | E1 控制台 | 无 `No procedure found on path`（端点漏挂症状）· `consoleErrors=0` | ✅ |
- **视觉确认**：首页截图（`_scratch/shot_home.png`）确认入口带单行 6 卡、③ 观察高亮「当前」、下方行情总览未被挤压或删除。
- **探针自身的两个缺陷（已修正，如实登记）**：① 视口 800×600 时侧栏折叠为图标模式 ⇒ `[data-sidebar="menu-button"]` 取不到、误判 FAIL —— 改为 `--window-size=1600,1000`；② C2 用整页文本正则判「有写按钮」⇒ 命中**描述文案里的「转正」**而误报 —— 改为只查 `button, a[href]` 的**自身文本**。
- **探针的异步等待缺陷（已修正）**：`ValidationSourcePicker` 在 `listSearches` 未返回时渲染 loading（既无 select 也无空态）⇒ 等待条件由「有徽章」改为「有徽章 **且**（下拉 或 空态）」。
- **Regression Result**：`pnpm run check` ⇒ exit 0（本仓无文件改动）；DOM 探针 ⇒ **18/18 PASS**，exit 0。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `FRONTEND-SWEEP-001`（全站页面健康基线：33 条路由逐条实测）

- **Task**：对**全部可达路由**做一次端到端健康扫描（渲染 + 控制台 + 未捕获异常 + 最终落地路径），建立可复核的「零缺陷」基线。
- **方法**：无头 Edge + CDP 逐条 `Page.navigate`；捕获 `Runtime.consoleAPICalled(error)` 与 `Runtime.exceptionThrown`；自动 dismiss `alert/confirm`；REST 端点漏挂特征串 `No procedure found on path` 单独计数。探针在仓外 `_scratch/probe_frontend_sweep.mjs`，产物 `_scratch/probe_frontend_sweep.out.json`。
- **结果：33/33 OK，异常 0**

  | 段 | 覆盖 | 结果 |
  |---|---|---|
  | ① 数据 | `/data-health` `/datasets` `/historical-state` `/stock-sync` `/upload` `/operation-logs` | ✅ 全部渲染 |
  | ② 观察 | `/limit-up` `/market` `/sentiment-analysis` `/leader-candidates` `/sentiment-alerts` | ✅ |
  | ③ 研究 | `/research-experiments` `/candidates` `/candidates/270001` | ✅ |
  | ④ 策略 | `/strategies` `/parameter-search` `/performance` `/backtest-runs` `/backtest-compare` `/strategy-final-evaluation` `/backtest` | ✅ |
  | ⑤ 验证 | `/validation` `/{robustness,oos,walk-forward}` `/regime-report` `/walk-forward`(旧预览) | ✅ |
  | ⑥ 前向与复盘 | `/paper-trading` `/paper-trading-3570001` `/review-workbench` | ✅ |
  | 首页与兼容 | `/` · `/dataset-builder`→`/datasets` · `/strategy-editor`→`/strategies`（重定向均正确） | ✅ |

  判据：`textLen > 60`（无白屏）· `uncaught = 0` · `No procedure found = 0` · 无 React 崩溃特征（`is not a function` / `Cannot read` / `Maximum update depth`）。
- **内容抽查（渲染 ≠ 有数据，故逐页看正文）**：`/datasets` 真实读到 `first_limit_pullback` **12 个版本（最新 v8 READY）**；`/stock-sync` 真实计数（股票 100,164 / 已同步行情行 8,893,077）；`/sentiment-alerts` 3 条预警；`/market` 交易日 1,880；`/regime-report` 如实标注「技术预览 · 报告导出无后端服务（C-22/23 尚未 VALIDATED）」—— **诚实状态，非缺陷**。
- **PD-01 的真实 DOM 确认**：4 个观察页均渲染出「做实验（**需在实验中选择 Dataset 版本** —— 观察页与数据集版本不是同一坐标系）」，与 `SPEC-002` 的强制文案一致。
- **Changed Files**：**无仓库代码改动**（本轮为只读扫描；仅本审计条目与本 Goal 的 task-state）
- **Changed Contracts / DB / Execution Path**：**无**
- **发现的已知缺口（登记，不在本轮 Scope）**：`/regime-report` 的「研究报告导出」**无后端服务**（页面已如实标注）；属后端/编排范围，需另立任务。
- **Regression Result**：DOM 扫描 **33/33 OK / 异常 0**，exit 0；`pnpm run check` exit 0；`checkEolDrift --strict` = 0。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `STRATEGY-VALIDATION-STATUS-001`（补齐 FLOW-001 §3 的 ⑤→⑥ 交接缺口）

- **Task**：在策略详情页新增「**验证状态**」Tab —— 回答「这个策略版本跑过哪些验证、各自什么状态」。此前用户必须离开策略页、去 `/validation` 逐块翻找才能知道某版本是否验证过（`FLOW-001` §3 原文标注「⚠️ 缺统一状态标识」）。
- **Changed Domains**：**无**（纯前端只读汇总；未改任何业务语义）
- **Changed Files**：新增 `client/src/components/strategy/StrategyValidationStatus.tsx`；修改 `client/src/components/strategy/index.ts`（barrel）· `client/src/pages/StrategyDetail.tsx`（第 4 个 Tab）· `tests/client/src/pages/pageFlowContracts.test.ts`（+§22/§23）· `docs/product/FLOW-001-page-workflow.md`
- **Changed Contracts**：**无** —— 只消费既有只读端点 `paramSearch.list{Robustness,Oos,WalkForward}Runs`（三者的 Run 视图本就带 `strategyId`/`strategyVersion`/`status`）
- **Changed DB**：**无**
- **Changed Execution Path**：**无**（只读汇总；组件内无 `useMutation`、无任何写调用 —— 由 §22 钉死）
- **设计纪律（关键）**：① 只表示「跑没跑过 / 状态是什么」，**不表示结论好坏** —— 面板内显式声明，且源码不得出现结论性词汇（§22 断言 `最优|最佳|推荐|评级|winner|best|optimal` 全零命中）；② 三块验证的「是否重跑」口径（零重跑 / 真重跑 / 每 Fold 真重跑）逐条展示，不可互相替代；③ 稳健性/OOS 的 list 端点**不支持** `strategyId` 过滤（仅 WFA 支持）⇒ 前端拉取上限 200 后本地过滤，UI 如实标注为台账而非全量统计。
- **Regression Result**：
  - **真实 DOM 验证 11/11 PASS**（无头 Edge + CDP；Radix Tab 用 `Input.dispatchMouseEvent` **真实鼠标**，符合 PROJECT_RULES）：
    - 空态分支（`first-limit-pullback-3f-top3@1.63.0`，0 个 Run）：显示「本版本尚未跑过验证」+「前往参数搜索」CTA，**不虚构**三块行
    - 已跑过分支（`wf1-e2e-mu9dbqw6@1.0.0`，真实数据）：`稳健性 零重跑 未跑过` / `样本外 OOS 真重跑 共 2 次 COMPLETED ×2` / `Walk-Forward 每 Fold 真重跑 共 2 次 COMPLETED ×1 CREATED ×1`，三块均有「查看 →」深链
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/client/src/pages/pageFlowContracts.test.ts` ⇒ **23/23**（含新增 §22 只读+无结论词 / §23 页面挂载）
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
  - 探针：仓外 `_scratch/probe_strategy_validation_status.mjs`（11/11 PASS）
- **Baseline Impact**：`CHANGE-AUDIT` + `.agent/task-state.yaml`；`FLOW-001` §3 的 ⑤→⑥ 行由「⚠️ 缺统一状态标识」改为「✅ 已补齐」。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `RESEARCH-LOOP-001`（补齐 FLOW-001 §3 的 ⑥→② 闭环表达 —— 最后一条交接）

- **Task**：把「复盘发现 → 回到 ② 观察」这条**最后一棒**在 UI 上表达出来。此前：首页流程带名叫「研究闭环六阶段」却渲染成**直线**；`/review-workbench` **没有任何**回到 ②/③ 的链接（实查零命中）。
- **Changed Domains**：**无**（纯前端导航与文案）
- **Changed Files**：`client/src/components/research/ResearchFlowNav.tsx`（+循环说明）· `client/src/pages/ReviewWorkbench.tsx`（+闭环出口区）· `tests/client/src/pages/pageFlowContracts.test.ts`（+§24/§25）· `docs/product/FLOW-001-page-workflow.md`
- **Changed Contracts / DB / Execution Path**：**无**
- **实现要点**：① 首页流程带下方加 `data-research-flow-loop="true"` 的说明「↻ 闭环：⑥ 前向与复盘的发现 → 回到 ② 观察，形成新的研究问题」；② 复盘工作台页头之后加「闭环出口」`SectionCard`（`data-review-loop-exits="true"`），三个出口：回到 ② 观察·涨停复盘 / 回到 ② 观察·情绪分析 / 去 ③ 研究·独立实验；③ 出口描述显式声明「**本页只提供回跳，不替你下研究结论**」——避免导航被读成研究结论。
- **Regression Result**：
  - **真实 DOM 验证 4/4 PASS**（无头 Edge + CDP）：首页闭环说明文本命中；复盘工作台出口区渲染；三个 href 精确等于 `[/limit-up, /sentiment-analysis, /research-experiments]`；诚实口径文案命中
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/client/src/pages/pageFlowContracts.test.ts` ⇒ **25/25**（含新增 §24/§25）
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
  - 探针：仓外 `_scratch/probe_close_loop.mjs`（4/4 PASS）
- **Baseline Impact**：`FLOW-001` §3 的 ⑥→② 行由「⚠️ 闭环未在 UI 表达」改为「✅ 已表达」⇒ **§3 六条交接全部闭合或明确撤销**。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `FRONTEND-TAB-VERIFY-001`（Tab 交互级验证 + DOM 锚点约定）

- **Task**：把前端验证从「路由能打开」推进到「**交互能切换**」。此前只证明了页面渲染与非空，未证明 Tabs 真的可切换（Radix 只认真实鼠标，JS `.click()` 会给出**假 PASS**）。
- **Changed Domains**：**无**（纯前端锚点属性 + 验证）
- **Changed Files**：`client/src/pages/{DataHealth,Market,StrategyDetail}.tsx` · `client/src/pages/datasets/{DatasetDetail,VersionDetail}.tsx`（各 Tab 触发加 `data-tab`）· `tests/client/src/pages/pageFlowContracts.test.ts`（+§26/§27）
- **Changed Contracts / DB / Execution Path**：**无**
- **做法**：① 沿本仓既有自动化锚点约定（`data-sidebar` / `data-experiment-row`），给 **19 个 `TabsTrigger`** 补 `data-tab="<value>"` —— 否则 Radix 不把 `value` 写到 DOM，只能靠中文文案定位，脆弱；② 用 `Input.dispatchMouseEvent` **真实鼠标**逐 Tab 点击，断言 `aria-selected=true` 且对应 `[role=tabpanel]` 非空。
- **结果：15/15 PASS**（5 页 / 15 个 Tab）

  | 页面 | Tab | 结果 |
  |---|---|---|
  | `/data-health` | gates · snapshot · live · evidence | ✅ 4/4 |
  | `/market` | market · heatmap · boards | ✅ 3/3 |
  | `/datasets/120001` | overview · versions · jobs · statistics | ✅ 4/4 |
  | `/strategies/first-limit-pullback-3f-top3` | definition · run · versions · validation | ✅ 4/4 |

- **探针缺陷（已修正，如实登记）**：初版每 Tab 固定等 900ms ⇒ `/market` 的 `boards` 面板为空被判 FAIL。复查发现该 Tab 是**两跳查询**（`limitUp.getDates` → 连板统计），实测需 **~4s** 才出内容（等 4s 后 len=22778）⇒ 改**自适应等待**（面板出现可见内容即继续，上限 ~9.6s）。**是探针等待不足，不是产品缺陷。**
- **⚠️ 证据更新（修正上一轮结论）**：上一轮把「`/strategy-final-evaluation` · `/paper-trading-3570001` 收敛进策略详情标签」列为「产品取舍」——**实查为后端门槛**：两页分别调用**策略专属端点** `researchRun.getPaperTrading3570001`（专用端点）与 `researchRun.getFinalEvaluation`（**无入参**），前端**无法**自行参数化。⇒ 该项属后端范围，已从「前端可自主项」移出。
- **Regression Result**：Tab 交互扫描 **15/15 PASS**；`pnpm run check` ⇒ exit 0；`pageFlowContracts.test.ts` ⇒ **27/27**（含 §26 锚点约定、§27 验证 Tab 双锚点）；`checkEolDrift --strict` ⇒ 0；探针 `_scratch/probe_tab_interactions.mjs`。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `CONFIRM-DIALOG-001`（破坏性操作统一走 ConfirmDialog · 清除最后 2 处原生 confirm）

- **Task**：把仓库**已明文约定**但未贯彻的一致性规则补完 —— 「重操作 / 破坏性操作走统一确认对话框（`common/ConfirmDialog`），不再一点就发请求」（约定原文见 `OosValidationPanel.tsx:136-137`）。实查客户端还剩 **2 处原生 `window.confirm`**。
- **Changed Domains**：**无**（纯前端交互一致性；无业务语义变化）
- **Changed Files**：`client/src/pages/LimitUpReview.tsx`（删除涨停记录）· `client/src/pages/StrategyDetail.tsx`（换版本丢弃草稿）· `tests/client/src/pages/pageFlowContracts.test.ts`（+§28/§29）
- **Changed Contracts / DB / Execution Path**：**无**
- **为什么是「完善」而非「美化」**：原生 `window.confirm` **阻塞页面**且**无法被无头 DOM 断言**（本仓铁律要求「交付前必须无头量 DOM」）⇒ 破坏性操作此前**不可自动化验证**。改为 AlertDialog 后既可断言，也能带 `pending` 态与 `tone=danger` 的危险语义。
- **实现**：① `LimitUpReview` 记录行：`window.confirm(...)` → `setConfirmDeleteOpen(true)`，行内渲染 `ConfirmDialog`（`tone="danger"`、`pending={deleteRecord.isPending}`，标题含被删股票名与代码、说明写明「无法撤销」）；② `StrategyDetail`：`window.confirm(...)` → `pendingVersionSwitch` 状态 + `ConfirmDialog`（确认键「丢弃并切换」、`tone="danger"`）。两处均**只改确认方式，不改写操作本身**。
- **Regression Result**：
  - **真实 DOM 验证 5/5 PASS**（无头 Edge + CDP，真实鼠标；**只打开 → 取消，绝不确认**，避免删真实数据）：删除按钮存在（52 个）→ 点击弹出 `[role=alertdialog]`，文案含「删除涨停记录：贝瑞基因（000710.SZ）」与「无法撤销」→ **未触发任何原生 dialog**（`nativeDialogs=[]`）→ 点「取消」后对话框关闭
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/client/src/pages/pageFlowContracts.test.ts` ⇒ **29/29**（+§28 全客户端 `window.confirm` 零命中 · §29 两处已接 ConfirmDialog）
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
  - 探针：仓外 `_scratch/probe_confirm_dialog.mjs`（5/5 PASS）
- **验证范围如实说明**：`LimitUpReview` 的对话框路径已**真机点击验证**；`StrategyDetail` 的对话框需先制造「脏草稿」状态才可触发，本轮**未做**该交互复现 ⇒ 其正确性由 `tsc` + §29 源码断言 + **同一共享组件**的真机证据支持（非直接证据，已如实标注）。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `STATUS-MIRROR-001`（候选状态镜像表收口：补齐唯一未受守护的客户端词表）

- **Task**：自审 + 全客户端词表扫描。发现 `CandidateList.tsx`（本 Goal 早先新增）**页内硬编码**了一份候选状态闭集，注释自称「与后端 `RESEARCH_CANDIDATE_STATUSES` 同源」，但**没有任何东西守护**这条同源关系 —— 正是 `PROJECT_RULES` 警告的「闭集不同步 ⇒ 生产 tRPC 拒值」风险。
- **Changed Domains**：**无**（纯前端常量归位 + 测试）
- **Changed Files**：`client/src/lib/status.ts`（新增 `CANDIDATE_STATUS_OPTIONS` 镜像表）· `client/src/pages/candidates/CandidateList.tsx`（删除页内重复，改 import）· `tests/client/src/lib/statusVocabulary.test.ts`（+「候选状态词表」对表段）
- **Changed Contracts / DB / Execution Path**：**无**
- **做法（沿本仓既有范式，不新造）**：`statusVocabulary.test.ts` 头部已写明该范式 ——「`client/**` 不能 import 后端 / shared 运行时值（`zod` 会被打进浏览器包）⇒ 客户端只能维护**镜像表**，且**必须配一条对表测试**，否则后端词表一变、前端下拉当天静默漂移」。本任务把候选状态并入同一位置（`lib/status.ts`）并补同款「漂移哨兵」。
- **扫描结论**：客户端 `*_OPTIONS / *_VALUES / *_STATUSES` 常量共 8 处；`STRATEGY_VERSION_STATUS_OPTIONS`（statusVocabulary）· `STRATEGY_TYPE_VALUES`（strategyTypeVocabulary）· `definitionVocabulary` 等**均已有对表测试** ⇒ **候选状态是唯一未受守护的一份**，本轮补齐。
- **Regression Result**：
  - `tests/client/src/lib/statusVocabulary.test.ts` ⇒ **7/7**（原 4 + 新 3：① 与后端 `RESEARCH_CANDIDATE_STATUSES` 逐字同序一致 ② 无重复无空值 ③ 每个状态都能取到合法语义色）
  - **真实 DOM 3/3 PASS**：`/candidates` 筛选下拉存在且恰含 6 个状态、与镜像表逐字一致、真实选择 `ACCEPTED` 后筛选生效且页面无报错
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
  - 探针：仓外 `_scratch/probe_candidate_filter.mjs`（3/3 PASS）
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `A11Y-NAMES-001`（全站可访问名称扫描：清除无名的纯图标交互）

- **Task**：用真实 DOM 扫描**所有可交互元素的可访问名称**（`button` / `a[href]`：既无可见文本，也无 `aria-label` / `title` / `img[alt]`）—— 这类元素在屏幕阅读器里只读出「按钮」，也无法按语义被自动化定位。
- **Changed Domains**：**无**（纯前端无障碍属性）
- **Changed Files**：`client/src/components/SentimentAlertBell.tsx` · `client/src/pages/PaperTrading.tsx` · `tests/client/src/pages/pageFlowContracts.test.ts`（+§30/§31）
- **Changed Contracts / DB / Execution Path**：**无**
- **发现（扫描 30 条路由）**：
  | # | 位置 | 影响面 |
  |---|---|---|
  | 1 | `components/SentimentAlertBell.tsx:128`（顶栏预警铃，纯图标 + 可选未读徽章） | 🔴 **渲染在每一页的顶栏**（12 条路由同时命中），未读数为 0 时按钮**完全无名** |
  | 2 | `pages/PaperTrading.tsx:565`（模拟盘「暂停 / 恢复」纯图标按钮） | 该页 3 处命中（每行一个） |
- **修复**：① 预警铃加**状态相关** `aria-label`（`情绪预警（N 条未读）` / `情绪预警（无未读）`）+ 对应 `title`；② 暂停/恢复按钮加状态相关 `aria-label`（`暂停该模拟盘运行` / `恢复该模拟盘运行`）+ `title`。**只加属性，不改行为。**
- **Regression Result**：
  - **扫描复跑：30 条路由 → 有问题的页面 0 个**（修复前为 12 个页面 / 2 个根因）
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/client/src/pages/pageFlowContracts.test.ts` ⇒ **31/31**（+§30 预警铃状态相关名称 · §31 暂停/恢复名称）
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
  - 探针：仓外 `_scratch/probe_a11y_names.mjs`（产物 `.out.json`）
- **方法说明（可复用）**：本轮沿用「先量 DOM 找根因 → 修 → 复跑同一探针证明归零」的闭环；探针按 `data-loc`（dev 模式由 Vite 插件注入源码位置）直接定位到**文件:行**，根因 2 处而非表面 12 处。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `A11Y-FORMS-001`（表单可访问名称：30 条路由扫描 → 清零）

- **Task**：扫描 `input` / `select` / `textarea` 的**可访问名称**（排除 hidden/submit/checkbox 等）。分类：`完全无名`（无 label 关联、无 `aria-label`/`labelledby`/`title`；**只有 placeholder 不算名称**）与 `仅靠 placeholder`（弱合规）。
- **Changed Domains**：**无**（纯前端无障碍属性）
- **Changed Files**：`pages/{HistoricalState,StockSync,LimitUpReview,LeaderCandidates,ParameterSearch,RegimeReport,WalkForwardAnalysis,Dashboard}.tsx` · `components/oos/OosValidationPanel.tsx` · `tests/client/src/pages/pageFlowContracts.test.ts`（+§32）
- **Changed Contracts / DB / Execution Path**：**无**（只加 `id`/`htmlFor`/`aria-label`，不改任何取值与提交逻辑）
- **发现（扫描 30 条路由）**：`完全无名 5` + `仅靠 placeholder 17`。
  - 🔴 **最典型的一类**：`HistoricalState` / `Dashboard` / `ParameterSearch` 里**视觉上明明有标签**（`<Label>` 或 `<p>`），但**没有程序关联** ⇒ 读屏只报「编辑框」，点标签也不会聚焦该控件。属于「看起来有、实际没有」。
  - ⚠️ **不能直接用 placeholder 当名称**：其中多处 placeholder 是**示例值**（`cand-360001` / `1.0.0` / `2026-08-22` / `000300.SH` / `sec_…`）⇒ 若照抄，读屏会把「示例」当字段名。故逐个回到上下文取**真实可见标签**。
- **修复**：① `HistoricalState`（交易日 / asOf）与 `Dashboard`（选择日期）建立 `id` + `htmlFor` 关联；② 其余 12 处补 `aria-label`，文案与页面上的可见标签**逐字一致**（如「策略 ID」/「版本」/「决策起（YYYY-MM-DD）」/「基准指数代码」/「起始日期（含）」/「日期区间 · 起始」）。
- **Regression Result**：
  - **扫描复跑：完全无名 5 → 0；仅靠 placeholder 17 → 0**（30 条路由）
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `pnpm exec vitest run tests/client/src/pages/pageFlowContracts.test.ts` ⇒ **32/32**（+§32 逐文件钉住上述关联/名称）
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
  - 探针：仓外 `_scratch/probe_form_a11y.mjs`（产物 `.out.json`，含 `data-loc` 源码定位）
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `A11Y-KEYBOARD-001`（键盘可达性：可点击 chips 必须是真按钮）

- **Task**：静态扫描「挂了 `onClick` 但本身不是交互元素」的 JSX 标签（排除 button/a/input/… 与转发到原生控件的封装组件）。这类元素**键盘 Tab 不到**，键盘用户无法触发。
- **Changed Domains**：**无**（纯前端无障碍）
- **Changed Files**：`components/CandidateInsightCharts.tsx` · `components/CandidatePhaseFunnel.tsx` · `tests/client/src/pages/pageFlowContracts.test.ts`（+§33/§34）
- **Changed Contracts / DB / Execution Path**：**无**
- **发现（扫描前 4 处）**：
  | # | 位置 | 判定 |
  |---|---|---|
  | 1 | `CandidateInsightCharts` 板块筛选 chips（`<Badge onClick>` → 渲染 `<span>`） | 🔴 **真缺陷**：筛选开关键盘不可达 |
  | 2 | `CandidatePhaseFunnel` 阶段筛选 chips（同上） | 🔴 **真缺陷** |
  | 3 | `CandidateInsightCharts` 评分区间 `<Bar onClick>`（recharts SVG） | ⚠️ 有**键盘替代路径**：同页 4 个真 `<button>` 已能设置同一筛选 ⇒ 图表点击属冗余便利 |
  | 4 | `CandidateInsightCharts` 个股气泡 `<Scatter onClick>`（recharts SVG） | ⚠️ **无替代路径** ⇒ 键盘用户无法按个股筛选（见下「剩余」） |
- **修复**：两处 chips 改为 `Badge asChild` 渲染**真 `<button>`**，并加 `aria-pressed` 表达「已选」切换语义（保留原有视觉）；`onClick` 从 Badge 移到 button。阶段筛选的指引文案同步补「键盘聚焦后按回车 / 空格」。
- **Regression Result**：
  - 静态扫描：可点击非交互元素 **4 → 2**（仅剩 recharts 的 SVG 图形元素）
  - **真实键盘验证 3/3**（无头 Edge + CDP）：chips 已是 `button[aria-pressed]` ✅ · 可聚焦（`document.activeElement === chip`）✅ · **空格键触发筛选切换** ✅
  - ⚠️ **Enter 键在本 harness 无效 —— 已用对照实验判定为 harness 限制，非产品缺陷**：对**已知正常的原生 `<button>`**（主题切换）派发 Enter（`rawKeyDown` / `keyDown`+`char` 两种形态）同样不触发，而空格可触发 ⇒ 原生 `<button>` 的 Enter 语义由浏览器保证，无法在本 CDP harness 中复现。
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`pageFlowContracts.test.ts` ⇒ **34/34**（+§33 chips 必须真按钮 · §34 指引含键盘说明）；`checkEolDrift --strict` ⇒ 0
  - 探针：仓外 `_scratch/scan_clickable_tags.mjs` · `probe_chip_keyboard2.mjs` · `probe_key_control.mjs`（对照）
- **剩余（如实登记，待产品决策）**：`<Scatter onClick>`（个股筛选）**没有键盘替代路径**。补齐需要新增一个平行控件（如个股列表 / 下拉），属**产品交互决策**，不在纯前端整理范围内 ⇒ 登记为候选任务，不擅自新增入口。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `A11Y-DIALOG-FOCUS-001`（对话框键盘路径：Escape 关闭 + 焦点还原）

- **Task**：验证对话框的键盘路径 —— ① Escape 能否关闭；② 关闭后**焦点能否回到触发元素**（否则键盘用户丢失位置，只能从头 Tab）。
- **Changed Domains**：**无**（纯前端无障碍）
- **Changed Files**：`client/src/components/common/ConfirmDialog.tsx` · `tests/client/src/pages/pageFlowContracts.test.ts`（+§35）
- **Changed Contracts / DB / Execution Path**：**无**
- **发现（真实 DOM 实测）**：Escape **可以**关闭（Radix 默认行为正常）；但关闭后 `document.activeElement` 落到 **`<body>`** ⇒ 焦点丢失。
- **根因（经对照实验定位）**：`ConfirmDialog` 是**受控** AlertDialog、**没有 `AlertDialogTrigger`** ⇒ Radix 的 `triggerRef` 为空，其默认 `onCloseAutoFocus` 没有可还原的目标，直接跳过。
  - 对照组：使用 `DialogTrigger` 的 `CreateDatasetDialog`（`/datasets` 新建数据集）关闭后焦点**正常回到触发按钮** ⇒ 证明不是 Radix 或全局配置问题，而是本组件用法问题。
- **修复过程（两次失败，如实记录）**：
  1. ❌ 用 `useEffect(() => { if (!open) ref = document.activeElement }, [open])`：**点击触发按钮时 `open` 仍为 false、effect 不重跑** ⇒ 记到的永远是 `BODY`。
  2. ❌ 改为关闭态持续监听 `focusin`：仍失败（未进一步定位）。
  3. ✅ 改为在 **`onOpenAutoFocus`** 捕获 —— 此刻焦点**尚未移入内容**，`document.activeElement` 正是触发元素；再在 `onCloseAutoFocus` 中 `preventDefault()` + `target.focus()`（带 `document.contains(target)` 守卫，避免对已卸载节点调用）。
- **影响面**：`ConfirmDialog` 是共享组件 ⇒ **4 个调用点全部受益**（复盘删除 / 换版本丢草稿 / OOS 执行与取消）。
- **Regression Result**：
  - **对话框键盘探针 4/4 PASS**：真实点击打开 ✅ · **Escape 关闭** ✅ · **焦点回到触发元素**（`isTrigger=true, title="删除记录"`）✅ · 取消后记录仍在（未执行删除）✅
  - **回归探针 5/5 PASS**：点「取消」路径仍正常关闭、且仍未触发原生 dialog
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`pageFlowContracts.test.ts` ⇒ **35/35**（+§35）；`checkEolDrift --strict` ⇒ 0
  - 探针：仓外 `_scratch/probe_dialog_keyboard.mjs` · `probe_dialog_focus_control.mjs`（对照）· `probe_confirm_dialog.mjs`（回归）
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `SCOPE-002`（策略创作工作台：纯前端构建 Strategy 的契约与实现）

- **Task**：执行 `docs/architecture/SCOPE-002-strategy-authoring-workbench.md`（用户裁定六项后）。目标 = **用前端即可完整构建出 `3570001`**。
- **Changed Domains**：Strategy（新增**创作辅助**子域 `authoring`；不改既有 `strategy` / `strategyCandidate` 语义）
- **Changed Files（新增）**：`scripts/verifyStrategyAuthoringE2E.mts`（`pnpm strategy:verify-authoring`，自清理写库验收） · `server/research/strategyAuthoring/{diff,jsonPointer,presetRegistry,vocabulary,materialize,blankDraft,datasetBinding,router}.ts` · `client/src/components/strategy/PresetEditor.tsx` · `tests/server/research/strategyAuthoring/{golden3570001.ts,golden3570001,diff,materialize,jsonPointer,vocabulary,blankDraft,router,equivalence3570001}.test.ts`
- **Changed Files（改动）**：`server/research/recipeRegistry.ts`（新增 `projectStrategyRecipe` / `listStrategyRecipeProjections`，**投影收敛为唯一实现**）· `server/research/patternLibrary/threeFactorTopNStrategy.ts`（改用该唯一实现，删除内联副本）· `server/strategyDomainRouter.ts`（挂载 `authoring` 子 router）· `shared/researchContracts.ts`（+7 份 schema）· `client/src/components/strategy/{index.ts,StrategyBasicInfo.tsx}`（barrel + `strategyType` 选择器）· `client/src/pages/StrategyDetail.tsx`（新建走 canonical 空白草稿 + RECIPE/EXIT_POLICY 预设接入 + `saveDraft` 承接新建保存）
- **Changed Contracts**：**新增** `strategyDomain.authoring.{getVocabulary,getBlankDraft,materializePreset,previewDocument,saveDraft}`（5 个 procedure，**不新增 tRPC 顶层 key**，仍为 21）；**新增** shared schema：`strategyAuthoringSlotSchema` · `strategyPresetParameterValueSchema` · `strategyAuthoringBlankInputSchema` · `materializeStrategyPresetInputSchema` · `strategyAuthoringDraftOriginSchema` · `saveStrategyAuthoringDraftInputSchema` · `previewStrategyAuthoringDocumentInputSchema`
- **DB Impact**：**0 表 / 0 列 / 0 migration**（写库复用既有 `StrategyService.save`，无第二条写路径）
- **Execution Impact**：**无**（不改 simulator / backtest / evaluation / paper trading；`runTradeSimulation` 仍是唯一内核）
- **关键复用（防第二套 SoT）**：EXIT_POLICY 基座直接引用 `exitPolicyExperiments.ts#STOP_POLICY_EXPERIMENTS`；RECIPE 预设来自 `recipeRegistry`；runner 状态来自 `stateFactorRegistry`；预设 payload 一律由**既有校验器**复核（`exitPolicyDefinitionErrors` / `resolveStrategyRecipe` / `runnerBridgePolicyErrors` …）
- **设计偏差（已登记在 SCOPE-002 §9.2）**：D-1 新增 `EXIT_BASE` 槽（既有注册表存的是**完整** `ExitPolicyDefinition`）· D-3 空白草稿返回"零件"而非"已校验文档" · D-4 `saveDraft` 对既有策略**不降级状态** · D-7 单一通用 `PresetEditor` · D-8 语义 diff 默认忽略 `description`/`note`
- **Regression Result**：
  - **3570001 等价锚点（DoD 的机器判定）**：`materializePreset(exit:SL-18.1-nh3-5-20)` 与 golden `policy` **逐字段相等**；`diffAgainstVersion` 对"空白草稿 + 预设 + 用户填自由段"的产物 ⇒ **`equal: true`**；`previewDocument` ⇒ `valid: true` + 真实 fingerprint
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - `tests/server/research/strategyAuthoring` ⇒ **66/66**（8 文件）
  - `tests/client/src/components/strategy` + `pageFlowContracts` ⇒ **115/115**（7 文件）
  - 定向回归（recipeRegistry · patternLibrary · strategySchema · runWorkbenchAssembly · strategyCandidate）⇒ **326/326**（20 文件）
  - `pnpm run test:changed` ⇒ 8 失败文件 / 19 用例，**全部为既有失败集**（7 个环境依赖 + `threeFactorTopNStrategyDocument` 的 `recoveryPath` 差异，均早于本次改动并有文档登记）⇒ **零新增失败文件**
  - `node scripts/checkEolDrift.mjs --strict` ⇒ **0**
- **端到端验收（真实写库，自清理）**：`scripts/verifyStrategyAuthoringE2E.mts`（`pnpm strategy:verify-authoring`） —— `authoring.saveDraft` 新建 Draft → `strategyDomain.strategy.loadVersion` **读回真实落库文档** → `diffAgainstVersion` vs 3570001 golden ⇒ **`equal=true / differences=0 / comparedPaths=67`** → `strategyDomain.strategy.delete` 清理（实查 `strategies` / `strategy_versions` 各 0 行，`3570001` 完好）
- **浏览器实测（headless Edge + CDP，只读）**：`/strategies/new` 已**不再是 legacy 模式**（`legacyNoticeShown=false`），canonical 定义编辑器 + RECIPE(12 项) + EXIT_POLICY(7 项，含 `SL-18.1 + NEW_HIGH_3 5 → 20`) + `strategyType`(9 项) 全部渲染；选预设触发真实 `materializePreset`（响应 `issues:[]`、`runnerBridge=NEW_HIGH_3/5/20`）；点「保存」发出的 `saveDraft` 请求体含 `recipe.recipeId=first-limit-pullback-3f-top3`、`definition.exit.rules[0].policy.runnerBridge.state=NEW_HIGH_3`、`origin.kind=BLANK_CANONICAL`、`presetRefs=[RECIPE,EXIT_POLICY]`（含 presetVersion）
- **附带修复：R6 前向账户续跑缺陷**（`server/paperTrading3fTop3Runner/forward.ts` + `service.ts`）：`buildIncrement` 原先只跑 `[from, to]` 新窗口，而 `runTradeSimulation` **只有 `initialCapital`、无期初在仓/期初权益入参** ⇒ 组合从 100k 平仓起步，`mergeForwardDays` 又把账户覆盖成该次独立回测末日值 ⇒ 一旦有新交易日，6000001 的 199,036 账户会被打回约 10 万。修法 = **从基线起点重放整段再切增量**（新增纯函数 `resolveForwardRunWindow` / `partitionForwardIncrement`；`PaperForwardState` 增 `baselineStartDate`，老载荷回落 `PAPER_FORWARD_3570001_DEFAULT_BASELINE_START="2025-01-01"`）。证据：`forward.test.ts` **10/10**（+4 条 R6 回归）；既有 6090001 只读复核 `WAITING_FOR_NEW_DATA` / equity **199,036.53** 不变。
- **S7 专项页收敛（本轮完成）**：① 后端 —— `server/closedLoopBacktestRun/rawPayload.ts` 增 `listClosedLoopBacktestRunRawResults`（按 `strategyId/strategyVersion/experimentId/runIdPrefix` **原样**列取，不经旧 reconcile）；新增 `strategyVersionArtifacts.ts`（纯选择器 `selectStrategyVersionEvaluation` / `selectStrategyVersionPaperTrading` + 只读加载器）；`researchRun` 新增 **通用端点** `getStrategyVersionEvaluation` / `getStrategyVersionPaperTrading`（+ `strategyVersionCoordinatesInputSchema`），并把 `getFinalEvaluation` / `getPaperTrading3570001` **收敛为薄封装**（固定 3570001 坐标，返回形状不变）。② 前端 —— 新增 `client/src/components/strategy/StrategyVersionArtifactsTabs.tsx`，策略详情新增「最终评估 / 模拟盘」两个 Tab（按当前版本坐标查询）；两个专项页也改用通用端点。**证据**：真实库只读比对通用端点与专项端点 `promoted/baseline runId` / `evaluationDetail`（Full **129.6860%**）/ 407 日 / equity **199,036.53** / forward **WAITING_FOR_NEW_DATA** **逐字段一致**；缺坐标 ⇒ `null`（不伪造）；`strategyVersionArtifacts.test.ts` **7/7**；headless Edge 实测两个 Tab 均渲染（网络 200、无 console 错误）；`pnpm run check` 0 错；`pageFlowContracts` + client strategy **115/115**。
- **未做（如实登记）**：未在浏览器里跑通"填齐自由段 → 点保存 → 成功落库"（自由段分散在折叠面板，逐字段 DOM 输入成本高；落库等价性已由上面的 E2E 脚本用同一写入口证明）· 未动 **S7**（专项页收敛，SCOPE-002 §4.1 标注为可选；硬前置 = **R6** 前向账户续跑缺陷，仍是未修的真实缺陷）
- **GLOBAL AUDIT REQUIRED**：**NONE**（无新增表 / 无核心数据流变化 / 无既有执行路径语义变化；按 AGENTS §8 = minor）

---

## 2026-10-03 · `STRATEGY-DEFINITION-PAGE-IA-001`（策略定义页重排 + 完成度总览）

- **Task**：重新整理「策略定义」页，并补上缺失的功能（起点选择 / 完成度总览 / 预设状态可见）。
- **Changed Domains**：**Frontend**（无契约 / 无 DB / 无执行链变化）
- **Changed Files**：`client/src/pages/StrategyDetail.tsx` · `client/src/components/strategy/DefinitionProgressOverview.tsx`（新增） · `client/src/components/strategy/DefinitionFields.tsx` · `client/src/components/strategy/definitionDraft.ts` · `client/src/components/strategy/PresetEditor.tsx` · `tests/client/src/pages/strategyDefinitionPageIa.test.ts`（新增）
- **实测发现（`/strategies/new`）**：① 模式族配置**无条件置顶**，默认预填「首板股票池 · 滚动 3F」并给出"创建独立策略"按钮 —— 与"空白 canonical 起点"直接冲突（用户从没选过那个族）；② 页面同时存在**两组 strategyId / version / name 输入**（模式族面板 + 基础信息）；③ 定义 7 段默认折叠，首屏只有「未命名策略 / 信号配方 / 退出政策」三个标题，**看不出还差什么**；④ 预设槽状态（尤其**必填的信号配方**）没有任何总览 —— 缺它会退回 DEFAULT 配方。
- **重排**：① 新建时用「起点」二选一（**空白 canonical 默认** / 从模式族生成），模式族面板**只在选后者时**渲染；既有版本把模式族收进 `<details>` 折叠区（"从模式族另存新版本"，不修改当前版本）。② 策略定义 Tab 顺序改为：**基础信息 → 定义完成度 → 信号配方 → 退出政策 → 定义明细**。
- **新增功能**：`DefinitionProgressOverview` —— 7 段状态（齐 / 还差 N / 待填 / 可选）+ 预设槽状态（已选 / 待选 / 可选 / 有问题）+ 汇总（已齐 X · 还差 N 项 · 预设 X/Y）；点击芯片**展开并滚动**到对应段或预设区块。状态**只来自** `definitionSegmentStatuses`（与折叠段、保存前校验**同源**），**不另立必填表**。
- **单一来源收敛**：段 DOM 前缀 `DEFINITION_SEGMENT_DOM_PREFIX` 与跳段事件 `DEFINITION_FOCUS_SEGMENT_EVENT` / `dispatchDefinitionFocusSegment` 移入 `definitionDraft.ts`（原先前缀写死在 `DefinitionFields.tsx` 内部，概览要跳段就得再抄一份字符串 ⇒ "点概览跳不到那一段"）。
- **Changed Contracts / DB / Execution Path**：**无**
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**
  - 客户端定向（`tests/client/src/pages` + `components/strategy`）⇒ **193/193**（15 文件）
  - 新增**结构锁** `strategyDefinitionPageIa.test.ts` ⇒ **7/7**（起点二选一 · 模式族不再无条件渲染 · 概览位置 · 状态单一来源 · 空段不得显示"齐" · 预设状态并入 · 跳段单一来源）
  - **浏览器实测**（headless Edge + CDP）：新建页默认**不渲染**模式族面板、有起点二选一；概览「7 段 · 已齐 2 · 还差 2 项 · 预设 1/2 · 1 项待选」，芯片 `RECIPE=MISSING / EXIT_POLICY=OPTIONAL`；选中配方后 ⇒ `RECIPE=SET`、汇总「预设 2/2」；点「信号配方」芯片滚到 `#preset-recipe`（top=89，在视口内）；既有版本页无起点选择器、模式族在折叠区、概览「已齐 5 · 没有必填缺口」
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `STRATEGY-PRESET-DISPLAY-002`（配方改说人话：规则式中文名 + 参数可读 + 技术细节折叠）

- **Task**：用户反馈「信号配方 / 退出政策都是代码，意义不明；下面的 7 条也比较混乱」，要「像模式族那样给出很多配置选项、显式配置、参数可调」。本次**只改呈现层**（不改任何契约 / DB / 执行语义）。
- **Changed Domains**：**Frontend** + 预设**展示元数据**（后端 `presetRegistry` 增加 `displayName` / `summary` / `optionLabels`，纯展示、不参与计算）
- **Changed Files**：`server/research/strategyAuthoring/presetRegistry.ts` · `server/research/strategyAuthoring/vocabulary.ts` · `client/src/components/strategy/PresetEditor.tsx` · `client/src/pages/StrategyDetail.tsx` · `tests/server/research/strategyAuthoring/vocabulary.test.ts` · `tests/client/src/pages/strategyDefinitionPageIa.test.ts`
- **问题（用户实测反馈）**：① 配方下拉显示 **recipeId**（`first-limit-pullback-3f-top3`）与**实验编号**（`SL-18.1 + NEW_HIGH_3 5 → 20`）；② 参数下面挂着 **JSON Pointer**（`stop.anchor.stopRatio`）；③ 底部暴露**源码路径 + sha 指纹 + 原始 JSON**；④ 默认只有 6 个退出方案，"没有很多选项"。
- **改法（四条硬规则，已写进 `PresetEditor.tsx` 文件头）**：
  1. **下拉只显示「规则式中文名」** —— 名字本身把规则说清楚（`6%止损｜8%回撤保护｜破均线走｜最长20日`、`首板回踩 · 3F 评分取前 3`）；**不显示** presetId / recipeId / 实验编号；
  2. **不堆解释段落** —— `summary` 只作 `title` 悬浮提示，**不作正文渲染**；
  3. **参数只显示中文名 + 取值含义** —— `初始止损比例 = 6%`、`判定持有日 = 5 个交易日`；枚举显示中文（`NEW_HIGH_3` → **创 3 日新高**，提交仍是 canonical 值）；**不显示** JSON Pointer；
  4. **技术细节默认折叠** —— presetId / 技术名 / 预设版本 / 来源 / 内容指纹 / 生成的 JSON 全收进「技术细节」，排障时才展开。
- **新增「更多方案」**：退出政策编辑器同时提供 **`EXIT_POLICY` 组合预设（6）** 与 **`EXIT_BASE` 完整基座（46）** ⇒ 默认视图干净、需要更多选择时展开「更多方案（46）」；`PresetSelection` 因此携带**自己的 slot**，两者走同一物化入口（`origin.presetRefs[].slot` 如实记录）。
- **展示元数据的唯一来源**：中文名 / 说明 / 枚举标签由后端 `presetRegistry` 提供（复用既有 `describeStopPolicy` / `describeTrailingPolicy` 生成短规则名），经 `getVocabulary` 下发；**前端不写任何 presetId 或中文名映射**。
- **守门测试**：`vocabulary.test.ts` 新增 —— 每个预设必须有**非空中文名**、**≠ presetId**、**含汉字**；`strategyDefinitionPageIa.test.ts` 新增 4 条（8–11）—— 下拉用 `displayName`、summary 不作正文、技术细节在 `showTechnical` 之后、参数不渲染 `code`、退出编辑器含 `EXIT_BASE`。
- **Changed Contracts / DB / Execution Path**：**无**（`getVocabulary` 响应新增字段，属向后兼容的只读扩展）
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**
  - `tests/server/research/strategyAuthoring` ⇒ **70/70**（8 文件）
  - 客户端定向（`tests/client/src/pages` + `components/strategy`）⇒ **197/197**（15 文件，含新增结构锁 11 例）
  - `pnpm run test:changed` ⇒ 8 失败文件与改动前**逐一相同** ⇒ **零新增失败文件**
  - **浏览器实测**（headless Edge）：配方下拉全中文；退出政策下拉为短规则名；`更多方案（46）` 出现；参数显示 `初始止损比例 = 6%` / `快线窗口 = 5 个交易日`；`codeLabelVisible=false` / `sourcePathVisible=false` / 指纹不可见；展开「技术细节」后才出现 presetId / 来源 / 指纹；Runner 状态下拉为 12 项中文（值仍是 `NEW_HIGH_3`）
- **GLOBAL AUDIT REQUIRED**：**NONE**
### 续（同日）：7 段定义表单的字段噪音同样收口

- **问题**：`SegmentForm#Field` 会把 **canonical 路径**（`definition.entry.event.type`）与**枚举原始值**（`FIXED_RATIO` / `T_CLOSE` / `T_PLUS_1_OPEN` / `TARGET_WEIGHT`）当标签回显；另外 7 段里还有 3 处长段技术说明（后端硬约束 **L6/L7** 规则名、`TUNABLE`/`DERIVED` 语义、`bar.volumeRatio` 等字段引用语法）。用户实测反馈「下面的也比较混乱」。
- **改法**：新增 \`client/src/components/common/FieldTechnicalDetails.tsx\`（\`FieldTechnicalProvider\` / \`useFieldTechnicalDetails\` / \`FieldTechnicalToggle\` / \`TechnicalHint\`）：
  - \`SegmentForm#Field\` 的 \`name\` / \`valueKey\` **默认不渲染**，由开关统一控制；
  - 3 处长段技术说明改用 \`TechnicalHint\`（只技术模式显示）；
  - 「策略定义」页顶部一处开关，**默认关闭**。
- **命名冲突（如实记录）**：首次实现误用了 \`common/TechnicalDetails.tsx\` 这一**已存在**的组件文件名（那是既有的「工程信息折叠区」组件）⇒ 已 \`git checkout --\` 恢复原文件（现仍是 clean），本功能改名 \`FieldTechnicalDetails\`。
- **证据（headless Edge 实测）**：默认关闭时 \`pathPresent=false\` / \`ruleCodePresent=false\` / \`tunablePresent=false\` / \`rawEnumPresent=false\`；点开关后四项**全部为 true**（信息没丢，只是默认不占视野）。
- **验证**：\`pnpm run check\` 0 错；\`checkEolDrift --strict\` 0；客户端定向（\`tests/client/src/components\` + \`pages\`）⇒ **234/234**（18 文件）；\`test:changed\` ⇒ 8 失败文件与改动前逐一相同（零新增）。
---

## 2026-10-03 · `STRATEGY-DEFINITION-P1-DECLARED-ONLY-001`（③ 块删除"无执行实现"的假旋钮 + `maxPositions` 单点双写）

- **Task**：按裁定（**无执行实现就先删除**；账户风控默认不启用）实现 `FE-PLAN-003` 的 **P-1**。
- **Changed Domains**：**Frontend only**（契约 / schema / Strategy Core / 执行引擎**均未改**）
- **Changed Files**：`client/src/components/strategy/DefinitionFields.tsx`（编辑面）· `client/src/components/strategy/definitionDraft.ts`（锚点闭集）· `tests/client/src/components/strategy/definitionDraft.test.ts` · `tests/client/src/pages/strategyDefinitionPageIa.test.ts`
- **背景（四层普查）**：`position.maxSinglePosition` / `position.maxExposure` / `risk.{stopLoss,maxDrawdown,maxExposure,maxSinglePosition,maxPositions,dailyLossLimit,concentrationLimit}` **在 Strategy Core 有声明（`server/strategyCore/definition.ts:76-106`），但在执行层零实现**（`server/research/simulator` · `server/backtest` · `server/runWorkbenchAssembly` 搜这些词 0 命中；`riskSpec` 只出现在 `definition.ts` 与 `adapters/`，运行时与 capabilities 都不读）。页面上它们是**改了不生效**的假旋钮。
- **改动**：
  1. **删除编辑面**：第 5 段不再渲染「单标的仓位上限」「风控里的最多持仓数」「最大暴露（仓位）」「风控单标的上限」以及整个「扩展风控（落到 definition.risk 的具名阈值）」区块；`CostFields` 不再单独渲染「回测最大持仓数」。
  2. **改为技术细节只读清单**：新增 `data-declared-only-fields`，把这 9 个字段（含值）在**技术细节开启时**只读列出，并标注「仅声明，不参与回测」。
  3. **`maxPositions` 单一编辑点 + 双写**：第 5 段「最多同时持有」一次 `onChange` 同时写 `definition.position.maxPositions` 与 `executionAssumptions.backtestConfig.maxPositions`（后者是引擎真正读的那一份）；未填时提示"回测按 backtestConfig 生效"。依据：176 个版本里两处**零冲突**（165 个同值），故统一为单旋钮对既有版本是 no-op。
  4. **锚点闭集同步**：`DEFINITION_GAP_ANCHORS["最大同时持仓数（必填）"]` 去掉 `risk.maxPositions`；`DefinitionFieldAnchor` 类型闭集与测试闭集同步移除该成员。
- **🔴 数据面一律不动（兼容性硬约束）**：
  - **schema / validator / Strategy Core `RiskSpec` 全部保留** —— 既有文档里就有这些键（`position.maxSinglePosition` 出现在 **174/176** 个版本），删 schema 会改变派生 v1 视图 ⇒ 指纹变化 ⇒ 版本不可变闸门拒绝保存；
  - `normalizeRiskSpec()` 是**白名单归一化**，从 core 删字段 = 主动丢弃既有值。
- **Changed Contracts / DB / Execution Path**：**无**（本次不触碰执行链路 ⇒ 既有策略结果**构造性不变**）
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**
  - 客户端（`tests/client/src/components` + `pages`）⇒ **238/238**（18 文件）；其中 `definitionDraft.test.ts` **47** 例、`strategyDefinitionPageIa.test.ts` **14** 例
  - **新增 G-2/G-4 守卫**：① 单测「声明字段往返不丢」（`position.maxSinglePosition=0.3` / `position.maxExposure=0.8` / `risk={stopLoss:0.08,maxDrawdown:0.25,maxExposure:0.8}` 往返后逐字保留）；② 只读探针 `scripts/_scratch/_verify_p1_roundtrip2.mts` 对**真实 3570001 golden** 跑「定义→草稿→定义」⇒ **结构化深等于 = true**（零新增键、零丢失；此前 JSON 字符串不等只是**键顺序**差异）
  - **新增结构锁 3 条（IA 测试 12/13/14）**：编辑面不得出现这 4 个 `Field`；被删字段必须出现在 `data-declared-only-fields` 只读清单；`setMaxPositions` 必须同时写 `position` 与 `cost`
  - `pnpm run test:changed` ⇒ 8 失败文件与改动前**逐一相同** ⇒ **零新增失败文件**
- **未做（如实登记）**：**本轮浏览器实测不可用** —— 本会话后段 headless Edge 反复启动失败（dev server 正常 200、Edge 二进制在、无残留进程；三次换端口均 `ECONNREFUSED`）⇒ P-1 的验收改由**源码级结构锁 + 往返单测 + tsc** 承载，未做真实 DOM 观察。
- **GLOBAL AUDIT REQUIRED**：**NONE**
---

## 2026-10-03 · `STRATEGY-DEFINITION-P1-BLOCKS-TRUST-001`（五块骨架 + 信任层状态条）

- **Task**：实现 `FE-PLAN-003` 的 **P1** —— 「五块骨架 + 信任层」；接入 ① 选股 / ② 出场（预设已就绪）。
- **Changed Domains**：**Frontend only**（无契约 / 无 DB / 无执行链改动）
- **Changed Files**：`client/src/components/strategy/DefinitionProgressOverview.tsx`（改为五块）· `client/src/components/strategy/DefinitionTrustStatus.tsx`（新增）· `client/src/pages/StrategyDetail.tsx`（接线）· `client/src/components/strategy/index.ts`（barrel）· `tests/client/src/pages/strategyDefinitionPageIa.test.ts`
- **改动**：
  1. **七段归位到五块**：`DefinitionProgressOverview` 从「7 段平铺」改为「**5 个任务块**」（① 选股 ② 出场 ③ 仓位 ④ 成本与成交 ⑤ 可调参数），每块平铺出**该块的方案（预设）** + **该块下各字段段的状态**。映射常量 `DEFINITION_BLOCKS` 导出，供 UI 与测试共用。
     - ① 选股 ← `what` / `condition` / `when` + 预设 `RECIPE`
     - ② 出场 ← `exit` + 预设 `EXIT_POLICY`
     - ③ 仓位 ← `sizing`；④ 成本与成交 ← `cost`；⑤ 可调参数 ← `parameters`
  2. **信任层状态条（新增 `DefinitionTrustStatus`）**：三态 🟢 一致 / 🟡 变体 / ⚪ 全新。
     - **判定输入由 `StrategyDetail` 算好传入**（组件不做语义推断）：`changedPresetParams` = 逐个比对「预设暴露参数」与它自己的 `defaultValue`；`kind` = 未落库 ⇒ `UNVERIFIED`，有参数改动**或** `dirty` ⇒ `VARIANT`，否则 ⇒ `MATCH`。
     - 变体态**列出改了哪几项**（槽位 · 参数 code：默认值 → 当前值），并提供「**还原为已验证版本的参数**」（只恢复预设参数默认值，不动其它编辑）。
     - 文案明确三件事：一致 ⇒ 可直接引用该版本的评估/模拟盘；变体 ⇒ 原版本数字**不直接适用**；全新 ⇒ **尚未验证**（不拿别的版本冒名顶替）。
     - 渲染位置：策略定义 Tab 内、**定义完成度概览之前**（`{trustPanel}`）。
- **Changed Contracts / DB / Execution Path**：**无**
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**
  - 客户端（`tests/client/src/components` + `pages`）⇒ **241/241**（18 文件）
  - **新增结构锁 3 条（IA 测试 15/16/17）**：① **五块覆盖全部 7 段且每段恰好归位一次**（`DEFINITION_BLOCKS.flatMap(segments)` 与 `DEFINITION_SEGMENT_KEYS` 集合相等 + 无重复）+ 块序号 `[1..5]` 与标题逐字；② 状态条三态齐备、`data-trust-status` 存在、`{trustPanel}` 渲染在概览**之前**、含还原动作文案；③ 判定输入来自「预设默认值比对」（`changedPresetParams` / `parameter.defaultValue`）且三态表达式含 `loadedTarget === null ? "UNVERIFIED"`
  - `pnpm run test:changed` ⇒ 8 失败文件与改动前**逐一相同** ⇒ **零新增失败文件**
- **未做（如实登记）**：
  1. **浏览器实测仍不可用** —— headless Edge 继续启动失败（脚本已改为「CDP 未就绪即明确返回原因」，本轮返回 `{"ok":false,"reason":"CDP 未就绪（headless Edge 未启动）"}`）。⇒ P1 的「**首屏控件 ≤ 12**」这一条**未实测**（结构锁只能证明五块与状态条存在，不能证明控件计数），需在有可用浏览器的环境下补测。
  2. 信任层**未接后端"已验证指纹清单"** —— 按 `FE-PLAN-003` §9 R5 的降级约定，P1 用「你打开的那个版本」作基准（`loadedTarget`）；跨版本指纹比对待 P5 或后端能力就绪后再做。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `STRATEGY-DEFINITION-P4-INTERACTION-001`（交互规格收敛 I-3 / I-7 / I-8 / I-9 / I-10）

- **Task**：实现 `FE-PLAN-003` 的 **P4** —— 把 15 条交互规格里还没落地的 I-3 / I-7 / I-8 / I-9 / I-10 收敛掉（I-2 / I-4 / I-5 / I-6 / I-13 / I-14 在 P-1 / P1 已落地）。
- **Changed Domains**：**Frontend only**（无契约 / 无 DB / 无执行链 / 无 schema 改动）
- **Changed Files**：`client/src/components/strategy/DefinitionFields.tsx` · `client/src/components/common/SegmentForm.tsx` · `client/src/components/strategy/PresetEditor.tsx` · `tests/client/src/pages/strategyDefinitionPageIa.test.ts`
- **改动**：
  1. **I-3 去空词**：`PresetEditor` 的「更多方案（N）」⇒ optgroup「其余 N 个方案」+ 按钮「再显示 N 个方案」；`DefinitionFields` 的两处 `Advanced title="进阶：…"` 分别改为「单笔比例 / 固定金额」（hint 换成“哪种仓位方式下生效”）与「费用模型与执行约束」。编辑面上不再出现「更多 / 进阶 / 高级」。
  2. **I-8 ≤3 项枚举摊开点选**：新增 `SegmentForm#EnumRadio`（`role=radiogroup` + `aria-checked`，`emptyLabel={null}` 表示无空值语义，`title` 带每项的 `note`）。替换 5 处：`observationWindow.unit`(2) · `execution.quantityMethod`(3) · `execution.signalTiming`(2) · `execution.slippageModel`/`commissionModel`(3×2) · `parameters[].parameterRole`(3，原来是一个原生 `<select>`)。**≥4 项一律保持下拉**（`event.type` / `trigger.type` / `priceType` / `sizingMethod` / `executionTiming`）—— 摊开会把表单撑长。
  3. **I-9 禁止 placeholder 当标签**：`DefinitionFields` 新增局部 `MiniField`（10px 灰字标签压在控件上方）；把 10 处「只有 placeholder 说明这是什么」的控件补上可见标签 —— 出场规则的「阈值」「优先级」、买入条件的「比较值」、参数行的「参数名」「中文名」「最小值」「最大值」「步长」「候选集合」「默认值」。placeholder 只留**示例值**（`如 0.08` / `逗号分隔，如 5,10,20`）。参数行「待搜索的数值参数必须给最小/最大值」由可见提示句承担，不再塞进 placeholder。
  4. **I-10 只标可选（不逐项盖必填章）**：`SegmentForm#Field` 新增 `optional?: boolean` ⇒ 渲染灰色「可选」芯片。**口径**：本页 7 段里**多数**字段必填（NN/g：多数字段必填时应标**可选**的那几个，而不是给每个必填项盖章）⇒ 只给条件生效的两项（「单笔比例」「固定金额」）打「可选」，其余靠既有的红色「必填未填」+ 段缺口胶囊表达。
  5. **I-7 单列/有界**：`PresetEditor` 的参数格从 `md:grid-cols-2 xl:grid-cols-3`（铺满、最多三列）改为 `grid max-w-2xl gap-3 sm:grid-cols-2`（**有宽度上限**，最多两列）。
- **Changed Contracts / DB / Execution Path**：**无**（纯呈现层；草稿↔定义语义一行未动，值仍是 canonical 值，只换控件形态与显示文案）
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**（改动文件均为 LF，保持 LF）
  - 客户端定向（`tests/client/src/components` + `pages`）⇒ **246/246**（18 文件，比 P1 的 241 多 5 例，全部是新增结构锁）
  - **新增结构锁 5 条（IA 测试 18/19/20/21/22）**：① 编辑面不得含「更多方案 / 进阶： / 高级选项」且展开入口必须带数量；② **每一项 ≤3 取值的枚举，取它前面最近的容器标签必须是 `<EnumRadio`**（同时反向锁 5 个 ≥4 项枚举仍为 `<EnumSelect`）；③ `MiniField` 存在 + 9 个可见标签存在 + 4 个旧 placeholder 标签消失；④ `Field.optional` 存在且单笔比例/固定金额带 `optional`，同时「事件类型（必填）」缺口文案仍在（可选标注不许抹掉必填）；⑤ 参数格含 `max-w-2xl` 且不再有 `xl:grid-cols-3`
  - **修订既有结构锁 #10**：原断言 `PresetEditor` 含字面量「更多方案」——那正是 I-3 要删的空词 ⇒ 改为断言「其余 N 个方案」+「再显示 N 个方案」（测试跟着设计走，不是设计迁就测试）
  - `pnpm run test:changed` ⇒ 8 失败文件与改动前**逐一相同**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar` 七个环境依赖 + `threeFactorTopNStrategyDocument`）⇒ **零新增失败文件**
- **未做（如实登记）**：
  1. **浏览器实测仍不可用**（headless Edge 在本会话后段无法启动）⇒ I-7/I-8/I-9/I-10 的**真实 DOM 观感未实测**，本轮由源码级结构锁 + tsc 承载。仍需在有可用浏览器时补跑。
  2. **I-11（参数按使用频率排序）未做** —— 现有方案注册表没有“使用频率”信息，排在 **P5**（埋点后再重排），此为 `FE-PLAN-003` §8 的原定顺序，不是漏项。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `STRATEGY-DEFINITION-P2-PRESET-FAMILIES-001`（③ 仓位 / ④ 成本与成交 方案族）

- **Task**：实现 `FE-PLAN-003` 的 **P2** —— 给 ③ 仓位与 ④ 成本与成交建方案族（各 ≥3 个、参数可调、与 ①② 同构），并把零散的成本预设收编进服务端注册表。
- **Changed Domains**：**Frontend + Strategy Authoring 注册表**（**无 DB / 无执行链 / 无 Strategy Core 语义改动**）
- **Changed Files**：`server/research/strategyAuthoring/presetRegistry.ts` · `materialize.ts` · `vocabulary.ts` · `shared/researchContracts.ts`（slot 枚举）· `client/src/components/strategy/definitionFieldPatch.ts`（新增）· `client/src/pages/StrategyDetail.tsx` · `client/src/components/strategy/DefinitionProgressOverview.tsx`
- **设计要点（本轮真正的取舍）**：③④ 在定义里**没有独立载体** —— 它们就是 `definition.position.*` / `definition.execution.*` + 文档级 `executionAssumptions.*` 的若干字段。所以预设产出的**不是** canonical payload，而是一张**字段补丁**：
  1. 新增预设类型 `FieldPatchStrategyPreset`（`kind: "FIELD_PATCH"`），与 `ATOMIC` / `COMPOSITE` 并列 —— **类型上**就挡住「把它整体写进文档」；
  2. `materializePreset` 照旧按 RFC 6901 写参数 + 用**新校验器**复核（`positionPatchErrors` / `costPatchErrors`），新增错误码 `AUTHORING_FIELD_PATCH_INVALID`；
  3. 客户端 `applyDefinitionFieldPatch` 把补丁**填进草稿**（与用户手填逐字同效）⇒ C-2「一个概念只有一个编辑点」不破：草稿仍是唯一真相。
- **③ 仓位方案（4 个）**：`固定比例 20% × 最多 5 只`（REGISTERED）· `等权（各 1/N）× 最多 5 只`（REGISTERED）· `固定金额 10 万 × 最多 3 只`（REGISTERED）· `总权益比例 10% × 最多 10 只`（EXPERIMENTAL）。
- **④ 成本与成交方案（4 个）**：`A 股标准 · 100 万 · T+1 开盘`（REGISTERED）· `A 股标准 · 100 万 · T+1 收盘` · `零成本（理想化对照）` · `A 股标准 + 高滑点压力（30bp）`（后三者 EXPERIMENTAL）。费率口径与 `candidateSketchCostPreset.ts#A_SHARE_COST_PRESET` **同一组数字**（由单测逐字钉住）。
- **★ `maxPositions` 没有被拆成两个旋钮**：预设只在 `/position/maxPositions` 声明一次，落到草稿时由客户端**镜像**进 `cost.maxPositions`（= 回测配置的最大持仓数）。测试同时钉住「payload 里 `maxPositions` 字面量只出现 1 次」与「应用后两处相等」。
- **Changed Contracts**：`strategyAuthoringSlotSchema` 新增 `"POSITION"` / `"COST"`（向后兼容的枚举扩展）
- **DB / Execution Path Impact**：**无**
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**
  - 服务端 `tests/server/research/strategyAuthoring` ⇒ **新增 15 例**（`fieldPatchPresets.test.ts`）；该目录 **8 文件全过**
  - 客户端 `definitionFieldPatch.test.ts` ⇒ **9 例**（纯函数 / 只覆盖声明键 / `original` 不重建 / 双写 / 往返不丢键 / 未知键忽略）
  - IA 结构锁新增 **23 / 24**：四块各有方案编辑器且块↔方案对应；③④ 必须经 `applyDefinitionFieldPatch` 落草稿，且**不得**出现 `extra.position = payload` 这类直写
  - 定向合跑（`strategyAuthoring` + `components/strategy` + IA）⇒ **194/194（17 文件）**
- **未做（如实登记）**：浏览器实测仍不可用（headless Edge 起不来）⇒ 四个预设编辑器的**真实 DOM 观感未实测**；本轮由纯函数测试 + 源码级结构锁 + tsc 承载。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `STRATEGY-DEFINITION-P3P5-DERIVED-AND-METRICS-001`（⑤ 派生视图 + 本地用量计数）

- **Task**：实现 `FE-PLAN-003` 的 **P3**（⑤ 改派生视图）与 **P5**（度量与重排的前半）。**至此 P0 / P-1 / P1 / P4 / P2 / P3 / P5 全部落地。**
- **Changed Domains**：**Frontend only**（无 DB / 无契约破坏 / 无执行链改动）
- **Changed Files**：`client/src/components/strategy/searchParameterCandidates.ts`（新增）· `authoringUsageLog.ts`（新增）· `DefinitionFields.tsx` · `client/src/pages/StrategyDetail.tsx`

### P3 · ⑤ 改派生视图

- **做法**：⑤ 不再让人凭空写参数行，而是**投影**已选方案暴露的参数：候选 = ①–④ 各选中所选方案的参数并集（`vocabulary.presets[].parameters`）。勾选 ⇒ 往 `definition.parameters[]` 写**一行**（`parameterRole = TUNABLE`，min/max/step/中文名一律照抄预设声明的范围）。
- **C-1 不破**：本模块**没有任何参数 code 字面量清单**（结构锁钉住：不得出现 `const X_CODES = [` 形态）。
- **「同一参数不得两处定义」的实测修法**：单测一开始就抓到 **替换已声明行会丢掉 `original` 里的键**（`unit` / `description` / `derivedFrom`…）⇒ `toggleSearchParameter` 改为**已有同 code 的行就幂等返回、绝不重写**。
- **★ 死参数防火墙（本轮最重要的判断）**：查证 `server/research/parameterSearch/executor.ts` 后确认 —— **`TUNABLE` 只有被规则图引用才真正参与搜索**，否则参数搜索以 `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER` 拒绝；真实库已踩过（`cand-360001@1.0.0`：声明 3 个、引用 0 个）。而**预设参数**（`anchor.stopRatio` / `positionRatio` / `slippageBps` …）住在 policy / 文档级配置里，**不在规则图里** ⇒ 直接批量声明就是生产死参数（正是用户反复说的「假旋钮」）。
  - 因此候选一律带 `referenced` 标记（口径 = `valueType === PARAMETER_REFERENCE` 的条件 + 出场规则的 `parameter`），**未被引用的候选不可勾选**（UI 禁用 + 说明原因，函数层再兜一道 `REJECTED_UNREFERENCED`）。
  - 结论（如实登记）：要让退出政策/仓位的阈值**真的可搜**，还需补「参数引用 → policy 字段」的能力；那属**新的执行语义**，按 `AGENTS.md` §5 必须停下并报告 —— 本轮**不做**。

### P5 · 本地用量计数

- **做法**：新增 `authoringUsageLog.ts` —— 只写 `localStorage`，记 `slot / presetId → 次数` 与「参数被改了几项」+ 首末时间；接到四块选择的 `useEffect` 上。
- **为什么不接上报**：本仓**没有任何遥测基建**，这是个个人研究平台；为「两周后重排默认项」引一条上报通道，收益远小于隐私/合规代价 ⇒ 只做本机计数，并留了 `clearAuthoringUsage()`。
- **用途边界写进代码**：模块头注释明说「仅限 ≥2 周后决定默认项排序；在做出决定前不得接到任何上报通道」。
- **⚠️ 未做（如实登记）**：「>2 周数据后**重排默认项**」本身**没有做** —— 需要真实数据积累 + 产品决策，不是本轮能凭代码完成的。

- **DB / Execution Path Impact**：**无**
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**
  - 客户端定向（`tests/client/src/components` + `pages`）⇒ **271/271（20 文件）**
  - P3：`searchParameterCandidates.test.ts` **12 例** + IA 结构锁 **25 / 26**
  - P5：`authoringUsageLog.test.ts` **9 例**（含「源码里不得出现任何网络调用」的反向锁）+ IA 结构锁 **27**
  - P2：`fieldPatchPresets.test.ts` **15 例** + `definitionFieldPatch.test.ts` **9 例** + IA **23 / 24**
  - P4：IA **18–22**；P1：IA **15–17**；P-1：IA **12–14**
- **未做（如实登记）**：headless Edge 在本会话始终无法启动 ⇒ 全部 UI 观感**未做真实 DOM 实测**，由「纯函数测试 + 源码级结构锁 + tsc」承载。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `EXIT-POLICY-SLOTS-P1-001`（退出政策拆成 9 个规则槽 · 服务端槽表）

- **Task**：实现 `FE-PLAN-004` 的 **P1**。裁定（用户 2026-10-03）：① 认可「常显 3 + 折叠 5 + 研究 1」分层；② **46 个实验直接从前端删掉**（服务端保留）；③ 删 `stop.contexts` / `capitalRecycle` 编辑面；④ **不做**真实库普查。
- **背景（实测，`FE-PLAN-004` §1）**：`STOP_POLICY_EXPERIMENTS` 的 **46 个实验里 40 个只改 1 个维度**、4 个改 2 个、**2 个与基准逐字相同（SL-00 ≡ SL-08.0）**；止盈 / 到期 / 续持 / 资金循环在 46 个里**完全不变** ⇒ 那 46 个不是 46 套政策，而是 **6 个止损维度的单变量扫描**。另查出两个**假旋钮**：`stop.contexts`（5 个实验声明它，**全仓零求值器**）与 `capitalRecycle`（46/46 未用、零消费、字段与 `strongHold` 重复）。
- **Changed Domains**：**Strategy Authoring（服务端注册表/物化层）**。**无 DB / 无执行链 / 无 schema / 无前端改动**。
- **Changed Files**：`server/research/strategyAuthoring/exitPolicySlots.ts`（新增）· `tests/server/research/strategyAuthoring/exitPolicySlots.test.ts`（新增）
- **交付**：9 个槽（止损位置 · 止盈 · 到期 · 止损确认 · 止损收紧 · 止损时间表 · 分批止损 · 续持 · 研究路径），每槽「方案 + 参数」；槽与 `ExitPolicyDefinition` 字段**逐字段对应**（`stop.anchor` / `stop.confirmation` / `stop.escalation` / `stop.schedule` / `stop.reduction` / `takeProfit` / `timeExit` / `strongHold` / `recoveryPath·runnerBridge·clc2ReversalPath`）。四个原语：`mergeExitPolicyPatch` · `materializeExitPolicySlotOption` · `recognizeExitPolicySlot` · `applyExitPolicySlot`。
- **Changed Contracts**：**无**（本模块只被测试引用；P2 才会经词汇表下发到前端）
- **DB / Execution Path Impact**：**无**
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - **主证据**：46 个实验逐个「识别 → 重新物化 → 合并」**结构化深等于**（键序无关比较）⇒ 既有版本零改写（X-2）在服务端层成立
  - 越界锁：只改「止损位置」时 `stop` 其它字段 / 其它 8 个槽 / 表单不编辑的 `stop.contexts` 与 `strongHold.scaleOutRatio` **逐字保留**
  - 反向锁：槽表里**不得**出现 `contexts` 与 `capitalRecycle`（两个假旋钮）
  - 该测试文件 ⇒ **14/14**
- **🔴 测试抓到的两个真实缺陷（均已修）**：
  1. **`null` ≠ 键缺失**：patch 里的 `takeProfit: null` 会给原本没这个键的政策**新增键** ⇒ 文档 JSON 变样 ⇒ 「打开老版本→不改→保存」会派生新版本。修法：patch 要置 `null` 而原对象本来没有该键 ⇒ **跳过**。
  2. **「不启用」不能是空 patch**：空 patch 与**任何**策略都匹配 ⇒ 有规则的版本会被误判成「不启用」。修法：每个「不启用」显式置 `null`。
- **设计约束（被测试逼出来的）**：匹配判据 = patch 去掉「被参数覆盖的叶子」后逐叶相同 ⇒ 「固定阶梯 / 时间表 / 分批表」这类数组内容必须**逐元素相等**才算那个选项；**自定义阶梯会被如实判成「认不出」**，而不是静默改写成默认阶梯。
- **未做（如实登记）**：P2（前端拆 9 槽 + 删 46 个实验渲染 + 推荐组合入口）**未做**；真实 DOM 观感仍未实测（headless Edge 不可用）。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `EXIT-POLICY-SLOTS-P2-001`（退出政策拆成 9 个规则槽 · 前端接线）

- **Task**：实现 `FE-PLAN-004` 的 **P2**（前端把「出场」拆成 9 个规则槽 + 按裁定删掉 46 个实验的前端渲染）。
- **Changed Domains**：**Frontend + Strategy Authoring 传输层**（无 DB / 无执行链 / 无 Strategy Core 语义改动）
- **Changed Files**：`shared/researchContracts.ts` · `server/research/strategyAuthoring/vocabulary.ts` · `router.ts` · `client/src/components/strategy/ExitPolicySlotEditor.tsx`（新增） · `client/src/pages/StrategyDetail.tsx`
- **改动**：
  1. **词表下发槽表但不下发 patch**：前端只拿「有哪些槽 / 每槽有哪些方案 / 每个方案能调哪些参数」；结构锁反向断言词表 JSON 里不出现 `patch` 键。
  2. **两个新路由**：`recognizeExitPolicySlots`（当前 policy → 每槽 `optionId/parameters/atDefaults`；认不出 ⇒ `optionId: null`）与 `applyExitPolicySlot`（→ 新 policy；`issues` 非空则原样返回，响亮拒绝）。
  3. **前端 `ExitPolicySlotEditor`**：常显 3 槽（止损位置 / 止盈 / 到期）+ 折叠 5 槽（止损确认 / 止损收紧 / 止损时间表 / 分批止损 / 续持）+ 研究 1 槽；每槽「方案下拉 + 参数」；只提供逐槽「恢复该方案默认参数」。认不出的槽显示「本表单不识别（保持原样）」并停在空值。
  4. **删掉 `EXIT_BASE` 46 个实验的前端渲染**（裁定 2）：`EXIT_POLICY` 6 个改为「推荐组合（整套退出政策）」整包入口；46 个实验的取值已溶解进各槽（服务端注册表与 payload 一字未动）。
  5. 无退出政策时显示「先从推荐组合选一个起点」，**不合成**默认政策（不发明语义）。
- **Changed Contracts**：`exitPolicySlotIdSchema` + `applyExitPolicySlotInputSchema`（新增，向后兼容）
- **DB / Execution Path Impact**：**无**
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**
  - 定向（`strategyAuthoring` + `client/components` + `client/pages`）⇒ **385/385（31 文件）**
  - 服务端 `exitPolicySlots.test.ts` ⇒ **17 例**；IA 结构锁 ⇒ **29 例**（新增 28/29）
  - **旧结构锁 #10 按裁定改写**：原断言「`EXIT_POLICY` 与 `EXIT_BASE` 挤在同一个下拉」正是本次要拆的杂糅 ⇒ 改为断言 `EXIT_BASE` 不在筛选条件里
  - `pnpm run test:changed` ⇒ 8 失败文件与改动前**逐一相同** ⇒ **零新增失败文件**（通过数 4790 → 4809）
- **未做（如实登记）**：
  1. **信任层逐槽明细未接**：改任一槽目前只让 `dirty` 生效；「还原为已验证版本的参数」对槽不生效（需要 baseline policy 比对）⇒ 留作 P4。
  2. **真实 DOM 观感未实测**（headless Edge 起不来）。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `EXIT-POLICY-SLOTS-P3P4-001`（假旋钮只读收口 + 信任层按槽比对）

- **Task**：实现 `FE-PLAN-004` 的 **P3**（删假旋钮的只读收口）与 **P4**（信任层接线）。
- **Changed Domains**：**Frontend only**（无 DB / 无契约 / 无执行链改动）
- **Changed Files**：`client/src/components/strategy/ExitPolicySlotEditor.tsx` · `client/src/pages/StrategyDetail.tsx` · `tests/client/src/components/strategy/exitPolicyUneditedFields.test.ts`（新增） · `tests/client/src/pages/strategyDefinitionPageIa.test.ts`
- **P3 改动**：`ExitPolicySlotEditor` 增只读技术细节块（`data-exit-declared-only-fields`，走既有 `TechnicalHint` ⇒ **默认不显示**）：列出 `stop.contexts` / `capitalRecycle` 的当前值并标「仅声明，不参与回测」（全仓零求值器，`FE-PLAN-004` §1.3）。
  - 🔴 **两类必须分开**：`strongHold.scaleOutRatio` / `runnerExitAtHoldingDays` / `maxConcurrentRunners` / `replacementScoreMargin` 同样是本表单不编辑的键，但它们**会参与回测** ⇒ 标「原样保留（会参与回测）」。把它们跟着 `contexts` 一起说成「不参与回测」＝ 把真旋钮说成假旋钮（单测专门钉住这条）。
- **P4 改动**：信任层接上退出槽。
  1. **基准只取已落库文档**（`savedDocument` 里的 policy）：用本地草稿当基准的话，改完再改回去就永远不会判「变体」。
  2. **逐槽差异**：基线识别 vs 当前识别 —— 方案不同 ⇒ 一条「换方案：A → B」；方案相同但参数不同 ⇒ 逐参数一条（形如 `出场·止损位置 · 换方案：固定百分比 → ATR 倍数`）。
  3. **三态**改用合并差异 `changedDefinitionParams = 预设参数差异 + 退出槽差异`。
  4. **还原**：退出槽的「还原」＝ **整份 policy 换回打开的那个版本** —— 槽是逐字段拼出来的，逐槽回默认值拼回去**未必等于**原政策（原政策可能有本表单不表达的形状），只有整份替换才真的回到已验证的那一套。
- **Changed Contracts / DB / Execution Path**：**无**
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**；`checkEolDrift --strict` ⇒ **0**
  - 定向（`strategyAuthoring` + `client/components` + `client/pages`）⇒ **391/391（32 文件）**
  - 新增单测 `exitPolicyUneditedFields.test.ts` ⇒ **4 例**（两类标注不得混、值原样回显、无 policy 不编造）
  - IA 结构锁 ⇒ **31 例**（新增 30：两个假旋钮无编辑控件 + 如实标注；31：基准来自已落库文档 + 逐槽 diff + 整份还原）
- **未做（如实登记）**：
  1. 「还原」目前**一键同时**还原预设参数与整份退出政策，不区分用户只想还原哪一边。
  2. **真实 DOM 观感未实测**（headless Edge 起不来）—— 9 槽折叠、只读块、变体明细只由结构锁 + 纯函数测试 + tsc 承载。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `EXIT-POLICY-SLOTS-COMPACT-001`（出场块紧凑化）

- **Task**：按用户反馈把「出场规则」这块前端**紧凑化**（`FE-PLAN-004` P5）。
- **Changed Domains**：**Frontend only**（纯呈现层，无契约 / 无 DB / 无执行链改动）
- **Changed Files**：`client/src/components/strategy/ExitPolicySlotEditor.tsx` · `client/src/components/strategy/PresetEditor.tsx` · `tests/client/src/pages/strategyDefinitionPageIa.test.ts`
- **改动**：
  1. **槽编辑器一行一槽**：`标签 | 方案下拉 | 状态 | ▸ 参数（N）`。参数折叠（NN/g 第 2 层）；槽的人话问题改走 `title` 悬浮提示、不占正文；每槽不再各套卡片（分区改 `divide-y`）；状态徽标只在 `已改` / `本表单不识别` 时出现；「恢复该方案默认参数」只在参数被改过时出现。
  2. **`PresetEditor` 参数收进「调整参数（N 项）」**（I-1 的真正落地）：默认只留方案下拉；改过参数时入口显示「调整参数（8 项 · 已改 3）」；「恢复默认参数」移进折叠区。此改动**同时惠及其它块**（信号配方 / 推荐组合 / 仓位 / 成本）。
- **Changed Contracts / DB / Execution Path**：**无**（`data-*` 属性全部保留，跳转与结构锁不受影响）
- **Regression Result**：
  - `pnpm run check` ⇒ **exit 0 / 0 错**
  - 客户端定向（`components/strategy` + `pages/strategyDefinitionPageIa`）⇒ **142/142（11 文件）**
  - IA 结构锁 ⇒ **32 例**（新增 32：一行一槽 + 参数折叠 + 反例「不得再出现每槽卡片」）
- **教训（如实记）**：紧凑化时误用「从 `function SlotRow` 到 `export function ExitPolicySlotEditor`」的区间替换，把夹在两者之间的 P3 helper（`uneditedExitPolicyFields`）**一并删掉**了 —— 由 `tsc` 当场抓住并补回。同区间替换要确认区间里没有别的声明。
- **未做**：真实 DOM 观感仍未实测（headless Edge 起不来）—— 「一行一槽」的实际密度只有结构锁 + 类名断言承载。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-03 · `EXIT-POLICY-SLOTS-BASE-001`（修：不选推荐组合 ⇒ 9 槽不出现）

- **Task**：修用户实测反馈 —— 「推荐组合不选的话，9 槽好像不出来」。
- **根因**：P2 里我把槽编辑器的渲染条件写成 `currentExitPolicy === null ? 提示文字 : 编辑器`，而 `currentExitPolicy` 只从文档里已有的 `exit.rules[*].policy` 取。于是**新建/空白定义（本来就没有 policy）永远看不到 9 槽**，必须先挑一个「推荐组合」整包。这是我为了「不发明语义」而过度保守的取舍 —— 代价是把入口堵死了。
- **修法（不发明语义）**：词表下发**起步基准** `exitPolicyBasePolicy` + `exitPolicyBaseLabel`，其值**直接引用已登记实验 `SL-00` 的 policy**（46 个实验全部建在这条脊上：固定 6% 止损 / 盘中 / 破 MA5-10 / 最长 5 日 / 够强延至 10 日）。前端把渲染条件改成 `effectiveExitPolicy = 文档里的 policy ?? 词表下发的起步基准`：
  1. 有政策 ⇒ 行为与之前**逐字相同**；
  2. 没有 ⇒ 9 槽照常显示（各槽显示起步基准的取值），并给一行说明「还没有退出政策 ⇒ 下面 9 槽以「实验基准 SL-00：…」为起点；改任一槽即写成这份定义的政策」；
  3. 识别（`recognizeExitPolicySlots`）与改槽（`applyExitPolicySlot`）都用 `effectiveExitPolicy` —— 否则会「用基准显示、却拿不到基准去改」。
- **为什么引用而不是复刻**：复刻一份常量就多了一处真相；测试 18 断言 `vocabulary.exitPolicyBasePolicy` **toEqual** `STOP_POLICY_EXPERIMENTS["SL-00"].policy`，漂移即红。测试 19 断言起步基准能被**全部 9 槽**认出来（否则用户一进来就面对「不识别」）。
- **Changed Files**：`server/research/strategyAuthoring/vocabulary.ts` · `client/src/pages/StrategyDetail.tsx` · `tests/server/research/strategyAuthoring/exitPolicySlots.test.ts` · `tests/client/src/pages/strategyDefinitionPageIa.test.ts`
- **Changed Contracts / DB / Execution Path**：**无**（词表新增两个只读字段）
- **Regression Result**：`pnpm run check` ⇒ **0 错**；`exitPolicySlots.test.ts` ⇒ **19 例**；IA ⇒ **33 例**（新增 33：槽渲染条件基于 `effectiveExitPolicy`、改槽也用它、推荐组合标明「可选」、前端**不得**硬编码 policy）；两文件合跑 ⇒ **52/52**
- **未做**：本轮**未跑** `test:changed`（预算用尽）；真实 DOM 仍未实测。
- **GLOBAL AUDIT REQUIRED**：**NONE**

---

## 2026-10-04 · `STRATEGY-T74-FORMALIZATION-001`

- **Task**：按路线二把 `NEW_HIGH_3 / decisionHoldingDays=5 / extendToHoldingDays=74` 研究臂注册为独立实验，执行 OBSERVATION → HOLDOUT → Strategy Bridge，创建证据合规的正式 StrategyVersion。
- **Changed Domains**：Research Experiment（新增 T74 实验）· Strategy（新增独立 StrategyVersion + provenance）。
- **Changed Files**：`research-experiments/first-board-pullback/composite-runner-newhigh3-t74/**`（新增）· `research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts`。
- **Changed Contracts**：无新增顶层契约；复用既有 `ExperimentDefinition` / `COMPOSITE_PORTFOLIO` / OBSERVATION-HOLDOUT confirmatory protocol / `createStrategyFromEvidenceRuns`。新增的实验 ID 为 `first-board-pullback/composite-runner-newhigh3-t74`。
- **Changed DB**：无 schema / migration；新增真实 Run **2 条**、StrategyVersion **1 条**（`strategy_versions.id=3600004`）、provenance **1 条**（`strategy_research_provenance.id=690001`）。
- **Changed Execution Path**：无生产执行链改动；只新增独立实验入口与桥接创建路径。
- **实际坐标与修复**：历史坐标 `750001`（v7）元数据 READY，但当前库物理 `ds_*` 五表为空；改用当前物理重建坐标 `780001`（v8，同 73003 事件 / 同日期范围）后恢复 T80 parity。
- **OBSERVATION**：`RUN-20261004-B067637E` / COMPLETED / gate `OBSERVATION_READY`；A=`15.787690712129931%` / C=`151.0958341843399%` / trigger=`161`，与 T80-001 冻结值一致。
- **HOLDOUT**：`RUN-20261004-BF08CD36` / COMPLETED / gate `PASS` / protocol `protocol-sha256:646d8ad19f5405034287aeed712d98f315863ac44f44ebfaaba169cb707b0b4d`；Holdout A=`47.218452022540006%` → C=`105.8425817161599%`，MaxDD `17.263937983053136%` → `14.058593401437204%`。
- **Strategy Bridge**：创建 `first-limit-pullback-3f-top3-runner-t74@1.0.0`（StrategyVersion ID `3600004`，status `Draft`，definition fingerprint `a3d55c83e5de1edd6f91b0cc66949fac477155db1999a0f5f0ddd9b3bc523374`）+ provenance `690001`；证据指纹 `evi-sha256:73552dd34ca8de6a`。
- **未变化**：`first-limit-pullback-3f-top3-runner-hold20@1.0.0`（ID `3570001`、provenance `660001`）逐字段未修改；未改 simulator / canonicalMetrics / Strategy Core / Dataset schema。
- **Regression Result**：`pnpm run check` 0 错；`pnpm run test:changed` 3 failed files / 8 failed tests（`limitUp.test`、`limitUp.watch`、`threeFactorTopNStrategyDocument`；均在既有工作区失败集内且与本任务无 import/依赖关系）、1877 passed；`node scripts/checkEolDrift.mjs --strict` 0。
- **Baseline Impact**：**minor** —— 新增独立实验 entry point 与 StrategyVersion 落库；更新 `SYSTEM-BASELINE.md` / `system-manifest.yaml` 到 `v2.2.0`。
- **GLOBAL AUDIT REQUIRED**：NONE。


---

## 2026-10-04 · `ENTRY-CONDITION-SLOTS-001`

- **Task**：新增服务端权威的 `ENTRY_CONDITION` 入场规则槽，首个方案为「首板后趋势峰值回撤买点」，并把 Core / Research 双执行链、shared 契约、策略定义前端接成可复用能力。
- **Changed Domains**：`strategy` · `research/strategyAuthoring` · `frontend`。
- **Changed Files**：`server/strategyCore/{featureRegistry,runtime}.ts` · `server/research/strategySchema/definition.ts` · `server/research/recipeFeatures/pullbackFeatures.ts` · `server/research/recipeRegistryAtoms.ts` · `server/research/conditionSignal/compile.ts` · `server/research/strategyAuthoring/{entryConditionSlots,router,vocabulary}.ts` · `shared/researchContracts.ts` · `server/runWorkbenchAssembly/assemble.ts` · `client/src/components/strategy/{EntryConditionSlotEditor,DefinitionFields,definitionDraft,DefinitionProgressOverview}.tsx` · `client/src/pages/StrategyDetail.tsx`。
- **Changed Contracts**：新增派生行情字段 `peakCloseSinceEvent` / `pullbackFromEventPeakClose` / `trendHoldsMa5Ma10`；`FeatureDefinition.historyMode`（缺省 `TRAILING_BARS`，新增 `EVENT_TO_CURRENT`）；新增 `entryConditionSlotIdSchema` / `recognizeEntryConditionSlotsInputSchema` / `applyEntryConditionSlotInputSchema`；新增 `strategyDomain.authoring.recognizeEntryConditionSlots` / `applyEntryConditionSlot`；装配输入新增可选 `eventDayIndex`。
- **Changed DB**：**无 schema / migration / DDL / DML**；conditions / parameters 继续落既有 canonical JSON 与投影表。
- **Changed Execution Path**：Core 对 `EVENT_TO_CURRENT` 使用完整可见历史（MA 可使用首板日前 prefix）；声明式条件编译支持 `eventDayIndex`；若文档声明 `entry.trend_pullback.*` 但 Core 不可用，抛 `LOOP_RUN_ENTRY_CONDITION_CORE_REQUIRED`，不回落 legacy recipe；旧文档 / 旧条件语义不变。
- **Potential Baseline Drift**：无；新增 `entry.trend_pullback.*` 命名空间仅对新选槽版本生效，旧版本不自动升级、不回填。
- **Regression Result**：`pnpm run check` 0 错；定向 47 文件 / 561 用例全绿；`node scripts/checkEolDrift.mjs --strict` 0；`pnpm run test:changed` 结果中 3 个已知无关失败文件（`limitUp` / `limitUp.watch` / `threeFactorTopNStrategyDocument`）保持既有失败集。
- **Baseline Impact**：**minor** —— 新增 `ENTRY_CONDITION` entry point、shared contract 与可复用 slot registry；更新 `SYSTEM-BASELINE.md` / `system-manifest.yaml` 到 `v2.3.0`。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-04 · `STRATEGY-3600005-FINAL-EVALUATION-001`

- **Task**：修正 T74 桥接生成文档缺失的 3F 条件 / 分层仓位 / `candidateExitPolicy`，创建修正版 StrategyVersion `2.0.0`，并执行最终评估。
- **Changed Domains**：Strategy（修正版 + provenance）· Evaluation（最终评估留档）。
- **Changed Files**：`scripts/runStrategyT74FinalEvaluation.mts`（新增）· `docs/architecture/CHANGE-AUDIT.md` · `docs/architecture/SYSTEM-BASELINE.md` · `docs/architecture/system-manifest.yaml`。
- **Changed Contracts**：无新增顶层契约；复用现有 StrategyDocument / closed_loop_backtest_run / evaluationDetail 载荷。
- **Changed DB**：无 schema / migration；新增 StrategyVersion `3600005`（`first-limit-pullback-3f-top3-runner-t74@2.0.0`，Draft，fingerprint `f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c`）、provenance `690002`；旧 `3600004@1.0.0` 标记 `Retired`；新增评估留档 `6210005` / `6210006`。
- **Changed Execution Path**：无 simulator / canonicalMetrics / Strategy Core 改动。修正后的文档包含 3 条 entry conditions、`EQUITY_RATIO` 分层仓位、`candidateExitPolicy=DISABLED` 与 Runner T74。
- **最终评估**：Full baseline 1.62.1=`15.787690712129931%` / T74=`151.0958341843399%`；MaxDD `54.80801079322579%` → `43.302944323482485%`；Runner trigger=`161`；OOS full-run equity slice `43.45785336542358%` → `89.48123527626247%`。isolated HOLDOUT 独立重跑仍为 `47.218452022540006%` → `105.8425817161599%`，两种口径不得混称。
- **端点验证**：`loadStrategyVersionEvaluation({strategyId:"first-limit-pullback-3f-top3-runner-t74",strategyVersion:"2.0.0"})` ⇒ baseline `6210005` / promoted `6210006`，任务 `STRATEGY-3600005-FINAL-EVALUATION-001`。
- **未变化**：`3570001` / provenance `660001` 未修改；未改数据库 schema；未进入模拟盘 / Production。
- **Regression Result**：`pnpm run check` 0 错；最终评估真实落库 + 只读端点选择 PASS；`node scripts/checkEolDrift.mjs --strict` 0。`test:changed` 的既有 3 个无关失败文件不在本任务依赖链。
- **Baseline Impact**：**minor** —— 本任务修正版与最终评估已登记；当前 `SYSTEM-BASELINE.md` 的 `v2.3.0` 头由并发 `ENTRY-CONDITION-SLOTS-001` 会话持有，未覆盖其内容；本任务以本 CHANGE-AUDIT 条目为准。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-04 · `STRATEGY-3600005-EVAL-CONTRACT-REPAIR-001`

- **Task**：修复最终评估留档 `6210005` / `6210006` 的 `resultJson`，使标准闭环详情读取符合当前 `ClosedLoopRunResult` 契约。
- **根因**：评估生成时复用了历史 `5970002` 的旧式 `stages/wiring/assembly` 模板；现行 schema 要求 stage 含 `outputKind` / `outputHandoffFingerprint` / `blocked`，且 wiring / assembly 字段形状已升级。
- **Changed DB**：无 schema / migration；仅重写既有 `6210005` / `6210006` 两行 `resultJson`，保留原 `evaluationDetail`。
- **修法**：重建为当前契约下的 14-stage 最小闭环结果：前 5 阶段 `EXECUTED`、其余 `SKIPPED`；补齐合法 `overall` / `runnerInjected` / `wiring` / `assembly` / `blockedSummary`。
- **验证**：`closedLoopRunResultSchema.safeParse` 两行均 PASS；`getClosedLoopBacktestRun(6210006)` 返回 `resultIssue=null`、`result` 非空、14 stages；`loadStrategyVersionEvaluation(2.0.0)` 仍选中 baseline `6210005` / promoted `6210006`，Full T74=`151.0958341843399%`、Runner trigger=`161`。
- **Changed Files**：`scripts/runStrategyT74FinalEvaluation.mts`（生成器改为直接构造当前 contract 的 result，不再复制旧模板）。
- **补充修复（明细可渲染）**：`backtest` stage output 恢复真实 `equityCurve` 与 `trades`，`tradesTruncated=false`；前端 `buildClosedLoopRunViewModel` 实测 promoted 行返回 `trades=1434`、`equityCurve=1863`，首个成交与末日权益点可读。
- **Baseline Impact**：NONE。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-04 · `COMPARE-DETAILS-UX-001`

- **Task**：修复回测对比页的成交明细/收益曲线不可用与操作可达性问题。
- **Changed Files**：`client/src/components/strategy/StrategyEvaluationTemplate.tsx`（新增收益曲线图）· `client/src/pages/BacktestCompare.tsx`（刷新同时刷新详情缓存）· `client/src/components/strategy/ClosedLoopRunResultPanel.tsx`（交易详情入口移至 sticky 左列）· `tests/client/src/components/strategy/backtestTradeDetailsTable.test.ts`。
- **Changed DB**：无 schema / migration；补齐既有评估行 `6210005` / `6210006` 的 `stages[backtest].output.initialCapital=100000`，未改动指标。
- **根因**：`BacktestCompare#buildVersionCompareCurve` 要求 `initialCapital` 才能把 equity 转成累计收益率；且成交表“交易详情”原本在最右列，横向滚动后不可达。
- **验证**：批量 `getBacktests([6210005,6210006])` 返回 trades `1619/1434`、equityCurve 各 `1863` 点；曲线合并器输出 `1863` 行，两条序列各 `1863` 点；成交明细源码契约测试 **13/13**；EOL 0。
- **Baseline Impact**：NONE。
- **GLOBAL AUDIT REQUIRED**：NONE。


---

## 2026-10-04 · `STRATEGY-TREND-FUSION-P0-001`（3F 选股排序 × 趋势评分融合 · P0）

- **Task**：在当前最高收益策略 `first-limit-pullback-3f-top3-runner-t74@2.0.0` 之上加「趋势评分」，**P0 只做选股排序融合**：把候选排序值从纯 3F 合成分换成 `(1-w)·3F + w·trendScore`（w = 0.2 / 0.3 / 0.5 三条臂 + 控制臂），TopN / maxPositions / 分层仓位 / SL-18.1 退出链 / Runner T74 / 数据集坐标**全部冻结**。目的不是一次性实验，而是把能力做成**前端可点击的研究实验**（后续赢家再走新 HOLDOUT 与 Strategy Bridge）。
- **Changed Domains**：`research`（趋势评分纯计算 + 组合层排序融合）· `research-experiment`（新增 P0 实验入口）· `shared`（descriptor 可选扩展）。
- **Changed Files**：
  - 新增 `server/research/recipeFeatures/trendScoreFeatures.ts`（趋势评分纯计算：结构 / 动量 / 回踩 + 加权融合；PIT 形状防线）
  - `server/research/compositeRunner/index.ts`（`BuildCompositeSourceRunInput.rankFusion` 可选融合 + `decisionWindowBarsOf` + `FusionAccounting`；缺省/null ⇒ 既有纯 3F 排序**逐字段不变**）
  - `server/researchExperiments/compositeDatasetProvider.ts`（扩展行按**臂并集**装载；缺省 = 单控制臂 ⇒ 既有行为不变）
  - `shared/researchExperimentsContracts.ts`（`compositeExecution.extensionSelectionArms` **可选**字段）
  - `server/researchExperiments/runner.ts`（把 `extensionSelectionArms` 透传给 provider）
  - 新增 `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-trend/**`（experiment / page / README）
  - `research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts`（注册：实验 + 前端页面）
  - `client/src/pages/researchExperiments/experimentModes.ts`（列表页分组归位：P0 进「多因子」，并**补登**遗漏的 `composite-runner-newhigh3-t74` 到「其他口径」）· `tests/client/src/pages/researchExperimentModeGrouping.test.ts`（分档台账 34 → 36）
  - 新增测试 `tests/server/research/recipeFeatures/trendScoreFeatures.test.ts`（20 例）· 共享夹具 `tests/server/research/compositeRunner/trendFusionFixture.ts` · `tests/server/research/compositeRunner/trendRankFusion.test.ts`（6 例）· `tests/server/researchExperiments/compositeDatasetProviderSelection.test.ts`（3 例：扩展行并集 + 公平性）· `tests/server/researchExperiments/compositeRunnerTrendFusion.test.ts`（5 例）
- **Changed Contracts**：新增 `ExperimentDescriptor.compositeExecution.extensionSelectionArms?`（可选；缺省行为与既有一致）。趋势评分**不是**平台级契约，只落在 `trendScoreFeatures.ts` 一处纯函数 + 组合执行输入的可选参数上；未新增第二套回测引擎 / 未改 Strategy Core 语义。
- **Changed DB**：**无 schema / migration / DDL / DML**（本轮未写库；实验需由用户在平台上发起 Run）。
- **Changed Execution Path**：仅**实验侧**组合执行模块新增可选排序融合；生产链（Strategy Core / simulator / canonicalMetrics）零改动。`rankFusion` 缺省 / `null` 时既有 3F 排序与账目逐字段不变（有测试锁）。
- **趋势评分 V1 与方案 V1 的一处如实偏差**：方案 V1 的结构分写作 `trendHoldsMa5Ma10`（收盘 > MA10 且 MA5 > MA10）；实测 `750001` / `780001` 的 `ds_first_limit_pullback_prefix` **只有 `relativeDay = 0`**（每事件 1 行；`post` 为 `1..80`）⇒ **没有任何 rd < 0 的预热行**，决策日（T+5）可见历史只有事件窗 6 根 ⇒ MA10 在该坐标上不可算。P0 因此把结构分定义为**事件窗内均线结构**（`收盘 > 窗内收盘均值` 且 `最近 3 根均值 > 最早 3 根均值`）。该式与动量 / 回踩阈值一样属**候选边界**：必须在训练段冻结后才允许上 HOLDOUT，调整即等于换定义（须新开臂 / 新版本）。
- **PIT**：趋势评分只读 `rd 0..决策日`（`compositeRunner#decisionWindowBarsOf`），入参多于决策窗长度时 `trendScoreFeatures` **响亮抛错**（不静默 slice）；`trendScore` 不可算的候选被**排除并计数**（`fusionDroppedCandidates`），不插补。有测试锁：改动 `rd >= 6` 的行不改变任何选中结果。
- **公平性前提（扩展行）**：融合臂可能选中与纯 3F 臂**不同**的事件；实验 descriptor 用 `extensionSelectionArms` 声明四条臂，平台 provider 按**并集**装载 `rd 17..80`，否则融合臂会在 rd16 被数据边界截断、与 Runner 语义不可比。该不变量有测试锁（臂表 ⇄ descriptor 逐项一致）。
- **未变化**：`3600005@2.0.0` / provenance `690002` / 评估留档 `6210005` / `6210006` **一字未改**；未改 `3570001`；未改 RuleGraph 语义 / 特征定义 / 执行语义；未进 Candidate / Production。
- **Regression Result**：`pnpm run check` **0 错**；本轮新增/相关测试全绿（P0 四个文件 **34 例**：`trendScoreFeatures` 20 + `trendRankFusion` 6 + `compositeDatasetProviderSelection` 3 + `compositeRunnerTrendFusion` 5；另 `manifest` 9 + 分组契约 15）；`pnpm run test:changed` = **619 passed / 5 failed**，5 例全部落在 `limitUp.watch.test` / `limitUp.test`（依赖真实库既有状态，与本任务无 import 依赖，属既有失败集）；`node scripts/checkEolDrift.mjs --strict` **0**。**顺带修复**：`researchExperimentModeGrouping` 的两条既有红灯（新增实验未归位）——本任务把 T74 与 P0 实验一并归位并同步分档台账。
- **Baseline Impact**：**minor** —— 新增独立实验 entry point（`first-board-pullback/composite-runner-newhigh3-t74-trend`）+ 一个可选 descriptor 字段；`SYSTEM-BASELINE.md` 头部当前由并发会话持有（`v2.3.0 ENTRY-CONDITION-SLOTS-001`），**本任务不覆盖其内容**，以本条目为准。
- **Next Step（不在本任务内）**：① 前端发起 EXPLORATORY Run 看四条臂；② 若某权重胜出，先在**训练段**冻结趋势评分边界，再建新 HOLDOUT 协议；③ 通过 `createStrategyFromEvidenceRuns` 建新版本（建议 `first-limit-pullback-3f-top3-runner-t74-trend@1.0.0`），**不得原地改 `3600005@2.0.0`**。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-04 · `STRATEGY-TREND-FUSION-P0-RUN-001`（P0 趋势融合 · 真实数据 EXPLORATORY Run）

- **Task**：把 `STRATEGY-TREND-FUSION-P0-001` 的实验在**真实数据**上跑一次（不是单测），给出四条臂的真实数字与诊断。
- **Changed Domains**：research-experiment（真实 Run）+ research（诊断探针）。
- **Changed Files**：`research-experiments/first-board-pullback/composite-runner-newhigh3-t74-trend/README.md`（补「当前状态」）+ 本条目 + `docs/architecture/system-manifest.yaml`。一次性驱动/探针脚本只落在 `scripts/_scratch/`（gitignore）：`runTrendFusionExploratory.mts` · `_probe_p0_trend_diagnosis.mts`。
- **Changed Contracts**：无。
- **Changed DB**：**无 schema / migration**；新增真实 Run **1 条**（`RUN-20261004-1CA33DAD`，status `COMPLETED`，datasetVersionId `780001`，createdAt `2026-10-04T00:13:05Z` → completedAt `2026-10-04T00:16:23Z`，约 215 s）。EXPLORATORY ⇒ `protocolFingerprint = null`、无 confirmatoryGate（符合契约）。
- **Changed Execution Path**：无（走平台唯一入口 `defaultExperimentRunService().execute`）。
- **Run 规模**：selectedEvents(union)=`10320`；executionRows=`1888970`；scoredCandidates(融合臂)=`43550`；fusionDroppedMissingTrend=`0`。
- **结果（C = 挂 NEW_HIGH_3 / 5 / 74；全周期）**：
  - 控制臂（纯 3F）：`151.0958341843399%` / MaxDD `43.302944323482485%` / 1434 笔
  - 融合 20%：`-59.285630163742%` / `70.43560124013597%` / 1517 笔（Δ=`-210.38146434808192 pp`）
  - 融合 30%：`-85.60011496494006%` / `88.78737103384361%` / 1562 笔（Δ=`-236.69594914927995 pp`）
  - 融合 50%：`-95.25460995611013%` / `96.03184153019659%` / 1610 笔（Δ=`-246.35044414045004 pp`）
- **控制臂 parity**：**PASS**（A `15.787690712129931%` / 1619 笔、C `151.0958341843399%` / 1434 笔、Runner 触发 `161` 笔，与 T74 留档逐项一致）⇒ 融合臂的负增量**不是坐标漂移**。
- **诊断（只读基线投影 + 纯计算，不连 DB）**：
  1. `trendScore` 太粗：43,550 个候选只有 7 个取值，`0` 占 34.39%、`1/6` 占 31.16%（≈66% 挤在两档）⇒ 融合后 TopN 边界大量由 `securityId` 破平决定。
  2. 换选剧烈：w=0.2 时 **74.2%** 的交易日选中集合发生变化（1962/5569 槽位）；w=0.5 达 **94.8%**（4131/5569）。
  3. 方向相反：选中标的平均 trendScore `0.2477 → 0.4810 / 0.6442 / 0.7703`，平均 3F `0.6647 → 0.6371 / 0.5836 / 0.5123`，收益与回撤随权重**单调恶化**。
- **结论**：P0 的 V1 趋势评分**作为排序项被否**（单调剂量-反应）。在本策略语义下「趋势越强越优先」是反向信号，系统性地挤掉了 3F 想要的「低振幅 + 低量比 + 回踩」标的。
- **未变化 / 未做**：`3600005@2.0.0` 与 `6210005`/`6210006` 一字未改；**未**建任何策略版本；**未**跑 OBSERVATION/HOLDOUT（结论已足够，且新协议需要有新假设）；**未**回改 `RUN-20261004-1CA33DAD`。
- **Regression Result**：本条目为「文档 + 真实 Run」，代码零改动 ⇒ `pnpm run check` / 测试结果与上一条 `STRATEGY-TREND-FUSION-P0-001` 相同；`node scripts/checkEolDrift.mjs --strict` 0。
- **Baseline Impact**：minor（实验运行结果登记；`SYSTEM-BASELINE.md` 由并发会话持有，未覆盖）。
- **Next Step**：若要继续追趋势，换**用法**而非权重 —— ① 门槛/过滤；② 连续化度量；③ 排名（分位）融合；④ 放到退出侧。任一新方案都新开实验/新臂。
- **GLOBAL AUDIT REQUIRED**：NONE。


---

## 2026-10-04 · `STRATEGY-TREND-GATE-P0-2-001`（趋势分门槛：只筛不改排序 · 实现 + 真实 Run）

- **Task**：按「先做门槛化试一下」实现 P0-2 —— **排序值恒为纯 3F**，趋势分只作**候选门槛**（`trendScore < minTrendScore` 剔除），并在真实数据上跑 EXPLORATORY Run。
- **Changed Domains**：research（组合层门槛能力）· research-experiment（新实验入口）。
- **Changed Files**：
  - `server/research/compositeRunner/index.ts`（`candidateGate?` + `GateAccounting`；缺省/null ⇒ 既有行为逐字段不变）
  - `shared/researchExperimentsContracts.ts`（`extensionSelectionArms[].minTrendScore?`，可选）
  - `server/researchExperiments/compositeDatasetProvider.ts`（门槛臂同样按并集装载扩展行）
  - 新增 `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-trend-gate/**`（experiment / page / README）
  - 注册：`research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts` · `client/src/pages/researchExperiments/experimentModes.ts`（multi-factor）
  - 测试：新增 `tests/server/research/compositeRunner/trendGate.test.ts`(5) · `tests/server/researchExperiments/compositeRunnerTrendGate.test.ts`(4)；扩 `compositeDatasetProviderSelection.test.ts`(+1) 与 `trendFusionFixture.ts`；分档台账 36 → 37
- **Changed Contracts**：descriptor 的 `extensionSelectionArms[].minTrendScore`（可选，缺省无门槛）。
- **Changed DB**：无 schema / migration；新增真实 Run **1 条**（`RUN-20261004-A4573C46`，COMPLETED，datasetVersionId 780001，约 228 s）。
- **Changed Execution Path**：仅实验侧组合执行模块新增「候选门槛」；生产链零改动。
- **真实结果（C = Runner T74，全周期）**：控制臂 `151.0958341843399%` / MaxDD `43.302944323482485%` / 1434 笔（**parity PASS**）；
  门槛 ≥1/6 `-21.032936759500032%`（剔 14,976 候选，Δ `-172.12877094383992 pp`）；
  门槛 ≥1/3 `-74.32112256904414%`（剔 28,547，Δ `-225.41695675338406 pp`）；
  门槛 ≥2/3 `-75.21957612040002%`（剔 34,459，Δ `-226.31541030473994 pp`）。回撤 43% → 70–80%。
- **诊断（只读基线投影 + 纯计算）**：门槛吃掉了控制臂选股的 **24.7% / 70.1% / 87.6%**；被剔者并不明显更差
  （≥1/3 档：被剔均值 3F `0.6617` vs 留下 `0.6718`；≥2/3 档：留下 `0.6503` 反而低于被剔 `0.6667`）。
  ⇒ **alpha 集中在「每日 3F 最头部 3 名」这一极窄区间**，任何显著缩小候选池的过滤都会把选股挤到更差的排名上。
- **合并结论**：`trendScore` V1 对本策略是**反向指标** —— 作排序项（P0：−59/−86/−95%）与作门槛（P0-2：−21/−74/−75%）
  都是单调负增量。**不建议**继续调权重/阈值，也不建议反向使用（低趋势分本就是 3F 在选的方向）。
- **未变化 / 未做**：`3600005@2.0.0`、`6210005`/`6210006`、P0 Run `RUN-20261004-1CA33DAD` 全部未改；未建策略版本；未跑 OBSERVATION/HOLDOUT。
- **Regression Result**：`pnpm run check` **0 错**；定向 7 文件 **48 例全绿**（含门槛 5 + descriptor 4 + 并集 4）；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：minor（新增实验入口 + 可选契约字段 + 真实运行结果登记）。
- **GLOBAL AUDIT REQUIRED**：NONE。


---

## 2026-10-04 · `STRATEGY-TREND-SCORE-V1-FORWARD-IC-001`（趋势评分 V1 的信号质量验证）

- **Task**：先验证**度量本身**再谈用法 —— 在全候选池上测 `trendScore`（及其三个分项）与候选后验收益的关系（IC / 单调性 / 相对 3F 的增量）。
- **Changed Domains**：无（**纯只读诊断**，零生产代码改动）。
- **Changed Files**：新增 `docs/evidence/_probe_trend_score_v1_forward_ic.mts` · `docs/evidence/_analysis_trend_score_v1_forward_ic_20261004.json` · `docs/evidence/README.md`（索引）· 本条目。
  ⚠️ `docs/evidence/` 整个目录在 `.gitignore:152` 被忽略（仓库既有惯例：该目录的新增文件只在本机留存）⇒ 上面的**数字以本条目与 `docs/evidence/README.md` 为准**，换机器后探针需按同一口径重跑。
- **Changed Contracts / DB / Execution Path**：**无**（不连 DB，只读基线投影缓存工件；不改任何执行语义）。本轮未新增 Run。
- **口径**：样本 = 3F 资格候选池 43,528 个（基线投影 660001 工件，`rd-1.0.0-1-bd57f47cfcecf245`）；
  决策信息 = rd 0..5（PIT）；入场 = rd6 开盘、出场 = rdN 收盘，N ∈ {6,8,10,16}（持有 1/3/5/11 个交易日）；
  **毛收益**（不扣成本、不考虑涨跌停/停牌/T+1 冻结）；`trendScore` 只用 rd0..5。基线投影只到 rd16 ⇒ **不含 Runner 的 17..80 段**。
- **结果（Spearman IC，200 次 bootstrap 95% CI）**：
  - `trendScore`：rd8 `-0.0179`、rd10 `-0.0348`、rd16 `-0.0360`（三个视界 CI 均不含 0）
  - `structureScore`：rd10 `-0.0414`、rd16 `-0.0448`；`momentum(连续)`：rd10 `-0.0338`、rd16 `-0.0409`
  - `pullbackDepth(连续)`：rd10 `+0.0252`、rd16 `+0.0230`（**回撤越深越好**）
  - 对照 `3F 合成分`：rd10 `+0.0499`、rd16 `+0.0695`（判据本身有效，非短视界假阴性）
  - 分档均值（rd16）：`trendScore=1` 档 `-1.27%`（n=4758）vs `=0` 档 `+0.18%`（n=14798）
- **增量检验（控制 3F 秩的偏 IC）**：`trendScore` rd10 `-0.0372` / rd16 `-0.0393`；`pullbackDepth` `+0.0324` / `+0.0329`；
  与 3F 的秩相关仅 `pullbackDepth -0.14`、`structure -0.15`、`momentum -0.02` ⇒ **不是 3F 的代理，有独立信息**。
- **结论**：`trendScore` V1 **不是无用，而是符号用反** —— 它奖励的「站上窗内均线结构 + 追动量」实际为负向，
  它惩罚的「回撤深」实际为正向。这从机制上解释了 P0（−59/−86/−95%）与 P0-2（−21/−74/−75%）的单调负增量。
- **未变化 / 未做**：未改任何代码、未建策略版本、未回改 `RUN-20261004-1CA33DAD` / `RUN-20261004-A4573C46`。
- **Regression Result**：本条目零代码改动；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：NONE（证据文件按 `docs/evidence/` 既有惯例登记）。
- **Next Step（需用户裁定后才做）**：按**修正符号**重定义趋势分 v2 = 奖励「回撤深 + 涨幅小/负 + 未站上窗内均线」，
  新开实验（P1）并先看训练段；同时用偏 IC 复核是否只是把 3F 已含的信息换了个写法。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-04 · `STRATEGY-TREND-V2-P1-001`（趋势评分 v2 符号修正 + 分位融合 · 实现 + 真实 Run）

- **Task**：按 IC 验证结论做 P1 —— 把趋势分改成**符号修正版 v2**（回撤深度为正、动量与连续结构偏离为负），逐分量在当日候选内做**横截面分位**后等权，再与 3F 合成分按 `fused = (1-w)·3F + w·v2` 融合，跑真实 EXPLORATORY Run。
- **Changed Domains**：research（趋势 v2 纯计算 + 组合层分位融合）· research-experiment（新实验入口）。
- **Changed Files**：
  - 新增 `server/research/recipeFeatures/trendScoreV2Features.ts`（三方向化分量 + 融合函数；PIT 形状防线与 v1 同口径）
  - `server/research/compositeRunner/index.ts`（`candidateScoreV2?` 分位融合 + `V2FusionAccounting`；与 `rankFusion` 互斥；缺省/null ⇒ 既有行为逐字段不变）
  - `shared/researchExperimentsContracts.ts`（`extensionSelectionArms[].v2Weight?` 可选）
  - `server/researchExperiments/compositeDatasetProvider.ts`（v2 臂并集装载 + 三档旋钮互斥守卫）
  - 新增 `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-trend-v2/**`（experiment / page / README）
  - 注册：`research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts` · `client/src/pages/researchExperiments/experimentModes.ts`；分档台账 37 → 38
  - 测试：新增 `tests/server/research/recipeFeatures/trendScoreV2Features.test.ts` · `tests/server/research/compositeRunner/trendV2Fusion.test.ts` · `tests/server/researchExperiments/compositeRunnerTrendV2.test.ts`
  - `docs/evidence/_probe_trend_score_v1_forward_ic.mts`（补连续结构项 `structureGap`：rd10 IC `-0.0342`、偏 IC `-0.0352`，与二值版同向）
- **Changed Contracts**：descriptor 的 `extensionSelectionArms[].v2Weight`（可选，与 trendWeight / minTrendScore 三选一）。
- **Changed DB**：无 schema / migration；新增真实 Run **1 条**（`RUN-20261004-2B87DD65`，COMPLETED，datasetVersionId 780001，约 216 s）。
- **真实结果（C = Runner T74，全周期）**：控制臂 `151.0958341843399%` / MaxDD `43.302944323482485%` / 1434 笔（**parity PASS**）；
  v2-w20 `-14.513582406299886%`（Δ `-165.6094165906398 pp`）；v2-w35 `-57.9714721425399%`（Δ `-209.06730632687982 pp`）；
  v2-w50 `-77.27140763380005%`（Δ `-228.36724181813997 pp`）；回撤 43% → 60/70/85%。v2 臂 `droppedMissingComponents = 0`。
- **结论（三次实验合并）**：v1（IC 负）排序融合 −210 pp、v1 门槛 −172 pp、**v2（IC 正、符号修正 + 分位）−166 pp**。
  v2 的分量在全候选池上 IC 为正（偏 IC 亦为正）却仍然打崩 ⇒ **不是信号方向问题，而是「动选股本身就致命」**：
  策略 alpha 集中在「当日 3F 最头部 3 名」这一极窄集合，任何位移都摧毁它（与 P0-2 门槛吃掉 24.7% 选股即 −172 pp 一致）。
- **风险提示（新增）**：该策略对选股微扰动高度敏感 ⇒ 151% 很可能由少数大赢家贡献（肥尾依赖 / 脆弱），
  单次 Run 的好坏不足以判断任何选股层改动；推进模拟盘/生产前建议先做**赢家集中度分析**。
- **未变化 / 未做**：`3600005@2.0.0` / `6210005` / `6210006` / P0 与 P0-2 的 Run 全部未改；未建策略版本；未跑 OBSERVATION/HOLDOUT。
- **Regression Result**：`pnpm run check` **0 错**；定向 7 文件 **51 例全绿**；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：minor（新增实验入口 + 可选契约字段 + 真实运行结果登记）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-04 · `T74-WINNER-TAIL-RECALL-001`（赢家尾部结构 + 第 3 名召回诊断）

- **Task**：用户明确目标 —— 「这条策略本质就是抓住几只收益超级高的股票，我想能抓住更多这种股票」。据此做两项只读诊断：(a) 控制臂赢家尾部结构；(b) 每日 3F 第 1/2/3 名各自的「超级票密度」（第 3 名因 `maxDailyBuys=2` 从未被买入）。
- **Changed Domains**：无（纯只读诊断；零生产代码改动）。
- **Changed Files**：新增 `scripts/_scratch/_probe_t74_winner_tail.mts`（写 `docs/evidence/_analysis_t74_winner_tail_20261004.json`）· `scripts/_scratch/_probe_t74_rank_slot_recall.mts`（写 `docs/evidence/_analysis_t74_rank_slot_recall_20261004.json`）· 本条目。⚠️ `docs/evidence/` 被 `.gitignore:152` 忽略 ⇒ **数字以本条目为准**。
- **Changed Contracts / DB / Execution Path**：无（只 SELECT / 只读缓存工件 + 内存重放）。
- **口径**：控制臂 = `first-limit-pullback-3f-top3` + `c6-b4-14` 组合装配 + Runner T74，真实 provider（780001 / 660001）与真实 simulator；复现 `151.0958341843399%`（parity ✓）。
- **结果 ①：赢家尾部（1429 笔已实现交易，净收益口径）**：
  - top-1 交易贡献 **19.53%**、top-5 **75.10%**、**top-10 119.07%** 的总净利；**去掉 top-10 后净利 = −36,014 元（整体亏损）**
  - 仅 **9 笔 ≥ +50%**（占 0.63%）贡献 **113.72%** 净利；**2 笔 ≥ +100%** 贡献 43.16%；最大单笔 +130.45%
  - 中位交易 **−1.32%**，胜率 **38.56%**，p95 +15.63%；大赢家分布在 2019/2020/2022/2024/2025/2026（约 1 只/年）
  - 入场日买入笔数：**1 笔 649 天 / 2 笔 390 天**（`maxDailyBuys=2`、`maxPositions=5`）
  - 交易名次分布：**rank1 = 1037 笔、rank2 = 392 笔、rank3 = 0 笔**（第 3 名从未被买入）；两笔 +100% 都是 rank1
- **结果 ②：第 3 名召回（每日 top-3 各自的「曾经成为超级票」密度；maxGain = rd6 开盘 → rd6..80 最大收盘涨幅）**：
  | 名次 | n | 中位 maxGain | ≥+30% | ≥+50% | ≥+100% | ≥+200% | 最大 |
  |---|---|---|---|---|---|---|---|
  | rank1 | 1862 | 13.50% | 22.72% | 10.63% | **3.11%** | 0.48% | +285.6% |
  | rank2 | 1855 | 13.43% | 24.47% | 11.70% | **3.77%** | 0.70% | +507.2% |
  | rank3 | 1850 | 13.04% | 23.51% | 11.24% | **2.38%** | 0.27% | +312.5% |
  ⇒ **第 3 名与第 1/2 名的超级票密度基本同档**（≥+50% 约 11%、≥+100% 约 2.4–3.8%），但**从未被买入**。
- **结论**：① 该策略是**极端肥尾**结构（9 笔交易 = 全部利润，其余整体亏损）⇒ 三次「改排序」实验的 −166~−228 pp 摆动属于同一机制的必然结果：**换一批票就是换一注彩票**；② 「抓更多」的杠杆**不在排序层，而在买入名额/持仓上限**：每日 top-3 已被证明同质，却只买 2 个（且 649/1039 个入场日只买 1 个）。
- **口径边界（重要）**：maxGain 是**潜在**涨幅，不等于策略实现收益（策略自身有止损/移动止盈/持有上限，实际只能吃到其中一部分）；但**名次间的相对比较有效** ⇒ 「第 3 名同样值得买」这一结论成立。
- **未变化 / 未做**：未改任何策略定义、未建策略版本、未回改任何历史 Run；**未**执行「放开买入名额」的变体回测（P2 待裁定）。
- **Regression Result**：本条目零代码改动 ⇒ 与上一条一致（`pnpm run check` 0 错 / `checkEolDrift --strict` 0）。
- **Baseline Impact**：NONE（证据按 `docs/evidence/` 惯例登记）。
- **Next Step（需裁定）**：P2 = **保持 3F 排序与候选池不变，只放开买入名额**（`maxDailyBuys` 2→3；`maxPositions` 5→6/8 两档）并跑真实回测，看「同质第 3 名」能否把潜在超级票转化为实现收益，以及是否被稀释/回撤放大。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-04 · `T74-SLOTS-P2-001`（只放开买入名额 / 持仓上限 · 实现 + 真实 Run）

- **Task**：用户目标为「抓住更多超级股票」。据赢家尾部 + 第 3 名召回诊断（见 `T74-WINNER-TAIL-RECALL-001`），做 P2 = **只放开执行容量**（`maxDailyBuys` 2→3、`maxPositions` 5/8/12），选股/排序/候选池/退出链/Runner/数据坐标逐字段冻结。
- **Changed Domains**：research-experiment（新实验入口）。**生产代码零改动** —— `maxDailyBuys` / `maxPositions` 是官方已参数化的执行容量旋钮（`strategyFamilyRegistry`）。
- **Changed Files**：新增 `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-slots/**`（experiment / page / README）· 注册（`research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts` · `client/src/pages/researchExperiments/experimentModes.ts`，other-scope）· 新增测试 `tests/server/researchExperiments/compositeRunnerT74Slots.test.ts` · 分档台账 38 → 39 · 本条目。
- **Changed Contracts / DB**：无契约变更；无 schema / migration；新增真实 Run **1 条**（`RUN-20261004-704FFBD9`，COMPLETED，780001，约 149 s）。
- **真实结果（C = Runner T74，全周期）**：控制臂 `151.0958341843399%` / MaxDD `43.302944323482485%` / 1434 笔 / **≥+50% 共 9 笔** / ≥+100% 2 笔 / 最大单笔 `+130.45%`（parity PASS）；
  `slots-3-5` `119.08976286746005%`（Δ `-32.006071316879854 pp`，≥+50% 仍 **9** 笔）；
  `slots-3-8` `16.155014205388007%`（Δ `-134.9408199789519 pp`，≥+50% **11** 笔，MaxDD 56.27%）；
  `slots-3-12` `-1.5486293604560442%`（Δ `-152.64446354479594 pp`，≥+50% **15** 笔，MaxDD 54.29%）。
- **结论**：① 只多买第 3 名而不加仓位 ⇒ **超级票笔数一条没多、收益 −32pp**（同预算下赢家仓位被摊薄）；
  ② 同时放开仓位 ⇒ 超级票笔数 9 → 11 → 15（目标方向有效），但**总收益 151% → 16% / −1.5%**、回撤恶化 ⇒ **多出来的仓位主要买到亏损票**；
  ③ 四条臂**最大单笔收益几乎相同（+130.4%）** ⇒ 放开名额**没有抓到新的同级别赢家**，只是稀释了原赢家。
- **推出的新假设**：召回诊断显示 rank1/rank2 各有 ~10.6% / 11.7% 的票曾涨过 +50%，按比例估算入场票里 ≈ **156 只**曾有 ≥+50% 潜在空间，但**仅 9 只实现 ≥+50%** ⇒ 缺口更可能在**退出/持有政策把赢家提前砍掉**，而不是买入名单。
- **未变化 / 未做**：未改任何策略定义、未建策略版本、未回改历史 Run；**未**执行退出/持有变体（P3 待裁定）。
- **Regression Result**：`pnpm run check` **0 错**；定向 4 文件 **32 例全绿**（含新 descriptor 测试）；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：minor（新增实验入口 + 真实运行结果登记）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-04 · `T74-TOP5-SUPERSTOCK-POOL-001`（top1–top5 超级票密度 + T+6 落选原因 + 赢家画像）

- **Task**：回答用户的三个问题 —— ① top3 / top5 里各有多少「超级票」；② 这些票为什么在 T+6 被筛掉；③ 若要用「股票池」把超级票筛出来，靠什么特征。
- **Changed Domains**：无（纯只读诊断；零生产代码改动）。
- **Changed Files**：新增 `scripts/_scratch/_probe_t74_top5_superstock_pool.mts`（写 `docs/evidence/_analysis_t74_top5_superstock_pool_20261004.json`）· 本条目。⚠️ `docs/evidence/` 被 `.gitignore:152` 忽略 ⇒ **数字以本条目为准**。
- **Changed Contracts / DB / Execution Path**：**无**（provider 只读装配 + Registry 只读分页 + 内存重放）。
- **口径**：入场 = rd6 开盘；maxGain = rd6..80 最大收盘 / rd6 开盘 − 1（**潜在**口径，不含退出政策）；控制臂复现 `151.0958341843399%`（parity ✓）；ranks 4–5 用 Registry 真实扩展行（3,662 事件），ranks 6–10 只有基线 rd0..16 ⇒ 仅 ≤11 日口径。
- **① top1–top5 超级票密度（1,862 个交易日）**：
  | rank | n | 中位 maxGain | ≥+30% | ≥+50% | ≥+100% | ≥+200% |
  |---|---|---|---|---|---|---|
  | 1 | 1862 | 13.50% | 423 | 198 | 58 | 9 |
  | 2 | 1855 | 13.43% | 454 | 217 | 70 | 13 |
  | 3 | 1850 | 13.04% | 435 | 208 | 44 | 5 |
  | **top3 合计** | 5567 | — | 1312 | **623** | **172** | 27 |
  | 4 | 1840 | 13.15% | 449 | 208 | 54 | 11 |
  | 5 | 1820 | 13.62% | 473 | 214 | 60 | 12 |
  | **top5 合计** | 9227 | — | 2234 | **1045** | **286** | 50 |
  ⇒ **rank1→rank5 毫无衰减**（≥+50% 命中率 11.2–11.7%，≥+100% 2.4–3.8%）：超级票**均匀分布在前 5 名**里，不是「只有第 1 名才有」。
- **② T+6 落选原因（控制臂全周期，buy 意图 2,914 单 / 成交 2,863）**：
  - 计划层 skipped：**`MAX_POSITIONS_REACHED` = 4008（压倒性主因：满仓 5/5）** · `MAX_DAILY_BUYS_REACHED` = 105 · `BUDGET_BELOW_MIN_LOT` = 2 · `NO_NEXT_TRADING_DAY` = 3
  - 订单层被拒（51 单 = 1.75%）：`NO_LIQUIDITY` 31 · `LIMIT_DOWN` 17 · `LIMIT_UP` 2 · `OTHER` 1
  ⇒ 超级票**不是被选股/排序筛掉的**（top5 已在候选内），而是**被「没有仓位」筛掉的**；执行层只拦了 1.75%。
- **③ 赢家画像（标签 = maxGain ≥ +50%；样本 = top1–5 的 9,227 个候选，base rate 11.33%）**：
  按特征三分位的命中率 lift —— `maxAmplitude` 0.94/1.02/1.04 · `meanAmplitude` 0.92/1.00/1.09 · `t1VolumeRatio` 1.03/0.95/1.02 ·
  `eventRange`（首板日振幅）0.94/1.00/1.06 · `eventBody` 0.99/0.98/1.02 · `momentum` 1.04/0.98/0.98 · `turnoverRate` 1.03/1.04/0.93。
  ⇒ **现有 T+5 可见特征全部没有区分度（lift ≈ 1）** ⇒ 用「3F 三因子 + 首板日形态 + 换手」建池**筛不出超级票**。
  ⇒ 数据缺口实测：该投影里 `indexClose` 为空（**大盘状态特征不可算**）、`circulationMarketCap` 为 null（**市值特征不可用**）、无 rd<0 预热行（**首板前历史不可得**）。
- **结论（P2 + 本次诊断合并）**：① 用户「抓更多超级票」的方向成立，但**杠杆不是多买**（P2：9→15 只 ≥+50% 却把 151% 打到 −1.5%）、**也不是换排序**（三次已否）；② 主要瓶颈是**资金长期被占满**（4008 次满仓拒绝）＋**边际候选不赚钱**；③ 想要真正提高识别率，必须引入**新信息域**：市场/时点状态 → 首板前历史 → 板块/资金流 → 市值/筹码；在现有特征里继续调池子没有证据支持。
- **未变化 / 未做**：未改任何策略定义、未建策略版本、未回改历史 Run；ranks 6–10 的 74 日口径未测（需再装载一次扩展行）。
- **Regression Result**：本条目零代码改动；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：NONE。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-05 · `T74-EXIT-AND-PREEVENT-001`（#3 退出侧归因 + #2 新信息域可行性实测）

- **Task**：用户要求先做 #2（补新信息域，看能否用股票池筛出超级票）与 #3（退出侧，赢家是否被提前砍掉）。两项均为**只读诊断**，零生产代码改动。
- **Changed Files**：新增 `scripts/_scratch/_probe_t74_exit_and_preevent.mts`（写 `docs/evidence/_analysis_t74_exit_and_preevent_20261004.json`）· `scripts/_scratch/_probe_t74_top5_superstock_pool.mts`（写 `_analysis_t74_top5_superstock_pool_20261004.json`）· `scripts/_scratch/_probe_schema.mts` · 本条目。⚠️ `docs/evidence/` 被 `.gitignore:152` 忽略 ⇒ 数字以本条目为准。
- **Changed Contracts / DB / Execution Path**：**无**（只读 provider 装配 + Registry/stock_daily_prices 只读查询 + 内存重放；控制臂复现 `151.0958341843399%`）。
- **数据可得性实测（#2 的前置事实）**：`ds_first_limit_pullback_event` 含 `boardType / industryCode / turnover / marketCap / floatMarketCap / historicalLimitCount / daysSincePreviousLimit / limitUpTime`；另有 `stock_daily_prices`（全量日线历史）、`liquidity_daily`（换手/流通市值）、`industry_assignments`、`index_daily`（→ 大盘状态）、`stock_suspension_windows`。**实测为空**：`marketCap` / `floatMarketCap` / `limitUpTime` 在 v8 全为 null；`indexClose` 在该投影里为空。
- **#3 退出侧结果（1429 笔已实现交易；`maxDuringHold` = 持有期内最大收盘涨幅）**：
  | 退出类别 | 笔数 | 平均实现 | 平均持有期最大涨幅 | 平均回吐 | 曾达 ≥+50% | 该类别最大实现 |
  |---|---|---|---|---|---|---|
  | `STOP_INTRADAY`（盘中止损/移动止损） | 579 | −0.71% | 5.87% | **6.58pp** | **17** | +130.45% |
  | `TRAIL_MA_EXIT`（MA 趋势止盈） | 609 | +0.95% | 5.10% | 4.15pp | 1 | +49.77% |
  | `TIME_EXIT`（持有满 5 日） | 203 | +0.14% | 2.59% | 2.44pp | 0 | +15.48% |
  | `RUNNER_EXTENDED_EXIT`（强势续持后退出） | 38 | **+13.13%** | 17.08% | 3.95pp | 2 | +48.02% |
  - 全样本：实现 ≥+50% 者 **9 笔**，而**持有期内曾达 ≥+50% 者 20 笔** ⇒ **11 笔被提前砍掉**；
    其中 **17/20 落在 `STOP_INTRADAY`（止损/移动止损）类别**（平均回吐 6.58pp）⇒ **赢家主要死在止损/移动止损，而不是时间退出**。
  - `RUNNER_EXTENDED_EXIT` 只有 38 笔但平均 **+13.13%**（全场最好）⇒ 「让赢家活更久」方向正确，但**进入 Runner 的门槛太窄**（只有 38 笔进入）。
  - 全样本平均：实现 `+0.49%` vs 持有期最大 `+5.38%` ⇒ 平均每笔回吐约 **4.9pp**。
- **#2 新特征 lift 实测（标签 = maxGain ≥ +50%；base rate 10.97–11.33%）**：
  - **v8 事件表字段**（样本 9,227）：`turnover` 1.03/1.04/0.93 · `historicalLimitCount` 0.97/0.93/1.10 · `daysSincePreviousLimit` 1.08/1.01/0.90 · `boardType` 全为 main · `marketCap`/`floatMarketCap`/`limitUpTime` **无值**。
  - **首板前 60 日价格历史**（从 `stock_daily_prices` 逐码取数，样本 1,477，base 10.97%）：
    `prior20Return` 1.02/0.89/1.09 · `prior60Return` 0.93/1.11/0.96 · `prior60Position` 1.04/0.95/1.02 · `isNewHigh60` 1.02/0.96/1.02 · `prior5VolumeRatio` 1.00/1.02/0.98 · `historyRows` 1.04/1.00/0.96。
  - ⇒ **两条最可行的新信息域都没有实质区分度（lift 全部在 0.89–1.11）**；现有特征 + 新增前置价格历史**都筛不出超级票**。
  - **统计限度（必须说明）**：样本 1,477 / base 10.97% ⇒ 命中率标准误约 0.8pp，仅能排除 **强信号（lift ≥ ~1.3）**，不能排除弱信号（1.1–1.2）。
- **结论**：① 超级票的**识别**在现有可用数据上接近不可行（3F IC 0.05–0.07、各新特征 lift ≈1）——「抓到更多」的可行杠杆不在选股；
  ② **退出侧有明确、可量化的缺口**：20 笔曾达 ≥+50% 的票里 11 笔被砍，17/20 死在止损/移动止损；
  ③ Runner 通道（38 笔、均 +13.13%）是唯一被验证「让赢家活着」的机制 ⇒ **放宽止损/移动止损 + 扩大 Runner 进入**是下一步最该测的 P3。
- **未变化 / 未做**：未改任何策略定义、未建策略版本、未回改历史 Run；**未**执行 P3 变体回测。
- **Regression Result**：本条目零代码改动；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：NONE。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-05 · `T74-SCALEOUT-READD-CAPABILITY-001`（「高点减仓 / 低点加仓」能力盘点）

- **Task**：用户提出更贴近实盘的方案 —— **高点减仓、低点重新加仓**，要求先确认平台能否执行。本条记录**只读能力盘点**（零代码改动）。
- **Changed Files**：仅本条目（盘点无产物）。
- **平台已有（实测代码位置）**：
  - **分批止损**：退出政策 9 槽里的 `REDUCTION` 槽 + `engine.ts` 的 `stopReduction` / `partialStopScheduled`（分批卖出后 `runnerSlotUsage` 记录剩余仓位占槽）
  - **到期按比例减仓**：`StrongHoldPolicyDefinition.scaleOutRatio`（`exitPolicyCommon.ts`，在 `extendToHoldingDays` 时按比例卖出）
  - **退出后重入**：`experiments/simulator/reentry.ts` + `runWorkbenchAssembly/reentryPolicy.ts`（`securityCooldownTradingDays` / `maxEntriesPerMember` / `maxConcurrentOpenPerCode`），但只对**池成员策略**（`firstLimitPoolDailyScore`）有二次信号源
  - 部分持仓的槽占用已被引擎支持（`runnerSlotUsageBySecurity`）⇒ 「卖出部分仍保留剩余仓」这条机械能力**已具备**。
- **平台缺失（实测）**：
  - **盈利触发的分批止盈**：`TAKE_PROFIT`（固定回撤/移动止盈）在触发时**整仓卖出**；`scaleOutRatio` 只挂在 `strongHold` 的**到期点**，无法表达「涨到 +X% 卖一半」。
  - **加仓（对已持仓回补）**：全仓 grep 无 `addToPosition` / `increasePosition` / `topUp` / `positionIncreases`；`simulator/plan.ts` 的买入预算分配只面向「当前**未持仓**的候选」⇒ **「低点重新加仓」缺少执行原语**。
  - 重入机制无法替代加仓：T74 的买入信号是「每个首板事件在 T+5 出一次」，卖出后同一事件**不会再有信号** ⇒ 卖飞后不会被买回。
- **结论（供裁定）**：用户方案在**实盘**可用条件单执行（涨到 X% 卖一半 / 回落到 Y 买回），但要在**平台内**验证需要两项执行语义扩展：
  1. 把 `scaleOutRatio` 从「到期减仓」推广到「**盈利触发减仓**」（改动小，复用已有部分卖出与槽占用机制）；
  2. 新增「**加仓/回补**」意图（改动大，触及 plan/engine 预算与槽位语义）。
  两项均属 `AGENTS.md` §5「改变执行语义」⇒ **必须先裁定再实现**。
- **建议路线**：先做**离线反事实测算**（用已落盘的真实交易路径模拟「+X% 减半 / 回撤 Y% 回补」），确认有效再投入平台能力建设；否则不做。
- **Regression Result**：本条零代码改动；`node scripts/checkEolDrift.mjs --strict` **0**。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-05 · `T74-STOPWIDE-P3-001`（扩大固定止损 · 实现 + 真实 Run）

- **Task**：用户关切「把止损扩大后回撤会变得难以承受」。据此做 P3-stopwide：**只改 SL-18.1 的固定止损**（`exitPolicy.stop.anchor.stopRatio`，现役 6% → 8%/10%/12%），选股 / 名额 / 移动止损 / MA 止盈 / 时间退出 / strongHold / Runner T74 / 数据坐标逐字段冻结。
- **Changed Domains**：research-experiment（新实验入口）；**生产代码零改动**（只覆盖已有退出政策字段）。
- **Changed Files**：新增 `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-stopwide/**`（experiment / page / README）· 注册（manifest / pages / experimentModes，other-scope）· 新增测试 `tests/server/researchExperiments/compositeRunnerT74StopWide.test.ts` · 分档台账 39 → 40 · 本条目。
- **Changed Contracts / DB**：无契约变更；无 schema / migration；新增真实 Run **1 条**（`RUN-20261004-670F0677`，COMPLETED，780001，约 152 s）。
- **真实结果（C = Runner T74，全周期）**：
  | 固定止损 | C 收益 | C 最大回撤 | C 成交 | ≥+50% | ≥+100% | 亏损笔均值 | P5 分位 | 亏超 6% | 亏超 10% | 止损出场 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | 6%（控制） | 151.0958341843399% | 43.302944323482485% | 1434 | 9 | 2 | −4.131% | −6.192% | 392 | 12 | 579 |
  | 8% | 64.6355983984199% | 49.87972199584667% | 1311 | 8 | 1 | −4.259% | −8.059% | 240 | 15 | 372 |
  | 10% | 76.52933023111999% | 45.883510751136335% | 1251 | 9 | 2 | −4.374% | −10.049% | 200 | 130 | 299 |
  | 12% | 45.130% | 47.017% | 1220 | 8 | 2 | −4.446% | −12.047% | 188 | 88 | 242 |
- **结论（四输）**：① 回撤三档全部**更大**（43.30% → 49.88/45.88/47.02%）；② 收益更差（151.10% → 64.64/76.53/45.13%）；
  ③ 逐笔痛感更重（P5 从 −6.19% 到 −8.06/−10.05/−12.05%，亏超 10% 笔数 12 → 15/130/88）；④ 超级票没变多（≥+50% 笔数 9 → 8/9/8）。
  另有一处反直觉：放宽止损后**止损出场数减少**（579 → 372/299/242，改由 MA 趋势止盈/时间退出离场），但总收益仍更差 ⇒ 被 6% 止损打掉的票多数后来继续下跌。
- **合并结论（三次容量实验 + 本次）**：这条链上**没有免费降回撤的旋钮** —— 换排序（−166~−228pp）、多买（DD 43→45~56%）、扩大止损（DD 43→46~50%）全部更差。
  ⇒ 降回撤只能走**降低暴露**（每笔仓位比例 ↓ / 保留现金）或**组合层择时**（大盘状态 / 净值回撤熔断），两者均属「收益-回撤」取舍。
- **未变化 / 未做**：未改任何策略定义、未建策略版本、未回改历史 Run。
- **Regression Result**：`pnpm run check` **0 错**；定向 3 文件 **27 例全绿**；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：minor（新增实验入口 + 真实运行结果登记）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · `T74-SCALEOUT-READD-COUNTERFACTUAL-001`（高点减仓 / 低点回补 · 离线反事实）

- **Task**：用户目标是「抓更多超级票」，并希望用**高点减仓 + 低点重新加仓**（实盘可执行、不放宽止损、不加大暴露）来同时控制回撤。本条用**真实成交 + 真实持仓路径**做离线反事实，判定该方案是否成立。
- **Changed Files**：新增 `scripts/_scratch/_probe_t74_scaleout_cf.mts` · `_probe_t74_scaleout_readd_cf.mts`（分别写 `docs/evidence/_analysis_t74_scaleout_counterfactual_20261005.json`、`_analysis_t74_scaleout_readd_counterfactual_20261005.json`）· 本条目。⚠️ `docs/evidence/` 被 `.gitignore:152` 忽略 ⇒ 数字以本条目为准。
- **Changed Contracts / DB / Execution Path**：**无**（provider 只读装配 + 内存重放；控制臂复现 151.0958%，净利 188,838 元）。
- **口径**：控制臂 1429 笔已实现交易；减仓价 = 持仓期内首个收盘 ≥ 入场价×(1+X%)；回补价 = 减仓后首个收盘 ≤ 减仓价×(1−Y%)；期末按原实际离场价平仓；每多一条腿按 20 bps 成本计。
- **结果 ①「只减仓不回补」（卖 50%）**：

  | 减仓阈值 | 触发 | 组合净利（实际 188,838） | Δ | ≥+50% 笔数（实际 9） |
  |---|---|---|---|---|
  | +10% | 236 | 131,283 | **−57,555** | 2 |
  | +15% | 143 | 125,208 | **−63,630** | 2 |
  | +20% | 93 | 153,231 | −35,607 | 4 |
  | +25% | 68 | 143,476 | −45,362 | 4 |
  | +30% | 50 | 153,834 | −35,004 | 4 |

- **结果 ②「减半 + 低点回补」（完整方案，15 组参数）**：**全部为负**。最好的一组（+20% 减半 / 回撤 8% 回补）净利 151,607（Δ **−37,230**），≥+50% 笔数 9 → **4**；最差 −61,860。
  关键副产物：**回补成功率很低** —— 回撤 5% 才等到 81/247（33%），回撤 8% 只有 11%，回撤 12% 只有 1% ⇒ **减仓后价格多数继续上涨，「低点」等不到**；少数等到的往往是趋势已走坏。
- **结论**：① 数学上「混合收益 = f·减仓价 + (1−f)·最终价」⇒ 对「最终刚过 +50%」的票，早减一半就把它拉回 +50% 以下（笔数 9 → 2–4）；② 回补腿在真实路径上大多无法成交，卖飞的部分永久失去上涨；③ ⇒ **「高点减仓 + 低点回补」不成立，最优的仓位处置就是「不动」**。
- **剩余未测的买入端杠杆（唯一）**：`TopN 3 → 5`。召回诊断已证明 **rank4/5 的 ≥+50% 密度与 rank1–3 同档**（10.63%/11.70%/11.24% vs 11.2%/11.6%），而 P2 的 slots-3-8/12 只多买了「其它交易日的 top-3」，**从未买过当日 rank4/5** ⇒ 这是最后一个直接针对「抓更多超级票」的未测杠杆。
- **Regression Result**：本条零代码改动；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：NONE。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · `T74-TOP5-P4-001`（选股广度 TopN 3→5 · 实现 + 真实 Run）

- **Task**：抓更多超级票的最后一个未测杠杆 —— 把每日可选范围从 3F top3 扩到 top5（召回诊断显示 rank4/5 的「曾涨过 +50%」密度与 rank1-3 同档）。
- **Changed Files**：新增 `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-top5/**`（experiment / page / README）· `shared/researchExperimentsContracts.ts`（`extensionSelectionArms[].topN?` 新增可选字段）· `server/researchExperiments/compositeDatasetProvider.ts`（按臂 topN 装载扩展行）· 注册（manifest / pages / experimentModes）· 新增测试 `tests/server/researchExperiments/compositeRunnerT74Top5.test.ts` · 分档台账 40 → 41 · 本条目。
- **Changed Contracts**：descriptor 的 `compositeExecution.extensionSelectionArms[].topN`（可选，缺省 3 = 既有行为）。
- **Changed DB**：无 schema / migration；新增真实 Run **2 条**（第一版 `RUN-20261004-C5F4CA32` 因臂设计错误空跑；修正版 `RUN-20261004-6C818086`，COMPLETED，约 196 s）。
- **第一版设计错误（已修正并记录）**：`maxDailyBuys <= selectionTopN - 2` 时 simulator 按排名顺序买入，**永远买不到 rank4/5**（该版 rank4-5 成交 = 0；top5-3-5 与 P2 slots-3-5 结果完全相同，互为交叉验证）。修正版把单日买入名额放到 4 / 5。
- **真实结果（修正版，C = Runner T74，全周期）**：控制臂 151.0958341843399% / MaxDD 43.302944323482485% / 1434 笔 / ≥+50% 9 笔（parity PASS）；
  `top5-4-5` 116.17% / 44.12% / 1454 笔 / ≥+50% 8 笔 / **rank4-5 成交 22 笔、净利 −10,638、≥+50% 0 笔**；
  `top5-5-5` 82.47% / 46.08% / 1456 笔 / 8 笔 / **rank4-5 28 笔、−12,863、0 笔**；
  `top5-5-8` −11.35% / 64.28% / 2375 笔 / 11 笔 / **rank4-5 174 笔、−12,477、0 笔**。
- **结论**：**第 4、5 名不值得买** —— 真正买到的 rank4/5 成交净利全为负、**没有一笔实现 ≥+50%**、组合收益与回撤同时恶化。
  并记录一条方法论教训：**召回口径的「曾经涨过 +50%」密度 ≠ 可实现收益**（买入后受本策略持有期与退出规则约束）。
- **穷尽性总结（供用户决策）**：针对「抓更多超级票」，换排序 / 多买名额 / 扩大止损 / 高点减仓+低点回补 / 选股广度 3→5 / 新特征（事件表 + 首板前价格历史）**全部被实测否掉**
  ⇒ 在本策略现有的数据与执行空间内**已无可用杠杆，保持不动就是最优**；再进一步需要**新信息源**（市场/板块状态、资金流、更丰富的首板前历史、基本面事件），平台当前没有这些域。
- **未变化 / 未做**：未改任何正式策略定义、未建策略版本、未回改历史 Run。
- **Regression Result**：`pnpm run check` **0 错**；定向 4 文件 **31 例全绿**；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：minor（新增可选契约字段 + 实验入口 + 真实运行结果）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · \`T74-CARRYOVER-P6-001\`（跨日候选池第一轮 · 实现 + 真实 Run）

- **Task**：实现用户提出的候选延续方向 —— 前一日 top5 中未进入常规买入名额的候选，次日与新 fresh 候选统一重排；第一轮只测原始 3F 分 carry，不引入新评分。
- **Changed Files**：新增 \`server/research/compositeRunner/carryover.ts\`（纯函数 \`applyCompositeCarryover\`）· \`research-experiments/compositeRunnerBridge.ts\`（零实现 re-export）· \`research-experiments/first-board-pullback/composite-runner-newhigh3-t74-carryover/**\`（experiment / page / README）· 注册（manifest / pages / experimentModes）· 新增测试 \`tests/server/research/compositeRunner/carryover.test.ts\`、\`tests/server/researchExperiments/compositeRunnerT74Carryover.test.ts\` · 分档台账 41 → 42（other-scope 22 → 23）· 本条目。
- **Changed Contracts / DB / Execution Path**：新增的是研究选股层的**可选纯函数**，不改 \`CandidateEvaluationRun\` schema、不改 \`SimulationConfig\`、不改 \`simulator/engine.ts\` / \`plan.ts\`、不改正式策略定义；无 schema / migration。
- **口径**：控制臂 top3 / 2 笔 / 5 仓，完全复用 T74；carry 臂 top5 / 2 笔 / 5 仓。fresh 前 2 名进入常规买入尝试，其余进入 pending；pending 保留原始 3F 分，最多跨 1 / 2 个决策日；\`margin=0.03\` 时，pending 必须先高于某只 fresh 至少 0.03 才能插到它前面。Runner \`NEW_HIGH_3 / 5 / 74\`、SL-18.1 退出链、仓位、成本、数据集坐标全部冻结。
- **真实 Run**：\`RUN-20261004-EE05EA28\`（datasetVersionId \`780001\`，COMPLETED，约 197 s；控制臂 parity **PASS**：A \`15.787690712129931%\` / 1619 笔、C \`151.0958341843399%\` / 1434 笔、trigger \`161\`）。
- **真实结果（C = Runner T74，全周期）**：

  | 臂 | C 收益 | C 最大回撤 | C 成交 | ≥+50% | ≥+100% | carry 进入买入前 N | carry 成交 | carry 净利 | carry ≥+50% |
  |---|---|---:|---:|---:|---:|---:|---:|---:|---:|
  | 控制臂 top3 / 2 笔 / 5 仓 | **151.0958%** | **43.3029%** | 1434 | **9** | 2 | 0 | 0 | 0 | 0 |
  | carry1-stale（margin 0） | 99.3457% | 55.4126% | 1436 | 7 | 2 | 901 | 292 | **+3,130** | 1 |
  | carry1-m03（margin 0.03） | 84.8822% | 53.7516% | 1441 | 8 | 2 | 529 | 156 | **−7,015** | 0 |
  | carry2-m03（margin 0.03） | 66.7172% | 52.3669% | 1455 | 7 | 2 | 784 | 255 | **−735** | 0 |

- **结论**：**第一轮 REJECTED**。carry1/margin0 的 carry 成交本身略正（+3,130、1 笔 ≥+50%），但组合收益减少 **51.75 pp**、最大回撤增加 **12.11 pp**；加 margin 或延长到 2 日后，carry 成交净利转负、≥+50% 为 **0**。三条臂都没有增加实现 ≥+50% 的总笔数。
- **机制判断**：这批候选不是补“空仓位”，而是**排挤 fresh 候选的仓位与资金循环**；原始 3F 分的跨日延续没有引入新信息，因此不具备独立 alpha。第一轮证明“只做 stale-score carry”不值得继续。
- **下一步（如需继续）**：必须引入**版本化的当日重评分**，并先验证重评分能把 carry 与 fresh 区分开；否则该方向到此结束。
- **未变化 / 未做**：未改正式策略 \`3600005@2.0.0\`、\`3570001\`、历史 Run；未建新 StrategyVersion；未改 DB。
- **Regression Result**：\`pnpm run check\` **0 错**；定向 3 文件 **22 例全绿**；\`node scripts/checkEolDrift.mjs --strict\` 待收尾复跑。
- **Baseline Impact**：minor（新增实验入口 + 研究纯函数 + 真实运行结果）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · T74-CARRYOVER-REFRESH-P7-001（跨日候选池 + 当日重评分 · 实现 + 真实 Run）

- **Task**：在 P6 否掉 stale-score carry 后，按用户要求实现版本化的当日重评分，检验“carry 没有新信息”是否是失败原因。
- **Changed Files**：新增 server/research/recipeFeatures/carryRefreshScoreFeatures.ts（CarryRefreshV1）· 扩展 server/research/compositeRunner/carryover.ts（可选 refresh 策略、停牌 carry 不计分）· research-experiments/compositeRunnerBridge.ts（零实现 re-export）· 新增 research-experiments/first-board-pullback/composite-runner-newhigh3-t74-carryover-refresh/**（experiment / page / README）· 注册（manifest / pages / experimentModes）· 新增测试 tests/server/research/recipeFeatures/carryRefreshScoreFeatures.test.ts、tests/server/researchExperiments/compositeRunnerT74CarryoverRefresh.test.ts，并扩展 tests/server/research/compositeRunner/carryover.test.ts · 分档台账 42 → 43（other-scope 23 → 24）· 本条目。
- **Changed Contracts / DB / Execution Path**：新增研究层纯函数与实验入口；不改 CandidateEvaluationRun / SimulationConfig / simulator engine / 正式策略；无 schema / migration。
- **口径**：每个决策日对 fresh + 当日 pending 的 union 统一计算 CarryRefreshV1：
  1. pullbackDepth = (事件以来最高收盘 − 当前收盘) / 最高收盘，越大越好；
  2. negMomentum = −(当前收盘 / 首板日收盘 − 1)，越大越好；
  3. negWindowGap = −(当前收盘 / 事件窗收盘均值 − 1)，越大越好；
  逐分量在当日 union 内做横截面分位，等权平均后 fused = (1−w)·3F + w·refreshPercentile。
  Runner NEW_HIGH_3 / 5 / 74、SL-18.1、maxDailyBuys=2、maxPositions=5、数据坐标全部冻结。
- **臂矩阵**：control（top3，无 refresh）· refresh-only-w20/w35（top5，无 carry）· carry1-refresh-w20/w35（top5，carry 1 日）。
- **第一次真实 Run（失败，已诊断修复）**：RUN-20261005-F2AD66B2，FAILED；某个 carry 候选在 rd6/rd7 为停牌（barPresent=false、close=null），初版当天重评分 fail-closed 中断。修复为：停牌 carry 当日不计分、不买入、保留到 age 上限内后续再试；不插补价格。fresh 缺分量仍 fail-closed。
- **最终真实 Run**：RUN-20261005-4BB55265（datasetVersionId 780001，COMPLETED，约 205 s；控制臂 parity PASS：A 15.787690712129931% / 1619 笔、C 151.0958341843399% / 1434 笔、trigger 161；readRunDetail 的 resultIssue=null）。
- **真实结果（C = Runner T74，全周期）**：

  | 臂 | C 收益 | C 最大回撤 | C 成交 | ≥+50% | ≥+100% | carry 成交 | carry 净利 | carry ≥+50% |
  |---|---|---:|---:|---:|---:|---:|---:|---:|
  | control | **151.0958%** | 43.3029% | 1434 | **9** | 2 | 0 | 0 | 0 |
  | refresh-only-w20 | 25.6307% | 49.1052% | 1452 | 8 | 0 | 0 | 0 | 0 |
  | refresh-only-w35 | −36.8000% | 51.3412% | 1469 | 7 | 0 | 0 | 0 | 0 |
  | carry1-refresh-w20 | 82.1054% | **41.1379%** | 1460 | **9** | 1 | 366 | −35,695 | 1 |
  | carry1-refresh-w35 | 30.6922% | 52.5911% | 1504 | 8 | 1 | 430 | −47,567 | 2 |

  另一个如实计数：carry1-refresh 两条臂均有 refreshUnscorableCarryCandidates=3（停牌），未插补。
- **结论**：**第二轮 REJECTED**。refresh-only 已经证明重评分本身是负向的（151.10% → 25.63% / −36.80%）；carry1-refresh 没有恢复 alpha（82.11% / 30.69%），carry 成交净利均为负。carry1-refresh-w20 的 ≥+50% 回到 9，但收益腰斩，不能视为有效改善。
- **合并判断**：P6 stale carry 与 P7 same-day refresh carry 均被真实数据否掉；当前控制臂 top3 / 2 笔 / 5 仓 + Runner T74 仍是最优。后续不应继续在 carry 上换权重，除非先找到与现有 3F 低相关且有正 IC 的新信息源。
- **未变化 / 未做**：未改正式策略 3600005@2.0.0、3570001、历史 Run；未建新 StrategyVersion；未改 DB。
- **Regression Result**：pnpm run check 0 错；定向测试 32 例全绿；node scripts/checkEolDrift.mjs --strict 0；pnpm run test:changed 673 passed / 5 failed —— 5 个失败仍全部是已知的 limitUp.test / limitUp.watch.test DB 状态依赖用例，与本改动无 import 关系。
- **Baseline Impact**：minor（新增研究特征、实验入口 + 真实运行结果）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · T74-LATE-ENTRY-P8-001（延迟入场 + 晚窗口滚动 3F · 实现 + 真实 Run）

- **Task**：检验将原 T+5 候选延后到 T+7 / T+8 / T+10，并在原 top5 门槛内用最近 5 日滚动 3F 重新选择，是否优于 T+6 入场。
- **Changed Files**：新增 server/research/recipeFeatures/lateEntryScoreFeatures.ts（LateEntry3F 滚动 5 日窗口）· server/research/compositeRunner/lateEntry.ts（applyCompositeLateEntry）· research-experiments/compositeRunnerBridge.ts · research-experiments/first-board-pullback/composite-runner-newhigh3-t74-late-entry/** · 注册（manifest / pages / experimentModes）· 新增测试 tests/server/research/recipeFeatures/lateEntryScoreFeatures.test.ts、tests/server/research/compositeRunner/lateEntry.test.ts、tests/server/researchExperiments/compositeRunnerT74LateEntry.test.ts · 分档台账 43 → 44（other-scope 24 → 25）· 本条目。
- **Changed Contracts / DB / Execution Path**：新增研究层纯函数与实验入口；不改 CandidateEvaluationRun / SimulationConfig / simulator engine / 正式策略；无 schema / migration。
- **口径**：control = T+5 选股 / T+6 开盘；delay 臂 = 原 top3 排名不变，目标决策日改为 T+7/T+8/T+10；rescore 臂 = 原 top5 作为门槛，在目标日 D 用 D-5..D 共 6 根 bar 重算 maxAmplitude / meanAmplitude / t1VolumeRatio，按冻结 3F 桶边界重排后取前 3，次日开盘执行。Runner NEW_HIGH_3 / 5 / 74、SL-18.1、maxDailyBuys=2、maxPositions=5、数据坐标全部冻结。
- **真实 Run**：RUN-20261005-DF5EDDEB（datasetVersionId 780001，COMPLETED，约 228 s；控制臂 parity PASS：A 15.787690712129931% / 1619 笔、C 151.0958341843399% / 1434 笔、trigger 161；readRunDetail 的 resultIssue=null）。
- **真实结果（C = Runner T74，全周期）**：

  | 臂 | C 收益 | C 最大回撤 | C 成交 | ≥+50% | ≥+100% | 例外计数 |
  |---|---|---:|---:|---:|---:|---:|
  | control | **151.0958%** | **43.3029%** | 1434 | **9** | 2 | 0 |
  | delay-t7 | −68.2053% | 82.2760% | 1644 | 6 | 2 | 不可交易 7 |
  | delay-t8 | −80.6692% | 89.3918% | 1694 | 7 | 2 | 不可交易 7 |
  | delay-t10 | −44.8980% | 77.5145% | 1670 | 5 | 2 | 不可交易 35 |
  | rescore-t7 | −33.8181% | 65.9511% | 1607 | 6 | 2 | 不可评分 8 |
  | rescore-t8 | −58.4594% | 70.3206% | 1666 | 3 | 1 | 不可评分 16 |
  | rescore-t10 | −58.7108% | 68.1128% | 1641 | 2 | 1 | 不可评分 22 |

- **结论**：**P8 REJECTED**。纯延迟入场把收益打到 −44.90% ~ −80.67%；原 top5 内的滚动 3F 重排最好也只有 −33.82%（T+7），且实现 ≥+50% 的笔数从 9 降到 6/7/5 或 6/3/2。T+6 入场是原策略 alpha 的组成部分，后移决策日没有可用的正增量。
- **合并判断**：P6 stale carry、P7 CarryRefreshV1、P8 延迟入场 + 滚动 3F 都被真实数据否掉；当前控制臂 T+5 选股 / T+6 买入 + Runner T74 仍是最优。下一步若要继续，必须先找到与当前 3F 低相关且有正 IC 的新信息源，而不是继续改 carry / 延迟日 / 旧因子窗口。
- **未变化 / 未做**：未改正式策略 3600005@2.0.0、3570001、历史 Run；未建新 StrategyVersion；未改 DB。
- **Regression Result**：pnpm run check 0 错；定向测试 23 例全绿；node scripts/checkEolDrift.mjs --strict 0；pnpm run test:changed 681 passed / 5 failed —— 5 个失败仍全部是已知的 limitUp.test / limitUp.watch.test DB 状态依赖用例，与本改动无 import 关系。
- **Baseline Impact**：minor（新增研究特征、实验入口 + 真实运行结果）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · NEW-INFO-SOURCE-INVENTORY-001（新信息源只读盘点 + 单变量 IC 扫描）

- **Task**：在 P6/P7/P8 连续否掉 carry、重评分与延迟入场后，盘点真实数据库中还有哪些尚未进入当前策略的信息域，并先做只读可行性/单变量扫描。
- **Changed Files / DB / Execution Path**：无生产代码、无 schema、无 migration、无历史 Run 修改；新增 scripts/_scratch/_probe_new_info_sources.mts、_probe_event_metadata_by_year.mts、_probe_event_metadata_ic.mts（gitignored）· 本条目。
- **真实覆盖率（只读查询）**：
  - ds_first_limit_pullback_event@780001：73,003 行；historicalLimitCount 73,003（100%）、daysSincePreviousLimit 69,758（95.6%）、turnover 72,996（99.99%）、limitUpTime/sector/keywords 各 10,538（14.4%，主要 2025–2026）、marketCap/floatMarketCap 均为 0。
  - limit_up_records：100,330 行，2019-01-02…2026-09-30；limitUpTime/sector 各 16,430（16.4%），turnover 100,182，circulationValue 16,276。
  - index_daily：7,520 行，4 个指数（000001.SH / 000300.SH / 000905.SH / 399001.SZ），2019-01-02…2026-09-30，close 全覆盖。
  - liquidity_daily：9,015,158 行，5,131 只证券，1992…2026；turnoverRate 8,938,065、amount/volume 约 900 万，但 circulationMarketCap/totalMarketCap 全为非空 0。
  - industry_assignments：5,212 行、83 个行业，但全部 effectiveFrom=2026-08-31；只有当前快照，不能用于 2019–2026 历史 PIT 回测。
  - market_data：225 行，2024-12-31…2026-09-29；两融/成交额覆盖完整，但历史长度不足。
  - stock_daily_prices：8,898,902 行、5,800 只证券，2019-01-02…2026-09-30；可用于首板前历史，但既有 60 日历史特征的 lift 已约 0.89–1.11。
  - 未发现 money flow / 龙虎榜 / 北向 / 基本面财务表；这些只能外部补数。
- **单变量 IC 扫描（3F 候选池；horizon 10/20 的 maxReturn；只读）**：
  - historicalLimitCount：pooled IC 约 0；top5 日度 IC 约 +0.049 至 +0.053，正 IC 比例约 51% 至 52%。弱。
  - daysSincePreviousLimit：pooled IC 约 −0.059 至 −0.061；top20% 平均 maxReturn 约 8.6% 至 8.2%，bottom20% 约 10.4% 至 10.6%。方向是距上次涨停越短越好，但强度弱。
  - turnover：pooled IC 约 −0.069 至 −0.083；top20% 平均 maxReturn 约 8.9% 至 8.6%，bottom20% 约 10.0% 至 10.7%。方向是首板日成交额越低越好，强度弱。
- **已有市场状态证据**：早期 1.62.1/1.63.0 已测市场状态与流动性闸门；plateauFound=false，最好的市场成交额闸门仍是全窗/oos 取舍且 cost×2 OOS 多为负，不能据此宣称稳健改进。
- **结论**：现有真实数据库里，没有现成的强新 alpha 信息源。可立即继续做的是事件事实弱过滤（距上次涨停、首板成交额、历史涨停次数）；真正的新信息域（资金流/龙虎榜/北向/基本面）需要先补数据，属于数据接入 + schema/migration 级任务。
- **建议下一步**：先做 P9 单变量/双变量事件事实过滤扫描（不重排 3F，只对 T74 新开仓做 gate），确认是否能提高实现 >=+50% 笔数或降低回撤；若无效，再考虑外部补数。外部补数前需明确数据源、覆盖率、PIT 可用时点与授权。
- **Regression Result**：本轮只读，无代码执行路径变更；EOL 以收尾扫描为准。
- **Baseline Impact**：NONE（研究盘点）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · T74-EVENT-GATE-P9-001（事件事实 gate · 实现 + 真实 Run）

- **Task**：按新信息源盘点结论，在 original top3 不变的前提下，用 2019-2024 训练段的 daysSincePreviousLimit / turnover / historicalLimitCount 分布做新开仓 gate；不重排 3F、不补 rank4/5。
- **Changed Files**：新增 server/research/compositeRunner/eventGate.ts（applyCompositeEventGate）· server/research/recipeFeatures 无新增（复用事件事实）· server/datasetRegistry/query.ts（新增 EventBatchQuery + loadEventsBatch；InMemory / Db / Snapshot 三实现）· server/researchExperiments/compositeDatasetProvider.ts（可选 includeEventMetadata + selected event facts 注入）· server/researchExperiments/runner.ts（透传 descriptor 开关）· shared/researchExperimentsContracts.ts（includeEventMetadata 可选字段）· research-experiments/compositeRunnerBridge.ts · 新增 research-experiments/first-board-pullback/composite-runner-newhigh3-t74-event-gate/** · 注册（manifest / pages / experimentModes）· 新增测试 tests/server/research/compositeRunner/eventGate.test.ts、tests/server/researchExperiments/compositeRunnerT74EventGate.test.ts · 分档台账 44 → 45（other-scope 25 → 26）· 本条目。
- **Changed Contracts**：compositeExecution.includeEventMetadata（可选，缺省 false = 既有行为逐字不变）；DatasetDataReader.loadEventsBatch（只增不改，空集合不发 SQL，强制 datasetVersionId）。
- **Changed DB / Execution Path**：无 schema / migration / DML；不改 simulator / Portfolio / Order / Fill / 正式策略。
- **口径**：original top3 排名不变，只过滤 positionIntents；gate 阈值固定自 2019-01-02..2024-12-31 训练段；缺失事件事实按不通过处理，不插补。Runner NEW_HIGH_3 / 5 / 74、SL-18.1、maxDailyBuys=2、maxPositions=5、数据坐标全部冻结。
- **真实 Run**：RUN-20261005-8668C385（datasetVersionId 780001，COMPLETED，约 161 s；控制臂 parity PASS：A 15.787690712129931% / 1619 笔、C 151.0958341843399% / 1434 笔、trigger 161；readRunDetail 的 resultIssue=null；eventMetadataRows=5569）。
- **真实结果（C = Runner T74，全周期）**：

  | 臂 | C 收益 | C 最大回撤 | C 成交 | ≥+50% | ≥+100% | 过滤 intent | 保留 intent |
  |---|---|---:|---:|---:|---:|---:|---:|
  | control | **151.0958%** | **43.3029%** | 1434 | **9** | 2 | 0 | 0 |
  | gap-p50 | 38.0638% | 56.7601% | 1366 | 8 | 1 | 2918 | 2651 |
  | gap-p33 | 76.8846% | 48.6334% | 1203 | 9 | 1 | 3776 | 1793 |
  | turnover-p50 | **165.7402%** | 49.4402% | 1273 | 7 | 1 | 2902 | 2667 |
  | combo-p50 | 43.9293% | **37.0914%** | 893 | 3 | 1 | 4457 | 1112 |
  | histlimit-p67 | −40.9986% | 68.2608% | 1066 | 5 | 1 | 3121 | 2448 |

- **结论**：**P9 REJECTED（对“抓更多超级票”的目标）**。没有任何 gate 增加实现 ≥+50% 的笔数；turnover-p50 收益 +14.64 pp，但 ≥+50% 9→7、最大回撤 43.30%→49.44%；combo-p50 虽降回撤到 37.09%，但收益 43.93%、≥+50% 仅 3。事件事实只能做弱过滤，不能作为新 alpha 来源。
- **合并判断**：P6 carry、P7 当日重评分、P8 延迟入场、P9 事件事实 gate 全部被真实数据否掉。当前控制臂 T+5 选股 / T+6 买入 + Runner T74 仍是最优。
- **下一步**：只有在外部补数（资金流 / 龙虎榜 / 北向 / 基本面）后，才可能引入真正的新信息源；该路径涉及数据源接入、PIT 时点、schema / migration，需单独授权。
- **未变化 / 未做**：未改正式策略 3600005@2.0.0、3570001、历史 Run；未建新 StrategyVersion；未改 DB。
- **Regression Result**：pnpm run check 0 错；定向测试 43 例全绿；node scripts/checkEolDrift.mjs --strict 0；pnpm run test:changed **1011 passed / 8 failed** —— 其中 5 个是既有 limitUp.test / limitUp.watch.test DB 状态依赖失败，另 3 个是当前工作区已有的 threeFactorTopNStrategyDocument 期望未包含 recoveryPath 的漂移，均与 P9 事件元数据读取/gate 无 import 关系。
- **Baseline Impact**：minor（新增只读事件元数据读取口 + 实验入口 + 真实运行结果）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · STRATEGY-IMPLEMENTATION-REENTRY-001（strong-trend-reentry-v1 接入 Strategy Core；Phase B BLOCKED）

- **Task**：把研究派生策略 `strong-trend-reentry-v1@1.0.0` 接入既有 Strategy Core 执行链（CUSTOM_EVENT resolver），并尝试 Baseline Backtest。
- **Changed Domains**：Strategy Core（production 事件源）· Run Workbench Assembly（resolver 选择 / 数据集桥常量）· Research（recipeRegistry 新增全选配方）· Strategy Evaluation（暴露 backtest artifacts 供取数）。**未**改 RuleGraph、Portfolio、Execution、simulator、Dataset schema。
- **Changed Files**：
  - 新增 `server/strategyCore/production/strongTrendReentryEventSource.ts`（`CUSTOM_EVENT` / `STRONG_TREND_REENTRY_V1` 事件解析器，实现既有 `EventOccurrenceResolver` 契约）
  - `server/strategyCore/production/index.ts`（re-export）· `versionFromDocument.ts`（只读暴露 `eventCode`）
  - `server/runWorkbenchAssembly/assemble.ts`（CUSTOM_EVENT + eventCode 命中才启用新 resolver；注释里的 `n` 被误换成换行的两处格式修复）
  - `server/runWorkbenchAssembly/datasetFromRegistry.ts`（`DATASET_POST_MAX_RELATIVE_DAY` 20 → 80，并重写其依据注释：真实上界仍由各版本 `getPostRelativeDayRange()` 判定）
  - `server/research/recipeRegistry.ts`（新增 `strong-trend-reentry-select-all`；同时修复该文件被翻成 CRLF 的漂移）
  - `server/research/strategyEvaluation/evaluate.ts`（新增 `backtestArtifacts` 取值；注释格式修复）
  - 新增测试 `tests/server/strategyCore/production/strongTrendReentryEventSource.test.ts`（9 例）
  - Draft 工件 `strategy-drafts/strong-trend-reentry-v1.0.0.{strategy-document,version-record,validation}.json`（`observationWindow.end` 80 → 79）
  - 报告 `docs/research/RESULT-STRATEGY-IMPLEMENTATION-REENTRY-001.md` · `docs/research/RESULT-BACKTEST-REENTRY-BASELINE-001.md`（+ `docs/research/RESULT-STRATEGY-DEFINITION-REENTRY-001.md` 附录 B 指纹更正）
- **Changed Contracts**：`CoreVersionFromDocumentResult` 新增只读字段 `eventCode: string | null`（只增不改）；`StrategyEvaluationResult` 新增 `backtestArtifacts`（只增不改）；新增 `resolveEvent` 实现，未改动 `EventOccurrenceResolver` 契约本身。
- **Changed DB**：**无**（0 schema / 0 migration / 0 DML；全部探针为 SELECT）。
- **Changed Execution Path**：**无新执行路径** —— 新 resolver 走既有 `context.resolveEvent`；Entry/Exit/Position/Cost 语义未变（`T_CLOSE → T_PLUS_1_OPEN`, `priceType=OPEN`, `TIME_EXIT 20`, `EQUAL_WEIGHT`）。
- **Potential Baseline Drift**：`DATASET_POST_MAX_RELATIVE_DAY` 20 → 80 放宽了观察窗口的**前置粗筛**（真实护栏仍是每版本 post 深度 + `REGISTRY_BRIDGE_MAX_ROWS`）；`recipeRegistry.ts` 行尾归一化后真实改动仅 +19 行（曾因 CRLF 漂移显示 +609/-584）。
- **关键发现（Phase B BLOCKED）**：该策略要求 `observationWindow.end≈79`（S 可达 rd=75、RECLAIM 可达 rd=79），事件窗投影实测 **5,806,820 行** > `REGISTRY_BRIDGE_MAX_ROWS = 1,600,000` ⇒ 直读桥抛 `REGISTRY_ROW_BUDGET_EXCEEDED` ⇒ 按契约回落 `buildResearchDataset` ⇒ 本环境在 2019-01-02 的 `index_daily` 读上 `read ECONNRESET`。既有已落库策略普遍用 `{start:5,end:15}`（≈1.24M 行）恰在护栏内，本策略**结构性**超护栏。**未**启动任何优化；**未**自行修改该护栏。
- **Regression Result**：`pnpm run check` 0 错；定向 vitest 10 文件 233 例全绿；`node scripts/checkEolDrift.mjs --strict` 0。
- **Baseline Impact**：minor（新增一个事件解析入口 + 一个配方 + 一处桥常量与注释；无 schema / 无策略版本落库）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · STRATEGY-IMPLEMENTATION-REENTRY-001 / 方案 2（事件窗**流式**数据面）

- **Task**：按用户裁定执行「阻塞解除方案 2」——把事件窗直读从「一次性物化整张逐日面板」改为**逐日按需**游标，避免 `REGISTRY_ROW_BUDGET_EXCEEDED` 与跨境重建。
- **Changed Domains**：Run Workbench Assembly（数据集直读桥 / 装配路由）。**未**改 Strategy Core、RuleGraph、Portfolio、Execution、simulator、Dataset schema、迁移。
- **Changed Files**：
  - `server/runWorkbenchAssembly/datasetFromRegistry.ts`：新增 `EventWindowCursorReader` / `EventWindowCursorOptions` / `EventWindowDatasetCursor` / `createEventWindowDatasetCursor` / `estimateEventWindowPanelRowsUpperBound` / `buildEventWindowDatasetCursorFromRegistry`
  - `server/runWorkbenchAssembly/assemble.ts`：`resolveDataset` 在**物化路径本会超行预算时**改走流式游标；`datasetCursor` / `buildClosedLoopWiringInputs` 形参类型由 `PooledDatasetCursor` 放宽为 `ResearchDatasetCursor`（只放宽，不改既有分支）
  - `server/runWorkbenchAssembly/pooledDatasetCursor.ts`：`toCanonicalBar` 由模块私有改为导出（供事件窗游标复用**同一** bar 映射，避免复制）
  - 新增测试 `tests/server/runWorkbenchAssembly/eventWindowDatasetCursor.test.ts`（7 例）
- **Changed Contracts**：`assembleRunWorkbenchInputs` 的 `datasetCursor` 由池化专用放宽为通用 `ResearchDatasetCursor`（既有池化路径不受影响）。
- **Changed DB**：**无**（0 schema / 0 migration / 0 DML；全部只读）。
- **Changed Execution Path**：事件窗在超预算时改用**流式游标**路径（`createStreamingClosedLoopWiring`）。该路径**语义与 `buildWindowRows` 逐字段一致**：同一 `projectEventRow`、同一 `eventScopedSecurityId`、同一 rd 集合（rd=0 ∪ rd ∈ [1, end+1]）、同一前收口径、同一决策成员（rd ∈ [start,end]）、观察日换手/市值同样为 null。**只在物化路径本会失败时启用** ⇒ 既有窄窗口策略行为逐字节不变。
- **实测效果**：数据集 780001 / 观察窗口 `{1,79}` ⇒ 物化 5,806,820 行 > 护栏 1,600,000；改流式后装配 **10.4 s**、峰值内存 **~2.9 GB**（原为 >30 min 且默认 4 GB 堆 OOM）。
- **新发现的独立阻塞（未解除）**：research 收尾 `computeCandidateEvaluationRunFingerprint` 抛 `RangeError: Invalid string length` —— `CandidateDayRecord` 的 `universeMembers` + `dropped` 长度 = 当日成员数（≈2,961/日 × 1,961 日 ≈ 1,161 万条字符串）。**非本改动引入**，是平台候选记录 O(决策日×当日成员) 的既有规模上限。已记入 `docs/research/RESULT-BACKTEST-REENTRY-BASELINE-001.md`。
- **Potential Baseline Drift**：本次仅新增**超预算时**的流式分支；窄窗口策略走原物化分支，不受影响。
- **Regression Result**：`pnpm run check` 0 错；定向 vitest **20 文件 / 366 例**全绿（含新增 7 例游标测试与既有 pooledDatasetCursor / windowProjection / closedLoopWiring）；`node scripts/checkEolDrift.mjs --strict` 0。
- **Baseline Impact**：minor（新增流式数据面入口 + 装配路由；无 schema、无策略版本落库）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-05 · STRATEGY-IMPLEMENTATION-REENTRY-001 / 方案 2 续（决策成员收敛 + rank 载体）

- **Task**：按裁定把事件窗流式游标的「当日决策成员」收敛为**事件真正成立**的成员（`universeMembers` 语义变更，已登记），并把 Baseline run 跑通。
- **Changed Files**：
  - `server/runWorkbenchAssembly/datasetFromRegistry.ts`：`EventWindowCursorOptions` 增可选 `decisionMemberPredicate` + `EventWindowCandidateMember` 载荷；`BuildDatasetFromRegistryRequest` 增同名可选字段；stats 增 `suppressedNonTriggerMembers`
  - `server/runWorkbenchAssembly/assemble.ts`：新增 `resolveEventMemberPredicate(document)` —— 用**同一份** `judgeStrongTrendReentryEvent` + `toCoreBarWindow` 构造判定器；仅 `CUSTOM_EVENT` + `STRONG_TREND_REENTRY_V1` 注入
  - `server/research/framework/datasetCursor.ts`：`ResearchDatasetCursorStats` 增可选 `suppressedNonTriggerMembers`（只增不改）
  - `server/research/recipeRegistry.ts`：`strong-trend-reentry-select-all` 的 rank 载体 `{isBullish:0}` → `{volumeRatio:1}`（见下）
  - 测试 `tests/server/runWorkbenchAssembly/eventWindowDatasetCursor.test.ts` → 8 例
- **Changed Contracts**：`ResearchDatasetCursorStats` 新增可选字段；事件窗流式请求新增可选判定器（缺省 = 既有口径）。
- **Changed DB**：**无**。
- **Changed Execution Path**：事件窗流式路径的「当日成员」由「窗口内全部事件（rd ∈ [start,end]）」收敛为「事件成立成员」。**只在流式游标 + 注入判定器时生效**；物化路径与池化路径不变。
- **口径登记（重要）**：该策略下 `universeMembers` 语义 = **触发成员**（全历史 2,492 候选名额），不是「窗口成员」。判定器与 Core **同源**（同一函数），不存在两套事件语义。
- **顺带修复**：`directionFromValue(rankValue)` 使全 0 权重 ⇒ rankValue=0 ⇒ `neutral` ⇒ longOnly 判 `NON_LONG_DIRECTION`（首轮 2,492 候选全被跳过）；改为恒正载体 `{volumeRatio:1}`（`topPercentile=1` ⇒ 不影响入选集合）。Draft 指纹随之前移。
- **实测**：装配 11.5 s / 内存 ~1.5 GB；baseline run 五阶段 `EXECUTED`（首次跑通）。**但结果不可采信**：`candidateExitPolicy` 未声明 ⇒ 退出被 `HOLD_WHILE_SELECTED` 接管（持有中位数 3 日，`TIME_EXIT 20` 未生效）；且 13,897/14,513 单 `SUSPENDED`（执行日无行，未定位）。已记入 `docs/research/RESULT-BACKTEST-REENTRY-BASELINE-001.md`。
- **Regression Result**：`pnpm run check` 0 错；`node scripts/checkEolDrift.mjs --strict` 0；新增/相关 vitest 全绿。
- **Baseline Impact**：minor（流式路径新增可选判定器；物化/池化路径不变）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-06 · `STOCK-SELECTION-001`（选股域 + 只读端点 + 「选股」页面 + 真实库 parity）

- **Task**：把「策略用于选股」落地为可用能力 —— ① 策略可扩展的按决策日选股器；③ 只读 tRPC 端点 + **新「选股」页面**（用户明确要求：新开页面且**兼容不同策略**）。目标策略示例 = `first-limit-pullback-3f-top3-runner-t74@2.0.0`（StrategyVersion `3600005`，Full `151.0958%`）。
- **Changed Domains**：新增 `server/stockSelection/**`（选股域）+ `server/stockSelectionRouter.ts`（只读端点）+ `client/src/pages/StockSelection.tsx`（新页面）。**未**改策略语义 / 执行 / 回测 / 指标 / DB。
- **Changed Files（新增）**：`server/stockSelection/{types,sliceDataset,registry,index}.ts` · `server/stockSelection/strategies/firstLimitPullback3FTopN.ts` · `server/stockSelectionRouter.ts` · `client/src/pages/StockSelection.tsx` · `tests/server/stockSelection/firstLimitPullback3FTopN.test.ts` · `tests/server/stockSelectionRouter.test.ts` · 报告 `docs/research/RESULT-STOCK-SELECTION-PARITY-001.md`。
- **Changed Files（修改，逐文件行尾保持原样）**：`server/routers.ts`（注册 `stockSelection`，+2 行）· `client/src/App.tsx`（+4 行：页面 import + 路由）· `client/src/components/AppShell.tsx`（+2 行：`ListChecks` import + ② 观察组「选股」导航项）。
- **Changed Contracts**：**无**（无 `shared/**` 改动；tRPC 只新增只读端点 `stockSelection.listStrategies` / `stockSelection.select`；`server/datasetRegistry/query.ts` 的试验性 `relativeDays` 改动**已完全回退**，最终 diff 不含该文件）。
- **Changed DB**：**无**（0 DDL / 0 DML；全部只读 SELECT）。
- **Changed Execution Path**：**无**。选股域只做「按日取数 → 事件窗投影 → 形状适配 → 结果投影」，打分 / 过滤 / 排序**全部**委托既有 `server/research/compositeRunner#buildFirstLimitPullback3FTop3SourceRun`（唯一权威实现），不新增第二套引擎；不进入模拟盘 / 生产链。
- **取数口径（重要，已实测）**：候选事件的权威定义 = **数据集自己的相对日**（`rd=5` 行的 `tradeDate` 即决策日）。实现先在**事件表**按 `(datasetVersionId, tradeDate)` 取 30 自然日回退超集（走既有索引 `idx_event_version_date`，实测 48ms），再批量读 `post` rd1..6 并保留 `rd5.tradeDate === 决策日` 者；`prefix` 取 rd0。🔴 反例：直接对 `post` 加 `tradeDate` 谓词会退化为该相对日的全范围扫描（实测 **91,857ms/次**）；改后单日选股 **0.7–2.5s**。
- **数据面**：只读 rd0..6，**不需要** `.cache/research-dataset-3f-top3-v5-660001.jsonl.gz`（77MB 全史投影），也不重建 1,183 万行 post 表。
- **Parity（真实库只读，`STOCK-SELECTION-PARITY-001`）**：参考侧 = 缓存基线投影（1,240,693 行 / 1,875 交易日 / 1,862 个有选股结果日）+ 同一权威函数；被测侧 = DB `780001` 按日切片。抽样 6 个决策日 ⇒ **PASS 6 / FAIL 0**：Top-3 面板身份与排序**逐个一致**、分数差 `< 1e-12` ⇒ 「rd0..6 切片」与「rd0..16 全史投影」在选股上等价。
- **响亮失败（不静默降级）**：`SELECTION_EVENT_DAY_BAR_MISSING`（候选缺 rd0）· `SELECTION_CALENDAR_INCONSISTENT`（无法复现数据集自己的 `relativeDay` ⇒ 日历缺洞）· `SELECTION_PAGE_LIMIT_EXCEEDED`（事件窗口超护栏）· `SELECTION_STRATEGY_UNKNOWN`（未注册策略）。路由把它们如实转成 BAD_REQUEST / INTERNAL_SERVER_ERROR，**不伪装成「今天没有候选」**。
- **可扩展性（用户要求）**：`StockSelectionStrategy` 端口 + `registry.list()/get(id)`；策略元数据带 `datasetId`，页面据此调 `datasetRegistry.listVersions({datasetId})` 列数据集版本 ⇒ **页面零硬编码**，新增策略只改后端注册。当前注册 1 个（`first-limit-pullback-3f-topn`）。
- **前端落点**：新页面 `/stock-selection`（导航「② 观察」组「选股」）；查询条件 = 策略 / 数据集版本 / 决策日 / TopN；结果 = 本次事实（含 `datasetVersionId` 真实坐标与数据窗口）+ 选股清单（名次/代码/T0/信号日/计划买入日/3F 分/分位）+ 剔除统计；**空态与失败分开**（无候选 vs 缺 rd0 / 日历缺洞）。
- **未做（下一步）**：② 前向模块参数化到 `3600005@2.0.0`（`paperTrading3fTop3Runner/**` 仍硬编码 `3570001/hold20/750001/extendToHoldingDays=20`）；④ 行情/事件增量 + 收盘后调度（全市场行情只到 `2026-09-04`）。
- **Regression Result**：`tsc --noEmit` **0 错**；`vite build` **成功**（3116 modules）；选股域 + router vitest **13/13 全绿**；`node scripts/checkEolDrift.mjs --strict` **0**。未触碰任何既有测试。
- **Baseline Impact**：**minor**（新增选股域 / 端点 / 页面；`SYSTEM-BASELINE.md` 与 `system-manifest.yaml` 头部由并发会话持有，**本任务不覆盖其内容**，以本条目为准）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `STOCK-SELECTION-002`（口径 × 载体解耦 · A 方案第 1 步：接缝 + 现有实现登记为 dataset 载体）

- **Task**：用户裁定「选股不该跟数据集挂钩」→ 采纳方案 A（**双载体**：`live` 为日常口径、`dataset` 为研究/回放/对拍口径）。本步 = **第 1 步**：把「数据载体」从策略里抽成端口，现有实现登记为 `dataset` 载体。**纯重构 + 契约形状变更，选股行为零变化**。
- **设计（🔴 解耦的是载体，不是口径）**：口径（首板判定 / 观察窗 rd1..5 / 3F 排序 / 次日开盘）= 策略与 `compositeRunner` 的职责；载体只回答「决策日 D（= T0 + N 收盘）对应的候选事件及其事件窗行」，**不得**实现打分 / 过滤 / 排序。换载体只换数据来源。
- **Changed Files（新增）**：`server/stockSelection/dataSource.ts`（`SelectionDataSource` 端口 + `SelectionDataSourceKind = dataset | live`）· `server/stockSelection/sources/datasetSource.ts`（`createDatasetSelectionDataSource`，把原先写在策略里的 `ds_*` 取数整体迁入，含 `maxEvents` 护栏与 30 自然日回退窗口）。
- **Changed Files（修改）**：`strategies/firstLimitPullback3FTopN.ts`（依赖改为 `sources` + `defaultSourceKind`；取数交给载体；**rd0 不变量收归口径层**）· `registry.ts`（默认依赖 = `[dataset 载体]` + `defaultSourceKind=\"dataset\"`）· `types.ts`（`StockSelectionRequest` 顶层**去掉** `datasetVersionId`，改为 `source?: {kind, datasetVersionId?}`；`DailyStockSelection` 增 `source{kind,label}` 与 `datasetVersionId: number|null`；新增 `SELECTION_DATA_SOURCE_UNSUPPORTED` / `SELECTION_DATA_SOURCE_COORDINATE_MISSING`）· `sliceDataset.ts`（`parentDatasetVersionId` 允许 `null`，live 切片如实标 `selection-slice:live:<date>`）· `index.ts` · `stockSelectionRouter.ts`（输入改为 `source` 指认；只把「决策日 + TopN + 载体」交给策略，**不泄漏 strategyId / 数据集细节**）· `client/src/pages/StockSelection.tsx`（请求改为 `source:{kind:\"dataset\",datasetVersionId}`；事实卡增「数据来源（载体）」）。
- **Changed Contracts**：tRPC `stockSelection.select` 输入形状变更（`datasetVersionId` → `source`）与输出新增 `source` / `datasetVersionId: number|null`。**同一迭代内消费方（页面 / 测试）已同步**；无 `shared/**` 改动。
- **Changed DB / Execution Path**：**无**（0 DDL / 0 DML；不注册执行路径；不进入模拟盘 / 生产链）。
- **载体的不静默原则**：请求的载体未注册 ⇒ `SELECTION_DATA_SOURCE_UNSUPPORTED`（**不静默回退到 dataset**）；`dataset` 载体未给坐标 ⇒ `SELECTION_DATA_SOURCE_COORDINATE_MISSING`（不猜版本）。
- **验证（纯重构必须行为不变）**：真实库只读 parity **PASS 6 / FAIL 0**（2019-01-09 / 2020-04-21 / 2021-07-29 / 2022-11-10 / 2024-02-22 / 2025-06-06；候选/合格数 23/8 · 47/22 · 32/23 · 30/16 · 60/16 · 66/48 —— 与重构前**逐日相同**）；vitest **16/16**（新增「live 载体测试替身得到同一份选股结果」⇒ 接缝真实可替换；新增未注册载体 / 缺坐标两例）；`tsc --noEmit` 0 错；`vite build` 成功；`node scripts/checkEolDrift.mjs --strict` 0。
- **未做（下一步）**：第 2 步 = 页面主表单去掉「数据集版本」主位（改「数据来源」，默认 `live`，研究口径收进高级区）；第 3 步 = 接 `live` 载体（抽 `isFirstLimit = 当日涨停 && 上一交易日未涨停` 按日判定 + 复用 `isLimitUpClose` / 同一 3F 排序）+ 把 parity 探针升级为 live↔dataset 常规守卫；④ 行情到账（全市场行情仍只到 `2026-09-04`）。
- **Baseline Impact**：**minor**（新增载体端口 + 契约形状变更；`SYSTEM-BASELINE.md` / `system-manifest.yaml` 头部由并发会话持有，本任务不覆盖）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `STOCK-SELECTION-003`（live 载体接入 + **候选宇宙口径对齐** · 真实数据 live ↔ dataset 对拍 **4/4 PASS**）

- **Task**：方案 A 第 3 步 —— 接 `live` 载体（当日原始行情，不依赖数据集版本），并以 live ↔ dataset 对拍证明**口径同源**。
- **Changed Files（新增）**：`server/stockSelection/sources/liveSource.ts`（`createLiveSelectionDataSource`：`DbBarStore` 原始行情 + `DbDatasetBuildIO#resolveSt` PIT ST + **同一** `isLimitUpClose` / `limitUpRatio` / `assembleEventRow`）。
- **Changed Files（修改）**：`dataSource.ts`（新增 `SelectionUniverseScope` 与请求字段 `universe`；结果增 `calendarDays`；新增 `SelectionEventRow` / `SelectionBarRow`，允许 `datasetVersionId: null`）· `types.ts`（新增 `SELECTION_UNIVERSE_VIOLATION`）· `strategies/firstLimitPullback3FTopN.ts`（**声明候选宇宙口径**；日历显式来自载体并做覆盖性反证；计划买入日由日历给出）· `sources/datasetSource.ts`（返回 `calendarDays` + 板块反证）· `registry.ts`（注册 live + dataset）· `index.ts` · 单测。
- **口径同源（三条）**：① 首板规则 `当日涨停 && 上一交易日未涨停`（与 `datasetRegistry/builder.ts` 同一表达式）；② 涨停判定 = 同一 `isLimitUpClose` + 同一 PIT ST 比例；③ **候选宇宙 = 主板 + 排除 ST/*ST**（实查 780001：`dataset_build_config.excludeSt=1`、73,003 条事件全部 `boardType='main'`）。宇宙口径属**策略语义**，由策略声明（`UNIVERSE_SCOPE`）、载体执行：live 按 `classifyBoard` + PIT ST 过滤，dataset 做**反证**（板块维度；ST 维度需 PIT 解析，属 live 职责）。
- **PIT 边界（本步修掉一个真缺陷）**：执行日 T0+(n+1) 是**决策日的下一交易日**，其 bar 在决策时不存在 ⇒ live 只读 `<= 决策日` 的行情；日历可含未来（日历是已知信息）但不读未来 bar；计划买入日由日历给出。
- **🔴 中途失败已记录并修复（不掩盖）**：首轮真实对拍 **1 PASS / 3 FAIL**（live 候选 70 vs dataset 47 等，且把 `920475.BJ` 纳入候选导致身份 `NO_IDENTIFIER`）⇒ 根因 = **候选宇宙未对齐**（live 读全市场且未排 ST）。按此修复后复测通过。
- **验证（真实数据，全部只读）**：`STOCK-SELECTION-003` 对拍 **PASS 4 / FAIL 0**，且**逐日候选/合格数与 dataset 完全相同** —— 2020-04-21 `47/22` · 2022-11-10 `30/16` · 2024-02-22 `60/16` · 2025-06-06 `66/48`（Top-3 面板身份、分数、计划买入日逐项一致）。单测 **19/19**（含「live 载体在同一夹具给出与 dataset **同一份**选股结果」）。`tsc --noEmit` 0 错；`node scripts/checkEolDrift.mjs --strict` 0。
- **未做 / 仍需**：① 页面（方案 A 第 2 步）：主表单去掉「数据集版本」，改「数据来源」选择器并默认 live（当前默认仍是 dataset，页面未受影响）；② ④ 行情到账（全市场行情仍只到 `2026-09-04`）—— 在此之前 live 只能选历史日，选不出「今天」。
- **Changed DB / Execution Path**：**无**（0 DDL / 0 DML；不注册执行路径；不进入模拟盘 / 生产链）。
- **Baseline Impact**：minor（新增 live 载体 + 候选宇宙口径；`SYSTEM-BASELINE.md` / `system-manifest.yaml` 头部由并发会话持有，本任务不覆盖）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `STOCK-SELECTION-004`（方案 A 第 2 步：页面主表单去数据集 · 「数据来源」改为主位）

- **Task**：用户指出「选股不该跟数据集挂钩」→ 方案 A 第 2 步：把「数据集版本」从主表单移除，改为「数据来源（载体）」选择器，默认 `live`。
- **Changed Files**：`server/stockSelection/registry.ts`（`StockSelectionRegistry` 增 `listDataSources()`）· `server/stockSelectionRouter.ts`（新增只读端点 `listDataSources`）· `client/src/pages/StockSelection.tsx`（主表单改为 **策略 / 数据来源 / 决策日 / TopN**；「数据集版本（研究口径）」**仅在选择 dataset 载体时出现**；决策日默认今天；结果事实卡展示载体标签与 datasetVersionId）· `tests/server/stockSelectionRouter.test.ts`（+1 例 + appRouter 守卫）。
- **Changed Contracts**：新增只读端点 `stockSelection.listDataSources`（返回 `[{kind,label}]`）。无 `shared/**` 改动。
- **Changed DB / Execution Path**：**无**（0 DDL / 0 DML；只读）。
- **用户可见行为**：日常选股不再需要选择数据集版本（默认走当日行情）；研究口径仍可一键切到数据集快照并选版本。
- **验证**：vitest **20/20**（选股域 13 + router 7）· `tsc --noEmit` 0 错 · `vite build` 成功 · `node scripts/checkEolDrift.mjs --strict` 0。
- **仍需（唯一）**：④ 行情到账 —— `stock_daily_prices` 全市场仍只到 `2026-09-04`（之后 400~500 行/日）⇒ live 载体现在只能选历史决策日，**选不出「今天」**。需 Tushare 同步恢复 + 事件/数据集增量的写库授权。
- **Baseline Impact**：minor（端点 + 页面；`SYSTEM-BASELINE.md` / `system-manifest.yaml` 头部由并发会话持有，本任务不覆盖）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `BAOSTOCK-SYNC-001`（行情回补改走 BaoStock · **诊断完成，尚未写库**）

- **Task**：用户裁定「改用 BaoStock」修复行情断供（`stock_daily_prices` 全市场只到 `2026-09-04`，之后 400~500 行/日），以便 live 选股载体能选出近期决策日。
- **① provider 支持（实查）**：`server/marketData/providers/index.ts` 注册表**已有** `liquidityProviders["baostock-daily"]` 与 BaoStock 指数 provider；`server/marketData/types.ts#LiquidityProviderName` 含 `"baostock-daily"` 且带**独立单位换算表**（`amountToQianYuan: 0.001` 等）⇒ **与 Tushare 口径不同，禁止混用**。
- **② 环境（实测）**：Python **3.12.6**；`baostock 0.9.3` 导入 OK + **login success（error_code=0, 2.9s）**；离线包在仓库根 `baostock-0.9.3.tar.gz`（可 `pip install baostock-0.9.3.tar.gz`，不依赖 PyPI）。先前 `ModuleNotFoundError` 是沙箱读不到用户级 site-packages 的假阴性。
- **③-1 写入路径（实查，零写入）**：入口 = `server/_core/index.ts:122` `POST /api/scheduled/syncStockDailyPrices`；抓取 = `server/tushare.ts:116 fetchTushareDailyPricesByDate(tradeDate)`（按交易日拉全市场）+ `:85 parseTushareDailyPrices`；落库走 `onDuplicateKeyUpdate`（唯一键 `uq_stock_daily_price_stock_date`）⇒ **幂等**。最小改法 = **只替换抓取段**，落库/字段映射/幂等不动。
- **待确认（决定试跑实现）**：`server/_core/index.ts:122` 端点现有实现（并发/分批/重试/`source` 标记）+ `server/marketData/providers/baostock.ts` 既有 Python 桥导出（仓库已有 BaoStock 股票/指数/ST 三条桥 ⇒ **优先复用，不新写 Python**）。BaoStock 无「一日返回全市场」接口，通常需 `query_all_stock(day)` + 逐票 `query_history_k_data_plus`。
- **下一步（已获授权，按序执行）**：② 给端点加 BaoStock 分支（复用既有 pythonBridge）→ ③ **只跑 1 个交易日**并复查（行数 / `source` / `preClosePrice` 非空率 / 与既有行不重复 / spot-check 若干票）→ ④ 复查通过后放开 `2026-09-05 → 今天` 全量回补。
- **DB Impact**：本条**零写入**（0 DDL / 0 DML；全部只读实查）。后续 ③④ 属批量生产数据写入，按用户授权执行。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-06 · `BAOSTOCK-SYNC-002`（STEP 7.3 BaoStock provider · 1 交易日试跑通过 · 全量回补 `2026-09-05`→`2026-10-06`）

- **Task**：按用户 4 步执行 —— ①确认 provider 注入方式 → ②加 BaoStock provider（逐票 + `baostock-daily` 单位换算 + validation）并复用 checkpoint / rateLimiter / retry → ③试跑 1 个交易日并复查（行数 / `source` / `preClosePrice` 非空率 / 无重复 / spot-check）→ ④通过后全量回补 `2026-09-05`→今天（可断点续跑）。承接 `BAOSTOCK-SYNC-001`（诊断）与 `STOCK-SELECTION-00x`（全市场行情停在 `2026-09-04`）。
- **Changed Domains**：辅助域 `marketDataFoundation`（STEP 7.3 回填框架新增 provider 实现）；**未触碰** Strategy Core / Dataset / Research / Backtest / Paper Trading 语义。
- **Changed Files**：
  - 新增 `server/backfill/providerBaostock.ts`：`BaoStockMarketDataProvider implements MarketDataProvider`（`baostockRowToRawBar` / `toBaostockCode` / `BAOSTOCK_RETRY_POLICY`）。
  - 新增 `server/marketData/providers/baostockSession.ts`：BaoStock `session` 驻留会话客户端。
  - 新增 `tests/server/backfill/providerBaostock.test.ts`（8 例）。
  - 改 `server/backfill/units.ts`：新增 `baostock-daily` 换算（`HANDS_PER_SHARE` / `THOUSAND_CNY_PER_CNY` / `convertBaostockDailyUnits`）。
  - 改 `server/backfill/index.ts`（导出）、`server/marketData/providers/index.ts`（导出会话）、`server/marketData/providers/baostock.ts`（`BaostockStockRow.preClose?`）。
  - 改 `scripts/providers/baostock_probe.py`：`stock_daily` 增 `preclose` 字段。
  - 改 `scripts/backfillDaily.ts`：`--provider=tushare|baostock` / `--codes` / `--limit` / `--progress-file`。
  - 改 `tests/server/backfill/units.test.ts`（+7 例）。
- **① provider 注入方式（实查结论）**：`server/backfill/scheduler.ts#BackfillSchedulerDeps` 构造注入 provider-neutral 的 `MarketDataProvider#fetchDailyByTradeDate(tradeDate) -> ProviderDailyResult`；`scripts/backfillDaily.ts` 原硬编码 `TushareMarketDataProvider`，现改为 `--provider` 选择。BaoStock **无「全市场单日」端点**（只能逐票 `query_history_k_data_plus`）⇒ provider 逐票拉整段区间 + 按 `tradeDate` 分桶缓存，对 scheduler 保持「按日取全市场」语义。
- **② 复用与新增**：逐票请求复用 `IntervalRateLimiter` + `withRetry`（`BAOSTOCK_RETRY_POLICY` 3s/6s/12s/24s/48s）；连续失败 5 只冷却 30s；写库阶段复用 `BackfillScheduler` 的 per-day checkpoint + `runDailyPipeline` + `persistInBatches`。逐票结果按「一股一行 JSONL」落 `progressFilePath`（**区间不匹配不复用**）⇒ 取数阶段也可断点续跑。校验复用 `server/backfill/validation.ts#validateCanonicalBackfillBar`（本次未改 validation.ts）。
- **单位口径**：BaoStock 原始 `volume=股` / `amount=元` → `×0.01` / `×0.001` → `stock_daily_prices` 既有口径 `手` / `千元`（与 Tushare 窄样本一致），系数与 `server/marketData/liquidity.ts` 的 `baostock-daily` scale 单一一致。
- **③ 试跑（真实，1 交易日 = `2026-09-30`，全 universe 5552）**：逐票 completed=5552 failed=0；写库 `rowCount=5215`，checkpoint `SUCCESS`。复查：`preClosePrice` 非空 **100%（null=0）**、`open/close` 非空 100%、重复键 **0**、spot-check（`000001.SZ` / `600000.SH` / `300750.SZ` / `688981.SH`）与 BaoStock 原始值逐单位一致（如 `600000.SH`：`volume 147484820 股 → 1474848.2 手`，`amount 1386209937.38 元 → 1386209.93738 千元`）。
- **④ 全量回补（`2026-09-05`→`2026-10-06`）**：目标 17 个交易日（`09-07`…`09-30`；`10-01`…`10-06` 非交易日），`09-30` 已由试跑完成故跳过 16 天。结果：`processed=16 totalRows=83440`，**17/17 SUCCESS、0 FAILED、0 SUSPICIOUS、0 QUOTA_STOPPED**，逐票 5552/5552 成功。区间合计 `stock_daily_prices` = **88,655 行 `source='baostock'`（17 天 × 5215）**，无重复。
- **覆盖范围事实（必须显式登记）**：BaoStock **只支持 `sh`/`sz`**（实测 `bj.*` → 「股票代码未标识 sh 或 sz」）⇒ **北交所（BJ）不在本次回补范围**；研究 universe 来源 `research_security_identifier_history` 本身也只有 SH 2463 + SZ 3089 = 5552。区间内仍留 `source='tushare'` 共 **146 行**（BJ 134 + SZ 12，后者为新上市未进 universe 的代码，如 `301689.SZ`），**未被覆盖也未被改动**。SH+SZ 覆盖与已知全量日 `2026-09-04` 对齐（SH+SZ `09-04`=5207 → `09-30`=5217）。
- **Changed Contracts**：**无**（无 `shared/**` 改动；未新增 tRPC 端点）。
- **Changed DB**：**数据写入，0 DDL / 0 migration**。`stock_daily_prices` 按唯一键 `(stockCode, tradeDate)` 幂等 upsert（`source` 被覆盖为 `baostock`）；`backfill_checkpoints` 写 per-day 状态。**一次性修正**：smoke（`--limit=120`）曾把 `2026-09-30` 标成 `SUCCESS`/96 行（误导）⇒ 已将其 UPDATE 为 `PENDING` 后按全 universe 重跑（**UPDATE 单行，未 DELETE**）。
- **Changed Execution Path**：新增回填 CLI 运维分支；**不进入** 生产 / 研究执行链。
- **Potential Baseline Drift**：`system-manifest.yaml#marketDataFoundation.sourcePaths` 已含 `server/backfill/**` 与 `scripts/backfillDaily.ts`（无需改动）；`ROADMAP`/`STOCK-SELECTION-00x` 记录的「行情只到 2026-09-04」已被本任务解决（该文档头部由并发会话持有，本任务不覆盖）。下游若硬编码 `source='tushare'` 需注意 `2026-09-07`…`2026-09-30` 现为 `baostock`。
- **Regression Result**：`tsc --noEmit` **0 错**；`tests/server/backfill`（16 文件 / **132 用例**）+ `tests/server/marketData` + `tests/server/security` 通过（仅 `tests/server/marketData.test.ts` 4 例为**既有** DB 依赖基线失败，非本次引入）；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：minor（既有域内新增 provider 实现 + 运维 CLI；`SYSTEM-BASELINE.md` / `system-manifest.yaml` 头部由并发会话持有，本任务不覆盖）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `STOCK-SELECTION-005`（选股结果 + 剔除统计持久化 · 手动保存 · 同页历史回看）

- **Task**：用户指令「我需要把这些选股数据都存下来，还有**剔除统计的也要保存，并展示**」，并授权「**允许执行 0055 + 手动保存(B) + 同页历史(A)**」。
- **Changed Domains**：`stockSelection`（选股域：新增**唯一写路径** = 结果快照；`select` 仍纯读）。
- **Changed Files**：
  - 新增 `drizzle/0055_stock_selection_run.sql`（手写幂等 SQL：1 表 + 2 索引）。
  - 新增 `scripts/applyStockSelectionRun.mjs`（专用幂等 apply + 列签名/索引/0 FK/行数断言；`--check` / `--dry-run` / apply）。
  - 改 `drizzle/schema.ts`（`stockSelectionRun` 声明 + `StockSelectionRunRow` / `InsertStockSelectionRunRow`）。
  - 新增 `server/stockSelection/persistence.ts`（`StockSelectionRunStore` 端口 + DB/内存实现 + runId/JSON 纯函数）。
  - 改 `server/stockSelection/index.ts`（导出持久化）。
  - 改 `server/stockSelectionRouter.ts`（新增 `saveRun` mutation + `listRuns` / `getRun` query；`runStore` 可注入）。
  - 改 `client/src/pages/StockSelection.tsx`（「保存选股结果」按钮 + 同页「历史选股记录（含剔除统计）」列表 + 展开明细）。
  - 新增 `tests/server/stockSelection/persistence.test.ts`（12 例）；改 `tests/server/stockSelectionRouter.test.ts`（+5 例，含 appRouter 端点守卫增补）。
- **Changed Contracts**：新增 3 个 tRPC 端点 —— `stockSelection.saveRun`（mutation）/ `stockSelection.listRuns` / `stockSelection.getRun`（query）。**无 `shared/**` 改动**。
- **Changed DB**（**已授权并已执行**）：
  - 新增表 **`stock_selection_run`**（19 列：坐标快照 + `picksJson` + **`excludedJson`（剔除统计）** + 候选/合格计数 + 事件窗 + `capturedAt`）；
    唯一键 `uq_stock_selection_run_runId`；索引 `idx_stock_selection_run_decision` / `idx_stock_selection_run_strategy`；**零 FK**。
  - 幂等实证：第 1 次 `executed=3 / skipped=0`；第 2 次 `executed=0 / skipped=3`；`--check` PASS（60 项断言）。
  - E2E 实证：`save → list → get → 同坐标再 save` 12/12 PASS（`runId=SEL-20260930-5eb73d0b`，库内该 runId 行数=1），
    **探针行已清理**（`DELETE` 仅限本轮自建探针行；表内 0 残留）。
  - **未触碰**任何既有表 / 历史行情 / 数据集 / 策略版本；`stock_daily_prices` 等一律只读。
- **Changed Execution Path**：**无**。新增的 `saveRun` 只写快照表，不进入策略 / 数据集 / 回测 / 模拟盘执行链；`select` 无副作用不变。
- **剔除统计口径**：**保存的是当时那份 `filterStats.excluded`**（原因码 → 条数，键序稳定写入），
  历史回看直接渲染快照，**不重算** ⇒ 回看的就是当时的口径；重算仍只走 `server/research/compositeRunner` 这一权威实现。
- **Potential Baseline Drift**：`DATABASE-MAP.md` 已追加 `## D-95`（新表，真实库表数 70 → 71）；
  ⚠️ `scripts/applyStockSelectionRun.mjs` 位于 `.gitignore` 的 `/scripts` 之下 ⇒ **入库需 `git add -f`**（同既有 apply 脚本惯例）。
- **Regression Result**：`tsc --noEmit` **0 错**；`vitest run tests/server/stockSelection tests/server/stockSelectionRouter.test.ts tests/server/backfill` = **19 文件 / 169 用例全过**；
  `vite build` **成功**（3116 modules）；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：minor（新增 1 表 + 3 端点 + 1 页面区块；`SYSTEM-BASELINE.md` / `system-manifest.yaml` 头部由并发会话持有，本任务不覆盖）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `STOCK-SELECTION-006`（选股清单展示：股票名称 + K 线弹窗 · 复用既有端点与组件）

- **Task**：用户指令「剔除统计的也展示出来，同时也保存进去，然后**都展示股票名称**，还要把 **K 线**展示出来」+ 补充「**类似于之前那种交易详情的弹窗**」。
- **Changed Domains**：`stockSelection`（**仅展示层**）；未改选股语义、未改任何服务端契约。
- **Changed Files**：
  - 新增 `client/src/lib/stockSelectionPicks.ts`（纯函数：名称 / 代码 / K 线窗口派生）。
  - 改 `client/src/pages/StockSelection.tsx`：新增共用 `PicksTable`（**当前选股结果**与**历史明细**共用）；
    列增「名称」+「K 线」操作；点「K 线」开 **交易详情同款弹窗** `StockKlineDialog`。
  - 新增 `tests/client/src/lib/stockSelectionPicks.test.ts`（6 例）。
- **剔除统计（复述确认）**：**已保存**（`stock_selection_run.excludedJson`，见 `STOCK-SELECTION-005`）**且已展示**两处 ——
  ①「本次结果」下方「剔除统计（为什么没选上）」；②「历史选股记录」每行内联徽章（**读的是快照，不重算**）。
- **名称来源（复用，不新建第二套）**：`researchRun.securityLabels`（既有「证券名称 + 代码」字典端点，
  内部 `loadSecurityLabels`；名称源 = `limit_up_records`）。**取不到 ⇒ 显示 `—`，绝不用代码冒充名称**。
  实查：名称源覆盖 **4352** 个代码（全 universe 5552）；本策略候选本身即首板事件 ⇒ 实盘选股命中率高。
- **K 线（复用，不新写图表）**：`client/src/components/strategy/StockKlineDialog`（回测 / 3F 面板同款弹窗），
  数据走既有 `researchRun.stockDailySeries`（OHLC + 成交量 + MA5/10/20，区间前后各 30 交易日）。
  **窗口 = 事件日 T0 ~（计划买入日 ?? 信号日）**；无事件日 ⇒ 按钮禁用（不开空窗口）。
  实查：`000001.SZ` 窗口返回 **35 根** bar，末端 `2026-09-30` 为本次 BaoStock 回补数据（`11.36/11.65/11.33/11.57`）。
- **Changed Contracts**：**无**（零新增端点、零 `shared/**` 改动；纯复用 + 客户端展示）。
- **Changed DB**：**无**（0 DDL / 0 DML；仅只读查询）。
- **Changed Execution Path**：**无**（纯只读展示；K 线弹窗沿用既有只读端点）。
- **Potential Baseline Drift**：无。
- **Regression Result**：`tsc --noEmit` **0 错**；
  `vitest run tests/server/stockSelection tests/server/stockSelectionRouter.test.ts tests/client/src/lib/stockSelectionPicks.test.ts tests/client/src/components/strategy/StockKlineDialog.test.ts`
  = **5 文件 / 46 用例全过**；`vite build` **成功**；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Impact**：minor（仅客户端展示层 + 1 个纯函数模块与测试；`SYSTEM-BASELINE.md` / `system-manifest.yaml` 头部由并发会话持有，本任务不覆盖）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `STOCK-SELECTION-007`（剔除统计下沉到**逐只股票** · 保存 + 展示）

- **Task**：用户「**剔除统计的股票还是没展示出来，我需要展示出来**」——此前只有「原因码 → 条数」，没有「**哪只票**为什么没选上」。
- **Changed Domains**：`research/compositeRunner`（**加性扩展**，行为不变）+ `stockSelection`（口径落库 + 展示）。
- **Changed Files**：
  - 改 `server/research/compositeRunner/index.ts`：新增 `CompositeEventExclusionReason` / `CompositeEventExclusion`，
    `buildCompositeEvents` 返回**新增**字段 `exclusionRecords`（在**同一次循环**、与 `accounting` 同一批判断里 push）。
  - 改 `server/stockSelection/types.ts`：新增 `StockSelectionExcludedStock`；`filterStats` 增 `excludedStocks`。
  - 改 `server/stockSelection/strategies/firstLimitPullback3FTopN.ts`：`excluded` 计数**改由逐只明细归并**（`countByReason`），
    二者恒自洽；逐只明细补齐 `canonicalSecurityId / code / eventId / eventDate / reason`。
  - 改 `server/stockSelection/persistence.ts`：`excludedJson` 形状扩为 `{counts, stocks}`（**同一 longtext 列，无 DDL**），
    解析**兼容旧「纯计数」形状**；`StockSelectionRunSummary` 增 `excludedStocks`。
  - 改 `client/src/pages/StockSelection.tsx`：新增 `ExcludedStocksList`（按原因分组，逐只显示 `名称 代码 · 事件日`），
    用于**本次结果**与**历史展开**；`FACTORS_UNAVAILABLE` 中文标签。
  - 改 `drizzle/schema.ts`（**仅列注释**描述新 JSON 形状）。
  - 测试：`tests/server/stockSelection/firstLimitPullback3FTopN.test.ts`（+1 例：逐只明细与计数自洽）、
    `tests/server/stockSelection/persistence.test.ts`（13 例，含旧形状兼容）、`tests/server/stockSelectionRouter.test.ts`（断言逐只明细落库/读回）。
- **口径纪律（关键）**：逐只明细由**唯一权威实现** `buildCompositeEvents` 产出 ⇒ **不存在第二套过滤逻辑**；
  计数由明细归并 ⇒ 不会出现「有数量、没票」或「有票、数量对不上」。
  新增原因码 `FACTORS_UNAVAILABLE`（观察窗完整但三因子算不出，原先被并入「无回踩」，现**如实单列**）。
- **Changed Contracts**：`DailyStockSelection.filterStats` 增 `excludedStocks`（**加性**；既有 `excluded` 语义不变）。
  无新端点、无 `shared/**` 改动。
- **Changed DB**：**0 DDL / 0 migration**。`stock_selection_run.excludedJson` 内**同列扩展 JSON 形状**
  （表内既有 0 行 ⇒ 零兼容风险；解析器仍兼容旧形状，历史行可读）。
- **Changed Execution Path**：**无**（回测/研究链只多出一个被忽略的返回字段；`compositeDatasetProvider` 为解构消费，实测不受影响）。
- **Potential Baseline Drift**：`excluded` 中 `NO_PULLBACK_IN_OBSERVATION_WINDOW` 的计数可能因 `FACTORS_UNAVAILABLE` 单列而**变小**
  —— 这是**更如实**的分类，不是回归。
- **Regression Result**：`tsc --noEmit` **0 错**；
  `vitest`（stockSelection + stockSelectionRouter + research/compositeRunner + researchExperiments 相关 + client 助手）
  = **13 文件 / 81 用例全过**；E2E 探针（真库 `save→list→get` 含逐只明细）**11/11 PASS**，
  探针行已清理；`vite build` **成功**；`checkEolDrift --strict` **0**。
- **Baseline Impact**：minor（`CHANGE-AUDIT` 追加；`SYSTEM-BASELINE.md` / `system-manifest.yaml` 头部由并发会话持有，本任务不覆盖）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `STOCK-SELECTION-008`（剔除明细改为**与选股同款表格** · 表内只放「剔除原因」）

- **Task**：用户「被剔除的展示形式也跟选股一样，**只在表格中展示被剔除原因**」——上一版是按原因分组的徽章/胶囊流，与选股清单表格不一致。
- **Changed Domains**：`stockSelection`（**纯展示层**）；无服务端/DB 改动。
- **Changed Files**：
  - 改 `client/src/pages/StockSelection.tsx`：`ExcludedStocksList`（分组徽章）→ **`ExcludedStocksTable`**（与 `PicksTable` 同款表格）。
  - 改 `client/src/lib/stockSelectionPicks.ts`：新增 `buildKlineTargetForExcludedStock`（剔除票的 K 线窗口）。
  - 改 `tests/client/src/lib/stockSelectionPicks.test.ts`（+2 例）。
- **表格形态（与选股清单对齐）**：`名称 | 代码 | 事件日 T0 | 剔除原因 | K 线`。
  相比选股清单，**用「剔除原因」替换掉「分数 / 横截面分位 / 计划买入」**（剔除票没有这些量，不编造）；
  「K 线」沿用**交易详情同款弹窗**，窗口以**事件日 T0** 为中心（剔除票没有买入日）。
- **计数呈现**：不再铺一组徽章，改为表格上方一行 `共 N 只被剔除`；明细缺失（旧记录只存计数）时如实追加说明。
- **Changed Contracts**：**无**。**Changed DB**：**无**（0 DDL / 0 DML）。**Changed Execution Path**：**无**。
- **Regression Result**：`tsc --noEmit` **0 错**；
  `vitest`（stockSelection + router + research/compositeRunner + client 助手/K 线助手）= **11 文件 / 75 用例全过**；
  `vite build` **成功**；`checkEolDrift --strict` **0**。
- **Baseline Impact**：minor（`CHANGE-AUDIT` 追加）。
- **GLOBAL AUDIT REQUIRED**：NONE。
---

## 2026-10-06 · `REPO-HYGIENE-ROOT-RESULT-FILING-001`（根目录整理：删误产物 + RESULT 报告归位 docs/research + 清 .cache 浏览器 profile）

- **Task**：用户「整理根目录文件夹，有些没用的文件删掉」→ 裁定执行 A（RESULT 报告归位）+ B（清 `.cache` 浏览器 profile）。
- **Changed Domains**：**无**（文档 / 仓库卫生；0 业务代码）。
- **Changed Files**：
  - 删除根目录 **27** 个 0 字节误产物 / 临时日志（零内容、零引用、未跟踪或被 gitignore）。
  - 归位 **36** 份根目录 `RESULT-*.md` / `RESEARCH-TEMPLATE-*.md` → `docs/research/`（用 Move-Item，因均未被跟踪）。
  - 改 `ROADMAP.md`（5 处裸文件名指针 → `docs/research/…`）· `docs/architecture/CHANGE-AUDIT.md`（6 处同上）。
  - 删除 `.cache/edge-backtest-*` + `.cache/edge-headless-profile*`（15 目录，≈538 MB，Edge 无头浏览器临时 profile）。
- **Changed Contracts**：**无**。**Changed DB**：**无**。**Changed Execution Path**：**无**（0 import 变动）。
- **Potential Baseline Drift**：**无**。**未动**：`calibrate_open_expectation.ts`（被 `server/openExpectation.ts` 注释当可执行命令引用）· 被引用的跟踪文档（`TASK_TRACKING` / `AUDIT-DRS-001-EVIDENCE` / `DEVELOPMENT_PLAN` / `ROADMAP-CHANGELOG`）。
- **Regression Result**：`checkEolDrift --strict` **0**（指针改写为纯插入，字节增量 = 14 × 替换数：`ROADMAP.md` +70、`CHANGE-AUDIT.md` +84，无其他字节变化）；归位后跟踪文件中对该批文件名的**裸引用残留 = 0**。
- **Baseline Impact**：minor（`CHANGE-AUDIT` 追加）。保留 `.cache/datasets` · `.cache/leader-candidate-backtest` · `.cache/ROADMAP.before-47-split.md`。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `FLOW-001-P3-3570001-CONVERGENCE-001`（单策略专项页收敛：3570001 → 通用策略详情 Tab）

- **Task**：用户「重新规划前端页面中关于 3570001 的选项，这个 tab 不能单独存在，最好能与通用兼容起来」——关闭 `FLOW-001` §5/§6 的唯一 P3 遗留（此前登记为「需产品决策」）。
- **Changed Domains**：**Frontend（信息架构 / 路由 / 深链）**；0 业务语义、0 端点、0 DB。
- **Changed Files**：
  - 改 `client/src/components/AppShell.tsx`：删除「最终评估 3570001（专项）」「模拟盘 3570001（专项）」两个侧栏项（④ 策略 7→6、⑥ 前向与复盘 3→2；**侧栏不再出现任何策略坐标**）。
  - 改 `client/src/App.tsx`：两条旧路径 `/strategy-final-evaluation` · `/paper-trading-3570001` 由「渲染专项页」改为 `<Redirect>` 到 `/strategies/<3570001 坐标>?version=1.0.0&tab=evaluation\|paper`（静态改写，旧书签不 404）。
  - 删 `client/src/pages/StrategyFinalEvaluation.tsx` · `client/src/pages/PaperTrading3570001.tsx`（收敛后无消费者；留档展示只剩一套视图）。
  - 改 `client/src/pages/StrategyDetail.tsx`：新增 `?tab=` 深链（`STRATEGY_DETAIL_TABS` 白名单；未知值退回 `definition` 不报错）；`Tabs` 由非受控 `defaultValue` 改为受控 `value/onValueChange`，切换 `replace` 写回 URL 且保留 `?version=`。
  - 改 `client/src/components/strategy/StrategyVersionArtifactsTabs.tsx`：头注释同步；模拟盘 Tab 在**留档自己声明** `runner.state === "NEW_HIGH_3"` 时补回原专项页的信号级 `NEW_HIGH_3` 标记列（数据驱动，不硬编码策略坐标）。
  - 改 `client/src/pages/PaperTrading.tsx`：`/paper-trading` 头部补一句分工说明（本页只负责新建 / 推进前向运行；按版本看留档在策略详情 Tab）。
  - 改 `tests/client/src/pages/pageFlowContracts.test.ts`：§15 集合 28→27 项（−2 专项项，+ 并发会话已落地的 `/stock-selection`）、§16 的 ⑥ 组期望；新增 §42–§45（侧栏无策略坐标 / 旧路径为 Redirect 且专项页文件已删 / `?tab=` 白名单与受控写回 / 通用 Tab 只走通用端点且不写死坐标）。
  - 改 `docs/product/FLOW-001-page-workflow.md`（§1/§2/§4/§5/§6 + 状态行）；改 `docs/architecture/CONTRACT-MAP.md` C-99；改 `server/researchRunRouter.ts`（**仅注释**，指向已收敛的事实）。
- **Changed Contracts**：**无**（tRPC 顶层 key 与 input/output 形状未变；`getFinalEvaluation` / `getPaperTrading3570001` 保留为薄封装，现无前端消费者）。
- **Changed DB**：**无**（0 DDL / 0 DML / 0 migration）。
- **Changed Execution Path**：**无**（未动 `strategyCore` / simulator / Dataset 坐标；纯前端渲染与路由）。
- **Potential Baseline Drift**：无新增；反倒**消除**一条 —— `docs/INDEX.md` 中 2026-10 的 `RESULT-*` 条目仍按**当时**事实写「新增前端页 `/strategy-final-evaluation` / `/paper-trading-3570001`」，属历史记录，不改写。
- **Regression Result**：`tsc --noEmit` **0 错**；`vitest run tests/client/src/pages/pageFlowContracts.test.ts` **44/44 通过**；`checkEolDrift --strict` **0**。
- **Baseline Impact**：minor（`CHANGE-AUDIT` 追加 + `FLOW-001` 状态更新 + `CONTRACT-MAP` C-99 补记）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `FLOW-001-P3-3570001-CONVERGENCE-PLAN-001`（按技能补齐该任务的规范化规划与状态收口）

- **Task**：用户「按照技能规划任务」——把上一轮的收敛改动补成**符合 `.agents/orchestrator` / `product` / `frontend` 规则的规范化任务规划**，并把状态收口写回基线。
- **Changed Domains**：**文档 / 过程状态**（0 业务代码、0 契约、0 DB、0 执行链）。
- **Changed Files**：
  - 新增 `docs/product/FE-PLAN-005-single-strategy-page-convergence.md`：Goal 七要素（objective / DoD / verification / constraints / scope / non-goals / 停止条件）· Pipeline 与裁剪理由（跳过 RESEARCH/STRATEGY/BACKEND，INTEGRATION+REFACTORING 合并，DATABASE = N/A）· Product §8 十项规格 · Frontend §8 十项方案 · Architecture 只分析影响面 · 8 条可测验收标准（AC-1..AC-8）· Verification 命令与真实渲染证据 · Risks / Needs Human · Handoff 顺序。
  - 改 `docs/INDEX.md`：登记 FE-PLAN-005（进入「产品 / 前端方案」表）。
  - 改 `.agent/task-state.yaml`：新增 `SPECIAL_PAGE_CONVERGENCE: COMPLETE`（stages + completed 同步）；`last_action` / `last_verification` / `next_action` 更新；`scope.in` 增列该收敛项。
- **Changed Contracts**：**无**。**Changed DB**：**无**。**Changed Execution Path**：**无**。
- **Potential Baseline Drift**：无。`FE-PLAN-005` 的状态写为 IMPLEMENTED 而非 PROPOSED，因为该任务的实现与验证已于同日完成并留有证据（§8/§9）。
- **Regression Result**：纯文档改动（无 `.ts` / `.tsx` 变更）⇒ 未新增/未删除任何测试；`checkEolDrift --strict` 复跑 **0**（新文件为 LF）。
- **Baseline Impact**：minor（`CHANGE-AUDIT` 追加 + `INDEX` 登记 + `task-state` 阶段收口）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `FRONTEND-EMPTY-ERROR-STATES-001`（空态/错误态覆盖：读取失败不再被伪装成空数据）

- **Task**：`.agent/task-state.yaml` 的 `EMPTY_ERROR_STATES` 阶段 —— 全站扫描「空态 / 错误态 / 加载态」覆盖，并补齐缺口。
- **Changed Domains**：**Frontend（展示层诚实性）**；0 契约 / 0 DB / 0 执行链 / 0 策略语义。
- **扫描口径与结果**：`client/src/pages/**/*.tsx` 中所有含 `useQuery(` 的页面 ⇒ **32 个页面**；修复后**三态齐全 32/32、缺口 0**（判据与结果见 `docs/product/FE-PLAN-006` §2）。
- **Changed Files**：
  - 改 `client/src/pages/ReviewWorkbench.tsx`：列表分支改为 `loading → **error** → empty`（此前 `listQuery` / `detailQuery` **没有任何 error 分支**，读取失败会落到「暂无前向纸面运行」）；详情补 `detailQuery.isError`；统一使用共享 `ErrorState`。
  - 改 `client/src/pages/PaperTrading.tsx`：运行列表分支改为 `loading → **error** → empty`；运行详情补 error 分支（此前失败会显示「暂无前向运行」）。
  - 改 `tests/client/src/pages/pageFlowContracts.test.ts`：新增 §46（全站 32 页三态扫描锁，含 EXEMPT 机制）+ §47（ReviewWorkbench error≠empty 定点锁）+ §48（PaperTrading 分支顺序与诚实文案锁）。
  - 新增 `docs/product/FE-PLAN-006-empty-error-state-coverage.md`（扫描方法 / 2 处修复 / 真实渲染证据 / backlog）；改 `docs/INDEX.md`（登记 006）；改 `.agent/task-state.yaml`（`EMPTY_ERROR_STATES: COMPLETE`，`current_stage` → `TABLE_SEMANTICS_TRIAGE`）。
- **Changed Contracts**：**无**（未改任何 tRPC 过程 / schema）。**Changed DB**：**无**。**Changed Execution Path**：**无**。
- **Regression Result**：`tsc --noEmit` **0 错**；`vitest run tests/client/src/pages/pageFlowContracts.test.ts` **47/47**；`checkEolDrift --strict` **0**。
- **真实渲染证据（关键）**：用 CDP `Fetch` 域把 `sentiment.listPaperTradingRuns` 打成失败 ⇒ `/review-workbench` 显示「前向纸面运行列表读取失败 + RPC_ERROR」且**不**出现「暂无前向纸面运行」；`/paper-trading` 显示「运行列表读取失败：Failed to fetch」且**不**出现「暂无前向运行」（**2/2**）。对照组（不拦截）`/review-workbench` 正常渲染 4 条运行 ⇒ error 分支不误触发。
- **未做（已登记 backlog）**：4 个**解构式**取数页面的主查询未捕获 `error`（`Market.tsx` / `LimitUpReview.tsx` / `SentimentAlerts.tsx` / `Backtest.tsx`）——需先判定主查询并设计聚合错误条，登记于 `FE-PLAN-006` §5 与 task-state `next_action`，未静默丢弃。
- **Potential Baseline Drift**：无。`StrategyVersionCompare` / `BacktestCompare` 属既有 `<query>.error ? ...` 写法，判定为「已有错误面」，不改。
- **Baseline Impact**：minor（`CHANGE-AUDIT` + `INDEX` + `task-state` + 新增 `FE-PLAN-006`）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `FRONTEND-TABLE-SEMANTICS-TRIAGE-001`（表格排序/分页语义分类登记 · 只分类不改行为）

- **Task**：`.agent/task-state.yaml` 的 `TABLE_SEMANTICS_TRIAGE` 阶段 —— 对全站表格的排序 / 分页语义做**分类登记**（`FE-PLAN-006` 收尾后的下一项）。
- **Changed Domains**：**文档（只读扫描结论）**；**0 代码 / 0 契约 / 0 DB / 0 行为变化**。
- **扫描口径与结果**：`client/src/**/*.tsx` 中含 `<table>` 或 `<DataTable>` 的文件 = **29 个**（数据表 23 / 非数据表 6；判据 = `clientSort: .sort(` ∧ `useMemo`；`serverLimit: limit:`；`clientSlice: .slice(`）。
- **结论**：① **全站没有任何一处服务端分页** —— 所有「翻页/截断」都是「服务端 `limit` 截断 + 客户端展示」；② 排序一律是**客户端** `useMemo().sort()`（只有带排序控件的表才排）；③ 语义**一致**，故本轮**维持现状**，不引入第二套表格封装、不改任何排序行为；④ 若将来引入服务端分页/排序，属**契约变更**，须走 Architecture + Product，不得在页面内加 state 解决。
- **Changed Files**：新增 `docs/product/FE-PLAN-007-table-sorting-pagination-triage.md`（分类表 A–E + 局限声明 + 规模风险点）；改 `docs/INDEX.md`（登记 007）；改 `.agent/task-state.yaml`（`TABLE_SEMANTICS_TRIAGE: COMPLETE`，`current_stage` → `FINAL`）。
- **Changed Contracts / DB / Execution Path**：**均无**。
- **规模风险点（登记，未改）**：`Backtest.tsx`（27 个 `<table>`）与 `SearchRobustnessPanel` 的「客户端排序 + 切片」在主线程上有压力；`DatasetListTable` / `VersionListTable` / `PerformanceDashboard` / `Upload` 四张**域内全量表无任何上限**，数据量上来时需显式截断并如实标注。
- **Regression Result**：纯文档（本阶段无 `.tsx` 变更）⇒ 零新增/零删除测试；`checkEolDrift --strict` **0**（两个新文档均为 LF）。
- **Baseline Impact**：minor（`CHANGE-AUDIT` + `INDEX` + `task-state` + 新增 `FE-PLAN-007`）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `FE-PLAN-008-STRATEGY-DOMAIN-OPTIMIZATION-PLAN`（④「策略」域页面优化：只出计划，未改代码）

- **Task**：用户「优化策略里面这几个页面，使用技能先给出计划」⇒ 按 `.agents/product` §8 + `.agents/frontend` §8 + `.agents/orchestrator` §4.2/§7 产出**待裁定方案**（PROPOSED，不改代码）。
- **Changed Domains**：**文档（方案）**；**0 代码 / 0 契约 / 0 DB / 0 执行链**。
- **Changed Files**：新增 `docs/product/FE-PLAN-008-strategy-domain-pages-optimization.md`（现状盘点 8 个入口 · 问题清单 P0/P1/P2 · IA 草图 · Product/Frontend 十项 · AC-1..AC-5 · Pipeline · 3 条 NEEDS_HUMAN · 5 步顺序）；改 `docs/INDEX.md`（登记 008）。
- **实查依据（写进方案，可复核）**：`PerformanceDashboard.tsx` 无 `useSearch`/`useParams`、无 `strategyId`/`version` 入参；`BacktestRuns.tsx`/`BacktestCompare.tsx` 仅 `strategyId`；`PaperTradingTemplate.tsx` 三张表直接渲染 `s.stock`/`p.stock`（真实渲染截图显示 `sec_<uuid>:event:002279.SZ@…`）；`useSecurityLabels.ts` 头注释已声明「前端不做身份翻译」且当前仅 1 个消费者；`StrategyHeader.tsx` 的 `StatusBadge` 直出生命周期状态；`adapters/strategyListAdapter.ts` 缺省 `status` fallback 为 `"Draft"`。
- **Changed Contracts / DB / Execution Path**：**均无**（方案未落地）。
- **NEEDS_HUMAN（方案内登记，未自行裁定）**：NH-1 `/performance` 定位（技术预览加隔离条 / 收敛 / 参数化）· NH-2 `status` 缺省值是否改 `UNKNOWN` · NH-3「运行回测」Tab 出口是否立项（先实测）。
- **Regression Result**：纯文档 ⇒ 零新增/零删除测试；`checkEolDrift --strict` **0**。
- **Baseline Impact**：minor（`CHANGE-AUDIT` + `INDEX` + 新增 `FE-PLAN-008`）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `FE-PLAN-008-S1-NH1B-NH2A`（策略域优化落地：证券可读化 + 状态诚实 + 绩效入口收敛）

- **Task**：用户裁定「NH-1 **B** / NH-2 **A** / NH-3 暂不立项」⇒ 按 `FE-PLAN-008` 执行 S1 + NH-2A + NH-1B（NH-3 不推进）。
- **Changed Domains**：**Frontend（策略域展示 + 信息架构）**；0 策略语义 / 0 契约 / 0 DB / 0 执行链。
- **Changed Files**：
  - 新增 `client/src/components/strategy/SecurityCell.tsx`：把「证券 = 名称 + 代码，四态如实回退」抽出为**共用**组件（原实现只存在于 `ClosedLoopRunResultPanel` 内）。
  - 改 `client/src/components/strategy/ClosedLoopRunResultPanel.tsx`：删除本地 `SecurityCell`，改 import 共用组件（**消除重复**，不新增第二套）。
  - 改 `client/src/components/strategy/PaperTradingTemplate.tsx`：模拟盘留档 **4 张表**（今日策略池 / 近期信号 / 当前持仓 / 历史交易）全部改走 `SecurityCell`；模板内渲染 `<SecurityLabelChunks>` 发起 `researchRun.securityLabels` 只读查询；标签未到 / 失败回退原始 id。
  - 改 `client/src/components/common/StatusBadge.tsx`：新增可选 `title`（给状态码补人类解释）。
  - 改 `client/src/components/strategy/StrategyHeader.tsx`：生命周期徽章补 `title`，明确「表示流程走到哪一步，与是否存在回测 / 评估 / 模拟盘留档无关」。
  - 改 `client/src/adapters/strategyListAdapter.ts`：缺省 `status` 由 `"Draft"` → `"UNKNOWN"`（受控词表既有值，neutral 色），**不再臆造生命周期值**。
  - 改 `client/src/components/AppShell.tsx`：④ 策略删除「绩效仪表盘」入口（6→5，侧栏总数 27→**26**）。
  - 改 `client/src/pages/PerformanceDashboard.tsx`：顶部加「技术预览 · 已不在侧栏」归属声明 + 指向「策略 → 该版本 → 最终评估」。
  - 改 `tests/client/src/pages/pageFlowContracts.test.ts`：§15 集合 27→26（去掉 `/performance`）；新增 §49（模拟盘 4 处走共用 SecurityCell 且无第二份实现）· §50（缺省状态不冒充 Draft + 徽章带解释）· §51（绩效退出侧栏但页面必须声明归属并指向策略）。
  - 改 `docs/product/FLOW-001-page-workflow.md`（④ 6→5、`/performance` 收敛行、结构锁 §49–§51）；改 `docs/product/FE-PLAN-008-...md`（NH-1/NH-2 标记已裁定 + §11 执行记录）。
- **Changed Contracts**：**无**（复用既有只读端点 `researchRun.securityLabels`；未改任何 input/output）。**Changed DB**：**无**。**Changed Execution Path**：**无**。
- **真实渲染证据**：策略详情「模拟盘」Tab 的证券列由 `sec_63f8df6e-…:event:002279.SZ@2026-08-28` 变为「久其软件 / 002279.SZ」（`柳钢股份 / 601003.SH`、`天融信 / 002212.SZ` 同）；页面全文 `sec_<uuid>` 命中 **0**；侧栏实测 **26** 项且无「绩效仪表盘」；`/performance` 顶部归属声明命中。
- **未做（如实登记）**：`FE-PLAN-008` §S2「详情 Tab 带走坐标的出口链接」未落地；P1-2（运行回测出口）按用户裁定**暂不立项**；P2-1 的绩效内容归位属进一步取舍，本轮只做**入口收敛 + 归属声明**。
- **Regression Result**：`tsc --noEmit` **0 错**；`vitest run tests/client/src/pages/pageFlowContracts.test.ts` **50/50**；`checkEolDrift --strict` **0**。
- **Baseline Impact**：minor（`CHANGE-AUDIT` + `FLOW-001` + `FE-PLAN-008`）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `T74-SUBNEW-FILTER-001`（151% 策略：次新股要不要从候选池剔除 · 真实对照实验）

- **Task**：用户先问「151% 策略里有多少是买次新股的（上市一年内）」，在做完只读诊断（1429 笔已实现交易中 **51 笔 = 3.57%** 为次新、净利 +10,324 元 = 5.47%）后，要求「做一下对照实验」验证**次新股要不要从候选池里剔除**。
- **Changed Domains**：research（组合层新增**排序前**候选池过滤）· research-experiment（新实验入口）· security（新增只读上市日批量装载）。
- **Changed Files**：
  - `shared/researchExperimentsContracts.ts`：`extensionSelectionArms[].excludeListedWithinDays?: number|null`（可选；缺省 = 既有行为）。
  - `server/research/compositeRunner/index.ts`：`BuildCompositeSourceRunInput.candidateListingFilter`（**排序 / 门槛 / 融合之前**执行）+ `ListingFilterAccounting` + `baseSecurityIdOf` + `listingAgeDays`；`buildFirstLimitPullback3FTop3SourceRun` 透传。
  - `server/researchExperiments/compositeDatasetProvider.ts`：臂级 `excludeListedWithinDays`、请求 `includeListingDates`、载荷 `listingDateBySecurityId`（base securityId → `YYYY-MM-DD`）。
  - `server/security/repository.ts`：新增只读 `loadListedDatesBySecurityIds`（批量 `IN`，500/批）。
  - `research-experiments/compositeRunnerBridge.ts`：追加 re-export。
  - 新增 `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-subnew/**`（experiment / page / README）。
  - 注册：`research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts` · `client/src/pages/researchExperiments/experimentModes.ts`（分档台账 45 → 46）。
  - 测试：新增 `tests/server/research/compositeRunner/listingFilter.test.ts`（6 例）· `tests/server/researchExperiments/compositeRunnerT74SubNew.test.ts`（5 例）；`tests/client/.../researchExperimentModeGrouping.test.ts` 台账 45 → 46。
- **Changed Contracts**：3 个**可选**字段（`excludeListedWithinDays` / `includeListingDates` / `candidateListingFilter`）+ 1 个载荷字段（`listingDateBySecurityId`）；**缺省路径逐字段不变**（控制臂 parity PASS 为证据）。
- **Changed DB**：无 schema / migration；新增真实 Run **1 条**（`RUN-20261007-68FD5C7F`，COMPLETED，datasetVersionId 780001，约 168 s）；全程 SELECT 只读。
- **Changed Execution Path**：无 simulator / canonicalMetrics / Strategy Core 改动；未注册生产执行路径；未创建 StrategyVersion / Candidate。
- **口径（新增能力）**：上市日 = Security Master `research_securities.listedDate`（PIT，决策日已知）；上市龄 = **决策日** − 上市日（自然日）；上市日不可得 ⇒ **不剔除**并如实计数（alpha 资格过滤 ≠ 风控，不可证实身份不得静默排除）。实测四臂该计数 = **0**。
- **真实结果（C = Runner T74，全周期）**：控制臂 `151.0958341843399%` / MaxDD `43.302944323482485%` / 1434 笔 / trigger 161（**parity PASS**，与 `6210006` 逐项一致）；
  `excl365` `65.39066943458027%` / `50.771567473378596%` / 1444 笔 / 剔除候选 1591（Δ `-85.71 pp`）；
  `excl180` `131.14772353143985%` / `43.036340068098156%` / 1434 笔 / 剔除 904 / **≥+50% 9→10**（Δ `-19.95 pp`）；
  `excl90` `109.96556364480013%` / `44.81625053042115%` / 1437 笔 / 剔除 478（Δ `-41.13 pp`）。
- **结论**：**REJECTED —— 剔除次新股不改善收益**（三阈值全部低于控制臂）。机制：被剔除名额由**低名次递补**，而 P4 已实测 rank4/5 递补净利为负、0 笔 ≥+50% ⇒ 「剔除次新」实际是**换一批更差的票**。阈值与结果**非单调**（365 最差、180 最好、90 居中），再次复现既有结论：**任何选股层微扰都以随机方式大幅改变结果**。
- **口径互证**：控制臂复算的次新成交 51 笔 / 净利 +10,324 / 1 笔 ≥+50%，与独立只读探针 `T74-SUBNEW-SHARE-001`（3.57% / 5.47%）逐项一致。
- **未变化 / 未做**：未改 `3600005@2.0.0` / `3570001` / 历史 Run；未建策略版本；未跑 OBSERVATION / HOLDOUT；**未测**「选中后跳过、不递补」语义（P9 那种只过滤 intent，需另起一臂）。
- **Regression Result**：`tsc --noEmit` **0 错**；定向 5 文件 **33 例全绿**（含新 11 例）；`node scripts/checkEolDrift.mjs --strict` **0**。⚠️ 既存失败文件（非本任务引入，文件本身与 HEAD 一致）：`tests/server/researchExperiments/threeFactorTopNStrategyDocument.test.ts` 3 例（`mapDeclaredExitPolicy` 已增 `recoveryPath: null`，用例未同步）。
- **Baseline Update**：新增 `docs/research/RESULT-T74-SUBNEW-FILTER-001.md`；本条目；`system-manifest.yaml` 增 `t74SubNewRunP10`。`SYSTEM-BASELINE.md` 头部由并发会话持有，本任务不覆盖。
- **Baseline Impact**：minor（可选契约字段 + 新实验入口 + 真实运行结果登记）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `DATASET-EXCLUDE-SUBNEW-001`（数据集 universe 新增「上市龄」维度 + v9 构建 · 用户授权 A/B）

- **Task**：用户裁定「① 允许在数据集 builder 新增『排除上市 < 365 天』这一 universe 维度；② 允许执行 v9 数据集构建；③ 入场/退出要**可配置**，不接受钉死固定日」⇒ 本条目登记 ① 的落地与 ② 的小样本验证（全量构建后台进行中）。③ 的设计另见后续条目。
- **Changed Domains**：**Dataset Registry（新 universe 筛选维度）** · **DB（0056 增量列）** · Frontend（构建对话框 / 版本详情如实展示）· 研究脚本（v9 构建）。
- **Changed Files**：
  - `drizzle/schema.ts`：`dataset_build_config.excludeListedWithinDays int NULL`。
  - `shared/datasetRegistryContracts.ts`：`DATASET_BUILD_FILTER_DEFAULTS.excludeListedWithinDays = null` / `DATASET_BUILD_FILTER_LIMITS = {min:1,max:3650}` / zod 可空字段 / `DatasetBuildConfigView` / `describeDatasetFilter` 摘要补「排除次新(上市≥N日)」。
  - `server/datasetRegistry/filter.ts`：新增纯函数 `isListingAgeExcluded(exclude, ageDays)`（null 恒放行；**严格小于**才剔除；上市日不可得 ⇒ 放行并如实计数）。
  - `server/datasetRegistry/lifecycle.ts`：`ResolvedBuildConfig` + `normalizeBuildFilter`（非法即抛，不静默夹取）+ `resolveBuildConfig` 回退链。
  - `server/datasetRegistry/builder.ts`：`FirstLimitPullbackBuildConfig.excludeListedWithinDays` + `DatasetBuildIO.resolveListingAgeDaysSync` + Universe 层第三个筛选（板块 → ST → 上市龄）。
  - `server/datasetRegistry/db.ts`：`SecurityIndex.listedDateBySecurity`（Security Master 小表全量）+ `resolveListingAgeDaysSync`（先按 tradeDate 解析有效 securityId，再取 listedDate 的**自然日**龄）。
  - `server/datasetRegistry/{types,registry,runner,query,testHelpers}.ts` · `tests/server/datasetRegistry/builder.test.ts` · `scripts/verifyDataset003a.mts`：随新字段/新 IO 方法对齐。
  - `client/src/components/datasetRegistry/datasetFilterForm.ts` · `BuildVersionDialog.tsx` · `client/src/pages/datasets/VersionDetail.tsx`：表单状态/校验/载荷 + 输入框 + 详情行。
  - 新增 `drizzle/0056_dataset_build_config_exclude_listed.sql` + `scripts/applyDatasetBuildConfigExcludeListed.mjs`（bespoke apply：ssl 口径对齐 `server/db.ts`，按 `-- @guard: column` 幂等）。
  - 新增 `scripts/buildFirstLimitPoolV9Dataset.mts`（v9 构建；支持 `--version/--start/--end/--pre-window-days/--post-window-days/--rebuild`）。
  - 改 `tests/server/datasetRegistry/filter.test.ts`（+4 例）。
- **Changed Contracts**：`dataset_build_config` 新增**可空标量维度** `excludeListedWithinDays`（NULL = 不过滤 ⇒ **既有 12 个配置行逐字节不变**；`configVersion` 保持 1，新维度为可空追加）。
- **Changed DB**：**DDL 1 条**（0056：`ALTER TABLE dataset_build_config ADD COLUMN excludeListedWithinDays int NULL AFTER excludeSt`）。已 apply：`executed=1 / skipped=0`，复跑 **`executed=0 / skipped=1`**（幂等成立）；列实查 `type=int nullable=YES`，既有 12 行该列全为 NULL。**无 migration 历史改写、无 `drizzle-kit generate`、无 `_journal.json` 改动**。DML：新增 v9-smoke（`datasetVersionId=780002`）的 ds_* 行。
- **真实验证（v9-smoke）**：`--version v9-smoke --start 2019-01-02 --end 2019-03-29`，构建 COMPLETED，`datasetVersionId=780002`。
  - 构建配置实查：`excludeSt=1 · excludeListedWithinDays=365 · preWindowDays=60 · postWindowDays=80`、boards=`["main"]`；
  - **前置窗口真的物化了负相对日**：`prefix minRd=-57 maxRd=0`（80,088 行 / 2,315 事件）⇒ 事件日前 60 根收盘可得 ⇒ **MA5/10/20/60 可算**（v8 的 `minRd=0` 结构上不可算）；
  - `post 1..80`（185,200 行）；
  - **上市龄过滤生效**：同窗口未过滤（v8 口径）2,434 事件 → 过滤后 2,315，**剔除 119 个次新首板事件（4.89%）**；
  - **不变量**：v9-smoke 内 `DATEDIFF(tradeDate, listedDate) < 365` 的事件 = **0**；上市日未知 = 0；最小上市龄样本 = 370 天。
- **未做（如实登记）**：① **全量 v9 构建仍在后台运行**（`2019-01-01..2026-09-04`，预计千万行级，checkpoint/resume 可用）；② 用户要求的「**入场/退出可配置**」尚未设计定稿（不接受钉死固定日 ⇒ 需先定配置形状再实现）；③ 未跑任何基于 v9 的因子实验。
- **Regression Result**：`tsc --noEmit` **0 错**；`vitest run tests/server/datasetRegistry` **268/268 全绿**（filter 20 → 24）；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Update**：本条目；`drizzle/0056_*.sql`；`scripts/applyDatasetBuildConfigExcludeListed.mjs`；`scripts/buildFirstLimitPoolV9Dataset.mts`。`SYSTEM-BASELINE.md` 头部由并发会话持有，本任务不覆盖。
- **Baseline Impact**：minor（可选筛选维度 + 1 条增量 DDL + 新构建脚本）。
- **GLOBAL AUDIT REQUIRED**：NONE。

---

## 2026-10-07 · `TREND-ENTRY-MA-V1-001`（趋势触发入场：**配置驱动**求值器 + 3 条预注册臂）

- **Task**：按用户裁定（条件词表**恰好四类**、入场不钉死固定日、收益不钉死固定日期、「先暂时写死成配置」）落地 C —— 入场与退出由配置声明、由唯一求值器执行，收益按「实际入场 → 实际退出」计算。
- **Changed Domains**：research-experiment（新实验入口 + 新纯函数求值器）。**零 DB / 零契约 / 零执行链**。
- **Changed Files**：
  - 新增 `research-experiments/shared/firstBoardPullback/trendEntry.ts`：四类条件（`PRICE_VS_MA` / `MA_ORDER` / `MA_SLOPE` / `RETURN_OVER`）+ `movingAverageAt` + `evaluateCondition` + `evaluateEntry` + `evaluateExit` + `netReturnPct`。**纯函数、零 IO**。
  - 新增 `research-experiments/first-board-pullback/trend-entry-ma-v1/arms.ts`：**预注册冻结配置**（A1 多头排列 / A2 回踩转强 / A3 站上长均线）+ 统一退出 + 需物化相对日常量。
  - 新增 `research-experiments/first-board-pullback/trend-entry-ma-v1/{experiment.ts,page.tsx}`。
  - 注册：`research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts` · `client/src/pages/researchExperiments/experimentModes.ts`（分档台账 46 → 47）。
  - 测试：新增 `tests/server/researchExperiments/trendEntry.test.ts`（12 例）· `tests/server/researchExperiments/trendEntryMaV1Arms.test.ts`（6 例）；`tests/client/.../researchExperimentModeGrouping.test.ts` 台账 46 → 47。
- **Changed Contracts**：**无**（配置为实验内部形状，不进 shared 契约；未改 Strategy Core / RuleGraph / simulator / canonicalMetrics）。
- **Changed DB**：**无**（本条目只落地代码与测试；真实 Run 待 v9 数据集 READY 后执行）。
- **钉住的口径（防「随手调参」）**：① 条件词表**四类**，出现第五类即抛错；② `all`(AND)+`any`(OR)；③ 触发 = 观察窗 rd1..20 内**首个**满足日；④ 入场 = 触发日**次一交易日开盘**（要求 `canBuyAtOpen`；不可买 ⇒ `UNFILLABLE`，**不顺延**）；⑤ 退出优先级 = 盘中止损 → 退出条件 → 持有期（自**实际入场日**起算）；⑥ 条件退出默认**次一开盘**成交，不可卖则继续持有；⑦ 数据不足 ⇒ **不可评估**（不插补、不回退前值），按不通过处理并计数；⑧ 窗口末端仍未退出 ⇒ `OPEN_AT_END` 如实标记。
- **三条预注册臂（写死，不做搜索）**：A1 `MA5>MA10 ∧ MA10>MA20 ∧ MA20>MA60 ∧ close>MA5`；A2 `close>MA10 ∧ close>MA5 ∧ MA20 五日斜率>0`；A3 `close>MA60 ∧ MA5>MA10`。**退出三臂共用**（`MIXED`：20 日持有 / 收盘跌破 MA10 / 盘中 −6% 止损，取先到）⇒ 退出**不是自变量**。
- **数据坐标**：`requiredDatasetVersionLabel = v9`（主板 · 非 ST · **上市龄 ≥365 天** · preWindow 60）；`prefixRelativeDays = −59..0`（MA60 可达）、`postRelativeDays = 1..80`；`decisionOffsetDays = null`（样本资格不使用 rd ≥ 1）；`usesForwardData = true`。
- **成本**：佣金 2.5bps + 滑点 2.5bps + 冲击 2.5bps（单边）+ 卖出印花税 5bps ⇒ 买卖合计 20bps。
- **未做（如实登记）**：① **未跑真实 Run**（v9 全量构建仍在后台 RUNNING）；② 未做参数搜索（按纪律：预注册配置不得跑完再挑）；③ 未接 simulator / 未建 StrategyVersion。
- **Regression Result**：`tsc --noEmit` **0 错**；定向 `trendEntry` **12/12** · `trendEntryMaV1Arms` **6/6** · 分档台账 15/15；`node scripts/checkEolDrift.mjs --strict` **0**。
- **Baseline Update**：本条目。（`SYSTEM-BASELINE.md` 头部由并发会话持有，本任务不覆盖。）
- **Baseline Impact**：minor（新实验入口 + 新纯函数求值器，无契约/DB 变化）。
- **GLOBAL AUDIT REQUIRED**：NONE。
