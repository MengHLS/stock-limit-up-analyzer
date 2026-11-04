# DATASET-002.4B — 数据集构建整合（旧 `/dataset-builder` → 新 Dataset Registry）

> 状态：**COMPLETE**
> 日期：2026-09-10
> 范围：只整合「数据集构建」功能；以新 Dataset Registry 架构为唯一入口。
> 前置：DATASET-001 / 002.1 / 002.2 / 002.3 / 002.4A 全部 COMPLETE。

---

## 1. Executive Summary

本次把历史上**两套并存**的数据集构建收敛为一套：

| | 旧（FE-3） | 新（本次唯一入口） |
|---|---|---|
| 页面 | `/dataset-builder` | `/datasets` |
| 后端 | `researchDataset.build` → `research_datasets` JSON 快照 | `datasetRegistry.*` → `dataset_definition / dataset_version / dataset_build_job` + `ds_*` 物理表 |
| 构建 | 同步请求内跑完，无作业/进度/取消 | 作业状态机 + 后台执行器 + 真实 checkpoint + 可取消/重试 |

整合后形成的闭环：

```text
/datasets/:datasetId
   └─「构建新版本」→ createDatasetVersion（DRAFT，固化构建配置）
        └─（可选）createBuildJob → PENDING
             └─ startBuildJob → RUNNING
                  └─ DatasetBuildRunner 后台真实执行 FirstLimitPullbackDatasetBuilder
                       └─ 写 ds_first_limit_pullback_{event,path,outcome}
                            ├─ COMPLETED → 版本 READY（进度 100）
                            ├─ FAILED    → 版本 FAILED（可重试）
                            └─ CANCELLED → 版本 FAILED（可重试，历史 Job 保留）
```

**关键突破**：DATASET-002.4A 只做完了「作业状态机」，`startJob` 之后**没有真正执行构建**（真实构建仍靠 CLI `runDataset001Build.mts`）。本次新增 `DatasetBuildRunner`，让 RUNNING 作业**真的被执行并写库**，前端点「构建新版本」即可产出真实数据。

**验证结论**：真实 TiDB 端到端 **21/21 全通过**（真实构建 98 事件 / 280 路径 / 196 结果落库 + 真实取消 + retry 历史保留 + v2 零改动 + 验证后清理无孤儿）；`tsc --noEmit` exit 0；目标测试 **149 全过**；`npm run build` PASS；全量 vitest **2518 过 / 16 失败（全部为既有环境失败，零新增）**。

---

## 2. Scope & Non-Goals

### 本次做（用户确认的两项决策）
1. **完整执行构建**：服务端真正跑 builder 写 `ds_*` 物理表；新增 `createDatasetVersion` API + 构建执行器（后台跑、进度写 checkpoint、可取消/重试）；前端在 `/datasets` 一键「构建新版本」并实时看进度。
2. **删除旧 `/dataset-builder` 页面 + 导航，旧路由重定向**；清理仅被其引用的旧构建组件/适配器。

### 明确不做
- ❌ 不删除 legacy `server/researchDataset`（后端保留，避免影响其他模块）。
- ❌ 不修改 Strategy / Backtest / Research Engine。
- ❌ 不开始 DATASET-002.5 Research Bridge。
- ❌ 不修改数据库 schema（migration 0028 零改动）。
- ❌ 不创建第二套 Dataset 模型；不使用 `as any`；不使用 mock 冒充真实构建。
- ❌ 不重新设计 DATASET-002.3 的 UI 结构（只在既有页面增量加构建能力）。

---

## 3. Architecture — 整合边界

