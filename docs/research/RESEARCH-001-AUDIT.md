# RESEARCH-001 Phase A — 现有架构审计报告

> 审计时间：2026-09-10 22:30 GMT+8
> 审计对象：`drizzle/schema.ts` / `drizzle/` migration 体系 / `server/datasetRegistry` / `server/research` / `server/researchDataset`
> 审计方式：**读代码 + 实查真实 TiDB**（`information_schema`，非历史报告）
> 结论去向：Phase B Schema 设计（`RESEARCH-001-SCHEMA.md`）

---

## 0. 审计结论摘要（TL;DR）

| 项 | 事实 | 对 RESEARCH-001 的影响 |
|---|---|---|
| **1** | 项目**已存在** `research_experiments` / `research_runs` / `research_datasets`（复数） | ⚠️ **非等价**，属 STEP 6.x 遗留链路，**不复用、不改动** |
| **2** | Dataset Registry 三表已落地且 `dataset_version.id` 是 **bigint** | ✅ Research 的 `dataset_version_id` 一律 **bigint** |
| **3** | `strategies` 表已存在（`strategyId` 为 varchar(64) 业务主键） | ✅ Candidate 的 `strategy_definition_id` 用 varchar(64) 软引用 |
| **4** | 项目**不加数据库 FK**（soft reference / application-level integrity） | ✅ 10 张新表**全部不加 FK** |
| **5** | 新表列名 **camelCase**、表名 **snake_case**、JSON 一律 **longtext** | ✅ 严格遵守 |
| **6** | 新表状态列用 **`varchar(N)` + 应用层 TS 联合类型**，不用 `mysqlEnum` | ✅ 采用 varchar |
| **7** | `drizzle/meta/_journal.json` 与真实 schema **已脱节**（详见 §4） | ⚠️ 采用项目**实际在用**的 apply 脚本流程，**不伪造 journal** |
| **8** | 10 张表名与既有 `research_experiments` 仅差一个 `s` | ⚠️ 已由用户拍板：**严格按指令命名**，靠注释 + 本报告消歧 |

---

## 1. 迁移体系现状

### 1.1 文件清单

```
drizzle/
├── 0000_sleepy_colossus.sql … 0023_security_identity_unification.sql   (drizzle-kit 生成)
├── 0012_yellow_iron_man.sql … 0016_backfill_checkpoints.sql
├── 0017_research_securities.sql … 0023_security_identity_unification.sql
├── 0024_research_datasets.sql                    ← 手工编写
├── 0025_research_runs_dataset.sql                ← 手工编写
├── 0026_strategy_persistence.sql                 ← 手工编写
├── 0027_research_datasets_rows_table.sql         ← 手工编写
├── 0028_dataset_registry.sql                     ← 手工编写
├── 0029_dataset_build_config.sql                 ← 手工编写
├── 0030_dataset_window_layering.sql              ← 手工编写
├── meta/_journal.json                            ← 仅到 idx 23
├── meta/0000_snapshot.json … 0015_snapshot.json  ← 仅到 0015
├── relations.ts                                  ← 1 行（空壳）
└── schema.ts                                     ← 1217 行，唯一权威
```

**当前 migration 最大编号 = `0030`** → RESEARCH-001 新增 **`0031`**。

### 1.2 journal / snapshot 与真实状态的偏差（实查）

| 维度 | 值 |
|---|---|
| `_journal.json` entries | **24**（idx 0 … 23，最后 tag = `0023_security_identity_unification`） |
| `meta/*_snapshot.json` 数量 | **16**（0000 … 0015） |
| `drizzle/*.sql` 文件数 | **31**（0000 … 0030） |
| 真实 DB 已存在的表 | 含 `dataset_*`、`strategy_versions`、`strategies` 等 0024~0030 全部产物 |

**结论**：`0024 ~ 0030` 这 7 个 migration **既未进 journal、也无 snapshot**，是**手工 SQL + 幂等 apply 脚本**落库的。drizzle-kit 的本地状态（停在 0015）已经**不能**正确 diff 当前 `schema.ts`。

> ⚠️ 因此 **禁止执行 `drizzle-kit generate`**：它会拿 `schema.ts`（含全部现状）去 diff `0015_snapshot`，产出把 `0016 ~ 0030` 全部重放一遍的垃圾 migration。

### 1.3 项目实际在用的 migration 流程（权威）

