# STEP 6.2 Development Report

## 1. Implementation Summary

STEP 6.2 — Experiment Registry + Persistence + Research Run 基础设施已完成，未重构 STEP 6.1 核心 Contract，未提前实现 STEP 6.3+（参数网格 / Walk Forward / OOS / PBO / 组合优化 / 新策略 / 纸面 / 实盘）。

**新增（`server/research/`）**

| 文件 | 职责 |
| --- | --- |
| `run.ts` | `ResearchRun` 模型 + `ResearchRunResultSummary`（复用 `BacktestResult.metadata/config/performance`）+ `generateRunId` + 摘要序列化 |
| `status.ts` | Experiment / Run 受约束状态机（`EXPERIMENT_STATUS_TRANSITIONS` / `RUN_STATUS_TRANSITIONS` + `assert*`） |
| `experimentRegistry.ts` | `ExperimentRegistry`（experimentId → experiment，重复拒绝、get/list 返回克隆） |
| `engineAdapter.ts` | Snapshot → 引擎选项确定性映射 + `runResearchBacktest`（复用 `runStrategyEngineBacktest`）+ `summarizeBacktestResult` + `ResearchDataLoader` |
| `experimentService.ts` | `ExperimentService`：创建（解析参数→注册→持久化）/ 查询 / 冻结 / 受约束状态迁移 |
| `runService.ts` | `ResearchRunService`（Runner）：加载→冻结→resolve 版本→校验→执行生产回测→持久化 run（succeeded/failed）；同步执行 |
| `persistence/contract.ts` | `ExperimentRepository` / `ResearchRunRepository` 接口 |
| `persistence/inMemory.ts` | 内存实现（测试 / 无库默认，结构化克隆隔离） |
| `persistence/db.ts` | DB 实现（复用 `getDb` + drizzle，TiDB/MySQL） |
| `persistence/index.ts` | 出口 |

**修改**

| 文件 | 变更 |
| --- | --- |
| `drizzle/schema.ts` | 新增 `research_experiments` / `research_runs` 两张表 |
| `drizzle/0014_flaky_punisher.sql` | 新迁移（由 `drizzle-kit generate` 生成，含 `experimentId`/`runId` UNIQUE 约束） |
| `drizzle/meta/_journal.json` + `meta/0014_snapshot.json` | 迁移日志 / 快照 |
| `server/research/index.ts` | 追加导出 STEP 6.2 模块 |
| `server/research/registry.ts` | `ResearchStrategyRegistry.get()` 现返回 `structuredClone`（STEP 6.1 审计 P2 已在当前工作树中修复，本次核验未再改动） |

## 2. Architecture

```text
Research Strategy (strategyId@version, STEP 6.1)
       ↓
Experiment Definition (ResearchExperiment, STEP 6.1)
       ↓
Experiment Snapshot (冻结输入, 不依赖当前默认值)
       ↓
Experiment Registry (experimentId → experiment)
       ↓
Persistence (ExperimentRepository / ResearchRunRepository)
       ↓
Research Run (ResearchRunService / Runner, 同步编排)
       ↓
Production Backtest Core (runStrategyEngineBacktest: Feature → Strategy → Risk → Core)
       ↓
Experiment Result (结构化摘要: metadata + config + performance + finalEquity)
```

依赖方向单一：`Research → (Strategy Registry / Persistence / Production Core)`；`Production Core → Research` 反向依赖为零（见 §6 Regression）。

## 3. Database

新增表（沿用既有 drizzle + TiDB/MySQL 基础设施，未引入新 ORM/新库/队列）：

- **`research_experiments`**：`id`（PK）、`experimentId`（UNIQUE）、`strategyId`、`strategyVersion`、`snapshotJson`（longtext，冻结 canonical 快照）、`status`（enum created/running/completed/failed）、`createdAt`、`updatedAt`。
- **`research_runs`**：`id`（PK）、`runId`（UNIQUE）、`experimentId`（索引）、`status`（enum running/succeeded/failed）、`resultJson`（longtext）、`error`（text）、`startedAt`、`finishedAt`、`createdAt`。

