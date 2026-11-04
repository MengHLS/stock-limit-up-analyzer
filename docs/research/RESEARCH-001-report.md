# RESEARCH-001 最终报告 — Research 数据库与领域对象设计

> 任务：`RESEARCH-001`
> 完成时间：**2026-09-10 22:56 GMT+8**
> 状态：**COMPLETE**（Phase A~F 全量落地；指令 §27 验收标准逐条满足）
> 配套文档：`RESEARCH-001-AUDIT.md`（Phase A 审计）、`RESEARCH-001-SCHEMA.md`（Phase B 设计）

---

## 1. Executive Summary

按指令 §3~§13 建立 **Research 核心持久层**：10 张 `research_*` 表（**103 列 / 30 索引项 + 10 PK**）已落真实 TiDB；`server/researchCore/` 提供 Domain 类型、集中管理枚举、条件/结果/候选模型与 Repository（契约 + 内存替身 + 真实 DB 实现）。

| 项 | 结果 |
|---|---|
| Migration 应用 | `node scripts/applyResearchCore.mjs` → **`PASS — 检查 95 项，失败 0 项`**；二次运行幂等（`38/38` → `10/38` + 跳过 28） |
| 真实 DB 端到端 | `npx tsx scripts/verifyResearchCore.mts` → **`PASS — 检查 45 项，失败 0 项`**（跑 `createDbResearchRepositories()` 本体） |
| 单元 + 契约测试 | **5 文件 / 82 tests 全过**（`types` 13 / `conditions` 15 / `results` 11 / `candidates` 11 / `repository/inMemory` 32） |
| TypeScript | `npx tsc --noEmit` **exit 0** |
| 全量回归 | **178 文件 / 2720 tests 通过**；8 个失败文件**全为既有环境依赖失败**（Tushare token / 网络 / DB / 认证快照），与本次零交集 |
| 既有数据影响 | **零改动**：未触碰 `dataset_definition` / `dataset_version` / `ds_*` 物理表 / `strategies` / 遗留 `research_*` 三表；10 张新表均为空表 |
| 反模式 | Research 侧 Dataset 复制表 **0 张**（自动扫描断言） |

**本阶段不实现**：Research Engine、统计计算、前端页面、因子挖掘、机器学习、参数搜索、Backtest —— 全部属后续任务。

**完成标志达成**：Research 的数据库与领域模型稳定到**可在其上继续开发 Research Engine，而不需要再次重构核心数据结构**。

---

## 2. Existing Architecture Audit

完整审计见 `docs/research/RESEARCH-001-AUDIT.md`。要点：

### 2.1 关键发现

1. **项目已存在 `research_experiments` / `research_runs` / `research_datasets`（复数）** —— 属 STEP 6.x 遗留链路（字符串 `experimentId` 业务键 + `strategyId` 驱动 + 单一 `snapshotJson`），**与本设计的 `research_experiment` 非同一领域对象**。
2. `dataset_version.id` 是 **bigint** → Research 全部引用列用 bigint。
3. `strategies.strategyId` 是 **varchar(64)** → Candidate 的 `strategyDefinitionId` 用 varchar(64)。
4. 项目 **零数据库 FK**（soft reference / application-level integrity）。
5. 新表约定：列 camelCase / 表 snake_case 单数 / JSON 一律 `longtext` / 状态列 `varchar` + 应用层联合类型（**不用 `mysqlEnum`**）/ 时间戳 `DEFAULT now()` + `ON UPDATE`。
6. ⚠️ `drizzle/meta/_journal.json` 只到 **idx 23**、`*_snapshot.json` 只到 **0015**，而 `drizzle/*.sql` 已到 **0030** —— **0024~0030 全部是「手写 SQL + 幂等 apply 脚本」落库，journal 自 0024 起停止维护**。

### 2.2 由此确定的三项硬约束

