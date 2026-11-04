# DATASET-002 FINAL AUDIT REPORT

> **Dataset 全量产品化审计（STEP DATASET-002 · 仅审计，不改代码）**
> 状态：**READY_FOR_IMPLEMENTATION** ｜ 日期：2026-09-10 ｜ 范围：`stock-limit-up-analyzer`
> 唯一交付物：本报告。所有结论来自真实代码静态搜索、TypeScript import 图、router 注册、前端路由、migration 与真实 TiDB 只读查询，无 mock、无推测。

---

## A. Executive Summary

对项目做全量静态 + 真实 DB 审计后，核心结论一句话：

> **项目里并存着两套语义不同、互不连通的「Dataset」架构——一套是「内容指纹快照 panel」（旧，STEP 12.6，仍在生产使用），一套是「Dataset Registry + 独立物理表」（新，STEP DATASET-001，已完成但无任何消费方）。二者在 `first_limit_pullback` 这个领域上语义重叠，形成重复事实来源（DUPLICATED_SOURCE_OF_TRUTH），是 DATASET-002 必须解决的核心问题。**

具体五条：

1. **新架构已 READY 但「无消费方」**：`server/datasetRegistry/`（DATASET-001）已完成领域层 + DB + 构建 CLI + 数据质量，真实 TiDB 已有 1 定义 / 3 版本 / 5 作业 / 237,128 行（v2，2024 全年）。但它**没有 tRPC router、没有前端页面、没有 Research Engine 接入**——三张 `ds_first_limit_pullback_*` 表目前是「写进去但没人读」的状态。

2. **旧架构仍全链路活跃**：`server/researchDataset/`（STEP 12.6）有完整的 Router（`researchDatasetRouter`）、前端（`DatasetBuilder.tsx`）、Research Engine 接入（`research/datasetAccess/` → `signalEngine`），真实 TiDB `research_datasets` 表有 7 条记录、`research_runs` 2 条全部绑定 datasetId。它不是死代码。

3. **两个「DatasetVersion」概念互斥**：
   - 旧的 `datasetVersion` = **内容指纹**（`rd-1.0.0-1-<sha256>`，content-addressed，内容即版本）。
   - 新的 `version` = **逻辑版本字符串**（`"smoke"`/`"v1"`/`"v2"`，`(datasetId, version)` 唯一，带 DRAFT→BUILDING→READY→FAILED 生命周期）。
   两者都是各自层的「唯一事实来源」，但语义完全不同，已在 DB 中真实并存。

4. **`first_limit_pullback` 逻辑有两份实现**：旧 `researchDataset/pullback.ts` + `tDayFilter.ts`（universeFilter 窄化，宽行 panel 上跑）与新 `datasetRegistry/detection.ts` + `path.ts`（事件物理表构建）。两者都复用 `server/data/boardRules`（涨跌停权威），但数据粒度不同（宽行 panel vs event 事件），非简单重复。

5. **最终判定：READY_FOR_IMPLEMENTATION**。没有「未知关键依赖」阻塞——所有调用关系、重复来源、删除边界都有证据支撑。但实施不能「一刀切删旧代码」，必须按 §O 的低风险→高风险顺序迁移。

---

## B. Current Dataset Architecture

当前实际存在两条平行链（无桥接）：

```
【旧 · STEP 12.6 Research Dataset（宽行 PIT panel，内容指纹）】
  researchDatasetRouter (tRPC: researchDataset.*)
     └─ buildResearchDataset()            server/researchDataset/builder.ts
           ├─ universe.ts   (STEP 11 PIT asOf 决议)
           ├─ assemble.ts   (宽行 (tradeDate, securityId) 装配)
           ├─ tDayFilter.ts / pullback.ts (firstBoard + 回踩 窄化)
           ├─ policy.ts / policyValidate.ts (9 类口径)
           └─ version.ts    (内容指纹 datasetVersion)
     └─ persistResearchDataset() → research_datasets 表 (JSON blob + 指纹)
     └─ Research Engine 消费：research/datasetAccess/ → createDatasetSession → signalEngine/engine.ts

【新 · STEP DATASET-001 Dataset Registry（事件物理表，逻辑版本）】
  (无 router / 无前端)
  runDataset001Build.mts (CLI)
     └─ DatasetRegistryService (dataset_definition / dataset_version / dataset_build_job)
           └─ FirstLimitPullbackDatasetBuilder
                 ├─ detection.ts (首板事件检测, 复用 boardRules + PIT ST)
                 ├─ path.ts      (path/outcome 计算)
                 └─ DbDatasetBuildIO → ds_first_limit_pullback_{event,path,outcome}
```

关键事实：**两条链共享底层公共数据**（`stock_daily_prices` / `research_security_identifier_history` / `research_security_status_history` / `industry_assignments` / `liquidity_daily` / `index_daily` / `boardRules`），但在「Dataset」这一层分道扬镳，各自为政。

---

## C. Dataset Asset Inventory