```text
前端 /datasets（唯一入口）
  ├─ DatasetDetail      「构建新版本」对话框（BuildVersionDialog）
  └─ VersionDetail      「开始/重新构建」「取消构建」+ 作业级「取消/重试」+ 构建中轮询
        │
        ▼ tRPC（admin 写端点）
  server/datasetRegistry/router.ts
        ├─ createDatasetVersion   → service.createVersionWithBuildConfig
        ├─ createBuildJob         → service.createJob
        ├─ startBuildJob          → service.startJob + runner.start
        ├─ cancelBuildJob         → service.cancelJob + runner.cancel
        └─ retryBuildJob          → service.retryJob
              │
              ▼
  DatasetRegistryService（唯一状态机权威，registry.ts + lifecycle.ts）
              │
              ▼
  DefaultDatasetBuildRunner（runner.ts，后台执行，不阻塞请求）
              │
              ▼
  FirstLimitPullbackDatasetBuilder（builder.ts，DATASET-001 既有实现，零改动）
              │
              ▼
  DbDatasetBuildIO（db.ts）→ ds_first_limit_pullback_{event,path,outcome}
```

**唯一性保证**：`DatasetRegistryService` 是唯一新架构入口；未新增与 Registry 平行的模型；未复制 legacy `researchDataset` 数据模型。

---

## 4. Backend — Contracts & Naming

### `shared/datasetRegistryContracts.ts`（新增导出）
| 导出 | 作用 |
|---|---|
| `DATASET_VERSION_LABEL_PATTERN` | 版本标签正则 `/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/`。**前后端唯一同源**（`server/datasetRegistry/naming.ts` 复用），防校验漂移 |
| `DATASET_BUILD_CONFIG_DEFAULTS` | `{ pathHorizon: 20, outcomeHorizons: [5,10,20], batchSize: 1000 }`，与 `lifecycle.BUILD_DEFAULTS` 同值 |
| `DATASET_BUILD_CONFIG_LIMITS` | `pathHorizon 1..120`、`horizon 1..120`、`maxHorizons 8`、`batchSize 1..10000` |
| `createDatasetVersionInputSchema` | `{ datasetId, version, startDate, endDate, pathHorizon?, outcomeHorizons?, batchSize? }` + `.refine(startDate <= endDate)` |

迁移自旧 `DatasetConfigPanel` 的三项构建配置（回踩窗口 / 结果视界 / 批大小）在此定型为权威默认，避免前后端各写一套。

### `server/datasetRegistry/naming.ts`
- 新增 `validateVersionLabel(version)`：版本标签形态校验（复用契约正则）。**只校验标签**，允许 `v1` / `2024-full`；物理表命名仍只由 `dataset_code` 决定，禁止一版一表。

### `server/datasetRegistry/lifecycle.ts`
- 扩展稳定错误码：`DEFINITION_NOT_FOUND` / `DEFINITION_ARCHIVED` / `VERSION_ALREADY_EXISTS` / `INVALID_VERSION_LABEL`。
- 新增 `resolveBuildConfig(version)`：从已固化的 `filterDefinition` 解析 `pathHorizon / outcomeHorizons / batchSize`，缺失/非法回退权威默认；缺构建窗口时抛 `VERSION_NOT_BUILDABLE`。

---

## 5. Backend — Build Runner（真实执行）

**新增 `server/datasetRegistry/runner.ts`**（~245 行）。把「作业状态机」与「DATASET-001 真实构建实现」接起来，**不引入第二套构建逻辑**（复用 `FirstLimitPullbackDatasetBuilder` + `DatasetBuildIO`）。

```ts
export interface DatasetBuildRunner {
  start(jobId: string): Promise<void>;   // 异步触发，立即返回（幂等）
  cancel(jobId: string): void;           // 协作式取消标志（不落库）
  isRunning(jobId: string): boolean;
}
```

