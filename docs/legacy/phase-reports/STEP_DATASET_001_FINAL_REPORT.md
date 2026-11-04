# STEP DATASET-001 FINAL REPORT

> **Dataset Registry + 独立物理表架构 + 全局命名规范**
> 状态：**READY** ｜ 日期：2026-09-10 ｜ 范围：`stock-limit-up-analyzer` 量化系统
> 交付物：本报告（唯一交付物，含 A–M 节 + 最终状态）

---

## A. 概述与结论

按 STEP DATASET-001 规格，将「数据集功能」从既有「内容指纹快照」架构（`research_datasets`，migration 0024）重构为 **Dataset Registry + 独立物理表 + 全局命名规范** 三层架构，并在真实 TiDB/MySQL 上完成落地、基准与数据质量校验。

**最终状态：READY（全链路真实 DB 验证，无 mock）。**

| 维度 | 结果 |
|---|---|
| 数据库落地 | 6 张新表 + 6 个唯一约束已在真实 TiDB 建表并验证 |
| 命名规范 | `ds_{dataset_code}_{role}` 全局规范 + 校验/派生纯函数 |
| 自动化测试 | **33/33 通过**（命名 6 / 检测 9 / path 7 / registry 6 / builder 5） |
| 类型检查 | `tsc --noEmit` exit 0 |
| 真实构建 | 全量 2024 年：**10,240 事件 / 206,408 路径 / 30,720 结果 / 237,128 行** |
| 性能基准 | **1381.6s（≈23min）/ 171.6 rows/s / 7.4 events/s** |
| 数据质量 | 唯一性 / 版本隔离 / 交易日历 / 反策略绑定 / 涨停价 sanity **全 PASS** |
| 兼容性 | 既有 `research_datasets` 快照架构与稳定模块**零破坏** |

---

## B. 现有实现审计（重构前）

审计确认（§50 前置「先审计、后改动」）：

1. **`research_datasets`（migration 0024）** 是「内容指纹快照」架构——JSON blob + 内容寻址 `datasetVersion`，**不是** Registry + 独立物理表，无 `dataset_definition / dataset_version / dataset_build_job` 三实体，无命名规范。
2. **`first_limit_pullback`** 此前仅是一个扁平 panel 上的过滤器（`server/researchDataset/pullback.ts`，§47 DATASET-003 落地为 universeFilter 条件），**不是**独立物理表。
3. 可复用资产确认：`server/data/boardRules.ts`（涨跌停比例权威：主板 10%/ST 5%、创业板/科创板 20%、北交所 30%）、`server/security/tradingCalendar.ts`（`addTradingDays`）、`server/securityStatus/timeline.ts`（PIT ST 决议）、`server/backtest/dbBarStore.ts`（bar 映射）、keyset 分页与 checkpoint 模式。

**结论**：新架构作为新层落地（`server/datasetRegistry/`），既有稳定模块保持不动（§49 兼容优先）。

---

## C. 架构设计

```
Raw Data → Common Data (stock_daily_prices 等)
        → Dataset Registry (dataset_definition / dataset_version / dataset_build_job)
        → Dataset Physical Tables (ds_{code}_{role})
        → Strategy / Backtest
```

核心决策（严格遵循规格）：

1. **一个逻辑 Dataset = 一组固定物理表**；多个 Version 通过 `datasetVersionId` 隔离——**禁止**「一个 Version 一套物理表」（禁止 `ds_xxx_v1_event`）。
2. **Version 是逻辑版本**（`dataset_version` 行），绝不创建独立物理表。
3. **物理表名显式落库**（`eventTableName/pathTableName/outcomeTableName` 存于定义行），不运行时猜名。
4. **不复制公共 OHLCV**：Dataset 通过 `symbol + tradeDate` 引用 `stock_daily_prices`。
5. **不绑定 Strategy**：event/path/outcome 只描述客观市场事实，无 `buy_signal/stop_loss/position_size/strategy_id` 等字段。

---

## D. 数据库 Schema（Migration 0028）

`drizzle/0028_dataset_registry.sql` 定义 6 张表（camelCase 列、snake_case 表、`bigint` PK、软引用无 FK）：

| 表 | 职责 | 关键约束 |
|---|---|---|
| `dataset_definition` | 逻辑 Dataset 定义 | `UNIQUE(datasetCode)`；显式存 4 个 role 表名 |
| `dataset_version` | 逻辑版本（非物理表） | `UNIQUE(datasetId, version)` |
| `dataset_build_job` | 构建作业 + checkpoint/resume | `UNIQUE(jobId)`；`lastCursor` LONGTEXT |
| `ds_first_limit_pullback_event` | 首板事件（一行=一股一日一次首板） | `UNIQUE(datasetVersionId, eventId)` |
| `ds_first_limit_pullback_path` | 路径（一行=事件×相对交易日） | `UNIQUE(datasetVersionId, eventId, relativeDay)` |
| `ds_first_limit_pullback_outcome` | 结果（一行=事件×horizon） | `UNIQUE(datasetVersionId, eventId, horizon)` |

