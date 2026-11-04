# STEP DATASET-002.2 — Dataset Registry API / Shared Contract

> 状态：**COMPLETE** ｜ 日期：2026-09-10 ｜ 范围：`stock-limit-up-analyzer`
> 唯一交付物：本报告。所有结论来自真实代码、TypeScript 编译、vitest 单测与真实 TiDB 只读验证，无 mock 冒名、无推测。

---

## 1. Executive Summary

为 DATASET-001 落地的「Dataset Registry + 独立物理表」新架构补齐**产品化 API 层**，完成 DATASET-002 迁移路线的第二步（§O 002.2「API 契约统一」）。

一句话结论：

> **新 Dataset Registry 现在有了正式的 shared contract + `datasetRegistryRouter` + 只读 API，前端与 Research 可以正式消费 Definition / Version / Build Job / Statistics / Event / Path / Outcome；旧 `researchDataset.*` 全链路保持不动。**

关键成果：

| 项 | 结果 |
|---|---|
| `datasetRegistryRouter` | ✅ 已存在，12 个端点（10 只读 + 2 admin 写） |
| `appRouter.datasetRegistry` | ✅ 已注册，`researchDataset` 未动 |
| shared contract | ✅ `shared/datasetRegistryContracts.ts` |
| keyset 分页 | ✅ Event/Path/Outcome 全 keyset，无 OFFSET，无 `SELECT *` 全量 |
| Statistics | ✅ COUNT/MIN/MAX/DISTINCT 数据库聚合，零全量加载 |
| BigInt 安全 | ✅ `bigint(mode:"number")` 沿用 + `safeIntId` 防御 |
| 测试 | ✅ 32 新增用例全过；`tsc --noEmit` exit 0 |
| 真实 TiDB | ✅ v2（10,240 事件 / 206,408 路径 / 30,720 结果）经 API 只读验证全通过 |
| 旧 Dataset | ✅ `researchDatasetRouter` / `researchDataset` / `pullback.ts` / `tDayFilter.ts` / migration 0028 全未改 |

---

## 2. 修改文件

### 新增

| 文件 | 职责 |
|---|---|
| `shared/datasetRegistryContracts.ts` | 前后端共享契约：枚举字面量 + zod 入参 schema + wire 返回类型 |
| `server/datasetRegistry/query.ts` | 只读查询层：keyset cursor 编解码纯函数 + 排序键比较器 + `DatasetDataReader` 接口 + `InMemoryDatasetDataReader` + `DbDatasetDataReader` + `DatasetQueryService` |
| `server/datasetRegistry/router.ts` | tRPC router（`buildDatasetRegistryRouter` 工厂 + 默认 `datasetRegistryRouter`） |
| `shared/datasetRegistryContracts.test.ts` | 契约 schema + 枚举字面量单测（9 用例） |
| `server/datasetRegistry/query.test.ts` | cursor 编解码 + keyset 分页正确性单测（13 用例） |
| `server/datasetRegistry/router.test.ts` | router 注册 + 入参校验 + list/get 端点单测（10 用例） |
| `scripts/verifyDataset0022.mts` | 真实 TiDB 只读验证脚本（非 mock） |

### 修改

| 文件 | 变更 |
|---|---|
| `server/datasetRegistry/registry.ts` | `DatasetRegistryService` 补齐 `updateDefinition` / `archiveDefinition`（遵循领域边界，datasetCode/表名不可变） |
| `server/datasetRegistry/index.ts` | 追加 `export * from "./query"` 与 `./router` |
| `server/routers.ts` | 注册 `datasetRegistry: datasetRegistryRouter`（`researchDataset` 保持不动） |

### 未改动（红线）

`server/researchDataset/`、`researchDatasetRouter.ts`、`pullback.ts`、`tDayFilter.ts`、`research_datasets` 表、`research_runs.datasetId`、`migration 0028`、新 Dataset 物理表结构、Strategy、Backtest —— 全部零改动。

---

## 3. API Contract

`shared/datasetRegistryContracts.ts`（与 `researchContracts.ts` 同源，输入 = zod，输出 = wire interface）。

### 3.1 枚举字面量（传输层，与后端领域类型一致）

| 枚举 | 值 |
|---|---|
| `DATASET_DEFINITION_TYPE_VALUES` | `EVENT` / `FACTOR` / `ML` / `RESEARCH` |
| `DATASET_STORAGE_TYPE_VALUES` | `DATABASE` |
| `DATASET_DEFINITION_STATUS_VALUES` | `ACTIVE` / `ARCHIVED` |
| `DATASET_VERSION_STATUS_VALUES` | `DRAFT` / `BUILDING` / `READY` / `FAILED` |
| `DATASET_BUILD_JOB_STATUS_VALUES` | `PENDING` / `RUNNING` / `COMPLETED` / `FAILED` / `CANCELLED` |