> 分类口径：`NEW`（DATASET-001 新架构）/ `LEGACY`（STEP 12.6 旧架构）/ `SHARED`（两边共用）/ `COMPATIBILITY`（需保留适配）/ `DEAD`（零引用，可删）/ `UNKNOWN`（证据不足）。**均依据实际 import / router 注册 / 前端路由 / DB 查询判定，非文件名判定。**

### C.1 新 Dataset Registry（`server/datasetRegistry/`）

| 文件 | 类型 | 新/旧 | 职责 | 调用方 | 仍使用 | 建议 |
|---|---|---|---|---|---|---|
| `naming.ts` | 纯函数 | NEW | 物理表命名规范 `ds_{code}_{role}` + 校验 | registry.ts / db.ts / 测试 | YES | KEEP |
| `types.ts` | 类型 | NEW | definition/version/job/event/path/outcome 领域类型 | 全模块 | YES | KEEP |
| `registry.ts` | domain+service | NEW | Repository 契约 + InMemory + DatasetRegistryService | db.ts / runDataset001Build.mts | YES | KEEP |
| `detection.ts` | 纯函数 | NEW | 首板事件检测（复用 boardRules + PIT ST） | builder.ts / db.ts | YES | KEEP |
| `path.ts` | 纯函数 | NEW | path/outcome 计算 | builder.ts | YES | KEEP |
| `builder.ts` | 编排 | NEW | FirstLimitPullbackDatasetBuilder（chunk/cursor/batch/checkpoint） | runDataset001Build.mts | YES | KEEP |
| `db.ts` | 持久化 | NEW | DbDatasetRegistry + DbDatasetBuildIO（真实 TiDB） | runDataset001Build.mts | YES | KEEP |
| `index.ts` | 出口 | NEW | 统一 re-export | runDataset001Build.mts | YES | KEEP |
| `naming/registry/detection/path/builder.test.ts` | 测试 | NEW | 33 用例（DATASET-001 报告） | vitest | YES | KEEP |

**结论**：新 Registry 模块自洽、无重复、测试齐备，唯一缺口是**缺 router / 缺前端 / 缺 Research 消费**（见 §G/§H/§I）。

### C.2 旧 Research Dataset（`server/researchDataset/`，30 文件）

| 文件 | 类型 | 新/旧 | 职责 | 调用方 | 仍使用 | 建议 |
|---|---|---|---|---|---|---|
| `types.ts` | 类型 | LEGACY | ResearchDataset 宽行/请求/universe/filter/policy/snapshot/gate | 全模块 + datasetAccess | YES | KEEP（短期） |
| `validate.ts` | 纯函数 | LEGACY | 请求规范化 + universeFilter 校验 | builder.ts | YES | KEEP |
| `version.ts` | 纯函数 | LEGACY | 内容指纹 datasetVersion（SHA-256） | builder/persist/versionSnapshot | YES | KEEP |
| `universe.ts` | 纯函数 | LEGACY | 逐日 universe 决议（STEP 11 PIT） | builder.ts | YES | KEEP |
| `tDayFilter.ts` | 纯函数 | LEGACY | T 日条件（首板/连板）窄化 | builder.ts | YES | MIGRATE（与 detection.ts 收敛） |
| `pullback.ts` | 纯函数 | LEGACY | 首板回踩「触及且不破」筛选 | builder.ts | YES | MIGRATE（算法可复用，见 §E） |
| `assemble.ts` | 纯函数 | LEGACY | 宽行 (tradeDate,securityId) 装配 | builder.ts | YES | KEEP |
| `db.ts` | 持久化 | LEGACY | universe 级 DB 批量加载 | builder.ts | YES | KEEP |
| `builder.ts` | 编排 | LEGACY | buildResearchDataset 主流程 | researchDatasetRouter / scripts | YES | KEEP |
| `policy.ts` / `policyValidate.ts` | 纯函数 | LEGACY | 9 类口径 + 一致性校验 | builder | YES | KEEP |
| `versionSnapshot.ts` | 纯函数 | LEGACY | 版本快照产物 + 指纹 | persist.ts | YES | KEEP |
| `persist.ts` | 持久化 | LEGACY | 落库 research_datasets（幂等） | researchDatasetRouter.certify | YES | KEEP |
| `certify.ts` / `capability.ts` / `preview.ts` | service | LEGACY | 认证 / 能力矩阵 / 预览 | researchDatasetRouter | YES | KEEP |
| `partitionedBuilder.ts` / `buildKey.ts` / `rowsTable.ts` | 构建 | LEGACY | 分片构建 + `rd_rows_<buildKey>` 行表 | buildDatasetPartitioned.mts | YES | KEEP |
| 9 个 `*.test.ts` | 测试 | LEGACY | assemble/capability/certify/partitioned/policy/pullback/tDayFilter/validate/version | vitest | YES | KEEP |

### C.3 Shared 层与契约

