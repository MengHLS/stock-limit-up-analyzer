# RESULT-DATASET-REBUILD-EXEC-001 · v10 Dataset 正式执行

> 任务：`DATASET-REBUILD-EXEC-001` —— 创建 → 构建 → 物理验收 → READY
> 版本：`v10-listed365-pre10-post80` · `datasetVersionId = **780004**`
> 基线：HEAD `f8b6810` · 走**生产通路**（`DatasetRegistryService` + `DefaultDatasetBuildRunner` + `DbDatasetPhysicalStore` + 原生 chunk/checkpoint/resume）
> 🔴 非平台正式 Run（沙箱 `spawn EPERM`）

---

## 0. 状态

```text
┌──────────────────────────────────────────────────────────────────────┐
│  状态 = **FAILED / BLOCKED**                                         │
│  datasetVersionId = **780004**   version = v10-listed365-pre10-post80 │
│  dataset_version.status = **FAILED**（未伪造 READY，保留 FAILED）      │
│  失败阶段 = phase "windows"，chunk **2461 / 60620**，cursor 2019-04-02 │
│  失败语句 = `insert into ds_first_limit_pullback_post`（28 列 × 1000 行）│
│  总耗时 = **273 s**（event 阶段 100% 完成；windows 阶段中断）           │
│  可续跑 = ✅ 断点完整（原生 resume 支持）                              │
└──────────────────────────────────────────────────────────────────────┘
```

**未标记 READY** —— 10 项验收未全部通过（详见 §3）。

---

## 1. 已创建的实体（真实写操作，已授权）

| 实体 | 值 |
|---|---|
| `dataset_version.id` | **780004** |
| `dataset_version.version` | `v10-listed365-pre10-post80` |
| `dataset_version.status` | **`FAILED`** |
| `startDate / endDate` | `2019-01-02` / `2025-09-26` ✅ 与规格一致 |
| `totalEvents` / `totalRows` | `null`（构建未成功，不写假账） |
| `dataset_build_job.jobId` | `ds001-v10-listed365-pre10-post80-1791441182082-d8a6b476` |
| `dataset_build_job.status` | **`FAILED`**（**非 RUNNING** ⇒ **无「假 RUNNING / 无人接管」死锁**） |
| `dataset_build_config`（冻结） | `excludeSt=1` · **`excludeListedWithinDays=365`** · **`preWindowDays=10`** · `postWindowDays=80` · `outcomeHorizons=[5,10,20]` · `batchSize=1000` · `configVersion=1` ✅ **与规格逐项一致** |

**未创建第二个版本**（续跑复用同一 `780004`）；未修改 Schema / migration / 既有 Dataset。

---

## 2. 失败诊断

### 2.1 失败阶段与断点（`dataset_build_job` 实读）

```text
phase         = "windows"
completedChunks = 2461 / 60620      ← 阶段进度 4.06%
processedRows   = 426,688
failedRows      = 0                 ← 不是数据行失败，是语句级失败
lastTradeDate   = 2019-04-02
lastEventId     = 603712.SH@2019-04-02
lastCursor      = {"phase":"windows","lastTradeDate":"2019-04-02","lastSymbol":null,
                   "lastEventId":"603712.SH@2019-04-02","processedRows":426688,"completedChunks":2461}
startedAt       = 2026-10-08 06:38:30   completedAt = 2026-10-08 06:42:57
```

**阶段推进事实**：`event` 阶段 **1637/1637 chunk 全部完成**（cursor 已推进到 `2025-09-26`，`processedRows 474,896`），随后进入 `windows` 阶段并在 **chunk 2461** 处中断。

### 2.2 失败语句与错误

```text
Failed query: insert into `ds_first_limit_pullback_post`
  (`id`,`datasetVersionId`,`eventId`,`symbol`,`tradeDate`,`relativeDay`,`open`,`high`,`low`,`close`,
   `preClose`,`limitUpPrice`,`limitDownPrice`,`limitRuleUp`,`limitRuleDown`,`limitRuleVersion`,
   `barPresent`,`suspensionStatus`,`suspensionSource`,`openAtLimitUp`,`closeAtLimitDown`,
   `oneWordLimitUp`,`oneWordLimitDown`,`canBuyAtOpen`,`canSellAtClose`,`volume`,`amount`,`createdAt`)
  values (default,?,?,…,default), … ×1000
```

### 2.3 🔴 关键诊断限制（**登记为平台缺口**）

`dataset_build_job.errorMessage` 长度 **16,000 字符**，**全部是 SQL 文本本身**，**没有携带底层 MySQL 错误码/errno**。
⇒ 无法从库内直接区分 `ER_NET_PACKET_TOO_LARGE` / `ER_LOCK_WAIT_TIMEOUT` / `ECONNRESET` / 代理断连。
⇒ **建议另立任务**：构建失败时把 `cause.code` / `errno` / `sqlState` 一并持久化。**本轮不修改代码。**

### 2.4 根因假设（有独立旁证）

🔴 **旁证**：本轮我自己的验收脚本在**第一条 `COUNT(*)` 查询**上就撞到 **`Error: read ECONNRESET`**（同一远端 `47.94.112.21:13306`）—— 即 **该连接在大语句上确实会重置**。

⇒ **根因 = 连接/传输层重置**（大 `INSERT` 被对端或中间代理断开），**不是**数据非法、不是 Schema 不匹配、不是批次内容问题。
⇒ 支撑：`failedRows = 0`（无行级失败）；同一 builder 与 `batchSize=1000` 在 **v5/v6/v7/v8 四次全量构建中均成功**；v9 与本轮的失败**同样都是 `INSERT` 语句级失败**（v9 在 `prefix`、v10 在 `post`）。
⇒ 即 **失败具有环境性/瞬时性，而非确定性**。

