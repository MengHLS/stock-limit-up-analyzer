# ARCHITECTURE — 当前实际架构

> 建立时间：**2026-10-03**（任务 `CODE-AGENT-INFRA-001`）· 判定方式：**实查当前代码**（`rg` / 文件枚举 / router 键枚举 / migration 实读）。
> 本文件**只记录当前实际架构**，不设计未来架构。
> 与既有基线的关系：`docs/architecture/SYSTEM-BASELINE.md`（v2.0.0 / auditedAt 2026-09-20）是**上一次**全量审计的索引；本文件与其**不一致处一律标注为 drift**（见 §11），**本任务只登记，不修改代码**。
> 配套：`MODULE-MAP.md`（模块地图）· `LEGACY-MAP.md`（legacy 路径）· `system-manifest.yaml`（机器可读）· `DEPENDENCY-MAP.md` / `DOMAIN-MAP.md` / `DATA-FLOW.md` / `EXECUTION-FLOW.md` / `DATABASE-MAP.md` / `CONTRACT-MAP.md`。

---

## 1. 项目定位与主链

个人 A 股量化策略研究平台。理想研究链路：

```text
Dataset → Research → Strategy → Parameter Search → Backtest
        → Evaluation → Robustness → OOS → WFA → Paper Trading → Production
```

**当前现实**：`Production` 为 `PLANNED`（无实现）；`Robustness / OOS / WFA / Overfitting` 各有**独立 tRPC 路由**（技术预览口径）；闭环编排器声明 14 阶段，实际**执行器只装配子集**（见 §6）。

技术栈（取自 `package.json`）：React 19.2 · Vite 7.1 · TypeScript 5.9（strict）· Express 4.21 · tRPC 11.6 · Drizzle ORM 0.44（mysql2 / TiDB）· Tailwind 4.1 · Vitest 2.1 · pnpm。

规模（实查 **2026-10-03**）：

| 项 | 值 |
|---|---|
| `server/**` `.ts` | **697** |
| `client/src/**` `.ts/.tsx` | **223**（components 136 · pages 49 · lib 18 · adapters 8 · hooks 4 · researchExperiments 3 · contexts 1） |
| `tests/**` 测试文件 | **325** |
| `drizzle/*.sql` migration | **56**（`0000…0054`） |
| `drizzle/schema.ts` 声明表 | **≈55**（`mysqlTable(` 实查；行数 2224） |
| tRPC 顶层 key | **21** |
| 前端 `<Route>` 声明 | **44** |

---

## 2. 分层

```text
┌─────────────────────────────────────────────────────────────────────┐
│ client/**   React 19 + tRPC client（不得 import server/** 运行时值）  │
│   routes(44) · components · adapters(tRPC→视图模型) · lib · hooks     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ tRPC（21 顶层 key）
┌───────────────────────────────▼─────────────────────────────────────┐
│ server/_core/**   Express + tRPC 基础设施 + 启动装配 + 调度器         │
├─────────────────────────────────────────────────────────────────────┤
│ server/<domain>/**   领域模块（Dataset / Research / Strategy /        │
│                      Backtest / Portfolio / Risk / ...）              │
├─────────────────────────────────────────────────────────────────────┤
│ shared/**            契约（zod + TS 同源）与口径函数（双向可用）       │
├─────────────────────────────────────────────────────────────────────┤
│ drizzle/** + TiDB/MySQL   持久化                                     │
└─────────────────────────────────────────────────────────────────────┘
```

- `client/**` **只允许** `import type` 引用 `server/**`；口径函数必须落 `shared/`。
- 领域依赖**只允许单向向下**，反向依赖 = 架构违规（多条边有静态守卫测试钉住）。

## 3. 三个「语义权威」

| 层 | 权威位置 | 地位 |
|---|---|---|
| **策略语义** | `server/strategyCore/**` | 唯一语义权威；legacy `StrategyDefinition` 降级为**存储编码**（`adapters/legacyDefinition.ts` 双向翻译） |
| **执行 / 成本 / 持仓** | `server/backtest/**` | 事实上的 Backtest Core；生产回测 `server/research/simulator` 复用其语义 ⇒ **禁新建 `backtestCore/**`** |
| **指标** | `server/backtest/backtestResult.ts#canonicalMetrics` | **唯一指标出口**；Evaluation 在已有 canonical 时不得重算重叠指标 |

## 4. 核心领域模块