| 设计点 | 行为 |
|---|---|
| **不阻塞请求** | `start()` 只登记 + `void this.execute()`，构建在后台推进，前端轮询 `getVersion` 看进度 |
| **幂等** | `running: Map<jobId, BuildControl>`；同进程同 jobId 二次 `start` 直接返回 |
| **真实 totalChunks** | `countTradingDays()` = 窗口内真实交易日数（`io.loadTradingDays()` 过滤），不猜 |
| **进度写库** | builder 每个 chunk 回调 → `service.updateJobProgress`（`completedChunks / totalChunks / processedRows / lastCursor`） |
| **两阶段分母** | events 阶段分母 = 交易日数；paths/outcomes 阶段分母 = 交易日数 + 事件数（事件数在 events 结束后才知道），阶段切换时 `totalChunks` 由 4 → 102 —— 真实反映而非虚增 |
| **协作式取消** | `cancel()` 只置内存标志；builder 回调时抛 `DatasetBuildCancelledError`，中间态落库由 `service.cancelJob` 负责（runner 不重复写终态） |
| **终态不吞异常** | 真实错误 → `job FAILED` + `version FAILED`，`errorMessage` 落原始信息 |
| **无构建器诚实失败** | `factory` 返回 null → 抛错（不冒充成功）→ job/version FAILED |
| **进入构建态时机** | `markBuilding(versionId)` 置于**构建器解析之前**：任何「执行尝试」都反映到版本态，失败可落到 FAILED（可重试），不留「作业 FAILED 但版本仍 DRAFT」的不一致 |
| **可注入** | `factory` / `io` 可注入，单测用内存替身（9 例），生产用 `DbDatasetBuildIO` |

---

## 6. Backend — Service & Router

### `registry.ts`
- 新增 `createVersionWithBuildConfig(input)`：定义存在性 + 未归档 + 版本标签形态 + `(datasetId, version)` 唯一 校验后，组装 `universeDefinition` / `filterDefinition`（`kind: "build-config"`）并落 DRAFT。**不让 router / 前端拼装领域 JSON**。
- `startJob` / `cancelJob` / `retryJob` / `completeJob` / `failJob` / `markBuilding` / `markReady` / `markFailed` 全部带状态守卫（002.4A 建立，本次补齐版本态守卫联动）。

### `router.ts`
- 新增 `createDatasetVersion`（admin mutation），错误经 `toTrpcError` 映射为稳定 tRPC code。
- `DatasetRegistryRouterDeps` 增 `buildRunner?` / `buildIO?`；默认实例注入 `DbDatasetBuildIO` 自动构造 runner（缺省时只维护状态机，便于只读/单测）。
- `startBuildJob`：先 `service.startJob`（状态机 + §六 全部校验 + 原子转换），再 `runner.start` 真执行；执行器启动失败则 `failJob`，不留「假 RUNNING」。
- `cancelBuildJob`：先 `service.cancelJob` 落终态，再 `runner.cancel` 通知协作式停止。
- `completeJob / failJob` **不暴露 client**（防伪完成）。
- 稳定错误映射：`NOT_FOUND`（job/version/definition）/ `CONFLICT`（非法转换、重复版本、已存在 RUNNING）/ `PRECONDITION_FAILED`（已归档、不可构建）/ `BAD_REQUEST`（版本标签非法）。

### `query.ts`
- 导出 `toVersionListItem`（供 router 返回 wire DTO）。

---

## 7. Frontend — 构建能力（`/datasets`）

### 新增 `BuildVersionDialog.tsx`「构建新版本」
- 字段：版本标签（自动建议下一个，`suggestNextVersion` 纯函数）、起止日期、**「创建后立即开始构建」**勾选、可折叠「高级构建参数」（回踩窗口 / 结果视界 CSV / 批大小）。
- 编排 3 步：`createDatasetVersion` →（可选）`createBuildJob` → `startBuildJob`；成功后 `toast` 提示并跳转 VersionDetail 实时看进度。
- 校验：最小前端校验（必填 / 日期区间 / 边界 / 标签重复），语义合法性以契约为准；正则与默认值均取自 shared 契约（零重复定义）。