```
① 在 drizzle/schema.ts 增加表定义（唯一权威，类型 + 列 + 索引）
② 手写 drizzle/0031_<semantic_name>.sql   —— CREATE TABLE IF NOT EXISTS，幂等
③ 写 scripts/apply<Name>.mjs              —— 读 ② 按 "--> statement-breakpoint" 切分逐条执行
④ 同一脚本内实查 information_schema 断言：表 / 列 / 索引 / 唯一约束
⑤ 运行脚本，输出真实结果作为证据
```

参考实现：`scripts/applyDatasetRegistry.mjs`、`scripts/applyDatasetBuildConfig.mjs`、`scripts/applyStrategyPersistence.mjs`、`scripts/applyDatasetWindowLayering.mts`。

`package.json` 中 `db:push = drizzle-kit generate && drizzle-kit migrate` **已不可用**（见 §1.2），RESEARCH-001 不采用。

---

## 2. Dataset 侧现状（Research 的输入边界）

### 2.1 Dataset Registry 三实体（真实 DB 实查）

| 表 | PK | 关键列 | 行数 |
|---|---|---|---|
| `dataset_definition` | `id` **bigint** AI | `datasetCode` unique、`datasetType`、`status`、6 个物理表名列 | 1 |
| `dataset_version` | `id` **bigint** AI | `datasetId` bigint、`version`、`status`(DRAFT/BUILDING/READY/FAILED)、`startDate`、`endDate`、`universeDefinitionJson`、`filterDefinitionJson`、`totalEvents`、`totalRows` | 2 |
| `dataset_build_job` | `id` **bigint** AI | `datasetVersionId`、`jobId` unique、`status`、checkpoint 列 | 2 |

`dataset_version` 真实列（`information_schema` 实查）：

```
id bigint PRI | datasetId bigint MUL | version varchar | status varchar MUL
startDate date | endDate date | universeDefinitionJson longtext | filterDefinitionJson longtext
featureVersion varchar | sourceVersion varchar | totalEvents bigint | totalRows bigint
createdAt timestamp | completedAt timestamp
```

→ **Research 只引用 `dataset_version.id`（bigint），不复制任何 ds_\* 物理表。**

### 2.2 Dataset 物理表五表分层（RESEARCH-001 直接消费对象）

`ds_{datasetCode}_{role}`，role ∈ `event / prefix / post / path / outcome / feature`（见 `server/datasetRegistry/naming.ts#DATASET_ROLES`）。

| role | 语义 | 时间方向 | PIT 属性 |
|---|---|---|---|
| `event` | 事件身份 + 时点属性（`previousClose` / `limitUpPrice` / `turnover` / 市值） | t 日 | 身份层 |
| `prefix` | **原始**行情，`relativeDay ∈ [-preWindowDays, 0]` | t 之前 + t | ✅ **PIT 安全 → 特征** |
| `post` | **原始**行情，`relativeDay ∈ [1, postWindowDays]` | t 之后 | ❌ 仅撮合/标签 |
| `path` | **衍生**指标，`relativeDay ≥ 1` | t 之后 | ❌ 仅标签 |
| `outcome` | 按 horizon 聚合（`maxReturn` / `minReturn` / `maxDrawdown` / `isBreakout`…） | t 之后 | ❌ 仅标签 |

**这正是 §15 PIT 边界的领域级落点**：`prefix` ↔ `post` 的分界落在 t 日，Research 的 Feature 只允许取 `prefix`（+ `event` 的时点属性），Outcome/Label 只允许取 `post` / `path` / `outcome`。Research 层**不重新定义时间逻辑**。

### 2.3 构建 / 筛选配置（`dataset_build_config` 三表）

`dataset_build_config`（与 version **1:1 UNIQUE**）+ `_event`（相对日 × 事件类型）+ `_board`。
→ 是「这一版数据是怎么筛出来的」的权威依据，Research 可只读展示，**不得修改**。

---

## 3. Strategy 侧现状（Research 的出口）

### 3.1 真实表（实查）

| 表 | PK | 关键列 |
|---|---|---|
| `strategies` | `id` int AI | `strategyId` **varchar(64) UNIQUE**（业务主键）、`name`、`latestVersion`、`status` |
| `strategy_versions` | `id` int AI | `strategyId`、`version`、`strategyDocumentJson`、`versionRecordJson`、`fingerprint`、`datasetVersion`、`universeId`、`codeVersion`；`UNIQUE(strategyId, version)` |

