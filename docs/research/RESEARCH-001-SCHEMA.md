# RESEARCH-001 Phase B — Research Schema 设计

> 设计依据：`docs/research/RESEARCH-001-AUDIT.md`（§7 硬约束）
> 落库目标：TiDB（MySQL 兼容），migration `drizzle/0031_research_core.sql`
> 设计原则：**查询/排序/过滤/聚合用到的 → 结构化列；开放扩展性质的 → JSON**

---

## 1. ER 图

### 1.1 领域关系（逻辑）

```text
                 ┌──────────────────────┐
                 │  dataset_version id  │   (Dataset Registry，外部，bigint)
                 └───────────┬──────────┘
                             │ datasetVersionId  (soft ref，禁 FK)
                             ▼
                 ┌──────────────────────┐
                 │ research_experiment  │ ◄── 1 Experiment = 1 Dataset Version（不可混用）
                 └───┬──────────────┬───┘
                     │              │
        experimentId │              │ experimentId
                     ▼              ▼
        ┌────────────────────┐  ┌──────────────────┐
        │ research_hypothesis│  │   research_run   │  runNo 在 Experiment 内唯一
        └─────────┬──────────┘  └────────┬─────────┘
                  │ hypothesisId         │ runId
                  │                      ▼
                  │            ┌────────────────────┐
                  │            │ research_analysis  │
                  │            └───┬──────┬─────┬───┘
                  │    analysisId  │      │     │
                  │      ┌─────────┘      │     └──────────┐
                  │      ▼                ▼                ▼
                  │  ┌──────────────────────┐  ┌─────────────────────────┐
                  │  │research_analysis_    │  │ research_analysis_metric│
                  │  │condition             │  └────────────┬────────────┘
                  │  └──────────────────────┘               │ analysisId
                  │                                          ▼
                  │                              ┌────────────────────┐
                  │                              │   research_result  │
                  │                              └────────────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │ research_conclusion  │  conclusionType + evidence(JSON) + confidence
        └─────────┬────────────┘
                  │ conclusionId
                  ▼
        ┌────────────────────────────┐        ┌──────────────────────┐
        │ research_strategy_candidate│───────►│ strategies.strategyId│  (soft ref，可为 NULL)
        └────────────────────────────┘        └──────────────────────┘
                  ▲
                  │ experimentId

        ┌────────────────────┐
        │ research_artifact  │  experimentId? / runId? （至少一个非空，应用层保证）
        └────────────────────┘
```

### 1.2 引用方向汇总（全部 soft reference，**零 FK**）

| 子表列 | 目标 | 类型 | 必填 | 目标可空 |
|---|---|---|---|---|
| `research_experiment.datasetVersionId` | `dataset_version.id` | bigint | ✅ | ❌（Dataset Version 是输入边界，必须存在） |
| `research_hypothesis.experimentId` | `research_experiment.id` | bigint | ✅ | ❌ |
| `research_run.experimentId` | `research_experiment.id` | bigint | ✅ | ❌ |
| `research_analysis.runId` | `research_run.id` | bigint | ✅ | ❌ |
| `research_analysis_condition.analysisId` | `research_analysis.id` | bigint | ✅ | ❌ |
| `research_analysis_metric.analysisId` | `research_analysis.id` | bigint | ✅ | ❌ |
| `research_result.analysisId` | `research_analysis.id` | bigint | ✅ | ❌ |
| `research_conclusion.experimentId` | `research_experiment.id` | bigint | ✅ | ❌ |
| `research_conclusion.hypothesisId` | `research_hypothesis.id` | bigint | ❌ | ✅（无假设的探索性结论合法） |
| `research_strategy_candidate.experimentId` | `research_experiment.id` | bigint | ✅ | ❌ |
| `research_strategy_candidate.conclusionId` | `research_conclusion.id` | bigint | ❌ | ✅ |
| `research_strategy_candidate.strategyDefinitionId` | `strategies.strategyId` | varchar(64) | ❌ | ✅ **NULL = 尚未转正（合法状态）** |
| `research_artifact.experimentId` | `research_experiment.id` | bigint | ❌ | ✅（与 runId 至少一个非空） |
| `research_artifact.runId` | `research_run.id` | bigint | ❌ | ✅ |