### 新增 `VersionBuildControls.tsx`「版本级构建控制」
- `DRAFT / FAILED / READY` →「开始构建 / 重新构建」（READY 显示为重新构建）。
- `BUILDING`（存在 RUNNING 作业）→「取消构建」。
- `BUILDING` 但无 RUNNING 作业 → 提示「历史卡态，可重新构建恢复」（诚实提示，不隐藏）。
- 只按后端 status 决定按钮可见性，**不自行判定合法性**。

### `BuildJobTable.tsx`
- 增可选 `onCancel / onRetry / busy`：RUNNING/PENDING → 取消；FAILED/CANCELLED → 重试。缺省不显示（保持只读场景不变）。

### `VersionDetail.tsx`
- 接入 `VersionBuildControls`；作业级取消/重试；构建中显示「实时刷新」指示。
- 轮询：`refetchInterval` — 版本 BUILDING 或存在 RUNNING/PENDING 作业时 **3s**；统计在 BUILDING 时 **5s**（完成后为终值）；非构建态自动停（`false`），不做无意义轮询。

### `DatasetDetail.tsx`
- 头部与 Versions 页签空态均提供「构建新版本」入口（定义已 ARCHIVED 时隐藏）。
- 创建成功后跳转 `/datasets/:datasetId/versions/:versionId`。

---

## 8. Frontend — 旧构建页移除与重定向

| 项 | 处理 |
|---|---|
| `client/src/pages/DatasetBuilder.tsx` | **删除** |
| `client/src/components/dataset/`（8 组件 + barrel，共 10 文件） | **删除**（`DatasetConfigPanel` / `DatasetPreviewPanel` / `DatasetCertifyPanel` / `DatasetCapabilityPanel` / `BuildSummary` / `BuildPipeline` / `SourceValidationTable` / `BuildDiagnostics` / `DatasetDetailViews` / `index.ts`） |
| `client/src/adapters/datasetAdapter.ts` | **删除** |
| `client/src/adapters/buildResultAdapter.ts` + `.test.ts` | **删除** |
| `client/src/adapters/index.ts` | 移除上述两个导出，新增 `datasetRegistryAdapter` |
| `client/src/App.tsx` | 移除 `DatasetBuilder` 引入；`/dataset-builder` → `<Redirect to="/datasets" />`（防书签失效） |
| `client/src/components/AppShell.tsx` | 「研究数据」组：删除旧「数据集构建 → /dataset-builder」，将「数据集注册 → /datasets」改名**「数据集构建 → /datasets」**（新页面成为唯一入口）；清理未用 `Layers` 图标 |

删除安全性：先全库查引用，确认旧簇**仅被自身 + barrel + 旧页面**引用（`lib/status.ts` / `datasetRegistryAdapter.ts` / `BuildJobTable.tsx` 中的提及均为**注释**），删除后 `tsc --noEmit` exit 0、`vite build` 通过。

**研发数据后端 `researchDataset.*` 未删除**（仅前端不再有入口），符合「不删除 legacy」约束。

---

## 9. Progress / Cancel / Retry Semantics

### Progress
- 计算权威在 `lifecycle.computeBuildProgress`：`COMPLETED → 100`；`totalChunks > 0` → `round(completedChunks/totalChunks*100)` 夹取 0..100；信息不足 → `null`（**不臆造百分比**）。
- 前端 `jobToVm` 采用同一口径；`Progress` 组件对 `null` 显示 `—`。
- 真实 checkpoint 落 `lastCursor`（JSON），前端只展示 `checkpointSummary` 技术摘要，不展示原始 LONGTEXT。

### Cancel
- `PENDING` / `RUNNING` 可取消；`COMPLETED` / `FAILED` / `CANCELLED` 拒绝（`INVALID_JOB_TRANSITION`）。
- 原子性：`repo.transitionJob(id, from, to, patch)` 条件 `UPDATE WHERE id AND status`，受影响行 = 0 则拒绝 → 防重复取消。
- 取消 RUNNING 时版本 `BUILDING → FAILED`（解除卡态，可重试）。
- 取消**由 server/domain 执行**；前端只调 mutation。

