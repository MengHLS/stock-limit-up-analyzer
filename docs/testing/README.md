<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试资产总览（tests/ 与 docs/testing/ 的唯一索引）

全仓测试文件 **261** 个 ｜ 用例声明 **4028** 个 ｜ 模块 **27** 个
其中：环境依赖（离线必失败）**7** 个 ｜ 已知失效 **1** 个 ｜ 源码文本断言 **19** 个

> 本目录由 `pnpm run docs:tests` 生成，**禁手改**；改测试后重跑即同步。

## 目录约定

`docs/testing/**` **镜像 `tests/**`**：`tests/server/research/foo.test.ts` 的说明在 `docs/testing/server/research/_index.md`。
找不到就按测试文件的目录往下找，目录名一一对应。

## 三条测试命令

| 命令 | 范围 | 什么时候用 |
|---|---|---|
| `pnpm run test:changed` | **只跑与本次改动相关的测试** | 日常开发 / 每个任务收尾（**默认**） |
| `pnpm exec vitest run <文件或目录>` | 指定文件或模块 | 改某个模块时 |
| `pnpm test` | 全量 277 个文件 | 只在大版本验收 / 合并前跑一次 |

🔴 **不要再「任务完成就跑全量」**——全量恒定 **8** 个失败文件（7 环境依赖 + 1 已知失效），恒红，跑它只会让「基线零新增」退化成人工比对。日常请用 `test:changed`。

## 测试分类

### ① 单元测试（默认，离线稳定）
纯函数 / 内存实现 / 假 DB 注入，不依赖外部资源。这是 `pnpm test` 里应当全绿的部分。

### ② 🔌 环境依赖测试（离线**必然失败**，登记为基线）

| 测试文件 | 外部依赖 |
|---|---|
| `tests/server/marketData.test.ts` | 真实 MySQL（`server/db.ts` 的 upsert / 查询） |
| `tests/server/limitUp.test.ts` | 真实 MySQL（自选板块落库 + 日统计） |
| `tests/server/limitUp.watch.test.ts` | 真实 MySQL（`stockWatchlist` 读写） |
| `tests/server/image.uploadAndRecognize.test.ts` | 真实 MySQL + 路由落库 |
| `tests/server/tushare.secret.test.ts` | 真实 Tushare 网络 + `TUSHARE_TOKEN` |
| `tests/server/tushareTradingCalendar.test.ts` | 真实 Tushare 网络（交易日历，5s 超时） |
| `tests/server/dataHealth.test.ts` | 真实证据文件 `docs/researchReadyGate/research_ready_gate.json` |

处置口径（2026-09-19 用户裁定）：**保持现状**，不删除、不改期望、不加 skip；
只在本文档登记，跑全量时把它们从「失败」里剔除后再判「基线零新增」。

### 📌 当前全量基线（核验：2026-09-19 20:36）

`pnpm test` 实测 = **277 文件 → 8 failed / 269 passed**；**4597 用例 → 17 failed / 4580 passed**（耗时 47s）。

失败文件 **8** 个 = 上表 **7** 个环境依赖 + 下表 **1** 个已知失效：

| 测试文件 | 失败原因 |
|---|---|
| `tests/server/research/parameterSearch/parameterSearchEffectiveness.test.ts` | PARAMETER-002 §10(N-05)：期望旧派生器 `parameterSpaceFromDocument.ts` 头注释带 `LEGACY / PREVIEW` 标记，该文件当前没有（HEAD 现状，属 parameterSearch 在研区，本轮未处置） |

🔴 **判据 = 失败文件集合，不是案数**（案数会 ±1 抖动）。
同日把 `tests/server/researchCore/candidates.updateBoundary.test.ts` **移出了失败集**（源码按 RESEARCH-PLANNER-001 给 `RESEARCH_CANDIDATE_IMMUTABLE_FIELDS` 加了 `sourceResearchPlanId`，期望已同步，该文件 15/15 通过）；
同期 parameterSearch 的提交**新增**了上表这条。两件事都要按集合增减来读，不要只看「还是 8」。

### ③ 📄 源码文本断言测试（接线哨兵）

这些文件用 `readFileSync` 读**仓库源码**，再用 `toContain` / `toMatch` 断言字符串，用来守「路由 / 入口 / 端点确实接上了」。
它们**不验证行为**、改个变量名或挪一行就会红。处置口径（同日用户裁定）：**保留**，但集中在本表管理，
改对应源码时优先用 `pnpm run test:changed` 把这一组一起跑掉。

| 测试文件 |
|---|
| `tests/client/src/components/strategy/definitionDraft.test.ts` |
| `tests/client/src/pages/strategyListDetailSplit.test.ts` |
| `tests/client/src/pages/strategyRunResultPersist.test.ts` |
| `tests/server/backfillHighVolume.test.ts` |
| `tests/server/backtestPage.test.ts` |
| `tests/server/dataHealth.test.ts` |
| `tests/server/historicalState/codeLookup.test.ts` |
| `tests/server/image.uploadAndRecognize.test.ts` |
| `tests/server/leaderCandidatesPage.test.ts` |
| `tests/server/operationLog.test.ts` |
| `tests/server/research/parameterSearch/parameterSearchEffectiveness.test.ts` |
| `tests/server/research/robustness/multiDimension.test.ts` |
| `tests/server/research/walkForward/walkForwardBoundary.test.ts` |
| `tests/server/researchExperiments/exp001FundamentalStudy.test.ts` |
| `tests/server/researchExperiments/exp002StabilityValidation.test.ts` |
| `tests/server/stockDailyPriceUnique.test.ts` |
| `tests/server/stockPriceSyncPage.test.ts` |
| `tests/server/strategy/contract.test.ts` |
| `tests/server/uploadRefreshPage.test.ts` |

