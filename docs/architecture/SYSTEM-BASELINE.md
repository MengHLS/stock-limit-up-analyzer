# SYSTEM-BASELINE — 全局架构基线

> **Baseline Version：`v1.4.0`**（minor：WALK-FORWARD-001 新增 `walkForward` 模块 + 2 表 + 1 契约 + 6 端点 + 1 面板；`v1.3.0` = OOS-001 新增 `oosValidation` 模块 + 2 表 + 1 契约 + 6 端点 + 1 面板；`v1.2.0` = ROBUSTNESS-001 新增 `searchRobustness` 子模块 + 3 表 + 1 契约 + 6 端点；`v1.1.1` = PARAMETER-002 patch；`v1.1.0` = PARAMETER-001 的 minor 跃迁）
> **Last Audit Time：`2026-09-19`**（SYSTEM-BASELINE-001，一次性全局审计）
> **Last Change Time：`2026-09-19`**（见 `CHANGE-AUDIT.md`）
> **审计方式**：真实代码 + 真实库（只读探针）+ 既有测试基线；**代码变更 = 0 / DB 变更 = 0 / migration = 0**。
>
> ⚠️ **两个必须知道的前提（本轮实测）**
> 1. **审计对象 = 工作区（working tree），不是 HEAD**。审计时工作区已有 **11 个未提交的 `server/**` 改动**（+254/−79，来自 STRATEGY-ARCH-002 / BACKTEST-002 / PARAMETER-001-PRE 等前序与**并发**工作）⇒ 「HEAD 的代码」与「本基线描述的代码」**不是同一个版本**。
> 2. **文件行号是 `auditedAt` 快照，只作定位辅助**。审计期间 `server/strategyCore/runtime.ts` 就被**另一会话**改过（16:56，+48/−2，595 行）⇒ **定位以「路径 + 符号名」为准，行号仅用于快速跳转**；发现行号对不上时按符号名 grep，不要当作 drift。
>
> 🔴 **本文件是后续 Agent 理解本项目架构的第一入口。**
> 🔴 **Baseline 是「当前代码事实的结构化索引」，不是脱离代码的第二套真相。**
> 冲突时优先级：**真实 DB 状态 > 实际运行结果 > 实际代码 > 自动化测试 > 文档 > 设计假设**（ROADMAP §3）。
> 发现冲突 ⇒ 标 `BASELINE_DRIFT` → 修正 Baseline → 记录原因 → 再继续任务。
> **禁止为了让 Baseline 看起来正确而修改代码。**

---

## 1. Project Overview

| 项 | 内容 |
|---|---|
| 项目名 | `stock-limit-up-analyzer` |
| 定位 | 从「涨停/股票分析应用」升级为 **个人量化策略研究平台** |
| 技术栈 | React 19 · Vite 7 · Express · tRPC 11 · Drizzle ORM（mysql2 / TiDB Cloud）· TypeScript strict · Vitest |
| 规模（实查） | `server/**` 628 文件 · `client/**` 215 文件 · `tests/**` **276** 文件 · `docs/**` 534 文件 · `scripts/**` 110 文件 |
| DB | **63** 张 BASE TABLE（schema.ts 声明 60 + `__drizzle_migrations` + 2 张 legacy 动态行表）· 41 个 migration |
| 前端 | **33** 条路由 · 5 组侧栏导航 · **21** 个 tRPC 顶层 key |
| 当前阶段 | STEP 12 数据地基已 `RESEARCH_READY = TRUE`；**BACKTEST-002 = COMPLETE**；下一阶段 = **PARAMETER-001（NOT READY，有阻塞）** |
| 最终目标 | 让用户把主观交易经验 → 明确规则 → 程序化策略 → 历史验证 → 参数优化 → 稳健性/OOS → 模拟交易 → 交易纪律，形成**可信、可复现**的闭环 |

**权威控制文档**：`ROADMAP.md`（唯一 Master Control；§44 覆盖式状态区 / §44.5 未完成队列 / §47 append-only）。

---

## 2. Current Architecture

### 2.1 分层