| 约束 | 决策 |
|---|---|
| 表命名冲突（`research_experiment` vs `research_experiments`） | **用户拍板：严格按指令命名**；遗留表零改动；靠 schema 块注释 + 本报告 §15 + 审计 §4 对照表消歧 |
| `drizzle-kit generate` 不可用 | 执行 generate 会拿 `schema.ts` diff `0015_snapshot`，产出把 `0016~0030` 重放一遍的垃圾 → **禁用** |
| `_journal.json` 停维护 | 采用项目**实际在用**的 apply 脚本流程；**不手工补写 journal**（属指令 §19 明令禁止的伪造） |

---

## 3. Research Domain Model

```text
DatasetVersion (外部，只读引用 dataset_version.id)
      │ datasetVersionId
      ▼
ResearchExperiment ──┬── ResearchHypothesis
                     │
                     └── ResearchRun ──► ResearchAnalysis ──┬── ResearchAnalysisCondition
                                                             ├── ResearchAnalysisMetric
                                                             └── ResearchResult
      │
      ▼
ResearchConclusion ──► ResearchStrategyCandidate ──(软引用)──► strategies.strategyId
      ▲
ResearchArtifact（挂 Experiment 或 Run）
```

### 3.1 六组职责分离（指令 §24 强制）

| 分离 | 实现方式 |
|---|---|
| **Experiment ≠ Run** | 独立表 + `(experimentId, runNo)` 唯一；`inputSnapshotJson` 记录「这次到底用什么配置跑的」 |
| **Analysis ≠ Result** | `research_analysis` 只描述「要执行什么分析」；数值落 `research_result` |
| **Hypothesis ≠ Conclusion** | Hypothesis 是研究意图（`statement` / H0 / H1）；Conclusion 是结论（`conclusionType` / `evidence` / `confidence`） |
| **Metric ≠ Result** | `research_analysis_metric` 是指标**定义**；`research_result` 是**计算结果** |
| **Candidate ≠ Strategy** | Candidate 只软引用 `strategyDefinitionId`（可为 NULL）；**绝不写** `strategies` / `strategy_versions` |
| **Research ≠ Dataset** | 只引用 `datasetVersionId`；无任何行情 / event / prefix / post / path / outcome 副本 |

---

## 4. ER Diagram

```text
┌──────────────────────┐
│  dataset_version.id  │  bigint（外部，只读）
└──────────┬───────────┘
           │ datasetVersionId (soft ref, NOT NULL)
           ▼
┌──────────────────────┐
│ research_experiment  │  researchType / status / configJson / sampleCount
└───┬──────────────┬───┘
    │              │
    │ experimentId │ experimentId
    ▼              ▼
┌──────────────────┐  ┌──────────────────┐
│research_hypothesis│  │   research_run   │  runNo / status / inputSnapshotJson
└─────────┬─────────┘  └────────┬─────────┘
          │ hypothesisId        │ runId
          │                     ▼
          │           ┌────────────────────┐
          │           │ research_analysis  │  analysisType / target / status
          │           └──┬──────┬──────┬────┘
          │            │      │      │
          │            ▼      ▼      ▼
          │   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
          │   │ ..._condition│ │ ..._metric   │ │research_result│
          │   └──────────────┘ └──────────────┘ └──────────────┘
          │
          ▼
┌──────────────────────┐   conclusionType / title / evidenceJson / confidence
│ research_conclusion  │
└─────────┬────────────┘
          │ conclusionId
          ▼
┌────────────────────────────┐        ┌──────────────────────┐
│research_strategy_candidate │───────►│ strategies.strategyId│  varchar(64)，可 NULL
└────────────────────────────┘        └──────────────────────┘
          ▲
          │ experimentId

┌────────────────────┐
│  research_artifact │  experimentId? / runId?（至少一个非空）
└────────────────────┘
```

**全部引用为 soft reference，零数据库 FK。** 引用合法性由 Repository 写入前校验保证（§8.3）。

---

## 5. Schema Details