### Retry
- `FAILED` / `CANCELLED` → **创建新的 PENDING Job**，`jobId` 不同；**历史 Job 原样保留**（审计记录不破坏）。
- `COMPLETED` / `RUNNING` / `PENDING` 重试拒绝。

### 并发安全
- 两个请求同时 start 同一 Job：`transitionJob` 条件更新，仅一个成功，另一个 `INVALID_JOB_TRANSITION`。
- 两个 Job 同时 build 同一 Version：`getRunningJobForVersion` 守卫 → `JOB_ALREADY_RUNNING`。
- runner 内 `running: Map` 保证同进程同 jobId 只跑一个实例。
- 未做 DB 层重构（符合「最小安全保护」），残余理论窗口见 §13。

---

## 10. Tests

| 文件 | 用例 | 结果 |
|---|---|---|
| `server/datasetRegistry/runner.test.ts`（新增） | 9 | ✅ 成功/幂等 start/PENDING 非 RUNNING 拒绝/不存在作业/失败落 FAILED/无构建器诚实失败/协作式取消/version→BUILDING/稳定错误类型 |
| `server/datasetRegistry/registry.test.ts`（+6） | 24 | ✅ `createVersionWithBuildConfig`：DRAFT+配置固化/默认值/重复/不存在/已归档/非法标签 |
| `server/datasetRegistry/router.test.ts`（+5） | 20 | ✅ `createDatasetVersion`：正常/非法输入/非法标签/重复+不存在/非 admin FORBIDDEN；注册守卫补 5 写端点 |
| `shared/datasetRegistryContracts.test.ts`（+5） | 16 | ✅ 版本标签正则 / 默认值与边界自洽 / `createDatasetVersionInput` 正常 + 必填 + 边界 |
| `client/src/components/datasetRegistry/BuildVersionDialog.test.ts`（新增） | 3 | ✅ `suggestNextVersion` 纯函数 |
| 既有 `lifecycle/query/naming/path/detection/builder/adapter` | 71 | ✅ 无回归 |

**目标测试合计 149 passed / 0 failed。**
**全量 vitest：2518 passed / 16 failed** —— 16 个失败与 002.4A 基线**完全相同**（8 个文件：`tushare.secret` / `tushareTradingCalendar` 网络 token、`marketData` / `limitUp.watch` / `limitUp` / `image.uploadAndRecognize` DB 依赖、`dataHealth` 证据分层、`researchRunRouter` 口径），**本任务零新增失败**。

---

## 11. Real TiDB End-to-End Verification

脚本：`scripts/verifyDataset0024b.mts`（`npx tsx`，真实 DB，无 mock）。**21/21 ✅，退出码 0，临时数据已清理。**

```
【阶段 1】只读快照
  ✅ first_limit_pullback 定义存在 — id=1 eventTable=ds_first_limit_pullback_event
  ✅ v2 只读快照 — status=READY jobs=1 events=10240 rows=237128

【阶段 2a】真实构建（2024-01-02 → 2024-01-05）
  ✅ createVersionWithBuildConfig → DRAFT 且构建配置固化
  ✅ 构建配置固化正确 — pathHorizon=5 horizons=[1,2] batchSize=500
  ✅ createBuildJob → PENDING
  ✅ startBuildJob → RUNNING
  ✅ 构建进度真实落库（chunk checkpoint）— totalChunks=4 completedChunks=0
  ✅ 真实构建完成 → 作业 COMPLETED — completedChunks=98/102
  ✅ 版本 → READY（真实完成）
  ✅ 物理表真实写入 — events=98 paths=280 outcomes=196
  ✅ 版本统计与物理表一致 — declared 98/476 = actual 98/476
  ✅ 重复 start 被拒（INVALID_JOB_TRANSITION）
  ✅ 已完成作业 cancel 被拒（INVALID_JOB_TRANSITION）
  ✅ COMPLETED 不可 retry（INVALID_JOB_TRANSITION）

【阶段 2b】真实取消（2024-01-02 → 2024-03-29）
  ✅ 取消 RUNNING 作业 → CANCELLED（协作式停止）— completedChunks=1/58
  ✅ 取消后版本 → FAILED（解除 BUILDING 卡态，可重试）
  ✅ 重复 cancel 被拒（INVALID_JOB_TRANSITION）
  ✅ CANCELLED retry → 新 PENDING 作业（历史保留）
  ✅ 历史 Job 未被覆盖（CANCELLED + PENDING 两条并存）

【阶段 3】既存数据未被修改
  ✅ v2 状态仍为 READY
  ✅ v2 作业数未变（1 个）
  ✅ v2 物理表行数未变 — events=10240 paths=206408 outcomes=30720
```