---

## 2. 表设计（10 张）

### 2.1 `research_experiment`

> **与遗留 `research_experiments`（复数）的区别**：后者是 STEP 6.2 策略参数实验（`experimentId` 字符串业务键 + `snapshotJson` 单一大 JSON + `strategyId` 驱动）。本表是 **Dataset-Registry 原生**研究实验（`datasetVersionId` bigint 驱动 + 结构化状态列）。**两者并存，互不引用。**

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `datasetVersionId` | bigint | NO | — | 软引用 `dataset_version.id`；**输入边界** |
| `name` | varchar(200) | NO | — | 实验名 |
| `description` | text | YES | NULL | 描述 |
| `researchType` | varchar(32) | NO | `'CUSTOM'` | `FEATURE / EVENT_STUDY / CONDITIONAL / PATH / REGIME / FACTOR / HYPOTHESIS / CUSTOM` |
| `status` | varchar(20) | NO | `'DRAFT'` | `DRAFT / READY / RUNNING / COMPLETED / FAILED / ARCHIVED` |
| `configJson` | longtext | YES | NULL | `ResearchExperimentConfig`，开放扩展 |
| `sampleCount` | int | YES | NULL | 本次实验样本数（Run 完成后回填） |
| `startedAt` | timestamp | YES | NULL | |
| `completedAt` | timestamp | YES | NULL | |
| `createdAt` | timestamp | NO | `now()` | |
| `updatedAt` | timestamp | NO | `now()` ON UPDATE | |

**索引**：`idx_research_experiment_dataset_version(datasetVersionId)`、`idx_research_experiment_status(status)`、`idx_research_experiment_created(createdAt)`

---

### 2.2 `research_hypothesis`

> Hypothesis 是**研究意图**，不是 Analysis，也不是 Conclusion。

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `experimentId` | bigint | NO | — | 软引用 |
| `name` | varchar(200) | NO | — | |
| `statement` | text | NO | — | 假设陈述（「换手率 8%~15% 时 T+5 收益显著更高」） |
| `nullHypothesis` | text | YES | NULL | H0 |
| `alternativeHypothesis` | text | YES | NULL | H1 |
| `status` | varchar(32) | NO | `'DRAFT'` | `DRAFT / TESTING / SUPPORTED / PARTIALLY_SUPPORTED / REJECTED / INCONCLUSIVE` |
| `conclusion` | text | YES | NULL | 速记备注；**正式结论在 `research_conclusion`** |
| `createdAt` | timestamp | NO | `now()` | |
| `updatedAt` | timestamp | NO | `now()` ON UPDATE | |

**索引**：`idx_research_hypothesis_experiment(experimentId)`、`idx_research_hypothesis_status(status)`

---

### 2.3 `research_run`

> **Experiment 与 Run 必须分离**（同一实验可跑全周期 / 分年度 / 去极端行情…）。
> `inputSnapshotJson` 回答「**这次到底用什么配置执行的**」，不得只依赖 Experiment 当前 config。

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `experimentId` | bigint | NO | — | 软引用 |
| `runNo` | int | NO | — | 实验内序号，**1 起** |
| `status` | varchar(20) | NO | `'PENDING'` | `PENDING / RUNNING / COMPLETED / FAILED / CANCELLED` |
| `configJson` | longtext | YES | NULL | 本次执行入参（申请态） |
| `inputSnapshotJson` | longtext | YES | NULL | **执行时真实落定的配置快照**（含 datasetVersionId / 日期区间 / 筛选口径） |
| `sampleCount` | int | YES | NULL | |
| `startedAt` | timestamp | YES | NULL | |
| `completedAt` | timestamp | YES | NULL | |
| `errorCode` | varchar(64) | YES | NULL | 机器可读错误码 |
| `errorMessage` | text | YES | NULL | |
| `createdAt` | timestamp | NO | `now()` | |