| # | 表 | 列数 | PK | 唯一 | 索引 | JSON 列 |
|---|---|---|---|---|---|---|
| 1 | `research_experiment` | 12 | `id` bigint | — | 3 | `configJson` |
| 2 | `research_hypothesis` | 10 | `id` bigint | — | 2 | — |
| 3 | `research_run` | 12 | `id` bigint | `(experimentId, runNo)` | 3 | `configJson` / `inputSnapshotJson` |
| 4 | `research_analysis` | 9 | `id` bigint | — | 3 | `configJson` |
| 5 | `research_analysis_condition` | 10 | `id` bigint | — | 2 | `valueJson` |
| 6 | `research_analysis_metric` | 7 | `id` bigint | `(analysisId, metricCode)` | 2 | `configJson` |
| 7 | `research_result` | 9 | `id` bigint | — | 3 | `dimensionJson` / `resultJson` |
| 8 | `research_conclusion` | 11 | `id` bigint | — | 3 | `evidenceJson` |
| 9 | `research_strategy_candidate` | 14 | `id` bigint | — | 4 | `entryRule` / `filterRule` / `exitRule` / `riskRule` / `parameterSpace` (Json) |
| 10 | `research_artifact` | 9 | `id` bigint | — | 3 | `metadataJson` |
| | **合计** | **103** | 10 | **2** | **28 idx + 2 uq = 30** | 14 |

字段级设计（类型 / nullable / 默认值 / 语义）见 `RESEARCH-001-SCHEMA.md §2`。

### 5.1 JSON 边界（指令 §22 原则）

**结构化列**（可 WHERE / ORDER BY / 聚合）：`id`、全部 `*Id` 引用、`name`、`status`、`*Type`、`metricCode`、`metricValue`、`sampleCount`、`fieldName`、`operator`、`groupNo`、`sortOrder`、`displayOrder`、全部时间戳、`confidence`、`uri`、`checksum`。

**JSON 列**（开放扩展 / 复杂结果）：14 个 `*Json` 列（见上表）。

**明确禁止的反例**：把 `{"metric":"MEAN_RETURN","value":0.023}` 整包塞进 JSON 而不落 `metricCode` + `metricValue`。
→ 真实 DB 已验证：`SELECT resultType, metricCode, metricValue, sampleCount FROM research_result WHERE analysisId=?` 可直接读出结构化行。

### 5.2 相对指令原文的调整（指令 §29 要求记录）

| # | 指令原文 | 实际采用 | 原因 |
|---|---|---|---|
| 1 | 表名 `research_experiment` 等 | **照做** | 用户明确拍板 |
| 2 | `id` 类型未指定 | `bigint AUTO_INCREMENT` | 与 `dataset_version.id`(bigint) 对齐，避免 bigint→int 截断 |
| 3 | enum 落库方式未指定 | `varchar(20~32)` + 应用层 TS 联合类型 | 项目新表约定（`dataset_*` 已如此），指令 §17 亦要求遵循项目规范 |
| 4 | `metric_value` 类型未指定 | `double`（**nullable**） | 复杂结果走 `resultJson`，单列不能 NOT NULL |
| 5 | condition 无 `sortOrder` | **新增** `sortOrder int DEFAULT 0` | 组内条件顺序须**确定性**（复现性） |
| 6 | condition 仅 `logicalOperator` | **新增** `groupLogicalOperator varchar(8)` | 指令 §8 要求预留条件组扩展；组内/组间分离 |
| 7 | `storage_type` 取值未列 | 定 `FILE / S3 / URL / INLINE` | 与 `dataset_definition.storageType` 风格一致 |
| 8 | 未提唯一约束 | 新增 `uq_research_run_experiment_run_no`、`uq_research_analysis_metric_analysis_code` | `runNo` 实验内唯一；同一 Analysis 同一 metric 只定义一次 |
| 9 | `confidence` 语义 | `double` nullable + 注释「**主观置信度 [0,1]，不是 p-value**」 | 指令 §11 明确要求 |
| 10 | 「journal 正确」 | **不写 journal**，走 apply 脚本流程 | journal 自 0024 停维护；补写 = 指令禁止的伪造。已记为 Known Issue（§15） |