### 3.2 出口关系

```
research_strategy_candidate
   └─ strategy_definition_id  ──soft ref──►  strategies.strategyId   (可为 NULL)
```

**`strategy_definition_id = NULL` 是合法状态**（Research 只是提出候选，转正由 Strategy 侧完成）。
Research **绝不** INSERT / UPDATE `strategies` / `strategy_versions`（§24 反模式）。

---

## 4. Research 遗留链路现状（**不复用，明确隔离**）

### 4.1 既有表与语义

| 表 | PK | 关键列 | 行数 | 领域语义 |
|---|---|---|---|---|
| `research_experiments` | `id` int AI | `experimentId` varchar(64) UNIQUE、`strategyId`、`strategyVersion`、`snapshotJson` longtext、`status` **enum**(created/running/completed/failed) | **0** | STEP 6.2「策略参数实验」 |
| `research_runs` | `id` int AI | `runId` varchar(96) UNIQUE、`experimentId` varchar、`datasetId`/`datasetVersion`/`datasetFingerprint`、`resultJson` | **2** | 上述实验的一次执行 |
| `research_experiment_batches` | `id` int AI | `batchId`、`parameterSpaceJson`、`experimentIdsJson` | 0 | 参数扫描批次 |
| `research_datasets` | `id` int AI | `datasetId` DS-<datasetVersion> UNIQUE、`rowsFingerprint`、`versionSnapshotJson`、`rowsTableName` | **7** | STEP 12.6 **rd-\*** 内容指纹数据集（**非** Dataset Registry） |

**使用范围（全库 grep）**：
- `researchExperiments` → 仅 `drizzle/schema.ts` + `server/research/persistence/db.ts`
- `researchRuns` → 上述 + `scripts/migrate_add_research_run_dataset.ts` + `server/dataHealth.test.ts`
- `researchDatasets` → `server/researchDataset/{buildKey,persist}.ts` + 2 个 scripts

### 4.2 为什么**不复用**

| 维度 | 遗留 `research_experiments` | RESEARCH-001 `research_experiment` |
|---|---|---|
| 主键 | `id` int + **字符串业务键 `experimentId`** | `id` bigint **代理键** |
| 输入边界 | `strategyId` + `strategyVersion`（策略驱动） | **`datasetVersionId` bigint**（数据驱动） |
| 内容 | **单一** `snapshotJson` 大 JSON | `config`(JSON) + **结构化** status/type/sampleCount/时间戳 |
| 下游 | STEP 6.3 Sweep / 6.4 TVO / 6.5 WFO / 参数搜索 UI | Analysis → Result → Conclusion → Candidate |
| 状态枚举 | DB `enum` | 应用层 varchar 联合类型 |
| 生命周期 | 参数扫描的中间产物 | **研究结论的载体** |

→ **两者是不同 bounded context**。遗留表服务「Strategy → Parameter Search → Backtest」下游链路（本指令 §1 链路的后半段），新表服务「Research → Conclusion → Candidate」上游链路。**硬合并两套语义进一张表会同时污染两条链路**，故拒绝。

### 4.3 命名冲突与消歧（用户已拍板）

用户决策：**严格按指令命名** 10 张新表（`research_experiment` 单数等），遗留三表 **零改动**。

由此产生的唯一风险是**人读混淆**（`research_experiment` vs `research_experiments`），消歧手段：

1. `drizzle/schema.ts` 中新表段落带醒目块注释，显式写出「与遗留 `research_experiments` 的区别」；
2. 本审计报告 §4 + 最终报告 §15 Known Issues 各留一份对照表；
3. 遗留表与新表**分属不同 TS 模块**（`server/research/` vs `server/researchCore/`），**不共用 barrel**。

---

## 5. 项目编码约定（**新代码必须遵守**）