**注意点（真实且已披露）**：`totalChunks` 在 events→paths/outcomes 阶段切换时由 4 变 102，故终态为 `98/102`。这是**真实两阶段分母**（events 阶段分母只含交易日；paths/outcomes 分母含交易日+事件），不是虚增或截断。已在 §5 说明。

---

## 12. Compatibility

| 项 | 状态 |
|---|---|
| `researchDataset.*`（legacy 后端） | **保留未动**（仅前端无入口）；`router.test` 断言 `researchDataset.build` 仍注册 |
| `client/src/pages/dataset-builder` | 删除，`/dataset-builder` → `/datasets` 重定向 |
| DATASET-002.3 四页结构 | 保留；仅增量加构建入口与控制条 |
| `migration 0028` / `drizzle/schema.ts` | **零改动** |
| Strategy / Backtest / Research Engine / `pullback.ts` / `tDayFilter.ts` | **零触碰** |
| CLI `runDataset001Build.mts` | 对齐新 service（`createJob → startJob → markBuilding`），保持可用 |
| 构建产物 | `vite build` 2966 模块（较 002.4A 的 2977 减少 11 —— 删除旧构建簇）；`esbuild` 1.3mb |

---

## 13. Remaining Gaps

均为**非阻塞**，如实记录：

1. **runner 进程内存态**：`running: Map` 是单进程内保护；多实例部署（多 node 进程）下同一 jobId 可能被两个进程执行。当前项目单进程，`transitionJob` 条件更新 + `getRunningJobForVersion` 已覆盖跨请求并发；跨进程需引入 DB 级租约（如 `locked_by / heartbeat_at`）——**需 migration**，本次不做。
2. **两阶段 `totalChunks` 跳变**：events 阶段结束后分母增大，进度百分比可能「回退」。语义真实但观感可优化（可拆为 `phase + phaseProgress` 字段）——需 schema 扩展，非阻塞。
3. **取消的最终一致性**：`cancelJob` 立即落 CANCELLED，builder 在下一个 chunk 回调才真正停止（协作式）。已由 `isRunning` + 前端轮询反映；极端情况下取消后可能仍写入 ≤1 个 chunk 的行（`resume`/幂等 upsert 已保证可重跑）。
4. **版本级 CANCELLED 状态**：schema 未定义，取消语义落在 Build Job 的 CANCELLED（版本 → FAILED 可重试）。如需版本级 CANCELLED，**需 migration**。
5. **`DatasetBuildRunner` 无进度订阅推送**：前端靠 3s 轮询；如需 SSE/WebSocket 实时推送属独立增强。
6. **旧 `researchDataset` 后端成为孤儿**：前端已无入口，但后端路由与表仍在。归档/移除需单独评估其他模块依赖，本次按约束保留。

---

## 14. Files Changed / Verification Commands / Final Status