**额外（Repository 层）**：指令 §18 列出 8 个 Repository；实现为 **10 个** —— 额外拆出 `ResearchAnalysisConditionRepository` / `ResearchAnalysisMetricRepository`（指令 §26 F 要求 Condition CRUD 与 Metric CRUD），避免把 `ResearchAnalysisRepository` 撑成上帝接口。

---

## 6. Migration Details

| 项 | 值 |
|---|---|
| 文件 | `drizzle/0031_research_core.sql` |
| 编号 | 0031（当前最大 0030 → +1） |
| 语句数 | 38（10 `CREATE TABLE` + 28 `CREATE INDEX`） |
| 幂等性 | `CREATE TABLE IF NOT EXISTS` + 索引重复错误码 1061 容忍 |
| 破坏性 | **零** —— 纯新增，对既有表无任何 ALTER / DROP，可回滚（DROP 10 表即回退） |
| 应用脚本 | `scripts/applyResearchCore.mjs`（apply + 95 项 `information_schema` 断言） |
| 权威声明 | DDL 唯一权威 = `drizzle/schema.ts`（脚本内 `EXPECTED_*` 仅作**断言清单**，不用于建表） |
| journal | **未修改**（见 §15 Known Issue ①） |

**应用结果（真实 TiDB）**：

```
[apply] 语句数 = 38
[apply] 执行完成 38/38（幂等跳过 0）
[verify] 表存在 10/10
[verify] 列总数 = 103
[verify] 关键列类型断言 15 项
[verify] 索引断言 30 项（实际索引条目 40 = 30 索引 + 10 PK）
[verify] 反模式扫描（Research 侧 Dataset 复制表）= 0 张
RESULT: PASS — 检查 95 项，失败 0 项
```

**二次运行（幂等验证）**：`执行完成 10/38（幂等跳过 28）`，断言仍 `95/95 PASS`。

---

## 7. Domain Types

模块目录：**`server/researchCore/`**（纯语义 camelCase、无数字后缀，遵守 ROADMAP §49.1）。

| 文件 | 职责 |
|---|---|
| `types.ts` | **15 类枚举集中管理**（`const 数组 as const` + 派生类型，同时给运行时取值与编译期类型）+ 10 个领域对象 + 3 个聚合视图 |
| `config.ts` | `ResearchExperimentConfig` / `ResearchAnalysisConfig` / `ResearchRunConfig` / **`ResearchInputSnapshot`**（执行快照）+ 默认值解析纯函数 |
| `conditions.ts` | 条件 / 条件组类型、装配（扁平行 ⇄ 条件组）、校验、人类可读渲染（**不是求值器**） |
| `results.ts` | 指标码登记表（`RESEARCH_METRIC_CODES`，22 个）+ 单值 / 分组 / 序列构造器 + 结构化边界校验 |
| `candidates.ts` | 规则集（entry / filter / exit / risk / parameterSpace）+ 候选状态机 + 转正一致性 |
| `serialization.ts` | JSON 编解码原子函数（**解析失败抛错，不静默返回 undefined**）+ ISO 时间互转 |

### 7.1 枚举清单（指令 §17 集中管理）

`ResearchType`(8) / `ResearchExperimentStatus`(6) / `ResearchHypothesisStatus`(6) / `ResearchRunStatus`(5) /
`ResearchAnalysisType`(11) / `ResearchAnalysisStatus`(5) / `ResearchConclusionType`(4) / `ResearchConclusionStatus`(3) /
`ResearchCandidateStatus`(6) / `ResearchArtifactType`(6) / `ResearchArtifactStorageType`(4) / `ResearchResultType`(3) /
`ResearchConditionOperator`(11) / `ResearchLogicalOperator`(3) / `ResearchGroupLogicalOperator`(2)

**测试守住**：无重复取值、非空、取值集合与指令 §4~§13 逐条一致、无小写漂移。

### 7.2 ⚠️ 模块隔离（重要）

`server/researchCore/` **不并入** `server/research/index.ts` barrel —— 那里已 star-export STEP 6.x 的 `ResearchExperiment` / `ResearchRun`（**同名不同物**），合并会造成符号冲突。消费方须显式 `import { ... } from "../researchCore"`。已在 `index.ts` 头部与审计报告 §4 声明。