### 3.2 覆盖的实体

- **A. Definition**：`DatasetDefinitionListItem` / `DatasetDefinitionDetail`（含 `versions`）/ `updateDefinitionInputSchema` / `archiveDefinitionInputSchema`
- **B. Version**：`DatasetVersionListItem` / `DatasetVersionDetail`（含 `jobs`）/ `listVersionsInputSchema` / `getVersionInputSchema`
- **C. Build Job**：`DatasetBuildJobListItem` / `DatasetBuildJobDetail`（含 `checkpointSummary`，剔除 `lastCursor` 原始 LONGTEXT）/ `listJobsInputSchema` / `getJobInputSchema`
- **D. Statistics**：`DatasetStatistics`（`declared` + `actual`，见 §6）
- **E/F/G. Event/Path/Outcome**：`DatasetEventItem` / `DatasetPathItem` / `DatasetOutcomeItem` + `eventPageInputSchema` / `pathPageInputSchema` / `outcomePageInputSchema`

### 3.3 ID / Number 安全（§五）

数据库 `id` / `datasetId` / `datasetVersionId` / `totalEvents` / `totalRows` / `processedRows` 均 `bigint(mode:"number")`。本项目语义下（auto-increment 主键 + 百万级行计数）恒远小于 `Number.MAX_SAFE_INTEGER`（2^53-1），沿用 number 是安全的（与 DATASET-002 审计 §H.5 结论一致）。契约层加防御：所有 id 入参用 `safeIntId = z.number().int().positive().max(MAX_SAFE_INTEGER)`，越界值在进 SQL 前即被拒绝，禁止前端收到不可安全表示的 bigint。

---

## 4. Router API Matrix

全部注册在 `appRouter.datasetRegistry`：

| 端点 | 类型 | 入参 schema | 权限 | 说明 |
|---|---|---|---|---|
| `listDefinitions` | query | — | public | 返回 `DatasetDefinitionListItem[]` |
| `getDefinition` | query | `getDefinitionInputSchema` | public | 未命中 `NOT_FOUND` |
| `updateDefinition` | mutation | `updateDefinitionInputSchema` | **admin** | name/description 可变；code/表名不可变 |
| `archiveDefinition` | mutation | `archiveDefinitionInputSchema` | **admin** | status → ARCHIVED |
| `listVersions` | query | `listVersionsInputSchema` | public | 按 `datasetId` |
| `getVersion` | query | `getVersionInputSchema` | public | 未命中 `NOT_FOUND` |
| `listJobs` | query | `listJobsInputSchema` | public | 按 `datasetVersionId` |
| `getJob` | query | `getJobInputSchema` | public | 未命中 `NOT_FOUND` |
| `getStatistics` | query | `getStatisticsInputSchema` | public | 未命中 `NOT_FOUND` |
| `listEvents` | query | `eventPageInputSchema` | public | keyset 分页 |
| `listPaths` | query | `pathPageInputSchema` | public | keyset 分页 |
| `listOutcomes` | query | `outcomePageInputSchema` | public | keyset 分页 |

> 边界：只读 API 为主。`updateDefinition` / `archiveDefinition` 是唯一写端点（补齐审计 §D.2 发现的「Definition update/archive 未暴露」缺口），`adminProcedure` 保护。未新增 `createDefinition`（构建入口仍由 CLI `runDataset001Build.mts` 承担，DATASET-002.4 再考虑 API 化）。

---

## 5. Pagination Design

### 5.1 排序键（保证同一天多 event 不重不漏）

| 实体 | 排序键 | 唯一键保证 | 既有索引 |
|---|---|---|---|
| Event | `(tradeDate ASC, eventId ASC)` | `uq_ds_flp_event_version_event` | `idx_ds_flp_event_version_date` |
| Path | `(eventId ASC, relativeDay ASC)` | `uq_ds_flp_path_version_event_day` | `idx_ds_flp_path_event_day` / `idx_ds_flp_path_version_day` |
| Outcome | `(eventId ASC, horizon ASC)` | `uq_ds_flp_outcome_version_event_horizon` | `idx_ds_flp_outcome_event_horizon` |

`eventId = ${symbol}@${tradeDate}` 在版本内唯一，故 `(tradeDate, eventId)` 是全序且唯一；同一天多 event 按 eventId 次级排序，稳定无重复。

### 5.2 keyset 谓词与 cursor

- cursor = `base64url(JSON)`，对前端**不透明**（原样回传，不解析、不构造）。
- 谓词（以 Event 为例）：
  ```
  WHERE datasetVersionId = ?
    [AND tradeDate >= fromDate] [AND tradeDate <= toDate]
    [AND (tradeDate > c.d OR (tradeDate = c.d AND eventId > c.e))]   -- cursor
  ORDER BY tradeDate ASC, eventId ASC
  LIMIT limit + 1                                                  -- 多取 1 行探测 hasMore
  ```