| 维度 | 约定 | 证据 |
|---|---|---|
| 表名 | `snake_case`，新表**单数** | `dataset_version` / `dataset_build_job` |
| 列名 | `camelCase` | `datasetVersionId` / `createdAt` |
| 主键 | 新表用 `bigint AUTO_INCREMENT`；旧表 `int` | `dataset_*` 全 bigint |
| 状态 / 类型列 | **`varchar(20~32)` + 应用层 TS `.ts` 联合类型**，**不用 `mysqlEnum`** | `datasetDefinitions.status` / `lifecycle.ts#VersionStatus` |
| 时间戳 | `timestamp`，`createdAt DEFAULT now()`，`updatedAt DEFAULT now() ON UPDATE` | `dataset_definition` |
| 日期 | `date`，drizzle `mode: "string"` | `dataset_version.startDate` |
| JSON | **一律 `longtext`**（含 `*Json` 后缀列名） | `universeDefinitionJson` |
| 金额 / 比率 | `double` | `ds_*_event.previousClose` |
| 索引 | `index("idx_<表缩写>_<列>")`，唯一 `uniqueIndex("uq_<表>_<列集>")` | `idx_dataset_version_status` / `uq_dataset_build_config_version` |
| 外键 | **不加 FK**，soft reference + 应用层保证 | `datasetBuildJobs.datasetVersionId` 注释「软引用」 |
| 模块命名 | **纯语义 camelCase，禁数字 / STEP 后缀**（§49.1） | `signalEngine` / `costModel` |
| Repository | `contract.ts` 接口 + `db.ts`(Drizzle) + `inMemory.ts`(测试) + `index.ts`；**Service 依赖接口** | `server/datasetRegistry/`、`server/research/strategyPersistence/` |
| 测试 | vitest；Repository 用 **InMemory 替身**，不依赖真实 DB | `server/datasetRegistry/registry.test.ts` |

---

## 6. 本设计相对指令原文的**调整点**（§29 要求记录）

| # | 指令原文 | 实际采用 | 原因 |
|---|---|---|---|
| 1 | 表名 `research_experiment` 等 | **照做** | 用户明确拍板 |
| 2 | `id` 类型未指定 | `bigint AUTO_INCREMENT` | 与 `dataset_version.id`(bigint) 对齐，避免 bigint→int 隐式截断 |
| 3 | 未指定 enum 落库方式 | `varchar` + TS 联合类型 | 项目新表约定（`dataset_*` 已如此），指令 §17 亦要求「遵循项目已有规范」 |
| 4 | `research_result.metric_value` 类型未指定 | `double`（**nullable**） | 复杂结果走 `result_json`，单列不能 NOT NULL |
| 5 | `research_analysis_condition` 无 `sortOrder` | **新增** `sortOrder int DEFAULT 0` | 同组内条件顺序须**确定性**（否则复现性受损） |
| 6 | `research_analysis_condition` 仅 `logical_operator` | **新增** `groupLogicalOperator varchar(8)` | 指令要求「预留 condition groups 扩展能力」；组内用 `logicalOperator`，组间用 `groupLogicalOperator` |
| 7 | `research_artifact.storage_type` 未列取值 | 定 `FILE / S3 / URL / INLINE` | 与 `dataset_definition.storageType`(DATABASE) 风格一致 |
| 8 | 未提唯一约束 | 新增 2 个：`uq_research_run_experiment_run_no`、`uq_research_analysis_metric_analysis_code` | `run_no` 在实验内必须唯一；一个 Analysis 的同一 metric 只应定义一次 |
| 9 | `research_conclusion.confidence` | `double` nullable + **语义注释「主观置信度 0~1，不是 p 值」** | 指令 §11 明确要求不得解释为 p-value |
| 10 | migration 要求「journal 正确」 | **不写 journal**，采用 apply 脚本流程 | `_journal.json` 已在 0024 起停止维护；**手工补 journal = 指令禁止的伪造**。改为报告 §15 记录为 Known Issue |

---

## 7. 审计对 Phase B 的硬约束（输入条件）

1. `dataset_version_id` / `experiment_id` / `run_id` / `analysis_id` / `hypothesis_id` / `conclusion_id` **一律 `bigint`**。
2. `strategy_definition_id` **`varchar(64)`**（软引用 `strategies.strategyId`）。
3. 全部 JSON 列 `longtext`，列名以 `Json` 结尾。
4. 全部状态 / 类型列 `varchar(20~32)`，取值由集中式 TS 联合类型定义。
5. **零数据库 FK**；引用合法性在 Domain / Repository 层保证。
6. **禁止**出现任何 `research_*_daily_price` / `research_event` 之类的 Dataset 复制表。
7. `research_result` **不得**承载样本级行（sample-level 数据属 Dataset）。
8. 新模块目录 **`server/researchCore/`**（语义 camelCase，无数字），**不并入** `server/research/index.ts` barrel（避免与既有 `ResearchExperiment` / `ResearchRun` 类型重名冲突，见 §4）。
