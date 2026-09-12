# STEP DATASET-002.3 — Dataset Registry Frontend MVP 实施报告

> 状态：**COMPLETE**（真实 API 已验证）
> 完成时间：2026-09-10 02:35 GMT+8

---

## 1. Executive Summary

DATASET-002.3 已把 DATASET-001 落地的 Dataset Registry（`dataset_definition` / `dataset_version` / `dataset_build_job` + `ds_first_limit_pullback_*` 三物理表）做成**第一版前端可用的 Dataset 管理 UI**，并接通 DATASET-002.2 的真实只读 tRPC API（非 mock）。

交付了 4 个页面、5 个复用组件、1 个 Adapter、1 个 keyset 分页状态机、23 个单测，并用真实 TiDB 数据（`first_limit_pullback` / `v2`）做了端到端验证：**10,240 事件 / 206,408 路径 / 30,720 结果**全部由数据库聚合查询返回，明细预览走 keyset 分页（20/50/100，无 OFFSET、无全量加载）。

旧页面 `/dataset-builder`（Research Dataset 构建器）与旧 `researchDataset.*` API **完全未动**，新页面 `/datasets` 独立共存。

---

## 2. 页面结构

| 页面 | 路径 | 职责 |
|---|---|---|
| Dataset List | `/datasets` | 展示所有 Dataset 定义 + 版本数 / 最新版本 / 最新版本状态 |
| Dataset Detail | `/datasets/:datasetId` | Tabs：Overview / Versions / Jobs / Statistics |
| Version List | `/datasets/:datasetId/versions` | 该 Dataset 的全部逻辑版本 |
| Version Detail | `/datasets/:datasetId/versions/:versionId` | 版本元信息 + 统计 + Build Job + Event/Path/Outcome 预览 |

版本详情页（最核心）结构：
- **Version 概览**：Version / Dataset Version ID / Status / Date Range / Total Events / Total Rows / Created At / Completed At / Build Time / Source-Definition 摘要（featureVersion + sourceVersion）
- **Statistics**：Event / Path / Outcome / Row 计数 + First/Last Date + horizons
- **Build Jobs**：PENDING/RUNNING/COMPLETED/FAILED/CANCELLED + 进度 + checkpoint 技术摘要
- **Preview**：Event / Path / Outcome 三标签，keyset 分页

---

## 3. Route Matrix

采用项目现有 **wouter** 约定（`Route path component` + `useParams`），未引入 react-router：

```tsx
<Route path="/datasets" component={DatasetList} />
<Route path="/datasets/:datasetId" component={DatasetDetail} />
<Route path="/datasets/:datasetId/versions" component={VersionList} />
<Route path="/datasets/:datasetId/versions/:versionId" component={VersionDetail} />
```

导航栏「研究数据」分组新增 **「数据集注册」**（`Layers` 图标 → `/datasets`），与「数据集构建」(`/dataset-builder`) 并列区分，未改名、未删除。

---

## 4. Component Reuse

**直接复用（未重造）**：`Card/CardContent/CardHeader/CardTitle/CardDescription`、`Tabs`、`Skeleton`、`EmptyState`、`ErrorState`、`TechnicalDetails`、`StatusBadge`、`DataTable`、`MetricCard`、`SectionCard`、`Progress`、`Badge`、`Button`。

**新建组件（针对 Registry 语义，非复制公共组件）**：
- `DatasetListTable` — 列表（行级 `listVersions` 聚合版本元信息）
- `VersionListTable` — 版本表
- `BuildJobTable` — 作业表（进度条 + checkpoint 摘要）
- `StatisticsGrid` — 统计卡（复用 `MetricCard`）
- `DatasetPreviewTable` — keyset 分页明细预览

**关于 BuildPipeline / BuildSummary / SourceValidationTable**：这三个组件建模的是旧 researchDataset 的「Source→Universe→Calendar→PIT→各域→Final Dataset」源校验链，其 ViewModel（`buildResultAdapter`）字段（sourceRows / coverageGaps / PIT 口径）在 Dataset Registry 的 chunk/cursor 构建作业模型里**不存在**。强行套用会臆造不存在的「源链节点」，违反项目「不臆造」铁律。因此 Registry 使用聚焦的 `BuildJobTable`（作业进度模型），**不是**对 BuildPipeline 的复制——二者职责不同。`/dataset-builder` 继续原样使用 BuildPipeline/BuildSummary。

