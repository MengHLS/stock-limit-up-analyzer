# SYSTEM-BASELINE-001 — 最终报告

> **Task**：Global Architecture Baseline & Incremental Audit System
> **Baseline Version**：`v1.0.0`
> **审计时间**：2026-09-19（真实库实查 2026-09-19T08:40Z / 16:40 GMT+8）
> **约束遵守**：代码变更 = **0** · DB 变更 = **0** · migration = **0** · 历史 Run 修改 = **0** · `db:push` = **未执行** · `drizzle-kit generate` = **未执行**

---

## 1. Executive Summary

本次对 `stock-limit-up-analyzer` 完成了一次**真实全局代码审计**（不是拼接旧报告）：覆盖 repository / server / client / DB schema+migrations / Dataset / Research / Strategy / Strategy Runtime / Parameter Search / Backtest / Evaluation / Robustness / OOS / Walk-Forward / Simulation / Production / shared contracts / persistence / API routers / tests / scripts / docs / configuration / legacy，共 24 项；并以**只读探针直连真实库**取证（`errors=0`）。

**核心结论（5 条）**

1. **项目比 ROADMAP 记载的更完整，也比 ROADMAP 记载的更分散。**
   代码层面 `Dataset / Research / Strategy / Backtest / Lifecycle / Market Regime` 均已达 **READY**，而 `ROADMAP §44.4` 仍写着「STEP 13~25 BLOCKED」⇒ 属**路线图滞后**，按 ROADMAP §43「真实项目状态决定路线图」，**以本基线为准**。

2. **闭环编排器「14 阶段」，实际只装配 8 个。**
   实装：`data / research / strategy / backtest / evaluation / optimization / regime / finalize`；
   未装配：`robustness / oos / overfitting / paper / review / discipline` ⇒ 以 `CL_RUNNER_NOT_INJECTED` **如实 BLOCKED**（不是失败，是如实登记）。
   ⚠️ 但未装配 ≠ 不可达：这 6 个域**各自另有独立 tRPC 路由**，已达「技术预览」口径（`paramSearchRouter` / `walkForwardRouter` / `reviewRouter` / `marketRegimeRouter`）。

3. **三个「语义权威」已经稳定，且都做过收口。**
   策略语义 → `server/strategyCore/**`（已接生产）；执行/成本/持仓 → `server/backtest/**`（生产全量复用）；指标 → `backtestResult.ts#canonicalMetrics()`（唯一出口，年化 252，算式形式统一）。

4. **最大的结构性风险不是缺功能，而是「同一件事有多条互不相通的实现」。**
   三段不可互换的执行契约、两套 Metrics 口径、两套 Dataset 概念、两套 Research 数据模型、止损三落点、两个 `strategy_*` 模块 —— 全部登记为 Architecture Risk（§8）。

5. **`PARAMETER-001` 目前是 NOT READY，且阻塞点不是逻辑而是性能。**
   逻辑前置已满足（改参数真的改结果，有双向测试证明）；性能侧**在本次审计期间被并发会话（PARAMETER-001-PRE）推进**：单次真实 Run **657.8 s**，**主因已定位**（`strategyCore/canonical.ts` 占 **44.3% CPU self time**，根因 = `computeDefinitionFingerprint` **每次求值调 2 次**）**并已修复**（WeakMap 缓存），零写库阶段基准显示 **research −52% / 主窗合计 −40%**，且两组 digest **逐字节不变**。⚠️ **剩余瓶颈 = DB 读取 ≈95 s（58 次往返），未改善**。

**方法学要点（一条最重要的教训）**
本轮**推翻了 1 条由推断得出的「疑似数据不闭合」结论**：五张 `ds_*` 物理表行数之和初看与 `dataset_version.totalRows` 差 10,000 行；按 `datasetVersionId` 分组复算后证明**逐版本精确闭合、差 0**——是我自己的加法出错。
⇒ **只登记能复算的事实**；对「看起来不对」的数字，先复算再下结论。

**方法学要点二（并发环境）**：审计期间**工作区被其他会话改动**（`server/strategyCore/runtime.ts` 等 11 个 `server/**` 文件未提交；其中 `runtime.ts` 在 16:56 被再改一次）。
⇒ ① 基线必须显式声明「**描述的是工作区快照，不是 HEAD**」；② 行号会漂移，**定位必须以「路径 + 符号名」为主**；③ 采样值必须**带时间戳**（闭环留档 7 @08:40Z → 8 @08:58Z 就是活例子）。详见 `SYSTEM-BASELINE.md` §12.5 的 BD-01 ~ BD-04。