数值列用 `double`（与既有 `index_daily/liquidity_daily` 一致；drizzle `decimal` 返回 `string` 会引发类型错配）。

**真实 DB 落地**：`scripts/applyDatasetRegistry.mjs` 已执行——6 表全建、6 唯一约束全在，`statementsExecuted=17 / errors=0`。

---

## E. 全局命名规范

`server/datasetRegistry/naming.ts` 为唯一权威来源（纯函数）：

- **规范**：`ds_{dataset_code}_{role}`，role ∈ {event, path, outcome, feature}。
- **dataset_code**：lowercase snake_case，**禁止**含 version（`_v1`）、序号/日期（`_001`/`_202609`）、环境（`test/staging/prod`）、UUID。
- 提供：`isValidDatasetCode` / `validateDatasetCode`（统一 `DATASET_CODE_FORBIDDEN` 单一事实来源）/ `buildDatasetTableName` / `assertBuildDatasetTableName` / `parseDatasetTableName` / `buildDatasetTableNames`。

反例（已由测试锁定拒绝）：`ds_first_limit_pullback_v1_event`、`ds_001`、`first_limit_pullback_202609`。

---

## F. 领域层实现

`server/datasetRegistry/` 模块（§49 纯语义命名，无 STEP/C-task 编号）：

| 模块 | 职责 |
|---|---|
| `naming.ts` | 命名规范 + 校验/派生 |
| `types.ts` | 领域类型（definition/version/job/event/path/outcome/checkpoint/result） |
| `registry.ts` | `DatasetRegistryRepository` 契约 + `InMemoryDatasetRegistry` + `DatasetRegistryService`（createDefinition 强制命名+表名落库、createVersion 唯一、markBuilding/markReady/markFailed、startJob/updateJobProgress/completeJob/failJob） |
| `detection.ts` | 首板检测（**复用 boardRules** 涨跌停权威 + PIT ST）：`limitUpRatio/isLimitUpClose/computeEventId/classifyLimitDay/boardTypeOf` |
| `path.ts` | path/outcome 构建（相对事件收盘/高点的回踩、量比、突破、horizon 最大/最小收益/最大回撤） |
| `builder.ts` | `DatasetBuilder` 抽象 + `FirstLimitPullbackDatasetBuilder` |
| `db.ts` | `DbDatasetRegistry` + `DbDatasetBuildIO`（真实 TiDB/MySQL） |

---

## G. Builder 实现（chunk / cursor / batch / checkpoint / idempotency）

`FirstLimitPullbackDatasetBuilder` 两阶段：

**Phase 1（events）**：逐交易日 keyset（chunk=整交易日，保证「首板 vs 连板」日级滚动状态正确）→ 纯内存分类（PIT ST + boardRules）→ **批量 IN 富集流动性+行业**（一次查询替代逐事件）→ 批插。

**Phase 2（paths/outcomes）**：按交易日分块（30 交易日/块），块内**一次范围下推** `fetchBarsRange([chunkStart, chunkEnd+horizon])` → 从内存构建 → 批插（batchSize 1000）。

关键性质：

- **Push-down（§23）**：`trade_date = ?` / `trade_date ∈ [a,b]` 走索引，无全表物化+内存过滤。
- **无巨大 OFFSET（§24）**：跨日 keyset 前进，日内 symbol 升序有界拉取。
- **幂等（§28）**：全部插入 `ON DUPLICATE KEY UPDATE`（唯一约束兜底）；Build(v1) 重复执行 0 重复行（已测 §38.7）。
- **Resume（§27）**：checkpoint 落 `dataset_build_job.lastCursor`（含 `prevLimitUp` + `cumulative` 滚动状态，崩溃后精确续跑）。
- **版本隔离（§29）**：所有行带 `datasetVersionId`，v1/v2 物理同表、逻辑隔离。
- **反泄漏（§20/§21）**：event/path 事实只用 D0 及之前；outcome 是研究结果、绝不进 Signal。

---

## H. 真实 DB 落地

1. **Migration 应用**：`node scripts/applyDatasetRegistry.mjs` → 6 表 + 6 唯一约束（幂等，重复运行无副作用）。
2. **构建 CLI**：`npx tsx scripts/runDataset001Build.mts --from=... --to=... --version=v2 --path-horizon=20 --outcome-horizons=5,10,20`（支持 `--resume=<jobId>` / `--list`）。
3. **数据质量 CLI**：`node scripts/verifyDataset001.mjs`。

真实 DB 落地中发现并修复 2 处问题：
- 手写 migration 的注释块未用 `--> statement-breakpoint` 分隔，TiDB 禁 multi-statement → applier 改为「剥注释 + 按分号切分」。
- `lastCursor` 原 `TEXT`（64KB）被增长中的 checkpoint JSON（cumulative 涨停历史）撑爆 `ER_DATA_TOO_LONG` → 改 `LONGTEXT`（与既有 `universeDefinitionJson` 惯例一致）。

---

## I. 性能 Benchmark（真实 TiDB，2024 全年）

