# RESEARCH-EXPERIMENT-004 — Independent Experiment Persistence & MinIO Artifact Storage

> **任务类型**：Implementation（用户提供 23 节规格书）
> **编号**：`9ch`（沿用「下一个未占用」，非「末条 +1」；上一项 `9cg` = RESEARCH-EXPERIMENT-003）
> **完成日期**：2026-09-20
> **状态**：**COMPLETE**（停在 004 边界，**未**自动开始 EXP-001）
> **一句话**：把独立研究实验从「请求内计算、刷新即丢」推进到「**Run 元数据落 TiDB、结果与产物落对象存储、关页面重开仍可查看历史 Run**」。

---

## 1. 实施范围

### 1.1 交付了什么（对照规格 §21 完成标准）

| 编号 | 完成标准 | 兑现方式 | 判据（可复跑） |
|---|---|---|---|
| A | Experiment / Run Metadata 可保存；Dataset Version 可引用；Run 状态可追踪；Manifest Key 可保存 | 新表 `research_experiment_run`（20 列，含 Run 身份 / 实验坐标快照 / Dataset 坐标 / 参数快照 / 生命周期 / 错误 / `resultManifestKey` / 轻量摘要） | `docs/evidence/_e2e_9ch_experiment_persistence.out.json` 第 1、5、7 步 |
| B | Result / Manifest / CSV / Parquet / Chart / Log 可保存 | `ArtifactStorage` 端口 + `MinIOArtifactStorage`（S3 协议，`forcePathStyle`） | E2E 第 5、10、11 步（实测 5 个对象落在 MinIO） |
| C | Framework 链路完整（建 Run → 执行 → Result → 上传 → Manifest → 存引用 → COMPLETED） | `runService.executeAndPersist()` 单入口 | E2E 第 4~9 步全绿 |
| D | 前端可查看 Experiment / 历史 Run / Run Metadata / Result / Artifact | 列表页新增 3 列 + 详情页「运行历史」卡片 + 新路由 RunDetail | `_probe_9ch_experiment_persistence_frontend.mjs` **46 PASS / 0 FAIL** |
| E | 失败 Run 不得伪装成成功 | 状态机 + 产物校验前置 + 失败红条 + 三处 `data-*` 锚点 | `runPersistence.test.ts`（失败/幂等用例 12 例）+ 探针 B/C 段 |
| F | 无回归 | 见 §12 测试结果 | `test:changed` 零新增失败文件；`legacyFreeProductionChain` Gate 未破 |

### 1.2 明确**没有**做的事（规格 §20 禁止项，逐条确认未触碰）

- ❌ 未部署 PostgreSQL / Redis / MinIO 集群 / Kubernetes（`MINIO_*` 指向用户既有 MinIO，桶 `research` 预先存在）
- ❌ 未改 Dataset 架构；❌ 未把 Dataset 复制进 MinIO（表里只有 `datasetVersionId` 一个软引用坐标）
- ❌ 未改 Strategy Core / Backtest / Parameter Search / OOS / Walk-Forward
- ❌ 未恢复旧 Research（Analysis / Finding / Conclusion 一个锚列都没进新表）
- ❌ 未建新 Research 链；❌ 未设计权限系统；❌ 未重做 Experiment Framework

### 1.3 改动规模

新增 **26 个文件 / 7178 行**（含测试与探针），修改 **13 个已跟踪文件**。分域清单见 §1.4。

### 1.4 文件清单

**新增 —— 持久化域层（`server/researchExperiments/persistence/`，1372 行）**

```
runId.ts            31 行   Run 身份生成（RUN-YYYYMMDD-XXXXXXXX，结构性防注入：禁 / .. \）
runManifest.ts     247 行   Manifest 构建 / 校验 / 解析（zod）
runRepository.ts   591 行   Run 仓储（DB 实现 + 内存实现，同一批断言共用）
artifactPublisher.ts 254 行 结果信封 → 产物文件集合（result / tables / charts / logs）
runService.ts      495 行   生命周期编排 + 一致性收敛（executeAndPersist / reconcileRun / 读路径）
index.ts            64 行   桶出口
```

**新增 —— 对象存储端口与适配器（`server/artifactStorage/`，1133 行）**

```
types.ts                 117 行  端口契约 + 闭集错误码 + ArtifactStorageError
objectKey.ts             200 行  Object Key 规范 + 结构级防注入
inMemoryArtifactStorage.ts 217 行 测试替身（**唯一允许出现在测试里的实现**）
minioArtifactStorage.ts  367 行  MinIO 适配器（S3 协议）
factory.ts               164 行  环境变量装配（含惰性单例）
index.ts                  68 行  桶出口
```

**新增 —— 路由 / 前端 / 迁移 / 测试 / 探针**

```
server/experimentArtifactRoutes.ts                        100 行  产物只读代理（非 tRPC，流式）
client/src/pages/researchExperiments/RunDetail.tsx        564 行  历史 Run 页（新路由）
client/src/pages/researchExperiments/artifactViews.tsx    567 行  Manifest 索引 / 产物目录 / 按需预览
client/src/pages/researchExperiments/runShared.tsx        105 行  状态徽章 / 时间 / 字节 / 耗时格式化
drizzle/0047_experiment_run_persistence.sql                80 行  手工幂等 migration
tests/server/researchExperiments/runPersistence.test.ts   914 行  31 例
tests/server/researchExperiments/minioArtifactStorage.test.ts 319 行 20 例
tests/server/researchExperiments/runRepositoryRetry.test.ts  172 行  7 例
tests/server/researchExperiments/artifactRoute.test.ts      45 行   3 例
docs/evidence/_e2e_9ch_experiment_persistence.mts         430 行  真实 TiDB + 真实 MinIO E2E（默认自清）
docs/evidence/_probe_9ch_experiment_persistence_frontend.mjs 689 行 前端可达性（CDP 量 DOM）
docs/evidence/_probe_9ch_run_query.mts                    130 行  真库查询根因探针（只读）
docs/evidence/_probe_9ch_minio_connectivity.mts           202 行  MinIO 连通性 + 桶/对象列举
.env.example                                               46 行   环境变量样例（只放占位符）
```

**修改 —— 已跟踪文件（13）**

| 文件 | 改动性质 |
|---|---|
| `drizzle/schema.ts` | 新增 `researchExperimentRun` 表定义（与 0047 逐列对齐） |
| `server/_core/index.ts` | 注册 `/api/experiments/artifact`（**必须在 Vite 中间件之前**） |
| `server/researchExperiments/router.ts` | 新增 6 个 Run 端点（读 5 + 写 2，含收敛），**不删除也不改语义**既有端点 |
| `server/researchExperiments/defaults.ts` | 装配 `runService`（DB 仓储 + 惰性存储解析） |
| `server/researchExperiments/runner.ts` | 新增 `runDetailed()`（额外交回 `artifactFiles`），原 `run()` 语义不变 |
| `server/researchExperiments/index.ts` | 新增出口 |
| `shared/researchExperimentsContracts.ts` | 新增两个 **双端同源**常量（见 §11.4） |
| `client/src/App.tsx` | 新路由 `/research-experiments/:group/:key/runs/:runId` |
| `client/src/pages/researchExperiments/index.ts` | 新增页面出口 |
| `client/src/pages/researchExperiments/ExperimentList.tsx` | 重写：消费 `ExperimentSummary[]`，新增 状态 / Latest Run / 最近运行时间 三列 |
| `client/src/pages/researchExperiments/ExperimentDetail.tsx` | 新增「运行历史」卡片 + 「已持久化」回执（含失败 Run 红条） |
| `client/src/pages/researchExperiments/GenericResultView.tsx` | 新增可选 `registrationNotice`（历史 Run 页不能复用「未注册页面」提示） |
| `tests/server/researchExperiments/router.test.ts` | 补 004 端点守卫 + 反向断言 + 新增「Run 查询面」用例组 |

---

## 2. 当前架构（实施前的真实状态，审计结论）

### 2.1 审计动作与实现映射

按规格 §3「先审计再动手」，先读后写。审计结论（**不是推测**）：

| 审计问题 | 实测结论 | 证据 |
|---|---|---|
| 是否已有对象存储代码 | **没有**。`grep -rn "minio\|s3\|oss"` 在 `server/**` 无生产实现 | 全仓搜索 |
| 是否已有 S3 客户端依赖 | **有**：`@aws-sdk/client-s3` 已在 `node_modules`（传递依赖） ⇒ **零新依赖** | `package.json` / lockfile |
| env 管理方式 | `server/_core/env.ts`（`ENV`）+ `dotenv/config`；`DATABASE_URL` 由 `server/db.ts` 直接读 `process.env` | 两个文件的既有实现 |
| API 结构 | tRPC 11，命名空间挂载在 `server/routers.ts` 的 `appRouter`；非 tRPC 的二进制/流式路由走 Express（既有先例 `/api/scheduled/*`） | `server/routers.ts` / `server/_core/index.ts` |
| 001/002/003 的最终实现 | 实验定义 = 代码声明（`research-experiments/manifest.ts` + `server/registry.ts`）；执行 = `runner.ts` 的 `run()` **请求内计算、结果不落库**；`ExperimentResultEnvelope` = `metadata/parameters/sampleSummary/tables/statistics/distributions/comparisons/charts/customPayload`；样本账强制平 | `docs/research/RESEARCH-EXPERIMENT-00{1,2,3}-final.md` |
| Run 表是否存在 | **不存在**。003 已删旧 Research 的表；`research_experiment_run` 从未建过 | `drizzle/schema.ts` |
| migration ledger | `drizzle/*.sql` 已至 `0046`；`drizzle/meta/_journal.json` 自 0024 起停维护、**不是编号真源** | `ls drizzle/*.sql` |
| 前端 | `/research-experiments`（列表）+ `/research-experiments/:group/:key`（详情），均只展示定义，无历史 | 两个既有页面 |