| 文件 | 类型 | 新/旧 | 职责 | 建议 |
|---|---|---|---|---|
| `shared/researchContracts.ts` | 契约 | SHARED | 前后端 tRPC 契约（build/preview/certify/list/strategy/metrics） | KEEP（DATASET-002 需扩展新 Registry 契约） |
| `server/data/boardRules.ts` | 纯函数 | SHARED | 涨跌停比例权威（10%/5%/20%/30%） | KEEP（唯一事实来源，两套 Dataset 都复用） |
| `server/security/tradingCalendar.ts` | 纯函数 | SHARED | 交易日历 `addTradingDays` | KEEP |
| `server/securityStatus/timeline.ts` | 纯函数 | SHARED | PIT ST 决议 | KEEP |

### C.4 Scripts（CLI）

| 文件 | 新/旧 | 职责 | 仍使用 | 建议 |
|---|---|---|---|---|
| `runDataset001Build.mts` | NEW | 新 Registry 构建 CLI（--from/--to/--version/--resume/--list） | YES | KEEP |
| `verifyDataset001.mjs` | NEW | 新表数据质量（真实 DB，只读） | YES | KEEP |
| `applyDatasetRegistry.mjs` | NEW | 应用 migration 0028（幂等） | YES | KEEP |
| `runStep126BuildDataset.mts` | LEGACY | 旧构建 + persist | YES | KEEP |
| `runResearchDatasetE2E.mts` | LEGACY | 旧 E2E（build + bind + signalEngine） | YES | KEEP |
| `buildDatasetPartitioned.mts` | LEGACY | 旧分片构建 | YES | KEEP |
| `verifyDatasetConsistency.mts` | LEGACY | 旧一致性比对 | YES | KEEP |
| `verifyFirstBoardPullback.mts` | LEGACY | 旧首板回踩校验 | YES | KEEP |

> 注：根目录大量 `_*.mjs/_*.mts/_*.py` 探针文件（`_probe`/`_curve`/`_inprobe` 等）属一次性调试遗留，与 Dataset 无直接关系，本轮不纳入删除清单（见 §K 边界说明）。

---

## D. New Dataset Registry Audit

### D.1 组成完整性（对比任务 §7 预期）

| 预期文件 | 实际 | 状态 |
|---|---|---|
| naming.ts | ✅ 存在 | 命名规范 + `isValid/validate/build/assertBuild/parse/buildDatasetTableNames` |
| types.ts | ✅ 存在 | 全实体类型 |
| registry.ts | ✅ 存在 | Repository 契约 + InMemory + Service |
| detection.ts | ✅ 存在 | 首板检测 |
| path.ts | ✅ 存在 | path/outcome |
| builder.ts | ✅ 存在 | FirstLimitPullbackDatasetBuilder |
| db.ts | ✅ 存在 | DbDatasetRegistry + DbDatasetBuildIO |
| index.ts | ✅ 存在（额外） | 统一出口 |

### D.2 Definition 能力（§7.1）

- `createDefinition`（强制命名校验 + 表名显式落库）✅
- `getDefinitionByCode` / `getDefinitionById` ✅
- `listDefinitions` ✅
- **`update` 能力缺失**：`DatasetRegistryRepository.saveDefinition` 有 upsert 语义（存在则 update），但 `DatasetRegistryService` 没有暴露 `updateDefinition` 方法；status 支持 `ACTIVE`/`ARCHIVED` 但无 archive/unarchive 服务方法。**缺口：Definition 的 update/archive 未暴露为服务能力。**

### D.3 Version 能力（§7.2）

- `createVersion`（`(datasetId, version)` 唯一）✅
- `getVersion` / `getVersionById` / `listVersions` ✅
- 状态机 `DRAFT → BUILDING → READY / FAILED`：`markBuilding` / `markReady` / `markFailed` ✅
- **状态机缺口**：无 `CANCELLED` 转换（`DatasetBuildJob` 枚举有 `CANCELLED`，但 Version 状态机无取消路径）；无 `DRAFT` 显式重置/回退；无状态迁移合法性校验（如 BUILDING 直接 markReady 之外的非法路径无守卫）。

### D.4 Build Job 能力（§7.3）

- `startJob` / `updateJobProgress` / `completeJob` / `failJob` ✅
- checkpoint 落库（`lastCursor` 序列化 `DatasetBuildCheckpoint`）✅
- resume（`runDataset001Build.mts --resume=<jobId>` 从 `lastCursor` 反序列化）✅
- **缺口**：`CANCELLED` 状态在类型中定义了，但无 `cancelJob` 服务方法 / 无 CLI 取消入口；`PENDING` 状态存在但 `startJob` 直接置 `RUNNING`，无 PENDING→RUNNING 的独立阶段编排。

### D.5 结论

新 Registry **领域层 + DB 层 + 构建层完整且真实可用**（真实 TiDB 237,128 行验证），**缺的是「产品化接口层」**：无 router、无前端、无 Research 消费、Definition 无 update/archive、Version 无取消/状态机校验、Build Job 无取消。这些正是 DATASET-002 的实施目标。

---

## E. Legacy Dataset Audit

### E.1 现状

`server/researchDataset/`（STEP 12.6 C-12.6.1）是**当前唯一在生产链路中活跃的 Dataset 层**：