---

## 2. 全局 Domain 状态

| Domain | 状态 | 归属 | 一句话依据 |
|---|---|---|---|
| **Dataset** | **READY** | FACT | 五表记账闭合（1,603,084 = Σ totalRows，差 0）；构建门禁有效；插件注册表 |
| **Research** | **READY** | FACT | 16 张单数表有真实数据（result 6,680 / finding 68 / candidate 13）；转正链 9/13 成功 |
| **Strategy** | **READY** | FACT | Core 语义权威 + 5 投影表 + 版本不可变（`VERSION_IMMUTABLE` 可断言） |
| **Parameter Search** | **PREPARATION / PARTIAL** | FACT + **BLOCKED** | 端点可达；但**搜索结果不落库**、`parameterRole` 门槛未生效、单次 Run ≈10 分钟 |
| **Backtest** | **READY** | FACT | BACKTEST-002 = COMPLETE；policy v1 + canonical 252 + zero-volume |
| **Evaluation** | **PARTIAL** | FACT | 闭环 evaluation 已取 canonical；**第二套口径 `backtest/metrics.ts` 仍在** |
| **Robustness** | **FACT**（技术预览） | FACT / 部分 CODE_READY | `robustness` / `stochastic` 可达（`paramSearchRouter.ts:794/840`）；`factorAblation` **仅测试** |
| **OOS** | **FACT**（技术预览） | FACT / 部分 CODE_READY | `walkForward.oos` 可达（`:605`）；legacy 6.4 **仅测试** |
| **Walk-Forward** | **FACT**（技术预览） | FACT / 部分 CODE_READY | `walkForward.run` 可达（`:561`）；legacy `walkForwardService` **仅测试** |
| **Overfitting** | **FACT**（技术预览） | FACT / 部分 CODE_READY | `walkForward.overfit` 可达（`:698`）；legacy `pbo` **仅测试** |
| **Simulation (Paper)** | **FACT** | FACT + 编排 CODE_READY | 模拟账户（`review.paper.run`）+ 前向纸面 + 调度器均可达；`signalToPnl` 编排**仅测试** |
| **Production** | **PLANNED** | PLANNED | **无任何实现**；Live Trading 无实现 |
| Market Regime（辅助） | **FACT** | FACT | 端点 + 闭环 `regime` 阶段均装配 |
| Lifecycle / Candidate / Review / Discipline（辅助） | **FACT**（技术预览） | FACT | 4 个域各有 tRPC 端点 |
| **Market Data Foundation（STEP 12 A–H）** | **DATA_READY / RESEARCH_READY=TRUE** | FACT | gate 17/17（2026-09-09 判定） |

**闭环装配度**：实装 **8 / 14**，未装配 6。实测留档 7/7 = `PARTIAL_BLOCKED`（`executedStageCount` 5~6 / `blockedStageCount` 8~9），与之一致。

---

## 3. 当前完整数据流（摘要 · 全文 `DATA-FLOW.md`）

```text
原始 DB（OHLCV 8,895,704 行 / securities 5,552 / status / CA / liquidity / index_daily / industry 5,212）
  ↓ datasetRegistry 构建（门禁 INVALID_BUILD_FILTER）
dataset_version(READY) + ds_* 五表（1,603,084 行，记账闭合）
  ↓ runWorkbenchAssembly/datasetFromRegistry.ts（唯一读桥，**仅支持 first_limit_pullback**）
Research（researchCore 16 张单数表）→ conclusion → candidate
  ↓ research.strategyCandidate.promote（**唯一跨域写入口** strategyPromotionPort.ts）
Strategy（strategies 10 / strategy_versions 11 / 5 投影表 / provenance 9）
  ↓ researchRun.loopRun
闭环 8 阶段 → strategyCore 决策 → simulator 撮合 → canonicalMetrics
  ↓
closed_loop_backtest_run（7 行；resultJson = { strategyRun, backtest }）
  ↓ 各域独立端点
Robustness / OOS / WFA / Overfitting（技术预览）· Paper · Review · Discipline
  ↓
Production —— PLANNED
```

**🔴 `datasetVersionId` 的全链作用（本次重点确认）**

| 形态 | 是否权威 |
|---|---|
| `dataset_version.id`（bigint，如 `390002`） | ✅ **运行时唯一权威坐标** |
| `datasetVersion`（label，如 `"v2"`） | ❌ **仅展示** |
| 内容寻址串（`rd-1.0.0-1-<sha256>`） | ❌ **LEGACY**（B 体系） |