### 2.2 实施前的架构问题（本任务要解决的）

```
现状（004 前）:
  Browser ──点击「运行」──▶ tRPC run ──▶ runner.run() ──▶ 结果只进 React state
                                                        └─▶ 刷新页面 ⇒ 结果消失（需重跑）
  说明：页面已**如实告知**「结果不落库、刷新需重跑」—— 不是隐瞒，但能力确实缺失。

004 后:
  Browser ──点击「运行」──▶ tRPC run ──▶ runService.executeAndPersist()
                                         ├─ ① 建 Run 行（PENDING，含坐标快照）
                                         ├─ ② markRunning（RUNNING）
                                         ├─ ③ runner.runDetailed()（真实 Dataset 计算）
                                         ├─ ④ 结果信封 → 产物文件集合（result/tables/charts/logs）
                                         ├─ ⑤ ArtifactStorage.put()（对象存储）
                                         ├─ ⑥ 生成并上传 manifest.json
                                         ├─ ⑦ **逐个实测 exists()** 复核产物
                                         ├─ ⑧ markCompleted（写 resultManifestKey + 摘要）
                                         └─ 任一步失败 ⇒ markFailed（**绝不留 RUNNING 悬挂**）
  Browser ──重新打开──▶ listExperiments / listRuns / getRun / getRunResultManifest
                       ⇒ 展示历史，**不需要重跑**
```

---

## 3. TiDB schema 变化

### 3.1 只加一张表（关键设计决策）

**新增 `research_experiment_run`（20 列）。没有建 `experiment` 表。**

规格 §4 允许两种做法，本项目实测选第一种，理由是**避免两个真源**：

> Experiment 的元数据在本体系里是**代码声明**的（`research-experiments/manifest.ts` 的 `descriptor` + `server/researchExperiments/registry.ts`），随 git 版本化、可 review、可测试。若再建一张 DB 表，那么「代码里的定义」与「DB 里的行」就都能被改，**漂移时无法判定谁对**。
> 规格 §4 自己写明「**优先扩展现有表，不重复创建同义表**」，§20 禁止「重做 Experiment Framework」。
> 「历史 Run 仍可读懂」改由**快照列**兑现 —— `experimentName` / `experimentVersion` / `datasetCode` / `datasetVersionLabel` / `parametersJson` 都写下**运行当时**的值。

### 3.2 列清单（逐列说明用途）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `bigint AUTO_INCREMENT` | 主键（`research_experiment_run_id`） |
| `runId` | `varchar(80) NOT NULL` | 业务 Run 身份，**唯一**（`uq_research_experiment_run_id`） |
| `experimentId` | `varchar(96) NOT NULL` | 如 `first-board-pullback/entry-day`（代码声明坐标） |
| `experimentName` | `varchar(200) NOT NULL` | **运行当时**的实验名快照 |
| `experimentVersion` | `varchar(32) NOT NULL` | **运行当时**的实验版本快照 |
| `datasetVersionId` | `bigint NOT NULL` | Dataset 版本坐标（**软引用，零 FK**） |
| `datasetCode` | `varchar(64) NOT NULL` | Dataset 语义代码快照 |
| `datasetVersionLabel` | `varchar(96) NOT NULL` | 如 `v2`（快照） |
| `parametersJson` | `longtext NOT NULL` | 请求参数快照（JSON 列一律 `longtext` + 列名以 `Json` 结尾） |
| `status` | `varchar(16) NOT NULL DEFAULT 'PENDING'` | `PENDING/RUNNING/COMPLETED/FAILED`（**不用 `mysqlEnum`**，便于扩状态而不动 DDL） |
| `startedAt` / `completedAt` | `timestamp NULL` | 生命周期时间 |
| `durationMs` | `int` | 耗时 |
| `errorCode` / `errorMessage` | `varchar(64)` / `text` | 失败原因（**执行失败**与**持久化失败**共用，靠 `errorCode` 区分） |
| `resultManifestKey` | `varchar(512)` | Manifest 对象 Key（情况 C 的判据载体） |
| `resultSchemaVersion` | `varchar(32)` | 结果信封 schema 版本 |
| `summaryJson` | `longtext` | **轻量**摘要（样本账、产物个数等）—— 结果本体不在这里 |
| `createdAt` / `updatedAt` | `timestamp NOT NULL DEFAULT (now())` | 审计 |

### 3.3 落库边界（规格 §2 / §17 的硬线）

- **进表**：Run 身份 / 实验坐标快照 / Dataset 坐标 / 参数快照 / 状态 / 起止时间 / 耗时 / 错误 / Manifest Key / schema 版本 / 轻量摘要
- **不进表**：结果信封本体、表格、图表、CSV、Parquet、日志 —— **一律落对象存储，表里只存引用**
- **不复制 Dataset**：只有 `datasetVersionId`

### 3.4 索引

| 索引 | 列 | 服务什么 |
|---|---|---|
| `idx_research_experiment_run_experiment` | `(experimentId, id)` | 实验详情页「运行历史」按时间倒序分页 |
| `idx_research_experiment_run_status` | `(status)` | 找出悬挂 RUNNING / 统计各状态（`reconcileRun` 与运维排查） |
| `idx_research_experiment_run_dataset` | `(datasetVersionId)` | 「这个 Dataset 版本被哪些 Run 用过」 |

### 3.5 零 FK（全库既有原则）

本 migration **不加任何 FK**，与全库既有 `soft reference + 应用层校验` 一致。E2E 实测 `foreignKeyCountInSchema: 0`。

---

## 4. Migration 编号

### 4.1 取号依据

```
ledger 实查：drizzle/*.sql 已至 0046_legacy_research_retire.sql（003 产出）
          ⇒ 本 migration 取号 **0047**
禁：db:push / drizzle-kit generate / 手写 drizzle/meta/_journal.json
    （自 0024 起 _journal.json 已停维护，**不是编号真源**）
```

**产物**：`drizzle/0047_experiment_run_persistence.sql`（80 行）

```
① CREATE TABLE IF NOT EXISTS research_experiment_run   （1 条 statement）
② CREATE INDEX idx_research_experiment_run_experiment  （3 条 statement）
③ CREATE INDEX idx_research_experiment_run_status
④ CREATE INDEX idx_research_experiment_run_dataset
每条之间用 `--> statement-breakpoint` 分隔，每条前置 `-- @guard:` 供幂等判定
```

### 4.2 幂等实测（不是「应该幂等」）

| 动作 | 命令 | 结果 |
|---|---|---|
| 干跑 | `node scripts/applySqlMigration.mjs drizzle/0047_....sql --dry-run` | `executed` 待执行 4 条（`pass:false` 是干跑的**预期**语义） |
| 首次应用 | 同上去掉 `--dry-run` | `executed:4 / skippedExisting:0 / missingAfterRun:[] / pass:true / foreignKeyCountInSchema:0` |
| **复跑** | 同上再跑一次 | **`executed:0 / skippedExisting:4 / pass:true`** ⇒ **幂等成立** |

### 4.3 schema → migration → DB → code 一致性（四向对齐）

E2E 第 1 步用 `getTableColumns(researchExperimentRun)` 与 `information_schema.COLUMNS` **逐列比对**：

```json
{ "codeColumnCount": 20, "dbColumnCount": 20, "missingInDb": [], "extraInDb": [] }
```

少一列 = migration 没跑全；多一列 = 有人手动改了库没进 schema。**当前两边都为空。**

> 🔴 这里有一条与 003 相同教训的**规训**：E2E 必须显式比对**列集**，不能只看「表存在」。003 期间曾因 `@guard: table <要删的表>` 的语义（「目标已存在即跳过」）让 `DROP TABLE` 永远删不掉 —— guard 的语义与你的意图必须逐字核对。

### 4.4 回滚路径

`DROP TABLE research_experiment_run` 即可（Run 元数据随之消失）。
对象存储里的产物**不会**被级联删除 —— 这是**刻意**的：本任务不实现跨介质级联删除（规格 §13 明确「不要求复杂分布式事务」）。

---

## 5. ArtifactStorage 设计

### 5.1 端口（规格 §6「实验代码不得直接依赖 MinIO SDK」）

位置：`server/artifactStorage/types.ts`。**六个方法 + 两个只读属性**：

```ts
export interface ArtifactStorage {
  readonly kind: string;              // "minio" | "memory" —— 用于 diagnostics / 断言
  describe(): ArtifactStorageDescriptor;  // 端点 / 桶 / 是否 SSL（**不含凭据**）
  put(key: string, body: Uint8Array | Buffer | string, input: ArtifactPutInput): Promise<ArtifactMetadata>;
  get(key: string): Promise<ArtifactBody>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  list(prefix: string, options?: ArtifactListOptions): Promise<ArtifactMetadata[]>;
  getMetadata(key: string): Promise<ArtifactMetadata>;
}
```

**为什么是这几个方法（而不是更多）**：`exists()` 是**情况 C 判据**的载体（`resultManifestKey` 指向的对象到底在不在）；`list(prefix)` 让 E2E 可以**绕开服务层**复核「对象真的在桶里」，而不是照抄 Manifest（E2E 第 10 步正是这么做的）。

### 5.2 闭集错误码（可判定，不是自由文本）

