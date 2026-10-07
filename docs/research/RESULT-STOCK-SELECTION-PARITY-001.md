# RESULT-STOCK-SELECTION-PARITY-001

> 任务：`STOCK-SELECTION-001`（把 151% 那条策略用在选股上 · 第一步）
> 日期：2026-10-06（Asia/Shanghai）
> 结论：**PASS** —— 按决策日选股与全史参考实现**逐位一致**（6/6 抽样日），单日耗时 **0.7–2.5s**
> 目标策略：`first-limit-pullback-3f-top3-runner-t74@2.0.0`（StrategyVersion `3600005`，dataset v8 / `780001`，Full `151.0958%`）

---

## 1. Task

用户要求：把收益最高（**151.0958%**）的那条策略用在**选股**上，并明确 ① 要**新开一个页面**且该页面**兼容不同策略**。

本次只交付「第一步」：**按决策日的选股器 + 真实历史 parity**。不建策略版本、不改策略语义、不改 DB、不接执行链。

## 2. Baseline Version

- 开工前实查 `git status --porcelain`：**121** 条工作区改动（含并发会话未提交改动）⇒ 审计对象是 **当前 working tree**。
- 分支：`codex/pool-reentry-diagnostics`；HEAD `7372387`。
- 架构基线：`docs/architecture/SYSTEM-BASELINE.md`（并发会话持有，本任务未覆盖）。

## 3. Relevant Domains

- **Dataset Registry**：`ds_first_limit_pullback_event` / `_prefix` / `_post`（只读；`datasetVersionId=780001`）。
- **Research / Strategy 语义**：`server/research/compositeRunner/index.ts`（`buildCompositeEvents` / `buildCompositeSourceRun` / `buildFirstLimitPullback3FTop3SourceRun`，**唯一权威选股实现**）。
- **组装**：`server/runWorkbenchAssembly/datasetFromRegistry.ts#buildWindowRows`（事件窗行投影，**唯一权威**）、`datasetIdentityProvider.ts#resolveSecurityIdsByEvent`（身份，**唯一权威**）。
- **新增**：`server/stockSelection/**`（消费方；不注册执行路径）。

## 4. Pre-existing Facts（实查）

| 事实 | 读数 |
|---|---|
| 目标策略留档 | `closed_loop_backtest_run` id `6210006`（`eval-3600005-promoted-t74`），Full `151.0958341843399%` / MaxDD `43.3029%` / 1434 笔 / Runner 触发 161 |
| 参考侧工件 | `.cache/research-dataset-3f-top3-v5-660001.jsonl.gz`（77MB，1,240,693 行 / 1,875 交易日；生成于 2026-09-28，由一次性脚本产出） |
| 全市场行情新鲜度 | `stock_daily_prices` 全量只到 **2026-09-04**（之后 418~504 行/日）；`liquidity_daily` 到 2026-09-04；事件表到 2026-09-04 |
| 现有前向模块 | `server/paperTrading3fTop3Runner/**` **硬编码** `3570001 / hold20 / 750001 / extendToHoldingDays=20` |
| 导航 | `client/src/components/AppShell.tsx` 无「选股」入口（当前 6 组：数据 / 观察 / 研究 / 策略 / 验证 / 前向与复盘） |

## 5. Changes

**新增（5 文件 + 1 测试 + 本报告）**

| 文件 | 作用 |
|---|---|
| `server/stockSelection/types.ts` | 策略无关契约：`StockSelectionRequest/Strategy/Pick/DailyStockSelection` + 闭集错误码（`StockSelectionError`） |
| `server/stockSelection/sliceDataset.ts` | 事件窗切片 → `ResearchDataset` **形状适配器**（复用 `normalizeResearchDatasetRequest` + `derivePolicySet`；`gate` 恒 `INCONCLUSIVE`、`datasetVersion` 用 `selection-slice:` 前缀，**刻意不冒充数据集坐标**） |
| `server/stockSelection/strategies/firstLimitPullback3FTopN.ts` | 第一个策略：按决策日取数 + 委托唯一权威实现选股 |
| `server/stockSelection/registry.ts` | 策略注册表（`list()` / `get(id)`）+ 进程内只读一次的 primary 标识缓存 |
| `server/stockSelection/index.ts` | 域入口（barrel） |
| `tests/server/stockSelection/firstLimitPullback3FTopN.test.ts` | 7 例纯内存单测 |

**取数口径（🔴 本任务最重要的工程结论）**

候选事件的权威定义 = **数据集自己的相对日**：`rd=5` 那一行的 `tradeDate` 就是决策日。