传递：`dataset_version.id` → `researchRunRouter#primaryDatasetVersionIdOf` → `datasetFromRegistry` → `DbDatasetDataReader`（强制下推）→ `research_experiment` / `strategy_versions` / `strategy_version_datasets` / `research_strategy_candidate.sourceDatasetVersionId` / `closed_loop_backtest_run` / `StrategyRunSnapshot.datasetReference`。
⚠️ **回落重建时 `datasetVersionId = null`**，且只继承 boards/excludeSt（不继承 event/window/tDayCondition）⇒ **口径不同**（`datasetSource` 区分 `registry` / `rebuild`；实测 4 / 3）。

---

## 4. 当前完整执行流（摘要 · 全文 `EXECUTION-FLOW.md`）

```text
researchRun.loopRun (researchRunRouter.ts:467)
  → assembleRunWorkbenchInputs (:548)
  → createClosedLoopWiring (:622 → executors.ts:713)  ⇒ {stageRunners, artifacts}
  → runClosedLoop (:625)
      → backtest 阶段 (:505/516)
          → runTradeSimulation (simulator/engine.ts:250)
              → planDecisionDay (:671 → plan.ts:212)
                  → applyPositionSizing (plan.ts:120)
              → portfolio.buy/sell · position.settle · execution.quote · computeTradeCost
          → canonicalMetrics (backtestResult.ts:392)
          → composeClosedLoopEvaluationRef (adapters.ts:134，5 重叠标量取 canonical)
          → buildBacktestRunPayload (backtestResult.ts:519)
  → persistClosedLoopBacktestRun (:798 → :276，有界重试 ≤3，best-effort 不抛)
```

**阶段可达性**

| 阶段 | 装配 | 位置 |
|---|---|---|
| data / research / strategy / backtest / evaluation / optimization / regime / finalize | ✅ **8** | `executors.ts:407/414/460/505/522/625/681` + 编排器内置 |
| robustness / oos / overfitting / paper / review / discipline | ❌ **6** | 未装配 ⇒ `CL_RUNNER_NOT_INJECTED` |

**BACKTEST-002 已确认事实（**只登记，不修改**）**：Execution Policy version = **1** · Canonical Metrics **唯一** · annualization = **252** · zero-volume 默认 `REJECT` · fixed-amount 全链 · `BacktestRunResult` · `resultJson.backtest` · `equityDigest` / `tradeDigest`（跨进程逐字节相同）· 历史 6 条**未回填**。完整 13 条见 `EXECUTION-FLOW.md` §4。

---

## 5. 数据库状态（摘要 · 全文 `DATABASE-MAP.md`）

| 项 | 真实值（2026-09-19 实查） |
|---|---|
| BASE TABLE | **63** = schema.ts 声明 **60** + `__drizzle_migrations`(24 行) + `rd_rows_*` ×2（legacy） |
| 外键 | **0**（全软引用） |
| migration | 41 个（`0000…0040`）；**journal 止 0023 / snapshot 止 0015 / `__drizzle_migrations` 24 行** ⇒ `db:push` **不可用** |
| apply 机制 | 手写 SQL（`-- @guard:` 幂等）+ 14 个专用 `scripts/apply*.mjs\|mts` + 通用 `applySqlMigration.mjs`；**无一键全量脚本** |
| **数据集记账** | `ds_*` 五表 = **1,603,084** = v1 **60,002** + v2 **1,543,082** ⇒ **逐版本精确闭合，差 0** |
| 策略 | `strategies` 10 · `strategy_versions` 11（Draft 10 / Validated 1）· 5 投影表 24 / 17 / 19 / 9 / 9 · provenance 9 |
| 闭环留档 | `closed_loop_backtest_run` **7 @08:40Z → 8 @08:58Z**；`PARTIAL_BLOCKED` **8/8**；`datasetVersionId` NULL **0**；带 BACKTEST-002 载荷（`policyVer=1`）**2/8**；带 `strategyRun` **2/8**。新增行 = `clrun-20260919083211921` / `EXP-20260919-PARAM001PRE` |
| Research（新） | experiment 7 / hypothesis 5 / run 18 / analysis 352 / condition 735 / metric **0** / result 6,680 / conclusion 15 / candidate 13 / artifact **0** / finding 68 / question 3 / plan 3 |
| Research（legacy 复数） | experiments **0** / runs **2** / batches **0** / datasets **7**（+2 张 `rd_rows_*`） |
| 行情 | `stock_daily_prices` **8,895,704** · `index_daily` **7,492** · `research_securities` **5,552** · `industry_assignments` **5,212** |