| 领域 | 权威位置 | 状态 |
|---|---|---|
| Dataset | `server/datasetRegistry/**`（插件化：`plugins.ts` + `physicalTables.ts`） | `CORE` |
| Research（独立实验） | `research-experiments/**` + `server/researchExperiments/**` + `server/artifactStorage/**` | `CORE` |
| Research（闭环运行） | `server/researchRunRouter.ts` + `server/research/closedLoop/**` + `closedLoopWiring/**` | `ACTIVE` |
| Strategy | `server/strategyCore/**`（语义） + `server/research/strategySchema/**`（编码） + `strategyPersistence/**`（持久化） + `lifecycle/**`（状态机） | `CORE` |
| Parameter Search | `server/research/parameterSearch/**` + `server/paramSearchRouter.ts` | `ACTIVE`（技术预览口径） |
| Backtest | `server/backtest/**`（Core） + `server/research/simulator/**`（撮合编排） | `CORE` |
| Evaluation | `server/research/strategyEvaluation/**` + `server/backtest/backtestResult.ts` | `ACTIVE` |
| Robustness | `server/research/searchRobustness/**` + `server/research/robustness/**` | `ACTIVE`（持久化） |
| OOS | `server/research/oosValidation/**` + `server/research/oosIsolation/**` | `ACTIVE`（持久化） |
| Walk-Forward | `server/research/walkForward/**` + `server/research/walkForwardRun/**` | `ACTIVE`（持久化） |
| Overfitting | `server/research/overfittingDetection/**` | `ACTIVE` |
| Market Regime | `server/research/marketRegime/**` | `ACTIVE` |
| Paper Trading | `server/research/paperAccount/**` + `server/paperTrading3fTop3Runner/**` + `server/paperTrading.ts` | `ACTIVE` / 部分 legacy |
| Portfolio / Risk | `server/portfolio/**` · `server/riskEngine/**` · `server/risk/**` | `ACTIVE` |
| Simulation | `server/research/simulator/**` | `CORE` |
| Lifecycle / Review / Discipline | `server/research/lifecycle/**` · `tradeJournal/**` · `disciplineFeedback/**` | `ACTIVE` |
| Legacy 引擎 | `server/engine/**` · `server/strategy/**` · `server/realisticBacktest.ts` | `LEGACY`（部分**在产**，见 `LEGACY-MAP.md`） |

## 5. 端到端数据流

```text
[1] 原始数据（stock_daily_prices / securities / status / CA / liquidity / index / industry）
      ↓ server/datasetRegistry（构建门禁 INVALID_BUILD_FILTER）
[2] dataset_version(READY) + ds_{code}_{event,prefix,post,path,outcome} 五表
      ↓ server/runWorkbenchAssembly/datasetFromRegistry.ts（A 体系 → 运行时 Dataset）
[3] 运行时 Dataset（researchDataset/types 的行封装 + datasetAccess 的 cursor/session）
      ↓ 独立实验：research-experiments/**（作者面）→ server/researchExperiments（runner）
      ↓ 闭环：researchRun.loopRun → closedLoop 14 阶段
[4] 策略：strategyCore 决策 → strategySchema（编码） → strategyPersistence（版本落库）
[5] 回测：research/simulator + backtest/** → canonicalMetrics()
[6] 留档：closed_loop_backtest_run（resultJson = { strategyRun, backtest }）
[7] Robustness / OOS / WFA / Overfitting（独立 tRPC：paramSearch / walkForward）
[8] Paper / Review / Discipline
[9] Production —— PLANNED
```

🔴 **关键坐标**：整条链上唯一运行时权威数据集坐标 = **`datasetVersionId`**（bigint）；label / 内容寻址串仅展示。
🔴 **判定日坐标** = `decisionOffsetDays`（观察日条件必须显式声明判定日，否则 `OBSERVATION_WITHOUT_DECISION_DAY`）。

## 6. 执行流：闭环 14 阶段

- 编排器：`server/research/closedLoop/orchestrator.ts`（`runClosedLoop`）。
- 阶段契约：`server/research/closedLoop/spec.ts` + `types.ts`（`CLOSED_LOOP_STAGE_IDS`）。
- 装配声明（**唯一权威**）：`server/research/closedLoopWiring/requirements.ts` —— 逐阶段声明 `module` / `satisfyVia` / `entryPoints` / `wired` / `notWiredReason`。
- 执行器实现：`server/research/closedLoopWiring/executors.ts`（`createClosedLoopWiring` / `createStreamingClosedLoopWiring`）。