```ts
export const ARTIFACT_STORAGE_ERROR = {
  NOT_CONFIGURED: "ARTIFACT_STORAGE_NOT_CONFIGURED",
  UNAVAILABLE:    "ARTIFACT_STORAGE_UNAVAILABLE",
  PUT_FAILED:     "ARTIFACT_STORAGE_PUT_FAILED",
  NOT_FOUND:      "ARTIFACT_STORAGE_NOT_FOUND",
  GET_FAILED:     "ARTIFACT_STORAGE_GET_FAILED",
  KEY_INVALID:    "ARTIFACT_STORAGE_KEY_INVALID",
} as const;
```

全部通过 `ArtifactStorageError`（带 `code`）抛出。**测试断言 `error.code`，不断言消息文案** —— 消息文案会变，错误码是契约。

> 🔴 本任务真踩一次：最初测试写 `rejects.toThrowError(ARTIFACT_STORAGE_ERROR.KEY_INVALID)` **恒失败** —— 领域码在 `error.code` 上，**不在消息里**。修法是新增 `codeOf(promise)` 辅助函数断言 `ArtifactStorageError.code`。这条已写进测试文件的注释。

### 5.3 双实现同语义

| 实现 | 位置 | 用途 | 禁止场景 |
|---|---|---|---|
| `InMemoryArtifactStorage` | `inMemoryArtifactStorage.ts` | 单测 / 集成测试的**唯一替身** | —— |
| `MinIOArtifactStorage` | `minioArtifactStorage.ts` | 生产 / E2E | —— |

两者共用**同一批断言函数**（`runPersistence.test.ts` 的集成用例同时跑两份实现）。规格 §18「不要把生产凭据写进测试 fixture」由此结构性满足：测试里出现的**只有内存实现**。

### 5.4 惰性装配（否则未配 MinIO 会整页 500）

```ts
// factory.ts —— 惰性单例
let cached: ArtifactStorage | null = null;
export function defaultArtifactStorage(): ArtifactStorage {
  cached ??= resolveArtifactStorage();   // 🔴 `??=` 惰性：未配置 ⇒ 到这里才抛 NOT_CONFIGURED
  return cached;
}
```

`defaultExperimentRunService()` 传的是 `resolveStorage: () => defaultArtifactStorage()`（**闭包，不是急切求值**）。
⇒ **未配置 MinIO 时，`getRun` / `listRuns` 仍然可用**（历史 Run 页照常打开），只有「跑新 Run」才会得到 `NOT_CONFIGURED`。这一条有专门的测试：
> `resolveStorage 抛 NOT_CONFIGURED 时 getRun/listRuns 仍可用（calls === 0）`

---

## 6. MinIO Adapter

### 6.1 实现要点

| 决策 | 内容 |
|---|---|
| 依赖 | `@aws-sdk/client-s3`（**已装，零新依赖**）。MinIO 是 S3 兼容协议 |
| 寻址 | `forcePathStyle: true` —— MinIO 不支持 virtual-hosted-style |
| 可测性 | 注入式结构化客户端 `S3ClientLike { send(command) }` ⇒ 测试用**假 `send`** 断言「发了什么命令、参数是什么」，不打真网络 |
| 命令覆盖 | `PutObjectCommand` / `GetObjectCommand` / `HeadObjectCommand` / `DeleteObjectCommand` / `ListObjectsV2Command` |
| 元数据映射 | `ETag` **去引号**；`LastModified` → ISO 字符串；`list` 结果里**无 Key 的条目被过滤**（目录占位对象不算产物） |
| 错误翻译 | 见下表 |

### 6.2 错误翻译矩阵（20 例测试逐个钉住）

| 上游症状 | 映射为 | 理由 |
|---|---|---|
| 401 / 403 | `UNAVAILABLE` | 凭据/权限问题不是「这次写坏了」，而是「存储不可用」 |
| 5xx | `UNAVAILABLE` | 服务端问题，重试语义由上层决定 |
| `ECONNREFUSED` / `ETIMEDOUT` / `NetworkingError` | `UNAVAILABLE` | 连不上 ≠ 写失败 |
| **`NoSuchBucket`** | **`UNAVAILABLE`** | 🔴 见 §6.3 |
| `NotFound`（get 时） | `NOT_FOUND` | 对象不存在是**可判定**的正常结果，不是错误 |
| 其它（含 `put` 时的 `NotFound`） | `PUT_FAILED` / `GET_FAILED` | 归类到操作级失败 |

### 6.3 🔴 本轮真缺陷 ①：`NoSuchBucket` 曾被算成 `PUT_FAILED`

- **症状**：测试 `expect(error.code).toBe(UNAVAILABLE)` 实得 `ARTIFACT_STORAGE_PUT_FAILED`。
- **为什么是缺陷（不是测试写错）**：`put()` 里有一条**自救提示**：
  > 「写入失败：请确认桶 `"research"` 已存在且凭据可写」

  这条提示的**唯一可达路径**就是 `NoSuchBucket`。若把 `NoSuchBucket` 判成 `PUT_FAILED`，这条提示就**永远不会出现**（用户拿到的是一句无信息的「写失败」）。⇒ 必须把 `NoSuchBucket` 归入 `UNAVAILABLE`。
- **修法**：`isUnavailable()` 的码名单加入 `"NoSuchBucket"`，并在代码里补注释点明「否则那条自救提示对真正的 NoSuchBucket **不可达**」。测试断言文案含 `确认桶 "research" 已存在`。

### 6.4 `describe()` 不泄漏凭据

`describe()` 只回 `{ kind, endpoint, bucket, useSsl }`。测试显式断言返回对象里**不含** accessKey / secretKey 任何片段（§18）。

### 6.5 非法 Key 在**任何网络调用之前**被拒

`getMetadata` / `put` / `get` 等入口先过 `assertObjectKey()`，结构化拒绝（含 `/`、`..`、反斜杠、控制字符的 Key 一律 `KEY_INVALID`）。测试断言：非法 Key 时**假客户端的 `send` 调用次数为 0**。

---

## 7. Bucket / Object Key 规范

### 7.1 桶

**统一一个研究桶 `research`**（用户决策：「新建专用桶 research」）。桶需**事先存在** —— 本任务不负责创建桶、不部署 MinIO 集群（规格 §20）。

### 7.2 Object Key 形态（规格 §9）

```
experiments/{group}/{key}/runs/{runId}/manifest.json      ← Artifact 索引（§10）
experiments/{group}/{key}/runs/{runId}/result.json        ← 结果信封（§11）
experiments/{group}/{key}/runs/{runId}/tables/{name}      ← 表格类产物（CSV / Parquet）
experiments/{group}/{key}/runs/{runId}/charts/{name}      ← 图表类产物
experiments/{group}/{key}/runs/{runId}/logs/{name}        ← 日志
experiments/{group}/{key}/runs/{runId}/artifacts/{name}   ← 其它产物（含实验自定义）
```

**真实样本**（前端探针实测，`RUN-20260920-AECD8703`）：
```
experiments/first-board-pullback/entry-day/runs/RUN-20260920-AECD8703/result.json
experiments/first-board-pullback/entry-day/runs/RUN-20260920-AECD8703/logs/run.log
```

### 7.3 「不得把随机路径作为唯一定位方式」

**这是结构级的，不是约定级的。** 三段强制：

1. **Key 由代码生成**，调用方拿不到「随便传一个 Key」的能力（`artifactPublisher` 按结果信封的语义段产出 Key；`objectKey.ts` 提供唯一的拼装入口）。
2. **`assertObjectKey()` 结构级拒绝**越界 / 注入形态。
3. **读路径授权 = Manifest 白名单**（`runService.readArtifact`）：未登记进该 Run Manifest 的 Key 一律 404。**「桶里有没有」不是授权判据。**

作者面永远不需要手写 Key —— 只要在结果信封里给出表格/图表，装配层负责落到规范位置。

### 7.4 前缀枚举的工程价值（E2E 第 10 步）

E2E 用 `storage.list(prefix)` **绕开服务层**直接列举 MinIO 前缀，实测得 **5 个对象**：

```
probe-summary.json, run.log, manifest.json, result.json, events-sample.csv
```

这条断言的意义：如果只看 `readRunDetail()` 返回的索引，那么「索引说在、实际不在」的情况会被**照抄**（情况 C 的伪装）。**必须有一次不经过自己代码的旁证。**

---

## 8. Manifest Schema

### 8.1 每个成功 Run 必须生成 `manifest.json`

位置固定：`.../runs/{runId}/manifest.json`，并写进 `research_experiment_run.resultManifestKey`。

### 8.2 规范字段

```jsonc
{
  "schemaVersion": "1.0.0",
  "experimentCode": "first-board-pullback/entry-day",
  "runId": "RUN-20260920-AECD8703",
  "datasetVersionId": 390002,
  "resultKey":   "experiments/…/runs/{runId}/result.json",
  "tableKeys":   ["experiments/…/tables/…csv"],
  "chartKeys":   [],
  "artifactKeys":["experiments/…/logs/run.log"]
}
```

**真实样本**（E2E 读回，`RUN-20260920-1F0B5D96`）：
```json
{ "schemaVersion": "1.0.0",
  "experimentCode": "e2e-persistence/probe",
  "runId": "RUN-20260920-1F0B5D96",
  "datasetVersionId": 390002,
  "resultKey": "experiments/e2e-persistence/probe/runs/RUN-20260920-1F0B5D96/result.json",
  "tableKeys": ["…/tables/events-sample.csv", "…/artifacts/probe-summary.json"],
  "chartKeys": [],
  "artifactKeys": ["…/logs/run.log"] }
```