---

## 5. API Integration

接入 DATASET-002.2 已挂载的 `datasetRegistry` 只读 router（`server/datasetRegistry/router.ts` + `query.ts` + `shared/datasetRegistryContracts.ts`）：

| 端点 | 前端用途 |
|---|---|
| `listDefinitions` | Dataset List |
| `getDefinition` | Dataset Detail / Version List 头 |
| `listVersions` | 列表行版本元信息 |
| `getVersion` | Version Detail（version + jobs） |
| `listJobs` | Dataset Detail · Jobs 标签 |
| `getStatistics` | Statistics 标签 / Version Detail |
| `listEvents` / `listPaths` / `listOutcomes` | Preview（keyset） |

`updateDefinition` / `archiveDefinition`（admin 写端点）**不在本任务范围**，未在前端使用。

---

## 6. Adapter Design

`client/src/adapters/datasetRegistryAdapter.ts` 统一做 DTO → ViewModel：

- **bigint → number**：后端 schema 已 `bigint(mode:"number")`，契约层 `safeIntId` 防御越界，前端只消费 number；
- **Date → ISO string**：后端 `isoOrNull` 归一，前端 `formatDateTime` 展示；
- **null/undefined 归一**：`?? null` 统一为 null，UI 显示「—」；
- **status enum**：原样透传字符串，颜色由 `@/lib/status`（单一事实来源）映射；
- **进度推导**：`jobToVm` 由 `completedChunks/totalChunks` 推导百分比，COMPLETED 恒 100，信息不足 → null（不臆造）。

ViewModels：`DatasetListRowVm` / `VersionListItemVm` / `BuildJobVm` / `StatisticsVm`。JSX 中无 `as any`、无字段强转。

`@/lib/status.ts` **新增** 6 个状态映射（DRAFT/BUILDING/COMPLETED/CANCELLED/ACTIVE/ARCHIVED）——这是对唯一颜色事实来源的**扩展**，未另建颜色体系、未新建 `NewStatusBadge`。

---

## 7. Pagination

`client/src/lib/datasetPreviewState.ts`：纯函数 keyset 状态机。

- cursor 为**不透明字符串**，前端原样回传（不解析、不构造）；
- 游标栈 `(string|null)[]`：`[null]`=第 1 页；NEXT 压栈、PREV 弹栈、RESET 清栈；
- `table / versionId / limit` 任一变化 → RESET → 回到第 1 页（**杜绝旧版本数据残留**）；
- 后端 keyset：`WHERE datasetVersionId=? AND (tradeDate,eventId) > cursor ORDER BY … LIMIT n+1`，无 OFFSET。

---

## 8. Loading / Error / Empty States

| 状态 | 组件 |
|---|---|
| 加载 | `Skeleton` |
| 错误 | `ErrorState` + `rpcErrorToDiagnostic`（code/title/explanation/suggestions/technical） |
| 空态 | `EmptyState` |
| 非法 URL ID | `ErrorState`（BAD_REQUEST） |

版本状态视觉：DRAFT(灰)/BUILDING(蓝)/READY(绿)/FAILED(红)，统一走 `StatusBadge` → `@/lib/status`，未另定义颜色。

---

## 9. Tests

新增 23 个单测（node 环境纯函数，无 jsdom / 无 @testing-library，与项目既有前端测试范式一致）：

- `datasetRegistryAdapter.test.ts`（15 例）：列表/详情/版本列表/版本详情/作业五态/进度/统计/空态/错误态/格式化
- `datasetPreviewState.test.ts`（8 例）：NEXT/PREV/RESET/版本切换清残留/queryKey 稳定性

对应任务 §15 的 12 类验收点（渲染/状态/分页/版本切换/错误处理）均以逻辑层纯函数覆盖；UI 渲染正确性由 `tsc --noEmit`（exit 0）+ `vite build`（2977 模块，成功）+ 真实 API 探针验证。

运行结果：
- `vitest run client/src/adapters/datasetRegistryAdapter.test.ts client/src/lib/datasetPreviewState.test.ts` → **23 passed**
- `vitest run server/datasetRegistry` → **56 passed**（含 002.2 的 query/router 测试）
- 全量 `vitest run`：2482 例中 16 例失败，**均为既有的 Tushare secret/网络 / DB 依赖 / researchRunRouter 口径**测试，与本次改动无关。