### 7.3 NOT 语义精确定义（消除歧义）

指令 §8 要求「必须考虑以后支持 AND / OR / NOT」。定义：

- `logicalOperator` = 本条件相对**前一条**条件的连接方式；**首条忽略**；
- `AND` → `… AND c`；`OR` → `… OR c`；`NOT` → `… AND NOT c`（**「取反 + AND」，不是「连接符 NOT」**）；
- 「OR + 取反」借条件组表达：组A=`[x]`，组B=`[NOT y]`，组间 `OR` ⇒ `(x) OR (NOT y)`；
- 完整 AST（括号嵌套）不在第一版范围（指令 §8 只要「预留扩展能力」）。

---

## 8. Repository Design

### 8.1 分层

```
repository/
├── contract.ts    10 个单实体接口 + ResearchRelationshipQueries + ResearchRepositories 聚合
├── errors.ts      ResearchReferenceError（机器可读码）/ ResearchConflictError
├── db.ts          真实 DB 实现（drizzle + getDb）
├── inMemory.ts    测试替身（不变量与错误码与 db.ts 严格对齐）
└── index.ts       统一出口
```

### 8.2 能力矩阵

| Repository | create | getById | list | update | delete | 专有 |
|---|---|---|---|---|---|---|
| Experiment | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Hypothesis | ✅ | ✅ | `listByExperiment` | ✅ | ✅ | — |
| Run | ✅ | ✅ | ✅ | ✅ | ✅ | `nextRunNo` |
| Analysis | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Condition | — | — | `listByAnalysis` | — | — | `replaceForAnalysis` / `deleteByAnalysis` |
| Metric | ✅ | ✅ | `listByAnalysis` | ✅ | ✅ | — |
| Result | `createMany` | — | ✅ | — | — | `deleteByAnalysis` |
| Conclusion | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Candidate | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Artifact | ✅ | ✅ | ✅ | — | ✅ | — |

**关系查询**（`ResearchRelationshipQueries`）：`getExperimentWithRuns` / `getRunWithAnalyses` / `getAnalysisBundle`（一次取全 conditions+metrics+results）/ `getExperimentConclusions` / `getHypothesisConclusions` / `getCandidatesByExperiment`。

### 8.3 引用完整性（零 FK 下的应用层保证）

写入前**实查父引用存在性**，失败抛稳定错误码：

`RESEARCH_DATASET_VERSION_NOT_FOUND` / `_EXPERIMENT_NOT_FOUND` / `_HYPOTHESIS_NOT_FOUND` / `_RUN_NOT_FOUND` / `_ANALYSIS_NOT_FOUND` / `_CONCLUSION_NOT_FOUND` / `_ARTIFACT_SCOPE_REQUIRED`

`DATASET_VERSION` 校验直查真实 `dataset_version` 表（已实测：不存在的 id → 明确失败）。

### 8.4 边界自证

**Repository 内不含**统计计算 / 信号求值 / 回测 / 参数搜索 —— 全部方法名与实现仅为 Persistence / Query。

---

## 9. Dataset Integration

```text
Dataset Version (dataset_version.id)
    ↓ datasetVersionId
Research Experiment
    ↓
Event   ─┐
Prefix  ─┼─→ Features（PIT 安全，rd ≤ 0）
Path    ─┤
Outcome ─┘─→ Labels（rd ≥ 1）
    ↓
Research Analysis → Result → Conclusion → Candidate
```

| 规则 | 落地 |
|---|---|
| Research 只引用 `datasetVersionId` | 10 张表只有 `research_experiment.datasetVersionId` 一个 Dataset 引用列 |
| **不复制** Dataset | 无行情表、无 event/prefix/post/path/outcome 副本（自动扫描断言 0 张） |
| **不改动** Dataset | Repository 无任何 `ds_*` / `dataset_version` 写操作（仅 1 处 SELECT 做存在性校验） |
| 一个 Experiment 只绑一个 Dataset Version | `datasetVersionId` 在 update patch 类型中被 `Omit`，**创建即冻结** |
| 跨版本比较 | 指令要求「不要破坏当前模型」→ 本阶段**不实现**；需新建明确 Comparison 类型（见 §16） |