## 模块索引

| 模块 | 文档 | 测试文件 | 用例声明 | 环境依赖 | 文本断言 |
|---|---|---|---|---|---|
| `client/src/adapters` | [`client/src/adapters/_index.md`](client/src/adapters/_index.md) | 4 | 98 | - | - |
| `client/src/components` | [`client/src/components/_index.md`](client/src/components/_index.md) | 5 | 84 | - | 1 |
| `client/src/lib` | [`client/src/lib/_index.md`](client/src/lib/_index.md) | 3 | 20 | - | - |
| `client/src/pages` | [`client/src/pages/_index.md`](client/src/pages/_index.md) | 2 | 16 | - | 2 |
| `server` | [`server/_index.md`](server/_index.md) | 55 | 473 | 7 | 9 |
| `server/backfill` | [`server/backfill/_index.md`](server/backfill/_index.md) | 14 | 110 | - | - |
| `server/backtest` | [`server/backtest/_index.md`](server/backtest/_index.md) | 8 | 102 | - | - |
| `server/closedLoopBacktestRun` | [`server/closedLoopBacktestRun/_index.md`](server/closedLoopBacktestRun/_index.md) | 3 | 20 | - | - |
| `server/corporateActions` | [`server/corporateActions/_index.md`](server/corporateActions/_index.md) | 4 | 62 | - | - |
| `server/data` | [`server/data/_index.md`](server/data/_index.md) | 1 | 21 | - | - |
| `server/datasetRegistry` | [`server/datasetRegistry/_index.md`](server/datasetRegistry/_index.md) | 13 | 206 | - | - |
| `server/engine` | [`server/engine/_index.md`](server/engine/_index.md) | 3 | 63 | - | - |
| `server/features` | [`server/features/_index.md`](server/features/_index.md) | 2 | 14 | - | - |
| `server/historicalState` | [`server/historicalState/_index.md`](server/historicalState/_index.md) | 5 | 64 | - | 1 |
| `server/marketData` | [`server/marketData/_index.md`](server/marketData/_index.md) | 9 | 95 | - | - |
| `server/portfolio` | [`server/portfolio/_index.md`](server/portfolio/_index.md) | 1 | 17 | - | - |
| `server/research` | [`server/research/_index.md`](server/research/_index.md) | 51 | 1520 | - | 3 |
| `server/researchDataset` | [`server/researchDataset/_index.md`](server/researchDataset/_index.md) | 9 | 90 | - | - |
| `server/researchExperiments` | [`server/researchExperiments/_index.md`](server/researchExperiments/_index.md) | 29 | 333 | - | 2 |
| `server/risk` | [`server/risk/_index.md`](server/risk/_index.md) | 2 | 50 | - | - |
| `server/riskEngine` | [`server/riskEngine/_index.md`](server/riskEngine/_index.md) | 1 | 18 | - | - |
| `server/runWorkbenchAssembly` | [`server/runWorkbenchAssembly/_index.md`](server/runWorkbenchAssembly/_index.md) | 4 | 33 | - | - |
| `server/security` | [`server/security/_index.md`](server/security/_index.md) | 8 | 123 | - | - |
| `server/securityStatus` | [`server/securityStatus/_index.md`](server/securityStatus/_index.md) | 3 | 40 | - | - |
| `server/strategy` | [`server/strategy/_index.md`](server/strategy/_index.md) | 5 | 54 | - | 1 |
| `server/strategyCore` | [`server/strategyCore/_index.md`](server/strategyCore/_index.md) | 11 | 164 | - | - |
| `shared` | [`shared/_index.md`](shared/_index.md) | 6 | 138 | - | - |

## 布局铁律（改测试前必读）

- **唯一坐标 = 仓库根 `tests/`**，镜像源码结构：`server/<a>/x.test.ts` → `tests/server/<a>/x.test.ts`；`client/src/**` → `tests/client/src/**`；`shared/**` → `tests/shared/**`。
- **禁再往源码目录写新测试**（会立刻破坏布局一致性）；`scripts/**` 仍是脚本验证区、不进 vitest。
- `vitest.config.ts#include` = `tests/**/*.test.ts` + `tests/**/*.test.tsx` + `tests/**/*.spec.ts`。
- 迁移 / 新增测试时必须处理 5 类「位置敏感」写法（相对 import、`import.meta.dirname` 基准、`import.meta.url` 派生基准、裸 `from "."`、`vi.mock` 说明符）；逐条细则见 `.workbuddy/memory/PROJECT_RULES.md` 的「测试文件布局」章。

## 重新生成

```bash
pnpm run docs:tests
```

生成自仓库根目录。本文件只描述 `tests/**` 的现状，不含任何本机路径。