```text
┌──────────────────────────────────────────────────────────────┐
│ client/**   （React 19 + tRPC client；只 import type，禁运行时值）│
└───────────────────────────┬──────────────────────────────────┘
                            │ tRPC（21 顶层 key）
┌───────────────────────────▼──────────────────────────────────┐
│ server/_core/**  Express + tRPC 基础设施 + 启动装配             │
├──────────────────────────────────────────────────────────────┤
│ Routers（14 个 router 文件：12 个 *Router.ts + 2 个工厂）        │
├──────────────────────────────────────────────────────────────┤
│ Domains                                                       │
│   datasetRegistry(A) │ researchCore/new │ strategyCore(语义)   │
│   strategySchema(存储编码) │ strategyPersistence │ backtest    │
│   research/{simulator,closedLoop,closedLoopWiring,             │
│             strategyEvaluation,marketRegime,robustness,...}    │
├──────────────────────────────────────────────────────────────┤
│ server/db.ts（唯一 DB 出口）→ drizzle/schema.ts                │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 三个「语义权威」（最重要的一条）

| 层 | 权威位置 | 地位 |
|---|---|---|
| **策略语义** | `server/strategyCore/**` | 🔴 **唯一语义权威**；legacy `StrategyDefinition` 降级为**存储编码**，靠 `adapters/legacyDefinition.ts` 双向翻译 |
| **执行/成本/持仓** | `server/backtest/**` | 🔴 **事实上的 Backtest Core**；生产回测 `simulator/engine.ts` **全量复用**它 ⇒ **禁新建 `backtestCore/**`** |
| **指标** | `server/backtest/backtestResult.ts:392 canonicalMetrics()` | 🔴 **唯一指标出口**；Evaluation 在已有 canonical 时**不得**重算重叠指标 |

### 2.3 两个「事实上的双轨」（最需要警惕的一条）

| 双轨 | 权威侧 | 另一侧 | 处置 |
|---|---|---|---|
| Dataset | A = `server/datasetRegistry/**`（`dataset_version.id`） | B = `server/researchDataset/**`（内容寻址串 + `research_datasets`） | B 为**前身/LEGACY**，tRPC 端点仍在（`routers.ts:316`） |
| Research 数据模型 | 单数 10 表（`datasetVersionId` 边界） | 复数 4 表（STEP 6.x，字符串 experimentId） | 复数侧**生产不可达**，但被主 barrel 隐性加载 |

---

## 3. Domain Map（摘要 · 全文见 `DOMAIN-MAP.md`）

| Domain | 负责 | **不负责** | 状态 |
|---|---|---|---|
| **Dataset** | 数据准备 / 数据集版本 / 数据集物理数据 | 策略判断、撮合、指标 | **READY** |
| **Research** | 探索、统计、候选发现、假设→结论 | 最终交易执行、策略规则定义 | **READY** |
| **Strategy** | 策略规则与参数定义、版本化、生命周期 | 真实成交撮合、数据集物理数据 | **READY** |
| **Parameter Search** | 参数空间搜索、稳定区判定、滚动优化 | 定义策略、产出 Production | **PREPARATION / PARTIAL** |
| **Backtest** | 历史执行模拟 | 策略发现、参数择优 | **READY** |
| **Evaluation** | 收益/风险/回撤/交易质量指标 | 撮合、稳健性扰动 | **PARTIAL** |
| **Robustness** | 成本/滑点/参数/执行扰动、随机化、**搜索结果邻域稳定性（ROBUSTNESS-001，零重跑）** | OOS 隔离、PBO | **FACT**（扰动/随机化为技术预览；`searchRobustness` **已落库持久化**） |
| **OOS** | IS/OOS 隔离与账本；**冻结候选参数的样本外真实重跑验证（OOS-001，必须重跑）** | 参数择优 | **FACT**（隔离账本为技术预览；`oosValidation` **已落库持久化**） |
| **Walk-Forward** | Train→Optimize→Freeze→Test 编排 | 参数择优算法 | **FACT**（技术预览） |
| **Walk-Forward（持久化滚动验证）** | **逐 Fold 独立搜索 → 冻结候选 → 紧邻样本外真实重跑 → 多 Fold 描述性汇总（WALK-FORWARD-001，编排层）** | 参数择优 / 自动选最佳 Fold / 评级 | **FACT**（`walkForward/**` **已落库持久化**；C-19.1 内存态几何原语仍为技术预览） |
| **Overfitting** | CSCV-PBO + 参数敏感性 | — | **FACT**（技术预览） |
| **Simulation (Paper)** | 贴近实盘的模拟账户 + 前向纸面 | 真实下单（无实现） | **FACT** + 编排引擎 CODE_READY |
| **Production** | 完整闭环部署 / 实盘 | — | **PLANNED** |
| **(辅助) Market Regime** | 七维 PIT 状态标签 | — | **FACT** |
| **(辅助) Lifecycle / Candidate / Review** | 八态状态机、转正、纪律复盘 | — | **FACT**（技术预览） |

---

## 4. End-to-End Workflow

```text
[1] 原始数据（8,895,704 行 OHLCV + securities/status/CA/liquidity/index/industry）
      ↓ datasetRegistry 构建（构建门禁 INVALID_BUILD_FILTER）
[2] dataset_version(READY) + ds_* 五表（event/prefix/post/path/outcome）
      ↓ runWorkbenchAssembly/datasetFromRegistry 桥（仅支持 first_limit_pullback）
[3] Research（researchCore 10 张单数表）：假设 → 实验 → 运行 → 分析 → 结果 → 结论
      ↓ research.strategyCandidate.promote（唯一跨域写入口）
[4] Strategy（strategies + strategy_versions + 5 投影表 + provenance）
      ↓ researchRun.loopRun
[5] 闭环 14 阶段（实装 8）：data → research → strategy → backtest → evaluation
                            → optimization → regime → finalize
      ↓ strategyCore 决策 → simulator 撮合 → canonicalMetrics
[6] closed_loop_backtest_run（resultJson = { strategyRun, backtest }）
      ↓ 各域独立 tRPC：paramSearch / walkForward / marketRegime / review
[7] Robustness · OOS · WFA · Overfitting（技术预览口径，非 RESEARCH_READY）
[8] Simulation / Paper（模拟账户 + 前向纸面）
[9] Lifecycle / Review / Discipline（八态 + 纪律反馈 + 交易日志）
[10] Production —— PLANNED（无实现）
```

**🔴 关键坐标**：整条链上**唯一运行时权威数据集坐标 = `datasetVersionId`**（bigint）；`datasetVersion`（label）**仅展示**；内容寻址串（`rd-1.0.0-1-<sha256>`）属 **LEGACY**。

---

## 5. Domain Status（七态 + 归属标记）

采用 ROADMAP §7 七态：`DESIGN / CODE_READY / DATA_READY / VALIDATED / RESEARCH_READY / PRODUCTION_READY / BLOCKED`。
本基线附加归属标记：`FACT / DESIGN / PLANNED / LEGACY / BLOCKED / DEPRECATED / OBSERVED`。

### 5.1 数据地基（STEP 12）

| 域 | 状态 | 归属 |
|---|---|---|
| A OHLCV / B Security Master / C Status / D CorpActions+Adj / E Liquidity / F Index / G Industry | **DATA_READY** | FACT |
| H Research Ready Gate | **RESEARCH_READY = TRUE**（gate 17/17） | FACT |

### 5.2 研究平台域

| 域 | 七态 | 归属标记 | 一句话依据 |
|---|---|---|---|
| Dataset | **READY** | FACT | 五表记账闭合（差 0）；构建门禁有效 |
| Research | **READY** | FACT | 16 张表有真实数据；转正链 9/13 成功 |
| Strategy | **READY** | FACT | Core 语义权威 + 5 投影 + 版本不可变 |
| Parameter Search | **IN PROGRESS（PRE）** | FACT（可达）+ PARTIAL | 端点可达但**搜索结果不落库**、`parameterRole` 门槛未生效；**PARAMETER-001-PRE 已在推进**（R-06 主因已定位并修复，见 AR-2） |
| Backtest | **READY** | FACT | BACKTEST-002 COMPLETE；policy v1 + canonical 252 |
| Evaluation | **PARTIAL** | FACT | 闭环 evaluation 已取 canonical；**第二套口径 `backtest/metrics.ts` 仍在** |
| Robustness | **FACT**（技术预览） | FACT / 部分 CODE_READY | `robustness`/`stochastic` 可达；`factorAblation` 仅测试 |
| OOS | **FACT**（技术预览） | FACT / 部分 CODE_READY | `walkForward.oos` 可达；legacy 6.4 仅测试 |
| Walk-Forward | **FACT**（技术预览） | 同上 | `walkForward.run` 可达 |
| Overfitting | **FACT**（技术预览） | 同上 | `walkForward.overfit` 可达 |
| Simulation / Paper | **FACT** | FACT + 编排引擎 CODE_READY | 模拟账户/前向纸面/调度器均可达；`signalToPnl` 编排仅测试 |
| Lifecycle / Candidate / Review / Discipline | **FACT**（技术预览） | FACT | 4 个域各有 tRPC 端点 |
| Market Regime | **FACT** | FACT | 端点 + 闭环 regime 阶段均装配 |
| **Production** | **PLANNED** | PLANNED | **无任何实现** |

### 5.3 闭环装配度（实查）

**实装 8 / 14**：`data` `research` `strategy` `backtest` `evaluation` `optimization` `regime` `finalize`
**未装配 6**：`robustness` `oos` `overfitting` `paper` `review` `discipline` ⇒ 以 `CL_RUNNER_NOT_INJECTED` **如实 BLOCKED**。

> 实测留档 7/7 = `PARTIAL_BLOCKED`（`executedStageCount` 5~6 / `blockedStageCount` 8~9），与「实装 8」一致。

---

## 6. Core Contracts（摘要 · 全文见 `CONTRACT-MAP.md`）

| Contract | 定义位置 | 状态 |
|---|---|---|
| Dataset | `shared/datasetRegistryContracts.ts` + `server/datasetRegistry/types.ts` | READY |
| Research | `shared/researchContracts.ts` + `server/researchCore/types.ts` | READY |
| Strategy Schema | `strategySchema/types.ts`（Document）+ `definition.ts`（Definition） | READY |
| Strategy Runtime | `strategyCore/types.ts` + `runtime.ts#StrategyRuntime.evaluate`（`evaluate` / `evaluateWithDetail`） | READY |
| Backtest + Execution Policy | `backtest/context.ts`（policy v1） | READY |
| `BacktestRunResult` | `backtest/backtestResult.ts:65` | READY |
| **Canonical Metrics** | `backtest/backtestResult.ts:392` | 🔴 **唯一指标来源** |
| Evaluation Ref | `closedLoop/types.ts:375` | PARTIAL |
| Closed Loop | `closedLoop/types.ts` + `closedLoopWiring/requirements.ts` | PARTIAL（8/14） |
| `strategyRunRecordSchema` | `shared/researchContracts.ts:884` | READY |
| `backtestRunPayloadSchema` | `shared/researchContracts.ts:976` | READY |

**两条不可动摇的契约铁律**

1. **`canonicalMetrics` 是 Backtest 的唯一指标来源。**
2. **Evaluation 在已有 canonical 时不得重新计算重叠指标**；`NOT_AVAILABLE` 不得被评估器数值顶替。

---

## 7. Database Overview（摘要 · 全文见 `DATABASE-MAP.md`）

| 项 | 真实值 |
|---|---|
| BASE TABLE 总数 | **63** = schema.ts 声明 **60** + `__drizzle_migrations` + 2 张 `rd_rows_*`（legacy） |
| 外键约束 | **0**（全软引用） |
| migration | 41 个（`0000…0040`）；**journal 止 0023 / snapshot 止 0015 / `__drizzle_migrations` 24 行** ⇒ `db:push` **不可用** |
| 实际 apply 机制 | 手写 SQL（`-- @guard:` 幂等）+ 14 个专用 `scripts/apply*.mjs\|mts` + 通用 `applySqlMigration.mjs` |
| 数据集记账 | `ds_*` 五表 = **1,603,084** 行 = Σ `dataset_version.totalRows`（v1 60,002 + v2 1,543,082）⇒ **闭合，差 0** |
| 策略 | `strategies` 10 / `strategy_versions` 11（Draft 10 + Validated 1）/ 5 投影表 24·17·19·9·9 / provenance 9 |
| 闭环留档 | `closed_loop_backtest_run` **7 行 @08:40Z → 8 行 @08:58Z**（见下）；`datasetVersionId` NULL **0**；带 BACKTEST-002 载荷（`policyVer=1` + `strategyRun`）**2/8** |
| legacy | `research_experiments` 0 / `research_runs` 2 / `research_experiment_batches` 0 / `research_datasets` 7 |

**🔴 项目硬规则（本任务确认仍有效）**：❌ `db:push` · ❌ `drizzle-kit generate` · ❌ 手写 `_journal.json` · ✅ migration 必须显式 · ✅ 不随意修改历史数据 · ✅ 历史 Run 不回填。

---

## 8. Execution Flow（摘要 · 全文见 `EXECUTION-FLOW.md`）

主链：`researchRun.loopRun`（`researchRunRouter.ts:467`）
→ `createClosedLoopWiring`（`:622`，实现 `executors.ts:713`，返回 `{stageRunners, artifacts}`）
→ `runClosedLoop`（`:625`）
→ `backtest` 阶段 `executors.ts:505/516` → `simulator/engine.ts:250 runTradeSimulation`
→ `canonicalMetrics` → `composeClosedLoopEvaluationRef`（`adapters.ts:134`）
→ `buildBacktestRunPayload`（`backtestResult.ts:519`）
→ `persistClosedLoopBacktestRun`（`researchRunRouter.ts:276`，**有界重试 ≤3，best-effort 不抛**）

**已确认为 FACT 的 13 条 BACKTEST-002 事实**（policy v1 / canonical 唯一 / 252 / zero-volume `REJECT` / fixed-amount / `BacktestRunResult` / `resultJson.backtest` / `equityDigest` / `tradeDigest` …）完整清单见 `EXECUTION-FLOW.md` §4。**本基线只登记，不修改这些逻辑。**

---

## 9. Frontend / Backend Boundary

| 规则 | 现状 | 证据 |
|---|---|---|
| `client/**` 不得 import `server/**` **运行时值** | ✅ 合规（全部 `import type`） | grep 全仓；`client/src/lib/trpc.ts:2` 等 |
| `@shared/*` 允许双向使用 | ✅ | `vite.config.ts:14-18` / `tsconfig.json:18-21` / `vitest.config.ts:9-13` |
| 契约放 `shared/`（口径函数必须落 `shared/`） | ✅ | `shared/ladderHeight.ts` / `shared/sectorHeatOrder.ts` / `shared/researchContracts.ts` |
| 🔴 **「接线完成」≠「用户够得到」** | 交付前必须无头量 DOM | `docs/evidence/_probe_*.mjs` 系列 |
| 侧栏高亮 | **分段精确匹配 + 取最长命中**（`AppShell.tsx:133-151`） | — |
| 首页入口 | 左上角网站标题（`data-slot="sidebar-home-link"`）；`/` 侧栏**零高亮** | `AppShell.tsx` |

**前端结构**：33 条路由 · 5 组导航（复盘分析 / 量化回测 / 数据录入 / 研究数据 / 数据管理）· `adapters/` 8 个（tRPC → 视图模型）· `lib/` 11 个 · `hooks/` 3 个 · `contexts/` 1 个。

---

## 10. Current Production Paths（生产可达路径）

| 路径 | 入口 | 说明 |
|---|---|---|
| 数据集构建与查询 | `datasetRegistry.*`（24 procedure） | 唯一权威数据入口 |
| 研究闭环运行 | `researchRun.loopRun` | 14 阶段实装 8 |
| 闭环留档查询 | `researchRun.listBacktests` / `getBacktest` | 列表不读 `resultJson` |
| 研究引擎/规划器 | `researchEngine.*` / `researchPlanner.*` | 分析引擎 + 提问式研究 |
| 策略 CRUD + 生命周期 | `research.strategy.*` / `research.lifecycle.*` | `setVersionStatus` **绕过** §23 迁移表（风险） |
| 候选转正 | `research.strategyCandidate.promote` | 唯一跨域写入口 |
| 参数搜索 | `paramSearch.{describe,run,rolling,robustness,stochastic}` | **技术预览口径** |
| WFO / OOS / 过拟合 | `walkForward.{describe,run,oos,overfit}` | **技术预览口径** |
| Regime | `marketRegime.{describe,run}` | — |
| 复盘工作台 | `review.{journal.*,discipline.run,paper.run}` | — |
| 前向纸面交易 | `sentiment.{createPaperTradingRun,…}` + 调度器 | legacy 语义 |
| legacy 前端回测 | `sentiment.getLeaderCandidateBacktest` → `runBacktestWithRisk` | **与闭环语义不同** |
| 指标端点 | `research.metrics.evaluate` | 一次求值三指标 |

---

## 11. Legacy Paths（LEGACY / DEPRECATED，**不得当生产路径**）

| # | 对象 | 位置 | 可达性 | 标记 |
|---|---|---|---|---|
| L-1 | B 体系 Dataset（内容寻址 + `research_datasets`） | `server/researchDataset/**` + `server/research/datasetAccess/**` | tRPC `researchDataset` **仍在产** | **LEGACY** |
| L-2 | 复数 Research 表链（STEP 6.x） | `server/research/{experiment,run,sweep}*.ts` + `persistence/**` | **仅测试**（`DbExperimentRepository` 等无实例化点） | **LEGACY / 死代码** |
| L-3 | `runBacktestEngine2` | `server/backtest/engine.ts:56` | 仅 3 测试引用 | **LEGACY**（规格 §4 要求不删） |
| L-4 | legacy 逐日模拟器 | `server/realisticBacktest.ts:246` | 研究段可达 | **LEGACY** |
| L-5 | legacy 模拟器唯一合法出口 | `server/research/legacyTransactionSimulator.ts:74`（`productionRuntime:false`） | research-only | **LEGACY** |
| L-6 | `server/strategy/**` legacy 引擎策略 | 8 文件 | 经 `runBacktestWithRisk` **生产可达** | **LEGACY（但在产）** |
| L-7 | `server/engine/**` 生产 Step2 Core | 7 文件 | **在生产请求路径** | **FACT（legacy 语义）** |
| L-8 | `server/engine/adapter.ts` | 整文件 | **零引用** | **死代码** |
| L-9 | STEP 6.x service | `evaluationService` / `experimentService` / `runService` / `sweepService` / `status` | **仅测试**，但被主 barrel 加载 | **死代码（隐性加载）** |
| L-10 | `factorAblation` | `server/research/factorAblation/**` | **仅测试** | **CODE_READY 未接线** |
| L-11 | `signalToPnl` 编排引擎 | `engine.ts:280 runSignalToPnlLoop` | **仅测试**（闭环 `paper` `notWired`） | **CODE_READY 未接线** |
| L-12 | legacy `LeakageGuard` | `server/research/framework/leakage.ts:68` | 在产但**恒通过** | **DEPRECATED（语义失效）** |
| L-13 | `DATASET_BUILD_CONFIG_DEFAULTS` | `shared/datasetRegistryContracts.ts:484` | 已标 `@deprecated` | **DEPRECATED** |
| L-14 | `backtest/metrics.ts` 第二套口径 | `metrics.ts:56` | `tradeQualityMetrics` read-only 消费 | **DEPRECATED（待收口）** |
| L-15 | B 体系动态行表 | `rd_rows_05809b1a6d97aa02`(163) / `rd_rows_5dce9db1421bec38`(800) | 库中存在 | **LEGACY 存储** |

---

## 12. Current Known Risks

### 12.1 Architecture Risks（高）

| # | 风险 | 证据 |
|---|---|---|
| **AR-1** | **三段不可互换的执行契约并存**：`runBacktestWithRisk` / `runTradeSimulation` / `simulateRealisticTPlus1ToTPlus2` ⇒ 同策略换入口得不同数字 | 见 `EXECUTION-FLOW.md` §7 E-1 |
| **AR-2** | **R-06 性能**：单次真实 Run **657.8 s**。**主因已定位**（并发 PARAMETER-001-PRE）：`strategyCore/canonical.ts` 占 **44.3% CPU self time**（291.4 s / 657.9 s），根因 = `computeDefinitionFingerprint` **每次求值被调 2 次**（≈341 万次 canonical 序列化 + sha256）。**已修**（`runtime.ts#definitionFingerprintCache`，WeakMap）并**已量化**：零写库阶段基准 主窗合计 **74,034 → 44,579 ms（−40%）**、research **5,474 → 2,626 ms（−52%）**、`decision_day_loop` **56,289 → 25,803 ms（−54%）**，且 `equityDigest`/`tradeDigest` **逐字节不变**。⚠️ **剩余阻塞**：`db.read_ms` **95~96 s**（58 次往返）**未改善**，是当前最大单项 | `docs/evidence/_probe_param001_pre_profile.*` / `_probe_param001_stage_bench.{before,after}.*` |
| **AR-3** | **止损三落点互不相通**：`realisticBacktest.ts` / `paperTrading.ts` / `server/engine/**`；**`server/engine/**` 完全不执行止损** | — |
| **AR-4** | **策略层无独立未来函数防护**：legacy `LeakageGuard` 因 `EPOCH_FLOOR_DATE` 恒通过 ⇒ 安全性全靠数据层 PIT（Core 侧守卫真实生效） | `recipeRegistryAtoms.ts:47-58` |

### 12.2 Functional / Data Risks（中）

| # | 风险 | 证据 |
|---|---|---|
| **R-01** | 搜索结果不落库（`paramSearchRouter.ts` 零写库）⇒ 无实验追溯 | 源码 |
| **R-02** | 运行级复现快照缺失（`closed_loop_backtest_run` 无 parameterSet/codeVersion/engineVersion/seed/Universe/startedAt；6/6 行 `resultJson` 这些键零命中） | 实查 |
| **R-03** | `strategy_versions.codeVersion` **11/11 = `1.0.0+gunknown`** ⇒ 版本列不可用 | 实查 |
| **R-04** | `setVersionStatus` **不吃 §23 迁移表** ⇒ `Draft→Production` 跳级在写入路径不被拒 | `service.ts:362` |
| **R-05** | `parameterRole` 门槛未生效（`listSearchableParameters` 零生产调用）⇒ `FIXED` 参数仍会被搜；`derivedFrom` 无求值器 | 源码 |
| **R-06** | 两套 Metrics 口径并存（`backtest/metrics.ts` vs canonical）⇒ 「A 比 B 好」可能只是口径差 | 见 §13 AR-6 |
| **R-07** | 长运行留档「只尝试一次」曾必然静默丢档（**已修**：有界重试 ≤3） | `researchRunRouter.ts:272` |
| **R-08** | 数据集桥**仅支持单一 datasetCode**（`first_limit_pullback`）⇒ 「换策略/换数据集」在数据层无数据可用 | `datasetFromRegistry.ts:978` |
| **R-09** | 单次运行可复现性不完整（N-05 `runtimeConfig` 运行级而评估逐日 / N-06 数据集视界逐日不可知） | — |
| **R-10** | `prefix`/`post` 物理表**不在 drizzle migration 链内**（插件声明式 DDL + 脚本重建）⇒ 迁移链与 DDL 双源漂移 | `0030` 注释 |
| **R-11** | 无外键 ⇒ 「校验通过 → 提交前被删」窗口存在 | `datasetBindingValidation.ts:15-16` |

### 12.3 OBSERVED（观察到的问题，尚未成为正式缺陷）

| # | 现象 |
|---|---|
| O-1 | 闭环 7/7 全 `PARTIAL_BLOCKED`（与实装 8/14 一致，属如实登记） |
| O-2 | `research_analysis_metric` / `research_artifact` **0 行**（有表无数据） |
| O-3 | 主 barrel `server/research/index.ts` 混居 legacy ⇒ **加载即求值** |
| O-4 | 4 个同名 `adapter.ts` 语义无关；`research` 单复数表仅差一个 `s` |
| O-5 | 若干**陈旧代码注释**：`reviewRouter.ts:26-27` 与 `RegimeReport.tsx:145` 称「尚未合并进 appRouter」，实际**已在 `routers.ts:332/331` 注册**；`closedLoopWiring/index.ts:13-14` 称只装配 5 阶段，实际 **8** |
| O-6 | `prefix` 含 `rd = 0`（t 日），`post`/`path` 只含 `rd ≥ 1` —— 旧文档描述的是三表结构，易误读 |

### 12.4 Historical documentation drift（旧文档与当前事实不一致，**保留历史、以本基线为准**）

| # | 旧文档 | 旧说法 | 当前事实 |
|---|---|---|---|
| H-1 | `docs/PRODUCT_GAP_MATRIX.md:15` | 「`strategy_versions` 表**缺失**」 | 已建（`schema.ts:528`，migration `0026/0034/0035`） |
| H-2 | `docs/PRODUCT_GAP_MATRIX.md:14` | 「缺 `research_datasets` 持久化表」 | 已存在（`schema.ts:430`，`0024`） |
| H-3 | `docs/PRODUCT_GAP_MATRIX.md:48` | 「industry `securityId` 全 NULL 违反身份铁律」 | 已统一（`0023`） |
| H-4 | `docs/PRODUCT_GAP_MATRIX.md:79` | 「21 页前端」 | 现 33 条路由 |
| H-5 | `docs/research/RESEARCH-001-SCHEMA.md:120,342` | `research_hypothesis.status` 含 `TESTING/PARTIALLY_SUPPORTED` | 已废弃；现为 `DRAFT/TESTABLE/TESTED/SUPPORTED/REJECTED/PROMOTED` |
| H-6 | `docs/quant-system-contract.md:145,494` | 「`stock_daily_prices` 116,332 行 … PARTIAL」 | 现 **8,895,704** 行（同仓另一文档已记 FULL） |
| H-7 | `docs/audit/reports/2026-09-09_…:137` | 「`server/routers.ts.tmp` 存在」 | 已不存在 |
| H-8 | `docs/strategy/STRATEGY-003-difference-report.md:14` | 域模型 **PARTIAL** | 已建 5 投影表 |
| H-9 | `docs/research/BACKTEST-001-IMPLEMENTATION-REPORT.md:10` | 「BACKTEST-001 = NOT COMPLETE」 | 已被 BACKTEST-002 收口（COMPLETE） |
| H-10 | `AUDIT-DRS-001-EVIDENCE.md:7` | 「58 张表」 | 现 schema 60 / 库 63 |
| H-11 | `DEVELOPMENT_PLAN.md` / `TASK_TRACKING.md`（根目录） | 引用**不存在**的根 `ROADMAP.md`；最后更新 2026-09-07 / 09-09 | 权威为 `ROADMAP.md` + `docs/MASTER_*` |

**处置原则（已执行）**：**历史报告保留**；新 `SYSTEM-BASELINE` 作为当前架构事实入口；旧报告与当前事实不同者登记为 **Historical documentation drift**，以当前代码为准。**未大规模删除历史报告。**

### 12.5 BASELINE_DRIFT 登记（本基线成立时即已发生的漂移）

| # | `drift`（Baseline 原说） | `actual`（实际） | `detectedBy` | `correctedAt` | `reason` |
|---|---|---|---|---|---|
| **BD-01** | 审计对象隐含 = 仓库当前版本 | **工作区 ≠ HEAD**：11 个 `server/**` 文件未提交改动（+254/−79） | SYSTEM-BASELINE-001 | 2026-09-19 | 前序 + 并发工作未提交；本基线描述的是**工作区** |
| **BD-02** | `runtime.ts` 行号（`:495/:499/:505-512/:521-546` 等） | 该文件被并发改为 **595 行**：`setEventOccurrenceResolver` :541、`evaluateEventOccurrence` :545、抛错 :554、`StrategyRuntime` :567、`evaluate` :575 | SYSTEM-BASELINE-001 | 2026-09-19 | 并发会话在审计期间编辑 ⇒ **行号降级为辅助，定位改用符号名** |
| **BD-03** | R-06「主因未定位」 | **主因已定位**（`canonical.ts` 44.3% CPU；fingerprint 每求值 2 次）且**已修**（WeakMap 缓存）+ 已量化（research −52%，digest 不变） | 并发 PARAMETER-001-PRE | 2026-09-19 | `_probe_param001_pre_profile` / `_probe_param001_stage_bench` 实证 |
| **BD-04** | `closed_loop_backtest_run` = 7 行 | **8 行**（新增 `clrun-20260919083211921` / `EXP-20260919-PARAM001PRE`） | `_probe_baseline_delta.mts` | 2026-09-19 08:58Z | 采样时该 Run **在途**，结束后才落库 |

🔴 **BD-02 的长期含义**：本项目 `server/**` 处于**高频编辑**状态（含并发会话）⇒ **基线文档一律「路径 + 符号名」为主、行号为辅**。

---

## 13. Current Roadmap（与 `ROADMAP.md` 对齐）

| 阶段 | 状态 |
|---|---|
| STEP 12 数据地基 A–H | **COMPLETED**（`RESEARCH_READY = TRUE`，gate 17/17） |
| STEP 12.5 Historical State Reconstruction | **CODE_READY**（真数据 PIT 抽样验证未做） |
| STEP 12.6 Research Dataset Certification | **CODE_READY** |
| STEP 13 Research Engine | **READY**（本基线判定，与 ROADMAP 早期 BLOCKED 不同步 ⇒ 以代码为准） |
| STEP 14 Backtest Engine | **READY** |
| STEP 15 Strategy Definition + Versioning | **READY** |
| STEP 16 Strategy Evaluation | **PARTIAL** |
| STEP 17 Parameter Optimization | **IN PROGRESS（PRE）**（R-06 主因已定位/已修；剩余 DB 读取 ≈95 s） |
| STEP 18 Robustness | **IN PROGRESS**（技术预览） |
| STEP 19 Walk-Forward / OOS | **IN PROGRESS**（技术预览） |
| STEP 20 Overfitting Detection | **IN PROGRESS**（技术预览） |
| STEP 21 Strategy Lifecycle | **READY** |
| STEP 22 Market Regime | **READY** |
| STEP 23 Paper Trading | **IN PROGRESS** |
| STEP 24 Trading Review / Discipline | **IN PROGRESS** |
| STEP 25 Production Quant Platform | **PLANNED** |
| **BACKTEST-001** | **NOT COMPLETE**（历史） |
| **BACKTEST-002** | ✅ **COMPLETE** |
| **BACKTEST-003 / BACKTEST-004** | 🔴 **未创建，且本基线不创建** |
| **PARAMETER-001** | 🔄 **IN PROGRESS（PRE）** —— 阶段级 profile **已做**（R-06 主因已定位并修复）；剩余瓶颈 = DB 读取 ≈95 s |

> ⚠️ **ROADMAP §44.4 的依赖链仍写着「STEP 13~25 BLOCKED」**，与实际代码（13/14/15/21/22 已 READY）**不同步**。按 §43「真实项目状态决定路线图」，**以本基线为准**；`ROADMAP.md` 的同步更新属后续任务。

---

## 14. Architecture Decisions（ADR）

> 每条：Decision / Reason / Current Status / Affected Domains。**已确定的决策不再重新讨论。**

| # | Decision | Reason | Status | Affected |
|---|---|---|---|---|
| **AD-01** | **Dataset-first workflow**（策略不得直接拼原始表） | 避免策略代码操作 DB 细节；统一 PIT/Universe/policy 边界 | FACT（生效） | Dataset, Research, Backtest |
| **AD-02** | **`datasetVersionId` 作为数据集坐标**（label 仅展示） | 回落重建时 label 会指向不同口径 | FACT（生效） | 全链 |
| **AD-03** | **Strategy Versioning**（不可变版本 + semver + 两层指纹） | 「不存在第二条改内容的路径」需可断言 | FACT（生效） | Strategy, Research, Backtest |
| **AD-04** | **`StrategyRuntime` 作为策略判断入口**（`server/strategyCore/**` 语义权威） | 统一 legacy/Core 语义，双向适配 + 指纹等值 | FACT（已接生产） | Strategy, Backtest, Evaluation |
| **AD-05** | **Backtest Execution Policy versioning**（`= 1`） | 政策变更必须可追溯且历史不回填 | FACT（生效） | Backtest, Evaluation |
| **AD-06** | **Canonical Metrics 唯一**（`canonicalMetrics()`） | 消灭「两套口径 ⇒ A 比 B 好只是口径差」 | FACT（生效） | Backtest, Evaluation |
| **AD-07** | **年化 = 252 交易日/年**（复用 `shared/quant-stats`，`n = 点数−1`） | 全项目既有口径都是 252；244 是唯一异类 | FACT（生效） | Backtest, Evaluation |
| **AD-08** | **历史 Run 不回填** | 回填会伪造「当时就是这样跑的」 | FACT（生效，R-05） | Backtest, DB |
| **AD-09** | **`resultJson.backtest` 有界持久化**（≤60 采样 + 双 digest） | 全量 equity/trades 会撑爆 longtext；digest 保证可比对 | FACT（生效） | Backtest, DB |
| **AD-10** | **zero-volume policy**（默认 `REJECT`） | 零成交日按正常价成交是漏洞 | FACT（生效） | Backtest |
| **AD-11** | **fixed-amount 仓位**（进 Strategy Schema，全链） | 参数搜索需真实可搜仓位口径 | FACT（生效） | Strategy, Backtest |
| **AD-12** | **migration discipline**（禁 `db:push` / 禁 `drizzle-kit generate` / 显式 migration） | journal 自 0024 停摆，`db:push` 会破坏既有 schema | FACT（生效） | DB, 全域 |
| **AD-13** | **软引用而非 FK**（全库 0 外键） | TiDB 分布式 + 历史数据不可变 + 允许清理遗留 | FACT（生效）；已知校验-提交窗口 | DB |
| **AD-14** | **不新建 `backtestCore/**`** | `server/backtest/**` 已是事实 Core，另建=第二套持仓/成本/撮合 | FACT（生效） | Backtest |
| **AD-15** | **不新建 `strategy_rules`/`strategy_parameters`/`strategy_runs` 表** | 现有 schema 已能承载，新建=第二套 SoT | FACT（生效） | Strategy, DB |
| **AD-16** | **未装配阶段必须如实 BLOCKED**（`CL_RUNNER_NOT_INJECTED`） | 静默 success 会把「没接线」伪装成「跑过了」 | FACT（生效） | Closed Loop |
| **AD-17** | **留档写入 best-effort 不抛 + 有界重试 ≤3** | 把「历史列表少一条」升级成「结果丢失」是更坏的交易 | FACT（生效） | Backtest, DB |

---

## 15. Baseline Version

**`v1.1.0`** —— PARAMETER-001（Parameter Search 完整实现，编号 `9bs`）：Parameter Search 域 `PREPARATION_PARTIAL` → **READY**；新增 3 张留档表、1 份契约（`shared/parameterSearchContracts.ts`）、7 个 tRPC 端点、1 条并行执行链（不改主链）。细节见文件末尾「PARAMETER-001 增量」。

**`v1.0.0`** —— 首版（SYSTEM-BASELINE-001 一次性全局审计建成）。

版本号语义（后续维护约定）：

| 变更类型 | 版本动作 | 需同步的文件 |
|---|---|---|
| Domain 新增/删除/边界变化 · 核心数据流变化 · 核心 Contract 变化 · 主链变化 | **major**（`v2.0.0`） | 全部 8 个基线文件 + `CHANGE-AUDIT.md` |
| Domain 状态跃迁（如 PARTIAL → READY） · 新增 entry point / contract | **minor**（`v1.1.0`） | `SYSTEM-BASELINE.md` + `system-manifest.yaml` + `CHANGE-AUDIT.md` |
| 实现细节变化（无架构影响） | **不变** | 只更新 `CHANGE-AUDIT.md` |

---

## 16. Last Audit Time

| 审计 | 时间 | 范围 |
|---|---|---|
| **本基线（SYSTEM-BASELINE-001）** | **2026-09-19** | 全项目 24 项：repository / server / client / DB schema+migrations / Dataset / Research / Strategy / Runtime / Parameter Search / Backtest / Evaluation / Robustness / OOS / WFA / Simulation / Production / shared contracts / persistence / API routers / tests / scripts / docs / configuration / legacy |
| DB 实查（主采样） | **2026-09-19T08:40Z**（16:40 GMT+8） | 只读探针，`errors=0` |
| DB 实查（增量复核） | **2026-09-19T08:58Z**（16:58 GMT+8） | `_probe_baseline_delta.mts`；闭环留档 7 → **8** |

---

## 17. Last Change Time

**2026-09-19** —— SYSTEM-BASELINE-001 建立本次基线（**零代码 / 零 DB / 零 migration 变更**，仅新增 `docs/architecture/**` 与 4 个只读探针）。
⚠️ 同一时段**另有会话在推进 PARAMETER-001-PRE**，并改动了 `server/strategyCore/runtime.ts`（及若干 `server/**`）——**那不是本任务所为**，已登记于 `CHANGE-AUDIT.md` 的 `BASELINE_DRIFT` 条目。

---

## 18. Incremental Audit Protocol（**后续所有开发任务必须遵循**）

```text
Step 1  读取 docs/architecture/SYSTEM-BASELINE.md
Step 2  读取 docs/architecture/system-manifest.yaml
Step 3  读取 docs/architecture/CHANGE-AUDIT.md          ← 「上一次发生了什么」
Step 4  确定本任务涉及的 Domain
Step 5  只审计：
          - 本 Domain
          - 上游直接依赖
          - 下游直接消费者
          - 本次修改涉及的 Contract
Step 6  不重新审计无关 Domain
Step 7  开发完成后：更新 CHANGE-AUDIT.md
Step 8  如果架构发生变化：更新 SYSTEM-BASELINE + system-manifest
Step 9  如果只有实现细节变化：只更新 CHANGE-AUDIT
Step 10 如果发现 BASELINE_DRIFT：执行 Drift Audit（见 §20）
```

**成本对照**

| 方式 | 需要读的东西 |
|---|---|
| ❌ 全量重审计 | 628 server 文件 + 215 client 文件 + 41 migration + 276 测试 + 534 文档 |
| ✅ 增量审计 | `SYSTEM-BASELINE.md` + `system-manifest.yaml` + `CHANGE-AUDIT.md` + 本 Domain 若干文件 |

---

## 19. GLOBAL AUDIT REQUIRED（只有以下情况才需要重新全局审计）

1. Domain **新增**
2. Domain **删除**
3. Domain **边界变化**
4. **核心数据流**变化
5. **Dataset → Research → Strategy → Backtest 主链**变化
6. **Database 核心 Schema 大规模变化**
7. **核心 Contract** 变化
8. **`StrategyRuntime` 改变职责**
9. **Backtest Execution Architecture** 改变
10. **多个 Domain 同时大规模重构**
11. Baseline 与代码出现**重大冲突**
12. **无法通过增量审计确定真实影响范围**

**普通任务 → 只做 Incremental Audit。**
**判定出口**：若某任务触发了上表任一条，**必须在 `CHANGE-AUDIT.md` 中显式写明触发的条目编号**。

---

## 20. Baseline Drift 机制

**检测对象**：Baseline 中登记的 `source paths` / `entry points` / `contracts` / `DB tables` / `domain status` 是否仍然存在。

**检出流程**

```text
Baseline says A  ∧  实际代码是 B
  ⇒ 不静默继续
  ⇒ 输出 BLOCKED-ON-DRIFT 记录：
       drift:          <Baseline 说的是什么>
       actual:         <实际代码是什么>
       detectedBy:     <谁/哪个任务发现的>
       correctedAt:    <时间>
       reason:         <为什么会漂移>
  ⇒ 修正 Baseline（改文档，**不改代码**）
  ⇒ 写入 CHANGE-AUDIT.md
  ⇒ 恢复任务
```

**🔴 铁律**：**禁止为了让 Baseline 看起来正确而修改代码。** 冲突时以**代码 + 数据库 + 实际测试结果**为准。

**已登记的历史 drift**：见 §12.4（H-1 ~ H-11）与 `CHANGE-AUDIT.md` 的 `BASELINE_DRIFT` 条目。

---

## 21. 相关文件

| 文件 | 职责 |
|---|---|
| `SYSTEM-BASELINE.md` | **本文件**：给人和 Agent 阅读的总入口 |
| `system-manifest.yaml` | 机器可读基线（每 Domain 结构化描述） |
| `DOMAIN-MAP.md` | 领域边界（含「不负责什么」） |
| `DATA-FLOW.md` | 数据流与坐标传递（含 `datasetVersionId` 全链作用） |
| `EXECUTION-FLOW.md` | 真实执行链 + 可达性 + 阻塞点 |
| `DATABASE-MAP.md` | 数据库域地图（真实行数、迁移机制、软引用） |
| `CONTRACT-MAP.md` | 核心契约地图（含兼容性铁律） |
| `DEPENDENCY-MAP.md` | 域/模块依赖图 + 循环 + 违规 |
| `AGENT-GUIDE.md` | **Agent 使用规范**（默认读取顺序 + 禁止行为） |
| `CHANGE-AUDIT.md` | 最近变更记录（append-only） |
| `SYSTEM-BASELINE-001-REPORT.md` | 本次全局审计最终报告 |

---

## PARAMETER-001 增量（2026-09-19 · 编号 `9bs`）

> 本节只登记**本轮真实发生的变化**。逐项清单见 `CHANGE-AUDIT.md` 同名条目。

### 状态变化（本文件 §3 / §5.2 / §13 的口径更新如下）

| 域 | 旧状态 | 新状态 | 依据 |
|---|---|---|---|
| Parameter Search | `PREPARATION / PARTIAL`（FACT + BLOCKED） | **READY**（FACT） | 搜索结果已落库（R-01 收口）；`parameterRole` 门槛已生效（R-05 修复）；真实 4 组合端到端跑通 |

### 已收口的基线风险

- **R-01 搜索结果不落库** → 已收口：新增 `parameter_search_run` / `parameter_search_combination` / `parameter_search_result` 三表；
  `paramSearchRouter` 不再是「全文零写库调用」。
- **R-05 `parameterRole` 门槛未生效** → 已修复：新增 `server/research/parameterSearch/searchSpace.ts#deriveParameterSearchSpaceFromProjection`，
  搜索域派生改读**策略参数投影的 `parameterRole`**（`FIXED` 不进搜索空间、`DERIVED` 不得直接搜索），
  并以单测**断言与 Core 唯一权威 `strategyCore/parameterResolver.ts#listSearchableParameters` 逐参数等价**。
  🔴 既有 `strategyEvaluation/parameterSpaceFromDocument.ts`（读 legacy 有损视图、无 role）**未改**，仍服务于旧链路 —— 即**当前存在两条派生器**：
  旧的（无 role，legacy 预览用）与新的（带 role，PARAMETER-001 用）。这是本次**已知的双路径事实**，不是隐藏缺陷。

### 仍存在的已知限制（如实登记）

1. `createSearch` / `startSearch` **没有前置「窗口 ⊆ 数据集窗口」校验** ⇒ 越界窗口会以「N 个组合相同失败」收场（实测 4/4、62 s）。失败信息本身是响亮的（含数据集窗口区间）。
2. `parameter_search_result.backtestRunId` **恒为 NULL**：评估端口走的是**内存态 5 阶段闭环**（`evaluateStrategyParameters`），不落 `closed_loop_backtest_run` 行；
   可追溯性由 `backtestFingerprint` + `evaluationId` + Run 坐标（策略版本 / `datasetVersionId` / 窗口）承担，**未伪造任何 id**。
3. 缓存判据 = 规格 §13 的五要素（策略版本 / 数据集坐标 / `parameterHash` / 执行政策版本 / 评估配置指纹），**不含 `codeVersion`**。
4. `derivedFrom` 仍无求值器（`DERIVED` 参数只能被登记为「不得直接搜索」，不能自动求值）。

---

## PARAMETER-002 增量（2026-09-19 · 编号 `9bt`）

> 本节只登记**本轮真实发生的变化**（实现细节 + 行为修正）。逐项清单见 `CHANGE-AUDIT.md` 同名条目。

### 行为变更（🔴 新预期行为，非回归）

| 端点 | 变更 |
|---|---|
| `paramSearch.createSearch` | ① **死参数拒绝**：若策略声明的 TUNABLE 参数**没有一个**被规则图引用 ⇒ `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`；被规则图引用的参数才进搜索空间（其余带 `exclusionReason` 排除）。② **窗口前置校验**：窗口必须落在 `dataset_version` 可用窗口内（**北京业务日**）⇒ 越界报 `PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE`（信息含 requested window 与 dataset window）。 |
| `paramSearch.createSearch`（覆盖） | 给「死参数」赋**会变化**的搜索域（ENUM / RANGE）⇒ `PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER`；赋 `FIXED`（单值）允许但会被剥离（不冒充搜索维度）。 |

⚠️ **后果**：对「参数全为死参数」的**历史候选**（`cand-3600xx` 系列，`definition.entry.conditions` 用字面量阈值）创建搜索**会被拒绝**。
历史策略文档**不可变**（`updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE`）⇒ 要用参数搜索必须先以**参数引用**改写条件并生成**新版本**。

### N-01 / N-02 / N-05 状态更新

| 编号 | PARAMETER-001 时 | 现在 |
|---|---|---|
| **N-01**（窗口无 fail-fast） | 遗留 | ✅ **FIXED**（前置校验 + 纯函数单测 + 真机负例） |
| **N-02**（4 组合结果相同且 `tradeCount=0`） | 遗留（「是否为执行链问题不属本任务范围」） | ✅ **已定性 = 情况 D（参数未被执行链消费），根因在策略文档**：PS 参数传递链完整（覆写到达 `experimentConfig.parameters` 与 `CoreDecisionSource`），但 `cand-360001@1.0.0` 的 Core 规则图 `PARAMETER_REFERENCE = 0` ⇒ 决策引擎读不到参数。**正对照**（条件改为参数引用）在同窗口给出 `max_volume_ratio=0.05 → 0 笔` / `=1.0 → 8 笔 −10.36%` ⇒ **执行链本身正确**。PS 侧已加护栏（死参数拒绝）。 |
| **N-03**（`backtestRunId` 恒 NULL） | 遗留 | **DEFERRED（不变）** —— 本任务明确不碰 Evaluation 主链 |
| **N-05**（两套 Parameter Space 派生器） | 遗留 | **已明确收敛状态**：`parameterSpaceFromDocument.ts` = `LEGACY / PREVIEW`（消费者 = 技术预览端点 + **闭环 optimization 阶段**；后者只持有 `document`、拿不到 role 投影行 ⇒ 切换属主链改动，**仍为遗留**）；`parameterSearch/searchSpace.ts` = **PS 唯一**使用（**静态源码守卫测试**钉住） |

### 新增的「不知道就会做错」的事实

1. 🔴 **参数「声明在 schema 里」≠「决策引擎会读它」**。判断可搜性的**唯一判据** = `strategyCore/ruleGraph.ts#collectRuleParameterReferences`（入口 + 出场规则图）。
2. 🔴 **顺序纪律：`派生 → 覆盖 → 死参数剥离 → 校验`**（显式覆盖能把死参数重新塞回搜索空间 —— 实测踩到）。
3. ⚠️ `TUNABLE 缺搜索域` 只在**无 `exclusionReason`** 时报错（有 reason = 刻意排除）。
4. ⚠️ 构造策略文档必须走 `createStrategyDocumentFromDefinition`（v1 视图单向派生）；手改 `definition` 会触发
   `SCHEMA_DEFINITION_VIEW_CONFLICT` / `_VIEW_DRIFT`（校验器**正确拒绝**）。
5. ⚠️ `dataset_version.startDate/endDate` 是 **UTC 时间戳** ⇒ 取业务日期必须按**北京时区**
   （PARAMETER-001 已登记；本任务把该口径落进了 `readDatasetVersionWindow`，成为**单一实现**）。

## ROBUSTNESS-001 增量（2026-09-19 · 编号 `9bu`）

> 本节只登记**本轮真实发生的变化**。逐项清单见 `CHANGE-AUDIT.md` 同名条目。

### 新增「并列兄弟」子模块（**收敛而非新建第二套**）

`robustness:` 域下现在有**三个并列模块**，语义互不重叠：

| 模块 | 语义 | 是否重跑 | 落库 |
|---|---|---|---|
| `server/research/robustness/**`（C-18.1） | 成本/滑点/参数/执行**四轴扰动重估** | ✅ 需注入 evaluator | ❌（内存态 `ROBUSTNESS_RUN`） |
| `server/research/stochasticRobustness/**`（C-18.2） | Monte Carlo / Bootstrap / 成交顺序随机化**重估** | ✅ | ❌ |
| `server/research/searchRobustness/**`（ROBUSTNESS-001） | **冻结 Parameter Search 结果上的邻域稳定性分析** | ❌ **零重跑、零指标重算** | ✅ 三表 |

🔴 **「零重跑」不是承诺而是结构事实**：`searchRobustness/**` 的 import 集被静态守卫测试钉死（不得出现 `backtest` / `strategyEvaluation` / `closedLoop` / `strategyCore` / `runWorkbenchAssembly` / `researchEngine`）。

### 新增表与列

- `search_robustness_run`(33 列) / `search_robustness_result`(28 列) / `search_robustness_parameter_analysis`(16 列)，**0 FK**；
- `parameter_search_run` **ADD COLUMN** `referenceCheckApplied` / `unreferencedTunableCodesJson`（NULLable）。
  🔴 **为什么必须补列**：PARAMETER-002 的死参数筛查结论原先**只进 API 回执、没有落库**，而下游稳健性分析要继承它（规格 §12）却不能回读**当前**策略版本（规格 §9 禁止用未来版本重新解释历史搜索）。补列后：新 Run 写入 `true/false`，**历史行保持 `NULL` = 未知** ⇒ 下游如实标 `ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED`。

### 行为语义（不知道就会读错）

1. 🔴 `stabilityRatio` **无有效邻居时为 `null`**（不是 0）；基准不可判时同样为 `null`。`null` 与 `0` 的区别是「没有可判的邻居」与「邻居全都不稳」。
2. 🔴 **邻域结构（理论 / 实存 / 有效邻居数、缺格明细）恒为事实** —— 即使基准组合自己 `tradeCount = 0` 或源结果缺失，也照常报告邻域（**本次 E2E 抓到的缺陷正是这里**）。
3. 🔴 `tradeCount = 0` ⇒ `INSUFFICIENT_TRADING_ACTIVITY`，**既不判稳定也不判不稳定**，且**不计入** `validNeighborCount`。
4. 🔴 缺格（源 Search 中不存在该邻居组合）恒为 `MISSING_COMBINATION` + 全 `null`，**禁止补值 / 插值**。
5. ⚠️ 搜索空间含 **> 2 个可变参数**时，二维矩阵一个格子会命中多条组合 ⇒ 如实标 `AMBIGUOUS`（不挑一条代表），被略过的参数名进 `omittedParameters`。
6. ⚠️ 数值型 `ENUM` 搜索域**不可编译**（PARAMETER-001 既有口径：数值域只支持**等步长区间**）⇒ 写 E2E 时须用 `DECIMAL_RANGE` 得到 2 个取值。
7. 🔴 **系统不产出「最佳 / 最优 / 推荐参数」**：排序只有描述性字段（含 `stabilityRatio`），该禁令由源码扫描测试钉住（**含负例自测**，防止守卫自身失效）。

### 前端可达性（`接线完成 ≠ 用户够得到`）

- 面板挂在 `/parameter-search`；详情 / 结果 / 矩阵被 `selectedRunId !== null` 包着 ⇒ 必须真点「查看详情」才可达；
- 🔴 **深链 `?robRunId=<id>`**：直接用 URL 打开即自动选中该 Run（刷新 / 分享不丢上下文），已量 DOM 验证；
- 🔴 二维矩阵**不用颜色表达「好坏」**：缺格用虚线边框、状态用文字，配色只跟随**状态种类**。

## OOS-001 增量（2026-09-19 · 编号 `9bv`）

> 本节只登记**本轮真实发生的变化**。逐项清单见 `CHANGE-AUDIT.md` 同名条目。

### 新增模块：`server/research/oosValidation/**`（10 文件）

**唯一职责**：把**某次参数搜索冻结下来的候选参数**，放到**它没参与过的数据窗口**上
**真实重跑回测并重算 canonical 指标**，给出样本内外对照。

🔴 **与 Robustness 的边界（两者是并列兄弟域，语义正好相反，不许合并）**：

| 维度 | `searchRobustness/**`（ROBUSTNESS-001） | `oosValidation/**`（OOS-001） |
|---|---|---|
| 问的问题 | 「同一份结果**邻域**稳不稳？」 | 「换到**没见过**的数据上**还成立吗**？」 |
| 是否重跑回测 | ❌ **零重跑、零指标重算** | ✅ **必须重跑**（并重算 canonical 指标） |
| 数据 | 冻结的 Search 结果（原地） | **新的 OOS 窗口**（与 IS 不重叠） |
| 守卫方向 | import **黑名单**（禁 `backtest`/`strategyEvaluation`/…） | import **白名单 + 必含清单**（必须出现 `createStrategyBacktestBridge` 与 `projectCanonicalMetrics`） |
| 落库 | `search_robustness_*` 三表 | `oos_validation_*` 两表 |

🔴 **「必须真重跑」不是承诺而是结构事实**：`oosValidation/**` 的 import 集被
`tests/server/research/oosValidation/oosValidationBoundary.test.ts` 的**必含清单**正向钉死
（`searchRobustness` 是反向黑名单，两者**镜像**）⇒ 把实现塞进 `searchRobustness/**` 会让守卫立刻变红。

### 与仓库既有四套 OOS 模块的边界（**不重复实现，只补上「可执行 + 可追溯」**）

| 既有模块 | STEP | 与本域差别 |
|---|---|---|
| `research/trainValidationOos.ts` | 6.4 | 纯模型，**不可执行、不落库** |
| `research/validationSelection.ts` | 6.4 | `FrozenOosCandidate` = **进程内计划候选** |
| `research/oosEvaluation.ts` | 6.4 | 文件头自述「**不实现任何回测 / 交易**」 |
| `research/oosIsolation/**` | 19 (C-19.2) | **记录 / 检查层**，无重跑语义 |

本域与它们的根本差别**四条**：① Run 身份与状态机；② 参数冻结**可复核**；
③ **真进闭环重跑**；④ **落库可追溯**。

### 新增表

- `oos_validation_run` / `oos_validation_result`，**0 FK**、0 ALTER、0 DML（`drizzle/0043_oos_validation.sql`）。

### 行为语义（不知道就会读错）

1. 🔴 **冻结信息不足 ⇒ 显式失败**：OOS 只认 `源 Search Run + parameterHash`；参数值一律由服务端
   从源组合行读出并**重算哈希复核**。**不允许**静默回读**当前**策略版本补全。
2. 🔴 **接口层没有参数值位置**：`createOosValidationInputSchema` **只有 4 个键**
   （`sourceSearchRunId` / `parameterHash` / `oosWindow` / `metricsVersion?`）——
   让「顺手传一组更好的参数」在**契约层与 UI 层同时无处可写**（UI 侧由 DOM 探针实测「创建区 `<input>` 恰为 4 个」）。
3. 🔴 **窗口隔离**：`oosStart > searchEnd`，默认**禁止重叠** ⇒ `OOS_WINDOW_OVERLAP`；
   源窗口自身倒挂报 `OOS_SEARCH_WINDOW_INVALID`；越出数据集报 `OOS_WINDOW_OUT_OF_DATASET_RANGE`。
4. 🔴 **`COMPLETED` 不允许再次执行**：重复 `start` 幂等返回既有结果（`executed=false`），
   不重跑、不重算。
5. 🔴 **「真在不同数据上重跑」的主判据 = 撮合指纹差异**（`backtestFingerprint`），
   **优于看指标差异** —— 因为 `tradeCount = 0` 时两侧指标**天然全相等**，看指标会误判为「没重跑」。
6. 🔴 **系统不产出「最佳 / 最优 / 推荐」**：排序 / 展示只有描述性字段；该禁令由源码扫描测试钉住。
7. ⚠️ `null` ≠ `0`：算不出来显示「—」，**不用 0 顶替**。

### 前端可达性（`接线完成 ≠ 用户够得到`）

- 面板挂在 `/parameter-search`（**与 `SearchRobustnessPanel` 同一页、语义正好相反**：
  一个零重跑、一个必须重跑）；
- 🔴 **深链 `?oosRunId=<id>`**：直接用 URL 打开即自动选中该 Run（刷新 / 分享不丢上下文），已量 DOM 验证；
- 🔴 **长请求按钮必须换文案**：「执行样本外验证」pending 时文案变成「正在样本外真实重跑（分钟级）…」。

## WALK-FORWARD-001 增量（2026-09-19 · 编号 `9bw`）

**基线 `v1.3.0` → `v1.4.0`**（minor）。新增**第三条并列执行边** `server/research/walkForward/**`（11 文件）
+ 契约 `shared/walkForwardContracts.ts` + 两表 + 同域 6 端点 + 1 前端面板。

### 定位（一句话）

Walk-Forward 是**编排层**，不是新引擎：时间滚动编排 + Fold 隔离 + 结果汇总 + 可追溯。
链路 = `历史数据 → IS Window → Parameter Search → 冻结候选 → 紧邻 OOS Window → 真实 Strategy Runtime + Backtest → OOS Metrics → 下一个 Window → 多 Fold 汇总`。

### 🔴 三方向镜像守卫（本仓现有三条并列执行边）

| 执行边 | 编号 | 问题 | 是否重跑 | 守卫方向 |
|---|---|---|---|---|
| `searchRobustness/**` | `9bu` | 「同一份结果**邻域**稳不稳？」 | ❌ 零重跑零重算 | import **黑名单** |
| `oosValidation/**` | `9bv` | 「换到**没见过**的数据上**还成立吗**？」 | ✅ 必须重跑 + 重算 | import **必含清单** |
| `walkForward/**` | `9bw` | 「**滚动切窗**后每一折都独立成立吗？」 | ✅ 必须**逐 Fold** 重跑 | **黑名单 +「执行只能经由注入钩子」** |

🔴 **三套守卫互不可搬移**：把本域实现搬进 `searchRobustness/**` 会对侧静态守卫立刻变红。

### 执行接缝（为什么必须注入）

```ts
WalkForwardExecutionHooks { readCurrentContext, runFoldSearch, runFoldOos }
```

由**组合根**（`server/paramSearchRouter.ts`）用**既有** PS / OOS application service 实现
⇒ **零复制策略 IO、零 HTTP 自调用**，规格 §15 明禁的 `WalkForward → HTTP → OOS API → HTTP → Backtest` **不成立**。
域层**允许** import `oosValidation/types`（只为复用 `OOS_ENGINE_VERSION` / `OOS_METRICS_VERSION` 两个常量），
**不得** import 回测 / 评估 / 闭环执行面，也**不得**自建第二套执行路径。

### 版本常量与命名不遮蔽

- 新增 `WALK_FORWARD_VALIDATION_RUN_ID_PREFIX = "WFV"`（C-19.1 既有 `WALK_FORWARD_RUN_ID_PREFIX = "WFA"`）。
- 🔴 本域 `computeWalkForwardValidationRunFingerprint`（原名 `computeWalkForwardRunFingerprint` 与
  `walkForwardRun/serialize.ts` **真实重名**）⇒ 已改名。ESM `export *` 遇同名导出**静默遮蔽**
  ⇒ **本域与 `walkForwardRun/**` 刻意不并入全域 `export *`，一律按文件路径 import**（与 `oosValidation` / `searchRobustness` 同策略）。

### 已登记 Known Risk（继承既有结构性事实）

- 全仓库 **11 个既有策略版本的 `ruleGraphRefs` 全为空** ⇒ 搜历史候选必被拒（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`）；
- `cand-360001@1.0.0` 的 3 个 TUNABLE 笛卡尔积 **1240 > 256** ⇒ `MAX_COMBINATIONS_EXCEEDED`（**禁截断**）；
- `LeakageGuard` 对配方特征**恒通过** ⇒ 策略层无独立未来函数防护，安全全靠数据层 PIT（本域 future-leak 防护为**几何级**）。