---

## 10. Strategy Integration

| 规则 | 落地 |
|---|---|
| Candidate 是 Research 出口，**不是**正式 Strategy | 只写 `research_strategy_candidate` |
| `strategyDefinitionId = NULL` **合法** | 已测：create with null 通过；`assertCandidateConversionCoherence` 只要求 **CONVERTED** 时必须非空 |
| 不写 `strategies` / `strategy_versions` | 全模块零写操作；varchar(64) 软引用 |
| 转正须经状态机 | `DRAFT → REVIEW → ACCEPTED → CONVERTED`；`DRAFT → CONVERTED` **被拒绝**（已测） |
| 未转正不得已挂策略 | 非 `CONVERTED` 状态带 `strategyDefinitionId` → 拒绝（已测） |

---

## 11. PIT Boundary

### 11.1 领域层明确（指令 §15）

| 数据 | 允许用途 | 来源 |
|---|---|---|
| **Research Feature** | `availability ≤ T` | Dataset `event`（时点属性）+ **`prefix`**（原始行情，`relativeDay ∈ [-preWindowDays, 0]`） |
| **Research Outcome / Label** | `T+1 … T+N` | Dataset `post`（原始行情 `rd ≥ 1`）/ `path`（衍生）/ `outcome`（聚合） |
| **禁止** | 未来数据进入 Feature（如用 `T+5 close` 当 T 日 Feature） | — |

### 11.2 Research 层不重新定义时间逻辑

`server/researchCore` **零**时间窗口计算代码：不计算 `relativeDay`、不判涨停、不取行情。PIT 边界由 **Dataset 的物理五表分层**在**结构级**强制（`prefix` ↔ `post` 的分界落在 t 日）—— Research 只是消费者，无法绕过。

`ResearchInputSnapshot` 只**记录**（不只计算）实际使用的 Dataset Version 与日期区间，用于事后复现。

---

## 12. Index Strategy

共 **30 个索引项**（28 `idx_` + 2 `uq_`）+ 10 PK = 40 个 `STATISTICS` 条目（已实查核对）。

| 表 | 索引 | 支撑查询 |
|---|---|---|
| experiment | `datasetVersionId` / `status` / `createdAt` | 「该版本做过哪些实验」/ 状态筛 / 列表倒序 |
| hypothesis | `experimentId` / `status` | 详情页 / 假设看板 |
| run | **`(experimentId, runNo)` UNIQUE** / `experimentId` / `status` / `createdAt` | 幂等写入 + 次数校验 / 详情 / 队列 / 列表 |
| analysis | `runId` / `analysisType` / `status` | 运行详情 / 按类型聚合 |
| condition | `analysisId` / `fieldName` | 条件装配 / 「哪些分析用了 turnover」 |
| metric | **`(analysisId, metricCode)` UNIQUE** / `analysisId` / `metricCode` | 防重复定义 / 装配 / 跨分析统计 |
| result | **`(analysisId, metricCode)` 复合** / `analysisId` / `metricCode` | **主查询路径**（前端取某分析某指标） |
| conclusion | `experimentId` / `hypothesisId` / `status` | 实验结论 / 假设结论 / 结论看板 |
| candidate | `experimentId` / `conclusionId` / `status` / `strategyDefinitionId` | 候选列表 / 溯源 / 状态筛 / 反查已转正 |
| artifact | `experimentId` / `runId` / `artifactType` | 产物挂载点 |

**刻意未建**（避免机械建索引）：`research_result.createdAt`（结果按 analysis 读，不按时间扫全表）、`research_artifact.uri`（不做 URI 检索，仅定位）。

---

## 13. Test Results

### 13.1 单元 + 契约测试（vitest，内存替身）