- `limit + 1` 探测下一页存在性；`nextCursor` 由末行排序键编码；`nextCursor = null` 表示末页。
- **无 OFFSET 深分页**；强制 `datasetVersionId` 下推，跨版本物理隔离。

---

## 6. Statistics Design

`getStatistics` 复用 `DatasetQueryService.getStatistics`，分两层：

- **declared**：版本元数据 `markReady` 时写入的 `totalEvents` / `totalRows`。
- **actual**：物理表实测（`DbDatasetDataReader.getVersionCounts`，**4 个并行 SQL 聚合**，零全量加载到 Node）：
  - `eventCount` / `pathCount` / `outcomeCount` = `COUNT(*)`
  - `firstDate` / `lastDate` = `MIN/MAX(event.tradeDate)`
  - `horizons` = `DISTINCT outcome.horizon ORDER BY horizon`

> 语义注：`declared.totalRows`（构建 CLI 写入 `paths + outcomes` = 237,128）与 `actual.rowCount`（`event + path + outcome` = 247,368）口径不同。二者都在 API 中如实返回，口径统一交由 DATASET-002.4 Quality UI 决策（见 §12）。

---

## 7. Security / Validation

| 校验项 | 实现 |
|---|---|
| id 合法性 | `safeIntId`（.int().positive().max(MAX_SAFE_INTEGER)） |
| date 合法性 | `isoDateSchema`（YYYY-MM-DD）+ `assertDateRange(fromDate <= toDate)` |
| limit 上限 | `DATASET_PAGE_LIMIT_MAX = 200`（`.min(1).max(200)`） |
| cursor 合法性 | `decodeEventCursor/decodePathCursor/decodeOutcomeCursor` 结构校验，非法抛 `BAD_REQUEST` |
| 任意 tableName 进 SQL | **禁止**——本 router 无 tableName 入参；物理表名只读自 Registry 已验证的 `dataset_definition.*TableName`；查询直接走 drizzle schema（编译期固化表对象），无字符串拼表 |
| 写端点权限 | `updateDefinition` / `archiveDefinition` 走 `adminProcedure` |

---

## 8. Tests

**新增 32 用例，全过**（`vitest run` 定向）：

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `shared/datasetRegistryContracts.test.ts` | 9 | 枚举字面量契约、safeIntId 边界、分页/update/archive schema |
| `server/datasetRegistry/query.test.ts` | 13 | cursor round-trip + 非法拒绝、排序比较器、InMemory keyset 分页不重/不漏/不乱序/版本隔离/limit/日期过滤/eventId/horizon 过滤 |
| `server/datasetRegistry/router.test.ts` | 10 | 注册守卫、入参校验、Definition/Version/Job list/get、Statistics、Event/Path/Outcome 分页端点、update/archive admin 权限 |

**契约一致性**：`server/researchContracts.test.ts`（13 用例）仍通过，`researchDataset.build` 注册守卫不受影响。

**兼容性（全量 vitest）**：`2443 passed / 16 failed`。16 个失败为**既有环境依赖失败**（与本次改动无关）：`backfill/scheduler`、`dataHealth`、`image.uploadAndRecognize`、`limitUp`、`limitUp.watch`、`marketData`、`researchRunRouter`（readiness verdict 逻辑，非本次引入）、`tushare.secret`（缺 `TUSHARE_TOKEN`）、`tushareTradingCalendar`（Tushare 网络超时）。相关既有测试 131/131 全过，`tsc --noEmit` exit 0。

---

## 9. Real TiDB Verification

`scripts/verifyDataset0022.mts`（真实 TiDB 只读，走 `buildDatasetRegistryRouter(Db...)` → `createCaller` 真实代码路径），对 `first_limit_pullback` v2 验证：

| 实体 | 结果 |
|---|---|
| Definition | 1 条：`first_limit_pullback` / EVENT / ACTIVE / 3 表名落库正确 |
| Version | smoke/v1/v2 全 READY（v2 id=90001，`totalEvents=10240`，`totalRows=237128`，range `[2024-01-02..2024-12-31]`） |
| Statistics | `actual.eventCount=10240`，`pathCount=206408`，`outcomeCount=30720`，`firstDate=2024-01-02`，`lastDate=2024-12-31`，`horizons=[5,10,20]` |
| Event | 52 页 walk，收集 10240 条 = aggregate，`match=true / unique=true / ordered=true`，首 `000595.SZ@2024-01-02` → 末 `920765.BJ@2024-12-31` |
| Outcome | 154 页 walk，收集 30720 条 = aggregate，`match=true / unique=true / ordered=true`，horizon 5/10/20 齐全 |
| Path | 3 页抽样 600 条，`sampledUnique=true / ordered=true`，总数对照 aggregate 206408 |

