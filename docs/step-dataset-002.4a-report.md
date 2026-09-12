# STEP DATASET-002.4A — Dataset Registry Build Lifecycle & State Machine 实施报告

> 状态：**COMPLETE**（真实 TiDB 已验证）
> 完成时间：2026-09-10 03:20 GMT+8
> 范围：`stock-limit-up-analyzer` ｜ 唯一交付物：本报告

---

## 1. Executive Summary

DATASET-002.4A 把 Dataset Registry 中「已有但不完整」的 `Definition → Version → Build Job → PENDING → RUNNING → COMPLETED/FAILED/CANCELLED` 链条，补全为**一个有明确状态机、生命周期控制、Build 控制 API、取消能力与可观察进度的完整闭环**。

核心结论一句话：

> **新增纯函数状态机层 `lifecycle.ts`（唯一转换规则来源 + 稳定错误码），在既有 `DatasetRegistryService`（唯一新架构入口）上补全 `createJob/startJob/cancelJob/completeJob/failJob/retryJob` + Version 状态迁移守卫 + 并发安全（原子条件更新），在既有 `datasetRegistryRouter` 上新增 4 个 admin Build 控制端点，并用真实 TiDB（`first_limit_pullback`）跑通 22 步生命周期验证（v2 只读、临时版本写生命周期、验证后清理、v2 未被触碰）。**

关键纪律（全部满足）：
- **未臆造新状态**：Version 枚举保持 `DRAFT/BUILDING/READY/FAILED`（schema 无 `CANCELLED/ACTIVE/ARCHIVED`），取消语义落在 Build Job 层；Build Job 保留完整 5 态。
- **未删/未改 legacy**：`researchDataset.*`、`pullback.ts`、`tDayFilter.ts`、Strategy/Backtest/Research Engine 零改动；`/dataset-builder`、`researchDataset.*` 完全不动。
- **未改 schema**：migration 0028 未动；唯一数据层改动是为「最小并发保护」新增 `transitionJob`（条件 UPDATE）与 `getRunningJobForVersion` 两个 repository 方法，复用现有 `dataset_build_job` 表。
- **未用 mock 冒充真实 Build**：真实 TiDB 验证全程走 `DbDatasetRegistry` + `DatasetRegistryService`（真实查询层 / 真实持久化），无内存 mock。

---

## 2. State Machine

### 2.1 现状审计结论

| 实体 | 真实枚举（schema 为准） | 审计前服务能力 | 缺口 |
|---|---|---|---|
| Version | `DRAFT / BUILDING / READY / FAILED` | `markBuilding/markReady/markFailed`（**无迁移守卫，任意状态直接覆盖**） | 无状态转换校验；无 CANCELLED/ACTIVE/ARCHIVED（schema 未定义，不臆造） |
| Build Job | `PENDING / RUNNING / COMPLETED / FAILED / CANCELLED` | `startJob`（**直接置 RUNNING，无 PENDING 阶段**）/ `completeJob` / `failJob`（**不校验当前态**） | 无 `createJob`/`cancelJob`/`retryJob`；无非法转换拒绝；无并发保护 |

### 2.2 Version 状态机（实现后）

```
DRAFT   → BUILDING            （首次构建）
FAILED  → BUILDING            （失败后重试）
READY   → BUILDING            （重建/刷新）
BUILDING → READY              （构建成功）
BUILDING → FAILED             （构建失败 / 取消的落点）
```

- `CANCELLED/ACTIVE/ARCHIVED` **不在 schema 中，故不臆造**（任务 §四明确「以当前 schema 为准、不得擅自修改数据库」）。取消语义由 Build Job 的 `CANCELLED` 承载；取消 RUNNING 构建时版本 `BUILDING → FAILED`（可 `FAILED → BUILDING` 重试）。
- 所有非法转换（如 `DRAFT→READY`、`BUILDING→BUILDING`、`READY→FAILED`）抛稳定错误码 `INVALID_VERSION_TRANSITION`。

### 2.3 Build Job 状态机（实现后）

```
PENDING  → RUNNING / CANCELLED
RUNNING  → COMPLETED / FAILED / CANCELLED
COMPLETED / FAILED / CANCELLED  （terminal，无出边，禁止重复 start/cancel/complete/fail）
```

- 非法转换（重复 start、重复 cancel、重复 complete、重复 fail、terminal 再操作）抛 `INVALID_JOB_TRANSITION`。

### 2.4 实现位置

- `server/datasetRegistry/lifecycle.ts`（**新增**）：`VERSION_TRANSITIONS` / `JOB_TRANSITIONS` 转换表 + `canTransitionVersion/canTransitionJob/assertVersionTransition/assertJobTransition` + `isVersionBuildable` + `isTerminalJobStatus` + `computeBuildProgress` + `DatasetLifecycleError`（稳定错误码）。
- 状态转换逻辑**集中在 domain/service 层**（`registry.ts` 的 `DatasetRegistryService`），router 只调用 service，JSX 无业务状态机。