- **Router**：`researchDatasetRouter`（`build` / `capabilities` / `preview` / `certify` / `list`）已注册进 `appRouter.researchDataset`（`server/routers.ts:258`）。
- **前端**：`client/src/pages/DatasetBuilder.tsx`（路由 `/dataset-builder`，`App.tsx:54`）+ `components/dataset/*` 10 个组件 + `adapters/datasetAdapter.ts` + `buildResultAdapter.ts`。
- **Research 消费**：`server/research/datasetAccess/`（`bindResearchDataset` → `createDatasetSession` → `signalEngine/engine.ts`）。
- **真实 DB**：`research_datasets` 表 7 条记录（`datasetId = DS-rd-1.0.0-1-<sha>`，gate 全 `INCONCLUSIVE`，`rowsTableName` 全 null）；`research_runs` 2 条全绑定 datasetId。

### E.2 旧 `pullback.ts` 究竟属于哪一类（任务 §12）

判定：**C（仍被 Research/Strategy 使用）+ B（算法可复用）+ E（应迁移到新 Registry 语义）三者并存，非 A（完全废弃）。**

证据链：

```
researchDatasetRouter.build/certify
  → buildResearchDataset (builder.ts:173)
    → universeFilter.pullback (builder.ts:228)
      → screenFirstBoardRow (pullback.ts)
        → buildFirstBoardEvent + screenPullback + computeMa5FromFacts
```

- 旧 `pullback.ts` 的「首板」判定复用 `tDayFilter.matchesTDayCondition("firstBoard")`，涨停比例复用 `boardRules`——这与新 `detection.ts` 的首板检测（`classifyLimitDay` + `limitUpRatio`）**口径一致但数据粒度不同**（宽行 panel vs event 表）。
- 它目前**仍被 `buildResearchDataset` 活跃调用**，不可直接删除。
- 迁移方向：DATASET-002.5 时把「首板回踩」的筛选语义统一到新 `detection.ts`/`path.ts` 口径，`pullback.ts` 降级为 `COMPATIBILITY` 适配或最终退役（见 §O）。

### E.3 旧 `universeFilter` 依赖

`universeFilter`（`types.ts` 的 `UniverseFilter`）被以下链路消费：`validate.ts`（校验）→ `universe.ts`（决议）→ `builder.ts`（窄化）→ `pullback.ts`/`tDayFilter.ts`（信号筛选）→ 前端 `datasetAdapter.ts`（表单映射）。**这是旧架构的活跃入口，非死代码。**

---

## F. Database Audit

### F.1 真实 TiDB 状态（本审计实查，只读）

**新表（migration 0028）**：

| 表 | 真实存在 | 关键约束 | 实际数据 |
|---|---|---|---|
| `dataset_definition` | ✅ | `UNIQUE(datasetCode)` | 1 行：`first_limit_pullback` |
| `dataset_version` | ✅ | `UNIQUE(datasetId, version)` | 3 行：`smoke`/`v1`/`v2`（均 READY） |
| `dataset_build_job` | ✅ | `UNIQUE(jobId)` | 5 行（含 2 条遗留 RUNNING 作业） |
| `ds_first_limit_pullback_event` | ✅ | `UNIQUE(datasetVersionId, eventId)` | v2=10,240 行（2024 全年） |
| `ds_first_limit_pullback_path` | ✅ | `UNIQUE(datasetVersionId, eventId, relativeDay)` | v2=206,408 行 |
| `ds_first_limit_pullback_outcome` | ✅ | `UNIQUE(datasetVersionId, eventId, horizon)` | v2=30,720 行（3 horizon） |

**旧表（migration 0024/0025/0027）**：

| 表 | 真实存在 | 实际数据 |
|---|---|---|
| `research_datasets` | ✅ | 7 行（`DS-rd-1.0.0-1-<sha>`，gate 全 INCONCLUSIVE，rowsTableName 全 null） |
| `research_runs` | ✅ | 2 行，dataset 绑定 2 / 未绑定 0（0025 加列生效） |

### F.2 Schema 层 vs SQL 层一致性

- `drizzle/schema.ts` 的 6 张新表定义（`datasetDefinitions`/`datasetVersions`/`datasetBuildJobs`/`firstLimitPullbackEvents/Paths/Outcomes`）与 `0028_dataset_registry.sql` **字段、类型、约束一一对应**。
- 关键类型选择：`id`/`datasetId`/`datasetVersionId`/`totalEvents`/`totalRows`/`processedRows` 均 `bigint(mode: "number")`；价格/成交字段 `double`；`lastCursor`/`universeDefinitionJson`/`filterDefinitionJson` 用 `LONGTEXT`（DATASET-001 已修复 `TEXT` 64KB 撑爆问题）。
- 列名 camelCase、表名 snake_case，与项目既有表一致。

### F.3 语义重叠判定

- `dataset_version`（新）vs `research_datasets`（旧）**语义重叠但不同构**：前者是「逻辑版本元数据行 + 状态机」，后者是「内容指纹快照 + JSON blob」。二者都叫「版本」，但一个是 `(datasetId, "v1")` 唯一，一个是 `DS-<content-sha>` 唯一。
- `ds_first_limit_pullback_*`（新）vs `research_datasets`（旧）**在 `first_limit_pullback` 领域重叠**：旧用 universeFilter 在宽行 panel 上筛首板回踩，新用事件物理表存首板回踩 event/path/outcome。**数据粒度不同，不构成表级重复，但构成「概念级重复事实来源」**（§J）。