**🔴 项目硬规则（本次核实仍有效）**：❌ `db:push` · ❌ `drizzle-kit generate` · ❌ 手写 `_journal.json` · ✅ migration 必须显式 · ✅ 不随意修改历史数据 · ✅ 历史 Run 不回填 · ✅ 全软引用（无 FK）。

---

## 6. Contract 状态（摘要 · 全文 `CONTRACT-MAP.md`）

| Contract | versioned | 持久化 | 状态 |
|---|---|---|---|
| Dataset（wire + 领域） | ❌ | ✅ | READY |
| Research（wire + `researchCore`） | ❌ | ✅ | READY |
| Strategy Schema（Document + Definition） | ✅ 两层指纹 + semver | ✅ | READY |
| Strategy Runtime | ✅ Definition 指纹 | ⚠️ 落 `resultJson.strategyRun` | READY |
| Backtest + Execution Policy | ✅ **v1** | ✅ `executionPolicyVersion` | READY |
| `BacktestRunResult` | ✅ 含 `annualizationBasis` | ✅ | READY |
| **Canonical Metrics** | ✅ 8 键 + basis | ✅ | **唯一指标来源** |
| Evaluation Ref | ✅ `metricsSource` | ✅ | PARTIAL |
| Closed Loop | ✅ 14 阶段 id | ✅ | PARTIAL（8/14） |
| `strategyRunRecordSchema` / `backtestRunPayloadSchema` | ✅ | ✅ | READY |

**两条不可动摇的铁律**
1. **`canonicalMetrics` 是 Backtest 的唯一指标来源。**
2. **Evaluation 在已有 canonical 时不得重新计算重叠指标**；`NOT_AVAILABLE` 不得被评估器数值顶替。

---

## 7. Legacy 状态（摘要 · 全文 `SYSTEM-BASELINE.md` §11，15 条）

| 分类 | 对象 |
|---|---|
| **LEGACY（仍在产但语义旧）** | B 体系 Dataset（`researchDataset` + `datasetAccess`，tRPC 仍在）· `server/strategy/**` 引擎策略（经 `runBacktestWithRisk` 生产可达）· `server/engine/**`（生产请求路径）· `server/realisticBacktest.ts` |
| **LEGACY（仅测试可达 = 死代码）** | `runBacktestEngine2`（3 测试引用）· STEP 6.x service 5 个（`evaluationService` / `experimentService` / `runService` / `sweepService` / `status`）· 复数 Research 链（`DbExperimentRepository` 等无实例化点）· legacy `oosEvaluation` / `walkForward.ts` / `walkForwardService` / `trainValidationOos` / `pbo` / `overfittingAssessment` / `parameterStability` · `factorAblation` · `signalToPnl` 编排 |
| **零引用（孤儿）** | `server/engine/adapter.ts` |
| **DEPRECATED（语义失效 / 待收口）** | legacy `LeakageGuard`（因 `EPOCH_FLOOR_DATE` **恒通过**）· `DATASET_BUILD_CONFIG_DEFAULTS` · `backtest/metrics.ts` 第二套口径 |
| **LEGACY 存储** | `rd_rows_05809b1a6d97aa02`(163) / `rd_rows_5dce9db1421bec38`(800) |

**处置原则**：本次**只登记，不删除、不重构**（`runBacktestEngine2` 按 BACKTEST-001 规格 §4 要求保留）。

---

## 8. 当前 Architecture Risks

### 高

| # | 风险 | 证据 |
|---|---|---|
| **AR-1** | **三段不可互换的执行契约**：`runBacktestWithRisk` / `runTradeSimulation` / `simulateRealisticTPlus1ToTPlus2` ⇒ 同策略换入口得不同数字 | `EXECUTION-FLOW.md` §7 E-1 |
| **AR-2** | **R-06 性能**：单次 Run **657.8 s**。**主因已定位**（`canonical.ts` **44.3% CPU**；`computeDefinitionFingerprint` 每求值 2 次）**且已修**（WeakMap；research **−52%**，digest 不变）。⚠️ **剩余阻塞 = DB 读取 ≈95 s（58 次往返，未改善）** | `_probe_param001_pre_profile.*` / `_probe_param001_stage_bench.{before,after}.*` |
| **AR-3** | **止损三落点互不相通**；`server/engine/**` **完全不执行**止损 | 口径核查 |
| **AR-4** | **策略层无独立未来函数防护**（legacy `LeakageGuard` 恒通过）；Core 侧守卫真实生效 | `recipeRegistryAtoms.ts:47-58` |