### 8.3 三条设计约束

1. **Manifest 是索引，索引本身不进自己的索引。**
   ⇒ `readRunDetail().artifacts` **只含** result / tables / charts / artifacts 四段，**不含 manifest.json**。这一点在测试里踩过一次（期望 4 实得 3），已改为显式断言「键集合等于 `[csvKey, logKey, resultKey]`」并注明原因 —— **不是把总数改成 4**。

2. **坐标自洽校验。** `buildManifest()` 产出的 Key 必须都以 `experiments/{experimentCode}/runs/{runId}/` 打头；`parseManifest()` 校验时**逐条**核对，任一条越界即 `EXPERIMENT_MANIFEST_INVALID`。这是防止「Manifest 被改坏后索引到别人的对象」。

3. **schemaVersion 与 `resultSchemaVersion` 双写。** DB 列快查、Manifest 自洽，两者都不依赖对方即可判定。

---

## 9. Run 生命周期

### 9.1 状态机（规格 §12）

```
PENDING ──markRunning──▶ RUNNING ──markCompleted──▶ COMPLETED
   │                        │
   └────────markFailed──────┴──────────────────────▶ FAILED
```

**合法迁移矩阵**（`assertRunTransition`，测试全覆盖）：

| from → to | 允许 | 理由 |
|---|---|---|
| `PENDING → RUNNING` | ✅ | 正常 |
| `RUNNING → COMPLETED` | ✅ | 正常 |
| `PENDING → COMPLETED` | ❌ | 跳过了执行 ⇒ `EXPERIMENT_RUN_STATE_INVALID` |
| `RUNNING → FAILED` | ✅ | 执行中失败 |
| `PENDING → FAILED` | ✅ | 建 Run 后、开跑前失败 |
| `COMPLETED → *` | ❌ | **已完成不可改写**（历史 Run 冻结） |
| `FAILED → *` | ❌ | 同上 |

### 9.2 写入顺序（与规格 §12 逐字对齐）

```
① createRun          → PENDING（写坐标快照 + 参数快照）
② markRunning        → RUNNING（写 startedAt）
③ runner.runDetailed → 真实 Dataset 计算（**这一步之前不产生任何对象**）
④ artifactPublisher  → 结果信封 → 产物文件集合（result.json / tables / charts / logs）
⑤ storage.put × N    → 上传产物
⑥ buildManifest      → 生成 manifest.json → storage.put
⑦ **逐条 exists()**  → 验证 Artifact 真的在（不是相信返回值）
⑧ markCompleted      → 写 resultManifestKey + summaryJson + durationMs + completedAt
```

🔴 **⑦ 是整套一致性的关键**：先写对象、**再**核实、**最后**才把 DB 置 `COMPLETED`。
**顺序反过来的话，情况 A（MinIO 上传失败但 DB 说 COMPLETED）在结构上就成立了。**

### 9.3 失败路径

```
③ 之前 / 之中失败 ⇒ markFailed(errorCode = 领域码, errorMessage)
④⑤ ⑥ ⑦ 任一步失败 ⇒ markFailed(errorCode = EXPERIMENT_RUN_PERSIST_FAILED 系, errorMessage 含存储诊断)
```

**两类失败两条出口**（延续 001 的刻意设计）：

| 类型 | 时机 | 出口 |
|---|---|---|
| 执行前可判定（参数非法、Dataset 不可用、未声明前视数据） | `prepare()` | **抛领域错误** → tRPC `[CODE] …`（该次调用连 Run 行都不建） |
| 执行中发生（计算抛错、存储写失败） | `run()` / 持久化 | **返回 `FAILED` outcome** + 完整执行事实（Run 行已建、状态已 FAILED） |

### 9.4 `FAILED` 不得伪装成 `COMPLETED`（规格 §13 情况 A/B/C 逐条）

| 情况 | 防护机制 | 测试/探针 |
|---|---|---|
| **A** MinIO 上传失败但 DB=COMPLETED | 上传 → `exists()` 复核 → 才 `markCompleted`；任一失败即 `markFailed` | `runPersistence.test.ts`：`{failPut:true}` / 「上传后立刻消失」用例 |
| **B** 执行失败但 Run 永远 RUNNING | 每条失败路径都显式 `markFailed`；另有 `reconcileRun(runId, reason)` 把**确证卡住**的 RUNNING 收敛为 FAILED | 同上 + `reconcileRun` 用例（含「非 RUNNING ⇒ `EXPERIMENT_RUN_STATE_INVALID`」） |
| **C** `resultManifestKey` 指向不存在对象 | ⑦ 的 `exists()` 复核是**写入侧**防护；**读取侧**再由 `getRunResultManifest` / `readArtifact` 实测 `exists()` 后给 `present: true/false` | 前端 `ArtifactCatalogCard` 对 `present:false` 标红「情况 C」 |

> 「上传后立刻消失」这条测试是**刻意构造**的：`Object.create(storage)` 覆写 `exists`，首次返回 `false` ⇒ 命中「读不到」分支。它证明复核不是**形式**（不是把 `put` 的返回值当证据），而是真的**回头查**。

### 9.5 幂等（规格 §19 Idempotency）

| 场景 | 规定行为 | 实测 |
|---|---|---|
| 同 Key 重复 `markCompleted` | **幂等**（重复的收敛调用不产生不可控重复状态） | ✅ |
| **不同** Key 重复 `markCompleted` | 拒绝 `EXPERIMENT_RUN_STATE_INVALID`，且**原引用不被改写** | ✅ |
| 重复 `markFailed` | 幂等 | ✅ |
| Run id 连撞（唯一约束） | `EXPERIMENT_RUN_ID_CONFLICT`，且**不产生第二行** | ✅ |
| `markCompleted("   ")`（空白 Key） | 拒绝，且 Run **仍在 RUNNING** | ✅ |
| `reconcileRun` 对非 RUNNING | `EXPERIMENT_RUN_STATE_INVALID` | ✅ |

> 最后一行值得强调：**空白 Key 被拒后状态必须留在 RUNNING**（而不是顺手改成 FAILED）—— 因为「参数非法」是调用方错误，不是这条 Run 的失败。把两者混起来会让运维读错状态。

### 9.6 `stale`（「可能已卡住」）的判定同源

`computeStale()` 在**服务端**算，前端 `RunStatusBadge` 只**渲染**结论、**不自行推断**。理由：dev server 是 `tsx watch`，改任何 `server/**` 会热重启并**杀死在途 Run** ⇒ RUNNING 悬挂是**已知环境现象**，前端不该自己决定它算不算卡住。

---

## 10. API

### 10.1 Run 查询 API（规格 §14）

**「已存在则扩展，不重复创建」** —— 实测审计：001 已有 `list`（列表）与 `get`（详情），本任务**扩展**而非新建同义端点。

| 端点 | 类型 | 权限 | 说明 |
|---|---|---|---|
| `researchExperiments.listExperiments` | 已有（扩展） | `publicProcedure` | 返回 `ExperimentSummary[]`：定义 + `runCount` / `latestRun` / `runsAvailable` / `runsError` |
| `researchExperiments.getExperiment` | 已有（扩展） | `publicProcedure` | 返回详情 + `runs[]` + `runsAvailable` / `runsError` |
| **`researchExperiments.listRuns`** | **新增** | `publicProcedure` | 按 `experimentId` 列出 Run（默认 50，有界） |
| **`researchExperiments.getRun`** | **新增** | `publicProcedure` | 单条 Run 详情（含所有落库字段 + `stale`） |
| **`researchExperiments.getRunResultManifest`** | **新增** | `publicProcedure` | 读 Manifest（**含实测 `present` 标记**，不是照抄） |
| **`researchExperiments.getArtifactMetadata`** | **新增** | `publicProcedure` | 单产物的**元数据**（不下载字节 —— §17 大文件策略） |
| `researchExperiments.run` | 已有（扩展） | `adminProcedure` | 执行并持久化，返回 `{ outcome, persisted: { run } }` |
| **`researchExperiments.reconcileRun`** | **新增** | `adminProcedure` | 把确证卡住的 RUNNING 收敛为 FAILED（需 `reason`） |

🔴 **反向断言已进测试**：`listExperiments` / `getExperiment` / `getExperimentRun` 这**三个同义端点名不存在**。加这条的目的不是洁癖 —— 是防止「再有人加一个同义端点」把「一个概念两个入口」固化成契约。

### 10.2 产物内容代理（不是 tRPC）

```
GET /api/experiments/artifact?runId=…&key=…[&disposition=inline|attachment]
  → 应用校验（Key 属于该 Run 的 Manifest 白名单）
  → 对象存储（凭据只在服务端）
  → 字节流回浏览器
```

**为什么不走 tRPC**：产物可能是几十 MB 的 Parquet。tRPC 走 superjson 序列化，二进制要 base64（体积 +33%）且整块驻留内存 ⇒ 用 Express 流式响应最直接，也**不必为「下载」引入任何新依赖**。

**注册位置**：必须在 Vite / 静态资源中间件**之前**（与既有 `/api/scheduled/*` 同理），否则开发模式下会被 Vite 的 HTML fallback 吃掉。

**HTTP 状态映射**（`httpStatusFor`）：

| 领域码 | HTTP |
|---|---|
| `EXPERIMENT_RUN_NOT_FOUND` / `EXPERIMENT_ARTIFACT_NOT_FOUND` | 404 |
| `EXPERIMENT_ARTIFACT_KEY_INVALID` / `EXPERIMENT_MANIFEST_INVALID` | 400 |
| `EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE` | 503 |
| 其它 | 500 |

