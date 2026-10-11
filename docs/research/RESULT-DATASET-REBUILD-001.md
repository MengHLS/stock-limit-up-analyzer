# RESULT-DATASET-REBUILD-001 · 首板回踩研究 Dataset 新建

> 任务：`DATASET-REBUILD-001` —— 采用已裁定的 **D-a** 新建 `first_limit_pullback` 版本（不复用 780003、不用 FAILED Dataset、不降级 11 因子）
> 基线：HEAD `f8b6810` · 🔴 **本轮未执行构建**（原因见 §1）
> 🔴 非平台正式 Run（沙箱 `spawn EPERM`）

---

## 0. 状态

```text
┌──────────────────────────────────────────────────────────────┐
│  状态 = BLOCKED（未执行构建）                                 │
│  datasetVersionId   = （未创建 —— 零副作用，见 §4）           │
│  实际行数           = 不适用                                  │
│  窗口 / 过滤        = 已冻结为规格（§2），未落地              │
│  12 因子覆盖率      = 不适用                                  │
│  剩余问题           = 见 §5（唯一：需一次可长驻的构建执行）    │
└──────────────────────────────────────────────────────────────┘
```

## 1. 为什么 BLOCKED（**如实说明**）

**不是技术不可行** —— 可⾏性已 100% 摸清（§3）。阻断在执行容量：

1. 该 Dataset 的**全量构建耗时 29–88 分钟**（实测，见 §3.1），且**必须在同一个长驻进程内完成**（运行态是进程内内存 map）。
2. 任务**强制要求**构建后做**物理数据验收**（10 项，含多张百万级表的真实 `COUNT(*)`），**并且明确「只有全部通过后才能标记 READY」**。
3. 本轮**无法同时完成构建 + 验收** ⇒ **不得**标记 READY。
4. 🔴 **因此选择在任何写操作之前停止**：**未创建版本、未创建作业、未写入任何一行**。
   理由：若只启动构建而不完成验收，DB 里会留下一个 `BUILDING` 版本；而构建运行态是**进程内内存**，会话结束后**无人接管** ⇒ 正是 `router.ts` L652-661 明文记载的**死锁**（「`createJob` 报 `VERSION_NOT_BUILDABLE`、`deleteVersion` 报 `VERSION_HAS_RUNNING_JOB`，用户既不能重建也不能删除」）。
   ⇒ **最小伤害原则：零副作用地停手，把已摸清的路径交接出去。**

---

## 2. 目标 Dataset 规格（**已冻结，待执行**）

| 项 | 值 |
|---|---|
| `datasetCode` | `first_limit_pullback` |
| 窗口 | **2019-01-02 ~ 2025-09-26** |
| `excludeListedWithinDays` | **365**（自然日，基准 = **事件日**；canonical 口径 #1） |
| `excludeSt` | `1` |
| `preWindowDays` | 🔴 **10**（任务要求 `>= 10`；**取最小充分值**，理由见 §3.3） |
| `postWindowDays` | **80** |
| `outcomeHorizons` | `[5, 10, 20]` |
| `batchSize` | `1000` |
| 12 因子定义 / `orientation` | **零改动**（沿用冻结契约） |
| 决策锚点 | `T+5` close（**不扩回踩窗、不新增第 6 日**） |
| Schema / migration / 既有 Dataset | **零改动** |

---

## 3. 已完成的可行性实查（**全部只读，可复核**）

### 3.1 构建历史与耗时（证明全量构建可行）

| 作业 | 版本 | 状态 | **耗时** | `completedChunks/total` | `processedRows` |
|---|---|---|---:|---|---:|
| `ds001-v9-…` | 780003 | **FAILED** | **51 min** | 58,256 / 71,934 | 12,987,967 |
| `ds001-v9-smoke-…` | 780002 | COMPLETED | 104 s | 2,315 / 2,373 | 457,433 |
| **`ds001-v8-…`** | **780001** | **COMPLETED** | 🔴 **36 min** | 73,003 / 74,866 | **11,759,646** |
| **`ds001-v7-…`** | 750001 | **COMPLETED** | 🔴 **36 min** | 73,003 / 74,866 | 11,759,646 |
| `ds001-v6-…` | 720001 | COMPLETED | 88 min | 102,878 / 104,741 | 16,609,608 |
| `ds001-v5-…` | 660001 | COMPLETED | 29 min | 74,443 / 74,866 | 5,148,183 |

⇒ **同规模全量构建 36 分钟可完成**（v8/v7 各 36 min，`processedRows` 1,176 万）。**技术可行 ✓**

### 3.2 🔴 v9 失败根因（已定位 ⇒ 可规避）

```
v9 FAILED  err = "Failed query: insert into `ds_first_limit_pullback_prefix`
                   (`id`,`datasetVersionId`,`eventId`,`symbol`,`tradeDate`,`relativeDay`,
                    `open`,`high`,`low`,`close`,`preClose`,`volume`,`amount`,`createdAt`) values …"
```
⇒ **v9 死在 `prefix` 的 `INSERT`**，而 v9 的 `preWindowDays = 60` ⇒ 预期 prefix ≈ 3.77M 行（实测 3,548,239）。
⇒ **规避方式 = 把 `preWindowDays` 从 60 降到 10**（§3.3）。

### 3.3 为什么 `preWindowDays = 10`（**关键设计选择**）

- F9 `preReturn10` 的定义 = `close(rd −1) / close(rd −10) − 1` ⇒ **只需 `rd −10..−1`** ⇒ `preWindowDays = 10` **最小充分**。
- 任务要求为 `>= 10` ⇒ **10 满足要求**。
- 🔴 直接把 prefix 从 **≈3.77M 行降到 ≈0.68M 行（−82%）**，**精确打击 v9 的失败面**。