**唯一**：`uq_research_run_experiment_run_no(experimentId, runNo)`
**索引**：`idx_research_run_experiment(experimentId)`、`idx_research_run_status(status)`、`idx_research_run_created(createdAt)`

---

### 2.4 `research_analysis`

> Analysis 描述「**我要执行什么分析**」；**最终数值结果不得大量塞进本表**。

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `runId` | bigint | NO | — | 软引用 |
| `analysisType` | varchar(32) | NO | — | `DESCRIPTIVE / DISTRIBUTION / QUANTILE / CORRELATION / IC / EVENT_STUDY / CONDITIONAL / PATH / REGIME / SIGNIFICANCE / STABILITY` |
| `name` | varchar(200) | NO | — | |
| `target` | varchar(200) | YES | NULL | 分析目标字段（如 `return_5d`） |
| `configJson` | longtext | YES | NULL | 分析参数（如分位组数） |
| `status` | varchar(20) | NO | `'PENDING'` | `PENDING / RUNNING / COMPLETED / FAILED / CANCELLED` |
| `createdAt` | timestamp | NO | `now()` | |
| `completedAt` | timestamp | YES | NULL | |

**索引**：`idx_research_analysis_run(runId)`、`idx_research_analysis_type(analysisType)`、`idx_research_analysis_status(status)`

---

### 2.5 `research_analysis_condition`

> 条件**结构化**表达，禁止只存一个不可解析字符串。
> 组内用 `logicalOperator` 连接；组间用 `groupLogicalOperator` 连接 —— 保留 `AND / OR / NOT` 与条件组扩展能力（**第一版不做完整 AST**）。

示例（`analysisId = 1001`）：

| groupNo | sortOrder | fieldName | operator | valueJson | logicalOperator | groupLogicalOperator |
|---|---|---|---|---|---|---|
| 0 | 0 | `market_strength` | `>` | `0.6` | `AND` | `AND` |
| 0 | 1 | `turnover` | `>=` | `8` | `AND` | `AND` |
| 0 | 2 | `turnover` | `<=` | `15` | `AND` | `AND` |
| 1 | 0 | `amount` | `>` | `500000000` | `AND` | `AND` |

→ 语义：`(market_strength > 0.6 AND turnover >= 8 AND turnover <= 15) AND (amount > 500000000)`

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `analysisId` | bigint | NO | — | 软引用 |
| `groupNo` | int | NO | `0` | 条件组号（组间由 `groupLogicalOperator` 连接） |
| `sortOrder` | int | NO | `0` | **组内确定性顺序**（复现性要求） |
| `fieldName` | varchar(128) | NO | — | 字段名 |
| `operator` | varchar(16) | NO | — | `> / >= / < / <= / == / != / IN / NOT_IN / BETWEEN / IS_NULL / IS_NOT_NULL` |
| `valueJson` | longtext | NO | — | 值（JSON，支持标量 / 数组 / `[lo,hi]`） |
| `logicalOperator` | varchar(8) | NO | `'AND'` | `AND / OR / NOT`（**组内**） |
| `groupLogicalOperator` | varchar(8) | NO | `'AND'` | `AND / OR`（**组间**） |
| `createdAt` | timestamp | NO | `now()` | |

**索引**：`idx_research_condition_analysis(analysisId)`、`idx_research_condition_field(fieldName)`

---

### 2.6 `research_analysis_metric`

> Metric 是**指标定义**；Result 才保存实际计算结果。

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `analysisId` | bigint | NO | — | 软引用 |
| `metricCode` | varchar(64) | NO | — | `MEAN_RETURN / MEDIAN_RETURN / WIN_RATE / MAX_DRAWDOWN / IC / RANK_IC / ICIR / T_STAT / P_VALUE / …` |
| `metricName` | varchar(128) | NO | — | 展示名 |
| `configJson` | longtext | YES | NULL | 指标参数 |
| `displayOrder` | int | NO | `0` | |
| `createdAt` | timestamp | NO | `now()` | |