### 中

| # | 风险 |
|---|---|
| **R-01** | 搜索结果**不落库** ⇒ 无实验追溯 |
| **R-02** | 运行级复现快照缺失（无 `parameterSet`/`codeVersion`/`engineVersion`/`seed`/`Universe`/`startedAt`） |
| **R-03** | `codeVersion` **11/11 = `1.0.0+gunknown`** ⇒ 版本列不可复现 |
| **R-04** | `setVersionStatus` **不吃 §23 迁移表** ⇒ `Draft→Production` 跳级不被拒 |
| **R-05** | `parameterRole` 门槛未生效（`listSearchableParameters` 零生产调用）⇒ `FIXED` 参数仍会被搜 |
| **R-06** | 两套 Metrics 口径并存 ⇒ 「A 比 B 好」可能只是口径差 |
| **R-07** | 数据集桥**仅支持单一 datasetCode** ⇒ 「换数据集」在数据层无数据可用 |
| **R-08** | `prefix`/`post` 物理表**不在 migration 链内** ⇒ 迁移链与 DDL 双源漂移 |
| **R-09** | 无 FK ⇒ 「校验通过 → 提交前被删」窗口存在 |
| **R-10** | 单次运行可复现性不完整（N-05 `runtimeConfig` 运行级 / N-06 数据集视界逐日不可知） |
| **R-11** | 基础设施：主 barrel 混居 legacy（加载即求值）· 4 个同名 `adapter.ts` · `research` 单复数表仅差一个 `s` |

### OBSERVED（尚未成为正式缺陷）

闭环 7/7 `PARTIAL_BLOCKED`（如实登记）· `research_analysis_metric`/`research_artifact` 0 行 · 多处**陈旧代码注释**（`reviewRouter.ts:26-27` / `RegimeReport.tsx:145` 称未合并进 appRouter，实际已注册；`closedLoopWiring/index.ts:13-14` 称只装配 5 阶段，实际 8）· `prefix` 含 `rd = 0`（旧文档描述的是三表结构，易误读）。

---

## 9. 当前 Roadmap

| 阶段 | 状态 |
|---|---|
| STEP 12 数据地基 A–H | **COMPLETED**（`RESEARCH_READY = TRUE`，gate 17/17） |
| STEP 12.5 / 12.6 | **CODE_READY**（真数据 PIT 抽样验证未做） |
| STEP 13 Research Engine | **READY**（⚠️ 与 ROADMAP §44.4 的 BLOCKED 不同步） |
| STEP 14 Backtest Engine | **READY** |
| STEP 15 Strategy Definition + Versioning | **READY** |
| STEP 16 Strategy Evaluation | **PARTIAL** |
| STEP 17 Parameter Optimization | **PREPARATION**（阻塞 R-06） |
| STEP 18 / 19 / 20 Robustness / WFA·OOS / Overfitting | **IN PROGRESS**（技术预览口径） |
| STEP 21 Strategy Lifecycle | **READY** |
| STEP 22 Market Regime | **READY** |
| STEP 23 Paper Trading | **IN PROGRESS** |
| STEP 24 Trading Review / Discipline | **IN PROGRESS** |
| STEP 25 Production Quant Platform | **PLANNED** |
| **BACKTEST-001** | NOT COMPLETE（历史） |
| **BACKTEST-002** | ✅ **COMPLETE** |
| **BACKTEST-003 / BACKTEST-004** | 🔴 **未创建**（本任务亦**不创建**） |
| **PARAMETER-001** | ⛔ **NOT READY** |

---

## 10. Baseline 文件说明