---

## 3. 物理数据验收（10 项）

构建未完成 ⇒ **多数项按「未通过/未完成」如实记录**；但有两项给出了**确定性结论**。

| # | 验收项 | 结果 | 实测 |
|---|---|:---:|---|
| ① | `datasetVersionId` | ✅ | **780004** |
| ② | event / prefix / post / path / outcome 实际 `COUNT(*)` | ⚠️ **不完整** | event **58,983** · prefix **37,381** · post **268,880** · path **272,880** · outcome **10,611** |
| ③ | prefix 覆盖 `rd=-10..0` | ✅ **范围正确**（但覆盖不完整） | `min rd = −10` · `max rd = 0` |
| ④ | post 覆盖 `rd=1..80` | ✅ **范围正确**（但覆盖不完整） | `min rd = 1` · `max rd = 80` |
| ⑤ | 实际时间范围 = 2019-01-02 ~ 2025-09-26 | ✅ **event 侧完整** | `min = 2019-01-02` · `max = 2025-09-26`（event 阶段已 100% 完成） |
| ⑥ | `excludeListedWithinDays=365` 实际生效 | ✅ 🔴 **确定性通过** | 同窗口事件数：**v8（无过滤）= 61,814** · **v9（365）= 58,983** · **v10（365）= 58,983** ⇒ v10 **比无过滤少 2,831（−4.58%）**，且**与既有 365 过滤版本逐位相等** ⇒ **过滤确实生效** |
| ⑦ | F9 `preReturn10` 100% 可计算 | ❌ **未通过** | 仅 **3,261 / 58,983 = 5.53%**（prefix 阶段只跑到 chunk 2461） |
| ⑧ | 12 因子覆盖率 | ⛔ **不可评** | 依赖 ⑦ 与完整 prefix/post |
| ⑨ | event → prefix/post 完整性 | ⛔ **不可评** | 同上 |
| ⑩ | status 与物理数据一致 | ✅ **一致** | `status = FAILED` 与「windows 阶段仅 4.06%、F9 仅 5.53%」**一致**，**未虚报 READY** |

**⇒ 验收未全部通过 ⇒ 不标记 READY（符合任务要求）。**

---

## 4. 是否可以「从 checkpoint 继续」？—— ✅ **可以，且是推荐路径**

| 判据 | 结论 |
|---|---|
| 断点是否完整 | ✅ `phase=windows` · `lastEventId=603712.SH@2019-04-02` · `completedChunks=2461/60620` 全部齐备 |
| builder 是否原生支持 resume | ✅ `resumeCheckpoint`（`lastTradeDate` / `lastEventId`）+ `EVENT_CHUNK_DAYS` / `PATH_CHUNK_DAYS` 分片 + 每 chunk `ProgressReporter` 落库 —— **即任务要求的「分批、可恢复」机制** |
| 续跑是否需改配置 | ❌ **不需要** —— 断点、窗口、过滤均已固化；续跑即从 chunk 2461 继续 |
| 续跑是否需新建版本 | ❌ **不允许也不需要**（任务明令禁止用第二个版本绕过）⇒ **续跑必须复用 `780004`** |
| 续跑是否会重复写入 | ✅ 幂等 —— 写入为 `insert`（本表无唯一键约束路径），且断点语义保证「只上报**已落库**的日期」；**但需注意**：续跑前应确认是否需要清场（`purgeVersionRows`）以避免重复行 —— **由 `startJob`/`markBuilding` 的既有语义决定，本轮不擅自改动** |
| 续跑可行性 | ⚠️ **预期可行但非保证** —— 根因是瞬时连接重置（§2.4）⇒ **可能需多次续跑**累积推进；每次失败都会前移断点、不丢进度 |

**⇒ 判断：可从 checkpoint 继续。** 因根因为瞬时性而非确定性，**建议以「续跑循环」方式推进**，而非重头构建。

---

## 5. 本轮副作用（如实登记）

- ✅ **已创建**：`dataset_version` id=780004（status=FAILED）· 1 条 `dataset_build_job`（FAILED）· 1 行 `dataset_build_config` · 该版本的五表部分物理行（§3 ②）
- ✅ **未修改**：Schema / migration / 既有 Dataset（780001/780002/780003 数据未动）
- ✅ **未创建第二个 Dataset 版本**绕过
- ✅ **未跑** Phase 1 P3 · **未跑**任何因子真实 Run · **未做**参数搜索 / 阈值 / 权重 / 组合实验 · **未修改** 12 因子 / `orientation` / `T+5` 锚点 / 回踩窗口
- ✅ **未重新审计**已完成模块
- ⚠️ **对平台的唯一写入面**：新建版本 + 其物理行（任务明确授权）

---

## 6. 下一条指令（建议，待授权）

```text
【RESUME】复用 780004，不新建版本：
  1. service.startJob(<new jobId for 780004>)      # PENDING → RUNNING
  2. runner.start(jobId)                            # 原生 resume，从 lastCursor 续跑
  3. 轮询至终态；若再次因连接重置失败 ⇒ 前移断点后**重复 1–3**（最多 N 轮）
  4. 终态 COMPLETED 后执行完整 10 项物理验收
  5. 全部通过才 markReady；仍失败则保持 FAILED 并回报

【附加建议（另立任务，本轮不做）】
  · 构建失败时持久化 cause.code / errno / sqlState（当前 errorMessage 只有 SQL 文本，无错误码）
  · 评估把 windows 阶段的 INSERT 批次调小（batchSize）或加重试/退避 —— 但**修改冻结配置需另行授权**
```
