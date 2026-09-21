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