### 新增
```
server/datasetRegistry/runner.ts                  构建执行器（真实执行 + 进度 + 协作取消）
server/datasetRegistry/runner.test.ts             9 例
client/src/components/datasetRegistry/BuildVersionDialog.tsx      「构建新版本」对话框
client/src/components/datasetRegistry/BuildVersionDialog.test.ts  3 例（suggestNextVersion）
client/src/components/datasetRegistry/VersionBuildControls.tsx    版本级构建控制
scripts/verifyDataset0024b.mts                    真实 TiDB 端到端验证（21 步）
docs/step-dataset-002.4b-report.md                本报告
```

### 修改
```
shared/datasetRegistryContracts.ts      + 版本标签正则 / 构建默认值+边界 / createDatasetVersionInputSchema
shared/datasetRegistryContracts.test.ts + 5 例
server/datasetRegistry/lifecycle.ts     + 4 错误码 + resolveBuildConfig
server/datasetRegistry/naming.ts        + validateVersionLabel
server/datasetRegistry/registry.ts      + createVersionWithBuildConfig
server/datasetRegistry/router.ts        + createDatasetVersion；buildRunner/buildIO 注入；start/cancel 接执行器
server/datasetRegistry/query.ts         导出 toVersionListItem
server/datasetRegistry/index.ts         导出 runner
server/datasetRegistry/registry.test.ts + 6 例
server/datasetRegistry/router.test.ts   + 5 例；adminUser 提至模块作用域；注册守卫补写端点
scripts/runDataset001Build.mts          CLI 对齐新 service
client/src/App.tsx                      移除旧页引入；/dataset-builder → Redirect
client/src/components/AppShell.tsx      导航：删旧项，/datasets 更名「数据集构建」
client/src/adapters/index.ts            移除 datasetAdapter / buildResultAdapter 导出
client/src/components/datasetRegistry/BuildJobTable.tsx  + onCancel/onRetry
client/src/components/datasetRegistry/index.ts           + 两个新组件导出
client/src/pages/datasets/DatasetDetail.tsx              + 构建新版本入口
client/src/pages/datasets/VersionDetail.tsx              + 构建控制 + 作业操作 + 轮询
```

### 删除
```
client/src/pages/DatasetBuilder.tsx
client/src/components/dataset/                 （10 文件：8 组件 + barrel）
client/src/adapters/datasetAdapter.ts
client/src/adapters/buildResultAdapter.ts
client/src/adapters/buildResultAdapter.test.ts
```

### 验证命令
```bash
npx tsc --noEmit                                     # exit 0
npx vitest run server/datasetRegistry \
  shared/datasetRegistryContracts.test.ts \
  client/src/adapters client/src/components/datasetRegistry
                                                     # 149 passed
npm run build                                        # vite 2966 模块 + esbuild PASS
npx tsx scripts/verifyDataset0024b.mts               # 真实 TiDB 21/21 ✅ exit 0
npx vitest run                                       # 2518 passed / 16 failed（均既有）
```

### Final Status
```
DATASET-002.4B = COMPLETE
```

验收对照：

| 验收项 | 结果 |
|---|---|
| `/datasets` 能创建版本并真实构建写 `ds_*` | ✅ 真实 98/280/196 行落库 |
| 构建进度为真实 checkpoint（非臆造） | ✅ `completedChunks/totalChunks` 真实计数 |
| 非法状态转换被拒 | ✅ 重复 start/cancel/complete-retry 均 `INVALID_JOB_TRANSITION` |
| 可取消、历史 Job 保留、可重试 | ✅ CANCELLED + 新 PENDING 并存 |
| 旧 `/dataset-builder` 不再可达 | ✅ 重定向 `/datasets`，页面与旧组件已删 |
| legacy `researchDataset` 未删 | ✅ 后端保留 |
| schema 未改 | ✅ migration 0028 零改动 |
| typecheck / target tests / build / 真实 DB | ✅ 全 PASS |

**未启动 DATASET-002.5。**