---

## 3. Build Job Lifecycle

`DatasetRegistryService`（`server/datasetRegistry/registry.ts`）实现/完善：

| 方法 | 签名 | 转换 | 校验 |
|---|---|---|---|
| `createJob` | `(versionId)` → `DatasetBuildJob` | 无 → `PENDING` | 版本存在 + 可构建（DRAFT/FAILED/READY）；server 生成 `ds001-<version>-<ts>-<uuid8>` |
| `startJob` | `(jobId)` → `DatasetBuildJob` | `PENDING → RUNNING` | 作业存在 + 版本存在 + 作业 PENDING + 版本可构建 + 无另一 RUNNING 作业（§六 6 项全查） |
| `cancelJob` | `(jobId)` → `DatasetBuildJob` | `PENDING/RUNNING → CANCELLED` | terminal 拒绝；RUNNING 取消联动版本 `BUILDING→FAILED` |
| `completeJob` | `(jobId)` → `void` | `RUNNING → COMPLETED` | 非 RUNNING 拒绝 |
| `failJob` | `(jobId, message)` → `void` | `RUNNING → FAILED` | 非 RUNNING 拒绝 |
| `retryJob` | `(jobId)` → `DatasetBuildJob` | `FAILED/CANCELLED → 新 PENDING` | 历史作业保留（新 jobId）；版本需可构建 |
| `markBuilding/markReady/markFailed` | — | 见 §2.2 | 加 `assertVersionTransition` 守卫 |

> 说明：`startJob` **不自动**改版本状态（版本 → BUILDING 由构建服务显式 `markBuilding`，与作业状态机解耦，见 `runDataset001Build.mts`）；`cancelJob` 取消 RUNNING 作业时联动版本 `BUILDING → FAILED` 解除「卡 BUILDING」阻塞。

---

## 4. API Changes

`server/datasetRegistry/router.ts` 新增 **4 个 admin 写端点**（`adminProcedure`）：

| 端点 | 入参 schema | 返回 | 说明 |
|---|---|---|---|
| `datasetRegistry.createBuildJob` | `{ datasetVersionId: safeIntId }` | `DatasetBuildJobListItem`（含 `progress`） | 创建 PENDING 作业 |
| `datasetRegistry.startBuildJob` | `{ jobId: string(1..64) }` | 同上 | PENDING→RUNNING |
| `datasetRegistry.cancelBuildJob` | `{ jobId: string(1..64) }` | 同上 | →CANCELLED |
| `datasetRegistry.retryBuildJob` | `{ jobId: string(1..64) }` | 同上 | FAILED/CANCELLED → 新 PENDING |

- 既有 `getJob`/`listJobs`（query）复用，未重复实现。
- `completeJob`/`failJob` **不暴露为 client mutation**（由构建服务内部调用，防止前端「伪完成」直接覆盖状态），符合「不允许客户端提交任意 status 直接覆盖数据库」。
- 所有 input 经 `safeIntId` / `string(1..64)` 校验；**无 tableName 入参**（物理表名只在 `dataset_definition` 读取，drizzle schema 编译期固化，无字符串拼表）。
- 新增领域错误 → tRPC 稳定映射：`JOB_NOT_FOUND/VERSION_NOT_FOUND → NOT_FOUND`；`INVALID_JOB_TRANSITION/INVALID_VERSION_TRANSITION/JOB_ALREADY_RUNNING → CONFLICT`；`VERSION_NOT_BUILDABLE → PRECONDITION_FAILED`。

**契约**：`shared/datasetRegistryContracts.ts` 新增 `createBuildJobInputSchema/startBuildJobInputSchema/cancelBuildJobInputSchema/retryBuildJobInputSchema` + `DatasetBuildJobListItem.progress`（后端权威进度）。

---

## 5. Concurrency Safety

复用项目当前数据库访问方式提供「最小安全保护」（未大规模重构 DB）：

1. **原子作业转换**：`DatasetRegistryRepository.transitionJob(id, from, to, patch)` — 条件 `UPDATE ... WHERE id=? AND status=?`，返回受影响行数（0 = 被并发抢先）。两个请求同时 start 同一 Job → 仅一个 `PENDING→RUNNING` 成功，另一个受影响行 0 → 拒绝。
2. **版本级 RUNNING 守卫**：`getRunningJobForVersion(datasetVersionId)` — startJob 前检查无另一 RUNNING 作业，命中抛 `JOB_ALREADY_RUNNING`。