| 指标 | 值 |
|---|---|
| 交易日窗口 | 2024-01-02 → 2024-12-31（**242 交易日**） |
| 事件 | **10,240**（首板，约 42 只/日） |
| 路径 | **206,408** |
| 结果 | **30,720**（= 10,240 × 3 horizon） |
| 总行数 | **237,128** |
| 总耗时 | **1381.6s（≈23min）** |
| 吞吐 | **171.6 rows/s，7.4 events/s** |
| Phase 1（events） | ≈803s（~3.3s/日，DB 往返主导） |
| Phase 2（paths/outcomes） | ≈579s（30 日分块，8 次范围下推 + 批插） |

**对比优化前**：naive 逐事件 fetch（smoke 基线）为 4.6 rows/s / 0.6 events/s——批量富集 + 分块范围下推带来 **~37×** 吞吐提升。

**结论**：瓶颈为 TiDB（us-east-1）跨地域单次往返 ~0.5s，非计算；keyset + 分块 + 批插已将往返次数压到最小。全历史（2019–2026，~1800 交易日）外推 ≈ 7.4× ≈ **~2.8 小时**，为一次性构建可接受；如需更快可加连接池并行或本地 MySQL 导入。

---

## J. 数据质量校验（`verifyDataset001.mjs`，真实 DB）

| 校验项 | 结果 |
|---|---|
| event 唯一性（`datasetVersionId,eventId`） | 10,240/10,240，**0 重复** |
| path 唯一性（`+relativeDay`） | 206,408/206,408，**0 重复** |
| outcome 唯一性（`+horizon`） | 30,720/30,720，**0 重复** |
| relativeDay 范围 | [0, 20]（= pathHorizon） |
| horizon 集合 | {5, 10, 20} |
| **交易日历** | 600239.SH@2024-01-05（周五）→ relativeDay=1 = **2024-01-08（周一）**，无自然日跳变 ✓ |
| 版本隔离 | 全库 event 行 10,907 = 去重 (version,eventId) 对 10,907 ✓ |
| 反策略绑定 | 三表无 buy_signal/stop_loss/strategy_id 等列（`strategyBoundColumns=0`） |
| 涨停价 sanity | 10,240/10,240 事件 `close >= limitUpPrice` ✓ |

---

## K. 未来泄漏与合规（PIT / 铁律）

- **relative_day 用交易日历**（`index_daily` 交易日序推进，周五 D0 → 下周一 D+1），已由 §J 实证。
- **PIT ST**：`resolveSt` 走 `research_security_identifier_history` + `research_security_status_history` 的 as-of 决议（`isEffectiveOn` + `isKnowableBy`），不按当前状态回填。
- **首板判定只依赖 D0 close/preClose + 截至 D0 滚动状态**，绝不触碰未来（`classifyLimitDay` 只用 `prevTradingDayLimitUp` + 历史累计）。
- **outcome 边界**：未来结果单独入 outcome 表，Signal/feature 层禁止读取（代码/查询接口层强制）。
- **复用而非重写**：涨跌停比例复用 `boardRules`（主板/ST/创业/科创/北交多档，禁止硬编码 +10%）。

---

## L. 兼容性保障

- 新层完全独立（`server/datasetRegistry/` + migration 0028），**未改动** `research_datasets`、`researchDataset/`、既有 router、既有前端页面。
- `server/db.ts#getDb` 未改（本轮无需）。
- 既有 6 张表命名不与任何现存表冲突（`ds_` 前缀为新增 Data Layer 专属）。
- 目录命名遵守 §49（无 STEP/C-task 编号，纯语义小驼峰）。

---

## M. 测试、状态与后续

### 测试（`npx vitest run server/datasetRegistry`）

| 文件 | 用例数 | 覆盖（§38） |
|---|---|---|
| naming.test.ts | 6 | §38.1 命名规范（含 v1/序号/日期/环境拒绝） |
| registry.test.ts | 6 | §38.2 定义唯一、§38.3 版本（datasetId,version 唯一） |
| detection.test.ts | 9 | §38.5 首板/连板/涨停比例 |
| path.test.ts | 7 | §38.6 path/outcome 计算 |
| builder.test.ts | 5 | §38.4 版本隔离、§38.7 幂等、§38.8 resume、交易日历 |

**合计 33/33 通过**，`tsc --noEmit` 干净。

### 最终状态

- **Dataset Registry + 独立物理表 + 全局命名规范：READY**
- `first_limit_pullback` Dataset（event/path/outcome 三物理表）：READY（真实 2024 全年 10,240 事件）
- 兼容性：既有架构零破坏

### 后续（非本 STEP 范围）

1. 全历史构建（2019–2026）作为正式 Dataset Version（当前 v2=2024 全年为基准证据）。
2. 接入 STEP 13 Research Engine 的 `datasetAccess`（event/path/outcome 作为正式研究输入，替代/并存 universeFilter 快照口径）。
3. 可选性能增强：连接池并行化或本地 MySQL 导入以进一步压缩全历史构建耗时。
4. `feature` role 物理表（当前 event/path/outcome 已落地，feature 表名预留未建表）。

---

*本报告由 STEP DATASET-001 落地过程生成；所有数字来自真实 TiDB/MySQL 实查与真实 CLI 运行输出，无 mock。*