| 阶段 | 装配声明 | 执行器实装 |
|---|---|---|
| data / research / strategy / backtest / evaluation | `wired: true` | ✅ 已实装 |
| optimization / regime / finalize | `wired: true` | ⚠️ **`executors.ts` 未见对应 runner**（drift 候选，见 §11） |
| robustness / oos / overfitting / paper / review / discipline | `notWired` ⇒ 如实 `CL_RUNNER_NOT_INJECTED` | ❌ 未装配（各自有独立 tRPC 路由可达） |

**纪律**：未装配阶段必须**如实** BLOCKED / `CL_RUNNER_NOT_INJECTED`，**禁止**改成静默 success。

## 7. 独立研究实验体系

```text
research-experiments/**          作者面：一个实验 = 一个目录 = 一个 ExperimentDefinition
  ├── manifest.ts                注册清单（新增实验：+1 行 import + 1 行数组项）
  ├── template/                  可复制模板
  ├── robustnessBridge.ts        跨阶段 Robustness 唯一引桥（零实现/零状态/零 IO）
  └── <group>/<experiment>/      experiment.ts + result.ts + page.tsx
server/researchExperiments/**    运行 / 持久化 / 注册表 / tRPC
  ├── runner.ts · registry.ts · datasetPort.ts · compositeDatasetProvider.ts
  ├── strategyBridge.ts / strategyBridgeRouter.ts   （Experiment → Strategy）
  └── persistence/**             runRepository / runService / artifactPublisher
server/artifactStorage/**        对象存储端口（唯一出口；禁直连 MinIO SDK）
shared/researchExperimentsContracts.ts  唯一对外契约面
client/src/researchExperiments/** + pages/researchExperiments/**
```

- 新增实验**不需要**改 Research Core / Strategy Core / tRPC / DB。
- 结果结构 = 通用信封 + 实验自有 `customPayload`；**契约刻意不含** `analysisId` / `findingIds` / `conclusion` / `candidateId`。

## 8. 前后端边界

| 规则 | 现状 |
|---|---|
| `client/**` 不得 import `server/**` 运行时值 | ✅ 全部 `import type` |
| `@shared/*` 双向可用（`vite.config.ts` / `tsconfig.json` / `vitest.config.ts` 三处别名必须同步） | ✅ |
| 契约放 `shared/`，口径函数必须落 `shared/` | ✅（`ladderHeight` / `sectorHeatOrder` / `datasetRegistryContracts` / `researchExperimentsContracts` …） |
| 🔴「接线完成」≠「用户够得到」 | 交付前必须无头量 DOM |

**tRPC 顶层 key（21）**：`system` · `historicalState` · `researchDataset` · `strategyDomain` · `datasetRegistry` · `researchRun` · `researchExperiments` · `experimentStrategy` · `dataHealth` · `paramSearch` · `walkForward` · `marketRegime` · `review` · `auth` · `limitUp` · `image` · `operationLog` · `watchlist` · `market` · `sector` · `sentiment`。

## 9. 数据库

| 项 | 实查 2026-10-03 |
|---|---|
| migration 文件 | **56**（`0000…0054`，编号连续，手写 SQL） |
| `drizzle/schema.ts` | 2224 行 / **≈55** `mysqlTable` 声明 |
| `_journal.json` max idx | **23** ⇒ 其后无 journal 条目 |
| snapshot 文件 | **16**（`0000…0015`） |
| ⇒ `db:push` | **不可用**（`drizzle-kit generate && migrate`） |
| 外键约束 | **0**（全软引用 `id`，应用层保证） |
| 实际 apply 机制 | 手写 SQL（`-- @guard` 幂等）+ 专用 `scripts/apply*.mjs|mts` + 通用 `applySqlMigration.mjs` |

**旧 Research 表已退役**（`0046_legacy_research_retire.sql`）：零行且只为旧结构存在的表 `DROP`；有历史行的表 `RENAME` 为 `archive_research_*`（数据一行不丢，代码侧零引用）。

## 10. Legacy 概览

完整清单见 `LEGACY-MAP.md`。主要项目：

- `server/researchDataset/**` 的 **B 体系 Dataset**（`researchDataset` tRPC 仍在产）—— 但注意：该目录下的 `types.ts` / `version.ts` / `policy.ts` 是**在产共享原语**，**不是** legacy。
- `server/engine/**`（`runBacktestWithRisk`，生产可达 `sentiment.getLeaderCandidateBacktest`）。
- `server/strategy/**`（legacy 引擎策略 + `strategyBacktest.ts`）。
- `server/realisticBacktest.ts`（legacy 逐日模拟器）。
- `server/research/framework/leakage.ts`（在产但恒通过 ⇒ 语义失效）。
- `server/research/factorAblation/**` · `server/research/signalToPnl/**`（`CODE_READY` 未接线）。
- `archive_research_*` 表（归档存储，禁止重回读路径）。