> 残余边界（如实记录）：两个**不同** PENDING 作业并发 start 同一版本时，`getRunningJobForVersion` 是 check-then-act，理论上存在窗口；但项目内存有约束「BaoStock 单账号单活跃会话 → 构建必须串行」，构建服务本身串行，故该窗口为理论性。彻底消除需版本级行锁/事务，超出「最小保护」范围，留作后续（002.5+ 或引入队列时）。

---

## 6. Retry / Cancel Semantics

- **Retry**：`FAILED/CANCELLED → 新建 PENDING`（新 jobId，`ds001-<version>-<ts>-<uuid8>`）。**历史 Job 保留**（各自最终状态落库，审计不破坏）。数据模型（`jobId UNIQUE` 独立行）原生支持，无需改 schema。
- **Cancel**：`PENDING` 可取消、`RUNNING` 可取消、`COMPLETED/FAILED` 不可取消、`CANCELLED` 不可重复取消。取消由 server/domain/service 执行（router → `service.cancelJob`），前端不直改 DB。RUNNING 取消时版本 `BUILDING → FAILED`（schema 无 CANCELLED 版本态，FAILED 为取消后的可重试落点）。

---

## 7. Progress Semantics

`lifecycle.ts` 的 `computeBuildProgress`（后端单一事实来源，写入 wire 的 `progress` 字段）：

- `COMPLETED → 100`（无论 chunk 字段）；
- `totalChunks > 0 且有 completedChunks → round(completedChunks / totalChunks * 100)`，夹取 0..100；
- 信息不足（`totalChunks` 缺失/≤0 或 `completedChunks` 缺失）→ `null`（**不臆造百分比**）。

前端 002.3 的 `jobProgress` 规则与此完全一致（`client/src/adapters/datasetRegistryAdapter.ts`），现 wire 已提供后端权威 `progress`，二者零分歧；前端未改动（任务允许范围内无需改）。

---

## 8. Tests

新增/修改单测（全部 node 环境，无 mock 冒充真实 Build）：

| 文件 | 新增/改 | 覆盖 |
|---|---|---|
| `server/datasetRegistry/lifecycle.test.ts` | +13 | Version/JOb 合法+非法转换、terminal、progress 0/中间/100/unknown/夹取 |
| `server/datasetRegistry/registry.test.ts` | +12 | createJob/startJob/cancelJob/completeJob/failJob/retryJob、非法转换、并发（JOB_ALREADY_RUNNING）、历史保留 |
| `server/datasetRegistry/router.test.ts` | +5 | 4 个 mutation 端点、入参 schema、稳定错误码映射（NOT_FOUND/CONFLICT/FORBIDDEN） |
| `shared/datasetRegistryContracts.test.ts` | +2 | 4 个新 mutation schema 校验 |
| `client/src/adapters/datasetRegistryAdapter.test.ts` | 改 1 处 | `job()` fixture 补 `progress` 字段（类型正确性） |

**结果**：
- `vitest run server/datasetRegistry shared/datasetRegistryContracts.test.ts client/src/adapters/datasetRegistryAdapter.test.ts` → **112 passed**（含既有 002.2/002.3 用例）。
- `tsc --noEmit` → **exit 0**。
- `npm run build`（vite build 2977 模块 + esbuild server）→ **PASS**。

---

## 9. Real TiDB Verification

`scripts/verifyDataset0024a.mts`（真实 `DbDatasetRegistry` + `DatasetRegistryService`，无 mock）：

**阶段 1 — 只读验证真实 `first_limit_pullback` / v2**：Definition(id=1, ACTIVE)、Version v2(id=90001, READY, 10,240 事件 / 237,128 行)、1 个历史作业（COMPLETED）。

**阶段 2 — 真实 DB 生命周期（临时版本 `verify-0024a-<ts>`，验证后删除）**，22 步全 ✅：

```
✅ createJob → PENDING
✅ startJob → RUNNING
✅ progress 落库（completed=40/100）
✅ 非法重复 start 被拒（INVALID_JOB_TRANSITION）
✅ 并发保护：版本已有 RUNNING，另一作业 start 被拒（JOB_ALREADY_RUNNING）
✅ cancelJob RUNNING → CANCELLED
✅ cancel 后版本 BUILDING → FAILED
✅ 非法重复 cancel 被拒
✅ retry CANCELLED → 新 PENDING
✅ failJob RUNNING → FAILED（err 落库）
✅ retry FAILED → 新 PENDING
✅ completeJob RUNNING → COMPLETED
✅ 非法重复 complete 被拒
✅ 历史 Job 保留（4 作业：2 CANCELLED + 1 FAILED + 1 COMPLETED）
```

**阶段 3 — v2 未被触碰**：v2 仍 READY，作业数量未变（1）。