| 文件 | 职责 | 行数量级 |
|---|---|---|
| `SYSTEM-BASELINE.md` | **总入口**：Overview / Architecture / Domain Map / Workflow / Status / Contracts / DB / Execution / 前后端边界 / 生产路径 / Legacy / Risks / Roadmap / **ADR ×17** / Version / Audit Time / Change Time / **Incremental Audit Protocol** / **Global Audit 触发条件** / **Drift 机制** | ~470 |
| `system-manifest.yaml` | **机器可读基线**：`system` + 14 个 Domain（status/purpose/sourcePaths/entryPoints/inputs/outputs/consumers/persistence/tests/knownRisks/legacyPaths）+ `database` + `testing` + `openFindings` + `nextStage` | ~640 |
| `DOMAIN-MAP.md` | 领域边界，**含「不负责什么」**；域间边界速查表 | ~230 |
| `DATA-FLOW.md` | 数据流 + **`datasetVersionId` 全链作用** + 数据格式/版本化对照 + 断点 | ~180 |
| `EXECUTION-FLOW.md` | 真实执行链（逐跳行号）+ **BACKTEST-002 13 条事实** + 可达性总表 + 死代码表 + 9 条 OBSERVED | ~200 |
| `DATABASE-MAP.md` | 数据库域地图（真实行数）+ migration 真机制 + 软引用 + 历史 Run 保护规则 | ~190 |
| `CONTRACT-MAP.md` | 13 条契约（定义位置/生产者/消费者/versioned/持久化/nullable/兼容性规则）+ 7 条检查清单 | ~220 |
| `DEPENDENCY-MAP.md` | 域/模块依赖图 + 禁止依赖核对 + 循环 + 8 条架构风险 | ~150 |
| `AGENT-GUIDE.md` | **Agent 使用规范**：默认读取顺序 + 14 条禁止行为 + 报告格式 + 14 条特有陷阱 + 工具环境 | ~130 |
| `CHANGE-AUDIT.md` | 最近变更（**append-only**，已回填 7 条历史任务 + 6 条未登记架构级变更） | ~180 |
| `SYSTEM-BASELINE-001-REPORT.md` | 本报告 | — |

**只读探针（新增 3 个，均 `errors=0`）**

| 文件 | 用途 |
|---|---|
| `docs/evidence/_probe_baseline_state.mts` / `.out.json` / `.out.txt` | 各域核心表真实行数 + 闭环留档细分 + 策略/候选分布 |
| `docs/evidence/_probe_baseline_tables.mts` / `.out.json` | 枚举真实库 63 张 BASE TABLE |
| `docs/evidence/_probe_baseline_ds_accounting.mts` / `.out.json` | 校验 `ds_*` 五表与 `dataset_version` 记账闭合 |

> 设计原则：**不为了文档数量而拆文档**——每份文件职责互不重叠；数据不复制源码；不罗列测试用例名。

---

## 11. Incremental Audit 机制

见 `SYSTEM-BASELINE.md` §18（10 步协议）。要点：

```text
读 SYSTEM-BASELINE → 读 system-manifest → 读 CHANGE-AUDIT
→ 确定 Domain → 只审计【本 Domain + 上游直接依赖 + 下游直接消费者 + 涉及 Contract】
→ 开发 → 更新 CHANGE-AUDIT（架构变化才升基线版本）
```

**成本对照**：全量重审计需读 628 server + 215 client + 41 migration + 276 测试 + 534 文档；增量审计只需 **3 个基线文件 + 本 Domain 若干文件**。

---

## 12. Global Audit 触发条件

见 `SYSTEM-BASELINE.md` §19（12 条）。摘要：

1. Domain 新增 · 2. Domain 删除 · 3. Domain 边界变化 · 4. 核心数据流变化 · 5. 主链变化 · 6. DB 核心 Schema 大规模变化 · 7. 核心 Contract 变化 · 8. `StrategyRuntime` 职责变化 · 9. Backtest Execution Architecture 变化 · 10. 多 Domain 同时大规模重构 · 11. Baseline 与代码重大冲突 · 12. 无法通过增量审计确定影响范围

**普通任务只做 Incremental Audit**；触发任一条时**必须在 `CHANGE-AUDIT.md` 写明条目编号**。

---

## 13. Baseline Drift 机制

见 `SYSTEM-BASELINE.md` §20。检测对象：`source paths` / `entry points` / `contracts` / `DB tables` / `domain status`。

```text
Baseline says A ∧ 实际是 B
  ⇒ 输出 { drift, actual, detectedBy, correctedAt, reason }
  ⇒ 修正 Baseline（**不改代码**）→ 写 CHANGE-AUDIT → 恢复任务
```

🔴 **铁律：禁止为了让 Baseline 看起来正确而修改代码。** 冲突时以 **DB + 实际运行 + 代码**为准。

---

## 14. 文档冲突处理结果

**原则（已执行）：历史报告全部保留；`SYSTEM-BASELINE` 作为当前架构事实入口；旧报告与当前事实不同者登记为 `Historical documentation drift`，以当前代码为准。未大规模删除任何历史报告。**