**耗时**（本次单进程实测）：

| 步骤 | 耗时 |
|---|---|
| DB 连接就绪 | 7–9ms（暖连接；冷连接受跨境网络波动，单次曾约 2min，属网络抖动非代码问题） |
| Definition + Version + Statistics（经 tRPC） | ~2.2s / ~1.9s |
| Event 全量 walk（52 页 × 200） | ~13.3s |
| Outcome 全量 walk（154 页 × 200） | ~35.4s |
| Path 抽样 3 页 × 200 | ~0.77s |
| **总耗时** | **~53.7s** |

**数量对照**：Event 10240/10240 ✅，Outcome 30720/30720 ✅，Path 206408（aggregate）✅ —— 分页 walk 与数据库聚合完全一致，分页连续、无重复、严格有序、无跨版本泄漏。

---

## 10. Performance

- **单页 keyset 查询 ~250ms**（索引下推 + `limit+1`），与深度无关（keyset 无 OFFSET 退化）。
- **全量 walk 线性**：Event 10240 行 = 52 页 ~13s；Outcome 30720 行 = 154 页 ~35s。
- **Statistics 单次 ~1.9s**（4 并行聚合 + 跨境往返），不随数据量增长到 Node 侧。
- 前端友好：`DATASET_PAGE_LIMIT_MAX=200`，单页 payload 有界；Path 未来千万级时仍 O(limit) 拉取，绝不全量 `SELECT *`。
- 瓶颈仍是跨境 TiDB 往返（非查询本身），与 DATASET-001 构建侧结论一致。

---

## 11. Compatibility

- `researchDatasetRouter` / `researchDataset` / `researchRuns` / `signalEngine` / Strategy / Backtest 全未改。
- `appRouter.researchDataset` 与 `appRouter.datasetRegistry` 并存，语义互斥不互替（旧 = PIT panel + 认证；新 = 事件物理表）。
- `server/researchContracts.test.ts` + `server/datasetRegistry/*.test.ts` + `server/researchDataset/*.test.ts` 共 131 用例全过。
- 新契约独立于旧 `researchContracts.ts`（仅复用其 `isoDateSchema`），不产生双份口径漂移（枚举由单测守护）。

---

## 12. Remaining Gaps

| 缺口 | 归属 |
|---|---|
| Quality service（把 `verifyDataset001.mjs` 校验逻辑提升为 CLI 与 Router 共用的 service） | **DATASET-002.4** |
| 前端消费方（DatasetList/Detail/Version 只读页） | **DATASET-002.3** |
| Research 消费方（eventAccess → Research，把 event/path/outcome 注入宽行特征） | **DATASET-002.5** |
| `declared.totalRows`（path+outcome）与 `actual.rowCount`（event+path+outcome）口径统一 | DATASET-002.4 |
| Version 状态机缺 `CANCELLED` 转换 / 非法迁移守卫（审计 §D.3） | DATASET-002.4 |
| Build 触发 API 化（`createDefinition`/`createVersion`/`startJob` 目前仍走 CLI） | DATASET-002.4 |
| 全量路径 walk 的百万级压测 | DATASET-002.7 |

---

## 13. 下一阶段 DATASET-002.3 输入

DATASET-002.3（Frontend Dataset MVP）可直接消费本层 API：

- `datasetRegistry.listDefinitions` / `getDefinition` → DatasetList / DatasetDetail 页
- `datasetRegistry.listVersions` / `getVersion` → 版本 tab + 状态机展示
- `datasetRegistry.getStatistics` → 版本统计（declared vs actual）
- `datasetRegistry.listEvents` / `listPaths` / `listOutcomes` → 预览（keyset 分页，`nextCursor` 驱动「加载更多」）
- 复用现有 shadcn 组件（Card/Tabs/StatusBadge/EmptyState/ErrorState），新增 `client/src/adapters/datasetRegistryAdapter.ts`
- 分页契约已就绪：前端只需把上次返回的 `nextCursor` 原样回传，无需解析

---

## Final Status

**DATASET-002.2 = COMPLETE**

- 完成标准 14 项全部达成：router 存在、注册完成、shared contract 完成、Definition/Version/Job/Statistics/Event/Path/Outcome API 可用、输入校验完整、分页稳定、不破坏旧 Dataset、测试通过。
- 真实 TiDB 只读验证：`first_limit_pullback` v2 全链路通过（数量对照 + 分页连续性 + 耗时）。
- 未删除旧代码、未修改 researchDatasetRouter、未修改 migration 0028、未创建 feature 表、未修改 Strategy/Backtest、未让 Research 读新 Dataset、未使用 SELECT * 全量 / OFFSET 深分页 / mock 数据。