```
① 事件表按 (datasetVersionId, tradeDate) 取 30 自然日回退超集
   → 走既有索引 idx_event_version_date，实测 48ms
② loadRawBarsBatch("post", {eventIds, relativeDays:[1..6]})   ← idx_post_event_day
③ 只保留 rd5.tradeDate === 决策日 的事件（这就是"今天决策"的定义，不引外部日历）
④ loadRawBarsBatch("prefix", {candidateEventIds, relativeDays:[0]})  ← rd0；缺行即响亮失败
```

🔴 **反例（已实测，勿重犯）**：直接对 `post` 加 `tradeDate = 决策日` 谓词 ⇒ 退化成该相对日的全范围扫描 —— **91,857ms/次**。改后同上语义 **0.7–2.5s/次**（≈40–130×）。

## 6. Contract Impact

**无。** 未改 `shared/**`、未改 tRPC、未加路由。
（过程中试做过 `server/datasetRegistry/query.ts#RawBarPageQuery.relativeDays` 的可选过滤，因最终取数路径不再需要，**已完全回退**，最终 diff 中不存在该改动。）

## 7. DB Impact

**零 DDL / 零 DML。** 全程只读 SELECT（`ds_*` 事件表 / prefix / post + 研究域标识小表）。未触碰 dataset v8（`780001`）、未建策略版本、未改任何 Run。

## 8. Execution Impact

**无。** 选股域不注册执行路径，不改 simulator / `canonicalMetrics` / Strategy Core。打分 / 过滤 / 排序**全部**委托既有 `buildFirstLimitPullback3FTop3SourceRun`；本地只做「按日取数 → `buildWindowRows` 投影 → 形状适配 → 结果投影」。

## 9. Tests / Verification

| 项 | 结果 |
|---|---|
| **真实库 parity（`STOCK-SELECTION-PARITY-001`）** | **PASS 6 / FAIL 0** |
| 参考侧 | 缓存基线投影 1,240,693 行 / 1,875 日 / **1,862 个有选股结果日** + 同一权威函数 |
| 被测侧 | DB `780001` 按日切片（只读 rd0..6） |
| 抽样决策日 | 2019-01-09 · 2020-04-21 · 2021-07-29 · 2022-11-10 · 2024-02-22 · 2025-06-06 |
| 判据 | Top-3 **面板身份与排序逐个一致** + 分数差 `< 1e-12` ⇒ 全部 true |
| 单日耗时 | 728 / 964 / 1663 / 1849 / 2537 / 1576 ms |
| 单日候选/合格数 | 23/8 · 47/22 · 32/23 · 30/16 · 60/16 · 66/48 |
| 单元测试 | `tests/server/stockSelection/firstLimitPullback3FTopN.test.ts` **7/7 全绿**（切片==参考、剔除统计、空结果、rd0 缺失、日历缺洞、护栏、注册表） |
| 类型检查 | `tsc --noEmit` **0 错** |
| 行尾哨兵 | `node scripts/checkEolDrift.mjs --strict` **0** |

> parity 的 6 个样本全部 `sameSet=true` 且 `sameScores=true`，同时 `candidates` 与 `ranked` 逐日非零 ⇒ 不是「空对空」的假通过。

## 10. Baseline Update

`docs/architecture/CHANGE-AUDIT.md`（`STOCK-SELECTION-001` 条目）。`SYSTEM-BASELINE.md` / `system-manifest.yaml` 头部由并发会话持有，本任务**不覆盖**其内容。

## 11. Remaining Risks

1. **数据新鲜度（硬阻塞，非本任务引入）**：全市场行情/事件只到 `2026-09-04` ⇒ 现在**选不出"今天"的股**。需先恢复行情同步 + 事件增量（新 datasetVersion，不改 v8）。
2. **策略版本未接入**：前向模块仍硬编码 `3570001/hold20`；要服务 `3600005@2.0.0` 需把 `strategyVersionId / datasetVersionId / runnerBridge(74) / runId` 参数化，并**从 DB 读策略文档**（`DbStrategyRepository.getVersion`，勿再代码重建 —— `3600004@1.0.0` 即因此作废）。
3. **切片身份**：`selection-slice:` 前缀 + `gate=INCONCLUSIVE` 是刻意的「非认证产物」标记；若后续有人把它当数据集坐标使用，属误用。
4. **`relativeDay` 反证依赖数据完整**：日历缺洞会**响亮失败**（已在单测钉死），但当日确实无候选时是"如实空结果"——两者在 UI 上必须区分展示。
5. **未做**：只读端点 + 「选股」页面（用户已确认**新开页面**且要**兼容多策略**，注册表已就绪）；收盘后调度。

## 12. Next Step

```
② 前向模块参数化 → 挂 3600005@2.0.0（T74）        ← 可立即做
③ 只读端点（list strategies / select by date）+ 「选股」新页面   ← 可立即做
④ 行情/事件增量 + 收盘后调度                        ← 卡在数据管道
```