---

## 10. Real API Verification

探针 `scripts/verifyDatasetRegistryRead.mts`（走真实查询层，即 router 实际执行路径）对真实 TiDB 验证通过：

```
[1] listDefinitions: 1 个定义
    - first_limit_pullback (id=1, ACTIVE, EVENT)
[2] getDefinition 版本: smoke(READY), v1(READY), v2(READY)
[3] getStatistics(v2) 实测: eventCount=10240, pathCount=206408,
    outcomeCount=30720, rowCount=247368, firstDate=2024-01-02,
    lastDate=2024-12-31, horizons=[5,10,20]
[4] listEvents page1: 20 行, hasNext=true · page2: 20 行（无重叠、顺序递增）
[5] listPaths page1: 20 行 · listOutcomes page1: 20 行
[6] listJobs(v2): ds001-v2-1788975267064(COMPLETED)
✅ 真实 API 验证全部通过
```

**无 mock**：以上均为真实 DB 聚合/分页结果。

---

## 11. Screenshot / UI Verification

受限于无浏览器自动化环境（未安装 jsdom/playwright），本任务 UI 验证以以下证据替代真实截图：
- `tsc --noEmit` exit 0（类型/导入正确）；
- `vite build` 成功（2977 模块，前端可打包）；
- 真实 API 探针证明数据链路正确，页面渲染的数据源可信。

页面视觉（徽标色、卡片、表格、进度条）复用既有 shadcn/公共组件，与全站一致。

---

## 12. Performance

- 大表（event 10,240 / path 206,408 / outcome 30,720）**绝不进浏览器**：全部 server-side keyset 分页（`LIMIT n+1`），无 `SELECT *`、无 OFFSET；
- 统计（COUNT/MIN/MAX/DISTINCT）由数据库聚合，`getVersionCounts` 单次返回，不加载明细行到 Node；
- 列表版本元信息走行级 `listVersions`（当前 1 个 Dataset / 3 版本，量极小）；为规模化，未来可在 002.2 契约补「列表 + 版本聚合」批量端点；
- tRPC queryKey 与 `(table, versionId, limit, cursor)` 强绑定，版本切换即 RESET，无旧数据残留。

---

## 13. Compatibility

- 旧 `/dataset-builder`（`DatasetBuilder.tsx`）**未删除、未改名、未改业务语义**；
- 旧 `researchDatasetRouter` / `researchDataset.*` **未修改**；
- `Research / Strategy / Backtest` 代码未触碰；
- DB schema / migration 未改动；
- 唯一对既有文件的小幅改动：`App.tsx`（+4 路由）、`AppShell.tsx`（+1 导航项 +1 图标导入）、`@/lib/status.ts`（+6 状态映射，纯增量）。

---

## 14. Remaining Gaps

1. **预览过滤器未接 UI**：契约已支持 `fromDate/toDate/eventId/horizon`，本任务只实现基础分页（未暴露过滤控件）。
2. **列表 N+1**：版本元信息走行级 `listVersions`；量级大时需 002.2 补批量端点。
3. **BuildPipeline/BuildSummary 未复用**：模型不同（见 §4），已在报告中说明理由。
4. **无真实浏览器截图**：受环境限制，UI 验证以 tsc/vite build/真实 API 探针替代。
5. **写端点（update/archive）未接入前端**：属 002.2 admin 能力，不在 002.3 范围。
6. **Research 集成未做**（任务明确排除）：本任务不实现 Research eventAccess、不迁移 pullback/tDayFilter。

---

## 15. 下一阶段 DATASET-002.4 输入

建议 DATASET-002.4 覆盖：
1. 预览过滤器 UI（date range / eventId / horizon）→ 接已有契约字段；
2. Dataset List「列表 + 版本聚合」批量端点（消除 N+1）；
3. 接入 admin 写端点（update/archive Definition）的 UI（需鉴权门）；
4. 版本间统计/数据质量对比视图（声明 vs 实测差异可视化）；
5. 构建作业的实时进度刷新（RUNNING 态轮询）与 checkpoint 可视化；
6. 浏览器 E2E / 截图回归（引入 playwrighht 或 jsdom）。

---

## 状态

**DATASET-002.3 = COMPLETE**