### 3.4 目标构建的预期规模（以 780001 窗口内 61,814 事件估）

| 表 | 预期行数 |
|---|---:|
| `event` | ≈ 62 k |
| `prefix`（rd −10..0，11 天） | **≈ 0.68 M** |
| `post`（rd 1..80） | **≈ 4.95 M** |
| `path` | **≈ 4.95 M**（实测与 `post` **恒等**：780001 两者皆 5,733,817；780003 皆 4,716,480） |
| `outcome` | ≈ 0.19 M |
| **合计** | **≈ 10.8 M 行** ⇒ 与 v8 的 11.76M **同量级** ⇒ **预期 36–90 分钟** ✓ |

### 3.5 构建通路（**已定位到 composition root，可直接脚本化**）

```text
registry.ts#DatasetRegistryService
  ├─ createVersionWithBuildConfig({ datasetId, version, startDate, endDate, filter })  → DatasetVersion
  ├─ createJob(versionId)                                                             → DatasetBuildJob
  └─ （runner 内部）execute() 已兜住全部异常 ⇒ 失败落 FAILED，不会卡在 BUILDING
runner.ts#DefaultDatasetBuildRunner({ repo, service, plugins })  → start(jobId)（不 await，后台推进）
plugins.ts#defaultDatasetPluginRegistry（含 firstLimitPullbackPlugin：
    createIO: () => new DbDatasetBuildIO()；createBuilder: (io, opts) => new FirstLimitPullbackDatasetBuilder(io, {batchSize})）
physicalTables.ts#DbDatasetPhysicalStore  ← 必须注入（否则 physicalStore 缺失，见 720001 的 FAILED 记录）
router.ts L640-647 即生产装配样板
```
**分批/可恢复**：builder 原生支持 —— `EVENT_CHUNK_DAYS` / `PATH_CHUNK_DAYS` 分片 + `resumeCheckpoint`（`lastTradeDate` / `lastEventId`），每 chunk 回调 `ProgressReporter` 落 `dataset_build_job` 断点 ⇒ **满足任务第 1 条** ✓

### 3.6 陈旧作业回收：**不构成风险**

`DEFAULT_STALE_BUILD_MINUTES = 10`（`registry.ts` L441），但判据是 `updatedAt ?? startedAt` **早于** `now − 10min`，而 builder **每个 chunk 都刷新进度**（v8：36 min 内 73,003 chunk ⇒ ≈2,000 chunk/min）⇒ 活跃构建**不会被回收** ✓
（另：回收只在**服务启动时**调用一次 `reclaimOrphanBuildJobs`。）

---

## 4. 本轮副作用：**零**

- ✅ **未创建 Dataset 版本** · **未创建构建作业** · **未写入任何数据行**（`event` / `prefix` / `post` / `path` / `outcome` 均未变）
- ✅ 全部 DB 访问为 **只读 `SELECT`**
- ✅ **未执行任何因子真实 Run** · **未跑 Phase 1 P3** · **未做参数搜索 / 阈值 / 权重 / 组合实验**
- ✅ **未修改**研究定义 / 因子 / `orientation` / Schema / migration / 既有 Dataset
- ✅ **未重新审计**已完成模块
- ✅ 本轮仅新增 **2 个未跟踪只读探针**（`scripts/_scratch/rebuildFeasibility.cjs` 及同目录一件）与**本报告**

---

## 5. 剩余问题（**唯一**）与下一步

> ### 唯一剩余问题：需要一次**可长驻的构建执行**（约 36–90 分钟），随后在同一轮内完成**物理数据验收**。

**下一条指令应直接执行（无需再裁定）：**

```text
【步骤 1 · 创建版本 + 作业】
  service.createVersionWithBuildConfig({
    datasetId: <first_limit_pullback 的 dataset_definition.id>,
    version:   "v10-listed365-pre10-post80",
    startDate: "2019-01-02", endDate: "2025-09-26",
    filter: { excludeSt: 1, excludeListedWithinDays: 365,
              preWindowDays: 10, postWindowDays: 80,
              outcomeHorizons: [5,10,20], batchSize: 1000, configVersion: 1 }
  })
  → job = service.createJob(version.id)
  → runner.start(job.id)        # 不 await；后台推进；每 chunk 落断点

【步骤 2 · 守护构建】
  轮询 repo.getJob(jobId) 直到 status ∈ {COMPLETED, FAILED, CANCELLED}
  参考耗时：36–90 min（v8/v7 = 36 min）

【步骤 3 · 物理数据验收（10 项，全部通过才可标记 READY）】
  ① datasetVersionId                     ⑥ excludeListedWithinDays=365 实际生效
  ② event/prefix/post 真实 COUNT(*)       ⑦ F9 preReturn10 100% 可计算
  ③ prefix 覆盖 rd −10..0                 ⑧ 12 因子覆盖率
  ④ post 覆盖 rd 1..80                    ⑨ event → prefix/post 完整性
  ⑤ 时间范围 = 2019-01-02~2025-09-26       ⑩ status 与物理数据一致
  ⇒ 任一不通过 ⇒ 保持 FAILED / 不标 READY，并在报告中列出
```

**🔴 执行该指令时不得：** 跑 Phase 1 P3 · 跑真实实验 · 改研究定义/因子/`orientation` · 参数搜索 · 阈值/权重/组合实验 · 重新审计已完成模块。