Migration：`drizzle/0014_flaky_punisher.sql`。持久化核心是「完整 Snapshot」而非 `strategyId + parameters` 的运行时重读，满足复现要求。

## 4. Tests

新增 19 个测试，全部通过：

- `server/research/experimentPersistence.test.ts`（12）：Persistence create/get/list、Snapshot 不变、Immutability（get 克隆 / 核心字段冻结 / 仅 updateStatus）、Registry register/get/list/duplicate、状态机合法/非法迁移。
- `server/research/researchRun.test.ts`（7）：Run 成功、Failed Run（error+finishedAt 保存、实验 failed）、Multiple Runs（3 个 Run）、Determinism（两次执行核心结果一致）、Production Boundary（生产核心无 research import）、Legacy Simulator Boundary（生产服务不引用 `simulateRealisticTPlus1ToTPlus2`）。

## 5. Validation

- `npm run check`（`tsc --noEmit`）：**exit 0**（干净）。
- `npm run build`：**exit 0**（vite 1,468 kB + esbuild 487 kB）。
- `npm test`（全量）：**589 passed / 15 failed（6 files）**；15 个失败与历史环境基线完全一致（limitUp.customSector、limitUp.watch×4、marketData×4、stockPriceSyncPage×2 缺页面、tushare.secret 缺 token、tushareTradingCalendar×3 网络超时），**无新增回归**。
- STEP 6.2 定向（research 全目录 + strategy/engine/risk）：**206 passed**。

## 6. Regression

| 项 | 结果 |
| --- | --- |
| STEP 5-FIX 关键回归（semantics / downside / overfitting / leaderCandidates / strategyPortfolio / backfill / realisticBacktest / engineNonEquivalence / productionIntegration） | **PASS（100/100）** |
| Legacy Simulator Boundary（`simulateRealisticTPlus1ToTPlus2` 仅 `realisticBacktest.ts` 定义 + `legacyTransactionSimulator.ts` 唯一研究出口，生产服务 0 引用） | **PASS** |
| Production Boundary（engine/strategy/risk 非测试代码无 research import；生产服务不依赖 research persistence） | **PASS** |
| Determinism（同一实验两次 Run 核心结果 `toEqual`） | **PASS** |

## 7. Findings

- **P0**：无。
- **P1**：无。
- **P2**：
  1. `ResearchBacktestConfig`（STEP 6.1 轻量 wrapper）不携带 `stampDutyRate` / `transferFeeRate` / `minCommission`。STEP 6.2 经 Adapter 用固定常量 `DEFAULT_COST_MODEL` 补齐，并将解析后的完整 `BacktestConfig`（含 CostModel）写入 Run 摘要，历史 Run 仍可审计。按 §3「通过 Adapter/Service 层解决」处理，未重构 6.1 契约。
- **P3**：
  1. `featureConfig`（featureMode/featureVersion/requiredFeatures）尚未被 Runner 消费；特征集固定为 `DEFAULT_PRODUCTION_FEATURES`，策略消费由 `parameterSet.featureMode` 驱动（`featureVersion` 依 6.1 约定保持 undefined，延后至 STEP 7 Feature Registry）。
  2. `DbExperimentRepository` / `DbResearchRunRepository` 仅通过 type-check + build 验证，无真实库单测（CI 无 DB）；真实库冒烟延后（同 STEP 6.1 RUNTIME 处理）。
  3. Run 只持久化结构化摘要（不保存全量 trades/equityCurve），如需逐笔重放可在 `resultJson` 扩展。
  4. 本阶段只实现 Service 层，未加 tRPC API（§23 明确 API 非本阶段必要条件）。
  5. `generatedAt` 仍为引擎既有占位 "deterministic"（非 6.2 引入）。

## 8. Scope Check

STEP 6.3 及后续能力是否提前实现：**NO**（无参数网格/随机/贝叶斯搜索、无 Walk Forward / Train-Val-OOS、无 PBO/过拟合检测、无组合优化、无新策略、无 Paper/Live Trading）。

## 9. Final Status

STEP 6.2：**COMPLETE**

是否可以进入 STEP 6.2 Independent Audit：**YES**