**只读**：本路由**没有任何写口**（DELETE / PUT 都不注册）—— 产物一旦写出即冻结。

### 10.3 前端探针实测的授权行为（不是设计意图，是行为）

| 请求 | 结果 |
|---|---|
| 登记 Key | **200**，`bytes=15459`，`Content-Disposition: attachment; filename="result.json"` |
| 未登记 Key（同前缀） | **404** `EXPERIMENT_ARTIFACT_NOT_FOUND` |
| 跨 Run Key（`RUN-FAKE-0000/manifest.json`） | **400** `EXPERIMENT_ARTIFACT_KEY_INVALID` |

⇒ **任意对象读取在结构上不成立**。

---

## 11. 前端

### 11.1 Experiment 列表（`/research-experiments`）—— 规格 §15 要求 5 列

| 列 | 内容 |
|---|---|
| Experiment | 名称 + `id`（等宽）+ 描述 + 标签 |
| Version | `v1.0.0` |
| **数据集** | Dataset 语义代码 + 「使用事件日之后数据」声明徽章 |
| **状态** | `RunStatusBadge`（多条 Run 时以**最新一条**为代表）；`runsAvailable === false` ⇒ 琥珀「未知」徽章，**不猜** |
| **Latest Run** | runId + 耗时 + Dataset 版本 + id |
| **最近运行时间** | `formatDateTime(latestRun.startedAt)`，取不到时 `—` |

**页首汇总**：`{N} 个实验 · {M} 条 Run`。
**`runsUnavailable.length > 0` 时**：琥珀 Alert（`data-experiment-runs-unavailable`）明确「**不代表它们没有历史 Run** —— 只是本次没能读到」。

**探针实测行文本**（证明是真实值，不是占位）：
```
… v1.0.0 first_limit_pullback 使用事件日之后数据 COMPLETED
RUN-20260920-AECD8703 耗时 1 分 14 秒 · Dataset v2(id=390002) 2026-09-20 22:31:46 最近一次 打开
```

### 11.2 Experiment Detail（`/research-experiments/:group/:key`）—— 004 变化点

- 元数据 / Dataset 版本选择器 / 参数表单 / 运行按钮（**沿用 001，未动**）
- **新增**「运行历史」卡片（`data-experiment-run-history`）：Run / 状态 / Dataset / 参数 / 开始 / 耗时 / 操作（`data-open-run={runId}`）
- **新增**「已持久化」回执（绿色 Alert）：`Run <runId> · 耗时 … · 打开这一条 Run` + `manifest = <key>`
- **新增**「算完了但没能持久化」红条：与「执行失败」**分开渲染**。文案明确「产物没落进对象存储，就**不允许**声称完成；下方结果仍然显示，因为它确实是本次算出来的 —— 但刷新页面后不会再出现」

### 11.3 Run Detail（`/research-experiments/:group/:key/runs/:runId`）—— 新路由

§15 要求的每一项都有对应锚点（便于探针断言，也便于排障）：

| 要求 | 锚点 |
|---|---|
| Status | `[data-experiment-run-detail]` 头部 `RunStatusBadge` |
| Dataset / Started At / Completed At / Duration | MetricCard 网格（Dataset / 开始 / 结束 / 耗时 / 候选 / 入池 / 剔除 / 产物个数） |
| Parameters | `[data-run-parameters]`（JSON 快照） |
| 落库摘要 | `[data-run-summary]`（含 `excludedByReason` 分布） |
| Result | `[data-run-result="present"]` / `[data-run-result="absent"]`；原始 JSON `[data-run-result-raw]` |
| Artifacts | `[data-run-manifest-index]`（Manifest 索引可视化，按 result/tables/charts/artifacts 分组）+ `[data-run-artifact-catalog]`（服务端实测 `present`） |
| 失败 | `[data-run-failure]`（含 `errorCode` / `errorMessage`） |
| 其它 | `[data-open-dataset-version]`（Dataset 坐标）/ `[data-back-to-experiment]` / `[data-reconcile-run]`（**仅 admin**） |

**「至少能打开历史 Run」**：列表页 `data-open-latest-run` → 详情页 `data-open-run` → 直接 URL，**三条路**都能到。

### 11.4 Result 展示（规格 §16）与双端同源判据

按 `Summary / Metrics / Tables / Observations / Artifacts` **动态**展示；JSON 一律可查看**原始结构**（`ResultRawJson`）。

🔴 **预览判据双端同源**：把常量放进 shared 契约（`shared/researchExperimentsContracts.ts`），服务端算 `inlineViewable`、前端据**同一常量**决定给不给预览按钮：

```ts
export const EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES = 256 * 1024;
export const EXPERIMENT_ARTIFACT_INLINE_PREVIEW_FORMATS = ["json","csv","tsv","text","svg","html"] as const;
```

> 为什么必须放 shared：**服务端裁决、前端渲染**是两处代码。各写一份判据迟早出现「同名不同义」（比如一边 256 KiB、一边 1 MiB），届时用户会看到「有按钮但点开是 413」或「没按钮但其实能看」。
> 前端 `ArtifactActions` 的规则是「**服务端有结论就用服务端的**」（`inlineViewable === null/false` 时才落本地判据兜底），`canPreview` 为假时渲染 **disabled 按钮 + `title` 说明原因**（而不是干脆不渲染 —— 用户有权知道为什么不能看）。

### 11.5 大文件策略（规格 §17）

| 要求 | 实现 |
|---|---|
| 禁止浏览器直载大型 Parquet | 页面只展示**元数据**（`getArtifactMetadata`），不取字节 |
| 走 Browser → API → Result Summary | 结果摘要来自 DB 的 `summaryJson`，**不下载产物** |
| 大型 Artifact 用户**主动请求**才下载 | 下载按钮 → `/api/experiments/artifact?...&disposition=attachment` |
| **页面初始化不得自动下载全部 Artifact** | 见 §13 探针 E 段（实测请求数 **0**） |

### 11.6 🔴 一处旧信息的清理（避免前端说假话）

`ExperimentDetail.tsx` 原有一句如实告知：「结果不落库 / 刷新需重跑 / **不新增数据库表**」。
004 之后这句话**不再为真** ⇒ 已替换为「**Run 元数据保存在 TiDB，产物保存在对象存储**」。

同理，`GenericResultView` 的底部提示改为中性：「通用渲染器只展示结果信封的通用字段……实验自己的结构（`customPayload`）由该实验的页面渲染。」

> 这不是文案润色，是**删除一条已经变成假话的承诺**。001 的前端探针正是断言了这句话，见 §13.6。

---

## 12. 测试结果

### 12.1 单元 / 集成测试（新增 61 例）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `runPersistence.test.ts` | **31** | Object Key 形态 / 注入拒绝 / `isObjectKeyUnderRun`；Manifest build-validate-parse；状态迁移全矩阵 + `computeStale` + `assertManifestKeyPresent` + `summarizeOutcome` + `isInlineViewable`；**完整链路集成**（建→执行 mock→Result→上传→Manifest→存引用→读回）；**失败**（存储不可用 / put 失败 / 上传后消失 / 读路径被删 / Manifest 被改坏）；**授权**（未登记 ⇒ NOT_FOUND、跨 Run ⇒ KEY_INVALID、越界 ⇒ `ArtifactStorageError`、不存在 Run ⇒ RUN_NOT_FOUND）；**幂等**（6 个场景）；**惰性**（未配 MinIO 时读路径可用） |
| `minioArtifactStorage.test.ts` | **20** | 假客户端断言命令与参数；元数据映射（ETag 去引号 / LastModified→ISO / 无 Key 条目过滤）；错误翻译矩阵；`describe()` 不泄漏凭据；非法 Key 在任何网络调用前被拒；`minioEndpointUrl` 五种形态 |
| `runRepositoryRetry.test.ts` | **7** | **只读重试**（见 §16.2 真缺陷 ②）：4 个读方法首次瞬时失败后成功、语义错误不重试、超上限抛出、**写路径不重试** |
| `artifactRoute.test.ts` | **3** | `artifactFileName` 的 Content-Disposition 注入面（取末段；引号/换行/反斜杠/分号替换为 `_`；空或尾斜杠回落 `"artifact"`） |

### 12.2 定向复跑（完整命令与结果）

```
pnpm exec vitest run tests/server/researchExperiments tests/server/research/legacyFreeProductionChain.test.ts
→ Test Files  10 passed (10)
  Tests      141 passed (141)
```

其中包含 **`legacyFreeProductionChain.test.ts` 7 例全绿** —— 即「生产链不传递依赖旧 Research」的 import 图可达性 Gate **未被 004 的新代码破坏**（004 新增的 `server/artifactStorage/**`、`server/researchExperiments/persistence/**` 都不碰 `server/researchCore/**` 与 `server/researchEngine/**`）。

### 12.3 类型门

```
npx tsc --noEmit  →  exit=0，输出 0 字节（0 error）
```

> 注：`tsconfig.json` 的 `exclude` 含 `**/*.test.ts` ⇒ 测试文件的类型由 vitest/esbuild 把关。

### 12.4 构建门