**已登记 11 条漂移**（`SYSTEM-BASELINE.md` §12.4，H-1 ~ H-11）

| # | 旧文档 | 旧说法 | 当前事实 |
|---|---|---|---|
| H-1 | `docs/PRODUCT_GAP_MATRIX.md:15` | `strategy_versions` 表**缺失** | 已建（`schema.ts:528`，`0026/0034/0035`） |
| H-2 | `docs/PRODUCT_GAP_MATRIX.md:14` | 缺 `research_datasets` 持久化表 | 已存在（`schema.ts:430`，`0024`） |
| H-3 | `docs/PRODUCT_GAP_MATRIX.md:48` | industry `securityId` 全 NULL | 已统一（`0023`） |
| H-4 | `docs/PRODUCT_GAP_MATRIX.md:79` | 21 页前端 | 现 **33** 条路由 |
| H-5 | `docs/research/RESEARCH-001-SCHEMA.md:120,342` | hypothesis.status 含 `TESTING`/`PARTIALLY_SUPPORTED` | 已废弃；现 6 态 |
| H-6 | `docs/quant-system-contract.md:145,494` | `stock_daily_prices` 116,332 行 / PARTIAL | 现 **8,895,704** 行 |
| H-7 | `docs/audit/reports/…:137` | `server/routers.ts.tmp` 存在 | 已不存在 |
| H-8 | `docs/strategy/STRATEGY-003-difference-report.md:14` | 域模型 PARTIAL | 5 投影表已建 |
| H-9 | `docs/research/BACKTEST-001-IMPLEMENTATION-REPORT.md:10` | BACKTEST-001 = NOT COMPLETE | 已被 BACKTEST-002 收口 |
| H-10 | `AUDIT-DRS-001-EVIDENCE.md:7` | 58 张表 | schema 60 / 库 **63** |
| H-11 | 根 `DEVELOPMENT_PLAN.md` / `TASK_TRACKING.md` | 引用**不存在**的根 `ROADMAP.md`；最后更新 09-07 / 09-09 | 权威为 `ROADMAP.md` + `docs/MASTER_*` |

**另有 1 条路线图级漂移**：`ROADMAP.md §44.4` 依赖链写「STEP 13~25 BLOCKED」，与实际（13/14/15/21/22 READY）不同步 ⇒ 按 §43 **以本基线为准**；`ROADMAP.md` 的同步属后续任务（本任务不改 `ROADMAP.md` 的 §44.4）。

---

## 15. 当前 Baseline Version

**`v1.0.0`**（首版）

| 变更类型 | 版本动作 |
|---|---|
| Domain 新增/删除/边界变化 · 核心数据流/Contract/主链变化 | **major** `v2.0.0`（更新全部基线文件） |
| Domain 状态跃迁 · 新增 entry point / contract | **minor** `v1.1.0`（更新 BASELINE + manifest） |
| 实现细节 | 不变（只更新 `CHANGE-AUDIT.md`） |

---

## 16. 后续 Agent 使用方法

见 `AGENT-GUIDE.md`。**默认顺序**：

```text
1. SYSTEM-BASELINE.md
2. system-manifest.yaml
3. CHANGE-AUDIT.md
4. 当前 Domain 文档
5. 当前任务相关代码
6. 必要的上游 / 下游代码
```

只有触发 `GLOBAL AUDIT REQUIRED` 时才重新全局审计。

**Agent 不得**：自己重新定义项目架构 · 绕过 Baseline · 把旧代码当生产代码 · 把 planned 当 ready · 为当前任务擅自修改其他 Domain · 修改历史数据而不登记 · 修改 Contract 而不更新 `CONTRACT-MAP.md` · 为了让 Baseline 看起来正确而修改代码。

---

## 17. 验收标准逐项核对（规格 §27，31 项）