```
✓ server/researchCore/types.test.ts                  (13 tests)
✓ server/researchCore/results.test.ts                (11 tests)
✓ server/researchCore/conditions.test.ts             (15 tests)
✓ server/researchCore/candidates.test.ts             (11 tests)
✓ server/researchCore/repository/inMemory.test.ts    (32 tests)
Test Files  5 passed (5)
     Tests  82 passed (82)
```

覆盖指令 §26 F 全部要求：**10 类 CRUD** + **§18 关系查询** + **§21 引用完整性** + **§25 完整领域链路**。

**测试还抓出并修正了 2 处实现缺陷**（记录以便追溯）：
1. `renderConditionSet` 对 `NOT` 的语义未定义 → 精确定义为「AND NOT」并补 3 个测试；
2. `assertConditionSpec` 的组号一致性检查顺序早于连续性检查 → 调整为测试能明确区分两类错误。

### 13.2 真实 DB 端到端（`scripts/verifyResearchCore.mts`）

```
[1] 引用完整性        ✓ dataset_version 不存在 → DATASET_VERSION_NOT_FOUND
[2] Experiment CRUD   ✓ 7 项
[3] Hypothesis/Run    ✓ 5 项（含 DB 层唯一约束裸 SQL 拒绝）
[4] Analysis/Cond/Metric/Result ✓ 12 项（含 metricCode/metricValue 结构化直查）
[5] Conclusion/Candidate ✓ 6 项（含非法状态迁移被拒）
[6] Artifact CRUD     ✓ 2 项
[7] 关系查询          ✓ 9 项
[8] 逆序清理          ✓ 2 项（零残留）
RESULT: PASS — 检查 45 项，失败 0 项
```

**跑的是 `createDbResearchRepositories()` 本体**（非裸 SQL 模拟），验证后逆序自清理，不触碰任何既有数据。

### 13.3 全量回归

```
Test Files  8 failed | 178 passed (186)
     Tests  16 failed | 2720 passed (2736)
```