## 11. 已知基线漂移（BASELINE_DRIFT，本任务登记不改码）

`SYSTEM-BASELINE.md` v2.0.0 的 auditedAt = **2026-09-20**，其后代码与库持续演进。以下为实查发现的漂移（**未**改写既有基线文档，仅登记）：

| # | Baseline 说 | 实查（2026-10-03） | 性质 |
|---|---|---|---|
| **BD-11** | `server/researchCore/**` / `server/researchEngine/**` / `server/researchPlanner/**` 是领域权威入口 | **三个目录已不存在**（提交 `e79b510` 拆解：`researchCore` → `server/research/*.ts`；`researchEngine/planner/moduleRegistry.ts` → `research/patternLibrary/moduleRegistry.ts`；`researchEngine/datasetReader.ts` → `researchRuntime/datasetReader.ts`） | 结构性漂移 |
| **BD-12** | 两套 Research 数据模型并存（复数 4 表「生产不可达但被 barrel 隐性加载」） | 旧 Research 表已 DROP / RENAME 为 `archive_research_*`（migration `0046`），旧领域层与研究引擎代码整体删除 | **已解决** |
| **BD-13** | `drizzle/schema.ts` 2947 行 / 70 张表；migration 45 | 2224 行 / **≈55** 张；migration **56** | 数字漂移 |
| **BD-14** | 闭环「实装 8/14 阶段」 | `requirements.ts` 声明 8 阶段 `wired: true`，但 `executors.ts` 只初始化 data/research/strategy/backtest/evaluation；optimization/regime/finalize **无对应 runner**（可能由其它入口补，**未证实**） | 待核漂移 |
| **BD-15** | `docs/architecture/**` 各图均为 round-2 读数 | 本文件（`ARCHITECTURE.md`）与 `MODULE-MAP.md` / `LEGACY-MAP.md` 为 2026-10-03 新读数 | 新增读数 |
| **BD-16** | `tests/server/research/strategyCandidate/importBoundary.test.ts` 是「本项目唯一被测试固化的跨域边界」（`DOMAIN-MAP.md` §2 原文） | **该测试文件已不存在**；`researchCore` 也已删除 ⇒ 该守卫的守护对象消失 | ✅ **已修正**（CODE-AGENT-INFRA-002：`DOMAIN-MAP` / `CONTRACT-MAP` / `DEPENDENCY-MAP` / `system-manifest.yaml` 的引用已改指活守卫） |
| **BD-17** | `DOMAIN-MAP.md` §2 / `DEPENDENCY-MAP.md` D-92 引用 `importBoundary.test.ts` | 现有**活着的**边界守卫 = `legacyFreeProductionChain.test.ts`（7）+ `oosValidationBoundary` / `robustnessBoundary` / `walkForwardBoundary`（55） | ✅ **已修正**（同上） |

> 🔴 处置原则（对齐 `AGENT-GUIDE.md` §6）：**发现 drift ⇒ 登记 + 修正基线**；本任务只做「登记 + 新增当前读数」，**未**改写旧报告、**未**触碰代码。
> 下一阶段若要对旧地图做一次统一 drift 修正，应作为**独立任务**执行（建议编号 `CODE-AGENT-INFRA-002`）。

## 12. 参考文档

| 文档 | 作用 |
|---|---|
| `AGENTS.md` | 项目级 Agent 总规则 |
| `docs/architecture/SYSTEM-BASELINE.md` | 上一次全量审计基线（v2.0.0 / 2026-09-20） |
| `docs/architecture/MODULE-MAP.md` | 模块地图（本任务新增） |
| `docs/architecture/LEGACY-MAP.md` | legacy 路径地图（本任务新增） |
| `docs/architecture/AGENT-GUIDE.md` | Agent 作业规范 |
| `docs/architecture/DEPENDENCY-MAP.md` | 依赖图（Domain → Domain） |
| `docs/architecture/DATABASE-MAP.md` | 数据库域地图 |
| `docs/architecture/EXECUTION-FLOW.md` | 执行流 |
| `docs/INDEX.md` | 文档唯一入口 |