---

## G. API / Router Audit

### G.1 结论先行

> **旧 Dataset 有完整 API；新 Dataset Registry 零 API。**

### G.2 旧 Dataset API（`researchDatasetRouter`，tRPC）

| API | method | path | request | response | service | DB 表 | 前端 caller |
|---|---|---|---|---|---|---|---|
| build | mutation | `researchDataset.build` | buildInput | ResearchDatasetSummary（无 rows） | buildResearchDataset | stock_daily_prices 等公共表 | DatasetBuilder.tsx |
| capabilities | query | `researchDataset.capabilities` | — | DatasetCapabilityMatrix | probeCapabilityMatrix | 元数据探测 | DatasetCapabilityPanel |
| preview | mutation | `researchDataset.preview` | buildInput | DatasetPreviewSummary | previewResearchDataset | 元数据 + 内存决议 | DatasetPreviewPanel |
| certify | mutation | `researchDataset.certify` | buildInput+requirements | DatasetCertifyResult | certify+persist | research_datasets | DatasetCertifyPanel |
| list | query | `researchDataset.list` | — | DatasetListEntry[] | listResearchDatasets | research_datasets | （暂无 caller） |

### G.3 新 Dataset API

**无任何 router / API。** `server/routers.ts` 未注册任何 `dataset` / `datasetRegistry` router。新 Registry 只能通过 CLI `runDataset001Build.mts --list` 查看状态。

### G.4 缺失判断

任务 §9 列出的 API 矩阵中，**新架构全部缺失**：

| API 类别 | 旧架构 | 新架构 |
|---|---|---|
| Definition API | ❌ | ❌ |
| Version API | ❌ | ❌ |
| Build API | ✅（certify 隐含） | ❌ |
| Job API | ❌ | ❌ |
| Statistics API | ❌（rowCount 由 build 返回） | ❌ |
| Quality API | ❌（verifyDataset001.mjs 仅 CLI） | ❌（同） |
| Event/Path/Outcome API | ❌ | ❌ |

---

## H. Frontend Audit

### H.1 当前前端架构（React 19 + Vite + tRPC 11 + wouter + shadcn/ui）

- 路由：`client/src/App.tsx`（wouter `<Switch>`），共 18 个 route。
- 布局：`client/src/components/AppShell.tsx`。
- API client：`client/src/lib/trpc.ts` + `server/_core/trpc.ts`。
- 现有 Dataset 页面：`/dataset-builder` → `DatasetBuilder.tsx`（FE-3）。

### H.2 旧 Dataset 页面清单