8 个失败文件：`image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `researchRunRouter` / `tushare.secret` / `tushareTradingCalendar` / `dataHealth` —— **全部为既有环境依赖失败**（Tushare token 未注入 / 网络超时 / DB 依赖 / 认证快照），本次改动为**纯新增模块 + 纯新增表**，与这 8 个文件**零交集**。

`npx tsc --noEmit` **exit 0**。

---

## 14. Migration Verification

| 验收项（指令 §27） | 结果 |
|---|---|
| 10 张核心表完成 | ✅ 实查 `information_schema`：**10/10** |
| migration 成功 | ✅ 38/38 语句执行成功 |
| migration journal 正确 | ⚠️ **未写 journal**（自 0024 停维护，手工补写=伪造）。见 §15 ① |
| 实际数据库 schema 与代码一致 | ✅ 103 列 / 15 项关键列类型断言 / 30 索引项 / 2 唯一约束列序列 全 PASS |
| index 合理 | ✅ 见 §12（含刻意未建项说明） |
| 没有重复 Dataset 数据表 | ✅ 自动扫描「Research 侧 Dataset 复制表 = 0 张」 |
| 幂等可重跑 | ✅ 二次运行 `10/38` + 跳过 28，断言仍 95/95 |

---

## 15. Known Issues

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| ① | `drizzle/meta/_journal.json`（idx ≤ 23）与 `*_snapshot.json`（≤ 0015）**自 migration 0024 起停止维护** | `npm run db:push`（`drizzle-kit generate && migrate`）**当前不可用**；本次未补写 journal（指令 §19 禁止伪造） | 后续如需恢复 `drizzle-kit`，须先用现状 `schema.ts` + 真实 DB 重建 baseline snapshot |
| ② | 新增 `research_experiment` 与遗留 `research_experiments` **仅差一个 `s`** | 人读易混淆（机器无影响） | 已用 schema 块注释 + 审计 §4 对照表 + 本报告消歧；**未来清理遗留链路应优先重命名遗留表** |
| ③ | `server/researchCore` **未接 tRPC 路由与前端** | 无 UI 可用 | 属后续任务（见 §16） |
| ④ | `research_result` 缺 `createdAt` 索引、`research_artifact` 缺 `uri` 索引 | 无（无对应查询模式） | 刻意不建，避免机械索引 |
| ⑤ | 「OR + 取反」需借条件组表达，无法在单组内写 `A OR NOT B` | 表达力受限（可绕过） | 若未来需要，引入条件树（AST）或 `negated` 布尔列 |
| ⑥ | `dataset_version` 现有 2 行中 `id=390002`（v2）状态为 `BUILDING` | 与本任务无关 | 既有状态，非本次引入 |
| ⑦ | `ds_*` 数据仍为 **DATASET-003B P1 修复前口径**（旧样本数偏低） | **基于当前 ds_\* 数据不得产出策略结论** | 属 DATASET-003B 遗留，见 §17 |

---

## 16. Future Work

| 优先级 | 任务 | 说明 |
|---|---|---|
| P0 | **DATASET-003B P1 口径修复后重建 smoke/v1/v2** | `ds_*` 旧口径未重建，**是任何策略结论的前置门槛** |
| P1 | **RESEARCH-002：Research Engine** | 在本次稳定的持久层上实现统计计算（描述 / 分布 / 分位 / 相关 / IC / 事件研究 / 条件 / Path / Regime / 显著性 / 稳定性），把结果写入 `research_result` |
| P1 | Research tRPC 路由 + 前端页面 | 实验列表 / 详情（Run、Analysis、Result 表格）/ 结论 / 候选 |
| P2 | `analysis_condition` → 条件树（AST） | 若单组内 `OR NOT` 成为刚需 |
| P2 | 跨 Dataset Version Comparison 类型 | 指令 §4 明确要求「不要破坏当前模型」，故本阶段未做 |
| P2 | 修复 `_journal.json` baseline | 恢复 `drizzle-kit` 工作流（见 §15 ①） |
| P3 | 清理 / 重命名遗留 `research_experiments` 链路 | 消除 §15 ② 的命名歧义 |
| P3 | Research Engine 的 PIT 违规自动检测 | 在 Engine 层加「特征只读 prefix / 标签只读 post·path·outcome」的运行期断言 |

---

## 17. Recommended RESEARCH-002

**建议 RESEARCH-002 = Research Engine（统计计算层）**，理由：

1. RESEARCH-001 已把「结果落哪里、怎么查、怎么保证引用合法」全部稳定（10 表 + Repository + 82 tests + 45 项真实 DB 断言）；
2. Engine 的产出形态已被 `research_result` / `research_analysis_metric` / `research_analysis_condition` 完全预定 —— 不会反过来要求改核心结构；
3. 指令 §30 的完成标志正是「**稳定到可以在其上继续开发 Research Engine**」，下一步自然衔接。

**RESEARCH-002 硬前置（必须先确认）**：

- 🔴 **`ds_*` 数据是否已按 DATASET-003B P1（涨停价四舍五入到分）重建**。当前仍为旧口径，实测封板样本**漏判 38.03%** —— 在此之上算出的任何 IC / 分位收益 / 胜率都不可信。**若未重建，Engine 只能跑通流程，不得产出策略结论。**

**RESEARCH-002 范围建议**：

1. Engine 输入契约：`datasetVersionId` + `ResearchInputSnapshot` + `ResearchAnalysisConfig`（**只读** Dataset，只写 Research 自己的表）；
2. 11 类 `analysisType` 逐类实现（先 QUANTILE / DESCRIPTIVE / EVENT_STUDY，后 IC / SIGNIFICANCE / STABILITY）；
3. **PIT 防线**：Engine 层强制「Feature 只取 `prefix`+`event`，Label 只取 `post`/`path`/`outcome`」的运行期断言；
4. 结果写入：结构化指标走 `metricCode`+`metricValue`+`sampleCount`，复杂统计走 `resultJson`；
5. Engine 完成后，结论（`research_conclusion`）与候选（`research_strategy_candidate`）的生成仍**由人/编排层决策**，不由 Engine 自动下结论。