---

## 13. 追加交付（同日 · 步骤 ③）

用户确认「新开一个页面 + 兼容不同策略」后，本任务在 parity 之上补齐了 **只读端点 + 新「选股」页面**：

| 层 | 交付 | 文件 |
|---|---|---|
| 端点 | `stockSelection.listStrategies` / `stockSelection.select`（**只读**） | `server/stockSelectionRouter.ts`，注册于 `server/routers.ts` |
| 页面 | `/stock-selection`（导航「② 观察」→「选股」） | `client/src/pages/StockSelection.tsx`，路由见 `client/src/App.tsx`，导航见 `client/src/components/AppShell.tsx` |
| 可扩展 | 策略元数据带 `datasetId` ⇒ 页面据 `datasetRegistry.listVersions` 列版本，**零硬编码** | `server/stockSelection/types.ts` / `registry.ts` |

页面能力：策略 / 数据集版本 / 决策日 / TopN 查询；结果含**本次事实**（`datasetVersionId` 真实坐标 + 数据窗口 + 候选数 + 合格候选数）、选股清单（名次 / 代码 / T0 / 信号日 / 计划买入日 / 3F 分 / 分位）、剔除统计；**空态与失败分开**（无候选 ≠ 缺 rd0 / 日历缺洞）。

追加验证：`tsc --noEmit` 0 错 · `vite build` 成功（3116 modules）· 选股域 + router vitest **13/13**（新增 router 6 例：策略清单 / 透传 / 未知策略 BAD_REQUEST / 域错误 INTERNAL_SERVER_ERROR / 非法决策日拒绝 / appRouter 注册守卫）· `checkEolDrift --strict` 0。

### 仍然缺的两件事（未做）

1. **② 策略版本接入前向模块**：`server/paperTrading3fTop3Runner/**` 仍硬编码 `3570001 / hold20 / 750001 / extendToHoldingDays=20`；要服务 `3600005@2.0.0`（T74）需参数化并**从 DB 读策略文档**。
2. **④ 数据到账 + 调度**：全市场行情与事件表只到 `2026-09-04` ⇒ 页面现在只能查历史决策日，**查不出「今天」**。

---

## 14. 追加交付（同日 · 方案 A 第 1 步：口径 × 载体解耦）

用户指出「选股不该跟数据集挂钩」→ 采纳 **方案 A（双载体）**，本步只做**接缝**：

```
口径（策略，载体无关）: 首板判定 · 观察窗 rd1..5 · 3F 排序 · 次日开盘
载体（数据面）: dataset（冻结快照，研究/回放/对拍） | live（当日原始行情，日常选股）
```

| 变更 | 内容 |
|---|---|
| 新增 | `server/stockSelection/dataSource.ts`（`SelectionDataSource` 端口）· `sources/datasetSource.ts`（原 `ds_*` 取数整体迁入，含护栏） |
| 请求形状 | `StockSelectionRequest` 顶层**去掉** `datasetVersionId` → `source?: { kind, datasetVersionId? }`（数据集只是**载体坐标**，不是选股的前提） |
| 结果形状 | `DailyStockSelection` 增 `source{kind,label}` 与 `datasetVersionId: number | null`（live 载体如实为 null） |
| 策略层 | 只声明口径（`decisionRelativeDay=5` + 需要 rd0..6）；取数交给载体；rd0 不变量收归口径层 |
| 不静默 | 未注册载体 ⇒ `SELECTION_DATA_SOURCE_UNSUPPORTED`（**不回退**到 dataset）；dataset 缺坐标 ⇒ `SELECTION_DATA_SOURCE_COORDINATE_MISSING` |

**行为不变证据**：真实库 parity **仍为 PASS 6 / FAIL 0**，且六日候选/合格数 `23/8 · 47/22 · 32/23 · 30/16 · 60/16 · 66/48` 与重构前**逐日相同**；单测 16/16（新增「live 替身载体 ⇒ 同一份选股结果」证明接缝真实可替换）；`tsc` 0 错；`vite build` 成功；EOL 0。

### 下一步（A 方案第 2、3 步）

1. **第 2 步（页面）**：主表单去掉「数据集版本」，改「数据来源」选择器（默认 `live`，未接入前仍显示 dataset）；研究口径收进高级区。
2. **第 3 步（live 载体）**：抽 `isFirstLimit = 当日涨停 && 上一交易日未涨停` 的按日判定（复用 `isLimitUpClose`，与 `datasetRegistry/builder.ts` 同源）+ 同一 3F 排序；把本报告的对拍脚本升级为 **live ↔ dataset 常规守卫**。
3. **前置**：④ 行情到账（全市场行情仍只到 `2026-09-04`）——否则 live 无数据可读。