**清理**：临时版本与其 4 个作业全部删除，`dataset_build_job` 恢复 5 行（原 smoke×2 RUNNING + smoke/v1/v2×1 COMPLETED），无孤儿数据。

---

## 10. Compatibility

- **未删除/未修改**：`server/researchDataset/*`（含 `pullback.ts`/`tDayFilter.ts`）、Research Engine、Strategy、Backtest、`/dataset-builder` 前端、`researchDataset.*` tRPC。
- **schema/migration 0028 未改动**。
- **唯一对既有文件的修改**：`registry.ts`（service 重构 + repo 契约扩展）、`db.ts`（+2 方法）、`index.ts`（+lifecycle 导出）、`query.ts`（+`toJobListItem` 导出 + `progress` 字段）、`router.ts`（+4 mutation + 错误映射）、`shared/datasetRegistryContracts.ts`（+4 schema + `progress`）、`scripts/runDataset001Build.mts`（构建生命周期改 `createJob→startJob→markBuilding`）、`client/src/adapters/datasetRegistryAdapter.test.ts`（fixture 补 `progress`，1 行）。

---

## 11. Remaining Gaps

1. **Version 无 CANCELLED/ACTIVE/ARCHIVED**：schema 未定义，本任务不臆造；取消语义落在 Build Job，版本取消后落点用 `FAILED`。若未来产品需要「版本级取消/归档」，需 migration 扩展（非本任务范围）。
2. **并发残余窗口**：不同 PENDING 作业并发 start 同一版本的 check-then-act 窗口为理论性（构建服务串行），彻底消除需版本级行锁/事务（留 002.5+）。
3. **completeJob/failJob 未暴露为 API**：由构建服务内部调用（防前端伪完成），符合「禁止客户端提交任意 status」。
4. **真实全量构建未重跑**：本任务只验证生命周期/状态机/API；真实数据构建（`builder.build`）已由 DATASET-001 验证（v2 237,128 行），未在本任务重跑（避免 ~23min 无谓重建）。
5. **前端不消费后端 `progress`**：002.3 前端 `jobProgress` 与后端 `computeBuildProgress` 规则一致（零分歧），未强改前端（任务允许范围内无需改）。

---

## 12. Files Changed

**新增**：
- `server/datasetRegistry/lifecycle.ts`（状态机 + 错误码 + progress）
- `server/datasetRegistry/lifecycle.test.ts`
- `scripts/verifyDataset0024a.mts`（真实 TiDB 验证）

**修改**：
- `server/datasetRegistry/registry.ts`（service 重构 + repo 契约 `transitionJob`/`getRunningJobForVersion`）
- `server/datasetRegistry/db.ts`（`DbDatasetRegistry` +2 方法）
- `server/datasetRegistry/index.ts`（+lifecycle 导出）
- `server/datasetRegistry/query.ts`（`toJobListItem` 导出 + `progress`）
- `server/datasetRegistry/router.ts`（+4 mutation + 错误映射）
- `server/datasetRegistry/registry.test.ts` / `router.test.ts`（测试扩展）
- `shared/datasetRegistryContracts.ts` / `.test.ts`（+4 schema + `progress`）
- `scripts/runDataset001Build.mts`（构建生命周期对齐）
- `client/src/adapters/datasetRegistryAdapter.test.ts`（fixture 补 `progress`）

---

## 13. Verification Commands

```bash
# typecheck
npx tsc --noEmit                                    # exit 0

# target tests（本任务 + 依赖）
npx vitest run server/datasetRegistry shared/datasetRegistryContracts.test.ts client/src/adapters/datasetRegistryAdapter.test.ts
# → 112 passed

# build
npm run build                                       # vite build (2977 modules) + esbuild → PASS

# real TiDB verification
npx tsx scripts/verifyDataset0024a.mts              # 22 步全 ✅，exit 0

# full suite（既有失败 16 例，与 002.3 报告一致，本任务零新增）
npx vitest run                                      # 2498 passed / 16 failed
```

全量 16 例失败**均为既有环境失败**（`tushare.secret`/`tushareTradingCalendar` 网络与 token、`researchRunRouter` 口径 `EXECUTOR_NOT_BOUND`、DB 依赖等），与本任务改动零重叠；**本任务新增失败 = 0**。

---

## 14. Final Status

```text
DATASET-002.4A = COMPLETE
```

- 状态机 ✅、Build Job 生命周期 ✅、Build API ✅、并发安全 ✅、Retry/Cancel ✅、Progress ✅、测试 ✅、真实 TiDB 验证 ✅、兼容性 ✅。
- 无 P0 阻塞；残余缺口见 §11（均为非阻塞、已在报告中如实标注）。