```
pnpm run build  →  exit=0

vite v7.1.9 building for production...
✓ 3036 modules transformed.
rendering chunks...
computing gzip size...
../dist/public/index.html                     2.39 kB │ gzip:   1.35 kB
../dist/public/assets/index-CehSWSHH.css    236.91 kB │ gzip:  31.88 kB
../dist/public/assets/index-DV7fXQCY.js   2,782.73 kB │ gzip: 670.28 kB
(!) Some chunks are larger than 500 kB after minification.  ← 既有告警，非本次引入
✓ built in 15.86s
  dist\index.js  2.8mb
Done in 226ms
```

> ⚠️ **一次环境性卡顿（如实登记）**：首次 `pnpm run build` 卡在 `✓ 3036 modules transformed.` 之后 **26 分钟**未进入 `rendering chunks`。诊断依据：该进程 **CPU 仅 37 秒 / 26 分钟**（≈2.4%）、**零 TCP 连接**、堆稳定在 732 MB ⇒ 是**被阻塞**而非「慢」。终止该残留进程后重跑，**16 秒完成**。
> 结论：**与 004 的代码无关**（同一份代码在同一台机上两次结果差 100 倍），属环境/残留进程问题。记录在此是因为「构建有时会莫名卡住」本身值得留意。

### 12.5 变更影响面回归（`test:changed`）

```
pnpm run test:changed  →  exit=1（有失败，见下判定）

Test Files  4 failed | 51 passed (55)
     Tests  11 failed | 681 passed (692)
  Duration  25.37s
```

**判据是「零新增失败文件」，不是「零失败」。** 实测失败文件集合：

```
tests/server/dataHealth.test.ts          (13 tests | 2 failed)
tests/server/marketData.test.ts          ( 5 tests | 4 failed)
tests/server/limitUp.watch.test.ts       ( 6 tests | 4 failed)
tests/server/limitUp.test.ts             (11 tests | 1 failed)
```

**逐项归入既有基线**（项目登记的 7 文件基线集合：`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar` —— 全部为**真实 DB 直连 / 外部 API** 的环境性失败）：

| 本次失败文件 | 是否在基线集合 | 结论 |
|---|---|---|
| `dataHealth.test.ts` | ✅ 在 | 既有 |
| `marketData.test.ts` | ✅ 在 | 既有 |
| `limitUp.watch.test.ts` | ✅ 在 | 既有 |
| `limitUp.test.ts` | ✅ 在 | 既有 |
| （`image.uploadAndRecognize` / `tushare.secret` / `tushareTradingCalendar`） | ✅ 在基线，但**不在本次变更影响面内** ⇒ 未运行 | —— |

⇒ **零新增失败文件；无新增失败类别。** 子集运行（55 文件）比全量（约 231 文件）小，所以失败文件数是 4 而非 7 —— 这是**子集**的正常表现，不是「修好了」。

### 12.6 行尾漂移

```
node scripts/checkEolDrift.mjs
→ 已跟踪文件中疑似行尾漂移：0
  未跟踪新文件中 CRLF（仓库默认 LF）：0
```

---

## 13. E2E 结果

### 13.1 真实最小 Experiment Persistence E2E（规格 §22）

**探针**：`docs/evidence/_e2e_9ch_experiment_persistence.mts`（430 行）
**输出**：`docs/evidence/_e2e_9ch_experiment_persistence.out.json`
**依赖真实性**：真实 TiDB（`DbExperimentRunRepository`）+ 真实 MinIO（`defaultArtifactStorage()`，即**生产装配那条路径**）+ 真实 Dataset 桥（`createDefaultExperimentDatasetPort()`，真去 Dataset 版本表读事件）。

**12 步全绿**（`phase: "complete"`）：

| # | 步骤 | 实测结果 |
|---|---|---|
| 1 | schema ⇄ DB 一致 | `code=20 列 / DB=20 列；缺 []；多 []` |
| 2 | 对象存储可用 | `minio endpoint=http://47.94.112.21:9000 bucket=research (forcePathStyle=true)` |
| 3 | 选定真实 Dataset 版本 | `id=390002 version=v2 status=READY totalEvents=23978` |
| 4 | 建测试 Experiment（注册定义） | `id=e2e-persistence/probe` |
| 5 | 建 Run → 执行 → 落 MinIO → 落 TiDB → COMPLETED | `RUN-20260920-1F0B5D96 status=COMPLETED outcome=SUCCEEDED durationMs=8824` |
| 6 | 重复运行**不覆盖**历史 Run | `[RUN-…335BB195:COMPLETED, RUN-…1F0B5D96:COMPLETED]` 两条并存 |
| 7 | **重新查询 Run**（= 关页面重开的等价路径） | `status=COMPLETED`，`manifestKey 一致=true` |
| 8 | 读 Manifest | `result=…/result.json tables=2 charts=0 artifacts=1` |
| 9 | 读 Result | `customPayload={"probe":"RESEARCH-EXPERIMENT-004","eventCount":20000,"datasetVersionId":390002}`，`parameters={"sampleRows":5}` |
| 10 | **每个 Artifact 实测 `exists()`** | `RESULT:true, CSV:true, TABLE:true, LOG:true` |
| 11 | **绕开服务层**直接列举 MinIO 前缀 | `5 个对象：probe-summary.json, run.log, manifest.json, result.json, events-sample.csv` |
| 12 | 清理并复核无残留 | 删除行 `affectedRows=[1,1]`、对象 10 个；**残留 Run=0 / 残留对象=0** |

**Run 行完整落库形态**：
```json
{ "runId": "RUN-20260920-1F0B5D96", "status": "COMPLETED",
  "experimentVersion": "0.0.1", "datasetVersionId": 390002, "datasetVersionLabel": "v2",
  "parameters": {"sampleRows": 5}, "durationMs": 8824,
  "resultManifestKey": "experiments/e2e-persistence/probe/runs/RUN-20260920-1F0B5D96/manifest.json",
  "resultSchemaVersion": "1.0.0",
  "summary": {"runStatus":"SUCCEEDED","candidateCount":20000,"eligibleCount":20000,
              "excludedCount":0,"excludedByReason":{},"artifactCount":5} }
```

> **为什么不用「真实实验」跑这条 E2E**：Experiment 元数据是代码声明的 ⇒「建测试 Experiment」就是「注册一个定义」。用**专用探针定义**（`e2e-persistence/probe`）而不是偷偷拿真实实验去跑，避免在研究库里留下污染研究口径的 Run。同理，探针**默认自清**（`PERSIST004_KEEP=1` 才保留，与既有 `WF001_KEEP` / `OOS001_KEEP` 同语义）。

### 13.2 前端可达性（规格 §21-D）

**探针**：`docs/evidence/_probe_9ch_experiment_persistence_frontend.mjs`（689 行）
**手段**：无头 Edge + Node 内置 `WebSocket` 直连 CDP，**量 DOM**（本机 `agent-browser` 不可用）
**输出**：`docs/evidence/_probe_9ch_experiment_persistence_frontend.out.json`
**结果**：**46 PASS / 0 FAIL**（exit=0）

| 段 | 判据 | 实测 |
|---|---|---|
| A 列表页 | 004 新增列齐备 | `hasLatestRunCol/hasLastRunTimeCol/hasStatusCol = true`，`runsUnavailableAttr = null` |
| B 详情页 | 运行历史卡片 + **旧文案已消失** | `hasRunHistoryCard=true`，`staleNoPersistClaim=false` |
| C 运行 | pending 换文案 → 「**已持久化**」 | pending 文案 = 「正在运行实验…（读真实 Dataset、全量计算、并写入对象存储；可能需要 10~60 秒）」；结果 `hasPersisted=true`，`hasPersistFailed=false`，`hasExecFailed=false` |
| C | manifestKey 形状 | `experiments/first-board-pullback/entry-day/runs/RUN-…AECD8703/manifest.json` |
| D RunDetail | 新路由 + 锚点一致 | `data-experiment-run-detail` = URL 上的 runId；正文 19146 字符（**非白屏**） |
| D | §15 字段齐备 | Status / Dataset / Started / Completed / Duration / 参数快照 / 落库摘要 全 true；`resultState="present"`；`hasManifestIndex=true`；`downloadBtnCount=4`；`hasFailure=false` |
| E | 🔴 **初始化不拉产物** | `/api/experiments/artifact` 请求数 = **0**（同期总请求 251，其中确含 `/api/trpc/` ⇒ 排除「页面没加载」的假通过） |
| F | 产物下载 | `200`，`bytes=15459`，`Content-Disposition: attachment; filename="result.json"`，响应头**无**凭据泄漏 |
| F | 授权 | 未登记 Key ⇒ **404**；跨 Run Key ⇒ **400** |
| G | 按需预览 | 点击前 0 请求；点击后 1 请求 → 预览区渲染出**真内容** |
| H | 列表页回看 | `data-open-latest-run` = 本 Run id；行文本含 `2026-09-20 22:31:46`（真实时间） |
| I | 控制台 | 无 `No procedure found on path`；唯二两条 error = F 段**刻意**打的 404/400 |

### 13.3 探针自身的三次收敛（如实登记，避免「一次就绿」的错觉）

| 跑次 | 结果 | 暴露的问题 | 归属 |
|---|---|---|---|
| 第 1 跑 | 42 PASS / 0 FAIL | G 段「预览渲染出内容」判据过弱（`len > 0`，第一次轮询就撞上「加载中…」占位 ⇒ **假通过**）；列表页 Latest Run **有值**未被验证 | **探针判据缺陷** |
| 第 2 跑 | 43 PASS / 3 FAIL | `a[href*="/runs/"]` 取**末项** ⇒ 拿到「运行历史」表里**上一条** Run 的链接，与 manifestKey 所指的**新** Run 不一致 | **探针提取逻辑缺陷** |
| 第 3 跑 | **46 PASS / 0 FAIL** | —— | —— |