| # | 标准 | 结果 | 证据 |
|---|---|---|---|
| 1 | 已实际完成一次全局代码审计 | ✅ | 6 条并行只读审计轴 + 3 个真实库探针（`errors=0`） |
| 2 | Dataset 状态已确认 | ✅ | READY；记账闭合差 0 |
| 3 | Research 状态已确认 | ✅ | READY；两套模型对照已登记 |
| 4 | Strategy 状态已确认 | ✅ | READY；Core 已接生产 |
| 5 | Backtest 状态已确认 | ✅ | READY；BACKTEST-002 COMPLETE |
| 6 | Parameter Search 状态已确认 | ✅ | PREPARATION / PARTIAL + BLOCKED(R-06) |
| 7 | Evaluation 状态已确认 | ✅ | PARTIAL |
| 8 | Robustness / OOS / Walk-Forward 状态已确认 | ✅ | FACT（技术预览）+ 部分 CODE_READY |
| 9 | Simulation 状态已确认 | ✅ | FACT + 编排 CODE_READY |
| 10 | Production 状态已确认 | ✅ | PLANNED（无实现） |
| 11 | Database 状态已确认 | ✅ | 63 表 / 0 FK / journal 止 0023 / `db:push` 不可用 |
| 12 | Domain 边界已确认 | ✅ | `DOMAIN-MAP.md`（含「不负责什么」+ 边界速查） |
| 13 | 数据流已确认 | ✅ | `DATA-FLOW.md` |
| 14 | 执行流已确认 | ✅ | `EXECUTION-FLOW.md`（逐跳行号） |
| 15 | 核心 Contract 已确认 | ✅ | `CONTRACT-MAP.md`（13 条） |
| 16 | Legacy 路径已确认 | ✅ | 15 条（`SYSTEM-BASELINE.md` §11） |
| 17 | Architecture Decisions 已登记 | ✅ | **AD-01 ~ AD-17** |
| 18 | 当前 Roadmap 已对齐 | ✅ | §9（并标出 ROADMAP §44.4 滞后） |
| 19 | 文档冲突已检查 | ✅ | 11 条 drift + 1 条路线图漂移 |
| 20 | `system-manifest.yaml` 已建立 | ✅ | 14 Domain 全字段 |
| 21 | Incremental Audit Protocol 已建立 | ✅ | §11 / `SYSTEM-BASELINE.md` §18 |
| 22 | Global Audit 触发条件已建立 | ✅ | §12 / §19（12 条） |
| 23 | Baseline Drift 机制已建立 | ✅ | §13 / §20 |
| 24 | Agent Guide 已建立 | ✅ | `AGENT-GUIDE.md` |
| 25 | CHANGE-AUDIT 已建立 | ✅ | 含 7 条历史回填 + 6 条未登记架构变更 |
| 26 | **未创建 BACKTEST-003 / BACKTEST-004** | ✅ | 全仓无此编号 |
| 27 | **未修改数据库** | ✅ | 探针全程 SELECT；0 DDL / 0 DML |
| 28 | **未修改历史 Run** | ✅ | `closed_loop_backtest_run` 7 行零改动 |
| 29 | **未进行 db:push** | ✅ | 未执行任何 drizzle-kit 命令 |
| 30 | **未进行 drizzle-kit generate** | ✅ | 同上 |
| 31 | **没有把 planned/legacy 错误标记为 READY** | ✅ | PLANNED / LEGACY / DEPRECATED / OBSERVED 全部显式标注 |

**31 / 31 全部满足。**

---

## 18. 本任务完成后的行为（规格 §28）

> **不继续开发 PARAMETER-001。不继续优化 Backtest。不继续拆任务。**
> 已停止，仅输出：本报告 + Baseline Version + 各 Domain 状态 + PARAMETER-001 当前状态 + 下一次普通任务如何使用 Baseline。

| 项 | 值 |
|---|---|
| **Baseline Version** | **`v1.0.0`** |
| **各 Domain 状态** | Dataset READY · Research READY · Strategy READY · Parameter Search PREPARATION/PARTIAL(BLOCKED) · Backtest READY · Evaluation PARTIAL · Robustness/OOS/WFA/Overfitting FACT(技术预览) · Simulation FACT · Production PLANNED |
| **PARAMETER-001 当前状态** | 🔄 **IN PROGRESS（PRE）** —— 逻辑前置已满足；阶段级 profile **已做**，R-06 主因（`canonical.ts` 44.3% CPU / fingerprint 重复求值）**已定位并修复**（research −52%，digest 逐字节不变）；**剩余瓶颈 = DB 读取 ≈95 s**（本任务**未继续开发 PARAMETER-001**，仅如实登记并发会话的既有产出） |
| **下一次普通任务如何使用 Baseline** | 读 `SYSTEM-BASELINE.md` → `system-manifest.yaml` → `CHANGE-AUDIT.md` → 定位 Domain → **只审计本 Domain ± 直接上下游 ± 涉及契约** → 开发 → 更新 `CHANGE-AUDIT.md`（架构变化才升基线版本）。**除非触发 `GLOBAL AUDIT REQUIRED`，否则不再重新全局审计。** |