**唯一**：`uq_research_analysis_metric_analysis_code(analysisId, metricCode)`
**索引**：`idx_research_metric_analysis(analysisId)`、`idx_research_metric_code(metricCode)`

---

### 2.7 `research_result`

> **统计结果层**，不是样本层。**禁止**为每个 Dataset 样本生成一行。
> 量级估算：1 Experiment × 10 Run × 20 Analysis × 10 Quantile × 20 Metric = 40,000 行（可接受）。

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `analysisId` | bigint | NO | — | 软引用 |
| `resultType` | varchar(32) | NO | `'SCALAR'` | `SCALAR`(单值) / `GROUPED`(分组) / `SERIES`(序列) |
| `dimensionJson` | longtext | YES | NULL | 分组维度，如 `{"quantile":10}`、`{"year":2025}` |
| `metricCode` | varchar(64) | NO | — | 结构化指标码 |
| `metricValue` | double | YES | NULL | **结构化数值**（复杂结果入 `resultJson`，故可空） |
| `sampleCount` | int | YES | NULL | 该单元格样本数 |
| `resultJson` | longtext | YES | NULL | 复杂统计结果（置信区间 / 分布 / 明细） |
| `createdAt` | timestamp | NO | `now()` | |

**索引**：`idx_research_result_analysis(analysisId)`、`idx_research_result_metric(metricCode)`、`idx_research_result_analysis_metric(analysisId, metricCode)`（复合，主查询路径）

**结构化 vs JSON 边界**（§22 原则落地）：

| 结果形态 | 落法 |
|---|---|
| `MEAN_RETURN = 0.0283` | `metricCode='MEAN_RETURN'`, `metricValue=0.0283`, `resultType='SCALAR'` |
| `Q1=0.012 … Q10=0.056` | 10 行，`resultType='GROUPED'`, `dimensionJson='{"quantile":1..10}'`, 各带 `metricValue` |
| `p_value / t_stat / confidence_interval` | 结结构化 `metricCode` + `metricValue`（区间额外入 `resultJson`） |

---

### 2.8 `research_conclusion`

> Research **必须形成结论**，而非停留在统计数字。
> `confidence` = **主观置信度 0~1**，**不是 p-value**（统计显著性走 `research_result` 的 `p_value` / `t_stat` / 区间）。

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `experimentId` | bigint | NO | — | 软引用 |
| `hypothesisId` | bigint | YES | NULL | 软引用；探索性结论可为空 |
| `conclusionType` | varchar(32) | NO | — | `SUPPORTED / PARTIALLY_SUPPORTED / REJECTED / INCONCLUSIVE` |
| `title` | varchar(200) | NO | — | |
| `conclusion` | text | NO | — | 结论正文 |
| `evidenceJson` | longtext | YES | NULL | **结构化证据数组**（来源 analysisId / metricCode / 方向一致性 / 环境分档） |
| `confidence` | double | YES | NULL | 主观置信度 [0,1] |
| `status` | varchar(20) | NO | `'DRAFT'` | `DRAFT / FINAL / SUPERSEDED` |
| `createdAt` | timestamp | NO | `now()` | |
| `updatedAt` | timestamp | NO | `now()` ON UPDATE | |

**索引**：`idx_research_conclusion_experiment(experimentId)`、`idx_research_conclusion_hypothesis(hypothesisId)`、`idx_research_conclusion_status(status)`

---

### 2.9 `research_strategy_candidate`