| 资产 | 位置 | 职责 |
|---|---|---|
| DatasetBuilder.tsx | pages/ | 构建器主页面（配置/预览/认证/结果/能力矩阵） |
| components/dataset/*（10 个） | components/dataset/ | ConfigPanel / PreviewPanel / CertifyPanel / CapabilityPanel / BuildPipeline / BuildSummary / BuildDiagnostics / SourceValidationTable / DetailViews（Snapshot/Policy/Universe）/ index |
| datasetAdapter.ts | adapters/ | 配置表单 ↔ wire 映射 |
| buildResultAdapter.ts | adapters/ | build 结果 → viewModel |

### H.3 可复用公共组件（§10.2）

已存在、**不应重复创建**：`Card/CardContent/CardHeader/CardTitle/CardDescription`、`Tabs`、`Skeleton`、`EmptyState`、`ErrorState`、`TechnicalDetails`、`StatusBadge`（`lib/status.ts`）、`DataTable`（需确认，见下）。构建新 Dataset 页面时直接复用。

### H.4 前端缺口（§10.3，本 STEP 只审计不实现）

新 Dataset Registry 前端**完全缺失**：Dataset List / Dataset Detail / Version List / Build Job Progress / Quality 视图 / Event/Path/Outcome Preview 均无。现有 `DatasetBuilder` 页面对接的是旧 `researchDataset.*` API，**不能直接对接新 Registry**（契约不同）。

### H.5 契约注意点（§14 相关）

- 旧前端经 `shared/researchContracts.ts` 与后端同构（camelCase，`asOfPerTradeDate` 布尔、`rowCount` number），无双写口径漂移风险（有 `server/researchContracts.test.ts` 单测守护生命周期枚举）。
- 新 Registry 若接前端，需在 shared 层新增契约，注意 `bigint` id（`mode:"number"`，前端 JS `number` 安全）与 `double` 价格字段。

---

## I. Dataset → Research Dependency Audit

### I.1 结论

> **Research Engine 当前 100% 依赖旧 `ResearchDataset`（内存宽行 panel），完全不读新 `ds_first_limit_pullback_*` 表。**

### I.2 调用链（实证）

```
signalEngine/engine.ts:139  createDatasetSession(dataset, config)
   └─ datasetAccess/session.ts:40  bindResearchDataset(dataset)      ← dataset 是旧 ResearchDataset 对象
        ├─ handle.ts:159  PIT/排序不变量校验
        ├─ universe.ts:20 createDatasetUniverseProvider → framework.UniverseProvider
        ├─ bars.ts:64     createDatasetDataSource      → framework.ResearchDataSource
        └─ slice.ts       sliceRowsByDateRange
   └─ server/research/index.ts:46  export * from "./datasetAccess"
```

- `bindResearchDataset` 绑定的是 `researchDataset/types.ts` 的 `ResearchDataset`（宽行 panel），**不是** `ds_first_limit_pullback_*` 物理表。
- `runResearchDatasetE2E.mts` 也走 `bindResearchDataset` + `deriveDatasetUniverseId`，验证旧链。

### I.3 目标形态 vs 现状

任务 §15 期望的形态是 `Research → Dataset Access Layer → Dataset Registry → Physical Tables`。**现状是 `Research → Dataset Access Layer → (旧) ResearchDataset 内存对象 → (旧) research_datasets / 公共表`**，新 Registry 的物理表被绕过了。

### I.4 正确接口建议（DATASET-002 目标）

新 Registry 若成为 Research 的「事件/结果」输入，需新增一个 **Event Dataset Access Layer**（读 `ds_first_limit_pullback_event/path/outcome`，按 `datasetVersionId` 过滤），与现有 `datasetAccess`（读宽行 panel）并存或由后者适配——**但两者数据粒度不同，不能简单互换**（宽行 panel 是逐日截面，event 表是事件锚定），需要产品级决策（见 §N）。

---

## J. Duplicate Source-of-Truth Analysis

| 重复项 | 旧事实来源 | 新事实来源 | 判定 |
|---|---|---|---|
| Dataset 定义 | `research_datasets` 行（datasetId 字符串） | `dataset_definition` 行（datasetCode） | DUPLICATED_SOURCE_OF_TRUTH |
| Dataset Version | `research_datasets.datasetVersion`（内容指纹） | `dataset_version.version`（逻辑字符串） | DUPLICATED_SOURCE_OF_TRUTH |
| Dataset 状态 | `research_datasets.gate`（FAIL/PASS/INCONCLUSIVE） | `dataset_version.status`（DRAFT/BUILDING/READY/FAILED） | DUPLICATED（语义不同） |
| 首板检测 | `tDayFilter.ts` + `pullback.ts` | `detection.ts` | DUPLICATED（算法口径一致，数据粒度不同） |
| 回踩/路径 | `pullback.ts`（触及且不破） | `path.ts`（path/outcome） | PARTIAL（旧是信号窄化，新是客观事实，不严格重复） |
| 命名规范 | 无（旧表名任意） | `naming.ts` `ds_{code}_{role}` | 无冲突（新独占） |

**唯一事实来源建议**：
- **「事件/路径/结果」类客观研究数据 → 新 Registry（`ds_*` 物理表）**。
- **「研究输入 PIT panel + 认证 gate + policySet」→ 旧 ResearchDataset（`research_datasets`）**。
- 二者是**上下游关系**而非替代关系：新 Registry 的 event/outcome 未来应作为「特征/结果」注入旧 panel 的宽行（或成为并行输入），而不是「删一个留一个」。DATASET-002 首要任务是**消除「首板/回踩」这一具体领域的重复实现**，明确谁算 event 谁算 signal。

---

## K. Dead Code / Safe Delete Analysis

### SAFE TO DELETE（本轮不建议直接删，列入 DATASET-002.6）

证据：以下无任何 import / API / 前端引用，但**均为一次性调试探针，非 Dataset 核心，本轮为保险起见仅记录**。

- 根目录 `_*.mjs/_*.mts/_*.py` 探针（`_probe`/`_curve`/`_inprobe`/`_joinprobe`/`_tushare_probe*` 等，约 30+ 文件）——零引用、零 import，属调试遗留。**建议 DATASET-002.6 单独清理，不在本轮动。**

### MIGRATE THEN DELETE

- `server/researchDataset/tDayFilter.ts`：仍被 `builder.ts` 使用；其首板语义与新 `detection.ts` 重复 → 先收敛口径，再退役或降为兼容适配。
- `server/researchDataset/pullback.ts`：仍被 `builder.ts` 使用；算法可复用于新 path/outcome 口径 → 迁移后退役。

### KEEP

- `server/datasetRegistry/*`（新，全部）。
- `server/researchDataset/` 除 tDayFilter/pullback 之外的模块（build/version/universe/assemble/policy/persist/certify/capability/preview/partitionedBuilder/rowsTable/buildKey）。
- `server/research/datasetAccess/*`（Research 访问层，活跃）。
- `shared/researchContracts.ts`、`server/data/boardRules.ts`、`tradingCalendar.ts`、`securityStatus/timeline.ts`。

### COMPATIBILITY

- `researchDatasets` 表 + `persist.ts`：旧快照架构仍是 Research Run 的 dataset 绑定来源（`research_runs.datasetId`），迁移完成前必须保留。
- `researchDatasetRouter`：前端 `DatasetBuilder` 仍在用，新前端上线前必须保留。

### UNKNOWN

- 无关键未知项。所有「可删」均有 import 图证据支撑。

---

## L. Compatibility Risk

| 风险 | 影响 | 等级 |
|---|---|---|
| 删除 `researchDatasetRouter` 会破坏前端 `DatasetBuilder.tsx` | 高 | 🔴 先迁移前端 |
| 删除 `researchDataset/pullback.ts`/`tDayFilter.ts` 会破坏 `buildResearchDataset` | 高 | 🔴 先收敛口径 |
| 删除 `research_datasets` 表会破坏 `research_runs.datasetId` 绑定与 `certify` 端点 | 高 | 🔴 需迁移 Research Run 绑定 |
| 新 Registry 缺 API/前端，短中期不影响现有生产（Strategy-002 / Backtest 走旧链） | 低 | 🟢 无回归风险 |
| 新 Registry 无 `feature` 物理表（仅预留表名） | 低 | 🟡 非阻塞 |

**结论**：DATASET-001 已确认「新层完全独立、零破坏既有稳定模块」。DATASET-002 的迁移动作（§O）若严格「先迁移→验证→再删」，不会破坏 Strategy-002 / Backtest / 现有 Research / 现有前端。

---

## M. Performance Risk

- **新 Registry 构建侧已达标**：DATASET-001 基准 2024 全年 237,128 行 / 1381.6s / 171.6 rows/s，全历史（2019–2026）外推 ~2.8h，一次性构建可接受；瓶颈是 TiDB 跨地域 ~0.5s 往返，已用 keyset + 分块 + 批插压到最小。
- **前端风险（任务 §17）**：现有前端 `DatasetBuilder` 走旧 API，`build` 明确**不回传 rows**（只回 rowCount），已规避「237,128 行全量进浏览器」风险。
- **未来风险**：新 Registry 若做 Event/Path/Outcome Preview，**绝不能** `SELECT *` 一次加载全 event/path（path 未来可达千万级）。必须按 `datasetVersionId` + `tradeDate` 范围 + keyset 分页（`idx_ds_flp_path_version_day` / `idx_ds_flp_event_version_date` 索引已就位）。当前新表**无任何读取 API**，所以此风险是「未来实现约束」而非「当前缺陷」。

---

## N. Target Dataset Product Architecture

### N.1 后端目标结构（在现有基础上补齐，不推倒重来）

```
server/datasetRegistry/           # 已有，保留
    naming.ts / types.ts / registry.ts / detection.ts / path.ts / builder.ts / db.ts / index.ts
    + router.ts                   # 【新增】tRPC：definition/version/job/event/path/outcome 只读 + 构建触发
    + quality.ts                  # 【新增】数据质量校验（从 verifyDataset001.mjs 提升为服务）
    + eventAccess.ts              # 【新增】Research 读 event/path/outcome 的访问层（datasetVersionId 过滤 + keyset 分页）

server/researchDataset/           # 旧，短期保留为「PIT panel + 认证」链
server/research/datasetAccess/    # 旧，Research 宽行 panel 访问层，保留
```

### N.2 前端目标结构（新增，复用现有 shadcn 组件）

```
client/src/pages/
    DatasetList.tsx               # 定义 + 版本列表（复用 Card/Tabs/StatusBadge）
    DatasetDetail.tsx             # 单定义详情 + 版本 tab
    DatasetVersion.tsx            # 版本详情（统计 + 状态）
    DatasetBuildJob.tsx           # 构建作业进度（复用 BuildPipeline/BuildSummary）
    DatasetQuality.tsx            # 数据质量（复用 SourceValidationTable）
    DatasetEventPreview.tsx       # Event/Path/Outcome 预览（keyset 分页）
client/src/adapters/
    datasetRegistryAdapter.ts     # 新 Registry 契约适配（新增）
client/src/components/datasetRegistry/  # 复用 dataset/ 现有组件风格
```

### N.3 分界原则（关键决策）

- **事件/路径/结果（客观事实）= 新 Registry（`ds_*`）**。
- **研究输入 PIT panel + gate + policySet（认证口径）= 旧 ResearchDataset（`research_datasets`）**。
- 二者通过「新 eventAccess 把 event/path/outcome 注入宽行 panel 的特征列」建立桥接，而非互相替代。

---

## O. Migration Plan（低风险 → 高风险）

| 阶段 | 内容 | 风险 | 串/并 |
|---|---|---|---|
| **DATASET-002.1** | 旧代码/调用关系审计固化（本报告即此阶段的交付） | 🟢 | 串行（已完成） |
| **DATASET-002.2** | API 契约统一：新增 `datasetRegistry` router + shared 契约；旧 `researchDataset.*` 保持不动 | 🟢 | 可与 002.4 并行 |
| **DATASET-002.3** | Frontend Dataset MVP：DatasetList/Detail/Version（只读，复用组件） | 🟢 | 可与 002.2 并行 |
| **DATASET-002.4** | Version / Build Job / Quality UI + 构建触发（接 runDataset001Build 逻辑为可 API 触发） | 🟡 | 依赖 002.2 |
| **DATASET-002.5** | 旧 Dataset 迁移：收敛 `tDayFilter`/`pullback` 首板回踩口径到 `detection`/`path`；打通 eventAccess → Research | 🟡 | 依赖 002.4 |
| **DATASET-002.6** | 旧 Dataset 清理：tDayFilter/pullback 退役、`researchDatasetRouter` 视前端迁移情况降级 | 🔴 | 依赖 002.5 + 前端迁移完成 |
| **DATASET-002.7** | E2E 验收：新旧链并行回归 + 全历史构建 + 百万级分页压测 | 🔴 | 串行（最后） |

**并行关系**：002.2 与 002.3 可并行；002.4 依赖 002.2；002.5 依赖 002.4；002.6 依赖 002.5；002.7 依赖全部。

---

## P. Recommended Task Breakdown

1. **W1（契约）**：新增 `datasetRegistry` tRPC router（definition list/get、version list/get、job list、event/path/outcome keyset 分页只读），同步 `shared/researchContracts.ts`。
2. **W2（前端 MVP）**：DatasetList + DatasetDetail + DatasetVersion 只读页（复用 Card/Tabs/StatusBadge/DataTable）。
3. **W3（构建接入）**：把 `runDataset001Build.mts` 构建逻辑封装为可 API 触发的 service + job 进度轮询 UI（复用 BuildPipeline/BuildSummary）。
4. **W4（质量接入）**：把 `verifyDataset001.mjs` 提升为 Quality service + UI（复用 SourceValidationTable）。
5. **W5（口径收敛）**：`tDayFilter`/`pullback` 首板回踩口径与 `detection`/`path` 对齐，明确「event=客观事实 vs signal=筛选」边界，消除重复实现。
6. **W6（Research 桥接）**：新增 `eventAccess`，让 Research 能从新 Registry 读 event/path/outcome（或作为宽行特征注入），并定义 datasetVersion 映射。
7. **W7（清理 + 验收）**：退役 `tDayFilter`/`pullback` 重复部分、清理调试探针、新旧链并行回归、百万级分页压测、全历史构建。

---

## Q. Acceptance Criteria（对应任务 §26 的 21 问）

1. Dataset 后端实现：两套——旧 `researchDataset`（活跃）+ 新 `datasetRegistry`（无接口）。✅ 已答
2. 唯一事实来源：事件/路径/结果=新 Registry；PIT panel+认证=旧 ResearchDataset；首板/回踩当前重复。✅ 已答
3. 旧 Dataset 代码：`server/researchDataset/` 30 文件 + router + datasetAccess。✅ 已答
4. 仍在使用：router（build/certify/list）+ 前端 + signalEngine。✅ 已答
5. 可删除：调试探针 +（迁移后）tDayFilter/pullback 重复部分。✅ 已答
6. 必须迁移：tDayFilter/pullback 口径、research_runs 的 dataset 绑定。✅ 已答
7. Dataset API 完整性：旧有 5 端点，新 0 端点。✅ 已答
8. 前端缺口：新 Registry 全部页面缺失。✅ 已答
9. 复用组件：Card/Tabs/StatusBadge/DataTable/BuildPipeline/BuildSummary/SourceValidationTable/TechnicalDetails/EmptyState/ErrorState。✅ 已答
10. Version 前端展示：DatasetVersion 页 + status 状态机 + 统计。✅ 已答（§N.2）
11. Build Job 前端展示：复用 BuildPipeline/BuildSummary + 轮询。✅ 已答（§N.2/W3）
12. Data Quality 前端展示：复用 SourceValidationTable。✅ 已答（§N.2/W4）
13. Research 是否错误依赖旧 Dataset：是——100% 依赖旧宽行 panel，新表被绕过。✅ 已答
14. Dataset→Research 正确接口：eventAccess（datasetVersionId 过滤 + keyset 分页）。✅ 已答（§N.3）
15. 清理是否破坏 Strategy-002：否（Strategy-002 走旧链，新层独立）。✅ 已答
16. 清理是否破坏 Backtest：否（同上）。✅ 已答
17. 百万级前端可用性：必须 keyset 分页 + 索引下推，禁止 SELECT * 全量。✅ 已答（§M）
18. 下一步拆解：见 §P（W1–W7）。✅ 已答
19. 并行任务：W1 与 W2 可并行；W3/W4 可并行（依赖 W1）。✅ 已答
20. 串行任务：W5 → W6 → W7 串行。✅ 已答
21. 最终产品形态：见 §N。✅ 已答

---

## R. Final Status

**READY_FOR_IMPLEMENTATION**

- 审计充分，无关键未知依赖阻塞。
- 核心矛盾已定位并给出唯一事实来源方案（§J/§N.3）。
- 所有「可删/可迁/保留」结论均有 import 图 / router 注册 / 前端路由 / 真实 DB 证据支撑。
- 实施风险集中在「旧代码删除时机」，已用 §O 的低→高风险排序规避。

> 本报告为纯审计交付，未修改任何业务代码、未删除任何旧代码、未改动 migration 0028、未创建 feature 表、未启动 Research Engine 改造。等待 DATASET-002 实施指令。