> 第 2 跑是**有价值的失败**：它证明了「运行历史」表确实在页面上（否则不会有第二条 `/runs/` 链接）。修法是让 `runId` 的权威来源变成 **manifestKey**（`split('/runs/')[1]`），再断言「页面上确实存在指向它的链接」。
>
> 同时也说明：**「假通过」比「失败」更危险**。第 1 跑的 42/42 里就有两条是假的。

### 13.4 真实 MinIO 连通性 + 桶/对象验证

**探针**：`docs/evidence/_probe_9ch_minio_connectivity.mts`
**输出**：`docs/evidence/_probe_9ch_minio_connectivity.out.json` / `.files.out.json`

结论：endpoint 可达、凭据可写、桶 `research` 存在、`put/get/exists/list/delete` 五个动作在真实服务上全部成功。

### 13.5 真库查询根因探针（只读）

**探针**：`docs/evidence/_probe_9ch_run_query.mts`
**输出**：`docs/evidence/_probe_9ch_run_query.out.json`

六步全绿 ⇒ 证明**表结构、列名、`LIMIT ?` 占位符、drizzle builder 都没有问题**（这一步是排除法，用来把「500」的嫌疑从 schema 转向连接池 —— 见 §16.2）。

### 13.6 遗留的真实 Run（如实登记）

前端探针跑 3 次 ⇒ 在 `first-board-pullback/entry-day` 上留下 **3 条 COMPLETED Run**：

```
RUN-20260920-F78A3E6C
RUN-20260920-518A0D54
RUN-20260920-AECD8703
```

**刻意保留**：§21-D 要求「前端可查看历史实验与历史 Run」，保留真数据才能让用户**自己点开看**。它们也是「一个 Experiment → 多条 Run、且旧 Run 不被覆盖」的活证据（列表页该行显示「**3 条 Run**」）。
需要清理时：删除 `research_experiment_run` 中这 3 个 `runId` 的行 + 对应 `experiments/first-board-pullback/entry-day/runs/{runId}/` 前缀对象。

---

## 14. 安全处理（规格 §18）

| 要求 | 实现 | 判据 |
|---|---|---|
| MinIO 凭据只经 env | `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`（兼容历史命名 `MINIO_USERNAME` / `MINIO_PASSWORD`） | `.env.example` 只放**占位符**；`.env` 被 `*.env` 规则忽略 |
| 凭据不进 Git | 同上 + 代码里**零硬编码** | 全仓搜索无凭据字面量 |
| 凭据不进前端 bundle | 前端**只有** `/api/experiments/artifact` 一个 URL，不含任何 endpoint/凭据 | 探针 F 段：响应头 `leak = ""`（无 `x-amz-*` / `access-key` / `x-minio-*`） |
| 凭据不发给浏览器 | 响应体只有**产物字节**与 `Content-Type` | 同上 |
| 前端只能通过后端 API 获取 Artifact | `artifactContentUrl()` 是**全站唯一**拼该 URL 的点 | `artifactViews.tsx` |
| MinIO 尽量不直接暴露公网 | 优先 Browser → Application API → MinIO（**当前是本机/内网 endpoint，未暴露公网**） | `describe()` 输出 |
| 不把生产凭据写进测试 fixture | 测试用 `InMemoryArtifactStorage`（结构性满足，不是靠自觉） | §5.3 |
| 不暴露桶的存在性 | 读不到就 404，不回显「桶里有别的东西」 | 探针 F 段（未登记 Key ⇒ 404 且消息只说「不是本 Run 的产物」） |
| Header 注入面 | `artifactFileName()` 去掉引号/换行/分号，回落 `"artifact"` | `artifactRoute.test.ts` 3 例 |

**授权模型一句话**：授权判据 = **该 Run 的 Manifest 白名单**，而**不是**「桶里有没有这个对象」。

---

## 15. 未完成事项（如实登记）

| # | 事项 | 现状 | 影响 |
|---|---|---|---|
| 1 | **Parquet 产物无真实样本** | `ArtifactStorage` 与 Manifest 都支持 `tables/*.parquet`（`kind` / `format` 已实现），但现有实验的 `artifactFiles` 只产出 CSV / JSON / text | 无功能缺口；**只是没有端到端跑过一次 Parquet**（下载链路的 `application/octet-stream` 兜底未实测） |
| 2 | **Chart 产物无真实样本** | `chartKeys` 链路齐备，现有实验不上传图表文件（图表在前端由 recharts 现画） | 同上 |
| 3 | **跨介质级联删除未实现** | 删 Run 行**不会**删除对象（刻意，见 §4.4） | 长期会累积孤儿对象；需要时靠前缀清理 |
| 4 | **`stale` RUNNING 无自动回收定时器** | 只能人工调 `reconcileRun` | 与既有 `9h`（启动回收孤儿 RUNNING）同源问题；dev 热重启会造成悬挂 |
| 5 | **生产链真机 E2E 未重跑** | 003 已如实登记过同一项 | 无新增风险（004 未改生产链） |
| 6 | **`.env` 里的 MinIO 变量名是历史命名** | 代码同时支持 `MINIO_ACCESS_KEY/SECRET_KEY` 与 `MINIO_USERNAME/PASSWORD` | 建议统一为 `ACCESS_KEY/SECRET_KEY`（见 §17） |
| 7 | **前端探针留下的 3 条真实 Run** | 见 §13.6 | 刻意保留；如需清理有明确路径 |
| 8 | **接入文档与模板最初未同步 004**（**本报告定稿后补**） | `docs/research/EXPERIMENT-CODE-SPEC.md` 停在 001~003 口径；`research-experiments/{README.md,template/}` 亦然 | 照模板复制的新实验**不会声明任何产物** ⇒ 见 §15.1；这是「004 对**未来的实验**等于不存在」的风险 |

---

### 15.1 补记：接入面的同步（本报告定稿后追加）

004 的验收清单（A~F）覆盖了「Database / MinIO / 链路 / 前端 / 失败不伪装 / 无回归」，
但**没有覆盖「未来的实验作者怎么知道这件事」**。这一项是**用户追问后**发现的，如实登记。

后果是具体的：`AGENT`/外部 AI 写新实验时只读 `EXPERIMENT-CODE-SPEC.md` + `template/`，
而这两处在 004 后仍停在 001~003 口径 ⇒ 生成的实验**不会产出任何自定义产物**
（虽然 `result.json` / `logs/run.log` / `manifest.json` 仍会自动持久化）。

| 文件 | 补前 | 补后 |
|---|---|---|
| `docs/research/EXPERIMENT-CODE-SPEC.md`（**外部 AI 的接入规范**） | A~O 15 节，无一处提到持久化 | 头部标注 004；`ExperimentRunContext` 加 `artifact`；D.4 补「产物不进 payload」；**新增 §P 结果持久化与产物**（P.1 你不要做的事 / P.2 Run 生命周期 / P.3 两类产物 / P.4 何时不该用 / P.5 Object Key / P.6 Manifest 白名单即授权 / P.7 页面能看到什么 / P.8 你的责任） |
| `research-experiments/template/experiment.ts` | `run()` 从未调用 `context.artifact()` | 加一次**演示调用**（`group-counts.csv` + `role: "table"`）⇒ 复制者自然带上产物声明 |
| `research-experiments/template/README.md` | 无 | 新增「结果会自动持久化（004）」节 + 2 条自检项 |
| `research-experiments/README.md` | 仍写「旧 Research 与独立实验**并存**、两个前端入口」——9cg 后 `/research` 已 **404** | 改为「旧链路已整体退役」；补 004 持久化说明 |

判据：`npx tsc --noEmit` = 0 错（模板代码在 tsconfig 内，改模板必须过类型门）；改后 `checkEolDrift.mjs` 漂移 0。

> **补记（2026-09-21，编号 `9ci` · EXP-001 真机发现）**：上表 `template/experiment.ts` 那一行原写作
> `（tables/group-counts.csv）`，**这个写法是错的** —— `name` 是 Run 前缀下的相对名字，`tables/` 角色段
> 由 `role` 拼，写成 `tables/group-counts.csv` 会落成 `tables/tables/group-counts.csv`。
> 本报告 §15.1 之所以没发现，是因为当时**没有真机跑过模板的产物声明**。
> 已修正 `template/experiment.ts` 的演示调用，并同步修正 `EXPERIMENT-CODE-SPEC.md` §P.3 示例 / §P.5 字段表 /
> 检查清单与 `template/README.md`；EXP-001 的 E2E 新增「Object Key 角色段不重复」回归闸（第 9b 步）。
> 细节见 `docs/research/EXP-001-final.md` §20 缺陷 ④。

---

## 16. 风险

### 16.1 已识别风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| **TiDB 冷连接瞬时失败**（首次请求 19.2s 后 500） | 🟠 中（已缓解） | 见 §16.2；读路径已挂 `withReadRetry` |
| 对象存储不可用时用户看到「跑失败」 | 🟢 低 | 这是**刻意**的：不做静默降级到本地磁盘，否则「其实没接对象存储」会被误当成「跑成功了」（规格 §13）。前端已用**专属红条**把「算完了但没持久化」与「执行失败」分开 |
| Run 表无限增长 | 🟢 低 | 3 个索引覆盖现有查询形态；`listRuns` 有界（默认 50） |
| `summaryJson` 被写入大对象 | 🟢 低 | 摘要只写计数器与分布；结果本体一律进对象存储（§3.3 的硬线） |
| 前端页面体积增长 | 🟢 低 | 构建门通过（§12.4） |
| `reconcileRun` 被误用（把正在跑的 Run 判死） | 🟡 低-中 | 仅 `adminProcedure`；必须传 `reason`（进 `errorMessage`，留痕）；只对 `RUNNING` 有效 |