> Research 的**出口**。Candidate **不是**正式 Strategy：`strategyDefinitionId = NULL` 合法，转正由 Strategy 侧完成。

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `experimentId` | bigint | NO | — | 软引用 |
| `conclusionId` | bigint | YES | NULL | 软引用 |
| `strategyDefinitionId` | varchar(64) | YES | NULL | 软引用 `strategies.strategyId`；**NULL = 未转正** |
| `name` | varchar(200) | NO | — | |
| `description` | text | YES | NULL | |
| `entryRuleJson` | longtext | YES | NULL | 入场规则（如 `{"event":"FIRST_LIMIT_UP"}`） |
| `filterRuleJson` | longtext | YES | NULL | 过滤规则（与 `research_analysis_condition` 同构） |
| `exitRuleJson` | longtext | YES | NULL | 出场规则（如 `{"holdingDays":5}`） |
| `riskRuleJson` | longtext | YES | NULL | 风控规则 |
| `parameterSpaceJson` | longtext | YES | NULL | 待搜参数空间 |
| `status` | varchar(20) | NO | `'DRAFT'` | `DRAFT / REVIEW / ACCEPTED / REJECTED / CONVERTED / ARCHIVED` |
| `createdAt` | timestamp | NO | `now()` | |
| `updatedAt` | timestamp | NO | `now()` ON UPDATE | |

**索引**：`idx_research_candidate_experiment(experimentId)`、`idx_research_candidate_conclusion(conclusionId)`、`idx_research_candidate_status(status)`、`idx_research_candidate_strategy(strategyDefinitionId)`

---

### 2.10 `research_artifact`

> 文件型产物**只存 uri + checksum**，**禁止**把大量二进制塞进数据库。

| 列 | 类型 | Null | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint AI | NO | — | PK |
| `experimentId` | bigint | YES | NULL | 与 `runId` **至少一个非空**（应用层保证） |
| `runId` | bigint | YES | NULL | |
| `artifactType` | varchar(32) | NO | — | `REPORT / DATA / CHART / STATISTICS / EXPORT / OTHER` |
| `storageType` | varchar(32) | NO | `'FILE'` | `FILE / S3 / URL / INLINE`（`INLINE` = 小体积直接落 `metadataJson`） |
| `uri` | text | NO | — | 产物定位 |
| `checksum` | varchar(64) | YES | NULL | 内容校验（SHA-256 hex） |
| `metadataJson` | longtext | YES | NULL | 格式 / 大小 / 生成参数 |
| `createdAt` | timestamp | NO | `now()` | |

**索引**：`idx_research_artifact_experiment(experimentId)`、`idx_research_artifact_run(runId)`、`idx_research_artifact_type(artifactType)`

---

## 3. 领域对象生命周期

```text
research_experiment
  DRAFT ──► READY ──► RUNNING ──► COMPLETED
                        │              
                        └──► FAILED ──► DRAFT（允许重试）
  COMPLETED / FAILED ──► ARCHIVED（归档，只读）

research_run
  PENDING ──► RUNNING ──► COMPLETED
                 └────► FAILED
                 └────► CANCELLED
  （终态不可回退；同一 Experiment 可继续新增 runNo+1）

research_analysis
  PENDING ──► RUNNING ──► COMPLETED | FAILED

research_hypothesis
  DRAFT ──► TESTING ──► SUPPORTED | PARTIALLY_SUPPORTED | REJECTED | INCONCLUSIVE

research_strategy_candidate
  DRAFT ──► REVIEW ──► ACCEPTED ──► CONVERTED（strategyDefinitionId 由 NULL 变为非空）
                  └──► REJECTED
  任意非终态 ──► ARCHIVED
```

**状态机约束由应用层（Domain + Repository Service）保证**，数据库只存值 —— 与 `server/datasetRegistry/lifecycle.ts` 的现有做法一致。

---

## 4. JSON 字段边界（§22 原则逐条落地）

| 列 | 为何是 JSON | 为何不结构化 |
|---|---|---|
| `research_experiment.configJson` | 实验配置形态随 `researchType` 变化，开放扩展 | 无固定查询需求 |
| `research_run.configJson` / `inputSnapshotJson` | 执行快照是「当下所有入参」的冻结，字段随分析类型变 | 只需整体读写，不需按字段过滤 |
| `research_analysis.configJson` | 分析参数（分位组数 / 窗口 / 目标） | 同上 |
| `research_analysis_condition.valueJson` | 值可为标量 / 数组 / 区间 | **`fieldName` / `operator` / `groupNo` 已结构化**，可按字段反查 |
| `research_analysis_metric.configJson` | 指标级参数 | `metricCode` / `displayOrder` 已结构化 |
| `research_result.dimensionJson` | 分组维度名不固定（quantile / year / regime） | **`metricCode` / `metricValue` / `sampleCount` / `analysisId` 已结构化** |
| `research_result.resultJson` | 复杂统计（置信区间 / 分布明细） | 核心单值已入 `metricValue` |
| `research_conclusion.evidenceJson` | 证据是异质数组（引用 analysis / 年度方向 / 环境分档） | — |
| `research_strategy_candidate.*RuleJson` | 规则 DSL 未来会演进 | `status` / `name` / `experimentId` 已结构化 |
| `research_artifact.metadataJson` | 元信息开放 | `uri` / `checksum` / `artifactType` 已结构化 |

**反例（明确禁止）**：把 `{"metric":"MEAN_RETURN","value":0.023}` 整包塞进 JSON，而不落 `metricCode` + `metricValue`。

---

## 5. Index 策略说明（不机械创建）

| 表 | 索引 | 支撑的真实查询 |
|---|---|---|
| `research_experiment` | `datasetVersionId` | 「这个 Dataset Version 上做过哪些实验」 |
| | `status` | 实验列表按状态筛 |
| | `createdAt` | 列表默认倒序 |
| `research_hypothesis` | `experimentId` | 实验详情页拉假设 |
| | `status` | 假设看板 |
| `research_run` | `(experimentId, runNo)` **UNIQUE** | 幂等写入 + 运行次数校验 |
| | `experimentId` / `status` / `createdAt` | 详情页 / 队列 / 列表 |
| `research_analysis` | `runId` / `analysisType` / `status` | 运行详情 / 按分析类型聚合 |
| `research_analysis_condition` | `analysisId` / `fieldName` | 条件装配 / 「哪些分析用了 turnover」 |
| `research_analysis_metric` | `(analysisId, metricCode)` **UNIQUE** | 防重复定义 |
| | `analysisId` / `metricCode` | 指标装配 / 跨分析统计 |
| `research_result` | **`(analysisId, metricCode)` 复合** | 最主要读取路径（前端取某分析某指标） |
| | `analysisId` / `metricCode` | 兜底 |
| `research_conclusion` | `experimentId` / `hypothesisId` / `status` | 实验结论 / 假设结论 / 结论看板 |
| `research_strategy_candidate` | `experimentId` / `conclusionId` / `status` / `strategyDefinitionId` | 候选列表 / 溯源 / 状态筛 / 反查已转正 |
| `research_artifact` | `experimentId` / `runId` / `artifactType` | 产物挂载点 |

**未创建**：`research_result.createdAt` 单列索引（结果按 analysis 读，不需按时间扫全表）；`research_artifact.uri` 索引（不做 URI 检索，仅定位）。

---

## 6. 反模式自查（§24 逐条）

| 禁止项 | 本设计是否触犯 | 说明 |
|---|---|---|
| `Research Daily Price` / `Research Stock Daily` | ❌ 未触犯 | 10 张表无任何行情列 |
| `Research Event/Outcome Copy` | ❌ 未触犯 | 不复制 `ds_*` 任何表 |
| `Research Result = Dataset 样本复制` | ❌ 未触犯 | `research_result` 是统计层，`dimensionJson` 分组 |
| `Analysis = 一个巨大 JSON` | ❌ 未触犯 | Analysis 只存定义；结果在 `research_result` |
| `Conclusion 只有一段文字` | ❌ 未触犯 | `conclusion` 强制 `experimentId` + 可选 `hypothesisId` + `evidenceJson` |
| Candidate 直接改正式 Strategy | ❌ 未触犯 | 只写 `strategyDefinitionId` 软引用，不写 `strategies` |
| Research 直接执行 Backtest | ❌ 未触犯 | Repository 层无任何回测/撮合调用 |
| Research 直接改 Dataset Version | ❌ 未触犯 | 只读引用 `datasetVersionId` |