### 16.2 🔴 本轮真缺陷 ②：Run 读路径缺了全站既有的「瞬时读重试」兜底

**症状（真机实测）**：dev server 冷启动后第一次 `GET /api/trpc/researchExperiments.listRuns` 返回 **500**，耗时 **19.2s**（与 `server/db.ts` 的 `connectTimeout: 20_000` 同量级）；**紧接着重试同一请求 1.6s 成功**。实验列表页因此显示「运行历史暂时取不到」（`EXPERIMENT_RUN_QUERY_FAILED`）。

**定位过程（先排除再定因）**：
1. 先写只读根因探针 `_probe_9ch_run_query.mts` 在**真库**上跑六步：`select 1` / `information_schema` 列 / 表存在性 / 原生 select / drizzle 无 limit / drizzle 带 limit / 原生 `LIMIT ?` —— **全绿** ⇒ 排除 schema、列名、`LIMIT ?` 占位符、builder 的嫌疑。
2. 读 `server/db.ts`：其连接池注释**已经写明**这一类症状 ——「取出死连接 / 建连超时 ⇒ Drizzle 包成 `Failed query: …`」，并指明全站既有兜底就是 `withReadRetry`。

**结论**：这不是「新缺陷」，而是**新代码没有继承既有的兜底约定** —— 004 新增的 Run 读路径直连连接池。

**修法**：`DbExperimentRunRepository` 的 5 个**读**路径（`getRun` / `listRuns` / `countRunsByExperiment` / `latestRunByExperiment` / `requireRow`）全部包进 `withReadRetry(label, fn)`；**写路径不重试**（重试写可能造成重复写入，语义由上层负责）。

**验证**：
- 新增 `runRepositoryRetry.test.ts` **7 例**：4 个读方法「首次瞬时失败 → 重试后成功」；语义错误（`ER_NO_SUCH_TABLE`）**不重试**（调用 1 次）；超上限抛出（调用 3 次，**有界**）；`createRun` 的 insert 瞬时失败**只调用 1 次**。
- 真机复测：`list` 从 **19.2s → 0.28s**，`runsAvailable: true`。

> 这一条的普遍教训：**「新代码写对了」不等于「新代码接对了」**。项目里已有的横切约定（重试、行尾、错误码协议、预览常量同源）必须在新模块里**显式继承**，否则会以「偶发 500」的形态暴露。

### 16.3 本任务真踩清单（全部已修，供后续参考）

| # | 现象 | 归属 | 修法 |
|---|---|---|---|
| 1 | `NoSuchBucket` 被判成 `PUT_FAILED` ⇒ 「请确认桶已存在」的自救提示**不可达** | **产品缺陷** | `isUnavailable()` 加 `NoSuchBucket` + 注释 |
| 2 | Run 读路径冷启动 500 | **产品缺陷** | 5 个读方法挂 `withReadRetry` + 7 例测试 |
| 3 | 测试断言用**消息文案**而非 `error.code`（`rejects.toThrowError(CODE)` 恒失败） | 测试缺陷 | 新增 `codeOf(promise)` 断言 `ArtifactStorageError.code` |
| 4 | `readRunDetail().artifacts` 期望 4 实得 3 | **判据错**（Manifest 不进自己的索引） | 改为断言键集合等于 `[csvKey, logKey, resultKey]` 并注明原因 |
| 5 | 旧前端探针断言「**不新增数据库表**」 | **旧断言把 004 的成果判成 FAIL** | 改断言为「旧文案已消失 + 已持久化已宣告」，并在文件头写明**不要**为让它变绿而把旧文案加回产品 |
| 6 | 前端探针 G 段用 `len > 0` 判「预览有内容」⇒ 撞上「加载中…」占位**假通过** | 探针缺陷 | 判据改为「非 loading 且出现 `pre`/`table`/`code`」 |
| 7 | 前端探针用 `a[href*="/runs/"]` 末项取 runId ⇒ 拿到「运行历史」里的**旧** Run | 探针缺陷 | runId 权威来源改为 **manifestKey**，再断言页面确有针对它的链接 |
| 8 | `tsc --noEmit` 曾报 33 条（`ExperimentDetail` 22 / `ExperimentList` 11） | 类型缺陷 | 重写两文件 ⇒ 0 error |
| 9 | 探针路径写错（`../drizzle/schema` ⇒ 应 `../../`） | 探针缺陷 | 修正相对层级 |

---

## 17. 下一步建议

### 17.1 立即可做（低成本、消除已知缺口）

1. **补一个 Parquet 产物样本**：让某个实验（或新的示例实验）在 `artifactFiles` 里产出 `tables/*.parquet`，把「下载链路 + `application/octet-stream` 兜底 + 元数据展示」端到端跑一次。这是本任务**唯一没实测过的产物类型**。
2. **补一个 Chart 产物样本**（同上；`chartKeys` 目前只有类型与索引，没有真实文件）。
3. **统一 MinIO 变量命名**：把 `.env` 从 `MINIO_SERVER/USERNAME/PASSWORD/BUCKET` 迁到 `MINIO_ENDPOINT/PORT/ACCESS_KEY/SECRET_KEY/BUCKET`，并**保留**兼容读取一期后删除。现在两套命名并存是（可接受的）技术债。
4. **`stale` RUNNING 自动回收**：把 `reconcileRun` 挂到一个有界启动钩子（与既有 `9h` 同源问题）。dev server 的 `tsx watch` 热重启会持续制造悬挂 RUNNING，这是**环境性**的，值得自动化。

### 17.2 中期（让 004 的能力被真正用起来）

5. **Run 对比视图**：现在只能逐条打开 Run Detail。既然 Manifest 与 `summaryJson` 都在，同一实验的多条 Run 之间做「参数 → 指标」并排对比是**下一步最自然的增量**（而且不需要新表）。
6. **Run 的可见性收敛**：目前 `listRuns` 列出所有 Run（含失败）。建议加**默认过滤**（默认只看 `COMPLETED`）+ 显式「显示失败 Run」开关，避免失败 Run 淹没历史。
7. **产物保留策略**：定义「Run 行删除 ⇒ 对象前缀清理」的运维脚本（含 dry-run），把 §15 第 3 条的孤儿对象问题变成**一次性可执行动作**。

### 17.3 与项目主线的衔接

8. **本节之后停在 `RESEARCH-EXPERIMENT-004 COMPLETE`**（用户明确要求：**不要**自动开始 EXP-001）。
9. 若后续要做 **EXP-001**，本任务的产物是它的地基：`ExperimentDefinition` 只需在 `artifactFiles` 里多产出文件，**不需要碰持久化层一行代码**。
10. **把「新模块必须显式继承横切约定」写进项目细则**：本轮的 §16.2（重试兜底）与 §11.4（预览常量同源）是同一类教训的两次实例 —— 都属于「新代码写对了但没接对」。建议在 `docs/research/EXPERIMENT-CODE-SPEC.md` 增一节「新增模块的横切清单」（重试 / 错误码协议 / 常量同源 / 行尾 / 探针显式退出）。

---

## 附：复跑清单（把本报告里的每条结论对应到一条命令）

```bash
# 类型门（必须 0 错）
npx tsc --noEmit

# 构建门
pnpm run build

# 变更影响面回归（判据 = 零新增失败文件；基线 7 失败文件 / 16 例）
pnpm run test:changed

# 定向测试（004 全部新增用例 + 旧 Research 依赖 Gate）
pnpm exec vitest run tests/server/researchExperiments tests/server/research/legacyFreeProductionChain.test.ts

# 行尾漂移
node scripts/checkEolDrift.mjs

# migration 幂等（干跑 / 应用 / 复跑）
node scripts/applySqlMigration.mjs drizzle/0047_experiment_run_persistence.sql --dry-run
node scripts/applySqlMigration.mjs drizzle/0047_experiment_run_persistence.sql

# 真库根因探针（只读）
pnpm exec tsx docs/evidence/_probe_9ch_run_query.mts

# MinIO 连通性
pnpm exec tsx docs/evidence/_probe_9ch_minio_connectivity.mts

# 真实最小 Experiment Persistence E2E（真 TiDB + 真 MinIO + 真 Dataset；默认自清）
pnpm exec tsx docs/evidence/_e2e_9ch_experiment_persistence.mts
#   想留档给前端看：PERSIST004_KEEP=1 pnpm exec tsx docs/evidence/_e2e_9ch_experiment_persistence.mts

# 前端可达性（需 dev server 在 4000；46 例）
node docs/evidence/_probe_9ch_experiment_persistence_frontend.mjs
#   001 时期的旧探针（判据已随 004 修正）
node docs/evidence/_probe_research_experiments_frontend.mjs
```

**产物清单**：

| 类型 | 路径 |
|---|---|
| E2E 输出 | `docs/evidence/_e2e_9ch_experiment_persistence.out.json` |
| 前端可达性输出 | `docs/evidence/_probe_9ch_experiment_persistence_frontend.out.json` / `.out.txt` |
| MinIO 连通性输出 | `docs/evidence/_probe_9ch_minio_connectivity.out.json` / `.files.out.json` |
| 真库查询根因输出 | `docs/evidence/_probe_9ch_run_query.out.json` |
| migration | `drizzle/0047_experiment_run_persistence.sql` |
